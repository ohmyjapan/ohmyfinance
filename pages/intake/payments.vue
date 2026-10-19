<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4"><div><h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">支払い照合</h1><p class="mt-2 text-sm text-gray-600 dark:text-gray-400">明細から購入・会社・T番号の根拠へ。候補を確認して、支払いを配分します。</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-primary" data-bank-import-open @click="importing=!importing">銀行のExcel・CSVを取込</button><button class="btn btn-secondary" data-bank-connections-open @click="connections=!connections">銀行口座の接続・自動取得</button></div></header>
    <BankStatementImporter v-if="importing" :file-id="importFileId" @imported="load" @close="importing=false" />
    <BankConnections v-if="connections" @map="openFile" @changed="load" @close="connections=false" />
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <section class="card flex flex-wrap gap-3 p-4"><label class="text-sm">口座<select v-model="filters.account" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" data-payment-account @change="load"><option value="">すべて</option><option v-for="a in data.accounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></label><label class="text-sm">状態<select v-model="filters.state" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" @change="load"><option value="all">すべて</option><option value="unmatched">未照合</option><option value="partial">一部配分</option><option value="matched">照合済み</option><option value="review">要確認</option></select></label><label class="text-sm">開始<input v-model="filters.from" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" type="date" data-payment-from @change="load"></label><label class="text-sm">終了<input v-model="filters.to" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" type="date" data-payment-to @change="load"></label><button class="btn btn-secondary self-end" :disabled="busy" @click="load">更新</button></section>
    <div class="flex flex-wrap gap-2" role="tablist" aria-label="照合の表示"><button v-for="t in TABS" :key="t[0]" type="button" role="tab" class="inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-main" :class="tab===t[0]?'bg-primary-main/10 text-primary-main dark:bg-primary-main/20 dark:text-primary-light':'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100'" :aria-selected="tab===t[0]" :data-review-tab="t[0]" @click="tab=t[0]">{{ t[1] }}</button></div>
    <section v-if="tab==='purchases'" class="card divide-y divide-gray-100 dark:divide-gray-700" data-purchase-list>
      <div class="flex flex-wrap items-end gap-3 p-4"><label class="text-sm">支払状況<select v-model="purchaseFilters.paymentState" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" data-purchase-payment-state @change="loadPurchases"><option value="all">すべて</option><option v-for="s in PAYMENT_STATES" :key="s" :value="s">{{ purchasePaymentName(s) }}</option></select></label><label class="text-sm">購入状況<select v-model="purchaseFilters.purchaseState" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" data-purchase-state @change="loadPurchases"><option value="all">すべて</option><option v-for="s in STATES" :key="s" :value="s">{{ STATE_NAMES[s] }}</option><option value="archived">アーカイブ済み</option></select></label>
        <p class="w-full text-xs leading-relaxed text-gray-500">購入日が開始〜終了の範囲にある購入と、購入日が未確定の購入を表示します。口座の絞り込みは明細だけに使われ、まだ支払いのない購入も表示されます。金額は購入ごと・通貨ごとに表示し、合計は計算しません。</p><p class="w-full break-words text-xs text-gray-500" data-purchase-counts>{{ purchaseCounts }}</p></div>
      <p v-if="!purchases.rows.length" class="p-6 text-sm text-gray-500">この条件の購入はありません。</p>
      <div v-for="r in purchases.rows" :key="r.id" class="flex min-w-0 flex-wrap items-start justify-between gap-3 p-4" :data-purchase-record="r.id">
        <div class="min-w-0 flex-1"><p class="text-xs text-gray-500"><span v-if="r.dateKnown">{{ r.purchaseDate }}</span><span v-else class="text-amber-700 dark:text-amber-300" data-purchase-undated>日付未確定<span v-if="r.rawDate" class="break-all">（{{ r.rawDate }}）</span></span> · {{ r.archived ? 'アーカイブ済み' : (STATE_NAMES as Record<string,string>)[r.purchaseState] || r.purchaseState }}</p><NuxtLink :to="'/intake/'+r.id" class="mt-1 block break-words font-medium text-primary-main dark:text-primary-light" data-purchase-open>{{ r.values.description || r.values.externalOrderId || r.values.orderId || '購入受付' }}</NuxtLink><p class="mt-1 break-words text-xs text-gray-500">{{ r.values.orderId || '注文ID未記載' }} · {{ r.evidence?.supplierName || '会社未確認' }} · {{ r.evidence?.invoiceNumber || 'T番号未確認' }}<span v-if="r.evidence?.origin && r.evidence.origin!=='none'" data-purchase-evidence-origin> · {{ ORIGIN_SHORT[r.evidence.origin] || r.evidence.origin }}</span><span v-if="r.evidence?.differs?.length" class="text-amber-700 dark:text-amber-300" data-purchase-evidence-changed> · 調査後に変更あり：{{ r.evidence.differs.map(differName).join('・') }}<span v-if="r.evidence.registryBasis && !r.evidence.registryBasis.current">（国税庁照合の基準日 {{ r.evidence.registryBasis.asOf }}）</span></span></p></div>
        <div class="w-full min-w-0 text-sm sm:w-auto sm:text-right"><p class="font-medium" :class="r.review || r.paymentState==='unknown' ? 'text-amber-700 dark:text-amber-300' : ''">{{ purchasePaymentName(r.paymentState) }}</p><p class="break-words text-xs text-gray-500">購入 {{ amount(r.total,r.currency) }} · 支払 {{ amount(r.paid,r.currency) }} · 返金 {{ amount(r.refunded,r.currency) }}</p><p class="text-xs text-gray-500">残額 {{ amount(r.remaining,r.currency) }}</p><p v-if="r.review" class="break-words text-xs text-amber-700 dark:text-amber-300" data-purchase-review>要確認：{{ reviewReasons(r) }}</p></div>
      </div>
    </section>
    <section v-else class="card divide-y divide-gray-100 dark:divide-gray-700" data-payment-list>
      <p v-if="!data.payments.length" class="p-6 text-sm text-gray-500">この条件の明細はありません。カード明細または銀行ファイルを取り込んでください。</p>
      <button v-for="p in data.payments" :key="p.paymentKey" class="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800" :data-payment-key="p.paymentKey" @click="selectPayment(p)">
        <span class="min-w-0 flex-1"><span class="block text-xs text-gray-500">{{ p.accountName }} · {{ p.date || '日付未記載' }}<span v-if="p.sourceKind==='repayment'"> · カード返済</span></span><span class="mt-1 block break-words font-medium">{{ p.description }}</span></span><span class="text-right text-sm"><span class="block">{{ cash(p.amount,p.currency) }}</span><span class="text-xs text-gray-500">{{ stateName(p.state) }} · 未配分 {{ cash(p.remaining,p.currency) }}</span></span>
      </button>
    </section>
    <div v-if="selected && tab==='payments'" ref="detailHost" tabindex="-1" class="scroll-mt-24 space-y-3 focus:outline-none"><button class="text-sm text-primary-main dark:text-primary-light" @click="selected=null">詳細を閉じる</button><IntakePaymentMatches :key="selected.paymentKey+':'+detailVersion" side="payment" :endpoint="selected.endpoint" @changed="load" @ready="scrollDetails" /></div>
    <p class="text-xs leading-relaxed text-gray-500">カードの個別購入と銀行からのカード返済を分けて管理します。照合結果から仕訳・振込・カレンダーの支払状況は変更されません。</p>
  </div>
</template>
<script setup lang="ts">
import BankStatementImporter from '~/components/intake/BankStatementImporter.vue'
import BankConnections from '~/components/intake/BankConnections.vue'
import IntakePaymentMatches from '~/components/intake/IntakePaymentMatches.vue'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { STATES, STATE_NAMES } from '~/shared/finance-intake.mjs'
import { PURCHASE_PAYMENT_STATES } from '~/shared/finance-payment-match.mjs'
definePageMeta({middleware:'auth'})
useHead({title:'支払い照合 | OhMyFinance'})
const user=useUserStore(),data=ref<any>({payments:[],accounts:[]}),selected=ref<any>(null),importing=ref(false),connections=ref(false),importFileId=ref(''),busy=ref(false),error=ref(''),filters=reactive({account:'',state:'all',from:'',to:''})
const assistant=useAssistantStore(),selectionPath=useRoute().path
onBeforeUnmount(()=>{if(assistant.pageSelection?.path===selectionPath&&assistant.pageSelection?.paymentKind)assistant.pageSelection=null})
// A capture the owner wants to map (needs_review, or any retained file) opens the importer on that file: the picker lane.
function openFile(id:string){importFileId.value=id;importing.value=true}
const detailHost=ref<HTMLElement|null>(null)
function selectPayment(p:any){selected.value=p}
async function scrollDetails(){await nextTick();detailHost.value?.focus({preventScroll:true});detailHost.value?.scrollIntoView({block:'start'})}
const cash=(n:number,c:string)=>Number(n).toLocaleString('ja-JP')+' '+c
const stateName=(v:string)=>({unmatched:'未照合',partial:'一部配分',matched:'照合済み',review:'要確認'} as Record<string,string>)[v]||v
async function load(){busy.value=true;error.value='';try{data.value=await $fetch('/api/finance-payments/payments',{headers:user.authHeader,query:filters});await loadPurchases()}catch(e:any){error.value=e.data?.data?.message||e.message}finally{busy.value=false}}
// A Navi allocation receipt (assigned card) reloads the list; the open detail is refetched only when it is that same charge. The
// source-file view and the current-balance distinction of the page are unchanged.
const detailVersion=ref(0)
watch(()=>assistant.ownerNativeSequence,async()=>{const r=assistant.ownerNative;if(!r||r.kind!=='allocation'||String(r.actorId)!==String(user.user?.id||''))return;await load();if(selected.value?.kind==='card'&&String(selected.value.importId)===String(r.importId)&&Number(selected.value.line)===Number(r.line))detailVersion.value++})
// F2 (plan omf-monthly-reconciliation-20261020): the period's purchases and their payment state. Same 開始/終了 as the payments, never
// the account filter (an unpaid purchase has no account yet). Amounts are per purchase and currency; an unknown total stays 金額未確定.
const TABS=[['payments','明細'],['purchases','購入（期間内）']] as const,PAYMENT_STATES=PURCHASE_PAYMENT_STATES
const tab=ref<string>('payments'),purchases=ref<any>({rows:[],counts:{},undated:0}),purchaseFilters=reactive({paymentState:'all',purchaseState:'all'})
// Navi sees the selected payment only while its detail is visible (明細). On 購入（期間内） a new message carries no payment selection;
// `selected` stays so returning to 明細 restores the detail and its selection. A turn already sent keeps its own frozen target.
watch([selected,tab],([p,t])=>{assistant.pageSelection=p&&t==='payments'?{path:selectionPath,paymentKind:p.kind,...(p.kind==='card'?{paymentImportId:p.importId,paymentLine:p.line}:{}),label:p.kind==='card'?p.description:'銀行明細'}:null})
// F4 fold: 調査後に変更あり only for a real difference from what the research supported, naming it (and the registry 基準日).
const differName=(f:string)=>({merchantUrl:'URL',supplierName:'会社名',invoiceNumber:'T番号',purchaseDate:'購入日'} as Record<string,string>)[f]||f
const ORIGIN_SHORT:Record<string,string>={'research-confirmed':'調査で確認済み','file-manual':'取込・手入力（調査で未確認）',candidate:'調査候補（未保存）'}
const amount=(n:any,c:string)=>n===null||n===undefined?'金額未確定':Number(n).toLocaleString('ja-JP')+' '+c
const purchasePaymentName=(v:string)=>({unknown:'金額不明',unpaid:'未払い',partial:'一部支払い',settled:'支払済み',overpaid:'過払い'} as Record<string,string>)[v]||v
const reviewReasons=(r:any)=>[r.paymentState==='overpaid'?'過払い':'',r.otherCurrency?'他通貨の支払い（残額に含めていません）':'',r.identityReview?'IDの対応':'',r.paymentChanged?'配分後に購入・明細が変更':''].filter(Boolean).join('・')
const purchaseCounts=computed(()=>[...PAYMENT_STATES.map(s=>purchasePaymentName(s)+' '+(purchases.value.counts?.[s]||0)+'件'),'日付未確定 '+(purchases.value.undated||0)+'件'].join(' · '))
async function loadPurchases(){try{purchases.value=await $fetch('/api/finance-payments/records',{headers:user.authHeader,query:{from:filters.from,to:filters.to,paymentState:purchaseFilters.paymentState,purchaseState:purchaseFilters.purchaseState}})}catch(e:any){error.value=e.data?.data?.message||e.message}}
onMounted(load)
</script>

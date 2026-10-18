<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4"><div><h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">支払い照合</h1><p class="mt-2 text-sm text-gray-600 dark:text-gray-400">明細から購入・会社・T番号の根拠へ。候補を確認して、支払いを配分します。</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-primary" data-bank-import-open @click="importing=!importing">銀行のExcel・CSVを取込</button><button class="btn btn-secondary" data-bank-connections-open @click="connections=!connections">銀行口座の接続・自動取得</button></div></header>
    <BankStatementImporter v-if="importing" :file-id="importFileId" @imported="load" @close="importing=false" />
    <BankConnections v-if="connections" @map="openFile" @changed="load" @close="connections=false" />
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <section class="card flex flex-wrap gap-3 p-4"><label class="text-sm">口座<select v-model="filters.account" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" data-payment-account @change="load"><option value="">すべて</option><option v-for="a in data.accounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></label><label class="text-sm">状態<select v-model="filters.state" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" @change="load"><option value="all">すべて</option><option value="unmatched">未照合</option><option value="partial">一部配分</option><option value="matched">照合済み</option><option value="review">要確認</option></select></label><label class="text-sm">開始<input v-model="filters.from" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" type="date" @change="load"></label><label class="text-sm">終了<input v-model="filters.to" class="input max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white mt-1" type="date" @change="load"></label><button class="btn btn-secondary self-end" :disabled="busy" @click="load">更新</button></section>
    <section class="card divide-y divide-gray-100 dark:divide-gray-700" data-payment-list>
      <p v-if="!data.payments.length" class="p-6 text-sm text-gray-500">この条件の明細はありません。カード明細または銀行ファイルを取り込んでください。</p>
      <button v-for="p in data.payments" :key="p.paymentKey" class="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800" :data-payment-key="p.paymentKey" @click="selectPayment(p)">
        <span class="min-w-0 flex-1"><span class="block text-xs text-gray-500">{{ p.accountName }} · {{ p.date || '日付未記載' }}<span v-if="p.sourceKind==='repayment'"> · カード返済</span></span><span class="mt-1 block break-words font-medium">{{ p.description }}</span></span><span class="text-right text-sm"><span class="block">{{ cash(p.amount,p.currency) }}</span><span class="text-xs text-gray-500">{{ stateName(p.state) }} · 未配分 {{ cash(p.remaining,p.currency) }}</span></span>
      </button>
    </section>
    <div v-if="selected" ref="detailHost" tabindex="-1" class="scroll-mt-24 space-y-3 focus:outline-none"><button class="text-sm text-primary-main dark:text-primary-light" @click="selected=null">詳細を閉じる</button><IntakePaymentMatches :key="selected.paymentKey" side="payment" :endpoint="selected.endpoint" @changed="load" @ready="scrollDetails" /></div>
    <p class="text-xs leading-relaxed text-gray-500">カードの個別購入と銀行からのカード返済を分けて管理します。照合結果から仕訳・振込・カレンダーの支払状況は変更されません。</p>
  </div>
</template>
<script setup lang="ts">
import BankStatementImporter from '~/components/intake/BankStatementImporter.vue'
import BankConnections from '~/components/intake/BankConnections.vue'
import IntakePaymentMatches from '~/components/intake/IntakePaymentMatches.vue'
import { useUserStore } from '~/stores/user'
definePageMeta({middleware:'auth'})
useHead({title:'支払い照合 | OhMyFinance'})
const user=useUserStore(),data=ref<any>({payments:[],accounts:[]}),selected=ref<any>(null),importing=ref(false),connections=ref(false),importFileId=ref(''),busy=ref(false),error=ref(''),filters=reactive({account:'',state:'all',from:'',to:''})
// A capture the owner wants to map (needs_review, or any retained file) opens the importer on that file: the picker lane.
function openFile(id:string){importFileId.value=id;importing.value=true}
const detailHost=ref<HTMLElement|null>(null)
function selectPayment(p:any){selected.value=p}
async function scrollDetails(){await nextTick();detailHost.value?.focus({preventScroll:true});detailHost.value?.scrollIntoView({block:'start'})}
const cash=(n:number,c:string)=>Number(n).toLocaleString('ja-JP')+' '+c
const stateName=(v:string)=>({unmatched:'未照合',partial:'一部配分',matched:'照合済み',review:'要確認'} as Record<string,string>)[v]||v
async function load(){busy.value=true;error.value='';try{data.value=await $fetch('/api/finance-payments/payments',{headers:user.authHeader,query:filters})}catch(e:any){error.value=e.data?.data?.message||e.message}finally{busy.value=false}}
onMounted(load)
</script>

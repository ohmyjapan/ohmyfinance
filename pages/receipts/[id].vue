<template>
 <div data-receipt-evidence-page>
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
   <div class="flex min-w-0 items-center gap-3">
    <NuxtLink to="/receipts" aria-label="領収書一覧に戻る" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><ArrowLeft class="h-5 w-5" /></NuxtLink>
    <div class="min-w-0"><h1 class="text-xl font-semibold text-gray-800 dark:text-white">領収書の確認</h1><p class="mt-1 text-sm text-gray-500">保存された明細と取引候補を見比べます</p></div>
   </div>
   <button v-if="evidence" type="button" data-receipt-discuss class="btn btn-primary inline-flex items-center gap-2 text-sm" @click="assistant.show({kind:'workspace'})"><MessageCircle class="h-4 w-4" />この領収書をNaviに相談</button>
  </div>

  <div v-if="loading" role="status" class="flex items-center justify-center gap-3 py-16 text-sm text-gray-500"><Loader2 class="h-5 w-5 animate-spin" />領収書を読み込んでいます…</div>
  <div v-else-if="error" data-receipt-error role="alert" class="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5"><p class="text-sm text-gray-600 dark:text-gray-300">{{ error }}</p><button type="button" class="mt-3 text-sm text-primary-main underline" @click="load">再読み込み</button></div>

  <template v-else-if="evidence">
   <section data-receipt-summary class="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
    <div class="mb-5 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs text-gray-500">保存された領収書</p><h2 class="mt-1 break-words text-lg font-semibold text-gray-800 dark:text-white">{{ evidence.receipt.merchant || '店名未記録' }}</h2></div><span class="rounded-lg bg-primary-main/10 px-3 py-1 text-xs text-primary-main">{{ statusLabel(evidence.receipt.status) }}</span></div>
    <dl class="grid grid-cols-2 gap-5 sm:grid-cols-4">
     <div><dt class="text-xs text-gray-500">金額</dt><dd data-receipt-amount class="mt-1 break-words text-xl font-semibold text-gray-900 dark:text-white">{{ money(evidence.receipt.amount,evidence.receipt.currency) }}</dd></div>
     <div><dt class="text-xs text-gray-500">領収書の日付（日本時間）</dt><dd class="mt-1 text-sm text-gray-800 dark:text-gray-100">{{ date(evidence.receipt.receiptDate) }}</dd></div>
     <div><dt class="text-xs text-gray-500">保存された税額</dt><dd class="mt-1 text-sm text-gray-800 dark:text-gray-100">{{ money(evidence.receipt.taxAmount,evidence.receipt.currency) }}</dd></div>
     <div><dt class="text-xs text-gray-500">保存された税率</dt><dd class="mt-1 text-sm text-gray-800 dark:text-gray-100">{{ evidence.receipt.taxRate == null ? '未記録' : evidence.receipt.taxRate+'%' }}</dd></div>
    </dl>
    <p class="mt-5 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500 dark:border-white/10">保存データ・OCRの読み取り結果です。購入内容、税の扱い、インボイスの要件を確認した結果ではありません。</p>
    <NuxtLink v-if="evidence.receipt.linkedTransactionId" :to="'/transactions/'+evidence.receipt.linkedTransactionId" data-receipt-existing-link class="mt-3 inline-flex text-sm text-primary-main underline">紐付け済みの取引を開く ↗</NuxtLink>
    <p v-else class="mt-3 text-xs text-gray-500">{{ evidence.receipt.linkStatus==='link_not_in_this_company' ? '選択中の会社で確認できる紐付けはありません。' : '取引はまだ紐付けられていません。' }}</p>
    <p v-if="evidence.receipt.linkSync==='pending'" data-receipt-sync="pending" role="status" class="mt-2 text-xs text-gray-500">取引の領収書表示を自動で反映しています。</p>
    <div v-else-if="evidence.receipt.linkSync==='manual_review'" data-receipt-sync="manual_review" role="alert" class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><p>{{ evidence.receipt.linkSyncReason==='transaction_missing' ? '紐付け先の取引がこの会社で見つかりません。紐付けを解除してください。' : '取引の領収書表示を反映できませんでした。もう一度お試しください。' }}</p><button type="button" data-receipt-sync-action class="mt-2 text-primary-main underline" :disabled="syncBusy" @click="resolveSync">{{ syncRetries ? '反映をやり直す' : '紐付けを解除' }}</button><p v-if="syncError" class="mt-1">{{ syncError }}</p></div>
   </section>

   <section class="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
    <h2 class="text-sm font-semibold text-gray-800 dark:text-white">読み取った明細</h2>
    <ul v-if="evidence.receipt.extracted?.items?.length" data-receipt-items class="mt-4 divide-y divide-gray-100 dark:divide-white/10"><li v-for="(item,index) in evidence.receipt.extracted.items" :key="index" class="flex flex-wrap justify-between gap-2 py-3 text-sm"><div class="min-w-0 flex-1"><p class="break-words text-gray-800 dark:text-gray-100">{{ item.description || '品目名未記録' }}</p><p v-if="item.sku" class="mt-1 break-all text-xs text-gray-500">商品コード: {{ item.sku }}</p><p class="mt-1 text-xs text-gray-500">数量 {{ item.quantity ?? '未記録' }}</p></div><p class="text-gray-700 dark:text-gray-200">{{ money(item.totalPrice,evidence.receipt.extracted.currency || evidence.receipt.currency) }}</p></li></ul>
    <p v-else class="mt-3 text-sm text-gray-500">明細は保存されていません。</p>
    <p v-if="evidence.receipt.extracted?.itemsTruncated" class="mt-2 text-xs text-gray-500">明細は一部を表示しています。</p>
   </section>

   <section data-receipt-candidates>
    <div class="mb-4"><h2 class="text-base font-semibold text-gray-800 dark:text-white">取引の候補 <span class="ml-1 text-sm font-normal text-gray-500">{{ evidence.matches.length }}件</span></h2><p class="mt-2 max-w-3xl text-xs leading-relaxed text-gray-500">日付や金額などから探した候補です。全件を調べた結果ではなく、点数も一致の確率ではありません。商品コードや注文の記録とあわせて確認します。この画面を開くだけでは紐付けられません。</p></div>
    <p v-if="!evidence.matches.length" class="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-white/10 dark:bg-white/5">候補は見つかりませんでした。対応する取引が存在しないと確認できたわけではありません。</p>
    <div v-else class="grid gap-4 lg:grid-cols-2"><article v-for="match in evidence.matches" :key="match.transaction.id" data-receipt-candidate class="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
     <div class="flex flex-wrap items-start justify-between gap-2"><div class="min-w-0 flex-1"><h3 class="break-words text-sm font-semibold text-gray-800 dark:text-white">{{ match.transaction.productName || match.transaction.companyInfo || '商品名未記録' }}</h3><p class="mt-1 text-xs text-gray-500">{{ date(match.transaction.date) }} · {{ money(match.transaction.amount,match.transaction.currency) }}</p></div><span class="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">照合点数 {{ match.heuristicScore }}/100</span></div>
     <p v-if="match.transaction.currency && evidence.receipt.currency && match.transaction.currency!==evidence.receipt.currency" class="mt-3 text-xs text-amber-700 dark:text-amber-400">領収書と記録の通貨が異なります。</p>
     <ul class="mt-3 space-y-1 text-xs text-gray-500"><li v-for="factor in match.factors" :key="factor">{{ factorLabel(factor) }}</li></ul>
     <ul v-if="match.transaction.items?.length" class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600 dark:border-white/10 dark:text-gray-300"><li v-for="(item,index) in match.transaction.items" :key="index" class="mb-2 break-words">{{ item.productName || '品目名未記録' }}<span v-if="item.janCode" class="mt-1 block break-all text-gray-500">JAN {{ item.janCode }}</span></li></ul>
     <NuxtLink :to="'/transactions/'+match.transaction.id" data-receipt-candidate-link class="mt-4 inline-flex text-sm text-primary-main underline">候補の取引を開く ↗</NuxtLink>
    </article></div>
   </section>
  </template>
 </div>
</template>
<script setup lang="ts">
import {ArrowLeft,Loader2,MessageCircle} from 'lucide-vue-next'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {tokenClaims} from '~/utils/auth-session'
import {currencyCode} from '~/shared/finance-navi-business.mjs'
const route=useRoute(),user=useUserStore(),assistant=useAssistantStore()
const evidence=ref<any>(null),loading=ref(false),error=ref(''),syncBusy=ref(false),syncError=ref('')
const scope=computed(()=>{const c=tokenClaims(user.token);return JSON.stringify([c?.userId||'',c?.organizationId||''])})
let generation=0
const statuses:Record<string,string>={matched:'紐付け済み',unmatched:'未紐付け',processing:'読み取り中',error:'読み取りエラー'}
const statusLabel=(value:string)=>statuses[value]||'状態未記録'
const money=(value:unknown,currency:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value))return '未記録';const code=currencyCode(currency);return code?new Intl.NumberFormat('ja-JP',{style:'currency',currency:code}).format(value):value.toLocaleString('ja-JP')+'（通貨未記録）'}
const date=(value:unknown)=>{const d=typeof value==='string'?new Date(value):null;return d&&Number.isFinite(d.getTime())?d.toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'}):'未記録'}
const factors:Record<string,string>={'Exact amount match':'金額が一致','Amount within 1%':'金額の差が1%未満','Amount within 5%':'金額の差が5%未満','Amount within 10%':'金額の差が10%未満','Same day':'同じ日付','Within 1 day':'日付の差が1日以内','Within 3 days':'日付の差が3日以内','Within 1 week':'日付の差が1週間以内','Strong name match':'名前の類似度が高い','Partial name match':'名前が一部一致','Weak name match':'名前に類似部分あり','Same currency':'保存された通貨が一致'}
const factorLabel=(value:string)=>factors[value]||value
async function load(){
 const current=++generation,key=scope.value,receiptId=String(route.params.id||'')
 evidence.value=null;error.value='';loading.value=false
 const claims=tokenClaims(user.token)
 if(!claims?.userId||!claims.organizationId){error.value='会社を選択して領収書を開いてください。';return}
 if(!/^[a-f0-9]{24}$/i.test(receiptId)){error.value='領収書を確認できませんでした。';return}
 loading.value=true
 // Session acceptance sets the new token before its session id. Clear synchronously, then let that same update finish before
 // the session-aware fetch captures its identity. The existing generation/scope checks still discard any superseded result.
 await nextTick()
 if(current!==generation||key!==scope.value)return
 try{const data=await $fetch('/api/receipts/'+receiptId+'/evidence',{headers:user.authHeader});if(current===generation&&key===scope.value)evidence.value=data}
 catch(e:any){if(current===generation&&key===scope.value)error.value=e.statusCode===404?'この会社で領収書を確認できませんでした。':e.statusCode===403||e.statusCode===401?'この会社の閲覧権限を確認できませんでした。':'領収書を読み込めませんでした。もう一度お試しください。'}
 finally{if(current===generation)loading.value=false}
}
// The successor of a receipt whose badge needs the person: the same explicit link again (re-checks the badge) or, when its transaction
// is gone or it is not linked, the unlink. Fixed company-safe texts; the page reloads the server state afterwards.
const syncRetries=computed(()=>!!evidence.value?.receipt?.linkedTransactionId&&evidence.value.receipt.linkSyncReason!=='transaction_missing')
async function resolveSync(){const r=evidence.value?.receipt,key=scope.value;if(!r||syncBusy.value)return;const retry=syncRetries.value;syncBusy.value=true;syncError.value=''
 try{await ('/api/receipts/'+r.id+'/match',{method:retry?'POST':'DELETE',headers:user.authHeader,...(retry?{body:{transactionId:r.linkedTransactionId}}:{})});if(key===scope.value)await load()}
 catch(e:any){if(key===scope.value)syncError.value=e.statusCode===409?'領収書が更新されました。再読み込みしてからお試しください。':[401,403].includes(e.statusCode)?'この会社の権限を確認できませんでした。':'もう一度お試しください。'}
 finally{syncBusy.value=false}
}
watch([()=>route.params.id,scope],load,{immediate:true,flush:'sync'})
// A done Navi receipt link/unlink of this same receipt, actor and company reloads it (other actors/companies are ignored).
watch(()=>assistant.companyResourceSequence,()=>{const saved=assistant.companyResource,c=tokenClaims(user.token);if(saved&&saved.actorId===c?.userId&&saved.organizationId===c?.organizationId&&saved.kinds.includes('receipt')&&saved.id===String(route.params.id||''))load()})
onBeforeUnmount(()=>{generation++})
</script>

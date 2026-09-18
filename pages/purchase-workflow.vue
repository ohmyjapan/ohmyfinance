<template>
 <div data-workflow-page>
  <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
   <div><h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">購入・輸出の照合</h1><p class="mt-1 text-sm text-gray-500 dark:text-gray-400">購入記録、在庫、出荷、輸出書類をつなぎ、残っている確認事項を整理します。</p></div>
   <NuxtLink to="/mapping" class="btn btn-secondary text-sm">明細マッピング</NuxtLink>
  </header>
  <p v-if="error" role="alert" class="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{{ error }}</p>
  <p v-if="message" role="status" class="mb-4 rounded-xl bg-green-50 p-4 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300">{{ message }}</p>
  <div v-if="loading" class="card p-8 text-sm text-gray-500" role="status">照合状況を読み込んでいます…</div>
  <template v-else-if="data">
   <section class="card mb-6 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">夜間処理</h2><p class="mt-1 text-xs text-gray-500">毎日 00:00 · 日本時間 · 未完了の工程から再開</p></div><span class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ data.config?.enabled ? '有効' : '停止中' }}</span></div>
    <p class="mt-3 text-xs text-gray-500">{{ lastRunText }}<span v-if="data.config?.workerSeenAt"> · 調査端末の最終通信 {{ time(data.config.workerSeenAt) }}</span></p>
    <p v-if="data.config?.workerSeenAt && !data.config.workerCapabilities?.includes('receipt_jan')" class="mt-2 text-xs text-amber-700 dark:text-amber-300">JANの商品検索は未接続です。JANのある商品と、その後の残り商品の推定は確認待ちになります。</p>
    <details class="mt-4"><summary class="cursor-pointer text-xs font-medium text-primary-main">対象期間・接続の設定</summary>
     <form class="mt-4 space-y-4" @submit.prevent="saveSettings">
      <div class="grid gap-3 sm:grid-cols-2"><label class="text-xs text-gray-600 dark:text-gray-300">開始日<input v-model="settings.from" type="date" required class="workflow-control mt-1"></label><label class="text-xs text-gray-600 dark:text-gray-300">終了日<input v-model="settings.through" type="date" required class="workflow-control mt-1"></label></div>
      <fieldset><legend class="mb-2 text-xs text-gray-600 dark:text-gray-300">対象口座</legend><label v-for="account in data.accounts" :key="account.id" class="mr-4 inline-flex items-center gap-2 py-2 text-sm"><input v-model="settings.accountIds" type="checkbox" :value="account.id" class="rounded border-gray-300 text-primary-main">{{ account.name }}</label></fieldset>
      <label class="block text-xs text-gray-600 dark:text-gray-300">調査接続<select v-model="settings.workerId" class="workflow-control mt-1"><option value="">接続を選択</option><option v-for="(worker,index) in data.workers" :key="worker.id" :value="worker.id">調査接続 {{ index + 1 }} · {{ worker.accountIds.length }}口座 · {{ worker.lastSeenAt ? time(worker.lastSeenAt) : '通信待ち' }}</option></select></label>
      <label class="flex items-start gap-2 text-sm"><input v-model="settings.enabled" type="checkbox" class="mt-1 rounded border-gray-300 text-primary-main">毎日深夜に照合する</label>
      <p class="text-xs text-gray-500">有効にした翌日の00:00から開始します。保存済み資料の確認は下のボタンから実行できます。</p>
      <button class="btn btn-primary text-sm disabled:opacity-50" :disabled="busy || !settings.accountIds.length">設定を保存</button>
     </form>
    </details>
    <div class="mt-4 flex flex-wrap gap-3"><button type="button" class="btn btn-secondary text-xs disabled:opacity-50" :disabled="busy || !settings.accountIds.length" @click="refreshEvidence">保存済み資料から進捗を更新</button><button type="button" class="text-xs text-primary-main underline" :disabled="busy" @click="load">表示を再読込</button></div>
    <p class="mt-2 text-xs text-gray-500">進捗の更新では外部資料を取得せず、失敗回数も増やしません。</p>
   </section>
   <nav class="mb-5 flex flex-wrap gap-2" aria-label="進捗の絞り込み"><button v-for="filter in filters" :key="filter.key" type="button" class="min-h-10 rounded-lg px-3 py-2 text-xs font-medium" :class="selected===filter.key?'bg-primary-main/10 text-primary-main':'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300'" :aria-pressed="selected===filter.key" @click="selected=filter.key;limit=30">{{ filter.label }} · {{ count(filter.key) }}</button></nav>
   <p v-if="!filtered.length" class="card p-6 text-sm text-gray-500">{{ data.rows.length ? 'この条件の確認事項はありません。' : '対象期間・口座を設定して、保存済み資料から進捗を更新してください。' }}</p>
   <article v-for="row in filtered.slice(0,limit)" :key="row.id" class="card mb-4 p-4 sm:p-6" data-workflow-row>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs text-gray-500">{{ row.payment.date }} · {{ row.payment.accountName }}</p><NuxtLink :to="'/mapping-draft/'+row.importId+'/'+row.line" class="mt-1 block break-words text-sm font-semibold text-primary-main">{{ row.payment.merchant }}</NuxtLink></div><p class="text-sm font-semibold tabular-nums">{{ yen(row.payment.amount) }}</p></div>
    <WorkflowStages :steps="row.steps" />
    <WorkflowInvestigation :workflow-id="row.id" :purchase-id="row.purchaseId" @changed="refreshEvidence" />
    <details class="mt-4"><summary class="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">確認事項と照合履歴</summary>
     <div v-for="[key,step] in openSteps(row)" :key="key" class="mt-3 rounded-lg border border-gray-200 p-3 text-xs dark:border-white/10">
      <p class="font-medium">{{ stageNames[step.stage] }} · {{ unitLabel(step.unit) }}</p><p class="mt-1 text-gray-600 dark:text-gray-300">{{ reasons[step.reason] || step.reason }}</p>
      <p v-if="step.suggestion" class="mt-2 whitespace-pre-wrap leading-relaxed text-gray-600 dark:text-gray-300">{{ step.suggestion }}</p>
      <p class="mt-2 text-gray-500">未解決の夜間照合 {{ step.failedNights }} / 10回<span v-if="step.lifetimeFailedNights > step.failedNights"> · 累計 {{ step.lifetimeFailedNights }}回</span><span v-if="step.snoozedUntil"> · 保留 {{ step.snoozedUntil }}まで</span></p>
      <div v-if="reviewKey!==row.id+':'+key" class="mt-3 flex flex-wrap gap-4"><button type="button" class="text-primary-main underline" :disabled="busy" @click="startReview(row,key,'retry')">確認して再試行</button><button type="button" class="text-gray-500 underline" :disabled="busy" @click="startReview(row,key,'snooze')">日付を指定して保留</button><NuxtLink :to="'/mapping-draft/'+row.importId+'/'+row.line" class="text-primary-main underline">明細と資料を開く</NuxtLink></div>
      <form v-else class="mt-3 space-y-3" @submit.prevent="saveReview(row,key)"><label class="block">確認内容・理由<textarea v-model="review.reason" rows="2" required maxlength="1000" class="workflow-control mt-1" /></label><label v-if="review.action==='snooze'" class="block">再確認日<input v-model="review.until" type="date" required class="workflow-control mt-1"></label><div class="flex gap-3"><button class="btn btn-primary text-xs" :disabled="busy">保存</button><button type="button" class="text-gray-500 underline" :disabled="busy" @click="reviewKey=''">キャンセル</button></div></form>
     </div>
     <p v-for="reminder in row.summary.reminders" :key="reminder.unit" class="mt-3 text-xs text-amber-700">{{ unitLabel(reminder.unit) }} · 出荷記録の照合待ちが30日以上続いています。</p>
     <div v-if="row.events.length" class="mt-3 border-t border-gray-100 pt-2 dark:border-white/10"><p v-for="event in row.events.slice(-5).reverse()" :key="event.id" class="mt-1 text-xs text-gray-500">{{ time(event.at) }} · {{ eventLabel(event.action) }}<span v-if="event.reason"> · {{ event.reason }}</span></p></div>
    </details>
   </article>
   <button v-if="filtered.length>limit" type="button" class="btn btn-secondary mb-6 text-sm" @click="limit+=30">さらに表示</button>
  </template>
 </div>
</template>

<script setup lang="ts">
import {useUserStore} from '~/stores/user'
import {WORKFLOW_REASONS} from '~/shared/finance-workflow.mjs'
import WorkflowStages from '~/components/finance/WorkflowStages.vue'
import WorkflowInvestigation from '~/components/finance/WorkflowInvestigation.vue'
definePageMeta({middleware:'auth'})
useHead({title:'購入・輸出の照合 | OhMyFinance'})
const user=useUserStore(),route=useRoute(),data=ref<any>(null),loading=ref(true),busy=ref(false),error=ref(''),message=ref(''),selected=ref('all'),limit=ref(30),reviewKey=ref('')
const now=new Date(),year=now.getMonth()>=10?now.getFullYear():now.getFullYear()-1
const settings=reactive({from:year+'-11-01',through:(year+1)+'-10-31',accountIds:[] as string[],workerId:'',enabled:false})
const review=reactive({action:'retry',reason:'',until:''}),reasons:Record<string,string>=WORKFLOW_REASONS
const stageNames:Record<string,string>={purchase:'購入記録',inventory:'在庫',shipment:'出荷',documents:'輸出書類'}
const filters=[{key:'all',label:'すべて'},{key:'manual_review',label:'要確認'},{key:'connection_required',label:'接続待ち'},{key:'waiting',label:'資料待ち'},{key:'partial',label:'一部完了'},{key:'complete',label:'完了'},{key:'not_applicable',label:'対象外'}]
const count=(state:string)=>data.value?.rows.filter((r:any)=>state==='all'||r.summary.state===state).length||0
const filtered=computed(()=>data.value?.rows.filter((r:any)=>selected.value==='all'||r.summary.state===selected.value)||[])
const openSteps=(row:any)=>Object.entries(row.steps).filter(([,s]:any)=>!['complete','not_applicable'].includes(s.state)) as [string,any][]
const unitLabel=(unit:string)=>unit==='purchase'?'購入全体':unit==='unknown_items'?'商品照合後に開始':unit.startsWith('remaining:item:')?'商品行 '+unit.split(':').at(-1)+' の未接続分':unit.startsWith('item:')?'商品行 '+unit.slice(5):unit
const yen=(v:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(v)
const time=(v:string)=>new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})
const eventLabel=(action:string)=>({saved_evidence_checked:'保存資料の接続を確認',source_checked:'外部資料を照合',retry:'確認後に再試行',snooze:'再確認日を設定'}[action]||action)
const lastRunText=computed(()=>data.value?.runs[0]?data.value.runs[0].day+' · '+({complete:'処理終了',working:'処理中',connection_required:'接続の確認が必要',interrupted:'中断・次回継続',budget_exhausted:'残りは次回継続',configuration_changed:'設定変更のため保留'}[data.value.runs[0].status]||'待機中'):'まだ夜間処理は実行されていません。')
const request=(path:string,options:any={})=>$fetch('/api/finance-workflow/'+path,{headers:user.authHeader,...options})
async function action(work:()=>Promise<void>){busy.value=true;error.value='';message.value='';try{await work()}catch(e:any){error.value=e.data?.data?.message||e.data?.statusMessage||'処理に失敗しました。再試行してください。'}finally{busy.value=false}}
async function load(){loading.value=true;await action(async()=>{data.value=await request('status',{query:{...(route.query.importId?{importId:route.query.importId}:{}),...(route.query.line?{line:route.query.line}:{})}});if(data.value.config){const c=data.value.config;Object.assign(settings,{from:c.from,through:c.through,accountIds:c.accountIds,workerId:c.workerId||'',enabled:c.enabled})}else settings.accountIds=data.value.accounts.map((a:any)=>a.id)});loading.value=false}
async function saveSettings(){await action(async()=>{data.value=await request('settings',{method:'PUT',body:{revision:data.value.config?.revision||0,...settings}});message.value='設定を保存しました。'})}
async function refreshEvidence(){await action(async()=>{const result:any=await request('refresh',{method:'POST',body:{from:settings.from,through:settings.through,accountIds:settings.accountIds}});data.value=await request('status',{query:{from:settings.from,through:settings.through}});message.value=result.assessed+'件の保存資料を確認しました。失敗回数は変更していません。'})}
function startReview(row:any,key:string,kind:string){reviewKey.value=row.id+':'+key;Object.assign(review,{action:kind,reason:'',until:''})}
async function saveReview(row:any,key:string){await action(async()=>{const updated:any=await request(row.id+'/review',{method:'POST',body:{revision:row.revision,step:key,...review}});const index=data.value.rows.findIndex((r:any)=>r.id===row.id);data.value.rows[index]=updated;reviewKey.value='';message.value='確認内容を保存しました。'})}
onMounted(load)
</script>
<style scoped>
.workflow-control{@apply block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100}
</style>

<template>
  <section class="card min-w-0 text-gray-800 dark:text-gray-100 space-y-5 p-4 md:p-6" data-bank-connections>
    <header class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">銀行口座の接続・自動取得</h2><button class="text-sm text-gray-500" @click="emit('close')">閉じる</button></header>
    <p class="text-sm leading-relaxed text-gray-500" data-bank-login-guidance>接続したPCのChromeで銀行サイトを開きます。取得手順を実装したログイン方式（楽天銀行とPayPay銀行の標準ログイン）は、指定した期間の入出金明細のCSVを自動で取得します。楽天銀行の標準ログインは、接続したPCのダウンローダーの設定画面にログインIDとパスワードを一度保存すると、取得のたびに自動でサインインし、ふだんは画面の裏で動きます（保存したログインは暗号化してそのPCにだけ置かれ、OMFには送られません）。銀行が追加の確認（認証コード・パスワード変更など）を求めたときや、保存していない・受け付けられなかったときは、同じChromeの画面が表示されるので本人が操作してください。それ以外の銀行・ログイン方式は「観察取得（準備）」として画面の手順を記録し、CSVが出力された場合のみ取り込みます。PayPay銀行の標準ログインは口座ごとに接続し、取得期間を保存します。接続したPCのダウンローダーの設定画面に口座ごとの店番号・口座番号・ログインパスワードを一度保存すると、取得のたびにそのPCのChromeで1回だけ自動でサインインし、普通預金取引明細照会で期間を選んでCSVを1回だけ出力し、最後にログアウトします。別の場所でログイン中のときや銀行が追加の確認を求めたときは、上書きせずに止めてお知らせします。テンプレートを選ばずに接続した口座は、最初に受信したCSVを列の割り当てが済むまで「要確認」として保存し、取引は取り込みません。同じ取引を含む明細をもう一度受信しても、取り込み済みの取引は重ねて登録されません。列の割り当て・符号・取得期間は予約時に固定され、あとで変えても過去の取得分は変わりません。手順が実装済みでも、実際の接続テストが成功するまでは確認済みではありません。</p>
    <p v-if="error" role="alert" class="break-words text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <div class="flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700" data-bank-account-new>
      <label class="min-w-0 text-sm">新しい銀行口座の名前<input v-model="newAccount.name" data-bank-account-new-name type="text" maxlength="100" placeholder="楽天銀行 普通" :class="INPUT"></label>
      <label class="min-w-0 text-sm">通貨<input v-model="newAccount.currency" data-bank-account-new-currency type="text" maxlength="3" :class="INPUT"></label>
      <button class="btn btn-secondary" :disabled="busy || !newAccount.name.trim()" data-bank-account-create @click="createAccount">口座を追加</button>
    </div>
    <p v-if="!accounts.length" class="text-sm text-gray-500">銀行口座がありません。上で口座を追加するか、「銀行のExcel・CSVを取込」で追加してください。</p>
    <article v-for="a in accounts" :key="a.id" class="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700" :data-bank-connection="a.id">
      <h3 class="font-medium">{{ a.name }}（{{ a.currency }}）</h3>
      <p class="break-words text-sm" data-bank-connection-state>{{ connectionText(a) }}</p>
      <div class="grid min-w-0 gap-3 md:grid-cols-3">
        <label class="min-w-0 text-sm">銀行<select v-model="forms[a.id].provider" data-bank-provider :class="INPUT"><option value="">選択してください</option><option v-for="[key,label,support] in BANK_PROVIDERS" :key="key" :value="key">{{ label }}（{{ providerSupportText(key, support) }}）</option></select></label>
        <label class="min-w-0 text-sm">テンプレート（列の割り当て）<select v-model="forms[a.id].templateId" data-bank-connection-template :class="INPUT"><option value="">{{ nativeOf(forms[a.id]) ? '自動（' + nativeOf(forms[a.id]).name + '）' : templateFreeOf(forms[a.id]) ? '未割り当て（初回の取得後に取込画面で割り当て）' : '選択してください' }}</option><option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label class="min-w-0 text-sm">口座の表示名（任意・一致確認用）<input v-model="forms[a.id].accountLabel" data-bank-account-label type="text" maxlength="100" placeholder="普通 1234567 ○○商事" :class="INPUT"></label>
        <label v-if="BANK_LOGIN_VARIANTS[forms[a.id].provider]" class="min-w-0 text-sm">ログイン方式<select v-model="forms[a.id].variant" data-bank-variant :class="INPUT"><option value="">選択してください</option><option v-for="[key,label] in BANK_LOGIN_VARIANTS[forms[a.id].provider]" :key="key" :value="key">{{ label }}</option></select></label>
        <label v-if="capabilityOf(forms[a.id]).period === 'required'" class="min-w-0 text-sm">取得期間の開始日<input v-model="forms[a.id].coverageFrom" data-bank-coverage-from type="date" :class="INPUT"></label>
        <label v-if="capabilityOf(forms[a.id]).period === 'required'" class="min-w-0 text-sm">取得期間の終了日（空欄は取得日の当日）<input v-model="forms[a.id].coverageTo" data-bank-coverage-to type="date" :class="INPUT"></label>
      </div>
      <p v-if="forms[a.id].provider" class="break-words text-xs leading-relaxed" :class="capabilityOf(forms[a.id]).mode === 'retrieve' ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500'" data-bank-capability>{{ capabilityText(forms[a.id]) }}</p>
      <p v-if="nativeOf(forms[a.id]) && !forms[a.id].templateId" class="break-words text-xs leading-relaxed text-gray-500" data-bank-native-template>テンプレートを選ばない場合は「{{ nativeOf(forms[a.id]).name }}」（{{ nativeOf(forms[a.id]).headers.join('・') }}、出金がマイナス、取引IDなし）を自動で作成して使います。CSVを先にアップロードする必要はありません。</p>
      <p v-if="templateFreeOf(forms[a.id]) && !forms[a.id].templateId" class="break-words text-xs leading-relaxed text-gray-500" data-bank-first-capture>テンプレートを選ばない場合は、列の割り当てなしで接続します。最初に受信したCSVは「要確認（列の割り当て待ち）」として原本を保存し、取引は取り込みません。「取込で割り当て」で列を割り当てて取り込み、そのテンプレートをここで選んで接続を保存すると、次回からの受信分はその割り当てで取り込まれます。CSVを先にアップロードする必要はありません。</p>
      <p v-if="BANK_SOFTWARE[forms[a.id].provider]" data-bank-software class="text-xs leading-relaxed text-gray-500">{{ BANK_SOFTWARE[forms[a.id].provider] }}</p>
      <label v-if="mapsTransactionId(forms[a.id].templateId)" class="flex items-start gap-2 text-sm"><input v-model="forms[a.id].transactionIdConfirmed" data-bank-id-confirm class="mt-1" type="checkbox">このテンプレートの取引ID列は銀行が発行した一意の取引IDです（摘要・メモではありません）。</label>
      <div class="flex flex-wrap gap-2"><button class="btn btn-secondary" :disabled="busy || !forms[a.id].provider || (!forms[a.id].templateId && !nativeOf(forms[a.id]) && !templateFreeOf(forms[a.id]))" data-bank-connect-save @click="saveConnection(a)">接続を保存</button><button class="btn btn-primary" :disabled="busy || !a.connection" data-bank-sync @click="sync(a)">{{ syncLabel(a) }}</button></div>
      <p v-if="messages[a.id]" class="text-sm text-green-700 dark:text-green-300" role="status" data-bank-sync-message>{{ messages[a.id] }}</p>
      <p v-if="a.connection" class="break-words text-xs" data-bank-test-state>{{ testStateText(a) }}</p>
      <div class="space-y-1"><p class="text-sm font-medium">取得を許可するPC</p><p class="text-xs text-gray-500" data-bank-pc-status>{{ pcStatusText(a) }}</p><p v-if="!collectors.length" class="text-xs text-gray-500">接続済みのPCがありません。カード連携の手順でPCを接続してください。</p><label v-for="c in collectors" :key="c._id" class="flex items-center gap-2 text-sm"><input type="checkbox" :data-bank-device="c._id" :checked="(c.bankAccountIds || []).map(String).includes(a.id)" :disabled="busy" @change="toggleDevice(c, a.id, $event)">{{ c.name }}</label></div>
      <div class="space-y-1"><p class="text-sm font-medium">取得の記録</p><p v-if="!(jobs[a.id] || []).length" class="text-xs text-gray-500">まだ取得はありません。</p><template v-for="j in jobs[a.id] || []" :key="j.jobId"><p class="break-words text-xs" :data-bank-job="j.jobId">{{ kindName(j.kind, j) }} · {{ stateName(j.state) }} · {{ when(j.requestedAt) }}<span v-if="j.snapshot?.coverage"> · 取得期間（指定） {{ j.snapshot.coverage.from }}〜{{ j.snapshot.coverage.to }}</span> · 取得時の設定 {{ (j.snapshotHash || '').slice(0, 8) }}<span v-if="j.lastMessage"> · {{ j.lastMessage }}</span><span v-if="j.hasObservation"> · 観察記録あり{{ eventChannelText(j.eventChannel) }} · <button class="text-primary-main dark:text-primary-light" data-bank-observation-open @click="toggleObservation(a.id, j.jobId)">{{ observations[a.id + ':' + j.jobId] ? '観察記録を閉じる' : '観察記録を見る' }}</button></span></p><pre v-if="observations[a.id + ':' + j.jobId]" data-bank-observation class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 p-2 text-xs dark:border-gray-700">{{ observationText(observations[a.id + ':' + j.jobId]) }}</pre></template></div>
      <div class="space-y-1"><p class="text-sm font-medium">受信した明細</p><p v-if="!(captures[a.id] || []).length" class="text-xs text-gray-500">まだありません。</p><div v-for="c in captures[a.id] || []" :key="c.id" class="flex flex-wrap items-center gap-2 text-xs" :data-bank-capture="c.id"><span class="min-w-0 flex-1 break-words">{{ c.name }} · {{ captureState(c.state) }} · 口座照合 {{ labelCheckText(c.labelChecked) }}<span v-if="c.dateRange" data-bank-capture-range> · 明細の日付 {{ c.dateRange.min }}〜{{ c.dateRange.max }}</span><span v-if="c.rows"> · 新規 {{ c.rows.new }} 既存 {{ c.rows.existing }} 差異 {{ c.rows.differs }}</span><span v-if="emptyCapture(c)" class="text-amber-700 dark:text-amber-300" data-bank-capture-empty> · 明細0件（期間内に取引がないのか取得できていないのかは未確認・要確認）</span><span v-if="mappingPending(c)" class="text-amber-700 dark:text-amber-300" data-bank-capture-mapping> · {{ c.dateRange ? '列の割り当て後に取込で割り当て済み（この受信の記録は要確認のまま残ります）' : '列の割り当て待ち（取引はまだ取り込まれていません。「取込で割り当て」から割り当ててください）' }}</span><span v-else-if="c.reason"> · {{ c.reason }}</span></span><button class="text-primary-main dark:text-primary-light" data-bank-capture-map @click="emit('map', c.id)">取込で割り当て</button></div></div>
    </article>
  </section>
</template>
<script setup lang="ts">
import { BANK_PROVIDERS, BANK_LOGIN_VARIANTS, BANK_SOFTWARE, BANK_NATIVE_TEMPLATES, BANK_VARIANT_COLLECTION, bankCapability, bankFirstCapture } from '~/shared/finance-payment-match.mjs'
import { useUserStore } from '~/stores/user'
const emit=defineEmits<{(e:'map',fileId:string):void;(e:'close'):void;(e:'changed'):void}>(),user=useUserStore(),api='/api/finance-payments/bank/'
const INPUT='input mt-1 w-full max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const accounts=ref<any[]>([]),templates=ref<any[]>([]),collectors=ref<any[]>([]),jobs=reactive<Record<string,any[]>>({}),captures=reactive<Record<string,any[]>>({}),forms=reactive<Record<string,any>>({}),messages=reactive<Record<string,string>>({}),observations=reactive<Record<string,any[]>>({}),busy=ref(false),error=ref(''),newAccount=reactive({name:'',currency:'JPY'})
const providerOf=(key:string)=>BANK_PROVIDERS.find(p=>p[0]===key)
const variantLabel=(provider:string,variant:string)=>(BANK_LOGIN_VARIANTS[provider]||[]).find(([k])=>k===variant)?.[1]||variant
// Plan omf-rakuten-native-shiwake-20261020 §3: the capability of the chosen provider AND login variant (implemented retrieval steps
// vs the observe stage) is separate from the connection-test state, which only an actual retrieve job can show.
const capabilityOf=(f:any)=>bankCapability(f?.provider,f?.variant||null)
const nativeOf=(f:any)=>f?.variant?BANK_NATIVE_TEMPLATES[f.provider]?.[f.variant]||null:null
const supportText=(c:any)=>c.steps==='implemented'?'取得手順 実装済み':'取得手順 未確認'
const providerSupportText=(key:string,support:string)=>support==='verified'?'取得手順 確認済み':Object.keys(BANK_VARIANT_COLLECTION[key]||{}).length?(BANK_LOGIN_VARIANTS[key]||[]).filter(([v])=>BANK_VARIANT_COLLECTION[key][v]==='retrieve').map(([,label])=>label.replace(/（.*$/,'')).join('・')+'は取得手順 実装済み':'取得手順 未確認'
// Plan omf-paypay-four-accounts-20261021: the template-free first capture (shared BANK_FIRST_CAPTURE, PayPay銀行 標準 only) and its guided
// observe jobs. Imported by name from the declared shared module (no silent fallback).
const firstCaptureOf=(provider:any,variant:any)=>bankFirstCapture(provider,variant||null)
const templateFreeOf=(f:any)=>!!f?.variant&&firstCaptureOf(f.provider,f.variant)==='unmapped'
const guidedOf=(c:any)=>!!c?.provider&&firstCaptureOf(c.provider,c.variant??null)==='unmapped'
const mappingPending=(c:any)=>c?.state==='needs_review'&&/^mapping-required/.test(String(c?.reason||''))
const GUIDED_TEXT='取得手順 未確認（ガイド付き取得）: 自動取得はまだできません。取得のたびに、接続したPCのChromeで、ダウンローダーの設定画面に保存したこの口座のログイン（店番号・口座番号・ログインパスワード）で1回だけ自動でサインインします（未保存なら本人がサインイン）。銀行の追加の確認と入出金明細のCSVの出力は本人がその画面で行います。受信したCSVは原本を保存し、列の割り当てがない間は「要確認」として取引を取り込みません。'
// Plan omf-paypay-routine-20261022: PayPay銀行 標準 retrieves; its own plain description (楽天銀行's sentence below is unchanged).
const PAYPAY_ROUTINE_TEXT='取得手順 実装済み（自動取得）: PCのダウンローダーに保存した店番号・口座番号・ログインパスワードで、PCのChromeが1回だけ自動でサインインし、普通預金取引明細照会で指定した期間を選んでCSVを1回だけ出力し、最後にログアウトします（未保存なら本人がChromeでサインインします）。別の場所でログイン中のときや、銀行が追加の確認を求めたときは、上書きせずに止めてChromeの画面でお知らせします。銀行が一度に出力できる期間の上限は、まだ確認していません。実際の接続テストの結果は下の「接続テスト」に表示されます。'
const capabilityText=(f:any)=>{const c=capabilityOf(f);if(c.mode!=='retrieve'&&templateFreeOf(f))return GUIDED_TEXT;if(c.mode==='retrieve'&&f?.provider==='paypay')return PAYPAY_ROUTINE_TEXT;return c.mode==='retrieve'?`${supportText(c)}（自動取得）: 指定した期間を銀行の画面に入力し、楽天銀行フォーマットのCSVを1回だけ出力します。サインインは、PCのダウンローダーの設定画面に保存したログインで自動（1回の取得で1回だけ送信）、未保存なら本人がChromeで行います。銀行の追加の確認は本人が行います。実際の接続テストの結果は下の「接続テスト」に表示されます。`:`${supportText(c)}: 観察取得（準備）になります${providerOf(f?.provider)&&BANK_LOGIN_VARIANTS[f.provider]&&!f.variant?'（ログイン方式を選ぶと取得手順を確認できます）':''}。`}
const connectionText=(a:any)=>{const c=a.connection;if(!c?.provider)return '未接続';const p=providerOf(c.provider);return `${p?.[1]||c.provider} · ${supportText(bankCapability(c.provider,c.variant??null))} · テンプレート ${c.templateId?templates.value.find(t=>t.id===c.templateId)?.name||c.templateId:'未割り当て（初回の取得後に割り当て）'}${c.accountLabel?' · '+c.accountLabel:''}${c.variant?' · '+variantLabel(c.provider,c.variant):''}${c.coverage?' · 取得期間 '+c.coverage.from+'〜'+(c.coverage.to||'当日'):''}`}
const syncLabel=(a:any)=>bankCapability(a.connection?.provider,a.connection?.variant??null).mode==='retrieve'?'取得':guidedOf(a.connection)?'ガイド付き取得':'観察取得（準備）'
// The connection test is the latest retrieve job: success only when it completed and a capture of it was imported.
const testStateText=(a:any)=>{
 const retrieves=bankCapability(a.connection?.provider,a.connection?.variant??null).mode==='retrieve'
 if(!retrieves&&guidedOf(a.connection))return '接続テスト: 自動取得の手順が未確認のため対象外（ガイド付き取得のみ・自動取得は未実施）'
 if(!retrieves)return '接続テスト: 自動取得の手順が未確認のため対象外（観察取得のみ）'
 const job=(jobs[a.id]||[]).find((j:any)=>j.kind==='retrieve');if(!job)return '接続テスト: 未実施（「取得」を押すと実際の銀行で試します）'
 if(job.state==='complete'&&(job.captures||[]).some((c:any)=>c.state==='imported'))return `接続テスト: 成功（${when(job.completedAt||job.requestedAt)} · 明細を取り込みました）`
 if(job.state==='complete')return `接続テスト: 完了（取り込んだ明細なし・要確認）${job.lastMessage?' · '+job.lastMessage:''}`
 if(job.state==='failed')return `接続テスト: 失敗（${job.lastMessage||'理由不明'}）`
 return `接続テスト: ${stateName(job.state)}`
}
const pcStatusText=(a:any)=>{const n=collectors.value.filter((c:any)=>(c.bankAccountIds||[]).map(String).includes(a.id)).length;return n?`取得を許可したPC: ${n}台`:'この口座の取得を許可したPCがありません（下のチェックで許可してください）'}
const emptyCapture=(c:any)=>c.state==='imported'&&!!c.rows&&Number(c.rows.new||0)+Number(c.rows.existing||0)+Number(c.rows.unchanged||0)===0
const kindName=(k:string,j?:any)=>k==='retrieve'?'自動取得':j&&guidedOf(j.snapshot)?'ガイド付き取得':'観察取得'
const stateName=(s:string)=>({queued:'予約',running:'実行中',verification_required:'サインイン・確認待ち（PCのChromeを確認）',complete:'完了',failed:'失敗'} as Record<string,string>)[s]||s
const captureState=(s:string)=>({received:'受信',imported:'取込済み',needs_review:'要確認'} as Record<string,string>)[s]||s
const labelCheckText=(checked:any)=>['未確認','確認済み'][Number(checked===true)]
const eventChannelText=(channel:any)=>({false:' · 操作の記録なし（画面の記録は保存済み）'} as Record<string,string>)[String(channel)]||''
const when=(v:any)=>v?String(v).slice(0,16).replace('T',' '):''
const mapsTransactionId=(templateId:string)=>{const t=templates.value.find(t=>t.id===templateId);return !!t&&t.mapping?.transactionId!==undefined&&t.mapping.transactionId!==''}
// The read-only view of a stored observation (GET …/jobs/:jobId/observation): pathnames, titles, clicked controls, edited
// fields, inputs and downloads per recorded page — the server stores no typed value, so none can appear here.
const observationText=(pages:any[])=>(pages||[]).map((p:any,i:number)=>`${i+1}. ${p.pathname} · ${p.title}${eventChannelText(p.eventChannel)}${(p.clicks||[]).length?' · クリック: '+p.clicks.map((c:any)=>c.text||c.id||c.tag).join(', '):''}${(p.typedInto||[]).length?' · 入力: '+p.typedInto.map((t:any)=>t.id+'('+t.type+')').join(', '):''}${(p.inputs||[]).length?' · 項目: '+p.inputs.map((x:any)=>x.id+'('+x.type+')').join(', '):''}${(p.downloadEvents||[]).length?' · ダウンロード: '+p.downloadEvents.map((d:any)=>d.host+'/'+d.suggestedFilename).join(', '):''}${p.eventsDropped?' · 記録できなかった操作 '+p.eventsDropped:''}`).join('\n')
async function toggleObservation(accountId:string,jobId:string){const key=accountId+':'+jobId;if(observations[key]){delete observations[key];return}await run(async()=>{const r:any=await $fetch(api+'accounts/'+accountId+'/jobs/'+jobId+'/observation',{headers:user.authHeader});observations[key]=r.observation||[]})}
async function run(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e.data?.data?.message||e.data?.statusMessage||e.message}finally{busy.value=false}}
async function loadJobs(id:string){const [j,c]:any[]=await Promise.all([$fetch(api+'accounts/'+id+'/jobs',{headers:user.authHeader}),$fetch(api+'accounts/'+id+'/captures',{headers:user.authHeader})]);jobs[id]=j.jobs;captures[id]=c.captures}
// The per-account form state exists before the account renders (the template reads forms[a.id]); jobs and captures follow.
async function load(){const [a,t,c]:any[]=await Promise.all([$fetch(api+'accounts',{headers:user.authHeader}),$fetch(api+'templates',{headers:user.authHeader}),$fetch('/api/finance/collectors',{headers:user.authHeader})]);templates.value=t.templates;collectors.value=(c.collectors||[]).filter((x:any)=>!x.revokedAt)
 for(const acc of a.accounts)forms[acc.id]??={provider:acc.connection?.provider||'',templateId:acc.connection?.templateId||'',accountLabel:acc.connection?.accountLabel||'',transactionIdConfirmed:!!acc.connection?.transactionIdConfirmed,variant:acc.connection?.variant||'',coverageFrom:acc.connection?.coverage?.from||'',coverageTo:acc.connection?.coverage?.to||''}
 accounts.value=a.accounts;await Promise.all(a.accounts.map((acc:any)=>loadJobs(acc.id)))}
async function createAccount(){await run(async()=>{await $fetch(api+'accounts',{method:'POST',headers:user.authHeader,body:{name:newAccount.name.trim(),currency:(newAccount.currency||'JPY').trim().toUpperCase()}});newAccount.name='';await load();emit('changed')})}
async function saveConnection(a:any){await run(async()=>{const f=forms[a.id],period=capabilityOf(f).period==='required'&&f.coverageFrom?{coverage:{from:f.coverageFrom,to:f.coverageTo||null}}:{};await $fetch(api+'accounts/'+a.id+'/connection',{method:'PUT',headers:user.authHeader,body:{provider:f.provider,templateId:f.templateId||undefined,accountLabel:f.accountLabel,transactionIdConfirmed:f.transactionIdConfirmed,variant:f.variant||null,...period}});messages[a.id]='接続を保存しました。';const saved=(await $fetch(api+'accounts',{headers:user.authHeader}) as any).accounts.find((x:any)=>x.id===a.id);if(saved?.connection)forms[a.id].templateId=saved.connection.templateId||'';await load();emit('changed')})}
async function sync(a:any){await run(async()=>{const r:any=await $fetch(api+'accounts/'+a.id+'/sync',{method:'POST',headers:user.authHeader,body:{}});messages[a.id]=r.message;await loadJobs(a.id);emit('changed')})}
async function toggleDevice(c:any,accountId:string,event:Event){const checked=(event.target as HTMLInputElement).checked;await run(async()=>{const ids=new Set<string>((c.bankAccountIds||[]).map(String));if(checked)ids.add(accountId);else ids.delete(accountId);await $fetch(api+'collectors/'+c._id,{method:'PUT',headers:user.authHeader,body:{bankAccountIds:[...ids]}});await load()})}
onMounted(()=>run(load))
</script>

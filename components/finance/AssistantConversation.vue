<template>
 <section :data-assistant-scope="scope.key" class="flex min-h-0 flex-1 flex-col" aria-label="OMFの会話">
  <!-- One row: company status (truncated, full text kept) and the company views, so the mobile transcript keeps its space. -->
  <div v-if="scope.company" class="flex shrink-0 items-center gap-1 px-5 pt-3 text-xs">
   <p data-assistant-company-status class="min-w-0 flex-1 truncate text-gray-500" :title="data?.company?.name||''">{{ !scope.organizationId ? '会社を選択してから相談してください。' : data?.company?.name ? data.company.name+'の会話 · 取引・請求書・支払い予定の確認' : '会社へのアクセスを確認しています…' }}</p>
   <template v-if="data?.company">
    <button type="button" data-assistant-view="chat" class="shrink-0 rounded-lg px-2 py-1" :class="view==='chat'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'" @click="view='chat'">会話</button>
    <button type="button" data-assistant-history-toggle class="shrink-0 rounded-lg px-2 py-1" :class="view==='history'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'" @click="openHistory">履歴</button>
    <button type="button" data-assistant-knowledge-toggle class="shrink-0 rounded-lg px-2 py-1" :class="view==='knowledge'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'" @click="openKnowledge">記憶</button>
    <button type="button" data-assistant-new-chat class="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-gray-600 hover:border-primary-main disabled:opacity-50 dark:border-white/10 dark:text-gray-300" :disabled="busy||waiting||!turns.length" :title="waiting?'回答の作成中は新しい会話を始められません':'今の会話を履歴に残して新しく始めます'" @click="newChat">新しい会話</button>
   </template>
  </div>
  <div v-if="scope.company&&view==='history'" data-assistant-history class="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
   <template v-if="archive">
    <button type="button" class="mb-3 text-xs text-primary-main underline" @click="archive=null">← 履歴の一覧</button>
    <p class="mb-2 text-[11px] text-gray-500">{{ formatDate(archive.firstAt) }} – {{ formatDate(archive.lastAt) }} · {{ archive.turnCount }}件（読み取り専用）</p>
    <button type="button" data-assistant-discuss="archive" class="mb-3 rounded-lg border border-primary-main/40 px-3 py-1.5 text-xs font-medium text-primary-main hover:bg-primary-main/10" @click="discuss({kind:'archive',id:archive.id,label:formatDate(archive.firstAt)+' からの会話'})">この会話について相談する</button>
    <article v-for="turn in archive.turns" :key="turn.id" data-archived-turn class="mb-4 space-y-2"><p class="whitespace-pre-wrap break-words rounded-2xl bg-gray-100 px-3 py-2 text-gray-800 dark:bg-white/10 dark:text-gray-100">{{ turn.text }}</p><ul v-if="turn.actions?.length" class="space-y-1 text-xs"><li v-for="a in turn.actions" :key="a.operationId" :data-archived-action-state="a.state" :class="a.state==='failed'||a.state==='unresolved'?'text-amber-700 dark:text-amber-400':'text-gray-500'">{{ actionLabel(a) }}</li></ul><p v-if="turn.proposal" class="whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">{{ turn.proposal.summary }}</p>
     <div v-if="turn.proposal?.citations?.length||turn.sources?.length" data-assistant-evidence class="space-y-1 text-xs">
      <p v-for="(c,i) in turn.proposal?.citations||[]" :key="'c'+i" data-assistant-citation class="rounded-lg bg-gray-50 px-3 py-1.5 text-gray-600 dark:bg-white/5 dark:text-gray-300"><span class="break-words">「{{ c.quote }}」</span><span class="text-gray-500"> — {{ c.claim }}</span><span class="block text-[11px] text-gray-400">{{ evidenceLabel(c) }}<template v-if="safeLink(c.url)"> · <a :href="c.url" target="_blank" rel="noopener noreferrer nofollow" class="underline">{{ c.title||host(c.url) }}</a></template></span></p>
      <details v-if="turn.sources?.length" data-assistant-sources class="text-gray-500"><summary class="cursor-pointer">調べた資料（{{ turn.sources.length }}件）</summary><ul class="mt-1 space-y-1"><li v-for="s in turn.sources" :key="s.id" data-assistant-source :data-source-status="s.status" class="break-words"><template v-if="s.status==='captured'"><a v-if="safeLink(s.url)" :href="s.url" target="_blank" rel="noopener noreferrer nofollow" class="underline">{{ s.title||host(s.url) }}</a><span v-else>{{ s.title }}</span> · {{ sourceLabel(s) }} · {{ formatDate(s.capturedAt) }} <button type="button" class="text-primary-main underline" @click="openSource(s.id)">本文</button></template><span v-else class="text-amber-700 dark:text-amber-400">{{ sourceLabel(s) }}<template v-if="s.requestedUrl"> · {{ host(s.requestedUrl) }}</template></span><pre v-if="sourceDetail?.id===s.id" data-assistant-source-text class="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-[11px] text-gray-700 dark:bg-white/5 dark:text-gray-200">{{ sourceDetail.text }}{{ sourceDetail.textTruncated?' …':'' }}</pre></li></ul></details>
     </div>
    </article>
   </template>
   <template v-else>
    <p v-if="!archives.length" class="text-xs text-gray-500">{{ historyLoaded ? 'まだ保存された過去の会話はありません。「新しい会話」を始めると、今の会話がここに残ります。' : '履歴を読み込んでいます…' }}</p>
    <button v-for="a in archives" :key="a.id" type="button" data-archive-item class="mb-2 block w-full rounded-xl border border-gray-200 px-3 py-2 text-left hover:border-primary-main dark:border-white/10" @click="openArchive(a.id)"><span class="block text-[11px] text-gray-500">{{ formatDate(a.firstAt) }} – {{ formatDate(a.lastAt) }} · {{ a.turnCount }}件</span><span class="block truncate text-xs text-gray-700 dark:text-gray-200">{{ a.preview }}</span></button>
    <button v-if="historyMore" type="button" class="text-xs text-primary-main underline" @click="loadHistory(historyPage+1)">さらに表示</button>
   </template>
  </div>
  <div v-if="scope.company&&view==='knowledge'" data-assistant-knowledge class="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
   <p class="mb-3 text-[11px] leading-relaxed text-gray-500">「覚えて」と頼んだ内容です。この会社の回答の根拠として使い、取引を自動で変更することはありません。訂正・停止は会話で頼んでください。</p>
   <p v-if="!knowledge.length" class="text-xs text-gray-500">{{ knowledgeLoaded ? 'まだ記憶はありません。' : '記憶を読み込んでいます…' }}</p>
   <article v-for="k in knowledge" :key="k.id" data-knowledge-item :data-knowledge-status="k.status" class="mb-3 rounded-xl border border-gray-200 px-3 py-2 dark:border-white/10" :class="k.status==='paused'?'opacity-60':''">
    <p class="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500"><span class="rounded px-1.5 py-0.5" :class="k.status==='active'?'bg-primary-main/10 text-primary-main':'bg-gray-100 dark:bg-white/10'">{{ k.status==='active'?'適用中':'停止中' }}</span><span>改訂 {{ k.revision }}</span><span>{{ formatDate(k.source?.at) }} の会話から</span></p>
    <p class="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{{ k.instruction }}</p>
    <p v-if="conditionText(k)" class="mt-1 text-xs text-gray-500">{{ conditionText(k) }}</p>
    <details v-if="k.history?.length" class="mt-1 text-xs text-gray-500"><summary class="cursor-pointer">以前の内容（{{ k.history.length }}件）</summary><p v-for="h in k.history" :key="h.revision" class="mt-1 whitespace-pre-wrap break-words">改訂 {{ h.revision }}（{{ h.status==='active'?'適用中':'停止中' }}）: {{ h.instruction }}</p></details>
    <button type="button" data-assistant-discuss="knowledge" class="mt-1 text-xs text-primary-main underline" @click="discuss({kind:'knowledge',id:k.id,label:'記憶「'+String(k.instruction||'').slice(0,30)+'」'})">この記憶について相談する</button>
   </article>
  </div>
  <div v-show="!scope.company||view==='chat'" ref="transcript" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" role="log" aria-live="polite">
   <div v-if="!turns.length" class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"><p>지금 보고 있는 화면에 대해 물어보세요. 기록과 판단의 근거를 함께 확인할 수 있어요.</p><div class="mt-5 flex flex-wrap gap-2"><button v-for="example in examples" :key="example" class="rounded-xl border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:border-primary-main dark:border-white/10 dark:text-gray-300" @click="text=example">{{ example }}</button></div></div>
   <article v-for="turn in turns" :key="turn.id" data-workspace-turn class="space-y-3"><div class="ml-5 rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 dark:bg-white/10"><p class="mb-1 text-[11px] text-gray-500">{{ turn.pageName }}<span v-if="turn.selection"> · {{ turn.selection }}</span></p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-100">{{ turn.text }}</p></div><ul v-if="turn.actions?.length" data-workspace-actions class="space-y-1 text-xs"><li v-for="a in turn.actions" :key="a.operationId" :data-workspace-action-state="a.state" class="flex items-start gap-2" :class="a.state==='failed' || a.state==='unresolved' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500'"><Loader2 v-if="a.state==='working'" class="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary-main" /><span>{{ actionLabel(a) }}</span></li></ul><div v-if="turn.proposal"><p class="mb-2 flex items-center gap-2 text-[11px] font-semibold text-primary-main"><NaviAvatar size="sm" /><span>OMF Navi</span></p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-200">{{ turn.proposal.summary }}</p><NuxtLink v-if="scope.company&&navigationRoute(turn.proposal)" :to="navigationRoute(turn.proposal)" data-assistant-navigation class="mt-2 inline-flex items-center rounded-lg border border-primary-main/40 px-3 py-1.5 text-xs font-medium text-primary-main hover:bg-primary-main/10">{{ navigationLabel(turn.proposal) }}を開く ↗</NuxtLink></div>
    <!-- Captured public sources and resolved citations of this turn: server records only (a read in progress shows once captured). -->
    <div v-if="scope.company&&(turn.proposal?.citations?.length||turn.sources?.length)" data-assistant-evidence class="space-y-1 text-xs">
     <p v-for="(c,i) in turn.proposal?.citations||[]" :key="'c'+i" data-assistant-citation class="rounded-lg bg-gray-50 px-3 py-1.5 text-gray-600 dark:bg-white/5 dark:text-gray-300"><span class="break-words">「{{ c.quote }}」</span><span class="text-gray-500"> — {{ c.claim }}</span><span class="block text-[11px] text-gray-400">{{ evidenceLabel(c) }}<template v-if="c.observation==='retained_earlier'"> · 以前に取得</template><template v-if="safeLink(c.url)"> · <a :href="c.url" target="_blank" rel="noopener noreferrer nofollow" class="underline">{{ c.title||host(c.url) }}</a></template></span></p>
     <details v-if="turn.sources?.length" data-assistant-sources class="text-gray-500"><summary class="cursor-pointer">調べた資料（{{ turn.sources.length }}件）</summary><ul class="mt-1 space-y-1"><li v-for="s in turn.sources" :key="s.id" data-assistant-source :data-source-status="s.status" class="break-words"><template v-if="s.status==='captured'"><a v-if="safeLink(s.url)" :href="s.url" target="_blank" rel="noopener noreferrer nofollow" class="underline">{{ s.title||host(s.url) }}</a><span v-else>{{ s.title }}</span> · {{ sourceLabel(s) }} · {{ formatDate(s.capturedAt) }} <button type="button" class="text-primary-main underline" @click="openSource(s.id)">本文</button></template><span v-else class="text-amber-700 dark:text-amber-400">{{ sourceLabel(s) }}<template v-if="s.requestedUrl"> · {{ host(s.requestedUrl) }}</template></span><pre v-if="sourceDetail?.id===s.id" data-assistant-source-text class="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-[11px] text-gray-700 dark:bg-white/5 dark:text-gray-200">{{ sourceDetail.text }}{{ sourceDetail.textTruncated?' …':'' }}</pre></li></ul></details>
    </div></article>
   <p v-if="scope.company&&turns.length>=(data?.conversation?.turnLimit||200)" data-assistant-turn-limit class="text-xs text-amber-700">この会話は{{ data?.conversation?.turnLimit||200 }}件に達しました。「新しい会話」で続けてください。これまでの会話と保存の記録は「履歴」に残ります。</p>
   <p v-if="waiting" class="flex items-center gap-2 text-xs text-gray-500" role="status"><Loader2 class="h-4 w-4 shrink-0 animate-spin text-primary-main" />{{ !data?.connected?'メッセージは保存済みです。AIへの接続が戻ると続けます。':data.conversation.state==='queued'?'メッセージは保存済みです。AIの受付を待っています…':workingSources?'公開資料を確認しています（'+workingSources+'件を読み取り済み）…':'記録と会話を確認しています…' }}</p>
   <div v-if="data?.conversation?.state==='failed'" class="text-xs text-amber-700"><p>回答を取得できませんでした。会話は保存されています。</p><button class="mt-2 text-primary-main underline" :disabled="busy||!data?.connected" @click="retry">もう一度取得する</button></div>
  </div>
  <!-- History and memory views are read-only inspectors: the composer belongs to the chat view; "相談する" pins the record here. -->
  <form v-show="!scope.company||view==='chat'" class="shrink-0 border-t border-gray-100 p-4 dark:border-white/10" @submit.prevent="send">
   <p v-if="error" role="alert" class="mb-3 text-xs text-red-600">{{ error }}</p>
   <p v-if="scope.company&&pinned" data-assistant-pinned class="mb-2 flex items-center gap-2 rounded-lg bg-primary-main/10 px-2 py-1 text-[11px] text-primary-main"><span class="min-w-0 flex-1 truncate" :title="pinned.label">相談の対象: {{ pinned.label }}（根拠として読み、指示としては扱いません）</span><button type="button" data-assistant-unpin class="shrink-0 underline" aria-label="相談の対象を外す" @click="pinned=null">外す</button></p>
   <label for="assistant-message" class="sr-only">OMFへのメッセージ</label><textarea id="assistant-message" v-model="text" rows="3" maxlength="2000" placeholder="この判断の理由は？ / 이 화면에서…" class="assistant-input" :disabled="busy||waiting||!data?.connected" @keydown.ctrl.enter.prevent="send" />
   <div class="mt-3 flex items-center justify-between gap-3"><p class="text-[11px] text-gray-500">{{ !data?'接続を確認しています…':data.connected?'한국어・日本語 · 会話を保存します':'AIに接続できません。会話は保存されています。' }}</p><button type="submit" data-assistant-send class="btn btn-primary shrink-0 text-xs" :disabled="busy||waiting||!data?.connected||(!text.trim()&&!assistant.pending[bufferKey])"><Send class="mr-1 h-3.5 w-3.5" />{{ assistant.pending[bufferKey]?'送信結果を確認':'送信' }}</button></div>
  </form>
 </section>
</template>
<script setup lang="ts">
import {Loader2,Send} from 'lucide-vue-next'
import NaviAvatar from './NaviAvatar.vue'
import {useCalendarStore} from '~/stores/calendar'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {tokenClaims} from '~/utils/auth-session'
import {naviFeature,naviFeatureRoute} from '~/shared/finance-navi-features.mjs'
const props=defineProps<{context:any,active:boolean,scope:{key:string,company:boolean,actorId:string,organizationId:string}}>(),user=useUserStore(),assistant=useAssistantStore()
const data=ref<any>(null),error=ref(''),busy=ref(false),transcript=ref<HTMLElement|null>(null)
// Company-only views. History and teachings stay in component memory; nothing financial goes to browser storage.
const view=ref<'chat'|'history'|'knowledge'>('chat'),archives=ref<any[]>([]),archive=ref<any>(null),historyLoaded=ref(false),historyPage=ref(1),historyMore=ref(false),knowledge=ref<any[]>([]),knowledgeLoaded=ref(false)
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')
let resetRequest=''
// A reply link is only ever a fixed catalogue page (or one company transaction page); it opens on the user's click, never by itself.
const navigationRoute=(p:any)=>p?.navigation?naviFeatureRoute(p.navigation.feature,p.navigation.transactionId):null
const navigationLabel=(p:any)=>naviFeature(p?.navigation?.feature)?.label||'画面'
const formatDate=(v:any)=>v?new Date(v).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''
const suggestedNames:Record<string,string>={accountCategory:'勘定科目',subAccountCategory:'補助科目',taxCategory:'税区分',transactionCategory:'区分',customer:'顧客',supplier:'仕入先'}
const conditionText=(k:any)=>[k.conditions?.merchant?'店: '+k.conditions.merchant:'',k.conditions?.cardLast4?'カード末尾 '+k.conditions.cardLast4:'',k.conditions?.effectiveFrom?k.conditions.effectiveFrom+' から':'',...Object.entries(k.suggested||{}).filter(([,v]:any)=>v).map(([key,v]:any)=>(suggestedNames[key]||key)+': '+(v.name||'名称未取得'))].filter(Boolean).join(' · ')
const scope={...props.scope},bufferKey=scope.company?scope.key:'workspace'
const text=computed({get:()=>assistant.buffers[bufferKey]||'',set:v=>assistant.buffers[bufferKey]=v})
const turns=computed(()=>data.value?.conversation?.turns||[]),waiting=computed(()=>['queued','working'].includes(data.value?.conversation?.state))
// Public research progress: only reads the server already captured for the turn being answered (never an intention).
const workingSources=computed(()=>data.value?.conversation?.state==='working'?(turns.value.find((t:any)=>t.id===data.value.conversation.currentId)?.sources||[]).filter((s:any)=>s.status==='captured').length:0)
// An archive or teaching pinned from the history/memory view as the context of the next messages (pointer only; the server checks
// it belongs to this owner/company and reads it fresh). Component memory only, cleared by the user.
const pinned=ref<{kind:'archive'|'knowledge',id:string,label:string}|null>(null),sourceDetail=ref<{id:string,text:string,textTruncated:boolean}|null>(null)
function discuss(target:{kind:'archive'|'knowledge',id:string,label:string}){if(!scope.company||!current()||!/^[a-f0-9]{24}$/i.test(target?.id||''))return;pinned.value={kind:target.kind,id:target.id,label:String(target.label||'').slice(0,80)};view.value='chat';archive.value=null}
const safeLink=(u:any)=>typeof u==='string'&&/^https:\/\/[^\s]+$/i.test(u)
const host=(u:any)=>{try{return new URL(u).hostname}catch{return ''}}
const registryText=(r:any)=>r?(r.asOf||'')+' 時点'+(r.status==='connection_required'?'':r.active===true?'・登録あり':r.active===false?'・登録なし':'')+(r.legalName?'（'+r.legalName+'）':''):''
const evidenceLabel=(c:any)=>c?.evidence==='official_registry_observation'?'国税庁の照合 '+registryText(c.registry):'公開ページの記載（公的な照合ではありません）'
const sourceLabel=(s:any)=>s.status==='unavailable'?'国税庁の照合: 接続設定がないため未確認'+(s.registry?.asOf?'（'+s.registry.asOf+' 時点）':''):s.status==='failed'?'読み取れませんでした':s.kind==='registry'?'国税庁の照合 '+registryText(s.registry):s.kind==='chrome'?'公開ページ（Chrome で表示）':'公開ページ'
let sourceTicket=0
async function openSource(id:string){if(!scope.company||!current()||!/^[a-f0-9]{24}$/i.test(id))return;if(sourceDetail.value?.id===id){sourceDetail.value=null;return}const stamp=++sourceTicket;try{const r:any=await $fetch(endpoint+'/sources/'+id,{headers:user.authHeader});if(current()&&stamp===sourceTicket&&r?.source?.id===id)sourceDetail.value={id,text:String(r.source.text||''),textTruncated:r.source.textTruncated===true}}catch(e){if(current()&&stamp===sourceTicket)failed(e)}}
const examples=scope.company?['この会社の請求書を確認して。','支払い予定と確認が必要な点を教えて。']: ['マッピングと取引一覧はどう違う？','AとBの判断にはどんな違いがある？','지금 선택한 규칙의 근거를 설명해 줘.']
const endpoint=scope.company?'/api/finance-chat/company-workspace':'/api/finance-chat/workspace',message=(e:any)=>scope.company&&[401,403].includes(e.statusCode||e.status)?'会社へのアクセスを確認できません。所属と選択した会社を確認してください。':e.data?.data?.message||'会話を取得できませんでした。'
function failed(e:any){error.value=message(e);if(scope.company&&[401,403].includes(e.statusCode||e.status))data.value=null}
const knowledgeActions=['remember_company_knowledge','correct_company_knowledge','set_company_knowledge_status']
const actionNames:Record<string,string>={remember_company_knowledge:'記憶を保存',correct_company_knowledge:'記憶を訂正',set_company_knowledge_status:'記憶の適用を変更',update_company_transaction:'取引を保存',update_company_invoice:'請求書を保存',update_company_calendar_entry:'支払い予定を保存',save_draft_fields:'下書きを保存',remember_accounting_fields:'科目を記憶',remember_customer_purpose:'顧客・用途を記憶',set_memory_status:'記憶の適用を変更',approve_draft:'下書きを確認',post_selected_approved_rows:'帳簿に登録',start_purchase_research:'調査を依頼',create_intake_record:'受付を作成',patch_intake_record:'受付を保存',set_intake_archived:'受付のアーカイブを変更',apply_intake_import:'受付ファイルを取込',save_intake_template:'取込テンプレートを保存',start_intake_research:'会社・T番号の調査を依頼',confirm_intake_research:'調査結果を受付に保存'}
const actionStates:Record<string,string>={done:'完了',queued:'受付済み',working:'処理中…',failed:'できませんでした',unresolved:'結果の確認が必要です'}
const actionLabel=(a:any)=>(actionNames[a.name]||a.name)+'：'+(actionStates[a.state]||a.state)+(a.target?.line?'（'+a.target.line+'行目'+(a.acceptedRevision?'・下書き改訂 '+a.acceptedRevision:'')+'）':a.acceptedRevision?'（改訂 '+a.acceptedRevision+'）':'')+(a.safeError?' · '+a.safeError:'')
// A completed write names its purchase; that purchase is fetched fresh and handed to the store, which refreshes the draft page only if
// it shows that same purchase and has no unsaved edits (the receipt itself is history, not state). Once per operation.
const refreshed=new Set<string>()
async function refreshAfterActions(){const intakeReceipts:any[]=[];for(const turn of turns.value)for(const a of turn.actions||[]){
 if(refreshed.has(a.operationId))continue
 if(scope.company&&knowledgeActions.includes(a.name)){if(a.state==='done'&&current()){assistant.receiveCompanyKnowledge({actorId:scope.actorId,organizationId:scope.organizationId,knowledgeId:a.nativeResourceIds?.knowledgeId||''});refreshed.add(a.operationId)}continue}
 if(scope.company&&a.name==='update_company_transaction'&&a.state==='done'&&a.nativeResourceIds?.transactionId){if(current()){assistant.receiveCompanyTransaction({actorId:scope.actorId,organizationId:scope.organizationId,transactionId:a.nativeResourceIds.transactionId});refreshed.add(a.operationId)}continue}
 if(scope.company&&a.name==='update_company_invoice'&&a.state==='done'&&a.nativeResourceIds?.invoiceId){if(current()){assistant.receiveCompanyInvoice({actorId:scope.actorId,organizationId:scope.organizationId,invoiceId:a.nativeResourceIds.invoiceId});refreshed.add(a.operationId)}continue}
 if(scope.company&&a.name==='update_company_calendar_entry'&&a.state==='done'&&a.nativeResourceIds?.paymentId){try{const payment:any=await $fetch('/api/payments/'+a.nativeResourceIds.paymentId,{headers:user.authHeader});if(current()){const calendar=useCalendarStore(),index=calendar.payments.findIndex(p=>p.id===payment.id);if(index>=0)calendar.payments[index]=payment;refreshed.add(a.operationId)}}catch{}continue}
 if(['done','queued','unresolved'].includes(a.state)&&/_intake_/.test(a.name)&&a.nativeResourceIds){intakeReceipts.push(a);refreshed.add(a.operationId);continue}
 if(a.state!=='done'||!a.target?.importId||!a.target?.line||!['save_draft_fields','approve_draft'].includes(a.name))continue
 try{const d:any=await $fetch('/api/finance/imports/'+a.target.importId+'/drafts/'+a.target.line,{headers:user.authHeader});if(current()){assistant.receive(d);refreshed.add(a.operationId)}}catch{}
}if(intakeReceipts.length&&current())assistant.receiveIntake(intakeReceipts)}
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,ticket=0
const current=()=>{const claims=tokenClaims(user.token);return !disposed&&user.isAuthenticated&&claims?.userId===scope.actorId&&(!scope.company||claims?.organizationId===scope.organizationId)}
function accept(result:any){if(!current())return;if(scope.company&&(result.company?.id!==scope.organizationId||(result.conversation&&(result.conversation.scope?.actorId!==scope.actorId||result.conversation.scope?.organizationId!==scope.organizationId))))throw Error('Company conversation changed');data.value=result;error.value='';const pending=assistant.pending[bufferKey];if(pending&&result.conversation?.turns?.some((t:any)=>t.id===pending.id&&t.text===pending.text)){if(text.value===pending.rawText)text.value='';delete assistant.pending[bufferKey]}}
async function load(){if(scope.company&&!scope.organizationId)return;const stamp=++ticket;try{const result=await $fetch(endpoint,{headers:user.authHeader});if(current()&&stamp===ticket){accept(result);await refreshAfterActions()}}catch(e){if(current()&&stamp===ticket)failed(e)}}
function schedule(){timer=setTimeout(async()=>{if(!current())return;if(props.active&&!busy.value)await load();if(current())schedule()},4000)}
async function send(){if(!current()||busy.value||waiting.value||(!text.value.trim()&&!assistant.pending[bufferKey])||!data.value?.connected)return;busy.value=true;error.value='';ticket++;try{
 if(!assistant.pending[bufferKey])assistant.pending[bufferKey]={id:randomId(),text:text.value.trim(),rawText:text.value,context:{...JSON.parse(JSON.stringify(props.context)),...(scope.company&&pinned.value?{inspected:{kind:pinned.value.kind,id:pinned.value.id}}:{})}}
 const request=assistant.pending[bufferKey];const result=await $fetch(endpoint,{method:'POST',headers:user.authHeader,body:{text:request.text,requestId:request.id,context:request.context,chatRevision:data.value?.conversation?.revision||0}});if(current())accept(result)
}catch(e){if(current())failed(e)}finally{busy.value=false}}
async function retry(){if(!current()||busy.value)return;busy.value=true;error.value='';ticket++;try{const result=await $fetch(endpoint+'/retry',{method:'POST',headers:user.authHeader,body:{chatRevision:data.value.conversation.revision}});if(current())accept(result)}catch(e){if(current())failed(e)}finally{busy.value=false}}
// Explicit new chat: the server archives the current segment with its receipts. The same request id is reused after a lost reply,
// so a retry is recognised instead of archiving twice; a refused request (busy, changed) is dropped.
async function newChat(){if(!scope.company||!current()||busy.value||waiting.value||!data.value?.conversation)return;busy.value=true;error.value='';ticket++;if(!resetRequest)resetRequest=randomId();try{const result=await $fetch(endpoint+'/new',{method:'POST',headers:user.authHeader,body:{chatRevision:data.value.conversation.revision,requestId:resetRequest}});resetRequest='';if(current()){accept(result);view.value='chat';archive.value=null;archives.value=[];historyLoaded.value=false}}catch(e:any){if(e?.statusCode||e?.status)resetRequest='';if(current())failed(e)}finally{busy.value=false}}
async function loadHistory(page=1){try{const r:any=await $fetch(endpoint+'/history',{headers:user.authHeader,query:{page}});if(!current())return;archives.value=page===1?r.archives:[...archives.value,...r.archives];historyPage.value=r.page;historyMore.value=r.hasMore;historyLoaded.value=true}catch(e){if(current())failed(e)}}
function openHistory(){view.value='history';archive.value=null;loadHistory(1)}
async function openArchive(id:string){try{const r:any=await $fetch(endpoint+'/history/'+id,{headers:user.authHeader});if(current()&&view.value==='history')archive.value=r.archive}catch(e){if(current())failed(e)}}
async function loadKnowledge(){try{const r:any=await $fetch(endpoint+'/knowledge',{headers:user.authHeader,query:{status:'all'}});if(current()&&r.company?.id===scope.organizationId){knowledge.value=r.items;knowledgeLoaded.value=true}}catch(e){if(current())failed(e)}}
function openKnowledge(){view.value='knowledge';loadKnowledge()}
watch(()=>assistant.companyKnowledgeSequence,()=>{if(view.value==='knowledge'&&assistant.companyKnowledgeSaved?.organizationId===scope.organizationId)loadKnowledge()})
onMounted(async()=>{await load();if(!disposed)schedule()});onBeforeUnmount(()=>{disposed=true;ticket++;clearTimeout(timer)});watch(()=>props.active,v=>{if(v)load()})
watch(()=>[turns.value.length,turns.value.at(-1)?.answeredAt],async()=>{await nextTick();transcript.value?.scrollTo({top:transcript.value.scrollHeight,behavior:'smooth'})})
</script>

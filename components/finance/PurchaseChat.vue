<template>
 <section :class="panel ? 'flex min-h-0 flex-1 flex-col' : 'card mb-6 overflow-hidden'" aria-label="OMFと相談">
  <header v-if="!panel" class="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-white/10 sm:px-6">
   <div class="flex items-center gap-3"><NaviAvatar /><div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">OMF Navi に相談</h2><p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">購入の説明も、判断の修正も、ここから。</p></div></div>
   <NuxtLink to="/learning" class="shrink-0 py-1 text-xs text-primary-main">学習ノート ↗</NuxtLink>
  </header>
  <div v-if="data" data-chat-controls class="flex shrink-0 items-center gap-1 px-4 pt-3 text-xs sm:px-6" :class="panel?'px-5 sm:px-5':''">
   <p class="min-w-0 flex-1 truncate text-gray-500">この購入の会話</p>
   <button type="button" data-chat-view="chat" class="shrink-0 rounded-lg px-2 py-1" :class="view==='chat'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'" @click="view='chat'">会話</button>
   <button type="button" data-chat-history-toggle class="shrink-0 rounded-lg px-2 py-1" :class="view==='history'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'" @click="openHistory">履歴</button>
   <button type="button" data-chat-new-chat class="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-gray-600 hover:border-primary-main disabled:opacity-50 dark:border-white/10 dark:text-gray-300" :disabled="busy||waiting||!(turns.length||pendingRequest)" :title="waiting?'回答の作成中は新しい会話を始められません':'今の会話を履歴に残して新しく始めます（下書きは変わりません）'" @click="newChat">新しい会話</button>
  </div>
  <div v-if="view==='history'" ref="historyBox" data-chat-history :class="panel ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm' : 'max-h-[520px] overflow-y-auto px-4 py-4 text-sm sm:px-6'">
   <template v-if="archive">
    <button type="button" class="mb-3 text-xs text-primary-main underline" @click="archive=null">← 履歴の一覧</button>
    <p class="mb-3 text-[11px] text-gray-500">{{ formatDate(archive.firstAt) }} – {{ formatDate(archive.lastAt) }} · {{ archive.turnCount }}件（読み取り専用。以前の提案は記録で、ここから反映はできません）</p>
    <p v-if="received&&received.archiveId===archive.id" data-chat-received role="status" class="mb-3 rounded-lg bg-primary-main/10 px-3 py-2 text-xs text-primary-main">この送信は以前に受け付けられていました。同じ依頼はもう一度送っていません。結果と保存の記録は枠で囲んだやりとりです{{ received.occurrences>1?'（同じ依頼が履歴に'+received.occurrences+(received.truncated?'件以上':'件')+'記録されています）':'' }}。</p>
    <article v-for="turn in archive.turns" :key="turn.id" data-chat-archived-turn :data-chat-archived-request="received&&received.archiveId===archive.id&&received.requestId===turn.id?'':undefined" class="mb-4 space-y-2" :class="received&&received.archiveId===archive.id&&received.requestId===turn.id?'rounded-xl p-2 ring-2 ring-primary-main/40':''"><p v-if="turn.withheld" class="text-xs text-gray-500">{{ withheldText }}</p><p v-else class="whitespace-pre-wrap break-words rounded-2xl bg-gray-100 px-3 py-2 text-gray-800 dark:bg-white/10 dark:text-gray-100">{{ turn.text }}</p><ul v-if="turn.actions?.length" class="space-y-1 text-xs"><li v-for="a in turn.actions" :key="a.operationId" :class="a.state==='failed'||a.state==='unresolved'?'text-amber-700 dark:text-amber-400':'text-gray-500'">{{ actionLabel(a) }}</li></ul><p v-if="turn.proposal" class="whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">{{ turn.proposal.summary }}</p><dl v-if="turn.proposal?.kind==='proposal'" data-chat-archived-proposal class="rounded-xl border border-gray-200 p-2 text-xs dark:border-white/10"><div v-for="(value,key) in turn.proposal.patch" :key="key"><dt class="text-gray-500">{{ labels[key] }}</dt><dd class="break-words">{{ display(key,value) }}</dd></div><p class="mt-1 text-gray-500">{{ turn.confirmedAt ? '当時、下書きに反映済み' : '以前の提案（反映していません）' }}</p></dl></article>
   </template>
   <template v-else>
    <p v-if="!archives.length" class="text-xs text-gray-500">{{ historyLoaded ? 'まだ保存された過去の会話はありません。「新しい会話」を始めると、今の会話がここに残ります。' : '履歴を読み込んでいます…' }}</p>
    <button v-for="a in archives" :key="a.id" type="button" data-chat-archive-item class="mb-2 block w-full rounded-xl border border-gray-200 px-3 py-2 text-left hover:border-primary-main dark:border-white/10" @click="openArchive(a.id)"><span class="block text-[11px] text-gray-500">{{ formatDate(a.firstAt) }} – {{ formatDate(a.lastAt) }} · {{ a.turnCount }}件</span><span class="block truncate text-xs text-gray-700 dark:text-gray-200">{{ a.preview }}</span></button>
    <button v-if="historyMore" type="button" class="text-xs text-primary-main underline" @click="loadHistory(historyPage+1)">さらに表示</button>
   </template>
  </div>
  <div v-show="view==='chat'" ref="transcript" :class="panel ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5' : 'max-h-[520px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6'" role="log" aria-live="polite">
   <div v-if="!turns.length" class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"><p>{{ opening }}</p><p class="mt-2 text-xs text-gray-500 dark:text-gray-400">한국어・日本語で説明できます。会話はこの明細に保存されます。</p></div>
   <article v-for="turn in turns" :key="turn.id" :data-chat-turn="turn.id" class="space-y-3">
    <p v-if="turn.withheld" data-chat-withheld class="text-xs text-gray-500">{{ withheldText }}</p>
    <div v-else class="ml-6 rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 dark:bg-white/10"><p class="mb-1 text-[11px] font-medium text-gray-500">あなた</p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-200">{{ turn.text }}</p></div>
    <ul v-if="turn.actions?.length" data-chat-actions class="mr-2 space-y-1 text-xs"><li v-for="a in turn.actions" :key="a.operationId" :data-chat-action-state="a.state" class="flex items-start gap-2" :class="a.state==='failed' || a.state==='unresolved' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500'"><Loader2 v-if="a.state==='working'" class="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary-main" /><span>{{ actionLabel(a) }}</span></li></ul>
    <div v-if="turn.proposal" class="mr-2"><p class="mb-2 flex items-center gap-2 text-[11px] font-semibold text-primary-main"><NaviAvatar size="sm" /><span>OMF Navi</span></p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300" v-bind="replyMark(turn)">{{ turn.proposal.summary }}</p>
     <p v-if="turn.research" data-chat-research :data-chat-research-status="turn.id===conversation?.currentId ? '' : undefined" class="mt-2 text-xs" :class="turn.research.requestId ? 'text-gray-500' : turn.research.unavailable ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500'">{{ researchStatus(turn) }}</p>
     <div v-if="turn.proposal.kind==='proposal'" class="mt-3 rounded-xl border border-gray-200 p-3 dark:border-white/10">
      <p class="text-xs font-semibold text-gray-700 dark:text-gray-300">{{ turn.confirmedAt ? '確認した内容' : '反映する内容の提案' }}</p>
      <dl class="mt-2 space-y-2"><div v-for="(value,key) in turn.proposal.patch" :key="key" class="text-xs"><dt class="text-gray-500">{{ labels[key] }}</dt><dd class="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-200">{{ display(key,value) }}</dd></div></dl>
      <p v-if="turn.confirmedAt" class="mt-3 text-xs text-green-700 dark:text-green-400">{{ turn.remembered ? '下書きに反映・顧客と用途を記憶済み' : '今回の下書きに反映済み' }}</p>
      <template v-else-if="turn.id===conversation?.currentId && conversation?.state==='ready'">
       <label v-if="canRemember" class="mt-4 flex items-start gap-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400"><input v-model="remember" type="checkbox" class="mt-0.5 rounded border-gray-300 text-primary-main focus:ring-primary-main" :disabled="unavailable || busy"><span>顧客・用途を次回にも使う<span class="mt-1 block text-gray-500">{{ draft.source.account.name }} × 「{{ draft.source.description }}」の完全一致 · {{ draft.source.purchaseDate }}以降。商品名は今回のみ。</span></span></label>
       <button type="button" data-chat-confirm class="btn btn-primary mt-4 text-xs" :disabled="blocked || busy || data?.stale" @click="confirm">{{ remember?'確認して反映・記憶する':'確認して今回に反映する' }}</button>
      </template>
      <p v-else-if="!turn.confirmedAt" class="mt-3 text-xs text-gray-500">{{ turn.id===conversation?.currentId ? '反映状況を確認中です。' : '以前の提案です。下書きには反映していません。' }}</p>
     </div>
    </div>
   </article>
   <article v-if="researchView?.research?.report" ref="researchReply" data-chat-research-result class="space-y-3">
    <p class="flex items-center gap-2 text-[11px] font-semibold text-primary-main"><NaviAvatar size="sm" /><span>OMF Navi · {{ korean ? '조사 결과' : '調査結果' }}</span></p>
    <p v-if="researchView.research.state==='applied'" data-chat-research-record class="text-xs leading-relaxed text-gray-500">{{ korean ? '선택한 후보를 이전에 반영한 조사 기록이에요. 현재 입력값은 거래의 하단 항목에서 확인할 수 있어요.' : '選択した候補を反映した際の調査記録です。現在の入力値は取引の項目で確認できます。' }}</p>
    <p v-else-if="researchView.stale" data-chat-research-stale class="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{{ korean ? '조사 후 거래 내용이 바뀌었어요. 아래는 이전 조사 기록이며, 현재 거래에 적용할 후보는 다시 확인해야 해요.' : '調査後に下書きが変わりました。以下は以前の調査記録です。現在の候補は再確認が必要です。' }}</p>
    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300" v-bind="researchMark(researchView.research,turns)">{{ researchView.research.report.summary }}</p>
    <dl v-if="!researchView.stale && researchView.research.state!=='applied'" class="divide-y divide-gray-100 rounded-xl border border-gray-200 px-3 dark:divide-white/10 dark:border-white/10">
     <div v-for="field in resultFields" :key="field.key" :data-chat-research-finding="field.candidate ? field.key : undefined" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 py-2.5 text-xs"><dt class="text-gray-500">{{ field.label }}<span v-if="field.status" class="mt-0.5 block text-[10px]">{{ field.status }}</span></dt><dd class="min-w-0 whitespace-pre-wrap break-words font-medium text-gray-800 dark:text-gray-200">{{ field.value }}</dd></div>
    </dl>
    <p v-if="!researchView.stale && researchView.research.state!=='applied' && researchView.research.report.question" class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ researchView.research.report.question }}</p>
    <p class="text-[11px] leading-relaxed text-gray-500">{{ researchFooter }}</p>
   </article>
   <p v-else-if="researchView?.research && ['queued','working','failed'].includes(researchView.research.state)" data-chat-research-progress role="status" class="flex items-start gap-2 text-xs leading-relaxed text-gray-500"><Loader2 v-if="researchView.research.state!=='failed'" class="h-3.5 w-3.5 shrink-0 animate-spin text-primary-main" />{{ researchProgress }}</p>
   <details v-if="panel" data-chat-research-details class="text-xs" :open="!researchView?.research?.report && !!current?.research?.requestId"><summary class="cursor-pointer py-2 font-medium text-primary-main">{{ korean ? '조사 근거와 후보 반영' : '調査の根拠・候補の反映' }}</summary><PurchaseResearch :draft="draft" :disabled="dirty || busy || draft.locked" :active="active" :research-request="current?.research?.requestId || ''" @updated="value => researchView=value" @changed="value => emit('saved',value)" /></details>
   <p v-if="waiting" role="status" class="flex items-center gap-2 text-xs text-gray-500"><Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-primary-main" />{{ conversation?.state==='confirming'?'下書きへの反映を確認しています…':!data?.connected?'メッセージは保存済みです。AIへの接続が戻ると続けます。':conversation?.state==='queued'?'メッセージは保存済みです。AIの受付を待っています…':'元の明細と過去の判断を確認しています…' }}</p>
   <p v-if="turns.length>=(conversation?.turnLimit||100)" data-chat-turn-limit class="text-xs text-amber-700 dark:text-amber-400">この会話は{{ conversation?.turnLimit||100 }}件に達しました。「新しい会話」で続けてください。これまでの会話と提案は「履歴」に残ります。</p>
   <div v-if="conversation?.state==='failed'" class="text-xs text-amber-700 dark:text-amber-400"><p>回答を取得できませんでした。メッセージは保存されています。</p><button type="button" class="mt-2 text-primary-main underline" :disabled="busy || unavailable" @click="retry">もう一度回答を取得</button></div>
   <!-- A reply or research result that arrived while the reader was further up: the place is kept, this jumps to it only when asked. -->
   <div v-if="jump" class="pointer-events-none sticky bottom-0 z-[1] flex justify-end"><button type="button" data-navi-reply-jump class="pointer-events-auto rounded-full border border-primary-main/40 bg-white px-3 py-1 text-xs font-medium text-primary-main shadow-sm hover:bg-primary-main/10 dark:bg-slate-800" @click="reveal">新しい回答 <span aria-hidden="true">↓</span></button></div>
  </div>
  <form v-show="view==='chat'" class="shrink-0 border-t border-gray-100 px-4 py-4 dark:border-white/10 sm:px-6" @submit.prevent="send">
   <p v-if="error" role="alert" class="mb-3 text-xs text-red-600 dark:text-red-400">{{ error }}</p>
   <p v-if="pendingRequest&&!busy&&!waiting&&!heldElsewhere" data-chat-pending-hint class="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">この送信の結果はまだ確認できていません。「送信結果を確認」でもう一度確かめるか、「新しい会話」で確認できます（受け付け済みなら結果を履歴に表示し、未受付なら入力した文はそのまま残ります）。</p>
   <p v-if="heldElsewhere&&!busy&&!waiting" data-chat-pending-held class="mb-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">この送信は別の会社を選択していたときのものなので、今の選択では送りません。元の会社を選び直すと「送信結果を確認」で確かめられます。「新しい会話」では今の選択のまま結果を確認できます（未受付なら入力した文はそのまま残ります）。</p>
   <p v-if="data?.stale" class="mb-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">下書きや判断の根拠が更新されています。最新の内容で新しいメッセージを送信してください。</p>
   <component :is="panel&&compact?'details':'p'" v-if="data" data-chat-posting-company :data-chat-posting-company-id="data.postingCompany?.organizationId || ''" class="mb-3 break-words text-[11px] leading-relaxed text-gray-500 dark:text-gray-400"><summary v-if="panel&&compact" :title="data.postingCompany ? '帳簿への登録先：'+data.postingCompany.name : '帳簿への登録先：会社未選択'">{{ data.postingCompany ? '帳簿への登録先：'+data.postingCompany.name : '帳簿への登録先：会社未選択' }}</summary><span :class="panel&&compact?'purchase-posting-explanation':''">{{ data.postingCompany ? '帳簿への登録先：'+data.postingCompany.name+'（送信時の会社。帳簿への登録の指示だけに使います）' : '帳簿への登録先の会社が選択されていません。相談・下書きの保存・承認はこのまま続けられます。帳簿に登録するときは会社を選択してから指示してください。' }}</span></component>
   <div :class="panel&&compact?'purchase-composer-compact':''">
   <label for="purchase-chat-message" class="sr-only">購入内容を説明する</label>
   <textarea id="purchase-chat-message" v-model="text" :rows="panel&&compact?1:2" maxlength="2000" class="chat-input" :placeholder="panel&&compact?'購入内容を説明する…':'例：OMJ10が頼んだコートです。今回は…'" :disabled="unavailable || waiting || busy" @keydown.ctrl.enter.prevent="send" />
   <div class="mt-3 flex items-center justify-between gap-3"><p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{{ dirty?'先に下書きの変更を保存してください。':draft.locked?'登録済みの明細です。':!data?'接続を確認しています…':!data.connected?'このカードのAIに接続できません。会話は保存されています。':'提案を確認すると下書きに反映します。' }}</p><button type="submit" data-chat-send class="btn btn-primary shrink-0 text-xs" :disabled="(!text.trim() && !pendingRequest) || unavailable || waiting || busy || heldElsewhere"><Send class="mr-1.5 h-3.5 w-3.5" />{{ pendingRequest ? '送信結果を確認' : '送信' }}</button></div>
   </div>
  </form>
 </section>
</template>
<script setup lang="ts">
import PurchaseResearch from '~/components/finance/PurchaseResearch.vue'
import { Loader2, Send } from 'lucide-vue-next'
import NaviAvatar from './NaviAvatar.vue'
import { useUserStore } from '~/stores/user'
import { tokenClaims } from '~/utils/auth-session'
import { useAssistantStore } from '~/stores/assistant'
import { purchaseQuestions } from '~/shared/finance-answers.mjs'
import { reusableClassification } from '~/shared/finance-chat.mjs'
import { researchFields } from '~/shared/finance-research.mjs'
import { useNaviReplyVisibility } from '~/composables/useNaviReplyVisibility'
const props=withDefaults(defineProps<{draft:any,dirty:boolean,panel?:boolean,compact?:boolean,active?:boolean}>(),{panel:false,compact:false,active:true}),emit=defineEmits<{saved:[draft:any]}>(),user=useUserStore()
const assistant=useAssistantStore(),bufferKey='draft:'+props.draft.importId+':'+props.draft.line
const text=computed({get:()=>assistant.buffers[bufferKey]||'',set:v=>assistant.buffers[bufferKey]=v})
const data=ref<any>(null),error=ref(''),busy=ref(false),remember=ref(false),transcript=ref<HTMLElement|null>(null)
const researchView=ref<any>(null),researchReply=ref<HTMLElement|null>(null)
const endpoint=computed(()=>'/api/finance-chat/imports/'+props.draft.importId+'/drafts/'+props.draft.line)
const conversation=computed(()=>data.value?.conversation),turns=computed(()=>conversation.value?.turns || [])
const current=computed(()=>turns.value.find((t:any)=>t.id===conversation.value?.currentId))
const waiting=computed(()=>['queued','working','confirming'].includes(conversation.value?.state))
const blocked=computed(()=>props.dirty||props.draft.locked||props.draft.source.kind!=='expense')
const unavailable=computed(()=>blocked.value||!data.value?.connected)
const canRemember=computed(()=>reusableClassification(current.value?.proposal,{...props.draft.values,...current.value?.proposal?.patch}))
const opening=computed(()=>purchaseQuestions(props.draft).question || '구매 내용을 더 설명하거나, 현재 판단을 수정할 수 있어요.')
const labels:Record<string,string>={purpose:'用途',customerId:'顧客',productName:'商品名'}
const display=(key:string,value:any)=>key==='purpose'?({customer:'顧客購入',company:'会社経費',unresolved:'未確認'}[value]||value):key==='customerId'?props.draft.references.customers.find((c:any)=>c._id===value)?.name || '空欄':value
const korean=computed(()=>/[가-힣]/.test(researchView.value?.research?.report?.summary || current.value?.text || ''))
const researchProgress=computed(()=>{const r=researchView.value?.research;if(r?.state==='failed')return korean.value?'조사를 완료하지 못했어요. 아래 조사 내역에서 다시 시도할 수 있어요.':'調査を完了できませんでした。下の調査詳細から再試行できます。';if(r?.state==='queued')return korean.value?'조사를 기다리고 있어요.':'調査の受付を待っています。';const stage=r?.events?.at(-1)?.stage;return korean.value?({mail:'구매 메일을 확인하고 있어요.',web:'회사와 공개 자료를 확인하고 있어요.',document:'구매 서류를 확인하고 있어요.',registry:'인보이스 등록을 확인하고 있어요.'} as any)[stage]||'자료를 조사하고 있어요.':({mail:'購入メールを確認しています。',web:'会社と公開資料を確認しています。',document:'購入書類を確認しています。',registry:'インボイス登録を確認しています。'} as any)[stage]||'資料を調べています。'})
function researchStatus(turn:any){const ko=/[가-힣]/.test(turn.text||'');if(turn.research.requestId){if(turn.id===conversation.value?.currentId&&researchView.value?.research){if(researchView.value.research.state==='applied')return ko?'후보를 반영한 조사 기록이 아래에 있어요.':'候補を反映した際の調査記録が下にあります。';if(researchView.value.stale)return ko?'이전 조사 결과가 있어요. 현재 내용은 다시 확인해야 해요.':'以前の調査結果があります。現在の内容は再確認が必要です。';if(researchView.value.research.report)return ko?'조사를 마쳤어요. 아래 답변에서 확인할 수 있어요.':'調査が終わりました。下の回答で確認できます。';return researchProgress.value}return ko?'이 메시지에서 조사를 요청했어요.':'このメッセージから調査を依頼しました。'}return turn.research.unavailable?(ko?'조사를 시작하지 못했어요: ':'調査を開始できませんでした：')+turn.research.unavailable:ko?'미리보기를 확인하면 조사를 시작해요.':'確認すると調査を開始します。'}
const researchFooter=computed(()=>researchView.value?.research?.state==='applied'
 ? (korean.value?'확인한 후보는 아래 조사 내역에서 볼 수 있어요.':'反映した項目は下の調査詳細で確認できます。')
 : researchView.value?.stale
 ? (korean.value?'이전 후보는 바로 반영할 수 없어요. 아래 조사 내역에서 다시 조사해 주세요.':'以前の候補はそのまま反映できません。下の調査詳細から再調査してください。')
 : (korean.value?'후보는 아직 저장하지 않았어요. 아래에서 근거를 확인하고 반영할 수 있어요.':'候補はまだ保存していません。下で根拠を確認して反映できます。'))
const resultFields=computed(()=>{
 const research=researchView.value?.research,report=research?.report;if(!report)return []
 const keys=['accountCategoryId','subAccountCategoryId','transactionCategoryId','taxCategoryId','taxRate','invoiceNumber','supplierId']
 const extras=report.findings.map((f:any)=>f.field).filter((key:string)=>!keys.includes(key))
 return [...keys,...extras].map(key=>{
  const field=researchFields.find(f=>f.key===key),finding=report.findings.find((f:any)=>f.field===key)
  const clear=!!finding&&(finding.value===''||finding.value===null)
  let value=finding?.value,status=finding?(korean.value?'후보':'候補'):'',candidate=!!finding
  if(!finding&&key==='supplierId'&&report.supplier){
   value=report.supplier.legalName;candidate=!research.supplierId
   status=research.supplierId?(korean.value?'거래처 저장됨':'仕入れ先に保存済み'):(korean.value?'후보 · 미저장':'候補・未保存')
  }else if(!finding&&key==='invoiceNumber'&&report.supplier?.invoiceNumber){
   value=report.supplier.invoiceNumber;status=korean.value?'영수증·자료의 후보':'資料記載の候補';candidate=true
  }else if(!finding){
   value=props.draft.values[key];if(value!==''&&value!==null&&value!==undefined)status=korean.value?'현재 입력값 · 조사 확인 아님':'現在の入力値・調査確認ではありません'
  }
  if(field?.ref&&value&&!(key==='supplierId'&&report.supplier&&!finding))value=props.draft.references[field.ref]?.find((r:any)=>String(r._id)===value)?.name||value
  if(key==='purpose')value=display(key,value)
  const shown=clear?(korean.value?'비우기':'空欄にする'):value===''||value===null||value===undefined?(korean.value?'미확인':'未確認'):value
  return {key,label:field?.label||key,value:shown,status,candidate}
 })
})
const bind=()=>({revision:props.draft.revision,key:props.draft.key,sourceHash:props.draft.sourceHash,chatRevision:conversation.value?.revision||0})
const message=(e:any)=>e.data?.data?.message||'会話を取得できませんでした。もう一度お試しください。'
// The proposals on screen when the owner sends a command are frozen into the request: the unconfirmed proposal of the latest turn and
// the current (not stale, not applied) research report. The server validates and stores exactly these; a later change is refused, never
// substituted.
const displayedReferences=()=>{const refs:any[]=[];const turn=current.value;if(turn?.proposal?.kind==='proposal'&&!turn.confirmedAt&&turn.reference)refs.push(turn.reference);const r=researchView.value?.research;if(r?.report&&r.reference&&!researchView.value?.stale&&r.state!=='applied')refs.push(r.reference);return refs}
// History and new chat of this purchase's conversation: component memory only (nothing financial in browser storage). A new chat resets
// the conversation, never the draft; an archived proposal is shown as a record and cannot be confirmed or referenced.
const view=ref<'chat'|'history'>('chat'),archives=ref<any[]>([]),archive=ref<any>(null),historyLoaded=ref(false),historyPage=ref(1),historyMore=ref(false)
const withheldText='別の会社（または会社未選択）の会社の記憶を使ったやりとりのため、ここでは表示しません。その会社を選択すると表示されます。'
const formatDate=(v:any)=>v?new Date(v).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')
// History shows the archived conversation that holds an already accepted request, with that turn framed (component memory only). The
// server reads at most a bounded number of archives: a capped count (occurrencesTruncated) is shown as a lower bound, never as exact.
const received=ref<{archiveId:string,requestId:string,occurrences:number,truncated:boolean}|null>(null),historyBox=ref<HTMLElement|null>(null)
// The New chat request frozen at its first press: its id and the uncertain request it names, reused after a lost reply.
let resetRequest:null|{id:string,pending:any}=null
async function loadHistory(page=1){const org=selectedOrg();try{const r:any=await $fetch(endpoint.value+'/history',{headers:user.authHeader,query:{page}});if(disposed||org!==selectedOrg())return;archives.value=page===1?r.archives:[...archives.value,...r.archives];historyPage.value=r.page;historyMore.value=r.hasMore;historyLoaded.value=true}catch(e){if(!disposed)error.value=message(e)}}
function openHistory(){view.value='history';archive.value=null;loadHistory(1)}
async function openArchive(id:string){const org=selectedOrg();try{const r:any=await $fetch(endpoint.value+'/history/'+id,{headers:user.authHeader});if(!disposed&&org===selectedOrg()&&view.value==='history'){archive.value=r.archive;if(received.value?.archiveId===id)nextTick(revealReceived)}}catch(e){if(!disposed)error.value=message(e)}}
// Explicit new chat names the uncertain request with its frozen meaning (id, text, draft binding, displayed references), frozen with the
// reset id at its first press and reused after a lost reply; a refused one (an HTTP status) is dropped and the request stays uncertain.
// It is available with an uncertain request even with no turns or no conversation yet; the server's answer for exactly that request is
// applied by settle(). Only the conversation resets, never the draft, and nothing is sent.
async function newChat(){const pending=pendingRequest.value;if(busy.value||waiting.value||(!conversation.value&&!pending))return;if(!resetRequest)resetRequest={id:randomId(),pending};const request=resetRequest;await act(async()=>{const org=selectedOrg();try{const result:any=await $fetch(endpoint.value+'/new',{method:'POST',headers:user.authHeader,body:{chatRevision:conversation.value?.revision||0,requestId:request.id,...(request.pending?{pending:{requestId:request.pending.id,text:request.pending.text,...request.pending.binding,references:request.pending.references}}:{})}});resetRequest=null;if(disposed||org!==selectedOrg())return;data.value=result;assistant.clearNaviStatus();view.value='chat';archive.value=null;archives.value=[];historyLoaded.value=false;if(result?.reset?.requestId===request.id)settle(request.pending,result.reset.pending,org)}catch(e:any){if(e?.statusCode||e?.status)resetRequest=null;throw e}})}
const actionNames:Record<string,string>={remember_company_knowledge:'会社の記憶を保存',correct_company_knowledge:'会社の記憶を訂正',set_company_knowledge_status:'会社の記憶の適用を変更',save_draft_fields:'下書きを保存',apply_referenced_proposal:'提案を下書きに反映',remember_accounting_fields:'科目を記憶',remember_customer_purpose:'顧客・用途を記憶',set_memory_status:'記憶の適用を変更',approve_draft:'下書きを確認',post_selected_approved_rows:'帳簿に登録',start_purchase_research:'調査を依頼'}
const actionStates:Record<string,string>={done:'完了',queued:'受付済み',working:'処理中…',failed:'できませんでした',unresolved:'結果の確認が必要です'}
const actionLabel=(a:any)=>(actionNames[a.name]||a.name)+'：'+(actionStates[a.state]||a.state)+(a.acceptedRevision?'（下書き改訂 '+a.acceptedRevision+'）':'')+(a.requestedFields?.length&&a.state==='done'?' · '+a.requestedFields.map((f:string)=>fieldLabels[f]||labels[f]||f).join('・'):'')+(a.safeError?' · '+a.safeError:'')
const fieldLabels:Record<string,string>=Object.fromEntries(researchFields.map(f=>[f.key,f.label]))
// A completed write on this purchase refreshes the draft the page shows (fetched fresh; the receipt is history, not state), once per
// operation: from the live turns, or from the archived turn of an accepted request answered from History.
const refreshed=new Set<string>()
async function refreshAfterActions(receipts:any[]=turns.value.flatMap((t:any)=>t.actions||[])){for(const a of receipts){if(a.state!=='done'||refreshed.has(a.operationId)||!['save_draft_fields','apply_referenced_proposal','approve_draft'].includes(a.name))continue;refreshed.add(a.operationId);if(a.acceptedRevision&&a.acceptedRevision<=props.draft.revision)continue;try{const d:any=await $fetch('/api/finance/imports/'+props.draft.importId+'/drafts/'+props.draft.line,{headers:user.authHeader});if(!disposed)emit('saved',d)}catch{}}}
let loadTicket=0
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false
// The view depends on the selected company (posting destination and company-teaching masking): a response requested under one
// selection is dropped when the selection changed before it arrived.
const selectedOrg=()=>String(tokenClaims(user.token)?.organizationId||'')
// The actor and selection the shown data was loaded under: replies are acknowledged only while both are still current.
const actorId=String(tokenClaims(user.token)?.userId||''),dataOrg=ref('')
// The uncertain send of this purchase (store memory only, never browser storage): its id, exact text and composer text, the draft binding
// and displayed proposal references it was sent with, and the company selection it was made under. Every later press sends exactly this
// request (an edited composer text stays for later) until an authoritative answer for this same object: the current view showing its
// turn (id and text), an accepted answer from History, or a New chat's "not accepted". It is never sent under another company selection
// (the posting destination its turn would freeze).
const pendingRequest=computed(()=>assistant.pending[bufferKey]||null)
const heldElsewhere=computed(()=>!!pendingRequest.value&&pendingRequest.value.org!==String(tokenClaims(user.token)?.organizationId||''))
function acknowledge(result:any){const p=assistant.pending[bufferKey];if(p&&result?.conversation?.turns?.some((t:any)=>t.id===p.id&&t.text===p.text)){if(text.value===p.rawText)text.value='';delete assistant.pending[bufferKey]}}
// An authoritative answer about exactly the request a press named (same id, this actor, the purchase realm, this purchase and its shown
// conversation, under the selection it was requested in), applied only while that same pending object is still the current one.
// Accepted: released, its text cleared only if unchanged, its archived turn and receipts shown in History and the draft page refreshed
// from its completed draft writes. Not accepted (fenced by New chat): released, the typed text kept (an emptied composer gets it back).
// Nothing is sent; any other answer changes nothing.
function settle(request:any,answer:any,org:string){if(disposed||!request||!answer||assistant.pending[bufferKey]!==request||answer.requestId!==request.id||org!==selectedOrg())return
 if(answer.scope?.actorId!==actorId||answer.scope?.realm!=='purchase'||answer.scope?.importId!==String(props.draft.importId)||answer.scope?.line!==props.draft.line||answer.scope?.conversationId!==String(conversation.value?.id||''))return
 if(answer.outcome==='accepted'){delete assistant.pending[bufferKey];if(text.value===request.rawText)text.value='';if(answer.where==='archive'&&answer.archive?.id){refreshAfterActions(answer.turn?.actions||[]);showReceived(answer)}}
 else if(answer.outcome==='not_accepted'){delete assistant.pending[bufferKey];if(!text.value.trim())text.value=request.rawText}}
function showReceived(answer:any){openHistory();received.value={archiveId:String(answer.archive.id),requestId:String(answer.requestId),occurrences:Number(answer.occurrences)||1,truncated:answer.occurrencesTruncated===true};openArchive(String(answer.archive.id))}
// Scrolls only the History list itself to the framed turn (never the page behind the rail).
function revealReceived(){const box=historyBox.value,turn=box?.querySelector('[data-chat-archived-request]');if(box&&turn)box.scrollTop+=turn.getBoundingClientRect().top-box.getBoundingClientRect().top-8}
watch(view,v=>{if(v!=='history')received.value=null})
async function load(){const ticket=++loadTicket,org=selectedOrg();try{const result=await $fetch(endpoint.value,{headers:user.authHeader});if(!disposed&&ticket===loadTicket&&org===selectedOrg()){data.value=result;dataOrg.value=org;acknowledge(result);await refreshAfterActions()}}catch(e){if(!disposed&&ticket===loadTicket)error.value=message(e)}}
function schedule(){timer=setTimeout(async()=>{if(disposed)return;if(props.active&&!busy.value)await load();if(!disposed)schedule()},4000)}
// Explicit send, confirmation, retry and new chat still scroll to the latest (the reader asked for it).
async function act(action:()=>Promise<void>){busy.value=true;loadTicket++;error.value='';const org=selectedOrg();try{await action();dataOrg.value=org;follow()}catch(e){error.value=message(e)}finally{busy.value=false}}
// A press sends the uncertain request when there is one (frozen: id, text, draft binding, references; never the edited composer text),
// otherwise a new request from the composer, the current draft binding and the displayed references. No failure releases it, the first
// attempt's included: a lost or failed reply and an HTTP refusal alike keep the same uncertain request (the send's one storing write is
// followed by a fresh read of the draft and the conversation that can itself refuse with 409, so no status proves nothing was stored;
// the purchase send carries no per-request not-stored acknowledgement). Only an authoritative answer releases it (settle/acknowledge).
async function send(){const held=pendingRequest.value;if((!text.value.trim()&&!held)||unavailable.value||waiting.value||busy.value||heldElsewhere.value)return;if(!held)assistant.pending[bufferKey]={id:randomId(),text:text.value.trim(),rawText:text.value,references:displayedReferences(),binding:{revision:props.draft.revision,key:props.draft.key,sourceHash:props.draft.sourceHash},org:selectedOrg()};const request=assistant.pending[bufferKey];await act(async()=>{const org=selectedOrg();const result:any=await $fetch(endpoint.value,{method:'POST',headers:user.authHeader,body:{...request.binding,chatRevision:conversation.value?.revision||0,text:request.text,requestId:request.id,references:request.references}});if(disposed||org!==selectedOrg())return;data.value=result;remember.value=false;acknowledge(result);settle(request,result?.received,org)})}
async function confirm(){await act(async()=>{const result:any=await $fetch(endpoint.value+'/confirm',{method:'POST',headers:user.authHeader,body:{...bind(),turnId:current.value.id,remember:remember.value}});data.value=result;emit('saved',result.draft);remember.value=false})}
async function retry(){await act(async()=>{data.value=await $fetch(endpoint.value+'/retry',{method:'POST',headers:user.authHeader,body:bind()})})}
onMounted(async()=>{await load();if(!disposed)schedule()});onBeforeUnmount(()=>{disposed=true;loadTicket++;clearTimeout(timer)})
watch(()=>props.active,value=>{if(value)load()})
watch(()=>tokenClaims(user.token)?.organizationId,()=>{if(disposed)return;loadTicket++;archive.value=null;archives.value=[];historyLoaded.value=false;if(view.value==='history')loadHistory(1);load()})
watch(()=>props.draft.revision,()=>{remember.value=false;load()})
// Exact read state of the live replies and the linked research result actually visible in this open chat view
// (useNaviReplyVisibility), for the actor, selection and purchase this transcript was loaded for. A reply or a research completion that
// arrives on its own follows only a reader already at the latest (the research result is brought to its start as before); an older
// reader keeps the place and gets the jump control.
const {jump,follow,arrived,reveal,replyMark,researchMark}=useNaviReplyVisibility({log:transcript,allowed:()=>!disposed&&props.active&&view.value==='chat'&&user.isAuthenticated&&String(tokenClaims(user.token)?.userId||'')===actorId&&!!conversation.value&&dataOrg.value===selectedOrg(),
 target:()=>({realm:'purchase',actorId,organizationId:selectedOrg(),importId:props.draft.importId,line:props.draft.line,endpoint:endpoint.value}),
 conversation:()=>conversation.value?{id:String(conversation.value.id),segment:conversation.value.segment||0}:null,changes:()=>[data.value,researchView.value]})
watch(()=>current.value?.answeredAt,()=>arrived())
watch(()=>researchView.value?.research?.report?[researchView.value.research.id,researchView.value.research.revision,!!researchView.value.stale].join(':'):'',value=>{if(!value||!props.active)return;arrived(()=>researchReply.value)})
</script>
<style scoped>
.chat-input { @apply block w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-primary-main focus:outline-none focus:ring-1 focus:ring-primary-main disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-100; min-height:82px; }
</style>

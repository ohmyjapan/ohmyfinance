<template>
 <section :data-assistant-scope="scope.key" class="flex min-h-0 flex-1 flex-col" aria-label="OMFの会話">
  <p v-if="scope.company" data-assistant-company-status class="shrink-0 px-5 pt-3 text-xs text-gray-500">{{ !scope.organizationId ? '会社を選択してから相談してください。' : data?.company?.name ? data.company.name+'の会話 · 請求書・支払い予定の確認' : '会社へのアクセスを確認しています…' }}</p>
  <div ref="transcript" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" role="log" aria-live="polite">
   <div v-if="!turns.length" class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"><p>지금 보고 있는 화면에 대해 물어보세요. 기록과 판단의 근거를 함께 확인할 수 있어요.</p><div class="mt-5 flex flex-wrap gap-2"><button v-for="example in examples" :key="example" class="rounded-xl border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:border-primary-main dark:border-white/10 dark:text-gray-300" @click="text=example">{{ example }}</button></div></div>
   <article v-for="turn in turns" :key="turn.id" data-workspace-turn class="space-y-3"><div class="ml-5 rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 dark:bg-white/10"><p class="mb-1 text-[11px] text-gray-500">{{ turn.pageName }}<span v-if="turn.selection"> · {{ turn.selection }}</span></p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-100">{{ turn.text }}</p></div><ul v-if="turn.actions?.length" data-workspace-actions class="space-y-1 text-xs"><li v-for="a in turn.actions" :key="a.operationId" :data-workspace-action-state="a.state" class="flex items-start gap-2" :class="a.state==='failed' || a.state==='unresolved' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500'"><Loader2 v-if="a.state==='working'" class="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary-main" /><span>{{ actionLabel(a) }}</span></li></ul><div v-if="turn.proposal"><p class="mb-1 text-[11px] font-semibold text-primary-main">OMF</p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-200">{{ turn.proposal.summary }}</p></div></article>
   <p v-if="waiting" class="flex items-center gap-2 text-xs text-gray-500" role="status"><Loader2 class="h-4 w-4 shrink-0 animate-spin text-primary-main" />{{ !data?.connected?'メッセージは保存済みです。AIへの接続が戻ると続けます。':data.conversation.state==='queued'?'メッセージは保存済みです。AIの受付を待っています…':'記録と会話を確認しています…' }}</p>
   <div v-if="data?.conversation?.state==='failed'" class="text-xs text-amber-700"><p>回答を取得できませんでした。会話は保存されています。</p><button class="mt-2 text-primary-main underline" :disabled="busy||!data?.connected" @click="retry">もう一度取得する</button></div>
  </div>
  <form class="shrink-0 border-t border-gray-100 p-4 dark:border-white/10" @submit.prevent="send">
   <p v-if="error" role="alert" class="mb-3 text-xs text-red-600">{{ error }}</p>
   <label for="assistant-message" class="sr-only">OMFへのメッセージ</label><textarea id="assistant-message" v-model="text" rows="3" maxlength="2000" placeholder="この判断の理由は？ / 이 화면에서…" class="assistant-input" :disabled="busy||waiting||!data?.connected" @keydown.ctrl.enter.prevent="send" />
   <div class="mt-3 flex items-center justify-between gap-3"><p class="text-[11px] text-gray-500">{{ !data?'接続を確認しています…':data.connected?'한국어・日本語 · 会話を保存します':'AIに接続できません。会話は保存されています。' }}</p><button type="submit" data-assistant-send class="btn btn-primary shrink-0 text-xs" :disabled="busy||waiting||!data?.connected||(!text.trim()&&!assistant.pending[bufferKey])"><Send class="mr-1 h-3.5 w-3.5" />{{ assistant.pending[bufferKey]?'送信結果を確認':'送信' }}</button></div>
  </form>
 </section>
</template>
<script setup lang="ts">
import {Loader2,Send} from 'lucide-vue-next'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {tokenClaims} from '~/utils/auth-session'
const props=defineProps<{context:any,active:boolean,scope:{key:string,company:boolean,actorId:string,organizationId:string}}>(),user=useUserStore(),assistant=useAssistantStore()
const data=ref<any>(null),error=ref(''),busy=ref(false),transcript=ref<HTMLElement|null>(null)
const scope={...props.scope},bufferKey=scope.company?scope.key:'workspace'
const text=computed({get:()=>assistant.buffers[bufferKey]||'',set:v=>assistant.buffers[bufferKey]=v})
const turns=computed(()=>data.value?.conversation?.turns||[]),waiting=computed(()=>['queued','working'].includes(data.value?.conversation?.state))
const examples=scope.company?['この会社の請求書を確認して。','支払い予定と確認が必要な点を教えて。']: ['マッピングと取引一覧はどう違う？','AとBの判断にはどんな違いがある？','지금 선택한 규칙의 근거를 설명해 줘.']
const endpoint=scope.company?'/api/finance-chat/company-workspace':'/api/finance-chat/workspace',message=(e:any)=>scope.company&&[401,403].includes(e.statusCode||e.status)?'会社へのアクセスを確認できません。所属と選択した会社を確認してください。':e.data?.data?.message||'会話を取得できませんでした。'
function failed(e:any){error.value=message(e);if(scope.company&&[401,403].includes(e.statusCode||e.status))data.value=null}
const actionNames:Record<string,string>={save_draft_fields:'下書きを保存',remember_accounting_fields:'科目を記憶',remember_customer_purpose:'顧客・用途を記憶',set_memory_status:'記憶の適用を変更',approve_draft:'下書きを確認',post_selected_approved_rows:'帳簿に登録',start_purchase_research:'調査を依頼',create_intake_record:'受付を作成',patch_intake_record:'受付を保存',set_intake_archived:'受付のアーカイブを変更',apply_intake_import:'受付ファイルを取込',save_intake_template:'取込テンプレートを保存',start_intake_research:'会社・T番号の調査を依頼',confirm_intake_research:'調査結果を受付に保存'}
const actionStates:Record<string,string>={done:'完了',queued:'受付済み',working:'処理中…',failed:'できませんでした',unresolved:'結果の確認が必要です'}
const actionLabel=(a:any)=>(actionNames[a.name]||a.name)+'：'+(actionStates[a.state]||a.state)+(a.target?.line?'（'+a.target.line+'行目'+(a.acceptedRevision?'・下書き改訂 '+a.acceptedRevision:'')+'）':a.acceptedRevision?'（改訂 '+a.acceptedRevision+'）':'')+(a.safeError?' · '+a.safeError:'')
// A completed write names its purchase; that purchase is fetched fresh and handed to the store, which refreshes the draft page only if
// it shows that same purchase and has no unsaved edits (the receipt itself is history, not state). Once per operation.
const refreshed=new Set<string>()
async function refreshAfterActions(){const intakeReceipts:any[]=[];for(const turn of turns.value)for(const a of turn.actions||[]){
 if(refreshed.has(a.operationId))continue
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
 if(!assistant.pending[bufferKey])assistant.pending[bufferKey]={id:Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join(''),text:text.value.trim(),rawText:text.value,context:JSON.parse(JSON.stringify(props.context))}
 const request=assistant.pending[bufferKey];const result=await $fetch(endpoint,{method:'POST',headers:user.authHeader,body:{text:request.text,requestId:request.id,context:request.context,chatRevision:data.value?.conversation?.revision||0}});if(current())accept(result)
}catch(e){if(current())failed(e)}finally{busy.value=false}}
async function retry(){if(!current()||busy.value)return;busy.value=true;error.value='';ticket++;try{const result=await $fetch(endpoint+'/retry',{method:'POST',headers:user.authHeader,body:{chatRevision:data.value.conversation.revision}});if(current())accept(result)}catch(e){if(current())failed(e)}finally{busy.value=false}}
onMounted(async()=>{await load();if(!disposed)schedule()});onBeforeUnmount(()=>{disposed=true;ticket++;clearTimeout(timer)});watch(()=>props.active,v=>{if(v)load()})
watch(()=>[turns.value.length,turns.value.at(-1)?.answeredAt],async()=>{await nextTick();transcript.value?.scrollTo({top:transcript.value.scrollHeight,behavior:'smooth'})})
</script>

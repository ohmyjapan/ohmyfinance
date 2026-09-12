<template>
 <section :class="panel ? 'flex min-h-0 flex-1 flex-col' : 'card mb-6 overflow-hidden'" aria-label="OMFと相談">
  <header v-if="!panel" class="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-white/10 sm:px-6">
   <div class="flex items-center gap-3"><span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-main/10 text-primary-main"><MessageCircle class="h-4 w-4" /></span><div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">OMFと相談</h2><p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">購入の説明も、判断の修正も、ここから。</p></div></div>
   <NuxtLink to="/learning" class="shrink-0 py-1 text-xs text-primary-main">学習ノート ↗</NuxtLink>
  </header>
  <div ref="transcript" :class="panel ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5' : 'max-h-[520px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6'" role="log" aria-live="polite">
   <div v-if="!turns.length" class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"><p>{{ opening }}</p><p class="mt-2 text-xs text-gray-500 dark:text-gray-400">한국어・日本語で説明できます。会話はこの明細に保存されます。</p></div>
   <article v-for="turn in turns" :key="turn.id" :data-chat-turn="turn.id" class="space-y-3">
    <div class="ml-6 rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 dark:bg-white/10"><p class="mb-1 text-[11px] font-medium text-gray-500">あなた</p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-200">{{ turn.text }}</p></div>
    <div v-if="turn.proposal" class="mr-2"><p class="mb-1 text-[11px] font-semibold text-primary-main">OMF</p><p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ turn.proposal.summary }}</p>
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
   <p v-if="waiting" role="status" class="flex items-center gap-2 text-xs text-gray-500"><Loader2 class="h-3.5 w-3.5 animate-spin text-primary-main" />{{ conversation?.state==='confirming'?'下書きへの反映を確認しています…':'元の明細と過去の判断を確認しています…' }}</p>
   <div v-if="conversation?.state==='failed'" class="text-xs text-amber-700 dark:text-amber-400"><p>回答を取得できませんでした。メッセージは保存されています。</p><button type="button" class="mt-2 text-primary-main underline" :disabled="busy || unavailable" @click="retry">もう一度回答を取得</button></div>
  </div>
  <form class="shrink-0 border-t border-gray-100 px-4 py-4 dark:border-white/10 sm:px-6" @submit.prevent="send">
   <p v-if="error" role="alert" class="mb-3 text-xs text-red-600 dark:text-red-400">{{ error }}</p>
   <p v-if="data?.stale" class="mb-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">下書きや判断の根拠が更新されています。最新の内容で新しいメッセージを送信してください。</p>
   <label for="purchase-chat-message" class="sr-only">購入内容を説明する</label>
   <textarea id="purchase-chat-message" v-model="text" rows="2" maxlength="2000" class="chat-input" placeholder="例：OMJ10が頼んだコートです。今回は…" :disabled="unavailable || waiting || busy" @keydown.ctrl.enter.prevent="send" />
   <div class="mt-3 flex items-center justify-between gap-3"><p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{{ dirty?'先に下書きの変更を保存してください。':draft.locked?'登録済みの明細です。':!data?.connected?'AIへの接続を確認しています…':'提案を確認すると下書きに反映します。' }}</p><button type="submit" data-chat-send class="btn btn-primary shrink-0 text-xs" :disabled="!text.trim() || unavailable || waiting || busy"><Send class="mr-1.5 h-3.5 w-3.5" />送信</button></div>
  </form>
 </section>
</template>
<script setup lang="ts">
import { MessageCircle, Loader2, Send } from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { purchaseQuestions } from '~/shared/finance-answers.mjs'
import { reusableClassification } from '~/shared/finance-chat.mjs'
const props=withDefaults(defineProps<{draft:any,dirty:boolean,panel?:boolean,active?:boolean}>(),{panel:false,active:true}),emit=defineEmits<{saved:[draft:any]}>(),user=useUserStore()
const assistant=useAssistantStore(),bufferKey='draft:'+props.draft.importId+':'+props.draft.line
const text=computed({get:()=>assistant.buffers[bufferKey]||'',set:v=>assistant.buffers[bufferKey]=v})
const data=ref<any>(null),error=ref(''),busy=ref(false),remember=ref(false),transcript=ref<HTMLElement|null>(null)
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
const bind=()=>({revision:props.draft.revision,key:props.draft.key,sourceHash:props.draft.sourceHash,chatRevision:conversation.value?.revision||0})
const message=(e:any)=>e.data?.data?.message||'会話を取得できませんでした。もう一度お試しください。'
let loadTicket=0
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,request:{id:string,text:string}|null=null
async function load(){const ticket=++loadTicket;try{const result=await $fetch(endpoint.value,{headers:user.authHeader});if(!disposed&&ticket===loadTicket)data.value=result}catch(e){if(!disposed&&ticket===loadTicket)error.value=message(e)}}
function schedule(){timer=setTimeout(async()=>{if(disposed)return;if(props.active&&!busy.value)await load();if(!disposed)schedule()},4000)}
async function act(action:()=>Promise<void>){busy.value=true;loadTicket++;error.value='';try{await action();await nextTick();transcript.value?.scrollTo({top:transcript.value.scrollHeight,behavior:'smooth'})}catch(e){error.value=message(e)}finally{busy.value=false}}
async function send(){if(!text.value.trim()||unavailable.value||waiting.value||busy.value)return;await act(async()=>{if(!request||request.text!==text.value.trim())request={id:Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join(''),text:text.value.trim()};data.value=await $fetch(endpoint.value,{method:'POST',headers:user.authHeader,body:{...bind(),text:request.text,requestId:request.id}});text.value='';request=null;remember.value=false})}
async function confirm(){await act(async()=>{const result:any=await $fetch(endpoint.value+'/confirm',{method:'POST',headers:user.authHeader,body:{...bind(),turnId:current.value.id,remember:remember.value}});data.value=result;emit('saved',result.draft);remember.value=false})}
async function retry(){await act(async()=>{data.value=await $fetch(endpoint.value+'/retry',{method:'POST',headers:user.authHeader,body:bind()})})}
onMounted(async()=>{await load();if(!disposed)schedule()});onBeforeUnmount(()=>{disposed=true;loadTicket++;clearTimeout(timer)})
watch(()=>props.active,value=>{if(value)load()})
watch(()=>props.draft.revision,()=>{remember.value=false;load()})
watch(()=>current.value?.answeredAt,async()=>{await nextTick();transcript.value?.scrollTo({top:transcript.value.scrollHeight,behavior:'smooth'})})
</script>
<style scoped>
.chat-input { @apply block w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-primary-main focus:outline-none focus:ring-1 focus:ring-primary-main disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-100; min-height:82px; }
</style>

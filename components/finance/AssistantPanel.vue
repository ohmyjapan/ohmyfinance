<template>
 <template v-if="user.isAuthenticated && !isLocked">
  <button v-if="!assistant.open" type="button" data-assistant-toggle class="fixed bottom-5 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-800 shadow-lg hover:border-primary-main focus-visible:outline-primary-main dark:border-white/10 dark:bg-slate-800 dark:text-gray-100 sm:right-6" aria-label="OMFアシスタントを開く" aria-controls="omf-assistant" :aria-expanded="assistant.open" @click="summon"><MessageCircle class="h-4 w-4 text-primary-main" />OMFに相談</button>
  <div v-if="assistant.open && mobile" class="fixed inset-0 z-30 bg-gray-900/25" aria-hidden="true" @click="close" />
  <aside v-show="assistant.open" id="omf-assistant" ref="panel" :role="mobile?'dialog':'complementary'" :aria-modal="mobile?true:undefined" aria-label="OMFアシスタント" class="assistant-panel fixed right-0 top-0 z-40 flex h-[100dvh] w-full min-w-0 flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900 sm:bottom-4 sm:right-4 sm:top-4 sm:h-auto sm:w-[420px] sm:rounded-2xl sm:border" @keydown="keyboard">
   <header class="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10"><div class="flex items-center gap-2.5"><span class="rounded-xl bg-primary-main/10 p-2 text-primary-main"><MessageCircle class="h-4 w-4" /></span><div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">OMFアシスタント</h2><p class="mt-0.5 text-[11px] text-gray-500">いつでも、ここから相談</p></div></div><button ref="closeButton" type="button" data-assistant-close class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label="アシスタントを閉じる" @click="close"><X class="h-4 w-4" /></button></header>
   <div class="shrink-0 border-b border-gray-100 bg-gray-50/70 px-5 py-3 dark:border-white/10 dark:bg-white/5">
    <div class="flex flex-wrap items-center gap-2"><button class="rounded-lg px-2.5 py-1.5 text-xs" :class="assistant.target.kind==='workspace'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100'" data-assistant-general @click="assistant.select({kind:'workspace'})">画面について相談</button><button v-if="currentDraftTarget" class="rounded-lg px-2.5 py-1.5 text-xs text-primary-main hover:bg-primary-main/10" data-assistant-current @click="selectCurrent">この購入について</button></div>
    <p v-if="assistant.target.kind==='workspace'" data-assistant-context class="mt-2 break-words text-xs text-gray-600 dark:text-gray-300">{{ pageName }}<span v-if="selection?.label"> · {{ selection.label }}</span></p>
    <div v-else data-assistant-context class="mt-2 text-xs"><p class="break-words font-medium text-gray-800 dark:text-gray-100">{{ draft?.source.description || '明細を確認中…' }}</p><p v-if="draft" class="mt-1 text-gray-500">{{ draft.source.account.name }} · {{ draft.source.purchaseDate }} · ¥{{ Number(draft.source.amount).toLocaleString('ja-JP') }}</p><NuxtLink v-if="draft" :to="targetPath" class="mt-2 inline-block text-primary-main" @click="mobile && close()">この下書きを開く ↗</NuxtLink><p v-if="route.path!==targetPath" class="mt-2 leading-relaxed text-gray-500">{{ pageName }}に移動しました。相談対象はこの購入のままです。</p></div>
   </div>
   <p v-if="error" role="alert" class="p-5 text-sm text-red-600">{{ error }}<button class="ml-2 underline" @click="loadDraft">再読込</button></p>
   <template v-if="activated">
    <AssistantConversation v-if="assistant.target.kind==='workspace'" :key="user.user?.id" :context="context" :active="assistant.open" />
    <PurchaseChat v-else-if="draft" :key="targetPath" :draft="draft" :dirty="draftDirty" panel :active="assistant.open" @saved="receive" />
    <p v-else-if="!error" class="p-5 text-xs text-gray-500">購入内容を読み込んでいます…</p>
   </template>
  </aside>
 </template>
</template>
<script setup lang="ts">
import {MessageCircle,X} from 'lucide-vue-next'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {useActivityTracker} from '~/composables/useActivityTracker'
import {assistantPage,assistantPages} from '~/shared/finance-assistant.mjs'
import PurchaseChat from './PurchaseChat.vue'
import AssistantConversation from './AssistantConversation.vue'
const user=useUserStore(),assistant=useAssistantStore(),route=useRoute(),{isLocked}=useActivityTracker()
const panel=ref<HTMLElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null),mobile=ref(false),activated=ref(false),loadedDraft=ref<any>(null),error=ref('')
const page=computed(()=>assistantPage(route.path)),pageName=computed(()=>assistantPages[page.value])
const selection=computed(()=>assistant.pageSelection?.path===route.path?assistant.pageSelection:null)
const context=computed(()=>({page:page.value,...(selection.value?.patternId?{patternId:selection.value.patternId}:{}),...(selection.value?.importId?{importId:selection.value.importId}:{})}))
const currentDraftTarget=computed(()=>new RegExp('^/mapping-draft/[a-f0-9]{24}/[0-9]+$','i').test(route.path)?{kind:'draft',importId:String(route.params.importId),line:Number(route.params.line)}:null)
const targetPath=computed(()=>assistant.target.kind==='draft'?'/mapping-draft/'+assistant.target.importId+'/'+assistant.target.line:'')
const pageDraft=computed(()=>assistant.draftPage?.path===targetPath.value?assistant.draftPage:null)
const draft=computed(()=>pageDraft.value?.draft||loadedDraft.value),draftDirty=computed(()=>!!(pageDraft.value?.dirty||pageDraft.value?.busy))
let savedOverflow:string|null=null
function scrollLock(locked:boolean){if(typeof document==='undefined')return;if(locked&&savedOverflow===null){savedOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden'}else if(!locked&&savedOverflow!==null){document.documentElement.style.overflow=savedOverflow;savedOverflow=null}}
watch([()=>assistant.open,mobile,isLocked],([open,small,locked])=>scrollLock(open&&small&&!locked))
let ticket=0,previousFocus:HTMLElement|null=null,media:MediaQueryList|undefined
function resize(){mobile.value=!!media?.matches}
function summon(){previousFocus=document.activeElement as HTMLElement;assistant.show(assistant.target.kind==='workspace'&&currentDraftTarget.value?currentDraftTarget.value:undefined)}
function close(){assistant.close();nextTick(()=>{const target=previousFocus?.isConnected?previousFocus:document.querySelector('[data-assistant-toggle]') as HTMLElement;target?.focus()})}
function selectCurrent(){if(currentDraftTarget.value)assistant.select(currentDraftTarget.value)}
async function loadDraft(){const current=++ticket;loadedDraft.value=null;error.value='';if(assistant.target.kind!=='draft'||!user.isAuthenticated)return;const target={...assistant.target};try{const d=await $fetch('/api/finance/imports/'+target.importId+'/drafts/'+target.line,{headers:user.authHeader});if(current===ticket)loadedDraft.value=d}catch(e:any){if(current===ticket)error.value=e.data?.data?.message||'明細を取得できませんでした。'}}
function receive(d:any){if(assistant.target.kind==='draft'&&assistant.target.importId===d.importId&&assistant.target.line===d.line)loadedDraft.value=d;assistant.receive(d)}
function keyboard(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();close();return}if(!mobile.value||event.key!=='Tab')return;const elements=Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),select:not([disabled])')||[]).filter(e=>e.offsetParent!==null);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
watch(()=>assistant.open,async open=>{if(open){activated.value=true;await nextTick();closeButton.value?.focus();if(assistant.target.kind==='draft')loadDraft()}},{immediate:true})
watch(targetPath,()=>{ticket++;loadedDraft.value=null;if(assistant.open)loadDraft()})
watch(()=>user.user?.id,id=>{assistant.identify(user.isAuthenticated&&id?id:'');activated.value=assistant.open},{immediate:true})
watch(()=>user.isAuthenticated,value=>{if(!value){ticket++;loadedDraft.value=null;assistant.identify('');activated.value=false}})
watch(isLocked,value=>{if(value)ticket++;else if(assistant.open&&assistant.target.kind==='draft')loadDraft()})
onMounted(()=>{media=window.matchMedia('(max-width:639px)');resize();media.addEventListener('change',resize)})
onBeforeUnmount(()=>{scrollLock(false);ticket++;media?.removeEventListener('change',resize)})
</script>
<style>
.assistant-input { @apply block w-full min-w-0 resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-primary-main focus:outline-none focus:ring-1 focus:ring-primary-main disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-100; max-height:180px; }
.assistant-panel { padding-bottom:env(safe-area-inset-bottom); }
</style>

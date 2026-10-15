<template>
 <section v-if="user.isAuthenticated && !isLocked" data-assistant-accordion class="mb-6 min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-900">
  <h2><button type="button" data-assistant-toggle class="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 focus-visible:outline-primary-main dark:hover:bg-white/5 sm:px-5" aria-controls="omf-assistant" :aria-expanded="assistant.open" @click="assistant.open ? close() : summon()"><span class="rounded-xl bg-primary-main/10 p-2 text-primary-main"><MessageCircle class="h-4 w-4" /></span><span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-gray-900 dark:text-gray-100">OMFに相談</span><span class="mt-0.5 block text-xs font-normal text-gray-500">画面を見ながら、判断や購入内容を相談できます</span></span><ChevronDown class="h-4 w-4 shrink-0 text-gray-400 transition-transform" :class="assistant.open ? 'rotate-180' : ''" aria-hidden="true" /></button></h2>
  <aside v-show="assistant.open" id="omf-assistant" ref="panel" aria-label="OMFアシスタント" class="assistant-panel flex min-h-0 min-w-0 flex-col border-t border-gray-100 dark:border-white/10" @keydown="keyboard">
   <div class="shrink-0 border-b border-gray-100 bg-gray-50/70 px-5 py-3 dark:border-white/10 dark:bg-white/5">
    <div class="flex items-center justify-between gap-2"><div class="flex flex-wrap items-center gap-2"><button class="rounded-lg px-2.5 py-1.5 text-xs" :class="assistant.target.kind==='workspace'?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100'" data-assistant-general @click="assistant.select({kind:'workspace'})">画面について相談</button><button v-if="currentDraftTarget" class="rounded-lg px-2.5 py-1.5 text-xs text-primary-main hover:bg-primary-main/10" data-assistant-current @click="selectCurrent">この購入について</button></div><button type="button" data-assistant-close class="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" aria-label="アシスタントを折りたたむ" @click="close"><X class="h-4 w-4" /></button></div>
    <p v-if="assistant.target.kind==='workspace'" data-assistant-context class="mt-2 break-words text-xs text-gray-600 dark:text-gray-300">{{ pageName }}<span v-if="selection?.label"> · {{ selection.label }}</span></p>
    <div v-else data-assistant-context class="mt-2 text-xs"><p class="break-words font-medium text-gray-800 dark:text-gray-100">{{ draft?.source.description || '明細を確認中…' }}</p><p v-if="draft" class="mt-1 text-gray-500">{{ draft.source.account.name }} · {{ draft.source.purchaseDate }} · ¥{{ Number(draft.source.amount).toLocaleString('ja-JP') }}</p><NuxtLink v-if="draft" :to="targetPath" class="mt-2 inline-block text-primary-main">この下書きを開く ↗</NuxtLink><p v-if="route.path!==targetPath" class="mt-2 leading-relaxed text-gray-500">{{ pageName }}に移動しました。相談対象はこの購入のままです。</p></div>
   </div>
   <p v-if="error" role="alert" class="p-5 text-sm text-red-600">{{ error }}<button class="ml-2 underline" @click="loadDraft">再読込</button></p>
   <template v-if="activated">
    <AssistantConversation v-if="assistant.target.kind==='workspace'" :key="user.user?.id" :context="context" :active="assistant.open" />
    <PurchaseChat v-else-if="draft" :key="targetPath" :draft="draft" :dirty="draftDirty" panel :active="assistant.open" @saved="receive" />
    <p v-else-if="!error" class="p-5 text-xs text-gray-500">購入内容を読み込んでいます…</p>
   </template>
  </aside>
 </section>
</template>
<script setup lang="ts">
import {MessageCircle,ChevronDown,X} from 'lucide-vue-next'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {useActivityTracker} from '~/composables/useActivityTracker'
import {assistantPage,assistantPages} from '~/shared/finance-assistant.mjs'
import PurchaseChat from './PurchaseChat.vue'
import AssistantConversation from './AssistantConversation.vue'
const user=useUserStore(),assistant=useAssistantStore(),route=useRoute(),{isLocked}=useActivityTracker()
const panel=ref<HTMLElement|null>(null),activated=ref(false),loadedDraft=ref<any>(null),error=ref('')
const page=computed(()=>assistantPage(route.path)),pageName=computed(()=>assistantPages[page.value])
const selection=computed(()=>assistant.pageSelection?.path===route.path?assistant.pageSelection:null)
const context=computed(()=>({page:page.value,...(selection.value?.patternId?{patternId:selection.value.patternId}:{}),...(selection.value?.importId?{importId:selection.value.importId}:{})}))
const currentDraftTarget=computed(()=>new RegExp('^/mapping-draft/[a-f0-9]{24}/[0-9]+$','i').test(route.path)?{kind:'draft',importId:String(route.params.importId),line:Number(route.params.line)}:null)
const targetPath=computed(()=>assistant.target.kind==='draft'?'/mapping-draft/'+assistant.target.importId+'/'+assistant.target.line:'')
const pageDraft=computed(()=>assistant.draftPage?.path===targetPath.value?assistant.draftPage:null)
const draft=computed(()=>pageDraft.value?.draft||loadedDraft.value),draftDirty=computed(()=>!!(pageDraft.value?.dirty||pageDraft.value?.busy))
let ticket=0,previousFocus:HTMLElement|null=null
function summon(){previousFocus=document.activeElement as HTMLElement;assistant.show(assistant.target.kind==='workspace'&&currentDraftTarget.value?currentDraftTarget.value:undefined)}
function close(){assistant.close();nextTick(()=>{const target=previousFocus?.isConnected?previousFocus:document.querySelector('[data-assistant-toggle]') as HTMLElement;target?.focus()})}
function selectCurrent(){if(currentDraftTarget.value)assistant.select(currentDraftTarget.value)}
async function loadDraft(){const current=++ticket;loadedDraft.value=null;error.value='';if(assistant.target.kind!=='draft'||!user.isAuthenticated)return;const target={...assistant.target};try{const d=await $fetch('/api/finance/imports/'+target.importId+'/drafts/'+target.line,{headers:user.authHeader});if(current===ticket)loadedDraft.value=d}catch(e:any){if(current===ticket)error.value=e.data?.data?.message||'明細を取得できませんでした。'}}
function receive(d:any){if(assistant.target.kind==='draft'&&assistant.target.importId===d.importId&&assistant.target.line===d.line)loadedDraft.value=d;assistant.receive(d)}
function keyboard(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();close()}}
watch(()=>assistant.open,async open=>{if(open){activated.value=true;await nextTick();panel.value?.scrollIntoView({block:'nearest',behavior:'smooth'});if(assistant.target.kind==='draft')loadDraft()}},{immediate:true})
watch(targetPath,()=>{ticket++;loadedDraft.value=null;if(assistant.open)loadDraft()})
watch(()=>user.user?.id,id=>{assistant.identify(user.isAuthenticated&&id?id:'');activated.value=assistant.open},{immediate:true})
watch(()=>user.isAuthenticated,value=>{if(!value){ticket++;loadedDraft.value=null;assistant.identify('');activated.value=false}})
watch(isLocked,value=>{if(value)ticket++;else if(assistant.open&&assistant.target.kind==='draft')loadDraft()})
onBeforeUnmount(()=>{ticket++})
</script>
<style>
.assistant-input { @apply block w-full min-w-0 resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-primary-main focus:outline-none focus:ring-1 focus:ring-primary-main disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-100; max-height:180px; }
.assistant-panel { height:clamp(20rem,55dvh,32rem); }
.assistant-panel > section { width:100%;max-width:56rem;align-self:center; }
</style>

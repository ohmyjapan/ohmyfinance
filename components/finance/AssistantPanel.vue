<template>
 <div v-if="user.isAuthenticated && !isLocked" data-assistant-dock class="navi-dock" :class="{'navi-dock-open':assistant.open,'navi-dock-compact':compactViewport}" :style="viewportStyle" @keydown="keyboard">
  <aside v-show="assistant.open" id="omf-assistant" ref="panel" tabindex="-1" aria-label="OMFアシスタント" class="assistant-panel navi-dialog flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 outline-none dark:border-white/10 dark:bg-slate-900 dark:text-gray-100" @scroll.capture="trackReading">
   <header class="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10">
    <NaviAvatar :size="compactViewport?'sm':'md'" />
    <div class="min-w-0 flex-1"><h2 class="truncate text-sm font-semibold" :title="pageName">OMF Navi</h2><p class="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">会計の相談・操作をお手伝いします</p></div>
    <button v-if="compactViewport" type="button" data-assistant-context-menu aria-controls="omf-assistant-context-settings" :aria-expanded="compactSheet==='context'" class="shrink-0 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" @click="compactSheet=compactSheet==='context'?'':'context'">対象</button>
    <button v-if="compactViewport" type="button" data-assistant-support-menu aria-label="接続診断" title="接続診断" aria-controls="omf-assistant-support" :aria-expanded="compactSheet==='support'" class="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" @click="compactSheet=compactSheet==='support'?'':'support'"><MoreHorizontal class="h-4 w-4" /></button>
    <button type="button" data-assistant-close class="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-primary-main dark:hover:bg-white/10" aria-label="Naviを小さくする" title="小さくする" @click="close"><X class="h-4 w-4" /></button>
   </header>
   <div id="omf-assistant-context-settings" class="navi-context shrink-0 border-b border-gray-100 bg-gray-50/70 px-5 py-3 dark:border-white/10 dark:bg-white/5" :class="{'navi-sheet-open':compactSheet==='context'}">
    <div v-if="!workspaceView||currentDraftTarget" class="flex flex-wrap items-center gap-2"><button class="rounded-lg px-2.5 py-1.5 text-xs" :class="workspaceView?'bg-primary-main/10 font-medium text-primary-main':'text-gray-500 hover:bg-gray-100'" data-assistant-general @click="assistant.select({kind:'workspace'})">画面について相談</button><button v-if="currentDraftTarget" class="rounded-lg px-2.5 py-1.5 text-xs text-primary-main hover:bg-primary-main/10" data-assistant-current @click="selectCurrent">この購入について</button></div>
    <p v-if="workspaceView" data-assistant-context class="mt-2 break-words text-xs text-gray-600 dark:text-gray-300">{{ pageName }}<span v-if="selection?.label"> · {{ selection.label }}</span><span v-if="scope.company&&feature" data-assistant-feature :data-assistant-feature-disposition="feature.disposition" :title="feature.reason" class="text-gray-400"> · {{ feature.disposition==='navi_tool' ? 'Navi で確認・保存できます' : 'この画面で操作します' }}</span></p>
    <div v-else data-assistant-context class="mt-2 text-xs"><p class="break-words font-medium text-gray-800 dark:text-gray-100">{{ draft?.source.description || '明細を確認中…' }}</p><p v-if="draft" class="mt-1 text-gray-500">{{ draft.source.account.name }} · {{ draft.source.purchaseDate }} · ¥{{ Number(draft.source.amount).toLocaleString('ja-JP') }}</p><NuxtLink v-if="draft" :to="targetPath" class="mt-2 inline-block text-primary-main">この下書きを開く ↗</NuxtLink><p v-if="route.path!==targetPath" class="mt-2 leading-relaxed text-gray-500">{{ pageName }}に移動しました。相談対象はこの購入のままです。</p></div>
    <CompanyAssistantScope v-if="scope.company" compact :organization-id="scope.organizationId" />
    <details v-else-if="workspaceView" data-assistant-posting-company :data-assistant-posting-company-id="postingCompany?.organizationId ? String(postingCompany.organizationId) : ''" :data-assistant-posting-checked="postingChecked ? '1' : '0'" class="mt-2 break-words text-[11px] leading-relaxed text-gray-500"><summary class="cursor-pointer">{{ !postingChecked ? '帳簿への登録先を確認しています…' : postingCompany ? '帳簿への登録先：'+postingCompany.name : '帳簿への登録先：会社未選択' }}</summary><p class="mt-1">{{ postingCompany ? '送信時に選択中の会社です。帳簿への登録の指示と、その会社の記憶の参照だけに使います。' : '相談・下書きの保存・承認はこのまま続けられます。帳簿への登録と会社の記憶には会社の選択が必要です。' }}</p></details>
   </div>
   <p v-if="error" role="alert" class="p-5 text-sm text-red-600">{{ error }}<button class="ml-2 underline" @click="loadDraft">再読込</button></p>
   <template v-if="activated">
    <AssistantConversation v-if="workspaceView" :key="scope.key" :context="context" :scope="scope" :active="assistant.open" />
    <PurchaseChat v-else-if="draft" :key="targetPath" :draft="draft" :dirty="draftDirty" panel :compact="compactViewport" :active="assistant.open" @saved="receive" />
    <p v-else-if="!error" class="p-5 text-xs text-gray-500">購入内容を読み込んでいます…</p>
   </template>
   <div id="omf-assistant-support" class="navi-support" :class="{'navi-sheet-open':compactSheet==='support'}"><SupportReport :key="user.user?.id" /></div>
  </aside>
  <button type="button" data-assistant-toggle class="navi-launcher" aria-controls="omf-assistant" :aria-expanded="assistant.open" :aria-label="launcherLabel" @click="assistant.open ? close() : summon()">
   <img data-navi-character class="navi-character" :class="{'navi-character-motion':motion}" src="/images/omf-navi-character.png" alt="" aria-hidden="true" width="1156" height="1361" decoding="async" @animationend="motion=false">
   <span v-if="indicator&&!assistant.open" data-navi-status :data-navi-status-kind="indicator.kind" :data-navi-status-count="indicator.count||undefined" class="navi-status" aria-hidden="true"><span class="navi-status-dot"></span>{{ indicator.short }}</span>
  </button>
  <p data-navi-status-live class="sr-only" role="status" aria-live="polite">{{ assistant.open ? '' : statusText }}</p>
  <div v-if="!assistant.open" class="navi-size">
   <button type="button" data-navi-size-toggle class="navi-size-toggle" aria-controls="omf-navi-size-menu" :aria-expanded="sizeMenu" aria-label="Naviの大きさを変更" title="Naviの大きさ" @click="sizeMenu=!sizeMenu">大きさ</button>
   <div v-show="sizeMenu" id="omf-navi-size-menu" data-navi-size-menu role="group" aria-label="Naviの大きさ" class="navi-size-menu">
    <button type="button" data-navi-size="small" :aria-pressed="assistant.size==='small'" @click="pickSize('small')">小</button>
    <button type="button" data-navi-size="medium" :aria-pressed="assistant.size==='medium'" @click="pickSize('medium')">中</button>
    <button type="button" data-navi-size="large" :aria-pressed="assistant.size==='large'" @click="pickSize('large')">大<small>今のサイズ・最大</small></button>
   </div>
  </div>
 </div>
</template>
<script setup lang="ts">
import {X,MoreHorizontal} from 'lucide-vue-next'
import NaviAvatar from './NaviAvatar.vue'
import {useUserStore} from '~/stores/user'
import {useAssistantStore} from '~/stores/assistant'
import {useActivityTracker} from '~/composables/useActivityTracker'
import {assistantPage,assistantPages,assistantConversationScope,assistantFeature} from '~/shared/finance-assistant.mjs'
import PurchaseChat from './PurchaseChat.vue'
import AssistantConversation from './AssistantConversation.vue'
import SupportReport from './SupportReport.vue'
import CompanyAssistantScope from './CompanyAssistantScope.vue'
import {tokenClaims} from '~/utils/auth-session'
import {useNaviStatus,type NaviStatusTarget} from '~/composables/useNaviStatus'
const user=useUserStore(),assistant=useAssistantStore(),route=useRoute(),{isLocked}=useActivityTracker()
const panel=ref<HTMLElement|null>(null),activated=ref(false),loadedDraft=ref<any>(null),error=ref('')
const viewportHeight=ref<number|null>(null),keyboardOffset=ref(0),headerClearance=ref(0),compactSheet=ref(''),sizeMenu=ref(false),motion=ref(false)
const compactViewport=computed(()=>viewportHeight.value!==null&&viewportHeight.value<=640)
const viewportStyle=computed(()=>viewportHeight.value===null?{}:{'--navi-viewport-height':viewportHeight.value+'px','--navi-keyboard-offset':keyboardOffset.value+'px','--navi-top-clearance':headerClearance.value+'px'})
const readingPositions=new WeakMap<HTMLElement,boolean>()
function trackReading(event:Event){const log=event.target as HTMLElement;if(log.getAttribute('role')==='log')readingPositions.set(log,log.scrollHeight-log.scrollTop-log.clientHeight<=4)}
function syncViewport(){const viewport=window.visualViewport,height=viewport?.height||window.innerHeight,offset=viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0,log=panel.value?.querySelector<HTMLElement>('[role=log]'),keepLatest=log&&(readingPositions.get(log)??log.scrollHeight-log.scrollTop-log.clientHeight<=4);const changed=height!==viewportHeight.value||offset!==keyboardOffset.value;viewportHeight.value=height;keyboardOffset.value=offset;headerClearance.value=Math.max(0,(document.querySelector('[data-app-header]')?.getBoundingClientRect().bottom||0)-(viewport?.offsetTop||0));if(changed&&keepLatest)nextTick(()=>{if(log.isConnected)log.scrollTop=log.scrollHeight})}
const scope=computed(()=>{const claims=tokenClaims(user.token);return assistantConversationScope(claims?.userId,claims?.organizationId,assistantPage(route.path))})
const workspaceView=computed(()=>scope.value.company||assistant.target.kind==='workspace')
// Owner workspace: the token-selected company is only the ledger posting destination (and the same-company teaching authority); the
// label shows the company the server checked for THIS scope and selection (current membership), never the cached organization list.
// The purchase chat shows the server-checked one itself.
const postingKey=computed(()=>scope.value.key+'|'+(scope.value.organizationId||''))
const postingChecked=computed(()=>assistant.workspacePosting?.scopeKey===postingKey.value)
const postingCompany=computed(()=>postingChecked.value?assistant.workspacePosting!.company:null)
const page=computed(()=>assistantPage(route.path)),pageName=computed(()=>assistantPages[page.value])
// What Navi can truthfully do on this page (catalogue entry). Normal company finance pages use the company conversation; owner pages
// (mapping, drafts, learning, connections, intake, payment matching, purchase workflow) keep the separate owner/purchase conversations.
const feature=computed(()=>assistantFeature(route.path))
const selection=computed(()=>assistant.pageSelection?.path===route.path?assistant.pageSelection:null)
 const context=computed(()=>({page:page.value,...(/^\/receipts\/[a-f0-9]{24}$/i.test(route.path)?{receiptId:String(route.params.id)}:{}),...(/^\/transactions\/[a-f0-9]{24}$/i.test(route.path)?{transactionId:String(route.params.id)}:{}),...(selection.value?.patternId?{patternId:selection.value.patternId}:{}),...(selection.value?.importId?{importId:selection.value.importId}:{}),...(/^\/intake\/[a-f0-9]{24}$/i.test(route.path)?{recordId:String(route.params.id)}:{}),...(page.value==='intake'&&selection.value?.documentId?{documentId:selection.value.documentId,sheet:selection.value.sheet,headerRow:selection.value.headerRow}:{}),...(page.value==='intake-payments'&&selection.value?.paymentKind?{paymentKind:selection.value.paymentKind,...(selection.value.paymentKind==='card'?{paymentImportId:selection.value.paymentImportId,paymentLine:selection.value.paymentLine}:{})}:{})}))
const currentDraftTarget=computed(()=>new RegExp('^/mapping-draft/[a-f0-9]{24}/[0-9]+$','i').test(route.path)?{kind:'draft',importId:String(route.params.importId),line:Number(route.params.line)}:null)
const targetPath=computed(()=>assistant.target.kind==='draft'?'/mapping-draft/'+assistant.target.importId+'/'+assistant.target.line:'')
const pageDraft=computed(()=>assistant.draftPage?.path===targetPath.value?assistant.draftPage:null)
const draft=computed(()=>pageDraft.value?.draft||loadedDraft.value),draftDirty=computed(()=>!!(pageDraft.value?.dirty||pageDraft.value?.busy))
// Closed status of the conversation the launcher opens (summon below): the checked company's conversation on company pages, the
// purchase it would select (the target, or this page's purchase while the target is the workspace), otherwise the owner workspace.
// This parent reads it before any transcript mounts; paused while open, locked or signed out (and on a hidden tab). It names that one
// conversation, never other companies or pages; nothing is persisted in the browser.
const statusTarget=computed<NaviStatusTarget|null>(()=>{const s=scope.value;if(!user.isAuthenticated||!s.actorId)return null;if(s.company)return s.organizationId?{realm:'company',actorId:s.actorId,organizationId:s.organizationId,endpoint:'/api/finance-chat/company-workspace'}:null;const d=assistant.target.kind==='draft'?assistant.target:currentDraftTarget.value;return d?{realm:'purchase',actorId:s.actorId,organizationId:s.organizationId,importId:d.importId,line:d.line,endpoint:'/api/finance-chat/imports/'+d.importId+'/drafts/'+d.line}:{realm:'workspace',actorId:s.actorId,organizationId:s.organizationId,endpoint:'/api/finance-chat/workspace'}})
const {status:naviStatus,indicator}=useNaviStatus(statusTarget,computed(()=>assistant.open||isLocked.value||!user.isAuthenticated))
const statusConversation=computed(()=>statusTarget.value?.realm==='company'?(naviStatus.value?.status?.company?.name||'会社')+'の会話':statusTarget.value?.realm==='purchase'?'この購入の会話':'画面についての会話')
const statusText=computed(()=>indicator.value?statusConversation.value+'：'+indicator.value.label:'')
const launcherLabel=computed(()=>assistant.open?'Naviを小さくする':'OMF Naviに相談する'+(statusText.value?'（'+statusText.value+'）':''))
let ticket=0,previousFocus:HTMLElement|null=null
function summon(){previousFocus=document.activeElement as HTMLElement;assistant.show(workspaceView.value&&currentDraftTarget.value?currentDraftTarget.value:undefined)}
function close(){compactSheet.value='';sizeMenu.value=false;assistant.close();nextTick(()=>{const target=previousFocus?.isConnected?previousFocus:document.querySelector('[data-assistant-toggle]') as HTMLElement;target?.focus()})}
function pickSize(size:string){assistant.resize(size);sizeMenu.value=false}
function selectCurrent(){if(currentDraftTarget.value)assistant.select(currentDraftTarget.value)}
async function loadDraft(){const current=++ticket;loadedDraft.value=null;error.value='';if(scope.value.company||assistant.target.kind!=='draft'||!user.isAuthenticated)return;const target={...assistant.target};try{const d=await $fetch('/api/finance/imports/'+target.importId+'/drafts/'+target.line,{headers:user.authHeader});if(current===ticket)loadedDraft.value=d}catch(e:any){if(current===ticket)error.value=e.data?.data?.message||'明細を取得できませんでした。'}}
function receive(d:any){if(assistant.target.kind==='draft'&&assistant.target.importId===d.importId&&assistant.target.line===d.line)loadedDraft.value=d;assistant.receive(d)}
function keyboard(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();if(sizeMenu.value){sizeMenu.value=false;nextTick(()=>document.querySelector<HTMLElement>('[data-navi-size-toggle]')?.focus({preventScroll:true}))}else if(compactSheet.value){const selector=compactSheet.value==='context'?'[data-assistant-context-menu]':'[data-assistant-support-menu]';compactSheet.value='';nextTick(()=>document.querySelector<HTMLElement>(selector)?.focus({preventScroll:true}))}else close()}}
watch(compactViewport,()=>{compactSheet.value=''})
watch(()=>assistant.open,async open=>{if(open){sizeMenu.value=false;activated.value=true;await nextTick();panel.value?.focus({preventScroll:true});if(assistant.target.kind==='draft')loadDraft()}},{immediate:true})
watch(targetPath,()=>{ticket++;loadedDraft.value=null;if(assistant.open)loadDraft()})
watch(()=>user.user?.id,id=>{assistant.identify(user.isAuthenticated&&id?id:'');activated.value=assistant.open},{immediate:true})
watch(()=>scope.value.key,()=>{ticket++;loadedDraft.value=null;error.value='';if(scope.value.company)assistant.select({kind:'workspace'})})
watch(()=>scope.value.organizationId,()=>{ticket++;loadedDraft.value=null;error.value='';assistant.select({kind:'workspace'})})
watch(()=>user.isAuthenticated,value=>{if(!value){ticket++;loadedDraft.value=null;assistant.identify('');activated.value=false}})
watch(isLocked,value=>{if(value)ticket++;else if(assistant.open&&assistant.target.kind==='draft')loadDraft()})
// Occasional motion: every 45 s the closed character may greet once (transform only), never while the chat is open, the tab is hidden or
// reduced motion is on; the character's own animationend clears the class. The timer dies with the panel.
let motionTimer:ReturnType<typeof setTimeout>|undefined
function scheduleMotion(){motionTimer=setTimeout(()=>{if(!assistant.open&&document.visibilityState==='visible'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)motion.value=true;scheduleMotion()},45000)}
onMounted(()=>{syncViewport();window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);scheduleMotion()})
onBeforeUnmount(()=>{ticket++;clearTimeout(motionTimer);window.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('scroll',syncViewport)})
</script>
<style>
.assistant-input { @apply block w-full min-w-0 resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-primary-main focus:outline-none focus:ring-1 focus:ring-primary-main disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-100; max-height:180px; }
/* The layout root carries Navi's tokens: the chosen size (large = today's 18rem maximum), the launcher box, the gaps and the open rail width. */
.navi-layout { --navi-launcher-size:min(var(--navi-size),40dvh);--navi-launcher-width:calc(var(--navi-launcher-size) * .85);--navi-edge-gap:2rem;--navi-bottom-gap:2rem;--navi-chat-width:22rem; }
.navi-size-large { --navi-size:18rem;--navi-size-mobile:13rem; }
.navi-size-medium { --navi-size:11rem;--navi-size-mobile:9rem; }
.navi-size-small { --navi-size:6rem;--navi-size-mobile:6rem; }
@media(max-width:1399px) { .navi-layout { --navi-chat-width:20rem; } }
/* The main column and footer share the gutter at >=768px: keep the character's (or the open rail's) width plus the edge gap free on the right; nothing while locked or signed out. */
@media(min-width:768px) {
 .navi-layout .navi-host { padding-right:calc(1.5rem + var(--navi-launcher-width) + var(--navi-edge-gap)); }
 .navi-layout.navi-open .navi-host { padding-right:calc(1.5rem + var(--navi-chat-width) + var(--navi-edge-gap)); }
 .navi-layout.navi-off .navi-host { padding-right:1.5rem; }
}
.navi-dock { position:fixed;z-index:20;right:max(var(--navi-edge-gap),env(safe-area-inset-right));bottom:calc(max(var(--navi-bottom-gap),env(safe-area-inset-bottom)) + var(--navi-keyboard-offset,0px));width:var(--navi-launcher-width); }
.navi-launcher { position:relative;display:flex;align-items:center;justify-content:center;width:var(--navi-launcher-width);height:var(--navi-launcher-size);padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;outline-offset:4px; }
.navi-character { display:block;width:100%;height:100%;object-fit:contain;object-position:bottom;pointer-events:none; }
.navi-launcher:focus-visible { outline:2px solid #93402b; }
/* Closed status: a small static pill in the launcher box's own top-right corner (no frame around her, nothing over the page); hidden
   with the launcher while open. Text comes from server facts only; no motion, so reduced motion has nothing to suppress. */
.navi-status { position:absolute;top:.25rem;right:0;display:inline-flex;align-items:center;gap:.25rem;max-width:100%;padding:.125rem .5rem;border:1px solid rgb(147 64 43 / 25%);border-radius:999px;background:rgb(255 255 255 / 92%);color:#93402b;font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;pointer-events:none;box-shadow:0 1px 4px rgb(61 42 32 / 12%); }
.navi-status-dot { flex-shrink:0;width:.4375rem;height:.4375rem;border-radius:999px;background:currentColor; }
.navi-status[data-navi-status-kind=new] { border-color:#93402b;background:#93402b;color:#fff; }
.navi-status[data-navi-status-kind=failed],.navi-status[data-navi-status-kind=reconnect],.navi-status[data-navi-status-kind=interrupted],.navi-status[data-navi-status-kind=unknown] { border-color:rgb(180 83 9 / 35%);color:#b45309; }
.dark .navi-status { border-color:rgb(255 255 255 / 15%);background:rgb(30 41 59 / 92%);color:#f3c9bb; }
.dark .navi-status[data-navi-status-kind=new] { border-color:#93402b;background:#93402b;color:#fff; }
/* Size choice under the closed character; the menu opens above her and the dock. */
.navi-size { display:flex;justify-content:center;margin-top:.25rem; }
.navi-size-toggle { font-size:11px;line-height:1;padding:.375rem .625rem;border:1px solid rgb(147 64 43 / 25%);border-radius:999px;background:rgb(255 255 255 / 85%);color:#93402b; }
.navi-size-toggle:focus-visible { outline:2px solid #93402b;outline-offset:2px; }
.navi-size-menu { @apply rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-slate-800;position:absolute;bottom:calc(100% + .5rem);right:0;display:grid;grid-template-columns:1fr 1fr 2fr;gap:.25rem;width:14rem;max-width:calc(100vw - var(--navi-edge-gap) - var(--navi-edge-gap)); }
.navi-size-menu button { @apply rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10; }
.navi-size-menu button[aria-pressed=true] { @apply bg-primary-main/10 font-medium text-primary-main; }
.navi-size-menu small { display:block;margin-top:.125rem;font-size:9px;line-height:1.2;white-space:nowrap;opacity:.8; }
/* Occasional greet: transform only (<=3px, <=1.3deg), so neither the dock nor the page moves; off under reduced motion. */
.navi-character-motion { animation:navi-greet 2.6s ease-in-out 1;transform-origin:50% 90%; }
@keyframes navi-greet { 0%,100% { transform:translateY(0) rotate(0); } 25% { transform:translateY(-3px) rotate(-1.3deg); } 55% { transform:translateY(-1px) rotate(1deg); } 78% { transform:translateY(-2px) rotate(-.4deg); } }
@media(prefers-reduced-motion:reduce) { .navi-character-motion { animation:none; } }
.navi-dialog { position:absolute;right:calc(100% + 1rem);bottom:0;width:min(29rem,calc(100vw - var(--navi-edge-gap) - var(--navi-edge-gap) - var(--navi-launcher-width) - 1rem));height:min(44rem,calc(var(--navi-viewport-height,100dvh) - max(var(--navi-bottom-gap),env(safe-area-inset-bottom)) - .875rem - var(--navi-top-clearance,0px)));box-shadow:0 12px 48px rgb(61 42 32 / 16%); }
.navi-dialog > div:first-of-type { max-height:35%;overflow-y:auto; }
.navi-dialog > section > form { padding:.75rem; }
.navi-dialog textarea.assistant-input { height:4rem;min-height:4rem;max-height:7rem; }
.navi-support { flex-shrink:0;max-height:25%;overflow-y:auto; }
.assistant-panel > section { width:100%;max-width:56rem;align-self:center; }
/* Open at >=768px on a normal height: a tall rail on the right, below the measured header, inside the gutter the page reserves. Compact (short, <=640px) viewports keep their own geometry below; the height term keeps the rail out of the layout the viewport sync reads before the compact class lands. */
@media(min-width:768px) and (min-height:641px) {
 .navi-dock-open:not(.navi-dock-compact) { top:calc(var(--navi-top-clearance,0px) + .875rem);bottom:calc(max(var(--navi-bottom-gap),env(safe-area-inset-bottom)) + var(--navi-keyboard-offset,0px));width:var(--navi-chat-width); }
 .navi-dock-open:not(.navi-dock-compact) .navi-dialog { position:absolute;inset:0;width:auto;height:auto; }
}
/* While the chat is open the character and the size control are gone at every width; they return at the chosen size on close. */
.navi-dock-open > .navi-launcher, .navi-dock-open .navi-size { display:none; }
@media(max-width:767px) {
 .navi-layout { --navi-launcher-size:min(var(--navi-size-mobile),40dvh);--navi-edge-gap:1rem;--navi-bottom-gap:1rem; }
 [data-page-content] { padding-bottom:var(--navi-launcher-size); }
 .navi-dialog { right:0;width:calc(100vw - var(--navi-edge-gap) - var(--navi-edge-gap)); }
 .navi-dialog .assistant-input { max-height:7rem; }
}
.navi-dock-compact.navi-dock-open { --navi-bottom-gap:1rem; }
.navi-dock-compact .navi-dialog { right:0;width:min(29rem,calc(100vw - var(--navi-edge-gap) - var(--navi-edge-gap)));height:calc(var(--navi-viewport-height,100dvh) - max(var(--navi-bottom-gap),env(safe-area-inset-bottom)) - .5rem - var(--navi-top-clearance,0px));bottom:0; }
.navi-dock-compact .navi-dialog header { padding-top:.5rem;padding-bottom:.5rem; }
.navi-dock-compact .navi-dialog header p { display:none; }
.navi-dock-compact .navi-dialog textarea.assistant-input,.navi-dock-compact .navi-dialog textarea.chat-input { height:3rem;min-height:3rem;max-height:7rem; }
.navi-dock-compact [data-chat-posting-company] { position:relative;margin-bottom:.25rem; }
.navi-dock-compact [data-chat-posting-company] summary { cursor:pointer;list-style-position:inside;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.navi-dock-compact .purchase-posting-explanation { @apply rounded-lg border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-slate-800;position:absolute;z-index:2;bottom:calc(100% + .5rem);left:0;right:0;max-height:8rem;overflow-y:auto;box-shadow:0 4px 16px rgb(61 42 32 / 12%); }
.navi-dock-compact .navi-context,.navi-dock-compact .navi-support { display:none; }
.navi-dock-compact .navi-dialog > section > [role=log] { padding:.5rem .75rem; }
.navi-dock-compact .navi-dialog > section > form { padding:.5rem .75rem; }
.navi-dock-compact .navi-dialog > section > form > div:last-child:not(.purchase-composer-compact) { margin-top:.5rem; }
.navi-dock-compact .purchase-composer-compact { display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:.5rem;row-gap:.25rem;align-items:end; }
.navi-dock-compact .navi-dialog .purchase-composer-compact textarea.chat-input { grid-column:1;grid-row:1;height:2.75rem;min-height:2.75rem;padding:.5rem .75rem; }
.navi-dock-compact .purchase-composer-compact > div { display:contents; }
.navi-dock-compact .purchase-composer-compact > div > p { grid-column:1/-1;grid-row:2; }
.navi-dock-compact .purchase-composer-compact > div > button { grid-column:2;grid-row:1;align-self:stretch; }
.navi-dock-compact .navi-dialog > section > div:first-child:not([role=log]) { padding-top:.25rem; }
.navi-dock-compact .navi-dialog .navi-sheet-open { @apply border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-800;display:block;position:absolute;z-index:1;top:3.5rem;left:.5rem;right:.5rem;max-height:calc(100% - 4rem);overflow-y:auto;border-radius:.75rem;box-shadow:0 4px 16px rgb(61 42 32 / 12%); }
</style>

<template>
 <section class="card mb-6 p-4 sm:p-6" data-purchase-research aria-label="購入内容の調査">
  <div class="flex flex-wrap items-start justify-between gap-3">
   <div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">OMFで購入を調べる</h2><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">明細・過去の判断・メール・資料・公開情報を照合し、根拠のある候補をまとめます。</p></div>
   <span class="text-xs" :class="pending ? 'text-primary-main' : 'text-gray-500'">{{ stateLabel }}</span>
  </div>
  <p v-if="error" role="alert" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ error }} <button class="underline" type="button" @click="load">再読込</button></p>
  <p v-if="!data?.connected" class="mt-3 text-xs text-amber-700 dark:text-amber-400">調査担当との接続を確認しています。保存済みの結果は確認できます。</p>
  <p v-if="data?.settings" class="mt-3 text-xs text-gray-500">国税庁の照合 {{ data.settings.ntaConfigured ? '設定済み' : '未設定' }} · <a :href="data.settings.settingsUrl" target="_blank" rel="noopener noreferrer" class="text-primary-main underline">Ryzen 7で接続設定を開く</a></p>
  <NuxtLink :to="{path:'/research-evaluation',query:{importId:draft.importId,line:draft.line}}" class="mt-3 inline-block text-xs text-primary-main underline">この購入をAI調査の評価に使う</NuxtLink>
  <form class="mt-4" @submit.prevent="start">
   <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">調べたいこと・追加で分かったこと（任意）
    <textarea v-model="instruction" rows="2" maxlength="2000" :disabled="pending || busy" class="mt-2 block w-full rounded-xl border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100" placeholder="例：運営会社とインボイス番号を調べて。購入メールも確認して。" />
   </label>
   <div class="mt-3 flex flex-wrap items-center gap-3"><button type="submit" data-research-start class="btn btn-primary text-xs disabled:opacity-50" :disabled="disabled || pending || busy || !data?.connected">{{ pending ? '調査中…' : research?.report ? '追加の情報で調べる' : '調査を開始' }}</button><p v-if="disabled" class="text-xs text-amber-700 dark:text-amber-400">編集中の内容を保存してから調査してください。</p></div>
  </form>
  <p v-if="pending" role="status" class="mt-4 text-sm text-gray-600 dark:text-gray-300">{{ stageLabel }} このページを離れても調査は続きます。</p>
  <p v-if="research?.state === 'failed'" class="mt-4 text-xs text-amber-700 dark:text-amber-400">調査を完了できませんでした。取得済みの資料を確認し、再試行できます。</p>
  <template v-if="research?.report">
   <p class="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200" data-research-summary>{{ research.report.summary }}</p>
   <p v-if="research.report.question" class="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{{ research.report.question }}</p>
   <p v-if="data.stale && research.state !== 'applied'" class="mt-3 text-xs text-amber-700 dark:text-amber-400">下書きが調査時から変わっています。候補を反映する前に再調査してください。</p>
   <div v-if="research.report.supplier" class="mt-5 rounded-xl border border-gray-200 p-4 dark:border-white/10" data-research-supplier>
    <p class="text-xs text-gray-500">運営会社の候補</p><p class="mt-1 break-words text-sm font-medium">{{ research.report.supplier.shopName }} · {{ research.report.supplier.legalName }}</p>
    <p class="mt-2 text-sm">{{ research.report.supplier.invoiceNumber || '登録番号は未取得' }}</p>
    <p class="mt-1 text-xs" :class="research.registry?.active ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">{{ research.registry?.active ? research.registry.asOf + '時点の国税庁登録情報を取得' : '登録番号の公的照合は未完了' }}</p>
    <p v-if="research.registry" class="mt-1 text-xs text-gray-500">取得した名義：{{ research.registry.legalName }}。店舗との対応は引用も確認してください。</p>
    <label class="mt-3 flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300"><input v-model="remember" type="checkbox" :disabled="supplierBlocked" class="mt-0.5 rounded border-gray-300 text-primary-main">この口座の同じ利用先として記憶する</label>
    <button type="button" data-research-save-supplier class="btn btn-secondary mt-3 text-xs disabled:opacity-50" :disabled="supplierBlocked || !!research.supplierId" @click="saveSupplier">{{ research.supplierId ? '仕入れ先を保存済み' : '根拠を確認して仕入れ先を保存' }}</button>
   </div>
   <div v-if="research.report.findings.length" class="mt-5 divide-y divide-gray-200 dark:divide-white/10">
    <article v-for="finding in research.report.findings" :key="finding.field" class="py-4">
     <label class="flex items-start gap-3"><input v-model="selected" type="checkbox" :value="finding.field" :disabled="blocked || research.state === 'applied'" class="mt-1 rounded border-gray-300 text-primary-main"><span class="min-w-0"><span class="block text-xs text-gray-500">{{ label(finding.field) }} · {{ finding.basis === 'literal' ? '資料の記載から' : '根拠に基づく推論' }}</span><span class="mt-1 block break-words text-sm font-medium">{{ display(finding) }}</span></span></label>
     <p class="ml-7 mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{{ finding.reason }}</p>
     <div v-for="citation in finding.citations" :key="citation.sourceId + citation.quote" class="ml-7 mt-2 border-l-2 border-gray-200 pl-3 dark:border-white/10"><p class="text-xs text-gray-400">{{ source(citation.sourceId)?.title }}</p><p class="mt-1 whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-300">{{ citation.quote }}</p></div>
    </article>
   </div>
   <button v-if="research.report.findings.length" type="button" data-research-apply class="btn btn-primary mt-3 text-xs disabled:opacity-50" :disabled="blocked || !selected.length || research.state === 'applied'" @click="apply">{{ research.state === 'applied' ? '選択した候補を下書きに保存済み' : '選択した候補を確認して下書きに保存' }}</button>
   <p class="mt-2 text-xs text-gray-500">選択した項目だけを保存します。帳簿への登録は下書きの確認後に行います。</p>
  </template>
  <div v-if="research?.artifacts?.length" class="mt-5 space-y-3"><h3 class="text-xs font-medium">取得した原本</h3><div v-for="artifact in research.artifacts" :key="artifact.id" class="flex flex-wrap items-center gap-3 text-xs"><button type="button" class="break-all text-primary-main underline" @click="download(artifact)">{{ artifact.name }}</button><button type="button" class="btn btn-secondary text-xs" :disabled="disabled || busy || pending" @click="attach(artifact)">この明細に添付する</button></div></div>
  <details v-if="research?.sources?.length" class="mt-5 text-xs"><summary class="cursor-pointer py-2 font-medium text-primary-main">調査の出典 · {{ research.sources.length }}件</summary><div v-for="s in research.sources" :key="s.id" class="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-white/5"><a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="break-words text-primary-main underline">{{ s.title }} ↗</a><p v-else class="font-medium">{{ s.title }}</p><p class="mt-1 text-gray-400">{{ new Date(s.capturedAt).toLocaleString('ja-JP') }}</p><details class="mt-2"><summary class="cursor-pointer text-gray-500">取得した本文</summary><pre class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed">{{ s.text }}</pre></details></div></details>
  <details v-if="research?.history?.length" class="mt-4 text-xs"><summary class="cursor-pointer py-2 text-primary-main">以前の調査・追加の説明</summary><div v-for="(h,i) in research.history" :key="i" class="mt-3 space-y-1 border-l-2 border-gray-200 pl-3"><p>{{ h.instruction }}</p><p class="text-gray-500">{{ h.report?.summary }}</p></div></details>
 </section>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
import {researchFields} from '~/shared/finance-research.mjs'
const props=defineProps<{draft:any;disabled:boolean}>(),emit=defineEmits(['changed'])
const user=useUserStore(),data=ref<any>(null),instruction=ref(''),error=ref(''),busy=ref(false),selected=ref<string[]>([]),remember=ref(true)
const requestId=()=>{const h=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')}
let loadSequence=0,disposed=false
const research=computed(()=>data.value?.research),pending=computed(()=>['queued','working','applying'].includes(research.value?.state))
const supplierBlocked=computed(()=>props.disabled||busy.value||pending.value||props.draft.locked)
const blocked=computed(()=>props.disabled||busy.value||pending.value||data.value?.stale||props.draft.locked)
const endpoint=computed(()=>'/api/finance-research/imports/'+props.draft.importId+'/drafts/'+props.draft.line)
const stateLabel=computed(()=>({queued:'順番待ち',working:'調査中',ready:'確認できます',applied:'反映済み',failed:'再試行できます',applying:'保存中'} as any)[research.value?.state]||'')
const stageLabel=computed(()=>({web:'公開情報を確認しています。',mail:'購入メールを照合しています。',document:'書類を読んでいます。',registry:'登録情報を照合しています。'} as any)[research.value?.events?.at(-1)?.stage]||'根拠を集めて整理しています。')
const binding=()=>({revision:props.draft.revision,key:props.draft.key,sourceHash:props.draft.sourceHash,researchRevision:research.value?.revision||0})
const label=(key:string)=>researchFields.find(f=>f.key===key)?.label||key
const source=(id:string)=>research.value?.sources.find((s:any)=>s.id===id)
const display=(f:any)=>{const field=researchFields.find(x=>x.key===f.field);return field?.ref?props.draft.references[field.ref]?.find((r:any)=>String(r._id)===f.value)?.name||f.value:f.value}
async function load(){const ticket=++loadSequence;try{const result=await $fetch(endpoint.value,{headers:user.authHeader});if(!disposed&&ticket===loadSequence)data.value=result}catch(e:any){if(!disposed&&ticket===loadSequence)error.value=e.data?.message||'調査を読み込めません。'}}
async function action(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e.data?.message||e.message||'調査を更新できません。'}finally{busy.value=false}}
async function start(){await action(async()=>{data.value=await $fetch(endpoint.value,{method:'POST',headers:user.authHeader,body:{...binding(),requestId:requestId(),instruction:instruction.value}});selected.value=[]})}
async function apply(){await action(async()=>{const result:any=await $fetch(endpoint.value+'/apply',{method:'POST',headers:user.authHeader,body:{...binding(),confirm:true,fields:selected.value}});data.value=result;selected.value=[];emit('changed',result.draft)})}
async function saveSupplier(){await action(async()=>{const result:any=await $fetch(endpoint.value+'/supplier',{method:'POST',headers:user.authHeader,body:{...binding(),confirm:true,remember:remember.value}});data.value=result;emit('changed',result.draft)})}
async function download(a:any){await action(async()=>{const blob:any=await $fetch('/api/finance-research/'+research.value.id+'/artifacts/'+a.id,{headers:user.authHeader,responseType:'blob'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})}
async function attach(a:any){await action(async()=>{const result:any=await $fetch('/api/finance-research/'+research.value.id+'/artifacts/'+a.id,{method:'POST',headers:user.authHeader,body:{...binding(),confirm:true}});emit('changed',result.draft);await load()})}
let timer:ReturnType<typeof setInterval>|undefined
onMounted(()=>{load();timer=setInterval(()=>{if(pending.value&&!busy.value)load()},4000)})
watch(()=>[props.draft.importId,props.draft.line,props.draft.revision],()=>load())
onBeforeUnmount(()=>{disposed=true;loadSequence++;clearInterval(timer)})
</script>

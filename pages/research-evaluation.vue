<template>
 <div class="mx-auto max-w-7xl space-y-6" data-evaluation-page>
  <header class="flex flex-wrap items-start justify-between gap-3">
   <div><NuxtLink to="/mapping" class="text-xs text-primary-main">マッピングへ戻る</NuxtLink><h1 class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">AI調査の評価</h1><p class="mt-2 text-sm text-gray-500">実際の購入と参照答えを使い、調査の結果を繰り返し比較します。</p></div>
   <button class="btn btn-secondary" type="button" @click="showPicker = !showPicker">評価ケースを追加</button>
  </header>
  <p v-if="error" role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{{ error }}</p>
  <section v-if="showPicker" class="card p-5"><label class="text-sm font-medium">保存済みの明細から選ぶ<select v-model="candidateKey" class="control mt-2"><option value="">明細を選択</option><option v-for="c in candidates" :key="c.importId + ':' + c.line" :value="c.importId + ':' + c.line">{{ c.date }} · {{ c.account }} · {{ c.merchant }}</option></select></label><button class="btn btn-secondary mt-3" :disabled="!candidateKey || busy" @click="pick">参照答えを作成</button></section>
  <form v-if="draft && form" class="card space-y-5 p-5 sm:p-6" data-evaluation-editor @submit.prevent="save">
   <div class="flex items-start justify-between gap-3"><div><h2 class="font-semibold">参照答えの確認</h2><p class="mt-1 text-xs text-gray-500">{{ draft.source.purchaseDate }} · {{ draft.source.description }} · {{ draft.source.amount }} {{ draft.source.currency }}</p></div><button type="button" class="text-sm text-gray-500" @click="form = null; draft = null">閉じる</button></div>
   <label class="block text-sm">ケース名<input v-model="form.title" class="control mt-2" maxlength="120" required></label>
   <label class="block text-sm">AIに渡す依頼・追加情報<textarea v-model="form.instruction" class="control mt-2" rows="2" maxlength="1500" placeholder="確認する範囲や購入時の事情。参照答えそのものは書かないでください。" /></label>
   <fieldset><legend class="text-sm font-medium">AIに最初から渡す既知の項目</legend><p class="mt-1 text-xs text-gray-500">採点する項目の答え、保存済みのマッピング理由・判断履歴はAIに渡しません。</p><div class="mt-3 flex flex-wrap gap-3"><label v-for="f in fields.filter(f => !empty(draft.values[f.key]) && !form.expectations.some(e => e.field === f.key))" :key="f.key" class="flex items-center gap-2 text-xs"><input v-model="form.knownFields" type="checkbox" :value="f.key">{{ f.label }}</label></div></fieldset>
   <div class="space-y-4"><div v-for="(e,i) in form.expectations" :key="i" class="rounded-xl border border-gray-200 p-4 dark:border-white/10">
    <div class="grid gap-3 sm:grid-cols-2"><label class="text-xs">採点項目<select v-model="e.field" class="control mt-1" @change="resetField(e)"><option v-for="f in fields" :key="f.key" :value="f.key">{{ f.label }}</option></select></label><label class="text-xs">期待する対応<select v-model="e.mode" class="control mt-1"><option value="value">参照答えと一致する提案</option><option value="abstain">根拠不足のため空欄を維持</option></select></label></div>
    <label v-if="e.mode === 'value'" class="mt-3 block text-xs">参照答え
     <select v-if="field(e.field)?.ref" v-model="e.value" class="control mt-1"><option value="">選択してください</option><option v-for="r in draft.references[field(e.field).ref]" :key="r._id" :value="r._id">{{ r.name }}</option></select>
     <select v-else-if="e.field === 'purpose'" v-model="e.value" class="control mt-1"><option value="company">会社経費</option><option value="customer">顧客の購入</option></select>
     <input v-else-if="field(e.field)?.kind === 'number'" v-model.number="e.value" type="number" min="0" step="any" class="control mt-1">
     <input v-else v-model="e.value" class="control mt-1" maxlength="1000">
    </label>
    <p v-if="e.alternatives?.length" class="mt-2 text-xs text-gray-500">同じ答えとして認める表記：{{ e.alternatives.join(' / ') }} <button type="button" class="underline" @click="e.alternatives = []">別表記を外す</button></p>
    <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="text-xs">参照答えの根拠<select v-model="e.basis" class="control mt-1"><option value="past_decision">明細で確認した過去の選択</option><option value="document">添付書類の記載</option><option value="owner_confirmed">今回、自分で確認した答え</option></select></label><label v-if="e.basis === 'document'" class="text-xs">根拠の書類<select v-model="e.documentId" class="control mt-1"><option value="">書類を選択</option><option v-for="d in draft.documents" :key="d.id" :value="d.id">{{ d.name }}</option></select></label></div>
    <label class="mt-3 block text-xs">根拠・確認した内容<textarea v-model="e.note" class="control mt-1" rows="2" maxlength="700" required /></label><button type="button" class="mt-2 text-xs text-red-600" @click="form.expectations.splice(i,1)">この採点項目を外す</button>
   </div></div>
   <button type="button" class="btn btn-secondary text-xs" @click="addField">採点項目を追加</button>
   <div class="grid gap-5 sm:grid-cols-2"><label class="text-sm">質問は必要か<select v-model="form.questionPolicy" class="control mt-2"><option value="ungraded">今回は採点しない</option><option value="required">購入者への確認が必要</option><option value="unnecessary">提供情報と資料で回答できる</option></select></label><fieldset><legend class="text-sm">取得が必要な根拠</legend><div class="mt-3 flex flex-wrap gap-3"><label v-for="s in sourceKinds" :key="s.key" class="flex items-center gap-2 text-xs"><input v-model="form.requiredSources" type="checkbox" :value="s.key">{{ s.label }}</label></div></fieldset></div>
   <label class="flex items-center gap-2 text-sm"><input v-model="form.active" type="checkbox">評価対象として使用する</label>
   <p class="text-xs leading-relaxed text-gray-500">過去の選択は会計上の正解を保証しません。参照答えは評価専用に保存し、購入の下書きや帳簿は変更しません。</p>
   <button type="submit" class="btn btn-primary" :disabled="busy || !form.expectations.length">参照答えを確認して保存</button>
  </form>
  <section class="card p-5 sm:p-6">
   <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-semibold">評価ケース <span class="text-sm font-normal text-gray-500">{{ data?.cases.length || 0 }}件</span></h2><p class="mt-1 text-xs text-gray-500">一度に12件まで。通常の購入調査が優先され、評価はバックグラウンドで進みます。</p></div><button class="btn btn-primary" data-evaluation-run :disabled="busy || !selected.length || selected.length > 12 || !data?.connected" @click="run">選択した {{ selected.length }}件を評価</button></div>
   <p v-if="!data?.connected" class="mt-3 text-xs text-amber-700">調査担当の接続を確認しています。</p>
   <p v-if="!data?.cases.length" class="mt-6 text-sm text-gray-500">保存済みの明細から、比較する答えとその根拠を登録してください。</p>
   <div class="mt-4 grid gap-3 md:grid-cols-2"><article v-for="c in data?.cases" :key="c._id" class="rounded-xl border border-gray-200 p-4 dark:border-white/10">
    <div class="flex items-start gap-3"><input v-model="selected" type="checkbox" :value="c._id" :disabled="!c.active || busy" class="mt-1"><div class="min-w-0 flex-1"><p class="break-words text-sm font-medium">{{ c.title }}</p><p class="mt-1 text-xs text-gray-500">{{ c.context.source.purchaseDate }} · {{ c.context.source.account.name }} · 第{{ c.revision }}版 <span v-if="!c.active">· 停止中</span></p><p class="mt-2 text-xs text-gray-500">{{ c.definition.expectations.map(e => label(e.field)).join(' / ') }}</p></div><button class="text-xs text-primary-main" @click="edit(c)">確認・編集</button></div>
   </article></div>
  </section>
  <section v-if="data?.batches.length" class="space-y-4" data-evaluation-results>
   <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">評価結果</h2><select v-model="batchId" class="control w-auto" @change="load"><option v-for="b in data.batches" :key="b.id" :value="b.id">{{ date(b.at) }}</option></select></div>
   <div class="grid grid-cols-2 gap-3 lg:grid-cols-4"><div v-for="m in metrics" :key="m.label" class="card p-4"><p class="text-xs text-gray-500">{{ m.label }}</p><p class="mt-2 text-xl font-semibold">{{ m.value }}</p></div></div>
   <div class="card p-4 text-xs leading-relaxed text-gray-500"><p>完了した評価の採点対象だけを集計しています。実行失敗 {{ data.summary.failed }}件、待機・実行中 {{ data.summary.pending }}件。</p><p class="mt-1">過去の選択：{{ ratio('past_decision') }} ／ 書類の記載：{{ ratio('document') }} ／ 今回確認した答え：{{ ratio('owner_confirmed') }}</p><p class="mt-1">一致は参照答えとの比較です。引用の存在は確認しますが、内容の正しさや質問の質は結果を読んで評価してください。</p></div>
   <article v-for="r in data.runs" :key="r._id" class="card p-5" data-evaluation-result>
    <div class="flex flex-wrap justify-between gap-2"><h3 class="text-sm font-semibold">{{ r.title }}</h3><span class="text-xs text-gray-500">{{ states[r.state] || r.state }}</span></div>
    <p class="mt-1 text-xs text-gray-500">参照答え 第{{ r.caseRevision }}版 · {{ r.runtime?.models.join(', ') || '実行モデルは完了時に記録' }}<span v-if="r.runtime"> · {{ Math.round(r.runtime.durationMs / 1000) }}秒</span></p>
    <p v-if="r.state === 'failed'" class="mt-3 text-sm text-amber-700">この評価は完了できませんでした。失敗件数として残し、項目の一致数には含めていません。</p>
    <div v-if="r.score" class="mt-4 space-y-2"><div v-for="f in r.score.fields" :key="f.field" class="grid gap-1 rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5 sm:grid-cols-3"><span>{{ label(f.field) }} · {{ verdicts[f.status] }}</span><span class="break-words text-gray-500">参照：{{ f.mode === 'abstain' ? '空欄を維持' : f.expected.map(v => display(f.field,v,r)).join(' / ') }}</span><span class="break-words">提案：{{ f.actual === null ? '未回答' : display(f.field,f.actual,r) }}</span></div><p class="text-xs text-gray-500">質問：{{ questionLabels[r.score.question.status] }} · 未取得の根拠 {{ [...r.score.sourceChecks,...r.score.documentChecks].filter(x => !x.present).length }}件 · 採点対象外の提案 {{ r.score.unscoredFields.length }}項目</p></div>
    <button class="mt-4 text-xs text-primary-main underline" @click="details(r._id)">回答と根拠を確認</button>
    <div v-if="expanded === r._id && detail" class="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-white/10"><p class="whitespace-pre-wrap text-sm leading-relaxed">{{ detail.report?.summary || '結果を待っています。' }}</p><p v-if="detail.report?.question" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{{ detail.report.question }}</p><div v-for="f in detail.report?.findings" :key="f.field" class="text-xs"><p class="font-medium">{{ label(f.field) }} · {{ f.reason }}</p><blockquote v-for="c in f.citations" :key="c.sourceId + c.quote" class="mt-2 whitespace-pre-wrap border-l-2 border-gray-200 pl-3 text-gray-500">{{ c.quote }}</blockquote></div><details v-for="s in detail.sources" :key="s.id" class="text-xs"><summary class="cursor-pointer text-primary-main">{{ s.title }}</summary><a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="mt-2 block underline">出典を開く</a><pre class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans text-gray-500">{{ s.text }}</pre></details></div>
   </article>
  </section>
 </div>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
import {researchFields} from '~/shared/finance-research.mjs'
import {isEmpty} from '~/shared/finance-draft.mjs'
const user=useUserStore(),route=useRoute(),fields=researchFields,empty=isEmpty
const data=ref<any>(null),error=ref(''),busy=ref(false),candidates=ref<any[]>([]),candidateKey=ref(''),showPicker=ref(false),draft=ref<any>(null),form=ref<any>(null),selected=ref<string[]>([]),batchId=ref(''),expanded=ref(''),detail=ref<any>(null)
const states:any={queued:'待機中',working:'調査中',complete:'完了',failed:'実行失敗'},verdicts:any={match:'一致',different:'参照と異なる',missing:'未回答',unexpected_answer:'空欄にすべき項目へ回答'},questionLabels:any={match:'指定した要否と一致',ungraded:'採点なし',unnecessary:'不要な質問あり',missing:'必要な質問なし'}
const sourceKinds=[{key:'web',label:'公開情報'},{key:'mail',label:'購入メール'},{key:'document',label:'添付書類'},{key:'registry',label:'国税庁照合'},{key:'spreadsheet',label:'シート'}]
const field=(key:string)=>fields.find(f=>f.key===key),label=(key:string)=>field(key)?.label||key,date=(v:string)=>new Date(v).toLocaleString('ja-JP')
const display=(key:string,value:any,run:any)=>{const ref=field(key)?.ref;return ref?run.references[ref]?.find(r=>r._id===value)?.name||value:value}
const metrics=computed(()=>{const s=data.value.summary,total=s.matched+s.different+s.missing+s.unexpected;return [{label:'実行完了',value:s.complete+' / '+s.total},{label:'参照答えとの一致',value:s.matched+' / '+total},{label:'異なる回答・未回答',value:s.different+s.missing+s.unexpected},{label:'不要な質問 / 要否を採点',value:s.questionsUnnecessary+' / '+s.questionsGraded}]})
const ratio=(basis:string)=>{const s=data.value.summary.byBasis[basis];return s.matched+'/'+s.total}
let sequence=0,disposed=false,timer:any
async function action(fn:()=>Promise<void>){sequence++;busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e.data?.data?.message||e.data?.message||e.message||'評価を更新できません。'}finally{busy.value=false}}
async function load(){const ticket=++sequence;try{const r:any=await $fetch('/api/finance-evaluation/overview',{headers:user.authHeader,query:batchId.value?{batchId:batchId.value}:{}});if(!disposed&&ticket===sequence){data.value=r;batchId.value=r.batchId;selected.value=selected.value.filter(id=>r.cases.some(c=>c._id===id&&c.active))}}catch(e:any){if(!disposed&&ticket===sequence)error.value=e.data?.message||'評価を読み込めません。'}}
function newExpectation(key:string){const d=draft.value,e=d.evidence[key],past=e?.state==='confirmed'&&['user','chat','slack'].includes(e.source);return {field:key,mode:'value',value:d.values[key],alternatives:[],basis:past?'past_decision':'owner_confirmed',documentId:'',note:past?'保存済みの明細で確認した値。根拠と現在の妥当性を確認してください。':''}}
function resetField(e:any){Object.assign(e,newExpectation(e.field));form.value.knownFields=form.value.knownFields.filter(k=>k!==e.field)}
function addField(){const f=fields.find(f=>!form.value.expectations.some(e=>e.field===f.key));if(f){form.value.expectations.push(newExpectation(f.key));form.value.knownFields=form.value.knownFields.filter(k=>k!==f.key)}}
async function open(importId:string,line:number,c?:any){await action(async()=>{draft.value=await $fetch('/api/finance/imports/'+importId+'/drafts/'+line,{headers:user.authHeader});const found=c||data.value.cases.find(x=>x.importId===importId&&x.line===line);form.value=found?{...JSON.parse(JSON.stringify(found.definition)),caseRevision:found.revision,active:found.active}:{title:draft.value.source.description+' · '+draft.value.source.purchaseDate,instruction:'',knownFields:[],expectations:fields.filter(f=>draft.value.evidence[f.key]?.state==='confirmed'&&!empty(draft.value.values[f.key])).slice(0,6).map(f=>newExpectation(f.key)),questionPolicy:'ungraded',requiredSources:[],caseRevision:0,active:true};showPicker.value=false})}
async function pick(){const [importId,line]=candidateKey.value.split(':');await open(importId,Number(line))}
async function edit(c:any){await open(c.importId,c.line,c)}
async function save(){await action(async()=>{const d=draft.value;await $fetch('/api/finance-evaluation/imports/'+d.importId+'/cases/'+d.line,{method:'POST',headers:user.authHeader,body:{...form.value,confirm:true,revision:d.revision,key:d.key,sourceHash:d.sourceHash}});form.value=null;draft.value=null;await load()})}
const uuid=()=>{const h=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')}
async function run(){await action(async()=>{const requestId=uuid();const response:any=await $fetch('/api/finance-evaluation/runs',{method:'POST',headers:user.authHeader,body:{batchId:requestId,cases:selected.value.map(id=>({id,revision:data.value.cases.find(c=>c._id===id).revision}))}});data.value=response;batchId.value=requestId;expanded.value='';detail.value=null})}
async function details(id:string){if(expanded.value===id){expanded.value='';return}await action(async()=>{const r:any=await $fetch('/api/finance-evaluation/runs/'+id,{headers:user.authHeader});expanded.value=id;detail.value=r.run})}
onMounted(async()=>{await load();try{const r:any=await $fetch('/api/finance-evaluation/candidates',{headers:user.authHeader});candidates.value=r.candidates}catch{error.value='保存済みの明細を読み込めません。'}if(typeof route.query.importId==='string'&&Number(route.query.line)>=2)await open(route.query.importId,Number(route.query.line));timer=setInterval(()=>{if(!busy.value)load()},5000)})
onBeforeUnmount(()=>{disposed=true;sequence++;clearInterval(timer)})
</script>
<style scoped>
.control{@apply block w-full rounded-xl border border-gray-300 bg-white p-2.5 text-sm text-gray-900 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-gray-900 dark:text-gray-100;}
input[type=checkbox]{@apply rounded border-gray-300 text-primary-main focus:ring-primary-main;}
</style>

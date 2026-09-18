<template>
 <section class="mt-4 border-t border-gray-100 pt-4 dark:border-white/10" data-workflow-investigation>
  <button v-if="!opened" type="button" class="text-xs font-medium text-primary-main underline" @click="opened=true;load()">購入候補・AIの照合を開く</button>
  <template v-else>
   <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold">購入候補と根拠</h3><button type="button" class="text-xs text-gray-500 underline" :disabled="busy" @click="load">再読込</button></div>
   <p v-if="error" role="alert" class="mt-3 text-xs text-red-600">{{ error }}</p>
   <p v-if="busy" role="status" class="mt-3 text-xs text-gray-500">資料を確認しています…</p>
   <p v-else-if="!data" class="mt-3 text-xs text-gray-500">購入候補はまだありません。夜間の調査結果がここに表示されます。</p>
   <template v-if="data">
    <p v-if="data.report?.summary" class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{{ data.report.summary }}</p>
    <p v-if="data.report?.question" class="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{{ data.report.question }}</p>
    <p v-if="data.offline?.unresolvedJan.length" class="mt-3 text-xs text-amber-700 dark:text-amber-300">JANの照合待ち {{ data.offline.unresolvedJan.length }}行。残りの商品の推定は保留しています。</p>
    <p v-else-if="data.offline?.pendingJan?.length" class="mt-3 text-xs text-amber-700 dark:text-amber-300">JANで特定した商品の在庫対応を先に確認してください。残りの商品の推定はその後に行います。</p>
    <p v-if="data.offline?.coverage && !data.offline.coverage.complete" class="mt-3 text-xs leading-relaxed text-gray-500">在庫候補は商品情報・入庫時期で絞り込んでいます。表示外の在庫がないという意味ではありません。<span v-if="data.offline.coverage.truncated">候補が多いため、残りの商品の推定を保留しています。</span></p>
    <form v-if="!purchase || purchase.order.kind==='receipt'" class="mt-4 space-y-3" @submit.prevent="saveNote">
     <label class="block text-xs text-gray-600 dark:text-gray-300">AIへの回答・この購入についての補足<textarea v-model="note" required maxlength="1000" rows="2" class="mt-1 block w-full rounded-lg border-gray-300 bg-white text-sm dark:border-white/10 dark:bg-white/5" /></label>
     <p class="text-xs text-gray-500">この支払いの根拠として保存し、次の夜間照合で再検討します。</p>
     <button class="btn btn-secondary text-xs disabled:opacity-50" :disabled="busy || !note.trim()">回答を保存して再照合</button>
     <p v-for="(decision,index) in data.decisions.filter((d:any)=>d.action==='owner_note').slice(-3)" :key="index" class="whitespace-pre-wrap text-xs text-gray-500">{{ decision.text }}</p>
    </form>
    <article v-for="candidate in data.alternatives" :key="candidate.id" class="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10">
     <div class="flex flex-wrap justify-between gap-2"><div><p class="text-xs text-gray-500">{{ candidate.kind==='receipt'?'店舗購入・領収書・商品タグ':'オンライン注文' }}<span v-if="candidate.accountName"> · {{ candidate.accountName }}</span></p><p class="mt-1 text-sm font-semibold">{{ candidate.orderNumber || candidate.receiptNumber || candidate.merchant || '番号の記載なし' }}</p></div><p class="text-sm tabular-nums">{{ candidate.date || '日付記載なし' }} · {{ candidate.total===null?'金額記載なし':yen(candidate.total) }}</p></div>
     <p v-if="candidate.claimed" class="mt-2 text-xs text-amber-700">別の支払いに接続済みです。</p>
     <div class="mt-3 space-y-2"><div v-for="item in candidate.items" :key="item.line" class="text-xs text-gray-600 dark:text-gray-300"><p>{{ item.product || item.model || (item.jan ? 'JAN '+item.jan : '商品記載の確認待ち') }}</p><p class="mt-1 text-gray-500">{{ item.color || '色の記載なし' }} · {{ item.size || 'サイズの記載なし' }} · {{ item.quantity ?? '数量不明' }}点<span v-if="item.lineTotal!==null && item.lineTotal!==undefined"> · {{ yen(item.lineTotal) }}</span></p></div></div>
     <p v-if="candidate.kind==='receipt' && (candidate.total===null || !candidate.date || !candidate.currency)" class="mt-3 text-xs leading-relaxed text-gray-500">未記載の金額・日付・通貨はカード明細の値として保存し、資料への記載とは区別します。商品ごとの価格は不明のまま保管します。</p>
     <template v-if="!purchase && candidate.kind==='receipt'"><label v-for="item in candidate.items.filter((i:any)=>i.quantity===undefined)" :key="item.line" class="mt-3 block text-xs text-gray-600 dark:text-gray-300">商品行 {{ item.line }} · 確認した購入数量<input v-model.number="quantities[candidate.id+':'+item.line]" type="number" min="1" max="10000" step="1" class="mt-1 block w-28 rounded-lg border-gray-300 bg-white text-sm dark:border-white/10 dark:bg-white/5"></label></template>
     <div v-for="hypothesis in hypotheses(candidate.id)" :key="hypothesis.candidateId" class="mt-3 text-xs"><p class="leading-relaxed text-gray-600 dark:text-gray-300">{{ hypothesis.uncertainty }}</p><details class="mt-2"><summary class="cursor-pointer text-gray-500">照合の根拠</summary><blockquote v-for="(source,index) in hypothesis.support" :key="index" class="mt-2 break-words border-l-2 border-gray-200 pl-3 text-gray-500">{{ source.quote }}</blockquote></details></div>
     <button v-for="original in originals(candidate)" :key="original.hash" type="button" class="mt-3 block break-all text-left text-xs text-primary-main underline" :disabled="busy" @click="download(original)">{{ original.name || '領収書の原本' }}</button>
     <p v-if="candidate.kind==='online' && originals(candidate).length!==candidate.files.length" class="mt-3 text-xs text-gray-500">購入原本を取得中です。</p>
     <template v-if="!purchase && !candidate.claimed && data.report">
      <button v-if="chosen!==candidate.id" type="button" class="btn btn-secondary mt-4 text-xs disabled:opacity-50" :disabled="busy || !ready(candidate)" @click="chosen=candidate.id;reason='';confirmed=false">この購入との対応を確認</button>
      <form v-else class="mt-4 space-y-3" @submit.prevent="accept(candidate)">
       <label class="block text-xs text-gray-600 dark:text-gray-300">判断の根拠・補足<textarea v-model="reason" required maxlength="1000" rows="2" class="mt-1 block w-full rounded-lg border-gray-300 bg-white text-sm dark:border-white/10 dark:bg-white/5" /></label>
       <label class="flex items-start gap-2 text-xs"><input v-model="confirmed" type="checkbox" required class="mt-0.5 rounded border-gray-300 text-primary-main">原本と商品・数量を確認し、このカード支払いの購入だと確認した</label>
       <div class="flex gap-3"><button class="btn btn-primary text-xs disabled:opacity-50" :disabled="busy || !confirmed || !reason.trim()">確認して接続</button><button type="button" class="text-xs text-gray-500 underline" @click="chosen=''">戻る</button></div>
      </form>
     </template>
    </article>
    <form v-if="purchase?.order.kind==='receipt' && inventoryProposals.length" class="mt-4 space-y-3 rounded-xl bg-gray-50 p-4 dark:bg-white/5" @submit.prevent="acceptInventory">
     <h4 class="text-sm font-semibold">領収書と在庫の対応候補</h4>
     <label v-for="proposal in inventoryProposals" :key="proposal.inventoryId" class="flex items-start gap-2 text-xs"><input v-model="inventoryIds" type="checkbox" :value="proposal.inventoryId" class="mt-0.5 rounded border-gray-300 text-primary-main"><span class="leading-relaxed">商品行 {{ proposal.line }} · {{ proposal.inventoryId }} · {{ proposal.basis==='jan_supported'?'JANの商品情報と一致':'推定候補' }}<span class="mt-1 block text-gray-500">{{ proposal.uncertainty }}</span></span></label>
     <label class="block text-xs text-gray-600 dark:text-gray-300">確認内容<textarea v-model="inventoryReason" required maxlength="1000" rows="2" class="mt-1 block w-full rounded-lg border-gray-300 bg-white text-sm dark:border-white/10 dark:bg-white/5" /></label>
     <button class="btn btn-primary text-xs disabled:opacity-50" :disabled="busy || !inventoryIds.length || !inventoryReason.trim()">確認した在庫を接続</button>
    </form>
   </template>
   <details v-if="purchase" class="mt-4 border-t border-gray-100 pt-3 text-xs dark:border-white/10"><summary class="cursor-pointer text-gray-500">購入の接続を訂正</summary><form class="mt-3 space-y-3" @submit.prevent="releasePurchase"><p class="leading-relaxed text-gray-500">購入との接続を解除し、原本・確認履歴・会計明細を保持します。輸出・返品に割当済みの場合は、先にその割当を訂正してください。</p><label class="block">訂正理由<textarea v-model="releaseReason" required maxlength="1000" rows="2" class="mt-1 block w-full rounded-lg border-gray-300 bg-white text-sm dark:border-white/10 dark:bg-white/5" /></label><label class="flex items-start gap-2"><input v-model="releaseConfirmed" type="checkbox" required class="mt-0.5 rounded border-gray-300">この購入と支払いの接続を解除する</label><button class="btn btn-secondary text-xs disabled:opacity-50" :disabled="busy || !releaseConfirmed || !releaseReason.trim()">接続を解除</button></form></details>
  </template>
 </section>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
const props=defineProps<{workflowId:string;purchaseId?:string|null}>(),emit=defineEmits(['changed']),user=useUserStore()
const opened=ref(false),busy=ref(false),error=ref(''),data=ref<any>(null),purchase=ref<any>(null),chosen=ref(''),reason=ref(''),confirmed=ref(false),inventoryIds=ref<string[]>([]),inventoryReason=ref(''),note=ref(''),quantities=reactive<Record<string,number>>({})
const releaseReason=ref(''),releaseConfirmed=ref(false)
const inventoryProposals=computed(()=>data.value?.report?.inventoryProposals.filter((p:any)=>p.receiptId===purchase.value?.order.archiveId&&!purchase.value.order.inventoryLinks.some((s:any)=>s.inventoryId===p.inventoryId))||[])
const endpoint=()=>'/api/finance-workflow/'+props.workflowId
const yen=(v:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(v)
const hypotheses=(id:string)=>data.value?.report?.hypotheses.filter((h:any)=>h.candidateId===id)||[]
const originals=(c:any)=>c.kind==='receipt'?[{hash:c.documentHash,name:'領収書の原本'}]:data.value.artifacts.filter((a:any)=>a.candidateId===c.id)
const ready=(c:any)=>c.kind==='receipt'?c.items.length>0&&c.items.every((i:any)=>Number.isSafeInteger(i.quantity??quantities[c.id+':'+i.line])&&(i.quantity??quantities[c.id+':'+i.line])>0&&(i.product||i.model||i.jan)):originals(c).length===c.files.length
async function action(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e.data?.data?.message||e.data?.message||e.data?.statusMessage||'資料を確認できません。再読込してください。'}finally{busy.value=false}}
async function read(){const result:any=await $fetch(endpoint()+'/investigation',{headers:user.authHeader});data.value=result.investigation;purchase.value=result.purchase}
async function load(){await action(read)}
async function accept(c:any){await action(async()=>{await $fetch(endpoint()+'/accept-purchase',{method:'POST',headers:user.authHeader,body:{revision:data.value.revision,fingerprint:data.value.fingerprint,candidateId:c.id,reason:reason.value,confirm:confirmed.value,...(c.kind==='receipt'?{itemQuantities:Object.fromEntries(c.items.filter((i:any)=>i.quantity===undefined).map((i:any)=>[String(i.line),quantities[c.id+':'+i.line]]))}:{})}});chosen.value='';emit('changed');await read()})}
async function acceptInventory(){await action(async()=>{await $fetch(endpoint()+'/accept-inventory',{method:'POST',headers:user.authHeader,body:{revision:data.value.revision,purchaseRevision:purchase.value.revision,fingerprint:data.value.fingerprint,inventoryIds:inventoryIds.value,reason:inventoryReason.value,confirm:true}});inventoryIds.value=[];inventoryReason.value='';emit('changed');await read()})}
async function saveNote(){await action(async()=>{await $fetch(endpoint()+'/note',{method:'POST',headers:user.authHeader,body:{revision:data.value.revision,text:note.value}});note.value='';emit('changed');await read()})}
async function releasePurchase(){await action(async()=>{await $fetch(endpoint()+'/release-purchase',{method:'POST',headers:user.authHeader,body:{purchaseId:purchase.value.id,purchaseRevision:purchase.value.revision,reason:releaseReason.value,confirm:releaseConfirmed.value}});releaseReason.value='';releaseConfirmed.value=false;emit('changed');await read()})}
async function download(original:any){await action(async()=>{const blob:any=await $fetch(endpoint()+'/original/'+original.hash,{headers:user.authHeader,responseType:'blob'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=original.name||'receipt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})}
</script>

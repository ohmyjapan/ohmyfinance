<template>
 <section class="card mb-6 p-4 sm:p-6" data-purchase-connections aria-label="注文・在庫・購入原本">
  <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">注文・在庫・購入原本</h2><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">日付と金額を照合し、注文の商品・在庫・原本をこの支払いに接続します。</p></div><button type="button" class="text-xs text-primary-main underline" :disabled="busy" @click="load">再読込</button></div>
  <p v-if="error" role="alert" class="mt-3 text-xs text-red-600">{{ error }}</p>
  <p v-if="message" role="status" class="mt-3 text-xs text-green-700 dark:text-green-400">{{ message }}</p>
  <div class="mt-4 rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5"><p class="text-xs text-gray-500">カード明細 · {{ draft.source.account.name }}</p><p class="mt-1">{{ draft.source.purchaseDate }} · {{ money(draft.source.amount) }}</p><p class="mt-1 break-words text-xs text-gray-500">{{ draft.source.description }}</p></div>
  <p v-if="!cards.length" class="mt-4 text-xs leading-relaxed text-gray-500">購入調査で取得した注文がここに表示されます。以前の調査結果は再調査すると原本との対応も取得できます。</p>
  <p v-if="matchingCount > 1" class="mt-4 text-xs text-amber-700 dark:text-amber-400">同額の注文候補が複数あります。商品・在庫を確認して選択してください。</p>
  <article v-for="card in cards" :key="card.order.archiveId" class="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10" data-purchase-order>
   <div class="flex flex-wrap items-start justify-between gap-2"><div><p class="text-xs text-gray-500">ISSEY MIYAKE · 注文 {{ card.order.orderNumber }}</p><p class="mt-1 text-sm font-semibold">{{ card.order.date }} · {{ money(card.order.total) }}</p></div><span class="text-xs" :class="card.saved?.status === 'linked' ? 'text-green-700 dark:text-green-400' : 'text-gray-500'">{{ card.saved?.status === 'linked' ? '接続済み' : card.saved?.status === 'released' ? '接続解除済み・原本保管中' : '接続候補' }}</span></div>
   <p v-if="card.saved?.status === 'linked' && card.candidate && card.saved.candidateHash !== card.candidate.candidateHash" class="mt-2 text-xs text-amber-700 dark:text-amber-400">新しい調査の候補を表示しています。確認して接続を更新できます。</p>
   <p v-if="card.candidate" class="mt-2 text-xs" :class="card.candidate.amountMatches ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">{{ card.candidate.amountMatches ? '金額一致' : '金額が異なります' }} · {{ dateDifference(card.candidate.dateOffsetDays) }}</p>
   <div class="mt-4 divide-y divide-gray-100 dark:divide-white/10">
    <div v-for="item in card.order.items" :key="item.line" class="py-3"><p class="break-words text-sm font-medium">{{ item.product }}</p><p class="mt-1 text-xs text-gray-500">{{ item.color }} · サイズ {{ item.size }} · {{ item.quantity }}点<span v-if="item.lineTotal !== null"> · 商品行合計 {{ money(item.lineTotal) }}</span></p>
     <p class="mt-2 text-xs text-gray-500">在庫 {{ inventory(card.order,item.line).length }} / {{ item.quantity }}点を接続{{ inventory(card.order,item.line).length < item.quantity ? ' · 残りは照合待ち' : '' }}</p>
     <div v-for="stock in inventory(card.order,item.line)" :key="stock.inventoryId" class="mt-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5"><p class="break-all font-medium">{{ stock.inventoryId }}</p><p class="mt-1 text-gray-500">{{ stock.source.sheet }} · {{ stock.source.inventoryCell }}</p><p v-if="stock.requiresReview" class="mt-1 text-amber-700 dark:text-amber-400">{{ stock.reviewReason }}</p><p v-for="(shipment,i) in stock.shipments" :key="i" class="mt-1 break-words text-gray-600 dark:text-gray-300">出荷記録 {{ shipment.date }} · {{ shipment.tracking || '追跡番号未記載' }} · {{ shipment.source.sheet }} {{ shipment.source.inventoryCell }}</p><p v-if="!stock.shipments.length" class="mt-1 text-gray-500">出荷記録の接続なし</p></div>
    </div>
   </div>
   <div class="mt-3 space-y-2"><p class="text-xs font-medium">注文履歴の原本</p><button v-for="original in card.originals" :key="original.hash" type="button" class="block max-w-full break-all text-left text-xs text-primary-main underline" :disabled="busy" @click="download(card,original)">{{ original.name }}</button></div>
   <p v-if="card.candidate?.conflict" class="mt-3 text-xs text-amber-700 dark:text-amber-400">この注文または在庫は別の支払いに接続済みです。</p>
   <p v-if="card.candidate && !card.candidate.documentsComplete" class="mt-3 text-xs text-amber-700 dark:text-amber-400">原本 {{ card.candidate.originals.length }} / {{ card.candidate.fileCount }}ページを取得。残りのページを調査してください。</p>
   <div class="mt-4 flex flex-wrap gap-3">
    <label v-if="card.candidate?.requiresInventoryReview && (card.saved?.candidateHash !== card.candidate.candidateHash || card.saved?.status === 'released')" class="flex w-full items-start gap-2 text-xs text-gray-600 dark:text-gray-300"><input v-model="inventoryConfirmed[card.candidate.candidateHash]" type="checkbox" class="mt-0.5 rounded border-gray-300 text-primary-main" :disabled="disabled || busy">サイズ記載のない在庫候補を注文の商品と確認した</label>
    <button v-if="card.candidate && (card.saved?.candidateHash !== card.candidate.candidateHash || card.saved?.status === 'released')" type="button" data-purchase-connect class="btn btn-primary text-xs disabled:opacity-50" :disabled="disabled || busy || draft.locked || !card.candidate.amountMatches || !card.candidate.documentsComplete || card.candidate.conflict || card.candidate.requiresInventoryReview && !inventoryConfirmed[card.candidate.candidateHash]" @click="connect(card.candidate)">{{ card.saved?.status === 'linked' ? '確認して在庫・原本を更新' : '確認して接続・原本を保存' }}</button>
    <button v-if="card.saved?.status === 'linked' && releaseId !== card.saved.id" type="button" class="text-xs text-gray-500 underline" :disabled="disabled || busy || draft.locked" @click="releaseId=card.saved.id">接続を解除</button>
    <template v-if="releaseId === card.saved?.id"><p class="w-full text-xs text-gray-500">原本を保管したまま、この支払いとの接続を解除します。</p><button type="button" class="btn btn-secondary text-xs" :disabled="disabled || busy || draft.locked" @click="release(card.saved)">解除する</button><button type="button" class="text-xs text-gray-500 underline" @click="releaseId=''">戻る</button></template>
   </div>
   <p v-if="card.saved?.confirmedAt" class="mt-3 text-xs text-gray-400">確認 {{ new Date(card.saved.confirmedAt).toLocaleString('ja-JP') }} · 注文取得 {{ new Date(card.order.capturedAt).toLocaleDateString('ja-JP') }}</p>
  </article>
  <p v-if="cards.length" class="mt-4 text-xs leading-relaxed text-gray-500">在庫の照合待ちでも原本を保存できます。接続した注文履歴は、支払い・在庫の根拠として保管します。</p>
 </section>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
const props=defineProps<{draft:any;disabled:boolean;researchRevision:number}>(),user=useUserStore()
const data=ref<any>(null),busy=ref(false),error=ref(''),message=ref(''),releaseId=ref('')
const inventoryConfirmed=ref<Record<string,boolean>>({})
let sequence=0,disposed=false
const endpoint=computed(()=>'/api/finance-purchases/imports/'+props.draft.importId+'/rows/'+props.draft.line)
const cards=computed(()=>{const rows=new Map<string,any>();for(const saved of data.value?.saved||[])rows.set(saved.order.archiveId,{order:saved.order,originals:saved.originals,saved});for(const candidate of data.value?.candidates||[]){const old=rows.get(candidate.order.archiveId);rows.set(candidate.order.archiveId,{...old,order:candidate.order,originals:candidate.originals,candidate})}return [...rows.values()]})
const matchingCount=computed(()=>(data.value?.candidates||[]).filter((c:any)=>c.amountMatches).length)
const money=(v:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(v)
const inventory=(order:any,line:number)=>order.inventoryLinks.filter((i:any)=>i.itemLine===line)
const dateDifference=(days:number)=>days===0?'同日':days<0?`カード明細の${-days}日前の注文`:`カード明細の${days}日後の注文`
const binding=()=>({revision:props.draft.revision,key:props.draft.key,sourceHash:props.draft.sourceHash})
async function load(){const ticket=++sequence;try{const result=await $fetch(endpoint.value,{headers:user.authHeader});if(!disposed&&ticket===sequence){data.value=result;error.value=''}}catch(e:any){if(!disposed&&ticket===sequence)error.value=e.data?.message||'購入の接続を読み込めません。'}}
async function action(fn:()=>Promise<void>){busy.value=true;error.value='';message.value='';++sequence;try{await fn()}catch(e:any){error.value=e.data?.message||e.message||'接続を保存できません。'}finally{busy.value=false}}
async function connect(c:any){await action(async()=>{data.value=await $fetch(endpoint.value,{method:'POST',headers:user.authHeader,body:{...binding(),researchRevision:data.value.researchRevision,archiveId:c.order.archiveId,candidateHash:c.candidateHash,linkRevision:c.linkRevision,confirm:true,confirmInventory:inventoryConfirmed.value[c.candidateHash]===true}});message.value='注文・在庫の接続と原本を保存しました。'})}
async function release(saved:any){await action(async()=>{data.value=await $fetch(endpoint.value,{method:'DELETE',headers:user.authHeader,body:{...binding(),id:saved.id,linkRevision:saved.revision,confirm:true}});releaseId.value='';message.value='接続を解除しました。購入原本は保管されています。'})}
async function download(card:any,original:any){await action(async()=>{const saved=card.saved?.originals.some((o:any)=>o.hash===original.hash),url=saved?'/api/finance-purchases/'+card.saved.id+'/originals/'+original.hash:'/api/finance-research/'+data.value.researchId+'/artifacts/'+original.artifactId;const blob:any=await $fetch(url,{headers:user.authHeader,responseType:'blob'});const objectUrl=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectUrl;a.download=original.name;a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)})}
onMounted(load)
watch(()=>[props.draft.importId,props.draft.line,props.draft.revision,props.researchRevision],()=>{releaseId.value='';load()})
onBeforeUnmount(()=>{disposed=true;++sequence})
</script>

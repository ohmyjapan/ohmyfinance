<template>
  <section class="card mb-6 p-4 sm:p-6" data-document-matches>
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">書類との照合</h2><p class="mt-1 text-xs text-gray-500">{{ accountName }} · 添付資料を同じカード明細内で照合します。</p></div><button type="button" class="btn btn-secondary text-xs" :disabled="busy" @click="load">更新</button></div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="!documents.length && !busy" class="mt-3 text-xs text-gray-500">下書きに領収書・注文書・発送シートのPDFや画像を添付し、読み取ると照合候補をまとめて確認できます。</p>
    <p v-if="truncated" class="mt-3 text-xs text-amber-700">最新100書類を表示しています。以前の書類は各下書きで確認できます。</p>
    <p v-if="pending" class="mt-3 text-xs text-gray-500">未読み取り・処理中など {{ pending }}書類。添付した下書きで読み取り状況を確認してください。</p>
    <details v-for="group in groups.filter(g=>g.items.length)" :key="group.key" class="mt-4 border-t border-gray-200 pt-3 dark:border-white/10" :data-document-group="group.key">
      <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-100">{{ group.label }} <span class="ml-2 text-gray-500">{{ group.items.length }}件</span></summary>
      <article v-for="item in group.items" :key="item.doc.id+':'+item.match.record" class="mt-3 rounded-xl border border-gray-200 p-3 dark:border-white/10">
        <p class="break-words text-sm font-medium">{{ item.doc.name }} · 記録 {{ item.match.record+1 }}</p>
        <p class="mt-1 break-words text-xs text-gray-500">{{ summary(item) }}</p>
        <NuxtLink :to="'/mapping-draft/'+importId+'/'+item.doc.line" class="mt-2 inline-block py-1 text-xs text-primary-main">元の書類と引用を確認 →</NuxtLink>
        <p v-if="!item.match.matches.length" class="mt-2 text-xs text-amber-700">金額だけでは照合しません。注文番号などの追加情報が必要です。</p>
        <div v-for="match in item.match.matches" :key="match.line" class="mt-3 border-t border-gray-200 pt-3 dark:border-white/10">
          <p class="break-words text-sm">{{ match.description }} · {{ match.date }} · {{ yen(match.amount) }}</p>
          <p class="mt-1 text-xs text-gray-500">{{ match.signals.join('・') }}</p><p v-if="match.conflicts.length" class="mt-1 text-xs text-amber-700">{{ match.conflicts.join('・') }}</p>
          <NuxtLink v-if="item.doc.attachedLines.includes(match.line)" :to="'/mapping-draft/'+importId+'/'+match.line" class="mt-2 inline-block py-2 text-xs text-primary-main">添付済みの下書きを確認 →</NuxtLink>
          <template v-else><button type="button" class="btn btn-secondary mt-3 text-xs" :disabled="busy" @click="prepare(item,match)">この明細への添付を確認</button></template>
        </div>
      </article>
    </details>
    <div v-if="choice" class="mt-4 rounded-xl border border-primary-main/20 bg-primary-main/5 p-4 text-sm" data-confirm-document-link>
      <p class="break-words">「{{ choice.doc.name }}」の記録 {{ choice.record+1 }}を「{{ choice.description }}」の資料として添付します。</p><p class="mt-2 text-xs text-gray-500">購入内容の項目は、添付先の下書きで候補を選択して保存できます。</p><p v-if="choice.conflicts.length" class="mt-2 text-xs text-amber-700">{{ choice.conflicts.join('・') }}。相違を確認してから関連付けてください。</p>
      <div class="mt-3 flex flex-wrap gap-3"><button type="button" class="btn btn-primary text-xs" :disabled="busy" data-link-document @click="link">この支払いの資料として添付</button><button type="button" class="btn btn-secondary text-xs" :disabled="busy" @click="choice=null">戻る</button></div>
    </div>
  </section>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
const props=defineProps<{importId:string;accountName:string}>(),user=useUserStore(),documents=ref<any[]>([]),busy=ref(false),error=ref(''),truncated=ref(false),choice=ref<any>(null)
const pending=computed(()=>documents.value.filter(d=>!d.matches.length).length)
const groups=computed(()=>[{key:'candidate',label:'一致候補'},{key:'ambiguous',label:'同じ条件の明細が複数'},{key:'review',label:'追加確認が必要'},{key:'unmatched',label:'照合情報が不足'}].map(g=>({...g,items:documents.value.flatMap(doc=>doc.matches.filter((m:any)=>m.status===g.key).map((match:any)=>({doc,match})))})))
const yen=(n:number)=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(n)
const summary=(item:any)=>item.doc.reading.records.find((r:any)=>r.index===item.match.record)?.fields.filter((f:any)=>['merchant','receiptNumber','productName'].includes(f.key)).slice(0,4).map((f:any)=>f.value).join(' · ')
async function load(){busy.value=true;error.value='';try{const r:any=await $fetch('/api/finance-documents/imports/'+props.importId,{headers:user.authHeader});documents.value=r.documents;truncated.value=r.truncated}catch(e:any){error.value=e.data?.statusMessage||'書類との照合を取得できません。'}finally{busy.value=false}}
async function prepare(item:any,match:any){busy.value=true;error.value='';choice.value=null;try{const draft:any=await $fetch('/api/finance/imports/'+props.importId+'/drafts/'+match.line,{headers:user.authHeader});if(draft.locked)throw Error('この明細は登録済みのため添付できません。');choice.value={doc:item.doc,record:item.match.record,line:match.line,description:match.description,conflicts:match.conflicts,revision:draft.revision,key:draft.key,sourceHash:draft.sourceHash}}catch(e:any){error.value=e.data?.statusMessage||e.message}finally{busy.value=false}}
async function link(){busy.value=true;error.value='';try{const c=choice.value;await $fetch('/api/finance-documents/'+c.doc.id+'/link',{method:'POST',headers:user.authHeader,body:{hash:c.doc.hash,record:c.record,line:c.line,revision:c.revision,key:c.key,sourceHash:c.sourceHash,confirm:true}});choice.value=null;await load()}catch(e:any){error.value=e.data?.statusMessage||'添付を完了できません。明細を更新して再確認してください。';choice.value=null}finally{busy.value=false}}
onMounted(load)
</script>

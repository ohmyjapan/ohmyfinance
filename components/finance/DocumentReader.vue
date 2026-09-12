<template>
  <div class="mt-4 min-w-0 border-t border-gray-200 pt-4 dark:border-white/10" data-document-reader>
    <p v-if="error" role="alert" class="mb-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="['queued','working'].includes(reading.state)" role="status" class="text-sm text-primary-main">{{ reading.state === 'queued' ? '読み取り待ちです。完了すると候補を表示します。' : '書類を読み取っています…' }}</p>
    <template v-else-if="reading.state !== 'ready'">
      <p class="mb-2 text-xs text-gray-500">{{ ['failed','stale'].includes(reading.state) ? '読み取りを完了できませんでした。元の書類を確認して再試行してください。' : '書類から購入品・注文番号・記載された税率などを読み取ります。' }}</p>
      <button type="button" class="btn btn-secondary text-xs" data-extract-document :disabled="busy" @click="extract">{{ ['failed','stale'].includes(reading.state) ? '読み取りを再試行' : '書類を読み取る' }}</button>
    </template>
    <template v-else>
      <p class="text-xs text-gray-500">読み取り候補です。元の書類と今回の支払いを照合してから選択してください。</p>
      <p v-if="!reading.complete || !reading.records?.length" class="mt-3 text-sm text-amber-700">注文単位で読み取れませんでした。元の書類を確認し、必要な項目を入力してください。</p>
      <details v-for="record in reading.complete ? reading.records : []" :key="record.index" class="mt-3 rounded-xl border border-gray-200 p-3 dark:border-white/10" data-document-record>
        <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-100">{{ title(record) }} <span class="ml-2 text-xs font-normal text-gray-500">記録 {{ record.index + 1 }}</span></summary>
        <p class="mt-3 text-xs text-gray-500">{{ record.fields.filter((f:any)=>f.key==='taxRate').length > 1 ? '複数の税率があります。取引全体の税率にはまとめません。' : '記載税率は税区分・仕入税額控除の判断とは別です。' }} 登録番号は公的情報での確認が必要です。</p>
        <dl class="mt-3 space-y-3"><div v-for="(field,index) in record.fields" :key="index"><dt class="text-xs text-gray-500">{{ documentFieldLabels[field.key] }} · {{ field.page }}ページ</dt><dd class="mt-1 break-words text-sm text-gray-900 dark:text-gray-100">{{ field.value }}{{ field.key==='taxRate'?'%':'' }}<blockquote class="mt-1 whitespace-pre-wrap break-words border-l-2 border-gray-200 pl-3 text-xs text-gray-500">{{ field.quote }}</blockquote></dd></div></dl>
        <div v-if="!disabled && suggestions(record).length" class="mt-4 border-t border-gray-200 pt-3 dark:border-white/10">
          <p class="mb-3 text-xs text-gray-500">今回の支払いの情報として使う項目を選択します。下書きの保存で確定します。</p>
          <label v-for="field in suggestions(record)" :key="field.key" class="mb-3 flex min-w-0 items-start gap-2 text-sm"><input v-model="selected" type="checkbox" :value="record.index+':'+field.key" class="mt-1 text-primary-main" :data-document-field="field.key"><span class="min-w-0 break-words">{{ field.label }}<span class="mt-1 block text-xs text-gray-500">{{ shown(values[field.key]) }} → {{ shown(field.value) }}{{ field.key==='taxRate'?'%':'' }}</span></span></label>
          <button type="button" class="btn btn-secondary text-xs" data-use-document :disabled="!chosen(record).length" @click="use(record)">選んだ候補を下書きに反映</button>
        </div>
      </details>
    </template>
  </div>
</template>
<script setup lang="ts">
import { useUserStore } from '~/stores/user'
import { documentFieldLabels, documentSuggestions } from '~/shared/finance-document-evidence.mjs'
const props=defineProps<{document:any;values:any;disabled?:boolean}>(),emit=defineEmits<{select:[selection:any];reading:[document:any]}>()
const user=useUserStore(),reading=ref<any>(props.document.reading||{state:'idle'}),busy=ref(false),error=ref(''),selected=ref<string[]>([])
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false
const suggestions=(record:any)=>documentSuggestions(record),shown=(v:any)=>v===null||v===undefined||v===''?'空欄':String(v)
const title=(record:any)=>record.fields.find((f:any)=>f.key==='merchant')?.value||record.fields.find((f:any)=>f.key==='receiptNumber')?.value||'書類の記録'
const chosen=(record:any)=>suggestions(record).filter((f:any)=>selected.value.includes(record.index+':'+f.key))
function use(record:any){emit('select',{documentId:props.document.id,hash:props.document.hash,record:record.index,fields:chosen(record)});selected.value=[]}
function received(data:any){reading.value=data.reading;emit('reading',{...props.document,reading:data.reading});schedule()}
function schedule(){clearTimeout(timer);if(!disposed&&['queued','working'].includes(reading.value.state))timer=setTimeout(poll,3000)}
async function poll(){try{received(await $fetch('/api/finance-documents/'+props.document.id,{headers:user.authHeader}));error.value=''}catch{if(!disposed){error.value='読み取り状況を取得できません。接続を確認してください。';schedule()}}}
async function extract(){busy.value=true;error.value='';try{received(await $fetch('/api/finance-documents/'+props.document.id+'/extract',{method:'POST',headers:user.authHeader,body:{hash:props.document.hash}}))}catch(e:any){error.value=e.data?.data?.message||e.data?.statusMessage||'読み取りに接続できません。'}finally{busy.value=false}}
watch(()=>props.document.reading,v=>{if(v){reading.value=v;schedule()}})
onMounted(schedule);onBeforeUnmount(()=>{disposed=true;clearTimeout(timer)})
</script>

<template>
 <details data-support-report class="min-w-0 border-t border-gray-100 text-xs dark:border-white/10">
  <summary data-support-toggle class="cursor-pointer px-5 py-3 text-gray-500 hover:bg-gray-50 focus-visible:outline-primary-main dark:text-gray-400 dark:hover:bg-white/5">サポート用の接続診断</summary>
  <div class="space-y-3 px-5 pb-4">
   <p class="max-w-2xl leading-relaxed text-gray-500 dark:text-gray-400">現在のログインユーザーの接続信号だけを確認します。取引・金額・会社名・認証情報・会話は含みません。ダウンロード後、ご自身でサポートに共有できます。</p>
   <button data-support-create type="button" :disabled="busy" class="rounded-lg border border-gray-200 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5" @click="generate">{{ busy ? '確認中…' : report ? 'もう一度確認' : '診断を作成' }}</button>
   <p v-if="error" data-support-error role="alert" class="text-red-600 dark:text-red-400">{{ error }}</p>
   <div v-if="report" data-support-result class="space-y-3">
    <dl class="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-3"><div v-for="(label, key) in labels" :key="key" class="rounded-lg bg-gray-50 p-3 dark:bg-white/5"><dt class="text-gray-500 dark:text-gray-400">{{ label }}</dt><dd class="mt-1 font-medium text-gray-800 dark:text-gray-100">{{ states[report.connections[key]] }}</dd></div></dl>
    <p class="max-w-2xl leading-relaxed text-gray-500 dark:text-gray-400">直近65秒の接続信号です。AIの応答、カード・銀行へのログイン、ダウンロードの成功を保証するものではありません。</p>
    <p class="break-all text-gray-500 dark:text-gray-400">診断番号: <span data-support-reference>{{ report.reference }}</span></p>
    <button data-support-download type="button" class="rounded-lg bg-primary-main/10 px-3 py-2 font-medium text-primary-main hover:bg-primary-main/20" @click="download">診断JSONをダウンロード</button>
   </div>
  </div>
 </details>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
type State = 'not_configured'|'recent_heartbeat'|'no_recent_heartbeat'
type Report = {schemaVersion:1;reference:string;generatedAt:string;scope:'signed_in_user';heartbeatWindowSeconds:65;connections:Record<'assistant'|'research'|'collector',State>}
const user=useUserStore(),busy=ref(false),error=ref(''),report=ref<Report|null>(null)
const labels={assistant:'OMF Navi',research:'調査ワーカー',collector:'データ取得アプリ'}
const states:Record<State,string>={not_configured:'未設定',recent_heartbeat:'接続信号あり',no_recent_heartbeat:'最近の接続信号なし'}
let ticket=0
// Pick validated fields again in the browser; never download an arbitrary API response wholesale.
function safeReport(value:any):Report {
 if(value?.schemaVersion!==1||value.scope!=='signed_in_user'||value.heartbeatWindowSeconds!==65||typeof value.reference!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value.reference)||typeof value.generatedAt!=='string'||!Number.isFinite(Date.parse(value.generatedAt))||new Date(value.generatedAt).toISOString()!==value.generatedAt)throw Error('Invalid report')
 const connections={} as Report['connections']
 for(const key of ['assistant','research','collector'] as const){const state=value.connections?.[key];if(!Object.hasOwn(states,state))throw Error('Invalid state');connections[key]=state}
 return{schemaVersion:1,reference:value.reference,generatedAt:value.generatedAt,scope:'signed_in_user',heartbeatWindowSeconds:65,connections}
}
async function generate(){
 const current=++ticket,identity=user.user?.id;busy.value=true;error.value='';report.value=null
 try{const data=await $fetch('/api/support/report',{headers:user.authHeader});if(current===ticket&&user.isAuthenticated&&identity===user.user?.id)report.value=safeReport(data)}
 catch{if(current===ticket)error.value='診断を作成できませんでした。再度お試しください。'}
 finally{if(current===ticket)busy.value=false}
}
function download(){
 if(!report.value||!user.isAuthenticated)return
 const url=URL.createObjectURL(new Blob([JSON.stringify(report.value,null,2)],{type:'application/json'})),link=document.createElement('a')
 link.href=url;link.download='omf-support-'+report.value.reference+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
watch(()=>[user.user?.id,user.isAuthenticated,user.sessionId],()=>{ticket++;report.value=null;error.value='';busy.value=false},{flush:'sync'})
onBeforeUnmount(()=>{ticket++})
</script>

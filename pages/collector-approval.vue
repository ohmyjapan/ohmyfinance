<template>
  <main class="min-h-screen flex items-center justify-center px-4 py-12 bg-gray-50 dark:bg-slate-950">
    <section class="w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 sm:p-8 shadow-sm">
      <p class="text-sm font-semibold text-primary-main">OhMyFinance</p>
      <h1 class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{{ heading }}</h1>
      <p v-if="loading" class="mt-4 text-gray-600 dark:text-gray-300">承認内容を確認しています…</p>
      <template v-else-if="request">
        <p class="mt-4 text-gray-600 dark:text-gray-300"><strong>{{ request.collectorName }}</strong> からのリクエストです。</p>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">{{ explanation }}</p>
        <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">{{ request.email }}</p>
        <form v-if="!completed" class="mt-6 space-y-4" @submit.prevent="approve">
          <div><label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-200">OMF のパスワード</label>
            <input id="password" v-model="password" type="password" autocomplete="current-password" required maxlength="512" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <div v-if="request.twoFactorEnabled"><label for="code" class="block text-sm font-medium text-gray-700 dark:text-gray-200">認証コード（またはバックアップコード）</label>
            <input id="code" v-model="code" autocomplete="one-time-code" required maxlength="8" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <button type="submit" :disabled="busy" class="w-full rounded-lg bg-primary-main px-4 py-3 font-medium text-white disabled:opacity-50">{{ busy ? '確認しています…' : '承認する' }}</button>
          <button type="button" :disabled="busy" class="w-full text-sm text-gray-600 dark:text-gray-300" @click="cancel">キャンセル</button>
        </form>
        <p v-else class="mt-6 text-gray-700 dark:text-gray-200">{{ cancelled ? '承認をキャンセルしました。コレクターの画面に戻ってください。' : '承認しました。コレクターに戻ります…' }}</p>
      </template>
      <p v-if="error" role="alert" class="mt-4 rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-200">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { useUserStore } from '~/stores/user'
definePageMeta({layout:false})
useHead({title:'コレクターの承認 — OhMyFinance',meta:[{name:'referrer',content:'no-referrer'}]})
const route=useRoute(),user=useUserStore()
const request=ref<any>(null),password=ref(''),code=ref(''),loading=ref(true),busy=ref(false),completed=ref(false),cancelled=ref(false),error=ref('')
const id=typeof route.query.id==='string'&&/^[a-f0-9]{64}$/.test(route.query.id)?route.query.id:''
const headings:Record<string,string>={enroll:'この PC を接続',batch:'この PC を再接続',pair:'接続先を更新',reset:'ログイン保護を再設定'}
const heading=computed(()=>headings[request.value?.action]||'コレクターの承認')
const explanation=computed(()=>request.value?.action==='reset'?'保存済みのログインは引き継がれません。再設定後にカード会社へログインし直してください。':request.value?.action==='pair'?'この PC と OMF の接続を更新し、自動取得を許可します。':'この PC を記憶して、保存済みログインによる明細の自動取得を許可します。通常の起動や取得のたびに承認する必要はありません。')
onMounted(async()=>{try{if(!id)throw Error('承認リンクが無効です。コレクターからやり直してください。');request.value=await $fetch('/api/finance/collector-security/requests/'+id,{headers:user.authHeader})}catch(e:any){error.value=e.data?.statusMessage||e.message||'承認内容を取得できませんでした。'}finally{loading.value=false}})
async function approve(){
  busy.value=true;error.value=''
  try{
    const result:any=await $fetch('/api/finance/collector-security/requests/'+id,{method:'POST',headers:user.authHeader,body:{password:password.value,code:code.value}})
    const target=new URL(result.redirectUri)
    if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/collector-callback'||target.username||target.password)throw Error('コレクターに戻れませんでした。コレクターからやり直してください。')
    completed.value=true;window.location.assign(target.href)
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'承認できませんでした。'}finally{password.value='';code.value='';busy.value=false}
}
async function cancel(){
  busy.value=true;password.value='';code.value='';error.value=''
  try{
    const result:any=await $fetch('/api/finance/collector-security/requests/'+id,{method:'DELETE',headers:user.authHeader})
    const target=new URL(result.redirectUri)
    if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/collector-callback'||target.username||target.password)throw Error('コレクターの画面からキャンセルしてください。')
    completed.value=true;cancelled.value=true;window.location.assign(target.href)
  }catch(e:any){error.value=e.data?.statusMessage||e.message}finally{busy.value=false}
}
</script>

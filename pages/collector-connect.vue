<template>
  <main class="min-h-screen flex items-center justify-center px-4 py-12 bg-gray-50 dark:bg-slate-950">
    <section class="w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 sm:p-8 shadow-sm">
      <p class="text-sm font-semibold text-primary-main">OhMyFinance</p>
      <h1 class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">明細ダウンローダーを接続</h1>
      <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">ダウンローダーはPCごとに1つです。対応する複数のカード口座をまとめて接続でき、カードごとのインストールは不要です。</p>
      <p v-if="loading" class="mt-4 text-gray-600 dark:text-gray-300">接続内容を確認しています…</p>
      <template v-else-if="request && !finished">
        <p class="mt-4 text-gray-600 dark:text-gray-300"><strong>{{ request.pcName }}</strong> からの接続リクエストです。</p>
        <form v-if="step === 'signin'" class="mt-6 space-y-4" @submit.prevent="signIn">
          <p class="text-sm text-gray-600 dark:text-gray-300">OMF のメールアドレス・パスワード・認証コードでサインインします。このサインインはこの接続のためだけに使われ、ブラウザや PC に OMF のセッションは残りません。</p>
          <div><label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-200">メールアドレス</label>
            <input id="email" v-model="email" type="email" autocomplete="username" required maxlength="254" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <div><label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-200">OMF のパスワード</label>
            <input id="password" v-model="password" type="password" autocomplete="current-password" required maxlength="512" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <div><label for="code" class="block text-sm font-medium text-gray-700 dark:text-gray-200">認証コード（またはバックアップコード・有効にしている場合）</label>
            <input id="code" v-model="code" autocomplete="one-time-code" maxlength="8" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <button type="submit" :disabled="busy" class="w-full rounded-lg bg-primary-main px-4 py-3 font-medium text-white disabled:opacity-50">{{ busy ? '確認しています…' : 'サインインして続ける' }}</button>
          <button type="button" :disabled="busy" class="w-full text-sm text-gray-600 dark:text-gray-300" @click="leave">キャンセル</button>
        </form>
        <form v-else class="mt-6 space-y-4" @submit.prevent="approve">
          <p class="text-sm text-gray-600 dark:text-gray-300">このPCで取得するカード口座を選んでください（複数選択可）。カード会社へのログイン・認証は、このあとPC側の設定画面で各社のアカウントごとに行います。</p>
          <p v-if="!accounts.length" class="text-sm text-gray-700 dark:text-gray-200">取得できるカード口座がまだありません。<NuxtLink to="/connections" class="underline">カード連携で口座を追加</NuxtLink>してから、ダウンローダーでもう一度「Connect to OMF」を押してください。</p>
          <label v-for="account in accounts" :key="account.id" class="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-slate-600 p-3 text-gray-900 dark:text-white">
            <input v-model="selected" type="checkbox" name="accountIds" :value="account.id" class="mt-1" />
            <span><strong>{{ account.name }}</strong><br /><span class="text-sm text-gray-600 dark:text-gray-300">カード {{ account.cards.join(' / ') }}</span></span>
          </label>
          <div><label for="pc-name" class="block text-sm font-medium text-gray-700 dark:text-gray-200">PC の名前</label>
            <input id="pc-name" v-model="pcName" required maxlength="100" class="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-gray-900 dark:text-white" /></div>
          <button id="approve" type="submit" :disabled="busy || !selected.length" class="w-full rounded-lg bg-primary-main px-4 py-3 font-medium text-white disabled:opacity-50">{{ busy ? '接続しています…' : '接続する' }}</button>
          <button type="button" :disabled="busy" class="w-full text-sm text-gray-600 dark:text-gray-300" @click="cancel">キャンセル</button>
        </form>
      </template>
      <p v-else-if="finished" class="mt-6 text-gray-700 dark:text-gray-200">{{ finishedText }}</p>
      <p v-if="error" role="alert" class="mt-4 rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-200">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
// The downloader's one sign-in (plan omf-customer-connect-20261010): sign in → choose cards → connect. Nothing private is
// shown before the fresh sign-in succeeds; the request-scoped proof lives only in this closure, never in storage or the URL.
definePageMeta({layout:false})
useHead({title:'ダウンローダーの接続 — OhMyFinance',meta:[{name:'referrer',content:'no-referrer'}]})
const route=useRoute()
const id=typeof route.query.id==='string'&&/^[a-f0-9]{64}$/.test(route.query.id)?route.query.id:''
const request=ref<any>(null),loading=ref(true),busy=ref(false),error=ref(''),step=ref<'signin'|'select'>('signin'),finished=ref(false),finishedText=ref('')
const email=ref(''),password=ref(''),code=ref(''),accounts=ref<any[]>([]),selected=ref<string[]>([]),pcName=ref('')
let proof=''
const api=(path:string,body?:any):Promise<any>=>$fetch('/api/finance/collector-connect/requests/'+id+path,{method:body?'POST':'GET',body})
const ended:Record<string,string>={finished:'この接続はすでに完了しています。ダウンローダーの画面に戻ってください。',cancelled:'この接続はキャンセルされました。ダウンローダーからやり直してください。',expired:'この接続リクエストは期限切れです。ダウンローダーでもう一度「Connect to OMF」を押してください。'}
const loopback=(value:string)=>{const target=new URL(value);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/collector-callback'||target.username||target.password)throw Error('ダウンローダーに戻れませんでした。ダウンローダーからやり直してください。');return target.href}
onMounted(async()=>{
  try{
    if(!id)throw Error('接続リンクが無効です。ダウンローダーからやり直してください。')
    request.value=await api('')
    pcName.value=request.value.pcName
    if(ended[request.value.status]){finished.value=true;finishedText.value=ended[request.value.status]}
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'接続内容を取得できませんでした。'}finally{loading.value=false}
})
async function signIn(){
  busy.value=true;error.value=''
  try{
    const result=await api('/authenticate',{email:email.value,password:password.value,code:code.value})
    proof=result.proof;accounts.value=result.accounts||[];selected.value=result.selected||[];pcName.value=result.pcName||pcName.value;step.value='select'
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'サインインできませんでした。'}
  finally{password.value='';code.value='';busy.value=false}
}
async function approve(){
  busy.value=true;error.value=''
  try{
    const result=await api('/approve',{proof,accountIds:selected.value,pcName:pcName.value})
    const target=loopback(result.redirectUri)
    proof='';finished.value=true;finishedText.value='接続しました。ダウンローダーに戻ります…';window.location.assign(target)
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'接続できませんでした。'}finally{busy.value=false}
}
async function cancel(){
  busy.value=true;error.value=''
  try{
    const result=await api('/cancel',{proof})
    proof='';finished.value=true;finishedText.value='接続をキャンセルしました。ダウンローダーの画面に戻ってください。'
    try{window.location.assign(loopback(result.redirectUri))}catch{/* the downloader also times out on its own */}
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'キャンセルできませんでした。'}finally{busy.value=false}
}
function leave(){password.value='';code.value='';finished.value=true;finishedText.value='何も変更されていません。ダウンローダーの画面に戻ってください。'}
</script>

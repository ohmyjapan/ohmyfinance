<template>
  <div class="mx-auto max-w-4xl space-y-5 p-4 text-gray-800 dark:text-gray-100 md:p-6">
    <header class="flex flex-wrap items-start justify-between gap-3"><div><h1 class="text-xl font-semibold">銀行の手順を覚える</h1><p class="mt-2 text-sm text-gray-500">いつもの照会操作から、取得手順を作成します。</p></div><button class="btn btn-secondary" :disabled="busy" @click="run(refresh)">更新</button></header>
    <p class="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm leading-relaxed dark:border-purple-900 dark:bg-purple-950/30">① この画面で記録を依頼 → ② 接続したPCでログインし、照会・CSV出力・残高・ログアウトを実演 → ③ OhMyCodeで手順を作成 → ④ 別の期間で確認します。パスワードや認証コードはPCに残し、開発側には送りません。電子証明書や追加認証は本人が操作します。</p>
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <p v-if="message" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">{{ message }}</p>
    <form class="card grid gap-4 p-4 sm:grid-cols-2" @submit.prevent="run(create)">
      <label class="text-sm">銀行口座<select v-model="form.bankAccountId" class="input mt-1 w-full" required><option value="">選んでください</option><option v-for="a in data.accounts" :key="a.id" :value="a.id">{{ a.name }}</option></select></label>
      <label class="text-sm">接続したPC<select v-model="form.installationId" class="input mt-1 w-full" required><option value="">選んでください</option><option v-for="p in eligiblePcs" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
      <label class="text-sm">銀行サイトのオリジン<input v-model="form.entryOrigin" class="input mt-1 w-full" type="url" placeholder="https://www.example-bank.co.jp" required><small class="text-gray-500">パス・クエリを含めず入力します。</small></label>
      <label class="text-sm">明細の列・金額の割り当て<select v-model="form.templateId" class="input mt-1 w-full" required><option value="">保存済みテンプレート</option><option v-for="t in data.templates" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
      <label class="text-sm">実演の開始日<input v-model="form.period.from" class="input mt-1 w-full" type="date" required></label><label class="text-sm">実演の終了日<input v-model="form.period.to" class="input mt-1 w-full" type="date" required></label>
      <label class="flex items-start gap-2 text-sm sm:col-span-2"><input v-model="form.companyAccountConfirmed" type="checkbox" required>この口座を現在選択している会社で利用し、照会・明細出力だけを記録することを確認しました。</label>
      <button class="btn btn-primary sm:col-span-2" :disabled="busy">この銀行の手順を覚える</button>
    </form>
    <article v-for="s in data.sessions" :key="s.id" class="card space-y-3 p-4">
      <div class="flex flex-wrap justify-between gap-2"><strong>{{ accountName(s.bankAccountId) }}</strong><span class="text-sm">{{ learningStatusText(s.state) }}</span></div>
      <p class="break-all text-sm text-gray-500">{{ s.entryOrigin }} · 実演 {{ s.demonstrationPeriod.from }}〜{{ s.demonstrationPeriod.to }}</p>
      <p v-if="s.candidateHash" class="break-all text-xs text-gray-500">取得手順の版 {{ s.candidateHash.slice(0,16) }} · {{ s.model }}</p>
      <p v-if="s.state==='awaiting_pc'" class="text-sm">ダウンローダーの設定画面 →「銀行の照会手順を覚える」→ 更新 →「このPCで記録を開始」を押してください。</p>
      <form v-if="s.state==='candidate'" class="flex flex-wrap items-end gap-3" @submit.prevent="run(()=>requestReplay(s))"><label class="text-sm">確認の開始日<input v-model="replay.from" type="date" class="input block" required></label><label class="text-sm">確認の終了日<input v-model="replay.to" type="date" class="input block" required></label><button class="btn btn-secondary" :disabled="busy">この期間でPCの確認を準備</button><p v-if="s.replayPeriod" class="w-full text-sm">PCの設定画面で「このPCで確認」を押してください。</p></form>
      <div v-if="s.state==='verified'" class="space-y-3 text-sm"><p class="text-emerald-700 dark:text-emerald-300">別の期間でCSV・口座・残高・ログアウトを確認しました。</p><label class="flex items-start gap-2"><input v-model="attendedConfirmed" type="checkbox">この手順で明細を取得するたびに、接続したPCのChromeで本人がサインインすることを確認しました。</label><button class="btn btn-secondary" :disabled="busy||!attendedConfirmed" @click="run(()=>enable(s))">この手順を手動の明細取得に使う</button><p class="text-gray-500">毎日の自動取得と1時間ごとの残高確認は、現在の接続設定を使います。</p></div>
      <div v-if="s.selected" class="space-y-3 text-sm"><p>手動の明細取得に選択中です。取得を依頼すると、このPCのChromeが開きます。</p><form class="flex flex-wrap items-end gap-3" @submit.prevent="run(()=>collect(s))"><label>開始日<input v-model="collection.from" class="input block" type="date" required></label><label>終了日<input v-model="collection.to" class="input block" type="date" required></label><button class="btn btn-primary" :disabled="busy">この期間の明細を取得</button></form><NuxtLink to="/intake/payments" class="inline-block text-primary-main dark:text-primary-light">取得の結果と取り込まれた明細を確認 →</NuxtLink><button class="block text-gray-500" :disabled="busy" @click="run(()=>disable(s))">記録した手順の選択を解除</button></div>
      <p v-if="s.missing?.length" class="text-sm">{{ missingText(s.missing) }}</p>
      <button v-if="s.state==='failed'&&s.lastCode==='worker_failed'" class="btn btn-secondary" :disabled="busy" @click="run(()=>retryDevelopment(s))">開発だけを再試行（銀行にはログインしません）</button>
      <button v-if="s.cancellable" class="text-sm text-gray-500" :disabled="busy" @click="run(()=>cancel(s))">この依頼を取り消す</button>
    </article>
  </div>
</template>
<script setup lang="ts">
import {computed,onMounted,onUnmounted,reactive,ref} from 'vue'
import {useUserStore} from '~/stores/user'
import {learningStatusText} from '~/shared/finance-bank-learning.mjs'
const user=useUserStore(),busy=ref(false),error=ref(''),message=ref(''),attendedConfirmed=ref(false),data=reactive<any>({accounts:[],templates:[],pcs:[],sessions:[]})
const form=reactive({bankAccountId:'',installationId:'',entryOrigin:'',templateId:'',period:{from:'',to:''},companyAccountConfirmed:false}),replay=reactive({from:'',to:''})
const collection=reactive({from:'',to:''})
const eligiblePcs=computed(()=>data.pcs.filter((p:any)=>p.bankAccountIds.includes(form.bankAccountId)))
const api=(route:string,body?:any)=>$fetch<any>('/api/finance-bank-learning/'+route,{method:body?'POST':'GET',headers:user.authHeader,...(body?{body}:{})})
async function refresh(){Object.assign(data,await api('sessions'))}
async function run(fn:()=>Promise<any>){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn()}catch(e:any){error.value=e?.data?.data?.message||e?.data?.statusMessage||'読み込めませんでした。会社とPCの接続を確認してください。'}finally{busy.value=false}}
async function create(){await api('sessions',form);await refresh()}
async function requestReplay(s:any){await api(s.id+'/replay',{period:{...replay}});await refresh()}
async function cancel(s:any){await api(s.id+'/cancel',{});await refresh()}
async function retryDevelopment(s:any){await api(s.id+'/retry-development',{});await refresh()}
async function enable(s:any){await api(s.id+'/enable',{expectedSelectionHash:s.activeSelectionHash,attendedConfirmed:attendedConfirmed.value});attendedConfirmed.value=false;await refresh()}
async function disable(s:any){await api(s.id+'/disable',{expectedSelectionHash:s.activeSelectionHash});await refresh()}
async function collect(s:any){const result=await api(s.id+'/collect',{period:{...collection},expectedSelectionHash:s.activeSelectionHash});message.value=result.message;await refresh()}
const accountName=(id:string)=>data.accounts.find((a:any)=>a.id===id)?.name||'銀行口座'
const missingText=(missing:string[])=>{
  if(missing.includes('runtime_extension_needed'))return 'この画面の操作に対応するダウンローダーの更新が必要です。'
  if(missing.includes('worker_unavailable'))return '取得手順を作成できませんでした。「開発だけを再試行」を押してください。銀行での実演をやり直す必要はありません。'
  const labels:Record<string,string>={inquiry:'照会画面への移動',account:'対象口座',from:'開始日',to:'終了日',export:'CSVの出力',balance:'残高の表示',logout:'ログアウト'}
  const steps=missing.map(v=>labels[v]).filter(Boolean)
  return (steps.length?'確認できなかった操作: '+steps.join('・')+'。':'記録を完了できませんでした。')+'依頼を取り消してから、照会手順をもう一度実演してください。'
}
let timer:ReturnType<typeof setInterval>
onMounted(()=>{void run(refresh);timer=setInterval(()=>{if(!busy.value)void refresh().catch(()=>{})},10000)})
onUnmounted(()=>clearInterval(timer))
</script>
<style scoped>
.input { @apply min-w-0 max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white; }
:global(.dark) .input[type="date"] { color-scheme: dark; }
</style>

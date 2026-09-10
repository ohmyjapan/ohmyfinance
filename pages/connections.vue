<template>
  <div class="connections">
    <header><div><h1>カード連携</h1><p>Amexの明細を取り込み、内容を確認してから取引に登録します。</p></div><button :disabled="busy" @click="run(refresh)">更新</button></header>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <div class="account-grid">
      <section v-for="account in accounts" :key="account._id">
        <h2>{{ account.name }}</h2><p>カード {{ account.cardIdentifiers.map((v: string) => v.slice(-4)).join(' / ') }}</p>
        <p>{{ states[account.jobState] || account.jobState }} · {{ account.lastMessage || '未取得' }}</p>
        <small>最終取得: {{ formatDate(account.lastSuccessAt) }}<br>認証メール: {{ account.otpRecipient }} → {{ account.otpMailbox }}</small>
        <button :disabled="busy || ['queued','running','verification_required'].includes(account.jobState)" @click="run(() => sync(account._id))">確定明細を取得</button>
        <details><summary>CSVを手動で取り込む</summary><form @submit.prevent="run(() => upload(account._id))">
          <label>明細期間の開始<input v-model="manual.start" type="date" required></label><label>明細期間の終了<input v-model="manual.end" type="date" required></label>
          <label>Amex CSV<input type="file" accept=".csv" required @change="selectFile"></label><button :disabled="busy">確認画面へ</button>
        </form></details>
      </section>
    </div>
    <details class="panel"><summary>Amex口座を追加</summary><form @submit.prevent="run(addAccount)">
      <label>表示名<input v-model="newAccount.name" required maxlength="100"></label>
      <label>CSVの会員番号（5桁、カンマ区切り）<input v-model="cardsText" required placeholder="12345, 23456"></label>
      <label>メインカードの会員番号（5桁）<input v-model="newAccount.primaryCard" required pattern="[0-9]{5}"></label>
      <label>Amexの認証メール送信先<input v-model="newAccount.otpRecipient" type="email" required></label>
      <label>Gmail APIで読むメールボックス<input v-model="newAccount.otpMailbox" type="email" required></label><button :disabled="busy">口座を追加</button>
    </form></details>
    <details class="panel"><summary>取得用PCを接続</summary><p>ログイン情報は取得用PCの設定画面で保存します。ここでは接続トークンを発行します。</p>
      <form @submit.prevent="run(pair)"><label>PCの名前<input v-model="collectorName" required></label>
        <label v-for="account in accounts" :key="account._id" class="inline"><input v-model="pairAccounts" type="checkbox" :value="account._id">{{ account.name }}</label><button :disabled="busy || !pairAccounts.length">接続トークンを発行</button>
      </form><div v-if="pairToken" class="notice"><p>取得用PCの設定画面に貼り付けてください。この画面を閉じると再表示できません。</p><input :value="pairToken" readonly aria-label="接続トークン"><button @click="copyToken">コピー</button><button @click="pairToken = ''">非表示</button></div>
      <p v-for="device in collectors" :key="device._id">{{ device.name }} · {{ device.revokedAt ? '接続解除済み' : formatDate(device.lastSeenAt) }} <button v-if="!device.revokedAt" :disabled="busy" @click="run(() => revoke(device._id))">接続解除</button></p>
    </details>
    <section><h2>取得履歴</h2><p v-if="!imports.length">まだ明細がありません。</p>
      <button v-for="batch in imports" :key="batch._id" :data-import-id="batch._id" class="history" :disabled="busy" @click="run(() => review(batch._id))">{{ accountName(batch.accountId) }} · {{ batch.period.start }} ～ {{ batch.period.end }} · {{ batch.rowCount }}件</button>
    </section>
    <section v-if="selected" ref="reviewPanel"><header><div><h2>{{ selected.account.name }} — 内容確認</h2><p>{{ selected.period.start }} ～ {{ selected.period.end }} · {{ selected.rowCount }}件</p></div><button :disabled="busy" @click="run(downloadOriginal)">元のCSV</button></header>
      <p>口座振替はカードへの返済として保管します。返金などのマイナス明細は確認待ちです。同じ取引の可能性がある行は、既存取引への紐付け・別の支出として登録・保留から選んでください。</p>
      <div class="review-list"><article v-for="row in selected.rows" :key="row.line" :class="{ muted: ['posted','duplicate'].includes(row.state) }">
        <div><strong>{{ row.description }}</strong><p>{{ row.purchaseDate }} · 処理日 {{ row.processingDate }} · カード {{ row.cardIdentifier.slice(-4) }}</p><small v-if="row.foreignAmount">外貨 {{ row.foreignAmount }} · レート {{ row.exchangeRate }}</small></div>
        <div><strong>{{ yen(row.amount) }}</strong><p>{{ states[row.state] || row.state }}{{ row.skipped ? '（保留済み）' : '' }}</p></div>
        <label v-if="row.kind === 'expense' && !['posted','duplicate','in_progress'].includes(row.state)">この行の処理
          <select v-model="choices[row.line]"><option value="">選択してください</option><option value="skip">保留する</option><option value="import">{{ ['legacy_review','overlap_review','correction_review'].includes(row.state) ? '別の支出と確認して登録する' : '取引に登録する' }}</option><option v-for="existing in row.existing" :key="existing.id" :value="'link:' + existing.id">既存取引に紐付け: {{ existing.description }} · {{ yen(existing.amount) }}</option></select>
        </label>
      </article></div><button :disabled="busy || !decisionCount" @click="run(commit)">選択した {{ decisionCount }} 件を処理</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useUserStore } from '~/stores/user'
definePageMeta({ middleware: 'auth' })
const user = useUserStore()
const accounts = ref<any[]>([]), collectors = ref<any[]>([]), imports = ref<any[]>([]), selected = ref<any>(null)
const busy = ref(false), message = ref(''), pairToken = ref(''), collectorName = ref('Ryzen 7'), pairAccounts = ref<string[]>([])
const newAccount = reactive({ name: '', primaryCard: '', otpRecipient: '', otpMailbox: '' }), cardsText = ref('')
const manual = reactive({ start: '', end: '' }), file = ref<File | null>(null), choices = reactive<Record<number,string>>({}), reviewPanel = ref<HTMLElement | null>(null)
const states: Record<string,string> = { idle:'未取得', queued:'PCの応答待ち', running:'取得中', verification_required:'Chromeで認証が必要', complete:'取得完了・内容確認待ち', failed:'取得できませんでした', new:'新しい支出', repayment:'カードへの返済', credit_review:'返金など・確認待ち', posted:'登録済み', duplicate:'登録済みの明細', legacy_review:'既存取引と一致する可能性', correction_review:'処理日や外貨情報が変わった明細の可能性', overlap_review:'他の明細期間と重複する可能性', in_progress:'先の取り込み処理を再開してください' }
const decisionCount = computed(() => Object.values(choices).filter(Boolean).length)
const api = (url: string, options: any = {}): Promise<any> => $fetch('/api/finance/' + url, { ...options, headers: { ...user.authHeader, ...options.headers } })
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY' }).format(amount)
const formatDate = (date: string) => date ? new Date(date).toLocaleString('ja-JP') : '未接続'
const accountName = (id: string) => accounts.value.find(a => a._id === id)?.name || 'Amex'
async function run(action: () => Promise<any>) { if (busy.value) return; busy.value = true; message.value = ''; try { await action() } catch (error: any) { message.value = error.data?.statusMessage || error.message || '処理できませんでした' } finally { busy.value = false } }
async function refresh() { const [a,c,i] = await Promise.all([api('accounts'),api('collectors'),api('imports')]); accounts.value = a.accounts; collectors.value = c.collectors; imports.value = i.imports }
async function addAccount() { await api('accounts', { method:'POST', body: { ...newAccount, cardIdentifiers:cardsText.value.split(',').map(v=>v.trim()).filter(Boolean) } }); await refresh(); message.value = '口座を追加しました' }
async function sync(id: string) { await api(`accounts/${id}/sync`, { method:'POST' }); await refresh() }
async function pair() { const result = await api('collectors', { method:'POST', body: { name:collectorName.value, accountIds:pairAccounts.value } }); pairToken.value = result.token; await refresh() }
async function revoke(id: string) { await api(`collectors/${id}`, { method:'DELETE' }); await refresh() }
async function copyToken() { await navigator.clipboard.writeText(pairToken.value); message.value = 'コピーしました' }
function selectFile(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0] || null }
async function upload(id: string) { if (!file.value) throw Error('CSVを選択してください'); const result = await api(`accounts/${id}/imports`, { method:'POST', query: { ...manual, kind:'statement' }, body:file.value, headers: { 'Content-Type':'text/csv' } }); await refresh(); await review(result.id) }
async function review(id: string) { selected.value = await api(`imports/${id}`); for (const key of Object.keys(choices)) delete choices[Number(key)]; for (const row of selected.value.rows) if (row.kind === 'expense' && !['posted','duplicate','in_progress'].includes(row.state)) choices[row.line] = row.skipped ? 'skip' : row.state === 'new' ? 'import' : ''; await nextTick(); reviewPanel.value?.scrollIntoView({ behavior:'smooth' }) }
async function commit() {
  const decisions = Object.entries(choices).filter(([,value]) => value).map(([line,value]) => ({ line:Number(line), action:value.startsWith('link:') ? 'link' : value, transactionId:value.startsWith('link:') ? value.slice(5) : undefined, confirmNew:value === 'import' }))
  try { const result = await api(`imports/${selected.value.id}/commit`, { method:'POST', body: { decisions } }); message.value = `${result.posted}件登録・${result.linked}件紐付け・${result.skipped}件保留または登録済み` }
  finally { await review(selected.value.id); await refresh() }
}
async function downloadOriginal() { const blob = await api(`imports/${selected.value.id}/file`, { responseType:'blob' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `amex-${selected.value.period.start}-${selected.value.period.end}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000) }
let poll: ReturnType<typeof setInterval>
onMounted(() => { run(refresh); poll = setInterval(() => { if (!busy.value) refresh().catch(() => {}) },10000) })
onUnmounted(() => clearInterval(poll))
</script>

<style scoped>
.connections{max-width:1200px;margin:auto;padding:16px;color:#e2e8f0;background:#0f172a;min-height:100vh;border-radius:16px}.connections h1{font-size:26px;font-weight:700}.connections h2{font-size:19px;font-weight:600}.connections p,.connections small{color:#aabbd1;line-height:1.6;margin:8px 0}.connections header>button{flex-shrink:0;white-space:nowrap}.connections header{display:flex;gap:16px;align-items:start;justify-content:space-between}.connections section,.panel{background:#182338;border:1px solid #344158;border-radius:12px;padding:18px;margin:16px 0;min-width:0}.connections button,.connections input,.connections select{border:1px solid #52647f;border-radius:8px;background:#101b2d;color:#edf2fa;padding:11px;max-width:100%}.connections button{background:#254f9b;cursor:pointer;margin-top:10px}.connections button:disabled{opacity:.5;cursor:default}.connections label{display:block;margin:12px 0}.connections label input,.connections select{display:block;width:100%;margin-top:6px}.connections .inline{display:flex;gap:10px}.connections .inline input{width:auto}.connections details{margin-top:16px}.connections summary{cursor:pointer;min-height:30px}.notice{padding:14px;background:#26374e;border-radius:8px;overflow-wrap:anywhere}.history{display:block;width:100%;text-align:left}.review-list article{border-top:1px solid #344158;padding:18px 0;display:grid;gap:12px;overflow-wrap:anywhere}.review-list strong{display:block}.muted{opacity:.6}.account-grid{display:grid;gap:16px}.account-grid section{margin-bottom:0}@media(min-width:760px){.account-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.review-list article{grid-template-columns:2fr 1fr 2fr}}
</style>

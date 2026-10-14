<template>
  <div class="connections">
    <header><div><h1>カード連携</h1><p>カードの明細を取り込み、内容を確認してから取引に登録します。</p></div><button class="btn btn-secondary" :disabled="busy" @click="run(refresh)">更新</button></header>
    <NuxtLink class="mapping-link" to="/mapping">顧客・区分のマッピングを確認 →</NuxtLink>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <section class="card downloader-guide" aria-labelledby="downloader-guide-title">
      <h2 id="downloader-guide-title">ダウンローダーはPCごとに1つ</h2>
      <p><strong>カードごとのインストールは不要です。</strong>1つのダウンローダーで、対応する複数のカード口座を扱えます。カード会社へのログイン・認証は、各社のアカウントごとに行います。</p>
      <ol class="setup-steps">
        <li><strong>PCをOMFに接続</strong><p>ダウンローダーで「Connect to OMF」を押し、開いたOMFの画面でサインインします。</p></li>
        <li><strong>取得する口座をまとめて選択</strong><p>このPCで扱う口座を選び、カード会社のログイン情報をPC側の設定画面で保存します。認証コードを求められたらChromeで入力します。</p></li>
        <li><strong>明細をOMFで確認</strong><p>PCが利用できる間に明細を取得し、OMFへ送信します。内容や分類の確認は、これまでどおりOMFのブラウザ画面で行います。</p></li>
      </ol>
      <p>現在、自動取得はAmexとAplusに対応しています。Aplusは確定明細と未請求明細を取得し、明細ファイルの取り込みも引き続き利用できます。一般向けインストーラーは準備中です。</p>
      <details><summary>取得のタイミングと保存される情報</summary>
        <p>自動取得には、ダウンローダーが起動し、Windowsにサインイン済みでロックされていないPCが必要です。電源が切れている間やスリープ中は取得せず、利用可能になってから再開します。カード会社が追加認証を求めた場合は、操作が必要になることがあります。</p>
        <p>保存したカード会社のID・パスワードは、そのPCで暗号化して保管します。取得した明細はOMFに送信し、マッピングや取引の確認に使います。</p>
      </details>
    </section>
    <div class="account-grid">
      <section class="card" v-for="account in accounts" :key="account._id">
        <h2>{{ account.name }}</h2><p>カード {{ account.cardIdentifiers.map((v: string) => v.slice(-4)).join(' / ') }}</p>
        <p>{{ states[account.jobState] || account.jobState }} · {{ account.lastMessage || '未取得' }}</p>
        <small>最終取得: {{ formatDate(account.lastSuccessAt) }}<template v-if="account.provider !== 'aplus'"><br>認証メール: {{ account.otpRecipient }} → {{ account.otpMailbox }}</template></small>
        <button class="btn btn-primary" :disabled="busy || ['queued','running','verification_required'].includes(account.jobState)" @click="run(() => sync(account._id))">確定明細を取得</button>
        <details v-if="account.provider === 'aplus' && fiscalInputs[account._id]"><summary>自動取得の会計期間：{{ account.fiscalPeriod ? account.fiscalPeriod.start + ' ～ ' + account.fiscalPeriod.end : '未設定' }}</summary>
          <form @submit.prevent="run(() => saveFiscalPeriod(account._id))">
            <label>開始日<input v-model="fiscalInputs[account._id].start" type="date" required></label>
            <label>終了日<input v-model="fiscalInputs[account._id].end" type="date" required></label>
            <p>この口座の自動取得に使用します。期間外の購入も保存し、個別確認に回します。変更は新しい取り込みに適用されます。</p>
            <p v-if="!account.fiscalPeriod">未設定の間は、会計期間外かどうかの確認は行いません。</p>
            <button class="btn btn-secondary" :disabled="busy">会計期間を保存</button>
          </form>
        </details>
        <details v-if="account.provider === 'aplus' && autoSyncInputs[account._id]"><summary>自動取得：{{ account.autoSync?.enabled ? '毎日 ' + account.autoSync.hour + ':00 以降（PCが利用可能なとき）' : 'オフ' }}</summary>
          <form @submit.prevent="run(() => saveAutoSync(account._id))">
            <label class="check"><input v-model="autoSyncInputs[account._id].enabled" type="checkbox"> 毎日自動で取得する</label>
            <label>取得を始める時刻<select v-model.number="autoSyncInputs[account._id].hour"><option v-for="h in 24" :key="h - 1" :value="h - 1">{{ h - 1 }}:00</option></select></label>
            <p>PCが起動・サインイン済み・ロック解除のときに取得します。取得できなかった日は、次に利用可能になったとき1回だけ取得します。認証コードは、PC側でSMS読み取り元を設定していればダウンローダーが入力します。未設定の間はChromeで入力してください。</p>
            <button class="btn btn-secondary" :disabled="busy">自動取得を保存</button>
          </form>
        </details>
        <details><summary>明細ファイルを取り込む</summary><form @submit.prevent="run(() => upload(account))">
          <label>明細の状態<select v-model="manual.kind"><option value="statement">確定明細</option><option value="pending">未請求・確定待ち</option></select></label>
          <p v-if="manual.kind === 'pending'">購入件数に含めてマッピングできます。確定明細との照合までは帳簿に登録しません。Amexは確定前の利用を含まないCSV、Aplusは取得ツールの元ページ付きJSONを選択します。</p>
          <template v-if="account.provider === 'aplus' && manual.kind === 'statement'">
            <label>確定した請求月<input v-model="manual.statementMonth" type="month" required></label>
            <label>Aplusに表示されたお支払金額<input v-model="manual.statementTotal" type="number" step="1" required></label>
            <label>別途返金済みの金額（通知がある場合）<input v-model="manual.refundTotal" type="number" min="0" step="1"></label>
            <label>対象の会計期間・開始（任意）<input v-model="manual.fiscalStart" type="date"></label>
            <label>対象の会計期間・終了（任意）<input v-model="manual.fiscalEnd" type="date" :required="!!manual.fiscalStart"></label>
            <p>元の利用日が会計期間外の明細は個別確認に回します。</p>
          </template>
          <template v-else-if="account.provider !== 'aplus'"><label>明細期間の開始<input v-model="manual.start" type="date" required></label><label>明細期間の終了<input v-model="manual.end" type="date" required></label></template>
          <label>{{ account.provider === 'aplus' && manual.kind === 'pending' ? 'Aplus 未請求明細 JSON' : 'カード会社のCSV' }}<input type="file" :accept="account.provider === 'aplus' && manual.kind === 'pending' ? '.json' : '.csv'" required @change="selectFile"></label><button class="btn btn-primary" :disabled="busy">確認画面へ</button>
        </form></details>
      </section>
    </div>
    <details class="card panel"><summary>カード口座を追加</summary><form @submit.prevent="run(addAccount)">
      <label>カード会社<select v-model="newAccount.provider"><option value="amex">Amex</option><option value="aplus">Aplus</option></select></label>
      <label>表示名<input v-model="newAccount.name" required maxlength="100"></label>
      <label>{{ newAccount.provider === 'aplus' ? 'CSVのカード番号下4桁（カンマ区切り）' : 'CSVの会員番号（5桁、カンマ区切り）' }}<input v-model="cardsText" required :placeholder="newAccount.provider === 'aplus' ? '1234, 5678' : '12345, 23456'"></label>
      <label>{{ newAccount.provider === 'aplus' ? 'メインカードの下4桁' : 'メインカードの会員番号（5桁）' }}<input v-model="newAccount.primaryCard" required :pattern="newAccount.provider === 'aplus' ? '[0-9]{4}' : '[0-9]{5}'"></label>
      <label v-if="newAccount.provider === 'amex'">Amexの認証メール送信先<input v-model="newAccount.otpRecipient" type="email" required></label>
      <label v-if="newAccount.provider === 'amex'">Gmail APIで読むメールボックス<input v-model="newAccount.otpMailbox" type="email" required></label><button class="btn btn-primary" :disabled="busy">口座を追加</button>
    </form></details>
    <details class="card panel"><summary>取得用PCを接続</summary>
      <p>このPCのダウンローダーで「Connect to OMF」を押し、OMFにサインインして取得する口座を選びます。複数の口座を選んでも、ダウンローダーを追加でインストールする必要はありません。</p>
      <p>接続後は、PC側の設定画面でカード会社のログイン情報を保存します。明細取得時に届く認証コードはChromeで入力します（メールボックス連携は別途）。</p>
      <p v-if="!collectors.length">接続済みのPCはありません。</p>
      <p v-for="device in collectors" :key="device._id">{{ device.name }} · {{ device.revokedAt ? '接続解除済み' : (device.lastSeenAt ? '最終接続 ' + formatDate(device.lastSeenAt) : '接続済み・取得待ち') }} <button class="btn btn-secondary" v-if="!device.revokedAt" :disabled="busy" @click="run(() => revoke(device._id))">接続解除</button></p>
    </details>
    <section class="card"><h2>取得履歴</h2><p v-if="!imports.length">まだ明細がありません。</p>
      <button class="btn btn-secondary history" v-for="batch in imports" :key="batch._id" :data-import-id="batch._id" :disabled="busy" @click="run(() => review(batch._id))">{{ accountName(batch.accountId) }} · {{ batch.period.start }} ～ {{ batch.period.end }} · {{ batch.rowCount }}件</button>
    </section>
    <section class="card" v-if="selected" ref="reviewPanel"><header><div><h2>{{ selected.account.name }} — 内容確認</h2><p>{{ selected.period.start }} ～ {{ selected.period.end }} · {{ selected.rowCount }}件</p></div><button class="btn btn-secondary" :disabled="busy" @click="run(downloadOriginal)">元の明細ファイル</button></header>
      <p>口座振替はカードへの返済として保管します。返金などのマイナス明細は確認待ちです。同じ取引の可能性がある行は、既存取引への紐付け・別の支出として登録・保留から選んでください。</p>
      <p v-if="(selected.requiresDraft || selected.mappingPreview)" class="notice">この明細の顧客・区分は分類案の確認中です。<NuxtLink :to="{ path: '/mapping', query: { import: selected.id } }">マッピングを確認 →</NuxtLink></p>
      <div class="review-list"><article v-for="row in selected.rows" :key="row.line" :class="{ muted: ['posted','duplicate'].includes(row.state) }">
        <div><strong>{{ row.description }}</strong><p>{{ row.purchaseDate || '利用日未記載' }} · 処理日 {{ row.processingDate || '未記載' }} · カード {{ row.cardIdentifier?.slice(-4) || '未記載' }}</p><p v-if="row.sourceReviewReason">{{ row.sourceReviewReason }}</p><small v-if="row.provider === 'aplus'">請求月 {{ row.statementMonth }} · お支払金額 {{ row.paymentAmount === null ? '未記載' : yen(row.paymentAmount) }} · {{ row.statementDetails }}</small><small v-if="row.foreignAmount">外貨 {{ row.foreignAmount }} · レート {{ row.exchangeRate }}</small></div>
        <div><strong>{{ yen(row.amount) }}</strong><p>{{ states[row.state] || row.state }}{{ row.skipped ? '（保留済み）' : '' }}</p></div>
        <label v-if="!(selected.requiresDraft || selected.mappingPreview) && row.kind === 'expense' && !['posted','duplicate','in_progress'].includes(row.state)">この行の処理
          <select v-model="choices[row.line]"><option value="">選択してください</option><option value="skip">保留する</option><option value="import">{{ ['legacy_review','overlap_review','correction_review'].includes(row.state) ? '別の支出と確認して登録する' : '取引に登録する' }}</option><option v-for="existing in row.existing" :key="existing.id" :value="'link:' + existing.id">既存取引に紐付け: {{ existing.description }} · {{ yen(existing.amount) }}</option></select>
        </label>
      </article></div><button class="btn btn-primary" v-if="!(selected.requiresDraft || selected.mappingPreview)" :disabled="busy || !decisionCount" @click="run(commit)">選択した {{ decisionCount }} 件を処理</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useUserStore } from '~/stores/user'
definePageMeta({ middleware: 'auth' })
const user = useUserStore()
const accounts = ref<any[]>([]), collectors = ref<any[]>([]), imports = ref<any[]>([]), selected = ref<any>(null)
const fiscalInputs = reactive<Record<string, { start: string; end: string }>>({})
const autoSyncInputs = reactive<Record<string, { enabled: boolean; hour: number }>>({})
const busy = ref(false), message = ref('')
const newAccount = reactive({ provider: 'amex', name: '', primaryCard: '', otpRecipient: '', otpMailbox: '' }), cardsText = ref('')
const manual = reactive({ kind: 'statement', start: '', end: '', statementMonth: '', statementTotal: '', refundTotal: '', fiscalStart: '', fiscalEnd: '' }), file = ref<File | null>(null), choices = reactive<Record<number,string>>({}), reviewPanel = ref<HTMLElement | null>(null)
const states: Record<string,string> = { idle:'未取得', queued:'PCの応答待ち', running:'取得中', verification_required:'Chromeで認証が必要', complete:'取得完了・内容確認待ち', failed:'取得できませんでした', statement_review:'明細・個別確認待ち', new:'新しい支出', repayment:'カードへの返済', credit_review:'返金など・確認待ち', posted:'登録済み', duplicate:'登録済みの明細', legacy_review:'既存取引と一致する可能性', correction_review:'処理日や外貨情報が変わった明細の可能性', overlap_review:'他の明細期間と重複する可能性', in_progress:'先の取り込み処理を再開してください' }
const decisionCount = computed(() => Object.values(choices).filter(Boolean).length)
const api = (url: string, options: any = {}): Promise<any> => $fetch('/api/finance/' + url, { ...options, headers: { ...user.authHeader, ...options.headers } })
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY' }).format(amount)
const formatDate = (date: string) => date ? new Date(date).toLocaleString('ja-JP') : '未接続'
const accountName = (id: string) => accounts.value.find(a => a._id === id)?.name || 'カード'
async function run(action: () => Promise<any>) { if (busy.value) return; busy.value = true; message.value = ''; try { await action() } catch (error: any) { message.value = error.data?.data?.message || error.data?.statusMessage || error.message || '処理できませんでした' } finally { busy.value = false } }
async function refresh() { const [a,c,i] = await Promise.all([api('accounts'),api('collectors'),api('imports')]); accounts.value = a.accounts; collectors.value = c.collectors; imports.value = i.imports; for (const account of a.accounts) if (account.provider === 'aplus' && !fiscalInputs[account._id]) fiscalInputs[account._id] = { start: account.fiscalPeriod?.start || '', end: account.fiscalPeriod?.end || '' }; for (const account of a.accounts) if (account.provider === 'aplus' && !autoSyncInputs[account._id]) autoSyncInputs[account._id] = { enabled: !!account.autoSync?.enabled, hour: account.autoSync?.hour ?? 9 } }
async function saveFiscalPeriod(id: string) { await api(`accounts/${id}/fiscal-period`, { method: 'PUT', body: fiscalInputs[id] }); await refresh(); message.value = '自動取得の会計期間を保存しました' }
async function saveAutoSync(id: string) { await api(`accounts/${id}/auto-sync`, { method: 'PUT', body: autoSyncInputs[id] }); await refresh(); message.value = '自動取得の設定を保存しました' }
async function addAccount() { await api('accounts', { method:'POST', body: { ...newAccount, cardIdentifiers:cardsText.value.split(',').map(v=>v.trim()).filter(Boolean) } }); await refresh(); message.value = '口座を追加しました' }
async function sync(id: string) { await api(`accounts/${id}/sync`, { method:'POST' }); await refresh() }
// Connections are created by the downloader's own Connect flow (POST /api/finance/collectors stays available for compatibility).
async function revoke(id: string) { await api(`collectors/${id}`, { method:'DELETE' }); await refresh() }
function selectFile(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0] || null }
async function upload(account: any) { const id = account._id; const metadata = manual.kind === 'pending' ? { kind: 'pending', ...(account.provider !== 'aplus' ? { start: manual.start, end: manual.end } : {}) } : account.provider === 'aplus' ? { kind: 'statement', statementMonth: manual.statementMonth, statementTotal: manual.statementTotal, refundTotal: manual.refundTotal, ...(manual.fiscalStart || manual.fiscalEnd ? { fiscalStart: manual.fiscalStart, fiscalEnd: manual.fiscalEnd } : {}) } : { kind: 'statement', start: manual.start, end: manual.end }; if (!file.value) throw Error('CSVを選択してください'); const result = await api(`accounts/${id}/imports`, { method:'POST', query: metadata, body:file.value, headers: { 'Content-Type':account.provider === 'aplus' && manual.kind === 'pending' ? 'application/json' : 'text/csv' } }); await refresh(); await review(result.id) }
async function review(id: string) { selected.value = await api(`imports/${id}`); for (const key of Object.keys(choices)) delete choices[Number(key)]; for (const row of selected.value.rows) if (row.kind === 'expense' && !['posted','duplicate','in_progress'].includes(row.state)) choices[row.line] = row.skipped ? 'skip' : row.state === 'new' ? 'import' : ''; await nextTick(); reviewPanel.value?.scrollIntoView({ behavior:'smooth' }) }
async function commit() {
  const decisions = Object.entries(choices).filter(([,value]) => value).map(([line,value]) => ({ line:Number(line), action:value.startsWith('link:') ? 'link' : value, transactionId:value.startsWith('link:') ? value.slice(5) : undefined, confirmNew:value === 'import' }))
  try { const result = await api(`imports/${selected.value.id}/commit`, { method:'POST', body: { decisions } }); message.value = `${result.posted}件登録・${result.linked}件紐付け・${result.skipped}件保留または登録済み` }
  finally { await review(selected.value.id); await refresh() }
}
async function downloadOriginal() { const blob = await api(`imports/${selected.value.id}/file`, { responseType:'blob' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${selected.value.account.provider || 'amex'}-${selected.value.period.start}-${selected.value.period.end}.${selected.value.sourceFormat || 'csv'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000) }
let poll: ReturnType<typeof setInterval>
onMounted(() => { run(refresh); poll = setInterval(() => { if (!busy.value) refresh().catch(() => {}) },10000) })
onUnmounted(() => clearInterval(poll))
</script>

<style scoped>
.connections { @apply text-sm text-gray-800 dark:text-gray-100; }
.connections h1 { @apply text-xl font-semibold text-gray-800 dark:text-gray-100; }
.connections h2 { @apply text-sm font-semibold text-gray-900 dark:text-gray-100; }
.connections p, .connections small { @apply my-2 leading-relaxed text-gray-500 dark:text-gray-400; }
.connections small { @apply block break-words text-xs; }
.connections header { @apply flex flex-col items-start justify-between gap-4 sm:flex-row; }
.connections header > button { @apply shrink-0 whitespace-nowrap; }
.connections section, .panel { @apply my-6 min-w-0 p-4 sm:p-6; }
.connections button { @apply max-w-full text-sm; }
.connections button:disabled { @apply cursor-default opacity-50; }
.connections form > button, .connections .account-grid section > button { @apply mt-3; }
.connections input, .connections select { @apply max-w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white; }
.connections label { @apply my-3 block; }
.connections label input, .connections select { @apply mt-1 block w-full; }
.connections label.check input { @apply mr-2 mt-0 inline-block w-auto; }
.connections .inline { @apply flex gap-3; }
.connections .inline input { @apply w-auto; }
.connections details { @apply mt-4; }
.connections summary { @apply min-h-10 cursor-pointer py-2 font-medium text-gray-700 dark:text-gray-200; }
.connections summary:focus-visible { @apply rounded-lg outline-none ring-2 ring-primary-main ring-offset-2; }
.mapping-link { @apply my-4 inline-flex text-sm font-medium text-primary-main hover:underline dark:text-primary-light; }
.notice { @apply break-words rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-white/10 dark:bg-white/5; }
.notice a { @apply text-primary-main underline dark:text-primary-light; }
.history { @apply mt-3 block w-full text-left; }
.review-list article { @apply grid gap-3 break-words border-t border-gray-200 py-5 dark:border-white/10; }
.review-list strong { @apply block; }
.muted { @apply opacity-60; }
.account-grid { @apply grid gap-4 md:grid-cols-2; }
.account-grid section { @apply m-0; }
.setup-steps { @apply my-5 grid list-decimal gap-4 pl-6; }
.setup-steps li { @apply pl-1; }
.setup-steps li::marker { @apply font-semibold text-primary-main dark:text-primary-light; }
.setup-steps p { @apply mb-0; }
.downloader-guide strong { @apply font-medium text-gray-800 dark:text-gray-100; }
@media (min-width: 768px) { .review-list article { grid-template-columns: 2fr 1fr 2fr; } }
</style>

<template>
  <main class="mapping">
    <header class="page-header">
      <div><NuxtLink to="/connections" class="back">← カード連携</NuxtLink><h1>明細マッピング</h1><p>カード明細と記録シートを照合した、顧客・区分の分類案です。</p></div>
      <button :disabled="loading" @click="refresh">更新</button>
    </header>
    <p class="preview-note">確認用プレビュー · この画面では帳簿に登録されません。会社経費の顧客IDは空欄です。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="loading" role="status">明細を読み込んでいます…</p>
    <template v-else-if="!error">
      <div v-if="!imports.length" class="empty"><h2>まだ明細がありません</h2><p>カード連携で明細を取得すると、ここで分類を確認できます。</p><NuxtLink to="/connections">カード連携を開く →</NuxtLink></div>
      <template v-else>
        <div class="toolbar">
          <label>表示する明細<select v-model="batchChoice" @change="loadSelection"><option value="latest">全口座 · 口座ごとの最新取得</option><option v-for="batch in imports" :key="batch._id" :value="batch._id">{{ accountName(batch.accountId) }} · {{ batch.period.start }} ～ {{ batch.period.end }}</option></select></label>
          <label>明細を検索<input v-model="search" type="search" placeholder="店名・顧客ID・区分" autocomplete="off"></label>
        </div>
        <div class="periods"><span v-for="batch in batches" :key="batch.id">{{ batch.account.name }} · {{ batch.period.start }} ～ {{ batch.period.end }}</span></div>
        <p v-if="batches.some(batch => !batch.preparedAt)" class="warning">分類案が未作成の明細が含まれています。顧客が未確認の行は「未確認」と表示します。</p>
        <nav class="filters" aria-label="分類で絞り込み">
          <button v-for="item in filters" :key="item.value" :class="{ active: filter === item.value, attention: item.value === 'review' && item.count }" :aria-pressed="filter === item.value" :data-filter="item.value" @click="filter = item.value"><span>{{ item.label }}</span><strong>{{ item.count }}<small>件</small></strong></button>
        </nav>
        <div class="list-heading"><h2>{{ filterLabel }}</h2><span role="status">{{ filteredRows.length }} / {{ rows.length }} 件</span></div>
        <p class="date-note">日付は元シートに合わせて処理日を表示し、利用日も残しています。「区分」は分類案の名称です。</p>
        <p v-if="!filteredRows.length" class="empty">条件に一致する明細はありません。検索・絞り込みを変更してください。</p>
        <div v-else class="mapping-list">
          <div class="columns" aria-hidden="true"><span>処理日・利用先</span><span>金額</span><span>顧客</span><span>区分案</span></div>
          <article v-for="row in filteredRows" :key="row.importId + ':' + row.key" :data-line="row.line" :data-status="row.status" :class="{ unresolved: needsReview(row) }">
            <div class="row-main">
              <div class="merchant"><time>{{ row.processingDate }}</time><strong>{{ row.description }}</strong><small>利用日 {{ row.purchaseDate }} · {{ row.accountName }}<br>利用カード {{ row.cardLast4 }} · CSV {{ row.line }}行</small></div>
              <strong class="amount">{{ yen(row.amount) }}</strong>
              <div class="client"><span class="field-label">顧客</span><template v-if="row.purpose === 'customer'"><strong>{{ row.clientCode || 'ID未確認' }}</strong><small>{{ row.clientName }}</small></template><template v-else-if="row.purpose === 'company'"><strong>—</strong><small>会社経費 · 顧客IDは空欄</small></template><template v-else-if="row.purpose === 'unresolved'"><strong class="pending">未確認</strong><small>用途・顧客を確認</small></template><template v-else><strong>—</strong><small>{{ row.purpose === 'repayment' ? 'カードへの返済' : '返金など' }}</small></template></div>
              <div class="category"><span class="field-label">区分案</span><strong :class="{ pending: needsReview(row) }">{{ row.category || (row.status === 'repayment' ? '支出対象外' : '未設定') }}</strong><span class="badge" :class="row.status">{{ statuses[row.status] }}</span></div>
            </div>
            <details v-if="row.source || row.reason" class="evidence"><summary>照合根拠<span v-if="row.source && row.source.rows.length > 1" class="repeat">同額の繰り返し · {{ row.source.rows.length }}件の候補</span></summary>
              <p v-if="row.reason">{{ row.reason }}</p>
              <template v-if="row.source"><p><strong>元シート:</strong> {{ row.source.sheet }} · 行 {{ row.source.rows.join(', ') }}</p><p><strong>元の値:</strong> 顧客「{{ row.source.client || '空欄' }}」 · 区分「{{ row.source.category || '空欄' }}」 · カード「{{ row.source.card || '空欄' }}」</p><p v-if="row.source.rows.length > 1" class="warning">同じ条件の行が複数あります。グループの件数と分類は一致していますが、個々の行の対応は未確定です。各明細は別の取引として保持しています。</p></template>
            </details>
          </article>
        </div>
      </template>
    </template>
  </main>
</template>

<script setup lang="ts">
import { useUserStore } from '~/stores/user'
import type { MappingRow } from '~/shared/finance-mapping.mjs'
definePageMeta({ middleware: 'auth' })
useHead({ title: '明細マッピング | OhMyFinance' })
interface Batch { id: string; account: { id: string; name: string }; period: { start: string; end: string }; preparedAt: string | null; rows: MappingRow[] }
const user = useUserStore(), route = useRoute()
const imports = ref<any[]>([]), accounts = ref<any[]>([]), batches = ref<Batch[]>([])
const loading = ref(true), error = ref(''), search = ref(''), filter = ref('all')
const batchChoice = ref(typeof route.query.import === 'string' ? route.query.import : 'latest')
const api = (url: string): Promise<any> => $fetch('/api/finance/' + url, { headers: user.authHeader })
const accountName = (id: string) => accounts.value.find(account => account._id === id)?.name || 'Amex'
const yen = (amount: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
const statuses: Record<string, string> = { proposed: '分類案あり', needs_client: '顧客・用途を確認', needs_category: '区分を確認', repayment: '返済・支出対象外', credit_review: '返金など・確認待ち' }
const needsReview = (row: MappingRow) => ['needs_client', 'needs_category', 'credit_review'].includes(row.status)
const rows = computed(() => batches.value.flatMap(batch => batch.rows.map(row => ({ ...row, importId: batch.id, accountName: batch.account.name }))).sort((a, b) => b.processingDate.localeCompare(a.processingDate) || a.importId.localeCompare(b.importId) || a.line - b.line))
const matchesFilter = (row: MappingRow, value: string) => value === 'all' || (value === 'review' ? needsReview(row) : row.purpose === value)
const filters = computed(() => [{ value: 'all', label: 'すべて' }, { value: 'customer', label: '顧客購入' }, { value: 'company', label: '会社経費' }, { value: 'review', label: '要確認' }, { value: 'repayment', label: 'カード返済' }].map(item => ({ ...item, count: rows.value.filter(row => matchesFilter(row, item.value)).length })))
const filterLabel = computed(() => filters.value.find(item => item.value === filter.value)?.label || 'すべて')
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
const filteredRows = computed(() => rows.value.filter(row => matchesFilter(row, filter.value) && normalize([row.description, row.clientCode, row.clientName, row.category, row.accountName, row.cardLast4].join(' ')).includes(normalize(search.value))))
async function fetchSelection() {
  const seen = new Set<string>()
  const selected = batchChoice.value === 'latest' ? imports.value.filter(batch => { if (seen.has(batch.accountId)) return false; seen.add(batch.accountId); return true }) : imports.value.filter(batch => batch._id === batchChoice.value)
  if (batchChoice.value !== 'latest' && !selected.length) throw Error('この明細は表示できません。カード連携から開き直してください。')
  batches.value = await Promise.all(selected.map(batch => api(`imports/${batch._id}/mapping`)))
}
async function run(action: () => Promise<void>) { loading.value = true; error.value = ''; batches.value = []; try { await action() } catch (e: any) { error.value = e.data?.statusMessage || e.message || '明細を読み込めませんでした。更新して再試行してください。' } finally { loading.value = false } }
async function refresh() { await run(async () => { const [a, i] = await Promise.all([api('accounts'), api('imports')]); accounts.value = a.accounts; imports.value = i.imports; await fetchSelection() }) }
async function loadSelection() { await run(fetchSelection) }
onMounted(refresh)
</script>

<style scoped>
.mapping{max-width:1280px;margin:auto;padding:16px;border-radius:16px;background:#0f172a;color:#e2e8f0;min-height:100vh}.mapping h1{font-size:27px;font-weight:700;margin:10px 0}.mapping h2{font-size:19px;font-weight:600}.mapping p{line-height:1.65;color:#b2bfd3}.page-header{display:flex;justify-content:space-between;gap:16px;align-items:start}.page-header>button{flex-shrink:0;white-space:nowrap}.mapping a{color:#9dc4ff}.mapping button,.mapping input,.mapping select{border:1px solid #4c5d79;border-radius:9px;padding:11px;background:#17243a;color:#edf2fa;font:inherit;min-height:44px;max-width:100%}.mapping button{cursor:pointer}.mapping button:disabled{opacity:.5}.mapping button:focus-visible,.mapping input:focus-visible,.mapping select:focus-visible,.mapping summary:focus-visible,.mapping a:focus-visible{outline:2px solid #93c5fd;outline-offset:3px}.preview-note{padding:14px 16px;background:#192c46;border:1px solid #36567e;border-radius:10px;margin:20px 0}.mapping .error,.mapping .warning{color:#f9d99b}.error{padding:16px;border:1px solid #9c6139;border-radius:10px}.toolbar{display:grid;gap:14px}.toolbar label{font-size:13px;color:#b8c7dc;min-width:0}.toolbar input,.toolbar select{display:block;width:100%;margin-top:7px}.periods{display:flex;flex-wrap:wrap;gap:8px 20px;color:#a2b4cd;font-size:12px;margin:14px 0}.filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:22px 0}.filters button{text-align:left;border-color:#34465f}.filters button.active{border-color:#93bbff;background:#234575;box-shadow:inset 0 0 0 1px #93bbff}.filters button.attention:not(.active){border-color:#927341}.filters span{font-size:13px;color:#c7d5e8}.filters strong{display:block;font-size:25px;font-variant-numeric:tabular-nums;margin-top:5px}.filters small{font-size:12px;font-weight:400;margin-left:6px}.list-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.list-heading>span,.date-note{font-size:13px;color:#acbdd4}.date-note{margin:10px 0 18px}.mapping-list{border:1px solid #33445d;border-radius:12px;overflow:hidden;background:#172238}.mapping-list article{padding:18px;border-top:1px solid #33445d;overflow-wrap:anywhere}.mapping-list article:first-of-type{border-top:0}.mapping-list article.unresolved{border-left:3px solid #d7a952;padding-left:15px}.row-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 14px}.merchant{grid-column:1/-1;min-width:0}.merchant strong{display:block;font-size:16px;line-height:1.6;margin:4px 0}.merchant time{font-size:13px;color:#bacce3}.mapping-list small{display:block;font-size:12px;color:#a8bcd5;line-height:1.65}.amount{grid-column:1/-1;font-size:22px;font-variant-numeric:tabular-nums}.client strong,.category strong{display:block;margin:4px 0;font-size:15px}.field-label{font-size:12px;color:#a8bcd5}.pending{color:#f9d99b}.badge{display:inline-block;font-size:11px;padding:4px 7px;border-radius:5px;background:#293a54;color:#c8d7eb;margin-top:7px}.badge.proposed{background:#173f40;color:#a2ded0}.badge.needs_category,.badge.needs_client,.badge.credit_review{background:#4b3b26;color:#f9d99b}.evidence{margin-top:16px;font-size:12px;border-top:1px dashed #394c66;padding-top:10px}.evidence summary{cursor:pointer;min-height:32px;line-height:1.7;color:#a8caff}.evidence p{margin:8px 0}.repeat{display:block;color:#cbbbf2;margin-top:4px}.empty{padding:28px 18px;background:#172238;border-radius:12px;margin-top:24px}.columns{display:none}@media(min-width:640px){.filters{grid-template-columns:repeat(5,minmax(0,1fr))}.toolbar{grid-template-columns:3fr 2fr}.mapping{padding:24px}.row-main{grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)}.merchant,.amount{grid-column:auto}.amount{font-size:18px;text-align:right;padding-right:16px}.columns{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:14px;padding:13px 18px;background:#1f2e46;color:#afc2dc;font-size:12px}.columns span:nth-child(2){text-align:right;padding-right:16px}.field-label{display:none}.repeat{display:inline;margin-left:12px}.evidence summary{min-height:24px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>

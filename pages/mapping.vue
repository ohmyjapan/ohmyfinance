<template>
  <div class="mapping">
    <header class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">明細マッピング</h1>
        <p class="text-gray-600 dark:text-gray-400">カード明細の顧客・区分と、元シートの照合結果を確認します。</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <NuxtLink to="/connections" class="btn btn-secondary text-sm shadow-sm">
          <CreditCard class="mr-2 h-4 w-4" aria-hidden="true" />カード連携
        </NuxtLink>
        <button class="btn btn-secondary text-sm shadow-sm disabled:opacity-50" :disabled="loading" @click="refresh">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" aria-hidden="true" />更新
        </button>
      </div>
    </header>

    <p v-if="error" role="alert" class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{{ error }}</p>
    <div v-if="loading" role="status" class="card flex items-center justify-center gap-3 p-12 text-sm text-gray-500 dark:text-gray-400">
      <Loader2 class="h-6 w-6 animate-spin text-primary-main" aria-hidden="true" />明細を読み込んでいます…
    </div>
    <template v-else-if="!error">
      <div v-if="!imports.length" class="card py-16 text-center">
        <FileText class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" aria-hidden="true" />
        <h2 class="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">まだ明細がありません</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">カード連携で明細を取得すると、ここで分類を確認できます。</p>
        <NuxtLink to="/connections" class="btn btn-primary mt-6 text-sm">カード連携を開く</NuxtLink>
      </div>
      <template v-else>
        <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
          <StatCard title="顧客購入" :value="String(countFor('customer'))" icon="Users" color="primary" />
          <StatCard title="会社経費" :value="String(countFor('company'))" icon="CreditCard" color="blue" />
          <StatCard title="要確認" :value="String(countFor('review'))" icon="FileText" color="amber" />
          <StatCard title="カード返済" :value="String(countFor('repayment'))" icon="DollarSign" color="green" />
        </div>

        <section class="card mb-6" aria-label="明細の検索と絞り込み">
          <div class="grid gap-4 p-4 md:grid-cols-2">
            <label class="block min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
              表示する明細
              <select v-model="batchChoice" class="mt-2 block w-full rounded-xl border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm font-normal text-gray-900 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100" @change="loadSelection">
                <option value="latest">全口座 · 口座ごとの最新取得</option>
                <option v-for="batch in imports" :key="batch._id" :value="batch._id">{{ accountName(batch.accountId) }} · {{ batch.period.start }} ～ {{ batch.period.end }}</option>
              </select>
            </label>
            <label class="block min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
              明細を検索
              <div class="relative mt-2">
                <Search class="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-gray-400" aria-hidden="true" />
                <input v-model="search" type="search" class="block w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100" placeholder="店名・顧客ID・区分" autocomplete="off">
              </div>
            </label>
          </div>
          <nav class="flex flex-wrap gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10" aria-label="分類で絞り込み">
            <button v-for="item in filters" :key="item.value" class="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-main" :class="filter === item.value ? 'bg-primary-main/10 text-primary-main dark:bg-primary-main/20 dark:text-primary-light' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100'" :aria-pressed="filter === item.value" :data-filter="item.value" @click="filter = item.value">
              {{ item.label }}<strong class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ item.count }}<span class="sr-only">件</span></strong>
            </button>
          </nav>
        </section>

        <p v-if="batches.some(batch => !batch.preparedAt)" class="mb-4 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />分類案が未作成の明細を含みます。顧客が未確認の行は「未確認」と表示します。
        </p>

        <section class="card overflow-hidden" aria-labelledby="mapping-list-title">
          <header class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-white/10 sm:px-6">
            <div class="flex flex-wrap items-center gap-3">
              <h2 id="mapping-list-title" class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ filterLabel }}</h2>
              <span class="badge-status bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300">取引の下書き</span>
            </div>
            <span role="status" class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ filteredRows.length }} / {{ rows.length }} 件</span>
          </header>
          <p v-if="!filteredRows.length" class="px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">条件に一致する明細はありません。検索・絞り込みを変更してください。</p>
          <div v-else class="mapping-list">
            <div class="hidden grid-cols-[7rem_minmax(0,2fr)_7rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 bg-gray-50 px-6 py-3 text-xs font-medium tracking-wider text-gray-500 dark:bg-white/5 dark:text-gray-400 xl:grid" aria-hidden="true">
              <span>処理日</span><span>利用先・カード</span><span class="text-right">金額</span><span>顧客</span><span>区分案</span>
            </div>
            <div class="divide-y divide-gray-200 dark:divide-white/10">
              <article v-for="row in filteredRows" :key="row.importId + ':' + row.key" :data-line="row.line" :data-status="row.status" class="table-row-hover px-4 py-4 sm:px-6">
                <div class="grid grid-cols-2 items-start gap-x-4 gap-y-3 xl:grid-cols-[7rem_minmax(0,2fr)_7rem_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-6">
                  <div class="col-span-2 text-sm xl:col-span-1">
                    <time class="font-medium text-gray-900 dark:text-gray-100">{{ row.processingDate }}</time>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">利用 {{ row.purchaseDate }}</p>
                  </div>
                  <div class="col-span-2 min-w-0 xl:col-span-1">
                    <p class="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.description }}</p>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.accountName }} · {{ row.cardLast4 }}</p>
                    <details v-if="row.source || row.reason" class="evidence mt-2 text-xs text-gray-500 dark:text-gray-400">
                      <summary class="cursor-pointer py-1 text-primary-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-main dark:text-primary-light">照合根拠<span v-if="row.source && row.source.rows.length > 1" class="repeat ml-2 text-gray-500 dark:text-gray-400">同額 {{ row.source.rows.length }}件</span></summary>
                      <div class="mt-2 space-y-2 rounded-lg bg-gray-50 p-3 leading-relaxed dark:bg-white/5">
                        <p v-if="row.reason">{{ row.reason }}</p>
                        <p>元CSV {{ row.line }}行 · 利用カード {{ row.cardLast4 }}</p>
                        <template v-if="row.source">
                          <p>元シート {{ row.source.sheet }} · 行 {{ row.source.rows.join(', ') }}</p>
                          <p>元の顧客「{{ row.source.client || '空欄' }}」 · 区分「{{ row.source.category || '空欄' }}」 · カード「{{ row.source.card || '空欄' }}」</p>
                          <p v-if="row.source.rows.length > 1" class="text-amber-700 dark:text-amber-400">件数と分類は一致していますが、個々の行の対応は未確定です。各明細は別の取引として保持しています。</p>
                        </template>
                      </div>
                    </details>
                  </div>
                  <div class="col-span-2 text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100 xl:col-span-1 xl:text-right">{{ yen(row.amount) }}</div>
                  <div class="min-w-0 text-sm">
                    <span class="mb-1 block text-xs text-gray-500 dark:text-gray-400 xl:hidden">顧客</span>
                    <template v-if="row.purpose === 'customer'"><p class="font-medium text-gray-900 dark:text-gray-100">{{ row.clientCode || 'ID未確認' }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.clientName }}</p></template>
                    <template v-else-if="row.purpose === 'company'"><p class="text-gray-400">—</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">会社経費</p></template>
                    <template v-else-if="row.purpose === 'unresolved'"><p class="text-amber-700 dark:text-amber-400">未確認</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">用途・顧客を確認</p></template>
                    <template v-else><p class="text-gray-400">—</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.purpose === 'repayment' ? 'カードへの返済' : '返金など' }}</p></template>
                  </div>
                  <div class="min-w-0 text-sm">
                    <span class="mb-1 block text-xs text-gray-500 dark:text-gray-400 xl:hidden">区分案</span>
                    <p :class="needsReview(row) ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'">{{ row.category || (row.status === 'repayment' ? '支出対象外' : '未設定') }}</p>
                    <span class="badge-status mt-2" :class="needsReview(row) ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400' : row.status === 'proposed' ? 'bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'">{{ row.draft ? (row.draft.approved ? '内容確認済み' : '下書き保存済み') : statuses[row.status] }}</span>
                    <NuxtLink :to="`/mapping-draft/${row.importId}/${row.line}`" class="mt-3 block py-2 text-sm font-medium text-primary-main dark:text-primary-light">{{ ['repayment', 'credit_review'].includes(row.purpose) ? '明細を確認' : '取引の下書きを開く →' }}</NuxtLink>
                  </div>
                </div>
              </article>
            </div>
          </div>
          <footer class="space-y-2 border-t border-gray-200 bg-gray-50 px-4 py-4 text-xs leading-relaxed text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 sm:px-6">
            <p>各明細から取引の全項目を確認・修正できます。下書きの保存では帳簿に登録されません。会社経費の顧客IDは空欄です。</p>
            <p v-for="batch in batches" :key="batch.id">{{ batch.account.name }} · {{ batch.period.start }} ～ {{ batch.period.end }}</p>
          </footer>
        </section>
      </template>
    </template>
  </div>
</template>


<script setup lang="ts">
import { CreditCard, RefreshCw, Search, FileText, Loader2, Info } from 'lucide-vue-next'
import StatCard from '~/components/dashboard/StatCard.vue'
import { useUserStore } from '~/stores/user'
import type { MappingRow as SourceMappingRow } from '~/shared/finance-mapping.mjs'
type MappingRow = SourceMappingRow & { draft?: { revision: number; approved: boolean } }
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
const needsReview = (row: MappingRow) => row.draft ? !row.draft.approved : ['needs_client', 'needs_category', 'credit_review'].includes(row.status)
const rows = computed(() => batches.value.flatMap(batch => batch.rows.map(row => ({ ...row, importId: batch.id, accountName: batch.account.name }))).sort((a, b) => b.processingDate.localeCompare(a.processingDate) || a.importId.localeCompare(b.importId) || a.line - b.line))
const matchesFilter = (row: MappingRow, value: string) => value === 'all' || (value === 'review' ? needsReview(row) : row.purpose === value)
const filters = computed(() => [{ value: 'all', label: 'すべて' }, { value: 'customer', label: '顧客購入' }, { value: 'company', label: '会社経費' }, { value: 'review', label: '要確認' }, { value: 'repayment', label: 'カード返済' }].map(item => ({ ...item, count: rows.value.filter(row => matchesFilter(row, item.value)).length })))
const countFor = (value: string) => filters.value.find(item => item.value === value)?.count || 0
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

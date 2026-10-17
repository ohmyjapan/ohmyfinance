<template>
  <div class="intake">
    <header class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800 dark:text-gray-100">購入受付</h1>
        <p class="text-gray-600 dark:text-gray-400">お客様の注文・購入依頼を手入力またはExcel・CSVから受け付け、あとから修正し、原本を添付します。</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn-primary text-sm shadow-sm" data-new-record @click="showForm = !showForm"><Plus class="mr-2 h-4 w-4" aria-hidden="true" />新しい受付</button>
        <button type="button" class="btn btn-secondary text-sm shadow-sm" data-open-importer @click="showImporter = !showImporter"><FileSpreadsheet class="mr-2 h-4 w-4" aria-hidden="true" />Excel・CSVから取込</button>
        <button type="button" class="btn btn-secondary text-sm shadow-sm disabled:opacity-50" :disabled="loading" @click="load"><RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" aria-hidden="true" />更新</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{{ error }}</p>
    <p v-if="message" role="status" class="mb-6 text-sm text-green-700 dark:text-green-400" data-message>{{ message }}</p>

    <section v-if="showForm" class="card mb-6 p-4 sm:p-6" aria-label="新しい受付" data-new-form>
      <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">新しい受付</h2>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">すべて任意です。分かっている項目だけ入力してください。受付元は未入力なら「{{ DEFAULT_SERVICE }}」、通貨は「{{ DEFAULT_CURRENCY }}」になります。</p>
      <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label v-for="field in FIELDS" :key="field[0]" class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ field[1] }}
          <select v-if="field[0] === 'purchaseState'" v-model="form.purchaseState" class="intake-control mt-1" :data-field="field[0]"><option v-for="s in STATES" :key="s" :value="s">{{ STATE_NAMES[s] }}</option></select>
          <input v-else v-model="form[field[0]]" type="text" class="intake-control mt-1" :data-field="field[0]" autocomplete="off">
        </label>
      </div>
      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary text-sm" :disabled="busy" data-save-record @click="create">受付を保存</button>
        <button type="button" class="btn btn-secondary text-sm" @click="showForm = false">閉じる</button>
      </div>
    </section>

    <IntakeImporter v-if="showImporter" @imported="imported" @close="showImporter = false" />

    <div v-if="loading && !records.length" role="status" class="card flex items-center justify-center gap-3 p-12 text-sm text-gray-500 dark:text-gray-400">
      <Loader2 class="h-6 w-6 animate-spin text-primary-main" aria-hidden="true" />受付を読み込んでいます…
    </div>
    <template v-else>
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        <StatCard title="受付中" :value="String(counts.requested || 0)" icon="ShoppingCart" color="primary" />
        <StatCard title="購入済み" :value="String(counts.purchased || 0)" icon="CreditCard" color="green" />
        <StatCard title="IDの対応を確認" :value="String(counts.review || 0)" icon="FileText" color="amber" />
        <StatCard title="アーカイブ" :value="String(counts.archived || 0)" icon="Package" color="blue" />
      </div>

      <section class="card mb-6" aria-label="受付の検索と絞り込み">
        <div class="p-4">
          <label class="block min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">受付を検索
            <div class="relative mt-2">
              <Search class="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-gray-400" aria-hidden="true" />
              <input v-model="search" type="search" class="intake-control pl-10" placeholder="注文ID・内容・購入先・お客様" autocomplete="off">
            </div>
          </label>
        </div>
        <nav class="flex flex-wrap gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10" aria-label="状態で絞り込み">
          <button v-for="item in filters" :key="item.value" type="button" class="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-main" :class="filter === item.value ? 'bg-primary-main/10 text-primary-main dark:bg-primary-main/20 dark:text-primary-light' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100'" :aria-pressed="filter === item.value" :data-filter="item.value" @click="setFilter(item.value)">
            {{ item.label }}<strong class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-white/10 dark:text-gray-300">{{ item.count }}<span class="sr-only">件</span></strong>
          </button>
        </nav>
      </section>

      <section class="card overflow-hidden" aria-labelledby="intake-list-title">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-white/10 sm:px-6">
          <h2 id="intake-list-title" class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ filterLabel }}</h2>
          <span role="status" class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ filteredRows.length }} / {{ records.length }} 件</span>
        </header>
        <p v-if="!filteredRows.length" class="px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">{{ records.length ? '条件に一致する受付はありません。' : '受付はまだありません。「新しい受付」または「Excel・CSVから取込」から始めてください。' }}</p>
        <div v-else class="intake-list divide-y divide-gray-200 dark:divide-white/10">
          <article v-for="row in filteredRows" :key="row.id" :data-record="row.id" :data-state="row.values.purchaseState" class="table-row-hover px-4 py-4 sm:px-6">
            <div class="grid grid-cols-2 items-start gap-x-4 gap-y-2 xl:grid-cols-[9rem_minmax(0,2fr)_8rem_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-6">
              <div class="min-w-0">
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ row.values.purchaseDate || '日付未定' }}</p>
                <span class="badge-status mt-1 inline-block" :class="stateClass(row.values.purchaseState)">{{ STATE_NAMES[row.values.purchaseState] || row.values.purchaseState }}</span>
              </div>
              <div class="col-span-2 min-w-0 xl:col-span-1">
                <NuxtLink :to="'/intake/' + row.id" class="break-words text-sm font-medium text-primary-main dark:text-primary-light">{{ row.values.description || row.values.orderId || '（内容未入力）' }}</NuxtLink>
                <p class="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{{ row.values.merchant || '購入先未定' }}<span v-if="row.identityReview" class="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-identity-review>IDの対応を確認</span></p>
              </div>
              <p class="text-right text-sm tabular-nums text-gray-900 dark:text-gray-100">{{ amountOf(row.values) }}</p>
              <p class="break-words text-xs text-gray-700 dark:text-gray-300">{{ row.values.customer || '—' }}</p>
              <p class="break-words text-xs text-gray-700 dark:text-gray-300">{{ row.values.service }}<span v-if="row.values.account"> · {{ row.values.account }}</span><br><span class="text-gray-500 dark:text-gray-400">{{ row.values.orderId ? '注文 ' + row.values.orderId : '' }}{{ row.values.itemId ? ' / ' + row.values.itemId : '' }}</span></p>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { FileSpreadsheet, Plus, RefreshCw, Search, Loader2 } from 'lucide-vue-next'
import StatCard from '~/components/dashboard/StatCard.vue'
import IntakeImporter from '~/components/intake/IntakeImporter.vue'
import { FIELDS, STATES, STATE_NAMES, DEFAULT_SERVICE, DEFAULT_CURRENCY } from '~/shared/finance-intake.mjs'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
definePageMeta({ middleware: 'auth' })
useHead({ title: '購入受付 | OhMyFinance' })
const user = useUserStore(), api = '/api/finance-intake/'
const assistant = useAssistantStore()
watch(() => assistant.intakeSavedSequence, load)
const records = ref<any[]>([]), counts = ref<Record<string, number>>({}), loading = ref(true), busy = ref(false), error = ref(''), message = ref(''), filter = ref('all'), search = ref(''), showForm = ref(false), showImporter = ref(false)
const blank = (): Record<string, string> => Object.fromEntries(FIELDS.map(f => [f[0], f[0] === 'service' ? DEFAULT_SERVICE : f[0] === 'currency' ? DEFAULT_CURRENCY : f[0] === 'purchaseState' ? 'requested' : '']))
const form = reactive(blank())
function errorMessage(e: any) { return e.data?.data?.message || e.data?.statusMessage || e.message || '処理に失敗しました。再試行してください。' }
async function load() {
  loading.value = true; error.value = ''
  try { const data: any = await $fetch(api + 'records', { headers: user.authHeader, query: filter.value === 'archived' ? { archived: '1' } : {} }); records.value = data.records; counts.value = data.counts }
  catch (e: any) { error.value = errorMessage(e) } finally { loading.value = false }
}
function setFilter(value: string) { const reload = (value === 'archived') !== (filter.value === 'archived'); filter.value = value; if (reload) load() }
const filters = computed(() => [
  { value: 'all', label: 'すべて', count: (counts.value.total || 0) - (counts.value.archived || 0) },
  ...STATES.map(s => ({ value: s, label: STATE_NAMES[s], count: counts.value[s] || 0 })),
  { value: 'review', label: 'IDの対応を確認', count: counts.value.review || 0 },
  { value: 'archived', label: 'アーカイブ', count: counts.value.archived || 0 }
])
const filterLabel = computed(() => filters.value.find(f => f.value === filter.value)?.label || 'すべて')
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return records.value.filter(r => filter.value === 'all' || filter.value === 'archived' ? true : filter.value === 'review' ? r.identityReview : r.values.purchaseState === filter.value)
    .filter(r => !q || [...Object.values(r.values as Record<string, string>), ...Object.values((r.extra || {}) as Record<string, string>)].join(' ').toLowerCase().includes(q))
})
const amountOf = (v: Record<string, string>) => v.amount === '' ? '—' : v.currency === 'JPY' && Number.isFinite(Number(v.amount)) ? '¥' + Number(v.amount).toLocaleString('ja-JP') : v.amount + ' ' + v.currency
const stateClass = (s: string) => s === 'purchased' ? 'bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300' : s === 'cancelled' || s === 'refunded' ? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' : 'bg-primary-main/10 text-primary-main dark:text-primary-light'
async function create() {
  busy.value = true; error.value = ''; message.value = ''
  try { const saved: any = await $fetch(api + 'records', { method: 'POST', headers: user.authHeader, body: { values: { ...form } } }); Object.assign(form, blank()); showForm.value = false; message.value = '受付を保存しました。' + (saved.identityReview ? '同じ注文IDの受付が他にあります。' : ''); await load() }
  catch (e: any) { error.value = errorMessage(e) } finally { busy.value = false }
}
async function imported(batch: any) { message.value = `取込が完了しました：新規 ${batch.counts.new}・更新 ${batch.counts.update}・変更なし ${batch.counts.unchanged}`; await load() }
onMounted(load)
</script>

<style>
.intake .intake-control {
  @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60;
}
.intake input[type="search"].intake-control {
  padding-left: 2.5rem;
}
</style>

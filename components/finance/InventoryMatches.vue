<template>
  <section v-if="rows.length || error" class="card mb-6 p-4 sm:p-6" data-inventory-review aria-label="在庫からの商品候補">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">在庫からの商品候補 <span class="ml-1 text-gray-400">{{ rows.length }}件</span></h2><p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">在庫・公開価格・日付を照合した購入内容の候補です。</p></div>
      <button type="button" class="btn btn-secondary text-xs" :disabled="busy || loading" @click="load">再読込</button>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="message" role="status" class="mt-3 text-sm text-green-700 dark:text-green-400">{{ message }}</p>
    <div v-if="!draft" class="mt-4 divide-y divide-gray-200 dark:divide-white/10">
      <NuxtLink v-for="row in rows" :key="row.importId + ':' + row.line" :to="'/mapping-draft/' + row.importId + '/' + row.line" class="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between" data-inventory-link>
        <div class="min-w-0"><p class="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.packet.productName }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.source.purchaseDate }} · {{ row.source.accountName }} · {{ row.source.cardLast4 }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ strength(row) }} · {{ status(row.decision?.status) }}</p></div>
        <span class="shrink-0 text-sm font-medium text-primary-main">{{ yen(row.source.amount) }} · 候補を確認 →</span>
      </NuxtLink>
    </div>
    <article v-for="row in draft ? rows : []" :key="row.importId + ':' + row.line" class="mt-5 space-y-4" data-inventory-detail>
      <div><span class="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">{{ strength(row) }}</span><h3 class="mt-3 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{{ row.packet.productName }}</h3><p class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{{ row.packet.explanation }}</p></div>
      <div class="grid gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-white/5 sm:grid-cols-2" data-inventory-calculation>
        <div><p class="text-xs text-gray-500 dark:text-gray-400">カード利用額</p><p class="mt-1 font-semibold tabular-nums">{{ yen(row.source.amount) }}</p></div>
        <div><p class="text-xs text-gray-500 dark:text-gray-400">候補の金額内訳（推定）</p><p class="mt-1 tabular-nums">商品 {{ amount(row.packet.itemTotal) }} ＋ 送料 {{ amount(row.packet.shipping) }}</p><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ row.calculation.total === null ? '送料等が未確認のため、注文総額は照合できません。' : '推定合計 ' + yen(row.calculation.total) + ' · カードとの差額 ' + yen(row.calculation.difference) }}</p></div>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="item in row.packet.items" :key="item.stockId + ':' + item.sheetRow" class="min-w-0 rounded-xl border border-gray-200 p-3 text-xs dark:border-white/10">
          <p class="break-words font-medium text-gray-800 dark:text-gray-200">{{ item.productName }} · {{ item.option }}</p><p class="mt-1 break-words text-gray-500 dark:text-gray-400">品番 {{ item.productCode || '記載なし' }} · 在庫 {{ item.stockId }}</p><p class="mt-1 text-gray-500 dark:text-gray-400">在庫登録 {{ item.assignedDate || '不明' }} · シート {{ item.sheetRow }}行</p><p class="mt-1 text-gray-500 dark:text-gray-400">シートの価格欄 {{ item.knownPrice || '空欄' }}（支払額・税区分は別途確認）</p>
        </li>
      </ul>
      <details class="rounded-xl border border-gray-200 p-3 text-xs dark:border-white/10" data-inventory-sources>
        <summary class="cursor-pointer font-medium text-primary-main">出典を確認 · {{ row.packet.sources.length }}件</summary>
        <ul class="mt-3 space-y-3"><li v-for="source in row.packet.sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer" class="break-words font-medium text-primary-main">{{ source.label }} ↗</a><p v-if="source.note" class="mt-1 break-words leading-relaxed text-gray-500 dark:text-gray-400">{{ source.note }}</p></li></ul>
        <p class="mt-3 text-gray-400">調査日時 {{ date(row.packet.capturedAt) }}</p>
      </details>
      <div v-if="row.learning?.length" class="rounded-xl bg-blue-50 p-4 text-xs dark:bg-blue-500/10" data-inventory-learning>
        <p class="font-medium text-gray-800 dark:text-gray-200">同じ品番の過去の判断</p><p class="mt-1 text-gray-500 dark:text-gray-400">同じ口座・利用先・顧客用途に限って参照します。今回の購入は個別に確認してください。</p>
        <p v-for="learned in row.learning" :key="learned.importId + ':' + learned.line" class="mt-2 break-words"><NuxtLink :to="'/mapping-draft/' + learned.importId + '/' + learned.line" class="text-primary-main">{{ status(learned.status) }} · {{ learned.productName || '候補を除外' }}</NuxtLink> · {{ learned.note }}</p>
      </div>
      <div v-if="row.decision" class="rounded-xl border border-gray-200 p-4 text-sm dark:border-white/10" data-inventory-decision>
        <p class="font-medium">{{ status(row.decision.status) }} · {{ date(row.decision.at) }}</p><p v-if="row.decision.productName" class="mt-1 break-words">{{ row.decision.productName }}</p><p v-if="row.decision.note" class="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{{ row.decision.note }}</p>
        <p v-if="row.contextChanged" class="mt-2 text-xs text-amber-700 dark:text-amber-400">用途・顧客が変わっています。判断を再確認してください。</p>
        <button v-if="['accepted', 'corrected'].includes(row.decision.status)" type="button" data-use-inventory-name class="btn btn-secondary mt-3 text-xs disabled:opacity-50" :disabled="blocked(row) || row.contextChanged || !!choice" @click="useName(row)">{{ draft.values.productName ? '商品名をこの内容に変更' : '商品名を下書きに反映' }}</button>
      </div>
      <fieldset :disabled="blocked(row)" class="space-y-3">
        <legend class="text-sm font-medium text-gray-800 dark:text-gray-200">この購入は、どの商品でしたか？</legend>
        <div class="flex flex-wrap gap-2"><button v-for="option in choices" :key="option.value" type="button" :data-inventory-choice="option.value" :aria-pressed="choice === option.value" class="min-h-10 rounded-lg border px-3 py-2 text-xs disabled:opacity-50" :class="choice === option.value ? 'border-primary-main bg-primary-main/10 text-primary-main' : 'border-gray-200 text-gray-600 dark:border-white/10 dark:text-gray-300'" @click="choose(option.value, row)">{{ option.label }}</button></div>
        <label v-if="choice === 'corrected'" class="block text-xs font-medium">正しい商品名<input v-model="productName" data-inventory-product class="inventory-control mt-1" maxlength="500"></label>
        <label v-if="choice" class="block text-xs font-medium">{{ ['corrected', 'rejected'].includes(choice) ? '理由・覚えておくこと（必須）' : '覚えておくこと（任意）' }}<textarea v-model="note" data-inventory-note class="inventory-control mt-1" rows="2" maxlength="2000" /></label>
        <button type="button" data-save-inventory-decision class="btn btn-primary text-xs disabled:opacity-50" :disabled="!canSave(row)" @click="save(row)">商品についての判断を保存</button>
      </fieldset>
      <p v-if="disabled" class="text-xs text-amber-700 dark:text-amber-400">編集中の下書きを保存してから、商品の判断を更新してください。</p>
      <p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">判断は次回の照合に参照します。商品名の反映後は下書きを保存してください。実際の支払価格・消費税・インボイス番号・勘定科目は、それぞれ確認が必要です。</p>
      <details v-if="row.history.length" class="text-xs"><summary class="cursor-pointer py-2 text-primary-main">判断の履歴 · {{ row.history.length }}件</summary><ul class="mt-2 space-y-2 text-gray-500 dark:text-gray-400"><li v-for="entry in row.history" :key="entry.revision" class="break-words">{{ date(entry.at) }} · {{ status(entry.after.status) }} · {{ entry.after.productName }} · {{ entry.after.note }}</li></ul></details>
    </article>
  </section>
</template>
<script setup lang="ts">
import { useUserStore } from '~/stores/user'
const props = defineProps<{ importIds?: string[]; draft?: any; disabled?: boolean }>()
const emit = defineEmits<{ useName: [name: string] }>(), user = useUserStore()
const rows = ref<any[]>([]), loading = ref(false), busy = ref(false), error = ref(''), message = ref('')
const choice = ref(''), productName = ref(''), note = ref('')
const choices = [{ value: 'accepted', label: 'この商品で合っている' }, { value: 'corrected', label: '商品名を修正' }, { value: 'rejected', label: 'この候補ではない' }, { value: 'pending', label: 'まだ分からない' }]
const status = (value: string) => ({ accepted: '商品を確認済み', corrected: '商品名を修正済み', rejected: '候補から除外', pending: '保留' }[value] || '未確認')
const strength = (row: any) => row.packet.strength === 'strong' ? '有力な候補' : '追加確認が必要な候補'
const yen = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value)
const amount = (value: number | null) => value === null ? '未確認' : yen(value)
const date = (value: string) => new Date(value).toLocaleString('ja-JP')
const query = computed(() => ({ imports: props.draft?.importId || (props.importIds || []).join(','), ...(props.draft ? { line: props.draft.line } : {}) }))
const blocked = (row: any) => busy.value || loading.value || !!error.value || !!props.disabled || row.locked || props.draft?.locked || row.draftRevision !== props.draft?.revision
const explain = (e: any) => e.data?.data?.message || e.data?.statusMessage || e.message || '商品の候補を読み込めませんでした。'
let generation = 0, loadedScope = ''
async function load() {
  const current = ++generation
  const scope = query.value.imports + ':' + (query.value.line || '')
  if (scope !== loadedScope) { rows.value = []; loadedScope = scope }
  choice.value = ''; error.value = ''; message.value = ''
  if (!query.value.imports) return
  loading.value = true
  try { const result: any = await $fetch('/api/finance-inventory-review', { headers: user.authHeader, query: query.value }); if (current === generation) rows.value = result.rows }
  catch (e: any) { if (current === generation) error.value = explain(e) }
  finally { if (current === generation) loading.value = false }
}
function choose(value: string, row: any) { choice.value = value; productName.value = row.decision?.productName || row.packet.productName; note.value = ''; message.value = '' }
function canSave(row: any) { return !blocked(row) && !!choice.value && (!['corrected', 'rejected'].includes(choice.value) || !!note.value.trim()) && (choice.value !== 'corrected' || (!!productName.value.trim() && productName.value.trim() !== row.packet.productName)) }
async function save(row: any) {
  if (!canSave(row)) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result: any = await $fetch('/api/finance-inventory-review', { method: 'POST', headers: user.authHeader, body: { importId: row.importId, line: row.line, key: row.key, sourceHash: row.sourceHash, draftRevision: row.draftRevision, contextKey: row.contextKey, revision: row.revision, packetHash: row.packetHash, status: choice.value, productName: productName.value, note: note.value } })
    rows.value = result.rows; choice.value = ''; note.value = ''; message.value = '商品についての判断を保存しました。'
  } catch (e: any) { error.value = explain(e) } finally { busy.value = false }
}
function useName(row: any) { if (blocked(row) || row.contextChanged || choice.value) return; emit('useName', row.decision.productName); message.value = '商品名を反映しました。内容を確認して下書きを保存してください。' }
watch(() => [query.value.imports, query.value.line, props.draft?.revision], load)
onMounted(load)
onBeforeUnmount(() => { generation++ })
</script>
<style scoped>
.inventory-control { @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100; }
</style>

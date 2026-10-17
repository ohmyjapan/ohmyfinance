<template>
  <section class="card intake-importer mb-6 p-4 sm:p-6" aria-label="Excel・CSVから取込" data-importer>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Excel・CSVから取込</h2>
        <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">ファイル → シート・見出し行 → 列の割り当て → 確認 → 取込。同じ注文ID（サービス・アカウント・商品IDで区別）は更新され、空欄の列は保存済みの値を消しません。</p>
      </div>
      <button type="button" class="btn btn-secondary text-xs" @click="$emit('close')">閉じる</button>
    </div>
    <p v-if="error" role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{{ error }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <label class="btn btn-secondary cursor-pointer text-sm">
        <Upload class="mr-2 h-4 w-4" aria-hidden="true" />ファイルを選ぶ
        <input type="file" class="sr-only" accept=".xlsx,.xls,.csv,.tsv,.txt" :disabled="busy" data-import-file @change="upload">
      </label>
      <span v-if="doc" class="text-sm text-gray-700 dark:text-gray-300" data-import-document>{{ doc.name }}（{{ sizeOf(doc.size) }}）</span>
      <Loader2 v-if="busy" class="h-4 w-4 animate-spin text-primary-main" aria-hidden="true" />
    </div>

    <div v-if="doc" class="mt-4 grid gap-4 md:grid-cols-3">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">シート
        <select v-model="sheet" class="intake-control mt-1" data-import-sheet @change="readSheet"><option v-for="name in doc.sheetNames" :key="name" :value="name">{{ name }}</option></select>
      </label>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">見出し行
        <input v-model.number="headerRow" type="number" min="1" max="100" class="intake-control mt-1" data-import-header-row @change="readSheet">
      </label>
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">テンプレート
        <select v-model="templateId" class="intake-control mt-1" data-import-template @change="applyTemplate"><option value="">（使わない）</option><option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option></select>
      </label>
    </div>

    <div v-if="sheetData" class="mt-4" data-import-mapping>
      <p class="text-xs text-gray-500 dark:text-gray-400">{{ sheetData.rowCount }} 行（見出しを除く）。各項目に使う列を選んでください。列がない項目は保存済みの値を保ちます。</p>
      <div class="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label v-for="field in FIELDS" :key="field[0]" class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ field[1] }}
          <select v-model="mapping[field[0]]" class="intake-control mt-1" :data-mapping="field[0]"><option value="">（列なし）</option><option v-for="(h, i) in sheetData.headers" :key="i" :value="String(i)">{{ h || ('列 ' + (i + 1)) }}</option></select>
        </label>
      </div>
      <div class="mt-3 grid gap-3 md:grid-cols-3">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">受付元・サービス（列がない時の既定）<input v-model="defaults.service" type="text" class="intake-control mt-1" data-default-service></label>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">サービス内アカウント（既定）<input v-model="defaults.account" type="text" class="intake-control mt-1" data-default-account></label>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">通貨（既定）<input v-model="defaults.currency" type="text" class="intake-control mt-1" data-default-currency></label>
      </div>
      <div class="mt-3" data-import-extras>
        <p class="text-xs text-gray-600 dark:text-gray-300">追加項目：上の項目にない列は、名前を付けてそのまま保存できます（受付ごとに表示・検索・編集できます）。</p>
        <div v-for="(x, i) in extras" :key="i" class="mt-2 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">項目名<input v-model="x.name" type="text" maxlength="60" placeholder="例: 担当者" class="intake-control mt-1" :data-extra-name="i"></label>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">列<select v-model="x.column" class="intake-control mt-1" :data-extra-column="i"><option value="">（列なし）</option><option v-for="(h, j) in sheetData.headers" :key="j" :value="String(j)">{{ h || ('列 ' + (j + 1)) }}</option></select></label>
          <button type="button" class="btn btn-secondary text-xs" :data-extra-remove="i" @click="extras.splice(i, 1)">削除</button>
        </div>
        <button type="button" class="btn btn-secondary mt-2 text-xs" :disabled="extras.length >= 30" data-extra-add @click="extras.push({ name: '', column: '' })">＋追加項目</button>
      </div>
      <details class="mt-3">
        <summary class="cursor-pointer text-xs text-gray-600 dark:text-gray-300">先頭 {{ sheetData.rows.length }} 行を見る</summary>
        <div class="mt-2 overflow-x-auto">
          <table class="min-w-full text-left text-xs"><thead><tr><th v-for="(h, i) in sheetData.headers" :key="i" class="whitespace-nowrap px-2 py-1 font-medium text-gray-600 dark:text-gray-300">{{ h }}</th></tr></thead>
            <tbody><tr v-for="(r, ri) in sheetData.rows" :key="ri" class="border-t border-gray-200 dark:border-white/10"><td v-for="(c, ci) in r" :key="ci" class="whitespace-nowrap px-2 py-1 text-gray-700 dark:text-gray-300">{{ c }}</td></tr></tbody></table>
        </div>
      </details>
      <div class="mt-4"><button type="button" class="btn btn-primary text-sm" :disabled="busy" data-import-preview @click="preview">取込内容を確認</button></div>
    </div>

    <div v-if="previewData" class="mt-6 border-t border-gray-200 pt-4 dark:border-white/10" data-import-preview-result>
      <p class="text-sm text-gray-800 dark:text-gray-200">新規 <strong class="tabular-nums" data-count-new>{{ previewData.counts.new }}</strong> · 追加・更新 <strong class="tabular-nums" data-count-update>{{ previewData.counts.update }}</strong> · 変更なし <strong class="tabular-nums" data-count-unchanged>{{ previewData.counts.unchanged }}</strong><span v-if="previewData.counts.ambiguous"> · IDの対応を確認 <strong class="tabular-nums">{{ previewData.counts.ambiguous }}</strong></span></p>
      <div class="mt-3 max-h-80 overflow-auto">
        <table class="min-w-full text-left text-xs">
          <thead><tr class="text-gray-600 dark:text-gray-300"><th class="px-2 py-1">行</th><th class="px-2 py-1">結果</th><th class="px-2 py-1">注文ID</th><th class="px-2 py-1">内容</th><th class="px-2 py-1 text-right">金額</th><th class="px-2 py-1">変更</th></tr></thead>
          <tbody>
            <tr v-for="r in previewData.rows" :key="r.key" :data-operation="r.operation" class="border-t border-gray-200 text-gray-700 dark:border-white/10 dark:text-gray-300">
              <td class="px-2 py-1 tabular-nums">{{ r.row }}</td>
              <td class="px-2 py-1">{{ operationLabel(r.operation) }}<span v-if="r.ambiguous || r.identityReview" class="ml-1 text-amber-700 dark:text-amber-400">（ID確認）</span></td>
              <td class="px-2 py-1">{{ r.values.orderId }}</td><td class="px-2 py-1">{{ r.values.description }}</td><td class="px-2 py-1 text-right tabular-nums">{{ r.values.amount }}</td>
              <td class="px-2 py-1">{{ r.changes.map((c: any) => labelOf(c.field) + ': ' + (c.before || '（空）') + ' → ' + c.after).join('、') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">この列の割り当てをテンプレートとして保存（任意）<input v-model="templateName" type="text" placeholder="例: 日次シート" class="intake-control mt-1" data-template-name></label>
        <button type="button" class="btn btn-primary text-sm" :disabled="busy" data-import-run @click="runImport">取り込む</button>
      </div>
    </div>
    <p v-if="result" role="status" class="mt-4 text-sm text-green-700 dark:text-green-400" data-import-done>取込が完了しました：新規 {{ result.counts.new }}・更新 {{ result.counts.update }}・変更なし {{ result.counts.unchanged }}<span v-if="result.counts.conflicts">・他の画面で変更されたため見送り {{ result.counts.conflicts }}</span></p>
  </section>
</template>

<script setup lang="ts">
import { Upload, Loader2 } from 'lucide-vue-next'
import { FIELDS, FIELD_NAMES, DEFAULT_SERVICE, DEFAULT_CURRENCY } from '~/shared/finance-intake.mjs'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
const emit = defineEmits<{ (e: 'imported', batch: any): void; (e: 'close'): void }>()
const user = useUserStore(), api = '/api/finance-intake/'
const assistant = useAssistantStore(), route = useRoute(), intakePath = route.path
const busy = ref(false), error = ref(''), doc = ref<any>(null), sheet = ref(''), headerRow = ref(1), templates = ref<any[]>([]), templateId = ref(''), templateName = ref('')
const sheetData = ref<any>(null), mapping = reactive<Record<string, string>>(Object.fromEntries(FIELDS.map(f => [f[0], '']))), defaults = reactive({ service: DEFAULT_SERVICE, account: '', currency: DEFAULT_CURRENCY })
// Owner-named extra columns beside the fixed fields: { name, column }; sent only when both are filled.
const extras = ref<{ name: string; column: string }[]>([])
const previewData = ref<any>(null), result = ref<any>(null)
watch([() => doc.value?.id, sheet, headerRow], () => {
  if (doc.value) assistant.pageSelection = { path: intakePath, documentId: doc.value.id, sheet: sheet.value, headerRow: headerRow.value, label: doc.value.name }
})
onBeforeUnmount(() => { if (assistant.pageSelection?.path === intakePath && assistant.pageSelection?.documentId === doc.value?.id) assistant.pageSelection = null })
watch(() => assistant.intakeSavedSequence, async () => {
  const a = assistant.intakeSaved?.receipt
  if (a?.name === 'save_intake_template' || a?.name === 'apply_intake_import') await loadTemplates()
  if (a?.name === 'apply_intake_import' && a.nativeResourceIds?.documentId === doc.value?.id) {
    previewData.value = null
    if (a.state === 'done') result.value = { id: a.nativeResourceIds.batchId, counts: a.nativeResourceIds.counts }
    else { result.value = null; error.value = '取込の一部が保存されています。受付と取込履歴を確認してから続けてください。' }
  }
})
const sizeOf = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const operationLabel = (op: string) => op === 'new' ? '新規' : op === 'update' ? '追加・更新' : '変更なし'
const labelOf = (field: string) => field.startsWith('extra:') ? field.slice(6) : (FIELD_NAMES as Record<string, string>)[field] || field
function errorMessage(e: any) { return e.data?.data?.message || e.data?.statusMessage || e.message || '処理に失敗しました。再試行してください。' }
async function run(action: () => Promise<void>) { busy.value = true; error.value = ''; try { await action() } catch (e: any) { error.value = errorMessage(e) } finally { busy.value = false } }
const body = () => ({ sheet: sheet.value, headerRow: headerRow.value, mapping: { ...mapping }, defaults: { ...defaults }, extras: extras.value.filter(x => x.name.trim() && x.column !== '').map(x => ({ name: x.name.trim(), column: x.column })) })
function applyExtras(source: any[] | undefined) { const limit = sheetData.value?.headers.length || 0; extras.value = (source || []).filter(x => x && typeof x.name === 'string' && x.name.trim() && Number(x.column) < limit).map(x => ({ name: x.name, column: String(x.column) })) }
function contentType(file: File) { if (file.type) return file.type; const ext = file.name.toLowerCase().split('.').pop(); return ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : ext === 'xls' ? 'application/vnd.ms-excel' : 'text/csv' }
async function loadTemplates() { try { templates.value = ((await $fetch(api + 'templates', { headers: user.authHeader })) as any).templates } catch { templates.value = [] } }
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return
  await run(async () => {
    if (file.size > 10 * 1024 * 1024) throw Error('ファイルは10MB以内で選択してください。')
    const data: any = await $fetch(api + 'files', { method: 'POST', query: { name: file.name }, headers: { ...user.authHeader, 'Content-Type': contentType(file) }, body: file })
    doc.value = data.document; sheet.value = data.document.sheetNames[0] || ''; headerRow.value = 1; previewData.value = null; result.value = null
    await readSheetNow()
  })
  input.value = ''
}
async function readSheetNow() {
  const data: any = await $fetch(api + 'files/' + doc.value.id + '/sheet', { query: { sheet: sheet.value, headerRow: headerRow.value }, headers: user.authHeader })
  sheetData.value = data; previewData.value = null
  const template = templates.value.find(t => t.id === templateId.value)
  if (template) { applyMapping(template.mapping); applyExtras(template.extras) } else { Object.assign(mapping, data.mapping); applyExtras(extras.value) }
}
function readSheet() { if (doc.value) run(readSheetNow) }
function applyMapping(source: Record<string, string>) { const limit = sheetData.value?.headers.length || 0; for (const [k] of FIELDS) mapping[k] = source[k] !== undefined && source[k] !== '' && Number(source[k]) < limit ? String(source[k]) : '' }
function applyTemplate() {
  const template = templates.value.find(t => t.id === templateId.value)
  if (!template) { if (sheetData.value) Object.assign(mapping, sheetData.value.mapping); extras.value = []; return }
  applyMapping(template.mapping); applyExtras(template.extras); defaults.service = template.service || DEFAULT_SERVICE; defaults.account = template.account || ''; defaults.currency = template.currency || DEFAULT_CURRENCY; templateName.value = template.name; previewData.value = null
}
async function preview() { await run(async () => { previewData.value = await $fetch(api + 'files/' + doc.value.id + '/preview', { method: 'POST', headers: user.authHeader, body: body() }); result.value = null }) }
async function runImport() {
  await run(async () => {
    const data: any = await $fetch(api + 'files/' + doc.value.id + '/import', { method: 'POST', headers: user.authHeader, body: { ...body(), ...(templateName.value.trim() ? { template: { name: templateName.value.trim() } } : {}) } })
    result.value = data.batch; previewData.value = null; emit('imported', data.batch); await loadTemplates()
  })
}
onMounted(loadTemplates)
</script>

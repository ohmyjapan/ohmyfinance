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

    <!-- Plan omf-order-mapping piece 2: a known file kind is read on its own sheet with its own columns; the owner sees what the
         file holds and its totals, then imports. The grid stays one click away and turns the kind off for this import. -->
    <section v-if="kindActive && sheetData" class="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10" aria-label="ファイルの種類" data-file-kind>
      <p class="text-sm text-gray-900 dark:text-gray-100"><strong class="font-semibold" data-file-kind-name>{{ fileType.name }}</strong><template v-if="kindPreview"><span class="text-gray-400"> · </span><span class="tabular-nums" data-file-kind-orders>{{ kindPreview.summary.orders }} 件の注文</span><span class="text-gray-400"> · </span><span :class="failedChecks.length ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'" data-file-kind-totals>{{ failedChecks.length ? '合計が一致しない項目 ' + failedChecks.length : kindPreview.checks.length ? '合計一致' : '合計の確認なし' }}</span></template></p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ sheet }} シートの {{ headerRow }} 行目を見出しとして、このファイルの種類の列の割り当てで読み取ります。購入状況は元の表記から決め、ほかの列は書かれているとおりに保存します。</p>
      <p v-if="fileType.service" class="mt-3 text-sm text-gray-700 dark:text-gray-300" data-file-kind-service>受付元・サービス：<strong class="font-medium">{{ fileType.service }}</strong><span class="ml-1 text-xs text-gray-500 dark:text-gray-400">（前回の取込と同じ名前で取り込みます）</span></p>
      <label v-else class="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">受付元・サービス<span class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">このファイルの種類で最初の取込です。次回からこの名前で取り込みます。</span><input v-model="kindServiceName" type="text" maxlength="200" class="intake-control mt-1 md:max-w-md" data-file-kind-service-input @input="previewData = null"></label>
      <button v-if="!kindPreview" type="button" class="btn btn-primary mt-3 text-sm" :disabled="busy || !kindServiceText" data-file-kind-preview @click="preview">取込内容を確認</button>
      <template v-if="kindPreview">
        <ul class="mt-3 space-y-1 text-xs leading-relaxed text-gray-700 dark:text-gray-300" data-file-kind-summary>
          <li v-if="kindPreview.summary.totalRows || kindPreview.summary.otherRows" data-file-kind-left-out>取り込まない行：合計行 {{ kindPreview.summary.totalRows }}<span v-if="kindPreview.summary.otherRows">・注文ではない行 {{ kindPreview.summary.otherRows }}（{{ noteOf('other-rows')?.rows?.join('・') }}行目）</span></li>
          <li v-for="n in kindPreview.notes.filter((x: any) => x.kind === 'unknown-status')" :key="'s' + n.word" class="text-amber-700 dark:text-amber-400" data-file-kind-unknown-status>表にない購入状況「{{ n.word || '（空）' }}」{{ n.count }} 件：受付中として取り込み、元の表記を「元のステータス」に残します</li>
          <li v-for="(line, i) in kindNoteLines" :key="'n' + i" class="text-amber-700 dark:text-amber-400" data-file-kind-note>{{ line }}</li>
        </ul>
        <div v-if="kindPreview.checks.length" class="mt-3 overflow-x-auto">
          <table class="min-w-full text-left text-xs" data-file-kind-checks>
            <thead><tr class="text-gray-600 dark:text-gray-300"><th class="px-2 py-1 font-medium">ファイルの合計と照合</th><th class="px-2 py-1 text-right font-medium">注文の合計</th><th class="px-2 py-1 text-right font-medium">ファイルの値</th><th class="px-2 py-1 font-medium">結果</th></tr></thead>
            <tbody>
              <tr v-for="c in kindPreview.checks" :key="c.key" class="border-t border-gray-200 text-gray-700 dark:border-white/10 dark:text-gray-300" :data-check="c.key" :data-check-ok="String(c.ok)">
                <td class="px-2 py-1">{{ c.label }}</td><td class="px-2 py-1 text-right tabular-nums">{{ numberText(c.sum) }}</td><td class="px-2 py-1 text-right tabular-nums">{{ c.total === null ? '（なし）' : numberText(c.total) }}</td>
                <td class="px-2 py-1" :class="c.ok ? 'text-green-700 dark:text-green-400' : c.info ? 'text-gray-500 dark:text-gray-400' : 'text-amber-700 dark:text-amber-400'">{{ c.ok ? '一致' : c.info ? '参考（差 ' + numberText(c.sum - (c.total || 0)) + '）' : '不一致' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="failedChecks.length" class="mt-2 text-xs text-amber-700 dark:text-amber-400">一致しない合計があっても取込は止めません。両方の値は取込履歴にも残ります。</p>
        </div>
      </template>
      <button type="button" class="mt-3 text-xs text-primary-main underline dark:text-primary-light" data-kind-off @click="turnKindOff">列の割り当てを自分で変える</button>
    </section>
    <p v-if="kindOffNotice" role="status" class="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-file-kind-off>「{{ fileType.name }}」の読み取りを使わず、いつもの取込で進めます（合計行も1件の受付になります）。<button type="button" class="ml-1 underline" data-kind-on @click="turnKindOn">ファイルの種類で取り込む</button></p>
    <p v-if="nearNotice" role="status" class="mt-4 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:bg-white/5 dark:text-gray-300" data-file-kind-near>{{ nearNotice }}</p>

    <div v-if="sheetData && !kindActive" class="mt-4" data-import-mapping>
      <div v-if="templateNotice.length" role="status" class="mb-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-template-header-notice>
        <p>テンプレートを保存したときの見出しと、このシートの見出しが異なります。列の割り当てと「取込内容を確認」の結果で、正しい列か確かめてください（取込は止めません）。</p>
        <p v-for="(d, i) in templateNotice.slice(0, 10)" :key="i" class="break-words">{{ d }}</p><p v-if="templateNotice.length > 10">ほか {{ templateNotice.length - 10 }} 列</p>
      </div>
      <div v-if="cellNoteLines.length" class="mb-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:bg-white/5 dark:text-gray-300" data-import-cell-notes>
        <p v-for="(line, i) in cellNoteLines" :key="i" class="break-words">{{ line }}</p>
      </div>
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
      <p class="text-sm text-gray-800 dark:text-gray-200">新規 <strong class="tabular-nums" data-count-new>{{ previewData.counts.new }}</strong> · 追加・更新 <strong class="tabular-nums" data-count-update>{{ previewData.counts.update }}</strong> · 変更なし <strong class="tabular-nums" data-count-unchanged>{{ previewData.counts.unchanged }}</strong><span v-if="previewData.counts.ambiguous"> · IDの対応を確認 <strong class="tabular-nums">{{ previewData.counts.ambiguous }}</strong></span><span v-if="previewData.counts.identityChanged"> · ID変更（同じファイル行） <strong class="tabular-nums">{{ previewData.counts.identityChanged }}</strong></span></p>
      <div v-if="previewData.warnings?.length" class="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-import-warnings><p v-for="(w, i) in previewData.warnings" :key="i" class="break-words">{{ warningText(w) }}</p></div>
      <div class="mt-3 max-h-80 overflow-auto">
        <table class="min-w-full text-left text-xs">
          <thead><tr class="text-gray-600 dark:text-gray-300"><th class="px-2 py-1">行</th><th class="px-2 py-1">結果</th><th class="px-2 py-1">注文ID</th><th class="px-2 py-1">内容</th><th class="px-2 py-1 text-right">金額</th><th class="px-2 py-1">変更</th></tr></thead>
          <tbody>
            <tr v-for="r in previewData.rows" :key="r.key" :data-operation="r.operation" class="border-t border-gray-200 text-gray-700 dark:border-white/10 dark:text-gray-300">
              <td class="px-2 py-1 tabular-nums">{{ r.row }}</td>
              <td class="px-2 py-1">{{ operationLabel(r.operation) }}<span v-if="r.ambiguous || r.identityReview" class="ml-1 text-amber-700 dark:text-amber-400">（ID確認）</span><span v-if="r.identityChanged" class="ml-1 text-amber-700 dark:text-amber-400" data-identity-changed>（同じファイル行の受付のIDを変更）</span><span v-if="r.provenanceConflict?.length" class="ml-1 text-amber-700 dark:text-amber-400" data-provenance-conflict>（同じファイル行の別の受付あり・統合しません）</span></td>
              <td class="px-2 py-1">{{ r.values.orderId }}</td><td class="px-2 py-1">{{ r.values.description }}</td><td class="px-2 py-1 text-right tabular-nums">{{ r.values.amount }}</td>
              <td class="px-2 py-1">{{ r.changes.map((c: any) => labelOf(c.field) + ': ' + (c.before || '（空）') + ' → ' + (c.after || '（空）')).join('、') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4 grid items-end gap-3" :class="kindActive ? '' : 'md:grid-cols-[minmax(0,1fr)_auto]'">
        <label v-if="!kindActive" class="block text-sm font-medium text-gray-700 dark:text-gray-300">この列の割り当てをテンプレートとして保存（任意）<input v-model="templateName" type="text" placeholder="例: 日次シート" class="intake-control mt-1" data-template-name></label>
        <button type="button" class="btn btn-primary text-sm" :class="kindActive ? 'justify-self-start' : ''" :disabled="busy || (kindActive && !kindServiceText)" data-import-run @click="runImport">取り込む</button>
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
// Plan omf-order-mapping piece 2: the file kind the server recognised (null for any other file), whether the owner turned it off for
// this import (grid opened or template chosen), and the service name of the kind's first import. The kind applies on its own sheet
// and header row only; any other sheet or header row is read exactly as today.
const fileType = ref<any>(null), fileTypeNear = ref<any>(null), kindOff = ref(false), kindServiceName = ref('')
const onKindSheet = computed(() => !!fileType.value && sheet.value === fileType.value.sheet && Number(headerRow.value) === fileType.value.headerRow)
const kindActive = computed(() => onKindSheet.value && !kindOff.value)
const kindOffNotice = computed(() => onKindSheet.value && kindOff.value)
const kindServiceText = computed(() => String(fileType.value?.service || kindServiceName.value || '').trim())
const kindPreview = computed(() => kindActive.value && previewData.value?.summary ? previewData.value : null)
const failedChecks = computed(() => (kindPreview.value?.checks || []).filter((c: any) => !c.ok && !c.info))
const noteOf = (kind: string) => kindPreview.value?.notes?.find((n: any) => n.kind === kind)
const numberText = (n: number) => Number.isFinite(n) ? n.toLocaleString('ja-JP') : '—'
const nearNotice = computed(() => { const n = fileTypeNear.value; return n?.reason === 'header' ? '「' + n.name + '」と同じ形のファイルに見えますが、' + n.sheet + ' シートの列 ' + (n.column + 1) + ' の見出しが「' + (n.found || '（空）') + '」です（「' + (n.expected || '（なし）') + '」のはずです）。ファイルの種類としては読み取らず、いつもの取込で進めます。' : '' })
function noteText(n: any): string {
  if (n.kind === 'card-sheet-missing') return '決済方法ごとの合計のシートがないため、カードごとの照合はしません。'
  if (n.kind === 'total-row-missing') return 'ファイルに合計行がないため、合計の照合はしません。'
  if (n.kind === 'several-total-rows') return '合計行が ' + n.count + ' 行あります（' + n.rows.join('・') + '行目）。最初の合計行と照合します。'
  return ''
}
const kindNoteLines = computed(() => (kindPreview.value?.notes || []).map(noteText).filter(Boolean))
function turnKindOff() { kindOff.value = true; previewData.value = null; result.value = null }
async function turnKindOn() { kindOff.value = false; templateId.value = ''; templateNotice.value = []; previewData.value = null; result.value = null; if (sheetData.value) { Object.assign(mapping, sheetData.value.mapping); applyExtras(sheetData.value.extras) } if (kindServiceText.value) await preview() }
watch([() => doc.value?.id, sheet, headerRow], () => {
  if (doc.value) assistant.pageSelection = { path: intakePath, documentId: doc.value.id, sheet: sheet.value, headerRow: headerRow.value, label: doc.value.name }
})
onBeforeUnmount(() => { if (assistant.pageSelection?.path === intakePath && assistant.pageSelection?.documentId === doc.value?.id) assistant.pageSelection = null })
watch(() => assistant.intakeSavedSequence, async () => {
  const receipts = assistant.intakeSaved?.receipts || []
  if (receipts.some((a: any) => a.name === 'save_intake_template' || a.name === 'apply_intake_import')) await loadTemplates()
  const a = [...receipts].reverse().find((a: any) => a.name === 'apply_intake_import' && a.nativeResourceIds?.documentId === doc.value?.id)
  if (a) {
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
// A kind import sends the kind's own mapping and extra columns (as the sheet read answered them), no account and JPY; the server
// refuses anything else. Any other import is today's, with fileType 'off' when the file is a kind the owner chose not to use.
const body = () => kindActive.value
  ? { sheet: sheet.value, headerRow: headerRow.value, mapping: { ...sheetData.value.mapping }, extras: sheetData.value.extras || [], defaults: { service: kindServiceText.value, account: '', currency: DEFAULT_CURRENCY } }
  : { sheet: sheet.value, headerRow: headerRow.value, mapping: { ...mapping }, defaults: { ...defaults }, extras: extras.value.filter(x => x.name.trim() && x.column !== '').map(x => ({ name: x.name.trim(), column: x.column })), ...(fileType.value ? { fileType: 'off' } : {}) }
function applyExtras(source: any[] | undefined) { const limit = sheetData.value?.headers.length || 0; extras.value = (source || []).filter(x => x && typeof x.name === 'string' && x.name.trim() && Number(x.column) < limit).map(x => ({ name: x.name, column: String(x.column) })) }
function contentType(file: File) { if (file.type) return file.type; const ext = file.name.toLowerCase().split('.').pop(); return ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : ext === 'xls' ? 'application/vnd.ms-excel' : 'text/csv' }
async function loadTemplates() { try { templates.value = ((await $fetch(api + 'templates', { headers: user.authHeader })) as any).templates } catch { templates.value = [] } }
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return
  await run(async () => {
    if (file.size > 10 * 1024 * 1024) throw Error('ファイルは10MB以内で選択してください。')
    const data: any = await $fetch(api + 'files', { method: 'POST', query: { name: file.name }, headers: { ...user.authHeader, 'Content-Type': contentType(file) }, body: file })
    // A known kind opens on its own sheet and header row and is checked at once; its first import is prefilled with the name used
    // for the person's other kind, else the company name.
    doc.value = data.document; fileType.value = data.fileType || null; fileTypeNear.value = data.fileTypeNear || null; kindOff.value = false
    if (fileType.value) { templateId.value = ''; templateName.value = ''; kindServiceName.value = fileType.value.service || fileType.value.otherService || user.currentOrganization?.name || '' }
    sheet.value = fileType.value?.sheet || data.document.sheetNames[0] || ''; headerRow.value = fileType.value?.headerRow || 1; previewData.value = null; result.value = null
    await readSheetNow()
    if (kindActive.value && kindServiceText.value) await previewNow()
  })
  input.value = ''
}
async function readSheetNow() {
  const data: any = await $fetch(api + 'files/' + doc.value.id + '/sheet', { query: { sheet: sheet.value, headerRow: headerRow.value }, headers: user.authHeader })
  sheetData.value = data; previewData.value = null
  const template = templates.value.find(t => t.id === templateId.value)
  if (template) { applyMapping(template.mapping); applyExtras(template.extras) } else { Object.assign(mapping, data.mapping); applyExtras(data.extras || extras.value) }
  compareHeaders(template)
}
function readSheet() { if (doc.value) run(readSheetNow) }
function applyMapping(source: Record<string, string>) { const limit = sheetData.value?.headers.length || 0; for (const [k] of FIELDS) mapping[k] = source[k] !== undefined && source[k] !== '' && Number(source[k]) < limit ? String(source[k]) : '' }
function applyTemplate() {
  const template = templates.value.find(t => t.id === templateId.value)
  compareHeaders(template)
  if (!template) { if (sheetData.value) Object.assign(mapping, sheetData.value.mapping); extras.value = []; return }
  // A saved template is a column mapping of its own: choosing one turns the file kind off for this import.
  if (onKindSheet.value) kindOff.value = true
  applyMapping(template.mapping); applyExtras(template.extras); defaults.service = template.service || DEFAULT_SERVICE; defaults.account = template.account || ''; defaults.currency = template.currency || DEFAULT_CURRENCY; templateName.value = template.name; previewData.value = null
}
// F1 (plan omf-monthly-reconciliation-20261020): a saved template is applied by column position; when its stored headers differ from
// this sheet's, say which columns differ. A notice only — the mapping stays editable and preview/import are not blocked.
const templateNotice = ref<string[]>([])
function compareHeaders(template: any) {
  const norm = (v: any) => String(v ?? '').normalize('NFKC').trim(), saved: string[] = (template?.headers || []).map(norm), current: string[] = (sheetData.value?.headers || []).map(norm), diffs: string[] = []
  if (template && saved.length) for (let i = 0; i < Math.max(saved.length, current.length); i++) if ((saved[i] || '') !== (current[i] || '')) diffs.push('列' + (i + 1) + '：保存時「' + (saved[i] || '（なし）') + '」→ このシート「' + (current[i] || '（なし）') + '」')
  templateNotice.value = diffs
}
// F1: what the intake reader did with typed Excel cells, and what it cannot recover.
const columnName = (c: number) => sheetData.value?.headers?.[c] || '列 ' + (c + 1)
const cellNoteLines = computed(() => {
  const n = sheetData.value?.cellNotes, out: string[] = []; if (!n) return out
  if (n.numericColumns?.length) out.push('数値のセルがある列：' + n.numericColumns.map(columnName).join('、') + '。Excelの数値は15桁までしか保存されず、先頭の0も保存されません。注文番号などのIDは、元のファイルで文字列（テキスト）として保存したものを使ってください。書式で表示された0（例：00123）はそのまま読み取ります。')
  if (n.impreciseCount) out.push('15桁を超える数値が ' + n.impreciseCount + ' 件あります（' + n.imprecise.slice(0, 3).map((x: any) => x.row + '行目・' + columnName(x.column) + '：' + x.shown).join('、') + '）。失われた桁は元のファイルにもないため、表示どおりに取り込み、推測で補いません。')
  if (n.dateColumns?.length) out.push('日付のセルは yyyy-mm-dd（時刻があれば yyyy-mm-dd HH:MM）として読み取ります（1900年・1904年の日付方式に対応）：' + n.dateColumns.map(columnName).join('、'))
  return out
})
const FIELD_LABELS = FIELD_NAMES as Record<string, string>
const warningText = (w: any) => w.kind === 'numeric-id' ? (FIELD_LABELS[w.field] || w.field) + 'に数値のセルの列（' + columnName(w.column) + '）が割り当てられています。先頭の0や15桁を超える桁は元のファイルにありません。必要なら元のファイルを文字列で保存し直してください。' : w.kind === 'imprecise-number' ? columnName(w.column) + 'の15桁を超える数値（' + (w.rows || []).join('・') + '行目など、例：' + w.shown + '）は表示どおりに取り込みます。' : String(w.kind || '')
async function previewNow() { previewData.value = await $fetch(api + 'files/' + doc.value.id + '/preview', { method: 'POST', headers: user.authHeader, body: body() }); result.value = null }
async function preview() { await run(previewNow) }
async function runImport() {
  await run(async () => {
    const kind = kindActive.value
    const data: any = await $fetch(api + 'files/' + doc.value.id + '/import', { method: 'POST', headers: user.authHeader, body: { ...body(), ...(!kind && templateName.value.trim() ? { template: { name: templateName.value.trim() } } : {}) } })
    // The kind's service name is now fixed by this batch; a second import in this session shows it without a box.
    if (kind && data.batch?.defaults?.service) fileType.value = { ...fileType.value, service: data.batch.defaults.service }
    result.value = data.batch; previewData.value = null; emit('imported', data.batch); await loadTemplates()
  })
}
onMounted(loadTemplates)
</script>

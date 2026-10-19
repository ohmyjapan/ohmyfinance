<template>
  <div class="intake intake-detail">
    <header class="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div class="min-w-0">
        <NuxtLink to="/intake" class="text-sm text-primary-main dark:text-primary-light">← 購入受付</NuxtLink>
        <h1 class="mt-1 break-words text-xl font-semibold text-gray-800 dark:text-gray-100">{{ title }}</h1>
        <p v-if="record" class="text-gray-600 dark:text-gray-400">{{ record.values.service }}<span v-if="record.values.account"> · {{ record.values.account }}</span><span v-if="record.values.orderId"> · 注文 {{ record.values.orderId }}</span><span v-if="record.values.itemId"> / {{ record.values.itemId }}</span></p>
      </div>
      <div v-if="record" class="flex flex-wrap items-center gap-3">
        <span class="badge-status" :class="record.archived ? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300' : 'bg-primary-main/10 text-primary-main dark:text-primary-light'" data-record-state>{{ record.archived ? 'アーカイブ済み' : STATE_NAMES[record.values.purchaseState] }}</span>
        <button type="button" class="btn btn-secondary text-sm shadow-sm" :disabled="busy" data-archive @click="archive(!record.archived)">{{ record.archived ? '元に戻す' : 'アーカイブ' }}</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{{ error }}<button v-if="conflict" type="button" class="ml-3 underline" data-reload @click="load">再読み込み</button></p>
    <p v-if="message" role="status" class="mb-6 text-sm text-green-700 dark:text-green-400" data-message>{{ message }}</p>
    <div v-if="loading" role="status" class="card flex items-center justify-center gap-3 p-12 text-sm text-gray-500 dark:text-gray-400"><Loader2 class="h-6 w-6 animate-spin text-primary-main" aria-hidden="true" />受付を読み込んでいます…</div>

    <template v-else-if="record">
      <p v-if="record.identityReview" class="mb-4 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400" data-identity-review><Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />同じ注文IDの受付が他にあります。サービス・アカウント・商品IDで区別できるか確認し、保存すると対応を見直します。</p>

      <section class="card mb-6 p-4 sm:p-6" aria-label="受付内容">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">受付内容</h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">空欄のまま保存しても、保存済みの値は消えません。</p>
        <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label v-for="field in FIELDS" :key="field[0]" class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ field[1] }}
            <select v-if="field[0] === 'purchaseState'" :id="'intake-' + field[0]" v-model="form.purchaseState" class="intake-control mt-1" :disabled="record.archived || busy"><option v-for="s in STATES" :key="s" :value="s">{{ STATE_NAMES[s] }}</option></select>
            <input v-else :id="'intake-' + field[0]" v-model="form[field[0]]" type="text" class="intake-control mt-1" :disabled="record.archived || busy" autocomplete="off">
          </label>
        </div>
        <div class="mt-4" data-extras>
          <p class="text-xs font-medium text-gray-700 dark:text-gray-300">追加項目</p>
          <div v-if="extraNames.length" class="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label v-for="name in extraNames" :key="name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ name }}
              <input v-model="extraForm[name]" type="text" class="intake-control mt-1" :disabled="record.archived || busy" autocomplete="off" :data-extra="name">
            </label>
          </div>
          <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">追加項目はありません。</p>
          <div class="mt-2 flex flex-wrap items-end gap-3">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">新しい項目名<input v-model="newExtraName" type="text" maxlength="60" class="intake-control mt-1" :disabled="record.archived || busy" autocomplete="off" data-extra-new></label>
            <button type="button" class="btn btn-secondary text-sm" :disabled="record.archived || busy || !newExtraName.trim()" data-extra-add @click="addExtra">＋項目を追加</button>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <button type="button" class="btn btn-primary text-sm" :disabled="busy || record.archived || !dirty" data-save @click="save">保存</button>
          <button type="button" class="btn btn-secondary text-sm" :disabled="!dirty" @click="reset">入力を元に戻す</button>
        </div>
      </section>

      <section class="card mb-6 p-4 sm:p-6" aria-label="会社・登録番号の調査" data-intake-research>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">会社・登録番号の調査</h2>
            <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">店舗・商品URLから販売者の会社名（法人名）と登録番号（T番号）を調べ、根拠を確認してから受付に保存します。</p>
          </div>
          <span class="text-xs" :class="researchPending ? 'text-primary-main' : 'text-gray-500'" data-research-state>{{ researchStateLabel }}</span>
        </div>
        <p v-if="researchError" role="alert" class="mt-3 text-xs text-red-600 dark:text-red-400" data-research-error>{{ researchError }} <button type="button" class="underline" @click="loadResearch">再読込</button></p>
        <p v-if="researchData && !researchData.connected" class="mt-3 text-xs text-amber-700 dark:text-amber-400" data-research-connection>調査担当に接続できません</p>
        <p v-else-if="researchData && researchData.settings?.intakeResearch !== true" class="mt-3 text-xs text-amber-700 dark:text-amber-400" data-research-connection>ワーカーの更新が必要です</p>
        <p v-if="researchData?.settings" class="mt-1 text-xs text-gray-500">国税庁の照合 {{ researchData.settings.ntaConfigured ? '設定済み' : '未設定' }}</p>
        <label class="mt-4 block text-xs font-medium text-gray-700 dark:text-gray-300">調べたいこと・補足（任意）
          <textarea v-model="researchInstruction" rows="2" maxlength="2000" class="intake-control mt-1" :disabled="researchPending || busy || record.archived" data-research-instruction />
        </label>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" class="btn btn-primary text-sm" data-research-start :disabled="busy || record.archived || researchPending || !record.values.merchantUrl || dirty || !researchData?.connected || researchData?.settings?.intakeResearch !== true" @click="startResearch">{{ researchPending ? '調査中…' : research?.report || research?.state === 'failed' ? 'もう一度調べる' : 'URLから会社とT番号を調べる' }}</button>
          <p v-if="!record.values.merchantUrl" class="text-xs text-gray-500 dark:text-gray-400">店舗・商品URLを保存すると調べられます。</p>
          <p v-else-if="dirty" class="text-xs text-amber-700 dark:text-amber-400">編集中の内容を保存してから調べてください。</p>
        </div>
        <p v-if="researchPending" role="status" class="mt-4 text-sm text-gray-600 dark:text-gray-300" data-research-stage>{{ researchStageLabel }} このページを離れても調査は続きます。</p>
        <p v-if="research?.state === 'failed'" class="mt-4 text-xs text-amber-700 dark:text-amber-400" data-research-failure>{{ failureText(research.failure) }}</p>
        <p v-if="researchData?.stale && research?.report" class="mt-3 text-xs text-amber-700 dark:text-amber-400" data-research-stale>{{ research.state === 'confirmed' ? '保存後に' + changedText + 'が変更されました。下の根拠は調査時のもので、現在の値とは異なります。必要なら「もう一度調べる」で現在の内容を調べ直してください。' : '受付が調査時から変わっています。保存する前にもう一度調べてください。' }}</p>
        <template v-if="research?.report">
          <p class="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200" data-research-summary>{{ research.report.summary }}</p>
          <p v-if="research.report.question" class="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-research-question>{{ research.report.question }}</p>
          <div v-if="research.report.supplier" class="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10" data-research-supplier>
            <dl class="grid gap-3 sm:grid-cols-3">
              <div><dt class="text-xs text-gray-500">店舗名</dt><dd class="mt-1 break-words text-sm font-medium text-gray-900 dark:text-gray-100" data-research-shop>{{ research.report.supplier.shopName }}</dd></div>
              <div><dt class="text-xs text-gray-500">法人名</dt><dd class="mt-1 break-words text-sm font-medium text-gray-900 dark:text-gray-100" data-research-legal>{{ research.report.supplier.legalName }}</dd></div>
              <div><dt class="text-xs text-gray-500">T番号</dt><dd class="mt-1 text-sm text-gray-900 dark:text-gray-100" data-research-number>{{ research.report.supplier.invoiceNumber || '未取得' }}</dd></div>
            </dl>
            <p class="mt-3 text-xs" :class="research.verified ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'" data-research-registry>{{ registryText }}</p>
            <p v-if="research.registry && !research.verified" class="mt-1 text-xs text-gray-500">国税庁の名義：{{ research.registry.legalName }}（{{ research.registry.number }}）</p>
            <p v-if="researchData.attribution?.differs?.length && research.report.supplier.citations?.length" class="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400" data-research-historical>調査時の根拠（現在の値と異なる）</p>
            <div v-for="c in research.report.supplier.citations" :key="c.sourceId + c.quote" class="mt-3 border-l-2 border-gray-200 pl-3 dark:border-white/10" data-research-citation>
              <p class="text-xs text-gray-400">{{ sourceOf(c.sourceId)?.title }}<a v-if="sourceOf(c.sourceId)?.url" :href="sourceOf(c.sourceId).url" target="_blank" rel="noopener noreferrer" class="ml-1 text-primary-main underline">↗</a></p>
              <p class="mt-1 whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-gray-300">{{ c.quote }}</p>
            </div>
            <button type="button" class="btn btn-primary mt-4 text-sm" data-research-confirm :disabled="busy || record.archived || research.state !== 'ready' || researchData.stale" @click="confirmResearch">{{ research.state === 'confirmed' ? (researchData.stale ? '保存後に変更あり' : '受付に保存済み') : 'この会社とT番号を受付に保存' }}</button>
            <p class="mt-2 text-xs text-gray-500">会社名（法人名）と登録番号（T番号）だけを受付に保存します。帳簿・仕入れ先は変更しません。</p>
          </div>
          <p v-else class="mt-4 text-xs text-amber-700 dark:text-amber-400" data-research-no-supplier>会社・登録番号を特定できませんでした。</p>
        </template>
        <details v-if="research?.history?.length" class="mt-4 text-xs"><summary class="cursor-pointer py-2 text-primary-main">以前の調査 · {{ research.history.length }}件</summary>
          <div v-for="(h, i) in research.history" :key="i" class="mt-2 border-l-2 border-gray-200 pl-3 dark:border-white/10" data-research-history><p class="text-gray-500">{{ when(h.at) }} · {{ h.failure ? failureText(h.failure) : h.report?.supplier ? h.report.supplier.legalName + ' ' + (h.report.supplier.invoiceNumber || '') : '会社未特定' }}<span v-if="h.confirmed"> · 保存済み</span></p></div>
        </details>
      </section>

      <IntakePaymentMatches class="mb-6" side="record" :record-id="recordId" :record="record" :disabled="busy || record.archived" @changed="load" />
      <section class="card mb-6 p-4 sm:p-6" aria-label="添付・原本">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">添付・原本</h2>
        <p v-if="!record.attachments.length" class="mt-2 text-sm text-gray-500 dark:text-gray-400">添付はありません。</p>
        <ul v-else class="mt-2 divide-y divide-gray-200 dark:divide-white/10">
          <li v-for="doc in record.attachments" :key="doc.id" :data-attachment="doc.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
            <span class="min-w-0 break-all text-sm text-gray-800 dark:text-gray-200">{{ doc.name }}<span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{{ sizeOf(doc.size) }} · {{ doc.mimeType }}</span></span>
            <button type="button" class="btn btn-secondary text-xs" :disabled="busy" @click="download(doc.url, doc.name)">ダウンロード</button>
          </li>
        </ul>
        <label class="btn btn-secondary mt-3 cursor-pointer text-sm" :class="{ 'opacity-50': busy || record.archived }"><Upload class="mr-2 h-4 w-4" aria-hidden="true" />ファイルを添付<input type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.tsv,.txt" :disabled="busy || record.archived" data-attach @change="attach"></label>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">PDF・PNG・JPEG・WebP・Excel・CSV、10MBまで。同じ内容のファイルは一度だけ保管されます。</p>
      </section>

      <section class="card mb-6 p-4 sm:p-6" aria-label="取込元">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">取込元（ファイル・シート・行）</h2>
        <p v-if="!record.provenance.length" class="mt-2 text-sm text-gray-500 dark:text-gray-400">手入力の受付です。</p>
        <ul v-else class="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <li v-for="p in record.provenance" :key="p.hash + p.sheet + p.row" data-provenance><button type="button" class="break-all text-left text-primary-main underline dark:text-primary-light" :disabled="busy" @click="download('/api/finance-intake/documents/' + p.documentId + '/file', p.fileName)">{{ p.fileName }}</button> · {{ p.sheet }} · {{ p.row }}行目</li>
        </ul>
      </section>

      <section class="card p-4 sm:p-6" aria-label="履歴">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">履歴</h2>
        <ol class="mt-2 space-y-3">
          <li v-for="(h, i) in history" :key="i" class="text-sm" data-history>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ when(h.at) }} · {{ kindLabel(h.kind) }}<span v-if="h.source"> · {{ h.source.fileName }} / {{ h.source.sheet }} / {{ h.source.row }}行目</span><span v-if="h.name"> · {{ h.name }}</span><span v-if="h.kind === 'research'"> · {{ h.verified ? '国税庁API照合あり' : '公的照合なし' }}</span></p>
            <ul v-if="h.changes?.length" class="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-gray-300"><li v-for="c in h.changes" :key="c.field">{{ labelOf(c.field) }}: {{ c.before || '（空）' }} → {{ c.after || '（空）' }}</li></ul>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Info, Loader2, Upload } from 'lucide-vue-next'
import { FIELDS, FIELD_NAMES, STATES, STATE_NAMES } from '~/shared/finance-intake.mjs'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import IntakePaymentMatches from '~/components/intake/IntakePaymentMatches.vue'
definePageMeta({ middleware: 'auth' })
const user = useUserStore(), route = useRoute(), recordId = String(route.params.id), endpoint = '/api/finance-intake/records/' + recordId
const assistant = useAssistantStore()
const record = ref<any>(null), loading = ref(true), busy = ref(false), error = ref(''), message = ref(''), conflict = ref(false)
const form = reactive<Record<string, string>>(Object.fromEntries(FIELDS.map(f => [f[0], ''])))
const extraForm = reactive<Record<string, string>>({}), extraNames = ref<string[]>([]), newExtraName = ref('')
const title = computed(() => record.value ? (record.value.values.description || record.value.values.orderId || '受付') : '購入受付')
useHead({ title: computed(() => title.value + ' | 購入受付 | OhMyFinance') })
const dirty = computed(() => !!record.value && (FIELDS.some(([k]) => (form[k] || '') !== (record.value.values[k] || '')) || extraNames.value.some(n => (extraForm[n] || '') !== (record.value.extra?.[n] || ''))))
const history = computed(() => [...(record.value?.history || [])].reverse())
const sizeOf = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const when = (at: string) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleString('ja-JP') : at }
const kindLabel = (kind: string) => ({ new: '受付', edit: '編集', update: '取込で更新', archive: 'アーカイブ', restore: '元に戻す', attachment: '添付', research: '会社・T番号の調査' } as Record<string, string>)[kind] || kind
const labelOf = (field: string) => field.startsWith('extra:') ? field.slice(6) : (FIELD_NAMES as Record<string, string>)[field] || field
function errorMessage(e: any) { return e.data?.data?.message || e.data?.statusMessage || e.message || '処理に失敗しました。再試行してください。' }
function receive(data: any) { record.value = data; reset() }
function reset() {
  for (const [k] of FIELDS) form[k] = record.value?.values[k] || ''
  const stored: Record<string, string> = record.value?.extra || {}
  for (const k of Object.keys(extraForm)) delete extraForm[k]
  extraNames.value = Object.keys(stored); for (const n of extraNames.value) extraForm[n] = stored[n] || ''
}
function addExtra() { const name = newExtraName.value.trim(); if (!name || extraNames.value.includes(name)) { newExtraName.value = ''; return } extraNames.value = [...extraNames.value, name]; extraForm[name] = ''; newExtraName.value = '' }
async function run(action: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = ''; conflict.value = false
  try { await action() }
  catch (e: any) { error.value = errorMessage(e); conflict.value = (e.statusCode || e.status) === 409; if (conflict.value) { try { record.value = await $fetch(endpoint, { headers: user.authHeader }) } catch {} } }
  finally { busy.value = false }
}
async function load() { loading.value = true; await run(async () => receive(await $fetch(endpoint, { headers: user.authHeader }))); loading.value = false; await loadResearch() }
// Receipts identify affected records; they are not a replacement for fresh state. Keep the old revision and local
// form together while the user edits, so a later save cannot silently overwrite a newer Navi change.
watch(() => assistant.intakeSavedSequence, async () => {
  const relevant = (assistant.intakeSaved?.receipts || []).filter((a: any) => a.nativeResourceIds?.recordId === recordId || a.name === 'apply_intake_import')
  if (!relevant.length || !record.value) return
  if (relevant.every((a: any) => a.name === 'start_intake_research')) { await loadResearch(); return }
  try {
    const fresh: any = await $fetch(endpoint, { headers: user.authHeader })
    if (fresh.revision !== record.value?.revision) {
      if (!dirty.value && !busy.value) receive(fresh)
      else { error.value = 'OMFが保存内容を更新しました。編集中の内容は保持しています。確認するには再読み込みしてください。'; conflict.value = true }
    }
    await loadResearch()
  }
  catch (e) { error.value = errorMessage(e) }
})
async function save() {
  await run(async () => {
    const values: Record<string, string> = {}; for (const [k] of FIELDS) if ((form[k] || '') !== (record.value.values[k] || '')) values[k] = form[k]
    const extra: Record<string, string> = {}; for (const n of extraNames.value) if ((extraForm[n] || '') !== (record.value.extra?.[n] || '')) extra[n] = extraForm[n]
    receive(await $fetch(endpoint, { method: 'PATCH', headers: user.authHeader, body: { revision: record.value.revision, values, extra } })); message.value = '保存しました。'
  })
  await loadResearch()
}
async function archive(archived: boolean) { await run(async () => { receive(await $fetch(endpoint + '/archive', { method: 'PUT', headers: user.authHeader, body: { revision: record.value.revision, archived } })); message.value = archived ? 'アーカイブしました。' : '元に戻しました。' }) }
async function attach(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return
  await run(async () => { if (file.size > 10 * 1024 * 1024) throw Error('ファイルは10MB以内で選択してください。'); receive(await $fetch(endpoint + '/documents', { method: 'POST', query: { name: file.name, kind: 'attachment' }, headers: { ...user.authHeader, 'Content-Type': file.type || 'application/octet-stream' }, body: file })); message.value = 'ファイルを添付しました。' })
  input.value = ''
}
async function download(url: string, name: string) {
  await run(async () => {
    if (!/^\/api\/finance-intake\/documents\/[a-f\d]{24}\/file$/.test(url)) throw Error('書類の保存先を確認できません。')
    const blob: any = await $fetch(url, { headers: user.authHeader, responseType: 'blob' })
    const objectUrl = URL.createObjectURL(blob), link = document.createElement('a'); link.href = objectUrl; link.download = name || 'document'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  })
}
// ── 会社・登録番号の調査 (the record's URL through the research worker; PurchaseResearch.vue poll pattern) ──────────────────
const researchData = ref<any>(null), researchError = ref(''), researchInstruction = ref('')
const research = computed(() => researchData.value?.research || null)
const researchPending = computed(() => ['queued', 'working'].includes(research.value?.state))
const researchStateLabel = computed(() => ({ queued: '順番待ち', working: '調査中', ready: '確認できます', confirmed: '保存済み', failed: '再実行できます' } as Record<string, string>)[research.value?.state] || '')
const researchStageLabel = computed(() => ({ web: '公開情報を確認しています。', mail: '購入メールを照合しています。', document: '書類を読んでいます。', registry: '登録情報を照合しています。' } as Record<string, string>)[research.value?.events?.at(-1)?.stage] || '根拠を集めて整理しています。')
// F4 fold: every registry line names its 基準日; a check made as of another date than the current 購入日 is not a verification of it.
const registryText = computed(() => { const r = research.value, b = researchData.value?.attribution?.registryBasis; if (!r?.registry) return '国税庁API照合: 未照合（接続設定なし）'; if (b && !b.current) return '国税庁API照合: 基準日 ' + r.registry.asOf + ' の照合です。現在の購入日 ' + b.purchaseDate + ' では未確認です。'; return r.verified ? '国税庁API照合: 登録あり（基準日 ' + r.registry.asOf + '）' : '国税庁API照合: 照合不一致（基準日 ' + r.registry.asOf + '）' })
const failureText = (failure: string) => ({ not_claimed: '調査担当が10分以内に受け付けませんでした。再実行できます。', worker_lost: '調査担当との接続が途中で切れました。再実行できます。' } as Record<string, string>)[failure] || '会社・登録番号を特定できませんでした。'
const sourceOf = (id: string) => research.value?.sources?.find((s: any) => s.id === id)
// F4 (plan omf-monthly-reconciliation-20261020): which of URL / 会社名 / T番号 differ from what the confirmed research supported.
const changedText = computed(() => { const names: Record<string, string> = { merchantUrl: 'URL', supplierName: '会社名', invoiceNumber: 'T番号', purchaseDate: '購入日' }; const d = (researchData.value?.attribution?.differs || []).map((f: string) => names[f] || f); return d.length ? d.join('・') : 'URL・会社名・T番号' })
const requestId = () => { const h = Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join(''); return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-') }
let researchSequence = 0, disposed = false
async function loadResearch() {
  if (!record.value) return
  const ticket = ++researchSequence
  try { const result: any = await $fetch(endpoint + '/research', { headers: user.authHeader }); if (!disposed && ticket === researchSequence) { researchData.value = result; researchError.value = '' } }
  catch (e: any) { if (!disposed && ticket === researchSequence) researchError.value = errorMessage(e) }
}
async function researchAction(fn: () => Promise<void>) { busy.value = true; researchError.value = ''; try { await fn() } catch (e: any) { researchError.value = errorMessage(e); if ((e.statusCode || e.status) === 409) await loadResearch() } finally { busy.value = false } }
async function startResearch() { await researchAction(async () => { researchSequence++; researchData.value = await $fetch(endpoint + '/research', { method: 'POST', headers: user.authHeader, body: { revision: record.value.revision, researchRevision: research.value?.revision || 0, requestId: requestId(), instruction: researchInstruction.value } }) }) }
async function confirmResearch() { await researchAction(async () => { researchSequence++; const result: any = await $fetch(endpoint + '/research/confirm', { method: 'POST', headers: user.authHeader, body: { revision: record.value.revision, researchRevision: research.value.revision, confirm: true } }); const { record: saved, ...view } = result; receive(saved); researchData.value = view; message.value = '会社名と登録番号を受付に保存しました。' }) }
let researchTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { load(); researchTimer = setInterval(() => { if (researchPending.value && !busy.value) loadResearch() }, 4000) })
onBeforeUnmount(() => { disposed = true; researchSequence++; clearInterval(researchTimer) })
</script>

<style>
.intake-detail .intake-control {
  @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60;
}
</style>

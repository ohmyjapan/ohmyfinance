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
        <div class="mt-4 flex flex-wrap gap-3">
          <button type="button" class="btn btn-primary text-sm" :disabled="busy || record.archived || !dirty" data-save @click="save">保存</button>
          <button type="button" class="btn btn-secondary text-sm" :disabled="!dirty" @click="reset">入力を元に戻す</button>
        </div>
      </section>

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
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ when(h.at) }} · {{ kindLabel(h.kind) }}<span v-if="h.source"> · {{ h.source.fileName }} / {{ h.source.sheet }} / {{ h.source.row }}行目</span><span v-if="h.name"> · {{ h.name }}</span></p>
            <ul v-if="h.changes?.length" class="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-gray-300"><li v-for="c in h.changes" :key="c.field">{{ FIELD_NAMES[c.field] }}: {{ c.before || '（空）' }} → {{ c.after || '（空）' }}</li></ul>
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
definePageMeta({ middleware: 'auth' })
const user = useUserStore(), route = useRoute(), recordId = String(route.params.id), endpoint = '/api/finance-intake/records/' + recordId
const record = ref<any>(null), loading = ref(true), busy = ref(false), error = ref(''), message = ref(''), conflict = ref(false)
const form = reactive<Record<string, string>>(Object.fromEntries(FIELDS.map(f => [f[0], ''])))
const title = computed(() => record.value ? (record.value.values.description || record.value.values.orderId || '受付') : '購入受付')
useHead({ title: computed(() => title.value + ' | 購入受付 | OhMyFinance') })
const dirty = computed(() => !!record.value && FIELDS.some(([k]) => (form[k] || '') !== (record.value.values[k] || '')))
const history = computed(() => [...(record.value?.history || [])].reverse())
const sizeOf = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const when = (at: string) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleString('ja-JP') : at }
const kindLabel = (kind: string) => ({ new: '受付', edit: '編集', update: '取込で更新', archive: 'アーカイブ', restore: '元に戻す', attachment: '添付' } as Record<string, string>)[kind] || kind
function errorMessage(e: any) { return e.data?.data?.message || e.data?.statusMessage || e.message || '処理に失敗しました。再試行してください。' }
function receive(data: any) { record.value = data; reset() }
function reset() { for (const [k] of FIELDS) form[k] = record.value?.values[k] || '' }
async function run(action: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = ''; conflict.value = false
  try { await action() }
  catch (e: any) { error.value = errorMessage(e); conflict.value = (e.statusCode || e.status) === 409; if (conflict.value) { try { record.value = await $fetch(endpoint, { headers: user.authHeader }) } catch {} } }
  finally { busy.value = false }
}
async function load() { loading.value = true; await run(async () => receive(await $fetch(endpoint, { headers: user.authHeader }))); loading.value = false }
async function save() {
  await run(async () => {
    const values: Record<string, string> = {}; for (const [k] of FIELDS) if ((form[k] || '') !== (record.value.values[k] || '')) values[k] = form[k]
    receive(await $fetch(endpoint, { method: 'PATCH', headers: user.authHeader, body: { revision: record.value.revision, values } })); message.value = '保存しました。'
  })
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
onMounted(load)
</script>

<style>
.intake-detail .intake-control {
  @apply block w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-primary-main focus:ring-primary-main dark:border-white/10 dark:bg-white/5 dark:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60;
}
</style>

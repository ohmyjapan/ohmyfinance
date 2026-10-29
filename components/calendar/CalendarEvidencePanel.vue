<template>
  <div data-calendar-evidence-panel class="mt-4 border-t dark:border-white/10 pt-4 space-y-4">
    <!-- The owner's verification statement about this saved row's bank settlement: its own route beside the form's save; never the
         lifecycle status, never a bank match. -->
    <div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('paymentModal.verification.title') }}</span>
        <span :data-calendar-verification-state="verification?.state || 'none'" :class="['text-[10px] font-medium px-1.5 py-0.5 rounded', stateClass]">{{ stateLabel }}</span>
      </div>
      <p v-if="verification?.reason" class="mt-1 text-xs text-gray-500 dark:text-gray-400 break-words">{{ t('paymentModal.verification.reason') }}: {{ verification.reason }}<span v-if="verification.updatedAt"> · {{ formatDate(verification.updatedAt) }}</span></p>
      <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{{ t('paymentModal.verification.meaning') }}</p>
      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input v-model="reason" data-calendar-verify-reason type="text" maxlength="300" class="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white" :placeholder="t('paymentModal.verification.reasonPlaceholder')" />
        <button type="button" data-calendar-verify :disabled="busy || verifying" class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50" @click="verify">
          {{ verification?.state === 'unconfirmed' ? t('paymentModal.verification.markConfirmed') : t('paymentModal.verification.markUnconfirmed') }}
        </button>
      </div>
      <p v-if="verifyError" role="alert" class="mt-1 text-xs text-error-main">{{ verifyError }}</p>
    </div>

    <!-- The supplier originals linked to this row: identity, the active version's files and email text, superseded versions collapsed. -->
    <div>
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('paymentModal.evidence.title') }}</span>
      <p v-if="loading" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('paymentModal.evidence.loading') }}</p>
      <p v-else-if="error" role="alert" class="mt-1 text-xs text-error-main">{{ error }}</p>
      <p v-else-if="!evidence.length" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('paymentModal.evidence.none') }}</p>
      <div v-for="item in evidence" :key="item.id" :data-calendar-evidence-item="item.id" class="mt-2 rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2">
        <div class="text-sm font-medium text-gray-900 dark:text-white break-words">{{ item.invoiceNumber }} <span class="text-xs font-normal text-gray-500 dark:text-gray-400">{{ item.supplier }}</span></div>
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('paymentModal.evidence.period') }}: {{ item.servicePeriod.from }} – {{ item.servicePeriod.to }} · {{ item.currency }}</div>
        <template v-if="item.active">
          <div class="text-xs text-gray-500 dark:text-gray-400"><span v-if="item.active.issuedOn">{{ t('paymentModal.evidence.issuedOn') }}: {{ item.active.issuedOn }} · </span>{{ t('paymentModal.evidence.receivedAt') }}: {{ formatDate(item.active.receivedAt) }}</div>
          <ul class="space-y-1">
            <li v-for="file in item.active.files" :key="file.fileId" :data-calendar-evidence-file="file.fileId" class="flex flex-wrap items-center gap-2 text-xs">
              <span class="min-w-0 flex-1 break-all text-gray-700 dark:text-gray-300">{{ file.name }} <span class="text-gray-400">({{ Math.ceil(file.size / 1024) }} KB)</span></span>
              <button type="button" :data-calendar-evidence-open="file.fileId" :disabled="busy" class="px-2 py-1 rounded border border-gray-300 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50" @click="open(item.id, file)">{{ t('paymentModal.evidence.open') }}</button>
              <button type="button" :data-calendar-evidence-download="file.fileId" :disabled="busy" class="px-2 py-1 rounded border border-gray-300 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50" @click="download(item.id, file)">{{ t('paymentModal.evidence.download') }}</button>
            </li>
          </ul>
          <button v-if="item.active.email?.text" type="button" class="text-xs text-primary-main underline" @click="toggleEmail(item.id)">{{ showEmail.has(item.id) ? t('paymentModal.evidence.hideEmail') : t('paymentModal.evidence.showEmail') }}</button>
          <pre v-if="showEmail.has(item.id)" data-calendar-evidence-email class="whitespace-pre-wrap break-words text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 rounded p-2 max-h-48 overflow-y-auto">{{ item.active.email.text }}</pre>
        </template>
        <div v-if="item.versions.length" data-calendar-evidence-versions>
          <button type="button" class="text-xs text-gray-500 dark:text-gray-400 underline" @click="toggleVersions(item.id)">{{ showVersions.has(item.id) ? t('paymentModal.evidence.hideVersions') : t('paymentModal.evidence.showVersions') }} ({{ item.versions.length }})</button>
          <ul v-if="showVersions.has(item.id)" class="mt-1 space-y-1">
            <li v-for="version in item.versions" :key="version.id" class="text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('paymentModal.evidence.superseded') }} · {{ formatDate(version.receivedAt) }}<span v-if="version.totalAmount !== null"> · {{ version.totalAmount }}</span></span>
              <span v-if="version.supersededReason" class="block break-words">{{ version.supersededReason }}</span>
              <span v-for="file in version.files" :key="file.fileId" class="block"><button type="button" class="underline" :disabled="busy" @click="open(item.id, file)">{{ file.name }}</button></span>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <span v-if="busy" data-calendar-evidence-busy class="hidden" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Payment } from '~/types/calendar'
import { useUserStore } from '~/stores/user'
import { useCalendarStore } from '~/stores/calendar'

type EvidenceFile = { fileId: string; name: string; mimeType: string; size: number; kind: string }
const props = defineProps<{ payment: Payment }>()
const emit = defineEmits<{ (e: 'verify', data: { state: 'unconfirmed' | 'owner_confirmed'; reason: string }): void }>()
const { t, locale } = useI18n()
const user = useUserStore(), calendarStore = useCalendarStore()
const loading = ref(false), error = ref(''), evidence = ref<any[]>([]), verification = ref<any>(null)
const reason = ref(''), busy = ref(false), verifying = ref(false), verifyError = ref('')
const showEmail = ref(new Set<string>()), showVersions = ref(new Set<string>())
const toggleEmail = (id: string) => { const next = new Set(showEmail.value); next.has(id) ? next.delete(id) : next.add(id); showEmail.value = next }
const toggleVersions = (id: string) => { const next = new Set(showVersions.value); next.has(id) ? next.delete(id) : next.add(id); showVersions.value = next }
const stateLabel = computed(() => verification.value ? t(`paymentModal.verification.states.${verification.value.state}`) : t('paymentModal.verification.none'))
const stateClass = computed(() => verification.value?.state === 'unconfirmed' ? 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-300' : verification.value?.state === 'owner_confirmed' ? 'bg-success-light dark:bg-success-dark/30 text-success-dark dark:text-success-light' : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400')
// Fixed texts by refusal: no server message is echoed.
const errorKey = (status: unknown) => status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'failed'
const errorText = (e: any) => t(`paymentModal.evidence.errors.${errorKey(e?.statusCode || e?.status || e?.response?.status)}`)
const formatDate = (value: string | null) => { if (!value) return ''; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale.value === 'ko' ? 'ko-KR' : 'ja-JP') : '' }
let ticket = 0
async function load() {
  const id = props.payment?.id
  if (!id) return
  const stamp = ++ticket
  loading.value = true; error.value = ''
  try {
    const r: any = await $fetch(`/api/payments/${id}/evidence`, { headers: user.authHeader })
    if (stamp !== ticket || r?.payment?.id !== id) return
    evidence.value = Array.isArray(r.evidence) ? r.evidence : []
    verification.value = r.verification || null
  } catch (e: any) { if (stamp === ticket) error.value = errorText(e) } finally { if (stamp === ticket) loading.value = false }
}
// A new row, or the row replaced by the page after a saved verification: read the saved record again.
watch(() => [props.payment?.id, props.payment?.updatedAt], () => { verifying.value = false; verifyError.value = ''; reason.value = ''; load() }, { immediate: true })
// The page runs the store action; a refusal reaches the store's error while this panel's request is in flight and is shown here as a fixed text.
watch(() => calendarStore.error, (message) => { if (!verifying.value || !message) return; const status = Number((/\b(403|404|409)\b/.exec(String(message)) || [])[1]); verifyError.value = t(`paymentModal.evidence.errors.${errorKey(status || 500)}`); verifying.value = false })
function verify() {
  verifying.value = true; verifyError.value = ''
  emit('verify', { state: verification.value?.state === 'unconfirmed' ? 'owner_confirmed' : 'unconfirmed', reason: reason.value.trim() })
}
const fetchBlob = (evidenceId: string, file: EvidenceFile) => $fetch<Blob>(`/api/calendar-evidence/${evidenceId}/files/${file.fileId}`, { headers: user.authHeader, responseType: 'blob' })
async function open(evidenceId: string, file: EvidenceFile) {
  busy.value = true; error.value = ''
  try { const blob = await fetchBlob(evidenceId, file); const objectUrl = URL.createObjectURL(blob); window.open(objectUrl, '_blank'); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000) }
  catch (e: any) { error.value = errorText(e) } finally { busy.value = false }
}
async function download(evidenceId: string, file: EvidenceFile) {
  busy.value = true; error.value = ''
  try { const blob = await fetchBlob(evidenceId, file); const objectUrl = URL.createObjectURL(blob), link = document.createElement('a'); link.href = objectUrl; link.download = file.name || 'original'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }
  catch (e: any) { error.value = errorText(e) } finally { busy.value = false }
}
</script>

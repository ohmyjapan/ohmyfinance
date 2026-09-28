import { ref, computed, watch, onScopeDispose } from 'vue'
import { useUserStore } from '~/stores/user'
import type { Receipt, ReceiptMatchCandidate } from '~/types/receipt'

interface Filters {
  status?: string; type?: string; dateFrom?: string; dateTo?: string
  minAmount?: string | number; maxAmount?: string | number
  merchant?: string; transactionId?: string
}

/** Receipt workspace state belongs to this mounted company/session context. */
export function useReceipts() {
  const user = useUserStore()
  const receipts = ref<Receipt[]>([]), currentReceipt = ref<Receipt | null>(null)
  const matchCandidates = ref<ReceiptMatchCandidate[]>([]), selectedMatchCandidate = ref<string | null>(null)
  const isLoading = ref(false), isSaving = ref(false), hasLoaded = ref(false), error = ref<string | null>(null)
  const filters = ref<Filters>({}), searchQuery = ref('')
  let epoch = 0, listRequest = 0, detailRequest = 0, candidateRequest = 0
  const context = () => user.authHeader.Authorization
  const reset = () => {
    epoch++; listRequest++; detailRequest++; candidateRequest++
    receipts.value = []; currentReceipt.value = null; matchCandidates.value = []; hasLoaded.value = false
    selectedMatchCandidate.value = null; error.value = null; isLoading.value = false; isSaving.value = false
    filters.value = {}; searchQuery.value = ''
  }
  watch(context, reset, { flush: 'sync' })
  onScopeDispose(reset)
  const remember = (receipt: Receipt) => {
    const index = receipts.value.findIndex(r => r.id === receipt.id)
    if (index < 0) receipts.value.unshift(receipt)
    else receipts.value[index] = receipt
    if (currentReceipt.value?.id === receipt.id) currentReceipt.value = receipt
  }
  const failure = (err: any) => err?.data?.message || err?.data?.statusMessage || err?.message || 'Receipt request failed'
  async function fetchReceipts() {
    const generation = epoch, request = ++listRequest, headers = user.authHeader
    isLoading.value = true; error.value = null
    try {
      const result = await $fetch<{ receipts: Receipt[] }>('/api/receipts', { headers })
      if (generation !== epoch || request !== listRequest) return false
      receipts.value = result.receipts; hasLoaded.value = true
      return true
    } catch (err) {
      if (generation === epoch && request === listRequest) { receipts.value = []; hasLoaded.value = false; error.value = failure(err) }
      return false
    } finally { if (generation === epoch && request === listRequest) isLoading.value = false }
  }
  async function fetchReceiptById(id: string) {
    const generation = epoch, request = ++detailRequest, headers = user.authHeader
    currentReceipt.value = null; error.value = null
    try {
      const receipt = await $fetch<Receipt>('/api/receipts/' + id, { headers })
      if (generation !== epoch || request !== detailRequest) return null
      currentReceipt.value = receipt
      return receipt
    } catch (err) { if (generation === epoch && request === detailRequest) error.value = failure(err); return null }
  }
  async function save<T>(operation: (headers: Record<string, string>) => Promise<T>, apply: (result: T) => void): Promise<T | null> {
    if (isSaving.value) return null
    const generation = epoch, headers = user.authHeader
    isSaving.value = true; error.value = null
    listRequest++; detailRequest++; candidateRequest++; isLoading.value = false
    try {
      const result = await operation(headers)
      if (generation !== epoch) return null
      listRequest++; detailRequest++; candidateRequest++; isLoading.value = false
      apply(result)
      return result
    } catch (err) {
      if (generation === epoch) error.value = failure(err)
      return null
    } finally { if (generation === epoch) isSaving.value = false }
  }
  async function uploadReceipt(file: File) {
    const body = new FormData(); body.append('file', file)
    const result = await save(headers => $fetch<{ receipt: Receipt }>('/api/receipts/upload', { method: 'POST', headers, body }), r => remember(r.receipt))
    return result?.receipt || null
  }
  async function deleteReceipt(id: string) {
    return !!await save(headers => $fetch<{ success: boolean }>('/api/receipts/' + id, { method: 'DELETE', headers }), () => {
      receipts.value = receipts.value.filter(r => r.id !== id)
      if (currentReceipt.value?.id === id) currentReceipt.value = null
    })
  }
  async function changeLink(id: string, transactionId: string, method: 'POST' | 'DELETE', expectedVersion?: number) {
    const receipt = currentReceipt.value?.id === id ? currentReceipt.value : receipts.value.find(r => r.id === id)
    if (!receipt) return false
    return !!await save(headers => $fetch<{ receipt: Receipt }>('/api/receipts/' + id + '/match', {
      method, headers, body: { transactionId, linkVersion: expectedVersion ?? receipt.linkVersion ?? 0 }
    }), r => remember(r.receipt))
  }
  const matchWithTransaction = (id: string, transactionId: string, expectedVersion?: number) => changeLink(id, transactionId, 'POST', expectedVersion)
  const unmatchReceipt = (id: string) => {
    const receipt = currentReceipt.value?.id === id ? currentReceipt.value : receipts.value.find(r => r.id === id)
    return changeLink(id, receipt?.transactionId || '', 'DELETE')
  }
  const updateReceiptMetadata = (id: string, body: Partial<Receipt>) =>
    save(headers => $fetch<Receipt>('/api/receipts/' + id, { method: 'PATCH', headers, body }), remember)
  async function findMatchCandidates(id: string) {
    const generation = epoch, request = ++candidateRequest, headers = user.authHeader
    matchCandidates.value = []; selectedMatchCandidate.value = null; error.value = null
    try {
      const result = await $fetch<{ matches: ReceiptMatchCandidate[] }>('/api/receipts/' + id + '/matches', { headers })
      if (generation !== epoch || request !== candidateRequest) return []
      matchCandidates.value = result.matches
      return result.matches
    } catch (err) { if (generation === epoch && request === candidateRequest) error.value = failure(err); return [] }
  }
  const receiptStats = computed(() => {
    const total = receipts.value.length, matched = receipts.value.filter(r => r.status === 'matched').length
    return { total, matched, unmatched: receipts.value.filter(r => r.status === 'unmatched').length,
      matchRate: total ? Math.round(matched / total * 1000) / 10 : 0 }
  })
  const filteredReceipts = computed(() => receipts.value.filter(receipt => {
    const f = filters.value, name = receipt.originalFilename || receipt.filename
    const search = searchQuery.value.toLowerCase()
    if (search && ![name, receipt.merchant, receipt.amount, receipt.transactionId].some(v => String(v ?? '').toLowerCase().includes(search))) return false
    if (f.status && receipt.status !== f.status) return false
    if (f.type) {
      const extension = name.split('.').pop()?.toLowerCase()
      const mime = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[f.type]
      if (receipt.mimeType ? receipt.mimeType !== mime : extension !== f.type && !(f.type === 'jpg' && extension === 'jpeg')) return false
    }
    if (f.dateFrom && new Date(receipt.uploadDate) < new Date(f.dateFrom + 'T00:00:00')) return false
    if (f.dateTo && new Date(receipt.uploadDate) > new Date(f.dateTo + 'T23:59:59.999')) return false
    if (f.minAmount !== undefined && f.minAmount !== '' && (receipt.amount == null || receipt.amount < Number(f.minAmount))) return false
    if (f.maxAmount !== undefined && f.maxAmount !== '' && (receipt.amount == null || receipt.amount > Number(f.maxAmount))) return false
    if (f.merchant && !(receipt.merchant || '').toLowerCase().includes(f.merchant.toLowerCase())) return false
    if (f.transactionId && receipt.transactionId !== f.transactionId) return false
    return true
  }))
  const resetFilters = () => { filters.value = {}; searchQuery.value = '' }
  return { receipts, currentReceipt, matchCandidates, selectedMatchCandidate, isLoading, isSaving, hasLoaded, error,
    filters, searchQuery, receiptStats, filteredReceipts, fetchReceipts, fetchReceiptById, uploadReceipt,
    deleteReceipt, findMatchCandidates, matchWithTransaction, unmatchReceipt, updateReceiptMetadata, resetFilters }
}

import { ref, computed, watch, onScopeDispose } from 'vue'
import { useUserStore } from '~/stores/user'
import { manualDraftStore, draftOwner, sameDraftPayload, type ManualDraft } from '~/utils/manualDraftStore'
import type { Transaction, TransactionStatus, TransactionFilters, TransactionStats } from '~/types/transaction'

/** Each mounted workspace owns its company/session requests and confirmed state. */
export function useTransactions() {
    const userStore = useUserStore()
    const { t } = useI18n()
    const draftRecord = ref<ManualDraft | null>(null), pendingDrafts = ref<ManualDraft[]>([])
    const draftNotice = ref(''), draftError = ref('')
    const transactions = ref<Transaction[]>([]), currentTransaction = ref<Transaction | null>(null)
    const isLoading = ref(false), isSaving = ref(false), error = ref<string | null>(null), saveError = ref<string | null>(null)
    const saveOutcomeUnknown = ref(false), filters = ref<TransactionFilters>({}), searchQuery = ref('')
    const contextKey = computed(() => JSON.stringify([userStore.sessionId, userStore.isAuthenticated, userStore.user?.id, userStore.currentOrganization?.id || userStore.currentOrganization?._id]))
    const canEdit = computed(() => ['owner', 'admin', 'member'].includes(userStore.currentOrganization?.role))
    let epoch = 0, listRequest = 0, detailRequest = 0, draftRequest = 0, draftLoadRequest = 0, alive = true
    let draftSettlementFailed = false
    const owner = () => draftOwner(userStore.user?.id || '', userStore.currentOrganization?.id || userStore.currentOrganization?._id || '')
    const invalidateReads = () => { listRequest++; detailRequest++; isLoading.value = false }
    const clearCurrent = () => { epoch++; invalidateReads(); currentTransaction.value = null; error.value = null; isSaving.value = false; clearSaveError() }
    const clearSaveError = () => { saveError.value = null; saveOutcomeUnknown.value = false }
    const reset = () => {
        epoch++; invalidateReads(); transactions.value = []; currentTransaction.value = null
        error.value = null; clearSaveError(); isSaving.value = false; filters.value = {}; searchQuery.value = ''
        draftRequest++; draftLoadRequest++; draftRecord.value = null; pendingDrafts.value = []; draftNotice.value = ''; draftError.value = ''
        draftSettlementFailed = false
    }
    watch(contextKey, reset, { flush: 'sync' })
    onScopeDispose(() => { alive = false; reset() })
    const failure = (err: any) => err?.data?.message || err?.data?.statusMessage || err?.message || 'Transaction request failed'
    const normalize = (row: any): Transaction => ({ ...row, id: row.id || String(row._id || ''), date: row.date || '', createdAt: row.createdAt || '', items: row.items || [], timeline: row.timeline || [], hasReceipt: !!row.hasReceipt })
    const remember = (row: any) => {
        const record = normalize(row), index = transactions.value.findIndex(t => t.id === record.id)
        if (index < 0) transactions.value.unshift(record)
        else transactions.value[index] = record
        if (currentTransaction.value?.id === record.id) currentTransaction.value = record
    }
    const fetchTransactions = () => readTransactions(false)
    async function readTransactions(retainConfirmed: boolean) {
        if (!alive) return false
        const generation = epoch, request = ++listRequest, headers = { ...userStore.authHeader }
        isLoading.value = true; error.value = null
        try {
            const response = await $fetch<{ transactions: any[] }>('/api/transactions', { headers, retry: 0 })
            if (generation !== epoch || request !== listRequest) return false
            transactions.value = response.transactions.map(normalize)
            return true
        } catch (err) {
            if (generation === epoch && request === listRequest) { if (!retainConfirmed) transactions.value = []; error.value = failure(err) }
            return false
        } finally { if (generation === epoch && request === listRequest) isLoading.value = false }
    }
    async function fetchTransactionById(id: string) {
        if (!alive) return null
        const generation = epoch, request = ++detailRequest, headers = { ...userStore.authHeader }
        currentTransaction.value = null; isLoading.value = true; error.value = null
        try {
            const response = await $fetch<any>('/api/transactions/' + id, { headers, retry: 0 })
            if (generation !== epoch || request !== detailRequest) return null
            currentTransaction.value = normalize(response)
            return currentTransaction.value
        } catch (err) { if (generation === epoch && request === detailRequest) error.value = failure(err); return null }
        finally { if (generation === epoch && request === detailRequest) isLoading.value = false }
    }
    async function save<T>(operation: (headers: Record<string, string>) => Promise<T>, apply: (result: T) => void, creating = false): Promise<T | null> {
        if (!alive || isSaving.value || !canEdit.value) return null
        const generation = epoch, headers = { ...userStore.authHeader }
        isSaving.value = true; clearSaveError(); invalidateReads()
        try {
            const result = await operation(headers)
            if (generation !== epoch) return null
            invalidateReads(); apply(result)
            return result
        } catch (err: any) {
            if (generation === epoch) {
                saveError.value = failure(err)
                const status = err?.statusCode || err?.response?.status
                saveOutcomeUnknown.value = creating && !err?.notSent && (!status || status >= 500 || status === 408)
            }
            return null
        } finally { if (generation === epoch) isSaving.value = false }
    }
    const snapshot = (data: any) => JSON.parse(JSON.stringify(data))
    async function refreshDrafts() {
        const generation = epoch, request = ++draftRequest, identity = owner()
        if (!alive || !userStore.isAuthenticated) return
        try {
            const rows = await manualDraftStore.list(identity)
            if (generation === epoch && request === draftRequest) { pendingDrafts.value = rows; if (!draftSettlementFailed) draftError.value = '' }
        } catch { if (generation === epoch && request === draftRequest) draftError.value = t('draftRecovery.storageError') }
    }
    async function startDraft() {
        if (!alive || !canEdit.value || isSaving.value) return null
        const generation = epoch, request = ++draftLoadRequest; isSaving.value = true; clearSaveError(); draftNotice.value = ''
        try {
            const row = await manualDraftStore.create(owner())
            if (generation !== epoch || request !== draftLoadRequest) return null
            draftRecord.value = row; return row
        } catch { if (generation === epoch) draftError.value = t('draftRecovery.storageError'); return null }
        finally { if (generation === epoch) isSaving.value = false }
    }
    async function loadDraft(key: string) {
        const generation = epoch, identity = owner(), request = ++draftLoadRequest
        if (!alive || !/^[a-f0-9]{32}$/.test(key)) return null
        try {
            const row = await manualDraftStore.get(identity, key)
            if (generation !== epoch || request !== draftLoadRequest) return null
            draftRecord.value = row
            if (!row) draftError.value = t('draftRecovery.missing')
            return row
        } catch { if (generation === epoch) draftError.value = t('draftRecovery.storageError'); return null }
    }
    async function recordOutcome(row: ManualDraft, result: any, generation: number) {
        if (!['saved', 'deleted'].includes(result?.state) || !result.transactionId || (result.state === 'saved' && (!result.transaction || String(result.transaction.id || result.transaction._id) !== result.transactionId))) throw Error(t('draftRecovery.unconfirmed'))
        let settled: ManualDraft = { ...row, state: result.state, transactionId: result.transactionId }
        try {
            settled = await manualDraftStore.settle(row.owner, row.key, row.revision, result.state, result.transactionId)
            if (generation === epoch) { draftSettlementFailed = false; draftError.value = '' }
        } catch { if (generation === epoch) { draftSettlementFailed = true; draftError.value = t('draftRecovery.confirmedStorageError') } }
        const confirmed = settled.state === 'deleted' ? { state: 'deleted', transactionId: settled.transactionId } : result
        if (generation === epoch) { draftRecord.value = settled; draftNotice.value = t('draftRecovery.' + confirmed.state); void refreshDrafts() }
        return confirmed
    }
    const createTransaction = (data: Partial<Transaction>) => {
        const body = snapshot(data), generation = epoch, identity = owner()
        return save(async headers => {
            let row: ManualDraft
            try {
                row = draftRecord.value || await manualDraftStore.create(identity)
                if (generation !== epoch) return null
                row = await manualDraftStore.freeze(identity, row.key, body)
            } catch { throw Object.assign(Error(t('draftRecovery.storageError')), { notSent: true }) }
            if (generation !== epoch) return null
            draftRecord.value = row
            if (!sameDraftPayload(row.payload, body)) throw Error(t('draftRecovery.changed'))
            void refreshDrafts()
            let result: any
            try {
                result = ['saved', 'deleted'].includes(row.state)
                    ? await $fetch<any>('/api/transactions/creation/' + row.key, { headers, retry: 0 })
                    : await $fetch<any>('/api/transactions', { method: 'POST', headers: { ...headers, 'Idempotency-Key': row.key }, body: row.payload, retry: 0 })
            } catch (err: any) {
                if ((err?.statusCode || err?.response?.status) === 400) {
                    try {
                        const rejected = await manualDraftStore.settle(identity, row.key, row.revision, 'rejected')
                        if (generation === epoch) draftRecord.value = rejected
                    } catch { if (generation === epoch) draftError.value = t('draftRecovery.storageError') }
                }
                throw err
            }
            return recordOutcome(row, result, generation)
        }, result => {
            if (result?.state === 'saved') remember(result.transaction)
            if (result?.state === 'deleted') transactions.value = transactions.value.filter(row => row.id !== result.transactionId)
        }, true)
    }
    async function recoverDraft(key: string) {
        if (!alive || !userStore.isAuthenticated || isSaving.value) return null
        const generation = epoch, identity = owner(), headers = { ...userStore.authHeader }
        isSaving.value = true; clearSaveError(); invalidateReads(); draftNotice.value = ''
        try {
            const row = await manualDraftStore.get(identity, key)
            if (generation !== epoch || !row?.payload) return null
            const result = await $fetch<any>('/api/transactions/creation/' + row.key, { headers, retry: 0 })
            if (generation !== epoch) return null
            if (result.state === 'absent') {
                draftRecord.value = row; draftNotice.value = t('draftRecovery.absent'); return result
            }
            const confirmed = await recordOutcome(row, result, generation)
            if (generation !== epoch) return null
            invalidateReads()
            if (confirmed.state === 'saved') remember(confirmed.transaction)
            if (confirmed.state === 'deleted') transactions.value = transactions.value.filter(item => item.id !== confirmed.transactionId)
            // Recovery may have superseded the company's initial list request.
            // Refill the complete list without discarding a confirmed result if
            // this read fails; a context change still invalidates both reads.
            await readTransactions(true)
            if (generation !== epoch) return null
            return confirmed
        } catch (err) { if (generation === epoch) saveError.value = failure(err); return null }
        finally { if (generation === epoch) isSaving.value = false }
    }
    const updateTransaction = async (id: string, data: Partial<Transaction>) => {
        const body = snapshot(data)
        return !!await save(headers => $fetch<any>('/api/transactions/' + id, { method: 'PUT', headers, body, retry: 0 }), remember)
    }
    const updateTransactionStatus = async (id: string, status: TransactionStatus, notes?: string) =>
        !!await save(headers => $fetch<{ transaction: any }>('/api/transactions/' + id + '/status', { method: 'PATCH', headers, body: { status, ...(notes !== undefined ? { notes } : {}) }, retry: 0 }), result => remember(result.transaction))
    const deleteTransaction = async (id: string) =>
        !!await save(headers => $fetch<{ success: boolean }>('/api/transactions/' + id, { method: 'DELETE', headers, retry: 0 }), () => {
            transactions.value = transactions.value.filter(t => t.id !== id)
            if (currentTransaction.value?.id === id) currentTransaction.value = null
        })
    const importTransactions = async (parsedData: any[], mappings: Record<string, string>, options = {}) => {
        const generation = epoch
        const body = snapshot({ data: parsedData, mappings, options })
        const result = await save(headers => $fetch<any>('/api/transactions/import', { method: 'POST', headers, body, retry: 0 }), () => {})
        if (!result) return { success: false, error: saveError.value }
        // A failed refresh cannot turn a confirmed import into a failed write.
        await fetchTransactions()
        if (generation !== epoch) return { success: false, error: null }
        return { success: true, stats: result.results || result, transactions: result.transactions || [] }
    }

    // Get transaction statistics
    const getTransactionStats = computed((): TransactionStats => {
        const total = {
            count: transactions.value.length,
            amount: transactions.value.reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const completed = {
            count: transactions.value.filter(t => t.status === 'completed').length,
            amount: transactions.value
                .filter(t => t.status === 'completed')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const pending = {
            count: transactions.value.filter(t => t.status === 'pending').length,
            amount: transactions.value
                .filter(t => t.status === 'pending')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const processing = {
            count: transactions.value.filter(t => t.status === 'processing').length,
            amount: transactions.value
                .filter(t => t.status === 'processing')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const failed = {
            count: transactions.value.filter(t => t.status === 'failed').length,
            amount: transactions.value
                .filter(t => t.status === 'failed')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        // Japanese accounting specific
        const income = {
            count: transactions.value.filter(t => t.type === '入金').length,
            amount: transactions.value
                .filter(t => t.type === '入金')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const expense = {
            count: transactions.value.filter(t => t.type === '支出').length,
            amount: transactions.value
                .filter(t => t.type === '支出')
                .reduce((sum, t) => sum + (t.amount || 0), 0)
        }

        const avgOrderValue = total.count > 0 ? total.amount / total.count : 0

        const transactionsWithReceipt = transactions.value.filter(t => t.hasReceipt).length
        const receiptMatchRate = total.count > 0 ? transactionsWithReceipt / total.count : 0

        return {
            total,
            completed,
            pending,
            processing,
            failed,
            avgOrderValue,
            receiptMatchRate,
            income,
            expense
        }
    })

    // Apply filters to transactions
    const filteredTransactions = computed(() => {
        let result = [...transactions.value]

        // Apply search filter
        if (searchQuery.value) {
            const query = searchQuery.value.toLowerCase()
            result = result.filter(transaction =>
                transaction.id?.toLowerCase().includes(query) ||
                transaction.referenceNumber?.toLowerCase().includes(query) ||
                transaction.productName?.toLowerCase().includes(query) ||
                transaction.invoiceNumber?.toLowerCase().includes(query) ||
                transaction.companyInfo?.toLowerCase().includes(query) ||
                transaction.amount?.toString().includes(query)
            )
        }

        // Apply status filter
        if (filters.value.status) {
            result = result.filter(transaction => transaction.status === filters.value.status)
        }

        // Apply type filter (支出 or 入金)
        if (filters.value.type) {
            result = result.filter(transaction => transaction.type === filters.value.type)
        }

        // Apply date range filter
        if (filters.value.dateFrom) {
            const fromDate = new Date(filters.value.dateFrom)
            result = result.filter(transaction => new Date(transaction.date) >= fromDate)
        }

        if (filters.value.dateTo) {
            const toDate = new Date(filters.value.dateTo)
            toDate.setHours(23, 59, 59, 999) // End of the day
            result = result.filter(transaction => new Date(transaction.date) <= toDate)
        }

        // Apply amount filter
        if (filters.value.minAmount) {
            const min = typeof filters.value.minAmount === 'string'
                ? parseFloat(filters.value.minAmount)
                : filters.value.minAmount

            result = result.filter(transaction => (transaction.amount || 0) >= min)
        }

        if (filters.value.maxAmount) {
            const max = typeof filters.value.maxAmount === 'string'
                ? parseFloat(filters.value.maxAmount)
                : filters.value.maxAmount

            result = result.filter(transaction => (transaction.amount || 0) <= max)
        }

        // Filter by receipt presence
        if (filters.value.hasReceipt !== undefined) {
            result = result.filter(transaction => transaction.hasReceipt === filters.value.hasReceipt)
        }

        // Filter by customer
        if (filters.value.customerId) {
            result = result.filter(transaction => transaction.customerId === filters.value.customerId)
        }

        // Filter by supplier
        if (filters.value.supplierId) {
            result = result.filter(transaction => transaction.supplierId === filters.value.supplierId)
        }

        // Filter by account category
        if (filters.value.accountCategoryId) {
            result = result.filter(transaction => transaction.accountCategoryId === filters.value.accountCategoryId)
        }

        // Filter by transaction category
        if (filters.value.transactionCategoryId) {
            result = result.filter(transaction => transaction.transactionCategoryId === filters.value.transactionCategoryId)
        }

        return result
    })

    // Reset all filters
    const resetFilters = () => {
        filters.value = {}
        searchQuery.value = ''
    }

    // Format helpers
    const formatDate = (isoDate: string) => {
        return new Date(isoDate).toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    }

    const formatTime = (isoDate: string) => {
        return new Date(isoDate).toLocaleTimeString('ja-JP', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: false
        })
    }

    const formatCurrency = (amount: number, currency = 'JPY') => {
        return new Intl.NumberFormat('ja-JP', {
            style: 'currency',
            currency,
            currencyDisplay: 'narrowSymbol'
        }).format(amount)
    }

    return {
        draftRecord, pendingDrafts, draftNotice, draftError, refreshDrafts, startDraft, loadDraft, recoverDraft,
        contextKey, canEdit, isSaving, saveError, saveOutcomeUnknown, clearSaveError, clearCurrent,
        // State
        transactions,
        isLoading,
        error,
        currentTransaction,
        filters,
        searchQuery,

        // Computed
        filteredTransactions,
        transactionStats: getTransactionStats,

        // Methods
        fetchTransactions,
        fetchTransactionById,
        createTransaction,
        updateTransaction,
        updateTransactionStatus,
        deleteTransaction,
        importTransactions,
        resetFilters,

        // Helpers
        formatDate,
        formatTime,
        formatCurrency
    }
}

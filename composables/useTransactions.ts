import { ref, computed } from 'vue'
import { useUserStore } from '~/stores/user'
import type {
    Transaction,
    TransactionStatus,
    TransactionType,
    TransactionFilters,
    TransactionStats,
    TransactionItem,
    TimelineEvent
} from '~/types/transaction'

/**
 * Composable for managing transactions (OMF style - Japanese accounting)
 */
export function useTransactions() {
    const userStore = useUserStore()
    // State
    const transactions = ref<Transaction[]>([])
    const isLoading = ref<boolean>(false)
    const error = ref<string | null>(null)
    const currentTransaction = ref<Transaction | null>(null)
    const filters = ref<TransactionFilters>({})
    const searchQuery = ref<string>('')

    // Fetch all transactions
    const fetchTransactions = async () => {
        isLoading.value = true
        error.value = null
        userStore.initAuth()

        try {
            const response = await $fetch<any>('/api/transactions', {
                headers: userStore.authHeader
            })
            const data = response.transactions || response
            transactions.value = (Array.isArray(data) ? data : []).map(t => ({
                ...t,
                id: t.id || t._id?.toString() || '',
                date: t.date || new Date().toISOString(),
                createdAt: t.createdAt || t.date || new Date().toISOString(),
                items: t.items || [],
                timeline: t.timeline || [],
                hasReceipt: t.hasReceipt || false
            }))
        } catch (err: any) {
            error.value = err.message || 'Failed to fetch transactions'
            console.error('Error fetching transactions:', err)
        } finally {
            isLoading.value = false
        }
    }

    // Get a single transaction by ID
    const fetchTransactionById = async (id: string) => {
        isLoading.value = true
        error.value = null

        try {
            const response = await $fetch<any>(`/api/transactions/${id}`, {
                headers: userStore.authHeader
            })
            currentTransaction.value = {
                ...response,
                id: response.id || response._id?.toString() || '',
                date: response.date || new Date().toISOString(),
                createdAt: response.createdAt || response.date || new Date().toISOString(),
                items: response.items || [],
                timeline: response.timeline || [],
                hasReceipt: response.hasReceipt || false
            }
        } catch (err: any) {
            error.value = err.message || `Failed to fetch transaction ${id}`
            console.error(`Error fetching transaction ${id}:`, err)
        } finally {
            isLoading.value = false
        }
    }

    // Create a new transaction (OMF style)
    const createTransaction = async (transactionData: Partial<Transaction>) => {
        isLoading.value = true
        error.value = null
        userStore.initAuth()

        try {
            const response = await $fetch<any>('/api/transactions', {
                method: 'POST',
                headers: userStore.authHeader,
                body: transactionData
            })

            const newTransaction: Transaction = {
                ...response,
                id: response._id?.toString() || response.id,
                date: response.date || new Date().toISOString(),
                createdAt: response.createdAt || response.date || new Date().toISOString(),
                items: response.items || [],
                timeline: response.timeline || [],
                hasReceipt: response.hasReceipt || false
            }

            // Add to local state
            transactions.value.unshift(newTransaction)

            return newTransaction
        } catch (err: any) {
            error.value = err.message || 'Failed to create transaction'
            console.error('Error creating transaction:', err)
            return null
        } finally {
            isLoading.value = false
        }
    }

    // Update transaction
    const updateTransaction = async (id: string, data: Partial<Transaction>) => {
        isLoading.value = true
        error.value = null

        try {
            const response = await $fetch<any>(`/api/transactions/${id}`, {
                method: 'PUT',
                headers: userStore.authHeader,
                body: data
            })

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === id)
            if (transactionIndex !== -1) {
                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    ...response,
                    id: response.id || response._id?.toString()
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === id) {
                currentTransaction.value = {
                    ...currentTransaction.value,
                    ...response,
                    id: response.id || response._id?.toString()
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to update transaction ${id}`
            console.error(`Error updating transaction ${id}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Update transaction status
    const updateTransactionStatus = async (id: string, status: TransactionStatus, notes?: string) => {
        return updateTransaction(id, { status, notes } as Partial<Transaction>)
    }

    // Delete transaction
    const deleteTransaction = async (id: string) => {
        isLoading.value = true
        error.value = null

        try {
            await $fetch(`/api/transactions/${id}`, {
                method: 'DELETE',
                headers: userStore.authHeader
            })

            // Remove from local state
            transactions.value = transactions.value.filter(t => t.id !== id)

            // Clear current transaction if it was deleted
            if (currentTransaction.value && currentTransaction.value.id === id) {
                currentTransaction.value = null
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to delete transaction ${id}`
            console.error(`Error deleting transaction ${id}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Import transactions from file data
    const importTransactions = async (
        parsedData: any[],
        mappings: Record<string, string>,
        options: { skipDuplicates?: boolean, updateMatches?: boolean } = {}
    ) => {
        isLoading.value = true
        error.value = null

        try {
            const response = await $fetch<any>('/api/transactions/import', {
                method: 'POST',
                headers: userStore.authHeader,
                body: { data: parsedData, mappings, options }
            })

            // Refresh transactions list
            await fetchTransactions()

            return {
                success: true,
                stats: response.results || response,
                transactions: response.transactions || []
            }
        } catch (err: any) {
            error.value = err.message || 'Failed to import transactions'
            console.error('Error importing transactions:', err)
            return {
                success: false,
                error: error.value
            }
        } finally {
            isLoading.value = false
        }
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

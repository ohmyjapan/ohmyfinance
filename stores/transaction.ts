import { defineStore } from 'pinia'
import { Transaction, TransactionStatus, TransactionSource } from '~/types/transaction'

interface TransactionState {
    transactions: Transaction[]
    currentTransaction: Transaction | null
    isLoading: boolean
    error: string | null
    filters: {
        status?: string
        source?: string
        dateFrom?: string
        dateTo?: string
        minAmount?: number
        maxAmount?: number
        customer?: string
        hasReceipt?: boolean
        hasShipment?: boolean
    }
    searchQuery: string
    importStatus: {
        isImporting: boolean
        progress: number
        totalRecords: number
        processedRecords: number
        successRecords: number
        errorRecords: number
    }
}

export const useTransactionStore = defineStore('transaction', {
    state: (): TransactionState => ({
        transactions: [],
        currentTransaction: null,
        isLoading: false,
        error: null,
        filters: {},
        searchQuery: '',
        importStatus: {
            isImporting: false,
            progress: 0,
            totalRecords: 0,
            processedRecords: 0,
            successRecords: 0,
            errorRecords: 0
        }
    }),

    getters: {
        // Get filtered transactions based on search and filters
        filteredTransactions: (state) => {
            let result = [...state.transactions]

            // Apply search filter
            if (state.searchQuery) {
                const query = state.searchQuery.toLowerCase()
                result = result.filter(transaction =>
                    transaction.id.toLowerCase().includes(query) ||
                    transaction.reference.toLowerCase().includes(query) ||
                    transaction.customer.name.toLowerCase().includes(query) ||
                    transaction.customer.email.toLowerCase().includes(query) ||
                    transaction.amount.toString().includes(query)
                )
            }

            // Apply status filter
            if (state.filters.status) {
                result = result.filter(transaction => transaction.status === state.filters.status)
            }

            // Apply source filter
            if (state.filters.source) {
                result = result.filter(transaction => transaction.source === state.filters.source)
            }

            // Apply date range filter
            if (state.filters.dateFrom) {
                const fromDate = new Date(state.filters.dateFrom)
                result = result.filter(transaction => new Date(transaction.createdAt) >= fromDate)
            }

            if (state.filters.dateTo) {
                const toDate = new Date(state.filters.dateTo)
                toDate.setHours(23, 59, 59, 999) // End of the day
                result = result.filter(transaction => new Date(transaction.createdAt) <= toDate)
            }

            // Apply amount filter
            if (state.filters.minAmount !== undefined) {
                result = result.filter(transaction => transaction.amount >= state.filters.minAmount!)
            }

            if (state.filters.maxAmount !== undefined) {
                result = result.filter(transaction => transaction.amount <= state.filters.maxAmount!)
            }

            // Apply customer filter
            if (state.filters.customer) {
                const customer = state.filters.customer.toLowerCase()
                result = result.filter(transaction =>
                    transaction.customer.name.toLowerCase().includes(customer) ||
                    transaction.customer.email.toLowerCase().includes(customer)
                )
            }

            // Filter by receipt presence
            if (state.filters.hasReceipt !== undefined) {
                result = result.filter(transaction =>
                    (!!transaction.receipt) === state.filters.hasReceipt
                )
            }

            // Filter by shipment presence
            if (state.filters.hasShipment !== undefined) {
                result = result.filter(transaction =>
                    (!!transaction.shipment) === state.filters.hasShipment
                )
            }

            return result
        },

        // Get transaction statistics
        transactionStats: (state) => {
            const calculateTotal = (transactions: Transaction[]) => {
                return transactions.reduce((sum, t) => sum + t.amount, 0)
            }

            const total = {
                count: state.transactions.length,
                amount: calculateTotal(state.transactions)
            }

            const completed = {
                count: state.transactions.filter(t => t.status === 'completed').length,
                amount: calculateTotal(state.transactions.filter(t => t.status === 'completed'))
            }

            const pending = {
                count: state.transactions.filter(t => t.status === 'pending').length,
                amount: calculateTotal(state.transactions.filter(t => t.status === 'pending'))
            }

            const processing = {
                count: state.transactions.filter(t => t.status === 'processing').length,
                amount: calculateTotal(state.transactions.filter(t => t.status === 'processing'))
            }

            const failed = {
                count: state.transactions.filter(t => t.status === 'failed').length,
                amount: calculateTotal(state.transactions.filter(t => t.status === 'failed'))
            }

            const avgOrderValue = total.count > 0 ? total.amount / total.count : 0

            const transactionsWithReceipt = state.transactions.filter(t => t.receipt).length
            const receiptMatchRate = total.count > 0 ? transactionsWithReceipt / total.count : 0

            return {
                total,
                completed,
                pending,
                processing,
                failed,
                avgOrderValue,
                receiptMatchRate
            }
        },

        // Get transaction by ID
        getTransactionById: (state) => (id: string) => {
            return state.transactions.find(transaction => transaction.id === id) || null
        },

        // Check if any filters are applied
        isFiltered: (state) => {
            return (
                state.searchQuery !== '' ||
                Object.keys(state.filters).length > 0
            )
        }
    },

    actions: {
        // Fetch all transactions
        async fetchTransactions() {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/transactions')
                this.transactions = response
            } catch (err: any) {
                this.error = err.message || 'Failed to fetch transactions'
                console.error('Error fetching transactions:', err)
            } finally {
                this.isLoading = false
            }
        },

        // Fetch a transaction by ID
        async fetchTransactionById(id: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/transactions/${id}`)
                this.currentTransaction = response
                return response
            } catch (err: any) {
                this.error = err.message || `Failed to fetch transaction ${id}`
                console.error(`Error fetching transaction ${id}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Create a new transaction
        async createTransaction(data: Partial<Transaction>) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/transactions', {
                    method: 'POST',
                    body: data
                })

                // Add to local state
                this.transactions.unshift(response)
                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to create transaction'
                console.error('Error creating transaction:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Update transaction status
        async updateTransactionStatus(id: string, status: TransactionStatus, notes?: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/transactions/${id}/status`, {
                    method: 'PATCH',
                    body: { status, notes }
                })

                // Update in the array
                const index = this.transactions.findIndex(t => t.id === id)
                if (index !== -1) {
                    this.transactions[index] = { ...this.transactions[index], ...response }
                }

                // Update current transaction if it's loaded
                if (this.currentTransaction && this.currentTransaction.id === id) {
                    this.currentTransaction = { ...this.currentTransaction, ...response }
                }

                return response
            } catch (err: any) {
                this.error = err.message || `Failed to update transaction status for ${id}`
                console.error(`Error updating transaction status for ${id}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Update transaction data
        async updateTransaction(id: string, data: Partial<Transaction>) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/transactions/${id}`, {
                    method: 'PATCH',
                    body: data
                })

                // Update in the array
                const index = this.transactions.findIndex(t => t.id === id)
                if (index !== -1) {
                    this.transactions[index] = { ...this.transactions[index], ...response }
                }

                // Update current transaction if it's loaded
                if (this.currentTransaction && this.currentTransaction.id === id) {
                    this.currentTransaction = { ...this.currentTransaction, ...response }
                }

                return response
            } catch (err: any) {
                this.error = err.message || `Failed to update transaction ${id}`
                console.error(`Error updating transaction ${id}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Attach receipt to transaction
        async attachReceipt(transactionId: string, receiptId: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/transactions/${transactionId}/receipt`, {
                    method: 'PUT',
                    body: { receiptId }
                })

                // Update in the array
                const index = this.transactions.findIndex(t => t.id === transactionId)
                if (index !== -1) {
                    this.transactions[index] = { ...this.transactions[index], ...response }
                }

                // Update current transaction if it's loaded
                if (this.currentTransaction && this.currentTransaction.id === transactionId) {
                    this.currentTransaction = { ...this.currentTransaction, ...response }
                }

                return response
            } catch (err: any) {
                this.error = err.message || `Failed to attach receipt to transaction ${transactionId}`
                console.error(`Error attaching receipt to transaction ${transactionId}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Detach receipt from transaction
        async detachReceipt(transactionId: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/transactions/${transactionId}/receipt`, {
                    method: 'DELETE'
                })

                // Update in the array
                const index = this.transactions.findIndex(t => t.id === transactionId)
                if (index !== -1) {
                    this.transactions[index] = { ...this.transactions[index], receipt: null }
                }

                // Update current transaction if it's loaded
                if (this.currentTransaction && this.currentTransaction.id === transactionId) {
                    this.currentTransaction = { ...this.currentTransaction, receipt: null }
                }

                return response
            } catch (err: any) {
                this.error = err.message || `Failed to detach receipt from transaction ${transactionId}`
                console.error(`Error detaching receipt from transaction ${transactionId}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Import transactions from file
        async importTransactions(formData: FormData, options: any = {}) {
            this.importStatus = {
                isImporting: true,
                progress: 0,
                totalRecords: 0,
                processedRecords: 0,
                successRecords: 0,
                errorRecords: 0
            }
            this.error = null

            try {
                // Add options to formData
                Object.entries(options).forEach(([key, value]) => {
                    formData.append(key, value as string)
                })

                // Start import process
                const response = await $fetch('/api/transactions/import', {
                    method: 'POST',
                    body: formData,
                    // Use onProgress if available in your fetch implementation
                    onProgress: ({ loaded, total }: { loaded: number, total: number }) => {
                        if (total) {
                            this.importStatus.progress = Math.round((loaded / total) * 100)
                        }
                    }
                })

                // Update import status with response data
                if (response.stats) {
                    this.importStatus.totalRecords = response.stats.total
                    this.importStatus.processedRecords = response.stats.imported + response.stats.skipped + response.stats.updated
                    this.importStatus.successRecords = response.stats.imported + response.stats.updated
                    this.importStatus.errorRecords = response.stats.failed
                }

                // Add imported transactions to the list
                if (response.transactions) {
                    this.transactions = [...response.transactions, ...this.transactions]
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to import transactions'
                console.error('Error importing transactions:', err)
                return {
                    success: false,
                    error: this.error
                }
            } finally {
                this.importStatus.isImporting = false
            }
        },

        // Export transactions to file
        async exportTransactions(format: 'csv' | 'excel' = 'csv', filters: any = {}) {
            this.isLoading = true
            this.error = null

            try {
                // Build query parameters
                const queryParams = new URLSearchParams()
                queryParams.append('format', format)

                // Add filters to query
                Object.entries(filters).forEach(([key, value]) => {
                    if (value !== undefined && value !== null && value !== '') {
                        queryParams.append(key, String(value))
                    }
                })

                // Generate export URL
                const exportUrl = `/api/transactions/export?${queryParams.toString()}`

                // Trigger file download
                window.open(exportUrl, '_blank')

                return { success: true }
            } catch (err: any) {
                this.error = err.message || 'Failed to export transactions'
                console.error('Error exporting transactions:', err)
                return {
                    success: false,
                    error: this.error
                }
            } finally {
                this.isLoading = false
            }
        },

        // Delete a transaction
        async deleteTransaction(id: string) {
            this.isLoading = true
            this.error = null

            try {
                await $fetch(`/api/transactions/${id}`, {
                    method: 'DELETE'
                })

                // Remove from local state
                this.transactions = this.transactions.filter(t => t.id !== id)

                // Clear current transaction if it's the deleted one
                if (this.currentTransaction && this.currentTransaction.id === id) {
                    this.currentTransaction = null
                }

                return true
            } catch (err: any) {
                this.error = err.message || `Failed to delete transaction ${id}`
                console.error(`Error deleting transaction ${id}:`, err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Set search query
        setSearchQuery(query: string) {
            this.searchQuery = query
        },

        // Update filters
        updateFilters(filters: Partial<TransactionState['filters']>) {
            this.filters = { ...this.filters, ...filters }
        },

        // Reset filters
        resetFilters() {
            this.filters = {}
            this.searchQuery = ''
        }
    }
})
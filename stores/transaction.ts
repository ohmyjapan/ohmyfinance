// stores/transaction.ts (OMF style - Japanese accounting)
import { defineStore } from 'pinia'
import type { Transaction, TransactionFilters, TransactionStats } from '~/types/transaction'
import { useUserStore } from './user'

export const useTransactionStore = defineStore('transaction', {
    state: () => ({
        transactions: [] as Transaction[],
        currentTransaction: null as Transaction | null,
        isLoading: false,
        error: null as string | null,
        filters: {} as TransactionFilters,
        searchQuery: '',
        stats: {
            total: { count: 0, amount: 0 },
            completed: { count: 0, amount: 0 },
            pending: { count: 0, amount: 0 },
            processing: { count: 0, amount: 0 },
            failed: { count: 0, amount: 0 },
            avgOrderValue: 0,
            receiptMatchRate: 0,
            income: { count: 0, amount: 0 },
            expense: { count: 0, amount: 0 }
        }
    }),

    getters: {
        filteredTransactions(): Transaction[] {
            let result = [...this.transactions]

            // Apply search filter (OMF style)
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase()
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
            if (this.filters.status) {
                result = result.filter(transaction => transaction.status === this.filters.status)
            }

            // Apply type filter (支出 or 入金)
            if (this.filters.type) {
                result = result.filter(transaction => transaction.type === this.filters.type)
            }

            // Apply date range filter
            if (this.filters.dateFrom) {
                const fromDate = new Date(this.filters.dateFrom)
                result = result.filter(transaction => new Date(transaction.date) >= fromDate)
            }

            if (this.filters.dateTo) {
                const toDate = new Date(this.filters.dateTo)
                toDate.setHours(23, 59, 59, 999) // End of the day
                result = result.filter(transaction => new Date(transaction.date) <= toDate)
            }

            // Apply amount filter
            if (this.filters.minAmount) {
                const min = typeof this.filters.minAmount === 'string'
                    ? parseFloat(this.filters.minAmount)
                    : this.filters.minAmount

                result = result.filter(transaction => (transaction.amount || 0) >= min)
            }

            if (this.filters.maxAmount) {
                const max = typeof this.filters.maxAmount === 'string'
                    ? parseFloat(this.filters.maxAmount)
                    : this.filters.maxAmount

                result = result.filter(transaction => (transaction.amount || 0) <= max)
            }

            // Filter by receipt presence
            if (this.filters.hasReceipt !== undefined) {
                result = result.filter(transaction => transaction.hasReceipt === this.filters.hasReceipt)
            }

            // Filter by customer
            if (this.filters.customerId) {
                result = result.filter(transaction => transaction.customerId === this.filters.customerId)
            }

            // Filter by supplier
            if (this.filters.supplierId) {
                result = result.filter(transaction => transaction.supplierId === this.filters.supplierId)
            }

            return result
        }
    },

    actions: {
        async fetchTransactions() {
            this.isLoading = true
            this.error = null
            const userStore = useUserStore()

            try {
                const response = await $fetch<{ transactions: Transaction[], total: number }>('/api/transactions', {
                    headers: userStore.authHeader
                })
                this.transactions = response.transactions || []

                // Fetch statistics
                await this.fetchStats()
            } catch (error: any) {
                this.error = error.message || 'Failed to fetch transactions'
                console.error('Error fetching transactions:', error)
            } finally {
                this.isLoading = false
            }
        },

        async fetchTransactionById(id: string) {
            this.isLoading = true
            this.error = null
            const userStore = useUserStore()

            try {
                const data = await $fetch<Transaction>(`/api/transactions/${id}`, {
                    headers: userStore.authHeader
                })
                this.currentTransaction = data
            } catch (error: any) {
                this.error = error.message || `Failed to fetch transaction ${id}`
                console.error(`Error fetching transaction ${id}:`, error)
            } finally {
                this.isLoading = false
            }
        },

        async createTransaction(transactionData: Partial<Transaction>) {
            this.isLoading = true
            this.error = null
            const userStore = useUserStore()

            try {
                const newTransaction = await $fetch<Transaction>('/api/transactions', {
                    method: 'POST',
                    headers: userStore.authHeader,
                    body: transactionData
                })

                // Add to local state
                this.transactions.unshift(newTransaction)

                // Update stats
                await this.fetchStats()

                return newTransaction
            } catch (error: any) {
                this.error = error.message || 'Failed to create transaction'
                console.error('Error creating transaction:', error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async updateTransactionStatus(id: string, status: Transaction['status'], notes?: string) {
            this.isLoading = true
            this.error = null
            const userStore = useUserStore()

            try {
                const updatedTransaction = await $fetch<Transaction>(`/api/transactions/${id}`, {
                    method: 'PATCH',
                    headers: userStore.authHeader,
                    body: { status, notes }
                })

                // Update in the list
                const index = this.transactions.findIndex(t => t.id === id)
                if (index !== -1) {
                    this.transactions[index] = updatedTransaction
                }

                // Update current transaction if it's loaded
                if (this.currentTransaction && this.currentTransaction.id === id) {
                    this.currentTransaction = updatedTransaction
                }

                // Update stats
                await this.fetchStats()

                return updatedTransaction
            } catch (error: any) {
                this.error = error.message || `Failed to update transaction status for ${id}`
                console.error(`Error updating transaction status for ${id}:`, error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async importTransactions(parsedData: any[], mappings: Record<string, string>, options = {}) {
            this.isLoading = true
            this.error = null
            const userStore = useUserStore()

            try {
                const result = await $fetch('/api/transactions/import', {
                    method: 'POST',
                    headers: userStore.authHeader,
                    body: { data: parsedData, mappings, options }
                })

                // Refresh transactions list
                await this.fetchTransactions()

                return result
            } catch (error: any) {
                this.error = error.message || 'Failed to import transactions'
                console.error('Error importing transactions:', error)
                return null
            } finally {
                this.isLoading = false
            }
        },

        async fetchStats() {
            const userStore = useUserStore()
            try {
                const data = await $fetch<typeof this.stats>('/api/transactions/stats', {
                    headers: userStore.authHeader
                })
                this.stats = data
            } catch (error: any) {
                console.error('Error fetching transaction stats:', error)
            }
        },

        resetFilters() {
            this.filters = {}
            this.searchQuery = ''
        },

        setSearchQuery(query: string) {
            this.searchQuery = query
        },

        setFilters(filters: TransactionFilters) {
            this.filters = filters
        }
    }
})
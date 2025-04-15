// stores/transaction.ts
import { defineStore } from 'pinia'

export interface Transaction {
    id: string
    reference: string
    createdAt: string
    status: 'completed' | 'pending' | 'processing' | 'failed' | 'refunded'
    source: string
    amount: number
    currency: string
    customer: {
        name: string
        email: string
    }
    receiptId?: string
    shipmentId?: string
    hasReceipt: boolean
    hasShipment: boolean
    [key: string]: any
}

export interface TransactionFilters {
    status?: string
    source?: string
    dateFrom?: string
    dateTo?: string
    minAmount?: string | number
    maxAmount?: string | number
    hasReceipt?: boolean
    hasShipment?: boolean
    search?: string
}

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
            receiptMatchRate: 0
        }
    }),

    getters: {
        filteredTransactions(): Transaction[] {
            let result = [...this.transactions]

            // Apply search filter
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase()
                result = result.filter(transaction =>
                    transaction.id.toLowerCase().includes(query) ||
                    transaction.reference.toLowerCase().includes(query) ||
                    transaction.customer.name.toLowerCase().includes(query) ||
                    transaction.customer.email.toLowerCase().includes(query) ||
                    transaction.amount.toString().includes(query)
                )
            }

            // Apply status filter
            if (this.filters.status) {
                result = result.filter(transaction => transaction.status === this.filters.status)
            }

            // Apply source filter
            if (this.filters.source) {
                result = result.filter(transaction => transaction.source === this.filters.source)
            }

            // Apply date range filter
            if (this.filters.dateFrom) {
                const fromDate = new Date(this.filters.dateFrom)
                result = result.filter(transaction => new Date(transaction.createdAt) >= fromDate)
            }

            if (this.filters.dateTo) {
                const toDate = new Date(this.filters.dateTo)
                toDate.setHours(23, 59, 59, 999) // End of the day
                result = result.filter(transaction => new Date(transaction.createdAt) <= toDate)
            }

            // Apply amount filter
            if (this.filters.minAmount) {
                const min = typeof this.filters.minAmount === 'string'
                    ? parseFloat(this.filters.minAmount)
                    : this.filters.minAmount

                result = result.filter(transaction => transaction.amount >= min)
            }

            if (this.filters.maxAmount) {
                const max = typeof this.filters.maxAmount === 'string'
                    ? parseFloat(this.filters.maxAmount)
                    : this.filters.maxAmount

                result = result.filter(transaction => transaction.amount <= max)
            }

            // Filter by receipt presence
            if (this.filters.hasReceipt !== undefined) {
                result = result.filter(transaction => transaction.hasReceipt === this.filters.hasReceipt)
            }

            // Filter by shipment presence
            if (this.filters.hasShipment !== undefined) {
                result = result.filter(transaction => transaction.hasShipment === this.filters.hasShipment)
            }

            return result
        }
    },

    actions: {
        async fetchTransactions() {
            this.isLoading = true
            this.error = null

            try {
                const { data } = await useFetch('/api/transactions')
                this.transactions = data.value as Transaction[]

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

            try {
                const { data } = await useFetch(`/api/transactions/${id}`)
                this.currentTransaction = data.value as Transaction
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

            try {
                const { data } = await useFetch('/api/transactions/create', {
                    method: 'POST',
                    body: transactionData
                })

                const newTransaction = data.value as Transaction

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

            try {
                const { data } = await useFetch(`/api/transactions/${id}/update`, {
                    method: 'POST',
                    body: { status, notes }
                })

                const updatedTransaction = data.value as Transaction

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

            try {
                const { data } = await useFetch('/api/transactions/import', {
                    method: 'POST',
                    body: { data: parsedData, mappings, options }
                })

                const result = data.value

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
            try {
                const { data } = await useFetch('/api/transactions/stats')
                this.stats = data.value
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
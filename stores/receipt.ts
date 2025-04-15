import { defineStore } from 'pinia'
import { Receipt } from '~/types/receipt'

interface ReceiptState {
    receipts: Receipt[]
    currentReceipt: Receipt | null
    isLoading: boolean
    error: string | null
    filters: {
        status?: string
        dateFrom?: string
        dateTo?: string
        merchant?: string
        minAmount?: number
        maxAmount?: number
    }
    searchQuery: string
}

export const useReceiptStore = defineStore('receipt', {
    state: (): ReceiptState => ({
        receipts: [],
        currentReceipt: null,
        isLoading: false,
        error: null,
        filters: {},
        searchQuery: ''
    }),

    getters: {
        // Get filtered receipts based on search and filters
        filteredReceipts: (state) => {
            let result = [...state.receipts]

            // Apply search filter
            if (state.searchQuery) {
                const query = state.searchQuery.toLowerCase()
                result = result.filter(receipt =>
                    receipt.filename.toLowerCase().includes(query) ||
                    (receipt.merchant && receipt.merchant.toLowerCase().includes(query)) ||
                    (receipt.amount && receipt.amount.toString().includes(query)) ||
                    (receipt.transactionId && receipt.transactionId.toLowerCase().includes(query))
                )
            }

            // Apply status filter
            if (state.filters.status) {
                result = result.filter(receipt => receipt.status === state.filters.status)
            }

            // Apply date range filter
            if (state.filters.dateFrom) {
                const fromDate = new Date(state.filters.dateFrom)
                result = result.filter(receipt => new Date(receipt.uploadDate) >= fromDate)
            }

            if (state.filters.dateTo) {
                const toDate = new Date(state.filters.dateTo)
                toDate.setHours(23, 59, 59, 999) // End of the day
                result = result.filter(receipt => new Date(receipt.uploadDate) <= toDate)
            }

            // Apply merchant filter
            if (state.filters.merchant) {
                const merchant = state.filters.merchant.toLowerCase()
                result = result.filter(receipt =>
                    receipt.merchant && receipt.merchant.toLowerCase().includes(merchant)
                )
            }

            // Apply amount filter
            if (state.filters.minAmount !== undefined) {
                result = result.filter(receipt => receipt.amount && receipt.amount >= state.filters.minAmount!)
            }

            if (state.filters.maxAmount !== undefined) {
                result = result.filter(receipt => receipt.amount && receipt.amount <= state.filters.maxAmount!)
            }

            return result
        },

        // Get receipt statistics
        receiptStats: (state) => {
            const total = state.receipts.length
            const matched = state.receipts.filter(r => r.status === 'matched').length
            const unmatched = total - matched
            const matchRate = total > 0 ? Math.round((matched / total) * 100) / 100 : 0

            return {
                total,
                matched,
                unmatched,
                matchRate
            }
        },

        // Get receipt by ID
        getReceiptById: (state) => (id: string) => {
            return state.receipts.find(receipt => receipt.id === id) || null
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
        // Fetch all receipts
        async fetchReceipts() {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/receipts')
                this.receipts = response
            } catch (err: any) {
                this.error = err.message || 'Failed to fetch receipts'
                console.error('Error fetching receipts:', err)
            } finally {
                this.isLoading = false
            }
        },

        // Fetch a receipt by ID
        async fetchReceiptById(id: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/receipts/${id}`)
                this.currentReceipt = response
                return response
            } catch (err: any) {
                this.error = err.message || `Failed to fetch receipt ${id}`
                console.error(`Error fetching receipt ${id}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Upload a new receipt
        async uploadReceipt(formData: FormData) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch('/api/receipts', {
                    method: 'POST',
                    body: formData
                })

                // Add to local state
                this.receipts.unshift(response)
                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to upload receipt'
                console.error('Error uploading receipt:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Update receipt metadata
        async updateReceipt(id: string, data: Partial<Receipt>) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/receipts/${id}`, {
                    method: 'PATCH',
                    body: data
                })

                // Update in the array
                const index = this.receipts.findIndex(r => r.id === id)
                if (index !== -1) {
                    this.receipts[index] = { ...this.receipts[index], ...response }
                }

                // Update current receipt if it's loaded
                if (this.currentReceipt && this.currentReceipt.id === id) {
                    this.currentReceipt = { ...this.currentReceipt, ...response }
                }

                return response
            } catch (err: any) {
                this.error = err.message || `Failed to update receipt ${id}`
                console.error(`Error updating receipt ${id}:`, err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Match receipt with transaction
        async matchWithTransaction(receiptId: string, transactionId: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/receipts/${receiptId}/match`, {
                    method: 'POST',
                    body: { transactionId }
                })

                // Update in the array
                const index = this.receipts.findIndex(r => r.id === receiptId)
                if (index !== -1) {
                    this.receipts[index] = {
                        ...this.receipts[index],
                        status: 'matched',
                        transactionId
                    }
                }

                // Update current receipt if it's loaded
                if (this.currentReceipt && this.currentReceipt.id === receiptId) {
                    this.currentReceipt = {
                        ...this.currentReceipt,
                        status: 'matched',
                        transactionId
                    }
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to match receipt with transaction'
                console.error('Error matching receipt:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Unmatch receipt from transaction
        async unmatchReceipt(receiptId: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/receipts/${receiptId}/match`, {
                    method: 'DELETE'
                })

                // Update in the array
                const index = this.receipts.findIndex(r => r.id === receiptId)
                if (index !== -1) {
                    this.receipts[index] = {
                        ...this.receipts[index],
                        status: 'unmatched',
                        transactionId: null
                    }
                }

                // Update current receipt if it's loaded
                if (this.currentReceipt && this.currentReceipt.id === receiptId) {
                    this.currentReceipt = {
                        ...this.currentReceipt,
                        status: 'unmatched',
                        transactionId: null
                    }
                }

                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to unmatch receipt'
                console.error('Error unmatching receipt:', err)
                return null
            } finally {
                this.isLoading = false
            }
        },

        // Delete a receipt
        async deleteReceipt(id: string) {
            this.isLoading = true
            this.error = null

            try {
                await $fetch(`/api/receipts/${id}`, {
                    method: 'DELETE'
                })

                // Remove from local state
                this.receipts = this.receipts.filter(r => r.id !== id)

                // Clear current receipt if it's the deleted one
                if (this.currentReceipt && this.currentReceipt.id === id) {
                    this.currentReceipt = null
                }

                return true
            } catch (err: any) {
                this.error = err.message || `Failed to delete receipt ${id}`
                console.error(`Error deleting receipt ${id}:`, err)
                return false
            } finally {
                this.isLoading = false
            }
        },

        // Find transaction matches for a receipt
        async findMatchCandidates(receiptId: string) {
            this.isLoading = true
            this.error = null

            try {
                const response = await $fetch(`/api/receipts/${receiptId}/matches`)
                return response
            } catch (err: any) {
                this.error = err.message || 'Failed to find matching transactions'
                console.error('Error finding match candidates:', err)
                return []
            } finally {
                this.isLoading = false
            }
        },

        // Set search query
        setSearchQuery(query: string) {
            this.searchQuery = query
        },

        // Update filters
        updateFilters(filters: Partial<ReceiptState['filters']>) {
            this.filters = { ...this.filters, ...filters }
        },

        // Reset filters
        resetFilters() {
            this.filters = {}
            this.searchQuery = ''
        }
    }
})
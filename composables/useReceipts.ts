import { ref, computed } from 'vue'

interface Receipt {
    id: string
    filename: string
    size: number
    uploadDate: string
    amount?: number | null
    merchant?: string | null
    status: 'matched' | 'unmatched'
    transactionId?: string | null
    url?: string
    notes?: string
    tags?: string[]
    createdBy?: string
    updatedAt?: string
}

interface ReceiptFilters {
    status?: string
    type?: string
    dateFrom?: string
    dateTo?: string
    minAmount?: string | number
    maxAmount?: string | number
    merchant?: string
    transactionId?: string
    search?: string
}

interface ReceiptStats {
    total: number
    matched: number
    unmatched: number
    matchRate: number
}

interface MatchCandidate {
    transactionId: string
    date: string
    amount: number
    description?: string
    confidence: number // 0-100 match confidence
}

/**
 * Composable for managing receipt data and operations
 */
export function useReceipts() {
    // State
    const receipts = ref<Receipt[]>([])
    const isLoading = ref<boolean>(false)
    const error = ref<string | null>(null)
    const currentReceipt = ref<Receipt | null>(null)
    const matchCandidates = ref<MatchCandidate[]>([])
    const selectedMatchCandidate = ref<string | null>(null)
    const filters = ref<ReceiptFilters>({})
    const searchQuery = ref<string>('')

    // Fetch all receipts
    const fetchReceipts = async () => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/receipts')
            // receipts.value = await response.json()

            // For demo, use mock data
            await new Promise(resolve => setTimeout(resolve, 1000))
            receipts.value = generateMockReceipts(50)
        } catch (err: any) {
            error.value = err.message || 'Failed to fetch receipts'
            console.error('Error fetching receipts:', err)
        } finally {
            isLoading.value = false
        }
    }

    // Get a single receipt by ID
    const fetchReceiptById = async (id: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch(`/api/receipts/${id}`)
            // currentReceipt.value = await response.json()

            // For demo, find in local state or generate mock
            await new Promise(resolve => setTimeout(resolve, 500))
            const found = receipts.value.find(r => r.id === id)

            if (found) {
                currentReceipt.value = found
            } else {
                // Generate a mock receipt with the given ID
                const mockReceipts = generateMockReceipts(1, id)
                currentReceipt.value = mockReceipts[0]
            }
        } catch (err: any) {
            error.value = err.message || `Failed to fetch receipt ${id}`
            console.error(`Error fetching receipt ${id}:`, err)
        } finally {
            isLoading.value = false
        }
    }

    // Upload a new receipt
    const uploadReceipt = async (file: File, metadata?: Partial<Receipt>) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be a FormData upload to an API
            // const formData = new FormData()
            // formData.append('file', file)
            // if (metadata) formData.append('metadata', JSON.stringify(metadata))
            // const response = await fetch('/api/receipts', { method: 'POST', body: formData })
            // const newReceipt = await response.json()

            // For demo, create a mock receipt
            await new Promise(resolve => setTimeout(resolve, 1500))

            const newReceipt: Receipt = {
                id: `receipt_${Date.now()}`,
                filename: file.name,
                size: file.size,
                uploadDate: new Date().toISOString(),
                amount: metadata?.amount || null,
                merchant: metadata?.merchant || null,
                status: 'unmatched',
                url: URL.createObjectURL(file), // Create a temporary URL for preview
                notes: metadata?.notes || '',
                tags: metadata?.tags || [],
                createdBy: 'current-user',
                updatedAt: new Date().toISOString()
            }

            // Add to local state
            receipts.value.unshift(newReceipt)

            return newReceipt
        } catch (err: any) {
            error.value = err.message || 'Failed to upload receipt'
            console.error('Error uploading receipt:', err)
            return null
        } finally {
            isLoading.value = false
        }
    }

    // Delete a receipt
    const deleteReceipt = async (id: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/receipts/${id}`, { method: 'DELETE' })

            // For demo, remove from local state
            await new Promise(resolve => setTimeout(resolve, 500))
            receipts.value = receipts.value.filter(r => r.id !== id)

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to delete receipt ${id}`
            console.error(`Error deleting receipt ${id}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Find matching transaction candidates for a receipt
    const findMatchCandidates = async (receiptId: string) => {
        isLoading.value = true
        error.value = null

        try {
            // First, ensure we have the receipt data
            if (!currentReceipt.value || currentReceipt.value.id !== receiptId) {
                await fetchReceiptById(receiptId)
            }

            if (!currentReceipt.value) {
                throw new Error('Receipt not found')
            }

            // In a real app, this would be an API call with receipt data
            // const response = await fetch(`/api/receipts/${receiptId}/match-candidates`)
            // matchCandidates.value = await response.json()

            // For demo, generate mock candidates
            await new Promise(resolve => setTimeout(resolve, 800))
            matchCandidates.value = generateMockMatchCandidates(currentReceipt.value)

            return matchCandidates.value
        } catch (err: any) {
            error.value = err.message || 'Failed to find matching transactions'
            console.error('Error finding match candidates:', err)
            return []
        } finally {
            isLoading.value = false
        }
    }

    // Match a receipt with a transaction
    const matchWithTransaction = async (receiptId: string, transactionId: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/receipts/${receiptId}/match`, {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ transactionId })
            // })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 700))

            // Update in the list
            const receiptIndex = receipts.value.findIndex(r => r.id === receiptId)
            if (receiptIndex !== -1) {
                receipts.value[receiptIndex] = {
                    ...receipts.value[receiptIndex],
                    status: 'matched',
                    transactionId,
                    updatedAt: new Date().toISOString()
                }
            }

            // Update current receipt if it's loaded
            if (currentReceipt.value && currentReceipt.value.id === receiptId) {
                currentReceipt.value = {
                    ...currentReceipt.value,
                    status: 'matched',
                    transactionId,
                    updatedAt: new Date().toISOString()
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Failed to match receipt with transaction'
            console.error('Error matching receipt:', err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Unmatch a receipt from a transaction
    const unmatchReceipt = async (receiptId: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/receipts/${receiptId}/unmatch`, { method: 'POST' })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 500))

            // Update in the list
            const receiptIndex = receipts.value.findIndex(r => r.id === receiptId)
            if (receiptIndex !== -1) {
                receipts.value[receiptIndex] = {
                    ...receipts.value[receiptIndex],
                    status: 'unmatched',
                    transactionId: null,
                    updatedAt: new Date().toISOString()
                }
            }

            // Update current receipt if it's loaded
            if (currentReceipt.value && currentReceipt.value.id === receiptId) {
                currentReceipt.value = {
                    ...currentReceipt.value,
                    status: 'unmatched',
                    transactionId: null,
                    updatedAt: new Date().toISOString()
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || 'Failed to unmatch receipt'
            console.error('Error unmatching receipt:', err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Update receipt metadata (amount, merchant, etc)
    const updateReceiptMetadata = async (id: string, metadata: Partial<Receipt>) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch(`/api/receipts/${id}`, {
            //   method: 'PATCH',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(metadata)
            // })
            // const updatedReceipt = await response.json()

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 600))

            // Update in the list
            const receiptIndex = receipts.value.findIndex(r => r.id === id)
            if (receiptIndex !== -1) {
                receipts.value[receiptIndex] = {
                    ...receipts.value[receiptIndex],
                    ...metadata,
                    updatedAt: new Date().toISOString()
                }
            }

            // Update current receipt if it's loaded
            if (currentReceipt.value && currentReceipt.value.id === id) {
                currentReceipt.value = {
                    ...currentReceipt.value,
                    ...metadata,
                    updatedAt: new Date().toISOString()
                }
            }

            return receipts.value[receiptIndex]
        } catch (err: any) {
            error.value = err.message || `Failed to update receipt ${id}`
            console.error(`Error updating receipt ${id}:`, err)
            return null
        } finally {
            isLoading.value = false
        }
    }

    // Get receipt statistics
    const getReceiptStats = computed((): ReceiptStats => {
        const total = receipts.value.length
        const matched = receipts.value.filter(r => r.status === 'matched').length
        const unmatched = total - matched
        const matchRate = total > 0 ? Math.round((matched / total) * 100) / 100 : 0

        return {
            total,
            matched,
            unmatched,
            matchRate
        }
    })

    // Apply filters to receipts
    const filteredReceipts = computed(() => {
        let result = [...receipts.value]

        // Apply search filter
        if (searchQuery.value) {
            const query = searchQuery.value.toLowerCase()
            result = result.filter(receipt =>
                receipt.filename.toLowerCase().includes(query) ||
                (receipt.merchant && receipt.merchant.toLowerCase().includes(query)) ||
                (receipt.amount && receipt.amount.toString().includes(query)) ||
                (receipt.transactionId && receipt.transactionId.toLowerCase().includes(query))
            )
        }

        // Apply status filter
        if (filters.value.status) {
            result = result.filter(receipt => receipt.status === filters.value.status)
        }

        // Apply file type filter
        if (filters.value.type) {
            result = result.filter(receipt => {
                const extension = receipt.filename.split('.').pop()?.toLowerCase()
                return extension === filters.value.type ||
                    (filters.value.type === 'jpg' && (extension === 'jpeg' || extension === 'jpg'))
            })
        }

        // Apply date range filter
        if (filters.value.dateFrom) {
            const fromDate = new Date(filters.value.dateFrom)
            result = result.filter(receipt => new Date(receipt.uploadDate) >= fromDate)
        }

        if (filters.value.dateTo) {
            const toDate = new Date(filters.value.dateTo)
            toDate.setHours(23, 59, 59, 999) // End of the day
            result = result.filter(receipt => new Date(receipt.uploadDate) <= toDate)
        }

        // Apply amount filter
        if (filters.value.minAmount) {
            const min = typeof filters.value.minAmount === 'string'
                ? parseFloat(filters.value.minAmount)
                : filters.value.minAmount

            result = result.filter(receipt => receipt.amount && receipt.amount >= min)
        }

        if (filters.value.maxAmount) {
            const max = typeof filters.value.maxAmount === 'string'
                ? parseFloat(filters.value.maxAmount)
                : filters.value.maxAmount

            result = result.filter(receipt => receipt.amount && receipt.amount <= max)
        }

        // Apply merchant filter
        if (filters.value.merchant) {
            const merchant = filters.value.merchant.toLowerCase()
            result = result.filter(receipt =>
                receipt.merchant && receipt.merchant.toLowerCase().includes(merchant)
            )
        }

        // Apply transaction ID filter
        if (filters.value.transactionId) {
            const transactionId = filters.value.transactionId.toLowerCase()
            result = result.filter(receipt =>
                receipt.transactionId && receipt.transactionId.toLowerCase().includes(transactionId)
            )
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
        return new Date(isoDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    }

    const formatTime = (isoDate: string) => {
        return new Date(isoDate).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
    }

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount)
    }

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) {
            return bytes + ' B'
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + ' KB'
        } else {
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        }
    }

    // Generate mock data for testing/development
    const generateMockReceipts = (count: number, specificId?: string): Receipt[] => {
        const merchants = [
            'Tech Gadgets Inc.',
            'Office Supplies Co.',
            'Global Imports Ltd.',
            'ElectroMart',
            'FoodMart',
            'Travel Agency',
            'Auto Parts Store',
            'Hardware Depot'
        ]

        const fileTypes = [
            'pdf',
            'jpg',
            'png',
            'pdf'  // PDF more common
        ]

        const receipts: Receipt[] = []

        // Current date for reference
        const now = new Date()

        for (let i = 0; i < count; i++) {
            const id = specificId || `receipt_${4000 + i}`

            // Create random dates within last 60 days
            const uploadDate = new Date(now.getTime())
            uploadDate.setDate(now.getDate() - Math.floor(Math.random() * 60))

            // Random amount (sometimes null to simulate unprocessed receipts)
            const hasAmount = Math.random() > 0.2
            const amount = hasAmount ? Math.round(Math.random() * 1000 * 100) / 100 : null

            // Random merchant (sometimes null)
            const hasMerchant = Math.random() > 0.3
            const merchant = hasMerchant ? merchants[Math.floor(Math.random() * merchants.length)] : null

            // Random file type
            const fileType = fileTypes[Math.floor(Math.random() * fileTypes.length)]

            // Random status (more matched than unmatched)
            const status = Math.random() > 0.3 ? 'matched' : 'unmatched'

            // Random file size between 100KB and 5MB
            const size = Math.floor(Math.random() * 5000000) + 100000

            // Create receipt
            receipts.push({
                id,
                filename: `receipt_${id.split('_')[1]}.${fileType}`,
                size,
                uploadDate: uploadDate.toISOString(),
                amount,
                merchant,
                status,
                transactionId: status === 'matched' ? `TRX-${7000 + i}` : null,
                notes: Math.random() > 0.7 ? 'Sample note for this receipt' : '',
                tags: Math.random() > 0.7 ? ['business', 'expense'] : [],
                createdBy: 'current-user',
                updatedAt: uploadDate.toISOString()
            })
        }

        return receipts
    }

    // Generate mock transaction match candidates
    const generateMockMatchCandidates = (receipt: Receipt): MatchCandidate[] => {
        const candidates: MatchCandidate[] = []
        const receiptAmount = receipt.amount || 0

        // Perfect match
        candidates.push({
            transactionId: `TRX-${Math.floor(Math.random() * 1000) + 7000}`,
            date: new Date(receipt.uploadDate).toISOString(),
            amount: receiptAmount,
            description: 'Exact amount match',
            confidence: 95
        })

        // Close date match with slight amount difference
        const closeDate = new Date(receipt.uploadDate)
        closeDate.setDate(closeDate.getDate() - 1)
        candidates.push({
            transactionId: `TRX-${Math.floor(Math.random() * 1000) + 7000}`,
            date: closeDate.toISOString(),
            amount: receiptAmount * 0.98, // Slightly lower
            description: 'Similar amount, date within 1 day',
            confidence: 85
        })

        // Same date, different amount
        candidates.push({
            transactionId: `TRX-${Math.floor(Math.random() * 1000) + 7000}`,
            date: new Date(receipt.uploadDate).toISOString(),
            amount: receiptAmount * 1.5,
            description: 'Different amount, same date',
            confidence: 65
        })

        // Different date, same amount
        const differentDate = new Date(receipt.uploadDate)
        differentDate.setDate(differentDate.getDate() - 3)
        candidates.push({
            transactionId: `TRX-${Math.floor(Math.random() * 1000) + 7000}`,
            date: differentDate.toISOString(),
            amount: receiptAmount,
            description: 'Same amount, date differs by 3 days',
            confidence: 75
        })

        // Sort by confidence (highest first)
        return candidates.sort((a, b) => b.confidence - a.confidence)
    }

    return {
        // State
        receipts,
        isLoading,
        error,
        currentReceipt,
        matchCandidates,
        selectedMatchCandidate,
        filters,
        searchQuery,

        // Computed
        filteredReceipts,
        receiptStats: getReceiptStats,

        // Methods
        fetchReceipts,
        fetchReceiptById,
        uploadReceipt,
        deleteReceipt,
        findMatchCandidates,
        matchWithTransaction,
        unmatchReceipt,
        updateReceiptMetadata,
        resetFilters,

        // Helpers
        formatDate,
        formatTime,
        formatCurrency,
        formatFileSize
    }
}
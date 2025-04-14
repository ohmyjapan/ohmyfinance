import { ref, computed } from 'vue'

// Transaction status types
export type TransactionStatus =
    | 'completed'
    | 'pending'
    | 'processing'
    | 'failed'
    | 'refunded'
    | 'cancelled'

// Transaction source types
export type TransactionSource =
    | 'credit_card'
    | 'payment_gateway'
    | 'overseas'
    | 'manual'
    | 'other'

// Transaction item interface
export interface TransactionItem {
    name: string
    description?: string
    quantity: number
    price: number
    total: number
    sku?: string
    tax?: number
}

// Shipment interface
export interface TransactionShipment {
    trackingNumber: string
    carrier: string
    status: string
    estimatedDelivery: string
    address: {
        name: string
        line1: string
        line2?: string
        city: string
        state: string
        postalCode: string
        country: string
    }
    shippingMethod: {
        name: string
        estimatedDelivery: string
        carrier: string
    }
}

// Timeline event interface
export interface TimelineEvent {
    type: string
    title: string
    timestamp: string
    description?: string
    location?: string
}

// Receipt reference interface
export interface ReceiptReference {
    id: string
    filename: string
    size: number
    date: string
    amount: number
    merchant: string
    url?: string
}

// Transaction interface
export interface Transaction {
    id: string
    reference: string
    createdAt: string
    status: TransactionStatus
    source: TransactionSource
    amount: number
    currency: string
    customer: {
        name: string
        email: string
        id?: string
    }
    paymentMethod?: {
        type: string
        last4?: string
        expiryDate?: string
    }
    processor?: {
        name: string
        gatewayId: string
    }
    items?: TransactionItem[]
    shipment?: TransactionShipment
    timeline?: TimelineEvent[]
    receipt?: ReceiptReference | null
    relatedTransactions?: {
        id: string
        date: string
        amount: number
        status: TransactionStatus
    }[]
    notes?: string
    tags?: string[]
    metadata?: Record<string, any>
}

// Transaction filter interface
export interface TransactionFilters {
    status?: string
    source?: string
    dateFrom?: string
    dateTo?: string
    minAmount?: string | number
    maxAmount?: string | number
    customer?: string
    reference?: string
    hasReceipt?: boolean
    hasShipment?: boolean
}

// Transaction statistics
export interface TransactionStats {
    total: {
        count: number
        amount: number
    }
    completed: {
        count: number
        amount: number
    }
    pending: {
        count: number
        amount: number
    }
    processing: {
        count: number
        amount: number
    }
    failed: {
        count: number
        amount: number
    }
    avgOrderValue: number
    receiptMatchRate: number
}

/**
 * Composable for managing transactions
 */
export function useTransactions() {
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

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/transactions')
            // transactions.value = await response.json()

            // For demo, use mock data
            await new Promise(resolve => setTimeout(resolve, 1000))
            transactions.value = generateMockTransactions(100)
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
            // In a real app, this would be an API call
            // const response = await fetch(`/api/transactions/${id}`)
            // currentTransaction.value = await response.json()

            // For demo, find in local state or generate mock
            await new Promise(resolve => setTimeout(resolve, 500))
            const found = transactions.value.find(t => t.id === id)

            if (found) {
                currentTransaction.value = found
            } else {
                // Generate a mock transaction with the given ID
                const mockTransactions = generateMockTransactions(1, id)
                currentTransaction.value = mockTransactions[0]
            }
        } catch (err: any) {
            error.value = err.message || `Failed to fetch transaction ${id}`
            console.error(`Error fetching transaction ${id}:`, err)
        } finally {
            isLoading.value = false
        }
    }

    // Create a new transaction
    const createTransaction = async (transactionData: Partial<Transaction>) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch('/api/transactions', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(transactionData)
            // })
            // const newTransaction = await response.json()

            // For demo, create a mock transaction
            await new Promise(resolve => setTimeout(resolve, 800))

            const now = new Date()
            const newId = `TRX-${Date.now()}`

            const newTransaction: Transaction = {
                id: newId,
                reference: transactionData.reference || `REF-${Date.now()}`,
                createdAt: now.toISOString(),
                status: transactionData.status || 'pending',
                source: transactionData.source || 'manual',
                amount: transactionData.amount || 0,
                currency: transactionData.currency || 'USD',
                customer: transactionData.customer || {
                    name: 'New Customer',
                    email: 'customer@example.com'
                },
                items: transactionData.items || [],
                shipment: transactionData.shipment,
                timeline: [
                    {
                        type: 'created',
                        title: 'Transaction Created',
                        timestamp: now.toISOString(),
                        description: 'Transaction manually created'
                    }
                ],
                notes: transactionData.notes || '',
                tags: transactionData.tags || [],
                metadata: transactionData.metadata || {}
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

    // Update transaction status
    const updateTransactionStatus = async (id: string, status: TransactionStatus, notes?: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/transactions/${id}/status`, {
            //   method: 'PATCH',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ status, notes })
            // })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 500))

            // Create a new timeline event
            const now = new Date().toISOString()
            const statusEvent: TimelineEvent = {
                type: status,
                title: `Transaction ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                timestamp: now,
                description: notes
            }

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === id)
            if (transactionIndex !== -1) {
                // Add timeline event
                const timeline = transactions.value[transactionIndex].timeline || []

                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    status,
                    timeline: [statusEvent, ...timeline]
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === id) {
                const timeline = currentTransaction.value.timeline || []

                currentTransaction.value = {
                    ...currentTransaction.value,
                    status,
                    timeline: [statusEvent, ...timeline]
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to update transaction status for ${id}`
            console.error(`Error updating transaction status for ${id}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Attach receipt to transaction
    const attachReceipt = async (
        transactionId: string,
        receiptData: Omit<ReceiptReference, 'date'> & { date?: string }
    ) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/transactions/${transactionId}/receipt`, {
            //   method: 'PUT',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(receiptData)
            // })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 600))

            // Ensure receipt has a date
            const receipt: ReceiptReference = {
                ...receiptData,
                date: receiptData.date || new Date().toISOString()
            }

            // Create a new timeline event
            const now = new Date().toISOString()
            const receiptEvent: TimelineEvent = {
                type: 'receipt_attached',
                title: 'Receipt Attached',
                timestamp: now,
                description: `Receipt "${receipt.filename}" attached to transaction`
            }

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === transactionId)
            if (transactionIndex !== -1) {
                // Add timeline event
                const timeline = transactions.value[transactionIndex].timeline || []

                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    receipt,
                    timeline: [receiptEvent, ...timeline]
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === transactionId) {
                const timeline = currentTransaction.value.timeline || []

                currentTransaction.value = {
                    ...currentTransaction.value,
                    receipt,
                    timeline: [receiptEvent, ...timeline]
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to attach receipt to transaction ${transactionId}`
            console.error(`Error attaching receipt to transaction ${transactionId}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Remove receipt from transaction
    const removeReceipt = async (transactionId: string) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/transactions/${transactionId}/receipt`, {
            //   method: 'DELETE'
            // })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 500))

            // Create a new timeline event
            const now = new Date().toISOString()
            const receiptEvent: TimelineEvent = {
                type: 'receipt_removed',
                title: 'Receipt Removed',
                timestamp: now,
                description: 'Receipt was removed from transaction'
            }

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === transactionId)
            if (transactionIndex !== -1) {
                // Add timeline event
                const timeline = transactions.value[transactionIndex].timeline || []

                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    receipt: null,
                    timeline: [receiptEvent, ...timeline]
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === transactionId) {
                const timeline = currentTransaction.value.timeline || []

                currentTransaction.value = {
                    ...currentTransaction.value,
                    receipt: null,
                    timeline: [receiptEvent, ...timeline]
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to remove receipt from transaction ${transactionId}`
            console.error(`Error removing receipt from transaction ${transactionId}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Add/update shipment to transaction
    const updateShipment = async (transactionId: string, shipmentData: TransactionShipment) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // await fetch(`/api/transactions/${transactionId}/shipment`, {
            //   method: 'PUT',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(shipmentData)
            // })

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 700))

            // Create a new timeline event
            const now = new Date().toISOString()
            const shipmentEvent: TimelineEvent = {
                type: 'shipment_updated',
                title: 'Shipment Information Updated',
                timestamp: now,
                description: `Shipment tracking number: ${shipmentData.trackingNumber}`
            }

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === transactionId)
            if (transactionIndex !== -1) {
                // Add timeline event
                const timeline = transactions.value[transactionIndex].timeline || []

                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    shipment: shipmentData,
                    timeline: [shipmentEvent, ...timeline]
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === transactionId) {
                const timeline = currentTransaction.value.timeline || []

                currentTransaction.value = {
                    ...currentTransaction.value,
                    shipment: shipmentData,
                    timeline: [shipmentEvent, ...timeline]
                }
            }

            return true
        } catch (err: any) {
            error.value = err.message || `Failed to update shipment for transaction ${transactionId}`
            console.error(`Error updating shipment for transaction ${transactionId}:`, err)
            return false
        } finally {
            isLoading.value = false
        }
    }

    // Update transaction metadata
    const updateTransactionMetadata = async (id: string, metadata: Partial<Transaction>) => {
        isLoading.value = true
        error.value = null

        try {
            // In a real app, this would be an API call
            // const response = await fetch(`/api/transactions/${id}`, {
            //   method: 'PATCH',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify(metadata)
            // })
            // const updatedTransaction = await response.json()

            // For demo, update local state
            await new Promise(resolve => setTimeout(resolve, 600))

            // Update in the list
            const transactionIndex = transactions.value.findIndex(t => t.id === id)
            if (transactionIndex !== -1) {
                transactions.value[transactionIndex] = {
                    ...transactions.value[transactionIndex],
                    ...metadata
                }
            }

            // Update current transaction if it's loaded
            if (currentTransaction.value && currentTransaction.value.id === id) {
                currentTransaction.value = {
                    ...currentTransaction.value,
                    ...metadata
                }
            }

            return transactions.value[transactionIndex]
        } catch (err: any) {
            error.value = err.message || `Failed to update transaction ${id}`
            console.error(`Error updating transaction ${id}:`, err)
            return null
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
            // In a real app, this would be an API call
            // const response = await fetch('/api/transactions/import', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ data: parsedData, mappings, options })
            // })
            // const result = await response.json()

            // For demo, simulate import process
            await new Promise(resolve => setTimeout(resolve, 2000))

            // Track statistics
            const stats = {
                total: parsedData.length,
                imported: 0,
                skipped: 0,
                updated: 0,
                failed: 0
            }

            // Process each record
            const importedTransactions: Transaction[] = []

            for (const record of parsedData) {
                // Map fields according to provided mappings
                const mappedTransaction: any = {}

                for (const [sourceField, targetField] of Object.entries(mappings)) {
                    if (targetField && record[sourceField] !== undefined) {
                        mappedTransaction[targetField] = record[sourceField]
                    }
                }

                // Generate a transaction object with defaults for required fields
                const newTransaction: Transaction = {
                    id: `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    reference: mappedTransaction.transaction_id || `REF-${Date.now()}`,
                    createdAt: mappedTransaction.transaction_date || new Date().toISOString(),
                    status: mappedTransaction.transaction_status || 'completed',
                    source: mappedTransaction.source || 'manual',
                    amount: parseFloat(mappedTransaction.amount) || 0,
                    currency: mappedTransaction.currency_code || 'USD',
                    customer: {
                        name: mappedTransaction.customer_name || 'Customer',
                        email: mappedTransaction.customer_email || 'customer@example.com'
                    },
                    timeline: [
                        {
                            type: 'created',
                            title: 'Transaction Imported',
                            timestamp: new Date().toISOString(),
                            description: 'Transaction imported from file'
                        }
                    ]
                }

                // Check for duplicates if option is enabled
                if (options.skipDuplicates) {
                    const isDuplicate = transactions.value.some(t =>
                        t.reference === newTransaction.reference ||
                        (t.amount === newTransaction.amount && t.createdAt === newTransaction.createdAt)
                    )

                    if (isDuplicate) {
                        stats.skipped++
                        continue
                    }
                }

                // Check for existing transaction to update
                if (options.updateMatches) {
                    const existingIndex = transactions.value.findIndex(t => t.reference === newTransaction.reference)

                    if (existingIndex !== -1) {
                        // Update existing transaction
                        transactions.value[existingIndex] = {
                            ...transactions.value[existingIndex],
                            ...newTransaction,
                            id: transactions.value[existingIndex].id // Keep original ID
                        }

                        importedTransactions.push(transactions.value[existingIndex])
                        stats.updated++
                        continue
                    }
                }

                // Add new transaction
                importedTransactions.push(newTransaction)
                stats.imported++
            }

            // Add imported transactions to the list
            transactions.value = [...importedTransactions, ...transactions.value]

            return {
                success: true,
                stats,
                transactions: importedTransactions
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
            amount: transactions.value.reduce((sum, t) => sum + t.amount, 0)
        }

        const completed = {
            count: transactions.value.filter(t => t.status === 'completed').length,
            amount: transactions.value
                .filter(t => t.status === 'completed')
                .reduce((sum, t) => sum + t.amount, 0)
        }

        const pending = {
            count: transactions.value.filter(t => t.status === 'pending').length,
            amount: transactions.value
                .filter(t => t.status === 'pending')
                .reduce((sum, t) => sum + t.amount, 0)
        }

        const processing = {
            count: transactions.value.filter(t => t.status === 'processing').length,
            amount: transactions.value
                .filter(t => t.status === 'processing')
                .reduce((sum, t) => sum + t.amount, 0)
        }

        const failed = {
            count: transactions.value.filter(t => t.status === 'failed').length,
            amount: transactions.value
                .filter(t => t.status === 'failed')
                .reduce((sum, t) => sum + t.amount, 0)
        }

        const avgOrderValue = total.count > 0 ? total.amount / total.count : 0

        const transactionsWithReceipt = transactions.value.filter(t => t.receipt).length
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
    })

    // Apply filters to transactions
    const filteredTransactions = computed(() => {
        let result = [...transactions.value]

        // Apply search filter
        if (searchQuery.value) {
            const query = searchQuery.value.toLowerCase()
            result = result.filter(transaction =>
                transaction.id.toLowerCase().includes(query) ||
                transaction.reference.toLowerCase().includes(query) ||
                transaction.customer.name.toLowerCase().includes(query) ||
                transaction.customer.email.toLowerCase().includes(query) ||
                transaction.amount.toString().includes(query)
            )
        }

        // Apply status filter
        if (filters.value.status) {
            result = result.filter(transaction => transaction.status === filters.value.status)
        }

        // Apply source filter
        if (filters.value.source) {
            result = result.filter(transaction => transaction.source === filters.value.source)
        }

        // Apply date range filter
        if (filters.value.dateFrom) {
            const fromDate = new Date(filters.value.dateFrom)
            result = result.filter(transaction => new Date(transaction.createdAt) >= fromDate)
        }

        if (filters.value.dateTo) {
            const toDate = new Date(filters.value.dateTo)
            toDate.setHours(23, 59, 59, 999) // End of the day
            result = result.filter(transaction => new Date(transaction.createdAt) <= toDate)
        }

        // Apply amount filter
        if (filters.value.minAmount) {
            const min = typeof filters.value.minAmount === 'string'
                ? parseFloat(filters.value.minAmount)
                : filters.value.minAmount

            result = result.filter(transaction => transaction.amount >= min)
        }

        if (filters.value.maxAmount) {
            const max = typeof filters.value.maxAmount === 'string'
                ? parseFloat(filters.value.maxAmount)
                : filters.value.maxAmount

            result = result.filter(transaction => transaction.amount <= max)
        }

        // Apply customer filter
        if (filters.value.customer) {
            const customer = filters.value.customer.toLowerCase()
            result = result.filter(transaction =>
                transaction.customer.name.toLowerCase().includes(customer) ||
                transaction.customer.email.toLowerCase().includes(customer)
            )
        }

        // Apply reference filter
        if (filters.value.reference) {
            const reference = filters.value.reference.toLowerCase()
            result = result.filter(transaction =>
                transaction.reference.toLowerCase().includes(reference)
            )
        }

        // Filter by receipt presence
        if (filters.value.hasReceipt !== undefined) {
            if (filters.value.hasReceipt) {
                result = result.filter(transaction => transaction.receipt !== null && transaction.receipt !== undefined)
            } else {
                result = result.filter(transaction => transaction.receipt === null || transaction.receipt === undefined)
            }
        }

        // Filter by shipment presence
        if (filters.value.hasShipment !== undefined) {
            if (filters.value.hasShipment) {
                result = result.filter(transaction => transaction.shipment !== null && transaction.shipment !== undefined)
            } else {
                result = result.filter(transaction => transaction.shipment === null || transaction.shipment === undefined)
            }
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

    const formatCurrency = (amount: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency
        }).format(amount)
    }

    // Generate mock data for testing/development
    const generateMockTransactions = (count: number, specificId?: string): Transaction[] => {
        const statuses: TransactionStatus[] = ['completed', 'pending', 'processing', 'failed', 'refunded']
        const sources: TransactionSource[] = ['credit_card', 'payment_gateway', 'overseas', 'manual']

        const transactions: Transaction[] = []

        // Current date for reference
        const now = new Date()

        for (let i = 0; i < count; i++) {
            const id = specificId || `TRX-${7000 + i}`

            // Create random dates within last 90 days
            const createdDate = new Date(now.getTime())
            createdDate.setDate(now.getDate() - Math.floor(Math.random() * 90))

            // Random status (more completed than others)
            const status = Math.random() > 0.3
                ? 'completed'
                : statuses[Math.floor(Math.random() * statuses.length)]

            // Random source
            const source = sources[Math.floor(Math.random() * sources.length)]

            // Random amount between $10 and $2000
            const amount = Math.round((10 + Math.random() * 1990) * 100) / 100

            // Random timeline events
            const timeline: TimelineEvent[] = [
                {
                    type: 'created',
                    title: 'Transaction Created',
                    timestamp: createdDate.toISOString(),
                    description: 'Transaction initiated'
                }
            ]

            // Add processing event if status is processing, completed, or failed
            if (['processing', 'completed', 'failed', 'refunded'].includes(status)) {
                const processingDate = new Date(createdDate.getTime())
                processingDate.setMinutes(processingDate.getMinutes() + Math.floor(Math.random() * 30))

                timeline.push({
                    type: 'processing',
                    title: 'Transaction Processing',
                    timestamp: processingDate.toISOString(),
                    description: 'Payment processing initiated'
                })
            }

            // Add completed/failed/refunded event based on status
            if (['completed', 'failed', 'refunded'].includes(status)) {
                const statusDate = new Date(createdDate.getTime())
                statusDate.setMinutes(statusDate.getMinutes() + Math.floor(Math.random() * 60) + 30)

                timeline.push({
                    type: status,
                    title: `Transaction ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                    timestamp: statusDate.toISOString(),
                    description: status === 'completed'
                        ? 'Payment successfully processed and confirmed'
                        : status === 'failed'
                            ? 'Payment processing failed due to declined card'
                            : 'Transaction refunded to customer'
                })
            }

            // Sort timeline events by date (newest first)
            timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

            // Generate random items for some transactions
            const hasItems = Math.random() > 0.3
            let items: TransactionItem[] = []

            if (hasItems) {
                const itemCount = Math.floor(Math.random() * 3) + 1
                let remainingAmount = amount

                for (let j = 0; j < itemCount; j++) {
                    // For the last item, use the remaining amount
                    const isLastItem = j === itemCount - 1
                    const itemPrice = isLastItem
                        ? remainingAmount
                        : Math.round((remainingAmount * (0.2 + Math.random() * 0.6)) * 100) / 100

                    remainingAmount -= itemPrice

                    items.push({
                        name: `Item ${j + 1}`,
                        description: `Description for item ${j + 1}`,
                        quantity: 1,
                        price: itemPrice,
                        total: itemPrice
                    })
                }
            }

            // Random receipt for some completed transactions
            const hasReceipt = status === 'completed' && Math.random() > 0.6
            const receipt = hasReceipt ? {
                id: `receipt_${Math.floor(Math.random() * 1000) + 4000}`,
                filename: `receipt_${Math.floor(Math.random() * 1000) + 4000}.pdf`,
                size: Math.floor(Math.random() * 5000000) + 100000,
                date: createdDate.toISOString(),
                amount,
                merchant: `Merchant ${Math.floor(Math.random() * 100)}`
            } : null

            // Random shipment for some transactions
            const hasShipment = status === 'completed' && Math.random() > 0.7
            const shipment = hasShipment ? {
                trackingNumber: `TRK-${Math.floor(Math.random() * 10000000)}`,
                carrier: ['fedex', 'ups', 'usps', 'dhl'][Math.floor(Math.random() * 4)],
                status: ['pending', 'in_transit', 'delivered'][Math.floor(Math.random() * 3)],
                estimatedDelivery: (() => {
                    const date = new Date(createdDate.getTime())
                    date.setDate(date.getDate() + Math.floor(Math.random() * 7) + 3)
                    return date.toISOString()
                })(),
                address: {
                    name: `Customer ${Math.floor(Math.random() * 100)}`,
                    line1: `${Math.floor(Math.random() * 1000) + 100} Main St`,
                    city: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami'][Math.floor(Math.random() * 5)],
                    state: ['NY', 'CA', 'IL', 'TX', 'FL'][Math.floor(Math.random() * 5)],
                    postalCode: `${Math.floor(Math.random() * 90000) + 10000}`,
                    country: 'US'
                },
                shippingMethod: {
                    name: ['Standard', 'Express', 'Overnight'][Math.floor(Math.random() * 3)],
                    estimatedDelivery: (() => {
                        const date = new Date(createdDate.getTime())
                        date.setDate(date.getDate() + Math.floor(Math.random() * 7) + 3)
                        return date.toISOString()
                    })(),
                    carrier: ['FedEx', 'UPS', 'USPS', 'DHL'][Math.floor(Math.random() * 4)]
                }
            } : undefined

            // Create transaction object
            transactions.push({
                id,
                reference: `REF-${Math.floor(Math.random() * 100000)}`,
                createdAt: createdDate.toISOString(),
                status,
                source,
                amount,
                currency: 'USD',
                customer: {
                    name: `Customer ${Math.floor(Math.random() * 100)}`,
                    email: `customer${Math.floor(Math.random() * 100)}@example.com`,
                    id: `CUST-${Math.floor(Math.random() * 10000)}`
                },
                paymentMethod: {
                    type: ['VISA', 'MasterCard', 'American Express', 'Discover'][Math.floor(Math.random() * 4)],
                    last4: `${Math.floor(Math.random() * 10000)}`.padStart(4, '0'),
                    expiryDate: `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 5) + 23}`
                },
                processor: {
                    name: ['Stripe', 'PayPal', 'Braintree', 'Adyen'][Math.floor(Math.random() * 4)],
                    gatewayId: `GW-${Math.floor(Math.random() * 100000)}`
                },
                items,
                shipment,
                timeline,
                receipt,
                notes: Math.random() > 0.8 ? 'Sample note for this transaction' : '',
                tags: Math.random() > 0.8 ? ['important', 'reviewed'] : [],
                metadata: Math.random() > 0.8 ? { customField: 'Custom value' } : {}
            })
        }

        return transactions
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
        updateTransactionStatus,
        attachReceipt,
        removeReceipt,
        updateShipment,
        updateTransactionMetadata,
        importTransactions,
        resetFilters,

        // Helpers
        formatDate,
        formatTime,
        formatCurrency
    }
}
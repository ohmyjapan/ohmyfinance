import { defineEventHandler, getRouterParam, createError } from 'h3'

// Use a separate data store instead of importing directly from other route handlers
// This is a temporary solution - in production, you would use a database
// For a more permanent solution, import from a shared data module
import { useStorage } from '#app'

export default defineEventHandler(async (event) => {
    // Get receipts and transactions from storage
    const receipts = useStorage('receipts') || []
    const transactions = useStorage('transactions') || []

    const id = getRouterParam(event, 'id')

    // Find receipt
    const receipt = receipts.find(r => r.id === id)

    // Return 404 if not found
    if (!receipt) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Receipt not found'
        })
    }

    // Find potential matches based on amount and date
    const matches = []

    // Only search for matches if receipt has amount
    if (receipt.amount) {
        // Get all transactions without attached receipts
        const availableTransactions = transactions.filter(t => !t.receipt)

        for (const transaction of availableTransactions) {
            let confidence = 0
            const reasons = []

            // Check amount match (highest priority)
            const amountDiff = Math.abs(transaction.amount - receipt.amount)
            const percentDiff = (amountDiff / receipt.amount) * 100

            if (percentDiff < 1) {
                confidence += 60
                reasons.push('Amount matches exactly')
            } else if (percentDiff < 5) {
                confidence += 40
                reasons.push('Amount within 5%')
            } else if (percentDiff < 10) {
                confidence += 20
                reasons.push('Amount within 10%')
            }

            // Check date match
            if (receipt.date && transaction.createdAt) {
                const receiptDate = new Date(receipt.date).setHours(0, 0, 0, 0)
                const transactionDate = new Date(transaction.createdAt).setHours(0, 0, 0, 0)

                if (receiptDate === transactionDate) {
                    confidence += 30
                    reasons.push('Date matches exactly')
                } else {
                    // Check if dates are within 3 days
                    const diffTime = Math.abs(receiptDate - transactionDate)
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

                    if (diffDays <= 3) {
                        confidence += 15
                        reasons.push(`Date within ${diffDays} day${diffDays > 1 ? 's' : ''}`)
                    }
                }
            }

            // Check merchant name match (if available)
            if (receipt.merchant && transaction.merchant) {
                const receiptMerchant = receipt.merchant.toLowerCase()
                const transactionMerchant = transaction.merchant.toLowerCase()

                if (receiptMerchant === transactionMerchant) {
                    confidence += 20
                    reasons.push('Merchant name matches exactly')
                } else if (receiptMerchant.includes(transactionMerchant) || transactionMerchant.includes(receiptMerchant)) {
                    confidence += 10
                    reasons.push('Merchant name partial match')
                }
            }

            // Add to matches if it has any confidence
            if (confidence > 0) {
                matches.push({
                    transactionId: transaction.id,
                    confidence,
                    reasons,
                    transaction: {
                        id: transaction.id,
                        reference: transaction.reference,
                        amount: transaction.amount,
                        currency: transaction.currency,
                        createdAt: transaction.createdAt,
                        status: transaction.status,
                        source: transaction.source,
                        customer: transaction.customer
                    }
                })
            }
        }

        // Sort matches by confidence (highest first)
        matches.sort((a, b) => b.confidence - a.confidence)
    }

    return {
        receipt,
        matches,
        totalMatches: matches.length
    }
})
// server/api/receipts/[id]/matches.ts
import { defineEventHandler } from 'h3'
// Don't use '#app' or other client-only aliases here

export default defineEventHandler(async (event) => {
    const id = event.context.params?.id

    // Return possible transaction matches for this receipt
    return {
        success: true,
        matches: [
            {
                transactionId: 'TRX-7845',
                date: '2025-04-14T12:30:00Z',
                amount: 1299.00,
                description: 'Similar amount and date',
                confidence: 92
            },
            {
                transactionId: 'TRX-7846',
                date: '2025-04-14T09:45:00Z',
                amount: 1320.00,
                description: 'Possible match',
                confidence: 85
            },
            {
                transactionId: 'TRX-7830',
                date: '2025-04-13T14:30:00Z',
                amount: 1299.00,
                description: 'Same amount, different date',
                confidence: 78
            }
        ]
    }
})
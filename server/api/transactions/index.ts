// server/api/transactions/index.ts
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
    // Return a list of transactions
    // This would typically query a database or external API
    return {
        transactions: [
            {
                id: 'TRX-1001',
                reference: 'REF-89734-XTR',
                createdAt: '2025-04-12T15:32:00Z',
                status: 'completed',
                source: 'credit_card',
                amount: 1459.00,
                currency: 'USD',
                customer: {
                    name: 'John Anderson',
                    email: 'john.anderson@example.com'
                }
            },
            {
                id: 'TRX-1002',
                reference: 'REF-89735-XTR',
                createdAt: '2025-04-11T12:30:00Z',
                status: 'pending',
                source: 'payment_gateway',
                amount: 899.50,
                currency: 'USD',
                customer: {
                    name: 'Sarah Thompson',
                    email: 'sarah.thompson@example.com'
                }
            }
        ],
        total: 2
    }
})

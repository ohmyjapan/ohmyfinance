// server/api/transactions/[id].ts
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
    const id = event.context.params?.id

    // In a real application, fetch data from database based on ID
    // For this demo, return a mock transaction
    return {
        id: id || 'TRX-1001',
        reference: `REF-${id?.replace('TRX-', '')}`,
        createdAt: '2025-04-12T15:32:00Z',
        status: 'completed',
        source: 'credit_card',
        amount: 1459.00,
        currency: 'USD',
        customer: {
            name: 'John Anderson',
            email: 'john.anderson@example.com'
        },
        paymentMethod: {
            type: 'VISA',
            last4: '4242',
            expiryDate: '09/2027'
        },
        processor: {
            name: 'VISA Direct',
            gatewayId: 'VD-89223'
        },
        items: [
            {
                name: 'Premium Subscription',
                description: '12-month plan',
                quantity: 1,
                price: 1199.00,
                total: 1199.00
            },
            {
                name: 'Add-on Package',
                description: 'Premium support',
                quantity: 1,
                price: 260.00,
                total: 260.00
            }
        ],
        timeline: [
            {
                type: 'completed',
                title: 'Transaction Completed',
                timestamp: '2025-04-12T15:32:00Z',
                description: 'Payment successfully processed and confirmed.'
            },
            {
                type: 'processing',
                title: 'Payment Processing',
                timestamp: '2025-04-12T15:30:00Z'
            },
            {
                type: 'created',
                title: 'Order Placed',
                timestamp: '2025-04-12T15:28:00Z'
            }
        ]
    }
})
// server/api/shipments/index.ts
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
    // Return a list of shipments
    return {
        shipments: [
            {
                id: 'SHP1001',
                trackingNumber: 'FEDEX-123456789',
                carrier: 'fedex',
                status: 'in_transit',
                createdAt: '2025-04-10T12:00:00Z',
                estimatedDelivery: '2025-04-17T00:00:00Z',
                customer: {
                    name: 'John Anderson',
                    email: 'john.anderson@example.com'
                },
                orderId: 'ORD-9001',
                transactionId: 'TRX-7843',
                destination: {
                    address: '123 Main St',
                    city: 'New York',
                    state: 'NY',
                    postalCode: '10001',
                    country: 'US'
                }
            },
            {
                id: 'SHP1002',
                trackingNumber: 'UPS-987654321',
                carrier: 'ups',
                status: 'delivered',
                createdAt: '2025-04-05T14:30:00Z',
                estimatedDelivery: '2025-04-12T00:00:00Z',
                customer: {
                    name: 'Sarah Thompson',
                    email: 'sarah.thompson@example.com'
                },
                orderId: 'ORD-9002',
                transactionId: 'TRX-7842',
                destination: {
                    address: '456 Park Ave',
                    city: 'Chicago',
                    state: 'IL',
                    postalCode: '60601',
                    country: 'US'
                }
            }
        ],
        total: 2
    }
})
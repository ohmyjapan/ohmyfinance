// server/api/receipts/index.ts
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
    // Return a list of receipts
    return {
        receipts: [
            {
                id: 'receipt_4392',
                filename: 'receipt_4392.pdf',
                size: 438272, // 428 KB
                uploadDate: '2025-04-14T10:32:00Z',
                amount: 189.99,
                merchant: 'Tech Gadgets Inc.',
                status: 'matched',
                transactionId: 'TRX-7843'
            },
            {
                id: 'receipt_4391',
                filename: 'receipt_4391.jpg',
                size: 1258291, // 1.2 MB
                uploadDate: '2025-04-14T09:45:00Z',
                amount: 1299.00,
                merchant: 'ElectroMart',
                status: 'unmatched',
                transactionId: null
            }
        ],
        total: 2
    }
})
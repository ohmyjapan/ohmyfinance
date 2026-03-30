import { defineEventHandler, readBody, createError } from 'h3'
import Supplier from '../../models/Supplier'
import Customer from '../../models/Customer'
import { ensureConnection } from '../../config/database'

/**
 * POST /api/transactions/import-preview
 * Check which supplier/customer names from a pending import don't exist in DB yet.
 * Lets the frontend show a preview of what will be auto-created before committing.
 *
 * Body: { supplierNames: string[], customerNames: string[] }
 * Returns: { newSuppliers: string[], newCustomers: string[] }
 */
export default defineEventHandler(async (event) => {
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed'
        })
    }

    const body = await readBody(event)
    const { supplierNames = [], customerNames = [] } = body || {}

    await ensureConnection()

    const existingSuppliers = await Supplier.find({ name: { $in: supplierNames } }).select('name').lean()
    const existingCustomers = await Customer.find({ name: { $in: customerNames } }).select('name').lean()

    const existingSupplierSet = new Set(existingSuppliers.map((s: any) => s.name))
    const existingCustomerSet = new Set(existingCustomers.map((c: any) => c.name))

    return {
        newSuppliers: supplierNames.filter((n: string) => n && !existingSupplierSet.has(n)),
        newCustomers: customerNames.filter((n: string) => n && !existingCustomerSet.has(n))
    }
})

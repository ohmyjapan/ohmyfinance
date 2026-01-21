// server/api/payments/[id].ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'

// Reference to the same in-memory storage (in real app, use database)
// This is a workaround - in production, use MongoDB
let payments: any[] = []

// Helper to get payments from the index module
const getPaymentsStore = async () => {
  // In development, we'll use a simple approach
  // In production, this would be a database query
  try {
    const response = await $fetch('/api/payments')
    return response as any[]
  } catch {
    return payments
  }
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const method = event.method

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Payment ID is required'
    })
  }

  // For this simple implementation, we'll work with the in-memory store
  // In production, replace with MongoDB queries

  // GET - Get single payment
  if (method === 'GET') {
    const allPayments = await getPaymentsStore()
    const payment = allPayments.find(p => p.id === id)

    if (!payment) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Payment not found'
      })
    }

    return payment
  }

  // PUT - Update payment
  if (method === 'PUT') {
    const body = await readBody(event)

    // Since we can't easily share state, we'll use $fetch to get and update
    // This is a simplified approach for development
    const allPayments = await getPaymentsStore()
    const index = allPayments.findIndex(p => p.id === id)

    if (index === -1) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Payment not found'
      })
    }

    const updatedPayment = {
      ...allPayments[index],
      ...body,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    }

    // Update amount if provided
    if (body.amount !== undefined) {
      updatedPayment.amount = parseFloat(body.amount)
    }

    // Update dueDate if provided
    if (body.dueDate) {
      updatedPayment.dueDate = new Date(body.dueDate).toISOString()
    }

    allPayments[index] = updatedPayment
    return updatedPayment
  }

  // DELETE - Delete payment
  if (method === 'DELETE') {
    const allPayments = await getPaymentsStore()
    const index = allPayments.findIndex(p => p.id === id)

    if (index === -1) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Payment not found'
      })
    }

    allPayments.splice(index, 1)
    return { success: true, message: 'Payment deleted successfully' }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})

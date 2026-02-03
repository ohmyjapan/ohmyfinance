// server/api/recurring/[id].ts
import { defineEventHandler, readBody, createError } from 'h3'
import {
  getRecurringPaymentById,
  updateRecurringPayment,
  deleteRecurringPayment,
  generateTransaction
} from '../../services/recurringPaymentService'

/**
 * GET /api/recurring/:id - Get a recurring payment
 * PUT /api/recurring/:id - Update a recurring payment
 * DELETE /api/recurring/:id - Delete a recurring payment
 * POST /api/recurring/:id - Generate transaction manually
 */
export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  const method = event.method

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Recurring payment ID is required'
    })
  }

  // GET - Get single recurring payment
  if (method === 'GET') {
    try {
      const payment = await getRecurringPaymentById(id)
      if (!payment) {
        throw createError({
          statusCode: 404,
          statusMessage: `Recurring payment ${id} not found`
        })
      }
      return payment
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error(`Error fetching recurring payment ${id}:`, error)
      throw createError({
        statusCode: 500,
        statusMessage: error.message || 'Failed to fetch recurring payment'
      })
    }
  }

  // PUT - Update recurring payment
  if (method === 'PUT' || method === 'PATCH') {
    try {
      const body = await readBody(event)

      // Parse dates if provided
      if (body.startDate) body.startDate = new Date(body.startDate)
      if (body.endDate) body.endDate = new Date(body.endDate)
      if (body.nextDueDate) body.nextDueDate = new Date(body.nextDueDate)

      const payment = await updateRecurringPayment(id, body)
      return {
        success: true,
        message: 'Recurring payment updated',
        payment
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      console.error(`Error updating recurring payment ${id}:`, error)
      throw createError({
        statusCode: error.message?.includes('not found') ? 404 : 500,
        statusMessage: error.message || 'Failed to update recurring payment'
      })
    }
  }

  // DELETE - Delete recurring payment
  if (method === 'DELETE') {
    try {
      const payment = await deleteRecurringPayment(id)
      return {
        success: true,
        message: 'Recurring payment deleted',
        payment
      }
    } catch (error: any) {
      console.error(`Error deleting recurring payment ${id}:`, error)
      throw createError({
        statusCode: error.message?.includes('not found') ? 404 : 500,
        statusMessage: error.message || 'Failed to delete recurring payment'
      })
    }
  }

  // POST - Generate transaction from this recurring payment
  if (method === 'POST') {
    try {
      const result = await generateTransaction(id)
      return {
        success: true,
        message: 'Transaction generated successfully',
        ...result
      }
    } catch (error: any) {
      console.error(`Error generating transaction for ${id}:`, error)
      throw createError({
        statusCode: error.message?.includes('not found') ? 404 : 400,
        statusMessage: error.message || 'Failed to generate transaction'
      })
    }
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method not allowed'
  })
})

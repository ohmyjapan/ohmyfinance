import { defineEventHandler, readBody, createError } from 'h3'

// In a real app, you would use a database
// These are simple in-memory stores that would be shared with other handlers
let shipments = []
let transactions = []

/**
 * POST /api/shipments/:id/update-status
 * Update the status of a shipment and add a status event
 */
export default defineEventHandler(async (event) => {
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
            message: `Method ${event.method} not allowed for this endpoint`
        })
    }

    const shipmentId = event.context.params.id
    const body = await readBody(event)

    // Validate request body
    if (!body.status) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: 'Status is required'
        })
    }

    // Find the shipment
    const shipmentIndex = shipments.findIndex(s => s.id === shipmentId)

    if (shipmentIndex === -1) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
            message: `Shipment with ID ${shipmentId} not found`
        })
    }

    const shipment = shipments[shipmentIndex]

    // Update shipment status
    const updatedShipment = {
        ...shipment,
        status: body.status,
        updatedAt: new Date().toISOString()
    }

    // Add a status event
    const statusEvent = {
        type: body.status,
        title: getStatusTitle(body.status),
        timestamp: new Date().toISOString(),
        description: body.notes || null,
        location: body.location || null
    }

    updatedShipment.events = [
        statusEvent,
        ...(shipment.events || [])
    ]

    // Update shipment in the collection
    shipments[shipmentIndex] = updatedShipment

    // If this shipment is associated with a transaction, update the transaction
    if (updatedShipment.transactionId) {
        const transactionIndex = transactions.findIndex(t => t.id === updatedShipment.transactionId)

        if (transactionIndex !== -1) {
            const transaction = transactions[transactionIndex]

            // Update transaction with new shipment status
            if (transaction.shipment) {
                transaction.shipment.status = updatedShipment.status
                transaction.updatedAt = new Date().toISOString()

                // Add a timeline event for the shipment status update
                if (!transaction.timeline) {
                    transaction.timeline = []
                }

                transaction.timeline.unshift({
                    type: `shipment_${body.status}`,
                    title: `Shipment ${getStatusTitle(body.status)}`,
                    timestamp: new Date().toISOString(),
                    description: body.notes || `Shipment status updated to ${body.status}`
                })

                // Update transaction in the collection
                transactions[transactionIndex] = transaction
            }
        }
    }

    // Should we notify the customer?
    if (body.notifyCustomer && updatedShipment.customer && updatedShipment.customer.email) {
        // In a real app, you would send an email here
        console.log(`[EMAIL] Sending shipment update to ${updatedShipment.customer.email}`)
    }

    return {
        shipment: updatedShipment,
        message: 'Shipment status updated successfully'
    }
})

/**
 * Get a user-friendly title for a status
 */
function getStatusTitle(status: string): string {
    const titles = {
        pending: 'Pending',
        processing: 'Processing',
        in_transit: 'In Transit',
        out_for_delivery: 'Out for Delivery',
        delivered: 'Delivered',
        delayed: 'Delayed',
        exception: 'Exception',
        cancelled: 'Cancelled'
    }

    return titles[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
}
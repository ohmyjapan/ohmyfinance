// server/services/shipmentService.ts
import { randomUUID } from 'crypto'
import {
    findAll,
    findById,
    findBy,
    create,
    update,
    remove
} from '../utils/database'
import { getTransactionById, linkShipmentToTransaction } from './transactionService'

/**
 * Get all shipments with optional filtering
 */
export async function getShipments(filters = {}) {
    try {
        const shipments = await findAll('shipments')

        // Apply filters if provided
        if (Object.keys(filters).length > 0) {
            return shipments.filter(shipment => {
                for (const [key, value] of Object.entries(filters)) {
                    // Handle special cases
                    if (key === 'dateFrom' && shipment.createdAt < value) return false
                    if (key === 'dateTo' && shipment.createdAt > value) return false
                    if (key === 'search') {
                        const searchValue = String(value).toLowerCase()
                        const searchFields = ['id', 'trackingNumber', 'carrier', 'customerName']
                        const matches = searchFields.some(field =>
                            shipment[field] &&
                            String(shipment[field]).toLowerCase().includes(searchValue)
                        )
                        if (!matches) return false
                    }
                    // Standard equality check for other fields
                    else if (key in shipment && shipment[key] !== value) {
                        return false
                    }
                }
                return true
            })
        }

        return shipments
    } catch (error) {
        console.error('Failed to get shipments:', error)
        throw error
    }
}

/**
 * Get a shipment by ID
 */
export async function getShipmentById(id: string) {
    try {
        return findById('shipments', id)
    } catch (error) {
        console.error(`Failed to get shipment ${id}:`, error)
        throw error
    }
}

/**
 * Create a new shipment
 */
export async function createShipment(data: any) {
    try {
        const shipment = {
            id: `shp_${randomUUID().replace(/-/g, '')}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: data.status || 'pending',
            events: [
                {
                    type: 'created',
                    title: 'Shipment Created',
                    timestamp: new Date().toISOString(),
                    description: 'Shipment record created'
                }
            ],
            ...data
        }

        // Create the shipment
        const newShipment = await create('shipments', shipment)

        // If a transaction ID is provided, link the shipment to it
        if (data.transactionId) {
            await linkShipmentToTransaction(data.transactionId, newShipment.id)
        }

        return newShipment
    } catch (error) {
        console.error('Failed to create shipment:', error)
        throw error
    }
}

/**
 * Update a shipment
 */
export async function updateShipment(id: string, data: any) {
    try {
        // Don't allow changing certain fields
        const { id: _, createdAt, events: existingEvents, ...updateData } = data

        // Get the current shipment to merge events
        const currentShipment = await getShipmentById(id)
        if (!currentShipment) {
            throw new Error(`Shipment ${id} not found`)
        }

        // If status is changing, add a new event
        if (updateData.status && updateData.status !== currentShipment.status) {
            const statusEvent = {
                type: updateData.status,
                title: `Shipment ${formatStatus(updateData.status)}`,
                timestamp: new Date().toISOString(),
                description: updateData.statusNotes || `Status updated to ${updateData.status}`
            }

            // Remove statusNotes from update data
            delete updateData.statusNotes

            // Add the new event to the existing events
            updateData.events = [statusEvent, ...(currentShipment.events || [])]
        }

        // Add updatedAt timestamp
        updateData.updatedAt = new Date().toISOString()

        return update('shipments', id, updateData)
    } catch (error) {
        console.error(`Failed to update shipment ${id}:`, error)
        throw error
    }
}

/**
 * Delete a shipment
 */
export async function deleteShipment(id: string) {
    try {
        // Get the shipment first
        const shipment = await getShipmentById(id)
        if (!shipment) {
            throw new Error(`Shipment ${id} not found`)
        }

        // If shipment is linked to a transaction, update the transaction
        if (shipment.transactionId) {
            // This is a simplified version - in a real app, you'd use a transaction
            // to ensure atomicity
            const transaction = await getTransactionById(shipment.transactionId)
            if (transaction) {
                await update('transactions', shipment.transactionId, {
                    shipmentId: null,
                    hasShipment: false,
                    updatedAt: new Date().toISOString()
                })
            }
        }

        // Remove the shipment
        return remove('shipments', id)
    } catch (error) {
        console.error(`Failed to delete shipment ${id}:`, error)
        throw error
    }
}

/**
 * Add a tracking event to a shipment
 */
export async function addTrackingEvent(shipmentId: string, eventData: any) {
    try {
        // Get the current shipment
        const shipment = await getShipmentById(shipmentId)
        if (!shipment) {
            throw new Error(`Shipment ${shipmentId} not found`)
        }

        // Create the new event
        const event = {
            type: eventData.type || 'update',
            title: eventData.title || 'Tracking Update',
            timestamp: new Date().toISOString(),
            description: eventData.description || '',
            location: eventData.location
        }

        // Add the new event to the existing events
        const events = [event, ...(shipment.events || [])]

        // Update shipment status if provided
        let status = shipment.status
        if (eventData.status) {
            status = eventData.status
        }

        // Update the shipment
        return updateShipment(shipmentId, { events, status })
    } catch (error) {
        console.error(`Failed to add tracking event to shipment ${shipmentId}:`, error)
        throw error
    }
}

/**
 * Get shipment statistics
 */
export async function getShipmentStats() {
    try {
        const shipments = await findAll('shipments')

        const total = shipments.length

        const getStatusCount = (status) => shipments.filter(s => s.status === status).length

        const pending = getStatusCount('pending')
        const processing = getStatusCount('processing')
        const inTransit = getStatusCount('in_transit')
        const delivered = getStatusCount('delivered')
        const failed = getStatusCount('failed')
        const cancelled = getStatusCount('cancelled')

        return {
            total,
            pending,
            processing,
            inTransit,
            delivered,
            failed,
            cancelled
        }
    } catch (error) {
        console.error('Failed to get shipment stats:', error)
        throw error
    }
}

// Helper function to format status for display
function formatStatus(status: string) {
    // Convert snake_case or kebab-case to Title Case
    return status
        .replace(/[-_]/g, ' ')
        .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.substr(1).toLowerCase())
}
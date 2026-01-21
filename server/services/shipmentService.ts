// server/services/shipmentService.ts
import Shipment from '../models/Shipment'
import Transaction from '../models/Transaction'
import type { IShipment, IShipmentEvent } from '../models/Shipment'

interface ShipmentFilters {
  status?: string
  carrier?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

/**
 * Get all shipments with optional filtering
 */
export async function getShipments(filters: ShipmentFilters = {}) {
  try {
    const query: any = {}

    if (filters.status) {
      query.status = filters.status
    }

    if (filters.carrier) {
      query.carrier = { $regex: filters.carrier, $options: 'i' }
    }

    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {}
      if (filters.dateFrom) {
        query.createdAt.$gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        query.createdAt.$lte = new Date(filters.dateTo)
      }
    }

    if (filters.search) {
      query.$or = [
        { trackingNumber: { $regex: filters.search, $options: 'i' } },
        { carrier: { $regex: filters.search, $options: 'i' } },
        { notes: { $regex: filters.search, $options: 'i' } }
      ]
    }

    const shipments = await Shipment.find(query)
      .sort({ createdAt: -1 })
      .populate('transactionIds')
      .lean()

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
    const shipment = await Shipment.findById(id)
      .populate('transactionIds')
      .lean()
    return shipment
  } catch (error) {
    console.error(`Failed to get shipment ${id}:`, error)
    throw error
  }
}

/**
 * Create a new shipment
 */
export async function createShipment(data: Partial<IShipment> & { transactionId?: string }) {
  try {
    const shipmentData: Partial<IShipment> = {
      ...data,
      status: data.status || 'pending',
      events: [{
        type: 'created',
        title: 'Shipment Created',
        timestamp: new Date(),
        description: 'Shipment record created'
      }]
    }

    // Handle single transactionId
    if (data.transactionId) {
      shipmentData.transactionIds = [data.transactionId as any]
    }

    const shipment = new Shipment(shipmentData)
    await shipment.save()

    // Update linked transactions
    if (shipment.transactionIds && shipment.transactionIds.length > 0) {
      for (const txnId of shipment.transactionIds) {
        await Transaction.findByIdAndUpdate(txnId, {
          shipment: {
            shipmentId: shipment._id,
            trackingNumber: shipment.trackingNumber,
            carrier: shipment.carrier,
            status: shipment.status,
            estimatedDelivery: shipment.estimatedDelivery,
            address: shipment.shippingAddress
          },
          $push: {
            timeline: {
              $each: [{
                type: 'shipment_created',
                title: 'Shipment Created',
                timestamp: new Date(),
                description: `Shipment ${shipment.trackingNumber || shipment._id} created`
              }],
              $position: 0
            }
          }
        })
      }
    }

    return shipment.toObject()
  } catch (error) {
    console.error('Failed to create shipment:', error)
    throw error
  }
}

/**
 * Update a shipment
 */
export async function updateShipment(id: string, data: Partial<IShipment> & { statusNotes?: string }) {
  try {
    const currentShipment = await Shipment.findById(id)
    if (!currentShipment) {
      throw new Error(`Shipment ${id} not found`)
    }

    // Don't allow changing certain fields
    const { _id, createdAt, events: existingEvents, statusNotes, ...updateData } = data as any

    // If status is changing, add a new event
    if (updateData.status && updateData.status !== currentShipment.status) {
      const statusEvent: IShipmentEvent = {
        type: updateData.status,
        title: `Shipment ${formatStatus(updateData.status)}`,
        timestamp: new Date(),
        description: statusNotes || `Status updated to ${updateData.status}`
      }

      updateData.$push = { events: { $each: [statusEvent], $position: 0 } }
    }

    const shipment = await Shipment.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).lean()

    // Update linked transactions with new shipment status
    if (shipment && shipment.transactionIds && shipment.transactionIds.length > 0) {
      for (const txnId of shipment.transactionIds) {
        await Transaction.findByIdAndUpdate(txnId, {
          'shipment.status': shipment.status,
          'shipment.trackingNumber': shipment.trackingNumber,
          'shipment.carrier': shipment.carrier,
          'shipment.estimatedDelivery': shipment.estimatedDelivery
        })
      }
    }

    return shipment
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
    const shipment = await Shipment.findById(id)
    if (!shipment) {
      throw new Error(`Shipment ${id} not found`)
    }

    // Update linked transactions to remove shipment reference
    if (shipment.transactionIds && shipment.transactionIds.length > 0) {
      for (const txnId of shipment.transactionIds) {
        await Transaction.findByIdAndUpdate(txnId, {
          shipment: null,
          $push: {
            timeline: {
              $each: [{
                type: 'shipment_removed',
                title: 'Shipment Removed',
                timestamp: new Date(),
                description: 'Shipment was deleted'
              }],
              $position: 0
            }
          }
        })
      }
    }

    await Shipment.findByIdAndDelete(id)

    return shipment.toObject()
  } catch (error) {
    console.error(`Failed to delete shipment ${id}:`, error)
    throw error
  }
}

/**
 * Add a tracking event to a shipment
 */
export async function addTrackingEvent(shipmentId: string, eventData: Partial<IShipmentEvent> & { status?: string }) {
  try {
    const shipment = await Shipment.findById(shipmentId)
    if (!shipment) {
      throw new Error(`Shipment ${shipmentId} not found`)
    }

    const event: IShipmentEvent = {
      type: eventData.type || 'update',
      title: eventData.title || 'Tracking Update',
      timestamp: new Date(),
      description: eventData.description,
      location: eventData.location
    }

    const updateData: any = {
      $push: { events: { $each: [event], $position: 0 } }
    }

    // Update status if provided
    if (eventData.status) {
      updateData.status = eventData.status
    }

    const updatedShipment = await Shipment.findByIdAndUpdate(
      shipmentId,
      updateData,
      { new: true }
    ).lean()

    return updatedShipment
  } catch (error) {
    console.error(`Failed to add tracking event to shipment ${shipmentId}:`, error)
    throw error
  }
}

/**
 * Link transactions to a shipment
 */
export async function linkTransactions(shipmentId: string, transactionIds: string[]) {
  try {
    const shipment = await Shipment.findById(shipmentId)
    if (!shipment) {
      throw new Error(`Shipment ${shipmentId} not found`)
    }

    // Add transaction IDs to shipment
    await Shipment.findByIdAndUpdate(shipmentId, {
      $addToSet: { transactionIds: { $each: transactionIds } }
    })

    // Update each transaction with shipment reference
    for (const txnId of transactionIds) {
      await Transaction.findByIdAndUpdate(txnId, {
        shipment: {
          shipmentId: shipment._id,
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.carrier,
          status: shipment.status
        },
        $push: {
          timeline: {
            $each: [{
              type: 'shipment_linked',
              title: 'Linked to Shipment',
              timestamp: new Date(),
              description: `Linked to shipment ${shipment.trackingNumber || shipment._id}`
            }],
            $position: 0
          }
        }
      })
    }

    return await Shipment.findById(shipmentId).lean()
  } catch (error) {
    console.error(`Failed to link transactions to shipment ${shipmentId}:`, error)
    throw error
  }
}

/**
 * Unlink transactions from a shipment
 */
export async function unlinkTransactions(shipmentId: string, transactionIds: string[]) {
  try {
    const shipment = await Shipment.findById(shipmentId)
    if (!shipment) {
      throw new Error(`Shipment ${shipmentId} not found`)
    }

    // Remove transaction IDs from shipment
    await Shipment.findByIdAndUpdate(shipmentId, {
      $pull: { transactionIds: { $in: transactionIds } }
    })

    // Update each transaction to remove shipment reference
    for (const txnId of transactionIds) {
      await Transaction.findByIdAndUpdate(txnId, {
        shipment: null,
        $push: {
          timeline: {
            $each: [{
              type: 'shipment_unlinked',
              title: 'Unlinked from Shipment',
              timestamp: new Date(),
              description: `Unlinked from shipment ${shipment.trackingNumber || shipment._id}`
            }],
            $position: 0
          }
        }
      })
    }

    return await Shipment.findById(shipmentId).lean()
  } catch (error) {
    console.error(`Failed to unlink transactions from shipment ${shipmentId}:`, error)
    throw error
  }
}

/**
 * Get shipment statistics
 */
export async function getShipmentStats() {
  try {
    const stats = await Shipment.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ]
        }
      }
    ])

    const total = stats[0].total[0]?.count || 0
    const statusCounts = stats[0].byStatus.reduce((acc: any, item: any) => {
      acc[item._id] = item.count
      return acc
    }, {})

    return {
      total,
      pending: statusCounts.pending || 0,
      processing: statusCounts.processing || 0,
      shipped: statusCounts.shipped || 0,
      inTransit: statusCounts.in_transit || 0,
      outForDelivery: statusCounts.out_for_delivery || 0,
      delivered: statusCounts.delivered || 0,
      failed: statusCounts.failed || 0,
      returned: statusCounts.returned || 0,
      cancelled: statusCounts.cancelled || 0
    }
  } catch (error) {
    console.error('Failed to get shipment stats:', error)
    throw error
  }
}

// Helper function to format status for display
function formatStatus(status: string): string {
  return status
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.substr(1).toLowerCase())
}

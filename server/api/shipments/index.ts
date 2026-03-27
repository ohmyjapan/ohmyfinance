// server/api/shipments/index.ts
import { defineEventHandler, getQuery, readBody, getMethod } from 'h3'
import { getShipments, createShipment, getShipmentStats } from '../../services/shipmentService'
import { requireAuth } from '../../middleware/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)

    // Check if stats are requested
    if (query.stats === 'true') {
      const stats = await getShipmentStats()
      return { stats }
    }

    const filters = {
      status: query.status as string | undefined,
      carrier: query.carrier as string | undefined,
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      search: query.search as string | undefined
    }

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof typeof filters] === undefined) {
        delete filters[key as keyof typeof filters]
      }
    })

    const shipments = await getShipments(filters)

    return {
      shipments,
      total: shipments.length
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)

    const shipment = await createShipment({
      trackingNumber: body.trackingNumber,
      carrier: body.carrier,
      status: body.status || 'pending',
      shippingDate: body.shippingDate ? new Date(body.shippingDate) : undefined,
      estimatedDelivery: body.estimatedDelivery ? new Date(body.estimatedDelivery) : undefined,
      shippingAddress: body.shippingAddress || body.address,
      shippingCost: body.shippingCost,
      shippingMethod: body.shippingMethod,
      weight: body.weight,
      dimensions: body.dimensions,
      notes: body.notes,
      transactionId: body.transactionId,
      transactionIds: body.transactionIds
    })

    return shipment
  }

  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed'
  })
})

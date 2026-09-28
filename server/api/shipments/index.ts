// server/api/shipments/index.ts
import { defineEventHandler, getQuery, readBody, getMethod, createError } from 'h3'
import { getShipments, createShipment, getShipmentStats } from '../../services/shipmentService'
import { requireLedgerAccess } from '../../services/ledgerAccessService'

export default defineEventHandler(async (event) => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write')
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)

    // Check if stats are requested
    if (query.stats === 'true') {
      const stats = await getShipmentStats(access)
      return { stats }
    }

    const filters = {
      transactionId: query.transactionId as string | undefined,
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

    const shipments = await getShipments(access, filters)

    return {
      shipments,
      total: shipments.length
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw createError({ statusCode: 400, statusMessage: 'Shipment details required' })
    }

    const shipment = await createShipment(access, {
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

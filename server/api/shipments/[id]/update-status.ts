import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { updateShipmentStatus } from '../../../services/shipmentService'
import { requireOrganization } from '../../../middleware/auth'

/** POST /api/shipments/:id/update-status */
export default defineEventHandler(async (event) => {
  const auth = requireOrganization(event)
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  const shipment = await updateShipmentStatus(
    getRouterParam(event, 'id'), auth.organizationId, await readBody(event)
  )
  return { shipment, message: 'Shipment status updated successfully' }
})

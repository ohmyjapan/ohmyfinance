import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { updateShipmentStatus, getShipmentById } from '../../../services/shipmentService'
import { requireLedgerAccess } from '../../../services/ledgerAccessService'

/** POST /api/shipments/:id/update-status */
export default defineEventHandler(async (event) => {
  const access = await requireLedgerAccess(event, 'write')
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  const shipment = await updateShipmentStatus(
    getRouterParam(event, 'id'), access.organizationId, await readBody(event)
  )
  return { shipment: await getShipmentById(access, shipment.id), message: 'Shipment status updated successfully' }
})

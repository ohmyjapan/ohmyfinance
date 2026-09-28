import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireLedgerAccess } from '../../services/ledgerAccessService'
import { getShipmentById, updateShipment, deleteShipment } from '../../services/shipmentService'

export default defineEventHandler(async event => {
  const access = await requireLedgerAccess(event, event.method === 'GET' ? 'read' : 'write')
  const id = getRouterParam(event, 'id') || ''
  if (event.method === 'GET') return getShipmentById(access, id)
  if (event.method === 'PUT' || event.method === 'PATCH') return updateShipment(access, id, await readBody(event))
  if (event.method === 'DELETE') return deleteShipment(access, id)
  throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
})

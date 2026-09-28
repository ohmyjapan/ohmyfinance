// server/services/shipmentService.ts
import Shipment, { SHIPMENT_STATUSES } from '../models/Shipment'
import { Types } from 'mongoose'
import { createError } from 'h3'
import { ensureConnection } from '../config/database'
import Transaction from '../models/Transaction'
import type { IShipment, IShipmentEvent } from '../models/Shipment'
import type { LedgerAccess } from './ledgerAccessService'

interface ShipmentFilters {
  transactionId?: string
  status?: string
  carrier?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

/** Save status and its history in one document; linked purchases are unchanged. */
export async function updateShipmentStatus(id: string | undefined, organizationId: string | undefined, input: unknown) {
  if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
    throw createError({ statusCode: 403, statusMessage: 'No organization selected' })
  }
  if (!id || !Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Valid shipment ID is required' })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'Shipment status is required' })
  }
  const body = input as Record<string, unknown>
  if (typeof body.status !== 'string' || !SHIPMENT_STATUSES.includes(body.status)) {
    throw createError({ statusCode: 400, statusMessage: 'Valid shipment status is required' })
  }
  for (const key of ['notes', 'statusNotes', 'location']) {
    if (body[key] != null && typeof body[key] !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Shipment notes and location must be text' })
    }
  }
  const status = body.status
  const history: IShipmentEvent = {
    type: status,
    title: `Shipment ${formatStatus(status)}`,
    timestamp: new Date(),
    description: (body.notes ?? body.statusNotes ?? `Status updated to ${status}`) as string,
    location: body.location == null ? undefined : body.location as string
  }
  await ensureConnection()
  const scope = { _id: id, organizationId }
  const changed = await Shipment.findOneAndUpdate(
    { ...scope, status: { $ne: status } },
    { $set: { status }, $push: { events: { $each: [history], $position: 0 } }, $inc: { __v: 1 } },
    { new: true, runValidators: true }
  ).lean()
  // A same-status retry needs no event or timestamp update. Re-read with the
  // same organization scope; it must not reveal a foreign shipment.
  const shipment = changed || await Shipment.findOne(scope).lean()
  if (!shipment) throw createError({ statusCode: 404, statusMessage: 'Shipment not found' })
  return { ...shipment, id: shipment._id.toString() }
}


type ShipmentRecord = IShipment & { __v?: number }
type ShipmentInput = Partial<IShipment> & { transactionId?: string; statusNotes?: string }
const editable = ['trackingNumber', 'carrier', 'status', 'shippingDate', 'estimatedDelivery', 'deliveryDate', 'shippingAddress', 'shippingCost', 'shippingMethod', 'weight', 'dimensions', 'notes', 'metadata'] as const
const missing = () => createError({ statusCode: 404, statusMessage: 'Shipment or linked purchase not found in this organization' })
const conflict = (message: string) => createError({ statusCode: 409, statusMessage: message })
function shipmentScope(access: LedgerAccess, id: string) {
  if (!Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Valid shipment ID required' })
  return { _id: id, organizationId: access.organizationId }
}
function shipmentFields(data: ShipmentInput) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw createError({ statusCode: 400, statusMessage: 'Shipment details required' })
  if (data.status != null && !SHIPMENT_STATUSES.includes(data.status)) throw createError({ statusCode: 400, statusMessage: 'Valid shipment status required' })
  if (data.statusNotes != null && typeof data.statusNotes !== 'string') throw createError({ statusCode: 400, statusMessage: 'Status notes must be text' })
  return Object.fromEntries(editable.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
}
function transactionIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.some(value => !(value instanceof Types.ObjectId) && (typeof value !== 'string' || !Types.ObjectId.isValid(value)))) {
    throw createError({ statusCode: 400, statusMessage: 'Valid transactionIds array required' })
  }
  return [...new Set(input.map(value => new Types.ObjectId(value).toHexString()))]
}
async function verifiedTransactions(access: LedgerAccess, input: unknown) {
  const ids = transactionIds(input)
  const count = await Transaction.countDocuments({ organizationId: access.organizationId, _id: { $in: ids } })
  if (count !== ids.length) throw missing()
  return ids
}
async function requireShipment(access: LedgerAccess, id: string) {
  const shipment = await Shipment.findOne(shipmentScope(access, id)).lean<ShipmentRecord>()
  if (!shipment) throw missing()
  return shipment
}

/** The shipment owns its links. Read purchases in one company-scoped batch;
 * never mirror this many-to-many relationship onto accounting records. */
async function shipmentViews(access: LedgerAccess, shipments: any[]) {
  const ids = shipments.flatMap(shipment => shipment.transactionIds || [])
  const transactions = await Transaction.find({ organizationId: access.organizationId, _id: { $in: ids } }).lean()
  const byId = new Map(transactions.map(transaction => [String(transaction._id), transaction]))
  return shipments.map(shipment => {
    const linked = (shipment.transactionIds || []).map((id: any) => byId.get(String(id))).filter(Boolean)
    return { ...shipment, id: String(shipment._id), organizationId: String(shipment.organizationId),
      createdBy: shipment.createdBy ? String(shipment.createdBy) : undefined,
      transactionIds: linked.map((transaction: any) => String(transaction._id)), transactions: linked }
  })
}

export async function getShipments(access: LedgerAccess, filters: ShipmentFilters = {}) {
  await ensureConnection()
  const query: any = { organizationId: access.organizationId }
  if (filters.status) query.status = filters.status
  if (filters.carrier) query.carrier = { $regex: filters.carrier, $options: 'i' }
  if (filters.transactionId) query.transactionIds = (await verifiedTransactions(access, [filters.transactionId]))[0]
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {}
    if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom)
    if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo)
  }
  if (filters.search) query.$or = ['trackingNumber', 'carrier', 'notes'].map(key => ({ [key]: { $regex: filters.search, $options: 'i' } }))
  return shipmentViews(access, await Shipment.find(query).sort({ createdAt: -1 }).lean())
}

export async function getShipmentById(access: LedgerAccess, id: string) {
  await ensureConnection()
  return (await shipmentViews(access, [await requireShipment(access, id)]))[0]
}

export async function createShipment(access: LedgerAccess, data: ShipmentInput) {
  await ensureConnection()
  const fields = shipmentFields(data)
  const ids = await verifiedTransactions(access, [...transactionIds(data.transactionIds ?? []), ...(data.transactionId ? [data.transactionId] : [])])
  const shipment = await Shipment.create({ ...fields, organizationId: access.organizationId, createdBy: access.userId,
    transactionIds: ids, status: data.status || 'pending',
    events: [{ type: 'created', title: 'Shipment Created', timestamp: new Date(), description: 'Shipment record created' }] })
  return (await shipmentViews(access, [shipment.toObject()]))[0]
}

export async function updateShipment(access: LedgerAccess, id: string, data: ShipmentInput) {
  await ensureConnection()
  const current = await requireShipment(access, id), fields: any = shipmentFields(data)
  if (Object.hasOwn(data, 'transactionIds') || Object.hasOwn(data, 'transactionId')) {
    fields.transactionIds = await verifiedTransactions(access, [...transactionIds(data.transactionIds ?? []), ...(data.transactionId ? [data.transactionId] : [])])
  }
  const update: any = { $set: fields, $inc: { __v: 1 } }
  if (fields.status && fields.status !== current.status) update.$push = { events: { $each: [{
    type: fields.status, title: 'Shipment ' + formatStatus(fields.status), timestamp: new Date(),
    description: data.statusNotes || 'Status updated to ' + fields.status
  }], $position: 0 } }
  const shipment = await Shipment.findOneAndUpdate(
    { ...shipmentScope(access, id), __v: current.__v ?? { $exists: false } }, update, { new: true, runValidators: true }
  ).lean()
  if (!shipment) { await requireShipment(access, id); throw conflict('Shipment changed; refresh before saving your edits') }
  return (await shipmentViews(access, [shipment]))[0]
}

export async function deleteShipment(access: LedgerAccess, id: string) {
  await ensureConnection()
  const shipment = await Shipment.findOneAndDelete(shipmentScope(access, id)).lean()
  if (!shipment) throw missing()
  return (await shipmentViews(access, [shipment]))[0]
}

export async function linkTransactions(access: LedgerAccess, shipmentId: string, input: unknown) {
  await ensureConnection()
  await requireShipment(access, shipmentId)
  const ids = await verifiedTransactions(access, input)
  if (!ids.length) return getShipmentById(access, shipmentId)
  await Shipment.findOneAndUpdate(
    { ...shipmentScope(access, shipmentId), transactionIds: { $not: { $all: ids } } },
    { $addToSet: { transactionIds: { $each: ids } }, $inc: { __v: 1 } }, { new: true, runValidators: true }
  ).lean()
  return getShipmentById(access, shipmentId)
}

/** Unlink only mutates this shipment, so corrupt/dangling references can be removed. */
export async function unlinkTransactions(access: LedgerAccess, shipmentId: string, input: unknown) {
  await ensureConnection()
  await requireShipment(access, shipmentId)
  const ids = transactionIds(input)
  await Shipment.findOneAndUpdate(
    { ...shipmentScope(access, shipmentId), transactionIds: { $in: ids } },
    { $pull: { transactionIds: { $in: ids } }, $inc: { __v: 1 } }, { new: true }
  ).lean()
  return getShipmentById(access, shipmentId)
}

export async function addTrackingEvent(access: LedgerAccess, shipmentId: string, data: Partial<IShipmentEvent> & { status?: string; requestId?: string }) {
  await ensureConnection()
  await requireShipment(access, shipmentId)
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.requestId !== 'string' || !data.requestId.trim() || data.requestId.length > 128) {
    throw createError({ statusCode: 400, statusMessage: 'A tracking requestId is required for safe retries' })
  }
  for (const key of ['type', 'title', 'description', 'location'] as const) if (data[key] != null && typeof data[key] !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Tracking event details must be text' })
  }
  if (data.status != null && !SHIPMENT_STATUSES.includes(data.status)) throw createError({ statusCode: 400, statusMessage: 'Valid shipment status required' })
  const type = data.type || 'update', title = data.title || 'Tracking Update'
  const fingerprint = JSON.stringify([type, title, data.description ?? null, data.location ?? null, data.status ?? null])
  const event: IShipmentEvent = { type, title, description: data.description, location: data.location, timestamp: new Date(),
    data: { requestId: data.requestId, requestFingerprint: fingerprint } }
  const update: any = { $push: { events: { $each: [event], $position: 0 } }, $inc: { __v: 1 } }
  if (data.status) update.$set = { status: data.status }
  const changed = await Shipment.findOneAndUpdate(
    { ...shipmentScope(access, shipmentId), events: { $not: { $elemMatch: { 'data.requestId': data.requestId } } } },
    update, { new: true, runValidators: true }
  ).lean()
  if (!changed) {
    const current = await requireShipment(access, shipmentId)
    const existing = current.events.find(event => event.data?.requestId === data.requestId)
    if (!existing || existing.data?.requestFingerprint !== fingerprint) throw conflict('Tracking requestId was already used for different details')
  }
  return getShipmentById(access, shipmentId)
}

export async function getShipmentStats(access: LedgerAccess) {
  await ensureConnection()
  const counts = await Shipment.aggregate([
    { $match: { organizationId: new Types.ObjectId(access.organizationId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ])
  const byStatus = Object.fromEntries(counts.map(row => [row._id, row.count]))
  return { total: counts.reduce((sum, row) => sum + row.count, 0), pending: byStatus.pending || 0,
    processing: byStatus.processing || 0, shipped: byStatus.shipped || 0, inTransit: byStatus.in_transit || 0,
    outForDelivery: byStatus.out_for_delivery || 0, delivered: byStatus.delivered || 0, failed: byStatus.failed || 0,
    returned: byStatus.returned || 0, cancelled: byStatus.cancelled || 0, delayed: byStatus.delayed || 0, exception: byStatus.exception || 0 }
}

// Helper function to format status for display
function formatStatus(status: string): string {
  return status
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.substr(1).toLowerCase())
}

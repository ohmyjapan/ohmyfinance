import { createError, getHeader, type H3Event } from 'h3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import mongoose from 'mongoose'
import Receipt from '../models/Receipt'
import { ensureConnection } from '../config/database'
import { getReceiptById } from './receiptManagementService'
import type { LedgerAccess } from './ledgerAccessService'

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function fail(statusCode: number, statusMessage: string): never { throw createError({ statusCode, statusMessage }) }
function originalPath(company: string, hash: string) {
  if (!/^[a-f\d]{24}$/i.test(company) || !/^[a-f\d]{64}$/.test(hash)) fail(409, 'Receipt storage identity is invalid')
  return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'receipts', company.toLowerCase(), hash)
}
function media(bytes: Buffer) {
  if (!bytes.length) fail(400, 'Receipt file is empty')
  if (bytes.length > RECEIPT_MAX_BYTES) fail(413, 'Receipt exceeds 10 MB')
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (bytes.subarray(4, 8).toString() === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx'].includes(bytes.subarray(8, 12).toString())) return 'image/heic'
  return fail(415, 'Select a PDF, PNG, JPEG, WebP or HEIC receipt')
}

export async function readReceiptUpload(event: H3Event) {
  const maximum = RECEIPT_MAX_BYTES + 64 * 1024
  let oversized = Number(getHeader(event, 'content-length') || 0) > maximum
  const chunks: Buffer[] = []; let size = 0
  for await (const data of event.node.req) {
    const chunk = Buffer.from(data); size += chunk.length
    if (size > maximum) oversized = true
    // Drain rejected input without retaining it. Ending the response while the
    // client is still sending a chunked body can reset the connection before 413.
    if (oversized) chunks.length = 0
    else chunks.push(chunk)
  }
  if (oversized) fail(413, 'Receipt upload exceeds 10 MB')
  let form: FormData
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { 'content-type': getHeader(event, 'content-type') || '' } }).formData() }
  catch { return fail(400, 'Invalid receipt upload') }
  const files = form.getAll('file')
  if (files.length !== 1 || typeof files[0] === 'string') fail(400, 'Upload one receipt file at a time')
  const file = files[0] as File
  return { bytes: Buffer.from(await file.arrayBuffer()), name: file.name }
}

async function validOriginal(target: string, hash: string, size: number) {
  try { const bytes = await readFile(target); return bytes.length === size && digest(bytes) === hash }
  catch (error: any) { if (error.code === 'ENOENT') return false; throw error }
}
async function publish(target: string, bytes: Buffer, hash: string) {
  await mkdir(path.dirname(target), { recursive: true })
  if (await validOriginal(target, hash, bytes.length)) return
  const temporary = target + '.' + randomUUID() + '.part'
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    try { await rename(temporary, target) }
    catch (error) { if (!await validOriginal(target, hash, bytes.length)) throw error }
  } finally {
    await unlink(temporary).catch((error: any) => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function uploadReceiptFile(access: LedgerAccess, bytes: Buffer, originalName: string) {
  const mimeType = media(bytes), hash = digest(bytes), target = originalPath(access.organizationId, hash)
  const name = Array.from(String(originalName || 'receipt').split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 200).join('') || 'receipt'
  await ensureConnection(); await Receipt.init()
  const scope = { organizationId: access.organizationId, fileHash: hash }
  const existing = await Receipt.findOne(scope).select('_id').lean()
  // Publish first: a DB failure leaves recoverable content at the same hash.
  // Never delete an original after an uncertain database result.
  await publish(target, bytes, hash)
  if (existing) return getReceiptById(access, String(existing._id))
  const id = new mongoose.Types.ObjectId()
  try {
    await Receipt.create({ _id: id, ...scope, storageVersion: 1, filename: 'receipt_' + id,
      originalFilename: name, size: bytes.length, mimeType, fileUrl: `/api/receipts/${id}/file`,
      uploadedBy: access.userId, uploadDate: new Date(), status: 'unmatched', linkVersion: 0,
      amount: null, merchant: null, currency: 'JPY', tags: ['uploaded'] })
    return getReceiptById(access, String(id))
  } catch (error: any) {
    if (error.code !== 11000) throw error
    const winner = await Receipt.findOne(scope).select('_id').lean()
    if (!winner) throw error
    return getReceiptById(access, String(winner._id))
  }
}

export async function downloadReceiptFile(access: LedgerAccess, id: string) {
  if (!mongoose.isObjectIdOrHexString(id)) fail(400, 'Invalid receipt ID')
  await ensureConnection()
  const receipt = await Receipt.findOne({ _id: id, organizationId: access.organizationId }).lean()
  if (!receipt) fail(404, 'Receipt not found')
  if (receipt.storageVersion !== 1 || !receipt.fileHash) fail(404, 'Receipt original is not registered')
  let bytes: Buffer
  try { bytes = await readFile(originalPath(access.organizationId, receipt.fileHash)) }
  catch (error: any) { if (error.code === 'ENOENT') return fail(404, 'Receipt original is missing. Upload the same file to restore it.'); throw error }
  if (bytes.length !== receipt.size || digest(bytes) !== receipt.fileHash) fail(409, 'Receipt original is damaged. Upload the same file to restore it.')
  return { bytes, name: receipt.originalFilename, mimeType: media(bytes) }
}

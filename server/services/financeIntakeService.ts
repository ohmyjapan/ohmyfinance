// Intake (購入受付) service: owner-scoped records, original files and attachments by hash, sheet reading, import planning.
// Plan omf-intake-feature-20261016 §2. Reuses fail/id/ready (financeService), digest (shared/amex.mjs), the wx temp file +
// hard link store of acceptImport, the UTF-8-then-Shift_JIS decode of parseAmex and the signature checks of addDocument.
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import mongoose from 'mongoose'
import * as XLSX from 'xlsx'
import { fail, id, ready } from './financeService'
import { digest } from '../../shared/amex.mjs'
import { IntakeRecord, IntakeDocument, IntakeBatch, IntakeTemplate, initializeIntake } from '../models/FinanceIntake'
import { FIELDS, STATES, normalize, externalKey, manualKey, guessMapping, mappedRows, planImport, text, type IntakeValues, type IntakeMapping, type IntakeRecordShape, type IntakeExtra, type IntakeExtraColumn } from '../../shared/finance-intake.mjs'

export const MAX_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 5000
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLS_TYPE = 'application/vnd.ms-excel'
const TEXT_TYPES = ['text/csv', 'text/tab-separated-values', 'text/plain']
const SHEET_TYPES = new Set([XLSX_TYPE, XLS_TYPE, ...TEXT_TYPES])
const FIELD_KEYS = FIELDS.map(f => f[0])
const isXlsx = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
const isXls = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
// UTF-8 first, Shift_JIS second (shared/amex.mjs:55-56); a NUL byte or an undecodable file is not text.
export function decodeText(bytes: Buffer): string | null {
  if (!bytes.length || bytes.includes(0)) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {}
  try { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes) } catch { return null }
}
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': b => b.subarray(0, 5).toString() === '%PDF-',
  'image/png': b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': b => b[0] === 255 && b[1] === 216 && b[2] === 255,
  'image/webp': b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  [XLSX_TYPE]: isXlsx,
  // Windows browsers label a .csv as application/vnd.ms-excel: accept BIFF bytes or decodable text under that type.
  [XLS_TYPE]: b => isXls(b) || decodeText(b) !== null,
  'text/csv': b => decodeText(b) !== null, 'text/tab-separated-values': b => decodeText(b) !== null, 'text/plain': b => decodeText(b) !== null
}
const TYPE_MESSAGE = 'PDF・PNG・JPEG・WebP・Excel・CSVを選択してください（最大10MB）。'
async function init() { await ready(); await initializeIntake() }
const str = (v: any, max: number) => typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b-\x1f]/.test(v)
function filePath(ownerId: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) fail(400, 'Invalid document')
  return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'intake', id(ownerId), hash)
}
function checkName(name: any) { if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\x00-\x1f\\/]/.test(name)) fail(400, 'ファイル名を確認してください。'); return name.trim() }
function checkBytes(bytes: Buffer, mimeType: string) { if (!bytes.length || bytes.length > MAX_BYTES || !SIGNATURES[mimeType]?.(bytes)) fail(415, TYPE_MESSAGE) }
// F1 (plan omf-monthly-reconciliation-20261020): `{ intake: true }` is used only by the intake sheet reader (sheetOf below). Without
// options — the bank statement upload, preview, import and collector capture — both functions behave exactly as released.
export function readWorkbook(bytes: Buffer, options: { intake?: boolean } = {}): XLSX.WorkBook {
  try {
    if (isXlsx(bytes) || isXls(bytes)) return XLSX.read(bytes, options.intake === true ? { type: 'buffer', cellNF: true } : { type: 'buffer' })
    const decoded = decodeText(bytes); if (decoded === null) fail(415, TYPE_MESSAGE)
    return XLSX.read(decoded.replace(/^﻿/, ''), { type: 'string', raw: true })
  } catch (error: any) { if (error?.statusCode) throw error; return fail(415, 'Excel・CSVとして読み取れません。') }
}
export interface IntakeCellNote { row: number; column: number; kind: 'number' | 'date' | 'imprecise'; shown: string }
export function sheetRows(workbook: XLSX.WorkBook, sheet: string, options: { intake?: boolean; notes?: IntakeCellNote[] } = {}): string[][] {
  const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: '', blankrows: true })
  if (rows.length > MAX_ROWS + 1) fail(400, '行数は5000行までです。ファイルを分割してください。')
  const typed = options.intake === true
  if (!typed) return rows.map(row => (Array.isArray(row) ? row : []).map(text))
  return intakeRows(workbook, sheet, rows, options.notes)
}
// Intake reading of typed cells, at the same positions as the display rows above (rows[i][j] is the cell at the sheet range's
// start + i / + j, blank rows kept). Text cells: unchanged. Date-formatted numbers: ISO yyyy-mm-dd (with HH:MM[:SS] when a time is
// set), from the serial and the workbook's 1900/1904 date system. Integer numbers shown as General or scientific: the actual value
// when it has at most 15 digits. Other formats (zero padding such as 00000, separators): the formatted text, unchanged. A number of
// 16 or more digits keeps its display and is noted: Excel stores 15 significant digits, so its last digits are not in the file.
const isDateFormat = (format: string) => !!XLSX.SSF.is_date(format) && /[yd]/i.test(format.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''))
function isoDate(serial: number, date1904: boolean): string | null {
  if (serial < 1) return null
  const d = XLSX.SSF.parse_date_code(serial, { date1904 }), pad = (n: number) => String(n).padStart(2, '0')
  if (!d || d.y < 1900 || d.y > 9999) return null
  const day = d.y + '-' + pad(d.m) + '-' + pad(d.d)
  if (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return null
  return d.H || d.M || d.S ? day + ' ' + pad(d.H) + ':' + pad(d.M) + (d.S ? ':' + pad(d.S) : '') : day
}
function intakeRows(workbook: XLSX.WorkBook, sheet: string, rows: any[][], notes?: IntakeCellNote[]): string[][] {
  const ws: any = workbook.Sheets[sheet], range = XLSX.utils.decode_range(ws?.['!ref'] || 'A1'), date1904 = !!workbook.Workbook?.WBProps?.date1904
  return rows.map((row, i) => (Array.isArray(row) ? row : []).map((value, j) => {
    const shown = text(value), cell = ws?.[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + j })]
    if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || !Number.isFinite(cell.v)) return shown
    const format = typeof cell.z === 'string' ? cell.z : 'General', note = (kind: IntakeCellNote['kind']) => notes?.push({ row: i + 1, column: j, kind, shown })
    if (isDateFormat(format)) { const iso = isoDate(cell.v, date1904); if (iso) { note('date'); return iso } return shown }
    if (Math.abs(cell.v) >= 1e15) { note('imprecise'); return shown }
    note('number')
    return Number.isInteger(cell.v) && (format === 'General' || /E[+-]/i.test(format) || /E[+-]\d/i.test(shown)) ? String(cell.v) : shown
  }))
}
const documentView = (d: any) => ({ id: String(d._id), name: d.name, mimeType: d.mimeType, size: d.size, hash: d.hash, kind: d.kind, sheetNames: d.sheetNames || [], recordId: d.recordId ? String(d.recordId) : null, createdAt: d.createdAt, url: '/api/finance-intake/documents/' + d._id + '/file' })
// Same bytes for the same owner = the same document and one file on disk (acceptImport's wx temp file + hard link).
async function storeDocument(ownerId: string, name: string, bytes: Buffer, mimeType: string, kind: 'source' | 'attachment', sheetNames: string[]) {
  const hash = digest(bytes)
  const existing: any = await IntakeDocument.findOne({ ownerId, hash }).lean()
  if (existing) return existing
  const target = filePath(ownerId, hash); await mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.' + randomUUID() + '.partial'
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  try { await link(temporary, target) } catch (error: any) { if (error.code !== 'EEXIST') throw error; if (digest(await readFile(target)) !== hash) fail(500, 'Archived file integrity mismatch') }
  finally { await unlink(temporary) }
  const created = await IntakeDocument.create({ ownerId, hash, name, mimeType, size: bytes.length, kind, sheetNames })
  return created.toObject()
}
async function ownedDocument(ownerId: string, documentId: string): Promise<any> {
  const doc: any = await IntakeDocument.findOne({ _id: id(documentId), ownerId }).lean()
  if (!doc) fail(404, '書類が見つかりません。')
  return doc
}
async function ownedRecord(ownerId: string, recordId: string): Promise<any> {
  const record: any = await IntakeRecord.findOne({ _id: id(recordId), ownerId }).lean()
  if (!record) fail(404, '受付が見つかりません。')
  return record
}
const shape = (r: any): IntakeRecordShape => ({ id: String(r._id), key: r.key, values: r.values, extra: r.extra || {}, createdAt: r.createdAt, updatedAt: r.updatedAt, revision: r.revision, history: r.history || [], provenance: r.provenance || [], identityReview: !!r.identityReview, archived: !!r.archived })
const recordView = (r: any, attachments?: any[]) => ({ id: String(r._id), key: r.key, values: r.values, extra: r.extra || {}, provenance: (r.provenance || []).map((p: any) => ({ documentId: p.documentId, fileName: p.fileName, sheet: p.sheet, row: p.row, hash: p.hash })), history: r.history || [], revision: r.revision, identityReview: !!r.identityReview, archived: !!r.archived, archivedAt: r.archivedAt || null, createdAt: r.createdAt, updatedAt: r.updatedAt, ...(attachments ? { attachments: attachments.map(documentView) } : {}) })
function valuesInput(input: any): Partial<IntakeValues> {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '入力内容を確認してください。')
  const out: any = {}
  for (const [k, v] of Object.entries(input)) { if (!FIELD_KEYS.includes(k as any)) fail(400, '不明な項目があります: ' + String(k).slice(0, 40)); if (v === null || v === undefined) continue; if (typeof v === 'number') out[k] = String(v); else if (str(v, 2000)) out[k] = v; else fail(400, '入力内容を確認してください。') }
  return out
}
// Owner-named extra values: { name: value }, up to 30 names of up to 60 characters, values up to 2000 characters.
const EXTRA_MESSAGE = '追加項目を確認してください。'
const extraName = (name: any) => { if (!str(name, 60) || !name.trim()) fail(400, EXTRA_MESSAGE); return name.trim() as string }
function extraInput(input: any): IntakeExtra {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 30) fail(400, EXTRA_MESSAGE)
  const out: IntakeExtra = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) { const name = extraName(k); if (v === null || v === undefined) continue; if (typeof v === 'number') out[name] = String(v); else if (str(v, 2000)) out[name] = v as string; else fail(400, EXTRA_MESSAGE) }
  return out
}
const revisionOf = (body: any, record: any) => { if (!Number.isSafeInteger(Number(body?.revision)) || Number(body.revision) !== record.revision) fail(409, '他の画面で更新されています。再読み込みしてください。'); return record.revision as number }
const STALE = '他の画面で更新されています。再読み込みしてください。'
// The prototype's manual-save identity rule: an external key another active record already holds flags identity review and
// keeps a manual key; otherwise the external key (or the previous key) is the identity.
async function identityFor(ownerId: string, selfId: mongoose.Types.ObjectId, values: IntakeValues, previousKey: string) {
  const external = externalKey(values)
  const taken = !!external && !!await IntakeRecord.exists({ ownerId, _id: { $ne: selfId }, key: external })
  return { identityReview: taken, key: taken ? manualKey(selfId.toHexString()) : external || previousKey }
}
export async function listRecords(ownerId: string, options: { archived?: boolean } = {}) {
  await init()
  const all: any[] = await IntakeRecord.find({ ownerId }).sort({ updatedAt: -1 }).limit(5000).lean()
  const active = all.filter(r => !r.archived)
  const counts: Record<string, number> = { total: all.length, archived: all.length - active.length, review: active.filter(r => r.identityReview).length }
  for (const state of STATES) counts[state] = active.filter(r => r.values?.purchaseState === state).length
  return { records: (options.archived ? all.filter(r => r.archived) : active).map(r => recordView(r)), counts }
}
export async function readRecord(ownerId: string, recordId: string) {
  await init(); const record = await ownedRecord(ownerId, recordId)
  return recordView(record, await IntakeDocument.find({ ownerId, recordId: record._id }).sort({ createdAt: 1 }).lean())
}
export async function createRecord(ownerId: string, body: any) {
  await init()
  const values = normalize(valuesInput(body?.values)), _id = new mongoose.Types.ObjectId(), now = new Date().toISOString()
  const extra: IntakeExtra = {}; for (const [k, v] of Object.entries(extraInput(body?.extra))) if (text(v) !== '') extra[k] = text(v)
  const identity = await identityFor(ownerId, _id, values, manualKey(_id.toHexString()))
  const created = await IntakeRecord.create({ _id, ownerId, key: identity.key, values, extra, provenance: [], history: [{ at: now, kind: 'new', changes: [], source: null }], revision: 1, identityReview: identity.identityReview, archived: false })
  return recordView(created.toObject(), [])
}
export async function patchRecord(ownerId: string, recordId: string, body: any) {
  await init(); const record = await ownedRecord(ownerId, recordId); const revision = revisionOf(body, record)
  const incoming = valuesInput(body?.values), merged: any = { ...record.values }
  for (const [k, v] of Object.entries(incoming)) if (text(v) !== '') merged[k] = v
  const values = normalize(merged), changes: { field: string; before: string; after: string }[] = FIELDS.filter(([k]) => (record.values[k] || '') !== values[k]).map(([k]) => ({ field: k, before: record.values[k] || '', after: values[k] }))
  // Extras follow the same rule: a blank or absent name keeps the stored value; changes are labelled extra:<name>.
  const storedExtra: IntakeExtra = record.extra || {}, extra: IntakeExtra = { ...storedExtra }
  for (const [k, v] of Object.entries(extraInput(body?.extra))) if (text(v) !== '' && (storedExtra[k] || '') !== text(v)) { changes.push({ field: 'extra:' + k, before: storedExtra[k] || '', after: text(v) }); extra[k] = text(v) }
  const identity = await identityFor(ownerId, record._id, values, record.key), now = new Date().toISOString()
  const result = await IntakeRecord.updateOne({ _id: record._id, ownerId, revision }, { $set: { values, extra, key: identity.key, identityReview: identity.identityReview, revision: revision + 1 }, $push: { history: { at: now, kind: 'edit', changes, source: null } } })
  if (!result.matchedCount) fail(409, STALE)
  return readRecord(ownerId, recordId)
}
export async function archiveRecord(ownerId: string, recordId: string, body: any) {
  await init(); const record = await ownedRecord(ownerId, recordId); const revision = revisionOf(body, record), archived = !!body?.archived, now = new Date().toISOString()
  const result = await IntakeRecord.updateOne({ _id: record._id, ownerId, revision }, { $set: { archived, archivedAt: archived ? new Date() : null, revision: revision + 1 }, $push: { history: { at: now, kind: archived ? 'archive' : 'restore', changes: [], source: null } } })
  if (!result.matchedCount) fail(409, STALE)
  return readRecord(ownerId, recordId)
}
export async function attachDocument(ownerId: string, recordId: string, name: any, kind: any, bytes: Buffer, mimeType: string) {
  await init(); const record = await ownedRecord(ownerId, recordId)
  if (kind !== 'attachment') fail(400, '書類の種類を確認してください。')
  const fileName = checkName(name); checkBytes(bytes, mimeType)
  const sheetNames = SHEET_TYPES.has(mimeType) && (isXlsx(bytes) || isXls(bytes) || decodeText(bytes) !== null) ? readWorkbook(bytes).SheetNames : []
  const doc = await storeDocument(ownerId, fileName, bytes, mimeType, 'attachment', sheetNames)
  if (doc.recordId && String(doc.recordId) !== String(record._id)) fail(409, 'この書類は別の受付に添付済みです。')
  if (!doc.recordId) await IntakeDocument.updateOne({ _id: doc._id, ownerId }, { $set: { recordId: record._id } })
  await IntakeRecord.updateOne({ _id: record._id, ownerId }, { $inc: { revision: 1 }, $push: { history: { at: new Date().toISOString(), kind: 'attachment', changes: [], source: null, name: fileName, documentId: String(doc._id) } } })
  return readRecord(ownerId, recordId)
}
export async function downloadDocument(ownerId: string, documentId: string) {
  await init(); const doc = await ownedDocument(ownerId, documentId)
  const bytes = await readFile(filePath(ownerId, doc.hash))
  if (digest(bytes) !== doc.hash || bytes.length !== doc.size) fail(409, '書類の整合性を確認できません。')
  return { doc, bytes }
}
export async function uploadFile(ownerId: string, name: any, bytes: Buffer, mimeType: string) {
  await init(); const fileName = checkName(name)
  if (!SHEET_TYPES.has(mimeType)) fail(415, 'Excel（xlsx・xls）またはCSVを選択してください（最大10MB）。')
  checkBytes(bytes, mimeType)
  const workbook = readWorkbook(bytes); if (!workbook.SheetNames.length) fail(415, 'シートが見つかりません。')
  const doc = await storeDocument(ownerId, fileName, bytes, mimeType, 'source', workbook.SheetNames)
  if (!doc.sheetNames?.length) await IntakeDocument.updateOne({ _id: doc._id, ownerId }, { $set: { sheetNames: workbook.SheetNames } })
  return { document: documentView({ ...doc, sheetNames: workbook.SheetNames }) }
}
async function sheetOf(ownerId: string, documentId: string, sheet: any, headerRow: any) {
  const doc = await ownedDocument(ownerId, documentId)
  const workbook = readWorkbook(await readFile(filePath(ownerId, doc.hash)), { intake: true })
  const name = sheet ? String(sheet) : workbook.SheetNames[0]
  if (!workbook.SheetNames.includes(name)) fail(400, 'シートが見つかりません。')
  const header = headerRow === undefined || headerRow === '' ? 1 : Number(headerRow)
  if (!Number.isSafeInteger(header) || header < 1 || header > 100) fail(400, '見出し行を確認してください。')
  const notes: IntakeCellNote[] = [], rows = sheetRows(workbook, name, { intake: true, notes }), headers = rows[header - 1] || [], data = rows.slice(header)
  // F1: what the owner must know about the data rows' cell types (non-blocking): numeric and date columns, and the numbers whose
  // digits Excel did not keep (first 20, with the total).
  const below = notes.filter(n => n.row > header), columns = (kinds: string[]) => [...new Set(below.filter(n => kinds.includes(n.kind)).map(n => n.column))].sort((a, b) => a - b)
  const imprecise = below.filter(n => n.kind === 'imprecise')
  const cellNotes = { numericColumns: columns(['number', 'imprecise']), dateColumns: columns(['date']), imprecise: imprecise.slice(0, 20).map(({ row, column, shown }) => ({ row, column, shown })), impreciseCount: imprecise.length }
  return { doc, workbook, sheet: name, headerRow: header, headers, data, cellNotes }
}
export async function readSheet(ownerId: string, documentId: string, sheet: any, headerRow: any) {
  await init(); const s = await sheetOf(ownerId, documentId, sheet, headerRow)
  const filled = s.data.filter(r => r.some(Boolean))
  return { document: documentView(s.doc), sheet: s.sheet, headerRow: s.headerRow, headers: s.headers, rows: filled.slice(0, 20), rowCount: filled.length, mapping: guessMapping(s.headers), cellNotes: s.cellNotes }
}
function mappingInput(input: any, headers: string[]): IntakeMapping {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '列の割り当てを確認してください。')
  const out: any = {}
  for (const k of FIELD_KEYS) { const v = input[k]; if (v === undefined || v === null || v === '') { out[k] = ''; continue } if (!/^\d{1,4}$/.test(String(v)) || Number(v) >= headers.length) fail(400, '列の割り当てを確認してください。'); out[k] = String(Number(v)) }
  for (const k of Object.keys(input)) if (!FIELD_KEYS.includes(k as any)) fail(400, '不明な項目があります: ' + String(k).slice(0, 40))
  return out
}
// Extra columns of an import or template: [{ name, column }], up to 30, unique names, column by the mapping rule above.
function extrasInput(input: any, headers: string[]): IntakeExtraColumn[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input) || input.length > 30) fail(400, EXTRA_MESSAGE)
  const out: IntakeExtraColumn[] = [], seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object') fail(400, EXTRA_MESSAGE)
    const name = extraName(item.name), column = item.column
    if (seen.has(name) || FIELD_KEYS.includes(name as any) || !/^\d{1,4}$/.test(String(column)) || Number(column) >= headers.length) fail(400, EXTRA_MESSAGE)
    seen.add(name); out.push({ name, column: String(Number(column)) })
  }
  return out
}
function defaultsInput(input: any) {
  const values = valuesInput(input), out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) if (text(v) !== '') out[k] = text(v)
  return out
}
async function planFor(ownerId: string, documentId: string, body: any) {
  const s = await sheetOf(ownerId, documentId, body?.sheet, body?.headerRow)
  const mapping = mappingInput(body?.mapping, s.headers), defaults = defaultsInput(body?.defaults), extras = extrasInput(body?.extras, s.headers)
  if (!Object.values(mapping).some(Boolean) && !extras.length) fail(400, '少なくとも一列を割り当ててください。')
  const incoming = mappedRows(s.data, mapping, defaults, { hash: s.doc.hash, fileName: s.doc.name, documentId: String(s.doc._id), sheet: s.sheet, firstRow: s.headerRow + 1 }, extras).filter(r => r.provenance.raw.some(Boolean))
  const stored: any[] = await IntakeRecord.find({ ownerId }).limit(20001).lean()
  if (stored.length > 20000) fail(409, '受付が多すぎます。先にアーカイブしてください。')
  // F1 fold: the reading the rows were mapped with, so a re-read file row re-keys only the record that still carries its stored identity.
  const plan = planImport(stored.map(shape), incoming, { id: () => new mongoose.Types.ObjectId().toHexString(), reading: { mapping, defaults } })
  // F1: non-blocking warnings — identifier fields mapped to numeric cells (zeros and digits beyond 15 are not in the file), and
  // numbers whose display is all the file keeps. Nothing is guessed or rejected.
  const warnings: any[] = []
  for (const field of ['orderId', 'itemId', 'externalOrderId', 'invoiceNumber', 'account'] as const) if (mapping[field] !== '' && s.cellNotes.numericColumns.includes(Number(mapping[field]))) warnings.push({ kind: 'numeric-id', field, column: Number(mapping[field]) })
  for (const column of [...new Set(s.cellNotes.imprecise.map(n => n.column))]) warnings.push({ kind: 'imprecise-number', column, rows: s.cellNotes.imprecise.filter(n => n.column === column).map(n => n.row).slice(0, 5), shown: s.cellNotes.imprecise.find(n => n.column === column)?.shown || '' })
  return { ...s, mapping, defaults, extras, plan, warnings }
}
const planCounts = (plan: any) => ({ new: plan.new, update: plan.update, unchanged: plan.unchanged, ambiguous: plan.ambiguous, identityChanged: plan.identityChanged || 0, provenanceConflicts: plan.provenanceConflicts || 0 })
export async function previewImport(ownerId: string, documentId: string, body: any) {
  await init(); const p = await planFor(ownerId, documentId, body)
  return { document: documentView(p.doc), sheet: p.sheet, headerRow: p.headerRow, headers: p.headers, mapping: p.mapping, defaults: p.defaults, extras: p.extras, counts: planCounts(p.plan), warnings: p.warnings, cellNotes: p.cellNotes, rows: p.plan.rows.map(r => ({ row: r.row, operation: r.operation, ambiguous: r.ambiguous, identityReview: r.record.identityReview, key: r.record.key, values: r.record.values, extra: r.record.extra || {}, changes: r.changes, identityChanged: r.identityChanged || null, provenanceConflict: r.provenanceConflict || [] })) }
}
// Inserts by the unique (ownerId, key) index or updates with the revision the plan read; a row another tab changed meanwhile
// is a conflict (left alone; the next run shows it as unchanged or plans it again). No lease, no hold.
export async function applyImport(ownerId: string, documentId: string, body: any) {
  await init(); const p = await planFor(ownerId, documentId, body)
  const counts = { ...planCounts(p.plan), conflicts: 0 }, recordIds: mongoose.Types.ObjectId[] = []
  counts.new = 0; counts.update = 0; counts.unchanged = 0
  for (const row of p.plan.rows) {
    const r = row.record, _id = new mongoose.Types.ObjectId(r.id)
    if (row.operation === 'new') {
      try { await IntakeRecord.create({ _id, ownerId, key: r.key, values: r.values, extra: r.extra || {}, provenance: r.provenance, history: r.history, revision: r.revision, identityReview: r.identityReview, archived: false }); counts.new++; recordIds.push(_id) }
      catch (error: any) { if (error?.code !== 11000) throw error; counts.conflicts++ }
    } else if (row.operation === 'update') {
      // F1: `key` is written too — unchanged for an ordinary update, the corrected identity for a same-file row rebind. A key another
      // record took meanwhile (unique index) is a conflict like a revision change: left alone and planned again on the next run.
      let result: any = null
      try { result = await IntakeRecord.updateOne({ _id, ownerId, revision: r.revision - 1 }, { $set: { key: r.key, values: r.values, extra: r.extra || {}, provenance: r.provenance, history: r.history, revision: r.revision, identityReview: r.identityReview } }) }
      catch (error: any) { if (error?.code !== 11000) throw error }
      if (result?.matchedCount) { counts.update++; recordIds.push(_id) } else counts.conflicts++
    } else { counts.unchanged++; recordIds.push(_id) }
  }
  const batch = await IntakeBatch.create({ ownerId, documentId: p.doc._id, hash: p.doc.hash, sheet: p.sheet, headerRow: p.headerRow, mapping: p.mapping, defaults: p.defaults, extras: p.extras, counts, recordIds })
  const template = body?.template?.name !== undefined ? await saveTemplate(ownerId, { name: body.template.name, service: p.defaults.service || '', account: p.defaults.account || '', currency: p.defaults.currency || '', headers: p.headers, mapping: p.mapping, extras: p.extras }) : null
  return { batch: batchView(batch.toObject(), p.doc), ...(template ? { template: template.template } : {}) }
}
const batchView = (b: any, doc: any) => ({ id: String(b._id), documentId: String(b.documentId), fileName: doc?.name || '', hash: b.hash, sheet: b.sheet, headerRow: b.headerRow, mapping: b.mapping, defaults: b.defaults, extras: b.extras || [], counts: b.counts, recordCount: (b.recordIds || []).length, createdAt: b.createdAt })
export async function listBatches(ownerId: string) {
  await init()
  const batches: any[] = await IntakeBatch.find({ ownerId }).sort({ createdAt: -1 }).limit(200).lean()
  const docs: any[] = await IntakeDocument.find({ ownerId, _id: { $in: batches.map(b => b.documentId) } }).select('name').lean()
  const names = new Map(docs.map(d => [String(d._id), d]))
  return { batches: batches.map(b => batchView(b, names.get(String(b.documentId)))) }
}
const templateView = (t: any) => ({ id: String(t._id), name: t.name, service: t.service || '', account: t.account || '', currency: t.currency || '', headers: t.headers || [], mapping: t.mapping, extras: t.extras || [], revision: t.revision, updatedAt: t.updatedAt })
export async function listTemplates(ownerId: string) {
  await init()
  return { templates: (await IntakeTemplate.find({ ownerId }).sort({ name: 1 }).limit(500).lean()).map(templateView) }
}
export async function saveTemplate(ownerId: string, body: any) {
  await init()
  if (!str(body?.name, 100) || !body.name.trim()) fail(400, 'テンプレート名を確認してください。')
  for (const k of ['service', 'account', 'currency']) if (body[k] !== undefined && !str(body[k], 200)) fail(400, 'テンプレートの既定値を確認してください。')
  if (!Array.isArray(body?.headers) || body.headers.length > 500 || body.headers.some((h: any) => !str(h, 500))) fail(400, 'テンプレートの見出しを確認してください。')
  const mapping = mappingInput(body?.mapping, body.headers), extras = extrasInput(body?.extras, body.headers)
  if (!Object.values(mapping).some(Boolean) && !extras.length) fail(400, '少なくとも一列を割り当ててください。')
  const saved: any = await IntakeTemplate.findOneAndUpdate({ ownerId, name: body.name.trim() }, { $set: { service: text(body.service), account: text(body.account), currency: text(body.currency), headers: body.headers.map(text), mapping, extras }, $inc: { revision: 1 }, $setOnInsert: { ownerId, name: body.name.trim() } }, { upsert: true, new: true }).lean()
  return { template: templateView(saved) }
}

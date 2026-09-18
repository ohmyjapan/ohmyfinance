import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FinanceWorkflow as Workflow, FinanceWorkflowSource as Source, FinanceWorkflowReceipt as Receipt, FinanceWorkflowInvestigation as Investigation } from '../models/FinanceWorkflow'
import { FinanceDocument, FinanceDraft } from '../models/FinanceDraft'
import { FinancePurchaseLink as Purchase } from '../models/FinancePurchaseLink'
import { downloadDocument } from './financeDraftService'
import { leasedRun, sourcePath } from './financeWorkflowService'
import { withPurchaseGraph, checkPurchaseAllocations } from './financePurchaseGraphService'
import { withWorkflowPayment } from './financeWorkflowEvidenceService'
import { ready, id, fail } from './financeService'
import { digest } from '../../shared/amex.mjs'
import { validateReceiptReading } from '../../shared/finance-workflow-receipts.mjs'
import { buildInvestigation, validateInvestigationReport, automaticPurchaseCandidate } from '../../shared/finance-workflow-investigation.mjs'
import { validatePurchaseOrder } from '../../shared/finance-purchase-links.mjs'
const hash = (v: any) => digest(JSON.stringify(v))
const originalPath = (owner: string, h: string) => { if (!/^[a-f0-9]{64}$/.test(h)) fail(400, 'Invalid original hash'); return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'purchase-documents', id(owner), h) }
async function init() { await ready(); await Promise.all([Receipt.init(), Investigation.init(), Purchase.init()]) }
const publicInvestigation = (r: any) => r ? { id: String(r._id), revision: r.revision, fingerprint: r.fingerprint, status: r.status, report: r.report, alternatives: r.context.alternatives, offline: r.context.offline, artifacts: r.artifacts, decisions: r.decisions } : null
async function scopedRow(agent: any, run: any, rowId: string) {
 const row: any = await Workflow.findOne({ _id: id(rowId), ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).lean()
 if (!row) fail(404, 'Workflow not found'); return row
}
async function snapshot(agent: any, run: any, kind: string, accountId?: any) {
 const source: any = await Source.findOne({ ownerId: agent.ownerId, runId: run._id, kind, ...(accountId ? { accountIds: accountId } : {}) }).lean()
 if (!source) return null
 const bytes = await readFile(sourcePath(String(agent.ownerId), source.hash)); if (digest(bytes) !== source.hash || bytes.length !== source.size) fail(409, 'Snapshot integrity failed')
 return { ...JSON.parse(bytes.toString('utf8')), sourceId: String(source._id), name: source.name, url: source.scope.url, complete: source.complete, accountIds: source.scope.externalAccountIds || [] }
}
export async function workflowReceiptList(agent: any, runId: string, body: any) {
 await init(); const { run } = await leasedRun(agent, runId, body?.lease)
 const rows: any[] = await Workflow.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).select('importId line').lean()
 const documents: any[] = rows.length ? await FinanceDocument.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, kind: { $in: ['receipt', 'invoice', 'other'] }, $or: rows.map(r => ({ importId: r.importId, line: r.line })) }).limit(1001).lean() : []
 if (documents.length > 1000) fail(409, 'Receipt scope exceeds limit')
 const readings: any[] = await Receipt.find({ ownerId: agent.ownerId, documentId: { $in: documents.map(d => d._id) } }).lean()
 return { documents: documents.map(d => ({ id: String(d._id), importId: String(d.importId), line: d.line, hash: d.hash, name: d.name, mimeType: d.mimeType, reading: readings.find(r => String(r.documentId) === String(d._id) && r.hash === d.hash)?.reading || null })) }
}
export async function workflowReceiptFile(agent: any, runId: string, body: any) {
 const listed = await workflowReceiptList(agent, runId, body), doc = listed.documents.find(d => d.id === body.documentId && d.hash === body.hash)
 if (!doc) fail(404, 'Receipt outside this workflow')
 const captured = await downloadDocument(String(agent.ownerId), doc.id)
 return { ...doc, base64: captured.bytes.toString('base64') }
}
export async function saveWorkflowReceipt(agent: any, runId: string, body: any) {
 const listed = await workflowReceiptList(agent, runId, body), doc = listed.documents.find(d => d.id === body.documentId && d.hash === body.hash)
 if (!doc || !Array.isArray(body.models) || !body.models.length || body.models.some((m: any) => typeof m !== 'string' || m.length > 100)) fail(400, 'Invalid receipt extraction')
 let reading: any; try { reading = validateReceiptReading(body.reading) } catch { fail(400, 'Receipt evidence could not be verified') }
 const existing: any = await Receipt.findOne({ ownerId: agent.ownerId, documentId: doc.id, hash: doc.hash }).lean()
 if (existing) { if (hash(existing.reading) !== hash(reading)) fail(409, 'Receipt already has a saved reading'); return { saved: true } }
 await leasedRun(agent, runId, body.lease)
 try { await Receipt.create({ ownerId: agent.ownerId, documentId: doc.id, hash: doc.hash, reading, models: body.models }) } catch (e: any) { if (e.code !== 11000) throw e; fail(409, 'Receipt reading changed') }
 return { saved: true }
}
export async function prepareWorkflowInvestigation(agent: any, runId: string, body: any) {
 await init(); const { run } = await leasedRun(agent, runId, body?.lease), row = await scopedRow(agent, run, body.id)
 const connected: any = row.purchaseId ? await Purchase.findOne({ _id: row.purchaseId, ownerId: agent.ownerId, status: 'linked' }).lean() : null
 if (connected && connected.order.kind !== 'receipt') fail(409, 'Online purchase is already connected')
 const peers: any[] = await Workflow.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).select('payment purchaseId').lean()
 const claims: any[] = (await Purchase.find({ ownerId: agent.ownerId, status: 'linked' }).select('archiveId inventoryIds order.inventoryLinks').lean()).map((c: any) => ({ ...c, ...(connected && c.archiveId === connected.archiveId ? { receiptId: c.archiveId, archiveId: null } : {}) }))
 const documents = (await workflowReceiptList(agent, runId, body)).documents
 if (connected?.order.receipt) {
  const d = documents.find(d => d.hash === connected.order.receipt.hash && d.id === connected.order.receipt.documentId)
  const receipt = d?.reading?.receipts.find((r: any) => r.index === connected.order.receipt.record)
  if (receipt) for (const item of receipt.items) { const confirmed = connected.order.items.find((i: any) => i.line === item.line && i.quantityBasis === 'owner_confirmed'); if (item.quantity === undefined && confirmed) { item.quantity = confirmed.quantity; item.quantityBasis = 'owner_confirmed' } }
 }
 const draft: any = await FinanceDraft.findOne({ ownerId: agent.ownerId, importId: row.importId, line: row.line, key: row.key, sourceHash: row.sourceHash }).lean()
 const ref = draft?.evidence?.receiptNumber
 const confirmedReference = ref?.state === 'confirmed' && /^\d{4,15}$/.test(draft?.values?.receiptNumber || '') ? { reference: draft.values.receiptNumber, evidence: ref } : null
 const archive = await snapshot(agent, run, 'orders', row.accountId), inventory = await snapshot(agent, run, 'inventory')
 const previous: any = await Investigation.findOne({ ownerId: agent.ownerId, workflowId: row._id }).lean()
 const ownerNotes = (previous?.decisions || []).filter((d: any) => d.action === 'owner_note').map((d: any) => ({ text: d.text, scope: d.scope, at: d.at }))
 let context: any; try { context = buildInvestigation({ row: { ...row, id: String(row._id) }, peers: peers.map(p => ({ ...p, id: String(p._id) })), archive, inventory, receipts: documents, claims, confirmedReference, ownerNotes }) } catch (e: any) { fail(409, e.message) }
 if (previous?.fingerprint === context.fingerprint) return { context, investigation: publicInvestigation(previous), cached: !!previous.report }
 if ((previous?.decisions?.length || 0) >= 100) fail(409, 'Investigation decision history limit reached')
 const value = { context, fingerprint: context.fingerprint, report: null, artifacts: [], status: 'pending' }
 await leasedRun(agent, runId, body.lease)
 let saved: any
 if (previous) {
  saved = await Investigation.findOneAndUpdate({ _id: previous._id, revision: previous.revision }, { $set: value, $inc: { revision: 1 }, ...(previous.report ? { $push: { decisions: { at: new Date(), action: 'evidence_refreshed', fingerprint: previous.fingerprint, report: previous.report } } } : {}) }, { new: true }).lean()
  if (!saved) fail(409, 'Investigation changed')
 } else {
  try { saved = (await Investigation.create({ ownerId: agent.ownerId, workflowId: row._id, revision: 1, ...value })).toObject() } catch (e: any) { if (e.code === 11000) fail(409, 'Investigation changed'); throw e }
 }
 return { context, investigation: publicInvestigation(saved), cached: false }
}
export async function saveWorkflowInvestigation(agent: any, runId: string, body: any) {
 const { run } = await leasedRun(agent, runId, body?.lease), row = await scopedRow(agent, run, body.id)
 const r: any = await Investigation.findOne({ ownerId: agent.ownerId, workflowId: row._id }).lean()
 if (!r || r.fingerprint !== body.fingerprint || r.revision !== body.revision) fail(409, 'Investigation changed')
 if (!Array.isArray(body.models) || !body.models.length || body.models.some((m: any) => typeof m !== 'string' || m.length > 100)) fail(400, 'Interpreter provenance required')
 let report: any; try { report = validateInvestigationReport(body.report, r.context) } catch (e: any) { fail(400, e.message) }
 const saved: any = await Investigation.findOneAndUpdate({ _id: r._id, revision: r.revision }, { $set: { report, models: body.models, status: 'proposed' }, $inc: { revision: 1 } }, { new: true }).lean()
 if (!saved) fail(409, 'Investigation changed')
 return publicInvestigation(saved)
}
export async function workflowInvestigationView(ownerId: string, workflowId: string) {
 await init(); if (!await Workflow.exists({ _id: id(workflowId), ownerId })) fail(404, 'Workflow not found')
 const row: any = await Workflow.findOne({ _id: workflowId, ownerId }).lean(), purchase: any = await Purchase.findOne({ ownerId, importId: row.importId, line: row.line, status: 'linked' }).select('revision order').lean()
 return { investigation: publicInvestigation(await Investigation.findOne({ ownerId, workflowId }).lean()), purchase: purchase ? { id: String(purchase._id), revision: purchase.revision, order: purchase.order } : null }
}
export async function workflowInvestigationOriginal(ownerId: string, workflowId: string, documentHash: string) {
 await init(); const r: any = await Investigation.findOne({ ownerId, workflowId: id(workflowId) }).lean()
 if (!r || !/^[a-f0-9]{64}$/.test(documentHash)) fail(404, 'Original not found')
 const receipt = r.context.alternatives.find((a: any) => a.kind === 'receipt' && a.documentHash === documentHash)
 if (receipt) { const result = await downloadDocument(ownerId, receipt.documentId); if (result.doc.hash !== documentHash) fail(409, 'Receipt changed'); return { bytes: result.bytes, mimeType: result.doc.mimeType } }
 const a = r.artifacts.find((a: any) => a.hash === documentHash); if (!a) fail(404, 'Original not found')
 const bytes = await readFile(originalPath(ownerId, documentHash)); if (digest(bytes) !== documentHash || bytes.length !== a.size) fail(409, 'Original integrity failed')
 return { bytes, mimeType: a.mimeType }
}
export async function saveWorkflowInvestigationNote(ownerId: string, workflowId: string, body: any) {
 await init()
 if (!body || Object.keys(body).some(k => !['revision', 'text'].includes(k)) || !Number.isSafeInteger(body.revision) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000) fail(400, '購入についての回答・補足を入力してください。')
 const row: any = await Workflow.findOne({ _id: id(workflowId), ownerId }).lean(), r: any = await Investigation.findOne({ ownerId, workflowId }).lean()
 if (!row || !r || r.revision !== body.revision || r.decisions.length >= 100) fail(409, 'Investigation changed')
 const purchase: any = row.purchaseId ? await Purchase.findOne({ _id: row.purchaseId, ownerId, status: 'linked' }).lean() : null
 if (purchase && purchase.order.kind !== 'receipt') fail(409, '接続済みの購入原本は明細画面で確認してください。')
 const decision = { at: new Date(), action: 'owner_note', text: body.text.trim(), scope: { accountId: String(row.accountId), paymentKey: row.key, sourceHash: row.sourceHash, stage: purchase ? 'inventory' : 'purchase' }, previousReport: r.report }
 const result = await Investigation.updateOne({ _id: r._id, revision: body.revision }, { $set: { report: null, status: 'pending' }, $inc: { revision: 1 }, $push: { decisions: decision } })
 if (!result.matchedCount) fail(409, 'Investigation changed')
 return { saved: true, scope: 'this_payment' }
}
export async function saveWorkflowPurchaseOriginal(agent: any, runId: string, body: any) {
 const { run } = await leasedRun(agent, runId, body?.lease), row = await scopedRow(agent, run, body.id)
 const r: any = await Investigation.findOne({ ownerId: agent.ownerId, workflowId: row._id, fingerprint: body.fingerprint }).lean()
 const c = r?.context.alternatives.find((c: any) => c.id === body.candidateId && c.kind === 'online')
 const expected = c?.files.find((f: any) => f.part === body.part)
 if (!expected || typeof body.base64 !== 'string' || body.base64.length > 14000000) fail(400, 'Unknown order original')
 const bytes = Buffer.from(body.base64, 'base64')
 if (bytes.toString('base64') !== body.base64 || bytes.length !== expected.bytes || digest(bytes) !== expected.sha256 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail(409, 'Order original integrity failed')
 const file = originalPath(String(agent.ownerId), expected.sha256); await mkdir(path.dirname(file), { recursive: true })
 try { await writeFile(file, bytes, { flag: 'wx' }) } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (digest(await readFile(file)) !== expected.sha256) fail(409, 'Original integrity failed') }
 const artifact = { candidateId: c.id, part: body.part, hash: expected.sha256, size: bytes.length, name: 'order-' + c.orderNumber + '-' + body.part + '.png', mimeType: 'image/png' }
 await leasedRun(agent, runId, body.lease)
 await Investigation.updateOne({ _id: r._id, fingerprint: body.fingerprint }, { $addToSet: { artifacts: artifact } })
 return { saved: true }
}
export async function acceptWorkflowPurchase(ownerId: string, workflowId: string, body: any, worker?: { agent: any, runId: string, lease: string }) {
 await init()
 if (!body || !Number.isSafeInteger(body.revision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000 || body.confirm !== true || !/^[a-f0-9]{64}$/.test(body.candidateId || '')) fail(400, '購入と支払いの対応を確認してください。')
 return withPurchaseGraph(ownerId, async graphCheck => {
  const row: any = await Workflow.findOne({ _id: id(workflowId), ownerId }).lean(), r: any = await Investigation.findOne({ ownerId, workflowId }).lean()
  if (!row || !r) fail(404, 'Investigation not found')
  const already: any = await Purchase.findOne({ ownerId, archiveId: body.candidateId, status: 'linked', importId: row.importId, line: row.line }).lean()
  if (already) return { saved: true, purchaseId: String(already._id), duplicate: true }
  if (r.revision !== body.revision || r.fingerprint !== body.fingerprint || !r.report || r.decisions.length >= 100) fail(409, 'Investigation changed')
  const c = r.context.alternatives.find((a: any) => a.id === body.candidateId && !a.claimed)
  if (!c || c.total !== null && c.total !== row.payment.amount || c.currency && c.currency !== 'JPY' || c.kind !== 'receipt' && (c.total === null || c.currency !== 'JPY')) fail(409, 'Purchase does not match this payment')
  if (worker) {
   const { run } = await leasedRun(worker.agent, worker.runId, worker.lease); await scopedRow(worker.agent, run, workflowId)
   if (automaticPurchaseCandidate(r.context, r.report)?.id !== c.id) fail(409, 'This purchase needs owner confirmation')
  }
  return withWorkflowPayment(ownerId, row, async (_payment, paymentCheck) => {
   if (await Purchase.exists({ ownerId, status: 'linked', $or: [{ archiveId: c.id }, { paymentKey: String(row.accountId) + ':' + row.key }] })) fail(409, 'Purchase or payment already connected')
   const previous: any = await Purchase.findOne({ ownerId, archiveId: c.id }).lean()
   if (previous && (previous.status !== 'released' || worker || previous.history.length >= 100)) fail(409, 'Previous purchase decision needs review')
   let items: any[], originals: any[], receipt: any
   if (c.kind === 'receipt') {
    const captured = await downloadDocument(ownerId, c.documentId)
    if (captured.doc.hash !== c.documentHash) fail(409, 'Receipt changed')
    const current: any = await Receipt.findOne({ ownerId, documentId: c.documentId, hash: c.documentHash }).lean()
    if (!current?.reading.receipts[c.record] || hash(current.reading.receipts[c.record].items) !== hash(c.items)) fail(409, 'Receipt item reading changed')
    const quantities = body.itemQuantities || {}
    if (typeof quantities !== 'object' || Array.isArray(quantities) || Object.keys(quantities).some(line => !c.items.some((i: any) => String(i.line) === line && i.quantity === undefined)) || Object.values(quantities).some((v: any) => !Number.isSafeInteger(v) || v < 1 || v > 10000)) fail(400, '記載のない数量だけを確認してください。')
    items = c.items.map((i: any) => ({ line: i.line, product: i.product || i.model || (i.jan ? 'JAN ' + i.jan : ''), color: i.color || '', size: i.size || '', quantity: i.quantity ?? quantities[i.line], quantityBasis: i.quantity === undefined ? 'owner_confirmed' : 'printed', lineTotal: i.lineTotal ?? null }))
    receipt = { hash: c.documentHash, documentId: c.documentId, record: c.record, number: c.receiptNumber, merchant: c.merchant, printedDate: c.date || null, printedTotal: c.total, printedCurrency: c.currency || null }
    const file = originalPath(ownerId, captured.doc.hash); await mkdir(path.dirname(file), { recursive: true }); try { await writeFile(file, captured.bytes, { flag: 'wx' }) } catch (e: any) { if (e.code !== 'EEXIST') throw e }
    originals = [{ part: 1, hash: captured.doc.hash, size: captured.bytes.length, name: captured.doc.name, mimeType: captured.doc.mimeType }]
   } else {
    items = c.items; originals = r.artifacts.filter((a: any) => a.candidateId === c.id)
    if (originals.length !== c.files.length || c.files.some((f: any) => !originals.some((a: any) => a.part === f.part && a.hash === f.sha256))) fail(409, 'All purchase originals are required')
   }
   for (const d of originals) { const bytes = await readFile(originalPath(ownerId, d.hash)); if (digest(bytes) !== d.hash || bytes.length !== d.size) fail(409, 'Purchase original integrity failed') }
   const order = { kind: c.kind, archiveId: c.id, orderNumber: c.kind === 'online' ? c.orderNumber : '', date: c.date || row.payment.date, dateBasis: c.date ? 'purchase_source' : 'card_statement', total: c.total ?? row.payment.amount, amountBasis: c.total !== null ? 'purchase_source' : 'card_statement', currency: c.currency || 'JPY', currencyBasis: c.currency ? 'purchase_source' : 'card_statement', cancelled: false, dataQuality: 'complete', capturedAt: c.capturedAt || new Date().toISOString(), items, inventoryLinks: [], sourceUrl: c.sourceUrl || '', ...(receipt ? { receipt } : {}) }
   try { validatePurchaseOrder(order) } catch { fail(409, '商品明細・数量を確認してください。') }
   // Recheck the explicit reference immediately before unattended acceptance.
   if (worker) { const d: any = await FinanceDraft.findOne({ ownerId, importId: row.importId, line: row.line, key: row.key, sourceHash: row.sourceHash }).lean(); if (d?.evidence?.receiptNumber?.state !== 'confirmed' || d.values.receiptNumber !== c.orderNumber) fail(409, 'Confirmed purchase reference changed'); await leasedRun(worker.agent, worker.runId, worker.lease) }
   await paymentCheck(); await graphCheck()
   const at = new Date(), decision = { at, action: worker ? 'confirmed_reference_connected' : 'owner_confirmed', candidateId: c.id, fingerprint: r.fingerprint, reason: body.reason, scope: { accountId: String(row.accountId), paymentKey: row.key, sourceHash: row.sourceHash }, report: r.report }
   const value = { ownerId, archiveId: c.id, accountId: row.accountId, importId: row.importId, line: row.line, key: row.key, sourceHash: row.sourceHash, paymentKey: String(row.accountId) + ':' + row.key, payment: row.payment, status: 'linked', order, inventoryIds: [], originals, evidence: r.context.facts.map((f: any) => ({ id: f.id, kind: 'workflow', text: f.text, hash: digest(f.text), capturedAt: at })), candidateHash: hash([r.fingerprint, c.id]), confirmedAt: at }
   const saved = previous ? await Purchase.findOneAndUpdate({ _id: previous._id, revision: previous.revision, status: 'released' }, { $set: value, $inc: { revision: 1 }, $push: { history: { ...decision, before: { order: previous.order, originals: previous.originals, importId: previous.importId, line: previous.line } } } }, { new: true }) : await Purchase.create({ ...value, revision: 1, history: [decision] })
   if (!saved) fail(409, 'Purchase connection changed')
   await Investigation.updateOne({ _id: r._id, revision: r.revision }, { $set: { status: 'accepted' }, $inc: { revision: 1 }, $push: { decisions: decision } })
   return { saved: true, purchaseId: String(saved._id) }
  })
 })
}

export async function releaseWorkflowPurchase(ownerId: string, workflowId: string, body: any) {
 await init()
 if (!body || Object.keys(body).some(k => !['purchaseId', 'purchaseRevision', 'confirm', 'reason'].includes(k)) || body.confirm !== true || !Number.isSafeInteger(body.purchaseRevision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, '解除する購入接続と理由を確認してください。')
 return withPurchaseGraph(ownerId, async graphCheck => {
  const row: any = await Workflow.findOne({ _id: id(workflowId), ownerId }).lean()
  if (!row) fail(404, 'Workflow not found')
  const purchase: any = await Purchase.findOne({ _id: id(body.purchaseId), ownerId, importId: row.importId, line: row.line, revision: body.purchaseRevision, status: 'linked' }).lean()
  if (!purchase || purchase.history.length >= 100) fail(409, 'Purchase connection changed')
  return withWorkflowPayment(ownerId, row, async (_payment, check) => {
   await checkPurchaseAllocations(ownerId, purchase); await check(); await graphCheck()
   const result = await Purchase.updateOne({ _id: purchase._id, ownerId, revision: body.purchaseRevision, status: 'linked' }, { $set: { status: 'released' }, $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'owner_released_workflow_purchase', reason: body.reason.trim(), before: { order: purchase.order, originals: purchase.originals } } } })
   if (!result.matchedCount) fail(409, 'Purchase connection changed')
   return { released: true, originalsPreserved: true }
  })
 })
}

export async function acceptWorkflowReceiptInventory(ownerId: string, workflowId: string, body: any) {
 await init()
 if (!body || body.confirm !== true || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000 || !Number.isSafeInteger(body.revision) || !Number.isSafeInteger(body.purchaseRevision) || !Array.isArray(body.inventoryIds) || !body.inventoryIds.length || body.inventoryIds.length > 100 || body.inventoryIds.some((v: any) => typeof v !== 'string') || new Set(body.inventoryIds).size !== body.inventoryIds.length) fail(400, '在庫と領収書の商品を確認してください。')
 return withPurchaseGraph(ownerId, async graphCheck => {
  const row: any = await Workflow.findOne({ _id: id(workflowId), ownerId }).lean(), r: any = await Investigation.findOne({ ownerId, workflowId }).lean()
  if (!row || !r || r.revision !== body.revision || r.fingerprint !== body.fingerprint || !r.report) fail(409, 'Investigation changed')
  const p: any = await Purchase.findOne({ ownerId, importId: row.importId, line: row.line, status: 'linked', revision: body.purchaseRevision }).lean()
  if (!p || p.order.kind !== 'receipt') fail(409, 'Receipt purchase changed')
  if (p.history.length >= 100 || r.decisions.length >= 100) fail(409, 'Decision history limit reached')
  const proposals = r.report.inventoryProposals.filter((v: any) => v.receiptId === p.archiveId && body.inventoryIds.includes(v.inventoryId))
  if (proposals.length !== body.inventoryIds.length) fail(400, 'Choose captured inventory proposals')
  try { validateInvestigationReport(r.report, r.context) } catch { fail(409, 'Inventory proposal evidence changed') }
  const source = r.context.inventorySource
  if (!source?.name || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+$/.test(source.url) || !/^[a-f0-9]{64}$/.test(source.snapshotHash)) fail(409, 'Original inventory snapshot required')
  return withWorkflowPayment(ownerId, row, async (_payment, check) => {
   if (await Purchase.exists({ ownerId, status: 'linked', _id: { $ne: p._id }, inventoryIds: { $in: body.inventoryIds } })) fail(409, 'Inventory already belongs to another purchase')
   const order = structuredClone(p.order)
   for (const proposal of proposals) {
    const previous = order.inventoryLinks.find((v: any) => v.inventoryId === proposal.inventoryId)
    if (previous) { if (previous.itemLine !== proposal.line) fail(409, 'Inventory already belongs to another item'); continue }
    const stock = r.context.offline.stocks.find((s: any) => s.inventoryId === proposal.inventoryId)
    if (!stock) fail(409, 'Inventory source changed')
    order.inventoryLinks.push({ inventoryId: stock.inventoryId, itemLine: proposal.line, quantity: 1, status: 'matched', basis: proposal.basis, requiresReview: false, ownerConfirmedInference: proposal.basis === 'inferred', source: { sheet: source.name, row: stock.row, inventoryCell: 'B' + stock.row, orderCell: 'E' + stock.row, url: source.url, snapshotHash: source.snapshotHash, itemModel: stock.model, itemVariant: stock.variant, reference: stock.reference }, shipments: [] })
   }
   try { validatePurchaseOrder(order) } catch { fail(409, 'Inventory quantity or item conflicts with receipt') }
   const decision = { at: new Date(), action: 'owner_confirmed_receipt_inventory', reason: body.reason.trim(), fingerprint: r.fingerprint, proposals, before: { order: p.order } }
   await check(); await graphCheck()
   const result = await Purchase.updateOne({ _id: p._id, ownerId, revision: body.purchaseRevision, status: 'linked' }, { $set: { order, inventoryIds: order.inventoryLinks.map((s: any) => s.inventoryId) }, $inc: { revision: 1 }, $push: { history: decision } })
   if (!result.matchedCount) fail(409, 'Receipt purchase changed')
   await Investigation.updateOne({ _id: r._id, revision: body.revision }, { $inc: { revision: 1 }, $push: { decisions: { ...decision, before: undefined } } })
   return { saved: true }
  })
 })
}

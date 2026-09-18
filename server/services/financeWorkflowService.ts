import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FinancialAccount, FinanceImport } from '../models/Finance'
import { FinanceDraft } from '../models/FinanceDraft'
import { FinancePurchaseLink } from '../models/FinancePurchaseLink'
import { FinanceChatAgent } from '../models/FinanceChat'
import { FinanceWorkflow as Workflow, FinanceWorkflowConfig as Config, FinanceWorkflowRun as Run, FinanceWorkflowSource as Source, FinanceWorkflowInvestigation as Investigation } from '../models/FinanceWorkflow'
import { fail, id, ready } from './financeService'
import { purchaseExports, uploadExportDocument, saveExport } from './financeExportService'
import { FinanceExport, FinanceExportUpload } from '../models/FinanceExport'
import { parseIntrasDocuments, verifyIntrasPdfReadback } from '../../shared/finance-workflow-documents.mjs'
import { withPurchaseGraph, checkPurchaseAllocations } from './financePurchaseGraphService'
import { withWorkflowPayment } from './financeWorkflowEvidenceService'
import { matchWorkflowInventory } from '../../shared/finance-workflow-matching.mjs'
import { validateArchivedOrder } from '../../research-worker/issey-archive.mjs'
import { validatePurchaseOrder } from '../../shared/finance-purchase-links.mjs'
import { activeImportRows, verifySourceReferences } from '../../shared/finance-import-overlap.mjs'
import { digest } from '../../shared/amex.mjs'
import { newWorkflowStep, applyWorkflowObservation, reviewWorkflowStep, workflowSummary, workflowDay, nextWorkflowMidnight, WORKFLOW_DEFAULTS } from '../../shared/finance-workflow.mjs'

const validDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
const hash = (value: any) => digest(JSON.stringify(value))
async function init() { await ready(); await Promise.all([Workflow.init(), Config.init(), Run.init(), Source.init()]) }
function period(body: any) { if (!validDate(body?.from) || !validDate(body?.through) || body.from > body.through || Date.parse(body.through) - Date.parse(body.from) > 732 * 86400000) fail(400, '2年以内の対象期間を選択してください。'); return { from: body.from, through: body.through } }
function visible(row: any) { return { id: String(row._id), accountId: String(row.accountId), importId: String(row.importId), line: row.line, revision: row.revision, payment: row.payment, purchaseId: row.purchaseId ? String(row.purchaseId) : null, steps: row.steps, summary: workflowSummary(row.steps), lastAssessedAt: row.lastAssessedAt, events: row.events.slice(-40) } }
function visibleConfig(c: any) { return c ? { revision: c.revision, enabled: c.enabled, accountIds: c.accountIds.map(String), workerId: c.workerId ? String(c.workerId) : null, from: c.from, through: c.through, firstRunAt: c.firstRunAt, workerSeenAt: c.workerSeenAt, workerCapabilities: c.workerCapabilities } : null }

export async function workflowView(ownerId: string, query: any = {}) {
  await init()
  const config: any = await Config.findOne({ ownerId }).lean()
  const filter: any = { ownerId }
  if (query.importId) filter.importId = id(query.importId)
  if (query.line !== undefined) { const line = Number(query.line); if (!Number.isSafeInteger(line) || line < 2) fail(400, 'Invalid line'); filter.line = line }
  if (query.from || query.through) { const p = period(query); filter['payment.date'] = { $gte: p.from, $lte: p.through } }
  const rows: any[] = await Workflow.find(filter).sort({ 'payment.date': -1, _id: 1 }).limit(3001).lean()
  if (rows.length > 3000) fail(409, '期間を絞り込んでください。')
  const runs: any[] = await Run.find({ ownerId }).sort({ day: -1 }).limit(10).select('day status startedAt completedAt summary sourceStatus').lean()
  const accounts: any[] = await FinancialAccount.find({ ownerId, active: true }).select('name').lean()
  const workers: any[] = await FinanceChatAgent.find({ ownerId, enabled: true, researchEnabled: true, revokedAt: null }).select('accountIds lastSeenAt').lean()
  return { config: visibleConfig(config), rows: rows.map(visible), runs: runs.map(r => ({ ...r, id: String(r._id), _id: undefined })), accounts: accounts.map(a => ({ id: String(a._id), name: a.name })), workers: workers.map(w => ({ id: String(w._id), accountIds: w.accountIds.map(String), lastSeenAt: w.lastSeenAt })), policy: { timezone: 'Asia/Tokyo', time: '00:00', ...WORKFLOW_DEFAULTS } }
}

export async function configureWorkflow(ownerId: string, body: any) {
  await init()
  if (!body || Object.keys(body).some(k => !['revision', 'enabled', 'accountIds', 'workerId', 'from', 'through'].includes(k)) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.enabled !== 'boolean' || !Array.isArray(body.accountIds) || !body.accountIds.length || body.accountIds.length > 30) fail(400, '対象口座と期間を選択してください。')
  const dates = period(body), accountIds = [...new Set(body.accountIds.map(id))]
  if (await FinancialAccount.countDocuments({ ownerId, _id: { $in: accountIds }, active: true }) !== accountIds.length) fail(400, 'Unknown account')
  const worker: any = body.workerId ? await FinanceChatAgent.findOne({ _id: id(body.workerId), ownerId, enabled: true, researchEnabled: true, revokedAt: null }).lean() : null
  if (body.workerId && (!worker || accountIds.some(a => !worker.accountIds.map(String).includes(a))) || body.enabled && !worker) fail(400, '対象口座に接続できる調査ワーカーを選択してください。')
  const existing: any = await Config.findOne({ ownerId }).lean()
  if ((existing?.revision || 0) !== body.revision) fail(409, '設定が更新されました。再読込してください。')
  if (body.enabled && (String(existing?.workerId || '') !== String(worker?._id || '') || !existing?.workerSeenAt || Date.now() - new Date(existing.workerSeenAt).getTime() > 300000 || !['purchase', 'inventory', 'shipment', 'documents'].every(stage => existing.workerCapabilities?.includes(stage)))) fail(409, '購入・在庫・出荷・書類の処理に接続した後、有効にしてください。')
  if (existing?.leaseUntil > new Date()) fail(409, '夜間処理が進行中です。完了後に設定を変更してください。')
  const value = { ...dates, enabled: body.enabled, accountIds, workerId: worker?._id || null, ...(String(existing?.workerId || '') !== String(worker?._id || '') ? { workerSeenAt: null, workerCapabilities: [] } : {}), firstRunAt: body.enabled ? existing?.enabled ? existing.firstRunAt : new Date(nextWorkflowMidnight()) : null }
  try {
    if (existing) {
      const r = await Config.updateOne({ ownerId, revision: body.revision, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] }, { $set: value, $inc: { revision: 1 } })
      if (!r.matchedCount) fail(409, '設定が更新されました。再読込してください。')
    } else await Config.create({ ownerId, ...value, revision: 1 })
  } catch (e: any) { if (e.code === 11000) fail(409, '設定が更新されました。再読込してください。'); throw e }
  return workflowView(ownerId)
}

// This read-side assessment does not count a source search, or change any
// purchase/ledger record. Only already saved, checked evidence can complete steps.
async function assessSaved(row: any, purchase: any) {
  const observations: Record<string, any> = {}, definitions: Record<string, any> = {}
  const investigation: any = row._id && (purchase?.order.kind === 'receipt' || Object.values(row.steps || {}).some((s: any) => s.state === 'manual_review')) ? await Investigation.findOne({ ownerId: row.ownerId, workflowId: row._id }).lean() : null
  const add = (key: string, stage: string, unit: string, observation: any) => { definitions[key] = newWorkflowStep(stage, unit); observations[key] = observation }
  if (!purchase) {
    add('purchase', 'purchase', 'purchase', { reason: row.purchaseId ? 'evidence_changed' : 'pending' })
    add('inventory', 'inventory', 'unknown_items', { reason: 'waiting_dependency' })
    add('shipment', 'shipment', 'unknown_items', { reason: 'waiting_dependency' })
    add('documents', 'documents', 'unknown_items', { reason: 'waiting_dependency' })
  } else {
    const detail = await purchaseExports(String(row.ownerId), String(purchase._id))
    const proof = (value: any) => ({ reason: 'complete', evidenceVerified: true, evidenceKey: hash(value) })
    add('purchase', 'purchase', 'purchase', detail.progress.evidenceComplete ? proof([purchase.archiveId, purchase.payment, purchase.order.items, purchase.originals]) : { reason: 'integrity_failed' })
    for (const item of detail.progress.items) {
      const stocks = purchase.order.inventoryLinks.filter((s: any) => s.itemLine === item.line)
      const unresolvedJan = investigation?.context.offline.lines.some((l: any) => l.receiptId === purchase.archiveId && l.line === item.line && l.jan && l.janState !== 'resolved')
      const proposed = investigation?.report?.inventoryProposals.some((p: any) => p.receiptId === purchase.archiveId && p.line === item.line && !stocks.some((s: any) => s.inventoryId === p.inventoryId))
      add('inventory_' + item.line, 'inventory', 'item:' + item.line, item.identified === item.quantity ? proof([item.itemKey, item.quantity, stocks.map((s: any) => s.inventoryId)]) : { reason: unresolvedJan ? 'source_required' : proposed ? 'ambiguous' : 'waiting_dependency' })
      // Missing sibling units never prevent an identified unit's next stage.
      for (const stock of stocks) {
        const suffix = digest(stock.inventoryId).slice(0, 32), unit = detail.progress.units.find((u: any) => u.inventoryId === stock.inventoryId)
        const exported = detail.exports.find((e: any) => e.id === unit.exportId)
        const outcome = detail.outcomes.find((o: any) => o.id === unit.outcomeId)
        if (unit.state === 'conflict') {
          add('shipment_' + suffix, 'shipment', stock.inventoryId, { reason: 'conflict' }); add('documents_' + suffix, 'documents', stock.inventoryId, { reason: 'conflict' })
        } else if (['returned', 'cancelled'].includes(unit.state)) {
          const resolved = { ...proof([outcome.id, outcome.revision, outcome.documents]), reason: 'not_applicable' }
          add('shipment_' + suffix, 'shipment', stock.inventoryId, resolved); add('documents_' + suffix, 'documents', stock.inventoryId, resolved)
        } else {
          const source = stock.shipments.filter((s: any) => s.orderId?.trim() && s.tracking?.trim())
          const shipment = exported ? [exported.providerAccount, exported.orderId, exported.tracking] : source.length === 1 ? source[0] : null
          add('shipment_' + suffix, 'shipment', stock.inventoryId, shipment ? proof(shipment) : { reason: source.length > 1 ? 'ambiguous' : 'waiting_shipment' })
          add('documents_' + suffix, 'documents', stock.inventoryId, unit.state === 'exported' ? proof([exported.id, exported.revision, exported.documents]) : exported?.documentIntegrity === false ? { reason: 'integrity_failed' } : { reason: 'waiting_dependency' })
        }
      }
      if (item.identified < item.quantity) {
        add('shipment_remaining_' + item.line, 'shipment', 'remaining:item:' + item.line, { reason: 'waiting_dependency' })
        add('documents_remaining_' + item.line, 'documents', 'remaining:item:' + item.line, { reason: 'waiting_dependency' })
      }
    }
  }
  const steps: Record<string, any> = {}, changes: any[] = []
  for (const [key, definition] of Object.entries(definitions)) {
    let previous = row.steps?.[key] || definition
    const observation = observations[key], note = investigation?.decisions?.filter((d: any) => d.action === 'owner_note' && d.scope.stage === previous.stage).at(-1)
    if (previous.state === 'manual_review' && note && (!previous.lastCheckedAt || new Date(note.at) > new Date(previous.lastCheckedAt))) previous = reviewWorkflowStep(previous, { action: 'retry', reason: note.text })
    // A routine status refresh cannot replace a missing-data failure/review with
    // a generic dependency wait or invent a successful source search.
    if (observation.reason === 'pending') steps[key] = previous
    else if (observation.reason === 'waiting_dependency' && row.steps?.[key]) steps[key] = previous
    else if (observation.reason === previous.reason && (['waiting_shipment', 'conflict', 'ambiguous', 'integrity_failed', 'evidence_changed'].includes(observation.reason) || previous.evidenceKey === observation.evidenceKey)) steps[key] = previous
    else {
      if (observation.reason === 'complete' && previous.state === 'manual_review' && purchase?.history.some((h: any) => (key === 'purchase' ? ['owner_confirmed', 'confirmed_reference_connected'].includes(h.action) : key.startsWith('inventory_') && h.action === 'owner_confirmed_receipt_inventory') && (!previous.lastCheckedAt || new Date(h.at) >= new Date(previous.lastCheckedAt)))) observation.reviewResolved = true
      const result = applyWorkflowObservation(previous, observation)
      steps[key] = result.step
      if (result.changed) changes.push({ key, before: previous.state, after: result.step.state, reason: result.step.reason })
    }
  }
  for (const [key, previous] of Object.entries(row.steps || {}) as any) if (!definitions[key] && previous.state === 'manual_review') steps[key] = previous
  return { steps, changes }
}

export async function syncWorkflowRecords(ownerId: string, body: any) {
  await init(); const dates = period(body)
  if (!Array.isArray(body.accountIds) || !body.accountIds.length || body.accountIds.length > 30) fail(400, 'Choose accounts')
  const accountIds = [...new Set(body.accountIds.map(id))]
  const accounts: any[] = await FinancialAccount.find({ ownerId, _id: { $in: accountIds }, active: true }).lean()
  if (accounts.length !== accountIds.length) fail(400, 'Unknown account')
  return withPurchaseGraph(ownerId, async check => {
    const current: any[] = await Workflow.find({ ownerId, accountId: { $in: accountIds } }).limit(3001).lean()
    if (current.length > 3000) fail(409, '対象の照合件数が上限を超えています。')
    const byKey = new Map(current.map(r => [String(r.accountId) + ':' + r.key, r]))
    const links: any[] = await FinancePurchaseLink.find({ ownerId, accountId: { $in: accountIds }, status: 'linked' }).lean()
    const imports: any[] = await FinanceImport.find({ ownerId, accountId: { $in: accountIds } }).limit(3001).lean()
    for (const account of accounts) if (imports.filter(b => String(b.accountId) === String(account._id)).length > 100) fail(409, '取込履歴を確認してください。')
    if (imports.length > 3000) fail(409, '取込履歴が上限を超えています。')
    for (const batch of imports) { try { verifySourceReferences(batch, imports) } catch { fail(409, '取込元の参照が変更されています。') } }
    const drafts: any[] = await FinanceDraft.find({ ownerId, accountId: { $in: accountIds } }).select('importId line key sourceHash values evidence').lean()
    const draftByRow = new Map(drafts.map(d => [String(d.importId) + ':' + d.line, d]))
    const operations: any[] = [], seen = new Set(), at = new Date()
    for (const batch of imports) for (const payment of activeImportRows(batch)) {
      if (payment.kind !== 'expense' || payment.amount <= 0 || payment.purchaseDate < dates.from || payment.purchaseDate > dates.through) continue
      const identity = String(batch.accountId) + ':' + payment.key
      if (seen.has(identity)) fail(409, '同じ購入の取込元を確認してください。')
      seen.add(identity); if (seen.size > 3000) fail(409, '対象期間を絞り込んでください。')
      const previous: any = byKey.get(identity), purchase = links.find(p => String(p.importId) === String(batch._id) && p.line === payment.line)
      if (previous && (String(previous.importId) !== String(batch._id) || previous.line !== payment.line || previous.sourceHash !== batch.hash)) fail(409, '照合の元明細が変更されています。')
      const row = previous || { ownerId, accountId: batch.accountId, importId: batch._id, line: payment.line, key: payment.key, sourceHash: batch.hash, steps: {}, events: [] }
      const account = accounts.find(a => String(a._id) === String(batch.accountId)), draft = draftByRow.get(String(batch._id) + ':' + payment.line)
      const company = !purchase && draft?.sourceHash === batch.hash && draft?.key === payment.key && draft?.values.purpose === 'company' && draft?.evidence.purpose?.state === 'confirmed'
      let assessment: any
      if (company) {
        const steps: any = {}
        const evidenceKey = hash([draft.key, draft.values.purpose, draft.evidence.purpose])
        for (const stage of ['purchase', 'inventory', 'shipment', 'documents']) steps[stage] = row.steps[stage]?.state === 'not_applicable' && row.steps[stage].evidenceKey === evidenceKey ? row.steps[stage] : applyWorkflowObservation(row.steps[stage] || newWorkflowStep(stage), { reason: 'not_applicable', evidenceVerified: true, evidenceKey }).step
        assessment = { steps, changes: [{ reason: 'confirmed_company_expense' }] }
      } else assessment = await assessSaved(row, purchase)
      const value = { payment: { date: payment.purchaseDate, amount: payment.amount, merchant: payment.description, card: payment.cardIdentifier, accountName: account.name, purpose: draft?.values.purpose || 'unresolved' }, purchaseId: purchase?._id || null, steps: assessment.steps, summary: workflowSummary(assessment.steps), lastAssessedAt: at }
      if (previous && same(previous.steps, value.steps) && same(previous.payment, value.payment) && String(previous.purchaseId || '') === String(value.purchaseId || '')) continue
      if ((row.events?.length || 0) >= 2000) fail(409, '照合履歴が上限に達しています。')
      const event = { id: randomUUID(), at, action: 'saved_evidence_checked', changes: assessment.changes }
      if (previous) operations.push({ updateOne: { filter: { _id: previous._id, ownerId, revision: previous.revision }, update: { $set: value, $inc: { revision: 1 }, $push: { events: event } } } })
      else operations.push({ updateOne: { filter: { ownerId, accountId: batch.accountId, key: payment.key }, update: { $setOnInsert: { ...row, ...value, revision: 1, events: [event] } }, upsert: true } })
    }
    await check()
    if (operations.length) {
      const result = await Workflow.bulkWrite(operations, { ordered: true })
      if (result.matchedCount + result.upsertedCount !== operations.length) fail(409, '照合が更新されています。再読込してください。')
    }
    return { assessed: seen.size, updated: operations.length, attemptsCounted: 0 }
  })
}

export async function reviewWorkflow(ownerId: string, workflowId: string, body: any) {
  await init()
  if (!body || Object.keys(body).some(k => !['revision', 'step', 'action', 'until', 'reason'].includes(k)) || !Number.isSafeInteger(body.revision) || typeof body.step !== 'string' || !/^[a-z][a-z0-9_]{0,80}$/.test(body.step)) fail(400, 'Invalid workflow review')
  const row: any = await Workflow.findOne({ _id: id(workflowId), ownerId }).lean()
  if (!row) fail(404, '照合が見つかりません。')
  if (row.revision !== body.revision || !row.steps[body.step]) fail(409, '照合が更新されました。再読込してください。')
  if (row.events.length >= 2000) fail(409, '照合履歴が上限に達しています。')
  let next
  try { next = reviewWorkflowStep(row.steps[body.step], body) } catch (e: any) { fail(400, e.message) }
  const steps = { ...row.steps, [body.step]: next }
  const r = await Workflow.updateOne({ _id: row._id, ownerId, revision: body.revision }, { $set: { steps, summary: workflowSummary(steps) }, $inc: { revision: 1 }, $push: { events: { id: randomUUID(), at: new Date(), action: body.action, step: body.step, reason: body.reason, before: row.steps[body.step], after: next } } })
  if (!r.matchedCount) fail(409, '照合が更新されました。再読込してください。')
  return visible(await Workflow.findById(row._id).lean())
}

export async function workflowWorkerStatus(agent: any, body: any) {
  await init()
  const capabilities = ['purchase', 'inventory', 'shipment', 'documents', 'receipt_jan', 'receipt_inference']
  if (!body || !Array.isArray(body.capabilities) || body.capabilities.some((c: any) => !capabilities.includes(c)) || new Set(body.capabilities).size !== body.capabilities.length) fail(400, 'Invalid workflow capabilities')
  const c: any = await Config.findOne({ ownerId: agent.ownerId, workerId: agent._id }).lean()
  if (!c || agent.researchEnabled !== true || c.accountIds.some((a: any) => !agent.accountIds.map(String).includes(String(a)))) fail(403, 'Workflow worker is not configured for these accounts')
  await Config.updateOne({ _id: c._id, workerId: agent._id }, { $set: { workerSeenAt: new Date(), workerCapabilities: body.capabilities } })
  return { config: visibleConfig(c), serverDay: workflowDay() }
}

async function workerConfig(agent: any) {
  await init()
  const c: any = await Config.findOne({ ownerId: agent.ownerId, workerId: agent._id, enabled: true }).lean()
  if (!c || agent.researchEnabled !== true || c.accountIds.some((a: any) => !agent.accountIds.map(String).includes(String(a)))) fail(403, 'Workflow worker unavailable')
  return c
}

export async function leasedRun(agent: any, runId: string, lease: any) {
  const config = await workerConfig(agent)
  if (typeof lease !== 'string' || config.lease !== lease || !config.leaseUntil || config.leaseUntil <= new Date()) fail(409, 'Workflow lease expired')
  const run: any = await Run.findOne({ _id: id(runId), ownerId: agent.ownerId, agentId: agent._id, status: 'working', lease, leaseUntil: { $gt: new Date() }, deadline: { $gt: new Date() } }).lean()
  if (!run) fail(409, 'Workflow run expired')
  return { config, run }
}

export async function claimWorkflowRun(agent: any) {
  const config = await workerConfig(agent), now = new Date(), day = workflowDay(now), lease = randomUUID()
  if (!config.firstRunAt || config.firstRunAt > now) return { run: null }
  const locked: any = await Config.findOneAndUpdate({ _id: config._id, enabled: true, workerId: agent._id, revision: config.revision, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { lease, leaseUntil: new Date(now.getTime() + 180000), workerSeenAt: now } }, { new: true }).lean()
  if (!locked) return { run: null }
  try {
    // A missed day does not spawn a backlog of identical source crawls. Its
    // transaction checkpoints survive; today's single run picks up that work.
    await Run.updateMany({ ownerId: agent.ownerId, day: { $lt: day }, status: { $in: ['queued', 'working'] } }, { $set: { status: 'interrupted', completedAt: now }, $unset: { lease: '', leaseUntil: '' } })
    let run: any = await Run.findOne({ ownerId: agent.ownerId, day }).lean()
    if (!run) run = (await Run.create({ ownerId: agent.ownerId, day, policy: { from: config.from, through: config.through, accountIds: config.accountIds.map(String), configRevision: config.revision, ...WORKFLOW_DEFAULTS } })).toObject()
    if (!['queued', 'working'].includes(run.status)) return { run: null }
    if (run.deadline && run.deadline <= now) { await Run.updateOne({ _id: run._id }, { $set: { status: 'budget_exhausted', completedAt: now }, $unset: { lease: '', leaseUntil: '' } }); return { run: null } }
    if (run.policy.configRevision !== config.revision) { await Run.updateOne({ _id: run._id }, { $set: { status: 'configuration_changed', completedAt: now } }); return { run: null } }
    const deadline = run.deadline || new Date(Math.min(now.getTime() + 7200000, Date.parse(nextWorkflowMidnight(now))))
    run = await Run.findOneAndUpdate({ _id: run._id, status: { $in: ['queued', 'working'] } }, { $set: { status: 'working', agentId: agent._id, lease, leaseUntil: new Date(now.getTime() + 180000), startedAt: run.startedAt || now, deadline } }, { new: true }).lean()
    return { run: { id: String(run._id), day: run.day, lease, deadline: run.deadline, policy: run.policy, sourceStatus: run.sourceStatus, processed: run.processed } }
  } finally {
    const owns = await Run.exists({ ownerId: agent.ownerId, day, status: 'working', lease, deadline: { $gt: new Date() } })
    if (!owns) await Config.updateOne({ _id: config._id, lease }, { $unset: { lease: '', leaseUntil: '' } })
  }
}

export async function workflowRunHeartbeat(agent: any, runId: string, body: any) {
  const { config, run } = await leasedRun(agent, runId, body?.lease)
  const until = new Date(Math.min(Date.now() + 180000, run.deadline.getTime()))
  const r = await Config.updateOne({ _id: config._id, lease: body.lease, leaseUntil: { $gt: new Date() } }, { $set: { leaseUntil: until, workerSeenAt: new Date() } })
  if (!r.matchedCount) fail(409, 'Workflow lease expired')
  await Run.updateOne({ _id: run._id, lease: body.lease }, { $set: { leaseUntil: until } })
  return { deadline: run.deadline }
}

export async function workflowRunContext(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease)
  await syncWorkflowRecords(String(agent.ownerId), run.policy)
  await leasedRun(agent, runId, body.lease)
  const shipments = await workflowShipments(agent, run)
  const rows: any[] = await Workflow.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).sort({ 'payment.date': 1, _id: 1 }).limit(3001).lean()
  if (rows.length > 3000) fail(409, 'Workflow scope exceeds limit')
  const links: any[] = await FinancePurchaseLink.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, status: 'linked' }).lean()
  const sources: any[] = await Source.find({ ownerId: agent.ownerId, runId: run._id }).select('kind hash size scope complete capturedAt').lean()
  return { rows: rows.map(visible), purchases: links.map(p => ({ id: String(p._id), importId: String(p.importId), line: p.line, accountId: String(p.accountId), revision: p.revision, order: p.order, originals: p.originals, payment: p.payment })), shipments, sources: sources.map(s => ({ ...s, id: String(s._id), _id: undefined })) }
}

export function sourcePath(owner: string, hashValue: string) {
  if (!/^[a-f0-9]{64}$/.test(hashValue)) fail(400, 'Invalid workflow source hash')
  return path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'workflow-sources', id(owner), hashValue)
}

export async function saveWorkflowSource(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease)
  if (!['orders', 'inventory', 'shipping'].includes(body.kind) || typeof body.complete !== 'boolean' || typeof body.name !== 'string' || body.name.length > 120 || !body.payload || typeof body.payload !== 'object' || !body.scope || typeof body.scope !== 'object' || !Number.isFinite(Date.parse(body.capturedAt))) fail(400, 'Invalid workflow source')
  const capturedAt = new Date(body.capturedAt)
  if (capturedAt > new Date(Date.now() + 5000) || capturedAt < run.startedAt || workflowDay(capturedAt) !== run.day) fail(400, 'A fresh source for this run is required')
  if (['inventory', 'shipping'].includes(body.kind)) {
    const rows = body.payload.rows
    if (!Array.isArray(rows) || rows.length > 50000 || rows.some((r: any) => !Array.isArray(r) || r.length > 52 || r.some((v: any) => typeof v !== 'string')) || rows.length === 50000 && body.complete || typeof body.scope.url !== 'string' || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+$/.test(body.scope.url)) fail(400, 'Invalid spreadsheet snapshot')
    if (body.complete && (body.kind === 'inventory' ? !String(rows[0]?.[4]).includes('주문번호') || !String(rows[0]?.[7]).includes('색상/사이즈') : rows[1]?.[19] !== '재고번호')) fail(400, 'Spreadsheet headers could not be verified')
  }
  let accountIds = run.policy.accountIds
  if (body.kind === 'orders') {
    if (!Array.isArray(body.scope.financialAccountIds) || !body.scope.financialAccountIds.length || body.scope.financialAccountIds.some((a: any) => !run.policy.accountIds.includes(a)) || !Array.isArray(body.scope.externalAccountIds) || !body.scope.externalAccountIds.length) fail(400, 'Explicit archive account scope required')
    if (body.scope.externalAccountIds.length > 20 || body.scope.externalAccountIds.some((a: any) => typeof a !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(a)) || !Array.isArray(body.payload.orders) || body.payload.orders.length > 10000 || !Array.isArray(body.payload.runs) || body.payload.runs.length > 20 || new Set(body.payload.orders.map((o: any) => o?.id)).size !== body.payload.orders.length) fail(400, 'Invalid archive snapshot')
    try {
      for (const order of body.payload.orders) {
        if (!body.scope.externalAccountIds.includes(order.accountId)) throw Error('Account outside archive scope')
        validateArchivedOrder(order, order.accountId)
        if (!order.cancelled && order.dataQuality === 'complete' && order.total > 0) validatePurchaseOrder({ ...order, archiveId: order.id, inventoryLinks: [] })
      }
    } catch { fail(400, 'Archive source identity or items could not be verified') }
    accountIds = [...new Set(body.scope.financialAccountIds)]
  }
  const bytes = Buffer.from(JSON.stringify(body.payload)); if (bytes.length > 25000000) fail(413, 'Workflow source too large')
  const digestValue = digest(bytes), file = sourcePath(String(agent.ownerId), digestValue)
  const previous: any = await Source.findOne({ ownerId: agent.ownerId, runId: run._id, kind: body.kind }).lean()
  if (previous) {
    if (previous.hash !== digestValue || previous.complete !== body.complete || !same(previous.scope, body.scope)) fail(409, 'A different source snapshot is already pinned to this run')
    await Run.updateOne({ _id: run._id, lease: body.lease }, { $addToSet: { sourceIds: previous._id }, $set: { ['sourceStatus.' + body.kind]: { state: previous.complete ? 'ready' : 'incomplete', capturedAt: previous.capturedAt, sourceId: String(previous._id) } } })
    return { id: String(previous._id), hash: previous.hash }
  }
  await mkdir(path.dirname(file), { recursive: true })
  try { await writeFile(file, bytes, { flag: 'wx' }) } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (digest(await readFile(file)) !== digestValue) fail(409, 'Saved source integrity failure') }
  await leasedRun(agent, runId, body.lease)
  let source: any
  try { source = await Source.create({ ownerId: agent.ownerId, runId: run._id, accountIds, kind: body.kind, name: body.name, hash: digestValue, size: bytes.length, capturedAt, complete: body.complete, scope: body.scope }) }
  catch (e: any) {
    if (e.code !== 11000) throw e
    source = await Source.findOne({ ownerId: agent.ownerId, runId: run._id, kind: body.kind }).lean()
    if (!source || source.hash !== digestValue || source.complete !== body.complete || !same(source.scope, body.scope)) fail(409, 'A different source snapshot is already pinned to this run')
  }
  await Run.updateOne({ _id: run._id, lease: body.lease }, { $addToSet: { sourceIds: source._id }, $set: { ['sourceStatus.' + body.kind]: { state: body.complete ? 'ready' : 'incomplete', capturedAt, sourceId: String(source._id) } } })
  return { id: String(source._id), hash: digestValue }
}

export async function workflowObservation(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease)
  if (!body || Object.keys(body).some(k => !['lease', 'id', 'revision', 'step', 'reason', 'sourceIds', 'eventId', 'suggestion'].includes(k)) || !Number.isSafeInteger(body.revision) || typeof body.step !== 'string' || !/^[a-z][a-z0-9_]{0,80}$/.test(body.step) || !/^[a-f0-9-]{36}$/.test(body.eventId || '') || !Array.isArray(body.sourceIds) || body.sourceIds.length > 10 || typeof body.suggestion !== 'string' || body.suggestion.length > 2000 || !['missing_purchase', 'missing_inventory', 'missing_documents', 'waiting_shipment', 'waiting_dependency', 'connection_required', 'source_incomplete', 'source_required', 'ambiguous', 'conflict', 'transient_error'].includes(body.reason)) fail(400, 'Invalid workflow observation')
  const row: any = await Workflow.findOne({ _id: id(body.id), ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).lean()
  if (!row) fail(404, 'Workflow not found')
  const fingerprint = hash({ ...body, lease: undefined, revision: undefined })
  const prior = row.events.find((e: any) => e.id === body.eventId)
  if (prior) { if (prior.hash !== fingerprint) fail(409, 'Workflow event ID reused'); return { row: visible(row), duplicate: true } }
  if (row.revision !== body.revision || !row.steps[body.step]) fail(409, 'Workflow changed')
  if (row.events.length >= 2000) fail(409, 'Workflow history limit reached')
  if (['complete', 'not_applicable'].includes(row.steps[body.step].state)) fail(409, 'Saved evidence already completes this step')
  const sourceIds = [...new Set(body.sourceIds.map(id))]
  const sources: any[] = await Source.find({ _id: { $in: sourceIds }, ownerId: agent.ownerId, runId: run._id, accountIds: row.accountId }).lean()
  if (sources.length !== sourceIds.length) fail(400, 'Unknown workflow source')
  const required = ({ purchase: 'orders', inventory: 'inventory', shipment: 'shipping', documents: 'shipping' } as any)[row.steps[body.step].stage]
  const qualified = sources.length > 0 && sources.every(s => s.complete === true && workflowDay(s.capturedAt) === run.day) && sources.some(s => s.kind === required)
  // Shipping data alone cannot establish that Intras documents are unavailable.
  // The document collector supplies a separate verified attempt once installed.
  if (body.reason === 'missing_documents') fail(409, 'A qualified document-collection attempt is required')
  let result
  try { result = applyWorkflowObservation(row.steps[body.step], { reason: body.reason, qualified, day: run.day }) } catch (e: any) { fail(400, e.message) }
  if (!result.changed) return { row: visible(row), duplicate: false, counted: false }
  const steps = { ...row.steps, [body.step]: { ...result.step, suggestion: body.suggestion, sourceIds } }
  await leasedRun(agent, runId, body.lease)
  const r = await Workflow.updateOne({ _id: row._id, ownerId: agent.ownerId, revision: body.revision }, { $set: { steps, summary: workflowSummary(steps) }, $inc: { revision: 1 }, $push: { events: { id: body.eventId, hash: fingerprint, runId, at: new Date(), action: 'source_checked', step: body.step, counted: result.counted, before: row.steps[body.step], after: steps[body.step] } } })
  if (!r.matchedCount) fail(409, 'Workflow changed')
  return { row: visible(await Workflow.findById(row._id).lean()), counted: result.counted }
}

export async function finishWorkflowRun(agent: any, runId: string, body: any) {
  const { config, run } = await leasedRun(agent, runId, body?.lease)
  if (!['complete', 'connection_required', 'interrupted'].includes(body.status)) fail(400, 'Invalid run result')
  const rows: any[] = await Workflow.find({ ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through } }).select('steps').lean()
  const summary: any = { total: rows.length }
  for (const row of rows) { const state = workflowSummary(row.steps).state; summary[state] = (summary[state] || 0) + 1 }
  const status = body.status === 'complete' && summary.connection_required > 0 ? 'connection_required' : body.status
  const r = await Run.updateOne({ _id: run._id, ownerId: agent.ownerId, lease: body.lease, leaseUntil: { $gt: new Date() } }, { $set: { status, summary, completedAt: new Date() }, $unset: { lease: '', leaseUntil: '' } })
  if (!r.matchedCount) fail(409, 'Workflow run changed')
  await Config.updateOne({ _id: config._id, lease: body.lease }, { $unset: { lease: '', leaseUntil: '' } })
  return { summary }
}

export async function connectWorkflowInventory(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease)
  if (!body || Object.keys(body).some(k => !['lease', 'purchaseId', 'revision', 'inventorySourceId', 'shippingSourceId'].includes(k)) || !Number.isSafeInteger(body.revision)) fail(400, 'Invalid inventory connection')
  const snapshots: any = {}
  for (const kind of ['inventory', 'shipping']) {
    const source: any = await Source.findOne({ _id: id(body[kind + 'SourceId']), ownerId: agent.ownerId, runId: run._id, kind, complete: true }).lean()
    if (!source) fail(409, 'Complete source snapshot required')
    const bytes = await readFile(sourcePath(String(agent.ownerId), source.hash))
    if (digest(bytes) !== source.hash || bytes.length !== source.size) fail(409, 'Source snapshot integrity failed')
    const payload = JSON.parse(bytes.toString('utf8'))
    snapshots[kind] = { id: String(source._id), complete: source.complete, name: source.name, rows: payload.rows, url: source.scope.url, capturedAt: source.capturedAt.toISOString() }
  }
  return withPurchaseGraph(String(agent.ownerId), async check => {
    const purchase: any = await FinancePurchaseLink.findOne({ _id: id(body.purchaseId), ownerId: agent.ownerId, accountId: { $in: run.policy.accountIds }, status: 'linked' }).lean()
    if (!purchase || purchase.payment.date < run.policy.from || purchase.payment.date > run.policy.through) fail(404, 'Purchase not found')
    if (purchase.revision !== body.revision) fail(409, 'Purchase changed')
    return withWorkflowPayment(String(agent.ownerId), purchase, async (_payment, paymentCheck) => {
    if (purchase.order.kind !== 'receipt') {
      const archive: any = await Source.findOne({ ownerId: agent.ownerId, runId: run._id, kind: 'orders', complete: true }).lean()
      let collision = !!await FinancePurchaseLink.exists({ ownerId: agent.ownerId, status: 'linked', _id: { $ne: purchase._id }, 'order.orderNumber': purchase.order.orderNumber })
      if (archive) {
        const bytes = await readFile(sourcePath(String(agent.ownerId), archive.hash)); if (digest(bytes) !== archive.hash || bytes.length !== archive.size) fail(409, 'Order snapshot integrity failed')
        collision ||= new Set(JSON.parse(bytes.toString('utf8')).orders.filter((o: any) => o.orderNumber === purchase.order.orderNumber).map((o: any) => o.id)).size > 1
      }
      if (collision) { await leasedRun(agent, runId, body.lease); await paymentCheck(); await check(); await recordWorkflowConflict(agent, run, purchase, [{ reason: 'order_reference_collision' }]); return { state: 'manual_review', conflicts: [{ reason: 'order_reference_collision' }], saved: false } }
    }
    let matched
    try { matched = matchWorkflowInventory(purchase.order, snapshots) } catch (e: any) { fail(409, e.message) }
    if (matched.conflicts.length) { await leasedRun(agent, runId, body.lease); await paymentCheck(); await check(); await recordWorkflowConflict(agent, run, purchase, matched.conflicts); return { state: 'manual_review', conflicts: matched.conflicts, proposals: matched.proposals, saved: false } }
    if (!matched.changed) return { state: matched.proposals.length ? 'manual_review' : 'unchanged', proposals: matched.proposals, saved: false, identified: matched.identified, total: matched.total }
    const ids = matched.order.inventoryLinks.map((s: any) => s.inventoryId)
    if (await FinancePurchaseLink.exists({ ownerId: agent.ownerId, status: 'linked', _id: { $ne: purchase._id }, inventoryIds: { $in: ids } })) { await recordWorkflowConflict(agent, run, purchase, [{ reason: 'inventory_already_assigned' }]); return { state: 'manual_review', conflicts: [{ reason: 'inventory_already_assigned' }], saved: false } }
    await checkPurchaseAllocations(String(agent.ownerId), purchase, matched.order)
    if (purchase.history.length >= 100) fail(409, 'Purchase history limit reached')
    await leasedRun(agent, runId, body.lease); await check(); await paymentCheck()
    const r = await FinancePurchaseLink.updateOne({ _id: purchase._id, ownerId: agent.ownerId, revision: body.revision, status: 'linked' }, {
      $set: { order: matched.order, inventoryIds: ids, candidateHash: hash([purchase.candidateHash, matched.order]), evidence: [...purchase.evidence, ...matched.sources] },
      $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'nightly_inventory_connected', runId, before: { order: purchase.order, evidence: purchase.evidence, originals: purchase.originals } } }
    })
    if (!r.matchedCount) fail(409, 'Purchase changed')
    return { state: matched.proposals.length ? 'manual_review' : 'connected', saved: true, identified: matched.identified, total: matched.total, proposals: matched.proposals }
    })
  })
}

async function recordWorkflowConflict(agent: any, run: any, purchase: any, conflicts: any[]) {
  const row: any = await Workflow.findOne({ ownerId: agent.ownerId, purchaseId: purchase._id }).lean()
  if (!row) return
  if (row.events.length >= 2000) fail(409, 'Workflow history limit reached')
  const steps = { ...row.steps }
  for (const [key, step] of Object.entries(steps) as any) {
    const affected = conflicts.some(c => c.reason === 'order_reference_collision' ? step.stage !== 'purchase' : c.inventoryId ? step.unit === c.inventoryId || step.stage === 'inventory' && purchase.order.inventoryLinks.some((s: any) => s.inventoryId === c.inventoryId && step.unit === 'item:' + s.itemLine) : step.stage === 'inventory' && (!c.itemLine || step.unit === 'item:' + c.itemLine))
    if (affected) steps[key] = { ...applyWorkflowObservation(step, { reason: 'conflict' }).step, suggestion: '保存済みの接続と新しい在庫・出荷資料が一致しません。原本と候補を確認してください。', conflicts }
  }
  if (same(steps, row.steps)) return
  await leasedRun(agent, String(run._id), run.lease)
  const result = await Workflow.updateOne({ _id: row._id, revision: row.revision }, { $set: { steps, summary: workflowSummary(steps) }, $inc: { revision: 1 }, $push: { events: { id: randomUUID(), runId: String(run._id), at: new Date(), action: 'source_conflict', conflicts } } })
  if (!result.matchedCount) fail(409, 'Workflow review changed')
}

async function workflowShipments(agent: any, run: any) {
  const ownerId = agent.ownerId
  const rows: any[] = await Workflow.find({ ownerId, accountId: { $in: run.policy.accountIds }, 'payment.date': { $gte: run.policy.from, $lte: run.policy.through }, purchaseId: { $ne: null } }).lean()
  const links: any[] = await FinancePurchaseLink.find({ ownerId, _id: { $in: rows.map(r => r.purchaseId) }, status: 'linked' }).lean()
  const groups = new Map<string, any>()
  for (const purchase of links) {
    const row = rows.find(r => String(r.purchaseId) === String(purchase._id))
    if (!row || row.steps.purchase?.state !== 'complete') continue
    for (const stock of purchase.order.inventoryLinks) {
      const step = Object.values(row.steps).find((s: any) => s.stage === 'documents' && s.unit === stock.inventoryId) as any
      if (!step || ['complete', 'not_applicable', 'manual_review'].includes(step.state) || step.snoozedUntil > run.day) continue
      const shipments = stock.shipments.filter((s: any) => s.orderId?.trim() && s.tracking?.trim())
      if (shipments.length !== 1) { if (shipments.length > 1) await recordWorkflowConflict(agent, run, purchase, [{ reason: 'multiple_shipments', inventoryId: stock.inventoryId }]); continue }
      const s = shipments[0], orderId = s.orderId.trim().toUpperCase(), tracking = s.tracking.replace(/[\s-]/g, ''), shippedAt = s.date.replaceAll('/', '-')
      if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(orderId) || !/^\d{6,30}$/.test(tracking) || !validDate(shippedAt)) { await recordWorkflowConflict(agent, run, purchase, [{ reason: 'invalid_shipment_reference', inventoryId: stock.inventoryId }]); continue }
      const key = hash(['intras', 'ohmyjapan1', orderId]), group = groups.get(key) || { key, providerAccount: 'ohmyjapan1', orderId, tracking, shippedAt, allocations: [], conflict: false }
      if (group.tracking !== tracking || group.shippedAt !== shippedAt) group.conflict = true
      group.allocations.push({ purchaseId: String(purchase._id), revision: purchase.revision, inventoryId: stock.inventoryId })
      groups.set(key, group)
    }
  }
  const targets = []
  for (const group of groups.values()) {
    const conflict = async (reason: string) => { for (const allocation of group.allocations) { const purchase = links.find(p => String(p._id) === allocation.purchaseId); await recordWorkflowConflict(agent, run, purchase, [{ reason, inventoryId: allocation.inventoryId }]) } }
    if (group.conflict) { await conflict('shipment_group_conflict'); continue }
    const existing: any = await FinanceExport.findOne({ ownerId, provider: 'intras', providerAccount: group.providerAccount, orderId: group.orderId }).lean()
    if (existing && (existing.status !== 'active' || existing.trackingKey !== group.tracking || existing.shippedAt !== group.shippedAt)) { await conflict('saved_export_conflict'); continue }
    let reusable = !!existing?.verifiedAt && !!existing.permitNumber && !!existing.permitDate && ['invoice', 'permit'].every(kind => existing.documents.some((d: any) => d.kind === kind))
    if (reusable) {
      for (const d of existing.documents) {
        try { const bytes = await readFile(path.join(process.env.OMF_DATA_DIR || path.join(os.homedir(), '.ohmyfinance'), 'export-documents', String(ownerId), d.hash)); if (digest(bytes) !== d.hash || bytes.length !== d.size) reusable = false } catch { reusable = false }
      }
    }
    targets.push({ ...group, fingerprint: hash([group.allocations, existing?._id, existing?.revision]), existingId: existing ? String(existing._id) : null, existingRevision: existing?.revision || 0, reusable })
  }
  return targets
}

export async function saveWorkflowDocuments(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease), owner = String(agent.ownerId)
  if (!body || Object.keys(body).some(k => !['lease', 'key', 'fingerprint', 'capture'].includes(k)) || !/^[a-f0-9]{64}$/.test(body.key || '') || !/^[a-f0-9]{64}$/.test(body.fingerprint || '')) fail(400, 'Invalid document target')
  const target = (await workflowShipments(agent, run)).find(t => t.key === body.key)
  if (!target || target.fingerprint !== body.fingerprint) fail(409, 'Shipment evidence changed')
  const existing: any = target.existingId ? await FinanceExport.findOne({ _id: target.existingId, ownerId: agent.ownerId }).lean() : null
  let parsed: any, documents: any[], verificationEvidence: any
  if (target.reusable) {
    parsed = { providerAccount: existing.providerAccount, orderId: existing.orderId, applicationId: existing.applicationId, tracking: existing.tracking, shippedAt: existing.shippedAt, itemCount: existing.itemCount, declaredAmount: existing.declaredValue.amount, permitNumber: existing.permitNumber, permitDate: existing.permitDate }
    documents = existing.documents.map((d: any) => ({ kind: d.kind, hash: d.hash }))
    verificationEvidence = existing.verificationEvidence || { method: 'previously_confirmed_documents', exportRevision: existing.revision }
  } else {
    const c = body.capture
    if (!c || !Array.isArray(c.documents) || c.documents.length !== 2 || !Array.isArray(c.models) || !c.models.length || c.models.some((m: any) => typeof m !== 'string' || m.length > 100) || !c.delivery || c.delivery.url !== 'https://intras.co.jp/mypage/delivery?referCode=' + encodeURIComponent(target.orderId) || !c.delivery.text?.includes(target.orderId) || !c.delivery.text.replace(/[\s-]/g, '').includes(target.tracking)) fail(400, 'Captured Intras identity required')
    const bound = { ...target, applicationId: c.target?.applicationId }
    if (!/^\d{4,20}$/.test(bound.applicationId || '') || !c.delivery.text.includes(bound.applicationId)) fail(400, 'Intras application identity required')
    const invoice = c.documents.find((d: any) => d.kind === 'invoice'), permit = c.documents.find((d: any) => d.kind === 'permit')
    try { parsed = parseIntrasDocuments(bound, invoice?.text, permit?.text); verifyIntrasPdfReadback(parsed, c.readback) } catch { fail(409, 'PDF and official source do not agree') }
    if (existing && (existing.declaredValue.amount !== parsed.declaredAmount || existing.itemCount !== parsed.itemCount || existing.applicationId && existing.applicationId !== parsed.applicationId || existing.permitNumber && existing.permitNumber !== parsed.permitNumber || existing.permitDate && existing.permitDate !== parsed.permitDate)) fail(409, 'Previously saved shipment details conflict')
    documents = []
    for (const d of [invoice, permit]) {
      if (typeof d.base64 !== 'string' || d.base64.length > 14000000 || typeof d.text !== 'string' || d.text.length > 150000 || typeof d.html !== 'string' || d.html.length > 2000000 || !String(d.sourceUrl).startsWith('https://intras.co.jp/') || d.captureMethod !== (d.kind === 'invoice' ? 'native_intras_pdf' : 'official_print_view') || !Number.isFinite(Date.parse(d.capturedAt)) || Date.parse(d.capturedAt) > Date.now() + 5000) fail(400, 'Invalid collected PDF')
      const bytes = Buffer.from(d.base64, 'base64')
      if (bytes.toString('base64') !== d.base64 || digest(bytes) !== d.hash) fail(409, 'Collected PDF integrity failed')
      await uploadExportDocument(owner, target.allocations[0].purchaseId, d.name, bytes, 'application/pdf')
      const upload: any = await FinanceExportUpload.findOne({ ownerId: agent.ownerId, purchaseId: target.allocations[0].purchaseId, hash: d.hash }).lean()
      documents.push({ kind: d.kind, uploadId: String(upload._id), hash: d.hash })
    }
    const source = { target: bound, delivery: c.delivery, documents: c.documents.map(({ base64, ...d }: any) => d), readback: c.readback, models: c.models }, bytes = Buffer.from(JSON.stringify(source)), sourceHash = digest(bytes), file = sourcePath(owner, sourceHash)
    await mkdir(path.dirname(file), { recursive: true }); try { await writeFile(file, bytes, { flag: 'wx' }) } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (digest(await readFile(file)) !== sourceHash) fail(409, 'Document provenance integrity failed') }
    verificationEvidence = { method: 'official_source_and_pdf_readback', runId, sourceHash, models: c.models, capturedAt: new Date(), documents: c.documents.map((d: any) => ({ kind: d.kind, hash: d.hash, sourceUrl: d.sourceUrl, captureMethod: d.captureMethod })) }
  }
  const allocations = [...(existing?.allocations || []).map((a: any) => ({ purchaseId: a.purchaseId, inventoryId: a.inventoryId }))]
  for (const a of target.allocations) if (!allocations.some(v => v.purchaseId === a.purchaseId && v.inventoryId === a.inventoryId)) allocations.push({ purchaseId: a.purchaseId, inventoryId: a.inventoryId })
  if (allocations.length > parsed.itemCount) fail(409, 'Allocated inventory exceeds the invoice quantity')
  const check = async () => {
    await leasedRun(agent, runId, body.lease)
    for (const a of target.allocations) {
      const p: any = await FinancePurchaseLink.findOne({ _id: a.purchaseId, ownerId: agent.ownerId, revision: a.revision, status: 'linked' }).lean()
      if (!p || !p.order.inventoryLinks.some((s: any) => s.inventoryId === a.inventoryId && s.shipments.length === 1 && s.shipments[0].orderId?.trim().toUpperCase() === target.orderId && s.shipments[0].tracking.replace(/[\s-]/g, '') === target.tracking)) fail(409, 'Purchase or shipment evidence changed')
    }
  }
  await check()
  const saved = await saveExport(owner, { ...parsed, ...(existing ? { id: String(existing._id) } : {}), revision: target.existingRevision, allocations, documents, confirm: true, confirmDocuments: true }, { check, evidence: verificationEvidence })
  return { saved: true, exportId: saved.record.id, reusedDocuments: target.reusable, declaredAmount: parsed.declaredAmount }
}

export async function saveWorkflowDocumentAttempt(agent: any, runId: string, body: any) {
  const { run } = await leasedRun(agent, runId, body?.lease), target = (await workflowShipments(agent, run)).find(t => t.key === body.key), attempt = body.attempt
  if (!target || target.fingerprint !== body.fingerprint) fail(409, 'Document target changed')
  if (target.reusable || !attempt || attempt.kind !== 'delivery_not_found' || attempt.url !== 'https://intras.co.jp/mypage/delivery?referCode=' + encodeURIComponent(target.orderId) || attempt.formPresent !== true || !Array.isArray(attempt.rows) || attempt.rows.length || typeof attempt.html !== 'string' || !attempt.html.includes('form-option-extend') || attempt.html.length > 2000000 || !Number.isFinite(Date.parse(attempt.capturedAt)) || new Date(attempt.capturedAt) < run.startedAt || Date.parse(attempt.capturedAt) > Date.now() + 5000 || workflowDay(attempt.capturedAt) !== run.day) fail(400, 'Qualified document search required')
  const bytes = Buffer.from(JSON.stringify({ target, attempt })), sourceHash = digest(bytes), file = sourcePath(String(agent.ownerId), sourceHash)
  await mkdir(path.dirname(file), { recursive: true }); try { await writeFile(file, bytes, { flag: 'wx' }) } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (digest(await readFile(file)) !== sourceHash) fail(409, 'Attempt evidence integrity failed') }
  let counted = 0
  for (const purchaseId of [...new Set(target.allocations.map((a: any) => a.purchaseId))]) {
    const row: any = await Workflow.findOne({ ownerId: agent.ownerId, purchaseId }).lean(); if (!row) fail(409, 'Workflow changed')
    if (row.events.length >= 2000) fail(409, 'Workflow history limit reached')
    const steps = { ...row.steps }, changes = []
    for (const [key, previous] of Object.entries(steps) as any) {
      if (previous.stage !== 'documents' || !target.allocations.some((a: any) => a.inventoryId === previous.unit) || ['complete', 'not_applicable'].includes(previous.state)) continue
      const result = applyWorkflowObservation(previous, { reason: 'missing_documents', qualified: true, day: run.day })
      if (result.changed) { steps[key] = { ...result.step, sourceHash, suggestion: 'Intrasの注文番号による検索で対応する出荷が見つかりませんでした。出荷記録と接続先を確認してください。' }; changes.push({ key, counted: result.counted }); if (result.counted) counted++ }
    }
    if (!changes.length) continue
    await leasedRun(agent, runId, body.lease)
    const saved = await Workflow.updateOne({ _id: row._id, revision: row.revision }, { $set: { steps, summary: workflowSummary(steps) }, $inc: { revision: 1 }, $push: { events: { id: randomUUID(), at: new Date(), action: 'document_search_checked', runId, sourceHash, changes } } })
    if (!saved.matchedCount) fail(409, 'Workflow changed')
  }
  return { counted }
}

import mongoose from 'mongoose'
import { ready, id, fail } from './financeService'
import { ownedBankAccount } from './financeBankStatementService'
import { listCompanyCalendarEntries } from './companyFinanceReadService'
import { BankRow, initializePaymentMatching } from '../models/FinancePaymentMatch'
import { BankClassification, BankTeaching, initializeBankClassification } from '../models/FinanceBankClassification'
import Transaction from '../models/Transaction'
import AccountCategory from '../models/AccountCategory'
import TaxCategory from '../models/TaxCategory'
import Supplier from '../models/Supplier'
import Organization from '../models/Organization'
import { BANK_CLASSIFICATION_VERSION, UNRESOLVED_LABELS, classificationValues, journalPreview, proposalHash, proposeBankClassifications, registrationReady } from '../../shared/finance-bank-classification.mjs'
// Native bank classification (plan omf-rakuten-native-shiwake-20261020 §4-§7). Every function receives the owner (the signed-in
// user: the bank account and rows are the owner's) and the selected company whose membership the route checked fresh at this
// request (calendarCompany). Calendar, history and teaching are read for that company only. Reads and generation never post a
// Transaction nor change a calendar entry; only the explicit registration creates the one reserved Transaction (or links an
// existing company Transaction), and any retry/crash/concurrent request resumes that same effect.
// GUARDS (bank-specific, independent review required): owner+company draft scope, one company per source row, expected revision
// on every write, source-change acknowledgement, registration readiness, existing-candidate double-booking check, reserved ID.
const sid = (v: any) => String(v ?? ''), STALE = '仕訳が変更されました。再読み込みしてください。', NOT_FOUND = '仕訳が見つかりません。'
async function init() { await ready(); await initializePaymentMatching(); await initializeBankClassification() }
const scopeOfDraft = (ownerId: string, organizationId: any, draftId: string) => ({ _id: id(draftId), ownerId, organizationId })
const jstDay = (d: any) => d instanceof Date ? new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10) : String(d ?? '').slice(0, 10)
const sourceOf = (row: any) => ({ revision: row.revision, fingerprint: row.fingerprint, key: row.key, date: row.date, amount: row.amount, direction: row.direction, currency: row.currency || 'JPY', description: row.description, statementHashes: [...new Set((row.provenance || []).map((p: any) => p?.hash).filter(Boolean))] })
const storedProposal = (p: any) => ({ proposal: p.proposal, evidence: p.evidence, unresolved: p.unresolved, calendarCandidates: p.calendarCandidates, transfer: p.transfer })

async function context(ownerId: string, organizationId: mongoose.Types.ObjectId, bankAccountId: any) {
  await init()
  const account: any = await ownedBankAccount(ownerId, id(typeof bankAccountId === 'string' ? bankAccountId : ''))
  const [rows, drafts, calendarDocs, organization, chartDocs, historyDrafts, teachings]: any[] = await Promise.all([
    BankRow.find({ ownerId, bankAccountId: account._id }).sort({ date: 1, _id: 1 }).lean(),
    BankClassification.find({ ownerId, bankAccountId: account._id }).lean(),
    listCompanyCalendarEntries(organizationId),
    Organization.findOne({ _id: organizationId }).select('name').lean(),
    AccountCategory.find({ isActive: true }).select('name type').lean(),
    BankClassification.find({ organizationId, 'registration.state': { $in: ['registered', 'linked'] } }).select('payeeKey direction values registration.values').lean(),
    BankTeaching.find({ organizationId }).lean()
  ])
  // A row replaced through an explicit correction edge (financePaymentMatchService supersedeBankRow) stays visible as superseded.
  const edges = new Set<string>((account.corrections || []).map((e: any) => sid(e.oldId))), superseded = new Set<string>(rows.filter((r: any) => edges.has(sid(r._id)) || r.state === 'superseded').map((r: any) => sid(r._id)))
  const chart = chartDocs.map((a: any) => ({ id: sid(a._id), name: a.name, type: a.type }))
  const calendar = calendarDocs.map((p: any) => ({ id: sid(p._id), title: p.title, amount: p.amount, currency: p.currency, dueDate: jstDay(p.dueDate), type: p.type, status: p.status, category: p.category, recurring: !!p.recurring }))
  // The bank side of the preview names the owner's actual bank account; the chart's 普通預金 only when it exists (never fabricated).
  const bankName = chart.some((a: any) => a.name === '普通預金') ? '普通預金（' + account.name + '）' : account.name + '（勘定科目 未設定）'
  // A row that replaced (explicit correction edge) a row already registered or linked in any company is never registered again.
  const successor = new Map<string, string>((account.corrections || []).map((e: any) => [sid(e.oldId), sid(e.newId)]))
  const canonical = (key: string) => { const seen = new Set<string>(); while (successor.has(key) && !seen.has(key)) { seen.add(key); key = successor.get(key)! } return key }
  const registeredRows = new Set<string>(drafts.filter((d: any) => d.registration).map((d: any) => sid(d.bankRowId)))
  const predecessorRegistered = new Set<string>(rows.filter((r: any) => superseded.has(sid(r._id)) && registeredRows.has(sid(r._id))).map((r: any) => canonical(sid(r._id))))
  const active = rows.filter((r: any) => !superseded.has(sid(r._id)))
  const proposed = proposeBankClassifications({ rows: active.map((r: any) => ({ id: sid(r._id), date: r.date, amount: r.amount, currency: r.currency, description: r.description })), calendar, history: historyDrafts.map((d: any) => ({ payeeKey: d.payeeKey, direction: d.direction, values: d.registration?.values || d.values })), teachings: teachings.map((t: any) => ({ payeeKey: t.payeeKey, direction: t.direction, values: t.values })), companyNames: [organization?.name].filter(Boolean), chart, bankAccountName: bankName })
  return { account, rows, drafts, superseded, predecessorRegistered, chart, bankName, organizationId, organization, proposals: new Map<string, any>(proposed.rows.map((p: any) => [p.rowId, p])), notes: proposed.notes }
}
function draftView(d: any, row: any, c: any) {
  const reg = d.registration, proposed = d.proposed || {}, live = row ? c.proposals.get(sid(row._id)) : null
  const sourceChanged = !!row && (row.revision !== d.source?.revision || row.fingerprint !== d.source?.fingerprint), superseded = !!row && c.superseded.has(sid(row._id)), predecessorRegistered = !!row && c.predecessorRegistered.has(sid(row._id))
  const state = reg?.state === 'registered' ? 'registered' : reg?.state === 'linked' ? 'linked' : reg?.state === 'reserved' ? 'registering' : d.manual ? 'edited' : 'proposed'
  const account = c.chart.find((a: any) => a.id === d.values?.accountCategoryId)
  return {
    id: sid(d._id), revision: d.revision, state, manual: !!d.manual, values: d.values, payeeKey: d.payeeKey, proposed: proposed.proposal || null, evidence: proposed.evidence || [], unresolved: proposed.unresolved || [], calendarCandidates: proposed.calendarCandidates || [], transfer: proposed.transfer || null,
    tax: { status: d.values?.taxCategoryId ? 'owner-selected' : 'unknown' }, invoice: { value: d.values?.invoiceNumber || null, status: d.values?.invoiceNumber ? 'entered-unverified' : 'unverified' },
    preview: journalPreview(d.direction, Math.abs(Number(d.source?.amount)), account?.name || null, c.bankName), source: d.source, sourceChanged, superseded, evidenceChanged: !!live && proposalHash(live) !== d.proposalHash,
    predecessorRegistered, ready: registrationReady({ values: d.values, transfer: proposed.transfer, sourceChanged, superseded, predecessorRegistered, currency: d.source?.currency }),
    registration: reg ? { state: reg.state, kind: reg.kind, transactionId: sid(reg.transactionId), at: reg.at || null, completedAt: reg.completedAt || null } : null,
    reservedTransactionId: sid(d.reservedTransactionId), history: (d.history || []).slice(-20)
  }
}
function rowView(row: any, c: any) {
  const rid = sid(row._id), d = c.drafts.find((x: any) => sid(x.bankRowId) === rid), superseded = c.superseded.has(rid), otherCompany = !!d && sid(d.organizationId) !== sid(c.organizationId)
  const draft = d && !otherCompany ? draftView(d, row, c) : null
  return { rowId: rid, rowRevision: row.revision, key: row.key, date: row.date, amount: row.amount, direction: row.direction, currency: row.currency, description: row.description, state: superseded ? 'superseded' : otherCompany ? 'other-company' : draft ? draft.state : 'none', superseded, otherCompany, predecessorRegistered: c.predecessorRegistered.has(rid), proposal: superseded || otherCompany ? null : c.proposals.get(rid) || null, draft }
}
function listOf(c: any) {
  const rows = c.rows.map((r: any) => rowView(r, c)), count = (s: string) => rows.filter((r: any) => r.state === s).length
  return {
    account: { id: sid(c.account._id), name: c.account.name, currency: c.account.currency }, company: { id: sid(c.organizationId), name: c.organization?.name || '' }, rows,
    counts: { rows: rows.length, drafts: rows.filter((r: any) => r.draft).length, none: count('none'), proposed: count('proposed'), edited: count('edited'), registering: count('registering'), registered: count('registered'), linked: count('linked'), otherCompany: count('other-company'), superseded: count('superseded'), unresolved: rows.filter((r: any) => !['registered', 'linked', 'other-company', 'superseded'].includes(r.state) && ((r.draft?.unresolved || r.proposal?.unresolved || []).length > 0)).length },
    notes: { ...c.notes }
  }
}
async function viewOne(ownerId: string, organizationId: mongoose.Types.ObjectId, d: any) {
  const c = await context(ownerId, organizationId, sid(d.bankAccountId)), row = c.rows.find((r: any) => sid(r._id) === sid(d.bankRowId))
  return row ? rowView(row, c) : { rowId: sid(d.bankRowId), state: 'source-missing', superseded: false, otherCompany: false, proposal: null, draft: draftView(d, null, c) }
}
async function assertReferences(v: any) {
  for (const [key, model] of [['accountCategoryId', AccountCategory], ['subAccountCategoryId', AccountCategory], ['taxCategoryId', TaxCategory], ['supplierId', Supplier]] as const) if (v?.[key] && !await (model as any).exists({ _id: v[key] })) fail(400, '存在する勘定科目・税区分・取引先を一覧から選択してください。')
}
const transactionView = (t: any) => ({ id: sid(t._id), date: t.date, amount: t.amount, type: t.type, notes: t.notes || t.productName || '', accountCategoryId: t.accountCategoryId ? sid(t.accountCategoryId) : null, organizationId: sid(t.organizationId), bankClassificationId: t.metadata?.bankClassificationId || null })

/** The rows of one owner bank account for the selected company: every row once (superseded and other-company rows included). */
export async function listBankClassifications(ownerId: string, organizationId: mongoose.Types.ObjectId, query: any) { return listOf(await context(ownerId, organizationId, query?.account)) }
/** Idempotent draft generation for the selected company; manual or registered drafts keep their values; nothing is posted. */
export async function generateBankClassifications(ownerId: string, organizationId: mongoose.Types.ObjectId, body: any) {
  const c = await context(ownerId, organizationId, body?.bankAccountId), now = new Date()
  let created = 0, refreshed = 0, kept = 0, otherCompany = 0, superseded = 0
  for (const row of c.rows) {
    const rid = sid(row._id)
    if (c.superseded.has(rid)) { superseded++; continue }
    const p = c.proposals.get(rid); if (!p) continue
    const d = c.drafts.find((x: any) => sid(x.bankRowId) === rid)
    if (d && sid(d.organizationId) !== sid(organizationId)) { otherCompany++; continue } // one company per source row
    const hash = proposalHash(p), stored = storedProposal(p)
    if (!d) {
      try { await BankClassification.create({ ownerId, organizationId, bankAccountId: c.account._id, bankRowId: row._id, bankRowKey: row.key, payeeKey: p.payeeKey, direction: p.direction, source: sourceOf(row), proposed: stored, proposalHash: hash, values: p.values, manual: false, revision: 1, history: [{ at: now, by: ownerId, action: 'proposed', revision: 1 }], reservedTransactionId: new mongoose.Types.ObjectId(), registration: null, version: BANK_CLASSIFICATION_VERSION }); created++ }
      catch (e: any) { if (e?.code !== 11000) throw e; kept++ }
      continue
    }
    if (d.registration) { kept++; continue }
    if (d.manual) { if (d.proposalHash !== hash) { await BankClassification.updateOne({ _id: d._id, registration: null }, { $set: { proposed: stored, proposalHash: hash } }); refreshed++ } else kept++; continue }
    if (d.proposalHash === hash && d.source?.revision === row.revision && d.source?.fingerprint === row.fingerprint) { kept++; continue }
    const saved = await BankClassification.updateOne({ _id: d._id, revision: d.revision, manual: false, registration: null }, { $set: { proposed: stored, proposalHash: hash, values: p.values, source: sourceOf(row), payeeKey: p.payeeKey }, $inc: { revision: 1 }, $push: { history: { at: now, by: ownerId, action: 'refreshed', revision: d.revision + 1 } } })
    if (saved.modifiedCount) refreshed++; else kept++
  }
  return { created, refreshed, kept, skipped: { otherCompany, superseded }, ...listOf(await context(ownerId, organizationId, body?.bankAccountId)) }
}
export async function getBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string) {
  await init(); const d: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!d) fail(404, NOT_FOUND)
  return { row: await viewOne(ownerId, organizationId, d), linkCandidates: (await linkCandidates(organizationId, d)).map(transactionView) }
}
/** An owner correction at the expected revision; a changed source must be acknowledged explicitly (acceptSource). */
export async function updateBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string, body: any) {
  await init(); const draft: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!draft) fail(404, NOT_FOUND)
  if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.revision)) fail(400, '仕訳のリビジョンを確認してください。')
  if (body.revision !== draft.revision) fail(409, STALE)
  if (draft.registration) fail(409, '登録済み（または登録中）の仕訳は変更できません。')
  let values: any; try { values = classificationValues(body.values ?? {}, draft.values) } catch (e: any) { fail(400, e.message) }
  await assertReferences(values)
  const row: any = await BankRow.findOne({ _id: draft.bankRowId, ownerId }).lean(); if (!row) fail(409, '元の明細が見つかりません。')
  const sourceChanged = row.revision !== draft.source?.revision || row.fingerprint !== draft.source?.fingerprint
  if (sourceChanged && body.acceptSource !== true) fail(409, '元の明細が変更されました。変更後の内容を確認して「元の明細の変更を確認」を選んでください。')
  const set: any = { values, manual: true }; if (sourceChanged) set.source = sourceOf(row)
  const saved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, registration: null }, { $set: set, $inc: { revision: 1 }, $push: { history: { at: new Date(), by: ownerId, action: 'edited', revision: draft.revision + 1, before: draft.values, after: values, ...(sourceChanged ? { sourceAccepted: { from: draft.source?.revision ?? null, to: row.revision } } : {}) } } })
  if (!saved.modifiedCount) fail(409, STALE)
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: draft._id }).lean()) }
}
/** Explicit reusable teaching from an approved exact payee decision (an edited or registered draft) of this company. */
export async function rememberBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string, body: any) {
  await init(); const current: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!current) fail(404, NOT_FOUND)
  if (!Number.isSafeInteger(body?.revision) || Number(body.revision) !== current.revision) fail(409, STALE)
  const ownTransfer = body?.kind === 'own-transfer', v = current.values || {}
  if (!current.payeeKey) fail(400, '支払先を特定できないため記憶できません。')
  if (!current.manual && !current.registration) fail(400, '確認・修正した仕訳だけを記憶できます。')
  if (!ownTransfer && (!String(v.purpose || '').trim() || !/^[a-f\d]{24}$/i.test(String(v.accountCategoryId || '')))) fail(400, '用途と勘定科目を確認してから記憶してください。')
  if (!ownTransfer && current.proposed?.transfer) fail(400, '自社名の振込は資金移動として記憶してください。')
  const values = ownTransfer ? { purpose: 'own-transfer' } : { purpose: v.purpose, accountCategoryId: v.accountCategoryId, subAccountCategoryId: v.subAccountCategoryId || '', supplierId: v.supplierId || '' }
  const write = () => BankTeaching.findOneAndUpdate({ organizationId, payeeKey: current.payeeKey, direction: current.direction }, { $set: { ownerId, values, sourceDraftId: current._id }, $inc: { revision: 1 }, $push: { history: { at: new Date(), by: ownerId, draftId: current._id, values } } }, { upsert: true, new: true }).lean()
  let saved: any; try { saved = await write() } catch (e: any) { if (e?.code !== 11000) throw e; saved = await write() }
  return { teaching: { payeeKey: saved.payeeKey, direction: saved.direction, values: saved.values, revision: saved.revision } }
}
// Existing company Transactions the row may be the bank side of: same company, amount, direction (支出/入金), date ±7 days, not
// itself a bank-classification registration and not linked to another source row.
async function linkCandidates(organizationId: mongoose.Types.ObjectId, d: any) {
  const at = Date.parse(String(d.source?.date ?? '')); if (!Number.isFinite(at)) return []
  const found: any[] = await Transaction.find({ organizationId, amount: Math.abs(Number(d.source.amount)), type: d.direction === 'in' ? '入金' : '支出', date: { $gte: new Date(at - 7 * 86400000), $lte: new Date(at + 8 * 86400000) }, 'metadata.bankClassificationId': { $exists: false } } as any).select('_id date amount type notes productName accountCategoryId organizationId').sort({ date: 1 }).limit(20).lean()
  if (!found.length) return []
  const taken: any[] = await BankClassification.find({ organizationId, 'registration.transactionId': { $in: found.map(t => t._id) }, _id: { $ne: d._id } }).select('registration.transactionId').lean()
  const used = new Set(taken.map(x => sid(x.registration?.transactionId)))
  return found.filter(t => !used.has(sid(t._id)))
}
function transactionPayload(d: any, row: any, v: any) {
  const ref = (key: string) => v[key] ? { [key]: v[key] } : {}
  return {
    referenceNumber: 'BANK-' + sid(d._id), date: new Date(row.date + 'T00:00:00.000Z'), amount: Math.abs(Number(row.amount)), type: Number(row.amount) < 0 ? '入金' : '支出', status: 'completed',
    ...ref('accountCategoryId'), ...ref('subAccountCategoryId'), ...ref('taxCategoryId'), ...ref('supplierId'), ...(v.taxRate !== null && v.taxRate !== undefined ? { taxRate: v.taxRate } : {}), ...(v.invoiceNumber ? { invoiceNumber: v.invoiceNumber } : {}),
    paymentMethod: '銀行口座', hasReceipt: false, notes: v.notes || row.description, items: [], attachments: [], tags: ['bank'],
    metadata: { bankClassificationId: sid(d._id), bankAccountId: sid(d.bankAccountId), bankRowId: sid(row._id), bankRowKey: row.key, bankRowRevision: row.revision, sourceFingerprint: row.fingerprint, sourceHashes: [...new Set((row.provenance || []).map((p: any) => p?.hash).filter(Boolean))], bankDescription: row.description, purpose: v.purpose, evidence: (d.proposed?.evidence || []).map((e: any) => String(e?.label || '')).slice(0, 10), unresolvedAtRegistration: d.proposed?.unresolved || [], taxStatus: v.taxCategoryId ? 'owner-selected' : 'unknown', invoiceNumberStatus: v.invoiceNumber ? 'entered-unverified' : 'none', classificationVersion: BANK_CLASSIFICATION_VERSION },
    timeline: [{ type: 'bank-classification', title: '銀行明細から登録', timestamp: new Date(), description: row.date + ' ' + String(row.description ?? '').slice(0, 120) }]
  }
}
async function release(d: any, reason: string) {
  await BankClassification.updateOne({ _id: d._id, 'registration.state': 'reserved' }, { $set: { registration: null }, $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'registration-released', reason } } })
}
// The one effect of a reserved registration: an upsert keyed on the reserved ID, the company and this draft. A record already at
// that ID for another company or source is never touched (the reservation is released and the request refused).
async function insertTransaction(d: any, reg: any) {
  const now = new Date(), doc: any = new Transaction({ ...reg.payload, _id: reg.transactionId, createdAt: now, updatedAt: now, __v: 0 })
  doc.set('organizationId', d.organizationId, { strict: false })
  await doc.validate()
  const filter: any = { _id: reg.transactionId, organizationId: d.organizationId, 'metadata.bankClassificationId': sid(d._id) }
  try { await Transaction.collection.updateOne(filter, { $setOnInsert: doc.toObject({ virtuals: false }) }, { upsert: true }) }
  catch (e: any) { if (e?.code !== 11000) throw e; if (!await Transaction.collection.findOne(filter)) { await release(d, 'reserved-id-conflict'); fail(409, '予約済みの取引IDに別の記録があるため登録できません。') } }
}
async function resumeRegistration(ownerId: string, organizationId: mongoose.Types.ObjectId, d: any, body: any, replayed: boolean) {
  const reg = d.registration
  if (body.action !== reg.kind) fail(409, 'この明細は別の操作（' + (reg.kind === 'link' ? '紐付け' : '新規登録') + '）で登録済みです。')
  if (reg.kind === 'link' && body.transactionId !== undefined && String(body.transactionId) !== sid(reg.transactionId)) fail(409, 'この明細は別の取引に紐付け済みです。')
  if (reg.state === 'reserved') {
    if (reg.kind === 'create') await insertTransaction(d, reg)
    else if (!await Transaction.exists({ _id: reg.transactionId, organizationId: d.organizationId } as any)) { await release(d, 'linked-transaction-missing'); fail(409, '紐付ける取引が見つかりません。') }
    await BankClassification.updateOne({ _id: d._id, 'registration.state': 'reserved' }, { $set: { 'registration.state': reg.kind === 'link' ? 'linked' : 'registered', 'registration.completedAt': new Date() }, $push: { history: { at: new Date(), by: ownerId, action: reg.kind === 'link' ? 'linked' : 'registered', transactionId: reg.transactionId } } })
  }
  const tx: any = await Transaction.findOne({ _id: reg.transactionId, organizationId: d.organizationId } as any).lean()
  if (!tx) fail(409, '登録した取引が見つかりません。')
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: d._id }).lean()), transaction: transactionView(tx), replayed }
}
/**
 * Explicit「確認して取引へ登録」: create the native company Transaction with the draft's durable reserved ID, or link an existing
 * company Transaction. The reservation (values, payload, source) is persisted first; a retry, a crash at any point or a concurrent
 * request resumes that same reservation, so the effect happens once. Unresolved purpose/account, an unreviewed own-company
 * transfer, a changed or superseded source and a non-JPY row are refused; an existing candidate needs an explicit link or confirmNew.
 */
export async function registerBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string, body: any) {
  await init()
  if (body?.confirm !== true || !['create', 'link'].includes(body?.action)) fail(400, '「確認して取引へ登録」の確認操作を確認してください。')
  const draft: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!draft) fail(404, NOT_FOUND)
  if (draft.registration) return resumeRegistration(ownerId, organizationId, draft, body, true)
  const expected = Number(body.revision); if (!Number.isSafeInteger(expected) || expected !== draft.revision) fail(409, STALE)
  const action = body.action, c = await context(ownerId, organizationId, sid(draft.bankAccountId)), row = c.rows.find((r: any) => sid(r._id) === sid(draft.bankRowId))
  if (!row) fail(409, '元の明細が見つかりません。')
  const sourceChanged = row.revision !== draft.source?.revision || row.fingerprint !== draft.source?.fingerprint, superseded = c.superseded.has(sid(row._id)), predecessorRegistered = c.predecessorRegistered.has(sid(row._id))
  const readiness = registrationReady({ values: draft.values, transfer: draft.proposed?.transfer, sourceChanged, superseded, predecessorRegistered, currency: row.currency })
  if (!readiness.ready) fail(409, '登録できません: ' + readiness.reasons.map((r: string) => (UNRESOLVED_LABELS as any)[r] || r).join('・') + ' [' + readiness.reasons.join(',') + ']')
  await assertReferences(draft.values)
  const candidates = await linkCandidates(organizationId, draft)
  if (action === 'create' && candidates.length && body.confirmNew !== true) fail(409, '同じ会社に同じ金額・入出金・日付の取引があります。二重登録を避けるため、既存の取引に紐付けるか、新規登録を確認してください。 [existing-transaction-candidate]')
  const transactionId = draft.reservedTransactionId
  let target: any = transactionId
  if (action === 'link') {
    const wanted = String(body.transactionId ?? ''); if (!/^[a-f\d]{24}$/i.test(wanted)) fail(400, '紐付ける取引を選択してください。')
    if (await BankClassification.exists({ organizationId, 'registration.transactionId': new mongoose.Types.ObjectId(wanted), _id: { $ne: draft._id } })) fail(409, 'この取引は別の明細に紐付け済みです。')
    const chosen = candidates.find((t: any) => sid(t._id) === wanted); if (!chosen) fail(400, '同じ会社の同じ金額・入出金・日付の取引を選択してください。')
    target = chosen._id
  }
  const at = new Date(), registration = { state: 'reserved', kind: action, transactionId: target, at, by: ownerId, values: draft.values, source: sourceOf(row), ...(action === 'create' ? { payload: transactionPayload(draft, row, draft.values) } : {}) }
  let reserved: any
  try { reserved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, registration: null }, { $set: { registration }, $inc: { revision: 1 }, $push: { history: { at, by: ownerId, action: action === 'link' ? 'link-reserved' : 'registration-reserved', revision: draft.revision + 1, transactionId: target } } }) }
  catch (e: any) { if (e?.code === 11000) fail(409, 'この取引は別の明細に紐付け済みです。'); throw e }
  const now: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean()
  if (!reserved.modifiedCount && !now?.registration) fail(409, STALE)
  return resumeRegistration(ownerId, organizationId, now, body, !reserved.modifiedCount)
}

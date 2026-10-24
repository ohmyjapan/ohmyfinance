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
import { BANK_CLASSIFICATION_VERSION, UNRESOLVED_LABELS, PURCHASE_ADOPTION_LABELS, classificationValues, journalPreview, normalizePayee, proposalHash, proposeBankClassifications, registrationReady, purchaseAdoption, purchaseAdoptionState, invoiceStatusOf } from '../../shared/finance-bank-classification.mjs'
import { normalizeMerchant } from '../../shared/finance-draft.mjs'
import { bankPurchaseLinks } from './financePaymentMatchService'
// Native bank classification (plan omf-rakuten-native-shiwake-20261020 §4-§7). Every function receives the owner (the signed-in
// user: the bank account and rows are the owner's) and the selected company whose membership the route checked fresh at this
// request (calendarCompany). Calendar, history and teaching are read for that company only. Reads and generation never post a
// Transaction nor change a calendar entry; only the explicit registration creates the one reserved Transaction (or links an
// existing company Transaction), and any retry/crash/concurrent request resumes that same effect.
// GUARDS (bank-specific, independent review required): owner+company draft scope, one company per source row (an unregistered
// draft moves to another company only through the explicit reassignment below), expected revision on every write, source-change
// acknowledgement, registration readiness, existing-candidate double-booking check, reserved ID, reservation identity (op),
// explicit release of a completed registration (never a Transaction write).
const sid = (v: any) => String(v ?? ''), STALE = '仕訳が変更されました。再読み込みしてください。', NOT_FOUND = '仕訳が見つかりません。'
async function init() { await ready(); await initializePaymentMatching(); await initializeBankClassification() }
const scopeOfDraft = (ownerId: string, organizationId: any, draftId: string) => ({ _id: id(draftId), ownerId, organizationId })
const jstDay = (d: any) => d instanceof Date ? new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10) : String(d ?? '').slice(0, 10)
const sourceOf = (row: any) => ({ revision: row.revision, fingerprint: row.fingerprint, key: row.key, date: row.date, amount: row.amount, direction: row.direction, currency: row.currency || 'JPY', description: row.description, statementHashes: [...new Set((row.provenance || []).map((p: any) => p?.hash).filter(Boolean))] })
const storedProposal = (p: any) => ({ proposal: p.proposal, evidence: p.evidence, unresolved: p.unresolved, calendarCandidates: p.calendarCandidates, transfer: p.transfer })
// Review fold (plan omf-rakuten-shiwake-review-fold-20261020). GUARDS (independent review required): the exact reservation
// (`registration.op`) bounds every mark/release, so a late older operation never completes or releases a newer reservation;
// a completed registration's Transaction is read as present / missing / changed, and only present ones teach history; the
// stored identity (payee key, signed direction) follows the source on an untouched refresh and on an acknowledged change.
const NEWER = '登録の操作が新しくなりました。再読み込みしてください。 [registration-superseded-by-newer]'
// Plan omf-workflow-daily-20261025 Phase C (B1): the purchases linked to the account's rows come from the canonical payment projection
// (financePaymentMatchService bankPurchaseLinks), read once per request. GUARDS (independent review required): the optional explicit
// adoption (purchaseAdoption: eligibility of that convenience action only) and the adoption's current standing (purchaseAdoptionState:
// stale evidence is shown, never green). Neither is a condition of the existing manual registration; a failure to read the purchases is
// shown and never blocks the review or a registration.
const adoptionNow = purchaseAdoptionState;
const NO_PURCHASES = { links: [], otherLinks: [], state: 'unmatched', allocated: 0, remaining: null }
async function purchaseLinksOf(ownerId: string, account: any): Promise<Map<string, any> | null> {
  try { return await bankPurchaseLinks(ownerId, sid(account._id)) } catch (e: any) { console.error('[Finance] purchase links unavailable', e?.name || 'Error'); return null }
}
// The owner's selected Supplier of each draft that carries an adoption (one read): a Supplier with another stored number is never green.
async function adoptionSuppliers(drafts: any[]) {
  const ids = [...new Set(drafts.filter((d: any) => d?.adoption && /^[a-f\d]{24}$/i.test(String(d.values?.supplierId || ''))).map((d: any) => String(d.values.supplierId)))]
  if (!ids.length) return new Map<string, any>()
  return new Map<string, any>(((await Supplier.find({ _id: { $in: ids } } as any).select('_id invoiceNumber').lean()) as any[]).map((x: any) => [sid(x._id), x]))
}
const purchasesFor = (row: any, c: any) => !c.purchases ? null : c.purchases.get(sid(row._id)) || NO_PURCHASES
function purchasesView(row: any, c: any) {
  const p = purchasesFor(row, c)
  if (!p) return { available: false, payment: null, links: [], otherLinks: [], adoption: { eligible: false, reasons: ['purchase-evidence-unavailable'], candidate: null } }
  return { available: true, payment: { state: p.state, allocated: p.allocated, remaining: p.remaining }, links: p.links, otherLinks: p.otherLinks, adoption: purchaseAdoption({ row: { amount: row.amount, currency: row.currency }, purchases: p }) }
}
function adoptionStateOf(d: any, row: any, c: any) {
  if (d.adoption && row && !c.purchases) return { current: false, staleReasons: ['purchase-evidence-unavailable'] }
  return adoptionNow(d.adoption, { row, values: d.values, purchases: row ? purchasesFor(row, c) : null, supplier: (c.suppliers || new Map()).get(String(d.values?.supplierId || '')) || null })
}
// What a registration freezes (reservation and Transaction metadata): every linked purchase with its identities, revisions, file hashes,
// research and registry, the card settlement links, and the adoption with its standing at that moment. Never refreshed afterwards.
function frozenPurchases(d: any, row: any, c: any) {
  const p = purchasesFor(row, c), state = adoptionStateOf(d, row, c)
  const link = (l: any) => ({ allocationId: l.allocationId, paymentKey: l.paymentKey, anchorKey: l.anchorKey, amount: l.amount, currency: l.currency, kind: l.kind, changed: l.changed, sourceChanged: l.sourceChanged, recordId: l.record?.id ?? null, recordKey: l.record?.key ?? null, recordRevision: l.record?.revision ?? null, orderId: l.record?.orderId ?? '', itemId: l.record?.itemId ?? '', externalOrderId: l.record?.externalOrderId ?? '', purchaseDate: l.record?.purchaseDate ?? '', recordAmount: l.record?.amount ?? '', sourceHashes: (l.record?.sources || []).map((x: any) => x.hash), researchId: l.evidence?.research?.id ?? null, researchRevision: l.evidence?.research?.revision ?? null, supplierName: l.evidence?.supplierName ?? '', invoiceNumber: l.evidence?.invoiceNumber ?? '', evidenceOrigin: l.evidence?.origin ?? 'none', verified: !!l.evidence?.verified, registryBasis: l.evidence?.registryBasis ?? null, registry: l.evidence?.research?.registry ?? null })
  return { readAt: new Date(), available: !!p, links: p ? p.links.map(link) : null, settlementLinks: p ? p.otherLinks : null, adoption: d.adoption ? { ...d.adoption, status: state?.current ? 'current' : 'stale', staleReasons: state?.staleReasons || [] } : null, invoiceStatus: invoiceStatusOf(d.values, d.adoption, state) }
}
const LEDGER_INVOICE_STATUS: Record<string, string> = { 'verified-purchase': 'purchase-registry-verified', 'adopted-stale': 'entered-unverified', 'entered-unverified': 'entered-unverified', unverified: 'none' }
const adoptionView = (a: any, state: any) => a ? { at: a.at, allocationId: a.allocationId, recordId: a.recordId, recordRevision: a.recordRevision, researchId: a.researchId, researchRevision: a.researchRevision, invoiceNumber: a.invoiceNumber, supplierName: a.supplierName, purchaseDate: a.purchaseDate, orderId: a.orderId, itemId: a.itemId, externalOrderId: a.externalOrderId, registry: a.registry, current: !!state?.current, staleReasons: state?.staleReasons || [] } : null
const TEXT_KINDS = ['bank-fee', 'card-fee', 'interest']
const opOf = (reg: any) => reg?.op ? { 'registration.op': reg.op } : { 'registration.op': { $exists: false } }
const sameOp = (a: any, b: any) => !!a && !!b && String(a.op ?? '') === String(b.op ?? '')
const identityOf = (row: any) => ({ payeeKey: normalizePayee(row.description), direction: Number(row.amount) < 0 ? 'in' : 'out' })
const utcDay = (d: any) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10)
// The company Transaction of a completed registration: missing (deleted, or not in the draft's company), changed (another amount
// or direction; for a creation also another date or source link) or present. A reservation in progress has no target state yet.
function targetState(d: any, targets: Map<string, any>) {
  const reg = d?.registration; if (!reg || reg.state === 'reserved') return null
  const t = targets.get(sid(reg.transactionId)); if (!t || sid(t.organizationId) !== sid(d.organizationId)) return 'missing'
  const src = reg.source || d.source || {}
  if (Number(t.amount) !== Math.abs(Number(src.amount)) || t.type !== (Number(src.amount) < 0 ? '入金' : '支出')) return 'changed'
  if (reg.kind === 'create' && (t.metadata?.bankClassificationId !== sid(d._id) || utcDay(t.date) !== String(src.date ?? '').slice(0, 10))) return 'changed'
  return 'present'
}
async function targetsOf(organizationId: mongoose.Types.ObjectId, drafts: any[]) {
  const ids = [...new Set(drafts.filter((d: any) => d?.registration?.transactionId && d.registration.state !== 'reserved').map((d: any) => sid(d.registration.transactionId)))]
  if (!ids.length) return new Map<string, any>()
  const found: any[] = await Transaction.find({ _id: { $in: ids.map(x => new mongoose.Types.ObjectId(x)) }, organizationId } as any).select('_id organizationId amount type date metadata.bankClassificationId').lean()
  return new Map<string, any>(found.map((t: any) => [sid(t._id), t]))
}

async function context(ownerId: string, organizationId: mongoose.Types.ObjectId, bankAccountId: any) {
  await init()
  const account: any = await ownedBankAccount(ownerId, id(typeof bankAccountId === 'string' ? bankAccountId : ''))
  const [rows, drafts, calendarDocs, organization, chartDocs, historyDrafts, teachings]: any[] = await Promise.all([
    BankRow.find({ ownerId, bankAccountId: account._id }).sort({ date: 1, _id: 1 }).lean(),
    BankClassification.find({ ownerId, bankAccountId: account._id }).lean(),
    listCompanyCalendarEntries(organizationId),
    Organization.findOne({ _id: organizationId }).select('name').lean(),
    AccountCategory.find({ isActive: true }).select('name type').lean(),
    BankClassification.find({ organizationId, 'registration.state': { $in: ['registered', 'linked'] } }).select('organizationId payeeKey direction values source registration').lean(),
    BankTeaching.find({ organizationId }).lean()
  ])
  // Only a registration whose Transaction is still present and unchanged teaches history (missing/changed/released never do).
  const targets = await targetsOf(organizationId, [...drafts.filter((d: any) => sid(d.organizationId) === sid(organizationId)), ...historyDrafts])
  const usableHistory = historyDrafts.filter((d: any) => targetState(d, targets) === 'present')
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
  const proposed = proposeBankClassifications({ rows: active.map((r: any) => ({ id: sid(r._id), date: r.date, amount: r.amount, currency: r.currency, description: r.description })), calendar, history: usableHistory.map((d: any) => ({ payeeKey: d.payeeKey, direction: d.direction, values: d.registration?.values || d.values })), teachings: teachings.map((t: any) => ({ payeeKey: t.payeeKey, direction: t.direction, values: t.values })), companyNames: [organization?.name].filter(Boolean), chart, bankAccountName: bankName })
  const purchases = await purchaseLinksOf(ownerId, account)
  const suppliers = await adoptionSuppliers(drafts)
  return { account, rows, drafts, superseded, predecessorRegistered, chart, bankName, organizationId, organization, targets, purchases, suppliers, proposals: new Map<string, any>(proposed.rows.map((p: any) => [p.rowId, p])), notes: proposed.notes }
}
function draftView(d: any, row: any, c: any) {
  const reg = d.registration, proposed = d.proposed || {}, live = row ? c.proposals.get(sid(row._id)) : null
  const sourceChanged = !!row && (row.revision !== d.source?.revision || row.fingerprint !== d.source?.fingerprint), superseded = !!row && c.superseded.has(sid(row._id)), predecessorRegistered = !!row && c.predecessorRegistered.has(sid(row._id))
  const state = reg?.state === 'registered' ? 'registered' : reg?.state === 'linked' ? 'linked' : reg?.state === 'reserved' ? 'registering' : d.manual ? 'edited' : 'proposed'
  const account = c.chart.find((a: any) => a.id === d.values?.accountCategoryId), target = targetState(d, c.targets || new Map())
  const issue = target === 'missing' ? (reg.kind === 'link' ? 'link-missing' : 'transaction-missing') : target === 'changed' ? (reg.kind === 'link' ? 'link-changed' : 'transaction-changed') : null
  const adoption = adoptionStateOf(d, row, c)
  return {
    id: sid(d._id), revision: d.revision, state, manual: !!d.manual, values: d.values, payeeKey: d.payeeKey, proposed: proposed.proposal || null, evidence: proposed.evidence || [], unresolved: proposed.unresolved || [], calendarCandidates: proposed.calendarCandidates || [], transfer: proposed.transfer || null,
    tax: { status: d.values?.taxCategoryId ? 'owner-selected' : 'unknown' }, invoice: { value: d.values?.invoiceNumber || null, status: invoiceStatusOf(d.values, d.adoption, adoption) }, adoption: adoptionView(d.adoption, adoption),
    preview: journalPreview(d.direction, Math.abs(Number(d.source?.amount)), account?.name || null, c.bankName), source: d.source, sourceChanged, superseded, evidenceChanged: !!live && proposalHash(live) !== d.proposalHash,
    predecessorRegistered, ready: registrationReady({ values: d.values, transfer: proposed.transfer, sourceChanged, superseded, predecessorRegistered, currency: d.source?.currency }),
    registration: reg ? { state: reg.state, kind: reg.kind, transactionId: sid(reg.transactionId), at: reg.at || null, completedAt: reg.completedAt || null, target, purchaseLinks: reg.purchase?.links?.length ?? null, purchaseEvidence: reg.purchase?.adoption?.status ?? null } : null, issue,
    reservedTransactionId: sid(d.reservedTransactionId), history: (d.history || []).slice(-20)
  }
}
function rowView(row: any, c: any) {
  const rid = sid(row._id), d = c.drafts.find((x: any) => sid(x.bankRowId) === rid), superseded = c.superseded.has(rid), otherCompany = !!d && sid(d.organizationId) !== sid(c.organizationId)
  const draft = d && !otherCompany ? draftView(d, row, c) : null
  // F1: another company's draft of this owner row shows only its revision and whether it is registered (or registering): an
  // unregistered one can be moved here explicitly; its values, evidence and history are never shown to this company.
  const otherCompanyDraft = otherCompany && !superseded ? { revision: d.revision, registered: !!d.registration } : null
  return { rowId: rid, rowRevision: row.revision, key: row.key, date: row.date, amount: row.amount, direction: row.direction, currency: row.currency, description: row.description, state: superseded ? 'superseded' : otherCompany ? 'other-company' : draft ? draft.state : 'none', superseded, otherCompany, otherCompanyDraft, predecessorRegistered: c.predecessorRegistered.has(rid), proposal: superseded || otherCompany ? null : c.proposals.get(rid) || null, purchases: superseded || otherCompany ? null : purchasesView(row, c), draft }
}
function listOf(c: any) {
  const rows = c.rows.map((r: any) => rowView(r, c)), count = (s: string) => rows.filter((r: any) => r.state === s).length
  return {
    account: { id: sid(c.account._id), name: c.account.name, currency: c.account.currency }, company: { id: sid(c.organizationId), name: c.organization?.name || '' }, rows,
    counts: { rows: rows.length, drafts: rows.filter((r: any) => r.draft).length, none: count('none'), proposed: count('proposed'), edited: count('edited'), registering: count('registering'), registered: count('registered'), linked: count('linked'), otherCompany: count('other-company'), superseded: count('superseded'), issues: rows.filter((r: any) => r.draft?.issue).length, unresolved: rows.filter((r: any) => !['registered', 'linked', 'other-company', 'superseded'].includes(r.state) && ((r.draft?.unresolved || r.proposal?.unresolved || []).length > 0)).length },
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
    // Refreshes are bound to the company and revision read here, so a late refresh never writes into a draft another company took over.
    if (d.manual) { if (d.proposalHash !== hash) { await BankClassification.updateOne({ _id: d._id, organizationId: d.organizationId, revision: d.revision, registration: null }, { $set: { proposed: stored, proposalHash: hash } }); refreshed++ } else kept++; continue }
    if (d.proposalHash === hash && d.source?.revision === row.revision && d.source?.fingerprint === row.fingerprint) { kept++; continue }
    // an untouched draft follows its source: values, snapshot and the identity (payee key, signed direction) used by teaching/history/preview
    const saved = await BankClassification.updateOne({ _id: d._id, organizationId: d.organizationId, revision: d.revision, manual: false, registration: null }, { $set: { proposed: stored, proposalHash: hash, values: p.values, source: sourceOf(row), payeeKey: p.payeeKey, direction: p.direction }, $inc: { revision: 1 }, $push: { history: { at: now, by: ownerId, action: 'refreshed', revision: d.revision + 1 } } })
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
  if (body.adoptPurchase !== undefined) return adoptPurchase(ownerId, organizationId, draft, body)
  let values: any; try { values = classificationValues(body.values ?? {}, draft.values) } catch (e: any) { fail(400, e.message) }
  await assertReferences(values)
  const row: any = await BankRow.findOne({ _id: draft.bankRowId, ownerId }).lean(); if (!row) fail(409, '元の明細が見つかりません。')
  const sourceChanged = row.revision !== draft.source?.revision || row.fingerprint !== draft.source?.fingerprint
  if (sourceChanged && body.acceptSource !== true) fail(409, '元の明細が変更されました。変更後の内容を確認して「元の明細の変更を確認」を選んでください。')
  // An acknowledged source change also moves the stored identity (payee key, signed direction) to the acknowledged source.
  const set: any = { values, manual: true }
  // Phase C (B1): a hand-changed T number or Supplier ends the adoption (kept in this history entry); other edits keep it, and its
  // standing is derived on every read.
  const clearAdoption = !!draft.adoption && (String(values.invoiceNumber || '') !== String(draft.adoption.invoiceNumber || '') || String(values.supplierId || '') !== String(draft.adoption.supplierId || ''))
  if (clearAdoption) set.adoption = null
  if (sourceChanged) {
    set.source = sourceOf(row)
    Object.assign(set, identityOf(row))
  }
  const saved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, registration: null }, { $set: set, $inc: { revision: 1 }, $push: { history: { at: new Date(), by: ownerId, action: 'edited', revision: draft.revision + 1, before: draft.values, after: values, ...(sourceChanged ? { sourceAccepted: { from: draft.source?.revision ?? null, to: row.revision, identity: { from: { payeeKey: draft.payeeKey, direction: draft.direction }, to: identityOf(row) } } } : {}), ...(clearAdoption ? { cleared: { reason: String(values.invoiceNumber || '') !== String(draft.adoption.invoiceNumber || '') ? 'invoice-number-changed' : 'supplier-changed', adoption: draft.adoption } } : {}) } } })
  if (!saved.modifiedCount) fail(409, STALE)
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: draft._id }).lean()) }
}
/**
 * Phase C (B1)「この購入の会社名・T番号を使う」: the owner's explicit adoption, at the draft's expected revision, of the one linked purchase
 * the server finds adoptable for this row now (purchaseAdoption). The client only names what it saw (allocation, record, record revision);
 * every value comes from the server's current evidence. The draft gets the evidenced T number (and a Supplier only when exactly one
 * already-stored Supplier has that number and legal name and the owner chose none); the evidence is stored as `adoption` with a history
 * event. No Transaction, tax or Supplier is written. Unavailable → 409 with the reasons; the manual edit/registration stays as before.
 */
async function adoptPurchase(ownerId: string, organizationId: mongoose.Types.ObjectId, draft: any, body: any) {
  const ask = body.adoptPurchase
  if (!ask || typeof ask !== 'object' || typeof ask.allocationId !== 'string' || typeof ask.recordId !== 'string' || !Number.isSafeInteger(ask.recordRevision) || body.values !== undefined || body.acceptSource !== undefined) fail(400, '購入の根拠の採用内容を確認してください。')
  const c = await context(ownerId, organizationId, sid(draft.bankAccountId)), row = c.rows.find((r: any) => sid(r._id) === sid(draft.bankRowId))
  if (!row || c.superseded.has(sid(row._id))) fail(409, '元の明細が見つからないか訂正済みです。 [purchase-adoption-unavailable:source]')
  if (row.revision !== draft.source?.revision || row.fingerprint !== draft.source?.fingerprint) fail(409, '元の明細が変更されました。「元の明細の変更を確認」して保存してから使ってください。 [purchase-adoption-unavailable:source-changed]')
  const result = purchaseAdoption({ row: { amount: row.amount, currency: row.currency }, purchases: purchasesFor(row, c) || { links: [], otherLinks: [] } })
  const reasons: string[] = c.purchases ? result.reasons : ['purchase-evidence-unavailable']
  if (!c.purchases || !result.eligible) fail(409, 'この明細では購入の会社名・T番号を使えません: ' + reasons.map((r: string) => (PURCHASE_ADOPTION_LABELS as any)[r] || r).join('・') + ' [purchase-adoption-unavailable:' + reasons.join(',') + ']')
  const cand: any = result.candidate
  if (cand.allocationId !== ask.allocationId || cand.recordId !== ask.recordId || cand.recordRevision !== ask.recordRevision) fail(409, '購入の根拠が変わりました。再読み込みしてください。 [purchase-adoption-unavailable:stale]')
  let supplierId = String(draft.values?.supplierId || '')
  if (!supplierId) {
    const found: any[] = await Supplier.find({ invoiceNumber: cand.invoiceNumber } as any).select('_id name companyName').limit(10).lean()
    const exact = found.filter((x: any) => [x.companyName, x.name].some((n: any) => n && normalizeMerchant(n) === normalizeMerchant(cand.supplierName)))
    if (exact.length === 1) supplierId = sid(exact[0]._id)
  }
  const now = new Date(), values = { ...draft.values, invoiceNumber: cand.invoiceNumber, supplierId }
  const adoption = { ...cand, at: now, by: ownerId, supplierId, bankRowId: sid(row._id), bankRowRevision: row.revision, bankRowFingerprint: row.fingerprint, revision: draft.revision + 1 }
  const saved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, registration: null }, { $set: { values, manual: true, adoption }, $inc: { revision: 1 }, $push: { history: { at: now, by: ownerId, action: 'purchase-adopted', revision: draft.revision + 1, before: draft.values, after: values, adoption } } })
  if (!saved.modifiedCount) fail(409, STALE)
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: draft._id }).lean()) }
}
/** Explicit reusable teaching from an approved exact payee decision (an edited or registered draft) of this company. */
export async function rememberBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string, body: any) {
  await init(); const current: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!current) fail(404, NOT_FOUND)
  if (!Number.isSafeInteger(body?.revision) || Number(body.revision) !== current.revision) fail(409, STALE)
  const ownTransfer = body?.kind === 'own-transfer', v = current.values || {}
  if (!current.payeeKey) fail(400, '支払先を特定できないため記憶できません。')
  // F4: remembering a payee as the company's own account is itself the owner's explicit choice (also for a holder the proposer did
  // not detect); it stores no account, so later rows stay transfers awaiting review. Fee / interest text is never an own account.
  if (ownTransfer && TEXT_KINDS.includes(String(current.proposed?.proposal?.purposeKind || ''))) fail(400, '手数料・カード会費・利息の明細は自社口座として記憶できません。')
  if (!ownTransfer && !current.manual && !current.registration) fail(400, '確認・修正した仕訳だけを記憶できます。')
  if (!ownTransfer && (!String(v.purpose || '').trim() || !/^[a-f\d]{24}$/i.test(String(v.accountCategoryId || '')))) fail(400, '用途と勘定科目を確認してから記憶してください。')
  // An owner-entered own-account rule is correctable after an ordinary purpose/account review; automatic company-name
  // evidence still requires the own-transfer decision. This widens the existing remember exit, with no Transaction write.
  if (!ownTransfer && current.proposed?.transfer && current.proposed?.proposal?.origin !== 'teaching') fail(400, '自社名の振込は資金移動として記憶してください。')
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
function transactionPayload(d: any, row: any, v: any, op: string, frozen: any) {
  const ref = (key: string) => v[key] ? { [key]: v[key] } : {}
  return {
    referenceNumber: 'BANK-' + sid(d._id), date: new Date(row.date + 'T00:00:00.000Z'), amount: Math.abs(Number(row.amount)), type: Number(row.amount) < 0 ? '入金' : '支出', status: 'completed',
    ...ref('accountCategoryId'), ...ref('subAccountCategoryId'), ...ref('taxCategoryId'), ...ref('supplierId'), ...(v.taxRate !== null && v.taxRate !== undefined ? { taxRate: v.taxRate } : {}), ...(v.invoiceNumber ? { invoiceNumber: v.invoiceNumber } : {}),
    paymentMethod: '銀行口座', hasReceipt: false, notes: v.notes || row.description, items: [], attachments: [], tags: ['bank'],
    metadata: { bankClassificationId: sid(d._id), bankAccountId: sid(d.bankAccountId), bankRowId: sid(row._id), bankRowKey: row.key, bankRowRevision: row.revision, sourceFingerprint: row.fingerprint, sourceHashes: [...new Set((row.provenance || []).map((p: any) => p?.hash).filter(Boolean))], bankDescription: row.description, purpose: v.purpose, evidence: (d.proposed?.evidence || []).map((e: any) => String(e?.label || '')).slice(0, 10), unresolvedAtRegistration: d.proposed?.unresolved || [], taxStatus: v.taxCategoryId ? 'owner-selected' : 'unknown', invoiceNumberStatus: LEDGER_INVOICE_STATUS[frozen.invoiceStatus] || (v.invoiceNumber ? 'entered-unverified' : 'none'), purchaseLinks: frozen.links, settlementLinks: frozen.settlementLinks, purchaseEvidence: frozen.adoption, purchaseEvidenceAvailable: frozen.available, classificationVersion: BANK_CLASSIFICATION_VERSION, registrationOp: op },
    timeline: [{ type: 'bank-classification', title: '銀行明細から登録', timestamp: new Date(), description: row.date + ' ' + String(row.description ?? '').slice(0, 120) }]
  }
}
// The automatic release of a reservation that cannot complete; only that exact reservation (op), never a newer one.
async function release(d: any, reg: any, reason: string) {
  const releaseScope = opOf(reg)
  await BankClassification.updateOne({ _id: d._id, 'registration.state': 'reserved', ...releaseScope }, { $set: { registration: null }, $inc: { revision: 1 }, $push: { history: { at: new Date(), action: 'registration-released', reason, transactionId: reg.transactionId, op: reg.op ?? null } } })
}
// The one effect of a reserved registration: an upsert keyed on the reserved ID, the company and this draft. A record already at
// that ID for another company or source is never touched (the reservation is released and the request refused). An operation
// whose reservation was released or replaced meanwhile inserts nothing (the remaining window is documented in the docs).
async function insertTransaction(d: any, reg: any) {
  const current: any = await BankClassification.findOne({ _id: d._id }).select('registration').lean()
  if (!sameOp(current?.registration, reg)) fail(409, NEWER)
  if (current.registration.state !== 'reserved') return
  const now = new Date(), doc: any = new Transaction({ ...reg.payload, _id: reg.transactionId, createdAt: now, updatedAt: now, __v: 0 })
  doc.set('organizationId', d.organizationId, { strict: false })
  await doc.validate()
  const filter: any = { _id: reg.transactionId, organizationId: d.organizationId, 'metadata.bankClassificationId': sid(d._id) }
  try { await Transaction.collection.updateOne(filter, { $setOnInsert: doc.toObject({ virtuals: false }) }, { upsert: true }) }
  catch (e: any) { if (e?.code !== 11000) throw e; if (!await Transaction.collection.findOne(filter)) { await release(d, reg, 'reserved-id-conflict'); fail(409, '予約済みの取引IDに別の記録があるため登録できません。') } }
}
async function resumeRegistration(ownerId: string, organizationId: mongoose.Types.ObjectId, d: any, body: any, replayed: boolean) {
  const reg = d.registration
  if (body.action !== reg.kind) fail(409, 'この明細は別の操作（' + (reg.kind === 'link' ? '紐付け' : '新規登録') + '）で登録済みです。')
  if (reg.kind === 'link' && body.transactionId !== undefined && String(body.transactionId) !== sid(reg.transactionId)) fail(409, 'この明細は別の取引に紐付け済みです。')
  if (reg.state === 'reserved') {
    if (reg.kind === 'create') await insertTransaction(d, reg)
    else if (!await Transaction.exists({ _id: reg.transactionId, organizationId: d.organizationId } as any)) { await release(d, reg, 'linked-transaction-missing'); fail(409, '紐付ける取引が見つかりません。') }
    // completes exactly this reservation: a late older operation never marks a newer reservation
    const markScope = opOf(reg)
    const marked = await BankClassification.updateOne({ _id: d._id, organizationId: d.organizationId, 'registration.state': 'reserved', ...markScope }, { $set: { 'registration.state': reg.kind === 'link' ? 'linked' : 'registered', 'registration.completedAt': new Date() }, $push: { history: { at: new Date(), by: ownerId, action: reg.kind === 'link' ? 'linked' : 'registered', transactionId: reg.transactionId, op: reg.op ?? null } } })
    if (!marked.modifiedCount) { const now: any = await BankClassification.findOne({ _id: d._id }).select('registration').lean(); if (!sameOp(now?.registration, reg) || now.registration.state === 'reserved') fail(409, NEWER) }
  }
  const tx: any = await Transaction.findOne({ _id: reg.transactionId, organizationId: d.organizationId } as any).lean()
  if (!tx) fail(409, reg.kind === 'link' ? '紐付けた取引が見つかりません。「紐付けを解除」してから、もう一度確認してください。 [linked-transaction-missing]' : '登録した取引が見つかりません。「登録を解除」すると、同じ取引IDでもう一度登録できます。 [registered-transaction-missing]')
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
  // `op` names this reservation; the Transaction ID stays the draft's one durable reserved ID (or the chosen link target).
  const op = new mongoose.Types.ObjectId().toHexString()
  // Phase C (B1): the purchase evidence is frozen into the reservation (and the Transaction payload) once; a retry resumes these bytes.
  const frozen = frozenPurchases(draft, row, c)
  const at = new Date(), registration = { state: 'reserved', kind: action, op, transactionId: target, at, by: ownerId, values: draft.values, source: sourceOf(row), purchase: frozen, ...(action === 'create' ? { payload: transactionPayload(draft, row, draft.values, op, frozen) } : {}) }
  let reserved: any
  try { reserved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, registration: null }, { $set: { registration }, $inc: { revision: 1 }, $push: { history: { at, by: ownerId, action: action === 'link' ? 'link-reserved' : 'registration-reserved', revision: draft.revision + 1, transactionId: target, op } } }) }
  catch (e: any) { if (e?.code === 11000) fail(409, 'この取引は別の明細に紐付け済みです。'); throw e }
  const now: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean()
  if (!reserved.modifiedCount && !now?.registration) fail(409, STALE)
  return resumeRegistration(ownerId, organizationId, now, body, !reserved.modifiedCount)
}
/**
 * F1「この会社で仕訳する」: the owner moves another company's UNREGISTERED draft of their own bank row to the selected company
 * (fresh membership checked by the route). Explicit (`confirm`), at the other draft's current revision, in one compare-and-set
 * on that revision, company and `registration: null`: a registered or registering draft stays exclusive. The earlier company's
 * values, proposal, source and history are archived on the draft (company-bound, never returned); the draft restarts from the
 * selected company's own evidence. The unique owner+row draft and its durable reserved Transaction ID are kept.
 */
export async function reassignBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, body: any) {
  await init()
  if (body?.confirm !== true) fail(400, '「この会社で仕訳する」の確認操作を確認してください。')
  if (!Number.isSafeInteger(body?.revision)) fail(400, '仕訳のリビジョンを確認してください。')
  const c = await context(ownerId, organizationId, body?.bankAccountId), rid = String(body?.rowId ?? '')
  const row = c.rows.find((r: any) => sid(r._id) === rid); if (!row) fail(404, '明細が見つかりません。')
  const d = c.drafts.find((x: any) => sid(x.bankRowId) === rid); if (!d) fail(404, NOT_FOUND)
  if (sid(d.organizationId) === sid(organizationId)) fail(409, 'この明細はすでにこの会社で仕訳中です。')
  const exclusive = !!d.registration
  if (exclusive) fail(409, '別の会社で登録済み（または登録中）の明細はこの会社に移せません。 [registration-exclusive]')
  if (c.superseded.has(rid)) fail(409, '訂正済みの明細はこの会社に移せません。')
  if (Number(body.revision) !== d.revision) fail(409, STALE)
  const p = c.proposals.get(rid); if (!p) fail(409, STALE)
  const fresh = { values: p.values, proposed: storedProposal(p), proposalHash: proposalHash(p) }, at = new Date()
  const archived = { at, by: ownerId, action: 'company-reassigned-out', organizationId: d.organizationId, toOrganizationId: organizationId, revision: d.revision, manual: !!d.manual, values: d.values, proposed: d.proposed, proposalHash: d.proposalHash, payeeKey: d.payeeKey, direction: d.direction, source: d.source, adoption: d.adoption ?? null, history: d.history || [], version: d.version || null }
  const claimFilter = { _id: d._id, ownerId, organizationId: d.organizationId, revision: d.revision, registration: null }
  const claimed = await BankClassification.updateOne(claimFilter, { $set: { organizationId, values: fresh.values, proposed: fresh.proposed, proposalHash: fresh.proposalHash, payeeKey: p.payeeKey, direction: p.direction, source: sourceOf(row), manual: false, adoption: null, version: BANK_CLASSIFICATION_VERSION, history: [{ at, by: ownerId, action: 'company-reassigned', revision: d.revision + 1 }] }, $inc: { revision: 1 }, $push: { archive: archived } })
  if (!claimed.modifiedCount) fail(409, STALE)
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: d._id }).lean()) }
}
/**
 * F2「登録を解除」/「紐付けを解除」: the owner's explicit, revisioned release of a completed registration, bound to its exact
 * reservation and Transaction. A link is released whether or not the linked Transaction still exists, and that Transaction is
 * never changed. A created registration is released only when its Transaction is gone (a present one is corrected or deleted on
 * the native Transaction page; this never deletes or rewrites a Transaction); the draft keeps its durable reserved ID, so a
 * later registration recreates that same single Transaction. A reservation in progress is resumed, not released. The released
 * registration is kept in the draft history and no longer counts as history for proposals.
 */
export async function releaseBankClassification(ownerId: string, organizationId: mongoose.Types.ObjectId, draftId: string, body: any) {
  await init()
  if (body?.confirm !== true) fail(400, '「登録を解除」の確認操作を確認してください。')
  const draft: any = await BankClassification.findOne(scopeOfDraft(ownerId, organizationId, draftId)).lean(); if (!draft) fail(404, NOT_FOUND)
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) !== draft.revision) fail(409, STALE)
  const reg = draft.registration
  if (!reg) fail(409, 'この明細は登録・紐付けされていません。')
  if (reg.state === 'reserved') fail(409, '登録処理中です。「登録処理を再開」で完了してください。 [registration-reserved]')
  if (String(body.transactionId ?? '') !== sid(reg.transactionId)) fail(409, 'この明細の登録先が変わりました。再読み込みしてください。')
  const present = !!await Transaction.exists({ _id: reg.transactionId, organizationId: draft.organizationId } as any)
  if (reg.kind === 'create' && present) fail(409, '登録した取引がまだあります。取引ページで修正するか削除してから、登録を解除してください（ここでは取引を変更・削除しません）。 [registered-transaction-present]')
  const at = new Date(), action = reg.kind === 'link' ? 'link-released' : 'registration-released', ownerReleaseScope = opOf(reg)
  const released = { kind: reg.kind, state: reg.state, op: reg.op ?? null, at: reg.at ?? null, completedAt: reg.completedAt ?? null, values: reg.values, source: reg.source, purchase: reg.purchase ?? null }
  const saved = await BankClassification.updateOne({ _id: draft._id, ownerId, organizationId, revision: draft.revision, 'registration.state': reg.state, 'registration.transactionId': reg.transactionId, ...ownerReleaseScope }, { $set: { registration: null }, $inc: { revision: 1 }, $push: { history: { at, by: ownerId, action, reason: present ? 'owner-unlink' : reg.kind === 'link' ? 'link-missing' : 'transaction-missing', revision: draft.revision + 1, transactionId: reg.transactionId, released } } })
  if (!saved.modifiedCount) fail(409, STALE)
  return { row: await viewOne(ownerId, organizationId, await BankClassification.findOne({ _id: draft._id }).lean()) }
}

import { createHash } from 'node:crypto'
import type { Model } from 'mongoose'
import { FinanceActionOperation as Operation } from '../models/FinanceActionOperation'
import { FinanceChat as Chat } from '../models/FinanceChat'
import { FinanceAssistant as Conversation } from '../models/FinanceAssistant'
import { FinanceDraft } from '../models/FinanceDraft'
import { FinanceDecisionMemory } from '../models/FinanceDecisionMemory'
import { FinanceResearch as Research } from '../models/FinanceResearch'
import { FinancialAccount, FinanceImport, FinanceEntry } from '../models/Finance'
import { fail, id, ownedImport, reviewMapping, commitImport } from './financeService'
import { readDraft, saveDraft, draftReferences, rememberDraftFields, type DraftOperation } from './financeDraftService'
import { saveMemoryStatus } from './financeLearningService'
import { researchView, applyResearch, startChatResearch, chatRequestId } from './financeResearchService'
import { applyChatProposal } from './financeChatService'
import { intakeActions, intakeActionArgs } from './financeIntakeActionService'
import { canonicalJson, type ProposalReference } from '../../shared/finance-action-proposal.mjs'
import { fields as draftFields, learnedFields, validateValues } from '../../shared/finance-draft.mjs'

// Navi's named actions. The model receives this catalogue as MCP tools and nothing else: no HTTP, database, shell or token.
// Every call arrives on the worker route with the claimed conversation's lease and a slot number; the server re-reads the
// conversation lease, the agent's capability and account scope and the owned target at execution, resolves the target from the
// conversation (a purchase chat acts on its own purchase; a workspace turn on its frozen statement or an explicitly named owned
// purchase) and runs the SAME domain operations the UI uses. Reads are always fresh. Writes go through the durable journal
// (see journaled): one effect per slot, a stable operationId across an HTTP retry or a worker reclaim, the domain marker as the
// truth when a crash leaves the journal behind, never a blind repeat.
type Mode = 'workspace' | 'purchase'
type Scope = { agent: any, kind: Mode, ownerId: string, conversationId: string, turnId: string, conversation: any, turn: any }
type Target = { importId: string, line?: number, accountId: string } | null
type Outcome = { state?: 'done' | 'unresolved', outcome?: string, receipt: { requestedFields: string[], acceptedRevision: number | null, nativeResourceIds: any }, recoveryOwner?: string | null, result?: any }
type Definition = { name: string, effect: 'read' | 'write' | 'queue', modes: Mode[], targeted: boolean, needsLine: boolean, description: string, inputSchema: any, run: (scope: Scope, args: any, target: Target, operation: DraftOperation | null) => Promise<any> }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const objectId = { type: 'string', pattern: '^[a-f0-9]{24}$' }
const targetProps = { importId: { ...objectId, description: 'Statement (import) id. In a purchase conversation omit it: the conversation purchase is the target.' }, line: { type: 'integer', minimum: 2, description: 'Statement line of the purchase. In a purchase conversation omit it.' } }
const schema = (properties: any, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
const editableFieldKeys = draftFields.filter((f: any) => !['items', 'tags', 'date', 'status', 'sourceId', 'referenceNumber'].includes(f.key)).map((f: any) => f.key)
const pick = (values: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, values?.[k]]))
const draftSummary = (d: any) => ({ importId: d.importId, line: d.line, revision: d.revision, key: d.key, sourceHash: d.sourceHash, approvedAt: d.approvedAt || null, locked: d.locked, cardAccountingChanged: d.cardAccountingChanged, missing: d.missing, values: d.values, evidence: Object.fromEntries(Object.entries(d.evidence || {}).map(([k, v]: any) => [k, { state: v?.state, source: v?.source, reason: typeof v?.reason === 'string' ? v.reason.slice(0, 300) : '' }])), rememberedFields: d.rememberedFields, source: { description: d.source.description, purchaseDate: d.source.purchaseDate, amount: d.source.amount, currency: 'JPY', kind: d.source.kind, account: d.source.account }, suggestions: (d.suggestions || []).map((s: any) => ({ field: s.field, value: s.value, source: s.evidence?.source })), research: null })
const bounded = (rows: any[], max: number) => rows.slice(0, max)

export const actionCatalogue: Definition[] = [
  { name: 'list_accounts', effect: 'read', modes: ['workspace', 'purchase'], targeted: false, needsLine: false, description: 'List the card accounts this conversation may act on (name, provider, primary card).', inputSchema: schema({}),
    async run(scope) { const accounts: any[] = await FinancialAccount.find({ ownerId: scope.ownerId, _id: { $in: scope.agent.accountIds }, active: true }).select('name provider primaryCard').sort({ name: 1 }).lean(); return { accounts: accounts.map(a => ({ id: String(a._id), name: a.name, provider: a.provider || 'amex', primaryCard: a.primaryCard || '' })) } } },
  { name: 'list_imports', effect: 'read', modes: ['workspace', 'purchase'], targeted: false, needsLine: false, description: 'List recent statements (imports) of the accounts this conversation may act on; optionally one account.', inputSchema: schema({ accountId: objectId }),
    async run(scope, args) { const filter: any = { ownerId: scope.ownerId, accountId: { $in: scope.agent.accountIds } }; if (args.accountId) { if (!scope.agent.accountIds.some((a: any) => String(a) === args.accountId)) fail(404, 'Account not found'); filter.accountId = id(args.accountId) } const imports: any[] = await FinanceImport.find(filter).select('accountId period createdAt provider').sort({ createdAt: -1 }).limit(20).lean(); return { imports: imports.map(b => ({ id: String(b._id), accountId: String(b.accountId), period: b.period, provider: b.provider || 'amex', createdAt: b.createdAt })) } } },
  { name: 'get_mapping', effect: 'read', modes: ['workspace', 'purchase'], targeted: true, needsLine: false, description: 'Read the statement mapping: each purchase line with its classification, preparation state and missing fields.', inputSchema: schema({ importId: targetProps.importId }),
    async run(scope, _args, target) { const batch = await reviewMapping(scope.ownerId, target!.importId); return { id: batch.id, account: batch.account, period: batch.period, rows: bounded(batch.rows.map((r: any) => ({ line: r.line, kind: r.kind, description: r.description, purchaseDate: r.purchaseDate, amount: r.amount, purpose: r.purpose, clientCode: r.clientCode, category: r.category, state: r.preparation?.label || r.status || '', missing: (r.preparation?.missing || []).map((m: any) => m.label), invoiceNumberMissing: r.preparation ? !r.preparation.invoice?.number : null, taxRateMissing: r.preparation ? r.preparation.tax?.rate === null : null, draft: r.draft || null })), 500) } } },
  { name: 'get_draft', effect: 'read', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Read the current draft of one purchase: values, revision, approval, missing required fields, evidence states and remembered fields. Always the current state.', inputSchema: schema(targetProps),
    async run(scope, _args, target) { return draftSummary(await readDraft(scope.ownerId, target!.importId, target!.line!)) } },
  { name: 'get_registered_choices', effect: 'read', modes: ['workspace', 'purchase'], targeted: false, needsLine: false, description: 'List the registered choices for reference fields (customers, suppliers, account categories with their parent, transaction categories, tax categories with rates). Optionally one field.', inputSchema: schema({ field: { type: 'string', enum: draftFields.filter((f: any) => f.ref).map((f: any) => f.key) } }),
    async run(_scope, args) { const references: any = await draftReferences(); const wanted: string[] = args.field ? [String(draftFields.find((f: any) => f.key === args.field)!.ref)] : ['customers', 'suppliers', 'accountCategories', 'transactionCategories', 'taxCategories', 'sources']; return Object.fromEntries(wanted.map(ref => [ref, bounded((references[ref] || []).map((r: any) => ({ id: String(r._id), name: r.name, ...(r.parentId ? { parentId: String(r.parentId) } : {}), ...(r.rate !== undefined ? { rate: r.rate } : {}), ...(r.invoiceNumber ? { invoiceNumber: r.invoiceNumber } : {}) })), 300)])) } },
  { name: 'get_research', effect: 'read', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Read the current research of one purchase: state, summary, question, findings (proposals, not saved values), supplier candidate and its reference. A stale research belongs to an earlier draft state.', inputSchema: schema(targetProps),
    async run(scope, _args, target) { const view = await researchView(scope.ownerId, target!.importId, target!.line!); const r = view.research; return { stale: view.stale, connected: view.connected, research: r ? { id: r.id, state: r.state, revision: r.revision, instruction: r.instruction, summary: r.report?.summary || '', question: r.report?.question || '', findings: (r.report?.findings || []).map((f: any) => ({ field: f.field, value: f.value, basis: f.basis, reason: String(f.reason || '').slice(0, 600) })), supplier: r.report?.supplier ? { shopName: r.report.supplier.shopName, legalName: r.report.supplier.legalName, invoiceNumber: r.report.supplier.invoiceNumber } : null, registry: r.registry ? { status: r.registry.active ? 'active_at_check' : 'not_active', asOf: r.registry.asOf } : null, applied: r.applied || null, reference: r.reference } : null } } },
  { name: 'get_action_status', effect: 'read', modes: ['workspace', 'purchase'], targeted: false, needsLine: false, description: 'Read the durable journal of this conversation\'s actions: every operation with its state (working, done, failed, unresolved), accepted revision and recovery owner. Optionally one operationId.', inputSchema: schema({ operationId: { type: 'string', pattern: '^[a-f0-9]{32}$' } }),
    async run(scope, args) { return { receipts: await readReceipts(scope.kind, scope.conversationId, args.operationId ? { operationId: args.operationId } : { turnId: scope.turnId }) } } },
  { name: 'save_draft_fields', effect: 'write', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Save the given fields on one purchase draft (only the fields named; the rest keeps its current value). Explicit instruction only. Reference fields take registered ids. Returns the accepted draft revision.', inputSchema: schema({ ...targetProps, fields: { type: 'object', description: 'field key -> value', minProperties: 1 } }, ['fields']),
    async run(scope, args, target, operation) {
      const requested = Object.keys(args.fields || {})
      if (!requested.length || requested.some(k => !editableFieldKeys.includes(k))) fail(400, `保存できる項目: ${editableFieldKeys.join(', ')}`)
      const d = await readDraft(scope.ownerId, target!.importId, target!.line!)
      let values: any; try { values = validateValues({ ...d.values, ...args.fields }) } catch (error: any) { fail(400, error.message) }
      const saveBody = { revision: d.revision, key: d.key, sourceHash: d.sourceHash, values, remember: [], confirm: false }
      const { importId, line } = target!, ownerId = scope.ownerId
      const saved = await saveDraft(ownerId, importId, line!, saveBody, undefined, undefined, undefined, operation!)
      return { receipt: { requestedFields: requested, acceptedRevision: acceptedRevision(saved, operation!), nativeResourceIds: { importId, line } }, result: { revision: saved.revision, approvedAt: saved.approvedAt, values: pick(saved.values, requested), missing: saved.missing } }
    } },
  { name: 'apply_referenced_proposal', effect: 'write', modes: ['purchase'], targeted: true, needsLine: true, description: 'Apply the proposal the owner was looking at when sending this message (a chat proposal or a research report), exactly as displayed and stored by the server. Never values you reconstruct. With both kinds displayed, name kind. Optionally remember (chat proposal: customer/purpose for this account and merchant) or a subset of fields (research).', inputSchema: schema({ kind: { type: 'string', enum: ['chat', 'research'] }, remember: { type: 'boolean' }, fields: { type: 'array', items: { type: 'string' }, maxItems: 30 } }),
    async run(scope, args, target, operation) {
      const { importId, line } = target!, ownerId = scope.ownerId, kind = args.kind, turn = scope.turn
      const ref = pickReference(turn.references, kind)
      if (ref.kind === 'chat') {
        const applied = await applyChatProposal(ownerId, importId, line!, scope.conversation, ref as ProposalReference, args.remember === true, operation!)
        return { receipt: { requestedFields: applied.fields, acceptedRevision: applied.revision, nativeResourceIds: { importId, line, draftId: applied.draftId, chatTurnId: applied.turnId } }, result: { revision: applied.revision, fields: applied.fields, remembered: args.remember === true } }
      }
      const available = (ref.snapshot?.findings || []).map((f: any) => f.field), fields = args.fields || available
      if (!fields.length || new Set(fields).size !== fields.length || fields.some((f: string) => !available.includes(f))) fail(400, `反映できる項目: ${available.join(', ')}`)
      const result = await applyResearch(ownerId, importId, line!, { fields, confirm: true, researchRevision: ref.revision, revision: ref.draftRevision, key: ref.key, sourceHash: ref.sourceHash }, ref as ProposalReference)
      const entry = (result.draft.history || []).find((h: any) => h.channel === 'research' && h.reviewId === ref.id && typeof h.replyTs === 'string' && h.replyTs.startsWith(ref.requestId + ':'))
      return { receipt: { requestedFields: fields, acceptedRevision: entry?.revision ?? result.draft.revision, nativeResourceIds: { importId, line, researchId: ref.id, requestId: ref.requestId } }, result: { revision: result.draft.revision, values: pick(result.draft.values, fields) } }
    } },
  { name: 'remember_accounting_fields', effect: 'write', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Remember the named accounting fields (勘定科目/補助科目/区分/税区分/税率/仕入れ先/法人情報) with their current draft values for this account, merchant, purpose and customer, from this purchase date on. Independent of saving, approving or posting; an empty subsidiary is a value. Explicit instruction only.', inputSchema: schema({ ...targetProps, fields: { type: 'array', items: { type: 'string', enum: learnedFields }, minItems: 1, maxItems: learnedFields.length }, values: { type: 'object', description: 'optional explicit values for the named fields' } }, ['fields']),
    async run(scope, args, target, operation) {
      const d = await readDraft(scope.ownerId, target!.importId, target!.line!)
      const { memory } = await rememberDraftFields(scope.ownerId, target!.importId, target!.line!, { kind: 'accounting', fields: args.fields, values: args.values, binding: { revision: d.revision, key: d.key, sourceHash: d.sourceHash }, operation: operation!, provenance: provenance(scope) })
      return { receipt: { requestedFields: args.fields, acceptedRevision: null, nativeResourceIds: { memoryId: String(memory._id) } }, result: { memoryId: String(memory._id), status: memory.status, values: memory.values } }
    } },
  { name: 'remember_customer_purpose', effect: 'write', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Remember the customer/purpose decision (company, or customer with its registered customer id; default: the current draft decision) for this account and merchant from this purchase date on. The product is never remembered. Explicit instruction only.', inputSchema: schema({ ...targetProps, purpose: { type: 'string', enum: ['company', 'customer'] }, customerId: { type: 'string', pattern: '^([a-f0-9]{24})?$' } }),
    async run(scope, args, target, operation) {
      const d = await readDraft(scope.ownerId, target!.importId, target!.line!)
      const { memory } = await rememberDraftFields(scope.ownerId, target!.importId, target!.line!, { kind: 'classification', decision: { purpose: args.purpose, customerId: args.customerId }, binding: { revision: d.revision, key: d.key, sourceHash: d.sourceHash }, operation: operation!, provenance: provenance(scope) })
      return { receipt: { requestedFields: ['purpose', 'customerId'], acceptedRevision: null, nativeResourceIds: { memoryId: String(memory._id) } }, result: { memoryId: String(memory._id), status: memory.status, decision: memory.decision } }
    } },
  { name: 'set_memory_status', effect: 'write', modes: ['workspace', 'purchase'], targeted: false, needsLine: false, description: 'Pause or reactivate one remembered decision (a memoryId from a remember action or the learning page). Other memories are untouched.', inputSchema: schema({ memoryId: objectId, status: { type: 'string', enum: ['active', 'paused'] }, expectedRevision: { type: 'integer', minimum: 0 } }, ['memoryId', 'status']),
    async run(scope, args, _target, operation) {
      const current: any = await FinanceDecisionMemory.findOne({ _id: id(args.memoryId), ownerId: scope.ownerId }).select('revision').lean(); if (!current) fail(404, 'Memory not found')
      const result = await saveMemoryStatus(scope.ownerId, args.memoryId, { revision: args.expectedRevision ?? current.revision, status: args.status }, operation!)
      return { receipt: { requestedFields: ['status'], acceptedRevision: result.revision, nativeResourceIds: { memoryId: args.memoryId } }, result: { memoryId: args.memoryId, status: result.memory.status, revision: result.revision } }
    } },
  { name: 'approve_draft', effect: 'write', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Approve one purchase draft with its current values (requires every ledger-required field and the current card accounting). Explicit approval command only; approving does not post to the ledger.', inputSchema: schema(targetProps),
    async run(scope, _args, target, operation) {
      const d = await readDraft(scope.ownerId, target!.importId, target!.line!)
      const approvalBody = { revision: d.revision, key: d.key, sourceHash: d.sourceHash, values: d.values, remember: [], confirm: true, cardAccountingKey: d.cardAccounting?.key }
      const saved = await saveDraft(scope.ownerId, target!.importId, target!.line!, approvalBody, undefined, undefined, undefined, operation!)
      return { receipt: { requestedFields: [], acceptedRevision: acceptedRevision(saved, operation!), nativeResourceIds: { importId: target!.importId, line: target!.line } }, result: { revision: saved.revision, approvedAt: saved.approvedAt, missing: saved.missing } }
    } },
  { name: 'post_selected_approved_rows', effect: 'write', modes: ['workspace', 'purchase'], targeted: true, needsLine: false, description: 'Post the named approved rows of one statement to the ledger through the existing posting path, each at its approved draft revision. Explicit ledger-post command only. Rows already posted are reported as existing; an interrupted post resumes without a duplicate.', inputSchema: schema({ importId: targetProps.importId, lines: { type: 'array', items: { type: 'integer', minimum: 2 }, minItems: 1, maxItems: 200 } }, ['lines']),
    async run(scope, args, target) {
      const lines: number[] = [...new Set(args.lines as number[])]; if (lines.length !== args.lines.length) fail(400, '同じ行を重複して指定できません。')
      const batch = await ownedImport(scope.ownerId, target!.importId)
      const before: any[] = await FinanceEntry.find({ ownerId: scope.ownerId, importId: batch._id, line: { $in: lines } }).lean()
      const rows: any[] = [], decisions: any[] = []
      for (const line of lines) {
        const entry = before.find(e => e.line === line)
        if (entry?.state === 'posted') { rows.push({ line, outcome: 'existing', entryId: String(entry._id), transactionId: String(entry.transactionId) }); continue }
        const draft: any = await FinanceDraft.findOne({ ownerId: scope.ownerId, importId: batch._id, line }).select('revision approvedAt').lean()
        if (!draft?.approvedAt) fail(409, `${line}行目は承認済みの下書きがありません。先に内容を確認して承認してください。`)
        decisions.push({ line, action: 'import', draftRevision: draft.revision }); rows.push({ line, outcome: entry?.state === 'reserved' ? 'resumed' : 'posted', draftRevision: draft.revision })
      }
      if (decisions.length) await commitImport(scope.ownerId, String(batch._id), { decisions })
      const after: any[] = await FinanceEntry.find({ ownerId: scope.ownerId, importId: batch._id, line: { $in: lines } }).lean()
      for (const row of rows) { if (row.outcome === 'existing') continue; const entry = after.find(e => e.line === row.line); if (entry?.state === 'posted') { row.entryId = String(entry._id); row.transactionId = String(entry.transactionId) } else row.outcome = 'unresolved' }
      const unresolved = rows.some(r => r.outcome === 'unresolved')
      return { state: unresolved ? 'unresolved' : 'done', recoveryOwner: unresolved ? 'user' : null, receipt: { requestedFields: [], acceptedRevision: null, nativeResourceIds: { importId: String(batch._id), rows } }, result: { rows } }
    } },
  { name: 'start_purchase_research', effect: 'queue', modes: ['workspace', 'purchase'], targeted: true, needsLine: true, description: 'Start OMF\'s own research of one purchase (company identity, registration number, accounting candidates, tax percentage) with one instruction sentence. The receipt says queued; findings appear later as a new research reference and are proposals, never saved values.', inputSchema: schema({ ...targetProps, instruction: { type: 'string', minLength: 1, maxLength: 2000 } }, ['instruction']),
    async run(scope, args, target) {
      const d = await readDraft(scope.ownerId, target!.importId, target!.line!)
      const started = await startChatResearch(scope.ownerId, target!.importId, target!.line!, scope.conversationId, scope.turnId, String(args.instruction).trim(), { revision: d.revision, key: d.key, sourceHash: d.sourceHash })
      if ('unavailable' in started) fail(409, started.unavailable)
      return { outcome: 'queued', receipt: { requestedFields: [], acceptedRevision: null, nativeResourceIds: { importId: target!.importId, line: target!.line, requestId: started.requestId, researchId: started.researchId } }, result: { requestId: started.requestId, researchId: started.researchId, state: started.state, finished: false } }
    } }
  , ...intakeActions
]
const provenance = (scope: Scope) => ({ conversationKind: scope.kind, conversationId: scope.conversationId, turnId: scope.turnId, text: String(scope.turn?.text || '').slice(0, 500), summary: '' })
const acceptedRevision = (saved: any, operation: DraftOperation) => (saved.history || []).find((h: any) => h.operation && h.operation.operationId === operation.operationId)?.revision ?? saved.revision
function pickReference(references: any[] | undefined, kind?: string) {
  const stored = Array.isArray(references) ? references : [], candidates = kind ? stored.filter(r => r.kind === kind) : stored
  if (!candidates.length) fail(409, kind ? `このメッセージには ${kind === 'chat' ? '会話の提案' : '調査結果'} が結び付いていません。表示中の提案を指定して送信してください。` : '反映できる提案がこのメッセージに結び付いていません。表示中の提案を指定して送信してください。')
  if (candidates.length > 1) fail(400, '会話の提案と調査結果の両方が表示されていました。kind に chat か research を指定してください。')
  return candidates[0]
}
// The catalogue the MCP server lists to the model: name, description and input schema only.
export function actionTools(mode: Mode) { return actionCatalogue.filter(d => d.modes.includes(mode)).map(d => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })) }

// Minimal JSON-schema check of the model's arguments (types, enum, pattern, bounds, required, no unknown keys).
function validateArgs(definition: Definition, args: any) {
  const check = (value: any, s: any, where: string) => {
    if (s.type === 'object') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${where} must be an object`); if (s.additionalProperties === false) for (const k of Object.keys(value)) if (!s.properties?.[k]) fail(400, `Unknown argument ${where}.${k}`); for (const k of s.required || []) if (value[k] === undefined) fail(400, `Missing argument ${where}.${k}`); if (s.minProperties && Object.keys(value).length < s.minProperties) fail(400, `${where} is empty`); for (const [k, v] of Object.entries(value)) if (s.properties?.[k]) check(v, s.properties[k], `${where}.${k}`); return }
    if (s.type === 'array') { if (!Array.isArray(value)) fail(400, `${where} must be an array`); if (s.minItems && value.length < s.minItems) fail(400, `${where} is empty`); if (s.maxItems && value.length > s.maxItems) fail(400, `${where} is too long`); if (s.items) value.forEach((v: any, i: number) => check(v, s.items, `${where}[${i}]`)); return }
    if (s.type === 'integer') { if (!Number.isSafeInteger(value) || (s.minimum !== undefined && value < s.minimum)) fail(400, `${where} must be an integer${s.minimum !== undefined ? ' >= ' + s.minimum : ''}`); return }
    if (s.type === 'boolean') { if (typeof value !== 'boolean') fail(400, `${where} must be true or false`); return }
    if (s.type === 'string') { if (typeof value !== 'string' || (s.minLength && value.length < s.minLength) || (s.maxLength && value.length > s.maxLength) || (s.pattern && !new RegExp(s.pattern).test(value)) || (s.enum && !s.enum.includes(value)) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, `${where} is invalid${s.enum ? ' (one of ' + s.enum.join(', ') + ')' : ''}`); return }
  }
  check(args, definition.inputSchema, 'args')
}
// Target resolution: a purchase conversation acts on its own purchase only; a workspace turn on its frozen statement selection or an
// explicitly named statement/line. The import must be the owner's and on one of the agent's accounts (rechecked now, not at claim).
async function resolveTarget(scope: Scope, definition: Definition, args: any): Promise<Target> {
  if (!definition.targeted) return null
  let importId = args.importId, line = args.line
  if (scope.kind === 'purchase') {
    if ((importId !== undefined && importId !== String(scope.conversation.importId)) || (line !== undefined && line !== scope.conversation.line)) fail(400, 'この会話では、この購入だけを対象にできます。')
    importId = String(scope.conversation.importId); line = scope.conversation.line
  } else {
    if (importId === undefined) importId = scope.turn?.target?.importId
    if (!importId) fail(400, '対象の明細（importId）を指定してください。')
    if (definition.needsLine && line === undefined) fail(400, '対象の行（line）を指定してください。')
  }
  const batch = await ownedImport(scope.ownerId, importId)
  if (!scope.agent.accountIds.some((a: any) => String(a) === String(batch.accountId))) fail(404, 'Import not found')
  if (definition.needsLine && !batch.rows.some((r: any) => r.line === line)) fail(404, '明細が見つかりません。')
  return { importId, ...(definition.needsLine ? { line } : {}), accountId: String(batch.accountId) }
}

// Entry of the worker action route: the claimed conversation's lease and the agent's scope are re-read at execution.
export async function runAction(agent: any, kind: Mode, conversationId: string, body: any) {
  if (!body || typeof body !== 'object' || typeof body.lease !== 'string' || typeof body.name !== 'string') fail(400, 'Invalid action request')
  const definition = actionCatalogue.find(d => d.name === body.name && d.modes.includes(kind)); if (!definition) fail(400, 'Unknown action')
  let args = body.args === undefined ? {} : body.args
  validateArgs(definition, args)
  const lease = { lease: body.lease, leaseUntil: { $gt: new Date() } }
  const conversation: any = kind === 'purchase'
    ? await Chat.findOne({ _id: id(conversationId), ownerId: agent.ownerId, accountId: { $in: agent.accountIds }, agentId: agent._id, state: 'working', ...lease }).lean()
    : await Conversation.findOne({ _id: id(conversationId), ownerId: agent.ownerId, agentId: agent._id, state: 'working', ...lease }).lean()
  if (!conversation) fail(409, 'Conversation job changed')
  const turn = conversation.turns.find((t: any) => t.id === conversation.currentId)
  const scope: Scope = { agent, kind, ownerId: String(agent.ownerId), conversationId: String(conversation._id), turnId: conversation.currentId, conversation, turn }
  args = intakeActionArgs(definition.name, args, turn?.target)
  const target = await resolveTarget(scope, definition, args)
  if (definition.effect === 'read') return { name: definition.name, effect: 'read', result: await definition.run(scope, args, target, null) }
  return journaled(scope, definition, body, args, target)
}

// One effect per (conversation, turn, slot). The journal row is claimed by upsert before the domain write; its operationId is derived
// from that identity, so an HTTP retry or a reclaimed worker meets the same row. A row already settled returns its receipt. A row
// still claimed by this very lease is a concurrent identical call and waits for the first. A row claimed by an earlier, expired
// lease is reconciled from the domain marker (done or interrupted before the write), never re-executed. A different payload on the
// same slot is a different meaning and is refused.
async function journaled(scope: Scope, definition: Definition, body: any, args: any, target: Target) {
  if (!Number.isSafeInteger(body.slot) || body.slot < 1 || body.slot > 500) fail(400, 'Invalid action slot')
  const payloadHash = sha(canonicalJson({ name: definition.name, args }))
  const identity = { ownerId: scope.agent.ownerId, conversationKind: scope.kind, conversationId: scope.conversation._id, turnId: scope.turnId, slot: body.slot }
  const operationId = sha([scope.ownerId, scope.kind, scope.conversationId, scope.turnId, body.slot].join(':')).slice(0, 32)
  const now = new Date()
  const claimed: any = await Operation.findOneAndUpdate(identity, { $setOnInsert: { operationId, name: definition.name, payloadHash, args, target, state: 'claimed', agentId: scope.agent._id, lease: body.lease, leaseUntil: scope.conversation.leaseUntil, claimedAt: now, attempts: 1 } }, { upsert: true, new: true, includeResultMetadata: true })
  const op = claimed.value, inserted = !claimed.lastErrorObject?.updatedExisting
  if (!inserted) {
    if (op.payloadHash !== payloadHash) fail(409, '同じ操作番号が別の内容で再利用されました。新しい番号で指示してください。')
    if (op.state !== 'claimed') return respond(definition, op)
    if (op.lease === body.lease) { const settled = await waitSettled(op._id); return respond(definition, settled || op) }
    return respond(definition, (await recoverRows(scope.kind, scope.conversationId, [op]))[0])
  }
  try {
    const outcome: Outcome = await definition.run(scope, args, target, { operationId, name: definition.name })
    await Operation.updateOne({ _id: op._id, state: 'claimed' }, { $set: { state: outcome.state || 'done', receipt: { ...outcome.receipt, ...(outcome.outcome ? { outcome: outcome.outcome } : {}) }, completedAt: new Date(), recoveryOwner: outcome.recoveryOwner || null, safeError: null } })
    return respond(definition, await Operation.findById(op._id).lean(), outcome.result)
  } catch (error: any) {
    if (error?.statusCode) { await Operation.updateOne({ _id: op._id, state: 'claimed' }, { $set: { state: 'failed', safeError: String(error.data?.message || error.statusMessage || 'Action failed').slice(0, 500), recoveryOwner: error.statusCode === 400 ? 'model' : 'user', completedAt: new Date() } }); throw error }
    await Operation.updateOne({ _id: op._id, state: 'claimed' }, { $set: { state: 'unresolved', safeError: '処理が中断されました。結果の確認が必要です。', recoveryOwner: 'successor' } })
    throw error
  }
}
async function waitSettled(opId: any) { for (let i = 0; i < 75; i++) { await new Promise(r => setTimeout(r, 200)); const op: any = await Operation.findById(opId).lean(); if (!op || op.state !== 'claimed') return op } return null }
const respond = (definition: Definition, op: any, result?: any) => ({ name: definition.name, effect: definition.effect, receipt: receiptOf(op), ...(result !== undefined ? { result } : {}) })
export function receiptOf(op: any) {
  return { operationId: op.operationId, turnId: op.turnId, slot: op.slot, name: op.name, target: op.target || null, requestedFields: op.receipt?.requestedFields || [], state: op.state === 'claimed' ? 'working' : op.receipt?.outcome && op.state === 'done' ? op.receipt.outcome : op.state, nativeResourceIds: op.receipt?.nativeResourceIds || null, acceptedRevision: op.receipt?.acceptedRevision ?? null, completedAt: op.completedAt || null, recoveryOwner: op.recoveryOwner || null, safeError: op.safeError || null }
}
// The journal remains authoritative after a final reply, a timeout, and on earlier turns. Reads reconcile expired claims;
// they never repeat an effect. A still-owned, renewed job protects its in-flight calls even if their original lease is older.
export async function actionReceipts(kind: Mode, conversationId: string, turnId?: string) {
  return readReceipts(kind, conversationId, turnId === undefined ? {} : { turnId })
}
async function readReceipts(kind: Mode, conversationId: string, filter: any) {
  const rows = await Operation.find({ conversationKind: kind, conversationId: id(conversationId), ...filter }).sort({ slot: 1 }).lean()
  return (await recoverRows(kind, conversationId, rows)).map(receiptOf)
}
export async function conversationReceipts(kind: Mode, c: any) {
  if (!c) return c
  const receipts = await actionReceipts(kind, String(c._id))
  return { ...c, turns: c.turns.map((turn: any) => { const current = receipts.filter(r => r.turnId === turn.id); return current.length ? { ...turn, actions: current } : turn }) }
}
// Before a reclaimed job runs the model again: every operation the previous attempt left claimed is reconciled from its domain
// marker (a call still in flight within the grace window is left as working). Returns the receipts and the next free slot.
const GRACE_MS = 20000
export async function reconcileActions(kind: Mode, conversationId: string, turnId: string) {
  const rows: any[] = await Operation.find({ conversationKind: kind, conversationId: id(conversationId), turnId }).sort({ slot: 1 }).lean()
  const receipts = (await recoverRows(kind, conversationId, rows)).map(receiptOf)
  return { receipts, nextSlot: rows.reduce((max, op) => Math.max(max, op.slot), 0) + 1 }
}
async function recoverRows(kind: Mode, conversationId: string, rows: any[]) {
  const cutoff = Date.now() - GRACE_MS
  if (!rows.some(op => op.state === 'claimed' && op.leaseUntil && new Date(op.leaseUntil).getTime() < cutoff)) return rows
  const model: Model<any> = kind === 'purchase' ? Chat : Conversation
  const current: any = await model.findById(id(conversationId)).select('state currentId lease leaseUntil').lean()
  const out = []
  for (const op of rows) {
    const renewed = current?.state === 'working' && current.currentId === op.turnId && current.lease === op.lease ? new Date(current.leaseUntil).getTime() : 0
    const expires = Math.max(new Date(op.leaseUntil).getTime(), renewed)
    out.push(op.state === 'claimed' && expires < cutoff ? await reconcileOne(String(op.ownerId), op) : op)
  }
  return out
}
// The domain marker decides: a write that carries this operationId (or its own native marker) happened and is done with its
// recorded revision; no marker means the interruption came before the write (failed, the model may re-issue under a new slot);
// a partially posted ledger set is unresolved and belongs to the owner. Nothing is repeated here.
async function reconcileOne(ownerId: string, op: any) {
  const settle = async (state: 'done' | 'failed' | 'unresolved', receipt: any, recoveryOwner: string | null, safeError: string | null) => {
    await Operation.updateOne({ _id: op._id, state: 'claimed' }, { $set: { state, receipt: { ...(op.receipt || {}), ...receipt }, completedAt: new Date(), recoveryOwner, safeError } })
    return (await Operation.findById(op._id).lean()) || op
  }
  const interrupted = (fields: string[] = []) => settle('failed', { requestedFields: fields, acceptedRevision: null, nativeResourceIds: null }, 'model', '前回の処理は書き込み前に中断されました。必要なら新しい操作として指示してください。')
  const target = op.target || {}, args = op.args || {}
  if (['save_draft_fields', 'approve_draft'].includes(op.name)) {
    const draft: any = await FinanceDraft.findOne({ ownerId, importId: id(target.importId), line: target.line }).select('history').lean()
    const entry = draft?.history.find((h: any) => h.operation?.operationId === op.operationId)
    return entry ? settle('done', { requestedFields: Object.keys(args.fields || {}), acceptedRevision: entry.revision, nativeResourceIds: { importId: target.importId, line: target.line } }, null, null) : interrupted(Object.keys(args.fields || {}))
  }
  if (op.name === 'apply_referenced_proposal') {
    const conversation: any = await Chat.findById(op.conversationId).lean(), turn = conversation?.turns.find((t: any) => t.id === op.turnId)
    let ref: any = null; try { ref = pickReference(turn?.references, args.kind) } catch { return interrupted() }
    const draft: any = await FinanceDraft.findOne({ ownerId, importId: id(target.importId), line: target.line }).select('history _id').lean()
    const entry = draft?.history.find((h: any) => ref.kind === 'chat' ? (h.reviewId === String(op.conversationId) && h.replyTs === ref.turnId && h.channel === 'web') : (h.reviewId === ref.id && h.channel === 'research' && typeof h.replyTs === 'string' && h.replyTs.startsWith(ref.requestId + ':')))
    return entry ? settle('done', { requestedFields: entry.fields || [], acceptedRevision: entry.revision, nativeResourceIds: { importId: target.importId, line: target.line, draftId: String(draft._id), ...(ref.kind === 'chat' ? { chatTurnId: ref.turnId } : { researchId: ref.id, requestId: ref.requestId }) } }, null, null) : interrupted()
  }
  if (['remember_accounting_fields', 'remember_customer_purpose'].includes(op.name)) {
    const memory: any = await FinanceDecisionMemory.findOne({ operationId: op.operationId }).lean()
    return memory ? settle('done', { requestedFields: op.name === 'remember_accounting_fields' ? memory.fields : ['purpose', 'customerId'], acceptedRevision: null, nativeResourceIds: { memoryId: String(memory._id) } }, null, null) : interrupted(args.fields || [])
  }
  if (op.name === 'set_memory_status') {
    const memory: any = await FinanceDecisionMemory.findOne({ _id: id(args.memoryId), ownerId, 'audit.operationId': op.operationId }).lean()
    const recorded = memory?.audit.find((a: any) => a.operationId === op.operationId)
    return recorded ? settle('done', { requestedFields: ['status'], acceptedRevision: recorded.revision, nativeResourceIds: { memoryId: args.memoryId } }, null, null) : interrupted(['status'])
  }
  if (op.name === 'post_selected_approved_rows') {
    const entries: any[] = await FinanceEntry.find({ ownerId, importId: id(target.importId), line: { $in: args.lines || [] } }).lean()
    const rows = (args.lines || []).map((line: number) => { const e = entries.find(x => x.line === line); return { line, outcome: e?.state === 'posted' ? 'posted' : e ? 'unresolved' : 'not_started', ...(e ? { entryId: String(e._id), transactionId: String(e.transactionId) } : {}), attributed: false } })
    if (rows.every((r: any) => r.outcome === 'not_started')) return interrupted()
    const unresolved = rows.some((r: any) => r.outcome !== 'posted')
    return settle(unresolved ? 'unresolved' : 'done', { requestedFields: [], acceptedRevision: null, nativeResourceIds: { importId: target.importId, rows } }, unresolved ? 'user' : null, unresolved ? '帳簿への登録が途中で止まっています。明細の状態を確認してください。' : null)
  }
  if (op.name === 'start_purchase_research') {
    const requestId = chatRequestId(String(op.conversationId), op.turnId), research: any = await Research.findOne({ ownerId, importId: id(target.importId), line: target.line, requestId }).select('_id state').lean()
    return research ? settle('done', { outcome: 'queued', requestedFields: [], acceptedRevision: null, nativeResourceIds: { importId: target.importId, line: target.line, requestId, researchId: String(research._id) } }, null, null) : interrupted()
  }
  return interrupted()
}

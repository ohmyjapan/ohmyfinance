// Named, owner-scoped intake actions for Navi. Binary files remain in the browser UI.
import * as intake from './financeIntakeService'
import { researchView, queueResearch, confirmIntakeResearch } from './financeIntakeResearchService'
import { IntakeRecord, IntakeBatch, IntakeTemplate, IntakeResearch, initializeIntake } from '../models/FinanceIntake'
import { fail } from './financeService'

const oid = { type: 'string', pattern: '^[a-f0-9]{24}$' }
const schema = (properties: any, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
const recordArgs = { recordId: { ...oid, description: 'Owned intake record id; omit to use the record selected when this message was sent.' } }
const sheetArgs = { documentId: { ...oid, description: 'Already uploaded owned document id; omit to use the selected upload.' }, sheet: { type: 'string', maxLength: 200 }, headerRow: { type: 'integer', minimum: 1 } }
const recordActions = new Set(['get_intake_record', 'get_intake_research', 'patch_intake_record', 'set_intake_archived', 'start_intake_research', 'confirm_intake_research'])
const documentActions = new Set(['read_intake_sheet', 'preview_intake_import', 'apply_intake_import'])
const mutationNames = new Set(['create_intake_record', 'patch_intake_record', 'set_intake_archived', 'apply_intake_import', 'save_intake_template', 'start_intake_research', 'confirm_intake_research'])
export const isIntakeMutation = (name: string) => mutationNames.has(name)
const revision = { type: 'integer', minimum: 1, description: 'Current record revision from a fresh get_intake_record; never guess.' }
const researchRevision = { type: 'integer', minimum: 0, description: 'Current research revision from get_intake_research, or0 if none exists.' }
const importArgs = { ...sheetArgs, mapping: { type: 'object' }, defaults: { type: 'object' }, extras: { type: 'array', maxItems: 30, items: { type: 'object' } } }
const requestedFields = (name: string, args: any) => name === 'set_intake_archived' ? ['archived'] : name === 'confirm_intake_research' ? ['supplierName', 'invoiceNumber'] : [...Object.keys(args.values || {}), ...Object.keys(args.extra || {}).map(k => 'extra:' + k)]
const pending = (name: string, args: any, nativeResourceIds: any = null) => ({ state: 'unresolved', recoveryOwner: 'user', receipt: { requestedFields: requestedFields(name, args), acceptedRevision: null, nativeResourceIds } })
// No native evidence is not evidence that a database write never happened. Expired intake claims stay unresolved;
// a new model attempt must not repeat the operation. Only attributable markers establish completion.
export const unresolvedIntakeAction = (op: any) => pending(op.name, op.intakeArgs || op.args || {})
export function intakeRequestId(operationId: string) { return [operationId.slice(0,8), operationId.slice(8,12), operationId.slice(12,16), operationId.slice(16,20), operationId.slice(20)].join('-') }
export async function intakeActionOutcome(ownerId: string, op: any): Promise<any | null> {
  await initializeIntake()
  const args = op.intakeArgs || op.args || {}, operation = { operationId: op.operationId, name: op.name }
  const matches = (m: any) => m?.operationId === operation.operationId && m?.name === operation.name
  const done = (nativeResourceIds: any, acceptedRevision: number | null = null, outcome?: string) => ({ state: 'done', ...(outcome ? { outcome } : {}), receipt: { requestedFields: requestedFields(op.name, args), acceptedRevision, nativeResourceIds } })
  if (op.name === 'apply_intake_import') {
    const batch: any = await IntakeBatch.findOne({ ownerId, 'operation.operationId': op.operationId, 'operation.name': op.name }).lean()
    if (batch) return done({ batchId: String(batch._id), documentId: String(batch.documentId), counts: batch.counts })
    const records: any[] = await IntakeRecord.find({ ownerId, history: { $elemMatch: { 'operation.operationId': op.operationId, 'operation.name': op.name } } }).select('_id').limit(101).lean()
    const template: any = await IntakeTemplate.findOne({ ownerId, operations: { $elemMatch: operation } }).select('_id').lean()
    return records.length || template ? pending(op.name, args, { documentId: args.documentId, partial: true, recordIds: records.slice(0,100).map(r => String(r._id)), truncated: records.length > 100, ...(template ? { templateId: String(template._id) } : {}) }) : null
  }
  if (op.name === 'save_intake_template') {
    const template: any = await IntakeTemplate.findOne({ ownerId, operations: { $elemMatch: operation } }).select('_id').lean()
    // Template revision is deliberately null: a concurrent UI save can advance it and the marker records no revision.
    return template ? done({ templateId: String(template._id) }) : null
  }
  if (op.name === 'start_intake_research') {
    const requestId = intakeRequestId(op.operationId)
    const research: any = await IntakeResearch.findOne({ ownerId, recordId: args.recordId, $or: [{ requestId }, { 'history.requestId': requestId }] }).lean()
    const marker = research?.requestId === requestId ? research.operation : research?.history?.find((h: any) => h.requestId === requestId)?.operation
    return matches(marker) ? done({ recordId: args.recordId, researchId: String(research._id), requestId }, marker.revision, 'queued') : null
  }
  const record: any = await IntakeRecord.findOne({ ownerId, ...(args.recordId ? { _id: args.recordId } : {}), history: { $elemMatch: { 'operation.operationId': op.operationId, 'operation.name': op.name } } }).select('_id history').lean()
  const entry = record?.history.find((h: any) => matches(h.operation))
  if (!entry) return null
  const resources = { recordId: String(record._id), ...(entry.researchId ? { researchId: entry.researchId, verified: entry.verified === true } : {}) }
  if (op.name === 'confirm_intake_research') {
    const research: any = await IntakeResearch.findOne({ ownerId, recordId: record._id }).select('confirmed history').lean()
    const finalized = matches(research?.confirmed?.operation) || research?.history?.some((h: any) => matches(h.confirmed?.operation))
    if (!finalized) { const result = pending(op.name, args, { ...resources, recordSaved: true, researchFinalized: false }); result.receipt.acceptedRevision = entry.operation.revision; return result }
  }
  return done(resources, entry.operation.revision)
}
export function intakeActionArgs(name: string, input: any, selected: any) {
  const args = { ...input }
  if (recordActions.has(name) && args.recordId === undefined && selected?.recordId) args.recordId = selected.recordId
  if (documentActions.has(name)) {
    if (args.documentId === undefined && selected?.documentId) args.documentId = selected.documentId
    if (args.sheet === undefined && selected?.sheet) args.sheet = selected.sheet
    if (args.headerRow === undefined && selected?.headerRow !== undefined) args.headerRow = selected.headerRow
  }
  return args
}
const required = (value: any, label: string) => { if (!value) fail(400, label + 'を選択してください。'); return value as string }
const read = (name: string, description: string, properties: any, run: any) => ({ name, description, inputSchema: schema(properties), effect: 'read', modes: ['workspace'], targeted: false, needsLine: false, run })
const mutate = (name: string, effect: 'write' | 'queue', description: string, properties: any, requiredArgs: string[], run: any) => ({ name, description, inputSchema: schema(properties, requiredArgs), effect, modes: ['workspace'], targeted: false, needsLine: false,
  async run(scope: any, args: any, _target: any, operation: intake.IntakeOperation) {
    const result = await run(scope.ownerId, args, operation)
    return { ...(await intakeActionOutcome(scope.ownerId, { ...operation, args }) || unresolvedIntakeAction({ name, args })), result }
  }
})
export const intakeActions: any[] = [
  read('list_intake_records', 'Read owned purchase-intake records. Use a detail read for their saved history/evidence. Counts are limited to the native service population, not an exhaustive accounting total.', { archived: { type: 'boolean' }, search: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1 } },
    async (scope: any, args: any) => {
      const result = await intake.listRecords(scope.ownerId, { archived: args.archived === true })
      const query = String(args.search || '').normalize('NFKC').toLowerCase(), limit = Math.min(args.limit || 50, 100)
      const records = result.records.filter((r: any) => !query || Object.values(r.values || {}).some(v => String(v).normalize('NFKC').toLowerCase().includes(query)))
      return { records: records.slice(0, limit).map((r: any) => ({ id: r.id, revision: r.revision, values: r.values, archived: r.archived, identityReview: r.identityReview })), counts: result.counts, matchingLoadedRecords: records.length, truncated: records.length > limit, nativePopulationLimit: 5000 }
    }),
  read('get_intake_record', 'Read one owned intake record, its exact saved values, original-file provenance, revisions, history and attachments. A company/T number here is not a ledger entry or proof of tax charged.', recordArgs,
    (scope: any, args: any) => intake.readRecord(scope.ownerId, required(args.recordId, '受付'))),
  read('read_intake_sheet', 'Read JSON headers, first20 nonempty rows, total row count and guessed mapping from an existing uploaded intake document. No second upload is needed. File bytes are not a model tool.', sheetArgs,
    (scope: any, args: any) => intake.readSheet(scope.ownerId, required(args.documentId, '取込ファイル'), args.sheet, args.headerRow)),
  read('preview_intake_import', 'Preview mapping of an existing intake upload. Returns counts/proposed changes only; it does not import or save a template.', { ...sheetArgs, mapping: { type: 'object' }, defaults: { type: 'object' }, extras: { type: 'array', maxItems: 30, items: { type: 'object' } } },
    (scope: any, args: any) => intake.previewImport(scope.ownerId, required(args.documentId, '取込ファイル'), args)),
  read('list_intake_batches', 'Read the owner\'s latest200 intake import batches and actual imported/conflict counts, with source-file hashes. This is intake history, not bank collection status.', {},
    (scope: any) => intake.listBatches(scope.ownerId)),
  read('list_intake_templates', 'Read the owner\'s saved intake column mappings and extra fields (up to500 templates).', {},
    (scope: any) => intake.listTemplates(scope.ownerId)),
  read('get_intake_research', 'Read the selected intake company/T-number investigation, evidence, job state and native verified/stale flags. Queued is not complete; published or saved is not NTA-verified unless verified is true. Existing read-time expired-job recovery remains in the domain service.', recordArgs,
    (scope: any, args: any) => researchView(scope.ownerId, required(args.recordId, '受付'))),
  mutate('create_intake_record', 'write', 'Create a purchase-intake record only when the user instructs it. values uses the same named fields as get_intake_record; extra is an owner-named field map. Does not post to the ledger.', { values: { type: 'object' }, extra: { type: 'object' } }, ['values'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => intake.createRecord(ownerId, args, operation)),
  mutate('patch_intake_record', 'write', 'Save explicitly instructed values/extra on an owned intake record at its freshly read revision. Native nonblank merge: blanks keep old values. Does not clear fields, change matching allocations or post to the ledger.', { ...recordArgs, revision, values: { type: 'object' }, extra: { type: 'object' } }, ['revision'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => intake.patchRecord(ownerId, required(args.recordId, '受付'), args, operation)),
  mutate('set_intake_archived', 'write', 'Archive or restore the selected owned intake record at its fresh revision, on explicit instruction. This is reversible; it does not delete a record or its files.', { ...recordArgs, revision, archived: { type: 'boolean' } }, ['revision', 'archived'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => intake.archiveRecord(ownerId, required(args.recordId, '受付'), args, operation)),
  mutate('apply_intake_import', 'write', 'Apply the mapping of an existing uploaded intake file after preview and explicit import instruction. Returns actual new/update/unchanged/conflict counts. Optional template saves that mapping. Partial outcomes must be checked, never blindly repeated.', { ...importArgs, template: schema({ name: { type: 'string', minLength: 1, maxLength: 100 } }, ['name']) }, ['mapping'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => intake.applyImport(ownerId, required(args.documentId, '取込ファイル'), args, operation)),
  mutate('save_intake_template', 'write', 'Save an owned intake column-mapping template on explicit instruction. headers are exact sheet headers; mapping and extras use zero-based column indices as strings. The saved result contains the current template revision; the receipt revision is null.', { name: { type: 'string', minLength: 1, maxLength: 100 }, service: { type: 'string', maxLength: 200 }, account: { type: 'string', maxLength: 200 }, currency: { type: 'string', maxLength: 200 }, headers: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 500 } }, mapping: { type: 'object' }, extras: importArgs.extras }, ['name', 'headers', 'mapping'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => intake.saveTemplate(ownerId, args, operation)),
  mutate('start_intake_research', 'queue', 'Queue OMF research of the saved merchant URL for company/T-number evidence. Read current record and research revisions first. Receipt queued means accepted, not completed or saved. Request identity is supplied by the server.', { ...recordArgs, revision, researchRevision, instruction: { type: 'string', maxLength: 2000 } }, ['revision', 'researchRevision'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => queueResearch(ownerId, required(args.recordId, '受付'), { ...args, requestId: intakeRequestId(operation.operationId) }, operation)),
  mutate('confirm_intake_research', 'write', 'After showing company/T-number evidence and the user explicitly asks to save it, confirm the current ready research into the intake record only. Read current record/research revisions first. Does not create a supplier, ledger entry or claim NTA verification unless verified:true.', { ...recordArgs, revision, researchRevision, confirm: { type: 'boolean' } }, ['revision', 'researchRevision', 'confirm'],
    (ownerId: string, args: any, operation: intake.IntakeOperation) => confirmIntakeResearch(ownerId, required(args.recordId, '受付'), args, operation))
]

// Named, owner-scoped intake reads for Navi. Binary files remain in the browser UI.
// Intake writes are deliberately not registered until their native outcome recovery is implemented.
import * as intake from './financeIntakeService'
import { researchView } from './financeIntakeResearchService'
import { fail } from './financeService'

const oid = { type: 'string', pattern: '^[a-f0-9]{24}$' }
const schema = (properties: any) => ({ type: 'object', additionalProperties: false, properties })
const recordArgs = { recordId: { ...oid, description: 'Owned intake record id; omit to use the record selected when this message was sent.' } }
const sheetArgs = { documentId: { ...oid, description: 'Already uploaded owned document id; omit to use the selected upload.' }, sheet: { type: 'string', maxLength: 200 }, headerRow: { type: 'integer', minimum: 1 } }
const recordActions = new Set(['get_intake_record', 'get_intake_research'])
const documentActions = new Set(['read_intake_sheet', 'preview_intake_import'])
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
    (scope: any, args: any) => researchView(scope.ownerId, required(args.recordId, '受付')))
]

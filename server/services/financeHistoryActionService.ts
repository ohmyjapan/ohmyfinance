import { readDraft } from './financeDraftService'
import { learningEvidence } from './financeLearningService'
import { FinanceLearningDataset } from '../models/FinanceLearning'
import { normalizeMerchant } from '../../shared/finance-draft.mjs'

// Called only after the common action dispatcher resolves a fresh owned/assigned import and row.
// Keep the native learning rules: same account/merchant, eligible earlier rows, active library and effective rules.
export async function purchaseHistory(ownerId: string, target: { importId: string, line: number, accountId: string }) {
  const draft = await readDraft(ownerId, target.importId, target.line)
  const source = draft.source, pointer = { ...target, merchant: source.description, purchaseDate: source.purchaseDate, amount: source.amount, kind: source.kind }
  if (source.kind !== 'expense') return { target: pointer, applicable: false, reason: 'Classification history is for expense purchases; this row is not an expense.' }
  const evidence = await learningEvidence(ownerId, target.accountId, normalizeMerchant(source.description), source.purchaseDate, source.amount)
  const dataset: any = evidence?.datasetId ? await FinanceLearningDataset.findOne({ _id: evidence.datasetId, ownerId }).select('title sourceUrl primarySheet').lean() : null
  const history = evidence?.history || [], rules = evidence?.rules || [], corrections = draft.history || []
  return {
    target: pointer, applicable: true,
    learning: {
      dataset: dataset ? { id: String(dataset._id), title: dataset.title, sourceUrl: dataset.sourceUrl, primarySheet: dataset.primarySheet } : null,
      historyAvailable: evidence?.history !== null && evidence?.history !== undefined,
      history: history.slice(0, 50), historyTotal: history.length, historyTruncated: history.length > 50,
      rules: rules.slice(0, 50), rulesTotal: rules.length, rulesTruncated: rules.length > 50,
      // Preserve the answer computed on ALL native evidence, even when the examples are bounded.
      answer: evidence?.answer ? { ...evidence.answer, ...(evidence.answer.rules ? { rules: evidence.answer.rules.slice(0, 50) } : {}) } : null
    },
    draft: {
      revision: draft.revision, accountingResponse: draft.accountingResponse,
      corrections: corrections.slice(0, 20).map((entry: any) => ({ revision: entry.revision, at: entry.at, action: entry.action, changes: entry.changes || [], rememberedFields: entry.rememberedFields || [], ...(entry.summary ? { summary: entry.summary } : {}), ...(entry.text ? { sourceQuote: entry.text } : {}) })),
      correctionsTotal: corrections.length, correctionsTruncated: corrections.length > 20
    },
    interpretation: 'Workbook examples are prior recorded classifications, not proof of this purchase\'s items or motive. Rule notes and saved correction quotes are recorded explanations, not independent tax or invoice verification. A current draft reason/correction is not a reusable rule. Missing evidence and truncated examples do not prove there is no other history. No values, rules, approval or ledger entries were changed.'
  }
}

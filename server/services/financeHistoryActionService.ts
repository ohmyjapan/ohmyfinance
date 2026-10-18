import { readDraft } from './financeDraftService'
import { learningEvidence } from './financeLearningService'
import { FinanceLearningDataset, FinanceLearningPolicy } from '../models/FinanceLearning'
import { normalizeMerchant } from '../../shared/finance-draft.mjs'

// Called only after the common action dispatcher resolves a fresh owned/assigned import and row.
// Keep the native learning rules: same account/merchant, eligible earlier rows, active library and effective rules.
export async function purchaseHistory(ownerId: string, target: { importId: string, line: number, accountId: string }) {
  const draft = await readDraft(ownerId, target.importId, target.line)
  const source = draft.source, pointer = { ...target, merchant: source.description, purchaseDate: source.purchaseDate, amount: source.amount, kind: source.kind }
  if (source.kind !== 'expense') return { target: pointer, applicable: false, reason: 'Classification history is for expense purchases; this row is not an expense.' }
  const merchant = normalizeMerchant(source.description)
  const evidence = await learningEvidence(ownerId, target.accountId, merchant, source.purchaseDate, source.amount)
  const dataset: any = evidence?.datasetId ? await FinanceLearningDataset.findOne({ _id: evidence.datasetId, ownerId }).select('title sourceUrl primarySheet').lean() : null
  const history = evidence?.history || [], rules = evidence?.rules || [], corrections = draft.history || []
  // Native learning rules omit policy account scope and status audit. Read only the selected purchase's applicable policy ids.
  // Other account identifiers are never returned, even when the policy also covers them. Native selection remains unchanged.
  const policyIds = rules.slice(0, 50).filter((rule: any) => rule.kind === 'policy').map((rule: any) => rule.id)
  const policies: any[] = policyIds.length ? await FinanceLearningPolicy.find({ ownerId, _id: { $in: policyIds }, merchants: merchant, $or: [{ accountIds: { $size: 0 } }, { accountIds: target.accountId }] }).select('accountIds revision status audit effectiveFrom').lean() : []
  const byId = new Map(policies.map(policy => [String(policy._id), policy]))
  const withSource = (rule: any) => {
    // `cards` is a legacy display-label field, not the declared account restriction; empty labels cannot prove global scope.
    const { cards: _labels, ...native } = rule, policy = byId.get(rule.id), audit = policy?.audit || []
    return {
      ...native, applicability: { accountId: target.accountId, merchant, purchaseDate: source.purchaseDate },
      sourceEvidence: policy ? {
        available: true, currentRevision: policy.revision, matchesAppliedRevision: policy.revision === rule.revision, status: policy.status, effectiveFrom: policy.effectiveFrom || '',
        scope: { kind: policy.accountIds.length ? 'specific_accounts' : 'all_owner_accounts', selectedAccountId: target.accountId, selectedAccountOnly: policy.accountIds.length === 1, otherAccountIdsReturned: false },
        statusHistory: audit.slice(-10).map((entry: any) => ({ at: entry.at, status: entry.status, revision: entry.revision, source: entry.source })),
        statusHistoryTotal: audit.length, statusHistoryTruncated: audit.length > 10,
        historyMeaning: 'Recorded status-change events only, not complete past policy snapshots. Missing events do not prove unchanged status or explain who changed a rule.'
      } : { available: false, limitation: 'Original declared scope and status audit are not loaded for this rule kind, or its source no longer matches the selected scope. Applicability is to this purchase; do not infer an unrestricted rule.' }
    }
  }
  return {
    target: pointer, applicable: true,
    learning: {
      dataset: dataset ? { id: String(dataset._id), title: dataset.title, sourceUrl: dataset.sourceUrl, primarySheet: dataset.primarySheet } : null,
      historyAvailable: evidence?.history !== null && evidence?.history !== undefined,
      history: history.slice(0, 50), historyTotal: history.length, historyTruncated: history.length > 50,
      rules: rules.slice(0, 50).map(withSource), rulesTotal: rules.length, rulesTruncated: rules.length > 50,
      ruleConflict: evidence?.answer?.conflict ? {
        state: 'unresolved', selectedPurchase: { accountId: target.accountId, merchant, purchaseDate: source.purchaseDate },
        selectedRuleCount: rules.length, selectedRuleIds: rules.slice(0, 50).map((rule: any) => rule.id), selectedRulesTruncated: rules.length > 50,
        winnerRuleId: null, resolution: 'no_native_winner', reason: evidence.answer.reason,
        meaning: 'These selected rules already apply to this purchase under their account, merchant and effective-date conditions, but their purpose/customer decisions disagree. Native selection has not chosen a winner. Shared applicability is present; it is not a lack of conditions. A newer status revision or a majority of historical examples does not resolve this native conflict.'
      } : null,
      // Preserve the answer computed on ALL native evidence, even when the examples are bounded.
      answer: evidence?.answer ? { ...evidence.answer, ...(evidence.answer.rules ? { rules: evidence.answer.rules.slice(0, 50).map(withSource) } : {}) } : null
    },
    draft: {
      revision: draft.revision, accountingResponse: draft.accountingResponse,
      corrections: corrections.slice(0, 20).map((entry: any) => ({ revision: entry.revision, at: entry.at, action: entry.action, changes: entry.changes || [], rememberedFields: entry.rememberedFields || [], ...(entry.summary ? { summary: entry.summary } : {}), ...(entry.text ? { sourceQuote: entry.text } : {}) })),
      correctionsTotal: corrections.length, correctionsTruncated: corrections.length > 20
    },
    interpretation: 'Workbook examples are prior recorded classifications, not proof of this purchase\'s items or motive. Rule notes and saved correction quotes are recorded explanations, not independent tax or invoice verification. A current draft reason/correction is not a reusable rule. Rule applicability is for this selected account/merchant/date; only sourceEvidence.scope describes the declared policy account restriction. Applied rule revision and current source revision are separate reads, not an atomic snapshot; if they differ, reread before describing the current rule. Status-history events can establish a recorded transition: a newly active conflicting rule does not by itself mean an earlier answer was wrong. Without prior status evidence, the reason for that discrepancy remains unknown. Missing evidence and truncated examples do not prove there is no other history. No values, rules, approval or ledger entries were changed.'
  }
}

import { randomUUID } from 'node:crypto'
import { FinancialAccount, FinanceImport, FinanceEntry } from '../models/Finance'
import { FinanceDraft, FinanceDocument } from '../models/FinanceDraft'
import { FinancePurchaseLink } from '../models/FinancePurchaseLink'
import { fail, id } from './financeService'
import { isPending, isFinalStatement } from '../../shared/finance-pending.mjs'
import { buildSourceReferences, verifySourceReferences, activeImportRows, sourceReferenceGroups, forecastResolutions } from '../../shared/finance-import-overlap.mjs'

// S5 (plan omf-aplus-reconciliation-resolution-20261104): every source-reference binding of one account re-derived in creation order
// with the whole history visible (a statement imported later settles an earlier forecast; the owner's forecast resolutions are read
// from each pending batch), verified against everything, and reported — rows whose active state flips, the ledger entries, drafts,
// purchase links and documents on those rows, stale resolutions. Written only on an explicit apply: changed bindings only, hash-guarded,
// with the replaced binding kept under sourceReferenceRebuild. Rows, hashes, archives, drafts, documents, links and entries are never written.
const sid = (v: any) => String(v)
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export const MAX_IMPORTS = 100
export type RelatedRows = { entries: any[]; drafts: any[]; links: any[]; documents: any[] }
export type RebuildPlan = ReturnType<typeof planSourceReferenceRebuild>

/** Every import of one owned account, oldest first (creation order is ObjectId order), as full documents. Fails closed above 100 like acceptImport. */
export async function accountImports(ownerId: string, accountId: any): Promise<any[]> {
  const imports: any[] = await FinanceImport.find({ ownerId, accountId }).sort({ _id: 1 }).limit(MAX_IMPORTS + 1).lean()
  if (imports.length > MAX_IMPORTS) fail(409, 'Too many imports in this account; review the source history first')
  return imports
}
/** The rows that would be affected by a flipping line: read only, identities only. */
export async function relatedRows(ownerId: string, accountId: any): Promise<RelatedRows> {
  const [entries, drafts, links, documents] = await Promise.all([
    FinanceEntry.find({ ownerId, accountId }).select('importId line state').lean(),
    FinanceDraft.find({ ownerId, accountId }).select('importId line revision approvedAt').lean(),
    FinancePurchaseLink.find({ ownerId, accountId, status: 'linked' }).select('importId line').lean(),
    FinanceDocument.find({ ownerId, accountId }).select('importId line').lean()
  ])
  return { entries, drafts, links, documents }
}
const summary = (binding: any) => {
  const groups: any[] = Array.isArray(binding?.groups) ? binding.groups : [], review = groups.filter(g => g.state === 'source_overlap_review')
  return { version: binding?.version ?? null, groups: groups.length, exact: groups.length - review.length, review: review.length, resolution: groups.filter(g => g.match === 'pending_resolution').length, heldRows: review.reduce((n, g) => n + (g.lines?.length || 0), 0), candidateTargetLines: new Set(review.flatMap(g => (g.targets || []).flatMap((t: any) => t.lines.map((l: number) => t.importId + ':' + l)))).size }
}
const activeLines = (batch: any): Set<number> | null => { try { return new Set<number>(activeImportRows(batch).map((r: any) => r.line)) } catch { return null } }
const groupsOf = (batch: any): any[] => { try { return sourceReferenceGroups(batch) } catch { return [] } }

/** Pure: the rebuilt bindings and the report for one account's imports (full documents). Nothing is written. */
export function planSourceReferenceRebuild(imports: any[], related: RelatedRows = { entries: [], drafts: [], links: [], documents: [] }) {
  const ordered = [...imports].sort((a, b) => sid(a._id).localeCompare(sid(b._id)))
  const failures: { importId: string; stage: string; error: string }[] = [], seenFailure = new Set<string>()
  const failure = (importId: string, stage: string, error: any) => { const key = importId + ':' + stage; if (seenFailure.has(key)) return; seenFailure.add(key); failures.push({ importId, stage, error: String(error?.message || error).slice(0, 200) }) }
  const storedVerify = new Map<string, boolean>()
  for (const b of ordered) { try { verifySourceReferences(b, ordered); storedVerify.set(sid(b._id), true) } catch { storedVerify.set(sid(b._id), false) } }
  // Creation order with the whole history, repeated until no binding changes: a later statement's exact groups settle earlier
  // forecasts, and an earlier binding rebuilt can free rows a later one references. Bounded; a history that does not settle fails.
  let current: any[] = ordered.map(b => ({ ...b })), passes = 0, moved = true
  while (moved && passes < 5) {
    passes++; moved = false
    const rebuilt: any[] = []
    for (const [index, b] of current.entries()) {
      let next = b.sourceReferences
      try { next = buildSourceReferences(b, rebuilt, [...rebuilt, ...current.slice(index + 1)]) } catch (error: any) { failure(sid(b._id), 'build', error) }
      if (!same(next, b.sourceReferences)) moved = true
      rebuilt.push({ ...b, sourceReferences: next })
    }
    current = rebuilt
  }
  if (moved) failure('', 'converge', 'the bindings did not settle within 5 passes')
  for (const b of current) { try { verifySourceReferences(b, current) } catch (error: any) { failure(sid(b._id), 'verify', error) } }
  const on = (rows: any[], b: any, line: number) => rows.filter(r => sid(r.importId) === sid(b._id) && r.line === line).map(r => sid(r._id))
  const reports = current.map(b => {
    const before = ordered.find(o => sid(o._id) === sid(b._id))!, was = activeLines(before) || new Set<number>(), now = activeLines(b) || new Set<number>()
    const flipping = [...new Set([...was, ...now])].filter(l => was.has(l) !== now.has(l)).sort((x, y) => x - y).map(line => ({ line, before: was.has(line) ? 'active' : 'excluded', after: now.has(line) ? 'active' : 'excluded', entries: on(related.entries, b, line), drafts: on(related.drafts, b, line), links: on(related.links, b, line), documents: on(related.documents, b, line) }))
    return { importId: sid(b._id), hash: b.hash, provider: b.provider || 'amex', sourceStatus: b.sourceStatus || 'final', period: { kind: b.period?.kind ?? null, statementMonth: b.period?.statementMonth ?? null, start: b.period?.start ?? null, end: b.period?.end ?? null }, rows: b.rows.length, storedVerify: storedVerify.get(sid(b._id)) ?? false, changed: !same(before.sourceReferences, b.sourceReferences), before: summary(before.sourceReferences), after: summary(b.sourceReferences), activeBefore: was.size, activeAfter: now.size, flipping, replaced: before.sourceReferences ?? null }
  })
  // The owner's forecast decisions the rebuilt bindings no longer honour: listed, never silently dropped.
  const stale: { importId: string; line: number; state: string; reason: string }[] = []
  for (const b of current) {
    if (!isPending(b)) continue
    let records: Map<number, any>
    try { records = forecastResolutions(b) } catch { failure(sid(b._id), 'records', 'forecast resolution records are malformed'); continue }
    for (const [line, record] of records) {
      if (record.state === 'billed') {
        const target = current.find(t => sid(t._id) === record.target.importId)
        const bound = !!target && target.hash === record.target.sourceHash && groupsOf(target).some(g => g.match === 'pending_resolution' && g.targets[0].importId === sid(b._id) && g.targets[0].lines.includes(line))
        if (!bound) stale.push({ importId: sid(b._id), line, state: 'billed', reason: !target ? 'the target import is missing' : target.hash !== record.target.sourceHash ? 'the target file changed' : 'no reference group binds this decision (the line was settled exactly elsewhere, its rows changed, or the statement rows were taken)' })
      } else {
        const exactly = (!!b.finalization && isFinalStatement(b)) || current.some(t => !isPending(t) && isFinalStatement(t) && groupsOf(t).some(g => g.state === 'existing_import' && g.match !== 'pending_resolution' && g.targets.some((x: any) => x.importId === sid(b._id) && x.lines.includes(line))))
        if (exactly) stale.push({ importId: sid(b._id), line, state: 'closed', reason: 'superseded by an exact statement match' })
      }
    }
  }
  const flipping = reports.flatMap(r => r.flipping.map(f => ({ importId: r.importId, ...f })))
  return { passes, verified: !failures.length, failures, imports: reports, changed: reports.filter(r => r.changed).map(r => r.importId), bindings: new Map(current.map(b => [sid(b._id), b.sourceReferences])), flipping, stale, released: flipping.filter(f => f.after === 'active').length, held: flipping.filter(f => f.after === 'excluded').length }
}

/** Writes the plan's changed bindings only (hash-guarded, the replaced binding kept). Refuses a plan that does not verify or that flips a posted row. */
export async function applySourceReferenceRebuild(plan: RebuildPlan, { ownerId, revision, check }: { ownerId: string; revision: string; check?: () => Promise<void> }) {
  if (!plan.verified) fail(409, 'Rebuilt source references do not verify; nothing was written') // guard:rebuild-verify
  if (plan.flipping.some(f => f.entries.length)) fail(409, 'A ledger entry sits on a row whose active state would change; nothing was written') // guard:rebuild-flipping-entry
  const written: string[] = []
  for (const report of plan.imports) {
    if (!report.changed) continue
    if (check) await check()
    const result = await FinanceImport.updateOne({ _id: report.importId, ownerId, hash: report.hash }, { $set: { sourceReferences: plan.bindings.get(report.importId), sourceReferenceRebuild: { at: new Date(), revision, replaced: report.replaced } } })
    if (!result.matchedCount) fail(409, 'An import changed while its source references were being rebuilt; retry')
    written.push(report.importId)
  }
  return written
}
/** The plan without the bindings themselves: what a caller returns or prints. */
export function rebuildReport(plan: RebuildPlan) {
  return { passes: plan.passes, verified: plan.verified, failures: plan.failures, imports: plan.imports.map(({ replaced: _replaced, ...rest }) => rest), changed: plan.changed, flipping: plan.flipping, stale: plan.stale, released: plan.released, held: plan.held }
}
/** Dry run by default. apply=true takes the account lease (shared with imports, drafts and posting), writes the changed bindings and releases it. */
export async function rebuildSourceReferences(ownerId: string, accountId: string, { apply = false, revision = 'unknown' }: { apply?: boolean; revision?: string } = {}) {
  const account: any = await FinancialAccount.findOne({ _id: id(accountId), ownerId }).lean()
  if (!account) fail(404, 'Account not found')
  const lease = randomUUID()
  const locked = await FinancialAccount.findOneAndUpdate({ _id: account._id, ownerId, active: true, $or: [{ commitLeaseUntil: { $exists: false } }, { commitLeaseUntil: null }, { commitLeaseUntil: { $lte: new Date() } }] }, { $set: { commitLease: lease, commitLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }).lean()
  if (!locked) fail(409, 'Another import or draft is being saved; retry shortly') // guard:rebuild-lease
  const check = async () => { if (!await FinancialAccount.exists({ _id: account._id, ownerId, commitLease: lease, commitLeaseUntil: { $gt: new Date() } })) fail(409, 'Rebuild lease expired; retry') }
  try {
    const plan = planSourceReferenceRebuild(await accountImports(ownerId, account._id), await relatedRows(ownerId, account._id))
    const written = apply ? await applySourceReferenceRebuild(plan, { ownerId, revision, check }) : []
    return { accountId: sid(account._id), apply, revision, written, ...rebuildReport(plan) }
  } finally { await FinancialAccount.updateOne({ _id: account._id, ownerId, commitLease: lease }, { $unset: { commitLease: '', commitLeaseUntil: '' } }) }
}

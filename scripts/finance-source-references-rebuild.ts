// scripts/finance-source-references-rebuild.ts — plan omf-aplus-reconciliation-resolution-20261104 S6.
// Re-derives every source-reference binding of ONE owned card account in creation order with the whole history visible, verifies the
// result and reports what would change: groups, candidate target lines, rows whose active state flips, the ledger entries / drafts /
// purchase links / documents on those rows, and stale forecast resolutions. Dry run by default: nothing is written. --apply writes the
// changed bindings only (hash-guarded) with sourceReferenceRebuild { at, revision, replaced } and refuses on any verify failure or a
// ledger entry on a flipping row. RUNNING THIS AGAINST PRODUCTION IS NOT AUTHORIZED BY THE PLAN THAT ADDED IT: it needs its own owner
// order after the dry-run report has been read.
//   MONGO_URI=<explicit address> npx tsx scripts/finance-source-references-rebuild.ts --owner <userId> --account <accountId> [--apply] [--report <file.json>] [--revision <label>]
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import mongoose from 'mongoose'
import { ensureConnection } from '../server/config/database'
import { initializeFinance } from '../server/models/Finance'
import { rebuildSourceReferences } from '../server/services/financeSourceReferenceRebuildService'
// The auth service (reached through financeService) starts the token-blacklist cleanup interval at import; it is stopped so the process ends.
import { stopCleanup } from '../server/services/tokenBlacklistService'

const args = process.argv.slice(2), opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
async function main() {
  const owner = opt('--owner'), account = opt('--account'), report = opt('--report'), apply = args.includes('--apply')
  if (!owner || !account) { console.error('usage: --owner <userId> --account <accountId> [--apply] [--report <file.json>] [--revision <label>]'); process.exit(2) }
  // The database address must be explicit: this script never falls back to a default address or an in-memory server.
  if (!process.env.MONGO_URI) { console.error('MONGO_URI must name the database explicitly'); process.exit(2) }
  const revision = opt('--revision') || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() } catch { return 'unknown' } })()
  if (apply) console.error('APPLY: changed bindings will be written. A production run needs its own owner order (plan omf-aplus-reconciliation-resolution-20261104 S6).')
  await ensureConnection(); await initializeFinance()
  try {
    const result = await rebuildSourceReferences(owner, account, { apply, revision })
    if (report) await writeFile(report, JSON.stringify(result, null, 2))
    for (const r of result.imports) console.log(`${r.importId} ${r.sourceStatus === 'pending' ? 'pending' : 'statement'} ${r.period.statementMonth || r.period.start || ''} rows ${r.rows} groups ${r.before.groups}→${r.after.groups} review targets ${r.before.candidateTargetLines}→${r.after.candidateTargetLines} active ${r.activeBefore}→${r.activeAfter}${r.changed ? ' CHANGED' : ''}${r.storedVerify ? '' : ' STORED-BINDING-INVALID'}`)
    console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${result.changed.length} of ${result.imports.length} bindings ${apply ? 'written' : 'would change'}, ${result.released} rows released, ${result.held} rows newly held, ${result.flipping.filter((f: any) => f.entries.length).length} flipping rows with ledger entries, ${result.stale.length} stale forecast resolutions, verified ${result.verified}${result.failures.length ? ' failures ' + JSON.stringify(result.failures) : ''}${report ? ', report ' + report : ''}`)
    process.exitCode = result.verified ? 0 : 1
  } catch (error: any) {
    console.error('REFUSED: ' + (error?.data?.message || error?.statusMessage || error?.message || error))
    process.exitCode = 1
  } finally { await mongoose.disconnect().catch(() => {}); stopCleanup() }
}
main().then(() => process.exit(process.exitCode || 0), error => { console.error(String(error?.stack || error)); process.exit(1) })

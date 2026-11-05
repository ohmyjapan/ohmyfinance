import { randomUUID } from 'node:crypto'
import { FinancialAccount, FinanceImport, FinanceEntry } from '../models/Finance'
import { fail, ownedImport, pendingSettlements } from './financeService'
import { isPending, isFinalStatement } from '../../shared/finance-pending.mjs'
import { forecastResolutions, verifySourceReferences, resolutionTargetEligible } from '../../shared/finance-import-overlap.mjs'
import { accountImports, relatedRows, planSourceReferenceRebuild, applySourceReferenceRebuild, rebuildReport } from './financeSourceReferenceRebuildService'

// R3 (plan omf-aplus-reconciliation-resolution-20261104, READBACK B1-B4): the owner's decision on one unbilled (forecast) line.
//   billed — these forecast lines (one, or a group of identical ones) are the chosen rows of one finalized statement whose date, merchant
//            or amount changed; the ledger posts the statement's values and the statement rows become reference copies of the forecast.
//            Plan omf-aplus-statement-payment-review-20261105: the chosen row may also be the same Aplus purchase the issuer kept under
//            individual review (statement_review, a blank or adjusted payment field) — the shared eligibility decides; that pairing records
//            the source only, the forecast stays in review with its original amounts, and nothing here marks it paid, posts or closes it.
//   closed — no bill is expected (cancelled, refunded): the forecast never posts and holds no other row; a later exact statement match
//            still binds it and supersedes the record (B1).
//   reopen — undoes either; the candidate holds return.
// Write order: billed/closed write the record on the pending batch (forecastResolutions.<line>, the same record on every line of the
// decision — B4) BEFORE the bindings are rebuilt; reopen rebuilds the bindings first and removes the record AFTER. A crash between the two
// leaves a state every reader verifies; the next call or the rebuild script completes it. Every refusal below guards the owner's own
// review write (B3): it names the alternative and writes nothing.
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
export const ENTRY_ON_TARGET = '既に帳簿に登録された明細です。未請求側を『請求なし』で閉じてください。'
export const ENTRY_ON_FORECAST = '既に帳簿に登録された未請求明細です。照合は変更できません。'
type Action = 'billed' | 'closed' | 'reopen'
type Request = { line: number; action: Action; lines: number[]; target: { importId: string; sourceHash: string; lines: number[] } | null; note: string; revision: number | undefined; sourceHash: string }

function lineList(value: any, message: string): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(n => !Number.isSafeInteger(n) || n < 2)) fail(400, message)
  return [...new Set<number>(value)].sort((a, b) => a - b)
}
function input(batch: any, body: any): Request {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '照合の内容を確認してください。')
  const line = body.line
  if (!Number.isSafeInteger(line) || line < 2) fail(400, '明細行が不正です。')
  if (!['billed', 'closed', 'reopen'].includes(body.action)) fail(400, '照合の操作（billed・closed・reopen）を確認してください。')
  if (body.sourceHash !== batch.hash) fail(409, '元の明細と一致しません。再読込してください。') // guard:forecast-source-hash
  const lines = body.lines === undefined ? [line] : lineList(body.lines, '照合する未請求の行を確認してください。')
  if (!lines.includes(line)) fail(400, '照合する未請求の行を確認してください。')
  const note = body.note === undefined ? '' : body.note
  if (typeof note !== 'string' || note.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note)) fail(400, 'メモは1000文字以内で入力してください。')
  const revision = body.revision
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) fail(400, '照合記録の版を確認してください。')
  let target: Request['target'] = null
  if (body.action === 'billed') {
    const t = body.target
    if (!t || typeof t !== 'object' || !/^[a-f0-9]{24}$/.test(String(t.importId)) || String(t.importId) === String(batch._id) || !/^[a-f0-9]{64}$/.test(String(t.sourceHash))) fail(400, '照合先の確定明細を選択してください。')
    target = { importId: String(t.importId), sourceHash: String(t.sourceHash), lines: lineList(t.lines, '照合先の確定明細の行を確認してください。') }
  }
  return { line, action: body.action, lines, target, note, revision, sourceHash: batch.hash }
}

/** The owner's decision on one forecast line. `dryRun` validates and plans everything (the lease included) and writes nothing. */
export async function resolveForecastLine(ownerId: string, importId: string, body: any, options: { dryRun?: boolean } = {}) {
  const initial = await ownedImport(ownerId, importId)
  if (!isPending(initial)) fail(409, '未請求（仮）の明細だけを照合できます。確定明細の行は元の未請求明細から照合してください。') // guard:forecast-pending-only
  const request = input(initial, body)
  const lease = randomUUID()
  const locked = await FinancialAccount.findOneAndUpdate({ _id: initial.accountId, ownerId, active: true, $or: [{ commitLeaseUntil: { $exists: false } }, { commitLeaseUntil: null }, { commitLeaseUntil: { $lte: new Date() } }] }, { $set: { commitLease: lease, commitLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }).lean()
  if (!locked) fail(409, '別の取込・登録処理が進行中です。少し待って再試行してください。') // guard:forecast-lease
  const check = async () => { if (!await FinancialAccount.exists({ _id: initial.accountId, ownerId, commitLease: lease, commitLeaseUntil: { $gt: new Date() } })) fail(409, '照合の有効時間を超えました。再試行してください。') }
  try {
    const imports = await accountImports(ownerId, initial.accountId), batch = imports.find(b => String(b._id) === String(initial._id))
    if (!batch || batch.hash !== request.sourceHash) fail(409, '元の明細と一致しません。再読込してください。')
    for (const b of imports) { try { verifySourceReferences(b, imports) } catch { fail(409, '取込元の参照が変更されています。先に取込元を確認してください。') } } // guard:forecast-references
    let records: Map<number, any>
    try { records = forecastResolutions(batch) } catch { return fail(409, '未請求の照合記録が不正です。') }
    const current = records.get(request.line) || null
    if (request.revision !== undefined && request.revision !== (current?.revision || 0)) fail(409, '照合の記録が更新されました。再読込してください。') // guard:forecast-revision
    if (request.action === 'reopen' && !current) fail(409, '照合の記録がありません。') // guard:forecast-reopen-record
    const lines: number[] = request.action === 'reopen' ? current.lines : request.lines
    for (const line of lines) { const row = batch.rows.find((r: any) => r.line === line); if (!row) fail(400, '明細行が見つかりません。'); if (row.kind !== 'expense') fail(400, '支出の明細だけを照合できます。') } // guard:forecast-expense
    if (request.action !== 'reopen') for (const line of lines) { const existing = records.get(line); if (existing && !equal(existing.lines, lines)) fail(409, `先に${existing.lines.join('・')}行の照合を取り消してください。`) } // guard:forecast-grouping
    const settlements = await pendingSettlements(batch)
    for (const line of lines) { const s = settlements.get(line); if (s?.state === 'finalized' && s.source?.match !== 'pending_resolution') fail(409, '確定明細と一致済みの明細は照合を変更できません。') } // guard:forecast-exact
    const touched = [...new Set([...lines, ...(current?.lines || [])])]
    if (await FinanceEntry.exists({ ownerId, importId: batch._id, line: { $in: touched } })) fail(409, ENTRY_ON_FORECAST) // guard:forecast-posted
    let target: any = null
    if (request.action === 'billed') {
      target = imports.find(b => String(b._id) === request.target!.importId && b.hash === request.target!.sourceHash)
      if (!target) fail(409, '確定明細を選び直してください。再読込してください。') // guard:forecast-target
      if (isPending(target) || !isFinalStatement(target)) fail(400, '確定した請求明細の行だけを照合先にできます。') // guard:forecast-target-final
      if (request.target!.lines.length !== lines.length) fail(400, '未請求の行数と確定明細の行数が一致しません。') // guard:forecast-count
      const forecastRows = lines.map(l => batch.rows.find((r: any) => r.line === l)), targetRows = request.target!.lines.map(l => target.rows.find((r: any) => r.line === l))
      if (targetRows.some((r, i) => r && r.cardIdentifier !== forecastRows[i].cardIdentifier)) fail(400, 'カードが一致しません。') // guard:forecast-card
      if (targetRows.some((r, i) => !resolutionTargetEligible(forecastRows[i], r))) fail(400, '確定明細の支出の行か、同じ利用（カード・利用日・利用先・利用金額・請求月が一致する個別確認の行）だけを照合先にできます。') // guard:forecast-target-eligible
      const candidates = lines.flatMap(l => (settlements.get(l)?.candidates || []).filter((c: any) => c.importId === String(target._id)).flatMap((c: any) => c.lines))
      if (request.target!.lines.some(l => !candidates.includes(l))) fail(409, '選んだ確定明細は、この未請求の候補ではありません。再読込してください。') // guard:forecast-candidate
      if (await FinanceEntry.exists({ ownerId, importId: target._id, line: { $in: request.target!.lines } })) fail(409, ENTRY_ON_TARGET) // guard:forecast-target-posted
    }
    const at = new Date().toISOString(), next: any = { ...(batch.forecastResolutions || {}) }
    const strip = (record: any) => { const { replaced: _replaced, ...rest } = record; return rest }
    if (request.action === 'reopen') for (const line of lines) delete next[line]
    else for (const line of lines) { const previous = records.get(line) || null; next[line] = { state: request.action, lines, ...(target ? { target: { importId: String(target._id), sourceHash: target.hash, lines: request.target!.lines } } : {}), note: request.note, at, revision: (previous?.revision || 0) + 1, replaced: previous ? strip(previous) : null } }
    const plan = planSourceReferenceRebuild(imports.map(b => b === batch ? { ...b, forecastResolutions: next } : b), await relatedRows(ownerId, initial.accountId))
    if (!plan.verified) fail(409, '照合後の取込元の参照を検証できませんでした。照合内容を見直してください。') // guard:forecast-verify
    if (plan.flipping.some(f => f.entries.length)) fail(409, '帳簿に登録済みの明細の扱いが変わるため、この照合はできません。') // guard:forecast-flipping-entry
    const label = `forecast:${String(batch._id)}:${lines.join(',')}:${request.action}`
    if (!options.dryRun) {
      await check()
      if (request.action !== 'reopen') { const result = await FinanceImport.updateOne({ _id: batch._id, ownerId, hash: batch.hash }, { $set: Object.fromEntries(lines.map(l => [`forecastResolutions.${l}`, next[l]])) }); if (!result.matchedCount) fail(409, '元の明細が変更されました。再読込してください。') }
      await applySourceReferenceRebuild(plan, { ownerId, revision: label, check })
      if (request.action === 'reopen') { await check(); await FinanceImport.updateOne({ _id: batch._id, ownerId, hash: batch.hash }, { $unset: Object.fromEntries(lines.map(l => [`forecastResolutions.${l}`, ''])) }) }
    }
    const settlement = options.dryRun ? null : (await pendingSettlements(await ownedImport(ownerId, importId))).get(request.line) || null
    return { importId: String(batch._id), line: request.line, action: request.action, lines, dryRun: !!options.dryRun, record: next[request.line] ?? null, rebuild: rebuildReport(plan), settlement }
  } finally { await FinancialAccount.updateOne({ _id: initial.accountId, ownerId, commitLease: lease }, { $unset: { commitLease: '', commitLeaseUntil: '' } }) }
}

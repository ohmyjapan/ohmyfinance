import { FinanceInventoryMatch } from '../models/FinanceInventoryMatch'
import { ownedImport, ownedAccount, assertEditableImportRow, fail } from './financeService'
import { readDraft, withWritableDraft } from './financeDraftService'
import { digest } from '../../shared/amex.mjs'
import { normalizeMerchant } from '../../shared/finance-draft.mjs'
import { inventoryCalculation, inventoryCodes, inventoryDecision, validateInventoryPacket } from '../../shared/finance-inventory-review.mjs'

const contextKey = (draft: any) => digest(JSON.stringify([draft.values.purpose, draft.values.customerId]))
async function bound(ownerId: string, record: any) {
  const batch = await ownedImport(ownerId, record.importId.toString())
  const account = await ownedAccount(ownerId, batch.accountId.toString())
  const row = batch.rows.find((r: any) => r.line === record.line)
  if (!row || row.kind !== 'expense' || record.accountId.toString() !== batch.accountId.toString() || record.sourceHash !== batch.hash || record.key !== row.key || record.merchant !== normalizeMerchant(row.description)) fail(409, '商品候補と元のカード明細が一致しません。')
  assertEditableImportRow(batch, record.line)
  try { validateInventoryPacket(record.packet) } catch { fail(409, '商品候補の根拠を再確認してください。') }
  if (digest(JSON.stringify(record.packet)) !== record.packetHash) fail(409, '商品候補の根拠が変更されています。')
  return { batch, account, row }
}
function display(record: any, account: any, row: any) {
  return { importId: record.importId.toString(), line: record.line, key: record.key, sourceHash: record.sourceHash,
    revision: record.revision, packetHash: record.packetHash, packet: record.packet,
    decision: record.decision || null, history: [...(record.history || [])].reverse(),
    source: { accountName: account.name, description: row.description, purchaseDate: row.purchaseDate, cardLast4: row.cardIdentifier.slice(-4), amount: row.amount },
    calculation: inventoryCalculation(record.packet, row.amount) }
}
export async function inventoryPreview(ownerId: string, imports: string[], line?: number) {
  if (!imports.length || imports.length > 10 || new Set(imports).size !== imports.length || imports.some(v => !/^[a-f0-9]{24}$/i.test(v)) || (line !== undefined && (!Number.isSafeInteger(line) || line < 2 || imports.length !== 1))) fail(400, '明細を選択してください。')
  for (const importId of imports) await ownedImport(ownerId, importId)
  const records: any[] = await FinanceInventoryMatch.find({ ownerId, importId: { $in: imports }, ...(line === undefined ? {} : { line }) }).sort({ importId: 1, line: 1 }).limit(501).lean()
  if (records.length > 500) fail(400, '表示する明細を絞り込んでください。')
  const rows = []
  for (const record of records) {
    const { account, row } = await bound(ownerId, record)
    const item: any = display(record, account, row)
    if (line !== undefined) {
      const draft = await readDraft(ownerId, imports[0], line)
      item.draftRevision = draft.revision; item.locked = draft.locked; item.contextKey = contextKey(draft)
      item.contextChanged = !!record.decision && record.decision.contextKey !== item.contextKey
      const codes = inventoryCodes(record.packet)
      const previous: any[] = codes.length ? await FinanceInventoryMatch.find({ ownerId, accountId: record.accountId, merchant: record.merchant, _id: { $ne: record._id }, 'decision.status': { $in: ['accepted', 'corrected', 'rejected'] }, 'decision.contextKey': item.contextKey }).sort({ updatedAt: -1 }).limit(100).lean() : []
      item.learning = []
      for (const p of previous) {
        try {
          await bound(ownerId, p)
          if (!inventoryCodes(p.packet).some(code => codes.includes(code))) continue
          const oldDraft = await readDraft(ownerId, p.importId.toString(), p.line)
          if (contextKey(oldDraft) !== p.decision.contextKey) continue
          item.learning.push({ importId: p.importId.toString(), line: p.line, ...p.decision })
          if (item.learning.length === 5) break
        } catch (e: any) { if (![404, 409].includes(e.statusCode)) throw e }
      }
    }
    rows.push(item)
  }
  return { rows }
}
export async function saveInventoryDecision(ownerId: string, body: any) {
  if (!body || Object.keys(body).some(k => !['importId', 'line', 'key', 'sourceHash', 'draftRevision', 'contextKey', 'revision', 'packetHash', 'status', 'productName', 'note'].includes(k)) || typeof body.importId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.importId) || !Number.isSafeInteger(body.line) || !Number.isSafeInteger(body.revision)) fail(400, '確認内容の形式を確認してください。')
  return withWritableDraft(ownerId, body.importId, body.line, { revision: body.draftRevision, key: body.key, sourceHash: body.sourceHash }, async (draft, check) => {
    const record: any = await FinanceInventoryMatch.findOne({ ownerId, importId: body.importId, line: body.line }).lean()
    if (!record) fail(404, '商品候補が見つかりません。')
    await bound(ownerId, record)
    if (record.revision !== body.revision || record.packetHash !== body.packetHash || contextKey(draft) !== body.contextKey) fail(409, '候補または判断が更新されています。再読込してください。')
    let chosen: any
    try { chosen = inventoryDecision(body, record.packet) } catch (e: any) { fail(400, e.message) }
    const at = new Date(), decision = { ...chosen, at, contextKey: body.contextKey, purpose: draft.values.purpose, customerId: draft.values.customerId }
    await check()
    const result = await FinanceInventoryMatch.updateOne({ _id: record._id, ownerId, revision: body.revision, packetHash: body.packetHash }, { $set: { decision }, $inc: { revision: 1 }, $push: { history: { revision: record.revision + 1, at, before: record.decision || null, after: decision } } })
    if (!result.matchedCount) fail(409, '判断が更新されています。再読込してください。')
    return inventoryPreview(ownerId, [body.importId], body.line)
  })
}

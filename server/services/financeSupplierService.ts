import mongoose from 'mongoose'
import SupplierModel from '../models/Supplier'
import { FinanceMerchantLink } from '../models/FinanceMerchantLink'
import { FinanceDraft } from '../models/FinanceDraft'
import { ownedImport, ownedAccount, fail, id } from './financeService'
import { digest } from '../../shared/amex.mjs'
import { normalizeMerchant } from '../../shared/finance-draft.mjs'
import { supplierRegistration, resolveSupplier, evidenceUrl } from '../../shared/finance-supplier.mjs'
const Supplier = SupplierModel as mongoose.Model<any>
export async function supplierReferences() {
  const rows: any[] = await Supplier.find({}).select('name companyName serviceName companyInfo invoiceNumber address metadata.invoiceVerification').sort({ name: 1 }).lean()
  return rows.map(s => ({ _id: s._id, name: s.name, companyName: s.companyName || '', serviceName: s.serviceName || '', companyInfo: s.companyInfo || '', invoiceNumber: s.invoiceNumber || '',
    identityKey: digest(JSON.stringify([s.name, s.companyName || '', s.serviceName || '', s.invoiceNumber || '', s.address || ''])), registration: supplierRegistration(s.metadata?.invoiceVerification?.evidence?.sha256 === digest(s.metadata?.invoiceVerification?.evidence?.text || '') ? s : { ...s, metadata: undefined }) }))
}
export async function merchantLinks(ownerId: string, accountId: string) {
  return FinanceMerchantLink.find({ ownerId, accountId }).select('-history -source').lean()
}
async function linkContext(ownerId: string, importId: string, line: number) {
  const batch = await ownedImport(ownerId, importId), account = await ownedAccount(ownerId, batch.accountId.toString())
  if (!Number.isSafeInteger(line)) fail(400, '明細行が不正です。')
  const row = batch.rows.find((r: any) => r.line === line)
  if (!row) fail(404, '明細が見つかりません。')
  if (row.kind !== 'expense') fail(400, '支出明細から仕入れ先を確認してください。')
  const merchant = normalizeMerchant(row.description)
  if (!merchant || merchant.length > 1000) fail(400, '利用先の表記を確認してください。')
  const recordId = new mongoose.Types.ObjectId(digest('omf-merchant-link:' + ownerId + ':' + account._id + ':' + merchant).slice(0,24))
  const link: any = await FinanceMerchantLink.findOne({ _id: recordId, ownerId, accountId: account._id }).lean()
  return { batch, account, row, merchant, recordId, link }
}
export async function readMerchantLink(ownerId: string, importId: string, line: number) {
  const ctx = await linkContext(ownerId, importId, line), suppliers = await supplierReferences()
  const match = resolveSupplier(ctx.row.description, suppliers, ctx.link ? [ctx.link] : [])
  const saved: any = await FinanceDraft.findOne({ ownerId, importId, line }).select('revision values.supplierId values.invoiceNumber').lean()
  return { sourceHash: ctx.batch.hash, key: ctx.row.key, line, descriptor: ctx.row.description, accountName: ctx.account.name,
    revision: ctx.link?.revision || 0, suppliers, match: { status: match.status, reason: match.reason, supplierId: match.supplier?._id.toString() || '' },
    link: ctx.link ? { supplierId: ctx.link.supplierId.toString(), enabled: ctx.link.enabled, reason: ctx.link.reason, sourceUrl: ctx.link.sourceUrl, confirmedAt: ctx.link.confirmedAt } : null,
    saved: saved ? { revision: saved.revision, supplierId: saved.values.supplierId, invoiceNumber: saved.values.invoiceNumber } : null }
}
export async function saveMerchantLink(ownerId: string, importId: string, line: number, body: any) {
  const ctx = await linkContext(ownerId, importId, line)
  if (body?.sourceHash !== ctx.batch.hash || body?.key !== ctx.row.key || !Number.isSafeInteger(body?.revision) || body.revision !== (ctx.link?.revision || 0)) fail(409, '利用先の記憶が更新されています。再読込してください。')
  if (typeof body.enabled !== 'boolean') fail(400, '記憶の適用状態を確認してください。')
  let selected: any, reason = '', sourceUrl = ''
  if (body.enabled) {
    if (body.confirmed !== true || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000 || /[\x00-\x1f]/.test(body.reason)) fail(400, '運営会社との対応と確認根拠を入力してください。')
    selected = (await supplierReferences()).find(s => s._id.toString() === id(body.supplierId))
    if (!selected) fail(404, '仕入れ先が見つかりません。')
    if (body.supplierKey !== selected.identityKey) fail(409, '仕入れ先の情報が変わりました。再読込してください。')
    if (body.sourceUrl && (typeof body.sourceUrl !== 'string' || body.sourceUrl.length > 2000 || !evidenceUrl(body.sourceUrl))) fail(400, '根拠URLはHTTPSのページを指定してください。')
    reason = body.reason.trim(); sourceUrl = body.sourceUrl ? evidenceUrl(body.sourceUrl) : ''
  } else if (!ctx.link) fail(409, '停止する記憶がありません。')
  if ((ctx.link?.history?.length || 0) >= 100) fail(409, 'この利用先の変更履歴が上限に達しました。')
  const at = new Date(), source = { importId, line, key: ctx.row.key, sourceHash: ctx.batch.hash }
  const set = { ownerId, accountId: ctx.account._id, merchant: ctx.merchant, descriptor: ctx.row.description,
    supplierId: selected?._id || ctx.link.supplierId, supplierKey: selected?.identityKey || ctx.link.supplierKey,
    revision: body.revision + 1, enabled: body.enabled, reason: body.enabled ? reason : ctx.link.reason, sourceUrl: body.enabled ? sourceUrl : ctx.link.sourceUrl,
    confirmedAt: body.enabled ? at : ctx.link.confirmedAt, source }
  const event = { ...set, at }
  if (ctx.link) {
    const result = await FinanceMerchantLink.updateOne({ _id: ctx.recordId, ownerId, revision: body.revision }, { $set: set, $push: { history: event } })
    if (!result.matchedCount) fail(409, '利用先の記憶が更新されています。再読込してください。')
  } else {
    try { await FinanceMerchantLink.create({ _id: ctx.recordId, ...set, history: [event] }) }
    catch (e: any) { if (e?.code === 11000) fail(409, '利用先の記憶が更新されています。再読込してください。'); throw e }
  }
  return readMerchantLink(ownerId, importId, line)
}

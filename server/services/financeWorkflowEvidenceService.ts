import { randomUUID } from 'node:crypto'
import { FinancialAccount, FinanceImport } from '../models/Finance'
import { fail } from './financeService'
import { activeImportRows, verifySourceReferences } from '../../shared/finance-import-overlap.mjs'

// Evidence-only saves may support posted transactions. They still share the
// import/ledger account lease and bind to the unchanged canonical source row.
// Call while holding the purchase graph lock; never mutate financial values here.
export async function withWorkflowPayment<T>(ownerId: string, binding: any, action: (payment: any, check: () => Promise<void>) => Promise<T>) {
 const lease = randomUUID(), query = { _id: binding.accountId, ownerId, active: true }
 const locked = await FinancialAccount.findOneAndUpdate({ ...query, $or: [{ commitLeaseUntil: { $exists: false } }, { commitLeaseUntil: null }, { commitLeaseUntil: { $lte: new Date() } }] }, { $set: { commitLease: lease, commitLeaseUntil: new Date(Date.now() + 60000) } })
 if (!locked) fail(409, '別の取込・登録処理が進行中です。')
 const check = async () => { if (!await FinancialAccount.exists({ ...query, commitLease: lease, commitLeaseUntil: { $gt: new Date() } })) fail(409, 'Evidence save lease expired') }
 try {
  const batches: any[] = await FinanceImport.find({ ownerId, accountId: binding.accountId }).limit(101).lean()
  if (batches.length > 100) fail(409, 'Import history exceeds evidence scope')
  const batch = batches.find(b => String(b._id) === String(binding.importId))
  if (!batch || batch.hash !== binding.sourceHash) fail(409, 'Original payment changed')
  try { verifySourceReferences(batch, batches) } catch { fail(409, 'Canonical source references changed') }
  const payment = activeImportRows(batch).find((p: any) => p.line === binding.line && p.key === binding.key)
  if (!payment || payment.kind !== 'expense' || payment.amount !== binding.payment.amount || payment.purchaseDate !== binding.payment.date) fail(409, 'Canonical payment changed')
  await check(); return await action(payment, check)
 } finally { await FinancialAccount.updateOne({ ...query, commitLease: lease }, { $unset: { commitLease: '', commitLeaseUntil: '' } }) }
}

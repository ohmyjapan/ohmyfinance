import { FinancialAccount, FinanceImport } from '../models/Finance'
import { fail, id } from './financeService'

/** The issuer request is shared across the PCs paired to this account. A new job lease cannot settle an earlier export. */
export async function aplusExportReservation(device: any, body: any) {
  const accountId = id(body?.accountId)
  const { jobId, month, attemptId, operation } = body
  if (typeof jobId !== 'string' || !jobId || jobId.length > 128 ||
      typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month) || month.length !== 7 ||
      typeof attemptId !== 'string' || attemptId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attemptId) ||
      !['reserve', 'withdraw'].includes(operation)) fail(400, 'Invalid Aplus export reservation')

  const bound = { _id: { $in: device.accountIds, $eq: accountId }, ownerId: device.ownerId, active: true, provider: 'aplus' }
  const record = { month, jobId, attemptId, deviceId: device._id }
  const cancellation = [jobId, month, device._id, attemptId].join('/')
  // A PC with proof that it never submitted can withdraw its own exact attempt after its lease ends.
  const withdraw = () => FinancialAccount.updateOne({ ...bound, aplusExportReservations: { $elemMatch: record } }, { $pull: { aplusExportReservations: record } })
  if (operation === 'withdraw') {
    // A withdrawal can arrive ahead of a delayed grant request. Cancel only this paired
    // device's nonce, even if the same job has since been reassigned to a different PC.
    const cancelled = await FinancialAccount.updateOne({ ...bound, jobId }, {
      $addToSet: { aplusCancelledDispatches: cancellation }, $pull: { aplusExportReservations: record },
    })
    if (cancelled.matchedCount) return { withdrawn: true }
    await withdraw()
    // An older job can no longer receive a grant. A lost withdrawal acknowledgment is safe to retry.
    return { withdrawn: Boolean(await FinancialAccount.exists({ ...bound, jobId: { $ne: jobId } })) }
  }

  const active = { ...bound, jobId, jobDeviceId: device._id, jobState: { $in: ['running', 'verification_required'] }, jobLeaseUntil: { $gt: new Date() } }
  const fresh = await FinancialAccount.updateOne({
    ...active, 'aplusExportReservations.month': { $ne: month }, aplusCancelledDispatches: { $ne: cancellation },
  }, { $push: { aplusExportReservations: record } })
  let owns = fresh.modifiedCount === 1
  if (!owns) {
    const current = await FinancialAccount.findOne(active).select('+aplusExportReservations').lean()
    if (!current) fail(409, 'Job is unavailable or expired')
    owns = current.aplusExportReservations?.some(entry => entry.month === month && entry.jobId === jobId &&
      entry.attemptId === attemptId && String(entry.deviceId) === String(device._id)) ?? false
  }
  // Receipt coverage can move after the job was claimed. Read it immediately before granting dispatch.
  if (await FinanceImport.exists({ ownerId: device.ownerId, accountId, 'period.kind': 'statement', 'period.statementMonth': month })) {
    if (fresh.modifiedCount === 1) await withdraw()
    return { reserved: false, reason: 'covered' }
  }
  return owns ? { reserved: true } : { reserved: false, reason: 'uncertain' }
}

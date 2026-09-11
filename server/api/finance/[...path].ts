import { randomUUID } from 'node:crypto'
import { defineEventHandler, getHeader, getQuery, readBody, setHeader } from 'h3'
import { FinancialAccount, FinanceCollector, FinanceImport } from '../../models/Finance'
import { fail, id, financeUser, financeDevice, ownedAccount, ownedImport, accountInput, createCollector, csvBody, acceptImport, reviewImport, reviewMapping, commitImport, originalFile } from '../../services/financeService'

export default defineEventHandler(async event => {
  const parts = (event.path.split('?')[0].split('/api/finance/')[1] || '').split('/').filter(Boolean)
  const method = event.method
  try {
    if (parts[0] === 'collector') {
      const device = await financeDevice(event)
      const scope = { ownerId: device.ownerId, _id: { $in: device.accountIds }, active: true }
      if (parts[1] === 'accounts' && parts.length === 2 && method === 'GET') return { accounts: await FinancialAccount.find(scope).select('-commitLease -commitLeaseUntil').lean() }
      if (parts[1] === 'claim' && parts.length === 2 && method === 'POST') {
        const account = await FinancialAccount.findOneAndUpdate({ ...scope, $or: [{ jobState: 'queued' }, { jobState: { $in: ['running','verification_required'] }, jobLeaseUntil: { $lt: new Date() } }] }, { $set: { jobState: 'running', jobDeviceId: device._id, jobLeaseUntil: new Date(Date.now() + 180000), lastAttemptAt: new Date(), lastMessage: 'Connecting to Amex' } }, { new: true, sort: { jobRequestedAt: 1 } }).select('-commitLease -commitLeaseUntil').lean()
        return { account }
      }
      if (parts[1] === 'status' && parts.length === 2 && method === 'POST') {
        const body = await readBody(event)
        if (!['running','verification_required','complete','failed'].includes(body?.state) || typeof body.jobId !== 'string') fail(400, 'Invalid job status')
        const account = await FinancialAccount.findOneAndUpdate({ ...scope, _id: { $in: device.accountIds, $eq: id(body.accountId) }, jobId: body.jobId, jobDeviceId: device._id, jobState: { $in: ['running','verification_required'] } }, { $set: { jobState: body.state, jobLeaseUntil: new Date(Date.now() + 180000), lastMessage: typeof body.message === 'string' ? body.message.slice(0,200) : '' } }, { new: true })
        if (!account) fail(409, 'Job is no longer assigned to this collector')
        return { success: true }
      }
      if (parts[1] === 'upload' && parts.length === 2 && method === 'POST') {
        const query = getQuery(event)
        const account: any = await FinancialAccount.findOne({ ...scope, _id: { $in: device.accountIds, $eq: id(query.accountId) }, jobId: query.jobId, jobDeviceId: device._id, jobState: { $in: ['running','verification_required'] }, jobLeaseUntil: { $gt: new Date() } }).lean()
        if (!account) fail(409, 'Job is unavailable or expired')
        if (!getHeader(event,'content-type')?.startsWith('text/csv')) fail(415, 'CSV required')
        return await acceptImport(device.ownerId.toString(), account, await csvBody(event), { kind: query.kind, start: query.start, end: query.end, pageCount: query.pageCount }, device._id.toString())
      }
      fail(404, 'Collector endpoint not found')
    }

    const ownerId = await financeUser(event)
    setHeader(event, 'Cache-Control', 'no-store')
    if (parts[0] === 'accounts' && parts.length === 1) {
      if (method === 'GET') return { accounts: await FinancialAccount.find({ ownerId }).select('-commitLease -commitLeaseUntil').sort({ createdAt: 1 }).lean() }
      if (method === 'POST') return { account: await FinancialAccount.create({ ownerId, ...accountInput(await readBody(event)) }) }
    }
    if (parts[0] === 'accounts' && parts.length >= 2) {
      const account = await ownedAccount(ownerId, parts[1])
      if (parts.length === 2 && method === 'PATCH') {
        const input = accountInput(await readBody(event))
        if (await FinanceImport.exists({ accountId: account._id }) && account.cardIdentifiers.some((v: string) => !input.cardIdentifiers.includes(v))) fail(409, 'Imported card identifiers cannot be removed')
        return { account: await FinancialAccount.findOneAndUpdate({ _id: account._id, ownerId }, { $set: input }, { new: true }) }
      }
      if (parts[2] === 'sync' && parts.length === 3 && method === 'POST') {
        if (!await FinanceCollector.exists({ ownerId, accountIds: account._id, revokedAt: null })) fail(409, 'Pair a collector for this account first')
        const updated = await FinancialAccount.findOneAndUpdate({ _id: account._id, ownerId, active: true, $or: [{ jobState: { $nin: ['queued','running','verification_required'] } }, { jobLeaseUntil: { $lt: new Date() }, jobState: { $ne: 'queued' } }] }, { $set: { jobId: randomUUID(), jobState: 'queued', jobRequestedAt: new Date(), lastMessage: 'Waiting for collector' }, $unset: { jobLeaseUntil: '', jobDeviceId: '' } }, { new: true })
        if (!updated) fail(409, 'A synchronization is already queued or running')
        return { account: updated }
      }
      if (parts[2] === 'imports' && parts.length === 3 && method === 'POST') {
        if (!getHeader(event,'content-type')?.startsWith('text/csv')) fail(415, 'CSV required')
        return await acceptImport(ownerId, account, await csvBody(event), getQuery(event))
      }
    }
    if (parts[0] === 'collectors') {
      if (parts.length === 1 && method === 'GET') return { collectors: await FinanceCollector.find({ ownerId }).select('-tokenHash').lean() }
      if (parts.length === 1 && method === 'POST') return await createCollector(ownerId, await readBody(event))
      if (parts.length === 2 && method === 'DELETE') {
        const device = await FinanceCollector.findOneAndUpdate({ _id: id(parts[1]), ownerId }, { $set: { revokedAt: new Date() } })
        if (!device) fail(404, 'Collector not found')
        return { success: true }
      }
    }
    if (parts[0] === 'imports') {
      if (parts.length === 1 && method === 'GET') {
        const accountId = getQuery(event).accountId
        if (accountId) await ownedAccount(ownerId, id(accountId))
        return { imports: await FinanceImport.find({ ownerId, ...(accountId ? { accountId } : {}) }).select('-rows -decisions -mappingPreview').sort({ createdAt: -1 }).limit(100).lean() }
      }
      if (parts.length === 2 && method === 'GET') return await reviewImport(ownerId, parts[1])
      if (parts[2] === 'mapping' && parts.length === 3 && method === 'GET') return await reviewMapping(ownerId, parts[1])
      if (parts[2] === 'commit' && parts.length === 3 && method === 'POST') return await commitImport(ownerId, parts[1], await readBody(event))
      if (parts[2] === 'file' && parts.length === 3 && method === 'GET') {
        const batch = await ownedImport(ownerId, parts[1])
        setHeader(event,'Content-Type',`text/csv; charset=${batch.encoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS'}`)
        setHeader(event,'Content-Disposition',`attachment; filename="amex-${batch.period.start}-${batch.period.end}.csv"`)
        setHeader(event,'Cache-Control','no-store')
        return await originalFile(batch)
      }
    }
    fail(404, 'Finance endpoint not found')
  } catch (error: any) {
    if (error?.statusCode) throw error
    if (error?.code === 11000) fail(409, 'This account, file, or transaction is already registered; refresh and review')
    console.error('[Finance] operation failed', error?.name || 'Error')
    fail(500, 'Finance operation failed')
  }
})

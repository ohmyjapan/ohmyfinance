import { readMerchantLink, saveMerchantLink } from '../../services/financeSupplierService'
import { readDraft, saveDraft, addDocument, removeDocument, createDraftReference, prepareSourceCategories, downloadDocument, boundedBody } from '../../services/financeDraftService'
import { defineEventHandler, getHeader, getQuery, readBody, setHeader } from 'h3'
import { calendarCompany } from '../../utils/calendarAccess'
import { FinancialAccount, FinanceCollector, FinanceImport } from '../../models/Finance'
import { fail, id, financeUser, financeDevice, ownedAccount, ownedImport, accountInput, accountFiscalPeriod, fiscalPeriodInput, saveAutoSync, AUTO_SYNC_PROVIDERS, queueSync, createCollector, csvBody, acceptImport, reviewImport, reviewMapping, commitImport, commitCompanyImport, originalFile } from '../../services/financeService'
import { recordBillingNotice, recordBillingMailStatus, coveredNoticeIds, bindCalendarCompany, billingMailInput, listNotices, linkNotice, importCalendarReview, linkImport } from '../../services/financeBillService'

// A JSON artifact of the collector (notice, mail receipt): bounded by csvBody, parsed once, never echoed back.
async function jsonArtifact(event: any) {
  try { return JSON.parse((await csvBody(event)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; return fail(400, 'Invalid collector artifact JSON') }
}

export default defineEventHandler(async event => {
  const parts = (event.path.split('?')[0].split('/api/finance/')[1] || '').split('/').filter(Boolean)
  const method = event.method
  try {
    if (parts[0] === 'collector') {
      const device = await financeDevice(event)
      const scope = { ownerId: device.ownerId, _id: { $in: device.accountIds }, active: true, provider: { $in: ['amex', 'aplus'] } }
      if (parts[1] === 'accounts' && parts.length === 2 && method === 'GET') return { accounts: await FinancialAccount.find(scope).select('-commitLease -commitLeaseUntil').lean() }
      if (parts[1] === 'claim' && parts.length === 2 && method === 'POST') {
        const account: any = await FinancialAccount.findOneAndUpdate({ ...scope, $or: [{ jobState: 'queued' }, { jobState: { $in: ['running','verification_required'] }, jobLeaseUntil: { $lt: new Date() } }] }, { $set: { jobState: 'running', jobDeviceId: device._id, jobLeaseUntil: new Date(Date.now() + 180000), lastAttemptAt: new Date(), lastMessage: '明細の取得を開始' } }, { new: true, sort: { jobRequestedAt: 1 } }).select('-commitLease -commitLeaseUntil').lean()
        if (account?.provider !== 'aplus') return { account }
        // Finalized Aplus statement months OMF already holds (read only): the collector never downloads them again.
        // Billing notices already completed or owned by a member (read only): the collector never sends them again; a
        // pending or transient one is sent again and retried.
        const held: any[] = await FinanceImport.find({ ownerId: device.ownerId, accountId: account._id, provider: 'aplus', 'period.kind': 'statement' }).select('period').lean()
        return { account, covered: { statements: [...new Set(held.map(b => b.period?.statementMonth).filter((m: any): m is string => typeof m === 'string'))], notices: await coveredNoticeIds(account._id) } }
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
        const kind = String(query.kind || '')
        const json = account.provider === 'aplus' && ['pending', 'notice', 'billing-mail'].includes(kind)
        if (!getHeader(event,'content-type')?.startsWith(json ? 'application/json' : 'text/csv')) fail(415, json ? 'Bank page JSON capture required' : 'CSV required')
        // An issuer billing notice (parsed claims + body hash, never the body) and the mail read's receipt are JSON
        // artifacts of the same claimed job; the statement CSV path is unchanged apart from the issuer-shown due date.
        if (json && kind === 'notice') return await recordBillingNotice(device.ownerId.toString(), account, await jsonArtifact(event), device._id.toString())
        if (json && kind === 'billing-mail') return await recordBillingMailStatus(account, await jsonArtifact(event))
        // A JSON page capture proves its own page and row counts (shared/finance-pending.mjs); its manifest page count is not a CSV row count.
        return await acceptImport(device.ownerId.toString(), account, await csvBody(event), { kind: query.kind, start: query.start, end: query.end, fiscalStart: query.fiscalStart, fiscalEnd: query.fiscalEnd, pageCount: json ? undefined : query.pageCount, statementMonth: query.statementMonth, statementTotal: query.statementTotal, refundTotal: query.refundTotal, paymentDueDate: query.paymentDueDate }, device._id.toString())
      }
      fail(404, 'Collector endpoint not found')
    }

    const ownerId = await financeUser(event)
    setHeader(event, 'Cache-Control', 'no-store')
    if (parts[0] === 'accounts' && parts.length === 1) {
      if (method === 'GET') {
        const accounts = await FinancialAccount.find({ ownerId }).select('-commitLease -commitLeaseUntil').sort({ createdAt: 1 }).lean()
        return { accounts: await Promise.all(accounts.map(async account => ({ ...account, fiscalPeriod: await accountFiscalPeriod(ownerId, account) }))) }
      }
      if (method === 'POST') return { account: await FinancialAccount.create({ ownerId, ...accountInput(await readBody(event)) }) }
    }
    if (parts[0] === 'accounts' && parts.length >= 2) {
      const account = await ownedAccount(ownerId, parts[1])
      if (parts[2] === 'fiscal-period' && parts.length === 3 && method === 'PUT') {
        if (account.provider !== 'aplus') fail(400, 'Aplus account required')
        const fiscalPeriod = fiscalPeriodInput(await readBody(event))
        await FinancialAccount.updateOne({ _id: account._id, ownerId }, [{ $set: { accounting: { $mergeObjects: [{ $ifNull: ['$accounting', {}] }, { fiscalPeriod }] } } }])
        return { fiscalPeriod }
      }
      if (parts[2] === 'auto-sync' && parts.length === 3 && method === 'PUT') {
        // Every provider the daily schedule queues (plan omf-card-handover-20261030: Amex, latest CLOSED statement only; Aplus), opted
        // into explicitly: the shared write keeps its Aplus-only default for the owner Navi action. Same shared write (dotted paths: the
        // schedule's own lastQueuedDay is kept), input rule and response.
        if (!AUTO_SYNC_PROVIDERS.includes(account.provider)) fail(400, 'Amex or Aplus account required')
        return await saveAutoSync(ownerId, account, await readBody(event), null, { providers: AUTO_SYNC_PROVIDERS })
      }
      // The payment-calendar company of this account (GUARD: current membership of the chosen company). Existing bills stay
      // in the company they were created in; unfinished notice and statement work is re-run under the new binding.
      if (parts[2] === 'calendar' && parts.length === 3 && method === 'PUT') {
        if (account.provider !== 'aplus') fail(400, 'Aplus account required')
        return await bindCalendarCompany(ownerId, account, await readBody(event))
      }
      // Billing mail read inside this account's collector job: the setting only; the status fields are the collector's.
      if (parts[2] === 'billing-mail' && parts.length === 3 && method === 'PUT') {
        if (account.provider !== 'aplus') fail(400, 'Aplus account required')
        const billingMail = billingMailInput(await readBody(event))
        await FinancialAccount.updateOne({ _id: account._id, ownerId }, { $set: { 'billingMail.enabled': billingMail.enabled, 'billingMail.mailbox': billingMail.mailbox } })
        return { billingMail }
      }
      if (parts.length === 2 && method === 'PATCH') {
        const input = accountInput({ provider: account.provider || 'amex', ...await readBody(event) })
        if (input.provider !== (account.provider || 'amex')) fail(400, 'The provider of an existing card account cannot be changed')
        if (await FinanceImport.exists({ accountId: account._id }) && account.cardIdentifiers.some((v: string) => !input.cardIdentifiers.includes(v))) fail(409, 'Imported card identifiers cannot be removed')
        return { account: await FinancialAccount.findOneAndUpdate({ _id: account._id, ownerId }, { $set: input }, { new: true }) }
      }
      if (parts[2] === 'sync' && parts.length === 3 && method === 'POST') return { account: await queueSync(ownerId, account) }
      if (parts[2] === 'imports' && parts.length === 3 && method === 'POST') {
        const jsonCapture = account.provider === 'aplus' && getQuery(event).kind === 'pending'
        if (!getHeader(event,'content-type')?.startsWith(jsonCapture ? 'application/json' : 'text/csv')) fail(415, jsonCapture ? 'Bank page JSON capture required' : 'CSV required')
        return await acceptImport(ownerId, account, await csvBody(event), getQuery(event))
      }
    }
    // Issuer billing notices of one owned account (no bodies) and the member's explicit review action on one of them
    // (GUARD: current membership of the chosen bill's or company's organization is checked at the write).
    if (parts[0] === 'notices') {
      if (parts.length === 1 && method === 'GET') return await listNotices(ownerId, id(getQuery(event).accountId))
      if (parts.length === 3 && parts[2] === 'link' && method === 'PUT') return await linkNotice(ownerId, parts[1], await readBody(event))
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
    if (parts[0] === 'documents' && parts.length === 3 && parts[2] === 'file' && method === 'GET') {
      const { doc, bytes } = await downloadDocument(ownerId, parts[1])
      setHeader(event, 'Content-Type', doc.mimeType)
      setHeader(event, 'Content-Disposition', "attachment; filename=\"document\"; filename*=UTF-8''" + encodeURIComponent(doc.name))
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      return bytes
    }
    if (parts[0] === 'imports' && parts[2] === 'merchant-links' && parts.length === 4) {
      if (method === 'GET') return await readMerchantLink(ownerId, parts[1], Number(parts[3]))
      if (method === 'PUT') {
        let body: any
        try { body = JSON.parse((await boundedBody(event, 10000)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; fail(400, 'Invalid merchant link JSON') }
        return await saveMerchantLink(ownerId, parts[1], Number(parts[3]), body)
      }
    }
    if (parts[0] === 'imports' && parts[2] === 'source-categories' && parts.length === 3 && method === 'POST') {
      let body: any
      try { body = JSON.parse((await boundedBody(event, 10000)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; fail(400, 'Invalid source category JSON') }
      return await prepareSourceCategories(ownerId, parts[1], body)
    }
    if (parts[0] === 'imports' && parts[2] === 'references' && parts.length === 3 && method === 'POST') {
      let body: any
      try { body = JSON.parse((await boundedBody(event, 10000)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; fail(400, 'Invalid reference JSON') }
      // The created supplier, customer or tax category belongs to the token's selected company (fresh membership checked here).
      return await createDraftReference(ownerId, parts[1], body, (await calendarCompany(event)).organizationId)
    }
    if (parts[0] === 'imports' && parts[2] === 'drafts' && parts.length >= 4) {
      const line = Number(parts[3])
      if (parts.length === 6 && parts[4] === 'documents' && method === 'DELETE') {
        let body: any
        try { body = JSON.parse((await boundedBody(event, 10000)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; fail(400, 'Invalid document JSON') }
        return await removeDocument(ownerId, parts[1], line, parts[5], body)
      }
      if (parts.length === 4 && method === 'GET') return await readDraft(ownerId, parts[1], line)
      if (parts.length === 4 && method === 'PUT') {
        let body: any
        try { body = JSON.parse((await boundedBody(event, 1024 * 1024)).toString('utf8')) } catch (error: any) { if (error?.statusCode) throw error; fail(400, 'Invalid draft JSON') }
        return await saveDraft(ownerId, parts[1], line, body)
      }
      if (parts.length === 5 && parts[4] === 'documents' && method === 'POST') return await addDocument(ownerId, parts[1], line, getQuery(event), await boundedBody(event, 10 * 1024 * 1024), getHeader(event, 'content-type') || '')
    }
    if (parts[0] === 'imports') {
      if (parts.length === 1 && method === 'GET') {
        const accountId = getQuery(event).accountId
        if (accountId) await ownedAccount(ownerId, id(accountId))
        return { imports: await FinanceImport.find({ ownerId, ...(accountId ? { accountId } : {}) }).select('-rows -decisions -mappingPreview -sourceReferences').sort({ createdAt: -1 }).limit(100).lean() }
      }
      if (parts.length === 2 && method === 'GET') return await reviewImport(ownerId, parts[1])
      // The statement batch's calendar state with the choices it offers this member, and the explicit choice itself
      // (GUARD: current membership of the chosen bill's or company's organization is checked at the write).
      if (parts[2] === 'calendar' && parts.length === 3 && method === 'GET') return await importCalendarReview(ownerId, parts[1])
      if (parts[2] === 'calendar' && parts.length === 3 && method === 'PUT') return await linkImport(ownerId, parts[1], await readBody(event))
      if (parts[2] === 'mapping' && parts.length === 3 && method === 'GET') return await reviewMapping(ownerId, parts[1])
      if (parts[2] === 'company-commit' && parts.length === 3 && method === 'POST') {
        const { organizationId } = await calendarCompany(event)
        return await commitCompanyImport(ownerId, parts[1], await readBody(event), organizationId)
      }
      if (parts[2] === 'commit' && parts.length === 3 && method === 'POST') return await commitImport(ownerId, parts[1], await readBody(event))
      if (parts[2] === 'file' && parts.length === 3 && method === 'GET') {
        const batch = await ownedImport(ownerId, parts[1])
        setHeader(event,'Content-Type',batch.sourceFormat === 'json' ? 'application/json; charset=UTF-8' : `text/csv; charset=${batch.encoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS'}`)
        setHeader(event,'Content-Disposition',`attachment; filename="${batch.provider || 'amex'}-${batch.period.start}-${batch.period.end}.${batch.sourceFormat || 'csv'}"`)
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

// Intake (購入受付) routes, owner-scoped by financeUser (plan omf-intake-feature-20261016 §2): records, attachments,
// original files, sheet reading, preview/import, templates, batches. 11000 → 409 as the finance route.
import { defineEventHandler, setHeader, getQuery, getHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import * as intake from '../../services/financeIntakeService'
import { researchView, queueResearch, confirmIntakeResearch } from '../../services/financeIntakeResearchService'
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const ownerId = await financeUser(event), parts = (event.path.split('?')[0].split('/api/finance-intake/')[1] || '').split('/').filter(Boolean), method = event.method, query = getQuery(event)
    const json = async () => { try { return JSON.parse((await boundedBody(event, 300000)).toString('utf8')) } catch (e: any) { if (e.statusCode) throw e; return fail(400, 'Invalid intake request') } }
    const mime = () => String(getHeader(event, 'content-type') || '').split(';')[0].trim().toLowerCase()
    const q = (key: string) => typeof query[key] === 'string' ? String(query[key]) : ''
    if (parts[0] === 'records') {
      if (parts.length === 1 && method === 'GET') return intake.listRecords(ownerId, { archived: q('archived') === '1' })
      if (parts.length === 1 && method === 'POST') return intake.createRecord(ownerId, await json())
      if (parts.length === 2 && method === 'GET') return intake.readRecord(ownerId, parts[1])
      if (parts.length === 2 && method === 'PATCH') return intake.patchRecord(ownerId, parts[1], await json())
      if (parts.length === 3 && parts[2] === 'archive' && method === 'PUT') return intake.archiveRecord(ownerId, parts[1], await json())
      if (parts.length === 3 && parts[2] === 'documents' && method === 'POST') return intake.attachDocument(ownerId, parts[1], q('name'), q('kind'), await boundedBody(event, intake.MAX_BYTES), mime())
      if (parts.length === 3 && parts[2] === 'research' && method === 'GET') return researchView(ownerId, parts[1])
      if (parts.length === 3 && parts[2] === 'research' && method === 'POST') return queueResearch(ownerId, parts[1], await json())
      if (parts.length === 4 && parts[2] === 'research' && parts[3] === 'confirm' && method === 'POST') return confirmIntakeResearch(ownerId, parts[1], await json())
    }
    if (parts[0] === 'documents' && parts.length === 3 && parts[2] === 'file' && method === 'GET') {
      const { doc, bytes } = await intake.downloadDocument(ownerId, parts[1])
      setHeader(event, 'Content-Type', doc.mimeType); setHeader(event, 'Content-Length', bytes.length); setHeader(event, 'X-Content-Type-Options', 'nosniff')
      setHeader(event, 'Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(doc.name))
      return bytes
    }
    if (parts[0] === 'files') {
      if (parts.length === 1 && method === 'POST') return intake.uploadFile(ownerId, q('name'), await boundedBody(event, intake.MAX_BYTES), mime())
      if (parts.length === 3 && parts[2] === 'sheet' && method === 'GET') return intake.readSheet(ownerId, parts[1], q('sheet'), q('headerRow'))
      if (parts.length === 3 && parts[2] === 'preview' && method === 'POST') return intake.previewImport(ownerId, parts[1], await json())
      if (parts.length === 3 && parts[2] === 'import' && method === 'POST') return intake.applyImport(ownerId, parts[1], await json())
    }
    if (parts[0] === 'templates' && parts.length === 1) { if (method === 'GET') return intake.listTemplates(ownerId); if (method === 'PUT') return intake.saveTemplate(ownerId, await json()) }
    if (parts[0] === 'batches' && parts.length === 1 && method === 'GET') return intake.listBatches(ownerId)
    fail(404, 'Intake endpoint not found')
  } catch (e: any) {
    if (e?.statusCode) throw e
    if (e?.code === 11000) fail(409, '同じ受付・書類・テンプレートが既に登録されています。再読み込みしてください。')
    console.error('[Intake] request failed', e?.name || 'Error')
    fail(500, '受付の処理を完了できません。')
  }
})

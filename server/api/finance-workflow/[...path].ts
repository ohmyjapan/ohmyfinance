import { defineEventHandler, getQuery, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { chatAgent } from '../../services/financeChatService'
import { workflowView, configureWorkflow, syncWorkflowRecords, reviewWorkflow, workflowWorkerStatus, claimWorkflowRun, workflowRunHeartbeat, workflowRunContext, saveWorkflowSource, workflowObservation, finishWorkflowRun, connectWorkflowInventory, saveWorkflowDocuments, saveWorkflowDocumentAttempt } from '../../services/financeWorkflowService'
import { workflowReceiptList, workflowReceiptFile, saveWorkflowReceipt, prepareWorkflowInvestigation, saveWorkflowInvestigation, workflowInvestigationView, saveWorkflowPurchaseOriginal, acceptWorkflowPurchase, workflowInvestigationOriginal, acceptWorkflowReceiptInventory, saveWorkflowInvestigationNote, releaseWorkflowPurchase } from '../../services/financeWorkflowInvestigationService'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const parts = (event.path.split('?')[0].split('/api/finance-workflow/')[1] || '').split('/').filter(Boolean)
  const body = async (max = 20000) => { try { return JSON.parse((await boundedBody(event, max)).toString('utf8')) } catch (e: any) { if (e.statusCode) throw e; fail(400, 'Invalid workflow request') } }
  try {
    if (parts[0] === 'worker') {
      const agent = await chatAgent(event)
      if (event.method !== 'POST') fail(405, 'POST required')
      if (parts.length === 2 && parts[1] === 'status') return workflowWorkerStatus(agent, await body())
      if (parts.length === 2 && parts[1] === 'claim') return claimWorkflowRun(agent)
      if (parts.length === 3) {
        if (parts[2] === 'heartbeat') return workflowRunHeartbeat(agent, parts[1], await body())
        if (parts[2] === 'context') return workflowRunContext(agent, parts[1], await body())
        if (parts[2] === 'source') return saveWorkflowSource(agent, parts[1], await body(26000000))
        if (parts[2] === 'inventory') return connectWorkflowInventory(agent, parts[1], await body())
        if (parts[2] === 'documents') return saveWorkflowDocuments(agent, parts[1], await body(33000000))
        if (parts[2] === 'document-attempt') return saveWorkflowDocumentAttempt(agent, parts[1], await body(2100000))
        if (parts[2] === 'receipts') return workflowReceiptList(agent, parts[1], await body())
        if (parts[2] === 'receipt-file') return workflowReceiptFile(agent, parts[1], await body())
        if (parts[2] === 'receipt-reading') return saveWorkflowReceipt(agent, parts[1], await body(350000))
        if (parts[2] === 'investigate') return prepareWorkflowInvestigation(agent, parts[1], await body())
        if (parts[2] === 'investigation-result') return saveWorkflowInvestigation(agent, parts[1], await body(100000))
        if (parts[2] === 'purchase-original') return saveWorkflowPurchaseOriginal(agent, parts[1], await body(15000000))
        if (parts[2] === 'accept-purchase') { const b = await body(); return acceptWorkflowPurchase(String(agent.ownerId), b.id, b, { agent, runId: parts[1], lease: b.lease }) }
        if (parts[2] === 'observation') return workflowObservation(agent, parts[1], await body())
        if (parts[2] === 'finish') return finishWorkflowRun(agent, parts[1], await body())
      }
      fail(404, 'Workflow worker endpoint not found')
    }
    const ownerId = await financeUser(event)
    if (parts.length === 1 && parts[0] === 'status' && event.method === 'GET') return workflowView(ownerId, getQuery(event))
    if (parts.length === 1 && parts[0] === 'settings' && event.method === 'PUT') return configureWorkflow(ownerId, await body())
    if (parts.length === 1 && parts[0] === 'refresh' && event.method === 'POST') return syncWorkflowRecords(ownerId, await body())
    if (parts.length === 2 && parts[1] === 'review' && event.method === 'POST') return reviewWorkflow(ownerId, parts[0], await body())
    if (parts.length === 2 && parts[1] === 'investigation' && event.method === 'GET') return workflowInvestigationView(ownerId, parts[0])
    if (parts.length === 2 && parts[1] === 'accept-purchase' && event.method === 'POST') return acceptWorkflowPurchase(ownerId, parts[0], await body())
    if (parts.length === 2 && parts[1] === 'accept-inventory' && event.method === 'POST') return acceptWorkflowReceiptInventory(ownerId, parts[0], await body())
    if (parts.length === 2 && parts[1] === 'release-purchase' && event.method === 'POST') return releaseWorkflowPurchase(ownerId, parts[0], await body())
    if (parts.length === 2 && parts[1] === 'note' && event.method === 'POST') return saveWorkflowInvestigationNote(ownerId, parts[0], await body())
    if (parts.length === 3 && parts[1] === 'original' && event.method === 'GET') { const file = await workflowInvestigationOriginal(ownerId, parts[0], parts[2]); setHeader(event, 'Content-Type', file.mimeType); setHeader(event, 'Content-Disposition', 'attachment'); return file.bytes }
    fail(404, 'Workflow endpoint not found')
  } catch (e: any) {
    if (e.statusCode) throw e
    console.error('[Finance workflow] request failed', e.name || 'Error')
    fail(500, '照合の処理に失敗しました。再試行してください。')
  }
})

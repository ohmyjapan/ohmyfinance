import { defineEventHandler, getQuery, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { inventoryPreview, saveInventoryDecision } from '../../services/financeInventoryReviewService'
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const ownerId = await financeUser(event)
    if (event.method === 'GET') {
      const q = getQuery(event)
      if (typeof q.imports !== 'string' || q.imports.length > 260 || (q.line !== undefined && (typeof q.line !== 'string' || !/^\d+$/.test(q.line)))) fail(400, '明細を選択してください。')
      return await inventoryPreview(ownerId, (q.imports as string).split(','), q.line === undefined ? undefined : Number(q.line))
    }
    if (event.method === 'POST') {
      let body
      try { body = JSON.parse((await boundedBody(event, 10000)).toString('utf8')) } catch (e: any) { if (e.statusCode) throw e; fail(400, '確認内容を読み取れません。') }
      return await saveInventoryDecision(ownerId, body)
    }
    fail(404, 'Review endpoint not found')
  } catch (e: any) {
    if (e.statusCode) throw e
    console.error('[Inventory review] request failed', e.name || 'Error')
    fail(500, '商品候補の確認に失敗しました。')
  }
})

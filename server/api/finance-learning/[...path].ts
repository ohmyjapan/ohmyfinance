import { defineEventHandler, getQuery, setHeader } from 'h3'
import { financeUser, fail } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { learningOverview, learningPatterns, learningDetail, learningRows, learningRow, saveLearningDecision, savePolicyStatus } from '../../services/financeLearningService'
export default defineEventHandler(async event => {
  setHeader(event,'Cache-Control','no-store')
  try {
    const ownerId = await financeUser(event), parts=(event.path.split('?')[0].split('/api/finance-learning/')[1] || '').split('/').filter(Boolean)
    if (event.method==='GET') {
      const query=getQuery(event)
      if (parts.length===1 && parts[0]==='overview') return await learningOverview(ownerId)
      if (parts.length===1 && parts[0]==='patterns') return await learningPatterns(ownerId,query)
      if (parts.length===2 && parts[0]==='patterns') return await learningDetail(ownerId,parts[1],query)
      if (parts.length===1 && parts[0]==='rows') return await learningRows(ownerId,query)
      if (parts.length===2 && parts[0]==='rows') return await learningRow(ownerId,parts[1])
    }
    if (event.method==='PUT' && parts.length===2 && ['patterns','policies'].includes(parts[0])) {
      let body:any; try { body=JSON.parse((await boundedBody(event,12000)).toString('utf8')) } catch(error:any) { if(error.statusCode) throw error; fail(400,'Invalid learning JSON') }
      return parts[0]==='policies' ? await savePolicyStatus(ownerId,parts[1],body) : await saveLearningDecision(ownerId,parts[1],body)
    }
    fail(404,'Learning endpoint not found')
  } catch(error:any) {
    if (error?.statusCode) throw error
    console.error('[Finance learning] request failed',error?.name || 'Error')
    fail(500,'Learning request failed')
  }
})

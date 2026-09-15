import {defineEventHandler,setHeader,getQuery} from 'h3'
import {financeUser,fail} from '../../services/financeService'
import {boundedBody} from '../../services/financeDraftService'
import {evaluationCandidates,evaluationList,evaluationRunDetail,queueEvaluation,saveEvaluationCase} from '../../services/financeEvaluationService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store');const owner=await financeUser(event)
 const parts=(event.path.split('?')[0].split('/api/finance-evaluation/')[1]||'').split('/').filter(Boolean)
 const body=async()=>{try{return JSON.parse((await boundedBody(event,50000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid evaluation request')}}
 if(event.method==='GET'&&parts.length===1&&parts[0]==='overview')return evaluationList(owner,getQuery(event).batchId as string|undefined)
 if(event.method==='GET'&&parts.length===1&&parts[0]==='candidates')return evaluationCandidates(owner)
 if(event.method==='GET'&&parts.length===2&&parts[0]==='runs')return evaluationRunDetail(owner,parts[1])
 if(event.method==='POST'&&parts.length===1&&parts[0]==='runs')return queueEvaluation(owner,await body())
 if(event.method==='POST'&&parts.length===4&&parts[0]==='imports'&&parts[2]==='cases'){const line=Number(parts[3]);if(!Number.isInteger(line)||line<2)fail(400,'Invalid line');return saveEvaluationCase(owner,parts[1],line,await body())}
 fail(404,'Evaluation endpoint not found')
})

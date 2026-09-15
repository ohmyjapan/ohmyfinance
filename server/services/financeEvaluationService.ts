import {randomUUID} from 'node:crypto'
import {FinanceEvaluationCase as Case,FinanceEvaluationRun as Run} from '../models/FinanceEvaluation'
import {FinanceChatAgent as Agent} from '../models/FinanceChat'
import {FinanceDraft} from '../models/FinanceDraft'
import {ready,fail,id} from './financeService'
import {readDraft,downloadDocument} from './financeDraftService'
import {digest} from '../../shared/amex.mjs'
import {validateSources,validateReport,parseRegistry,validateDiagnostic} from '../../shared/finance-research.mjs'
import {validateEvaluationCase,evaluationContext,scoreEvaluation,evaluationSummary} from '../../shared/finance-evaluation.mjs'
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)
async function init(){await ready();await Promise.all([Case.init(),Run.init()])}
const workerScope=(a:any)=>{if(a.researchEnabled!==true)fail(403,'Research capability required');return {ownerId:a.ownerId,accountId:{$in:a.accountIds}}}
const workerFilter=(a:any,runId:string,lease:any)=>({...workerScope(a),_id:id(runId),agentId:a._id,state:'working',lease:typeof lease==='string'?lease:'',leaseUntil:{$gt:new Date()}})
const binding=(d:any)=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash,importId:d.importId,line:d.line})
function bound(d:any,b:any){if(d.revision!==b?.revision||d.key!==b?.key||d.sourceHash!==b?.sourceHash||d.source.kind!=='expense')fail(409,'参照元の下書きが更新されています。内容を再確認してください。')}
export async function evaluationCandidates(ownerId:string){
 await init();const rows:any[]=await FinanceDraft.find({ownerId}).sort({updatedAt:-1}).limit(100).select('importId line').lean(),out=[]
 for(const r of rows){const d=await readDraft(ownerId,String(r.importId),r.line);if(d.source.kind==='expense')out.push({importId:String(r.importId),line:r.line,merchant:d.source.description,date:d.source.purchaseDate,account:d.source.account.name,confirmedFields:Object.keys(d.evidence).filter(k=>d.evidence[k].state==='confirmed'),documents:d.documents.length})}
 return {candidates:out}
}
export async function saveEvaluationCase(ownerId:string,importId:string,line:number,body:any){
 await init();const d=await readDraft(ownerId,importId,line);bound(d,body)
 let definition;try{definition=validateEvaluationCase(body,d)}catch(e:any){fail(400,e.message)}
 const query={ownerId,importId:id(importId),line},prior:any=await Case.findOne(query).lean()
 if((prior?.revision||0)!==body.caseRevision)fail(409,'評価ケースが更新されています。再読込してください。')
 if((prior?.history?.length||0)>=20)fail(409,'参照答えの変更履歴が上限に達しました。')
 if(!prior&&await Case.countDocuments({ownerId})>=100)fail(400,'評価ケースは100件までです。')
 const context=evaluationContext(d,definition);if(JSON.stringify(context).length>80000)fail(400,'評価資料が多すぎます。')
 const set={title:definition.title,definition,context,binding:binding(d),active:body.active!==false}
 let saved:any
 if(prior){saved=await Case.findOneAndUpdate({_id:prior._id,revision:body.caseRevision},{$set:set,$inc:{revision:1},$push:{history:{at:new Date(),revision:prior.revision,definition:prior.definition,binding:prior.binding}}},{new:true}).lean();if(!saved)fail(409,'評価ケースが更新されています。')}
 else{try{saved=(await Case.create({...query,accountId:d.source.account.id,...set})).toObject()}catch(e:any){if(e.code===11000)fail(409,'評価ケースが作成されています。');throw e}}
 return {case:saved}
}
export async function evaluationList(ownerId:string,batchId?:string){
 await init();if(batchId&&!uuid(batchId))fail(400,'Invalid evaluation batch')
 const cases=await Case.find({ownerId}).sort({createdAt:1}).lean()
 const recent:any[]=await Run.find({ownerId}).sort({createdAt:-1}).limit(120).select('batchId createdAt').lean()
 const batches=[...new Map(recent.map(r=>[r.batchId,{id:r.batchId,at:r.createdAt}])).values()].slice(0,10)
 const selected=batchId||batches[0]?.id||'',runs=selected?await Run.find({ownerId,batchId:selected}).sort({createdAt:1}).select('-sources -definition -binding -lease -agentId').lean():[]
 const connected=!!await Agent.exists({ownerId,researchEnabled:true,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}})
 return {cases,batches,batchId:selected,runs:runs.map((r:any)=>{const {context,...rest}=r;return {...rest,references:context.references}}),summary:evaluationSummary(runs),connected}
}
export async function evaluationRunDetail(ownerId:string,runId:string){
 await init();const run=await Run.findOne({_id:id(runId),ownerId}).select('-lease -agentId').lean();if(!run)fail(404,'Evaluation not found');return {run}
}
export async function queueEvaluation(ownerId:string,body:any){
 await init();if(!uuid(body.batchId)||!Array.isArray(body.cases)||!body.cases.length||body.cases.length>12||new Set(body.cases.map((c:any)=>c.id)).size!==body.cases.length)fail(400,'評価は1〜12件ずつ選択してください。')
 const selection=body.cases.map((c:any)=>({id:id(c.id),revision:c.revision})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),selectionHash=digest(JSON.stringify(selection))
 const existing:any[]=await Run.find({ownerId,batchId:body.batchId}).select('selectionHash caseId').lean()
 if(existing.some(r=>r.selectionHash!==selectionHash))fail(409,'評価の送信IDが使用済みです。')
 if(existing.length===selection.length)return evaluationList(ownerId,body.batchId)
 const active=await Run.countDocuments({ownerId,state:{$in:['queued','working']}})
 if(active+selection.length-existing.length>12)fail(409,'進行中の評価が完了してから追加してください。')
 const rows=[]
 for(const selected of selection){
  if(existing.some(r=>String(r.caseId)===selected.id))continue
  const c:any=await Case.findOne({_id:selected.id,ownerId,active:true,revision:selected.revision}).lean();if(!c)fail(409,'評価ケースを再確認してください。')
  const d=await readDraft(ownerId,String(c.importId),c.line);bound(d,c.binding)
  if(!await Agent.exists({ownerId,accountIds:c.accountId,researchEnabled:true,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}}))fail(409,'対象口座の調査担当に接続できません。')
  const text=JSON.stringify(c.context),source={id:'s0',kind:'context',title:'評価用の明細と提供情報（参照答えは非公開）',url:'',text,hash:digest(text),capturedAt:new Date().toISOString()}
  rows.push({ownerId,accountId:c.accountId,caseId:c._id,caseRevision:c.revision,batchId:body.batchId,selectionHash,title:c.title,definition:c.definition,context:c.context,binding:c.binding,sources:[source],events:[{at:new Date(),stage:'queued'}]})
 }
 try{await Run.insertMany(rows,{ordered:false})}catch(e:any){if(!e.writeErrors?.length||e.writeErrors.some((x:any)=>x.code!==11000))throw e}
 return evaluationList(ownerId,body.batchId)
}
export async function claimEvaluation(agent:any){
 await init();const scope=workerScope(agent)
 await Run.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed',failure:'worker_expired'},$unset:{lease:'',leaseUntil:''}})
 const r:any=await Run.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',agentId:agent._id,lease:randomUUID(),leaseUntil:new Date(Date.now()+600000)},$inc:{attempts:1}},{new:true,sort:{createdAt:1}}).lean()
 if(!r)return {job:null}
 // Never send title, definition, expected values, provenance notes or past results.
 return {job:{id:String(r._id),mode:'evaluation',lease:r.lease,context:r.context,sources:r.sources.slice(0,1),instruction:r.definition.instruction+'\nInvestigate only these requested fields: '+r.context.evaluationTargets.join(', ')+'. Keep already provided input values unchanged. Ask a question only if necessary to resolve these requested fields. All outputs are evaluation proposals.'}}
}
export async function evaluationProgress(agent:any,runId:string,body:any){
 if(!['researching','web','mail','document','registry','checking'].includes(body.stage))fail(400,'Invalid evaluation stage')
 const r=await Run.updateOne(workerFilter(agent,runId,body.lease),{$push:{events:{$each:[{at:new Date(),stage:body.stage}],$slice:-30}}});if(!r.matchedCount)fail(409,'Evaluation lease expired');return {success:true}
}
export async function evaluationDocument(agent:any,runId:string,body:any){
 const r:any=await Run.findOne(workerFilter(agent,runId,body.lease)).lean(),doc=r?.context.documents.find((d:any)=>d.id===body.documentId)
 if(!doc)fail(404,'Evaluation document not found')
 const result=await downloadDocument(String(agent.ownerId),doc.id);if(result.doc.hash!==doc.hash)fail(409,'Evaluation document changed');return result
}
export async function finishEvaluation(agent:any,runId:string,body:any){
 const filter=workerFilter(agent,runId,body.lease),r:any=await Run.findOne(filter).lean();if(!r)fail(409,'Evaluation lease expired')
 let report=null,sources=r.sources,score=null,runtime=null,diagnostic=null
 try{
 if(body.failed!==true||body.sources!==undefined){
  sources=validateSources(body.sources)
  if(sources[0]?.id!=='s0'||sources[0]?.kind!=='context'||sources[0]?.text!==r.sources[0].text||sources[0]?.hash!==r.sources[0].hash||sources.reduce((n:number,s:any)=>n+s.text.length,0)>400000||sources.some((s:any)=>digest(s.text)!==s.hash||Date.parse(s.capturedAt)>Date.now()||s.documentId&&!r.context.documents.some((d:any)=>d.id===s.documentId)))throw Error('Evidence changed')
 }
 if(body.failed!==true){
  report=validateReport(body.report,r.context,sources)
  if(body.registry){const s=sources.find((s:any)=>s.id===body.registry.sourceId&&s.kind==='registry');if(!s||s.url!=='https://web-api.invoice-kohyo.nta.go.jp/1/valid'||body.registry.date!==r.context.source.purchaseDate)throw Error('Registry evidence changed');parseRegistry(JSON.parse(s.text),body.registry.number,body.registry.date)}
  score=scoreEvaluation(r.definition,report,sources)
 }
 if(body.failed!==true||body.runtime!==undefined){
  const m=body.runtime;if(!m||!Array.isArray(m.models)||m.models.length>8||m.models.some((x:any)=>typeof x!=='string'||!/^[a-zA-Z0-9_.:[\]-]{1,100}$/.test(x))||!/^[a-f0-9]{64}$/.test(m.promptHash)||!/^[a-f0-9]{64}$/.test(m.implementationHash)||!Number.isFinite(m.durationMs)||m.durationMs<0||m.durationMs>600000)throw Error('Missing evaluation runtime')
  runtime={models:m.models,promptHash:m.promptHash,implementationHash:m.implementationHash,durationMs:m.durationMs}
 }
 if(body.failed===true&&body.diagnostic!==undefined)diagnostic=validateDiagnostic(body.diagnostic)
 }catch{fail(400,'評価結果の引用・項目・実行情報を検証できません。')}
 const saved=await Run.updateOne(filter,{$set:{state:report?'complete':'failed',report,sources,score,runtime,diagnostic,failure:report?'':'research_failed'},$unset:{lease:'',leaseUntil:''}})
 if(!saved.matchedCount)fail(409,'Evaluation changed');return {success:true}
}

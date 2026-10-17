// Intake (購入受付) research: the record's 店舗・商品URL goes through the existing research worker to find the seller's 会社名 and
// 登録番号 (T number), NTA-verified when the worker has the API id. Plan omf-intake-mapping-research-amended-20261017 §2 D.
// Copied from financeResearchService.ts (queue / claim / progress / finish / registry check) and financeEvaluationService.ts
// (owner-only agent check, failure field); the shared validators are reused unchanged. One row per record in
// `financeintakeresearch`; no Supplier, FinanceResearch, draft or ledger write — confirm writes only the record's
// values.supplierName / values.invoiceNumber with a history line.
// Recovery at read time, no new watcher: a queued row nobody claimed within LEASE_MS fails as not_claimed; a working row a full
// lease past its expiry (no worker re-claimed it) fails as worker_lost. Both settle in researchView and queueResearch by
// compare-and-set, so a late worker result meets 409 and a late claim finds nothing.
import {randomUUID} from 'node:crypto'
import {IntakeRecord,IntakeResearch as Research,initializeIntake} from '../models/FinanceIntake'
import {FinanceChatAgent as Agent} from '../models/FinanceChat'
import {ready,fail,id} from './financeService'
import {readRecord,intakeMarker,type IntakeOperation} from './financeIntakeService'
import {digest} from '../../shared/amex.mjs'
import {validateSources,validateReport,parseRegistry} from '../../shared/finance-research.mjs'
import {normalizeMerchant,emptyValues} from '../../shared/finance-draft.mjs'
const active=['queued','working']
// The worker lease (claimResearch / claimEvaluation): also the horizon after which a queued or expired row is given up.
const LEASE_MS=600000
const STALE='他の画面で更新されています。再読み込みしてください。'
const INSTRUCTION='このURLの販売者（運営会社）の会社名（法人名）と適格請求書発行事業者の登録番号（T+13桁）を調べてください。結果は supplier（shopName・legalName・invoiceNumber）に入れ、法人名と登録番号はページの記載を引用してください。登録番号は verify_invoice で照合してください。findings は空のままにしてください。'
const connectedFilter=(ownerId:string)=>({ownerId,researchEnabled:true,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}})
async function init(){await ready();await initializeIntake()}
async function ownedRecord(ownerId:string,recordId:string):Promise<any>{
 const record:any=await IntakeRecord.findOne({ownerId,_id:id(recordId)}).lean()
 if(!record)fail(404,'受付が見つかりません。')
 return record
}
const revisionOf=(body:any,record:any)=>{if(!Number.isSafeInteger(Number(body?.revision))||Number(body.revision)!==record.revision)fail(409,STALE);return record.revision as number}
const todayJst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const validDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
function workerScope(agent:any){if(agent.researchEnabled!==true)fail(403,'Research capability required');return {ownerId:agent.ownerId}}
const workerFilter=(agent:any,researchId:string,lease:any)=>({...workerScope(agent),_id:id(researchId),agentId:agent._id,state:'working',lease:typeof lease==='string'?lease:'',leaseUntil:{$gt:new Date()}})
// verified = the NTA row is active on the as-of date, carries the proposed number and the proposed legal name.
function verifiedOf(r:any){
 const supplier=r?.report?.supplier,registry=r?.registry
 return !!(supplier&&registry?.active&&registry.number===supplier.invoiceNumber&&normalizeMerchant(registry.legalName)===normalizeMerchant(supplier.legalName))
}
const expired=(at:any)=>!!at&&new Date(at).getTime()<=Date.now()-LEASE_MS
async function settleStuck(r:any){
 if(!r)return r
 const failure=r.state==='queued'&&expired(r.events?.[0]?.at)&&!await Agent.exists({...connectedFilter(r.ownerId),'researchStatus.intakeResearch':true})?'not_claimed':r.state==='working'&&expired(r.leaseUntil)?'worker_lost':''
 if(!failure)return r
 await Research.updateOne({_id:r._id,state:r.state,revision:r.revision},{$set:{state:'failed',failure},$unset:{lease:'',leaseUntil:'',agentId:''},$push:{events:{at:new Date(),stage:'expired'}},$inc:{revision:1}})
 return Research.findById(r._id).lean()
}
function visible(r:any){
 if(!r)return null
 return {id:String(r._id),revision:r.revision,state:r.state,failure:r.failure||'',instruction:r.instruction||'',report:r.report||null,sources:(r.sources||[]).map((s:any)=>({id:s.id,kind:s.kind,title:s.title,url:s.url||'',capturedAt:s.capturedAt,text:s.text})),registry:r.registry||null,verified:verifiedOf(r),events:r.events||[],attempts:r.attempts||0,confirmed:r.confirmed||null,history:(r.history||[]).map((h:any)=>({at:h.at,instruction:h.instruction,report:h.report||null,registry:h.registry||null,failure:h.failure||'',confirmed:h.confirmed||null})),updatedAt:r.updatedAt}
}
const stale=(r:any,record:any)=>!!r?.context&&r.state!=='confirmed'&&(r.context.recordRevision!==record.revision||r.context.merchantUrl!==(record.values?.merchantUrl||''))
export async function researchView(ownerId:string,recordId:string){
 await init();const record=await ownedRecord(ownerId,recordId)
 const r:any=await settleStuck(await Research.findOne({ownerId,recordId:record._id}).lean())
 const connected=!!await Agent.exists(connectedFilter(ownerId))
 const agent:any=await Agent.findOne({ownerId,researchEnabled:true,enabled:true,revokedAt:null}).sort({lastSeenAt:-1}).select('researchStatus').lean()
 return {research:visible(r),connected,settings:agent?.researchStatus||null,stale:stale(r,record)}
}
export async function queueResearch(ownerId:string,recordId:string,body:any,operation?:IntakeOperation|null){
 await init();const record=await ownedRecord(ownerId,recordId);revisionOf(body,record)
 const owner=body?.instruction===undefined?'':body.instruction
 if(typeof owner!=='string'||owner.length>2000||!/^[a-f0-9-]{36}$/.test(body?.requestId||''))fail(400,'調査内容を確認してください。')
 const v=record.values||{};let url:URL|null=null;try{url=new URL(v.merchantUrl||'')}catch{}
 if(!url||url.protocol!=='https:')fail(400,'URLを確認してください。')
 const instruction=INSTRUCTION+(owner.trim()?'\n'+owner.trim():'')
 let r:any=await settleStuck(await Research.findOne({ownerId,recordId:record._id}).lean())
 if(r?.requestId===body.requestId){if(r.instruction!==instruction)fail(409,'送信IDが使用済みです。');return researchView(ownerId,recordId)}
 if(r&&active.includes(r.state))fail(409,'調査が終わるまでお待ちください。')
 if((r?.revision||0)!==body.researchRevision)fail(409,'調査を再読込してください。')
 if((r?.history?.length||0)>=20)fail(409,'この受付の調査履歴は上限に達しました。')
 if(!await Agent.exists(connectedFilter(ownerId)))fail(409,'調査担当に接続できません。')
 if(!await Agent.exists({...connectedFilter(ownerId),'researchStatus.intakeResearch':true}))fail(409,'調査担当（intake対応）に接続できません。ワーカーの更新を確認してください。')
 if(await Research.countDocuments({ownerId,state:{$in:active}})>=3)fail(409,'進行中の調査が完了してから追加してください。')
 const purchaseDate=validDate(v.purchaseDate)?v.purchaseDate:todayJst(),merchant=normalizeMerchant(v.merchant||url!.hostname)
 const source={kind:'intake',purchaseDate,description:v.description||'',merchant,merchantUrl:v.merchantUrl,orderId:v.orderId||'',externalOrderId:v.externalOrderId||'',amount:v.amount||'',currency:v.currency||'',service:v.service||'',account:v.account||''}
 const context={kind:'intake',recordId:String(record._id),recordRevision:record.revision,merchantUrl:v.merchantUrl,merchant,source,values:emptyValues({purchaseDate,description:v.description||''}),references:{},documents:[],lessons:[]}
 const text=JSON.stringify({source,values:context.values,instruction})
 if(text.length>80000)fail(400,'調査資料が多すぎます。')
 const s0={id:'s0',kind:'context',title:'OMFに保存された受付内容',url:'',text,hash:digest(text),capturedAt:new Date().toISOString()}
 if(!r){try{r=(await Research.create({ownerId,recordId:record._id})).toObject()}catch(e:any){if(e.code===11000)fail(409,'調査が更新されました。');throw e}}
 const history=r.requestId||r.report||r.failure?[...(r.history||[]),{at:r.updatedAt,requestId:r.requestId,operation:r.operation||null,instruction:r.instruction,report:r.report||null,sources:r.sources,registry:r.registry||null,failure:r.failure||'',confirmed:r.confirmed||null}]:r.history||[]
 const updated=await Research.updateOne({_id:r._id,revision:body.researchRevision,state:{$nin:active}},{$set:{state:'queued',failure:'',requestId:body.requestId,operation:operation?{...operation,revision:body.researchRevision+1}:null,instruction,context,sources:[s0],report:null,registry:null,confirmed:null,attempts:0,events:[{at:new Date(),stage:'queued'}],history},$unset:{lease:'',leaseUntil:'',agentId:''},$inc:{revision:1}})
 if(!updated.matchedCount)fail(409,'調査が更新されました。');return researchView(ownerId,recordId)
}
export async function claimIntakeResearch(agent:any){
 await init();const scope=workerScope(agent)
 await Research.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed',failure:'worker_lost'},$unset:{lease:'',leaseUntil:'',agentId:''},$push:{events:{at:new Date(),stage:'expired'}},$inc:{revision:1}})
 const lease=randomUUID(),r:any=await Research.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',agentId:agent._id,lease,leaseUntil:new Date(Date.now()+LEASE_MS)},$inc:{revision:1,attempts:1}},{new:true,sort:{updatedAt:1}}).lean()
 return {job:r?{id:String(r._id),mode:'intake',lease,instruction:r.instruction,context:r.context,sources:r.sources.slice(0,1)}:null}
}
export async function intakeResearchProgress(agent:any,researchId:string,body:any){
 if(!['researching','web','mail','document','registry','checking'].includes(body?.stage))fail(400,'Invalid research stage')
 const r=await Research.updateOne(workerFilter(agent,researchId,body.lease),{$push:{events:{$each:[{at:new Date(),stage:body.stage}],$slice:-30}}})
 if(!r.matchedCount)fail(409,'Research job expired');return {success:true}
}
export async function finishIntakeResearch(agent:any,researchId:string,body:any){
 const filter=workerFilter(agent,researchId,body?.lease),r:any=await Research.findOne(filter).lean();if(!r)fail(409,'Research job expired')
 let report:any=null,sources=r.sources,registry:any=null
 if(body.failed!==true){
  try{
   sources=validateSources(body.sources)
   if(sources[0]?.id!=='s0'||sources[0]?.kind!=='context'||sources[0]?.text!==r.sources[0].text||sources[0]?.hash!==r.sources[0].hash||sources.reduce((n:number,s:any)=>n+s.text.length,0)>400000||sources.some((s:any)=>digest(s.text)!==s.hash||Date.parse(s.capturedAt)>Date.now()))throw Error('Captured evidence changed')
   report=validateReport(body.report,r.context,sources)
   if(body.registry){const s=sources.find((s:any)=>s.id===body.registry.sourceId&&s.kind==='registry');if(!s||s.url!=='https://web-api.invoice-kohyo.nta.go.jp/1/valid'||body.registry.date!==r.context.source.purchaseDate)throw Error('Invalid registry evidence');const parsed=parseRegistry(JSON.parse(s.text),body.registry.number,body.registry.date);registry={...parsed,checkedAt:s.capturedAt,sourceId:s.id,hash:s.hash};}
  }catch(e:any){fail(400,'調査の引用・項目・公的照合を検証できません。')}
 }
 const updated=await Research.updateOne(filter,{$set:{state:report?'ready':'failed',failure:report?'':'research_failed',report,sources,registry},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}})
 if(!updated.matchedCount)fail(409,'Research job changed');return {success:true}
}
// The owner confirms the displayed company and number into the record (values.supplierName / values.invoiceNumber, non-blank
// only), bound to the record revision the research saw and to the URL it researched; the research row becomes confirmed.
export async function confirmIntakeResearch(ownerId:string,recordId:string,body:any,operation?:IntakeOperation|null){
 await init();const record=await ownedRecord(ownerId,recordId)
 const r:any=await Research.findOne({ownerId,recordId:record._id}).lean()
 if(!r||r.state!=='ready'||!r.report?.supplier||r.revision!==body?.researchRevision||body?.confirm!==true)fail(409,'会社情報と根拠を確認してください。')
 const revision=revisionOf(body,record)
 if(r.context?.recordRevision!==record.revision||r.context?.merchantUrl!==(record.values?.merchantUrl||''))fail(409,'調査後に受付が変わりました。再調査してください。')
 const supplier=r.report.supplier,verified=verifiedOf(r),now=new Date().toISOString()
 const next:Record<string,string>={supplierName:supplier.legalName}
 if(supplier.invoiceNumber)next.invoiceNumber=supplier.invoiceNumber
 const changes=Object.entries(next).filter(([k,after])=>(record.values[k]||'')!==after).map(([k,after])=>({field:k,before:record.values[k]||'',after}))
 const saved=await IntakeRecord.updateOne({_id:record._id,ownerId,revision},{$set:{values:{...record.values,...next},revision:revision+1},$push:{history:{at:now,kind:'research',changes,source:null,researchId:String(r._id),verified,...intakeMarker(operation,revision+1)}}})
 if(!saved.matchedCount)fail(409,STALE)
 const finalized=await Research.updateOne({_id:r._id,ownerId,revision:r.revision},{$set:{state:'confirmed',confirmed:{at:now,supplierName:supplier.legalName,invoiceNumber:supplier.invoiceNumber||'',verified,...intakeMarker(operation,revision+1)}},$inc:{revision:1}})
 if(!finalized.matchedCount)fail(409,'受付への保存後に調査が更新されました。保存結果を確認してください。')
 return {...await researchView(ownerId,recordId),record:await readRecord(ownerId,recordId)}
}

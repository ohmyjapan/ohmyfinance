import { FinanceDraft } from '../models/FinanceDraft'
import { FinanceLearningDataset as Dataset, FinanceLearningLibrary as Library, FinanceLearningRow as Row, FinanceLearningPattern as Pattern, FinanceLearningPolicy as Policy } from '../models/FinanceLearning'
import mongoose from 'mongoose'
import { FinanceCustomerContext } from '../models/FinanceCustomerContext'
import { customerPurchaseContexts } from '../../shared/finance-customer-context.mjs'
import CustomerModel from '../models/Customer'
const Customer = CustomerModel as mongoose.Model<any>
import { fail, id } from './financeService'
import { norm, decisionInput } from '../../shared/finance-learning.mjs'
import { historicalAnswer, ruleAnswer, patternAnswer } from '../../shared/finance-answers.mjs'
export async function customerContextEvidence(ownerId:string,customerId?:string) {
 const [records,customers] = await Promise.all([
  FinanceCustomerContext.find({ownerId,kind:'purchase_workflow',status:'confirmed',...(customerId===undefined?{}:{customerId})}).select('-audit').sort({confirmedAt:-1}).limit(100).lean(),
  Customer.find({isActive:{$ne:false}}).select('name').lean()
 ])
 return customerPurchaseContexts(records,customers,customerId)
}
export async function learningDataset(ownerId:string):Promise<any> {
  const library:any = await Library.findOne({ownerId}).lean()
  return library?.datasetId ? await Dataset.findOne({_id:library.datasetId,ownerId,status:'ready'}).lean() : null
}
const pageNumber = (value:any) => { const n = Number(value || 1); if (!Number.isSafeInteger(n) || n<1 || n>100000) fail(400,'Invalid page'); return n }
const literal = (value:any) => { if (value !== undefined && (typeof value !== 'string' || value.length>120)) fail(400,'Search exceeds 120 characters'); return norm(value || '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&') }
// Confirmed conversation lessons live in the same atomic document as their draft update.
// A later correction withdraws the lesson; resuming requires the classification to still match.
export async function teachingPolicies(ownerId:string,query:any={}) {
 const drafts:any[]=await FinanceDraft.find({ownerId,'teachingMemory.id':{$exists:true},...query}).select('teachingMemory values.purpose values.customerId revision accountId importId line').sort({'teachingMemory.at':-1}).lean()
 return drafts.map(d=>{const m=d.teachingMemory;return {_id:d._id,kind:'teaching',revision:d.revision,title:m.merchantLabel,merchants:[m.merchant],accountIds:[d.accountId],accountName:m.accountName,decision:m.decision,effectiveFrom:m.effectiveFrom,reason:m.summary,sourceQuote:m.quote,status:m.enabled&&m.decision.purpose===d.values.purpose&&m.decision.customerId===d.values.customerId?'active':'deferred',importId:String(d.importId),line:d.line}})
}
export async function saveTeachingStatus(ownerId:string,draftId:string,body:any){
 if(!Number.isSafeInteger(body?.revision)||!['active','deferred'].includes(body?.status))fail(400,'Invalid lesson status')
 const draft:any=await FinanceDraft.findOne({_id:id(draftId),ownerId,'teachingMemory.id':{$exists:true}}).lean()
 if(!draft)fail(404,'Teaching lesson not found')
 const m=draft.teachingMemory
 if(body.status==='active'&&(m.decision.purpose!==draft.values.purpose||m.decision.customerId!==draft.values.customerId))fail(409,'元の下書きが修正されています。会話から新しい内容を確認してください。')
 if(draft.history.length>=500)fail(409,'変更履歴が上限に達しました。')
 const r=await FinanceDraft.updateOne({_id:draft._id,ownerId,revision:body.revision},{$set:{'teachingMemory.enabled':body.status==='active',approvedAt:null},$inc:{revision:1},$push:{history:{revision:body.revision+1,at:new Date(),action:'teaching_status',status:body.status,changes:[]}}})
 if(!r.matchedCount)fail(409,'下書きが更新されました。再読込してください。')
 return {success:true}
}
export async function learningOverview(ownerId:string) {
 const dataset=await learningDataset(ownerId),counts:any={},policies=[...await Policy.find({ownerId}).sort({createdAt:1}).lean(),...await teachingPolicies(ownerId)]
 if(dataset)for(const status of ['proposed','confirmed','deferred'])counts[status]=await Pattern.countDocuments({ownerId,datasetId:dataset._id,status})
 return {dataset,counts,customers:await Customer.find({isActive:true}).select('name').sort({name:1}).lean(),policies,customerPurchaseContexts:await customerContextEvidence(ownerId)}
}
export async function learningPatterns(ownerId:string,query:any) {
  const dataset = await learningDataset(ownerId), page = pageNumber(query.page)
  if (!dataset) return {items:[],total:0,page,datasetId:null}
  const filter:any = {ownerId,datasetId:dataset._id}, search = literal(query.q)
  if (search) filter.$or = [{merchant:{$regex:search}},{cards:{$regex:search,$options:'i'}},{'customers.label':{$regex:search,$options:'i'}}]
  if (query.status) { if (!['proposed','confirmed','deferred'].includes(query.status)) fail(400,'Invalid status'); filter.status=query.status }
  if (query.grade) { if (!['B','C','D'].includes(query.grade)) fail(400,'Invalid grade'); filter.grade=query.grade }
  const items:any[] = await Pattern.find(filter).select('-audit').sort({total:-1,key:1}).skip((page-1)*30).limit(30).lean()
  const policies:any[] = [...await Policy.find({ownerId,status:'active',merchants:{$in:items.map(p=>p.merchant)}}).lean(),...await teachingPolicies(ownerId,{'teachingMemory.merchant':{$in:items.map(p=>p.merchant)}})]
  const customers = (await Customer.find({isActive:true}).select('_id').lean()).map((c:any)=>String(c._id))
  return {items:items.map(p=>({...p,answer:patternAnswer(p,policies,customers)})),total:await Pattern.countDocuments(filter),page,datasetId:dataset._id}
}
async function ownedPattern(ownerId:string,patternId:string):Promise<any> {
  const pattern:any = await Pattern.findOne({_id:id(patternId),ownerId}).lean()
  if (!pattern) fail(404,'Learning pattern not found')
  return pattern
}
export async function learningDetail(ownerId:string,patternId:string,query:any) {
  const pattern = await ownedPattern(ownerId,patternId), page = pageNumber(query.page)
  const dataset:any = await Dataset.findOne({_id:pattern.datasetId,ownerId,status:'ready'}).lean()
  if (!dataset) fail(404,'Learning dataset unavailable')
  const policies:any[] = [...await Policy.find({ownerId,status:'active',merchants:pattern.merchant}).lean(),...await teachingPolicies(ownerId,{'teachingMemory.merchant':pattern.merchant})]
  const customers = (await Customer.find({isActive:true}).select('_id').lean()).map((c:any)=>String(c._id))
  pattern.answer = patternAnswer(pattern,policies,customers)
  const filter:any = {ownerId,datasetId:pattern.datasetId,patternKey:pattern.key}
  if (query.label !== undefined) { if (typeof query.label !== 'string' || query.label.length>300) fail(400,'Invalid customer label'); filter['parsed.customer']=query.label }
  return {pattern,dataset:{_id:dataset._id,title:dataset.title,sourceUrl:dataset.sourceUrl,primarySheet:dataset.primarySheet},items:await Row.find(filter).select('-cells').sort({date:-1,row:1}).skip((page-1)*30).limit(30).lean(),total:await Row.countDocuments(filter),page}
}
export async function learningRows(ownerId:string,query:any) {
  const dataset = await learningDataset(ownerId), page = pageNumber(query.page)
  if (!dataset) return {items:[],total:0,page}
  if (typeof query.sheet !== 'string' || !dataset.sheets.some((s:any)=>s.name===query.sheet)) fail(400,'Choose a source sheet')
  const filter:any = {ownerId,datasetId:dataset._id,sheet:query.sheet}
  if (query.row !== undefined && query.row !== '') { const row = Number(query.row); if (!Number.isSafeInteger(row) || row<1) fail(400,'Invalid source row'); filter.row=row }
  return {items:await Row.find(filter).select('-cells').sort({row:1}).skip((page-1)*30).limit(30).lean(),total:await Row.countDocuments(filter),page}
}
export async function learningRow(ownerId:string,rowId:string) {
  const row:any = await Row.findOne({_id:id(rowId),ownerId}).lean()
  if (!row) fail(404,'Source row not found')
  const dataset:any = await Dataset.findOne({_id:row.datasetId,ownerId,status:'ready'}).select('sourceUrl title').lean()
  if (!dataset) fail(404,'Source dataset unavailable')
  return {row,dataset}
}
export async function saveLearningDecision(ownerId:string,patternId:string,body:any) {
  let decision:any; try { decision=decisionInput(body) } catch(error:any) { fail(400,error.message) }
  const pattern = await ownedPattern(ownerId,patternId), dataset = await learningDataset(ownerId)
  if (!dataset || String(dataset._id)!==String(pattern.datasetId)) fail(409,'This dataset is no longer active; reload the learning page')
  if (decision.customerId && !await Customer.exists({_id:decision.customerId,isActive:true})) fail(400,'Customer is no longer active')
  const at = new Date(), revision=body.revision+1
  const updated = await Pattern.findOneAndUpdate({_id:pattern._id,ownerId,revision:body.revision},{$set:{status:decision.status,decision:{...decision,at},revision},$push:{audit:{revision,at,decision,previous:pattern.decision || null}}},{new:true}).lean()
  if (!updated) fail(409,'This rule changed; reload before saving')
  return {pattern:updated}
}
export async function savePolicyStatus(ownerId:string,policyId:string,body:any) {
  if(!Number.isSafeInteger(body?.revision)||!['active','deferred'].includes(body?.status)) fail(400,'Invalid policy status or revision')
  if(!await Policy.exists({_id:id(policyId),ownerId})) fail(404,'Learning instruction not found')
  const at=new Date()
  const policy=await Policy.findOneAndUpdate({_id:policyId,ownerId,revision:body.revision},{$set:{status:body.status},$inc:{revision:1},$push:{audit:{at,status:body.status,revision:body.revision+1,source:'web'}}},{new:true}).lean()
  if(!policy)fail(409,'This instruction changed; reload before saving')
  return {policy}
}
// Never use future/current source rows or archive copies to answer a purchase.
export async function learningEvidence(ownerId:string,accountId:string,merchant:string,before:string,amount?:number) {
  const dataset = await learningDataset(ownerId)
  const activeCustomers = new Set((await Customer.find({isActive:true}).select('_id').lean()).map((c:any)=>String(c._id)))
  const policies:any[] = [...await Policy.find({ownerId,status:'active',merchants:merchant,$or:[{accountIds:{$size:0}},{accountIds:accountId}]}).lean(),...(await teachingPolicies(ownerId,{accountId,'teachingMemory.merchant':merchant})).filter(p=>p.status==='active')]
  const policyRules=policies.filter(p=>(!p.effectiveFrom||p.effectiveFrom<=before)&&(p.decision.purpose!=='customer'||activeCustomers.has(p.decision.customerId))).map(p=>({id:String(p._id),kind:p.kind || 'policy',merchant,revision:p.revision,cards:[],decision:{...p.decision,note:p.reason,effectiveFrom:p.effectiveFrom || ''}}))
  const bound=dataset?.accountBindings.some((b:any)=>b.accountId===accountId)
  if(!bound && !policyRules.length)return null
  const rows:any[]=bound ? await Row.find({ownerId,datasetId:dataset._id,accountId,merchant,eligible:true,date:{$lt:before}}).select('-cells').sort({date:-1,row:1}).lean() : []
  const patterns:any[]=bound ? await Pattern.find({ownerId,datasetId:dataset._id,accountId,merchant}).select('-audit').lean() : []
  const history=rows.map(r=>({sheet:r.sheet,row:r.row,merchant:r.merchant,date:r.date,amount:r.parsed.amount,purpose:r.customerId&&!activeCustomers.has(r.customerId)?'unresolved':r.purpose,customerId:activeCustomers.has(r.customerId)?r.customerId:'',customerLabel:r.parsed.customer,category:r.parsed.category}))
  const blocked=patterns.some(p=>p.status==='deferred')
  const specific=patterns.length===1?patterns.filter(p=>p.status==='confirmed'&&p.decision.effectiveFrom<=before&&(p.decision.purpose!=='customer'||activeCustomers.has(p.decision.customerId))).map(p=>({id:String(p._id),kind:'pattern',merchant:p.merchantLabel,cards:p.cards,decision:p.decision,revision:p.revision})):[]
  // An explicit merchant/account exception takes priority over a broader instruction.
  const rules=blocked?[]:specific.length?specific:policyRules
  const answer=blocked?{blocked:true,reason:'この条件の判断を保留しています。'}:ruleAnswer(rules) || (patterns.length<=1?historicalAnswer(history,amount):null)
  return {datasetId:dataset?String(dataset._id):null,history:bound?history:null,rules,answer}
}

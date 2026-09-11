import { FinanceLearningDataset as Dataset, FinanceLearningLibrary as Library, FinanceLearningRow as Row, FinanceLearningPattern as Pattern } from '../models/FinanceLearning'
import Customer from '../models/Customer'
import { fail, id } from './financeService'
import { norm, decisionInput } from '../../shared/finance-learning.mjs'
export async function learningDataset(ownerId:string):Promise<any> {
  const library:any = await Library.findOne({ownerId}).lean()
  return library?.datasetId ? await Dataset.findOne({_id:library.datasetId,ownerId,status:'ready'}).lean() : null
}
const pageNumber = (value:any) => { const n = Number(value || 1); if (!Number.isSafeInteger(n) || n<1 || n>100000) fail(400,'Invalid page'); return n }
const literal = (value:any) => { if (value !== undefined && (typeof value !== 'string' || value.length>120)) fail(400,'Search exceeds 120 characters'); return norm(value || '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&') }
export async function learningOverview(ownerId:string) {
  const dataset = await learningDataset(ownerId)
  if (!dataset) return {dataset:null,counts:{},customers:[]}
  const counts:any = {}
  for (const status of ['proposed','confirmed','deferred']) counts[status] = await Pattern.countDocuments({ownerId,datasetId:dataset._id,status})
  return {dataset,counts,customers:await Customer.find({isActive:true}).select('name').sort({name:1}).lean()}
}
export async function learningPatterns(ownerId:string,query:any) {
  const dataset = await learningDataset(ownerId), page = pageNumber(query.page)
  if (!dataset) return {items:[],total:0,page,datasetId:null}
  const filter:any = {ownerId,datasetId:dataset._id}, search = literal(query.q)
  if (search) filter.$or = [{merchant:{$regex:search}},{cards:{$regex:search,$options:'i'}},{'customers.label':{$regex:search,$options:'i'}}]
  if (query.status) { if (!['proposed','confirmed','deferred'].includes(query.status)) fail(400,'Invalid status'); filter.status=query.status }
  if (query.grade) { if (!['B','C','D'].includes(query.grade)) fail(400,'Invalid grade'); filter.grade=query.grade }
  return {items:await Pattern.find(filter).select('-audit').sort({total:-1,key:1}).skip((page-1)*30).limit(30).lean(),total:await Pattern.countDocuments(filter),page,datasetId:dataset._id}
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
// Full primary-sheet history replaces the legacy subset for explicitly bound accounts.
// All source fields stay in Row; only the established purchase-study fields leave this adapter.
export async function learningEvidence(ownerId:string,accountId:string,merchant:string,before:string) {
  const dataset = await learningDataset(ownerId)
  if (!dataset || !dataset.accountBindings.some((b:any)=>b.accountId===accountId)) return null
  const activeCustomers = new Set((await Customer.find({isActive:true}).select('_id').lean()).map((c:any)=>String(c._id)))
  const rows:any[] = await Row.find({ownerId,datasetId:dataset._id,accountId,merchant,eligible:true,date:{$lt:before}}).select('-cells').sort({date:-1,row:1}).lean()
  const patterns:any[] = await Pattern.find({ownerId,datasetId:dataset._id,accountId,merchant,status:'confirmed','decision.effectiveFrom':{$lte:before}}).select('-audit').lean()
  // Multiple payment scopes for one account/descriptor need a transaction-level decision.
  const scopeCount = await Pattern.countDocuments({ownerId,datasetId:dataset._id,accountId,merchant})
  return {datasetId:String(dataset._id),history:rows.map(r=>({sheet:r.sheet,row:r.row,merchant:r.merchant,date:r.date,amount:r.parsed.amount,purpose:r.customerId && !activeCustomers.has(r.customerId)?'unresolved':r.purpose,customerId:activeCustomers.has(r.customerId)?r.customerId:'',customerLabel:r.parsed.customer,category:r.parsed.category})),rules:scopeCount===1 ? patterns.filter(p=>p.decision.purpose!=='customer'||activeCustomers.has(p.decision.customerId)).map(p=>({id:String(p._id),merchant:p.merchantLabel,cards:p.cards,decision:p.decision,revision:p.revision})) : []}
}

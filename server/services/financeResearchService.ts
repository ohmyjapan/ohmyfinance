import {randomUUID} from 'node:crypto'
import mongoose from 'mongoose'
import {FinanceResearch as Research} from '../models/FinanceResearch'
import {FinanceChatAgent as Agent} from '../models/FinanceChat'
import {FinanceDraft,FinanceDocument} from '../models/FinanceDraft'
import SupplierModel from '../models/Supplier'
import {ready,fail,id,ownedImport} from './financeService'
import {readDraft,saveDraft,downloadDocument} from './financeDraftService'
import {reviewContext} from './financeReviewService'
import {inventoryPreview} from './financeInventoryReviewService'
import {readMerchantLink,saveMerchantLink,supplierReferences} from './financeSupplierService'
import {consultationEvidence} from '../../shared/finance-consultation.mjs'
import {validateSources,validateReport,parseRegistry} from '../../shared/finance-research.mjs'
import {normalizeMerchant,validateValues} from '../../shared/finance-draft.mjs'
import {digest} from '../../shared/amex.mjs'
const Supplier=SupplierModel as mongoose.Model<any>
const active=['queued','working','applying']
const fingerprint=(v:any)=>digest(JSON.stringify(v))
const scope=(ownerId:string,importId:string,line:number)=>({ownerId,importId:id(importId),line})
async function init(){await ready();await Research.init()}
function binding(d:any,b:any){if(d.revision!==b?.revision||d.key!==b?.key||d.sourceHash!==b?.sourceHash)fail(409,'下書きが更新されています。再読込してください。');if(d.locked||d.source.kind!=='expense')fail(409,'この明細は調査・変更できません。')}
function workerScope(agent:any){if(agent.researchEnabled!==true)fail(403,'Research capability required');return {ownerId:agent.ownerId,accountId:{$in:agent.accountIds}}}
const workerFilter=(agent:any,researchId:string,lease:any)=>({...workerScope(agent),_id:id(researchId),agentId:agent._id,state:'working',lease:typeof lease==='string'?lease:'',leaseUntil:{$gt:new Date()}})
function visible(r:any){if(!r)return null;return {id:String(r._id),revision:r.revision,state:r.state,instruction:r.instruction,report:r.report||null,sources:r.sources||[],artifacts:(r.artifacts||[]).filter((a:any)=>a.requestId===r.requestId),registry:r.registry||null,events:r.events||[],applied:r.applied||null,supplierId:r.supplierId?String(r.supplierId):'',history:(r.history||[]).map((h:any)=>({at:h.at,instruction:h.instruction,report:h.report,applied:h.applied})),updatedAt:r.updatedAt}}
export async function researchView(ownerId:string,importId:string,line:number){
 await init();const draft=await readDraft(ownerId,importId,line);let r:any=await Research.findOne(scope(ownerId,importId,line)).lean()
 if(r?.state==='applying'&&r.leaseUntil<=new Date()){const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).select('history').lean();const accepted=saved?.history.find((h:any)=>h.reviewId===String(r._id)&&h.channel==='research'&&h.replyTs.startsWith(r.requestId+':'));const applied=accepted?{fields:accepted.fields,values:Object.fromEntries(r.report.findings.filter((f:any)=>accepted.fields.includes(f.field)).map((f:any)=>[f.field,f.value])),at:accepted.at}:null;await Research.updateOne({_id:r._id,state:'applying',lease:r.lease},{$set:{state:applied?'applied':'ready',applied},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}});r=await Research.findById(r._id).lean()}
 const connected=!!await Agent.exists({ownerId,accountIds:draft.source.account.id,researchEnabled:true,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}})
 const agent:any=await Agent.findOne({ownerId,accountIds:draft.source.account.id,researchEnabled:true,enabled:true,revokedAt:null}).select('researchStatus').lean()
 return {research:visible(r),connected,settings:agent?.researchStatus||null,stale:!!r?.context&&(r.context.key!==draft.key||r.context.sourceHash!==draft.sourceHash||r.context.fingerprint!==fingerprint(draft.values)||r.context.revision!==draft.revision)}
}
export async function queueResearch(ownerId:string,importId:string,line:number,body:any){
 await init();const {draft:d,study}=await reviewContext(ownerId,importId,line);binding(d,body)
 if(typeof body.instruction!=='string'||body.instruction.length>2000||!/^[a-f0-9-]{36}$/.test(body.requestId||''))fail(400,'調査内容を確認してください。')
 const query=scope(ownerId,importId,line);let r:any=await Research.findOne(query).lean()
 if(r?.requestId===body.requestId){if(r.instruction!==body.instruction.trim())fail(409,'送信IDが使用済みです。');return researchView(ownerId,importId,line)}
 if(r&&active.includes(r.state))fail(409,'調査が終わるまでお待ちください。')
 if((r?.revision||0)!==body.researchRevision)fail(409,'調査を再読込してください。')
 if((r?.history?.length||0)>=20)fail(409,'この明細の調査履歴は上限に達しました。保存済みの根拠を確認してください。')
 if(!await Agent.exists({ownerId,accountIds:d.source.account.id,researchEnabled:true,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}}))fail(409,'調査担当に接続できません。')
 if(await Research.countDocuments({ownerId,state:{$in:active}})>=3)fail(409,'進行中の調査が完了してから追加してください。')
 const references=Object.fromEntries(Object.entries(d.references).map(([k,rows]:any)=>[k,rows.map((v:any)=>({_id:String(v._id),name:v.name,parentId:v.parentId?String(v.parentId):null,companyName:v.companyName,serviceName:v.serviceName,invoiceNumber:v.invoiceNumber,registration:v.registration}))]))
 const inventory=await inventoryPreview(ownerId,[importId],line),supplier=await readMerchantLink(ownerId,importId,line)
 const prior:any[]=await Research.find({ownerId,accountId:d.source.account.id,'context.merchant':normalizeMerchant(d.source.description),state:'applied'}).sort({updatedAt:-1}).limit(5).lean()
 const lessons=[]
 for(const p of prior){const current:any=await FinanceDraft.findOne({ownerId,importId:p.importId,line:p.line}).select('values').lean();if(current&&p.applied?.fields?.every((k:string)=>fingerprint(current.values[k])===fingerprint(p.applied.values[k])))lessons.push({date:p.context.source.purchaseDate,values:p.applied.values,summary:p.report.summary,scope:'same account and merchant; this purchase still needs evidence'})}
 const context={revision:d.revision,key:d.key,sourceHash:d.sourceHash,fingerprint:fingerprint(d.values),merchant:normalizeMerchant(d.source.description),source:d.source,values:d.values,references,mapping:consultationEvidence(d),study,inventory,supplier,lessons,documents:d.documents.map((v:any)=>({id:v.id,name:v.name,hash:v.hash,mimeType:v.mimeType}))}
 const text=JSON.stringify({source:context.source,values:context.values,references,mapping:context.mapping,study,inventory,supplier,lessons,instruction:body.instruction.trim()})
 if(text.length>80000)fail(400,'調査資料が多すぎます。対象を絞ってください。')
 const source={id:'s0',kind:'context',title:'OMFに保存された明細・履歴・判断',url:'',text,hash:digest(text),capturedAt:new Date().toISOString()}
 if(!r){try{r=(await Research.create({...query,accountId:d.source.account.id})).toObject()}catch(e:any){if(e.code===11000)fail(409,'調査が更新されました。');throw e}}
 const history=r.report?[...(r.history||[]),{at:r.updatedAt,instruction:r.instruction,report:r.report,sources:r.sources,registry:r.registry,applied:r.applied}]:r.history||[]
 const updated=await Research.updateOne({_id:r._id,revision:body.researchRevision,state:{$nin:active}},{$set:{state:'queued',requestId:body.requestId,instruction:body.instruction.trim(),context,sources:[source],report:null,registry:null,applied:null,supplierId:null,attempts:0,events:[{at:new Date(),stage:'queued'}],history},$unset:{lease:'',leaseUntil:'',agentId:''},$inc:{revision:1}})
 if(!updated.matchedCount)fail(409,'調査が更新されました。');return researchView(ownerId,importId,line)
}
export async function claimResearch(agent:any){
 await init();const filter=workerScope(agent)
 await Research.updateMany({...filter,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed'},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}})
 const lease=randomUUID(),r:any=await Research.findOneAndUpdate({...filter,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',agentId:agent._id,lease,leaseUntil:new Date(Date.now()+600000)},$inc:{revision:1,attempts:1}},{new:true,sort:{updatedAt:1}}).lean()
 return {job:r?{id:String(r._id),lease,instruction:r.instruction,context:r.context,sources:r.sources.slice(0,1)}:null}
}
export async function researchProgress(agent:any,researchId:string,body:any){
 if(!['researching','web','mail','document','registry','checking'].includes(body?.stage))fail(400,'Invalid research stage')
 const r=await Research.updateOne(workerFilter(agent,researchId,body.lease),{$push:{events:{$each:[{at:new Date(),stage:body.stage}],$slice:-30}}})
 if(!r.matchedCount)fail(409,'Research job expired');return {success:true}
}
export async function researchDocument(agent:any,researchId:string,body:any){
 const r:any=await Research.findOne(workerFilter(agent,researchId,body?.lease)).lean();if(!r||!r.context.documents.some((d:any)=>d.id===body.documentId))fail(404,'Research document not found')
 return downloadDocument(String(agent.ownerId),id(body.documentId))
}
export async function finishResearch(agent:any,researchId:string,body:any){
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
 const updated=await Research.updateOne(filter,{$set:{state:report?'ready':'failed',report,sources,registry},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}})
 if(!updated.matchedCount)fail(409,'Research job changed');return {success:true}
}
export async function applyResearch(ownerId:string,importId:string,line:number,body:any){
 await init();const r:any=await Research.findOne(scope(ownerId,importId,line)).lean();if(!r?.report)fail(409,'調査結果を確認してください。')
 if(!Array.isArray(body.fields)||!body.fields.length||new Set(body.fields).size!==body.fields.length||typeof body.confirm!=='boolean'||!body.confirm)fail(400,'反映する項目を選択してください。')
 const findings=r.report.findings.filter((f:any)=>body.fields.includes(f.field));if(findings.length!==body.fields.length)fail(400,'調査した項目だけを選択してください。')
 const selected=Object.fromEntries(findings.map((f:any)=>[f.field,f.value])),replyTs=r.requestId+':'+fingerprint(body.fields.slice().sort())
 const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).select('history').lean()
 const already=saved?.history.some((h:any)=>h.reviewId===String(r._id)&&h.replyTs===replyTs&&h.channel==='research')
 if(!already){
  const d=await readDraft(ownerId,importId,line);binding(d,body)
  if(r.state!=='ready'||r.revision!==body.researchRevision||(r.context.fingerprint!==fingerprint(d.values)||r.context.key!==d.key||r.context.sourceHash!==d.sourceHash||r.context.revision!==d.revision))fail(409,'調査後に下書きが変わりました。再調査してください。')
  const lease=randomUUID(),locked=await Research.updateOne({_id:r._id,state:'ready',revision:r.revision},{$set:{state:'applying',lease,leaseUntil:new Date(Date.now()+60000)}});if(!locked.matchedCount)fail(409,'反映処理が進行中です。')
  try{await saveDraft(ownerId,importId,line,{revision:d.revision,key:d.key,sourceHash:d.sourceHash,values:validateValues({...d.values,...selected}),confirm:false,remember:[]},{reviewId:String(r._id),replyTs,text:r.instruction,summary:r.report.summary,fields:body.fields,reusable:false,channel:'research',researchEvidence:findings})}
  catch(e){await Research.updateOne({_id:r._id,lease},{$set:{state:'ready'},$unset:{lease:'',leaseUntil:''}});throw e}
 }
 await Research.updateOne({_id:r._id,requestId:r.requestId},{$set:{state:'applied',applied:{fields:body.fields,values:selected,at:new Date()}},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}})
 return {draft:await readDraft(ownerId,importId,line),...await researchView(ownerId,importId,line)}
}
export async function saveResearchSupplier(ownerId:string,importId:string,line:number,body:any){
 await init();const r:any=await Research.findOne(scope(ownerId,importId,line)).lean(),d=await readDraft(ownerId,importId,line);binding(d,body)
 if(!r?.report?.supplier||!['ready','applied'].includes(r.state)||r.revision!==body.researchRevision||body.confirm!==true||typeof body.remember!=='boolean')fail(409,'会社情報と根拠を確認してください。')
 if(r.context.key!==d.key||r.context.sourceHash!==d.sourceHash)fail(409,'元のカード明細が変更されています。再調査してください。')
 const p=r.report.supplier,registry=r.registry,source=registry?r.sources.find((s:any)=>s.id===registry.sourceId):null
 const verified=registry?.active&&registry.number===p.invoiceNumber&&normalizeMerchant(registry.legalName)===normalizeMerchant(p.legalName)
 let supplier:any=await Supplier.findOne({companyName:p.legalName,invoiceNumber:p.invoiceNumber}).lean()
 if(!supplier){
  if(await Supplier.exists({$or:[{name:p.shopName},{serviceName:p.shopName},...(p.invoiceNumber?[{invoiceNumber:p.invoiceNumber}]:[])]}))fail(409,'同名・同番号の仕入れ先があります。仕入れ先の確認・記憶から照合してください。')
  const supplierId=new mongoose.Types.ObjectId(digest('research-supplier:'+ownerId+':'+p.legalName+':'+p.invoiceNumber).slice(0,24))
  const invoiceVerification=verified?{version:2,source:'nta_api',method:'api_valid_date',scope:'issuer_registration_only',status:'active_at_check',number:registry.number,legalName:registry.legalName,registeredAddress:registry.registeredAddress,registeredFrom:registry.registeredFrom,asOf:registry.asOf,checkedAt:registry.checkedAt,sourceUrl:'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo='+registry.number.slice(1),evidence:{text:source.text,sha256:source.hash}}:undefined
  try{supplier=(await Supplier.create({_id:supplierId,name:p.shopName,serviceName:p.shopName,companyName:p.legalName,companyInfo:p.legalName,invoiceNumber:p.invoiceNumber,metadata:{...(invoiceVerification?{invoiceVerification}:{}),research:{ownerId,researchId:String(r._id),sourceHash:d.sourceHash,citations:p.citations,confirmedAt:new Date()}}})).toObject()}catch(e:any){if(e.code===11000)supplier=await Supplier.findById(supplierId).lean();else throw e}
 }
 if(body.remember){
  const link=await readMerchantLink(ownerId,importId,line),reference=(await supplierReferences()).find(s=>String(s._id)===String(supplier._id))
  if(link.link?.enabled&&link.link.supplierId!==String(supplier._id))fail(409,'既存の仕入れ先の記憶と異なります。対応を確認してください。')
  await saveMerchantLink(ownerId,importId,line,{sourceHash:d.sourceHash,key:d.key,revision:link.revision,enabled:true,confirmed:true,supplierId:String(supplier._id),supplierKey:reference!.identityKey,reason:'調査の引用を確認して仕入れ先との対応を保存しました。',sourceUrl:r.sources.find((s:any)=>p.citations.some((c:any)=>c.sourceId===s.id)&&s.kind==='web')?.url||''})
 }
 await Research.updateOne({_id:r._id,revision:r.revision},{$set:{supplierId:supplier._id},$inc:{revision:1}})
 return {supplierId:String(supplier._id),draft:await readDraft(ownerId,importId,line),...await researchView(ownerId,importId,line)}
}

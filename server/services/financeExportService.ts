import {mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {FinanceExport as Export,FinanceUnitOutcome as Outcome,FinanceExportUpload as Upload} from '../models/FinanceExport'
import {FinancePurchaseLink as Purchase} from '../models/FinancePurchaseLink'
import {FinanceDocument} from '../models/FinanceDraft'
import {downloadDocument} from './financeDraftService'
import {purchaseOriginal} from './financePurchaseLinkService'
import {withPurchaseGraph} from './financePurchaseGraphService'
import {fail,id,ready} from './financeService'
import {digest} from '../../shared/amex.mjs'
import {purchaseItemKey,purchaseExportProgress,exportDocumentsComplete} from '../../shared/finance-export.mjs'
const date=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
const text=(v:any,max=120)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f]/.test(v)
const tracking=(v:string)=>v.replace(/[\s-]/g,'').toUpperCase()
const filePath=(owner:string,hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash))fail(400,'Invalid document');return path.join(process.env.OMF_DATA_DIR||path.join(os.homedir(),'.ohmyfinance'),'export-documents',id(owner),hash)}
async function init(){await ready();await Export.init();await Outcome.init();await Upload.init()}
async function ownedPurchase(owner:string,purchaseId:string){const p:any=await Purchase.findOne({_id:id(purchaseId),ownerId:owner}).lean();if(!p)fail(404,'購入の接続が見つかりません。');return p}
const visible=(r:any)=>({...r,id:String(r._id),_id:undefined,ownerId:undefined,history:(r.history||[]).map((h:any)=>({action:h.action,at:h.at})),documentsComplete:exportDocumentsComplete(r)})
export async function purchaseExports(owner:string,purchaseId:string){
 await init();const purchase=await ownedPurchase(owner,purchaseId)
 const exports:any[]=await Export.find({ownerId:owner,'allocations.purchaseId':purchaseId,status:'active'}).sort({shippedAt:1}).lean()
 const outcomes:any[]=await Outcome.find({ownerId:owner,purchaseId:purchase._id,status:'active'}).lean()
 const outcomeRevisions:any[]=await Outcome.find({ownerId:owner,inventoryId:{$in:purchase.inventoryIds}}).select('inventoryId revision').lean()
 for(const record of [...exports,...outcomes]){
  record.documentIntegrity=true
  for(const doc of record.documents){try{const bytes=await readFile(filePath(owner,doc.hash));if(digest(bytes)!==doc.hash||bytes.length!==doc.size)record.documentIntegrity=false}catch{record.documentIntegrity=false}}
 }
 const docs:any[]=await FinanceDocument.find({ownerId:owner,importId:purchase.importId,line:purchase.line}).select('name hash mimeType size kind').lean()
 const uploads:any[]=await Upload.find({ownerId:owner,purchaseId:purchase._id}).select('name hash mimeType size').lean()
 purchase.evidenceComplete=purchase.originals.length>0&&purchase.payment?.amount===purchase.order.total
 if(purchase.evidenceComplete)for(const original of purchase.originals){try{await purchaseOriginal(owner,purchaseId,original.hash)}catch{purchase.evidenceComplete=false;break}}
 return {purchaseId,linkRevision:purchase.revision,active:purchase.status==='linked',progress:purchaseExportProgress(purchase,exports,outcomes),exports:exports.map(visible),outcomes:outcomes.map(visible),outcomeRevisions:Object.fromEntries(outcomeRevisions.map(o=>[o.inventoryId,o.revision])),documents:[...docs.map(d=>({id:String(d._id),name:d.name,hash:d.hash,mimeType:d.mimeType,kind:d.kind,url:'/api/finance/documents/'+d._id+'/file'})),...uploads.map(d=>({id:String(d._id),name:d.name,hash:d.hash,mimeType:d.mimeType,kind:'shipping',upload:true,url:'/api/finance-exports/uploads/'+d._id}))]}
}
export async function uploadedExportOriginal(owner:string,uploadId:string){
 await init();const doc:any=await Upload.findOne({_id:id(uploadId),ownerId:owner}).lean();if(!doc)fail(404,'資料が見つかりません。')
 const bytes=await readFile(filePath(owner,doc.hash));if(digest(bytes)!==doc.hash||bytes.length!==doc.size)fail(409,'保管資料の整合性を確認できません。');return {bytes,doc}
}
export async function uploadExportDocument(owner:string,purchaseId:string,name:any,bytes:Buffer,mimeType:string){
 await init();const p=await ownedPurchase(owner,purchaseId);if(p.status!=='linked')fail(409,'先に購入を接続してください。')
 if(!text(name,180)||!name.trim()||/[/\\]/.test(name)||mimeType!=='application/pdf'||bytes.length>10485760||bytes.subarray(0,5).toString()!=='%PDF-')fail(400,'10MB以内のPDFを選択してください。')
 const hash=digest(bytes),target=filePath(owner,hash);await mkdir(path.dirname(target),{recursive:true})
 try{await writeFile(target,bytes,{flag:'wx'})}catch(e:any){if(e.code!=='EEXIST')throw e;if(digest(await readFile(target))!==hash)fail(409,'保存済みPDFの整合性を確認できません。')}
 try{await Upload.updateOne({ownerId:owner,purchaseId:p._id,hash},{$setOnInsert:{name:name.trim(),mimeType,size:bytes.length}},{upsert:true})}catch(e:any){if(e.code!==11000)throw e}
 return purchaseExports(owner,purchaseId)
}
export async function findExport(owner:string,account:any,order:any){
 await init();if(!text(account)||!text(order))fail(400,'Intrasの口座と注文番号を入力してください。')
 const r:any=await Export.findOne({ownerId:owner,provider:'intras',providerAccount:account.trim().toLowerCase(),orderId:order.trim().toUpperCase()}).lean()
 return {record:r?visible(r):null}
}
async function preserveDocuments(owner:string,inputs:any[],old:any,allowed:string[]){
 if(!Array.isArray(inputs)||inputs.length>allowed.length||inputs.some(d=>!d||typeof d!=='object'||Array.isArray(d))||new Set(inputs.map(d=>d.kind)).size!==inputs.length)fail(400,'書類の種類を確認してください。')
 const result=[]
 for(const input of inputs){
  if(!input||Object.keys(input).some(k=>!['kind','sourceDocumentId','uploadId','hash'].includes(k))||input.sourceDocumentId&&input.uploadId||!allowed.includes(input.kind)||!/^[a-f0-9]{64}$/.test(input.hash))fail(400,'書類を選択してください。')
  let bytes:Buffer,document:any
  if(input.uploadId){
   const source:any=await Upload.findOne({_id:id(input.uploadId),ownerId:owner,hash:input.hash}).lean();if(!source)fail(404,'アップロード資料が見つかりません。')
   bytes=await readFile(filePath(owner,input.hash));document={kind:input.kind,hash:input.hash,name:source.name,mimeType:source.mimeType,size:source.size,uploadId:input.uploadId}
  }else if(input.sourceDocumentId){
   const source=await downloadDocument(owner,id(input.sourceDocumentId));bytes=source.bytes
   if(source.doc.hash!==input.hash||allowed.includes('invoice')&&(source.doc.kind!=='shipping'||source.doc.mimeType!=='application/pdf'))fail(409,'発送資料のPDFを選択してください。')
   document={kind:input.kind,hash:input.hash,name:source.doc.name,mimeType:source.doc.mimeType,size:bytes.length,sourceDocumentId:input.sourceDocumentId}
  }else{
   document=old?.documents.find((d:any)=>d.kind===input.kind&&d.hash===input.hash);if(!document)fail(400,'保管済み書類が見つかりません。')
   bytes=await readFile(filePath(owner,input.hash))
  }
  if(digest(bytes)!==input.hash||bytes.length!==document.size)fail(409,'原本の整合性を確認できません。')
  const target=filePath(owner,input.hash);await mkdir(path.dirname(target),{recursive:true})
  try{await writeFile(target,bytes,{flag:'wx'})}catch(e:any){if(e.code!=='EEXIST')throw e;if(digest(await readFile(target))!==input.hash)fail(409,'保管済み原本の整合性を確認できません。')}
  result.push(document)
 }
 if(allowed.includes('invoice')&&result.length===2&&result[0].hash===result[1].hash)fail(400,'Invoiceと輸出許可書には別々の書類を選択してください。')
 return result
}
export async function saveExport(owner:string,body:any){
 await init()
 const keys=['id','revision','providerAccount','orderId','applicationId','tracking','shippedAt','itemCount','declaredAmount','permitNumber','permitDate','allocations','documents','confirm','confirmDocuments']
 if(!body||Object.keys(body).some(k=>!keys.includes(k))||body.confirm!==true||typeof body.confirmDocuments!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<0||
 !text(body.providerAccount)||!body.providerAccount.trim()||!text(body.orderId)||!body.orderId.trim()||!text(body.applicationId)||!text(body.tracking)||!tracking(body.tracking)||!date(body.shippedAt)||
 !Number.isSafeInteger(body.itemCount)||body.itemCount<1||body.itemCount>1000||!Number.isSafeInteger(body.declaredAmount)||body.declaredAmount<0||body.declaredAmount>1e12||
 !text(body.permitNumber)||body.permitDate!==''&&!date(body.permitDate)||!Array.isArray(body.allocations)||!body.allocations.length||body.allocations.length>body.itemCount)fail(400,'出荷情報・商品数・お客様の申告額を確認してください。')
 return withPurchaseGraph(owner,async check=>{
  const old:any=body.id?await Export.findOne({_id:id(body.id),ownerId:owner}).lean():null
  if(body.id&&!old)fail(404,'出荷が見つかりません。')
  if((old?.revision||0)!==body.revision)fail(409,'出荷が更新されています。再読込してください。')
  if((old?.history?.length||0)>=100)fail(409,'出荷の変更履歴が上限に達しました。')
  const providerAccount=body.providerAccount.trim().toLowerCase(),orderId=body.orderId.trim().toUpperCase()
  if(old&&(old.providerAccount!==providerAccount||old.orderId!==orderId))fail(400,'既存の出荷番号・口座は変更できません。割当を解除して正しい出荷を登録してください。')
  const allocations=[],ids=new Set<string>()
  for(const a of body.allocations){
   if(!a||Object.keys(a).some(k=>!['purchaseId','inventoryId'].includes(k))||!text(a.inventoryId,100)||!a.inventoryId||ids.has(a.inventoryId))fail(400,'在庫の重複・商品数を確認してください。')
   const p=await ownedPurchase(owner,a.purchaseId),stock=p.order.inventoryLinks.find((s:any)=>s.inventoryId===a.inventoryId)
   if(p.status!=='linked'||!stock)fail(409,'接続済みの購入・在庫を選択してください。')
   const known=stock.shipments.filter((s:any)=>s.tracking?.trim());if(known.length&&!known.some((s:any)=>tracking(s.tracking)===tracking(body.tracking)))fail(409,'在庫の出荷記録と追跡番号が異なります。元の記録を確認してください。')
   if(await Outcome.exists({ownerId:owner,inventoryId:a.inventoryId,status:'active'}))fail(409,'返品・取消の記録がある在庫です。先にその記録を解除してください。')
   ids.add(a.inventoryId);allocations.push({purchaseId:String(p._id),archiveId:p.archiveId,orderNumber:p.order.orderNumber,itemLine:stock.itemLine,itemKey:purchaseItemKey(p.order,stock.itemLine),inventoryId:a.inventoryId,quantity:1})
  }
  if(await Export.exists({ownerId:owner,status:'active',inventoryIds:{$in:[...ids]},...(old?{_id:{$ne:old._id}}:{})}))fail(409,'別の出荷に割当済みの在庫です。')
  const documents=await preserveDocuments(owner,body.documents,old,['invoice','permit'])
  if(body.confirmDocuments&&(!body.applicationId.trim()||!body.permitNumber.trim()||!body.permitDate||documents.length!==2))fail(400,'Invoice・輸出許可書と申告番号・許可日を確認してください。')
  const at=new Date(),value={provider:'intras',providerAccount,orderId,applicationId:body.applicationId.trim(),tracking:body.tracking.trim(),trackingKey:tracking(body.tracking),shippedAt:body.shippedAt,itemCount:body.itemCount,declaredValue:{amount:body.declaredAmount,currency:'JPY',source:'customer_submitted'},permitNumber:body.permitNumber.trim(),permitDate:body.permitDate,documents,allocations,inventoryIds:[...ids],status:'active',verifiedAt:body.confirmDocuments?at:null}
  const history={at,action:old?'updated':'created',before:old?{...old,history:undefined}:null}
  await check()
  try{
   if(old){const r=await Export.updateOne({_id:old._id,ownerId:owner,revision:body.revision},{$set:value,$inc:{revision:1},$push:{history}});if(!r.matchedCount)fail(409,'出荷が更新されています。')}
   else await Export.create({ownerId:owner,...value,revision:1,history:[history]})
  }catch(e:any){if(e.code===11000)fail(409,'同じ出荷または在庫が保存済みです。出荷を検索して再読込してください。');throw e}
  return findExport(owner,providerAccount,orderId)
 })
}
export async function releaseExport(owner:string,exportId:string,body:any){
 await init();if(body?.confirm!==true||!Number.isSafeInteger(body.revision)||Object.keys(body).some(k=>!['revision','confirm'].includes(k)))fail(400,'解除する出荷を確認してください。')
 return withPurchaseGraph(owner,async check=>{
  const old:any=await Export.findOne({_id:id(exportId),ownerId:owner,revision:body.revision,status:'active'}).lean();if(!old)fail(409,'出荷が更新されています。再読込してください。')
  if(old.history.length>=100)fail(409,'出荷の変更履歴が上限に達しました。')
  await check();const r=await Export.updateOne({_id:old._id,ownerId:owner,revision:body.revision,status:'active'},{$set:{status:'released',verifiedAt:null},$inc:{revision:1},$push:{history:{at:new Date(),action:'released',before:{...old,history:undefined}}}})
  if(!r.matchedCount)fail(409,'出荷が更新されています。再読込してください。');return {released:true}
 })
}
export async function saveUnitOutcome(owner:string,purchaseId:string,body:any){
 await init();if(!body||Object.keys(body).some(k=>!['inventoryId','revision','outcome','reason','document','confirm'].includes(k))||body.confirm!==true||!text(body.inventoryId,100)||!Number.isSafeInteger(body.revision)||body.revision<0||!['returned','cancelled'].includes(body.outcome)||!text(body.reason,1000)||!body.reason.trim())fail(400,'返品・取消の理由と資料を確認してください。')
 return withPurchaseGraph(owner,async check=>{
  const p=await ownedPurchase(owner,purchaseId),stock=p.order.inventoryLinks.find((i:any)=>i.inventoryId===body.inventoryId)
  if(p.status!=='linked'||!stock)fail(409,'接続済みの在庫を選択してください。')
  if(await Export.exists({ownerId:owner,status:'active',inventoryIds:body.inventoryId}))fail(409,'出荷への割当があります。先に割当を解除してください。')
  const old:any=await Outcome.findOne({ownerId:owner,inventoryId:body.inventoryId}).lean();if((old?.revision||0)!==body.revision)fail(409,'返品・取消の記録が更新されています。')
  if((old?.history?.length||0)>=100)fail(409,'変更履歴が上限に達しました。')
  const documents=await preserveDocuments(owner,[{...body.document,kind:'outcome'}],old,['outcome'])
  const at=new Date(),value={purchaseId:p._id,inventoryId:body.inventoryId,itemKey:purchaseItemKey(p.order,stock.itemLine),outcome:body.outcome,reason:body.reason.trim(),documents,status:'active',confirmedAt:at}
  await check();const history={at,action:'confirmed',before:old?{...old,history:undefined}:null}
  if(old){const r=await Outcome.updateOne({_id:old._id,ownerId:owner,revision:body.revision},{$set:value,$inc:{revision:1},$push:{history}});if(!r.matchedCount)fail(409,'記録が更新されています。')}
  else await Outcome.create({ownerId:owner,...value,revision:1,history:[history]})
  return purchaseExports(owner,purchaseId)
 })
}
export async function releaseUnitOutcome(owner:string,outcomeId:string,body:any){
 await init();if(body?.confirm!==true||!Number.isSafeInteger(body.revision)||Object.keys(body).some(k=>!['revision','confirm'].includes(k)))fail(400,'解除する記録を確認してください。')
 return withPurchaseGraph(owner,async check=>{await check();const r=await Outcome.updateOne({_id:id(outcomeId),ownerId:owner,revision:body.revision,status:'active'},{$set:{status:'released'},$inc:{revision:1},$push:{history:{at:new Date(),action:'released'}}});if(!r.matchedCount)fail(409,'記録が更新されています。');return {released:true}})
}
export async function exportOriginal(owner:string,recordId:string,hash:string,outcome=false){
 await init();const r:any=await (outcome?Outcome:Export).findOne({_id:id(recordId),ownerId:owner}).lean()
 const all=[...(r?.documents||[]),...(r?.history||[]).flatMap((h:any)=>h.before?.documents||[])],doc=all.find((d:any)=>d.hash===hash)
 if(!doc)fail(404,'出荷資料が見つかりません。');const bytes=await readFile(filePath(owner,hash));if(digest(bytes)!==hash||bytes.length!==doc.size)fail(409,'出荷原本の整合性を確認できません。');return {bytes,doc}
}

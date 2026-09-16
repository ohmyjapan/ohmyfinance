import {mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {FinancePurchaseLink as Link} from '../models/FinancePurchaseLink'
import {FinanceResearch as Research} from '../models/FinanceResearch'
import {readDraft,withWritableDraft} from './financeDraftService'
import {downloadResearchArtifact} from './financeResearchDocumentService'
import {fail,id,ready} from './financeService'
import {purchaseCandidates} from '../../shared/finance-purchase-links.mjs'
import {digest} from '../../shared/amex.mjs'
const filePath=(ownerId:string,hash:string)=>{
 if(!/^[a-f0-9]{64}$/.test(hash))fail(400,'Invalid document')
 return path.join(process.env.OMF_DATA_DIR||path.join(os.homedir(),'.ohmyfinance'),'purchase-documents',id(ownerId),hash)
}
async function init(){await ready();await Link.init()}
function visible(r:any){return {id:String(r._id),status:r.status,revision:r.revision,order:r.order,originals:r.originals,confirmedAt:r.confirmedAt,payment:r.payment,candidateHash:r.candidateHash,history:(r.history||[]).map((h:any)=>({at:h.at,action:h.action}))}}
export async function purchaseLinkView(ownerId:string,importId:string,line:number){
 await init();const draft=await readDraft(ownerId,importId,line),research:any=await Research.findOne({ownerId,importId,line}).lean()
 const saved:any[]=await Link.find({ownerId,importId,line}).sort({updatedAt:-1}).lean()
 const candidates=purchaseCandidates(research,draft).map(({evidence,...c}:any)=>c)
 for(const c of candidates){
  const previous:any=await Link.findOne({ownerId,archiveId:c.order.archiveId}).select('revision').lean();c.linkRevision=previous?.revision||0
  const conflicts:any[]=await Link.find({ownerId,status:'linked',$or:[{archiveId:c.order.archiveId},{inventoryIds:{$in:c.order.inventoryLinks.map((i:any)=>i.inventoryId)}}]}).select('archiveId importId line').lean()
  c.conflict=conflicts.some(r=>r.archiveId!==c.order.archiveId||String(r.importId)!==importId||r.line!==line)
 }
 return {saved:saved.map(visible),candidates,researchId:research?String(research._id):null,researchRevision:research?.revision||0,locked:draft.locked,hasResearch:!!research?.report}
}
export async function savePurchaseLink(ownerId:string,importId:string,line:number,body:any){
 await init()
 if(!body||Object.keys(body).some(k=>!['revision','key','sourceHash','researchRevision','candidateHash','archiveId','linkRevision','confirm'].includes(k))||body.confirm!==true||!/^[a-f0-9]{64}$/.test(body.archiveId||'')||!Number.isSafeInteger(body.linkRevision)||body.linkRevision<0)fail(400,'注文と明細の対応を確認してください。')
 await withWritableDraft(ownerId,importId,line,body,async(d,check)=>{
  const r:any=await Research.findOne({ownerId,importId,line}).lean()
  if(r?.revision!==body.researchRevision)fail(409,'調査が更新されています。再読込してください。')
  const candidate=purchaseCandidates(r,d).find(c=>c.order.archiveId===body.archiveId&&c.candidateHash===body.candidateHash)
  if(!candidate?.documentsComplete||!candidate.amountMatches)fail(409,'金額が一致する注文と全ページの原本を確認してください。')
  const old:any=await Link.findOne({ownerId,archiveId:body.archiveId}).lean()
  if(old&&old.status==='linked'&&(String(old.importId)!==importId||old.line!==line))fail(409,'この注文は別の明細に接続済みです。')
  if(old?.status==='linked'&&old.candidateHash===candidate.candidateHash)return
  if((old?.revision||0)!==body.linkRevision)fail(409,'接続が更新されています。再読込してください。')
  if((old?.history?.length||0)>=20)fail(409,'接続履歴が上限に達しました。保存済み資料を確認してください。')
  const originals=[]
  for(const original of candidate.originals){
   const captured=await downloadResearchArtifact(ownerId,String(r._id),original.artifactId)
   if(captured.artifact.requestId!==r.requestId||captured.artifact.sourceId!==original.sourceId||digest(captured.bytes)!==original.hash||captured.bytes.length!==original.size)fail(409,'注文原本が変更されています。再調査してください。')
   const file=filePath(ownerId,original.hash);await mkdir(path.dirname(file),{recursive:true})
   try{await writeFile(file,captured.bytes,{flag:'wx'})}catch(e:any){if(e.code!=='EEXIST')throw e;if(digest(await readFile(file))!==original.hash)fail(409,'保存済み原本を確認できません。')}
   originals.push({...original})
  }
  await check()
  if(!await Research.exists({_id:r._id,ownerId,revision:r.revision,requestId:r.requestId,state:{$in:['ready','applied']}}))fail(409,'調査が更新されています。再読込してください。')
  const at=new Date(),value={accountId:d.source.account.id,importId,line,key:d.key,sourceHash:d.sourceHash,paymentKey:d.source.account.id+':'+d.key,payment:{date:d.source.purchaseDate,amount:d.source.amount,merchant:d.source.description,accountName:d.source.account.name,cardLast4:d.source.cardLast4},status:'linked',order:candidate.order,inventoryIds:candidate.order.inventoryLinks.map((i:any)=>i.inventoryId),originals,evidence:candidate.evidence,candidateHash:candidate.candidateHash,researchId:r._id,requestId:r.requestId,confirmedAt:at}
  const history={at,action:old?.status==='linked'?'updated':'linked',before:old?{order:old.order,originals:old.originals,evidence:old.evidence,importId:old.importId,line:old.line,status:old.status}:null}
  try{
   if(old){const result=await Link.updateOne({_id:old._id,ownerId,revision:body.linkRevision},{$set:value,$inc:{revision:1},$push:{history}});if(!result.matchedCount)fail(409,'接続が更新されています。再読込してください。')}
   else await Link.create({ownerId,archiveId:body.archiveId,...value,revision:1,history:[history]})
  }catch(e:any){if(e.code===11000)fail(409,'注文・明細・在庫のいずれかが別の接続で使用されています。再読込してください。');throw e}
 })
 return purchaseLinkView(ownerId,importId,line)
}
export async function releasePurchaseLink(ownerId:string,importId:string,line:number,body:any){
 await init()
 if(!body||body.confirm!==true||!Number.isSafeInteger(body.linkRevision)||Object.keys(body).some(k=>!['revision','key','sourceHash','id','linkRevision','confirm'].includes(k)))fail(400,'解除する接続を確認してください。')
 await withWritableDraft(ownerId,importId,line,body,async(d,check)=>{
  await check();const result=await Link.updateOne({_id:id(body.id),ownerId,importId,line,key:d.key,sourceHash:d.sourceHash,revision:body.linkRevision,status:'linked'},{$set:{status:'released'},$inc:{revision:1},$push:{history:{at:new Date(),action:'released'}}})
  if(!result.matchedCount)fail(409,'接続が更新されています。再読込してください。')
 })
 return purchaseLinkView(ownerId,importId,line)
}
export async function purchaseOriginal(ownerId:string,linkId:string,hash:string){
 await init();const record:any=await Link.findOne({_id:id(linkId),ownerId}).lean(),original=record?.originals.find((a:any)=>a.hash===hash)
 if(!original)fail(404,'購入原本が見つかりません。')
 const bytes=await readFile(filePath(ownerId,hash));if(digest(bytes)!==hash||bytes.length!==original.size)fail(409,'購入原本の整合性を確認できません。')
 return {bytes,original}
}

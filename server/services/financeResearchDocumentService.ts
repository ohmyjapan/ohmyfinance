import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {FinanceResearch} from '../models/FinanceResearch'
import {FinanceDocument} from '../models/FinanceDraft'
import {readDraft,saveDraft,addDocument} from './financeDraftService'
import {fail,id} from './financeService'
import {digest} from '../../shared/amex.mjs'
const mimeTypes=['application/pdf','image/png','image/jpeg','image/webp']
const directory=()=>path.resolve(process.env.OMF_DATA_DIR||path.join(os.homedir(),'.ohmyfinance'),'research-documents')
const filePath=(artifactId:string)=>{if(!/^[a-f0-9]{64}$/.test(artifactId))fail(400,'Invalid artifact');return path.join(directory(),artifactId)}
export async function uploadResearchArtifact(agent:any,researchId:string,query:any,bytes:Buffer){
 if(agent.researchEnabled!==true)fail(403,'Research capability required')
 const r:any=await FinanceResearch.findOne({_id:id(researchId),ownerId:agent.ownerId,accountId:{$in:agent.accountIds},agentId:agent._id,state:'working',lease:query.lease,leaseUntil:{$gt:new Date()}}).lean()
 if(!r)fail(409,'Research job expired')
 const name=String(query.name||'').trim(),mimeType=String(query.mimeType||'')
 if(!/^s[1-9][0-9]?$/.test(query.sourceId||'')||!name||name.length>180||/[/\\\x00-\x1f]/.test(name)||!mimeTypes.includes(mimeType)||!bytes.length||bytes.length>10485760)fail(400,'Invalid research document')
 const pdf=bytes.subarray(0,5).toString()==='%PDF-',png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'
 if(!({'application/pdf':pdf,'image/png':png,'image/jpeg':jpg,'image/webp':webp} as any)[mimeType])fail(400,'Document signature does not match')
 const hash=digest(bytes),artifactId=digest(String(r._id)+':'+r.requestId+':'+hash),artifact={id:artifactId,name,mimeType,hash,size:bytes.length,sourceId:query.sourceId,requestId:r.requestId,at:new Date()}
 if((r.artifacts||[]).some((a:any)=>a.id===artifactId&&a.requestId===r.requestId))return {artifactId}
 if((r.artifacts||[]).filter((a:any)=>a.requestId===r.requestId).length>=5)fail(400,'Document research limit reached')
 await mkdir(directory(),{recursive:true});try{await writeFile(filePath(artifactId),bytes,{flag:'wx'})}catch(e:any){if(e.code!=='EEXIST')throw e;if(digest(await readFile(filePath(artifactId)))!==hash)fail(409,'Stored document hash mismatch')}
 const saved=await FinanceResearch.updateOne({_id:r._id,state:'working',lease:query.lease,requestId:r.requestId,'artifacts.id':{$ne:artifactId}},{$push:{artifacts:artifact}})
 if(!saved.matchedCount&&!await FinanceResearch.exists({_id:r._id,'artifacts.id':artifactId}))fail(409,'Research changed during document storage')
 return {artifactId}
}
async function owned(ownerId:string,researchId:string,artifactId:string){
 const r:any=await FinanceResearch.findOne({_id:id(researchId),ownerId}).lean(),artifact=r?.artifacts?.find((a:any)=>a.id===artifactId)
 if(!artifact)fail(404,'調査資料が見つかりません。')
 await readDraft(ownerId,String(r.importId),r.line)
 const bytes=await readFile(filePath(artifactId));if(digest(bytes)!==artifact.hash)fail(409,'調査資料の整合性を確認できません。')
 return {research:r,artifact,bytes}
}
export async function downloadResearchArtifact(ownerId:string,researchId:string,artifactId:string){return owned(ownerId,researchId,artifactId)}
export async function attachResearchArtifact(ownerId:string,researchId:string,artifactId:string,body:any){
 const {research:r,artifact,bytes}=await owned(ownerId,researchId,artifactId)
 let d=await readDraft(ownerId,String(r.importId),r.line)
 if(body.confirm!==true||d.locked||body.revision!==d.revision||body.key!==d.key||body.sourceHash!==d.sourceHash)fail(409,'明細と資料を確認してから添付してください。')
 const existing=await FinanceDocument.findOne({ownerId,importId:r.importId,line:r.line,hash:artifact.hash}).lean();if(existing)return {draft:d}
 if(!d.revision)d=await saveDraft(ownerId,String(r.importId),r.line,{revision:0,key:d.key,sourceHash:d.sourceHash,values:d.values,confirm:false,remember:[]})
 const extensions:any={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'},name=artifact.name.endsWith(extensions[artifact.mimeType])?artifact.name:artifact.name+extensions[artifact.mimeType]
 d=await addDocument(ownerId,String(r.importId),r.line,{revision:d.revision,key:d.key,sourceHash:d.sourceHash,name,kind:'receipt'},bytes,artifact.mimeType)
 return {draft:d}
}

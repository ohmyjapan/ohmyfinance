import {defineEventHandler,setHeader,getQuery} from 'h3'
import {uploadResearchArtifact,downloadResearchArtifact,attachResearchArtifact} from '../../services/financeResearchDocumentService'
import {financeUser,fail} from '../../services/financeService'
import {boundedBody} from '../../services/financeDraftService'
import {FinanceChatAgent} from '../../models/FinanceChat'
import {chatAgent} from '../../services/financeChatService'
import {researchView,queueResearch,claimResearch,researchProgress,researchDocument,finishResearch,applyResearch,saveResearchSupplier} from '../../services/financeResearchService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 const parts=(event.path.split('?')[0].split('/api/finance-research/')[1]||'').split('/').filter(Boolean)
 const body=async()=>{try{return JSON.parse((await boundedBody(event,1800000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid research request')}}
 try{
  if(parts[0]==='worker'){
   const agent=await chatAgent(event)
   if(event.method!=='POST')fail(404,'Research endpoint not found')
   if(parts.length===2&&parts[1]==='status'){const status=await body();if(!agent.researchEnabled||!/^http:\/\/127\.0\.0\.1:[0-9]+\/setup\/[a-f0-9]{64}$/.test(status.settingsUrl||'')||typeof status.ntaConfigured!=='boolean')fail(400,'Invalid research status');await FinanceChatAgent.updateOne({_id:agent._id},{$set:{researchStatus:{settingsUrl:status.settingsUrl,ntaConfigured:status.ntaConfigured}}});return {success:true}}
   if(parts.length===2&&parts[1]==='claim')return await claimResearch(agent)
   if(parts.length===3&&parts[2]==='progress')return await researchProgress(agent,parts[1],await body())
   if(parts.length===3&&parts[2]==='result')return await finishResearch(agent,parts[1],await body())
   if(parts.length===3&&parts[2]==='artifact')return await uploadResearchArtifact(agent,parts[1],getQuery(event),await boundedBody(event,10485760))
   if(parts.length===3&&parts[2]==='document'){const doc=await researchDocument(agent,parts[1],await body());setHeader(event,'Content-Type',doc.doc.mimeType);return doc.bytes}
   fail(404,'Research endpoint not found')
  }
  const ownerId=await financeUser(event)
  if(parts.length===3&&parts[1]==='artifacts'){if(event.method==='GET'){const result=await downloadResearchArtifact(ownerId,parts[0],parts[2]);setHeader(event,'Content-Type',result.artifact.mimeType);return result.bytes}if(event.method==='POST')return await attachResearchArtifact(ownerId,parts[0],parts[2],await body())}
  if(parts[0]==='imports'&&parts[2]==='drafts'&&[4,5].includes(parts.length)){
   const line=Number(parts[3]);if(!Number.isSafeInteger(line)||line<2)fail(400,'Invalid line')
   if(parts.length===4&&event.method==='GET')return await researchView(ownerId,parts[1],line)
   if(parts.length===4&&event.method==='POST')return await queueResearch(ownerId,parts[1],line,await body())
   if(parts.length===5&&parts[4]==='apply'&&event.method==='POST')return await applyResearch(ownerId,parts[1],line,await body())
   if(parts.length===5&&parts[4]==='supplier'&&event.method==='POST')return await saveResearchSupplier(ownerId,parts[1],line,await body())
  }
  fail(404,'Research endpoint not found')
 }catch(e:any){if(e.statusCode)throw e;console.error('[Finance research] request failed',e.name||'Error');fail(500,'Research request failed')}
})

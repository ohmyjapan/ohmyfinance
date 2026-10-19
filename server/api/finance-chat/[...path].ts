import { calendarCompany } from '../../utils/calendarAccess'
import { getCompanyAssistant, sendCompanyAssistant, retryCompanyAssistant, newCompanyConversation, companyConversationHistory, companyConversationArchive, companyKnowledgeInspection, sourceCompanyAssistant, companyPublicSource } from '../../services/financeCompanyAssistantService'
import {getAssistant,sendAssistant,retryAssistant,claimAssistant,finishAssistant,actionAssistant} from '../../services/financeAssistantService'
import { defineEventHandler, setHeader, getQuery } from 'h3'
import { financeUser,fail,id } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { FinanceChatAgent } from '../../models/FinanceChat'
import { chatAgent,chatHeartbeat,createChatAgent,getChat,sendChat,retryChat,claimChat,finishChat,confirmChat,actionChat } from '../../services/financeChatService'
import { selectedPostingCompany } from '../../services/financeNaviPostingService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 const parts=(event.path.split('?')[0].split('/api/finance-chat/')[1]||'').split('/').filter(Boolean)
 const body=async(optional=false)=>{try{const raw=(await boundedBody(event,14000)).toString('utf8');return JSON.parse(raw||(optional?'{}':''))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid conversation JSON')}}
 try{
  if(parts[0]==='worker'){
   const agent=await chatAgent(event)
   if(event.method==='POST'&&parts.length===2&&parts[1]==='heartbeat'){await chatHeartbeat(agent,await body(true));return {success:true}}
   // The workspace claim carries the worker's actual public-research capability report; none reported clears the stored one.
   if(event.method==='POST'&&parts.length===2&&parts[1]==='workspace-claim'){const b=await body(true);await chatHeartbeat(agent,{capabilities:b?.capabilities===undefined?null:b.capabilities});return await claimAssistant(agent)}
   if(event.method==='POST'&&parts.length===4&&parts[1]==='workspace'&&parts[3]==='result')return await finishAssistant(agent,parts[2],await body())
   // Named, lease-bound Navi actions on the claimed conversation (workspace or purchase); the body carries lease, slot, name, args.
   const actionBody=async()=>{try{return JSON.parse((await boundedBody(event,64000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid action JSON')}}
   if(event.method==='POST'&&parts.length===4&&parts[1]==='workspace'&&parts[3]==='actions')return await actionAssistant(agent,parts[2],await actionBody())
   // Named, lease-bound public research evidence of a claimed company job (prepare/capture/list/read only; not a proxy). A capture
   // carries up to 60000 characters of literal page text, so this one route reads a larger bounded body.
   if(event.method==='POST'&&parts.length===4&&parts[1]==='workspace'&&parts[3]==='sources'){let b:any;try{b=JSON.parse((await boundedBody(event,400000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid public research JSON')}return await sourceCompanyAssistant(agent,parts[2],b)}
   if(event.method==='POST'&&parts.length===2&&parts[1]==='claim'){await chatHeartbeat(agent);return await claimChat(agent)}
   if(event.method==='POST'&&parts.length===3&&parts[2]==='result')return await finishChat(agent,parts[1],await body())
   if(event.method==='POST'&&parts.length===3&&parts[2]==='actions')return await actionChat(agent,parts[1],await actionBody())
   fail(404,'Teaching worker endpoint not found')
  }
  const ownerId=await financeUser(event)
  if(parts[0]==='company-workspace'){
   const {organizationId}=await calendarCompany(event)
   if(parts.length===1){if(event.method==='GET')return await getCompanyAssistant(ownerId,organizationId);if(event.method==='POST')return await sendCompanyAssistant(ownerId,organizationId,await body())}
   if(parts.length===2&&parts[1]==='retry'&&event.method==='POST')return await retryCompanyAssistant(ownerId,organizationId,await body())
   // Named company conversation continuations only: explicit new chat, archived history, captured public source detail and
   // teaching inspection (read-only).
   if(parts.length===2&&parts[1]==='new'&&event.method==='POST')return await newCompanyConversation(ownerId,organizationId,await body())
   if(parts.length===2&&parts[1]==='history'&&event.method==='GET'){const q=getQuery(event);return await companyConversationHistory(ownerId,organizationId,{page:typeof q.page==='string'?q.page:undefined})}
   if(parts.length===3&&parts[1]==='history'&&event.method==='GET')return await companyConversationArchive(ownerId,organizationId,parts[2])
   if(parts.length===3&&parts[1]==='sources'&&event.method==='GET')return await companyPublicSource(ownerId,organizationId,parts[2])
   if(parts.length===2&&parts[1]==='knowledge'&&event.method==='GET'){const q=getQuery(event);return await companyKnowledgeInspection(ownerId,organizationId,{status:typeof q.status==='string'?q.status:undefined,page:typeof q.page==='string'?q.page:undefined,query:typeof q.query==='string'?q.query:undefined})}
   fail(404,'Company conversation endpoint not found')
  }
  // Owner workspace and purchase chats: the token-selected company, checked now (current active membership), is the ledger posting
  // destination only. None, a stale or a foreign selection is null and every other conversation action stays available; a body never names it.
  const posting=()=>selectedPostingCompany(ownerId,event.context.auth?.organizationId)
  if(parts[0]==='workspace'&&parts.length===1){if(event.method==='GET')return await getAssistant(ownerId,await posting());if(event.method==='POST')return await sendAssistant(ownerId,await body(),await posting())}
  if(parts[0]==='workspace'&&parts.length===2&&parts[1]==='retry'&&event.method==='POST')return await retryAssistant(ownerId,await body(),await posting())
  if(parts[0]==='agents'&&parts.length===1&&event.method==='POST')return await createChatAgent(ownerId,await body())
  if(parts[0]==='agents'&&parts.length===2&&event.method==='DELETE'){
   const r=await FinanceChatAgent.updateOne({_id:id(parts[1]),ownerId},{$set:{enabled:false,revokedAt:new Date()}})
   if(!r.matchedCount)fail(404,'Teaching worker not found');return {success:true}
  }
  if(parts[0]==='imports'&&parts[2]==='drafts'&&(parts.length===4||parts.length===5)){
   const line=Number(parts[3]);if(!Number.isSafeInteger(line))fail(400,'Invalid line')
   if(parts.length===4&&event.method==='GET')return await getChat(ownerId,parts[1],line,await posting())
   if(parts.length===4&&event.method==='POST')return await sendChat(ownerId,parts[1],line,await body(),await posting())
   if(parts.length===5&&event.method==='POST'&&parts[4]==='confirm')return await confirmChat(ownerId,parts[1],line,await body(),await posting())
   if(parts.length===5&&event.method==='POST'&&parts[4]==='retry')return await retryChat(ownerId,parts[1],line,await body(),await posting())
  }
  fail(404,'Conversation endpoint not found')
 }catch(e:any){if(e.statusCode)throw e;console.error('[Finance chat] request failed',e.name||'Error');fail(500,'Conversation request failed')}
})

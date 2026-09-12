import { defineEventHandler, setHeader } from 'h3'
import { financeUser,fail,id } from '../../services/financeService'
import { boundedBody } from '../../services/financeDraftService'
import { FinanceChatAgent } from '../../models/FinanceChat'
import { chatAgent,createChatAgent,getChat,sendChat,retryChat,claimChat,finishChat,confirmChat } from '../../services/financeChatService'
export default defineEventHandler(async event=>{
 setHeader(event,'Cache-Control','no-store')
 const parts=(event.path.split('?')[0].split('/api/finance-chat/')[1]||'').split('/').filter(Boolean)
 const body=async()=>{try{return JSON.parse((await boundedBody(event,14000)).toString('utf8'))}catch(e:any){if(e.statusCode)throw e;fail(400,'Invalid conversation JSON')}}
 try{
  if(parts[0]==='worker'){
   const agent=await chatAgent(event)
   if(event.method==='POST'&&parts.length===2&&parts[1]==='heartbeat')return {success:true}
   if(event.method==='POST'&&parts.length===2&&parts[1]==='claim')return await claimChat(agent)
   if(event.method==='POST'&&parts.length===3&&parts[2]==='result')return await finishChat(agent,parts[1],await body())
   fail(404,'Teaching worker endpoint not found')
  }
  const ownerId=await financeUser(event)
  if(parts[0]==='agents'&&parts.length===1&&event.method==='POST')return await createChatAgent(ownerId,await body())
  if(parts[0]==='agents'&&parts.length===2&&event.method==='DELETE'){
   const r=await FinanceChatAgent.updateOne({_id:id(parts[1]),ownerId},{$set:{enabled:false,revokedAt:new Date()}})
   if(!r.matchedCount)fail(404,'Teaching worker not found');return {success:true}
  }
  if(parts[0]==='imports'&&parts[2]==='drafts'&&(parts.length===4||parts.length===5)){
   const line=Number(parts[3]);if(!Number.isSafeInteger(line))fail(400,'Invalid line')
   if(parts.length===4&&event.method==='GET')return await getChat(ownerId,parts[1],line)
   if(parts.length===4&&event.method==='POST')return await sendChat(ownerId,parts[1],line,await body())
   if(parts.length===5&&event.method==='POST'&&parts[4]==='confirm')return await confirmChat(ownerId,parts[1],line,await body())
   if(parts.length===5&&event.method==='POST'&&parts[4]==='retry')return await retryChat(ownerId,parts[1],line,await body())
  }
  fail(404,'Conversation endpoint not found')
 }catch(e:any){if(e.statusCode)throw e;console.error('[Finance chat] request failed',e.name||'Error');fail(500,'Conversation request failed')}
})

import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { getHeader, type H3Event } from 'h3'
import { FinanceChat as Chat, FinanceChatAgent as Agent } from '../models/FinanceChat'
import { FinanceDraft } from '../models/FinanceDraft'
import { FinancialAccount } from '../models/Finance'
import User from '../models/User'
import { ready, fail, id } from './financeService'
import { readDraft, saveDraft } from './financeDraftService'
import { reviewContext } from './financeReviewService'
import { validateChatProposal, reusableClassification } from '../../shared/finance-chat.mjs'
import { consultationEvidence } from '../../shared/finance-consultation.mjs'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const fingerprint=(v:any)=>hash(JSON.stringify(v))
const pending=['queued','working','confirming']
async function init(){await ready();await Promise.all([Chat.init(),Agent.init()])}
const identity=(ownerId:string,importId:string,line:number)=>({ownerId,importId:id(importId),line})
function bound(d:any,b:any){if(b?.revision!==d.revision||b?.key!==d.key||b?.sourceHash!==d.sourceHash)fail(409,'下書きが変わりました。再読込してから続けてください。')}
function editable(d:any){if(d.locked||d.source.kind!=='expense')fail(409,'この明細の購入内容は変更できません。')}
function visible(c:any){return c?{id:String(c._id),revision:c.revision,state:c.state,currentId:c.currentId,turns:c.turns}:null}
export async function chatAgent(event:H3Event){
 const token=(getHeader(event,'authorization')||'').replace(/^Bearer /,'')
 if(!/^omft_[a-f\d]{64}$/.test(token))fail(401,'Teaching worker authorization required')
 await init();const agent:any=await Agent.findOne({tokenHash:hash(token),enabled:true,revokedAt:null}).lean()
 if(!agent||!await User.exists({_id:agent.ownerId}))fail(401,'Teaching worker unavailable')
 await Agent.updateOne({_id:agent._id},{$set:{lastSeenAt:new Date()}});return agent
}
export async function createChatAgent(ownerId:string,body:any){
 await init()
 if(!Array.isArray(body?.accountIds)||!body.accountIds.length||body.accountIds.length>30)fail(400,'Choose accounts')
 const accountIds=[...new Set(body.accountIds.map(id))]
 if(await FinancialAccount.countDocuments({ownerId,_id:{$in:accountIds},active:true})!==accountIds.length)fail(400,'Unknown account')
 const token='omft_'+randomBytes(32).toString('hex'),agent=await Agent.create({ownerId,accountIds,tokenHash:hash(token),workspaceEnabled:body.workspaceEnabled===true,documentEnabled:body.documentEnabled===true})
 return {id:String(agent._id),token}
}
export async function getChat(ownerId:string,importId:string,line:number){
 await init();const d=await readDraft(ownerId,importId,line);let c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 if(c?.state==='confirming'&&c.leaseUntil<=new Date()){
  const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).select('history').lean()
  const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===c.currentId&&h.channel==='web')
  const set:any={state:applied?'confirmed':'ready'}
  if(applied){set['turns.$[turn].confirmedAt']=applied.at;set['turns.$[turn].remembered']=applied.reusable}
  await Chat.updateOne({_id:c._id,revision:c.revision,state:'confirming'},{$set:set,$unset:{lease:'',leaseUntil:''},$inc:{revision:1}},applied?{arrayFilters:[{'turn.id':c.currentId}]}:{})
  c=await Chat.findById(c._id).lean()
 }
 const connected=!!await Agent.exists({ownerId,accountIds:d.source.account.id,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}})
 return {conversation:visible(c),connected,stale:!!c?.context&&(c.context.revision!==d.revision||c.context.fingerprint!==fingerprint(d.values))&&c.state!=='confirmed'}
}
export async function sendChat(ownerId:string,importId:string,line:number,body:any){
 await init()
 if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.text)||!/^[-a-zA-Z0-9]{16,64}$/.test(body.requestId||''))fail(400,'メッセージを入力してください（2000文字以内）。')
 const scope=identity(ownerId,importId,line),{draft:d,study,customers}=await reviewContext(ownerId,importId,line)
 let c:any=await Chat.findOne(scope).lean()
 const previous=c?.turns.find((t:any)=>t.id===body.requestId)
 if(previous){if(previous.text!==body.text.trim())fail(409,'送信IDが既に使用されています。');return getChat(ownerId,importId,line)}
 bound(d,body);editable(d)
 if(!await Agent.exists({ownerId,accountIds:d.source.account.id,enabled:true,revokedAt:null,lastSeenAt:{$gt:new Date(Date.now()-65000)}}))fail(409,'AIに接続できません。少し待って再試行してください。')
 if(c&&pending.includes(c.state))fail(409,'前のメッセージの処理が終わるまでお待ちください。')
 if((c?.turns.length||0)>=100)fail(409,'この会話は100件に達しました。下書きから直接編集してください。')
 if(body.chatRevision!==(c?.revision||0))fail(409,'会話が更新されました。再読込してください。')
 if(await Chat.countDocuments({ownerId,state:{$in:['queued','working']}})>=3)fail(409,'他の会話への回答を待ってから送信してください。')
 if(!c){try{c=(await Chat.create({...scope,accountId:d.source.account.id})).toObject()}catch(e:any){if(e.code===11000)fail(409,'会話が更新されました。再読込してください。');throw e}}
 const context={revision:d.revision,key:d.key,sourceHash:d.sourceHash,fingerprint:fingerprint(d.values),values:d.values,source:d.source,study,customers,mapping:consultationEvidence(d),
  messages:c.turns.slice(-8).map((t:any)=>({text:t.text,response:t.proposal?.summary||'',patch:t.proposal?.patch||{},confirmed:!!t.confirmedAt}))}
 const updated=await Chat.findOneAndUpdate({_id:c._id,revision:body.chatRevision,state:{$nin:pending}},{$set:{state:'queued',currentId:body.requestId,context,attempts:0},$unset:{lease:'',leaseUntil:'',agentId:''},$inc:{revision:1},$push:{turns:{id:body.requestId,text:body.text.trim(),at:new Date()}}},{new:true}).lean()
 if(!updated)fail(409,'会話が更新されました。再読込してください。')
 return getChat(ownerId,importId,line)
}
export async function retryChat(ownerId:string,importId:string,line:number,body:any){
 await init();const d=await readDraft(ownerId,importId,line);bound(d,body);editable(d)
 const c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 if(!c||c.state!=='failed'||body.chatRevision!==c.revision||c.context.fingerprint!==fingerprint(d.values))fail(409,'新しいメッセージとして送信してください。')
 await Chat.updateOne({_id:c._id,revision:c.revision,state:'failed'},{$set:{state:'queued',attempts:0},$inc:{revision:1}})
 return getChat(ownerId,importId,line)
}
export async function claimChat(agent:any){
 const scope={ownerId:agent.ownerId,accountId:{$in:agent.accountIds}}
 await Chat.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed'},$inc:{revision:1},$unset:{lease:'',leaseUntil:''}})
 const lease=randomUUID(),c:any=await Chat.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',lease,leaseUntil:new Date(Date.now()+120000),agentId:agent._id},$inc:{attempts:1,revision:1}},{sort:{updatedAt:1},new:true}).lean()
 if(!c)return {job:null}
 const turn=c.turns.find((t:any)=>t.id===c.currentId)
 return {job:{id:String(c._id),lease,text:turn.text,context:c.context}}
}
export async function finishChat(agent:any,chatId:string,body:any){
 if(typeof body?.lease!=='string')fail(400,'Missing lease')
 const filter={_id:id(chatId),ownerId:agent.ownerId,accountId:{$in:agent.accountIds},agentId:agent._id,state:'working',lease:body.lease,leaseUntil:{$gt:new Date()}}
 const c:any=await Chat.findOne(filter).lean();if(!c)fail(409,'Teaching job changed')
 const index=c.turns.findIndex((t:any)=>t.id===c.currentId),turn=c.turns[index]
 let proposal:any
 if(body.failed!==true){try{proposal=validateChatProposal(body.proposal,c.context,turn.text)}catch{fail(400,'Invalid teaching proposal')}}
 const turns=c.turns.map((t:any,i:number)=>i===index?{...t,...(proposal?{proposal}:{}),answeredAt:new Date()}:t)
 const result=await Chat.updateOne(filter,{$set:{turns,state:proposal?'ready':'failed'},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}})
 if(!result.matchedCount)fail(409,'Teaching job changed');return {success:true}
}
export async function confirmChat(ownerId:string,importId:string,line:number,body:any){
 await init();if(typeof body?.remember!=='boolean')fail(400,'記憶の範囲を確認してください。')
 const c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 if(!c||body.turnId!==c.currentId)fail(409,'最新の提案を確認してください。')
 const turn=c.turns.find((t:any)=>t.id===c.currentId)
 if(turn.proposal?.kind!=='proposal')fail(409,'反映する提案がありません。')
 const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).lean()
 const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===turn.id&&h.channel==='web')
 if(applied&&applied.reusable!==body.remember)fail(409,'既に別の記憶範囲で反映済みです。')
 if(!applied){
  if(body.chatRevision!==c.revision||!['ready','confirming'].includes(c.state)||(c.state==='confirming'&&c.leaseUntil>new Date()))fail(409,'会話が更新されたか、反映処理が進行中です。')
  const d=await readDraft(ownerId,importId,line);bound(d,body);editable(d)
  if(d.revision!==c.context.revision||fingerprint(d.values)!==c.context.fingerprint)fail(409,'会話の後に下書きや判断の根拠が変わりました。再読込して新しいメッセージを送信してください。')
  const proposal=validateChatProposal(turn.proposal,c.context,turn.text),values={...d.values,...proposal.patch}
  if(body.remember&&!reusableClassification(proposal,values))fail(400,'顧客・用途が明確な提案だけを記憶できます。')
  const lease=randomUUID(),locked=await Chat.updateOne({_id:c._id,revision:c.revision,state:c.state},{$set:{state:'confirming',lease,leaseUntil:new Date(Date.now()+120000)}})
  if(!locked.matchedCount)fail(409,'会話が更新されました。')
  try{
   await saveDraft(ownerId,importId,line,{revision:d.revision,key:d.key,sourceHash:d.sourceHash,values,remember:[],confirm:false},{reviewId:String(c._id),replyTs:turn.id,text:turn.text,summary:proposal.summary,fields:Object.keys(proposal.patch),reusable:body.remember,channel:'web'})
  }catch(e){await Chat.updateOne({_id:c._id,lease},{$set:{state:'ready'},$unset:{lease:'',leaseUntil:''}});throw e}
 }
 await Chat.updateOne({_id:c._id,currentId:turn.id},{$set:{state:'confirmed','turns.$[turn].confirmedAt':new Date(),'turns.$[turn].remembered':body.remember},$unset:{lease:'',leaseUntil:''},$inc:{revision:1}},{arrayFilters:[{'turn.id':turn.id}]})
 return {...await getChat(ownerId,importId,line),draft:await readDraft(ownerId,importId,line)}
}

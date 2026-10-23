import { renewCompanyAssistant } from './financeCompanyAssistantService'
import { checkedCapabilityReport } from './companyPublicResearchService'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { Model } from 'mongoose'
import { getHeader, type H3Event } from 'h3'
import { FinanceChat as Chat, FinanceChatAgent as Agent } from '../models/FinanceChat'
import { FinanceAssistant as Conversation } from '../models/FinanceAssistant'
import { FinanceActionOperation as Operation } from '../models/FinanceActionOperation'
import { FinanceDraft } from '../models/FinanceDraft'
import { FinanceResearch as Research } from '../models/FinanceResearch'
import { FinancialAccount } from '../models/Finance'
import User from '../models/User'
import { ready, fail, id } from './financeService'
import { readDraft, saveDraft, type DraftOperation } from './financeDraftService'
import { reviewContext } from './financeReviewService'
import { validateChatProposal, reusableClassification } from '../../shared/finance-chat.mjs'
import { consultationEvidence } from '../../shared/finance-consultation.mjs'
import { validateProposalReference, sameProposalReference, chatProposalReference, chatProposalContent, proposalHash, researchProposalReference, researchReportContent, canonicalJson, type ProposalReference } from '../../shared/finance-action-proposal.mjs'
import { startChatResearch, chatResearchContext } from './financeResearchService'
import { actionTools, teachingTools, reconcileActions, actionReceipts, conversationReceipts, runAction } from './financeActionService'
import { startNewOwnerConversation, listOwnerConversationArchives, getOwnerConversationArchive, ownerTurnLimits, findOwnerReceivedRequest, sameOwnerRequestId, sameOwnerRequestMeaning } from './financeOwnerConversationService'
import { companyClaim, companyContextLost, maskTurns } from './financeOwnerCompanyKnowledgeService'
import { postingCompanyView, type PostingCompany } from './financeNaviPostingService'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const fingerprint=(v:any)=>hash(JSON.stringify(v))
const pending=['queued','working','confirming']
async function init(){await ready();await Promise.all([Chat.init(),Agent.init()])}
const identity=(ownerId:string,importId:string,line:number)=>({ownerId,importId:id(importId),line})
function bound(d:any,b:any){if(b?.revision!==d.revision||b?.key!==d.key||b?.sourceHash!==d.sourceHash)fail(409,'下書きが変わりました。再読込してから続けてください。')}
function editable(d:any){if(d.locked||d.source.kind!=='expense')fail(409,'この明細の購入内容は変更できません。')}
// A turn that used one company's teachings is shown only while that same company is the checked selection (masked otherwise).
function visible(c:any,postingCompany:PostingCompany|null=null){return c?{id:String(c._id),revision:c.revision,state:c.state,currentId:c.currentId,segment:c.segment||0,turnLimit:ownerTurnLimits.purchase,turns:maskTurns(c.turns,postingCompany?.organizationId||null)}:null}
// Only this turn's completed draft writes authorize its accepted revision. Memory revisions are a separate counter.
function draftActionRevision(c:any,actions:any[]):number|null{
 const revisions=actions.filter((a:any)=>a.turnId===c.currentId&&a.state==='done'&&['save_draft_fields','apply_referenced_proposal','approve_draft'].includes(a.name)&&a.target?.importId===String(c.importId)&&a.target?.line===c.line&&Number.isSafeInteger(a.acceptedRevision)&&a.acceptedRevision>0).map((a:any)=>a.acceptedRevision)
 return revisions.length?Math.max(...revisions):null
}
const withReceipts=(c:any)=>conversationReceipts('purchase',c)
// The proposals a command may name: each must be exactly what this conversation displayed (the stored turn reference, or the
// research row's current reference), unapplied, and bound to the current draft; a foreign, edited, changed or applied one is
// refused here with one message. The bounded snapshot of what was displayed is stored beside the reference for the worker.
async function storedReferences(ownerId:string,importId:string,line:number,c:any,d:any,input:any):Promise<any[]>{
 if(input===undefined||input===null)return []
 if(!Array.isArray(input)||input.length>2)fail(400,'参照する提案を確認してください。')
 const refs=input.map((r:any)=>{try{return validateProposalReference(r)}catch{return fail(400,'参照する提案を確認してください。')}})
 if(new Set(refs.map((r:ProposalReference)=>r.kind)).size!==refs.length)fail(400,'同じ種類の提案を複数参照することはできません。')
 const out:any[]=[]
 for(const ref of refs){
  if(ref.importId!==importId||ref.line!==line)fail(409,'この明細に表示されていた提案ではありません。')
  if(ref.kind==='chat'){
   const turn=c?.turns.find((t:any)=>t.id===ref.turnId)
   if(!turn?.reference||turn.proposal?.kind!=='proposal'||!sameProposalReference(turn.reference,ref)||proposalHash(chatProposalContent(turn.proposal))!==ref.hash)fail(409,'表示されていた提案が変わりました。再読込してください。')
   if(turn.confirmedAt)fail(409,'この提案は既に反映済みです。')
   out.push({...ref,snapshot:{summary:turn.proposal.summary,patch:turn.proposal.patch}})
  }else{
   const r:any=await Research.findOne(identity(ownerId,importId,line)).lean(),current=researchProposalReference(r)
   if(!current||!sameProposalReference(current,ref))fail(409,'表示されていた調査結果が変わりました。再読込してください。')
   if(r.state!=='ready'||r.context.key!==d.key||r.context.sourceHash!==d.sourceHash||r.context.revision!==d.revision)fail(409,'調査後に下書きが変わりました。再調査してください。')
   out.push({...ref,snapshot:researchReportContent(r.report)})
  }
 }
 return out
}
// Research started from a conversation turn. The turn keeps {instruction, when, requestId|unavailable, at}: a successful start may replace an
// earlier unavailable, an unavailable never replaces a successful request (the array filter then leaves the turn untouched).
const researchMarker=(started:any)=>Object.fromEntries(Object.entries('unavailable' in started?{unavailable:started.unavailable,at:new Date()}:{requestId:started.requestId,at:new Date()}).map(([k,v])=>['turns.$[turn].research.'+k,v]))
const researchFilter=(turnId:string,started:any)=>'unavailable' in started?{'turn.id':turnId,'turn.research.requestId':{$exists:false}}:{'turn.id':turnId}
async function chatResearch(ownerId:string,importId:string,line:number,chatId:string,turnId:string,instruction:string,expected:{revision:number,key:string,sourceHash:string}):Promise<{requestId:string}|{unavailable:string}>{
 try{return await startChatResearch(ownerId,importId,line,chatId,turnId,instruction,expected)}
 catch(e:any){console.error('[Finance chat] research start failed',e?.name||'Error');return {unavailable:'調査を開始できませんでした。'}}
}
export async function chatAgent(event:H3Event){
 const token=(getHeader(event,'authorization')||'').replace(/^Bearer /,'')
 if(!/^omft_[a-f\d]{64}$/.test(token))fail(401,'Teaching worker authorization required')
 await init();const agent:any=await Agent.findOne({tokenHash:hash(token),enabled:true,revokedAt:null}).lean()
 if(!agent||!await User.exists({_id:agent.ownerId}))fail(401,'Teaching worker unavailable')
 await Agent.updateOne({_id:agent._id},{$set:{lastSeenAt:new Date()}});return agent
}
export async function chatHeartbeat(agent:any,body:any={}){
 if(body?.job!==undefined){
  const job=body.job
  if(!job||!['purchase','workspace'].includes(job.mode)||typeof job.id!=='string'||typeof job.lease!=='string'||!job.lease)fail(400,'Invalid conversation heartbeat')
  if(job.mode==='workspace'&&!agent.workspaceEnabled)fail(403,'Workspace conversation access required')
  const now=new Date(),leaseUntil=new Date(now.getTime()+120000),model:Model<any>=job.mode==='purchase'?Chat:Conversation
  const filter={_id:id(job.id),ownerId:agent.ownerId,agentId:agent._id,state:'working',lease:job.lease,leaseUntil:{$gt:now},...(job.mode==='purchase'?{accountId:{$in:agent.accountIds}}:{})}
  const renewed=await model.updateOne(filter,{$max:{leaseUntil}})
  if(!renewed.matchedCount){if(job.mode!=='workspace')fail(409,'Conversation job changed');await renewCompanyAssistant(agent,job)}
  else await Operation.updateMany({ownerId:agent.ownerId,agentId:agent._id,conversationKind:job.mode,conversationId:id(job.id),lease:job.lease,state:'claimed'},{$max:{leaseUntil}})
 }
 // A workspace claim carries the worker's actual public-research capability (or null when it reports none, which clears it);
 // other heartbeats leave it as it is. The report is validated literally and grants no account or membership access.
 const reported=body?.capabilities===undefined?undefined:checkedCapabilityReport(body.capabilities)
 await Agent.updateOne({_id:agent._id,ownerId:agent.ownerId,enabled:true,revokedAt:null},{$set:{chatLastSeenAt:new Date(),...(reported?{publicResearch:reported}:{})},...(reported===null?{$unset:{publicResearch:''}}:{})})
 if(reported!==undefined)agent.publicResearch=reported||undefined
}
export async function createChatAgent(ownerId:string,body:any){
 await init()
 if(!Array.isArray(body?.accountIds)||!body.accountIds.length||body.accountIds.length>30)fail(400,'Choose accounts')
 const accountIds=[...new Set(body.accountIds.map(id))]
 if(await FinancialAccount.countDocuments({ownerId,_id:{$in:accountIds},active:true})!==accountIds.length)fail(400,'Unknown account')
 const token='omft_'+randomBytes(32).toString('hex'),agent=await Agent.create({ownerId,accountIds,tokenHash:hash(token),workspaceEnabled:body.workspaceEnabled===true,documentEnabled:body.documentEnabled===true,researchEnabled:body.researchEnabled===true})
 return {id:String(agent._id),token}
}
// postingCompany: the token-selected company checked by the route for this request (display only; a turn keeps the one frozen at its send).
export async function getChat(ownerId:string,importId:string,line:number,postingCompany:PostingCompany|null=null){
 await init();const d=await readDraft(ownerId,importId,line);let c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 if(c?.state==='confirming'&&c.leaseUntil<=new Date()){
  const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).select('history').lean()
  const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===c.currentId&&h.channel==='web')
  const set:any={state:applied?'confirmed':'ready'}
  if(applied){set['turns.$[turn].confirmedAt']=applied.at;set['turns.$[turn].remembered']=applied.reusable}
  await Chat.updateOne({_id:c._id,revision:c.revision,state:'confirming'},{$set:set,$unset:{lease:'',leaseUntil:''},$inc:{revision:1}},applied?{arrayFilters:[{'turn.id':c.currentId}]}:{})
  c=await Chat.findById(c._id).lean()
 }
 // A confirmed turn whose deferred research was never started (the process died between the draft save and the final write) is started
 // once, bound to the accepted draft-history revision; concurrent recoveries share one deterministic request and keep the successful marker.
 const orphan=c?.turns.find((t:any)=>t.confirmedAt&&t.research?.when==='confirm'&&typeof t.research.instruction==='string'&&!t.research.requestId&&!t.research.unavailable)
 if(orphan){
  const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).select('history').lean()
  const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===orphan.id&&h.channel==='web')
  if(applied&&Number.isSafeInteger(applied.revision)){
   const started=await chatResearch(ownerId,importId,line,String(c._id),orphan.id,orphan.research.instruction,{revision:applied.revision,key:c.context.key,sourceHash:c.context.sourceHash})
   await Chat.updateOne({_id:c._id},{$set:researchMarker(started),...('unavailable' in started?{}:{$unset:{'turns.$[turn].research.unavailable':''}}),$inc:{revision:1}},{arrayFilters:[researchFilter(orphan.id,started)]})
   c=await Chat.findById(c._id).lean()
  }
 }
 const connected=!!await Agent.exists({ownerId,accountIds:d.source.account.id,enabled:true,revokedAt:null,chatLastSeenAt:{$gt:new Date(Date.now()-65000)}})
 c=await withReceipts(c)
 // A draft revision this conversation's own completed action produced is not a stale view of the draft.
 const produced=!!c&&draftActionRevision(c,c.turns.find((t:any)=>t.id===c.currentId)?.actions||[])===d.revision
 return {conversation:visible(c,postingCompany),connected,stale:!!c?.context&&(c.context.revision!==d.revision||c.context.fingerprint!==fingerprint(d.values))&&c.state!=='confirmed'&&!produced,postingCompany:postingCompanyView(postingCompany)}
}
// One request identity for a purchase send and for the uncertain request a New chat names: the existing text and id checks (same
// refusal), the canonical string id, and the hash of its exact text, the draft binding it was sent against and the displayed proposal
// references it carried (never the conversation revision or the selected company), so the retry of an accepted request stays the same
// request even after that request's own completed save moved the draft.
function purchaseRequestIdentity(body:any){
 if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.text)||!/^[-a-zA-Z0-9]{16,64}$/.test(body.requestId||''))fail(400,'メッセージを入力してください（2000文字以内）。')
 const text=body.text.trim()
 return {requestId:String(body.requestId),text,requestHash:hash(canonicalJson({text,draft:{revision:body.revision??null,key:body.key??null,sourceHash:body.sourceHash??null},references:body.references??null}))}
}
export async function sendChat(ownerId:string,importId:string,line:number,body:any,postingCompany:PostingCompany|null=null){
 await init()
 // The checked canonical id (its string form) is the one request id for recognition, the queue (currentId) and the stored turn.
 const {requestId,text,requestHash}=purchaseRequestIdentity(body)
 const scope=identity(ownerId,importId,line),{draft:d,study,customers}=await reviewContext(ownerId,importId,line)
 let c:any=await Chat.findOne(scope).lean()
 const previous=c?.turns.find((t:any)=>sameOwnerRequestId(t.id,requestId))
 if(previous){if(!sameOwnerRequestMeaning(previous,{requestHash,text}))fail(409,'送信IDが既に使用されています。');return getChat(ownerId,importId,line,postingCompany)}
 // The same id accepted before a New chat moved it to an adopted archive of this purchase's conversation is the same request: answered
 // with that archived turn and its receipts (masked for the company checked now), never queued or executed again; another meaning keeps
 // the 409. It precedes the draft binding, editability, worker and conversation checks, so the request's own completed save (which moved
 // the draft) never turns its retry into a refusal or a new instruction.
 const archived:any=c?await findOwnerReceivedRequest('purchase',scope,requestId,c,postingCompany?.organizationId||null):null
 if(archived){if(!sameOwnerRequestMeaning(archived.turn,{requestHash,text}))fail(409,'送信IDが既に使用されています。');return {...await getChat(ownerId,importId,line,postingCompany),received:archived.answer}}
 bound(d,body);editable(d)
 if(!await Agent.exists({ownerId,accountIds:d.source.account.id,enabled:true,revokedAt:null,chatLastSeenAt:{$gt:new Date(Date.now()-65000)}}))fail(409,'AIに接続できません。少し待って再試行してください。')
 if(c&&pending.includes(c.state))fail(409,'前のメッセージの処理が終わるまでお待ちください。')
 if((c?.turns.length||0)>=ownerTurnLimits.purchase)fail(409,'この会話は100件に達しました。「新しい会話」で続けてください。これまでの会話と提案は「履歴」に残ります（下書きから直接編集することもできます）。')
 if(body.chatRevision!==(c?.revision||0))fail(409,'会話が更新されました。再読込してください。')
 if(await Chat.countDocuments({ownerId,state:{$in:['queued','working']}})>=3)fail(409,'他の会話への回答を待ってから送信してください。')
 if(!c){try{c=(await Chat.create({...scope,accountId:d.source.account.id})).toObject()}catch(e:any){if(e.code===11000)fail(409,'会話が更新されました。再読込してください。');throw e}}
 const references=await storedReferences(ownerId,importId,line,c,d,body.references)
 c=await withReceipts(c)
 const context={revision:d.revision,key:d.key,sourceHash:d.sourceHash,fingerprint:fingerprint(d.values),values:d.values,source:d.source,study,customers,mapping:consultationEvidence(d),research:await chatResearchContext(ownerId,importId,line,d),
  // Each earlier message names its turn: the claim withholds a turn that used another company's teachings.
  messages:c.turns.slice(-8).map((t:any)=>({turnId:t.id,text:t.text,response:t.proposal?.summary||'',patch:t.proposal?.patch||{},confirmed:!!t.confirmedAt,actions:t.actions||[],submittedAt:t.at||null,replyRecordedAt:t.proposal?.summary?t.answeredAt||null:null})),
  // Ledger posting destination only, frozen with this turn (null = none selected; the conversation, saves and approval stay available).
  postingCompany:postingCompanyView(postingCompany)}
 const updated=await Chat.findOneAndUpdate({_id:c._id,revision:body.chatRevision,state:{$nin:pending}},{$set:{state:'queued',currentId:requestId,context,attempts:0},$unset:{lease:'',leaseUntil:'',agentId:''},$inc:{revision:1},$push:{turns:{id:requestId,text,requestHash,at:new Date(),...(references.length?{references}:{}),...(postingCompany?{postingCompany}:{})}}},{new:true}).lean()
 if(!updated)fail(409,'会話が更新されました。再読込してください。')
 return getChat(ownerId,importId,line,postingCompany)
}
export async function retryChat(ownerId:string,importId:string,line:number,body:any,postingCompany:PostingCompany|null=null){
 await init();const d=await readDraft(ownerId,importId,line);bound(d,body);editable(d)
 const c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 // A draft revision this turn's own completed action produced is not a foreign change: the retry reconciles those receipts first.
 const produced=!!c&&draftActionRevision(c,await actionReceipts('purchase',String(c._id),c.currentId))===d.revision
 if(!c||c.state!=='failed'||body.chatRevision!==c.revision||(c.context.fingerprint!==fingerprint(d.values)&&!produced))fail(409,'新しいメッセージとして送信してください。')
 await Chat.updateOne({_id:c._id,revision:c.revision,state:'failed'},{$set:{state:'queued',attempts:0},$inc:{revision:1}})
 return getChat(ownerId,importId,line,postingCompany)
}
export async function claimChat(agent:any){
 const scope={ownerId:agent.ownerId,accountId:{$in:agent.accountIds}}
 await Chat.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed'},$inc:{revision:1},$unset:{lease:'',leaseUntil:''}})
 const lease=randomUUID(),c:any=await Chat.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',lease,leaseUntil:new Date(Date.now()+120000),agentId:agent._id},$inc:{attempts:1,revision:1}},{sort:{updatedAt:1},new:true}).lean()
 if(!c)return {job:null}
 const turn=c.turns.find((t:any)=>t.id===c.currentId)
 // A reclaim reconciles the previous attempt's claimed operations from their domain markers before the model runs again, and the
 // job carries their receipts, the next free slot, the stored references and the named tools it may call.
 const {receipts,nextSlot}=await reconcileActions('purchase',String(c._id),turn.id)
 // Same-company teachings and tools only with the turn's frozen company, a workspace-capable worker and a membership read now; a
 // card-only worker keeps this original purchase chat with no company data, and earlier messages of another company's context are withheld.
 const bridge:any=await companyClaim(Chat,c,turn,agent,lease,[c.context?.source?.description])
 return {job:{id:String(c._id),lease,text:turn.text,context:{...c.context,messages:bridge.messages},tools:[...actionTools('purchase'),...(bridge.authority?teachingTools('purchase'):[])],actions:receipts,nextSlot,references:turn.references||[],...(bridge.authority?{teachingCompany:{name:bridge.authority.name},knowledge:bridge.knowledge,knowledgeActiveTotal:bridge.knowledgeActiveTotal}:{})}}
}
export async function finishChat(agent:any,chatId:string,body:any){
 if(typeof body?.lease!=='string')fail(400,'Missing lease')
 const filter={_id:id(chatId),ownerId:agent.ownerId,accountId:{$in:agent.accountIds},agentId:agent._id,state:'working',lease:body.lease,leaseUntil:{$gt:new Date()}}
 const c:any=await Chat.findOne(filter).lean();if(!c)fail(409,'Teaching job changed')
 const index=c.turns.findIndex((t:any)=>t.id===c.currentId),turn=c.turns[index]
 let proposal:any
 if(body.failed!==true){try{proposal=validateChatProposal(body.proposal,c.context,turn.text)}catch{fail(400,'Invalid teaching proposal')}}
 // A turn that used a company's teachings keeps no reply when that company can no longer be confirmed now (it settles as failed).
 if(proposal&&await companyContextLost(agent,c.ownerId,turn))proposal=undefined
 const actions=await actionReceipts('purchase',chatId,turn.id)
 // An explanation requests research against this turn's accepted save, or the original context when it saved nothing. The original
 // key/source binding remains; a later owner edit is still refused by the research service. A proposal defers research
 // to the confirmation (queued now it would bind to the pre-confirm draft and go stale on confirm).
 let research:any=null
 if(proposal?.research){
  const request={instruction:proposal.research.instruction,at:new Date()}
  if(proposal.kind==='unclear'){const started=await chatResearch(String(agent.ownerId),String(c.importId),c.line,String(c._id),turn.id,request.instruction,{revision:draftActionRevision(c,actions)??c.context.revision,key:c.context.key,sourceHash:c.context.sourceHash});research={...request,when:'now',...('unavailable' in started?{unavailable:started.unavailable}:{requestId:started.requestId})}}
  else research={...request,when:'confirm'}
 }
 // A proposal gets its immutable display reference; the turn's action receipts come from the journal (a failed final response
 // keeps every completed action). Only this turn's fields are set, never the whole array from this read.
 const reference=proposal?.kind==='proposal'?chatProposalReference(c,{...turn,proposal},c.context.revision):null
 const set:any={state:proposal?'ready':'failed','turns.$[turn].answeredAt':new Date(),...(proposal?{'turns.$[turn].proposal':proposal}:{}),...(research?{'turns.$[turn].research':research}:{}),...(reference?{'turns.$[turn].reference':reference}:{}),'turns.$[turn].actions':actions}
 // A saved readable reply advances this turn's replyVersion in the same lease-checked write (closed Navi status); a failure does not.
 const result=await Chat.updateOne(filter,{$set:set,$unset:{lease:'',leaseUntil:''},$inc:{revision:1,...(proposal?{'turns.$[turn].replyVersion':1}:{})}},{arrayFilters:[{'turn.id':turn.id}]})
 if(!result.matchedCount)fail(409,'Teaching job changed');return {success:true}
}
// Explicit new chat and archived history of one purchase conversation: the purchase must be the owner's (readDraft refuses otherwise);
// only the chat resets, the draft, research, memories and ledger stay; an archived proposal can never be applied or confirmed. A New chat
// may name the client's uncertain earlier send (pending: its request id, text, draft binding and references), normalised with the send's
// own identity rules: context for the answer only. An absent conversation is fenced as its row created from this owned draft's identity
// and card account. No tool, permission, cancellation or resend; without it New chat is unchanged and the response carries no `reset`.
export async function newChat(ownerId:string,importId:string,line:number,body:any,postingCompany:PostingCompany|null=null){
 await init();const d=await readDraft(ownerId,importId,line),scope=identity(ownerId,importId,line)
 const pending=body?.pending===undefined||body?.pending===null?null:{...purchaseRequestIdentity(body.pending),organizationId:postingCompany?.organizationId||null}
 const answer=await startNewOwnerConversation('purchase',scope,body,pending,pending?{...scope,accountId:d.source.account.id}:null)
 const view=await getChat(ownerId,importId,line,postingCompany)
 return pending?{...view,reset:{requestId:body.requestId,scope:{actorId:String(ownerId),realm:'purchase',importId:String(importId),line},pending:answer}}:view
}
export async function chatHistory(ownerId:string,importId:string,line:number,query:any,postingCompany:PostingCompany|null=null){await init();await readDraft(ownerId,importId,line);return listOwnerConversationArchives('purchase',identity(ownerId,importId,line),postingCompany?.organizationId||null,query)}
export async function chatArchive(ownerId:string,importId:string,line:number,archiveId:string,postingCompany:PostingCompany|null=null){await init();await readDraft(ownerId,importId,line);return getOwnerConversationArchive('purchase',identity(ownerId,importId,line),postingCompany?.organizationId||null,archiveId)}
// A named Navi action on this worker's claimed conversation (lease-bound; see financeActionService).
export async function actionChat(agent:any,chatId:string,body:any){await init();return runAction(agent,'purchase',chatId,body)}
// Shared acceptance of a displayed chat proposal: the one draft save (the chat-review marker makes a retry find its own write) and
// the deferred research start bound to the accepted revision, then the turn is marked confirmed. Used by the existing confirm button
// (the current turn, under the conversation's confirming lock) and by the explicit later command (the referenced earlier turn).
async function acceptProposalDraft(ownerId:string,importId:string,line:number,c:any,turn:any,d:any,proposal:any,values:any,remember:boolean,operation?:DraftOperation){
 return (await saveDraft(ownerId,importId,line,{revision:d.revision,key:d.key,sourceHash:d.sourceHash,values,remember:[],confirm:false},{reviewId:String(c._id),replyTs:turn.id,text:turn.text,summary:proposal.summary,fields:Object.keys(proposal.patch),reusable:remember,channel:'web'},undefined,undefined,operation)).revision
}
async function settleAcceptedTurn(ownerId:string,importId:string,line:number,c:any,turn:any,accepted:number,remember:boolean,finalState:string|null){
 // Deferred research starts only after the draft save succeeded, bound to the accepted revision; its result lands in the same final write.
 const started=turn.research?.when==='confirm'&&!turn.research.requestId&&!turn.research.unavailable&&Number.isSafeInteger(accepted)?await chatResearch(ownerId,importId,line,String(c._id),turn.id,turn.research.instruction,{revision:accepted,key:c.context.key,sourceHash:c.context.sourceHash}):null
 const unset:any={...(finalState?{lease:'',leaseUntil:''}:{}),...(started&&!('unavailable' in started)?{'turns.$[turn].research.unavailable':''}:{})}
 await Chat.updateOne({_id:c._id,...(finalState?{currentId:turn.id}:{})},{$set:{...(finalState?{state:finalState}:{}),'turns.$[turn].confirmedAt':new Date(),'turns.$[turn].remembered':remember,...(started?researchMarker(started):{})},...(Object.keys(unset).length?{$unset:unset}:{}),$inc:{revision:1}},{arrayFilters:[started?researchFilter(turn.id,started):{'turn.id':turn.id}]})
}
export async function confirmChat(ownerId:string,importId:string,line:number,body:any,postingCompany:PostingCompany|null=null){
 await init();if(typeof body?.remember!=='boolean')fail(400,'記憶の範囲を確認してください。')
 const c:any=await Chat.findOne(identity(ownerId,importId,line)).lean()
 if(!c||body.turnId!==c.currentId)fail(409,'最新の提案を確認してください。')
 const turn=c.turns.find((t:any)=>t.id===c.currentId)
 if(turn.proposal?.kind!=='proposal')fail(409,'反映する提案がありません。')
 const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).lean()
 const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===turn.id&&h.channel==='web')
 if(applied&&applied.reusable!==body.remember)fail(409,'既に別の記憶範囲で反映済みです。')
 let accepted:number=applied?.revision
 if(!applied){
  if(body.chatRevision!==c.revision||!['ready','confirming'].includes(c.state)||(c.state==='confirming'&&c.leaseUntil>new Date()))fail(409,'会話が更新されたか、反映処理が進行中です。')
  const d=await readDraft(ownerId,importId,line);bound(d,body);editable(d)
  if(d.revision!==c.context.revision||fingerprint(d.values)!==c.context.fingerprint)fail(409,'会話の後に下書きや判断の根拠が変わりました。再読込して新しいメッセージを送信してください。')
  const proposal=validateChatProposal(turn.proposal,c.context,turn.text),values={...d.values,...proposal.patch}
  if(body.remember&&!reusableClassification(proposal,values))fail(400,'顧客・用途が明確な提案だけを記憶できます。')
  const lease=randomUUID(),locked=await Chat.updateOne({_id:c._id,revision:c.revision,state:c.state},{$set:{state:'confirming',lease,leaseUntil:new Date(Date.now()+120000)}})
  if(!locked.matchedCount)fail(409,'会話が更新されました。')
  try{accepted=await acceptProposalDraft(ownerId,importId,line,c,turn,d,proposal,values,body.remember)}
  catch(e){await Chat.updateOne({_id:c._id,lease},{$set:{state:'ready'},$unset:{lease:'',leaseUntil:''}});throw e}
 }
 await settleAcceptedTurn(ownerId,importId,line,c,turn,accepted,body.remember,'confirmed')
 return {...await getChat(ownerId,importId,line,postingCompany),draft:await readDraft(ownerId,importId,line)}
}
// The explicit later command ("register it like that"): applies the STORED reference of an earlier displayed proposal turn, not the
// current turn and not model-supplied values. The draft must still be the one the proposal was displayed against; a changed draft,
// an edited or foreign reference or an applied proposal is refused with one message. Called by the action service under its journal.
export async function applyChatProposal(ownerId:string,importId:string,line:number,c:any,ref:ProposalReference,remember:boolean,operation:DraftOperation){
 const turn=c.turns.find((t:any)=>t.id===ref.turnId)
 if(!turn?.reference||turn.proposal?.kind!=='proposal'||!sameProposalReference(turn.reference,ref)||proposalHash(chatProposalContent(turn.proposal))!==ref.hash)fail(409,'表示されていた提案が変わりました。再読込してください。')
 const saved:any=await FinanceDraft.findOne({ownerId,importId,line}).lean()
 const applied=saved?.history.find((h:any)=>h.reviewId===String(c._id)&&h.replyTs===turn.id&&h.channel==='web')
 if(applied&&applied.reusable!==remember)fail(409,'既に別の記憶範囲で反映済みです。')
 let accepted:number=applied?.revision
 if(!applied){
  const d=await readDraft(ownerId,importId,line);editable(d)
  if(d.revision!==ref.draftRevision||d.key!==ref.key||d.sourceHash!==ref.sourceHash)fail(409,'提案の後に下書きが変わりました。現在の下書きを確認してから、改めて指示してください。')
  const proposal=validateChatProposal(turn.proposal,{values:d.values,customers:c.context.customers},turn.text),values={...d.values,...proposal.patch}
  if(remember&&!reusableClassification(proposal,values))fail(400,'顧客・用途が明確な提案だけを記憶できます。')
  accepted=await acceptProposalDraft(ownerId,importId,line,c,turn,d,proposal,values,remember,operation)
 }
 if(!turn.confirmedAt)await settleAcceptedTurn(ownerId,importId,line,c,turn,accepted,remember,null)
 return {revision:accepted,fields:Object.keys(turn.proposal.patch),draftId:saved?String(saved._id):String((await FinanceDraft.findOne({ownerId,importId,line}).select('_id').lean())?._id||''),turnId:turn.id}
}

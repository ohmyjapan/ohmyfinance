import {randomUUID} from 'node:crypto'
import {FinanceAssistant as Conversation} from '../models/FinanceAssistant'
import {FinanceChatAgent as Agent} from '../models/FinanceChat'
import {FinancialAccount,FinanceImport} from '../models/Finance'
import {learningOverview,learningDetail} from './financeLearningService'
import {ready,fail,id,ownedImport,reviewMapping} from './financeService'
import {assistantPages,validateAssistantReply} from '../../shared/finance-assistant.mjs'
async function init(){await ready();await Conversation.init()}
const visible=(c:any)=>c?{id:String(c._id),revision:c.revision,state:c.state,currentId:c.currentId,turns:c.turns}:null
const available=(ownerId:string)=>Agent.findOne({ownerId,enabled:true,revokedAt:null,workspaceEnabled:true,lastSeenAt:{$gt:new Date(Date.now()-65000)}}).sort({lastSeenAt:-1}).lean()
export async function getAssistant(ownerId:string){await init();return {conversation:visible(await Conversation.findOne({ownerId}).lean()),connected:!!await available(ownerId)}}
async function pageContext(ownerId:string,input:any){
 if(!input||!Object.hasOwn(assistantPages,input.page))fail(400,'Invalid assistant page')
 const context:any={mode:'workspace',page:input.page,pageName:assistantPages[input.page],currency:'JPY',capabilities:['Explain supplied evidence and page purpose','For purchase changes select a statement and confirm its proposal','Never change ledger or settings from general conversation'],facts:{}}
 const overview=await learningOverview(ownerId)
 context.facts.learning=overview.dataset?{title:overview.dataset.title,summary:overview.dataset.summary,counts:overview.counts}:null
 context.facts.instructions=overview.policies.filter((p:any)=>p.status==='active').slice(0,30).map((p:any)=>({title:p.title,reason:p.reason,scope:p.accountName||'指定された口座範囲',decision:p.decision,effectiveFrom:p.effectiveFrom||''}))
 context.facts.customers=overview.customers.map((c:any)=>({id:String(c._id),name:c.name}))
 context.facts.accounts=await FinancialAccount.find({ownerId,active:true}).select('name primaryCard').lean()
 if(input.patternId){if(input.page!=='learning')fail(400,'Choose a learning pattern');const detail:any=await learningDetail(ownerId,id(input.patternId),{});context.facts.pattern={...detail.pattern,audit:undefined};context.facts.sourceExamples=detail.items.slice(0,8).map((r:any)=>({sheet:r.sheet,row:r.row,date:r.date,merchant:r.parsed.merchant,customer:r.parsed.customer,amount:r.parsed.amount}));context.facts.sourceExampleLimit=8}
 if(input.importId){if(input.page!=='mapping')fail(400,'Choose a statement');const batch=await ownedImport(ownerId,id(input.importId));context.facts.statement={id:String(batch._id),period:batch.period,rows:batch.rows.length,expenses:batch.rows.filter((r:any)=>r.kind==='expense').length}}
 if(input.page==='mapping'||input.page==='connections'){context.facts.imports=await FinanceImport.find({ownerId}).select('accountId period createdAt').sort({createdAt:-1}).limit(10).lean();context.facts.importLimit=10}
 if(input.page==='mapping'){
  const imports:any[]=await FinanceImport.find({ownerId}).select('accountId').sort({createdAt:-1}).limit(101).lean()
  const seen=new Set<string>(), selected=input.importId?[input.importId]:imports.slice(0,100).filter(b=>{const key=String(b.accountId);if(seen.has(key))return false;seen.add(key);return true}).map(b=>String(b._id))
  const statements=[]
  for(const importId of selected){
   const batch=await reviewMapping(ownerId,importId),rows=batch.rows.filter((r:any)=>['customer','company','unresolved'].includes(r.purpose)),states:Record<string,number>={},missing:Record<string,number>={}
   for(const row of rows){const p=row.preparation;states[p.label]=(states[p.label]||0)+1;for(const f of p.missing)missing[f.label]=(missing[f.label]||0)+1}
   statements.push({account:batch.account.name,period:batch.period,expenses:rows.length,states,missing,invoiceNumberMissing:rows.filter((r:any)=>!r.preparation.invoice.number).length,invoiceReviewPending:rows.filter((r:any)=>r.preparation.invoice.status!=='confirmed').length,taxRateMissing:rows.filter((r:any)=>r.preparation.tax.rate===null).length})
  }
  context.facts.mappingPreparation={scope:input.importId?'selected_statement':'latest_import_per_account',importListTruncated:!input.importId&&imports.length>100,statements,meaning:'Draft preparation only. Missing invoice numbers need verification, not an automatic exemption or legal rejection. Blank consumption-tax percentage is unknown, not zero. Counts include already posted/excluded rows where indicated by states; nothing is posted by this review.'}
 }
 context.facts.pageGuide={dashboard:'Overview page. No live balance totals are included in this context.',transactions:'Saved ledger transactions. Mapping is the statement review stage before posting. No transaction rows or totals are included in this context.',mapping:'Review imported card statements, distinguish classification decisions from accounting input, and show invoice registration number and consumption-tax percentage gaps. Use mappingPreparation for the current batch scope. Source category registration adds literal source labels; it does not determine expense accounts or tax rates. Choose a row to discuss and confirm purpose/customer/product changes.',draft:'A purchase draft can be discussed using the current-purchase button. General conversation is separate from its saved values.',learning:'Source workbook history, classification candidates and confirmed instructions. A means user-confirmed classification, B means consistent historical evidence. Scores are not tax accuracy probabilities. Blank customer does not by itself mean company expense.',connections:'Configured card accounts and downloaded statements. Credentials and OTP details are not included.',settings:'Application settings. The assistant cannot change these settings.',reports:'Reports page. No report numbers are included in this context.',other:'Only the supplied general context is available.'}[input.page]
 return context
}
export async function sendAssistant(ownerId:string,body:any){
 await init()
 if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.text)||!/^[-a-zA-Z0-9]{16,64}$/.test(body.requestId||''))fail(400,'メッセージを入力してください（2000文字以内）。')
 let c:any=await Conversation.findOne({ownerId}).lean()
 const previous=c?.turns.find((t:any)=>t.id===body.requestId)
 if(previous){if(previous.text!==body.text.trim())fail(409,'送信IDが既に使用されています。');return getAssistant(ownerId)}
 if(c&&['queued','working'].includes(c.state))fail(409,'前の回答をお待ちください。')
 if(body.chatRevision!==(c?.revision||0))fail(409,'会話が更新されました。再読込してください。')
 if((c?.turns.length||0)>=200)fail(409,'会話が200件に達しました。管理者に確認してください。')
 const agent:any=await available(ownerId);if(!agent)fail(409,'AIに接続できません。少し待って再試行してください。')
 const context=await pageContext(ownerId,body.context)
 context.messages=(c?.turns||[]).slice(-8).map((t:any)=>({text:t.text,response:t.proposal?.summary||'',page:t.pageName,selection:t.selection||null}))
 if(!c){try{c=(await Conversation.create({ownerId})).toObject()}catch(e:any){if(e.code===11000)fail(409,'会話が更新されました。再読込してください。');throw e}}
 const r=await Conversation.updateOne({_id:c._id,revision:body.chatRevision,state:{$nin:['queued','working']}},{$set:{state:'queued',currentId:body.requestId,context,agentId:agent._id,attempts:0},$inc:{revision:1},$unset:{lease:'',leaseUntil:''},$push:{turns:{id:body.requestId,text:body.text.trim(),at:new Date(),pageName:context.pageName,selection:context.facts.pattern?.merchantLabel||null}}})
 if(!r.matchedCount)fail(409,'会話が更新されました。再読込してください。');return getAssistant(ownerId)
}
export async function retryAssistant(ownerId:string,body:any){
 await init();const agent:any=await available(ownerId);if(!agent)fail(409,'AIに接続できません。')
 if(!Number.isSafeInteger(body?.chatRevision))fail(400,'Invalid conversation revision')
 const r=await Conversation.updateOne({ownerId,state:'failed',revision:body.chatRevision},{$set:{state:'queued',agentId:agent._id,attempts:0},$inc:{revision:1}})
 if(!r.matchedCount)fail(409,'会話が更新されました。再読込してください。');return getAssistant(ownerId)
}
export async function claimAssistant(agent:any){
 if(!agent.workspaceEnabled)return {job:null};await Conversation.init()
 const scope={ownerId:agent.ownerId,agentId:agent._id}
 await Conversation.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed'},$inc:{revision:1},$unset:{lease:'',leaseUntil:''}})
 const lease=randomUUID(),c:any=await Conversation.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',lease,leaseUntil:new Date(Date.now()+120000)},$inc:{attempts:1,revision:1}},{new:true}).lean()
 if(!c)return {job:null};const turn=c.turns.find((t:any)=>t.id===c.currentId)
 return {job:{id:String(c._id),mode:'workspace',lease,text:turn.text,context:c.context}}
}
export async function finishAssistant(agent:any,chatId:string,body:any){
 if(!agent.workspaceEnabled)fail(403,'Workspace conversation access required')
 if(typeof body?.lease!=='string')fail(400,'Missing lease')
 const filter={_id:id(chatId),ownerId:agent.ownerId,agentId:agent._id,state:'working',lease:body.lease,leaseUntil:{$gt:new Date()}}
 const c:any=await Conversation.findOne(filter).lean();if(!c)fail(409,'Conversation job changed')
 let proposal:any;if(body.failed!==true){try{proposal=validateAssistantReply(body.proposal)}catch{fail(400,'A general conversation cannot edit a purchase')}}
 const turns=c.turns.map((t:any)=>t.id===c.currentId?{...t,...(proposal?{proposal}:{}),answeredAt:new Date()}:t)
 const r=await Conversation.updateOne(filter,{$set:{turns,state:proposal?'ready':'failed'},$inc:{revision:1},$unset:{lease:'',leaseUntil:''}})
 if(!r.matchedCount)fail(409,'Conversation job changed');return {success:true}
}

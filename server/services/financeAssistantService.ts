import { claimCompanyAssistant, isCompanyAssistantJob, finishCompanyAssistant, actionCompanyAssistant } from './financeCompanyAssistantService'
import {randomUUID,createHash} from 'node:crypto'
import {FinanceAssistant as Conversation} from '../models/FinanceAssistant'
import {FinanceChatAgent as Agent} from '../models/FinanceChat'
import {FinancialAccount,FinanceImport} from '../models/Finance'
import {learningOverview,learningDetail} from './financeLearningService'
import {ready,fail,id,ownedImport,reviewMapping} from './financeService'
import {assistantPages,validateAssistantReply} from '../../shared/finance-assistant.mjs'
import {canonicalJson} from '../../shared/finance-action-proposal.mjs'
import {actionTools,teachingTools,reconcileActions,actionReceipts,conversationReceipts,runAction} from './financeActionService'
import {startNewOwnerConversation,listOwnerConversationArchives,getOwnerConversationArchive,archiveDiscussion,ownerTurnLimits,findOwnerReceivedRequest,sameOwnerRequestId,sameOwnerRequestMeaning} from './financeOwnerConversationService'
import {companyClaim,companyContextLost,maskTurns} from './financeOwnerCompanyKnowledgeService'
import {readRecord as readIntakeRecord,readSheet as readIntakeSheet} from './financeIntakeService'
import {paymentView as readOwnedPayment} from './financePaymentMatchService'
import {postingCompanyView,type PostingCompany} from './financeNaviPostingService'
async function init(){await ready();await Conversation.init()}
// A turn that used one company's teachings is shown only while that same company is the checked selection (masked otherwise).
const visible=(c:any,postingCompany:PostingCompany|null=null)=>c?{id:String(c._id),revision:c.revision,state:c.state,currentId:c.currentId,segment:c.segment||0,turnLimit:ownerTurnLimits.workspace,turns:maskTurns(c.turns,postingCompany?.organizationId||null)}:null
const available=(ownerId:string)=>Agent.findOne({ownerId,enabled:true,revokedAt:null,workspaceEnabled:true,chatLastSeenAt:{$gt:new Date(Date.now()-65000)}}).sort({chatLastSeenAt:-1}).lean()
const withReceipts=(c:any)=>conversationReceipts('workspace',c)
// postingCompany: the token-selected company checked by the route for this request (display only; a turn keeps the one frozen at its send).
export async function getAssistant(ownerId:string,postingCompany:PostingCompany|null=null){await init();return {conversation:visible(await withReceipts(await Conversation.findOne({ownerId}).lean()),postingCompany),connected:!!await available(ownerId),postingCompany:postingCompanyView(postingCompany)}}
// Explicit new chat and archived history of the owner workspace conversation (owner-scoped; see financeOwnerConversationService). A New
// chat may name the client's uncertain earlier send (pending: its request id, text and context), normalised with the send's own identity
// rules: context for the answer only (accepted, live or adopted archive, masked for the company checked now; or not accepted after this
// reset's revision fence, which on an absent conversation is the owner's conversation row itself). No tool, permission, cancellation or
// resend; without it New chat is unchanged and the response carries no `reset`.
export async function newAssistant(ownerId:string,body:any,postingCompany:PostingCompany|null=null){
 await init()
 const pending=body?.pending===undefined||body?.pending===null?null:{...workspaceRequestIdentity(body.pending),organizationId:postingCompany?.organizationId||null}
 const answer=await startNewOwnerConversation('workspace',{ownerId},body,pending,pending?{ownerId}:null)
 const view=await getAssistant(ownerId,postingCompany)
 return pending?{...view,reset:{requestId:body.requestId,scope:{actorId:String(ownerId),realm:'workspace'},pending:answer}}:view
}
export async function assistantHistory(ownerId:string,query:any,postingCompany:PostingCompany|null=null){await init();return listOwnerConversationArchives('workspace',{ownerId},postingCompany?.organizationId||null,query)}
export async function assistantArchive(ownerId:string,archiveId:string,postingCompany:PostingCompany|null=null){await init();return getOwnerConversationArchive('workspace',{ownerId},postingCompany?.organizationId||null,archiveId)}
async function pageContext(ownerId:string,input:any,postingCompany:PostingCompany|null=null){
 if(!input||!Object.hasOwn(assistantPages,input.page))fail(400,'Invalid assistant page')
 const context:any={mode:'workspace',page:input.page,pageName:assistantPages[input.page],currency:'JPY',capabilities:['Explain supplied evidence and page purpose','For purchase changes select a statement and confirm its proposal','Change a draft, ledger posting or card setting only with a supplied named tool on an explicit instruction in the CURRENT message, under its native checks; a question, suggestion or earlier/archived message never authorises a write'],facts:{}}
 // An archived conversation the owner explicitly chose to discuss: a bounded server copy (never a body), masked for the current company.
 if(input.archiveId!==undefined)context.facts.discussedArchive=await archiveDiscussion(ownerId,id(input.archiveId),postingCompany?.organizationId||null)
 if(input.page==='intake-payments'){
  // Selection is an owned pointer only. Financial rows/evidence are fetched through the claimed agent's live card scope.
  context.capabilities=['Read assigned card payment matches and intake payment evidence with the supplied named tools','Bank payments and unassigned cards are unavailable in these tools; totals are partial and are not bank balances','On an explicit instruction in the CURRENT message, confirm_card_allocation, release_card_allocation and reconfirm_card_allocation change one allocation of an assigned-card charge to an intake record, using the current revisions read with get_card_payment_match and get_record_payment_matches and the native checks; it moves no money and changes no ledger. A capability question never authorises one.','Navi has no bank allocation, bank-row correction or bank CSV import tool and no tool for other or unassigned cards; those are done on the page. These are Navi tool limits, not missing page features. Ledger posting is a separate named action requiring an explicit current user instruction and its native checks.']
  context.facts.pageFeatures=['The signed-in payment-matching page already supports bank CSV upload, column mapping, preview and import.','The page already supports manual allocation confirmation, release and review.','The owner-facing page can also show other owned cards and imported bank rows outside Navi\'s assigned-card scope. The account assignment limits Navi tool results, not which rows the page can display.','Navi cannot run bank imports, allocate bank rows or act on other cards; for an assigned-card charge it can confirm, release or reconfirm one allocation with its named tools on an explicit current instruction. Explain tool-result scope separately from page capabilities.']
  context.facts.bankBalanceEvidence={liveBalance:'This matching page does not connect to a bank to obtain or display a live/current balance.',selectedBankRow:'No bank transaction amount, balance, source-file contents or balance date is supplied to Navi in this context.',sourceFilePreview:'The existing original-file preview shows uploaded cells only. If that file includes a balance, it is evidence of the balance in that source row at its source date, not a live balance. Whether a balance is present, its value and its date have not been established for this selection.'}
  if(input.paymentKind==='card'){
   const importId=id(input.paymentImportId)
   if(!Number.isSafeInteger(input.paymentLine)||input.paymentLine<2)fail(404,'明細が見つかりません。')
   await readOwnedPayment(ownerId,'card',importId,input.paymentLine)
   context.facts.paymentSelection={kind:'card',importId,line:input.paymentLine}
  }else if(input.paymentKind==='bank')context.facts.paymentSelection={kind:'bank',available:false}
  else if(input.paymentKind!==undefined)fail(400,'Invalid payment selection')
  context.facts.pageGuide='支払い照合の画面です。接続担当に許可されたカードの配分・候補・履歴・会社とT番号の根拠を、参照ツールで確認できます。金額が一致するだけでは購入を断定しません。Naviのツール結果の集計には範囲外のカードと銀行の支払いを含まないため、未払い総額や銀行残高として説明しないでください。これはNaviの参照範囲であり、画面全体の表示範囲ではありません。所有者向けの画面には他のカードや取込済み銀行明細も表示できます。銀行が選択中なら以前のカードを対象にせず、Naviには銀行参照ツールがまだないと説明します。この制限はAIチャットの操作範囲です。画面には銀行CSVの取込・列マッピング・プレビューと、手動での配分の確定・解除・確認が既にあります。割り当てられたカードの明細については、Naviも現在のメッセージでの明示的な指示があれば、名前付きのツールで受付への配分を1件ずつ確定・解除・再確定できます（機能についての質問だけでは実行しません）。銀行明細の配分・銀行CSVの取込・他のカードは画面で行います。Naviが代行できないことを、画面自体にその機能がない、または未実装であると説明しないでください。この照合画面は銀行に接続して現在残高を取得・表示するものではありません。原本プレビューで残高を見られるのはファイルにその値がある場合だけで、その原本の行・基準日時点の情報です。この会話には選択した銀行明細の残高値・基準日や原本の内容は提供されていません。'
  return context
 }
 const overview=await learningOverview(ownerId)
 context.facts.customerPurchaseContexts=overview.customerPurchaseContexts
 context.facts.learning=overview.dataset?{title:overview.dataset.title,summary:overview.dataset.summary,counts:overview.counts}:null
 context.facts.instructions=overview.policies.filter((p:any)=>p.status==='active').slice(0,30).map((p:any)=>({title:p.title,reason:p.reason,scope:p.accountName||'指定された口座範囲',decision:p.decision,effectiveFrom:p.effectiveFrom||''}))
 context.facts.customers=overview.customers.map((c:any)=>({id:String(c._id),name:c.name}))
 // The owner-wide inventory of active cards, named for what it is. The claiming worker's actual card tool scope is a separate fact
 // built at every claim (cardToolScope below), never this list.
 context.facts.ownerCardAccounts=await FinancialAccount.find({ownerId,active:true}).select('name primaryCard').lean()
 if(input.page==='intake'){
  context.capabilities=['Read owned purchase intake, uploaded sheets, import history/templates and company/T-number research using the supplied named tools','On explicit user instruction create/edit/archive intake, apply a previewed import, save its template, queue or confirm research using current native revisions; a tool receipt is the outcome, not a promise','On an explicit instruction in the CURRENT message, confirm_card_allocation, release_card_allocation and reconfirm_card_allocation change one allocation of an assigned-card charge to an intake record, using current revisions read with get_card_payment_match and get_record_payment_matches; bank allocations, bank CSV import and other or unassigned cards stay on the payment-matching page; a capability question never authorises one','Unresolved or partial writes need inspection, never a blind repeat','Distinguish confirmed saved history from a hypothesis; distinguish published T numbers from native NTA verified:true']
  if(input.recordId){const r:any=await readIntakeRecord(ownerId,id(input.recordId));context.facts.intakeRecord={id:r.id,revision:r.revision,values:r.values,extra:r.extra,archived:r.archived,identityReview:r.identityReview,history:r.history.slice(-12),historyLimit:12,provenance:r.provenance}}
  if(input.documentId)context.facts.intakeSheet=await readIntakeSheet(ownerId,id(input.documentId),input.sheet,input.headerRow)
 }
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
 context.facts.pageGuide={dashboard:'Overview page. No live balance totals are included in this context.',transactions:'Saved ledger transactions. Mapping is the statement review stage before posting. No transaction rows or totals are included in this context.',mapping:'Review imported card statements, distinguish classification decisions from accounting input, and show invoice registration number and consumption-tax percentage gaps. Use mappingPreparation for the current batch scope. Source category registration adds literal source labels; it does not determine expense accounts or tax rates. Choose a row to discuss and confirm purpose/customer/product changes.',draft:'A purchase draft can be discussed using the current-purchase button. General conversation is separate from its saved values.',learning:'Source workbook history, classification candidates and confirmed instructions. A means user-confirmed classification, B means consistent historical evidence. Scores are not tax accuracy probabilities. Blank customer does not by itself mean company expense.',connections:'Configured card accounts and downloaded statements. Credentials and OTP details are not included.',settings:'Application settings. The assistant cannot change these settings.',reports:'Reports page. No report numbers are included in this context.',other:'Only the supplied general context is available.'}[input.page as keyof typeof assistantPages]
 if(input.page==='intake')context.facts.pageGuide='所有者の受付・履歴・原本・会社と登録番号の調査を確認できます。日本の経理担当者として根拠と推測を区別し、韓国語または日本語で自然に説明してください。保存の指示には対応するツールを実行し、保存済みと提案を区別してください。編集・アーカイブ・調査は最新の受付と調査を読み、取得した改訂を使います。取込前にプレビューし、会社とT番号の保存前に根拠を提示して利用者の指示を確認します。調査の受付は完了ではなく、保存は国税庁確認ではありません。一部保存・結果不明は自動で繰り返さず状態を調べます。'
 return context
}
// One request identity for a send and for the uncertain request a New chat names: the existing text and id checks (same refusal), the
// canonical string id, and the hash of its exact text and page context as sent (never the conversation revision or the selected company,
// which the turn freezes separately), so an uncertain request matches its accepted turn exactly.
function workspaceRequestIdentity(body:any){
 if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.text)||!/^[-a-zA-Z0-9]{16,64}$/.test(body.requestId||''))fail(400,'メッセージを入力してください（2000文字以内）。')
 const text=body.text.trim()
 return {requestId:String(body.requestId),text,requestHash:createHash('sha256').update(canonicalJson({text,context:body.context===undefined?null:body.context})).digest('hex')}
}
export async function sendAssistant(ownerId:string,body:any,postingCompany:PostingCompany|null=null){
 await init()
 // The checked canonical id (its string form) is the one request id for recognition, the queue (currentId) and the stored turn, so a
 // request accepted with an id sent as a JSON number is claimable and is the same request as its string form.
 const {requestId,text,requestHash}=workspaceRequestIdentity(body)
 let c:any=await Conversation.findOne({ownerId}).lean()
 const previous=c?.turns.find((t:any)=>sameOwnerRequestId(t.id,requestId))
 if(previous){if(!sameOwnerRequestMeaning(previous,{requestHash,text}))fail(409,'送信IDが既に使用されています。');return getAssistant(ownerId,postingCompany)}
 // The same id accepted before a New chat moved it to an adopted archive of this owner's conversation is the same request: answered with
 // that archived turn and its receipts (masked for the company checked now), never queued or executed again; another meaning keeps the
 // 409. Like the live check it precedes every other check, so a later state, page selection or worker absence never hides it.
 const archived:any=c?await findOwnerReceivedRequest('workspace',{ownerId},requestId,c,postingCompany?.organizationId||null):null
 if(archived){if(!sameOwnerRequestMeaning(archived.turn,{requestHash,text}))fail(409,'送信IDが既に使用されています。');return {...await getAssistant(ownerId,postingCompany),received:archived.answer}}
 if(c&&['queued','working'].includes(c.state))fail(409,'前の回答をお待ちください。')
 if(body.chatRevision!==(c?.revision||0))fail(409,'会話が更新されました。再読込してください。')
 if((c?.turns.length||0)>=ownerTurnLimits.workspace)fail(409,'この会話は200件に達しました。「新しい会話」で続けてください。これまでの会話と保存の記録は「履歴」に残ります。')
 const agent:any=await available(ownerId);if(!agent)fail(409,'AIに接続できません。少し待って再試行してください。')
 const context=await pageContext(ownerId,body.context,postingCompany)
 // Ledger posting destination only: the checked token company frozen with this turn (null = none selected; every other action stays available).
 context.facts.postingCompany=postingCompanyView(postingCompany)
 context.facts.postingCompanyMeaning=postingCompany?'Ledger posting (post_selected_approved_rows) in this turn goes to this company only. Discussion, draft saves, memories and approval do not depend on it.':'No company is selected for ledger posting. Discussion, draft saves, memories and approval remain available; ledger posting is refused until the owner selects a company and sends a new instruction.'
 c=await withReceipts(c)
 // Stored server times let the accountant compare a prior reply with later rule audit events; legacy gaps remain unknown.
 // Each earlier message names its turn: the claim withholds a turn that used another company's teachings (financeOwnerCompanyKnowledgeService).
 context.messages=(c?.turns||[]).slice(-8).map((t:any)=>({turnId:t.id,text:t.text,response:t.proposal?.summary||'',page:t.pageName,selection:t.selection||null,actions:t.actions||[],submittedAt:t.at||null,replyRecordedAt:t.proposal?.summary?t.answeredAt||null:null}))
 // The statement the page had selected at send is frozen on the turn: a later navigation cannot retarget this turn's actions.
 const target=context.facts.intakeRecord?{recordId:context.facts.intakeRecord.id}:context.facts.intakeSheet?{documentId:context.facts.intakeSheet.document.id,sheet:context.facts.intakeSheet.sheet,headerRow:context.facts.intakeSheet.headerRow}:context.facts.paymentSelection?.kind==='card'?{importId:context.facts.paymentSelection.importId,line:context.facts.paymentSelection.line}:context.facts.paymentSelection?.kind==='bank'?{paymentKind:'bank'}:context.facts.statement?{importId:String(context.facts.statement.id)}:null
 if(!c){try{c=(await Conversation.create({ownerId})).toObject()}catch(e:any){if(e.code===11000)fail(409,'会話が更新されました。再読込してください。');throw e}}
 const r=await Conversation.updateOne({_id:c._id,revision:body.chatRevision,state:{$nin:['queued','working']}},{$set:{state:'queued',currentId:requestId,context,agentId:agent._id,attempts:0},$inc:{revision:1},$unset:{lease:'',leaseUntil:''},$push:{turns:{id:requestId,text,requestHash,at:new Date(),pageName:context.pageName,selection:context.facts.pattern?.merchantLabel||null,...(postingCompany?{postingCompany}:{}),...(target?{target}:{})}}})
 if(!r.matchedCount)fail(409,'会話が更新されました。再読込してください。');return getAssistant(ownerId,postingCompany)
}
export async function retryAssistant(ownerId:string,body:any,postingCompany:PostingCompany|null=null){
 await init();const agent:any=await available(ownerId);if(!agent)fail(409,'AIに接続できません。')
 if(!Number.isSafeInteger(body?.chatRevision))fail(400,'Invalid conversation revision')
 const r=await Conversation.updateOne({ownerId,state:'failed',revision:body.chatRevision},{$set:{state:'queued',agentId:agent._id,attempts:0},$inc:{revision:1}})
 if(!r.matchedCount)fail(409,'会話が更新されました。再読込してください。');return getAssistant(ownerId,postingCompany)
}
// The claiming worker's actual card tool scope: the same owner, active and assigned-id filters and display fields as list_accounts
// (financeActionService), built at EVERY claim, so a reclaim by another worker carries that worker's grant and an empty grant is an
// explicit empty list (never the owner inventory, never a refusal). It describes the live assignment; it grants nothing, and every
// native action rechecks the assignment when it runs.
async function cardToolScope(agent:any){
 const accounts:any[]=await FinancialAccount.find({ownerId:agent.ownerId,_id:{$in:agent.accountIds},active:true}).select('name provider primaryCard').sort({name:1}).lean()
 return {kind:'assigned_card_accounts',accountIds:accounts.map(a=>String(a._id)),accounts:accounts.map(a=>({id:String(a._id),name:a.name,provider:a.provider||'amex',primaryCard:a.primaryCard||''})),meaning:'The cards the worker answering this turn may read or act on with the card tools of this conversation now: the same owner, active and assigned-account filters and fields as list_accounts, built for this worker at this claim (a reclaim by another worker carries that worker\'s cards). ownerCardAccounts, when present, is the owner-wide inventory of active cards and grants no tool access: a card listed there but not here is unavailable to the tools of this conversation. An empty accounts list means no card is assigned to this worker; the conversation stays available and card tool results are empty. Neither list proves that evaluations, statements or other records exist for a card; every native action rechecks the live assignment when it runs.'}
}
// The job's facts: the saved context with the owner inventory under its explicit name (an older saved `accounts` is projected to
// ownerCardAccounts for this job only; the stored row is not changed, and a context saved without an inventory keeps none) plus the
// claiming worker's cardToolScope.
function claimedFacts(saved:any,scope:any){
 const {accounts:legacy,...facts}=saved||{}
 if(legacy!==undefined&&facts.ownerCardAccounts===undefined)facts.ownerCardAccounts=legacy
 return {...facts,cardToolScope:scope}
}
export async function claimAssistant(agent:any){
 if(!agent.workspaceEnabled)return {job:null};await Conversation.init()
 // The worker recorded at send is only a hint: any live workspace worker of this owner claims the queued turn, and the claim assigns it
 // atomically (the purchase chat's pattern). A live lease is never taken; exhausted work fails for the owner. Actions still run with the
 // claiming worker's own account grants and lease (financeActionService).
 const scope={ownerId:agent.ownerId}
 await Conversation.updateMany({...scope,state:'working',leaseUntil:{$lte:new Date()},attempts:{$gte:2}},{$set:{state:'failed'},$inc:{revision:1},$unset:{lease:'',leaseUntil:''}})
 const lease=randomUUID(),c:any=await Conversation.findOneAndUpdate({...scope,$or:[{state:'queued'},{state:'working',leaseUntil:{$lte:new Date()},attempts:{$lt:2}}]},{$set:{state:'working',lease,leaseUntil:new Date(Date.now()+120000),agentId:agent._id},$inc:{attempts:1,revision:1}},{new:true}).lean()
 if(!c)return claimCompanyAssistant(agent);const turn=c.turns.find((t:any)=>t.id===c.currentId)
 // A reclaim reconciles the previous attempt's claimed operations before the model runs again; the job carries their receipts,
 // the next free slot, the frozen statement selection and the named tools it may call.
 const {receipts,nextSlot}=await reconcileActions('workspace',String(c._id),turn.id)
 // Same-company teachings and tools only with the turn's frozen company, a workspace worker and a membership read now; earlier
 // messages of another company's (or no company's) context are withheld from this job.
 const bridge:any=await companyClaim(Conversation,c,turn,agent,lease)
 // The card tool scope of THIS claiming worker (rebuilt on a reclaim), beside the saved owner inventory.
 const cardScope=await cardToolScope(agent)
 return {job:{id:String(c._id),mode:'workspace',lease,text:turn.text,context:{...c.context,facts:claimedFacts(c.context?.facts,cardScope),messages:bridge.messages},tools:[...actionTools('workspace'),...(bridge.authority?teachingTools('workspace'):[])],actions:receipts,nextSlot,target:turn.target||null,...(bridge.authority?{teachingCompany:{name:bridge.authority.name},knowledge:bridge.knowledge,knowledgeActiveTotal:bridge.knowledgeActiveTotal}:{})}}
}
export async function finishAssistant(agent:any,chatId:string,body:any){
 if(!agent.workspaceEnabled)fail(403,'Workspace conversation access required')
 if(typeof body?.lease!=='string')fail(400,'Missing lease')
 if(await isCompanyAssistantJob(agent,chatId))return finishCompanyAssistant(agent,chatId,body)
 const filter={_id:id(chatId),ownerId:agent.ownerId,agentId:agent._id,state:'working',lease:body.lease,leaseUntil:{$gt:new Date()}}
 const c:any=await Conversation.findOne(filter).lean();if(!c)fail(409,'Conversation job changed')
 let proposal:any;if(body.failed!==true){try{proposal=validateAssistantReply(body.proposal)}catch{fail(400,'A general conversation cannot edit a purchase')}}
 // A turn that used a company's teachings keeps no reply when that company can no longer be confirmed now (it settles as failed).
 if(proposal&&await companyContextLost(agent,c.ownerId,c.turns.find((t:any)=>t.id===c.currentId)))proposal=undefined
 // Only this turn's fields are set (never the whole array from this read); the receipts come from the journal, so a failed final
 // response keeps every completed action. A saved readable reply also advances this turn's replyVersion in the same lease-checked
 // write (closed Navi status); a failure does not.
 const receipts=await actionReceipts('workspace',chatId,c.currentId)
 const r=await Conversation.updateOne(filter,{$set:{state:proposal?'ready':'failed','turns.$[turn].answeredAt':new Date(),...(proposal?{'turns.$[turn].proposal':proposal}:{}),'turns.$[turn].actions':receipts},$inc:{revision:1,...(proposal?{'turns.$[turn].replyVersion':1}:{})},$unset:{lease:'',leaseUntil:''}},{arrayFilters:[{'turn.id':c.currentId}]})
 if(!r.matchedCount)fail(409,'Conversation job changed');return {success:true}
}
// A named Navi action on this worker's claimed workspace conversation (lease-bound; see financeActionService).
export async function actionAssistant(agent:any,chatId:string,body:any){await init();if(!agent.workspaceEnabled)fail(403,'Workspace conversation access required');if(await isCompanyAssistantJob(agent,chatId))return actionCompanyAssistant(agent,chatId,body);return runAction(agent,'workspace',chatId,body)}

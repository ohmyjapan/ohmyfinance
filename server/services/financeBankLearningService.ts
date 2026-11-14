import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {ready,id,fail} from './financeService'
import Learning from '../models/FinanceBankLearning'
import {FinanceCollector} from '../models/Finance'
import {CollectorInstallation} from '../models/FinanceCollectorSecurity'
import {BankAccount,BankTemplate,BankJob,initializePaymentMatching} from '../models/FinancePaymentMatch'
import {companyMembership,companyRole} from '../utils/calendarAccess'
import {LEARNING_MODEL,LEARNING_RUNTIME,LEARNING_STATEMENT_CAPABILITY,LEARNING_LOGIN_CAPABILITY,LEARNING_LOGIN_STOP_CODES,stable,learningAssert,learningOrigin,learningPeriod,validateEvidence,validateRecipe,validateReplay,validateMissing} from '../../shared/finance-bank-learning.mjs'
import {frozenCoverage} from '../../shared/finance-payment-match.mjs'
import {yieldQueuedBalance} from './financeBankBalanceService'
const hash=(v:any)=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex')
const LEASE_MS=180000
const opaque=()=>randomBytes(32).toString('hex'),lease=()=>new Date(Date.now()+LEASE_MS)
const QUEUE_WAIT_MS=15*60000,MAX_WORKER_CLAIMS=3
const testOptions=()=>({test:process.env.NODE_ENV==='test'})
const view=(r:any,account:any=null)=>{
  const active=account?.learningConnector,selected=active?.sessionId===String(r._id)&&active.candidateHash===r.candidateHash
  return {teachLogin:r.teachLogin===true,id:String(r._id),bankAccountId:String(r.bankAccountId),collectorId:String(r.collectorId),installationId:r.installationId,generation:r.generation,state:r.state==='enabled'&&!selected?'verified':r.state,selected,cancellable:!['enabled','cancelled'].includes(r.state),activeSelectionHash:active?.selectionHash||null,entryOrigin:r.entryOrigin,demonstrationPeriod:r.demonstrationPeriod,replayPeriod:r.replayPeriod||null,candidateHash:r.candidateHash||null,missing:r.missing,lastCode:r.lastCode||null,updatedAt:r.updatedAt,enabledAt:r.enabledAt||null,model:r.workerReceipt?.model||null}
}
async function init(){await ready();await initializePaymentMatching();await Learning.init()}
async function member(owner:string,company:any,write=false){await companyMembership(owner,String(company));if(write&&await companyRole(owner,String(company))==='viewer')fail(403,'この会社の閲覧権限では変更できません。')}
async function current(r:any){
  await member(String(r.ownerId),r.companyId,true)
  const device:any=await FinanceCollector.findOne({_id:r.collectorId,ownerId:r.ownerId,bankAccountIds:r.bankAccountId}).lean()
  const installation=await CollectorInstallation.exists({_id:r.installationId,ownerId:r.ownerId,collectorId:r.collectorId,generation:r.generation,origin:r.origin})
  const account:any=await BankAccount.findOne({_id:r.bankAccountId,ownerId:r.ownerId}).lean()
  if(!device||device.revokedAt||!installation||!account)fail(409,'PCまたは口座の接続が変わりました。')
  if(hash(account.connection||null)!==r.connectionHash)fail(409,'銀行の接続設定が変わりました。新しい記録を開始してください。')
  return account
}
async function sweepWaiting(scope:any){
  const now=new Date(),cutoff=new Date(now.getTime()-QUEUE_WAIT_MS),recentResultSince=new Date(now.getTime()-LEASE_MS)
  // Bank execution stays lease-bound; a completed claim-bound delivery may arrive later.
  await Learning.updateMany({...scope,state:{$in:['recording','replaying']},pcLeaseUntil:{$lte:now}},{$set:{state:'needs_demonstration',lastCode:'interrupted_pc_action',missing:['restart_demonstration']}})
  // One worker serves all owners/PCs. A delivered result also covers its pause between claims.
  if(!await Learning.exists({$or:[{state:'developing',leaseUntil:{$gt:now}},{'workerReceipt.at':{$gt:recentResultSince}}]})){
    await Learning.updateMany({...scope,state:'queued',open:true,$or:[{queuedAt:{$lte:cutoff}},{queuedAt:null,updatedAt:{$lte:cutoff}}]},{$set:{state:'failed',lastCode:'worker_failed',missing:['worker_unavailable']}})
  }
}
export async function learningList(owner:string,company:any){
  await init();await member(owner,company)
  await sweepWaiting({ownerId:owner,companyId:company})
  const accounts:any[]=await BankAccount.find({ownerId:owner},{name:1,connection:1,learningConnector:1}).lean()
  const devices:any[]=await FinanceCollector.find({ownerId:owner,bankAccountIds:{$exists:true,$ne:[]}}).lean()
  const installations:any[]=await CollectorInstallation.find({ownerId:owner,collectorId:{$in:devices.map(d=>d._id)}}).lean()
  const rows:any[]=await Learning.find({ownerId:owner,companyId:company}).sort({createdAt:-1}).limit(50).lean()
  const templates:any[]=await BankTemplate.find({ownerId:owner},{name:1}).lean()
  return {sessions:rows.map(r=>view(r,accounts.find(a=>String(a._id)===String(r.bankAccountId)))),accounts:accounts.map(a=>({id:String(a._id),name:a.name})),templates:templates.map(t=>({id:String(t._id),name:t.name})),pcs:installations.map(p=>({id:p._id,name:devices.find(d=>String(d._id)===String(p.collectorId))?.name||'PC',bankAccountIds:(devices.find(d=>String(d._id)===String(p.collectorId))?.bankAccountIds||[]).map(String)}))}
}
export async function learningCreate(owner:string,company:any,body:any){
  await init();await member(owner,company,true)
  if(body?.teachLogin!==undefined&&typeof body.teachLogin!=='boolean')fail(400,'Invalid login recording consent')
  if(body?.companyAccountConfirmed!==true)fail(400,'この口座を選択中の会社で利用することを確認してください。')
  learningPeriod(body.period);learningOrigin(body.entryOrigin,testOptions())
  const account:any=await BankAccount.findOne({_id:id(body.bankAccountId),ownerId:owner}).lean()
  const installation:any=await CollectorInstallation.findOne({_id:String(body.installationId),ownerId:owner}).lean()
  const device:any=installation&&await FinanceCollector.findOne({_id:installation.collectorId,ownerId:owner,bankAccountIds:account?._id}).lean()
  const template:any=await BankTemplate.findOne({_id:id(body.templateId),ownerId:owner}).lean()
  if(!account||!installation||!device||device.revokedAt||!template)fail(403,'所有する口座・接続したPC・明細テンプレートを選んでください。')
  const frozen={headers:template.headers,mapping:template.mapping,amountSign:template.amountSign,revision:template.revision,parserVersion:'bank-template-1',transactionIdConfirmed:String(account?.connection?.templateId||'')===String(template._id)&&account?.connection?.transactionIdConfirmed===true}
  if(!frozen.headers?.length||(!frozen.mapping?.date&&!frozen.mapping?.dateYear))fail(400,'取引日を割り当てた明細テンプレートが必要です。')
  if(await BankJob.exists({ownerId:owner,bankAccountId:account._id,open:true,state:{$in:['running','verification_required']}}))fail(409,'口座の取得が終わってから記録してください。')
  try{
    const row=await Learning.create({teachLogin:body.teachLogin===true,ownerId:owner,companyId:company,bankAccountId:account._id,collectorId:device._id,installationId:installation._id,generation:installation.generation,origin:installation.origin,entryOrigin:body.entryOrigin,template:frozen,connectionHash:hash(account.connection||null),demonstrationPeriod:body.period})
    return {session:view(row)}
  }catch(e:any){if(e.code===11000)fail(409,'この口座はすでに記録・開発中です。');throw e}
}
async function ownerRow(owner:string,company:any,key:string){await init();await member(owner,company,true);const r:any=await Learning.findOne({_id:id(key),ownerId:owner,companyId:company}).lean();if(!r)fail(404,'記録がありません。');return r}
export async function learningOwnerAction(owner:string,company:any,key:string,action:string,body:any){
  const r=await ownerRow(owner,company,key)
  if(action==='cancel'){
    if(r.state==='enabled')fail(409,'使用中の版は取り消せません。')
    await Learning.updateOne({_id:r._id,state:{$ne:'enabled'}},{$set:{state:'cancelled',open:false,leaseUntil:new Date(0),pcLeaseUntil:new Date(0)}});return {ok:true}
  }
  if(action==='disable')return disableLearningSelection(r,body)
  await current(r)
  if(action==='retry-development'){
    // A human retry revokes the old result ACK, but cannot erase or freshen worker activity.
    const changed=await Learning.updateOne({_id:r._id,state:'failed',lastCode:'worker_failed',evidenceHash:r.evidenceHash},{$set:{state:'queued',queuedAt:new Date(),attempts:0,lastCode:null,missing:[]},$unset:{'workerReceipt.payloadHash':'','workerReceipt.epoch':'','workerReceipt.model':'','workerReceipt.tests':''}})
    if(changed.modifiedCount!==1)fail(409,'Development retry unavailable')
    return {ok:true}
  }
  if(action==='replay'){
    learningPeriod(body.period)
    if(stable(body.period)===stable(r.demonstrationPeriod))fail(400,'記録した期間と異なる期間を指定してください。')
    const changed=await Learning.updateOne({_id:r._id,state:'candidate',candidateHash:r.candidateHash},{$set:{replayPeriod:body.period,lastCode:null}})
    if(changed.modifiedCount!==1)fail(409,'候補の状態が変わりました。');return {ok:true}
  }
  if(action==='enable'){
    return enableLearningSelection(r,body)
  }
  if(action==='collect'){
    const account=await current(r)
    if(account.learningConnector?.sessionId!==String(r._id))fail(409,'Select this statement recipe before collecting')
    return queueLearnedStatement(owner,String(r.bankAccountId),body)
  }
  fail(404,'Unknown learning action')
}
const selectionFilter=(expected:any)=>{
  if(expected===null)return {learningConnector:null}
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))fail(400,'Read the current statement selection first')
  return {'learningConnector.selectionHash':expected}
}
async function verifiedVersion(r:any){
  if(!['verified','enabled'].includes(r.state)||!r.replay)fail(409,'Verify the recipe with a fresh period first')
  validateEvidence(r.evidence,testOptions());validateRecipe(r.candidate,r.evidence,r.evidenceHash,testOptions());validateReplay(r.replay,r)
  if(hash(r.evidence)!==r.evidenceHash||hash(r.candidate)!==r.candidateHash)fail(409,'Verified recipe changed')
}
async function enableLearningSelection(r:any,body:any){
  if(body?.attendedConfirmed!==true)fail(400,'Confirm that sign-in remains attended for this statement recipe')
  const account=await current(r);await verifiedVersion(r)
  if(account.learningConnector?.sessionId===String(r._id)&&account.learningConnector?.candidateHash===r.candidateHash)return {selected:true,selectionHash:account.learningConnector.selectionHash,mode:'attended-statement'}
  const expected=selectionFilter(body.expectedSelectionHash)
  if((account.learningConnector?.selectionHash??null)!==body.expectedSelectionHash)fail(409,'Statement selection changed; refresh first')
  // Freeze the version before the account CAS. A crash can leave an enabled-but-unselected version; reads derive selection from the account.
  const saved=await Learning.updateOne({_id:r._id,state:{$in:['verified','enabled']},candidateHash:r.candidateHash},{$set:{state:'enabled',open:false,enabledAt:r.enabledAt||new Date()}})
  if(saved.matchedCount!==1)fail(409,'Recipe state changed')
  const selection:any={schema:1,mode:'attended-statement',sessionId:String(r._id),candidateHash:r.candidateHash,evidenceHash:r.evidenceHash,runtime:LEARNING_RUNTIME,collectorId:String(r.collectorId),installationId:r.installationId,generation:r.generation,companyId:String(r.companyId),activationId:opaque()}
  selection.selectionHash=hash(selection)
  const changed=await BankAccount.updateOne({_id:r.bankAccountId,ownerId:r.ownerId,connection:account.connection||null,...expected},{$set:{learningConnector:selection},$push:{learningConnectorHistory:{$each:[{selection:account.learningConnector||null,at:new Date()}],$slice:-8}}})
  if(changed.matchedCount!==1)fail(409,'Statement selection or connection changed; refresh first')
  return {selected:true,selectionHash:selection.selectionHash,mode:selection.mode}
}
async function disableLearningSelection(r:any,body:any){
  const account:any=await BankAccount.findOne({_id:r.bankAccountId,ownerId:r.ownerId}).lean()
  if(!account)fail(404,'Bank account unavailable')
  const active=account.learningConnector
  if(!active)return {selected:false}
  if(active.sessionId!==String(r._id))fail(409,'Another statement recipe is selected')
  return clearLearningSelection(String(r.ownerId),String(r.bankAccountId),body)
}
// Native bank-owner recovery does not require membership in the learning session's former company: it only removes a selection.
export async function clearLearningSelection(owner:string,accountId:string,body:any){
  await init();const account:any=await BankAccount.findOne({_id:id(accountId),ownerId:owner}).lean()
  if(!account)fail(404,'Bank account unavailable')
  const active=account.learningConnector;if(!active)return {selected:false}
  const changed=await BankAccount.updateOne({_id:account._id,ownerId:owner,...selectionFilter(body?.expectedSelectionHash)},{$set:{learningConnector:null},$push:{learningConnectorHistory:{$each:[{selection:active,at:new Date()}],$slice:-8}}})
  if(changed.matchedCount!==1)fail(409,'Statement selection changed; refresh first')
  await BankJob.updateMany({ownerId:owner,bankAccountId:account._id,state:'queued','snapshot.learned.selectionHash':active.selectionHash},{$set:{state:'superseded',open:false,completedAt:new Date(),lastMessage:'記録した取得手順の選択が解除されたため、この予約は実行しません。'}})
  return {selected:false}
}
async function selectedVersion(account:any){
  const active=account.learningConnector
  if(!active||active.runtime!==LEARNING_RUNTIME||active.mode!=='attended-statement')fail(409,'Select a verified statement recipe first')
  const {selectionHash,...identity}=active
  if(hash(identity)!==selectionHash)fail(409,'Statement selection is invalid')
  const r:any=await Learning.findOne({_id:id(active.sessionId),ownerId:account.ownerId,bankAccountId:account._id,companyId:active.companyId,collectorId:active.collectorId,installationId:active.installationId,generation:active.generation,candidateHash:active.candidateHash,evidenceHash:active.evidenceHash,state:'enabled'}).lean()
  if(!r)fail(409,'Selected recipe unavailable')
  await current(r);await verifiedVersion(r)
  return {r,active}
}
export async function queueLearnedStatement(owner:string,accountId:string,body:any={}){
  await init();const account:any=await BankAccount.findOne({_id:id(accountId),ownerId:owner}).lean();if(!account)fail(404,'Bank account unavailable')
  const {r,active}=await selectedVersion(account)
  if(body.expectedSelectionHash!==undefined&&body.expectedSelectionHash!==active.selectionHash)fail(409,'Statement selection changed')
  const period=body.period|| (account.connection?.coverage?frozenCoverage(account.connection.coverage):null)
  if(!period)fail(400,'取得する期間を指定してください。「銀行の手順を覚える」の日付フォームから明細を取得できます。')
  learningPeriod(period)
  await yieldQueuedBalance(owner,account._id,new Date())
  const old:any=await BankJob.findOne({ownerId:owner,bankAccountId:account._id,open:true,state:{$in:['queued','running','verification_required']}}).lean()
  if(old){if(old.snapshot?.learned?.selectionHash===active.selectionHash&&stable(old.snapshot.coverage)===stable(period))return {job:{jobId:old.jobId,state:old.state,snapshotHash:old.snapshotHash},message:'この期間の取得はすでに予約されています。'};fail(409,'Finish the existing bank job first')}
  const snapshot:any={templateId:null,templateRevision:r.template.revision||0,headers:r.template.headers,mapping:r.template.mapping,amountSign:r.template.amountSign,transactionIdConfirmed:r.template.transactionIdConfirmed===true,parserVersion:r.template.parserVersion,currency:account.currency||'JPY',provider:account.connection?.provider||'learned',variant:account.connection?.variant||null,accountLabel:null,coverage:period,learned:{...active,entryOrigin:r.entryOrigin,candidate:r.candidate}}
  const snapshotHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  let job:any;try{job=await BankJob.create({ownerId:owner,bankAccountId:account._id,jobId:randomUUID(),kind:'retrieve',state:'queued',open:true,requestedAt:new Date(),snapshot,snapshotHash,lastMessage:r.teachLogin?'接続したPCのダウンローダー設定画面で今回のログイン入力をしてください。追加認証はChromeで本人が操作します。':'記録した手順で明細を取得します。接続したPCのChromeで本人がサインインしてください。'})}catch(e:any){if(e.code===11000)fail(409,'Bank job already queued');throw e}
  return {job:{jobId:job.jobId,state:job.state,snapshotHash},message:job.lastMessage}
}
export function learnedClaimScope(device:any,body:any){
  const capable=Array.isArray(body?.capabilities)&&body.capabilities.includes(LEARNING_STATEMENT_CAPABILITY)
  const loginCapable=capable&&body.capabilities.includes(LEARNING_LOGIN_CAPABILITY)
  return capable?{$or:[{'snapshot.learned':{$exists:false}},{'snapshot.learned.runtime':LEARNING_RUNTIME,'snapshot.learned.collectorId':String(device._id),...(!loginCapable?{'snapshot.learned.candidate.schema':{$ne:2}}:{})}]}:{'snapshot.learned':{$exists:false}}
}
export async function learnedClaimCurrent(job:any,account:any,device:any){
  if(!job.snapshot?.learned)return true
  const frozen=job.snapshot.learned
  if(!account||frozen.collectorId!==String(device._id)||frozen.selectionHash!==account.learningConnector?.selectionHash)return false
  try{const {r}=await selectedVersion(account);return String(r._id)===frozen.sessionId&&r.candidateHash===frozen.candidateHash&&hash(job.snapshot.learned.candidate)===r.candidateHash}catch{return false}
}
function pcScope(context:any){return {ownerId:context.device.ownerId,collectorId:context.device._id,installationId:context.installation._id,generation:context.installation.generation,origin:context.grant.origin,bankAccountId:{$in:context.device.bankAccountIds||[]}}}
export async function learningPcList(context:any){
  await init()
  // Interrupted bank actions are never automatically replayed or logged in again.
  await sweepWaiting(pcScope(context))
  const rows:any[]=await Learning.find({...pcScope(context),open:true,state:{$in:['awaiting_pc','candidate']}}).sort({createdAt:1}).limit(20).lean()
  const visible=[]
  for(const r of rows){try{await current(r);visible.push(view(r))}catch{/* A changed company/account/PC cannot authorize an old action. */}}
  return {sessions:visible}
}
async function pcRow(context:any,key:string){const r:any=await Learning.findOne({_id:id(key),...pcScope(context)}).select('+pcClaimHash').lean();if(!r)fail(404,'Learning session unavailable');await current(r);return r}
export async function learningPcAction(context:any,key:string,action:string,body:any){
  await init();const r=await pcRow(context,key)
  if(action==='start'||action==='replay'){
    if(r.teachLogin&&(body?.loginSchema!==2||(action==='start'&&body?.loginConsent!==true)))fail(409,'This login recording needs an updated downloader and explicit local consent')
    const source=action==='start'?'awaiting_pc':'candidate',target=action==='start'?'recording':'replaying'
    if(action==='replay'&&!r.replayPeriod)fail(409,'Choose a different replay period in OMF first')
    if(await BankJob.exists({ownerId:r.ownerId,bankAccountId:r.bankAccountId,open:true,state:{$in:['running','verification_required']}}))fail(409,'Bank collection is running')
    const token=opaque(),nonce=opaque()
    const row:any=await Learning.findOneAndUpdate({_id:r._id,state:source},{$set:{state:target,pcClaimHash:hash(token),pcLeaseUntil:lease(),pcActionStartedAt:new Date(),replayNonce:nonce}},{new:true}).lean()
    if(!row)fail(409,'Learning action already started')
    const bank=await BankAccount.findOneAndUpdate({_id:r.bankAccountId,ownerId:r.ownerId,$or:[{learningLease:null},{'learningLease.until':{$lte:new Date()}}]},{$set:{learningLease:{sessionId:String(r._id),claimHash:hash(token),until:lease()}}},{new:true}).lean()
    if(!bank||await BankJob.exists({ownerId:r.ownerId,bankAccountId:r.bankAccountId,open:true,state:{$in:['running','verification_required']}})){
      await BankAccount.updateOne({_id:r.bankAccountId,'learningLease.claimHash':hash(token)},{$set:{learningLease:null}})
      await Learning.updateOne({_id:r._id,state:target,pcClaimHash:hash(token)},{$set:{state:source,pcLeaseUntil:new Date(0)}})
      fail(409,'Bank collection or another teaching action is running')
    }
    return {claim:token,nonce,session:{...view(row),template:row.template,evidenceHash:row.evidenceHash,candidate:row.candidate,demonstrationPeriod:row.demonstrationPeriod,replayPeriod:row.replayPeriod}}
  }
  if(typeof body?.claim!=='string'||hash(body.claim)!==r.pcClaimHash)fail(409,'Learning claim changed')
  if(action==='finish'){
    await BankAccount.updateOne({_id:r.bankAccountId,'learningLease.claimHash':r.pcClaimHash},{$set:{learningLease:null}})
    return {accepted:true}
  }
  const acknowledgement=(row:any)=>{
    if(row.pcClaimHash!==r.pcClaimHash)return null
    if(action==='evidence'&&row.evidenceHash&&hash(body.evidence)===row.evidenceHash)return {accepted:true,evidenceHash:row.evidenceHash}
    if(action==='receipt'&&row.replay&&stable(body.receipt)===stable(row.replay))return {accepted:true}
    return null
  }
  const acknowledged=acknowledgement(r);if(acknowledged)return acknowledged
  let filter:any={_id:r._id,pcClaimHash:r.pcClaimHash},update:any
  if(action==='evidence'){
    if((body?.evidence?.schema===2)!==(r.teachLogin===true))fail(400,'Login recording consent changed')
    validateEvidence(body.evidence,testOptions());if(!body.evidence.origins.includes(r.entryOrigin))fail(400,'Entry origin missing')
    filter={...filter,evidenceHash:null,$or:[{state:'recording'},{state:'needs_demonstration',lastCode:'interrupted_pc_action'}]}
    update={evidence:body.evidence,evidenceHash:hash(body.evidence),state:'queued',queuedAt:new Date(),pcLeaseUntil:new Date(0),lastCode:null,missing:[]}
  }else if(action==='receipt'){
    if(body.nonce!==r.replayNonce)fail(409,'Replay changed')
    validateReplay(body.receipt,r)
    if(Date.parse(body.receipt.finishedAt)>Date.now()+30000||Date.parse(body.receipt.startedAt)<new Date(r.pcActionStartedAt||r.createdAt).getTime()-30*60000)fail(400,'Replay is not fresh')
    filter={...filter,replay:null,replayNonce:r.replayNonce,candidateHash:r.candidateHash,$or:[{state:'replaying'},{state:'needs_demonstration',lastCode:'interrupted_pc_action'}]}
    update={replay:body.receipt,state:'verified',pcLeaseUntil:new Date(0),lastCode:null,missing:[]}
  }else{
    if(!r.pcLeaseUntil||new Date(r.pcLeaseUntil).getTime()<=Date.now()||!['recording','replaying'].includes(r.state))fail(409,'Learning PC lease expired')
    filter={...filter,state:r.state,pcLeaseUntil:{$gt:new Date()}}
    if(action==='heartbeat')update={pcLeaseUntil:lease()}
    else if(action==='failed'){
      const codes=[...LEARNING_LOGIN_STOP_CODES,'recorded-control-unavailable','recorded-control-changed','account-mismatch','date-input-mismatch','statement-period-mismatch','statement-header-changed','balance-unavailable','logout-unconfirmed','unsupported-date-control']
      const role=['inquiry','account','from','to','export','balance','logout'].includes(body.role)?body.role:null
      update={state:'needs_demonstration',lastCode:codes.includes(body.code)?body.code:'pc_action_failed',missing:body.code==='unsupported-login-sequence'?['manual_login_required']:body.code==='unsupported-date-control'?['runtime_extension_needed']:role?[role]:['restart_demonstration'],pcLeaseUntil:new Date(0)}
    }else fail(404,'Unknown PC action')
  }
  if((await Learning.updateOne(filter,{$set:update})).modifiedCount!==1){const duplicate=acknowledgement(await pcRow(context,key));if(duplicate)return duplicate;fail(409,'PC action changed')}
  if(action==='heartbeat'){
    const renewed=await BankAccount.updateOne({_id:r.bankAccountId,'learningLease.claimHash':r.pcClaimHash,'learningLease.until':{$gt:new Date()}},{$set:{'learningLease.until':lease()}})
    if(renewed.matchedCount!==1)fail(409,'Bank teaching lease changed')
  }
  return {accepted:true,...(update.evidenceHash?{evidenceHash:update.evidenceHash}:{})}
}
export function learningWorkerAuth(token:string){
  const expected=process.env.OMF_BANK_LEARNING_WORKER_TOKEN||''
  if(expected.length<43||token.length>256||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(hash(expected))))fail(401,'Invalid bank learning worker')
}
export async function learningWorkerClaim(){
  await init()
  // Bound reclaims across consumer restarts/rejected results, without interrupting a live lease.
  const token=opaque(),now=new Date()
  const claimable={$or:[{state:'queued'},{state:'developing',leaseUntil:{$lte:now}}]}
  await Learning.updateMany({...claimable,attempts:{$gte:MAX_WORKER_CLAIMS}},{$set:{state:'failed',lastCode:'worker_failed',missing:['worker_unavailable'],leaseUntil:new Date(0)}})
  const availableAttempts={$or:[{attempts:{$lt:MAX_WORKER_CLAIMS}},{attempts:{$exists:false}}]}
  const r:any=await Learning.findOneAndUpdate({$and:[claimable,availableAttempts]},{$set:{state:'developing',claimHash:hash(token),leaseUntil:lease()},$inc:{epoch:1,attempts:1}},{sort:{createdAt:1},new:true}).lean()
  if(!r)return {job:null}
  try{await current(r)}catch{await Learning.updateOne({_id:r._id,epoch:r.epoch},{$set:{state:'cancelled',open:false,lastCode:'binding_changed'}});return {job:null}}
  return {job:{id:String(r._id),epoch:r.epoch,claim:token,model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidence:r.evidence,evidenceHash:r.evidenceHash,bindingHash:hash({owner:String(r.ownerId),company:String(r.companyId),account:String(r.bankAccountId),pc:r.installationId,generation:r.generation,connection:r.connectionHash,evidence:r.evidenceHash,runtime:LEARNING_RUNTIME})}}
}
export async function learningWorkerAction(key:string,action:string,body:any){
  await init()
  const r:any=await Learning.findOne({_id:id(key)}).select('+claimHash').lean()
  if(!r||r.epoch!==body.epoch||typeof body.claim!=='string'||hash(body.claim)!==r.claimHash)fail(409,'Worker claim fenced')
  const payloadHash=hash(body.result||null)
  if(action==='result'&&r.workerReceipt?.payloadHash===payloadHash)return {accepted:true,candidateHash:r.candidateHash||null}
  if(r.state!=='developing'||new Date(r.leaseUntil).getTime()<=Date.now())fail(409,'Worker lease expired')
  await current(r)
  const filter={_id:r._id,epoch:r.epoch,claimHash:r.claimHash,state:'developing',leaseUntil:{$gt:new Date()}}
  let update:any
  if(action==='heartbeat')update={leaseUntil:lease()}
  else if(action==='result'){
    const result=body.result
    learningAssert(result&&result.model===LEARNING_MODEL&&result.runtime===LEARNING_RUNTIME&&result.evidenceHash===r.evidenceHash,'worker-result-binding-mismatch')
    learningAssert(Object.keys(result).every(k=>['model','runtime','evidenceHash','candidate','missing','tests'].includes(k)))
    learningAssert(Array.isArray(result.tests)&&result.tests.length<=16&&result.tests.every((v:any)=>['schema','provenance','fixture'].includes(v)),'invalid-test-receipt')
    if(result.candidate){validateRecipe(result.candidate,r.evidence,r.evidenceHash,testOptions());learningAssert(result.tests.includes('schema')&&result.tests.includes('provenance'),'candidate-tests-missing');update={candidate:result.candidate,candidateHash:hash(result.candidate),state:'candidate',missing:[]}}
    else{validateMissing(result.missing);update={state:result.missing.includes('worker_unavailable')?'failed':'needs_demonstration',lastCode:result.missing.includes('worker_unavailable')?'worker_failed':null,missing:result.missing}}
    update.workerReceipt={model:result.model,payloadHash,epoch:r.epoch,at:new Date(),tests:result.tests};update.leaseUntil=new Date(0)
  }else fail(404,'Unknown worker action')
  if((await Learning.updateOne(filter,{$set:update})).modifiedCount!==1)fail(409,'Worker result fenced')
  return {accepted:true,candidateHash:update.candidateHash||null}
}

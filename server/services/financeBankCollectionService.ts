import { randomUUID, createHash } from 'node:crypto'
import { ready, id, fail } from './financeService'
import { FinanceCollector } from '../models/Finance'
import { BankAccount, BankStatement, BankTemplate, BankJob, initializePaymentMatching } from '../models/FinancePaymentMatch'
import { BANK_PROVIDERS } from '../../shared/finance-payment-match.mjs'
import { ownedBankAccount, acceptBankCapture } from './financeBankStatementService'
// Web-bank collection jobs (plan omf-bank-collection-amended-20261018 A4): the owner's connection and request, the collector's
// claim/status/upload under its bank scope, and the interpretation frozen on each job at queue time.
const LEASE_MS=180000,text=(v:any)=>String(v??'').trim(),sid=(v:any)=>String(v??'')
export const OBSERVE_MESSAGE='取得手順が未確認のため観察取得（準備）になります'
async function init(){await ready();await initializePaymentMatching()}
const view=(r:any)=>({...r,id:String(r._id),ownerId:undefined,_id:undefined,__v:undefined})
const providerOf=(key:any)=>BANK_PROVIDERS.find(([k])=>k===key)||null
// GUARD g1 (mirrored from finance/[...path].ts:19): a device acts only on the bank accounts its owner allowed it.
const scopeOf=(device:any)=>({ownerId:device.ownerId,bankAccountId:{$in:device.bankAccountIds||[]}})
const jobView=(j:any)=>({id:sid(j._id),jobId:j.jobId,kind:j.kind,state:j.state,requestedAt:j.requestedAt||null,collectorId:j.collectorId?sid(j.collectorId):null,leaseUntil:j.leaseUntil||null,lastAttemptAt:j.lastAttemptAt||null,lastMessage:j.lastMessage||'',snapshot:j.snapshot,snapshotHash:j.snapshotHash,statementIds:(j.statementIds||[]).map(sid),completedAt:j.completedAt||null,hasObservation:!!j.observation})
const captureView=(s:any)=>({id:sid(s._id),name:s.name,size:s.size,hash:s.hash,receivedAt:s.capture?.receivedAt||null,state:s.capture?.state,reason:s.capture?.reason||null,rows:s.capture?.rows||null,snapshotHash:s.capture?.snapshotHash,jobId:s.capture?.jobId,kind:s.capture?.kind,channel:s.capture?.channel,labelChecked:s.capture?.labelChecked===true,sourceHost:s.capture?.sourceHost||null})
// GUARD g2: provider known, template owned, the transaction-id column confirmed by the owner when the template maps one.
export async function connectionInput(ownerId:string,body:any){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'接続の内容を確認してください。')
 const provider=providerOf(body.provider);if(!provider)fail(400,'銀行を確認してください。')
 const template:any=await BankTemplate.findOne({_id:id(body.templateId),ownerId}).lean();if(!template)fail(400,'テンプレートを確認してください。')
 if(text(template.mapping?.transactionId)!==''&&body.transactionIdConfirmed!==true)fail(400,'銀行が発行した取引IDの列であることを確認してください。')
 const accountLabel=text(body.accountLabel);if(accountLabel.length>100||/[\x00-\x1f]/.test(accountLabel))fail(400,'口座の表示名を確認してください。')
 return{provider:provider![0],templateId:sid(template._id),transactionIdConfirmed:body.transactionIdConfirmed===true,accountLabel:accountLabel||null,connectedAt:new Date()}
}
export async function saveBankConnection(ownerId:string,accountId:string,body:any){await init();const account=await ownedBankAccount(ownerId,accountId),connection=await connectionInput(ownerId,body);await BankAccount.updateOne({_id:account._id,ownerId},{$set:{connection}});return{account:view(await BankAccount.findOne({_id:account._id,ownerId}).lean())}}
// The interpretation frozen on a job: the connection's template at its current revision, the confirmation, the parser version,
// the account currency, the provider and label. The hash is over this exact JSON, so the same settings give the same hash.
function snapshotOf(connection:any,template:any,account:any){const snapshot={templateId:sid(template._id),templateRevision:Number(template.revision||0),headers:[...(template.headers||[])],mapping:{...(template.mapping||{})},amountSign:template.amountSign||'outflow-positive',transactionIdConfirmed:connection.transactionIdConfirmed===true,parserVersion:'bank-template-1',currency:account.currency||'JPY',provider:connection.provider,accountLabel:connection.accountLabel??null,coverage:null};return{snapshot,snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}}
// GUARD g3 (mirrored from financeService.ts:125-129): an unrevoked PC allowed this account, and no job queued or running on a
// live lease; a running job whose lease expired no longer blocks (it stays claimable and continues under its own snapshot).
// GUARD g7 (tolerance): an unverified provider gets an observe job and a message, never a refusal.
export async function queueBankSync(ownerId:string,accountId:string){
 await init();const account=await ownedBankAccount(ownerId,accountId),connection=account.connection;if(!connection?.provider)fail(400,'先に銀行の接続を保存してください。')
 if(!await FinanceCollector.exists({ownerId,bankAccountIds:account._id,revokedAt:null}))fail(409,'PC未接続: この口座の取得を許可した接続済みのPCがありません。')
 const now=new Date();if(await BankJob.exists({ownerId,bankAccountId:account._id,$or:[{state:'queued'},{state:{$in:['running','verification_required']},leaseUntil:{$gt:now}}]}))fail(409,'取得はすでに予約・実行中です。')
 const template:any=await BankTemplate.findOne({_id:id(connection.templateId),ownerId}).lean();if(!template)fail(409,'接続のテンプレートが見つかりません。接続を保存し直してください。')
 const support=providerOf(connection.provider)?.[2]||'contract-pending',kind=support==='verified'?'retrieve':'observe',{snapshot,snapshotHash}=snapshotOf(connection,template,account),message=kind==='observe'?OBSERVE_MESSAGE:'取得を予約しました'
 await BankJob.updateMany({ownerId,bankAccountId:account._id,open:true,state:{$in:['running','verification_required']},leaseUntil:{$lt:now}},{$set:{open:false}})
 let job:any;try{job=(await BankJob.create({ownerId,bankAccountId:account._id,jobId:randomUUID(),kind,state:'queued',open:true,requestedAt:now,lastMessage:message,snapshot,snapshotHash,statementIds:[],observation:null})).toObject()}catch(e:any){if(e.code!==11000)throw e;fail(409,'取得はすでに予約・実行中です。')}
 return{job:jobView(job),message}
}
export async function setCollectorBankScope(ownerId:string,collectorId:string,body:any){
 await init();const device:any=await FinanceCollector.findOne({_id:id(collectorId),ownerId,revokedAt:null}).lean();if(!device)fail(404,'Collector not found')
 if(!Array.isArray(body?.bankAccountIds)||body.bankAccountIds.length>30)fail(400,'銀行口座を確認してください。')
 const ids=[...new Set<string>(body.bankAccountIds.map((v:any)=>id(v)))];if(await BankAccount.countDocuments({ownerId,_id:{$in:ids}})!==ids.length)fail(400,'銀行口座を確認してください。')
 await FinanceCollector.updateOne({_id:device._id,ownerId,revokedAt:null},{$set:{bankAccountIds:ids}})
 return{collector:{id:sid(device._id),name:device.name,bankAccountIds:ids}}
}
// One atomic claim (shape of finance/[...path].ts:22): the oldest queued job, or a running one whose lease expired, within the
// device's bank scope; the claim carries the frozen snapshot, its hash, the provider and its adapter support.
export async function claimBankJob(device:any){
 await init();const now=new Date()
 const job:any=await BankJob.findOneAndUpdate({...scopeOf(device),$or:[{state:'queued'},{state:{$in:['running','verification_required']},leaseUntil:{$lt:now}}]},{$set:{state:'running',collectorId:device._id,leaseUntil:new Date(now.getTime()+LEASE_MS),lastAttemptAt:now,lastMessage:'取得を開始'}},{new:true,sort:{requestedAt:1}}).lean()
 if(!job)return{job:null}
 const account:any=await BankAccount.findOne({_id:job.bankAccountId,ownerId:device.ownerId}).lean(),provider=providerOf(account?.connection?.provider)
 return{job:{...jobView(job),bankAccountId:sid(job.bankAccountId),provider:account?.connection?.provider||null,label:provider?.[1]||null,support:provider?.[2]||'contract-pending',accountLabel:account?.connection?.accountLabel??null},account:account?{_id:sid(account._id),name:account.name,currency:account.currency,ownerId:sid(account.ownerId),connection:account.connection}:null}
}
// Status (shape of finance/[...path].ts:33-35): only the claiming device, only while the job is running; terminal states release the account for the next request.
export async function bankJobStatus(device:any,body:any){
 await init();if(!body||!['running','verification_required','complete','failed'].includes(body.state)||typeof body.jobId!=='string')fail(400,'Invalid job status')
 const terminal=['complete','failed'].includes(body.state),now=new Date()
 const job=await BankJob.findOneAndUpdate({...scopeOf(device),jobId:body.jobId,collectorId:device._id,state:{$in:['running','verification_required']}},{$set:{state:body.state,leaseUntil:new Date(now.getTime()+LEASE_MS),lastMessage:typeof body.message==='string'?body.message.slice(0,200):'',...(terminal?{completedAt:now,open:false}:{})}},{new:true})
 if(!job)fail(409,'Job is no longer assigned to this collector')
 return{success:true}
}
// Only the recorded page contract: whitelisted keys, bounded sizes; a typed value, a credential or an unknown key never reaches the database.
function observationInput(bytes:Buffer){
 let body:any;try{body=JSON.parse(bytes.toString('utf8'))}catch{fail(400,'Invalid observation JSON')}
 if(!Array.isArray(body)||body.length>500)fail(400,'観察記録を確認してください。')
 const str=(v:any,max:number)=>String(v??'').slice(0,max),arr=(v:any,max:number)=>Array.isArray(v)?v.slice(0,max):[]
 return body.map((p:any)=>({at:str(p?.at,40),pathname:str(p?.pathname,300),title:str(p?.title,200),visibleControls:arr(p?.visibleControls,60).map((t:any)=>str(t,40)),inputs:arr(p?.inputs,100).map((i:any)=>({id:str(i?.id,100),type:str(i?.type,30)})),selects:arr(p?.selects,100).map((n:any)=>Number.isSafeInteger(n)?n:0),downloadEvents:arr(p?.downloadEvents,20).map((d:any)=>({host:str(d?.host,200),suggestedFilename:str(d?.suggestedFilename,200),bytes:Number.isSafeInteger(d?.bytes)?d.bytes:null}))}))
}
// Upload under a job of the device's scope in ANY state (a lost acknowledgement or an older retained manifest may arrive after
// the lease): an observation record is stored on the job; statement bytes go to acceptBankCapture with the job's snapshot.
export async function acceptBankJobUpload(device:any,query:any,bytes:Buffer,mimeType:string){
 await init();if(typeof query?.jobId!=='string'||!query.jobId)fail(400,'Invalid job')
 const job:any=await BankJob.findOne({...scopeOf(device),jobId:query.jobId}).lean();if(!job)fail(409,'Job is unavailable for this collector')
 if(query.kind==='observation'){if(mimeType!=='application/json')fail(415,'Observation JSON required');if(query.snapshotHash!==job.snapshotHash)fail(400,'取得時の設定が一致しません。');const observation=observationInput(bytes);await BankJob.updateOne({_id:job._id},{$set:{observation}});return{stored:true,pages:observation.length}}
 if(!['text/csv','text/plain'].includes(mimeType))fail(415,'CSV required')
 const account:any=await BankAccount.findOne({_id:job.bankAccountId,ownerId:job.ownerId}).lean();if(!account)fail(409,'Bank account unavailable')
 const result=await acceptBankCapture(job,account,bytes,{...query,mimeType})
 await BankJob.updateOne({_id:job._id},{$addToSet:{statementIds:id(result.id)}})
 return result
}
export async function storeObservation(device:any,query:any,bytes:Buffer){return acceptBankJobUpload(device,{...query,kind:'observation'},bytes,'application/json')}
export async function listBankJobs(ownerId:string,accountId:string){await init();const account=await ownedBankAccount(ownerId,accountId);const jobs:any[]=await BankJob.find({ownerId,bankAccountId:account._id}).sort({requestedAt:-1,_id:-1}).limit(50).lean();const statements:any[]=await BankStatement.find({ownerId,'capture.jobId':{$in:jobs.map(j=>j.jobId)}}).lean();return{jobs:jobs.map(j=>({...jobView(j),captures:statements.filter(s=>s.capture?.jobId===j.jobId).map(captureView)}))}}
export async function listBankCaptures(ownerId:string,accountId:string){await init();const account=await ownedBankAccount(ownerId,accountId);return{captures:(await BankStatement.find({ownerId,'capture.bankAccountId':sid(account._id)}).sort({'capture.receivedAt':-1,_id:-1}).limit(200).lean()).map((s:any)=>({...captureView(s),capture:s.capture}))}}

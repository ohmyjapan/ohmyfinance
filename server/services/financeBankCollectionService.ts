import { randomUUID, createHash } from 'node:crypto'
import { ready, id, fail } from './financeService'
import { FinanceCollector } from '../models/Finance'
import { BankAccount, BankStatement, BankTemplate, BankJob, initializePaymentMatching } from '../models/FinancePaymentMatch'
import { BANK_PROVIDERS, BANK_LOGIN_VARIANTS, BANK_NATIVE_TEMPLATES, bankCollectionMode, bankCoverageInput, frozenCoverage, jstToday, bankFirstCapture } from '../../shared/finance-payment-match.mjs'
import { ownedBankAccount, acceptBankCapture } from './financeBankStatementService'
// Web-bank collection jobs (plan omf-bank-collection-amended-20261018 A4): the owner's connection and request, the collector's
// claim/status/upload under its bank scope, and the interpretation frozen on each job at queue time.
const LEASE_MS=180000,text=(v:any)=>String(v??'').trim(),sid=(v:any)=>String(v??'')
export const OBSERVE_MESSAGE='取得手順が未確認のため観察取得（準備）になります'
// Plan omf-paypay-four-accounts-20261021: the variant whose first capture is explicitly unmapped (shared BANK_FIRST_CAPTURE: PayPay銀行
// 標準 only); its observe jobs are guided (the PC signs in once with the saved login, the person exports). Imported by name: the shared
// declaration file declares it, so a rename or removal is a type error, never a silent fallback.
const firstCaptureOf=(provider:any,variant:any):string|null=>bankFirstCapture(provider,variant)
export const guidedMessage=(label:string,unmapped:boolean)=>`${label}の${unmapped?'初回の':''}ガイド付き取得を予約しました。接続したPCのChromeで入出金明細のCSVを出力してください${unmapped?'（列の割り当ては受信後）':''}`
async function init(){await ready();await initializePaymentMatching()}
const view=(r:any)=>({...r,id:String(r._id),ownerId:undefined,_id:undefined,__v:undefined})
const providerOf=(key:any)=>BANK_PROVIDERS.find(([k])=>k===key)||null
// GUARD g1 (mirrored from finance/[...path].ts:19): a device acts only on the bank accounts its owner allowed it.
const scopeOf=(device:any)=>({ownerId:device.ownerId,bankAccountId:{$in:device.bankAccountIds||[]}})
const jobView=(j:any)=>({id:sid(j._id),jobId:j.jobId,kind:j.kind,state:j.state,requestedAt:j.requestedAt||null,collectorId:j.collectorId?sid(j.collectorId):null,leaseUntil:j.leaseUntil||null,lastAttemptAt:j.lastAttemptAt||null,lastMessage:j.lastMessage||'',snapshot:j.snapshot,snapshotHash:j.snapshotHash,statementIds:(j.statementIds||[]).map(sid),completedAt:j.completedAt||null,hasObservation:!!j.observation,eventChannel:[j.observation].flat().some((p:any)=>p?.eventChannel===false)?false:[j.observation].flat().some((p:any)=>p?.eventChannel===true)?true:null})
const captureView=(s:any)=>({id:sid(s._id),name:s.name,size:s.size,hash:s.hash,dateRange:s.dateRange||null,receivedAt:s.capture?.receivedAt||null,state:s.capture?.state,reason:s.capture?.reason||null,rows:s.capture?.rows||null,snapshotHash:s.capture?.snapshotHash,jobId:s.capture?.jobId,kind:s.capture?.kind,channel:s.capture?.channel,labelChecked:s.capture?.labelChecked===true,sourceHost:s.capture?.sourceHost||null})
// GUARD g2: provider known, template owned, the transaction-id column confirmed by the owner when the template maps one.
// The login variant (plan omf-rakuten-bank-connector-amended-20261019 R4) is kept only when the provider lists it in
// BANK_LOGIN_VARIANTS; anything else is stored as null — a tolerance, never a 400.
// Plan omf-rakuten-native-shiwake-20261020 §3: a variant with a native statement format (BANK_NATIVE_TEMPLATES, 楽天銀行 標準) needs
// no uploaded file — without a templateId the owner's native template is created once and reused (an existing same-named template
// with other contents is never overwritten: 409). The requested period {from, to|null} is validated and saved on the connection.
// Plan omf-paypay-four-accounts-20261021: a variant whose first capture is explicitly unmapped (PayPay銀行 標準) connects without a
// templateId as templateId null — its jobs freeze the unmapped interpretation; with a templateId it is an ordinary mapped connection.
// Every other provider/variant still needs its template (or its native one): no general template bypass.
async function nativeTemplate(ownerId:string,native:any){
 const write=()=>BankTemplate.findOneAndUpdate({ownerId,name:native.name},{$setOnInsert:{ownerId,name:native.name,headers:[...native.headers],mapping:{...native.mapping},amountSign:native.amountSign,revision:1}},{upsert:true,new:true}).lean()
 let template:any;try{template=await write()}catch(e:any){if(e?.code!==11000)throw e;template=await write()}
 const same=JSON.stringify(template.headers)===JSON.stringify(native.headers)&&template.amountSign===native.amountSign&&Object.keys(native.mapping).every(k=>String(template.mapping?.[k]??'')===native.mapping[k])
 if(!same)fail(409,'「'+native.name+'」という名前のテンプレートが別の内容で保存されています。テンプレートを選択してください。')
 return template
}
export async function connectionInput(ownerId:string,body:any){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'接続の内容を確認してください。')
 const provider=providerOf(body.provider);if(!provider)fail(400,'銀行を確認してください。')
 const variantKeys:[string,string][]=BANK_LOGIN_VARIANTS[provider![0]]||[],chosen=variantKeys.some(([key])=>key===body.variant)?String(body.variant):null,native=chosen?BANK_NATIVE_TEMPLATES[provider![0]]?.[chosen]||null:null
 const templateFree=firstCaptureOf(provider![0],chosen)==='unmapped'&&!native&&!text(body.templateId)
 const template:any=templateFree?null:!text(body.templateId)&&native?await nativeTemplate(ownerId,native):await BankTemplate.findOne({_id:id(body.templateId),ownerId}).lean();if(!template&&!templateFree)fail(400,'テンプレートを確認してください。')
 let coverage:any=null;if(body.coverage!==undefined&&body.coverage!==null){try{coverage=bankCoverageInput(body.coverage,jstToday())}catch(e:any){fail(400,e.message)}}
 if(text(template?.mapping?.transactionId)!==''&&body.transactionIdConfirmed!==true)fail(400,'銀行が発行した取引IDの列であることを確認してください。')
 const accountLabel=text(body.accountLabel);if(accountLabel.length>100||/[\x00-\x1f]/.test(accountLabel))fail(400,'口座の表示名を確認してください。')
 const variants:[string,string][]=BANK_LOGIN_VARIANTS[provider![0]]||[],variant=variants.some(([key])=>key===body.variant)?String(body.variant):null
 return{provider:provider![0],templateId:template?sid(template._id):null,transactionIdConfirmed:body.transactionIdConfirmed===true,accountLabel:accountLabel||null,variant,coverage,connectedAt:new Date()}
}
export async function saveBankConnection(ownerId:string,accountId:string,body:any){await init();const account=await ownedBankAccount(ownerId,accountId),connection=await connectionInput(ownerId,body);await BankAccount.updateOne({_id:account._id,ownerId},{$set:{connection}});return{account:view(await BankAccount.findOne({_id:account._id,ownerId}).lean())}}
// The interpretation frozen on a job: the connection's template at its current revision, the confirmation, the parser version,
// the account currency, the provider, label and login variant (null when none). The hash is over this exact JSON, so the same
// settings give the same hash; the variant key gives a new hash only to jobs queued after it was added.
// Plan omf-paypay-four-accounts-20261021: without a template (a template-free first capture) the snapshot freezes an explicit unmapped
// interpretation — no template, headers or mapping, `interpretation: 'unmapped'` — with the same provider, label, variant, currency and
// coverage keys; a mapped snapshot keeps exactly its former shape (and hash).
function snapshotOf(connection:any,template:any,account:any){const snapshot:any=template?{templateId:sid(template._id),templateRevision:Number(template.revision||0),headers:[...(template.headers||[])],mapping:{...(template.mapping||{})},amountSign:template.amountSign||'outflow-positive',transactionIdConfirmed:connection.transactionIdConfirmed===true,parserVersion:'bank-template-1',currency:account.currency||'JPY',provider:connection.provider,accountLabel:connection.accountLabel??null,variant:connection.variant??null,coverage:connection.coverage?frozenCoverage(connection.coverage,jstToday()):null}
 :{templateId:null,templateRevision:0,headers:[],mapping:{},amountSign:'outflow-positive',transactionIdConfirmed:false,parserVersion:'bank-template-1',currency:account.currency||'JPY',provider:connection.provider,accountLabel:connection.accountLabel??null,variant:connection.variant??null,coverage:connection.coverage?frozenCoverage(connection.coverage,jstToday()):null,interpretation:'unmapped'};return{snapshot,snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}}
// GUARD g3 (mirrored from financeService.ts:125-129): an unrevoked PC allowed this account, and no job queued or running on a
// live lease; a running job whose lease expired no longer blocks (it stays claimable and continues under its own snapshot).
// GUARD g7 (tolerance): an unverified provider/variant gets an observe job and a message, never a refusal. Plan omf-rakuten-native-
// shiwake-20261020: the kind follows the provider AND the frozen variant (bankCollectionMode: 楽天銀行 standard retrieves); a
// variant whose capability requires a period (楽天銀行 standard) needs it frozen in the snapshot (400 without one); jobs queued
// earlier keep their own snapshot.
export async function queueBankSync(ownerId:string,accountId:string){
 await init();const account=await ownedBankAccount(ownerId,accountId),connection=account.connection;if(!connection?.provider)fail(400,'先に銀行の接続を保存してください。')
 if(!await FinanceCollector.exists({ownerId,bankAccountIds:account._id,revokedAt:null}))fail(409,'PC未接続: この口座の取得を許可した接続済みのPCがありません。')
 const now=new Date();if(await BankJob.exists({ownerId,bankAccountId:account._id,$or:[{state:'queued'},{state:{$in:['running','verification_required']},leaseUntil:{$gt:now}}]}))fail(409,'取得はすでに予約・実行中です。')
 // A connection without a template is accepted only for the template-free first-capture variant (PayPay銀行 標準); any other is 409 as before.
 const guided=firstCaptureOf(connection.provider,connection.variant)==='unmapped',unmapped=guided&&connection.templateId===null
 const template:any=unmapped?null:await BankTemplate.findOne({_id:id(connection.templateId),ownerId}).lean();if(!template&&!unmapped)fail(409,'接続のテンプレートが見つかりません。接続を保存し直してください。')
 const mode=bankCollectionMode(connection.provider,connection.variant),support=providerOf(connection.provider)?.[2]||'contract-pending',kind=mode==='retrieve'?'retrieve':support==='verified'?'retrieve':'observe'
 let frozen:any;try{frozen=snapshotOf(connection,template,account)}catch(e:any){fail(400,e.message)}
 const {snapshot,snapshotHash}=frozen;if(mode==='retrieve'&&!snapshot.coverage)fail(400,'取得期間（開始日）を接続に保存してください。')
 const message=kind==='observe'?(guided?guidedMessage(providerOf(connection.provider)?.[1]||String(connection.provider),unmapped):OBSERVE_MESSAGE):'取得を予約しました'+(snapshot.coverage?'（'+snapshot.coverage.from+'〜'+snapshot.coverage.to+'）':'')
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
// The bank accounts the owner granted to THIS device (plan omf-rakuten-auto-login-20261021 §3), read-only for the downloader's
// local setup and its saved-login check: id, name, owner, provider and login variant of each owned account in the device's live
// bank scope — never the template, coverage, label, statements or jobs.
export async function listCollectorBankAccounts(device:any){
 await init();const ids=(device.bankAccountIds||[]).map(sid)
 const rows:any[]=ids.length?await BankAccount.find({ownerId:device.ownerId,_id:{$in:ids}}).sort({name:1,_id:1}).lean():[]
 return{accounts:rows.map((a:any)=>({_id:sid(a._id),name:a.name,ownerId:sid(a.ownerId),provider:a.connection?.provider||null,variant:a.connection?.variant??null}))}
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
// Only the recorded page contract: whitelisted keys, bounded sizes; a typed value, a credential or an unknown key never reaches the
// database. The person's operations (plan omf-rakuten-bank-connector-amended-20261019 R4) pass as clicks[{at,tag,text,id}] ≤60,
// typedInto[{at,id,type}] ≤100 and the integer eventsDropped (else 0) — the same bounds the collector applies; every other key is dropped.
function observationInput(bytes:Buffer){
 let body:any;try{body=JSON.parse(bytes.toString('utf8'))}catch{fail(400,'Invalid observation JSON')}
 if(!Array.isArray(body)||body.length>500)fail(400,'観察記録を確認してください。')
 const str=(v:any,max:number)=>String(v??'').slice(0,max),arr=(v:any,max:number)=>Array.isArray(v)?v.slice(0,max):[]
 return body.map((p:any)=>({at:str(p?.at,40),pathname:str(p?.pathname,300),title:str(p?.title,200),visibleControls:arr(p?.visibleControls,60).map((t:any)=>str(t,40)),inputs:arr(p?.inputs,100).map((i:any)=>({id:str(i?.id,100),type:str(i?.type,30)})),selects:arr(p?.selects,100).map((n:any)=>Number.isSafeInteger(n)?n:0),downloadEvents:arr(p?.downloadEvents,20).map((d:any)=>({host:str(d?.host,200),suggestedFilename:str(d?.suggestedFilename,200),bytes:Number.isSafeInteger(d?.bytes)?d.bytes:null})),clicks:arr(p?.clicks,60).map((c:any)=>({at:str(c?.at,40),tag:str(c?.tag,20),text:str(c?.text,40),id:str(c?.id,100)})),typedInto:arr(p?.typedInto,100).map((t:any)=>({at:str(t?.at,40),id:str(t?.id,100),type:str(t?.type,30)})),eventsDropped:Number.isSafeInteger(p?.eventsDropped)?p.eventsDropped:0,eventChannel:typeof p?.eventChannel==='boolean'?p.eventChannel:null}))
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
// The stored observation of one owned job, read-only (plan omf-rakuten-bank-connector-amended-20261019 R4): the sanctioned
// input for writing a bank's contract. Another owner's account or an unknown job is 404; nothing is written.
export async function getBankObservation(ownerId:string,accountId:string,jobId:string){await init();const account=await ownedBankAccount(ownerId,accountId);const job:any=await BankJob.findOne({ownerId,bankAccountId:account._id,jobId:sid(jobId)}).lean();if(!job)fail(404,'取得の記録が見つかりません。');return{jobId:job.jobId,kind:job.kind,state:job.state,requestedAt:job.requestedAt||null,snapshotHash:job.snapshotHash,observation:Array.isArray(job.observation)?job.observation:null}}
export async function listBankCaptures(ownerId:string,accountId:string){await init();const account=await ownedBankAccount(ownerId,accountId);return{captures:(await BankStatement.find({ownerId,'capture.bankAccountId':sid(account._id)}).sort({'capture.receivedAt':-1,_id:-1}).limit(200).lean()).map((s:any)=>({...captureView(s),capture:s.capture}))}}

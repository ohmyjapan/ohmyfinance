import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import User from '../models/User'
import { FinanceCollector, FinancialAccount } from '../models/Finance'
import { CollectorInstallation, CollectorGrant } from '../models/FinanceCollectorSecurity'
import { CollectorConnect } from '../models/FinanceCollectorConnect'
import { hash, opaque, hex, same, stamp, deny, throttle, publicIdentity, callback, activeUser, verifyFreshMfa, consumeBackupCode, installationRecord, grantRecord } from './financeCollectorSecurityService'
import { authenticatePrimary } from './authService'
import { collectorInput } from './financeService'
import { logAudit } from '../utils/audit'

// Initial connection of a statement downloader (plan omf-customer-connect-20261010). One human sign-in on the public
// /collector-connect page, several HTTP calls: a token-less request from the downloader, a fresh password/MFA check that
// returns a request-scoped proof plus the owner's eligible cards, an approval that reserves the collector and seals the
// token/grant into a capsule only the installation key opens, a loopback code exchanged with PKCE for that capsule, and an
// acknowledgement by the delivered token. Every transition is a compare-and-set on the request row; retries continue the
// saved preparation and never issue a second collector. No ordinary OMF session, JWT or trusted device takes part.
// Lines marked `// binding:<name>` are single guards; scripts/collector-security-integration.ts removes each in turn
// from a mutant copy to prove the leg catches its loss.
export const CONNECT_AAD_KIND='collector-connect'
const REQUEST_MS=10*60000, PROOF_MS=5*60000, DELIVERY_MS=10*60000, GRANT_MS=20*60000, PURGE_MS=24*3600000
const OPEN=['pending','authenticated','preparing','ready','delivered']
const SECRET_FIELDS='+state +codeChallenge +trustHash +authStamp +proofHash +tokenHash +grantHash +capsule +codeHash'
const START_AGAIN='Start again from the downloader.'
export async function initializeConnect(){await CollectorConnect.init()}

// The capsule's additional data binds request, origin, installation, generation, owner, reserved collector, scope and PC name.
export function connectAad({requestId,origin,installationId,generation,ownerId,collectorId,accountIds,pcName}:{requestId:string,origin:string,installationId:string,generation:string,ownerId:any,collectorId:any,accountIds:any[],pcName:string}){
  return {v:1,kind:CONNECT_AAD_KIND,requestId:String(requestId),origin:String(origin),installationId:String(installationId),generation:String(generation),ownerId:String(ownerId),collectorId:String(collectorId),accountIds:[...accountIds].map(String).sort(),pcName:String(pcName)}
}
// Same envelope as collector/vault.mjs sealEnvelope/openEnvelope: AES-256-GCM over JSON with the AAD, the data key
// RSA-OAEP-SHA256 wrapped to the installation public key. The downloader opens it with its DPAPI-protected private key.
export function sealCapsule(publicKey:string,aad:any,secret:any){
  const key=randomBytes(32),iv=randomBytes(12),aadBytes=Buffer.from(JSON.stringify(aad),'utf8')
  try{
    const cipher=createCipheriv('aes-256-gcm',key,iv)
    cipher.setAAD(aadBytes)
    const data=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(secret),'utf8')),cipher.final()])
    const wrapped=publicEncrypt({key:createPublicKey(publicKey),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key)
    return {v:1,aad,wrapped:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}
  }finally{key.fill(0)}
}
const pcNameOf=(value:unknown)=>{
  const name=typeof value==='string'?value.trim():''
  if(!name||name.length>100)deny('Invalid PC name',400)
  return name
}
const publicStatus=(row:any,now=new Date())=>{
  if(OPEN.includes(row.status)&&row.expiresAt<=now)return 'expired'
  return ({pending:'pending',authenticated:'authenticated',preparing:'authenticated',ready:'ready',delivered:'ready',acknowledged:'finished',cancelled:'cancelled',expired:'expired'} as Record<string,string>)[row.status]||'expired'
}
const publicView=(row:any)=>({id:row._id,intent:'connect',pcName:row.pcName,status:publicStatus(row),expiresAt:row.expiresAt})
async function loadRequest(id:unknown,{open=true}={}){
  if(typeof id!=='string'||!hex.test(id))deny('Invalid connection request.',400)
  const row:any=await CollectorConnect.findById(id).select(SECRET_FIELDS).lean()
  if(!row)deny('Connection request not found. '+START_AGAIN,404)
  if(open){
    if(!OPEN.includes(row.status))deny('This connection request has finished. '+START_AGAIN,409)
    if(row.expiresAt<=new Date())deny('Connection request expired. '+START_AGAIN,401) // binding:expiry
  }
  return row
}
async function ownerContext(row:any){
  const user=await activeUser(row.ownerId)
  if(!same(row.authStamp,stamp(user)))deny('Account changed. Sign in again from the downloader.',401) // binding:authstamp
  return user
}
async function reservedDevice(row:any){
  const device:any=await FinanceCollector.findOne({_id:row.collectorId,ownerId:row.ownerId}).lean()
  if(!device||device.revokedAt)deny('This connection was revoked. '+START_AGAIN,401) // binding:revoked
  return device
}
const freshProof=(row:any,proof:unknown)=>{
  if(typeof proof!=='string'||!hex.test(proof)||!row.proofHash||!same(row.proofHash,hash(proof)))deny('Sign in again on the connection page.',401) // binding:proof
  if(!row.proofExpiresAt||row.proofExpiresAt<=new Date())deny('Sign-in expired. Sign in again on the connection page.',401)
}
const liveScope=async(ownerId:any,accountIds:any[])=>await FinancialAccount.countDocuments({_id:{$in:accountIds},ownerId,active:true,provider:{$in:['amex','aplus']}})===accountIds.length
const connectUrl=(origin:string,id:string)=>new URL('/collector-connect?id='+id,origin).href

// Token-less request from the downloader: installation identity, public key, remembered-PC digest, state, PKCE challenge,
// loopback callback and PC name. Throttled per caller and overall: an unauthenticated caller can rotate installation IDs.
export async function createConnectRequest(body:any,origin:string,client:string){
  await throttle('connect-request:'+hash(String(client||'')),30,60000)
  await throttle('connect-request',300,60000)
  if(!body||!/^[a-f0-9]{32}$/.test(body.installationId)||!hex.test(body.generation)||!hex.test(body.trustHash)||!hex.test(body.state)||!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge))deny('Invalid connection request',400)
  const pcName=pcNameOf(body.pcName),identity=publicIdentity(body.publicKey),redirectUri=callback(body.redirectUri)
  if(await CollectorInstallation.exists({_id:body.installationId}))deny('This installation already exists. Reset the downloader before connecting again.',409)
  // A lost create response is retried with the same journaled identity: reuse the pending request instead of a second one.
  const existing:any=await CollectorConnect.findOne({installationId:body.installationId,status:'pending',expiresAt:{$gt:new Date()}}).select('+state +codeChallenge +trustHash').lean()
  if(existing&&same(existing.state,body.state)&&same(existing.codeChallenge,body.codeChallenge)&&existing.fingerprint===identity.fingerprint&&existing.origin===origin&&existing.redirectUri===redirectUri&&existing.pcName===pcName)return {id:existing._id,connectUrl:connectUrl(origin,existing._id),expiresAt:existing.expiresAt}
  const id=opaque(),now=Date.now(),expiresAt=new Date(now+REQUEST_MS)
  await CollectorConnect.create({_id:id,installationId:body.installationId,generation:body.generation,...identity,origin,pcName,redirectUri,state:body.state,codeChallenge:body.codeChallenge,trustHash:body.trustHash,status:'pending',expiresAt,purgeAt:new Date(now+PURGE_MS)})
  return {id,connectUrl:connectUrl(origin,id),expiresAt}
}
// Public inspection before any sign-in: generic intent and the PC name only. Never owner, email or cards.
export async function inspectConnectRequest(id:unknown){return publicView(await loadRequest(id,{open:false}))}

// Fresh sign-in on the connection page: the ordinary primary-credential check (lockout, attempts, audits) and enabled MFA,
// once. Returns a random request-scoped proof held only in page memory, stored here as a digest for at most five minutes,
// plus the owner's eligible cards. No session, JWT or trusted device is involved or issued.
export async function authenticateConnect(id:unknown,body:any,origin:string){
  const row=await loadRequest(id)
  if(row.origin!==origin)deny('Use the OMF connection page.',403)
  if(!['pending','authenticated','ready'].includes(row.status))deny('This connection is already being completed. Return to the downloader.',409)
  await throttle('connect-auth:'+row._id,10,15*60000)
  const email=typeof body?.email==='string'?body.email.trim().toLowerCase():''
  if(!email||email.length>254||typeof body?.password!=='string'||!body.password||body.password.length>512)deny('Email, password and verification code are required.',400)
  await throttle('connect-auth:'+hash(email),10,15*60000)
  let user:any
  try{user=await authenticatePrimary(email,body.password,{select:'+password +twoFactorSecret +twoFactorBackupCodes',purpose:'collector-connect'})}
  catch(error:any){deny(/locked/i.test(String(error?.message))?'Account temporarily locked. Try again later.':'Email, password or verification code is incorrect.',401)}
  const backup=await verifyFreshMfa(user,body.code)
  await consumeBackupCode(user,backup)
  if(row.ownerId&&String(row.ownerId)!==String(user._id))deny('This connection request belongs to another account.',403)
  const proof=opaque(),proofExpiresAt=new Date(Date.now()+PROOF_MS)
  const changed=await CollectorConnect.updateOne({_id:row._id,status:{$in:['pending','authenticated','ready']},expiresAt:{$gt:new Date()},$or:[{ownerId:null},{ownerId:user._id}]},{$set:{status:row.status==='ready'?'ready':'authenticated',ownerId:user._id,authStamp:stamp(user),proofHash:hash(proof),proofExpiresAt}})
  if(changed.modifiedCount!==1)deny('Connection request changed. '+START_AGAIN,409)
  await logAudit({action:'login',entityType:'auth',entityId:String(user._id),userId:String(user._id),metadata:{purpose:'collector-connect',requestId:row._id}})
  const accounts:any[]=await FinancialAccount.find({ownerId:user._id,active:true,provider:{$in:['amex','aplus']}}).select('name cardIdentifiers').lean()
  return {proof,proofExpiresAt,pcName:row.pcName,selected:(row.accountIds||[]).map(String),accounts:accounts.map(a=>({id:String(a._id),name:a.name,cards:(a.cardIdentifiers||[]).map((v:string)=>v.slice(-4))}))}
}

// Approval: fresh proof, exact origin, unchanged auth state, current user, live eligible scope. Prepares collector ID,
// token hash, grant hash and the sealed capsule once (compare-and-set), creates the collector row idempotently from the
// reserved ID, then marks the request ready with a fresh loopback code. A retry continues the saved preparation; a changed
// selection after approval is refused (a new request is the way to change it).
export async function approveConnect(id:unknown,body:any,origin:string){
  const row=await loadRequest(id)
  if(row.origin!==origin)deny('Use the OMF connection page.',403) // binding:origin
  freshProof(row,body?.proof)
  const user=await ownerContext(row)
  if(!['authenticated','preparing','ready'].includes(row.status))deny('Sign in first.',401)
  const {name,accountIds}=collectorInput({name:body?.pcName===undefined?row.pcName:body.pcName,accountIds:body?.accountIds})
  const scoped=[...new Set(accountIds)].sort()
  if(!await liveScope(user._id,scoped))deny('Choose cards that belong to this account.',403) // binding:scope
  if(['preparing','ready'].includes(row.status)&&(JSON.stringify((row.accountIds||[]).map(String).sort())!==JSON.stringify(scoped)||row.pcName!==name))deny('The selection changed after approval. Start a new connection from the downloader.',409)
  let prepared:any=row
  if(row.status==='authenticated'){
    const collectorId=new mongoose.Types.ObjectId(),token='omfc_'+randomBytes(32).toString('hex'),grant=opaque()
    const aad=connectAad({requestId:row._id,origin,installationId:row.installationId,generation:row.generation,ownerId:user._id,collectorId,accountIds:scoped,pcName:name})
    const capsule=sealCapsule(row.publicKey,aad,{token,grant})
    const set=await CollectorConnect.updateOne({_id:row._id,status:'authenticated',authStamp:row.authStamp,proofHash:row.proofHash},{$set:{status:'preparing',collectorId,tokenHash:hash(token),grantHash:hash(grant),capsule,accountIds:scoped,pcName:name}})
    if(set.modifiedCount!==1)deny('Connection request changed. Try again.',409)
    prepared=await loadRequest(row._id)
  }
  await FinanceCollector.updateOne({_id:prepared.collectorId},{$setOnInsert:{ownerId:user._id,name:prepared.pcName,tokenHash:prepared.tokenHash,accountIds:prepared.accountIds}},{upsert:true})
  await ownerContext(prepared)
  const code=opaque()
  const ready=await CollectorConnect.updateOne({_id:row._id,status:{$in:['preparing','ready']},collectorId:prepared.collectorId,proofHash:prepared.proofHash},{$set:{status:'ready',codeHash:hash(code),expiresAt:new Date(Date.now()+REQUEST_MS)}})
  if(ready.modifiedCount!==1)deny('Connection request changed. Try again.',409)
  const target=new URL(prepared.redirectUri);target.searchParams.set('code',code);target.searchParams.set('state',prepared.state)
  return {redirectUri:target.href}
}

// Loopback code plus PKCE verifier for the capsule. The first exchange moves ready → delivered and opens a bounded delivery
// window; an exact duplicate inside it returns the same capsule, never a second credential. Installation and grant rows
// are created from the reserved identifiers with idempotent writes; revocation or a changed account never resurrects them.
export async function exchangeConnect(body:any){
  const row=await loadRequest(body?.id)
  if(typeof body.verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)||!hex.test(String(body.code||'')))deny('Invalid or expired connection approval.',401)
  await throttle('connect-exchange:'+row._id,20,60000)
  if(!['ready','delivered'].includes(row.status)||!row.codeHash||!row.capsule)deny('Invalid or expired connection approval.',401)
  if(!same(row.codeHash,hash(body.code)))deny('Invalid or expired connection approval.',401) // binding:code
  if(!same(row.codeChallenge,createHash('sha256').update(body.verifier).digest('base64url')))deny('Invalid or expired connection approval.',401) // binding:pkce
  await ownerContext(row)
  await reservedDevice(row)
  if(!await liveScope(row.ownerId,row.accountIds))deny('Card scope changed. '+START_AGAIN,401)
  if(row.status==='ready'){
    const delivered=await CollectorConnect.updateOne({_id:row._id,status:'ready',codeHash:row.codeHash},{$set:{status:'delivered',deliveredAt:new Date(),expiresAt:new Date(Date.now()+DELIVERY_MS)}})
    if(delivered.modifiedCount!==1){const again=await loadRequest(row._id);if(again.status!=='delivered'||!same(again.codeHash,row.codeHash))deny('Connection approval already used.',401)}
  }
  await CollectorInstallation.updateOne({_id:row.installationId},{$setOnInsert:installationRecord(row)},{upsert:true})
  const installation:any=await CollectorInstallation.findById(row.installationId).lean()
  if(!installation||String(installation.collectorId)!==String(row.collectorId)||installation.generation!==row.generation||installation.fingerprint!==row.fingerprint||installation.origin!==row.origin)deny('Installation changed. '+START_AGAIN,409)
  const {_id:_grantId,...grantFields}=grantRecord(row.grantHash,row,new Date(Date.now()+GRANT_MS))
  await CollectorGrant.updateOne({_id:row.grantHash},{$setOnInsert:grantFields},{upsert:true})
  const grant:any=await CollectorGrant.findById(row.grantHash).lean()
  if(!grant||grant.revokedAt)deny('This connection was revoked. '+START_AGAIN,401)
  const accounts:any[]=await FinancialAccount.find({_id:{$in:row.accountIds},ownerId:row.ownerId}).select('name primaryCard ownerId provider').lean()
  await ownerContext(row)
  return {id:row._id,installationId:row.installationId,generation:row.generation,collectorId:String(row.collectorId),ownerId:String(row.ownerId),pcName:row.pcName,accounts:row.accountIds.map((accountId:any)=>{const a=accounts.find(v=>String(v._id)===String(accountId));return {_id:String(accountId),primaryCard:a?.primaryCard||'',name:a?.name||'',ownerId:String(row.ownerId),provider:a?.provider||'amex'}}),capsule:row.capsule,expiresAt:grant.expiresAt}
}

// Receipt from the downloader after its durable local save: the delivered token, the installation identity and the
// remembered-PC secret. Idempotent; clears the capsule, code and proof so nothing deliverable remains on the row.
export async function acknowledgeConnect(token:unknown,body:any,origin:string){
  const bearer:string=typeof token==='string'&&/^omfc_[a-f0-9]{64}$/.test(token)?token:deny('Collector authorization required.',401)
  const row=await loadRequest(body?.id,{open:false})
  if(!['delivered','acknowledged'].includes(row.status))deny('Connection not delivered. '+START_AGAIN,409)
  if(row.origin!==origin)deny('Use the OMF connection page.',403)
  await throttle('connect-ack:'+row._id,20,60000)
  if(!body||!hex.test(String(body.trustToken||''))||body.installationId!==row.installationId||body.generation!==row.generation)deny('Reconnect this PC through OMF.',401)
  if(!same(row.tokenHash,hash(bearer)))deny('Collector authorization required.',401)
  await ownerContext(row)
  await reservedDevice(row)
  const installation:any=await CollectorInstallation.findOne({_id:row.installationId,collectorId:row.collectorId,generation:row.generation,origin}).select('+trustHash').lean()
  if(!installation||!same(installation.trustHash,hash(body.trustToken)))deny('Reconnect this PC through OMF.',401)
  if(row.status==='delivered'){
    if(row.expiresAt<=new Date())deny('Connection delivery expired. '+START_AGAIN,401)
    await CollectorConnect.updateOne({_id:row._id,status:'delivered'},{$set:{status:'acknowledged',acknowledgedAt:new Date()},$unset:{capsule:1,codeHash:1,proofHash:1,proofExpiresAt:1}})
  }
  return {acknowledged:true}
}

// Cancel by the page (fresh proof) or by the downloader (its state). An unclaimed preparation releases only its own
// reserved collector, grant and installation; a delivered connection is ended through the existing OMF disconnect.
export async function cancelConnect(id:unknown,body:any){
  const row=await loadRequest(id,{open:false})
  if(!['pending','authenticated','preparing','ready'].includes(row.status))deny(row.status==='delivered'?'The connection was already delivered. Disconnect it in OMF.':'Connection request already finished.',409)
  const byProof=typeof body?.proof==='string'&&hex.test(body.proof)&&!!row.proofHash&&same(row.proofHash,hash(body.proof))
  const byState=typeof body?.state==='string'&&hex.test(body.state)&&same(row.state,body.state)
  if(!byProof&&!byState)deny('Cannot cancel this connection request.',403)
  const changed=await CollectorConnect.updateOne({_id:row._id,status:{$in:['pending','authenticated','preparing','ready']}},{$set:{status:'cancelled',cancelledAt:new Date()}})
  if(changed.modifiedCount!==1)deny('Connection request already finished.',409)
  await releasePreparation(row)
  const target=new URL(row.redirectUri);target.searchParams.set('state',row.state);target.searchParams.set('error','access_denied')
  return {redirectUri:target.href}
}
async function releasePreparation(row:any){
  if(row.collectorId){
    await FinanceCollector.updateOne({_id:row.collectorId,ownerId:row.ownerId,revokedAt:null},{$set:{revokedAt:new Date()}})
    await CollectorInstallation.deleteOne({_id:row.installationId,collectorId:row.collectorId,generation:row.generation})
  }
  if(row.grantHash)await CollectorGrant.updateOne({_id:row.grantHash,revokedAt:null},{$set:{revokedAt:new Date()}})
  await CollectorConnect.updateOne({_id:row._id},{$unset:{capsule:1,codeHash:1,proofHash:1,proofExpiresAt:1}})
}
// Explicit deadline cleanup, run by the route on every call: an open request past its deadline is expired and its
// unclaimed preparation released. Mongo's TTL removal is never relied on for authorization.
export async function expireConnectRequests(now=new Date()){
  const rows:any[]=await CollectorConnect.find({status:{$in:OPEN},expiresAt:{$lte:now}}).select(SECRET_FIELDS).lean()
  let count=0
  for(const row of rows){
    const changed=await CollectorConnect.updateOne({_id:row._id,status:row.status,expiresAt:{$lte:now}},{$set:{status:'expired'}})
    if(changed.modifiedCount!==1)continue
    await releasePreparation(row);count++
  }
  return count
}
// Touched for its side effect only: the User model must be registered before activeUser() runs in a fresh process.
void User

import { createHash, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import User from '../models/User'
import { FinanceCollector, FinancialAccount } from '../models/Finance'
import { CollectorInstallation, CollectorApproval, CollectorGrant, CollectorWrappedKey, CollectorThrottle } from '../models/FinanceCollectorSecurity'
import { verifyToken as verifyTOTP, verifyBackupCode } from './twoFactorService'

// Narrow helpers shared with the initial Connect service (financeCollectorConnectService.ts); their behaviour here is unchanged.
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
export const opaque=()=>randomBytes(32).toString('hex')
export const hex=/^[a-f0-9]{64}$/
export const deny=(message='Collector authorization is unavailable',statusCode=403):never=>{throw createError({statusCode,statusMessage:message})}
export const same=(a:string,b:string)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
export const stamp=(u:any)=>hash(JSON.stringify([u.password,!!u.twoFactorEnabled,u.twoFactorSecret||'']))
const userSecrets='+password +twoFactorSecret +twoFactorBackupCodes'
export async function initializeSecurity(){await Promise.all([CollectorInstallation,CollectorApproval,CollectorGrant,CollectorWrappedKey,CollectorThrottle].map(m=>m.init()))}
export async function readInstallation(token:string,id:string,origin:string){
  const {device}=await deviceFor(token)
  if(!/^[a-f0-9]{32}$/.test(id))deny('Invalid installation.',400)
  const row:any=await CollectorInstallation.findById(id).lean()
  if(!row)return {installation:null}
  if(String(row.ownerId)!==String(device.ownerId)||row.origin!==origin)deny()
  return {installation:{installationId:row._id,generation:row.generation,publicKey:row.publicKey,paired:String(row.collectorId)===String(device._id)}}
}
export async function activeUser(id:any){const u:any=await User.findOne({_id:id,isActive:true}).select(userSecrets);if(!u)deny();return u}
async function deviceFor(token:string){
  if(typeof token!=='string'||!/^omfc_[a-f0-9]{64}$/.test(token))deny()
  const d:any=await FinanceCollector.findOne({tokenHash:hash(token),revokedAt:null}).lean()
  if(!d)deny()
  return {device:d,user:await activeUser(d.ownerId)}
}
export async function throttle(subject:string,limit:number,windowMs:number){
  const now=Date.now(),bucket=Math.floor(now/windowMs),_id=`${subject}:${bucket}`
  let row:any
  try{row=await CollectorThrottle.findOneAndUpdate({_id},{$inc:{count:1},$setOnInsert:{expiresAt:new Date((bucket+2)*windowMs)}},{upsert:true,new:true})}
  catch(error:any){if(error.code!==11000)throw error;row=await CollectorThrottle.findOneAndUpdate({_id},{$inc:{count:1}},{new:true})}
  if(!row||row.count>limit)deny('Too many approval attempts. Try again later.',429)
}
export function publicIdentity(pem:unknown){
  if(typeof pem!=='string'||pem.length>6000||!pem.startsWith('-----BEGIN PUBLIC KEY-----'))deny('Invalid device public key',400)
  try{const key=createPublicKey(pem as string);const bits=key.asymmetricKeyDetails?.modulusLength
    if(key.asymmetricKeyType!=='rsa'||!bits||bits<2048||bits>4096)deny('Invalid device public key',400)
    const publicKey=key.export({format:'pem',type:'spki'}).toString()
    return {publicKey,fingerprint:hash(publicKey)}
  }catch{return deny('Invalid device public key',400)}
}
export function callback(value:unknown){
  try{if(typeof value!=='string'||value.length>256)throw Error();const url=new URL(value)
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1024||url.username||url.password||url.search||url.hash||url.pathname!=='/collector-callback')throw Error()
    return url.href
  }catch{deny('Invalid collector callback',400)}
}
// Fresh MFA for a request-scoped approval: enabled TOTP, or an unspent backup code whose hash is returned for one consumption.
export async function verifyFreshMfa(user:any,value:unknown):Promise<string|undefined>{
  if(!user.twoFactorEnabled)return undefined
  const code=typeof value==='string'?value.trim().toUpperCase():''
  let valid=!!user.twoFactorSecret&&/^\d{6}$/.test(code)&&verifyTOTP(user.twoFactorSecret,code)
  let backup:string|undefined
  if(!valid&&/^[A-F0-9]{8}$/.test(code)){
    const result=await verifyBackupCode(code,user.twoFactorBackupCodes||[])
    if(result.valid){valid=true;backup=user.twoFactorBackupCodes[result.index]}
  }
  if(!valid)deny('Password or verification code is incorrect.',401)
  return backup
}
// Consume a backup atomically; a failed later transition spends the code safely.
export async function consumeBackupCode(user:any,backup:string|undefined){
  if(!backup)return
  const spent=await User.updateOne({_id:user._id,isActive:true,twoFactorBackupCodes:backup,password:user.password,twoFactorSecret:user.twoFactorSecret},{$pull:{twoFactorBackupCodes:backup}})
  if(spent.modifiedCount!==1)deny('Verification code already used.',401)
}
// Enrollment and grant rows built from an approved request row (also used by the initial Connect service).
export function installationRecord(row:any){
  return {ownerId:row.ownerId,collectorId:row.collectorId,generation:row.generation,publicKey:row.publicKey,fingerprint:row.fingerprint,origin:row.origin,trustHash:row.trustHash,authStamp:row.authStamp,accountIds:row.accountIds,trustedAt:new Date()}
}
export function grantRecord(grantHash:string,row:any,expiresAt:Date){
  return {_id:grantHash,ownerId:row.ownerId,collectorId:row.collectorId,installationId:row.installationId,generation:row.generation,origin:row.origin,accountIds:row.accountIds,authStamp:row.authStamp,trustHash:row.trustHash,expiresAt}
}
export async function createRequest(token:string,body:any,origin:string){
  const {device,user}=await deviceFor(token)
  await throttle('request:'+device._id,30,60000)
  if(!body||!['enroll','batch','pair','reset'].includes(body.action)||!/^[a-f0-9]{32}$/.test(body.installationId)||!hex.test(body.generation)||!hex.test(body.trustHash)||!hex.test(body.state)||!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge))deny('Invalid approval request',400)
  const identity=publicIdentity(body.publicKey),redirectUri=callback(body.redirectUri)
  const current:any=await CollectorInstallation.findById(body.installationId).lean()
  if(body.action==='enroll'){if(current)deny('This installation already exists. Reopen the collector.',409)}
  else{
    if(!current||String(current.ownerId)!==String(device.ownerId)||current.origin!==origin)deny()
    if(body.action==='reset'){
      // A lost exchange response may leave the requested reset already committed.
      // Retry still needs fresh approval and exactly the same public key/generation.
      if(body.previousGeneration!==current.generation||(body.generation===current.generation&&identity.fingerprint!==current.fingerprint))deny('The installation changed. Retry approval.',409)
    }else if(body.generation!==current.generation||identity.fingerprint!==current.fingerprint)deny('The installation changed. Retry approval.',409)
    if(body.action==='batch'&&String(current.collectorId)!==String(device._id))deny('Reconnect this collector first.',409)
  }
  const id=opaque()
  await CollectorApproval.create({_id:id,ownerId:device.ownerId,collectorId:device._id,action:body.action,installationId:body.installationId,generation:body.generation,previousGeneration:current?.generation,...identity,origin,accountIds:device.accountIds,authStamp:stamp(user),trustHash:body.trustHash,codeChallenge:body.codeChallenge,redirectUri,state:body.state,expiresAt:new Date(Date.now()+5*60000)})
  return {id,approvalUrl:new URL('/collector-approval?id='+id,origin).href}
}
async function challenge(id:string){
  if(!hex.test(id))deny()
  const row:any=await CollectorApproval.findOne({_id:id,expiresAt:{$gt:new Date()}}).select('+authStamp +trustHash +codeChallenge +codeHash').lean()
  if(!row)deny('Approval expired. Start again.',401)
  return row
}
async function currentContext(row:any){
  const device:any=await FinanceCollector.findOne({_id:row.collectorId,ownerId:row.ownerId,revokedAt:null}).lean()
  const user=await activeUser(row.ownerId)
  if(!device||!same(row.authStamp,stamp(user)))deny('Account or collector changed. Start again.',401)
  return {device,user}
}
export async function readRequest(ownerId:string,id:string){
  const row=await challenge(id)
  if(String(row.ownerId)!==ownerId||row.status!=='pending')deny()
  const {device,user}=await currentContext(row)
  return {id:row._id,action:row.action,collectorName:device.name,origin:row.origin,email:user.email,twoFactorEnabled:!!user.twoFactorEnabled,expiresAt:row.expiresAt,rememberDevice:true}
}
export async function cancelRequest(ownerId:string,id:string){
  const row=await challenge(id)
  if(String(row.ownerId)!==ownerId)deny()
  const changed=await CollectorApproval.updateOne({_id:id,status:'pending',expiresAt:{$gt:new Date()}},{$set:{status:'used'}})
  if(changed.modifiedCount!==1)deny('Approval already finished. Return to the collector.',409)
  const target=new URL(row.redirectUri);target.searchParams.set('state',row.state);target.searchParams.set('error','access_denied')
  return {redirectUri:target.href}
}
export async function approveRequest(ownerId:string,id:string,body:any){
  const row=await challenge(id)
  if(String(row.ownerId)!==ownerId||row.status!=='pending')deny()
  await throttle('authenticate:'+ownerId,5,15*60000)
  const {user}=await currentContext(row)
  if(user.lockoutUntil&&user.lockoutUntil>new Date())deny('Account temporarily locked. Try again later.',429)
  if(typeof body?.password!=='string'||body.password.length>512||!await user.comparePassword(body.password))deny('Password or verification code is incorrect.',401)
  const backup=await verifyFreshMfa(user,body.code)
  await consumeBackupCode(user,backup)
  await currentContext(row)
  const code=opaque()
  const changed=await CollectorApproval.updateOne({_id:id,status:'pending',expiresAt:{$gt:new Date()}},{$set:{status:'approved',codeHash:hash(code),expiresAt:new Date(Date.now()+60000)}})
  if(changed.modifiedCount!==1)deny('Approval already used or expired.',401)
  const target=new URL(row.redirectUri);target.searchParams.set('code',code);target.searchParams.set('state',row.state)
  return {redirectUri:target.href}
}
export async function exchangeRequest(token:string,id:string,code:string,verifier:string){
  const {device}=await deviceFor(token),row=await challenge(id)
  if(typeof verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)||!hex.test(code)||row.status!=='approved'||String(row.collectorId)!==String(device._id)||!same(row.codeHash,hash(code))||!same(row.codeChallenge,createHash('sha256').update(verifier).digest('base64url')))deny('Invalid or expired approval.',401)
  await currentContext(row)
  const used=await CollectorApproval.updateOne({_id:id,status:'approved',expiresAt:{$gt:new Date()},codeHash:row.codeHash},{$set:{status:'used'},$unset:{codeHash:1}})
  if(used.modifiedCount!==1)deny('Approval already used.',401)
  const next=installationRecord(row)
  if(row.action==='reset')await CollectorGrant.updateMany({installationId:row.installationId,ownerId:row.ownerId,revokedAt:null},{$set:{revokedAt:new Date()}})
  if(row.action==='enroll'){
    try{await CollectorInstallation.create({_id:row.installationId,...next})}catch(error:any){if(error.code===11000)deny('Installation already enrolled. Start again.',409);throw error}
  }else{
    const filter:any={_id:row.installationId,ownerId:row.ownerId,origin:row.origin,generation:row.previousGeneration}
    if(row.action==='batch')filter.collectorId=row.collectorId
    const updated=await CollectorInstallation.updateOne(filter,{$set:next})
    if(updated.matchedCount!==1)deny('Installation changed. Start again.',409)
  }
  const grant=opaque(),expiresAt=new Date(Date.now()+20*60000)
  // Only enroll/batch grants read keys. Pair/reset grants authorize their single change.
  if(row.action==='enroll'||row.action==='batch')await CollectorGrant.create(grantRecord(hash(grant),row,expiresAt))
  return {grant:row.action==='enroll'||row.action==='batch'?grant:null,expiresAt,installationId:row.installationId,generation:row.generation,publicKey:row.publicKey,action:row.action}
}
// Remembered-PC access is a separate credential, never a polling token or a normal OMF login.
// The raw device credential stays DPAPI-protected on the PC; only its digest is stored here.
export async function resumeSession(token:string,body:any,origin:string){
  const {device,user}=await deviceFor(token)
  if(!body||!/^[a-f0-9]{32}$/.test(body.installationId)||!hex.test(body.generation)||!hex.test(body.trustToken))deny('Reconnect this PC through OMF.',401)
  const installation:any=await CollectorInstallation.findOne({_id:body.installationId,ownerId:device.ownerId,collectorId:device._id,generation:body.generation,origin}).select('+trustHash +authStamp').lean()
  if(!installation||!same(installation.trustHash,hash(body.trustToken))||!same(installation.authStamp,stamp(user)))deny('Reconnect this PC through OMF.',401)
  await throttle('resume:'+device._id,30,60000)
  const grant=opaque(),expiresAt=new Date(Date.now()+20*60000)
  const accountIds=installation.accountIds.filter((id:any)=>device.accountIds.some((v:any)=>String(v)===String(id)))
  await CollectorGrant.create({_id:hash(grant),ownerId:device.ownerId,collectorId:device._id,installationId:installation._id,generation:installation.generation,origin,accountIds,authStamp:installation.authStamp,trustHash:installation.trustHash,expiresAt})
  // Recheck after I/O: concurrent revocation never makes the returned grant usable.
  await activeGrant(token,grant)
  return {grant,expiresAt,installationId:installation._id,generation:installation.generation,publicKey:installation.publicKey,action:'resume'}
}
async function activeGrant(token:string,grantToken:string){
  const {device,user}=await deviceFor(token)
  if(typeof grantToken!=='string'||!hex.test(grantToken))deny()
  const grant:any=await CollectorGrant.findOne({_id:hash(grantToken),collectorId:device._id,ownerId:device.ownerId,revokedAt:null,expiresAt:{$gt:new Date()}}).select('+authStamp +trustHash').lean()
  if(!grant||!same(grant.authStamp,stamp(user)))deny('Collector access expired or changed. Reconnect this PC if automatic renewal fails.',401)
  const installation:any=await CollectorInstallation.findOne({_id:grant.installationId,ownerId:device.ownerId,collectorId:device._id,generation:grant.generation,origin:grant.origin,trustHash:grant.trustHash}).lean()
  if(!installation)deny('Installation changed. Approve a new batch.',401)
  return {grant,device,installation}
}
async function binding(context:any,record:any){
  const {grant,device}=context, a=record?.aad
  if(!a||a.v!==3||!hex.test(record.keyId)||a.keyId!==record.keyId||a.generation!==grant.generation||a.installationId!==grant.installationId||a.origin!==grant.origin||a.ownerId!==String(grant.ownerId)||JSON.stringify(Object.keys(a).sort())!==JSON.stringify(['v','installationId','origin','ownerId','provider','accountId','generation','keyId'].sort()))deny('Key binding mismatch.',400)
  // Per-account card entries (amex-<id>, aplus-<id>) bind to the grant, the device and the live account; service entries
  // (gmail, the single legacy aplus login, yayoi, check) and archived legacy entries bind by name. Each `// binding:<name>`
  // line is one guard; scripts/collector-security-integration.ts removes each in turn to prove it is load-bearing.
  const perAccount=a.provider==='amex'||(a.provider==='aplus'&&/^[a-f0-9]{24}$/.test(a.accountId))
  if(perAccount&&record.entryId!==a.provider+'-'+a.accountId)deny('Card is unavailable for this batch.') // binding:entry
  if(perAccount&&!grant.accountIds.some((v:any)=>String(v)===a.accountId))deny('Card is unavailable for this batch.') // binding:grant-scope
  if(perAccount&&!device.accountIds.some((v:any)=>String(v)===a.accountId))deny('Card is unavailable for this batch.') // binding:device-scope
  if(perAccount&&!await FinancialAccount.exists({_id:a.accountId,ownerId:grant.ownerId,active:true,provider:a.provider}))deny('Card is unavailable for this batch.') // binding:account-live
  if(!perAccount&&a.provider==='legacy'&&(!/^legacy-\d+$/.test(record.entryId)||a.accountId!==record.entryId))deny('Invalid archived key entry.',400)
  if(!perAccount&&a.provider!=='legacy'&&(!['gmail','aplus','yayoi','check'].includes(a.provider)||record.entryId!==a.provider||a.accountId!==a.provider))deny('Invalid key entry.',400) // binding:service
}
export async function putKey(token:string,grantToken:string,body:any){
  const context=await activeGrant(token,grantToken);await binding(context,body)
  const size=(createPublicKey(context.installation.publicKey).asymmetricKeyDetails?.modulusLength||0)/8
  if(typeof body.wrapped!=='string'||body.wrapped.length>1024||Buffer.from(body.wrapped,'base64').length!==size||Buffer.from(body.wrapped,'base64').toString('base64')!==body.wrapped)deny('Invalid wrapped key.',400)
  const digest=hash(JSON.stringify([body.entryId,body.aad,body.wrapped]))
  const record={keyId:body.keyId,entryId:body.entryId,aad:body.aad,wrapped:body.wrapped,digest,ownerId:context.grant.ownerId,installationId:context.grant.installationId,generation:context.grant.generation}
  try{await CollectorWrappedKey.create(record)}catch(error:any){
    if(error.code!==11000)throw error
    if(!await CollectorWrappedKey.exists({keyId:body.keyId,ownerId:context.grant.ownerId,generation:context.grant.generation,digest}))deny('Key ID is already registered with different data.',409)
  }
  // Recheck after I/O; stale writes never confer key-read authority.
  await activeGrant(token,grantToken)
  return {keyId:body.keyId,generation:context.grant.generation}
}
export async function getKey(token:string,grantToken:string,keyId:string){
  const context=await activeGrant(token,grantToken)
  if(!hex.test(keyId))deny('Invalid key ID.',400)
  const record:any=await CollectorWrappedKey.findOne({keyId,ownerId:context.grant.ownerId,installationId:context.grant.installationId,generation:context.grant.generation}).select('+wrapped').lean()
  if(!record)deny('Saved key is unavailable. Reconnect this bank login.',404)
  await binding(context,record)
  await activeGrant(token,grantToken)
  return {keyId:record.keyId,generation:record.generation,wrapped:record.wrapped,aad:record.aad}
}
export async function endGrant(token:string,grantToken:string){
  const {device}=await deviceFor(token)
  if(!hex.test(grantToken))deny()
  await CollectorGrant.updateOne({_id:hash(grantToken),collectorId:device._id,ownerId:device.ownerId,revokedAt:null},{$set:{revokedAt:new Date()}})
  return {locked:true}
}

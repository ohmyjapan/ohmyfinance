// Owned, ephemeral Mongo only; no app environment file, bank service or real user.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, privateDecrypt, constants } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { generateSync } from 'otplib'
import User from '../server/models/User'
import { FinanceCollector, FinancialAccount } from '../server/models/Finance'
import { generateSecret, hashBackupCodes } from '../server/services/twoFactorService'

// Initial Connect (plan omf-customer-connect-20261010): token-less request, one fresh sign-in, request-scoped proof,
// scoped issuance delivered only through an encrypted capsule, bounded idempotent retries, cancel/expire/revoke.
// Each server binding is also removed in turn from a mutant copy of the service to prove this leg catches it.
const CONNECT_SERVICE=path.resolve(__dirname,'..','server','services','financeCollectorConnectService.ts')
const SECURITY_SERVICE=path.resolve(__dirname,'..','server','services','financeCollectorSecurityService.ts')
const BINDINGS=['proof','origin','scope','authstamp','pkce','code','expiry','revoked']
const SECURITY_BINDINGS=['entry','grant-scope','device-scope','account-live','service']
const BANK_BINDINGS=['bank-entry','bank-scope','bank-live','bank-recheck-put','bank-recheck-get']
// One `// binding:<marker>` line removed from a copy written beside its original (relative imports resolve); a copy that
// fails to import is a harness fault, printed as FAIL and never counted as detection.
async function withMutant(file:string,marker:string,fn:(mutant:any)=>Promise<void>){
  const lines=(await readFile(file,'utf8')).split('\n'),index=lines.findIndex(line=>line.includes('// binding:'+marker))
  assert.ok(index>=0,'binding marker missing: '+marker);lines.splice(index,1)
  const mutantFile=path.join(path.dirname(file),`${path.basename(file,'.ts')}.mutant-${marker}-${process.pid}.ts`)
  await writeFile(mutantFile,lines.join('\n'),{flag:'wx'})
  try{
    let mutant:any
    try{mutant=await import(pathToFileURL(mutantFile).href)}catch(error:any){console.log('FAIL mutant invalid: '+marker+' — '+String(error?.message||error).split('\n')[0]);throw error}
    await fn(mutant)
  }finally{await unlink(mutantFile)}
}
async function connectLegs(context:{pass:(name:string)=>void,digest:(v:string)=>string,origin:string,user:any,other:any,account:any,password:string,secret:string,legacyToken:string,service:any,models:any}){
  const {pass,digest,origin,user,other,account,password,secret,legacyToken,service,models}=context
  let connect:any,connectModels:any
  try{connect=await import('../server/services/financeCollectorConnectService');connectModels=await import('../server/models/FinanceCollectorConnect')}
  catch(error:any){console.log('FAIL initial connect service is missing: '+String(error?.message||error).split('\n')[0]);throw error}
  const {CollectorConnect}=connectModels
  await connect.initializeConnect()
  const S256=(v:string)=>createHash('sha256').update(v).digest('base64url')
  const second:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Second synthetic card',cardIdentifiers:['23456'],primaryCard:'23456',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
  const aplus:any=await FinancialAccount.create({ownerId:user._id,provider:'aplus',name:'Synthetic Aplus',cardIdentifiers:['1234'],primaryCard:'1234'})
  const foreign:any=await FinancialAccount.create({ownerId:other._id,provider:'amex',name:'Foreign card',cardIdentifiers:['34567'],primaryCard:'34567',otpRecipient:'other@example.invalid',otpMailbox:'other@example.invalid'})
  const ids=[String(account._id)]
  const totp=()=>generateSync({secret})
  async function fresh(){
    await models.CollectorThrottle.deleteMany({})
    const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const installationId=randomBytes(16).toString('hex'),generation=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('hex'),trustToken=randomBytes(32).toString('hex')
    const input={installationId,generation,publicKey:pair.publicKey,trustHash:digest(trustToken),state,codeChallenge:S256(verifier),redirectUri:'http://127.0.0.1:49123/collector-callback',pcName:'Synthetic PC'}
    const created=await connect.createConnectRequest(input,origin,'127.0.0.1')
    return {pair,installationId,generation,verifier,state,trustToken,input,id:created.id as string,created}
  }
  async function authenticated(){const r=await fresh();const auth=await connect.authenticateConnect(r.id,{email:user.email,password,code:totp()},origin);return {...r,auth,proof:auth.proof as string}}
  async function approved(accountIds=ids){const r=await authenticated();const yes=await connect.approveConnect(r.id,{proof:r.proof,accountIds,pcName:'Synthetic PC'},origin);return {...r,code:new URL(yes.redirectUri).searchParams.get('code') as string}}
  const full=(id:string)=>CollectorConnect.findById(id).select('+state +codeChallenge +authStamp +proofHash +tokenHash +grantHash +capsule +codeHash').lean()
  // 1. Token-less request: bindings validated, duplicate create reused, public inspection generic.
  const first=await fresh()
  assert.match(first.id,/^[a-f0-9]{64}$/);assert.equal(first.created.connectUrl,origin+'/collector-connect?id='+first.id)
  assert.equal((await connect.createConnectRequest(first.input,origin,'127.0.0.1')).id,first.id)
  for(const bad of [{redirectUri:'http://evil.example.invalid/collector-callback'},{redirectUri:'http://127.0.0.1:49123/other'},{publicKey:'junk'},{codeChallenge:'short'},{state:'x'},{pcName:''},{pcName:'x'.repeat(101)}])await assert.rejects(connect.createConnectRequest({...first.input,...bad,installationId:randomBytes(16).toString('hex')},origin,'127.0.0.1'),(e:any)=>e.statusCode===400)
  const view=await connect.inspectConnectRequest(first.id)
  assert.deepEqual(Object.keys(view).sort(),['expiresAt','id','intent','pcName','status']);assert.equal(view.intent,'connect');assert.equal(view.pcName,'Synthetic PC');assert.equal(view.status,'pending')
  assert.equal(JSON.stringify(view).includes(user.email),false)
  pass('token-less connect request binds loopback callback, PKCE and public key; a repeated create reuses the pending request; public inspection shows only intent and PC name')
  // 2. Fresh sign-in: password and enabled MFA once; lockout, inactive user, consumed backup code; proof stored as a digest.
  await assert.rejects(connect.authenticateConnect(first.id,{email:user.email,password:'wrong',code:totp()},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.authenticateConnect(first.id,{email:user.email,password,code:''},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.authenticateConnect(first.id,{email:user.email,password,code:'000000'},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.authenticateConnect(first.id,{email:'nobody@example.invalid',password,code:totp()},origin),(e:any)=>e.statusCode===401)
  const auth=await connect.authenticateConnect(first.id,{email:user.email,password,code:totp()},origin)
  assert.match(auth.proof,/^[a-f0-9]{64}$/);assert.deepEqual(auth.accounts.map((a:any)=>a.id).sort(),[String(account._id),String(second._id),String(aplus._id)].sort());assert.equal(auth.pcName,'Synthetic PC')
  assert.equal(auth.accounts.some((a:any)=>a.id===String(foreign._id)),false)
  let row:any=await full(first.id)
  assert.equal(row.proofHash,digest(auth.proof));assert.equal(row.status,'authenticated');assert.equal(JSON.stringify(row).includes(auth.proof),false);assert.equal(String(row.ownerId),String(user._id))
  assert.equal((await connect.inspectConnectRequest(first.id)).status,'authenticated')
  const backupA=await authenticated();void backupA
  const withBackup=await fresh();await connect.authenticateConnect(withBackup.id,{email:user.email,password,code:'CCDD3344'},origin)
  const withBackupAgain=await fresh();await assert.rejects(connect.authenticateConnect(withBackupAgain.id,{email:user.email,password,code:'CCDD3344'},origin),(e:any)=>e.statusCode===401)
  const locked=await fresh()
  for(let i=0;i<5;i++)await assert.rejects(connect.authenticateConnect(locked.id,{email:user.email,password:'wrong',code:totp()},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.authenticateConnect(locked.id,{email:user.email,password,code:totp()},origin),(e:any)=>e.statusCode===401&&/locked/i.test(e.statusMessage))
  assert.ok(((await User.findById(user._id).lean()) as any).lockoutUntil>new Date())
  await User.updateOne({_id:user._id},{$set:{loginAttempts:0},$unset:{lockoutUntil:1}})
  await User.updateOne({_id:user._id},{$set:{isActive:false}})
  await assert.rejects(connect.authenticateConnect((await fresh()).id,{email:user.email,password,code:totp()},origin),(e:any)=>e.statusCode===401)
  await User.updateOne({_id:user._id},{$set:{isActive:true}})
  pass('connect sign-in verifies the password and enabled MFA once with the ordinary lockout; a backup code is consumed once; inactive users and wrong codes are refused; the proof is stored only as a digest')
  // 3. Approval: proof, exact origin, unchanged auth state, live eligible scope; duplicate/crash retry keeps one reserved collector.
  await assert.rejects(connect.approveConnect(first.id,{proof:'0'.repeat(64),accountIds:ids},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids},'https://other.example.invalid'),(e:any)=>e.statusCode===403)
  for(const scope of [[],[String(foreign._id)],[String(account._id),String(foreign._id)],['nope']])await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:scope},origin),(e:any)=>[400,403].includes(e.statusCode))
  await FinancialAccount.updateOne({_id:second._id},{$set:{active:false}})
  await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:[String(second._id)]},origin),(e:any)=>[400,403].includes(e.statusCode))
  await FinancialAccount.updateOne({_id:second._id},{$set:{active:true}})
  const previousSecret=secret
  await User.updateOne({_id:user._id},{$set:{twoFactorSecret:generateSecret()}})
  await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids},origin),(e:any)=>e.statusCode===401)
  await User.updateOne({_id:user._id},{$set:{twoFactorSecret:previousSecret}})
  const beforeCount=await FinanceCollector.countDocuments({ownerId:user._id})
  const yes=await connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids,pcName:'Synthetic PC'},origin)
  const target=new URL(yes.redirectUri);assert.equal(target.origin+target.pathname,'http://127.0.0.1:49123/collector-callback');assert.equal(target.searchParams.get('state'),first.state)
  const code1=target.searchParams.get('code') as string;assert.match(code1,/^[a-f0-9]{64}$/)
  row=await full(first.id);assert.equal(row.status,'ready');assert.ok(row.collectorId);assert.ok(row.capsule);assert.equal(JSON.stringify(row).includes(code1),false)
  const reserved=String(row.collectorId)
  const device:any=await FinanceCollector.findById(reserved).lean();assert.equal(device.name,'Synthetic PC');assert.deepEqual(device.accountIds.map(String),ids)
  // Duplicate click: a new code, the same reserved collector.
  const again=await connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids},origin)
  const code2=new URL(again.redirectUri).searchParams.get('code') as string;assert.notEqual(code2,code1)
  assert.equal(String(((await full(first.id)) as any).collectorId),reserved)
  // A crash after the prepared row was saved but before the collector row existed: the retry continues that preparation.
  await FinanceCollector.deleteOne({_id:reserved});await CollectorConnect.updateOne({_id:first.id},{$set:{status:'preparing'}})
  const resumed=await connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids},origin)
  const code3=new URL(resumed.redirectUri).searchParams.get('code') as string
  assert.equal(String(((await full(first.id)) as any).collectorId),reserved);assert.ok(await FinanceCollector.exists({_id:reserved}))
  assert.equal(await FinanceCollector.countDocuments({ownerId:user._id}),beforeCount+1)
  await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:[String(account._id),String(second._id)]},origin),(e:any)=>e.statusCode===409)
  assert.equal(await FinanceCollector.countDocuments({ownerId:user._id}),beforeCount+1)
  pass('approval needs the request proof, exact origin, unchanged auth state and live eligible scope; duplicate clicks and a prepare-crash retry keep one reserved collector; a changed selection is refused')
  // A same-owner Aplus account is eligible (plan omf-aplus-automation-20261013): selected alone, delivered with its provider.
  const aplusConnect=await approved([String(aplus._id)])
  const aplusDelivered=await connect.exchangeConnect({id:aplusConnect.id,code:aplusConnect.code,verifier:aplusConnect.verifier})
  assert.deepEqual(aplusDelivered.accounts.map((a:any)=>({_id:a._id,provider:a.provider,primaryCard:a.primaryCard})),[{_id:String(aplus._id),provider:'aplus',primaryCard:'1234'}])
  pass('a same-owner Aplus account can be selected at Connect and is delivered with its provider; empty, malformed and foreign-owner selections stay refused')
  // 4. Exchange: approved code and PKCE; duplicates return one capsule; collector primitives open it; Mongo holds no plaintext.
  await assert.rejects(connect.exchangeConnect({id:first.id,code:code2,verifier:first.verifier}),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.exchangeConnect({id:first.id,code:code3,verifier:'a'.repeat(43)}),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.exchangeConnect({id:first.id,code:'f'.repeat(64),verifier:first.verifier}),(e:any)=>e.statusCode===401)
  const settled=await Promise.allSettled([1,2].map(()=>connect.exchangeConnect({id:first.id,code:code3,verifier:first.verifier})))
  assert.deepEqual(settled.map(s=>s.status),['fulfilled','fulfilled'])
  const [delivered,duplicate]=settled.map((s:any)=>s.value)
  assert.deepEqual(duplicate.capsule,delivered.capsule);assert.equal(delivered.installationId,first.installationId);assert.equal(delivered.generation,first.generation);assert.equal(delivered.collectorId,reserved);assert.equal(delivered.pcName,'Synthetic PC')
  assert.deepEqual(delivered.accounts.map((a:any)=>a._id),ids);assert.equal(delivered.accounts[0].ownerId,String(user._id));assert.equal(delivered.accounts[0].primaryCard,'12345')
  const later=await connect.exchangeConnect({id:first.id,code:code3,verifier:first.verifier});assert.deepEqual(later.capsule,delivered.capsule)
  const {openEnvelope}=await import('../collector/vault.mjs')
  const aad=connect.connectAad({requestId:first.id,origin,installationId:first.installationId,generation:first.generation,ownerId:String(user._id),collectorId:reserved,accountIds:ids,pcName:'Synthetic PC'})
  assert.deepEqual(delivered.capsule.aad,aad)
  const dataKey=privateDecrypt({key:first.pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(delivered.capsule.wrapped,'base64'))
  const opened=openEnvelope(delivered.capsule,dataKey,aad);dataKey.fill(0)
  assert.match(opened.token,/^omfc_[a-f0-9]{64}$/);assert.match(opened.grant,/^[a-f0-9]{64}$/)
  assert.throws(()=>openEnvelope(delivered.capsule,Buffer.alloc(32),{...aad,pcName:'Other PC'}))
  row=await full(first.id)
  assert.equal(row.status,'delivered');assert.equal(row.tokenHash,digest(opened.token));assert.equal(row.grantHash,digest(opened.grant))
  for(const secretText of [opened.token,opened.grant,code3,auth.proof])assert.equal(JSON.stringify(row).includes(secretText),false)
  assert.equal(((await FinanceCollector.findById(reserved).select('+tokenHash').lean()) as any).tokenHash,digest(opened.token))
  const installed:any=await models.CollectorInstallation.findById(first.installationId).select('+trustHash').lean()
  assert.ok(installed);assert.equal(String(installed.collectorId),reserved);assert.equal(installed.trustHash,digest(first.trustToken));assert.equal(installed.origin,origin)
  const canaryKeyId=randomBytes(32).toString('hex')
  const canaryAad={v:3,installationId:first.installationId,origin,ownerId:String(user._id),provider:'check',accountId:'check',generation:first.generation,keyId:canaryKeyId}
  const canary=await connect.sealCapsule(first.pair.publicKey,canaryAad,{canary:'x'})
  await service.putKey(opened.token,opened.grant,{keyId:canaryKeyId,entryId:'check',aad:canaryAad,wrapped:canary.wrapped})
  assert.equal((await service.getKey(opened.token,opened.grant,canaryKeyId)).wrapped,canary.wrapped)
  pass('exchange needs the approved code and PKCE verifier; duplicates return the one encrypted capsule; the collector primitives open it to a scoped token and grant Mongo never stores in plaintext; the grant releases keys')
  // 5. Acknowledgement: delivered token plus remembered-PC secret, idempotent, clears delivery material; silent resume afterwards.
  await assert.rejects(connect.acknowledgeConnect(opened.token,{id:first.id,installationId:first.installationId,generation:first.generation,trustToken:'0'.repeat(64)},origin),(e:any)=>[401,403].includes(e.statusCode))
  await assert.rejects(connect.acknowledgeConnect(legacyToken,{id:first.id,installationId:first.installationId,generation:first.generation,trustToken:first.trustToken},origin),(e:any)=>[401,403].includes(e.statusCode))
  await assert.rejects(connect.acknowledgeConnect(opened.token,{id:first.id,installationId:first.installationId,generation:first.generation,trustToken:first.trustToken},'https://other.example.invalid'),(e:any)=>[401,403].includes(e.statusCode))
  assert.equal((await connect.acknowledgeConnect(opened.token,{id:first.id,installationId:first.installationId,generation:first.generation,trustToken:first.trustToken},origin)).acknowledged,true)
  assert.equal((await connect.acknowledgeConnect(opened.token,{id:first.id,installationId:first.installationId,generation:first.generation,trustToken:first.trustToken},origin)).acknowledged,true)
  row=await full(first.id);assert.equal(row.status,'acknowledged');assert.equal(row.capsule,undefined);assert.equal(row.codeHash,undefined);assert.equal(row.proofHash,undefined)
  await assert.rejects(connect.exchangeConnect({id:first.id,code:code3,verifier:first.verifier}),(e:any)=>[401,409].includes(e.statusCode))
  await assert.rejects(connect.approveConnect(first.id,{proof:auth.proof,accountIds:ids},origin),(e:any)=>[401,409].includes(e.statusCode))
  assert.ok((await service.resumeSession(opened.token,{installationId:first.installationId,generation:first.generation,trustToken:first.trustToken},origin)).grant)
  assert.equal((await connect.inspectConnectRequest(first.id)).status,'finished')
  pass('acknowledgement needs the delivered token and remembered-PC secret, is idempotent and clears delivery material; the remembered PC then resumes silently')
  // 6. Cancel, expiry, revocation and an MFA change between phases.
  const cancelled=await approved()
  const cancelledRow:any=await full(cancelled.id)
  assert.ok(await FinanceCollector.exists({_id:cancelledRow.collectorId,revokedAt:null}))
  await assert.rejects(connect.cancelConnect(cancelled.id,{proof:'0'.repeat(64)}),(e:any)=>[401,403].includes(e.statusCode))
  const bye=await connect.cancelConnect(cancelled.id,{proof:cancelled.proof});assert.equal(new URL(bye.redirectUri).searchParams.get('error'),'access_denied')
  assert.equal(((await full(cancelled.id)) as any).status,'cancelled');assert.ok(((await FinanceCollector.findById(cancelledRow.collectorId).lean()) as any).revokedAt)
  assert.equal(await models.CollectorInstallation.exists({_id:cancelled.installationId}),null)
  await assert.rejects(connect.exchangeConnect({id:cancelled.id,code:cancelled.code,verifier:cancelled.verifier}),(e:any)=>[401,409].includes(e.statusCode))
  const byState=await fresh();await connect.cancelConnect(byState.id,{state:byState.state});assert.equal((await connect.inspectConnectRequest(byState.id)).status,'cancelled')
  await assert.rejects(connect.cancelConnect((await fresh()).id,{state:'0'.repeat(64)}),(e:any)=>[401,403].includes(e.statusCode))
  const expired=await approved()
  await CollectorConnect.updateOne({_id:expired.id},{$set:{expiresAt:new Date(Date.now()-1000)}})
  await assert.rejects(connect.exchangeConnect({id:expired.id,code:expired.code,verifier:expired.verifier}),(e:any)=>e.statusCode===401)
  assert.ok(await connect.expireConnectRequests()>=1)
  const expiredRow:any=await full(expired.id);assert.equal(expiredRow.status,'expired');assert.equal(expiredRow.capsule,undefined)
  assert.ok(((await FinanceCollector.findById(expiredRow.collectorId).lean()) as any).revokedAt)
  assert.equal((await connect.inspectConnectRequest(expired.id)).status,'expired')
  const revoked=await approved()
  await FinanceCollector.updateOne({_id:((await full(revoked.id)) as any).collectorId},{$set:{revokedAt:new Date()}})
  await assert.rejects(connect.exchangeConnect({id:revoked.id,code:revoked.code,verifier:revoked.verifier}),(e:any)=>e.statusCode===401)
  const mfaChange=await approved()
  const mfaDelivered=await connect.exchangeConnect({id:mfaChange.id,code:mfaChange.code,verifier:mfaChange.verifier})
  const mfaKey=privateDecrypt({key:mfaChange.pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(mfaDelivered.capsule.wrapped,'base64'))
  const mfaOpened=openEnvelope(mfaDelivered.capsule,mfaKey,mfaDelivered.capsule.aad);mfaKey.fill(0)
  await User.updateOne({_id:user._id},{$set:{twoFactorSecret:generateSecret()}})
  await assert.rejects(connect.acknowledgeConnect(mfaOpened.token,{id:mfaChange.id,installationId:mfaChange.installationId,generation:mfaChange.generation,trustToken:mfaChange.trustToken},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(service.resumeSession(mfaOpened.token,{installationId:mfaChange.installationId,generation:mfaChange.generation,trustToken:mfaChange.trustToken},origin))
  await assert.rejects(service.getKey(mfaOpened.token,mfaOpened.grant,canaryKeyId))
  await User.updateOne({_id:user._id},{$set:{twoFactorSecret:previousSecret}})
  // Ordinary logins still issue sessions; the connect page never did.
  const {loginUser}=await import('../server/services/authService')
  assert.equal((await loginUser(user.email,password)).requires2FA,true)
  await assert.rejects(loginUser(user.email,'wrong'),/Invalid email or password/)
  pass('cancel and expiry revoke only the reserved collector and remove delivery material; revocation or an MFA change between phases blocks later use; ordinary login semantics are unchanged')
  // 7. Each binding check removed in turn: the attack then succeeds, so this leg would catch its loss.
  const attacks:Record<string,(mutant:any)=>Promise<void>>={
    proof:async m=>{const r=await authenticated();await assert.rejects(connect.approveConnect(r.id,{proof:'0'.repeat(64),accountIds:ids},origin));await m.approveConnect(r.id,{proof:'0'.repeat(64),accountIds:ids},origin)},
    origin:async m=>{const r=await authenticated();await assert.rejects(connect.approveConnect(r.id,{proof:r.proof,accountIds:ids},'https://other.example.invalid'));await m.approveConnect(r.id,{proof:r.proof,accountIds:ids},'https://other.example.invalid')},
    scope:async m=>{const r=await authenticated();await assert.rejects(connect.approveConnect(r.id,{proof:r.proof,accountIds:[String(foreign._id)]},origin));await m.approveConnect(r.id,{proof:r.proof,accountIds:[String(foreign._id)]},origin)},
    authstamp:async m=>{const r=await authenticated();await User.updateOne({_id:user._id},{$set:{twoFactorSecret:generateSecret()}});try{await assert.rejects(connect.approveConnect(r.id,{proof:r.proof,accountIds:ids},origin));await m.approveConnect(r.id,{proof:r.proof,accountIds:ids},origin)}finally{await User.updateOne({_id:user._id},{$set:{twoFactorSecret:previousSecret}})}},
    pkce:async m=>{const r=await approved();await assert.rejects(connect.exchangeConnect({id:r.id,code:r.code,verifier:'a'.repeat(43)}));await m.exchangeConnect({id:r.id,code:r.code,verifier:'a'.repeat(43)})},
    code:async m=>{const r=await approved();await assert.rejects(connect.exchangeConnect({id:r.id,code:'f'.repeat(64),verifier:r.verifier}));await m.exchangeConnect({id:r.id,code:'f'.repeat(64),verifier:r.verifier})},
    expiry:async m=>{const r=await approved();await CollectorConnect.updateOne({_id:r.id},{$set:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(connect.exchangeConnect({id:r.id,code:r.code,verifier:r.verifier}));await m.exchangeConnect({id:r.id,code:r.code,verifier:r.verifier})},
    revoked:async m=>{const r=await approved();await FinanceCollector.updateOne({_id:((await full(r.id)) as any).collectorId},{$set:{revokedAt:new Date()}});await assert.rejects(connect.exchangeConnect({id:r.id,code:r.code,verifier:r.verifier}));await m.exchangeConnect({id:r.id,code:r.code,verifier:r.verifier})}
  }
  for(const marker of BINDINGS)await withMutant(CONNECT_SERVICE,marker,attacks[marker])
  pass('each of the '+BINDINGS.length+' server bindings ('+BINDINGS.join(', ')+') was removed in turn and its attack then succeeded; the real service refuses all of them')
  await models.CollectorThrottle.deleteMany({})
  const throttled=await fresh()
  for(let i=0;i<10;i++)await assert.rejects(connect.authenticateConnect(throttled.id,{email:'nobody@example.invalid',password,code:''},origin),(e:any)=>e.statusCode===401)
  await assert.rejects(connect.authenticateConnect(throttled.id,{email:'nobody@example.invalid',password,code:''},origin),(e:any)=>e.statusCode===429)
  await models.CollectorThrottle.deleteMany({})
  for(let i=0;i<30;i++)await connect.createConnectRequest({...first.input,installationId:randomBytes(16).toString('hex'),state:randomBytes(32).toString('hex')},origin,'10.0.0.9')
  await assert.rejects(connect.createConnectRequest({...first.input,installationId:randomBytes(16).toString('hex'),state:randomBytes(32).toString('hex')},origin,'10.0.0.9'),(e:any)=>e.statusCode===429)
  await models.CollectorThrottle.deleteMany({})
  pass('connect sign-in attempts and token-less request creation are throttled by request and by caller, not only by a rotatable installation ID')
}

// Shared guard binding() (server/services/financeCollectorSecurityService.ts; plan omf-aplus-automation-20261013 §4b): a
// baseline of an active, selected, same-owner Aplus account A in both grant and device scope, five one-field attacks and
// the five single-line mutants. The real service refuses every attack; each mutant accepts exactly its own and nothing
// else. The Amex corpus is refused by the real service and each mutant exposes only its own shared predicate (account-live
// also releases the inactive Amex account's key — the defect the real line prevents). Fresh key IDs per attempt so the
// idempotent re-registration path never masks a refusal.
async function securityBindingLegs({pass,digest,origin,user,service,models}:{pass:(name:string)=>void,digest:(v:string)=>string,origin:string,user:any,service:any,models:any}){
  const {sealEnvelope}=await import('../collector/vault.mjs')
  const fresh:any=await User.findById(user._id).select('+password +twoFactorSecret +twoFactorBackupCodes')
  const authStamp=service.stamp(fresh),trustToken=randomBytes(32).toString('hex')
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const A:any=await FinancialAccount.create({ownerId:user._id,provider:'aplus',name:'Binding Aplus A',cardIdentifiers:['4321'],primaryCard:'4321'})
  const B:any=await FinancialAccount.create({ownerId:user._id,provider:'aplus',name:'Binding Aplus B',cardIdentifiers:['8765'],primaryCard:'8765'})
  const X:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Binding Amex X',cardIdentifiers:['45678'],primaryCard:'45678',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
  const device=async(accountIds:any[])=>{const token='omfc_'+randomBytes(32).toString('hex');const row:any=await FinanceCollector.create({ownerId:user._id,name:'Binding PC',tokenHash:digest(token),accountIds});return {token,row}}
  const installation=async(collectorId:any,accountIds:any[])=>{const id=randomBytes(16).toString('hex'),generation=randomBytes(32).toString('hex');await models.CollectorInstallation.create({_id:id,ownerId:user._id,collectorId,generation,publicKey:pair.publicKey,fingerprint:digest(pair.publicKey),origin,trustHash:digest(trustToken),authStamp,accountIds,trustedAt:new Date()});return {id,generation}}
  const grant=async(collectorId:any,inst:{id:string,generation:string},accountIds:any[])=>{const token=randomBytes(32).toString('hex');await models.CollectorGrant.create({_id:digest(token),ownerId:user._id,collectorId,installationId:inst.id,generation:inst.generation,origin,accountIds,authStamp,trustHash:digest(trustToken),expiresAt:new Date(Date.now()+20*60000)});return token}
  // The main device holds A, B and X with a matching grant; a narrower grant on the same device holds only B
  // (grant-scope attack); a second device holds only B while its grant names A and X (device-scope attack).
  const main=await device([A._id,B._id,X._id]),inst=await installation(main.row._id,[A._id,B._id,X._id]),mainGrant=await grant(main.row._id,inst,[A._id,B._id,X._id])
  const narrowGrant=await grant(main.row._id,inst,[B._id])
  const narrow=await device([B._id]),narrowInst=await installation(narrow.row._id,[B._id]),narrowDeviceGrant=await grant(narrow.row._id,narrowInst,[A._id,X._id])
  const record=(provider:string,accountId:string,entryId:string,at:{id:string,generation:string}=inst)=>{const keyId=randomBytes(32).toString('hex');const aad={v:3,installationId:at.id,origin,ownerId:String(user._id),provider,accountId,generation:at.generation,keyId};return {keyId,entryId,aad,wrapped:sealEnvelope(pair.publicKey,aad,{username:'synthetic',password:randomBytes(8).toString('hex')}).wrapped}}
  const refused=async(attempt:Promise<any>)=>{try{await attempt;return false}catch(error:any){if([400,403].includes(error?.statusCode))return true;throw error}}
  const aplusAttacks:Record<string,(svc:any)=>Promise<any>>={
    'entry':svc=>svc.putKey(main.token,mainGrant,record('aplus',String(A._id),'aplus-'+String(B._id))),
    'grant-scope':svc=>svc.putKey(main.token,narrowGrant,record('aplus',String(A._id),'aplus-'+String(A._id))),
    'device-scope':svc=>svc.putKey(narrow.token,narrowDeviceGrant,record('aplus',String(A._id),'aplus-'+String(A._id),narrowInst)),
    'account-live':svc=>svc.putKey(main.token,mainGrant,record('aplus',String(X._id),'aplus-'+String(X._id))),
    'service':svc=>svc.putKey(main.token,mainGrant,record('aplus','aplus','aplus-x'))
  }
  const amexAttacks:Record<string,(svc:any)=>Promise<any>>={
    'entry':svc=>svc.putKey(main.token,mainGrant,record('amex',String(X._id),'amex-'+String(A._id))),
    'grant-scope':svc=>svc.putKey(main.token,narrowGrant,record('amex',String(X._id),'amex-'+String(X._id))),
    'device-scope':svc=>svc.putKey(narrow.token,narrowDeviceGrant,record('amex',String(X._id),'amex-'+String(X._id),narrowInst)),
    'account-live':async svc=>{await FinancialAccount.updateOne({_id:X._id},{$set:{active:false}});try{return await svc.putKey(main.token,mainGrant,record('amex',String(X._id),'amex-'+String(X._id)))}finally{await FinancialAccount.updateOne({_id:X._id},{$set:{active:true}})}}
  }
  const baseline=record('aplus',String(A._id),'aplus-'+String(A._id)),amexBaseline=record('amex',String(X._id),'amex-'+String(X._id))
  await service.putKey(main.token,mainGrant,baseline);assert.equal((await service.getKey(main.token,mainGrant,baseline.keyId)).wrapped,baseline.wrapped)
  await service.putKey(main.token,mainGrant,amexBaseline);assert.equal((await service.getKey(main.token,mainGrant,amexBaseline.keyId)).wrapped,amexBaseline.wrapped)
  for(const name of SECURITY_BINDINGS)assert.equal(await refused(aplusAttacks[name](service)),true,'the real service accepted the Aplus attack '+name)
  for(const name of Object.keys(amexAttacks))assert.equal(await refused(amexAttacks[name](service)),true,'the real service accepted the Amex attack '+name)
  pass('binding(): the real service releases the baseline Aplus and Amex keys of a selected, active, same-owner account and refuses the five Aplus attacks (entry, grant-scope, device-scope, account-live, service) and the four Amex attacks')
  for(const marker of SECURITY_BINDINGS)await withMutant(SECURITY_SERVICE,marker,async m=>{
    for(const name of SECURITY_BINDINGS)assert.equal(await refused(aplusAttacks[name](m)),name!==marker,`mutant ${marker}: the Aplus attack ${name} was ${name===marker?'still refused':'accepted'}`)
    for(const name of Object.keys(amexAttacks))assert.equal(await refused(amexAttacks[name](m)),name!==marker,`mutant ${marker}: the Amex attack ${name} was ${name===marker?'still refused':'accepted'}`)
  })
  pass('each of the '+SECURITY_BINDINGS.length+' binding mutants accepts exactly its own Aplus attack and only its own shared Amex predicate (account-live: the inactive Amex account), refusing every other attack')
}

// Bank entries (plan omf-rakuten-auto-login-20261021 §4): the saved 楽天銀行 standard login rakuten-<bankAccountId> of an owned
// BankAccount the owner granted to this device AFTER the card-only PC pairing (FinanceCollector.bankAccountIds; the grant and the
// installation keep card ids only). Positive flow without a new connection or a fake card, then one-field attacks, revocation and
// account changes between the checks and the key I/O, the legacy card/service keys on the same grant, and each new binding line
// removed in turn from a mutant copy: the mutant accepts exactly its own attack and nothing else.
async function bankBindingLegs({pass,digest,origin,user,other,service,models}:{pass:(name:string)=>void,digest:(v:string)=>string,origin:string,user:any,other:any,service:any,models:any}){
  const {sealEnvelope}=await import('../collector/vault.mjs')
  const {BankAccount}=await import('../server/models/FinancePaymentMatch')
  const fresh:any=await User.findById(user._id).select('+password +twoFactorSecret +twoFactorBackupCodes')
  const authStamp=service.stamp(fresh),trustToken=randomBytes(32).toString('hex')
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const card:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Bank-leg Amex',cardIdentifiers:['56789'],primaryCard:'56789',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
  const aplus:any=await FinancialAccount.create({ownerId:user._id,provider:'aplus',name:'Bank-leg Aplus',cardIdentifiers:['9876'],primaryCard:'9876'})
  const connection=(provider:string,variant:string|null)=>({provider,templateId:'e5e5e5e5e5e5e5e5e5e5e5e5',transactionIdConfirmed:false,accountLabel:null,variant,coverage:{from:'2025-11-01',to:null},connectedAt:new Date()})
  const R:any=await BankAccount.create({ownerId:user._id,name:'Fictional Rakuten',currency:'JPY',revision:1,connection:connection('rakuten','standard')})
  const R2:any=await BankAccount.create({ownerId:user._id,name:'Fictional Rakuten 2',currency:'JPY',revision:1,connection:connection('rakuten','standard')})
  const P:any=await BankAccount.create({ownerId:user._id,name:'Fictional Rakuten Plus',currency:'JPY',revision:1,connection:connection('rakuten','plus')})
  const F:any=await BankAccount.create({ownerId:other._id,name:'Foreign Rakuten',currency:'JPY',revision:1,connection:connection('rakuten','standard')})
  // Card-only pairing: device, installation and grant name the two cards only; the bank scope is added to the device afterwards.
  const token='omfc_'+randomBytes(32).toString('hex')
  const device:any=await FinanceCollector.create({ownerId:user._id,name:'Bank-leg PC',tokenHash:digest(token),accountIds:[card._id,aplus._id]})
  const inst={id:randomBytes(16).toString('hex'),generation:randomBytes(32).toString('hex')}
  await models.CollectorInstallation.create({_id:inst.id,ownerId:user._id,collectorId:device._id,generation:inst.generation,publicKey:pair.publicKey,fingerprint:digest(pair.publicKey),origin,trustHash:digest(trustToken),authStamp,accountIds:[card._id,aplus._id],trustedAt:new Date()})
  const grantFor=async(collectorId:any,at=inst,expiresAt=new Date(Date.now()+20*60000))=>{const g=randomBytes(32).toString('hex');await models.CollectorGrant.create({_id:digest(g),ownerId:user._id,collectorId,installationId:at.id,generation:at.generation,origin,accountIds:[card._id,aplus._id],authStamp,trustHash:digest(trustToken),expiresAt});return g}
  const grant=await grantFor(device._id)
  const scope=(ids:any[])=>FinanceCollector.updateOne({_id:device._id},{$set:{bankAccountIds:ids}})
  await scope([R._id,P._id,F._id])
  const record=(provider:string,accountId:string,entryId:string,{at=inst,ownerId=String(user._id),aadOrigin=origin}:{at?:{id:string,generation:string},ownerId?:string,aadOrigin?:string}={})=>{const keyId=randomBytes(32).toString('hex');const aad={v:3,installationId:at.id,origin:aadOrigin,ownerId,provider,accountId,generation:at.generation,keyId};return {keyId,entryId,aad,wrapped:sealEnvelope(pair.publicKey,aad,{username:'fictional',password:randomBytes(8).toString('hex')}).wrapped}}
  const bankRecord=(id:any=R._id,entry='rakuten-'+String(id),extra={})=>record('rakuten',String(id),entry,extra)
  const refused=async(attempt:Promise<any>)=>{try{await attempt;return false}catch(error:any){if([400,401,403,404].includes(error?.statusCode))return true;throw error}}
  // 1. Positive: put, idempotent re-put, read-after-write and a later read under a renewed grant — the real current flow.
  const base=bankRecord()
  await service.putKey(token,grant,base);await service.putKey(token,grant,base)
  assert.equal((await service.getKey(token,grant,base.keyId)).wrapped,base.wrapped,'bank:read-after-write')
  const renewed=await grantFor(device._id);assert.equal((await service.getKey(token,renewed,base.keyId)).wrapped,base.wrapped,'bank:renewed-grant-read')
  await assert.rejects(service.putKey(token,grant,{...base,wrapped:sealEnvelope(pair.publicKey,base.aad,{x:1}).wrapped}),(e:any)=>e.statusCode===409,'bank:key-replay-different-data')
  pass('bank key: a Rakuten standard account granted to the device after the card-only pairing seals, re-registers idempotently, reads back and reads under a renewed grant; no bank field in the grant, no fake card, no new connection')
  // 2. Legacy keys on the same card-only grant keep working next to the bank key.
  for(const r of [record('amex',String(card._id),'amex-'+String(card._id)),record('aplus',String(aplus._id),'aplus-'+String(aplus._id)),record('aplus','aplus','aplus'),record('gmail','gmail','gmail'),record('yayoi','yayoi','yayoi'),record('check','check','check'),record('legacy','legacy-1700000000000','legacy-1700000000000')]){await service.putKey(token,grant,r);assert.equal((await service.getKey(token,grant,r.keyId)).wrapped,r.wrapped,'bank:legacy-compatible '+r.entryId)}
  pass('the same card-only grant still releases Amex, per-account Aplus, legacy Aplus, Gmail, Yayoi, check and archived legacy keys')
  // 3. One-field attacks, each with a fresh key id: the real service refuses every one.
  const otherDevice=await FinanceCollector.create({ownerId:user._id,name:'Other PC',tokenHash:digest('omfc_'+'9'.repeat(64)),accountIds:[card._id]})
  const BANK_ATTACKS:Record<string,(svc:any)=>Promise<any>>={
    'bank-entry':svc=>svc.putKey(token,grant,bankRecord(R._id,'rakuten-'+String(R2._id))),
    'bank-scope':svc=>svc.putKey(token,grant,bankRecord(R2._id)),
    'bank-live':svc=>svc.putKey(token,grant,bankRecord(P._id)),
    'bank-owner':svc=>svc.putKey(token,grant,bankRecord(F._id))
  }
  const otherAttacks:Record<string,(svc:any)=>Promise<any>>={
    'card-as-bank':svc=>svc.putKey(token,grant,record('rakuten',String(card._id),'rakuten-'+String(card._id))),
    'bank-as-card':svc=>svc.putKey(token,grant,record('amex',String(R._id),'amex-'+String(R._id))),
    'bank-as-aplus':svc=>svc.putKey(token,grant,record('aplus',String(R._id),'aplus-'+String(R._id))),
    'bank-as-service':svc=>svc.putKey(token,grant,record('rakuten','rakuten','rakuten')),
    'bank-malformed-id':svc=>svc.putKey(token,grant,record('rakuten','x','rakuten-x')),
    'aad-owner':svc=>svc.putKey(token,grant,bankRecord(R._id,undefined,{ownerId:String(other._id)})),
    'aad-origin':svc=>svc.putKey(token,grant,bankRecord(R._id,undefined,{aadOrigin:'https://other.example.invalid'})),
    'aad-installation':svc=>svc.putKey(token,grant,bankRecord(R._id,undefined,{at:{id:randomBytes(16).toString('hex'),generation:inst.generation}})),
    'aad-generation':svc=>svc.putKey(token,grant,bankRecord(R._id,undefined,{at:{id:inst.id,generation:randomBytes(32).toString('hex')}})),
    'aad-keyid':svc=>{const r=bankRecord();return svc.putKey(token,grant,{...r,keyId:randomBytes(32).toString('hex')})},
    'poll-token-as-grant':svc=>svc.putKey(token,token.slice(5),bankRecord()),
    'other-device-token':svc=>svc.getKey('omfc_'+'9'.repeat(64),grant,base.keyId)
  }
  void otherDevice
  for(const [name,attack] of Object.entries({...BANK_ATTACKS,...otherAttacks}))assert.equal(await refused(attack(service)),true,'the real service accepted the bank attack '+name)
  pass('bank key attacks refused: wrong entry, bank outside the device scope, plus/changed variant, another owner\'s bank, card↔bank impersonation, service-named bank entry, malformed id, owner/origin/installation/generation/key-id mismatch, poll token as grant, another device')
  // 4. Changes after the save: removed scope, provider/variant change, deletion, expiry, revocation and an inactive owner stop release.
  const release=()=>service.getKey(token,grant,base.keyId)
  await scope([P._id,F._id]);assert.equal(await refused(release()),true,'bank:removed-scope');await scope([R._id,P._id,F._id])
  for(const change of [{'connection.provider':'paypay'},{'connection.variant':'plus'},{'connection.variant':null},{connection:null}]){const saved:any=await BankAccount.findById(R._id).lean();await BankAccount.updateOne({_id:R._id},{$set:change});assert.equal(await refused(release()),true,'bank:changed-connection '+JSON.stringify(change));await BankAccount.updateOne({_id:R._id},{$set:{connection:saved.connection}})}
  await models.CollectorGrant.updateOne({_id:digest(grant)},{$set:{expiresAt:new Date(Date.now()-1000)}});assert.equal(await refused(release()),true,'bank:expired-grant');await models.CollectorGrant.updateOne({_id:digest(grant)},{$set:{expiresAt:new Date(Date.now()+20*60000)}})
  await models.CollectorGrant.updateOne({_id:digest(grant)},{$set:{revokedAt:new Date()}});assert.equal(await refused(release()),true,'bank:revoked-grant');await models.CollectorGrant.updateOne({_id:digest(grant)},{$unset:{revokedAt:1}})
  await FinanceCollector.updateOne({_id:device._id},{$set:{revokedAt:new Date()}});assert.equal(await refused(release()),true,'bank:revoked-device');await FinanceCollector.updateOne({_id:device._id},{$unset:{revokedAt:1}})
  await User.updateOne({_id:user._id},{$set:{isActive:false}});assert.equal(await refused(release()),true,'bank:inactive-owner');await User.updateOne({_id:user._id},{$set:{isActive:true}})
  assert.equal((await release()).wrapped,base.wrapped,'bank:restored-release')
  pass('after the save, a removed bank scope, a provider/variant change, a cleared connection, an expired or revoked grant, a revoked device and an inactive owner each stop the bank key release; restoring them releases it again')
  // 5. Races: the scope removed or the account changed after the first binding check and before the key I/O completes.
  // The change lands when the service reads the device the SECOND time in the attempt (its post-I/O activeGrant): after the first
  // binding check and the key I/O, before the recheck — independent of which binding line a mutant copy removed.
  const findOne=FinanceCollector.findOne.bind(FinanceCollector)
  const raced=async(svc:any,attempt:()=>Promise<any>,change:()=>Promise<any>,undo:()=>Promise<any>)=>{let reads=0,fired=false;(FinanceCollector as any).findOne=(...args:any[])=>{const q:any=(findOne as any)(...args);if(++reads===2&&!fired){fired=true;const lean=q.lean.bind(q);q.lean=async(...l:any[])=>{await change();return lean(...l)}}return q};try{const result=await refused(attempt());assert.equal(fired,true,'the race hook fired (second device read)');return result}finally{(FinanceCollector as any).findOne=findOne;await undo()}}
  // Each race is caught by the recheck AND names the binding line whose repeated predicate catches it.
  const RACES:Record<string,{guard:string,recheck:string,run:(svc:any)=>Promise<boolean>}>={
    'get-scope':{guard:'bank-scope',recheck:'bank-recheck-get',run:svc=>raced(svc,()=>svc.getKey(token,grant,base.keyId),()=>scope([P._id,F._id]),()=>scope([R._id,P._id,F._id]))},
    'get-variant':{guard:'bank-live',recheck:'bank-recheck-get',run:svc=>raced(svc,()=>svc.getKey(token,grant,base.keyId),()=>BankAccount.updateOne({_id:R._id},{$set:{'connection.variant':'plus'}}),()=>BankAccount.updateOne({_id:R._id},{$set:{'connection.variant':'standard'}}))},
    'put-scope':{guard:'bank-scope',recheck:'bank-recheck-put',run:svc=>raced(svc,()=>svc.putKey(token,grant,bankRecord()),()=>scope([P._id,F._id]),()=>scope([R._id,P._id,F._id]))}
  }
  for(const [name,race] of Object.entries(RACES))assert.equal(await race.run(service),true,'the real service released a bank key across the race '+name)
  assert.equal((await release()).wrapped,base.wrapped)
  pass('a bank scope removal or variant change between the first binding check and the end of the key I/O is caught by the post-I/O recheck (get and put)')
  // 6. Each bank binding line removed in turn: the mutant accepts exactly its own attack (bank-recheck: the races) and nothing else.
  for(const marker of BANK_BINDINGS)await withMutant(SECURITY_SERVICE,marker,async m=>{
    for(const [name,attack] of Object.entries(BANK_ATTACKS)){const expected=name===marker||(marker==='bank-live'&&name==='bank-owner');assert.equal(await refused(attack(m)),!expected,`bank mutant ${marker}: the attack ${name} was ${expected?'still refused':'accepted'}`)}
    for(const [name,attack] of Object.entries(otherAttacks))assert.equal(await refused(attack(m)),true,`bank mutant ${marker}: the attack ${name} was accepted`)
    for(const [name,race] of Object.entries(RACES)){const open=marker===race.recheck||marker===race.guard;assert.equal(await race.run(m),!open,`bank mutant ${marker}: the race ${name} was ${open?'still refused':'accepted'}`)}
    assert.equal((await m.getKey(token,grant,base.keyId)).wrapped,base.wrapped,`bank mutant ${marker}: the legitimate bank key`)
  })
  pass('each of the '+BANK_BINDINGS.length+' bank binding mutants ('+BANK_BINDINGS.join(', ')+') accepts exactly its own attack (bank-live also the foreign-owner account it checks; bank-recheck-get/-put the races of their own key operation; bank-scope/bank-live also the races their repeated predicate catches) and still refuses every other attack')
}

// PayPay銀行 標準 entries (plan omf-paypay-four-accounts-20261021): paypay-<bankAccountId> of an owned BankAccount whose live connection
// is paypay/standard, granted to THIS device after the card-only pairing — four separate accounts on one PC. The same five bank
// binding lines guard them; this leg proves the positive four-account flow, provider/variant/entry/scope/owner confusion between
// PayPay and 楽天銀行 entries, after-save changes and post-I/O races per account, and each binding line removed in turn.
async function paypayBindingLegs({pass,digest,origin,user,other,service,models}:{pass:(name:string)=>void,digest:(v:string)=>string,origin:string,user:any,other:any,service:any,models:any}){
  const {sealEnvelope}=await import('../collector/vault.mjs')
  const {BankAccount}=await import('../server/models/FinancePaymentMatch')
  const fresh:any=await User.findById(user._id).select('+password +twoFactorSecret +twoFactorBackupCodes')
  const authStamp=service.stamp(fresh),trustToken=randomBytes(32).toString('hex')
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const card:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'PayPay-leg Amex',cardIdentifiers:['67890'],primaryCard:'67890',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
  const connection=(provider:string,variant:string|null)=>({provider,templateId:null,transactionIdConfirmed:false,accountLabel:null,variant,coverage:null,connectedAt:new Date()})
  const P:any[]=[];for(let i=1;i<=4;i++)P.push(await BankAccount.create({ownerId:user._id,name:'Fictional PayPay '+i,currency:'JPY',revision:1,connection:connection('paypay','standard')}))
  const outside:any=await BankAccount.create({ownerId:user._id,name:'Fictional PayPay 5 (not granted)',currency:'JPY',revision:1,connection:connection('paypay','standard')})
  const baplus:any=await BankAccount.create({ownerId:user._id,name:'Fictional PayPay BA-PLUS',currency:'JPY',revision:1,connection:connection('paypay','baplus')})
  const plain:any=await BankAccount.create({ownerId:user._id,name:'Fictional PayPay (no login type)',currency:'JPY',revision:1,connection:connection('paypay',null)})
  const rakuten:any=await BankAccount.create({ownerId:user._id,name:'Fictional Rakuten (PayPay leg)',currency:'JPY',revision:1,connection:connection('rakuten','standard')})
  const foreign:any=await BankAccount.create({ownerId:other._id,name:'Foreign PayPay',currency:'JPY',revision:1,connection:connection('paypay','standard')})
  const token='omfc_'+randomBytes(32).toString('hex')
  const device:any=await FinanceCollector.create({ownerId:user._id,name:'PayPay-leg PC',tokenHash:digest(token),accountIds:[card._id]})
  const inst={id:randomBytes(16).toString('hex'),generation:randomBytes(32).toString('hex')}
  await models.CollectorInstallation.create({_id:inst.id,ownerId:user._id,collectorId:device._id,generation:inst.generation,publicKey:pair.publicKey,fingerprint:digest(pair.publicKey),origin,trustHash:digest(trustToken),authStamp,accountIds:[card._id],trustedAt:new Date()})
  const grantFor=async()=>{const g=randomBytes(32).toString('hex');await models.CollectorGrant.create({_id:digest(g),ownerId:user._id,collectorId:device._id,installationId:inst.id,generation:inst.generation,origin,accountIds:[card._id],authStamp,trustHash:digest(trustToken),expiresAt:new Date(Date.now()+20*60000)});return g}
  const grant=await grantFor()
  const SCOPE=[...P.map(a=>a._id),baplus._id,plain._id,rakuten._id,foreign._id]
  const scope=(ids:any[])=>FinanceCollector.updateOne({_id:device._id},{$set:{bankAccountIds:ids}})
  await scope(SCOPE)
  const record=(provider:string,accountId:string,entryId:string,{ownerId=String(user._id)}:{ownerId?:string}={})=>{const keyId=randomBytes(32).toString('hex');const aad={v:3,installationId:inst.id,origin,ownerId,provider,accountId,generation:inst.generation,keyId};return {keyId,entryId,aad,wrapped:sealEnvelope(pair.publicKey,aad,{branch:'001',account:'0000001',password:randomBytes(8).toString('hex')}).wrapped}}
  const pp=(account:any,entry='paypay-'+String(account._id),extra={})=>record('paypay',String(account._id),entry,extra)
  const refused=async(attempt:Promise<any>)=>{try{await attempt;return false}catch(error:any){if([400,401,403,404].includes(error?.statusCode))return true;throw error}}
  // 1. Positive: four separate PayPay keys on one card-only grant, idempotent, read back, distinct key ids; the rakuten key next to them.
  const keys=P.map(a=>pp(a))
  for(const k of keys){await service.putKey(token,grant,k);await service.putKey(token,grant,k)}
  for(const k of keys)assert.equal((await service.getKey(token,grant,k.keyId)).wrapped,k.wrapped,'paypay:read-after-write')
  const renewed=await grantFor();for(const k of keys)assert.equal((await service.getKey(token,renewed,k.keyId)).aad.accountId,k.aad.accountId,'paypay:renewed-grant-read')
  assert.equal(new Set(keys.map(k=>k.keyId)).size,4);assert.deepEqual(keys.map(k=>k.entryId),P.map(a=>'paypay-'+String(a._id)))
  const rk=record('rakuten',String(rakuten._id),'rakuten-'+String(rakuten._id));await service.putKey(token,grant,rk);assert.equal((await service.getKey(token,grant,rk.keyId)).wrapped,rk.wrapped,'paypay:rakuten-key-next-to-paypay')
  const cardKey=record('amex',String(card._id),'amex-'+String(card._id));await service.putKey(token,grant,cardKey);assert.equal((await service.getKey(token,grant,cardKey.keyId)).wrapped,cardKey.wrapped,'paypay:card-key-unchanged')
  pass('paypay key: four PayPay標準 accounts granted to one device after its card-only pairing each seal, re-register idempotently and read back their own key (also under a renewed grant); the 楽天銀行 and Amex keys of the same grant are unchanged')
  // 2. Attacks: `opens` names the binding line whose removal lets the attack through; every other attack stays refused by another line.
  const otherDevice=await FinanceCollector.create({ownerId:user._id,name:'PayPay-leg other PC',tokenHash:digest('omfc_'+'8'.repeat(64)),accountIds:[card._id],bankAccountIds:SCOPE})
  const ATTACKS:Record<string,{opens:string[],run:(svc:any)=>Promise<any>}>={
    'paypay-entry-other-account':{opens:['bank-entry'],run:svc=>svc.putKey(token,grant,pp(P[0],'paypay-'+String(P[1]._id)))},
    'paypay-entry-as-rakuten':{opens:['bank-entry'],run:svc=>svc.putKey(token,grant,pp(P[0],'rakuten-'+String(P[0]._id)))},
    'paypay-outside-scope':{opens:['bank-scope'],run:svc=>svc.putKey(token,grant,pp(outside))},
    'paypay-baplus':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,pp(baplus))},
    'paypay-no-login-type':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,pp(plain))},
    'paypay-on-rakuten-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,pp(rakuten))},
    'rakuten-on-paypay-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,record('rakuten',String(P[0]._id),'rakuten-'+String(P[0]._id)))},
    'paypay-other-owner':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,pp(foreign))},
    'paypay-as-card':{opens:[],run:svc=>svc.putKey(token,grant,record('amex',String(P[0]._id),'amex-'+String(P[0]._id)))},
    'paypay-as-service':{opens:[],run:svc=>svc.putKey(token,grant,record('paypay','paypay','paypay'))},
    'paypay-malformed-id':{opens:[],run:svc=>svc.putKey(token,grant,record('paypay','x','paypay-x'))},
    'paypay-aad-owner':{opens:[],run:svc=>svc.putKey(token,grant,pp(P[0],undefined,{ownerId:String(other._id)}))},
    'paypay-aad-keyid':{opens:[],run:svc=>{const r=pp(P[0]);return svc.putKey(token,grant,{...r,keyId:randomBytes(32).toString('hex')})}},
    'paypay-poll-token-as-grant':{opens:[],run:svc=>svc.putKey(token,token.slice(5),pp(P[0]))},
    'paypay-other-device':{opens:[],run:svc=>svc.getKey('omfc_'+'8'.repeat(64),grant,keys[0].keyId)}
  }
  void otherDevice
  for(const [name,attack] of Object.entries(ATTACKS))assert.equal(await refused(attack.run(service)),true,'the real service accepted the PayPay attack '+name)
  pass('paypay key attacks refused: another account\'s or a 楽天銀行-named entry, an account outside the device scope, BA-PLUS or no login type, a PayPay AAD on a 楽天銀行 account and a 楽天銀行 AAD on a PayPay account, another owner\'s account, PayPay as a card or service entry, malformed id, owner/key-id mismatch, poll token as grant, another device')
  // 3. Changes after the save stop that account's release only; restoring them releases it again.
  const release=(i=0)=>service.getKey(token,grant,keys[i].keyId)
  await scope(SCOPE.filter(id=>String(id)!==String(P[0]._id)));assert.equal(await refused(release(0)),true,'paypay:removed-scope');assert.equal((await release(1)).wrapped,keys[1].wrapped,'paypay:other-account-unaffected');await scope(SCOPE)
  for(const change of [{'connection.provider':'rakuten'},{'connection.variant':'baplus'},{'connection.variant':null},{connection:null}]){const saved:any=await BankAccount.findById(P[0]._id).lean();await BankAccount.updateOne({_id:P[0]._id},{$set:change});assert.equal(await refused(release(0)),true,'paypay:changed-connection '+JSON.stringify(change));assert.equal((await release(2)).wrapped,keys[2].wrapped,'paypay:other-account-unaffected');await BankAccount.updateOne({_id:P[0]._id},{$set:{connection:saved.connection}})}
  await models.CollectorGrant.updateOne({_id:digest(grant)},{$set:{revokedAt:new Date()}});for(const i of [0,1,2,3])assert.equal(await refused(release(i)),true,'paypay:revoked-grant');await models.CollectorGrant.updateOne({_id:digest(grant)},{$unset:{revokedAt:1}})
  await FinanceCollector.updateOne({_id:device._id},{$set:{revokedAt:new Date()}});assert.equal(await refused(release(3)),true,'paypay:revoked-device');await FinanceCollector.updateOne({_id:device._id},{$unset:{revokedAt:1}})
  for(const i of [0,1,2,3])assert.equal((await release(i)).wrapped,keys[i].wrapped,'paypay:restored-release')
  pass('after the save, a removed scope, a provider change to 楽天銀行, a BA-PLUS/no login type change and a cleared connection each stop that PayPay account\'s release while the other accounts keep theirs; a revoked grant or device stops all four; restoring releases again')
  // 4. Races between the first binding check and the end of the key I/O (the second device read), per operation.
  const findOne=FinanceCollector.findOne.bind(FinanceCollector)
  const raced=async(attempt:()=>Promise<any>,change:()=>Promise<any>,undo:()=>Promise<any>)=>{let reads=0,fired=false;(FinanceCollector as any).findOne=(...args:any[])=>{const q:any=(findOne as any)(...args);if(++reads===2&&!fired){fired=true;const lean=q.lean.bind(q);q.lean=async(...l:any[])=>{await change();return lean(...l)}}return q};try{const result=await refused(attempt());assert.equal(fired,true,'the race hook fired (second device read)');return result}finally{(FinanceCollector as any).findOne=findOne;await undo()}}
  const without0=()=>scope(SCOPE.filter(id=>String(id)!==String(P[0]._id))),restore=()=>scope(SCOPE)
  const RACES:Record<string,{guard:string,recheck:string,run:(svc:any)=>Promise<boolean>}>={
    'paypay-get-scope':{guard:'bank-scope',recheck:'bank-recheck-get',run:svc=>raced(()=>svc.getKey(token,grant,keys[0].keyId),without0,restore)},
    'paypay-get-variant':{guard:'bank-live',recheck:'bank-recheck-get',run:svc=>raced(()=>svc.getKey(token,grant,keys[0].keyId),()=>BankAccount.updateOne({_id:P[0]._id},{$set:{'connection.variant':'baplus'}}),()=>BankAccount.updateOne({_id:P[0]._id},{$set:{'connection.variant':'standard'}}))},
    'paypay-put-scope':{guard:'bank-scope',recheck:'bank-recheck-put',run:svc=>raced(()=>svc.putKey(token,grant,pp(P[0])),without0,restore)}
  }
  for(const [name,race] of Object.entries(RACES))assert.equal(await race.run(service),true,'the real service released a PayPay key across the race '+name)
  pass('a PayPay scope removal or BA-PLUS change between the first binding check and the end of the key I/O is caught by the post-I/O recheck (get and put)')
  // 5. Each bank binding line removed in turn: exactly the attacks it opens get through; every other attack and race outcome holds.
  for(const marker of BANK_BINDINGS)await withMutant(SECURITY_SERVICE,marker,async m=>{
    for(const [name,attack] of Object.entries(ATTACKS)){const open=attack.opens.includes(marker);assert.equal(await refused(attack.run(m)),!open,`paypay mutant ${marker}: the attack ${name} was ${open?'still refused':'accepted'}`)}
    for(const [name,race] of Object.entries(RACES)){const open=marker===race.recheck||marker===race.guard;assert.equal(await race.run(m),!open,`paypay mutant ${marker}: the race ${name} was ${open?'still refused':'accepted'}`)}
    for(const i of [0,1,2,3])assert.equal((await m.getKey(token,grant,keys[i].keyId)).wrapped,keys[i].wrapped,`paypay mutant ${marker}: the legitimate PayPay key ${i}`)
  })
  pass('each of the '+BANK_BINDINGS.length+' bank binding mutants lets through exactly the PayPay attacks and races its line guards (bank-entry: entry names; bank-scope: the device scope; bank-live: provider, login type and owner) and still refuses every other attack')
}

// 池田泉州銀行 ビジネスゲート entries (plan omf-ikeda-collector-20261025): ikeda-<bankAccountId> of an owned BankAccount whose live
// connection is ikeda/portal (the password-only certificate login), granted to THIS device after the card-only pairing. The same five
// bank binding lines guard them; this leg proves the positive flow next to PayPay/楽天銀行/card keys, provider/variant/entry/scope/owner
// confusion with the other bank entries (the インターネットEB `direct` variant and a connection without a login type included), after-save
// changes and post-I/O races, and each binding line removed in turn.
async function ikedaBindingLegs({pass,digest,origin,user,other,service,models}:{pass:(name:string)=>void,digest:(v:string)=>string,origin:string,user:any,other:any,service:any,models:any}){
  const {sealEnvelope}=await import('../collector/vault.mjs')
  const {BankAccount}=await import('../server/models/FinancePaymentMatch')
  const fresh:any=await User.findById(user._id).select('+password +twoFactorSecret +twoFactorBackupCodes')
  const authStamp=service.stamp(fresh),trustToken=randomBytes(32).toString('hex')
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const card:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Ikeda-leg Amex',cardIdentifiers:['24680'],primaryCard:'24680',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
  const connection=(provider:string,variant:string|null)=>({provider,templateId:null,transactionIdConfirmed:false,accountLabel:null,variant,coverage:null,connectedAt:new Date()})
  const I:any=await BankAccount.create({ownerId:user._id,name:'Fictional Ikeda portal',currency:'JPY',revision:1,connection:connection('ikeda','portal')})
  const I2:any=await BankAccount.create({ownerId:user._id,name:'Fictional Ikeda portal 2',currency:'JPY',revision:1,connection:connection('ikeda','portal')})
  const outside:any=await BankAccount.create({ownerId:user._id,name:'Fictional Ikeda (not granted)',currency:'JPY',revision:1,connection:connection('ikeda','portal')})
  const direct:any=await BankAccount.create({ownerId:user._id,name:'Fictional Ikeda インターネットEB',currency:'JPY',revision:1,connection:connection('ikeda','direct')})
  const plain:any=await BankAccount.create({ownerId:user._id,name:'Fictional Ikeda (no login type)',currency:'JPY',revision:1,connection:connection('ikeda',null)})
  const paypay:any=await BankAccount.create({ownerId:user._id,name:'Fictional PayPay (Ikeda leg)',currency:'JPY',revision:1,connection:connection('paypay','standard')})
  const rakuten:any=await BankAccount.create({ownerId:user._id,name:'Fictional Rakuten (Ikeda leg)',currency:'JPY',revision:1,connection:connection('rakuten','standard')})
  const foreign:any=await BankAccount.create({ownerId:other._id,name:'Foreign Ikeda',currency:'JPY',revision:1,connection:connection('ikeda','portal')})
  const token='omfc_'+randomBytes(32).toString('hex')
  const device:any=await FinanceCollector.create({ownerId:user._id,name:'Ikeda-leg PC',tokenHash:digest(token),accountIds:[card._id]})
  const inst={id:randomBytes(16).toString('hex'),generation:randomBytes(32).toString('hex')}
  await models.CollectorInstallation.create({_id:inst.id,ownerId:user._id,collectorId:device._id,generation:inst.generation,publicKey:pair.publicKey,fingerprint:digest(pair.publicKey),origin,trustHash:digest(trustToken),authStamp,accountIds:[card._id],trustedAt:new Date()})
  const grantFor=async()=>{const g=randomBytes(32).toString('hex');await models.CollectorGrant.create({_id:digest(g),ownerId:user._id,collectorId:device._id,installationId:inst.id,generation:inst.generation,origin,accountIds:[card._id],authStamp,trustHash:digest(trustToken),expiresAt:new Date(Date.now()+20*60000)});return g}
  const grant=await grantFor()
  const SCOPE=[I._id,I2._id,direct._id,plain._id,paypay._id,rakuten._id,foreign._id]
  const scope=(ids:any[])=>FinanceCollector.updateOne({_id:device._id},{$set:{bankAccountIds:ids}})
  await scope(SCOPE)
  const record=(provider:string,accountId:string,entryId:string,{ownerId=String(user._id)}:{ownerId?:string}={})=>{const keyId=randomBytes(32).toString('hex');const aad={v:3,installationId:inst.id,origin,ownerId,provider,accountId,generation:inst.generation,keyId};return {keyId,entryId,aad,wrapped:sealEnvelope(pair.publicKey,aad,{password:randomBytes(6).toString('hex')}).wrapped}}
  const ik=(account:any,entry='ikeda-'+String(account._id),extra={})=>record('ikeda',String(account._id),entry,extra)
  const refused=async(attempt:Promise<any>)=>{try{await attempt;return false}catch(error:any){if([400,401,403,404].includes(error?.statusCode))return true;throw error}}
  // 1. Positive: two Ikeda portal keys on one card-only grant, idempotent, read back (also under a renewed grant); the PayPay, 楽天銀行
  // and Amex keys of the same grant next to them are unchanged.
  const keys=[ik(I),ik(I2)]
  for(const k of keys){await service.putKey(token,grant,k);await service.putKey(token,grant,k)}
  for(const k of keys)assert.equal((await service.getKey(token,grant,k.keyId)).wrapped,k.wrapped,'ikeda:read-after-write')
  const renewed=await grantFor();for(const k of keys)assert.equal((await service.getKey(token,renewed,k.keyId)).aad.accountId,k.aad.accountId,'ikeda:renewed-grant-read')
  const others=[record('paypay',String(paypay._id),'paypay-'+String(paypay._id)),record('rakuten',String(rakuten._id),'rakuten-'+String(rakuten._id)),record('amex',String(card._id),'amex-'+String(card._id))]
  for(const r of others){await service.putKey(token,grant,r);assert.equal((await service.getKey(token,grant,r.keyId)).wrapped,r.wrapped,'ikeda:other-key-unchanged '+r.entryId)}
  pass('ikeda key: two 池田泉州銀行 ビジネスゲート accounts granted to one device after its card-only pairing each seal, re-register idempotently and read back their own password-only key (also under a renewed grant); the PayPay, 楽天銀行 and Amex keys of the same grant are unchanged')
  // 2. Attacks: `opens` names the binding line whose removal lets the attack through; every other attack stays refused by another line.
  const ATTACKS:Record<string,{opens:string[],run:(svc:any)=>Promise<any>}>={
    'ikeda-entry-other-account':{opens:['bank-entry'],run:svc=>svc.putKey(token,grant,ik(I,'ikeda-'+String(I2._id)))},
    'ikeda-entry-as-paypay':{opens:['bank-entry'],run:svc=>svc.putKey(token,grant,ik(I,'paypay-'+String(I._id)))},
    'ikeda-outside-scope':{opens:['bank-scope'],run:svc=>svc.putKey(token,grant,ik(outside))},
    'ikeda-direct-variant':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,ik(direct))},
    'ikeda-no-login-type':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,ik(plain))},
    'ikeda-on-paypay-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,ik(paypay))},
    'ikeda-on-rakuten-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,ik(rakuten))},
    'paypay-on-ikeda-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,record('paypay',String(I._id),'paypay-'+String(I._id)))},
    'rakuten-on-ikeda-account':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,record('rakuten',String(I._id),'rakuten-'+String(I._id)))},
    'ikeda-other-owner':{opens:['bank-live'],run:svc=>svc.putKey(token,grant,ik(foreign))},
    'ikeda-as-card':{opens:[],run:svc=>svc.putKey(token,grant,record('amex',String(I._id),'amex-'+String(I._id)))},
    'ikeda-as-service':{opens:[],run:svc=>svc.putKey(token,grant,record('ikeda','ikeda','ikeda'))},
    'ikeda-malformed-id':{opens:[],run:svc=>svc.putKey(token,grant,record('ikeda','x','ikeda-x'))},
    'ikeda-aad-owner':{opens:[],run:svc=>svc.putKey(token,grant,ik(I,undefined,{ownerId:String(other._id)}))},
    'ikeda-aad-keyid':{opens:[],run:svc=>{const r=ik(I);return svc.putKey(token,grant,{...r,keyId:randomBytes(32).toString('hex')})}},
    'ikeda-poll-token-as-grant':{opens:[],run:svc=>svc.putKey(token,token.slice(5),ik(I))},
    'ikeda-other-device':{opens:[],run:svc=>svc.getKey('omfc_'+'7'.repeat(64),grant,keys[0].keyId)}
  }
  for(const [name,attack] of Object.entries(ATTACKS))assert.equal(await refused(attack.run(service)),true,'the real service accepted the Ikeda attack '+name)
  pass('ikeda key attacks refused: another account\'s or a PayPay-named entry, an account outside the device scope, the インターネットEB direct variant or no login type, an Ikeda AAD on a PayPay or 楽天銀行 account and their AADs on an Ikeda account, another owner\'s account, Ikeda as a card or service entry, malformed id, owner/key-id mismatch, poll token as grant, another device')
  // 3. Changes after the save stop that account's release only; restoring them releases it again.
  const release=(i=0)=>service.getKey(token,grant,keys[i].keyId)
  await scope(SCOPE.filter(id=>String(id)!==String(I._id)));assert.equal(await refused(release(0)),true,'ikeda:removed-scope');assert.equal((await release(1)).wrapped,keys[1].wrapped,'ikeda:other-account-unaffected');await scope(SCOPE)
  for(const change of [{'connection.provider':'paypay'},{'connection.provider':'resona'},{'connection.variant':'direct'},{'connection.variant':null},{connection:null}]){const saved:any=await BankAccount.findById(I._id).lean();await BankAccount.updateOne({_id:I._id},{$set:change});assert.equal(await refused(release(0)),true,'ikeda:changed-connection '+JSON.stringify(change));assert.equal((await release(1)).wrapped,keys[1].wrapped,'ikeda:other-account-unaffected');await BankAccount.updateOne({_id:I._id},{$set:{connection:saved.connection}})}
  await models.CollectorGrant.updateOne({_id:digest(grant)},{$set:{revokedAt:new Date()}});for(const i of [0,1])assert.equal(await refused(release(i)),true,'ikeda:revoked-grant');await models.CollectorGrant.updateOne({_id:digest(grant)},{$unset:{revokedAt:1}})
  await FinanceCollector.updateOne({_id:device._id},{$set:{revokedAt:new Date()}});assert.equal(await refused(release(1)),true,'ikeda:revoked-device');await FinanceCollector.updateOne({_id:device._id},{$unset:{revokedAt:1}})
  for(const i of [0,1])assert.equal((await release(i)).wrapped,keys[i].wrapped,'ikeda:restored-release')
  pass('after the save, a removed scope, a provider change (PayPay銀行/りそな銀行), the direct/no login type and a cleared connection each stop that Ikeda account\'s release while the other keeps its own; a revoked grant or device stops both; restoring releases again')
  // 4. Races between the first binding check and the end of the key I/O (the second device read), per operation.
  const findOne=FinanceCollector.findOne.bind(FinanceCollector)
  const raced=async(attempt:()=>Promise<any>,change:()=>Promise<any>,undo:()=>Promise<any>)=>{let reads=0,fired=false;(FinanceCollector as any).findOne=(...args:any[])=>{const q:any=(findOne as any)(...args);if(++reads===2&&!fired){fired=true;const lean=q.lean.bind(q);q.lean=async(...l:any[])=>{await change();return lean(...l)}}return q};try{const result=await refused(attempt());assert.equal(fired,true,'the race hook fired (second device read)');return result}finally{(FinanceCollector as any).findOne=findOne;await undo()}}
  const without0=()=>scope(SCOPE.filter(id=>String(id)!==String(I._id))),restore=()=>scope(SCOPE)
  const RACES:Record<string,{guard:string,recheck:string,run:(svc:any)=>Promise<boolean>}>={
    'ikeda-get-scope':{guard:'bank-scope',recheck:'bank-recheck-get',run:svc=>raced(()=>svc.getKey(token,grant,keys[0].keyId),without0,restore)},
    'ikeda-get-variant':{guard:'bank-live',recheck:'bank-recheck-get',run:svc=>raced(()=>svc.getKey(token,grant,keys[0].keyId),()=>BankAccount.updateOne({_id:I._id},{$set:{'connection.variant':'direct'}}),()=>BankAccount.updateOne({_id:I._id},{$set:{'connection.variant':'portal'}}))},
    'ikeda-put-scope':{guard:'bank-scope',recheck:'bank-recheck-put',run:svc=>raced(()=>svc.putKey(token,grant,ik(I)),without0,restore)}
  }
  for(const [name,race] of Object.entries(RACES))assert.equal(await race.run(service),true,'the real service released an Ikeda key across the race '+name)
  pass('an Ikeda scope removal or a change to the インターネットEB direct variant between the first binding check and the end of the key I/O is caught by the post-I/O recheck (get and put)')
  // 5. Each bank binding line removed in turn: exactly the attacks it opens get through; every other attack and race outcome holds.
  for(const marker of BANK_BINDINGS)await withMutant(SECURITY_SERVICE,marker,async m=>{
    for(const [name,attack] of Object.entries(ATTACKS)){const open=attack.opens.includes(marker);assert.equal(await refused(attack.run(m)),!open,`ikeda mutant ${marker}: the attack ${name} was ${open?'still refused':'accepted'}`)}
    for(const [name,race] of Object.entries(RACES)){const open=marker===race.recheck||marker===race.guard;assert.equal(await race.run(m),!open,`ikeda mutant ${marker}: the race ${name} was ${open?'still refused':'accepted'}`)}
    for(const i of [0,1])assert.equal((await m.getKey(token,grant,keys[i].keyId)).wrapped,keys[i].wrapped,`ikeda mutant ${marker}: the legitimate Ikeda key ${i}`)
  })
  pass('each of the '+BANK_BINDINGS.length+' bank binding mutants lets through exactly the Ikeda attacks and races its line guards (bank-entry: entry names; bank-scope: the device scope; bank-live: provider, login type and owner) and still refuses every other attack')
}

async function main() {
  const service = await import('../server/services/financeCollectorSecurityService')
  const models = await import('../server/models/FinanceCollectorSecurity')
  const mongo = await MongoMemoryServer.create({instance:{dbName:'collector_security_isolated'}})
  // The connect legs audit through server/utils/audit.ts → ensureConnection(), which (re)opens process.env.MONGO_URI.
  // Point it at this script's own ephemeral server so that call is a same-URI no-op, never a reach for any other database.
  process.env.MONGO_URI = mongo.getUri('collector_security_isolated')
  // authService refuses to load without a JWT secret; a synthetic one is enough (no session is ever issued here).
  process.env.JWT_SECRET ||= randomBytes(32).toString('hex')
  let checks = 0
  const pass = (name: string) => { checks++; console.log('PASS '+name) }
  const digest = (v: string) => createHash('sha256').update(v).digest('hex')
  const origin = 'https://omf.example.invalid'
  try {
    await mongoose.connect(mongo.getUri('collector_security_isolated'))
    assert.equal(mongoose.connection.name,'collector_security_isolated')
    await service.initializeSecurity()
    const password='Synthetic-only-Strong-Password1!'
    const secret=generateSecret()
    const user:any=await User.create({email:'collector-test@example.invalid',name:'Synthetic collector test',password,twoFactorEnabled:true,twoFactorSecret:secret,twoFactorBackupCodes:await hashBackupCodes(['AABB1122','CCDD3344'])})
    const other:any=await User.create({email:'other-collector@example.invalid',name:'Other',password})
    const account:any=await FinancialAccount.create({ownerId:user._id,provider:'amex',name:'Synthetic card',cardIdentifiers:['12345'],primaryCard:'12345',otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})
    const token='omfc_'+randomBytes(32).toString('hex')
    const device:any=await FinanceCollector.create({ownerId:user._id,name:'Synthetic PC',tokenHash:digest(token),accountIds:[account._id]})
    const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const installationId=randomBytes(16).toString('hex'), generation=randomBytes(32).toString('hex')
    const verifier=randomBytes(32).toString('base64url'), state=randomBytes(32).toString('hex')
    const trustToken=randomBytes(32).toString('hex')
    const input={action:'enroll',installationId,generation,publicKey:pair.publicKey,trustHash:digest(trustToken),codeChallenge:createHash('sha256').update(verifier).digest('base64url'),state,redirectUri:'http://127.0.0.1:49123/collector-callback'}
    const request=await service.createRequest(token,input,origin)
    await assert.rejects(service.readRequest(String(other._id),request.id))
    await assert.rejects(service.approveRequest(String(user._id),request.id,{password:'wrong',code:generateSync({secret})}))
    await assert.rejects(service.approveRequest(String(user._id),request.id,{password,code:''}))
    const approved=await service.approveRequest(String(user._id),request.id,{password,code:generateSync({secret})})
    await assert.rejects(service.approveRequest(String(user._id),request.id,{password,code:generateSync({secret})}))
    const code=new URL(approved.redirectUri).searchParams.get('code')!
    await assert.rejects(service.exchangeRequest(token,request.id,code,'a'.repeat(43)))
    const exchanged=await Promise.allSettled([1,2].map(()=>service.exchangeRequest(token,request.id,code,verifier)))
    assert.equal(exchanged.filter(x=>x.status==='fulfilled').length,1)
    const batch:any=(exchanged.find(x=>x.status==='fulfilled') as any).value
    pass('fresh password and enabled MFA required; wrong owner, code replay and PKCE interception rejected; one exchange wins')

    const resume={installationId,generation,trustToken}
    await assert.rejects(service.resumeSession(token,{...resume,trustToken:'f'.repeat(64)},origin))
    await assert.rejects(service.resumeSession(token,resume,'https://other.example.invalid'))
    const unattended=await service.resumeSession(token,resume,origin)
    assert.ok(unattended.grant)
    await mongoose.disconnect();await mongoose.connect(mongo.getUri('collector_security_isolated'))
    const restarted=await service.resumeSession(token,resume,origin)
    assert.ok(restarted.grant)
    assert.notEqual(restarted.grant,unattended.grant)
    const installed=await models.CollectorInstallation.findById(installationId).select('+trustHash +authStamp').lean()
    assert.equal((installed as any).trustHash,digest(trustToken))
    assert.equal(JSON.stringify(installed).includes(trustToken),false)
    pass('remembered PC resumes without password after reconnect; wrong device secret/origin rejected; only digest stored')

    const {sealEnvelope,openEnvelope}=await import('../collector/vault.mjs')
    const keyId=randomBytes(32).toString('hex')
    const aad={v:3,installationId,origin,ownerId:String(user._id),provider:'amex',accountId:String(account._id),generation,keyId}
    const value={username:'synthetic',password:randomBytes(32).toString('hex')}
    const envelope=sealEnvelope(pair.publicKey,aad,value)
    const record={keyId,entryId:'amex-'+account._id,aad,wrapped:envelope.wrapped}
    await assert.rejects(service.putKey(token,token,record))
    await service.putKey(token,batch.grant,record)
    await service.putKey(token,batch.grant,record)
    await assert.rejects(service.putKey(token,batch.grant,{...record,wrapped:Buffer.alloc(256,1).toString('base64')}))
    const fetched=await service.getKey(token,batch.grant,keyId)
    const dataKey=privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(fetched.wrapped,'base64'))
    assert.deepEqual(openEnvelope(envelope,dataKey,aad),value);dataKey.fill(0)
    pass('real product crypto through database key custody; poll token cannot release; immutable idempotent key registration')
    await assert.rejects(service.putKey(token,batch.grant,{...record,keyId:randomBytes(32).toString('hex'),aad:{...aad,origin:'https://other.example.invalid'}}))
    await FinancialAccount.updateOne({_id:account._id},{$set:{active:false}})
    await assert.rejects(service.getKey(token,batch.grant,keyId))
    await FinancialAccount.updateOne({_id:account._id},{$set:{active:true}})
    await FinanceCollector.updateOne({_id:device._id},{$set:{revokedAt:new Date()}})
    await assert.rejects(service.getKey(token,batch.grant,keyId))
    await assert.rejects(service.resumeSession(token,resume,origin))
    await FinanceCollector.updateOne({_id:device._id},{$unset:{revokedAt:1}})
    await User.updateOne({_id:user._id},{$set:{isActive:false}})
    await assert.rejects(service.getKey(token,batch.grant,keyId))
    await User.updateOne({_id:user._id},{$set:{isActive:true}})
    pass('origin, current account activation, collector revocation and active owner enforced at release')
    await mongoose.disconnect();await mongoose.connect(mongo.getUri('collector_security_isolated'))
    assert.equal((await service.getKey(token,batch.grant,keyId)).wrapped,record.wrapped)
    await assert.rejects(service.exchangeRequest(token,request.id,code,verifier))
    pass('key records and consumed approval survive database reconnect')
    const view=await models.CollectorWrappedKey.findOne({keyId}).lean()
    assert.equal(JSON.stringify(view).includes(value.password),false)
    assert.equal(JSON.stringify(view).includes(pair.privateKey),false)
    await service.endGrant(token,batch.grant)
    await assert.rejects(service.getKey(token,batch.grant,keyId))
    pass('server stores no synthetic password/private key; explicit grant end prevents further release')
    // Separate recovery scenarios use a fresh attempt window in this owned database.
    await models.CollectorThrottle.deleteMany({})
    const authorize=async(candidate:any,selectedToken=token,otpCode=generateSync({secret}))=>{
      const q=await service.createRequest(selectedToken,{...input,...candidate},origin)
      const yes=await service.approveRequest(String(user._id),q.id,{password,code:otpCode})
      return service.exchangeRequest(selectedToken,q.id,new URL(yes.redirectUri).searchParams.get('code')!,verifier)
    }
    const again=await authorize({action:'batch'})
    await models.CollectorGrant.updateOne({_id:digest(again.grant!)},{$set:{expiresAt:new Date(0)}})
    await assert.rejects(service.getKey(token,again.grant!,keyId))
    pass('explicit expiry enforced before Mongo TTL cleanup')
    const beforeReset=await authorize({action:'batch'},token,'AABB1122')
    await assert.rejects(authorize({action:'batch'},token,'AABB1122'))
    pass('backup code is consumed once across separate collector approvals')
    await models.CollectorThrottle.deleteMany({})
    const secondPair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const nextGeneration=randomBytes(32).toString('hex')
    const reset=await authorize({action:'reset',generation:nextGeneration,previousGeneration:generation,publicKey:secondPair.publicKey})
    assert.equal(reset.grant,null)
    await assert.rejects(service.getKey(token,beforeReset.grant!,keyId))
    // Retry after a lost response: no old key or Windows authentication is required.
    const resetRetry=await authorize({action:'reset',generation:nextGeneration,previousGeneration:nextGeneration,publicKey:secondPair.publicKey})
    assert.equal(resetRetry.grant,null)
    const afterReset=await authorize({action:'batch',generation:nextGeneration,publicKey:secondPair.publicKey})
    await assert.rejects(service.getKey(token,afterReset.grant!,keyId))
    pass('reset/retry is purpose-limited; old generation remains inaccessible')
    await models.CollectorThrottle.deleteMany({})
    const nextToken='omfc_'+randomBytes(32).toString('hex')
    await FinanceCollector.create({ownerId:user._id,name:'Replacement token',tokenHash:digest(nextToken),accountIds:[account._id]})
    await assert.rejects(authorize({action:'batch',generation:nextGeneration,publicKey:secondPair.publicKey},nextToken))
    const paired=await authorize({action:'pair',generation:nextGeneration,publicKey:secondPair.publicKey},nextToken)
    assert.equal(paired.grant,null)
    await assert.rejects(service.getKey(token,afterReset.grant!,keyId))
    const replacement=await authorize({action:'batch',generation:nextGeneration,publicKey:secondPair.publicKey},nextToken)
    assert.ok(replacement.grant)
    pass('same-owner token replacement requires fresh purpose-bound approval and retires old access')
    await User.updateOne({_id:user._id},{$set:{twoFactorSecret:generateSecret()}})
    await assert.rejects(service.putKey(nextToken,replacement.grant!,record))
    await assert.rejects(service.resumeSession(nextToken,{...resume,generation:nextGeneration},origin))
    pass('changing MFA invalidates outstanding collector grants')
    await models.CollectorThrottle.deleteMany({})
    const fresh=await service.createRequest(nextToken,{...input,action:'batch',generation:nextGeneration,publicKey:secondPair.publicKey},origin)
    for(let i=0;i<5;i++)await assert.rejects(service.approveRequest(String(user._id),fresh.id,{password:'wrong',code:''}))
    await mongoose.disconnect();await mongoose.connect(mongo.getUri('collector_security_isolated'))
    await assert.rejects(service.approveRequest(String(user._id),fresh.id,{password,code:''}),(error:any)=>error.statusCode===429)
    pass('authentication attempt limit survives database reconnect')
    // The legacy legs rotated the MFA secret and spent one backup code; restore the known secret for the connect legs.
    await User.updateOne({_id:user._id},{$set:{twoFactorSecret:secret,loginAttempts:0},$unset:{lockoutUntil:1}})
    await connectLegs({pass,digest,origin,user,other,account,password,secret,legacyToken:token,service,models})
    await securityBindingLegs({pass,digest,origin,user,service,models})
    await bankBindingLegs({pass,digest,origin,user,other,service,models})
    await paypayBindingLegs({pass,digest,origin,user,other,service,models})
    await ikedaBindingLegs({pass,digest,origin,user,other,service,models})
    console.log(JSON.stringify({pass:true,checks,bankCalls:0,productionWrites:0,connectMutants:BINDINGS.length,securityMutants:SECURITY_BINDINGS.length,bankMutants:BANK_BINDINGS.length,paypayMutants:BANK_BINDINGS.length,ikedaMutants:BANK_BINDINGS.length}))
  } finally {await mongoose.disconnect();await mongo.stop()}
}
// authService's import starts the token-blacklist cleanup interval, which would keep this child alive after the receipt.
main().then(()=>0,error=>{console.error(error);return 1}).then(code=>{process.stdout.write('',()=>process.exit(code))})

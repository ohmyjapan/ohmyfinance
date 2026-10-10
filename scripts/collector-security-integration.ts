// Owned, ephemeral Mongo only; no app environment file, bank service or real user.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, privateDecrypt, constants } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { generateSync } from 'otplib'
import User from '../server/models/User'
import { FinanceCollector, FinancialAccount } from '../server/models/Finance'
import { generateSecret, hashBackupCodes } from '../server/services/twoFactorService'

async function main() {
  const service = await import('../server/services/financeCollectorSecurityService')
  const models = await import('../server/models/FinanceCollectorSecurity')
  const mongo = await MongoMemoryServer.create({instance:{dbName:'collector_security_isolated'}})
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
    console.log(JSON.stringify({pass:true,checks,bankCalls:0,productionWrites:0}))
  } finally {await mongoose.disconnect();await mongo.stop()}
}
main().catch(error=>{console.error(error);process.exitCode=1})

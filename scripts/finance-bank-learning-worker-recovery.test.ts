import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import {MongoMemoryServer} from 'mongodb-memory-server'
import {LEARNING_MODEL,LEARNING_RUNTIME,LEARNING_ROLES} from '../shared/finance-bank-learning.mjs'

test('persisted worker recovery: bounded claims and a globally busy developer',async t=>{
 process.env.NODE_ENV='test'
 process.env.JWT_SECRET='synthetic-recovery-test-signing-secret-not-a-real-key-20261109'
 const mongo=await MongoMemoryServer.create();process.env.MONGO_URI=mongo.getUri('learning_recovery_synthetic')
 try{
  const service=await import(process.env.OMF_LEARNING_TEST_SERVICE||'../server/services/financeBankLearningService')
  const {default:Learning}=await import('../server/models/FinanceBankLearning')
  const {BankAccount,BankTemplate}=await import('../server/models/FinancePaymentMatch')
  const {FinanceCollector}=await import('../server/models/Finance')
  const {CollectorInstallation}=await import('../server/models/FinanceCollectorSecurity')
  const {default:Organization}=await import('../server/models/Organization')
  const {ready}=await import('../server/services/financeService');await ready()
  async function tenant(label:string){
   const owner=new mongoose.Types.ObjectId().toString(),company=new mongoose.Types.ObjectId()
   await Organization.collection.insertOne({_id:company,slug:'recovery-'+label,isActive:true,members:[{userId:new mongoose.Types.ObjectId(owner),role:'admin'}]})
   const template=await BankTemplate.create({ownerId:owner,name:'Recovery CSV '+label,headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'})
   const device=await FinanceCollector.create({ownerId:owner,name:'Recovery PC '+label,tokenHash:(label==='a'?'a':'b').repeat(64),bankAccountIds:[],accountIds:[]})
   const installation=await CollectorInstallation.create({_id:'recovery-pc-'+label,ownerId:owner,collectorId:device._id,generation:'recovery-generation',publicKey:'synthetic',fingerprint:'synthetic',origin:'https://omf.example.invalid'})
   return {owner,company,template,context:{device:device.toObject(),installation:installation.toObject(),grant:{origin:installation.origin}}}
  }
  const a=await tenant('a'),b=await tenant('b');let sequence=0
  const evidence={schema:1,runtime:LEARNING_RUNTIME,origins:['https://bank.example.invalid'],events:LEARNING_ROLES.map((role,i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin:'https://bank.example.invalid',role,tag:['from','to'].includes(role)?'input':'text'})),complete:true,truncated:false}
  async function queued(client=a){
   const account=await BankAccount.create({ownerId:client.owner,name:'Worker recovery bank '+(++sequence),connection:{provider:'resona',variant:'direct'}})
   await FinanceCollector.updateOne({_id:client.context.device._id},{$addToSet:{bankAccountIds:account._id}});client.context.device.bankAccountIds.push(account._id)
   const {session}=await service.learningCreate(client.owner,client.company,{bankAccountId:String(account._id),installationId:client.context.installation._id,templateId:String(client.template._id),entryOrigin:evidence.origins[0],period:{from:'2026-10-01',to:'2026-10-02'},companyAccountConfirmed:true})
   const pc=await service.learningPcAction(client.context,session.id,'start',{})
   await service.learningPcAction(client.context,session.id,'evidence',{claim:pc.claim,evidence});await service.learningPcAction(client.context,session.id,'finish',{claim:pc.claim})
   return session.id
  }
  const row=(key:string)=>Learning.findById(key).lean()
  const expire=(key:string)=>Learning.updateOne({_id:key},{$set:{leaseUntil:new Date(0)}})
  const valid=(job:any)=>({model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:job.evidenceHash,candidate:{schema:1,runtime:LEARNING_RUNTIME,evidenceHash:job.evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))},tests:['schema','provenance']})
  async function scenario(name:string,fn:()=>Promise<void>){await t.test(name,async()=>{try{await fn()}finally{await Learning.deleteMany({})}})}

  await scenario('F5: rejected results cannot reclaim forever; explicit retry retains evidence and resets the cap',async()=>{
   const key=await queued(),initial=await row(key);let last:any
   for(let attempt=1;attempt<=3;attempt++){
    const replies=await Promise.all([service.learningWorkerClaim(),service.learningWorkerClaim()]),jobs=replies.flatMap(r=>r.job?[r.job]:[])
    assert.equal(jobs.length,1,'one lease owner even under concurrent claims');const job=last=jobs[0];assert.equal(job.id,key)
    assert.equal((await row(key))?.attempts,attempt)
    await assert.rejects(service.learningWorkerAction(key,'result',{epoch:job.epoch,claim:job.claim,result:{...valid(job),model:'rejected-model'}}),/worker-result-binding-mismatch/)
    assert.equal((await row(key))?.state,'developing');assert.equal((await service.learningWorkerClaim()).job,null,'a live lease is not retried')
    await expire(key)
   }
   assert.equal((await service.learningWorkerClaim()).job,null,'the fourth claim must not run another generation')
   const exhausted=await row(key);assert.equal(exhausted?.state,'failed');assert.equal(exhausted?.attempts,3);assert.equal(exhausted?.lastCode,'worker_failed');assert.deepEqual(exhausted?.missing,['worker_unavailable'])
   await assert.rejects(service.learningWorkerAction(key,'result',{epoch:last.epoch,claim:last.claim,result:valid(last)}))
   await service.learningOwnerAction(a.owner,a.company,key,'retry-development',{})
   const reset=await row(key);assert.equal(reset?.attempts,0);assert.equal(reset?.state,'queued');assert.equal(reset?.evidenceHash,initial?.evidenceHash);assert.deepEqual(reset?.evidence,initial?.evidence);assert.ok(reset?.queuedAt)
   const retried=(await service.learningWorkerClaim()).job;assert.equal(retried.id,key);assert.ok(retried.epoch>last.epoch);assert.equal((await row(key))?.attempts,1)
   await assert.rejects(service.learningWorkerAction(key,'result',{epoch:last.epoch,claim:last.claim,result:valid(last)}),'old epochs remain fenced after owner retry')
   await service.learningWorkerAction(key,'result',{epoch:retried.epoch,claim:retried.claim,result:valid(retried)});assert.equal((await row(key))?.state,'candidate')
  })
  await scenario('F5: a live third lease can heartbeat and finish, and exhausted rows do not starve later jobs',async()=>{
   const key=await queued();await Learning.updateOne({_id:key},{$set:{attempts:2}})
   const third=(await service.learningWorkerClaim()).job;assert.equal((await row(key))?.attempts,3)
   assert.equal((await service.learningWorkerClaim()).job,null);assert.equal((await row(key))?.state,'developing')
   await service.learningWorkerAction(key,'heartbeat',{epoch:third.epoch,claim:third.claim})
   await service.learningWorkerAction(key,'result',{epoch:third.epoch,claim:third.claim,result:valid(third)});assert.equal((await row(key))?.state,'candidate')
   const exhausted=await queued(),next=await queued();await Learning.updateOne({_id:exhausted},{$set:{state:'developing',attempts:3,leaseUntil:new Date(0)}})
   const claims=await Promise.all([service.learningWorkerClaim(),service.learningWorkerClaim()]);assert.deepEqual(claims.flatMap(r=>r.job?[r.job.id]:[]),[next]);assert.equal((await row(exhausted))?.state,'failed')
  })
  await scenario('F5: legacy rows without attempts can still claim their first lease',async()=>{
   const key=await queued();await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(key)},{$unset:{attempts:''}})
   assert.equal((await service.learningWorkerClaim()).job?.id,key);assert.equal((await row(key))?.attempts,1)
  })
  await scenario('F6: owner and PC reads preserve an old queue behind another owner/PC live worker, then fail after expiry',async()=>{
   const busy=await queued(b),active=(await service.learningWorkerClaim()).job;assert.equal(active.id,busy)
   const key=await queued(a),old=new Date(Date.now()-16*60000)
   await Learning.updateOne({_id:key},{$set:{queuedAt:old}})
   await service.learningList(a.owner,a.company);assert.equal((await row(key))?.state,'queued','foreign live development counts as shared worker presence')
   await service.learningPcList(a.context);assert.equal((await row(key))?.state,'queued','PC polling uses the same busy-worker exit')
   await service.learningWorkerAction(busy,'heartbeat',{epoch:active.epoch,claim:active.claim});await service.learningList(a.owner,a.company);assert.equal((await row(key))?.state,'queued')
   await expire(busy);await service.learningPcList(a.context)
   const failed=await row(key);assert.equal(failed?.state,'failed');assert.equal(failed?.lastCode,'worker_failed');assert.deepEqual(failed?.missing,['worker_unavailable']);assert.equal((await row(busy))?.state,'developing','one PC read does not rewrite another owner\'s row')
   await service.learningOwnerAction(a.owner,a.company,key,'retry-development',{});await service.learningList(a.owner,a.company);assert.equal((await row(key))?.state,'queued')
  })
  await scenario('F7: successful completion protects the foreign-owner handoff through both polls and the next claim',async()=>{
   const busy=await queued(b),job=(await service.learningWorkerClaim()).job;assert.equal(job.id,busy)
   const waiting=await queued(a),old=new Date(Date.now()-16*60000);await Learning.updateOne({_id:waiting},{$set:{queuedAt:old}})
   const result=valid(job);await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result})
   const completed=await row(busy);assert.equal(completed?.state,'candidate');assert.equal(new Date(completed.leaseUntil).getTime(),0)
   // Simulate a delayed duplicate ACK. A duplicate must not fabricate fresh worker activity.
   const delivered=new Date(Date.now()-60000);await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(busy)},{$set:{'workerReceipt.at':delivered}})
   await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result});assert.equal(new Date((await row(busy)).workerReceipt.at).getTime(),delivered.getTime())
   const visible=await service.learningList(a.owner,a.company);assert.ok(!visible.sessions.some(s=>s.id===busy),'worker presence must not expose another owner\'s session')
   assert.equal((await row(waiting))?.state,'queued','recent result protects the completed-job handoff')
   await service.learningPcList(a.context);assert.equal((await row(waiting))?.state,'queued','PC poll preserves the same completion handoff');assert.equal(new Date((await row(waiting)).queuedAt).getTime(),old.getTime(),'preserve the actual waiting age')
   const next=(await service.learningWorkerClaim()).job;assert.equal(next?.id,waiting,'waiting work proceeds without a manual retry');assert.equal((await row(waiting))?.attempts,1)
   await service.learningWorkerAction(waiting,'result',{epoch:next.epoch,claim:next.claim,result:valid(next)});assert.equal((await row(waiting))?.state,'candidate')
  })
  await scenario('F7: delivered failure and missing-step results also permit the next job handoff',async()=>{
   for(const missing of [['worker_unavailable'],['balance']]){
    await Learning.deleteMany({});const busy=await queued(b),job=(await service.learningWorkerClaim()).job,waiting=await queued(a)
    await Learning.updateOne({_id:waiting},{$set:{queuedAt:new Date(Date.now()-16*60000)}})
    await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result:{model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:job.evidenceHash,missing,tests:[]}})
    assert.equal((await row(busy))?.state,missing[0]==='worker_unavailable'?'failed':'needs_demonstration')
    await Promise.all([service.learningList(a.owner,a.company),service.learningPcList(a.context)]);assert.equal((await row(waiting))?.state,'queued','any delivered result proves recent worker activity')
    assert.equal((await service.learningWorkerClaim()).job?.id,waiting)
   }
  })
  await scenario('F7: recent-result grace ends after one lease and cannot hide an unavailable worker',async()=>{
   const busy=await queued(b),job=(await service.learningWorkerClaim()).job,waiting=await queued(a)
   await Learning.updateOne({_id:waiting},{$set:{queuedAt:new Date(Date.now()-16*60000)}})
   await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result:valid(job)})
   await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(busy)},{$set:{'workerReceipt.at':new Date(Date.now()-60000)}})
   await Promise.all([service.learningList(a.owner,a.company),service.learningPcList(a.context)]);assert.equal((await row(waiting))?.state,'queued','a result within one lease protects the queue')
   await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(busy)},{$set:{'workerReceipt.at':new Date(Date.now()-181000)}})
   await service.learningPcList(a.context);const absent=await row(waiting);assert.equal(absent?.state,'failed','stale results must not suppress unavailable-worker failure');assert.equal(absent?.lastCode,'worker_failed');assert.deepEqual(absent?.missing,['worker_unavailable'])
   await service.learningOwnerAction(a.owner,a.company,waiting,'retry-development',{});assert.equal((await row(waiting))?.state,'queued')
  })
  await scenario('F8: immediate retry retains worker presence without acknowledging an old result in a new epoch',async()=>{
   const busy=await queued(b),job=(await service.learningWorkerClaim()).job,waiting=await queued(a)
   await Learning.updateOne({_id:waiting},{$set:{queuedAt:new Date(Date.now()-16*60000)}})
   const failure={model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:job.evidenceHash,missing:['worker_unavailable'],tests:[]}
   await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result:failure});assert.equal((await row(busy))?.state,'failed')
   await service.learningOwnerAction(b.owner,b.company,busy,'retry-development',{})
   await Promise.all([service.learningList(a.owner,a.company),service.learningPcList(a.context)]);assert.equal((await row(waiting))?.state,'queued','immediate retry must not erase recent worker presence')
   await assert.rejects(service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result:failure}),'an old result must not acknowledge a manually queued retry')
   const retry=(await service.learningWorkerClaim()).job;assert.equal(retry.id,busy);assert.ok(retry.epoch>job.epoch)
   await service.learningWorkerAction(busy,'result',{epoch:retry.epoch,claim:retry.claim,result:failure});assert.equal((await row(busy))?.state,'failed','an identical failure payload in a new epoch must actually finish the new job')
   await Promise.all([service.learningList(a.owner,a.company),service.learningPcList(a.context)]);assert.equal((await row(waiting))?.state,'queued')
   const next=(await service.learningWorkerClaim()).job;assert.equal(next?.id,waiting,'other waiting work still reaches the worker after the retry fails')
   await service.learningWorkerAction(waiting,'result',{epoch:next.epoch,claim:next.claim,result:valid(next)});assert.equal((await row(waiting))?.state,'candidate')
  })
  await scenario('F8: a human retry cannot freshen stale worker activity',async()=>{
   const busy=await queued(b),job=(await service.learningWorkerClaim()).job,waiting=await queued(a)
   await Learning.updateOne({_id:waiting},{$set:{queuedAt:new Date(Date.now()-16*60000)}})
   await service.learningWorkerAction(busy,'result',{epoch:job.epoch,claim:job.claim,result:{model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:job.evidenceHash,missing:['worker_unavailable'],tests:[]}})
   await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(busy)},{$set:{'workerReceipt.at':new Date(Date.now()-181000)}})
   await service.learningOwnerAction(b.owner,b.company,busy,'retry-development',{});await service.learningPcList(a.context)
   const absent=await row(waiting);assert.equal(absent?.state,'failed','a human retry must not manufacture fresh worker presence');assert.equal(absent?.lastCode,'worker_failed');assert.deepEqual(absent?.missing,['worker_unavailable'])
  })
 }finally{await mongoose.disconnect();await mongo.stop()}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import {MongoMemoryServer} from 'mongodb-memory-server'
import {createHash} from 'node:crypto'
import {LEARNING_RUNTIME,LEARNING_MODEL,LEARNING_ROLES,LEARNING_STATEMENT_CAPABILITY,stable} from '../shared/finance-bank-learning.mjs'
test('native persisted learning lifecycle: ownership, generation, fenced leases, duplicate receipts, fresh replay and recovery',async t=>{
 process.env.NODE_ENV='test'
 process.env.JWT_SECRET='synthetic-learning-test-signing-secret-not-a-real-key-20261108'
 const mongo=await MongoMemoryServer.create();process.env.MONGO_URI=mongo.getUri('learning_synthetic')
 try{
  const service=await import(process.env.OMF_LEARNING_TEST_SERVICE||'../server/services/financeBankLearningService')
  const {default:Learning}=await import('../server/models/FinanceBankLearning')
  const {BankAccount,BankTemplate,BankJob}=await import('../server/models/FinancePaymentMatch')
  const {claimBankJob,queueBankSync}=await import(process.env.OMF_LEARNING_TEST_CLAIM_SERVICE||'../server/services/financeBankCollectionService')
  const {FinanceCollector}=await import('../server/models/Finance')
  const {CollectorInstallation}=await import('../server/models/FinanceCollectorSecurity')
  const {default:Organization}=await import('../server/models/Organization')
  const {ready}=await import('../server/services/financeService');await ready()
  const owner=new mongoose.Types.ObjectId().toString(),foreign=new mongoose.Types.ObjectId().toString(),company=new mongoose.Types.ObjectId(),otherCompany=new mongoose.Types.ObjectId()
  await Organization.collection.insertMany([{_id:company,slug:'synthetic-company',isActive:true,members:[{userId:new mongoose.Types.ObjectId(owner),role:'admin'}]},{_id:otherCompany,slug:'synthetic-other',isActive:true,members:[{userId:new mongoose.Types.ObjectId(foreign),role:'admin'}]}])
  const account=await BankAccount.create({ownerId:owner,name:'Synthetic bank',connection:{provider:'resona',variant:'direct'}})
  const template=await BankTemplate.create({ownerId:owner,name:'Synthetic CSV',headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'})
  const device=await FinanceCollector.create({ownerId:owner,name:'Synthetic PC',tokenHash:'0'.repeat(64),bankAccountIds:[account._id],accountIds:[]})
  const installation=await CollectorInstallation.create({_id:'pc-synthetic',ownerId:owner,collectorId:device._id,generation:'generation-one',publicKey:'synthetic',fingerprint:'synthetic',origin:'https://omf.example.invalid'})
  const context={device:device.toObject(),installation:installation.toObject(),grant:{origin:installation.origin}}
  const input={bankAccountId:String(account._id),installationId:installation._id,templateId:String(template._id),entryOrigin:'https://bank.example.invalid',period:{from:'2026-10-01',to:'2026-10-02'},companyAccountConfirmed:true}
  await assert.rejects(service.learningCreate(foreign,otherCompany,input));await assert.rejects(service.learningCreate(owner,company,{...input,companyAccountConfirmed:false}))
  const {session}=await service.learningCreate(owner,company,input),key=session.id
  await assert.rejects(service.learningCreate(owner,company,input));assert.equal((await service.learningList(foreign,otherCompany)).sessions.length,0)
  await assert.rejects(service.learningPcAction({...context,installation:{...context.installation,generation:'other'}},key,'start',{}))
  const queued=await BankJob.create({ownerId:owner,bankAccountId:account._id,jobId:'synthetic-waiting-job',kind:'retrieve',state:'queued',snapshot:{provider:'resona'},snapshotHash:'d'.repeat(64)})
  // Force teaching to begin after claim's initial lock read but before its CAS. No browser work may escape that race.
  let begun:any;const original=BankJob.findOneAndUpdate.bind(BankJob)
  ;(BankJob as any).findOneAndUpdate=(...args:any[])=>{
    const query=original(...args as [any,any,any]),originalLean=query.lean.bind(query)
    query.lean=(async()=>{if(!begun)begun=await service.learningPcAction(context,key,'start',{});return originalLean()}) as any
    return query
  }
  try{assert.equal((await claimBankJob(context.device)).job,null,'claim/start race is closed before any browser work')}
  finally{(BankJob as any).findOneAndUpdate=original}
  assert.ok(begun);await assert.rejects(service.learningPcAction(context,key,'start',{}))
  assert.equal((await claimBankJob(context.device)).job,null,'recording excludes the same account')
  const otherBank=await BankAccount.create({ownerId:owner,name:'Other synthetic bank',connection:{provider:'resona'}})
  const independent=await BankJob.create({ownerId:owner,bankAccountId:otherBank._id,jobId:'synthetic-independent-job',kind:'retrieve',state:'queued',snapshot:{provider:'resona'},snapshotHash:'d'.repeat(64)})
  assert.equal((await claimBankJob({...context.device,bankAccountIds:[account._id,otherBank._id]})).job?.jobId,independent.jobId,'other accounts are not starved')
  await BankJob.updateOne({_id:independent._id},{$set:{state:'complete',open:false}})
  const evidence={schema:1,runtime:LEARNING_RUNTIME,origins:[input.entryOrigin],events:LEARNING_ROLES.map((role,i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin:input.entryOrigin,role,tag:['from','to'].includes(role)?'input':'text'})),complete:true,truncated:false}
  const sent=await service.learningPcAction(context,key,'evidence',{claim:begun.claim,evidence});assert.ok(sent.evidenceHash)
  await service.learningPcAction(context,key,'evidence',{claim:begun.claim,evidence})
  assert.equal((await claimBankJob(context.device)).job,null,'browser still owns the lease until its finally closes')
  await service.learningPcAction(context,key,'finish',{claim:begun.claim})
  assert.equal((await claimBankJob(context.device)).job?.jobId,queued.jobId,'queued model work holds no bank lease')
  await BankJob.updateOne({_id:queued._id},{$set:{state:'complete',open:false}})
  const [first,duplicate]=await Promise.all([service.learningWorkerClaim(),service.learningWorkerClaim()]);const job=first.job||duplicate.job;assert.ok(job);assert.ok(!(first.job&&duplicate.job))
  const candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash:sent.evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))}
  const result={model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:sent.evidenceHash,candidate,tests:['schema','provenance']}
  await Learning.updateOne({_id:key},{$set:{leaseUntil:new Date(0)}})
  const next=(await service.learningWorkerClaim()).job;assert.equal(next.epoch,job.epoch+1)
  await assert.rejects(service.learningWorkerAction(key,'result',{epoch:job.epoch,claim:job.claim,result}))
  const reply=await service.learningWorkerAction(key,'result',{epoch:next.epoch,claim:next.claim,result});assert.ok(reply.candidateHash)
  assert.equal((await service.learningWorkerAction(key,'result',{epoch:next.epoch,claim:next.claim,result})).candidateHash,reply.candidateHash)
  await assert.rejects(service.learningWorkerAction(key,'result',{epoch:next.epoch,claim:next.claim,result:{...result,tests:['schema']}}))
  await assert.rejects(service.learningOwnerAction(owner,company,key,'replay',{period:input.period}))
  const period={from:'2026-11-01',to:'2026-11-02'};await service.learningOwnerAction(owner,company,key,'replay',{period})
  const replay=await service.learningPcAction(context,key,'replay',{})
  const receipt={candidateHash:reply.candidateHash,evidenceHash:sent.evidenceHash,runtime:LEARNING_RUNTIME,period,statementHash:'c'.repeat(64),rows:2,balanceObserved:true,accountMatched:true,loggedOut:true,freshBrowser:true,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}
  await assert.rejects(service.learningPcAction(context,key,'receipt',{claim:replay.claim,nonce:'wrong',receipt}))
  await service.learningPcAction(context,key,'receipt',{claim:replay.claim,nonce:replay.nonce,receipt});await service.learningPcAction(context,key,'receipt',{claim:replay.claim,nonce:replay.nonce,receipt})
  assert.equal((await Learning.findById(key).lean())?.state,'verified')
  await service.learningPcAction(context,key,'finish',{claim:replay.claim})
  await assert.rejects(service.learningOwnerAction(owner,company,key,'enable',{}),'attendance must be explicitly confirmed')
  await Learning.updateOne({_id:key},{$set:{state:'enabled',open:false}}) // process loss after version freeze, before account selection
  const enabled=await service.learningOwnerAction(owner,company,key,'enable',{expectedSelectionHash:null,attendedConfirmed:true})
  await t.test('F4: normal sync without saved dates returns the learning date-form instruction, not a 500',async()=>{
   await assert.rejects(queueBankSync(owner,String(account._id)),(e:any)=>e.statusCode===400&&e.data?.message?.includes('銀行の手順を覚える'));
   assert.equal(await BankJob.countDocuments({bankAccountId:account._id,open:true}),0);
  });
  const nativeBefore=await BankAccount.findById(account._id).lean()
  const selectedJob=await service.learningOwnerAction(owner,company,key,'collect',{expectedSelectionHash:enabled.selectionHash,period})
  assert.equal((await claimBankJob(context.device)).job,null,'a legacy collector does not receive learned work')
  const nativeClaim=BankJob.findOneAndUpdate.bind(BankJob)
  ;(BankJob as any).findOneAndUpdate=(...args:any[])=>{
    const query=nativeClaim(...args as [any,any,any]),lean=query.lean.bind(query)
    query.lean=(async()=>{const claimed=await lean();if(claimed?.jobId===selectedJob.job.jobId)await service.learningOwnerAction(owner,company,key,'disable',{expectedSelectionHash:enabled.selectionHash});return claimed}) as any
    return query
  }
  try{assert.equal((await claimBankJob(context.device,{capabilities:[LEARNING_STATEMENT_CAPABILITY]})).job,null,'selection revoked after claim cannot launch a bank browser')}
  finally{(BankJob as any).findOneAndUpdate=nativeClaim}
  const nativeAfter=await BankAccount.findById(account._id).lean();assert.deepEqual(nativeAfter?.connection,nativeBefore?.connection);assert.equal(nativeAfter?.learningConnector,null)
  const retrySession=(await service.learningCreate(owner,company,input)).session,recordAgain=await service.learningPcAction(context,retrySession.id,'start',{})
  await service.learningPcAction(context,retrySession.id,'evidence',{claim:recordAgain.claim,evidence});await service.learningPcAction(context,retrySession.id,'finish',{claim:recordAgain.claim})
  const failedJob=(await service.learningWorkerClaim()).job
  await service.learningWorkerAction(retrySession.id,'result',{epoch:failedJob.epoch,claim:failedJob.claim,result:{model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:failedJob.evidenceHash,missing:['worker_unavailable'],tests:[]}})
  assert.equal((await Learning.findById(retrySession.id).lean())?.state,'failed')
  await service.learningOwnerAction(owner,company,retrySession.id,'retry-development',{})
  const retried=(await service.learningWorkerClaim()).job;assert.equal(retried.id,retrySession.id);assert.ok(retried.epoch>failedJob.epoch);assert.equal(retried.evidenceHash,failedJob.evidenceHash)
  let freshCount=0;
  async function fresh(){
   const a=await BankAccount.create({ownerId:owner,name:'Recovery synthetic bank '+(++freshCount),connection:{provider:'resona',variant:'direct'}});await FinanceCollector.updateOne({_id:device._id},{$addToSet:{bankAccountIds:a._id}});context.device.bankAccountIds.push(a._id);
   return (await service.learningCreate(owner,company,{...input,bankAccountId:String(a._id)})).session;
  }
  await t.test('F2: expired first evidence and concurrent duplicate deliveries retain the recording',async()=>{
   const s=await fresh(),pc=await service.learningPcAction(context,s.id,'start',{});try{
    await Learning.updateOne({_id:s.id},{$set:{pcLeaseUntil:new Date(0)}});await service.learningPcList(context);assert.equal((await Learning.findById(s.id).lean())?.lastCode,'interrupted_pc_action');
    await assert.rejects(service.learningPcAction(context,s.id,'heartbeat',{claim:pc.claim}),'late data must not renew an expired bank action');
    await assert.rejects(service.learningPcAction(context,s.id,'evidence',{claim:'wrong',evidence}));
    const replies=await Promise.all([1,2].map(()=>service.learningPcAction(context,s.id,'evidence',{claim:pc.claim,evidence})));assert.ok(replies.every(r=>r.accepted));assert.equal(replies[0].evidenceHash,replies[1].evidenceHash);assert.equal((await Learning.findById(s.id).lean())?.state,'queued');
   }finally{await service.learningPcAction(context,s.id,'finish',{claim:pc.claim});await service.learningOwnerAction(owner,company,s.id,'cancel',{})}
   const cancelled=await fresh(),cancelPc=await service.learningPcAction(context,cancelled.id,'start',{});await service.learningOwnerAction(owner,company,cancelled.id,'cancel',{});await assert.rejects(service.learningPcAction(context,cancelled.id,'evidence',{claim:cancelPc.claim,evidence}));assert.equal((await Learning.findById(cancelled.id).lean())?.evidenceHash,undefined);await service.learningPcAction(context,cancelled.id,'finish',{claim:cancelPc.claim});
  });
  await t.test('F2: delayed replay receipt survives the sweep timestamp and still checks its nonce',async()=>{
   const s=await fresh(),pc=await service.learningPcAction(context,s.id,'start',{});try{
    const recorded=await service.learningPcAction(context,s.id,'evidence',{claim:pc.claim,evidence});await service.learningPcAction(context,s.id,'finish',{claim:pc.claim});const work=(await service.learningWorkerClaim()).job;assert.equal(work.id,s.id);
    const version={schema:1,runtime:LEARNING_RUNTIME,evidenceHash:recorded.evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};const accepted=await service.learningWorkerAction(s.id,'result',{epoch:work.epoch,claim:work.claim,result:{model:LEARNING_MODEL,runtime:LEARNING_RUNTIME,evidenceHash:recorded.evidenceHash,candidate:version,tests:['schema','provenance']}});
    await service.learningOwnerAction(owner,company,s.id,'replay',{period});const replayPc=await service.learningPcAction(context,s.id,'replay',{}),ago=Date.now()-45*60000;
    await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(s.id)},{$set:{pcLeaseUntil:new Date(0),pcActionStartedAt:new Date(ago)}});await service.learningPcList(context);
    const delayed={...receipt,candidateHash:accepted.candidateHash,evidenceHash:recorded.evidenceHash,startedAt:new Date(ago-60000).toISOString(),finishedAt:new Date(ago-59000).toISOString()};
    await assert.rejects(service.learningPcAction(context,s.id,'receipt',{claim:replayPc.claim,nonce:'wrong',receipt:delayed}));
    await assert.rejects(service.learningPcAction(context,s.id,'receipt',{claim:replayPc.claim,nonce:replayPc.nonce,receipt:{...delayed,startedAt:new Date(ago-31*60000).toISOString(),finishedAt:new Date(ago-31*60000+1000).toISOString()}}),'a replay outside the existing action clock tolerance is refused');
    const replies=await Promise.all([1,2].map(()=>service.learningPcAction(context,s.id,'receipt',{claim:replayPc.claim,nonce:replayPc.nonce,receipt:delayed})));assert.ok(replies.every(r=>r.accepted));assert.equal((await Learning.findById(s.id).lean())?.state,'verified');await service.learningPcAction(context,s.id,'finish',{claim:replayPc.claim});
   }finally{await service.learningOwnerAction(owner,company,s.id,'cancel',{})}
  });
  await t.test('F3: unavailable queue fails visibly, active work survives, retry resets the waiting age',async()=>{
   const waiting=await fresh(),waitingPc=await service.learningPcAction(context,waiting.id,'start',{});await service.learningPcAction(context,waiting.id,'evidence',{claim:waitingPc.claim,evidence});await service.learningPcAction(context,waiting.id,'finish',{claim:waitingPc.claim});
   const s=await fresh(),pc=await service.learningPcAction(context,s.id,'start',{});await service.learningPcAction(context,s.id,'evidence',{claim:pc.claim,evidence});await service.learningPcAction(context,s.id,'finish',{claim:pc.claim});
   const old=new Date(Date.now()-16*60000);await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(s.id)},{$set:{queuedAt:old}});
   const foreignQueue=new mongoose.Types.ObjectId();await Learning.collection.insertOne({_id:foreignQueue,ownerId:new mongoose.Types.ObjectId(foreign),companyId:otherCompany,bankAccountId:otherBank._id,state:'queued',open:true,queuedAt:old});
   await service.learningList(owner,company);assert.equal((await Learning.findById(s.id).lean())?.state,'queued','F6: a live developing lease keeps older queued work waiting');assert.equal((await Learning.findById(retrySession.id).lean())?.state,'developing');
   await Learning.updateOne({_id:retrySession.id},{$set:{leaseUntil:new Date(0)}});
   // This leg models actual absence: earlier completed results must also be older than a worker lease.
   await Learning.collection.updateMany({'workerReceipt.at':{$exists:true}},{$set:{'workerReceipt.at':new Date(Date.now()-181000)}});
   await service.learningList(owner,company);const failed=await Learning.findById(s.id).lean();assert.equal(failed?.state,'failed');assert.equal(failed?.lastCode,'worker_failed');assert.deepEqual(failed?.missing,['worker_unavailable']);assert.equal((await Learning.findById(waiting.id).lean())?.state,'queued');
   assert.equal((await Learning.findById(foreignQueue).lean())?.state,'queued','one company read cannot expire another owner/company queue');
   await service.learningOwnerAction(owner,company,s.id,'retry-development',{});await service.learningList(owner,company);const retry=await Learning.findById(s.id).lean();assert.equal(retry?.state,'queued');assert.ok(new Date(retry.queuedAt).getTime()>old.getTime());await service.learningOwnerAction(owner,company,s.id,'cancel',{});
   await Learning.collection.updateOne({_id:new mongoose.Types.ObjectId(waiting.id)},{$unset:{queuedAt:''},$set:{updatedAt:old}});await service.learningList(owner,company);assert.equal((await Learning.findById(waiting.id).lean())?.state,'failed','old queued rows without queuedAt also reach the retry lane');await service.learningOwnerAction(owner,company,waiting.id,'cancel',{});
  });
  await CollectorInstallation.updateOne({_id:installation._id},{$set:{generation:'new-generation'}})
  await assert.rejects(service.learningOwnerAction(owner,company,key,'enable',{}))
  // Current company membership is re-read, even when a token/context was obtained earlier.
  await Organization.collection.updateOne({_id:company},{$set:{members:[]}})
  await assert.rejects(service.learningList(owner,company))
 }finally{await mongoose.disconnect();await mongo.stop()}
})

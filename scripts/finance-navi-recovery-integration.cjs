// F1/F2: actual built-app HTTP paths and durable domain markers. Clock boundaries are staged in the owned test database;
// no wall-clock four-minute wait or claim of a real provider timeout. Late settlement models a server finishing after its client.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{ObjectId}=require('mongodb');
module.exports=async({db,call,upload,token,other,pass,csv,row},agent,narrow)=>{
 const ops=db.collection('financeactionoperations');
 const ok=async(route,options)=>{const r=await call(route,options);assert.equal(r.status,200,route+' '+JSON.stringify(r.data));return r.data};
 const worker=(route,body={},auth=agent.token)=>call('/api/finance-chat/worker/'+route,{method:'POST',token:auth,body});
 const unclear={kind:'unclear',summary:'処理結果を確認します。',patch:{},quotes:{}};
 for(const mode of ['purchase','workspace']){
  const imported=await upload(csv(Array.from({length:8},(_,i)=>row({0:'2026/08/'+String(15+i).padStart(2,'0'),1:'2026/08/'+String(16+i).padStart(2,'0'),2:'Recovery '+mode+' test '+i,5:String(601+i)}))));assert.equal(imported.status,200);
  const importId=imported.data.id,draft=line=>ok('/api/finance/imports/'+importId+'/drafts/'+line,{token});
  const collection=db.collection(mode==='purchase'?'financechats':'financeassistants');
  const route=line=>mode==='purchase'?'/api/finance-chat/imports/'+importId+'/drafts/'+line:'/api/finance-chat/workspace';
  const view=line=>ok(route(line),{token});
  const turn=(v,id)=>v.conversation.turns.find(t=>t.id===id);
  async function ask(line){const d=await draft(line),v=await view(line),requestId=crypto.randomUUID();await ok(route(line),{method:'POST',token,body:{text:'保存して結果を確認 '+requestId,requestId,chatRevision:v.conversation?.revision||0,...(mode==='purchase'?{revision:d.revision,key:d.key,sourceHash:d.sourceHash}:{context:{page:'mapping',importId}})}});const claimed=await worker(mode==='purchase'?'claim':'workspace-claim');assert.equal(claimed.status,200);assert.ok(claimed.data.job);return {job:claimed.data.job,turnId:requestId,line}}
  const jobRoute=j=>(mode==='workspace'?'workspace/':'')+j.id;
  const action=(j,slot,name,args={})=>worker(jobRoute(j)+'/actions',{lease:j.lease,slot,name,args});
  const save=async(j,line,slot=1)=>{const r=await action(j,slot,'save_draft_fields',{...(mode==='workspace'?{importId,line}:{}),fields:{productName:'Recovery marker '+mode+' '+line}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.receipt};
  const finish=j=>worker(jobRoute(j)+'/result',{lease:j.lease,proposal:unclear});
  const claimAgain=async j=>{await collection.updateOne({_id:new ObjectId(j.id)},{$set:{leaseUntil:new Date(Date.now()-1000)}});const r=await worker(mode==='purchase'?'claim':'workspace-claim');assert.equal(r.status,200);assert.ok(r.data.job);assert.notEqual(r.data.job.lease,j.lease);return r.data.job};
  // A final reply can arrive before the in-flight action's response. The journal later settles; all turns must reflect it.
  const late=await ask(2),lateReceipt=await save(late.job,2),stored=await ops.findOne({operationId:lateReceipt.operationId});
  await ops.updateOne({_id:stored._id},{$set:{state:'claimed',receipt:null,completedAt:null}});
  assert.equal((await finish(late.job)).status,200);assert.equal(turn(await view(2),late.turnId).actions[0].state,'working');
  await ops.updateOne({_id:stored._id},{$set:{state:stored.state,receipt:stored.receipt,completedAt:stored.completedAt}});
  assert.equal(turn(await view(2),late.turnId).actions[0].state,'done','navi:late-'+mode+'-settlement-visible');
  const next=await ask(2);assert.ok(next.job.context.messages.find(m=>m.actions?.some(a=>a.operationId===lateReceipt.operationId&&a.state==='done')),'navi:late-'+mode+'-next-model-sees-done');
  assert.equal((await finish(next.job)).status,200);assert.equal(turn(await view(2),late.turnId).actions[0].state,'done','navi:earlier-'+mode+'-receipt-live');assert.equal((await draft(2)).revision,1,'navi:late-'+mode+'-no-duplicate');
  // Reclaim at the ordinary one-second poll delay. Keep working inside grace, then recover after grace even on a ready turn.
  const grace=await ask(3),written=await save(grace.job,3);await ops.updateOne({operationId:written.operationId},{$set:{state:'claimed',receipt:null,leaseUntil:new Date(Date.now()-1000),completedAt:null}});
  const successor=await claimAgain(grace.job);assert.equal(successor.actions.find(a=>a.operationId===written.operationId).state,'working','navi:'+mode+'-grace-keeps-inflight');assert.equal((await finish(successor)).status,200);
  assert.equal(turn(await view(3),grace.turnId).actions[0].state,'working');await ops.updateOne({operationId:written.operationId},{$set:{leaseUntil:new Date(Date.now()-25000)}});
  assert.equal(turn(await view(3),grace.turnId).actions[0].state,'done','navi:'+mode+'-ready-turn-recovers-after-grace');assert.equal((await draft(3)).revision,1);
  // Finishing a successor with an old interrupted operation reconciles from the saved marker before copying receipts.
  const old=await ask(4),oldReceipt=await save(old.job,4);await ops.updateOne({operationId:oldReceipt.operationId},{$set:{state:'claimed',receipt:null,lease:'dead-'+old.job.lease,leaseUntil:new Date(Date.now()-25000),completedAt:null}});
  assert.equal((await finish(old.job)).status,200);const finalDoc=await collection.findOne({_id:new ObjectId(old.job.id)});assert.equal(finalDoc.turns.find(t=>t.id===old.turnId).actions[0].state,'done','navi:'+mode+'-finish-reconciles');
  // Before-write interruption becomes an explicit failed receipt without a domain effect; action-status recovers older turns.
  const statusJob=await ask(5),statusReceipt=await save(statusJob.job,5),record=await ops.findOne({operationId:statusReceipt.operationId});
  await ops.updateOne({_id:record._id},{$set:{state:'claimed',receipt:null,lease:'dead-status',leaseUntil:new Date(Date.now()-25000),completedAt:null}});
  const status=await action(statusJob.job,2,'get_action_status',{operationId:statusReceipt.operationId});assert.equal(status.status,200);assert.equal(status.data.result.receipts[0].state,'done','navi:'+mode+'-action-status-recovers');
  const fake={...record,_id:new ObjectId(),operationId:crypto.randomBytes(16).toString('hex'),slot:3,state:'claimed',receipt:null,lease:'dead-before-write',leaseUntil:new Date(Date.now()-25000),completedAt:null};await ops.insertOne(fake);
  const failed=await action(statusJob.job,4,'get_action_status',{operationId:fake.operationId});assert.equal(failed.status,200);assert.equal(failed.data.result.receipts[0].state,'failed','navi:'+mode+'-before-write-fails');assert.equal((await draft(5)).revision,1);assert.equal((await finish(statusJob.job)).status,200);
  pass('N8 '+mode+' late journal settlement, older-turn context, near-expiry reclaim/grace, finish/status recovery and no repeated domain writes');
  // A near-expiry live job renews, including its unfinished records. An old journal expiry alone cannot kill a live write.
  const active=await ask(6),activeReceipt=await save(active.job,6),activeId=new ObjectId(active.job.id),oldExpiry=new Date(Date.now()+1000);
  await collection.updateOne({_id:activeId},{$set:{leaseUntil:oldExpiry}});await ops.updateOne({operationId:activeReceipt.operationId},{$set:{state:'claimed',receipt:null,completedAt:null,leaseUntil:new Date(Date.now()-25000)}});
  assert.equal(turn(await view(6),active.turnId).actions[0].state,'working','navi:'+mode+'-live-job-protects-write');
  const heartbeat={job:{id:active.job.id,mode,lease:active.job.lease}};const renewed=await worker('heartbeat',heartbeat);assert.equal(renewed.status,200,'navi:'+mode+'-renewal-accepted');
  const liveDoc=await collection.findOne({_id:activeId}),liveOp=await ops.findOne({operationId:activeReceipt.operationId});assert.ok(liveDoc.leaseUntil.getTime()>Date.now()+110000,'navi:'+mode+'-lease-extended');assert.ok(liveOp.leaseUntil.getTime()>=liveDoc.leaseUntil.getTime(),'navi:'+mode+'-operation-lease-extended');assert.equal(liveDoc.lease,active.job.lease);
  const unchanged=liveDoc.leaseUntil.getTime();assert.equal((await worker('heartbeat',{job:{...heartbeat.job,lease:'wrong-lease'}})).status,409,'navi:'+mode+'-wrong-lease-not-renewed');assert.equal((await worker('heartbeat',heartbeat,narrow.token)).status,mode==='workspace'?403:409,'navi:'+mode+'-foreign-agent-not-renewed');
  assert.equal((await collection.findOne({_id:activeId})).leaseUntil.getTime(),unchanged);
  const newer=await claimAgain(active.job);assert.equal((await worker('heartbeat',heartbeat)).status,409,'navi:'+mode+'-stale-worker-not-renewed');assert.equal((await finish(active.job)).status,409);assert.equal((await action(active.job,7,'save_draft_fields',{...(mode==='workspace'?{importId,line:6}:{}),fields:{productName:'Stale overwrite'}})).status,409);
  assert.equal((await collection.findOne({_id:activeId})).lease,newer.lease,'navi:'+mode+'-successor-ownership-kept');assert.equal((await finish(newer)).status,200);assert.equal((await worker('heartbeat',{job:{id:newer.id,mode,lease:newer.lease}})).status,409,'navi:'+mode+'-completed-not-renewed');
  const expired=await ask(7);await collection.updateOne({_id:new ObjectId(expired.job.id)},{$set:{leaseUntil:new Date(Date.now()-1)}});assert.equal((await worker('heartbeat',{job:{id:expired.job.id,mode,lease:expired.job.lease}})).status,409,'navi:'+mode+'-expired-not-resurrected');const recovered=(await worker(mode==='purchase'?'claim':'workspace-claim')).data.job;assert.ok(recovered);assert.equal((await finish(recovered)).status,200);
  pass('N9 '+mode+' exact active lease renewal, live-write protection, foreign/stale/completed/expired refusal and successor isolation');
  const foreign=await call('/api/finance-chat/imports/'+importId+'/drafts/2',{token:other});assert.equal(foreign.status,404);
 }
 assert.equal((await worker('heartbeat')).status,200,'navi:idle-heartbeat-compatible');
 assert.equal((await call('/api/finance-chat/worker/heartbeat',{method:'POST',token:agent.token})).status,200,'navi:empty-idle-heartbeat-compatible');
};

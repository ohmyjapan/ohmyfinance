// Native company mutation checks; invoked only inside the owned company regression database.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async({db,ObjectId,ok,call,worker,tokenA,tokenB,A,B,owner,members,paymentA,paymentB,suppressed,pass})=>{
 const endpoint='/api/finance-chat/company-workspace',payments=db.collection('payments'),conversations=db.collection('financecompanyassistants');
 const immutable=async()=>JSON.stringify(await payments.find({_id:{$in:[paymentB,suppressed]}}).sort({_id:1}).toArray()),foreignBefore=await immutable();
 const read=()=>ok('/api/payments/'+paymentA,tokenA);
 await ok('/api/payments/'+paymentA,tokenA,'PUT',{notes:'Native edit before Navi'});
 const view=await ok(endpoint,tokenA);const requestId=crypto.randomBytes(16).toString('hex');
 await worker('heartbeat');await ok(endpoint,tokenA,'POST',{requestId,text:'Update this company calendar entry as explicitly specified.',chatRevision:view.conversation.revision,context:{page:'calendar',paymentId:String(paymentA)}});
 let job=(await worker('workspace-claim')).data.job;assert.ok(job,'company-navi:calendar-action-job');assert.equal(job.context.scope.organizationId,String(A));
 const act=(name,args={},slot=1,claimed=job)=>worker('workspace/'+claimed.id+'/actions',{lease:claimed.lease,name,args,slot});
 const before=await read(),date='2026-11-10',args={paymentId:String(paymentA),expectedUpdatedAt:before.updatedAt||'',dueDate:date,amount:0,status:'paid',notes:'Saved through Navi'};
 const responses=await Promise.all([act('update_company_calendar_entry',args),act('update_company_calendar_entry',args)]);
 for(const r of responses)assert.equal(r.status,200,'company-navi:calendar-save '+r.raw.slice(0,250));
 const status=(await act('get_company_action_status')).data.result.receipts;assert.equal(status.length,1);assert.ok(!Object.hasOwn(status[0],'lease'));assert.ok(!Object.hasOwn(status[0],'payloadHash'));assert.equal(status[0].state,'done','company-navi:calendar-save-receipt');
 const operationId=status[0].operationId;assert.equal(responses[0].data.receipt.operationId,responses[1].data.receipt.operationId);
 const saved=await read();assert.equal(saved.amount,0);assert.equal(saved.currency,before.currency);assert.equal(saved.dueDate,date+'T12:00:00.000Z');assert.equal(saved.status,'paid');assert.ok(saved.settledAt);assert.deepEqual(saved.source,before.source);assert.equal(saved.notes,'Saved through Navi');
 const savedTime=saved.updatedAt,settled=saved.settledAt;const duplicate=await act('update_company_calendar_entry',args,2);assert.equal(duplicate.status,200);assert.equal(duplicate.data.receipt.operationId,operationId);assert.equal((await read()).updatedAt,savedTime,'company-navi:no-repeat-on-new-slot');
 assert.equal((await act('update_company_calendar_entry',{...args,notes:'Different meaning'},1)).status,409,'company-navi:slot-payload-identity');
 assert.equal((await act('update_company_calendar_entry',{...args,paymentId:String(paymentB),expectedUpdatedAt:(await payments.findOne({_id:paymentB})).updatedAt.toISOString()},3)).status,404,'company-navi:no-foreign-write');
 assert.equal((await act('update_company_calendar_entry',{...args,paymentId:String(suppressed)},4)).status,404,'company-navi:no-suppressed-write');
 assert.equal((await act('update_company_calendar_entry',{...args,organizationId:String(B)},5)).status,400);assert.equal((await act('update_company_calendar_entry',{...args,amount:'0'},5)).status,400);assert.equal((await act('update_company_calendar_entry',{...args,dueDate:'2026-02-30'},5)).status,400);
 // A native edit after the read must survive the stale AI instruction, including the first settlement timestamp.
 await ok('/api/payments/'+paymentA,tokenA,'PUT',{notes:'Native newer edit',status:'paid',organizationId:String(B),naviOperation:{operationId:'ATTACK'},source:{}});
 const native=await read();assert.equal(native.settledAt,settled);assert.equal(native.naviOperation.operationId,operationId);assert.deepEqual(native.source,before.source);
 const staleArgs={paymentId:String(paymentA),expectedUpdatedAt:savedTime,notes:'Must not overwrite newer edit'};
 assert.equal((await act('update_company_calendar_entry',staleArgs,6)).status,409,'company-navi:stale-calendar-snapshot');assert.equal((await read()).notes,'Native newer edit');
 // Crash after the domain write but before recording its receipt: the atomic payment marker proves completion.
 const cId=new ObjectId(job.id);await conversations.updateOne({_id:cId},{$set:{'turns.$[turn].actions.$[action].state':'claimed'}},{arrayFilters:[{'turn.id':requestId},{'action.operationId':operationId}]});
 const recovered=(await act('get_company_action_status',{operationId})).data.result.receipts;assert.equal(recovered[0].state,'done','company-navi:recover-atomic-payment-marker');assert.equal((await read()).notes,'Native newer edit');
 // An expired claim without the domain marker stays unknown; a repeated intent never repeats its write.
 let c=await ok(endpoint,tokenA);const failed=c.conversation.turns.find(t=>t.id===requestId).actions.find(a=>a.slot===6);assert.equal(failed.state,'failed');
 await conversations.updateOne({_id:cId},{$set:{'turns.$[turn].actions.$[action].state':'claimed','turns.$[turn].actions.$[action].leaseUntil':new Date(0),'turns.$[turn].actions.$[action].lease':'expired-company-operation'}},{arrayFilters:[{'turn.id':requestId},{'action.operationId':failed.operationId}]});
 const unknown=(await act('get_company_action_status',{operationId:failed.operationId})).data.result.receipts;assert.equal(unknown[0].state,'unresolved','company-navi:unknown-not-repeated');
 const again=await act('update_company_calendar_entry',staleArgs,7);assert.equal(again.status,200);assert.equal(again.data.receipt.state,'unresolved');assert.equal((await read()).notes,'Native newer edit');
 await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await act('update_company_calendar_entry',{paymentId:String(paymentA),expectedUpdatedAt:native.updatedAt,notes:'Revoked write'},8)).status,403,'company-navi:revoked-write');await db.collection('organizations').updateOne({_id:A},{$set:{members}});
 const oldJob=job;await conversations.updateOne({_id:cId},{$set:{leaseUntil:new Date(0),attempts:1}});job=(await worker('workspace-claim')).data.job;assert.ok(job);assert.notEqual(job.lease,oldJob.lease);assert.ok(job.actions.some(a=>a.operationId===operationId&&a.state==='done'));assert.ok(job.nextSlot>6);
 assert.equal((await act('update_company_calendar_entry',{paymentId:String(paymentA),expectedUpdatedAt:native.updatedAt,notes:'Old lease'},9,oldJob)).status,409,'company-navi:old-write-lease');
 const replay=await act('update_company_calendar_entry',args,job.nextSlot);assert.equal(replay.status,200);assert.equal(replay.data.receipt.operationId,operationId);assert.equal((await read()).notes,'Native newer edit');
 assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic verified calendar update; saved status only, not bank settlement.',patch:{},quotes:{}}})).status,200);
 assert.equal(await immutable(),foreignBefore,'company-navi:foreign-calendar-immutable');assert.equal((await call('/api/payments/'+paymentA,tokenB)).status,404);
 pass('company calendar save: native fields/noon/zero/settlement, concurrent and cross-slot idempotency, stale snapshot, foreign/suppressed/revoked/old lease, domain-marker and unknown-outcome recovery');
 return {paymentId:String(paymentA)};
};

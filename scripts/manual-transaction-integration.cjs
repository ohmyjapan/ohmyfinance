const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),{randomBytes}=require('node:crypto');
module.exports=async({db,call,token,other,origin,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),organizationId=new ObjectId(claims.organizationId),owner=new ObjectId(claims.userId);
 const otherClaims=JSON.parse(Buffer.from(other.split('.')[1],'base64url')),memberId=new ObjectId(otherClaims.userId);
 const body={date:'2026-09-22',amount:67000,notes:'Synthetic durable manual purchase'},key=()=>randomBytes(16).toString('hex'),request=key();
 const create=(k=request,data=body,auth=token)=>call('/api/transactions',{method:'POST',token:auth,headers:{'Idempotency-Key':k},body:data});
 const lookup=(k=request,auth=token)=>call('/api/transactions/creation/'+k,{token:auth});
 assert.equal((await call('/api/transactions/creation/'+request)).status,401);
 assert.equal((await create(request,body,other)).status,403);
 assert.deepEqual((await lookup()).data,{state:'absent'});
 const responses=await Promise.all(Array.from({length:8},()=>create()));assert.ok(responses.every(r=>r.status===200),JSON.stringify(responses));
 const first=responses[0].data,id=new ObjectId(first.transactionId);
 assert.equal(new Set(responses.map(r=>r.data.transactionId)).size,1);assert.equal(first.state,'saved');assert.equal(first.transaction.manualCreate,undefined);
 assert.equal((await db.collection('transactions').findOne({_id:id})).timeline.length,1);
 const uncached=await fetch(origin+'/api/transactions/creation/'+request,{headers:{Authorization:'Bearer '+token}});assert.equal(uncached.headers.get('cache-control'),'no-store');await uncached.arrayBuffer();
 pass('authenticated concurrent keyed POST saves one transaction and one creation event');

 // The response is deliberately discarded after the real server write.
 const lost=key();await assert.rejects((async()=>{await create(lost);throw Error('Synthetic lost response')})(),/lost response/);
 const observed=await lookup(lost),retried=await create(lost);assert.equal(observed.data.state,'saved');assert.equal(retried.data.transactionId,observed.data.transactionId);
 assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':lost}),1);
 assert.equal((await create(request,{...body,amount:1})).status,409);
 const separate=await create(key());assert.equal(separate.status,200);assert.notEqual(separate.data.transactionId,first.transactionId);
 pass('lost response reconciliation keeps the same transaction while changed intent conflicts and separate purchases survive');

 await db.collection('organizations').updateOne({_id:organizationId},{$push:{members:{userId:memberId,role:'member',joinedAt:new Date()}}});
 const selected=await call('/api/auth/switch-organization',{method:'POST',token:other,body:{organizationId:String(organizationId)}});assert.equal(selected.status,200);const member=selected.data.tokens.accessToken;
 assert.equal((await call('/api/transactions/'+id,{method:'PUT',token:member,body:{notes:'Reviewed by group member'}})).status,200);
 const replay=await create(request,body,member);assert.equal(replay.status,200);assert.equal(replay.data.transaction.notes,'Reviewed by group member');assert.equal(replay.data.transaction.timeline.length,2);
 assert.equal(String((await db.collection('transactions').findOne({_id:id})).manualCreate.createdBy),String(owner));
 await db.collection('organizations').updateOne({_id:organizationId,'members.userId':memberId},{$set:{'members.$.role':'viewer'}});
 assert.equal((await lookup(request,member)).data.transactionId,first.transactionId);assert.equal((await create(request,body,member)).status,403);
 await db.collection('organizations').updateOne({_id:organizationId},{$pull:{members:{userId:memberId}}});
 assert.equal((await lookup(request,member)).status,403);
 pass('group members recover current edits while current viewer and revoked permissions are enforced');

 const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic other manual ledger');
 assert.deepEqual((await lookup(request,foreign.token)).data,{state:'absent'});
 const foreignCreated=await create(request,body,foreign.token);assert.equal(foreignCreated.status,200);assert.notEqual(foreignCreated.data.transactionId,first.transactionId);
 assert.equal((await lookup()).data.transactionId,first.transactionId);
 pass('reconciliation and identical request keys remain isolated by selected company');

 assert.equal((await call('/api/transactions/'+id,{method:'DELETE',token})).status,200);
 assert.deepEqual((await create()).data,{state:'deleted',transactionId:first.transactionId});assert.deepEqual((await lookup()).data,{state:'deleted',transactionId:first.transactionId});
 assert.equal((await call('/api/transactions/'+id,{token})).status,404);
 assert.equal((await create(request,{...body,amount:0})).status,409);
 pass('HTTP deletion remains terminal for delayed retries without exposing a deleted purchase payload');

 const before=await db.collection('transactions').countDocuments({});
 for(const k of ['', 'A'.repeat(32), 'a'.repeat(32)+', '+ 'b'.repeat(32)])assert.equal((await create(k)).status,400);
 for(const data of [{...body,date:'2026-02-30'}, {...body,amount:null},{...body,manualCreate:{key:key()}},{...body,metadata:{financeEntryId:'forged'}}, {...body,attachments:[]}])assert.equal((await create(key(),data)).status,400);
 assert.equal(await db.collection('transactions').countDocuments({}),before);
 const zero=key(),savedZero=await create(zero,{...body,amount:0,taxRate:0,customerId:null});assert.equal(savedZero.status,200);assert.equal(savedZero.data.transaction.amount,0);assert.equal(savedZero.data.transaction.taxRate,0);
 const sameZero=await create(zero,{...body,amount:'0',taxRate:'0',date:'2026-09-22T00:00:00.000Z',customerId:''});assert.equal(sameZero.data.transactionId,savedZero.data.transactionId);
 pass('HTTP payload validation preserves zero values canonical equivalence and internal-field protection');

 const indexes=await db.collection('transactions').indexes(),index=indexes.find(i=>i.key['manualCreate.key']);await db.collection('transactions').dropIndex(index.name);
 const guardedKey=key();
 try{assert.equal((await create(guardedKey)).status,503);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':guardedKey}),0)}
 finally{await db.collection('transactions').createIndex(index.key,{unique:true,partialFilterExpression:index.partialFilterExpression})}
 assert.equal((await create(guardedKey)).status,200);
 pass('built API refuses keyed insertion when the unique index is missing and resumes with the original key');

 const legacy=[];for(let i=0;i<2;i++)legacy.push(await call('/api/transactions',{method:'POST',token,body:{...body,notes:'Synthetic legacy compatibility'}}));
 assert.ok(legacy.every(r=>r.status===200));assert.notEqual(String(legacy[0].data._id),String(legacy[1].data._id));assert.equal(await db.collection('transactions').countDocuments({notes:'Synthetic legacy compatibility',manualCreate:{$exists:false}}),2);
 pass('unkeyed compatibility preserves independent occurrences and makes no replay guarantee');
};

const assert=require('node:assert/strict'),{ObjectId}=require('mongodb');
const group=require('./helpers/group-session.cjs'),page=require('./helpers/recurring-page.cjs');
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
module.exports=async({db,call,token,other,pass})=>{
  const a=await group(call,token,'Recurring company A'),b=await group(call,token,'Recurring company B');
  const ga=new ObjectId(a.organizationId),gb=new ObjectId(b.organizationId),owner=new ObjectId(claims(token).userId),peer=new ObjectId(claims(other).userId);
  const due='2026-01-31T00:00:00.000Z',input={name:'Synthetic rent',amount:1000,frequency:'monthly',startDate:due,nextDueDate:due,customer:{name:'Synthetic customer'},organizationId:b.organizationId};
  const req=(path='',method='GET',body,auth=a.token)=>call('/api/recurring'+path,{method,body,token:auth});
  assert.equal((await call('/api/recurring')).status,401);
  for(const path of ['', '/process'])assert.equal((await req(path,'GET',undefined,token)).status,403);
  const first=await req('','POST',input);assert.equal(first.status,200,JSON.stringify(first));const own=first.data.payment,id=own.id;
  assert.equal(own.organizationId,a.organizationId);assert(id);
  const second=await req('','POST',input,b.token);assert.equal(second.status,200);const foreign=second.data.payment.id;
  const legacy=new ObjectId();await db.collection('recurringpayments').insertOne({...input,_id:legacy,organizationId:undefined,startDate:new Date(due),nextDueDate:new Date(due),status:'active'});
  assert.deepEqual((await req()).data.map(x=>x.id),[id]);assert.equal((await req('?stats=true')).data.total,1);assert.equal((await req('/process')).data.count,1);
  const before=await db.collection('recurringpayments').find({_id:{$in:[new ObjectId(foreign),legacy]}}).toArray();
  for(const target of [foreign,String(legacy)])for(const method of ['GET','PUT','PATCH','DELETE','POST'])assert.equal((await req('/'+target,method,method==='GET'?undefined:{amount:500,dueDate:due})).status,404,method);
  pass('recurring creation and every record operation use selected company; lists and totals exclude foreign and legacy rows');

  await db.collection('organizations').updateOne({_id:ga},{$push:{members:{userId:peer,role:'member',joinedAt:new Date()}}});
  const switched=await call('/api/auth/switch-organization',{token:other,method:'POST',body:{organizationId:a.organizationId}});assert.equal(switched.status,200);const memberToken=switched.data.tokens.accessToken;
  assert.equal((await req('/'+id,'GET',undefined,memberToken)).data.id,id);
  const edited=await req('/'+id,'PATCH',{amount:1200,organizationId:b.organizationId,$set:{organizationId:b.organizationId},generatedTransactionIds:[foreign],occurrences:[]},memberToken);
  assert.equal(edited.status,200);assert.equal(edited.data.payment.organizationId,a.organizationId);assert.equal(edited.data.payment.amount,1200);assert.equal(edited.data.payment.generatedTransactionIds.length,0);
  pass('company members share recurring payments and edits cannot inject company or generation state');

  const calls=[],ui=page({store:{authHeader:{Authorization:'Bearer '+memberToken}},fetch:async(path,options={})=>{
    calls.push({path,options});const result=await call(path,{method:options.method||'GET',body:options.body,token:memberToken});
    if(result.status>=400){const error=Error(result.data.statusMessage);error.data=result.data;throw error;}return result.data;
  }});
  try{
    await ui.state.generateNow({...own,amount:1200});
    assert.equal(ui.alerts[0],'Transaction generated successfully');assert.deepEqual(calls[0].options.body,{dueDate:due});
    assert(ui.state.payments.value.length);assert.equal(ui.state.payments.value[0].nextDueDate,'2026-02-28T00:00:00.000Z');
    await ui.state.generateNow(own);assert.equal(ui.alerts[1],'Transaction generated successfully');
  }finally{ui.close();}
  const rows=await db.collection('transactions').find({'metadata.recurringPaymentId':id}).toArray();assert.equal(rows.length,1);assert.equal(String(rows[0].organizationId),a.organizationId);assert.equal(rows[0].type,'支出');assert.equal(rows[0].amount,1200);
  assert.equal((await call('/api/transactions/'+rows[0]._id,{token:memberToken})).status,200);assert.equal((await call('/api/transactions/'+rows[0]._id,{token:b.token})).status,404);
  assert.equal((await req('/'+id,'POST',{})).status,400);
  pass('compiled recurring page sends occurrence identity to the built API and lost-response retries reuse the same ledger entry');

  const batch=await req('/process','POST',{});assert.equal(batch.status,200,JSON.stringify(batch));assert.equal(batch.data.processed,1);assert.equal(batch.data.succeeded,1);
  assert.equal(await db.collection('transactions').countDocuments({'metadata.recurringPaymentId':id}),2);
  assert.deepEqual(await db.collection('recurringpayments').find({_id:{$in:[new ObjectId(foreign),legacy]}}).toArray(),before);
  pass('recurring batch advances one due occurrence per local payment and leaves foreign schedules untouched');

  await db.collection('organizations').updateOne({_id:ga,'members.userId':peer},{$set:{'members.$.role':'viewer'}});
  for(const path of ['', '/'+id, '?stats=true', '/process'])assert.equal((await req(path,'GET',undefined,memberToken)).status,200);
  for(const [path,method,body] of [['','POST',input],['/'+id,'PUT',{amount:8}],['/'+id,'PATCH',{status:'paused'}],['/'+id,'DELETE',{}],['/'+id,'POST',{dueDate:due}],['/process','POST',{}]])assert.equal((await req(path,method,body,memberToken)).status,403);
  for(const role of ['admin','owner','member']){
    await db.collection('organizations').updateOne({_id:ga,'members.userId':peer},{$set:{'members.$.role':role}});
    assert.equal((await req('/'+id,'PUT',{notes:'Allowed '+role},memberToken)).status,200);
  }
  pass('current role allows owner admin and member writes; demoted tokens retain reads and lose all recurring writes');

  await db.collection('organizations').updateOne({_id:ga},{$pull:{members:{userId:peer}}});
  for(const path of ['', '/'+id, '?stats=true', '/process'])assert.equal((await req(path,'GET',undefined,memberToken)).status,403);
  await db.collection('organizations').updateOne({_id:ga},{$set:{isActive:false}});assert.equal((await req()).status,403);
  await db.collection('organizations').updateOne({_id:ga},{$set:{isActive:true}});
  assert.equal((await req('/'+id,'DELETE',{})).status,200);assert.equal((await req('/'+id)).status,404);
  assert.equal(await db.collection('transactions').countDocuments({'metadata.recurringPaymentId':id}),2);
  pass('membership removal and inactive groups revoke access; deleting a completed schedule preserves posted ledger history');
};

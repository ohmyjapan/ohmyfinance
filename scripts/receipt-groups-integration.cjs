const assert=require('node:assert/strict');
const {ObjectId}=require('mongodb');
const groupSession=require('./helpers/group-session.cjs');
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
module.exports=async({db,call,token,other,pass})=>{
  assert.equal((await call('/api/receipts',{token})).status,403,'A group must be selected before reading group receipts');
  const a=await groupSession(call,token,'Synthetic receipts A'),b=await groupSession(call,other,'Synthetic receipts B');
  const group=new ObjectId(a.organizationId),foreignGroup=new ObjectId(b.organizationId);
  const members={owner:a.token};
  for(const role of ['admin','member','viewer']){
    const registered=await call('/api/auth/register',{method:'POST',body:{email:'receipt-'+role+'@example.invalid',password:'Synthetic-password-Only1!',name:'Synthetic '+role}});
    assert.equal(registered.status,200,JSON.stringify(registered));
    const access=registered.data.tokens.accessToken,userId=new ObjectId(claims(access).userId);
    await db.collection('organizations').updateOne({_id:group},{$push:{members:{userId,role,joinedAt:new Date()}}});
    const selected=await call('/api/auth/switch-organization',{method:'POST',token:access,body:{organizationId:a.organizationId}});
    assert.equal(selected.status,200);members[role]=selected.data.tokens.accessToken;
  }
  pass('receipt access requires a selected group and existing membership roles can select it');
  const create=(access,extra={})=>call('/api/receipts',{method:'POST',token:access,body:{filename:'synthetic-'+new ObjectId()+'.pdf',size:1,amount:67000,merchant:'Synthetic same shop',receiptDate:'2026-09-22',currency:'JPY',...extra}});
  const receipt=(await create(a.token,{organizationId:b.organizationId,uploadedBy:claims(other).userId})).data;
  assert.equal(receipt.organizationId,a.organizationId);assert.equal(receipt.uploadedBy,claims(token).userId);
  const foreign=(await create(b.token)).data,route='/api/receipts/'+receipt.id;
  await db.collection('receipts').insertOne({filename:'unassigned-synthetic.pdf',originalFilename:'unassigned-synthetic.pdf',size:1,status:'unmatched',uploadDate:new Date(),uploadedBy:new ObjectId(claims(token).userId)});
  for(const access of Object.values(members)){
    const list=await call('/api/receipts',{token:access});assert.equal(list.status,200);assert.deepEqual(list.data.receipts.map(r=>r.id),[receipt.id]);
    assert.equal((await call(route,{token:access})).data.id,receipt.id);
    assert.equal((await call('/api/receipts?stats=true',{token:access})).data.stats.total,1);
    const exported=await call('/api/receipts/export?format=json',{token:access});assert.equal(exported.status,200);assert(JSON.stringify(exported.data).includes(receipt.id));assert(!JSON.stringify(exported.data).includes(foreign.id));
  }
  pass('group members share list, detail, statistics and exports regardless of uploader; foreign and unassigned records stay excluded');
  for(const role of ['owner','admin','member']){
    const patch=await call(route,{method:'PATCH',token:members[role],body:{notes:'Edited by '+role,organizationId:b.organizationId,uploadedBy:claims(other).userId}});
    assert.equal(patch.status,200);assert.equal(patch.data.notes,'Edited by '+role);assert.equal(patch.data.organizationId,a.organizationId);assert.equal(patch.data.uploadedBy,claims(token).userId);
  }
  pass('owner, admin and member may edit shared metadata without moving a receipt or rewriting provenance');
  for(const [url,method,body]of [[route,'PATCH',{notes:'Forbidden'}],[route,'DELETE'],['/api/receipts','POST',{filename:'forbidden'}],['/api/receipts/upload','POST'],[route+'/match','POST',{transactionId:new ObjectId().toString()}],[route+'/match','DELETE'],['/api/receipts/auto-match','POST',{}]]){
    assert.equal((await call(url,{token:members.viewer,method,body})).status,403,url+' '+method);
  }
  pass('viewers can read but cannot create, upload, edit, delete, match or auto-match receipts');
  for(const method of ['GET','PATCH','DELETE'])assert.equal((await call(route,{token:b.token,method,body:method==='PATCH'?{notes:'Foreign'}:undefined})).status,404);
  const base={date:new Date('2026-09-22'),amount:67000,companyInfo:'Synthetic same shop',metadata:{currency:'JPY'},type:'支出',status:'completed',hasReceipt:false,timeline:[]};
  const ownId=new ObjectId(),foreignId=new ObjectId(),legacyId=new ObjectId();
  await db.collection('transactions').insertMany([{...base,_id:ownId,organizationId:group},{...base,_id:foreignId,organizationId:foreignGroup},{...base,_id:legacyId}]);
  const suggestions=await call(route+'/matches',{token:members.member});assert.equal(suggestions.status,200,JSON.stringify(suggestions));assert.deepEqual(suggestions.data.matches.map(m=>m.transactionId),[ownId.toString()]);
  const rowsBefore=await db.collection('transactions').find({}).toArray(),receiptBefore=await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)});
  for(const id of [foreignId,legacyId]){
    assert.equal((await call(route+'/match',{method:'POST',token:members.member,body:{transactionId:id.toString(),linkVersion:0}})).status,404);
    assert.equal((await call('/api/receipts/'+id+'/pdf',{token:members.member})).status,404);
  }
  assert.equal((await call('/api/receipts/'+ownId+'/pdf',{token:members.viewer})).status,200);
  assert.deepEqual(await db.collection('transactions').find({}).toArray(),rowsBefore);
  assert.deepEqual(await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)}),receiptBefore);
  pass('suggestions and transaction receipt previews stay in the selected company; foreign and unassigned match attempts write nothing');
  await db.collection('receipts').updateOne({_id:new ObjectId(receipt.id)},{$set:{status:'matched',transactionId:foreignId}});
  assert.equal((await call(route+'/match',{method:'DELETE',token:members.member,body:{transactionId:foreignId.toString(),linkVersion:0}})).status,200);
  assert.equal((await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)})).status,'unmatched');
  assert.deepEqual(await db.collection('transactions').find({}).toArray(),rowsBefore);
  await db.collection('receipts').updateOne({_id:new ObjectId(receipt.id)},{$set:{status:'unmatched'},$unset:{transactionId:''}});
  pass('unmatch clears only the owned stale receipt reference and never writes the foreign ledger');
  const memberId=new ObjectId(claims(members.member).userId);
  await db.collection('organizations').updateOne({_id:group,'members.userId':memberId},{$set:{'members.$.role':'viewer'}});
  assert.equal((await call(route,{token:members.member})).status,200);
  assert.equal((await call(route,{method:'PATCH',token:members.member,body:{notes:'Stale member claim'}})).status,403);
  await db.collection('organizations').updateOne({_id:group,'members.userId':memberId},{$set:{'members.$.role':'member'}});
  assert.equal((await call(route,{method:'PATCH',token:members.member,body:{notes:'Restored membership'}})).status,200);
  pass('demotion takes effect on the next request despite stale JWT role claims; restoring the role restores legitimate access');
  await db.collection('organizations').updateOne({_id:group},{$pull:{members:{userId:new ObjectId(claims(token).userId)}}});
  assert.equal((await call(route,{token:a.token})).status,403);
  assert.equal((await call(route,{token:members.member})).status,200);
  await db.collection('organizations').updateOne({_id:group},{$set:{isActive:false}});
  assert.equal((await call(route,{token:members.member})).status,403);
  await db.collection('organizations').updateOne({_id:group},{$set:{isActive:true}});
  assert.equal((await call(route,{token:members.member})).status,200);
  pass('removing the uploader revokes access while other members retain it; inactive groups deny access without reassigning data');
  assert.equal((await call(route,{method:'DELETE',token:members.member})).status,200);
  assert.equal((await call('/api/receipts/'+foreign.id,{token:b.token})).status,200);
  pass('a current member can delete a shared receipt without deleting a foreign-group record');
};

const assert=require('node:assert/strict');
const {ObjectId}=require('mongodb');
const groupSession=require('./helpers/group-session.cjs');
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
module.exports=async({db,call,token,other,origin,pass})=>{
  assert.equal((await call('/api/transactions',{token})).status,403,'Transactions need a selected company');
  const a=await groupSession(call,token,'Synthetic transaction A'),b=await groupSession(call,other,'Synthetic transaction B');
  const group=new ObjectId(a.organizationId),foreignGroup=new ObjectId(b.organizationId);
  const memberId=new ObjectId(claims(other).userId);
  await db.collection('organizations').updateOne({_id:group},{$push:{members:{userId:memberId,role:'member',joinedAt:new Date()}}});
  const member=(await call('/api/auth/switch-organization',{method:'POST',token:other,body:{organizationId:a.organizationId}})).data.tokens.accessToken;
  const registered=await call('/api/auth/register',{method:'POST',body:{email:'transaction-viewer@example.invalid',password:'Synthetic-password-Only1!',name:'Synthetic viewer'}});
  assert.equal(registered.status,200);const rawViewer=registered.data.tokens.accessToken;
  await db.collection('organizations').updateOne({_id:group},{$push:{members:{userId:new ObjectId(claims(rawViewer).userId),role:'viewer',joinedAt:new Date()}}});
  const viewer=(await call('/api/auth/switch-organization',{method:'POST',token:rawViewer,body:{organizationId:a.organizationId}})).data.tokens.accessToken;
  const ownId=new ObjectId(),foreignId=new ObjectId(),legacyId=new ObjectId();
  const base={referenceNumber:'SYNTHETIC-SHARED-REFERENCE',date:new Date('2026-09-22'),amount:100,type:'支出',status:'completed',notes:'Synthetic shared note',hasReceipt:false,timeline:[]};
  await db.collection('transactions').insertMany([{...base,_id:ownId,organizationId:group,hasReceipt:true},{...base,_id:foreignId,organizationId:foreignGroup,amount:900},{...base,_id:legacyId,amount:800}]);
  const protectedRows=await db.collection('transactions').find({_id:{$in:[foreignId,legacyId]}}).toArray();
  const create=(access,extra={})=>call('/api/transactions',{method:'POST',token:access,body:{date:'2026-09-22',amount:123,type:'支出',notes:'Synthetic manual record',...extra}});
  const created=await create(member,{organizationId:b.organizationId});assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.data.organizationId,a.organizationId);
  pass('transaction creation uses the selected company even when the client supplies another group');
  const ownIds=[String(ownId),String(created.data._id)].sort();
  for(const access of [a.token,member,viewer]){
    const list=await call('/api/transactions?organizationId='+b.organizationId,{token:access});assert.equal(list.status,200);assert.deepEqual(list.data.transactions.map(t=>t._id).sort(),ownIds);
    assert.equal((await call('/api/transactions/'+ownId,{token:access})).status,200);
    const stats=await call('/api/transactions/stats',{token:access});assert.equal(stats.status,200);assert.equal(stats.data.total.count,2);assert.equal(stats.data.total.amount,223);assert.equal(stats.data.receiptMatchRate,0.5);
    assert.equal((await call('/api/transactions?stats=true',{token:access})).data.stats.total.count,2);
    const exported=await call('/api/transactions/export?format=json',{token:access});assert.equal(exported.status,200);assert(JSON.stringify(exported.data).includes(String(ownId)));assert(!JSON.stringify(exported.data).includes(String(foreignId)));
  }
  assert.deepEqual((await call('/api/transactions?hasReceipt=true',{token:member})).data.transactions.map(t=>t._id),[String(ownId)]);
  pass('members share list, detail, filters, both statistics endpoints and export with company-scoped aggregates');
  for(const target of [foreignId,legacyId]){
    for(const method of ['GET','PATCH','DELETE'])assert.equal((await call('/api/transactions/'+target,{token:member,method,body:method==='PATCH'?{notes:'Foreign edit'}:undefined})).status,404);
    assert.equal((await call('/api/transactions/'+target+'/status',{method:'PATCH',token:member,body:{status:'pending'}})).status,404);
  }
  const patch=await call('/api/transactions/'+ownId,{method:'PATCH',token:member,body:{notes:'Member edit',organizationId:b.organizationId}});
  assert.equal(patch.status,200);assert.equal(patch.data.organizationId,a.organizationId);
  pass('single-record edits, status and deletion exclude foreign/unassigned rows and cannot move company scope');
  for(const [url,method,body]of [['/api/transactions','POST',{date:'2026-09-22',amount:1}],['/api/transactions/'+ownId,'PATCH',{notes:'Denied'}],['/api/transactions/'+ownId,'DELETE'],['/api/transactions/'+ownId+'/status','PATCH',{status:'pending'}],['/api/transactions/import','POST',{data:[]}],['/api/transactions/bulk','POST',{action:'delete',ids:[String(ownId)]}],['/api/transactions/duplicates','POST',{action:'delete',deleteIds:[String(ownId)]}]])assert.equal((await call(url,{token:viewer,method,body})).status,403,url);
  const bulkRead=await call('/api/transactions/bulk',{token:viewer,method:'POST',body:{action:'export',ids:[String(ownId),String(foreignId),String(legacyId)]}});
  assert.equal(bulkRead.status,200);assert.deepEqual(bulkRead.data.transactions.map(t=>t._id),[String(ownId)]);
  assert.equal((await call('/api/transactions/import-preview',{token:viewer,method:'POST',body:{supplierNames:[],customerNames:[]}})).status,200);
  assert.equal((await call('/api/transactions/import-preview',{method:'POST',body:{}})).status,401);
  pass('viewers can preview and export, including POST bulk export, while every scoped write is denied');
  for(const [action,data]of [['update_status',{status:'processing'}],['add_tag',{tag:'shared'}],['remove_tag',{tag:'shared'}],['add_note',{note:'Scoped note',appendNote:false}]]){
    const result=await call('/api/transactions/bulk',{method:'POST',token:member,body:{action,ids:[String(ownId),String(foreignId),String(legacyId)],data}});
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.succeeded,1);assert.equal(result.data.failed,2);
  }
  assert.deepEqual(await db.collection('transactions').find({_id:{$in:[foreignId,legacyId]}}).toArray(),protectedRows);
  pass('mixed-ID bulk edits update only current-company records and report actual successes');
  const duplicate=(await create(member,{notes:'Own duplicate',tags:['merge-tag']})).data._id;
  const groups=await call('/api/transactions/duplicates',{token:viewer});assert.equal(groups.status,200);
  assert(groups.data.groups.every(g=>g.transactions.every(t=>![String(foreignId),String(legacyId)].includes(t.id))));
  const merge=await call('/api/transactions/duplicates',{method:'POST',token:member,body:{action:'merge',keepId:created.data._id,deleteIds:[duplicate,String(foreignId),created.data._id]}});
  assert.equal(merge.status,200,JSON.stringify(merge));assert.equal(merge.data.deleted,1);
  assert(await db.collection('transactions').findOne({_id:new ObjectId(created.data._id)}));
  assert.equal((await call('/api/transactions/duplicates',{method:'POST',token:member,body:{action:'merge',keepId:String(foreignId),deleteIds:[String(ownId)]}})).status,404);
  const ignored=await call('/api/transactions/duplicates',{method:'POST',token:member,body:{action:'ignore',transactionIds:[String(ownId),created.data._id,String(foreignId)]}});assert.equal(ignored.status,200);
  const own=await db.collection('transactions').findOne({_id:ownId});assert.deepEqual(own.metadata.ignoredDuplicates,[created.data._id]);
  pass('duplicate listing/merge/ignore stay within the company and merge preserves its kept record');
  const removable=(await create(member)).data._id;
  const removed=await call('/api/transactions/duplicates',{method:'POST',token:member,body:{action:'delete',deleteIds:[removable,String(foreignId)]}});assert.equal(removed.status,200);assert.equal(removed.data.deleted,1);
  const bulkRemoved=await call('/api/transactions/bulk',{method:'POST',token:member,body:{action:'delete',ids:[String(ownId),String(foreignId)]}});assert.equal(bulkRemoved.status,200);assert.equal(bulkRemoved.data.succeeded,1);
  assert.deepEqual(await db.collection('transactions').find({_id:{$in:[foreignId,legacyId]}}).toArray(),protectedRows);
  pass('duplicate and bulk deletion preserve foreign and unassigned records');
  const payload={data:[{date:'2026-09-22',amount:900,notes:'Synthetic shared note',organizationId:b.organizationId}],options:{skipDuplicates:true}};
  const imported=await call('/api/transactions/import',{method:'POST',token:member,body:payload});assert.equal(imported.status,200,JSON.stringify(imported));assert.equal(imported.data.results.imported,1);assert.equal(imported.data.transactions[0].organizationId,a.organizationId);
  const replay=await call('/api/transactions/import',{method:'POST',token:member,body:payload});assert.equal(replay.data.results.skipped,1);assert.equal(replay.data.results.imported,0);
  pass('manual JSON import assigns company and duplicate checks do not skip another company purchase');
  const bank=async(access,save)=>{
    const form=new FormData();form.append('file',new Blob(['<OFX><STMTTRN><TRNTYPE>DEBIT\n<DTPOSTED>20260922\n<TRNAMT>-321\n<FITID>SYNTHETIC-BANK-ID\n<NAME>Synthetic bank shop\n<MEMO>Bank memo\n</STMTTRN></OFX>']),'synthetic.ofx');form.append('save',String(save));
    const response=await fetch(origin+'/api/import/bank-statement',{method:'POST',headers:{Authorization:'Bearer '+access},body:form});return {status:response.status,data:await response.json()};
  };
  assert.equal((await bank(viewer,false)).data.saved,0);assert.equal((await bank(viewer,true)).status,403);
  assert.equal((await bank(b.token,true)).data.saved,1);assert.equal((await bank(member,true)).data.saved,1);assert.equal((await bank(member,true)).data.saved,0);
  const bankRow=await db.collection('transactions').findOne({organizationId:group,referenceNumber:'SYNTHETIC-BANK-ID'});assert(bankRow);assert.equal(bankRow.type,'支出');assert.equal(bankRow.companyInfo,'Synthetic bank shop');assert.equal(bankRow.amount,321);
  pass('bank preview remains read-only and OFX saving persists canonical fields with company-local duplicate references');
  await db.collection('organizations').updateOne({_id:group,'members.userId':memberId},{$set:{'members.$.role':'viewer'}});
  assert.equal((await call('/api/transactions',{token:member})).status,200);
  assert.equal((await create(member)).status,403);
  await db.collection('organizations').updateOne({_id:group},{$pull:{members:{userId:memberId}}});
  assert.equal((await call('/api/transactions',{token:member})).status,403);
  assert.deepEqual(await db.collection('transactions').find({_id:{$in:[foreignId,legacyId]}}).toArray(),protectedRows);
  pass('demotion and removal apply to transaction requests with an older token without changing protected records');
};

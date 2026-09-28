const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),{randomBytes}=require('node:crypto');
module.exports=async({db,call,token,other,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),organizationId=new ObjectId(claims.organizationId),owner=new ObjectId(claims.userId);
 const foreignClaims=JSON.parse(Buffer.from(other.split('.')[1],'base64url'));
 const row={_id:new ObjectId(),organizationId,date:new Date('2026-09-22'),amount:67000,type:'支出',status:'completed',notes:'SyntheticLifecycle deleted',tags:['deleted-only'],manualCreate:{key:randomBytes(16).toString('hex'),payloadHash:'a'.repeat(64),schemaVersion:1,createdBy:owner}};
 const old=JSON.parse(JSON.stringify(row)),live={_id:new ObjectId(),organizationId,date:row.date,amount:10,type:'支出',status:'completed',notes:'SyntheticLifecycle active',tags:['active-only']};
 await db.collection('transactions').insertMany([row,live]);
 assert.equal((await call('/api/transactions/'+row._id,{method:'DELETE',token:other})).status,403);
 assert.equal((await call('/api/transactions/'+row._id,{method:'DELETE',token})).status,200);
 const deleted=await db.collection('transactions').findOne({_id:row._id});assert.ok(deleted.deletedAt);assert.deepEqual(deleted.manualCreate,row.manualCreate);
 assert.equal((await call('/api/transactions/'+row._id,{method:'DELETE',token})).status,200);
 assert.equal((await call('/api/transactions/'+row._id,{token})).status,404);
 const list=await call('/api/transactions',{token});assert.equal(list.status,200);assert.deepEqual(list.data.transactions.map(r=>r._id),[String(live._id)]);
 const stats=await call('/api/transactions/stats',{token});assert.equal(stats.status,200);assert.deepEqual(stats.data.total,{count:1,amount:10});
 pass('keyed HTTP deletion retains identity while list detail and company totals exclude the deleted record');

 const updated=await call('/api/transactions/'+live._id,{method:'PUT',token,body:{notes:'SyntheticLifecycle corrected',manualCreate:row.manualCreate,deletedAt:new Date().toISOString()}});
 assert.equal(updated.status,200);assert.equal((await db.collection('transactions').findOne({_id:live._id})).manualCreate,undefined);
 const bulk=await call('/api/transactions/bulk',{method:'POST',token,body:{action:'update_status',ids:[String(row._id)],data:{status:'failed'}}});assert.equal(bulk.status,200);assert.equal(bulk.data.succeeded,0);
 const exported=await call('/api/transactions/bulk',{method:'POST',token,body:{action:'export',ids:[String(row._id),String(live._id)]}});assert.equal(exported.data.transactions.length,1);
 pass('ordinary metadata bulk updates and export cannot mutate or expose deleted manual rows');

 for(const [url,verify]of [
  ['/api/analytics?range=custom&dateFrom=2026-09-01&dateTo=2026-09-30',r=>{assert.equal(r.keyMetrics.totalTransactions.count,1);assert.equal(r.keyMetrics.totalTransactions.value,10)}],
  ['/api/reports?type=yearly&year=2026',r=>{assert.equal(r.summary.transactions.total,1);assert.equal(r.summary.transactions.totalAmount,10)}],
  ['/api/reports/tax?year=2026',r=>assert.equal(r.summary.transactionCount,1)],
  ['/api/search?q=SyntheticLifecycle&type=transactions',r=>assert.equal(r.total,1)],
  ['/api/tags',r=>assert.deepEqual(r.tags.map(t=>t.tag),['active-only'])]
 ]){const response=await call(url,{token});assert.equal(response.status,200,url+' '+JSON.stringify(response.data));verify(response.data)}
 pass('built analytics reports tax search and tag aggregations exclude retained deletion markers');

 const backup=await call('/api/backup?receipts=false&recurring=false&templates=false',{token});assert.equal(backup.status,200);
 const archive=typeof backup.data==='string'?JSON.parse(backup.data):backup.data;assert.equal(archive.transactions.length,2);assert.ok(archive.transactions.find(r=>r.id===String(row._id)).manualCreate);
 const missing={...old,_id:String(new ObjectId()),manualCreate:{...old.manualCreate,key:randomBytes(16).toString('hex')}};
 const payload={data:{version:'1.0',application:'ohmyfinance',transactions:[old,missing,JSON.parse(JSON.stringify(live))]},receipts:false,recurringPayments:false,mappingTemplates:false,clearExisting:true,skipDuplicates:false};
 const restored=await call('/api/backup/restore',{method:'POST',token,body:payload});assert.equal(restored.status,200,JSON.stringify(restored.data));assert.equal(restored.data.results.transactions.restored,1);assert.equal(restored.data.results.transactions.skipped,2);
 assert.ok((await db.collection('transactions').findOne({_id:row._id})).deletedAt);assert.ok(await db.collection('transactions').findOne({_id:new ObjectId(missing._id)}));
 assert.equal((await db.collection('transactions').findOne({_id:live._id})).notes,'SyntheticLifecycle corrected');
 pass('archive restore preserves original IDs current edits and a newer deletion over an older snapshot');

 const count=await db.collection('transactions').countDocuments({});
 const invalid={...payload,data:{...payload.data,transactions:[{...missing,organizationId:foreignClaims.organizationId||String(new ObjectId())}]}};
 const denied=await call('/api/backup/restore',{method:'POST',token,body:invalid});assert.equal(denied.status,409);assert.equal(await db.collection('transactions').countDocuments({}),count);
 await db.collection('organizations').updateOne({_id:organizationId,'members.userId':owner},{$set:{'members.$.role':'viewer'}});
 try{assert.equal((await call('/api/backup/restore',{method:'POST',token,body:payload})).status,403);assert.equal(await db.collection('transactions').countDocuments({}),count)}
 finally{await db.collection('organizations').updateOne({_id:organizationId,'members.userId':owner},{$set:{'members.$.role':'owner'}})}
 pass('archive company and live viewer membership checks run before destructive changes');

 const sourceRows=Array.from({length:3},(_,i)=>({_id:new ObjectId(),organizationId,date:row.date,amount:22,type:'支出',status:'completed',metadata:{financeEntryId:'synthetic-preserved-'+i}}));await db.collection('transactions').insertMany(sourceRows);
 const before=await db.collection('transactions').find({'metadata.financeEntryId':{$exists:true}}).toArray();
 const scoped=await call('/api/transactions',{token});assert.equal(scoped.status,200);assert.equal(scoped.data.transactions.length,5);
 assert.deepEqual(await db.collection('transactions').find({'metadata.financeEntryId':{$exists:true}}).toArray(),before);
 pass('unkeyed imported occurrences remain separate unchanged ledger records');
};

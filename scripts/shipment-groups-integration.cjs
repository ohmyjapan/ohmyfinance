const assert=require('node:assert/strict'),{ObjectId}=require('mongodb');
const group=require('./helpers/group-session.cjs'),storeFactory=require('./helpers/shipment-store.cjs');
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
module.exports=async({db,call,token,other,origin,pass})=>{
 const a=await group(call,token,'Shipment company A'),b=await group(call,token,'Shipment company B'),ga=new ObjectId(a.organizationId),gb=new ObjectId(b.organizationId),owner=new ObjectId(claims(token).userId),peer=new ObjectId(claims(other).userId);
 const own=new ObjectId(),otherTx=new ObjectId(),legacy=new ObjectId(),record={date:new Date('2026-09-22'),amount:67000,type:'支出',status:'completed',cardAccounting:{preserve:true},notes:'Reviewed purchase',timeline:[]};
 await db.collection('transactions').insertMany([{...record,_id:own,organizationId:ga},{...record,_id:otherTx,organizationId:gb},{...record,_id:legacy}]);
 const ledgerBefore=await db.collection('transactions').find().sort({_id:1}).toArray();
 const req=(path='',method='GET',body,auth=a.token)=>call('/api/shipments'+path,{method,body,token:auth});
 assert.equal((await call('/api/shipments')).status,401);assert.equal((await req('','GET',undefined,token)).status,403);
 const created=await req('','POST',{trackingNumber:'SYNTHETIC-A',transactionIds:[String(own)],organizationId:b.organizationId,createdBy:String(peer)});assert.equal(created.status,200,JSON.stringify(created));const id=created.data.id;
 assert.equal(created.data.organizationId,a.organizationId);assert.equal(created.data.createdBy,String(owner));assert.deepEqual(created.data.transactionIds,[String(own)]);
 const foreign=(await req('','POST',{trackingNumber:'SYNTHETIC-B',transactionIds:[String(otherTx)]},b.token)).data.id;
 const unassigned=new ObjectId();await db.collection('shipments').insertOne({_id:unassigned,trackingNumber:'UNASSIGNED',status:'pending',transactionIds:[own]});
 assert.deepEqual((await req()).data.shipments.map(x=>x.id),[id]);assert.equal((await req('?stats=true')).data.stats.total,1);
 assert.deepEqual((await req('?transactionId='+own)).data.shipments.map(x=>x.id),[id]);assert.equal((await req('?transactionId='+otherTx)).status,404);
 for(const target of [foreign,String(unassigned)])for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal((await req('/'+target,method,method==='GET'?undefined:{notes:'Foreign'})).status,404);
 pass('shipment CRUD lists totals and transaction filters stay within the selected company');

 const before=await db.collection('shipments').findOne({_id:new ObjectId(id)});
 for(const invalid of [otherTx,legacy,new ObjectId()])for(const [path,method,body]of [['','POST',{transactionIds:[String(own),String(invalid)]}],['/'+id,'PATCH',{transactionIds:[String(own),String(invalid)]}],['/'+id+'/transactions','POST',{transactionIds:[String(own),String(invalid)]}]])assert.equal((await req(path,method,body)).status,404);
 assert.deepEqual(await db.collection('shipments').findOne({_id:new ObjectId(id)}),before);
 assert.equal((await req('/'+id+'/transactions','POST',{transactionIds:['invalid']})).status,400);
 await db.collection('shipments').updateOne({_id:new ObjectId(id)},{$addToSet:{transactionIds:{$each:[otherTx,legacy]}}});
 for(const response of [(await req('/'+id)),(await req('/'+id+'/update-status','POST',{status:'processing'}))]){
  const row=response.data.shipment||response.data;assert.equal(response.status,200);assert.deepEqual(row.transactionIds,[String(own)]);assert.deepEqual(row.transactions.map(t=>t._id),[String(own)]);
 }
 await req('/'+id+'/transactions','DELETE',{transactionIds:[String(otherTx),String(legacy)]});
 pass('mixed foreign links fail before writing and polluted legacy references do not disclose foreign purchases');

 await db.collection('organizations').updateOne({_id:ga},{$push:{members:{userId:peer,role:'member',joinedAt:new Date()}}});
 const switched=await call('/api/auth/switch-organization',{token:other,method:'POST',body:{organizationId:a.organizationId}});assert.equal(switched.status,200);const memberToken=switched.data.tokens.accessToken;
 const store=storeFactory({authHeader:{Authorization:'Bearer '+memberToken},fetch:async(path,options={})=>{
  assert.equal(options.headers.Authorization,'Bearer '+memberToken);const result=await call(path,{method:options.method||'GET',body:options.body,token:memberToken});if(result.status>=400)throw Error(result.data.statusMessage);return result.data;
 }});
 await store.fetchShipments();assert.equal(store.shipments.length,1);assert.equal(store.stats.total,1);await store.fetchShipmentById(id);assert.equal(store.currentShipment.id,id);
 const sibling=await store.createShipment({trackingNumber:'SYNTHETIC-SPLIT',transactionIds:[String(own)]});assert(sibling?.id);assert.equal(sibling.createdBy,String(peer));
 assert.equal((await req('?transactionId='+own)).data.total,2);
 await store.updateShipment(sibling.id,{notes:'Shared member edit',organizationId:b.organizationId});assert.equal(store.shipments.find(s=>s.id===sibling.id).organizationId,a.organizationId);
 await store.updateShipmentStatus(sibling.id,'shipped','Packed');assert.equal(store.shipments.find(s=>s.id===sibling.id).status,'shipped');
 const scan={title:'Scanned',location:'Tokyo'};await store.addTrackingEvent(sibling.id,scan);const scanned=await db.collection('shipments').findOne({_id:new ObjectId(sibling.id)});await store.addTrackingEvent(sibling.id,scan);assert.deepEqual(await db.collection('shipments').findOne({_id:new ObjectId(sibling.id)}),scanned);
 pass('the real Pinia store creates reads edits and tracks shared shipments through the freshly built API');

 const links='/'+id+'/transactions',secondTx=new ObjectId();await db.collection('transactions').insertOne({...record,_id:secondTx,organizationId:ga});
 const all=await Promise.all(Array.from({length:5},()=>req(links,'POST',{transactionIds:[String(secondTx)]})));assert(all.every(r=>r.status===200));const linked=await db.collection('shipments').findOne({_id:new ObjectId(id)});assert.equal(linked.transactionIds.length,2);
 await req(links,'POST',{transactionIds:[String(secondTx)]});assert.deepEqual(await db.collection('shipments').findOne({_id:new ObjectId(id)}),linked);
 await req(links,'DELETE',{transactionIds:[String(own)]});assert.deepEqual((await req('?transactionId='+own)).data.shipments.map(s=>s.id),[sibling.id]);
 assert.equal((await req('/'+id,'DELETE',{})).status,200);assert.deepEqual((await req('/'+sibling.id)).data.transactionIds,[String(own)]);
 pass('concurrent link retries keep one edge and split shipments remain independent through unlink and deletion');

 const tracking='/'+sibling.id+'/tracking';assert.equal((await req(tracking,'POST',{title:'No request id'})).status,400);
 assert.equal((await req(tracking,'POST',{...scan,location:'Changed'})).status,409);
 assert.equal((await req(tracking,'GET')).status,405);assert.equal((await req('/invalid')).status,400);
 await req('/'+sibling.id+'/update-status','POST',{status:'delivered'});await req(tracking,'POST',scan);assert.equal((await req('/'+sibling.id)).data.status,'delivered');
 pass('tracking identity rejects conflicting replay and does not overwrite a newer shipment status');

 await require('./shipment-pages-integration.cjs')({db,call,token:memberToken,organizationId:a.organizationId,id:sibling.id,purchaseId:own,origin,pass});
 await db.collection('organizations').updateOne({_id:ga,'members.userId':peer},{$set:{'members.$.role':'viewer'}});
 for(const path of ['', '?stats=true', '/'+sibling.id])assert.equal((await req(path,'GET',undefined,memberToken)).status,200);
 const writes=[['','POST',{}],['/'+sibling.id,'PATCH',{notes:'Denied'}],['/'+sibling.id,'PUT',{notes:'Denied'}],['/'+sibling.id,'DELETE',{}],['/'+sibling.id+'/update-status','POST',{status:'pending'}],['/'+sibling.id+'/transactions','POST',{transactionIds:[String(own)]}],['/'+sibling.id+'/transactions','DELETE',{transactionIds:[String(own)]}],['/'+sibling.id+'/tracking','POST',{requestId:'denied',title:'Denied'}]];
 for(const [path,method,body]of writes)assert.equal((await req(path,method,body,memberToken)).status,403);
 for(const role of ['owner','admin','member']){await db.collection('organizations').updateOne({_id:ga,'members.userId':peer},{$set:{'members.$.role':role}});assert.equal((await req('/'+sibling.id,'PATCH',{notes:'Allowed '+role},memberToken)).status,200);}
 await db.collection('organizations').updateOne({_id:ga},{$pull:{members:{userId:peer}}});assert.equal((await req('/'+sibling.id,'GET',undefined,memberToken)).status,403);
 await db.collection('organizations').updateOne({_id:ga},{$set:{isActive:false}});assert.equal((await req()).status,403);
 assert.deepEqual(await db.collection('transactions').find({_id:{$in:[own,otherTx,legacy]}}).sort({_id:1}).toArray(),ledgerBefore);
 pass('current roles removal and inactive groups apply to every shipment write while all original ledger records remain unchanged');
};

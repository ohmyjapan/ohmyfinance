const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const key=()=>randomBytes(16).toString('hex'),oid=()=>String(new mongoose.Types.ObjectId());
const access={organizationId:oid(),userId:oid(),role:'owner'},other={organizationId:oid(),userId:oid(),role:'member'};
const body={date:'2026-09-22',amount:67000,notes:'Synthetic manual purchase'};
let mongo,loaded,Transaction,Receipt,manual,transactions,archive;
before(async()=>{
 const binary=path.join(__dirname,'../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
 loaded=await require('./helpers/manual-transaction-service.cjs')(mongo.getUri('manual_save_recovery'));
 ({Transaction,Receipt,manual,transactions,archive}=loaded);
});
after(async()=>{if(loaded)await loaded.close();if(mongo)await mongo.stop()});
beforeEach(async()=>{await Transaction.deleteMany({});await Receipt.deleteMany({})});
const create=(request=key(),input=body,scope=access)=>manual.createManualTransaction(scope,request,input);
const read=request=>manual.reconcileManualTransaction(access,request);
const stored=request=>Transaction.findOne({'manualCreate.key':request,organizationId:access.organizationId}).select('+manualCreate').lean();

test('manual canonicalization normalizes defaults selections and dates while preserving zeros and item order',()=>{
 const canonical=manual.canonicalManualPurchase;
 const a=canonical({...body,amount:0,taxRate:0,items:[{unitPrice:0},{productName:'second',unitPrice:10}]});
 const b=canonical({items:[{quantity:'1',unitPrice:'0',taxRate:null},{unitPrice:'10',productName:'second'}],notes:body.notes,status:'pending',type:'支出',date:'2026-09-22T09:00:00+09:00',amount:'0',taxRate:'0',tags:[],customerId:null});
 assert.equal(a.payloadHash,b.payloadHash);
 assert.equal(a.payload.amount,0);assert.equal(a.payload.taxRate,0);assert.equal(a.payload.items[0].unitPrice,0);
 assert.notEqual(a.payloadHash,canonical({...a.payload,items:[...a.payload.items].reverse()}).payloadHash);
 assert.notEqual(a.payloadHash,canonical({...a.payload,taxRate:null}).payloadHash);
 const ref=oid();assert.equal(canonical({...body,customerId:ref}).payloadHash,canonical({...body,customerId:ref.toUpperCase()}).payloadHash);
});

test('manual invalid or server-owned payloads and malformed keys never insert',async()=>{
 for(const input of [null,[],{...body,amount:null},{...body,amount:true},{...body,amount:' '},{...body,amount:Infinity},{...body,date:'2026-02-30'}, {...body,date:'2026-09-22T09:00:00'}, {...body,status:'unknown'},{...body,customerId:'bad'},{...body,items:[{unitPrice:1,path:'forged'}]}, {...body,tags:[false]}])await assert.rejects(create(key(),input),e=>e.statusCode===400);
 for(const field of ['_id','manualCreate','deletedAt','organizationId','metadata','cardAccounting','timeline','attachments','hasReceipt','receiptFilePath','createdAt','notes.x','$set'])await assert.rejects(create(key(),{...body,[field]:'forged'}),e=>e.statusCode===400);
 for(const value of ['',undefined,'A'.repeat(32),'a'.repeat(31),'a'.repeat(33),['a'.repeat(32)]])await assert.rejects(manual.createManualTransaction(access,value,body),e=>e.statusCode===400);
 assert.equal(await Transaction.countDocuments({}),0);
});

test('concurrent manual saves share one identity and one event while equal purchases stay separate',async()=>{
 const request=key(),results=await Promise.all(Array.from({length:16},()=>create(request)));
 assert.equal(new Set(results.map(r=>r.transactionId)).size,1);assert.ok(results.every(r=>r.state==='saved'));
 const row=await stored(request);assert.equal(row.timeline.length,1);assert.equal(String(row.manualCreate.createdBy),access.userId);
 await create(key());await create(request,body,other);
 assert.equal(await Transaction.countDocuments({}),3);
 assert.equal(results[0].transaction.manualCreate,undefined);
});

test('same key with changed original purchase conflicts including competing first writers',async()=>{
 const request=key(),results=await Promise.allSettled([create(request),create(request,{...body,amount:1})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
 assert.equal(await Transaction.countDocuments({}),1);
});

test('lost acknowledgement after insert remains recoverable with the identical manual key',async()=>{
 const request=key(),original=Transaction.prototype.save;
 Transaction.prototype.save=async function(...args){await original.apply(this,args);throw Error('Synthetic response lost after write')};
 try{await assert.rejects(create(request),/response lost/)}finally{Transaction.prototype.save=original}
 const reconciled=await read(request),retried=await create(request);
 assert.equal(reconciled.state,'saved');assert.equal(retried.transactionId,reconciled.transactionId);
 assert.equal(await Transaction.countDocuments({}),1);assert.equal((await stored(request)).timeline.length,1);
});

test('failure before insertion and absent observation retry the original key without claiming cancellation',async()=>{
 const request=key(),original=Transaction.prototype.save;
 Transaction.prototype.save=async()=>{throw Error('Synthetic storage unavailable')};
 try{await assert.rejects(create(request),/storage unavailable/)}finally{Transaction.prototype.save=original}
 assert.deepEqual(await read(request),{state:'absent'});
 assert.equal((await create(request)).state,'saved');assert.equal(await Transaction.countDocuments({}),1);
});

test('manual replay returns current edits and evidence to another group member without rewriting the original event',async()=>{
 const request=key(),created=await create(request);
 await transactions.updateTransaction(access,created.transactionId,{notes:'Reviewed correction'});
 await Receipt.create({organizationId:access.organizationId,transactionId:created.transactionId,filename:'synthetic.pdf',originalFilename:'synthetic.pdf',size:1});
 const result=await create(request,body,{...access,userId:other.userId,role:'member'});
 assert.equal(result.transaction.notes,'Reviewed correction');assert.equal(result.transaction.hasReceipt,true);assert.ok(result.transaction.receipt);
 assert.equal(result.transaction.timeline.length,2);assert.equal(String((await stored(request)).manualCreate.createdBy),access.userId);
 await assert.rejects(create(request,{...body,notes:'Reviewed correction'}),e=>e.statusCode===409);
});

test('deleted manual results are terminal on reconciliation replay and an older archive restore',async()=>{
 const request=key(),created=await create(request),snapshot=JSON.parse(JSON.stringify(await stored(request)));
 await transactions.deleteTransaction(access,created.transactionId);
 await archive.restoreTransactionArchive(access,[snapshot],true);
 assert.deepEqual(await read(request),{state:'deleted',transactionId:created.transactionId});
 assert.deepEqual(await create(request),{state:'deleted',transactionId:created.transactionId});
 assert.equal(await Transaction.countDocuments({}),1);assert.ok((await stored(request)).deletedAt);
 await assert.rejects(create(request,{...body,amount:1}),e=>e.statusCode===409);
});

test('delayed competing insertion cannot resurrect the manual result deleted while it waits',async()=>{
 const request=key(),original=Transaction.prototype.save;let waiting,release;
 const blocked=new Promise(resolve=>waiting=resolve),continueSave=new Promise(resolve=>release=resolve);let once=true;
 Transaction.prototype.save=async function(...args){if(once){once=false;waiting();await continueSave}return original.apply(this,args)};
 try{
  const delayed=create(request);await blocked;assert.deepEqual(await read(request),{state:'absent'});
  const winner=await create(request);await transactions.deleteTransaction(access,winner.transactionId);release();
  assert.deepEqual(await delayed,{state:'deleted',transactionId:winner.transactionId});assert.equal(await Transaction.countDocuments({}),1);
 }finally{release();Transaction.prototype.save=original}
});

test('a fresh server process recovers the original manual transaction from durable storage',async()=>{
 const request=key(),first=await create(request);
 const child=spawnSync(process.execPath,[path.join(__dirname,'helpers/manual-transaction-service.cjs')],{input:JSON.stringify({uri:mongo.getUri('manual_save_recovery'),access,key:request,body}),encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
 assert.equal(result.transactionId,first.transactionId);assert.equal(result.transaction.timeline.length,1);assert.equal(await Transaction.countDocuments({}),1);
});

test('missing or failed identity index blocks manual insertion without an unsafe fallback',async()=>{
 const indexes=await Transaction.collection.indexes(),index=indexes.find(i=>i.key['manualCreate.key']);
 await Transaction.collection.dropIndex(index.name);
 try{await assert.rejects(create(key()),e=>e.statusCode===503);assert.equal(await Transaction.countDocuments({}),0)}
 finally{await Transaction.collection.createIndex(index.key,{unique:true,partialFilterExpression:index.partialFilterExpression})}
 const original=Transaction.init;Transaction.init=async()=>{throw Error('Synthetic index initialization failed')};
 try{await assert.rejects(create(key()),/index initialization failed/);assert.equal(await Transaction.countDocuments({}),0)}finally{Transaction.init=original}
});

test('unrelated duplicate index failures are not reported as successful manual creation',async()=>{
 const request=key(),original=Transaction.prototype.save,error=Object.assign(Error('Synthetic unrelated index'),{code:11000,keyPattern:{referenceNumber:1}});
 Transaction.prototype.save=async function(...args){await original.apply(this,args);throw error};
 try{await assert.rejects(create(request),e=>e===error)}finally{Transaction.prototype.save=original}
 assert.equal((await read(request)).state,'saved');assert.equal(await Transaction.countDocuments({}),1);
});

test('manual insert requests journal acknowledgement and stores the exact canonical purchase',async()=>{
 const request=key(),original=Transaction.collection.insertOne;let options;
 Transaction.collection.insertOne=function(document,opts,...rest){options=opts;return original.call(this,document,opts,...rest)};
 try{await create(request,{...body,amount:'0',taxRate:0,customerId:null})}finally{Transaction.collection.insertOne=original}
 assert.equal(options.w,'majority');assert.equal(options.j,true);
 const row=await stored(request);assert.equal(row.amount,0);assert.equal(row.taxRate,0);assert.equal(row.customerId,undefined);
 assert.equal(row.manualCreate.payloadHash,manual.canonicalManualPurchase({...body,amount:0,taxRate:0}).payloadHash);
});

test('foreign company reconciliation is absent and an unavailable lookup never reports unsaved',async()=>{
 const request=key();await create(request,body,other);assert.deepEqual(await read(request),{state:'absent'});
 const original=Transaction.findOne;Transaction.findOne=()=>{throw Error('Synthetic read outage')};
 try{await assert.rejects(read(request),/read outage/)}finally{Transaction.findOne=original}
});

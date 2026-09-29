const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server'),load=require('./helpers/calendar-service.cjs');
const oid=()=>String(new mongoose.Types.ObjectId()),access={organizationId:oid(),userId:oid(),role:'owner'},other={organizationId:oid(),userId:oid(),role:'member'};
const body={title:'Synthetic calendar payment',amount:1000,currency:'JPY',dueDate:'2026-09-22',type:'expense',category:'Invoice',status:'pending'};
let mongo,loaded,Payment,Transaction,Receipt,service,transactions,archive;
before(async()=>{const binary=path.join(__dirname,'../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});loaded=await load(mongo.getUri('calendar_payment_recovery'));({Payment,Transaction,Receipt,service,transactions,archive}=loaded);});
after(async()=>{if(loaded)await loaded.close();if(mongo)await mongo.stop()});beforeEach(async()=>{await Promise.all([Payment.deleteMany({}),Transaction.deleteMany({}),Receipt.deleteMany({})]);});
const create=(extra={},ctx=access)=>service.createCalendarPayment(ctx,{...body,...extra});
const complete=(p,ctx=access)=>service.completeCalendarPayment(ctx,p.id,p.revision);
const stored=p=>Payment.findById(p.id).select('+posting').lean();
const status=code=>e=>e.statusCode===code;

test('calendar ownership excludes other companies and unassigned history; internal fields cannot be assigned',async()=>{
 const p=await create({organizationId:other.organizationId,createdBy:other.userId,posting:{key:'forged'},_id:oid(),deletedAt:new Date()}),foreign=await create({},other);await Payment.create(body);
 assert.equal(String(p.organizationId),access.organizationId);assert.equal(String(p.createdBy),access.userId);assert.equal(p.posting,undefined);assert.equal(p.completionState,null);
 assert.deepEqual((await service.listCalendarPayments(access)).map(x=>x.id),[p.id]);
 await assert.rejects(service.updateCalendarPayment(access,p.id,null),status(400));await assert.rejects(service.createCalendarPayment(access,null),status(400));
 for(const fn of [()=>service.getCalendarPayment(access,foreign.id),()=>service.updateCalendarPayment(access,foreign.id,{revision:0,amount:2}),()=>service.deleteCalendarPayment(access,foreign.id,0),()=>complete(foreign)])await assert.rejects(fn(),status(404));
 await Payment.updateOne({_id:p.id},{$set:{organizationId:other.organizationId}});assert.equal(String((await stored(p)).organizationId),access.organizationId);
});
test('zero amount and noon calendar date are preserved through confirmed completion',async()=>{
 const p=await create({amount:'0'}),result=await complete(p);assert.equal(result.payment.status,'paid');assert.equal(result.payment.completionState,'posted');assert.equal(result.transaction.amount,0);assert.equal(new Date(result.transaction.date).toISOString(),'2026-09-22T12:00:00.000Z');assert.equal(result.transaction.referenceNumber,'PAY-'+p.id);assert.equal(result.transaction.manualCreate,undefined);assert.equal(result.payment.posting,undefined);
});
test('concurrent calendar completions and repeated old revisions share one transaction and event',async()=>{
 const p=await create(),results=await Promise.all(Array.from({length:8},()=>complete(p)));assert.equal(new Set(results.map(x=>String(x.transaction._id))).size,1);assert.equal(await Transaction.countDocuments({}),1);assert.equal((await Transaction.findOne({})).timeline.length,1);await complete(p);assert.equal(await Transaction.countDocuments({}),1);
});
test('payment and ledger edits survive retry of the original completion snapshot',async()=>{
 const p=await create(),result=await complete(p);await transactions.updateTransaction(access,String(result.transaction._id),{notes:'Reviewed ledger',amount:990});
 const edited=await service.updateCalendarPayment(access,p.id,{revision:result.payment.revision,amount:1200,title:'Changed calendar label',posting:null});const retry=await complete(edited);assert.equal(retry.transaction.notes,'Reviewed ledger');assert.equal(retry.transaction.amount,990);assert.equal(retry.payment.amount,1200);assert.equal((await stored(p)).posting.payload.amount,1000);
});
test('stale edits and deletes cannot win against a newer payment version',async()=>{
 const p=await create();await service.updateCalendarPayment(access,p.id,{revision:p.revision,amount:7});await assert.rejects(service.updateCalendarPayment(access,p.id,{revision:p.revision,amount:8}),status(409));await assert.rejects(service.deleteCalendarPayment(access,p.id,p.revision),status(409));await assert.rejects(complete(p),status(409));assert.equal(await Transaction.countDocuments({}),0);
});
test('failed insert retains the original reservation, blocks conflicting edits and resumes',async()=>{
 const p=await create(),save=Transaction.prototype.save;Transaction.prototype.save=async()=>{throw Error('Synthetic storage failure')};try{await assert.rejects(complete(p),/storage failure/)}finally{Transaction.prototype.save=save}
 const pending=await stored(p);assert.equal(pending.status,'pending');assert.equal(pending.posting.state,'pending');assert.equal(await Transaction.countDocuments({}),0);
 await assert.rejects(service.updateCalendarPayment(access,p.id,{revision:pending.__v,title:'Changed'}),status(409));await assert.rejects(service.deleteCalendarPayment(access,p.id,pending.__v),status(409));await complete(p);assert.equal((await stored(p)).posting.key,pending.posting.key);assert.equal(await Transaction.countDocuments({}),1);
});
test('lost insert acknowledgement followed by reconnect resumes without a second ledger entry',async()=>{
 const p=await create(),save=Transaction.prototype.save;Transaction.prototype.save=async function(...args){await save.apply(this,args);throw Error('Synthetic response loss')};try{await assert.rejects(complete(p),/response loss/)}finally{Transaction.prototype.save=save}
 const pending=await stored(p);await mongoose.disconnect();await mongoose.connect(mongo.getUri('calendar_payment_recovery'));const result=await complete(p);assert.equal(result.payment.status,'paid');assert.equal((await stored(p)).posting.key,pending.posting.key);assert.equal(await Transaction.countDocuments({}),1);
});
test('failure before the paid checkpoint then ledger deletion cannot recreate the purchase',async()=>{
 const p=await create(),update=Payment.updateOne;Payment.updateOne=function(filter,...args){if(filter['posting.state']==='pending')throw Error('Synthetic checkpoint failure');return update.call(this,filter,...args)};
 try{await assert.rejects(complete(p),/checkpoint failure/)}finally{Payment.updateOne=update}
 const tx=await Transaction.findOne({});await transactions.deleteTransaction(access,String(tx._id));await assert.rejects(complete(p),status(409));assert.equal((await stored(p)).posting.state,'deleted');assert.equal(await Transaction.countDocuments({}),1);assert.equal(await Transaction.countDocuments({deletedAt:null}),0);await assert.rejects(complete(p),status(409));
});
test('lost paid-checkpoint response returns the same completed result on retry',async()=>{
 const p=await create(),update=Payment.updateOne;Payment.updateOne=async function(filter,...args){const r=await update.call(this,filter,...args);if(filter['posting.state']==='pending')throw Error('Synthetic lost checkpoint');return r};try{await assert.rejects(complete(p),/lost checkpoint/)}finally{Payment.updateOne=update}
 assert.equal((await stored(p)).status,'paid');await complete(p);assert.equal(await Transaction.countDocuments({}),1);
});
test('calendar deletion retains identity and completion of the deleted payment never inserts',async()=>{
 const p=await create(),result=await complete(p),key=(await stored(p)).posting.key;await service.deleteCalendarPayment(access,p.id,result.payment.revision);assert((await stored(p)).deletedAt);assert.equal((await stored(p)).posting.key,key);assert.deepEqual(await service.listCalendarPayments(access),[]);await assert.rejects(complete(p),status(404));assert.equal(await Transaction.countDocuments({}),1);
 const next=await create({_id:p.id});assert.notEqual(next.id,p.id);
});
test('calendar deletion that wins before reservation prevents the delayed completion',async()=>{
 const p=await create();let release,announce;const gate=new Promise(r=>release=r),entered=new Promise(r=>announce=r),original=Payment.collection.findOneAndUpdate;
 Payment.collection.findOneAndUpdate=async function(...args){announce();await gate;return original.apply(this,args)};
 const op=complete(p);await entered;await service.deleteCalendarPayment(access,p.id,p.revision);release();try{await assert.rejects(op,status(404))}finally{Payment.collection.findOneAndUpdate=original;release()};assert.equal(await Transaction.countDocuments({}),0);
});
test('transaction archive replay preserves a deleted calendar ledger identity',async()=>{
 const p=await create(),result=await complete(p);const snapshot=JSON.parse(JSON.stringify(await Transaction.findById(result.transaction._id).select('+manualCreate').lean()));await transactions.deleteTransaction(access,String(result.transaction._id));await archive.restoreTransactionArchive(access,[snapshot]);await assert.rejects(complete(p),status(409));assert.equal(await Transaction.countDocuments({deletedAt:null}),0);
});
test('old paid, cancelled and foreign currency records never silently create a transaction',async()=>{
 for(const extra of [{status:'paid'},{status:'completed'},{status:'cancelled'},{currency:'USD'}]){const p=await Payment.create({...body,...extra,organizationId:access.organizationId});await assert.rejects(complete({id:String(p._id),revision:0}),status(409));}assert.equal(await Transaction.countDocuments({}),0);
 await assert.rejects(create({status:'paid'}),status(409));const p=await create();await assert.rejects(service.updateCalendarPayment(access,p.id,{revision:0,status:'paid'}),status(409));
});

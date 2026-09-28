const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mongoose=require('mongoose'),ts=require('typescript'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..');
function load(file,imports={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports);return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id(),owner=id();
const access={userId:String(owner),organizationId:String(a),role:'member'},foreign={...access,organizationId:String(b)};
const due='2026-01-31T00:00:00.000Z';
const input={name:'Synthetic subscription',amount:1000,currency:'JPY',frequency:'monthly',startDate:new Date(due),nextDueDate:new Date(due),customer:{name:'Synthetic customer'},autoGenerate:true};
let mongo,Payment,Transaction,service;
before(async()=>{
  const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('recurring_groups'));
  const payment=load('server/models/RecurringPayment.ts',{mongoose}),transaction=load('server/models/Transaction.ts',{mongoose});Payment=payment.default;Transaction=transaction.default;
  service=load('server/services/recurringPaymentService.ts',{mongoose,h3,'../models/RecurringPayment':payment,'../models/Transaction':transaction,'../config/database':{ensureConnection:async()=>assert.equal(mongoose.connection.name,'recurring_groups')}});
  await Promise.all([Payment.init(),Transaction.init()]);
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{await Promise.all([Payment.deleteMany({}),Transaction.deleteMany({})]);});
const create=(ctx=access,extra={})=>service.createRecurringPayment(ctx,{...input,...extra});
const generate=(payment,date=due,ctx=access)=>service.generateTransaction(ctx,String(payment._id),date);
const failStatus=status=>error=>error.statusCode===status;

test('recurring lists totals and upcoming dates exclude foreign and unassigned payments',async()=>{
  const own=await Payment.create({...input,organizationId:a});await Payment.create({...input,organizationId:b});await Payment.create(input);
  assert.deepEqual((await service.getRecurringPayments(access)).map(x=>String(x._id)),[String(own._id)]);
  assert.equal((await service.getRecurringPayments(access))[0].id,String(own._id));
  assert.equal((await service.getRecurringPaymentStats(access)).total,1);
  assert.equal((await service.getRecurringPaymentStats(access)).activeMonthlyAmount,1000);
  assert.equal((await service.getUpcomingPayments(access)).count,1);
});

test('recurring create edit and delete bind company and reject injected internal fields',async()=>{
  const own=await create(access,{organizationId:b,occurrences:[{dueDate:new Date(due),state:'posted'}],generatedTransactionIds:[id()]});
  assert.equal(own.id,String(own._id));assert.equal(String(own.organizationId),String(a));assert.equal(own.occurrences,undefined);assert.equal((await Payment.findById(own._id)).occurrences.length,0);assert.equal(own.generatedTransactionIds.length,0);
  const edited=await service.updateRecurringPayment(access,String(own._id),{organizationId:b,amount:1200,$set:{organizationId:b},occurrences:[],generatedTransactionIds:[id()]});
  assert.equal(String(edited.organizationId),String(a));assert.equal(edited.amount,1200);assert.equal(edited.generatedTransactionIds.length,0);
  await Payment.updateOne({_id:own._id},{$set:{organizationId:b}});assert.equal(String((await Payment.findById(own._id)).organizationId),String(a));
  const other=await create(foreign),legacy=await Payment.create(input);
  for(const p of [other,legacy]){
    assert.equal(await service.getRecurringPaymentById(access,String(p._id)),null);
    for(const fn of [()=>service.updateRecurringPayment(access,String(p._id),{amount:999}),()=>service.deleteRecurringPayment(access,String(p._id)),()=>generate(p)])await assert.rejects(fn,failStatus(404));
  }
  assert.equal(String((await service.deleteRecurringPayment(access,String(own._id)))._id),String(own._id));
});

test('recurring occurrence uses canonical accounting fields and clamps month end',async()=>{
  const p=await create(),result=await generate(p),row=await Transaction.findById(result.transaction._id).lean();
  assert.equal(String(row.organizationId),String(a));assert.equal(row.type,'支出');assert.equal(row.amount,1000);assert.match(row.referenceNumber,/^REC-/);assert.equal(row.date.toISOString(),due);
  assert.equal(row.metadata.recurringPaymentId,String(p._id));assert.equal(row.metadata.recurringDueDate,due);
  assert.equal(result.nextDueDate.toISOString(),'2026-02-28T00:00:00.000Z');
  const second=await generate(p,'2026-02-28T00:00:00.000Z');assert.equal(second.nextDueDate.toISOString(),'2026-03-31T00:00:00.000Z');
});

test('concurrent recurring generation and old retries produce one transaction per occurrence',async()=>{
  const p=await create();const results=await Promise.allSettled(Array.from({length:5},()=>generate(p)));
  assert(results.some(r=>r.status==='fulfilled'));assert(results.every(r=>r.status==='fulfilled'||r.reason.statusCode===409));
  const first=await generate(p);assert.equal(await Transaction.countDocuments(),1);
  await Transaction.updateOne({_id:first.transaction._id},{$set:{notes:'Reviewed accounting',taxRate:10}});
  await generate(p,'2026-02-28T00:00:00.000Z');const repeat=await generate(p);
  assert.equal(String(repeat.transaction._id),String(first.transaction._id));assert.equal(repeat.transaction.notes,'Reviewed accounting');assert.equal(repeat.transaction.taxRate,10);
  const current=await Payment.findById(p._id);assert.equal(current.nextDueDate.toISOString(),'2026-03-31T00:00:00.000Z');assert.equal(current.generatedTransactionIds.length,2);assert.equal(await Transaction.countDocuments(),2);
});

async function interrupted(p,afterWrite=false){
  const original=Transaction.findOneAndUpdate;Transaction.findOneAndUpdate=function(...args){return {lean:async()=>{if(afterWrite)await original.apply(this,args).lean();throw Error('Synthetic interrupted ledger write');}};};
  try{await assert.rejects(generate(p),/Synthetic interrupted/);}finally{Transaction.findOneAndUpdate=original;}
}
test('reserved recurring snapshot survives failure before insertion and protects edits and deletion',async()=>{
  const p=await create();await interrupted(p);assert.equal(await Transaction.countDocuments(),0);
  for(const fn of [()=>service.updateRecurringPayment(access,String(p._id),{amount:8888}),()=>service.deleteRecurringPayment(access,String(p._id))])await assert.rejects(fn,failStatus(409));
  const stored=await Payment.findById(p._id);assert.equal(stored.occurrences[0].state,'reserved');
  const result=await generate(p);assert.equal(result.transaction.amount,1000);assert.equal(await Transaction.countDocuments(),1);
  assert.equal((await service.updateRecurringPayment(access,String(p._id),{amount:2000})).amount,2000);
});

test('recurring failure after durable insertion reconnects and resumes without duplicate or lost review',async()=>{
  const p=await create();await interrupted(p,true);assert.equal(await Transaction.countDocuments(),1);
  await Transaction.updateOne({},{$set:{notes:'Preserved review',invoiceNumber:'Synthetic',taxRate:10}});
  await mongoose.disconnect();await mongoose.connect(mongo.getUri('recurring_groups'));
  const result=await generate(p);assert.equal(result.transaction.notes,'Preserved review');assert.equal(result.transaction.taxRate,10);assert.equal(await Transaction.countDocuments(),1);
  const current=await Payment.findById(p._id);assert.equal(current.occurrences[0].state,'posted');assert.equal(current.generatedTransactionIds.length,1);
});

test('recurring reservations cannot adopt foreign unassigned or unrelated transaction IDs',async()=>{
  for(const organizationId of [a,b,undefined]){
    const p=await create();await interrupted(p);const saved=await Payment.findById(p._id),target=saved.occurrences[0].transactionId;
    await Transaction.create({_id:target,organizationId,date:new Date(due),amount:99,type:'支出',notes:'Protected existing entry'});
    await assert.rejects(generate(p),failStatus(409));assert.equal((await Transaction.findById(target)).notes,'Protected existing entry');
    assert.equal((await Payment.findById(p._id)).occurrences[0].state,'reserved');
  }
});

test('posted recurring occurrence with missing transaction is held instead of regenerated',async()=>{
  const p=await create(),r=await generate(p);await Transaction.deleteOne({_id:r.transaction._id});
  await assert.rejects(generate(p),failStatus(409));assert.equal(await Transaction.countDocuments(),0);
});

test('recurring generation validates due date active state and currency before reserving',async()=>{
  const p=await create();for(const date of [undefined,'invalid','2026-02-01T00:00:00.000Z'])await assert.rejects(service.generateTransaction(access,String(p._id),date),e=>[400,409].includes(e.statusCode));
  await service.updateRecurringPayment(access,String(p._id),{status:'paused'});await assert.rejects(generate(p),failStatus(409));
  await service.updateRecurringPayment(access,String(p._id),{status:'active',currency:'USD'});await assert.rejects(generate(p),failStatus(409));
  assert.equal((await Payment.findById(p._id)).occurrences.length,0);assert.equal(await Transaction.countDocuments(),0);
});

test('recurring batch only processes due active automatic records in the selected company',async()=>{
  const own=await create();await create(foreign);await Payment.create(input);await create(access,{autoGenerate:false});await create(access,{nextDueDate:new Date('2099-01-01')});
  const paused=await create();await service.updateRecurringPayment(access,String(paused._id),{status:'paused'});
  const result=await service.processDuePayments(access);assert.equal(result.processed,1);assert.equal(result.succeeded,1);assert.equal(result.failed,0);
  const rows=await Transaction.find();assert.equal(rows.length,1);assert.equal(rows[0].metadata.recurringPaymentId,String(own._id));
});

test('completed final recurring occurrence is retryable without advancing again',async()=>{
  const p=await create(access,{endDate:new Date(due)});assert.equal((await generate(p)).status,'completed');assert.equal((await generate(p)).status,'completed');assert.equal(await Transaction.countDocuments(),1);
});

test('recurring checkpoint failure resumes and preserves exactly one generated ID',async()=>{
  const p=await create(),original=Payment.updateOne;Payment.updateOne=()=>{throw Error('Synthetic checkpoint outage');};
  try{await assert.rejects(generate(p),/Synthetic checkpoint/);}finally{Payment.updateOne=original;}
  assert.equal(await Transaction.countDocuments(),1);await generate(p);assert.equal(await Transaction.countDocuments(),1);
  assert.equal((await Payment.findById(p._id)).generatedTransactionIds.length,1);
});

test('recurring deletion during reservation cannot leave a new orphan ledger record',async()=>{
  const p=await create(),original=Payment.findOneAndUpdate;let deleted=false;
  Payment.findOneAndUpdate=function(...args){if(args[1]?.$push?.occurrences)return {lean:async()=>{deleted=true;await service.deleteRecurringPayment(access,String(p._id));return original.apply(this,args).lean();}};return original.apply(this,args);};
  try{await assert.rejects(generate(p),failStatus(409));}finally{Payment.findOneAndUpdate=original;}
  assert(deleted);assert.equal(await Transaction.countDocuments(),0);assert.equal(await Payment.countDocuments(),0);
});

test('recurring edit winning the version race cannot post an obsolete payment snapshot',async()=>{
  const p=await create(),original=Payment.findOneAndUpdate;let edited=false;
  Payment.findOneAndUpdate=function(...args){if(args[1]?.$push?.occurrences&&!edited)return {lean:async()=>{edited=true;await service.updateRecurringPayment(access,String(p._id),{amount:2222});return original.apply(this,args).lean();}};return original.apply(this,args);};
  try{await assert.rejects(generate(p),failStatus(409));}finally{Payment.findOneAndUpdate=original;}
  assert(edited);assert.equal(await Transaction.countDocuments(),0);assert.equal((await generate(p)).transaction.amount,2222);
});

test('recurring calendar intervals preserve leap day and explicit day of month',async()=>{
  for(const [frequency,date,dayOfMonth,expected] of [['daily',due,undefined,'2026-02-01'],['weekly',due,undefined,'2026-02-07'],['biweekly',due,undefined,'2026-02-14'],['quarterly',due,31,'2026-04-30'],['yearly','2024-02-29T00:00:00.000Z',undefined,'2025-02-28']]){
    const p=await create(access,{frequency,startDate:new Date(date),nextDueDate:new Date(date),dayOfMonth});assert.equal((await generate(p,date)).nextDueDate.toISOString(),expected+'T00:00:00.000Z');
  }
});

test('recurring page carries the displayed due date and authenticated request into generation',async()=>{
  const calls=[],page=require('./helpers/recurring-page.cjs')({store:{authHeader:{Authorization:'Bearer synthetic'}},fetch:async(url,options)=>{calls.push({url,options});return options?.method==='POST'?{success:true}:[];}});
  try{await page.state.generateNow({id:'synthetic',nextDueDate:due});assert.deepEqual(calls[0],{url:'/api/recurring/synthetic',options:{method:'POST',body:{dueDate:due},headers:{Authorization:'Bearer synthetic'}}});assert.equal(page.alerts[0],'Transaction generated successfully');}finally{page.close();}
});

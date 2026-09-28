const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),mongoose=require('mongoose');
const {createRequire}=require('node:module'),{MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..'),native=createRequire(path.join(root,'package.json')),cache=new Map();
function load(file){
 const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const requireLocal=name=>{
  if(!name.startsWith('.'))return native(name);
  const target=path.resolve(path.dirname(filename),name);
  if(target===path.join(root,'server/config/database'))return {ensureConnection:async()=>assert.equal(mongoose.connection.name,'card_group_regression')};
  if(target===path.join(root,'server/middleware/auth'))return {requireAuth:event=>event.context.auth};
  if(fs.existsSync(target+'.ts'))return load(path.relative(root,target+'.ts'));
  return native(target);
 };
 new Function('require','module','exports','__filename','__dirname',source)(requireLocal,module,module.exports,filename,path.dirname(filename));return module.exports;
}
const oid=()=>new mongoose.Types.ObjectId(),ga=oid(),gb=oid(),owner=oid();
const access={userId:String(owner),organizationId:String(ga),role:'owner'};
let mongo,dir,oldData,service,models,Transaction,Organization,account,serial=0;
const period={kind:'statement',start:'2026-07-19',end:'2026-08-18'};
const csv=(name='Synthetic card purchase',amount=67000)=>{
 const {HEADERS}=native(path.join(root,'shared/amex.mjs'));
 return Buffer.from([HEADERS,['2026/08/01','2026/08/03',name,'Synthetic owner','12345',String(amount),'','']].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
};
before(async()=>{
 const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('card_group_regression'));
 dir=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-card-group-unit-'));oldData=process.env.OMF_DATA_DIR;process.env.OMF_DATA_DIR=dir;
 service=load('server/services/financeService.ts');models=load('server/models/Finance.ts');Transaction=load('server/models/Transaction.ts').default;Organization=load('server/models/Organization.ts').default;
 await models.initializeFinance();
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();if(oldData===undefined)delete process.env.OMF_DATA_DIR;else process.env.OMF_DATA_DIR=oldData;if(dir){assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fsp.rm(dir,{recursive:true,force:true});}});
beforeEach(async()=>{
 await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));
 await Organization.create([{_id:ga,name:'Synthetic A',slug:'a',members:[{userId:owner,role:'owner'}]},{_id:gb,name:'Synthetic B',slug:'b',members:[{userId:owner,role:'owner'}]}]);
 account=(await models.FinancialAccount.create({ownerId:owner,organizationId:ga,name:'Synthetic Amex',provider:'amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'synthetic@example.invalid',otpMailbox:'synthetic@example.invalid'})).toObject();
});
async function source(name='Synthetic source '+(++serial),amount=67000){const result=await service.acceptImport(String(owner),account,csv(name,amount),period);return models.FinanceImport.findById(result.id).lean();}
const post=(batch,extra={})=>service.commitImport(access,String(batch._id),{decisions:[{line:2,action:'import',...extra}]});
async function reserve(batch,extra={}){const row=batch.rows[0];return models.FinanceEntry.create({ownerId:owner,organizationId:ga,accountId:account._id,key:row.key,fingerprint:row.fingerprint,occurrence:row.occurrence,coverage:batch.period.key,importId:batch._id,line:row.line,transactionId:oid(),row,state:'reserved',...extra});}

test('card source company persists and immutable ownership survives duplicate files and edits',async()=>{
 const bytes=csv(),first=await service.acceptImport(String(owner),account,bytes,{...period,organizationId:gb});
 const batch=await models.FinanceImport.findById(first.id);assert.equal(String(batch.organizationId),String(ga));
 assert.equal((await service.acceptImport(String(owner),account,bytes,period)).id,first.id);assert.equal(await models.FinanceImport.countDocuments(),1);
 const entry=await reserve(batch);
 for(const [model,record]of [[models.FinancialAccount,account],[models.FinanceImport,batch],[models.FinanceEntry,entry]]){
  await model.updateOne({_id:record._id},{$set:{organizationId:gb}});const doc=await model.findById(record._id);assert.equal(String(doc.organizationId),String(ga));doc.organizationId=gb;await doc.save();assert.equal(String((await model.findById(record._id)).organizationId),String(ga));
 }
});

test('card historical candidates and linking exclude foreign and unassigned transactions',async()=>{
 const batch=await source();const base={date:new Date('2026-08-01'),amount:67000,type:'支出',status:'completed',notes:'Manual accounting',cardNumber:'2345'};
 const own=await Transaction.create({...base,organizationId:ga}),foreign=await Transaction.create({...base,organizationId:gb}),legacy=await Transaction.create(base);
 const before=await Transaction.find({}).lean();const view=await service.reviewImport(String(owner),String(batch._id));assert.deepEqual(view.rows[0].existing.map(r=>r.id),[String(own._id)]);
 for(const row of [foreign,legacy])await assert.rejects(service.commitImport(access,String(batch._id),{decisions:[{line:2,action:'link',transactionId:String(row._id)}]}),e=>e.statusCode===400);
 const result=await service.commitImport(access,String(batch._id),{decisions:[{line:2,action:'link',transactionId:String(own._id)}]});assert.equal(result.linked,1);assert.deepEqual(await Transaction.find({}).lean(),before);
 assert.equal(String((await models.FinanceEntry.findOne({importId:batch._id})).organizationId),String(ga));
});

test('card posting overrides forged draft company and preserves one transaction across concurrent retries',async()=>{
 const batch=await source();await reserve(batch,{draftSnapshot:{revision:7,transaction:{organizationId:gb,amount:1,type:'入金'},documents:[]}});
 const result=await Promise.allSettled([post(batch,{draftRevision:7}),post(batch,{draftRevision:7})]);assert(result.some(r=>r.status==='fulfilled'));assert(result.every(r=>r.status==='fulfilled'||r.reason.statusCode===409));
 assert.equal((await post(batch,{draftRevision:7})).skipped,1);const transactions=await Transaction.find({}).lean();assert.equal(transactions.length,1);assert.equal(String(transactions[0].organizationId),String(ga));assert.equal(transactions[0].amount,67000);assert.equal(transactions[0].type,'支出');
 const entry=await models.FinanceEntry.findOne({importId:batch._id});assert.equal(String(entry.organizationId),String(ga));assert.equal(entry.state,'posted');
});

test('card reservation cannot adopt another company or unrelated same-company transaction',async()=>{
 for(const organizationId of [gb,ga,undefined]){
  const batch=await source(),target=await Transaction.create({organizationId,date:new Date('2026-08-01'),amount:1,type:'支出',status:'pending',notes:'Do not adopt'}),reserved=await reserve(batch,{transactionId:target._id});
  const before=await Transaction.findById(target._id).lean();
  for(let i=0;i<2;i++)await assert.rejects(post(batch),e=>e.code===11000);
  assert.deepEqual(await Transaction.findById(target._id).lean(),before);assert.equal((await models.FinanceEntry.findById(reserved._id)).state,'reserved');
 }
});

test('card posting resumes after ledger write interruption and database reconnect without duplication',async()=>{
 const batch=await source();const update=models.FinanceEntry.updateOne;let interrupted=false;
 models.FinanceEntry.updateOne=function(filter,change,...rest){if(change?.$set?.state==='posted'&&!interrupted){interrupted=true;throw Error('Synthetic interruption after ledger insert');}return update.call(this,filter,change,...rest);};
 try{await assert.rejects(post(batch),/Synthetic interruption/);}finally{models.FinanceEntry.updateOne=update;}
 const entry=await models.FinanceEntry.findOne({importId:batch._id}).lean(),before=await Transaction.findOne({}).lean();assert.equal(entry.state,'reserved');assert.equal(String(before.organizationId),String(ga));
 await mongoose.disconnect();await mongoose.connect(mongo.getUri('card_group_regression'));
 assert.equal((await post(batch)).posted,1);assert.equal(await Transaction.countDocuments(),1);
 const resumed=await Transaction.findOne({}).lean();assert(resumed.updatedAt>=before.updatedAt);const {updatedAt:oldTimestamp,...oldValues}=before,{updatedAt:newTimestamp,...newValues}=resumed;
 assert.deepEqual(newValues,oldValues);assert.equal((await models.FinanceEntry.findById(entry._id)).state,'posted');
});

test('card source writes require current membership and reviewed account/import company',async()=>{
 const batch=await source();await Organization.updateOne({_id:ga,'members.userId':owner},{$set:{'members.$.role':'viewer'}});
 await assert.rejects(post(batch),e=>e.statusCode===403);await assert.rejects(service.acceptImport(String(owner),account,csv('Denied'),period),e=>e.statusCode===403);
 await Organization.updateOne({_id:ga,'members.userId':owner},{$set:{'members.$.role':'owner'}});
 await models.FinanceImport.collection.updateOne({_id:batch._id},{$set:{organizationId:gb}});await assert.rejects(post(batch),e=>e.statusCode===409);await assert.rejects(service.reviewImport(String(owner),String(batch._id)),e=>e.statusCode===409);
 await models.FinancialAccount.collection.updateOne({_id:account._id},{$unset:{organizationId:''}});await assert.rejects(service.acceptImport(String(owner),account,csv('Unassigned'),period),e=>e.statusCode===409);
 assert.equal(await Transaction.countDocuments(),0);assert.equal(await models.FinanceEntry.countDocuments(),0);
});

test('card already-posted retries reject a lost or foreign ledger target',async()=>{
 const batch=await source();await post(batch);const entry=await models.FinanceEntry.findOne({importId:batch._id});
 await Transaction.collection.updateOne({_id:entry.transactionId},{$set:{organizationId:gb}});await assert.rejects(post(batch),e=>e.statusCode===409);
 await Transaction.deleteOne({_id:entry.transactionId});await assert.rejects(post(batch),e=>e.statusCode===409);assert.equal(await Transaction.countDocuments(),0);
});

test('card source references cannot borrow an earlier file assigned to another company',async()=>{
 const first=await source('Repeated source'),secondResult=await service.acceptImport(String(owner),account,csv('Repeated source'),{kind:'recent',start:'2026-08-01',end:'2026-08-31'});
 assert.equal(secondResult.id,String(first._id));
 const secondBytes=Buffer.from(csv('Repeated source').toString()+'\r\n');const second=await service.acceptImport(String(owner),account,secondBytes,{kind:'recent',start:'2026-08-01',end:'2026-08-31'});
 const batch=await models.FinanceImport.findById(second.id).lean();assert(batch.sourceReferences.groups.length);
 await models.FinanceImport.collection.updateOne({_id:first._id},{$set:{organizationId:gb}});
  await assert.rejects(service.importSourceReferences(batch),e=>e.statusCode===409);
});

test('card imports do not ignore unassigned or mismatched forecast and reservation history',async()=>{
 const batch=await source();await models.FinanceImport.collection.updateOne({_id:batch._id},{$unset:{organizationId:''}});
 await assert.rejects(source('Later statement'),e=>e.statusCode===409);assert.equal(await models.FinanceImport.countDocuments(),1);
 await models.FinanceImport.collection.updateOne({_id:batch._id},{$set:{organizationId:ga}});
 const reserved=await reserve(batch);await models.FinanceEntry.collection.updateOne({_id:reserved._id},{$set:{organizationId:gb}});
 await assert.rejects(source('Later statement'),e=>e.statusCode===409);await assert.rejects(post(batch),e=>e.statusCode===409);
 assert.equal(await Transaction.countDocuments(),0);assert.equal(await models.FinanceImport.countDocuments(),1);
});

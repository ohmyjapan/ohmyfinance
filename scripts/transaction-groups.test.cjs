const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
  const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',source)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports);return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id();
const ctx={organizationId:String(a),userId:String(id()),role:'member'},foreign={...ctx,organizationId:String(b)};
const record={date:new Date('2026-09-22'),amount:67000,type:'支出',status:'completed',notes:'Synthetic purchase',referenceNumber:'SHARED'};
let mongo,Transaction,service,bulk,duplicates,bank;
before(async()=>{
  const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('transaction_group_regression'));
  const model=load('server/models/Transaction.ts',{mongoose});Transaction=model.default;
  for(const name of ['Customer','Supplier','AccountCategory','SubAccountCategory','TaxCategory','TransactionCategory','DataSource'])if(!mongoose.models[name])mongoose.model(name,new mongoose.Schema({name:String}));
  const database={ensureConnection:async()=>assert.equal(mongoose.connection.name,'transaction_group_regression')};
  const links=load('server/services/receiptLinkService.ts',{h3:require('h3'),mongoose,'../models/Receipt':load('server/models/Receipt.ts',{mongoose}),'../models/Transaction':model,'../config/database':database});
  service=load('server/services/transactionService.ts',{'./receiptLinkService':links,'h3':h3,mongoose,'../models/Transaction':model,'../config/database':database});
  const imports={h3:{...h3,defineEventHandler:fn=>fn,readBody:async event=>event.body,getQuery:event=>event.query||{},readMultipartFormData:async event=>event.form},'../../models/Transaction':model,'../../config/database':database,'../../middleware/auth':{requireAuth:event=>event.access},'../../services/transactionService':service,'../../services/ledgerAccessService':{requireLedgerAccess:async(event,mode)=>{if(mode==='write'&&event.access.role==='viewer')throw h3.createError({statusCode:403});return event.access;}}};
  bulk=load('server/api/transactions/bulk.ts',imports).default;duplicates=load('server/api/transactions/duplicates.ts',imports).default;bank=load('server/api/import/bank-statement.ts',imports).default;
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{await Transaction.deleteMany({});});
const create=(access=ctx,extra={})=>service.createTransaction(access,{...record,...extra});
const request=(body,access=ctx)=>({method:'POST',body,access});
const seed=async()=>({own:await create(),other:await create(foreign),legacy:await Transaction.create(record)});

test('transaction list and aggregates exclude other companies and unassigned history',async()=>{
  const {own}=await seed();await create(ctx,{amount:100,hasReceipt:true,type:'入金',status:'pending'});
  assert.equal((await service.getTransactions(ctx)).length,2);
  assert.deepEqual((await service.getTransactions(ctx,{search:'SHARED',type:'支出'})).map(t=>String(t._id)),[String(own._id)]);
  const stats=await service.getTransactionStats(ctx);assert.deepEqual(stats.total,{count:2,amount:67100});assert.equal(stats.expense.amount,67000);assert.equal(stats.income.amount,100);assert.equal(stats.pending.count,1);assert.equal(stats.completed.count,1);assert.equal(stats.receiptMatchRate,0.5);
});

test('transaction creation and edits preserve selected company despite forged ownership',async()=>{
  const own=await create(ctx,{organizationId:b});assert.equal(String(own.organizationId),String(a));
  const edited=await service.updateTransaction(ctx,String(own._id),{organizationId:b,notes:'Member correction'});assert.equal(String(edited.organizationId),String(a));
  await Transaction.updateOne({_id:own._id},{$set:{organizationId:b,notes:'Query correction'}});
  let doc=await Transaction.findById(own._id);assert.equal(String(doc.organizationId),String(a));doc.organizationId=b;await doc.save();doc=await Transaction.findById(own._id);assert.equal(String(doc.organizationId),String(a));
});

test('transaction detail edit delete and receipt linking require the same company',async()=>{
  const {own,other,legacy}=await seed();
  const before=await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean();
  for(const row of [other,legacy]){
    assert.equal(await service.getTransactionById(ctx,String(row._id)),null);
    for(const fn of [()=>service.updateTransaction(ctx,String(row._id),{notes:'Foreign'}),()=>service.deleteTransaction(ctx,String(row._id)),()=>service.linkReceiptToTransaction(ctx,String(row._id),'/synthetic.pdf')])await assert.rejects(fn,/not found/);
  }
  assert.deepEqual(await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean(),before);
  assert.equal((await service.linkReceiptToTransaction(ctx,String(own._id),'/synthetic.pdf')).hasReceipt,true);
  assert.equal(String((await service.deleteTransaction(ctx,String(own._id)))._id),String(own._id));
});

test('mapped transaction import uses company-local references and preserves protected card source',async()=>{
  await create(foreign);
  const mapping={referenceNumber:'referenceNumber',amount:'amount',date:'date',organizationId:'organizationId'};
  const incoming=[{...record,organizationId:b}];
  const first=await service.importTransactions(ctx,incoming,mapping,{skipDuplicates:true});assert.equal(first.imported,1);assert.equal(first.failed,0);
  assert.equal(String((await Transaction.findById(first.transactions[0])).organizationId),String(a));
  assert.equal((await service.importTransactions(ctx,incoming,mapping,{skipDuplicates:true})).skipped,1);
  assert.equal((await service.importTransactions(ctx,[{...record,amount:123}],mapping,{updateMatches:true})).updated,1);
  assert.equal((await Transaction.findById(first.transactions[0])).amount,123);assert.equal((await Transaction.findOne({organizationId:b})).amount,67000);
  await Transaction.updateOne({_id:first.transactions[0]},{$set:{cardAccounting:{preserve:true}}});
  assert.equal((await service.importTransactions(ctx,[{...record,amount:999}],mapping,{updateMatches:true})).failed,1);
  assert.equal((await Transaction.findById(first.transactions[0])).amount,123);
});

test('transaction company scoping survives reconnect and concurrent updates and deletes',async()=>{
  const {own,other}=await seed();const before=await Transaction.findById(other._id).lean();
  await mongoose.disconnect();await mongoose.connect(mongo.getUri('transaction_group_regression'));
  await Promise.all(['One','Two','Three'].map(notes=>service.updateTransaction(ctx,String(own._id),{notes})));
  assert.equal((await Transaction.findById(own._id)).timeline.length,4);
  const result=await Promise.allSettled([service.deleteTransaction(ctx,String(own._id)),service.deleteTransaction(ctx,String(own._id))]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.deepEqual(await Transaction.findById(other._id).lean(),before);
});

test('bulk transaction operations retain valid IDs without touching other companies',async()=>{
  const {own,other,legacy}=await seed(),ids=[own,other,legacy].map(r=>String(r._id));const before=await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean();
  const read=await bulk(request({action:'export',ids},{...ctx,role:'viewer'}));assert.deepEqual(read.transactions.map(t=>String(t._id)),[ids[0]]);
  await assert.rejects(bulk(request({action:'delete',ids},{...ctx,role:'viewer'})),e=>e.statusCode===403);
  for(const [action,data]of [['update_status',{status:'pending'}],['add_tag',{tag:'Synthetic'}],['remove_tag',{tag:'Synthetic'}],['add_note',{note:'Member note'}]]){const result=await bulk(request({action,ids,data}));assert.equal(result.succeeded,1,action);assert.equal(result.failed,2,action);}
  const deleted=await bulk(request({action:'delete',ids}));assert.equal(deleted.succeeded,1);assert.equal(deleted.failed,2);assert.deepEqual(await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean(),before);
});

test('duplicate merge delete and ignore exclude foreign records and preserve kept ID',async()=>{
  const {own,other,legacy}=await seed(),dup=await create(ctx,{notes:'Synthetic duplicate',tags:['merge']});const before=await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean();
  const listing=await duplicates({method:'GET',access:ctx});assert(listing.groups.length);assert(listing.groups.every(g=>g.transactions.every(t=>[String(own._id),String(dup._id)].includes(String(t.id)))));
  await assert.rejects(duplicates(request({action:'merge',keepId:String(other._id),deleteIds:[String(own._id)]})),e=>e.statusCode===404);
  const merged=await duplicates(request({action:'merge',keepId:String(own._id),deleteIds:[own,dup,other,legacy].map(r=>String(r._id))}));assert.equal(merged.deleted,1);assert(await Transaction.findById(own._id));
  const peer=await create();await duplicates(request({action:'ignore',transactionIds:[own,peer,other].map(r=>String(r._id))}));assert.deepEqual((await Transaction.findById(own._id)).metadata.ignoredDuplicates,[String(peer._id)]);
  const deleted=await duplicates(request({action:'delete',deleteIds:[peer,other,legacy].map(r=>String(r._id))}));assert.equal(deleted.deleted,1);assert.deepEqual(await Transaction.find({_id:{$in:[other._id,legacy._id]}}).lean(),before);
});

test('bank statement saving uses stored fields and company-local stable references',async()=>{
  const ofx='<OFX><STMTTRN><TRNTYPE>DEBIT\n<DTPOSTED>20260922\n<TRNAMT>-321\n<FITID>SHARED-BANK\n<NAME>Synthetic bank\n</STMTTRN></OFX>';
  const run=(access,save)=>bank({method:'POST',access,form:[{name:'file',filename:'synthetic.ofx',data:Buffer.from(ofx)},{name:'save',data:Buffer.from(String(save))}]});
  assert.equal((await run({...ctx,role:'viewer'},false)).saved,0);await assert.rejects(run({...ctx,role:'viewer'},true),e=>e.statusCode===403);
  assert.equal((await run(foreign,true)).saved,1);assert.equal((await run(ctx,true)).saved,1);assert.equal((await run(ctx,true)).saved,0);
  const row=await Transaction.findOne({organizationId:a});assert.equal(row.referenceNumber,'SHARED-BANK');assert.equal(row.companyInfo,'Synthetic bank');assert.equal(row.type,'支出');assert.equal(row.amount,321);
});

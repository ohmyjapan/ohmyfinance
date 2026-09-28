const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..'),cache=new Map(),oid=()=>new mongoose.Types.ObjectId();
const access={organizationId:String(oid()),userId:String(oid()),role:'member'},other={...access,organizationId:String(oid())};
const data={date:new Date('2026-09-22'),amount:67000,type:'支出',status:'completed',notes:'Synthetic purchase'};
const identity=()=>({key:require('node:crypto').randomBytes(16).toString('hex'),payloadHash:'a'.repeat(64),schemaVersion:1,createdBy:access.userId});
let mongo,Transaction,Receipt,service,archive,links,bulk,duplicates,backup,restore;
function load(file){
 if(cache.has(file))return cache.get(file);
 const module={exports:{}};cache.set(file,module.exports);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>{
  if(name==='h3')return {...h3,defineEventHandler:fn=>fn,readBody:async e=>e.body,getQuery:e=>e.query||{},setHeader(){}};
  if(name.endsWith('/config/database'))return {ensureConnection:async()=>assert.equal(mongoose.connection.name,'transaction_lifecycle')};
  if(name.endsWith('/services/ledgerAccessService')||name==='./ledgerAccessService')return {requireLedgerAccess:async(e,mode)=>{if(!e.access||mode==='write'&&e.access.role==='viewer')throw h3.createError({statusCode:403});return e.access}};
  if(name.endsWith('/middleware/auth'))return {requireAuth:e=>{if(!e.access)throw h3.createError({statusCode:401});return {userId:e.access.userId,organizationId:e.access.organizationId}}};
  if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
  return require(name);
 },module,module.exports);
 cache.set(file,module.exports);return module.exports;
}
before(async()=>{
 const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('transaction_lifecycle'));
 Transaction=load('server/models/Transaction.ts').default;Receipt=load('server/models/Receipt.ts').default;await Promise.all([Transaction.init(),Receipt.init()]);
 for(const name of ['Customer','Supplier','AccountCategory','SubAccountCategory','TaxCategory','TransactionCategory','DataSource'])if(!mongoose.models[name])mongoose.model(name,new mongoose.Schema({name:String}));
 service=load('server/services/transactionService.ts');archive=load('server/services/transactionArchiveService.ts');links=load('server/services/receiptLinkService.ts');
 bulk=load('server/api/transactions/bulk.ts').default;duplicates=load('server/api/transactions/duplicates.ts').default;
 backup=load('server/api/backup/index.ts').default;restore=load('server/api/backup/restore.ts').default;
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()});
beforeEach(async()=>{await Transaction.collection.deleteMany({});await Receipt.deleteMany({})});
const create=(extra={},scope=access)=>Transaction.create({...data,organizationId:scope.organizationId,...extra});
const request=(body,scope=access)=>({method:'POST',body,access:scope});
const stored=id=>Transaction.findById(id).select('+manualCreate').lean();
const serialized=row=>JSON.parse(JSON.stringify(row));

test('manual identity index coordinates concurrent inserts without collapsing source occurrences',async()=>{
 const manualCreate=identity(),attempts=await Promise.allSettled(Array.from({length:12},()=>create({manualCreate})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(attempts.filter(r=>r.status==='rejected').every(r=>r.reason.code===11000));
 await create({manualCreate},other);await create({manualCreate:identity()});
 await Transaction.insertMany(Array.from({length:3},(_,i)=>({...data,organizationId:access.organizationId,metadata:{financeEntryId:'synthetic-source-'+i}})));
 assert.equal(await Transaction.countDocuments({organizationId:access.organizationId}),5);
 assert.equal(await Transaction.countDocuments({'metadata.financeEntryId':{$exists:true}}),3);
});

test('single delete retains keyed identity through repeat and reconnect while excluding ledger totals',async()=>{
 const row=await create({manualCreate:identity()}),live=await create({amount:100}),foreign=await create({manualCreate:identity()},other);
 const receipt=await Receipt.create({organizationId:access.organizationId,filename:'synthetic.pdf',originalFilename:'synthetic.pdf',size:1});
 await links.matchReceiptWithTransaction(access,String(receipt._id),String(row._id),0);
 await service.deleteTransaction(access,String(row._id));const first=await stored(row._id);assert.ok(first.deletedAt);assert.equal(String(first.deletedBy),access.userId);
 await service.deleteTransaction(access,String(row._id));assert.deepEqual((await stored(row._id)).deletedAt,first.deletedAt);
 assert.equal(await service.getTransactionById(access,String(row._id)),null);
 assert.deepEqual((await service.getTransactions(access)).map(r=>String(r._id)),[String(live._id)]);
 assert.deepEqual((await service.getTransactionStats(access)).total,{count:1,amount:100});
 assert.ok(await stored(foreign._id));assert.equal(String((await Receipt.findById(receipt._id).lean()).transactionId),String(row._id));
 await mongoose.disconnect();await mongoose.connect(mongo.getUri('transaction_lifecycle'));
 assert.ok((await stored(row._id)).manualCreate);assert.equal(await service.getTransactionById(access,String(row._id)),null);
});

test('generic create edit and mapped import cannot forge lifecycle or manual identity',async()=>{
 const fields={manualCreate:identity(),deletedAt:new Date(),deletedBy:access.userId};
 const row=await service.createTransaction(access,{...data,...fields,_id:oid()});
 assert.equal((await stored(row._id)).manualCreate,undefined);assert.equal((await stored(row._id)).deletedAt,undefined);
 const keyed=await create({manualCreate:identity()});const original=await stored(keyed._id);
 await service.updateTransaction(access,String(keyed._id),{...fields,notes:'Valid correction'});
 const after=await stored(keyed._id);assert.deepEqual(after.manualCreate,original.manualCreate);assert.equal(after.deletedAt,undefined);
 const input={...data,...fields,referenceNumber:'synthetic-import'},mapping=Object.fromEntries(Object.keys(input).map(k=>[k,k]));
 const imported=await service.importTransactions(access,[input],mapping);assert.equal(imported.imported,1);assert.equal((await stored(imported.transactions[0])).manualCreate,undefined);
 await service.deleteTransaction(access,String(keyed._id));
 await assert.rejects(service.updateTransaction(access,String(keyed._id),{deletedAt:null,notes:'Resurrect'}),/not found/);
});

test('mixed bulk delete preserves keyed identities and physically deletes only legacy rows in the company',async()=>{
 const keyed=await create({manualCreate:identity()}),legacy=await create(),foreign=await create({manualCreate:identity()},other);
 const result=await bulk(request({action:'delete',ids:[String(keyed._id),String(legacy._id),String(foreign._id)]}));
 assert.equal(result.succeeded,2);assert.ok((await stored(keyed._id)).deletedAt);assert.equal(await stored(legacy._id),null);assert.equal((await stored(foreign._id)).deletedAt,undefined);
 const retry=await bulk(request({action:'delete',ids:[String(keyed._id)]}));assert.equal(retry.succeeded,0);
});

test('bulk writes export and duplicate removal exclude deleted manual records',async()=>{
 const row=await create({manualCreate:identity()}),live=await create();await service.deleteTransaction(access,String(row._id));
 const status=await bulk(request({action:'update_status',ids:[String(row._id)],data:{status:'failed'}}));assert.equal(status.succeeded,0);
 assert.equal((await stored(row._id)).status,'completed');
 const exported=await bulk(request({action:'export',ids:[String(row._id),String(live._id)]}));assert.equal(exported.transactions.length,1);
 const next=await create({manualCreate:identity()});await duplicates(request({action:'delete',deleteIds:[String(next._id)]}));assert.ok((await stored(next._id)).deletedAt);
});

test('duplicate merge archives losing identity and a concurrently deleted winner stops the merge',async()=>{
 const keep=await create(),lose=await create({manualCreate:identity(),notes:'Losing note'});
 await duplicates(request({action:'merge',keepId:String(keep._id),deleteIds:[String(lose._id)]}));
 assert.ok((await stored(lose._id)).deletedAt);assert.match((await stored(keep._id)).notes,/Losing note/);
 const winner=await create({manualCreate:identity()}),loser=await create({manualCreate:identity()}),original=Transaction.updateOne;
 let first=true;
 Transaction.updateOne=function(...args){if(first){first=false;return (async()=>{await service.deleteTransaction(access,String(winner._id));return original.apply(this,args)})()}return original.apply(this,args)};
 try{await assert.rejects(duplicates(request({action:'merge',keepId:String(winner._id),deleteIds:[String(loser._id)]})),e=>e.statusCode===409)}
 finally{Transaction.updateOne=original}
 assert.equal((await stored(loser._id)).deletedAt,undefined);
});

test('receipt and shipment matching reject deleted targets while preserving evidence history',async()=>{
 const row=await create({manualCreate:identity()});await service.deleteTransaction(access,String(row._id));
 const receipt=await Receipt.create({organizationId:access.organizationId,filename:'unmatched.pdf',originalFilename:'unmatched.pdf',size:1});
 await assert.rejects(links.matchReceiptWithTransaction(access,String(receipt._id),String(row._id),0),e=>e.statusCode===404);
 const shipments=load('server/services/shipmentService.ts');
 await assert.rejects(shipments.createShipment(access,{trackingNumber:'SYNTHETIC',carrier:'test',transactionIds:[String(row._id)]}),e=>e.statusCode===404||e.statusCode===400);
 assert.ok(await Receipt.findById(receipt._id));assert.ok(await stored(row._id));
});

test('transaction archive preserves IDs and a current deletion wins over an older active snapshot',async()=>{
 const row=await create({manualCreate:identity()}),snapshot=serialized(await stored(row._id));await service.deleteTransaction(access,String(row._id));
 const missing={...serialized(data),_id:String(oid()),organizationId:access.organizationId,manualCreate:identity()};
 const outcome=await archive.restoreTransactionArchive(access,[snapshot,missing],true);
 assert.deepEqual(outcome,{restored:1,skipped:1,failed:0,cleared:0,clearSkipped:false});
 assert.ok((await stored(row._id)).deletedAt);assert.equal(String((await stored(missing._id))._id),missing._id);
 const reordered={...snapshot,manualCreate:{createdBy:snapshot.manualCreate.createdBy,schemaVersion:1,payloadHash:snapshot.manualCreate.payloadHash,key:snapshot.manualCreate.key}};
 assert.equal((await archive.restoreTransactionArchive(access,[reordered])).skipped,1);
});

test('archive preflight rejects foreign company and conflicting identities before clear or insert',async()=>{
 const row=await create({manualCreate:identity()}),snapshot=serialized(await stored(row._id));
 await assert.rejects(archive.restoreTransactionArchive(access,[{...snapshot,organizationId:other.organizationId}],true),e=>e.statusCode===409);
 await assert.rejects(archive.restoreTransactionArchive(access,[{...snapshot,_id:String(oid())}],true),e=>e.statusCode===409);
 await assert.rejects(archive.restoreTransactionArchive(access,[{...snapshot,manualCreate:identity()}],true),e=>e.statusCode===409);
 await assert.rejects(archive.restoreTransactionArchive(access,[snapshot,snapshot],true),e=>e.statusCode===409);
 assert.equal(await Transaction.countDocuments({}),1);assert.equal((await stored(row._id)).deletedAt,undefined);
});

test('explicit empty archive clears active rows without erasing keyed identity or another company',async()=>{
 const row=await create({manualCreate:identity()}),legacy=await create(),foreign=await create({},other);
 const outcome=await archive.restoreTransactionArchive(access,[],true);assert.equal(outcome.cleared,2);
 assert.ok((await stored(row._id)).deletedAt);assert.equal(await stored(legacy._id),null);assert.ok(await stored(foreign._id));
 await assert.rejects(archive.restoreTransactionArchive(access,undefined,true),e=>e.statusCode===400);
});

test('legacy rows with explicit null identity remain deletable and restore with their original IDs',async()=>{
 const row=await create({manualCreate:null}),snapshot=serialized(await stored(row._id));
 await service.deleteTransaction(access,String(row._id));assert.equal(await stored(row._id),null);
 assert.equal((await archive.restoreTransactionArchive(access,[snapshot])).restored,1);
 assert.equal(String((await stored(row._id))._id),String(row._id));
 assert.equal((await service.removeTransactions(access,{_id:row._id})).deletedCount,1);assert.equal(await stored(row._id),null);
});

test('archive write failure reports partial outcome and skips clear',async()=>{
 const live=await create(),incoming={...serialized(data),_id:String(oid()),organizationId:access.organizationId};
 const original=Transaction.prototype.save;Transaction.prototype.save=async function(){throw Error('Synthetic storage interruption')};
 try{const result=await archive.restoreTransactionArchive(access,[incoming],true);assert.equal(result.failed,1);assert.equal(result.clearSkipped,true);assert.equal(result.cleared,0)}
 finally{Transaction.prototype.save=original}
 assert.ok(await stored(live._id));
});

test('archive clear preserves a purchase created while restoration is running',async()=>{
 const old=await create(),newId=oid(),incoming={...serialized(data),_id:String(oid()),organizationId:access.organizationId};
 const original=Transaction.prototype.save;let inserted=false;
 Transaction.prototype.save=async function(...args){
   if(!inserted){inserted=true;await Transaction.collection.insertOne({...data,_id:newId,organizationId:new mongoose.Types.ObjectId(access.organizationId)})}
   return original.apply(this,args)
 };
 try{const result=await archive.restoreTransactionArchive(access,[incoming],true);assert.equal(result.restored,1);assert.equal(result.cleared,1)}
 finally{Transaction.prototype.save=original}
 assert.equal(await stored(old._id),null);assert.ok(await stored(newId));assert.ok(await stored(incoming._id));
});

test('downloaded and scheduled transaction archive envelopes retain identity and require company write access',async()=>{
 const row=await create({manualCreate:identity()}),foreign=await create({manualCreate:identity()},other);await service.deleteTransaction(access,String(row._id));
 const downloaded=await backup({method:'GET',access,query:{receipts:'false',recurring:'false',templates:'false'}});
 const payload=typeof downloaded==='string'?JSON.parse(downloaded):downloaded;
 assert.equal(payload.transactions.length,1);assert.ok(payload.transactions[0].manualCreate);assert.notEqual(payload.transactions[0].id,String(foreign._id));
 const body={data:payload,receipts:false,recurringPayments:false,mappingTemplates:false,skipDuplicates:false};
 assert.equal((await restore(request(body))).results.transactions.skipped,1);
 const scheduled={...body,data:{version:'1.0',application:'ohmyfinance',data:{transactions:payload.transactions}}};
 assert.equal((await restore(request(scheduled))).results.transactions.skipped,1);
 await assert.rejects(restore(request(body,{...access,role:'viewer'})),e=>e.statusCode===403);
});

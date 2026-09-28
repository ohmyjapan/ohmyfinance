const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
  const code=ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
  new Function('require','module','exports',code)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports);return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id(),owner=id(),member=id(),viewer=id(),outsider=id();
const event=(user=owner,organization=a,role='owner')=>({context:{auth:{isAuthenticated:true,userId:String(user),organizationId:organization?String(organization):undefined,role}}});
let mongo,Organization,Receipt,Transaction,access,management,matching;
before(async()=>{
  const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('receipt_group_regression'));
  const org=load('server/models/Organization.ts',{mongoose}),receipt=load('server/models/Receipt.ts',{mongoose}),transaction=load('server/models/Transaction.ts',{mongoose});
  Organization=org.default;Receipt=receipt.default;Transaction=transaction.default;
  const database={ensureConnection:async()=>assert.equal(mongoose.connection.name,'receipt_group_regression')};
  const auth=load('server/middleware/auth.ts',{'h3':h3,'../services/authService':{verifyAccessToken:()=>null},'../services/tokenBlacklistService':{isBlacklisted:()=>false}});
  access=load('server/services/ledgerAccessService.ts',{'h3':h3,mongoose,'../models/Organization':org,'../middleware/auth':auth,'../config/database':database});
  management=load('server/services/receiptManagementService.ts',{'h3':h3,mongoose,'../models/Receipt':receipt,'../config/database':database});
  matching=load('server/services/receiptService.ts',{'h3':h3,'../models/Receipt':receipt,'../models/Transaction':transaction,'../config/database':database,'../utils/receiptMatching':load('server/utils/receiptMatching.ts')});
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  await Promise.all([Organization.deleteMany({}),Receipt.deleteMany({}),Transaction.deleteMany({})]);
  await Organization.create([{_id:a,name:'Synthetic A',slug:'a',members:[{userId:owner,role:'owner'},{userId:member,role:'member'},{userId:viewer,role:'viewer'}]},{_id:b,name:'Synthetic B',slug:'b',members:[{userId:outsider,role:'owner'}]}]);
});
const resolve=(user=owner,organization=a,mode='read')=>access.requireLedgerAccess(event(user,organization),mode);
const create=(ctx,extra={})=>management.createReceipt(ctx,{filename:'synthetic-'+id()+'.pdf',originalFilename:'synthetic.pdf',size:1},{amount:67000,currency:'JPY',merchant:'Synthetic shop',receiptDate:new Date('2026-09-22'),...extra});

test('ledger membership resolver requires authentication and a real selected membership',async()=>{
  await assert.rejects(access.requireLedgerAccess({context:{}}),e=>e.statusCode===401);
  for(const request of [event(owner,null),event(owner,'invalid'),event(owner,b),event(outsider,a)])await assert.rejects(access.requireLedgerAccess(request),e=>e.statusCode===403);
  assert.equal((await resolve(member)).organizationId,String(a));
});
test('ledger writes use current membership role rather than a stale owner claim',async()=>{
  for(const role of ['owner','admin','member','viewer']){
    await Organization.updateOne({_id:a,'members.userId':member},{$set:{'members.$.role':role}});
    assert.equal((await resolve(member)).role,role);
    if(role==='viewer')await assert.rejects(resolve(member,a,'write'),e=>e.statusCode===403);
    else assert.equal((await resolve(member,a,'write')).role,role);
  }
});
test('inactive groups, removed membership and database failures never fall back to JWT permissions',async()=>{
  await Organization.updateOne({_id:a},{$set:{isActive:false}});await assert.rejects(resolve(),e=>e.statusCode===403);
  await Organization.updateOne({_id:a},{$set:{isActive:true},$pull:{members:{userId:owner}}});await assert.rejects(resolve(),e=>e.statusCode===403);
  const find=Organization.findOne;Organization.findOne=()=>{throw Error('Synthetic unavailable membership database');};
  try{await assert.rejects(resolve(member),/Synthetic unavailable/);}finally{Organization.findOne=find;}
  assert.equal((await resolve(member)).role,'member');
});
test('receipt management shares records by group and preserves company and uploader through edits',async()=>{
  const own=await resolve(),peer=await resolve(member,a,'write'),foreign=await resolve(outsider,b,'write');
  const r=await create(own,{organizationId:b,uploadedBy:outsider}),f=await create(foreign);
  await Receipt.create({filename:'unscoped.pdf',originalFilename:'unscoped.pdf',size:1,uploadedBy:owner});
  assert.equal(r.organizationId,String(a));assert.equal(r.uploadedBy,String(owner));
  assert.deepEqual((await management.getReceipts(peer,{search:'Synthetic'})).map(r=>r.id),[r.id]);
  assert.equal((await management.getReceiptStats(peer)).total,1);
  for(const fn of [()=>management.getReceiptById(peer,f.id),()=>management.updateReceipt(peer,f.id,{notes:'Foreign'}),()=>management.deleteReceipt(peer,f.id)])await assert.rejects(fn,e=>e.statusCode===404);
  const results=await Promise.all(['one','two'].map(notes=>management.updateReceipt(peer,r.id,{notes,organizationId:b,uploadedBy:member})));
  for(const result of results){assert.equal(result.organizationId,String(a));assert.equal(result.uploadedBy,String(owner));}
  assert(['one','two'].includes((await management.getReceiptById(own,r.id)).notes));
  const deletion=await Promise.allSettled([management.deleteReceipt(peer,r.id),management.deleteReceipt(peer,r.id)]);
  assert.equal(deletion.filter(r=>r.status==='fulfilled').length,1);assert.equal(deletion.find(r=>r.status==='rejected').reason.statusCode,404);
  assert.equal((await management.getReceiptById(foreign,f.id)).id,f.id);
});
test('receipt candidates and manual match boundaries exclude foreign and unassigned transactions without side effects',async()=>{
  const ctx=await resolve(member,a,'write'),r=await create(await resolve());
  const base={date:new Date('2026-09-22'),amount:67000,companyInfo:'Synthetic shop',metadata:{currency:'JPY'},type:'支出',status:'completed'};
  const own=await Transaction.create({...base,organizationId:a}),foreign=await Transaction.create({...base,organizationId:b}),legacy=await Transaction.create(base);
  assert.deepEqual((await matching.findMatchesForReceipt(ctx,r.id)).map(m=>m.transactionId),[String(own._id)]);
  const before=await Receipt.findById(r.id).lean(),ledger=await Transaction.find({}).lean();
  for(const row of [foreign,legacy])await assert.rejects(matching.matchReceiptWithTransaction(ctx,r.id,String(row._id)),e=>e.statusCode===404);
  assert.deepEqual(await Receipt.findById(r.id).lean(),before);assert.deepEqual(await Transaction.find({}).lean(),ledger);
  await Receipt.updateOne({_id:r.id},{$set:{status:'matched',transactionId:foreign._id}});
  await assert.rejects(matching.unmatchReceipt(ctx,r.id),e=>e.statusCode===404);
  assert.equal((await Receipt.findById(r.id)).status,'matched');assert.deepEqual(await Transaction.find({}).lean(),ledger);
});
test('group-scoped receipt reads survive reconnect and do not depend on uploader still being a member',async()=>{
  const r=await create(await resolve());await Organization.updateOne({_id:a},{$pull:{members:{userId:owner}}});
  await mongoose.disconnect();await mongoose.connect(mongo.getUri('receipt_group_regression'));
  await assert.rejects(resolve(),e=>e.statusCode===403);
  assert.equal((await management.getReceiptById(await resolve(member),r.id)).id,r.id);
});

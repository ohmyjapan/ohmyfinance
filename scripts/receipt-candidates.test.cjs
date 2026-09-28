const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',compiled)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports);
  return module.exports;
}
const scoring = load('server/utils/receiptMatching.ts');
const organizationId=new mongoose.Types.ObjectId(),access={organizationId:String(organizationId),userId:String(new mongoose.Types.ObjectId()),role:'member'};
const receipt = {organizationId,amount:67000,receiptDate:'2026-09-22',merchant:'東京書店',currency:'JPY'};
const transaction = {organizationId,amount:67000,date:'2026-09-22',companyInfo:'東京書店',metadata:{currency:'JPY'},type:'支出',status:'completed'};
const score = (r = {}, t = {}) => scoring.calculateMatchConfidence({...receipt,...r},{...transaction,...t});
let mongo, Receipt, Transaction, service;
before(async()=>{
  const binary = path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo = await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  await mongoose.connect(mongo.getUri('receipt_candidates_regression'));
  const receipts = load('server/models/Receipt.ts',{mongoose}),transactions=load('server/models/Transaction.ts',{mongoose});
  Receipt=receipts.default;Transaction=transactions.default;
  const links=load('server/services/receiptLinkService.ts',{h3:require('h3'),mongoose,'../models/Receipt':receipts,'../models/Transaction':transactions,'../config/database':{ensureConnection:async()=>assert.equal(mongoose.connection.name,'receipt_candidates_regression')}});
  service=load('server/services/receiptService.ts',{'./receiptLinkService':links,
    'h3':require('h3'),'../models/Receipt':receipts,'../models/Transaction':transactions,'../utils/receiptMatching':scoring,
    '../config/database':{ensureConnection:async()=>assert.equal(mongoose.connection.name,'receipt_candidates_regression')}
  });
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
async function seedReceipt(changes={}){
  return Receipt.create({...receipt,filename:'synthetic-'+new mongoose.Types.ObjectId()+'.pdf',originalFilename:'synthetic.pdf',size:1,uploadedBy:new mongoose.Types.ObjectId(),...changes});
}
async function reset(){await Receipt.deleteMany({});await Transaction.deleteMany({});}

test('rule score starts at zero and amount/date alone cannot reach the automatic threshold',()=>{
  assert.equal(scoring.calculateMatchConfidence({},{}).confidence,0);
  const result=score({merchant:null},{companyInfo:undefined});
  assert.equal(result.confidence,70);assert.equal(result.autoMatchEligible,false);
  assert.equal(score({merchant:null},{companyInfo:undefined,metadata:{}}).confidence,60);
});
test('Japanese names stay distinct and empty punctuation is not merchant evidence',()=>{
  for(const merchant of ['大阪衣料','!!!','']){
    const result=score({merchant});assert.equal(result.confidence,70);assert.equal(result.autoMatchEligible,false);
  }
  assert.equal(score().confidence,100);assert.equal(score().autoMatchEligible,true);
  assert.equal(score({merchant:'ＩＳＳＥＹ ＭＩＹＡＫＥ'},{companyInfo:'issey miyake'}).autoMatchEligible,true);
});
test('currency conflicts, missing values, customer names and reference numbers do not establish a merchant match',()=>{
  assert.equal(score({}, {metadata:{currency:'USD'}}).confidence,0);
  assert.equal(score({}, {metadata:{},currency:'JPY'}).autoMatchEligible,false);
  const result=score({}, {companyInfo:undefined,customer:{name:'東京書店'},reference:'東京書店',referenceNumber:'東京書店'});
  assert.equal(result.confidence,70);assert.equal(result.autoMatchEligible,false);
  assert.equal(score({}, {companyInfo:undefined,notes:'東京書店',metadata:{currency:' jpy '}}).autoMatchEligible,true);
});
test('dates use Japanese calendar days and malformed evidence contributes no date points',()=>{
  assert.equal(score({receiptDate:'2026-09-21T16:00:00Z'},{date:'2026-09-22T13:00:00Z'}).confidence,100);
  assert.equal(score({}, {date:'2026-09-25'}).autoMatchEligible,true);
  assert.equal(score({}, {date:'2026-09-26'}).autoMatchEligible,false);
  for(const receiptDate of [null,'','not-a-date'])assert.equal(score({receiptDate}).confidence,80);
});
test('near, zero, negative and nonfinite amounts remain review-only; unrelated transaction types cannot auto-match',()=>{
  for(const [a,b]of [[67000,66999],[0,0],[-10,-10],[NaN,NaN],[Infinity,Infinity]])assert.equal(score({amount:a},{amount:b}).autoMatchEligible,false);
  for(const type of ['入金','expense',''])assert.equal(score({}, {type}).autoMatchEligible,false);
  for(const status of ['failed','cancelled','refunded'])assert.equal(score({}, {status}).autoMatchEligible,false);
  const zero=scoring.receiptCandidateWindow({amount:0});assert.deepEqual(zero.amount,{$gte:0,$lte:0});
  const negative=scoring.receiptCandidateWindow({amount:-100});assert.deepEqual(negative.amount,{$gte:-115,$lte:-85});
});
test('stored candidates expose actual references/currency and rank an older exact match beyond twenty newer records',async()=>{
  await reset();const r=await seedReceipt();
  await Transaction.insertMany(Array.from({length:25},(_,i)=>({...transaction,date:new Date('2026-09-23'),amount:67001+i,companyInfo:'大阪衣料'})));
  const exact=await Transaction.create({...transaction,referenceNumber:'SYNTHETIC-EXACT'});
  const before=await Transaction.find({}).lean();
  const matches=await service.findMatchesForReceipt(access, String(r._id));
  assert.equal(matches.length,10);assert.equal(matches[0].transactionId,String(exact._id));
  assert.equal(matches[0].reference,'SYNTHETIC-EXACT');assert.equal(matches[0].currency,'JPY');assert.equal(matches[0].description,'東京書店');
  assert.equal(matches[0].autoMatchEligible,true);assert.deepEqual(await Transaction.find({}).lean(),before);
});
test('either stored receipt fields or an existing reciprocal receipt claim excludes a transaction',async()=>{
  await reset();const r=await seedReceipt();
  const linked=await Transaction.create(transaction);
  await seedReceipt({status:'matched',transactionId:linked._id});
  await Transaction.create({...transaction,hasReceipt:true});
  await Transaction.create({...transaction,receiptFilePath:'/synthetic/original.pdf'});
  const free=await Transaction.create(transaction);
  const result=await service.findMatchesForReceipt(access, String(r._id));assert.deepEqual(result.map(m=>m.transactionId),[String(free._id)]);
});
test('equal strong candidates remain ambiguous across the display limit and automatic matching performs no write',async()=>{
  await reset();const r=await seedReceipt();await Transaction.insertMany(Array.from({length:25},()=>({...transaction})));
  const before=await Transaction.find({}).lean();
  const matches=await service.findMatchesForReceipt(access, String(r._id));assert.equal(matches.length,10);assert(matches.every(m=>m.confidence===100));
  const result=await service.autoMatchReceipts(access,85);assert.equal(result.matched,0);assert.equal(result.skipped,1);
  assert.deepEqual(await Transaction.find({}).lean(),before);assert.equal((await Receipt.findById(r._id)).status,'unmatched');
});
test('a lowered automatic threshold cannot turn incomplete evidence into a receipt write',async()=>{
  await reset();const r=await seedReceipt({merchant:null});await Transaction.create(transaction);
  const before=await Transaction.find({}).lean();
  const result=await service.autoMatchReceipts(access,50);assert.equal(result.matched,0);assert.equal(result.skipped,1);
  assert.deepEqual(await Transaction.find({}).lean(),before);assert.equal((await Receipt.findById(r._id)).status,'unmatched');
});
test('candidate requests are repeatable, read-only and empty evidence does not scan the entire ledger',async()=>{
  await reset();const empty=await seedReceipt({amount:null,receiptDate:null});await Transaction.create(transaction);
  assert.deepEqual(await service.findMatchesForReceipt(access, String(empty._id)),[]);
  const r=await seedReceipt();const before=await Receipt.find({}).lean();
  const results=await Promise.all(Array.from({length:5},()=>service.findMatchesForReceipt(access, String(r._id))));
  for(const result of results)assert.deepEqual(result,results[0]);
  assert.deepEqual(await Receipt.find({}).lean(),before);
  await mongoose.disconnect();await mongoose.connect(mongo.getUri('receipt_candidates_regression'));
  assert.deepEqual(await service.findMatchesForReceipt(access, String(r._id)),results[0]);
});

test('the actual database window includes both whole Japanese boundary dates without including neighboring days',async()=>{
  await reset();const r=await seedReceipt();
  const dates=['2026-09-07T14:59:59.999Z','2026-09-07T15:00:00.000Z','2026-10-06T14:59:59.999Z','2026-10-06T15:00:00.000Z'];
  const records=await Transaction.insertMany(dates.map(date=>({...transaction,date:new Date(date)})));
  const result=await service.findMatchesForReceipt(access, String(r._id));
  assert.deepEqual(result.map(m=>m.transactionId).sort(),[String(records[1]._id),String(records[2]._id)].sort());
  assert(result.every(m=>!m.autoMatchEligible));
});

test('a scan failure after one candidate closes the cursor and never turns an incomplete scan into an automatic write',async()=>{
  await reset();const r=await seedReceipt();await Transaction.insertMany([transaction,transaction]);
  const before=await Transaction.find({}).lean();
  const original=Transaction.find;let closed=0;
  Transaction.find=function(...args){
    const query=original.apply(this,args),cursor=query.cursor;
    query.cursor=function(...options){
      const actual=cursor.apply(this,options);
      return {
        async *[Symbol.asyncIterator](){for await(const candidate of actual){yield candidate;throw Error('Synthetic interrupted candidate scan');}},
        async close(){closed++;await actual.close();}
      };
    };
    return query;
  };
  try{
    await assert.rejects(service.findMatchesForReceipt(access, String(r._id)),/Synthetic interrupted candidate scan/);
    const result=await service.autoMatchReceipts(access,85);
    assert.equal(result.matched,0);assert.equal(result.skipped,1);assert.equal(closed,2);
  }finally{Transaction.find=original;}
  assert.deepEqual(await Transaction.find({}).lean(),before);
  assert.equal((await Receipt.findById(r._id)).status,'unmatched');
  assert.equal((await service.findMatchesForReceipt(access, String(r._id))).length,2);
});

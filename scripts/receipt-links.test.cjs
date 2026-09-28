const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 new Function('require','module','exports',code)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency '+name);return imports[name];},module,module.exports);return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id(),ctx={organizationId:String(a),userId:String(id()),role:'member'};
let mongo,Receipt,Transaction,links,transactions,management;
before(async()=>{
 const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
 await mongoose.connect(mongo.getUri('receipt_links_regression'));
 const receipt=load('server/models/Receipt.ts',{mongoose}),transaction=load('server/models/Transaction.ts',{mongoose});Receipt=receipt.default;Transaction=transaction.default;
 const database={ensureConnection:async()=>assert.equal(mongoose.connection.name,'receipt_links_regression')};
 links=load('server/services/receiptLinkService.ts',{h3,mongoose,'../models/Receipt':receipt,'../models/Transaction':transaction,'../config/database':database});
 transactions=load('server/services/transactionService.ts',{h3,mongoose,'../models/Transaction':transaction,'../config/database':database,'./receiptLinkService':links});
 management=load('server/services/receiptManagementService.ts',{h3,mongoose,'../models/Receipt':receipt,'../config/database':database});
 for(const name of ['Customer','Supplier','AccountCategory','TaxCategory','TransactionCategory','DataSource'])if(!mongoose.models[name])mongoose.model(name,new mongoose.Schema({name:String}));
 await Receipt.init();
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{await Receipt.deleteMany({});await Transaction.deleteMany({});});
async function seed(){
 const receipt=await Receipt.create({organizationId:a,filename:String(id())+'.pdf',originalFilename:'synthetic.pdf',size:17,filePath:'private-path-not-for-response',fileUrl:'/synthetic.pdf'});
 const transaction=await Transaction.create({organizationId:a,date:new Date('2026-09-22'),amount:67000,type:'expense',status:'completed',timeline:[]});
 return {r:String(receipt._id),t:String(transaction._id)};
}
const attach=(r,t,v=0)=>links.matchReceiptWithTransaction(ctx,r,t,v),detach=(r,t,v=1)=>links.unmatchReceipt(ctx,r,t,v);

test('receipt attachment has one authority and consistent detail list filters and statistics',async()=>{
 const {r,t}=await seed(),before=await Transaction.findById(t).lean();
 const saved=await attach(r,t);assert.equal(saved.receipt.linkVersion,1);assert.equal(saved.receipt.filePath,undefined);
 assert.equal(saved.transaction.receipt.id,r);assert.equal(saved.transaction.hasReceipt,true);
 assert.equal((await transactions.getTransactionById(ctx,t)).receipt.id,r);
 assert.equal((await transactions.getTransactions(ctx,{hasReceipt:true,search:'synthetic'})).length,0);
 assert.equal((await transactions.getTransactions(ctx,{hasReceipt:true})).length,1);
 assert.equal((await transactions.getTransactions(ctx,{hasReceipt:false})).length,0);
 assert.equal((await transactions.getTransactionStats(ctx)).receiptMatchRate,1);
 assert.deepEqual(await Transaction.findById(t).lean(),before,'Receipt matching must not alter accounting or create a second stored relationship');
 await detach(r,t);assert.equal((await transactions.getTransactionById(ctx,t)).hasReceipt,false);
 assert.equal((await transactions.getTransactionStats(ctx)).receiptMatchRate,0);
});
test('concurrent duplicate attach and detach requests change the version and audit only once',async()=>{
 const {r,t}=await seed();await Promise.all(Array.from({length:8},()=>attach(r,t)));
 assert.equal((await Receipt.findById(r)).linkHistory.length,1);
 await Promise.all(Array.from({length:8},()=>detach(r,t)));
 const receipt=await Receipt.findById(r);assert.equal(receipt.linkVersion,2);assert.equal(receipt.linkHistory.length,2);
});
test('two receipts racing for one transaction cannot both own it',async()=>{
 const {r,t}=await seed(),other=await seed();
 const results=await Promise.allSettled([attach(r,t),attach(other.r,t)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
 assert.equal(await Receipt.countDocuments({transactionId:t}),1);
});
test('one receipt racing for two transactions cannot be reassigned by the loser',async()=>{
 const {r,t}=await seed(),other=await seed();
 const results=await Promise.allSettled([attach(r,t),attach(r,other.t)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await Receipt.findById(r)).linkVersion,1);
});
test('delayed requests cannot replay across detach and reattach even for the same pair',async()=>{
 const {r,t}=await seed();await attach(r,t);await detach(r,t);await attach(r,t,2);
 const before=await Receipt.findById(r).lean();
 for(const fn of [()=>attach(r,t),()=>detach(r,t)])await assert.rejects(fn,e=>e.statusCode===409);
 assert.deepEqual(await Receipt.findById(r).lean(),before);
});
test('lost response after durable attachment resumes after reconnect without duplicated work',async()=>{
 const {r,t}=await seed();const find=Receipt.find;
 Receipt.find=()=>{throw Error('Synthetic response failure after durable receipt write');};
 try{await assert.rejects(attach(r,t),/Synthetic response failure/);}finally{Receipt.find=find;}
 await mongoose.disconnect();await mongoose.connect(mongo.getUri('receipt_links_regression'));
 assert.equal((await attach(r,t)).receipt.linkVersion,1);assert.equal((await Receipt.findById(r)).linkHistory.length,1);
});
test('failure before the atomic write leaves no partial relationship',async()=>{
 const {r,t}=await seed(),update=Receipt.findOneAndUpdate;
 Receipt.findOneAndUpdate=()=>{throw Error('Synthetic unavailable write');};
 try{await assert.rejects(attach(r,t),/Synthetic unavailable write/);}finally{Receipt.findOneAndUpdate=update;}
 assert.equal((await Receipt.findById(r)).transactionId,undefined);assert.equal((await attach(r,t)).receipt.linkVersion,1);
});
test('foreign or unassigned records cannot be attached; legacy file evidence stays untouched',async()=>{
 const {r,t}=await seed();
 await Receipt.collection.updateOne({_id:new mongoose.Types.ObjectId(r)},{$set:{organizationId:b}});
 await assert.rejects(attach(r,t),e=>e.statusCode===404);
 await Receipt.collection.updateOne({_id:new mongoose.Types.ObjectId(r)},{$unset:{organizationId:''}});
 await assert.rejects(attach(r,t),e=>e.statusCode===404);
 await Receipt.collection.updateOne({_id:new mongoose.Types.ObjectId(r)},{$set:{organizationId:a}});
 await Transaction.collection.updateOne({_id:new mongoose.Types.ObjectId(t)},{$set:{organizationId:b}});
 await assert.rejects(attach(r,t),e=>e.statusCode===404);
 await Transaction.collection.updateOne({_id:new mongoose.Types.ObjectId(t)},{$unset:{organizationId:''}});await assert.rejects(attach(r,t),e=>e.statusCode===404);
 await Transaction.collection.updateOne({_id:new mongoose.Types.ObjectId(t)},{$set:{organizationId:a,hasReceipt:true,receiptFilePath:'/finance-evidence'}});
 const before=await Transaction.findById(t).lean();await assert.rejects(attach(r,t),e=>e.statusCode===409);assert.deepEqual(await Transaction.findById(t).lean(),before);
});
test('deleting the receipt removes its derived link; missing targets can be unlinked safely',async()=>{
 let {r,t}=await seed();await attach(r,t);await management.deleteReceipt(ctx,r);
 assert.equal((await transactions.getTransactionById(ctx,t)).hasReceipt,false);
 ({r,t}=await seed());await attach(r,t);await Transaction.deleteOne({_id:t});
 assert.equal((await detach(r,t)).receipt.status,'unmatched');
});
test('editing transaction metadata cannot persist a derived receipt flag or lose the displayed link',async()=>{
 const {r,t}=await seed();await attach(r,t);
 const edited=await transactions.updateTransaction(ctx,t,{notes:'Reviewed',hasReceipt:true,receiptFilePath:'/forged'});
 assert.equal(edited.receipt.id,r);assert.equal((await Transaction.findById(t)).hasReceipt,false);
 await detach(r,t);assert.equal((await transactions.getTransactionById(ctx,t)).hasReceipt,false);
});
test('missing or malformed versions and IDs do not write; legacy missing version starts at zero',async()=>{
 const {r,t}=await seed();for(const v of [undefined,null,-1,'0',1.5])await assert.rejects(links.matchReceiptWithTransaction(ctx,r,t,v),e=>e.statusCode===400);
 await assert.rejects(attach('bad',t),e=>e.statusCode===400);
 await Receipt.collection.updateOne({_id:new mongoose.Types.ObjectId(r)},{$unset:{linkVersion:''}});
 assert.equal((await attach(r,t)).receipt.linkVersion,1);
});
test('the compiled upload page sends the displayed link version and keeps the server result',async()=>{
 const vue=require('vue'),{parse,compileScript}=require('@vue/compiler-sfc');
 const filename=path.join(root,'pages/receipts/upload.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
 const script=compileScript(descriptor,{id:'receipt-link-page'}),module={exports:{}};
 const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const receipt={id:'synthetic-receipt',status:'unmatched',linkVersion:4},requests=[];
 const imports={vue:{...vue,onMounted(){},onBeforeUnmount(){}},'~/composables/useReceiptFiles':{useReceiptFiles:()=>({downloadReceipt(){},downloadError:vue.ref('')})},'~/stores/user':{useUserStore:()=>({authHeader:{Authorization:'Synthetic session'}})},'lucide-vue-next':{}};
 new Function('require','module','exports','useI18n','useRoute','$fetch',code)(name=>{assert(Object.hasOwn(imports,name));return imports[name];},module,module.exports,()=>({t:k=>k,locale:vue.ref('ja')}),()=>({query:{}}),async(url,options)=>{
  requests.push({url,options});return {receipt:{...receipt,status:'matched',transactionId:'synthetic-transaction',linkVersion:5}};
 });
 const state=module.exports.default.setup({},{expose(){}});state.receipts.value=[receipt];
 await state.matchReceipt(receipt.id,'synthetic-transaction');
 assert.equal(requests[0].options.body.linkVersion,4);assert.equal(requests[0].options.headers.Authorization,'Synthetic session');
 assert.equal(state.receipts.value[0].linkVersion,5);assert.equal(state.receiptStats.value.matched,1);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
for(const file of ['upload.ts','[id].ts'])test('retired attachment '+file+' authenticates and never reads or writes legacy originals',async()=>{
 const filename=path.resolve(__dirname,'../server/api/attachments',file),module={exports:{}};
 const imports={h3:{defineEventHandler:f=>f,createError:x=>Object.assign(new Error(x.statusMessage),x)},'../../middleware/auth':{requireAuth:event=>{if(!event.auth)throw Object.assign(Error('No authentication'),{statusCode:401});}}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',code)(name=>{assert(Object.hasOwn(imports,name),'Retired endpoint must not load filesystem or database dependencies: '+name);return imports[name];},module,module.exports);
 for(const method of ['GET','POST','DELETE']){
  assert.throws(()=>module.exports.default({method}),e=>e.statusCode===401);
  assert.throws(()=>module.exports.default({method,auth:true,context:{params:{id:'legacy.pdf'}}}),e=>e.statusCode===410);
 }
});
test('transaction form submits metadata without inventing receipt evidence for new or existing transactions',async()=>{
 for(const initial of [undefined,{id:'synthetic-existing',date:'2026-09-22',amount:67000,hasReceipt:true,receiptFilePath:'/existing.pdf'}]){
  const form=await require('./helpers/transaction-form.cjs')(initial);
  try{
   assert(!/type="file"/.test(form.html),'Metadata form must not offer an upload which never saves bytes');
   assert(form.html.includes('transactionForm.receiptAfterSave'),'Explain the canonical receipt flow');
   form.state.form.value.amount='67,000';form.state.form.value.receiptFile={name:'not-uploaded.pdf'};
   await form.state.submitForm();const submission=form.emitted.find(e=>e[0]==='submit')[1];
   assert.equal(submission.amount,67000);
   for(const field of ['hasReceipt','receipt','receiptFilePath','receiptUploadedAt','attachments','receiptFile'])assert(!Object.hasOwn(submission,field),field+' is not metadata');
  }finally{form.close();}
 }
});

const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3'),vue=require('vue');
const {MongoMemoryServer}=require('mongodb-memory-server'),root=path.resolve(__dirname,'..');
function load(file,imports,globals={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,module={exports:{}};
 new Function('require','module','exports',...Object.keys(globals),code)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency '+name);return imports[name];},module,module.exports,...Object.values(globals));return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id(),ctx={organizationId:String(a),userId:String(id()),role:'member'},other={...ctx,organizationId:String(b)};
const bytes=Buffer.from('%PDF-1.7\nSynthetic receipt original\n%%EOF'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
let mongo,directory,Receipt,service,management,io,previousDirectory;
before(async()=>{
 directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-receipt-files-'));previousDirectory=process.env.OMF_DATA_DIR;process.env.OMF_DATA_DIR=directory;
 const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('receipt_files_regression'));
 const receipt=load('server/models/Receipt.ts',{mongoose});Receipt=receipt.default;
 const database={ensureConnection:async()=>assert.equal(mongoose.connection.name,'receipt_files_regression')};
 management=load('server/services/receiptManagementService.ts',{h3,mongoose,'../models/Receipt':receipt,'../config/database':database});io={...fsp};
 service=load('server/services/receiptFileService.ts',{h3,'node:crypto':crypto,'node:fs/promises':io,'node:path':path,'node:os':os,mongoose,'../models/Receipt':receipt,'../config/database':database,'./receiptManagementService':management});
 await Receipt.init();
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();if(previousDirectory===undefined)delete process.env.OMF_DATA_DIR;else process.env.OMF_DATA_DIR=previousDirectory;if(directory){assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fsp.rm(directory,{recursive:true,force:true});}});
beforeEach(async()=>{await Receipt.deleteMany({});Object.assign(io,fsp);});
const target=(access=ctx,data=bytes)=>path.join(directory,'receipts',access.organizationId,hash(data));
const upload=(data=bytes,name='synthetic.pdf',access=ctx)=>service.uploadReceiptFile(access,data,name);

test('same bytes register once under parallel uploads and metadata corrections survive retries',async()=>{
 const results=await Promise.all(Array.from({length:8},()=>upload()));assert.equal(new Set(results.map(r=>r.id)).size,1);assert.equal(await Receipt.countDocuments({}),1);
 const r=results[0];assert.equal(r.receiptDate,undefined);assert.equal(r.filePath,undefined);assert.equal(r.fileUrl,'/api/receipts/'+r.id+'/file');
 await management.updateReceipt(ctx,r.id,{notes:'Reviewed',amount:67000,receiptDate:'2026-09-22'});
 const before=await Receipt.findById(r.id).lean();await upload(bytes,'renamed.pdf',{...ctx,userId:String(id())});
 assert.deepEqual(await Receipt.findById(r.id).lean(),before);assert.deepEqual((await service.downloadReceiptFile(ctx,r.id)).bytes,bytes);
});
test('same filename with different bytes preserves both originals and company copies stay separate',async()=>{
 const first=await upload(),second=await upload(Buffer.from('%PDF-1.7\nDifferent'),'synthetic.pdf'),foreign=await upload(bytes,'synthetic.pdf',other);
 assert.notEqual(first.id,second.id);assert.notEqual(first.id,foreign.id);assert(await fsp.stat(target(other)));
 await assert.rejects(service.downloadReceiptFile(ctx,foreign.id),e=>e.statusCode===404);
 assert.deepEqual((await service.downloadReceiptFile(other,foreign.id)).bytes,bytes);
});
test('failure after file publication but before database registration resumes from original bytes',async()=>{
 const create=Receipt.create;Receipt.create=()=>{throw Error('Synthetic DB failure before insert');};
 try{await assert.rejects(upload(),/Synthetic DB failure/);}finally{Receipt.create=create;}
 assert.deepEqual(await fsp.readFile(target()),bytes);assert.equal(await Receipt.countDocuments({}),0);
 await mongoose.disconnect();await mongoose.connect(mongo.getUri('receipt_files_regression'));
 const r=await upload();assert.equal(await Receipt.countDocuments({}),1);assert.deepEqual((await service.downloadReceiptFile(ctx,r.id)).bytes,bytes);
});
test('lost acknowledgement after database insert reuses the saved receipt instead of deleting its original',async()=>{
 const create=Receipt.create;Receipt.create=async function(...args){await create.apply(this,args);throw Error('Synthetic lost insert acknowledgement');};
 try{await assert.rejects(upload(),/Synthetic lost insert/);}finally{Receipt.create=create;}
 assert.deepEqual(await fsp.readFile(target()),bytes,'Uncertain DB results must retain the original');
 const before=await Receipt.findOne({}).lean();const r=await upload();assert.equal(r.id,String(before._id));assert.deepEqual(await Receipt.findById(r.id).lean(),before);
 assert.deepEqual(await fsp.readFile(target()),bytes);
});
test('failure before atomic publication leaves no registered receipt or partial canonical original',async()=>{
 const fresh=Buffer.from('%PDF-1.7\nBefore publication '+id());io.rename=async()=>{throw Error('Synthetic rename failure');};
 await assert.rejects(upload(fresh),/Synthetic rename failure/);assert.equal(await Receipt.countDocuments({}),0);
 await assert.rejects(fsp.stat(target(ctx,fresh)),e=>e.code==='ENOENT');
 assert(!(await fsp.readdir(path.dirname(target()))).some(name=>name.endsWith('.part')));
 io.rename=fsp.rename;await upload(fresh);
});
test('missing or damaged originals fail explicitly and identical reupload repairs without replacing metadata',async()=>{
 const r=await upload();await management.updateReceipt(ctx,r.id,{notes:'Verified source'});const before=await Receipt.findById(r.id).lean();
 await fsp.unlink(target());await assert.rejects(service.downloadReceiptFile(ctx,r.id),e=>e.statusCode===404);
 assert.equal((await upload()).id,r.id);const damaged=Buffer.from(bytes);damaged[damaged.length-1]^=1;await fsp.writeFile(target(),damaged);await assert.rejects(service.downloadReceiptFile(ctx,r.id),e=>e.statusCode===409);
 await upload();assert.deepEqual((await service.downloadReceiptFile(ctx,r.id)).bytes,bytes);assert.deepEqual(await Receipt.findById(r.id).lean(),before);
});
test('download never trusts stored paths and refuses unregistered or malformed storage identities',async()=>{
 const r=await upload();await Receipt.updateOne({_id:r.id},{$set:{filePath:path.join(directory,'private.txt')}});await fsp.writeFile(path.join(directory,'private.txt'),'Private unrelated content');
 assert.deepEqual((await service.downloadReceiptFile(ctx,r.id)).bytes,bytes);
 await Receipt.updateOne({_id:r.id},{$set:{fileHash:'../private.txt'}});await assert.rejects(service.downloadReceiptFile(ctx,r.id),e=>e.statusCode===409);
 const meta=await management.createReceipt(ctx,{filename:'metadata',originalFilename:'metadata',size:1,filePath:target(),fileUrl:'/forged'});
 await assert.rejects(service.downloadReceiptFile(ctx,meta.id),e=>e.statusCode===404);
});
test('empty oversized and unsupported data never register; supported signatures determine the content type',async()=>{
 for(const [data,status] of [[Buffer.alloc(0),400],[Buffer.alloc(10*1024*1024+1),413],[Buffer.from('<script>fake PDF</script>'),415]])await assert.rejects(upload(data),e=>e.statusCode===status);
 assert.equal(await Receipt.countDocuments({}),0);
 const samples=[['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([255,216,255,1])],['image/webp',Buffer.from('RIFF0000WEBP')],['image/heic',Buffer.from('0000ftypheic0000')]];
 for(const [mime,data]of samples){const r=await upload(data,'../../wrong.pdf');assert.equal(r.mimeType,mime);assert.equal(r.originalFilename,'wrong.pdf');}
});
test('bounded multipart parsing accepts a real file and rejects malformed duplicate and streamed oversized bodies',async()=>{
 async function event(form){const request=new Request('http://localhost',{method:'POST',body:form});return {node:{req:Object.assign(require('node:stream').Readable.from(Buffer.from(await request.arrayBuffer())),{headers:Object.fromEntries(request.headers)})}};}
 const form=new FormData();form.append('file',new Blob([bytes]),'synthetic.pdf');assert.deepEqual((await service.readReceiptUpload(await event(form))).bytes,bytes);
 form.append('file',new Blob([bytes]),'second.pdf');await assert.rejects(service.readReceiptUpload(await event(form)),e=>e.statusCode===400);
 const req=Object.assign(require('node:stream').Readable.from([Buffer.alloc(6*1024*1024),Buffer.alloc(5*1024*1024)]),{headers:{'content-type':'multipart/form-data; boundary=synthetic'}});
 await assert.rejects(service.readReceiptUpload({node:{req}}),e=>e.statusCode===413);
});
test('compiled upload page retries a saved file and lost attachment response without duplicating the visible receipt',async()=>{
 const record={id:String(id()),status:'unmatched',linkVersion:0},transaction=String(id());let linked=false,lost=true,uploads=0;
 const page=require('./helpers/receipt-upload-page.cjs')({route:vue.reactive({query:{transactionId:transaction}}),fetch:async(url,options)=>{
  if(url==='/api/receipts/upload'){uploads++;return {receipt:{...record,...(linked?{status:'matched',transactionId:transaction,linkVersion:1}:{})}};}
  assert.equal(url,'/api/transactions/'+transaction+'/receipt');assert.equal(options.body.linkVersion,0);linked=true;if(lost){lost=false;throw Error('Lost successful link response');}return {receipt:{...record,status:'matched',transactionId:transaction,linkVersion:1}};
 }});
 try{const file=new File([bytes],'synthetic.pdf',{type:'application/pdf'});await page.state.processFiles([file]);assert.equal(page.state.errorMessage.value,'receiptUpload.linkError');assert.equal(page.state.receipts.value.length,1);await page.state.processFiles([file]);assert.equal(uploads,2);assert.equal(page.state.receipts.value.length,1);assert.equal(page.state.uploadedFiles.value.length,1);assert.equal(page.state.receiptStats.value.matched,1);assert.equal(page.state.isUploading.value,false);}finally{page.close();}
});
test('compiled upload page clears old-company results and cannot attach after a company switch',async()=>{
 let release,attached=false;const page=require('./helpers/receipt-upload-page.cjs')({route:vue.reactive({query:{transactionId:String(id())}}),fetch:async url=>{if(url==='/api/receipts/upload')return new Promise(r=>{release=r;});attached=true;}});
 try{const request=page.state.processFiles([new File([bytes],'synthetic.pdf')]);page.user.authHeader={Authorization:'Synthetic B'};release({receipt:{id:String(id()),linkVersion:0}});await request;assert.equal(attached,false);assert.equal(page.state.receipts.value.length,0);assert.equal(page.state.isUploading.value,false);}finally{page.close();}
});
test('authenticated download client saves verified response bytes and discards a response from a previous session',async()=>{
 const user={authHeader:{Authorization:'Synthetic A'}},saved=[],revoked=[];let release;
 const client=load('composables/useReceiptFiles.ts',{vue,'~/stores/user':{useUserStore:()=>user}},{useI18n:()=>({t:k=>k}),$fetch:async(url,options)=>{assert.match(url,/^\/api\/receipts\/[a-f0-9]{24}\/file$/);assert.equal(options.headers.Authorization,'Synthetic A');return new Promise(r=>release=r);},URL:{createObjectURL:blob=>{saved.push(blob);return 'blob:synthetic';},revokeObjectURL:url=>revoked.push(url)},document:{createElement:()=>({click(){}})},setTimeout:fn=>fn()}).useReceiptFiles();
 let p=client.downloadReceipt(String(id()));const blob=new Blob([bytes]);release(blob);assert.equal(await p,true);assert.equal(saved[0],blob);assert.deepEqual(revoked,['blob:synthetic']);
 p=client.downloadReceipt(String(id()));user.authHeader={Authorization:'Synthetic B'};release(blob);assert.equal(await p,false);assert.equal(saved.length,1);
});
test('long Unicode filenames retain complete characters for the download header',async()=>{
 const name='a'.repeat(199)+'\u{1f4c4}'+'extra.pdf',r=await upload(bytes,name);
 const original=await service.downloadReceiptFile(ctx,r.id);assert.equal(Array.from(original.name).length,200);assert.doesNotThrow(()=>encodeURIComponent(original.name));
});
test('the real receipt store excludes late uploads from a previous company and deduplicates retries',async()=>{
 const pinia=require('pinia');pinia.setActivePinia(pinia.createPinia());let release;
 const user={authHeader:{Authorization:'Synthetic A'}},store=load('stores/receipt.ts',{pinia,'~/stores/user':{useUserStore:()=>user}},{$fetch:async()=>new Promise(r=>release=r)}).useReceiptStore();
 const r={id:String(id()),status:'unmatched',filename:'synthetic.pdf'},form=new FormData();
 let p=store.uploadReceipt(form);user.authHeader={Authorization:'Synthetic B'};release({receipt:r});assert.equal(await p,null);assert.equal(store.receipts.length,0);
 for(let i=0;i<2;i++){p=store.uploadReceipt(form);release({receipt:r});await p;}assert.equal(store.receipts.length,1);
});
test('oversized chunked HTTP input receives 413 without a connection reset',async()=>{
 const app=h3.createApp();app.use(h3.defineEventHandler(async event=>service.readReceiptUpload(event)));
 const server=require('node:http').createServer(h3.toNodeListener(app));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const body=require('node:stream').Readable.from([Buffer.alloc(6*1024*1024),Buffer.alloc(5*1024*1024)]);
  const response=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=synthetic'},body,duplex:'half'});
  assert.equal(response.status,413);await response.text();
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

// Selected-company CSV import, backup export and restore (final review F1/F2). Actual built native HTTP only; owned synthetic
// MongoDB and temp data dir; no provider/model/business sends. OMF_IMPORT_RESTORE_PART chooses legs (import,restore,export,navi,browser).
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const{spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_IMPORT_RESTORE_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const DB='import_restore_regression',EXPENSE='支出',PASSWORD='Synthetic-password-Only1!';
const parts=(process.env.OMF_IMPORT_RESTORE_PART||'import,restore,export,navi,browser').split(',').map(s=>s.trim()).filter(Boolean),has=p=>parts.includes(p);
async function main(){
 let mongo,client,child,directory,logs='',groups=0;const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-import-restore-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri(DB),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  const start=async()=>{
   // The server's upload/processed files go to an owned working directory, never into the checkout.
   const work=path.join(directory,'cwd');await fsp.mkdir(work,{recursive:true});
   child=spawn(process.execPath,[path.join(root,'.output/server/index.mjs')],{cwd:work,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',SLACK_BOT_TOKEN:''},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-60000)})}
   for(let i=0;i<150;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,DB);return}}catch{}await pause(200)}throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  };
  const stop=async()=>{if(child){child.kill();await child.closed;child=null}};await start();client=await MongoClient.connect(uri);const db=client.db(DB);
  const api=async(route,token,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}return{status:response.status,raw,data,headers:response.headers}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'import-restore:positive '+method+' '+route+' '+r.raw.slice(0,300));return r};
  const people=[];for(const [i,role]of['owner','admin','member','viewer','outsider'].entries()){const email='import-restore-'+i+'@example.invalid',r=await ok('/api/auth/register',null,'POST',{email,password:PASSWORD,name:'Synthetic '+role});const user=await db.collection('users').findOne({email});people.push({id:user._id,email,role,token:r.data.tokens.accessToken})}
  const A=new ObjectId(),B=new ObjectId(),organizations=db.collection('organizations'),now=new Date(),members=people.slice(0,4).map(p=>({userId:p.id,role:p.role,joinedAt:now}));
  await organizations.insertMany([{_id:A,name:'Synthetic import company A',slug:'import-a',isActive:true,members},{_id:B,name:'Synthetic import company B',slug:'import-b',isActive:true,members:[{userId:people[0].id,role:'owner',joinedAt:now}]}]);
  for(const p of people.slice(0,4))p.companyToken=(await ok('/api/auth/switch-organization',p.token,'POST',{organizationId:String(A)})).data.tokens.accessToken;
  const owner=people[0],tokenA=owner.companyToken,tokenB=(await ok('/api/auth/switch-organization',owner.token,'POST',{organizationId:String(B)})).data.tokens.accessToken;
  const outsider=jwt.sign({userId:String(people[4].id),email:people[4].email,organizationId:String(A),role:'owner',type:'access'},secret,{expiresIn:'30m'});
  const transactions=db.collection('transactions'),recurring=db.collection('recurringpayments'),receipts=db.collection('receipts'),templates=db.collection('mappingtemplates');
  // Another company's and held (no company) records in every backup collection, plus one shared mapping template: never touched by A.
  const day=s=>new Date(s+'T00:00:00.000Z');
  await transactions.insertMany([{_id:new ObjectId(),organizationId:B,referenceNumber:'FOREIGN-REF-1',date:day('2026-02-01'),amount:500,type:EXPENSE,status:'completed',hasReceipt:false,notes:'DUP_NOTE',productName:'FOREIGN_PRIVATE_TX',createdAt:now,updatedAt:now},{_id:new ObjectId(),referenceNumber:'HELD-REF-1',date:day('2026-02-01'),amount:500,type:EXPENSE,status:'completed',hasReceipt:false,notes:'DUP_NOTE',productName:'HELD_PRIVATE_TX',createdAt:now,updatedAt:now}]);
  const recurringRow=(extra)=>({_id:new ObjectId(),amount:7,currency:'JPY',transactionType:EXPENSE,frequency:'monthly',startDate:day('2026-01-01'),nextDueDate:day('2026-01-01'),status:'active',source:'manual',autoGenerate:false,generatedTransactionIds:[],createdAt:now,updatedAt:now,...extra});
  await recurring.insertMany([recurringRow({organizationId:B,name:'FOREIGN_PRIVATE_RECURRING',customer:{name:'Foreign payee'}}),recurringRow({name:'HELD_PRIVATE_RECURRING',customer:{name:'Held payee'}}),recurringRow({organizationId:B,name:'SHARED_NAME_RECURRING',customer:{name:'Shared payee'}})]);
  await receipts.insertMany([{_id:new ObjectId(),organizationId:B,filename:'foreign.pdf',originalFilename:'FOREIGN_PRIVATE_RECEIPT.pdf',size:1,status:'unmatched',uploadDate:now,createdAt:now,updatedAt:now},{_id:new ObjectId(),filename:'held.pdf',originalFilename:'HELD_PRIVATE_RECEIPT.pdf',size:1,status:'unmatched',uploadDate:now,createdAt:now,updatedAt:now}]);
  await templates.insertOne({_id:new ObjectId(),name:'SHARED_PRIVATE_TEMPLATE',sourceType:'custom',mappings:[],isDefault:false,createdAt:now,updatedAt:now});
  const guarded=async()=>JSON.stringify(await Promise.all([[transactions,{organizationId:{$ne:A}}],[recurring,{organizationId:{$ne:A}}],[receipts,{organizationId:{$ne:A}}],[templates,{}]].map(([c,f])=>c.find(f).sort({_id:1}).toArray())));
  const everything=async()=>JSON.stringify(await Promise.all(['transactions','recurringpayments','receipts','mappingtemplates','suppliers','customers'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const guardedBefore=await guarded(),seedIds=JSON.parse(guardedBefore).flat().map(r=>new ObjectId(r._id));
  const seeded=async()=>JSON.stringify(await Promise.all([transactions,recurring,receipts,templates].map(c=>c.find({_id:{$in:seedIds}}).sort({_id:1}).toArray())));const seededBefore=await seeded();
  const scopeA=async()=>({tx:await transactions.countDocuments({organizationId:A}),rec:await recurring.countDocuments({organizationId:A}),rcpt:await receipts.countDocuments({organizationId:A})});
  const listA=async(token=tokenA)=>(await ok('/api/transactions',token)).data.transactions;
  const denial=async(route,body,label)=>{const before=await everything();assert.equal((await api(route,null,'POST',body)).status,401,label+' no-auth');assert.equal((await api(route,'synthetic-invalid-token','POST',body)).status,401,label+' invalid-token');assert.equal((await api(route,owner.token,'POST',body)).status,403,label+' missing-company');assert.equal((await api(route,outsider,'POST',body)).status,403,label+' current-membership');
   await organizations.updateOne({_id:A},{$pull:{members:{userId:owner.id}}});assert.equal((await api(route,tokenA,'POST',body)).status,403,label+' current-membership');await organizations.updateOne({_id:A},{$set:{members,isActive:false}});assert.equal((await api(route,tokenA,'POST',body)).status,403,label+' inactive-company');await organizations.updateOne({_id:A},{$set:{isActive:true}});assert.equal(await everything(),before,label+' denied-no-write')};

  // Navi reads use the same company transactions (worker routes, synthetic job; no model): imported and restored rows are visible, foreign/held rows never.
  let navi=null,slot=0;const naviRead=async(name,args)=>{if(!navi){const card=(await ok('/api/finance/accounts',owner.token,'POST',{name:'Synthetic import card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).data.account;
    const agent=(await ok('/api/finance-chat/agents',owner.token,'POST',{accountIds:[card._id],workspaceEnabled:true})).data,worker=(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);assert.equal((await worker('heartbeat')).status,200);
    const endpoint='/api/finance-chat/company-workspace',view=(await ok(endpoint,tokenA)).data;await ok(endpoint,tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),text:'List the imported and restored transactions.',chatRevision:view.conversation?.revision||0,context:{page:'transactions'}});
    const job=(await worker('workspace-claim')).data.job;assert.ok(job,'navi:claim');navi={worker,job}}
   assert.equal((await navi.worker('heartbeat',{job:{mode:'workspace',id:navi.job.id,lease:navi.job.lease}})).status,200,'navi:lease');return navi.worker('workspace/'+navi.job.id+'/actions',{lease:navi.job.lease,name,args,slot:++slot})};

  if(has('import')){
   // F1: Transactions > Import saves into the token-selected company only; forged body/query/row/mapping company is ignored.
   const account=new ObjectId();await db.collection('accountcategories').insertOne({_id:account,name:'IMPORT_ACCOUNT',type:'expense',code:'SYN',createdAt:now,updatedAt:now});
   const mappings={'日付':{field:'date'},'金額':{field:'amount'},'備考':{field:'notes'},'商品名':{field:'productName'},'仕入れ先':{field:'supplierName'},'勘定科目':{field:'accountCategoryName'},'会社':{field:'organizationId'}};
   const row=(date,amount,notes,product,extra={})=>({'日付':date,'金額':amount,'備考':notes,'商品名':product,'会社':String(B),...extra});
   const imported=await ok('/api/transactions/import?organizationId='+B,tokenA,'POST',{data:[row('2026/03/01','1,200','IMPORT_A_NOTE','IMPORT_A_PRODUCT',{'仕入れ先':'IMPORT_SUPPLIER','勘定科目':'IMPORT_ACCOUNT'}),row('2026/03/02','0','IMPORT_ZERO_NOTE','IMPORT_ZERO_PRODUCT')],mappings,options:{skipDuplicates:true},source:'csv',fileName:'synthetic.csv',organizationId:String(B)});
   assert.equal(imported.data.success,true);assert.equal(imported.data.results.imported,2,'import:imported-count');assert.deepEqual(imported.data.results.errors,[]);
   const first=await transactions.findOne({productName:'IMPORT_A_PRODUCT'}),zero=await transactions.findOne({productName:'IMPORT_ZERO_PRODUCT'});assert.ok(first&&zero,'import:imported-count');
   assert.equal(String(first.organizationId),String(A),'import:selected-company');assert.equal(first.organizationId?._bsontype,'ObjectId','import:selected-company');assert.equal(String(zero.organizationId),String(A),'import:selected-company');
   assert.equal(imported.data.transactions.every(t=>t.organizationId===String(A)),true,'import:response-company');
   assert.equal(first.amount,1200);assert.equal(zero.amount,0,'import:zero-amount');assert.equal(first.type,EXPENSE);assert.equal(first.status,'completed');assert.equal(String(first.accountCategoryId),String(account),'import:reference-name');assert.ok(first.supplierId,'import:reference-name');
   assert.deepEqual(first.timeline.map(e=>e.type),['imported','created'],'import:timeline');assert.match(first.timeline[0].description,/synthetic\.csv/);assert.equal(first.metadata.importBatchId,imported.data.batchId,'import:batch');assert.equal(first.metadata.importSource,'csv');assert.ok(first.tags.includes('batch:'+imported.data.batchId));assert.equal(first.ownerId,undefined);
   const ids=[String(first._id),String(zero._id)];let list=await listA();for(const id of ids)assert.ok(list.some(t=>t._id===id),'import:visible-list');
   assert.equal((await ok('/api/transactions/'+first._id,tokenA)).data.productName,'IMPORT_A_PRODUCT','import:visible-detail');assert.ok((await ok('/api/transactions?stats=true',tokenA)).data.stats.total.count>=2,'import:visible-stats');
   const exported=await ok('/api/transactions/export?format=json-full',tokenA);for(const id of ids)assert.ok(exported.data.some(t=>t._id===id),'import:visible-export');
   assert.ok(!(await listA(tokenB)).some(t=>ids.includes(t._id)),'import:foreign-hidden');assert.equal((await api('/api/transactions/'+first._id,tokenB)).status,404,'import:foreign-hidden');
   assert.equal(await guarded(),guardedBefore,'import:foreign-preserved');
   pass('CSV import saves every row into the token-selected company (forged body/query/row/mapping company ignored), keeps parsing, zero amount, reference names, timeline and batch, and is visible through company list/detail/stats/export only');

   // Company-scoped duplicate rule: another company's or a held row with the same date/amount/note is not this company's duplicate.
   const dup=await ok('/api/transactions/import',tokenA,'POST',{data:[row('2026/02/01','500','DUP_NOTE','IMPORT_DUP_PRODUCT')],mappings,options:{skipDuplicates:true}});assert.equal(dup.data.results.imported,1,'import:company-duplicate');assert.equal(dup.data.results.skipped,0,'import:company-duplicate');
   const again=await ok('/api/transactions/import',tokenA,'POST',{data:[row('2026/02/01','500','DUP_NOTE','IMPORT_DUP_PRODUCT')],mappings,options:{skipDuplicates:true}});assert.equal(again.data.results.skipped,1,'import:own-duplicate');assert.equal(again.data.results.imported,0,'import:own-duplicate');
   const bDup=await ok('/api/transactions/import',tokenB,'POST',{data:[row('2026/02/01','500','DUP_NOTE','IMPORT_B_DUP')],mappings,options:{skipDuplicates:true}});assert.equal(bDup.data.results.skipped,1,'import:own-duplicate');
   pass('duplicate skipping compares only the selected company rows');

   // Denials write nothing (no transaction, supplier or customer); every existing member role can import.
   await denial('/api/transactions/import',{data:[row('2026/03/05','5','DENIED','DENIED_PRODUCT',{'仕入れ先':'DENIED_SUPPLIER'})],mappings,options:{}},'import:denied');
   for(const p of people.slice(0,4)){const r=await ok('/api/transactions/import',p.companyToken,'POST',{data:[row('2026/03/06','6','ROLE_'+p.role,'ROLE_PRODUCT_'+p.role)],mappings,options:{}});assert.equal(r.data.results.imported,1,'import:legitimate-role');assert.equal(String((await transactions.findOne({productName:'ROLE_PRODUCT_'+p.role})).organizationId),String(A),'import:legitimate-role')}
   const bad=await ok('/api/transactions/import',tokenA,'POST',{data:[row('2026/03/07','not-a-number','BAD','BAD_PRODUCT'),row('2026/13/45','5','BAD_DATE','BAD_DATE_PRODUCT')],mappings,options:{}});assert.equal(bad.data.results.imported,0);assert.equal(bad.data.results.errors.length,2,'import:row-errors');
   assert.equal((await api('/api/transactions/import',tokenA,'POST',{mappings})).status,400,'import:bad-request');assert.equal((await api('/api/transactions/import',tokenA,'GET')).status,405);
   pass('missing/forged/removed/inactive company imports write nothing at all; all member roles import into the selected company; row and request errors unchanged');

   // One original insert carries the company (profiler), parallel imports keep their own company, restart keeps the rows visible.
   await db.command({profile:2,slowms:0});await ok('/api/transactions/import',tokenA,'POST',{data:[row('2026/03/08','8','PROFILED','PROFILED_PRODUCT')],mappings,options:{}});await db.command({profile:0});
   const inserts=(await db.collection('system.profile').find({op:'insert',ns:DB+'.transactions'}).toArray()).filter(p=>JSON.stringify(p.command).includes('PROFILED_PRODUCT'));assert.equal(inserts.length,1,'import:one-insert');assert.equal(String(inserts[0].command.documents[0].organizationId),String(A),'import:one-insert');
   assert.equal((await db.collection('system.profile').find({op:'update',ns:DB+'.transactions'}).toArray()).length,0,'import:one-insert');
   const parallel=await Promise.all(Array.from({length:8},(_,i)=>api('/api/transactions/import',i%2?tokenA:tokenB,'POST',{data:[row('2026/03/1'+i,String(10+i),'PARALLEL_'+i,'PARALLEL_PRODUCT_'+i)],mappings,options:{skipDuplicates:true}})));
   for(let i=0;i<8;i++){assert.equal(parallel[i].status,200);assert.equal(String((await transactions.findOne({productName:'PARALLEL_PRODUCT_'+i})).organizationId),String(i%2?A:B),'import:parallel-company')}
   const same=await Promise.all([0,1].map(()=>api('/api/transactions/import',tokenA,'POST',{data:[row('2026/03/20','20','SAME_PARALLEL','SAME_PARALLEL_PRODUCT')],mappings,options:{skipDuplicates:true}})));const sameRows=await transactions.find({productName:'SAME_PARALLEL_PRODUCT'}).toArray();
   assert.ok(same.every(r=>r.status===200)&&sameRows.length>=1&&sameRows.length<=2&&sameRows.every(r=>String(r.organizationId)===String(A)),'import:parallel-company');console.log('NOTE import duplicate check is not atomic: two simultaneous identical imports stored '+sameRows.length+' row(s), both in the selected company (no exactly-once claim)');
   await stop();await start();assert.ok((await listA()).some(t=>t._id===ids[0]),'import:restart-visible');assert.equal(await seeded(),seededBefore,'import:foreign-preserved');
   pass('company is in the one original insert; parallel imports stay in their own company; restart keeps imported rows visible; foreign and held rows unchanged');
   if(has('navi')){const mine=await naviRead('list_company_transactions',{limit:50,search:'IMPORT_A_PRODUCT'});assert.equal(mine.status,200,'navi:imported-visible '+mine.raw.slice(0,200));assert.ok(mine.raw.includes('IMPORT_A_PRODUCT'),'navi:imported-visible');
    const other=await naviRead('list_company_transactions',{limit:50,search:'PARALLEL_PRODUCT'});assert.ok(other.raw.includes('PARALLEL_PRODUCT_1')&&!other.raw.includes('PARALLEL_PRODUCT_0'),'navi:foreign-hidden');const held=await naviRead('list_company_transactions',{limit:50,search:'PRIVATE'});assert.ok(!/FOREIGN_PRIVATE|HELD_PRIVATE/.test(held.raw),'navi:foreign-hidden');
    pass('company Navi reads see the imported rows of the selected company and never another company or held rows')}
  }

  const backup=(extra)=>({version:'1.0',application:'ohmyfinance',createdAt:'2026-10-20T00:00:00.000Z',...extra});
  const restore=(token,data,options={},query='')=>api('/api/backup/restore'+query,token,'POST',{data,skipDuplicates:true,clearExisting:false,...options});
  const restoreOk=async(token,data,options,query)=>{const r=await restore(token,data,options,query);assert.equal(r.status,200,'restore:positive '+r.raw.slice(0,300));return r};
  const tx=(extra)=>({id:String(new ObjectId()),date:'2026-04-01T00:00:00.000Z',amount:700,type:EXPENSE,status:'completed',hasReceipt:false,...extra});
  const rec=(extra)=>({id:String(new ObjectId()),amount:9,currency:'JPY',transactionType:EXPENSE,frequency:'monthly',startDate:'2026-01-01T00:00:00.000Z',nextDueDate:'2026-01-01T00:00:00.000Z',status:'active',source:'manual',autoGenerate:false,customer:{name:'Restore payee'},...extra});
  const rcpt=(extra)=>({id:String(new ObjectId()),size:10,status:'unmatched',uploadDate:'2026-04-01T00:00:00.000Z',...extra});

  if(has('restore')){
   const guardedRestore=await guarded();// other companies' rows as they stand when this leg starts (the import leg legitimately adds company B rows)
   // F2: only rows recorded for the selected company are restored, into that company, with trusted creator and no internal markers.
   const plain=await restoreOk(tokenA,backup({transactions:[tx({organizationId:String(A),referenceNumber:'RESTORE-PLAIN-1',productName:'RESTORED_PLAIN_TX'})]}),{skipDuplicates:false});const plainRow=await transactions.findOne({productName:'RESTORED_PLAIN_TX'});
   assert.equal(plain.data.results.transactions.restored,1,'restore:own-restored');assert.ok(plainRow,'restore:own-restored');assert.equal(String(plainRow.organizationId),String(A),'restore:trusted-company');assert.ok((await listA()).some(t=>t.productName==='RESTORED_PLAIN_TX'),'restore:own-visible');
   const file=backup({transactions:[tx({organizationId:String(A),referenceNumber:'RESTORE-A-1',productName:'RESTORED_A_TX',naviOperation:{operationId:'FORGED_RESTORE',appliedAt:'2026-01-01T00:00:00.000Z'},cardAccounting:{key:'FORGED_CARD'},createdBy:String(people[4].id),timeline:[{type:'imported',title:'Synthetic',timestamp:'2026-04-01T00:00:00.000Z'}]}),tx({organizationId:String(B),referenceNumber:'RESTORE-B-1',productName:'RESTORE_FOREIGN_PRIVATE'}),tx({referenceNumber:'RESTORE-U-1',productName:'RESTORE_HELD_PRIVATE'}),'RESTORE_MALFORMED_PRIVATE',tx({organizationId:String(A),referenceNumber:'RESTORE-A-BAD',amount:'RESTORE_BAD_PRIVATE'})],
    recurringPayments:[rec({organizationId:String(A),name:'RESTORED_A_RECURRING',createdBy:String(people[4].id),naviOperation:{operationId:'FORGED_RECURRING'}}),rec({organizationId:String(B),name:'RESTORE_FOREIGN_RECURRING_PRIVATE'}),rec({name:'RESTORE_HELD_RECURRING_PRIVATE'})],
    receipts:[rcpt({organizationId:String(A),filename:'restored-a.pdf',originalFilename:'RESTORED_A_RECEIPT.pdf',uploadedBy:String(people[4].id)}),rcpt({organizationId:String(B),filename:'restored-b.pdf',originalFilename:'RESTORE_FOREIGN_RECEIPT_PRIVATE.pdf'})],
    mappingTemplates:[{id:String(new ObjectId()),name:'RESTORE_TEMPLATE_PRIVATE',sourceType:'custom',mappings:[]}]});
   const r=await restoreOk(tokenA,{...file},{organizationId:String(B)},'?organizationId='+B);
   const restoredTx=await transactions.findOne({productName:'RESTORED_A_TX'});assert.ok(restoredTx,'restore:own-restored');
   assert.equal(String(restoredTx.organizationId),String(A),'restore:trusted-company');assert.equal(restoredTx.organizationId?._bsontype,'ObjectId','restore:trusted-company');
   assert.equal(restoredTx.naviOperation,undefined,'restore:no-marker');assert.equal(restoredTx.cardAccounting,undefined,'restore:no-marker');assert.equal(restoredTx.createdBy,undefined,'restore:trusted-creator');assert.equal(restoredTx.amount,700);assert.equal(restoredTx.referenceNumber,'RESTORE-A-1');assert.deepEqual(restoredTx.timeline.map(e=>e.type),['imported']);
   for(const name of['RESTORE_FOREIGN_PRIVATE','RESTORE_HELD_PRIVATE'])assert.equal(await transactions.countDocuments({productName:name}),0,'restore:recorded-company-only');
   assert.equal(await transactions.countDocuments({referenceNumber:'RESTORE-A-BAD'}),0,'restore:invalid-not-written');
   const restoredRec=await recurring.findOne({name:'RESTORED_A_RECURRING'});assert.ok(restoredRec,'restore:own-restored');assert.equal(String(restoredRec.organizationId),String(A),'restore:trusted-company');assert.equal(String(restoredRec.createdBy),String(owner.id),'restore:trusted-creator');assert.equal(restoredRec.naviOperation,undefined,'restore:no-marker');
   for(const name of['RESTORE_FOREIGN_RECURRING_PRIVATE','RESTORE_HELD_RECURRING_PRIVATE'])assert.equal(await recurring.countDocuments({name}),0,'restore:recorded-company-only');
   const restoredRcpt=await receipts.findOne({filename:'restored-a.pdf'});assert.ok(restoredRcpt,'restore:own-restored');assert.equal(String(restoredRcpt.organizationId),String(A),'restore:trusted-company');assert.equal(String(restoredRcpt.uploadedBy),String(owner.id),'restore:trusted-creator');assert.equal(await receipts.countDocuments({filename:'restored-b.pdf'}),0,'restore:recorded-company-only');
   assert.equal(await templates.countDocuments({name:'RESTORE_TEMPLATE_PRIVATE'}),0,'restore:shared-template-skipped');
   const res=r.data.results;assert.equal(res.transactions.restored,1,'restore:counts');assert.equal(res.transactions.skipped,4,'restore:counts');assert.deepEqual(res.transactions.reasons,{other_company:1,unassigned:1,malformed:1,invalid:1},'restore:skip-reasons');
   assert.equal(res.recurringPayments.restored,1);assert.deepEqual(res.recurringPayments.reasons,{other_company:1,unassigned:1},'restore:skip-reasons');assert.equal(res.receipts.restored,1);assert.deepEqual(res.receipts.reasons,{other_company:1},'restore:skip-reasons');
   assert.equal(res.mappingTemplates.restored,0);assert.deepEqual(res.mappingTemplates.reasons,{shared_template:1},'restore:shared-template-skipped');assert.equal(r.data.scope.organizationId,String(A),'restore:scope');assert.equal(r.data.totals.restored,3);
   assert.ok(!/PRIVATE|FORGED/.test(r.raw),'restore:safe-result');
   assert.ok((await listA()).some(t=>t.productName==='RESTORED_A_TX'),'restore:own-visible');assert.equal((await ok('/api/transactions/'+restoredTx._id,tokenA)).data.referenceNumber,'RESTORE-A-1','restore:own-visible');
   assert.ok((await ok('/api/recurring',tokenA)).data.some(p=>p.name==='RESTORED_A_RECURRING'),'restore:own-visible');assert.ok((await ok('/api/receipts',tokenA)).raw.includes('restored-a.pdf'),'restore:own-visible');
   assert.ok(!(await listA(tokenB)).some(t=>t.productName==='RESTORED_A_TX'),'restore:foreign-hidden');assert.ok(!(await ok('/api/recurring',tokenB)).data.some(p=>p.name==='RESTORED_A_RECURRING'),'restore:foreign-hidden');
   assert.equal(await guarded(),guardedRestore,'restore:foreign-preserved');
   pass('restore writes only rows recorded for the selected company, into that company with the current actor as creator and no Navi/card authority markers; other-company, held, malformed and invalid rows are skipped with reasons and the restored rows are visible on the company pages');

   // Duplicates are this company's only; a missing reference is never a duplicate; a retry of the same file restores nothing twice.
   const dupFile=backup({transactions:[tx({organizationId:String(A),referenceNumber:'FOREIGN-REF-1',productName:'RESTORE_SAME_REF_AS_FOREIGN'}),tx({organizationId:String(A),productName:'RESTORE_NO_REF'})],recurringPayments:[rec({organizationId:String(A),name:'SHARED_NAME_RECURRING',customer:{name:'Shared payee'}})],receipts:[rcpt({organizationId:String(A),filename:'foreign.pdf',originalFilename:'same-name.pdf'})]});
   for(const t of dupFile.transactions)delete t.id;
   const d1=await restoreOk(tokenA,dupFile);assert.equal(d1.data.results.transactions.restored,2,'restore:company-duplicate');assert.equal(d1.data.results.recurringPayments.restored,1,'restore:company-duplicate');assert.equal(d1.data.results.receipts.restored,1,'restore:company-duplicate');
   assert.equal(await transactions.countDocuments({productName:'RESTORE_NO_REF'}),1,'restore:undefined-reference');
   const retryFile=backup({transactions:[tx({organizationId:String(A),referenceNumber:'RETRY-1',productName:'RETRY_TX_1'}),tx({organizationId:String(A),referenceNumber:'RETRY-2',productName:'RETRY_TX_2'})],recurringPayments:[rec({organizationId:String(A),name:'RETRY_RECURRING'})],receipts:[rcpt({organizationId:String(A),filename:'retry.pdf',originalFilename:'retry.pdf'})]});
   const first=await restoreOk(tokenA,retryFile);assert.equal(first.data.totals.restored,4);const second=await restoreOk(tokenA,retryFile);assert.equal(second.data.totals.restored,0,'restore:retry-skips');assert.equal(second.data.results.transactions.reasons.duplicate,2,'restore:retry-skips');assert.equal(second.data.results.recurringPayments.reasons.duplicate,1,'restore:retry-skips');assert.equal(second.data.results.receipts.reasons.duplicate,1,'restore:retry-skips');
   assert.equal(await transactions.countDocuments({productName:{$in:['RETRY_TX_1','RETRY_TX_2']}}),2,'restore:retry-skips');
   const bSame=await restoreOk(tokenB,backup({transactions:[tx({organizationId:String(B),referenceNumber:'RESTORE-A-1',productName:'RESTORE_B_SAME_REF'})]}));assert.equal(bSame.data.results.transactions.restored,1,'restore:company-duplicate');
   pass('duplicate checks compare only the selected company; rows without a reference are restored, not treated as duplicates; retrying the same file restores nothing twice');

   // clearExisting replaces only the selected company's section when the file holds that company's rows; nothing else is erased.
   const beforeClear=await scopeA(),guardedClear=await guarded();assert.ok(beforeClear.tx>1&&beforeClear.rec>0&&beforeClear.rcpt>0);
   const clearFile=backup({transactions:[tx({organizationId:String(A),referenceNumber:'CLEAR-A-1',productName:'CLEAR_A_TX'}),tx({organizationId:String(B),referenceNumber:'CLEAR-B-1',productName:'CLEAR_FOREIGN_PRIVATE'}),tx({referenceNumber:'CLEAR-U-1',productName:'CLEAR_HELD_PRIVATE'})],recurringPayments:[rec({organizationId:String(B),name:'CLEAR_FOREIGN_RECURRING_PRIVATE'}),rec({name:'CLEAR_HELD_RECURRING_PRIVATE'})],mappingTemplates:[{name:'CLEAR_TEMPLATE_PRIVATE',sourceType:'custom',mappings:[]}]});
   const cleared=await restoreOk(tokenA,clearFile,{clearExisting:true});const afterClear=await scopeA();
   assert.deepEqual((await transactions.find({organizationId:A}).toArray()).map(t=>t.productName),['CLEAR_A_TX'],'restore:clear-scoped');assert.equal(cleared.data.results.transactions.cleared,beforeClear.tx,'restore:clear-scoped');
   assert.equal(await guarded(),guardedClear,'restore:foreign-preserved');assert.equal(afterClear.rec,beforeClear.rec,'restore:no-eligible-no-clear');assert.equal(cleared.data.results.recurringPayments.cleared,0,'restore:no-eligible-no-clear');assert.equal(cleared.data.results.recurringPayments.clearSkipped,'no_selected_company_rows','restore:no-eligible-no-clear');
   assert.equal(afterClear.rcpt,beforeClear.rcpt,'restore:missing-section-no-clear');assert.equal(cleared.data.results.receipts.clearSkipped,'section_absent','restore:missing-section-no-clear');assert.equal(await templates.countDocuments({name:'SHARED_PRIVATE_TEMPLATE'}),1,'restore:foreign-preserved');
   const noScope=await restoreOk(tokenA,backup({transactions:[]}),{clearExisting:true});assert.equal(await transactions.countDocuments({organizationId:A}),1,'restore:unscoped-empty-no-clear');assert.equal(noScope.data.results.transactions.cleared,0,'restore:unscoped-empty-no-clear');
   await restoreOk(tokenA,backup({scope:{type:'company',organizationId:String(B)},transactions:[]}),{clearExisting:true});assert.equal(await transactions.countDocuments({organizationId:A}),1,'restore:foreign-snapshot-no-clear');
   const snapshot=await restoreOk(tokenA,backup({scope:{type:'company',organizationId:String(A)},transactions:[]}),{clearExisting:true});assert.equal(await transactions.countDocuments({organizationId:A}),0,'restore:empty-snapshot-clear');assert.equal(snapshot.data.results.transactions.cleared,1,'restore:empty-snapshot-clear');
   assert.equal(await guarded(),guardedClear,'restore:foreign-preserved');assert.equal((await scopeA()).rec,beforeClear.rec);assert.equal((await scopeA()).rcpt,beforeClear.rcpt);
   pass('clear-existing removes only the selected company section that the file replaces; a section without selected-company rows, a missing section, other companies, held rows and shared templates are never erased; an exact empty company snapshot clears only its own section');

   // Denials and unsafe input: nothing written, no private text in responses or logs; parallel restores keep their company.
   const deniedFile=backup({transactions:[tx({organizationId:String(A),referenceNumber:'DENIED-1',productName:'DENIED_RESTORE'})]});
   await denial('/api/backup/restore',{data:deniedFile,clearExisting:true},'restore:denied');assert.equal((await api('/api/backup/restore',tokenA,'GET')).status,405);
   let before=await everything();const badJson=await restore(tokenA,'{"version":"1.0","application":"ohmyfinance","transactions":[RESTORE_JSON_PRIVATE');assert.equal(badJson.status,400,'restore:safe-error');assert.ok(!badJson.raw.includes('RESTORE_JS'),'restore:safe-error');
   assert.equal((await restore(tokenA,{transactions:[]})).status,400,'restore:format');assert.equal((await api('/api/backup/restore',tokenA,'POST',{})).status,400,'restore:format');assert.equal(await everything(),before,'restore:denied-no-write');
   await receipts.createIndex({organizationId:1,filename:1},{unique:true});// the schema-declared company/filename index, ensured in the owned database
   const failing=await restoreOk(tokenA,backup({receipts:[rcpt({organizationId:String(A),filename:'RESTORE_DUP_FILE_PRIVATE.pdf',originalFilename:'one.pdf'}),rcpt({organizationId:String(A),filename:'RESTORE_DUP_FILE_PRIVATE.pdf',originalFilename:'two.pdf'})]}),{skipDuplicates:false});
   assert.equal(failing.data.results.receipts.restored,1);assert.equal(failing.data.results.receipts.failed,1,'restore:partial-failure');assert.ok(!failing.raw.includes('PRIVATE'),'restore:safe-error');await pause(100);assert.ok(!/RESTORE_[A-Z_]*PRIVATE|FORGED/.test(logs),'restore:safe-log');
   const parallel=await Promise.all(Array.from({length:6},(_,i)=>{const company=i%2?A:B;return restore(i%2?tokenA:tokenB,backup({transactions:[tx({organizationId:String(company),referenceNumber:'PAR-'+i,productName:'PARALLEL_RESTORE_'+i})]}))}));
   for(let i=0;i<6;i++){assert.equal(parallel[i].status,200,'restore:parallel-company');assert.equal(String((await transactions.findOne({productName:'PARALLEL_RESTORE_'+i})).organizationId),String(i%2?A:B),'restore:parallel-company')}
   const same=await Promise.all([0,1].map(()=>restore(tokenA,backup({transactions:[tx({organizationId:String(A),referenceNumber:'SAME-PAR',productName:'SAME_PARALLEL_RESTORE'})]}))));const sameRows=await transactions.find({productName:'SAME_PARALLEL_RESTORE'}).toArray();
   assert.ok(same.every(r=>r.status===200)&&sameRows.length>=1&&sameRows.length<=2&&sameRows.every(r=>String(r.organizationId)===String(A)),'restore:parallel-company');console.log('NOTE restore duplicate check is not atomic: two simultaneous identical restores stored '+sameRows.length+' row(s), both in the selected company (no exactly-once claim)');
   pass('missing/forged/removed/inactive company restores write nothing; malformed files are refused without echo; a failed row is counted without private log text; parallel restores stay in their own company');
   if(has('navi')){const id=String((await transactions.findOne({productName:'PARALLEL_RESTORE_1'}))._id),detail=await naviRead('get_company_transaction',{transactionId:id});assert.equal(detail.status,200,'navi:restored-visible '+detail.raw.slice(0,200));assert.ok(detail.raw.includes('PARALLEL_RESTORE_1'),'navi:restored-visible');
    const foreignId=String((await transactions.findOne({productName:'PARALLEL_RESTORE_0'}))._id);assert.equal((await naviRead('get_company_transaction',{transactionId:foreignId})).status,404,'navi:foreign-hidden');pass('company Navi reads a restored row of the selected company; another company restored row stays hidden')}
  }

  if(has('export')){
   // Same file pair: the backup download holds only the selected company's records and says so; it restores back into that company.
   const exportedRow=await (async()=>{await restoreOk(tokenA,backup({transactions:[tx({organizationId:String(A),referenceNumber:'EXPORT-A-1',productName:'EXPORT_A_TX'})],recurringPayments:[rec({organizationId:String(A),name:'EXPORT_A_RECURRING'})],receipts:[rcpt({organizationId:String(A),filename:'export-a.pdf',originalFilename:'export-a.pdf'})]}));return transactions.findOne({productName:'EXPORT_A_TX'})})();assert.ok(exportedRow);
   const r=await ok('/api/backup',tokenA),data=JSON.parse(r.raw);
   assert.deepEqual(data.scope,{type:'company',organizationId:String(A)},'export:scope-metadata');assert.equal(data.application,'ohmyfinance');assert.ok(data.version);
   for(const key of['transactions','recurringPayments','receipts'])assert.ok(data[key].length>0&&data[key].every(x=>x.organizationId===String(A)),'export:selected-company');
   assert.ok(!/FOREIGN_PRIVATE|HELD_PRIVATE|SHARED_PRIVATE_TEMPLATE|RESTORE_B_SAME_REF/.test(r.raw),'export:selected-company');assert.equal(data.mappingTemplates,undefined,'export:shared-excluded');assert.ok(data.excluded&&data.excluded.mappingTemplates&&data.excluded.unassigned,'export:shared-excluded');
   const counts=await scopeA();assert.deepEqual(data.counts,{transactions:counts.tx,receipts:counts.rcpt,recurringPayments:counts.rec,mappingTemplates:0},'export:counts');
   const download=await ok('/api/backup?format=download',tokenA);assert.match(download.headers.get('content-disposition')||'',/attachment; filename="ohmyfinance_backup_/,'export:download');
   const partial=JSON.parse((await ok('/api/backup?transactions=false&receipts=false',tokenA)).raw);assert.equal(partial.transactions,undefined,'export:options');assert.equal(partial.receipts,undefined,'export:options');assert.ok(Array.isArray(partial.recurringPayments));
   const bData=JSON.parse((await ok('/api/backup',tokenB)).raw);assert.equal(bData.scope.organizationId,String(B));assert.ok(!(bData.transactions||[]).some(t=>t.productName==='EXPORT_A_TX'),'export:selected-company');
   assert.equal((await api('/api/backup',null)).status,401,'export:denied');assert.equal((await api('/api/backup',owner.token)).status,403,'export:missing-company');assert.equal((await api('/api/backup',outsider)).status,403,'export:current-membership');
   const guardedRound=await guarded(),round=await restoreOk(tokenA,data,{clearExisting:true});assert.deepEqual(await scopeA(),counts,'export:round-trip');assert.equal(await guarded(),guardedRound,'export:round-trip');assert.equal(round.data.totals.skipped,0,'export:round-trip');
   assert.ok((await listA()).some(t=>t.productName==='EXPORT_A_TX'),'export:round-trip');
   pass('backup export contains only the selected company records with scope metadata, excludes held rows and shared templates, keeps download/options, and round-trips into the same company without touching others');
  }

  if(has('browser'))await require('./finance-company-import-restore-browser.cjs')({root,origin,db,ObjectId,A,B,owner,members,organizations,api,ok,pause,pass,transactions,recurring,receipts,guarded,backup,tx,rec,rcpt,password:PASSWORD,directory});
  console.log(groups+' Import restore groups passed');console.log('IMPORT_RESTORE_COMPLETE parts='+parts.join(','));
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

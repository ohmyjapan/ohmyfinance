// Supplier, customer and tax-category lists per company (plan omf-tenant-masters-20261026 §4 legs M1-M7 and W2). Actual built
// native HTTP against this script's own throwaway MongoDB; ambient database addresses are never used; no model, provider, bank,
// Intras, Slack or mail. Entirely synthetic companies, users and rows (no recorded case; the plan is scope-only).
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_COMPANY_MASTERS_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-company-masters-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:120000}});const dbName='company_masters_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-14000)});
  // Up to 60 s for the owned app to boot (a loaded machine must not become a false setup failure).
  let healthy=false;for(let i=0;i<300;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db(dbName),suppliers=db.collection('suppliers'),customers=db.collection('customers'),taxcategories=db.collection('taxcategories');
  const call=async(route,token,method='GET',body,raw=false)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':raw?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)}),text=await r.text();let data;try{data=JSON.parse(text)}catch{}return{status:r.status,data,raw:text}};
  const ok=async(route,token,method='GET',body,raw=false)=>{const r=await call(route,token,method,body,raw);assert.equal(r.status,200,'masters:positive '+method+' '+route+' '+r.raw.slice(0,350));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic company user'})).tokens.accessToken;
  const ownerToken=await register('company-owner@example.invalid'),strangerToken=await register('company-stranger@example.invalid');await register('company-outsider@example.invalid');
  const userId=async email=>(await db.collection('users').findOne({email}))._id;const owner=await userId('company-owner@example.invalid'),stranger=await userId('company-stranger@example.invalid'),outsider=await userId('company-outsider@example.invalid');
  const A=new ObjectId(),B=new ObjectId(),C=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];
  await db.collection('organizations').insertMany([{_id:A,name:'Synthetic company A',slug:'company-masters-a',isActive:true,members},{_id:B,name:'Synthetic company B',slug:'company-masters-b',isActive:true,members},{_id:C,name:'Synthetic company C',slug:'company-masters-c',isActive:true,members:[{userId:stranger,role:'owner',joinedAt:now}]}]);
  const switchTo=async(token,org)=>(await ok('/api/auth/switch-organization',token,'POST',{organizationId:String(org)})).tokens.accessToken;
  const tokenA=await switchTo(ownerToken,A),tokenB=await switchTo(ownerToken,B),tokenC=await switchTo(strangerToken,C);
  const forged=jwt.sign({userId:String(outsider),email:'company-outsider@example.invalid',organizationId:String(A),role:'owner',type:'access'},secret,{expiresIn:'5m'});
  const idOf=row=>String(row._id||row.id),ids=list=>(list||[]).map(idOf),sid=v=>String(v||'');
  const lists=[['suppliers','/api/suppliers',suppliers],['customers','/api/customers',customers],['taxcategories','/api/tax-categories',taxcategories]];

  // M6 (part 1): legacy rows with no company, inserted before any leg; they must be listed to nobody and stay byte-identical.
  const legacy={};for(const [name,,col] of lists){const r=await col.insertOne({name:'LEGACY_'+name.toUpperCase(),...(name==='taxcategories'?{rate:10}:{}),createdAt:now,updatedAt:now});legacy[name]={id:r.insertedId,bytes:JSON.stringify(await col.findOne({_id:r.insertedId}))}}
  const legacyUnchanged=async()=>{for(const [name,,col] of lists)assert.equal(JSON.stringify(await col.findOne({_id:legacy[name].id})),legacy[name].bytes,'masters:legacy-byte-identical '+name)};
  const noLegacy=(raw,tag)=>{for(const name of Object.keys(legacy))assert.ok(!raw.includes('LEGACY_'+name.toUpperCase())&&!raw.includes(String(legacy[name].id)),'masters:legacy-listed-to-nobody '+tag)};

  // M7: a token with no selected company reads no list; no token is 401; a forged membership and a revoked membership are 403.
  for(const [,route] of lists){assert.equal((await call(route,null)).status,401);assert.equal((await call(route,ownerToken)).status,403,'masters:company-required GET '+route);assert.equal((await call(route,ownerToken,'POST',{name:'NO_COMPANY_ROW'})).status,403,'masters:company-required POST '+route);assert.equal((await call(route,forged)).status,403,'masters:fresh-membership '+route)}
  for(const [,,col] of lists)assert.equal(await col.countDocuments({name:'NO_COMPANY_ROW'}),0,'masters:company-required');
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await call('/api/suppliers',tokenA)).status,403,'masters:fresh-membership revoked');await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  pass('list routes require a selected company with fresh membership; forged and revoked memberships read nothing');

  // M1: each company's rows are listed, read, updated and deleted only under that company.
  const rows={};
  for(const [name,route] of lists)for(const [tag,token] of [['A',tokenA],['B',tokenB]]){const body={name:'MASTER_'+name.toUpperCase()+'_'+tag,...(name==='taxcategories'?{rate:10}:name==='suppliers'?{companyName:'Synthetic operator '+tag}:{email:tag.toLowerCase()+'@example.invalid'})};rows[name+tag]=await ok(route,token,'POST',body)}
  for(const [name,route,col] of lists){
   for(const [tag,other,token] of [['A','B',tokenA],['B','A',tokenB]]){
    const list=await call(route,token);assert.equal(list.status,200);const listed=ids(list.data);
    assert.ok(listed.includes(idOf(rows[name+tag])),'masters:list-own '+name);assert.ok(!listed.includes(idOf(rows[name+other])),'masters:list-isolation '+name);assert.ok(!list.raw.includes('MASTER_'+name.toUpperCase()+'_'+other),'masters:list-isolation '+name);noLegacy(list.raw,name);
    const searched=await call(route+'?search=MASTER',token);assert.equal(searched.status,200);assert.deepEqual(ids(searched.data),[idOf(rows[name+tag])],'masters:list-isolation search '+name);
    const stored=await col.findOne({_id:new ObjectId(idOf(rows[name+tag]))});assert.equal(String(stored.organizationId),String(tag==='A'?A:B),'masters:create-stamped '+name);
   }
  }
  for(const [name,route,col] of [lists[0],lists[1]]){
   const own=idOf(rows[name+'A']),foreign=idOf(rows[name+'B']);
   assert.equal((await call(route+'/'+foreign,tokenA)).status,404,'masters:id-isolation GET '+name);
   assert.equal((await call(route+'/'+foreign,tokenA,'PUT',{name:'RENAMED_BY_A'})).status,404,'masters:id-isolation PUT '+name);
   assert.equal((await call(route+'/'+foreign,tokenA,'DELETE')).status,404,'masters:id-isolation DELETE '+name);
   assert.equal((await col.findOne({_id:new ObjectId(foreign)})).name,'MASTER_'+name.toUpperCase()+'_B','masters:id-isolation '+name);
   assert.equal((await call(route+'/'+legacy[name].id,tokenA)).status,404,'masters:legacy-listed-to-nobody id '+name);
   assert.equal(idOf(await ok(route+'/'+own,tokenA)),own);
   const updated=await ok(route+'/'+own,tokenA,'PUT',{name:'MASTER_'+name.toUpperCase()+'_A2',organizationId:String(B)});assert.equal(updated.name,'MASTER_'+name.toUpperCase()+'_A2');
   const after=await col.findOne({_id:new ObjectId(own)});assert.equal(String(after.organizationId),String(A),'masters:body-company-ignored PUT '+name);
   assert.equal((await call(route+'/'+own,forged)).status,403,'masters:fresh-membership id '+name);
  }
  pass('each company lists, reads, updates and deletes only its own suppliers, customers and tax categories; a foreign id is 404');

  // M2: a company named in the body is ignored on every create; the token company is stamped.
  for(const [name,route,col] of lists){const created=await ok(route,tokenA,'POST',{name:'FORGED_'+name.toUpperCase(),organizationId:String(B),...(name==='taxcategories'?{rate:8}:{})});const stored=await col.findOne({_id:new ObjectId(idOf(created))});assert.equal(String(stored.organizationId),String(A),'masters:body-company-ignored '+name);assert.ok(!ids((await call(route,tokenB)).data).includes(idOf(created)),'masters:body-company-ignored list '+name)}
  const vendor=await ok('/api/vendors',tokenA,'POST',{name:'FORGED_VENDOR',organizationId:String(B)});assert.equal(String((await suppliers.findOne({_id:new ObjectId(idOf(vendor.vendor))})).organizationId),String(A),'masters:body-company-ignored vendors');
  pass('a company named in a create body is ignored; rows carry the token company');

  // M3: the second supplier reader/writer (vendors), the import preview, the import auto-create and the tax seed are scoped.
  const vendorsB=await call('/api/vendors',tokenB);assert.equal(vendorsB.status,200);assert.ok(!ids(vendorsB.data.vendors).includes(idOf(rows.suppliersA))&&!ids(vendorsB.data.vendors).includes(idOf(vendor.vendor)),'masters:list-isolation vendors');assert.ok(ids(vendorsB.data.vendors).includes(idOf(rows.suppliersB)));noLegacy(vendorsB.raw,'vendors');
  assert.equal((await call('/api/vendors',ownerToken)).status,403,'masters:company-required vendors');
  const txB=await ok('/api/transactions',tokenB,'POST',{date:'2026-10-01',amount:1200,productName:'MASTER_TX_B',supplierId:idOf(rows.suppliersB)});
  const supplierBBefore=JSON.stringify(await suppliers.findOne({_id:new ObjectId(idOf(rows.suppliersB))}));
  const synced=await call('/api/vendors?sync=true',tokenA);assert.equal(synced.status,200,synced.raw.slice(0,200));
  assert.equal(JSON.stringify(await suppliers.findOne({_id:new ObjectId(idOf(rows.suppliersB))})),supplierBBefore,'masters:sync-isolation');
  assert.equal((await call('/api/transactions/import-preview',null,'POST',{supplierNames:['MASTER_SUPPLIERS_A2'],customerNames:[]})).status,401,'masters:preview-auth');
  assert.equal((await call('/api/transactions/import-preview',ownerToken,'POST',{supplierNames:['MASTER_SUPPLIERS_A2'],customerNames:[]})).status,403,'masters:preview-auth company');
  const preview=await ok('/api/transactions/import-preview',tokenA,'POST',{supplierNames:['MASTER_SUPPLIERS_A2','MASTER_SUPPLIERS_B','LEGACY_SUPPLIERS'],customerNames:['MASTER_CUSTOMERS_A2','MASTER_CUSTOMERS_B','LEGACY_CUSTOMERS']});
  assert.deepEqual(preview.newSuppliers,['MASTER_SUPPLIERS_B','LEGACY_SUPPLIERS'],'masters:preview-isolation');assert.deepEqual(preview.newCustomers,['MASTER_CUSTOMERS_B','LEGACY_CUSTOMERS'],'masters:preview-isolation');
  const imported=await ok('/api/transactions/import',tokenA,'POST',{data:[{date:'2026/10/02',amount:'1000',supplierName:'IMPORTED_SUP_A',customerName:'IMPORTED_CUS_A'},{date:'2026/10/03',amount:'1100',supplierName:'MASTER_SUPPLIERS_B'}],mappings:{}});
  assert.equal(imported.success,true);
  for(const [col,name] of [[suppliers,'IMPORTED_SUP_A'],[customers,'IMPORTED_CUS_A']]){const found=await col.find({name}).toArray();assert.equal(found.length,1,'masters:import-stamped '+name);assert.equal(String(found[0].organizationId),String(A),'masters:import-stamped '+name)}
  const sameName=await suppliers.find({name:'MASTER_SUPPLIERS_B'}).toArray();assert.equal(sameName.length,2,'masters:import-cache-scoped');assert.deepEqual(sameName.map(s=>String(s.organizationId)).sort(),[String(A),String(B)].sort(),'masters:import-cache-scoped');
  assert.ok(!(await call('/api/suppliers',tokenB)).raw.includes('IMPORTED_SUP_A'),'masters:list-isolation imported');
  assert.equal((await call('/api/seed',ownerToken,'POST')).status,403,'masters:company-required seed');
  const taxBefore=ids((await call('/api/tax-categories',tokenB)).data);const seeded=await ok('/api/seed',tokenA,'POST');assert.ok(seeded.results.taxCategories.created>=1,'masters:seed-scoped '+JSON.stringify(seeded).slice(0,200));
  assert.deepEqual(ids((await call('/api/tax-categories',tokenB)).data),taxBefore,'masters:seed-scoped');
  assert.equal(await taxcategories.countDocuments({organizationId:A,name:'課税仕入'}),1,'masters:seed-scoped');assert.equal(await taxcategories.countDocuments({organizationId:B,name:'課税仕入'}),0,'masters:seed-scoped');
  const seededB=await ok('/api/seed',tokenB,'POST');assert.equal(seededB.results.taxCategories.created,seeded.results.taxCategories.created,'masters:seed-scoped B');assert.equal(await taxcategories.countDocuments({organizationId:B,name:'課税仕入'}),1,'masters:seed-scoped B');
  pass('vendors, import preview, import auto-create and the tax seed read and write only the token company');

  // REST create must reject foreign references before any transaction is saved.
  for(const [key,name] of [['supplierId','suppliers'],['customerId','customers'],['taxCategoryId','taxcategories']]){
   const productName='REST_FOREIGN_'+key;
   const r=await call('/api/transactions',tokenA,'POST',{date:'2026-10-05',amount:700,productName,[key]:idOf(rows[name+'B'])});
   assert.equal(r.status,400,'masters:foreign-create '+key);
   assert.equal(await db.collection('transactions').countDocuments({productName}),0,'masters:foreign-create no row');
   await ok('/api/transactions',tokenA,'POST',{date:'2026-10-05',amount:700,productName:'REST_OWN_'+key,[key]:idOf(rows[name+'A'])});
  }

  // M4: a foreign supplier, customer or tax category is not an existing reference for this company (REST update and Navi create).
  const txA=await ok('/api/transactions',tokenA,'POST',{date:'2026-10-01',amount:500,productName:'MASTER_TX_A'}),txAId=idOf(txA);
  const put=(body,token=tokenA)=>call('/api/transactions/'+txAId,token,'PUT',body);
  for(const [key,foreign] of [['supplierId',idOf(rows.suppliersB)],['customerId',idOf(rows.customersB)],['taxCategoryId',idOf(rows.taxcategoriesB)],['supplierId',String(legacy.suppliers.id)]]){const r=await put({[key]:foreign});assert.equal(r.status,400,'masters:foreign-reference '+key+' '+r.raw.slice(0,200))}
  for(const [key,own] of [['supplierId',idOf(rows.suppliersA)],['customerId',idOf(rows.customersA)],['taxCategoryId',idOf(rows.taxcategoriesA)]])assert.equal((await put({[key]:own})).status,200,'masters:own-reference '+key);
  const saved=await ok('/api/transactions/'+txAId,tokenA);assert.equal(String(saved.supplierId._id),idOf(rows.suppliersA));assert.equal(String(saved.taxCategoryId._id),idOf(rows.taxcategoriesA));
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic assigned card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={})=>call('/api/finance-chat/worker/'+route,agent.token,'POST',body);
  const endpoint='/api/finance-chat/company-workspace';
  const ask=async(token,text,context={page:'transactions'})=>{const view=await ok(endpoint,token);assert.equal((await worker('heartbeat')).status,200);await ok(endpoint,token,'POST',{requestId:crypto.randomBytes(16).toString('hex'),text,chatRevision:view.conversation?.revision||0,context});const job=(await worker('workspace-claim')).data.job;assert.ok(job,'SETUP claimed job');return job};
  const act=(job,name,args={},slot=1)=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const finish=async job=>assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic company master reply.',patch:{},quotes:{}}})).status,200);
  let job=await ask(tokenA,'Record a synthetic purchase with the other company supplier.');
  const foreignCreate=await act(job,'create_company_transaction',{date:'2026-10-05',amount:700,type:'支出',productName:'NAVI_TX_FOREIGN',supplierId:idOf(rows.suppliersB)},1);assert.equal(foreignCreate.status,400,'masters:foreign-reference navi '+foreignCreate.raw.slice(0,200));
  const ownCreate=await act(job,'create_company_transaction',{date:'2026-10-05',amount:700,type:'支出',productName:'NAVI_TX_OWN',supplierId:idOf(rows.suppliersA)},2);assert.equal(ownCreate.status,200,'masters:own-reference navi '+ownCreate.raw.slice(0,200));await finish(job);
  assert.equal(await db.collection('transactions').countDocuments({productName:'NAVI_TX_FOREIGN'}),0,'masters:foreign-reference navi');assert.equal(await db.collection('transactions').countDocuments({productName:'NAVI_TX_OWN',organizationId:A}),1);
  pass('a foreign supplier, customer or tax category is refused as a transaction reference on REST update and Navi create; own references save');

  // M5: owner intake (ownerId at read time) lists the member companies' rows only; a reference create stamps the token company.
  const {HEADERS}=await import(pathToFileURL(path.join(__dirname,'../shared/amex.mjs')).href); // the CSV shape is this script's own input, read from its repository, not from the app root under test
  const csv=rowsIn=>Buffer.from([HEADERS,...rowsIn].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')),row=(changes={})=>Object.assign(['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1234','',''],changes);
  const upload=async(token,accountId,card)=>idOf(await ok('/api/finance/accounts/'+accountId+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',token,'POST',csv([row({4:card}),row({2:'Synthetic second shop',4:card,5:'2345'})]),true));
  const importId=await upload(ownerToken,account._id,'12345');
  await suppliers.insertOne({name:'MASTER_SUPPLIERS_C',organizationId:C,createdAt:now,updatedAt:now});
  const links=await ok('/api/finance/imports/'+importId+'/merchant-links/2',ownerToken);const linkIds=ids(links.suppliers);
  assert.ok(linkIds.includes(idOf(rows.suppliersA))&&linkIds.includes(idOf(rows.suppliersB)),'masters:intake-member-companies');assert.ok(!links.suppliers.some(s=>s.name==='MASTER_SUPPLIERS_C'),'masters:intake-member-companies C');noLegacy(JSON.stringify(links),'intake');
  const strangerAccount=(await ok('/api/finance/accounts',strangerToken,'POST',{name:'Synthetic stranger card',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'s@example.invalid',otpMailbox:'s@example.invalid'})).account;
  const strangerImport=await upload(strangerToken,strangerAccount._id,'54321');const strangerLinks=await ok('/api/finance/imports/'+strangerImport+'/merchant-links/2',strangerToken);
  assert.deepEqual(strangerLinks.suppliers.map(s=>s.name),['MASTER_SUPPLIERS_C'],'masters:intake-member-companies stranger');
  const reference=(token,body)=>call('/api/finance/imports/'+importId+'/references',token,'POST',body);
  assert.equal((await reference(ownerToken,{field:'supplierId',name:'REF_SUP'})).status,403,'masters:intake-create-company-required');assert.equal(await suppliers.countDocuments({name:'REF_SUP'}),0);
  const refA=await reference(tokenA,{field:'supplierId',name:'REF_SUP'});assert.equal(refA.status,200,refA.raw.slice(0,200));assert.equal(String((await suppliers.findOne({_id:new ObjectId(refA.data.id)})).organizationId),String(A),'masters:intake-create-stamped');
  assert.ok(ids(refA.data.references.suppliers).includes(refA.data.id));assert.ok(!refA.data.references.suppliers.some(s=>s.name==='MASTER_SUPPLIERS_C'),'masters:intake-member-companies references');
  const refB=await reference(tokenB,{field:'customerId',name:'REF_CUS'});assert.equal(refB.status,200,refB.raw.slice(0,200));assert.equal(String((await customers.findOne({_id:new ObjectId(refB.data.id)})).organizationId),String(B),'masters:intake-create-stamped customer');
  const refB2=await reference(tokenB,{field:'customerId',name:'REF_CUS'});assert.equal(refB2.data.id,refB.data.id,'masters:intake-match-scoped same company');
  const refA2=await reference(tokenA,{field:'customerId',name:'REF_CUS'});assert.notEqual(refA2.data.id,refB.data.id,'masters:intake-match-scoped other company');assert.equal(String((await customers.findOne({_id:new ObjectId(refA2.data.id)})).organizationId),String(A));
  const refTax=await reference(tokenB,{field:'taxCategoryId',name:'REF_TAX',rate:8});assert.equal(refTax.status,200,refTax.raw.slice(0,200));assert.equal(String((await taxcategories.findOne({_id:new ObjectId(refTax.data.id)})).organizationId),String(B),'masters:intake-create-stamped tax');
  const refAcc=await reference(tokenA,{field:'accountCategoryId',name:'REF_ACC'});assert.equal(refAcc.status,200,refAcc.raw.slice(0,200));assert.equal((await db.collection('accountcategories').findOne({_id:new ObjectId(refAcc.data.id)})).organizationId,undefined,'masters:shared-master-unstamped');
  assert.equal((await reference(forged,{field:'supplierId',name:'REF_FORGED'})).status,403,'masters:fresh-membership intake');
  pass('owner intake lists the rows of every company the owner belongs to and nothing else; reference creates stamp and match the token company');

  // W2: the workflow worker reports its Intras account; the server stores it and uses it as the document target account.
  const workflowFor=async(token,accountId,connections)=>{
   const w=await ok('/api/finance-chat/agents',token,'POST',{accountIds:[accountId],researchEnabled:true}),req=(route,body,method='POST',auth=token)=>call('/api/finance-workflow/'+route,auth,method,body),ws=(route,body={})=>req('worker/'+route,body,'POST',w.token);
   const settings={revision:0,enabled:false,accountIds:[accountId],workerId:w.id,from:'2026-01-01',through:'2026-12-31'};assert.equal((await req('settings',settings,'PUT')).status,200);
   const bad=await ws('status',{capabilities:['purchase','inventory','shipment','documents'],connections:{intras:{account:'bad account!'}}});assert.equal(bad.status,400,'worker:account-validated '+bad.raw.slice(0,200));
   assert.equal((await ws('status',{capabilities:['purchase','inventory','shipment','documents'],...(connections?{connections}:{})})).status,200);
   const view=await ok('/api/finance-workflow/status',token);
   assert.equal((await req('settings',{...settings,revision:1,enabled:true},'PUT')).status,200);
   const ownerId=(await db.collection('financialaccounts').findOne({_id:new ObjectId(accountId)})).ownerId;
   await db.collection('financeworkflowconfigs').updateOne({ownerId},{$set:{firstRunAt:new Date(Date.now()-1000)}});
   const claimed=await ws('claim');assert.equal(claimed.status,200,claimed.raw.slice(0,200));const run=claimed.data.run;assert.ok(run,'SETUP workflow run');
   const purchaseId=new ObjectId(),step=(stage,state,unit)=>({stage,unit,state,reason:state,cycle:1,failedNights:0,lifetimeFailedNights:0,lastFailedDay:null,firstWaitingAt:null,lastCheckedAt:null,completedAt:null,snoozedUntil:null});
   await db.collection('financepurchaselinks').insertOne({_id:purchaseId,ownerId,archiveId:'synthetic-'+purchaseId,accountId:new ObjectId(accountId),importId:new ObjectId(),line:2,key:'synthetic-key-'+purchaseId,sourceHash:'0'.repeat(64),paymentKey:'synthetic-payment-'+purchaseId,status:'linked',revision:1,order:{kind:'online',orderNumber:'1234567',inventoryLinks:[{inventoryId:'WF-SYN-'+purchaseId,itemLine:1,shipments:[{orderId:'SYN-SHIP',tracking:'123456789012',date:'2026/10/03'}]}]},inventoryIds:['WF-SYN-'+purchaseId],originals:[],evidence:[],history:[]});
   await db.collection('financeworkflows').insertOne({ownerId,accountId:new ObjectId(accountId),importId:new ObjectId(),line:2,key:'synthetic-key-'+purchaseId,sourceHash:'0'.repeat(64),payment:{date:'2026-10-01',amount:9100,merchant:'Synthetic',card:'12345',accountName:'Synthetic',purpose:'customer'},purchaseId,version:1,revision:1,steps:{purchase:step('purchase','complete','purchase'),['documents_'+purchaseId]:step('documents','pending','WF-SYN-'+purchaseId)},events:[]});
   const context=await ws(run.id+'/context',{lease:run.lease});assert.equal(context.status,200,context.raw.slice(0,300));
   return {view,context:context.data};
  };
  const configured=await workflowFor(ownerToken,account._id,{intras:{account:'Synthetic-Buyer'}});
  assert.equal(configured.view.config.workerIntrasAccount,'synthetic-buyer','worker:status-account-stored '+JSON.stringify(configured.view.config).slice(0,300));
  assert.equal(configured.context.shipments.length,1,'worker:shipments-target '+JSON.stringify(configured.context.shipments).slice(0,300));assert.equal(configured.context.shipments[0].providerAccount,'synthetic-buyer','worker:provider-account');assert.equal(configured.context.shipments[0].orderId,'SYN-SHIP');
  const unconfigured=await workflowFor(strangerToken,strangerAccount._id,null);
  assert.equal(unconfigured.view.config.workerIntrasAccount??null,null,'worker:status-account-unset');assert.deepEqual(unconfigured.context.shipments,[],'worker:shipments-unset');
  pass('the worker-reported Intras account is stored, validated and used as the shipment document account; without a report there are no document targets');

  // M6 (part 2): the legacy rows were listed to nobody above and are byte-identical after every leg (no backfill).
  await legacyUnchanged();
  for(const [,route] of lists)for(const token of [tokenA,tokenB,tokenC])noLegacy((await call(route,token)).raw,'final '+route);
  pass('rows without a company are listed to nobody and are byte-identical after every leg');

  console.log(checks+' Company master groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();
  // Teardown of the owned memory server is not a verdict: a slow mongod exit on Windows is logged, never a failure after the marker.
  if(mongo)await mongo.stop({doCleanup:true,force:true}).catch(e=>console.error('owned mongod teardown: '+e.message));if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

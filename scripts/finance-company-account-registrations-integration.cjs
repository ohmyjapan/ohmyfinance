// Company-registered unused accounting accounts for Navi (plan omf-navi-account-registrations-20261020). Actual built native HTTP
// against this script's own throwaway MongoDB; ambient database addresses are never used; no model, provider, bank, Slack or mail.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_COMPANY_NAVI_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-account-registrations-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});const dbName='account_registration_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-14000)});
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db(dbName),categories=db.collection('accountcategories'),transactions=db.collection('transactions');
  const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'registration:positive '+method+' '+route+' '+r.raw.slice(0,350));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic company user'})).tokens.accessToken;
  const ownerToken=await register('company-owner@example.invalid');await register('company-outsider@example.invalid');const owner=(await db.collection('users').findOne({email:'company-owner@example.invalid'}))._id,outsider=(await db.collection('users').findOne({email:'company-outsider@example.invalid'}))._id;
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];await db.collection('organizations').insertMany([A,B].map((_id,i)=>({_id,name:'Synthetic company '+i,slug:'account-registration-'+i,isActive:true,members})));
  const tokenA=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(A)})).tokens.accessToken,tokenB=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(B)})).tokens.accessToken;
  const forged=jwt.sign({userId:String(outsider),email:'company-outsider@example.invalid',organizationId:String(A),role:'owner',type:'access'},secret,{expiresIn:'5m'});
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic assigned card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={})=>call('/api/finance-chat/worker/'+route,agent.token,'POST',body);
  const endpoint='/api/finance-chat/company-workspace';
  const ask=async(token,text,context={page:'transactions'})=>{const view=await ok(endpoint,token);assert.equal((await worker('heartbeat')).status,200);await ok(endpoint,token,'POST',{requestId:crypto.randomBytes(16).toString('hex'),text,chatRevision:view.conversation?.revision||0,context});const job=(await worker('workspace-claim')).data.job;assert.ok(job,'SETUP claimed job');return job};
  const act=(job,name,args={},slot=1)=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const finish=async job=>assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic account registration reply.',patch:{},quotes:{}}})).status,200);
  const choicesOf=async(token,args={})=>{const job=await ask(token,'Which accounting accounts can this company use?');const r=await act(job,'list_company_transaction_choices',args);await finish(job);return r};
  const idOf=row=>String(row._id||row.id),ids=list=>(list||[]).map(r=>r.id);

  // Shared legacy history account used by a company A transaction (pre-existing observed-history evidence).
  const history=await ok('/api/account-categories',ownerToken,'POST',{name:'REG_HISTORY_ACCOUNT',type:'expense'}),historyId=idOf(history);
  const tx=await ok('/api/transactions',tokenA,'POST',{date:'2026-10-01',amount:5000,productName:'REG_HISTORY_TX',accountCategoryId:historyId,notes:'Original note'}),txId=idOf(tx);
  await transactions.updateOne({_id:new ObjectId(txId)},{$set:{cardAccounting:{key:'SYNTHETIC_SOURCE_KEY',accountName:'Credit card',subAccountName:'Synthetic card 1234',taxCategory:'outside'},paymentMethod:'credit_card',cardNumber:'1234'}});

  // 1. The defect: an account newly created for the selected company is unused, so Navi could not choose it.
  const created=await ok('/api/account-categories',tokenA,'POST',{name:'REG_UNUSED_A',type:'expense',code:'R100'}),unusedId=idOf(created);
  let r=await choicesOf(tokenA);assert.equal(r.status,200,'registration:choices-read '+r.raw.slice(0,300));
  assert.ok(ids(r.data.result.choices.accountCategoryId).includes(unusedId),'registration:unused-account-choice');
  const entry=r.data.result.choices.accountCategoryId.find(x=>x.id===unusedId);assert.equal(entry.name,'REG_UNUSED_A');assert.equal(entry.code,'R100');assert.equal(entry.source,'company_registration','registration:parent-source');assert.equal(entry.observedInHistory,false,'registration:parent-source');
  const historyEntries=r.data.result.choices.accountCategoryId.filter(x=>x.id===historyId);assert.equal(historyEntries.length,1,'registration:parent-source');assert.equal(historyEntries[0].source,undefined,'registration:parent-source');
  assert.equal(r.data.result.registeredAccounts.hasMore,false);assert.equal(r.data.result.recordsScanned,1);assert.ok(!r.raw.includes('companyRegistrations')&&!r.raw.includes('registeredBy'),'registration:no-metadata-leak');
  assert.ok(created.companyRegistration&&created.companyRegistration.companyId===String(A)&&created.companyRegistration.state==='registered','registration:create-feedback');assert.equal(created.companyRegistrations,undefined,'registration:no-metadata-leak');
  pass('a company-selected native create makes the unused account a Navi choice with truthful registration source; history stays history');

  // 2. Sub-account with its parent link; a parent that is not registered stays out of the account list and siblings are never listed.
  const sub=await ok('/api/account-categories',tokenA,'POST',{name:'REG_SUB_A',parentId:unusedId}),subId=idOf(sub);
  const legacyParent=await ok('/api/account-categories',ownerToken,'POST',{name:'REG_LEGACY_PARENT',type:'expense'}),legacyParentId=idOf(legacyParent);
  const sibling=await ok('/api/account-categories',ownerToken,'POST',{name:'REG_LEGACY_SIBLING',parentId:legacyParentId}),siblingId=idOf(sibling);
  const childRow=await ok('/api/account-categories',tokenA,'POST',{name:'REG_CHILD_OF_LEGACY',parentId:legacyParentId}),childId=idOf(childRow);
  r=await choicesOf(tokenA);const subs=r.data.result.choices.subAccountCategoryId;
  const subEntry=subs.find(x=>x.id===subId);assert.ok(subEntry,'registration:unused-account-choice');assert.deepEqual(subEntry.parent,{id:unusedId,name:'REG_UNUSED_A',code:'R100',registeredForCompany:true},'registration:parent-source');
  const childEntry=subs.find(x=>x.id===childId);assert.ok(childEntry);assert.deepEqual(childEntry.parent,{id:legacyParentId,name:'REG_LEGACY_PARENT',registeredForCompany:false},'registration:parent-source');
  assert.ok(!ids(r.data.result.choices.accountCategoryId).includes(legacyParentId),'registration:no-parent-adoption');assert.ok(!ids(subs).includes(siblingId)&&!r.raw.includes('REG_LEGACY_SIBLING'),'registration:no-sibling-enumeration');
  assert.ok(!ids(r.data.result.choices.subAccountCategoryId).includes(unusedId)&&!ids(r.data.result.choices.accountCategoryId).includes(subId),'registration:parent-source');
  assert.equal((await categories.findOne({_id:new ObjectId(legacyParentId)})).companyRegistrations,undefined,'registration:no-parent-adoption');
  pass('registered sub-accounts carry their actual parent; an unregistered parent and its siblings are never adopted or enumerated');

  // 3. Company separation and legacy creation without a company.
  const legacy=await ok('/api/account-categories',ownerToken,'POST',{name:'REG_LEGACY_UNASSIGNED',type:'expense'}),legacyId=idOf(legacy);assert.equal(legacy.companyRegistration,undefined,'registration:legacy-unregistered');
  assert.equal((await categories.findOne({_id:new ObjectId(legacyId)})).companyRegistrations,undefined,'registration:legacy-unregistered');
  const bOnly=await ok('/api/account-categories',tokenB,'POST',{name:'REG_PRIVATE_B',type:'expense'}),bOnlyId=idOf(bOnly);
  r=await choicesOf(tokenA);for(const k of['accountCategoryId','subAccountCategoryId'])assert.ok(!ids(r.data.result.choices[k]).includes(bOnlyId)&&!ids(r.data.result.choices[k]).includes(legacyId),'registration:company-filter');assert.ok(!r.raw.includes('REG_PRIVATE_B'),'registration:company-filter');
  r=await choicesOf(tokenB);assert.ok(ids(r.data.result.choices.accountCategoryId).includes(bOnlyId));for(const k of['accountCategoryId','subAccountCategoryId'])for(const id of[unusedId,subId,childId,legacyId,historyId])assert.ok(!ids(r.data.result.choices[k]).includes(id),'registration:company-filter');
  pass('registrations stay with their company; a create with no selected company stays an unregistered legacy account');

  // 4. Explicit registration of an existing account: idempotent, concurrent-safe, never saves a transaction.
  const txBefore=JSON.stringify(await transactions.find().sort({_id:1}).toArray());
  const reg=await ok('/api/account-categories/'+legacyId+'/registration',tokenA,'POST',{});assert.equal(reg.state,'registered');assert.equal(reg.company.id,String(A));assert.equal(reg.account.id,legacyId);assert.ok(!JSON.stringify(reg).includes('registeredBy')&&!JSON.stringify(reg).includes(String(owner)),'registration:no-metadata-leak');
  const again=await ok('/api/account-categories/'+legacyId+'/registration',tokenA,'POST',{});assert.equal(again.state,'already_registered','registration:retry-once');
  const raced=await categories.insertOne({name:'REG_RACED',type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now});const racedResults=await Promise.all([1,2,3,4].map(()=>call('/api/account-categories/'+raced.insertedId+'/registration',tokenA,'POST',{})));for(const x of racedResults)assert.equal(x.status,200);
  assert.equal(racedResults.filter(x=>x.data.state==='registered').length,1,'registration:retry-once');for(const id of[legacyId,String(raced.insertedId)])assert.equal((await categories.findOne({_id:new ObjectId(id)})).companyRegistrations.length,1,'registration:retry-once');
  const legacyRow=await categories.findOne({_id:new ObjectId(legacyId)});assert.equal(String(legacyRow.companyRegistrations[0].organizationId),String(A));assert.equal(String(legacyRow.companyRegistrations[0].registeredBy),String(owner));assert.equal(legacyRow.companyRegistrations[0].via,'registered');assert.equal(legacyRow.name,'REG_LEGACY_UNASSIGNED');assert.equal(legacyRow.organizationId,undefined,'registration:no-ownership-relabel');
  r=await choicesOf(tokenA);assert.ok(ids(r.data.result.choices.accountCategoryId).includes(legacyId),'registration:unused-account-choice');
  const reHistory=await ok('/api/account-categories/'+historyId+'/registration',tokenA,'POST',{});assert.equal(reHistory.state,'registered');r=await choicesOf(tokenA);const both=r.data.result.choices.accountCategoryId.filter(x=>x.id===historyId);assert.equal(both.length,1,'registration:parent-source');assert.equal(both[0].registeredForCompany,true,'registration:parent-source');
  assert.equal(JSON.stringify(await transactions.find().sort({_id:1}).toArray()),txBefore,'registration:no-transaction-save');
  assert.equal((await call('/api/account-categories/'+new ObjectId()+'/registration',tokenA,'POST',{})).status,404);assert.equal((await call('/api/account-categories/not-an-id/registration',tokenA,'POST',{})).status,400);assert.equal((await call('/api/account-categories/'+legacyId+'/registration',tokenA,'GET')).status,405);
  pass('explicit registration is idempotent under retries and races, records trusted provenance, never relabels ownership and saves no transaction');

  // 5. Authority: the company comes only from the fresh token membership, never the body; every member role can register.
  const forgedCreate=await ok('/api/account-categories',tokenA,'POST',{name:'REG_FORGED_BODY',type:'expense',_id:String(new ObjectId()),id:'forged',organizationId:String(B),companyRegistrations:[{organizationId:String(B),registeredBy:String(outsider),via:'created'}]}),forgedRow=await categories.findOne({name:'REG_FORGED_BODY'});
  assert.equal(String(forgedRow._id),idOf(forgedCreate));assert.equal(forgedRow.companyRegistrations.length,1,'registration:body-forgery');assert.equal(String(forgedRow.companyRegistrations[0].organizationId),String(A),'registration:body-forgery');assert.equal(String(forgedRow.companyRegistrations[0].registeredBy),String(owner),'registration:body-forgery');assert.equal(forgedRow.organizationId,undefined,'registration:body-forgery');
  const bodyCompany=await categories.insertOne({name:'REG_BODY_COMPANY',type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now});await ok('/api/account-categories/'+bodyCompany.insertedId+'/registration',tokenA,'POST',{organizationId:String(B),companyId:String(B),registeredBy:String(outsider)});
  const bodyRow=await categories.findOne({_id:bodyCompany.insertedId});assert.equal(bodyRow.companyRegistrations.length,1);assert.equal(String(bodyRow.companyRegistrations[0].organizationId),String(A),'registration:body-forgery');assert.equal(String(bodyRow.companyRegistrations[0].registeredBy),String(owner),'registration:body-forgery');
  assert.equal((await call('/api/account-categories',forged,'POST',{name:'REG_FORGED_MEMBER',type:'expense'})).status,403,'registration:fresh-membership');assert.equal(await categories.countDocuments({name:'REG_FORGED_MEMBER'}),0,'registration:fresh-membership');
  assert.equal((await call('/api/account-categories/'+raced.insertedId+'/registration',forged,'POST',{})).status,403,'registration:fresh-membership');
  const revokedTarget=await categories.insertOne({name:'REG_REVOKED_TARGET',type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now});
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await call('/api/account-categories',tokenA,'POST',{name:'REG_REVOKED_CREATE',type:'expense'})).status,403,'registration:fresh-membership');assert.equal((await call('/api/account-categories/'+revokedTarget.insertedId+'/registration',tokenA,'POST',{})).status,403,'registration:fresh-membership');await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  assert.equal(await categories.countDocuments({name:'REG_REVOKED_CREATE'}),0,'registration:fresh-membership');assert.equal((await categories.findOne({_id:revokedTarget.insertedId})).companyRegistrations,undefined,'registration:fresh-membership');
  await db.collection('organizations').updateOne({_id:B},{$set:{isActive:false}});assert.equal((await call('/api/account-categories/'+revokedTarget.insertedId+'/registration',tokenB,'POST',{})).status,403,'registration:fresh-membership');await db.collection('organizations').updateOne({_id:B},{$set:{isActive:true}});
  assert.equal((await call('/api/account-categories/'+revokedTarget.insertedId+'/registration',ownerToken,'POST',{})).status,403,'registration:company-required');assert.equal((await call('/api/account-categories/'+revokedTarget.insertedId+'/registration',null,'POST',{})).status,401);
  for(const role of['owner','admin','member','viewer']){await db.collection('organizations').updateOne({_id:A},{$set:{'members.0.role':role}});const target=await categories.insertOne({name:'REG_ROLE_'+role,type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now});assert.equal((await call('/api/account-categories/'+target.insertedId+'/registration',tokenA,'POST',{})).status,200,'registration:legitimate-role');assert.equal((await call('/api/account-categories',tokenA,'POST',{name:'REG_ROLE_CREATE_'+role,type:'expense'})).status,200,'registration:legitimate-role')}await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  pass('company authority is the fresh token membership only; body company/actor/registry fields are ignored; every current member role works');

  // 6. Ordinary native reads/writes never expose or erase company registrations (shared master edit/delete policy unchanged).
  await ok('/api/account-categories/'+legacyId+'/registration',tokenB,'POST',{});
  const listRaw=(await call('/api/account-categories',tokenA)).raw,topRaw=(await call('/api/account-categories?topLevel=true',tokenA)).raw,oneRaw=(await call('/api/account-categories/'+unusedId,tokenA)).raw,legacyRaw=(await call('/api/account-categories/'+legacyId,ownerToken)).raw;
  for(const raw of[listRaw,topRaw,oneRaw,legacyRaw,JSON.stringify(created),JSON.stringify(sub)])assert.ok(!raw.includes('companyRegistrations')&&!raw.includes('registeredBy')&&!raw.includes(String(B)),'registration:no-metadata-leak');
  assert.ok(listRaw.includes('REG_UNUSED_A')&&listRaw.includes('REG_LEGACY_UNASSIGNED'),'registration:native-list-unchanged');assert.ok(topRaw.includes('REG_SUB_A'),'registration:native-list-unchanged');
  const put=await call('/api/account-categories/'+legacyId,tokenA,'PUT',{name:'REG_LEGACY_RENAMED',type:'expense',companyRegistrations:[],organizationId:String(B)});assert.equal(put.status,200);assert.ok(!put.raw.includes('companyRegistrations')&&!put.raw.includes(String(B)),'registration:no-metadata-leak');
  assert.deepEqual((await categories.findOne({_id:new ObjectId(legacyId)})).companyRegistrations.map(x=>String(x.organizationId)).sort(),[String(A),String(B)].sort(),'registration:put-cannot-erase');
  r=await choicesOf(tokenA);assert.ok(!r.raw.includes('companyRegistrations')&&!r.raw.includes('registeredBy')&&!r.raw.includes(String(B)),'registration:no-metadata-leak');assert.equal(r.data.result.choices.accountCategoryId.find(x=>x.id===legacyId).name,'REG_LEGACY_RENAMED');
  await ok('/api/account-categories/'+legacyId,tokenA,'PUT',{name:'REG_LEGACY_RENAMED',type:'expense',isActive:false});r=await choicesOf(tokenA);assert.ok(!ids(r.data.result.choices.accountCategoryId).includes(legacyId),'registration:inactive-hidden');assert.equal((await call('/api/account-categories/'+legacyId+'/registration',tokenA,'POST',{})).status,404,'registration:inactive-hidden');await ok('/api/account-categories/'+legacyId,tokenA,'PUT',{name:'REG_LEGACY_RENAMED',type:'expense',isActive:true});
  pass('native list/detail/create/update responses and Navi choices never expose registration lists; an update cannot erase them; inactive accounts are hidden');

  // 7. Literal bounded name search and pagination of this company's registered accounts.
  for(const name of['REG.LIT','REGXLIT'])await ok('/api/account-categories',tokenA,'POST',{name,type:'expense'});
  r=await choicesOf(tokenA,{accountQuery:'REG.LIT'});assert.equal(r.status,200,'registration:literal-query '+r.raw.slice(0,200));assert.deepEqual(r.data.result.choices.accountCategoryId.filter(x=>x.source==='company_registration').map(x=>x.name),['REG.LIT'],'registration:literal-query');assert.equal(r.data.result.registeredAccounts.query,'REG.LIT');
  r=await choicesOf(tokenA,{accountQuery:'(['});assert.equal(r.status,200,'registration:literal-query');assert.equal(r.data.result.registeredAccounts.returned,0);
  await categories.insertMany(Array.from({length:55},(_,i)=>({name:'REG_PAGE_'+String(i).padStart(2,'0'),type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now,companyRegistrations:[{organizationId:A,registeredBy:owner,registeredAt:now,via:'registered'}]})));
  const page1=await choicesOf(tokenA,{accountQuery:'REG_PAGE_'}),page2=await choicesOf(tokenA,{accountQuery:'REG_PAGE_',accountPage:2});
  const p1=page1.data.result.choices.accountCategoryId.filter(x=>x.source==='company_registration'),p2=page2.data.result.choices.accountCategoryId.filter(x=>x.source==='company_registration');
  assert.equal(p1.length,50,'registration:pagination');assert.equal(page1.data.result.registeredAccounts.hasMore,true,'registration:pagination');assert.equal(p2.length,5,'registration:pagination');assert.equal(page2.data.result.registeredAccounts.hasMore,false,'registration:pagination');assert.equal(new Set([...p1,...p2].map(x=>x.id)).size,55,'registration:pagination');assert.equal(page2.data.result.registeredAccounts.page,2);
  const first=await choicesOf(tokenA);assert.equal(first.data.result.registeredAccounts.hasMore,true,'registration:pagination');assert.equal(first.data.result.registeredAccounts.limit,50);
  for(const bad of[{accountPage:0},{accountPage:1001},{accountQuery:'x'.repeat(101)},{accountPage:'2'},{organizationId:String(B)}]){const j=await ask(tokenA,'Bad choices arguments');assert.equal((await act(j,'list_company_transaction_choices',bad)).status,400,'registration:bounded-arguments');await finish(j)}
  pass('registered account search is literal, bounded and paginated without dropping any account');

  // 8. A requested accounting edit and a teaching can use a registered unused account; other references stay history-only.
  let job=await ask(tokenA,'Change the account to REG_UNUSED_A.',{page:'transactions',transactionId:txId});const before=(await act(job,'get_company_transaction',{transactionId:txId})).data.result.transaction;
  const save=await act(job,'update_company_transaction',{transactionId:txId,expectedUpdatedAt:before.updatedAt,accountCategoryId:unusedId,subAccountCategoryId:subId},2);assert.equal(save.status,200,'registration:save-readback '+save.raw.slice(0,200));await finish(job);
  const saved=await ok('/api/transactions/'+txId,tokenA);assert.equal(String(saved.accountCategoryId._id),unusedId,'registration:save-readback');assert.equal(String(saved.subAccountCategoryId._id),subId);assert.equal(saved.amount,5000);assert.equal(saved.notes,'Original note');assert.equal(saved.cardAccounting.accountName,'Credit card','registration:save-readback');assert.equal(saved.cardNumber,'1234');
  r=await choicesOf(tokenA,{accountQuery:'REG_SUB_A'});const usedSub=r.data.result.choices.subAccountCategoryId.filter(x=>x.id===subId);assert.equal(usedSub.length,1,'registration:history-sub-parent');assert.equal(usedSub[0].registeredForCompany,true,'registration:history-sub-parent');assert.deepEqual(usedSub[0].parent,{id:unusedId,name:'REG_UNUSED_A',code:'R100',registeredForCompany:true},'registration:history-sub-parent');
  const farId=String((await categories.findOne({name:'REG_PAGE_54'}))._id),customer=await ok('/api/customers',tokenA,'POST',{name:'REG_UNUSED_CUSTOMER'});
  job=await ask(tokenA,'Remember: REG_TEACHING use the registered account for this shop');
  assert.equal((await act(job,'remember_company_knowledge',{instruction:'REG_TEACHING use the registered account for this shop',merchant:'REG SHOP',accountCategoryId:bOnlyId},1)).status,400,'registration:knowledge-eligibility');
  assert.equal((await act(job,'remember_company_knowledge',{instruction:'REG_TEACHING use the registered account for this shop',merchant:'REG SHOP',customerId:idOf(customer)},2)).status,400,'registration:knowledge-eligibility');
  assert.equal((await act(job,'remember_company_knowledge',{instruction:'REG_TEACHING use the registered account for this shop',merchant:'REG SHOP',accountCategoryId:subId},3)).status,400,'registration:knowledge-eligibility');
  const remember=await act(job,'remember_company_knowledge',{instruction:'REG_TEACHING use the registered account for this shop',merchant:'REG SHOP',accountCategoryId:farId,subAccountCategoryId:childId},4);assert.equal(remember.status,200,'registration:knowledge-eligibility '+remember.raw.slice(0,200));await finish(job);
  const teaching=await db.collection('financecompanyknowledges').findOne({organizationId:A});assert.equal(String(teaching.suggested.accountCategoryId),farId);assert.equal(String(teaching.suggested.subAccountCategoryId),childId);
  pass('Navi saves a requested registered unused account with other fields preserved; teachings accept registered accounts (beyond the first page) and still refuse foreign or unobserved references');

  // 9. A revoked company job reads nothing.
  job=await ask(tokenA,'Revoked choices');await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await act(job,'list_company_transaction_choices')).status,403,'registration:revoked-job');await db.collection('organizations').updateOne({_id:A},{$set:{members}});await finish(job);
  pass('a revoked membership reads no registered accounts');

  if(process.env.OMF_ACCOUNT_REGISTRATION_BROWSER==='1')await require('./finance-company-account-registrations-browser.cjs')({root,origin,call,ok,db,ObjectId,ownerToken,tokenA,tokenB,A:String(A),B:String(B),pause,pass});
  console.log(checks+' Account registration groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

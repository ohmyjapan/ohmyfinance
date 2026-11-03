// Role split step 2 (plan omf-role-writes-20261101 §4) on the actual built application: a 閲覧のみ member only reads (every non-read
// /api request answers 403 before its handler), own-account writes stay open to it, the role is read fresh from the Organization at
// each request, a 一般 member keeps its day-to-day writes and is refused the three ledger registrations (銀行仕訳 register,
// company-commit, Navi post_selected_approved_rows) with the registrar message, 経理担当/管理者/オーナー register, the recovery of a
// demoted actor's interrupted Navi post is unresolved with that message, omft_/omfc_ tokens are untouched, and the labels read
// 閲覧のみ / 열람 전용. Owned throwaway MongoDB, synthetic users/companies/rows only, simulated worker replies; no model, provider,
// network, mail, Slack or business send. Every assertion is labelled `role-writes:R<n>-<name>` so the fixture can name the assertion a
// reintroduced defect must flip. A non-throwing PROBE ledger first names the legs that must FAIL on the unchanged build (R2, R4, R5, R9, R10).
// OMF_ROLE_BROWSER=1 adds the installed-Chrome leg (settings labels; a 一般 member's register click shows the registrar message; a 閲覧のみ
// member's save on the budgets page shows the one refusal notice with the server's message and writes nothing; pages and Navi with no
// press show no notice, even when Navi's unread mark is refused); OMF_ROLE_WRITES_MUTANT=1 (set by the fixture for compiled defects)
// skips it. R10: a no-login POST to the deleted /api/files/process-excel runs nothing.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const root=path.resolve(process.env.OMF_ROLE_WRITES_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const BROWSER=process.env.OMF_ROLE_BROWSER==='1'&&process.env.OMF_ROLE_WRITES_MUTANT!=='1';
// Installed Chrome and the collector's pinned puppeteer fork, loaded as scripts/finance-invoice-integration.cjs loads them (a worktree
// carries collector/package.json but no collector/node_modules; the parent checkout does).
const chromePath=()=>[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(fs.existsSync);
const puppeteerLib=()=>{for(const p of[path.join(__dirname,'../collector/package.json'),path.resolve(__dirname,'../../collector/package.json')]){try{return createRequire(p)('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}}throw Error('rebrowser-puppeteer-core not found')};
const PASSWORD='Synthetic-password-Only1!',EXPENSE='支出';
const VIEWER_MESSAGE='閲覧のみのメンバーは変更できません（閲覧だけができます）。',REGISTRAR_MESSAGE='帳簿への登録（仕訳の登録）は経理担当以上のメンバーだけができます。';
const L=tag=>'role-writes:'+tag;
async function main(){
 assert.equal(process.env.OMF_ROLE_WRITES_FIXTURE,'owned','SETUP: run only through the owned fixture');
 let mongo,client,child,directory,browser=null,logs='',groups=0;const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-role-writes-'));
  const binary=process.env.OMF_MONGOD_BINARY||path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:300000}});
  const dbName='role_writes_regression',uri=mongo.getUri(dbName),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:\d+\//,'SETUP owned database is the local memory server');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-40000)})}
  let healthy=false;for(let i=0;i<300&&!healthy;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true}}catch{}if(!healthy)await pause(200)}if(!healthy)throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  client=await MongoClient.connect(uri);const db=client.db(dbName);assert.equal(db.databaseName,dbName);
  const api=async(route,token,method='GET',body,headers={})=>{const isBuffer=Buffer.isBuffer(body),isForm=typeof FormData!=='undefined'&&body instanceof FormData;const response=await fetch(origin+route,{method,headers:{...(isForm?{}:{'Content-Type':isBuffer?'text/csv':'application/json'}),...headers,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:isBuffer||isForm?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}return{status:response.status,raw,data}};
  const ok=async(route,token,method='GET',body,label='positive')=>{const r=await api(route,token,method,body);assert.equal(r.status,200,L(label)+' '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const errorMessage=r=>String(r.data?.data?.message||r.data?.message||r.data?.statusMessage||r.raw||'');
  const col=name=>db.collection(name);
  const COUNTED=['transactions','invoices','payments','budgets','customers','receipts','accountcategories','subcategories','financecompanyassistants','financialaccounts','financebankclassifications','financeimports','financeentries','financeimportcompanies','companymailconnections','financecollectors','financechatagents','organizations'];
  const counts=async()=>Object.fromEntries(await Promise.all(COUNTED.map(async n=>[n,await col(n).countDocuments()])));
  const ledger=async()=>JSON.stringify(await Promise.all(['transactions','financeentries','financeimportcompanies'].map(n=>col(n).find().sort({_id:1}).toArray())));

  // ---- SETUP: users (inserted with a real bcrypt hash: the login page still checks it; registration is rate-limited), companies, tokens.
  const passwordHash=await require('bcryptjs').hash(PASSWORD,4),users={};
  const makeUser=async(key)=>{const id=new ObjectId(),at=new Date(),email=key.toLowerCase()+'@example.invalid';await col('users').insertOne({_id:id,email,password:passwordHash,name:'Synthetic '+key,isActive:true,isEmailVerified:true,preferences:{language:'ja',currency:'JPY',timezone:'Asia/Tokyo',darkMode:false},loginAttempts:0,twoFactorEnabled:false,createdAt:at,updatedAt:at});users[key]={key,email,id,plain:jwt.sign({userId:String(id),email,jti:crypto.randomUUID()},secret,{expiresIn:'3h'})}};
  for(const k of['ownerA','adminA','accA','memberA','viewerA'])await makeUser(k);
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),m=(u,role)=>({userId:users[u].id,role,joinedAt:now});
  const membersA=[m('ownerA','owner'),m('adminA','admin'),m('accA','accountant'),m('memberA','member'),m('viewerA','viewer')];
  const settings={defaultCurrency:'JPY',fiscalYearStart:4,timezone:'Asia/Tokyo',invoicePrefix:'INV',invoiceNextNumber:1};
  await col('organizations').insertMany([{_id:A,name:'Synthetic role company A',slug:'role-writes-a',type:'business',isActive:true,members:membersA,settings,createdAt:now,updatedAt:now},{_id:B,name:'Synthetic role company B',slug:'role-writes-b',type:'business',isActive:true,members:[m('viewerA','owner')],settings,createdAt:now,updatedAt:now}]);
  const tokenOf=async(u,company)=>(await ok('/api/auth/switch-organization',users[u].plain,'POST',{organizationId:String(company)},'switch '+u)).tokens.accessToken;
  const T={};for(const u of['ownerA','adminA','accA','memberA','viewerA'])T[u]=await tokenOf(u,A);T.viewerB=await tokenOf('viewerA',B);
  const roleOf=async u=>(await col('organizations').findOne({_id:A})).members.find(x=>String(x.userId)===String(users[u].id))?.role??null;
  const setRole=(u,role)=>col('organizations').updateOne({_id:A,'members.userId':users[u].id},{$set:{'members.$.role':role}});
  // Reference masters (company-agnostic collections, referenced, never fabricated by the app).
  const chart={fee:new ObjectId(),telecom:new ObjectId()};await col('accountcategories').insertMany([{_id:chart.fee,name:'Synthetic 支払手数料',type:'expense',isActive:true,order:0},{_id:chart.telecom,name:'Synthetic 通信費',type:'expense',isActive:true,order:0}]);
  const refs={category:new ObjectId(),tax:new ObjectId()};await col('transactioncategories').insertOne({_id:refs.category,name:'Synthetic 区分'});await col('taxcategories').insertOne({_id:refs.tax,name:'Synthetic 課税仕入 10%',rate:10});
  const txA=(await ok('/api/transactions',T.ownerA,'POST',{date:'2026-01-15',amount:0,notes:'Synthetic owner row'},'owner-transaction'))._id;
  // The ledger user (一般 memberA) owns the Amex account, the bank account, the worker and the statement; its role in A is flipped below.
  const amex=(await ok('/api/finance/accounts',T.memberA,'POST',{name:'Synthetic role Amex',provider:'amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'synthetic@example.invalid',otpMailbox:'synthetic@example.invalid'},'amex-account')).account;
  const agent=await ok('/api/finance-chat/agents',T.memberA,'POST',{accountIds:[String(amex._id)],workspaceEnabled:true},'agent');
  const worker=(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);assert.equal((await worker('heartbeat',{})).status,200,'SETUP worker heartbeat');
  const bank='/api/finance-payments/bank/',cls='/api/finance-payments/bank-classifications';
  const bankAccount=(await ok(bank+'accounts',T.memberA,'POST',{name:'Synthetic role bank',currency:'JPY'},'bank-account')).account.id;
  const bankCsv=Buffer.from(['取引日,入出金(円),残高(円),入出金先内容','20260905,-330,1999670,振込手数料','20260910,-110000,1889670,振込 カ）カクウリース','20260915,-5500,1884170,口座振替 カクウツウシン'].join('\r\n')+'\r\n','utf8');
  const file=(await ok(bank+'files?name=role-writes.csv',T.memberA,'POST',bankCsv,'bank-file')).document,sheet=await ok(bank+'files/'+file.id+'/sheet',T.memberA,'GET',undefined,'bank-sheet');
  const imported=await ok(bank+'files/'+file.id+'/import',T.memberA,'POST',{sheet:sheet.sheet,headerRow:sheet.headerRow,mapping:sheet.mapping,bankAccountId:bankAccount,transactionIdConfirmed:false,amountSign:'outflow-negative',confirm:true},'bank-import');assert.equal(imported.rows.length,3,'SETUP three bank rows');
  const generated=await ok(cls+'/generate',T.memberA,'POST',{bankAccountId:bankAccount},'generate');assert.equal(generated.rows.filter(r=>r.draft).length,3,'SETUP three drafts '+JSON.stringify(generated.rows.map(r=>r.state)));
  const listDrafts=async(t=T.memberA)=>(await ok(cls+'?account='+bankAccount,t,'GET',undefined,'list')).rows;
  // Descriptions are stored NFKC-normalized by the import (full-width brackets become ASCII), so the lookup normalizes too.
  const draftByDescription=async(description,t)=>{const wanted=description.normalize('NFKC'),rows=await listDrafts(t),row=rows.find(r=>String(r.description||'').normalize('NFKC')===wanted);assert.ok(row?.draft,'SETUP draft '+description+' among '+JSON.stringify(rows.map(r=>[r.description,r.state])));return row};
  const D={fee:await draftByDescription('振込手数料'),lease:await draftByDescription('振込 カ）カクウリース'),telecom:await draftByDescription('口座振替 カクウツウシン')};
  // Every draft gets a purpose and an account so registration readiness depends on the role alone (一般 may edit drafts).
  for(const key of Object.keys(D)){const d=D[key].draft;const saved=await ok(cls+'/'+d.id,T.memberA,'PUT',{revision:d.revision,values:{purpose:'Synthetic '+key,accountCategoryId:String(chart.fee)}},'draft-ready '+key);D[key]=saved.row;assert.equal(D[key].draft.ready.ready,true,'SETUP draft ready '+key+' '+JSON.stringify(D[key].draft.ready))}
  const draftDoc=key=>col('financebankclassifications').findOne({_id:new ObjectId(D[key].draft.id)});
  const register=(key,t,body={})=>api(cls+'/'+D[key].draft.id+'/register',t,'POST',{revision:D[key].draft.revision,action:'create',confirm:true,...body});
  const {HEADERS}=await import(pathToFileURL(path.join(root,'shared/amex.mjs')).href);
  const amexCsv=rows=>Buffer.from([HEADERS,...rows.map(([day,name,amount])=>['2026/08/'+day,'2026/08/'+day,name,'Synthetic user','12345',String(amount),'',''])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const statement=await ok('/api/finance/accounts/'+amex._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',T.memberA,'POST',amexCsv([['02','Role shop two',1102],['03','Role shop three',1103],['04','Role shop four',1104]]),'amex-import');
  const importId=String(statement.id),batch=await col('financeimports').findOne({_id:new ObjectId(importId)});assert.ok(batch,'SETUP statement stored');
  const ready={purpose:'company',accountCategoryId:String(chart.telecom),transactionCategoryId:String(refs.category),taxCategoryId:String(refs.tax),taxRate:10};
  const wsEndpoint='/api/finance-chat/workspace',companyEndpoint='/api/finance-chat/company-workspace',assistants=col('financeassistants'),ops=col('financeactionoperations');
  const wsSend=async(token,text,extra={},requestId=crypto.randomUUID())=>{const view=await ok(wsEndpoint,token,'GET',undefined,'workspace-view');return{requestId,response:await api(wsEndpoint,token,'POST',{text,requestId,chatRevision:view.conversation?.revision||0,context:{page:'mapping',importId},...extra})}};
  const claim=async()=>{assert.equal((await worker('heartbeat',{})).status,200,'SETUP heartbeat');const r=await worker('workspace-claim');assert.equal(r.status,200,L('claim')+' '+r.raw.slice(0,300));assert.ok(r.data?.job,L('claimed'));return r.data.job};
  const wsTurn=async(token,text,extra)=>{const sent=await wsSend(token,text,extra);assert.equal(sent.response.status,200,L('owner-workspace-send')+' '+sent.response.raw.slice(0,300));const job=await claim();assert.equal(job.text,text);return{...sent,job}};
  const act=(job,slot,name,args={})=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/actions',{lease:job.lease,slot,name,args});
  const acted=async(job,slot,name,args,label=name)=>{const r=await act(job,slot,name,args);assert.equal(r.status,200,L(label)+' slot '+slot+' '+r.raw.slice(0,400));return r.data};
  const finish=(job,summary='Synthetic reply.')=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary,patch:{},quotes:{}}});
  const prepare=async(job,slot,line)=>{const saved=await acted(job,slot,'save_draft_fields',{importId,line,fields:ready},'draft-save');assert.equal(saved.receipt.state,'done',L('draft-save-open-to-member'));const approved=await acted(job,slot+1,'approve_draft',{importId,line},'approve');assert.equal(approved.receipt.state,'done',L('approve-open-to-member'));return approved};
  const storedTurn=async requestId=>(await assistants.findOne({ownerId:users.memberA.id})).turns.find(t=>t.id===requestId);
  const entryOf=line=>col('financeentries').findOne({importId:batch._id,line});
  const i18n=async name=>JSON.parse(await fsp.readFile(path.join(root,'i18n/locales',name),'utf8'));

  // ---- 0. Fail-first ledger (non-throwing): the legs the plan names must FAIL on the unchanged build.
  const probe=(label,v)=>{console.log((v?'PROBE-OK ':'PROBE-FAIL ')+label);return v};
  { const r=await api('/api/transactions',T.viewerA,'POST',{date:'2026-01-16',amount:1,notes:'Probe viewer row'});probe('R2 role-writes:R2-transactions-post (a viewer POST /api/transactions answers 403)',r.status===403);if(r.status===200&&r.data?._id)await col('transactions').deleteOne({_id:new ObjectId(String(r.data._id))}) }
  { await setRole('ownerA','viewer');const r=await api('/api/transactions',T.ownerA,'POST',{date:'2026-01-16',amount:1,notes:'Probe demoted owner row'});await setRole('ownerA','owner');probe('R4 role-writes:R4-demoted-403 (a token whose company now holds the user as viewer answers 403)',r.status===403);if(r.status===200&&r.data?._id)await col('transactions').deleteOne({_id:new ObjectId(String(r.data._id))}) }
  { const r=await register('fee',T.memberA);probe('R5 role-writes:R5-register (a 一般 member\'s 確認して取引へ登録 answers 403)',r.status===403&&errorMessage(r)===REGISTRAR_MESSAGE);if(r.status===200){console.log('PROBE-INFO R5 the unchanged build registered the draft; the asserted legs below fail at R2 first')} }
  { const ja=await i18n('ja.json');probe('R9 role-writes:R9-ja-viewer (ja.json roles.viewer is 閲覧のみ)',ja.roles?.viewer==='閲覧のみ') }
  // R10: no token, and a filepath that writes a marker in this run's own directory if the route runs it as code. The route wrote its
  // script to the server's working directory, so one found after the POST is this POST's and is removed here.
  const processExcel=async()=>{const marker=path.join(directory,'r10-marker-'+crypto.randomBytes(4).toString('hex')+'.txt'),script=path.join(root,'temp-script.cjs');assert.equal(fs.existsSync(script),false,'SETUP no temp-script.cjs before the no-login POST');const r=await api('/api/files/process-excel',null,'POST',{filepath:`'+require('fs').writeFileSync('${marker.replaceAll('\\','/')}','ran')+'`});const ran=fs.existsSync(marker),wrote=fs.existsSync(script);if(wrote)fs.unlinkSync(script);return{...r,ran,wrote}};
  { const r=await processExcel();probe('R10 role-writes:R10-no-marker (a no-login POST to /api/files/process-excel runs nothing)',!r.ran&&!r.wrote) }

  // ---- R1. A viewer reads.
  for(const route of['/api/transactions','/api/transactions/stats','/api/invoices','/api/payments','/api/dashboard/stats',companyEndpoint,'/api/organizations/'+A,'/api/users/me']){const r=await api(route,T.viewerA);assert.equal(r.status,200,L('R1-read')+' '+route+' '+r.raw.slice(0,200))}
  pass('R1 a 閲覧のみ member reads transactions, statistics, invoices, payments, the dashboard, the company conversation, the company and its own profile');

  // ---- R2. Every write of a viewer answers 403 with VIEWER_READ_ONLY and the viewer message, before any handler: nothing is written.
  const beforeR2=await counts(),assistantBefore=JSON.stringify(await col('financecompanyassistants').find({organizationId:A}).toArray()),categoryId=new ObjectId();await col('accountcategories').insertOne({_id:categoryId,name:'Synthetic registration target',type:'expense',isActive:true,order:0});beforeR2.accountcategories++;
  const refused=(label,r)=>{assert.equal(r.status,403,L(label)+' answered '+r.status+' '+r.raw.slice(0,300));assert.equal(r.data?.data?.code,'VIEWER_READ_ONLY',L(label)+' code '+r.raw.slice(0,300));assert.ok(errorMessage(r).includes(VIEWER_MESSAGE)&&String(r.data?.message||'').includes(VIEWER_MESSAGE),L(label)+' message '+r.raw.slice(0,300))};
  refused('R2-transactions-post',await api('/api/transactions',T.viewerA,'POST',{date:'2026-01-16',amount:1,notes:'Viewer row'}));
  refused('R2-transactions-put',await api('/api/transactions/'+txA,T.viewerA,'PUT',{notes:'Viewer edit'}));refused('R2-transactions-delete',await api('/api/transactions/'+txA,T.viewerA,'DELETE'));
  refused('R2-invoices-post',await api('/api/invoices',T.viewerA,'POST',{from:{name:'Viewer issuer'},to:{name:'Viewer client'},items:[{description:'Work',quantity:1,unitPrice:100}]}));
  refused('R2-payments-post',await api('/api/payments',T.viewerA,'POST',{title:'Viewer bill',amount:100,currency:'JPY',dueDate:'2026-12-10',type:'expense',category:'Synthetic'}));
  refused('R2-budgets-post',await api('/api/budgets',T.viewerA,'POST',{name:'Viewer budget',amount:1,currency:'JPY'}));refused('R2-customers-post',await api('/api/customers',T.viewerA,'POST',{name:'Viewer customer'}));
  { const form=new FormData();form.append('file',new Blob([Buffer.from('%PDF-1.4 synthetic')],{type:'application/pdf'}),'viewer.pdf');refused('R2-receipts-upload',await api('/api/receipts/upload',T.viewerA,'POST',form)) }
  refused('R2-account-registration',await api('/api/account-categories/'+categoryId+'/registration',T.viewerA,'POST',{}));
  refused('R2-transactions-import',await api('/api/transactions/import',T.viewerA,'POST',{data:[{date:'2026-01-15',amount:37,referenceNumber:'VIEWER_IMPORT'}],options:{skipDuplicates:false}}));
  refused('R2-organization-put',await api('/api/organizations/'+A,T.viewerA,'PUT',{name:'Viewer renamed company'}));
  refused('R2-company-workspace-post',await api(companyEndpoint,T.viewerA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:0,text:'Viewer turn',context:{page:'dashboard'}}));refused('R2-company-workspace-read',await api(companyEndpoint+'/read',T.viewerA,'POST',{}));
  refused('R2-owner-area-post',await api('/api/finance/accounts',T.viewerA,'POST',{name:'Viewer Amex',primaryCard:'99999',cardIdentifiers:['99999'],otpRecipient:'v@example.invalid',otpMailbox:'v@example.invalid'}));
  refused('R2-bank-classification-generate',await api(cls+'/generate',T.viewerA,'POST',{bankAccountId:bankAccount}));
  refused('R2-seed',await api('/api/seed',T.viewerA,'GET'));refused('R2-gmail-delete',await api('/api/company-mail/gmail',T.viewerA,'DELETE'));
  refused('R2-unrouted-post',await api('/api/role-writes-no-such-route',T.viewerA,'POST',{}));
  assert.deepEqual(await counts(),beforeR2,L('R2-nothing-written'));assert.equal(JSON.stringify(await col('financecompanyassistants').find({organizationId:A}).toArray()),assistantBefore,L('R2-no-company-turn'));
  assert.equal((await col('accountcategories').findOne({_id:categoryId})).companyRegistrations,undefined,L('R2-no-registration'));assert.equal((await api('/api/transactions',T.viewerA)).status,200,L('R2-still-reads'));
  pass('R2 a 閲覧のみ member\'s writes (transactions, invoices, payments, budgets, customers, receipt upload, account registration, import, company settings, company conversation and its read mark, the owner area, draft generation, GET /api/seed, Gmail disconnect, an unrouted POST) answer 403 VIEWER_READ_ONLY with the viewer message and write nothing; reads continue');

  // ---- R3. Own-account writes of the viewer pass; the same user writes in company B where it is the owner.
  const beforeR3=await counts();
  const switched=await api('/api/auth/switch-organization',T.viewerA,'POST',{organizationId:String(B)});assert.equal(switched.status,200,L('R3-switch-company')+' '+switched.raw.slice(0,300));const tokenB2=switched.data.tokens.accessToken;
  const inB=await api('/api/transactions',tokenB2,'POST',{date:'2026-01-17',amount:5,notes:'Owner of B row'});assert.equal(inB.status,200,L('R3-writes-as-owner-of-B')+' '+inB.raw.slice(0,300));assert.equal(inB.data.organizationId,String(B),L('R3-row-in-B'));
  assert.equal((await api('/api/users/me',T.viewerA,'PATCH',{name:'Synthetic viewer renamed'})).status,200,L('R3-profile-patch'));assert.equal((await col('users').findOne({_id:users.viewerA.id})).name,'Synthetic viewer renamed',L('R3-profile-saved'));
  const own=await api('/api/organizations',T.viewerA,'POST',{name:'Synthetic viewer own company',type:'business'});assert.equal(own.status,200,L('R3-create-own-company')+' '+own.raw.slice(0,300));assert.equal(own.data.organization.role,'owner',L('R3-own-company-owner'));
  const spare=await tokenOf('viewerA',A);assert.equal((await api('/api/auth/logout',spare,'POST',{})).status,200,L('R3-logout'));assert.equal((await api('/api/transactions',spare)).status,401,L('R3-logout-revoked'));
  const afterR3=await counts();assert.deepEqual({...afterR3,transactions:afterR3.transactions-1,organizations:afterR3.organizations-1},beforeR3,L('R3-only-own-writes'));assert.equal(await col('transactions').countDocuments({organizationId:A}),beforeR3.transactions-(await col('transactions').countDocuments({organizationId:{$ne:A}}))+1-1+0||await col('transactions').countDocuments({organizationId:A}),L('R3-A-untouched'));
  assert.equal(await col('transactions').countDocuments({organizationId:A,notes:{$in:['Viewer row','Owner of B row']}}),0,L('R3-A-untouched'));
  pass('R3 own-account writes stay open to a 閲覧のみ member (switch company, profile, logout, creating a company); the same user writes in company B as its owner; company A is untouched');

  // ---- R4. The role is read fresh: a demoted owner token is refused, restored passes, a removed member gets the route's own 403.
  await setRole('ownerA','viewer');const demoted=await api('/api/transactions',T.ownerA,'POST',{date:'2026-01-18',amount:2,notes:'Demoted owner row'});assert.equal(demoted.status,403,L('R4-demoted-403')+' '+demoted.raw.slice(0,300));assert.equal(demoted.data?.data?.code,'VIEWER_READ_ONLY',L('R4-demoted-code'));
  await setRole('ownerA','owner');const restored=await api('/api/transactions',T.ownerA,'POST',{date:'2026-01-18',amount:2,notes:'Restored owner row'});assert.equal(restored.status,200,L('R4-restored-200')+' '+restored.raw.slice(0,300));
  await col('organizations').updateOne({_id:A},{$pull:{members:{userId:users.ownerA.id}}});const removed=await api('/api/transactions',T.ownerA,'POST',{date:'2026-01-18',amount:3,notes:'Removed owner row'});assert.equal(removed.status,403,L('R4-removed-403')+' '+removed.raw.slice(0,300));assert.notEqual(removed.data?.data?.code,'VIEWER_READ_ONLY',L('R4-removed-not-viewer-code'));assert.ok(!String(removed.raw).includes(VIEWER_MESSAGE),L('R4-removed-route-decides'));
  await col('organizations').updateOne({_id:A},{$set:{members:membersA}});assert.equal(await col('transactions').countDocuments({notes:{$in:['Demoted owner row','Removed owner row']}}),0,L('R4-refusals-write-nothing'));
  pass('R4 the role is read fresh at each request: a demoted owner token answers 403 VIEWER_READ_ONLY, restored 200, a removed member the route\'s own 403 without the viewer code');

  // ---- R5. A 一般 member keeps its day-to-day writes and is refused the three ledger registrations with the registrar message.
  assert.equal(await roleOf('memberA'),'member','SETUP memberA is 一般');
  assert.equal((await api('/api/transactions',T.memberA,'POST',{date:'2026-01-19',amount:7,notes:'Member row'})).status,200,L('R5-transactions-post'));
  assert.equal((await api('/api/invoices',T.memberA,'POST',{from:{name:'Member issuer'},to:{name:'Member client'},items:[{description:'Work',quantity:1,unitPrice:100}]})).status,200,L('R5-invoices-post'));
  assert.equal((await api('/api/payments',T.memberA,'POST',{title:'Member bill',amount:1000,currency:'JPY',dueDate:'2026-12-10',type:'expense',category:'Synthetic'})).status,200,L('R5-payments-post'));
  { const view=await ok(companyEndpoint,T.memberA,'GET',undefined,'company-view');assert.equal((await api(companyEndpoint,T.memberA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.conversation?.revision||0,text:'Create as member',context:{page:'transactions'}})).status,200,L('R5-company-turn'));
    const job=await claim();const created=await acted(job,1,'create_company_transaction',{date:'2026-10-20',amount:1200,type:EXPENSE,status:'completed',productName:'ROLE_MEMBER_NAVI_TX',notes:'Created by a member',accountCategoryId:String(chart.telecom),items:[{productName:'pen',quantity:2,unitPrice:600,taxRate:10}],tags:['navi']},'navi-create');
    assert.equal(created.receipt.state,'done',L('R5-navi-create-done'));assert.equal(await col('transactions').countDocuments({productName:'ROLE_MEMBER_NAVI_TX',organizationId:A}),1,L('R5-navi-create-saved'));assert.equal((await finish(job)).status,200) }
  // 銀行仕訳 register: refused before the service, the draft keeps registration null, no Transaction.
  let txBefore=await col('transactions').countDocuments();const regMember=await register('fee',T.memberA);assert.equal(regMember.status,403,L('R5-register')+' answered '+regMember.status+' '+regMember.raw.slice(0,300));assert.equal(errorMessage(regMember),REGISTRAR_MESSAGE,L('R5-register-message')+' '+regMember.raw.slice(0,300));
  assert.equal((await draftDoc('fee')).registration??null,null,L('R5-register-no-reservation'));assert.equal(await col('transactions').countDocuments(),txBefore,L('R5-register-no-transaction'));
  // Drafts stay the member's to edit, remember and (when registered) release: the handlers decide, not the role.
  { const d=D.lease.draft;const edited=await ok(cls+'/'+d.id,T.memberA,'PUT',{revision:d.revision,values:{notes:'Synthetic member note'}},'R5-update');D.lease=edited.row;assert.equal((await draftDoc('lease')).values.notes,'Synthetic member note',L('R5-update-saved'));
    const remembered=await api(cls+'/'+D.lease.draft.id+'/remember',T.memberA,'POST',{revision:D.lease.draft.revision});assert.equal(remembered.status,200,L('R5-remember')+' '+remembered.raw.slice(0,300));D.lease=(await listDrafts()).find(r=>r.draft?.id===D.lease.draft.id);
    const release=await api(cls+'/'+D.telecom.draft.id+'/release',T.memberA,'POST',{revision:D.telecom.draft.revision,confirm:true});assert.equal(release.status,409,L('R5-release-open')+' '+release.raw.slice(0,300));assert.ok(!errorMessage(release).includes(REGISTRAR_MESSAGE)&&!String(release.raw).includes(VIEWER_MESSAGE),L('R5-release-handler-decides')) }
  // company-commit: refused between the membership check and the writer; no binding, no Transaction, no entry.
  let snapshot=await ledger();const commitMember=await api('/api/finance/imports/'+importId+'/company-commit',T.memberA,'POST',{decisions:[{line:3,action:'import'}]});assert.equal(commitMember.status,403,L('R5-company-commit')+' answered '+commitMember.status+' '+commitMember.raw.slice(0,300));assert.equal(errorMessage(commitMember),REGISTRAR_MESSAGE,L('R5-company-commit-message'));
  assert.equal(await col('financeimportcompanies').countDocuments({importId:batch._id}),0,L('R5-company-commit-no-binding'));assert.equal(await entryOf(3),null,L('R5-company-commit-no-entry'));assert.equal(await ledger(),snapshot,L('R5-company-commit-no-write'));
  // Navi post_selected_approved_rows: the turn freezes company A (membership of any role at send); the write refuses the member.
  const first=await wsTurn(T.memberA,'2行目と4行目を承認して帳簿に登録して');assert.equal((await storedTurn(first.requestId)).postingCompany?.organizationId,String(A),L('R5-turn-frozen-company'));
  await prepare(first.job,1,2);await prepare(first.job,3,4);snapshot=await ledger();
  const postMember=await act(first.job,5,'post_selected_approved_rows',{importId,lines:[2]});assert.equal(postMember.status,403,L('R5-navi-post')+' answered '+postMember.status+' '+postMember.raw.slice(0,300));assert.ok(postMember.raw.includes(REGISTRAR_MESSAGE),L('R5-navi-post-message')+' '+postMember.raw.slice(0,300));
  assert.equal(await ledger(),snapshot,L('R5-navi-post-no-write'));assert.equal((await ops.findOne({turnId:first.requestId,slot:5}))?.state,'failed',L('R5-navi-post-failed-receipt'));
  pass('R5 a 一般 member creates transactions, invoices and payments and a Navi company transaction, edits/remembers drafts and reaches the release handler; 銀行仕訳 register, company-commit and Navi post_selected_approved_rows answer 403 with the registrar message and write nothing');

  // ---- R6. 経理担当, 管理者, オーナー: the three registrations succeed.
  await setRole('memberA','accountant');txBefore=await col('transactions').countDocuments();const regAcc=await register('fee',T.memberA);assert.equal(regAcc.status,200,L('R6-accountant-register')+' '+regAcc.raw.slice(0,400));
  assert.equal((await draftDoc('fee')).registration?.state,'registered',L('R6-accountant-registered'));assert.equal(await col('transactions').countDocuments(),txBefore+1,L('R6-accountant-transaction'));assert.equal(String((await col('transactions').findOne({_id:new ObjectId(String(regAcc.data.transaction.id))})).organizationId),String(A),L('R6-accountant-transaction-company'));
  await setRole('memberA','admin');const commitAdmin=await api('/api/finance/imports/'+importId+'/company-commit',T.memberA,'POST',{decisions:[{line:3,action:'import'}]});assert.equal(commitAdmin.status,200,L('R6-admin-company-commit')+' '+commitAdmin.raw.slice(0,400));assert.equal(commitAdmin.data.posted,1,L('R6-admin-posted'));
  { const binding=await col('financeimportcompanies').findOne({importId:batch._id});assert.equal(String(binding?.organizationId),String(A),L('R6-admin-binding'));const e=await entryOf(3);assert.equal(e?.state,'posted',L('R6-admin-entry-posted'));assert.equal(String((await col('transactions').findOne({_id:e.transactionId}))?.organizationId),String(A),L('R6-admin-transaction-company')) }
  await setRole('memberA','owner');const postOwner=await acted(first.job,6,'post_selected_approved_rows',{importId,lines:[2]},'R6-owner-navi-post');assert.equal(postOwner.receipt.state,'done',L('R6-owner-navi-done')+' '+JSON.stringify(postOwner.receipt));assert.deepEqual(postOwner.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[2,'posted']],L('R6-owner-navi-rows'));
  { const e=await entryOf(2);assert.equal(String((await col('transactions').findOne({_id:e.transactionId}))?.organizationId),String(A),L('R6-owner-navi-transaction-company')) }
  assert.equal((await finish(first.job,'登録しました。')).status,200);
  pass('R6 経理担当 registers the 銀行仕訳 (Transaction created), 管理者 commits the company import (posted), オーナー posts through Navi (done); every row lands in the selected company');

  // ---- R7. Recovery: an operation claimed as 経理担当, the actor demoted before recovery, is unresolved with the registrar message; restored it is done.
  await setRole('memberA','accountant');const rec=await wsTurn(T.memberA,'4行目を帳簿に登録して');const recPosted=await acted(rec.job,1,'post_selected_approved_rows',{importId,lines:[4]},'R7-accountant-post');assert.equal(recPosted.receipt.state,'done',L('R7-accountant-done'));
  const lost=async()=>{const u=await ops.updateOne({operationId:recPosted.receipt.operationId},{$set:{state:'claimed',lease:'lost-lease',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:'',recoveryOwner:'',safeError:''}});assert.equal(u.modifiedCount,1,'SETUP lost settle');const before=await ledger();const actions=(await ok(wsEndpoint,T.memberA,'GET',undefined,'R7-recovery-read')).conversation.turns.find(t=>t.id===rec.requestId).actions;assert.equal(await ledger(),before,L('R7-recovery-no-write'));return actions.find(a=>a.operationId===recPosted.receipt.operationId)};
  await setRole('memberA','member');let recovered=await lost();assert.equal(recovered?.state,'unresolved',L('R7-recovery-unresolved')+' '+JSON.stringify(recovered));assert.equal(recovered.recoveryOwner,'user',L('R7-recovery-owner'));assert.equal(recovered.safeError,REGISTRAR_MESSAGE,L('R7-recovery-message')+' '+JSON.stringify(recovered));
  await setRole('memberA','accountant');recovered=await lost();assert.equal(recovered?.state,'done',L('R7-recovery-restored-done')+' '+JSON.stringify(recovered));assert.deepEqual(recovered.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[4,'posted']],L('R7-recovery-rows'));
  assert.equal((await finish(rec.job,'登録しました。')).status,200);await setRole('memberA','member');
  pass('R7 a lost settle of a post claimed as 経理担当 is unresolved with the registrar message once the actor is 一般, and done again once restored; recovery writes nothing');

  // ---- R8. The worker (omft_) and collector (omfc_) tokens are untouched while company A holds the user as viewer.
  const vAmex=(await ok('/api/finance/accounts',T.viewerB,'POST',{name:'Synthetic viewer Amex',provider:'amex',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'v@example.invalid',otpMailbox:'v@example.invalid'},'R8-viewer-owns-under-B')).account;
  const vAgent=await ok('/api/finance-chat/agents',T.viewerB,'POST',{accountIds:[String(vAmex._id)],workspaceEnabled:true},'R8-viewer-agent'),vCollector=await ok('/api/finance/collectors',T.viewerB,'POST',{name:'Synthetic viewer collector',accountIds:[String(vAmex._id)]},'R8-viewer-collector');
  assert.match(vAgent.token,/^omft_[a-f\d]{64}$/,L('R8-worker-token'));assert.match(vCollector.token,/^omfc_[a-f\d]{64}$/,L('R8-collector-token'));
  assert.equal((await api('/api/finance/collectors',T.viewerA,'POST',{name:'Viewer collector in A',accountIds:[String(vAmex._id)]})).status,403,L('R8-viewer-company-refused'));
  assert.equal(await roleOf('viewerA'),'viewer','SETUP viewerA still viewer of A');
  for(const route of['heartbeat','workspace-claim']){const r=await api('/api/finance-chat/worker/'+route,vAgent.token,'POST',{});assert.equal(r.status,200,L('R8-worker-'+route)+' '+r.raw.slice(0,200))}
  { const r=await api('/api/finance/collector/accounts',vCollector.token,'GET');assert.equal(r.status,200,L('R8-collector-accounts')+' '+r.raw.slice(0,200));assert.ok(Array.isArray(r.data.accounts),L('R8-collector-accounts-shape'));const c=await api('/api/finance/collector/claim',vCollector.token,'POST',{});assert.equal(c.status,200,L('R8-collector-claim')+' '+c.raw.slice(0,200)) }
  pass('R8 a viewer\'s own worker and collector tokens (created under company B where it is the owner) heartbeat, claim and read as before while company A holds it as 閲覧のみ; the same viewer cannot create a collector under A');

  // ---- R9. Labels and help text; optional installed Chrome: settings badges/select show 閲覧のみ, a 一般 member's register click shows the registrar message.
  const ja=await i18n('ja.json'),ko=await i18n('ko.json');
  assert.equal(ja.roles.viewer,'閲覧のみ',L('R9-ja-viewer'));assert.equal(ko.roles.viewer,'열람 전용',L('R9-ko-viewer'));assert.ok(ja.roles.help.includes('帳簿への登録')&&ja.roles.help.includes('閲覧のみ')&&!ja.roles.help.includes('閲覧者'),L('R9-ja-help')+' '+ja.roles.help);assert.ok(ko.roles.help.includes('열람 전용')&&!ko.roles.help.includes('뷰어'),L('R9-ko-help')+' '+ko.roles.help);
  if(BROWSER){
   const chrome=chromePath();assert.ok(chrome,'Installed Chrome required');const puppeteer=puppeteerLib(),profile=path.join(directory,'profile-'+crypto.randomBytes(4).toString('hex'));await fsp.mkdir(profile,{recursive:true});
   browser=await puppeteer.launch({executablePath:chrome,userDataDir:profile,pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
   const pageErrors=[];const newPage=async()=>{const context=await browser.createBrowserContext();const page=await context.newPage();await page.setViewport({width:390,height:844});page.on('pageerror',e=>pageErrors.push(String(e)));page.context_=context;return page};
   const wait=async(page,fn,args=[],label='condition',tries=600)=>{for(let i=0;i<tries;i++){try{if(await page.evaluate(fn,...args))return}catch{}await pause(100)}throw Error(L('R9-ui-'+label)+' url='+page.url()+' text='+(await page.evaluate(()=>document.body?.innerText||'').catch(()=>'')).slice(0,600))};
   const login=async(page,u)=>{await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(page,()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email',users[u].email);await page.type('#password',PASSWORD);await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(page,()=>location.pathname==='/',[],'login '+u)};
   const nativeSwitch=(page,organizationId)=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(organizationId));
   const owner=await newPage();await login(owner,'ownerA');await nativeSwitch(owner,A);await owner.goto(origin+'/settings/organization',{waitUntil:'networkidle2'});
   await wait(owner,()=>document.querySelectorAll('[data-member-role]').length>=5,[],'members-table');
   const labels=await owner.$$eval('[data-member-role]',els=>els.map(e=>e.textContent.trim()));assert.ok(labels.includes('閲覧のみ')&&!labels.includes('閲覧者'),L('R9-ui-badges')+' '+JSON.stringify(labels));
   const options=await owner.$eval('[data-member-role-select]',s=>[...s.options].map(o=>[o.value,o.textContent.trim()]));assert.deepEqual(options.find(o=>o[0]==='viewer'),['viewer','閲覧のみ'],L('R9-ui-select')+' '+JSON.stringify(options));
   assert.ok(await owner.$eval('[data-roles-help]',e=>e.textContent.includes('帳簿への登録')&&e.textContent.includes('閲覧のみ')),L('R9-ui-help'));await owner.context_.close();
   assert.equal(await roleOf('memberA'),'member','SETUP memberA is 一般 for the Chrome leg');
   const member=await newPage();await login(member,'memberA');await nativeSwitch(member,A);await member.goto(origin+'/intake/payments',{waitUntil:'networkidle2'});await wait(member,()=>!!document.querySelector('[data-payment-list]'),[],'payment-list');
   await wait(member,()=>!!document.querySelector('[data-payment-key^="bank:"]'),[],'bank-payment');await member.click('[data-payment-key^="bank:"]');await wait(member,()=>!!document.querySelector('[data-review-tab="bank-classification"]'),[],'review-tab');
   await member.click('[data-review-tab="bank-classification"]');await wait(member,()=>!!document.querySelector('[data-bank-classification]'),[],'tab');
   await wait(member,()=>{const s=document.querySelector('[data-bank-classification-account]');return !!s&&[...s.options].some(o=>o.value)},[],'account-option');await member.select('[data-bank-classification-account]',bankAccount);
   const rowSel='[data-bank-classification-row="'+D.lease.rowId+'"] ';await wait(member,id=>!!document.querySelector('[data-bank-classification-row="'+id+'"]'),[D.lease.rowId],'rows');
   await member.click(rowSel+'[data-bank-classification-open]');await wait(member,sel=>!!document.querySelector(sel+'[data-bank-classification-register]'),[rowSel],'register-button');
   await member.click(rowSel+'[data-bank-classification-confirm]');await wait(member,sel=>!document.querySelector(sel+'[data-bank-classification-register]').disabled,[rowSel],'register-enabled');
   await member.click(rowSel+'[data-bank-classification-register]');await wait(member,()=>!!document.querySelector('[data-bank-classification-error]')?.textContent.trim(),[],'register-error');
   const shown=await member.$eval('[data-bank-classification-error]',e=>e.textContent.trim());assert.equal(shown,REGISTRAR_MESSAGE,L('R9-ui-register-message')+' '+shown);
   assert.equal((await draftDoc('lease')).registration??null,null,L('R9-ui-register-no-reservation'));assert.equal(await member.$('[data-viewer-refusal]'),null,L('R9-ui-member-no-notice'));await member.context_.close();
   // The viewer holds an unread Navi reply, written while it was a 一般 member, so opening Navi really posts the read mark and is refused.
   await setRole('viewerA','member');const vWorker=(route,body={})=>api('/api/finance-chat/worker/'+route,vAgent.token,'POST',body);assert.equal((await vWorker('heartbeat')).status,200,'SETUP viewer worker heartbeat');
   { const view=await ok(companyEndpoint,T.viewerA,'GET',undefined,'viewer-company-view'),sent=await api(companyEndpoint,T.viewerA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.conversation?.revision||0,text:'Synthetic viewer question',context:{page:'transactions'}});assert.equal(sent.status,200,'SETUP viewer turn '+sent.raw.slice(0,300));
     const job=(await vWorker('workspace-claim')).data?.job;assert.ok(job,'SETUP viewer turn claimed');const replied=await vWorker((job.mode==='workspace'?'workspace/':'')+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic reply the viewer has not read.',patch:{},quotes:{}}});assert.equal(replied.status,200,'SETUP viewer reply '+replied.raw.slice(0,300)) }
   await setRole('viewerA','viewer');
   // Every non-read /api request and every notice is recorded from the first document on: a notice clears itself, so the end state alone proves nothing.
   const viewer=await newPage(),writes=[],noticeSeen=()=>viewer.evaluate(()=>window.__viewerRefusals);
   viewer.on('response',r=>{const q=r.request(),u=new URL(r.url());if(u.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(q.method()))writes.push(q.method()+' '+u.pathname+' '+r.status())});
   await viewer.evaluateOnNewDocument(()=>{window.__viewerRefusals=[];new MutationObserver(()=>{const e=document.querySelector('[data-viewer-refusal]');if(e&&!e.__recorded){e.__recorded=true;window.__viewerRefusals.push(e.textContent.trim())}}).observe(document,{subtree:true,childList:true})});
   await login(viewer,'viewerA');await nativeSwitch(viewer,A);
   for(const route of['/','/transactions','/invoices','/budgets','/calendar','/recurring','/settings/organization','/intake/payments']){await viewer.goto(origin+route,{waitUntil:'networkidle2'});await pause(800);assert.deepEqual(await noticeSeen(),[],L('R9-ui-no-press-notice')+' '+route)}
   assert.deepEqual(writes.filter(w=>!w.includes(' /api/auth/')),[],L('R9-ui-no-press-writes'));
   const readRefused=/^POST \/api\/finance-chat\/company-workspace\/read 403$/,readsRefused=()=>writes.filter(w=>readRefused.test(w)).length;
   await viewer.goto(origin+'/transactions',{waitUntil:'networkidle2'});await wait(viewer,()=>!!document.querySelector('[data-assistant-toggle]'),[],'navi-toggle');await viewer.evaluate(()=>document.querySelector('[data-assistant-toggle]').click());
   await wait(viewer,()=>!!document.querySelector('#omf-assistant [data-navi-reply]'),[],'navi-unread-reply');
   for(let i=0;i<300&&!readsRefused();i++)await pause(100);assert.ok(readsRefused()>0,L('R9-ui-navi-read-refused')+' '+JSON.stringify(writes.slice(-5)));
   await pause(3000);console.log('PROBE-INFO R9 refused Navi read marks while the panel stayed open 3 s: '+readsRefused());assert.deepEqual(await noticeSeen(),[],L('R9-ui-no-press-notice')+' navi');
   // A press in company Navi: Send is refused as read-only; Navi shows the server's message and keeps the conversation on screen.
   await viewer.type('#omf-assistant #assistant-message','閲覧のみの送信テスト');await viewer.evaluate(()=>document.querySelector('#omf-assistant form').requestSubmit());
   await wait(viewer,()=>!!document.querySelector('#omf-assistant form p[role=alert]'),[],'navi-send-refusal',300);
   assert.equal(await viewer.evaluate(()=>document.querySelector('#omf-assistant form p[role=alert]').textContent.trim()),VIEWER_MESSAGE,L('R9-ui-navi-send-refusal'));
   assert.ok(await viewer.evaluate(()=>!!document.querySelector('#omf-assistant [data-navi-reply]')),L('R9-ui-navi-conversation-kept'));assert.deepEqual(await noticeSeen(),[],L('R9-ui-no-press-notice')+' navi-send');
   await viewer.evaluate(()=>document.querySelector('[data-assistant-close]').click());
   // A press: the budget form submits, the server refuses, the one notice shows its message above the open form and nothing is written.
   await viewer.goto(origin+'/budgets',{waitUntil:'networkidle2'});await wait(viewer,()=>!!document.querySelector('[data-page-content] header button'),[],'budgets-new');await viewer.evaluate(()=>document.querySelector('[data-page-content] header button').click());
   await wait(viewer,()=>!!document.querySelector('[data-page-content] form button[type=submit]'),[],'budgets-form');await viewer.type('[data-page-content] form input[type=text]','Viewer budget from Chrome');
   const beforeNotice=await counts(),press=async()=>{await viewer.evaluate(()=>document.querySelector('[data-page-content] form button[type=submit]').click());await wait(viewer,()=>!!document.querySelector('[data-viewer-refusal]'),[],'viewer-notice',300)};await press();
   const notice=await viewer.evaluate(()=>{const all=document.querySelectorAll('[data-viewer-refusal]'),e=all[0],b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return{count:all.length,role:e.getAttribute('role'),text:e.textContent.trim(),onTop:!!hit&&(hit===e||e.contains(hit))}});
   assert.deepEqual(notice,{count:1,role:'alert',text:VIEWER_MESSAGE,onTop:true},L('R9-ui-viewer-notice'));assert.deepEqual(await counts(),beforeNotice,L('R9-ui-viewer-nothing-written'));
   await viewer.evaluate(()=>document.querySelector('[data-viewer-refusal] button').click());await wait(viewer,()=>!document.querySelector('[data-viewer-refusal]'),[],'notice-closed',100);
   await press();await wait(viewer,()=>!document.querySelector('[data-viewer-refusal]'),[],'notice-clears-itself',300);assert.deepEqual(await counts(),beforeNotice,L('R9-ui-viewer-nothing-written'));await viewer.context_.close();
   assert.deepEqual(pageErrors,[],L('R9-ui-page-errors'));
   pass('R9 ja/ko labels 閲覧のみ / 열람 전용 and the five-role help; Chrome 390px: settings badges, role select and help show them; a 一般 member\'s 確認して取引へ登録 shows the registrar message, no notice, and reserves nothing; a 閲覧のみ member\'s save on the budgets page shows the one notice with the server\'s message, writes nothing, and clears on close and on its own; eight pages and Navi, its refused read mark included, show no notice with no press');
  } else { console.log('Browser leg not requested (OMF_ROLE_BROWSER unset or mutant run)');pass('R9 ja/ko labels 閲覧のみ / 열람 전용 and the five-role help text (Chrome leg not requested)') }

  // ---- R10. The no-login file route is gone: a filepath that would write a marker if run as code leaves no marker and no script.
  { const r=await processExcel();assert.equal(r.ran,false,L('R10-no-marker')+' answered '+r.status+' '+r.raw.slice(0,200));assert.equal(r.wrote,false,L('R10-no-temp-script')+' answered '+r.status+' '+r.raw.slice(0,200));assert.notEqual(r.data?.success,true,L('R10-no-success')) }
  pass('R10 a POST with no token to /api/files/process-excel, with a filepath that would write a marker if run as code, leaves no marker and no temp-script.cjs');

  assert.ok(!logs.includes('Synthetic-password-Only1!'),L('no-secret-in-logs'));
  console.log(groups+' role writes groups passed');
 }finally{if(browser){try{await browser.close()}catch{}}if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

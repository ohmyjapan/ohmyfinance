// OMF security fixes (plan omf-security-fixes-20261102 §4) on the actual built application: attachment ownership by name grammar and
// company prefix (S2/S3), honest counts and company filters on the twelve company routes (S4-S13), admin-only DNS-bound webhooks
// (S14), shared masters writable by nobody in-app including the two finance-import continuations (S15/S19), the operator CLI (S20),
// session renewal bound to the password generation with persisted logout (S16), request-lifetime upload storage behind a login
// (S17), the tracked workbooks gone (S18). Owned throwaway MongoDB, an owned temporary directory as the server's cwd (uploads/,
// backups/, server/data/ and the Excel child scripts land there), an owned loopback HTTP listener, synthetic users/companies/rows
// only; no model, provider, network, mail, Slack or business send. Every assertion is labelled `security:L<n>-<name>` so the fixture
// can name the assertion a reintroduced defect must flip. A non-throwing PROBE ledger first names legs that must FAIL on the
// unchanged build. OMF_SECURITY_LEGS selects legs (default: every API leg; L9 needs OMF_SECURITY_BROWSER=1 and installed Chrome).
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken'),otp=require('otplib'),XLSX=require('xlsx');
const root=path.resolve(process.env.OMF_SECURITY_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const MUTANT=process.env.OMF_SECURITY_MUTANT==='1',BROWSER=process.env.OMF_SECURITY_BROWSER==='1';
const ALL_LEGS=['L1','L2','L3','L4','L4b','L5','L5b','L5c','L6','L6client','L7','L8','L9'];
const LEGS=new Set((process.env.OMF_SECURITY_LEGS||ALL_LEGS.join(',')).split(',').map(s=>s.trim()).filter(Boolean));
if(!BROWSER)LEGS.delete('L9');if(MUTANT)LEGS.delete('L8');
const PASSWORD='Synthetic-password-Only1!',CHANGED='Synthetic-password-Changed2!',EXPENSE='支出';
const SHARED_MESSAGE='共通の勘定科目・税区分・区分・テンプレートはアプリからは変更できません。',ADMIN_MESSAGE='この操作は管理者以上のメンバーだけができます。';
const L=tag=>'security:'+tag;
const tsxCli=()=>process.env.OMF_SECURITY_TSX||require.resolve('tsx/cli');
async function main(){
 assert.equal(process.env.OMF_SECURITY_FIXTURE,'owned','SETUP: run only through the owned fixture');
 let mongo,client,child,directory,listener,groups=0,logs='';const pass=name=>{groups++;console.log('PASS '+name)};
 const hits=[];
 try{
  // ---- owned resources: temp directory (server cwd), xlsx shim for the Excel child scripts, Mongo, loopback listener, server.
  const free=await new Promise((res,rej)=>fs.statfs(os.tmpdir(),(e,s)=>e?rej(e):res(s.bavail*s.bsize)));assert.ok(free>500*1024*1024,'SETUP temp drive needs 500 MiB free');
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-security-'));
  await fsp.mkdir(path.join(directory,'node_modules','xlsx'),{recursive:true});await fsp.writeFile(path.join(directory,'node_modules','xlsx','index.js'),'module.exports = require('+JSON.stringify(require.resolve('xlsx'))+');\n');
  const uploads=path.join(directory,'uploads','attachments'),backups=path.join(directory,'backups'),downloadDir=path.join(directory,'server','data','download'),processedDir=path.join(directory,'server','data','processed');
  for(const d of[uploads,backups,downloadDir,processedDir])await fsp.mkdir(d,{recursive:true});
  const binary=process.env.OMF_MONGOD_BINARY||path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  assert.ok(fs.existsSync(binary),'SETUP local Mongo binary required; downloads are disabled');
  mongo=await MongoMemoryServer.create({binary:{systemBinary:binary,version:'8.2.1'},instance:{launchTimeout:300000}});
  const dbName='security_regression',uri=mongo.getUri(dbName);assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:\d+\//,'SETUP owned database is the local memory server');
  listener=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{hits.push({method:req.method,url:req.url,host:req.headers.host,body});if(req.url==='/fail'){res.statusCode=500;return res.end('fail')}if(req.url==='/redirect'){res.statusCode=302;res.setHeader('Location','/hook');return res.end()}res.setHeader('Content-Type','application/json');res.end('{}')})});
  await new Promise(r=>listener.listen(0,'127.0.0.1',r));const listenerPort=listener.address().port,listenerUrl='http://127.0.0.1:'+listenerPort;
  const portProbe=net.createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  const env={...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)};
  const start=async()=>{
   child=spawn(process.execPath,[path.join(root,'.output','server','index.mjs')],{cwd:directory,windowsHide:true,env,stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const s of[child.stdout,child.stderr]){s.setEncoding('utf8');s.on('data',t=>{logs=(logs+t).slice(-60000)})}
   for(let i=0;i<300;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,dbName);return}}catch{}await pause(200)}throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  };
  const stop=async()=>{if(child){child.kill();await child.closed;child=null}};
  await start();client=await MongoClient.connect(uri);const db=client.db(dbName);const col=n=>db.collection(n);
  const api=async(route,token,method='GET',body,headers={})=>{const isBuffer=Buffer.isBuffer(body),isForm=typeof FormData!=='undefined'&&body instanceof FormData;const response=await fetch(origin+route,{method,headers:{...(isForm||body===undefined?{}:{'Content-Type':isBuffer?'text/csv':'application/json'}),...headers,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:isBuffer||isForm?body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});const bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8');let data;try{data=JSON.parse(raw)}catch{}return{status:response.status,raw,data,bytes,headers:response.headers}};
  const ok=async(route,token,method='GET',body,label='positive')=>{const r=await api(route,token,method,body);assert.equal(r.status,200,L(label)+' '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  // node:http sends the request target byte-for-byte (WHATWG fetch folds dot segments first): the router negatives use it.
  const raw=(rawPath,token,method='GET')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:rawPath,method,headers:{Authorization:'Bearer '+token}},res=>{let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,raw:text,headers:res.headers}))});req.on('error',reject);req.end()});
  const form=(name,bytes,fields={},type='application/octet-stream')=>{const f=new FormData();for(const[k,v]of Object.entries(fields))f.append(k,v);f.append('file',new Blob([bytes],{type}),name);return f};
  const errorMessage=r=>String(r.data?.data?.message||r.data?.message||r.data?.statusMessage||r.raw||'');
  const claims=token=>jwt.decode(token)||{};
  const snapshot=async(names,filter={})=>JSON.stringify(await Promise.all(names.map(n=>col(n).find(filter).sort({_id:1}).toArray())));
  const leg=async(name,fn)=>{if(!LEGS.has(name))return;await fn()};

  // ---- SETUP: users (real bcrypt hash: the login page and the password change check it), companies, tokens, rows.
  const hash=await require('bcryptjs').hash(PASSWORD,4),users={};
  const makeUser=async(key)=>{const id=new ObjectId(),at=new Date(),email='security-'+key.toLowerCase()+'@example.invalid';await col('users').insertOne({_id:id,email,password:hash,name:'Synthetic '+key,isActive:true,isEmailVerified:true,preferences:{language:'ja',currency:'JPY',timezone:'Asia/Tokyo',darkMode:false},loginAttempts:0,twoFactorEnabled:false,createdAt:at,updatedAt:at});users[key]={key,email,id,plain:jwt.sign({userId:String(id),email,jti:crypto.randomUUID()},secret,{expiresIn:'3h'})}};
  for(const k of['ownerA','adminA','accA','memberA','viewerA','ownerB','loner'])await makeUser(k);
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),m=(u,role)=>({userId:users[u].id,role,joinedAt:now});
  const settings={defaultCurrency:'JPY',fiscalYearStart:4,timezone:'Asia/Tokyo',invoicePrefix:'INV',invoiceNextNumber:1};
  await col('organizations').insertMany([{_id:A,name:'Synthetic security company A',slug:'security-a',type:'business',isActive:true,members:[m('ownerA','owner'),m('adminA','admin'),m('accA','accountant'),m('memberA','member'),m('viewerA','viewer')],settings,createdAt:now,updatedAt:now},{_id:B,name:'Synthetic security company B',slug:'security-b',type:'business',isActive:true,members:[m('ownerB','owner')],settings,createdAt:now,updatedAt:now}]);
  const switchTokens=async(u,company)=>(await ok('/api/auth/switch-organization',users[u].plain,'POST',{organizationId:String(company)},'switch '+u)).tokens;
  const T={};for(const u of['ownerA','adminA','accA','memberA','viewerA'])T[u]=await switchTokens(u,A);T.ownerB=await switchTokens('ownerB',B);
  const tok=u=>T[u].accessToken;const LONER=users.loner.plain;
  // ownerA keeps 2FA (the owned secret produces the codes).
  const twofa=await ok('/api/auth/2fa/setup',tok('ownerA'),'POST',{},'2fa-setup');const totp=()=>otp.generateSync({secret:twofa.secret,strategy:'totp'});await ok('/api/auth/2fa/enable',tok('ownerA'),'POST',{code:totp()},'2fa-enable');
  // Invites: pending 64-hex rows in A for a new e-mail and for B's owner (the only minted shape, models/Invite.ts:89-91).
  const inviteToken=()=>crypto.randomBytes(32).toString('hex'),newEmail='security-invited-new@example.invalid',inviteNew=inviteToken(),inviteOwnerB=inviteToken(),inviteExpires=new Date(Date.now()+7*86400000);
  await col('invites').insertMany([{email:newEmail,organizationId:A,role:'member',token:inviteNew,expiresAt:inviteExpires,createdBy:users.ownerA.id,status:'pending',createdAt:now,updatedAt:now},{email:users.ownerB.email,organizationId:A,role:'accountant',token:inviteOwnerB,expiresAt:inviteExpires,createdBy:users.ownerA.id,status:'pending',createdAt:now,updatedAt:now}]);
  // Attachment files: S3-named for A and B, a prefix-less decoy, a planted uploads/.env sentinel.
  const fileA=String(A)+'-1700000000000-aaa1.pdf',fileA2=String(A)+'-1700000000002-aaa2.png',fileB=String(B)+'-1700000000001-bbb1.pdf',decoy='legacy-decoy.pdf';
  await fsp.writeFile(path.join(uploads,fileA),'A-PDF');await fsp.writeFile(path.join(uploads,fileA2),'A-PNG');await fsp.writeFile(path.join(uploads,fileB),'B-PDF');await fsp.writeFile(path.join(uploads,decoy),'DECOY');await fsp.writeFile(path.join(directory,'uploads','.env'),'SENTINEL=1');
  const att=(filename,originalName='original.bin')=>({originalName,filename,path:'/uploads/attachments/'+filename,size:5,mimeType:'application/octet-stream',uploadedAt:now});
  // Transactions (organizationId is set by trusted server code with strict:false; the seed writes it the same way).
  const tx=(company,extra)=>({_id:new ObjectId(),organizationId:company,referenceNumber:extra.ref,productName:extra.product||'Synthetic item',amount:extra.amount||1000,date:new Date(extra.date||'2026-03-01'),status:extra.status||'completed',type:EXPENSE,currency:'JPY',source:'manual',hasReceipt:false,items:[],timeline:[],attachments:extra.attachments||[],tags:extra.tags||[],notes:extra.notes||'',customer:extra.customer||{name:extra.customerName||'Synthetic customer'},metadata:{},createdAt:now,updatedAt:now});
  const R={
   txA1:tx(A,{ref:'ALPHA-A1',notes:'Alpha own file',attachments:[att(fileA,'alpha.pdf')],customerName:'Alpha Vendor'}),
   txA2:tx(A,{ref:'ALPHA-A2',notes:'Alpha second',tags:['alpha-tag']}),txA3:tx(A,{ref:'ALPHA-A3',notes:'Alpha third',tags:['alpha-tag','shared-tag']}),
   txAplant:tx(A,{ref:'ALPHA-PLANT',notes:'Alpha planted reference to B file',attachments:[att(fileB,'planted.pdf')]}),
   keeper:tx(A,{ref:'KEEP-1',amount:5000,date:'2026-02-01',customerName:'Dup Customer',tags:['k'],notes:'keep'}),
   dupA:tx(A,{ref:'DUP-1',amount:5000,date:'2026-02-01',customerName:'Dup Customer',tags:['d'],notes:'dup note',attachments:[att(fileA2,'dup.png')]}),
   txB1:tx(B,{ref:'BETA-B1',notes:'Beta own file',attachments:[att(fileB,'beta.pdf')],customerName:'Alpha Vendor'}),
   txBref:tx(B,{ref:'BETA-REF',notes:'Beta references A file',attachments:[att(fileA,'borrowed.pdf')]}),
   txB2:tx(B,{ref:'BETA-B2',notes:'Beta second',tags:['beta-tag']}),txB3:tx(B,{ref:'BETA-B3',notes:'Beta third',tags:['beta-tag']}),
   dupB:tx(B,{ref:'DUP-B',amount:5000,date:'2026-02-01',customerName:'Dup Customer',tags:['b'],notes:'beta dup'})
  };
  await col('transactions').insertMany(Object.values(R));
  const id=k=>String(R[k]._id);
  const day=n=>new Date(Date.now()+n*86400000);
  await col('receipts').insertMany([{_id:new ObjectId(),organizationId:A,filename:'alpha-receipt.pdf',originalFilename:'alpha-receipt.pdf',size:10,uploadDate:day(-10),status:'unmatched',merchant:'Alpha Shop',createdAt:now,updatedAt:now},{_id:new ObjectId(),organizationId:B,filename:'beta-receipt.pdf',originalFilename:'beta-receipt.pdf',size:10,uploadDate:day(-10),status:'unmatched',merchant:'Beta Shop',createdAt:now,updatedAt:now}]);
  const rp=(company,name,extra)=>({_id:new ObjectId(),organizationId:company,createdBy:users.ownerA.id,name,amount:3000,currency:'JPY',frequency:'monthly',startDate:day(-60),nextDueDate:day(3),status:'active',source:'manual',customer:{name:name+' payee'},autoGenerate:false,createdAt:now,updatedAt:now,...extra});
  const RP={aUp:rp(A,'Alpha Rent',{}),aOver:rp(A,'Alpha Overdue',{nextDueDate:day(-2)}),aLegacy:rp(A,'Alpha Legacy',{isActive:true,status:undefined,nextDueDate:day(2)}),bUp:rp(B,'Beta Rent',{}),bOver:rp(B,'Beta Overdue',{nextDueDate:day(-3)}),bLegacy:rp(B,'Beta Legacy',{isActive:true,status:undefined,nextDueDate:day(2)})};
  for(const r of Object.values(RP))if(r.status===undefined)delete r.status;await col('recurringpayments').insertMany(Object.values(RP));
  await col('invoices').insertMany([{_id:new ObjectId(),organizationId:A,invoiceNumber:'INV-A-1',status:'draft',from:{name:'A'},to:{name:'Alpha client'},items:[],createdAt:now,updatedAt:now},{_id:new ObjectId(),organizationId:B,invoiceNumber:'INV-B-1',status:'draft',from:{name:'B'},to:{name:'Beta client'},items:[],createdAt:now,updatedAt:now}]);
  await col('budgets').insertMany([{_id:new ObjectId(),organizationId:A,name:'Alpha budget',amount:1,currency:'JPY',isActive:true,createdAt:now,updatedAt:now},{_id:new ObjectId(),organizationId:B,name:'Beta budget',amount:1,currency:'JPY',isActive:true,createdAt:now,updatedAt:now}]);
  const vendorA=new ObjectId(),vendorB=new ObjectId();await col('vendors').insertMany([{_id:vendorA,organizationId:A,name:'Alpha Vendor',isActive:true,totalSpent:0,transactionCount:0,createdAt:now,updatedAt:now},{_id:vendorB,organizationId:B,name:'Beta Vendor',isActive:true,totalSpent:0,transactionCount:0,createdAt:now,updatedAt:now}]);
  const shipA=new ObjectId(),shipB=new ObjectId(),shipCross=new ObjectId(),ev=[{type:'created',title:'Shipment Created',timestamp:now}];
  await col('shipments').insertMany([{_id:shipA,organizationId:A,trackingNumber:'ALPHA-TRK',status:'pending',transactionIds:[R.txA1._id],events:ev,createdAt:now,updatedAt:now},{_id:shipB,organizationId:B,trackingNumber:'BETA-TRK',status:'shipped',transactionIds:[R.txB1._id],events:ev,createdAt:now,updatedAt:now},{_id:shipCross,organizationId:A,trackingNumber:'CROSS-TRK',status:'pending',transactionIds:[R.txB1._id],events:ev,createdAt:now,updatedAt:now}]);
  const hookA=new ObjectId(),hookB=new ObjectId();await col('webhooks').insertMany([{_id:hookA,organizationId:A,name:'Alpha hook',url:listenerUrl+'/hook',events:['transaction.created'],secret:'alpha-secret-value',isActive:true,headers:{'X-Alpha':'1'},failCount:0,createdAt:now,updatedAt:now},{_id:hookB,organizationId:B,name:'Beta hook',url:listenerUrl+'/hook',events:['transaction.created'],secret:'beta-secret-value',isActive:true,headers:{'X-Beta':'1'},failCount:0,createdAt:now,updatedAt:now}]);
  // Shared masters: one account category carries a company registration for A (select:false in the model).
  const acctTop=new ObjectId(),acctSub=new ObjectId(),taxId=new ObjectId(),tcatId=new ObjectId(),catId=new ObjectId(),tplId=new ObjectId();
  const registration={organizationId:A,registeredBy:users.ownerA.id,registeredAt:now,via:'registered'};
  await col('accountcategories').insertMany([{_id:acctTop,name:'Synthetic 経費',code:'600',type:'expense',isActive:true,order:0,createdAt:now,updatedAt:now},{_id:acctSub,name:'Synthetic 通信費',code:'602',parentId:acctTop,type:'expense',isActive:true,order:0,companyRegistrations:[registration],createdAt:now,updatedAt:now}]);
  await col('taxcategories').insertOne({_id:taxId,name:'Synthetic 課税仕入 10%',rate:10,createdAt:now,updatedAt:now});
  await col('transactioncategories').insertOne({_id:tcatId,name:'Synthetic 区分',createdAt:now,updatedAt:now});
  await col('categories').insertOne({_id:catId,name:'Synthetic category',type:'both',color:'#7c3aed',isDefault:false,order:0,createdAt:now,updatedAt:now});
  await col('mappingtemplates').insertOne({_id:tplId,name:'Synthetic template',sourceType:'custom',mappings:[{sourceField:'a',targetField:'amount',format:'text'}],isDefault:false,createdAt:now,updatedAt:now});
  const MASTERS=['accountcategories','taxcategories','transactioncategories','categories','mappingtemplates'];
  // Synthetic spreadsheet bytes for the upload legs.
  const xlsxBytes=(()=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Date','Amount'],['2026-01-01',100],['2026-01-02',200]]),'Sheet1');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'})})();
  const csvBytes=Buffer.from('Date,Amount\r\n2026-01-01,100\r\n2026-01-02,200\r\n','utf8'),corruptBytes=crypto.randomBytes(2048),rejectedBytes=Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.alloc(1024,0x41)]),hugeBytes=Buffer.alloc(11*1024*1024,1);
  const xlsxPath=path.join(directory,'synthetic-rows.xlsx'),csvPath=path.join(directory,'synthetic-rows.csv');await fsp.writeFile(xlsxPath,xlsxBytes);await fsp.writeFile(csvPath,csvBytes);
  const dataFiles=async()=>({download:(await fsp.readdir(downloadDir)).sort(),processed:(await fsp.readdir(processedDir)).sort()});
  const passwordChanged={};
  const changePassword=async(u)=>{if(passwordChanged[u])return passwordChanged[u];const r=await api('/api/users/me/password',tok(u),'POST',{currentPassword:PASSWORD,newPassword:CHANGED,confirmPassword:CHANGED});assert.equal(r.status,200,L('L6-change-200')+' '+u+' '+r.raw.slice(0,300));passwordChanged[u]=r.data;return r.data};
  const refresh=token=>api('/api/auth/refresh',null,'POST',{refreshToken:token});
  const svOf=async u=>(await col('users').findOne({_id:users[u].id})).sessionVersion??0;

  // ---- 0. Fail-first ledger (non-throwing): legs that must FAIL on the unchanged build.
  const probe=(label,v)=>{console.log((v?'PROBE-OK ':'PROBE-FAIL ')+label);return v};
  { const r=await api('/api/attachments/'+fileB,tok('ownerA'));probe('L2 security:L2-foreign-404 (A cannot read B\'s file by name)',r.status===404) }
  { const r=await api('/api/account-categories',tok('memberA'),'POST',{name:'Probe account',type:'expense'});probe('L5 security:L5-account-categories-post (a member cannot add a shared account)',r.status===403);if(r.status===200&&r.data?._id)await col('accountcategories').deleteOne({_id:new ObjectId(String(r.data._id))}) }
  { const r=await api('/api/upload',null,'POST',form('probe.xlsx',xlsxBytes));probe('L7 security:L7-upload-anon-401 (an anonymous upload is refused)',r.status===401);for(const d of[downloadDir,processedDir])for(const f of await fsp.readdir(d))await fsp.unlink(path.join(d,f)) }
  { const r=await api('/api/transactions/bulk',tok('ownerA'),'POST',{action:'export',ids:[id('txB2')]});probe('L3 security:L3-bulk-export-scope (bulk export of B ids by A returns nothing)',r.data?.count===0) }

  // ---- L1. Invite token shape, minted session, stale bearer (S1).
  await leg('L1',async()=>{
   const usersBefore=await col('users').countDocuments();
   let r=await api('/api/invites/accept',null,'POST',{token:{$ne:null},name:'Probe',password:PASSWORD});assert.equal(r.status,400,L('L1-token-object-400')+' '+r.raw.slice(0,200));assert.equal(await col('users').countDocuments(),usersBefore,L('L1-token-object-nothing-created'));
   r=await api('/api/invites/accept',null,'POST',{token:'not-a-token'});assert.equal(r.status,400,L('L1-token-shape-400')+' '+r.raw.slice(0,200));
   r=await api('/api/invites/accept',null,'POST',{token:inviteToken()});assert.equal(r.status,404,L('L1-unknown-token-404')+' '+r.raw.slice(0,200));
   r=await api('/api/invites/accept',null,'POST',{token:inviteOwnerB});assert.equal(r.status,200,L('L1-existing-requires-login')+' '+r.raw.slice(0,200));assert.equal(r.data.requiresLogin,true,L('L1-existing-requires-login')+' '+r.raw.slice(0,200));
   r=await api('/api/invites/accept',null,'POST',{token:inviteNew});assert.equal(r.data?.requiresRegistration,true,L('L1-new-requires-registration')+' '+r.raw.slice(0,200));
   r=await api('/api/invites/accept',null,'POST',{token:inviteNew,name:'Synthetic invited',password:PASSWORD});assert.equal(r.status,200,L('L1-new-user-200')+' '+r.raw.slice(0,300));assert.equal(r.data.success,true,L('L1-new-user-200'));
   const created=await col('users').findOne({email:newEmail});assert.ok(created,L('L1-new-user-created'));assert.equal(claims(r.data.tokens.accessToken).sv,created.sessionVersion??0,L('L1-new-user-mint-sv')+' '+JSON.stringify(claims(r.data.tokens.accessToken)));assert.equal(typeof claims(r.data.tokens.accessToken).sv,'number',L('L1-new-user-mint-sv'));
   const renewed=await refresh(r.data.tokens.refreshToken);assert.equal(renewed.status,200,L('L1-new-user-refreshes')+' '+renewed.raw.slice(0,200));
   // A bearer minted before the password change is not a sign-in for the existing-user path.
   const stale=tok('ownerB');await changePassword('ownerB');
   r=await api('/api/invites/accept',stale,'POST',{token:inviteOwnerB});assert.equal(r.status,200,L('L1-stale-bearer-requires-login')+' '+r.raw.slice(0,300));assert.equal(r.data.requiresLogin,true,L('L1-stale-bearer-requires-login')+' '+r.raw.slice(0,300));
   assert.equal((await col('organizations').findOne({_id:A})).members.some(x=>String(x.userId)===String(users.ownerB.id)),false,L('L1-stale-bearer-no-membership'));
   pass('L1 invite token shape (object/short/unknown), the new user\'s minted session refreshes with sv = sessionVersion, an existing user without a sign-in and a stale-version bearer both get requiresLogin');
  });

  // ---- L2. Attachment grammar, prefix ownership, planted and foreign references, router negatives, upload entity before write (S2/S3).
  await leg('L2',async()=>{
   let r=await api('/api/attachments/'+fileA,tok('ownerA'));assert.equal(r.status,200,L('L2-own-get')+' '+r.raw.slice(0,200));assert.equal(r.raw,'A-PDF',L('L2-own-get-bytes'));assert.equal(r.headers.get('content-type'),'application/pdf',L('L2-own-get-type'));
   r=await api('/api/attachments/'+fileB,tok('ownerA'));assert.equal(r.status,404,L('L2-foreign-404')+' '+r.raw.slice(0,200));assert.equal(await fsp.readFile(path.join(uploads,fileB),'utf8'),'B-PDF',L('L2-foreign-file-intact'));
   // A reference planted on A's own transaction confers nothing: the prefix decides.
   assert.equal((await col('transactions').findOne({_id:R.txAplant._id})).attachments[0].filename,fileB,'SETUP planted reference');
   r=await api('/api/attachments/'+fileB,tok('ownerA'));assert.equal(r.status,404,L('L2-planted-reference-404'));
   for(const name of['.env','A-x%2F..%2Fsecret','..%5C..%5Cx','%2e%2e.env','legacy-decoy.pdf',String(A)+'-'+encodeURIComponent('a b.pdf')]){r=await api('/api/attachments/'+name,tok('ownerA'));assert.equal(r.status,400,L('L2-grammar-400')+' '+name+' '+r.raw.slice(0,200));assert.equal(r.data?.statusMessage,'Invalid attachment name',L('L2-grammar-message')+' '+name+' '+r.raw.slice(0,200))}
   // Multi-segment targets miss the attachment route and can return Nuxt's SPA shell (ssr:false, catch-all) with 200.
   // Accept that shell only; no response may expose fixture file bytes. Handler-reaching grammar checks above stay exact 400s.
   const routerPaths=['/api/attachments/..','/api/attachments/%2e%2e','/api/attachments/../.env','/api/attachments/..\\..\\x','/api/attachments/../../uploads/.env'];
   for(const [index,rawPath] of routerPaths.entries())for(const method of['GET','DELETE']){
    const p=await raw(rawPath,tok('ownerA'),method),caseLabel=method+' case-'+(index+1);
    console.log('PROBE L2-router '+caseLabel+' -> '+p.status);
    const spa=p.status===200&&/^text\/html(?:;|$)/i.test(p.headers['content-type']||'')&&p.raw.includes('<div id="__nuxt">')&&p.raw.includes('id="__NUXT_DATA__"');
    assert.ok((p.status>=400&&p.status<500)||spa,L('L2-router-rejection-or-spa')+' '+caseLabel);
    assert.ok(!['SENTINEL=1','DECOY','A-PDF','A-PNG','B-PDF'].some(bytes=>p.raw.includes(bytes)),L('L2-router-no-file-bytes')+' '+caseLabel);
   }
   assert.equal(await fsp.readFile(path.join(directory,'uploads','.env'),'utf8'),'SENTINEL=1',L('L2-sentinel-intact'));assert.equal(await fsp.readFile(path.join(uploads,decoy),'utf8'),'DECOY',L('L2-decoy-intact'));
   r=await api('/api/attachments/'+fileA,LONER);assert.equal(r.status,403,L('L2-no-company-403')+' '+r.raw.slice(0,200));r=await api('/api/attachments/'+fileA,null);assert.equal(r.status,401,L('L2-no-login-401'));
   for(const role of['adminA','accA','memberA','viewerA']){r=await api('/api/attachments/'+fileA,tok(role));assert.equal(r.status,200,L('L2-legitimate-role')+' '+role)}
   // DELETE pulls the owner's reference and the file; B's reference to the same name is preserved.
   r=await api('/api/attachments/'+fileB,tok('ownerA'),'DELETE');assert.equal(r.status,404,L('L2-foreign-delete-404'));assert.ok(fs.existsSync(path.join(uploads,fileB)),L('L2-foreign-delete-file-intact'));
   r=await api('/api/attachments/'+fileA,tok('ownerA'),'DELETE');assert.equal(r.status,200,L('L2-own-delete')+' '+r.raw.slice(0,200));
   assert.equal((await col('transactions').findOne({_id:R.txA1._id})).attachments.length,0,L('L2-delete-pulls-own'));assert.equal(fs.existsSync(path.join(uploads,fileA)),false,L('L2-delete-file-gone'));
   assert.equal((await col('transactions').findOne({_id:R.txBref._id})).attachments[0]?.filename,fileA,L('L2-delete-keeps-foreign-reference'));
   // Upload: the entity is resolved in the company before any byte is written.
   const before=(await fsp.readdir(uploads)).sort(),txB1Before=JSON.stringify(await col('transactions').findOne({_id:R.txB1._id}));
   r=await api('/api/attachments/upload',tok('ownerA'),'POST',form('foreign.pdf',Buffer.from('X'),{entityType:'transaction',entityId:id('txB1')},'application/pdf'));assert.equal(r.status,404,L('L2-upload-foreign-404')+' '+r.raw.slice(0,200));
   assert.deepEqual((await fsp.readdir(uploads)).sort(),before,L('L2-upload-foreign-nothing-on-disk'));assert.equal(JSON.stringify(await col('transactions').findOne({_id:R.txB1._id})),txB1Before,L('L2-upload-foreign-unlinked'));
   r=await api('/api/attachments/upload',tok('ownerA'),'POST',form('missing.pdf',Buffer.from('X'),{entityType:'transaction',entityId:String(new ObjectId())},'application/pdf'));assert.equal(r.status,404,L('L2-upload-unknown-404'));assert.deepEqual((await fsp.readdir(uploads)).sort(),before,L('L2-upload-unknown-nothing-on-disk'));
   r=await api('/api/attachments/upload',tok('ownerA'),'POST',form('own.pdf',Buffer.from('OWN'),{entityType:'transaction',entityId:id('txA2')},'application/pdf'));assert.equal(r.status,200,L('L2-upload-own-200')+' '+r.raw.slice(0,300));
   const uploaded=r.data.files[0].filename;assert.match(uploaded,new RegExp('^'+A+'-\\d+-[a-z0-9]+\\.pdf$'),L('L2-upload-own-prefix')+' '+uploaded);assert.ok(fs.existsSync(path.join(uploads,uploaded)),L('L2-upload-own-written'));
   assert.equal((await col('transactions').findOne({_id:R.txA2._id})).attachments[0]?.filename,uploaded,L('L2-upload-own-linked'));
   r=await api('/api/attachments/'+uploaded,tok('ownerA'));assert.equal(r.status,200,L('L2-upload-own-readable'));assert.equal(r.raw,'OWN');
   r=await api('/api/attachments/upload',tok('ownerA'),'POST',form('x.a/b',Buffer.from('E'),{entityType:'transaction',entityId:id('txA2')}));assert.equal(r.status,200,L('L2-upload-ext-200')+' '+r.raw.slice(0,300));assert.match(r.data.files[0].filename,/\.bin$/,L('L2-upload-ext-bin')+' '+r.data.files[0].filename);
   r=await api('/api/attachments/upload',LONER,'POST',form('own.pdf',Buffer.from('OWN')));assert.equal(r.status,403,L('L2-upload-no-company-403'));
   pass('L2 own attachment served, B\'s name and a planted reference 404, grammar 400 on handler-reaching names, router negatives rejected or SPA-only with no file bytes and the sentinel intact, delete pulls only A\'s reference and keeps B\'s, upload resolves the entity in the company before writing and names the file <A>-<ts>-<rand>.<ext>');
  });

  // ---- L3. Company filters and honest counts: validate, search, bulk, duplicates, pdf, shipments, notifications, tags, schedule, vendors, send-reminders (S4-S13).
  await leg('L3',async()=>{
   const bIds=[id('txB2'),id('txB3')],bBefore=await snapshot(['transactions'],{organizationId:B});
   let r=await api('/api/validate/transactions',tok('ownerA'));assert.equal(r.status,200,L('L3-validate-200')+' '+r.raw.slice(0,200));assert.equal(r.data.summary.transactionsChecked,await col('transactions').countDocuments({organizationId:A}),L('L3-validate-scope'));assert.ok(!r.data.issues.some(i=>bIds.includes(i.id)),L('L3-validate-no-foreign-issue'));
   for(const[type,label]of[['transactions','transactions'],['receipts','receipts'],['recurring','recurring']]){r=await api('/api/search?q=Beta&type='+type,tok('ownerA'));assert.equal(r.status,200,L('L3-search-200'));assert.equal(r.data.total,0,L('L3-search-'+label+'-scope')+' '+r.raw.slice(0,300));r=await api('/api/search?q=Alpha&type='+type,tok('ownerA'));assert.ok(r.data.total>=1,L('L3-search-'+label+'-own')+' '+r.raw.slice(0,300))}
   for(const[action,data]of[['delete',undefined],['update_status',{status:'cancelled'}],['add_tag',{tag:'bulk'}],['remove_tag',{tag:'beta-tag'}],['update_source',{source:'bulk'}],['add_note',{note:'bulk note'}]]){r=await api('/api/transactions/bulk',tok('ownerA'),'POST',{action,ids:bIds,data});assert.equal(r.status,200,L('L3-bulk-'+action+'-200')+' '+r.raw.slice(0,300));assert.equal(r.data.succeeded,0,L('L3-bulk-'+action+'-succeeded')+' '+r.raw.slice(0,300));assert.equal(r.data.failed,2,L('L3-bulk-'+action+'-failed')+' '+r.raw.slice(0,300))}
   r=await api('/api/transactions/bulk',tok('ownerA'),'POST',{action:'export',ids:bIds});assert.equal(r.status,200);assert.equal(r.data.count,0,L('L3-bulk-export-scope')+' '+r.raw.slice(0,300));assert.deepEqual(r.data.transactions,[],L('L3-bulk-export-scope'));assert.equal(r.data.action,'export');
   assert.equal(await snapshot(['transactions'],{organizationId:B}),bBefore,L('L3-bulk-foreign-unchanged'));
   r=await api('/api/transactions/bulk',tok('ownerA'),'POST',{action:'add_note',ids:[id('txA3'),id('txB2')],data:{note:'mixed note'}});assert.equal(r.data.succeeded,1,L('L3-bulk-add_note-mixed-succeeded')+' '+r.raw.slice(0,300));assert.equal(r.data.failed,1,L('L3-bulk-add_note-mixed-failed')+' '+r.raw.slice(0,300));assert.equal((await col('transactions').findOne({_id:R.txA3._id})).notes,'mixed note',L('L3-bulk-add_note-own-written'));
   r=await api('/api/transactions/bulk',tok('ownerA'),'POST',{action:'export',ids:[id('txA3'),id('txB2')]});assert.deepEqual(r.data.transactions.map(t=>t._id),[id('txA3')],L('L3-bulk-export-own'));
   // Duplicates: listing, merge with an owned keeper over own and foreign candidates, delete and ignore counts.
   r=await api('/api/transactions/duplicates?threshold=80',tok('ownerA'));assert.equal(r.status,200,L('L3-duplicates-200')+' '+r.raw.slice(0,300));const listed=r.data.groups.flatMap(g=>g.transactions.map(t=>String(t.id)));assert.ok(listed.includes(id('keeper'))&&listed.includes(id('dupA')),L('L3-duplicates-own-group')+' '+JSON.stringify(listed));assert.ok(!listed.includes(id('dupB')),L('L3-duplicates-scope')+' '+JSON.stringify(listed));
   r=await api('/api/transactions/duplicates',tok('ownerA'),'POST',{action:'merge',keepId:id('dupB'),deleteIds:[id('dupA')]});assert.equal(r.status,404,L('L3-merge-foreign-keeper-404')+' '+r.raw.slice(0,200));assert.ok(await col('transactions').findOne({_id:R.dupA._id}),L('L3-merge-foreign-keeper-nothing-deleted'));
   const dupBBefore=JSON.stringify(await col('transactions').findOne({_id:R.dupB._id}));
   r=await api('/api/transactions/duplicates',tok('ownerA'),'POST',{action:'merge',keepId:id('keeper'),deleteIds:[id('dupA'),id('dupB')]});assert.equal(r.status,200,L('L3-merge-200')+' '+r.raw.slice(0,300));
   const kept=await col('transactions').findOne({_id:R.keeper._id});assert.deepEqual([...kept.tags].sort(),['d','k'],L('L3-merge-metadata')+' '+JSON.stringify(kept.tags));assert.ok(kept.notes.includes('[Merged] dup note')&&!kept.notes.includes('beta dup'),L('L3-merge-notes')+' '+kept.notes);assert.deepEqual(kept.attachments.map(a=>a.filename),[fileA2],L('L3-merge-attachments'));
   assert.equal(await col('transactions').findOne({_id:R.dupA._id}),null,L('L3-merge-own-duplicate-deleted'));assert.equal(JSON.stringify(await col('transactions').findOne({_id:R.dupB._id})),dupBBefore,L('L3-merge-foreign-intact'));
   assert.match(String(r.data.message),/^Merged 1 duplicates into transaction /,L('L3-merge-message')+' '+r.data.message);assert.equal(r.data.deleted,1,L('L3-merge-deleted')+' '+r.raw.slice(0,300));
   r=await api('/api/transactions/duplicates',tok('ownerA'),'POST',{action:'delete',deleteIds:[id('dupB'),id('txB3')]});assert.equal(r.status,200,L('L3-dup-delete-200'));assert.equal(r.data.deleted,0,L('L3-dup-delete-count')+' '+r.raw.slice(0,300));assert.equal(r.data.message,'Deleted 0 duplicate transactions',L('L3-dup-delete-message')+' '+r.raw.slice(0,300));assert.equal(await col('transactions').countDocuments({_id:{$in:[R.dupB._id,R.txB3._id]}}),2,L('L3-dup-delete-foreign-intact'));
   r=await api('/api/transactions/duplicates',tok('ownerA'),'POST',{action:'ignore',transactionIds:[id('dupB'),id('txB3')]});assert.equal(r.status,200,L('L3-dup-ignore-200')+' '+r.raw.slice(0,300));assert.equal(r.data.updated,0,L('L3-dup-ignore-count')+' '+r.raw.slice(0,300));assert.equal((await col('transactions').findOne({_id:R.dupB._id})).metadata?.ignoredDuplicates,undefined,L('L3-dup-ignore-foreign-intact'));
   r=await api('/api/transactions/duplicates',tok('ownerA'),'POST',{action:'ignore',transactionIds:[id('keeper'),id('txA3')]});assert.equal(r.data.updated,2,L('L3-dup-ignore-own-count')+' '+r.raw.slice(0,300));
   // Receipt PDF (a transaction read).
   r=await api('/api/receipts/'+id('txB1')+'/pdf',tok('ownerA'));assert.equal(r.status,404,L('L3-pdf-scope')+' '+r.raw.slice(0,200));r=await api('/api/receipts/'+id('txA3')+'/pdf',tok('ownerA'));assert.equal(r.status,200,L('L3-pdf-own'));assert.ok(r.raw.includes('<html'),L('L3-pdf-html'));r=await api('/api/receipts/not-an-id/pdf',tok('ownerA'));assert.equal(r.status,400,L('L3-pdf-invalid-id'));
   // Shipments: pre-save ownership check, company stored, populate match, stats.
   const txB1Before=JSON.stringify(await col('transactions').findOne({_id:R.txB1._id}));
   r=await api('/api/shipments',tok('ownerA'),'POST',{trackingNumber:'FOREIGN-1',carrier:'yamato',transactionId:id('txB1')});assert.equal(r.status,400,L('L3-shipment-foreign-400')+' '+r.raw.slice(0,300));assert.equal(JSON.stringify(await col('transactions').findOne({_id:R.txB1._id})),txB1Before,L('L3-shipment-foreign-timeline'));assert.equal(await col('shipments').countDocuments({trackingNumber:'FOREIGN-1'}),0,L('L3-shipment-foreign-not-saved'));
   r=await api('/api/shipments',tok('ownerA'),'POST',{trackingNumber:'MIXED-1',carrier:'yamato',transactionIds:[id('txA3'),id('txB1')]});assert.equal(r.status,400,L('L3-shipment-mixed-400'));assert.equal(await col('shipments').countDocuments({trackingNumber:'MIXED-1'}),0,L('L3-shipment-mixed-not-saved'));
   r=await api('/api/shipments',tok('ownerA'),'POST',{trackingNumber:'OWN-1',carrier:'yamato',transactionId:id('txA3')});assert.equal(r.status,200,L('L3-shipment-own-200')+' '+r.raw.slice(0,300));const saved=await col('shipments').findOne({trackingNumber:'OWN-1'});assert.equal(String(saved?.organizationId),String(A),L('L3-shipment-own-company'));assert.equal((await col('transactions').findOne({_id:R.txA3._id})).timeline[0]?.type,'shipment_created',L('L3-shipment-own-timeline'));
   r=await api('/api/shipments',tok('ownerA'));assert.equal(r.status,200,L('L3-shipments-list-200')+' '+r.raw.slice(0,300));const shipIds=r.data.shipments.map(s=>String(s._id));assert.ok(shipIds.includes(String(shipA))&&shipIds.includes(String(shipCross))&&shipIds.includes(String(saved._id)),L('L3-shipments-list-own')+' '+JSON.stringify(shipIds));assert.ok(!shipIds.includes(String(shipB)),L('L3-shipments-list-scope')+' '+JSON.stringify(shipIds));
   const cross=r.data.shipments.find(s=>String(s._id)===String(shipCross));assert.ok(!JSON.stringify(cross.transactionIds).includes('BETA-B1')&&!cross.transactionIds.some(t=>t&&String(t._id||t)===id('txB1')),L('L3-shipments-populate-scope')+' '+JSON.stringify(cross.transactionIds));
   const ownShip=r.data.shipments.find(s=>String(s._id)===String(shipA));assert.equal(ownShip.transactionIds[0]?.referenceNumber,'ALPHA-A1',L('L3-shipments-populate-own'));
   r=await api('/api/shipments?stats=true',tok('ownerA'));assert.equal(r.data.stats.total,await col('shipments').countDocuments({organizationId:A}),L('L3-shipment-stats-scope')+' '+r.raw.slice(0,300));assert.equal(r.data.stats.shipped,0,L('L3-shipment-stats-status-scope'));
   // Notifications, tags.
   r=await api('/api/notifications',tok('ownerA'));assert.equal(r.status,200,L('L3-notifications-200')+' '+r.raw.slice(0,300));const nids=r.data.notifications.map(n=>n.id);
   assert.ok(nids.includes('payment-'+RP.aUp._id)&&!nids.includes('payment-'+RP.bUp._id),L('L3-notifications-upcoming-scope')+' '+JSON.stringify(nids));assert.ok(nids.includes('overdue-'+RP.aOver._id)&&!nids.includes('overdue-'+RP.bOver._id),L('L3-notifications-overdue-scope')+' '+JSON.stringify(nids));
   assert.equal(r.data.notifications.find(n=>n.id==='unmatched-receipts')?.count,1,L('L3-notifications-receipts-scope')+' '+r.raw.slice(0,300));
   r=await api('/api/tags',tok('ownerA'));assert.equal(r.status,200,L('L3-tags-200'));const tags=r.data.tags.map(t=>t.tag);assert.ok(tags.includes('alpha-tag')&&!tags.includes('beta-tag'),L('L3-tags-scope')+' '+JSON.stringify(tags));
   // Scheduled backups: per-company name, scoped content, list and cleanup by prefix.
   for(let i=1;i<=8;i++)await fsp.writeFile(path.join(backups,'backup-'+A+'-2025-01-0'+i+'T00-00-00-000Z.json'),'{}');await fsp.writeFile(path.join(backups,'backup-'+B+'-2025-01-09T00-00-00-000Z.json'),'{}');await fsp.writeFile(path.join(backups,'backup-2025-01-10T00-00-00-000Z.json'),'{}');
   r=await api('/api/backup/schedule',tok('ownerA'),'POST',{action:'create'});assert.equal(r.status,200,L('L3-backup-200')+' '+r.raw.slice(0,300));assert.ok(String(r.data.filename).startsWith('backup-'+A+'-'),L('L3-backup-name')+' '+r.data.filename);
   const written=JSON.parse(await fsp.readFile(path.join(backups,r.data.filename),'utf8'));assert.equal(written.stats.transactions,await col('transactions').countDocuments({organizationId:A}),L('L3-backup-scope')+' '+JSON.stringify(written.stats));assert.equal(written.stats.vendors,1,L('L3-backup-scope-vendors'));assert.ok(!JSON.stringify(written).includes('BETA-'),L('L3-backup-no-foreign-content'));
   for(const [k,c] of [['transactions','transactions'],['receipts','receipts'],['recurringPayments','recurringpayments'],['invoices','invoices'],['budgets','budgets'],['vendors','vendors']]){const rows=written.data?.[k]||[];assert.ok(rows.every(x=>String(x.organizationId)===String(A)),L('L3-backup-scope-'+k)+' '+rows.length);assert.equal(rows.length,await col(c).countDocuments({organizationId:A}),L('L3-backup-count-'+k)+' '+rows.length)}
   const names=await fsp.readdir(backups);assert.equal(names.filter(n=>n.startsWith('backup-'+A+'-')).length,7,L('L3-backup-cleanup-max')+' '+JSON.stringify(names));assert.ok(names.includes('backup-'+B+'-2025-01-09T00-00-00-000Z.json')&&names.includes('backup-2025-01-10T00-00-00-000Z.json'),L('L3-backup-cleanup-scope')+' '+JSON.stringify(names));
   r=await api('/api/backup/schedule',tok('ownerA'));assert.equal(r.status,200);assert.ok(r.data.backups.length===7&&r.data.backups.every(b=>b.filename.startsWith('backup-'+A+'-')),L('L3-backup-list-scope')+' '+r.raw.slice(0,400));assert.ok(r.data.backups.every(b=>typeof b.createdAt==='string'&&b.createdAt),L('L3-backup-createdAt')+' '+r.raw.slice(0,300));
   // Vendors: scoped reads and writes, whitelisted PUT.
   r=await api('/api/vendors/'+vendorA,tok('ownerA'));assert.equal(r.status,200,L('L3-vendor-own')+' '+r.raw.slice(0,300));assert.deepEqual(r.data.transactions.map(t=>String(t.id)),[id('txA1')],L('L3-vendor-history-scope')+' '+r.raw.slice(0,300));
   r=await api('/api/vendors/'+vendorB,tok('ownerA'));assert.equal(r.status,404,L('L3-vendor-scope'));
   r=await api('/api/vendors/'+vendorA,tok('ownerA'),'PUT',{organizationId:String(B),$set:{name:'x'},name:'Alpha Vendor Renamed',totalSpent:999,notes:'ok'});assert.equal(r.status,200,L('L3-vendor-put-200')+' '+r.raw.slice(0,300));const v=await col('vendors').findOne({_id:vendorA});assert.equal(v.name,'Alpha Vendor Renamed',L('L3-vendor-put-name'));assert.equal(v.notes,'ok');assert.equal(String(v.organizationId),String(A),L('L3-vendor-whitelist-company'));assert.equal(v.totalSpent,0,L('L3-vendor-whitelist')+' '+JSON.stringify(v));
   r=await api('/api/vendors/'+vendorB,tok('ownerA'),'PUT',{name:'Beta renamed'});assert.equal(r.status,404,L('L3-vendor-put-scope'));assert.equal((await col('vendors').findOne({_id:vendorB})).name,'Beta Vendor',L('L3-vendor-put-foreign-intact'));
   r=await api('/api/vendors/'+vendorB,tok('ownerA'),'DELETE');assert.equal(r.status,404,L('L3-vendor-delete-scope'));assert.ok(await col('vendors').findOne({_id:vendorB}),L('L3-vendor-delete-foreign-intact'));
   // Reminders: the company's legacy isActive row only (console provider, nothing sent).
   r=await api('/api/email/send-reminders',tok('ownerA'),'POST',{});assert.equal(r.status,200,L('L3-reminders-200')+' '+r.raw.slice(0,300));assert.deepEqual(r.data.results.map(x=>x.payment),['Alpha Legacy'],L('L3-reminders-scope')+' '+r.raw.slice(0,300));
   // No company -> 403 everywhere; every current role reads.
   for(const route of['/api/validate/transactions','/api/search?q=Alpha','/api/transactions/duplicates','/api/receipts/'+id('txA3')+'/pdf','/api/shipments','/api/notifications','/api/tags','/api/backup/schedule','/api/vendors/'+vendorA]){r=await api(route,LONER);assert.equal(r.status,403,L('L3-no-company-403')+' '+route+' '+r.status);for(const role of['adminA','accA','memberA','viewerA']){r=await api(route,tok(role));assert.equal(r.status,200,L('L3-legitimate-role')+' '+role+' '+route+' '+r.raw.slice(0,200))}}
   for(const[route,body]of[['/api/transactions/bulk',{action:'export',ids:bIds}],['/api/email/send-reminders',{}]]){r=await api(route,LONER,'POST',body);assert.equal(r.status,403,L('L3-no-company-403')+' '+route)}
   pass('L3 validate/search/bulk/duplicates/pdf/shipments/notifications/tags/schedule/vendors/send-reminders show only the company\'s rows with counts and messages from the real result; a merge keeps A\'s metadata and B\'s row; a shipment linking B\'s transaction is refused before save; a seeded cross-linked shipment populates no foreign content');
  });

  // ---- L4. Webhooks: admin-only, company-scoped, masked, DNS-bound delivery that never reaches loopback or private addresses (S14).
  await leg('L4',async()=>{
   let r=await api('/api/webhooks',tok('ownerA'));assert.equal(r.status,200,L('L4-list-200')+' '+r.raw.slice(0,300));assert.deepEqual(r.data.webhooks.map(w=>String(w.id)),[String(hookA)],L('L4-list-scope')+' '+r.raw.slice(0,300));
   assert.equal(r.data.webhooks[0].secret,'••••••••',L('L4-list-masked')+' '+r.raw.slice(0,300));assert.equal('headers' in r.data.webhooks[0],false,L('L4-list-no-headers')+' '+r.raw.slice(0,300));assert.ok(!r.raw.includes('alpha-secret-value')&&!r.raw.includes('beta-secret-value'),L('L4-list-no-secret-bytes'));
   r=await api('/api/webhooks',tok('adminA'));assert.equal(r.status,200,L('L4-admin-reads'));
   for(const role of['accA','memberA','viewerA']){r=await api('/api/webhooks',tok(role));assert.equal(r.status,403,L('L4-admin-only-'+role)+' '+r.raw.slice(0,300));assert.equal(errorMessage(r),ADMIN_MESSAGE,L('L4-admin-message-'+role)+' '+r.raw.slice(0,300));r=await api('/api/webhooks/'+hookA,tok(role));assert.equal(r.status,403,L('L4-detail-admin-only')+' '+role)}
   r=await api('/api/webhooks',LONER);assert.equal(r.status,403,L('L4-no-company-403'));r=await api('/api/webhooks/'+hookA,LONER);assert.equal(r.status,403,L('L4-detail-no-company-403'));
   const bBefore=JSON.stringify(await col('webhooks').findOne({_id:hookB})),hitsBefore=hits.length;
   r=await api('/api/webhooks/'+hookB,tok('ownerA'));assert.equal(r.status,404,L('L4-foreign-get-404')+' '+r.raw.slice(0,200));r=await api('/api/webhooks/'+hookB,tok('ownerA'),'PUT',{name:'taken'});assert.equal(r.status,404,L('L4-foreign-put-404'));r=await api('/api/webhooks/'+hookB,tok('ownerA'),'DELETE');assert.equal(r.status,404,L('L4-foreign-delete-404'));
   r=await api('/api/webhooks/'+hookB+'?test=true',tok('ownerA'),'POST',{});assert.equal(r.status,200,L('L4-foreign-test-shape')+' '+r.raw.slice(0,200));assert.deepEqual(r.data,{success:false,error:'Webhook not found'},L('L4-foreign-test-shape')+' '+r.raw.slice(0,200));assert.equal(hits.length,hitsBefore,L('L4-foreign-test-no-delivery'));
   assert.equal(JSON.stringify(await col('webhooks').findOne({_id:hookB})),bBefore,L('L4-foreign-intact'));
   r=await api('/api/webhooks/'+hookA,tok('ownerA'));assert.equal(r.status,200,L('L4-own-get'));assert.equal(r.data.webhook.secret,'••••••••',L('L4-get-masked'));assert.equal('headers' in r.data.webhook,false,L('L4-get-no-headers'));
   r=await api('/api/webhooks/'+hookA,tok('ownerA'),'PUT',{name:'Alpha renamed',organizationId:String(B),secret:'alpha-secret-renamed',failCount:99,_id:String(hookB)});assert.equal(r.status,200,L('L4-put-200')+' '+r.raw.slice(0,300));
   assert.equal(r.data.webhook.name,'Alpha renamed',L('L4-put-name'));assert.equal(r.data.webhook.secret,'••••••••',L('L4-put-masked')+' '+r.raw.slice(0,300));assert.equal('headers' in r.data.webhook,false,L('L4-put-no-headers'));assert.ok(!r.raw.includes('alpha-secret'),L('L4-put-no-secret-bytes'));
   const stored=await col('webhooks').findOne({_id:hookA});assert.equal(String(stored.organizationId),String(A),L('L4-put-whitelist-company'));assert.equal(stored.failCount,0,L('L4-put-whitelist')+' '+JSON.stringify(stored));assert.equal(stored.secret,'alpha-secret-renamed',L('L4-put-secret-stored'));
   // Delivery refusals: the owned loopback listener and every private destination receive nothing; the row records lastStatus 0.
   for(const url of[listenerUrl+'/hook','http://127.0.0.1:'+listenerPort+'/hook','http://10.0.0.1/hook','http://[::1]:'+listenerPort+'/hook','http://localhost:'+listenerPort+'/hook','http://user:pw@127.0.0.1:'+listenerPort+'/hook','http://169.254.169.254/latest','http://100.64.0.1/hook','ftp://127.0.0.1/hook']){
    r=await api('/api/webhooks/'+hookA,tok('ownerA'),'PUT',{url});assert.equal(r.status,200,L('L4-put-url')+' '+url+' '+r.raw.slice(0,300));const before=hits.length;
    r=await api('/api/webhooks/'+hookA+'?test=true',tok('ownerA'),'POST',{});assert.equal(r.status,200,L('L4-test-200')+' '+url+' '+r.raw.slice(0,300));assert.equal(r.data.success,false,L('L4-refused-destination')+' '+url+' '+r.raw.slice(0,300));assert.equal(hits.length,before,L('L4-refused-listener-nothing')+' '+url);
    const row=await col('webhooks').findOne({_id:hookA});assert.equal(row.lastStatus,0,L('L4-refused-last-status')+' '+url+' '+JSON.stringify(row.lastStatus))}
   r=await api('/api/webhooks/'+hookA+'?test=true',tok('memberA'),'POST',{});assert.equal(r.status,403,L('L4-test-admin-only'));
   r=await api('/api/webhooks',tok('ownerA'),'POST',{name:'New',url:listenerUrl});assert.notEqual(r.status,200,L('L4-post-unchanged-refuses'));assert.equal(await col('webhooks').countDocuments(),2,L('L4-post-nothing-created'));
   pass('L4 webhooks are admin-only and company-scoped (GET/PUT/DELETE of B\'s row 404, its test keeps the existing {success:false,error} shape with zero delivery), every response masks the secret and omits headers, PUT cannot move the company, and loopback/private/credentialed destinations are refused with nothing reaching the listener');
  });

  // ---- L4b. Transport check under tsx on the source tree beside this script: decision table, pinned delivery, no redirect, deliverTo persistence.
  await leg('L4b',async()=>{
   const r=await new Promise(resolve=>execFile(process.execPath,[tsxCli(),path.join(root,'scripts','finance-webhook-transport-check.ts')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,OMF_SECURITY_FIXTURE:'owned'},timeout:300000,maxBuffer:8*1024*1024},(e,stdout,stderr)=>resolve({code:e?(Number.isInteger(e.code)?e.code:1):0,text:String(stdout)+'\n'+String(stderr)})));
   assert.equal(r.code,0,L('L4b-transport')+' exit '+r.code+' '+r.text.slice(-3000));assert.match(r.text,/\d+ webhook transport groups passed/,L('L4b-transport-complete')+' '+r.text.slice(-1500));
   pass('L4b deliverableUrl decides from the resolved addresses (injected lookup), deliver pins the socket to the checked address with the URL\'s Host and never follows a redirect, deliverTo persists lastStatus/failCount on a seeded row');
  });

  // ---- L5. Shared masters: every in-app write refused for every role and a company-less account; reads stay open (S15).
  await leg('L5',async()=>{
   const before=await snapshot(MASTERS);
   const refused=(label,r,who)=>{assert.equal(r.status,403,L(label)+' '+who+' answered '+r.status+' '+r.raw.slice(0,300));const code=r.data?.data?.code;if(who==='viewerA')assert.ok(['SHARED_MASTER_READ_ONLY','VIEWER_READ_ONLY'].includes(code),L(label)+' viewer code '+r.raw.slice(0,300));else{assert.equal(code,'SHARED_MASTER_READ_ONLY',L(label)+' '+who+' code '+r.raw.slice(0,300));assert.equal(r.data?.data?.message,SHARED_MESSAGE,L(label)+' '+who+' message '+r.raw.slice(0,300))}};
   const tokens={ownerA:tok('ownerA'),adminA:tok('adminA'),accA:tok('accA'),memberA:tok('memberA'),viewerA:tok('viewerA'),loner:LONER};
   for(const[who,t]of Object.entries(tokens)){
    refused('L5-account-categories-post',await api('/api/account-categories',t,'POST',{name:'New shared account',type:'expense',code:'999'}),who);
    refused('L5-account-categories-put',await api('/api/account-categories/'+acctSub,t,'PUT',{name:'Renamed shared',code:'602'}),who);refused('L5-account-categories-delete',await api('/api/account-categories/'+acctSub,t,'DELETE'),who);
    refused('L5-categories-post',await api('/api/categories',t,'POST',{name:'New category'}),who);refused('L5-categories-put',await api('/api/categories/'+catId,t,'PUT',{name:'Renamed'}),who);refused('L5-categories-patch',await api('/api/categories/'+catId,t,'PATCH',{name:'Renamed'}),who);refused('L5-categories-delete',await api('/api/categories/'+catId,t,'DELETE'),who);
    refused('L5-tax-categories-post',await api('/api/tax-categories',t,'POST',{name:'New tax',rate:5}),who);refused('L5-transaction-categories-post',await api('/api/transaction-categories',t,'POST',{name:'New 区分'}),who);
    refused('L5-templates-post',await api('/api/templates',t,'POST',{name:'New template',mappings:{a:{field:'amount'}}}),who);refused('L5-templates-put',await api('/api/templates/'+tplId,t,'PUT',{isDefault:true}),who);refused('L5-templates-patch',await api('/api/templates/'+tplId,t,'PATCH',{isDefault:true}),who);refused('L5-templates-delete',await api('/api/templates/'+tplId,t,'DELETE'),who);
    refused('L5-seed',await api('/api/seed',t,'GET'),who);
    for(const route of['/api/account-categories','/api/account-categories/'+acctSub,'/api/categories','/api/categories/'+catId,'/api/tax-categories','/api/transaction-categories','/api/templates','/api/templates/'+tplId]){const r=await api(route,t);assert.equal(r.status,200,L('L5-reads')+' '+who+' '+route+' '+r.raw.slice(0,200))}
   }
   for(const route of['/api/account-categories','/api/categories','/api/tax-categories','/api/transaction-categories','/api/templates','/api/seed']){const r=await api(route,null,'POST',{name:'anon'});assert.equal(r.status,401,L('L5-anonymous-401')+' '+route)}
   assert.equal(await snapshot(MASTERS),before,L('L5-nothing-written'));
   pass('L5 every shared-master write (account categories incl. POST, categories, tax and transaction categories, templates, GET /api/seed) answers 403 SHARED_MASTER_READ_ONLY for owner/admin/accountant/member and a company-less account (viewer: shared or viewer code), nothing is written, every role still reads');
  });

  // ---- L5b/L5c share one owned statement import (ownerA, company A) so the finance-import continuations run on real rows.
  let importId=null,mappingView=null;
  const ensureImport=async()=>{
   if(importId)return;const {HEADERS}=await import(require('node:url').pathToFileURL(path.join(root,'shared','amex.mjs')).href);
   const account=(await ok('/api/finance/accounts',tok('ownerA'),'POST',{name:'Synthetic security Amex',provider:'amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'synthetic@example.invalid',otpMailbox:'synthetic@example.invalid'},'amex-account')).account;
   const csv=Buffer.from([HEADERS,...[['02','Security shop two',1102],['03','Security shop three',1103]].map(([d,name,amount])=>['2026/08/'+d,'2026/08/'+d,name,'Synthetic user','12345',String(amount),'',''])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
   const statement=await ok('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',tok('ownerA'),'POST',csv,'amex-import');importId=String(statement.id);
   const batch=await col('financeimports').findOne({_id:new ObjectId(importId)});assert.ok(batch,'SETUP statement stored');
   await col('financeimports').updateOne({_id:batch._id},{$set:{mappingPreview:{version:1,sourceHash:batch.hash,preparedAt:new Date(),rows:batch.rows.map((r,i)=>({line:r.line,key:r.key,purpose:'company',clientCode:'',clientName:'',category:i===0?'Synthetic missing 区分':'Synthetic 区分',reason:''}))}}});
   const view=await api('/api/finance/imports/'+importId+'/mapping',tok('ownerA'));assert.equal(view.status,200,'SETUP mapping view '+view.raw.slice(0,400));mappingView=view.data;
  };
  await leg('L5b',async()=>{
   await ensureImport();const refs='/api/finance/imports/'+importId+'/references',before=await snapshot(MASTERS);
   const refused=(label,r)=>{assert.equal(r.status,403,L(label)+' answered '+r.status+' '+r.raw.slice(0,300));assert.equal(r.data?.data?.code,'SHARED_MASTER_READ_ONLY',L(label)+' code '+r.raw.slice(0,300))};
   refused('L5b-reference-tax-403',await api(refs,tok('ownerA'),'POST',{field:'taxCategoryId',name:'Synthetic new tax',rate:8}));
   refused('L5b-reference-account-403',await api(refs,tok('ownerA'),'POST',{field:'accountCategoryId',name:'Synthetic new account'}));
   refused('L5b-reference-subaccount-403',await api(refs,tok('ownerA'),'POST',{field:'subAccountCategoryId',name:'Synthetic new sub',parentId:String(acctTop)}));
   refused('L5b-reference-transaction-category-403',await api(refs,tok('ownerA'),'POST',{field:'transactionCategoryId',name:'Synthetic new 区分'}));
   assert.equal(await snapshot(MASTERS),before,L('L5b-reference-nothing-written'));
   let r=await api(refs,tok('ownerA'),'POST',{field:'taxCategoryId',name:'Synthetic 課税仕入 10%',rate:10});assert.equal(r.status,200,L('L5b-reference-existing')+' '+r.raw.slice(0,300));assert.equal(r.data.id,String(taxId),L('L5b-reference-existing-id'));
   r=await api(refs,tok('ownerA'),'POST',{field:'accountCategoryId',name:'Synthetic 経費'});assert.equal(r.status,200,L('L5b-reference-existing-account'));assert.equal(r.data.id,String(acctTop),L('L5b-reference-existing-account-id'));
   r=await api(refs,tok('ownerA'),'POST',{field:'customerId',name:'Synthetic new customer'});assert.equal(r.status,200,L('L5b-customer-200')+' '+r.raw.slice(0,300));assert.equal(String((await col('customers').findOne({_id:new ObjectId(r.data.id)})).organizationId),String(A),L('L5b-customer-company'));
   r=await api(refs,tok('ownerA'),'POST',{field:'supplierId',name:'Synthetic new supplier'});assert.equal(r.status,200,L('L5b-supplier-200')+' '+r.raw.slice(0,300));assert.equal(String((await col('suppliers').findOne({_id:new ObjectId(r.data.id)})).organizationId),String(A),L('L5b-supplier-company'));
   const choices=mappingView.sourceCategories||[];assert.ok(choices.some(c=>c.name==='Synthetic missing 区分'&&c.matches===0)&&choices.some(c=>c.name==='Synthetic 区分'&&c.matches===1),'SETUP source categories '+JSON.stringify(choices));
   const src='/api/finance/imports/'+importId+'/source-categories',tcBefore=await snapshot(['transactioncategories']);
   r=await api(src,tok('ownerA'),'POST',{sourceHash:mappingView.sourceHash,mappingKey:mappingView.mappingKey,names:['Synthetic missing 区分']});assert.equal(r.status,403,L('L5b-source-missing-403')+' '+r.raw.slice(0,300));assert.equal(r.data?.data?.code,'SHARED_MASTER_READ_ONLY',L('L5b-source-missing-code'));assert.equal(await snapshot(['transactioncategories']),tcBefore,L('L5b-source-nothing-written'));
   r=await api(src,tok('ownerA'),'POST',{sourceHash:mappingView.sourceHash,mappingKey:mappingView.mappingKey,names:['Synthetic 区分']});assert.equal(r.status,200,L('L5b-source-existing-200')+' '+r.raw.slice(0,300));assert.deepEqual(r.data.categories.map(c=>[c.id,c.created]),[[String(tcatId),false]],L('L5b-source-existing-resolves'));
   pass('L5b finance import: a new shared account/sub-account/transaction/tax category via /references and a missing source category via /source-categories answer 403 with nothing written; existing names resolve; customer and supplier creates stay company-local');
  });

  // ---- L5c. The operator CLI on the source tree beside this script, against the owned database: dry run by default, whitelist only, registrations preserved, seed idempotent.
  await leg('L5c',async()=>{
   const cli=(...args)=>new Promise(resolve=>execFile(process.execPath,[tsxCli(),path.join(root,'scripts','manage-masters.ts'),...args],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri},timeout:300000,maxBuffer:8*1024*1024},(e,stdout,stderr)=>resolve({code:e?(Number.isInteger(e.code)?e.code:1):0,out:String(stdout),err:String(stderr)})));
   const noRegistration=(label,r)=>assert.ok(!/companyRegistrations|registeredBy|registeredAt/.test(r.out+r.err)&&!(r.out+r.err).includes(String(A)),L(label)+' '+(r.out+r.err).slice(0,600));
   let r=await cli('account-category','list');assert.equal(r.code,0,L('L5c-list')+' '+r.out.slice(0,600)+r.err.slice(0,600));assert.ok(r.out.includes('Synthetic 通信費')&&r.out.includes(String(acctSub)),L('L5c-list-rows')+' '+r.out.slice(0,600));noRegistration('L5c-list-no-registration',r);
   const before=await snapshot(MASTERS);
   r=await cli('tax-category','create','--json',JSON.stringify({name:'CLI tax',rate:5}));assert.equal(r.code,0,L('L5c-dry-create-exit')+' '+r.err.slice(0,400));assert.equal(await snapshot(MASTERS),before,L('L5c-dry-create'));
   r=await cli('account-category','set',String(acctSub),'--json',JSON.stringify({name:'Dry renamed'}));assert.equal(r.code,0,L('L5c-dry-set-exit')+' '+r.err.slice(0,400));assert.equal(await snapshot(MASTERS),before,L('L5c-dry-set'));
   r=await cli('category','delete',String(catId));assert.equal(r.code,0,L('L5c-dry-delete-exit')+' '+r.err.slice(0,400));assert.equal(await snapshot(MASTERS),before,L('L5c-dry-delete'));
   r=await cli('account-category','seed');assert.equal(r.code,0,L('L5c-dry-seed-exit')+' '+r.err.slice(0,400));assert.equal(await snapshot(MASTERS),before,L('L5c-dry-seed'));
   r=await cli('tax-category','create','--json',JSON.stringify({name:'CLI tax',rate:5,organizationId:String(B),$set:{rate:99}}),'--apply');assert.equal(r.code,0,L('L5c-create-exit')+' '+r.err.slice(0,400));const createdTax=await col('taxcategories').findOne({name:'CLI tax'});assert.ok(createdTax,L('L5c-create-written'));assert.equal(createdTax.rate,5,L('L5c-create-whitelist'));assert.equal(createdTax.organizationId,undefined,L('L5c-create-whitelist-company'));assert.equal(createdTax.$set,undefined,L('L5c-create-no-operator'));assert.ok(r.out.includes(String(createdTax._id)),L('L5c-create-prints-id')+' '+r.out.slice(0,300));
   const registered=JSON.stringify((await col('accountcategories').findOne({_id:acctSub})).companyRegistrations);
   r=await cli('account-category','set',String(acctSub),'--json',JSON.stringify({name:'CLI renamed sub',$set:{code:'999'},organizationId:String(B),companyRegistrations:[],metadata:{note:'cli'}}),'--apply');assert.equal(r.code,0,L('L5c-set-exit')+' '+r.err.slice(0,400));
   const sub=await col('accountcategories').findOne({_id:acctSub});assert.equal(sub.name,'CLI renamed sub',L('L5c-set-name'));assert.equal(sub.code,'602',L('L5c-set-whitelist')+' '+JSON.stringify({code:sub.code}));assert.equal(sub.organizationId,undefined,L('L5c-set-whitelist-company'));assert.deepEqual(sub.metadata,{note:'cli'},L('L5c-set-metadata'));assert.equal(JSON.stringify(sub.companyRegistrations),registered,L('L5c-set-keeps-registrations')+' '+JSON.stringify(sub.companyRegistrations));assert.equal(String(sub.parentId),String(acctTop),L('L5c-set-keeps-parent'));noRegistration('L5c-set-no-registration',r);
   r=await cli('tax-category','delete',String(createdTax._id),'--apply');assert.equal(r.code,0,L('L5c-delete-exit')+' '+r.err.slice(0,400));assert.equal(await col('taxcategories').findOne({_id:createdTax._id}),null,L('L5c-delete-written'));
   const seedCounts=async()=>({acc:await col('accountcategories').countDocuments(),tax:await col('taxcategories').countDocuments(),tc:await col('transactioncategories').countDocuments()});const c0=await seedCounts();
   r=await cli('account-category','seed','--apply');assert.equal(r.code,0,L('L5c-seed-exit')+' '+r.err.slice(0,400));const c1=await seedCounts();assert.ok(c1.acc>c0.acc&&c1.tax>c0.tax&&c1.tc>c0.tc,L('L5c-seed-writes')+' '+JSON.stringify([c0,c1]));
   const seeded=await snapshot(MASTERS);r=await cli('account-category','seed','--apply');assert.equal(r.code,0,L('L5c-seed-again-exit'));assert.equal(await snapshot(MASTERS),seeded,L('L5c-seed-idempotent'));assert.match(r.out,/created[^\d]*0/,L('L5c-seed-idempotent-report')+' '+r.out.slice(0,300));noRegistration('L5c-seed-no-registration',r);
   r=await cli('tax-category','list');assert.equal(r.code,0);noRegistration('L5c-output-no-registration',r);
   r=await new Promise(resolve=>execFile(process.execPath,[tsxCli(),path.join(root,'scripts','manage-masters.ts'),'tax-category','list'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:''},timeout:120000},(e,stdout,stderr)=>resolve({code:e?(Number.isInteger(e.code)?e.code:1):0,out:String(stdout),err:String(stderr)})));assert.notEqual(r.code,0,L('L5c-requires-mongo-uri'));
   pass('L5c scripts/manage-masters.ts lists; create/set/delete/seed without --apply write nothing; --apply changes whitelisted fields only ($set/organizationId/companyRegistrations in --json ignored), set keeps an existing companyRegistrations array, seed --apply is idempotent, output carries no registration, MONGO_URI is required');
  });

  // ---- L6. Session version: refusals after a password change, fresh issuance at every mint, persisted logout across a restart, compatibility, concurrency (S16, shared guard).
  await leg('L6',async()=>{
   // L6c compatibility first: tokens without sv for users without sessionVersion renew and switch.
   assert.equal((await col('users').findOne({_id:users.ownerB.id})).sessionVersion??null,passwordChanged.ownerB?1:null,'SETUP ownerB version');
   const compat=await switchTokens('adminA',A);assert.equal(claims(compat.accessToken).sv,0,L('L6c-compat-mint-sv')+' '+JSON.stringify(claims(compat.accessToken)));
   let r=await refresh(compat.refreshToken);assert.equal(r.status,200,L('L6c-compat-refresh')+' '+r.raw.slice(0,200));
   const legacyRefresh=jwt.sign((({sv,iat,exp,...c})=>c)(claims(compat.refreshToken)),secret,{expiresIn:'7d'});assert.equal(claims(legacyRefresh).sv,undefined,'SETUP legacy refresh has no sv');
   r=await refresh(legacyRefresh);assert.equal(r.status,200,L('L6c-legacy-refresh')+' '+r.raw.slice(0,200));r=await refresh(r.data.tokens.refreshToken);assert.equal(r.status,200,L('L6c-legacy-refresh-again')+' '+r.raw.slice(0,200));r=await api('/api/auth/switch-organization',users.adminA.plain,'POST',{organizationId:String(A)});assert.equal(r.status,200,L('L6c-compat-switch'));
   // A 2FA challenge issued before the change (ownerA) and B's owner's pre-change session (R1).
   const pendingBefore=(await ok('/api/auth/login',null,'POST',{email:users.ownerA.email,password:PASSWORD},'login-2fa-before')).tempToken;assert.ok(pendingBefore,'SETUP pending 2FA token');
   const R1=T.ownerB.refreshToken,oldAccess=tok('ownerB');
   const changed=await changePassword('ownerB');assert.ok(changed.tokens?.accessToken&&changed.tokens?.refreshToken,L('L6-change-returns-tokens')+' '+JSON.stringify(changed).slice(0,300));
   assert.equal(await svOf('ownerB'),1,L('L6-version-incremented'));assert.equal(claims(changed.tokens.accessToken).sv,1,L('L6-change-mint-sv')+' '+JSON.stringify(claims(changed.tokens.accessToken)));assert.equal(claims(changed.tokens.accessToken).organizationId,String(B),L('L6-change-keeps-company'));
   r=await refresh(changed.tokens.refreshToken);assert.equal(r.status,200,L('L6-fresh-refresh')+' '+r.raw.slice(0,200));assert.equal(claims(r.data.tokens.refreshToken).sv,1,L('L6-fresh-refresh-sv')+' '+JSON.stringify(claims(r.data.tokens.refreshToken)));
   r=await refresh(r.data.tokens.refreshToken);assert.equal(r.status,200,L('L6-fresh-refresh-again')+' '+r.raw.slice(0,200));
   r=await refresh(R1);assert.equal(r.status,401,L('L6-stale-refresh-401')+' '+r.raw.slice(0,200));
   r=await api('/api/auth/switch-organization',oldAccess,'POST',{organizationId:String(B)});assert.equal(r.status,401,L('L6-stale-switch-401')+' '+r.raw.slice(0,200));
   const jwtInvite=jwt.sign({type:'invite',organizationId:String(A),email:users.ownerB.email,role:'member',invitedBy:String(users.ownerA.id)},secret,{expiresIn:'7d'});
   r=await api('/api/auth/accept-invite',oldAccess,'POST',{inviteToken:jwtInvite});assert.equal(r.status,401,L('L6-stale-accept-invite-401')+' '+r.raw.slice(0,200));assert.equal((await col('organizations').findOne({_id:A})).members.some(x=>String(x.userId)===String(users.ownerB.id)),false,L('L6-stale-accept-invite-no-membership'));
   r=await api('/api/invites/accept',oldAccess,'POST',{token:inviteOwnerB});assert.equal(r.data?.requiresLogin,true,L('L1-stale-bearer-requires-login')+' '+r.raw.slice(0,200));
   // ownerA: the pre-change 2FA challenge is refused; a fresh challenge completes with sv = 1 and refreshes.
   await changePassword('ownerA');assert.equal(await svOf('ownerA'),1);
   r=await api('/api/auth/2fa/verify',null,'POST',{tempToken:pendingBefore,code:totp()});assert.equal(r.status,401,L('L6-stale-2fa-pending-refused')+' '+r.raw.slice(0,300));
   const login2=await ok('/api/auth/login',null,'POST',{email:users.ownerA.email,password:CHANGED},'login-2fa-after');assert.equal(login2.requires2FA,true);assert.equal(claims(login2.tempToken).sv,1,L('L6-2fa-pending-mint-sv'));
   let verified;for(let i=0;i<3&&!verified;i++){r=await api('/api/auth/2fa/verify',null,'POST',{tempToken:login2.tempToken,code:totp()});if(r.status===200)verified=r.data;else if(r.status===400)await pause(1500);else break}assert.ok(verified,L('L6-2fa-after-change-200')+' '+r.raw.slice(0,300));
   assert.equal(claims(verified.tokens.accessToken).sv,1,L('L6-2fa-mint-sv')+' '+JSON.stringify(claims(verified.tokens.accessToken)));r=await refresh(verified.tokens.refreshToken);assert.equal(r.status,200,L('L6-2fa-after-change-refreshes')+' '+r.raw.slice(0,200));
   // ownerB: fresh password login, the 64-hex invite (invites/accept.ts) and the JWT invite (acceptInvite) each mint sv = 1 and refresh.
   const login=await ok('/api/auth/login',null,'POST',{email:users.ownerB.email,password:CHANGED},'login-after-change');assert.equal(claims(login.tokens.accessToken).sv,1,L('L6-login-mint-sv')+' '+JSON.stringify(claims(login.tokens.accessToken)));r=await refresh(login.tokens.refreshToken);assert.equal(r.status,200,L('L6-login-after-change-refreshes')+' '+r.raw.slice(0,200));
   r=await api('/api/invites/accept',login.tokens.accessToken,'POST',{token:inviteOwnerB});assert.equal(r.status,200,L('L6-invites-accept-200')+' '+r.raw.slice(0,300));assert.equal(r.data.success,true,L('L6-invites-accept-200')+' '+r.raw.slice(0,300));assert.equal(claims(r.data.tokens.accessToken).sv,1,L('L6-invites-accept-mint-sv')+' '+JSON.stringify(claims(r.data.tokens.accessToken)));const inv1=await refresh(r.data.tokens.refreshToken);assert.equal(inv1.status,200,L('L6-invites-accept-refreshes')+' '+inv1.raw.slice(0,200));
   assert.equal((await col('organizations').findOne({_id:A})).members.find(x=>String(x.userId)===String(users.ownerB.id))?.role,'accountant',L('L6-invites-accept-membership'));
   r=await api('/api/auth/accept-invite',login.tokens.accessToken,'POST',{inviteToken:jwtInvite});assert.equal(r.status,200,L('L6-accept-invite-200')+' '+r.raw.slice(0,300));assert.equal(claims(r.data.tokens.accessToken).sv,1,L('L6-accept-invite-mint-sv')+' '+JSON.stringify(claims(r.data.tokens.accessToken)));const inv2=await refresh(r.data.tokens.refreshToken);assert.equal(inv2.status,200,L('L6-accept-invite-refreshes')+' '+inv2.raw.slice(0,200));
   const switched=await api('/api/auth/switch-organization',login.tokens.accessToken,'POST',{organizationId:String(B)});assert.equal(switched.status,200,L('L6-switch-after-change'));assert.equal(claims(switched.data.tokens.accessToken).sv,1,L('L6-switch-mint-sv'));
   // Logout persists the refresh jti; it survives a restart; an unrevoked session renews; an unsigned token persists nothing.
   const R2=switched.data.tokens,R3=(await api('/api/auth/switch-organization',login.tokens.accessToken,'POST',{organizationId:String(B)})).data.tokens;
   r=await api('/api/auth/logout',R2.accessToken,'POST',{refreshToken:R2.refreshToken});assert.equal(r.status,200,L('L6-logout-200')+' '+r.raw.slice(0,200));assert.equal(r.data.tokensRevoked.refresh,true,L('L6-logout-revoked-flag'));
   assert.equal(await col('revokedtokens').countDocuments({jti:claims(R2.refreshToken).jti}),1,L('L6-logout-persists'));r=await refresh(R2.refreshToken);assert.equal(r.status,401,L('L6-logout-refresh-401'));
   const forged=jwt.sign({userId:String(users.ownerB.id),email:users.ownerB.email,type:'refresh',jti:crypto.randomUUID()},'not-the-secret',{expiresIn:'7d'}),rowsBefore=await col('revokedtokens').countDocuments();
   r=await api('/api/auth/logout',null,'POST',{refreshToken:forged});assert.equal(r.status,200,L('L6-unsigned-logout-200'));assert.equal(r.data.tokensRevoked.refresh,false,L('L6-unsigned-not-revoked'));assert.equal(await col('revokedtokens').countDocuments(),rowsBefore,L('L6-unsigned-not-persisted'));
   await stop();await start();
   r=await refresh(R2.refreshToken);assert.equal(r.status,401,L('L6-logout-survives-restart')+' '+r.raw.slice(0,200));r=await refresh(R3.refreshToken);assert.equal(r.status,200,L('L6-unrevoked-refreshes')+' '+r.raw.slice(0,200));
   // L6d concurrency.
   const R4=(await api('/api/auth/switch-organization',login.tokens.accessToken,'POST',{organizationId:String(B)})).data.tokens,countBefore=await col('revokedtokens').countDocuments();
   const logouts=await Promise.all(Array.from({length:5},()=>api('/api/auth/logout',R4.accessToken,'POST',{refreshToken:R4.refreshToken})));assert.ok(logouts.every(x=>x.status===200),L('L6d-concurrent-logout-200'));assert.equal(await col('revokedtokens').countDocuments(),countBefore+1,L('L6d-concurrent-logout-one-row'));r=await refresh(R4.refreshToken);assert.equal(r.status,401,L('L6d-concurrent-logout-refresh-401'));
   const stale=await Promise.all(Array.from({length:5},()=>refresh(R1)));assert.deepEqual(stale.map(x=>x.status),[401,401,401,401,401],L('L6d-concurrent-stale-401'));
   assert.ok(!logs.includes(PASSWORD)&&!logs.includes(CHANGED),L('L6-no-secret-in-logs'));
   pass('L6 a password change increments sessionVersion and answers fresh tokens; the old refresh, switch, accept-invite, invites/accept and 2FA challenge are refused; password login, 2FA completion, both invite accepts and switch mint sv = sessionVersion and refresh; logout persists the refresh jti across a restart, an unsigned token persists nothing, concurrent logouts write one row and concurrent stale refreshes all 401; pre-deploy tokens without sv still renew');
  });

  // ---- L6client. The store adopts the fresh tokens; a refresh already in flight cannot undo them (source test file beside this script).
  await leg('L6client',async()=>{
   const r=await new Promise(resolve=>execFile(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=adoptTokens',path.join(root,'scripts','auth-regression.test.cjs')],{cwd:root,windowsHide:true,env:{...process.env},timeout:300000,maxBuffer:8*1024*1024},(e,stdout,stderr)=>resolve({code:e?(Number.isInteger(e.code)?e.code:1):0,text:String(stdout)+'\n'+String(stderr)})));
   assert.equal(r.code,0,L('L6client-adoptTokens')+' exit '+r.code+' '+r.text.slice(-3000));assert.match(r.text,/# pass 2\b/,L('L6client-adoptTokens-two-legs')+' '+r.text.slice(-1500));assert.match(r.text,/# fail 0\b/,L('L6client-adoptTokens-no-failure'));
   pass('L6client adoptTokens survives a pending refresh resolving 401 and is not overwritten by one resolving 200');
  });

  // ---- L7. Uploads: login required, 413 caps, parsed output, request-lifetime storage, aged-file sweep, process-file gone (S17).
  await leg('L7',async()=>{
   const nothing=async label=>{const d=await dataFiles();assert.deepEqual(d,{download:[],processed:[]},L(label)+' '+JSON.stringify(d))};
   let r=await api('/api/upload',null,'POST',form('anon.xlsx',xlsxBytes));assert.equal(r.status,401,L('L7-upload-anon-401')+' '+r.raw.slice(0,200));await nothing('L7-upload-anon-nothing');
   r=await api('/api/excel-processor',null,'POST',form('anon.xlsx',xlsxBytes));assert.equal(r.status,401,L('L7-excel-anon-401')+' '+r.raw.slice(0,200));await nothing('L7-excel-anon-nothing');
   r=await api('/api/excel-processor',tok('ownerA'),'POST',form('rows.xlsx',xlsxBytes));assert.equal(r.status,200,L('L7-excel-200')+' '+r.raw.slice(0,400));assert.deepEqual(r.data.headers,['Date','Amount'],L('L7-excel-parsed')+' '+r.raw.slice(0,400));assert.equal(r.data.data.length,2,L('L7-excel-rows'));assert.equal(r.data.rowCount,2);
   assert.equal(fs.existsSync(r.data.savedPath),false,L('L7-excel-input-gone')+' '+r.data.savedPath);assert.equal(fs.existsSync(r.data.processedPath),false,L('L7-excel-output-gone')+' '+r.data.processedPath);await nothing('L7-excel-dirs-empty');
   r=await api('/api/excel-processor',tok('ownerA'),'POST',form('rows.csv',csvBytes,{},'text/csv'));assert.equal(r.status,200,L('L7-excel-csv-200')+' '+r.raw.slice(0,400));assert.deepEqual(r.data.headers,['Date','Amount'],L('L7-excel-csv-parsed'));await nothing('L7-excel-csv-dirs-empty');
   r=await api('/api/upload',tok('ownerA'),'POST',form('rows.xlsx',xlsxBytes));assert.equal(r.status,200,L('L7-upload-200')+' '+r.raw.slice(0,400));assert.equal(r.data.success,true,L('L7-upload-success'));assert.ok(typeof r.data.processedPath==='string'&&r.data.processedPath,L('L7-upload-processed')+' '+r.raw.slice(0,400));assert.match(r.data.savedAs,/^\d+-rows\.xlsx$/,L('L7-upload-saved-as'));
   assert.equal(fs.existsSync(r.data.path),false,L('L7-upload-input-gone')+' '+r.data.path);assert.equal(fs.existsSync(r.data.processedPath),false,L('L7-upload-output-gone')+' '+r.data.processedPath);await nothing('L7-upload-dirs-empty');
   r=await api('/api/upload',tok('ownerA'),'POST',form('corrupt.xlsx',corruptBytes));assert.equal(r.status,200,L('L7-upload-corrupt-200')+' '+r.raw.slice(0,400));assert.ok(r.data.processedPath===null||!fs.existsSync(r.data.processedPath),L('L7-upload-corrupt-null')+' '+r.raw.slice(0,400));assert.equal(fs.existsSync(r.data.path),false,L('L7-upload-corrupt-input-gone'));await nothing('L7-upload-corrupt-dirs-empty');
   // A workbook the parser always refuses: /api/upload answers 200 with no processed output, /api/excel-processor answers its error; neither leaves a file.
   r=await api('/api/upload',tok('ownerA'),'POST',form('rejected.xlsx',rejectedBytes));assert.equal(r.status,200,L('L7-upload-rejected-200')+' '+r.raw.slice(0,400));assert.equal(r.data.success,true,L('L7-upload-rejected-success')+' '+r.raw.slice(0,400));assert.ok(typeof r.data.path==='string'&&r.data.path.endsWith('rejected.xlsx'),L('L7-upload-rejected-path')+' '+r.raw.slice(0,400));assert.strictEqual(r.data.processedPath,null,L('L7-upload-rejected-null')+' '+r.raw.slice(0,400));assert.equal(fs.existsSync(r.data.path),false,L('L7-upload-rejected-input-gone'));await nothing('L7-upload-rejected-dirs-empty');
   r=await api('/api/excel-processor',tok('ownerA'),'POST',form('rejected.xlsx',rejectedBytes));assert.equal(r.status,500,L('L7-excel-rejected-error')+' '+r.status+' '+r.raw.slice(0,300));assert.ok(r.raw.includes('Excel processing failed'),L('L7-excel-rejected-diagnostic')+' '+r.raw.slice(0,300));await nothing('L7-excel-rejected-dirs-empty');
   const age=async()=>{const old=new Date(Date.now()-25*3600000);for(const[d,n]of[[downloadDir,'aged.bin'],[processedDir,'aged.json']]){await fsp.writeFile(path.join(d,n),'old');await fsp.utimes(path.join(d,n),old,old)}await fsp.writeFile(path.join(downloadDir,'recent.bin'),'new')};
   await age();r=await api('/api/excel-processor',tok('ownerA'),'POST',form('rows.xlsx',xlsxBytes));assert.equal(r.status,200);let d=await dataFiles();assert.deepEqual(d,{download:['recent.bin'],processed:[]},L('L7-sweep-excel')+' '+JSON.stringify(d));await fsp.unlink(path.join(downloadDir,'recent.bin'));
   await age();r=await api('/api/upload',tok('ownerA'),'POST',form('rows.xlsx',xlsxBytes));assert.equal(r.status,200);d=await dataFiles();assert.deepEqual(d,{download:['recent.bin'],processed:[]},L('L7-sweep-upload')+' '+JSON.stringify(d));await fsp.unlink(path.join(downloadDir,'recent.bin'));
   r=await api('/api/upload',tok('ownerA'),'POST',form('huge.xlsx',hugeBytes));assert.equal(r.status,413,L('L7-upload-413')+' '+r.raw.slice(0,200));await nothing('L7-upload-413-nothing');
   r=await api('/api/excel-processor',tok('ownerA'),'POST',form('huge.xlsx',hugeBytes));assert.equal(r.status,413,L('L7-excel-413')+' '+r.raw.slice(0,200));await nothing('L7-excel-413-nothing');
   r=await api('/api/process-file',null,'POST',{filePath:path.join(directory,'uploads','.env')});assert.ok((r.status===404||(r.status===200&&r.raw.includes('<div id="__nuxt">')&&r.raw.includes('id="__NUXT_DATA__"'))),L('L7-process-file-404')+' '+r.raw.slice(0,200));r=await api('/api/process-file',tok('ownerA'),'POST',{filePath:path.join(directory,'uploads','.env')});assert.ok((r.status===404||(r.status===200&&r.raw.includes('<div id="__nuxt">')&&r.raw.includes('id="__NUXT_DATA__"'))),L('L7-process-file-404-signed-in')+' '+r.raw.slice(0,200));
   assert.deepEqual((await fsp.readdir(directory)).filter(n=>/^temp-excel.*\.cjs$/.test(n)),[],L('L7-no-temp-script'));
   pass('L7 both upload routes need a login (401, nothing written), parse the synthetic workbook (arbitrary bytes the parser accepts are removed too; a workbook it refuses leaves nothing and the Excel route answers its error), leave neither input nor output on disk after the response, sweep files older than 24 h and keep recent ones, answer 413 above 10 MB, and /api/process-file is gone');
  });

  // ---- L8. The tracked workbooks are gone and the runtime directories are ignored (worktree only).
  await leg('L8',async()=>{
   assert.ok(fs.existsSync(path.join(root,'.git')),'SETUP L8 runs on the worktree');
   const tracked=await new Promise(resolve=>execFile('git',['-C',root,'ls-files','server/data'],{windowsHide:true},(e,stdout)=>resolve(e?'ERR '+e.message:String(stdout))));assert.equal(tracked.trim(),'',L('L8-tracked-empty')+' '+tracked);
   const ignore=(await fsp.readFile(path.join(root,'.gitignore'),'utf8')).split(/\r?\n/);assert.ok(ignore.includes('server/data/')&&ignore.includes('backups/'),L('L8-gitignore')+' '+JSON.stringify(ignore.slice(20,34)));
   pass('L8 git tracks nothing under server/data and .gitignore lists server/data/ and backups/');
  });

  // ---- L9. Installed Chrome: the profile password change keeps the session; the three upload pages send Authorization and show their own success.
  await leg('L9',async()=>{
   const {runBrowserLeg}=require('./finance-security-fixes-browser.cjs');
   await runBrowserLeg({origin,users,PASSWORD,CHANGED,directory,xlsxPath,csvPath,L,assert,pause,db,A,ObjectId});
   pass('L9 Chrome: /profile password change adopts the new tokens and the next refresh is 200; /transactions/upload shows the row count, /file-upload the success section and Data Preview, /upload-test the success section with a non-null processed path; every upload request carried Authorization');
  });

 }finally{if(child){child.kill();await child.closed}if(listener)await new Promise(r=>listener.close(r));if(client)await client.close();if(mongo)await mongo.stop();if(directory){const owned=path.resolve(directory),base=path.resolve(os.tmpdir());assert.ok(owned.startsWith(base+path.sep)&&path.basename(owned).startsWith('omf-security-'),'SETUP unsafe cleanup directory');await fsp.rm(owned,{recursive:true,force:true})}}
 console.log(groups+' security groups passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});

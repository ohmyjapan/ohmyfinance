const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
// Assistant-only evaluation (OMF_TEST_ASSISTANT_ONLY: the omf-navi-api-actions fixture and its packaged copies) runs long synthetic
// worker scenarios. Its owned mongod/app setup, request budget and cleanup get the measured finite tolerance of the sibling owned
// fixtures (finance-navi-status-integration.cjs): 300 s setup, 60 s per request instead of 20 s, and cleanup that runs every step and
// keeps the run's own result. Every other mode keeps its current startup, 20 s budget and cleanup. Nothing is ever re-sent: a request
// over budget fails with its method, path and elapsed time only (no headers or tokens), and a larger budget explains no earlier timeout.
const ASSISTANT_ONLY=!!process.env.OMF_TEST_ASSISTANT_ONLY,SETUP_READY_MS=300000,REQUEST_BUDGET_MS=ASSISTANT_ONLY?60000:20000;
async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
// The explicit recent Amex job through the built app (case omf-amex-recent-activity-20261102): the bounded request, the capability a PC declares in its own claims, a legacy claim that
// never receives it, a job that can only upload provisional activity, and closed jobs that are untouched before, between and after. The schedule, Navi and the bill notice run at
// module level in scripts/zoomer-fixtures/omf-amex-recent.mjs, whose mutants need no rebuild.
async function recentJobs({db,call,request,token,other,pass,csv,row}){
 const created=await request('accounts',{name:'Recent synthetic Amex',primaryCard:'71560',cardIdentifiers:['71560'],otpRecipient:'recent@example.invalid',otpMailbox:'recent@example.invalid'});assert.equal(created.status,200,JSON.stringify(created));const id=created.data.account._id;
 const createdAplus=await request('accounts',{provider:'aplus',name:'Recent synthetic Aplus',primaryCard:'9471',cardIdentifiers:['9471']});assert.equal(createdAplus.status,200,JSON.stringify(createdAplus));const aplusId=createdAplus.data.account._id;
 const device=await request('collectors',{name:'Recent collector',accountIds:[id,aplusId]});assert.equal(device.status,200,JSON.stringify(device));const dev=device.data.token,CAPABLE={capabilities:['amex-recent-v1']};
 const claim=body=>call('/api/finance/collector/claim',{method:'POST',token:dev,body:body||{}});
 const stored=()=>db.collection('financialaccounts').findOne({_id:new ObjectId(id)}),collector=()=>db.collection('financecollectors').findOne({_id:new ObjectId(device.data.id)});
 const sync=(body,account=id,auth=token)=>call('/api/finance/accounts/'+account+'/sync',{method:'POST',token:auth,...(body===undefined?{}:{body})});
 const status=(jobId,state)=>call('/api/finance/collector/status',{method:'POST',token:dev,body:{accountId:id,jobId,state,message:'synthetic'}});
 const sent=(jobId,query,bytes)=>call('/api/finance/collector/upload?accountId='+id+'&jobId='+jobId+query,{method:'POST',token:dev,body:bytes,raw:true});
 const cell=changes=>row({0:'2026/10/06',1:'2026/10/07',2:'Recent shop',4:'71560',5:'1200',...changes}),activity=csv([cell(),cell({2:'Recent other',5:'800'})]);
 const imports=()=>db.collection('financeimports').countDocuments({accountId:new ObjectId(id)});
 // the request: a bounded word, Amex only, the caller's own account, and a PC that has declared it
 assert.equal((await sync({source:'closed'})).status,400,'recent-api:unknown-source');
 assert.equal((await sync({source:['recent']})).status,400,'recent-api:source-is-one-word');
 assert.equal((await sync({source:'recent'},aplusId)).status,400,'recent-api:aplus-refused');
 assert.equal((await sync({source:'recent'},id,other)).status,404,'recent-api:another-owner');
 const unsupported=await sync({source:'recent'});assert.equal(unsupported.status,409,'recent-api:no-capable-collector '+JSON.stringify(unsupported));
 assert.match(String(unsupported.data?.data?.message),/未請求（仮）/,'recent-api:refusal-explains-itself '+JSON.stringify(unsupported.data));
 assert.equal((await stored()).jobState,'idle','recent-api:a-refusal-queues-nothing');
 assert.equal((await claim()).data.account,null,'recent-api:legacy-idle-claim');assert.equal((await collector()).capabilities?.length??0,0,'recent-api:a-legacy-claim-records-nothing');
 assert.equal((await claim(CAPABLE)).data.account,null,'recent-api:capable-idle-claim');assert.deepEqual((await collector()).capabilities,['amex-recent-v1'],'recent-api:the-claim-records-the-capability');
 assert.equal((await claim({capabilities:['something-else','amex-recent-v1','x'.repeat(50)]})).status,200);assert.deepEqual((await collector()).capabilities,['amex-recent-v1'],'recent-api:only-known-capabilities-are-kept');
 assert.equal((await claim()).status,200);assert.equal((await collector()).capabilities?.length??0,0,'recent-api:a-downgraded-collector-loses-it');
 assert.equal((await sync({source:'recent'})).status,409,'recent-api:refused-again-after-the-downgrade');
 assert.equal((await claim(CAPABLE)).status,200);
 pass('the recent request is bounded, Amex only and refused until a connected PC has declared it in its own claim');
 // the job: a legacy claim leaves it, a capable claim takes it, and it can only go up as provisional
 const queued=await sync({source:'recent'});assert.equal(queued.status,200,JSON.stringify(queued));assert.equal(queued.data.account.jobSource,'recent','recent-api:queued-as-recent');
 assert.equal((await sync({source:'recent'})).status,409,'recent-api:one-job-at-a-time');assert.equal((await sync()).status,409,'recent-api:a-queued-job-is-not-replaced');
 assert.equal((await claim()).data.account,null,'recent-api:a-legacy-claim-never-receives-it');
 assert.deepEqual([(await stored()).jobState,(await stored()).jobDeviceId,(await stored()).lastAttemptAt],['queued',undefined,undefined],'recent-api:left-untouched-by-the-legacy-claim');
 const job=(await claim(CAPABLE)).data.account;assert.equal(job?._id,id,'recent-api:a-capable-claim-takes-it');assert.equal(job.jobSource,'recent','recent-api:the-claim-says-recent');
 assert.equal((await stored()).lastAttemptAt,undefined,'recent-api:a-recent-claim-is-no-closed-attempt');assert.equal((await stored()).jobState,'running','recent-api:running');
 for(const query of ['&kind=statement&start=2026-10-05&end=2026-11-02&pageCount=2','&kind=recent&start=2026-10-05&end=2026-11-02&pageCount=2','&start=2026-10-05&end=2026-11-02&pageCount=2','&kind=custom&start=2026-10-05&end=2026-11-02'])assert.equal((await sent(job.jobId,query,activity)).status,409,'recent-api:only-provisional-from-a-recent-job '+query);
 assert.equal(await imports(),0,'recent-api:nothing-archived-by-a-refused-upload');
 assert.equal((await sent(job.jobId,'&kind=pending&start=2026-10-05&end=2026-11-02&pageCount=3',activity)).status,400,'recent-api:the-count-still-binds');
 assert.equal((await sent(job.jobId,'&kind=pending&start=2026-10-08&end=2026-11-02&pageCount=2',activity)).status,400,'recent-api:the-dates-still-bind');
 const accepted=await sent(job.jobId,'&kind=pending&start=2026-10-05&end=2026-11-02&pageCount=2',activity);assert.equal(accepted.status,200,JSON.stringify(accepted));assert.equal(accepted.data.rowCount,2);
 const repeat=await sent(job.jobId,'&kind=pending&start=2026-10-05&end=2026-11-03&pageCount=2',activity);assert.deepEqual([repeat.data.id,repeat.data.duplicateFile],[accepted.data.id,true],'recent-api:a-retry-is-the-same-import');
 const batch=await db.collection('financeimports').findOne({_id:new ObjectId(accepted.data.id)});
 assert.deepEqual([batch.sourceStatus,batch.period.kind,batch.period.key,batch.calendar,await imports()],['pending','pending','pending:2026-10-05:2026-11-02',undefined,1],'recent-api:stored-provisional-with-no-calendar-work');
 assert.equal((await status(job.jobId,'complete')).status,200);
 const review=(await request('imports/'+accepted.data.id,undefined,'GET')).data;assert.deepEqual([review.sourceStatus,review.requiresDraft,review.rows.map(r=>r.settlement.state)],['pending',true,['pending','pending']],'recent-api:review-says-provisional');
 const ledger=await db.collection('transactions').countDocuments();for(const action of ['import','link'])assert.equal((await request('imports/'+accepted.data.id+'/commit',{decisions:[{line:2,action,draftRevision:1,confirmNew:true}]})).status,409,'recent-api:unpostable '+action);assert.equal(await db.collection('transactions').countDocuments(),ledger,'recent-api:no-ledger-write');
 pass('a recent job goes only to a capable collector, uploads only provisional activity, keeps its count and dates, retries as one import and cannot post');
 // afterwards: closed jobs are what they were, for a legacy and a capable collector alike
 const closed=await sync();assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(closed.data.account.jobSource,undefined,'recent-api:a-closed-request-clears-the-kind');assert.equal((await stored()).jobSource,undefined,'recent-api:cleared-in-the-store');
 const legacyJob=(await claim()).data.account;assert.deepEqual([legacyJob?._id,legacyJob?.jobSource],[id,undefined],'recent-api:a-legacy-claim-takes-the-closed-job');assert.ok((await stored()).lastAttemptAt,'recent-api:a-closed-claim-records-its-attempt');
 const statement=csv([cell({0:'2026/09/10',1:'2026/09/11',2:'Closed shop'}),cell({0:'2026/09/12',1:'2026/09/13',2:'Closed other',5:'700'})]);
 const accepted2=await sent(legacyJob.jobId,'&kind=statement&start=2026-09-05&end=2026-10-04&pageCount=2',statement);assert.equal(accepted2.status,200,JSON.stringify(accepted2));assert.equal((await db.collection('financeimports').findOne({_id:new ObjectId(accepted2.data.id)})).sourceStatus,undefined,'recent-api:a-closed-import-stays-confirmed');assert.equal((await status(legacyJob.jobId,'complete')).status,200);
 const named=await sync({source:'statement'});assert.equal(named.status,200,JSON.stringify(named));const capableClosed=(await claim(CAPABLE)).data.account;assert.deepEqual([capableClosed?._id,capableClosed?.jobSource],[id,undefined],'recent-api:a-capable-claim-takes-closed-jobs-too');
 const retained=csv([cell({2:'Provisional left behind',5:'901'})]);const drained=await sent(capableClosed.jobId,'&kind=pending&start=2026-10-05&end=2026-11-02&pageCount=1',retained);assert.equal(drained.status,200,'recent-api:a-closed-job-can-send-a-retained-provisional-file '+JSON.stringify(drained));assert.equal((await db.collection('financeimports').findOne({_id:new ObjectId(drained.data.id)})).sourceStatus,'pending','recent-api:that-file-stays-provisional');assert.equal((await status(capableClosed.jobId,'complete')).status,200);
 // a lost recent job is resumed only by a capable collector, under the same job
 const again=await sync({source:'recent'});assert.equal(again.status,200,JSON.stringify(again));const lost=(await claim(CAPABLE)).data.account;await db.collection('financialaccounts').updateOne({_id:new ObjectId(id)},{$set:{jobLeaseUntil:new Date(Date.now()-1000)}});
 assert.equal((await claim()).data.account,null,'recent-api:a-legacy-claim-never-resumes-it');const resumed=(await claim(CAPABLE)).data.account;assert.deepEqual([resumed?.jobId,resumed?.jobSource],[lost.jobId,'recent'],'recent-api:resumed-under-the-same-job');assert.equal((await status(lost.jobId,'complete')).status,200);
 // Aplus and priority: closed work of another card goes first, with its own reply
 await db.collection('financialaccounts').updateOne({_id:new ObjectId(aplusId)},{$set:{jobId:'recent-aplus-job',jobState:'queued',jobRequestedAt:new Date()}});const third=await sync({source:'recent'});assert.equal(third.status,200,JSON.stringify(third));
 const first=await claim(CAPABLE);assert.deepEqual([first.data.account?._id,Array.isArray(first.data.covered?.statements)],[aplusId,true],'recent-api:closed-work-first-aplus-reply-unchanged');const next=(await claim(CAPABLE)).data.account;assert.equal(next?.jobSource,'recent','recent-api:then-the-recent-job');
 pass('closed jobs stay closed after a recent job for legacy and capable collectors, a lost recent job resumes only on a capable one, and Aplus claims are unchanged');
}
async function main(){
 let mongo,child,client,directory,logs='',checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
 const setupTiming={},slowest={ms:0,request:null};
 try{
  const {HEADERS,parseAmex}=await import('../shared/amex.mjs');
  const csv=rows=>Buffer.from([HEADERS,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const row=(changes={})=>Object.assign(['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1234','',''],changes);
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-finance-test-'));
  const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  const mongoStarted=Date.now();mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,...(ASSISTANT_ONLY?{instance:{launchTimeout:SETUP_READY_MS}}:{})});setupTiming.mongoMs=Date.now()-mongoStarted;
  const uri=mongo.getUri('finance_regression'),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{logs=(logs+v).slice(-15000);});
  let healthy=false;const appStarted=Date.now();for(let i=0;ASSISTANT_ONLY?Date.now()-appStarted<SETUP_READY_MS:i<100;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,'finance_regression');healthy=true;break;}}catch{}await pause(200);}setupTiming.appMs=Date.now()-appStarted;assert.ok(healthy,'Isolated app health: '+logs);
  client=await MongoClient.connect(uri);const db=client.db('finance_regression');
  async function call(route,{method='GET',token,body,raw=false}={}){
   const started=Date.now();
   try{
    const response=await fetch(origin+route,{method,headers:{'Content-Type':raw?'text/csv':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(REQUEST_BUDGET_MS)});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    if(ASSISTANT_ONLY&&Date.now()-started>slowest.ms){slowest.ms=Date.now()-started;slowest.request=method+' '+route.split('?')[0];}
    return {status:response.status,data};
   }catch(error){if(ASSISTANT_ONLY)console.error('REQUEST_FAILED '+JSON.stringify({method,path:route.split('?')[0],elapsedMs:Date.now()-started,budgetMs:REQUEST_BUDGET_MS,error:String(error?.name||'Error')}));throw error;}
  }
  const register=async email=>{const r=await call('/api/auth/register',{method:'POST',body:{email,password:'Synthetic-password-Only1!',name:'Finance test'}});assert.equal(r.status,200,JSON.stringify(r));return r.data.tokens.accessToken;};
  let token=await register('finance-a@example.invalid'),other=await register('finance-b@example.invalid');
  const unselectedToken=token;
  const masterCompany=new ObjectId(),masterOwner=(await db.collection('users').findOne({email:'finance-a@example.invalid'}))._id;
  await db.collection('organizations').insertOne({_id:masterCompany,name:'Synthetic master company',slug:'finance-master-company',isActive:true,members:[{userId:masterOwner,role:'owner',joinedAt:new Date()}]});
  const selected=await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:String(masterCompany)}});assert.equal(selected.status,200);token=selected.data.tokens.accessToken;
  const otherCompany=new ObjectId(),otherOwner=(await db.collection('users').findOne({email:'finance-b@example.invalid'}))._id;
  await db.collection('organizations').insertOne({_id:otherCompany,name:'Synthetic foreign master company',slug:'finance-foreign-master-company',isActive:true,members:[{userId:otherOwner,role:'owner',joinedAt:new Date()}]});
  const otherSelected=await call('/api/auth/switch-organization',{method:'POST',token:other,body:{organizationId:String(otherCompany)}});assert.equal(otherSelected.status,200);other=otherSelected.data.tokens.accessToken;
  const request=(route,body,method='POST')=>call('/api/finance/'+route,{token,body,method});
  assert.equal((await call('/api/finance/accounts')).status,401);assert.equal((await call('/api/finance/collector/accounts')).status,401);pass('finance routes require the correct authorization');
  const input={name:'Synthetic Amex',primaryCard:'12345',cardIdentifiers:['12345','23456'],otpRecipient:'original@example.invalid',otpMailbox:'forwarded@example.invalid'};
  const created=await request('accounts',input);assert.equal(created.status,200,JSON.stringify(created));const account=created.data.account,id=account._id;
  assert.equal((await request('accounts',{...input,cardIdentifiers:{bad:1}})).status,400);
  assert.equal((await request('accounts',input)).status,409);
  const device=await request('collectors',{name:'Test collector',accountIds:[id]});assert.equal(device.status,200);const deviceToken=device.data.token;
  assert.equal((await call('/api/finance/collector/accounts',{token:deviceToken})).data.accounts.length,1);
  assert.equal((await call('/api/finance/accounts',{token:deviceToken})).status,401);
  assert.equal((await call('/api/finance/accounts/'+id+'/sync',{method:'POST',token:other})).status,404);pass('account mapping is unique and collector tokens cannot act as users');
  const bytes=csv([row(),row(),row({4:'23456',2:'Other card',5:'99'}),row({2:'前回分口座振替金額',5:'-2500'})]);
  const qs='?kind=statement&start=2026-07-19&end=2026-08-18';
  async function upload(bytes,query=qs){return call('/api/finance/accounts/'+id+'/imports'+query,{method:'POST',token,body:bytes,raw:true});}
  if(process.env.OMF_TEST_ASSISTANT_ONLY){await require('./finance-assistant-scope-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,root,csv,row,pause});console.log(checks+' targeted assistant checks passed');return;}
  if(process.env.OMF_TEST_DIALOGUE_ONLY){await require('./finance-dialogue-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,root,csv,row,pause});console.log(checks+' targeted dialogue checks passed');return;}
  if(process.env.OMF_TEST_WORKFLOW_ONLY){await require('./finance-workflow-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row,directory});console.log(checks+' targeted workflow checks passed');return;}
  if(process.env.OMF_TEST_EVALUATION_ONLY){await require('./finance-evaluation-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row});console.log(checks+' targeted evaluation checks passed');return;}
  if(process.env.OMF_TEST_RESEARCH_ONLY){await require('./finance-research-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row});console.log(checks+' targeted research checks passed');return;}
  if(process.env.OMF_TEST_PURCHASE_LINKS_ONLY){await require('./finance-purchase-links-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row});console.log(checks+' targeted purchase connection checks passed');return;}
  if(process.env.OMF_TEST_EXPORT_ONLY){await require('./finance-export-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row,directory});console.log(checks+' targeted export checks passed');return;}
  if(process.env.OMF_TEST_PENDING_ONLY){await require('./finance-pending-integration.cjs')({db,call,request,upload,token,other,pass,csv,row,origin,root});console.log(checks+' targeted pending checks passed');return;}
  if(process.env.OMF_TEST_RECENT_ONLY){await recentJobs({db,call,request,token,other,pass,csv,row});console.log(checks+' targeted recent activity checks passed');return;}
  if(process.env.OMF_TEST_APLUS_ONLY){await require('./finance-aplus-integration.cjs')({db,call,request,token:unselectedToken,other,pass,root,origin});console.log(checks+' targeted Aplus checks passed');return;}
  if(process.env.OMF_TEST_IMPORT_OVERLAP_ONLY){await require('./finance-import-overlap-integration.cjs')({db,call,request,upload,token,other,pass,csv,row,origin,root});console.log(checks+' targeted source overlap checks passed');return;}
  if(process.env.OMF_TEST_INVENTORY_REVIEW_ONLY){await require('./finance-inventory-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});console.log(checks+' targeted inventory review checks passed');return;}
  if(process.env.OMF_TEST_CUSTOMER_REVIEW_ONLY){await require('./finance-customer-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});console.log(checks+' targeted customer review checks passed');return;}
  if(process.env.OMF_TEST_SERVICE_REVIEW_ONLY){await require('./finance-service-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});console.log(checks+' targeted service review checks passed');return;}
  if(process.env.OMF_TEST_DOCUMENTS_ONLY){await require('./finance-document-evidence-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});console.log(checks+' targeted document checks passed');return;}
  if(process.env.OMF_TEST_ACCOUNTING_ASSESSMENT_ONLY){await require('./finance-accounting-assessment-integration.cjs')({ db, call, request, token, other, origin, pass, root, csv, row });console.log(checks+' targeted accounting assessment checks passed');return;}
  if(process.env.OMF_TEST_PURCHASE_ACCOUNTS_ONLY){await require('./finance-purchase-accounts-integration.cjs')({ db, call, request, token, other, origin, pass, root, csv, row });console.log(checks+' targeted purchase accounting checks passed');return;}
  if(process.env.OMF_TEST_ACCOUNTING_ONLY){await require('./finance-accounting-integration.cjs')({ db, call, request, upload, token:unselectedToken, other, origin, pass, root, csv, row, pause });console.log(`${checks} targeted finance accounting checks passed`);return;}
  if(process.env.OMF_TEST_INTAKE_ONLY){await require('./finance-intake-integration.cjs')({db,call,token,other,deviceToken,origin,pass,root,pause});console.log(checks+' targeted intake checks passed');return;}
  if(process.env.OMF_TEST_PAYMENTS_ONLY){await require('./finance-payment-match-integration.cjs')({db,call,request,upload,token,other,deviceToken,origin,pass,root,csv,row,pause,directory});console.log(checks+' targeted payment matching checks passed');return;}
  if(process.env.OMF_TEST_BANK_COLLECTION_ONLY){await require('./finance-bank-collection-integration.cjs')({db,call,request,upload,token,other,deviceToken,origin,pass,root,csv,row,pause,directory});console.log(checks+' targeted bank collection checks passed');return;}
  assert.equal((await upload(csv([row({4:'99999'})]))).status,400);
  const first=await upload(bytes);assert.equal(first.status,200,JSON.stringify(first));const batchId=first.data.id;
  const repeated=await upload(bytes);assert.equal(repeated.data.id,batchId);assert.equal(repeated.data.duplicateFile,true);assert.equal(await db.collection('financeimports').countDocuments(),1);
  const original=await call('/api/finance/imports/'+batchId+'/file',{token});assert.equal(original.status,200);assert.equal(original.data,bytes.toString());
  assert.equal((await call('/api/finance/imports/'+batchId+'/file',{token:other})).status,404);
  assert.equal((await upload(bytes,qs+'&pageCount=999')).status,400);pass('original files survive intact; retries are idempotent and cross-account access is denied');
  const view=(await request('imports/'+batchId,undefined,'GET')).data;assert.deepEqual(view.rows.map(r=>r.state),['new','new','new','repayment']);
  assert.equal((await request('imports/'+batchId+'/commit',{decisions:view.rows.map(r=>({line:r.line,action:'import'}))})).status,400);assert.equal(await db.collection('transactions').countDocuments(),0);
  const decisions=view.rows.slice(0,3).map(r=>({line:r.line,action:'import'}));
  const concurrent=await Promise.all([request('imports/'+batchId+'/commit',{decisions}),request('imports/'+batchId+'/commit',{decisions})]);assert.ok(concurrent.some(r=>r.status===200),JSON.stringify(concurrent));assert.ok(concurrent.every(r=>[200,409].includes(r.status)));
  assert.equal(await db.collection('transactions').countDocuments(),3);
  assert.equal((await request('imports/'+batchId+'/commit',{decisions})).status,200);assert.equal(await db.collection('transactions').countDocuments(),3);
  const tx=await db.collection('transactions').findOne({cardNumber:'3456'});assert.equal(tx.type,'支出');assert.equal(tx.metadata.originalCardIdentifier,'23456');assert.equal(tx.metadata.processingDate,'2026-08-03');pass('repayments cannot post; concurrent retries preserve identical purchases and supplementary-card attribution');
  const overlapping=await upload(csv([row(),row({2:'New purchase',5:'42'})]),'?kind=recent&start=2026-08-01&end=2026-08-31');
  const overlapView=(await request('imports/'+overlapping.data.id,undefined,'GET')).data;assert.equal(overlapView.rows[0].state,'source_overlap_review');
  assert.equal((await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);
  await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'skip'}]});
  assert.equal((await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);pass('overlapping snapshots require an explicit decision even after a row was deferred');
  const corrected=await upload(csv([row({1:'2026/08/04'})]));const correctedView=(await request('imports/'+corrected.data.id,undefined,'GET')).data;assert.equal(correctedView.rows[0].state,'correction_review');assert.equal((await request('imports/'+corrected.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);pass('changed processing dates are held as possible corrections rather than new spending');
  const legacyId=new ObjectId();await db.collection('transactions').insertOne({_id:legacyId,date:new Date('2026-08-04T15:00:00Z'),amount:500,type:'支出',status:'completed',notes:'Older manual entry',cardNumber:'2345'});
  const legacy=await upload(csv([row({0:'2026/08/05',1:'2026/08/06',2:'Legacy shop',5:'500'})]));const legacyView=(await request('imports/'+legacy.data.id,undefined,'GET')).data;
  assert.equal(legacyView.rows[0].state,'legacy_review');assert.equal((await request('imports/'+legacy.data.id+'/commit',{decisions:[{line:2,action:'link',transactionId:legacyId.toHexString()}]})).data.linked,1);
  assert.equal((await db.collection('transactions').findOne({_id:legacyId})).notes,'Older manual entry');pass('historical matches include Japan-local dates and linking leaves accounting data intact');
  const interrupted=await upload(csv([row({2:'Interrupted purchase',5:'777'})]));const raw=parseAmex(csv([row({2:'Interrupted purchase',5:'777'})]),input.cardIdentifiers).rows[0];const ownerId=(await db.collection('financialaccounts').findOne({_id:new ObjectId(id)})).ownerId;
  const reserved={_id:new ObjectId(),ownerId,accountId:new ObjectId(id),key:raw.key,fingerprint:raw.fingerprint,occurrence:1,coverage:'statement:2026-07-19:2026-08-18',importId:new ObjectId(interrupted.data.id),line:2,transactionId:new ObjectId(),state:'reserved',row:raw,linkedExisting:false};
  await db.collection('financeentries').insertOne(reserved);await db.collection('transactions').insertOne({_id:reserved.transactionId,date:new Date(raw.purchaseDate),amount:777,type:'支出',status:'completed',metadata:{financeEntryId:reserved._id.toHexString()}});
  const before=await db.collection('transactions').countDocuments();assert.equal((await request('imports/'+interrupted.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,200);assert.equal(await db.collection('transactions').countDocuments(),before);assert.equal((await db.collection('financeentries').findOne({_id:reserved._id})).state,'posted');pass('a crash after ledger insertion resumes without inserting the transaction again');
  assert.equal((await request('accounts/'+id+'/sync')).status,200);
  const claimed=await call('/api/finance/collector/claim',{method:'POST',token:deviceToken,body:{}});assert.equal(claimed.data.account._id,id);
  const up='/api/finance/collector/upload'+qs+'&accountId='+id+'&jobId='+claimed.data.account.jobId+'&pageCount=4';
  assert.equal((await call(up,{method:'POST',token:deviceToken,body:bytes,raw:true})).data.duplicateFile,true);
  await request('collectors/'+device.data.id,undefined,'DELETE');assert.equal((await call('/api/finance/collector/accounts',{token:deviceToken})).status,401);assert.equal((await call(up,{method:'POST',token:deviceToken,body:bytes,raw:true})).status,401);pass('only an assigned collector can upload; revocation takes effect immediately');
  const mappingImport=await upload(csv([row({2:'Mapped repeated shop',5:'4321'}),row({2:'Mapped repeated shop',5:'4321'}),row({2:'Unclassified company expense',5:'17'}),row({2:'前回分口座振替金額',5:'-1000'})]));
  assert.equal(mappingImport.status,200);const mappingId=mappingImport.data.id;
  const mappingRoute='/api/finance/imports/'+mappingId+'/mapping';
  assert.equal((await call(mappingRoute)).status,401);assert.equal((await call(mappingRoute,{token:other})).status,404);
  assert.equal((await call(mappingRoute,{token:deviceToken})).status,401);
  const unprepared=await call(mappingRoute,{token});assert.equal(unprepared.data.rows[0].purpose,'unresolved');
  const mappingBatch=await db.collection('financeimports').findOne({_id:new ObjectId(mappingId)});
  const preview={version:1,sourceHash:mappingBatch.hash,preparedAt:new Date().toISOString(),rows:mappingBatch.rows.map((r,i)=>({line:r.line,key:r.key,purpose:i<2?'customer':i===2?'company':'repayment',clientCode:i<2?'CLIENT-A':'',clientName:i<2?'Synthetic customer':'',category:i<2?'商品代金':'',reason:'Synthetic source reviewed for preview',source:{sheet:'data',rows:i<2?[10,11]:[i+10],client:i<2?'Synthetic customer':'',category:i<2?'商品代金':'',card:'Synthetic Amex'}}))};
  const mappingLedgerBefore=await db.collection('transactions').countDocuments(),mappingEntriesBefore=await db.collection('financeentries').countDocuments();
  await db.collection('financeimports').updateOne({_id:mappingBatch._id},{$set:{mappingPreview:preview}});
  const mapped=await call(mappingRoute,{token});assert.equal(mapped.status,200,JSON.stringify(mapped));
  assert.deepEqual(mapped.data.rows.map(r=>r.status),['proposed','proposed','needs_category','repayment']);
  assert.notEqual(mapped.data.rows[0].key,mapped.data.rows[1].key);assert.deepEqual(mapped.data.rows[0].source.rows,[10,11]);assert.equal(mapped.data.rows[2].clientCode,'');
  assert.equal(mapped.data.rows[0].purchaseDate,'2026-08-01');assert.equal(mapped.data.rows[0].processingDate,'2026-08-03');
  assert.equal((await call(mappingRoute,{token})).data.rows.length,4);
  assert.equal((await request('imports/'+mappingId+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);
  assert.equal(await db.collection('transactions').countDocuments(),mappingLedgerBefore);assert.equal(await db.collection('financeentries').countDocuments(),mappingEntriesBefore);
  assert.deepEqual((await db.collection('financeimports').findOne({_id:mappingBatch._id})).rows,mappingBatch.rows);
  assert.equal((await request('imports',undefined,'GET')).data.imports.some(b=>b.mappingPreview),false);
  await db.collection('financeimports').updateOne({_id:mappingBatch._id},{$set:{'mappingPreview.sourceHash':'incorrect'}});
  assert.equal((await call(mappingRoute,{token})).status,409);
  await db.collection('financeimports').updateOne({_id:mappingBatch._id},{$set:{mappingPreview:preview}});
  pass('mapping is owner-scoped, persistent, source-bound and preserves repeated purchases; preview cannot post incomplete ledger classifications');
  if(process.env.OMF_TEST_CHROME_PORT){
   const {createRequire}=require('node:module');const collectorRequire=createRequire(path.join(root,'collector/package.json'));const p=collectorRequire('rebrowser-puppeteer-core');
   const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
   try{
    page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
    await page.evaluate(()=>localStorage.setItem('theme','light'));await page.reload({waitUntil:'networkidle2'});
    const waitFor=async fn=>{for(let i=0;i<100;i++){if(await page.evaluate(fn))return;await pause(100);}throw Error('Browser condition timed out');};
    await page.evaluate(()=>document.querySelector('#email').focus());await page.keyboard.type('finance-a@example.invalid');await page.evaluate(()=>document.querySelector('#password').focus());await page.keyboard.type('Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type="submit"]').click());await waitFor(()=>location.pathname==='/');
    await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('main h1'));
    const designStyles=()=>{const title=getComputedStyle(document.querySelector('main h1')),card=getComputedStyle(document.querySelector('main .rounded-2xl, main .card'));return {fontSize:title.fontSize,fontWeight:title.fontWeight,fontFamily:title.fontFamily,titleColor:title.color,cardBackground:card.backgroundColor,cardBorder:card.borderColor,cardRadius:card.borderRadius};};
    const referenceDesign=await page.evaluate(designStyles);assert.equal(referenceDesign.cardBackground,'rgb(255, 255, 255)');
    if(process.env.OMF_TEST_SCREENSHOT){await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-transactions-reference.png'),fullPage:true});await page.setViewport({width:390,height:844});}
    await page.goto(origin+'/connections',{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('.account-grid section'));
    const result=await page.evaluate(()=>({title:document.querySelector('.connections h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,accounts:document.querySelectorAll('.account-grid section').length}));assert.equal(result.title,'カード連携');assert.equal(result.accounts,1);assert.equal(result.overflow,false);
    await page.evaluate(id=>document.querySelector('[data-import-id="'+id+'"]').click(),overlapping.data.id);await waitFor(()=>!!document.querySelector('.review-list article select'));
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.review-list article').length),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.goto(origin+'/mapping?import='+mappingId,{waitUntil:'networkidle2'});await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(await page.evaluate(designStyles),referenceDesign,'Mapping must use the transaction page typography and shared card surfaces');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.mapping')).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-filter="review"] strong').textContent),'1件');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.repeat').length),2);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-tax-review]').length),3);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-invoice-review]').length),3);
    await page.evaluate(()=>document.querySelector('[data-source-categories]').click());await waitFor(()=>!document.querySelector('[data-source-categories]'));
    assert.equal(await db.collection('transactions').countDocuments(),mappingLedgerBefore);
    await page.evaluate(()=>document.querySelector('[data-preparation-filter="preparation:accounting"]').click());await waitFor(()=>document.querySelectorAll('.mapping-list article').length===2);
    assert.ok((await page.evaluate(()=>document.querySelector('[data-tax-review]').textContent)).includes('未設定'));
    assert.ok((await page.evaluate(()=>document.querySelector('[data-invoice-review]').textContent)).includes('未取得'));
    await page.evaluate(()=>document.querySelector('[data-filter="all"]').click());await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);
    pass('real Chrome: source category registration, preparation filters, invoice numbers and consumption-tax gaps are visible');

    await page.evaluate(()=>document.querySelector('[data-filter="review"]').click());await waitFor(()=>document.querySelectorAll('.mapping-list article').length===1);
    assert.ok((await page.evaluate(()=>document.querySelector('.mapping-list article').textContent)).includes('Unclassified company expense'));
    await page.evaluate(()=>document.querySelector('[data-filter="all"]').click());await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);
    await page.evaluate(()=>document.querySelector('input[type="search"]').focus());await page.keyboard.type('CLIENT-A');await waitFor(()=>document.querySelectorAll('.mapping-list article').length===2);
    await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);
    await page.evaluate(()=>document.querySelector('details.evidence').open=true);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-mapping-mobile.png'),captureBeyondViewport:false});await page.evaluate(()=>document.querySelector('.mapping-list').scrollIntoView());await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-mapping-mobile-rows.png'),captureBeyondViewport:false});}
    await page.reload({waitUntil:'networkidle2'});await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);
    await page.setViewport({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.evaluate(()=>document.querySelector('header.sticky button.p-1').click());await waitFor(()=>document.documentElement.classList.contains('dark'));
    await page.evaluate(()=>Promise.all(document.querySelector('main .rounded-2xl, main .card').getAnimations().map(animation=>animation.finished)));const darkDesign=await page.evaluate(designStyles);assert.notEqual(darkDesign.cardBackground,referenceDesign.cardBackground);assert.notEqual(darkDesign.titleColor,referenceDesign.titleColor);
    if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-dark.png'),fullPage:true});
    await page.reload({waitUntil:'networkidle2'});await waitFor(()=>document.querySelectorAll('.mapping-list article').length===4);assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),true);
    await page.evaluate(()=>document.querySelector('header.sticky button.p-1').click());await waitFor(()=>!document.documentElement.classList.contains('dark'));await page.evaluate(()=>Promise.all(document.querySelector('main .rounded-2xl, main .card').getAnimations().map(animation=>animation.finished)));assert.deepEqual(await page.evaluate(designStyles),referenceDesign);
    pass('real Chrome: mapping matches transaction typography and cards, follows the app theme toggle and preserves the theme after reload');
    pass('real Chrome: mapping filters, search, evidence, reload and mobile/desktop layouts work');
    if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});pass('real Chrome: mobile login, account list and transaction review render without horizontal overflow');
   }finally{if(page)await page.close();await browser.disconnect();}
  }
  await require('./finance-draft-integration.cjs')({ db, call, request, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-review-integration.cjs')({ db, call, request, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-learning-integration.cjs')({ db, call, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-answers-integration.cjs')({ db, call, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-chat-integration.cjs')({ db, call, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-assistant-integration.cjs')({ db, call, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-dialogue-integration.cjs')({ db, call, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-preparation-integration.cjs')({ db, call, request, upload, token, other, deviceToken, pass, csv, row });
  await require('./finance-supplier-integration.cjs')({ db, call, request, upload, token, other, deviceToken, origin, pass, root, csv, row, pause });
  await require('./finance-accounting-integration.cjs')({ db, call, request, upload, token:unselectedToken, other, origin, pass, root, csv, row, pause });
  await require('./finance-purchase-accounts-integration.cjs')({ db, call, request, token, other, origin, pass, root, csv, row });
  await require('./finance-accounting-assessment-integration.cjs')({ db, call, request, token, other, origin, pass, root, csv, row });
  await require('./finance-customer-context-integration.cjs')({ db, call, request, token, other, origin, pass, root, csv, row });
  await require('./finance-document-evidence-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});
  await require('./finance-customer-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});
  await require('./finance-service-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});
  await require('./finance-inventory-review-integration.cjs')({db,call,request,token,other,origin,pass,root,csv,row});
  await require('./finance-aplus-integration.cjs')({db,call,request,token:unselectedToken,other,pass,root,origin});
  await require('./finance-purchase-links-integration.cjs')({db,call,upload,token,other,deviceToken,origin,pass,csv,row});
  await recentJobs({db,call,request,token,other,pass,csv,row});
  console.log(`${checks} finance integration checks passed`);
 }catch(error){console.error(error);console.error(logs.slice(-3500));process.exitCode=1;}
 finally{
  if(!ASSISTANT_ONLY){if(child && child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}if(client)await client.close();if(mongo)await mongo.stop();if(directory){if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await fsp.rm(directory,{recursive:true,force:true});}}
  else{
   // Assistant-only owned cleanup (as in finance-navi-status-integration.cjs): every step runs even when an earlier one fails, each
   // problem is printed (CLEANUP) and none replaces the run's own result printed above; a problem still fails the run. After the memory
   // server's own stop attempt, wait for its mongod to disappear and remove only its own temporary dbPath; never send another signal
   // through an old numeric PID.
   const problems=[],step=async(name,fn)=>{try{await fn()}catch(e){problems.push(name+': '+String(e?.message||e).slice(0,300))}};
   await step('app',async()=>{if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}});
   await step('client',async()=>{if(client)await client.close()});
   await step('mongod',async()=>{if(!mongo)return;const info=mongo.instanceInfo,pid=info?.instance?.mongodProcess?.pid,dbDir=info?.tmpDir;
    try{await mongo.stop();return}catch(e){console.error('CLEANUP mongod stop slow: '+String(e?.message||e).slice(0,200))}
    const alive=()=>{try{process.kill(pid,0);return true}catch{return false}},started=Date.now();
    while(pid&&alive()&&Date.now()-started<SETUP_READY_MS)await pause(500);
    if(pid&&alive())throw Error('owned mongod '+pid+' still running after '+(Date.now()-started)+' ms');
    if(dbDir){assert.equal(path.dirname(dbDir),os.tmpdir());assert.ok(path.basename(dbDir).startsWith('mongo-mem-'));await fsp.rm(dbDir,{recursive:true,force:true,maxRetries:10,retryDelay:500})}
    console.error('CLEANUP mongod gone after '+(Date.now()-started)+' ms; its dbPath removed')});
   await step('data',async()=>{if(directory){if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await fsp.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500})}});
   console.log('TIMING '+JSON.stringify({...setupTiming,requestBudgetMs:REQUEST_BUDGET_MS,slowestRequestMs:slowest.ms,slowestRequest:slowest.request}));
   for(const p of problems)console.error('CLEANUP '+p);
   if(problems.length){console.error('SETUP owned cleanup failed: '+problems.join(' | '));process.exitCode=1}
  }
 }
}
main();

'use strict';
// Saved-record consultation (plan omf-navi-agent-selection-20261022, docs/navi-selected-records.md). Actual built native HTTP on an
// owned loopback app and an owned MongoMemoryServer; synthetic people, companies and saved records only. Worker claims and replies are
// simulated through the native worker routes: no model, provider, mail, bank, Slack or production address is reached. Each assertion
// label names the behaviour a defect must break; labels starting with SETUP are preparation, never evidence. Direct database writes are
// named synthetic setup only (an issuer card bill). Every group owns its people and records, so a subset run
// (OMF_NAVI_SELECTION_ONLY=<group,...>, the fixture's defect legs) starts from the same state as the full run. A failed group is printed
// (FAIL <group>) and the remaining groups still run; any failure fails the run.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_NAVI_SELECTION_APP_ROOT||path.join(__dirname,'..'));
const NATIVE=['target'],GUI=['gui-consult','gui-lifecycle','gui-view','gui-delete','gui-missing'];
const ONLY=String(process.env.OMF_NAVI_SELECTION_ONLY||'').split(',').map(s=>s.trim()).filter(Boolean);
for(const g of ONLY)if(![...NATIVE,...GUI].includes(g))throw Error('SETUP unknown group '+g);
const wants=g=>!ONLY.length||ONLY.includes(g);
// SETUP readiness only: on a loaded machine (other work at full CPU while this runs at idle priority) the owned throwaway mongod, app
// and Chrome can take minutes to start. Each start is measured and printed (TIMING); no behaviour assertion uses this window.
const SETUP_READY_MS=300000;
const DB='navi_selection_regression',PASSWORD='Synthetic-password-Only1!';
const COMPANY='/api/finance-chat/company-workspace';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),hex32=()=>crypto.randomBytes(16).toString('hex');
const localDay=(offset=0)=>{const d=new Date(Date.now()+offset*86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

async function main(){
 let mongo,client,child,directory,browserRunner,logs='',groups=0;const cases=new Set(),timing={},failures=[];
 const pass=name=>{groups++;console.log('PASS '+name)},seen=label=>cases.add(label);
 // A group failure is kept with its full error; the next group still runs (each owns its own people and records).
 const group=async(name,fn)=>{if(!wants(name))return;try{await fn()}catch(e){failures.push(name);console.log('FAIL '+name+': '+String(e?.message||e).split('\n')[0].slice(0,600));console.log(String(e?.stack||e).slice(0,4000))}};
 try{
  if(GUI.some(wants)){const before=Date.now();browserRunner=require('./finance-navi-selection-browser.cjs');browserRunner.prepare();timing.browserDependencyMs=Date.now()-before}
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-selection-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  // SETUP the throwaway mongod gets the measured readiness window instead of the library's 10 s default.
  let started=Date.now();
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});const uri=mongo.getUri(DB);timing.mongoMs=Date.now()-started;
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',GEMINI_API_KEY:'',ANTHROPIC_API_KEY:'disabled-synthetic-selection-test',OPENAI_API_KEY:'disabled-synthetic-selection-test',SLACK_BOT_TOKEN:'disabled-synthetic-selection-test',BASE_URL:origin,OMF_COLLECTOR_PUBLIC_ORIGIN:'',OMF_TRUST_CLOUDFLARE_LOOPBACK:''},stdio:['ignore','pipe','pipe']});
  child.closed=new Promise(r=>child.once('exit',r));for(const s of[child.stdout,child.stderr]){s.setEncoding('utf8');s.on('data',v=>{logs=(logs+v).slice(-20000)})}
  let healthy=false;started=Date.now();
  while(!healthy&&Date.now()-started<SETUP_READY_MS){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,DB,'SETUP owned database');healthy=true}}catch(e){if(e?.code==='ERR_ASSERTION')throw e}if(!healthy)await pause(500)}
  timing.appMs=Date.now()-started;
  assert.ok(healthy,'SETUP owned app unavailable after '+timing.appMs+' ms: '+logs.slice(-3000));
  console.log('TIMING '+JSON.stringify(timing));
  client=await MongoClient.connect(uri);const db=client.db(DB);
  const companies=db.collection('financecompanyassistants'),orgs=db.collection('organizations'),agents=db.collection('financechatagents');
  const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'SETUP '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  // People, companies, cards and workers. The app allows five sign-ups a minute from one address: a 429 waits the time it names.
  const now=new Date(),member=(u,role)=>({userId:u.id,role,joinedAt:now});
  const register=async(slug,name)=>{const email='selection-'+slug+'@example.invalid';let r;for(let attempt=0;;attempt++){r=await call('/api/auth/register',null,'POST',{email,password:PASSWORD,name});if(r.status!==429||attempt>=3)break;await pause((Number((r.raw.match(/in (\d+) seconds/)||[])[1])||60)*1000+1000)}
   assert.equal(r.status,200,'SETUP POST /api/auth/register '+r.raw.slice(0,300));const u=await db.collection('users').findOne({email});return{id:u._id,email,password:PASSWORD,token:r.data.tokens.accessToken}};
  const company=async(slug,name,members)=>{const _id=new ObjectId();await orgs.insertOne({_id,name,slug:'selection-'+slug,type:'business',isActive:true,members,createdAt:now,updatedAt:now});return _id};
  const switchTo=async(u,org)=>(await ok('/api/auth/switch-organization',u.token,'POST',{organizationId:String(org)})).tokens.accessToken;
  const card=async(u,number)=>{const a=(await ok('/api/finance/accounts',u.token,'POST',{name:'Synthetic card '+number,primaryCard:number,cardIdentifiers:[number],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;a.number=number;return a};
  const workerOf=async(u,accounts,flags)=>{const a=await ok('/api/finance-chat/agents',u.token,'POST',{accountIds:accounts.map(x=>String(x._id)),...flags});return{id:a.id,_id:new ObjectId(a.id),token:a.token}};
  const chatWorker=(w,route,body={})=>call('/api/finance-chat/worker/'+route,w.token,'POST',body);
  const beat=async w=>assert.equal((await chatWorker(w,'heartbeat')).status,200,'SETUP heartbeat');
  const reply=summary=>({kind:'unclear',summary,patch:{},quotes:{}});
  const claim=async(w,label)=>{await beat(w);const r=await chatWorker(w,'workspace-claim',{});assert.equal(r.status,200,'SETUP claim '+r.raw.slice(0,300));assert.ok(r.data.job,label);return r.data.job};
  const answered=async(w,job,summary)=>{const r=await chatWorker(w,'workspace/'+job.id+'/result',{lease:job.lease,proposal:reply(summary)});assert.equal(r.status,200,'SETUP reply '+r.raw.slice(0,300))};
  const act=(w,job,name,args,slot)=>chatWorker(w,'workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  // A company send exactly as the conversation component posts it (the current revision, a fresh request id unless one is given).
  const send=async(token,text,context,requestId=hex32())=>{const view=await ok(COMPANY,token);const r=await call(COMPANY,token,'POST',{requestId,chatRevision:view.conversation?.revision||0,text,context});return{requestId,r}};
  const conversation=(u,org)=>companies.findOne({ownerId:u.id,organizationId:new ObjectId(String(org))});
  const turnOf=(doc,id)=>doc?.turns?.find(t=>t.id===id);
  // Saved records through the same native routes the pages use.
  let invoiceSeq=0;
  const invoice=async(token,number,extra={})=>{const r=await ok('/api/invoices',token,'POST',{invoiceNumber:number||('SEL-INV-'+String(++invoiceSeq).padStart(3,'0')),from:{name:'Synthetic issuer'},to:{name:'Synthetic client '+(number||invoiceSeq)},items:[{description:'Synthetic work',quantity:1,unitPrice:1000}],taxRate:10,currency:'JPY',issueDate:'2026-10-20',dueDate:'2026-11-30',status:'sent',...extra});return String(r.invoice.id||r.invoice._id)};
  const budget=async(token,name)=>String((await ok('/api/budgets',token,'POST',{name,amount:50000,currency:'JPY',period:'monthly',alertThreshold:80,isActive:true})).budget.id);
  const recurring=async(token,name)=>String((await ok('/api/recurring',token,'POST',{name,amount:3000,currency:'JPY',transactionType:'支出',frequency:'monthly',startDate:localDay(),customer:{name:'Synthetic payee'},autoGenerate:false})).payment.id);
  const payment=async(token,title,dueDate=localDay())=>{const r=await ok('/api/payments',token,'POST',{title,amount:1200,currency:'JPY',dueDate,type:'expense',category:'Utilities',status:'pending'});return String(r.id||r._id)};
  // SETUP synthetic issuer card bill (a card-statement source the native delete suppresses instead of erasing).
  const issuerBill=async(org,title,dueDate=localDay())=>{const _id=new ObjectId();await db.collection('payments').insertOne({_id,organizationId:new ObjectId(String(org)),title,amount:4321,currency:'JPY',dueDate:new Date(dueDate+'T12:00:00.000Z'),type:'expense',status:'pending',category:'Term Credit Card',recurring:false,createdAt:now,updatedAt:now,source:{kind:'card-statement',provider:'aplus',accountId:new ObjectId(),periodKey:dueDate.slice(0,7),statementMonth:dueDate.slice(0,7),adopted:true,statementTotal:4321,dueDateEvidence:'issuer-mail'}});return String(_id)};
  const ctx={db,ObjectId,origin,root,call,ok,register,company,switchTo,card,workerOf,chatWorker,beat,reply,claim,answered,act,send,conversation,turnOf,invoice,budget,recurring,payment,issuerBill,localDay,pause,hex32,pass,seen,wants,group,companies,orgs,agents,member,COMPANY,timing,SETUP_READY_MS};

  // 1. Native target: budgetId only on the budgets page and recurringPaymentId only on the recurring page are frozen in the turn and
  //    handed to the claiming worker exactly; a record of another company, a removed record or the wrong page is refused before anything
  //    is stored. A missing selected or pinned record (all six kinds and the pinned evidence) is a marked refusal that keeps the reader's
  //    status text, while every other refusal stays unmarked. An accepted request id is still recognised after its record is removed.
  await group('target',async()=>{
   const P=await register('target-owner','Synthetic selection owner'),Q=await register('target-member','Synthetic selection member');
   const A=await company('target-a','Synthetic selection A',[member(P,'owner'),member(Q,'member')]),B=await company('target-b','Synthetic selection B',[member(P,'owner')]);
   const pa=await switchTo(P,A),pb=await switchTo(P,B),qa=await switchTo(Q,A);
   const WP=await workerOf(P,[await card(P,'81111')],{workspaceEnabled:true}),WQ=await workerOf(Q,[await card(Q,'82222')],{workspaceEnabled:true});await beat(WP);await beat(WQ);
   const bA=await budget(pa,'SELECTION_BUDGET_A'),bB=await budget(pb,'SELECTION_BUDGET_B'),rA=await recurring(pa,'SELECTION_RECURRING_A'),rB=await recurring(pb,'SELECTION_RECURRING_B');
   const iA=await invoice(pa,'SEL-TARGET-A'),pA=await payment(pa,'SELECTION_PAYMENT_A');
   const marked=r=>r.status===404&&r.data?.data?.selectedRecordMissing===true;
   // Budget and recurring payment pointers on their own pages.
   let s=await send(pa,'SELECTION budget question',{page:'budgets',budgetId:bA});
   assert.equal(s.r.status,200,'selection:budget-accepted '+s.r.status+' '+s.r.raw.slice(0,300));
   assert.deepEqual({...turnOf(await conversation(P,A),s.requestId)?.target},{page:'budgets',budgetId:bA},'selection:budget-target');
   let job=await claim(WP,'SETUP budget claim');assert.deepEqual({...job.target},{page:'budgets',budgetId:bA},'selection:budget-claim-target');assert.deepEqual({...job.context.facts.selection},{page:'budgets',budgetId:bA},'selection:budget-claim-target');
   await answered(WP,job,'SELECTION budget reply');seen('target|budget');
   s=await send(pa,'SELECTION recurring question',{page:'recurring',recurringPaymentId:rA});
   assert.equal(s.r.status,200,'selection:recurring-accepted '+s.r.status+' '+s.r.raw.slice(0,300));
   assert.deepEqual({...turnOf(await conversation(P,A),s.requestId)?.target},{page:'recurring',recurringPaymentId:rA},'selection:recurring-target');
   job=await claim(WP,'SETUP recurring claim');assert.deepEqual({...job.target},{page:'recurring',recurringPaymentId:rA},'selection:recurring-claim-target');await answered(WP,job,'SELECTION recurring reply');seen('target|recurring');
   // A company member consults the same company record (company scope, not the creator).
   s=await send(qa,'SELECTION member budget question',{page:'budgets',budgetId:bA});assert.equal(s.r.status,200,'selection:member-company-scope '+s.r.raw.slice(0,200));
   job=await claim(WQ,'SETUP member claim');assert.deepEqual({...job.target},{page:'budgets',budgetId:bA},'selection:member-company-scope');await answered(WQ,job,'SELECTION member reply');seen('target|member');
   // Wrong pages and malformed ids are refused before anything is stored, without the missing-record mark.
   const before=await conversation(P,A);
   for(const page of['invoices','calendar','recurring','transactions','dashboard']){const r=(await send(pa,'SELECTION wrong page',{page,budgetId:bA})).r;assert.equal(r.status,400,'selection:budget-page-only '+page+' '+r.status);assert.ok(!marked(r),'selection:marker-only-missing')}
   for(const page of['invoices','calendar','budgets','transactions']){const r=(await send(pa,'SELECTION wrong page',{page,recurringPaymentId:rA})).r;assert.equal(r.status,400,'selection:recurring-page-only '+page+' '+r.status)}
   for(const bad of['not-an-id',12345,'',null,bA+'0',{id:bA}]){let r=(await send(pa,'SELECTION bad id',{page:'budgets',budgetId:bad})).r;assert.equal(r.status,400,'selection:id-syntax budget '+JSON.stringify(bad)+' '+r.status);r=(await send(pa,'SELECTION bad id',{page:'recurring',recurringPaymentId:bad})).r;assert.equal(r.status,400,'selection:id-syntax recurring '+JSON.stringify(bad)+' '+r.status)}
   seen('target|page-and-syntax');
   // Another company's records, under this company's session: refused at the scoped native readers, marked, nothing queued.
   let r=(await send(pa,'SELECTION foreign budget',{page:'budgets',budgetId:bB})).r;assert.equal(r.status,404,'selection:budget-foreign-refused '+r.status+' '+r.raw.slice(0,200));assert.ok(marked(r),'selection:missing-marked '+r.raw.slice(0,300));
   r=(await send(pa,'SELECTION foreign recurring',{page:'recurring',recurringPaymentId:rB})).r;assert.equal(r.status,404,'selection:recurring-foreign-refused '+r.status+' '+r.raw.slice(0,200));assert.ok(marked(r),'selection:missing-marked');
   assert.equal(r.data?.statusMessage,'Recurring payment not found','selection:status-message '+r.raw.slice(0,200));
   let after=await conversation(P,A);assert.equal(after.revision,before.revision,'selection:refused-not-stored');assert.equal(after.turns.length,before.turns.length,'selection:refused-not-stored');assert.ok(!['queued','working'].includes(after.state),'selection:refused-not-stored');seen('target|foreign');
   // The same records are still accepted in their own company.
   s=await send(pb,'SELECTION own company budget',{page:'budgets',budgetId:bB});assert.equal(s.r.status,200,'selection:own-company-accepted '+s.r.raw.slice(0,200));job=await claim(WP,'SETUP company B claim');assert.equal(String(job.target.budgetId),bB,'selection:own-company-accepted');await answered(WP,job,'SELECTION company B reply');
   // A record removed through its native page route is refused and marked.
   const bGone=await budget(pa,'SELECTION_BUDGET_GONE'),rGone=await recurring(pa,'SELECTION_RECURRING_GONE');await ok('/api/budgets/'+bGone,pa,'DELETE');await ok('/api/recurring/'+rGone,pa,'DELETE');
   r=(await send(pa,'SELECTION removed budget',{page:'budgets',budgetId:bGone})).r;assert.ok(marked(r),'selection:budget-removed-refused '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data?.statusMessage,'Budget not found','selection:status-message');
   r=(await send(pa,'SELECTION removed recurring',{page:'recurring',recurringPaymentId:rGone})).r;assert.ok(marked(r),'selection:recurring-removed-refused '+r.status);seen('target|removed');
   // The existing pointers keep their native checks and messages; their missing records are marked the same way.
   s=await send(pa,'SELECTION invoice question',{page:'invoices',invoiceId:iA});assert.equal(s.r.status,200,'selection:existing-pointers invoice '+s.r.raw.slice(0,200));job=await claim(WP,'SETUP invoice claim');assert.deepEqual({...job.target},{page:'invoices',invoiceId:iA},'selection:existing-pointers');await answered(WP,job,'SELECTION invoice reply');
   s=await send(pa,'SELECTION payment question',{page:'calendar',paymentId:pA});assert.equal(s.r.status,200,'selection:existing-pointers payment '+s.r.raw.slice(0,200));job=await claim(WP,'SETUP payment claim');assert.deepEqual({...job.target},{page:'calendar',paymentId:pA},'selection:existing-pointers');await answered(WP,job,'SELECTION payment reply');
   const iGone=await invoice(pa,'SEL-TARGET-GONE');await ok('/api/invoices/'+iGone,pa,'DELETE');
   const unknown=new ObjectId().toHexString(),missing=[[{page:'invoices',invoiceId:iGone},'Invoice not found'],[{page:'calendar',paymentId:unknown},'Payment not found'],[{page:'transactions',transactionId:unknown},'Transaction not found'],[{page:'receipts',receiptId:unknown},'Receipt not found'],[{page:'invoices',inspected:{kind:'archive',id:unknown}},'Archived conversation not found'],[{page:'invoices',inspected:{kind:'knowledge',id:unknown}},'Company teaching not found']];
   for(const [context,message] of missing){r=(await send(pa,'SELECTION missing existing pointer',context)).r;assert.ok(marked(r),'selection:existing-missing-marked '+JSON.stringify(context)+' '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data?.statusMessage,message,'selection:status-message '+JSON.stringify(context))}
   after=await conversation(P,A);assert.equal(after.turns.length,before.turns.length+2,'selection:refused-not-stored');seen('target|existing-pointers');
   // Request identity: an accepted id keeps its frozen target; after its record is removed the same id is still recognised (the
   // accepted turn answers before any record check), so the mark never covers an accepted request.
   const bLater=await budget(pa,'SELECTION_BUDGET_LATER'),bOther=await budget(pa,'SELECTION_BUDGET_OTHER');
   s=await send(pa,'SELECTION frozen question',{page:'budgets',budgetId:bLater});assert.equal(s.r.status,200,'SETUP frozen send '+s.r.raw.slice(0,200));
   const view=await ok(COMPANY,pa);
   r=await call(COMPANY,pa,'POST',{requestId:s.requestId,chatRevision:view.conversation.revision,text:'SELECTION frozen question',context:{page:'budgets',budgetId:bOther}});assert.equal(r.status,409,'selection:request-frozen '+r.status);assert.ok(!marked(r),'selection:marker-only-missing');
   r=(await send(pa,'SELECTION while queued',{page:'budgets',budgetId:bOther})).r;assert.equal(r.status,409,'selection:queued-refusal '+r.status);assert.ok(!marked(r),'selection:marker-only-missing');
   await ok('/api/budgets/'+bLater,pa,'DELETE');
   r=await call(COMPANY,pa,'POST',{requestId:s.requestId,chatRevision:view.conversation.revision,text:'SELECTION frozen question',context:{page:'budgets',budgetId:bLater}});assert.equal(r.status,200,'selection:accepted-before-check '+r.status+' '+r.raw.slice(0,200));
   job=await claim(WP,'SETUP frozen claim');assert.deepEqual({...job.target},{page:'budgets',budgetId:bLater},'selection:frozen-claim-target');await answered(WP,job,'SELECTION frozen reply');seen('target|request-identity');
   pass('native target: budget/recurring pointers only on their own pages, frozen and claimed exactly; foreign, removed and wrong-page records refused before storage; missing selected/pinned records marked with their native messages; accepted ids recognised');
  });

  // 2-6. Installed Chrome against the same app (scripts/finance-navi-selection-browser.cjs).
  if(browserRunner)await browserRunner(ctx);
  console.log('SUMMARY '+JSON.stringify({groups,failures,only:ONLY,cases:[...cases].sort(),timing}));
  console.log(groups+' Navi selection groups passed');
 }catch(error){failures.push('setup');console.log('FAIL setup: '+String(error?.message||error).split('\n')[0].slice(0,600));console.log(String(error?.stack||error).slice(0,4000));console.log('APP_LOG '+JSON.stringify({exitCode:child?.exitCode??null,signal:child?.signalCode??null,tail:logs.slice(-4000)}))}
 // Owned cleanup: every step runs even when an earlier one fails, each problem is printed (CLEANUP), and none can replace the run's
 // own result. After the library's stop attempt, wait for the process to disappear and remove only its own temporary dbPath.
 const problems=[],step=async(name,fn)=>{try{await fn()}catch(e){problems.push(name+': '+String(e?.message||e).slice(0,300))}};
 await step('app',async()=>{if(child){child.kill();await child.closed}});
 await step('client',async()=>{if(client)await client.close()});
 await step('mongod',async()=>{if(!mongo)return;const info=mongo.instanceInfo,pid=info?.instance?.mongodProcess?.pid,dbDir=info?.tmpDir;
  try{await mongo.stop();return}catch(e){console.log('CLEANUP mongod stop slow: '+String(e?.message||e).slice(0,200))}
  const alive=()=>{try{process.kill(pid,0);return true}catch{return false}},started=Date.now();
  while(pid&&alive()&&Date.now()-started<SETUP_READY_MS)await pause(500);
  if(pid&&alive())throw Error('owned mongod '+pid+' still running after '+(Date.now()-started)+' ms');
  if(dbDir){assert.equal(path.dirname(dbDir),os.tmpdir());assert.ok(path.basename(dbDir).startsWith('mongo-mem-'));await fsp.rm(dbDir,{recursive:true,force:true,maxRetries:10,retryDelay:500})}
  console.log('CLEANUP mongod gone after '+(Date.now()-started)+' ms; its dbPath removed')});
 await step('data',async()=>{if(directory){assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-navi-selection-'));await fsp.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500})}});
 for(const p of problems)console.log('CLEANUP '+p);
 if(failures.length)throw Error('Navi selection groups failed: '+failures.join(', '));
 if(problems.length)throw Error('SETUP owned cleanup failed: '+problems.join(' | '));
}
main().catch(e=>{console.error(e);process.exitCode=1});

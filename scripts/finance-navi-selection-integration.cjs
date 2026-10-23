'use strict';
// Saved-record consultation (plan omf-navi-agent-selection-20261022, docs/navi-selected-records.md). Actual built native HTTP on an
// owned loopback app and an owned MongoMemoryServer; synthetic people, companies and saved records only. Worker claims and replies are
// simulated through the native worker routes: no model, provider, mail, bank, Slack or production address is reached. Each assertion
// label names the behaviour a defect must break; labels starting with SETUP are preparation, never evidence. Direct database writes are
// named synthetic setup only (an issuer card bill, an unadopted archive copy and an action still claimed under a recent lease). Every
// group owns its people and records, so a subset run
// (OMF_NAVI_SELECTION_ONLY=<group,...>, the fixture's defect legs) starts from the same state as the full run. A failed group is printed
// (FAIL <group>) and the remaining groups still run; any failure fails the run.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_NAVI_SELECTION_APP_ROOT||path.join(__dirname,'..'));
const NATIVE=['target','request'],GUI=['gui-consult','gui-lifecycle','gui-view','gui-delete','gui-missing','gui-pending','gui-received'];
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

  // 2. Request identity across New chat (plan omf-navi-agent-pending-exit-20261023, docs/navi-selected-records.md). An accepted request
  //    id stays the same request after New chat moved its turn to an adopted archive of this actor/company conversation: the same
  //    meaning returns that archived turn with its receipts and is never queued or executed again; another meaning keeps the 409. An
  //    unadopted copy, another company's or another actor's archive is never evidence (the same id is a fresh request there), and a new
  //    id with identical words is a new request. A New chat may name the client's uncertain request: it answers accepted (with the
  //    archived result) or, only after its own revision fence (also on an empty or absent conversation), not accepted, and an older
  //    attempt is refused afterwards. A lost reset reply is recognised only with the same meaning and fences again; busy, claimed and
  //    stale resets are refused and fence nothing; a send and a New chat racing have exactly one winner. Worker claims and actions are
  //    controlled native sequences (simulated worker), never a model decision or a production duplicate; the only effects are internal
  //    synthetic calendar plans, no money movement.
  await group('request',async()=>{
   const P=await register('request-owner','Synthetic request owner'),Q=await register('request-member','Synthetic request member');
   const A=await company('request-a','Synthetic request A',[member(P,'owner'),member(Q,'member')]),B=await company('request-b','Synthetic request B',[member(P,'owner')]);
   const C=await company('request-c','Synthetic request C',[member(P,'owner')]),D=await company('request-d','Synthetic request D',[member(P,'owner')]);
   const pa=await switchTo(P,A),pb=await switchTo(P,B),pc=await switchTo(P,C),pd=await switchTo(P,D),qa=await switchTo(Q,A);
   const WP=await workerOf(P,[await card(P,'73333')],{workspaceEnabled:true}),WQ=await workerOf(Q,[await card(Q,'74444')],{workspaceEnabled:true});await beat(WP);await beat(WQ);
   const archives=db.collection('financecompanyconversationarchives'),plans=title=>db.collection('payments').countDocuments({title});
   const view=token=>ok(COMPANY,token),post=async(token,body)=>{await beat(WP);await beat(WQ);return call(COMPANY,token,'POST',body)},reset=(token,body)=>call(COMPANY+'/new',token,'POST',body);
   const scopeOf=(u,org)=>({actorId:String(u.id),organizationId:String(org)});
   const idle=async(w,label)=>{await beat(w);const r=await chatWorker(w,'workspace-claim',{});assert.equal(r.status,200,'SETUP claim '+r.raw.slice(0,200));assert.equal(r.data.job,null,label)};
   const everStored=async(u,org,requestId)=>{const c=await conversation(u,org);return (c?.turns||[]).some(t=>t.id===requestId)||(c?await archives.countDocuments({conversationId:c._id,'turns.id':requestId}):0)>0};
   // (a) The accepted request id again after New chat archived its turn (same id, words and selection).
   const requestId=hex32(),requestText='支払カレンダーにREQUEST_ARCHIVE_ONCE、800円、今日、支出、事務費を1件登録してください。',requestContext={page:'calendar'};
   const planArgs={title:'REQUEST_ARCHIVE_ONCE',amount:800,currency:'JPY',dueDate:localDay(),type:'expense',category:'事務費'};
   let v=await view(pa),r=await post(pa,{requestId,text:requestText,context:requestContext,chatRevision:v.conversation?.revision||0});assert.equal(r.status,200,'SETUP first request '+r.raw.slice(0,200));
   let job=await claim(WP,'SETUP first job');const firstPlan=await act(WP,job,'create_company_calendar_entry',planArgs,3);assert.equal(firstPlan.status,200,'SETUP first plan '+firstPlan.raw.slice(0,200));await answered(WP,job,'REQUEST first plan saved');
   assert.equal(await plans(planArgs.title),1,'SETUP one first plan');
   v=await view(pa);r=await reset(pa,{chatRevision:v.conversation.revision,requestId:hex32()});assert.equal(r.status,200,'SETUP ordinary New chat '+r.raw.slice(0,200));
   assert.equal(r.data.conversation.turns.length,0,'request:ordinary-reset-unchanged');assert.equal(r.data.reset,undefined,'request:ordinary-reset-unchanged '+JSON.stringify(r.data.reset));
   const archivedA=(await ok(COMPANY+'/history',pa)).archives[0];assert.equal(archivedA?.turnCount,1,'SETUP the first request archived');
   const beforeRetry=await conversation(P,A);
   const retry=await post(pa,{requestId,text:requestText,context:requestContext,chatRevision:beforeRetry.revision});
   // Controlled continuation, never a model decision: if a server queued the archived request again, a simulated worker runs it with
   // another valid slot and the identical arguments, so the test observes the effect a second claim would have.
   let replay=null;if(retry.status===200&&(await conversation(P,A)).state==='queued'){const again=await claim(WP,'SETUP replay job');replay=await act(WP,again,'create_company_calendar_entry',planArgs,4);await answered(WP,again,'REQUEST replay outcome')}
   const witness={retryStatus:retry.status,queuedAgain:!!replay,replayOperation:replay?.data?.receipt?.operationId||null,savedPlans:await plans(planArgs.title),received:retry.data?.received?{where:retry.data.received.where,archive:retry.data.received.archive?.id||null}:null};
   console.log('ARCHIVE_RETRY_WITNESS '+JSON.stringify(witness));
   assert.equal(witness.savedPlans,1,'native:archived-request-never-reexecutes '+JSON.stringify(witness));
   assert.equal(retry.status,200,'request:archived-recognised '+retry.raw.slice(0,300));
   const received=retry.data.received;
   assert.equal(received?.outcome,'accepted','request:archived-recognised '+JSON.stringify(received));assert.equal(received.where,'archive','request:archived-recognised');assert.equal(received.requestId,requestId,'request:archived-recognised');
   assert.equal(received.archive?.id,archivedA.id,'request:archived-reference '+JSON.stringify(received.archive));assert.deepEqual(received.scope,scopeOf(P,A),'request:archived-scope');
   assert.deepEqual(received.turn?.actions?.map(a=>[a.name,a.state,a.slot,a.operationId]),[['create_company_calendar_entry','done',3,firstPlan.data.receipt.operationId]],'request:archived-receipt '+JSON.stringify(received.turn));
   assert.equal(received.turn.replyState,'answered','request:archived-receipt');assert.equal(received.occurrences,1,'request:archived-receipt');
   const afterRetry=await conversation(P,A);assert.equal(afterRetry.revision,beforeRetry.revision,'request:archived-not-queued');assert.equal(afterRetry.turns.length,0,'request:archived-not-queued');assert.ok(!['queued','working'].includes(afterRetry.state),'request:archived-not-queued');
   await idle(WP,'request:archived-not-queued');seen('request|archived-retry');
   // (b) The same id with another meaning (other words, another selection) is refused as before; nothing is stored.
   r=await post(pa,{requestId,text:requestText+' 追加',context:requestContext,chatRevision:afterRetry.revision});assert.equal(r.status,409,'request:archived-meaning-conflict text '+r.status+' '+r.raw.slice(0,200));
   r=await post(pa,{requestId,text:requestText,context:{page:'dashboard'},chatRevision:afterRetry.revision});assert.equal(r.status,409,'request:archived-meaning-conflict target '+r.status+' '+r.raw.slice(0,200));
   assert.equal((await conversation(P,A)).revision,afterRetry.revision,'request:archived-meaning-conflict nothing stored');seen('request|meaning-conflict');
   // (c) An unadopted archive copy (SETUP: a New chat interrupted between its archive write and its conversation write) holding a
   //     request id with the same words and selection is not evidence: that id is accepted as a fresh request of this conversation.
   const hashOf=(text,target)=>crypto.createHash('sha256').update(JSON.stringify({text,target})).digest('hex');
   assert.equal(turnOf(await archives.findOne({_id:new ObjectId(archivedA.id)}),requestId)?.requestHash,hashOf(requestText,{page:'calendar'}),'SETUP the stored request identity rule');
   const live=await conversation(P,A),ghost=hex32(),ghostText='REQUEST_UNADOPTED_TEXT';
   await archives.insertOne({ownerId:P.id,organizationId:new ObjectId(String(A)),conversationId:live._id,segment:live.segment||0,resetId:'synthetic-interrupted-reset-01',fromRevision:live.revision,turns:[{id:ghost,text:ghostText,at:new Date(),scope:scopeOf(P,A),target:{page:'calendar'},requestHash:hashOf(ghostText,{page:'calendar'})}],turnCount:1,createdAt:new Date(),updatedAt:new Date()});
   r=await post(pa,{requestId:ghost,text:ghostText,context:{page:'calendar'},chatRevision:live.revision});
   assert.equal(r.status,200,'request:unadopted-archive-not-evidence '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data.received,undefined,'request:unadopted-archive-not-evidence '+JSON.stringify(r.data.received));assert.equal(r.data.conversation.state,'queued','request:unadopted-archive-not-evidence');
   job=await claim(WP,'SETUP unadopted-copy request job');assert.equal(job.text,ghostText,'SETUP claimed the fresh request');await answered(WP,job,'REQUEST fresh reply');seen('request|unadopted');
   // (d) Another company's archive and another actor's archive: the same id there is a fresh request here, with no metadata from there.
   const foreignId=hex32(),foreignText='REQUEST_FOREIGN_TEXT';
   v=await view(pb);r=await post(pb,{requestId:foreignId,text:foreignText,context:{page:'calendar'},chatRevision:v.conversation?.revision||0});assert.equal(r.status,200,'SETUP company B request '+r.raw.slice(0,200));
   job=await claim(WP,'SETUP company B job');await answered(WP,job,'REQUEST company B reply');
   v=await view(pb);r=await reset(pb,{chatRevision:v.conversation.revision,requestId:hex32()});assert.equal(r.status,200,'SETUP company B New chat '+r.raw.slice(0,200));
   const archivedB=(await ok(COMPANY+'/history',pb)).archives[0];
   v=await view(pa);r=await post(pa,{requestId:foreignId,text:foreignText,context:{page:'calendar'},chatRevision:v.conversation.revision});
   assert.equal(r.status,200,'request:foreign-archive-not-evidence '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data.received,undefined,'request:foreign-archive-not-evidence '+JSON.stringify(r.data.received));
   assert.equal(r.data.conversation.state,'queued','request:foreign-archive-not-evidence');assert.ok(!r.raw.includes(archivedB.id)&&!r.raw.includes(String(B)),'request:foreign-archive-no-metadata');
   job=await claim(WP,'SETUP company A fresh job');assert.equal(job.text,foreignText,'SETUP claimed in company A');await answered(WP,job,'REQUEST company A reply');
   v=await view(qa);r=await post(qa,{requestId,text:requestText,context:requestContext,chatRevision:v.conversation?.revision||0});
   assert.equal(r.status,200,'request:other-actor-archive-not-evidence '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data.received,undefined,'request:other-actor-archive-not-evidence');assert.ok(!r.raw.includes(archivedA.id),'request:other-actor-archive-no-metadata');
   job=await claim(WQ,'SETUP member job');await answered(WQ,job,'REQUEST member reply');assert.equal(await plans(planArgs.title),1,'request:other-actor-archive-not-evidence no effect');seen('request|foreign');
   // (e) A genuinely new request id with identical words and selection is a new request: queued once, with its own saved plan.
   v=await view(pa);const identical=hex32();r=await post(pa,{requestId:identical,text:requestText,context:requestContext,chatRevision:v.conversation.revision});
   assert.equal(r.status,200,'request:new-id-identical-accepted '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data.received,undefined,'request:new-id-identical-accepted');
   job=await claim(WP,'SETUP identical job');assert.equal(job.text,requestText,'request:new-id-identical-accepted');const secondPlan=await act(WP,job,'create_company_calendar_entry',planArgs,1);assert.equal(secondPlan.status,200,'SETUP second plan '+secondPlan.raw.slice(0,200));await answered(WP,job,'REQUEST identical reply');
   assert.equal(await plans(planArgs.title),2,'request:new-id-identical-accepted second legitimate plan');assert.equal((await conversation(P,A)).turns.filter(t=>t.text===requestText).length,1,'request:new-id-identical-accepted once');seen('request|new-identical');
   // (f) Absent conversation: the client's first send of W never arrived. New chat naming W fences: the conversation row is created at a
   //     newer revision with no turn and no archive, and W's older attempt (revision 0) is refused afterwards.
   assert.equal(await conversation(P,D),null,'SETUP no company D conversation');
   const W={requestId:hex32(),text:'REQUEST_ABSENT_TEXT',context:{page:'invoices'}};
   r=await reset(pd,{chatRevision:0,requestId:hex32(),pending:W});
   assert.equal(r.status,200,'request:absent-reset-fence '+r.status+' '+r.raw.slice(0,200));
   assert.deepEqual(r.data.reset?.pending,{requestId:W.requestId,outcome:'not_accepted',scope:scopeOf(P,D)},'request:absent-reset-fence '+JSON.stringify(r.data.reset));
   const fencedD=await conversation(P,D);assert.ok(fencedD&&fencedD.revision>0&&!(fencedD.turns||[]).length,'request:absent-reset-fence '+JSON.stringify(fencedD&&{revision:fencedD.revision,turns:fencedD.turns?.length}));
   assert.equal(await archives.countDocuments({conversationId:fencedD._id}),0,'request:fence-no-archive-noise');
   r=await post(pd,{...W,chatRevision:0});assert.equal(r.status,409,'request:old-attempt-after-fence absent '+r.status+' '+r.raw.slice(0,200));assert.equal(await everStored(P,D,W.requestId),false,'request:old-attempt-after-fence absent');
   seen('request|absent-fence');
   // (g) Empty live segment (after an ordinary New chat). New chat without a pending request stays the existing no-op; naming the
   //     uncertain request V fences (revision only: no archive, same segment) and V's older attempt is refused.
   v=await view(pc);r=await post(pc,{requestId:hex32(),text:'REQUEST_C_FIRST',context:{page:'calendar'},chatRevision:v.conversation?.revision||0});assert.equal(r.status,200,'SETUP company C first request '+r.raw.slice(0,200));
   job=await claim(WP,'SETUP company C job');await answered(WP,job,'REQUEST company C reply');
   v=await view(pc);r=await reset(pc,{chatRevision:v.conversation.revision,requestId:hex32()});assert.equal(r.status,200,'SETUP company C New chat '+r.raw.slice(0,200));
   const emptyC=await conversation(P,C),archivesC=await archives.countDocuments({conversationId:emptyC._id});assert.equal(emptyC.turns.length,0,'SETUP empty live segment');
   r=await reset(pc,{chatRevision:emptyC.revision,requestId:hex32()});assert.equal(r.status,200,'request:plain-empty-reset-unchanged '+r.status);assert.equal(r.data.reset,undefined,'request:plain-empty-reset-unchanged');assert.equal((await conversation(P,C)).revision,emptyC.revision,'request:plain-empty-reset-unchanged');
   const V={requestId:hex32(),text:'REQUEST_EMPTY_TEXT',context:{page:'calendar'}};
   r=await reset(pc,{chatRevision:emptyC.revision,requestId:hex32(),pending:V});
   assert.equal(r.status,200,'request:empty-reset-fence '+r.status+' '+r.raw.slice(0,200));assert.deepEqual(r.data.reset?.pending,{requestId:V.requestId,outcome:'not_accepted',scope:scopeOf(P,C)},'request:empty-reset-fence '+JSON.stringify(r.data.reset));
   const fencedC=await conversation(P,C);assert.ok(fencedC.revision>emptyC.revision,'request:empty-reset-fence '+JSON.stringify({before:emptyC.revision,after:fencedC.revision}));
   assert.equal(fencedC.segment,emptyC.segment,'request:fence-no-archive-noise');assert.equal(await archives.countDocuments({conversationId:emptyC._id}),archivesC,'request:fence-no-archive-noise');
   r=await post(pc,{...V,chatRevision:emptyC.revision});assert.equal(r.status,409,'request:old-attempt-after-fence empty '+r.status+' '+r.raw.slice(0,200));assert.equal(await everStored(P,C,V.requestId),false,'request:old-attempt-after-fence empty');
   seen('request|empty-fence');
   // (h) A lost reset reply: the same reset id with the same pending meaning is recognised (nothing archived) and fences again, so an
   //     attempt of U that the client could only have sent with the first fence's revision is refused too. The same reset id with another
   //     meaning (other words, or no pending request) is refused and changes nothing.
   const resetId=hex32(),U={requestId:hex32(),text:'REQUEST_LOST_RESET_TEXT',context:{page:'calendar'}},c0=await conversation(P,C);
   r=await reset(pc,{chatRevision:c0.revision,requestId:resetId,pending:U});assert.equal(r.status,200,'SETUP first reset '+r.raw.slice(0,200));assert.equal(r.data.reset?.pending?.outcome,'not_accepted','request:lost-reset-same-outcome first');
   const firstFence=(await conversation(P,C)).revision;
   r=await reset(pc,{chatRevision:c0.revision,requestId:resetId,pending:U});assert.equal(r.status,200,'request:lost-reset-same-outcome '+r.status+' '+r.raw.slice(0,200));assert.deepEqual(r.data.reset?.pending,{requestId:U.requestId,outcome:'not_accepted',scope:scopeOf(P,C)},'request:lost-reset-same-outcome');
   const refenced=await conversation(P,C);assert.ok(refenced.revision>firstFence,'request:lost-reset-refenced '+JSON.stringify({firstFence,now:refenced.revision}));
   assert.equal(refenced.segment,c0.segment,'request:lost-reset-no-second-archive');assert.equal(await archives.countDocuments({conversationId:c0._id}),archivesC,'request:lost-reset-no-second-archive');
   r=await post(pc,{...U,chatRevision:firstFence});assert.equal(r.status,409,'request:lost-reset-refenced old attempt '+r.status+' '+r.raw.slice(0,200));assert.equal(await everStored(P,C,U.requestId),false,'request:lost-reset-refenced old attempt');
   r=await reset(pc,{chatRevision:refenced.revision,requestId:resetId,pending:{...U,text:'REQUEST_OTHER_MEANING'}});assert.equal(r.status,409,'request:lost-reset-conflicting-meaning words '+r.status+' '+r.raw.slice(0,200));
   r=await reset(pc,{chatRevision:refenced.revision,requestId:resetId});assert.equal(r.status,409,'request:lost-reset-conflicting-meaning none '+r.status+' '+r.raw.slice(0,200));
   assert.equal((await conversation(P,C)).revision,refenced.revision,'request:lost-reset-conflicting-meaning nothing changed');seen('request|lost-reset');
   // (i) A send and a New chat naming the same request race (one real concurrent pair per round, company D): exactly one wins, and the
   //     answer matches what was stored.
   for(let i=0;i<3;i++){
    await beat(WP);const X={requestId:hex32(),text:'REQUEST_RACE_'+i,context:{page:'calendar'}},rev=(await view(pd)).conversation.revision;
    const [s,x]=await Promise.all([call(COMPANY,pd,'POST',{...X,chatRevision:rev}),reset(pd,{chatRevision:rev,requestId:hex32(),pending:X})]);
    const stored=await everStored(P,D,X.requestId),race={round:i,send:s.status,reset:x.status,answer:x.data?.reset?.pending?.outcome||null,stored};
    assert.equal([s.status,x.status].filter(n=>n===200).length,1,'request:send-reset-one-winner '+JSON.stringify(race));
    if(s.status!==200)assert.equal(s.status,409,'request:send-reset-one-winner '+JSON.stringify(race));
    if(x.status===200)assert.deepEqual([x.data.reset?.pending?.outcome,stored],['not_accepted',false],'request:send-reset-one-winner '+JSON.stringify(race));
    else{assert.equal(x.status,409,'request:send-reset-one-winner '+JSON.stringify(race));assert.ok(stored,'request:send-reset-one-winner '+JSON.stringify(race));const j=await claim(WP,'SETUP race job');await answered(WP,j,'REQUEST race reply')}
    seen('request|race-'+(x.status===200?'reset':'send'));
   }
   // (j) Send first: X2 is accepted; a New chat naming it while it is answered is refused (busy) and fences nothing. After the answer,
   //     New chat archives the segment and answers accepted with that archive and X2's receipt; named again later (empty segment) it is
   //     still accepted from that archive, and a send of X2 is recognised there.
   const X2={requestId:hex32(),text:'REQUEST_SEND_FIRST',context:{page:'calendar'}};
   v=await view(pc);r=await post(pc,{...X2,chatRevision:v.conversation.revision});assert.equal(r.status,200,'SETUP send first '+r.raw.slice(0,200));
   const queuedC=await conversation(P,C);
   r=await reset(pc,{chatRevision:queuedC.revision,requestId:hex32(),pending:X2});assert.equal(r.status,409,'request:busy-reset-refused '+r.status+' '+r.raw.slice(0,200));assert.equal((await conversation(P,C)).revision,queuedC.revision,'request:busy-reset-refused no fence');
   job=await claim(WP,'SETUP send-first job');const x2Plan=await act(WP,job,'create_company_calendar_entry',{...planArgs,title:'REQUEST_SEND_FIRST_PLAN'},1);assert.equal(x2Plan.status,200,'SETUP send-first plan '+x2Plan.raw.slice(0,200));await answered(WP,job,'REQUEST send-first reply');
   v=await view(pc);r=await reset(pc,{chatRevision:v.conversation.revision,requestId:hex32(),pending:X2});
   assert.equal(r.status,200,'request:reset-recognises-accepted '+r.status+' '+r.raw.slice(0,200));
   let answer=r.data.reset?.pending;const newestC=(await ok(COMPANY+'/history',pc)).archives[0];
   assert.equal(answer?.outcome,'accepted','request:reset-recognises-accepted '+JSON.stringify(answer));assert.equal(answer.where,'archive','request:reset-recognises-accepted');assert.equal(answer.archive?.id,newestC.id,'request:reset-recognises-accepted archive');
   assert.deepEqual(answer.turn?.actions?.map(a=>[a.name,a.state]),[['create_company_calendar_entry','done']],'request:reset-recognises-accepted receipt '+JSON.stringify(answer.turn));assert.equal(r.data.conversation.turns.length,0,'request:reset-recognises-accepted archived');
   v=await view(pc);r=await reset(pc,{chatRevision:v.conversation.revision,requestId:hex32(),pending:X2});answer=r.data?.reset?.pending;
   assert.equal(answer?.outcome,'accepted','request:reset-recognises-archived '+r.status+' '+JSON.stringify(r.data?.reset));assert.equal(answer.archive?.id,newestC.id,'request:reset-recognises-archived');
   v=await view(pc);r=await post(pc,{...X2,chatRevision:v.conversation.revision});assert.equal(r.data?.received?.archive?.id,newestC.id,'request:archived-recognised after reset '+r.raw.slice(0,200));
   assert.equal(await plans('REQUEST_SEND_FIRST_PLAN'),1,'request:reset-recognises-accepted not repeated');await idle(WP,'request:reset-recognises-accepted not queued');seen('request|send-first');
   // (k) An action still claimed under a recent lease (SETUP synthetic receipt) or a stale revision refuses New chat: nothing is fenced and
   //     the request stays uncertain. Once the lease has expired the receipt becomes unresolved (never repeated), and New chat archives
   //     it and fences the request.
   const X3={requestId:hex32(),text:'REQUEST_CLAIMED_TEXT',context:{page:'calendar'}},Y3={requestId:hex32(),text:'REQUEST_AFTER_CLAIMED',context:{page:'calendar'}};
   v=await view(pc);r=await post(pc,{...X3,chatRevision:v.conversation.revision});assert.equal(r.status,200,'SETUP claimed-turn request '+r.raw.slice(0,200));job=await claim(WP,'SETUP claimed-turn job');await answered(WP,job,'REQUEST claimed-turn reply');
   await companies.updateOne({ownerId:P.id,organizationId:new ObjectId(String(C))},{$push:{'turns.$[turn].actions':{operationId:'1'.repeat(32),name:'update_company_calendar_entry',turnId:X3.requestId,slot:99,payloadHash:'synthetic',paymentId:new ObjectId(),requestedFields:['notes'],state:'claimed',lease:'synthetic-recent-lease',leaseUntil:new Date(),claimedAt:new Date()}}},{arrayFilters:[{'turn.id':X3.requestId}]});
   const claimedC=await conversation(P,C);
   r=await reset(pc,{chatRevision:claimedC.revision,requestId:hex32(),pending:Y3});assert.equal(r.status,409,'request:claimed-reset-refused '+r.status+' '+r.raw.slice(0,200));
   r=await reset(pc,{chatRevision:claimedC.revision-1,requestId:hex32(),pending:Y3});assert.equal(r.status,409,'request:stale-reset-refused '+r.status+' '+r.raw.slice(0,200));
   const stillC=await conversation(P,C);assert.equal(stillC.revision,claimedC.revision,'request:refused-reset-no-fence');assert.notEqual(stillC.lastReset?.pending?.requestId,Y3.requestId,'request:refused-reset-no-fence');
   await companies.updateOne({_id:stillC._id},{$set:{'turns.$[turn].actions.$[action].leaseUntil':new Date(Date.now()-120000)}},{arrayFilters:[{'turn.id':X3.requestId},{'action.slot':99}]});
   v=await view(pc);assert.equal(v.conversation.turns.find(t=>t.id===X3.requestId)?.actions?.find(a=>a.slot===99)?.state,'unresolved','SETUP the expired claimed receipt is unresolved');
   r=await reset(pc,{chatRevision:v.conversation.revision,requestId:hex32(),pending:Y3});assert.equal(r.status,200,'request:after-claimed-reset '+r.status+' '+r.raw.slice(0,200));assert.equal(r.data.reset?.pending?.outcome,'not_accepted','request:after-claimed-reset');
   const keptReceipt=turnOf(await archives.findOne({conversationId:stillC._id},{sort:{segment:-1}}),X3.requestId)?.actions?.find(a=>a.slot===99);assert.equal(keptReceipt?.state,'unresolved','request:after-claimed-reset unresolved receipt archived');
   seen('request|claimed-stale');
   // (l) One canonical request id (parent fold of 2026-10-23, company E of its own). The send checks the id once and uses that same
   //     canonical form (its string) for recognition, the queue and the stored turn: a JSON-number id of the allowed 16-64 characters is
   //     accepted and is claimable by a worker with consistent stored ids (before the fold it was stored as a number in the turn but as a
   //     string in currentId, and the native claim refused it with 409 "Company conversation scope changed"); its numeric or string reuse
   //     is the same request, live and after New chat archived it, answered with its exact receipt and never queued or executed again;
   //     another meaning keeps the 409; ordinary string ids and a genuinely new identical purchase are unchanged.
   const E=await company('request-e','Synthetic request E',[member(P,'owner')]),pe=await switchTo(P,E);
   const numericId=1234567890123456,canonicalId=String(numericId),numText='支払カレンダーにREQUEST_NUMERIC_ONCE、900円、今日、支出、事務費を1件登録してください。',numContext={page:'calendar'};
   const numArgs={...planArgs,title:'REQUEST_NUMERIC_ONCE',amount:900};
   v=await view(pe);r=await post(pe,{requestId:numericId,text:numText,context:numContext,chatRevision:v.conversation?.revision||0});assert.equal(r.status,200,'SETUP numeric request accepted '+r.raw.slice(0,200));
   const storedE=await conversation(P,E),storedTurn=storedE?.turns?.find(t=>String(t.id)===canonicalId);
   await beat(WP);const numericClaim=await chatWorker(WP,'workspace-claim',{});
   assert.equal(numericClaim.status,200,'request:canonical-id-claimable '+JSON.stringify({claim:numericClaim.status,error:numericClaim.data?.statusMessage||null,state:(await conversation(P,E))?.state,currentId:storedE?.currentId,turnId:storedTurn?.id,turnIdType:typeof storedTurn?.id}));
   assert.ok(numericClaim.data?.job,'request:canonical-id-claimable job');
   assert.deepEqual([typeof storedTurn?.id,storedTurn?.id,storedE.currentId],['string',canonicalId,canonicalId],'request:canonical-id-stored');
   job=numericClaim.data.job;const numPlan=await act(WP,job,'create_company_calendar_entry',numArgs,1);assert.equal(numPlan.status,200,'SETUP numeric plan '+numPlan.raw.slice(0,200));await answered(WP,job,'REQUEST numeric reply');
   // Live reuse, number and string: the same request, nothing queued, one turn, one plan.
   for(const reuse of[numericId,canonicalId]){
    v=await view(pe);r=await post(pe,{requestId:reuse,text:numText,context:numContext,chatRevision:v.conversation.revision});
    assert.equal(r.status,200,'request:canonical-id-live-reuse '+typeof reuse+' '+r.status+' '+r.raw.slice(0,200));assert.ok(!['queued','working'].includes(r.data.conversation.state),'request:canonical-id-live-reuse '+typeof reuse);
    assert.equal((await conversation(P,E)).turns.length,1,'request:canonical-id-live-reuse '+typeof reuse);
    r=await post(pe,{requestId:reuse,text:numText+' 追加',context:numContext,chatRevision:v.conversation.revision});assert.equal(r.status,409,'request:canonical-id-meaning-conflict live '+typeof reuse+' '+r.status);
   }
   await idle(WP,'request:canonical-id-live-reuse not queued');
   // After New chat archived it, number and string: recognised from the archive with the exact receipt, never queued again.
   v=await view(pe);r=await reset(pe,{chatRevision:v.conversation.revision,requestId:hex32()});assert.equal(r.status,200,'SETUP company E New chat '+r.raw.slice(0,200));
   const archivedE=(await ok(COMPANY+'/history',pe)).archives[0];
   for(const reuse of[numericId,canonicalId]){
    v=await view(pe);r=await post(pe,{requestId:reuse,text:numText,context:numContext,chatRevision:v.conversation.revision});
    assert.equal(r.status,200,'request:canonical-id-archived-reuse '+typeof reuse+' '+r.status+' '+r.raw.slice(0,200));
    assert.deepEqual([r.data.received?.requestId,r.data.received?.where,r.data.received?.archive?.id],[canonicalId,'archive',archivedE.id],'request:canonical-id-archived-reuse '+typeof reuse+' '+JSON.stringify(r.data.received));
    assert.deepEqual(r.data.received.turn?.actions?.map(a=>[a.name,a.state,a.operationId]),[['create_company_calendar_entry','done',numPlan.data.receipt.operationId]],'request:canonical-id-archived-receipt '+typeof reuse);
    assert.equal(r.data.conversation.turns.length,0,'request:canonical-id-archived-reuse not queued');
    r=await post(pe,{requestId:reuse,text:numText,context:{page:'dashboard'},chatRevision:v.conversation.revision});assert.equal(r.status,409,'request:canonical-id-meaning-conflict archived '+typeof reuse+' '+r.status);
   }
   await idle(WP,'request:canonical-id-archived-reuse not queued');assert.equal(await plans(numArgs.title),1,'request:canonical-id-no-second-effect');
   // An ordinary string id and a genuinely new identical purchase (a new id) are new requests, each with its own plan.
   v=await view(pe);r=await post(pe,{requestId:hex32(),text:numText,context:numContext,chatRevision:v.conversation.revision});assert.equal(r.status,200,'request:canonical-id-new-identical '+r.raw.slice(0,200));assert.equal(r.data.received,undefined,'request:canonical-id-new-identical');
   job=await claim(WP,'SETUP company E identical job');assert.equal(job.text,numText,'request:canonical-id-new-identical');assert.equal((await act(WP,job,'create_company_calendar_entry',numArgs,1)).status,200,'SETUP company E second plan');await answered(WP,job,'REQUEST company E identical reply');
   assert.equal(await plans(numArgs.title),2,'request:canonical-id-new-identical second legitimate plan');
   seen('request|canonical-id');
   pass('request identity across New chat: an archived accepted request is recognised with its receipt and never queued again; another meaning refused; unadopted, foreign and other-actor archives are not evidence; a new identical request is new; New chat fences an uncertain request on absent and empty conversations, answers accepted from live and archived turns, refuses busy, claimed and stale resets, recognises a lost reset reply only with the same meaning and fences again; a racing send and New chat have one winner; one canonical request id (a numeric id claimable with consistent stored ids, its numeric and string reuse recognised live and archived with the exact receipt, no second effect)');
  });

  // 3-9. Installed Chrome against the same app (scripts/finance-navi-selection-browser.cjs).
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

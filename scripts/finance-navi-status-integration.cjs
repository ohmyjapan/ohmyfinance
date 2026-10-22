'use strict';
// Closed Navi status and exact reply read state (plan omf-navi-agent-status-20261022). Actual built native HTTP on an owned loopback
// app and an owned MongoMemoryServer; synthetic people, companies, cards, statements, workers, replies and research reports only.
// Worker replies and research results are simulated through the native worker routes: no model, provider, mail, bank, Slack or
// production address is reached. Group 1 starts with the owner status route, so the unchanged baseline fails there first. Each
// assertion label names the behaviour a defect must break; labels starting with SETUP are preparation, never evidence. Direct
// database writes are synthetic setup only (legacy turns, removed memberships, stuck recovery states, an offline worker), each named.
// OMF_NAVI_STATUS_ONLY=<group,...> runs the shared setup and the named groups only (the fixture's defect legs); the full run is all.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_NAVI_STATUS_APP_ROOT||path.join(__dirname,'..'));
// gui-layout runs first among the GUI groups, so its page content is the shared setup's only (the same as a layout baseline run).
// gui-layout-baseline is not a status group: it only measures the same page layout on a prior release (OMF_NAVI_STATUS_ONLY alone).
const NATIVE=['workspace','company','purchase','mask','race','lease'],GUI=['gui-layout','gui-closed','gui-reader','gui-hidden','gui-scope','gui-purchase','gui-text'],BASELINE='gui-layout-baseline';
const ONLY=String(process.env.OMF_NAVI_STATUS_ONLY||'').split(',').map(s=>s.trim()).filter(Boolean);
for(const g of ONLY)if(![...NATIVE,...GUI,BASELINE].includes(g))throw Error('SETUP unknown group '+g);
if(ONLY.includes(BASELINE)&&ONLY.length!==1)throw Error('SETUP the layout baseline runs alone');
const wants=g=>g===BASELINE?ONLY.includes(BASELINE):!ONLY.length||ONLY.includes(g);
// SETUP readiness only: on a loaded machine (other work at full CPU while this runs at idle priority) the owned throwaway mongod, app
// and Chrome can take minutes to start. Each start is measured and printed (TIMING); no behaviour assertion uses this window.
const SETUP_READY_MS=300000;
const DB='navi_status_regression',PASSWORD='Synthetic-password-Only1!';
const WORKSPACE='/api/finance-chat/workspace',COMPANY='/api/finance-chat/company-workspace';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),hex32=()=>crypto.randomBytes(16).toString('hex'),sha=t=>crypto.createHash('sha256').update(t).digest('hex');
// Keys and texts the lightweight status must never carry.
const PRIVATE_KEYS=['"turns"','"proposal"','"summary"','"text"','"lease"','"leaseUntil"','"context"','"report"','"instruction"'];

async function main(){
 let mongo,client,child,directory,browserRunner,logs='',groups=0,failure=null;const cases=new Set(),timing={};
 const pass=name=>{groups++;console.log('PASS '+name)},seen=label=>cases.add(label);
 try{
  if(GUI.some(wants)||wants(BASELINE)){const before=Date.now();browserRunner=require('./finance-navi-status-browser.cjs');browserRunner.prepare();timing.browserDependencyMs=Date.now()-before}
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-status-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  // SETUP the throwaway mongod gets the measured readiness window instead of the library's 10 s default.
  let started=Date.now();
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});const uri=mongo.getUri(DB);timing.mongoMs=Date.now()-started;
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',GEMINI_API_KEY:'',ANTHROPIC_API_KEY:'disabled-synthetic-status-test',OPENAI_API_KEY:'disabled-synthetic-status-test',SLACK_BOT_TOKEN:'disabled-synthetic-status-test',BASE_URL:origin,OMF_COLLECTOR_PUBLIC_ORIGIN:'',OMF_TRUST_CLOUDFLARE_LOOPBACK:''},stdio:['ignore','pipe','pipe']});
  child.closed=new Promise(r=>child.once('exit',r));for(const s of[child.stdout,child.stderr]){s.setEncoding('utf8');s.on('data',v=>{logs=(logs+v).slice(-20000)})}
  let healthy=false;started=Date.now();
  while(!healthy&&Date.now()-started<SETUP_READY_MS){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,DB,'SETUP owned database');healthy=true}}catch(e){if(e?.code==='ERR_ASSERTION')throw e}if(!healthy)await pause(500)}
  timing.appMs=Date.now()-started;
  assert.ok(healthy,'SETUP owned app unavailable after '+timing.appMs+' ms: '+logs.slice(-3000));
  console.log('TIMING '+JSON.stringify(timing));
  client=await MongoClient.connect(uri);const db=client.db(DB);
  const owners=db.collection('financeassistants'),companies=db.collection('financecompanyassistants'),purchases=db.collection('financechats'),researches=db.collection('financeresearches'),agents=db.collection('financechatagents'),orgs=db.collection('organizations');
  const call=async(route,token,method='GET',body,type='application/json')=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':type,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:type==='application/json'?JSON.stringify(body):body}),signal:AbortSignal.timeout(30000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body,type)=>{const r=await call(route,token,method,body,type);assert.equal(r.status,200,'SETUP '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const COLLECTIONS=['financeassistants','financecompanyassistants','financechats','financeresearches','financechatagents','financeactionoperations','financedrafts','financeownerconversationarchives','financecompanyconversationarchives','financecompanyknowledges','transactions','financeentries'];
  const snapshot=async()=>JSON.stringify(await Promise.all(COLLECTIONS.map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const noPrivate=(raw,texts,label)=>{for(const k of PRIVATE_KEYS)assert.ok(!raw.includes(k),label+' '+k);for(const t of texts)assert.ok(!raw.includes(t),label+' text')};

  // People, companies, cards and workers. Each group owns its people, so a subset run starts from the same state as the full run.
  const now=new Date(),member=(u,role)=>({userId:u.id,role,joinedAt:now});
  // The app allows five sign-ups a minute from one address: a 429 waits the time it names, never bypasses the limit.
  const register=async(slug,name)=>{const email='status-'+slug+'@example.invalid';let r;for(let attempt=0;;attempt++){r=await call('/api/auth/register',null,'POST',{email,password:PASSWORD,name});if(r.status!==429||attempt>=3)break;await pause((Number((r.raw.match(/in (\d+) seconds/)||[])[1])||60)*1000+1000)}
   assert.equal(r.status,200,'SETUP POST /api/auth/register '+r.raw.slice(0,300));const u=await db.collection('users').findOne({email});return{id:u._id,email,password:PASSWORD,token:r.data.tokens.accessToken}};
  const company=async(slug,name,members)=>{const _id=new ObjectId();await orgs.insertOne({_id,name,slug:'status-'+slug,type:'business',isActive:true,members,createdAt:now,updatedAt:now});return _id};
  const switchTo=async(u,org)=>(await ok('/api/auth/switch-organization',u.token,'POST',{organizationId:String(org)})).tokens.accessToken;
  const card=async(u,number)=>{const a=(await ok('/api/finance/accounts',u.token,'POST',{name:'Synthetic card '+number,primaryCard:number,cardIdentifiers:[number],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;a.number=number;return a};
  const {HEADERS}=await import(pathToFileURL(path.join(__dirname,'../shared/amex.mjs')).href);
  const statement=async(u,account,descriptions)=>{const rows=descriptions.map((d,i)=>['2026/08/'+String(i+1).padStart(2,'0'),'2026/08/'+String(i+3).padStart(2,'0'),d,'Test user',account.number,String(1200+i*10),'','']);const csv=[HEADERS,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');return(await ok('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',u.token,'POST',csv,'text/csv')).id};
  const workerOf=async(u,accounts,flags)=>{const a=await ok('/api/finance-chat/agents',u.token,'POST',{accountIds:accounts.map(x=>String(x._id)),...flags});return{id:a.id,_id:new ObjectId(a.id),token:a.token}};
  const chatWorker=(w,route,body={})=>call('/api/finance-chat/worker/'+route,w.token,'POST',body);
  const researchWorker=(w,route,body={})=>call('/api/finance-research/worker/'+route,w.token,'POST',body);
  const beat=async w=>assert.equal((await chatWorker(w,'heartbeat')).status,200,'SETUP heartbeat');
  const researchAlive=async w=>assert.equal((await researchWorker(w,'status',{settingsUrl:'http://127.0.0.1:54321/setup/'+'a'.repeat(64),ntaConfigured:false})).status,200,'SETUP research worker alive');
  const reply=(summary,instruction)=>({kind:'unclear',summary,patch:{},quotes:{},...(instruction?{research:{instruction}}:{})});
  const claim=async(w,label)=>{const r=await chatWorker(w,'workspace-claim',{});assert.equal(r.status,200,'SETUP claim '+r.raw.slice(0,300));assert.ok(r.data.job,label);return r.data.job};
  const answer=(w,job,summary)=>chatWorker(w,'workspace/'+job.id+'/result',{lease:job.lease,proposal:reply(summary)});
  const answered=async(w,job,summary)=>{const r=await answer(w,job,summary);assert.equal(r.status,200,'SETUP reply '+r.raw.slice(0,300))};
  const lose=(w,job)=>chatWorker(w,'workspace/'+job.id+'/result',{lease:job.lease,failed:true});
  const chatClaim=async(w,label)=>{const r=await chatWorker(w,'claim');assert.equal(r.status,200,'SETUP purchase claim '+r.raw.slice(0,300));assert.ok(r.data.job,label);return r.data.job};
  const chatAnswer=(w,job,proposal)=>chatWorker(w,job.id+'/result',{lease:job.lease,proposal});
  const wsSend=async(token,text,revision)=>{const requestId=hex32(),chatRevision=revision!==undefined?revision:((await ok(WORKSPACE,token)).conversation?.revision||0);const r=await call(WORKSPACE,token,'POST',{requestId,chatRevision,text,context:{page:'mapping'}});return{requestId,r}};
  const wsSent=async(token,text,revision)=>{const s=await wsSend(token,text,revision);assert.equal(s.r.status,200,'SETUP owner send '+s.r.raw.slice(0,300));return s.requestId};
  const coSent=async(token,text)=>{const requestId=hex32(),chatRevision=(await ok(COMPANY,token)).conversation?.revision||0;await ok(COMPANY,token,'POST',{requestId,chatRevision,text,context:{page:'transactions'}});return requestId};
  const chatPath=(importId,line)=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,draftPath=(importId,line)=>'/api/finance/imports/'+importId+'/drafts/'+line,researchPath=(importId,line)=>'/api/finance-research/imports/'+importId+'/drafts/'+line;
  const bind=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash});
  const puSent=async(token,importId,line,text)=>{const d=await ok(draftPath(importId,line),token),view=await ok(chatPath(importId,line),token),requestId=hex32();await ok(chatPath(importId,line),token,'POST',{...bind(d),chatRevision:view.conversation?.revision||0,requestId,text});return requestId};
  const status={workspace:token=>call(WORKSPACE+'/status',token),company:token=>call(COMPANY+'/status',token),purchase:(token,importId,line)=>call(chatPath(importId,line)+'/status',token)};
  const read={workspace:(token,body)=>call(WORKSPACE+'/read',token,'POST',body),company:(token,body)=>call(COMPANY+'/read',token,'POST',body),purchase:(token,importId,line,body)=>call(chatPath(importId,line)+'/read',token,'POST',body)};
  const statusOk=async(r,label)=>{assert.equal(r.status,200,label+' '+r.status+' '+r.raw.slice(0,200));return r.data};
  const turnOf=(doc,id)=>doc?.turns?.find(t=>t.id===id);
  const mailText='Synthetic Status Supply Corporation T1234567890123\nSynthetic purchase receipt. Consumption tax 10%.';
  const reportFor=()=>{const source={id:'s1',kind:'mail',title:'Synthetic receipt mail',url:'',text:mailText,hash:sha(mailText),capturedAt:new Date().toISOString()},citation={sourceId:'s1',quote:mailText};return{source,report:{summary:'STATUS_RESEARCH_SUMMARY 候補を確認してください。',question:'',findings:[{field:'invoiceNumber',valueJson:'"T1234567890123"',reason:'Printed number, not an official check',basis:'literal',citations:[citation]},{field:'taxRate',valueJson:'10',reason:'Printed percentage on the receipt mail',basis:'literal',citations:[citation]}],supplier:{shopName:'Synthetic status shop',legalName:'Synthetic Status Supply Corporation',invoiceNumber:'T1234567890123',citations:[citation]}}}};
  const finishResearch=async(r,label)=>{const c=await researchWorker(r,'claim');assert.equal(c.status,200,'SETUP research claim '+c.raw.slice(0,300));assert.ok(c.data.job,label);const job=c.data.job,{source,report}=reportFor();const f=await researchWorker(r,job.id+'/result',{lease:job.lease,sources:[...job.sources,source],report});assert.equal(f.status,200,'SETUP research result '+f.raw.slice(0,300));return job};
  const failResearch=async(r,label)=>{const c=await researchWorker(r,'claim');assert.ok(c.data?.job,label);const f=await researchWorker(r,c.data.job.id+'/result',{lease:c.data.job.lease,failed:true});assert.equal(f.status,200,'SETUP research failure '+f.raw.slice(0,300));return c.data.job};
  const ctx={db,ObjectId,origin,call,ok,register,company,switchTo,card,statement,workerOf,chatWorker,researchWorker,beat,researchAlive,reply,claim,answer,answered,lose,chatClaim,chatAnswer,wsSent,coSent,puSent,chatPath,draftPath,researchPath,bind,finishResearch,turnOf,pause,hex32,pass,seen,wants,owners,companies,purchases,researches,agents,orgs,member,WORKSPACE,COMPANY,timing,SETUP_READY_MS,BASELINE};

  // 1. Owner workspace: the closed status route, exact reply versions, the pure read, legacy unknown, failure and retry, exact
  //    acknowledgement on the live turn without touching the conversation revision, timestamps or leases.
  if(wants('workspace')){
   const U=await register('owner','Synthetic status owner'),acct=await card(U,'11111'),W=await workerOf(U,[acct],{workspaceEnabled:true}),C=await workerOf(U,[acct],{});await beat(W);
   let s=await status.workspace(U.token);
   assert.equal(s.status,200,'status:workspace-route '+s.status+' '+s.raw.slice(0,200));seen('route|workspace');
   assert.equal(s.data.realm,'workspace','status:workspace-shape');assert.equal(s.data.conversation,null,'status:workspace-empty');assert.equal(s.data.replies.unread,0,'status:workspace-empty');assert.equal(s.data.research,undefined,'status:workspace-shape');
   assert.equal(s.data.connected,true,'status:workspace-connected');assert.equal(s.data.scope.actorId,String(U.id),'status:scope-echo');assert.equal(s.data.scope.organizationId,null,'status:scope-echo');assert.ok(Number.isFinite(s.data.observedAt),'status:observed-at');
   assert.equal((await call(WORKSPACE+'/status',null)).status,401,'status:authenticated-only');seen('auth|no-token');
   const t1=await wsSent(U.token,'STATUS_T1_QUESTION');
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.conversation.state,'queued','status:queued');assert.equal(s.replies.unread,0,'status:queued-no-reply');seen('state|queued');
   await agents.updateOne({_id:W._id},{$set:{chatLastSeenAt:new Date(Date.now()-600000)}});// SETUP synthetic offline worker
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.connected,false,'status:offline-worker');seen('state|reconnect');await beat(W);
   let job=await claim(W,'SETUP claim t1');s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.conversation.state,'working','status:working');seen('state|working');
   await answered(W,job,'STATUS_REPLY_ONE');
   s=await status.workspace(U.token);const s1=await statusOk(s,'SETUP');
   assert.equal(s1.conversation.state,'ready','SETUP ready');assert.equal(s1.replies.unread,1,'status:reply-unread');assert.deepEqual(s1.replies.latestUnread,{turnId:t1,replyVersion:1},'status:reply-version');
   let doc=await owners.findOne({ownerId:U.id});assert.equal(turnOf(doc,t1).replyVersion,1,'status:reply-version');seen('version|first-reply');
   noPrivate(s.raw,['STATUS_REPLY_ONE','STATUS_T1_QUESTION'],'status:no-text');seen('privacy|status-without-text');
   const before=await snapshot();for(let i=0;i<3;i++)await statusOk(await status.workspace(U.token),'SETUP repeated status');assert.equal(await snapshot(),before,'status:get-pure');seen('pure|workspace');
   const conv=(await ok(WORKSPACE,U.token)).conversation,base={conversationId:conv.id,segment:conv.segment};
   let r=await read.workspace(U.token,{...base,replies:[{turnId:t1,replyVersion:2}]});assert.equal(r.status,409,'status:exact-version '+r.status);seen('ack|wrong-version');
   r=await read.workspace(U.token,{...base,replies:[{turnId:hex32(),replyVersion:1}]});assert.equal(r.status,409,'status:unknown-turn '+r.status);
   r=await read.workspace(U.token,{...base,conversationId:new ObjectId().toHexString(),replies:[{turnId:t1,replyVersion:1}]});assert.equal(r.status,409,'status:foreign-conversation '+r.status);
   r=await read.workspace(U.token,{...base,segment:1,replies:[{turnId:t1,replyVersion:1}]});assert.equal(r.status,409,'status:stale-segment '+r.status);seen('ack|stale-segment');
   for(const bad of[{...base},{...base,replies:[]},{...base,replies:[{turnId:t1,replyVersion:-1}]},{...base,replies:[{turnId:t1,replyVersion:1.5}]},{...base,replies:[{turnId:t1,replyVersion:1,extra:1}]},{...base,extra:true,replies:[{turnId:t1,replyVersion:1}]},{...base,replies:[{turnId:t1,replyVersion:1},{turnId:t1,replyVersion:1}]},{...base,replies:Array.from({length:51},()=>({turnId:hex32(),replyVersion:1}))},{...base,research:{researchId:new ObjectId().toHexString(),requestId:crypto.randomUUID(),reportVersion:1,turnId:t1}},{conversationId:'x',segment:0,replies:[{turnId:t1,replyVersion:1}]},{...base,segment:-1,replies:[{turnId:t1,replyVersion:1}]},{...base,replies:[{turnId:'bad id with spaces',replyVersion:1}]}]){r=await read.workspace(U.token,bad);assert.equal(r.status,400,'status:ack-body '+JSON.stringify(bad).slice(0,90)+' '+r.status)}
   assert.equal(await snapshot(),before,'status:refused-ack-no-effect');seen('ack|refusals-no-effect');
   r=await read.workspace(U.token,{...base,replies:[{turnId:t1,replyVersion:1}]});assert.equal(r.status,200,'status:ack '+r.raw.slice(0,200));
   assert.equal(r.data.replies.unread,0,'status:ack-clears-unread');assert.equal(r.data.acknowledged?.replies,1,'status:ack-count');assert.equal(r.data.realm,'workspace','status:ack-returns-status');noPrivate(r.raw,['STATUS_REPLY_ONE'],'status:no-text');
   doc=await owners.findOne({ownerId:U.id});assert.equal(turnOf(doc,t1).seenReplyVersion,1,'status:ack-durable');assert.equal(doc.revision,conv.revision,'status:send-revision-unchanged');
   const parsed=JSON.parse(before)[0].find(c=>String(c.ownerId)===String(U.id));assert.equal(new Date(doc.updatedAt).getTime(),new Date(parsed.updatedAt).getTime(),'status:ack-no-timestamp');seen('ack|exact-durable');
   r=await read.workspace(U.token,{...base,replies:[{turnId:t1,replyVersion:1}]});assert.equal(r.status,200,'status:ack-idempotent');assert.equal(turnOf(await owners.findOne({ownerId:U.id}),t1).seenReplyVersion,1,'status:ack-idempotent');
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.replies.unread,0,'status:ack-durable');
   const sent=await wsSend(U.token,'STATUS_T2_QUESTION',conv.revision);assert.equal(sent.r.status,200,'status:send-revision-unchanged '+sent.r.raw.slice(0,200));const t2=sent.requestId;seen('ack|send-after-ack');
   job=await claim(W,'SETUP claim t2');assert.equal((await lose(W,job)).status,200,'SETUP failed reply');
   doc=await owners.findOne({ownerId:U.id});assert.equal(turnOf(doc,t2).replyVersion,undefined,'status:failure-no-version');
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.conversation.state,'failed','status:failed-state');assert.equal(s.replies.unread,0,'status:failure-no-version');seen('version|failure');
   assert.equal((await call(WORKSPACE+'/retry',U.token,'POST',{chatRevision:(await ok(WORKSPACE,U.token)).conversation.revision})).status,200,'SETUP retry');
   job=await claim(W,'SETUP claim retry');
   r=await chatWorker(W,'workspace/'+job.id+'/result',{lease:crypto.randomUUID(),proposal:reply('STATUS_WRONG_LEASE')});assert.equal(r.status,409,'status:wrong-lease '+r.status);
   r=await chatWorker(C,'workspace/'+job.id+'/result',{lease:job.lease,proposal:reply('STATUS_NO_CAPABILITY')});assert.equal(r.status,403,'status:worker-capability '+r.status);
   doc=await owners.findOne({ownerId:U.id});assert.equal(turnOf(doc,t2).replyVersion,undefined,'status:wrong-lease-no-version');assert.equal(turnOf(doc,t2).proposal,undefined,'status:wrong-lease-no-version');seen('version|wrong-lease-capability');
   await answered(W,job,'STATUS_REPLY_TWO');assert.equal(turnOf(await owners.findOne({ownerId:U.id}),t2).replyVersion,1,'status:retry-version');
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.replies.unread,1,'status:retry-unread');assert.deepEqual(s.replies.latestUnread,{turnId:t2,replyVersion:1},'status:retry-unread');seen('version|retry');
   // SETUP a legacy readable turn written before versions existed: no replyVersion and no read record.
   const legacy=hex32(),old=new Date(Date.now()-86400000);await owners.updateOne({ownerId:U.id},{$push:{turns:{$each:[{id:legacy,text:'STATUS_LEGACY_QUESTION',at:old,answeredAt:old,proposal:reply('STATUS_LEGACY_REPLY')}],$position:0}}});
   s=await statusOk(await status.workspace(U.token),'SETUP');assert.equal(s.replies.unread,1,'status:legacy-unknown');assert.equal(s.replies.legacyUnknown,1,'status:legacy-unknown');assert.equal(s.replies.readable,3,'status:readable-count');seen('legacy|unknown-not-unread');
   const conv2=(await ok(WORKSPACE,U.token)).conversation,base2={conversationId:conv2.id,segment:conv2.segment};
   r=await read.workspace(U.token,{...base2,replies:[{turnId:legacy,replyVersion:1}]});assert.equal(r.status,409,'status:legacy-exact '+r.status);
   r=await read.workspace(U.token,{...base2,replies:[{turnId:legacy,replyVersion:0}]});assert.equal(r.status,200,'status:legacy-ack '+r.raw.slice(0,200));
   assert.equal(turnOf(await owners.findOne({ownerId:U.id}),legacy).seenReplyVersion,0,'status:legacy-ack');assert.equal(r.data.replies.legacyUnknown,0,'status:legacy-ack');assert.equal(r.data.replies.unread,1,'status:legacy-ack');seen('legacy|acknowledged-zero');
   const t3=await wsSent(U.token,'STATUS_T3_QUESTION');const conv3=(await ok(WORKSPACE,U.token)).conversation;
   r=await read.workspace(U.token,{conversationId:conv3.id,segment:conv3.segment,replies:[{turnId:t3,replyVersion:0}]});assert.equal(r.status,409,'status:unreadable-not-ackable '+r.status);seen('ack|queued-turn');
   pass('owner workspace: closed status route, exact reply versions, pure read, legacy unknown, failure/retry/lease/capability and exact acknowledgement without revision change');
  }

  // 2. Company conversations: actor and company separation, fresh membership on the new routes, revocation and recovery, foreign
  //    conversation refusal, and a new chat (segment) that archives earlier replies out of the status.
  if(wants('company')){
   const P=await register('company-owner','Synthetic company owner'),Q=await register('company-member','Synthetic company member');
   const A=await company('a','Synthetic status A',[member(P,'owner'),member(Q,'member')]),B=await company('b','Synthetic status B',[member(P,'owner')]);
   const pa=await switchTo(P,A),pb=await switchTo(P,B),qa=await switchTo(Q,A);
   const WP=await workerOf(P,[await card(P,'21111')],{workspaceEnabled:true}),WQ=await workerOf(Q,[await card(Q,'22222')],{workspaceEnabled:true});await beat(WP);await beat(WQ);
   const q1=await coSent(qa,'STATUS_COMPANY_QUESTION');let job=await claim(WQ,'SETUP company claim');assert.equal(job.companyScoped,true,'SETUP company job');await answered(WQ,job,'STATUS_COMPANY_REPLY');
   let r=await status.company(qa);assert.equal(r.status,200,'status:company-route '+r.status+' '+r.raw.slice(0,200));let s=r.data;
   assert.equal(s.realm,'company','status:company-shape');assert.equal(s.company?.id,String(A),'status:company-scope');assert.equal(s.scope.organizationId,String(A),'status:company-scope');assert.equal(s.scope.actorId,String(Q.id),'status:company-scope');
   assert.equal(s.replies.unread,1,'status:company-unread');assert.equal(turnOf(await companies.findOne({ownerId:Q.id,organizationId:A}),q1).replyVersion,1,'status:company-version');noPrivate(r.raw,['STATUS_COMPANY_REPLY','STATUS_COMPANY_QUESTION'],'status:no-text');seen('route|company');
   s=await statusOk(await status.company(pa),'SETUP');assert.equal(s.conversation,null,'status:actor-isolation');assert.equal(s.replies.unread,0,'status:actor-isolation');seen('isolation|actor');
   s=await statusOk(await status.company(pb),'SETUP');assert.equal(s.replies.unread,0,'status:company-isolation');assert.equal(s.company.id,String(B),'status:company-isolation');seen('isolation|company');
   assert.equal((await status.company(P.token)).status,403,'status:company-selection-required');seen('isolation|no-selection');
   const qconv=(await ok(COMPANY,qa)).conversation,qbase={conversationId:qconv.id,segment:qconv.segment};
   const before=await snapshot();
   r=await read.company(pa,{...qbase,replies:[{turnId:q1,replyVersion:1}]});assert.equal(r.status,409,'status:foreign-conversation '+r.status);
   r=await read.company(pb,{...qbase,replies:[{turnId:q1,replyVersion:1}]});assert.equal(r.status,409,'status:foreign-conversation '+r.status);
   assert.equal(await snapshot(),before,'status:foreign-conversation');seen('isolation|foreign-ack');
   await orgs.updateOne({_id:A},{$pull:{members:{userId:Q.id}}});// SETUP synthetic membership removal
   r=await status.company(qa);assert.equal(r.status,403,'status:revoked-refused '+r.status);r=await read.company(qa,{...qbase,replies:[{turnId:q1,replyVersion:1}]});assert.equal(r.status,403,'status:revoked-refused '+r.status);
   assert.equal(turnOf(await companies.findOne({ownerId:Q.id,organizationId:A}),q1).seenReplyVersion,undefined,'status:revoked-refused');seen('membership|revoked');
   await orgs.updateOne({_id:A},{$push:{members:member(Q,'member')}});// SETUP membership restored
   s=await statusOk(await status.company(qa),'status:restored-recovers');assert.equal(s.replies.unread,1,'status:restored-recovers');seen('membership|restored');
   r=await read.company(qa,{...qbase,replies:[{turnId:q1,replyVersion:1}]});assert.equal(r.status,200,'status:company-ack '+r.raw.slice(0,200));assert.equal(r.data.replies.unread,0,'status:company-ack');
   const cdoc=await companies.findOne({ownerId:Q.id,organizationId:A});assert.equal(turnOf(cdoc,q1).seenReplyVersion,1,'status:company-ack');assert.equal(cdoc.revision,qconv.revision,'status:send-revision-unchanged');seen('ack|company');
   const q2=await coSent(qa,'STATUS_COMPANY_SECOND');job=await claim(WQ,'SETUP company claim 2');await answered(WQ,job,'STATUS_COMPANY_SECOND_REPLY');
   s=await statusOk(await status.company(qa),'SETUP');assert.equal(s.replies.unread,1,'status:company-unread');assert.deepEqual(s.replies.latestUnread,{turnId:q2,replyVersion:1},'status:company-unread');
   await ok(COMPANY+'/new',qa,'POST',{chatRevision:(await ok(COMPANY,qa)).conversation.revision,requestId:hex32()});
   s=await statusOk(await status.company(qa),'SETUP');assert.equal(s.conversation.segment,1,'status:reset-segment');assert.equal(s.replies.unread,0,'status:reset-segment');assert.equal(s.replies.readable,0,'status:archive-excluded');seen('reset|company');
   r=await read.company(qa,{conversationId:qconv.id,segment:0,replies:[{turnId:q2,replyVersion:1}]});assert.equal(r.status,409,'status:stale-segment-after-reset '+r.status);
   s=await statusOk(await status.company(pb),'SETUP');assert.equal(s.replies.unread,0,'status:company-isolation');
   pass('company conversations: actor/company separation, fresh membership on status and read, revocation and recovery, foreign refusal and new-chat segments');
  }

  // 3. Purchase conversations and the linked research follow-up: exact reply and report versions, the research link to a live turn,
  //    unrelated/failed/applied research, no recovery writes from status, owned import/line authority and a new chat that unlinks.
  if(wants('purchase')){
   const V=await register('purchase','Synthetic purchase owner'),acct=await card(V,'31111'),importId=await statement(V,acct,['Synthetic status purchase two','Synthetic status purchase three']);
   const WV=await workerOf(V,[acct],{workspaceEnabled:true}),RV=await workerOf(V,[acct],{researchEnabled:true});await beat(WV);await researchAlive(RV);
   const other=await register('purchase-other','Synthetic other owner');
   let r=await status.purchase(V.token,importId,2);assert.equal(r.status,200,'status:purchase-route '+r.status+' '+r.raw.slice(0,200));let s=r.data;
   assert.equal(s.realm,'purchase','status:purchase-shape');assert.equal(s.conversation,null,'status:purchase-empty');assert.equal(s.research,null,'status:purchase-empty');assert.equal(s.connected,true,'status:purchase-connected');
   assert.equal(s.scope.importId,importId,'status:scope-echo');assert.equal(s.scope.line,2,'status:scope-echo');seen('route|purchase');
   assert.equal((await status.purchase(other.token,importId,2)).status,404,'status:foreign-import');assert.equal((await status.purchase(V.token,importId,99)).status,404,'status:missing-line');
   assert.equal((await read.purchase(other.token,importId,2,{conversationId:new ObjectId().toHexString(),segment:0,replies:[{turnId:hex32(),replyVersion:1}]})).status,404,'status:foreign-import');seen('isolation|foreign-import');
   const p1=await puSent(V.token,importId,2,'STATUS_PURCHASE_QUESTION');let job=await chatClaim(WV,'SETUP purchase claim');
   r=await chatAnswer(WV,job,reply('STATUS_PURCHASE_REPLY','STATUS synthetic research: 勘定科目・税率と運営会社の登録番号を確認'));assert.equal(r.status,200,'SETUP purchase reply '+r.raw.slice(0,300));
   const identity={ownerId:V.id,importId:new ObjectId(importId),line:2};let chat=await purchases.findOne(identity);const linkedRequest=turnOf(chat,p1)?.research?.requestId;
   assert.equal(turnOf(chat,p1).replyVersion,1,'status:purchase-version');assert.ok(linkedRequest,'SETUP research started from the turn');
   r=await status.purchase(V.token,importId,2);s=await statusOk(r,'SETUP');
   assert.equal(s.replies.unread,1,'status:purchase-unread');assert.equal(s.research?.requestId,linkedRequest,'status:research-linked');assert.equal(s.research.turnId,p1,'status:research-linked');
   assert.equal(s.research.state,'queued','status:research-queued');assert.equal(s.research.unread,false,'status:research-no-report');assert.equal(s.research.available,false,'status:research-no-report');noPrivate(r.raw,['STATUS_PURCHASE_REPLY','STATUS_PURCHASE_QUESTION'],'status:no-text');seen('research|queued-linked');
   await finishResearch(RV,'SETUP research job');
   let row=await researches.findOne(identity);assert.equal(row.reportVersion,1,'status:report-version');seen('version|report');
   r=await status.purchase(V.token,importId,2);s=await statusOk(r,'SETUP');assert.equal(s.research.unread,true,'status:research-unread');assert.equal(s.research.reportVersion,1,'status:research-unread');assert.equal(s.research.state,'ready','status:research-ready');assert.equal(s.research.available,true,'status:research-unread');
   noPrivate(r.raw,['STATUS_RESEARCH_SUMMARY','T1234567890123'],'status:no-text');
   const pureBefore=await snapshot();for(let i=0;i<3;i++)await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(await snapshot(),pureBefore,'status:get-pure');seen('pure|purchase');
   const view=(await ok(researchPath(importId,2),V.token)).research;assert.equal(view.requestId,linkedRequest,'status:research-projection');assert.equal(view.reportVersion,1,'status:research-projection');seen('research|visible-projection');
   const conv=(await ok(chatPath(importId,2),V.token)).conversation,base={conversationId:conv.id,segment:conv.segment},researchAck={researchId:view.id,requestId:view.requestId,reportVersion:1,turnId:p1};
   r=await read.purchase(V.token,importId,2,{...base,research:{...researchAck,reportVersion:2}});assert.equal(r.status,409,'status:research-exact-version '+r.status);
   r=await read.purchase(V.token,importId,2,{...base,research:{...researchAck,requestId:crypto.randomUUID()}});assert.equal(r.status,409,'status:research-exact-request '+r.status);
   r=await read.purchase(V.token,importId,2,{...base,research:{...researchAck,researchId:new ObjectId().toHexString()}});assert.equal(r.status,409,'status:research-exact-row '+r.status);
   r=await read.purchase(V.token,importId,2,{...base,research:{...researchAck,turnId:hex32()}});assert.equal(r.status,409,'status:research-link-turn '+r.status);seen('ack|research-refusals');
   const rowBefore=JSON.stringify(await researches.findOne(identity));
   r=await read.purchase(V.token,importId,2,{...base,replies:[{turnId:p1,replyVersion:1}],research:researchAck});assert.equal(r.status,200,'status:purchase-ack '+r.raw.slice(0,200));
   assert.equal(r.data.replies.unread,0,'status:purchase-ack');assert.equal(r.data.research.unread,false,'status:research-ack');assert.equal(r.data.acknowledged?.research,true,'status:research-ack');
   chat=await purchases.findOne(identity);assert.equal(turnOf(chat,p1).seenReplyVersion,1,'status:purchase-ack');assert.equal(turnOf(chat,p1).seenResearchVersion,1,'status:research-ack');assert.equal(chat.revision,conv.revision,'status:send-revision-unchanged');
   assert.equal(JSON.stringify(await researches.findOne(identity)),rowBefore,'status:research-ack-no-research-write');seen('ack|reply-and-research');
   const applied=await call(researchPath(importId,2)+'/apply',V.token,'POST',{...bind(await ok(draftPath(importId,2),V.token)),researchRevision:view.revision,confirm:true,fields:['invoiceNumber']});assert.equal(applied.status,200,'SETUP apply '+applied.raw.slice(0,300));
   row=await researches.findOne(identity);assert.equal(row.state,'applied','SETUP applied');assert.equal(row.reportVersion,1,'status:apply-no-new-report');
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.research.unread,false,'status:apply-no-new-report');assert.equal(s.research.state,'applied','status:apply-no-new-report');seen('research|apply-no-arrival');
   const p2=await puSent(V.token,importId,2,'STATUS_PURCHASE_SECOND');job=await chatClaim(WV,'SETUP purchase claim 2');
   r=await chatAnswer(WV,job,reply('STATUS_PURCHASE_SECOND_REPLY','STATUS synthetic second research: 税区分を確認'));assert.equal(r.status,200,'SETUP purchase reply 2 '+r.raw.slice(0,300));
   const secondRequest=turnOf(await purchases.findOne(identity),p2).research?.requestId;assert.ok(secondRequest&&secondRequest!==linkedRequest,'SETUP second research');
   await failResearch(RV,'SETUP research job 2');row=await researches.findOne(identity);assert.equal(row.reportVersion,1,'status:research-failure-no-version');
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.research.state,'failed','status:research-failed');assert.equal(s.research.unread,false,'status:research-failure-no-version');assert.equal(s.research.turnId,p2,'status:research-linked');assert.equal(s.replies.unread,1,'status:purchase-unread');seen('research|failure');
   const draft=await ok(draftPath(importId,2),V.token),manual=await call(researchPath(importId,2),V.token,'POST',{...bind(draft),researchRevision:row.revision,requestId:crypto.randomUUID(),instruction:'STATUS synthetic manual research'});assert.equal(manual.status,200,'SETUP manual research '+manual.raw.slice(0,300));
   await finishResearch(RV,'SETUP manual research job');row=await researches.findOne(identity);assert.equal(row.reportVersion,2,'status:report-version');
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.research,null,'status:research-unlinked-excluded');assert.equal(s.replies.unread,1,'status:research-unlinked-excluded');seen('research|unrelated-excluded');
   const manualView=(await ok(researchPath(importId,2),V.token)).research;
   r=await read.purchase(V.token,importId,2,{...base,research:{researchId:manualView.id,requestId:manualView.requestId,reportVersion:2,turnId:p2}});assert.equal(r.status,409,'status:research-unlinked-not-ackable '+r.status);
   // SETUP synthetic stuck recovery states the full getters recover; the lightweight status must leave them untouched.
   await purchases.updateOne({_id:chat._id},{$set:{state:'confirming',lease:'synthetic-expired',leaseUntil:new Date(Date.now()-60000)}});
   await researches.updateOne({_id:row._id},{$set:{state:'applying',lease:'synthetic-expired',leaseUntil:new Date(Date.now()-60000)}});
   const frozen=await snapshot();for(let i=0;i<2;i++)await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(await snapshot(),frozen,'status:no-recovery-write');
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.conversation.state,'confirming','status:no-recovery-write');seen('pure|no-recovery');
   await ok(chatPath(importId,2),V.token);await ok(researchPath(importId,2),V.token);
   assert.notEqual((await purchases.findOne(identity)).state,'confirming','SETUP the native full getter still recovers');assert.notEqual((await researches.findOne(identity)).state,'applying','SETUP the native research getter still recovers');
   const p3=await puSent(V.token,importId,3,'STATUS_PURCHASE_LINE_THREE');job=await chatClaim(WV,'SETUP line three claim');assert.equal((await chatAnswer(WV,job,reply('STATUS_LINE_THREE_REPLY'))).status,200,'SETUP line three reply');
   s=await statusOk(await status.purchase(V.token,importId,3),'SETUP');assert.equal(s.replies.unread,1,'status:line-isolation');assert.deepEqual(s.replies.latestUnread,{turnId:p3,replyVersion:1},'status:line-isolation');
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.replies.latestUnread?.turnId,p2,'status:line-isolation');seen('isolation|line');
   const fresh=(await ok(chatPath(importId,2),V.token)).conversation;await ok(chatPath(importId,2)+'/new',V.token,'POST',{chatRevision:fresh.revision,requestId:hex32()});
   s=await statusOk(await status.purchase(V.token,importId,2),'SETUP');assert.equal(s.research,null,'status:reset-unlinks-research');assert.equal(s.replies.readable,0,'status:reset-unlinks-research');assert.equal(s.conversation.segment,fresh.segment+1,'status:reset-segment');seen('reset|purchase');
   pass('purchase conversations: exact reply and report versions, the research link to a live turn, failed/applied/unrelated research, no recovery writes, import/line authority and new-chat unlinking');
  }

  // 4. Company-teaching masking: an owner turn that used company A's teachings counts and acknowledges only while A is the checked
  //    selection, and a purchase research follow-up linked to such a turn is withheld outside A.
  if(wants('mask')){
   const M=await register('mask','Synthetic mask owner'),MA=await company('mask-a','Synthetic mask A',[]),MB=await company('mask-b','Synthetic mask B',[]);
   await orgs.updateMany({_id:{$in:[MA,MB]}},{$set:{members:[member(M,'owner')]}});
   const ma=await switchTo(M,MA),mb=await switchTo(M,MB),acct=await card(M,'41111'),WM=await workerOf(M,[acct],{workspaceEnabled:true}),RM=await workerOf(M,[acct],{researchEnabled:true});await beat(WM);await researchAlive(RM);
   const teaching='STATUSMASK は会議費として扱う',teach=await coSent(ma,'覚えて: '+teaching);let job=await claim(WM,'SETUP teaching claim');
   let r=await chatWorker(WM,'workspace/'+job.id+'/actions',{lease:job.lease,name:'remember_company_knowledge',args:{instruction:teaching,merchant:'STATUSMASK'},slot:1});assert.equal(r.status,200,'SETUP remember '+r.raw.slice(0,300));await answered(WM,job,'SETUP teaching saved');assert.ok(teach,'SETUP teaching turn');
   const w1=await wsSent(ma,'STATUSMASK の扱いを教えて');job=await claim(WM,'SETUP owner claim');assert.ok(job.teachingCompany,'SETUP teaching authority');await answered(WM,job,'STATUS_MASKED_REPLY');
   assert.equal(turnOf(await owners.findOne({ownerId:M.id}),w1)?.companyContext?.organizationId,String(MA),'SETUP tagged turn');
   let s=await statusOk(await status.workspace(ma),'SETUP');assert.equal(s.replies.unread,1,'status:masked-visible-own-company');assert.equal(s.scope.organizationId,String(MA),'status:scope-echo');
   s=await statusOk(await status.workspace(mb),'SETUP');assert.equal(s.replies.unread,0,'status:masked-turns');assert.equal(s.replies.readable,0,'status:masked-turns');
   s=await statusOk(await status.workspace(M.token),'SETUP');assert.equal(s.replies.unread,0,'status:masked-turns');seen('mask|workspace');
   const mconv=(await ok(WORKSPACE,mb)).conversation;
   r=await read.workspace(mb,{conversationId:mconv.id,segment:mconv.segment,replies:[{turnId:w1,replyVersion:1}]});assert.equal(r.status,409,'status:withheld-not-ackable '+r.status);
   r=await read.workspace(M.token,{conversationId:mconv.id,segment:mconv.segment,replies:[{turnId:w1,replyVersion:1}]});assert.equal(r.status,409,'status:withheld-not-ackable '+r.status);
   assert.equal(turnOf(await owners.findOne({ownerId:M.id}),w1).seenReplyVersion,undefined,'status:withheld-not-ackable');seen('mask|withheld-ack');
   r=await read.workspace(ma,{conversationId:mconv.id,segment:mconv.segment,replies:[{turnId:w1,replyVersion:1}]});assert.equal(r.status,200,'status:masked-own-company-ack '+r.raw.slice(0,200));assert.equal(turnOf(await owners.findOne({ownerId:M.id}),w1).seenReplyVersion,1,'status:masked-own-company-ack');
   const importM=await statement(M,acct,['STATUSMASK synthetic shop']),p=await puSent(ma,importM,2,'この購入の候補を調べて');job=await chatClaim(WM,'SETUP purchase mask claim');assert.ok(job.teachingCompany,'SETUP purchase teaching authority');
   r=await chatAnswer(WM,job,reply('STATUS_MASKED_PURCHASE_REPLY','STATUS synthetic masked research: 勘定科目を確認'));assert.equal(r.status,200,'SETUP masked purchase reply '+r.raw.slice(0,300));
   const identity={ownerId:M.id,importId:new ObjectId(importM),line:2};assert.equal(turnOf(await purchases.findOne(identity),p)?.companyContext?.organizationId,String(MA),'SETUP tagged purchase turn');
   await finishResearch(RM,'SETUP masked research job');
   s=await statusOk(await status.purchase(ma,importM,2),'SETUP');assert.equal(s.research?.unread,true,'status:masked-research-own-company');assert.equal(s.replies.unread,1,'status:masked-research-own-company');
   s=await statusOk(await status.purchase(mb,importM,2),'SETUP');assert.equal(s.research,null,'status:masked-research-excluded');assert.equal(s.replies.unread,0,'status:masked-research-excluded');seen('mask|purchase-research');
   const pconv=(await ok(chatPath(importM,2),mb)).conversation,rview=(await ok(researchPath(importM,2),mb)).research;
   r=await read.purchase(mb,importM,2,{conversationId:pconv.id,segment:pconv.segment,research:{researchId:rview.id,requestId:rview.requestId,reportVersion:rview.reportVersion,turnId:p}});assert.equal(r.status,409,'status:withheld-research-not-ackable '+r.status);
   assert.equal(turnOf(await purchases.findOne(identity),p).seenResearchVersion,undefined,'status:withheld-research-not-ackable');
   pass('company-teaching masking: withheld owner and purchase turns neither count nor acknowledge outside their company, and their research follow-up stays withheld');
  }

  // 5. Races: two tabs acknowledging different replies, a new reply finishing while an older one is acknowledged, an acknowledgement
  //    racing a new chat, and a delayed old acknowledgement after the reset. Each race repeats; only the finish moves the revision.
  if(wants('race')){
   const Z=await register('race','Synthetic race owner'),acct=await card(Z,'51111'),WZ=await workerOf(Z,[acct],{workspaceEnabled:true});await beat(WZ);
   const answeredTurn=async text=>{const id=await wsSent(Z.token,text);const job=await claim(WZ,'SETUP race claim');await answered(WZ,job,text+'_REPLY');return id};
   const z1=await answeredTurn('STATUS_RACE_ONE'),z2=await answeredTurn('STATUS_RACE_TWO');
   let conv=(await ok(WORKSPACE,Z.token)).conversation;const base={conversationId:conv.id,segment:conv.segment};
   const [ra,rb]=await Promise.all([read.workspace(Z.token,{...base,replies:[{turnId:z1,replyVersion:1}]}),read.workspace(Z.token,{...base,replies:[{turnId:z2,replyVersion:1}]})]);
   assert.equal(ra.status,200,'status:parallel-acks '+ra.raw.slice(0,200));assert.equal(rb.status,200,'status:parallel-acks '+rb.raw.slice(0,200));
   let doc=await owners.findOne({ownerId:Z.id});assert.equal(turnOf(doc,z1).seenReplyVersion,1,'status:parallel-acks');assert.equal(turnOf(doc,z2).seenReplyVersion,1,'status:parallel-acks');assert.equal(doc.revision,conv.revision,'status:send-revision-unchanged');seen('race|parallel-tabs');
   let previous=z2;
   for(let round=0;round<3;round++){
    const id=await wsSent(Z.token,'STATUS_RACE_NEW_'+round),job=await claim(WZ,'SETUP racing claim'),revision=(await owners.findOne({ownerId:Z.id})).revision;
    const [fin,ack]=await Promise.all([answer(WZ,job,'STATUS_RACE_NEW_REPLY_'+round),read.workspace(Z.token,{...base,replies:[{turnId:previous,replyVersion:1}]})]);
    assert.equal(fin.status,200,'SETUP racing reply');assert.equal(ack.status,200,'status:race-ack '+ack.raw.slice(0,200));
    doc=await owners.findOne({ownerId:Z.id});assert.equal(turnOf(doc,id).seenReplyVersion,undefined,'status:race-new-reply-unread');assert.equal(doc.revision,revision+1,'status:race-revision');
    const s=await statusOk(await status.workspace(Z.token),'SETUP');assert.equal(s.replies.unread,1,'status:race-new-reply-unread');assert.deepEqual(s.replies.latestUnread,{turnId:id,replyVersion:1},'status:race-new-reply-unread');
    const ackNew=await read.workspace(Z.token,{...base,replies:[{turnId:id,replyVersion:1}]});assert.equal(ackNew.status,200,'status:race-ack');previous=id;
   }
   seen('race|new-reply-during-ack');
   const last=await answeredTurn('STATUS_RACE_LAST');conv=(await ok(WORKSPACE,Z.token)).conversation;
   const [ack,reset]=await Promise.all([read.workspace(Z.token,{...base,replies:[{turnId:last,replyVersion:1}]}),call(WORKSPACE+'/new',Z.token,'POST',{chatRevision:conv.revision,requestId:hex32()})]);
   assert.ok([200,409].includes(ack.status),'status:race-reset ack '+ack.status+' '+ack.raw.slice(0,200));assert.equal(reset.status,200,'status:race-reset reset '+reset.raw.slice(0,200));
   const s=await statusOk(await status.workspace(Z.token),'SETUP');assert.equal(s.conversation.segment,base.segment+1,'status:race-reset');assert.equal(s.replies.unread,0,'status:race-reset');assert.equal(s.replies.readable,0,'status:race-reset');
   const late=await read.workspace(Z.token,{...base,replies:[{turnId:z1,replyVersion:1}]});assert.equal(late.status,409,'status:race-old-ack-after-reset '+late.status);seen('race|reset');
   pass('races: parallel tab acknowledgements, new replies finishing during an acknowledgement (3 rounds), acknowledgement against a new chat and a late old acknowledgement');
  }

  // 6. Work deadlines: a job is in progress only while its own native deadline is ahead. A fresh worker heartbeat never makes an
  //    expired, exhausted or deadline-less reply, confirmation, research or report apply look in progress; the raw native state stays,
  //    status reads stay pure and no lease leaves the server. The native claim then takes an expired job over and records an exhausted
  //    one as failed, as the work state said; the open chat's getters still recover an interrupted confirmation/apply. A passed deadline
  //    is synthetic setup (time passing: only leaseUntil, or the state a native lock sets), each named.
  if(wants('lease')){
   const L=await register('lease','Synthetic lease owner'),acct=await card(L,'71111'),WL=await workerOf(L,[acct],{workspaceEnabled:true}),RL=await workerOf(L,[acct],{researchEnabled:true});await beat(WL);await researchAlive(RL);
   const ago=()=>new Date(Date.now()-60000),ahead=()=>new Date(Date.now()+60000);
   // SETUP both workers stay fresh before every send and claim (sends and research starts need a live worker), however slow the host.
   const fresh=async()=>{await beat(WL);await researchAlive(RL)};
   // Owner workspace: queued, active, expired with a fresh worker, takeover, exhausted, the native failure, and no deadline at all.
   await wsSent(L.token,'STATUS_LEASE_QUESTION');
   let s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.state,'queued','SETUP queued');assert.equal(s.conversation.work,null,'status:queued-no-work');
   let job=await claim(WL,'SETUP lease claim');
   s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.state,'working','SETUP working');assert.equal(s.conversation.work,'active','status:active-work');seen('lease|active');
   await owners.updateOne({ownerId:L.id},{$set:{leaseUntil:ago()}});// SETUP synthetic: the claim's deadline passed with no finish or renewal
   await beat(WL);let r=await status.workspace(L.token);s=await statusOk(r,'SETUP');
   assert.equal(s.connected,true,'SETUP fresh worker');assert.equal(s.conversation.state,'working','status:raw-state-kept');assert.equal(s.conversation.work,'expired','status:expired-not-active');
   noPrivate(r.raw,[job.lease],'status:no-lease');seen('lease|expired-fresh-worker');
   let frozen=await snapshot();for(let i=0;i<3;i++)await statusOk(await status.workspace(L.token),'SETUP');assert.equal(await snapshot(),frozen,'status:expired-pure');seen('pure|expired');
   r=await answer(WL,job,'STATUS_LEASE_LATE_REPLY');assert.equal(r.status,409,'SETUP native: a passed deadline refuses the old claim '+r.status);
   await fresh();job=await claim(WL,'SETUP native takeover of expired work');
   s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.work,'active','status:takeover-active');seen('lease|takeover');
   await owners.updateOne({ownerId:L.id},{$set:{leaseUntil:ago()}});// SETUP synthetic: the last allowed claim's deadline passed
   s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.state,'working','status:raw-state-kept');assert.equal(s.conversation.work,'exhausted','status:exhausted-not-active');seen('lease|exhausted');
   await fresh();r=await chatWorker(WL,'workspace-claim',{});assert.equal(r.status,200,'SETUP claim '+r.raw.slice(0,200));assert.equal(r.data.job,null,'SETUP native: exhausted work is not claimed again');
   s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.state,'failed','status:exhausted-native-failure');assert.equal(s.conversation.work,null,'status:failed-no-work');seen('lease|exhausted-native-failure');
   // Company conversation: the same deadline rule under fresh membership.
   const LC=await company('lease','Synthetic lease company',[member(L,'owner')]),lc=await switchTo(L,LC);
   await fresh();await coSent(lc,'STATUS_LEASE_COMPANY');job=await claim(WL,'SETUP lease company claim');assert.equal(job.companyScoped,true,'SETUP company job');
   s=await statusOk(await status.company(lc),'SETUP');assert.equal(s.conversation.work,'active','status:active-work');
   await companies.updateOne({ownerId:L.id,organizationId:LC},{$set:{leaseUntil:ago()}});// SETUP synthetic: deadline passed
   await beat(WL);r=await status.company(lc);s=await statusOk(r,'SETUP');assert.equal(s.connected,true,'SETUP fresh worker');assert.equal(s.conversation.state,'working','status:raw-state-kept');assert.equal(s.conversation.work,'expired','status:expired-not-active');
   noPrivate(r.raw,[job.lease],'status:no-lease');seen('lease|company-expired');
   // Purchase conversation: a reply job, the confirmation lock, and the linked research job and its report apply.
   const importL=await statement(L,acct,['Synthetic lease purchase']),pid={ownerId:L.id,importId:new ObjectId(importL),line:2};
   await fresh();await puSent(L.token,importL,2,'STATUS_LEASE_PURCHASE');job=await chatClaim(WL,'SETUP lease purchase claim');
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.conversation.work,'active','status:active-work');
   await purchases.updateOne(pid,{$set:{leaseUntil:ago()}});// SETUP synthetic: deadline passed
   await beat(WL);s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.connected,true,'SETUP fresh worker');assert.equal(s.conversation.work,'expired','status:expired-not-active');seen('lease|purchase-expired');
   await fresh();job=await chatClaim(WL,'SETUP native purchase takeover');
   r=await chatAnswer(WL,job,reply('STATUS_LEASE_PURCHASE_REPLY','STATUS synthetic lease research: 税率と登録番号を確認'));assert.equal(r.status,200,'SETUP lease purchase reply '+r.raw.slice(0,300));
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research?.state,'queued','SETUP linked research queued');assert.equal(s.research.work,null,'status:queued-no-work');
   let c=await researchWorker(RL,'claim');assert.equal(c.status,200,'SETUP research claim '+c.raw.slice(0,200));assert.ok(c.data.job,'SETUP research job');
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.state,'working','SETUP research working');assert.equal(s.research.work,'active','status:research-active');
   await researches.updateOne(pid,{$set:{leaseUntil:ago()}});// SETUP synthetic: the research claim's deadline passed
   await researchAlive(RL);await beat(WL);r=await status.purchase(L.token,importL,2);s=await statusOk(r,'SETUP');
   assert.equal(s.research.state,'working','status:raw-state-kept');assert.equal(s.research.work,'expired','status:research-expired-not-active');noPrivate(r.raw,[c.data.job.lease],'status:no-lease');seen('lease|research-expired');
   c=await researchWorker(RL,'claim');assert.ok(c.data?.job,'SETUP native research takeover');
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.work,'active','status:takeover-active');
   await researches.updateOne(pid,{$set:{leaseUntil:ago()}});// SETUP synthetic: the last allowed research claim's deadline passed
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.work,'exhausted','status:research-exhausted-not-active');seen('lease|research-exhausted');
   c=await researchWorker(RL,'claim');assert.equal(c.status,200,'SETUP research claim');assert.equal(c.data.job,null,'SETUP native: exhausted research is not claimed again');
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.state,'failed','status:exhausted-native-failure');assert.equal(s.research.work,null,'status:failed-no-work');
   // A second linked report, then its apply lock: active while ahead, expired once passed; the research getter still recovers it.
   await fresh();await puSent(L.token,importL,2,'STATUS_LEASE_PURCHASE_TWO');job=await chatClaim(WL,'SETUP lease purchase claim two');
   r=await chatAnswer(WL,job,reply('STATUS_LEASE_PURCHASE_REPLY_TWO','STATUS synthetic lease research two: 税区分を確認'));assert.equal(r.status,200,'SETUP lease purchase reply two '+r.raw.slice(0,300));
   await finishResearch(RL,'SETUP lease research report');
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.state,'ready','SETUP report ready');assert.equal(s.research.work,null,'status:ready-no-work');
   await researches.updateOne(pid,{$set:{state:'applying',lease:'synthetic-apply-lock',leaseUntil:ahead()}});// SETUP synthetic: an apply in progress
   r=await status.purchase(L.token,importL,2);s=await statusOk(r,'SETUP');assert.equal(s.research.work,'active','status:apply-active');noPrivate(r.raw,['synthetic-apply-lock'],'status:no-lease');
   await researches.updateOne(pid,{$set:{leaseUntil:ago()}});// SETUP synthetic: the apply lock's deadline passed (an interrupted apply)
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.research.state,'applying','status:raw-state-kept');assert.equal(s.research.work,'expired','status:apply-expired-not-active');seen('lease|apply-expired');
   // The confirmation lock of the purchase conversation (set by the owner's confirm), active then interrupted.
   await purchases.updateOne(pid,{$set:{state:'confirming',lease:'synthetic-confirm-lock',leaseUntil:ahead()}});// SETUP synthetic: a confirmation in progress
   r=await status.purchase(L.token,importL,2);s=await statusOk(r,'SETUP');assert.equal(s.conversation.work,'active','status:confirm-active');noPrivate(r.raw,['synthetic-confirm-lock'],'status:no-lease');
   await purchases.updateOne(pid,{$set:{leaseUntil:ago()}});// SETUP synthetic: the confirmation lock's deadline passed
   s=await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(s.conversation.state,'confirming','status:raw-state-kept');assert.equal(s.conversation.work,'expired','status:confirm-expired-not-active');seen('lease|confirm-expired');
   frozen=await snapshot();for(let i=0;i<3;i++)await statusOk(await status.purchase(L.token,importL,2),'SETUP');assert.equal(await snapshot(),frozen,'status:expired-pure');
   await ok(chatPath(importL,2),L.token);await ok(researchPath(importL,2),L.token);
   assert.notEqual((await purchases.findOne(pid)).state,'confirming','SETUP the native full getter still recovers the confirmation');assert.notEqual((await researches.findOne(pid)).state,'applying','SETUP the native research getter still recovers the apply');
   // A working state with no deadline at all (no native writer leaves one): never progress, and no claim takes it over.
   await fresh();assert.equal((await call(WORKSPACE+'/retry',L.token,'POST',{chatRevision:(await ok(WORKSPACE,L.token)).conversation.revision})).status,200,'SETUP retry');
   job=await claim(WL,'SETUP claim after retry');await owners.updateOne({ownerId:L.id},{$unset:{leaseUntil:''}});// SETUP synthetic: deadline missing
   s=await statusOk(await status.workspace(L.token),'SETUP');assert.equal(s.conversation.state,'working','status:raw-state-kept');assert.equal(s.conversation.work,'missing','status:missing-deadline-not-active');seen('lease|missing');
   // The indicator the launcher shows for these facts (the source module's pure mapping; the built client is checked in gui-closed).
   const {naviIndicator}=await import(pathToFileURL(path.join(__dirname,'../shared/finance-navi-status.mjs')).href);
   const shown=(conversation,research,connected=true)=>naviIndicator({connected,conversation,replies:{unread:0},research})?.kind||null;
   assert.equal(shown({state:'working',work:'active'}),'working','indicator:active-working');assert.equal(shown({state:'working',work:'active'},null,false),'reconnect','indicator:offline-reconnect');
   for(const work of['expired','exhausted','missing',undefined])assert.equal(shown({state:'working',work}),'interrupted','indicator:'+work+'-not-progress');
   assert.equal(shown({state:'working',work:'expired'},null,false),'reconnect','indicator:expired-offline-reconnect');assert.equal(shown({state:'working',work:'exhausted'},null,false),'interrupted','indicator:exhausted-offline-not-reconnect');
   assert.equal(shown({state:'confirming',work:'active'}),'working','indicator:confirm-active');assert.equal(shown({state:'confirming',work:'expired'}),'interrupted','indicator:confirm-expired');
   assert.equal(shown({state:'ready',work:null},{state:'working',work:'active'}),'working','indicator:research-active');for(const work of['expired','exhausted','missing'])assert.equal(shown({state:'ready',work:null},{state:'working',work}),'interrupted','indicator:research-'+work);
   assert.equal(shown({state:'ready',work:null},{state:'applying',work:'active'}),null,'indicator:apply-active-unchanged');assert.equal(shown({state:'ready',work:null},{state:'applying',work:'expired'}),'interrupted','indicator:apply-expired');
   assert.equal(naviIndicator({connected:true,conversation:{state:'working',work:'expired'},replies:{unread:1},research:null}).kind,'new','indicator:unread-first');seen('lease|indicator-mapping');
   pass('work deadlines: only a job under its own live deadline shows progress; expired, exhausted and deadline-less replies, confirmations, research and applies with a fresh worker do not, raw states and purity kept, no lease returned, native takeover/failure/recovery unchanged');
  }

  // 7-13. Installed Chrome against the same app (scripts/finance-navi-status-browser.cjs).
  if(browserRunner)await browserRunner(ctx);
  console.log('SUMMARY '+JSON.stringify({groups,only:ONLY,cases:[...cases].sort(),timing}));
  console.log(groups+' Navi status groups passed');
 }catch(error){failure=error;console.log('APP_LOG '+JSON.stringify({exitCode:child?.exitCode??null,signal:child?.signalCode??null,tail:logs.slice(-4000)}))}
 // Owned cleanup: every step runs even when an earlier one fails, each problem is printed (CLEANUP), and none can replace the run's
 // own result. A starved host can be slower than the memory server's fixed 2 x 10 s kill wait: after the library's stop attempt,
 // wait for the process to disappear and remove only its own temporary dbPath. Never send another signal through an old numeric PID.
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
 await step('data',async()=>{if(directory){assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-navi-status-'));await fsp.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500})}});
 for(const p of problems)console.log('CLEANUP '+p);
 if(failure)throw failure;
 if(problems.length)throw Error('SETUP owned cleanup failed: '+problems.join(' | '));
}
main().catch(e=>{console.error(e);process.exitCode=1});

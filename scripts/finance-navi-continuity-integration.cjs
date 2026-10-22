'use strict';
// Navi turn continuity and workspace worker recovery (plan omf-navi-agent-continuity-20261022). Actual built native HTTP on an owned
// loopback app and an owned MongoMemoryServer; synthetic people, companies, workers and records only, with simulated worker replies.
// No model, provider, mail, bank, Slack or production address is reached. Group 1 is the lost-final-reply case: the unchanged
// baseline and the missing-receipt defect must fail there first. Each assertion label names the behaviour a defect must break;
// labels starting with SETUP are preparation, never evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_NAVI_CONTINUITY_APP_ROOT||path.join(__dirname,'..'));
const DB='navi_continuity_regression',PASSWORD='Synthetic-password-Only1!',EXPENSE='支出';
const ENDPOINT='/api/finance-chat/company-workspace',WORKSPACE='/api/finance-chat/workspace';
const CAPABILITY={version:1,webSearch:true,publicPage:true,chrome:false,registry:'connection_required'};
const pause=ms=>new Promise(r=>setTimeout(r,ms)),hex32=()=>crypto.randomBytes(16).toString('hex');
// Keys a model-facing projection must never carry (journal hashes, leases, request identity, native markers, stored job context).
const INTERNAL=['"payloadHash"','"lease"','"leaseUntil"','"requestHash"','"naviOperation"','"context"'];

async function main(){
 let mongo,client,child,directory,logs='',groups=0;const cases=new Set();
 const pass=name=>{groups++;console.log('PASS '+name)},seen=label=>cases.add(label);
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-continuity-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});const uri=mongo.getUri(DB);
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',GEMINI_API_KEY:'',BASE_URL:origin,OMF_COLLECTOR_PUBLIC_ORIGIN:'',OMF_TRUST_CLOUDFLARE_LOOPBACK:''},stdio:['ignore','pipe','pipe']});
  child.closed=new Promise(r=>child.once('exit',r));for(const s of[child.stdout,child.stderr]){s.setEncoding('utf8');s.on('data',v=>{logs=(logs+v).slice(-20000)})}
  let healthy=false;
  for(let i=0;i<150&&!healthy;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,DB,'SETUP owned database');healthy=true}}catch(e){if(e?.code==='ERR_ASSERTION')throw e}if(!healthy)await pause(200)}
  assert.ok(healthy,'SETUP owned app unavailable: '+logs.slice(-3000));
  client=await MongoClient.connect(uri);const db=client.db(DB);
  const tx=db.collection('transactions'),chats=db.collection('financecompanyassistants'),owners=db.collection('financeassistants'),agents=db.collection('financechatagents'),orgs=db.collection('organizations');
  const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'SETUP '+method+' '+route+' '+r.raw.slice(0,400));return r.data};

  // Two actors: company A has both (each keeps a separate conversation), company B has the owner only.
  const register=async(email,name)=>{const r=await ok('/api/auth/register',null,'POST',{email,password:PASSWORD,name});const u=await db.collection('users').findOne({email});return{id:u._id,token:r.tokens.accessToken}};
  const O1=await register('continuity-owner@example.invalid','Synthetic continuity owner'),O2=await register('continuity-colleague@example.invalid','Synthetic continuity colleague');
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),member=(u,role)=>({userId:u.id,role,joinedAt:now}),membersA=[member(O1,'owner'),member(O2,'member')],membersB=[member(O1,'owner')];
  await orgs.insertMany([{_id:A,name:'Synthetic continuity A',slug:'continuity-a',type:'business',isActive:true,members:membersA,createdAt:now,updatedAt:now},{_id:B,name:'PRIVATE continuity B',slug:'continuity-b',type:'business',isActive:true,members:membersB,createdAt:now,updatedAt:now}]);
  const switchTo=async(u,org)=>(await ok('/api/auth/switch-organization',u.token,'POST',{organizationId:String(org)})).tokens.accessToken;
  const a1=await switchTo(O1,A),b1=await switchTo(O1,B),a2=await switchTo(O2,A);
  // Replaceable workers through the native route: W1 (both cards) and W2 (second card only) are workspace workers of the owner, W3 is
  // her card-only worker, X belongs to the colleague. Tokens stay in this process.
  const card=async(u,number)=>(await ok('/api/finance/accounts',u.token,'POST',{name:'Synthetic card '+number,primaryCard:number,cardIdentifiers:[number],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const acct1=await card(O1,'11111'),acct2=await card(O1,'22222'),acct3=await card(O2,'33333');
  const workerOf=async(u,accounts,workspaceEnabled)=>{const a=await ok('/api/finance-chat/agents',u.token,'POST',{accountIds:accounts.map(x=>x._id),workspaceEnabled});return{id:a.id,_id:new ObjectId(a.id),token:a.token}};
  const W1=await workerOf(O1,[acct1,acct2],true),W2=await workerOf(O1,[acct2],true),W3=await workerOf(O1,[acct1],false),X=await workerOf(O2,[acct3],true);

  const worker=(w,route,body={})=>call('/api/finance-chat/worker/'+route,w.token,'POST',body);
  const beat=async w=>assert.equal((await worker(w,'heartbeat')).status,200,'SETUP heartbeat');
  const offline=w=>agents.updateOne({_id:w._id},{$set:{chatLastSeenAt:new Date(Date.now()-600000)}});
  const claimAs=async(w,capable=false)=>{const r=await worker(w,'workspace-claim',capable?{capabilities:{publicResearch:CAPABILITY}}:{});assert.equal(r.status,200,'SETUP claim request '+r.raw.slice(0,300));return r.data.job};
  const claim=async(w,label,capable=false)=>{const job=await claimAs(w,capable);assert.ok(job,label);return job};
  const act=(w,job,name,args={},slot=1)=>worker(w,'workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const actOk=async(w,job,name,args={},slot=1,label=name)=>{const r=await act(w,job,name,args,slot);assert.equal(r.status,200,'continuity:'+label+' '+r.raw.slice(0,400));return r.data};
  const answer=(w,job,summary='Synthetic continuity reply')=>worker(w,'workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary,patch:{},quotes:{}}});
  const answered=async(w,job,summary)=>assert.equal((await answer(w,job,summary)).status,200,'SETUP reply');
  const lose=(w,job)=>worker(w,'workspace/'+job.id+'/result',{lease:job.lease,failed:true});
  const send=async(token,text,context={page:'transactions'},revision)=>{const requestId=hex32(),chatRevision=revision!==undefined?revision:((await ok(ENDPOINT,token)).conversation?.revision||0);await ok(ENDPOINT,token,'POST',{requestId,chatRevision,text,context});return requestId};
  const companyChat=(u,org)=>chats.findOne({ownerId:u.id,organizationId:org});
  const expire=(id,extra={})=>chats.updateOne({_id:new ObjectId(id)},{$set:{leaseUntil:new Date(Date.now()-1000),...extra}});
  const setOp=async(operationId,values)=>{const u=await chats.updateOne({'turns.actions.operationId':operationId},{$set:Object.fromEntries(Object.entries(values).map(([k,v])=>['turns.$[turn].actions.$[action].'+k,v]))},{arrayFilters:[{'turn.actions.operationId':operationId},{'action.operationId':operationId}]});assert.equal(u.modifiedCount,1,'SETUP journal edit')};
  const priorReceipts=job=>(job?.context?.messages||[]).flatMap(m=>Array.isArray(m?.actions)?m.actions:[]);
  const financial=async()=>JSON.stringify(await Promise.all(['transactions','invoices','payments','budgets','recurringpayments','financeentries','financedrafts','financedecisionmemories','financecompanyknowledges'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const noInternal=(raw,label)=>{for(const k of INTERNAL)assert.ok(!raw.includes(k),label+' '+k)};
  const createArgs={date:'2026-10-20',amount:1200,type:EXPENSE,status:'completed',productName:'CONTINUITY_CREATED_TX'};

  // 1. Lost final reply. A create finished (done receipt, native marker on the row) and then the final reply failed. The owner sends
  //    the same words again: the next claimed job carries that earlier receipt in its earlier messages, the status tool reads it by
  //    operationId from the new turn, the current turn keeps its own receipts and next slot, and nothing is created twice.
  await beat(W1);
  const createText='この経費を登録して: 文具 1,200円 今日';
  const t1=await send(a1,createText);
  let job=await claim(W1,'SETUP first claim');assert.equal(job.context.scope.organizationId,String(A),'SETUP company');
  let r=await actOk(W1,job,'create_company_transaction',createArgs,1,'setup-create');
  const created=r.receipt,createdId=created.nativeResourceIds?.transactionId;
  assert.equal(created.state,'done','SETUP create done');
  assert.equal((await tx.findOne({_id:new ObjectId(createdId)}))?.naviOperation?.operationId,created.operationId,'SETUP native marker');
  assert.equal((await lose(W1,job)).status,200,'SETUP failed final reply');assert.equal((await ok(ENDPOINT,a1)).conversation.state,'failed','SETUP failed state');
  const t2=await send(a1,createText);
  job=await claim(W1,'SETUP second claim');
  const earlier=priorReceipts(job).find(a=>a.operationId===created.operationId);
  assert.ok(earlier,'continuity:prior-receipt');seen('prior-receipt|done-after-lost-reply');
  assert.equal(earlier.state,'done','continuity:prior-receipt');assert.equal(earlier.name,'create_company_transaction','continuity:prior-receipt');
  assert.equal(earlier.nativeResourceIds?.transactionId,createdId,'continuity:prior-receipt');assert.equal(earlier.turnId,t1,'continuity:prior-receipt');
  const priorMessage=job.context.messages.find(m=>m.turnId===t1);
  assert.ok(priorMessage,'continuity:prior-turn-id');assert.equal(priorMessage.text,createText,'continuity:prior-turn-id');assert.equal(priorMessage.response,'','continuity:prior-turn-id');
  assert.equal(priorMessage.replyState,'failed','continuity:prior-reply-state');seen('prior-message|reply-failed');
  assert.ok(!job.context.messages.some(m=>m.turnId===t2),'continuity:current-turn-not-earlier');
  noInternal(JSON.stringify(job.context.messages),'continuity:message-projection');
  // Current-turn recovery is unchanged: only this turn's receipts and next slot.
  assert.deepEqual(job.actions,[],'continuity:current-turn-actions');assert.equal(job.nextSlot,1,'continuity:current-next-slot');seen('current-turn|actions-next-slot');
  r=await actOk(W1,job,'get_company_action_status',{operationId:created.operationId},1,'status');
  assert.equal(r.result.receipts.length,1,'continuity:earlier-status');assert.equal(r.result.receipts[0].state,'done','continuity:earlier-status');assert.equal(r.result.receipts[0].turnId,t1,'continuity:earlier-status');seen('status|earlier-operation');
  r=await actOk(W1,job,'get_company_action_status',{},1,'status');
  assert.deepEqual(r.result.receipts,[],'continuity:status-current-turn');
  assert.ok((r.result.earlierReceipts||[]).some(a=>a.operationId===created.operationId&&a.state==='done'),'continuity:status-earlier-list');assert.equal(r.result.earlierReceiptsTruncated,false,'continuity:status-earlier-list');seen('status|current-and-earlier-list');
  noInternal(JSON.stringify(r.result),'continuity:status-projection');
  // The live-history reader is one more strict, finite tool; the worker's model input carries the earlier outcome and the history facts.
  assert.equal(job.tools.length,45,'continuity:catalogue');
  const reader=job.tools.find(t=>t.name==='get_company_conversation_turns');
  assert.ok(reader,'continuity:catalogue');assert.deepEqual(Object.keys(reader.inputSchema.properties).sort(),['beforeTurnId','limit','search'],'continuity:catalogue');
  assert.equal(reader.inputSchema.additionalProperties,false,'continuity:catalogue');assert.equal(reader.inputSchema.properties.limit.maximum,20,'continuity:catalogue');seen('catalogue|finite-reader');
  const interpreter=await import(pathToFileURL(path.join(__dirname,'../teaching-worker/interpreter.mjs')).href);
  const input=interpreter.interpreterInput(job);
  assert.ok(input.conversation.some(m=>m.turnId===t1&&(m.actions||[]).some(a=>a.operationId===created.operationId&&a.state==='done')),'continuity:interpreter-input');
  assert.deepEqual({earlierTurns:input.evidence.conversationHistory?.earlierTurns,olderTurnsAvailable:input.evidence.conversationHistory?.olderTurnsAvailable},{earlierTurns:1,olderTurnsAvailable:false},'continuity:interpreter-input');
  assert.ok(interpreter.systemFor(job).includes('get_company_conversation_turns'),'continuity:interpreter-guidance');seen('interpreter|input-and-guidance');
  assert.equal(await tx.countDocuments({productName:'CONTINUITY_CREATED_TX'}),1,'continuity:no-repeat-effect');
  await answered(W1,job,'その経費はすでに登録済みです。');
  pass('a create whose final reply was lost reaches the next turn as a done receipt in its earlier messages and by operationId; the current turn keeps its own receipts and next slot; nothing is created twice');

  // 2. Only this live conversation segment, reconciled when the job is claimed.
  //    Setup: company B has an archived first segment (one create) and a live second segment (one create); the colleague has her own
  //    company A conversation with one create.
  const tb1=await send(b1,'PRIVATE_B_FIRST この経費を登録');let jb=await claim(W1,'SETUP B claim');assert.equal(jb.context.scope.organizationId,String(B),'SETUP B company');
  const opB1=(await actOk(W1,jb,'create_company_transaction',{...createArgs,productName:'PRIVATE_B_ARCHIVED_TX'},1,'setup-create')).receipt;await answered(W1,jb,'PRIVATE_B_REPLY');
  let v=await ok(ENDPOINT,b1);await ok(ENDPOINT+'/new',b1,'POST',{chatRevision:v.conversation.revision,requestId:hex32()});
  const tb2=await send(b1,'PRIVATE_B_SECOND この経費を登録');jb=await claim(W1,'SETUP B claim');
  const opB2=(await actOk(W1,jb,'create_company_transaction',{...createArgs,productName:'PRIVATE_B_LIVE_TX'},1,'setup-create')).receipt;await answered(W1,jb,'PRIVATE_B_REPLY');
  await beat(X);await send(a2,'O2_COLLEAGUE_MARKER この経費を登録');let jx=await claim(X,'SETUP colleague claim');
  assert.equal(jx.context.scope.actorId,String(O2.id),'SETUP colleague actor');
  const opO2=(await actOk(X,jx,'create_company_transaction',{...createArgs,productName:'PRIVATE_COLLEAGUE_TX'},1,'setup-create')).receipt;await answered(X,jx,'PRIVATE_COLLEAGUE_REPLY');
  //    In company B's live segment an earlier turn's operation is readable; the archived segment's operation is not.
  await send(b1,'PRIVATE_B_THIRD 前の登録は？');jb=await claim(W1,'SETUP B claim');
  r=await actOk(W1,jb,'get_company_action_status',{operationId:opB2.operationId},1,'status');assert.equal(r.result.receipts[0]?.state,'done','continuity:earlier-status');
  r=await actOk(W1,jb,'get_company_action_status',{operationId:opB1.operationId},1,'status');assert.deepEqual(r.result.receipts,[],'continuity:archived-operation-no-receipt');seen('foreign-operation|archived-same-conversation');
  assert.ok(priorReceipts(jb).some(a=>a.operationId===opB2.operationId),'continuity:prior-receipt');assert.ok(!priorReceipts(jb).some(a=>a.operationId===opB1.operationId),'continuity:archived-operation-no-receipt');
  assert.ok(!JSON.stringify(jb.context.messages).includes('PRIVATE_B_FIRST'),'continuity:archived-turn-not-in-context');
  await answered(W1,jb);
  //    The colleague's job cannot read the owner's operation in the same company, and carries none of her conversation.
  await send(a2,'O2_COLLEAGUE_MARKER 前の登録は？');jx=await claim(X,'SETUP colleague claim');
  r=await actOk(X,jx,'get_company_action_status',{operationId:created.operationId},1,'status');assert.deepEqual(r.result.receipts,[],'continuity:foreign-operation other-actor');seen('foreign-operation|other-actor-reverse');
  assert.ok(!JSON.stringify(jx).includes('CONTINUITY_CREATED_TX')&&!JSON.stringify(jx).includes(createText),'continuity:colleague-context-own-only');
  await answered(X,jx);
  // 2a. The reply failed while a create was still in flight; its native write landed after the owner sent the next message. The job is
  //     rebuilt from reconciled live turns when it is claimed: the earlier receipt is done, not the in-flight state seen at send.
  const t3=await send(a1,'封筒 800円も登録して');job=await claim(W1,'SETUP claim');
  const late=(await actOk(W1,job,'create_company_transaction',{...createArgs,amount:800,productName:'CONTINUITY_LATE_TX'},1,'setup-create')).receipt;
  const lateRow=await tx.findOne({_id:new ObjectId(late.nativeResourceIds.transactionId)});
  await tx.updateOne({_id:lateRow._id},{$unset:{naviOperation:''}});
  await setOp(late.operationId,{state:'claimed',completedAt:null,nativeResourceIds:null,leaseUntil:new Date(Date.now()+90000)});
  assert.equal((await lose(W1,job)).status,200,'SETUP failed final reply');
  v=await ok(ENDPOINT,a1);assert.equal(v.conversation.turns.find(t=>t.id===t3).actions[0].state,'working','SETUP in flight at send');
  const t4=await send(a1,'封筒の登録はどうなった？',{page:'transactions'},v.conversation.revision);
  await tx.updateOne({_id:lateRow._id},{$set:{naviOperation:lateRow.naviOperation}});
  job=await claim(W1,'SETUP claim');
  assert.equal(priorReceipts(job).find(a=>a.operationId===late.operationId)?.state,'done','continuity:claim-time-reconcile');seen('reconcile|late-marker-at-claim');
  assert.deepEqual(job.actions,[],'continuity:current-turn-actions');
  // 2b. A hard delete whose journal settlement and reply were both lost cannot be proven: it stays unresolved for the owner in the next
  //     turn and in the status read, and reading repeats nothing.
  const current=(await actOk(W1,job,'get_company_transaction',{transactionId:String(lateRow._id)},1,'read')).result.transaction;
  const removed=(await actOk(W1,job,'delete_company_transaction',{transactionId:String(lateRow._id),expectedUpdatedAt:current.updatedAt},1,'setup-delete')).receipt;
  assert.equal(removed.state,'done','SETUP delete done');
  await setOp(removed.operationId,{state:'claimed',completedAt:null,lease:'dead-'+job.lease,leaseUntil:new Date(Date.now()-60000)});
  assert.equal((await lose(W1,job)).status,200,'SETUP failed final reply');
  const beforeUncertain=await financial();
  const t5=await send(a1,'封筒の取引は消えた？');job=await claim(W1,'SETUP claim');
  const uncertain=priorReceipts(job).find(a=>a.operationId===removed.operationId);
  assert.equal(uncertain?.state,'unresolved','continuity:uncertain-stays-unresolved');assert.equal(uncertain.recoveryOwner,'user','continuity:uncertain-stays-unresolved');
  r=await actOk(W1,job,'get_company_action_status',{operationId:removed.operationId},1,'status');assert.equal(r.result.receipts[0]?.state,'unresolved','continuity:uncertain-stays-unresolved');seen('reconcile|unprovable-delete-unresolved');
  // 2c. Unknown, other-company (live and archived) and other-actor operation ids return no receipt; an empty id is refused; the list
  //     carries only this conversation's receipts, newest first.
  for(const [label,operationId] of [['unknown',hex32()],['other-company-live',opB2.operationId],['other-company-archived',opB1.operationId],['other-actor-same-company',opO2.operationId]]){
   r=await actOk(W1,job,'get_company_action_status',{operationId},1,'status');assert.deepEqual(r.result.receipts,[],'continuity:foreign-operation '+label);seen('foreign-operation|'+label);
  }
  assert.equal((await act(W1,job,'get_company_action_status',{operationId:''})).status,400,'continuity:empty-operation-refused');seen('foreign-operation|empty-refused');
  r=await actOk(W1,job,'get_company_action_status',{},1,'status');const listed=JSON.stringify(r.result);
  for(const op of [opB1,opB2,opO2])assert.ok(!listed.includes(op.operationId),'continuity:status-live-segment-only');
  assert.deepEqual(r.result.earlierReceipts.map(a=>a.operationId),[removed.operationId,late.operationId,created.operationId],'continuity:status-earlier-list');
  assert.equal(await financial(),beforeUncertain,'continuity:reading-repeats-nothing');
  await answered(W1,job);
  pass('only this live actor/company/conversation segment: a late native marker is reconciled at claim, an unprovable delete stays unresolved without repetition, archived/other-company/other-actor/unknown operations return nothing');

  // 3. Turns older than the eight-message context. The reader finds an earlier answer by literal search, pages newest first with a
  //    stable before-turn cursor and a bounded page, and never returns the current message, an archived segment, another company or
  //    another actor. It is a read: no receipt, no journal entry, no record change.
  const said=[t1,t2,t3,t4,t5];
  const say=async(text,reply)=>{const id=await send(a1,text);const j=await claim(W1,'SETUP claim');await answered(W1,j,reply);said.push(id);return id};
  const h1=await say('HISTORY_ANSWER_MARKER 決算月は9月です。','HISTORY_REPLY_MARKER 承知しました。決算月は9月として扱います。');
  const longReply='決算と月次の説明です。'.repeat(360);
  for(let i=2;i<=10;i++)await say('filler question '+i,longReply);
  const beforeHistory=await financial();
  const hq=await send(a1,'決算月はいつでしたっけ？');job=await claim(W1,'SETUP claim');
  assert.equal(said.length,15,'SETUP turn count');
  assert.deepEqual(job.context.messages.map(m=>m.turnId),said.slice(-8),'continuity:context-last-eight');
  const facts=job.context.facts.conversationHistory||{};
  assert.deepEqual({earlierTurns:facts.earlierTurns,inContext:facts.inContext,olderTurnsAvailable:facts.olderTurnsAvailable},{earlierTurns:15,inContext:8,olderTurnsAvailable:true},'continuity:history-facts');seen('history|context-facts');
  assert.ok(!JSON.stringify(job.context.messages).includes('HISTORY_ANSWER_MARKER'),'SETUP the answer is older than the context');
  const history=async(args,label='history')=>{const x=await act(W1,job,'get_company_conversation_turns',args);assert.equal(x.status,200,'continuity:'+label+' '+x.raw.slice(0,300));noInternal(x.raw,'continuity:history-projection');assert.ok(!x.raw.includes(job.lease),'continuity:history-projection lease');return x.data.result};
  let h=await history({search:'HISTORY_ANSWER_MARKER'},'history-search');
  assert.deepEqual(h.turns.map(t=>t.turnId),[h1],'continuity:history-search');assert.ok(h.turns[0].text.includes('決算月は9月'),'continuity:history-search');
  assert.ok(h.turns[0].response.includes('HISTORY_REPLY_MARKER'),'continuity:history-search');assert.equal(h.turns[0].replyState,'answered','continuity:history-search');seen('history|search-question');
  h=await history({search:'history_reply_marker'});assert.deepEqual(h.turns.map(t=>t.turnId),[h1],'continuity:history-search-answer');seen('history|search-answer-case-insensitive');
  h=await history({search:'.*'});assert.equal(h.turns.length,0,'continuity:history-literal-search');seen('history|literal-not-regex');
  h=await history({search:'決算月はいつ'});assert.equal(h.turns.length,0,'continuity:history-excludes-current');seen('history|current-excluded');
  // Every earlier turn exactly once, newest first, through the cursor; a page stops at its size bound or its limit and says so.
  const pages=[];let cursor;
  do{h=await history({limit:20,...(cursor?{beforeTurnId:cursor}:{})});pages.push(h);cursor=h.nextBeforeTurnId}while(h.hasMore&&pages.length<20);
  assert.deepEqual(pages.flatMap(p=>p.turns.map(t=>t.turnId)),[...said].reverse(),'continuity:history-cursor');
  assert.ok(pages.length>1&&pages[0].truncated==='size'&&pages[0].hasMore===true,'continuity:history-page-bound');
  assert.ok(!pages.some(p=>p.turns.some(t=>t.turnId===hq)),'continuity:history-excludes-current');seen('history|cursor-complete');seen('history|size-bound');
  h=await history({limit:3});assert.deepEqual(h.turns.map(t=>t.turnId),said.slice(-3).reverse(),'continuity:history-limit');
  assert.equal(h.truncated,'limit','continuity:history-limit');assert.equal(h.nextBeforeTurnId,said.at(-3),'continuity:history-limit');seen('history|limit');
  h=await history({search:'文具 1,200円'});assert.deepEqual(h.turns.map(t=>t.turnId),[t2,t1],'continuity:history-receipts');
  assert.equal(h.turns[1].actions[0]?.operationId,created.operationId,'continuity:history-receipts');assert.equal(h.turns[1].actions[0].state,'done','continuity:history-receipts');seen('history|receipt-projection');
  // Another company, another actor and archived turns are never returned; a cursor from them (or the current turn) is not a cursor here.
  for(const [label,needle] of [['other-company','PRIVATE_B_'],['other-actor','O2_COLLEAGUE_MARKER']]){h=await history({search:needle});assert.equal(h.turns.length,0,'continuity:history-scope '+label);seen('history|scope-'+label)}
  for(const [label,turnId] of [['other-company',tb2],['current',hq]]){h=await history({beforeTurnId:turnId});assert.deepEqual([h.turns.length,h.cursorFound],[0,false],'continuity:history-cursor-scope '+label);seen('history|cursor-'+label)}
  for(const [label,args] of [['limit-over',{limit:21}],['limit-zero',{limit:0}],['search-long',{search:'x'.repeat(101)}],['search-empty',{search:''}],['cursor-shape',{beforeTurnId:'not a turn id'}],['company-argument',{organizationId:String(B)}],['conversation-argument',{conversationId:jb.id}]]){
   assert.equal((await act(W1,job,'get_company_conversation_turns',args)).status,400,'continuity:history-arguments '+label);seen('history|refused-'+label);
  }
  r=await actOk(W1,job,'get_company_action_status',{},1,'status');assert.deepEqual(r.result.receipts,[],'continuity:history-read-only');
  assert.equal(await financial(),beforeHistory,'continuity:history-read-only');
  await answered(W1,job);
  //    In company B the archived first segment is not readable; its earlier live turns are.
  await send(b1,'PRIVATE_B_FOURTH 前の話は？');jb=await claim(W1,'SETUP B claim');
  const bh=async args=>(await actOk(W1,jb,'get_company_conversation_turns',args,1,'history')).result;
  assert.equal((await bh({search:'PRIVATE_B_FIRST'})).turns.length,0,'continuity:history-no-archive');
  assert.deepEqual((await bh({search:'PRIVATE_B_SECOND'})).turns.map(t=>t.turnId),[tb2],'continuity:history-no-archive');
  h=await bh({beforeTurnId:tb1});assert.deepEqual([h.turns.length,h.cursorFound],[0,false],'continuity:history-no-archive');seen('history|archive-excluded');
  assert.equal((await bh({search:'HISTORY_ANSWER_MARKER'})).turns.length,0,'continuity:history-scope other-company');
  await answered(W1,jb);
  pass('earlier turns beyond the eight-message context: literal search, a complete stable cursor, limit and size bounds reported, receipts projected, and no current, archived, other-company or other-actor turn; reading changes nothing');

  // 4. Worker replacement in the company realm: the send-time worker is only a hint, the claim assigns the claiming worker, a live lease
  //    is never taken, and one claim wins a race.
  //    (a) W1 is the hint at send and then goes offline; W2 claims at once and the claim assigns W2. W1 returning cannot act, renew or answer.
  await beat(W1);await send(a1,'Worker replacement turn');
  assert.equal(String((await companyChat(O1,A)).agentId),W1.id,'SETUP send-time hint');
  await offline(W1);
  job=await claimAs(W2);assert.ok(job,'continuity:reassigned-claim');seen('claim|offline-hint-reassigned');
  assert.equal(String((await companyChat(O1,A)).agentId),W2.id,'continuity:claim-assigns-worker');
  assert.equal((await act(W1,job,'list_company_invoices')).status,409,'continuity:late-worker-action');
  assert.equal((await worker(W1,'heartbeat',{job:{mode:'workspace',id:job.id,lease:job.lease}})).status,409,'continuity:late-worker-heartbeat');
  assert.equal((await answer(W1,job)).status,409,'continuity:late-worker-result');seen('late-worker|action-heartbeat-result');
  await answered(W2,job);
  //    (b) The hint worker is revoked: its token is refused and another worker takes the turn.
  const W4=await workerOf(O1,[acct2],true);await beat(W4);await send(a1,'Revoked worker turn');
  assert.equal(String((await companyChat(O1,A)).agentId),W4.id,'SETUP send-time hint');
  await ok('/api/finance-chat/agents/'+W4.id,O1.token,'DELETE');
  assert.equal((await worker(W4,'workspace-claim')).status,401,'continuity:revoked-worker-refused');
  job=await claimAs(W1);assert.ok(job,'continuity:revoked-hint-reassigned');seen('claim|revoked-hint-reassigned');
  await answered(W1,job);
  //    (c) Both workers live: a fresh hint for one does not block the other.
  await beat(W1);await beat(W2);await send(a1,'Fresh hint turn');
  assert.equal(String((await companyChat(O1,A)).agentId),W2.id,'SETUP send-time hint');
  job=await claimAs(W1);assert.ok(job,'continuity:fresh-hint-not-blocking');seen('claim|fresh-hint');
  assert.equal(String((await companyChat(O1,A)).agentId),W1.id,'continuity:claim-assigns-worker');
  //    (d) A live lease is never taken: W2 finds nothing to claim and cannot act on W1's job.
  const held=await companyChat(O1,A);
  assert.equal(await claimAs(W2),null,'continuity:active-lease-kept');
  const still=await companyChat(O1,A);assert.deepEqual([still.lease,String(still.agentId),still.state],[held.lease,W1.id,'working'],'continuity:active-lease-kept');
  assert.equal((await act(W2,job,'list_company_invoices')).status,409,'continuity:active-lease-kept');seen('claim|active-lease-kept');
  await answered(W1,job);
  //    (e) Simultaneous claims by both workers: exactly one wins and is assigned; the other gets nothing.
  for(let i=0;i<3;i++){
   await send(a1,'Race turn '+i);
   const [x,y]=await Promise.all([claimAs(W1),claimAs(W2)]),winners=[[W1,x],[W2,y]].filter(([,j])=>j);
   assert.equal(winners.length,1,'continuity:single-claim');const [w,won]=winners[0];
   assert.equal(String((await companyChat(O1,A)).agentId),w.id,'continuity:single-claim');seen('race|round-'+i);
   await answered(w,won);
  }
  pass('company realm: an offline or revoked hint worker is replaced at claim, a fresh hint does not block, the claim assigns the claiming worker, a live lease is kept and one of two simultaneous claims wins');

  // 5. Recovery under replacement: an expired claim resumes under the new worker with completed effects reconciled; exhausted work fails
  //    with the explicit retry; foreign and card-only workers claim nothing; a revoked company settles failed; public research is
  //    exactly the claiming worker's.
  //    (a) W1 crashes after a create; its lease expires; W2 resumes the same turn, sees the create done and the next slot, and W1's late
  //        action, heartbeat and result are refused.
  await beat(W1);await send(a1,'クラッシュ中の登録');job=await claim(W1,'SETUP claim');
  const crashed=(await actOk(W1,job,'create_company_transaction',{...createArgs,productName:'CONTINUITY_CRASH_TX'},1,'setup-create')).receipt;
  await setOp(crashed.operationId,{state:'claimed',completedAt:null,leaseUntil:new Date(Date.now()-60000)});await expire(job.id);
  const resumed=await claimAs(W2);assert.ok(resumed&&resumed.id===job.id,'continuity:expired-claim-resumes');
  assert.equal(resumed.actions.find(a=>a.operationId===crashed.operationId)?.state,'done','continuity:expired-claim-reconciles');assert.equal(resumed.nextSlot,2,'continuity:expired-claim-reconciles');seen('expired|resume-reconciled');
  assert.equal(String((await companyChat(O1,A)).agentId),W2.id,'continuity:claim-assigns-worker');
  assert.equal((await act(W1,job,'create_company_transaction',{...createArgs,productName:'CONTINUITY_LATE_A_TX'},2)).status,409,'continuity:late-worker-action');
  assert.equal((await worker(W1,'heartbeat',{job:{mode:'workspace',id:job.id,lease:job.lease}})).status,409,'continuity:late-worker-heartbeat');
  assert.equal((await answer(W1,job)).status,409,'continuity:late-worker-result');
  assert.equal(await tx.countDocuments({productName:{$in:['CONTINUITY_CRASH_TX','CONTINUITY_LATE_A_TX']}}),1,'continuity:no-repeat-effect');seen('expired|late-worker-refused');
  await answered(W2,resumed);
  //    (b) Attempts exhausted under W1: W2's claim fails the turn for the owner; the explicit retry queues it again and W2 answers.
  await send(a1,'Exhausted turn');job=await claim(W1,'SETUP claim');await expire(job.id,{attempts:2});
  assert.equal(await claimAs(W2),null,'continuity:exhausted-swept');
  v=await ok(ENDPOINT,a1);assert.equal(v.conversation.state,'failed','continuity:exhausted-swept');seen('exhausted|swept-failed');
  await ok(ENDPOINT+'/retry',a1,'POST',{chatRevision:v.conversation.revision});job=await claim(W2,'continuity:retry-claim');await answered(W2,job);seen('exhausted|explicit-retry');
  //    (c) The colleague's worker and the card-only worker claim nothing of the owner's queue; a workspace worker of the owner does.
  await send(a1,'Foreign worker turn');
  assert.equal(await claimAs(X),null,'continuity:foreign-owner-no-claim');assert.equal(await claimAs(W3),null,'continuity:card-only-no-claim');
  assert.equal((await companyChat(O1,A)).state,'queued','continuity:foreign-owner-no-claim');seen('claim|foreign-owner');seen('claim|card-only');
  job=await claim(W2,'SETUP claim');await answered(W2,job);
  //    (d) Membership of B is removed while a B turn waits under W1's hint: W2's claim settles it failed without returning its context.
  await beat(W1);await send(b1,'PRIVATE_B_REVOKED queued turn');
  assert.equal(String((await companyChat(O1,B)).agentId),W1.id,'SETUP send-time hint');
  await orgs.updateOne({_id:B},{$set:{members:[]}});
  assert.equal(await claimAs(W2),null,'continuity:revoked-company-settles');
  assert.equal((await companyChat(O1,B)).state,'failed','continuity:revoked-company-settles');seen('claim|revoked-company');
  await orgs.updateOne({_id:B},{$set:{members:membersB}});
  //    (e) Public research belongs to the claiming worker's own lease: a capable W1 claim, expired and reclaimed by W2 without the
  //        capability, carries none and W1's old lease cannot use it; reclaimed again by a capable W1, the grant is W1's own.
  await send(a1,'公開情報で確認して');job=await claim(W1,'SETUP claim',true);assert.equal(job.publicResearch?.registry,'connection_required','SETUP capable claim');
  await expire(job.id);const plainJob=await claimAs(W2);assert.ok(plainJob&&plainJob.id===job.id,'continuity:capability-reclaim');
  assert.equal(plainJob.publicResearch,undefined,'continuity:capability-claiming-worker');
  assert.equal((await chats.findOne({_id:new ObjectId(job.id)})).context?.publicResearch,undefined,'continuity:capability-claiming-worker');
  assert.equal((await worker(W2,'workspace/'+plainJob.id+'/sources',{lease:plainJob.lease,op:'list'})).status,409,'continuity:capability-claiming-worker');
  assert.equal((await worker(W1,'workspace/'+job.id+'/sources',{lease:job.lease,op:'list'})).status,409,'continuity:capability-old-lease');seen('capability|not-inherited');
  await expire(plainJob.id,{attempts:1});const capableJob=await claimAs(W1,true);assert.ok(capableJob&&capableJob.id===job.id,'continuity:capability-reclaim');
  assert.equal(capableJob.publicResearch?.registry,'connection_required','continuity:capability-own-grant');
  assert.equal((await worker(W1,'workspace/'+capableJob.id+'/sources',{lease:capableJob.lease,op:'list'})).status,200,'continuity:capability-own-grant');seen('capability|own-grant');
  await answered(W1,capableJob);
  pass('company recovery: an expired claim resumes under the replacement with its completed create reconciled and the late worker refused; exhausted work fails with the explicit retry; foreign and card-only workers claim nothing; a revoked company settles failed; public research is the claiming worker\'s own');

  // 6. The owner workspace realm: the same claim-time assignment, the claiming worker's own account grants, late-worker refusal,
  //    live-lease retention, expired resumption and exhausted-work failure with the explicit retry.
  const importA=new ObjectId();await db.collection('financeimports').insertOne({_id:importA,ownerId:O1.id,accountId:new ObjectId(acct1._id),provider:'amex',period:'2026-09',rows:[],createdAt:now,updatedAt:now});
  const wsSend=async text=>{const view=await ok(WORKSPACE,O1.token);await ok(WORKSPACE,O1.token,'POST',{requestId:crypto.randomUUID(),chatRevision:view.conversation?.revision||0,text,context:{page:'dashboard'}})};
  const ownerChat=()=>owners.findOne({ownerId:O1.id});
  await beat(W1);await wsSend('Owner workspace replacement turn');assert.equal(String((await ownerChat()).agentId),W1.id,'SETUP send-time hint');
  await offline(W1);
  let oj=await claimAs(W2);assert.ok(oj&&oj.companyScoped!==true&&oj.mode==='workspace','continuity:owner-reassigned-claim');seen('owner|offline-hint-reassigned');
  assert.equal(String((await ownerChat()).agentId),W2.id,'continuity:owner-claim-assigns-worker');
  r=await actOk(W2,oj,'list_accounts',{},1,'owner-read');assert.deepEqual(r.result.accounts.map(a=>a.id),[String(acct2._id)],'continuity:owner-grants-claiming-worker');
  r=await actOk(W2,oj,'list_imports',{},1,'owner-read');assert.ok(!r.result.imports.some(i=>i.id===String(importA)),'continuity:owner-grants-claiming-worker');
  assert.equal((await act(W2,oj,'get_mapping',{importId:String(importA)})).status,404,'continuity:owner-grants-claiming-worker');seen('owner|claiming-worker-grants');
  assert.equal((await act(W1,oj,'list_accounts')).status,409,'continuity:owner-late-worker');
  assert.equal((await worker(W1,'heartbeat',{job:{mode:'workspace',id:oj.id,lease:oj.lease}})).status,409,'continuity:owner-late-worker');
  assert.equal((await answer(W1,oj)).status,409,'continuity:owner-late-worker');seen('owner|late-worker-refused');
  await answered(W2,oj);
  await beat(W1);await wsSend('Owner turn for W1');oj=await claim(W1,'SETUP owner claim');
  r=await actOk(W1,oj,'list_imports',{},1,'owner-read');assert.ok(r.result.imports.some(i=>i.id===String(importA)),'continuity:owner-grants-claiming-worker');
  assert.equal(await claimAs(W2),null,'continuity:owner-active-lease-kept');assert.equal(String((await ownerChat()).agentId),W1.id,'continuity:owner-active-lease-kept');seen('owner|active-lease-kept');
  await answered(W1,oj);
  await wsSend('Owner expired turn');oj=await claim(W1,'SETUP owner claim');await owners.updateOne({_id:new ObjectId(oj.id)},{$set:{leaseUntil:new Date(Date.now()-1000)}});
  const ownerResumed=await claimAs(W2);assert.ok(ownerResumed&&ownerResumed.id===oj.id,'continuity:owner-expired-resumes');
  assert.equal((await answer(W1,oj)).status,409,'continuity:owner-late-worker');await answered(W2,ownerResumed);seen('owner|expired-resume');
  await wsSend('Owner exhausted turn');oj=await claim(W1,'SETUP owner claim');await owners.updateOne({_id:new ObjectId(oj.id)},{$set:{leaseUntil:new Date(Date.now()-1000),attempts:2}});
  assert.equal(await claimAs(W2),null,'continuity:owner-exhausted-swept');
  const ov=await ok(WORKSPACE,O1.token);assert.equal(ov.conversation.state,'failed','continuity:owner-exhausted-swept');seen('owner|exhausted-swept');
  await ok(WORKSPACE+'/retry',O1.token,'POST',{chatRevision:ov.conversation.revision});oj=await claim(W2,'continuity:owner-retry-claim');await answered(W2,oj);seen('owner|explicit-retry');
  pass('owner workspace realm: an offline hint worker is replaced at claim with the claiming worker\'s own account grants, the late worker is refused, a live lease is kept, an expired turn resumes and exhausted work fails with the explicit retry');

  console.log('SUMMARY '+JSON.stringify({groups,uniqueCases:cases.size,cases:[...cases].sort(),
   limits:'Owned synthetic Mongo and loopback native HTTP with simulated worker replies; no model, provider, mail, bank, Slack or production record. Proves transport, journal, claim and lease behaviour, not model judgement: the fixed actual-model corpus (lost-reply repeat versus intentional additional record, zero-write questions, uncertainty) is the later F5 evidence.'}));
  console.log(groups+' Navi continuity groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

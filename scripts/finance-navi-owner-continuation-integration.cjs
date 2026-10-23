// Owner/purchase Navi continuation through the actual built routes, worker protocol and native services: explicit new chat and
// archived history for the legacy owner workspace and purchase chats, the realm-aware feature guide and longer owner explanations,
// the same-company teaching bridge, and the named owner actions (card sync, automatic sync, workflow review, assigned-card
// allocation). Synthetic users, companies, cards and records in an owned disposable database only; no model, provider, network
// send or production database. Every final-state assertion carries an `owner-cont:` label so the fixture's defect leg can name
// the assertion a reintroduced defect must flip.
// Groups 10-15 (plan omf-navi-agent-owner-retry-20261023): request identity across New chat and the uncertain-send exit of the owner
// workspace and purchase chats, each on its own synthetic owner so one red group never hides another (a red group prints FAIL <key>).
// OMF_OWNER_CONT_ONLY (comma list of group keys, `chrome-` keys for the installed-Chrome leg; 'original' for groups 1-8) runs only the
// named groups; the fixture's defect legs use it. Setup steps fail with SETUP and are never a detection.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_OWNER_CONT_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const DB='owner_continuation_regression';
async function main(){
 assert.equal(process.env.OMF_OWNER_CONT_FIXTURE,'owned','SETUP: run only through the owned fixture');
 let mongo,client,child,directory,logs='',groups=0;const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-owner-cont-'));
  const binary=process.env.OMF_MONGOD_BINARY||path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  // SETUP readiness only (the sibling selection and status integrations' rule): on a loaded machine (other work at full CPU while this
  // runs at idle priority) the owned throwaway mongod and app can take minutes to start; the library's 10 s mongod default failed here.
  // Each start is measured and printed (TIMING); no behaviour assertion uses this window.
  const SETUP_READY_MS=300000;let started=Date.now();
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});const mongoMs=Date.now()-started;
  const uri=mongo.getUri(DB),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-30000)})}
  let healthy=false;started=Date.now();while(!healthy&&Date.now()-started<SETUP_READY_MS){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).json();if(d.database?.connected){assert.equal(d.database.name,DB);healthy=true}}catch{}if(!healthy)await pause(500)}if(!healthy)throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  console.log('TIMING '+JSON.stringify({mongoMs,appMs:Date.now()-started}));
  client=await MongoClient.connect(uri);const db=client.db(DB);assert.equal(db.databaseName,DB);
  const api=async(route,token,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':Buffer.isBuffer(body)?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}return{status:response.status,raw,data}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'owner-cont:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const C={assistants:db.collection('financeassistants'),chats:db.collection('financechats'),ops:db.collection('financeactionoperations'),archives:db.collection('financeownerconversationarchives'),accounts:db.collection('financialaccounts'),knowledge:db.collection('financecompanyknowledges'),orgs:db.collection('organizations'),workflows:db.collection('financeworkflows'),matches:db.collection('financepayments'),memories:db.collection('financedecisionmemories'),drafts:db.collection('financedrafts')};
  const register=async(email,name)=>{const t=(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name})).tokens.accessToken;return{token:t,id:(await db.collection('users').findOne({email}))._id}};
  const P=await register('owner-cont-owner@example.invalid','Synthetic owner'),Q=await register('owner-cont-other@example.invalid','Synthetic other');const plain=P.token,owner=P.id;
  const A=new ObjectId(),B=new ObjectId(),Cx=new ObjectId(),now=new Date(),membersA=[{userId:owner,role:'owner',joinedAt:now}];
  await C.orgs.insertMany([{_id:A,name:'Synthetic continuation company A',slug:'owner-cont-a',isActive:true,members:membersA},{_id:B,name:'Synthetic continuation company B',slug:'owner-cont-b',isActive:true,members:[{userId:owner,role:'member',joinedAt:now}]},{_id:Cx,name:'PRIVATE_FOREIGN_COMPANY_C',slug:'owner-cont-c',isActive:true,members:[{userId:Q.id,role:'owner',joinedAt:now}]}]);
  const tokenA=(await ok('/api/auth/switch-organization',plain,'POST',{organizationId:String(A)})).tokens.accessToken,tokenB=(await ok('/api/auth/switch-organization',plain,'POST',{organizationId:String(B)})).tokens.accessToken;
  const amexA=(await ok('/api/finance/accounts',plain,'POST',{name:'Continuation Amex',provider:'amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'otp-private@example.invalid',otpMailbox:'otp-private@example.invalid'})).account;
  const amexX=(await ok('/api/finance/accounts',plain,'POST',{name:'PRIVATE_UNASSIGNED_CARD',provider:'amex',primaryCard:'22222',cardIdentifiers:['22222'],otpRecipient:'otp-x@example.invalid',otpMailbox:'otp-x@example.invalid'})).account;
  const aplus=(await ok('/api/finance/accounts',plain,'POST',{name:'Continuation Aplus',provider:'aplus',primaryCard:'1234',cardIdentifiers:['1234']})).account;
  await C.accounts.updateOne({_id:new ObjectId(aplus._id)},{$set:{'autoSync.lastQueuedDay':'2026-10-01'}});
  const {HEADERS}=await import(require('node:url').pathToFileURL(path.join(root,'shared/amex.mjs')).href);
  const csv=(card,rows)=>Buffer.from([HEADERS,...rows.map(([day,name,amount])=>['2026/08/'+day,'2026/08/'+day,name,'Synthetic user',card,String(amount),'',''])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const upload=async(account,card,rows)=>{const r=await ok('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',plain,'POST',csv(card,rows));return String(r.id)};
  const importId=await upload(amexA,'12345',[['02','Continuation shop two',1102],['03','Continuation shop three',1103],['04','Bridge shop four',1104],['05','Bridge shop five',1105],['06','Continuation shop six',1106]]);
  const importX=await upload(amexX,'22222',[['07','PRIVATE_UNASSIGNED_CHARGE',2201]]);
  const wide=await ok('/api/finance-chat/agents',plain,'POST',{accountIds:[String(amexA._id),String(aplus._id)],workspaceEnabled:true});
  const workerAs=agent=>(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);const worker=workerAs(wide);
  assert.equal((await worker('heartbeat',{})).status,200);
  const act=(job,slot,name,args={},w=worker)=>w((job.mode==='workspace'?'workspace/':'')+job.id+'/actions',{lease:job.lease,slot,name,args});
  const acted=async(job,slot,name,args,w)=>{const r=await act(job,slot,name,args,w);assert.equal(r.status,200,'owner-cont:action '+name+' '+r.raw.slice(0,400));return r.data};
  const finish=(job,proposal,w=worker)=>w((job.mode==='workspace'?'workspace/':'')+job.id+'/result',{lease:job.lease,proposal});
  const reply=(summary,extra={})=>({kind:'unclear',summary,patch:{},quotes:{},...extra});
  const finished=async(job,summary,extra,w)=>{const r=await finish(job,reply(summary,extra),w);assert.equal(r.status,200,'owner-cont:finish '+r.raw.slice(0,300));return r};
  const ws='/api/finance-chat/workspace';
  const wsSend=async(token,text,context={page:'mapping',importId},requestId=crypto.randomUUID())=>{const view=await ok(ws,token);return{requestId,response:await api(ws,token,'POST',{text,requestId,chatRevision:view.conversation?.revision||0,context})}};
  const wsTurn=async(token,text,context,w=worker)=>{const sent=await wsSend(token,text,context);assert.equal(sent.response.status,200,'owner-cont:send '+sent.response.raw.slice(0,300));const claimed=await w('workspace-claim');assert.ok(claimed.data?.job,'owner-cont:workspace-claim '+claimed.raw.slice(0,300));assert.equal(claimed.data.job.text,text);return{...sent,job:claimed.data.job}};
  const ledger=async()=>JSON.stringify(await Promise.all(['transactions','financeentries','financedrafts','financedecisionmemories'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const archiveCount=filter=>C.archives.countDocuments(filter);
  const profileWrites=async(collection,fn)=>{await db.command({profile:0});await db.collection('system.profile').drop().catch(()=>{});await db.command({profile:2});try{await fn()}finally{await db.command({profile:0})}return db.collection('system.profile').countDocuments({ns:DB+'.'+collection,$or:[{op:'update'},{'command.findAndModify':{$exists:true}},{'command.findandmodify':{$exists:true}}]})};

  // Group selection (OMF_OWNER_CONT_ONLY, the fixture's defect legs): unset runs everything; 'original' runs groups 1-8 alone (the inherited
  // defects); request identity keys run only those isolated groups (the Chrome ones on the shared setup above, without groups 1-8).
  const only=new Set(String(process.env.OMF_OWNER_CONT_ONLY||'').split(',').map(s=>s.trim()).filter(Boolean)),wanted=key=>!only.size||only.has(key),red=[];
  const runOriginal=!only.size||only.has('original');
  if(runOriginal){
  // 1 owner workspace: longer explanations with one fixed catalogue link, explicit new chat that archives the segment with every
  // receipt, a recognised lost reset, cap continuation, concurrent resets sharing one copy and a stale unadopted copy keeping its id.
  let t=await wsTurn(plain,'2行目の税率を10にして、カード連携の画面も教えて');
  const saved=await acted(t.job,1,'save_draft_fields',{importId,line:2,fields:{taxRate:10}});assert.equal(saved.receipt.state,'done');
  const long='説明'.repeat(1500);await finished(t.job,long,{navigation:{feature:'connections'}});
  let view=await ok(ws,plain),turn=view.conversation.turns.at(-1);assert.equal(turn.proposal.summary.length,3000,'owner-cont:long-owner-reply');assert.deepEqual(turn.proposal.navigation,{feature:'connections'},'owner-cont:owner-navigation-kept');
  assert.equal(view.conversation.turnLimit,200);assert.equal(view.conversation.segment,0);
  t=await wsTurn(plain,'取引の詳細を開いて');
  assert.equal((await finish(t.job,reply('s',{navigation:{feature:'transactions',transactionId:'a'.repeat(24)}}))).status,400,'owner-cont:no-record-navigation');
  assert.equal((await finish(t.job,reply('s',{navigation:{feature:'authentication'}}))).status,400,'owner-cont:no-unsupported-navigation');
  assert.equal((await finish(t.job,reply('x'.repeat(4001)))).status,400,'owner-cont:owner-limit-4000');
  await finished(t.job,'取引一覧は会社の会話から確認できます。');
  const queued=await wsSend(plain,'まだ回答待ち');assert.equal(queued.response.status,200);view=await ok(ws,plain);
  assert.equal((await api(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()})).status,409,'owner-cont:busy-refused');
  t={job:(await worker('workspace-claim')).data.job};
  const inflight={ownerId:owner,conversationKind:'workspace',conversationId:new ObjectId(t.job.id),turnId:queued.requestId,slot:99,operationId:crypto.randomBytes(16).toString('hex'),name:'save_draft_fields',payloadHash:'x',state:'claimed',lease:t.job.lease,leaseUntil:new Date(Date.now()+600000),claimedAt:new Date(),attempts:1,target:{importId,line:2},args:{fields:{taxRate:10}}};
  await C.ops.insertOne(inflight);const inflightId=inflight._id;await finished(t.job,'回答しました。');view=await ok(ws,plain);
  assert.equal((await api(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()})).status,409,'owner-cont:working-receipt-refused');
  await C.ops.updateOne({_id:inflightId},{$set:{state:'failed',safeError:'synthetic',completedAt:new Date()}});
  const draftBefore=await C.drafts.findOne({importId:new ObjectId(importId),line:2}),memoriesBefore=await C.memories.countDocuments();
  view=await ok(ws,plain);const reset1=crypto.randomUUID(),turnsBefore=view.conversation.turns.length;
  let next=await ok(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:reset1});
  assert.deepEqual(next.conversation.turns,[],'owner-cont:new-chat-empty');assert.equal(next.conversation.segment,1,'owner-cont:segment-advanced');
  const draftAfter=await C.drafts.findOne({importId:new ObjectId(importId),line:2});assert.equal(draftAfter.revision,draftBefore.revision,'owner-cont:reset-keeps-draft');assert.equal(draftAfter.values.taxRate,10);assert.equal(await C.memories.countDocuments(),memoriesBefore);
  const again=await ok(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:reset1});assert.equal(again.conversation.segment,1,'owner-cont:lost-reset-recognised');assert.equal(await archiveCount({ownerId:owner,conversationKind:'workspace'}),1,'owner-cont:lost-reset-one-archive');
  let history=await ok(ws+'/history',plain);assert.equal(history.archives.length,1,'owner-cont:history-list');assert.equal(history.archives[0].turnCount,turnsBefore);
  let detail=(await ok(ws+'/history/'+history.archives[0].id,plain)).archive;const archivedSave=detail.turns[0].actions.find(a=>a.operationId===saved.receipt.operationId);
  assert.equal(archivedSave?.state,'done','owner-cont:archive-keeps-receipts');assert.equal(detail.turns[0].proposal.summary.length,3000);assert.equal(detail.turns[2].actions.find(a=>a.slot===99)?.state,'failed','owner-cont:archive-keeps-failed-receipt');
  assert.equal((await api(ws+'/history/'+history.archives[0].id,Q.token)).status,404,'owner-cont:foreign-archive-404');assert.equal((await ok(ws+'/history',Q.token)).archives.length,0,'owner-cont:foreign-history-empty');
  // the cap: 200 turns, the send names the new chat, a new chat archives all of them and the conversation continues
  const live=await C.assistants.findOne({ownerId:owner}),filler=Array.from({length:200},(_,i)=>({id:'cap'+String(i).padStart(14,'0'),text:'synthetic '+i,at:new Date(),pageName:'明細マッピング'}));
  await C.assistants.updateOne({_id:live._id},{$set:{turns:filler,state:'ready',currentId:filler.at(-1).id},$inc:{revision:1}});
  const capped=await wsSend(plain,'200件の後');assert.equal(capped.response.status,409);assert.match(capped.response.data?.data?.message||capped.response.raw,/新しい会話/,'owner-cont:cap-points-to-new-chat');
  view=await ok(ws,plain);next=await ok(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()});assert.equal(next.conversation.segment,2);
  assert.equal((await C.archives.findOne({ownerId:owner,conversationKind:'workspace',segment:1})).turnCount,200,'owner-cont:new-at-cap');
  t=await wsTurn(plain,'上限の後も続けられる？');await finished(t.job,'続けられます。');pass('owner workspace: 4000-character explanation with one fixed page link, refused record/unsupported links, busy and working refusals, new chat archiving every receipt without touching drafts or memories, lost reset, scoped history and the 200 cap');
  // concurrent resets of the same revision share one copy; a stale unadopted copy is replaced keeping its id
  view=await ok(ws,plain);const twins=await Promise.all([api(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()}),api(ws+'/new',plain,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()})]);
  assert.ok(twins.some(r=>r.status===200)&&twins.every(r=>[200,409].includes(r.status)),'owner-cont:concurrent-reset-status '+twins.map(r=>r.status));
  assert.equal(await archiveCount({ownerId:owner,conversationKind:'workspace',segment:2}),1,'owner-cont:concurrent-one-archive');assert.equal((await C.assistants.findOne({ownerId:owner})).segment,3,'owner-cont:concurrent-one-advance');
  t=await wsTurn(plain,'古いコピーのテスト');await finished(t.job,'回答');const staleLive=await C.assistants.findOne({ownerId:owner}),staleId=new ObjectId();
  await C.archives.insertOne({_id:staleId,ownerId:owner,conversationKind:'workspace',conversationId:staleLive._id,segment:3,resetId:'stale-reset-request-0001',fromRevision:staleLive.revision-1,turns:[],turnCount:0,createdAt:new Date(),updatedAt:new Date()});
  assert.equal((await ok(ws+'/history',plain)).archives.some(a=>a.segment===3),false,'owner-cont:unadopted-not-listed');
  await ok(ws+'/new',plain,'POST',{chatRevision:staleLive.revision,requestId:crypto.randomUUID()});const replaced=await C.archives.findOne({conversationId:staleLive._id,segment:3});
  assert.equal(String(replaced._id),String(staleId),'owner-cont:stale-copy-keeps-id');assert.equal(replaced.fromRevision,staleLive.revision,'owner-cont:stale-copy-current-revision');assert.equal(replaced.turnCount,1);
  pass('owner workspace concurrent resets of one revision share one archive; a stale unadopted copy is replaced in place keeping its id and is never listed before adoption');

  // 2 purchase chat: new chat and history per purchase; archived proposals are evidence, never a fresh apply reference; cap 100.
  const chatPath=line=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,draftPath=line=>'/api/finance/imports/'+importId+'/drafts/'+line;
  const chatSend=async(token,line,text,extra={})=>{const d=await ok(draftPath(line),token),c=await ok(chatPath(line),token);return api(chatPath(line),token,'POST',{revision:d.revision,key:d.key,sourceHash:d.sourceHash,chatRevision:c.conversation?.revision||0,requestId:crypto.randomUUID(),text,...extra})};
  const chatTurn=async(token,line,text,w=worker,extra)=>{const r=await chatSend(token,line,text,extra);assert.equal(r.status,200,'owner-cont:purchase-send '+r.raw.slice(0,300));const claimed=await w('claim');assert.ok(claimed.data?.job,'owner-cont:purchase-claim '+claimed.raw.slice(0,300));return claimed.data.job};
  let pj=await chatTurn(plain,3,'会社の備品として使いました');assert.equal((await finish(pj,{kind:'proposal',summary:'会社の備品として整理します。',patch:{purpose:'company'},quotes:{purpose:'会社の備品'}})).status,200);
  let chat=await ok(chatPath(3),plain);const proposalTurn=chat.conversation.turns.at(-1);assert.ok(proposalTurn.reference,'SETUP proposal reference');
  const d3=await ok(draftPath(3),plain);chat=await ok(chatPath(3),plain);
  next=await ok(chatPath(3)+'/new',plain,'POST',{chatRevision:chat.conversation.revision,requestId:crypto.randomUUID()});assert.deepEqual(next.conversation.turns,[],'owner-cont:purchase-new-chat');assert.equal(next.conversation.segment,1);assert.equal(next.stale,false);
  assert.equal((await ok(draftPath(3),plain)).revision,d3.revision,'owner-cont:purchase-reset-keeps-draft');
  const refused=await chatSend(plain,3,'さっきの提案を反映して',{references:[proposalTurn.reference]});assert.equal(refused.status,409,'owner-cont:archived-proposal-not-referable');
  assert.equal((await api(chatPath(3)+'/confirm',plain,'POST',{...{revision:d3.revision,key:d3.key,sourceHash:d3.sourceHash},chatRevision:next.conversation.revision,turnId:proposalTurn.id,remember:false})).status,409,'owner-cont:archived-confirm-refused');
  history=await ok(chatPath(3)+'/history',plain);assert.equal(history.archives.length,1);detail=(await ok(chatPath(3)+'/history/'+history.archives[0].id,plain)).archive;assert.equal(detail.turns[0].proposal.kind,'proposal','owner-cont:purchase-archive-evidence');assert.equal(Object.hasOwn(detail.turns[0],'reference'),false,'owner-cont:archived-reference-not-offered');
  assert.equal((await api(chatPath(3)+'/history',Q.token)).status,404,'owner-cont:purchase-foreign-404');assert.equal((await api(chatPath(2)+'/history/'+history.archives[0].id,plain)).status,404,'owner-cont:purchase-other-line-404');
  const pc=await C.chats.findOne({ownerId:owner,importId:new ObjectId(importId),line:3}),pfill=Array.from({length:100},(_,i)=>({id:'pcap'+String(i).padStart(13,'0'),text:'synthetic '+i,at:new Date()}));
  await C.chats.updateOne({_id:pc._id},{$set:{turns:pfill,state:'ready',currentId:pfill.at(-1).id},$inc:{revision:1}});const pcap=await chatSend(plain,3,'上限の後');assert.equal(pcap.status,409);assert.match(pcap.data?.data?.message||pcap.raw,/新しい会話/,'owner-cont:purchase-cap-points-to-new-chat');
  chat=await ok(chatPath(3),plain);await ok(chatPath(3)+'/new',plain,'POST',{chatRevision:chat.conversation.revision,requestId:crypto.randomUUID()});pj=await chatTurn(plain,3,'続けます');assert.equal((await finish(pj,reply('続けられます。'))).status,200,'owner-cont:purchase-after-cap');
  pass('purchase chat: new chat and history per purchase, draft untouched, archived proposals cannot be applied or confirmed, foreign/other-line history refused, 100 cap continues');

  // 3 realm-aware feature guide: only tools this job actually has are named; other features are a page or unsupported.
  t=await wsTurn(plain,'カードの明細取得はどこでできる？');const toolNames=new Set(t.job.tools.map(x=>x.name));
  let guide=(await acted(t.job,1,'list_navi_features',{})).result;const connections=guide.features.find(f=>f.id==='connections');
  assert.equal(connections.disposition,'navi_tool','owner-cont:owner-realm-connections');assert.ok(connections.tools.includes('queue_card_sync'));
  assert.ok(guide.features.every(f=>f.tools.every(n=>toolNames.has(n))),'owner-cont:realm-tools-intersection');assert.equal(guide.features.find(f=>f.id==='transactions').disposition,'page_handoff','owner-cont:company-tools-not-owner');
  assert.equal(guide.features.find(f=>f.id==='authentication').disposition,'unsupported');await finished(t.job,'カード連携から取得できます。',{navigation:{feature:'connections'}});
  pj=await chatTurn(plain,5,'この画面以外でできることは？');const pguide=(await acted(pj,1,'list_navi_features',{})).result,pnames=new Set(pj.tools.map(x=>x.name));
  assert.ok(pguide.features.every(f=>f.tools.every(n=>pnames.has(n))),'owner-cont:purchase-realm-intersection');assert.equal(pguide.features.find(f=>f.id==='connections').disposition,'page_handoff','owner-cont:purchase-realm-no-sync');
  assert.equal((await finish(pj,reply('カード連携の画面で操作します。'))).status,200);
  pass('the feature guide names only the tools of the current realm and job; company and sensitive features stay page or unsupported');

  // 4 same-company teaching bridge: frozen selected company + workspace-capable worker + current membership; tagged turns stay
  // inside that company in model input, UI and archives; narrow, companyless, switched and revoked continuations get nothing.
  const teachA=new ObjectId(),teachC=new ObjectId(),src=(org,actor)=>({actorId:actor,conversationId:new ObjectId(),segment:0,turnId:'seed',quote:'seed',at:new Date()});
  await C.knowledge.insertMany([{_id:teachA,organizationId:A,createdBy:owner,status:'active',revision:1,instruction:'Bridge shopの文具は消耗品費 A_TEACH_SECRET',conditions:{merchant:'Bridge shop'},suggested:{},source:src(A,owner),history:[],operations:[],createdAt:new Date(),updatedAt:new Date()},{_id:teachC,organizationId:Cx,createdBy:Q.id,status:'active',revision:1,instruction:'Bridge shopは交際費 C_TEACH_SECRET',conditions:{merchant:'Bridge shop'},suggested:{},source:src(Cx,Q.id),history:[],operations:[],createdAt:new Date(),updatedAt:new Date()}]);
  const memoryCount=await C.memories.countDocuments();
  t=await wsTurn(tokenA,'Bridge shopの購入はどう処理する？');const jobA=JSON.stringify(t.job);
  assert.ok(t.job.knowledge?.some(k=>k.id===String(teachA)),'owner-cont:bridge-recall-A');assert.ok(!jobA.includes('C_TEACH_SECRET'),'owner-cont:bridge-no-foreign-teaching');assert.equal(t.job.teachingCompany?.name,'Synthetic continuation company A');
  assert.ok(t.job.tools.some(x=>x.name==='remember_company_knowledge')&&t.job.tools.some(x=>x.name==='search_company_knowledge'),'owner-cont:bridge-teaching-tools');
  let stored=(await C.assistants.findOne({ownerId:owner})).turns.find(x=>x.id===t.requestId);assert.equal(String(stored.companyContext?.organizationId),String(A),'owner-cont:bridge-turn-tagged');
  await finished(t.job,'A_DERIVED_REPLY 消耗品費として扱います。');
  const snap=await ledger();t=await wsTurn(tokenA,'これを覚えて: Bridge shopの配送料は荷造運賃にする');
  assert.equal((await act(t.job,1,'remember_company_knowledge',{instruction:'配送料は運賃でまとめて'})).status,400,'owner-cont:bridge-quote-required');
  const remembered=await acted(t.job,2,'remember_company_knowledge',{instruction:'Bridge shopの配送料は荷造運賃にする',merchant:'Bridge shop'});assert.equal(remembered.receipt.state,'done','owner-cont:bridge-remember-done');
  const kid=remembered.receipt.nativeResourceIds.knowledgeId,row=await C.knowledge.findOne({_id:new ObjectId(kid)});
  assert.equal(String(row.organizationId),String(A),'owner-cont:bridge-remember-company');assert.equal(row.source.conversationKind,'workspace','owner-cont:bridge-provenance-kind');assert.equal(row.source.quote,'Bridge shopの配送料は荷造運賃にする');assert.equal(String(row.source.conversationId),String((await C.assistants.findOne({ownerId:owner}))._id));
  const paused=await acted(t.job,3,'set_company_knowledge_status',{knowledgeId:kid,expectedRevision:1,status:'paused'});assert.equal(paused.receipt.state,'done');const pausedRow=await C.knowledge.findOne({_id:new ObjectId(kid)});assert.equal(pausedRow.status,'paused','owner-cont:bridge-pause');assert.equal(pausedRow.history.at(-1).replacedBy.conversationKind,'workspace');
  assert.equal(await ledger(),snap,'owner-cont:bridge-no-ledger-change');assert.equal(await C.memories.countDocuments(),memoryCount,'owner-cont:bridge-legacy-memory-untouched');
  await finished(t.job,'覚えました。');
  await C.ops.updateOne({operationId:remembered.receipt.operationId},{$set:{state:'claimed',lease:'lost',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:''}});
  let receipt=(await ok(ws,tokenA)).conversation.turns.find(x=>x.id===t.requestId).actions.find(a=>a.operationId===remembered.receipt.operationId);assert.equal(receipt.state,'done','owner-cont:bridge-recovery-marker');assert.equal(receipt.nativeResourceIds.knowledgeId,kid);
  // switch to company B: no A teaching, the A-tagged turns are withheld from the model input and from the B view
  t=await wsTurn(tokenB,'Bridge shopの扱いは？');const jobB=JSON.stringify(t.job);
  assert.ok(!(t.job.knowledge||[]).some(k=>k.id===String(teachA)),'owner-cont:bridge-switch-no-A');assert.ok(!jobB.includes('A_DERIVED_REPLY')&&!jobB.includes('A_TEACH_SECRET')&&!jobB.includes('荷造運賃'),'owner-cont:bridge-switch-history-withheld');
  await finished(t.job,'B社としての回答です。');
  let rawB=(await api(ws,tokenB)).raw,rawA=(await api(ws,tokenA)).raw,rawPlain=(await api(ws,plain)).raw;
  assert.ok(!rawB.includes('A_DERIVED_REPLY')&&!rawB.includes('荷造運賃'),'owner-cont:bridge-ui-masked-other-company');assert.ok(rawA.includes('A_DERIVED_REPLY'),'owner-cont:bridge-ui-same-company');assert.ok(!rawPlain.includes('A_DERIVED_REPLY'),'owner-cont:bridge-ui-masked-no-company');
  // no company: an ordinary owner conversation, no teaching data or tools
  t=await wsTurn(plain,'Bridge shopの扱いは？');assert.ok(!(t.job.knowledge||[]).length&&!t.job.tools.some(x=>x.name==='search_company_knowledge'),'owner-cont:bridge-no-company-ordinary');assert.ok(!JSON.stringify(t.job).includes('A_DERIVED_REPLY'));
  assert.equal((await act(t.job,1,'search_company_knowledge',{})).status,403,'owner-cont:bridge-no-company-tool-refused');await finished(t.job,'会社を選ぶと会社の記憶も使えます。');
  // revoked before the claim and between claim and action/result
  let sent=await wsSend(tokenA,'Bridge shopの扱いは？');assert.equal(sent.response.status,200);await C.orgs.updateOne({_id:A},{$set:{members:[]}});
  t={job:(await worker('workspace-claim')).data.job};assert.ok(!(t.job.knowledge||[]).length&&!JSON.stringify(t.job).includes('A_DERIVED_REPLY'),'owner-cont:bridge-revoked-no-recall');assert.equal((await act(t.job,1,'search_company_knowledge',{})).status,403,'owner-cont:bridge-revoked-action-refused');
  await finished(t.job,'回答');await C.orgs.updateOne({_id:A},{$set:{members:membersA}});
  t=await wsTurn(tokenA,'Bridge shopの記憶を検索して');assert.ok(t.job.knowledge?.length);await C.orgs.updateOne({_id:A},{$set:{members:[]}});
  assert.equal((await act(t.job,1,'search_company_knowledge',{})).status,403,'owner-cont:bridge-action-fresh-check');
  await finished(t.job,'A_LATE_REPLY');
  const afterRevoke=await C.assistants.findOne({ownerId:owner});assert.equal(afterRevoke.state,'failed','owner-cont:bridge-result-fresh-check');assert.ok(!JSON.stringify(afterRevoke.turns).includes('A_LATE_REPLY'));
  await C.orgs.updateOne({_id:A},{$set:{members:membersA}});await ok(ws+'/retry',plain,'POST',{chatRevision:afterRevoke.revision});t={job:(await worker('workspace-claim')).data.job};await finished(t.job,'回答');
  // narrow (card-only) worker keeps the original purchase chat without company data
  pj=await chatTurn(tokenA,4,'Bridge shopのこの購入は？');assert.ok(pj.knowledge?.some(k=>k.id===String(teachA)),'owner-cont:bridge-purchase-recall');assert.equal((await finish(pj,reply('A_PURCHASE_REPLY'))).status,200);
  assert.equal((await api('/api/finance-chat/agents/'+wide.id,plain,'DELETE')).status,200);
  const narrow=await ok('/api/finance-chat/agents',plain,'POST',{accountIds:[String(amexA._id)],workspaceEnabled:false}),nworker=workerAs(narrow);assert.equal((await nworker('heartbeat',{})).status,200);
  pj=await chatTurn(tokenA,4,'税率を10にして',nworker);const nraw=JSON.stringify(pj);
  assert.ok(!(pj.knowledge||[]).length&&!pj.tools.some(x=>/company_knowledge/.test(x.name)),'owner-cont:bridge-narrow-card-only');assert.ok(!nraw.includes('A_PURCHASE_REPLY')&&!nraw.includes('A_TEACH_SECRET'),'owner-cont:bridge-narrow-history-withheld');
  assert.equal((await acted(pj,1,'save_draft_fields',{fields:{taxRate:10}},nworker)).receipt.state,'done','owner-cont:bridge-narrow-keeps-card-chat');assert.equal((await finish(pj,reply('保存しました。'),nworker)).status,200);
  const wide2=await ok('/api/finance-chat/agents',plain,'POST',{accountIds:[String(amexA._id),String(aplus._id)],workspaceEnabled:true});Object.assign(wide,wide2);assert.equal((await worker('heartbeat',{})).status,200);
  // archives stay inside the company: B and no-company views mask the A turns
  view=await ok(ws,tokenA);await ok(ws+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomUUID()});history=await ok(ws+'/history',tokenA);const bridgeArchive=history.archives[0].id;
  assert.ok((await api(ws+'/history/'+bridgeArchive,tokenA)).raw.includes('A_DERIVED_REPLY'),'owner-cont:bridge-archive-same-company');assert.ok(!(await api(ws+'/history/'+bridgeArchive,tokenB)).raw.includes('A_DERIVED_REPLY'),'owner-cont:bridge-archive-masked');assert.ok(!(await api(ws+'/history',tokenB)).raw.includes('Bridge shopの配送料'),'owner-cont:bridge-archive-preview-masked');
  assert.ok(!logs.includes('C_TEACH_SECRET'));
  pass('company teaching bridge: recall, quoted remember and pause with workspace provenance under the frozen company; switched, companyless, revoked (claim/action/result) and narrow continuations receive nothing; UI and archives stay inside the company');

  // 5 card sync status and queue: assigned cards only, no credentials, a queued receipt with its native marker, refusals and recovery.
  t=await wsTurn(plain,'カードの取得状況を見せて、Amexの明細取得を予約して');
  let status=await acted(t.job,1,'get_card_sync_status',{}),statusRaw=JSON.stringify(status);
  assert.deepEqual(status.result.accounts.map(a=>a.id).sort(),[String(amexA._id),String(aplus._id)].sort(),'owner-cont:sync-assigned-only');assert.ok(!statusRaw.includes('otp-private')&&!statusRaw.includes('PRIVATE_UNASSIGNED_CARD')&&!/otpRecipient|otpMailbox|tokenHash|jobDeviceId/.test(statusRaw),'owner-cont:sync-no-credentials');
  let before=await C.accounts.findOne({_id:new ObjectId(amexA._id)});const noCollector=await act(t.job,2,'queue_card_sync',{accountId:String(amexA._id)});assert.equal(noCollector.status,409,'owner-cont:sync-no-collector-refused');assert.equal((await C.accounts.findOne({_id:before._id})).jobState,before.jobState);
  await ok('/api/finance/collectors',plain,'POST',{name:'Synthetic collector',accountIds:[String(amexA._id)]});
  let writes=0,queuedSync;writes=await profileWrites('financialaccounts',async()=>{queuedSync=await acted(t.job,3,'queue_card_sync',{accountId:String(amexA._id)})});
  assert.equal(queuedSync.receipt.state,'queued','owner-cont:sync-queued-receipt');assert.equal(queuedSync.result.downloaded,false);let acct=await C.accounts.findOne({_id:before._id});
  assert.equal(acct.jobState,'queued');assert.equal(acct.jobOperation?.operationId,queuedSync.receipt.operationId,'owner-cont:sync-native-marker');assert.equal(acct.jobOperation.jobId,acct.jobId);assert.equal(queuedSync.receipt.nativeResourceIds.jobId,acct.jobId);assert.equal(writes,1,'owner-cont:sync-one-write');
  const retried=await acted(t.job,3,'queue_card_sync',{accountId:String(amexA._id)});assert.equal(retried.receipt.operationId,queuedSync.receipt.operationId,'owner-cont:sync-retry-same');assert.equal((await C.accounts.findOne({_id:before._id})).jobId,acct.jobId);
  assert.equal((await act(t.job,4,'queue_card_sync',{accountId:String(amexA._id)})).status,409,'owner-cont:sync-already-queued');
  const xBefore=await C.accounts.findOne({_id:new ObjectId(amexX._id)});assert.equal((await act(t.job,5,'queue_card_sync',{accountId:String(amexX._id)})).status,404,'owner-cont:sync-unassigned-refused');assert.equal((await C.accounts.findOne({_id:xBefore._id})).jobState,xBefore.jobState);
  await finished(t.job,'明細の取得を予約しました（まだ取得は完了していません）。');
  const lostSync=async(unset={})=>{await C.ops.updateOne({operationId:queuedSync.receipt.operationId},{$set:{state:'claimed',lease:'lost',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:'',recoveryOwner:'',safeError:''}});if(Object.keys(unset).length)await C.accounts.updateOne({_id:before._id},{$unset:unset});return(await ok(ws,plain)).conversation.turns.find(x=>x.id===t.requestId).actions.find(a=>a.operationId===queuedSync.receipt.operationId)};
  receipt=await lostSync();assert.equal(receipt.state,'queued','owner-cont:sync-recovery-marker');assert.equal(receipt.nativeResourceIds.jobId,acct.jobId);
  receipt=await lostSync({jobOperation:''});assert.equal(receipt.state,'failed','owner-cont:sync-recovery-no-marker');
  await C.accounts.updateOne({_id:before._id},{$set:{jobState:'complete'},$unset:{jobOperation:''}});const native=await ok('/api/finance/accounts/'+amexA._id+'/sync',plain,'POST');
  assert.equal(native.account.jobState,'queued','owner-cont:sync-native-route-positive');assert.equal((await C.accounts.findOne({_id:before._id})).jobOperation,undefined,'owner-cont:sync-native-no-marker');
  // reclaim after a worker crash carries the receipts and the next free slot
  t=await wsTurn(plain,'状況をもう一度');await acted(t.job,1,'get_card_sync_status',{});await C.assistants.updateOne({ownerId:owner},{$set:{leaseUntil:new Date(Date.now()-1000)}});
  const reclaimed=(await worker('workspace-claim')).data.job;assert.equal(reclaimed.id,t.job.id,'owner-cont:reclaim-same-turn');assert.equal(reclaimed.nextSlot,1,'owner-cont:reclaim-reads-not-journaled');assert.notEqual(reclaimed.lease,t.job.lease);
  assert.equal((await act(t.job,2,'get_card_sync_status',{})).status,409,'owner-cont:old-lease-refused');await finished(reclaimed,'回答');
  pass('card sync: assigned-card status without credentials, a queued receipt with its job marker in one native write, retry/already-queued/unassigned/no-collector refusals, marker recovery, unchanged native route, reclaim and old lease');

  // 6 automatic sync schedule: shared native helper, Aplus only, lastQueuedDay kept, marker recovery, unchanged native route.
  t=await wsTurn(plain,'Aplusの自動取得を毎日7時にして');
  const auto=await acted(t.job,1,'set_card_auto_sync',{accountId:String(aplus._id),enabled:true,hour:7});assert.equal(auto.receipt.state,'done');
  acct=await C.accounts.findOne({_id:new ObjectId(aplus._id)});assert.equal(acct.autoSync.enabled,true);assert.equal(acct.autoSync.hour,7);assert.equal(acct.autoSync.lastQueuedDay,'2026-10-01','owner-cont:auto-keeps-lastQueuedDay');assert.equal(acct.autoSyncOperation?.operationId,auto.receipt.operationId,'owner-cont:auto-native-marker');
  assert.equal((await act(t.job,2,'set_card_auto_sync',{accountId:String(amexA._id),enabled:true,hour:7})).status,400,'owner-cont:auto-aplus-only');assert.equal((await act(t.job,3,'set_card_auto_sync',{accountId:String(aplus._id),enabled:true,hour:24})).status,400,'owner-cont:auto-hour-validated');
  await finished(t.job,'自動取得を毎日7時以降に設定しました。');
  await C.ops.updateOne({operationId:auto.receipt.operationId},{$set:{state:'claimed',lease:'lost',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:''}});receipt=(await ok(ws,plain)).conversation.turns.find(x=>x.id===t.requestId).actions.find(a=>a.operationId===auto.receipt.operationId);assert.equal(receipt.state,'done','owner-cont:auto-recovery-marker');
  assert.deepEqual((await ok('/api/finance/accounts/'+aplus._id+'/auto-sync',plain,'PUT',{enabled:false,hour:9})).autoSync,{enabled:false,hour:9},'owner-cont:auto-native-route-positive');acct=await C.accounts.findOne({_id:new ObjectId(aplus._id)});assert.equal(acct.autoSync.lastQueuedDay,'2026-10-01');assert.equal(acct.autoSync.enabled,false);
  pass('automatic sync: shared helper writes enabled/hour with its marker, keeps lastQueuedDay, refuses Amex and invalid hours, recovers from the marker; the native settings route behaves as before');

  // 7 purchase workflow: assigned-card rows only, no global settings, explicit retry with its marker in the native revision write.
  const step=state=>({stage:'purchase',unit:'purchase',state,reason:state==='manual_review'?'ambiguous':'pending',cycle:1,failedNights:0,lifetimeFailedNights:0,lastFailedDay:null,firstWaitingAt:null,lastCheckedAt:null,completedAt:null,snoozedUntil:null});
  const W1=new ObjectId(),W2=new ObjectId();await C.workflows.insertMany([{_id:W1,ownerId:owner,accountId:new ObjectId(amexA._id),importId:new ObjectId(importId),line:2,key:'w1',sourceHash:'h',payment:{date:'2026-08-02',amount:1102,merchant:'Continuation shop two',accountName:'Continuation Amex'},version:1,revision:3,steps:{purchase:step('manual_review')},summary:{state:'manual_review'},events:[],createdAt:new Date(),updatedAt:new Date()},{_id:W2,ownerId:owner,accountId:new ObjectId(amexX._id),importId:new ObjectId(importX),line:2,key:'w2',sourceHash:'h',payment:{date:'2026-08-07',amount:2201,merchant:'PRIVATE_WORKFLOW_X',accountName:'PRIVATE_UNASSIGNED_CARD'},version:1,revision:3,steps:{purchase:step('manual_review')},summary:{state:'manual_review'},events:[],createdAt:new Date(),updatedAt:new Date()}]);
  await db.collection('financeworkflowconfigs').insertOne({ownerId:owner,revision:1,enabled:false,accountIds:[new ObjectId(amexX._id)],from:'2026-01-01',through:'2026-12-31',workerCapabilities:['purchase']});
  t=await wsTurn(plain,'購入照合の状況を見て、要確認の購入を再確認に戻して');const wf=await acted(t.job,1,'get_workflow_status',{}),wfRaw=JSON.stringify(wf);
  assert.deepEqual(wf.result.rows.map(r=>r.id),[String(W1)],'owner-cont:workflow-assigned-only');assert.ok(!wfRaw.includes('PRIVATE_WORKFLOW_X')&&!wfRaw.includes('PRIVATE_UNASSIGNED_CARD'),'owner-cont:workflow-no-other-card');assert.ok(!('config' in wf.result)&&!('runs' in wf.result)&&!('workers' in wf.result),'owner-cont:workflow-no-global-settings');assert.equal(wf.result.counts.manualReview,1,'owner-cont:workflow-counts-scoped');
  const review=await acted(t.job,2,'review_workflow_step',{workflowId:String(W1),expectedRevision:3,step:'purchase',action:'retry',reason:'在庫を再確認して'});assert.equal(review.receipt.state,'done');assert.equal(review.receipt.acceptedRevision,4);
  const w1=await C.workflows.findOne({_id:W1});assert.equal(w1.steps.purchase.state,'pending','owner-cont:workflow-retry-saved');assert.equal(w1.events.at(-1).operation?.operationId,review.receipt.operationId,'owner-cont:workflow-native-marker');
  assert.equal((await act(t.job,3,'review_workflow_step',{workflowId:String(W1),expectedRevision:3,step:'purchase',action:'snooze',until:'2099-01-01',reason:'後で'})).status,409,'owner-cont:workflow-stale-refused');
  assert.equal((await act(t.job,4,'review_workflow_step',{workflowId:String(W2),expectedRevision:3,step:'purchase',action:'retry',reason:'x'})).status,404,'owner-cont:workflow-unassigned-refused');assert.equal((await C.workflows.findOne({_id:W2})).revision,3);
  await finished(t.job,'再確認に戻しました（在庫や書類の処理はまだ完了していません）。');
  await C.ops.updateOne({operationId:review.receipt.operationId},{$set:{state:'claimed',lease:'lost',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:''}});receipt=(await ok(ws,plain)).conversation.turns.find(x=>x.id===t.requestId).actions.find(a=>a.operationId===review.receipt.operationId);assert.equal(receipt.state,'done','owner-cont:workflow-recovery-marker');assert.equal(receipt.acceptedRevision,4);
  assert.equal((await ok('/api/finance-workflow/'+W2+'/review',plain,'POST',{revision:3,step:'purchase',action:'retry',reason:'owner'})).revision,4,'owner-cont:workflow-native-route-positive');
  pass('workflow: assigned-card rows and counts only, no global settings, explicit retry saved with its marker, stale and unassigned refused, marker recovery, native owner review unchanged');

  // 8 assigned-card allocation: the same scope before any derivation, requestId from the operation, release/reconfirm markers.
  const record=await ok('/api/finance-intake/records',plain,'POST',{values:{orderId:'OWNER-CONT-01',description:'Bridge shop order',amount:'1104',supplierName:'Synthetic seller'}});
  const bankAccount=(await ok('/api/finance-payments/bank/accounts',plain,'POST',{name:'PRIVATE_BANK_ACCOUNT',currency:'JPY'})).account;assert.ok(bankAccount);
  t=await wsTurn(plain,'4行目の支払いを受付 OWNER-CONT-01 に配分して',{page:'intake-payments',paymentKind:'card',paymentImportId:importId,paymentLine:4});
  let pm=(await acted(t.job,1,'get_card_payment_match',{})).result;assert.equal(pm.payment.importId,importId);
  let alloc;writes=await profileWrites('financepayments',async()=>{alloc=await acted(t.job,2,'confirm_card_allocation',{importId,line:4,recordId:record.id,amount:1104,paymentRevision:pm.payment.paymentRevision,recordRevision:record.revision,note:'Navi synthetic'})});
  assert.equal(alloc.receipt.state,'done','owner-cont:alloc-saved');const allocRaw=JSON.stringify(alloc);assert.ok(!allocRaw.includes('PRIVATE_BANK_ACCOUNT')&&!allocRaw.includes('PRIVATE_UNASSIGNED'),'owner-cont:alloc-scoped-result');
  let match=await C.matches.findOne({ownerId:owner,'allocations.requestId':'navi_'+alloc.receipt.operationId});assert.ok(match,'owner-cont:alloc-request-marker');assert.equal(match.allocations.length,1);assert.ok(writes<=2,'owner-cont:alloc-bounded-writes '+writes);
  const allocationId=match.allocations[0].id;assert.equal(alloc.receipt.nativeResourceIds.allocationId,allocationId);
  assert.equal((await acted(t.job,2,'confirm_card_allocation',{importId,line:4,recordId:record.id,amount:1104,paymentRevision:pm.payment.paymentRevision,recordRevision:record.revision,note:'Navi synthetic'})).receipt.operationId,alloc.receipt.operationId,'owner-cont:alloc-retry-same');assert.equal((await C.matches.findOne({_id:match._id})).allocations.length,1);
  pm=(await acted(t.job,3,'get_card_payment_match',{})).result;assert.equal((await act(t.job,4,'confirm_card_allocation',{importId,line:4,recordId:record.id,amount:1,paymentRevision:pm.payment.paymentRevision,recordRevision:record.revision})).status,409,'owner-cont:alloc-over-refused');
  assert.equal((await act(t.job,5,'confirm_card_allocation',{importId:importX,line:2,recordId:record.id,amount:100,paymentRevision:0,recordRevision:record.revision})).status,404,'owner-cont:alloc-unassigned-refused');
  const reconfirmed=await acted(t.job,6,'reconfirm_card_allocation',{importId,line:4,allocationId,paymentRevision:pm.payment.paymentRevision,recordRevision:record.revision});assert.equal(reconfirmed.receipt.state,'done','owner-cont:alloc-reconfirmed');
  pm=(await acted(t.job,7,'get_card_payment_match',{})).result;const released=await acted(t.job,8,'release_card_allocation',{importId,line:4,allocationId,paymentRevision:pm.payment.paymentRevision});assert.equal(released.receipt.state,'done');
  match=await C.matches.findOne({_id:match._id});assert.equal(match.allocations[0].status,'released','owner-cont:alloc-released');assert.equal(match.allocations[0].history.at(-1).operation?.operationId,released.receipt.operationId,'owner-cont:alloc-release-marker');
  await finished(t.job,'配分を保存し、確認後に解除しました。');
  const lostOp=async op=>{await C.ops.updateOne({operationId:op},{$set:{state:'claimed',lease:'lost',leaseUntil:new Date(Date.now()-120000)},$unset:{receipt:'',completedAt:''}});return(await ok(ws,plain)).conversation.turns.find(x=>x.id===t.requestId).actions.find(a=>a.operationId===op)};
  assert.equal((await lostOp(alloc.receipt.operationId)).state,'done','owner-cont:alloc-recovery-save');assert.equal((await lostOp(released.receipt.operationId)).state,'done','owner-cont:alloc-recovery-release');
  const xp=(await ok('/api/finance-payments/payments',plain)).payments.find(p=>p.description==='PRIVATE_UNASSIGNED_CHARGE');assert.ok(xp,'SETUP owner payment list');
  await ok('/api/finance-payments/'+xp.endpoint+'/allocations',plain,'POST',{confirm:true,requestId:crypto.randomUUID(),paymentRevision:xp.paymentRevision,recordRevision:record.revision,amount:100,target:{kind:'intake',recordId:record.id},note:'owner'});
  assert.equal((await ok('/api/finance-payments/records/'+record.id,plain)).allocations.length>=2,true,'owner-cont:alloc-native-owner-unrestricted');
  pass('assigned-card allocation: scoped context before derivation, operation request id, retry, over-allocation and unassigned refusals, reconfirm and release with history markers, marker recovery, owner page unrestricted');
  }

  // 10-15 request identity across New chat and the uncertain-send exit of the owner workspace and purchase chats (plan
  // omf-navi-agent-owner-retry-20261023, docs/navi-turn-continuity.md). Each group owns a synthetic owner, card, statement and worker, so a
  // red group never hides another: it prints `FAIL <key>: <assertion>` and the run fails at its end. Setup steps throw SETUP (never a
  // detection); behaviour fails with its own `owner-cont:` assertion. The worker sequences are controlled synthetic claims, never a
  // model decision; "not accepted" means only that Navi never stored that request id in this conversation.
  const isolated=async(key,name,fn)=>{if(!wanted(key))return;try{await fn();pass(name)}catch(e){red.push(key);console.log('FAIL '+key+': '+String(e?.stack||e).replace(/\s+/g,' ').slice(0,2500))}};
  const must=async(route,token,method='GET',body,label='')=>{const r=await api(route,token,method,body);if(r.status!==200)throw Error('SETUP '+label+' '+method+' '+route+' '+r.status+' '+r.raw.slice(0,300));return r.data};
  const mustAct=async(job,slot,name,args,w)=>{if(!job)throw Error('SETUP no claimed job for '+name);const r=await act(job,slot,name,args,w);if(r.status!==200||!['done','queued'].includes(r.data?.receipt?.state))throw Error('SETUP action '+name+' '+r.status+' '+r.raw.slice(0,300));return r.data};
  const mustFinish=async(job,summary,w)=>{if(!job)throw Error('SETUP no claimed job to finish');const r=await finish(job,reply(summary),w);if(r.status!==200)throw Error('SETUP finish '+r.status+' '+r.raw.slice(0,300))};
  let retrySeq=0;
  // The app's own registration limit (5 per minute per client) is respected, never bypassed: a 429 waits the time the app names, then
  // the same registration is tried again (SETUP only; fail-first-02 met this limit at its ninth synthetic person).
  const registerOwner=async(email,name,label)=>{for(let attempt=0;attempt<4;attempt++){const r=await api('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name});if(r.status===200)return r.data.tokens.accessToken;const wait=r.status===429?Number((r.raw.match(/try again in (\d+) seconds/)||[])[1]):NaN;if(!Number.isFinite(wait))throw Error('SETUP '+label+' register '+r.status+' '+r.raw.slice(0,200));await pause((wait+1)*1000)}throw Error('SETUP '+label+' register still limited')};
  const retryOwner=async label=>{
   const n=++retrySeq,card='7'+String(n).padStart(4,'0'),email='owner-retry-'+n+'@example.invalid';
   const token=await registerOwner(email,'Synthetic retry owner '+n,label),id=(await db.collection('users').findOne({email}))._id;
   const account=(await must('/api/finance/accounts',token,'POST',{name:'Retry Amex '+n,provider:'amex',primaryCard:card,cardIdentifiers:[card],otpRecipient:'otp-retry-'+n+'@example.invalid',otpMailbox:'otp-retry-'+n+'@example.invalid'},label+' account')).account;
   const imported=await must('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',token,'POST',csv(card,[['02','Retry shop two',1302],['03','Retry shop three',1303],['04','Retry shop four',1304],['05','Retry shop five',1305]]),label+' statement');
   const agent=await must('/api/finance-chat/agents',token,'POST',{accountIds:[String(account._id)],workspaceEnabled:true},label+' worker'),w=workerAs(agent);if((await w('heartbeat',{})).status!==200)throw Error('SETUP '+label+' heartbeat');
   return {token,id,account,importId:String(imported.id),worker:w,label}};
  const wsBody=async(o,text,requestId,context,token=o.token)=>({text,requestId,chatRevision:(await must(ws,token,'GET',undefined,'workspace view')).conversation?.revision||0,context});
  const wsClaim=async o=>{const r=await o.worker('workspace-claim');return r.data?.job||null};
  const wsNew=async(o,extra={},token=o.token)=>{const v=await must(ws,token,'GET',undefined,'workspace view');return api(ws+'/new',token,'POST',{chatRevision:v.conversation?.revision||0,requestId:crypto.randomUUID(),...extra})};
  const pPath=(o,line)=>'/api/finance-chat/imports/'+o.importId+'/drafts/'+line,dPath=(o,line)=>'/api/finance/imports/'+o.importId+'/drafts/'+line;
  const pRevision=async(o,line)=>(await must(pPath(o,line),o.token,'GET',undefined,'purchase view')).conversation?.revision||0;
  const pBody=async(o,line,text,requestId,extra={})=>{const d=await must(dPath(o,line),o.token,'GET',undefined,'draft');return {revision:d.revision,key:d.key,sourceHash:d.sourceHash,chatRevision:await pRevision(o,line),requestId,text,references:[],...extra}};
  const pClaim=async o=>{const r=await o.worker('claim');return r.data?.job||null};
  const pNew=async(o,line,extra={})=>api(pPath(o,line)+'/new',o.token,'POST',{chatRevision:await pRevision(o,line),requestId:crypto.randomUUID(),...extra});
  const chatRow=(o,line)=>C.chats.findOne({ownerId:o.id,importId:new ObjectId(o.importId),line});

  // 10 owner workspace: the reproduced lead (an accepted request id sent again after New chat was queued again; the journal restored
  // its receipt and handed out the next slot) and the exact meaning of a request id.
  await isolated('owner-identity','owner request identity: an accepted request id is recognised in its adopted archive with its exact receipt and is never queued again; another text or context of that id keeps the existing conflict; a new id with the same words is a new request with its own journal',async()=>{
   const o=await retryOwner('owner-identity'),ctx={page:'mapping',importId:o.importId},rid=crypto.randomUUID(),text='2行目の税率を10にしてください';
   await must(ws,o.token,'POST',await wsBody(o,text,rid,ctx),'first send');let job=await wsClaim(o);if(job?.text!==text)throw Error('SETUP owner-identity claim');
   const saved=await mustAct(job,1,'save_draft_fields',{importId:o.importId,line:2,fields:{taxRate:10}},o.worker);await mustFinish(job,'2行目の税率を10%にしました。',o.worker);
   if((await wsNew(o)).status!==200)throw Error('SETUP owner-identity new chat');
   const opsBefore=await C.ops.countDocuments({ownerId:o.id}),draftBefore=await C.drafts.findOne({importId:new ObjectId(o.importId),line:2});
   // the same accepted HTTP identity (id, text, context) sent again after New chat, with the fresh conversation revision
   let r=await api(ws,o.token,'POST',await wsBody(o,text,rid,ctx));const live=await C.assistants.findOne({ownerId:o.id}),again=await wsClaim(o);if(again)await finish(again,reply('reclaimed'),o.worker);
   assert.ok(r.status===200&&!again&&live.state!=='queued'&&!live.turns.some(t=>String(t.id)===rid),'owner-cont:owner-archived-request-never-requeued '+JSON.stringify({status:r.status,state:live.state,reclaimed:!!again,recoveredReceipts:again?.actions?.length??null,nextSlot:again?.nextSlot??null}));
   const received=r.data.received,history=await must(ws+'/history',o.token,'GET',undefined,'history');
   assert.ok(received?.outcome==='accepted'&&received.where==='archive'&&received.archive?.id===history.archives[0]?.id,'owner-cont:owner-archived-recognised '+r.raw.slice(0,300));
   assert.equal(received.turn.actions.find(a=>a.operationId===saved.receipt.operationId)?.state,'done','owner-cont:owner-received-exact-receipt');assert.equal(received.turn.text,text,'owner-cont:owner-received-turn');
   assert.deepEqual(received.scope,{actorId:String(o.id),realm:'workspace',conversationId:String(live._id),organizationId:null},'owner-cont:owner-received-scope');assert.ok(!r.raw.includes('requestHash'),'owner-cont:owner-received-no-internal-hash');
   assert.equal(await C.ops.countDocuments({ownerId:o.id}),opsBefore,'owner-cont:owner-received-no-operation');assert.equal((await C.drafts.findOne({_id:draftBefore._id})).revision,draftBefore.revision,'owner-cont:owner-received-no-draft-write');
   // another meaning of the same id keeps the existing conflict exit: other text, or the same text with another page context
   r=await api(ws,o.token,'POST',await wsBody(o,text+'（別の依頼）',rid,ctx));assert.equal(r.status,409,'owner-cont:owner-archived-meaning-conflict '+r.status);assert.match(r.raw,/送信IDが既に使用されています/);
   r=await api(ws,o.token,'POST',await wsBody(o,text,rid,{page:'mapping'}));assert.equal(r.status,409,'owner-cont:owner-archived-context-conflict '+r.status);
   // a new id with identical words and context is a new request with its own journal (no text, date or amount deduplication)
   r=await api(ws,o.token,'POST',await wsBody(o,text,crypto.randomUUID(),ctx));assert.ok(r.status===200&&r.data.received===undefined,'owner-cont:owner-new-id-same-command '+r.status+' '+r.raw.slice(0,200));
   job=await wsClaim(o);assert.ok(job?.text===text&&job.actions.length===0&&job.nextSlot===1,'owner-cont:owner-new-id-claimed '+JSON.stringify({text:job?.text,actions:job?.actions?.length,nextSlot:job?.nextSlot}));await mustFinish(job,'新しい依頼として回答しました。',o.worker);
  });

  // 11 owner workspace: one canonical request id (an id sent as a JSON number already passes the 16-64 character rule).
  await isolated('owner-numeric','owner canonical request id: a JSON-number id is stored, queued and claimed as its string; its number and string forms are one request live and archived; a legacy number kept as sent in an adopted archive is recognised in both forms; another meaning stays 409',async()=>{
   const o=await retryOwner('owner-numeric'),ctx={page:'mapping',importId:o.importId},num=8100000000000000+(Date.now()%99991),text='数値IDでの依頼';
   await must(ws,o.token,'POST',await wsBody(o,text,num,ctx),'numeric send');
   const claimed=await o.worker('workspace-claim');assert.ok(claimed.status===200&&claimed.data?.job?.text===text,'owner-cont:owner-canonical-id-claimable '+claimed.status+' '+claimed.raw.slice(0,200));
   let live=await C.assistants.findOne({ownerId:o.id});const stored=live.turns.find(t=>String(t.id)===String(num));
   assert.ok(typeof stored?.id==='string'&&live.currentId===String(num),'owner-cont:owner-canonical-id-stored '+JSON.stringify({type:typeof stored?.id,currentId:live.currentId}));
   let r=await api(ws,o.token,'POST',await wsBody(o,text,String(num),ctx));assert.equal(r.status,200,'owner-cont:owner-canonical-string-same-request '+r.status);
   assert.equal((await C.assistants.findOne({ownerId:o.id})).turns.filter(t=>String(t.id)===String(num)).length,1,'owner-cont:owner-canonical-one-turn');
   await mustFinish(claimed.data.job,'数値IDの依頼に回答しました。',o.worker);if((await wsNew(o)).status!==200)throw Error('SETUP owner-numeric new chat');
   r=await api(ws,o.token,'POST',await wsBody(o,text,num,ctx));assert.ok(r.data?.received?.outcome==='accepted'&&r.data.received.turn.id===String(num),'owner-cont:owner-canonical-archived-recognised '+r.raw.slice(0,200));
   r=await api(ws,o.token,'POST',await wsBody(o,text+'（別）',String(num),ctx));assert.equal(r.status,409,'owner-cont:owner-canonical-meaning-conflict '+r.status);assert.equal(await wsClaim(o),null,'owner-cont:owner-canonical-not-requeued');
   // a turn stored before this canonical id kept its numeric id as sent (synthetic legacy row in the adopted archive)
   const legacy=8200000000000000+(Date.now()%99989),ltext='旧形式の数値IDの依頼',adopted=await C.archives.findOne({ownerId:o.id,conversationKind:'workspace'});
   await C.archives.updateOne({_id:adopted._id},{$push:{turns:{id:legacy,text:ltext,at:new Date(),actions:[]}},$inc:{turnCount:1}});
   r=await api(ws,o.token,'POST',await wsBody(o,ltext,String(legacy),ctx));assert.equal(r.data?.received?.outcome,'accepted','owner-cont:owner-legacy-numeric-recognised '+r.status+' '+r.raw.slice(0,200));
   r=await api(ws,o.token,'POST',await wsBody(o,ltext,legacy,ctx));assert.equal(r.data?.received?.outcome,'accepted','owner-cont:owner-legacy-numeric-number-form');assert.equal(await wsClaim(o),null,'owner-cont:owner-legacy-numeric-not-requeued');
  });

  // 12 owner workspace: evidence stays in its own scope and masking.
  await isolated('owner-apart','owner request evidence stays in its own scope: the answer is masked for the company checked now; a legacy turn without a request hash is matched by its exact text (archived and live); an unadopted reset copy and another owner\'s archive are never evidence',async()=>{
   const o=await retryOwner('owner-apart'),ctx={page:'mapping',importId:o.importId},MA=new ObjectId(),MB=new ObjectId(),at=new Date();
   await C.orgs.insertMany([{_id:MA,name:'Synthetic retry company MA',slug:'owner-retry-ma',isActive:true,members:[{userId:o.id,role:'owner',joinedAt:at}]},{_id:MB,name:'Synthetic retry company MB',slug:'owner-retry-mb',isActive:true,members:[{userId:o.id,role:'member',joinedAt:at}]}]);
   const tMA=(await must('/api/auth/switch-organization',o.token,'POST',{organizationId:String(MA)},'switch MA')).tokens.accessToken,tMB=(await must('/api/auth/switch-organization',o.token,'POST',{organizationId:String(MB)},'switch MB')).tokens.accessToken;
   await C.knowledge.insertOne({organizationId:MA,createdBy:o.id,status:'active',revision:1,instruction:'Retry shopの備品は消耗品費 MA_TEACH_SECRET',conditions:{merchant:'Retry shop'},suggested:{},source:{actorId:o.id,conversationId:new ObjectId(),segment:0,turnId:'seed',quote:'seed',at},history:[],operations:[],createdAt:at,updatedAt:at});
   // a turn that used company MA's teachings, archived by New chat, then the same request sent under MB, under MA and with no company
   const mid=crypto.randomUUID(),mtext='Retry shopの備品はどう処理する？';await must(ws,tMA,'POST',await wsBody(o,mtext,mid,ctx,tMA),'teaching send');
   let job=await wsClaim(o);if(!job?.knowledge?.length)throw Error('SETUP owner-apart teaching recalled (turn tagged)');await mustFinish(job,'MA_DERIVED_REPLY 消耗品費として扱います。',o.worker);
   if((await wsNew(o,{},tMA)).status!==200)throw Error('SETUP owner-apart new chat');
   let r=await api(ws,tMB,'POST',await wsBody(o,mtext,mid,ctx,tMB));assert.equal(r.data?.received?.outcome,'accepted','owner-cont:owner-masked-received '+r.status+' '+r.raw.slice(0,200));
   assert.ok(r.data.received.turn.withheld==='company_context'&&r.data.received.turn.text===undefined&&!r.raw.includes('MA_DERIVED_REPLY')&&!r.raw.includes(mtext)&&!r.raw.includes('MA_TEACH_SECRET')&&r.data.received.scope.organizationId===String(MB),'owner-cont:owner-received-masked '+JSON.stringify(r.data.received).slice(0,400));
   r=await api(ws,tMA,'POST',await wsBody(o,mtext,mid,ctx,tMA));assert.ok(r.data?.received?.turn?.text===mtext&&r.data.received.scope.organizationId===String(MA),'owner-cont:owner-received-same-company-visible '+r.raw.slice(0,200));
   r=await api(ws,o.token,'POST',await wsBody(o,mtext,mid,ctx));assert.ok(r.data?.received?.turn?.withheld==='company_context'&&!r.raw.includes('MA_DERIVED_REPLY'),'owner-cont:owner-received-masked-no-company');assert.equal(await wsClaim(o),null,'owner-cont:owner-masked-not-requeued');
   // legacy turns stored before the request hash: matched by their exact text (the live check's existing rule), archived and live
   const lid=crypto.randomUUID(),ltext='以前の形式で保存された依頼',adopted=await C.archives.findOne({ownerId:o.id,conversationKind:'workspace'},{sort:{segment:1}});
   await C.archives.updateOne({_id:adopted._id},{$push:{turns:{id:lid,text:ltext,at,pageName:'明細マッピング',actions:[]}},$inc:{turnCount:1}});
   r=await api(ws,o.token,'POST',await wsBody(o,ltext,lid,{page:'dashboard'}));assert.equal(r.data?.received?.outcome,'accepted','owner-cont:owner-legacy-archived-recognised '+r.status+' '+r.raw.slice(0,200));assert.equal(await wsClaim(o),null,'owner-cont:owner-legacy-not-requeued');
   r=await api(ws,o.token,'POST',await wsBody(o,ltext+'（変更）',lid,{page:'dashboard'}));assert.equal(r.status,409,'owner-cont:owner-legacy-meaning-conflict '+r.status);
   const llid=crypto.randomUUID(),lltext='以前の形式の会話中の依頼';await C.assistants.updateOne({ownerId:o.id},{$push:{turns:{id:llid,text:lltext,at,pageName:'明細マッピング'}}});
   r=await api(ws,o.token,'POST',await wsBody(o,lltext,llid,{page:'dashboard'}));const liveNow=await C.assistants.findOne({ownerId:o.id});
   assert.ok(r.status===200&&liveNow.state!=='queued'&&liveNow.turns.filter(t=>t.id===llid).length===1,'owner-cont:owner-legacy-live-text-rule '+r.status);
   // an unadopted reset copy (its segment not yet adopted by the live conversation) is never evidence: a fresh request here
   const ghost=crypto.randomUUID();await C.archives.insertOne({ownerId:o.id,conversationKind:'workspace',conversationId:liveNow._id,segment:liveNow.segment||0,resetId:'unadopted-reset-copy-0001',fromRevision:liveNow.revision,turns:[{id:ghost,text:'未採用コピーの依頼',at,actions:[]}],turnCount:1,createdAt:at,updatedAt:at});
   r=await api(ws,o.token,'POST',await wsBody(o,'未採用コピーの依頼',ghost,ctx));assert.ok(r.status===200&&r.data.received===undefined,'owner-cont:owner-unadopted-not-evidence '+r.status+' '+r.raw.slice(0,200));
   job=await wsClaim(o);assert.equal(job?.text,'未採用コピーの依頼','owner-cont:owner-unadopted-fresh-request');await mustFinish(job,'回答しました。',o.worker);
   await C.archives.deleteOne({conversationId:liveNow._id,resetId:'unadopted-reset-copy-0001'});
   // another owner's adopted archive holding the same id is never evidence here
   const other=await retryOwner('owner-apart-other'),fid=crypto.randomUUID(),ftext='他の所有者の依頼';await must(ws,other.token,'POST',await wsBody(other,ftext,fid,{page:'mapping',importId:other.importId}),'other send');
   job=await wsClaim(other);await mustFinish(job,'OTHER_OWNER_REPLY',other.worker);if((await wsNew(other)).status!==200)throw Error('SETUP owner-apart other new chat');
   r=await api(ws,o.token,'POST',await wsBody(o,ftext,fid,ctx));assert.ok(r.status===200&&r.data.received===undefined&&!r.raw.includes('OTHER_OWNER_REPLY'),'owner-cont:owner-foreign-archive-not-evidence '+r.status+' '+r.raw.slice(0,200));
   job=await wsClaim(o);assert.equal(job?.text,ftext,'owner-cont:owner-foreign-fresh-request');await mustFinish(job,'回答しました。',o.worker);
  });

  // 13 owner workspace: New chat naming the client's uncertain earlier send (the reproduced original: an empty or absent conversation
  // was a no-op, so the request stayed uncertain).
  await isolated('owner-pending','owner New chat with an uncertain request: absent and empty conversations are fenced without archive noise and an older attempt is refused; a plain empty reset stays a no-op; a lost reset is recognised with its meaning and fenced again; accepted live and archived requests are answered with their receipts; busy, working, stale and conflicting resets are refused without a fence',async()=>{
   const o=await retryOwner('owner-pending'),ctx={page:'mapping',importId:o.importId},pend=(text,requestId=crypto.randomUUID())=>({requestId,text,context:ctx});
   if(await C.assistants.countDocuments({ownerId:o.id}))throw Error('SETUP owner-pending absent');
   const p1=pend('まだ届いていないかもしれない依頼');let r=await api(ws+'/new',o.token,'POST',{chatRevision:0,requestId:crypto.randomUUID(),pending:p1});assert.equal(r.status,200,'owner-cont:owner-absent-reset-status '+r.raw.slice(0,200));
   let row=await C.assistants.findOne({ownerId:o.id});assert.ok(row?.revision===1&&row.lastReset?.pending?.requestId===p1.requestId,'owner-cont:owner-absent-reset-fence '+JSON.stringify(row?{revision:row.revision,lastReset:row.lastReset}:null));
   assert.equal(r.data.reset?.pending?.outcome,'not_accepted','owner-cont:owner-absent-reset-not-accepted');
   assert.deepEqual(r.data.reset.pending.scope,{actorId:String(o.id),realm:'workspace',conversationId:String(row._id),organizationId:null},'owner-cont:owner-reset-answer-scope');
   assert.equal(await archiveCount({ownerId:o.id}),0,'owner-cont:owner-absent-reset-no-archive');
   r=await api(ws,o.token,'POST',{text:p1.text,requestId:p1.requestId,chatRevision:0,context:ctx});assert.equal(r.status,409,'owner-cont:owner-absent-old-attempt-refused '+r.status);
   // a plain New chat on the empty segment stays a no-op
   r=await api(ws+'/new',o.token,'POST',{chatRevision:1,requestId:crypto.randomUUID()});row=await C.assistants.findOne({ownerId:o.id});assert.ok(r.status===200&&row.revision===1&&r.data.reset===undefined,'owner-cont:owner-plain-empty-reset-noop '+r.status);
   // an empty segment with a named request: the fence advances the revision, nothing is archived, not accepted; the older attempt is refused
   const p2=pend('空の会話で確認する依頼'),R2=crypto.randomUUID();r=await api(ws+'/new',o.token,'POST',{chatRevision:1,requestId:R2,pending:p2});row=await C.assistants.findOne({ownerId:o.id});
   assert.ok(r.status===200&&row.revision===2&&r.data.reset?.pending?.outcome==='not_accepted','owner-cont:owner-empty-reset-fence '+JSON.stringify({status:r.status,revision:row.revision,answer:r.data?.reset||null}));
   assert.equal(await archiveCount({ownerId:o.id}),0,'owner-cont:owner-empty-reset-no-archive');
   r=await api(ws,o.token,'POST',{text:p2.text,requestId:p2.requestId,chatRevision:1,context:ctx});assert.equal(r.status,409,'owner-cont:owner-empty-old-attempt-refused '+r.status);
   // a lost reset reply: the same reset id and meaning is recognised and fenced again (an attempt with the first fence's revision is refused)
   r=await api(ws+'/new',o.token,'POST',{chatRevision:1,requestId:R2,pending:p2});row=await C.assistants.findOne({ownerId:o.id});
   assert.ok(r.status===200&&r.data.reset?.pending?.outcome==='not_accepted'&&row.revision===3,'owner-cont:owner-lost-reset-refenced '+JSON.stringify({status:r.status,revision:row.revision}));
   r=await api(ws,o.token,'POST',{text:p2.text,requestId:p2.requestId,chatRevision:2,context:ctx});assert.equal(r.status,409,'owner-cont:owner-lost-reset-old-attempt-refused '+r.status);
   r=await api(ws+'/new',o.token,'POST',{chatRevision:3,requestId:R2,pending:{...p2,text:'別の内容'}});assert.equal(r.status,409,'owner-cont:owner-lost-reset-conflicting-meaning '+r.status);
   r=await api(ws+'/new',o.token,'POST',{chatRevision:3,requestId:R2});assert.equal(r.status,409,'owner-cont:owner-lost-reset-missing-meaning '+r.status);
   // an accepted live request named by New chat is archived by this reset and answered from that archive with its exact receipt
   const p3=pend('受け付けられた依頼');await must(ws,o.token,'POST',{text:p3.text,requestId:p3.requestId,chatRevision:3,context:ctx},'accepted send');
   let job=await wsClaim(o);const saved=await mustAct(job,1,'save_draft_fields',{importId:o.importId,line:3,fields:{taxRate:8}},o.worker);await mustFinish(job,'受け付けて保存しました。',o.worker);
   r=await wsNew(o,{pending:p3});const answer=r.data?.reset?.pending,hist=await must(ws+'/history',o.token,'GET',undefined,'history');
   assert.ok(r.status===200&&answer?.outcome==='accepted'&&answer.where==='archive'&&answer.archive?.id===hist.archives[0]?.id,'owner-cont:owner-reset-recognises-accepted '+JSON.stringify({status:r.status,answer:answer||null}).slice(0,400));
   assert.equal(answer.turn.actions.find(a=>a.operationId===saved.receipt.operationId)?.state,'done','owner-cont:owner-reset-accepted-receipt');
   // named again on the empty segment: still accepted (from its archive), nothing archived again
   const archivesNow=await archiveCount({ownerId:o.id});r=await wsNew(o,{pending:p3});assert.ok(r.data?.reset?.pending?.outcome==='accepted'&&await archiveCount({ownerId:o.id})===archivesNow,'owner-cont:owner-reset-archived-accepted '+r.status);
   r=await wsNew(o,{pending:{...p3,text:'別の内容'}});assert.equal(r.status,409,'owner-cont:owner-reset-conflicting-pending '+r.status);
   // busy (queued) and a still-working receipt refuse and fence nothing
   const p4=pend('回答待ちの依頼');await must(ws,o.token,'POST',await wsBody(o,p4.text,p4.requestId,ctx),'busy send');
   let before=(await C.assistants.findOne({ownerId:o.id})).revision;r=await wsNew(o,{pending:pend('別の不確かな依頼')});assert.ok(r.status===409&&(await C.assistants.findOne({ownerId:o.id})).revision===before,'owner-cont:owner-busy-reset-refused '+r.status);
   job=await wsClaim(o);const conv=await C.assistants.findOne({ownerId:o.id});if(!job)throw Error('SETUP owner-pending busy claim');
   await C.ops.insertOne({ownerId:o.id,conversationKind:'workspace',conversationId:conv._id,turnId:p4.requestId,slot:9,operationId:crypto.randomBytes(16).toString('hex'),name:'save_draft_fields',payloadHash:'x',state:'claimed',lease:job.lease,leaseUntil:new Date(Date.now()+600000),claimedAt:new Date(),attempts:1,target:{importId:o.importId,line:3},args:{fields:{taxRate:8}}});
   await mustFinish(job,'回答しました。',o.worker);before=(await C.assistants.findOne({ownerId:o.id})).revision;
   r=await wsNew(o,{pending:pend('保存確認中の不確かな依頼')});assert.ok(r.status===409&&(await C.assistants.findOne({ownerId:o.id})).revision===before,'owner-cont:owner-working-receipt-reset-refused '+r.status);
   await C.ops.updateOne({ownerId:o.id,turnId:p4.requestId,slot:9},{$set:{state:'failed',safeError:'synthetic',completedAt:new Date()}});
   // a stale revision refuses and fences nothing
   r=await api(ws+'/new',o.token,'POST',{chatRevision:before-1,requestId:crypto.randomUUID(),pending:pend('古い表示からの依頼')});assert.ok(r.status===409&&(await C.assistants.findOne({ownerId:o.id})).revision===before,'owner-cont:owner-stale-reset-refused '+r.status);
   // a send and a New chat naming that same request, concurrently on one revision: exactly one wins (the conversation revision CAS)
   for(let round=0;round<3;round++){
    const p=pend('同時に届いた依頼 '+round),rev=(await must(ws,o.token,'GET',undefined,'workspace view')).conversation.revision;
    const [s,n]=await Promise.all([api(ws,o.token,'POST',{text:p.text,requestId:p.requestId,chatRevision:rev,context:ctx}),api(ws+'/new',o.token,'POST',{chatRevision:rev,requestId:crypto.randomUUID(),pending:p})]);
    const live=await C.assistants.findOne({ownerId:o.id}),stored=live.turns.some(t=>t.id===p.requestId)||await C.archives.countDocuments({ownerId:o.id,'turns.id':p.requestId})>0,outcome=n.data?.reset?.pending?.outcome;
    assert.ok((s.status===200&&stored&&(n.status===409||outcome==='accepted'))||(s.status===409&&!stored&&n.status===200&&outcome==='not_accepted'),'owner-cont:owner-concurrent-one-winner '+JSON.stringify({round,send:s.status,reset:n.status,outcome:outcome||null,stored}));
    job=await wsClaim(o);if(job)await mustFinish(job,'回答しました。',o.worker);
   }
  });

  // 14 purchase chat: the reproduced lead (an archived explanation's same HTTP identity was queued again) and the original draft binding.
  await isolated('purchase-identity','purchase request identity: an accepted explanation and an accepted save are recognised in the adopted archive with their original draft binding and references, the own draft change never turning the retry into a refusal or a new instruction; another binding or text keeps the conflict; a new id is a new request; another line\'s archive is never evidence; a numeric id is claimable',async()=>{
   const o=await retryOwner('purchase-identity'),rid=crypto.randomUUID(),text='この購入は何のための支払いですか？',first=await pBody(o,2,text,rid);
   await must(pPath(o,2),o.token,'POST',first,'first send');let job=await pClaim(o);if(job?.text!==text)throw Error('SETUP purchase-identity claim');
   if((await act(job,1,'get_draft',{},o.worker)).status!==200)throw Error('SETUP purchase-identity read');await mustFinish(job,'この購入は備品の購入です。',o.worker);
   if((await pNew(o,2)).status!==200)throw Error('SETUP purchase-identity new chat');
   // the same accepted HTTP id, text, original draft binding and references with the fresh chatRevision
   let r=await api(pPath(o,2),o.token,'POST',{...first,chatRevision:await pRevision(o,2)});let chat=await chatRow(o,2);const again=await pClaim(o);if(again)await finish(again,reply('reclaimed'),o.worker);
   assert.ok(r.status===200&&!again&&chat.state!=='queued'&&!chat.turns.some(t=>String(t.id)===rid),'owner-cont:purchase-archived-request-never-requeued '+JSON.stringify({status:r.status,state:chat.state,reclaimed:!!again}));
   const hist=await must(pPath(o,2)+'/history',o.token,'GET',undefined,'history');
   assert.ok(r.data.received?.outcome==='accepted'&&r.data.received.where==='archive'&&r.data.received.archive?.id===hist.archives[0]?.id,'owner-cont:purchase-archived-recognised '+r.raw.slice(0,300));
   assert.deepEqual(r.data.received.scope,{actorId:String(o.id),realm:'purchase',conversationId:String(chat._id),organizationId:null,importId:o.importId,line:2},'owner-cont:purchase-received-scope');
   // an accepted request whose own action saved the draft: its retry with the original binding is recognised although the draft moved on
   const stext='税率を8%にしてください',sbody=await pBody(o,2,stext,crypto.randomUUID());await must(pPath(o,2),o.token,'POST',sbody,'save send');
   job=await pClaim(o);const saved=await mustAct(job,1,'save_draft_fields',{fields:{taxRate:8}},o.worker);await mustFinish(job,'税率を8%にしました。',o.worker);
   if((await must(dPath(o,2),o.token,'GET',undefined,'draft')).revision===sbody.revision)throw Error('SETUP the own save did not move the draft');
   if((await pNew(o,2)).status!==200)throw Error('SETUP purchase-identity second new chat');
   r=await api(pPath(o,2),o.token,'POST',{...sbody,chatRevision:await pRevision(o,2)});assert.ok(r.status===200&&r.data.received?.outcome==='accepted','owner-cont:purchase-own-draft-change-recognised '+r.status+' '+r.raw.slice(0,200));
   assert.equal(r.data.received.turn.actions.find(a=>a.operationId===saved.receipt.operationId)?.state,'done','owner-cont:purchase-received-exact-receipt');assert.equal(await pClaim(o),null,'owner-cont:purchase-own-save-not-requeued');
   // the same id with another draft binding, or another text, keeps the conflict exit
   r=await api(pPath(o,2),o.token,'POST',{...sbody,revision:sbody.revision+1,chatRevision:await pRevision(o,2)});assert.equal(r.status,409,'owner-cont:purchase-binding-conflict '+r.status);
   r=await api(pPath(o,2),o.token,'POST',{...sbody,text:stext+'（別）',chatRevision:await pRevision(o,2)});assert.equal(r.status,409,'owner-cont:purchase-meaning-conflict '+r.status);
   // a new id with the same words and the current binding is a new request with its own journal
   r=await api(pPath(o,2),o.token,'POST',await pBody(o,2,stext,crypto.randomUUID()));assert.ok(r.status===200&&r.data.received===undefined,'owner-cont:purchase-new-id-same-command '+r.status+' '+r.raw.slice(0,200));
   job=await pClaim(o);assert.ok(job?.text===stext&&job.actions.length===0,'owner-cont:purchase-new-id-claimed');await mustFinish(job,'新しい依頼として回答しました。',o.worker);
   // another line's adopted archive is never evidence: the same id on line 3 (which has an adopted archive of its own) is a fresh request
   await must(pPath(o,3),o.token,'POST',await pBody(o,3,'3行目の最初の相談',crypto.randomUUID()),'line 3 send');job=await pClaim(o);await mustFinish(job,'3行目への回答です。',o.worker);if((await pNew(o,3)).status!==200)throw Error('SETUP line 3 new chat');
   r=await api(pPath(o,3),o.token,'POST',await pBody(o,3,text,rid));assert.ok(r.status===200&&r.data.received===undefined,'owner-cont:purchase-other-line-not-evidence '+r.status+' '+r.raw.slice(0,200));
   job=await pClaim(o);assert.equal(job?.text,text,'owner-cont:purchase-other-line-fresh-request');await mustFinish(job,'回答しました。',o.worker);
   // a JSON-number id is claimable, stored as its string, and its string form is the same request
   const num=8300000000000000+(Date.now()%99971),ntext='数値IDの購入相談';await must(pPath(o,4),o.token,'POST',await pBody(o,4,ntext,num),'numeric send');
   const claimed=await o.worker('claim');assert.ok(claimed.status===200&&claimed.data?.job?.text===ntext,'owner-cont:purchase-canonical-id-claimable '+claimed.status+' '+claimed.raw.slice(0,200));
   chat=await chatRow(o,4);assert.ok(typeof chat.turns[0]?.id==='string'&&chat.currentId===String(num),'owner-cont:purchase-canonical-id-stored');await mustFinish(claimed.data.job,'回答しました。',o.worker);
   r=await api(pPath(o,4),o.token,'POST',await pBody(o,4,ntext,String(num)));assert.ok(r.status===200&&(await chatRow(o,4)).turns.length===1,'owner-cont:purchase-canonical-string-same-request '+r.status);
  });

  // 15 purchase chat: New chat naming the uncertain earlier send, including a purchase that has no conversation yet.
  await isolated('purchase-pending','purchase New chat with an uncertain request: an absent purchase conversation is fenced as its row created from the owned draft identity and card account; an empty segment is fenced without archive noise; a lost reset is fenced again; an accepted request is answered from its archive; busy and confirming conversations refuse without a fence; the draft is untouched',async()=>{
   const o=await retryOwner('purchase-pending'),pend=async(line,text,requestId=crypto.randomUUID())=>{const d=await must(dPath(o,line),o.token,'GET',undefined,'draft');return {requestId,text,revision:d.revision,key:d.key,sourceHash:d.sourceHash,references:[]}};
   if(await C.chats.countDocuments({ownerId:o.id}))throw Error('SETUP purchase-pending absent');
   const d2=await must(dPath(o,2),o.token,'GET',undefined,'draft'),p1=await pend(2,'届いていないかもしれない購入相談');
   let r=await api(pPath(o,2)+'/new',o.token,'POST',{chatRevision:0,requestId:crypto.randomUUID(),pending:p1});assert.equal(r.status,200,'owner-cont:purchase-absent-reset-status '+r.raw.slice(0,200));
   let row=await chatRow(o,2);assert.ok(row?.revision===1&&String(row.accountId)===String(o.account._id)&&row.lastReset?.pending?.requestId===p1.requestId,'owner-cont:purchase-absent-reset-fence '+JSON.stringify(row?{revision:row.revision,accountId:String(row.accountId)}:null));
   assert.ok(r.data.reset?.pending?.outcome==='not_accepted'&&r.data.reset.pending.scope?.realm==='purchase'&&r.data.reset.pending.scope.line===2&&r.data.reset.pending.scope.importId===o.importId,'owner-cont:purchase-absent-not-accepted '+JSON.stringify(r.data.reset||null).slice(0,300));
   assert.equal(await archiveCount({ownerId:o.id,conversationKind:'purchase'}),0,'owner-cont:purchase-absent-no-archive');assert.equal((await must(dPath(o,2),o.token,'GET',undefined,'draft')).revision,d2.revision,'owner-cont:purchase-reset-keeps-draft');
   const send=(p,chatRevision)=>({revision:p.revision,key:p.key,sourceHash:p.sourceHash,requestId:p.requestId,text:p.text,references:p.references,chatRevision});
   r=await api(pPath(o,2),o.token,'POST',send(p1,0));assert.equal(r.status,409,'owner-cont:purchase-absent-old-attempt-refused '+r.status);
   // the fence row is the ordinary purchase conversation: a new send is accepted there and claimed by the card's worker
   r=await api(pPath(o,2),o.token,'POST',await pBody(o,2,'柵の後の新しい相談',crypto.randomUUID()));assert.equal(r.status,200,'owner-cont:purchase-fence-row-usable '+r.raw.slice(0,200));
   let job=await pClaim(o);assert.equal(job?.text,'柵の後の新しい相談','owner-cont:purchase-fence-row-claimable');await mustFinish(job,'回答しました。',o.worker);
   // a plain New chat archives that turn and a plain empty reset stays a no-op; an empty segment with a named request is fenced
   if((await pNew(o,2)).status!==200)throw Error('SETUP purchase-pending new chat');const archives=await archiveCount({ownerId:o.id,conversationKind:'purchase'});
   let before=(await chatRow(o,2)).revision;r=await pNew(o,2);assert.ok(r.status===200&&(await chatRow(o,2)).revision===before,'owner-cont:purchase-plain-empty-reset-noop '+r.status);
   const p2=await pend(2,'空の会話で確認する購入相談'),R2=crypto.randomUUID();r=await api(pPath(o,2)+'/new',o.token,'POST',{chatRevision:before,requestId:R2,pending:p2});row=await chatRow(o,2);
   assert.ok(r.status===200&&r.data.reset?.pending?.outcome==='not_accepted'&&row.revision===before+1,'owner-cont:purchase-empty-reset-fence '+JSON.stringify({status:r.status,revision:row.revision,before}));
   assert.equal(await archiveCount({ownerId:o.id,conversationKind:'purchase'}),archives,'owner-cont:purchase-empty-reset-no-archive');
   r=await api(pPath(o,2),o.token,'POST',send(p2,before));assert.equal(r.status,409,'owner-cont:purchase-empty-old-attempt-refused '+r.status);
   // a lost reset reply: the same reset id and meaning is fenced again; another meaning (another draft binding) is refused
   r=await api(pPath(o,2)+'/new',o.token,'POST',{chatRevision:before,requestId:R2,pending:p2});row=await chatRow(o,2);assert.ok(r.status===200&&r.data.reset?.pending?.outcome==='not_accepted'&&row.revision===before+2,'owner-cont:purchase-lost-reset-refenced '+JSON.stringify({status:r.status,revision:row.revision}));
   r=await api(pPath(o,2)+'/new',o.token,'POST',{chatRevision:before+2,requestId:R2,pending:{...p2,revision:p2.revision+1}});assert.equal(r.status,409,'owner-cont:purchase-lost-reset-conflicting-meaning '+r.status);
   // an accepted request named by New chat is archived by this reset and answered from that archive with its receipt
   const p3=await pend(2,'受け付けられた購入相談');await must(pPath(o,2),o.token,'POST',send(p3,await pRevision(o,2)),'accepted send');
   job=await pClaim(o);const saved=await mustAct(job,1,'save_draft_fields',{fields:{taxRate:8}},o.worker);await mustFinish(job,'保存しました。',o.worker);
   r=await pNew(o,2,{pending:p3});const answer=r.data?.reset?.pending,hist=await must(pPath(o,2)+'/history',o.token,'GET',undefined,'history');
   assert.ok(r.status===200&&answer?.outcome==='accepted'&&answer.where==='archive'&&answer.archive?.id===hist.archives[0]?.id&&answer.turn.actions.some(a=>a.operationId===saved.receipt.operationId&&a.state==='done'),'owner-cont:purchase-reset-recognises-accepted '+JSON.stringify({status:r.status,answer:answer||null}).slice(0,400));
   // busy (queued) and confirming conversations refuse a New chat naming a request and fence nothing
   const p4=await pend(2,'回答待ちの購入相談');await must(pPath(o,2),o.token,'POST',send(p4,await pRevision(o,2)),'busy send');
   before=(await chatRow(o,2)).revision;r=await pNew(o,2,{pending:await pend(2,'別の不確かな購入相談')});assert.ok(r.status===409&&(await chatRow(o,2)).revision===before,'owner-cont:purchase-busy-reset-refused '+r.status);
   job=await pClaim(o);await mustFinish(job,'回答しました。',o.worker);const conv=await chatRow(o,2);await C.chats.updateOne({_id:conv._id},{$set:{state:'confirming',leaseUntil:new Date(Date.now()+600000)}});
   before=(await chatRow(o,2)).revision;r=await pNew(o,2,{pending:await pend(2,'確認中の不確かな購入相談')});assert.ok(r.status===409&&(await chatRow(o,2)).revision===before,'owner-cont:purchase-confirming-reset-refused '+r.status);
   await C.chats.updateOne({_id:conv._id},{$set:{state:'ready'},$unset:{leaseUntil:''}});
  });

  // 9 installed Chrome (390 and 1280 wide): history, new chat, read-only inspector, discussion selection, checked posting label and
  // native page refresh after a Navi receipt, then the request identity groups (keys chrome-*). Chained only by the fixture's positive
  // leg, its packaged copy and the client defect legs.
  if(process.env.OMF_OWNER_CONT_BROWSER==='1'&&(!only.size||[...only].some(key=>key.startsWith('chrome-')))){
   const browserLeg=path.join(__dirname,'finance-navi-owner-continuation-browser.cjs');assert.ok(fs.existsSync(browserLeg),'SETUP: the installed-Chrome leg is missing');
   await require(browserLeg)({root,origin,api,ok,db,worker,act,acted,finish,reply,finished,wsSend,plain,tokenA,tokenB,A,B,owner,importId,amexA,aplus,pause,pass,membersA,isolated,original:!only.size,ObjectId});
  }
  assert.ok(!logs.includes('C_TEACH_SECRET')&&!logs.includes('otp-private')&&!logs.includes('MA_TEACH_SECRET'));
  if(red.length)throw Error('owner continuation groups failed: '+red.join(', '));
  console.log(groups+' owner continuation groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

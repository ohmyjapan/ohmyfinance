// Owner/purchase Navi continuation through the actual built routes, worker protocol and native services: explicit new chat and
// archived history for the legacy owner workspace and purchase chats, the realm-aware feature guide and longer owner explanations,
// the same-company teaching bridge, and the named owner actions (card sync, automatic sync, workflow review, assigned-card
// allocation). Synthetic users, companies, cards and records in an owned disposable database only; no model, provider, network
// send or production database. Every final-state assertion carries an `owner-cont:` label so the fixture's defect leg can name
// the assertion a reintroduced defect must flip.
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
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri(DB),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-30000)})}
  let healthy=false;for(let i=0;i<150&&!healthy;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,DB);healthy=true}}catch{}if(!healthy)await pause(200)}if(!healthy)throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
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

  // 9 installed Chrome (390 and 1280 wide): history, new chat, read-only inspector, discussion selection, checked posting label and
  // native page refresh after a Navi receipt. Chained only by the fixture's positive leg.
  if(process.env.OMF_OWNER_CONT_BROWSER==='1'){
   const browserLeg=path.join(__dirname,'finance-navi-owner-continuation-browser.cjs');assert.ok(fs.existsSync(browserLeg),'SETUP: the installed-Chrome leg is missing');
   await require(browserLeg)({root,origin,api,ok,db,worker,act,acted,finish,reply,finished,wsSend,plain,tokenA,tokenB,A,B,owner,importId,amexA,aplus,pause,pass,membersA});
  }
  assert.ok(!logs.includes('C_TEACH_SECRET')&&!logs.includes('otp-private'));
  console.log(groups+' owner continuation groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

// Company Navi dialogue, teaching, pattern recall, new chat/history and feature navigation.
// Actual built native HTTP only; owned synthetic MongoDB and temp data dir; no provider/model/business sends.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_COMPANY_NAVI_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-company-knowledge-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});const uri=mongo.getUri('company_knowledge_regression'),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-14000)});
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,'company_knowledge_regression');healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db('company_knowledge_regression');
  const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'knowledge:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic company user'})).tokens.accessToken;
  const ownerToken=await register('knowledge-owner@example.invalid');await register('knowledge-outsider@example.invalid');const owner=(await db.collection('users').findOne({email:'knowledge-owner@example.invalid'}))._id,outsider=(await db.collection('users').findOne({email:'knowledge-outsider@example.invalid'}))._id;
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];await db.collection('organizations').insertMany([A,B].map((_id,i)=>({_id,name:'Synthetic knowledge company '+i,slug:'company-knowledge-'+i,isActive:true,members})));
  const tokenA=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(A)})).tokens.accessToken,tokenB=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(B)})).tokens.accessToken;
  const forged=jwt.sign({userId:String(outsider),email:'knowledge-outsider@example.invalid',organizationId:String(A),role:'owner',type:'access'},secret,{expiresIn:'5m'});
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic knowledge card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={},token=agent.token)=>call('/api/finance-chat/worker/'+route,token,'POST',body);assert.equal((await worker('heartbeat')).status,200);
  // Synthetic company references and history: three consumables and one conflicting entertainment classification for one merchant.
  const ref=async(collection,name,extra={})=>{const _id=new ObjectId();await db.collection(collection).insertOne({_id,name,...extra,createdAt:now,updatedAt:now});return _id};
  const consumables=await ref('accountcategories','SYN_消耗品費',{type:'expense',code:'SYN1'}),entertainment=await ref('accountcategories','SYN_交際費',{type:'expense',code:'SYN2'}),cardSub=await ref('accountcategories','SYN_カード補助',{type:'liability',code:'SYN3'}),tax10=await ref('taxcategories','SYN_課税仕入10%',{rate:10});
  const tx=(organizationId,date,productName,accountCategoryId,extra={})=>({_id:new ObjectId(),organizationId,referenceNumber:'SYN-'+crypto.randomBytes(4).toString('hex'),date:new Date(date+'T12:00:00Z'),amount:1100,currency:'JPY',type:'支出',status:'completed',productName,accountCategoryId,taxCategoryId:tax10,subAccountCategoryId:cardSub,paymentMethod:'credit_card',cardNumber:'1234',hasReceipt:false,cardAccounting:{key:'PRIVATE_CARD_KEY',accountName:'SYN_未払金(カード)',subAccountName:'SYN カード 1234',taxCategory:'対象外'},createdAt:now,updatedAt:now,...extra});
  const history=[tx(A,'2026-07-03','SYNTH_MART 文具',consumables,{hasReceipt:true}),tx(A,'2026-08-03','SYNTH_MART コピー用紙',consumables),tx(A,'2026-09-03','SYNTH_MART トナー',consumables),tx(A,'2026-09-20','SYNTH_MART 来客用菓子',entertainment),tx(A,'2026-09-21','OTHER_SHOP 書籍',consumables),tx(B,'2026-09-04','SYNTH_MART PRIVATE_COMPANY_B_ROW',entertainment)];
  await db.collection('transactions').insertMany(history);const selected=String(history[2]._id),foreignTx=String(history[5]._id);
  const paymentA=new ObjectId();await db.collection('payments').insertOne({_id:paymentA,organizationId:A,title:'KNOWLEDGE_A_BILL',amount:500,currency:'JPY',dueDate:new Date('2026-10-31T12:00:00Z'),type:'expense',status:'pending',category:'Synthetic',recurring:false,createdAt:now,updatedAt:now});
  const financial=async()=>JSON.stringify(await Promise.all(['invoices','payments','transactions','financeentries','financedrafts','financedecisionmemories','financelearnings'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const endpoint='/api/finance-chat/company-workspace',chats=db.collection('financecompanyassistants');
  const ask=async(token,text,context={page:'transactions',transactionId:selected},requestId=crypto.randomBytes(16).toString('hex'))=>{const view=await ok(endpoint,token);const body={requestId,chatRevision:view.conversation?.revision||0,text,context};return{body,result:await ok(endpoint,token,'POST',body)}};
  const claim=async()=>{assert.equal((await worker('heartbeat')).status,200);const r=await worker('workspace-claim');assert.equal(r.status,200,'knowledge:claim '+r.raw.slice(0,300));return r.data.job};
  const act=(j,name,args={},slot=1)=>worker('workspace/'+j.id+'/actions',{lease:j.lease,name,args,slot});
  const finish=(j,proposal={kind:'unclear',summary:'Synthetic reply',patch:{},quotes:{}})=>worker('workspace/'+j.id+'/result',{lease:j.lease,proposal});
  const financialBefore=await financial();

  // 1. Catalogue: existing eleven tools remain; teaching, pattern and feature tools are added with strict schemas.
  const teachText='SYNTH_MART の支払いは消耗品費として扱ってください。これを覚えておいて。',instruction='SYNTH_MART の支払いは消耗品費として扱ってください。';
  const teach=await ask(tokenA,teachText);let job=await claim();assert.ok(job,'knowledge:claimed');
  const names=job.tools.map(t=>t.name);for(const n of['list_company_invoices','get_company_invoice','list_company_calendar_entries','get_company_calendar_entry','get_company_action_status','update_company_calendar_entry','update_company_invoice','list_company_transactions','get_company_transaction','list_company_transaction_choices','update_company_transaction'])assert.ok(names.includes(n),'knowledge:existing-tool '+n);
  for(const n of['search_company_knowledge','remember_company_knowledge','correct_company_knowledge','set_company_knowledge_status','find_company_transaction_patterns','list_navi_features'])assert.ok(names.includes(n),'knowledge:new-tool '+n);
  // Deliberate 2026-10-20: business adapters extend the closed catalogue (17 -> 41 exact names; 43 with the two invoice-calendar tools of 2026-10-20); every teaching assertion below is kept.
  assert.equal(job.tools.length,45,'knowledge:catalogue-count');assert.deepEqual(names.slice().sort(),[...require('./finance-company-business-integration.cjs').companyToolNames].sort(),'knowledge:catalogue-count');assert.ok(job.tools.every(t=>t.inputSchema.additionalProperties===false));
  assert.deepEqual(job.knowledge,[],'knowledge:empty-recall');
  pass('company job keeps eleven native tools and adds six strict teaching/pattern/feature tools');

  // 2. Pattern evidence: counts, conflicting examples, exact protected card credit names, receipt flag meaning, company isolation.
  let r=await act(job,'find_company_transaction_patterns',{merchant:'SYNTH_MART'});assert.equal(r.status,200,'knowledge:patterns '+r.raw.slice(0,300));const p=r.data.result;
  assert.equal(p.matched,4,'knowledge:pattern-company-count');assert.equal(p.groups.length,2,'knowledge:pattern-groups');assert.equal(p.groups[0].count,3);assert.equal(p.groups[0].classification.accountCategory.name,'SYN_消耗品費');assert.equal(p.groups[1].count,1);assert.equal(p.groups[1].classification.accountCategory.name,'SYN_交際費');assert.equal(p.conflicting,true,'knowledge:pattern-conflict');
  assert.ok(p.groups[1].examples.some(e=>e.productName==='SYNTH_MART 来客用菓子'&&e.date.startsWith('2026-09-20')),'knowledge:pattern-dated-example');
  assert.deepEqual(p.cardCreditAccounts,[{accountName:'SYN_未払金(カード)',subAccountName:'SYN カード 1234',count:4}],'knowledge:pattern-card-credit');
  assert.equal(p.receipts.savedFlagTrue,1);assert.equal(p.receipts.notRecordedInOMF,3,'knowledge:pattern-receipt-meaning');assert.match(p.receipts.meaning,/not proof/);
  assert.ok(!r.raw.includes('PRIVATE_COMPANY_B'),'knowledge:pattern-company-only');assert.ok(!r.raw.includes('PRIVATE_CARD_KEY'),'knowledge:pattern-private');assert.equal(p.truncated,false);assert.ok(p.limit>0);
  r=await act(job,'find_company_transaction_patterns',{merchant:'SYNTH_MART.*'});assert.equal(r.status,200);assert.equal(r.data.result.matched,0,'knowledge:pattern-literal');
  pass('pattern recall returns company-only dated groups, conflicts, exact card credit names and receipt-flag limits');

  // 3. Feature catalogue and navigation replies.
  r=await act(job,'list_navi_features',{});assert.equal(r.status,200);const features=r.data.result.features;
  for(const route of['/','/transactions','/transactions/import','/transactions/duplicates','/mapping','/learning','/connections','/intake','/intake/payments','/invoices','/calendar','/receipts','/vendors','/settings','/budgets','/recurring','/analytics','/reports','/purchase-workflow','/shipments','/audit','/settings/security'])assert.ok(features.some(f=>f.route===route),'knowledge:feature-route '+route);
  assert.ok(features.every(f=>['navi_tool','page_handoff','unsupported'].includes(f.disposition)&&f.reason));assert.equal(features.find(f=>f.route==='/invoices').disposition,'navi_tool');assert.ok(features.every(f=>f.route===null||/^\/[a-z0-9/-]*$/.test(f.route)),'knowledge:feature-local-routes');
  r=await act(job,'list_navi_features',{query:'請求書'});assert.ok(r.data.result.features.some(f=>f.id==='invoices'));

  // 4. Teaching: exact user quote only, observed references, idempotent concurrent saves, no financial effects.
  assert.equal((await act(job,'remember_company_knowledge',{instruction:'モデルが考えた規則'},1)).status,400,'knowledge:quote-required');
  assert.equal((await act(job,'remember_company_knowledge',{instruction,accountCategoryId:String(new ObjectId())},1)).status,400,'knowledge:observed-reference');
  assert.equal((await act(job,'remember_company_knowledge',{instruction,transactionId:foreignTx},1)).status,404,'knowledge:foreign-transaction');
  const rememberArgs={instruction,merchant:'SYNTH_MART',accountCategoryId:String(consumables),transactionId:selected};
  const saves=await Promise.all([act(job,'remember_company_knowledge',rememberArgs,1),act(job,'remember_company_knowledge',rememberArgs,2)]);for(const s of saves)assert.equal(s.status,200,'knowledge:remember '+s.raw.slice(0,300));
  assert.equal(saves[0].data.receipt.operationId,saves[1].data.receipt.operationId,'knowledge:remember-idempotent');const rememberReceipt=(await act(job,'get_company_action_status',{operationId:saves[0].data.receipt.operationId})).data.result.receipts[0];assert.equal(rememberReceipt.state,'done');const knowledgeId=rememberReceipt.nativeResourceIds.knowledgeId;assert.match(knowledgeId,/^[a-f0-9]{24}$/);assert.equal(rememberReceipt.target.knowledgeId,knowledgeId);
  assert.equal((await act(job,'remember_company_knowledge',{...rememberArgs,merchant:'OTHER'},saves[0].data.receipt.slot)).status,409,'knowledge:slot-meaning');
  let stored=await db.collection('financecompanyknowledges').find({}).toArray();assert.equal(stored.length,1,'knowledge:one-row');
  assert.equal(String(stored[0].organizationId),String(A));assert.equal(String(stored[0].createdBy),String(owner));assert.equal(stored[0].status,'active');assert.equal(stored[0].revision,1);assert.equal(stored[0].instruction,instruction);assert.equal(stored[0].source.turnId,teach.body.requestId,'knowledge:provenance-turn');assert.equal(String(stored[0].source.conversationId),job.id);assert.equal(stored[0].source.transactionId,selected);assert.equal(String(stored[0].suggested.accountCategoryId),String(consumables));
  assert.equal(await financial(),financialBefore,'knowledge:no-financial-effect');
  assert.equal((await act(job,'get_company_action_status')).data.result.receipts.filter(a=>a.name==='remember_company_knowledge').length,1);
  // A lost reply on the teaching write is reconciled from the knowledge marker, never repeated.
  const opId=saves[0].data.receipt.operationId;await chats.updateOne({_id:new ObjectId(job.id)},{$set:{'turns.$[turn].actions.$[action].state':'claimed'}},{arrayFilters:[{'turn.id':teach.body.requestId},{'action.operationId':opId}]});
  assert.equal((await act(job,'get_company_action_status',{operationId:opId})).data.result.receipts[0].state,'done','knowledge:recover-marker');
  pass('explicit teaching saves only the exact user quote with provenance, observed references and idempotent receipts, without financial effects');

  // 5. Navigation reply validation and storage.
  assert.equal((await finish(job,{kind:'unclear',summary:'x',patch:{},quotes:{},navigation:{feature:'https://evil.example'}})).status,400,'knowledge:external-navigation');
  assert.equal((await finish(job,{kind:'unclear',summary:'x',patch:{},quotes:{},navigation:{feature:'transactions',transactionId:foreignTx}})).status,400,'knowledge:foreign-record-navigation');
  assert.equal((await finish(job,{kind:'unclear',summary:'x',patch:{},quotes:{},navigation:{feature:'transactions',url:'/admin'}})).status,400);
  const longSummary='説明'.repeat(1500);assert.equal((await finish(job,{kind:'unclear',summary:longSummary,patch:{},quotes:{},navigation:{feature:'transactions',transactionId:selected}})).status,200,'knowledge:long-company-reply');
  let view=await ok(endpoint,tokenA);const answered=view.conversation.turns.find(t=>t.id===teach.body.requestId);assert.equal(answered.proposal.summary.length,3000);assert.deepEqual(answered.proposal.navigation,{feature:'transactions',transactionId:selected},'knowledge:navigation-stored');
  pass('company replies allow long explanations and only catalogue/company-record navigation');

  // 6. Inspection endpoints: company-only, live membership.
  let listed=await ok(endpoint+'/knowledge',tokenA);assert.equal(listed.items.length,1);assert.equal(listed.items[0].instruction,instruction);assert.equal(listed.items[0].suggested.accountCategory.name,'SYN_消耗品費');assert.equal(listed.items[0].source.turnId,teach.body.requestId);
  assert.equal((await ok(endpoint+'/knowledge',tokenB)).items.length,0,'knowledge:company-separation');assert.equal((await call(endpoint+'/knowledge',forged)).status,403,'knowledge:live-membership');assert.equal((await call(endpoint+'/knowledge',ownerToken)).status,403);

  // 7. New chat: busy refusal, revision/idempotency, archive retained, lost response recovery.
  const busy=await ask(tokenA,'まだ回答待ちです');view=await ok(endpoint,tokenA);assert.equal((await call(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomBytes(16).toString('hex')})).status,409,'knowledge:reset-busy');
  job=await claim();assert.equal(job.context.scope.organizationId,String(A));assert.equal((await finish(job)).status,200);
  view=await ok(endpoint,tokenA);const resetId=crypto.randomBytes(16).toString('hex');
  assert.equal((await call(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision-1,requestId:resetId})).status,409,'knowledge:reset-stale');
  // An action still claimed by a recent lease cannot be archived away.
  await chats.updateOne({_id:new ObjectId(job.id)},{$push:{'turns.$[turn].actions':{operationId:'0'.repeat(32),name:'update_company_calendar_entry',turnId:teach.body.requestId,slot:99,payloadHash:'synthetic',paymentId:paymentA,requestedFields:['notes'],state:'claimed',lease:'synthetic-old-lease',leaseUntil:new Date(),claimedAt:new Date()}}},{arrayFilters:[{'turn.id':teach.body.requestId}]});
  view=await ok(endpoint,tokenA);assert.equal((await call(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:resetId})).status,409,'knowledge:reset-active-effect');
  await chats.updateOne({_id:new ObjectId(job.id)},{$set:{'turns.$[turn].actions.$[action].leaseUntil':new Date(Date.now()-120000)}},{arrayFilters:[{'turn.id':teach.body.requestId},{'action.slot':99}]});
  view=await ok(endpoint,tokenA);const unresolved=view.conversation.turns.find(t=>t.id===teach.body.requestId).actions.find(a=>a.slot===99);assert.equal(unresolved.state,'unresolved','knowledge:unknown-not-repeated');assert.equal((await db.collection('payments').findOne({_id:paymentA})).notes,undefined);
  const reset=await ok(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:resetId});assert.equal(reset.conversation.turns.length,0);assert.equal(reset.conversation.segment,1,'knowledge:new-segment');
  const again=await ok(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:resetId});assert.equal(again.conversation.revision,reset.conversation.revision,'knowledge:reset-idempotent');
  let archives=await ok(endpoint+'/history',tokenA);assert.equal(archives.archives.length,1);assert.equal(archives.archives[0].turnCount,2);
  const archived=await ok(endpoint+'/history/'+archives.archives[0].id,tokenA);assert.equal(archived.archive.turns.length,2);assert.ok(archived.archive.turns[0].actions.some(a=>a.state==='unresolved'),'knowledge:archive-keeps-receipts');assert.ok(archived.archive.turns[0].actions.some(a=>a.name==='remember_company_knowledge'&&a.state==='done'));
  assert.equal((await ok(endpoint+'/history',tokenB)).archives.length,0,'knowledge:history-separation');assert.equal((await call(endpoint+'/history/'+archives.archives[0].id,tokenB)).status,404,'knowledge:history-foreign');assert.equal((await call(endpoint+'/history/'+archives.archives[0].id,forged)).status,403);
  assert.equal(await chats.countDocuments({}),1,'knowledge:unique-conversation-kept');
  pass('new chat refuses busy/stale/active effects, archives turns with receipts, and recovers a lost reset response');

  // 8. Recall across chat segments, correction with expected revision, pause stops influence.
  const later=await ask(tokenA,'SYNTH_MART の今月の決済はどう処理すればいい？');job=await claim();assert.equal(job.knowledge.length,1,'knowledge:cross-segment-recall');assert.equal(job.knowledge[0].id,knowledgeId);assert.equal(job.knowledge[0].instruction,instruction);assert.equal(job.knowledge[0].source.segment,0);assert.equal(job.knowledge[0].source.turnId,teach.body.requestId);assert.ok(!JSON.stringify(job).includes('PRIVATE_COMPANY_B'));
  assert.ok(!job.context.messages.some(m=>m.text===teachText),'knowledge:new-chat-context');
  r=await act(job,'search_company_knowledge',{query:'SYNTH_MART'});assert.equal(r.status,200);assert.equal(r.data.result.items.length,1);
  assert.equal((await act(job,'correct_company_knowledge',{knowledgeId,expectedRevision:1,instruction:'未定義の訂正'},1)).status,400,'knowledge:correct-quote');
  assert.equal((await finish(job)).status,200);
  const correctText='訂正: SYNTH_MART の菓子は交際費にしてください。',correction='SYNTH_MART の菓子は交際費にしてください。';await ask(tokenA,correctText);job=await claim();
  assert.equal((await act(job,'correct_company_knowledge',{knowledgeId,expectedRevision:2,instruction:correction},1)).status,409,'knowledge:stale-revision');
  r=await act(job,'correct_company_knowledge',{knowledgeId,expectedRevision:1,instruction:correction,accountCategoryId:String(entertainment)},2);assert.equal(r.status,200,'knowledge:correct '+r.raw.slice(0,300));assert.equal(r.data.receipt.state,'done');
  stored=await db.collection('financecompanyknowledges').findOne({_id:new ObjectId(knowledgeId)});assert.equal(stored.revision,2);assert.equal(stored.instruction,correction);assert.equal(stored.history.length,1,'knowledge:correction-audit');assert.equal(stored.history[0].instruction,instruction);assert.equal(stored.history[0].revision,1);assert.equal(String(stored.suggested.accountCategoryId),String(entertainment));assert.equal(stored.source.turnId,teach.body.requestId,'knowledge:original-provenance');assert.ok(stored.corrections?.length===1||stored.history[0].replacedBy?.turnId);
  r=await act(job,'set_company_knowledge_status',{knowledgeId,expectedRevision:2,status:'paused'},3);assert.equal(r.status,200);assert.equal(r.data.receipt.state,'done');assert.equal(await financial(),financialBefore,'knowledge:no-financial-effect-after-correction');
  assert.equal((await finish(job)).status,200);
  await ask(tokenA,'SYNTH_MART の菓子はどう処理しますか？');job=await claim();assert.equal(job.knowledge.length,0,'knowledge:paused-not-recalled');
  r=await act(job,'search_company_knowledge',{query:'SYNTH_MART'});assert.equal(r.data.result.items.length,0,'knowledge:paused-search-default');r=await act(job,'search_company_knowledge',{query:'SYNTH_MART',status:'paused'});assert.equal(r.data.result.items.length,1);assert.equal(r.data.result.items[0].status,'paused');
  pass('later chat segments recall confirmed teaching with provenance; correction keeps audit and a paused rule stops influencing answers');

  // 9. Company isolation, revoked membership and old lease on teaching writes.
  assert.equal((await finish(job)).status,200);await ask(tokenB,'SYNTH_MART の扱いは？',{page:'invoices'});job=await claim();assert.equal(job.context.scope.organizationId,String(B));assert.equal(job.knowledge.length,0,'knowledge:no-cross-company-recall');
  assert.equal((await act(job,'set_company_knowledge_status',{knowledgeId,expectedRevision:3,status:'active'},1)).status,404,'knowledge:foreign-write');assert.equal((await act(job,'search_company_knowledge',{status:'all'})).data.result.items.length,0);assert.equal((await finish(job)).status,200);
  await ask(tokenA,'SYNTH_MART を再開して覚えておいて');job=await claim();await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});
  assert.equal((await act(job,'set_company_knowledge_status',{knowledgeId,expectedRevision:3,status:'active'},1)).status,403,'knowledge:revoked-write');assert.equal((await call(endpoint+'/knowledge',tokenA)).status,403);assert.equal((await call(endpoint+'/history',tokenA)).status,403,'knowledge:revoked-history');assert.equal((await call(endpoint+'/new',tokenA,'POST',{chatRevision:0,requestId:crypto.randomBytes(16).toString('hex')})).status,403);
  await db.collection('organizations').updateOne({_id:A},{$set:{members}});const stale=job.lease;await chats.updateOne({_id:new ObjectId(job.id)},{$set:{leaseUntil:new Date(0),attempts:1}});const reclaimed=await claim();assert.ok(reclaimed);
  assert.equal((await act(job,'set_company_knowledge_status',{knowledgeId,expectedRevision:3,status:'active'},1)).status,409,'knowledge:old-lease');assert.equal((await db.collection('financecompanyknowledges').findOne({_id:new ObjectId(knowledgeId)})).status,'paused');assert.notEqual(reclaimed.lease,stale);assert.equal((await finish(reclaimed)).status,200);
  pass('teaching reads/writes stay in the frozen company and refuse revoked members and old leases');

  // 10. Turn limit gives the new-chat lane; existing native calendar save still works after a reset.
  view=await ok(endpoint,tokenA);const filler=Array.from({length:200-view.conversation.turns.length},(_,i)=>({id:'filler'+i,text:'filler',at:now,scope:{actorId:String(owner),organizationId:String(A)},target:{page:'calendar'},requestHash:'x'}));await chats.updateOne({_id:new ObjectId(view.conversation.id)},{$push:{turns:{$each:filler}},$inc:{revision:1}});
  view=await ok(endpoint,tokenA);r=await call(endpoint,tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.conversation.revision,text:'limit',context:{page:'calendar'}});assert.equal(r.status,409);assert.match(r.raw,/新しい会話/,'knowledge:turn-limit-next-lane');
  const reset2=await ok(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomBytes(16).toString('hex')});assert.equal(reset2.conversation.segment,2);assert.equal((await ok(endpoint+'/history',tokenA)).archives.length,2);
  await ask(tokenA,'支払い予定のメモを保存して',{page:'calendar',paymentId:String(paymentA)});job=await claim();const entry=(await act(job,'get_company_calendar_entry',{paymentId:String(paymentA)})).data.result.entry;r=await act(job,'update_company_calendar_entry',{paymentId:String(paymentA),expectedUpdatedAt:entry.updatedAt||'',notes:'KNOWLEDGE_NATIVE_NOTE'},1);assert.equal(r.status,200,'knowledge:existing-native-write '+r.raw.slice(0,300));assert.equal(r.data.receipt.state,'done');assert.equal((await db.collection('payments').findOne({_id:paymentA})).notes,'KNOWLEDGE_NATIVE_NOTE');assert.equal((await finish(job)).status,200);
  pass('turn limit points to new chat; existing native calendar save still writes after resets');
  assert.ok(!logs.includes(teachText),'knowledge:no-logged-text');
  console.log(checks+' Company knowledge groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

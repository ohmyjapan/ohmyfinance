// Company Navi public research and inspected-record context on the actual built application.
// Owned synthetic MongoDB and temp data/Vault directories only. External reads are never made: captures are posted as the worker
// would post them, the real actions MCP child is exercised with private/offline targets only, and no model, provider, account,
// mailbox, NTA application id or business send is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),readline=require('node:readline');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_COMPANY_NAVI_APP_ROOT||path.join(__dirname,'..')),source=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const sha=t=>crypto.createHash('sha256').update(t).digest('hex'),hex32=()=>crypto.randomBytes(16).toString('hex');
const todayJst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const registryUrl=(number,day)=>'https://web-api.invoice-kohyo.nta.go.jp/1/valid?number='+number+'&day='+day+'&type=21';
const registryJson=(number,name='株式会社サンプル')=>JSON.stringify({lastUpdateDate:'2026-08-01',count:'1',divideNumber:'1',divideSize:'1',announcement:[{sequenceNumber:'1',registratedNumber:number,process:'01',correct:'0',kind:'2',country:'1',latest:'1',registrationDate:'2023-10-01',updateDate:'2023-10-01',disposalDate:'',expireDate:'',address:'東京都千代田区',name}]});
async function main(){let mongo,child,client,directory,vaultDirectory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-company-public-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});const uri=mongo.getUri('company_public_research_regression'),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-14000)});
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,'company_public_research_regression');healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db('company_public_research_regression');
  const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
  const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'public-research:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic company user'})).tokens.accessToken;
  const ownerToken=await register('public-owner@example.invalid');await register('public-outsider@example.invalid');const owner=(await db.collection('users').findOne({email:'public-owner@example.invalid'}))._id,outsider=(await db.collection('users').findOne({email:'public-outsider@example.invalid'}))._id;
  const A=new ObjectId(),B=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];await db.collection('organizations').insertMany([A,B].map((_id,i)=>({_id,name:'Synthetic public company '+i,slug:'company-public-'+i,isActive:true,members})));
  const tokenA=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(A)})).tokens.accessToken,tokenB=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(B)})).tokens.accessToken;
  const forged=jwt.sign({userId:String(outsider),email:'public-outsider@example.invalid',organizationId:String(A),role:'owner',type:'access'},secret,{expiresIn:'5m'});
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic public card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={},token=agent.token)=>call('/api/finance-chat/worker/'+route,token,'POST',body);
  assert.equal((await worker('heartbeat')).status,200);const capability={version:1,webSearch:true,publicPage:true,chrome:false,registry:'connection_required'};
  const txA=new ObjectId(),txB=new ObjectId();await db.collection('transactions').insertMany([{_id:txA,organizationId:A,referenceNumber:'PUB-A',productName:'SYNTH_SUPPLIER 文具',date:new Date('2026-07-31T20:00:00Z'),amount:1100,currency:'JPY',type:'支出',status:'completed',createdAt:now,updatedAt:now},{_id:txB,organizationId:B,referenceNumber:'PUB-B',productName:'PRIVATE_COMPANY_B_TX',date:new Date('2026-06-01T03:00:00Z'),amount:900,currency:'JPY',type:'支出',status:'completed',createdAt:now,updatedAt:now}]);
  const endpoint='/api/finance-chat/company-workspace',chats=db.collection('financecompanyassistants'),sources=db.collection('financecompanypublicsources');
  const financial=async()=>JSON.stringify(await Promise.all(['invoices','payments','transactions','financeentries','financedrafts','financedecisionmemories','suppliers'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const ask=async(token,text,context={page:'transactions',transactionId:String(txA)},requestId=crypto.randomBytes(16).toString('hex'))=>{const view=await ok(endpoint,token);const body={requestId,chatRevision:view.conversation?.revision||0,text,context};return{body,result:await ok(endpoint,token,'POST',body)}};
  const claim=async(capable=true,token=agent.token)=>{const r=await worker('workspace-claim',capable?{capabilities:{publicResearch:capability}}:{},token);assert.equal(r.status,200,'public-research:claim '+r.raw.slice(0,300));return r.data.job};
  const src=(j,body,token=agent.token)=>worker('workspace/'+j.id+'/sources',{lease:j.lease,...body},token);
  const finish=(j,proposal={kind:'unclear',summary:'Synthetic reply',patch:{},quotes:{}})=>worker('workspace/'+j.id+'/result',{lease:j.lease,proposal});
  const page=(text,url='https://www.synthetic-supplier.example/company',extra={})=>({captureId:hex32(),kind:'web',requestedUrl:'https://synthetic-supplier.example/',url,title:'会社概要',text,hash:sha(text),capturedAt:new Date().toISOString(),truncated:false,...extra});
  const before=await financial();

  // 1. Capability: validated, stored without scope expansion; only capable claims get public research; catalogue unchanged.
  assert.equal((await worker('workspace-claim',{capabilities:{publicResearch:{...capability,mailbox:true}}})).status,400,'public-research:capability-validated');
  await ask(tokenA,'まだ調べない質問です');let job=await claim(false);assert.ok(job);assert.equal(job.publicResearch,undefined,'public-research:not-capable-no-tools');const plainTools=job.tools.map(t=>t.name);assert.deepEqual(plainTools.slice().sort(),[...require('./finance-company-business-integration.cjs').companyToolNames].sort(),'public-research:server-catalogue');assert.equal(plainTools.length,43);
  assert.equal((await src(job,{op:'list'})).status,409,'public-research:capability-required');assert.equal((await finish(job)).status,200);
  const stored=await db.collection('financechatagents').findOne({_id:new ObjectId(agent.id)});assert.equal(stored.publicResearch,undefined,'public-research:report-cleared-when-absent');
  const text1='SYNTH_SUPPLIER の登録番号を調べて、取引日 2026-09-30 時点も確認して。';const t1=await ask(tokenA,text1);job=await claim();
  assert.deepEqual(job.publicResearch?.registry,'connection_required');assert.equal(job.publicResearch.chrome,false);assert.equal(job.publicResearch.today,todayJst(),'public-research:today-jst');assert.deepEqual(job.tools.map(t=>t.name),plainTools,'public-research:server-catalogue-unchanged');
  const agentRow=await db.collection('financechatagents').findOne({_id:new ObjectId(agent.id)});assert.deepEqual(Object.keys(agentRow.publicResearch).sort(),['chrome','publicPage','registry','reportedAt','version','webSearch'],'public-research:no-scope-expansion');assert.deepEqual(agentRow.accountIds.map(String),[String(account._id)]);assert.equal(agentRow.workspaceEnabled,true);assert.notEqual(agentRow.researchEnabled,true);
  pass('only a validated actual capability report gives a company job public research; the server catalogue and worker scope are unchanged');

  // 2. Server-derived date authority for official verification.
  let r=await src(job,{op:'prepare',target:{number:'T1234567890123',transactionId:String(txA)}});assert.equal(r.status,200,'public-research:prepare '+r.raw.slice(0,300));assert.equal(r.data.date,'2026-08-01','public-research:jst-transaction-date');assert.equal(r.data.dateAuthority,'transaction_date');assert.equal(r.data.canonicalUrl,registryUrl('T1234567890123','2026-08-01'));
  assert.equal((await src(job,{op:'prepare',target:{number:'T1234567890123',transactionId:String(txB)}})).status,404,'public-research:foreign-transaction-date');
  assert.equal((await src(job,{op:'prepare',target:{number:'T1234567890123',date:'2026-07-15'}})).status,400,'public-research:untrusted-date');
  r=await src(job,{op:'prepare',target:{number:'T1234567890123',date:'2026-09-30'}});assert.equal(r.status,200);assert.equal(r.data.dateAuthority,'user_stated_date','public-research:user-stated-date');
  r=await src(job,{op:'prepare',target:{number:'T1234567890123'}});assert.equal(r.data.date,todayJst());assert.equal(r.data.dateAuthority,'today_jst');
  for(const target of[{number:'1234567890123'},{number:'T123'},{number:'T1234567890123',date:'2026-09-30',transactionId:String(txA)},{number:'T1234567890123',organizationId:String(B)}])assert.equal((await src(job,{op:'prepare',target})).status,400,'public-research:prepare-shape '+JSON.stringify(target));
  assert.equal((await src(job,{op:'list',organizationId:String(B)})).status,400,'public-research:no-model-company');assert.equal((await src(job,{op:'proxy',url:'https://example.com/'})).status,400,'public-research:no-generic-proxy');
  pass('registry dates come from the company transaction, a date stated in the current message or today in JST; models cannot name a company or another operation');

  // 3. Captures: literal hashed text, public URL, idempotent identity, registry evidence checked against the prepared number/date.
  const bodyMarker='BODY_ONLY_MARKER 沿革 1999年創業';const pageText='株式会社サンプル\n適格請求書発行事業者登録番号：T1234567890123\n'+bodyMarker;
  const web=page(pageText);r=await src(job,{op:'capture',capture:web});assert.equal(r.status,200,'public-research:capture '+r.raw.slice(0,300));const webId=r.data.source.id;assert.equal(r.data.source.status,'captured');assert.equal(r.data.source.evidence,'published_page');assert.equal(r.data.source.url,web.url,'public-research:final-url-kept');assert.equal(r.data.source.text,undefined);
  let row=await sources.findOne({_id:new ObjectId(webId)});assert.equal(String(row.organizationId),String(A));assert.equal(String(row.ownerId),String(owner));assert.equal(String(row.conversationId),job.id);assert.equal(row.turnId,t1.body.requestId);assert.equal(row.segment,0);assert.equal(row.hash,sha(pageText));
  r=await src(job,{op:'capture',capture:web});assert.equal(r.data.source.id,webId);assert.equal(r.data.duplicate,true,'public-research:idempotent-capture');
  const twin=page('同時に届いた同じ取得');const pair=await Promise.all([src(job,{op:'capture',capture:twin}),src(job,{op:'capture',capture:twin})]);assert.ok(pair.every(p=>p.status===200));assert.equal(pair[0].data.source.id,pair[1].data.source.id);assert.equal(await sources.countDocuments({captureId:twin.captureId}),1,'public-research:lost-retry-once');
  assert.equal((await src(job,{op:'capture',capture:{...web,text:'別の内容',hash:sha('別の内容')}})).status,409,'public-research:capture-id-meaning');
  assert.equal((await src(job,{op:'capture',capture:{...page('改ざん'),hash:sha('別物')}})).status,400,'public-research:hash-verified');
  for(const url of['http://www.synthetic-supplier.example/','https://10.0.0.8/','https://127.0.0.1/','https://user@synthetic.example/','https://invoice-kohyo.nta.go.jp/regno-search/detail'])assert.equal((await src(job,{op:'capture',capture:page('x',url)})).status,400,'public-research:public-url '+url);
  assert.equal((await src(job,{op:'capture',capture:{...page('x'),organizationId:String(B)}})).status,400,'public-research:no-capture-company');
  const reg=(target,url,text)=>({captureId:hex32(),kind:'registry',requestedUrl:url,url,title:'国税庁 登録番号照合',text,hash:sha(text),capturedAt:new Date().toISOString(),truncated:false,target});
  r=await src(job,{op:'capture',capture:reg({number:'T1234567890123',transactionId:String(txA)},registryUrl('T1234567890123','2026-08-01'),registryJson('T1234567890123'))});assert.equal(r.status,200,'public-research:registry '+r.raw.slice(0,300));const regId=r.data.source.id;
  assert.equal(r.data.source.evidence,'official_registry_observation');assert.deepEqual({number:r.data.source.registry.number,asOf:r.data.source.registry.asOf,dateAuthority:r.data.source.registry.dateAuthority,active:r.data.source.registry.active,legalName:r.data.source.registry.legalName},{number:'T1234567890123',asOf:'2026-08-01',dateAuthority:'transaction_date',active:true,legalName:'株式会社サンプル'},'public-research:registry-observation');
  assert.equal((await src(job,{op:'capture',capture:reg({number:'T1234567890123',transactionId:String(txA)},registryUrl('T1234567890123','2026-08-01')+'&id=SYNTHETICAPPID',registryJson('T1234567890123'))})).status,400,'public-research:no-application-id');
  assert.equal((await src(job,{op:'capture',capture:reg({number:'T1234567890123',transactionId:String(txA)},registryUrl('T1234567890123','2026-08-01'),registryJson('T9999999999999'))})).status,400,'public-research:registry-number');
  assert.equal((await src(job,{op:'capture',capture:reg({number:'T1234567890123',transactionId:String(txA)},registryUrl('T1234567890123','2026-07-01'),registryJson('T1234567890123'))})).status,400,'public-research:registry-date');
  assert.equal((await src(job,{op:'capture',capture:reg({number:'T1234567890123',date:'2026-07-15'},registryUrl('T1234567890123','2026-07-15'),registryJson('T1234567890123'))})).status,400,'public-research:registry-untrusted-date');
  r=await src(job,{op:'capture',capture:{captureId:hex32(),kind:'web',requestedUrl:'https://missing.synthetic.example/',failed:true,safeError:'Public page returned HTTP 404'}});assert.equal(r.status,200);const failedId=r.data.source.id;assert.equal(r.data.source.status,'failed','public-research:failed-activity');
  r=await src(job,{op:'capture',capture:{captureId:hex32(),kind:'registry',requestedUrl:registryUrl('T1234567890123','2026-09-30'),failed:true,reason:'connection_required',target:{number:'T1234567890123',date:'2026-09-30'}}});assert.equal(r.status,200);assert.equal(r.data.source.status,'unavailable','public-research:missing-nta-connection');assert.equal(r.data.source.registry.asOf,'2026-09-30');
  assert.equal(await financial(),before,'public-research:no-financial-write');
  pass('captures keep literal hashed public text and final URL, are idempotent, and registry evidence must match the prepared number, date and canonical URL');

  // 4. Other company, listing/reading and the lease/membership/agent guards.
  const tB=await ask(tokenB,'PRIVATE_COMPANY_B_QUESTION',{page:'invoices'});
  r=await src(job,{op:'list'});assert.equal(r.status,200);const listedIds=r.data.sources.map(s=>s.id);assert.ok(listedIds.includes(webId)&&listedIds.includes(regId)&&listedIds.includes(failedId));assert.ok(r.data.sources.every(s=>s.text===undefined));
  r=await src(job,{op:'read',sourceId:webId,offset:0});assert.equal(r.status,200);assert.ok(r.data.text.includes('T1234567890123'));assert.equal(r.data.nextOffset,null);
  assert.equal((await src(job,{op:'read',sourceId:failedId})).status,409,'public-research:failed-not-readable');
  const secondAgent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true});assert.equal((await src(job,{op:'list'},secondAgent.token)).status,409,'public-research:wrong-agent');
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await src(job,{op:'capture',capture:page('revoked')})).status,403,'public-research:revoked');await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  pass('sources are listed and read only inside the frozen job; other agents and revoked members are refused');

  // 5. Citations are resolved on the server: literal quote of a captured source of this company conversation.
  const reply=citations=>({kind:'unclear',summary:'公表ページでは登録番号 T1234567890123 が記載されています。',patch:{},quotes:{},citations});
  assert.equal((await finish(job,reply([{sourceId:webId,quote:'T1234567890124',claim:'登録番号'}]))).status,400,'public-research:fabricated-quote');
  assert.equal((await finish(job,reply([{sourceId:failedId,quote:'404',claim:'x'}]))).status,400,'public-research:failed-not-citable');
  assert.equal((await finish(job,reply([{sourceId:String(new ObjectId()),quote:'T1234567890123',claim:'x'}]))).status,400,'public-research:unknown-source');
  assert.equal((await finish(job,reply([{sourceId:webId,quote:'T1234567890123',claim:'x',officialVerification:true}]))).status,400,'public-research:no-invented-flag');
  assert.equal((await finish(job,{...reply([{sourceId:webId,quote:'T1234567890123',claim:'x'}]),sourceUrl:'https://evil.example/'})).status,400);
  r=await finish(job,reply([{sourceId:webId,quote:'適格請求書発行事業者登録番号：T1234567890123',claim:'公表ページの登録番号'},{sourceId:regId,quote:'"registratedNumber":"T1234567890123"',claim:'2026-08-01 時点の国税庁照合'}]));assert.equal(r.status,200,'public-research:cited-finish '+r.raw.slice(0,300));
  let view=await ok(endpoint,tokenA);let turn=view.conversation.turns.find(t=>t.id===t1.body.requestId);
  assert.equal(turn.proposal.citations.length,2);assert.deepEqual({kind:turn.proposal.citations[0].kind,url:turn.proposal.citations[0].url,evidence:turn.proposal.citations[0].evidence,observation:turn.proposal.citations[0].observation},{kind:'web',url:web.url,evidence:'published_page',observation:'this_turn'},'public-research:citation-resolved');
  assert.equal(turn.proposal.citations[1].registry.asOf,'2026-08-01');assert.equal(turn.proposal.citations[1].registry.dateAuthority,'transaction_date');
  assert.ok(turn.sources.length>=5);assert.ok(turn.sources.every(s=>s.text===undefined),'public-research:no-body-in-chat');assert.ok(turn.sources.some(s=>s.status==='failed')&&turn.sources.some(s=>s.status==='unavailable'));
  assert.ok(!JSON.stringify(await chats.findOne({_id:new ObjectId(job.id)})).includes('BODY_ONLY_MARKER'),'public-research:chat-no-raw-body');
  // The other company's job captures its own private source; company A can never read or cite it.
  job=await claim();assert.equal(job.context.scope.organizationId,String(B));r=await src(job,{op:'capture',capture:page('PRIVATE_COMPANY_B_SOURCE T5555555555555')});assert.equal(r.status,200);const foreignId=r.data.source.id;assert.equal((await finish(job)).status,200);
  assert.ok(!JSON.stringify(await ok(endpoint,tokenA)).includes('PRIVATE_COMPANY_B'),'public-research:view-company-only');
  pass('a reply cites only literal quotes of captured sources of the same company conversation; source cards stay metadata under the turn');

  // 6. Later turns: retained observation, foreign citation refused, failed turn keeps its evidence, user detail scope.
  const t2=await ask(tokenA,'前回の確認結果を教えて');job=await claim();
  r=await src(job,{op:'read',sourceId:foreignId});assert.equal(r.status,404,'public-research:foreign-source-read');r=await src(job,{op:'list'});assert.equal(r.status,200);assert.ok(r.data.sources.some(s=>s.id===webId)&&!r.data.sources.some(s=>s.id===foreignId),'public-research:list-company-only');
  assert.equal((await finish(job,reply([{sourceId:foreignId,quote:'T5555555555555',claim:'x'}]))).status,400,'public-research:foreign-citation');
  r=await finish(job,reply([{sourceId:regId,quote:'"registratedNumber":"T1234567890123"',claim:'以前の照合'}]));assert.equal(r.status,200);view=await ok(endpoint,tokenA);assert.equal(view.conversation.turns.find(t=>t.id===t2.body.requestId).proposal.citations[0].observation,'retained_earlier','public-research:retained-observation');
  const t3=await ask(tokenA,'もう一度会社概要を読んで');job=await claim();r=await src(job,{op:'capture',capture:page('FAILED_TURN_EVIDENCE 会社概要')});const failedTurnSource=r.data.source.id;assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,failed:true})).status,200);
  view=await ok(endpoint,tokenA);turn=view.conversation.turns.find(t=>t.id===t3.body.requestId);assert.equal(view.conversation.state,'failed');assert.ok(turn.sources.some(s=>s.id===failedTurnSource),'public-research:failed-turn-evidence');
  let detail=await ok(endpoint+'/sources/'+webId,tokenA);assert.ok(detail.source.text.includes(bodyMarker));assert.equal(detail.source.url,web.url);
  assert.equal((await call(endpoint+'/sources/'+webId,tokenB)).status,404,'public-research:detail-company-only');assert.equal((await call(endpoint+'/sources/'+webId,forged)).status,403);assert.equal((await call(endpoint+'/sources/'+webId,ownerToken)).status,403);assert.equal((await call(endpoint+'/sources/'+foreignId,tokenA)).status,404);
  pass('earlier evidence is a retained observation; foreign sources are refused; a failed reply keeps its captured evidence; detail reads are company-scoped');

  // 7. Retry, new chat and archive: source cards and citations stay with archived turns, raw bodies are not copied.
  await ok(endpoint+'/retry',tokenA,'POST',{chatRevision:view.conversation.revision});job=await claim();assert.equal((await finish(job)).status,200);
  view=await ok(endpoint,tokenA);const reset=await ok(endpoint+'/new',tokenA,'POST',{chatRevision:view.conversation.revision,requestId:crypto.randomBytes(16).toString('hex')});assert.equal(reset.conversation.turns.length,0);
  const archives=await ok(endpoint+'/history',tokenA);const archiveId=archives.archives[0].id;const archived=await ok(endpoint+'/history/'+archiveId,tokenA);
  const archivedTurn=archived.archive.turns.find(t=>t.id===t1.body.requestId);assert.equal(archivedTurn.proposal.citations.length,2,'public-research:archive-citations');assert.ok(archivedTurn.sources.some(s=>s.id===webId),'public-research:archive-sources');assert.ok(archived.archive.turns.find(t=>t.id===t3.body.requestId).sources.some(s=>s.id===failedTurnSource),'public-research:archive-failed-turn');
  assert.ok(!JSON.stringify(await db.collection('financecompanyconversationarchives').find({}).toArray()).includes('BODY_ONLY_MARKER'),'public-research:archive-no-raw-body');
  detail=await ok(endpoint+'/sources/'+webId,tokenA);assert.ok(detail.source.text.includes(bodyMarker),'public-research:archived-detail');
  pass('retry and new chat keep source cards and citations with archived turns, without copying source bodies into chats or archives');

  // 8. Inspected record context: an explicitly pinned archive or teaching of this company reaches the frozen job as evidence.
  const kA=new ObjectId(),kB=new ObjectId();await db.collection('financecompanyknowledges').insertMany([{_id:kA,organizationId:A,createdBy:owner,updatedBy:owner,status:'paused',revision:2,instruction:'SYNTH_SUPPLIER は消耗品費',conditions:{merchant:'SYNTH_SUPPLIER'},suggested:{},source:{actorId:owner,conversationId:new ObjectId(view.conversation.id),segment:0,turnId:t1.body.requestId,quote:'SYNTH_SUPPLIER は消耗品費',at:now},history:[{revision:1,status:'active',instruction:'SYNTH_SUPPLIER は消耗品費',changedAt:now}],operations:[],createdAt:now,updatedAt:now},{_id:kB,organizationId:B,createdBy:owner,updatedBy:owner,status:'active',revision:1,instruction:'PRIVATE_COMPANY_B_TEACHING',conditions:{},suggested:{},source:{actorId:owner,conversationId:new ObjectId(),segment:0,turnId:'x',quote:'PRIVATE_COMPANY_B_TEACHING',at:now},history:[],operations:[],createdAt:now,updatedAt:now}]);
  const pinned=await ask(tokenA,'この過去の会話の判断は妥当？',{page:'transactions',inspected:{kind:'archive',id:archiveId}});
  assert.deepEqual((await chats.findOne({_id:new ObjectId(view.conversation.id)})).turns.at(-1).target.inspected,{kind:'archive',id:archiveId},'public-research:pointer-frozen');
  assert.equal((await call(endpoint,tokenA,'POST',{...pinned.body,context:{page:'transactions',inspected:{kind:'knowledge',id:String(kA)}}})).status,409,'public-research:pointer-in-request-identity');
  job=await claim();assert.equal(job.inspected.kind,'archive','public-research:inspected-archive');assert.equal(job.inspected.id,archiveId);assert.ok(job.inspected.turns.some(t=>t.text===text1));assert.match(job.inspected.meaning,/not.*instruction/i);assert.ok(!JSON.stringify(job.inspected).includes('BODY_ONLY_MARKER'));assert.equal((await finish(job)).status,200);
  assert.equal((await call(endpoint,tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:(await ok(endpoint,tokenA)).conversation.revision,text:'x',context:{page:'transactions',inspected:{kind:'archive',id:String(new ObjectId())}}})).status,404,'public-research:inspected-foreign-archive');
  assert.equal((await call(endpoint,tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:(await ok(endpoint,tokenA)).conversation.revision,text:'x',context:{page:'transactions',inspected:{kind:'knowledge',id:String(kB)}}})).status,404,'public-research:inspected-foreign-teaching');
  assert.equal((await call(endpoint,tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:(await ok(endpoint,tokenA)).conversation.revision,text:'x',context:{page:'transactions',inspected:{kind:'file',id:String(kA)}}})).status,400,'public-research:inspected-kind');
  await ask(tokenA,'この記憶について相談したい',{page:'transactions',inspected:{kind:'knowledge',id:String(kA)}});job=await claim();assert.equal(job.inspected.kind,'knowledge');assert.equal(job.inspected.item.status,'paused','public-research:inspected-paused-teaching');assert.equal(job.inspected.item.history.length,1);assert.ok(!job.knowledge.some(k=>k.id===String(kA)),'public-research:paused-not-recalled');assert.ok(!JSON.stringify(job).includes('PRIVATE_COMPANY_B'));assert.equal((await finish(job)).status,200);
  pass('a pinned archive or teaching of this company reaches the frozen job as evidence; foreign or unknown records are refused at send');

  // 9. The real actions MCP child: composed catalogue, trusted same-job capture route, private targets refused, no NTA connection.
  await ask(tokenA,'公開情報で確認して');job=await claim();
  vaultDirectory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-company-public-vault-'));const {Vault}=await import(pathToFileURL(path.join(source,'collector/vault.mjs')).href);await new Vault(vaultDirectory).update(()=>({enabled:true,token:agent.token}));
  const jobDir=path.join(vaultDirectory,'jobs',crypto.randomUUID());await fsp.mkdir(jobDir,{recursive:true});const jobFile=path.join(jobDir,'job.json');
  await fsp.writeFile(jobFile,JSON.stringify({endpoint:origin+'/api/finance-chat/worker/workspace/'+job.id+'/actions',lease:job.lease,tools:job.tools,nextSlot:1,timeoutMs:20000,publicResearch:{chrome:false,registry:'connection_required'}}));
  const mcp=spawn(process.execPath,[path.join(source,'teaching-worker/actions-mcp.mjs')],{cwd:source,windowsHide:true,env:{...process.env,OMF_ACTIONS_DIR:vaultDirectory,OMF_ACTIONS_JOB_FILE:jobFile},stdio:['pipe','pipe','pipe']});const mcpClosed=new Promise(r=>mcp.once('close',r));let mcpErr='';mcp.stderr.on('data',d=>{mcpErr+=d});
  const lines=readline.createInterface({input:mcp.stdout});const waiting=new Map();lines.on('line',l=>{try{const m=JSON.parse(l);waiting.get(m.id)?.(m);waiting.delete(m.id)}catch{}});let nextId=1;
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=nextId++;const t=setTimeout(()=>reject(Error('MCP timeout '+method+' '+mcpErr.slice(0,400))),60000);waiting.set(id,m=>{clearTimeout(t);resolve(m)});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
  try{
   await rpc('initialize',{});const listed=(await rpc('tools/list',{})).result.tools.map(t=>t.name);
   assert.deepEqual(listed,[...plainTools,'read_public_page','verify_invoice_registration','list_public_sources','read_public_source'],'public-research:mcp-composed');
   let m=await rpc('tools/call',{name:'read_public_page',arguments:{url:'https://127.0.0.1/'}});assert.equal(m.result.isError,true,'public-research:mcp-refused-private');
   m=await rpc('tools/call',{name:'verify_invoice_registration',arguments:{number:'T1234567890123'}});assert.equal(m.result.isError,undefined,'public-research:mcp-verify '+JSON.stringify(m).slice(0,300));assert.equal(JSON.parse(m.result.content[0].text).status,'connection_required','public-research:mcp-no-nta');
   m=await rpc('tools/call',{name:'list_public_sources',arguments:{}});const mine=JSON.parse(m.result.content[0].text).sources;assert.ok(mine.some(s=>s.status==='failed'&&s.requestedUrl==='https://127.0.0.1/'));assert.ok(mine.some(s=>s.status==='unavailable'));
   m=await rpc('tools/call',{name:'list_company_transactions',arguments:{limit:1}});assert.equal(m.result.isError,undefined,'public-research:mcp-actions-unchanged');
   m=await rpc('tools/call',{name:'search_mail',arguments:{terms:'x'}});assert.equal(m.result.isError,true,'public-research:mcp-no-private-tools');
  }finally{mcp.stdin.end();mcp.kill();await mcpClosed}
  assert.equal((await finish(job)).status,200);
  pass('the actions MCP child composes the server catalogue with public tools, refuses private targets, records a missing NTA connection and keeps its action transport');

  // 10. Legacy owner workspace claims stay without public research; the budget limits activity per message.
  const legacyView=await ok('/api/finance-chat/workspace',ownerToken);await ok('/api/finance-chat/workspace',ownerToken,'POST',{requestId:crypto.randomUUID(),chatRevision:legacyView.conversation?.revision||0,text:'LEGACY_OWNER_MESSAGE',context:{page:'dashboard'}});
  const legacy=await claim();assert.ok(legacy);assert.notEqual(legacy.companyScoped,true);assert.equal(legacy.publicResearch,undefined,'public-research:legacy-workspace-unchanged');assert.equal((await worker('workspace/'+legacy.id+'/sources',{lease:legacy.lease,op:'list'})).status,404,'public-research:legacy-no-route');assert.equal((await worker('workspace/'+legacy.id+'/result',{lease:legacy.lease,proposal:{kind:'unclear',summary:'legacy',patch:{},quotes:{}}})).status,200);
  await ask(tokenA,'たくさん読んで');job=await claim();
  // An expired lease reclaimed by the worker: the old lease can no longer capture, list or read; the new claim gets its own grant.
  const staleJob=job;await chats.updateOne({_id:new ObjectId(job.id)},{$set:{leaseUntil:new Date(0),attempts:1}});job=await claim();assert.ok(job&&job.lease!==staleJob.lease);assert.equal((await src(staleJob,{op:'capture',capture:page('stale lease')})).status,409,'public-research:old-lease');assert.equal((await src(staleJob,{op:'list'})).status,409);assert.equal(job.publicResearch?.registry,'connection_required','public-research:reclaim-own-grant');
  let accepted=0;for(let i=0;i<16;i++){const x=await src(job,{op:'capture',capture:page('budget '+i)});if(x.status===200)accepted++}assert.equal(accepted,16);assert.equal((await src(job,{op:'capture',capture:page('budget overflow')})).status,409,'public-research:budget');assert.equal((await finish(job)).status,200);
  assert.equal(await financial(),before,'public-research:all-domain-read-only');assert.ok(!logs.includes('BODY_ONLY_MARKER'),'public-research:no-logged-source');
  pass('legacy owner workspace jobs stay without public research; each message has a bounded research budget; no financial record changed');
  console.log(checks+' Company public research groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true});if(vaultDirectory)await fsp.rm(vaultDirectory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

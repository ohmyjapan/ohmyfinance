// Navi reads of saved research evaluations through the actual built routes, worker protocol and native services (plan
// omf-navi-evaluation-reads-20261025): the two workspace read adapters get_evaluation_overview and get_evaluation_run run over the SAME
// native readers the owner research-evaluation page uses, restricted in the database to the owner AND the claimed worker assigned card
// accounts before any batch is chosen, any row counted or any score summarised. Synthetic owners, cards, cases and runs in an owned
// disposable MongoDB only; no model, provider, network send or production database. Every final-state assertion carries an
// "eval-reads:" label so the fixture defect legs can name the assertion a reintroduced defect must flip. Groups run isolated (a red
// group prints FAIL <key> and the owner conversations are released for the next group); OMF_EVAL_READS_ONLY (comma list of keys) runs
// only the named groups. Setup steps fail with SETUP and are never a detection.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_EVAL_READS_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const DB='evaluation_reads_regression',SETUP_READY_MS=300000,TOOLS=['get_evaluation_overview','get_evaluation_run'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
 assert.equal(process.env.OMF_EVAL_READS_FIXTURE,'owned','SETUP: run only through the owned fixture');
 let mongo,client,child,directory,logs='',groups=0;const red=[];
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-eval-reads-'));
  const binary=process.env.OMF_MONGOD_BINARY||path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  assert.ok(fs.existsSync(binary),'SETUP: locked mongod binary absent; no download permitted');
  let started=Date.now();
  mongo=await MongoMemoryServer.create({binary:{systemBinary:binary,version:'8.2.1'},instance:{launchTimeout:SETUP_READY_MS}});const mongoMs=Date.now()-started;
  const uri=mongo.getUri(DB),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,env={};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','ComSpec','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
  Object.assign(env,{MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)});
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env,stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));
  for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-30000)})}
  let healthy=false;started=Date.now();
  while(!healthy&&Date.now()-started<SETUP_READY_MS&&child.exitCode===null){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).json();if(d.database?.connected){assert.equal(d.database.name,DB);healthy=true}}catch{}if(!healthy)await pause(300)}
  if(!healthy)throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  console.log('TIMING '+JSON.stringify({mongoMs,appMs:Date.now()-started}));
  client=await MongoClient.connect(uri);const db=client.db(DB);assert.equal(db.databaseName,DB);
  const api=async(route,token,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':Buffer.isBuffer(body)?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}return {status:response.status,raw,data}};
  const ok=async(route,token,method='GET',body,label='')=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'SETUP '+(label||method+' '+route)+' HTTP '+r.status+' '+r.raw.slice(0,300));return r.data};
  const C={cases:db.collection('financeevaluationcases'),runs:db.collection('financeevaluationruns'),agents:db.collection('financechatagents'),assistants:db.collection('financeassistants'),chats:db.collection('financechats'),ops:db.collection('financeactionoperations'),orgs:db.collection('organizations')};
  const register=async(email,name)=>{const t=(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name},'register '+name)).tokens.accessToken;return {token:t,id:(await db.collection('users').findOne({email}))._id}};
  const P=await register('eval-reads-owner@example.invalid','Synthetic evaluation owner'),Q=await register('eval-reads-foreign@example.invalid','Synthetic foreign owner');
  const account=async(o,name,card)=>(await ok('/api/finance/accounts',o.token,'POST',{name,provider:'amex',primaryCard:card,cardIdentifiers:[card],otpRecipient:'otp-'+card+'@example.invalid',otpMailbox:'otp-'+card+'@example.invalid'},'account '+name)).account;
  const A1=await account(P,'Eval card one','11111'),A2=await account(P,'Eval card two','22222'),AX=await account(P,'PRIVATE_UNASSIGNED_EVAL_CARD','33333'),AY=await account(Q,'Foreign eval card','44444');
  const oid=a=>new ObjectId(String(a._id)),idOf=x=>String(x._id);
  // The native case and run of card one: statement, draft, document, reference case, queue, research-worker claim and saved result.
  const {HEADERS}=await import(require('node:url').pathToFileURL(path.join(root,'shared/amex.mjs')).href);
  const csv=(card,rows)=>Buffer.from([HEADERS].concat(rows.map(r=>['2026/08/'+r[0],'2026/08/'+r[0],r[1],'Synthetic user',card,String(r[2]),'',''])).map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const importId=String((await ok('/api/finance/accounts/'+A1._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',P.token,'POST',csv('11111',[['02','Eval shop one',1101],['03','Eval shop three',1103]]),'statement')).id);
  const draftPath='/api/finance/imports/'+importId+'/drafts/2',bind=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash});
  let d=await ok(draftPath,P.token,'GET',undefined,'draft');d=await ok(draftPath,P.token,'PUT',{...bind(d),values:{...d.values,purpose:'company',productName:'Hidden reference product'},confirm:false,remember:[]},'draft save');
  const pdf=Buffer.from('%PDF-1.4\nSynthetic receipt #123. Tax 10%.\n%%EOF'),params=new URLSearchParams({...bind(d),name:'Synthetic-receipt.pdf',kind:'receipt'});
  const attached=await fetch(origin+draftPath+'/documents?'+params,{method:'POST',headers:{Authorization:'Bearer '+P.token,'Content-Type':'application/pdf'},body:pdf});assert.equal(attached.status,200,'SETUP document '+await attached.clone().text());d=await attached.json();const doc=d.documents[0];
  const definition={...bind(d),caseRevision:0,title:'Eval case one',instruction:'Confirm the requested fields from the supplied purchase.',expectations:[{field:'productName',mode:'value',value:'Hidden reference product',alternatives:[],basis:'past_decision',note:'Hidden reference history'},{field:'taxRate',mode:'value',value:10,alternatives:[],basis:'document',documentId:doc.id,note:'Printed receipt percentage'},{field:'receiptNumber',mode:'value',value:'#123',alternatives:['123'],basis:'document',documentId:doc.id,note:'Printed receipt number'}],knownFields:['purpose'],requiredSources:['document'],questionPolicy:'unnecessary',confirm:true};
  const C1=(await ok('/api/finance-evaluation/imports/'+importId+'/cases/2',P.token,'POST',definition,'case')).case;
  const agent=async(o,accounts,extra)=>{const a=await ok('/api/finance-chat/agents',o.token,'POST',{accountIds:accounts.map(x=>String(x._id)),workspaceEnabled:true,researchEnabled:true,...(extra||{})},'agent');const w=(route,body)=>api('/api/finance-chat/worker/'+route,a.token,'POST',body||{});assert.equal((await w('heartbeat')).status,200,'SETUP heartbeat');return {id:a.id,token:a.token,w}};
  const W=await agent(P,[A1,A2]);
  const B1=crypto.randomUUID();
  assert.equal((await api('/api/finance-evaluation/runs',P.token,'POST',{batchId:B1,cases:[{id:C1._id,revision:C1.revision}]})).status,200,'SETUP queue');
  const work=(route,body)=>api('/api/finance-research/worker/evaluation/'+route,W.token,'POST',body||{});
  const job=(await work('claim')).data?.job;assert.ok(job&&job.mode==='evaluation','SETUP evaluation claim');
  const evidence='Observed product. Receipt 123. Tax 10%.',source={id:'s1',kind:'document',title:'Synthetic receipt',url:'',text:evidence,hash:sha(evidence),capturedAt:new Date().toISOString(),documentId:doc.id};
  const finding=(field,value)=>({field,valueJson:JSON.stringify(value),basis:'literal',reason:'Printed receipt field',citations:[{sourceId:'s1',quote:evidence}]});
  const report={summary:'Synthetic comparison result',question:'Why was this purchased?',supplier:null,findings:[finding('productName','Observed product'),finding('taxRate',10),finding('receiptNumber','123')]};
  const runtime={models:['synthetic-eval-model'],promptHash:'a'.repeat(64),implementationHash:'b'.repeat(64),durationMs:1234};
  assert.equal((await work(job.id+'/result',{lease:job.lease,report,sources:job.sources.concat([source]),runtime})).status,200,'SETUP evaluation result');
  const R1=new ObjectId(job.id);
  // Seeded records in the shapes the native service stores: an older mixed-card batch, an unassigned-card-only newest batch and a
  // foreign owner. Secret markers stand for the fields a Navi read must never return (definitions, history, binding, lease, input
  // context, references, document hashes, raw context source text, raw diagnostics).
  const now=Date.now(),at=ms=>new Date(now+ms),B2=crypto.randomUUID(),B3=crypto.randomUUID(),BQ=crypto.randomUUID();
  const seedCase=(o,acct,title,createdAt)=>({_id:new ObjectId(),ownerId:o.id,accountId:oid(acct),importId:new ObjectId(),line:3,revision:2,title,definition:{title:'DEFINITION_SECRET',expectations:[{field:'productName',note:'DEFINITION_NOTE_SECRET'}]},context:{values:{productName:'INPUT_VALUE_SECRET'},references:{}},binding:{sourceHash:'BINDING_SECRET_HASH'},active:true,history:[{definition:'HISTORY_SECRET'}],createdAt,updatedAt:createdAt});
  const CA2=seedCase(P,A2,'Eval case two',at(-7200000)),CA3=seedCase(P,A2,'Eval case three',at(-7150000)),CX=seedCase(P,AX,'PRIVATE_X_CASE',at(-7100000)),CQ=seedCase(Q,AY,'FOREIGN_CASE_SECRET',at(-7000000));
  await C.cases.insertMany([CA2,CA3,CX,CQ]);
  const score=(status,sourcePresent)=>({version:1,fields:[{field:'productName',mode:'value',basis:'owner_confirmed',expected:['E'.repeat(1200)],actual:'A'.repeat(1200),status}],sourceChecks:[{kind:'mail',present:sourcePresent}],documentChecks:[],question:{policy:'unnecessary',asked:true,status:'unnecessary'},unscoredFields:[]});
  const ctx=acct=>({source:{purchaseDate:'2026-08-02',description:'Eval shop seeded',amount:1102,account:{id:String(acct._id),name:acct.name}},values:{productName:'INPUT_VALUE_SECRET'},references:{suppliers:[{_id:'5'.repeat(24),name:'REFERENCE_SECRET',parentId:null}]},documents:[{id:'6'.repeat(24),hash:'DOC_HASH_SECRET',mimeType:'application/pdf',name:'seeded-receipt.pdf'}],evaluationTargets:['productName']});
  const contextSource={id:'s0',kind:'context',title:'評価用の明細と提供情報（参照答えは非公開）',url:'',text:'CONTEXT_SECRET_TEXT '+JSON.stringify({values:{productName:'INPUT_VALUE_SECRET'}}),hash:'c'.repeat(64),capturedAt:new Date(now-7200000).toISOString()};
  const webSources=Array.from({length:9},(_,i)=>({id:'s'+(i+1),kind:'web',title:'Seeded source '+(i+1),url:'https://example.invalid/seeded/'+(i+1),text:'T'.repeat(2000)+'SOURCE_'+(i+1)+'_TAIL',hash:sha('seeded'+i),capturedAt:new Date(now-7200000).toISOString()}));
  const seedRun=(o,acct,caseRow,batchId,state,title,createdAt,extra)=>({_id:new ObjectId(),ownerId:o.id,accountId:oid(acct),caseId:new ObjectId(String(caseRow._id)),caseRevision:caseRow.revision,batchId,selectionHash:'f'.repeat(64),title,definition:caseRow.definition,context:ctx(acct),binding:caseRow.binding,state,sources:[contextSource],report:null,score:null,runtime:null,diagnostic:null,agentId:new ObjectId(),lease:'LEASE_SECRET_'+title.replace(/\s+/g,'_'),leaseUntil:createdAt,attempts:1,events:[{at:createdAt,stage:'queued'}],failure:'',createdAt,updatedAt:createdAt,...(extra||{})});
  const longReport={summary:'S'.repeat(4500)+'R2_SUMMARY_TAIL',question:'Q'.repeat(1600)+'R2_QUESTION_TAIL',supplier:null,findings:Array.from({length:40},(_,i)=>({field:'productName',value:'finding value '+i,valueJson:JSON.stringify('finding value '+i),basis:'literal',reason:'R'.repeat(700)+'_REASON_'+i,citations:[{sourceId:'s1',quote:'q'}]}))};
  const identity=(m,ms)=>({models:[m],promptHash:'d'.repeat(64),implementationHash:'e'.repeat(64),durationMs:ms});
  const R2=seedRun(P,A2,CA2,B2,'complete','Eval run two long',at(-3600000),{report:longReport,score:score('different',false),sources:[contextSource].concat(webSources),runtime:identity('seeded-model-r2',12)});
  const R4=seedRun(P,A1,C1,B2,'failed','Eval run four failed',at(-3500000),{diagnostic:{code:'purpose_invalid',correctionAttempted:true,error:'RAW_DIAGNOSTIC_SECRET'},failure:'research_failed',runtime:identity('seeded-model-r4',7)});
  const R5=seedRun(P,A2,CA3,B2,'queued','Eval run five queued',at(-3400000));
  const R3=seedRun(P,AX,CX,B2,'complete','PRIVATE_X_EVAL_TITLE',at(-3300000),{report:{summary:'PRIVATE_X_SUMMARY',question:'',supplier:null,findings:[]},score:score('match',true),runtime:identity('seeded-model-r3',3)});
  const R6=seedRun(P,AX,CX,B3,'complete','PRIVATE_X_NEWEST',at(60000),{report:{summary:'PRIVATE_X_NEWEST_SUMMARY',question:'',supplier:null,findings:[]},score:score('match',true),runtime:identity('seeded-model-r6',3)});
  const RQ=seedRun(Q,AY,CQ,BQ,'complete','FOREIGN_OWNER_EVAL_SECRET',at(-1000000),{report:{summary:'FOREIGN_SUMMARY_SECRET',question:'',supplier:null,findings:[]},score:score('match',true),runtime:identity('seeded-model-rq',3)});
  await C.runs.insertMany([R2,R4,R5,R3,R6,RQ]);
  // Workspace helpers: a heartbeat before every send keeps the worker live; an action is a lease-bound named read on the claimed job.
  const ws='/api/finance-chat/workspace',names=job=>(job.tools||[]).map(t=>t.name);
  const wsTurn=async(o,A,text,context)=>{await A.w('heartbeat');const view=await ok(ws,o.token,'GET',undefined,'workspace view');const sent=await api(ws,o.token,'POST',{text,requestId:crypto.randomUUID(),chatRevision:view.conversation?.revision||0,context:context||{page:'other'}});assert.equal(sent.status,200,'SETUP workspace send '+sent.raw.slice(0,300));const claimed=await A.w('workspace-claim');assert.ok(claimed.data?.job?.mode==='workspace'&&claimed.data.job.text===text,'SETUP workspace claim '+claimed.raw.slice(0,300));return claimed.data.job};
  const act=(job,A,name,args,slot)=>A.w('workspace/'+job.id+'/actions',{lease:job.lease,slot:slot||1,name,args:args||{}});
  const read=async(job,A,name,args,label)=>{const r=await act(job,A,name,args);assert.equal(r.status,200,label+' HTTP '+r.status+' '+r.raw.slice(0,300));return r.data.result};
  const finish=(job,A,summary)=>A.w('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary,patch:{},quotes:{}}});
  const {evaluationSummary}=await import(require('node:url').pathToFileURL(path.join(root,'shared/finance-evaluation.mjs')).href);
  const strip=s=>{const o={...s};delete o.coveredRunIds;delete o.coveredRuns;delete o.meaning;return o};
  const snapshot=async()=>JSON.stringify(await Promise.all(['financeevaluationcases','financeevaluationruns','financeactionoperations','transactions','financeentries','financedrafts','financedecisionmemories'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const only=new Set(String(process.env.OMF_EVAL_READS_ONLY||'').split(',').map(s=>s.trim()).filter(Boolean));
  const release=async()=>{await C.assistants.updateMany({ownerId:{$in:[P.id,Q.id]},state:{$in:['queued','working']}},{$set:{state:'ready'},$unset:{lease:'',leaseUntil:''}});await C.chats.updateMany({ownerId:{$in:[P.id,Q.id]},state:{$in:['queued','working']}},{$set:{state:'ready'},$unset:{lease:'',leaseUntil:''}})};
  const group=async(key,title,fn)=>{if(only.size&&!only.has(key))return;try{await fn();groups++;console.log('PASS '+key+': '+title)}catch(e){if(/SETUP/.test(String(e&&e.message)))throw e;red.push(key);console.log('FAIL '+key+': '+String(e&&e.message).replace(/\s+/g,' ').slice(0,900));await release()}};
  const core=async()=>JSON.stringify(await Promise.all(['financeevaluationcases','financeevaluationruns','financeactionoperations','transactions','financeentries'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const baseline=await core();

  // 1 native owner page and queue return: the full owner view (every card, definitions, no Navi population field) is unchanged.
  await group('native','native evaluation page reads and the queue return keep the full owner view: every card, case definitions, no Navi population field, foreign 404',async()=>{
   const view=await ok('/api/finance-evaluation/overview',P.token,'GET',undefined,'native overview');
   assert.equal(view.batchId,B3,'eval-reads:native-default-batch-newest '+view.batchId);
   assert.equal(view.cases.length,4,'eval-reads:native-all-cases '+view.cases.length);assert.ok(view.cases.some(c=>c.title==='PRIVATE_X_CASE')&&view.cases.every(c=>c.definition),'eval-reads:native-cases-carry-definition');
   assert.equal(Object.hasOwn(view,'population'),false,'eval-reads:native-no-population');assert.ok(view.runs.length===1&&view.runs[0].title==='PRIVATE_X_NEWEST'&&view.runs[0].references,'eval-reads:native-runs-shape');
   const b2=await ok('/api/finance-evaluation/overview?batchId='+B2,P.token,'GET',undefined,'native B2');assert.equal(b2.runs.length,4,'eval-reads:native-mixed-batch-all-cards '+b2.runs.length);assert.equal(b2.summary.total,4,'eval-reads:native-summary-all-cards');assert.equal(b2.summary.matched,1);
   const r3=await api('/api/finance-evaluation/runs/'+idOf(R3),P.token);assert.equal(r3.status,200,'eval-reads:native-unassigned-card-readable-by-owner '+r3.status);assert.equal(r3.data.run.lease,undefined,'eval-reads:native-detail-no-lease');
   assert.equal((await api('/api/finance-evaluation/runs/'+idOf(RQ),P.token)).status,404,'eval-reads:native-foreign-404');
   const again=await api('/api/finance-evaluation/runs',P.token,'POST',{batchId:B1,cases:[{id:C1._id,revision:C1.revision}]});assert.equal(again.status,200,'eval-reads:native-queue-existing-return '+again.raw.slice(0,200));
   assert.equal(again.data.batchId,B1,'eval-reads:native-queue-return-batch');assert.equal(again.data.runs.length,1);assert.equal(Object.hasOwn(again.data,'population'),false,'eval-reads:native-queue-return-shape');assert.equal(await C.runs.countDocuments({ownerId:P.id}),6,'eval-reads:native-queue-no-duplicate');
   const q=await ok('/api/finance-evaluation/overview',Q.token,'GET',undefined,'foreign native overview');assert.equal(q.cases.length,1,'eval-reads:native-foreign-own-cases');assert.equal(q.runs.length,1,'eval-reads:native-foreign-own-runs');
  });
  // 2 the claimed workspace job: both read tools, the named research-evaluation page, the feature guide naming them as this job tools.
  await group('tools','a claimed workspace job carries the two evaluation read tools, the research-evaluation page is a named owner page, and the feature guide lists the tools for this job with the page kept for editing and running',async()=>{
   const job=await wsTurn(P,W,'最近の調査評価で間違った項目を説明して');
   assert.ok(TOOLS.every(n=>names(job).includes(n)),'eval-reads:job-carries-read-tools '+JSON.stringify(names(job).filter(n=>/evaluation/.test(n))));
   const guide=await read(job,W,'list_navi_features',{query:'評価'},'eval-reads:guide-read');const f=guide.features.find(x=>x.id==='research-evaluation');
   assert.ok(f&&f.disposition==='navi_tool'&&f.tools.length===2&&TOOLS.every(n=>f.tools.includes(n)),'eval-reads:guide-navi-tool '+JSON.stringify(f));
   assert.ok(/画面/.test(f.reason)&&/読み取/.test(f.reason),'eval-reads:guide-reason-reads-vs-page '+f.reason);
   assert.equal((await finish(job,W,'評価の結果を読み取れます。')).status,200,'eval-reads:finish');
   await W.w('heartbeat');const view=await ok(ws,P.token,'GET',undefined,'view');
   const sent=await api(ws,P.token,'POST',{text:'この画面の評価を説明して',requestId:crypto.randomUUID(),chatRevision:view.conversation.revision,context:{page:'research-evaluation'}});
   assert.equal(sent.status,200,'eval-reads:page-accepted '+sent.status+' '+sent.raw.slice(0,200));
   const pj=(await W.w('workspace-claim')).data?.job;assert.ok(pj&&pj.context.page==='research-evaluation'&&pj.context.pageName==='AI調査の評価','eval-reads:page-named '+JSON.stringify({page:pj?.context?.page,pageName:pj?.context?.pageName}));
   assert.equal((await finish(pj,W,'説明しました。')).status,200,'eval-reads:page-finish');
  });

  // 3 overview: owner AND assigned cards in the database before batch selection, counting and the shared summary; bounds explicit.
  await group('overview','overview reads are restricted to the owner and the assigned cards before batch selection, counting and the shared summary; counts, limits and truncation are explicit; unassigned, foreign and secret fields never appear',async()=>{
   const job=await wsTurn(P,W,'評価の一覧を見せて');
   const v=await read(job,W,'get_evaluation_overview',{},'eval-reads:overview-read');const raw=JSON.stringify(v);
   assert.equal(v.scope,'assigned_card_accounts','eval-reads:overview-scope-label');assert.deepEqual((v.accountIds||[]).slice().sort(),[String(A1._id),String(A2._id)].sort(),'eval-reads:overview-scope-ids');
   assert.equal(v.batchId,B1,'eval-reads:scoped-default-batch '+v.batchId);
   assert.deepEqual(v.batches.map(b=>b.id),[B1,B2],'eval-reads:scoped-batches '+JSON.stringify(v.batches));
   assert.deepEqual(v.cases.map(c=>c.title).sort(),['Eval case one','Eval case three','Eval case two'],'eval-reads:scoped-cases '+JSON.stringify(v.cases.map(c=>c.title)));
   assert.ok(v.cases.every(c=>!('definition' in c)&&!('context' in c)&&!('history' in c)&&!('binding' in c)&&typeof c.revision==='number'&&typeof c.active==='boolean'),'eval-reads:case-projection '+JSON.stringify(v.cases[0]));
   assert.deepEqual(v.population.cases,{total:3,returned:3,limit:100,truncated:false},'eval-reads:cases-population '+JSON.stringify(v.population));
   assert.deepEqual(v.runs.map(r=>r.id),[String(R1)],'eval-reads:scoped-runs-latest-batch '+JSON.stringify(v.runs.map(r=>r.title)));
   const native=await ok('/api/finance-evaluation/overview?batchId='+B1,P.token,'GET',undefined,'native B1');
   assert.deepEqual(strip(v.summary),native.summary,'eval-reads:shared-summary-agrees-with-native '+JSON.stringify(strip(v.summary)));
   assert.deepEqual(v.summary.coveredRunIds,[String(R1)],'eval-reads:summary-names-covered-runs');assert.equal(v.summary.coveredRuns,1);assert.ok(/returned/.test(v.summary.meaning),'eval-reads:summary-meaning');
   assert.deepEqual(v.runs[0].score.fields.map(f=>f.field+':'+f.status),['productName:different','taxRate:match','receiptNumber:match'],'eval-reads:native-stored-score '+JSON.stringify(v.runs[0].score));
   assert.ok(v.runs[0].models.includes('synthetic-eval-model')&&v.runs[0].state==='complete'&&v.runs[0].reported===true,'eval-reads:run-row-identity '+JSON.stringify(v.runs[0]));
   // the older mixed-card batch: the unassigned card is filtered out BEFORE the summary, which the shared function then computes
   const b2=await read(job,W,'get_evaluation_overview',{batchId:B2},'eval-reads:older-batch-read');
   assert.deepEqual(b2.runs.map(r=>r.title),['Eval run two long','Eval run four failed','Eval run five queued'],'eval-reads:aggregate-after-filter '+JSON.stringify(b2.runs.map(r=>r.title)));
   const expected=evaluationSummary([R2,R4,R5]);assert.deepEqual(strip(b2.summary),expected,'eval-reads:shared-summary-scoped '+JSON.stringify(strip(b2.summary)));
   assert.ok(b2.summary.total===3&&b2.summary.sourceMissing===1&&b2.summary.failed===1&&b2.summary.pending===1&&b2.summary.different===1,'eval-reads:scoped-summary-counts '+JSON.stringify(strip(b2.summary)));
   assert.deepEqual(b2.population.runs,{total:3,returned:3,limit:12,truncated:false},'eval-reads:runs-population '+JSON.stringify(b2.population));
   assert.ok(b2.runs.every(r=>r.accountId!==String(AX._id)),'eval-reads:unassigned-hidden');
   const queued=b2.runs.find(r=>r.state==='queued'),failed=b2.runs.find(r=>r.state==='failed');
   assert.ok(queued&&queued.score===null&&queued.reported===false&&/pending/i.test(queued.stateMeaning),'eval-reads:pending-null-score '+JSON.stringify(queued));
   assert.ok(failed&&failed.score===null&&failed.failure==='research_failed'&&/fail/i.test(failed.stateMeaning),'eval-reads:failed-null-score '+JSON.stringify(failed));
   // a batch of the unassigned card only, named by the model, is an empty scoped read, never the owner default
   const b3=await read(job,W,'get_evaluation_overview',{batchId:B3},'eval-reads:x-only-batch-read');assert.equal(b3.batchId,B3);assert.deepEqual(b3.runs,[],'eval-reads:x-only-batch-empty');assert.equal(b3.summary.total,0);assert.equal(b3.population.runs.total,0,'eval-reads:x-only-batch-count');
   // bounds are stated with every result; long score values are cut and flagged
   assert.deepEqual(v.bounds,{overviewCases:100,recentRunDiscovery:120,recentBatches:10,overviewRuns:12},'eval-reads:bounds-stated '+JSON.stringify(v.bounds));
   assert.equal(v.population.recentRuns.limit,120,'eval-reads:recent-limit');assert.equal(v.population.batches.limit,10,'eval-reads:batch-limit');assert.equal(typeof v.population.batches.truncated,'boolean');
   const long=b2.runs[0].score.fields[0];assert.ok(long.expected[0].length===1000&&long.actual.length===1000&&long.valuesTruncated===true,'eval-reads:score-values-bounded '+JSON.stringify({e:long.expected[0]?.length,a:long.actual?.length,t:long.valuesTruncated}));
   const markers=['PRIVATE_X','FOREIGN','DEFINITION_SECRET','HISTORY_SECRET','BINDING_SECRET','LEASE_SECRET','INPUT_VALUE_SECRET','REFERENCE_SECRET','CONTEXT_SECRET_TEXT','Hidden reference history','agentId'];
   for(const marker of markers)assert.ok(!raw.includes(marker)&&!JSON.stringify(b2).includes(marker),'eval-reads:overview-no-secret '+marker);
   assert.equal((await finish(job,W,'一覧を読み取りました。')).status,200,'eval-reads:overview-finish');
  });

  // 4 run detail: bounded report, score, source checks, excerpts and pointers; never definitions, context, binding, lease or raw
  // diagnostics; a missing report or score stays null with the recorded state.
  await group('detail','run detail returns the bounded saved report, the stored score, source and document checks, bounded source excerpts and context pointers, timestamps and the recorded model identity; never raw definitions, input context, binding, lease, agent or raw diagnostics; missing report or score stays null with the state',async()=>{
   const job=await wsTurn(P,W,'2件目の評価の根拠を見せて');
   const d2=await read(job,W,'get_evaluation_run',{runId:idOf(R2)},'eval-reads:detail-read');const raw=JSON.stringify(d2);
   assert.ok(d2.id===idOf(R2)&&d2.state==='complete'&&d2.caseRevision===2&&d2.caseId===idOf(CA2)&&d2.batchId===B2&&d2.accountId===String(A2._id),'eval-reads:detail-identity '+JSON.stringify({id:d2.id,state:d2.state,caseRevision:d2.caseRevision}));
   assert.ok(d2.report&&d2.report.summary.length===4000&&d2.report.summaryTruncated===true&&d2.report.question.length===1500&&d2.report.questionTruncated===true,'eval-reads:report-bounded '+JSON.stringify({s:d2.report?.summary?.length,q:d2.report?.question?.length}));
   assert.ok(d2.report.findings.length===32&&d2.report.findingsTotal===40&&d2.report.findingsTruncated===true,'eval-reads:findings-bounded '+JSON.stringify({n:d2.report.findings.length,t:d2.report.findingsTotal}));
   assert.ok(d2.report.findings.every(f=>f.reason.length===600&&f.reasonTruncated===true&&f.citations===1&&f.field==='productName'),'eval-reads:finding-reason-bounded '+JSON.stringify(d2.report.findings[0]));
   assert.deepEqual(d2.score.fields.map(f=>[f.field,f.status,f.basis,f.mode]),[['productName','different','owner_confirmed','value']],'eval-reads:detail-score-fields');
   assert.deepEqual(d2.score.sourceChecks,[{kind:'mail',present:false}],'eval-reads:detail-source-checks');assert.equal(d2.score.question.status,'unnecessary','eval-reads:detail-question-status');
   assert.ok(d2.sources.length===8&&d2.sourcesTotal===10&&d2.sourcesTruncated===true,'eval-reads:sources-bounded '+JSON.stringify({n:d2.sources.length,t:d2.sourcesTotal}));
   const s0=d2.sources[0],s1=d2.sources[1];assert.ok(s0.kind==='context'&&s0.excerpt===null&&s0.pointerOnly===true&&!('text' in s0),'eval-reads:context-source-pointer-only '+JSON.stringify(s0));
   assert.ok(s1.kind==='web'&&s1.excerpt.length===1500&&s1.excerptTruncated===true&&s1.textLength===2013&&s1.url==='https://example.invalid/seeded/1'&&!('hash' in s1)&&!('text' in s1),'eval-reads:source-excerpt-bounded '+JSON.stringify({len:s1.excerpt?.length,t:s1.textLength,url:s1.url}));
   assert.deepEqual(d2.context,{source:{purchaseDate:'2026-08-02',description:'Eval shop seeded',amount:1102,account:{id:String(A2._id),name:'Eval card two'}},documents:[{id:'6'.repeat(24),name:'seeded-receipt.pdf',mimeType:'application/pdf'}],evaluationTargets:['productName']},'eval-reads:context-pointers-only '+JSON.stringify(d2.context));
   assert.deepEqual(d2.runtime,{models:['seeded-model-r2'],durationMs:12,promptHash:'d'.repeat(64),implementationHash:'e'.repeat(64)},'eval-reads:runtime-identity '+JSON.stringify(d2.runtime));
   assert.ok(d2.diagnostic===null&&typeof d2.createdAt==='string'&&Array.isArray(d2.events)&&d2.events.length===1,'eval-reads:detail-timeline '+JSON.stringify({d:d2.diagnostic,c:d2.createdAt,e:d2.events}));
   for(const marker of ['DEFINITION_SECRET','DEFINITION_NOTE_SECRET','HISTORY_SECRET','BINDING_SECRET','LEASE_SECRET','INPUT_VALUE_SECRET','REFERENCE_SECRET','CONTEXT_SECRET_TEXT','DOC_HASH_SECRET','agentId','R2_SUMMARY_TAIL','R2_QUESTION_TAIL','SOURCE_1_TAIL'])assert.ok(!raw.includes(marker),'eval-reads:detail-no-secrets '+marker);
   // the native run: the same stored score and findings the owner page returns
   const d1=await read(job,W,'get_evaluation_run',{runId:String(R1)},'eval-reads:native-run-detail');const n1=(await ok('/api/finance-evaluation/runs/'+String(R1),P.token,'GET',undefined,'native run')).run;
   assert.deepEqual(d1.score.fields.map(f=>[f.field,f.status,f.actual]),n1.score.fields.map(f=>[f.field,f.status,f.actual]),'eval-reads:detail-native-score-agrees');
   assert.deepEqual(d1.report.findings.map(f=>[f.field,f.value]),n1.report.findings.map(f=>[f.field,f.value]),'eval-reads:detail-native-findings-agree');
   assert.ok(d1.sources.length===2&&d1.sources[1].documentId===doc.id&&d1.sources[1].excerpt===evidence&&d1.report.summary==='Synthetic comparison result','eval-reads:document-source-pointer '+JSON.stringify(d1.sources));
   assert.ok(!JSON.stringify(d1).includes('Hidden reference history'),'eval-reads:native-run-no-definition');
   // failed and queued runs keep null report and score with their actual state; only the validated diagnostic code is returned
   const d4=await read(job,W,'get_evaluation_run',{runId:idOf(R4)},'eval-reads:failed-detail');
   assert.ok(d4.state==='failed'&&d4.report===null&&d4.score===null&&d4.failure==='research_failed'&&/fail/i.test(d4.stateMeaning),'eval-reads:failed-nulls '+JSON.stringify({state:d4.state,report:d4.report,score:d4.score,failure:d4.failure}));
   assert.deepEqual(d4.diagnostic,{code:'purpose_invalid',correctionAttempted:true},'eval-reads:diagnostic-validated-only '+JSON.stringify(d4.diagnostic));assert.ok(!JSON.stringify(d4).includes('RAW_DIAGNOSTIC_SECRET'),'eval-reads:no-raw-diagnostic');
   const d5=await read(job,W,'get_evaluation_run',{runId:idOf(R5)},'eval-reads:queued-detail');assert.ok(d5.state==='queued'&&d5.report===null&&d5.score===null&&d5.runtime===null&&/pending/i.test(d5.stateMeaning),'eval-reads:queued-nulls '+JSON.stringify({state:d5.state,m:d5.stateMeaning}));
   // unknown runs: 404; a malformed id, a missing id or an unknown argument: 400
   assert.equal((await act(job,W,'get_evaluation_run',{runId:'0'.repeat(24)})).status,404,'eval-reads:unknown-run-404');
   assert.equal((await act(job,W,'get_evaluation_run',{runId:'not-an-id'})).status,400,'eval-reads:malformed-run-400');
   assert.equal((await act(job,W,'get_evaluation_run',{})).status,400,'eval-reads:missing-run-400');
   assert.equal((await act(job,W,'get_evaluation_run',{runId:idOf(R2),ownerId:String(Q.id)})).status,400,'eval-reads:detail-forged-owner-400');
   assert.equal((await finish(job,W,'根拠を説明しました。')).status,200,'eval-reads:detail-finish');
  });

  // 5 isolation: foreign owner, unassigned card, reduced or emptied grant, expired lease, revoked or workspace-disabled worker,
  // purchase and company jobs, forged scope arguments.
  await group('isolation','a foreign owner, an unassigned card, a reduced or emptied grant, an expired lease, a revoked or workspace-disabled worker, purchase and company jobs and forged scope arguments never widen the read',async()=>{
   const job=await wsTurn(P,W,'他のカードの評価も見せて');
   assert.equal((await act(job,W,'get_evaluation_run',{runId:idOf(R3)})).status,404,'eval-reads:unassigned-run-404');
   assert.equal((await act(job,W,'get_evaluation_run',{runId:idOf(RQ)})).status,404,'eval-reads:foreign-run-404');
   for(const args of [{ownerId:String(Q.id)},{accountId:String(AX._id)},{accountIds:[String(AX._id)]},{batchId:'not-a-batch'},{scope:'all'}]){const r=await act(job,W,'get_evaluation_overview',args);assert.equal(r.status,400,'eval-reads:forged-argument-400 '+JSON.stringify(args)+' '+r.status)}
   const bq=await read(job,W,'get_evaluation_overview',{batchId:BQ},'eval-reads:foreign-batch-read');assert.deepEqual(bq.runs,[],'eval-reads:foreign-batch-empty');assert.ok(!JSON.stringify(bq).includes('FOREIGN'),'eval-reads:foreign-batch-no-leak');
   assert.equal((await finish(job,W,'割り当てられたカードの評価だけ読み取れます。')).status,200,'eval-reads:isolation-finish');
   // the foreign owner worker reads only the foreign owner rows
   const WQ=await agent(Q,[AY]);const qjob=await wsTurn(Q,WQ,'評価を見せて');
   const qv=await read(qjob,WQ,'get_evaluation_overview',{},'eval-reads:foreign-owner-read');const qraw=JSON.stringify(qv);
   assert.deepEqual(qv.cases.map(c=>c.title),['FOREIGN_CASE_SECRET'],'eval-reads:foreign-owner-own-cases '+JSON.stringify(qv.cases.map(c=>c.title)));assert.deepEqual(qv.runs.map(r=>r.title),['FOREIGN_OWNER_EVAL_SECRET'],'eval-reads:foreign-owner-own-runs');
   assert.ok(!qraw.includes('Eval case')&&!qraw.includes('Eval run')&&!qraw.includes('PRIVATE_X'),'eval-reads:foreign-owner-hidden');
   assert.equal((await act(qjob,WQ,'get_evaluation_run',{runId:String(R1)})).status,404,'eval-reads:foreign-owner-detail-404');
   assert.equal((await finish(qjob,WQ,'読み取りました。')).status,200,'eval-reads:foreign-finish');
   // a reduced grant (card two only) reads that card only; an emptied grant at action time is an empty read, never the owner default
   const W2=await agent(P,[A2]);const j2=await wsTurn(P,W2,'2枚目のカードの評価');
   const v2=await read(j2,W2,'get_evaluation_overview',{},'eval-reads:reduced-grant-read');
   assert.deepEqual(v2.batches.map(b=>b.id),[B2],'eval-reads:reduced-grant-batches '+JSON.stringify(v2.batches));assert.deepEqual(v2.runs.map(r=>r.title).sort(),['Eval run five queued','Eval run two long'],'eval-reads:reduced-grant-runs '+JSON.stringify(v2.runs.map(r=>r.title)));
   assert.deepEqual(v2.cases.map(c=>c.title).sort(),['Eval case three','Eval case two'],'eval-reads:reduced-grant-cases');assert.equal((await act(j2,W2,'get_evaluation_run',{runId:String(R1)})).status,404,'eval-reads:reduced-grant-detail-404');
   await C.agents.updateOne({_id:new ObjectId(W2.id)},{$set:{accountIds:[]}});
   const v0=await read(j2,W2,'get_evaluation_overview',{},'eval-reads:empty-grant-read');
   assert.ok(v0.cases.length===0&&v0.runs.length===0&&v0.batches.length===0&&v0.population.cases.total===0&&v0.population.runs.total===0&&v0.batchId===''&&v0.connected===false,'eval-reads:empty-grant-empty-read '+JSON.stringify({cases:v0.cases.length,runs:v0.runs.length,batches:v0.batches.length,population:v0.population,connected:v0.connected}));
   assert.equal((await act(j2,W2,'get_evaluation_run',{runId:idOf(R2)})).status,404,'eval-reads:empty-grant-detail-404');
   // a grant that names another owner account (a stale or corrupted grant) is still bounded by the owner in the database
   await C.agents.updateOne({_id:new ObjectId(W2.id)},{$set:{accountIds:[oid(AY)]}});
   const vx=await read(j2,W2,'get_evaluation_overview',{},'eval-reads:cross-owner-grant-read');
   assert.ok(vx.cases.length===0&&vx.runs.length===0&&vx.batches.length===0&&!JSON.stringify(vx).includes('FOREIGN'),'eval-reads:cross-owner-grant-bounded '+JSON.stringify({cases:vx.cases.length,runs:vx.runs.length,batches:vx.batches.length}));
   assert.equal((await act(j2,W2,'get_evaluation_run',{runId:idOf(RQ)})).status,404,'eval-reads:cross-owner-grant-detail-404');
   assert.equal((await finish(j2,W2,'読み取れる評価はありません。')).status,200,'eval-reads:reduced-finish');
   // an expired lease and an old lease after a reclaim are refused; a revoked worker and a workspace-disabled worker are refused
   const j3=await wsTurn(P,W,'期限切れの確認');await C.assistants.updateOne({_id:new ObjectId(j3.id)},{$set:{leaseUntil:new Date(Date.now()-1000)}});
   assert.equal((await act(j3,W,'get_evaluation_overview',{})).status,409,'eval-reads:expired-lease-refused');
   const reclaimed=(await W.w('workspace-claim')).data?.job;assert.ok(reclaimed&&reclaimed.id===j3.id,'SETUP reclaim');assert.equal((await act(j3,W,'get_evaluation_overview',{})).status,409,'eval-reads:old-lease-refused');
   assert.ok((await read(reclaimed,W,'get_evaluation_overview',{},'eval-reads:reclaimed-lease-reads')).batchId===B1,'eval-reads:reclaimed-lease-reads-scope');
   assert.equal((await finish(reclaimed,W,'再開しました。')).status,200,'eval-reads:reclaim-finish');
   const W3=await agent(P,[A1]);const j4=await wsTurn(P,W3,'取り消し前の確認');assert.equal((await api('/api/finance-chat/agents/'+W3.id,P.token,'DELETE')).status,200,'SETUP revoke');
   assert.equal((await act(j4,W3,'get_evaluation_overview',{})).status,401,'eval-reads:revoked-worker-refused');await release();
   const narrow=await agent(P,[A1],{workspaceEnabled:false});const j5=await wsTurn(P,W,'範囲外のワーカー');
   assert.equal((await act(j5,narrow,'get_evaluation_overview',{})).status,403,'eval-reads:workspace-disabled-refused');
   assert.equal((await finish(j5,W,'回答しました。')).status,200,'eval-reads:narrow-finish');
   // a purchase job never carries the tools (modes: workspace only); its feature guide keeps the page handoff
   const chatPath='/api/finance-chat/imports/'+importId+'/drafts/2';await W.w('heartbeat');const dd=await ok(draftPath,P.token,'GET',undefined,'draft'),cc=await ok(chatPath,P.token,'GET',undefined,'chat');
   assert.equal((await api(chatPath,P.token,'POST',{revision:dd.revision,key:dd.key,sourceHash:dd.sourceHash,chatRevision:cc.conversation?.revision||0,requestId:crypto.randomUUID(),text:'この購入の評価結果を見せて'})).status,200,'SETUP purchase send');
   const pj=(await W.w('claim')).data?.job;assert.ok(pj&&pj.id&&pj.lease&&pj.mode===undefined,'SETUP purchase claim');
   assert.ok(TOOLS.every(n=>!names(pj).includes(n)),'eval-reads:purchase-job-lacks-tools '+JSON.stringify(names(pj).filter(n=>/evaluation/.test(n))));
   const pr=await W.w(pj.id+'/actions',{lease:pj.lease,slot:1,name:'get_evaluation_overview',args:{}});assert.equal(pr.status,400,'eval-reads:purchase-job-no-tool '+pr.status+' '+pr.raw.slice(0,200));
   const pguide=await W.w(pj.id+'/actions',{lease:pj.lease,slot:2,name:'list_navi_features',args:{query:'評価'}});assert.equal(pguide.status,200,'SETUP purchase guide '+pguide.raw.slice(0,200));const pf=pguide.data.result.features.find(x=>x.id==='research-evaluation');
   assert.ok(pf&&pf.disposition==='page_handoff'&&pf.tools.length===0,'eval-reads:purchase-guide-page '+JSON.stringify(pf));
   assert.equal((await W.w(pj.id+'/result',{lease:pj.lease,proposal:{kind:'unclear',summary:'評価は画面で確認します。',patch:{},quotes:{}}})).status,200,'SETUP purchase finish');
   // a company job never carries the tools either
   const org=new ObjectId();await C.orgs.insertOne({_id:org,name:'Synthetic evaluation company',slug:'eval-reads-co',isActive:true,members:[{userId:P.id,role:'owner',joinedAt:new Date()}]});
   const tokenC=(await ok('/api/auth/switch-organization',P.token,'POST',{organizationId:String(org)},'switch company')).tokens.accessToken;
   const cw='/api/finance-chat/company-workspace';await W.w('heartbeat');const cview=await ok(cw,tokenC,'GET',undefined,'company view');
   assert.equal((await api(cw,tokenC,'POST',{text:'評価の結果を見せて',requestId:crypto.randomUUID(),chatRevision:cview.conversation?.revision||0,context:{page:'transactions'}})).status,200,'SETUP company send');
   const cj=(await W.w('workspace-claim')).data?.job;assert.ok(cj&&cj.companyScoped===true,'SETUP company claim');
   assert.ok(TOOLS.every(n=>!names(cj).includes(n)),'eval-reads:company-job-lacks-tools '+JSON.stringify(names(cj).filter(n=>/evaluation/.test(n))));
   const cr=await W.w('workspace/'+cj.id+'/actions',{lease:cj.lease,slot:1,name:'get_evaluation_overview',args:{}});assert.equal(cr.status,400,'eval-reads:company-job-no-tool '+cr.status+' '+cr.raw.slice(0,200));
   assert.equal((await W.w('workspace/'+cj.id+'/result',{lease:cj.lease,proposal:{kind:'unclear',summary:'会社の会話では評価を読み取りません。',patch:{},quotes:{}}})).status,200,'SETUP company finish');
  });

  // 6 repeated reads change no evaluation, financial or journal record; reads are not journaled; the turn keeps no receipts.
  await group('unchanged','repeated reads change no evaluation, financial or journal record; reads are not journaled; the answered turn keeps no receipts; every record seeded or saved natively is byte-identical after all groups',async()=>{
   const before=await snapshot(),ops=await C.ops.countDocuments();
   const job=await wsTurn(P,W,'もう一度評価を見せて');
   for(let i=0;i<3;i++){await read(job,W,'get_evaluation_overview',{},'eval-reads:repeat-overview');await read(job,W,'get_evaluation_run',{runId:String(R1)},'eval-reads:repeat-detail')}
   assert.equal((await finish(job,W,'同じ結果です。')).status,200,'eval-reads:repeat-finish');
   assert.equal(await snapshot(),before,'eval-reads:repeat-reads-no-writes');assert.equal(await C.ops.countDocuments(),ops,'eval-reads:reads-not-journaled');
   const view=await ok(ws,P.token,'GET',undefined,'view');const turn=view.conversation.turns.at(-1);assert.ok(!turn.actions||turn.actions.length===0,'eval-reads:turn-no-receipts '+JSON.stringify(turn.actions||null));
   if(!only.size)assert.equal(await core(),baseline,'eval-reads:all-reads-no-writes');
  });
  assert.ok(!logs.includes('CONTEXT_SECRET_TEXT')&&!logs.includes('DEFINITION_SECRET')&&!logs.includes('FOREIGN_OWNER_EVAL_SECRET'),'eval-reads:app-logs-no-secrets');
  if(red.length)throw Error('evaluation read groups failed: '+red.join(', '));
  console.log(groups+' evaluation read groups passed');
 }finally{
  if(child){try{if(child.exitCode===null&&child.signalCode===null)child.kill();await child.closed}catch(e){console.error('CLEANUP app: '+String(e&&e.message))}}
  if(client){try{await client.close()}catch(e){console.error('CLEANUP client: '+String(e&&e.message))}}
  if(mongo){try{await mongo.stop()}catch(e){console.error('CLEANUP mongod: '+String(e&&e.message))}}
  if(directory){const resolved=path.resolve(directory),prefix=path.resolve(os.tmpdir())+path.sep;assert.ok(resolved.startsWith(prefix)&&path.basename(resolved).startsWith('omf-eval-reads-'),'Unsafe owned cleanup target');try{await fsp.rm(resolved,{recursive:true,force:true})}catch(e){console.error('CLEANUP directory: '+String(e&&e.message))}}
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});

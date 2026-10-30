// Targeted Navi original-presence repair: compiled application, owned temporary MongoDB and synthetic records only.
// No live credentials, model calls, external network, business sends or production data.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const READY=300000,EXPENSE='\u652f\u51fa';
(async()=>{let mongo,app,client,directory,logs='';try{
 directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-evidence-'));
 const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:READY}});
 const name='navi_calendar_evidence',uri=mongo.getUri(name),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
 const env={};for(const k of ['PATH','Path','PATHEXT','SystemRoot','SystemDrive','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','PROGRAMDATA','ComSpec','NODE_OPTIONS','SECRET_VAULT_DIR'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',OMF_BANK_SCHEDULE_MS:'0',ANTHROPIC_API_KEY:'disabled-owned-test',OPENAI_API_KEY:'disabled-owned-test',SLACK_BOT_TOKEN:'disabled-owned-test'});
 app=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env,stdio:['ignore','pipe','pipe']});app.closed=new Promise(r=>app.once('close',r));for(const p of[app.stdout,app.stderr])p.on('data',b=>logs=(logs+b).slice(-16000));
 let healthy=false;const began=Date.now();while(Date.now()-began<READY){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),v=await r.json();if(v.database?.connected){assert.equal(v.database.name,name);healthy=true;break}}catch(e){if(e.code==='ERR_ASSERTION')throw e}await pause(200)}assert.ok(healthy,'SETUP owned app ready '+logs);console.log('OWNED_DATABASE_CONNECTED');
 client=await MongoClient.connect(uri);const db=client.db(name);
 const call=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}};
 const ok=async(route,token,method='GET',body)=>{const r=await call(route,token,method,body);assert.equal(r.status,200,'positive '+method+' '+route+' '+r.raw.slice(0,350));return r.data};
 const reg=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-test-Password1!',name:'Synthetic evidence user'})).tokens.accessToken;
 const ownerToken=await reg('navi-evidence-owner@example.invalid'),otherToken=await reg('navi-evidence-other@example.invalid');
 const owner=(await db.collection('users').findOne({email:'navi-evidence-owner@example.invalid'}))._id,other=(await db.collection('users').findOne({email:'navi-evidence-other@example.invalid'}))._id;
 const A=new ObjectId(),B=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now},{userId:other,role:'member',joinedAt:now}];
 await db.collection('organizations').insertMany([{_id:A,name:'Synthetic evidence A',slug:'navi-evidence-a',type:'business',isActive:true,members,settings:{defaultCurrency:'JPY',timezone:'Asia/Tokyo',fiscalYearStart:11}},{_id:B,name:'PRIVATE evidence B',slug:'navi-evidence-b',type:'business',isActive:true,members:[{userId:owner,role:'owner',joinedAt:now}]}]);
 const tokenA=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(A)})).tokens.accessToken;
 const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic card',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'synthetic@example.invalid',otpMailbox:'synthetic@example.invalid'})).account;
 const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true});
 const worker=(route,body={})=>call('/api/finance-chat/worker/'+route,agent.token,'POST',body);
 const heartbeat=async()=>assert.equal((await worker('heartbeat')).status,200);
 const ask=async()=>{await heartbeat();const v=await ok('/api/finance-chat/company-workspace',tokenA);await ok('/api/finance-chat/company-workspace',tokenA,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:v.conversation?.revision||0,text:'この支払いの請求書を確認して。',context:{page:'calendar'}});const r=await worker('workspace-claim');assert.equal(r.status,200);assert.ok(r.data.job);return r.data.job};
 let slot=0;const act=(job,name,args={})=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot:++slot});
 const read=async(job,name,args={})=>{const r=await act(job,name,args);assert.equal(r.status,200,name+' '+r.raw.slice(0,300));return r.data.result};
 const payments=db.collection('payments'),links=db.collection('calendarevidencelinks'),invoices=db.collection('calendarevidenceinvoices'),sources=db.collection('calendarevidencesources');
 const linked=new ObjectId(),empty=new ObjectId(),foreignPayment=new ObjectId(),orphanPayment=new ObjectId(),manyPayment=new ObjectId();
 await payments.insertMany([[linked,A],[empty,A],[orphanPayment,A],[manyPayment,A],[foreignPayment,B]].map(([id,organizationId])=>({_id:id,organizationId,title:'Synthetic invoice plan',amount:12345,currency:'JPY',dueDate:new Date('2026-10-23T12:00:00Z'),type:'expense',status:'paid',category:'Invoice',settledAt:new Date('2026-10-23T03:00:00Z'),createdAt:now,updatedAt:now})));
 const invoice=new ObjectId(),active=new ObjectId(),old=new ObjectId(),foreignInvoice=new ObjectId(),foreignSource=new ObjectId();
 const file=(name,kind='invoice-pdf')=>({fileId:sha(name),name,mimeType:'application/pdf',kind,size:123});
 await invoices.insertMany([{_id:invoice,organizationId:A,supplier:'Synthetic supplier',invoiceNumber:'SYN-09',servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:active,createdAt:now,updatedAt:now},{_id:foreignInvoice,organizationId:B,supplier:'PRIVATE_SUPPLIER_B',invoiceNumber:'PRIVATE_INVOICE_B',servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:foreignSource,createdAt:now,updatedAt:now}]);
 await sources.insertMany([{_id:active,organizationId:A,invoiceId:invoice,status:'active',provider:'synthetic',messageId:'synthetic-a',receivedAt:now,issuedOn:'2026-10-08',totalAmount:12345,email:{name:'private-email.eml',text:'PRIVATE_EMAIL_BODY_MUST_NOT_APPEAR_IN_SUMMARY',sha256:sha('email'),size:20},files:Array.from({length:8},(_,i)=>file('SYN-A-'+i+'.pdf')),createdAt:now,updatedAt:now},{_id:old,organizationId:A,invoiceId:invoice,status:'superseded',provider:'synthetic',messageId:'old',receivedAt:now,email:{text:'SUPERSEDED_EMAIL'},files:[file('SUPERSEDED_FILE.pdf')],createdAt:now,updatedAt:now},{_id:foreignSource,organizationId:B,invoiceId:foreignInvoice,status:'active',provider:'synthetic',messageId:'private',receivedAt:now,email:{text:'PRIVATE_EMAIL_B'},files:[file('PRIVATE_FILE_B.pdf')],createdAt:now,updatedAt:now}]);
 await links.insertMany([{organizationId:A,paymentId:linked,invoiceId:invoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:B,paymentId:foreignPayment,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:A,paymentId:orphanPayment,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:B,paymentId:linked,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now}]);
 for(let i=0;i<13;i++){const _id=new ObjectId();await invoices.insertOne({_id,organizationId:A,supplier:'Synthetic batch',invoiceNumber:'SYN-BATCH-'+i,servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:null,createdAt:now,updatedAt:now});await links.insertOne({organizationId:A,paymentId:manyPayment,invoiceId:_id,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now})}
 const savedBefore=JSON.stringify(await payments.find({}).sort({_id:1}).toArray()),sourceBefore=JSON.stringify(await sources.find({}).sort({_id:1}).toArray());
 const job=await ask();
 // Baseline fails here: the current native calendar response omits supplier-original associations.
 const list=await read(job,'list_company_calendar_entries',{}),row=list.entries.find(p=>p.id===String(linked));
 assert.ok(row.supplierOriginals,'navi-calendar:source-summary-missing');
 assert.equal(row.invoiceLink,null,'navi-calendar:issued-invoice-link-is-separate');assert.equal(row.invoiceLinkKind,'issued_invoice_income_schedule');
 assert.equal(row.supplierOriginals.linkedInvoiceCount,1,'navi-calendar:linked-count');assert.equal(row.supplierOriginals.resolvedInvoiceCount,1);
 const original=row.supplierOriginals.invoices[0];assert.equal(original.invoiceNumber,'SYN-09');assert.equal(original.supplier,'Synthetic supplier');assert.equal(original.activeSource.totalAmount,12345);assert.equal(original.activeSource.fileCount,8);assert.equal(original.activeSource.files.length,5);assert.equal(original.activeSource.filesTruncated,true);
 assert.ok(!JSON.stringify(row).includes('PRIVATE_'),'navi-calendar:no-private-body-or-company');assert.ok(!JSON.stringify(row).includes('SUPERSEDED_'),'navi-calendar:active-source-only');
 assert.equal(list.entries.find(p=>p.id===String(empty)).supplierOriginals.linkedInvoiceCount,0,'navi-calendar:checked-empty');
 const unresolved=list.entries.find(p=>p.id===String(orphanPayment)).supplierOriginals;assert.equal(unresolved.linkedInvoiceCount,1);assert.equal(unresolved.resolvedInvoiceCount,0);assert.equal(unresolved.invoices.length,0,'navi-calendar:foreign-invoice-not-resolved');
 const many=list.entries.find(p=>p.id===String(manyPayment)).supplierOriginals;assert.equal(many.linkedInvoiceCount,13);assert.equal(many.invoices.length,10);assert.equal(many.truncated,true,'navi-calendar:summary-bound');
 assert.ok(!list.entries.some(p=>p.id===String(foreignPayment)),'navi-calendar:no-foreign-payment');
 const detail=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.deepEqual(detail.entry.supplierOriginals.invoices,row.supplierOriginals.invoices,'navi-calendar:detail-matches-list');
 assert.ok(job.context.capabilities.every(x=>!x.includes('No other invoice/calendar association exists')),'navi-calendar:obsolete-contract-removed');
 const full=await read(job,'list_company_payment_evidence',{paymentId:String(linked)});assert.equal(full.evidence[0].active.files.length,8,'navi-calendar:full-reader-still-available');
 assert.equal((await act(job,'get_company_calendar_entry',{paymentId:String(foreignPayment)})).status,404,'navi-calendar:foreign-detail-denied');
 assert.equal((await act(job,'get_company_calendar_entry',{paymentId:String(new ObjectId())})).status,404,'navi-calendar:missing-detail-denied');
 let conversation=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)}),turn=conversation.turns.find(t=>t.id===conversation.currentId);
 assert.ok(Array.isArray(turn.readTrace),'navi-calendar:read-trace-retained');assert.ok(turn.readTrace.some(r=>r.name==='list_company_calendar_entries'&&r.status===200));assert.ok(turn.readTrace.some(r=>r.name==='get_company_calendar_entry'&&r.status===404),'navi-calendar:failed-read-retained');
 assert.ok(turn.readTrace.every(r=>r.argsHash&&r.resultHash&&r.at));assert.ok(!JSON.stringify(turn.readTrace).includes('PRIVATE_'));assert.ok(!JSON.stringify(turn.readTrace).includes('SYN-09'),'navi-calendar:trace-no-financial-values');
  const beforeTraceFailure=JSON.stringify(turn.readTrace);
  await db.command({collMod:'financecompanyassistants',validator:{$jsonSchema:{bsonType:'object',required:['syntheticMissingDiagnosticField']}},validationLevel:'strict',validationAction:'error'});
  try{const stillReadable=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.equal(stillReadable.entry.supplierOriginals.linkedInvoiceCount,1,'navi-calendar:diagnostic-storage-failure-does-not-block-read')}
  finally{await db.command({collMod:'financecompanyassistants',validator:{},validationLevel:'off'})}
  const afterTraceFailure=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});assert.equal(JSON.stringify(afterTraceFailure.turns.find(t=>t.id===afterTraceFailure.currentId).readTrace),beforeTraceFailure,'navi-calendar:failed-diagnostic-write-is-not-recorded');
  const otherChat={_id:new ObjectId(),ownerId:other,organizationId:A,agentId:new ObjectId(),state:'working',currentId:crypto.randomBytes(16).toString('hex'),lease:crypto.randomUUID(),leaseUntil:new Date(Date.now()+120000),revision:1,turns:[]};otherChat.turns.push({id:otherChat.currentId,text:'Synthetic other actor',actions:[]});await db.collection('financecompanyassistants').insertOne(otherChat);
  const foreignBefore=JSON.stringify(await db.collection('financecompanyassistants').findOne({_id:otherChat._id}));const refused=await act({id:String(otherChat._id),lease:otherChat.lease},'get_company_calendar_entry',{paymentId:String(linked)});assert.ok(refused.status>=400,'navi-calendar:other-actor-refused');assert.equal(JSON.stringify(await db.collection('financecompanyassistants').findOne({_id:otherChat._id})),foreignBefore,'navi-calendar:no-other-actor-trace-write');
 for(let i=0;i<105;i++)await read(job,'get_company_calendar_entry',{paymentId:String(empty)});
 conversation=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});turn=conversation.turns.find(t=>t.id===conversation.currentId);assert.equal(turn.readTrace.length,100,'navi-calendar:trace-bound');
 await links.updateOne({organizationId:A,paymentId:linked,invoiceId:invoice},{$set:{unlinkedAt:new Date()}});const removed=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.equal(removed.entry.supplierOriginals.linkedInvoiceCount,0,'navi-calendar:unlinked-not-returned');
 assert.equal(JSON.stringify(await payments.find({}).sort({_id:1}).toArray()),savedBefore,'navi-calendar:payment-values-unchanged');assert.equal(JSON.stringify(await sources.find({}).sort({_id:1}).toArray()),sourceBefore,'navi-calendar:source-originals-unchanged');assert.equal(await db.collection('transactions').countDocuments(),0,'navi-calendar:no-ledger-effects');
 assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic reply.',patch:{},quotes:{}}})).status,200);
 const finished=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});assert.equal(finished.turns.at(-1).readTrace.length,100,'navi-calendar:trace-survives-finish');
  // Explicit owner-run product replay only. Default fixture mode makes zero model calls. Snapshot and results remain private;
  // the unchanged TeachingWorker talks only to this owned app, with its synthetic server token and an owned DPAPI Vault.
  if(process.env.NAVI_REAL_REPLAY_SNAPSHOT){
   const {pathToFileURL}=require('node:url');
   const snapshotPath=path.resolve(process.env.NAVI_REAL_REPLAY_SNAPSHOT),out=path.resolve(process.env.NAVI_REPLAY_OUT||'');
   assert.ok(path.isAbsolute(process.env.NAVI_REPLAY_OUT||''),'SETUP private replay output required');assert.ok(!fs.existsSync(out),'SETUP new replay output');await fsp.mkdir(out,{recursive:true});
   const exported=JSON.parse(await fsp.readFile(snapshotPath,'utf8')),snapshot=exported.snapshot;
   const convert=(value,key='')=>{if(Array.isArray(value))return value.map(x=>convert(x));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,convert(v,k)]));if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return new Date(value);if(typeof value==='string'&&/^(?:_id|.*Id)$/.test(key)&&/^[a-f\d]{24}$/i.test(value))return new ObjectId(value);return value};
   const C=new ObjectId(snapshot.company._id);assert.equal(await db.collection('organizations').countDocuments({_id:C}),0);
   await db.collection('organizations').insertOne({_id:C,name:snapshot.company.name,slug:'private-replay-c',type:'business',isActive:true,members:[{userId:owner,role:'owner',joinedAt:now}],settings:snapshot.company.settings});
   for(const [collection,rows]of [['payments',snapshot.payments],['transactions',snapshot.transactions],['invoices',snapshot.invoices],['calendarevidenceinvoices',snapshot.evidenceInvoices],['calendarevidencesources',snapshot.evidenceSources],['calendarevidencelinks',snapshot.evidenceLinks]]){if(rows.length)await db.collection(collection).insertMany(rows.map(x=>({...convert(x),organizationId:C})))}
   const replayBefore=await Promise.all(['payments','transactions','invoices','calendarevidenceinvoices','calendarevidencesources','calendarevidencelinks'].map(async n=>[n,JSON.stringify(await db.collection(n).find({organizationId:C}).sort({_id:1}).toArray())]));
   const tokenC=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(C)})).tokens.accessToken;
   const {Vault}=await import(pathToFileURL(path.join(root,'collector/vault.mjs'))),source=await new Vault(process.env.NAVI_SOURCE_VAULT).read();
   assert.ok(source.cliPath&&source.nativeOAuthToken,'SETUP explicit existing native credential required');
   const vaultDir=path.join(directory,'model-vault'),inference=path.join(directory,'model-inference');await fsp.mkdir(inference,{recursive:true});
   const {openHttpObserver,installSpawnObserver}=await import(pathToFileURL(path.join(root,'scripts/finance-navi-agent-model-observer.mjs'))),proxy=await openHttpObserver(origin);
   const config={enabled:true,baseUrl:proxy.origin,token:agent.token,cliPath:source.cliPath,nativeOAuthToken:source.nativeOAuthToken,inferenceDirectory:inference,directory:vaultDir};
   await new Vault(vaultDir).update(()=>config);
   const observer=installSpawnObserver({cliPath:source.cliPath,secretValues:()=>[agent.token,source.nativeOAuthToken,...proxy.secretValues()]});
   const {TeachingWorker}=await import(pathToFileURL(path.join(root,'teaching-worker/worker.mjs'))),nativeWorker=new TeachingWorker(config,{log:()=>{},capability:async()=>({version:1,webSearch:true,publicPage:true,chrome:false,registry:'connection_required'})});
   const replay=[];
   try{
    const continuation=process.env.NAVI_REPLAY_CONTINUATION==='1';
    for(let i=0;i<(continuation?1:3);i++){
     const label=(continuation?'LOTOS-existing-conversation-':'LOTOS-native-')+(i+1);proxy.setCase(label);observer.setCase({caseId:label,attemptId:'initial',transport:'stream-json'});await heartbeat();
     const prior=await ok('/api/finance-chat/company-workspace',tokenC);
     if(prior.conversation?.turns?.length)await ok('/api/finance-chat/company-workspace/new',tokenC,'POST',{chatRevision:prior.conversation.revision,requestId:crypto.randomBytes(16).toString('hex')});
     let view=await ok('/api/finance-chat/company-workspace',tokenC),question=snapshot.turn.text;
     if(continuation){
      // SETUP: the actual earlier false reply, through the native result route, to test correction in an existing conversation.
      await ok('/api/finance-chat/company-workspace',tokenC,'POST',{chatRevision:view.conversation?.revision||0,requestId:crypto.randomBytes(16).toString('hex'),text:snapshot.turn.text,context:snapshot.turn.target});
      const seed=await worker('workspace-claim');assert.equal(seed.status,200);assert.ok(seed.data.job);
      const accepted=await worker('workspace/'+seed.data.job.id+'/result',{lease:seed.data.job.lease,proposal:snapshot.turn.proposal});assert.equal(accepted.status,200,'SETUP recorded earlier reply');
      view=await ok('/api/finance-chat/company-workspace',tokenC);question='로토스 청구서 원본이 정말 연결돼 있지 않나요? 다시 확인해 주세요.';
     }
     await ok('/api/finance-chat/company-workspace',tokenC,'POST',{chatRevision:view.conversation?.revision||0,requestId:crypto.randomBytes(16).toString('hex'),text:question,context:snapshot.turn.target});
     await nativeWorker.cycle();await pause(100);
     const c=await db.collection('financecompanyassistants').findOne({organizationId:C,ownerId:owner}),t=c.turns.find(t=>t.id===c.currentId),processes=observer.processes.filter(p=>p.caseId===label),events=proxy.events.filter(e=>e.caseId===label);
     const entry={caseId:label,state:c.state,recordedPriorFalseReply:continuation,reply:t.proposal||null,readTrace:t.readTrace||[],native:processes,http:events,productionWrites:0,modelCalls:1};replay.push(entry);await fsp.writeFile(path.join(out,label+'.json'),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
     console.log('NAVI_NATIVE_REPLAY '+JSON.stringify({caseId:label,state:c.state,models:[...new Set(processes.flatMap(p=>p.envelope?.modelNames||[]))],readTraceEvents:entry.readTrace.length,out}));
     assert.equal(c.state,'ready','navi-calendar:native-replay-ready');assert.ok(entry.readTrace.length>0,'navi-calendar:native-read-trace');assert.ok(processes.every(p=>p.envelope?.modelNames?.length===1&&p.envelope.modelNames[0]==='claude-opus-5-5'),'navi-calendar:actual-opus-model');
    }
    for(const [n,before]of replayBefore)assert.equal(JSON.stringify(await db.collection(n).find({organizationId:C}).sort({_id:1}).toArray()),before,'navi-calendar:replay-no-finance-effects '+n);
    await fsp.writeFile(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),sourceSnapshot:snapshotPath,applicationRoot:root,modelCalls:replay.length,results:replay.map(r=>({caseId:r.caseId,state:r.state,models:[...new Set(r.native.flatMap(p=>p.envelope?.modelNames||[]))],readTraceEvents:r.readTrace.length})),grading:'Caller must inspect replies for invoice presence and other errors; native transport success is not semantic acceptance.',productionWrites:0},null,2)+'\n',{flag:'wx'});
   }finally{observer.restore();await proxy.close();await fsp.unlink(path.join(vaultDir,'credentials.dpapi')).catch(e=>{if(e.code!=='ENOENT')throw e})}
  }
 console.log('NAVI_CALENDAR_EVIDENCE_PASS');
 }catch(e){console.error(e);console.error(logs.slice(-3500));process.exitCode=1}
 finally{
  if(client)await client.close();
  if(app&&app.exitCode===null){app.kill();await app.closed}
  if(mongo)await mongo.stop();
  if(directory){const absolute=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(absolute.startsWith(temp+path.sep)&&path.basename(absolute).startsWith('omf-navi-evidence-'));await fsp.rm(absolute,{recursive:true,force:true,maxRetries:10,retryDelay:500})}
 }
})().catch(e=>{console.error(e);process.exitCode=1});

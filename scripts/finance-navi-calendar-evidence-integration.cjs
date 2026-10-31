// Targeted Navi original-presence repair: compiled application, owned temporary MongoDB and synthetic records only.
// No live credentials, model calls, external network, business sends or production data.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const READY=300000,EXPENSE='\u652f\u51fa';
(async()=>{let mongo,app,client,directory,logs='';try{
 directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-evidence-'));
 const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:READY,args:['--setParameter','enableTestCommands=1']}});
 const name='navi_calendar_evidence',uri=mongo.getUri(name),appName='omf-navi-evidence-'+crypto.randomBytes(6).toString('hex'),appUri=new URL(uri),listener=net.createServer();appUri.searchParams.set('appName',appName);await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
 const env={};for(const k of ['PATH','Path','PATHEXT','SystemRoot','SystemDrive','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','PROGRAMDATA','ComSpec','NODE_OPTIONS','SECRET_VAULT_DIR'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{MONGO_URI:appUri.toString(),MONGODB_URI:appUri.toString(),NUXT_MONGO_URI:appUri.toString(),OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',OMF_BANK_SCHEDULE_MS:'0',ANTHROPIC_API_KEY:'disabled-owned-test',OPENAI_API_KEY:'disabled-owned-test',SLACK_BOT_TOKEN:'disabled-owned-test'});
 let appRoot=root;
 if(process.env.NAVI_TRACE_MUTATION||process.env.NAVI_CALENDAR_VIEW_MUTATION){
  assert.ok(!(process.env.NAVI_TRACE_MUTATION&&process.env.NAVI_CALENDAR_VIEW_MUTATION),'SETUP one owned compiled mutation at a time');
  assert.ok(!process.env.NAVI_REAL_REPLAY_SNAPSHOT,'SETUP mutations never run product models');
  appRoot=path.join(directory,'mutated-app');await fsp.cp(path.join(root,'.output'),path.join(appRoot,'.output'),{recursive:true,dereference:true});
  const walk=async dir=>{const rows=await fsp.readdir(dir,{withFileTypes:true}),files=[];for(const row of rows){const file=path.join(dir,row.name);if(row.isDirectory())files.push(...await walk(file));else if(row.name.endsWith('.mjs'))files.push(file)}return files};
  if(process.env.NAVI_CALENDAR_VIEW_MUTATION){
   assert.equal(process.env.NAVI_CALENDAR_VIEW_MUTATION,'1','SETUP known calendar-view mutation');
   const anchor='invoiceLink: invoiceLinkSummary(v.invoiceLink), invoiceLinkKind: "issued_invoice_income_schedule"',matches=[];
   for(const file of await walk(path.join(appRoot,'.output/server/chunks'))){const code=await fsp.readFile(file,'utf8');if(code.includes(anchor))matches.push({file,code})}
   assert.equal(matches.length,1,'SETUP exactly one compiled Navi calendar view');
   const {file,code}=matches[0];assert.equal(code.split(anchor).length,2,'SETUP exactly one issued-link projection');
   const changed=code.replace(anchor,'invoiceLink: null, invoiceLinkKind: "issued_invoice_income_schedule"');await fsp.writeFile(file,changed);
   console.log('NAVI_CALENDAR_VIEW_MUTATION '+JSON.stringify({file:path.relative(appRoot,file),originalSha256:sha(code),mutantSha256:sha(changed)}));
  }else{
  const mutation=process.env.NAVI_TRACE_MUTATION;assert.ok(['expired-lease','successor-turn'].includes(mutation),'SETUP known trace mutation');assert.ok(!process.env.NAVI_REAL_REPLAY_SNAPSHOT,'SETUP mutations never run product models');
  const matches=[];for(const file of await walk(path.join(appRoot,'.output/server/chunks'))){const code=await fsp.readFile(file,'utf8');if(code.includes('async function recordCompanyRead('))matches.push({file,code})}assert.equal(matches.length,1,'SETUP exactly one compiled trace writer');
  const {file,code}=matches[0],start=code.indexOf('async function recordCompanyRead('),end=code.indexOf('\nasync function ',start+1);assert.ok(end>start,'SETUP compiled function boundary');const section=code.slice(start,end);
  const from=mutation==='expired-lease'?'...jobFilter(agent, String(c._id), body.lease),':'currentId: c.currentId';
  const to=mutation==='expired-lease'?'...jobFilter(agent, String(c._id), body.lease), leaseUntil: { $exists: true },':'';
  assert.equal(section.split(from).length,2,'SETUP exactly one trace-filter mutation');const changed=code.slice(0,start)+section.replace(from,to)+code.slice(end);await fsp.writeFile(file,changed);
  console.log('NAVI_TRACE_MUTATION '+JSON.stringify({mutation,file:path.relative(appRoot,file),originalSha256:sha(code),mutantSha256:sha(changed)}));
  }
 }
 app=spawn(process.execPath,['.output/server/index.mjs'],{cwd:appRoot,windowsHide:true,env,stdio:['ignore','pipe','pipe']});app.closed=new Promise(r=>app.once('close',r));for(const p of[app.stdout,app.stderr])p.on('data',b=>logs=(logs+b).slice(-16000));
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
 await payments.insertMany(Array.from({length:95},(_,i)=>({_id:new ObjectId(),organizationId:A,title:'Synthetic full calendar '+i,amount:1000+i,currency:'JPY',dueDate:new Date('2026-10-23T12:00:00Z'),type:'expense',status:'pending',category:'Invoice',createdAt:now,updatedAt:now})));
 // Native setup creates a genuine issued-invoice schedule. A separate stored supplier association below must not replace it.
 const issued=(await ok('/api/invoices',tokenA,'POST',{invoiceNumber:'SYN-ISSUED-01',from:{name:'Synthetic issuer',taxId:'T1234567890123'},to:{name:'Synthetic client'},items:[{description:'Synthetic work',quantity:1,unitPrice:2000}],taxRate:10,currency:'JPY',issueDate:'2026-10-08',dueDate:'2026-10-23',status:'sent'})).invoice;
 const issuedId=new ObjectId(String(issued._id||issued.id)),issuedStored=await db.collection('invoices').findOne({_id:issuedId});
 const scheduled=await ok('/api/invoices/'+issuedId+'/calendar',tokenA,'POST',{expectedUpdatedAt:issuedStored.updatedAt.toISOString()});
 const mixedPayment=new ObjectId(scheduled.entry.id);assert.equal(scheduled.outcome,'created','SETUP genuine issued schedule created');
 const invoice=new ObjectId(),active=new ObjectId(),old=new ObjectId(),foreignInvoice=new ObjectId(),foreignSource=new ObjectId();
 const file=(name,kind='invoice-pdf')=>({fileId:sha(name),name,mimeType:'application/pdf',kind,size:123});
 await invoices.insertMany([{_id:invoice,organizationId:A,supplier:'Synthetic supplier',invoiceNumber:'SYN-09',servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:active,createdAt:now,updatedAt:now},{_id:foreignInvoice,organizationId:B,supplier:'PRIVATE_SUPPLIER_B',invoiceNumber:'PRIVATE_INVOICE_B',servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:foreignSource,createdAt:now,updatedAt:now}]);
 await sources.insertMany([{_id:active,organizationId:A,invoiceId:invoice,status:'active',provider:'synthetic',messageId:'synthetic-a',receivedAt:now,issuedOn:'2026-10-08',totalAmount:12345,email:{name:'private-email.eml',text:'PRIVATE_EMAIL_BODY_MUST_NOT_APPEAR_IN_SUMMARY',sha256:sha('email'),size:20},files:Array.from({length:8},(_,i)=>file('SYN-A-'+i+'.pdf')),createdAt:now,updatedAt:now},{_id:old,organizationId:A,invoiceId:invoice,status:'superseded',provider:'synthetic',messageId:'old',receivedAt:now,email:{text:'SUPERSEDED_EMAIL'},files:[file('SUPERSEDED_FILE.pdf')],createdAt:now,updatedAt:now},{_id:foreignSource,organizationId:B,invoiceId:foreignInvoice,status:'active',provider:'synthetic',messageId:'private',receivedAt:now,email:{text:'PRIVATE_EMAIL_B'},files:[file('PRIVATE_FILE_B.pdf')],createdAt:now,updatedAt:now}]);
 await links.insertMany([{organizationId:A,paymentId:linked,invoiceId:invoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:B,paymentId:foreignPayment,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:A,paymentId:orphanPayment,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now},{organizationId:B,paymentId:linked,invoiceId:foreignInvoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now}]);
 for(let i=0;i<13;i++){const _id=new ObjectId();await invoices.insertOne({_id,organizationId:A,supplier:'Synthetic batch',invoiceNumber:'SYN-BATCH-'+i,servicePeriod:{from:'2026-09-01',to:'2026-09-30'},currency:'JPY',activeSourceId:null,createdAt:now,updatedAt:now});await links.insertOne({organizationId:A,paymentId:manyPayment,invoiceId:_id,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now})}
 await links.insertOne({organizationId:A,paymentId:mixedPayment,invoiceId:invoice,linkedAt:now,unlinkedAt:null,createdAt:now,updatedAt:now});
 const savedBefore=JSON.stringify(await payments.find({}).sort({_id:1}).toArray()),sourceBefore=JSON.stringify(await sources.find({}).sort({_id:1}).toArray()),issuedBefore=JSON.stringify(await db.collection('invoices').find({}).sort({_id:1}).toArray());
 const job=await ask();
 // Actual stdio discovery: a trusted per-tool text-result allowance must survive the MCP catalogue projection. Ordinary
 // owner/purchase tools retain their original three fields; private server fields still never reach the model.
 const {pathToFileURL:asFileUrl}=require('node:url'),{Vault:ProbeVault}=await import(asFileUrl(path.join(root,'collector/vault.mjs')));
 const probeDir=path.join(directory,'mcp-discovery'),probeJobDir=path.join(probeDir,'jobs',crypto.randomUUID());await fsp.mkdir(probeJobDir,{recursive:true});
 await new ProbeVault(probeDir).update(()=>({token:agent.token}));
 const probeTools=job.tools.map(t=>({...t,...(t.name==='list_company_calendar_entries'?{_meta:{'anthropic/maxResultSizeChars':200000},privateProbeOnly:'NOT_MODEL_DATA'}:{})}));
 const probeFile=path.join(probeJobDir,'job.json');await fsp.writeFile(probeFile,JSON.stringify({endpoint:origin+'/api/finance-chat/worker/workspace/'+job.id+'/actions',lease:job.lease,tools:probeTools,nextSlot:1}));
 let actionsMcp=path.join(root,'teaching-worker/actions-mcp.mjs');
 if(process.env.NAVI_MCP_CATALOGUE_MUTATION){
  assert.equal(process.env.NAVI_MCP_CATALOGUE_MUTATION,'1','SETUP known MCP catalogue mutation');assert.ok(!process.env.NAVI_REAL_REPLAY_SNAPSHOT,'SETUP catalogue mutation never runs product models');
  const original=await fsp.readFile(actionsMcp,'utf8'),anchor=', _meta: t._meta';assert.equal(original.split(anchor).length,2,'SETUP exactly one metadata projection');
  const vaultImport="import { Vault } from '../collector/vault.mjs';";assert.equal(original.split(vaultImport).length,2,'SETUP one Vault import');
  const mutated=original.replace(anchor,'').replace(vaultImport,'import { Vault } from '+JSON.stringify(asFileUrl(path.join(root,'collector/vault.mjs')).href)+';');
  actionsMcp=path.join(directory,'actions-mcp-negative.mjs');await fsp.writeFile(actionsMcp,mutated);
  console.log('NAVI_MCP_CATALOGUE_MUTATION '+JSON.stringify({originalSha256:sha(original),mutantSha256:sha(mutated)}));
 }
 const probe=spawn(process.execPath,[actionsMcp],{cwd:root,windowsHide:true,env:{...env,OMF_ACTIONS_DIR:probeDir,OMF_ACTIONS_JOB_FILE:probeFile},stdio:['pipe','pipe','pipe']});const probeClosed=new Promise(r=>probe.once('close',r));
 let probeBuffer='',probeSeq=0,probeError='';const waiting=new Map();probe.stderr.on('data',b=>probeError+=b);probe.stdout.setEncoding('utf8');probe.stdout.on('data',chunk=>{probeBuffer+=chunk;let i;while((i=probeBuffer.indexOf('\n'))>=0){const line=probeBuffer.slice(0,i);probeBuffer=probeBuffer.slice(i+1);let message;try{message=JSON.parse(line)}catch{continue}const done=waiting.get(message.id);if(done){waiting.delete(message.id);done(message)}}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++probeSeq,timer=setTimeout(()=>{waiting.delete(id);reject(Error('SETUP MCP discovery timed out '+probeError.slice(0,200)))},15000);waiting.set(id,value=>{clearTimeout(timer);resolve(value)});probe.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 try{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'owned-calendar-fixture',version:'1'}});
  const discovery=(await rpc('tools/list')).result.tools,calendarTool=discovery.find(t=>t.name==='list_company_calendar_entries');
  assert.equal(calendarTool._meta?.['anthropic/maxResultSizeChars'],200000,'navi-calendar:mcp-calendar-text-limit-preserved');
  assert.ok(discovery.filter(t=>t.name!=='list_company_calendar_entries').every(t=>Object.keys(t).sort().join(',')==='description,inputSchema,name'),'navi-calendar:ordinary-mcp-catalogue-unchanged');
  assert.ok(!JSON.stringify(discovery).includes('privateProbeOnly'),'navi-calendar:mcp-still-omits-server-private-fields');
  assert.equal(job.tools.find(t=>t.name==='list_company_calendar_entries')._meta?.['anthropic/maxResultSizeChars'],200000,'navi-calendar:server-declares-calendar-text-limit');
 }finally{probe.stdin.end();await probeClosed}
 // Baseline fails here: the current native calendar response omits supplier-original associations.
 const list=await read(job,'list_company_calendar_entries',{}),row=list.entries.find(p=>p.id===String(linked));
 assert.equal(list.entries.length,100,'navi-calendar:full-native-api-list');
 console.log('NAVI_CALENDAR_RESPONSE_SIZE '+JSON.stringify({entries:list.entries.length,chars:JSON.stringify(list).length,bytes:Buffer.byteLength(JSON.stringify(list))}));
 assert.ok(row.supplierOriginals,'navi-calendar:source-summary-missing');
 assert.equal(row.invoiceLink,null,'navi-calendar:issued-invoice-link-is-separate');assert.equal(row.invoiceLinkKind,'issued_invoice_income_schedule');
 const mixed=list.entries.find(p=>p.id===String(mixedPayment));assert.ok(mixed,'navi-calendar:mixed-schedule-in-full-list');
 assert.ok(mixed.invoiceLink,'navi-calendar:mixed-issued-link-preserved');
 assert.equal(mixed.invoiceLink.invoiceId,String(issuedId),'navi-calendar:mixed-issued-identity');assert.equal(mixed.invoiceLink.invoiceNumber,'SYN-ISSUED-01');
 assert.equal(mixed.invoiceLinkKind,'issued_invoice_income_schedule');assert.equal(mixed.invoiceLink.snapshot.total,2200);assert.equal(mixed.invoiceLink.snapshot.status,'sent');assert.equal(mixed.invoiceLink.meaning,'initial_saved_invoice_snapshot_not_synced_not_settlement');
 assert.equal(mixed.amount,2200);assert.equal(mixed.type,'income');assert.equal(mixed.status,'pending');
 assert.equal(mixed.supplierOriginals.linkedInvoiceCount,1,'navi-calendar:mixed-supplier-link-preserved');assert.equal(mixed.supplierOriginals.invoices[0].evidenceId,String(invoice));assert.equal(mixed.supplierOriginals.invoices[0].invoiceNumber,'SYN-09');assert.equal(mixed.supplierOriginals.invoices[0].activeSource.totalAmount,12345,'navi-calendar:mixed-amounts-independent');
 assert.notEqual(mixed.invoiceLink.invoiceId,mixed.supplierOriginals.invoices[0].evidenceId,'navi-calendar:mixed-identities-independent');
 assert.equal(row.supplierOriginals.linkedInvoiceCount,1,'navi-calendar:linked-count');assert.equal(row.supplierOriginals.resolvedInvoiceCount,1);
 const original=row.supplierOriginals.invoices[0];assert.equal(original.invoiceNumber,'SYN-09');assert.equal(original.supplier,'Synthetic supplier');assert.equal(original.activeSource.totalAmount,12345);assert.equal(original.activeSource.fileCount,8);assert.equal(original.activeSource.files.length,5);assert.equal(original.activeSource.filesTruncated,true);
 assert.ok(!JSON.stringify(row).includes('PRIVATE_'),'navi-calendar:no-private-body-or-company');assert.ok(!JSON.stringify(row).includes('SUPERSEDED_'),'navi-calendar:active-source-only');
 assert.equal(list.entries.find(p=>p.id===String(empty)).supplierOriginals.linkedInvoiceCount,0,'navi-calendar:checked-empty');
 const unresolved=list.entries.find(p=>p.id===String(orphanPayment)).supplierOriginals;assert.equal(unresolved.linkedInvoiceCount,1);assert.equal(unresolved.resolvedInvoiceCount,0);assert.equal(unresolved.invoices.length,0,'navi-calendar:foreign-invoice-not-resolved');
 const many=list.entries.find(p=>p.id===String(manyPayment)).supplierOriginals;assert.equal(many.linkedInvoiceCount,13);assert.equal(many.invoices.length,10);assert.equal(many.truncated,true,'navi-calendar:summary-bound');
 assert.ok(many.invoices.every(i=>i.activeSource===null),'navi-calendar:missing-active-source-stays-null');
 assert.ok(!list.entries.some(p=>p.id===String(foreignPayment)),'navi-calendar:no-foreign-payment');
 const detail=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.deepEqual(detail.entry.supplierOriginals.invoices,row.supplierOriginals.invoices,'navi-calendar:detail-matches-list');
 const mixedDetail=await read(job,'get_company_calendar_entry',{paymentId:String(mixedPayment)});assert.deepEqual(mixedDetail.entry.invoiceLink,mixed.invoiceLink,'navi-calendar:mixed-detail-issued-link');assert.deepEqual(mixedDetail.entry.supplierOriginals,mixed.supplierOriginals,'navi-calendar:mixed-detail-supplier-link');assert.equal(mixedDetail.entry.invoiceLinkKind,mixed.invoiceLinkKind);
 assert.ok(job.context.capabilities.every(x=>!x.includes('No other invoice/calendar association exists')),'navi-calendar:server-capability-old-clause-removed');
 const full=await read(job,'list_company_payment_evidence',{paymentId:String(linked)});assert.equal(full.evidence[0].active.files.length,8,'navi-calendar:full-reader-still-available');
 assert.equal((await act(job,'get_company_calendar_entry',{paymentId:String(foreignPayment)})).status,404,'navi-calendar:foreign-detail-denied');
 assert.equal((await act(job,'get_company_calendar_entry',{paymentId:String(new ObjectId())})).status,404,'navi-calendar:missing-detail-denied');
 let conversation=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)}),turn=conversation.turns.find(t=>t.id===conversation.currentId);
 assert.ok(Array.isArray(turn.readTrace),'navi-calendar:read-trace-retained');assert.ok(turn.readTrace.some(r=>r.name==='list_company_calendar_entries'&&r.status===200));assert.ok(turn.readTrace.some(r=>r.name==='get_company_calendar_entry'&&r.status===404),'navi-calendar:failed-read-retained');
 assert.ok(turn.readTrace.every(r=>r.argsHash&&r.resultHash&&r.at));assert.ok(!JSON.stringify(turn.readTrace).includes('PRIVATE_'));assert.ok(!JSON.stringify(turn.readTrace).includes('SYN-09'),'navi-calendar:trace-no-financial-values');
 const browserView=await ok('/api/finance-chat/company-workspace',tokenA);
 assert.ok(browserView.conversation.turns.every(t=>!Object.hasOwn(t,'readTrace')),'navi-calendar:workspace-omits-internal-read-trace');
 assert.equal(list.supplierOriginalsContext.detailTool,'list_company_payment_evidence','navi-calendar:one-original-context');assert.ok(list.supplierOriginalsContext.checkedAt);
 assert.ok(list.supplierOriginalsContext.meaning.includes('unresolved'),'navi-calendar:unresolved-is-not-absence');
 assert.ok(list.entries.every(p=>!Object.hasOwn(p.supplierOriginals,'meaning')&&!Object.hasOwn(p.supplierOriginals,'detailTool')&&!Object.hasOwn(p.supplierOriginals,'checkedAt')),'navi-calendar:no-repeated-original-boilerplate');
 assert.equal(detail.supplierOriginalsContext.meaning,list.supplierOriginalsContext.meaning,'navi-calendar:detail-original-context');
  const beforeTraceFailure=JSON.stringify(turn.readTrace);
  await db.command({collMod:'financecompanyassistants',validator:{$jsonSchema:{bsonType:'object',required:['syntheticMissingDiagnosticField']}},validationLevel:'strict',validationAction:'error'});
  try{const stillReadable=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.equal(stillReadable.entry.supplierOriginals.linkedInvoiceCount,1,'navi-calendar:diagnostic-storage-failure-does-not-block-read')}
  finally{await db.command({collMod:'financecompanyassistants',validator:{},validationLevel:'off'})}
  const afterTraceFailure=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});assert.equal(JSON.stringify(afterTraceFailure.turns.find(t=>t.id===afterTraceFailure.currentId).readTrace),beforeTraceFailure,'navi-calendar:failed-diagnostic-write-is-not-recorded');
  const otherChat={_id:new ObjectId(),ownerId:other,organizationId:A,agentId:new ObjectId(),state:'working',currentId:crypto.randomBytes(16).toString('hex'),lease:crypto.randomUUID(),leaseUntil:new Date(Date.now()+120000),revision:1,turns:[]};otherChat.turns.push({id:otherChat.currentId,text:'Synthetic other actor',actions:[]});await db.collection('financecompanyassistants').insertOne(otherChat);
  // This reaches the existing owner/company router, not the admitted-read trace filter exercised below.
  const foreignBefore=JSON.stringify(await db.collection('financecompanyassistants').findOne({_id:otherChat._id}));const refused=await act({id:String(otherChat._id),lease:otherChat.lease},'get_company_calendar_entry',{paymentId:String(linked)});assert.ok(refused.status>=400,'navi-calendar:other-owner-router-refused');assert.equal(JSON.stringify(await db.collection('financecompanyassistants').findOne({_id:otherChat._id})),foreignBefore,'navi-calendar:other-owner-router-preserves-record');
 for(let i=0;i<105;i++)await read(job,'get_company_calendar_entry',{paymentId:String(empty)});
 conversation=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});turn=conversation.turns.find(t=>t.id===conversation.currentId);assert.equal(turn.readTrace.length,100,'navi-calendar:trace-bound');
 // The fail point is restricted to the owned app's payment read. Its entry proves working() has already admitted the job;
 // the control client changes the lease/turn while that exact read is still blocked. No production reader is mocked.
 const chats=db.collection('financecompanyassistants'),admin=client.db('admin');
 const traces=c=>JSON.stringify(c.turns.map(t=>({id:t.id,readTrace:t.readTrace||[]})));
 const lateRead=async kind=>{
  const prior=await chats.findOne({_id:new ObjectId(job.id)}),nextId=crypto.randomBytes(16).toString('hex');
  const fp=await admin.command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['find'],namespace:name+'.payments',appName,blockConnection:true,blockTimeMS:10000}});
  let settled=false;const pending=act(job,'get_company_calendar_entry',{paymentId:String(empty)}).finally(()=>{settled=true});
  try{
   await admin.command({waitForFailPoint:'failCommand',timesEntered:Number(fp.count)+1,maxTimeMS:5000});
   assert.equal(settled,false,'SETUP owned payment read is paused');
   if(kind==='expired-lease')await chats.updateOne({_id:prior._id},{$set:{leaseUntil:new Date(Date.now()-1000)}});
   else await chats.updateOne({_id:prior._id},{$set:{currentId:nextId},$push:{turns:{id:nextId,text:'Synthetic successor turn',scope:prior.turns.find(t=>t.id===prior.currentId).scope,actions:[]}}});
   const changed=await chats.findOne({_id:prior._id});assert.equal(settled,false,'SETUP state changed before read completed');
   const response=await pending;assert.equal(response.status,kind==='expired-lease'?409:200,'navi-calendar:late-read-preserves-native-outcome-'+kind);
   assert.equal(traces(await chats.findOne({_id:prior._id})),traces(changed),'navi-calendar:no-late-read-trace-'+kind);
   console.log('NAVI_LATE_READ_PASS '+kind);
  }finally{
   await admin.command({configureFailPoint:'failCommand',mode:'off'});
   await pending.catch(()=>{});
   await chats.updateOne({_id:prior._id},{$set:{currentId:prior.currentId,leaseUntil:new Date(Date.now()+120000)},$pull:{turns:{id:nextId}}});
  }
 };
 await lateRead('expired-lease');await lateRead('successor-turn');
 await admin.command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['find'],namespace:name+'.payments',appName,errorCode:2}});
 try{assert.equal((await act(job,'get_company_calendar_entry',{paymentId:String(empty)})).status,500,'navi-calendar:unexpected-read-error-500');const failed=await chats.findOne({_id:new ObjectId(job.id)});assert.equal(failed.turns.find(t=>t.id===failed.currentId).readTrace.at(-1).status,500,'navi-calendar:fallback-status-recorded')}
 finally{await admin.command({configureFailPoint:'failCommand',mode:'off'})}
 await links.updateOne({organizationId:A,paymentId:linked,invoiceId:invoice},{$set:{unlinkedAt:new Date()}});const removed=await read(job,'get_company_calendar_entry',{paymentId:String(linked)});assert.equal(removed.entry.supplierOriginals.linkedInvoiceCount,0,'navi-calendar:unlinked-not-returned');
  await links.updateOne({organizationId:A,paymentId:mixedPayment,invoiceId:invoice},{$set:{unlinkedAt:new Date()}});const mixedUnlinked=await read(job,'get_company_calendar_entry',{paymentId:String(mixedPayment)});assert.equal(mixedUnlinked.entry.supplierOriginals.linkedInvoiceCount,0,'navi-calendar:mixed-supplier-unlinked');assert.deepEqual(mixedUnlinked.entry.invoiceLink,mixed.invoiceLink,'navi-calendar:mixed-unlink-keeps-issued-link');
  assert.equal(JSON.stringify(await db.collection('invoices').find({}).sort({_id:1}).toArray()),issuedBefore,'navi-calendar:issued-invoices-unchanged');
 assert.equal(JSON.stringify(await payments.find({}).sort({_id:1}).toArray()),savedBefore,'navi-calendar:payment-values-unchanged');assert.equal(JSON.stringify(await sources.find({}).sort({_id:1}).toArray()),sourceBefore,'navi-calendar:source-originals-unchanged');assert.equal(await db.collection('transactions').countDocuments(),0,'navi-calendar:no-ledger-effects');
 assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic reply.',patch:{},quotes:{}}})).status,200);
 const finished=await db.collection('financecompanyassistants').findOne({_id:new ObjectId(job.id)});assert.equal(finished.turns.at(-1).readTrace.length,100,'navi-calendar:trace-survives-finish');
 await ok('/api/finance-chat/company-workspace/new',tokenA,'POST',{chatRevision:finished.revision,requestId:crypto.randomBytes(16).toString('hex')});
 const archivedList=await ok('/api/finance-chat/company-workspace/history',tokenA),archived=await ok('/api/finance-chat/company-workspace/history/'+archivedList.archives[0].id,tokenA);
 assert.ok(archived.archive.turns.every(t=>!Object.hasOwn(t,'readTrace')),'navi-calendar:archive-omits-internal-read-trace');
 const archivedStored=await db.collection('financecompanyconversationarchives').findOne({_id:new ObjectId(archived.archive.id)});assert.equal(archivedStored.turns.at(-1).readTrace.length,100,'navi-calendar:archive-retains-stored-diagnostics');
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
   const {Vault}=await import(pathToFileURL(path.join(root,'collector/vault.mjs')));
   const source=process.env.NAVI_MANAGED_CLI_CONFIG?{cliPath:process.env.NAVI_REPLAY_CLI,claudeConfigDirectory:process.env.NAVI_MANAGED_CLI_CONFIG}:await new Vault(process.env.NAVI_SOURCE_VAULT).read();
   assert.ok(source.cliPath&&(source.nativeOAuthToken||(path.isAbsolute(source.claudeConfigDirectory||'')&&fs.existsSync(source.claudeConfigDirectory))),'SETUP explicit existing native sign-in required');
   const vaultDir=path.join(directory,'model-vault'),inference=path.join(directory,'model-inference');await fsp.mkdir(inference,{recursive:true});
   const {openHttpObserver,installSpawnObserver}=await import(pathToFileURL(path.join(root,'scripts/finance-navi-agent-model-observer.mjs'))),proxy=await openHttpObserver(origin,{maxResponseChars:400000});
   const config={enabled:true,baseUrl:proxy.origin,token:agent.token,cliPath:source.cliPath,...(source.nativeOAuthToken?{nativeOAuthToken:source.nativeOAuthToken}:{claudeConfigDirectory:source.claudeConfigDirectory}),inferenceDirectory:inference,directory:vaultDir};
   await new Vault(vaultDir).update(()=>config);
   // Passive, fixture-local observation of native user/tool-result messages only. No hidden reasoning or raw stream is retained.
   // It observes the real stdout before the existing observer swaps in its final-result transport; input/output bytes stay unchanged.
   const childProcesses=require('node:child_process'),{syncBuiltinESMExports}=require('node:module'),originalSpawn=childProcesses.spawn,inlineCalendarResults=[];let observedCase=null,toolResultMessages=0,metadataMutations=0;
   const inspectText=text=>{let value;try{value=JSON.parse(text)}catch{return}if(Array.isArray(value)){for(const part of value)if(typeof part?.text==='string')inspectText(part.text);return}if(value?.name==='list_company_calendar_entries'&&Array.isArray(value.result?.entries))inlineCalendarResults.push({caseId:observedCase,entries:value.result.entries.length,resultHash:sha(JSON.stringify(value.result)),textHash:sha(text),chars:text.length})};
   const nativeTap=function(file,args,options){
    if(file===source.cliPath&&process.env.NAVI_MCP_META_MUTATION==='1'){
     const mcp=JSON.parse(args[args.indexOf('--mcp-config')+1]),jobFile=path.resolve(mcp.mcpServers.omf_actions.env.OMF_ACTIONS_JOB_FILE);assert.ok(jobFile.startsWith(path.resolve(vaultDir,'jobs')+path.sep),'SETUP only owned native job may be mutated');
     const value=JSON.parse(fs.readFileSync(jobFile,'utf8')),named=value.tools.filter(t=>t.name==='list_company_calendar_entries');assert.equal(named.length,1);assert.equal(named[0]._meta?.['anthropic/maxResultSizeChars'],200000);delete named[0]._meta;fs.writeFileSync(jobFile,JSON.stringify(value));metadataMutations++;
    }
    const child=originalSpawn.call(this,file,args,options);
    if(file===source.cliPath){let buffer='';const decoder=new TextDecoder();child.stdout.on('data',chunk=>{buffer+=typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let row;try{row=JSON.parse(line)}catch{continue}if(row.type!=='user'||!Array.isArray(row.message?.content))continue;for(const item of row.message.content){if(item.type!=='tool_result')continue;toolResultMessages++;if(typeof item.content==='string')inspectText(item.content);else if(Array.isArray(item.content))for(const part of item.content)if(typeof part.text==='string')inspectText(part.text)}}})}
    return child;
   };
   childProcesses.spawn=nativeTap;syncBuiltinESMExports();
   const observer=installSpawnObserver({cliPath:source.cliPath,secretValues:()=>[agent.token,source.nativeOAuthToken,...proxy.secretValues()]});
   const {TeachingWorker}=await import(pathToFileURL(path.join(root,'teaching-worker/worker.mjs'))),nativeWorker=new TeachingWorker(config,{log:()=>{},capability:async()=>({version:1,webSearch:true,publicPage:true,chrome:false,registry:'connection_required'})});
   const replay=[];
   try{
    const continuation=process.env.NAVI_REPLAY_CONTINUATION==='1',fullCalendar=process.env.NAVI_REPLAY_FULL_CALENDAR==='1';
    for(let i=0;i<(continuation||fullCalendar?1:3);i++){
     const label=(fullCalendar?'full-calendar-':continuation?'LOTOS-existing-conversation-':'LOTOS-native-')+(i+1);observedCase=label;proxy.setCase(label);observer.setCase({caseId:label,attemptId:'initial',transport:'stream-json'});await heartbeat();
     const prior=await ok('/api/finance-chat/company-workspace',tokenC);
     if(prior.conversation?.turns?.length)await ok('/api/finance-chat/company-workspace/new',tokenC,'POST',{chatRevision:prior.conversation.revision,requestId:crypto.randomBytes(16).toString('hex')});
     let view=await ok('/api/finance-chat/company-workspace',tokenC),question=fullCalendar?'支払カレンダーの保存済み一覧を、日付・状態・種類・区分で絞り込まずに読んでください。今回取得した件数と取得上限を教えてください。一覧の先頭と最後の支払いを、それぞれ保存された名称・日付・金額で示してください。':snapshot.turn.text;
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
     const unchangedFinance=await Promise.all(replayBefore.map(async([n,before])=>JSON.stringify(await db.collection(n).find({organizationId:C}).sort({_id:1}).toArray())===before));
     const observation={caseId:label,state:c.state,reply:t.proposal||null,readTrace:t.readTrace||[],native:processes,http:events,inlineCalendarResults:inlineCalendarResults.filter(r=>r.caseId===label),toolResultMessages,metadataMutations,financialRecordsUnchanged:unchangedFinance.every(Boolean),productionWrites:0,modelCalls:1};
     await fsp.writeFile(path.join(out,label+'.observation.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx'});assert.ok(observation.financialRecordsUnchanged,'navi-calendar:observed-replay-no-finance-effects');
     let fullRead=null;
     if(fullCalendar){const event=events.find(e=>e.kind==='action'&&e.tool==='list_company_calendar_entries'&&e.status===200&&JSON.stringify(e.args)==='{}');assert.ok(event,'navi-calendar:unfiltered-real-worker-read');assert.equal(event.responseTruncated,false,'navi-calendar:full-response-retained');const value=JSON.parse(event.responseText).result;assert.equal(value.entries.length,100,'navi-calendar:real-worker-100-rows');assert.equal(value.truncated,true,'navi-calendar:real-worker-more-rows');assert.ok(processes.some(p=>p.stream?.events.some(e=>e.kind==='native_tool'&&e.name==='mcp__omf_actions__list_company_calendar_entries')),'navi-calendar:real-native-mcp-call');fullRead={entries:value.entries.length,limit:value.limit,truncated:value.truncated,chars:JSON.stringify(value).length,bytes:Buffer.byteLength(JSON.stringify(value)),first:value.entries[0],last:value.entries.at(-1),resultHash:sha(JSON.stringify(value))};assert.ok((t.readTrace||[]).some(e=>e.name===event.tool&&e.argsHash===sha('{}')&&e.resultHash===fullRead.resultHash),'navi-calendar:real-worker-response-hash');}
     if(fullRead){fullRead.inline=observation.inlineCalendarResults.some(r=>r.entries===100&&r.resultHash===fullRead.resultHash);assert.ok(fullRead.inline,'navi-calendar:full-result-reached-native-model');}
     const entry={...observation,recordedPriorFalseReply:continuation,fullRead};replay.push(entry);await fsp.writeFile(path.join(out,label+'.json'),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
     console.log('NAVI_NATIVE_REPLAY '+JSON.stringify({caseId:label,state:c.state,models:[...new Set(processes.flatMap(p=>p.envelope?.modelNames||[]))],readTraceEvents:entry.readTrace.length,out}));
     assert.equal(c.state,'ready','navi-calendar:native-replay-ready');assert.ok(entry.readTrace.length>0,'navi-calendar:native-read-trace');assert.ok(processes.every(p=>p.envelope?.modelNames?.length===1&&p.envelope.modelNames[0]==='claude-opus-5-5'),'navi-calendar:actual-opus-model');
    }
    for(const [n,before]of replayBefore)assert.equal(JSON.stringify(await db.collection(n).find({organizationId:C}).sort({_id:1}).toArray()),before,'navi-calendar:replay-no-finance-effects '+n);
    await fsp.writeFile(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),sourceSnapshot:snapshotPath,applicationRoot:root,modelCalls:replay.length,results:replay.map(r=>({caseId:r.caseId,state:r.state,models:[...new Set(r.native.flatMap(p=>p.envelope?.modelNames||[]))],readTraceEvents:r.readTrace.length})),grading:'Caller must inspect replies for invoice presence and other errors; native transport success is not semantic acceptance.',productionWrites:0},null,2)+'\n',{flag:'wx'});
   }finally{observer.restore();assert.equal(childProcesses.spawn,nativeTap,'SETUP restore native observer before tap');childProcesses.spawn=originalSpawn;syncBuiltinESMExports();await proxy.close();await fsp.unlink(path.join(vaultDir,'credentials.dpapi')).catch(e=>{if(e.code!=='ENOENT')throw e})}
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

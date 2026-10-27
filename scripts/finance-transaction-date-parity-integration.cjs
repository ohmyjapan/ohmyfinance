// Transaction date parity on the actual built application: the Navi list and pattern reads, the export route, the export tool and
// (when asked) the transactions page in installed Chrome resolve the same date keys to the same company-local days; the claim facts
// carry the current/previous/next fiscal periods. Owned throwaway MongoDB, synthetic companies A (Asia/Tokyo, fiscal 11),
// B (America/New_York, fiscal 1) and C (no saved settings), synthetic rows and simulated worker replies. No model, provider, network,
// SMTP/Slack or business sends. Section 0 prints a non-throwing PROBE ledger for the fail-first legs; every later group asserts
// under its own label. Recorded inputs: EX03 (list_company_transactions and prepare_company_transaction_export with
// dateFrom 2025-11-01, dateTo 2026-10-31; the 2026-10-31T14:30:00Z row) and EX02 (clock in Asia/Tokyo, fiscalYearStart 11).
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(process.env.OMF_PARITY_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const EXPENSE='\u652f\u51fa',INCOME='\u5165\u91d1';
const LIST='list_company_transactions',PATTERNS='find_company_transaction_patterns',EXPORT='prepare_company_transaction_export';
const EX03={dateFrom:'2025-11-01',dateTo:'2026-10-31'};
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 // The pure helpers of the source tree (not the compiled copy) give the fiscal truth the facts are compared with.
 const shared=await import(pathToFileURL(path.join(__dirname,'../shared/finance-navi-business.mjs')).href),{fiscalYearFor,addDayKey}=shared;
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-transaction-date-parity-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),SETUP_READY_MS=300000,mongoStarted=Date.now();mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});console.log('TIMING '+JSON.stringify({mongoMs:Date.now()-mongoStarted}));
  const dbName='transaction_date_parity_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-20000)});
  let healthy=false;for(let i=0;i<120;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db(dbName);
  const api=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),bytes=Buffer.from(await r.arrayBuffer()),raw=bytes.toString('utf8');let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw,bytes,headers:r.headers}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'parity:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic parity user'})).tokens.accessToken;
  const ownerToken=await register('parity-owner@example.invalid'),owner=(await db.collection('users').findOne({email:'parity-owner@example.invalid'}))._id;
  const A=new ObjectId(),B=new ObjectId(),C=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];
  await db.collection('organizations').insertMany([
   {_id:A,name:'Synthetic parity A',slug:'parity-a',type:'business',isActive:true,members,settings:{defaultCurrency:'JPY',fiscalYearStart:11,timezone:'Asia/Tokyo'}},
   {_id:B,name:'PRIVATE parity B',slug:'parity-b',type:'business',isActive:true,members,settings:{defaultCurrency:'USD',fiscalYearStart:1,timezone:'America/New_York'}},
   {_id:C,name:'Synthetic parity C',slug:'parity-c',type:'business',isActive:true,members}]);
  const switchTo=async id=>(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(id)})).tokens.accessToken,tokenA=await switchTo(A),tokenB=await switchTo(B),tokenC=await switchTo(C);
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic parity card',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);assert.equal((await worker('heartbeat')).status,200);
  const endpoint='/api/finance-chat/company-workspace';
  const ask=async(token,text,context={page:'transactions'})=>{const view=await ok(endpoint,token);assert.equal((await worker('heartbeat')).status,200,'SETUP positive worker heartbeat');return ok(endpoint,token,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.conversation?.revision||0,text,context})};
  const claim=async()=>{assert.equal((await worker('heartbeat')).status,200);const r=await worker('workspace-claim');assert.equal(r.status,200,'parity:claim '+r.raw.slice(0,300));assert.ok(r.data.job,'parity:claimed');return r.data.job};
  const act=(job,name,args={},slot=1)=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const actOk=async(job,name,args={},slot=1,label=name)=>{const r=await act(job,name,args,slot);assert.equal(r.status,200,'parity:'+label+' '+r.raw.slice(0,500));return r.data};
  const finish=async job=>assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic parity reply',patch:{},quotes:{}}})).status,200);
  const turn=async(token,text,context)=>{await ask(token,text,context);return claim()};

  // ---- Seed: rows at the company-zone edges (Tokyo, New York incl. a DST day, default zone) with one literal merchant text.
  const tx=db.collection('transactions'),t=(key,o)=>({_id:new ObjectId(),referenceNumber:'PARITY-'+key.toUpperCase(),hasReceipt:false,items:[],timeline:[],attachments:[],tags:[],createdAt:now,updatedAt:now,type:EXPENSE,status:'completed',...o});
  const rows={
   late:t('late',{organizationId:A,date:new Date('2026-10-31T14:30:00Z'),amount:1001,productName:'PARITY_MART LATE JST'}),          // 23:30 JST Oct 31 (the EX03 row)
   midnight:t('midnight',{organizationId:A,date:new Date('2026-10-31T15:00:00Z'),amount:1002,productName:'PARITY_MART MIDNIGHT JST'}),// 00:00 JST Nov 1
   early:t('early',{organizationId:A,date:new Date('2026-10-30T16:00:00Z'),amount:1003,productName:'PARITY_MART EARLY JST'}),        // 01:00 JST Oct 31
   morning:t('morning',{organizationId:A,date:new Date('2026-10-31T10:00:00Z'),amount:1004,type:INCOME,status:'pending',productName:'PARITY_MART MORNING'}),
   utcMidnight:t('utcmidnight',{organizationId:A,date:new Date('2026-11-01T00:00:00Z'),amount:1005,productName:'PARITY_MART UTC MIDNIGHT'}),
   beforePeriod:t('beforeperiod',{organizationId:A,date:new Date('2025-10-31T14:59:59.999Z'),amount:1006,productName:'PARITY_MART BEFORE PERIOD'}),
   periodFirst:t('periodfirst',{organizationId:A,date:new Date('2025-10-31T15:00:00Z'),amount:1007,productName:'PARITY_MART PERIOD FIRST'}),
   september:t('september',{organizationId:A,date:new Date('2026-09-04T03:00:00Z'),amount:1008,productName:'PARITY_MART SEPTEMBER'}),
   old:t('old',{organizationId:A,date:new Date('2020-01-01T00:00:00Z'),amount:1,productName:'PARITY_MART OLD'}),
   bLate:t('b-late',{organizationId:B,date:new Date('2026-11-01T03:30:00Z'),amount:9001,productName:'PRIVATE_B LATE EDT'}),           // 23:30 EDT Oct 31
   bMidnight:t('b-midnight',{organizationId:B,date:new Date('2026-11-01T04:00:00Z'),amount:9002,productName:'PRIVATE_B MIDNIGHT'}),     // 00:00 Nov 1 New York
   bEarly:t('b-early',{organizationId:B,date:new Date('2026-10-31T04:30:00Z'),amount:9003,productName:'PRIVATE_B EARLY EDT'}),        // 00:30 EDT Oct 31
   bBefore:t('b-before',{organizationId:B,date:new Date('2026-10-31T03:59:59.999Z'),amount:9004,productName:'PRIVATE_B BEFORE'}),
   bPeriodFirst:t('b-periodfirst',{organizationId:B,date:new Date('2025-11-01T04:00:00Z'),amount:9005,productName:'PRIVATE_B PERIOD FIRST'}),
   bBeforePeriod:t('b-beforeperiod',{organizationId:B,date:new Date('2025-11-01T03:59:59.999Z'),amount:9006,productName:'PRIVATE_B BEFORE PERIOD'}),
   bDstBefore:t('b-dstbefore',{organizationId:B,date:new Date('2026-03-08T04:59:59.999Z'),amount:9007,productName:'PRIVATE_B DST BEFORE'}),// 23:59 EST Mar 7
   bDstStart:t('b-dststart',{organizationId:B,date:new Date('2026-03-08T05:00:00Z'),amount:9008,productName:'PRIVATE_B DST START'}),     // 00:00 EST Mar 8 (DST begins 02:00)
   bDstLast:t('b-dstlast',{organizationId:B,date:new Date('2026-03-09T03:59:59.999Z'),amount:9009,productName:'PRIVATE_B DST LAST'}),    // 23:59:59.999 EDT Mar 8
   bDstAfter:t('b-dstafter',{organizationId:B,date:new Date('2026-03-09T04:00:00Z'),amount:9010,productName:'PRIVATE_B DST AFTER'}),     // 00:00 EDT Mar 9
   cLate:t('c-late',{organizationId:C,date:new Date('2026-10-31T14:30:00Z'),amount:7001,productName:'PARITY_C LATE'}),
   cMidnight:t('c-midnight',{organizationId:C,date:new Date('2026-10-31T15:00:00Z'),amount:7002,productName:'PARITY_C MIDNIGHT'}),
   cEarly:t('c-early',{organizationId:C,date:new Date('2026-10-30T16:00:00Z'),amount:7003,productName:'PARITY_C EARLY'}),
   unassigned:t('unassigned',{date:new Date('2026-10-20T03:00:00Z'),amount:88888,productName:'PRIVATE_UNASSIGNED'})
  };
  await tx.insertMany(Object.values(rows));
  const idOf=k=>String(rows[k]._id),idsOf=ks=>ks.map(idOf).sort(),sorted=a=>[...a].sort();
  // Company-zone truth from the seeded instants: [start, endExclusive) in UTC. Tokyo is UTC+9 all year; New York is EDT (UTC-4) on
  // both local midnights of the EX03 period and on 2026-10-31/11-01; 2026-03-08 starts in EST (UTC-5) and ends in EDT.
  const within=(org,start,end)=>Object.entries(rows).filter(([,r])=>r.organizationId&&String(r.organizationId)===String(org)&&r.date>=new Date(start)&&r.date<new Date(end)).map(([k])=>k).sort();
  const truth={
   periodA:within(A,'2025-10-31T15:00:00Z','2026-10-31T15:00:00Z'),dayA:within(A,'2026-10-30T15:00:00Z','2026-10-31T15:00:00Z'),fromA:within(A,'2026-10-30T15:00:00Z','9999-01-01T00:00:00Z'),toA:within(A,'0001-01-01T00:00:00Z','2026-10-31T15:00:00Z'),
   periodB:within(B,'2025-11-01T04:00:00Z','2026-11-01T04:00:00Z'),dayB:within(B,'2026-10-31T04:00:00Z','2026-11-01T04:00:00Z'),dstB:within(B,'2026-03-08T05:00:00Z','2026-03-09T04:00:00Z'),
   dayC:within(C,'2026-10-30T15:00:00Z','2026-10-31T15:00:00Z')
  };
  assert.deepEqual(truth.periodA,sorted(['periodFirst','september','early','morning','late']),'parity:truth-period');assert.deepEqual(truth.dayA,sorted(['early','morning','late']),'parity:truth-day');
  assert.deepEqual(truth.fromA,sorted(['early','morning','late','midnight','utcMidnight']),'parity:truth-from');assert.deepEqual(truth.toA,sorted(['old','beforePeriod','periodFirst','september','early','morning','late']),'parity:truth-to');
  assert.deepEqual(truth.dayB,sorted(['bEarly','bLate']),'parity:truth-day-new-york');assert.deepEqual(truth.dstB,sorted(['bDstStart','bDstLast']),'parity:truth-dst-day');assert.deepEqual(truth.dayC,sorted(['cEarly','cLate']),'parity:truth-default-zone');
  const route='/api/transactions/export',q=o=>Object.entries(o).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
  const routeIds=async(token,criteria)=>sorted((await ok(route+'?format=json&'+q(criteria),token)).map(x=>x.id));
  const listIds=r=>sorted(r.result.transactions.map(x=>x.id)),patternIds=r=>sorted(r.result.groups.flatMap(g=>g.examples.map(e=>e.id)));
  const windowOf=w=>w?{start:w.start,end:w.end,timeZone:w.timeZone,timeZoneEvidence:w.timeZoneEvidence}:w;
  const records=async()=>JSON.stringify(await Promise.all(['transactions','invoices','payments','budgets','recurringpayments','receipts','organizations'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const before=await records();

  // ---- 0. Fail-first ledger (non-throwing): the four legs the plan names must FAIL on the unchanged build.
  const probe=(label,v)=>{console.log((v?'PROBE-OK ':'PROBE-FAIL ')+label);return v};
  {const job=await turn(tokenA,'Probe the reads',{page:'transactions'});
   let r=await act(job,LIST,{dateTo:'2026-10-31',limit:50},1);probe('parity:list-final-day',r.status===200&&listIds(r.data).includes(idOf('late')));
   r=await act(job,LIST,{dateFrom:'2026-10-31',limit:50},2);probe('parity:list-first-day',r.status===200&&listIds(r.data).includes(idOf('early')));
   r=await act(job,PATTERNS,{merchant:'PARITY_MART',...EX03,exampleLimit:20},3);probe('parity:patterns-final-day',r.status===200&&patternIds(r.data).includes(idOf('late')));
   probe('parity:fiscal-facts',!!job.context?.facts?.fiscalPeriods);
   await finish(job)}

  // ---- 1. L1: the list read, the export route and the export tool agree on the same keys for A, B and C; the window is the export window
  const parity=async(token,criteria,expected,label)=>{
   const job=await turn(token,'Parity '+label,{page:'transactions'});
   const list=await actOk(job,LIST,{...criteria,limit:50},1,'list '+label),exported=await actOk(job,EXPORT,{format:'json',...criteria},2,'export-tool '+label),fromRoute=await routeIds(token,criteria);
   assert.deepEqual(listIds(list),idsOf(expected),'parity:'+label+' list vs truth');assert.deepEqual(fromRoute,idsOf(expected),'parity:'+label+' route vs truth');
   assert.deepEqual(listIds(list),fromRoute,'parity:'+label+' list vs route');assert.equal(exported.result.export.matchedCount,expected.length,'parity:'+label+' export-tool count');
   assert.deepEqual(windowOf(list.result.window),windowOf(exported.result.export.window),'parity:'+label+' window');assert.ok(list.result.window.meaning,'parity:'+label+' window-meaning');
   assert.equal(list.result.hasMore,false);await finish(job);return{job,list,exported}};
  const ex03=await parity(tokenA,EX03,truth.periodA,'list-period');
  assert.deepEqual(windowOf(ex03.list.result.window),{start:'2025-10-31T15:00:00.000Z',end:'2026-10-31T14:59:59.999Z',timeZone:'Asia/Tokyo',timeZoneEvidence:'saved'},'parity:list-window-ex03');
  await parity(tokenA,{dateFrom:'2026-10-31',dateTo:'2026-10-31'},truth.dayA,'list-single-day');
  await parity(tokenA,{dateTo:'2026-10-31'},truth.toA,'list-final-day');
  await parity(tokenA,{dateFrom:'2026-10-31'},truth.fromA,'list-first-day');
  await parity(tokenB,EX03,truth.periodB,'list-period-new-york');
  await parity(tokenB,{dateFrom:'2026-10-31',dateTo:'2026-10-31'},truth.dayB,'list-single-day-new-york');
  await parity(tokenB,{dateFrom:'2026-03-08',dateTo:'2026-03-08'},truth.dstB,'list-dst-day');
  const c=await parity(tokenC,{dateFrom:'2026-10-31',dateTo:'2026-10-31'},truth.dayC,'list-default-zone');assert.equal(c.list.result.window.timeZoneEvidence,'not_saved_default_Asia/Tokyo','parity:list-default-zone-evidence');
  {const job=await turn(tokenA,'List without dates',{page:'transactions'});const r=await actOk(job,LIST,{limit:50},1,'list-no-dates');
   assert.equal(r.result.window,undefined,'parity:list-no-dates-no-window');assert.deepEqual(listIds(r),idsOf(Object.keys(rows).filter(k=>rows[k].organizationId&&String(rows[k].organizationId)===String(A))),'parity:list-no-dates');
   const paged=await actOk(job,LIST,{...EX03,limit:2},2,'list-paged');assert.equal(paged.result.transactions.length,2);assert.equal(paged.result.hasMore,true,'parity:list-paged-has-more');assert.deepEqual(windowOf(paged.result.window),windowOf(ex03.list.result.window),'parity:list-paged-window');
   assert.ok(!JSON.stringify(r).includes('PRIVATE_'),'parity:list-scope');await finish(job)}
  pass('list read = export route = export tool for the EX03 period, the single day, final/first day alone, New York, a DST day and the default zone; window carried only with a date key');

  // ---- 2. L2: find_company_transaction_patterns resolves the same keys
  {const job=await turn(tokenA,'Patterns parity',{page:'transactions'});
   for(const [i,[criteria,expected,label]] of [[EX03,truth.periodA,'patterns-final-day'],[{dateFrom:'2026-10-31',dateTo:'2026-10-31'},truth.dayA,'patterns-single-day'],[{dateFrom:'2026-10-31'},truth.fromA,'patterns-first-day']].entries()){
    const slot=1+i; // one action slot per distinct intent (the server refuses a reused slot with another meaning)
    const r=await actOk(job,PATTERNS,{merchant:'PARITY_MART',...criteria,exampleLimit:20},slot,label),fromRoute=await routeIds(tokenA,{search:'PARITY_MART',...criteria});
    assert.deepEqual(patternIds(r),idsOf(expected),'parity:'+label+' vs truth');assert.deepEqual(patternIds(r),fromRoute,'parity:'+label+' vs route');assert.equal(r.result.matched,expected.length,'parity:'+label+' matched');
    assert.deepEqual(windowOf(r.result.window),windowOf((await actOk(job,EXPORT,{format:'json',...criteria},10+slot,'export-tool '+label)).result.export.window),'parity:'+label+' window')}
   const bare=await actOk(job,PATTERNS,{merchant:'PARITY_MART'},4,'patterns-no-dates');assert.equal(bare.result.window,undefined,'parity:patterns-no-dates-no-window');assert.equal(bare.result.matched,9,'parity:patterns-no-dates');
   await finish(job)}
  pass('pattern evidence resolves the same company-zone days as the export for the final day, the single day and the first day; no window without a key');

  // ---- 3. L3: facts.fiscalPeriods beside the unchanged clock and companySettings
  const fiscalFacts=async(token,startMonth,label)=>{const job=await turn(token,'Fiscal facts '+label,{page:'dashboard'}),f=job.context.facts,p=f.fiscalPeriods;
   assert.deepEqual(Object.keys(f.clock).sort(),['capturedAt','localDate','meaning','timeZone','timeZoneEvidence'],'parity:clock-unchanged');assert.deepEqual(Object.keys(f.companySettings).sort(),['defaultCurrency','fiscalYearStart','meaning'],'parity:settings-unchanged');
   assert.ok(p,'parity:fiscal-facts');assert.deepEqual(Object.keys(p).sort(),['asOf','current','evidence','meaning','next','previous'],'parity:fiscal-facts-shape');assert.equal(p.asOf,f.clock.localDate,'parity:fiscal-as-of');
   if(startMonth){assert.equal(f.companySettings.fiscalYearStart,startMonth);assert.deepEqual(p.current,fiscalYearFor(f.clock.localDate,startMonth),'parity:fiscal-current');
    assert.equal(p.previous.end,addDayKey(p.current.start,-1),'parity:fiscal-previous');assert.deepEqual(p.previous,fiscalYearFor(addDayKey(p.current.start,-1),startMonth),'parity:fiscal-previous');assert.notDeepEqual(p.previous,p.current,'parity:fiscal-previous');
    assert.equal(p.next.start,addDayKey(p.current.end,1),'parity:fiscal-next');assert.equal(p.evidence,'saved_fiscal_year_start','parity:fiscal-evidence');assert.ok(p.current.start<=f.clock.localDate&&f.clock.localDate<=p.current.end,'parity:fiscal-current-contains-today')}
   else{assert.equal(f.companySettings.fiscalYearStart,null);assert.deepEqual([p.current,p.previous,p.next],[null,null,null],'parity:fiscal-unrecorded');assert.equal(p.evidence,'not_recorded','parity:fiscal-evidence')}
   assert.ok(/previous ends the day before/.test(p.meaning),'parity:fiscal-meaning');await finish(job);return p};
  const pA=await fiscalFacts(tokenA,11,'A');
  // EX02 as recorded: a 2026-10-27 clock in Asia/Tokyo with start month 11 names 2025-11-01..2026-10-31 current and 2024-11-01..2025-10-31 previous.
  if(pA.asOf>='2025-11-01'&&pA.asOf<='2026-10-31'){assert.deepEqual(pA.current,{startMonth:11,start:'2025-11-01',end:'2026-10-31'},'parity:fiscal-ex02-current');assert.deepEqual(pA.previous,{startMonth:11,start:'2024-11-01',end:'2025-10-31'},'parity:fiscal-ex02-previous')}
  await fiscalFacts(tokenB,1,'B');await fiscalFacts(tokenC,null,'C');
  await db.collection('organizations').updateOne({_id:C},{$set:{'settings.fiscalYearStart':13}});const pOut=await fiscalFacts(tokenC,null,'C-out-of-range');assert.equal(pOut.evidence,'not_recorded');await db.collection('organizations').updateOne({_id:C},{$unset:{settings:''}});
  pass('facts.fiscalPeriods: current contains the local date, previous ends the day before, next starts the day after; not_recorded nulls for a missing or out-of-range start month; clock and companySettings keys unchanged');

  // ---- 4. L4: installed Chrome: the page's visible rows for 2026-10-31..2026-10-31 are the company-zone day in a New York and a Tokyo browser; the button bytes carry the same ids
  if(process.env.OMF_TRANSACTION_DATE_PARITY_BROWSER==='1'){
   let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
   const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(fs.existsSync);assert.ok(executablePath,'Installed Chrome required');
   const downloads=path.join(directory,'downloads');await fsp.mkdir(downloads);
   const expectedDay=idsOf(truth.dayA),expectedRefs=sorted(truth.dayA.map(k=>rows[k].referenceNumber));
   const direct=await api(route+'?'+q({format:'csv',dateFrom:'2026-10-31',dateTo:'2026-10-31'}),tokenA);assert.equal(direct.status,200);
   const csvIds=bytes=>sorted(bytes.toString('utf8').split('\n').slice(1).filter(Boolean).map(line=>line.split(',')[0]));assert.deepEqual(csvIds(direct.bytes),expectedDay,'parity-ui:route-day-ids');
   // Each browser zone gets its own Chrome: the process TZ and the CDP override both name the zone, and the page's own Date offset is checked.
   for(const [zone,epochOffset] of [['America/New_York',300],['Asia/Tokyo',-540]]){
    let browser,page;const errors=[];
    const wait=async(fn,args=[],label='condition',diag=null)=>{for(let i=0;i<300;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('parity-ui:'+label+(diag?' '+JSON.stringify(await page.evaluate(diag)):''))};
    const files=async()=>(await fsp.readdir(downloads)).filter(n=>n.endsWith('.csv')).sort(),clearDownloads=async()=>{for(const n of await fsp.readdir(downloads))await fsp.rm(path.join(downloads,n),{force:true})};
    const downloaded=async()=>{for(let i=0;i<150;i++){const f=(await files())[0];if(f){return fsp.readFile(path.join(downloads,f))}await pause(100)}throw Error('parity-ui:download '+JSON.stringify({errorText:await page.evaluate(()=>document.querySelector('[data-transactions-export-error]')?.textContent||null),pageErrors:errors}))};
    const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(organizationId));
    const rowRefs=()=>Array.from(document.querySelectorAll('[data-page-content] tbody tr')).map(r=>(r.textContent.match(/PARITY-[A-Z-]+/)||[''])[0]);
    try{
     const profile=path.join(directory,'profile-'+zone.replace(/\W/g,'_'));await fsp.mkdir(path.join(profile,'Default'),{recursive:true});await fsp.writeFile(path.join(profile,'Default','Preferences'),JSON.stringify({profile:{default_content_setting_values:{automatic_downloads:1}},download:{prompt_for_download:false}}));
     browser=await puppeteer.launch({executablePath,userDataDir:profile,pipe:true,headless:true,env:{...process.env,TZ:zone},args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
     page=await browser.newPage();await page.setViewport({width:390,height:844});const cdp=await page.createCDPSession();await cdp.send('Emulation.setTimezoneOverride',{timezoneId:zone});await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
     try{const bcdp=await browser.target().createCDPSession();await bcdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})}catch(e){console.log('NOTE Browser.setDownloadBehavior unavailable: '+String(e.message).slice(0,120))}
     page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{errors.push(d.message());d.dismiss().catch(()=>{})});
     await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');
     // The page's Date runs in the browser zone (the plan's unknown #2 is asserted, not assumed) before the filter is trusted.
     assert.equal(await page.evaluate(()=>new Date(0).getTimezoneOffset()),epochOffset,'parity-ui:browser-zone '+zone);
     await page.type('#email','parity-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
     await nativeSwitch(A);await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await wait(()=>location.pathname==='/transactions'&&!!document.querySelector('[data-page-content] tbody tr'),[],'transactions-page');
     assert.equal(await page.evaluate(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').currentOrganization?.settings?.timezone),'Asia/Tokyo','parity-ui:session-zone');
     assert.equal(await page.evaluate(()=>new Date(0).getTimezoneOffset()),epochOffset,'parity-ui:browser-zone-after-login '+zone);
     await page.evaluate(()=>Array.from(document.querySelectorAll('[data-page-content] button')).find(b=>b.textContent.includes('詳細フィルター')).click());await wait(()=>document.querySelectorAll('[data-page-content] input[type="date"]').length===2,[],'advanced-filters');
     await page.$$eval('[data-page-content] input[type="date"]',(es,v)=>es.forEach((e,i)=>{e.value=v[i];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}),['2026-10-31','2026-10-31']);
     await wait(n=>document.querySelectorAll('[data-page-content] tbody tr').length===n,[expectedRefs.length],'date-filter-applied '+zone,rowRefs);
     assert.deepEqual(sorted(await page.evaluate(rowRefs)),expectedRefs,'parity-ui:visible-rows '+zone);
     await clearDownloads();await page.evaluate(()=>document.querySelector('[data-transactions-export]').click());const buttonBytes=await downloaded();
     assert.deepEqual(csvIds(buttonBytes),expectedDay,'parity-ui:button-ids '+zone);assert.equal(Buffer.compare(buttonBytes,direct.bytes),0,'parity-ui:button-bytes '+zone);assert.equal(await page.$('[data-transactions-export-error]'),null,'parity-ui:button-no-error');
     assert.deepEqual(errors,[],'parity-ui:page-errors '+zone);
    }finally{if(browser)await browser.close()}
   }
   pass('installed Chrome in a New York and a Tokyo browser: the page shows exactly the company-zone day for 2026-10-31..2026-10-31 and the button exports the same ids and bytes as the route');
  }else console.log('Browser leg not requested (OMF_TRANSACTION_DATE_PARITY_BROWSER unset)');

  assert.equal(await records(),before,'parity:records-unchanged');
  const privateLogLines=logs.split('\n').filter(l=>!/^\[API\] [A-Z]+ \//.test(l)&&l.includes('PARITY_MART')).map(l=>l.slice(0,300));assert.ok(privateLogLines.length===0,'parity:no-private-logs '+JSON.stringify(privateLogLines.slice(0,5)));
  console.log(checks+' Transaction date parity groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo){try{await mongo.stop()}catch(e){console.error('CLEANUP mongod stop slow: '+String(e?.message||e).slice(0,200))}}if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});

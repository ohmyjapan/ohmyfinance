// Transaction export on the actual built application: owned throwaway MongoDB, synthetic companies A (Asia/Tokyo), B (America/New_York)
// and C (no saved zone), synthetic rows, simulated worker replies and, when asked, installed Chrome headless. No model, provider,
// network, SMTP/Slack or business sends. The first section prints a non-throwing PROBE ledger for the fail-first legs; every later
// group asserts under its own label.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const {createRequire}=require('node:module');
const root=path.resolve(process.env.OMF_EXPORT_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const EXPENSE='\u652f\u51fa',INCOME='\u5165\u91d1';
const HEADER='取引ID,参照番号,日付,区別,ステータス,金額,勘定科目,補助科目,税区分,税率,仕入れ先,顧客,区分,法人情報,インボイス番号,領収書番号,商品名,商品価格,JANコード,領収書,備考,タグ,貸方勘定科目（カード）,貸方補助科目（カード）,貸方税区分（カード）';
const TOOL='prepare_company_transaction_export';
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-transaction-export-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),SETUP_READY_MS=300000,mongoStarted=Date.now();mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});console.log('TIMING '+JSON.stringify({mongoMs:Date.now()-mongoStarted}));
  const dbName='transaction_export_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-20000)});
  let healthy=false;for(let i=0;i<120;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);
  client=await MongoClient.connect(uri);const db=client.db(dbName);
  const api=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),bytes=Buffer.from(await r.arrayBuffer()),raw=bytes.toString('utf8');let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw,bytes,headers:r.headers}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'export:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const register=async email=>(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic export user'})).tokens.accessToken;
  const ownerToken=await register('export-owner@example.invalid'),owner=(await db.collection('users').findOne({email:'export-owner@example.invalid'}))._id;
  const A=new ObjectId(),B=new ObjectId(),C=new ObjectId(),now=new Date(),members=[{userId:owner,role:'owner',joinedAt:now}];
  await db.collection('organizations').insertMany([
   {_id:A,name:'Synthetic export A',slug:'export-a',type:'business',isActive:true,members,settings:{defaultCurrency:'JPY',fiscalYearStart:11,timezone:'Asia/Tokyo'}},
   {_id:B,name:'PRIVATE export B',slug:'export-b',type:'business',isActive:true,members,settings:{defaultCurrency:'USD',fiscalYearStart:1,timezone:'America/New_York'}},
   {_id:C,name:'Synthetic export C',slug:'export-c',type:'business',isActive:true,members}]);
  const switchTo=async id=>(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(id)})).tokens.accessToken,tokenA=await switchTo(A),tokenB=await switchTo(B),tokenC=await switchTo(C);
  const account=(await ok('/api/finance/accounts',ownerToken,'POST',{name:'Synthetic export card',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);assert.equal((await worker('heartbeat')).status,200);
  const endpoint='/api/finance-chat/company-workspace',chats=db.collection('financecompanyassistants');
  const ask=async(token,text,context={page:'transactions'})=>{const view=await ok(endpoint,token);assert.equal((await worker('heartbeat')).status,200,'SETUP positive worker heartbeat');return ok(endpoint,token,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.conversation?.revision||0,text,context})};
  const claim=async()=>{assert.equal((await worker('heartbeat')).status,200);const r=await worker('workspace-claim');assert.equal(r.status,200,'export:claim '+r.raw.slice(0,300));assert.ok(r.data.job,'export:claimed');return r.data.job};
  const act=(job,name,args={},slot=1)=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const actOk=async(job,name,args={},slot=1,label=name)=>{const r=await act(job,name,args,slot);assert.equal(r.status,200,'export:'+label+' '+r.raw.slice(0,500));return r.data};
  const finish=async job=>assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic export reply',patch:{},quotes:{}}})).status,200);
  const turn=async(token,text,context)=>{await ask(token,text,context);return claim()};
  const receiptsOf=async(job,operationId)=>(await actOk(job,'get_company_action_status',operationId?{operationId}:{})).result.receipts;
  const setOp=async(job,operationId,values)=>{const u=await chats.updateOne({_id:new ObjectId(job.id)},{$set:Object.fromEntries(Object.entries(values).map(([k,v])=>['turns.$[turn].actions.$[action].'+k,v]))},{arrayFilters:[{'turn.actions.operationId':operationId},{'action.operationId':operationId}]});assert.equal(u.modifiedCount,1,'SETUP journal edit')};
  const revoke=on=>db.collection('organizations').updateOne({_id:A},{$set:{members:on?[]:members}});
  const role=r=>db.collection('organizations').updateOne({_id:A},{$set:{'members.0.role':r}});

  // ---- Seed: references through the native routes, rows at the zone boundaries, literal cells and a zero price.
  const customer=String((await ok('/api/customers',tokenA,'POST',{name:'EXPORT_CUSTOMER',email:'synthetic@example.invalid'}))._id),supplier=String((await ok('/api/suppliers',tokenA,'POST',{name:'EXPORT_SUPPLIER'}))._id);
  const accountCategory=String((await ok('/api/account-categories',tokenA,'POST',{name:'EXPORT_ACCOUNT',type:'expense',code:'EXP'}))._id),transactionCategory=String((await ok('/api/transaction-categories',tokenA,'POST',{name:'EXPORT_CATEGORY'}))._id);
  const tx=db.collection('transactions'),t=o=>({_id:new ObjectId(),referenceNumber:'EXP-'+crypto.randomBytes(3).toString('hex'),hasReceipt:false,items:[],timeline:[],attachments:[],tags:[],createdAt:now,updatedAt:now,...o});
  const rows={
   late:t({organizationId:A,date:new Date('2026-10-31T14:30:00Z'),amount:1001,type:EXPENSE,status:'completed',productName:'EXPORT_LATE_JST',hasReceipt:true,referenceNumber:'EXP-LATE'}),
   midnight:t({organizationId:A,date:new Date('2026-10-31T15:00:00Z'),amount:1002,type:EXPENSE,status:'completed',productName:'EXPORT_MIDNIGHT_JST'}),
   utcMidnight:t({organizationId:A,date:new Date('2026-11-01T00:00:00Z'),amount:1003,type:INCOME,status:'completed',productName:'EXPORT_UTC_MIDNIGHT'}),
   morning:t({organizationId:A,date:new Date('2026-10-31T10:00:00Z'),amount:1004,type:EXPENSE,status:'pending',productName:'EXPORT_MORNING'}),
   zero:t({organizationId:A,date:new Date('2026-10-15T03:00:00Z'),amount:1005,type:EXPENSE,status:'completed',productName:'=SUM(1)',productPrice:0}),
   quoted:t({organizationId:A,date:new Date('2026-10-10T03:00:00Z'),amount:1006,type:EXPENSE,status:'failed',productName:'ノート,"引用"',productPrice:250}),
   beforePeriod:t({organizationId:A,date:new Date('2025-10-31T14:59:59.999Z'),amount:1007,type:EXPENSE,status:'completed',productName:'EXPORT_BEFORE_PERIOD'}),
   periodFirst:t({organizationId:A,date:new Date('2025-10-31T15:00:00Z'),amount:1008,type:EXPENSE,status:'completed',productName:'EXPORT_PERIOD_FIRST'}),
   refs:t({organizationId:A,date:new Date('2026-09-01T03:00:00Z'),amount:2000,type:EXPENSE,status:'processing',productName:'EXPORT_REFS',invoiceNumber:'INV-EXPORT-7',companyInfo:'EXPORT_COMPANY_INFO',notes:'NOTES_ONLY_TERM',customerId:new ObjectId(customer),supplierId:new ObjectId(supplier),accountCategoryId:new ObjectId(accountCategory),transactionCategoryId:new ObjectId(transactionCategory)}),
   old:t({organizationId:A,date:new Date('2020-01-01T00:00:00Z'),amount:1,type:EXPENSE,status:'completed',productName:'EXPORT_OLD'}),
   bLate:t({organizationId:B,date:new Date('2026-10-31T14:30:00Z'),amount:9001,type:EXPENSE,status:'completed',productName:'PRIVATE_B_LATE'}),
   bMidnight:t({organizationId:B,date:new Date('2026-10-31T15:00:00Z'),amount:9002,type:EXPENSE,status:'completed',productName:'PRIVATE_B_MIDNIGHT'}),
   bUtcMidnight:t({organizationId:B,date:new Date('2026-11-01T00:00:00Z'),amount:9003,type:EXPENSE,status:'completed',productName:'PRIVATE_B_UTC_MIDNIGHT'}),
   bNov1:t({organizationId:B,date:new Date('2026-11-01T05:00:00Z'),amount:9004,type:EXPENSE,status:'completed',productName:'PRIVATE_B_NOV1'}),
   bPeriodFirst:t({organizationId:B,date:new Date('2025-11-01T04:00:00Z'),amount:9005,type:EXPENSE,status:'completed',productName:'PRIVATE_B_PERIOD_FIRST'}),
   bBeforePeriod:t({organizationId:B,date:new Date('2025-11-01T03:59:59.999Z'),amount:9006,type:EXPENSE,status:'completed',productName:'PRIVATE_B_BEFORE_PERIOD'}),
   cLate:t({organizationId:C,date:new Date('2026-10-31T14:30:00Z'),amount:7001,type:EXPENSE,status:'completed',productName:'EXPORT_C_LATE'}),
   cMidnight:t({organizationId:C,date:new Date('2026-10-31T15:00:00Z'),amount:7002,type:EXPENSE,status:'completed',productName:'EXPORT_C_MIDNIGHT'}),
   unassigned:t({date:new Date('2026-10-20T03:00:00Z'),amount:88888,type:EXPENSE,status:'completed',productName:'PRIVATE_UNASSIGNED'})
  };
  await tx.insertMany(Object.values(rows));
  const idOf=k=>String(rows[k]._id),byDateDesc=ks=>ks.map(k=>rows[k]).sort((a,b)=>b.date-a.date).map(r=>String(r._id));
  const within=(org,start,end)=>Object.entries(rows).filter(([,r])=>r.organizationId&&String(r.organizationId)===String(org)&&r.date>=start&&r.date<end).map(([k])=>k);
  // Company-zone truth for 2025-11-01..2026-10-31: Tokyo is UTC+9 all year; New York is EDT (UTC-4) on both local midnights.
  const periodA=byDateDesc(within(A,new Date('2025-10-31T15:00:00Z'),new Date('2026-10-31T15:00:00Z'))),periodB=byDateDesc(within(B,new Date('2025-11-01T04:00:00Z'),new Date('2026-11-01T04:00:00Z')));
  const route='/api/transactions/export',ids=r=>(r.data||[]).map(x=>x.id),q=o=>Object.entries(o).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
  const records=async()=>JSON.stringify(await Promise.all(['transactions','invoices','payments','budgets','recurringpayments','receipts'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const counts=async()=>Object.fromEntries(await Promise.all((await db.listCollections().toArray()).map(c=>c.name).filter(n=>n!=='financecompanyassistants'&&!n.startsWith('system.')).sort().map(async n=>[n,await db.collection(n).countDocuments()])));
  const before=await records();

  // ---- 0. Fail-first ledger (non-throwing): the five legs the plan names must FAIL on the unchanged build.
  const probe=(label,v)=>{console.log((v?'PROBE-OK ':'PROBE-FAIL ')+label);return v};
  {const r=await api(route+'?format=json&dateTo=2026-10-31',tokenA);probe('export:final-day',r.status===200&&ids(r).includes(idOf('late'))&&!ids(r).includes(idOf('midnight')))}
  {const r=await api(route+'?format=json&search='+encodeURIComponent('ノート'),tokenA);probe('export:search',r.status===200&&JSON.stringify(ids(r))===JSON.stringify([idOf('quoted')]))}
  {const r=await api(route+'?format=json',tokenA);probe('export:zero-price',r.status===200&&(r.data||[]).find(x=>x.id===idOf('zero'))?.productPrice===0)}
  {const job=await turn(tokenA,'Probe the catalogue',{page:'transactions'});probe('export:tool-carried',job.tools.some(x=>x.name===TOOL));await finish(job)}
  {const dir=path.join(root,'.output/public/_nuxt');let found=false;for(const f of await fsp.readdir(dir))if(f.endsWith('.js')&&(await fsp.readFile(path.join(dir,f),'utf8')).includes('data-transactions-export')){found=true;break}probe('export:page-button',found)}

  // ---- 1. Route: the final local day, zones, period, legacy instant
  let r=await api(route+'?format=json&dateTo=2026-10-31',tokenA);assert.equal(r.status,200,'export:route '+r.raw.slice(0,300));
  assert.ok(ids(r).includes(idOf('late')),'export:final-day');assert.ok(!ids(r).includes(idOf('midnight'))&&!ids(r).includes(idOf('utcMidnight')),'export:final-day');
  r=await ok(route+'?format=json&dateFrom=2026-10-31&dateTo=2026-10-31',tokenA);assert.deepEqual(r.map(x=>x.id),byDateDesc(['late','morning']),'export:final-day');
  r=await ok(route+'?format=json&dateFrom=2026-11-01',tokenA);assert.deepEqual(r.map(x=>x.id),byDateDesc(['utcMidnight','midnight']),'export:first-day');
  r=await ok(route+'?format=json&dateTo=2026-10-31',tokenB);assert.deepEqual(r.map(x=>x.id),byDateDesc(['bUtcMidnight','bMidnight','bLate','bPeriodFirst','bBeforePeriod']),'export:final-day-new-york');
  r=await ok(route+'?format=json&dateFrom=2026-11-01',tokenB);assert.deepEqual(r.map(x=>x.id),[idOf('bNov1')],'export:utc-midnight-previous-local-day');
  r=await ok(route+'?format=json&dateTo=2026-10-31',tokenC);assert.ok(r.map(x=>x.id).includes(idOf('cLate'))&&!r.map(x=>x.id).includes(idOf('cMidnight')),'export:default-zone');
  r=await ok(route+'?format=json&dateFrom=2025-11-01&dateTo=2026-10-31',tokenA);assert.deepEqual(r.map(x=>x.id),periodA,'export:period');assert.equal(periodA.length,6,'export:period-truth');
  r=await ok(route+'?format=json&dateFrom=2025-11-01&dateTo=2026-10-31',tokenB);assert.deepEqual(r.map(x=>x.id),periodB,'export:period');assert.equal(periodB.length,4,'export:period-truth');
  r=await ok(route+'?format=json&dateTo='+encodeURIComponent('2026-10-31T12:00:00.000Z'),tokenA);assert.ok(r.map(x=>x.id).includes(idOf('morning'))&&!r.map(x=>x.id).includes(idOf('late')),'export:legacy-instant');
  pass('final local day of the saved zone kept for Tokyo, New York (UTC-midnight row on its previous local day asserted) and the default zone; period truth; a non-key dateTo keeps the legacy instant');

  // ---- 2. Route: every page filter, search parity, category, zero price, literal cells, header-only, formats
  const expectIds=async(query,expected,label)=>{const d=await ok(route+'?format=json&'+query,tokenA);assert.deepEqual(d.map(x=>x.id),expected,label+' '+query)};
  await expectIds('search='+encodeURIComponent('ノート'),[idOf('quoted')],'export:search');await expectIds('search=inv-export',[idOf('refs')],'export:search');await expectIds('search=EXPORT_COMPANY',[idOf('refs')],'export:search');
  await expectIds('search=1003',[idOf('utcMidnight')],'export:search');await expectIds('search=EXP-LATE',[idOf('late')],'export:search');await expectIds('search='+idOf('quoted'),[idOf('quoted')],'export:search');
  await expectIds('search=NOTES_ONLY_TERM',[],'export:search-page-parity');await expectIds('search=NOPE',[],'export:search');
  await expectIds('transactionCategoryId='+transactionCategory,[idOf('refs')],'export:category');
  await expectIds('status=pending',[idOf('morning')],'export:filter');await expectIds('type='+encodeURIComponent(INCOME),[idOf('utcMidnight')],'export:filter');await expectIds('minAmount=1005&maxAmount=1006',byDateDesc(['zero','quoted']),'export:filter');
  await expectIds('hasReceipt=true',[idOf('late')],'export:filter');await expectIds('hasReceipt=false',byDateDesc(Object.keys(rows).filter(k=>rows[k].organizationId&&String(rows[k].organizationId)===String(A)&&k!=='late')),'export:filter');
  for(const [k,v] of [['customerId',customer],['supplierId',supplier],['accountCategoryId',accountCategory]])await expectIds(k+'='+v,[idOf('refs')],'export:filter');
  await expectIds('search=EXPORT_&status=completed&dateFrom=2026-10-01&dateTo=2026-10-31',[idOf('late')],'export:filter-combined');
  const jsonAll=await ok(route+'?format=json',tokenA);assert.equal(jsonAll.find(x=>x.id===idOf('zero')).productPrice,0,'export:zero-price');assert.equal(jsonAll.find(x=>x.id===idOf('quoted')).productName,'ノート,"引用"');
  const csv=await api(route+'?format=csv',tokenA);assert.equal(csv.status,200);assert.ok(/,=SUM\(1\),0,,/.test(csv.raw),'export:zero-price');assert.ok(csv.raw.includes('"ノート,""引用"""'),'export:literal-cells');assert.ok(csv.raw.includes(',=SUM(1),'),'export:literal-cells');
  assert.ok(csv.raw.startsWith(HEADER+'\n'),'export:header');assert.equal((await api(route+'?format=csv&search=NOPE',tokenA)).raw,HEADER,'export:empty-header-only');
  for(const format of['csv','excel','xlsx','json','json-full','unknown']){const x=await api(route+'?format='+format,tokenA);assert.equal(x.status,200,'export:format '+format);assert.ok(!x.raw.includes('PRIVATE_'),'export:scope '+format);assert.ok(x.raw.includes('EXPORT_LATE_JST'),'export:format '+format);assert.equal(x.headers.get('cache-control'),'no-store','export:no-cache');if(format==='json-full')assert.deepEqual(x.data.map(y=>y._id),byDateDesc(['utcMidnight','midnight','late','morning','zero','quoted','refs','periodFirst','beforePeriod','old']),'export:json-full');if(['excel','xlsx'].includes(format))assert.equal(x.bytes.subarray(0,3).toString('hex'),'efbbbf','export:bom')}
  await expectIds('organizationId='+B+'&minAmount=1005&maxAmount=1006',byDateDesc(['zero','quoted']),'export:organization-ignored');
  pass('every page filter and search through the shared predicate (notes never match), transactionCategoryId, zero price kept, literal cells, header-only on no match, formats/BOM/no-store/organizationId-ignored kept');

  // ---- 3. Route: membership and no writes
  await revoke(true);assert.equal((await api(route+'?format=csv',tokenA)).status,403,'export:current-membership');await revoke(false);assert.equal((await api(route+'?format=csv',ownerToken)).status,403,'export:no-company');assert.equal((await api(route+'?format=csv',null)).status,401,'export:unauthenticated');
  assert.equal(await records(),before,'export:route-no-writes');
  pass('a revoked member, no selected company and no token are refused; the route writes nothing');

  // ---- 4. Navi: tool carried, done receipt with the frozen recipe and count, no row content, idempotency, lost reply, zero, bad range
  const countsBefore=await counts();
  let job=await turn(tokenA,'Export the fiscal year as CSV.',{page:'transactions'});
  const tool=job.tools.find(x=>x.name===TOOL);assert.ok(tool,'export:tool-carried');assert.deepEqual(tool.inputSchema.required,['format'],'export:tool-carried');assert.equal(tool.inputSchema.additionalProperties,false);
  const criteria={dateFrom:'2025-11-01',dateTo:'2026-10-31'};r=await actOk(job,TOOL,{format:'csv',...criteria},1,'prepare');
  assert.equal(r.receipt.state,'done','export:receipt');assert.equal(r.receipt.name,TOOL);assert.deepEqual(r.receipt.detail,{format:'csv',criteria},'export:receipt-detail');assert.equal(r.receipt.nativeResourceIds.exportId,r.receipt.operationId,'export:receipt-id');assert.deepEqual(r.receipt.target,{exportId:r.receipt.operationId},'export:receipt-target');
  const ex=r.result.export;assert.equal(ex.exportId,r.receipt.operationId);assert.equal(ex.format,'csv');assert.deepEqual(ex.criteria,criteria);assert.equal(ex.matchedCount,periodA.length,'export:matched-count');
  assert.deepEqual(ex.window,{start:'2025-10-31T15:00:00.000Z',end:'2026-10-31T14:59:59.999Z',timeZone:'Asia/Tokyo',timeZoneEvidence:'saved'},'export:window');assert.equal(ex.delivery,'browser_download_from_the_conversation_card');assert.equal(ex.snapshot,'none_recipe_for_current_matching_records');
  const raw=JSON.stringify(r);for(const secret of['EXPORT_','=SUM(1)','ノート','NOTES_ONLY_TERM','INV-EXPORT-7','EXP-LATE','"rows"','"transactions"'])assert.ok(!raw.includes(secret),'export:no-content-in-result '+secret);
  const operationId=r.receipt.operationId;assert.equal((await actOk(job,TOOL,{format:'csv',...criteria},2)).receipt.operationId,operationId,'export:same-intent-same-receipt');assert.equal((await act(job,TOOL,{format:'json',...criteria},1)).status,409,'export:slot-meaning');
  await setOp(job,operationId,{state:'claimed'});let fresh=(await receiptsOf(job,operationId))[0];assert.equal(fresh.state,'done','export:lost-reply-done');assert.equal(fresh.nativeResourceIds?.exportId,operationId,'export:lost-reply-done');assert.deepEqual(fresh.detail,{format:'csv',criteria},'export:lost-reply-detail');
  await setOp(job,operationId,{state:'claimed',leaseUntil:new Date(0),lease:'expired'});fresh=(await receiptsOf(job,operationId))[0];assert.equal(fresh.state,'done','export:lost-reply-done');
  r=await actOk(job,TOOL,{format:'json',dateFrom:'2019-01-01',dateTo:'2019-12-31'},3,'zero');assert.equal(r.receipt.state,'done','export:zero-matches');assert.equal(r.result.export.matchedCount,0,'export:zero-matches');
  r=await actOk(job,TOOL,{format:'csv',search:'ノート'},4,'search');assert.equal(r.result.export.matchedCount,1,'export:search-criteria');assert.deepEqual(r.receipt.detail.criteria,{search:'ノート'});
  r=await actOk(job,TOOL,{format:'csv',transactionCategoryId:transactionCategory,hasReceipt:false,minAmount:0},5,'category');assert.equal(r.result.export.matchedCount,1,'export:category-criteria');
  assert.equal((await act(job,TOOL,{format:'csv',dateFrom:'2026-10-31',dateTo:'2026-10-01'},6)).status,400,'export:bad-range');const failed=(await receiptsOf(job)).find(x=>x.name===TOOL&&x.state==='failed');assert.ok(failed,'export:bad-range');assert.equal(failed.recoveryOwner,'model','export:bad-range');assert.deepEqual(failed.detail,{format:'csv',criteria:{dateFrom:'2026-10-31',dateTo:'2026-10-01'}});
  for(const bad of[{format:'xlsx'},{format:'csv',organizationId:String(B)},{format:'csv',sourceId:String(new ObjectId())},{format:'csv',dateFrom:'2026-02-30'},{format:'csv',status:'open'},{format:'csv',search:'x'.repeat(101)},{}])assert.equal((await act(job,TOOL,bad,20)).status,400,'export:invalid-args '+JSON.stringify(bad));
  assert.equal((await receiptsOf(job)).filter(x=>x.slot===20).length,0,'export:invalid-args-no-receipt');
  await revoke(true);assert.equal((await act(job,TOOL,{format:'csv'},7)).status,403,'export:revoked');await revoke(false);
  const entry=(await chats.findOne({_id:new ObjectId(job.id)})).turns.flatMap(x=>x.actions||[]).find(x=>x.operationId===operationId);assert.equal(entry.resourceKind,'export','export:journal-entry');assert.deepEqual(entry.detail,{format:'csv',criteria},'export:journal-entry');assert.equal(entry.state,'done');assert.equal(entry.resourceId,operationId);
  await finish(job);
  await role('viewer');job=await turn(tokenA,'Viewer export',{page:'transactions'});r=await actOk(job,TOOL,{format:'json'},1,'viewer');assert.equal(r.receipt.state,'done','export:viewer-allowed');await finish(job);await role('owner');
  job=await turn(tokenC,'Other company export',{page:'transactions'});r=await actOk(job,TOOL,{format:'csv',...criteria},1,'other-company');assert.equal(r.result.export.matchedCount,byDateDesc(within(C,new Date('2025-10-31T15:00:00Z'),new Date('2026-10-31T15:00:00Z'))).length,'export:other-company');assert.equal(r.result.export.window.timeZoneEvidence,'not_saved_default_Asia/Tokyo','export:other-company-default-zone');
  assert.equal((await receiptsOf(job,operationId)).length,0,'export:other-company-sees-nothing');assert.ok(!JSON.stringify(await receiptsOf(job)).includes(operationId),'export:other-company-sees-nothing');await finish(job);
  assert.equal(await records(),before,'export:records-unchanged');assert.deepEqual(await counts(),countsBefore,'export:journal-only');
  pass('Navi: tool carried; done receipt with frozen recipe, count and window and no row content; same intent coalesces, changed slot refused; lost reply and expired lease reconcile done; zero matches done; bad range a failed receipt; invalid args 400 without a receipt; revoked refused; viewer allowed; another company sees nothing; records hash-identical and only the journal changed');

  // ---- 5. Installed Chrome: the page button and the conversation card download exactly the route's bytes; nothing downloads by itself
  if(process.env.OMF_TRANSACTION_EXPORT_BROWSER==='1'){
   let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
   const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(fs.existsSync);assert.ok(executablePath,'Installed Chrome required');
   const downloads=path.join(directory,'downloads');await fsp.mkdir(downloads);let browser,page;const errors=[];
   const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<300;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('export-ui:'+label)};
   const files=async()=>(await fsp.readdir(downloads)).filter(n=>n.endsWith('.csv')).sort();
   // Both controls name the file transactions_<date>.csv and the CDP download behaviour writes over a same-named file: empty the
   // directory before a click so the delivered file is always new.
   const clearDownloads=async()=>{for(const n of await fsp.readdir(downloads))await fsp.rm(path.join(downloads,n),{force:true})};
   // The bytes a click delivered: the file the download landed as, or, when headless Chrome leaves no file for an object-URL click
   // (the plan's named fallback), the body of the export request the page made after the click. A failure names what the page shows.
   // Chrome retains no body for a response the page consumed as a Blob, so the export responses and download events are diagnostics
   // only: the delivered bytes are the file the download landed as.
   const exportResponses=[],downloadEvents=[];
   const downloaded=async(known,since)=>{for(let i=0;i<150;i++){const f=(await files()).find(n=>!known.includes(n));if(f){console.log('NOTE export-ui:download landed as a file');return fsp.readFile(path.join(downloads,f))}await pause(100)}
    const since_=exportResponses.filter(x=>x.at>=since),errorText=await page.evaluate(()=>document.querySelector('[data-transactions-export-error]')?.textContent||null);
    throw Error('export-ui:download '+JSON.stringify({responses:since_.map(x=>({status:x.status,bytes:x.bytes?x.bytes.length:null})),downloadEvents:downloadEvents.filter(x=>x.at>=since).map(x=>x.event),errorText,pageErrors:errors}))};
   const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(organizationId));
   const set=(selector,value)=>page.$eval(selector,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},value);
   const say=async text=>{await worker('heartbeat');await wait(()=>document.querySelector('#assistant-message')&&!document.querySelector('#assistant-message').disabled&&document.querySelector('[data-assistant-send]'),[],'composer-ready');await page.$eval('#assistant-message',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))},text);
    const accepted=page.waitForResponse(x=>{const u=x.request();if(u.method()!=='POST'||new URL(x.url()).pathname!==endpoint)return false;try{return JSON.parse(u.postData()||'{}').text===text}catch{return false}},{timeout:30000});accepted.catch(()=>{});
    await page.evaluate(()=>document.querySelector('[data-assistant-send]').click());await wait(()=>document.querySelector('#assistant-message')?.disabled,[],'sent');assert.equal((await accepted).status(),200,'export-ui:send-accepted');return claim()};
   try{
    // Chrome blocks the second gesture-less download from one origin (its automatic-downloads setting); this test clicks through
    // page.evaluate, so the throwaway profile allows them, as a person's own click does by carrying a gesture.
    const profile=path.join(directory,'profile');await fsp.mkdir(path.join(profile,'Default'),{recursive:true});await fsp.writeFile(path.join(profile,'Default','Preferences'),JSON.stringify({profile:{default_content_setting_values:{automatic_downloads:1}},download:{prompt_for_download:false}}));
    browser=await puppeteer.launch({executablePath,userDataDir:profile,pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
    page=await browser.newPage();await page.setViewport({width:390,height:844});const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    try{const bcdp=await browser.target().createCDPSession();await bcdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});bcdp.on('Browser.downloadWillBegin',e=>downloadEvents.push({at:Date.now(),event:'begin '+e.suggestedFilename}));bcdp.on('Browser.downloadProgress',e=>{if(e.state!=='inProgress')downloadEvents.push({at:Date.now(),event:e.state})})}catch(e){console.log('NOTE Browser.setDownloadBehavior unavailable: '+String(e.message).slice(0,120))}
    page.on('response',r=>{let p;try{p=new URL(r.url()).pathname}catch{return}if(p!==route)return;const at=Date.now(),url=r.url();r.buffer().then(b=>exportResponses.push({at,url,status:r.status(),bytes:b}),()=>exportResponses.push({at,url,status:r.status(),bytes:null}))});
    page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{errors.push(d.message());d.dismiss().catch(()=>{})});
    await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email','export-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
    await nativeSwitch(A);await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await wait(()=>location.pathname==='/transactions'&&!!document.querySelector('tbody tr'),[],'transactions-page');
    assert.ok(await page.$('[data-transactions-export]'),'export:page-button');
    const rect=await page.$eval('[data-transactions-export]',e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right,width:b.width,height:b.height,disabled:e.disabled}});assert.ok(rect.width>0&&rect.height>0&&rect.left>=0&&rect.right<=390&&!rect.disabled,'export:page-button-reachable-390 '+JSON.stringify(rect));
    // The page's own search box and table ([data-page-content]): the layout header carries a global search input before it.
    await set('[data-page-content] input[type="text"]','EXPORT_');await wait(()=>Array.from(document.querySelectorAll('[data-page-content] tbody tr')).every(x=>x.textContent.includes('EXPORT_')),[],'search-applied');
    await page.evaluate(()=>Array.from(document.querySelectorAll('[data-page-content] button')).find(b=>b.textContent.includes('詳細フィルター')).click());await wait(()=>document.querySelectorAll('[data-page-content] input[type="date"]').length===2,[],'advanced-filters');
    await page.$$eval('[data-page-content] input[type="date"]',(es,v)=>es.forEach((e,i)=>{e.value=v[i];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}),['2026-10-01','2026-10-31']);
    // Page filter: dateFrom is UTC midnight, dateTo the browser-local end of day; with search EXPORT_ that is late and morning.
    await wait(()=>document.querySelectorAll('[data-page-content] tbody tr').length===2,[],'date-filter-applied');
    await clearDownloads();let known=[],since=Date.now();await page.evaluate(()=>document.querySelector('[data-transactions-export]').click());const buttonBytes=await downloaded(known,since);
    console.log('NOTE export-ui: page button download events: '+JSON.stringify(downloadEvents.filter(x=>x.at>=since).map(x=>x.event)));
    const direct=await api(route+'?'+q({format:'csv',search:'EXPORT_',dateFrom:'2026-10-01',dateTo:'2026-10-31'}),tokenA);assert.equal(direct.status,200);assert.ok(direct.raw.includes('EXPORT_LATE_JST')&&direct.raw.includes('EXPORT_MORNING')&&direct.raw.split('\n').length===3,'export:page-button-recipe');
    assert.equal(Buffer.compare(buttonBytes,direct.bytes),0,'export:page-button');assert.equal(await page.$('[data-transactions-export-error]'),null,'export:page-button-no-error');
    // The conversation card: a done export receipt shows a download control; nothing downloads until it is clicked.
    await page.evaluate(()=>{const x=document.querySelector('[data-assistant-toggle]');if(x.getAttribute('aria-expanded')!=='true')x.click()});await wait(()=>document.querySelector('[data-assistant-company-status]')?.textContent.includes('Synthetic export A'),[],'company-chat');
    const cardCriteria={dateFrom:'2026-10-01',dateTo:'2026-10-31'};let cardJob=await say('10月の取引をCSVで出力して。');assert.equal(cardJob.context.page,'transactions');await actOk(cardJob,TOOL,{format:'csv',...cardCriteria});await finish(cardJob);
    // The control of THIS turn: the same company conversation already carries the done export receipts of the Navi group above,
    // each with its own control for its own recipe, so the card job's turn is found by its prompt text.
    const cardTurn='10月の取引をCSVで出力して。';
    await wait(t=>!!Array.from(document.querySelectorAll('[data-workspace-turn]')).find(x=>x.textContent.includes(t))?.querySelector('[data-workspace-actions] [data-export-download]'),[cardTurn],'card-control');known=await files();await pause(1500);assert.deepEqual(await files(),known,'export:no-download-without-click');
    // A person's click: real input events carry the user activation Chrome wants before a second download from the same origin.
    await clearDownloads();known=[];since=Date.now();const cardControl=(await page.evaluateHandle(t=>Array.from(document.querySelectorAll('[data-workspace-turn]')).find(x=>x.textContent.includes(t)).querySelector('[data-workspace-actions] [data-export-download]'),cardTurn)).asElement();assert.ok(cardControl,'export-ui:card-control-handle');await cardControl.click();const cardBytes=await downloaded(known,since);
    const recipe=await api(route+'?'+q({format:'csv',...cardCriteria}),tokenA);await pause(300);
    console.log('NOTE export-ui: card export requests: '+JSON.stringify(exportResponses.filter(x=>x.at>=since).map(x=>x.url.replace(origin,'')+' -> '+x.status))+'; card file rows '+cardBytes.toString('utf8').split('\n').length+', recipe rows '+recipe.raw.split('\n').length);
    assert.equal(Buffer.compare(cardBytes,recipe.bytes),0,'export:card-download '+cardBytes.length+' vs '+recipe.bytes.length+' bytes');assert.ok(recipe.raw.split('\n').length>2,'export:card-download-rows');
    await wait(()=>document.querySelector('[data-assistant-new-chat]')&&!document.querySelector('[data-assistant-new-chat]').disabled,[],'new-chat-ready');await page.evaluate(()=>document.querySelector('[data-assistant-new-chat]').click());await wait(()=>document.querySelectorAll('[data-workspace-turn]').length===0,[],'new-chat');
    await page.evaluate(()=>document.querySelector('[data-assistant-history-toggle]').click());await wait(()=>!!document.querySelector('[data-archive-item]'),[],'history-list');await page.evaluate(()=>document.querySelector('[data-archive-item]').click());await wait(()=>document.querySelectorAll('[data-archived-turn]').length>0,[],'archive-open');
    assert.ok(await page.$('[data-archived-turn] [data-export-download]'),'export:card-archive');
    known=await files();await nativeSwitch(B);await wait(()=>document.querySelector('[data-assistant-company-status]')?.textContent.includes('PRIVATE export B'),[],'switched-company');await pause(1000);
    assert.equal(await page.$('[data-export-download]'),null,'export:card-absent-after-switch');assert.deepEqual(await files(),known,'export:no-download-without-click');
    assert.deepEqual(errors,[],'export-ui:page-errors');
    pass('installed Chrome at 390px: the page button downloads exactly the route bytes for the page filters; the done receipt shows a download control that fetches the recipe only on a click, also in the archive; after a company switch no control and no download');
   }finally{if(browser)await browser.close()}
  }else console.log('Browser leg not requested (OMF_TRANSACTION_EXPORT_BROWSER unset)');
  // Row content never reaches the server log. The existing request-line logger ('[API] GET <path?query>') echoes the URL this test
  // itself sent (search=NOTES_ONLY_TERM in group 2); that is the request, not a record, and is not what this assertion guards.
  const privateLogLines=logs.split('\n').filter(l=>!/^\[API\] [A-Z]+ \//.test(l)&&(l.includes('NOTES_ONLY_TERM')||l.includes('=SUM(1)'))).map(l=>l.slice(0,300));
  assert.ok(privateLogLines.length===0,'export:no-private-logs '+JSON.stringify(privateLogLines.slice(0,5)));
  console.log(checks+' Transaction export groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo){try{await mongo.stop()}catch(e){console.error('CLEANUP mongod stop slow: '+String(e?.message||e).slice(0,200))}}if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});

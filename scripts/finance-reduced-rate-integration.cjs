// Reduced-rate (軽減税率) mark on the actual built application (plan omf-keigen-mark-20261030 §4): owned throwaway MongoDB,
// synthetic company A (Asia/Tokyo), the seed tax categories and one rate-less tax category through the native routes, synthetic rows
// R1-R9 and, when asked, installed Chrome headless. No model, provider, network, SMTP/Slack or business sends. The first section
// prints a non-throwing PROBE ledger for the fail-first legs; every later group asserts under its own label.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const {createRequire}=require('node:module');
const root=path.resolve(process.env.OMF_REDUCED_RATE_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const EXPENSE='\u652f\u51fa',INCOME='\u5165\u91d1',MARK='※軽減';
const HEADER='取引ID,参照番号,日付,区別,ステータス,金額,勘定科目,補助科目,税区分,税率,軽減税率,仕入れ先,顧客,区分,法人情報,インボイス番号,領収書番号,商品名,商品価格,JANコード,領収書,備考,タグ,貸方勘定科目（カード）,貸方補助科目（カード）,貸方税区分（カード）';
// RFC 4180 cells of one CSV text (the route quotes a cell holding a comma, quote or line break).
const parseCsv=text=>{const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);rows.push(row);return rows};
async function main(){let mongo,child,client,directory,logs='',checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-reduced-rate-'));const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),SETUP_READY_MS=300000,mongoStarted=Date.now();mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:SETUP_READY_MS}});console.log('TIMING '+JSON.stringify({mongoMs:Date.now()-mongoStarted}));
  const dbName='reduced_rate_mark_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  const appStarted=Date.now();child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const s of[child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-20000)});
  let healthy=false;for(let i=0;i<1500;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,dbName);healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned database '+logs);console.log('TIMING '+JSON.stringify({appMs:Date.now()-appStarted}));
  client=await MongoClient.connect(uri);const db=client.db(dbName);
  const api=async(route,token,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}),bytes=Buffer.from(await r.arrayBuffer()),raw=bytes.toString('utf8');let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw,bytes,headers:r.headers}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'reduced-rate:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const email='reduced-rate-owner@example.invalid',password='Synthetic-password-Only1!';
  const ownerToken=(await ok('/api/auth/register',null,'POST',{email,password,name:'Synthetic reduced-rate user'})).tokens.accessToken,owner=(await db.collection('users').findOne({email}))._id;
  const A=new ObjectId(),now=new Date();
  await db.collection('organizations').insertOne({_id:A,name:'Synthetic reduced-rate A',slug:'reduced-rate-a',type:'business',isActive:true,members:[{userId:owner,role:'owner',joinedAt:now}],settings:{defaultCurrency:'JPY',fiscalYearStart:11,timezone:'Asia/Tokyo'}});
  const tokenA=(await ok('/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(A)})).tokens.accessToken;

  // ---- Seed: the 7 seed tax categories and one rate-less tax category through the native routes; rows R1-R9 on company A.
  const seeded=await ok('/api/seed',tokenA,'POST',{});assert.equal(seeded.results?.taxCategories?.created,7,'SETUP seed tax categories '+JSON.stringify(seeded.results));
  const rateless=await ok('/api/tax-categories',tokenA,'POST',{name:'RR_RATELESS_CATEGORY'});assert.equal(rateless.rate,undefined,'SETUP rate-less tax category');
  const categories=await ok('/api/tax-categories',tokenA),categoryId=name=>{const c=categories.find(x=>x.name===name);assert.ok(c,'SETUP tax category '+name);return new ObjectId(String(c._id))};
  assert.equal(categories.find(x=>x.name==='課税仕入(軽減)').rate,8);assert.equal(categories.find(x=>x.name==='課税売上(軽減)').rate,8);assert.equal(categories.find(x=>x.name==='課税仕入').rate,10);
  const tx=db.collection('transactions'),t=(label,o)=>({_id:new ObjectId(),organizationId:A,referenceNumber:'RR-'+label,amount:1080,type:EXPENSE,status:'completed',productName:'RR_'+label+'_PRODUCT',hasReceipt:false,items:[],timeline:[],attachments:[],tags:[],notes:'',createdAt:now,updatedAt:now,...o});
  // label -> [row, expected mark]
  const rows={
   R1:[t('R1',{date:new Date('2026-10-09T03:00:00Z'),taxCategoryId:categoryId('課税仕入(軽減)')}),MARK],
   R2:[t('R2',{date:new Date('2026-10-08T03:00:00Z'),taxCategoryId:categoryId('課税仕入')}),''],
   R3:[t('R3',{date:new Date('2026-10-07T03:00:00Z'),taxRate:8}),MARK],
   R4:[t('R4',{date:new Date('2026-10-06T03:00:00Z')}),''],
   R5:[t('R5',{date:new Date('2026-10-05T03:00:00Z'),taxCategoryId:categoryId('課税仕入'),taxRate:8}),''],
   R6:[t('R6',{date:new Date('2026-10-04T03:00:00Z'),type:INCOME,taxCategoryId:categoryId('課税売上(軽減)')}),MARK],
   R7:[t('R7',{date:new Date('2019-09-30T00:00:00Z'),taxRate:8}),''],
   R8:[t('R8',{date:new Date('2019-10-01T00:00:00Z'),taxRate:8}),MARK],
   R9:[t('R9',{date:new Date('2026-10-03T03:00:00Z'),taxCategoryId:categoryId('RR_RATELESS_CATEGORY'),taxRate:8}),MARK]};
  await tx.insertMany(Object.values(rows).map(([row])=>row));
  const labels=Object.keys(rows),idOf=k=>String(rows[k][0]._id),labelOf=id=>labels.find(k=>idOf(k)===id),route='/api/transactions/export';
  // One assertion per leg names every row whose mark differs, so a defect is reported at each row it moves.
  const mismatches=got=>labels.filter(k=>got[k]!==rows[k][1]).map(k=>k+' expected '+JSON.stringify(rows[k][1])+' got '+JSON.stringify(got[k]));
  const csvMarks=raw=>{const [head,...body]=parseCsv(raw),at=head.indexOf('軽減税率'),got={};for(const cells of body)if(labelOf(cells[0]))got[labelOf(cells[0])]=at<0?undefined:cells[at];return got};
  const jsonMarks=data=>{const got={};for(const x of data||[])if(labelOf(x.id))got[labelOf(x.id)]=x.reducedMark;return got};

  // ---- 0. Fail-first ledger (non-throwing): the legs the plan names must FAIL on the unchanged build.
  const probe=(label,v)=>{console.log((v?'PROBE-OK ':'PROBE-FAIL ')+label);return v};
  {const r=await api(route+'?format=csv',tokenA);probe('reduced-rate:csv-header',r.status===200&&r.raw.startsWith(HEADER+'\n'))}
  {const r=await api(route+'?format=json',tokenA);probe('reduced-rate:json',r.status===200&&mismatches(jsonMarks(r.data)).length===0)}
  {const dir=path.join(root,'.output/public/_nuxt');let found=false;for(const f of await fsp.readdir(dir))if(f.endsWith('.js')&&(await fsp.readFile(path.join(dir,f),'utf8')).includes('data-reduced-rate')){found=true;break}probe('reduced-rate:page-span',found)}

  // ---- L1. CSV: the 軽減税率 column right after 税率; ※軽減 on R1, R3, R6, R8 and R9 only; neighbouring cells as before.
  const csv=await api(route+'?format=csv',tokenA);assert.equal(csv.status,200,'reduced-rate:csv '+csv.raw.slice(0,300));
  assert.ok(csv.raw.startsWith(HEADER+'\n'),'reduced-rate:csv-header '+csv.raw.split('\n')[0]);
  const csvGot=csvMarks(csv.raw);assert.deepEqual(mismatches(csvGot),[],'reduced-rate:csv-cell '+mismatches(csvGot).join("; "));
  {const [head,...body]=parseCsv(csv.raw),cell=(k,h)=>body.find(c=>c[0]===idOf(k))[head.indexOf(h)];
   assert.equal(body.length,labels.length,'reduced-rate:csv-rows');for(const c of body)assert.equal(c.length,head.length,'reduced-rate:csv-width');
   assert.equal(cell('R1','税区分'),'課税仕入(軽減)');assert.equal(cell('R1','税率'),'');assert.equal(cell('R3','税率'),'8%');assert.equal(cell('R5','税区分'),'課税仕入');assert.equal(cell('R5','税率'),'8%');assert.equal(cell('R9','税区分'),'RR_RATELESS_CATEGORY');assert.equal(cell('R1','仕入れ先'),'');assert.equal(cell('R1','商品名'),'RR_R1_PRODUCT')}
  assert.equal((await api(route,tokenA)).raw,csv.raw,'reduced-rate:csv-default-format');
  pass('CSV: header 税率,軽減税率 in place; ※軽減 on R1 (課税仕入(軽減)), R3 (税率 8 only), R6 (課税売上(軽減)), R8 (2019-10-01 JST) and R9 (rate-less 税区分 + 税率 8); none on R2, R4, R5 (課税仕入 + 税率 8), R7 (before 2019-10-01 JST); 税区分/税率/仕入れ先/商品名 cells as before');

  // ---- L2. JSON and Excel (BOM): the same cells; json-full stays the raw rows.
  const json=await ok(route+'?format=json',tokenA);const jsonGot=jsonMarks(json);assert.deepEqual(mismatches(jsonGot),[],'reduced-rate:json '+mismatches(jsonGot).join("; "));
  for(const x of json){const keys=Object.keys(x);assert.equal(keys[keys.indexOf('taxRate')+1],'reducedMark','reduced-rate:json-key-order')}
  for(const format of['excel','xlsx']){const x=await api(route+'?format='+format,tokenA);assert.equal(x.status,200);assert.equal(x.bytes.subarray(0,3).toString('hex'),'efbbbf','reduced-rate:excel-bom');const body=x.raw.replace(/^\ufeff/,'');assert.ok(body.startsWith(HEADER+'\n'),'reduced-rate:excel-header');const got=csvMarks(body);assert.deepEqual(mismatches(got),[],'reduced-rate:excel '+mismatches(got).join("; "));assert.equal(body,csv.raw,'reduced-rate:excel-equals-csv')}
  {const x=await ok(route+'?format=unknown',tokenA);const got=jsonMarks(x);assert.deepEqual(mismatches(got),[],'reduced-rate:default-json '+mismatches(got).join("; "))}
  {const x=await ok(route+'?format=json-full',tokenA);assert.equal(x.length,labels.length);for(const r of x){assert.equal(r.reducedMark,undefined,'reduced-rate:json-full-raw');assert.ok(!('reducedMark' in r),'reduced-rate:json-full-raw')}assert.equal(x.find(r=>String(r._id)===idOf('R1')).taxCategoryId.rate,8,'reduced-rate:json-full-raw')}
  pass('JSON (key reducedMark right after taxRate), Excel and xlsx (BOM, same bytes as the CSV) and the default JSON carry the same marks; json-full stays the raw rows with taxCategoryId.rate');

  // ---- L3/L4. Installed Chrome: each list row's [data-reduced-rate] text; the detail page beside 取引内容 (商品名).
  if(process.env.OMF_REDUCED_RATE_BROWSER==='1'){
   let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
   const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(fs.existsSync);assert.ok(executablePath,'Installed Chrome required');
   let browser,page;const errors=[];
   const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<1200;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('reduced-rate-ui:'+label)};
   const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(organizationId));
   try{
    const profile=path.join(directory,'profile');await fsp.mkdir(profile,{recursive:true});
    browser=await puppeteer.launch({executablePath,userDataDir:profile,pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
    page=await browser.newPage();await page.setViewport({width:390,height:844});
    page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{errors.push(d.message());d.dismiss().catch(()=>{})});
    await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email',email);await page.type('#password',password);await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
    await nativeSwitch(A);await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});
    await wait(n=>location.pathname==='/transactions'&&document.querySelectorAll('[data-page-content] tbody tr').length===n,[labels.length],'transactions-page');
    const listed=await page.$$eval('[data-page-content] tbody tr',trs=>trs.map(tr=>{const spans=[...tr.querySelectorAll('[data-reduced-rate]')];return{text:tr.textContent,spans:spans.map(s=>({text:s.textContent.trim(),line:s.parentElement?s.parentElement.textContent:''}))}}));
    const listGot={},placement=[];for(const x of listed){const k=labels.find(l=>x.text.includes('RR-'+l));if(!k)continue;if(x.spans.length!==1){listGot[k]='spans:'+x.spans.length;continue}listGot[k]=x.spans[0].text;if(!x.spans[0].line.includes('RR_'+k+'_PRODUCT'))placement.push(k)}
    assert.deepEqual(mismatches(listGot),[],'reduced-rate:list '+mismatches(listGot).join("; "));assert.deepEqual(placement,[],'reduced-rate:list-beside-product '+JSON.stringify(placement));
    const detail=async k=>{await page.goto(origin+'/transactions/'+idOf(k),{waitUntil:'networkidle2'});await wait(p=>document.body.textContent.includes(p),['RR_'+k+'_PRODUCT'],'detail-'+k);
     return page.evaluate(p=>{const spans=[...document.querySelectorAll('[data-reduced-rate]')],dd=spans[0]?.closest('dd');return{count:spans.length,text:spans[0]?.textContent.trim(),inProduct:!!dd&&dd.textContent.includes(p),label:dd?.previousElementSibling?.textContent.trim()||null}},'RR_'+k+'_PRODUCT')};
    const d1=await detail('R1');assert.deepEqual(d1,{count:1,text:MARK,inProduct:true,label:'商品名'},'reduced-rate:detail R1 '+JSON.stringify(d1));
    const d2=await detail('R2');assert.deepEqual(d2,{count:1,text:'',inProduct:true,label:'商品名'},'reduced-rate:detail R2 '+JSON.stringify(d2));
    assert.deepEqual(errors,[],'reduced-rate-ui:page-errors');
    pass('installed Chrome at 390px: every /transactions row carries one [data-reduced-rate] on its 取引内容 line, ※軽減 on R1, R3, R6, R8, R9 and empty on R2, R4, R5, R7; /transactions/<R1> shows ※軽減 inside the 商品名 (取引内容) entry, /transactions/<R2> an empty one');
   }finally{if(browser)await browser.close()}
  }else console.log('Browser leg not requested (OMF_REDUCED_RATE_BROWSER unset)');
  console.log(checks+' Reduced-rate mark groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo){try{await mongo.stop()}catch(e){console.error('CLEANUP mongod stop slow: '+String(e?.message||e).slice(0,200))}}if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});

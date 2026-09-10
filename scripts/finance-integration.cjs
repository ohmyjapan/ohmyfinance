const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
 let mongo,child,client,directory,logs='',checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
 try{
  const {HEADERS,parseAmex}=await import('../shared/amex.mjs');
  const csv=rows=>Buffer.from([HEADERS,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const row=(changes={})=>Object.assign(['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1234','',''],changes);
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-finance-test-'));
  const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri('finance_regression'),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{logs=(logs+v).slice(-15000);});
  let healthy=false;for(let i=0;i<100;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,'finance_regression');healthy=true;break;}}catch{}await pause(200);}assert.ok(healthy,'Isolated app health: '+logs);
  client=await MongoClient.connect(uri);const db=client.db('finance_regression');
  async function call(route,{method='GET',token,body,raw=false}={}){
   const response=await fetch(origin+route,{method,headers:{'Content-Type':raw?'text/csv':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
   const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
  }
  const register=async email=>{const r=await call('/api/auth/register',{method:'POST',body:{email,password:'Synthetic-password-Only1!',name:'Finance test'}});assert.equal(r.status,200,JSON.stringify(r));return r.data.tokens.accessToken;};
  const token=await register('finance-a@example.invalid'),other=await register('finance-b@example.invalid');
  const request=(route,body,method='POST')=>call('/api/finance/'+route,{token,body,method});
  assert.equal((await call('/api/finance/accounts')).status,401);assert.equal((await call('/api/finance/collector/accounts')).status,401);pass('finance routes require the correct authorization');
  const input={name:'Synthetic Amex',primaryCard:'12345',cardIdentifiers:['12345','23456'],otpRecipient:'original@example.invalid',otpMailbox:'forwarded@example.invalid'};
  const created=await request('accounts',input);assert.equal(created.status,200,JSON.stringify(created));const account=created.data.account,id=account._id;
  assert.equal((await request('accounts',{...input,cardIdentifiers:{bad:1}})).status,400);
  assert.equal((await request('accounts',input)).status,409);
  const device=await request('collectors',{name:'Test collector',accountIds:[id]});assert.equal(device.status,200);const deviceToken=device.data.token;
  assert.equal((await call('/api/finance/collector/accounts',{token:deviceToken})).data.accounts.length,1);
  assert.equal((await call('/api/finance/accounts',{token:deviceToken})).status,401);
  assert.equal((await call('/api/finance/accounts/'+id+'/sync',{method:'POST',token:other})).status,404);pass('account mapping is unique and collector tokens cannot act as users');
  const bytes=csv([row(),row(),row({4:'23456',2:'Other card',5:'99'}),row({2:'前回分口座振替金額',5:'-2500'})]);
  const qs='?kind=statement&start=2026-07-19&end=2026-08-18';
  async function upload(bytes,query=qs){return call('/api/finance/accounts/'+id+'/imports'+query,{method:'POST',token,body:bytes,raw:true});}
  assert.equal((await upload(csv([row({4:'99999'})]))).status,400);
  const first=await upload(bytes);assert.equal(first.status,200,JSON.stringify(first));const batchId=first.data.id;
  const repeated=await upload(bytes);assert.equal(repeated.data.id,batchId);assert.equal(repeated.data.duplicateFile,true);assert.equal(await db.collection('financeimports').countDocuments(),1);
  const original=await call('/api/finance/imports/'+batchId+'/file',{token});assert.equal(original.status,200);assert.equal(original.data,bytes.toString());
  assert.equal((await call('/api/finance/imports/'+batchId+'/file',{token:other})).status,404);
  assert.equal((await upload(bytes,qs+'&pageCount=999')).status,400);pass('original files survive intact; retries are idempotent and cross-account access is denied');
  const view=(await request('imports/'+batchId,undefined,'GET')).data;assert.deepEqual(view.rows.map(r=>r.state),['new','new','new','repayment']);
  assert.equal((await request('imports/'+batchId+'/commit',{decisions:view.rows.map(r=>({line:r.line,action:'import'}))})).status,400);assert.equal(await db.collection('transactions').countDocuments(),0);
  const decisions=view.rows.slice(0,3).map(r=>({line:r.line,action:'import'}));
  const concurrent=await Promise.all([request('imports/'+batchId+'/commit',{decisions}),request('imports/'+batchId+'/commit',{decisions})]);assert.ok(concurrent.some(r=>r.status===200),JSON.stringify(concurrent));assert.ok(concurrent.every(r=>[200,409].includes(r.status)));
  assert.equal(await db.collection('transactions').countDocuments(),3);
  assert.equal((await request('imports/'+batchId+'/commit',{decisions})).status,200);assert.equal(await db.collection('transactions').countDocuments(),3);
  const tx=await db.collection('transactions').findOne({cardNumber:'3456'});assert.equal(tx.type,'支出');assert.equal(tx.metadata.originalCardIdentifier,'23456');assert.equal(tx.metadata.processingDate,'2026-08-03');pass('repayments cannot post; concurrent retries preserve identical purchases and supplementary-card attribution');
  const overlapping=await upload(csv([row(),row({2:'New purchase',5:'42'})]),'?kind=recent&start=2026-08-01&end=2026-08-31');
  const overlapView=(await request('imports/'+overlapping.data.id,undefined,'GET')).data;assert.equal(overlapView.rows[0].state,'overlap_review');
  assert.equal((await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);
  await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'skip'}]});
  assert.equal((await request('imports/'+overlapping.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);pass('overlapping snapshots require an explicit decision even after a row was deferred');
  const corrected=await upload(csv([row({1:'2026/08/04'})]));const correctedView=(await request('imports/'+corrected.data.id,undefined,'GET')).data;assert.equal(correctedView.rows[0].state,'correction_review');assert.equal((await request('imports/'+corrected.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,409);pass('changed processing dates are held as possible corrections rather than new spending');
  const legacyId=new ObjectId();await db.collection('transactions').insertOne({_id:legacyId,date:new Date('2026-08-04T15:00:00Z'),amount:500,type:'支出',status:'completed',notes:'Older manual entry',cardNumber:'2345'});
  const legacy=await upload(csv([row({0:'2026/08/05',1:'2026/08/06',2:'Legacy shop',5:'500'})]));const legacyView=(await request('imports/'+legacy.data.id,undefined,'GET')).data;
  assert.equal(legacyView.rows[0].state,'legacy_review');assert.equal((await request('imports/'+legacy.data.id+'/commit',{decisions:[{line:2,action:'link',transactionId:legacyId.toHexString()}]})).data.linked,1);
  assert.equal((await db.collection('transactions').findOne({_id:legacyId})).notes,'Older manual entry');pass('historical matches include Japan-local dates and linking leaves accounting data intact');
  const interrupted=await upload(csv([row({2:'Interrupted purchase',5:'777'})]));const raw=parseAmex(csv([row({2:'Interrupted purchase',5:'777'})]),input.cardIdentifiers).rows[0];const ownerId=(await db.collection('financialaccounts').findOne({_id:new ObjectId(id)})).ownerId;
  const reserved={_id:new ObjectId(),ownerId,accountId:new ObjectId(id),key:raw.key,fingerprint:raw.fingerprint,occurrence:1,coverage:'statement:2026-07-19:2026-08-18',importId:new ObjectId(interrupted.data.id),line:2,transactionId:new ObjectId(),state:'reserved',row:raw,linkedExisting:false};
  await db.collection('financeentries').insertOne(reserved);await db.collection('transactions').insertOne({_id:reserved.transactionId,date:new Date(raw.purchaseDate),amount:777,type:'支出',status:'completed',metadata:{financeEntryId:reserved._id.toHexString()}});
  const before=await db.collection('transactions').countDocuments();assert.equal((await request('imports/'+interrupted.data.id+'/commit',{decisions:[{line:2,action:'import'}]})).status,200);assert.equal(await db.collection('transactions').countDocuments(),before);assert.equal((await db.collection('financeentries').findOne({_id:reserved._id})).state,'posted');pass('a crash after ledger insertion resumes without inserting the transaction again');
  assert.equal((await request('accounts/'+id+'/sync')).status,200);
  const claimed=await call('/api/finance/collector/claim',{method:'POST',token:deviceToken,body:{}});assert.equal(claimed.data.account._id,id);
  const up='/api/finance/collector/upload'+qs+'&accountId='+id+'&jobId='+claimed.data.account.jobId+'&pageCount=4';
  assert.equal((await call(up,{method:'POST',token:deviceToken,body:bytes,raw:true})).data.duplicateFile,true);
  await request('collectors/'+device.data.id,undefined,'DELETE');assert.equal((await call('/api/finance/collector/accounts',{token:deviceToken})).status,401);assert.equal((await call(up,{method:'POST',token:deviceToken,body:bytes,raw:true})).status,401);pass('only an assigned collector can upload; revocation takes effect immediately');
  if(process.env.OMF_TEST_CHROME_PORT){
   const {createRequire}=require('node:module');const collectorRequire=createRequire(path.join(root,'collector/package.json'));const p=collectorRequire('rebrowser-puppeteer-core');
   const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
   try{
    page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
    await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
    await page.goto(origin+'/connections',{waitUntil:'networkidle2'});await page.waitForSelector('.account-grid section');
    const result=await page.evaluate(()=>({title:document.querySelector('.connections h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,accounts:document.querySelectorAll('.account-grid section').length}));assert.equal(result.title,'カード連携');assert.equal(result.accounts,1);assert.equal(result.overflow,false);
    await page.click(`[data-import-id="${overlapping.data.id}"]`);await page.waitForSelector('.review-list article select');
    assert.equal(await page.$$eval('.review-list article',rows=>rows.length),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});pass('real Chrome: mobile login, account list and transaction review render without horizontal overflow');
   }finally{if(page)await page.close();await browser.disconnect();}
  }
  console.log(`${checks} finance integration checks passed`);
 }catch(error){console.error(error);console.error(logs.slice(-3500));process.exitCode=1;}
 finally{if(child && child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}if(client)await client.close();if(mongo)await mongo.stop();if(directory){if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');await fsp.rm(directory,{recursive:true,force:true});}}
}
main();

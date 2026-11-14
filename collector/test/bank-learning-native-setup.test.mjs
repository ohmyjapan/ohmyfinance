import {selectLearningRole,waitForLearningCapture} from '../../scripts/finance-bank-learning-capture-ack.mjs';
// Real default collector native claim/job, actual protected setup UI, native Chrome authentication and CSV.
// Synthetic OMF/key endpoints and self-signed TLS only; no bank-action or credential injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,link} from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {SplitStore,Vault,aadOf,replaceVaultFile} from '../vault.mjs';
import {FAKE_BROKER} from './fake-broker.mjs';
import '../puppeteer-frame-init.mjs';
import {recordBankLearning,projectEvidence} from '../bank-learning-recorder.mjs';
import {learningStore,learnedArtifactAlias} from '../bank-learning.mjs';
import {learningDownload} from '../bank-learning-runner.mjs';
import {stable} from '../../shared/finance-bank-learning.mjs';
const puppeteer=createRequire(new URL('../package.json',import.meta.url))('rebrowser-puppeteer-core'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+60000;for(;Date.now()<end;){const value=await fn();if(value)return value;await pause(100);}throw Error('setup-test-timeout-'+label);}
for(const scenario of ['native','legacy','remote-403','remote-503']){const legacy=scenario==='legacy',remoteFailure=scenario.startsWith('remote-'),remoteStatus=scenario==='remote-503'?503:403;test(legacy?'real default upload migrates legacy learned file, survives alias crash and lost ACK without new bank actions':remoteFailure?'real native local input survives pending-outbox403 and remote-list'+remoteStatus:'real native job automatically exposes protected setup input and authenticates Chrome/CSV without credential injection', {timeout:240000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-login-setup-')),dir=path.join(root,'collector'),local=path.join(root,'local'),broker=path.join(root,'broker');for(const p of [dir,local,broker])await mkdir(p);
 const owner='a'.repeat(24),account='b'.repeat(24),sessionId='c'.repeat(24),security={installationId:randomBytes(16).toString('hex'),generation:randomBytes(32).toString('hex')},keys=new Map(),grants=new Set(),outbound=[];
 const keyFile=path.join(root,'tls.key'),certFile=path.join(root,'tls.pem');await promisify(execFile)('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{windowsHide:true});
 let nativeBank,child,claimed=false,bankSignins=0,csvRequests=0,restarted=false,queueEnabled=!remoteFailure;const statuses=[],uploads=[],receiverKeys=new Set();
 const portal=https.createServer({key:await readFile(keyFile),cert:await readFile(certFile)},async(req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.url==='/signin'&&req.method==='POST'){bankSignins++;let body='';for await(const b of req)body+=b;const v=new URLSearchParams(body);if(v.get('identifier')!=='CANARY-NATIVE-ID'||v.get('password')!=='CANARY-NATIVE-PASSWORD'){res.writeHead(403);res.end('Refused');return;}res.setHeader('Set-Cookie','session=native-fictional; HttpOnly; SameSite=Strict');res.writeHead(303,{Location:'/home'});res.end();return;}
  if(req.url==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0; HttpOnly');res.end('Signed out');return;}
  if(!req.headers.cookie?.includes('session=native-fictional')){res.end('<form action="/signin" method="POST"><input id="identifier" name="identifier"><input id="password" name="password" type="password"><button id="submit">Sign in</button></form>');return;}
  if(req.url.startsWith('/csv')){csvRequests++;const q=new URL(req.url,'https://localhost').searchParams;res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="fictional.csv"');res.end('date,description,amount\r\n'+q.get('from')+',Synthetic native,-1234\r\n');return;}
  if(req.url==='/home'){res.end('<main><strong id="success">Authenticated</strong></main><button id="inquiry" onclick="location.href=&quot;/details&quot;">Inquiry</button>');return;}
  res.end('<select id="account"><option value="">Choose</option><option value="PRIVATEACCOUNT">Ordinary</option></select><input id="from"><input id="to"><button id="export" onclick="location.href=&quot;/csv?from=&quot;+document.querySelector(&quot;#from&quot;).value+&quot;&to=&quot;+document.querySelector(&quot;#to&quot;).value">CSV</button><span id="balance">100,000</span><button id="logout" onclick="location.href=&quot;/logout&quot;">Logout</button>');
 });await new Promise(r=>portal.listen(0,'127.0.0.1',r));const bankOrigin='https://127.0.0.1:'+portal.address().port;
 const omf=https.createServer({key:await readFile(keyFile),cert:await readFile(certFile)},async(req,res)=>{
  let text='';for await(const b of req)text+=b;outbound.push({route:req.url,body:text});const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const sub=req.url.replace('/api/finance/collector-security/','');let body={};try{body=text&&req.headers['content-type']?.includes('application/json')?JSON.parse(text):{};}catch{return send(400,{});}
  if(sub==='session'){if(body.installationId!==security.installationId||body.generation!==security.generation||body.trustToken!==security.trustToken)return send(401,{});const grant=randomBytes(32).toString('hex');grants.add(grant);return send(200,{...security,action:'resume',grant,expiresAt:new Date(Date.now()+20*60000).toISOString()});}
  if(req.url.startsWith('/api/finance/collector-security/')){if(!grants.has(req.headers['x-collector-grant']))return send(403,{});if(sub==='lock'){grants.delete(req.headers['x-collector-grant']);return send(200,{});}if(sub==='keys'){keys.set(body.keyId,body);return send(200,{keyId:body.keyId,generation:security.generation});}if(sub.startsWith('keys/'))return send(200,{...keys.get(sub.slice(5)),generation:security.generation});}
  if(remoteFailure&&req.url==='/api/finance-bank-learning/pc/'+ '9'.repeat(24)+'/evidence')return send(403,{error:'CANARY-REMOTE-DENIAL'});
  if(req.url==='/api/finance-bank-learning/pc/sessions')return remoteFailure?send(remoteStatus,{error:'CANARY-REMOTE-LIST'}):send(200,{sessions:[]});
  if(req.url==='/api/finance/collector/accounts')return send(200,{accounts:[{_id:account,ownerId:owner,provider:'amex',primaryCard:'12345',name:'Synthetic card',jobState:'idle'}]});
  if(req.url==='/api/finance/collector/claim')return send(200,{account:null});
  if(req.url==='/api/finance-payments/collector/bank/accounts')return send(200,{accounts:[{_id:account,ownerId:owner,name:'Native learning fixture',provider:'learned'}]});
  if(req.url==='/api/finance-payments/collector/bank/claim'){if(!queueEnabled||claimed||!nativeBank)return send(200,{job:null});claimed=true;return send(200,nativeBank);}
  if(req.url==='/api/finance-payments/collector/bank/status'){statuses.push(body);return send(200,{accepted:true});}
  if(req.url.startsWith('/api/finance-payments/collector/bank/upload?')){
   const q=new URL(req.url,'https://localhost').searchParams;assert.equal(q.get('jobId'),nativeBank.job.jobId);assert.equal(q.get('snapshotHash'),nativeBank.job.snapshotHash);uploads.push(text);receiverKeys.add(q.get('jobId')+q.get('snapshotHash')+createHash('sha256').update(text).digest('hex'));
   if(legacy&&!restarted){child.kill();res.destroy();return;}return send(200,{id:'d'.repeat(24)});
  }
  return send(404,{});
 });await new Promise(r=>omf.listen(0,'127.0.0.1',r));const origin='https://127.0.0.1:'+omf.address().port;
 const store=new SplitStore(dir);let deviceKey;await store.withLock(async()=>{deviceKey=await store.deviceKey(security.generation,{create:true});security.publicKey=deviceKey.publicKey;security.trustToken=await store.trustCredential(security.generation,{create:true});});
 const activatedAt=new Date().toISOString(),config={baseUrl:origin,token:'omfc_'+randomBytes(32).toString('hex'),accountInfo:[{_id:account,ownerId:owner,provider:'amex',primaryCard:'12345',name:'Synthetic card'}],accounts:{},services:{},mode:'protected',protection:{...security,keyProvider:'CurrentUser DPAPI + OMF',activatedAt}};delete config.protection.trustToken;
 const remote={check(){},async put(r){keys.set(r.keyId,r);return {keyId:r.keyId,generation:security.generation};},async get(id){return {...keys.get(id),generation:security.generation};}};
 await store.withLock(async()=>{await store.save('check',aadOf({installationId:security.installationId,origin,ownerId:owner,provider:'check',accountId:'check'}),{canary:'synthetic-only'},{remote,localKey:deviceKey,generation:security.generation});await new Vault(dir).update(()=>config);await replaceVaultFile(path.join(dir,'vault-state.json'),JSON.stringify({v:3,phase:'active',installationId:security.installationId,generation:security.generation,publicKey:security.publicKey,activatedAt}));});deviceKey.close();
 const sha=v=>createHash('sha256').update(stable(v)).digest('hex'),mappingStore=learningStore(dir,sessionId);let record;
 const demo=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,acceptInsecureCerts:true,userDataDir:path.join(root,'demo-profile')});
 try{
  const p=await demo.newPage();await p.goto(bankOrigin);const download=await learningDownload(demo,path.join(root,'demo-download'),{origins:[bankOrigin],demonstration:true});
  const pending=recordBankLearning(demo,p,{entryOrigin:bankOrigin,teachLogin:true,timeout:45000,onExport:()=>{const n=download.beginExport();return()=>download.acceptExport(n);},store:async r=>{await mappingStore.update(v=>({...v,record:r}));record=structuredClone(r);}});void pending.catch(()=>{});
  const operate=async(role,fn)=>{await p.waitForSelector('#omf-learning-control select');await selectLearningRole(p,role,pending);const n=record?.events.length||0;await fn();if(['from','to'].includes(role.split(':')[0]))await waitForLearningCapture(p,pending);await until(()=>record?.events.length===n+1,'record-'+role);};
  await operate('login-identifier',()=>p.click('#identifier'));await p.type('#identifier','CANARY-NATIVE-ID');await operate('login-password',()=>p.click('#password'));await p.type('#password','CANARY-NATIVE-PASSWORD');await operate('login-submit',()=>Promise.all([p.waitForNavigation(),p.click('#submit')]));await operate('login-success',()=>p.click('#success'));await operate('inquiry',()=>Promise.all([p.waitForNavigation(),p.click('#inquiry')]));await operate('account',()=>p.select('#account','PRIVATEACCOUNT'));
  for(const [role,value]of [['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await p.type('#'+role,value);await p.$eval('#'+role,e=>e.blur());});await operate('export',()=>p.click('#export'));await operate('balance',()=>p.click('#balance'));await operate('logout',()=>Promise.all([p.waitForNavigation(),p.click('#logout')]));await p.click('#omf-learning-control button');record=await pending;await download.file();await download.close();
 }finally{await demo.close();}
 const evidence=projectEvidence(record),evidenceHash=sha(evidence),candidate={schema:2,runtime:evidence.runtime,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))},selection={schema:1,mode:'attended-statement',sessionId,candidateHash:sha(candidate),evidenceHash,runtime:evidence.runtime,collectorId:'e'.repeat(24),installationId:security.installationId,generation:security.generation,companyId:'f'.repeat(24),activationId:randomBytes(24).toString('hex')};
 await mappingStore.update(v=>({...v,binding:{sessionId,origin,installationId:security.installationId,generation:security.generation,bankAccountId:account},evidenceHash}));
 const snapshot={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative',coverage:{from:'2026-11-03',to:'2026-11-04'},learned:{...selection,selectionHash:sha(selection),entryOrigin:bankOrigin,candidate}};
 nativeBank={account:{_id:account,ownerId:owner,name:'Native learning fixture',provider:'learned'},job:{jobId:randomUUID(),kind:'retrieve',provider:'learned',snapshot,snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}};
 let legacyArtifact;
 if(legacy){
  const job=nativeBank.job,folder=path.join(dir,'outbox','bank',account,job.jobId+'-learned'),bytes=Buffer.from('date,description,amount\r\n2026-11-03,Synthetic native,-1234\r\n'),manifest={ownerId:owner,bankAccountId:account,origin,jobId:job.jobId,snapshotHash:job.snapshotHash,kind:'statement',sourceFormat:'csv',filename:'statement.csv',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,channel:'collector',sourceHost:'127.0.0.1',downloadedAt:new Date().toISOString(),suggestedFilename:'fictional.csv',labelChecked:false,learnedSelectionHash:snapshot.learned.selectionHash};
  await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'statement.csv'),bytes);await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
  // Crash before the atomic manifest update: deterministic alias exists, old manifest still authoritative.
  await link(path.join(folder,'statement.csv'),path.join(folder,learnedArtifactAlias(manifest)));legacyArtifact={folder,manifest,bytes};
  await new Vault(path.join(dir,'bank-learning','jobs',job.jobId)).update(()=>({binding:{sessionId,origin,installationId:security.installationId,generation:security.generation,bankAccountId:account,ownerId:owner,jobId:job.jobId,snapshotHash:job.snapshotHash,selectionHash:snapshot.learned.selectionHash},phase:'started'}));
 }
 if(remoteFailure)await learningStore(dir,'9'.repeat(24)).update(()=>({binding:{origin,installationId:security.installationId,generation:security.generation},pending:{action:'evidence',body:{claim:'fictional-pending'}}}));
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const index=new URL('../index.mjs',import.meta.url).href;
 const sdk=new URL('../node_modules/rebrowser-puppeteer-core/lib/esm/puppeteer/puppeteer-core.js',import.meta.url).href;
 const script=`const {default:p}=await import(${JSON.stringify(sdk)});const launch=p.launch.bind(p);p.launch=opts=>launch({...opts,headless:true,acceptInsecureCerts:true});const {startCollector}=await import(${JSON.stringify(index)});await startCollector();`;

 const launchCollector=()=>spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:dir,OMF_COLLECTOR_PORT:String(port),LOCALAPPDATA:local,OMF_KEY_BROKER:FAKE_BROKER,OMF_FAKE_BROKER_DIR:broker,OMF_COLLECTOR_TICK_MS:'10000',OMF_COLLECTOR_ORIGIN:origin,NODE_EXTRA_CA_CERTS:certFile},stdio:['ignore','pipe','pipe']});let output='';const watch=c=>{for(const s of [c.stdout,c.stderr])s.on('data',b=>output+=b);return c;};child=watch(launchCollector());let browser;
 try{
  if(legacy){
   await until(()=>uploads.length===1&&(child.exitCode!==null||child.signalCode),'legacy-first-ack-lost');const before=JSON.parse(await readFile(path.join(legacyArtifact.folder,'manifest.json'),'utf8'));assert.equal(before.filename,learnedArtifactAlias(legacyArtifact.manifest));assert.ok(!before.acknowledgedAt);claimed=false;restarted=true;child=watch(launchCollector());
   await until(()=>statuses.some(s=>s.state==='complete'),'legacy-recovery-complete');const after=JSON.parse(await readFile(path.join(legacyArtifact.folder,'manifest.json'),'utf8'));assert.equal(after.filename,before.filename);assert.ok(after.acknowledgedAt);assert.deepEqual(await readFile(path.join(legacyArtifact.folder,'statement.csv')),legacyArtifact.bytes);assert.deepEqual(await readFile(path.join(legacyArtifact.folder,after.filename)),legacyArtifact.bytes);assert.equal(uploads.length,2);assert.equal(receiverKeys.size,1);assert.equal(bankSignins,1,'only attended preparation, no recovery bank login');assert.equal(csvRequests,1,'no recovery bank download');assert.ok(!statuses.some(s=>s.state==='verification_required'));console.log('Legacy default-upload recovery artifacts retained at '+root);return;
  }
  const link=await until(async()=>{try{return (await readFile(path.join(dir,'setup-link.txt'),'utf8')).trim();}catch{return null;}},'link'),setupOrigin=new URL(link).origin,key=new URL(link).hash.slice(1);
  const call=async(route,body,extra={})=>{await writeFile(path.join(root,'stage.txt'),route);const response=await fetch(setupOrigin+route,{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{'X-Setup-Key':key,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  await until(async()=>{const r=await call('/status');return r.body.unlocked&&r.body.mode==='protected';},'protected-session');
  if(remoteFailure){const denied=await call('/learning/sessions');assert.equal(denied.status,503);assert.ok(!JSON.stringify(denied).includes('CANARY-REMOTE'));assert.ok(outbound.some(r=>r.route.includes('/'+ '9'.repeat(24)+'/evidence')));assert.equal((await call('/learning/credentials')).status,200);queueEnabled=true;}
  await until(()=>statuses.find(s=>s.state==='verification_required'),'native-wait');assert.ok(statuses.some(s=>s.message.includes('設定画面')));assert.equal(bankSignins,1,'only attended demo submitted before local UI input');
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'ui-profile')});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(link,{waitUntil:'networkidle0'});
  // No refresh, teaching Run button, constructor bank action or injected credential callback.
  await page.waitForSelector('[data-learning-credential=password]');await page.type('[data-learning-credential=identifier]','CANARY-NATIVE-ID');await page.type('[data-learning-credential=password]','CANARY-NATIVE-PASSWORD');
  if(remoteFailure){await page.click('#learning-refresh');await pause(200);const lists=outbound.filter(r=>r.route==='/api/finance-bank-learning/pc/sessions').length;await pause(2300);assert.equal(outbound.filter(r=>r.route==='/api/finance-bank-learning/pc/sessions').length,lists,'local prompt polls do not call remote list');assert.equal(await page.$eval('[data-learning-credential=password]',e=>e.value),'CANARY-NATIVE-PASSWORD');assert.ok(!(await page.content()).includes('CANARY-REMOTE'));assert.equal((await call('/learning/credentials',undefined,{Origin:'https://attacker.example.invalid'})).status,403);assert.equal((await call('/learning/credentials',undefined,{'X-Setup-Key':'wrong'})).status,403);const localView=await call('/learning/credentials');assert.equal(localView.status,200);assert.ok(!JSON.stringify(localView).includes('CANARY'));}
  await page.click('#learning-credentials button');
  await until(()=>{if(statuses.some(s=>s.state==='failed'))throw Error('native-job-failed');return statuses.find(s=>s.state==='complete');},'native-complete');assert.equal(bankSignins,2,'exactly one real native login after demo');assert.equal(csvRequests,2,'demonstration and authenticated native CSV');assert.equal(uploads.length,1);assert.ok(uploads[0].includes('2026-11-03,Synthetic native,-1234'));assert.ok(statuses.some(s=>s.state==='running'&&s.message.includes('ログインを確認')));
  assert.equal((await call('/learning/credentials')).body.credentialRequest,null);assert.deepEqual(errors,[]);for(const canary of ['CANARY-NATIVE-ID','CANARY-NATIVE-PASSWORD']){assert.ok(!JSON.stringify(outbound).includes(canary));assert.ok(!output.includes(canary));assert.ok(!stable((await mappingStore.read()).record).includes(canary));}
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.cookie),'{}{}');console.log('Real native protected setup artifacts retained at '+root);
 }catch(error){console.log('Native setup safe phase diagnostic '+JSON.stringify({bankSignins,csvRequests,uploads:uploads.length,statuses}));console.log('Protected setup failed stage '+await readFile(path.join(root,'stage.txt'),'utf8').catch(()=>''));console.log('Synthetic collector output '+output);throw error;}finally{if(browser)await browser.close();if(child.exitCode===null&&!child.signalCode){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}for(const s of [omf,portal])await new Promise(r=>{s.closeAllConnections();s.close(r);});}
});}

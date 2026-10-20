'use strict';
// scripts/finance-rakuten-auto-login-integration.cjs — plan omf-rakuten-auto-login-20261021: the owned native end-to-end of the
// saved 楽天銀行 standard login. The BUILT app (.output) on its own ephemeral MongoDB; a real PC enrollment through the real
// collector-security routes (card-only scope) with the collector's real DPAPI device key (collector/vault.mjs SplitStore on a temp
// collector directory, real private-directory writer lease); the owner adds the bank account to that PC afterwards; the
// collector's bank/accounts metadata; the one-time save through index.mjs saveBankLogin into the real SplitStore and the real
// key-service client (collector/omf-authorization.mjs keyService) over loopback HTTP; then two independent retrievals through
// index.mjs claimWork/bankLoginFor/runBankJob — the default per-variant adapter in the collector's owned BACKGROUND Chrome
// (headed, real stock Chrome) on a fake portal served by request interception at https://fes.rakuten-bank.co.jp (no network,
// no bank) — the exact public login form filled from the saved login and submitted once per job, the native CSV uploaded,
// captured, deduplicated. The second retrieval uses a renewed remembered-PC grant after the first browser closed. Key-service
// calls are counted: one release per retrieval, none for claim/status/upload. Fictional people, accounts and passwords only.
// Run by scripts/zoomer-fixtures/omf-rakuten-auto-login.mjs through the hub verifier; prints PASS lines and a final receipt.
const assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms)),u=rel=>pathToFileURL(path.join(root,rel)).href;
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex'),hex=n=>crypto.randomBytes(n).toString('hex');
const FICT_USER='fictional-corp-user',FICT_PASS='Fictional-Pass-0001',OWNER_PASSWORD='Synthetic-password-Only1!';
// The security routes require a configured HTTPS origin (the built app inlines NODE_ENV, so its loopback test mode is off): the owned
// app is configured with this reserved origin and THIS test process routes requests for it to the owned loopback app (no DNS, no network).
const PUBLIC='https://omf.example.invalid';

// ── Shift_JIS for the synthetic native statement (the table of scripts/finance-bank-collection-integration.cjs) ──
const sjisOf=new Map(),sjisDecoder=new TextDecoder('shift_jis');
for(let b=0;b<0x80;b++)sjisOf.set(String.fromCharCode(b),[b]);
for(let b=0xa1;b<=0xdf;b++)sjisOf.set(sjisDecoder.decode(Uint8Array.of(b)),[b]);
for(let lead=0x81;lead<=0xfc;lead++){if(lead>0x9f&&lead<0xe0)continue;for(let trail=0x40;trail<=0xfc;trail++){if(trail===0x7f)continue;const c=sjisDecoder.decode(Uint8Array.of(lead,trail));if(c.length===1&&c!=='�'&&!sjisOf.has(c))sjisOf.set(c,[lead,trail]);}}
const sjis=s=>Buffer.from([...s].flatMap(c=>{const b=sjisOf.get(c);if(!b)throw Error('fixture text not in Shift_JIS: '+c);return b;}));

// ── The fake portal: the recorded public login form (LIVE-LOGIN-CONTRACT/CONTROLS), overview, statement page, POST download ──
const HOST='fes.rakuten-bank.co.jp',ORIGIN='https://'+HOST,CORP='/XMS/security/RbS',LOGIN_ACTION='/XMS/security/fcs/rb/fes/views/mainservice/Security/LoginAuthentication/Login/CorpLogin.xhtml';
const OVERVIEW='/XMS/inquiry/gns',STATEMENT='/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/BalanceInquiry/BalanceInquiry/BalanceInquiry.xhtml',DOWNLOAD='/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/CreditDebitInquiry/CreditDebitInquiry/CreditDebitInquiry.xhtml';
const F='FORM_DOWNLOAD_AP_2',IDS=['EXPECTED_DATE_FROM_YEAR','EXPECTED_DATE_FROM_MONTH','EXPECTED_DATE_FROM_DAY','EXPECTED_DATE_TO_YEAR','EXPECTED_DATE_TO_MONTH','EXPECTED_DATE_TO_DAY'].map(x=>F+':'+x);
const NATIVE_BUTTON=F+':j_id_6n6',ZENGIN_BUTTON=F+':j_id_6n9',ACCOUNT_LABEL='普通 1234567 カクウホールディングス';
const ROWS=[['20251110',-330,'振込手数料'],['20251110',-330,'振込手数料'],['20251201',250000,'ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'],['20260105',-110000,'振込 カ）カクウリース'],['20260715',-9900,'口座振替 カクウサブスク']];
function nativeCsv(from,to){let balance=2000000;const lines=['取引日,入出金(円),残高(円),入出金先内容'];for(const [d,a,t] of ROWS){balance+=a;const iso=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6);if(iso>=from&&iso<=to)lines.push([d,a,balance,t].join(','));}return sjis(lines.join('\r\n')+'\r\n');}
const html=body=>({status:200,contentType:'text/html; charset=utf-8',body});
const loginDoc=(error='')=>`<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行へようこそ</title><body>
<form id="TAB_FORM" name="TAB_FORM" method="post" action="${LOGIN_ACTION}"><a href="#" onclick="return false">個人のお客さま</a> <a href="#" onclick="return false">法人のお客さま</a></form>
<form id="SECURITY_BOARD" name="SECURITY_BOARD" method="post" action="${LOGIN_ACTION}" style="display:none"><input type="hidden" name="SECURITY_BOARD_SUBMIT" value="1"></form>
${error?`<p id="login-error">${error}</p>`:''}<form id="LOGIN" name="LOGIN" method="post" action="${LOGIN_ACTION}"><label>ユーザID <input id="LOGIN:USER_ID" name="LOGIN:USER_ID" type="text"></label> <label>ログインパスワード <input id="LOGIN:LOGIN_PASSWORD" name="LOGIN:LOGIN_PASSWORD" type="password"></label> <a id="LOGIN:j_id_1p" name="LOGIN:j_id_1p" href="#" onclick="return false">パスワードについて</a> <a href="#" class="btn">ログイン</a><input type="hidden" name="LOGIN_SUBMIT" value="1"></form>
<form id="LOGINPASSWORD_FORM_3" name="LOGINPASSWORD_FORM_3" method="post" action="${LOGIN_ACTION}" style="display:none"><input type="password" name="LOGINPASSWORD_FORM_3:OLD"></form>
<script>window.__typed=0;document.addEventListener('input',()=>{window.__typed++;},true);document.querySelector('#LOGIN a.btn').addEventListener('click',e=>{e.preventDefault();document.getElementById('LOGIN').submit();});</script></body></html>`;
const overviewDoc=()=>`<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人ビジネス口座</title><body><a href="#">ログアウト</a> <a href="#">登録情報の照会・変更</a> <a id="statements" href="${STATEMENT}">入出金明細</a></body></html>`;
function statementDoc(){
  const select=(id,from,to,value)=>`<select id="${id}" name="${id}">${Array.from({length:to-from+1},(_,i)=>from+i).map(n=>`<option value="${n}"${n===value?' selected':''}>${n}</option>`).join('')}</select>`;
  const text=(id,value,max)=>`<input id="${id}" name="${id}" type="text" maxlength="${max}" value="${value}">`;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>入出金明細</title><body><a href="#">ログアウト</a> <a href="#">登録情報の照会・変更</a><div id="account">${ACCOUNT_LABEL}</div>
  <form id="${F}" name="${F}" method="post" action="${DOWNLOAD}"><p>照会期間</p>${select(IDS[0],2016,2026,2026)}年${select(IDS[1],1,12,7)}月${select(IDS[2],1,31,22)}日 〜 ${text(IDS[3],2026,4)}年${text(IDS[4],'10',2)}月${text(IDS[5],'20',2)}日
  <section><h3>楽天銀行フォーマット</h3><input type="submit" id="${NATIVE_BUTTON}" name="${NATIVE_BUTTON}" value="CSVダウンロード"></section><section><h3>全銀フォーマット</h3><input type="submit" id="${ZENGIN_BUTTON}" name="${ZENGIN_BUTTON}" value="CSVダウンロード"></section><input type="hidden" name="${F}_SUBMIT" value="1"></form></body></html>`;
}
// One portal state shared by every page of every owned browser: the accepted password and the recorded submissions/exports.
function portal(){
  const s={password:FICT_PASS,loginPosts:[],foreign:[],downloads:[],requests:0,authenticated:false};
  s.respond=request=>{
    const url=request.url();s.requests++;let parsed;try{parsed=new URL(url);}catch{return request.abort();}
    if(parsed.origin!==ORIGIN){s.foreign.push(parsed.origin);return request.abort();}
    if(parsed.pathname===CORP)return request.respond(html(loginDoc()));
    if(parsed.pathname===LOGIN_ACTION&&request.method()==='POST'){const body=new URLSearchParams(request.postData()||''),ok=body.get('LOGIN:USER_ID')===FICT_USER&&body.get('LOGIN:LOGIN_PASSWORD')===s.password;s.loginPosts.push({ok,fields:[...body.keys()].sort()});
      return request.respond(html(ok?`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン中</title><body><p>ログインしています…</p><script>location.replace(${JSON.stringify(OVERVIEW)})</script></body></html>`:loginDoc('ユーザIDまたはログインパスワードが正しくありません')));}
    if(parsed.pathname===OVERVIEW)return request.respond(html(overviewDoc()));
    if(parsed.pathname===STATEMENT)return request.respond(html(statementDoc()));
    if(parsed.pathname===DOWNLOAD&&request.method()==='POST'){const body=new URLSearchParams(request.postData()||''),n=id=>Number(body.get(id)),iso=(y,m,d)=>[String(y),String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');const from=iso(n(IDS[0]),n(IDS[1]),n(IDS[2])),to=iso(n(IDS[3]),n(IDS[4]),n(IDS[5])),format=body.has(NATIVE_BUTTON)?'native':'other';s.downloads.push({format,from,to});
      return request.respond({status:200,contentType:'application/octet-stream',headers:{'Content-Disposition':'attachment; filename="RB-torihikimeisai.csv"'},body:nativeCsv(from,to)});}
    return request.abort();
  };
  // The collector's onLaunch hands this fixture each owned browser before its first page: every page is intercepted before any request.
  s.onLaunch=launches=>async({pid,browser})=>{launches.push(pid);const original=browser.newPage.bind(browser);browser.newPage=async()=>{const page=await original();await page.setRequestInterception(true);page.on('request',r=>s.respond(r));return page;};};
  return s;
}

async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
// F2: use the actual daemon, setup HTTP routes and tick. Only the subprocess transport and Chrome network are intercepted.
async function runningCollectorLeg({temp,collectorDir,origin,config,store,vault,installationId,generation,localKey,broker,bank,ownerReq,ok,db,pass}){
  const activatedAt=new Date().toISOString(),protection={installationId,generation,keyProvider:'CurrentUser DPAPI + OMF',publicKey:localKey.publicKey,activatedAt};
  await store.withLock(async()=>{
    await store.save('check',vault.aadOf({installationId,origin:PUBLIC,ownerId:config.accountInfo[0].ownerId,provider:'check',accountId:'check'}),{canary:hex(16)},broker);
    await new vault.Vault(collectorDir).update(()=>({...config,accounts:{},services:{},protection,paused:true}));
    await vault.replaceVaultFile(path.join(collectorDir,'vault-state.json'),JSON.stringify({v:3,phase:'active',installationId,generation,publicKey:localKey.publicKey,activatedAt}));
  });
  const port=await availablePort(),metrics=path.join(temp,'daemon-portal.json'),requests=path.join(temp,'daemon-http.jsonl'),launcher=path.join(temp,'daemon-launcher.mjs');
  const mutant=process.env.OMF_TEST_RAKUTEN_DAEMON_MUTANT||'';
  assert.ok(['','omit-login','omit-save','status-no-presence'].includes(mutant),'known daemon mutation');
  const script=`import fs from 'node:fs';import {createRequire,registerHooks} from 'node:module';
const require=createRequire(${JSON.stringify(path.join(root,'package.json'))});const {portal}=require(${JSON.stringify(__filename)});const site=portal();
const metricFile=${JSON.stringify(metrics)},requestFile=${JSON.stringify(requests)},publicOrigin=${JSON.stringify(PUBLIC)},localOrigin=${JSON.stringify(origin)};
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const value=String(input?.url||input);const mapped=value.startsWith(publicOrigin+'/')?localOrigin+value.slice(publicOrigin.length):value;
const parsed=new URL(mapped);if(parsed.origin!==localOrigin&&parsed.origin!==${JSON.stringify('http://127.0.0.1:'+port)})throw Error('fixture blocked unexpected fetch');
fs.appendFileSync(requestFile,JSON.stringify({path:parsed.pathname,method:init?.method||'GET'})+'\\n');return realFetch(mapped,init);};
globalThis.__omfFictionalBankBrowser=async browser=>{let create=browser.newPage.bind(browser);Object.defineProperty(browser,'newPage',{configurable:true,get(){return async(...args)=>{const page=await create(...args);await page.setRequestInterception(true);page.on('request',async request=>{await site.respond(request);fs.writeFileSync(metricFile,JSON.stringify({posts:site.loginPosts,downloads:site.downloads,foreign:site.foreign}));});return page;};},set(fn){create=fn.bind(browser);}});return browser;};
registerHooks({load(url,context,next){const result=next(url,context);if(url===${JSON.stringify(u('collector/browser.mjs'))})return {...result,source:String(result.source)+'\\nconst fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=async(...args)=>globalThis.__omfFictionalBankBrowser(await fixtureLaunch(...args));\\n'};
if(url===${JSON.stringify(u('collector/index.mjs'))}&&${JSON.stringify(mutant)}){let source=String(result.source);const kind=${JSON.stringify(mutant)};
const anchor=kind==='omit-login'?'login:bankLoginFor(bank,config,live)':kind==='status-no-presence'?'hasCredentials:!!envelope':source.split('\\n').find(line=>line.includes('return reply(200,await saveBankLogin(input,'));
if(!anchor||source.split(anchor).length!==2)throw Error('daemon mutation anchor mismatch');source=source.replace(anchor,kind==='omit-login'?'login:null':kind==='status-no-presence'?'hasCredentials:false':'        return reply(200,{saved:true});');return {...result,source};}return result;}});
await import(${JSON.stringify(u('collector/run.mjs'))});`;
  await fsp.writeFile(launcher,script);
  const child=spawn(process.execPath,[launcher],{cwd:root,windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:collectorDir,OMF_COLLECTOR_PORT:String(port),OMF_COLLECTOR_TICK_MS:'1000'},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{output=(output+v).slice(-6000)});
  const waitFor=async(read,label,timeout=90000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(child.exitCode!==null)throw Error('daemon exited: '+output);const value=await read();if(value)return value;await pause(200);}throw Error('daemon timeout '+label+': '+output);};
  let local;
  try{
    const setup=await waitFor(async()=>{try{const u=new URL((await fsp.readFile(path.join(collectorDir,'setup-link.txt'),'utf8')).trim());return u.port===String(port)?u:null}catch{return null}},'setup link');
    local=async(route,body)=>{const response=await fetch(setup.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Setup-Key':setup.hash.slice(1),Origin:setup.origin},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});return {status:response.status,data:await response.json()};};
    await waitFor(async()=>{const r=await local('/status');return r.status===200&&r.data.startupDone},'startup');
    ok(await local('/resume',{}),'daemon resume');
    await waitFor(async()=>{const r=await local('/status');if(r.data.keyLost||r.data.reconnectNeeded)throw Error('daemon resume: '+r.data.message);return r.data.protected&&r.data.unlocked&&!r.data.busy&&!r.data.authorizing&&!r.data.testBroker},'normal remembered-PC resume');
    const body={bankAccountId:bank,username:FICT_USER,password:FICT_PASS};
    const priorKey=JSON.parse(await fsp.readFile(path.join(collectorDir,'secrets','rakuten-'+bank+'.sealed'),'utf8')).keyId;
    ok(await local('/bank/credentials',body),'daemon positive bank save');
    assert.notEqual(JSON.parse(await fsp.readFile(path.join(collectorDir,'secrets','rakuten-'+bank+'.sealed'),'utf8')).keyId,priorKey,'auto:daemon-http-save-writes-new-envelope');
    const after=ok(await local('/status'),'daemon status after save'),saved=after.banks.find(b=>b.bankAccountId===bank);
    assert.ok(saved?.supported&&saved.hasCredentials&&!saved.refused,'auto:daemon-http-save-status');
    assert.ok(!JSON.stringify(after).includes(FICT_PASS)&&!JSON.stringify(after).includes(FICT_USER),'auto:daemon-status-no-values');
    const marker=path.join(collectorDir,'bank-login','rakuten-'+bank+'.json'),entry=JSON.parse(await fsp.readFile(path.join(collectorDir,'secrets','rakuten-'+bank+'.sealed'),'utf8'));
    await fsp.mkdir(path.dirname(marker),{recursive:true});await vault.replaceVaultFile(marker,JSON.stringify({entry:'rakuten-'+bank,keyId:entry.keyId,refusedAt:new Date().toISOString()}));
    assert.equal(ok(await local('/status'),'daemon pending status').banks.find(b=>b.bankAccountId===bank).refused,true,'auto:daemon-status-real-marker');
    ok(await local('/bank/credentials',body),'daemon owner resave clears pending');
    assert.equal(ok(await local('/status'),'daemon resaved status').banks.find(b=>b.bankAccountId===bank).refused,false,'auto:daemon-resave-clears-marker');
    const reads=()=>fs.existsSync(requests)?fs.readFileSync(requests,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const before=reads().filter(r=>r.path.includes('/collector-security/keys/')&&r.method==='GET').length;
    const job=ok(await ownerReq('bank/accounts/'+bank+'/sync',{}),'daemon native sync').job;
    await waitFor(async()=>{const row=await db.collection('financebankjobs').findOne({jobId:job.jobId});assert.notEqual(row?.state,'verification_required','auto:daemon-no-manual-attention');if(row?.state==='failed')throw Error('daemon bank failed: '+row.message);return row?.state==='complete'},'real tick retrieval',120000);
    await waitFor(async()=>{const s=ok(await local('/status'),'daemon idle');return !s.busy&&s.banks.find(b=>b.bankAccountId===bank)?.refused===false},'accepted pending marker cleared');
    const observed=JSON.parse(await fsp.readFile(metrics,'utf8'));
    assert.deepEqual(observed.posts.map(p=>p.ok),[true],'auto:daemon-one-submit');assert.equal(observed.downloads.length,1,'auto:daemon-export');assert.deepEqual(observed.foreign,[]);
    const afterReads=reads();assert.equal(afterReads.filter(r=>r.path.includes('/collector-security/keys/')&&r.method==='GET').length-before,1,'auto:daemon-one-key-open');
    assert.ok(afterReads.some(r=>r.path==='/api/finance-payments/collector/bank/claim'&&r.method==='POST'),'auto:daemon-real-tick-claim');
    const completed=await db.collection('financebankjobs').findOne({jobId:job.jobId});assert.equal(completed.statementIds.length,1,'auto:daemon-capture-linked');
    assert.equal(await db.collection('financebankstatements').countDocuments({_id:completed.statementIds[0],'capture.bankAccountId':bank,'capture.state':'imported'}),1,'auto:daemon-capture-imported (source dedup may reuse the earlier capture)');
    pass('real collector process: remembered-PC resume with real owner broker/DPAPI, POST /bank/credentials positive save and re-save, /status.banks reads real sealed-entry and pending marker without values, real tick claims and completes one native retrieval with one key open and one intercepted login submission');
    return {loginSubmissions:observed.posts.length,exports:observed.downloads.length,keyOpens:1,keyCalls:afterReads.filter(r=>r.path.includes('/collector-security/keys')).length};
  }finally{
    if(local&&child.exitCode===null)await local('/pause',{}).catch(()=>{});
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  }
}
async function main(){
  assert.equal(process.platform,'win32','the collector vault (DPAPI) and owned Chrome need Windows');
  if(!fs.existsSync(path.join(root,'.output/server/index.mjs')))throw Error('built app absent; build OMF first');
  let mongo,child,client,checks=0,logs='';const pass=name=>{checks++;console.log('PASS '+name);};
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-rakuten-auto-int-')),collectorDir=path.join(temp,'collector');await fsp.mkdir(collectorDir,{recursive:true});
  process.env.OMF_COLLECTOR_DIR=collectorDir;
  const brokers=[];
  try{
    const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),parentBinary=path.join(root,'..','node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
    const systemBinary=[binary,parentBinary].find(p=>fs.existsSync(p));
    mongo=await MongoMemoryServer.create({binary:systemBinary?{systemBinary,version:'8.2.1'}:undefined});
    const dbName='rakuten_auto_login_isolated',uri=mongo.getUri(dbName),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:path.join(temp,'data'),JWT_SECRET:hex(32),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_COLLECTOR_PUBLIC_ORIGIN:PUBLIC},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{logs=(logs+v).slice(-15000);});
    let healthy=false;for(let i=0;i<150;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected&&d.database.name===dbName){healthy=true;break;}}catch{}await pause(200);}
    assert.ok(healthy,'owned app health: '+logs.slice(-1200));
    const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=String(input&&input.url&&typeof input!=='string'&&!(input instanceof URL)?input.url:input);return realFetch(url.startsWith(PUBLIC+'/')?origin+url.slice(PUBLIC.length):input,init);};
    client=await MongoClient.connect(uri);const db=client.db(dbName);
    const call=async(route,{method='GET',token,body,headers={}}={})=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};};
    const ok=(r,label)=>{assert.equal(r.status,200,label+' '+JSON.stringify(r.data).slice(0,500));return r.data;};
    const register=async email=>ok(await call('/api/auth/register',{method:'POST',body:{email,password:OWNER_PASSWORD,name:'Fictional owner'}}),'register').tokens.accessToken;
    const owner=await register('rakuten-owner@example.invalid'),stranger=await register('rakuten-other@example.invalid');
    const ownerReq=(route,body,method='POST',token=owner)=>call('/api/finance-payments/'+route,{method,token,body});
    // ── card-only PC pairing (the existing flow) ──
    const card=ok(await call('/api/finance/accounts',{method:'POST',token:owner,body:{name:'Fictional Amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'o@example.invalid',otpMailbox:'m@example.invalid'}}),'card').account;
    const device=ok(await call('/api/finance/collectors',{method:'POST',token:owner,body:{name:'Fictional PC',accountIds:[card._id]}}),'collector');
    const deviceToken=device.token,deviceId=device.id;
    const vault=await import(u('collector/vault.mjs')),authz=await import(u('collector/omf-authorization.mjs')),idx=await import(u('collector/index.mjs')),browserModule=await import(u('collector/browser.mjs'));
    const store=new vault.SplitStore(collectorDir),generation=hex(32),installationId=hex(16),verifier=crypto.randomBytes(32).toString('base64url');
    const localKey=await store.withLock(()=>store.deviceKey(generation,{create:true}));
    const trustToken=await store.withLock(()=>store.trustCredential(generation,{create:true}));
    // the key-service transport over loopback http (securityCall itself requires https); every call is recorded
    const keyCalls=[];
    const securityHttp=async(route,{body,grant,token=deviceToken,signal}={})=>{keyCalls.push({route:route.split('/')[0],method:body===undefined?'GET':'POST'});const r=await fetch(origin+'/api/finance/collector-security/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(grant?{'X-Collector-Grant':grant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.statusMessage||'OMF did not authorize this action.'),{status:r.status});return data;};
    const transport=(config,route,options={})=>securityHttp(route,options);
    const request=await securityHttp('requests',{body:{action:'enroll',installationId,generation,publicKey:localKey.publicKey,trustHash:sha256(trustToken),state:hex(32),codeChallenge:crypto.createHash('sha256').update(verifier).digest('base64url'),redirectUri:'http://127.0.0.1:49123/collector-callback'}});
    const approved=ok(await call('/api/finance/collector-security/requests/'+request.id,{method:'POST',token:owner,body:{password:OWNER_PASSWORD,code:''}}),'owner approval');
    const exchanged=await securityHttp('exchange',{body:{id:request.id,code:new URL(approved.redirectUri).searchParams.get('code'),verifier}});
    assert.ok(/^[a-f0-9]{64}$/.test(exchanged.grant),'enrolled grant');
    const grantRow=await db.collection('collectorgrants').findOne({_id:sha256(exchanged.grant)});assert.deepEqual(grantRow.accountIds.map(String),[String(card._id)],'the grant names the card only');
    const installation=await db.collection('collectorinstallations').findOne({_id:installationId});assert.deepEqual(installation.accountIds.map(String),[String(card._id)]);
    pass('card-only PC pairing: real enrollment through the security routes with the collector\'s DPAPI device key; grant and installation name the card only');
    // ── the owner adds the bank account to the already-paired PC (the real current flow) ──
    const bank=ok(await ownerReq('bank/accounts',{name:'楽天銀行 普通',currency:'JPY'}),'bank account').account.id;
    const paypay=ok(await ownerReq('bank/accounts',{name:'PayPay 普通',currency:'JPY'}),'bank account 2').account.id;
    ok(await ownerReq('bank/accounts/'+bank+'/connection',{provider:'rakuten',variant:'standard',accountLabel:'カクウホールディングス',coverage:{from:'2025-11-01',to:'2026-10-01'}},'PUT'),'standard connection');
    const template=ok(await ownerReq('bank/templates',{name:'Fictional map',headers:['日付','摘要','金額'],mapping:{date:'0',description:'1',amount:'2'}},'PUT'),'template').template;
    ok(await ownerReq('bank/accounts/'+paypay+'/connection',{provider:'paypay',templateId:template.id},'PUT'),'paypay connection');
    const foreign=ok(await ownerReq('bank/accounts',{name:'他人の楽天銀行',currency:'JPY'},'POST',stranger),'foreign bank').account.id;
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[bank]},'PUT'),'bank scope added after pairing');
    // The behavioural core first, before any new route: the collector's own SplitStore seals the bank entry rakuten-<id> through the
    // real key service on the card-only grant — the shared binding must accept exactly this owner/device-scoped bank account.
    const accountInfo0=ok(await call('/api/finance/collector/accounts',{token:deviceToken}),'collector accounts').accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
    const config0={baseUrl:PUBLIC,token:deviceToken,accountInfo:accountInfo0},abort0=new AbortController();
    const broker0={generation,localKey,remote:authz.keyService(config0,{grant:exchanged.grant,expiresAt:exchanged.expiresAt,installationId,generation},abort0.signal,{call:transport})};brokers.push(broker0);
    const bankAad=vault.aadOf({installationId,origin:PUBLIC,ownerId:String(grantRow.ownerId),provider:'rakuten',accountId:bank});
    let sealError=null;try{await store.withLock(()=>store.save('rakuten-'+bank,bankAad,{username:FICT_USER,password:FICT_PASS},broker0));}catch(error){sealError=error;}
    assert.equal(sealError,null,'auto:bank-key-accepted (the owner/device-scoped 楽天銀行 key was refused by the shared binding: '+(sealError&&(sealError.status+' '+sealError.message))+')');
    assert.deepEqual(await store.open('rakuten-'+bank,bankAad,broker0),{username:FICT_USER,password:FICT_PASS},'auto:bank-key-opens');
    pass('the collector\'s SplitStore seals and reopens the bank entry rakuten-<id> through the real key service on the card-only grant (bank scope added after pairing)');
    const collectorGet=route=>call('/api/finance-payments/collector/'+route,{token:deviceToken});
    const listed=ok(await collectorGet('bank/accounts'),'collector bank/accounts');
    assert.deepEqual(listed.accounts,[{_id:bank,name:'楽天銀行 普通',ownerId:String(grantRow.ownerId),provider:'rakuten',variant:'standard'}],'auto:bank-metadata (only the granted account, minimal fields)');
    assert.equal((await call('/api/finance-payments/collector/bank/accounts',{token:'omfc_'+'0'.repeat(64)})).status,401,'auto:bank-metadata-needs-device');
    assert.equal((await call('/api/finance-payments/collector/bank/accounts',{token:owner})).status,401,'auto:bank-metadata-not-owner-token');
    pass('bank scope added to the paired PC without a new connection; the collector lists exactly that account (id, name, owner, provider, variant) and nothing for another token');
    // ── the one-time save through the setup core into the real SplitStore and the real key-service client ──
    const accountInfo=ok(await call('/api/finance/collector/accounts',{token:deviceToken}),'collector accounts').accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
    const config={baseUrl:PUBLIC,token:deviceToken,accountInfo,accounts:{},mode:'protected'};
    const brokerOf=approval=>{const abort=new AbortController(),broker={generation,localKey,remote:authz.keyService(config,{grant:approval.grant,expiresAt:approval.expiresAt,installationId,generation},abort.signal,{renew:()=>securityHttp('session',{body:{installationId,generation,trustToken}}),call:transport})};brokers.push(broker);return {mode:'protected',installationId,broker,abort};};
    const live=brokerOf(exchanged);
    const banks=async()=>ok(await collectorGet('bank/accounts'),'bank metadata').accounts;
    const write=(id,aad,value)=>store.withLock(()=>store.save(id,aad,value,live.broker));
    const before=keyCalls.length;
    assert.deepEqual(await idx.saveBankLogin(idx.bankLoginInput({bankAccountId:bank,username:FICT_USER,password:FICT_PASS}),{live,config,banks,write,root:collectorDir}),{saved:true});
    assert.deepEqual(keyCalls.slice(before).map(c=>c.route+':'+c.method),['keys:POST','keys:GET'],'auto:save-put-then-read-back');
    const sealedFile=path.join(collectorDir,'secrets','rakuten-'+bank+'.sealed'),sealed=await fsp.readFile(sealedFile,'utf8');
    assert.ok(!sealed.includes(FICT_PASS)&&!sealed.includes(FICT_USER),'auto:ciphertext-only');
    const wrapped=await db.collection('collectorwrappedkeys').findOne({entryId:'rakuten-'+bank});assert.ok(wrapped,'auto:wrapped-key-held-by-omf');assert.ok(!JSON.stringify(wrapped).includes(FICT_PASS),'auto:server-holds-no-password');
    assert.deepEqual(vault.entryBinding(JSON.parse(sealed)),vault.aadOf({installationId,origin:PUBLIC,ownerId:String(grantRow.ownerId),provider:'rakuten',accountId:bank}),'auto:entry-bound-to-the-account');
    for(const [label,id,code] of [['not granted',paypay,'forbidden'],['other owner',foreign,'forbidden']])await assert.rejects(idx.saveBankLogin(idx.bankLoginInput({bankAccountId:id,username:'u',password:'p'}),{live,config,banks,write,root:collectorDir}),e=>e.code===code,'auto:setup-refused '+label);
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[bank,paypay]},'PUT'),'paypay scope');
    await assert.rejects(idx.saveBankLogin(idx.bankLoginInput({bankAccountId:paypay,username:'u',password:'p'}),{live,config,banks,write,root:collectorDir}),e=>e.code==='unsupported','auto:setup-refused unsupported');
    assert.equal(fs.existsSync(path.join(collectorDir,'secrets','rakuten-'+paypay+'.sealed')),false);
    // the card login of the same pairing still saves and opens next to the bank login (shared key boundary, unchanged)
    const cardAad=vault.aadOf({installationId,origin:PUBLIC,ownerId:String(grantRow.ownerId),provider:'amex',accountId:String(card._id)});
    await write('amex-'+card._id,cardAad,{username:'fictional-card-user',password:'Fictional-Card-0001'});
    assert.deepEqual(await store.open('amex-'+card._id,cardAad,live.broker),{username:'fictional-card-user',password:'Fictional-Card-0001'},'auto:card-login-unchanged');
    pass('one-time save: the exact granted 楽天銀行 標準 account sealed in the real SplitStore (put + read-back), ciphertext only, OMF holds only the wrapped key; ungranted, foreign and unsupported accounts refused; the card login of the same pairing still saves and opens');
    // ── two independent automatic retrievals ──
    const site=portal(),launches=[];
    const retrieval=async(label,session,batch)=>{
      const job=ok(await ownerReq('bank/accounts/'+bank+'/sync',{}),'sync '+label).job;assert.equal(job.kind,'retrieve');
      const callsAtClaim=keyCalls.length,claimed=await idx.claimWork(config,null);assert.equal(claimed.bank?.job?.jobId,job.jobId,'claimed '+label);
      const login=idx.bankLoginFor(claimed.bank,config,session,{store,root:collectorDir,assert:l=>{if(l.abort.signal.aborted)throw Object.assign(new Error('The connection has ended. Reconnect this PC.'),{code:'forbidden'});}});
      assert.ok(login,'a saved-login handle for the claimed standard retrieval');assert.equal(await login.state(),'ready');
      const statuses=[];const status=async(state,message)=>{statuses.push(state);ok(await call('/api/finance-payments/collector/bank/status',{method:'POST',token:deviceToken,body:{jobId:job.jobId,state,message}}),'status '+state);};
      const postsBefore=site.loginPosts.length,launchesBefore=launches.length;
      const outcome=await idx.runBankJob(claimed.bank,config,null,{status,login,onLaunch:site.onLaunch(launches),batch,directory:collectorDir});
      assert.equal(outcome.failed,null,'auto:retrieval-complete '+label+' '+JSON.stringify(outcome));
      assert.ok(!statuses.includes('verification_required'),'auto:no-manual-attention '+label+' '+statuses.join('→'));
      assert.deepEqual(site.loginPosts.slice(postsBefore).map(p=>p.ok),[true],'auto:one-login-submission '+label);
      assert.deepEqual(site.loginPosts.at(-1).fields,['LOGIN:LOGIN_PASSWORD','LOGIN:USER_ID','LOGIN_SUBMIT'],'auto:exact-form-fields');
      assert.deepEqual(keyCalls.slice(callsAtClaim).map(c=>c.route+':'+c.method),['keys:GET'],'auto:one-key-release-per-retrieval '+label);
      assert.equal(launches.length-launchesBefore,1,'auto:one-owned-browser '+label);
      assert.equal(browserModule.ownedBrowsers().filter(b=>b.connected).length,0,'auto:browser-closed '+label);
      assert.equal(fs.existsSync(path.join(collectorDir,'profiles','ephemeral')) ? fs.readdirSync(path.join(collectorDir,'profiles','ephemeral')).length : 0,0,'auto:ephemeral-profile-removed '+label);
      const row=await db.collection('financebankjobs').findOne({jobId:job.jobId});assert.equal(row.state,'complete','auto:job-complete '+label);
      return {job,statuses,row};
    };
    const first=await retrieval('first',live,'n1');
    const captures=await db.collection('financebankstatements').find({'capture.bankAccountId':bank}).toArray();assert.equal(captures.length,1,'one capture');assert.equal(captures[0].capture.state,'imported','auto:capture-imported');assert.equal(captures[0].capture.jobId,first.job.jobId,'auto:capture-own-job');
    const expected=ROWS.filter(([d])=>{const iso=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6);return iso>='2025-11-01'&&iso<='2026-10-01';}).length;
    const rowCount=()=>db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(bank)});
    assert.equal(await rowCount(),expected,'auto:native-rows');
    pass('first retrieval: claimed standard job, the saved login opened once (one key release), the exact public form submitted once, no manual attention, native CSV uploaded and imported, the owned background browser closed and its profile removed');
    // the remembered PC renews silently (a new grant, still card-only) and the second job uses the saved login again
    const renewed=await securityHttp('session',{body:{installationId,generation,trustToken}});
    assert.deepEqual((await db.collection('collectorgrants').findOne({_id:sha256(renewed.grant)})).accountIds.map(String),[String(card._id)],'renewed grant still card-only');
    const second=await retrieval('second',brokerOf(renewed),'n2');
    assert.equal(await rowCount(),expected,'auto:repeat-no-duplicate-rows');
    assert.equal(site.downloads.length,2,'two exports');assert.ok(site.downloads.every(d=>d.format==='native'&&d.from==='2025-11-01'&&d.to==='2026-10-01'),'auto:native-format-period');
    assert.deepEqual(site.foreign,[],'auto:no-foreign-request');
    pass('second independent retrieval after the first browser closed, on a renewed remembered-PC grant: saved login used again automatically (one submission, one key release), the identical source deduplicated (no new rows), period and native format preserved, no foreign request');
    const daemon=await runningCollectorLeg({temp,collectorDir,origin,config,store,vault,installationId,generation,localKey,broker:live.broker,bank,ownerReq,ok,db,pass});
    // ── changes after the save stop the release; the card key and the restored bank key keep working ──
    const s1=brokerOf(await securityHttp('session',{body:{installationId,generation,trustToken}}));const fresh=()=>idx.bankLoginFor({job:{kind:'retrieve',snapshot:second.row.snapshot,provider:'rakuten'},account:{_id:bank,ownerId:String(grantRow.ownerId)}},config,s1,{store,root:collectorDir,assert:()=>{}});
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[paypay]},'PUT'),'scope removed');
    await assert.rejects(fresh().open(),e=>e.code==='bank-login-unavailable','auto:removed-scope-no-release');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[bank]},'PUT'),'scope restored');
    ok(await ownerReq('bank/accounts/'+bank+'/connection',{provider:'rakuten',variant:'plus',templateId:template.id},'PUT'),'variant changed');
    await assert.rejects(fresh().open(),e=>e.code==='bank-login-unavailable','auto:variant-change-no-release');
    ok(await ownerReq('bank/accounts/'+bank+'/connection',{provider:'rakuten',variant:'standard',accountLabel:'カクウホールディングス',coverage:{from:'2025-11-01',to:'2026-10-01'}},'PUT'),'variant restored');
    assert.deepEqual(await fresh().open(),{username:FICT_USER,password:FICT_PASS},'auto:restored-release');
    assert.deepEqual(await store.open('amex-'+card._id,cardAad,s1.broker),{username:'fictional-card-user',password:'Fictional-Card-0001'},'auto:card-key-unaffected');
    ok(await call('/api/finance/collectors/'+deviceId,{method:'DELETE',token:owner}),'device revoked');
    await assert.rejects(fresh().open(),e=>[401,403].includes(e.status)||e.code==='bank-login-unavailable','auto:revoked-device-no-release');
    pass('after the save, a removed bank scope and a variant change stop the release (controlled bank-login failure); restored, it releases again; the card key on the same grant is unaffected; a revoked PC releases nothing');
    console.log(JSON.stringify({pass:true,checks,keyCalls:keyCalls.length+daemon.keyCalls,loginSubmissions:site.loginPosts.length+daemon.loginSubmissions,exports:site.downloads.length+daemon.exports,daemon,bankRequests:0,productionWrites:0}));
  }finally{
    for(const b of brokers)await b.remote.end().catch(()=>{});
    await (await import(u('collector/browser.mjs'))).closeOwnedBrowsers().catch(()=>{});
    if(client)await client.close().catch(()=>{});
    if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}
    if(mongo)await mongo.stop().catch(()=>{});
    if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={portal};
if(require.main===module)main().then(()=>0,error=>{console.error(String(error&&error.stack||error).slice(0,3000));return 1;}).then(code=>{process.stdout.write('',()=>process.exit(code));});

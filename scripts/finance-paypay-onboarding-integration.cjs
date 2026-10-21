'use strict';
// scripts/finance-paypay-onboarding-integration.cjs — plan omf-paypay-four-accounts-20261021: the owned native walkthrough of four
// PayPay銀行 標準ログイン accounts (all one owner). The BUILT app (.output) on its own ephemeral MongoDB; a real card-only PC enrollment
// through the real collector-security routes with the collector's real DPAPI device key (collector/vault.mjs SplitStore on a temp
// collector directory); four bank accounts "PayPay 1-4" connected WITHOUT an uploaded template, plus a BA-PLUS account; the bank scope
// added to the paired PC; the REAL collector process (run.mjs: setup HTTP, remembered-PC resume, its own tick) and its real setup page
// driven in owned headless Chrome to save the four logins once; four guided first captures through the daemon's own claim → runBankJob →
// observeBankPortal on a fake PayPay site served by request interception at https://login.paypay-bank.co.jp (and the public homepage),
// the "person" acting inside the owned page; the unmapped captures retained needs_review; native mapping with the existing importer; a
// mapped later capture imported (plan P1: no captured file proves the automatic sign-in, so each account stays 'uncertain' until the owner
// presses the real setup page's per-account retry — no decryption, no job — and the next requested job submits once); the bank refusing
// one account's changed password, that account blocked as 'refused' (no retry offered) until it is saved again; scope,
// login type and revocation stopping the key release. Only the subprocess transport and Chrome network are intercepted. Fictional people,
// accounts and passwords only; no bank, production database or business send. Run by scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs
// through the hub verifier; prints PASS lines and a final receipt.
const assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms)),u=rel=>pathToFileURL(path.join(root,rel)).href;
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex'),hex=n=>crypto.randomBytes(n).toString('hex');
const OWNER_PASSWORD='Synthetic-password-Only1!',PUBLIC='https://omf.example.invalid';
// Four fictional PayPay standard logins: leading zeros, spaces and symbols in the passwords; each must reach the bank exactly.
const LOGINS=[{branch:'001',account:'0000101',password:'Fictional-1 '},{branch:'010',account:'0100202',password:' Fictional 2/<>'},{branch:'100',account:'1000303',password:'Fict3-'+'x'.repeat(26)},{branch:'009',account:'0090404',password:'Fict"4&'}];
const HEAD='日付,内容,出金金額,入金金額,残高';

// ── The fake PayPay site: the public standard login form (PAYPAY-PUBLIC-ENTRY facts), a generated per-document submit handler, an
// invented post-login page with a statement link and an invented CSV export (the actual authenticated controls are NOT known; these
// fictional pages only give the person something to export). The scenario file sets the bank's accepted passwords and the person. ──
const LOGIN_ORIGIN='https://login.paypay-bank.co.jp',HOME='https://www.paypay-bank.co.jp',ENTRY='/wctx/1D1DFxFDg.do',ACTION='/wctx/NBCW2101.do',TOP='/wctx/NBG000Top.do',MEISAI='/wctx/NBG777Meisai.do',CSV_PATH='/wctx/NBG777Csv.do';
function loginDoc(error=''){
  const fn='j'+hex(8),token=hex(8);
  return {token,html:`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン｜PayPay銀行</title><body>${error?`<p class="err">${error}</p>`:''}
<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return ${fn}(document.HOST)" target="_self"><input type="hidden" name="SessionToken" value="${token}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> ログインパスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form>
<a href="${HOME}/cn_login.html">ログインできません</a> <a href="/balogin_L.html">BA-PLUS専用ログイン</a>
<script>function ${fn}(f){var h=document.createElement('input');h.type='hidden';h.name='Chk';h.value='gen-${token}';f.appendChild(h);return true;}</script></body></html>`};
}
function site(scenarioFile,metricFile){
  const s={docs:[],posts:[],downloads:[],foreign:[],requests:0,session:null,exports:0};
  const scenario=()=>{try{return JSON.parse(fs.readFileSync(scenarioFile,'utf8'));}catch{return {};}};
  const save=()=>fs.writeFileSync(metricFile,JSON.stringify({posts:s.posts,downloads:s.downloads,foreign:s.foreign,requests:s.requests}));
  s.respond=request=>{
    s.requests++;let url;try{url=new URL(request.url());}catch{save();return request.abort();}
    const html=body=>request.respond({status:200,contentType:'text/html; charset=utf-8',body});
    try{
      if(url.origin===HOME){if(url.pathname==='/')return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>PayPay銀行</title><body><a href="javascript:void(0)">ログイン</a></body></html>');return request.abort();}
      if(url.origin!==LOGIN_ORIGIN){s.foreign.push(url.origin);return request.abort();}
      if(url.pathname===ENTRY){const d=loginDoc();s.docs.push(d);return html(d.html);}
      if(url.pathname===ACTION&&request.method()==='POST'){
        const body=new URLSearchParams(request.postData()||''),doc=s.docs.find(d=>d.token===body.get('SessionToken')),sc=scenario();
        const passwords=sc.passwords||LOGINS.map(l=>l.password),index=LOGINS.findIndex((l,i)=>l.branch===body.get('TenNo')&&l.account===body.get('KozaNo')&&passwords[i]===body.get('Pw'));
        s.posts.push({index,ok:index>=0,keys:[...body.keys()].sort(),fresh:!!doc&&doc===s.docs.at(-1),handler:!!doc&&body.get('Chk')==='gen-'+doc.token});
        if(index<0){const d=loginDoc('店番号・口座番号またはパスワードが正しくありません');s.docs.push(d);return html(d.html);}
        s.session=index;return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン中</title><body><script>location.replace('+JSON.stringify(TOP)+')</script></body></html>');
      }
      if(url.pathname===TOP&&s.session!==null)return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>PayPay銀行 トップ</title><body><a href="#">ログアウト</a> <a id="meisai" href="${MEISAI}">入出金明細（架空）</a></body></html>`);
      if(url.pathname===MEISAI&&s.session!==null)return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>入出金明細（架空）</title><body><a href="#">ログアウト</a> <a id="csv" href="${CSV_PATH}">CSVダウンロード（架空）</a></body></html>`);
      if(url.pathname===CSV_PATH&&s.session!==null){s.exports++;const i=s.session,n=s.exports,rows=[HEAD,`2026/10/${String(n).padStart(2,'0')},架空取引 PayPay${i+1}-${n},,${1000*(i+1)+n},${100000+n}`];s.downloads.push({index:i,n});
        return request.respond({status:200,contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="meisai.csv"'},body:Buffer.from(rows.join('\r\n')+'\r\n')});}
      return request.abort();
    }finally{save();}
  };
  // The person, acting inside the owned page on their own time: opens the statement page, exports once, closes the tab; on a refused
  // login (the form again after the submission) or when told to, closes the tab without exporting.
  s.person=page=>{
    page.on('load',()=>{let p='',at='';try{at=page.url();p=new URL(at).pathname;}catch{return;}const sc=scenario();
      const later=(ms,fn)=>setTimeout(()=>Promise.resolve().then(fn).catch(()=>{}),ms);
      // closes only when the page is still where the person decided to close it (a success passes through the action path)
      const closeIfStill=async(check)=>{if(page.isClosed()||page.url()!==at)return;if(check&&!(await page.$(check)))return;await page.close();};
      if(p===TOP)later(400,()=>page.click('#meisai'));
      else if(p===MEISAI)later(400,async()=>{await page.click('#csv');later(3000,()=>page.close());});
      else if(p===ACTION)later(2500,()=>closeIfStill('form[name="HOST"]'));
      else if((p===ENTRY&&sc.closeAtLogin)||at.startsWith(HOME))later(4000,()=>closeIfStill(null));
    });
  };
  return s;
}

async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
  assert.equal(process.platform,'win32','the collector vault (DPAPI) and owned Chrome need Windows');
  if(!fs.existsSync(path.join(root,'.output/server/index.mjs')))throw Error('built app absent; build OMF first');
  let mongo,app,client,daemon,checks=0,logs='';const pass=name=>{checks++;console.log('PASS '+name);};
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-paypay-onboarding-')),collectorDir=path.join(temp,'collector');await fsp.mkdir(collectorDir,{recursive:true});
  process.env.OMF_COLLECTOR_DIR=collectorDir;
  const brokers=[];let setupBrowser=null;
  try{
    const systemBinary=[path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),path.join(root,'..','node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p=>fs.existsSync(p));
    mongo=await MongoMemoryServer.create({binary:systemBinary?{systemBinary,version:'8.2.1'}:undefined});
    const dbName='paypay_onboarding_isolated',uri=mongo.getUri(dbName),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
    app=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:path.join(temp,'data'),JWT_SECRET:hex(32),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_COLLECTOR_PUBLIC_ORIGIN:PUBLIC},stdio:['ignore','pipe','pipe']});
    for(const stream of [app.stdout,app.stderr])stream.on('data',v=>{logs=(logs+v).slice(-15000);});
    let healthy=false;for(let i=0;i<150;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected&&d.database.name===dbName){healthy=true;break;}}catch{}await pause(200);}
    assert.ok(healthy,'owned app health: '+logs.slice(-1200));
    const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=String(input&&input.url&&typeof input!=='string'&&!(input instanceof URL)?input.url:input);return realFetch(url.startsWith(PUBLIC+'/')?origin+url.slice(PUBLIC.length):input,init);};
    client=await MongoClient.connect(uri);const db=client.db(dbName);
    const call=async(route,{method='GET',token,body,headers={}}={})=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};};
    const ok=(r,label)=>{assert.equal(r.status,200,label+' '+JSON.stringify(r.data).slice(0,500));return r.data;};
    const register=async email=>ok(await call('/api/auth/register',{method:'POST',body:{email,password:OWNER_PASSWORD,name:'Fictional owner'}}),'register').tokens.accessToken;
    const owner=await register('paypay-owner@example.invalid'),stranger=await register('paypay-other@example.invalid');
    const ownerReq=(route,body,method='POST',token=owner)=>call('/api/finance-payments/'+route,{method,token,body});
    // ── the bank accounts, connected without any uploaded file (the behavioural core: unchanged code requires a template here) ──
    const P=[];for(let i=1;i<=4;i++)P.push(ok(await ownerReq('bank/accounts',{name:'PayPay '+i,currency:'JPY'}),'bank account '+i).account.id);
    for(const [i,id] of P.entries()){const r=await ownerReq('bank/accounts/'+id+'/connection',{provider:'paypay',variant:'standard',accountLabel:'PayPay '+(i+1)},'PUT');assert.equal(r.status,200,'paypay:template-free-connection (the first guided capture must not need an uploaded template) '+r.status+' '+JSON.stringify(r.data).slice(0,300));assert.equal(r.data.account.connection.templateId,null,'paypay:template-free-connection');}
    const baTemplate=ok(await ownerReq('bank/templates',{name:'Fictional BA-PLUS map',headers:['日付','摘要','金額'],mapping:{date:'0',description:'1',amount:'2'}},'PUT'),'template').template;
    const BA=ok(await ownerReq('bank/accounts',{name:'PayPay BA-PLUS',currency:'JPY'}),'ba account').account.id;
    ok(await ownerReq('bank/accounts/'+BA+'/connection',{provider:'paypay',variant:'baplus',templateId:baTemplate.id},'PUT'),'ba connection');
    const foreign=ok(await ownerReq('bank/accounts',{name:'他人のPayPay',currency:'JPY'},'POST',stranger),'foreign').account.id;
    assert.equal(await db.collection('financebanktemplates').countDocuments({}),1,'paypay:no-template-created-for-standard');
    pass('four PayPay標準 accounts connected without an uploaded file (no template created); BA-PLUS keeps its mapped connection');
    // ── card-only PC pairing, then the bank scope added (the real current flow) ──
    const card=ok(await call('/api/finance/accounts',{method:'POST',token:owner,body:{name:'Fictional Amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'o@example.invalid',otpMailbox:'m@example.invalid'}}),'card').account;
    const device=ok(await call('/api/finance/collectors',{method:'POST',token:owner,body:{name:'Fictional PC',accountIds:[card._id]}}),'collector');
    const deviceToken=device.token,deviceId=device.id;
    const vault=await import(u('collector/vault.mjs')),authz=await import(u('collector/omf-authorization.mjs')),idx=await import(u('collector/index.mjs')),browserModule=await import(u('collector/browser.mjs'));
    const store=new vault.SplitStore(collectorDir),generation=hex(32),installationId=hex(16),verifier=crypto.randomBytes(32).toString('base64url');
    const localKey=await store.withLock(()=>store.deviceKey(generation,{create:true}));
    const trustToken=await store.withLock(()=>store.trustCredential(generation,{create:true}));
    const keyCalls=[];
    const securityHttp=async(route,{body,grant,token=deviceToken,signal}={})=>{keyCalls.push({route:route.split('/')[0],method:body===undefined?'GET':'POST'});const r=await fetch(origin+'/api/finance/collector-security/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(grant?{'X-Collector-Grant':grant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.statusMessage||'OMF did not authorize this action.'),{status:r.status});return data;};
    const transport=(config,route,options={})=>securityHttp(route,options);
    const request=await securityHttp('requests',{body:{action:'enroll',installationId,generation,publicKey:localKey.publicKey,trustHash:sha256(trustToken),state:hex(32),codeChallenge:crypto.createHash('sha256').update(verifier).digest('base64url'),redirectUri:'http://127.0.0.1:49123/collector-callback'}});
    const approved=ok(await call('/api/finance/collector-security/requests/'+request.id,{method:'POST',token:owner,body:{password:OWNER_PASSWORD,code:''}}),'owner approval');
    const exchanged=await securityHttp('exchange',{body:{id:request.id,code:new URL(approved.redirectUri).searchParams.get('code'),verifier}});
    const grantRow=await db.collection('collectorgrants').findOne({_id:sha256(exchanged.grant)});assert.deepEqual(grantRow.accountIds.map(String),[String(card._id)],'the grant names the card only');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[...P,BA]},'PUT'),'bank scope added after pairing');
    const listed=ok(await call('/api/finance-payments/collector/bank/accounts',{token:deviceToken}),'collector bank/accounts').accounts;
    assert.deepEqual(listed.map(a=>[a.name,a.provider,a.variant]).sort(),[['PayPay 1','paypay','standard'],['PayPay 2','paypay','standard'],['PayPay 3','paypay','standard'],['PayPay 4','paypay','standard'],['PayPay BA-PLUS','paypay','baplus']],'paypay:collector-bank-metadata');
    pass('card-only PC pairing (real enrollment, DPAPI device key); the five PayPay accounts added to the paired PC; the collector lists exactly them (metadata only)');
    // ── the real collector process: remembered-PC resume, its setup page, its tick ──
    const accountInfo=ok(await call('/api/finance/collector/accounts',{token:deviceToken}),'collector accounts').accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
    const config={baseUrl:PUBLIC,token:deviceToken,accountInfo,accounts:{},mode:'protected'};
    const brokerOf=approval=>{const abort=new AbortController(),broker={generation,localKey,remote:authz.keyService(config,{grant:approval.grant,expiresAt:approval.expiresAt,installationId,generation},abort.signal,{renew:()=>securityHttp('session',{body:{installationId,generation,trustToken}}),call:transport})};brokers.push(broker);return {mode:'protected',installationId,broker,abort};};
    const live=brokerOf(exchanged),ownerId=String(grantRow.ownerId);
    const activatedAt=new Date().toISOString(),protection={installationId,generation,keyProvider:'CurrentUser DPAPI + OMF',publicKey:localKey.publicKey,activatedAt};
    await store.withLock(async()=>{
      await store.save('check',vault.aadOf({installationId,origin:PUBLIC,ownerId,provider:'check',accountId:'check'}),{canary:hex(16)},live.broker);
      await new vault.Vault(collectorDir).update(()=>({...config,accounts:{},services:{},protection,paused:true}));
      await vault.replaceVaultFile(path.join(collectorDir,'vault-state.json'),JSON.stringify({v:3,phase:'active',installationId,generation,publicKey:localKey.publicKey,activatedAt}));
    });
    const dport=await availablePort(),metrics=path.join(temp,'daemon-site.json'),scenarioFile=path.join(temp,'scenario.json'),requests=path.join(temp,'daemon-http.jsonl'),launcher=path.join(temp,'daemon-launcher.mjs');
    await fsp.writeFile(scenarioFile,JSON.stringify({}));
    const script=`import fs from 'node:fs';import {createRequire,registerHooks} from 'node:module';
const require=createRequire(${JSON.stringify(path.join(root,'package.json'))});const {site}=require(${JSON.stringify(__filename)});const fake=site(${JSON.stringify(scenarioFile)},${JSON.stringify(metrics)});
const requestFile=${JSON.stringify(requests)},publicOrigin=${JSON.stringify(PUBLIC)},localOrigin=${JSON.stringify(origin)};
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const value=String(input?.url||input);const mapped=value.startsWith(publicOrigin+'/')?localOrigin+value.slice(publicOrigin.length):value;
const parsed=new URL(mapped);if(parsed.origin!==localOrigin&&parsed.origin!==${JSON.stringify('http://127.0.0.1:'+dport)})throw Error('fixture blocked unexpected fetch');
fs.appendFileSync(requestFile,JSON.stringify({path:parsed.pathname,method:init?.method||'GET'})+'\\n');return realFetch(mapped,init);};
globalThis.__omfFictionalBankLaunch=async(launch,options)=>{const browser=await launch({...options,headless:true,args:(options?.args||[]).filter(a=>a!=='--no-startup-window')});let create=browser.newPage.bind(browser);Object.defineProperty(browser,'newPage',{configurable:true,get(){return async(...args)=>{const page=await create(...args);await page.setRequestInterception(true);page.on('request',request=>fake.respond(request));fake.person(page);return page;};},set(fn){create=fn.bind(browser);}});return browser;};
registerHooks({load(url,context,next){const result=next(url,context);if(url===${JSON.stringify(u('collector/browser.mjs'))})return {...result,source:String(result.source)+'\\nconst fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=options=>globalThis.__omfFictionalBankLaunch(fixtureLaunch,options);\\n'};return result;}});
await import(${JSON.stringify(u('collector/run.mjs'))});`;
    await fsp.writeFile(launcher,script);
    daemon=spawn(process.execPath,[launcher],{cwd:root,windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:collectorDir,OMF_COLLECTOR_PORT:String(dport),OMF_COLLECTOR_TICK_MS:'1000'},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [daemon.stdout,daemon.stderr])stream.on('data',v=>{output=(output+v).slice(-6000)});
    const waitFor=async(read,label,timeout=90000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(daemon.exitCode!==null)throw Error('daemon exited: '+output);const value=await read();if(value)return value;await pause(250);}throw Error('daemon timeout '+label+': '+output.slice(-1500));};
    const setup=await waitFor(async()=>{try{const x=new URL((await fsp.readFile(path.join(collectorDir,'setup-link.txt'),'utf8')).trim());return x.port===String(dport)?x:null}catch{return null}},'setup link');
    const local=async(route,body)=>{const response=await fetch(setup.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Setup-Key':setup.hash.slice(1),Origin:setup.origin},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});return {status:response.status,data:await response.json()};};
    await waitFor(async()=>{const r=await local('/status');return r.status===200&&r.data.startupDone},'startup');
    ok(await local('/resume',{}),'daemon resume');
    await waitFor(async()=>{const r=await local('/status');if(r.data.keyLost||r.data.reconnectNeeded)throw Error('daemon resume: '+r.data.message);return r.data.protected&&r.data.unlocked&&!r.data.busy&&!r.data.authorizing&&!r.data.testBroker},'normal remembered-PC resume');
    const status=async()=>ok(await local('/status'),'daemon status');
    const banksOf=async()=>(await status()).banks;
    assert.deepEqual((await banksOf()).map(b=>[b.name,b.supported,b.hasCredentials]).sort(),[['PayPay 1',true,false],['PayPay 2',true,false],['PayPay 3',true,false],['PayPay 4',true,false],['PayPay BA-PLUS',false,false]],'paypay:setup-status-four-supported');
    // ── the real setup page in owned headless Chrome: four separate one-time saves ──
    setupBrowser=await browserModule.browserFor(path.join(temp,'setup-profile'),{headless:true});
    const page=await setupBrowser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.setRequestInterception(true);page.on('request',r=>{const x=new URL(r.url());return x.origin===setup.origin?r.continue():r.abort();});
    const waitPage=async(f,arg,label)=>{for(let i=0;i<600;i++){if(await page.evaluate(f,arg).catch(()=>false))return;await pause(100);}const direct=await local('/status').then(r=>JSON.stringify({status:r.status,error:r.data?.error,protected:r.data?.protected,unlocked:r.data?.unlocked,busy:r.data?.busy,banks:(r.data?.banks||[]).length,message:r.data?.message})).catch(e=>String(e));throw Error('setup page '+label+': '+String(await page.$eval('#banks',e=>e.innerHTML).catch(()=>'')).slice(0,500)+' | page message: '+(await page.$eval('#connect-message',e=>e.textContent).catch(()=>''))+' | direct /status: '+direct+' | '+pageErrors.join('|'));};
    const section=id=>'[data-bank-login="'+id+'"] ';
    const openSetup=async()=>{await page.goto('about:blank');await page.goto(setup.href,{waitUntil:'networkidle0'});await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[3])+'[data-bank-login-save]','four sections');};
    // Plan P1: the owner's explicit per-account retry in the real setup page. It releases no key (no decryption), queues no job and leaves
    // the inputs empty; only that account's block is lifted.
    let busyRefusals=0;const retryAnswers=[];
    const retryLogin=async i=>{
      await openSetup();await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-retry]','retry offered '+i);
      const keysBefore=keyGets(),jobsBefore=await db.collection('financebankjobs').countDocuments({bankAccountId:new ObjectId(P[i])}),others=(await banksOf()).filter(b=>b.bankAccountId!==P[i]).map(b=>b.pending);
      // The action slot is reserved per click: while the daemon's tick is claiming, the collector answers 'Wait for the current
      // collector action to finish' and changes nothing; the person simply presses the button again.
      // Ground truth: every /bank/retry answer the real page receives (exactly one 200; only 409 busy answers before it).
      const answers=[];const onResponse=r=>{if(new URL(r.url()).pathname==='/bank/retry')answers.push(r.status());};page.on('response',onResponse);
      try{
        for(let attempt=0;;attempt++){
          const seen=answers.length;await page.click(section(P[i])+'[data-bank-login-retry]');
          for(let n=0;answers.length===seen;n++){assert.ok(n<600,'paypay:retry-answered '+i);await pause(100);}
          const answer=answers.at(-1);
          if(answer===200){await waitPage(sel=>!document.querySelector(sel),section(P[i])+'[data-bank-login-retry]','retry done '+i);break;}
          assert.equal(answer,409,'paypay:retry-only-busy-refusals '+i);busyRefusals++;assert.ok(attempt<20,'paypay:retry-eventually-reserved');
          assert.match(await page.$eval(section(P[i])+'[data-bank-login-note]',e=>e.textContent),/Wait for the current collector action/,'paypay:retry-busy-explained');
          await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-retry]','retry re-enabled '+i);await pause(300);
        }
      }finally{page.off('response',onResponse);}
      assert.equal(answers.filter(s=>s===200).length,1,'paypay:retry-one-success '+JSON.stringify(answers));retryAnswers.push(...answers);
      assert.equal(keyGets(),keysBefore,'paypay:retry-no-key-release (no decryption)');assert.equal(await db.collection('financebankjobs').countDocuments({bankAccountId:new ObjectId(P[i])}),jobsBefore,'paypay:retry-queues-nothing');
      assert.deepEqual(await page.$$eval(section(P[i])+'input',l=>l.map(e=>e.value)),['','',''],'paypay:retry-inputs-empty');
      const after=await banksOf();assert.equal(after.find(b=>b.bankAccountId===P[i]).pending,null,'paypay:retry-rearmed '+i);assert.deepEqual(after.filter(b=>b.bankAccountId!==P[i]).map(b=>b.pending),others,'paypay:retry-isolated '+i);
    };
    const saveLogin=async(i,values)=>{await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-save]','save enabled '+i);for(const [name,value] of Object.entries(values))await page.type(section(P[i])+'[data-bank-login-field="'+name+'"]',value);await page.click(section(P[i])+'[data-bank-login-save]');await waitPage(sel=>/saved on this PC/i.test(document.querySelector(sel)?.textContent||''),section(P[i])+'[data-bank-login-note]','saved '+i);assert.deepEqual(await page.$$eval(section(P[i])+'input',l=>l.map(e=>e.value)),['','',''],'paypay:setup-fields-cleared '+i);};
    await openSetup();
    assert.equal(await page.$(section(BA)+'input'),null,'paypay:setup-baplus-no-form');
    for(const [i,l] of LOGINS.entries())await saveLogin(i,l);
    const sealed=P.map(id=>JSON.parse(fs.readFileSync(path.join(collectorDir,'secrets','paypay-'+id+'.sealed'),'utf8')));
    assert.equal(new Set(sealed.map(s=>s.keyId)).size,4,'paypay:four-separate-keys');
    for(const [i,s] of sealed.entries()){assert.deepEqual(vault.entryBinding(s),vault.aadOf({installationId,origin:PUBLIC,ownerId,provider:'paypay',accountId:P[i]}),'paypay:entry-bound-to-its-account '+i);const raw=fs.readFileSync(path.join(collectorDir,'secrets','paypay-'+P[i]+'.sealed'),'utf8');for(const l of LOGINS)assert.ok(!raw.includes(l.account)&&!raw.includes(l.password.trim()),'paypay:ciphertext-only');}
    const wrapped=await db.collection('collectorwrappedkeys').find({entryId:{$regex:'^paypay-'}}).toArray();assert.deepEqual(wrapped.map(w=>w.entryId).sort(),P.map(id=>'paypay-'+id).sort(),'paypay:omf-holds-four-wrapped-keys');
    for(const l of LOGINS)assert.ok(!JSON.stringify(wrapped).includes(l.account)&&!JSON.stringify(wrapped).includes(l.password.trim()),'paypay:server-holds-no-login');
    const afterSave=await status();assert.ok(afterSave.banks.filter(b=>b.supported).every(b=>b.hasCredentials&&!b.refused),'paypay:setup-status-saved');
    const html=await page.content();for(const l of LOGINS)assert.ok(!html.includes(l.account)&&!html.includes(l.password.trim())&&!JSON.stringify(afterSave).includes(l.account),'paypay:no-readback');
    assert.deepEqual(pageErrors,[],'paypay:setup-no-page-errors');
    pass('the real setup page of the real collector process (owned headless Chrome): four separate one-time saves into the real SplitStore through the real key service, fields cleared after each, four distinct sealed entries bound to their own account, OMF holds only the four wrapped keys, no login read back anywhere; BA-PLUS has no form');
    // ── four guided first captures through the daemon's own tick ──
    const reads=()=>fs.existsSync(requests)?fs.readFileSync(requests,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const metric=()=>fs.existsSync(metrics)?JSON.parse(fs.readFileSync(metrics,'utf8')):{posts:[],downloads:[],foreign:[]};
    const keyGets=()=>reads().filter(r=>r.path.includes('/collector-security/keys/')&&r.method==='GET').length;
    const runJob=async(i,label,{expect='complete'}={})=>{
      const before={keys:keyGets(),posts:metric().posts.length,downloads:metric().downloads.length};
      const job=ok(await ownerReq('bank/accounts/'+P[i]+'/sync',{}),'sync '+label).job;assert.equal(job.kind,'observe','paypay:guided-observe '+label);
      const row=await waitFor(async()=>{const r=await db.collection('financebankjobs').findOne({jobId:job.jobId});return r&&['complete','failed'].includes(r.state)?r:null},'job '+label,300000).catch(async error=>{const r=await db.collection('financebankjobs').findOne({jobId:job.jobId}),m=metric();throw Error(error.message.slice(0,300)+' | job: '+JSON.stringify({state:r?.state,lastMessage:r?.lastMessage,collector:!!r?.collectorId})+' | site: '+JSON.stringify({posts:m.posts.length-before.posts,downloads:m.downloads.length-before.downloads,requests:m.requests}))});
      await waitFor(async()=>!(await status()).busy,'idle '+label);
      assert.equal(row.state,expect,'paypay:job-'+expect+' '+label+' '+row.lastMessage);
      const m=metric();return {job,row,keys:keyGets()-before.keys,posts:m.posts.slice(before.posts),downloads:m.downloads.slice(before.downloads)};
    };
    const secretFree=(label,value)=>{const text=JSON.stringify(value);for(const l of LOGINS)assert.ok(!text.includes(l.account)&&!text.includes(l.password.trim()),'paypay:no-secret '+label);};
    const firsts=[];
    for(const i of [0,1,2,3]){
      const r=await runJob(i,'first '+(i+1));firsts.push(r);
      assert.deepEqual(r.posts.map(p=>[p.index,p.ok,p.fresh,p.handler]),[[i,true,true,true]],'paypay:one-submission-own-account '+(i+1));
      assert.deepEqual(r.posts[0].keys,['Chk','KozaNo','Pw','SessionToken','TenNo','login'],'paypay:native-form-fields');
      assert.equal(r.keys,1,'paypay:one-key-release '+(i+1));assert.deepEqual(r.downloads.map(d=>d.index),[i],'paypay:one-export '+(i+1));
      const caps=await db.collection('financebankstatements').find({'capture.jobId':r.job.jobId}).toArray();assert.equal(caps.length,1,'paypay:capture-linked '+(i+1));
      assert.deepEqual([caps[0].capture.bankAccountId,caps[0].capture.state,caps[0].capture.channel,caps[0].capture.sourceHost],[P[i],'needs_review','collector-observe','login.paypay-bank.co.jp'],'paypay:capture-unmapped '+(i+1));
      assert.match(caps[0].capture.reason,/^mapping-required: /,'paypay:mapping-required '+(i+1));
      assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[i])}),0,'paypay:zero-rows '+(i+1));
      const obs=r.row.observation;assert.ok(Array.isArray(obs)&&obs.length>=2,'paypay:observation-stored '+(i+1));secretFree('observation '+(i+1),obs);secretFree('job '+(i+1),r.row);
      assert.ok(!obs.some(p=>(p.typedInto||[]).some(t=>['idTenNo','idKozaNo','idPw','TenNo','KozaNo','Pw'].includes(t.id))),'paypay:automatic-fill-not-recorded-as-typing '+(i+1));
      assert.ok(obs.some(p=>p.pathname===ENTRY&&p.inputs.some(x=>x.id==='idPw'&&x.type==='password')),'paypay:observation-login-page '+(i+1));
      assert.ok(obs.some(p=>p.downloadEvents.some(d=>d.host==='login.paypay-bank.co.jp')),'paypay:observation-download '+(i+1));
      // Deliberate change (plan P1): the kept CSV does not prove the automatic sign-in; the account stays 'uncertain' (retry offered).
      const b=(await banksOf()).find(x=>x.bankAccountId===P[i]);assert.deepEqual([b.hasCredentials,b.refused,b.pending],[true,true,'uncertain'],'paypay:file-not-proof-stays-uncertain '+(i+1));
    }
    assert.equal(new Set(firsts.map(f=>f.row.snapshotHash)).size,4,'paypay:four-interpretations');assert.deepEqual(metric().foreign,[],'paypay:no-foreign-request');
    assert.equal(browserModule.ownedBrowsers().filter(b=>b.connected).length,1,'only the setup browser is owned by this process');
    assert.equal(fs.existsSync(path.join(collectorDir,'profiles','ephemeral'))?fs.readdirSync(path.join(collectorDir,'profiles','ephemeral')).length:0,0,'paypay:ephemeral-profiles-removed');
    pass('four guided first captures through the real tick: each claimed job opened its own saved login once (one key release), submitted the exact public form once with its own values through the page\'s generated handler, the person exported once, the unmapped CSV retained needs_review/mapping-required with zero rows, the observation stored without any login value or typing record, and the kept CSV did NOT clear that account\'s uncertain marker (plan P1)');
    // ── native mapping of PayPay 1, then a mapped later capture with the same saved login ──
    const cap1=(await db.collection('financebankstatements').findOne({'capture.jobId':firsts[0].job.jobId}));
    const sheet=ok(await ownerReq('bank/files/'+cap1._id+'/sheet',undefined,'GET'),'sheet');assert.deepEqual(sheet.headers,HEAD.split(','),'paypay:capture-readable');
    const body={sheet:sheet.sheet,headerRow:sheet.headerRow,mapping:{date:'0',description:'1',outflow:'2',inflow:'3',balance:'4'},bankAccountId:P[0],transactionIdConfirmed:false,confirm:true,templateName:'PayPay 架空マップ'};
    assert.equal(ok(await ownerReq('bank/files/'+cap1._id+'/import',body),'import').rows.length,1,'paypay:mapped-import');
    const tpl=ok(await ownerReq('bank/templates',undefined,'GET'),'templates').templates.find(t=>t.name==='PayPay 架空マップ');
    ok(await ownerReq('bank/accounts/'+P[0]+'/connection',{provider:'paypay',variant:'standard',templateId:tpl.id,accountLabel:'PayPay 1'},'PUT'),'mapped connection');
    await fsp.writeFile(scenarioFile,JSON.stringify({closeAtLogin:true}));
    const unretried=await runJob(0,'unretried 1');await fsp.writeFile(scenarioFile,JSON.stringify({}));assert.equal(unretried.posts.length,0,'paypay:uncertain-blocks-next-job');assert.equal(unretried.keys,0,'paypay:uncertain-no-key-release');
    await retryLogin(0);
    const mapped=await runJob(0,'mapped 1');
    assert.deepEqual(mapped.posts.map(p=>[p.index,p.ok]),[[0,true]],'paypay:saved-login-reused');assert.equal(mapped.keys,1);
    const cap2=await db.collection('financebankstatements').findOne({'capture.jobId':mapped.job.jobId});assert.equal(cap2.capture.state,'imported','paypay:mapped-capture-imported');
    assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[0])}),2,'paypay:mapped-rows');
    for(const i of [1,2,3])assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[i])}),0,'paypay:other-accounts-untouched');
    assert.equal((await banksOf()).find(b=>b.bankAccountId===P[0]).pending,'uncertain','paypay:mapped-job-uncertain-again');
    pass('native mapping: the retained first capture of PayPay 1 imported with the existing importer and saved as a template; while uncertain the next job submitted nothing; after the owner\'s retry in the real setup page (no key release, no job, inputs empty, other accounts untouched) the mapped connection\'s next guided job reused the saved login once (no second entry) and imported its capture; the other three accounts unchanged');
    // ── the bank refuses PayPay 3's saved password: remembered, blocked, re-saved ──
    const changed=LOGINS.map(l=>l.password);changed[2]='Fict3-changed-at-the-bank';
    await fsp.writeFile(scenarioFile,JSON.stringify({passwords:changed}));
    await retryLogin(2);
    const refusedRun=await runJob(2,'refused 3',{expect:'failed'});
    assert.deepEqual(refusedRun.posts.map(p=>[p.index,p.ok]),[[-1,false]],'paypay:refused-one-submission');assert.match(refusedRun.row.lastMessage,/受け付けませんでした/,'paypay:refused-message');
    const afterRefusal=await banksOf();assert.deepEqual(afterRefusal.filter(b=>b.supported).map(b=>b.pending),['uncertain','uncertain','refused','uncertain'],'paypay:refusal-distinguished-and-isolated');
    await fsp.writeFile(scenarioFile,JSON.stringify({passwords:changed,closeAtLogin:true}));
    const blocked=await runJob(2,'blocked 3');assert.equal(blocked.posts.length,0,'paypay:blocked-no-submission');assert.equal(blocked.keys,0,'paypay:blocked-no-key-release');
    await fsp.writeFile(scenarioFile,JSON.stringify({passwords:changed}));
    await openSetup();assert.match(await page.$eval(section(P[2])+'[data-bank-login-note]',e=>e.textContent),/bank refused the saved login/i,'paypay:setup-shows-refusal');assert.equal(await page.$(section(P[2])+'[data-bank-login-retry]'),null,'paypay:refusal-offers-no-retry');
    await saveLogin(2,{...LOGINS[2],password:changed[2]});
    const resaved=await runJob(2,'resaved 3');assert.deepEqual(resaved.posts.map(p=>[p.index,p.ok]),[[2,true]],'paypay:resave-then-success');
    assert.deepEqual((await banksOf()).filter(b=>b.supported).map(b=>b.pending),['uncertain','uncertain','uncertain','uncertain'],'paypay:resave-then-uncertain-again');
    pass('the bank refused PayPay 3\'s changed password (after its retry): one submission, the job failed with re-save guidance, only PayPay 3 marked refused and offered no retry; its next job submitted nothing and released no key; re-saved through the setup page, the next job signed in once and captured (and is uncertain again)');
    // ── BA-PLUS: a plain observe (no saved login, no key) ──
    await fsp.writeFile(scenarioFile,JSON.stringify({passwords:changed,closeAtLogin:true}));
    const keysBefore=keyGets(),postsBefore=metric().posts.length,baJob=ok(await ownerReq('bank/accounts/'+BA+'/sync',{}),'sync ba').job;
    const baRow=await waitFor(async()=>{const r=await db.collection('financebankjobs').findOne({jobId:baJob.jobId});return r&&['complete','failed'].includes(r.state)?r:null},'ba job',120000);
    assert.equal(baRow.state,'complete');assert.equal(keyGets(),keysBefore,'paypay:baplus-no-key');assert.equal(metric().posts.length,postsBefore,'paypay:baplus-no-submission');
    pass('BA-PLUS stays a manual observe: no saved login, no key release, no submission');
    await waitFor(async()=>!(await status()).busy,'idle before pause');
    ok(await local('/pause',{}),'daemon pause');
    // ── after the save: scope, login type and revocation stop the release (in-process, the daemon paused) ──
    const s1=brokerOf(await securityHttp('session',{body:{installationId,generation,trustToken}}));
    const handle=i=>idx.bankLoginFor({job:{kind:'observe',snapshot:firsts[i].row.snapshot,provider:'paypay'},account:{_id:P[i],ownerId}},config,s1,{store,root:collectorDir,assert:()=>{}});
    assert.deepEqual(await handle(1).open(),LOGINS[1],'paypay:own-values-released');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[P[0],P[2],P[3],BA]},'PUT'),'scope removed for PayPay 2');
    await assert.rejects(handle(1).open(),e=>e.code==='bank-login-unavailable','paypay:removed-scope-no-release');assert.deepEqual(await handle(3).open(),LOGINS[3],'paypay:other-account-still-released');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[...P,BA]},'PUT'),'scope restored');
    ok(await ownerReq('bank/accounts/'+P[1]+'/connection',{provider:'paypay',variant:'baplus',templateId:baTemplate.id},'PUT'),'login type changed');
    await assert.rejects(handle(1).open(),e=>e.code==='bank-login-unavailable','paypay:login-type-change-no-release');
    ok(await ownerReq('bank/accounts/'+P[1]+'/connection',{provider:'paypay',variant:'standard',accountLabel:'PayPay 2'},'PUT'),'login type restored');
    assert.deepEqual(await handle(1).open(),LOGINS[1],'paypay:restored-release');
    await assert.rejects(ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[foreign]},'PUT').then(r=>{if(r.status!==200)throw Object.assign(Error('refused'),{status:r.status});}),e=>e.status===400,'paypay:foreign-account-not-grantable');
    ok(await call('/api/finance/collectors/'+deviceId,{method:'DELETE',token:owner}),'device revoked');
    await assert.rejects(handle(0).open(),e=>[401,403].includes(e.status)||e.code==='bank-login-unavailable','paypay:revoked-device-no-release');
    secretFree('omf jobs',await db.collection('financebankjobs').find({}).toArray());secretFree('omf statements',await db.collection('financebankstatements').find({}).project({capture:1,name:1}).toArray());
    pass('after the saves: a removed bank scope and a BA-PLUS change stop that account\'s release (controlled bank-login failure) while another account still releases; restored, it releases again; a foreign account cannot be granted; a revoked PC releases nothing; no login value is stored by OMF');
    const m=metric();
    console.log(JSON.stringify({pass:true,checks,accounts:4,retryBusyRefusals:busyRefusals,retryAnswers,loginSubmissions:m.posts.length,exports:m.downloads.length,keyReleases:keyGets(),foreignRequests:m.foreign.length,bankRequests:0,productionWrites:0}));
  }finally{
    if(daemon&&daemon.exitCode===null){const exited=new Promise(r=>daemon.once('exit',r));daemon.kill();await exited;}
    if(setupBrowser)await setupBrowser.close().catch(()=>{});
    for(const b of brokers)await b.remote.end().catch(()=>{});
    await (await import(u('collector/browser.mjs'))).closeOwnedBrowsers().catch(()=>{});
    if(client)await client.close().catch(()=>{});
    if(app&&app.exitCode===null){const ended=new Promise(r=>app.once('exit',r));app.kill();await ended;}
    if(mongo)await mongo.stop().catch(()=>{});
    if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={site,loginDoc};
if(require.main===module)main().then(()=>0,error=>{console.error(String(error&&error.stack||error).slice(0,3000));return 1;}).then(code=>{process.stdout.write('',()=>process.exit(code));});

import {selectLearningRole,waitForLearningCapture} from './finance-bank-learning-capture-ack.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
const {replayBankLearning,learningDownload}=await import(process.env.OMF_LOGIN_TEST_RUNNER?pathToFileURL(process.env.OMF_LOGIN_TEST_RUNNER).href:'../collector/bank-learning-runner.mjs');
import {learningStore} from '../collector/bank-learning.mjs';
import {stable,validateRecipe} from '../shared/finance-bank-learning.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const sha=v=>createHash('sha256').update(stable(v)).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const identifier='CANARY-LOCAL-ID-117',password='CANARY-PASSWORD-987654',token='CANARY-TOKEN-555',otp='CANARY-OTP-123456';

for(const [manual,navigation,variant]of [[null,false],['otp',false],['certificate',false],['inline-otp',false],['dynamic-otp',false],['persistent-otp',false],[null,true],[null,false,'optional-resource'],[null,false,'native-form-getters'],[null,false,'approved-auth-origin'],[null,false,'native-popup'],[null,false,'iframe']])test('real Chrome: before-login structural recording, DPAPI, generated fresh login/statement replay '+(manual||'credentials')+(navigation?' GET-navigation':'')+(variant?' '+variant:'')+'; failure never resubmits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-login-learning-')),id='a'.repeat(24),store=learningStore(root,id);let submissions=0,authenticated=0;
 const inline=manual==='inline-otp',persistent=manual==='persistent-otp',dynamic=manual==='dynamic-otp'||persistent;
 let origin,assetRequests=0,authPermit=false;
 const auxiliary=http.createServer(async(req,res)=>{
  if(req.url==='/consent'){res.setHeader('Content-Type','text/html');res.end('<p>Fictional authentication endpoint approval</p>');return;}
  if(req.url.startsWith('/signin')&&req.method==='POST'){
   submissions++;let body='';for await(const chunk of req)body+=chunk;const values=new URLSearchParams(body);
   if(values.get('id-'+identifier)===identifier&&values.get('pw-'+password)===password){authPermit=true;res.writeHead(303,{Location:origin+'/authenticated'});res.end();}else{res.writeHead(403);res.end('Refused');}return;
  }
  assetRequests++;res.writeHead(200,{'Content-Type':'image/gif'});res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));
 });
 await new Promise(r=>auxiliary.listen(0,'127.0.0.1',r));const auxiliaryOrigin='http://127.0.0.1:'+auxiliary.address().port;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/authenticated'&&authPermit){authPermit=false;authenticated++;res.setHeader('Set-Cookie','session=fictional-only; HttpOnly; SameSite=Strict');res.writeHead(303,{Location:'/home'});res.end();return;}
  if(req.url.startsWith('/signin')&&req.method==='POST'){
   submissions++;let body='';for await(const chunk of req)body+=chunk;const values=new URLSearchParams(body);
   if(values.get('id-'+identifier)===identifier&&values.get('pw-'+password)===password&&(!inline||values.get('challenge')===otp)){if(!manual||inline)authenticated++;res.setHeader('Set-Cookie',(manual&&!inline?'pending=fictional-only':'session=fictional-only')+'; HttpOnly; SameSite=Strict');res.writeHead(303,{Location:manual&&!inline?'/challenge':'/home?token='+token});res.end();}else{res.writeHead(403);res.end('<p id="failure">Refused '+password+'</p>');}return;
  }
  if(req.url==='/auth-state'){res.writeHead(req.headers.cookie?.includes('session=fictional-only')?204:403);res.end();return;}
  if(manual&&req.url==='/challenge'&&req.headers.cookie?.includes('pending=fictional-only')){res.end('<article><aside><label id="challenge">'+manual+' '+token+'</label><form method="POST" action="/confirm"'+(dynamic?' target="manual-result"':'')+'><input id="otp" name="challenge" autocomplete="one-time-code"><button id="confirm">Complete local check</button></form></aside></article>'+(dynamic?'<iframe name="manual-result" hidden onload="fetch(\'/auth-state\').then(r=>{if(r.ok){document.querySelector(\''+(persistent?'form':'article')+'\').remove();const main=document.createElement(\'main\');main.innerHTML=\'<section><strong id=success>Authenticated</strong></section><button id=inquiry onclick=location.href=&quot;/details&quot;>Inquiry</button>\';document.body.append(main);}})"></iframe>':''));return;}
  if(manual&&req.url==='/confirm'&&req.method==='POST'&&req.headers.cookie?.includes('pending=fictional-only')){let body='';for await(const chunk of req)body+=chunk;if(new URLSearchParams(body).get('challenge')===otp){authenticated++;res.setHeader('Set-Cookie','session=fictional-only; HttpOnly; SameSite=Strict');res.writeHead(303,{Location:'/home'});res.end();}else{res.writeHead(403);res.end('<p>Challenge refused</p>');}return;}
  if(req.url==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0; HttpOnly');res.end('<p>Signed out</p>');return;}
  if(!req.headers.cookie?.includes('session=fictional-only')){if(navigation&&new URL(req.url,'http://localhost').pathname==='/'){res.end('<form method="GET" action="/login"><button id="entry">Open sign in</button></form>');return;}
   const shadow=variant==='native-form-getters',external=variant==='approved-auth-origin';
   if(variant==='iframe'&&new URL(req.url,'http://localhost').pathname==='/'){res.end('<iframe src="/login-frame"></iframe>');return;}
   res.end('<p>'+token+otp+'</p><form method="POST" action="'+(external?auxiliaryOrigin:'')+'/signin?token='+token+'"'+(variant==='native-popup'?' target="_blank"':'')+'>'+(shadow?'<input type="hidden" name="method" value="shadow"><input type="hidden" name="action" value="shadow"><input type="hidden" name="target" value="shadow"><input type="hidden" name="querySelector" value="shadow">':'')+'<input id="identifier" name="id-'+identifier+'" autocomplete="username"><input id="password" name="pw-'+password+'" type="password">'+(inline?'<label id="challenge">Complete local check</label><input id="otp" name="challenge" autocomplete="one-time-code">':'')+'<button id="submit"'+(shadow?' formaction="/signin?override=1" formmethod="POST"':'')+'>Sign in</button></form>'+(external?'<iframe src="'+auxiliaryOrigin+'/consent"></iframe>':'')+(variant==='optional-resource'?'<script>document.querySelector("#identifier").addEventListener("input",()=>{const i=new Image();i.src='+JSON.stringify(auxiliaryOrigin+'/fixed-optional-pixel.gif')+';document.body.append(i);},{once:true});</script>':''));return;}
  if(req.url.startsWith('/csv')){const q=new URL(req.url,'http://localhost').searchParams;res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="fictional.csv"');res.end('date,description,amount\r\n'+q.get('from')+',Synthetic,-1234\r\n');return;}
  if(req.url.startsWith('/home')){res.end('<main><section><strong id="success">Authenticated '+identifier+'</strong></section></main><button id="inquiry" onclick="location.href=\'/details\'">Inquiry</button>');return;}
  res.end('<select id="account"><option value="">Choose</option><option value="PRIVATE-ACCOUNT">Ordinary</option></select><input id="from"><input id="to"><button id="export" onclick="location.href=\'/csv?from=\'+document.querySelector(\'#from\').value+\'&to=\'+document.querySelector(\'#to\').value">CSV</button><span id="balance">100,000</span><button id="logout" onclick="location.href=\'/logout\'">Logout</button>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+Math.random().toString(16).slice(2))});let browser,record;
 try{
  browser=await launch();let page=await browser.newPage();await page.goto(origin+'/?token='+token);
  const download=await learningDownload(browser,path.join(root,'demo-download'),{origins:[origin],demonstration:true});
  const recording=recordBankLearning(browser,page,{entryOrigin:origin,teachLogin:true,test:true,timeout:45000,onExport:()=>{const n=download.beginExport();return()=>download.acceptExport(n);},store:async r=>{await store.update(v=>({...v,record:r}));record=structuredClone(r);}});void recording.catch(()=>{});
  const demonstrationPage=page;if(variant==='iframe')page=page.frames().find(f=>f.parentFrame());
  if(variant==='approved-auth-origin'){
   const frame=page.frames().find(f=>f.url().startsWith(auxiliaryOrigin));assert.ok(frame);
   await frame.waitForSelector('#omf-learning-control button:not([hidden])');await frame.click('#omf-learning-control button:not([hidden])');
   for(let n=0;n<150&&!record?.origins.includes(auxiliaryOrigin);n++)await pause(20);
   assert.deepEqual(record.origins,[origin,auxiliaryOrigin],'explicit local origin approval persisted before any credential action');
  }
  async function operate(role,fn){
   await waitForLearningCapture(page,recording);
   const selector='#omf-learning-control select';await page.waitForSelector(selector);
   if(variant==='iframe'){
    const toggle='#omf-learning-control [data-learning-toggle]';await page.waitForSelector(toggle,{visible:true});
    if(await page.$eval(toggle,e=>e.getAttribute('aria-expanded')==='true'))await page.click(toggle);
    assert.equal(await page.$eval(toggle,e=>e.getAttribute('aria-expanded')),'false');await page.click(toggle);
    await page.waitForSelector(selector,{visible:true});await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));
    assert.equal(await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),true,'visible reachable role selector in default 150px frame');
   }
   await selectLearningRole(page,role,recording);
   if(variant==='iframe'){
    const toggle='#omf-learning-control [data-learning-toggle]';assert.equal(await page.$eval(toggle,e=>e.getAttribute('aria-expanded')),'false','choosing role collapses overlay before actual bank click');
    if(role==='login-identifier'){
     const handle=await page.$(toggle),box=await handle.boundingBox();await handle.dispose();const mouse=demonstrationPage.mouse;
     await mouse.move(box.x+box.width/2,box.y+box.height/2);await mouse.down();await mouse.move(-100,-100,{steps:5});await mouse.up();
     assert.equal(await page.$eval(toggle,e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),true,'drag beyond viewport clamps compact restore handle inside small bank frame');
    }
    const target='#'+role.replace('login-',''),placement=await page.evaluate(target=>{
     const p=document.querySelector('#omf-learning-control').getBoundingClientRect(),t=document.querySelector(target).getBoundingClientRect(),x=t.x+t.width/2,y=t.y+t.height/2;
     const candidates=[[0,0],[innerWidth-p.width,0],[0,innerHeight-p.height],[innerWidth-p.width,innerHeight-p.height]];
     const next=candidates.find(([a,b])=>!(x>=a&&x<=a+p.width&&y>=b&&y<=b+p.height)&&Math.abs(a-p.x)+Math.abs(b-p.y)>4);
     if(!next)throw Error('no-safe-overlay-corner');return{dx:next[0]-p.x,dy:next[1]-p.y};
    },target);
    const handle=await page.$(toggle),box=await handle.boundingBox();await handle.dispose();const mouse=demonstrationPage.mouse;
    await mouse.move(box.x+box.width/2,box.y+box.height/2);await mouse.down();await mouse.move(box.x+box.width/2+placement.dx,box.y+box.height/2+placement.dy,{steps:5});await mouse.up();
    assert.equal(await page.$eval(toggle,e=>e.getAttribute('aria-expanded')),'false','dragging retains collapsed state');
    assert.equal(await page.$eval(target,e=>{const r=e.getBoundingClientRect();return !document.querySelector('#omf-learning-control').contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'visible bank click remains reachable after user drags compact handle');
   }
   const count=record?.events.length||0;await fn();if(['from','to'].includes(role.split(':')[0]))await waitForLearningCapture(page,recording);for(let n=0;n<150&&(record?.events.length||0)===count;n++)await pause(20);
   if(variant==='iframe'&&(record?.events.length||0)===count)console.log('Small-frame overlay diagnostic '+JSON.stringify(await page.evaluate(role=>({role,scrollY,chosen:document.querySelector('#omf-learning-control select').value,boxes:[...document.querySelectorAll('#omf-learning-control,#identifier,#password,#submit')].map(e=>{const b=e.getBoundingClientRect();return {overlay:e.id==='omf-learning-control',x:b.x,y:b.y,width:b.width,height:b.height,covered:document.getElementById('omf-learning-control').contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};})}),role)));
   assert.equal(record?.events.length,count+1,'recorded '+role);
   if(variant==='iframe'&&role.startsWith('login-'))await page.waitForFunction(()=>document.querySelector('#omf-learning-control select')?.value==='');
  }
  if(navigation)await operate('login-navigation',()=>Promise.all([page.waitForNavigation(),page.click('#entry')]));
  await operate('login-identifier',()=>page.click('#identifier'));await page.type('#identifier',identifier);
  await operate('login-password',()=>page.click('#password'));await page.type('#password',password);
  if(inline){await operate('login-manual:otp',()=>page.click('#challenge'));await page.type('#otp',otp);}
  await operate('login-submit',async()=>{if(variant==='native-popup'){const owner=page.target(),next=browser.waitForTarget(t=>t.type()==='page'&&t.opener()===owner,{timeout:10000});await page.click('#submit');page=await(await next).page();await page.waitForSelector('#success');}else await Promise.all([page.waitForNavigation(),page.click('#submit')]);});
  const completeChallenge=async()=>{await page.waitForSelector('#otp');await page.type('#otp',otp);if(dynamic){await page.click('#confirm');await page.waitForSelector('#success');}else await Promise.all([page.waitForNavigation(),page.click(inline?'#submit':'#confirm')]);};
  if(manual&&!inline){await operate('login-manual:'+(dynamic?'otp':manual),()=>page.click('#challenge'));await completeChallenge();}
  await operate('login-success',()=>page.click('#success'));
  await operate('inquiry',()=>Promise.all([page.waitForNavigation(),page.click('#inquiry')]));
  await operate('account',()=>page.select('#account','PRIVATE-ACCOUNT'));
  for(const[role,value]of [['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await page.type('#'+role,value);await page.$eval('#'+role,e=>e.blur());});
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));await operate('logout',()=>Promise.all([page.waitForNavigation(),page.click('#logout')]));
  const finishPage=variant==='iframe'?demonstrationPage:page;await finishPage.waitForSelector('#omf-learning-control button');await finishPage.click('#omf-learning-control button');record=await recording;await download.file();await download.close();
  const evidence=projectEvidence(record,{test:true});
  if(dynamic)assert.equal(evidence.events.find(e=>e.role==='login-manual').document,evidence.events.find(e=>e.role==='login-success').document,'fresh dynamic manual successor may stay in one document');
  if(variant==='approved-auth-origin'){assert.deepEqual(evidence.origins,[origin,auxiliaryOrigin]);assert.ok(evidence.events.every(e=>e.origin===origin),'approved endpoint has no action event');}
  for(const canary of [identifier,password,token,otp,'/signin','/home','name','value','signature','selector','session='])assert.ok(!stable(evidence).includes(canary),'public evidence excludes '+canary);
  // Credentials were never copied into the private generic learning record either.
  for(const canary of [identifier,password,token,otp])assert.ok(!stable(record).includes(canary),'private mapping excludes credential '+canary);
  const encrypted=await readFile(store.file);assert.ok(!encrypted.includes(Buffer.from('nth-of-type')));
  record=(await store.read()).record;const evidenceHash=sha(evidence);
  // Paid product-model calls are explicit opt-in; the default suite makes none.
  const candidate=!manual&&!navigation&&!variant&&process.env.OMF_LOGIN_LEARNING_MODEL_HOOK?await(await import(pathToFileURL(process.env.OMF_LOGIN_LEARNING_MODEL_HOOK).href)).generate(evidence):{schema:2,runtime:evidence.runtime,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};validateRecipe(candidate,evidence,evidenceHash,{test:true});
  await browser.close();browser=await launch();page=await browser.newPage();await page.goto(origin+'/home');assert.ok(await page.$('#password'),'unauthenticated direct successor navigation cannot bypass login');
  if(navigation||variant==='iframe')await page.goto(origin);
  const template={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},options={record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template,directory:path.join(root,'replay-download'),test:true,loginTimeout:500,manualTimeout:1500};
  const localSecret={identifier,password};let requests=0,authenticatedCallbacks=0,persistentSuccess=0;const assetsBeforeReplay=assetRequests;
  let challenge;
  let receipt;try{receipt=await replayBankLearning(browser,page,{...options,onAuthenticated:async()=>{assert.equal(authenticated,2,'authenticated notification follows genuine bank authentication');authenticatedCallbacks++;if(persistent){assert.ok(await page.$('#success'));assert.equal(await page.$eval('#challenge',e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'),true);assert.equal(await page.$('#otp'),null);persistentSuccess++;}},credentials:async()=>{requests++;return localSecret;},status:()=>{challenge=completeChallenge();void challenge.catch(()=>{});},awaitLogin:()=>{throw Error('legacy login must not run');}});}catch(error){if(persistent){console.log('W1-MANUAL '+JSON.stringify({error:error.message,submissions,authenticated,recordComplete:record.complete,success:!!await page.$('#success'),checkpoint:!!await page.$('#challenge')}));assert.fail('fresh authenticated successor must reach CSV while the checkpoint persists');}throw error;}await challenge;
  assert.deepEqual(receipt.authentication,{outcome:'success',mode:manual?'attended':'local-credentials'});assert.equal(receipt.rows,1);assert.equal(requests,1);assert.equal(submissions,2);assert.equal(authenticated,2);assert.deepEqual(localSecret,{identifier:'',password:''});assert.ok(!stable(receipt).includes('CANARY'));
  assert.equal(authenticatedCallbacks,1,'authenticated successor notification emitted once before statement continuation');
  if(persistent)assert.equal(persistentSuccess,1,'fresh validated authenticated successor permits CSV even while the old checkpoint label remains');
  if(variant==='optional-resource'){assert.ok(assetsBeforeReplay>0,'attended demonstration loads fixed optional resource');assert.equal(assetRequests,assetsBeforeReplay+1,'fixed optional resource remains usable and the authenticated statement completes');}
  await browser.close();browser=await launch();page=await browser.newPage();await page.goto(origin);
  const wrong={identifier,password:'WRONG-CANARY'};await assert.rejects(replayBankLearning(browser,page,{...options,directory:path.join(root,'failed-download'),credentials:async()=>wrong,...(inline?{status:()=>{challenge=completeChallenge();void challenge.catch(()=>{});}}:{})}),{message:'login-outcome-unconfirmed'});assert.equal(submissions,3,'failed login submitted only once');assert.equal(authenticated,2);assert.equal(wrong.password,'');
  if(variant==='approved-auth-origin'){
   await browser.close();browser=await launch();page=await browser.newPage();await page.goto(origin);
   const limitedEvidence={...evidence,origins:[origin]},limitedHash=sha(limitedEvidence),limitedCandidate={...candidate,evidenceHash:limitedHash};
   await assert.rejects(replayBankLearning(browser,page,{...options,evidence:limitedEvidence,evidenceHash:limitedHash,candidate:limitedCandidate,candidateHash:sha(limitedCandidate),credentials:async()=>({identifier,password})}),{message:'login-control-changed'});
   assert.equal(submissions,3,'identical unapproved endpoint receives no credential request');assert.equal(await page.$eval('#password',e=>e.value),'');
  }
  console.log('Fictional login Chrome and DPAPI artifacts retained at '+root);
 }finally{if(browser)await browser.close();for(const s of [server,auxiliary])await new Promise(r=>{s.closeAllConnections();s.close(r);});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {replayBankLearning,learningDownload,inspectManualBinding} from '../collector/bank-learning-runner.mjs';
import {learningStore} from '../collector/bank-learning.mjs';
import {manualStateUsable} from '../collector/bank-learning-login.mjs';
import {stable,validateRecipe,learningFailureText} from '../shared/finance-bank-learning.mjs';
import {selectLearningRole,waitForLearningCapture} from './finance-bank-learning-capture-ack.mjs';
const waitingNotice="必要な画面を確認しています。操作の案内が出るまでお待ちください。";
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const kinds=['F1a','F1a-control','F1b','F1b-control','F1-existing-popup-hidden-successor'];
const sha=v=>createHash('sha256').update(stable(v)).digest('hex');
const credential={identifier:'FICTIONAL-ORIGIN-ID',password:'FICTIONAL-ORIGIN-PASSWORD'};
const noteFor=kind=>(stage,data={})=>console.log('ORIGIN-JOURNEY '+JSON.stringify({kind,stage,at:Date.now(),...data}));
for(const kind of kinds)test('approved origin / manual successor journey '+kind,async()=>{
 const note=noteFor(kind);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'omf-origin-interaction-'));
 const vault=learningStore(root,'a'.repeat(24)),abort=new AbortController(),popup=kind==='F1b',span=kind==='F1b-control',existingPopup=kind==='F1-existing-popup-hidden-successor';let popupPage;
 let originA,originB,posts=0,authenticated=0,phase='setup',record,browser,owner,page,pending,download,recordingSettled=false,recordingError;
 let humanPosts=0,automaticPosts=0,handoffs=0,manualCalls=0,waitingCalls=0,actingHuman=false,fresh=false;const storedWaiters=new Set();
 note('fixture-root',{root,productionRecordingDefault:true});
 const openB=()=>popup||span?'window.open('+JSON.stringify(originB+(span?'/login':'/stage'))+',"_blank")':'location.href='+JSON.stringify(originB+'/stage');
 const form=(external=false)=>'<form action="'+(external?originB:'')+'/signin" method="POST"'+(external?' target="_blank"':'')+'><input id="identifier" name="identifier"><input id="password" name="password" type="password"><button id="submit">Sign in</button></form>';
 const serverB=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');const u=new URL(req.url,'http://fixture');
  if(req.method==='POST'){
   posts++;if(fresh){if(actingHuman)humanPosts++;else automaticPosts++;}
   let body='';for await(const b of req)body+=b;const values=new URLSearchParams(body);
   if(values.get('identifier')!==credential.identifier||values.get('password')!==credential.password){res.writeHead(403);res.end('Refused');return;}
   authenticated++;res.writeHead(303,{'Set-Cookie':'session=fictional; HttpOnly; SameSite=Strict',Location:'/home'});res.end();return;
  }
  if(u.pathname==='/approval'){res.end('<button id="content" type="button">Fictional non-submitting content</button>');return;}
  if(u.pathname==='/stage'){res.end('<section><button '+(kind==='F1a'?'':'id="utility" ')+(popup||existingPopup?'onclick="this.remove()" ':'')+(existingPopup?'hidden ':'')+'type="button">Fictional stage utility</button></section><nav><a id="entry" href="/login">Open sign in</a></nav>'+(existingPopup?'<script>addEventListener("message",e=>{if(e.origin==='+JSON.stringify(originA)+'&&e.data==="reveal-fictional-notice")document.querySelector("#utility").hidden=false});opener.postMessage("fictional-popup-ready",'+JSON.stringify(originA)+')</script>':''));return;}
  if(u.pathname==='/login'){res.end(form());return;}
  if(u.pathname==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0');res.end('Signed out');return;}
  if(!req.headers.cookie?.includes('session=fictional')){res.writeHead(403);res.end('Unauthenticated');return;}
  if(u.pathname==='/home'){res.end('<strong id="success">Authenticated</strong><button id="inquiry" onclick="location.href=\'/details\'">Inquiry</button>');return;}
  if(u.pathname==='/csv'){res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="fictional.csv"');res.end('date,description,amount\r\n'+u.searchParams.get('from')+',Fictional,-1234\r\n');return;}
  res.end('<select id="account"><option value="">Choose</option><option value="FICTIONAL-ACCOUNT">Ordinary</option></select><input id="from"><input id="to"><button id="export" onclick="location.href=\'/csv?from=\'+document.querySelector(\'#from\').value+\'&to=\'+document.querySelector(\'#to\').value">CSV</button><span id="balance">100,000</span><button id="logout" onclick="location.href=\'/logout\'">Logout</button>');
 });
 const serverA=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end((existingPopup?'<nav><button id="open-popup" type="button" onclick=\'window.__fixturePopup=window.open('+JSON.stringify(originB+'/stage')+',"_blank")\'>Open fictional popup</button></nav><section><button id="manual" hidden type="button" onclick=\'window.__fixturePopup.postMessage("reveal-fictional-notice",'+JSON.stringify(originB)+')\'>Complete local check</button></section><script>addEventListener("message",e=>{if(e.origin==='+JSON.stringify(originB)+'&&e.data==="fictional-popup-ready")document.querySelector("#manual").hidden=false})</script>':'<section><button id="manual" type="button" onclick=\''+openB()+'\'>Complete local check</button></section>')+'<iframe src="'+originB+'/approval" style="width:1000px;height:650px"></iframe>');
 });
 await new Promise(r=>serverB.listen(0,'127.0.0.1',r));originB='http://127.0.0.1:'+serverB.address().port;
 await new Promise(r=>serverA.listen(0,'127.0.0.1',r));originA='http://127.0.0.1:'+serverA.address().port;
 const launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+randomBytes(4).toString('hex'))});
 const terminal=()=>pending.then(()=>{throw Error('recording-ended-before-boundary');},e=>{throw e;});
 const wait=promise=>Promise.race([promise,terminal()]);
 const method=async(name,fn)=>{note('method-start',{method:name,phase});try{const result=await fn();note('method-return',{method:name,phase});return result;}catch(error){note('method-error',{method:name,phase,errorName:error.name});throw error;}};
 const state=async(surface,stage)=>{const value=await surface.evaluate(()=>{const keys=Object.keys(window).filter(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)),binding=keys.length===1?window[keys[0]]:null,role=document.querySelector('#omf-learning-control select')?.value||'';return{documentVisible:document.visibilityState==='visible',documentHidden:document.hidden,panel:!!document.querySelector('#omf-learning-control'),busy:document.querySelector('#omf-learning-control small')?.getAttribute('aria-busy')==='true',bindingCount:keys.length,callbackCount:binding?.callbacks instanceof Map?binding.callbacks.size:null,initialIdle:binding?.callbacks===undefined&&binding?.lastSeq===undefined,selectedRole:/^(?:login-(?:identifier|password|submit|navigation|success|manual)(?::(?:otp|certificate|other))?|inquiry|account|from|to|export|balance|logout)?$/.test(role)?role:'other'};});note('owned-state',{stage,intendedRoot:surface===owner,existingPopup:surface===popupPage,...value});};
 const selectActor=async(surface)=>{const target=typeof surface.page==='function'?surface.page():surface;await method(target===owner?'select-owned-A-tab':'select-owned-B-tab',()=>target.bringToFront());await method('selected-tab-state',()=>state(surface,'after-explicit-tab-selection'));};
 const child=()=>owner.frames().find(f=>f.parentFrame()&&f.url().startsWith(originB));
 const overlay=async target=>{await wait(target.waitForSelector('#omf-learning-control select'));};
 const approve=async target=>{
  await selectActor(target);await overlay(target);const count=record?.origins.length||1;
  await target.click('#omf-learning-control button:not([hidden])');
  await waitForLearningCapture(target,pending);
  assert.equal(record.origins.length,count+1);assert.ok(record.origins.includes(originB));
  note('origin-approved',{approvedCount:record.origins.length});
 };
 const operate=async(role,action,{next}={})=>{
  phase='teaching:'+role;await selectActor(page);await method('overlay-wait',()=>overlay(page));await method('current-capture-before-select',()=>waitForLearningCapture(page,pending));
  const toggle=await method('overlay-toggle-lookup',()=>page.$('#omf-learning-control [data-learning-toggle]'));
  if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();
  await method('role-selection',()=>selectLearningRole(page,role,pending));await method('after-role-state',()=>state(page,'role-selected'));const n=record?.events.length||0;
  const stored=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{storedWaiters.delete(observe);reject(Error('diagnostic-actor-store-boundary-unavailable'));},30000);const observe=()=>{if(record?.events.length===n+1){clearTimeout(timer);storedWaiters.delete(observe);resolve();}else if(record?.loginSequenceUnsupported||record?.loginRedirectUnsupported){clearTimeout(timer);storedWaiters.delete(observe);reject(Error('unsupported-login-sequence'));}};storedWaiters.add(observe);});void stored.catch(()=>{});
  await method('bank-element-action',action);if(next)page=await method('existing-popup-page-result',next);await selectActor(page);await method('protected-store-boundary',()=>wait(stored));
  await method('overlay-after-action',()=>overlay(page));await method('current-capture-after-action',()=>waitForLearningCapture(page,pending));
  assert.equal(record?.events.length,n+1,'actual accepted role count');
  if(role.startsWith('login-'))await method('real-role-clear',()=>wait(page.waitForFunction(()=>document.querySelector('#omf-learning-control select')?.value==='')));
  note('role-stored',{role,events:record.events.length});
 };
 try{
  browser=await launch();owner=await browser.newPage();await owner.setViewport({width:1280,height:1000});page=owner;await owner.goto(originA);
  download=await learningDownload(browser,path.join(root,'demo'),{origins:[originA,originB],demonstration:true});
  pending=recordBankLearning(browser,owner,{entryOrigin:originA,teachLogin:true,test:true,signal:abort.signal,onExport:()=>{const n=download.beginExport();return()=>download.acceptExport(n);},store:async value=>{note('protected-store-start',{events:value.events.length,complete:value.complete});await vault.update(v=>({...v,record:value}));record=structuredClone(value);note('protected-store-return',{events:record.events.length,complete:record.complete});for(const observe of storedWaiters)observe();}});
  void pending.then(()=>{recordingSettled=true;},e=>{recordingSettled=true;recordingError=e.message;});
  await overlay(owner);const frame=child();assert.ok(frame);await overlay(frame);
  await approve(frame);
  if(existingPopup){
   const next=browser.waitForTarget(t=>t.opener()===owner.target(),{timeout:10000});
   await operate('login-navigation',()=>owner.click('#open-popup'),{next:async()=>{popupPage=await(await next).page();await popupPage.waitForSelector('#utility');return popupPage;}});
   assert.equal(await popupPage.$eval('#utility',e=>e.hidden),true);
   page=owner;await operate('login-manual:certificate',()=>owner.click('#manual'));
   page=popupPage;await selectActor(page);await method('revealed-popup-manual-visible',()=>page.waitForSelector('#utility',{visible:true}));await operate('login-manual:otp',()=>page.click('#utility'));
  }else if(span){
   const next=browser.waitForTarget(t=>t.opener()===owner.target(),{timeout:10000});
   await operate('login-manual:certificate',()=>page.click('#manual'),{next:async()=>{const p=await(await next).page();await p.waitForSelector('#identifier');return p;}});
   await page.type('#identifier',credential.identifier);await page.type('#password',credential.password);
   await Promise.all([page.waitForNavigation(),page.click('#submit')]);
  }else if(popup){
   const next=browser.waitForTarget(t=>t.opener()===owner.target(),{timeout:10000});
   await operate('login-manual:certificate',()=>page.click('#manual'),{next:async()=>{const p=await(await next).page();await p.waitForSelector('#utility');return p;}});
   await operate('login-manual:otp',()=>page.click('#utility'));
  }else await operate('login-manual:other',()=>Promise.all([page.waitForNavigation(),page.click('#manual')]));
  if(!span){
   await operate('login-navigation',()=>Promise.all([page.waitForNavigation(),page.click('#entry')]));
   await operate('login-identifier',()=>page.click('#identifier'));await page.type('#identifier',credential.identifier);
   await operate('login-password',()=>page.click('#password'));await page.type('#password',credential.password);
   await operate('login-submit',()=>Promise.all([page.waitForNavigation(),page.click('#submit')]));
  }
  await operate('login-success',()=>page.click('#success'));
  await operate('inquiry',()=>Promise.all([page.waitForNavigation(),page.click('#inquiry')]));
  await operate('account',()=>page.select('#account','FICTIONAL-ACCOUNT'));
  for(const[role,value]of[['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await page.type('#'+role,value);await page.$eval('#'+role,e=>e.blur());});
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));
  await operate('logout',()=>Promise.all([page.waitForNavigation(),page.click('#logout')]));
  phase='finish';await selectActor(owner);await method('Finish-click',()=>owner.click('#omf-learning-control button'));record=await method('recording-completion',()=>pending);await method('demonstration-download',()=>download.file());await download.close();download=null;
  const loaded=(await vault.read()).record;assert.equal(stable(loaded)===stable(JSON.parse(JSON.stringify(record))),true,'protected JSON roundtrip matches');
  const evidence=projectEvidence(loaded,{test:true}),evidenceHash=sha(evidence),candidate={schema:2,runtime:evidence.runtime,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};
  validateRecipe(candidate,evidence,evidenceHash,{test:true});
  const manualEvent=loaded.events[existingPopup?1:0],proof=manualEvent.private.manualState,successor=loaded.events[existingPopup?2:1];
  const proofClosed={v:proof?.v,beforeReady:proof?.beforeReady||null,before:proof?.before?.kind||null,post:proof?.post?.kind||null,originalPost:proof?.originalPost?.kind||null,beforeHash:!!proof?.before?.hash,postHash:!!proof?.post?.hash,originalHash:!!proof?.originalPost?.hash,usable:manualStateUsable(manualEvent,successor,proof),successorBound:proof?.successorId===successor.id};
  const projectionExcluded=!stable(evidence).includes('manualState')&&!stable(candidate).includes('manualState');assert.equal(projectionExcluded,true);
  for(const secret of Object.values(credential))assert.equal(stable(loaded).includes(secret)||stable(evidence).includes(secret)||stable(candidate).includes(secret),false);
  note('protected-complete-candidate',{events:loaded.events.length,recordComplete:loaded.complete,protectedReadMatches:true,candidateAccepted:true,proof:proofClosed,projectionExcluded,teachingPosts:posts});
  await browser.close();fresh=true;browser=await launch();owner=await browser.newPage();page=owner;await owner.setViewport({width:1280,height:1000});await owner.goto(originA);
  const initial=await inspectManualBinding(successor.popup==='p0'?owner:undefined,successor,{origins:evidence.origins});
  note('fresh-initial',{state:initial.kind,ready:initial.ready===true,successorPopupMissing:successor.popup!=='p0'});
  const beforePosts=posts;let receipt,code,role;
  phase='fresh-replay';
  try{receipt=await replayBankLearning(browser,owner,{record:loaded,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template:{headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},directory:path.join(root,'fresh'),test:true,loginTimeout:1500,manualTimeout:3000,credentials:async()=>{handoffs++;return{...credential};},status:async text=>{
   if(text===waitingNotice){waitingCalls++;return;}assert.equal(text.startsWith('\u672c\u4eba\u64cd\u4f5c'),true,'only human-operation guidance may drive bank actions');
   manualCalls++;actingHuman=true;
   try{
    if(existingPopup){
     const target=browser.targets().find(t=>t.opener()===owner.target());assert.ok(target,'existing recorded navigation created popup');popupPage=await target.page();
     if(manualCalls===1){await selectActor(popupPage);const observed=await method('first-prompt-existing-binding-inspection',()=>inspectManualBinding(popupPage,successor,{origins:evidence.origins}));note('existing-popup-before-human',{ownedPopupPresent:true,kind:observed.kind,ready:observed.ready===true,posts:posts-beforePosts,observationAfterRuntimeInitialGuard:true,observationBeforeHumanReveal:true});assert.equal(observed.kind,'hidden');assert.equal(observed.ready,false);await selectActor(owner);await method('fresh-root-human-reveal',()=>owner.click('#manual'));await selectActor(popupPage);await method('fresh-revealed-popup-control',()=>popupPage.waitForSelector('#utility',{visible:true}));}
     else{await selectActor(popupPage);await method('fresh-popup-human-manual',()=>popupPage.click('#utility'));}
    }else if(span){const next=browser.waitForTarget(t=>t.opener()===owner.target(),{timeout:10000});await owner.click('#manual');page=await(await next).page();await page.waitForSelector('#identifier');await page.type('#identifier',credential.identifier);await page.type('#password',credential.password);await Promise.all([page.waitForNavigation(),page.click('#submit')]);}
    else if(popup&&manualCalls===1){const next=browser.waitForTarget(t=>t.opener()===owner.target(),{timeout:10000});await owner.click('#manual');page=await(await next).page();await page.waitForSelector('#utility');}
    else if(popup)await page.click('#utility');
    else await Promise.all([owner.waitForNavigation(),owner.click('#manual')]);
   }finally{actingHuman=false;}
  }});}catch(error){code=/^[a-z][a-z0-9-]{0,80}$/.test(error.code||error.message.split('\n')[0])?(error.code||error.message.split('\n')[0]):'unexpected-runtime-error';role=error.learningRole||null;}
  const outcome={kind,root,recordComplete:loaded.complete,protectedReadMatches:true,candidateAccepted:true,proof:proofClosed,projectionExcluded,initial:{kind:initial.kind,ready:initial.ready===true},code:code||null,codeHasOutwardText:!!code&&learningFailureText(code)!==code,role:role||null,promptCalls:manualCalls,waitingCalls,credentialProviderCalls:handoffs,freshPosts:posts-beforePosts,humanPosts,automaticPosts,authenticated,rows:receipt?.rows||0,loggedOut:receipt?.loggedOut===true};
  if(receipt){assert.equal(receipt.rows,1);assert.equal(receipt.loggedOut,true);assert.equal(posts-beforePosts,1);}else assert.equal(posts-beforePosts,0);
  note('fresh-outcome',outcome);assert.equal(!!receipt,true,'supported manual journey requires a receipt');assert.equal(manualCalls,kind==='F1b'||existingPopup?2:1);assert.equal(handoffs,span?0:1);assert.equal(automaticPosts,span?0:1);assert.equal(humanPosts,span?1:0);
 }catch(error){note('case-error',{phase,errorName:error.name,code:error.code||null,recordingSettled,recordingError:recordingError==='demonstration-cancelled'?recordingError:recordingError?'other':null,events:record?.events.length||0,recordComplete:record?.complete===true,posts});throw Error('origin-journey-'+phase+'-'+error.name);}
 finally{abort.abort();if(pending)await pending.catch(()=>{});if(download)await download.close();if(browser)await browser.close();for(const server of[serverA,serverB])await new Promise(r=>{server.closeAllConnections();server.close(r);});}
});

const ENTRY_GUIDANCE="ログイン画面への移動が記録されていません。この実演は中止し、開始ページで「ログイン画面へ移動」または「本人操作」を記録してから移動してください。開始ページのURLはこのPCの設定で指定して記録をやり直せます。";
async function runInteractionPhase(id,input,uiOnly){
 const arm='maintained',note=(stage,data={})=>console.log('UNAPPROVED-INTERACTION '+JSON.stringify({id,input,stage,at:Date.now(),...data}));
 const flow=uiOnly?'ui-only':'valid-continuation',root=fs.mkdtempSync(path.join(os.tmpdir(),'omf-f2-aligned-')),vault=learningStore(root,'a'.repeat(24)),abort=new AbortController();
 let originB,browser,owner,pending,record,phase='setup',posts=0,storeReturns=0,terminalError,liveDeliveryReturns=0,retiredDeliveryThrows=0,predecessorStored;
 const eventStored=new Promise(r=>{predecessorStored=r;}),deliveries=[];note('fixture-root',{flow,root,productionRecordingDefault:true});
 const b=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<button id="content" type="button">Fictional non-submitting content</button>');});
 await new Promise(r=>b.listen(0,'127.0.0.1',r));originB='http://127.0.0.1:'+b.address().port;
 const a=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<p id="owned">Owned teaching page</p>'+(!uiOnly?'<button id="continue" type="button" onclick="location.href=\'/new-approved-document\'">Continue fictional bank</button>':'')+'<iframe src="'+originB+'/approval" style="width:1000px;height:650px"></iframe>');});
 await new Promise(r=>a.listen(0,'127.0.0.1',r));const originA='http://127.0.0.1:'+a.address().port;
 const end=()=>pending.then(()=>{throw Error('recording-ended-before-boundary');},e=>{throw e;}),wait=p=>Promise.race([p,end()]);
 const child=()=>owner.frames().find(f=>f.parentFrame()&&f.url().startsWith(originB));
 const status=target=>target.$eval('#omf-learning-control small',e=>({falseFeedback:e.textContent==='\u8a18\u9332\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002',visible:e.getClientRects().length>0,busy:e.getAttribute('aria-busy')==='true'}));
 const overlay=target=>wait(target.waitForSelector('#omf-learning-control select'));
 const deliveryObserver=(frame,label)=>{const evaluate=frame.evaluate.bind(frame);frame.evaluate=function(fn,...args){
  if(typeof fn!=='function'||!fn.toString().includes('window[key]=list'))return evaluate(fn,...args);
  const row={recipient:label,detached:frame.detached===true,startedAt:Date.now(),returned:false,synchronousThrow:false,asyncRejection:false};deliveries.push(row);note('origin-delivery-start',{flow,recipient:label,detached:row.detached});
  try{const promise=evaluate(fn,...args);return promise.then(result=>{row.returned=true;row.finishedAt=Date.now();if(label==='current-B')liveDeliveryReturns++;note('origin-delivery-return',{flow,recipient:label,detached:frame.detached===true});return result;},error=>{row.asyncRejection=true;row.finishedAt=Date.now();note('origin-delivery-reject',{flow,recipient:label,errorName:error.name});throw error;});}
  catch(error){row.synchronousThrow=true;row.finishedAt=Date.now();if(label==='old-B'&&frame.detached)retiredDeliveryThrows++;note('origin-delivery-sync-throw',{flow,recipient:label,detached:frame.detached===true,errorName:error.name});throw error;}
 };};
 const revealRole=async frame=>{const toggle=await frame.$('#omf-learning-control [data-learning-toggle]');if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();};
 try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+randomBytes(4).toString('hex'))});owner=await browser.newPage();await owner.setViewport({width:1280,height:1000});await owner.goto(originA);await owner.bringToFront();
  pending=recordBankLearning(browser,owner,{entryOrigin:originA,teachLogin:true,test:true,signal:abort.signal,store:async value=>{note('protected-store-start',{flow,events:value.events.length,origins:value.origins.length,complete:value.complete});await vault.update(v=>({...v,record:value}));record=structuredClone(value);storeReturns++;if(record.events.length===1&&record.events[0].role==='login-navigation')predecessorStored();note('protected-store-return',{flow,events:record.events.length,origins:record.origins.length,complete:record.complete});}});
  void pending.catch(error=>{terminalError={name:error.name,detached:/detached Frame/.test(error.message),cancelled:error.message==='demonstration-cancelled'};});
  await overlay(owner);const old=child();assert.ok(old);await overlay(old);deliveryObserver(old,'old-B');
  await old.evaluate(()=>{
   const key=Object.getOwnPropertyNames(window).find(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)&&typeof window[k]==='function'),original=window[key],state=window.__omfInteractionObservation={dispatched:0,settled:0,trustedClick:0,trustedEnter:0,trustedSpace:0};
   const wrapped=function(payload){const observed=payload.interaction===true;if(observed)state.dispatched++;const result=original(payload);if(observed)void result.then(()=>state.settled++,()=>state.settled++);return result;};Object.assign(wrapped,original);window[key]=wrapped;
   document.addEventListener('click',e=>{if(e.isTrusted&&e.target===document.querySelector('#content'))state.trustedClick++;},true);
   document.addEventListener('keydown',e=>{if(e.isTrusted&&e.target===document.querySelector('#content')){if(e.key==='Enter')state.trustedEnter++;if(e.key===' ')state.trustedSpace++;}},true);
  });
  phase='unapproved-interaction';const before=await status(owner);assert.equal(before.falseFeedback,false);
  if(input==='click')await old.click('#content');else{await old.focus('#content');await owner.keyboard.press(input==='enter'?'Enter':'Space');}
  await wait(old.waitForFunction(()=>{const s=window.__omfInteractionObservation;return s.dispatched>0&&s.settled===s.dispatched;}));
  const observed=await old.evaluate(()=>window.__omfInteractionObservation),after=await status(owner);
  note('interaction-outcome',{flow,before,after,observed,events:record?.events.length||0,posts,storeReturns});
  assert.equal(observed[input==='click'?'trustedClick':input==='enter'?'trustedEnter':'trustedSpace'],1);assert.equal(after.falseFeedback,false,'known unapproved interaction must not publish false failure');assert.equal(record?.events.length||0,0);assert.equal(posts,0);assert.equal(storeReturns,0);
  if(uiOnly){
   phase='UI-only-later-approved-document';await owner.goto(originA+'/new-approved-document');await owner.bringToFront();await overlay(owner);const carry=await status(owner);note('later-document',{flow,carry,events:record?.events.length||0,posts});assert.equal(carry.falseFeedback,false,'no false failure carried into later approved document');
   abort.abort();await assert.rejects(pending,/demonstration-cancelled/);const outcome={id,arm,input,flow,root,before,after,carry,observed,telemetryEvents:0,posts,storeReturns,approvalAndRoleNotAttempted:true,explicitCancellation:true};note('phase-outcome',outcome);return outcome;
  }
  phase='accepted-A-predecessor';await owner.bringToFront();await selectLearningRole(owner,'login-navigation',pending);await Promise.all([owner.waitForNavigation(),owner.click('#continue')]);await overlay(owner);await wait(eventStored);
  assert.equal(record.events.length,1);assert.equal(record.events[0].role,'login-navigation');assert.equal(old.detached,true);note('predecessor-stored',{flow,events:1,predecessorRole:'login-navigation',oldBDetached:true,trustedBankNavigation:true,newDocumentIdleNotOldCaptureACK:true,posts});
  const current=child();assert.ok(current);await overlay(current);deliveryObserver(current,'current-B');assert.equal(current.detached,false);
  phase='explicit-origin-approval';await owner.bringToFront();note('approval-start',{flow,oldDetached:true,currentLive:true,events:record.events.length});await current.click('#omf-learning-control button:not([hidden])');await waitForLearningCapture(current,pending);
  assert.equal(record?.origins.includes(originB),true,'actual UI approval persisted');assert.equal(record?.origins.length,2);assert.equal(record?.events.length,1);
  const allowed=await current.evaluate(()=>{const key=Object.getOwnPropertyNames(window).find(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)&&typeof window[k]==='function');return Array.isArray(window[key+'Origins'])&&window[key+'Origins'].includes(location.origin);});assert.equal(allowed,true);assert.equal(liveDeliveryReturns>0,true);assert.equal(retiredDeliveryThrows>0,true);note('approval-return',{flow,approvedOrigins:record.origins.length,events:record.events.length,selectedLiveFrameReceivedOrigins:allowed,liveDeliveryReturns,retiredDeliveryThrows,storeReturns});
  phase='legitimate-B-role';await owner.bringToFront();await revealRole(current);await selectLearningRole(current,'login-manual:other',pending);await current.click('#content');await waitForLearningCapture(current,pending);
  const settled=await current.evaluate(expected=>({roleEmpty:document.querySelector('#omf-learning-control select')?.value==='',entryUnrecordedGuidance:document.querySelector('#omf-learning-control small')?.textContent===expected,panel:!!document.querySelector('#omf-learning-control'),visible:document.visibilityState==='visible'}),ENTRY_GUIDANCE);note('B-capture-settled',{flow,...settled,events:record?.events.length||0});
  await wait(current.waitForFunction(()=>document.querySelector('#omf-learning-control select')?.value===''));assert.equal(record?.events.length,2,'one accepted predecessor plus one actual B role');assert.equal(record.events[0].role,'login-navigation');assert.equal(record.events[1].role,'login-manual');assert.equal(record.complete,false);assert.equal(posts,0);
  const loaded=(await vault.read()).record;assert.equal(stable(loaded)===stable(JSON.parse(JSON.stringify(record))),true,'real protected read matches normalized record');assert.equal(loaded.origins.includes(originB),true);assert.equal(loaded.events.length,2);
  abort.abort();await assert.rejects(pending,/demonstration-cancelled/);const outcome={id,arm,input,flow,root,before,after,observed,telemetryEvents:0,posts,predecessorRoles:1,predecessorRole:'login-navigation',legitimateBRoles:1,totalRoles:loaded.events.length,approvedOrigins:loaded.origins.length,protectedReadMatches:true,recordComplete:false,selectedLiveFrameReceivedOrigins:allowed,liveDeliveryReturns,retiredDeliveryThrows,deliveries,storeReturns,entryOwnershipForgedOrCleared:false,explicitCancellation:true};note('phase-outcome',outcome);return outcome;
 }catch(error){
  let persistedEvents=null;if(storeReturns>0){const saved=await vault.read().catch(()=>null);persistedEvents=saved?.record?.events.length??null;}
  const closed={id,arm,input,flow,root,phase,errorName:error.name,assertion:error.code==='ERR_ASSERTION',detachedError:/detached Frame/.test(error.message),events:record?.events.length||0,persistedEvents,approvedOrigins:record?.origins.length||0,posts,storeReturns,liveDeliveryReturns,retiredDeliveryThrows,deliveries,terminalError:terminalError||null};note('case-error',closed);throw Error(error.code==='ERR_ASSERTION'&&phase==='unapproved-interaction'?'unapproved-interaction-feedback-assertion':closed.detachedError&&phase==='explicit-origin-approval'?'approval-recipient-delivery-failed':'interaction-unexpected-'+error.name);
 }finally{abort.abort();if(pending)await pending.catch(()=>{});if(browser)await browser.close();for(const server of[a,b])await new Promise(r=>{server.closeAllConnections();server.close(r);});}
}

for(const input of ['click','enter','space'])test('unapproved frame interaction and valid approval '+input,async()=>{await runInteractionPhase('interaction-'+input,input,true);await runInteractionPhase('interaction-'+input,input,false);});
async function runCompatibilityFlow(flow){
 const id='compatibility-'+flow,arm='maintained',storeFailure=flow==='store-failure',note=(stage,data={})=>console.log('INTERACTION-COMPATIBILITY '+JSON.stringify({id,flow,stage,at:Date.now(),...data}));
 const genuineWarning='ログインの記録後に照会を実演してください。',storeError='CONTROL-APPROVAL-STORE-FAILURE';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'omf-f2-compat-')),vault=learningStore(root,'a'.repeat(24)),abort=new AbortController();
 let browser,owner,pending,record,phase='setup',posts=0,nextNavigations=0,storeAttempts=0,storeReturns=0,approvalStoreRejects=0,settled=false,terminal,asyncRejects=0,liveReturns=0,ackAtBoundary,roleBoundary;
 let predecessorStored;const predecessor=new Promise(r=>{predecessorStored=r;}),deliveries=[];note('fixture-root',{root,productionRecordingDefault:true,bankNavigationDelay:6000});
 const b=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<button id="content" type="button">Fictional non-submitting content</button>');});await new Promise(r=>b.listen(0,'127.0.0.1',r));const originB='http://127.0.0.1:'+b.address().port;
 const a=http.createServer((req,res)=>{if(req.method==='POST')posts++;if(req.url==='/next')nextNavigations++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<button id="warning" type="button">Fictional recoverable warning control</button><button id="entry" type="button" onclick="setTimeout(()=>location.href=\'/next\',6000)">Open next fictional bank page</button><iframe src="'+originB+'/approval" style="width:1000px;height:650px"></iframe>');});await new Promise(r=>a.listen(0,'127.0.0.1',r));const originA='http://127.0.0.1:'+a.address().port;
 const wait=p=>Promise.race([p,pending.then(()=>{throw Error('recording-ended-before-boundary');},error=>{throw error;})]);
 const child=()=>owner.frames().find(f=>f.parentFrame()&&f.url().startsWith(originB));
 const overlay=surface=>wait(surface.waitForSelector('#omf-learning-control select'));
 const ui=surface=>surface.evaluate(expected=>{const status=document.querySelector('#omf-learning-control small'),box=status?.getBoundingClientRect();return{genuine:status?.textContent===expected,genericFalse:status?.textContent==='記録できませんでした。',visible:!!box&&box.height>0&&box.top>=0&&box.bottom<=innerHeight,busy:status?.getAttribute('aria-busy')==='true'};},genuineWarning);
 const origins=surface=>surface.evaluate(()=>{const key=Object.getOwnPropertyNames(window).find(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)&&typeof window[k]==='function'),values=window[key+'Origins'];return{count:Array.isArray(values)?values.length:null,currentIncluded:Array.isArray(values)&&values.includes(location.origin)};});
 const observeDelivery=(frame,label,asynchronous)=>{const evaluate=frame.evaluate.bind(frame);frame.evaluate=function(fn,...args){if(typeof fn!=='function'||!fn.toString().includes('window[key]=list'))return evaluate(fn,...args);const row={recipient:label,detached:frame.detached===true,asynchronousActualCall:asynchronous,returned:false,rejected:false};deliveries.push(row);note('delivery-start',row);const actual=asynchronous?Promise.resolve().then(()=>evaluate(fn,...args)):evaluate(fn,...args);return actual.then(result=>{row.returned=true;if(label==='live-B')liveReturns++;note('delivery-return',{recipient:label,detached:frame.detached===true});return result;},error=>{row.rejected=true;row.detachedAtRejection=frame.detached===true;row.errorName=error.name;if(asynchronous)asyncRejects++;note('delivery-rejection',{recipient:label,asynchronousActualCall:asynchronous,detached:frame.detached===true,errorName:error.name});throw error;});};};
 const choose=async(surface,role)=>{await owner.bringToFront();await overlay(surface);const toggle=await surface.$('#omf-learning-control [data-learning-toggle]');if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();await selectLearningRole(surface,role,pending);};
 try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});owner=await browser.newPage();await owner.setViewport({width:1280,height:1000});await owner.goto(originA);await owner.bringToFront();
  pending=recordBankLearning(browser,owner,{entryOrigin:originA,teachLogin:true,test:true,signal:abort.signal,store:async value=>{storeAttempts++;const approval=value.events.length===1&&value.events[0].role==='login-navigation'&&value.origins.length===2;note('store-start',{events:value.events.length,origins:value.origins.length,approval});if(storeFailure&&approval){approvalStoreRejects++;note('approval-store-reject',{beforeDurableWrite:true,storeReturns});throw Error(storeError);}await vault.update(v=>({...v,record:value}));record=structuredClone(value);storeReturns++;if(record.events.length===1&&record.events[0].role==='login-navigation'&&record.origins.length===1)predecessorStored();note('store-return',{events:record.events.length,origins:record.origins.length,storeReturns});}});
  void pending.then(()=>{settled=true;terminal={success:true};},error=>{settled=true;terminal={success:false,expectedStoreFailure:error.message===storeError,cancelled:error.message==='demonstration-cancelled',errorName:error.name};});
  await overlay(owner);const old=child();assert.ok(old);await overlay(old);assert.equal(old.page()===owner,true);
  let unknownKey,genuineBefore,genuineAfter;
  if(!storeFailure){
   phase='unknown-key';const before=await origins(owner);unknownKey=await owner.evaluate(async()=>{const key=Object.getOwnPropertyNames(window).find(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)&&typeof window[k]==='function'),result=await window[key]({key:'CONTROL-NON-ASSOCIATED-KEY',interaction:true});return{refused:result?.ok===false,successful:result?.ok===true};});await waitForLearningCapture(owner,pending);const after=await origins(owner),foreign=await origins(old);note('unknown-key',{...unknownKey,originCountBefore:before.count,originCountAfter:after.count,unapprovedChildStillExcluded:!foreign.currentIncluded,storeAttempts,storeReturns,events:record?.events.length||0,posts});assert.equal(unknownKey.refused,true);assert.equal(unknownKey.successful,false);assert.equal(before.count,1);assert.equal(after.count,1);assert.equal(foreign.currentIncluded,false);assert.equal(storeAttempts,0);
   phase='genuine-warning';await choose(owner,'inquiry');await owner.click('#warning');await waitForLearningCapture(owner,pending);genuineBefore=await ui(owner);assert.equal(genuineBefore.genuine,true);assert.equal(genuineBefore.visible,true);await old.click('#content');await waitForLearningCapture(old,pending);genuineAfter=await ui(owner);note('genuine-warning-preserved',{before:genuineBefore,after:genuineAfter,sameOwnedPage:old.page()===owner,events:record?.events.length||0,storeAttempts,posts});assert.equal(genuineAfter.genuine,true);assert.equal(genuineAfter.genericFalse,false);assert.equal(genuineAfter.visible,true);assert.equal(storeAttempts,0);
  }
  observeDelivery(old,'retired-B',true);
  phase='accepted-delayed-predecessor';const initialLoader=owner.mainFrame()._loaderId;await choose(owner,'login-navigation');await owner.click('#entry');await wait(predecessor);await waitForLearningCapture(owner,pending);assert.equal(record.events.length,1);assert.equal(record.events[0].role,'login-navigation');assert.equal(nextNavigations,0);assert.equal(owner.mainFrame()._loaderId===initialLoader,true);assert.equal(old.detached,false);
  const acceptedAt=Date.now();note('accepted-predecessor-still-before-navigation',{events:1,role:'login-navigation',protectedStoreReturned:true,currentSourceCaptureACK:true,nextNavigations,sameRootLoader:true,oldChildLive:true,bankDelayMilliseconds:6000});
  if(!storeFailure){phase='unapproved-child-while-pending';await old.click('#content');await waitForLearningCapture(old,pending);assert.equal(nextNavigations,0);assert.equal(owner.mainFrame()._loaderId===initialLoader,true);assert.equal(record.events.length,1);note('same-page-unapproved-interaction-before-navigation',{sameOwnedPage:old.page()===owner,nextNavigations,sameRootLoader:true,events:record.events.length,afterAcceptedStore:true,elapsedSinceAccepted:Date.now()-acceptedAt,privateEntryStateRead:false});}
  phase='actual-delayed-navigation';await owner.waitForNavigation();await owner.bringToFront();await overlay(owner);assert.equal(nextNavigations,1);assert.equal(old.detached,true);const current=child();assert.ok(current);await overlay(current);observeDelivery(current,'live-B',false);
  await current.evaluate(()=>{const key=Object.getOwnPropertyNames(window).find(k=>/^__omfLearn[0-9a-f]{16}$/.test(k)&&typeof window[k]==='function'),original=window[key],receipt=window.__approvalReceipt={settled:false,successful:false,refused:false,rejected:false};const wrapped=function(payload){const result=original(payload);if(payload.approveOrigin===true)void result.then(value=>{receipt.settled=true;receipt.successful=value?.ok===true;receipt.refused=value?.ok===false;},()=>{receipt.settled=true;receipt.rejected=true;});return result;};Object.assign(wrapped,original);window[key]=wrapped;});
  phase='actual-approval';await owner.bringToFront();await current.click('#omf-learning-control button:not([hidden])');await current.waitForFunction(()=>window.__approvalReceipt?.settled===true);ackAtBoundary=await current.evaluate(()=>window.__approvalReceipt);const delivered=await origins(current);note('approval-actual-ACK',{ack:ackAtBoundary,recordingSettled:settled,terminal:terminal||null,deliveredCurrentOrigin:delivered.currentIncluded,asyncRejects,liveReturns,storeAttempts,storeReturns,approvalStoreRejects});assert.equal(asyncRejects,1);assert.equal(liveReturns,1);assert.equal(delivered.currentIncluded,true);
  if(storeFailure){
   phase='approval-store-terminal-oracle';const saved=(await vault.read()).record;const closed={terminalAtACK:settled,expectedStoreFailure:terminal?.expectedStoreFailure===true,approvalACKSuccessful:ackAtBoundary.successful,approvalACKRefused:ackAtBoundary.refused,durableEvents:saved.events.length,durableOrigins:saved.origins.length,approvalStoreRejects,storeReturns,liveOriginsAlreadyDelivered:delivered.currentIncluded,BRoleStoreAttempts:0};note('approval-store-terminal-state',closed);assert.equal(closed.terminalAtACK,true,'approval store failure must remain terminal');assert.equal(closed.expectedStoreFailure,true);assert.equal(closed.approvalACKSuccessful,false);assert.equal(closed.approvalACKRefused,true);assert.equal(saved.events.length,1);assert.equal(saved.events[0].role,'login-navigation');assert.equal(saved.origins.length,1);assert.equal(approvalStoreRejects,1);assert.equal(storeReturns,1);assert.equal(posts,0);await assert.rejects(pending,error=>error.message===storeError);const outcome={id,arm,flow,root,...closed,asyncRejects,liveReturns,deliveries,posts,recordComplete:false,noRollbackOfDeliveredOrInMemoryOriginsClaimed:true};note('fixed-outcome',outcome);return;
  }
  assert.equal(ackAtBoundary.successful,true);assert.equal(settled,false);assert.equal(record.origins.length,2);assert.equal(record.events.length,1);
  phase='same-page-successor-oracle';await choose(current,'login-manual:other');await current.click('#content');await waitForLearningCapture(current,pending);roleBoundary=await current.evaluate(expected=>({entryUnrecorded:document.querySelector('#omf-learning-control small')?.textContent===expected,roleCleared:document.querySelector('#omf-learning-control select')?.value===''}),ENTRY_GUIDANCE);note('successor-after-actual-capture',{...roleBoundary,events:record?.events.length||0,predecessorCount:record?.events.filter(e=>e.role==='login-navigation').length||0,BRoleCount:record?.events.filter(e=>e.role==='login-manual').length||0});assert.equal(roleBoundary.entryUnrecorded,false,'accepted same-page pending intent must sponsor successor');assert.equal(record.events.length,2);assert.equal(roleBoundary.roleCleared,true);assert.equal(record.events[1].role,'login-manual');
  const saved=(await vault.read()).record;assert.equal(stable(saved)===stable(JSON.parse(JSON.stringify(record))),true);assert.equal(saved.events.length,2);assert.equal(posts,0);abort.abort();await assert.rejects(pending,/demonstration-cancelled/);const outcome={id,arm,flow,root,unknownKey,genuineBefore,genuineAfter,acceptedPredecessor:1,unapprovedChildWhileAcceptedIntentPending:true,sameOwnedPage:true,predecessorCount:1,BRoleCount:1,totalDurableEvents:saved.events.length,durableOrigins:saved.origins.length,normalizedProtectedRead:true,asyncRejects,liveReturns,deliveries,approvalACKSuccessful:ackAtBoundary.successful,storeAttempts,storeReturns,posts,explicitCancellation:true,recordComplete:false,entryStateForgedOrRead:false};note('fixed-outcome',outcome);
 }catch(error){let durableEvents=null,durableOrigins=null;if(storeReturns>0){const saved=(await vault.read()).record;durableEvents=saved?.events.length??null;durableOrigins=saved?.origins.length??null;}const failure={id,arm,flow,root,phase,errorName:error.name,assertion:error.code==='ERR_ASSERTION',events:record?.events.length||0,durableEvents,durableOrigins,posts,nextNavigations,storeAttempts,storeReturns,approvalStoreRejects,asyncRejects,liveReturns,deliveries,ackAtBoundary:ackAtBoundary||null,roleBoundary:roleBoundary||null,recordingSettledBeforeCleanup:settled,terminalBeforeCleanup:terminal||null};note('case-failure',failure);throw Error(phase==='same-page-successor-oracle'&&roleBoundary?.entryUnrecorded?'same-page-pending-intent-successor-refused':phase==='approval-store-terminal-oracle'&&!settled?'approval-store-failure-was-swallowed':'compat-unexpected-'+error.name);
 }finally{abort.abort();if(pending)await pending.catch(()=>{});if(browser)await browser.close();for(const server of[a,b])await new Promise(r=>{server.closeAllConnections();server.close(r);});}
}

for(const flow of ['success','store-failure'])test('interaction approval compatibility '+flow,async()=>runCompatibilityFlow(flow));

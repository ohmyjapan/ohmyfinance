import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
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
const digest=value=>createHash('sha256').update(stable(value)).digest('hex');
const scenarios=[
 {name:'delayed existing popup with ready root',notice:false,liveEarlier:false,delayMs:750},
 {name:'loaded existing popup with ready root',notice:false,liveEarlier:false,delayMs:0},
 {name:'retired earlier owned popup',notice:true,liveEarlier:false,delayMs:0},
 {name:'live earlier owned popup',notice:true,liveEarlier:true,delayMs:0}
];
for(const scenario of scenarios)test('popup continuation '+scenario.name,async()=>{
 const {notice,liveEarlier,delayMs}=scenario;
 assert.equal(typeof notice,'boolean');assert.equal(typeof liveEarlier,'boolean');assert.ok([0,750].includes(delayMs));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'omf-popup-continuation-')),vault=learningStore(root,'a'.repeat(24)),abort=new AbortController();
 const credential={identifier:'FICTIONAL-ORIGIN-ID',password:'FICTIONAL-ORIGIN-PASSWORD'};
 let originA,originB,browser,owner,page,popupPage,priorPage,pending,download,record,retireResponse,noticeStored=false,fresh=false,phase='setup',posts=0,automaticPosts=0,humanPosts=0,handoffs=0,prompts=0,waitingCalls=0,human=false;
 const waiters=new Set(),note=(stage,data={})=>console.log('POPUP-JOURNEY '+JSON.stringify({name:scenario.name,stage,at:Date.now(),...data}));
 const form=()=>'<form action="/signin" method="POST"><input id="identifier" name="identifier"><input id="password" name="password" type="password"><button id="submit">Sign in</button></form>';
 const serverB=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');const u=new URL(req.url,'http://fixture');
  if(req.method==='POST'){
   posts++;if(fresh){if(human)humanPosts++;else automaticPosts++;}let body='';for await(const chunk of req)body+=chunk;const values=new URLSearchParams(body);
   if(values.get('identifier')!==credential.identifier||values.get('password')!==credential.password){res.writeHead(403);res.end('Refused');return;}
   res.writeHead(303,{'Set-Cookie':'session=fictional; HttpOnly; SameSite=Strict',Location:'/home'});res.end();return;
  }
  if(u.pathname==='/approval'){res.end('<button id="content" type="button">Fictional content</button>');return;}
  if(u.pathname==='/notice'){
   const action='fetch("/retire").then(()=>{opener.postMessage("notice-completed",'+JSON.stringify(originA)+');'+(liveEarlier?'this.remove()':'window.close()')+'})';
   res.end('<button id="notice" type="button" onclick=\''+action+'\'>Complete fictional notice</button>');return;
  }
  if(u.pathname==='/retire'){if(fresh||noticeStored)res.end('done');else retireResponse=res;return;}
  if(u.pathname==='/stage'){
   if(fresh&&delayMs){note('bank-response-held',{milliseconds:delayMs});await new Promise(resolve=>setTimeout(resolve,delayMs));note('bank-response-released');}
   res.end('<section><button id="utility" type="button" '+(!notice?'hidden ':'')+'onclick="this.remove()">Fictional stage utility</button></section><nav><a id="entry" href="/login">Open sign in</a></nav>'+(!notice?'<script>addEventListener("message",e=>{if(e.origin==='+JSON.stringify(originA)+'&&e.data==="reveal-fictional-notice")document.querySelector("#utility").hidden=false})</script>':''));return;
  }
  if(u.pathname==='/login'){res.end(form());return;}
  if(u.pathname==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0');res.end('Signed out');return;}
  if(!req.headers.cookie?.includes('session=fictional')){res.writeHead(403);res.end('Unauthenticated');return;}
  if(u.pathname==='/home'){res.end('<strong id="success">Authenticated</strong><button id="inquiry" onclick="location.href=\'/details\'">Inquiry</button>');return;}
  if(u.pathname==='/csv'){res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="fictional.csv"');res.end('date,description,amount\r\n'+u.searchParams.get('from')+',Fictional,-1234\r\n');return;}
  res.end('<select id="account"><option value="">Choose</option><option value="FICTIONAL-ACCOUNT">Ordinary</option></select><input id="from"><input id="to"><button id="export" onclick="location.href=\'/csv?from=\'+document.querySelector(\'#from\').value+\'&to=\'+document.querySelector(\'#to\').value">CSV</button><span id="balance">100,000</span><button id="logout" onclick="location.href=\'/logout\'">Logout</button>');
 });
 const serverA=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  const open='window.__fixturePopup=window.open('+JSON.stringify(originB+(notice?'/notice':'/stage'))+',"_blank")',manual=notice?'window.__fixturePopup=window.open('+JSON.stringify(originB+'/stage')+',"_blank")':'window.__fixturePopup.postMessage("reveal-fictional-notice",'+JSON.stringify(originB)+')';
  res.end('<nav><button id="open-popup" type="button" onclick=\''+open+'\'>Open fictional popup</button></nav><section><button id="manual" '+(notice?'hidden ':'')+'type="button" onclick=\''+manual+'\'>Complete local check</button></section>'+(notice?'<script>addEventListener("message",e=>{if(e.origin==='+JSON.stringify(originB)+'&&e.data==="notice-completed")document.querySelector("#manual").hidden=false})</script>':'')+'<iframe src="'+originB+'/approval" style="width:1000px;height:650px"></iframe>');
 });
 await new Promise(resolve=>serverB.listen(0,'127.0.0.1',resolve));originB='http://127.0.0.1:'+serverB.address().port;
 await new Promise(resolve=>serverA.listen(0,'127.0.0.1',resolve));originA='http://127.0.0.1:'+serverA.address().port;
 const launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+randomBytes(4).toString('hex'))});
 const wait=promise=>Promise.race([promise,pending.then(()=>{throw Error('recording-ended-before-boundary');},error=>{throw error;})]);
 const selectTab=async surface=>{const target=typeof surface.page==='function'?surface.page():surface;await target.bringToFront();};
 const overlay=surface=>wait(surface.waitForSelector('#omf-learning-control select'));
 const operate=async(role,action,{next}={})=>{
  phase='teaching:'+role;await selectTab(page);await overlay(page);await waitForLearningCapture(page,pending);
  const toggle=await page.$('#omf-learning-control [data-learning-toggle]');if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();
  await selectLearningRole(page,role,pending);const count=record?.events.length||0;
  const stored=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(observe);reject(Error('actor-store-boundary-unavailable'));},30000),observe=()=>{if(record?.events.length===count+1){clearTimeout(timer);waiters.delete(observe);resolve();}else if(record?.loginSequenceUnsupported||record?.loginRedirectUnsupported){clearTimeout(timer);waiters.delete(observe);reject(Error('unsupported-login-sequence'));}};waiters.add(observe);});void stored.catch(()=>{});
  await action();if(next)page=await next();await selectTab(page);await wait(stored);await overlay(page);await waitForLearningCapture(page,pending);assert.equal(record.events.length,count+1);
  if(role.startsWith('login-'))await wait(page.waitForFunction(()=>document.querySelector('#omf-learning-control select')?.value===''));
 };
 try{
  browser=await launch();owner=await browser.newPage();page=owner;await owner.setViewport({width:1280,height:1000});await owner.goto(originA);
  download=await learningDownload(browser,path.join(root,'demo'),{origins:[originA,originB],demonstration:true});
  pending=recordBankLearning(browser,owner,{entryOrigin:originA,teachLogin:true,test:true,signal:abort.signal,onExport:()=>{const attempt=download.beginExport();return()=>download.acceptExport(attempt);},store:async value=>{
   await vault.update(v=>({...v,record:value}));record=structuredClone(value);if(record.events.at(-1)?.role==='login-manual'&&record.events.at(-1)?.popup==='p1'){noticeStored=true;if(retireResponse){retireResponse.end('done');retireResponse=null;}}for(const observe of waiters)observe();
  }});void pending.catch(()=>{});
  await overlay(owner);const approval=owner.frames().find(frame=>frame.parentFrame()&&frame.url().startsWith(originB));assert.ok(approval);await selectTab(approval);await overlay(approval);await approval.click('#omf-learning-control button:not([hidden])');await waitForLearningCapture(approval,pending);assert.equal(record.origins.includes(originB),true);
  const first=browser.waitForTarget(target=>target.opener()===owner.target(),{timeout:10000});
  await operate('login-navigation',()=>owner.click('#open-popup'),{next:async()=>{popupPage=await(await first).page();await popupPage.waitForSelector(notice?'#notice':'#utility');return popupPage;}});
  if(notice){
   priorPage=popupPage;await operate('login-manual:other',()=>priorPage.click('#notice'),{next:async()=>{await owner.bringToFront();await owner.waitForSelector('#manual',{visible:true});return owner;}});
   if(!liveEarlier&&!priorPage.isClosed())await new Promise(resolve=>priorPage.once('close',resolve));assert.equal(priorPage.isClosed(),!liveEarlier);
   page=owner;const later=browser.waitForTarget(target=>target.opener()===owner.target()&&target!==priorPage.target(),{timeout:10000});
   await operate('login-manual:certificate',()=>owner.click('#manual'),{next:async()=>{popupPage=await(await later).page();await popupPage.waitForSelector('#utility');return popupPage;}});
  }else{
   assert.equal(await popupPage.$eval('#utility',e=>e.hidden),true);page=owner;await operate('login-manual:certificate',()=>owner.click('#manual'));page=popupPage;await selectTab(page);await page.waitForSelector('#utility',{visible:true});
  }
  await operate('login-manual:otp',()=>page.click('#utility'));
  await operate('login-navigation',()=>Promise.all([page.waitForNavigation(),page.click('#entry')]));
  await operate('login-identifier',()=>page.click('#identifier'));await page.type('#identifier',credential.identifier);
  await operate('login-password',()=>page.click('#password'));await page.type('#password',credential.password);
  await operate('login-submit',()=>Promise.all([page.waitForNavigation(),page.click('#submit')]));
  await operate('login-success',()=>page.click('#success'));await operate('inquiry',()=>Promise.all([page.waitForNavigation(),page.click('#inquiry')]));
  await operate('account',()=>page.select('#account','FICTIONAL-ACCOUNT'));
  for(const[role,value]of [['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await page.type('#'+role,value);await page.$eval('#'+role,e=>e.blur());});
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));await operate('logout',()=>Promise.all([page.waitForNavigation(),page.click('#logout')]));
  phase='finish';await owner.bringToFront();await owner.click('#omf-learning-control button');record=await pending;await download.file();await download.close();download=null;
  const loaded=(await vault.read()).record;assert.equal(stable(loaded)===stable(JSON.parse(JSON.stringify(record))),true);
  const evidence=projectEvidence(loaded,{test:true}),evidenceHash=digest(evidence),candidate={schema:2,runtime:evidence.runtime,evidenceHash,steps:evidence.events.map(event=>({eventId:event.id,op:event.role}))};validateRecipe(candidate,evidence,evidenceHash,{test:true});
  const manual=loaded.events[notice?2:1],successor=loaded.events[notice?3:2];assert.equal(manualStateUsable(manual,successor,manual.private.manualState),false);assert.equal(manual.private.manualState.successorId,successor.id);assert.equal(loaded.complete,true);
  assert.equal(stable(evidence).includes('manualState')||stable(candidate).includes('manualState'),false);for(const value of Object.values(credential))assert.equal(stable(loaded).includes(value)||stable(evidence).includes(value)||stable(candidate).includes(value),false);
  await browser.close();fresh=true;browser=await launch();owner=await browser.newPage();page=owner;await owner.setViewport({width:1280,height:1000});await owner.goto(originA);
  const rootReady=await owner.$eval('#manual',e=>({visible:e.getClientRects().length>0,hidden:e.hidden}));assert.equal(rootReady.hidden,notice);assert.equal(rootReady.visible,!notice);const beforePosts=posts;phase='fresh-replay';let receipt,code;
  try{receipt=await replayBankLearning(browser,owner,{record:loaded,evidence,candidate,evidenceHash,candidateHash:digest(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template:{headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},directory:path.join(root,'fresh'),test:true,loginTimeout:1500,manualTimeout:3000,credentials:async()=>{handoffs++;return{...credential};},status:async text=>{
   if(text===waitingNotice){waitingCalls++;return;}assert.equal(text.startsWith('\u672c\u4eba\u64cd\u4f5c'),true,'only human-operation guidance may drive bank actions');
   prompts++;human=true;try{
    if(notice&&prompts===1){const target=browser.targets().find(target=>target.opener()===owner.target());assert.ok(target);priorPage=await target.page();await priorPage.waitForSelector('#notice');await priorPage.bringToFront();const closed=new Promise(resolve=>priorPage.once('close',resolve));await priorPage.click('#notice');await owner.bringToFront();await owner.waitForSelector('#manual',{visible:true});if(!liveEarlier)await closed;assert.equal(priorPage.isClosed(),!liveEarlier);page=owner;}
    else if(notice&&prompts===2){const later=browser.waitForTarget(target=>target.opener()===owner.target()&&target!==priorPage.target(),{timeout:10000});await owner.bringToFront();await owner.click('#manual');popupPage=await(await later).page();await popupPage.waitForSelector('#utility');await popupPage.bringToFront();page=popupPage;}
    else if(!notice&&prompts===1){const target=browser.targets().find(target=>target.opener()===owner.target());assert.ok(target);popupPage=await target.page();await popupPage.waitForSelector('#utility');await popupPage.bringToFront();const observed=await inspectManualBinding(popupPage,successor,{origins:evidence.origins});assert.equal(observed.kind,'hidden');await owner.bringToFront();await owner.click('#manual');await popupPage.bringToFront();await popupPage.waitForSelector('#utility',{visible:true});page=popupPage;}
    else{await popupPage.bringToFront();await popupPage.click('#utility');}
   }finally{human=false;}
  }});}catch(error){code=/^[a-z][a-z0-9-]{0,80}$/.test(error.code||error.message)?error.code||error.message:'unexpected-runtime-error';}
  note('fresh-outcome',{fixtureRoot:root,recordComplete:loaded.complete,candidateAccepted:true,proofUsable:false,code:code||null,codeHasOutwardText:!!code&&learningFailureText(code)!==code,prompts,waitingCalls,handoffs,freshPosts:posts-beforePosts,automaticPosts,humanPosts,rows:receipt?.rows||0,loggedOut:receipt?.loggedOut===true});
  assert.equal(!!receipt,true);assert.equal(receipt.rows,1);assert.equal(receipt.loggedOut,true);assert.equal(prompts,notice?3:2);assert.equal(handoffs,1);assert.equal(posts-beforePosts,1);assert.equal(automaticPosts,1);assert.equal(humanPosts,0);
 }catch(error){note('case-error',{phase,errorName:error.name,events:record?.events.length||0,complete:record?.complete===true,posts});throw Error('popup-journey-'+phase+'-'+error.name);}
 finally{abort.abort();if(pending)await pending.catch(()=>{});if(download)await download.close();if(browser)await browser.close();for(const server of[serverA,serverB])await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
});

// Sessions-only busy recovery: real maintained UI, normal local polling, synthetic owned loopback only.
import test from 'node:test';
// Maintained synthetic loopback fixture; serves the real collector UI and uses the installed SDK.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import '../puppeteer-frame-init.mjs';
// Maintained UI resources resolve relative to this test.
const puppeteer=createRequire(new URL('../package.json',import.meta.url))('rebrowser-puppeteer-core');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const session={id:'a'.repeat(24),state:'awaiting_pc',teachLogin:true,entryOrigin:'https://fictional.example.invalid'};
async function fixture(options={}){
 const arm='maintained';
 const html=await readFile(new URL('../setup.html',import.meta.url)),js=await readFile(new URL('../setup.js',import.meta.url));
 const state={running:false,locked:false,deny:0,unavailable:false,request:null,revision:0,expiresAt:null,sessions:[{...session}],listCalls:0,localCalls:0,runPosts:0,credentialPosts:0,lists:[],locals:[],beforeLists:[],beforeLocals:[],afterLists:[],afterLocals:[],listRules:[],localRules:[],gateLists:false,gateLocals:false,deliveries:[],...options};
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-busy-idle-'));let browser,page,server;const errors=[];
 const send=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const reply=(stream,req,res)=>{
  const isList=stream==='list',call=isList?++state.listCalls:++state.localCalls,rule=(isList?state.listRules:state.localRules).shift()||{},before=isList?state.beforeLists:state.beforeLocals,after=isList?state.afterLists:state.afterLocals;
  const construct=()=>{
   const status=rule.status||(state.locked?(state.deny||403):state.deny)||(!isList&&state.unavailable?503:200);
   const body=status===200?{sessions:isList?structuredClone(state.sessions):[],busy:state.running,credentialRequest:state.request?{...state.request}:null,credentialRevision:state.revision,credentialExpiresAt:state.expiresAt,learningMessage:'',learningMessageRevision:0}:{error:'Synthetic local request unavailable',credentialRevision:state.revision};
   const deliver=()=>{state.deliveries.push({stream,call,status,busy:status===200?body.busy:null,revision:body.credentialRevision,requestPresent:!!body.credentialRequest,at:performance.now()});send(res,status,body);};
   if(rule.after){after.push({call,release:deliver});return;}deliver();
  };
  if(rule.before||(isList?state.gateLists:state.gateLocals)){before.push({call,release:construct});return;}construct();
 };
 try{
  server=http.createServer(async(req,res)=>{
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}if(req.url==='/setup.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
   if(req.url==='/status')return send(res,200,{protected:true,unlocked:!state.locked,mode:'protected',aclProtected:true,accounts:[],banks:[],baseUrl:'https://fictional.example.invalid',yayoi:{},aplus:{},smsSource:{}});
   if(req.url==='/lock'){state.locked=true;state.request=null;state.revision++;return send(res,200,{unlocked:false});}
   if(req.url==='/learning/run'){state.runPosts++;return send(res,503,{error:'Synthetic action refused'});}
   if(req.url==='/learning/credentials'&&req.method==='POST'){for await(const ignored of req){void ignored;}state.credentialPosts++;state.request=null;state.revision++;return send(res,200,{accepted:true});}
   if(req.url==='/learning/sessions')return reply('list',req,res);
   if(req.url==='/learning/credentials'&&req.method==='GET')return reply('local',req,res);
   return send(res,404,{});
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});page=await browser.newPage();page.on('pageerror',e=>errors.push(/^[A-Za-z]+$/.test(e.name)?e.name:'MaskedError'));
  // Held synthetic requests must not prevent the fixture from returning to release them.
  await page.goto('http://127.0.0.1:'+server.address().port+'/#fixture-key',{waitUntil:'domcontentloaded'});
 }catch(error){if(browser)await browser.close();if(server)await new Promise(r=>{server.closeAllConnections();server.close(r);});throw error;}
 const until=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await pause(25);}throw Error('fixture-condition-timeout');};
 const snapshot=()=>page.evaluate(()=>({entryCount:document.querySelectorAll('[data-learning-entry-url]').length,buttonCount:document.querySelectorAll('#learning-sessions button').length,entryDisabled:document.querySelector('[data-learning-entry-url]')?.disabled??null,buttonDisabled:document.querySelector('#learning-sessions button')?.disabled??null,consentChecked:document.querySelector('#learning-sessions input[type=checkbox]')?.checked??null,listSerial:learningListSerial,listApplied:learningListApplied,localSerial:learningSerial,localApplied:learningAppliedSerial,revision:learningRevision,epoch:learningEpoch,busy:learningBusy,consents:learningConsents.size,credentialFields:document.querySelectorAll('#learning-credentials input').length}));
 const appliedLocal=n=>until(async()=>(await snapshot()).localApplied>=n),appliedList=n=>until(async()=>(await snapshot()).listApplied>=n);
 const release=(queue)=>{assert.equal(queue.length,1,'Exactly one owned response gate required');queue.shift().release();};
 const noPosts=()=>{assert.equal(state.runPosts,0);assert.equal(state.credentialPosts,0);assert.deepEqual(errors,[]);};
 const safe=async()=>({dom:await snapshot(),listCalls:state.listCalls,localCalls:state.localCalls,runPosts:state.runPosts,credentialPosts:state.credentialPosts,delivered:state.deliveries.map(({stream,call,status,busy,revision,requestPresent})=>({stream,call,status,busy,revision,requestPresent})),errors:[...errors]});
 const consent=async()=>{await until(async()=>(await snapshot()).consentChecked!==null);await page.click('#learning-sessions input[type=checkbox]');assert.equal((await snapshot()).consentChecked,true);};
 const type=async()=>{await page.waitForSelector('[data-learning-credential=password]');await page.type('[data-learning-credential=identifier]','FICTIONAL-ID');await page.type('[data-learning-credential=password]','FICTIONAL-PASSWORD');return page.$$('#learning-credentials input');};
 const typingIntact=async handles=>{assert.equal(await page.evaluate(()=>document.querySelector('[data-learning-credential=identifier]')?.value==='FICTIONAL-ID'&&document.querySelector('[data-learning-credential=password]')?.value==='FICTIONAL-PASSWORD'&&!document.querySelector('#learning-credentials button')?.disabled),true);for(const handle of handles)assert.equal(await handle.evaluate(e=>e.isConnected),true);};
 const wiped=async handles=>{for(const handle of handles)assert.equal(await handle.evaluate(e=>e.value===''&&e.disabled),true);};
 const close=async()=>{try{state.gateLists=false;state.gateLocals=false;for(const q of [state.beforeLists,state.beforeLocals,state.afterLists,state.afterLocals])for(const gate of q.splice(0))gate.release();}finally{try{await browser.close();}finally{await new Promise(r=>{server.closeAllConnections();server.close(r);});}}};
 return{arm,state,page,until,snapshot,appliedLocal,appliedList,release,noPosts,safe,consent,type,typingIntact,wiped,close,settle:()=>page.waitForNetworkIdle(),userRefresh:()=>page.click('#learning-refresh')};
}
async function busyListFirst(extra={}){
 const f=await fixture({running:true,localRules:[{before:true}],...extra});
 try{await f.appliedList(1);await f.until(()=>f.state.beforeLocals.length===1);return f;}catch(error){await f.close();throw error;}
}
async function recover(f,{checkConsent=true}={}){
 if(checkConsent)await f.consent();f.state.running=false;f.release(f.state.beforeLocals);await f.appliedLocal(1);await f.appliedList(2);f.noPosts();
}

// MAINTAINED-CORE-BEGIN
test('core: sessions-only busy recovers on the normal idle credential response after explicit consent',async()=>{
 let f,stage='setup',initial,old,ready=false;
 const valid=async()=>{if(!f||!initial)return false;const now=await f.snapshot(),first=f.state.deliveries.find(d=>d.stream==='list');return now.epoch===initial.epoch&&now.localApplied>=1&&f.state.runPosts===0&&f.state.credentialPosts===0&&f.state.deliveries.some(d=>d.stream==='local'&&d.status===200&&d.busy===false)&&!f.state.deliveries.some(d=>d.stream==='local'&&d.busy===true)&&first?.busy===true&&performance.now()-first.at<30000;};
 try{
  f=await busyListFirst();await f.consent();initial=await f.snapshot();assert.equal(initial.entryDisabled,true);assert.equal(initial.buttonDisabled,true);assert.equal(initial.consentChecked,true);assert.equal(f.state.listCalls,1);old=await f.page.$('[data-learning-entry-url]');assert(old);
  stage='release-idle';f.state.running=false;f.release(f.state.beforeLocals);await f.appliedLocal(1);
  stage='readiness';await f.until(()=>f.page.evaluate(previous=>{const entry=document.querySelector('[data-learning-entry-url]'),button=document.querySelector('#learning-sessions button'),consent=document.querySelector('#learning-sessions input[type=checkbox]');return !!entry&&entry!==previous&&!entry.disabled&&!!button&&!button.disabled&&consent?.checked===true;},old));ready=true;
  stage='final-checks';assert.equal(await valid(),true);assert.equal(f.state.listCalls,2);f.noPosts();stage='complete';
  console.log('CORE-OBSERVATION '+JSON.stringify({arm:f.arm,stage,readinessReached:ready,sequenceValid:await valid(),state:await f.safe()}));
 }catch(error){console.log('CORE-OBSERVATION '+JSON.stringify({arm:f?.arm||'unavailable',stage,readinessReached:ready,sequenceValid:await valid().catch(()=>false),errorClass:/^[A-Za-z]+$/.test(error.name)?error.name:'MaskedError',intendedReadinessTimeout:stage==='readiness'&&error.message==='fixture-condition-timeout',state:f?await f.safe().catch(()=>({unavailable:true})):null}));throw error;
 }finally{let cleanupError;try{if(old)await old.dispose();}catch(error){cleanupError=error;}try{if(f)await f.close();}catch(error){cleanupError ||= error;}if(cleanupError){console.log('CORE-CLEANUP-FAILED '+JSON.stringify({errorClass:/^[A-Za-z]+$/.test(cleanupError.name)?cleanupError.name:'MaskedError'}));throw cleanupError;}}
});

// MAINTAINED-CONTROLS-BEGIN
async function control(name,create,body){test(name,async()=>{let f;try{f=await create();await body(f);f.noPosts();console.log('CONTROL-OBSERVATION '+JSON.stringify({name,state:await f.safe()}));}finally{if(f)await f.close();}});}
await control('all-idle stays ready without an extra remote refresh',()=>fixture(),async f=>{await f.appliedList(1);await f.appliedLocal(1);await f.consent();assert.equal((await f.snapshot()).entryDisabled,false);assert.equal((await f.snapshot()).buttonDisabled,false);await f.appliedLocal(2);assert.equal(f.state.listCalls,1);});
await control('sustained busy cannot enable consented Start or entry',()=>fixture({running:true}),async f=>{await f.appliedList(1);await f.appliedLocal(1);await f.consent();await f.appliedLocal(2);const s=await f.snapshot();assert.equal(s.entryDisabled,true);assert.equal(s.buttonDisabled,true);assert.equal(s.busy,true);assert.equal(f.state.listCalls,1);});
await control('an idle list cannot erase credential-observed busy before local completion',()=>fixture({running:true}),async f=>{await f.appliedList(1);await f.appliedLocal(1);f.state.running=false;f.state.localRules.push({before:true});await f.userRefresh();await f.appliedList(2);await f.until(()=>f.state.beforeLocals.length===1);assert.equal((await f.snapshot()).busy,true);f.release(f.state.beforeLocals);await f.appliedLocal(2);await f.appliedList(3);assert.equal((await f.snapshot()).busy,false);assert.equal(f.state.listCalls,3);});
await control('busy-to-idle recovery preserves unchecked consent',()=>busyListFirst(),async f=>{await recover(f,{checkConsent:false});const s=await f.snapshot();assert.equal(s.entryDisabled,false);assert.equal(s.buttonDisabled,true);assert.equal(s.consentChecked,false);});
await control('candidate without a replay period remains blocked after recovery',()=>busyListFirst({sessions:[{...session,state:'candidate'}]}),async f=>{await recover(f,{checkConsent:false});const s=await f.snapshot();assert.equal(s.buttonDisabled,true);assert.equal(s.entryCount,0);assert.equal(s.consentChecked,null);});
await control('older-applied busy list cannot latch after a newer idle list',()=>fixture({running:true,listRules:[{after:true}],localRules:[{before:true}]}),async f=>{await f.until(()=>f.state.afterLists.length===1&&f.state.beforeLocals.length===1);f.state.running=false;await f.userRefresh();await f.appliedList(2);await f.appliedLocal(2);f.release(f.state.afterLists);f.release(f.state.beforeLocals);await f.settle();const s=await f.snapshot();assert.equal(s.listApplied,2);assert.equal(s.busy,false);assert.equal(f.state.listCalls,2);});
for(const revisionChange of [true,false])await control(revisionChange?'older credential revision cannot consume an admitted busy latch':'older equal-revision credential serial cannot consume an admitted busy latch',()=>fixture({localRules:[{after:true}]}),async f=>{await f.appliedList(1);await f.until(()=>f.state.afterLocals.length===1);f.state.running=true;if(revisionChange)f.state.revision++;await f.userRefresh();await f.appliedList(2);await f.appliedLocal(2);assert.equal((await f.snapshot()).busy,true);f.release(f.state.afterLocals);await f.settle();const s=await f.snapshot();assert.equal(s.localApplied,2);assert.equal(s.revision,revisionChange?1:0);assert.equal(s.busy,true);assert.equal(f.state.listCalls,2);});
await control('401 wipes credentials and private entry; wrong-epoch busy list cannot latch',()=>fixture({request:{id:'synthetic-request',identifier:true},revision:1,expiresAt:Date.now()+60000}),async f=>{
 await f.appliedList(1);await f.appliedLocal(1);await f.consent();await f.page.type('[data-learning-entry-url]','https://fictional.example.invalid/private');const entry=await f.page.$('[data-learning-entry-url]'),inputs=await f.type(),epoch=(await f.snapshot()).epoch;
 f.state.running=true;f.state.listRules.push({after:true});f.state.localRules.push({before:true});await f.userRefresh();await f.until(()=>f.state.afterLists.length===1&&f.state.beforeLocals.length===1);
 f.state.running=false;f.state.deny=401;f.release(f.state.beforeLocals);await f.until(async()=>(await f.snapshot()).epoch>epoch);f.release(f.state.afterLists);await f.settle();const s=await f.snapshot();assert.equal(s.credentialFields,0);assert.equal(s.consents,0);await f.wiped(inputs);assert.equal(await entry.evaluate(e=>e.value===''&&e.disabled),true);assert.equal(s.listApplied,1);assert.equal(s.busy,false);assert.equal(f.state.listCalls,2);for(const h of [...inputs,entry])await h.dispose();
});
for(const failure of ['held','503'])await control('after a busy-only list, '+failure+' list recovery preserves healthy credential typing',()=>busyListFirst({request:{id:'synthetic-request',identifier:true},revision:1,expiresAt:Date.now()+60000}),async f=>{
 f.state.listRules.push(failure==='held'?{before:true}:{status:503});f.state.running=false;f.release(f.state.beforeLocals);await f.appliedLocal(1);await f.until(()=>f.state.listCalls===2);const inputs=await f.type();await f.appliedLocal(2);await f.typingIntact(inputs);assert.equal(f.state.listCalls,2);assert.equal((await f.snapshot()).busy,false);if(failure==='held')assert.equal(f.state.beforeLists.length,1);else assert(f.state.deliveries.some(d=>d.stream==='list'&&d.status===503));for(const h of inputs)await h.dispose();
});
await control('fixed three idle local polls measure repeated busy-list divergence',()=>fixture({running:true,gateLists:true,gateLocals:true}),async f=>{
 await f.until(()=>f.state.beforeLists.length===1&&f.state.beforeLocals.length===1);f.release(f.state.beforeLists);await f.appliedList(1);await f.consent();
 for(let poll=1;poll<=3;poll++){await f.until(()=>f.state.beforeLocals.length===1);f.state.running=false;f.release(f.state.beforeLocals);await f.appliedLocal(poll);await f.until(()=>f.state.beforeLists.length===1);f.state.running=true;f.release(f.state.beforeLists);await f.appliedList(poll+1);assert.equal((await f.snapshot()).buttonDisabled,true);}
 assert.equal(f.state.localCalls,3);assert.equal(f.state.listCalls,4);assert.equal(f.state.deliveries.filter(d=>d.stream==='local'&&d.busy===false).length,3);assert.equal(f.state.deliveries.filter(d=>d.stream==='list'&&d.busy===true).length,4);console.log('DIVERGENCE-MEASUREMENT '+JSON.stringify({declaredIdlePolls:3,observedLocalCalls:f.state.localCalls,observedListCalls:f.state.listCalls,localBusyTrueResponses:f.state.deliveries.filter(d=>d.stream==='local'&&d.busy===true).length}));
});

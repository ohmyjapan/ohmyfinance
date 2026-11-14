import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
const {replayBankLearning}=await import(process.env.OMF_LOGIN_TEST_RUNNER?pathToFileURL(process.env.OMF_LOGIN_TEST_RUNNER).href:'../collector/bank-learning-runner.mjs');
const {replayLearningLogin,loginControl}=await import(process.env.OMF_LOGIN_TEST_MODULE?pathToFileURL(process.env.OMF_LOGIN_TEST_MODULE).href:'../collector/bank-learning-login.mjs');
import {stable,LEARNING_RUNTIME} from '../shared/finance-bank-learning.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core'),sha=v=>createHash('sha256').update(stable(v)).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
test('actual Chrome: policy-only native destinations, authenticated continuations and bounded cancellation',async t=>{
 let mode='normal',bankPosts=0,sinkPosts=0,sinkRequests=0,sinkGotCredentials=false;
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-login-policy-'));
 const sink=http.createServer(async(req,res)=>{sinkRequests++;let body='';for await(const b of req)body+=b;if(req.method==='POST'){sinkPosts++;const p=new URLSearchParams(body);sinkGotCredentials=p.get('identifier')==='FICTIONAL-ID'&&p.get('password')==='FICTIONAL-PASS';}res.setHeader('Content-Type','text/html');if(sinkGotCredentials){res.setHeader('Set-Cookie','session=fictional; HttpOnly');res.end('<strong id="success">Authenticated fictional successor</strong>');}else{res.writeHead(403);res.end('Refused');}});await new Promise(r=>sink.listen(0,'127.0.0.1',r));const other='http://127.0.0.1:'+sink.address().port;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.method==='POST'){bankPosts++;let body='';for await(const b of req)body+=b;const p=new URLSearchParams(body);if(p.get('identifier')!=='FICTIONAL-ID'||p.get('password')!=='FICTIONAL-PASS'){res.writeHead(403);res.end('Refused');return;}if(mode.startsWith('redirect-')){res.writeHead(Number(mode.slice(9)),{Location:other+'/collect'});res.end();return;}res.setHeader('Set-Cookie','session=fictional; HttpOnly');res.writeHead(303,{Location:'/success'});res.end();return;}
  if(req.url==='/success'&&req.headers.cookie?.includes('session=fictional')){res.end('<strong id="success">Authenticated fictional successor</strong>');return;}
  const direct=mode==='direct',override=mode==='override',approved=mode==='approved-other',blank=mode.includes('blank');
  const action=direct||approved?other+'/collect':'/auth';let attributes=override?' formaction="'+other+'/collect" formmethod="post"':'';
  if(mode==='method-override')attributes=' formmethod="post"';if(mode==='request-submit')attributes=' formaction="/auth"';if(blank)attributes+=' formtarget="_blank"';
  let script='';
  if(mode.startsWith('late-'))script='<script>document.querySelector("#submit").onclick=()=>{'+(mode.includes('override')?'document.querySelector("#submit").formAction='+JSON.stringify(other+'/collect'):'document.querySelector("form").action='+JSON.stringify(other+'/collect'))+';}</script>';
  if(mode==='submit-time')script='<script>document.querySelector("form").onsubmit=()=>{document.querySelector("form").action='+JSON.stringify(other+'/collect')+'}</script>';
  if(mode==='request-submit')script='<script>document.querySelector("#submit").onclick=e=>{e.preventDefault();document.querySelector("form").action='+JSON.stringify(other+'/collect')+';document.querySelector("form").requestSubmit();}</script>';
  if(mode==='scripted'||mode==='input-button')script='<script>document.querySelector("#submit").onclick=e=>{e.preventDefault();document.querySelector("form").requestSubmit();}</script>';
  const submit=mode.startsWith('input-')?'<input id="submit" type="'+mode.slice(6)+'" value="Sign in">':'<button id="submit"'+attributes+'>Sign in</button>';
  res.end('<form method="'+(mode==='method-override'?'get':'post')+'" action="'+action+'"><input id="identifier" name="identifier"><input id="password" name="password" type="password">'+submit+'</form>'+script);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const roles=[['login-identifier','input','text','#identifier'],['login-password','input','password','#password'],['login-submit','button','','#submit'],['login-success','text','','#success'],['account','select','','#account'],['from','input','','#from'],['to','input','','#to'],['export','button','','#export'],['balance','text','','#balance'],['logout','button','','#logout']];
 const recordFor=()=>({schema:2,origins:[origin],complete:true,truncated:false,events:roles.map(([role,tag,type,selector],i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin,role,tag,private:{selector,type,framePath:[]}}))});
 async function opened(){const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+Math.random().toString(16).slice(2))}),page=await browser.newPage();await page.goto(origin);return {browser,page};}
 const mapping=record=>{const evidence={schema:2,runtime:LEARNING_RUNTIME,origins:[origin],events:record.events.map(({private:local,...e})=>e),complete:true,truncated:false},evidenceHash=sha(evidence),candidate={schema:2,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};return{record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template:{},directory:path.join(root,mode),test:true,loginTimeout:250,credentials:async()=>({identifier:'FICTIONAL-ID',password:'FICTIONAL-PASS'})};};
 try{
  for(const value of ['direct','override','late-action','late-override','submit-time','late-action-blank','late-override-blank','redirect-307','redirect-308','request-submit'])await t.test('policy-only full runner refuses '+value+' without a foreign request',async()=>{
   mode=value;bankPosts=0;sinkPosts=0;sinkRequests=0;sinkGotCredentials=false;const {browser,page}=await opened();
   try{let outcome;try{await replayBankLearning(browser,page,mapping(recordFor()));}catch(error){outcome=error.message;}await pause(100);const passwordFilled=value==='direct'?await page.$eval('#password',e=>e.value.length>0):undefined;console.log('Policy boundary receipt '+JSON.stringify({case:value,outcome,bankPosts,sinkRequests,sinkPosts,sinkGotCredentials,passwordFilled}));assert.equal(outcome,['direct','override'].includes(value)?'login-control-changed':'login-outcome-unconfirmed');assert.equal(sinkRequests,0);assert.equal(sinkPosts,0);assert.equal(sinkGotCredentials,false);assert.equal(bankPosts,value.startsWith('redirect-')?1:0);if(value==='direct')assert.equal(passwordFilled,false,'direct refusal precedes password write');}finally{await browser.close();}
  });
  for(const value of ['normal','approved-other','method-override','scripted','input-button','input-submit','normal-blank'])await t.test('policy-only legitimate '+value+' authenticates exactly once',async()=>{
   mode=value;bankPosts=0;sinkPosts=0;sinkGotCredentials=false;const {browser,page}=await opened();
   try{const events=recordFor().events.slice(0,4),origins=value==='approved-other'?[origin,other]:[origin];if(value==='approved-other')events[3].origin=other;if(value.startsWith('input-'))events[2].tag='input';let surface=page;
    const locate=async e=>({element:await surface.$(e.private.selector)}),probe=async e=>{try{if(value==='normal-blank'&&e.role==='login-success'){for(const p of await browser.pages())if(p!==page&&await p.$('#success'))surface=p;}if(new URL(surface.url()).origin!==e.origin)return false;const el=await surface.$(e.private.selector);if(!el)return false;try{return await el.evaluate(loginControl,{role:e.role,tag:e.tag,type:e.private.type,origins});}finally{await el.dispose().catch(()=>{});}}catch{return false;}};
    const receipt=await replayLearningLogin(events,{locate,probe,approvedOrigins:origins,credentials:async()=>({identifier:'FICTIONAL-ID',password:'FICTIONAL-PASS'}),timeout:3000});assert.equal(receipt.outcome,'success');assert.equal(bankPosts+sinkPosts,1);assert.equal(sinkPosts,value==='approved-other'?1:0);assert.ok((await surface.cookies()).some(c=>c.name==='session'&&c.httpOnly),'success requires validated credentials and HttpOnly session');
   }finally{await browser.close();}
  });
  await t.test('Chrome ignores meta outside head; missing-head executor refuses before secret write',async()=>{
   mode='late-action';sinkPosts=0;sinkRequests=0;const {browser,page}=await opened();
   try{await page.evaluate(()=>document.head.remove());const events=recordFor().events.slice(0,4);await assert.rejects(replayLearningLogin(events,{locate:async e=>({element:await page.$(e.private.selector)}),probe:async()=>false,approvedOrigins:[origin],credentials:async()=>({identifier:'FICTIONAL-ID',password:'FICTIONAL-PASS'}),timeout:250}),{message:'login-control-changed'});assert.equal(await page.$eval('#identifier',e=>e.value),'');assert.equal(await page.$eval('#password',e=>e.value),'');assert.equal(sinkRequests,0);
    await page.evaluate(origin=>{const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content='form-action '+origin;document.documentElement.append(meta);},origin);await page.type('#identifier','FICTIONAL-ID');await page.type('#password','FICTIONAL-PASS');await page.click('#submit');for(let n=0;n<100&&!sinkPosts;n++)await pause(20);assert.equal(sinkPosts,1,'executed counterexample: CSP outside head does not protect native POST');
   }finally{await browser.close();}
  });
  await t.test('full generated navigation refuses unsafe GET target before clicking',async()=>{
   mode='normal';sinkRequests=0;const {browser,page}=await opened();try{await page.setContent('<form method="GET" action="'+other+'/collect"><button id="entry">Open sign in</button></form>');const record=recordFor();record.events.unshift({id:'e99',document:'d0',frame:'f0',popup:'p0',origin,role:'login-navigation',tag:'button',private:{selector:'#entry',type:'',framePath:[]}});await assert.rejects(replayBankLearning(browser,page,mapping(record)),{message:'login-control-changed'});assert.equal(sinkRequests,0);}finally{await browser.close();}
  });
  for(const blank of [false,true])await t.test('post-dispatch '+(blank?'popup':'same-page')+' abort reports cancelled and clicks once; fixture owns cleanup',async()=>{
   mode=blank?'normal-blank':'normal';bankPosts=0;const {browser,page}=await opened(),abort=new AbortController();let clicks=0;
   try{const events=recordFor().events.slice(0,4),locate=async e=>{const element=await page.$(e.private.selector);if(e.role==='login-submit'){const click=element.click.bind(element);element.click=async(...args)=>{clicks++;try{return await click(...args);}finally{abort.abort();}};}return{element};};await assert.rejects(replayLearningLogin(events,{locate,probe:async()=>false,signal:abort.signal,credentials:async()=>({identifier:'FICTIONAL-ID',password:'FICTIONAL-PASS'})}),{message:'login-cancelled'});assert.equal(clicks,1);assert.ok(bankPosts<=1,'no retry; an already submitted request may arrive');}finally{await browser.close();}
  });
 }finally{for(const s of [server,sink])await new Promise(r=>{s.closeAllConnections();s.close(r);});}
 console.log('Policy-only fictional Chrome artifacts retained at '+root);
});

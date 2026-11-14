import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runBankLearning,learningStore} from '../collector/bank-learning.mjs';
import {stable,LEARNING_RUNTIME} from '../shared/finance-bank-learning.mjs';
const sha=v=>createHash('sha256').update(stable(v)).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
for(const popup of [false,true])test('real runBankLearning owner closes '+(popup?'popup':'same-page')+' Chrome after post-dispatch cancel before fixture cleanup',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-real-owner-cancel-')),id='a'.repeat(24),bankAccountId='b'.repeat(24),ownerOrigin='https://fictional-omf.invalid',identity={installationId:'fictional-installation',generation:'fictional-generation'},abort=new AbortController(),sent=[];
 let bankPosts=0,credentialHandoffs=0,browser,child,launched=false,fixtureCleanup=false;
 const portal=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.method==='POST'){
   bankPosts++;let body='';for await(const b of req)body+=b;const p=new URLSearchParams(body);assert.equal(p.get('identifier'),'FICTIONAL-OWNER-ID');assert.equal(p.get('password'),'FICTIONAL-OWNER-PASSWORD');abort.abort();
   res.setHeader('Set-Cookie','session=fictional; HttpOnly');res.writeHead(303,{Location:'/success'});res.end();return;
  }
  if(req.url==='/success'&&req.headers.cookie?.includes('session=fictional'))return res.end('<strong id="success">Authenticated</strong>');
  res.end('<form method="POST" action="/signin"'+(popup?' target="_blank"':'')+'><input id="identifier" name="identifier"><input id="password" name="password" type="password"><button id="submit">Sign in</button></form>');
 });await new Promise(r=>portal.listen(0,'127.0.0.1',r));const bankOrigin='http://127.0.0.1:'+portal.address().port;
 const roles=[['login-identifier','input','text','#identifier'],['login-password','input','password','#password'],['login-submit','button','','#submit'],['login-success','text','','#success'],['account','select','','#account'],['from','input','','#from'],['to','input','','#to'],['export','button','','#export'],['balance','text','','#balance'],['logout','button','','#logout']];
 const record={schema:2,entryUrl:bankOrigin,origins:[bankOrigin],complete:true,truncated:false,events:roles.map(([role,tag,type,selector],i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin:bankOrigin,role,tag,private:{selector,type,framePath:[]}}))},evidence={schema:2,runtime:LEARNING_RUNTIME,origins:[bankOrigin],events:record.events.map(({private:local,...event})=>event),complete:true,truncated:false},evidenceHash=sha(evidence),candidate={schema:2,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))},candidateHash=sha(candidate),store=learningStore(root,id),binding={sessionId:id,origin:ownerOrigin,...identity,bankAccountId};
 await store.update(()=>({binding,record,evidenceHash}));
 const remote={learningIdentity:identity,learning:async(route,body)=>{sent.push({action:route.split('/').at(-1),code:body?.code||null});if(route.endsWith('/replay'))return {claim:'synthetic-claim',nonce:'synthetic-nonce',session:{...identity,bankAccountId,entryOrigin:bankOrigin,evidenceHash,candidate,candidateHash,template:{},replayPeriod:{from:'2026-11-01',to:'2026-11-02'}}};return{accepted:true};}};
 try{
  const ownerOverride=process.env.OMF_LOGIN_TEST_OWNER?{browser:(await import(pathToFileURL(process.env.OMF_LOGIN_TEST_OWNER).href)).withBankBrowser}:{};
  await assert.rejects(runBankLearning({id,action:'replay',remote,root,live:{abort,broker:{remote}},origin:ownerOrigin,test:true,...ownerOverride,onLaunch:async value=>{browser=value.browser;child=browser.process();launched=true;assert.equal(value.pid,child.pid);assert.ok(child.spawnargs.some(a=>a.startsWith('--user-data-dir=')&&a.includes(root)));},credentials:async()=>{credentialHandoffs++;return{identifier:'FICTIONAL-OWNER-ID',password:'FICTIONAL-OWNER-PASSWORD'};}}),{code:'login-cancelled'});
  const exited=child.exitCode!==null||!!child.signalCode;let pidAlive=true;try{process.kill(child.pid,0);}catch{pidAlive=false;}
  console.log('REAL-OWNER-CANCEL '+JSON.stringify({popup,launched,ownedPid:child.pid,bankPosts,credentialHandoffs,connected:browser.connected,exited,pidAlive,fixtureCleanup,failed:sent.filter(x=>x.action==='failed').map(x=>x.code),receiptCount:sent.filter(x=>x.action==='receipt').length}));
  assert.equal(fixtureCleanup,false);assert.equal(bankPosts,1);assert.equal(credentialHandoffs,1);assert.equal(browser.connected,false,'production withBankBrowser closes before test cleanup');assert.equal(exited,true,'owned child has exited before fixture cleanup');assert.equal(pidAlive,false,'captured owned process no longer exists before fixture cleanup');assert.deepEqual(sent.filter(x=>x.action==='failed').map(x=>x.code),['login-cancelled']);assert.equal(sent.filter(x=>x.action==='receipt').length,0);assert.equal(sent.filter(x=>x.action==='finish').length,1);assert.equal((await store.read()).loginReplayAttempt,candidateHash);
 }finally{
  fixtureCleanup=true;if(browser?.connected)await browser.close();if(child&&child.exitCode===null&&!child.signalCode){child.kill();for(let n=0;n<50&&child.exitCode===null&&!child.signalCode;n++)await pause(100);}await new Promise(r=>{portal.closeAllConnections();portal.close(r);});
 }
});

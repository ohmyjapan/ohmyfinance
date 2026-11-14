import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
const {replayLearningLogin,loginControl}=await import(process.env.OMF_LOGIN_TEST_MODULE?pathToFileURL(process.env.OMF_LOGIN_TEST_MODULE).href:'../collector/bank-learning-login.mjs');
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
for(const submitted of [true,false])test('manual stop phase '+(submitted?'possible submitted outcome':'no submission'),async()=>{
 let posts=0,gets=0;
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','text/html');if(req.method==='POST'){posts++;for await(const chunk of req){}res.end('<article id="checkpoint">Manual check</article><main id="success">Success already present at manual entry</main>');return;}gets++;res.end('<form method="POST" action="/signin"><input id="identifier"><input id="password" type="password"><button id="submit">Sign in</button></form>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,root=await mkdtemp(path.join(os.tmpdir(),'omf-stop-phases-')),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});
 try{const page=await browser.newPage();await page.goto(origin);
  const roles=submitted?[['login-identifier','input','text','#identifier'],['login-password','input','password','#password'],['login-submit','button','','#submit'],['login-manual','text','','#checkpoint'],['login-success','text','','#success']]:[['login-manual','text','','#missing-checkpoint'],['login-success','text','','#success']],events=roles.map(([role,tag,type,selector],i)=>({id:'e'+i,role,tag,origin,format:role==='login-manual'?'certificate':undefined,private:{selector,type,framePath:[]}}));
  const probe=async e=>{try{const h=await page.$(e.private.selector);if(!h)return false;try{return await h.evaluate(loginControl,{role:e.role,tag:e.tag,type:e.private.type,origins:[origin]});}finally{await h.dispose().catch(()=>{});}}catch{return false;}};
  let manualCalls=0;await assert.rejects(replayLearningLogin(events,{locate:async e=>({element:await page.$(e.private.selector)}),probe,approvedOrigins:[origin],credentials:async()=>({identifier:'FICTIONAL',password:'FICTIONAL'}),status:()=>{manualCalls++;},timeout:200,manualTimeout:200}),{message:submitted?'login-outcome-unconfirmed':'login-not-submitted'});
  assert.equal(posts,submitted?1:0,'actual login submissions');assert.ok(gets>=1,'Chrome visited the bank page');assert.equal(manualCalls,0,'invalid successor never asks for another human submission');console.log(JSON.stringify({submitted,posts,pageVisits:gets,retries:0}));
 }finally{await browser.close();await new Promise(r=>{server.closeAllConnections();server.close(r);});}
});

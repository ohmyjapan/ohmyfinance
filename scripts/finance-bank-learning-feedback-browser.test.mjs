import {selectLearningRole} from './finance-bank-learning-capture-ack.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
const {recordBankLearning,projectEvidence}=await import(process.env.OMF_LOGIN_TEST_RECORDER?pathToFileURL(process.env.OMF_LOGIN_TEST_RECORDER).href:'../collector/bank-learning-recorder.mjs');
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core'),pause=ms=>new Promise(r=>setTimeout(r,ms));
for(const kind of ['image','div','numeric-identifier','text-password','numeric-identifier-frame'])test('visible unsupported recording feedback '+kind,async()=>{
 let posts=0,authenticated=0,record;const abort=new AbortController(),root=await mkdtemp(path.join(os.tmpdir(),'omf-login-feedback-'));
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','text/html');if(kind.endsWith('-frame')&&req.url==='/'){res.end('<iframe src="/login"></iframe>');return;}if(req.method==='POST'){posts++;let body='';for await(const part of req)body+=part;const values=new URLSearchParams(body);if(values.get('identifier')==='1234'&&values.get('password')==='FICTIONAL-FEEDBACK-PASSWORD'){authenticated++;res.setHeader('Set-Cookie','session=fictional; HttpOnly');res.writeHead(303,{Location:'/home'});res.end();return;}res.writeHead(403);res.end('Refused');return;}
  if(req.url==='/home'){assert.ok(req.headers.cookie?.includes('session=fictional'));res.end('<strong id="success">Authenticated</strong>');return;}
  res.end('<p id="manual">????</p><form action="/signin" method="POST"><input id="identifier" name="identifier" type="'+(kind.startsWith('numeric-identifier')?'number':'text')+'"><input id="password" name="password" type="'+(kind==='text-password'?'text':'password')+'">'+(kind==='image'?'<input id="submit" type="image" alt="Sign in" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">':kind==='div'?'<div id="submit" role="button" onclick="this.closest(\'form\').requestSubmit()">Sign in</div>':'<button id="submit">Sign in</button>')+'</form>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});let pending;
 try{let page=await browser.newPage();await page.goto(origin);pending=recordBankLearning(browser,page,{entryOrigin:origin,teachLogin:true,test:true,signal:abort.signal,timeout:15000,store:async value=>{record=structuredClone(value);}});void pending.catch(()=>{});await page.waitForSelector('#omf-learning-control select');if(kind.endsWith('-frame')){page=page.frames().find(f=>f.parentFrame());await page.waitForSelector('#omf-learning-control select');}
  const choose=async role=>{const toggle=await page.$('#omf-learning-control [data-learning-toggle]');if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();await selectLearningRole(page,role,pending);},until=async fn=>{for(let n=0;n<100;n++){if(await fn())return;await pause(20);}throw Error('feedback-condition-timeout');};
  const operate=async(role,selector)=>{const count=record?.events.length||0;await choose(role);await page.click(selector);await until(()=>record?.events.length===count+1);};
  if(kind==='image'||kind==='div'){
   await operate('login-identifier','#identifier');await page.type('#identifier','1234');await operate('login-password','#password');await page.type('#password','FICTIONAL-FEEDBACK-PASSWORD');await choose('login-submit');await Promise.all([page.waitForNavigation(),page.click('#submit')]);await page.waitForSelector('#omf-learning-control [data-learning-feedback]');
   await page.waitForFunction(()=>document.querySelector('#omf-learning-control [data-learning-feedback]').textContent.includes('この送信方法'));
   assert.equal(await page.$eval('#omf-learning-control [data-learning-feedback]',e=>e.textContent.includes('本人操作として記録')),false,'unsupported submit does not offer an impossible manual replacement');
   assert.equal(await page.$eval('#omf-learning-control [data-learning-feedback]',e=>e.getClientRects().length>0),true,'guidance remains visible after the real unsupported submit navigates');assert.equal(posts,1);assert.equal(authenticated,1);assert.equal(record.events.some(e=>e.role==='login-submit'),false);assert.ok(!record.loginSequenceUnsupported,'the control warning alone is recoverable');
   await choose('login-success');await page.click('#success');await until(()=>record.loginSequenceUnsupported);assert.throws(()=>projectEvidence(record,{test:true}),{message:'unsupported-login-sequence'});assert.equal(record.events.some(e=>e.role==='login-success'),false);
  }else{
   const role=kind.startsWith('numeric-identifier')?'login-identifier':'login-password',selector=kind.startsWith('numeric-identifier')?'#identifier':'#password';await choose(role);await page.click(selector);await page.waitForFunction(()=>document.querySelector('#omf-learning-control [data-learning-feedback]').textContent.includes('本人操作として記録'));assert.equal(await page.$eval('#omf-learning-control [data-learning-feedback]',e=>{const r=e.getBoundingClientRect();return e.getClientRects().length>0&&r.top>=0&&r.bottom<=innerHeight;}),true,'unsupported guidance is visible in the actual compact controls');assert.equal(record?.events.length||0,0);assert.equal(posts,0);
   await operate('login-manual:other','#manual');assert.equal(await page.$eval('#omf-learning-control [data-learning-feedback]',e=>e.textContent),'記録しました');assert.ok(!record.loginSequenceUnsupported);assert.ok(!record.loginRedirectUnsupported);
  }
  assert.ok(!JSON.stringify(record).includes('FICTIONAL-FEEDBACK-PASSWORD'));console.log('FEEDBACK '+JSON.stringify({kind,posts,authenticated,terminalRefusal:!!record.loginSequenceUnsupported}));abort.abort();await assert.rejects(pending,/demonstration-cancelled/);
 }finally{abort.abort();if(pending)await pending.catch(()=>{});await browser.close();await new Promise(r=>{server.closeAllConnections();server.close(r);});}
});

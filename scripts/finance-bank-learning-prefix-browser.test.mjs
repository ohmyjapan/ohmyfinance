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
const {recordBankLearning}=await import(process.env.OMF_LOGIN_TEST_RECORDER?pathToFileURL(process.env.OMF_LOGIN_TEST_RECORDER).href:'../collector/bank-learning-recorder.mjs');
import {learningFailureText} from '../shared/finance-bank-learning.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core'),pause=ms=>new Promise(r=>setTimeout(r,ms));
test('actual recorder rejects unsupported login prefix before statement work or a model handoff',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-prefix-')),server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<form action="/auth" method="POST"><input id="identifier"><input id="password" type="password"><button id="submit" onclick="event.preventDefault()">Sign in</button></form><form action="/auth" method="POST"><input id="other-password" type="password"></form>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});
 try{for(const variant of ['duplicate-identifier','duplicate-password','duplicate-submit','different-document','different-form'])await t.test(variant,async()=>{
  const page=await browser.newPage();await page.goto(origin);const abort=new AbortController();let record;
  const pending=recordBankLearning(browser,page,{entryOrigin:origin,teachLogin:true,test:true,signal:abort.signal,store:async value=>{record=structuredClone(value);}});void pending.catch(()=>{});
  const operate=async(role,selector)=>{await page.waitForSelector('#omf-learning-control select');await selectLearningRole(page,role,pending);await page.click(selector);};
  const wait=async count=>{for(let n=0;n<100&&record?.events.length!==count;n++)await pause(20);assert.equal(record?.events.length,count);await page.waitForFunction(()=>document.querySelector('#omf-learning-control select')?.value==='');};
  try{
   await operate('login-identifier','#identifier');await wait(1);
   if(variant==='different-document')await page.goto(origin+'/password');
   if(['duplicate-password','duplicate-submit'].includes(variant)){await operate('login-password','#password');await wait(2);}
   if(variant==='duplicate-submit'){await operate('login-submit','#submit');await wait(3);}
   const count=record.events.length,target=variant==='duplicate-identifier'?['login-identifier','#identifier']:variant==='duplicate-submit'?['login-submit','#submit']:['login-password',variant==='different-form'?'#other-password':'#password'];
   await operate(...target);await page.waitForFunction(message=>document.querySelector('#omf-learning-control small').textContent===message,{timeout:1000},learningFailureText('unsupported-login-sequence'));
   assert.equal(record.events.length,count,'unsupported event not persisted or accepted for model development');assert.equal(record.complete,false);assert.ok(!record.events.some(e=>e.role==='account'));
  }finally{abort.abort();await assert.rejects(pending,/demonstration-cancelled/);await page.close();}
 });}finally{await browser.close();await new Promise(r=>server.close(r));}
});

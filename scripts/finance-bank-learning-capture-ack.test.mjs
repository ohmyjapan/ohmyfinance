import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
import {recordBankLearning} from '../collector/bank-learning-recorder.mjs';
import {selectLearningRole,waitForLearningCapture} from './finance-bank-learning-capture-ack.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');

for(const frame of [false,true])test('actual capture ACK and visible saving '+(frame?'same-origin frame':'main document'),async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-capture-ack-')),abort=new AbortController();let browser,pending,release,stored,record;
 const held=new Promise(resolve=>{release=resolve;}),persisted=new Promise(resolve=>{stored=resolve;});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(frame&&req.url==='/'?'<iframe src="/account"></iframe>':'<select id="account" onchange="document.body.dataset.bankActions=String(Number(document.body.dataset.bankActions||0)+1)"><option value="">Choose</option><option value="FICTIONAL">Fictional</option></select><input id="from"><button id="bank-control">Bank control</button>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});const owner=await browser.newPage();await owner.goto(origin);const surface=frame?owner.frames().find(f=>f.parentFrame()):owner;
  pending=recordBankLearning(browser,owner,{entryOrigin:origin,test:true,signal:abort.signal,timeout:15000,store:async value=>{record=structuredClone(value);if(record.events.at(-1)?.role==='account'){stored();await held;}}});void pending.catch(()=>{});
  await surface.waitForSelector('#omf-learning-control select');await selectLearningRole(surface,'account',pending);await surface.select('#account','FICTIONAL');await persisted;
  const snapshot=()=>surface.evaluate(()=>{const panel=document.querySelector('#omf-learning-control'),status=panel.querySelector('small'),name=Object.keys(window).find(name=>/^__omfLearn[0-9a-f]{16}$/.test(name));return{role:panel.querySelector('select').value,busy:status.getAttribute('aria-busy'),saving:status.textContent.startsWith('保存中'),saved:status.textContent==='記録しました',selectDisabled:panel.querySelector('select').disabled,finishDisabled:panel.querySelector('button').disabled,bankDisabled:document.querySelector('#bank-control').disabled,callbackPending:window[name].callbacks.size,bankActions:Number(document.body.dataset.bankActions)};});
  const before=await snapshot();assert.equal(record.events.length,1);assert.deepEqual(before,{role:'account',busy:'true',saving:true,saved:false,selectDisabled:false,finishDisabled:false,bankDisabled:false,callbackPending:1,bankActions:1});
  // The independent SDK waiter must remain pending after Node persistence. This
  // checks actual next-role selection, rather than deriving ACK from the UI.
  const next=selectLearningRole(surface,'from',pending);void next.catch(()=>{});
  const during=await snapshot();assert.equal(during.role,'account','the actor cannot select the next role while the real callback is pending');assert.equal(during.callbackPending,1);assert.equal(during.bankActions,1);
  release();await next;await waitForLearningCapture(surface,pending);const after=await snapshot();assert.equal(after.role,'from');assert.equal(after.busy,'false');assert.equal(after.saving,false);assert.equal(after.saved,true);assert.equal(after.callbackPending,0);assert.equal(after.bankActions,1);
  await surface.$eval('#from',element=>{element.value='2026-10-01';element.dispatchEvent(new Event('change',{bubbles:true}));});await waitForLearningCapture(surface,pending);assert.deepEqual(record.events.map(event=>event.role),['account','from']);assert.equal((await snapshot()).bankActions,1);
  console.log('CONTROLLED-CAPTURE-ACK '+JSON.stringify({frame,persistedBeforeAck:true,actualCallbackPending:before.callbackPending,savingThenSaved:true,bankActions:1,recordedRoles:record.events.map(event=>event.role)}));
  abort.abort();await assert.rejects(pending,/demonstration-cancelled/);
 }finally{release();abort.abort();if(pending)await pending.catch(()=>{});if(browser)await browser.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
});

test('missing binding is not ACK and the existing recording boundary stops the waiter',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-capture-unknown-'));let browser,rejectRecording;
 const recording=new Promise((_,reject)=>{rejectRecording=reject;});void recording.catch(()=>{});
 try{browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile')});const page=await browser.newPage();await page.setContent('<div id="omf-learning-control"><select><option value="from">From</option></select></div>');let settled=false;const waiting=waitForLearningCapture(page,recording).finally(()=>{settled=true;});void waiting.catch(()=>{});await page.evaluate(()=>Promise.resolve());assert.equal(settled,false);rejectRecording(Error('owned-recording-ended'));await assert.rejects(waiting,/owned-recording-ended/);
 }finally{rejectRecording(Error('owned-recording-ended'));if(browser)await browser.close();}
});

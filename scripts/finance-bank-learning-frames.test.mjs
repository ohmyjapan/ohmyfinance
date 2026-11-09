import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {learningDownload,replayBankLearning} from '../collector/bank-learning-runner.mjs';
import {stable,LEARNING_RUNTIME} from '../shared/finance-bank-learning.mjs';
test('real Chrome: approved extra bank origin, popup and nested frame retain their own control identities',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-frames-'));
 const data=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/bye'){res.end('<p>ログアウト済み</p>');return;}
  if(req.url.startsWith('/csv')){const q=new URL(req.url,'http://localhost').searchParams;res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="frame.csv"');res.end('date,description,amount\n'+q.get('from')+',Private frame supplier,-100\n');return;}
  res.end(`<select id="account"><option value="">選択</option><option value="private-frame-account">Account</option></select><input id="from"><input id="to"><button id="export" onclick="location.href='/csv?from='+document.getElementById('from').value+'&to='+document.getElementById('to').value">CSVを出力</button><span id="balance">123,456</span><button id="logout" onclick="location.href='/bye'">ログアウト</button>`);
 });
 await new Promise(r=>data.listen(0,'127.0.0.1',r));const extra='http://127.0.0.1:'+data.address().port;
 const site=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/shell'?'<iframe style="width:100%;height:700px" src="'+extra+'/details"></iframe>':'<button id="inquiry" onclick="window.open(\'/shell\')">照会を開く</button>');});
 await new Promise(r=>site.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+site.address().port;
 const launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+Math.random().toString(16).slice(2))});
 let browser,recording;
 try{
  browser=await launch();const page=await browser.newPage();await page.goto(origin);let record;
  const origins=[origin],download=await learningDownload(browser,path.join(root,'demo'),{origins});
  recording=recordBankLearning(browser,page,{entryOrigin:origin,origins,test:true,timeout:30000,store:async r=>{record=structuredClone(r);}});void recording.catch(e=>console.log('Synthetic recorder outcome: '+e.message));
  const operate=async(frame,role,fn)=>{await frame.waitForSelector('#omf-learning-control select:not([hidden])');await frame.select('#omf-learning-control select',role);const n=record?.events.length||0;await fn();for(let i=0;i<100&&(record?.events.length||0)===n;i++)await new Promise(r=>setTimeout(r,20));assert.equal(record?.events.length,n+1,role);console.log('Synthetic recorded role: '+role);};
  const opened=browser.waitForTarget(t=>t.url()===origin+'/shell');await operate(page,'inquiry',()=>page.click('#inquiry'));const popup=await(await opened).page();popup.on('pageerror',e=>console.log('Synthetic popup error: '+e.message));await popup.waitForSelector('iframe');
  let frame;for(let i=0;i<100&&!frame;i++){frame=popup.frames().find(f=>f.url()===extra+'/details');if(!frame)await new Promise(r=>setTimeout(r,20));}assert.ok(frame);
  await frame.waitForSelector('#omf-learning-control button');assert.equal(await frame.$eval('#omf-learning-control select',el=>el.hidden),true,'new origin is paused until local approval');
  await frame.evaluate(async()=>{await [...document.querySelectorAll('#omf-learning-control button')].find(b=>b.textContent.includes('記録に追加')).onclick();});
  await operate(frame,'account',()=>frame.select('#account','private-frame-account'));
  for(const role of ['from','to'])await operate(frame,role,async()=>{await frame.type('#'+role,role==='from'?'2026-10-01':'2026-10-02');await frame.$eval('#'+role,e=>e.blur());});
  await operate(frame,'export',()=>frame.click('#export'));await operate(frame,'balance',()=>frame.click('#balance'));await operate(frame,'logout',()=>Promise.all([frame.waitForNavigation(),frame.click('#logout')]));
  await popup.click('#omf-learning-control button');
  record=await recording;console.log('Synthetic frame recording complete');await download.file();await download.close();
  const evidence=projectEvidence(record,{test:true});assert.deepEqual(evidence.origins,[origin,extra]);assert.ok(evidence.events.some(e=>e.popup==='p1'&&e.origin===extra));assert.ok(!JSON.stringify(evidence).includes('private-frame-account'));
  const hash=v=>createHash('sha256').update(stable(v)).digest('hex'),evidenceHash=hash(evidence),candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};
  await browser.close();browser=await launch();const fresh=await browser.newPage();
  const receipt=await replayBankLearning(browser,fresh,{record,evidence,candidate,evidenceHash,candidateHash:hash(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template:{headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},directory:path.join(root,'replay'),awaitLogin:p=>p.goto(origin),test:true});
  assert.equal(receipt.rows,1);assert.equal(receipt.loggedOut,true);console.log('Synthetic popup/frame evidence retained at '+root);
 }finally{if(browser)await browser.close();if(recording)await recording.catch(()=>{});await new Promise(r=>site.close(r));await new Promise(r=>data.close(r));}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {learningDownload,replayBankLearning,inspectLearningStatement} from '../collector/bank-learning-runner.mjs';
import {LEARNING_RUNTIME,stable,validateRecipe} from '../shared/finance-bank-learning.mjs';
const sha=v=>createHash('sha256').update(stable(v)).digest('hex');
test('real Chrome: record a previously unknown synthetic portal; replay with fresh cookies and different dates',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-browser-')),received=[];
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url.startsWith('/signin')){res.setHeader('Set-Cookie','session=synthetic-private-session; HttpOnly; SameSite=Strict');res.writeHead(302,{Location:'/home'});res.end();return;}
  if(req.url==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0; HttpOnly');res.end('<p>ログアウトしました</p>');return;}
  if(req.url.startsWith('/csv')){
    const query=new URL(req.url,'http://localhost').searchParams;received.push(Object.fromEntries(query));
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="private-statement.csv"');res.end('date,description,amount\r\n'+query.get('from')+',Private supplier,-1234\r\n');return;
  }
  if(!req.headers.cookie?.includes('session=')){res.end('<form action="/signin"><input id="password" type="password"><button id="signin">Sign in</button></form>');return;}
  if(req.url==='/home'){res.end('<button id="inquiry" onclick="location.href=\'/details\'">取引照会へ</button>');return;}
  res.end(`<label>口座<select id="account"><option value="">選択</option><option value="PRIVATE-ACCOUNT-001">Private company ordinary 001</option></select></label>
  <label>開始日<input id="from"></label><label>終了日<input id="to"></label>
  <button id="export" onclick="location.href='/csv?from='+document.getElementById('from').value+'&to='+document.getElementById('to').value">CSVを出力</button>
  <p>残高 <span id="balance">100,000</span></p><button id="logout" onclick="location.href='/logout'">ログアウト</button>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+Math.random().toString(16).slice(2))});
 let browser;
 const login=async page=>{await page.goto(origin);await page.type('#password','PRIVATE-PASSWORD-OTP-987654');await Promise.all([page.waitForNavigation(),page.click('#signin')]);};
 try{
  browser=await launch();let page=await browser.newPage();await login(page);
  const download=await learningDownload(browser,path.join(root,'record-download'),{origins:[origin]});
  let record;
  const recording=recordBankLearning(browser,page,{entryOrigin:origin,test:true,timeout:30000,store:async value=>{record=structuredClone(value);}});
  void recording.catch(e=>console.log('Synthetic recorder outcome: '+e.message)); // A failed action still closes Chrome without an unhandled recorder rejection.
  const operate=async(role,fn)=>{
    await page.waitForSelector('#omf-learning-control select');await page.select('#omf-learning-control select',role);
    const count=record?.events.length||0;await fn();
    for(let i=0;i<100&&(record?.events.length||0)===count;i++)await new Promise(resolve=>setTimeout(resolve,20));
    if(record?.events.length!==count+1)console.log('Synthetic role diagnostics: '+JSON.stringify(await page.evaluate(()=>({role:document.querySelector('#omf-learning-control select')?.value,status:document.querySelector('#omf-learning-control small')?.textContent,bindings:Object.keys(window).filter(k=>k.includes('__omfLearn')).map(k=>[k,typeof window[k]])}))));
    assert.equal(record?.events.length,count+1,'recorded '+role);
  };
  await operate('inquiry',async()=>{await Promise.all([page.waitForNavigation(),page.click('#inquiry')]);});
  await operate('account',()=>page.select('#account','PRIVATE-ACCOUNT-001'));
  for(const[role,value]of [['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await page.type('#'+role,value);await page.$eval('#'+role,el=>el.blur());});
  await operate('export',()=>page.click('#export'));
  await operate('balance',()=>page.click('#balance'));
  await operate('logout',async()=>{await Promise.all([page.waitForNavigation(),page.click('#logout')]);});
  await page.waitForSelector('#omf-learning-control button');await page.click('#omf-learning-control button');record=await recording;
  const template={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'};
  await inspectLearningStatement(await readFile(await download.file()),template,{from:'2026-10-01',to:'2026-10-02'});await download.close();
  const evidence=projectEvidence(record,{test:true});
  for(const secret of ['PRIVATE-ACCOUNT','PRIVATE-PASSWORD','Private supplier','session','100,000','#account','/details'])assert.ok(!JSON.stringify(evidence).includes(secret),'no outbound '+secret);
  // Deterministic fixture candidate, not an AI-generation acceptance claim. No selector is supplied to the replay.
  const evidenceHash=sha(evidence),candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};validateRecipe(candidate,evidence,evidenceHash,{test:true});
  await browser.close();browser=await launch();page=await browser.newPage();
  const receipt=await replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template,directory:path.join(root,'replay-download'),awaitLogin:login,test:true});
  assert.equal(receipt.rows,1);assert.equal(receipt.loggedOut,true);assert.equal(receipt.accountMatched,true);assert.equal(receipt.balanceObserved,true);
  assert.deepEqual(received,[{from:'2026-10-01',to:'2026-10-02'},{from:'2026-11-01',to:'2026-11-02'}]);
  console.log('Synthetic browser evidence retained at '+root);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});

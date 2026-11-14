import {selectLearningRole,waitForLearningCapture} from './finance-bank-learning-capture-ack.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
import {recordBankLearning,projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {learningDownload,inspectLearningStatement} from '../collector/bank-learning-runner.mjs';
import {LEARNING_RUNTIME,stable,validateRecipe} from '../shared/finance-bank-learning.mjs';
import {STANDARD_CONTRACT,standardPeriodValues,standardPeriodReadback} from '../collector/banks/rakuten.mjs';
const {replayBankLearning}=await import(process.env.OMF_LEARNING_DATE_RUNNER?pathToFileURL(process.env.OMF_LEARNING_DATE_RUNNER).href:'../collector/bank-learning-runner.mjs');
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const sha=v=>createHash('sha256').update(stable(v)).digest('hex');
const demo={from:'2026-10-01',to:'2026-10-02'},period={from:'2027-01-03',to:'2027-02-04'},parts=['year','month','day'];
const template={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'};
async function exercise({selects=false,reset=false,ambiguous=false}={}){
 const root=await fs.mkdtemp('E:/omf-private/learning-dateparts-browser-'),requests=[],ids=STANDARD_CONTRACT.period.inputs;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/csv'){
   const values=ids.map((_,i)=>url.searchParams.get('p'+i));requests.push(values);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fictional.csv"'});res.end('date,description,amount\r\n'+values.slice(0,3).map((v,i)=>i?String(v).padStart(2,'0'):v).join('-')+',Fictional supplier,-100\r\n');return;
  }
  const values=standardPeriodValues(demo).map(([,v])=>v);
  const fields=ids.map((id,i)=>{
   if(selects&&i%3!==0){const max=i%3===1?12:31;return '<label>'+parts[i%3]+'<select id="'+id+'">'+Array.from({length:max},(_,j)=>'<option value="'+(j+1)+'"'+(j+1===values[i]?' selected':'')+'>'+(j+1)+'</option>').join('')+(ambiguous&&i%3===1?'<option value="01">01</option>':'')+'</select></label><br>';}
   return '<label>'+parts[i%3]+'<input id="'+id+'" type="text" value="'+String(values[i]).padStart(i%3?2:4,'0')+'"></label><br>';
  }).join('');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html><body><h1>Fictional six-field portal</h1><p id="account">DEMO-ACCOUNT-001</p>'+fields+'<button id="export">CSV</button><span id="balance">100,000</span><button id="logout" onclick="this.remove()">Logout</button><script>const ids='+JSON.stringify(ids)+';document.getElementById("export").onclick=()=>{location.href="/csv?"+new URLSearchParams(ids.map((id,i)=>["p"+i,document.getElementById(id).value]));};'+(url.searchParams.has('reset')?'document.getElementById(ids[1]).addEventListener("change",()=>{document.getElementById(ids[0]).value="2026";});':'')+'</script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser,download,record,recording,phase='record',outcome;
 const pids=[];
 const launch=async()=>{const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+phase)});pids.push(b.process().pid);const p=await b.newPage();await p.setRequestInterception(true);p.on('request',r=>{if(new URL(r.url()).origin===origin)void r.continue();else void r.abort();});return {b,p};};
 try{
  let {b,p}=await launch();browser=b;let page=p;await page.goto(origin);
  download=await learningDownload(browser,path.join(root,'demonstration-download'),{origins:[origin]});
  recording=recordBankLearning(browser,page,{entryOrigin:origin,test:true,timeout:45000,store:async r=>{record=structuredClone(r);}});void recording.catch(()=>{});
  const operate=async(role,fn)=>{await page.waitForSelector('#omf-learning-control select');assert.deepEqual(await selectLearningRole(page,role,recording),[role]);const n=record?.events.length||0;await fn();if(['from','to'].includes(role.split(':')[0]))await waitForLearningCapture(page,recording);for(let i=0;i<100&&(record?.events.length||0)===n;i++)await new Promise(r=>setTimeout(r,20));assert.equal(record.events.length,n+1,'recorded '+role);};
  await operate('account',()=>page.click('#account'));
  for(let i=0;i<ids.length;i++)await operate((i<3?'from':'to')+':'+parts[i%3],()=>page.evaluate(({id,value})=>{const el=document.getElementById(id);el.dispatchEvent(new Event('change',{bubbles:true}));},{id:ids[i],value:standardPeriodValues(demo)[i][1]}));
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));await operate('logout',()=>page.click('#logout'));await page.click('#omf-learning-control button');record=await recording;
  assert.equal((await inspectLearningStatement(await fs.readFile(await download.file()),template,demo)).rows,1);await download.close();download=null;
  const evidence=projectEvidence(record,{test:true});assert.deepEqual(evidence.events.filter(e=>['from','to'].includes(e.role)).map(e=>e.format),[...parts,...parts]);assert.ok(!JSON.stringify(evidence).includes('DEMO-ACCOUNT'));
  const evidenceHash=sha(evidence),candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};validateRecipe(candidate,evidence,evidenceHash,{test:true});
  await browser.close();browser=null;phase='fresh-replay';({b,p}=await launch());browser=b;page=p;
  const options={record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period,template,directory:path.join(root,'replay-download'),test:true,awaitLogin:p=>p.goto(origin+(reset?'/?reset=1':''))};
  if(reset||ambiguous){
   await assert.rejects(replayBankLearning(browser,page,options),e=>reset?e.code==='date-input-mismatch'&&e.learningRole==='from':/unsupported-date-control/.test(e.message));assert.equal(requests.length,1,'incorrect or ambiguous period never exported');outcome={expectedRejection:true,beforeExport:true};
  }else{
   const receipt=await replayBankLearning(browser,page,options);assert.equal(receipt.rows,1);assert.deepEqual(receipt.period,period);assert.ok(receipt.accountMatched&&receipt.balanceObserved&&receipt.loggedOut&&receipt.freshBrowser);assert.equal(requests.length,2);assert.equal(standardPeriodReadback(requests[1],standardPeriodValues(period)),true);assert.deepEqual(requests[1].map(Number),[2027,1,3,2027,2,4]);outcome={receipt,actualPeriodValues:requests[1]};
  }
  await fs.writeFile(path.join(root,'proof.json'),JSON.stringify({at:new Date().toISOString(),selects,reset,ambiguous,demonstrationPeriod:demo,replayPeriod:period,...outcome,protectedEvidence:evidence,browserPids:pids,realBankRequests:0,modelCalls:0},null,2)+'\n');
  console.log('Date-component browser proof: '+root);
 }finally{if(download)await download.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
test('actual recorder and fresh Chrome replay fill all six fields across month/year changes',()=>exercise());
test('component replay supports numeric month/day selects with unpadded option values',()=>exercise({selects:true}));
test('a later bank-form change resetting the year is detected before CSV export',()=>exercise({reset:true}));
test('ambiguous numeric select values do not silently pick a different bank option',()=>exercise({selects:true,ambiguous:true}));
test('recorder rejects unrecognized component metadata before protected evidence can be submitted',async()=>{
 const root=await fs.mkdtemp('E:/omf-private/learning-dateparts-metadata-'),server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<input id="date">');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser,record;
 try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'owned-profile')});const page=await browser.newPage();await page.goto(origin);
  const recording=recordBankLearning(browser,page,{entryOrigin:origin,test:true,timeout:15000,store:async r=>{record=structuredClone(r);}});void recording.catch(()=>{});
  await page.waitForSelector('#omf-learning-control select');await page.$eval('#omf-learning-control select',el=>{const o=document.createElement('option');o.value='from:era';o.textContent='Synthetic invalid metadata';el.append(o);});await selectLearningRole(page,'from:era',recording);
  await page.$eval('#date',el=>{el.value='2026';el.dispatchEvent(new Event('change',{bubbles:true}));});await assert.rejects(recording,/date-control-unavailable/);assert.equal(record?.events.length||0,0);
  await fs.writeFile(path.join(root,'proof.json'),JSON.stringify({at:new Date().toISOString(),unrecognizedFormatRejected:true,recordedEvents:0,protectedEvidenceSubmitted:false,realBankRequests:0,modelCalls:0},null,2)+'\n');console.log('Recorder metadata proof: '+root);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

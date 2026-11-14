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
const {replayBankLearning}=await import(process.env.OMF_LEARNING_DATE_RUNNER?pathToFileURL(process.env.OMF_LEARNING_DATE_RUNNER).href:'../collector/bank-learning-runner.mjs');
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const sha=v=>createHash('sha256').update(stable(v)).digest('hex');
const demo={from:'2026-10-01',to:'2026-10-02'},period={from:'2027-01-03',to:'2027-02-04'},parts=['year','month','day'];
const template={headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'};
const formatWhole=(value,format)=>format==='compact'?value.replaceAll('-',''):format==='slash'?value.replaceAll('-','/'):value;
async function mixed({wholeRole,format,reset}){
 const root=await fs.mkdtemp('E:/omf-private/learning-mixed-dates-'),splitRole=wholeRole==='from'?'to':'from',requests=[];
 const changed=wholeRole==='from'?'2027-01-10':'2027-01-28';
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/csv'){
   const exported={from:url.searchParams.get('from'),to:url.searchParams.get('to')};requests.push(exported);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fictional-mixed.csv"'});res.end('date,description,amount\r\n'+exported.from+',Fictional mixed supplier,-100\r\n');return;
  }
  const fields='<label>Whole date<input id="'+wholeRole+'"></label>'+parts.map(part=>'<label>'+part+'<input id="'+splitRole+'-'+part+'"></label>').join('');
  const resetScript=url.searchParams.has('reset')?'document.getElementById(split+"-day").addEventListener("change",()=>{document.getElementById(whole).value='+JSON.stringify(formatWhole(changed,format))+';});':'';
  const script='const whole='+JSON.stringify(wholeRole)+',split='+JSON.stringify(splitRole)+',format='+JSON.stringify(format)+';const read=role=>{if(role===split)return ["year","month","day"].map(part=>document.getElementById(role+"-"+part).value).join("-");const v=document.getElementById(role).value;return format==="compact"?v.slice(0,4)+"-"+v.slice(4,6)+"-"+v.slice(6):format==="slash"?v.replaceAll("/","-"):v;};document.getElementById("export").onclick=()=>{location.href="/csv?"+new URLSearchParams({from:read("from"),to:read("to")});};'+resetScript;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html><body><p id="account">DEMO-MIXED-ACCOUNT</p>'+fields+'<button id="export">CSV</button><span id="balance">100,000</span><button id="logout" onclick="this.remove()">Logout</button><script>'+script+'</script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser,download,record,phase='record',outcome;
 const launch=async()=>{const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+phase)});const page=await b.newPage();await page.setRequestInterception(true);page.on('request',r=>{if(new URL(r.url()).origin===origin)void r.continue();else void r.abort();});return {b,page};};
 try{
  let page;({b:browser,page}=await launch());await page.goto(origin);
  download=await learningDownload(browser,path.join(root,'demonstration-download'),{origins:[origin]});
  const recording=recordBankLearning(browser,page,{entryOrigin:origin,test:true,timeout:45000,store:async r=>{record=structuredClone(r);}});void recording.catch(()=>{});
  const operate=async(role,fn)=>{await page.waitForSelector('#omf-learning-control select');assert.deepEqual(await selectLearningRole(page,role,recording),[role]);const n=record?.events.length||0;await fn();if(['from','to'].includes(role.split(':')[0]))await waitForLearningCapture(page,recording);for(let i=0;i<100&&(record?.events.length||0)===n;i++)await new Promise(r=>setTimeout(r,20));assert.equal(record.events.length,n+1,'recorded '+role);};
  await operate('account',()=>page.click('#account'));
  // Record the whole endpoint first, so a later component change can reset it in either orientation.
  await operate(wholeRole,async()=>{await page.type('#'+wholeRole,formatWhole(demo[wholeRole],format));await page.$eval('#'+wholeRole,e=>e.blur());});
  for(const[i,part]of parts.entries())await operate(splitRole+':'+part,async()=>{await page.type('#'+splitRole+'-'+part,demo[splitRole].split('-')[i]);await page.$eval('#'+splitRole+'-'+part,e=>e.blur());});
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));await operate('logout',()=>page.click('#logout'));await page.click('#omf-learning-control button');record=await recording;
  assert.equal((await inspectLearningStatement(await fs.readFile(await download.file()),template,demo)).rows,1);await download.close();download=null;
  const evidence=projectEvidence(record,{test:true}),evidenceHash=sha(evidence),candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};validateRecipe(candidate,evidence,evidenceHash,{test:true});
  assert.equal(evidence.events.find(e=>e.role===wholeRole).format,format);assert.deepEqual(evidence.events.filter(e=>e.role===splitRole).map(e=>e.format),parts);assert.ok(!JSON.stringify(evidence).includes('DEMO-MIXED-ACCOUNT'));
  await browser.close();browser=null;phase='fresh-replay';({b:browser,page}=await launch());
  let receipt,error;try{receipt=await replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period,template,directory:path.join(root,'replay-download'),awaitLogin:p=>p.goto(origin+(reset?'/?reset=1':'')),test:true});}catch(e){error={code:e.code,message:e.message,role:e.learningRole};}
  outcome={at:new Date().toISOString(),wholeRole,splitRole,format,reset,requestedPeriod:period,resetValue:reset?changed:null,exportedPeriods:requests,receipt,error,realBankRequests:0,productModelCalls:0};
  // Keep an unsafe receipt visible in fail-first/mutation evidence before asserting rejection.
  await fs.writeFile(path.join(root,'proof.json'),JSON.stringify(outcome,null,2)+'\n');console.log('Mixed-date Chrome proof: '+root);
  if(reset){assert.equal(error?.code,'date-input-mismatch');assert.equal(error.role,wholeRole);assert.equal(receipt,undefined);assert.equal(requests.length,1,'a narrowed mixed period is rejected before any replay export');}
  else{assert.equal(error,undefined);assert.deepEqual(requests,[demo,period]);assert.deepEqual(receipt.period,period);assert.equal(receipt.rows,1);assert.ok(receipt.accountMatched&&receipt.balanceObserved&&receipt.loggedOut&&receipt.freshBrowser);}
 }finally{if(download)await download.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
for(const wholeRole of ['from','to'])for(const format of ['iso','compact','slash']){
 test('mixed whole-'+wholeRole+' '+format+' keeps the requested period',()=>mixed({wholeRole,format,reset:false}));
 test('mixed whole-'+wholeRole+' '+format+' blocks a later reset before export',()=>mixed({wholeRole,format,reset:true}));
}

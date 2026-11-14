import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
import {projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {replayBankLearning} from '../collector/bank-learning-runner.mjs';
import {LEARNING_RUNTIME,stable} from '../shared/finance-bank-learning.mjs';

const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
const hash=value=>createHash('sha256').update(stable(value)).digest('hex');
// Test-only SDK query handler: destroy a real in-flight Chrome query context.
// No product hook, fabricated exception or copied locator implementation is used.
puppeteer.Puppeteer.customQueryHandlers.register('omfNavigation',{
  queryAll:async(root,selector)=>{
    const doc=root.nodeType===9?root:root.ownerDocument;
    if(doc.documentElement.dataset.queryMode==='permanent'){
      await fetch('/query-error-count');
      throw new Error('fixture-unexpected-query-error');
    }
    if(location.pathname==='/query-old'){
      location.href='/query-ready';
      await new Promise(()=>{});
    }
    return root.querySelectorAll(selector);
  }
});

async function scenario({permanent=false,cancel=false}={}){
  const directory=await fs.mkdtemp('E:/omf-private/navigation-context-');
  const requests=[],abort=new AbortController();
  let browser,receipt,error,logins=0,deliveries=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
    if(url.pathname==='/query-ready'&&cancel)abort.abort(new Error('fixture-navigation-aborted'));
    if(url.pathname==='/query-error-count'){res.end('counted');return;}
    if(url.pathname==='/csv'){
      res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="fictional.csv"'});
      res.end('date,description,amount\r\n'+url.searchParams.get('from')+',Fictional supplier,-1234\r\n');return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(url.pathname==='/start'){res.end('<!doctype html><button id="inquiry" type="button" onclick="location.href=\'/query-old\'">Inquiry</button>');return;}
    res.end('<!doctype html><html data-query-mode="'+(permanent?'permanent':'navigation')+'"><body><p id="account">FICTIONAL-ACCOUNT</p><input id="from"><input id="to"><button id="export" type="button" onclick="location.href=\'/csv?from=\'+document.getElementById(\'from\').value+\'&to=\'+document.getElementById(\'to\').value">CSV</button><span id="balance">100,000</span><button id="logout" type="button" onclick="this.remove()">Logout</button></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const signature=label=>JSON.stringify(['button','button','',label,'','']);
  const controls=[
    ['inquiry','button','#inquiry',{signature:signature('Inquiry')}],
    ['account','text','omfNavigation/#account',{value:'FICTIONAL-ACCOUNT'}],
    ['from','input','#from',{}],['to','input','#to',{}],
    ['export','button','#export',{signature:signature('CSV')}],
    ['balance','text','#balance',{}],['logout','button','#logout',{signature:signature('Logout')}]
  ];
  // A fictional legacy private record isolates the existing locator continuation.
  // The shared evidence and recipe validators and the whole real replay still run.
  const record={origins:[origin],complete:true,truncated:false,events:controls.map(([role,tag,selector,local],i)=>({id:'e'+i,document:i?'d1':'d0',frame:'f0',popup:'p0',origin,role,tag,...(['from','to'].includes(role)?{format:'iso'}:{}),private:{selector,framePath:[],...local}}))};
  const evidence=projectEvidence(record,{test:true}),evidenceHash=hash(evidence);
  const candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(event=>({eventId:event.id,op:event.role}))};
  const period={from:'2026-11-01',to:'2026-11-02'};
  try{
    browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,protocolTimeout:15000,userDataDir:path.join(directory,'profile')});
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',request=>new URL(request.url()).origin===origin?void request.continue():void request.abort());
    try{
      receipt=await replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash,candidateHash:hash(candidate),period,template:{headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},directory:path.join(directory,'downloads'),signal:abort.signal,test:true,awaitLogin:async page=>{logins++;await page.goto(origin+'/start');},onStatement:()=>{deliveries++;}});
    }catch(failure){error={message:failure.message,role:failure.learningRole};}
    assert.equal(logins,1,'navigation polling never repeats login');
    assert.equal(requests.filter(url=>url==='/query-old').length,1,'navigation polling never clicks inquiry again');
    if(permanent){
      assert.match(error?.message||'',/fixture-unexpected-query-error/);
      assert.equal(error.role,'account');
      assert.equal(requests.filter(url=>url==='/query-error-count').length,1,'unrelated query errors are not retried');
      assert.equal(deliveries,0);
    }else if(cancel){
      assert.equal(error?.message,'fixture-navigation-aborted');
      assert.equal(deliveries,0);
      assert.ok(!requests.includes('/csv'));
    }else{
      assert.equal(error,undefined);
      assert.equal(requests.filter(url=>url==='/query-ready').length,1,'the real in-flight context was destroyed by navigation');
      assert.equal(requests.filter(url=>url==='/csv').length,1);
      assert.equal(deliveries,1);
      assert.deepEqual(receipt.period,period);
      assert.equal(receipt.accountMatched,true);
      assert.equal(receipt.loggedOut,true);
    }
  }finally{
    await fs.writeFile(path.join(directory,'proof.json'),JSON.stringify({at:new Date().toISOString(),permanent,cancel,requests,logins,deliveries,receipt,error,productModelCalls:0,bankRequests:0},null,2)+'\n');
    console.log('Navigation context proof: '+directory);
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

test('navigation during an account query resumes the existing lookup without replaying bank actions',()=>scenario());
test('unrelated account-query errors still fail immediately',()=>scenario({permanent:true}));
test('cancellation during a navigation lookup stops before statement export',()=>scenario({cancel:true}));

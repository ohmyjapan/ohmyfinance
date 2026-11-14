import {selectLearningRole,waitForLearningCapture} from './finance-bank-learning-capture-ack.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../collector/puppeteer-frame-init.mjs';
const {recordBankLearning,projectEvidence}=await import(process.env.OMF_LOGIN_TEST_RECORDER?pathToFileURL(process.env.OMF_LOGIN_TEST_RECORDER).href:'../collector/bank-learning-recorder.mjs');
const {replayBankLearning,learningDownload}=await import(process.env.OMF_LOGIN_TEST_RUNNER?pathToFileURL(process.env.OMF_LOGIN_TEST_RUNNER).href:'../collector/bank-learning-runner.mjs');
import {learningStore} from '../collector/bank-learning.mjs';
import {stable} from '../shared/finance-bank-learning.mjs';
import {loginControl} from '../collector/bank-learning-login.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core'),pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>createHash('sha256').update(stable(v)).digest('hex');
const cases=['loading-login-frame','loading-statement-frame','manual-before-id-visible','id-manual-before-password-visible','manual-before-id-dynamic','id-manual-before-password-dynamic','manual-before-id-disabled','id-manual-before-password-disabled','manual-before-id-cross-visible','manual-before-id-cross-dynamic','manual-before-id-cross-disabled','manual-before-id-type-change','manual-before-id-cross-type-change','unsupported-image-message','unsupported-image-manual-route'];
for(const kind of cases)test('manual and frame boundary '+kind,async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-manual-owner-')),store=learningStore(root,'a'.repeat(24)),abort=new AbortController(),legacy=kind==='loading-statement-frame',image=kind.startsWith('unsupported-image'),early=kind.includes('manual-before'),cross=kind.includes('-cross-'),dynamic=kind.endsWith('-dynamic'),disabled=kind.endsWith('-disabled'),typeChange=kind.endsWith('-type-change'),deferred=dynamic||disabled||typeChange,idFirst=kind.startsWith('id-manual');
 let posts=0,authenticated=0,record,browser,download,pending,fresh=false,credentialHandoffs=0,human,frames=[],phase='start';
 const portal=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.method==='POST'){
   posts++;let body='';for await(const b of req)body+=b;const p=new URLSearchParams(body);
   if(p.get('identifier')!=='FICTIONAL-MANUAL-ID'||p.get('password')!=='FICTIONAL-MANUAL-PASSWORD'){res.writeHead(403);res.end('Refused');return;}
   authenticated++;res.setHeader('Set-Cookie','session=fictional; HttpOnly');res.writeHead(303,{Location:'/home'});res.end();return;
  }
  if(u.pathname==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0');res.end('Signed out');return;}
  if(!req.headers.cookie?.includes('session=fictional')){
   if(cross&&u.pathname==='/'){res.end('<button id=manual type=button onclick="document.querySelector(&quot;iframe&quot;).contentDocument.querySelectorAll(&quot;[data-unlock]&quot;).forEach(e=>{e.hidden=false;e.disabled=false});'+(typeChange?'document.querySelector(&quot;iframe&quot;).contentDocument.querySelector(&quot;#identifier&quot;).type=&quot;text&quot;;':'')+'">Complete parent notice</button><iframe src="/login" style="width:100%;height:650px"></iframe>');return;}
   if(kind==='loading-login-frame'&&u.pathname==='/'){res.end('<button id="entry" type="button" onclick="const f=document.createElement(&quot;iframe&quot;);f.src=&quot;/login&quot;;f.style=&quot;width:100%;height:650px&quot;;document.body.append(f);this.disabled=true">Open sign in</button>');return;}
   if(kind==='loading-login-frame'&&fresh)await pause(1200);
   res.end('<button id="manual" type="button" onclick="document.querySelectorAll(\'[data-unlock]\').forEach(e=>{e.hidden=false;e.disabled=false});'+(typeChange?'document.querySelector(&quot;#identifier&quot;).type=&quot;text&quot;;':'')+'">Complete local notice</button><form method="POST" action="/signin"><input id="identifier" name="identifier"'+(typeChange?' type="tel"':'')+(!idFirst&&(dynamic||disabled)?' data-unlock'+(dynamic?' hidden':' disabled'):'')+'><input id="password" name="password" type="password"'+(dynamic||disabled?' data-unlock'+(dynamic?' hidden':' disabled'):'')+'>'+(image?'<input id="submit" type="image" alt="Sign in" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:90px;height:26px">':'<button id="submit">Sign in</button>')+'</form>');return;
  }
  if(u.pathname==='/home'){res.end('<strong id="success">Authenticated</strong><button id="inquiry" onclick="'+(legacy?'const f=document.createElement(&quot;iframe&quot;);f.src=&quot;/details&quot;;f.style=&quot;width:100%;height:650px&quot;;document.body.append(f);this.disabled=true':'location.href=\'/details\'')+'">Inquiry</button>');return;}
  if(u.pathname==='/csv'){res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="synthetic.csv"');res.end('date,description,amount\r\n'+u.searchParams.get('from')+',Fictional,-1234\r\n');return;}
  if(legacy&&fresh)await pause(1200);
  res.end('<select id="account"><option value="">Choose</option><option value="PRIVATE-ACCOUNT">Ordinary</option></select><input id="from"><input id="to"><button id="export" onclick="location.href=\'/csv?from=\'+document.querySelector(\'#from\').value+\'&to=\'+document.querySelector(\'#to\').value">CSV</button><span id="balance">100,000</span><button id="logout" onclick="location.href=\'/logout\'">Logout</button>');
 });await new Promise(r=>portal.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+portal.address().port,launch=()=>puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(root,'profile-'+randomBytes(4).toString('hex'))});
 const wait=async fn=>{for(let n=0;n<200;n++){const result=await fn().catch(()=>null);if(result)return result;await pause(25);}throw Error('fixture-current-control-unavailable');};
 try{
  browser=await launch();let page=await browser.newPage(),surface=page;await page.goto(origin);
  const bankLogin=async()=>{await surface.type('#identifier','FICTIONAL-MANUAL-ID');await surface.type('#password','FICTIONAL-MANUAL-PASSWORD');await Promise.all([surface.waitForNavigation(),surface.click('#submit')]);};
  if(legacy)await bankLogin();
  download=await learningDownload(browser,path.join(root,'demo'),{origins:[origin],demonstration:true});
  pending=recordBankLearning(browser,page,{entryOrigin:origin,teachLogin:!legacy,test:true,signal:abort.signal,timeout:45000,onExport:()=>{const n=download.beginExport();return()=>download.acceptExport(n);},store:async r=>{await store.update(v=>({...v,record:r}));record=structuredClone(r);}});void pending.catch(()=>{});
  const choose=async role=>{await wait(()=>surface.$('#omf-learning-control select'));const toggle=await surface.$('#omf-learning-control [data-learning-toggle]');if(toggle&&await toggle.evaluate(e=>e.getAttribute('aria-expanded')==='false'))await toggle.click();await selectLearningRole(surface,role,pending);};
  const operate=async(role,fn)=>{phase=role;const n=record?.events.length||0;await choose(role);await fn();if(['from','to'].includes(role.split(':')[0]))await waitForLearningCapture(surface,pending);await wait(async()=>record?.events.length===n+1);if(role.startsWith('login-'))await wait(async()=>await surface.$eval('#omf-learning-control select',e=>e.value===''));};
  const child=async selector=>{surface=await wait(async()=>{for(const f of page.frames().filter(f=>f.parentFrame()))if(await f.$(selector).catch(()=>null))return f;});};
  if(kind==='loading-login-frame'){await operate('login-navigation',()=>page.click('#entry'));await child('#identifier');}
  if(typeChange){if(cross){await child('#identifier');await wait(()=>surface.$('#omf-learning-control select'));}const oldReady=await surface.$eval('#identifier',loginControl,{role:'login-identifier',tag:'input',type:'tel',origins:[origin]}),futureReady=await surface.$eval('#identifier',loginControl,{role:'login-identifier',tag:'input',type:'text',origins:[origin]});assert.equal(oldReady,true);assert.equal(futureReady,false);console.log('TYPE-BOUND-READINESS '+JSON.stringify({kind,oldType:'tel',futureType:'text',oldReady,futureReady}));if(cross)surface=page;}
  if(early){
   if(idFirst){await operate('login-identifier',()=>surface.click('#identifier'));await surface.type('#identifier','FICTIONAL-MANUAL-ID');}
   await operate('login-manual:other',()=>surface.click('#manual'));if(cross)await child('#identifier');
   const next=idFirst?'login-password':'login-identifier',selector=idFirst?'#password':'#identifier',n=record.events.length;await choose(next);await surface.click(selector);for(let attempt=0;attempt<150&&record.events.length===n;attempt++)await pause(20);const accepted=record.events.length===n+1;
   console.log('MANUAL-SUCCESSOR '+JSON.stringify({kind,accepted,initiallyVisible:!dynamic,sameDocument:!cross,posts,roles:record.events.map(e=>e.role)}));
   if(!deferred){assert.equal(accepted,false,'already-visible credential successor is refused before accepting a bad handoff');await surface.waitForFunction(()=>document.querySelector('#omf-learning-control small').textContent.includes('本人操作より前'));assert.equal(record.complete,false);assert.equal(posts,0);abort.abort();await pending.catch(()=>{});return;}
   assert.equal(accepted,true);await wait(async()=>await surface.$eval('#omf-learning-control select',e=>e.value===''));await surface.type(selector,idFirst?'FICTIONAL-MANUAL-PASSWORD':'FICTIONAL-MANUAL-ID');
  }
  if(!legacy){
   if(!early){await operate('login-identifier',()=>surface.click('#identifier'));await surface.type('#identifier','FICTIONAL-MANUAL-ID');}
   if(!early||!idFirst){await operate('login-password',()=>surface.click('#password'));await surface.type('#password','FICTIONAL-MANUAL-PASSWORD');}
   if(image){
    if(kind==='unsupported-image-message'){
     await choose('login-submit');await Promise.all([surface.waitForNavigation(),surface.click('#submit')]);await wait(()=>surface.$('#omf-learning-control small'));const message=await surface.$eval('#omf-learning-control small',e=>({manual:e.textContent.includes('本人操作として記録'),truthful:e.textContent.includes('送信方法')&&e.textContent.includes('手動CSV'),visible:e.getClientRects().length>0}));console.log('UNSUPPORTED-SUBMIT '+JSON.stringify({kind,...message,posts,authenticated}));assert.equal(message.manual,false);assert.equal(message.truthful,true);assert.equal(posts,1);assert.equal(authenticated,1);abort.abort();await pending.catch(()=>{});return;
    }
    await operate('login-manual:other',()=>Promise.all([surface.waitForNavigation(),surface.click('#submit')]));await choose('login-success');await surface.click('#success');await wait(async()=>record.loginSequenceUnsupported===true);assert.throws(()=>projectEvidence(record,{test:true}),{message:'unsupported-login-sequence'});assert.equal(posts,1);console.log('UNSUPPORTED-MANUAL-SUBMIT '+JSON.stringify({posts,authenticated,terminal:true,modelJobs:0}));abort.abort();await pending.catch(()=>{});return;
   }
   await operate('login-submit',()=>Promise.all([surface.waitForNavigation(),surface.click('#submit')]));await operate('login-success',()=>surface.click('#success'));
  }
  if(legacy){await operate('inquiry',()=>surface.click('#inquiry'));await child('#account');}else await operate('inquiry',()=>Promise.all([surface.waitForNavigation(),surface.click('#inquiry')]));
  await operate('account',()=>surface.select('#account','PRIVATE-ACCOUNT'));for(const [role,value]of [['from','2026-10-01'],['to','2026-10-02']])await operate(role,async()=>{await surface.type('#'+role,value);await surface.$eval('#'+role,e=>e.blur());});await operate('export',()=>surface.click('#export'));await operate('balance',()=>surface.click('#balance'));await operate('logout',()=>Promise.all([surface.waitForNavigation(),surface.click('#logout')]));
  await page.click('#omf-learning-control button');record=await pending;await download.file();await download.close();download=null;if(typeChange)assert.equal(record.events.find(e=>e.role==='login-identifier').private.type,'text');const evidence=projectEvidence(record,{test:true}),evidenceHash=sha(evidence),candidate={schema:evidence.schema,runtime:evidence.runtime,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};for(const secret of ['FICTIONAL-MANUAL-ID','FICTIONAL-MANUAL-PASSWORD'])assert.equal(stable(record).includes(secret)||stable(evidence).includes(secret),false);
  await browser.close();fresh=true;browser=await launch();page=await browser.newPage();surface=page;
  page.on('frameattached',frame=>{const value=frame.url();let parseable=true;try{new URL(value);}catch{parseable=false;}frames.push({attached:true,empty:value==='',parseable});});
  const login=async p=>{surface=p;await p.goto(origin);await bankLogin();};if(!legacy)await page.goto(origin);
  const before=posts,operation=replayBankLearning(browser,page,{record:(await store.read()).record,evidence,candidate,evidenceHash,candidateHash:sha(candidate),period:{from:'2026-11-01',to:'2026-11-02'},template:{headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},directory:path.join(root,'replay'),test:true,loginTimeout:1500,manualTimeout:3000,awaitLogin:login,credentials:async()=>{credentialHandoffs++;return{identifier:'FICTIONAL-MANUAL-ID',password:'FICTIONAL-MANUAL-PASSWORD'};},status:()=>{human=page.click('#manual');void human.catch(()=>{});}});
  let receipt;try{receipt=await operation;}catch(error){console.log('FRAME-READINESS-FAILURE '+JSON.stringify({kind,frames,code:error.code||null,error:error.name,role:error.learningRole||null,freshPosts:posts-before}));throw error;}await human;
  assert.equal(receipt.rows,1);assert.equal(receipt.loggedOut,true);assert.equal(posts-before,1);if(kind.startsWith('loading-'))assert.ok(frames.some(f=>f.empty&&!f.parseable),'actual pinned SDK exposes an attached frame before first commit');if(!legacy)assert.equal(credentialHandoffs,1);console.log('MANUAL-OWNER-REPLAY '+JSON.stringify({kind,schema:evidence.schema,frames,credentialHandoffs,freshPosts:posts-before,rows:receipt.rows}));
 }catch(error){const ui=browser?await (await browser.pages()).at(-1)?.evaluate(()=>({chosen:document.querySelector('#omf-learning-control select')?.value||null,feedback:!!document.querySelector('#omf-learning-control small'),accountChosen:document.querySelector('#account')?.value==='PRIVATE-ACCOUNT',controls:document.querySelectorAll('iframe').length})).catch(()=>null):null;console.log('FIXTURE-PHASE '+JSON.stringify({kind,phase,error:error.name,code:error.code||null,roles:record?.events.map(e=>e.role)||[],frames:frames.length,ui}));throw error;}finally{abort.abort();if(pending)await pending.catch(()=>{});if(download)await download.close();if(browser)await browser.close();await new Promise(r=>{portal.closeAllConnections();portal.close(r);});}
});

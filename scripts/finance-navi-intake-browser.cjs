// Called only by the owned-app integration. Real installed Chrome, isolated profile and synthetic user.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
module.exports=async({root,origin,ok,token,ask,action,done,heartbeat,pause,pass})=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-navi-intake-browser-'));
 const {browserFor,closeOwnedBrowsers}=await import(pathToFileURL(path.join(root,'collector/browser.mjs')).href);
 let browser,page;const errors=[],held=[];let hold=false;
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<220;i++){if(await page.evaluate(fn,...args))return;await pause(100);}throw Error('navi-intake:chrome-'+label);};
 const create=values=>ok('/api/finance-intake/records',{method:'POST',token,body:{values}});
 const patch=async(recordId,values,job,slot=1)=>{const current=await ok('/api/finance-intake/records/'+recordId,{token});const r=await action(job,'patch_intake_record',{recordId,revision:current.revision,values},slot);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.receipt.state,'done');return r.data;};
 try{
  browser=await browserFor(path.join(directory,'profile'),{headless:true});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text());});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','navi-intake-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  const record=await create({orderId:'NAVI-CHROME-01',description:'Browser original',notes:'Original note',amount:'900'});
  await page.goto(origin+'/intake/'+record.id,{waitUntil:'networkidle2'});await wait(()=>document.querySelector('#intake-description')?.value==='Browser original',[],'record');
  await page.evaluate(()=>document.querySelector('[data-assistant-toggle]').click());await wait(()=>!!document.querySelector('#assistant-message'),[],'assistant');
  await heartbeat();let job=await ask({page:'intake',recordId:record.id},'この受付の内容を保存してください。');
  await patch(record.id,{description:'Navi clean refresh',notes:'Clean note'},job);assert.equal((await done(job,'테스트 응답: 요청한 내용을 저장했어요.')).status,200);
  await wait(()=>document.querySelector('#intake-description')?.value==='Navi clean refresh',[],'clean-refresh');assert.equal(await page.$eval('#intake-notes',e=>e.value),'Clean note','navi-intake:chrome-clean-state');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'navi-intake:chrome-mobile-overflow');
  // The mobile rail covers this input while open: minimize it, make a real native edit, then reopen it for refresh checks.
  await page.click('[data-assistant-close]');await wait(()=>document.querySelector('#omf-assistant')?.getClientRects().length===0,[],'minimized-before-form-edit');
  await page.click('#intake-description',{clickCount:3});await page.keyboard.type('Unsaved owner edit');
  assert.equal(await page.$eval('#intake-description',e=>e.value),'Unsaved owner edit','navi-intake:chrome-owner-edit-reached-input');
  await page.click('[data-assistant-toggle]');await wait(()=>!!document.querySelector('#assistant-message')?.getClientRects().length,[],'reopened-after-form-edit');
  await heartbeat();job=await ask({page:'intake',recordId:record.id},'メモだけを更新してください。');await patch(record.id,{notes:'Newer saved note'},job);assert.equal((await done(job,'테스트 응답: 메모를 저장했어요.')).status,200);
  await wait(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('編集中の内容は保持')),[],'dirty-warning');
  assert.equal(await page.$eval('#intake-description',e=>e.value),'Unsaved owner edit','navi-intake:chrome-dirty-preserved');assert.equal(await page.$eval('#intake-notes',e=>e.value),'Clean note','navi-intake:chrome-dirty-baseline-kept');
  const response=page.waitForResponse(r=>r.url()===origin+'/api/finance-intake/records/'+record.id&&r.request().method()==='PATCH');await page.evaluate(()=>document.querySelector('[data-save]').click());assert.equal((await response).status(),409,'navi-intake:chrome-original-revision-kept');
  assert.equal((await ok('/api/finance-intake/records/'+record.id,{token})).values.notes,'Newer saved note');await wait(()=>!!document.querySelector('[data-reload]'),[],'reload');await page.evaluate(()=>document.querySelector('[data-reload]').click());await wait(()=>document.querySelector('#intake-notes')?.value==='Newer saved note',[],'explicit-reload');
  // Two different records completed before the next poll must both be represented in the refresh notification.
  const other=await create({description:'Other browser record'});
  await page.setRequestInterception(true);page.on('request',request=>{if(hold&&request.method()==='GET'&&request.url()===origin+'/api/finance-chat/workspace')held.push(request);else request.continue().catch(()=>{});});hold=true;
  // Wait for the next periodic read to be held before saving either record. Polling prevents generic network-idle waits.
  for(let i=0;i<70&&!held.length;i++)await pause(100);assert.ok(held.length,'navi-intake:chrome-held-next-poll');
  await heartbeat();job=await ask({page:'intake',recordId:record.id},'この受付ともう一つの受付を更新してください。');await patch(record.id,{description:'First of two saved records'},job,1);await patch(other.id,{notes:'Second receipt in the same poll'},job,2);assert.equal((await done(job,'테스트 응답: 두 접수의 수정 내용을 저장했어요.')).status,200);hold=false;for(const request of held.splice(0))await request.continue();
  await wait(()=>document.querySelector('#intake-description')?.value==='First of two saved records',[],'multi-receipt-refresh');
  const screenshotDir=process.env.OMF_NAVI_INTAKE_SCREENSHOTS;
  if(screenshotDir){await fs.mkdir(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'navi-intake-mobile.png'),fullPage:false});}
  await page.setViewport({width:1365,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'navi-intake:chrome-desktop-overflow');assert.deepEqual(errors,[],'navi-intake:chrome-console');
  pass('real Chrome: clean refresh, dirty form/original revision preserved, explicit reload and both receipts in one poll;390px/desktop without overflow or console errors');
 }catch(error){if(page&&process.env.OMF_NAVI_INTAKE_SCREENSHOTS){await fs.mkdir(process.env.OMF_NAVI_INTAKE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.OMF_NAVI_INTAKE_SCREENSHOTS,'failure.png'),fullPage:false}).catch(()=>{});}throw error;}
 finally{
  hold=false;for(const request of held.splice(0))await request.continue().catch(()=>{});if(page)await page.close().catch(()=>{});await closeOwnedBrowsers();
  const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());if(!resolved.startsWith(temp+path.sep))throw Error('Unsafe owned Chrome cleanup');await fs.rm(resolved,{recursive:true,force:true});
 }
};

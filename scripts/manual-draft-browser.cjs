const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({db,call,token,origin,organizationId,pass})=>{
 const puppeteer=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});
 const pages=[],errors=[],writes=[],ja=require('../i18n/locales/ja.json');let attempts=0,interceptionFailure,responseMode='drop',releaseHeld;
 let holdNextList=false,releaseList;
 const modal='body > .fixed.z-50',form=modal+' form';
 const action=(page,selector,label)=>page.$$eval(selector+' button',(buttons,text)=>{const button=buttons.find(b=>b.textContent.trim()===text);if(!button)throw Error('Button missing: '+text);button.click()},label);
 const stored=(page,key)=>page.evaluate(async key=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('omf-manual-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  return new Promise((resolve,reject)=>{const tx=database.transaction('drafts'),r=tx.objectStore('drafts').getAll();r.onsuccess=()=>{database.close();resolve(r.result.find(row=>row.key===key)||null)};r.onerror=()=>reject(r.error)});
 },key);
 const ready=page=>page.waitForFunction((selector,label)=>[...document.querySelectorAll(selector+' button')].some(b=>b.textContent.trim()===label&&!b.disabled),{polling:100},modal,ja.draftRecovery.retry);
 const saved=page=>page.waitForFunction(label=>document.querySelector('[data-manual-recovery]')?.textContent.includes(label),{},ja.draftRecovery.saved);
 const open=async page=>{await action(page,'header',ja.transactionForm.createTitle);await page.waitForSelector(form);await page.waitForFunction(()=>new URL(location.href).searchParams.has('draft'));return new URL(page.url()).searchParams.get('draft')};
 const fill=async page=>{const input=await page.$(form+' input[placeholder="10,000"]');await input.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await input.type('67000')};
 const submit=page=>action(page,modal,ja.common.save);
 const until=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timed out waiting for draft state')};
 const abortPuts=page=>page.evaluate(()=>{window.originalDraftPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=window.originalDraftPut.apply(this,args);if(this.transaction.db.name==='omf-manual-drafts')r.addEventListener('success',()=>this.transaction.abort(),{once:true});return r}});
 const restorePuts=page=>page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalDraftPut;delete window.originalDraftPut});
 async function intercept(page){
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',request=>{void (async()=>{
   if(request.method()==='GET'&&request.url().endsWith('/api/transactions')&&holdNextList){
    holdNextList=false;const response=await fetch(request.url(),{headers:{Authorization:request.headers().authorization}});assert.equal(response.status,200);const body=await response.text();
    releaseList=async()=>{releaseList=null;await request.respond({status:200,contentType:'application/json',body})};return;
   }
   if(request.method()!=='POST'||!request.url().endsWith('/api/transactions')){await request.continue();return}
   attempts++;const headers=request.headers(),key=headers['idempotency-key'];assert.match(key,/^[a-f0-9]{32}$/);
   const record=await stored(page,key);assert.equal(record.state,'pending');assert.deepEqual(record.payload,JSON.parse(request.postData()));
   const mode=responseMode;if(mode==='hold')await new Promise(resolve=>{releaseHeld=resolve});
   if(mode==='reject400'||mode==='reject503'){await request.respond({status:mode==='reject400'?400:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic '+mode})});return}
   const response=await fetch(request.url(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:headers.authorization,'Idempotency-Key':key},body:request.postData()});
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));writes.push({key,result});if(mode==='drop')await request.abort('failed');else await request.respond({status:200,contentType:'application/json',body:JSON.stringify(result)});
  })().catch(async error=>{interceptionFailure=error;if(!request.isInterceptResolutionHandled())try{await request.abort('failed')}catch{}})});
 }
 try{
  const page=await browser.newPage();pages.push(page);await page.setViewport({width:390,height:844});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('theme','light')});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  const select=async selected=>assert.equal(await page.evaluate(async id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(id),String(selected)),true);
  await select(organizationId);await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await intercept(page);
  const holdInitialList=async()=>{holdNextList=true;releaseList=null;await page.goto(origin+'/transactions',{waitUntil:'domcontentloaded'});await until(()=>!!releaseList)};
  const assertCompleteList=async()=>{
   const rows=await db.collection('transactions').find({organizationId,deletedAt:null}).toArray();assert(rows.length>1&&rows.length<=10,'Synthetic rows must fit the first page');
   await page.waitForFunction(count=>document.querySelectorAll('tbody tr').length===count,{polling:100},rows.length);
   assert.deepEqual((await page.$$eval('tbody tr td:first-child .text-xs',nodes=>nodes.map(n=>n.textContent.trim()))).sort(),rows.map(r=>r.referenceNumber||String(r._id)).sort());
   const total=rows.reduce((sum,r)=>sum+r.amount,0),formatted=new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',currencyDisplay:'narrowSymbol'}).format(total);
   assert((await page.$eval('main',n=>n.textContent)).includes(formatted));
  };
  responseMode='pass';await holdInitialList();const loadSave=await open(page);await fill(page);const beforeLoadSave=attempts;await submit(page);await page.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);await releaseList();await assertCompleteList();assert.equal(attempts,beforeLoadSave+1);assert.equal(await page.$('[data-manual-recovery]'),null);assert.equal((await db.collection('transactions').findOne({'manualCreate.key':loadSave})).timeline.length,1);
  pass('real Chrome new save during initial loading restores the complete ledger and totals with one write');

  const loadRetry=await open(page);await fill(page);responseMode='reject503';await submit(page);await ready(page);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':loadRetry}),0);
  await holdInitialList();await page.evaluate(key=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.replace({query:{draft:key}}),loadRetry);await page.waitForSelector(form);await ready(page);responseMode='pass';const beforeLoadRetry=attempts;await action(page,modal,ja.draftRecovery.retry);await page.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);await releaseList();await assertCompleteList();assert.equal(attempts,beforeLoadRetry+1);assert.equal((await stored(page,loadRetry)).state,'saved');assert.equal((await db.collection('transactions').findOne({'manualCreate.key':loadRetry})).timeline.length,1);
  pass('real Chrome a same-key retry while the list loads restores all rows without duplicate creation');

  await holdInitialList();const loadRejected=await open(page);await fill(page);responseMode='reject400';const beforeLoadRejected=attempts;await submit(page);await page.waitForFunction(label=>document.body.textContent.includes(label),{polling:100},'Synthetic reject400');assert.equal((await stored(page,loadRejected)).state,'rejected');await releaseList();await assertCompleteList();assert.equal(attempts,beforeLoadRejected+1);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':loadRejected}),0);await action(page,modal,ja.common.cancel);await page.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);await action(page,'[data-manual-draft="'+loadRejected+'"]',ja.draftRecovery.discard);responseMode='drop';
  pass('real Chrome a rejected save leaves the original list readable and never sends another purchase');

  const key=await open(page);await fill(page);await submit(page);await ready(page);if(interceptionFailure)throw interceptionFailure;
  assert.equal(writes.filter(w=>w.key===key).length,1);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':key}),1);
  const row=await stored(page,key);assert.equal(row.state,'pending');assert.equal(row.payload.amount,67000);
  const toggles=await page.$$eval(modal+' button',(buttons,labels)=>buttons.filter(b=>labels.includes(b.textContent.trim())).map(b=>({disabled:b.disabled,text:b.textContent.trim()})),[ja.transactions.income,ja.transactions.expense]);assert.equal(toggles.length,2);assert(toggles.every(b=>b.disabled));await action(page,modal,ja.transactions.income);assert.deepEqual((await stored(page,key)).payload,row.payload);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT});
  const beforeReload=attempts;await page.reload({waitUntil:'networkidle2'});await saved(page);assert.equal((await stored(page,key)).state,'saved');assert.equal(await page.$(form),null);assert.equal(attempts,beforeReload);
  pass('real Chrome stores the original purchase before sending and recovers a lost response after reload without another POST');

  const shared=await open(page);await fill(page);
  const targetPromise=browser.waitForTarget(target=>target.opener()===page.target());await page.evaluate(()=>window.open(location.href,'_blank'));const second=await(await targetPromise).page();pages.push(second);await second.waitForSelector(form);await intercept(second);await fill(second);
  await Promise.all([submit(page),submit(second)]);await Promise.all([ready(page),ready(second)]);if(interceptionFailure)throw interceptionFailure;
  assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':shared}),1);assert.equal(writes.filter(w=>w.key===shared).length,2);
  assert.equal((await db.collection('transactions').findOne({'manualCreate.key':shared})).timeline.length,1);
  await second.reload({waitUntil:'networkidle2'});await saved(second);const before=attempts;await page.bringToFront();await action(page,modal,ja.draftRecovery.retry);await page.waitForFunction(selector=>!document.querySelector(selector),{},form);assert.equal(attempts,before);
  await second.close();pages.splice(pages.indexOf(second),1);
  pass('real Chrome duplicate tabs share one stored intent and an older tab reads the confirmed result without recreating it');

  const deleted=await open(page);await fill(page);await submit(page);await ready(page);if(interceptionFailure)throw interceptionFailure;
  const deletedWrite=writes.find(w=>w.key===deleted);assert.equal((await call('/api/transactions/'+deletedWrite.result.transactionId,{method:'DELETE',token})).status,200);
  const beforeDeleted=attempts;await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(label=>document.querySelector('[data-manual-recovery]')?.textContent.includes(label),{},ja.draftRecovery.deleted);
  assert.equal((await stored(page,deleted)).state,'deleted');assert.equal(attempts,beforeDeleted);
  pass('real Chrome reload reports a deleted transaction and retains its identity without resurrection');

  const beforeNewFailure=attempts;await page.evaluate(()=>{window.originalDraftAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.transaction.db.name==='omf-manual-drafts')throw new DOMException('Synthetic storage denied','QuotaExceededError');return window.originalDraftAdd.apply(this,args)}});
  try{await action(page,'header',ja.transactionForm.createTitle);await page.waitForFunction(label=>document.body.textContent.includes(label),{polling:100},ja.draftRecovery.storageNewError);assert.equal(await page.$(form),null);assert.equal(attempts,beforeNewFailure)}finally{await page.evaluate(()=>{IDBObjectStore.prototype.add=window.originalDraftAdd;delete window.originalDraftAdd})}
  const aborted=await open(page);await fill(page);const beforeAbort=attempts;
  await abortPuts(page);
  try{await submit(page);await page.waitForFunction(label=>document.body.textContent.includes(label),{timeout:5000},ja.draftRecovery.storageBeforeSend);assert.equal(attempts,beforeAbort);assert.equal((await stored(page,aborted)).state,'draft')}
  catch(error){throw Error('Real Chrome storage commit boundary failed: '+error.message)}
  finally{await restorePuts(page)}
  await submit(page);await ready(page);assert.equal(attempts,beforeAbort+1);await page.reload({waitUntil:'networkidle2'});await saved(page);assert.equal((await stored(page,aborted)).state,'saved');
  pass('real Chrome abort after IndexedDB request success prevents the network continuation until storage commits');

  const owned=await open(page);await fill(page);await submit(page);await ready(page);if(interceptionFailure)throw interceptionFailure;
  const foreign=await require('./helpers/group-session.cjs')(call,token,'Synthetic browser draft other company');await select(foreign.organizationId);
  await page.waitForFunction(selector=>!document.querySelector(selector),{},form);await page.waitForFunction(()=>!new URL(location.href).searchParams.has('draft'));
  assert.equal((await stored(page,owned)).state,'pending');await page.waitForFunction(label=>!document.querySelector('[data-manual-recovery]')?.textContent.includes(label),{},ja.draftRecovery.description);
  await select(organizationId);await page.waitForFunction(label=>document.querySelector('[data-manual-recovery]')?.textContent.includes(label),{},ja.draftRecovery.description);
  const beforeCheck=attempts;await action(page,'[data-manual-recovery]',ja.draftRecovery.check);await saved(page);assert.equal(attempts,beforeCheck);
  const expectedRows=await db.collection('transactions').countDocuments({organizationId,deletedAt:null});assert(expectedRows>1);
  await page.waitForFunction(count=>document.querySelectorAll('tbody tr').length===count,{},expectedRows);
  pass('real Chrome company changes hide the old draft while returning recovers it and the complete company list through authenticated reads');

  responseMode='pass';const ordinary=await open(page);await fill(page);await submit(page);await page.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);await until(async()=>!(await page.$('[data-manual-recovery]')));assert.equal((await stored(page,ordinary)).state,'saved');
  pass('real Chrome ordinary successful saves leave no confirmation-needed panel');

  // Seed the result of an actual rejected API request. The UI correction omits
  // its unsupported field; this avoids pretending a successful POST was a 400.
  const seedRejected=async()=>{
   const draftKey=require('node:crypto').randomBytes(16).toString('hex'),payload={...row.payload,unsupportedFixtureField:true};
   assert.equal((await call('/api/transactions',{method:'POST',token,headers:{'Idempotency-Key':draftKey},body:payload})).status,400);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':draftKey}),0);
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),owner=JSON.stringify([claims.userId,String(organizationId)]);
   const rejected={id:JSON.stringify([owner,draftKey]),owner,key:draftKey,state:'rejected',revision:1,payload,previousPayloads:[],createdAt:new Date().toISOString()};
   await page.evaluate(async record=>{const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('omf-manual-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=database.transaction('drafts','readwrite',{durability:'strict'});tx.oncomplete=()=>{database.close();resolve()};tx.onabort=()=>{database.close();reject(tx.error)};tx.objectStore('drafts').put(record)})},rejected);return rejected;
  };
  const stale=await browser.newPage();pages.push(stale);await intercept(stale);
  const rejected=await seedRejected();await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await stale.goto(origin+'/transactions?draft='+rejected.key,{waitUntil:'networkidle2'});await stale.waitForSelector(form);
  const panel='[data-manual-draft="'+rejected.key+'"]',beforeDiscard=attempts;
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-rejected.png')});
  await abortPuts(page);try{await action(page,panel,ja.draftRecovery.discard);await page.waitForFunction(label=>document.body.textContent.includes(label),{polling:100},ja.draftRecovery.storageError);assert.equal((await stored(page,rejected.key)).state,'rejected')}finally{await restorePuts(page)}
  await action(page,panel,ja.draftRecovery.discard);await until(async()=>(await stored(page,rejected.key)).state==='discarded');await submit(stale);await stale.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);assert.equal(attempts,beforeDiscard);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':rejected.key}),0);await stale.reload({waitUntil:'networkidle2'});assert.equal(await stale.$(form),null);
  pass('real Chrome discard survives storage abort and prevents an older tab or reload from sending the rejected purchase');

  const corrected=await seedRejected();await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await stale.goto(origin+'/transactions?draft='+corrected.key,{waitUntil:'networkidle2'});await stale.waitForSelector(form);responseMode='hold';releaseHeld=null;await submit(stale);await until(()=>!!releaseHeld);assert.equal((await stored(page,corrected.key)).state,'pending');
  try{await action(page,'[data-manual-draft="'+corrected.key+'"]',ja.draftRecovery.discard);await page.waitForFunction(label=>document.body.textContent.includes(label),{polling:100},ja.draftRecovery.discardChanged);assert.equal((await stored(page,corrected.key)).state,'pending')}finally{releaseHeld();releaseHeld=null;responseMode='pass'}
  await stale.waitForFunction(selector=>!document.querySelector(selector),{polling:100},form);assert.equal((await stored(page,corrected.key)).state,'saved');assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':corrected.key}),1);await stale.close();pages.splice(pages.indexOf(stale),1);await page.bringToFront();await page.reload({waitUntil:'networkidle2'});
  pass('real Chrome a newer corrected save wins over a stale discard and completes with one ledger entry');

  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),false);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  if(process.env.OMF_TEST_SCREENSHOT){await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')})}
  assert.deepEqual(errors,[]);if(interceptionFailure)throw interceptionFailure;
  pass('real Chrome recovery uses the light transaction layout without mobile overflow or page exceptions');
 }catch(error){if(process.env.OMF_TEST_SCREENSHOT){try{require('node:fs').writeFileSync(process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.json'),JSON.stringify({attempts,writes,interceptionFailure:interceptionFailure?.stack,pages:await Promise.all(pages.map(p=>p.evaluate(()=>({url:location.href,visible:document.visibilityState,text:document.body.innerText,buttons:[...document.querySelectorAll('body > .fixed.z-50 button')].map(b=>({text:b.textContent,disabled:b.disabled}))}))))},null,2))}catch{}if(pages[0])try{await pages[0].bringToFront();await pages[0].screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png')})}catch{}}throw error}
 finally{if(releaseHeld)releaseHeld();if(releaseList)try{await releaseList()}catch{}for(const page of pages)try{await page.close()}catch{}browser.disconnect()}
};

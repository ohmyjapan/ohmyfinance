const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {ObjectId}=require('mongodb');
module.exports=async({db,call,upload,token,other,deviceToken,origin,pass,root,csv,row,pause})=>{
 const {fixture}=await import('./finance-learning-fixture.mjs'),{prepareWorkbook}=await import('./finance-learning-workbook.mjs'),{loadLearningBundle}=await import('./finance-learning-import.mjs');
 const owner=await db.collection('users').findOne({email:'finance-a@example.invalid'}),account=await db.collection('financialaccounts').findOne({ownerId:owner._id,name:'Synthetic Amex'}),customerId=new ObjectId();
 await db.collection('customers').insertOne({_id:customerId,name:'Learning test customer',isActive:true});
 const {bytes,config}=fixture({ownerId:String(owner._id),accountBindings:[{accountId:String(account._id),labels:['Test card','Sub card']}],customerAliases:[{customerId:String(customerId),name:'Learning test customer',labels:['Alias','Customer code']}]});
 const bundle=prepareWorkbook(bytes,config),names=['transactions','financeentries','financedrafts','financereviews'];
 const counts=async()=>Object.fromEntries(await Promise.all(names.map(async n=>[n,await db.collection(n).countDocuments()]))),before=await counts();
 assert.equal((await call('/api/finance-learning/overview')).status,401);
 assert.equal((await call('/api/finance-learning/overview',{token:deviceToken})).status,401);
 const imported=await loadLearningBundle(db,bundle);
 const api=(route,body,method='GET',auth=token)=>call('/api/finance-learning/'+route,{token:auth,body,method});
 const overview=await api('overview');assert.equal(overview.status,200,JSON.stringify(overview));assert.equal(overview.data.dataset.summary.rowCount,bundle.rows.length);assert.equal(overview.data.dataset.sheets.length,4);
 assert.equal((await api('overview',undefined,'GET',other)).data.dataset,null);
 const list=await api('patterns');assert.equal(list.data.total,2);const pattern=list.data.items.find(p=>p.accountId===String(account._id));assert.equal(pattern.total,9);assert.equal(pattern.grade,'C');
 assert.equal((await api('patterns?q=%5B.*')).data.total,0);assert.equal((await api('patterns?page=-1')).status,400);
 const detail=await api('patterns/'+pattern._id);assert.equal(detail.data.items.length,9);const first=detail.data.items.find(r=>r.row===2);
 const source=await api('rows/'+first._id);assert.equal(source.data.row.cells.find(c=>c.address==='K2').value,4548296520346);
 assert.equal((await api('rows/'+first._id,undefined,'GET',other)).status,404);assert.equal((await api('patterns/'+pattern._id,undefined,'GET',other)).status,404);
 assert.equal((await api('rows?sheet=archive')).data.total,13);assert.equal((await api('rows?sheet=notes')).data.total,2);assert.equal((await api('rows?sheet=empty')).data.total,0);
 assert.deepEqual(await counts(),before);pass('learning imports all source tabs privately, excludes archive copies from patterns, preserves exact cells and denies cross-owner access');
 const changed=structuredClone(bundle);changed.rows[0].row=999;await assert.rejects(()=>loadLearningBundle(db,changed),/modified/);
 const input={revision:0,status:'confirmed',purpose:'customer',customerId:String(customerId),effectiveFrom:'2026-08-02',note:'Explicit synthetic customer rule'};
 assert.equal((await api('patterns/'+pattern._id,{...input,customerId:String(new ObjectId())},'PUT')).status,400);
 const race=await Promise.all([api('patterns/'+pattern._id,input,'PUT'),api('patterns/'+pattern._id,input,'PUT')]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 assert.equal((await api('patterns/'+pattern._id)).data.pattern.audit.length,1);
 await loadLearningBundle(db,bundle);assert.equal((await api('patterns/'+pattern._id)).data.pattern.revision,1);assert.equal(await db.collection('financelearningrows').countDocuments({datasetId:new ObjectId(imported.datasetId)}),bundle.rows.length);
 assert.deepEqual(await counts(),before);pass('rule confirmations are revision-checked, audited and preserved by import retries without changing drafts or ledger');
 const uploaded=await upload(csv([row({2:'Synthetic shop',5:'1234'})]));assert.equal(uploaded.status,200);
 const reviewRoute='/api/finance-review/imports/'+uploaded.data.id+'/drafts/2';
 let reviewed=await call(reviewRoute,{token});assert.equal(reviewed.status,200,JSON.stringify(reviewed));assert.equal(reviewed.data.study.historyCount,9);assert.equal(reviewed.data.study.learning.rules.length,0,'Future effective date must not apply');
 // Same-day and future source rows must be excluded, even if the dataset was imported later.
 await db.collection('financelearningrows').updateOne({datasetId:new ObjectId(imported.datasetId),sheet:'data',row:2},{$set:{date:'2026-08-01'}});
 await db.collection('financelearningrows').updateOne({datasetId:new ObjectId(imported.datasetId),sheet:'data',row:3},{$set:{date:'2026-08-02'}});
 reviewed=await call(reviewRoute,{token});assert.equal(reviewed.data.study.historyCount,7);
 await db.collection('financelearningrows').updateMany({datasetId:new ObjectId(imported.datasetId),sheet:'data',row:{$in:[2,3]}},{$set:{date:'2021-04-08'}});
 assert.equal((await api('patterns/'+pattern._id,{...input,revision:1,effectiveFrom:'2026-08-01'},'PUT')).status,200);
 reviewed=await call(reviewRoute,{token});assert.equal(reviewed.data.study.learning.rules.length,1);assert.equal(reviewed.data.study.learning.rules[0].decision.customerId,String(customerId));
 await db.collection('customers').updateOne({_id:customerId},{$set:{isActive:false}});reviewed=await call(reviewRoute,{token});assert.equal(reviewed.data.study.learning.rules.length,0);
 await db.collection('customers').updateOne({_id:customerId},{$set:{isActive:true}});
 assert.equal((await api('patterns/'+pattern._id,{...input,revision:2,status:'deferred',note:'Exception needs review'},'PUT')).status,200);reviewed=await call(reviewRoute,{token});assert.equal(reviewed.data.study.learning.rules.length,0);
 assert.deepEqual(await counts(),before);pass('purchase study uses earlier primary-sheet history, honors effective dates and immediately withdraws deferred rules or inactive customers');
 if(process.env.OMF_TEST_CHROME_PORT){
  const {createRequire}=require('node:module'),req=createRequire(path.join(root,'collector/package.json')),p=req('rebrowser-puppeteer-core');
  const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
  try{
   page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
   const waitFor=async fn=>{for(let i=0;i<100;i++){if(await page.evaluate(fn))return;await pause(100)}throw Error('Learning browser condition timed out')};
   if(await page.evaluate(()=>!!document.querySelector('#email'))){await page.evaluate(()=>document.querySelector('#email').focus());await page.keyboard.type('finance-a@example.invalid');await page.evaluate(()=>document.querySelector('#password').focus());await page.keyboard.type('Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type="submit"]').click());await waitFor(()=>location.pathname==='/')}
   await page.evaluate(()=>localStorage.setItem('theme','light'));await page.goto(origin+'/learning',{waitUntil:'networkidle2'});await waitFor(()=>document.querySelectorAll('section[aria-label="ルール案"] button').length>=2);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.learning .card')).backgroundColor),'rgb(255, 255, 255)');
   await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="ルール案"] button')].find(b=>b.querySelector('h2')).click());await waitFor(()=>!!document.querySelector('section[aria-label="ルールの根拠と確認"]'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-learning-mobile.png'),captureBeyondViewport:false});
   await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('全項目を見る')).click());await waitFor(()=>[...document.querySelectorAll('dd')].some(e=>e.textContent.includes('4548296520346')));
   await page.setViewport({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-learning-desktop.png'),captureBeyondViewport:false});
   await page.evaluate(()=>{const section=document.querySelector('section[aria-label="ルールの根拠と確認"]'),select=section.querySelector('form select'),note=section.querySelector('textarea');select.value='company';select.dispatchEvent(new Event('change',{bubbles:true}));note.value='Confirmed in the browser; synthetic test only';note.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.evaluate(()=>document.querySelector('section[aria-label="ルールの根拠と確認"] button[type="submit"]').click());await waitFor(()=>[...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('保存しました')));
   await page.goto(origin+'/learning?pattern='+pattern._id,{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('section[aria-label="ルールの根拠と確認"] textarea'));
   assert.equal(await page.evaluate(()=>document.querySelector('section[aria-label="ルールの根拠と確認"] textarea').value),'Confirmed in the browser; synthetic test only');
   assert.deepEqual(errors,[]);pass('real Chrome: learning list, rule evidence, exact source cells, saving and reload work in light mode at mobile and desktop widths');
  } finally{if(page)await page.close();await browser.disconnect()}
 }
};

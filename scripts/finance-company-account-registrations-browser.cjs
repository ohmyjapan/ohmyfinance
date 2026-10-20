// Owned synthetic native application only. Installed Chrome on the real transaction modal; no model/provider or business sends.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({root,origin,call,ok,db,ObjectId,ownerToken,tokenA,tokenB,A,B,pause,pass})=>{
 // Nested worktrees resolve the collector's installed dependencies from the parent checkout; no junction.
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-account-registration-ui-'));
 let browser,page,hold=false;const errors=[],held=[],transactionWrites=[],categories=db.collection('accountcategories'),transactions=db.collection('transactions');
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<240;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('account-ui:chrome-'+label)};
 const nativeSwitch=async organizationId=>page.evaluate(async organizationId=>{
  const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');
  const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');
  const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}}),profile=await p.json();if(!p.ok)throw Error('Synthetic profile failed');user.acceptSession({...profile,tokens:s.tokens},false);
 },organizationId);
 const control=kind=>'[data-account-registration-kind='+kind+']';
 const statusText=kind=>page.evaluate(s=>document.querySelector(s+' [data-account-registration-status]')?.textContent||'',control(kind));
 const chooseAccount=id=>page.evaluate(id=>{const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===id));if(!select)return false;select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));return true},id);
 const registrations=async name=>((await categories.findOne({name}))?.companyRegistrations||[]).map(x=>String(x.organizationId)).sort();
 // Accounts shown by the modal are read when the page mounts: create them first (legacy, no company registration).
 const legacyAccount=await ok('/api/account-categories',ownerToken,'POST',{name:'UI_LEGACY_ACCOUNT',type:'expense'}),legacyId=String(legacyAccount._id);
 await ok('/api/account-categories',ownerToken,'POST',{name:'UI_LEGACY_SUB',parentId:legacyId});
 const lateAccount=await ok('/api/account-categories',ownerToken,'POST',{name:'UI_LATE_ACCOUNT',type:'expense'}),lateId=String(lateAccount._id);
 try{
  assert.ok(executablePath,'Installed Chrome is required');browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});
  await page.setRequestInterception(true);page.on('request',request=>{const url=request.url();if(url.startsWith(origin+'/api/transactions')&&['POST','PUT','PATCH','DELETE'].includes(request.method()))transactionWrites.push(request.method()+' '+url);if(hold&&/\/api\/account-categories\/[a-f0-9]{24}\/registration$/.test(url)&&request.method()==='POST'){hold=false;held.push(request)}else request.continue().catch(()=>{})});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email','company-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});
  await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('新規取引')),[],'create-button');await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新規取引')).click());
  await wait(id=>[...document.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value===id)),[legacyId],'modal-accounts');
  const txBefore=await transactions.countDocuments();assert.ok(await chooseAccount(legacyId));
  await wait(s=>!!document.querySelector(s+' [data-account-registration-button]'),[control('account')],'account-control');
  assert.ok((await page.$eval(control('account')+' [data-account-registration-company]',e=>e.textContent)).includes('Synthetic company 0'),'account-ui:company-label');
  await page.click(control('account')+' [data-account-registration-button]');
  await wait(s=>(document.querySelector(s+' [data-account-registration-status]')?.textContent||'').includes('Naviの選択肢に登録しました'),[control('account')],'account-registered');
  assert.ok((await statusText('account')).includes('UI_LEGACY_ACCOUNT')&&(await statusText('account')).includes('取引はまだ保存されていません'),'account-ui:useful-success');
  assert.deepEqual(await registrations('UI_LEGACY_ACCOUNT'),[A],'account-ui:registered-for-selected-company');assert.equal(await transactions.countDocuments(),txBefore,'account-ui:no-transaction-save');assert.deepEqual(transactionWrites,[],'account-ui:no-transaction-save');
  assert.equal(await page.$eval(control('account')+' [data-account-registration-button]',e=>e.disabled),true);
  // Mobile layout: the control stays inside the 390 px viewport and adds no horizontal scroll.
  const box=await page.$eval(control('account'),e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth}});assert.ok(box.left>=0&&box.right<=box.width&&box.scroll<=box.width,'account-ui:mobile-layout '+JSON.stringify(box));
  // Sub-account of the selected account: choose it from the suggestions and register it.
  const subInput=await page.$('input[placeholder="補助科目を検索"]');assert.ok(subInput,'account-ui:sub-input');
  await subInput.focus();await page.keyboard.type('UI_LEGACY_SUB');
  await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='UI_LEGACY_SUB'),[],'sub-suggestion');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='UI_LEGACY_SUB').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
  await wait(s=>!!document.querySelector(s+' [data-account-registration-button]'),[control('subAccount')],'sub-control');await page.click(control('subAccount')+' [data-account-registration-button]');
  await wait(s=>(document.querySelector(s+' [data-account-registration-status]')?.textContent||'').includes('UI_LEGACY_SUB'),[control('subAccount')],'sub-registered');
  assert.deepEqual(await registrations('UI_LEGACY_SUB'),[A],'account-ui:sub-registered');assert.deepEqual(await registrations('UI_LEGACY_ACCOUNT'),[A]);assert.equal(await transactions.countDocuments(),txBefore,'account-ui:no-transaction-save');assert.deepEqual(transactionWrites,[],'account-ui:no-transaction-save');
  pass('installed Chrome: the native modal registers the selected account and sub-account for the selected company with a useful message, saves no transaction and fits a 390 px screen');

  // A response that arrives after the company changed is dropped; the new company starts clean and registers for itself.
  assert.ok(await chooseAccount(lateId));await wait(s=>document.querySelector(s+' [data-account-registration-button]')?.disabled===false,[control('account')],'late-control');
  hold=true;await page.click(control('account')+' [data-account-registration-button]');for(let i=0;i<80&&!held.length;i++)await pause(100);assert.equal(held.length,1,'account-ui:held-registration');
  await nativeSwitch(B);await wait(s=>(document.querySelector(s+' [data-account-registration-company]')?.textContent||'').includes('Synthetic company 1'),[control('account')],'switched-B');
  await held[0].continue();for(let i=0;i<80&&(await registrations('UI_LATE_ACCOUNT')).length===0;i++)await pause(100);await pause(500);
  assert.deepEqual(await registrations('UI_LATE_ACCOUNT'),[A],'account-ui:held-request-was-A');assert.equal(await statusText('account'),'','account-ui:late-response-dropped');assert.equal(await page.$eval(control('account')+' [data-account-registration-button]',e=>e.disabled),false,'account-ui:late-response-dropped');
  await page.click(control('account')+' [data-account-registration-button]');await wait(s=>(document.querySelector(s+' [data-account-registration-status]')?.textContent||'').includes('Synthetic company 1'),[control('account')],'B-registered');assert.deepEqual(await registrations('UI_LATE_ACCOUNT'),[A,B].sort(),'account-ui:registered-for-selected-company');
  // A new sub-account created in the modal reports its company registration.
  await nativeSwitch(A);await wait(s=>(document.querySelector(s+' [data-account-registration-company]')?.textContent||'').includes('Synthetic company 0'),[control('account')],'switched-A');
  assert.ok(await chooseAccount(legacyId));await subInput.click({clickCount:3});await page.keyboard.type('UI_NEW_SUB');
  await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('新規作成')&&b.textContent.includes('UI_NEW_SUB')),[],'create-sub-option');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新規作成')&&b.textContent.includes('UI_NEW_SUB')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
  await wait(()=>!!document.querySelector('.z-\\[60\\] input[type=text]'),[],'sub-dialog');await page.$eval('.z-\\[60\\] input[type=text]',e=>{e.value='UI_NEW_SUB';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.evaluate(()=>[...document.querySelectorAll('.z-\\[60\\] button')].find(b=>b.textContent.trim()==='保存').click());
  await wait(s=>(document.querySelector(s+' [data-account-registration-status]')?.textContent||'').includes('新しい科目「UI_NEW_SUB」'),[control('subAccount')],'created-feedback');
  assert.ok((await statusText('subAccount')).includes('Synthetic company 0'),'account-ui:create-feedback');assert.deepEqual(await registrations('UI_NEW_SUB'),[A],'account-ui:create-feedback');
  assert.equal(await transactions.countDocuments(),txBefore,'account-ui:no-transaction-save');assert.deepEqual(transactionWrites,[],'account-ui:no-transaction-save');
  assert.deepEqual(errors,[],'account-ui:no-page-errors');
  pass('installed Chrome: a late registration response after a company switch is dropped, the new company registers for itself, and a sub-account created in the modal reports its company registration');
 }finally{for(const h of held.splice(0))await h.continue().catch(()=>{});if(browser)await browser.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true}).catch(()=>{})}
};

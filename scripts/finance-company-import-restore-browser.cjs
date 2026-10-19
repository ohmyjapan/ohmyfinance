// Installed Chrome on the owned synthetic application only (invoked by finance-company-import-restore-integration). Drives the actual
// Transactions > Import wizard and Settings > Backup/Restore controls; no model, provider or business sends. Absent Chrome fails, never passes.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync,readdirSync}=require('node:fs');
module.exports=async({root,origin,db,A,B,owner,members,organizations,pause,pass,transactions,recurring,guarded,backup,tx,rec,password})=>{
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(__dirname,'../../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const ja=JSON.parse(await fs.readFile(path.join(__dirname,'../i18n/locales/ja.json'),'utf8')),label=k=>k.split('.').reduce((o,x)=>o&&o[x],ja);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-import-restore-ui-')),downloads=path.join(directory,'downloads');await fs.mkdir(downloads);let browser,page;const errors=[],dialogs=[];
 const wait=async(fn,args=[],name='condition',tries=300)=>{for(let i=0;i<tries;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('import-restore-ui:chrome-'+name)};
 const text=()=>page.evaluate(()=>document.body.innerText);
 const click=async(words,name,last=false)=>{await wait((w,l)=>{const b=[...document.querySelectorAll('button')].filter(b=>b.textContent.includes(w)&&!b.disabled&&b.offsetParent!==null);const t=l?b[b.length-1]:b[0];if(!t)return false;t.click();return true},[words,last],'click-'+name)};
 const push=to=>page.evaluate(to=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to),to);
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},organizationId);
 const stats=()=>page.evaluate(()=>[...document.querySelectorAll('.grid.grid-cols-3 p.text-2xl')].map(e=>e.textContent.trim()));
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 // The new scope labels must fit a 390 px screen; overflow from unchanged components is recorded, not attributed to this change.
 const fits=async(selector,where)=>{const right=await page.$eval(selector,e=>e.getBoundingClientRect().right);assert.ok(right<=await page.evaluate(()=>innerWidth),'import-restore-ui:mobile-label-fits '+selector);if(await overflow())console.log('NOTE existing mobile overflow on '+where+' page (unchanged components): '+await offenders())};
 const offenders=()=>page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getClientRects().length).slice(0,12).map(e=>e.tagName+'.'+String(e.className).slice(0,60)+(e.dataset&&Object.keys(e.dataset).length?'['+Object.keys(e.dataset).join(',')+']':'')+'@'+Math.round(e.getBoundingClientRect().right)).join(' | '));
 const files=()=>readdirSync(downloads).filter(f=>f.endsWith('.json'));
 // Holds one matching request until released, so the actor/company can change while it is in flight.
 let held=null,holdPattern=null;const hold=pattern=>{holdPattern=pattern;held=null};const release=async()=>{for(let i=0;i<300&&!held;i++)await pause(50);assert.ok(held,'import-restore-ui:held-request');const r=held;held=null;holdPattern=null;await r.continue()};
 const csv=async(name,rows,header='date,amount,notes,productName')=>{const file=path.join(directory,name);await fs.writeFile(file,'\ufeff'+[header,...rows].join('\r\n'));return file};
 const wizard=async(file)=>{if(await page.evaluate(()=>location.pathname)==='/transactions/upload')await push('/transactions');await push('/transactions/upload');await wait(()=>location.pathname==='/transactions/upload'&&document.querySelector('input[type=file]'),[],'upload-page');const input=await page.$('input[type=file]');await input.uploadFile(file);
  await click(label('transactionImport.continueToMapping'),'to-mapping');await click(label('fieldMapper.continueToPreview'),'to-preview');await click(label('dataPreview.continueToImport'),'to-import');await click(label('importConfirmation.startImport'),'start-import')};
 try{
  assert.ok(executablePath,'import-restore-ui:installed-chrome-required');
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource|Backup failed|Restore failed/.test(m.text()))errors.push(m.text())});page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(()=>{})});
  await page.setRequestInterception(true);page.on('request',request=>{if(holdPattern&&!held&&request.url().includes(holdPattern)&&request.method()!=='OPTIONS'){held=request;return}request.continue().catch(()=>{})});
  const cdp=await page.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email',owner.email);await page.type('#password',password);await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/transactions/upload',{waitUntil:'networkidle2'});
  await wait(()=>document.querySelector('[data-import-company]')?.textContent.includes('Synthetic import company A'),[],'import-scope-label');await fits('[data-import-company]','upload');

  // 0. Recorded, not fixed here (pre-existing since before d732, outside F1/F2): with headers that differ from the target field names
  // (e.g. Japanese date/amount headers), the preview step hands already-mapped rows back while the page re-sends the source mappings,
  // so the route maps twice and every row fails as 'amount missing'. Observed and logged; it must never land in another company.
  await wizard(await csv('ui-japanese-headers.csv',['2026/05/03,5500,UI_JA_NOTE,UI_JA_PRODUCT'],'\u65e5\u4ed8,\u91d1\u984d,\u5099\u8003,\u5546\u54c1\u540d'));await click(label('importConfirmation.startImport'),'confirm-japanese',true);
  await wait(()=>document.querySelector('[data-import-result-company]')?.textContent.includes('Synthetic import company A'),[],'japanese-result');
  const jaRows=await transactions.find({productName:'UI_JA_PRODUCT'}).toArray();assert.ok(jaRows.every(r=>String(r.organizationId)===String(A)),'import-restore-ui:import-company');
  console.log('NOTE existing wizard defect: Japanese-header CSV through the native wizard saved '+jaRows.length+' row(s); result page lines: '+JSON.stringify((await text()).split('\n').filter(l=>/\d/.test(l)).slice(0,8)));
  const jaStats=await stats();assert.equal(jaStats.length,3,'import-restore-ui:result-visible');console.log('NOTE japanese-header result counts shown (imported, skipped, errors): '+JSON.stringify(jaStats));

  // 1. Actual CSV wizard imports into the selected company; the row appears on the native transactions page.
  await wizard(await csv('ui-import.csv',['2026/05/01,3300,UI_IMPORT_NOTE,UI_IMPORT_PRODUCT']));await click(label('importConfirmation.startImport'),'confirm-import',true);
  await wait(()=>document.querySelector('[data-import-result-company]')?.textContent.includes('Synthetic import company A'),[],'import-result');
  assert.deepEqual(await stats(),['1','0','0'],'import-restore-ui:result-visible');
  const imported=await transactions.findOne({productName:'UI_IMPORT_PRODUCT'});assert.ok(imported,'import-restore-ui:import-company');assert.equal(String(imported.organizationId),String(A),'import-restore-ui:import-company');
  await push('/transactions');await wait(()=>location.pathname==='/transactions'&&document.body.innerText.includes('UI_IMPORT_PRODUCT'),[],'import-visible');
  pass('installed Chrome: the native CSV wizard names the selected company, imports into it and the row appears on the transactions page');

  // 2. A delayed import response after the company changed is not shown as a result of the new company.
  await wizard(await csv('ui-stale.csv',['2026/05/02,4400,UI_STALE_NOTE,UI_STALE_PRODUCT']));hold('/api/transactions/import');await click(label('importConfirmation.startImport'),'confirm-stale',true);
  for(let i=0;i<300&&!held;i++)await pause(50);assert.ok(held,'import-restore-ui:held-request');await nativeSwitch(B);await wait(()=>document.querySelector('[data-import-company]')?.textContent.includes('Synthetic import company B'),[],'switched-label');await release();
  await wait(()=>!!document.querySelector('[data-import-stale]'),[],'import-stale');assert.equal(await page.$('[data-import-result-company]'),null,'import-restore-ui:import-stale-dropped');
  const stale=await transactions.findOne({productName:'UI_STALE_PRODUCT'});assert.ok(stale&&String(stale.organizationId)===String(A),'import-restore-ui:import-stale-company');
  pass('installed Chrome: an import that finishes after a company switch is not presented as the new company result');

  // 3. Settings backup names the company; download holds only that company; HTTP failure and a stale reply download nothing.
  await nativeSwitch(A);await push('/settings');await wait(()=>document.querySelector('[data-backup-scope]')?.textContent.includes('Synthetic import company A'),[],'backup-scope');await fits('[data-backup-scope]','settings');
  await click(label('settingsPage.downloadBackup'),'download');for(let i=0;i<200&&!files().length;i++)await pause(100);assert.equal(files().length,1,'import-restore-ui:export-download');await pause(300);
  const exported=JSON.parse(await fs.readFile(path.join(downloads,files()[0]),'utf8'));assert.equal(exported.scope?.organizationId,String(A),'import-restore-ui:export-company');assert.ok(exported.transactions.some(t=>t.productName==='UI_IMPORT_PRODUCT'),'import-restore-ui:export-company');assert.ok(!JSON.stringify(exported).includes('FOREIGN_PRIVATE'),'import-restore-ui:export-company');
  await organizations.updateOne({_id:A},{$set:{members:members.filter(m=>String(m.userId)!==String(owner.id))}});const dialogCount=dialogs.length;await click(label('settingsPage.downloadBackup'),'download-denied');
  await wait(()=>!!document.querySelector('[data-backup-error]'),[],'export-error');await pause(1500);assert.equal(files().length,1,'import-restore-ui:export-error-no-download');assert.equal(dialogs.length,dialogCount,'import-restore-ui:export-error-inline');await organizations.updateOne({_id:A},{$set:{members}});
  hold('/api/backup?');await click(label('settingsPage.downloadBackup'),'download-stale');for(let i=0;i<300&&!held;i++)await pause(50);await nativeSwitch(B);await release();await wait(()=>!!document.querySelector('[data-backup-stale]'),[],'export-stale');await pause(1500);assert.equal(files().length,1,'import-restore-ui:export-stale-dropped');
  pass('installed Chrome: settings names the selected company, the backup file holds only it, and an HTTP error or a reply after a company switch downloads nothing');

  // 4. Restore through the settings controls: own rows restored and visible, other/held rows skipped with reasons, clear limited to the company.
  await nativeSwitch(A);await push('/settings');await wait(()=>document.querySelector('[data-backup-scope]')?.textContent.includes('Synthetic import company A'),[],'backup-scope-again');
  const restoreFile=path.join(directory,'ui-restore.json');await fs.writeFile(restoreFile,JSON.stringify(backup({transactions:[tx({organizationId:String(A),referenceNumber:'UI-RESTORE-1',productName:'UI_RESTORED_TX'}),tx({organizationId:String(B),referenceNumber:'UI-FOREIGN-1',productName:'UI_FOREIGN_RESTORE_PRIVATE'}),tx({referenceNumber:'UI-HELD-1',productName:'UI_HELD_RESTORE_PRIVATE'})],recurringPayments:[rec({organizationId:String(A),name:'UI_RESTORED_RECURRING'})]})));
  const guardedBefore=await guarded(),receiptsBefore=await db.collection('receipts').countDocuments({organizationId:A});
  await (await page.$('input[type=file][accept=".json"]')).uploadFile(restoreFile);await wait(()=>[...document.querySelectorAll('label')].some(l=>l.textContent.includes('\u65e2\u5b58')),[],'restore-options');
  await page.evaluate(w=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.includes(w));const c=l.querySelector('input[type=checkbox]');if(!c.checked)c.click()},label('settingsPage.clearExisting'));
  await wait(()=>!!document.querySelector('[data-restore-clear-scope]'),[],'clear-scope-note');assert.ok((await page.$eval('[data-restore-clear-scope]',e=>e.textContent)).includes('Synthetic import company A'),'import-restore-ui:clear-scope-note');
  await click(label('settingsPage.restoreData'),'restore');await wait(()=>!!document.querySelector('[data-restore-result]'),[],'restore-result');
  const reasons=await page.$eval('[data-restore-result]',e=>e.textContent);assert.ok(reasons.includes('\u4ed6\u306e\u4f1a\u793e')&&reasons.includes('\u4f1a\u793e\u672a\u8a2d\u5b9a'),'import-restore-ui:restore-reasons');assert.ok(!/PRIVATE/.test(reasons));
  assert.deepEqual((await transactions.find({organizationId:A}).toArray()).map(t=>t.productName),['UI_RESTORED_TX'],'import-restore-ui:restore-clear-scoped');assert.equal(await guarded(),guardedBefore,'import-restore-ui:restore-foreign-preserved');assert.deepEqual((await recurring.find({organizationId:A}).toArray()).map(r=>r.name),['UI_RESTORED_RECURRING'],'import-restore-ui:restore-clear-scoped');assert.equal(await db.collection('receipts').countDocuments({organizationId:A}),receiptsBefore,'import-restore-ui:restore-missing-section-kept');
  await push('/transactions');await wait(()=>location.pathname==='/transactions'&&document.body.innerText.includes('UI_RESTORED_TX'),[],'restore-visible');assert.ok(!(await text()).includes('UI_FOREIGN_RESTORE'),'import-restore-ui:restore-visible');
  await push('/recurring');await wait(()=>location.pathname==='/recurring'&&document.body.innerText.includes('UI_RESTORED_RECURRING'),[],'restore-recurring-visible');
  pass('installed Chrome: restore explains the selected-company scope, restores only its rows (visible on transactions and recurring pages), names skipped other-company and held rows, and clears only that company');

  // 5. A restore reply after a company switch is not shown for the new company.
  await push('/settings');await wait(()=>!!document.querySelector('[data-backup-scope]'),[],'settings-again');const staleFile=path.join(directory,'ui-stale-restore.json');await fs.writeFile(staleFile,JSON.stringify(backup({transactions:[tx({organizationId:String(A),referenceNumber:'UI-STALE-RESTORE',productName:'UI_STALE_RESTORE'})]})));
  await (await page.$('input[type=file][accept=".json"]')).uploadFile(staleFile);hold('/api/backup/restore');await click(label('settingsPage.restoreData'),'restore-stale');for(let i=0;i<300&&!held;i++)await pause(50);await nativeSwitch(B);await release();
  await wait(()=>!!document.querySelector('[data-restore-stale]'),[],'restore-stale');assert.equal(await page.$('[data-restore-result]'),null,'import-restore-ui:restore-stale-dropped');
  const staleRestore=await transactions.findOne({productName:'UI_STALE_RESTORE'});assert.ok(staleRestore&&String(staleRestore.organizationId)===String(A),'import-restore-ui:restore-stale-company');
  pass('installed Chrome: a restore reply that arrives after a company switch is not presented for the new company');

  // 6. The Navi girl and accordion stay on the page; no unexpected browser errors or alert dialogs.
  await nativeSwitch(A);await push('/settings');await page.evaluate(()=>{const t=document.querySelector('[data-assistant-toggle]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click()});
  await wait(()=>!!document.querySelector('[data-assistant-accordion] img[src="/images/omf-navi-film.jpg"]'),[],'navi-girl');assert.deepEqual(errors,[],'import-restore-ui:no-errors');assert.deepEqual(dialogs,[],'import-restore-ui:no-alert');
  pass('installed Chrome: the Navi girl/accordion remains, no page errors or alert dialogs');
 }finally{if(browser)await browser.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true}).catch(()=>{})}
};

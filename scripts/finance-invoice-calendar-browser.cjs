// Installed Chrome on the owned synthetic application only (invoked by finance-invoice-calendar-integration). Worker replies are
// synthetic test replies through the real worker routes; the schedule itself runs the real native service. No model, provider or sends.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({root,origin,worker,claim,actOk,finish,A,invoiceId,invoiceNumber,linked,pause,pass})=>{
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-invoice-calendar-ui-'));let browser,page;const errors=[],dialogs=[],scheduleRequests=[];
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<300;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('invoice-calendar-ui:chrome-'+label)};
 const push=to=>page.evaluate(to=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to),to);
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},organizationId);
 const open=async()=>{await page.evaluate(()=>{const t=document.querySelector('[data-assistant-toggle]');if(t.getAttribute('aria-expanded')!=='true')t.click()});await wait(()=>!!document.querySelector('#assistant-message'),[],'navi-open')};
 const say=async text=>{await worker('heartbeat');await wait(()=>document.querySelector('#assistant-message')&&!document.querySelector('#assistant-message').disabled&&document.querySelector('[data-assistant-send]'),[],'composer-ready');await page.$eval('#assistant-message',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))},text);await page.evaluate(()=>document.querySelector('[data-assistant-send]').click());await wait(()=>document.querySelector('#assistant-message')&&!document.querySelector('#assistant-message').value,[],'sent');return claim()};
 const storeEntries=()=>page.evaluate(id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar')?.payments.filter(p=>p.invoiceLink&&String(p.invoiceLink.invoiceId)===id).length??-1,invoiceId);
 const receipts=()=>page.evaluate(()=>Array.from(document.querySelectorAll('[data-workspace-action-state]')).map(e=>({state:e.getAttribute('data-workspace-action-state'),text:e.textContent})));
 const label='請求書から入金予定を追加';
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 try{
  assert.ok(executablePath,'Installed Chrome is required');browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(()=>{})});
  page.on('request',request=>{if(/\/api\/invoices\/[a-f0-9]{24}\/calendar/.test(request.url())&&request.method()==='POST')scheduleRequests.push(request.url())});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email','calendar-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);
  // 1. On the calendar page: Navi reads, schedules through the native service, the open calendar reloads by itself.
  await page.goto(origin+'/calendar',{waitUntil:'networkidle2'});await wait(()=>location.pathname==='/calendar',[],'calendar-page');await pause(500);
  assert.equal(await storeEntries(),0,'invoice-calendar-ui:not-yet-linked');assert.ok(!(await page.$eval('main',e=>e.textContent)).includes(invoiceNumber));
  // The native legs left their own turns in this company conversation; a new chat archives them so only this leg's receipts show.
  await open();await wait(()=>document.querySelector('[data-assistant-new-chat]')&&!document.querySelector('[data-assistant-new-chat]').disabled,[],'new-chat-ready');await page.evaluate(()=>document.querySelector('[data-assistant-new-chat]').click());await wait(()=>document.querySelectorAll('[data-workspace-turn]').length===0,[],'new-chat');
  const labelled=state=>page.evaluate((l,s)=>Array.from(document.querySelectorAll('[data-workspace-action-state]')).filter(e=>e.textContent.includes(l)&&(!s||e.getAttribute('data-workspace-action-state')===s)).length,label,state);
  let job=await say('この請求書の入金予定をカレンダーに追加して。');assert.equal(job.context.page,'calendar','invoice-calendar-ui:calendar-context');
  let read=(await actOk(job,'get_company_invoice_calendar',{invoiceId})).result;assert.equal(read.state,'not_linked');
  let done=await actOk(job,'schedule_company_invoice_payment',{invoiceId,expectedUpdatedAt:read.invoice.updatedAt});assert.equal(done.result.outcome,'created');await finish(job);
  await wait(n=>document.querySelector('main')?.textContent.includes(n),[invoiceNumber],'calendar-refresh');assert.equal(await storeEntries(),1,'invoice-calendar-ui:calendar-refresh');
  await wait(l=>Array.from(document.querySelectorAll('[data-workspace-action-state="done"]')).some(e=>e.textContent.includes(l)),[label],'receipt-label');assert.equal(await labelled(),1,'invoice-calendar-ui:receipt');assert.equal(await labelled('done'),1,'invoice-calendar-ui:receipt');
  assert.equal(await overflow(),false,'invoice-calendar-ui:mobile-overflow');
  // 2. From the invoices page: a repeat meets the same one entry; an unsent draft survives minimize and navigation.
  await push('/invoices');await wait(()=>location.pathname==='/invoices',[],'invoices-page');
  job=await say('もう一度この請求書の入金予定を追加して。');assert.equal(job.context.page,'invoices','invoice-calendar-ui:invoice-context');
  read=(await actOk(job,'get_company_invoice_calendar',{invoiceId})).result;assert.equal(read.state,'linked');
  done=await actOk(job,'schedule_company_invoice_payment',{invoiceId,expectedUpdatedAt:read.invoice.updatedAt});assert.equal(done.result.outcome,'existing','invoice-calendar-ui:repeat-existing');await finish(job);
  await wait(l=>Array.from(document.querySelectorAll('[data-workspace-action-state="done"]')).filter(e=>e.textContent.includes(l)).length===2,[label],'second-receipt');assert.equal(await labelled(),2,'invoice-calendar-ui:second-receipt');
  await wait(()=>!document.querySelector('#assistant-message').disabled,[],'composer-free');await page.$eval('#assistant-message',e=>{e.value='UNSENT_INVOICE_CALENDAR_NOTE';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.click('[data-assistant-close]');await push('/calendar');await wait(()=>location.pathname==='/calendar',[],'back-to-calendar');await wait(n=>document.querySelector('main')?.textContent.includes(n),[invoiceNumber],'calendar-reloaded');
  await open();assert.equal(await page.$eval('#assistant-message',e=>e.value),'UNSENT_INVOICE_CALENDAR_NOTE','invoice-calendar-ui:buffer-kept');
  assert.equal(await storeEntries(),1,'invoice-calendar-ui:single-entry');assert.equal((await linked(invoiceId)).length,1,'invoice-calendar-ui:single-entry');
  // 3. Receipts are the server's saved journal: they survive a reload with their state and label.
  await page.reload({waitUntil:'networkidle2'});await open();await wait(l=>Array.from(document.querySelectorAll('[data-workspace-action-state="done"]')).filter(e=>e.textContent.includes(l)).length===2,[label],'receipts-after-reload');
  const saved=await receipts();assert.equal(saved.length,2,'invoice-calendar-ui:persisted-receipt '+JSON.stringify(saved));assert.ok(saved.every(r=>r.state==='done'&&r.text.includes(label)),'invoice-calendar-ui:persisted-receipt '+JSON.stringify(saved));
  assert.deepEqual(scheduleRequests,[],'invoice-calendar-ui:browser-sends-no-schedule');
  await page.setViewport({width:1280,height:900});await pause(300);assert.equal(await overflow(),false,'invoice-calendar-ui:desktop-overflow');
  const screenshots=process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS;if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'invoice-calendar-desktop.png')})}
  assert.deepEqual(dialogs,[],'invoice-calendar-ui:no-script-dialogs');assert.deepEqual(errors,[],'invoice-calendar-ui:console-errors');
  pass('real installed Chrome: Navi read+schedule on the open calendar refreshes it with the one entry and a done receipt; repeat from the invoices page returns the same entry; unsent text survives minimize and navigation; receipts persist after reload; no overflow at 390 or 1280');
 }catch(e){if(page&&process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS){await fs.mkdir(process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS,'failure.png')}).catch(()=>{})}throw e}
 finally{if(browser)await browser.close();const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('omf-invoice-calendar-ui-'));await fs.rm(resolved,{recursive:true,force:true})}
};

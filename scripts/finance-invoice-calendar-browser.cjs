// Installed Chrome on the owned synthetic application only (invoked by finance-invoice-calendar-integration). Worker replies are
// synthetic test replies through the real worker routes; the schedule itself runs the real native service. No model, provider or sends.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({root,origin,worker,claim,actOk,finish,A,invoiceId,invoiceNumber,invoiceDueDate,jpyPaymentId,ledgerRows,linked,pause,pass})=>{
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
  await page.evaluate(day=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').setCurrentMonth(new Date(day+'T12:00:00Z')),invoiceDueDate);
  await wait(n=>Array.from(document.querySelectorAll('main [draggable="true"]')).some(e=>e.textContent.includes(n)),[invoiceNumber],'grid-linked-row');
  const calendarAmount=await page.evaluate(n=>Array.from(document.querySelectorAll('main [draggable="true"]')).find(e=>e.textContent.includes(n))?.textContent,invoiceNumber);
  assert.match(calendarAmount||'',/125\.50/,'invoice-calendar-ui:calendar-cents '+calendarAmount);assert.ok(/USD|\$/.test(calendarAmount)&&!/[￥¥₩]/.test(calendarAmount),'invoice-calendar-ui:calendar-currency '+calendarAmount);
  await wait(l=>Array.from(document.querySelectorAll('[data-workspace-action-state="done"]')).some(e=>e.textContent.includes(l)),[label],'receipt-label');assert.equal(await labelled(),1,'invoice-calendar-ui:receipt');assert.equal(await labelled('done'),1,'invoice-calendar-ui:receipt');
  assert.equal(await overflow(),false,'invoice-calendar-ui:mobile-overflow');
  // 2. From the invoices page: a repeat meets the same one entry; an unsent draft survives minimize and navigation.
  await push('/invoices');await wait(()=>location.pathname==='/invoices',[],'invoices-page');
  await wait(id=>!!document.querySelector('[data-invoice-print="'+id+'"]')?.closest('tr')?.querySelector('td.text-right.font-bold.font-mono')?.textContent.trim(),[invoiceId],'invoice-total-loaded');
  const invoiceTotal=await page.evaluate(id=>document.querySelector('[data-invoice-print="'+id+'"]')?.closest('tr')?.querySelector('td.text-right.font-bold.font-mono')?.textContent.trim(),invoiceId);
  assert.match(invoiceTotal,/125\.50/,'invoice-calendar-ui:saved-currency-decimals '+invoiceTotal);assert.ok(/USD|\$/.test(invoiceTotal)&&!/[￥¥₩]/.test(invoiceTotal),'invoice-calendar-ui:saved-currency-code '+invoiceTotal);
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
  // 4. The actual calendar renders saved units separately and the native form can retain this decimal entry.
  await page.click('[data-assistant-close]');
  await page.evaluate(day=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').setCurrentMonth(new Date(day+'T12:00:00Z')),invoiceDueDate);
  await wait(()=>!!document.querySelector('[data-calendar-summary="income"] [data-calendar-currency="USD"]'),[],'per-currency-summary');
  const totals=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-summary="income"] [data-calendar-currency]')).map(e=>({currency:e.getAttribute('data-calendar-currency'),text:e.textContent.trim()})));
  assert.match(totals.find(x=>x.currency==='USD')?.text||'',/125\.50/,'invoice-calendar-ui:usd-summary');
  assert.match(totals.find(x=>x.currency==='JPY')?.text||'',/12,760/,'invoice-calendar-ui:jpy-summary');
  assert.ok(totals.every(x=>!x.text.includes('12,886')&&!x.text.includes('12,885')),'invoice-calendar-ui:no-mixed-currency-sum '+JSON.stringify(totals));
  const paymentBefore=(await linked(invoiceId))[0],paymentId=String(paymentBefore._id);
  const upcoming=await page.$eval('[data-calendar-upcoming="'+paymentId+'"]',e=>e.textContent);assert.match(upcoming,/125\.50/,'invoice-calendar-ui:upcoming-cents');
  await page.$eval('[data-calendar-day="'+invoiceDueDate+'"]',e=>e.click());await wait(()=>!!document.querySelector('[data-calendar-day-detail]'),[],'day-detail');
  const dayText=await page.$eval('[data-calendar-day-detail]',e=>e.textContent);assert.match(dayText,/125\.50/,'invoice-calendar-ui:day-cents');assert.match(dayText,/12,760/,'invoice-calendar-ui:day-jpy');
  assert.ok(!dayText.includes('paymentModal.categories.'),'invoice-calendar-ui:literal-category-label');
  await page.$eval('[data-calendar-day-detail] button',e=>e.click());
  await page.evaluate(n=>Array.from(document.querySelectorAll('main [draggable="true"]')).find(e=>e.textContent.includes(n)).querySelector('div.flex-1').click(),invoiceNumber);
  await wait(()=>!!document.querySelector('[data-calendar-payment-form]'),[],'native-edit');
  const form=await page.evaluate(()=>{const f=document.querySelector('[data-calendar-payment-form]'),a=f.querySelector('[data-calendar-amount]'),c=f.querySelector('[data-calendar-category]');return {valid:f.checkValidity(),amount:a.value,stepMismatch:a.validity.stepMismatch,category:c.value,text:f.textContent}});
  assert.equal(form.amount,'125.5','invoice-calendar-ui:form-cents');assert.equal(form.stepMismatch,false,'invoice-calendar-ui:form-no-step-block');assert.equal(form.valid,true,'invoice-calendar-ui:form-valid');assert.equal(form.category,paymentBefore.category,'invoice-calendar-ui:form-category-kept');assert.match(form.text,/\(USD\)/,'invoice-calendar-ui:form-unit');
  await page.$eval('[data-calendar-notes]',e=>{e.value='NATIVE_DECIMAL_NOTE_ONLY';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.$eval('[data-calendar-payment-form] button[type="submit"]',e=>e.click());await wait(()=>!document.querySelector('[data-calendar-payment-form]'),[],'native-save');
  const paymentAfter=(await linked(invoiceId))[0];assert.equal(paymentAfter.notes,'NATIVE_DECIMAL_NOTE_ONLY','invoice-calendar-ui:native-save-observed');
  for(const field of ['amount','currency','category','type','status'])assert.equal(paymentAfter[field],paymentBefore[field],'invoice-calendar-ui:native-keeps-'+field);
  assert.deepEqual(paymentAfter.invoiceLink,paymentBefore.invoiceLink,'invoice-calendar-ui:native-keeps-link-snapshot');
  // 5. Await the real store action so the check cannot race a later ledger POST after the status PUT.
  const beforeComplete=await ledgerRows();
  await page.evaluate(async id=>{const store=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar');store.payments.find(p=>p.id===id).currency='JPY';await store.markAsCompleted(id)},paymentId);
  assert.deepEqual(await ledgerRows(),beforeComplete,'invoice-calendar-ui:foreign-complete-no-ledger');
  const completedForeign=(await linked(invoiceId))[0];assert.equal(completedForeign.status,'paid','invoice-calendar-ui:foreign-status-completed');assert.equal(completedForeign.currency,'USD');assert.equal(completedForeign.amount,125.5);assert.deepEqual(completedForeign.invoiceLink,paymentBefore.invoiceLink);
  const notice=await page.$eval('[data-calendar-currency-notice]',e=>e.textContent);assert.match(notice,/円|엔화/,'invoice-calendar-ui:currency-notice');assert.ok(await page.$('[data-calendar-currency-notice] a[href="/transactions"]'),'invoice-calendar-ui:ledger-next-lane');
  await page.evaluate(async id=>{const store=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar');const held=store.payments.find(p=>p.id===id);held.currency='USD';held.amount=0.01;await store.markAsCompleted(id)},jpyPaymentId);
  const afterJpy=await ledgerRows();assert.equal(afterJpy.length,beforeComplete.length+1,'invoice-calendar-ui:jpy-still-posts');const jpyLedger=afterJpy.find(p=>p.referenceNumber==='PAY-'+jpyPaymentId);assert.ok(jpyLedger,'invoice-calendar-ui:jpy-post-reference');assert.equal(jpyLedger.amount,12760);assert.equal(jpyLedger.type,'入金');assert.equal(jpyLedger.status,'completed');
  assert.deepEqual(scheduleRequests,[],'invoice-calendar-ui:browser-sends-no-schedule');
  await page.setViewport({width:1280,height:900});await pause(300);assert.equal(await overflow(),false,'invoice-calendar-ui:desktop-overflow');
  const screenshots=process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS;if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'invoice-calendar-desktop.png')})}
  assert.deepEqual(dialogs,[],'invoice-calendar-ui:no-script-dialogs');assert.deepEqual(errors,[],'invoice-calendar-ui:console-errors');
  pass('real installed Chrome: Navi schedule/repeat, persisted receipts, kept buffer; USD125.50 and separate USD/JPY totals; native notes-only edit preserves money/link; non-JPY completion uses server echo and writes no ledger, explicitJPY control posts exactly once; no overflow at390or1280');
 }catch(e){if(page&&process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS){await fs.mkdir(process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.OMF_INVOICE_CALENDAR_SCREENSHOTS,'failure.png')}).catch(()=>{})}throw e}
 finally{if(browser)await browser.close();const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('omf-invoice-calendar-ui-'));await fs.rm(resolved,{recursive:true,force:true})}
};

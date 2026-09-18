const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
module.exports=async({origin,pass})=>{
 const {browserApi}=await import(pathToFileURL(path.resolve('research-worker/sheets.mjs'))),{connectSheetBrowser}=await import(pathToFileURL(path.resolve('research-worker/sheet-export.mjs')));
 const profile='omf-workflow-ui-test',opened=await browserApi('open',{url:origin+'/login',profile,wait_for_cf:false});let browser,page;
 try {
  browser=await connectSheetBrowser(profile);page=(await browser.pages()).find(p=>p.url().startsWith(origin+'/'));assert(page);
  await page.setViewport({width:1440,height:1000});await page.evaluate(()=>localStorage.setItem('theme','light'));await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/purchase-workflow',{waitUntil:'networkidle2'});await page.waitForSelector('[data-workflow-row]');
  assert.equal(await page.$eval('[data-workflow-page] .card',el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.$eval('[data-workflow-page] section details',e=>e.open=true);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/finance-workflow/settings')&&r.request().method()==='PUT');
  await page.$eval('[data-workflow-page] section form button[type="submit"], [data-workflow-page] section form button',e=>e.click());assert.equal((await saved).status(),200);
  const panel=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-workflow-row]')].find(e=>e.textContent.includes('Synthetic offline investigation')));assert(panel);
  await panel.evaluate(e=>e.querySelector('[data-workflow-investigation] button').click());
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-workflow-investigation]')].some(e=>e.textContent.includes('Synthetic offline proposal.')));
  assert(await panel.evaluate(e=>e.textContent.includes('店舗購入・領収書')));
  assert.equal(await panel.evaluate(e=>[...e.querySelectorAll('button')].some(b=>b.textContent==='この購入との対応を確認')),false);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});
  await page.setViewport({width:390,height:844});await panel.evaluate(e=>e.scrollIntoView());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT});
  assert.deepEqual(errors,[]);
  pass('real Chrome: workflow settings save, receipt review renders in the existing light design, desktop/mobile layouts fit');
 } finally {try{await browser?.disconnect()}finally{await browserApi('close',{session_id:opened.session_id}).catch(()=>{})}}
};

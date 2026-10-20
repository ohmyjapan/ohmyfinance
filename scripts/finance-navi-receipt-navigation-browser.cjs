// Owned native app and installed Chrome only. Worker result is synthetic; no model or production calls.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({root,origin,A,B,receiptIds,candidates,worker,pause,pass})=>{
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-receipt-navigation-'));
 const screenshots=process.env.OMF_RECEIPT_NAV_SCREENSHOTS,errors=[];let browser,page,held=null,holdNext=false;
 const ownId=String(receiptIds[0]),wait=async(fn,args=[],name='condition')=>{for(let i=0;i<200;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('receipt-ui:'+name)};
 const push=to=>page.evaluate(to=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to),to);
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{
  const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');
  const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),session=await r.json();if(!r.ok)throw Error('Synthetic switch failed');
  const profile=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.tokens.accessToken}});if(!profile.ok)throw Error('Synthetic profile failed');
  user.acceptSession({...await profile.json(),tokens:session.tokens},false);
 },String(organizationId));
 const capture=async name=>{if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true})}};
 try{
  assert.ok(executablePath,'Installed Chrome is required');
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{errors.push(d.message());d.dismiss().catch(()=>{})});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','business-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/receipts/'+ownId,{waitUntil:'networkidle2'});
  await wait(()=>document.querySelectorAll('[data-receipt-candidate]').length===4,[],'actual-evidence');
  assert.match(await page.$eval('[data-receipt-summary]',e=>e.textContent),/67,000/,'receipt-ui:actual-amount');
  const text=await page.$eval('[data-receipt-evidence-page]',e=>e.textContent);
  assert.ok(text.includes('USD')||text.includes('$'),'receipt-ui:actual-usd');assert.ok(text.includes('通貨未記録'),'receipt-ui:unknown-currency');assert.ok(!text.includes('PRIVATE_'),'receipt-ui:private-fields');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'receipt-ui:mobile-overflow');await capture('receipt-mobile');
  await page.click('[data-receipt-discuss]');await worker('heartbeat');
  await wait(()=>document.querySelector('#assistant-message')?.disabled===false,[],'composer');
  await page.$eval('#assistant-message',e=>{e.value='この領収書の候補を確認して、領収書を開くリンクをください。保存しないで。';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.click('[data-assistant-send]');
  await wait(()=>document.querySelector('#assistant-message')?.value==='',[],'accepted');
  await worker('heartbeat');const claimed=await worker('workspace-claim'),job=claimed.data.job;assert.ok(job,'receipt-ui:actual-job');
  assert.equal(job.context.facts.selection.receiptId,ownId,'receipt-ui:selected-context');
  const result=await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic selected receipt evidence is ready.',patch:{},quotes:{},navigation:{feature:'receipts',receiptId:ownId}}});assert.equal(result.status,200);
  const selector='[data-assistant-navigation][href="/receipts/'+ownId+'"]';
  await wait(selector=>!!document.querySelector(selector),[selector],'navigation-button');
  await push('/transactions');await wait(()=>location.pathname==='/transactions',[],'leave-receipt');
  await page.evaluate(selector=>document.querySelector(selector).click(),selector);
  await wait(ownId=>location.pathname==='/receipts/'+ownId&&document.querySelectorAll('[data-receipt-candidate]').length===4,[ownId],'record-link-click');
  await page.click('[data-assistant-close]');
  const candidateSelector='[data-receipt-candidate-link][href="/transactions/'+candidates[0]._id+'"]';
  await page.evaluate(selector=>document.querySelector(selector).click(),candidateSelector);
  await wait(id=>location.pathname==='/transactions/'+id,[String(candidates[0]._id)],'candidate-link');
  await push('/receipts/'+ownId);await wait(()=>document.querySelectorAll('[data-receipt-candidate]').length===4,[],'back-to-evidence');
  await page.setViewport({width:1365,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'receipt-ui:desktop-overflow');await capture('receipt-desktop');
  pass('installed Chrome: actual receipt evidence at390/1365, real selected-context message and accepted Navi receipt/candidate link clicks');

  await page.setRequestInterception(true);
  page.on('request',request=>{(async()=>{
   if(holdNext&&request.url()===origin+'/api/receipts/'+ownId+'/evidence'){
    holdNext=false;const response=await fetch(request.url(),{headers:request.headers()});held={request,status:response.status,body:await response.text()};return;
   }
   await request.continue();
  })().catch(e=>errors.push(String(e)))});
  holdNext=true;await page.reload({waitUntil:'domcontentloaded'});
  for(let i=0;i<100&&!held;i++)await pause(100);assert.ok(held,'receipt-ui:late-read-held');assert.equal(held.status,200,'receipt-ui:real-native-held-read');
  await nativeSwitch(B);await wait(()=>!!document.querySelector('[data-receipt-error]')&&!document.querySelector('[data-receipt-summary]'),[],'switched-company-cleared');
  await held.request.respond({status:held.status,contentType:'application/json',body:held.body});held=null;await pause(200);
  assert.equal(await page.$('[data-receipt-summary]'),null,'receipt-ui:late-company-response-discarded');
  await nativeSwitch(A);await wait(()=>document.querySelectorAll('[data-receipt-candidate]').length===4,[],'switch-back');
  await push('/receipts/'+receiptIds[3]);await wait(()=>document.querySelector('[data-receipt-candidates]')?.textContent.includes('候補は見つかりませんでした'),[],'empty');
  await push('/receipts/not-an-id');await wait(()=>!!document.querySelector('[data-receipt-error]'),[],'invalid-id');
  assert.deepEqual(errors,[],'receipt-ui:no-page-errors');
  pass('installed Chrome: cross-company change clears evidence and discards an actual late read, switch-back/empty/invalid record stay usable');
 }catch(e){if(page)await capture('failure').catch(()=>{});throw e}
 finally{
  if(held)await held.request.respond({status:held.status,contentType:'application/json',body:held.body}).catch(()=>{});
  if(browser)await browser.close();
  const target=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(target.startsWith(temp+path.sep)&&path.basename(target).startsWith('omf-receipt-navigation-'));await fs.rm(target,{recursive:true,force:true});
 }
};

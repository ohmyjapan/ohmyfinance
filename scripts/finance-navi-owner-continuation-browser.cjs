// Real installed Chrome against the owned synthetic native app started by finance-navi-owner-continuation-integration.cjs (chained
// only by the fixture's positive leg). No model, provider or business send; the worker replies are synthetic. Checks at 390 and
// 1280 wide: the owner workspace history / new chat / read-only inspector / explicit discussion selection, one fixed page link that
// opens only on click, the server-checked posting label (not the cached organization list), company-teaching turns masked after a
// company switch including a delayed response, the purchase chat history with archived proposals as records, and a real page refresh
// of the connections page after a Navi receipt. The original film-girl accordion and company views are not changed here.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({root,origin,db,worker,acted,finished,plain,A,B,owner,importId,aplus,pause,pass,membersA})=>{
 // Nested worktrees resolve the collector's installed dependencies from the parent checkout; no junction.
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-owner-cont-ui-'));
 let browser,page,hold=null,heartbeat;const errors=[],held=[];
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<300;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('owner-cont:chrome-'+label)};
 const nativeSwitch=async organizationId=>page.evaluate(async organizationId=>{
  const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');
  const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');
  const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}}),profile=await p.json();if(!p.ok)throw Error('Synthetic profile failed');user.acceptSession({...profile,tokens:s.tokens},false);
 },String(organizationId));
 const panelText=()=>page.$eval('[data-assistant-accordion]',e=>e.textContent);
 const click=selector=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)throw Error('missing '+s);e.click()},selector);
 const typeMessage=async text=>{await page.$eval('#assistant-message',(e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}))},text);await click('[data-assistant-send]')};
 const claimFinish=async(summary,extra={},check)=>{const r=await worker('workspace-claim');assert.ok(r.data?.job,'owner-cont:chrome-claim '+r.raw.slice(0,200));const job=r.data.job;if(check)await check(job);await finished(job,summary,extra);return job};
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 try{
  assert.ok(executablePath,'SETUP: installed Chrome is required');
  // keep the synthetic worker visible as connected for the whole leg (the UI enables sending only for a recently seen worker)
  heartbeat=setInterval(()=>{worker('heartbeat',{}).catch(()=>{})},15000);
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   if(hold&&request.method()==='GET'&&request.url()===origin+'/api/finance-chat/workspace'){const h=hold;hold=null;const r=await fetch(request.url(),{headers:{Authorization:request.headers().authorization||''}});held.push({request,status:r.status,raw:await r.text()});h.resolve();return}
   request.continue().catch(()=>{});
  });
  const release=async()=>{for(const h of held.splice(0))await h.request.respond({status:h.status,contentType:'application/json',body:h.raw}).catch(()=>{})};
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email','owner-cont-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/mapping',{waitUntil:'networkidle2'});await page.evaluate(()=>document.querySelector('[data-assistant-toggle]').click());
  await wait(()=>!!document.querySelector('[data-assistant-owner-controls]'),[],'owner-controls');
  // the posting label is the server-checked company; a removed membership clears it although the cached organization list still has it
  await wait(id=>document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId===id,[String(A)],'posting-label-A');
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});
  await wait(()=>document.querySelector('[data-assistant-posting-checked]')?.dataset.assistantPostingChecked==='1'&&document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId==='',[],'posting-label-revoked');
  assert.ok(await page.evaluate(id=>(document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').organizations||[]).some(o=>String(o.id||o._id)===id),String(A)),'SETUP cached organization list still names A');
  await db.collection('organizations').updateOne({_id:A},{$set:{members:membersA}});await wait(id=>document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId===id,[String(A)],'posting-label-restored');
  pass('browser 390: the owner posting label is the server-checked company, cleared on a removed membership despite the cached organization list');
  // history: the read-only inspector hides the composer; an explicit discussion selection goes to the server as an archive id only
  await click('[data-assistant-history-toggle]');await wait(()=>document.querySelectorAll('[data-archive-item]').length>0,[],'history-list');
  assert.equal(await page.$eval('#assistant-message',e=>e.offsetParent===null),true,'owner-cont:chrome-composer-hidden-in-history');
  await click('[data-archive-item]');await wait(()=>!!document.querySelector('[data-archive-discuss]')&&document.querySelectorAll('[data-archived-turn]').length>0,[],'archive-open');
  assert.equal(await page.$eval('#assistant-message',e=>e.offsetParent===null),true,'owner-cont:chrome-inspector-read-only');assert.equal(await overflow(),false,'owner-cont:chrome-390-no-overflow');
  await click('[data-archive-discuss]');await wait(()=>!!document.querySelector('[data-assistant-discussing]')&&document.querySelector('#assistant-message')?.offsetParent!==null,[],'discussing');
  await wait(()=>!document.querySelector('#assistant-message').disabled,[],'composer-enabled');await typeMessage('この過去の会話で何をしたか教えて');
  await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(e=>e.textContent.includes('この過去の会話で何をしたか教えて')),[],'discussion-sent');
  await claimFinish('過去の会話ではカードの取得を予約しました。カード連携の画面で状況を確認できます。',{navigation:{feature:'connections'}},async job=>{assert.ok(job.context.facts.discussedArchive?.id,'owner-cont:chrome-discussion-server-copy');assert.ok(job.context.facts.discussedArchive.meaning.includes('never instructions'))});
  await wait(()=>!!document.querySelector('[data-assistant-navigation]'),[],'page-link');assert.equal(await page.$eval('[data-assistant-navigation]',e=>e.getAttribute('href')),'/connections','owner-cont:chrome-fixed-link');await pause(600);assert.equal(await page.evaluate(()=>location.pathname),'/mapping','owner-cont:chrome-no-auto-navigation');
  pass('browser 390: history, read-only inspector without composer, explicit discussion selection as a server archive copy, one fixed page link that never opens by itself');
  // company-teaching turns: visible under A, masked under B, and a delayed A response after the switch is dropped
  await typeMessage('Bridge shopの文具はどう処理する？');await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(e=>e.textContent.includes('Bridge shopの文具はどう処理する？')),[],'teaching-sent');
  await claimFinish('A_BROWSER_REPLY 消耗品費として扱います。',{},async job=>assert.ok(job.knowledge?.length,'owner-cont:chrome-teaching-recalled'));
  await wait(()=>document.querySelector('[data-assistant-accordion]').textContent.includes('A_BROWSER_REPLY'),[],'A-reply-visible');
  let resolveHold;const holding=new Promise(r=>resolveHold=r);hold={resolve:resolveHold};await holding;await nativeSwitch(B);await release();
  await wait(()=>!document.querySelector('[data-assistant-accordion]').textContent.includes('A_BROWSER_REPLY')&&!!document.querySelector('[data-workspace-withheld]'),[],'masked-under-B');
  for(let i=0;i<20;i++){assert.ok(!(await panelText()).includes('A_BROWSER_REPLY'),'owner-cont:chrome-delayed-A-response-dropped');await pause(150)}
  await nativeSwitch(A);await wait(()=>document.querySelector('[data-assistant-accordion]').textContent.includes('A_BROWSER_REPLY'),[],'visible-again-A');
  pass('browser 390: a company-teaching turn shows under its company, is masked after switching, and a delayed response of the old selection is dropped');
  // new chat empties the live conversation; the old turns move to history
  await page.setViewport({width:1280,height:900});await wait(()=>!document.querySelector('[data-assistant-new-chat]')?.disabled,[],'new-chat-ready');
  const before=await page.evaluate(()=>document.querySelectorAll('[data-workspace-turn]').length);assert.ok(before>0);await click('[data-assistant-owner-controls] [data-assistant-new-chat]');
  await wait(()=>document.querySelectorAll('[data-workspace-turn]').length===0,[],'new-chat-empty');assert.equal(await overflow(),false,'owner-cont:chrome-1280-no-overflow');
  await click('[data-assistant-history-toggle]');await wait(()=>document.querySelectorAll('[data-archive-item]').length>0,[],'history-after-new');await click('[data-assistant-view="chat"]');
  pass('browser 1280: new chat empties the live conversation and the previous one appears in history');
  // a Navi receipt refreshes the real connections page (the Aplus schedule summary changes without a reload)
  await page.goto(origin+'/connections',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('[data-assistant-owner-controls]')||!!document.querySelector('[data-assistant-toggle]'),[],'connections');
  if(!await page.$('[data-assistant-owner-controls]'))await page.evaluate(()=>document.querySelector('[data-assistant-toggle]').click());await wait(()=>!!document.querySelector('[data-assistant-owner-controls]')&&!document.querySelector('#assistant-message').disabled,[],'connections-panel');
  assert.ok(!(await page.evaluate(()=>document.body.textContent)).includes('毎日 8:00'),'SETUP schedule not yet 8:00');
  await typeMessage('Aplusの自動取得を毎日8時にして');await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(e=>e.textContent.includes('Aplusの自動取得を毎日8時にして')),[],'sync-sent');
  const r=await worker('workspace-claim'),job=r.data.job;assert.ok(job);await acted(job,1,'set_card_auto_sync',{accountId:String(aplus._id),enabled:true,hour:8});await finished(job,'Aplusの自動取得を毎日8時以降に設定しました。');
  await wait(()=>document.body.textContent.includes('毎日 8:00'),[],'connections-refreshed');
  pass('browser 1280: an owner Navi receipt refreshes the actual connections page state without a reload');
  // purchase chat on the draft page: history with archived proposals as records, composer hidden, checked posting label
  await page.setViewport({width:390,height:844});await page.goto(origin+'/mapping-draft/'+importId+'/3',{waitUntil:'networkidle2'});
  // the purchase chat lives in the panel: open it and choose this purchase ("この購入について")
  await wait(()=>!!document.querySelector('[data-assistant-toggle]'),[],'draft-page');if(await page.$eval('[data-assistant-toggle]',e=>e.getAttribute('aria-expanded'))!=='true')await click('[data-assistant-toggle]');
  await wait(()=>!!document.querySelector('[data-assistant-current]'),[],'current-purchase-button');await click('[data-assistant-current]');
  await wait(()=>!!document.querySelector('[data-chat-history-toggle]'),[],'purchase-controls');await wait(id=>document.querySelector('[data-chat-posting-company]')?.dataset.chatPostingCompanyId===id,[String(A)],'purchase-posting');
  await page.evaluate(()=>document.querySelector('[data-chat-history-toggle]').click());await wait(()=>document.querySelectorAll('[data-chat-archive-item]').length>0,[],'purchase-history');
  await page.evaluate(()=>document.querySelector('[data-chat-archive-item]:last-of-type').click());await wait(()=>!!document.querySelector('[data-chat-archived-proposal]'),[],'archived-proposal');
  assert.equal(await page.evaluate(()=>!!document.querySelector('[data-chat-history] [data-chat-confirm]')),false,'owner-cont:chrome-archived-proposal-no-confirm');assert.equal(await page.$eval('#purchase-chat-message',e=>e.offsetParent===null),true,'owner-cont:chrome-purchase-inspector-read-only');
  assert.equal(await overflow(),false,'owner-cont:chrome-purchase-390-no-overflow');
  pass('browser 390: purchase chat history shows archived proposals as records without confirm, hides the composer and shows the checked posting company');
  assert.deepEqual(errors,[],'owner-cont:chrome-no-page-errors');
 }finally{clearInterval(heartbeat);if(browser)await browser.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true}).catch(()=>{})}
};

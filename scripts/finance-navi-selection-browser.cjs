'use strict';
// Saved-record consultation in actual installed Google Chrome (headless, own temporary profile) against the owned native app of
// scripts/finance-navi-selection-integration.cjs. Activation is a real touch tap at 390 px, a real Tab and Enter at 768 px and a real
// mouse click at 1365 px; another tab of the same origin switches company through its own store (Chrome delivers the storage event to
// this tab); a lost reply is a real request the test forwards to the server itself before failing the browser's copy; a slow poll is a
// held real request. Worker claims and replies are simulated through the native worker routes. Labels starting with gui: name the
// behaviour a defect must break; SETUP is preparation. Store state is read only where the pointer itself is the subject (the newer
// publisher). Each group starts from a fresh navigation and owns its records.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
const root=path.resolve(__dirname,'..');let preparedBrowser;
function prepareBrowser(){
 if(preparedBrowser)return preparedBrowser;
 try{preparedBrowser=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;preparedBrowser=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 return preparedBrowser;
}
const GUI=['gui-consult','gui-lifecycle','gui-view','gui-delete','gui-missing','gui-pending','gui-received'];
module.exports=async ctx=>{
 const {origin,call,ok,register,company,switchTo,card,workerOf,beat,claim,answered,act,send,conversation,invoice,budget,recurring,payment,issuerBill,localDay,pause,hex32,pass,seen,wants,group,orgs,member,COMPANY,timing,SETUP_READY_MS,db}=ctx;
 if(!GUI.some(wants))return;
 const puppeteer=prepareBrowser();
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 assert.ok(executablePath,'SETUP installed Chrome');
 const shots=process.env.OMF_NAVI_SELECTION_SCREENSHOTS;let directory,browser,page,keepAlive,dialogAnswer='accept',failure=null;const errors=[],writes=[];
 const shot=async name=>{if(shots){await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,name+'.png'),captureBeyondViewport:false})}};
 // People: G owns companies GA and GB; M is another member of GA (who removes a record G has selected).
 const G=await register('gui','Synthetic selection GUI owner'),M=await register('gui-member','Synthetic selection GUI member');
 const GA=await company('gui-a','Synthetic selection GUI A',[]),GB=await company('gui-b','Synthetic selection GUI B',[]);
 await orgs.updateOne({_id:GA},{$set:{members:[member(G,'owner'),member(M,'member')]}});await orgs.updateOne({_id:GB},{$set:{members:[member(G,'owner')]}});
 const WG=await workerOf(G,[await card(G,'91111')],{workspaceEnabled:true});await beat(WG);
 // SETUP fresh native tokens for each group (an access token lives 30 minutes; a slow host can run longer).
 const renew=async u=>{const r=await ok('/api/auth/login',null,'POST',{email:u.email,password:u.password});u.token=r.tokens.accessToken};
 const tokens=async()=>{await renew(G);await renew(M);return{ga:await switchTo(G,GA),gb:await switchTo(G,GB),ma:await switchTo(M,GA)}};
 const until=async(probe,label,ms=20000,describe=null)=>{const end=Date.now()+ms;let last;for(;;){const v=await probe();if(v)return v;if(Date.now()>end)assert.fail(label+' (timed out after '+ms+' ms)'+(describe?' last '+await describe():''));await pause(200)}};
 const waitFor=(fn,args,label,ms=20000)=>until(()=>page.evaluate(fn,...args),label,ms);
 // What a person sees of Navi: open state, view, the selected-record label and its clear action, composer, send label, error, pinned evidence.
 const naviOf=p=>p.evaluate(()=>{const q=s=>document.querySelector(s),t=q('[data-assistant-toggle]'),panel=q('#omf-assistant'),log=panel?.querySelector('[role=log]'),shown=e=>!!e&&e.getClientRects().length>0;
  const view=panel?.querySelector('[data-assistant-history]')?'history':panel?.querySelector('[data-assistant-knowledge]')?'knowledge':shown(log)?'chat':null;
  const chip=panel?.querySelector('[data-assistant-selection]'),button=panel?.querySelector('[data-assistant-send]'),alert=panel?.querySelector('form [role=alert]'),composer=panel?.querySelector('#assistant-message'),pinned=panel?.querySelector('[data-assistant-pinned]');
  return{open:t?.getAttribute('aria-expanded')==='true',view,chip:chip?chip.textContent.trim():null,clear:!!panel?.querySelector('[data-assistant-selection-clear]'),send:button?button.textContent.trim():null,sendDisabled:!!button?.disabled,error:alert?alert.textContent.trim():'',composer:shown(composer)?composer.value:null,composerDisabled:!!composer?.disabled,pinned:pinned?pinned.textContent.trim():null,focusInPanel:!!panel&&panel.contains(document.activeElement),company:panel?.querySelector('[data-assistant-company-status]')?.textContent.trim()||''}});
 const navi=()=>naviOf(page);
 // SETUP a Navi control is pressed once it is rendered and visible (a conversation that just mounted shows its view controls after its
 // first read); the press itself is a real click.
 const press=async selector=>{await page.waitForSelector(selector,{visible:true,timeout:20000});await page.click(selector)};
 const describeNavi=async()=>JSON.stringify(await navi().catch(e=>String(e)));
 const pointer=()=>page.evaluate(()=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').pageSelection;return s?JSON.parse(JSON.stringify(s)):null});
 const consultOf=(kind,id,within='')=>(within?within+' ':'')+'[data-navi-consult="'+kind+'"][data-navi-consult-id="'+id+'"]';
 const visit=async route=>{await page.goto(origin+route,{waitUntil:'networkidle2',timeout:SETUP_READY_MS});await waitFor(()=>!!document.querySelector('[data-assistant-toggle]'),[],'SETUP page '+route,SETUP_READY_MS)};
 const push=route=>page.evaluate(route=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(route),route);
 const openNavi=async()=>{if(!(await navi()).open)await page.click('[data-assistant-toggle]');await waitFor(()=>document.querySelector('#omf-assistant')?.getBoundingClientRect().width>0,[],'SETUP Navi open')};
 const closeNavi=async()=>{if((await navi()).open)await press('#omf-assistant [data-assistant-close]');await waitFor(()=>document.querySelector('[data-assistant-toggle]')?.getAttribute('aria-expanded')==='false',[],'SETUP Navi closed')};
 // The browser session's company through the native switch and profile (the store's own acceptSession; a page load follows).
 const adopt=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})});if(!r.ok)throw Error('Synthetic company switch '+r.status);const s=await r.json();const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});if(!p.ok)throw Error('Synthetic company profile');user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(organizationId));
 const viewport=async vp=>{await page.setViewport({width:vp.width,height:vp.height,isMobile:!!vp.isMobile,hasTouch:!!vp.hasTouch});await pause(200)};
 // A consultation action as a person meets it: scrolled into view, its effective opacity (ancestors included, so a hover-only group
 // fails), the element actually hit at its centre, size, name and the native small-button style.
 const shown=selector=>page.evaluate(selector=>{const e=document.querySelector(selector);if(!e)return{exists:false};e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),s=getComputedStyle(e),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);let opacity=1;for(let p=e;p&&p.nodeType===1;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
  return{exists:true,tag:e.tagName,width:Math.round(r.width),height:Math.round(r.height),inViewport:r.left>=0&&r.right<=innerWidth+0.5&&r.top>=0&&r.bottom<=innerHeight+0.5,opacity,visibility:s.visibility,hit:!!hit&&(hit===e||e.contains(hit)),hitBy:hit?hit.tagName+'.'+String(hit.className).slice(0,60):null,disabled:e.disabled||e.getAttribute('aria-disabled')==='true',name:e.getAttribute('aria-label')||'',text:e.textContent.trim(),fontSize:s.fontSize,radius:s.borderRadius}},selector);
 let lastActivation=null;
 const activate=async(selector,mode)=>{
  // SETUP the action is present when used (a list that is reloading re-renders its rows for a moment).
  let box=null;for(let i=0;i<40&&!box;i++){box=await page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),v=window.visualViewport,x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,hit:hit?hit.tagName+'.'+String(hit.className).slice(0,30):null,scale:v?.scale,offsetLeft:v?.offsetLeft,offsetTop:v?.offsetTop,scrollWidth:document.documentElement.scrollWidth,innerWidth}},selector);if(!box)await pause(250)}
  if(!box){await shot('missing-action-'+Date.now()).catch(()=>{});assert.fail('SETUP consultation action present '+selector+' '+await scene())}
  lastActivation={selector,mode,...box};
  // A touch lands in the visual viewport (a mobile page can be scrolled within a wider layout viewport); element boxes are layout ones.
  if(mode==='tap'){await page.touchscreen.tap((box.x-(box.offsetLeft||0))*(box.scale||1),(box.y-(box.offsetTop||0))*(box.scale||1));return}
  if(mode==='mouse'){await page.mouse.click(box.x,box.y);return}
  // Keyboard: the focusable element just before the action in document order, then a real Tab to the action and a real Enter.
  await page.evaluate(selector=>{const target=document.querySelector(selector),all=[...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),i=all.indexOf(target);if(i<1)throw Error('SETUP no focusable element before the action');all[i-1].focus({preventScroll:false})},selector);
  await page.keyboard.press('Tab');
  const focused=await page.evaluate(selector=>{const e=document.querySelector(selector);return{active:document.activeElement===e,visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle}},selector);
  assert.ok(focused.active,'gui:keyboard-reachable '+selector);assert.ok(focused.visible&&focused.outline!=='none','gui:keyboard-focus-visible '+JSON.stringify(focused));
  await page.keyboard.press('Enter')};
 // The page around a failed expectation (diagnosis only: what had focus, which consultation actions exist); a screenshot when kept.
 const scene=async()=>{const s=await page.evaluate(()=>{const a=document.activeElement;return{path:location.pathname,active:a?a.tagName+(a.getAttribute('data-navi-consult')?'[consult '+a.getAttribute('data-navi-consult-id')+']':'')+'.'+String(a.className).slice(0,40):null,actions:[...document.querySelectorAll('[data-navi-consult]')].map(e=>e.getAttribute('data-navi-consult')+':'+e.getAttribute('data-navi-consult-id').slice(-6)+(e.getAttribute('aria-disabled')?'(disabled)':'')).slice(0,12),pointer:JSON.parse(JSON.stringify(document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').pageSelection||null))}}).catch(e=>String(e));await shot('failure-'+Date.now()).catch(()=>{});return JSON.stringify({navi:await navi().catch(e=>String(e)),page:s,lastActivation})};
 const chip=(text,label='gui:consult-opens-with-label')=>until(async()=>{const n=await navi();return n.open&&n.chip?.includes(text)?n:null},label+' '+text,20000,scene);
 const setComposer=async text=>{await until(async()=>{const n=await navi();return n.composer!==null&&!n.composerDisabled},'SETUP composer ready',30000,describeNavi);await page.$eval('#assistant-message',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))},text)};
 const turnsWith=async(org,text)=>((await conversation(G,org))?.turns||[]).filter(t=>t.text===text).length;
 // A person types a question and sends it: accepted (stored once) and acknowledged in the composer. A press that met a send button the
 // latest conversation read had just disabled is pressed again once it is enabled (the same pending request, never a second one).
 const say=async(text,org=GA)=>{await beat(WG);await setComposer(text);const end=Date.now()+30000;
  while(await turnsWith(org,text)===0){assert.ok(Date.now()<end,'SETUP message accepted '+text+' '+await describeNavi());const n=await navi();if(!n.sendDisabled)await press('#omf-assistant [data-assistant-send]');await until(async()=>await turnsWith(org,text)>0||!(await navi()).sendDisabled,'SETUP send settled',30000,describeNavi);if(await turnsWith(org,text)===0)await pause(1500)}
  assert.equal(await turnsWith(org,text),1,'SETUP message stored once '+text);await until(async()=>(await navi()).composer==='','SETUP composer acknowledged',30000,describeNavi)};
 const consultedJob=async(expected,label)=>{const job=await claim(WG,'SETUP gui claim');assert.deepEqual({...job.target},expected,label+' '+JSON.stringify(job.target));await answered(WG,job,'GUI synthetic reply');return job};
 const openDay=async day=>{const box=await page.$eval('[data-calendar-day="'+day+'"] span',e=>{e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}});await page.mouse.click(box.x,box.y);await waitFor(()=>!!document.querySelector('[data-calendar-day-detail]'),[],'SETUP day detail open')};
 const rowButton=async(consultSelector,index)=>{const handle=await page.evaluateHandle((s,i)=>document.querySelector(s)?.closest('tr')?.querySelectorAll('td:last-child button')[i],consultSelector,index);const el=handle.asElement();assert.ok(el,'SETUP row action '+index);await page.hover(consultSelector);return el};
 const login=async()=>{await page.goto(origin+'/login',{waitUntil:'networkidle2',timeout:SETUP_READY_MS});await page.waitForSelector('#email',{visible:true,timeout:SETUP_READY_MS});await page.type('#email',G.email);await page.type('#password',G.password);await page.$eval('button[type=submit]',e=>e.click());await waitFor(()=>location.pathname==='/'&&!!document.querySelector('[data-assistant-toggle]'),[],'SETUP login',SETUP_READY_MS)};
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-navi-selection-chrome-'));
  let started=Date.now();
  browser=await puppeteer.launch({executablePath,headless:true,pipe:true,timeout:SETUP_READY_MS,userDataDir:path.join(directory,'profile'),args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{(dialogAnswer==='accept'?d.accept():d.dismiss()).catch(()=>{})});
  page.on('request',r=>{try{const u=new URL(r.url());if(['POST','PUT','PATCH','DELETE'].includes(r.method())&&/^\/api\/(invoices|budgets|recurring|payments)(\/|$)/.test(u.pathname))writes.push({method:r.method(),path:u.pathname,at:Date.now()})}catch{}});
  await page.setViewport({width:1365,height:900});timing.chromeMs=Date.now()-started;
  keepAlive=setInterval(()=>{beat(WG).catch(()=>{})},20000);
  started=Date.now();await login();timing.loginMs=Date.now()-started;console.log('TIMING '+JSON.stringify(timing));

  // 2. Four saved-record consultations (invoice, budget, recurring payment, calendar upcoming and day-detail entries) at 390 (touch),
  //    768 (keyboard) and 1365 (mouse): the action is visible without hover, reachable and named; it opens Navi with the record's label
  //    and a clear action, focuses the rail, writes no record, closes only the read-only day modal, and the sent turn's claimed job has
  //    exactly that saved record as its target. The closed status and exact read state of a consulted reply still work.
  await group('gui-consult',async()=>{
   const t=await tokens();
   // Ordinary breakable names (a single unbreakable synthetic word would widen these existing rows by itself at 390 px).
   const inv=await invoice(t.ga,'SEL-GUI-INV-1'),bud=await budget(t.ga,'SELECTION GUI BUDGET'),rec=await recurring(t.ga,'SELECTION GUI RECURRING'),pay=await payment(t.ga,'SELECTION GUI PAYMENT'),day=await payment(t.ga,'SELECTION GUI DAY');
   await viewport({width:1365,height:900});await adopt(GA);
   const specs=[
    {name:'invoice',route:'/invoices',kind:'invoice',id:inv,text:'SEL-GUI-INV-1',target:{page:'invoices',invoiceId:inv}},
    {name:'budget',route:'/budgets',kind:'budget',id:bud,text:'SELECTION GUI BUDGET',target:{page:'budgets',budgetId:bud}},
    {name:'recurring',route:'/recurring',kind:'recurring',id:rec,text:'SELECTION GUI RECURRING',target:{page:'recurring',recurringPaymentId:rec}},
    {name:'upcoming',route:'/calendar',kind:'payment',id:pay,text:'SELECTION GUI PAYMENT',within:'[data-calendar-upcoming="'+pay+'"]',target:{page:'calendar',paymentId:pay}},
    {name:'day-detail',route:'/calendar',kind:'payment',id:day,text:'SELECTION GUI DAY',within:'[data-calendar-day-detail]',day:true,target:{page:'calendar',paymentId:day}}];
   for(const vp of[{width:390,height:844,isMobile:true,hasTouch:true,mode:'tap'},{width:768,height:1024,mode:'keyboard'},{width:1365,height:900,mode:'mouse'}]){
    await viewport(vp);
    for(const spec of specs){
     const where=spec.name+' '+vp.width;await visit(spec.route);await closeNavi();
     if(spec.day)await openDay(localDay());
     const selector=consultOf(spec.kind,spec.id,spec.within);
     await waitFor(s=>!!document.querySelector(s),[selector],'gui:consult-action '+where);
     await page.mouse.move(1,1);await pause(300);
     const v=await shown(selector);
     assert.ok(v.exists&&v.tag==='BUTTON'&&!v.disabled,'gui:consult-action '+where+' '+JSON.stringify(v));
     assert.ok(v.inViewport&&v.hit&&v.opacity===1&&v.visibility==='visible','gui:consult-visible-without-hover '+where+' '+JSON.stringify(v));
     assert.ok(v.width>=24&&v.height>=24,'gui:consult-target-size '+where+' '+JSON.stringify(v));
     assert.ok(v.name.includes(spec.text)&&v.text.includes('Naviに相談'),'gui:consult-accessible-name '+where+' '+JSON.stringify(v));
     assert.ok(v.fontSize==='12px'&&v.radius==='8px','gui:native-small-button '+where+' '+JSON.stringify(v));
     const writesBefore=writes.length;
     await activate(selector,vp.mode);
     const n=await chip(spec.text,'gui:consult-opens-with-label '+where);
     if(spec.day){assert.equal(await page.$('[data-calendar-day-detail]'),null,'gui:day-detail-closes '+where);assert.equal(await page.$('[data-calendar-payment-form]'),null,'gui:day-consult-read-only '+where)}
     assert.ok(n.clear,'gui:clearable-label '+where);assert.ok(n.focusInPanel,'gui:consult-focuses-rail '+where);
     assert.equal(writes.length,writesBefore,'gui:consult-no-record-write '+where+' '+JSON.stringify(writes.slice(writesBefore)));
     await shot('consult-'+spec.name+'-'+vp.width);
     const text='GUI consult '+where;await say(text);
     const job=await consultedJob(spec.target,'gui:claim-target '+where);assert.equal(job.text,text,'SETUP the consulted message was claimed');
     if(spec.day)assert.equal(await page.$('[data-calendar-payment-form]'),null,'gui:day-consult-read-only '+where);
     assert.equal(writes.length,writesBefore,'gui:consult-no-record-write '+where+' '+JSON.stringify(writes.slice(writesBefore)));
     await closeNavi();
    }
    seen('gui|consult-'+vp.mode+'-'+vp.width);
   }
   // The closed status and exact read state of a consulted reply on a company page (the existing lane): the reply arrives while closed,
   // the launcher shows it, opening shows it and it is acknowledged.
   await viewport({width:1365,height:900});await visit('/invoices');await closeNavi();
   await activate(consultOf('invoice',inv),'mouse');await chip('SEL-GUI-INV-1');
   const text='GUI consult status lane';await say(text);await closeNavi();
   const job=await claim(WG,'SETUP status claim');assert.deepEqual({...job.target},{page:'invoices',invoiceId:inv},'gui:claim-target status');await answered(WG,job,'GUI_STATUS_LANE_REPLY');
   await until(()=>page.evaluate(()=>document.querySelector('[data-assistant-toggle] [data-navi-status]')?.getAttribute('data-navi-status-kind')==='new'),'gui:status-lane-new',30000);
   await openNavi();await until(async()=>(await conversation(G,GA))?.turns?.find(t=>t.text===text)?.seenReplyVersion===1,'gui:status-lane-read',20000);
   await closeNavi();seen('gui|status-lane');
   pass('four saved-record consultations at 390 touch, 768 keyboard and 1365 mouse: visible without hover, named, clearable label, rail focus, no record write, read-only day modal closes, exact claimed target; closed status and read state kept');
  });

  // 3. Lifecycle: an explicit clear, opening an editor or a new-record form and leaving the page clear only this page's pointer (the
  //    mapping page's newer one survives); a dirty editor keeps its values while a Navi change reloads the list underneath; another tab's
  //    company switch clears the pointer, leaves the old rows unconsultable and is never reinterpreted on the way back; a same-identity
  //    token refresh keeps the selection and the History view until an explicit consultation of the same record returns to chat.
  await group('gui-lifecycle',async()=>{
   const t=await tokens();
   const i1=await invoice(t.ga,'SEL-LIFE-INV-1'),i2=await invoice(t.ga,'SEL-LIFE-INV-2'),i3=await invoice(t.ga,'SEL-LIFE-INV-3'),b1=await budget(t.ga,'SELECTION_LIFE_BUDGET');
   await viewport({width:1365,height:900});await adopt(GA);
   const one=consultOf('invoice',i1);
   await visit('/invoices');await closeNavi();await waitFor(s=>!!document.querySelector(s),[one],'SETUP invoice rows');
   // (a) explicit clear
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   await press('#omf-assistant [data-assistant-selection-clear]');await until(async()=>(await navi()).chip===null,'gui:explicit-clear',10000,describeNavi);
   await say('GUI lifecycle cleared');await consultedJob({page:'invoices'},'gui:clear-sends-no-target');seen('gui|clear');
   // (b) an editor clears the page's own pointer; its dirty values stay while a Navi deletion of another invoice reloads the list
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   const other=await send(t.ga,'GUI lifecycle another tab asks to delete',{page:'invoices'});assert.equal(other.r.status,200,'SETUP other question '+other.r.raw.slice(0,200));
   const writesBefore=writes.length;
   await (await rowButton(consultOf('invoice',i2),1)).click();
   await waitFor(()=>!!document.querySelector('.fixed.inset-0.z-50 form textarea'),[],'SETUP invoice editor open');
   await until(async()=>(await navi()).chip===null,'gui:editor-clears',10000,describeNavi);
   await page.type('.fixed.inset-0.z-50 form textarea','GUI_DIRTY_NOTE');
   const job=await claim(WG,'SETUP delete claim');const read=await act(WG,job,'get_company_invoice',{invoiceId:i3},1);assert.equal(read.status,200,'SETUP read '+read.raw.slice(0,200));
   const del=await act(WG,job,'delete_company_invoice',{invoiceId:i3,expectedUpdatedAt:read.data.result.invoice.updatedAt},2);assert.equal(del.status,200,'SETUP navi delete '+del.raw.slice(0,200));await answered(WG,job,'GUI deleted another invoice');
   await waitFor(s=>!document.querySelector(s),[consultOf('invoice',i3)],'gui:native-refresh-kept',30000);
   const editor=await page.evaluate(()=>({open:!!document.querySelector('.fixed.inset-0.z-50 form'),note:document.querySelector('.fixed.inset-0.z-50 form textarea')?.value}));
   assert.deepEqual(editor,{open:true,note:'GUI_DIRTY_NOTE'},'gui:dirty-editor-kept '+JSON.stringify(editor));assert.equal((await navi()).chip,null,'gui:editor-clears');
   const cancelEditor=()=>page.evaluate(()=>[...document.querySelectorAll('.fixed.inset-0.z-50 form button[type=button]')].find(b=>b.textContent.trim()==='キャンセル')?.click());
   await cancelEditor();await waitFor(()=>!document.querySelector('.fixed.inset-0.z-50 form'),[],'SETUP editor cancelled');
   assert.deepEqual(writes.slice(writesBefore),[],'gui:editor-no-write');seen('gui|editor');
   // (c) a new-record form clears it too
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   await page.evaluate(()=>[...document.querySelectorAll('[data-page-content] button')].find(b=>b.textContent.trim()==='新規請求書')?.click());
   await waitFor(()=>!!document.querySelector('.fixed.inset-0.z-50 form'),[],'SETUP new invoice form open');
   await until(async()=>(await navi()).chip===null,'gui:create-clears',10000,describeNavi);
   await cancelEditor();await waitFor(()=>!document.querySelector('.fixed.inset-0.z-50 form'),[],'SETUP form cancelled');seen('gui|create');
   // (d) leaving the page clears only this page's pointer: the mapping page publishes its own while the invoices page unmounts
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   await push('/mapping');await waitFor(()=>location.pathname==='/mapping',[],'SETUP mapping page');await pause(1500);
   const mapped=await pointer();assert.equal(mapped?.path,'/mapping','gui:newer-publisher-kept '+JSON.stringify(mapped));assert.equal(mapped?.invoiceId,undefined,'gui:unmount-clears '+JSON.stringify(mapped));
   await push('/invoices');await waitFor(s=>!!document.querySelector(s),[one],'SETUP back on invoices');await pause(500);assert.equal((await navi()).chip,null,'gui:unmount-clears');
   // a pointer never reaches another company page
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   await push('/budgets');await waitFor(()=>location.pathname==='/budgets',[],'SETUP budgets page');await pause(800);assert.equal((await navi()).chip,null,'gui:wrong-page-no-label');
   await say('GUI lifecycle another page');await consultedJob({page:'budgets'},'gui:wrong-page-no-target');seen('gui|page');
   // (e) another tab switches the company: this tab's pointer is cleared, the old rows are not consultable as the new company's records,
   //     and switching back does not reinterpret the old pointer.
   await visit('/invoices');await closeNavi();await waitFor(s=>!!document.querySelector(s),[one],'SETUP invoice rows');
   await activate(one,'mouse');await chip('SEL-LIFE-INV-1');
   // Another real tab of the same origin and session switches the company through its own store (Chrome delivers the storage event here).
   const otherTab=async()=>{const tab=await browser.newPage();await tab.goto(origin+'/budgets',{waitUntil:'networkidle2',timeout:SETUP_READY_MS});await tab.waitForFunction(()=>!!document.querySelector('[data-assistant-toggle]'),{timeout:SETUP_READY_MS});await page.bringToFront();return tab};
   const switchIn=async(tab,org)=>{await tab.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})});if(!r.ok)throw Error('Synthetic switch '+r.status);const s=await r.json();const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(org))};
   const tokenOrg=()=>page.evaluate(()=>{const t=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').token;try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).organizationId||''}catch{return ''}});
   const tab=await otherTab();
   try{
    await switchIn(tab,GB);
    await until(async()=>(await navi()).company.includes('Synthetic selection GUI B'),'SETUP this tab follows the other tab to company B',20000,describeNavi);
    assert.equal((await navi()).chip,null,'gui:company-switch-clears');
    const stale=await shown(one);assert.ok(stale.exists&&stale.disabled,'gui:stale-rows-not-published '+JSON.stringify(stale));
    await page.$eval(one,e=>e.click());await pause(800);assert.equal((await navi()).chip,null,'gui:stale-rows-not-published');
    await openNavi();await say('GUI lifecycle under company B',GB);await consultedJob({page:'invoices'},'gui:switch-sends-no-target');
    await switchIn(tab,GA);
    await until(async()=>(await navi()).company.includes('Synthetic selection GUI A'),'SETUP this tab follows the other tab back to company A',20000,describeNavi);
    await pause(800);assert.equal((await navi()).chip,null,'gui:switch-back-no-reinterpretation');
    await say('GUI lifecycle back in company A');await consultedJob({page:'invoices'},'gui:switch-back-no-reinterpretation');seen('gui|company-switch');
   }finally{await tab.close().catch(()=>{})}
   // (g) A legitimate reload for the new company on the same page instance: after another tab switched to B, a real Navi budget creation
   //     in B reloads the budgets list through the existing scoped signal; those B rows are consultable without a full reload, the reload
   //     itself publishes nothing and leaves the History view, and the typed message stays.
   await visit('/budgets');await closeNavi();await waitFor(s=>!!document.querySelector(s),[consultOf('budget',b1)],'SETUP budget rows (company A)');
   await openNavi();const tab2=await otherTab();
   try{
    await switchIn(tab2,GB);
    await until(async()=>(await navi()).company.includes('Synthetic selection GUI B'),'SETUP this tab follows the other tab to company B',20000,describeNavi);
    const old=await shown(consultOf('budget',b1));assert.ok(old.exists&&old.disabled,'gui:stale-rows-not-published '+JSON.stringify(old));
    await setComposer('UNSENT_REFRESH_TEXT');
    await press('#omf-assistant [data-assistant-history-toggle]');await until(async()=>(await navi()).view==='history','SETUP history view (company B)',10000,describeNavi);
    const asked=await send(t.gb,'GUI lifecycle create a company B budget',{page:'budgets'});assert.equal(asked.r.status,200,'SETUP company B question '+asked.r.raw.slice(0,200));
    const bj=await claim(WG,'SETUP company B claim'),made=await act(WG,bj,'create_company_budget',{name:'SELECTION LIFE B BUDGET',amount:30000,currency:'JPY',period:'monthly'},1);
    assert.equal(made.status,200,'SETUP company B budget '+made.raw.slice(0,200));const newB=String(made.data.receipt.nativeResourceIds.budgetId);await answered(WG,bj,'GUI company B budget created');
    const fresh=consultOf('budget',newB);
    await waitFor(s=>!!document.querySelector(s),[fresh],'gui:refreshed-row-visible',30000);
    await until(async()=>{const v=await shown(fresh);return v.exists&&!v.disabled},'gui:refreshed-rows-consultable',20000,scene);
    let v=await navi();assert.equal(v.view,'history','gui:ready-no-publication '+JSON.stringify(v));assert.equal(v.chip,null,'gui:ready-no-publication '+JSON.stringify(v));
    await activate(fresh,'mouse');await chip('SELECTION LIFE B BUDGET');
    v=await navi();assert.equal(v.view,'chat','gui:same-record-consult-live');assert.equal(v.composer,'UNSENT_REFRESH_TEXT','gui:refresh-keeps-text '+JSON.stringify(v));
    await say('UNSENT_REFRESH_TEXT',GB);await consultedJob({page:'budgets',budgetId:newB},'gui:refreshed-row-target');seen('gui|refreshed-rows');
    await switchIn(tab2,GA);await until(async()=>await tokenOrg()===String(GA),'SETUP back to company A',20000);
   }finally{await tab2.close().catch(()=>{})}
   await closeNavi();
   // (f) a same-identity token refresh keeps the selection and the History view; consulting the same record again returns to chat
   await visit('/budgets');await closeNavi();const b=consultOf('budget',b1);await waitFor(s=>!!document.querySelector(s),[b],'SETUP budget rows');
   await activate(b,'mouse');await chip('SELECTION_LIFE_BUDGET');
   await press('#omf-assistant [data-assistant-history-toggle]');await until(async()=>(await navi()).view==='history','SETUP history view',10000,describeNavi);
   const refreshed=await page.evaluate(async()=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'),claims=t=>JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),before=user.token,result=await user.refreshAuthToken();return{result,changed:before!==user.token,same:claims(before).userId===claims(user.token).userId&&claims(before).organizationId===claims(user.token).organizationId}});
   assert.deepEqual(refreshed,{result:'refreshed',changed:true,same:true},'SETUP same-identity token refresh '+JSON.stringify(refreshed));await pause(1500);
   let n=await navi();assert.ok(n.chip?.includes('SELECTION_LIFE_BUDGET'),'gui:refresh-keeps-selection '+JSON.stringify(n));assert.equal(n.view,'history','gui:refresh-keeps-history');
   await activate(b,'mouse');await until(async()=>(await navi()).view==='chat','gui:same-record-consult-live',10000,describeNavi);
   await say('GUI lifecycle after refresh');await consultedJob({page:'budgets',budgetId:b1},'gui:refresh-send-target');seen('gui|token-refresh');
   await closeNavi();
   // (h) Calendar list reads can be answered out of order: another tab switches the company while a read is in flight, or a newer read
   //     of the same company is answered first. Only the latest read, still for the actor/company it was requested for, may write the
   //     calendar store's rows, and only an applied read acknowledges the selected-record identity. Held reads are real requests released
   //     later, or a real server reply captured when requested and delivered later (an induced network delay); rows are never fabricated.
   //     Every store write is observed with a synchronous store subscription: an unacknowledged stale write is still a stale write.
   const calendarEntry=async(title,token)=>{const asked=await send(token,'GUI calendar order: create '+title,{page:'calendar'});assert.equal(asked.r.status,200,'SETUP calendar question '+asked.r.raw.slice(0,200));const job=await claim(WG,'SETUP calendar claim');const made=await act(WG,job,'create_company_calendar_entry',{title,amount:2300,currency:'JPY',dueDate:localDay(),type:'expense',category:'Utilities'},1);assert.equal(made.status,200,'SETUP calendar action '+made.raw.slice(0,200));await answered(WG,job,'GUI calendar entry created');return String(made.data.receipt.nativeResourceIds.paymentId)};
   const watchRows=()=>page.evaluate(()=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar');window.__calendarRowsStop?.();window.__calendarRows=[s.payments.map(p=>String(p.id))];window.__calendarRowsStop=s.$subscribe((_m,state)=>window.__calendarRows.push(state.payments.map(p=>String(p.id))),{flush:'sync',detached:true})});
   const rowWrites=()=>page.evaluate(()=>({writes:window.__calendarRows||[],now:document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').payments.map(p=>String(p.id))}));
   const stopRows=()=>page.evaluate(()=>{window.__calendarRowsStop?.();window.__calendarRowsStop=null}).catch(()=>{});
   const upcomingOf=id=>consultOf('payment',id,'[data-calendar-upcoming="'+id+'"]');
   const oldA=await payment(t.ga,'SELECTION CAL OLD A PAYMENT');let freshB='';
   // (h1) A late company-A read released after a fresh company-B load applied: never written; the fresh B entry and its exact pointer stay.
   {const tab3=await otherTab();let held=null,onHeld=null;
    try{
     await page.setRequestInterception(true);
     onHeld=r=>{let x;try{x=new URL(r.url())}catch{}if(!held&&r.method()==='GET'&&x?.pathname==='/api/payments'){held=r;return}r.continue().catch(()=>{})};page.on('request',onHeld);
     await page.goto(origin+'/calendar',{waitUntil:'domcontentloaded',timeout:SETUP_READY_MS});
     await until(async()=>!!held,'SETUP held company A calendar read',30000);
     await switchIn(tab3,GB);await until(async()=>await tokenOrg()===String(GB),'SETUP this tab follows the other tab to company B',20000);
     await openNavi();freshB=await calendarEntry('SELECTION CAL FRESH B PAYMENT',t.gb);
     await waitFor(s=>!!document.querySelector(s),[upcomingOf(freshB)],'SETUP the fresh company B entry rendered',30000);
     await until(async()=>{const d=await shown(upcomingOf(freshB));return d.exists&&!d.disabled},'SETUP the fresh company B entry consultable',20000,scene);
     await watchRows();
     const release=held;held={done:true};const answer=page.waitForResponse(r=>r.request()===release,{timeout:30000});await release.continue();
     const response=await answer;assert.equal(response.status(),200,'SETUP the late company A read completed');assert.ok((await response.json()).some(p=>String(p.id)===oldA),'SETUP the late read carries the company A entry');
     await pause(1500);
     const w=await rowWrites();assert.ok(!w.writes.some(ids=>ids.includes(oldA))&&w.now.includes(freshB),'gui:late-A-must-not-replace-refreshed-B '+JSON.stringify({oldId:oldA,newId:freshB,...w}));
     assert.equal(await page.$('[data-calendar-upcoming="'+oldA+'"]'),null,'gui:late-A-must-not-replace-refreshed-B rendered');
     const d=await shown(upcomingOf(freshB));assert.ok(d.exists&&!d.disabled,'gui:late-A-current-B-consultable '+JSON.stringify(d));
     await activate(upcomingOf(freshB),'mouse');await chip('SELECTION CAL FRESH B PAYMENT');await say('GUI calendar current B pointer',GB);await consultedJob({page:'calendar',paymentId:freshB},'gui:late-A-current-B-pointer');seen('gui|calendar-late-reply');
    }finally{await stopRows();if(onHeld)page.off('request',onHeld);if(held&&!held.done)await held.continue().catch(()=>{});await page.setRequestInterception(false);await tab3.close().catch(()=>{})}}
   // (h2) A company-A read that is still the latest read, answered after another tab switched to B: never written (no A entry under B).
   //      Navi stays closed, so no company-B conversation mounts and replays an earlier calendar receipt into a newer read: the held read
   //      must remain the latest one (checked), so only the actor/company check decides.
   {await closeNavi();await adopt(GA);const tab3=await otherTab();let held=null,onHeld=null,laterReads=0;
    try{
     await page.setRequestInterception(true);
     onHeld=r=>{let x;try{x=new URL(r.url())}catch{}if(r.method()==='GET'&&x?.pathname==='/api/payments'){if(!held){held=r;return}laterReads++}r.continue().catch(()=>{})};page.on('request',onHeld);
     await page.goto(origin+'/calendar',{waitUntil:'domcontentloaded',timeout:SETUP_READY_MS});
     await until(async()=>!!held,'SETUP held company A calendar read',30000);
     await switchIn(tab3,GB);await until(async()=>await tokenOrg()===String(GB),'SETUP this tab follows the other tab to company B',20000);
     await pause(1500);assert.equal(laterReads,0,'SETUP the held company A read is still the latest calendar read');
     await watchRows();
     const release=held;held={done:true};const answer=page.waitForResponse(r=>r.request()===release,{timeout:30000});await release.continue();
     const response=await answer;assert.equal(response.status(),200,'SETUP the company A read completed');assert.ok((await response.json()).some(p=>String(p.id)===oldA),'SETUP the read carries the company A entry');
     await pause(1500);
     const w=await rowWrites();assert.ok(!w.writes.some(ids=>ids.includes(oldA)),'gui:stale-company-calendar-reply-dropped '+JSON.stringify(w));
     assert.equal(await page.$('[data-calendar-upcoming="'+oldA+'"]'),null,'gui:stale-company-calendar-reply-dropped rendered');seen('gui|calendar-stale-company');
    }finally{await stopRows();if(onHeld)page.off('request',onHeld);if(held&&!held.done)await held.continue().catch(()=>{});await page.setRequestInterception(false);await tab3.close().catch(()=>{})}}
   // (h3) A company-B read answered after a newer company-B read already applied: never written (the newer rows stay). Its reply is the
   //      server's real answer captured when the read was made, delivered after the newer read.
   {let captured=null,body=null,onCapture=null;
    try{
     // SETUP opening Navi mounts the company-B conversation, which replays its earlier calendar receipt into one B read: let that read
     // apply first, so the captured read is the one the new entry causes.
     await openNavi();await waitFor(s=>!!document.querySelector(s),[upcomingOf(freshB)],'SETUP the company B calendar read applied',30000);await pause(1500);
     await page.setRequestInterception(true);
     onCapture=r=>{let x;try{x=new URL(r.url())}catch{}if(!captured&&r.method()==='GET'&&x?.pathname==='/api/payments'){captured=r;body=fetch(r.url(),{headers:{authorization:r.headers().authorization}}).then(async f=>({status:f.status,text:await f.text()}));return}r.continue().catch(()=>{})};page.on('request',onCapture);
     const firstB=await calendarEntry('SELECTION CAL B FIRST',t.gb);
     await until(async()=>!!captured,'SETUP the first company B read captured',30000);const older=await body;assert.equal(older.status,200,'SETUP the captured reply');assert.ok(JSON.parse(older.text).some(p=>String(p.id)===firstB),'SETUP the captured reply has the first entry');
     const secondB=await calendarEntry('SELECTION CAL B SECOND',t.gb);
     await waitFor(s=>!!document.querySelector(s),[upcomingOf(secondB)],'SETUP the newer company B read applied',30000);
     await watchRows();
     const late=captured;captured={done:true};const answer=page.waitForResponse(r=>r.request()===late,{timeout:30000});await late.respond({status:200,contentType:'application/json',body:older.text});await answer;
     await pause(1500);
     const w=await rowWrites();assert.ok(!w.writes.some(ids=>!ids.includes(secondB))&&w.now.includes(secondB),'gui:superseded-calendar-reply-dropped '+JSON.stringify({firstB,secondB,...w}));
     assert.ok(await page.$(upcomingOf(secondB)),'gui:superseded-calendar-reply-dropped rendered');seen('gui|calendar-superseded');
    }finally{await stopRows();if(onCapture)page.off('request',onCapture);if(captured&&!captured.done)await captured.continue().catch(()=>{});await page.setRequestInterception(false)}}
   // (h4) A company-B read held across a same-identity token refresh is still applied and its entry consultable (legitimate replies stay).
   {let held=null,onHeld=null;
    try{
     await page.setRequestInterception(true);
     onHeld=r=>{let x;try{x=new URL(r.url())}catch{}if(!held&&r.method()==='GET'&&x?.pathname==='/api/payments'){held=r;return}r.continue().catch(()=>{})};page.on('request',onHeld);
     const afterRefresh=await calendarEntry('SELECTION CAL B AFTER REFRESH',t.gb);
     await until(async()=>!!held,'SETUP the company B read held',30000);
     const refreshed=await page.evaluate(async()=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'),claims=t=>JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),before=user.token,result=await user.refreshAuthToken();return{result,changed:before!==user.token,same:claims(before).userId===claims(user.token).userId&&claims(before).organizationId===claims(user.token).organizationId}});
     assert.deepEqual(refreshed,{result:'refreshed',changed:true,same:true},'SETUP same-identity token refresh '+JSON.stringify(refreshed));
     const release=held;held={done:true};const answer=page.waitForResponse(r=>r.request()===release,{timeout:30000});await release.continue();assert.equal((await answer).status(),200,'SETUP the held company B read completed');
     await waitFor(s=>!!document.querySelector(s),[upcomingOf(afterRefresh)],'gui:same-identity-calendar-refresh-applies',20000);
     await until(async()=>{const d=await shown(upcomingOf(afterRefresh));return d.exists&&!d.disabled},'gui:same-identity-calendar-refresh-applies consultable',20000,scene);
     await activate(upcomingOf(afterRefresh),'mouse');await chip('SELECTION CAL B AFTER REFRESH');await say('GUI calendar after refresh',GB);await consultedJob({page:'calendar',paymentId:afterRefresh},'gui:same-identity-calendar-refresh-target');seen('gui|calendar-same-identity-refresh');
    }finally{if(onHeld)page.off('request',onHeld);if(held&&!held.done)await held.continue().catch(()=>{});await page.setRequestInterception(false)}}
   await closeNavi();await adopt(GA);
   pass('lifecycle: explicit clear, editor and new form, unmount (a newer mapping pointer kept), other page, another tab\'s company switch (old rows not consultable, no reinterpretation), a same-identity token refresh (selection and History kept), and calendar reads applied only when latest and still for their company (late A after fresh B, stale A, superseded B dropped; B across a token refresh applied)');
  });

  // 4. Views and focus: from History and from Memory an explicit consultation (the same record again included) returns to the live chat
  //    with the unsent text and the pinned evidence kept and the rail focused; closing returns focus to the initiating row's action without
  //    moving the document; a plain close/reopen and an ordinary page change keep the current view.
  await group('gui-view',async()=>{
   const t=await tokens();
   const recs=[];for(let i=0;i<12;i++)recs.push(await recurring(t.ga,'SELECTION_VIEW_RECURRING_'+String(i).padStart(2,'0')));
   // SETUP an archived conversation to pin (an answered turn, then an explicit new chat through the native route)
   const s=await send(t.ga,'GUI view archived question',{page:'recurring'});assert.equal(s.r.status,200,'SETUP archived send '+s.r.raw.slice(0,200));const archived=await claim(WG,'SETUP archived claim');await answered(WG,archived,'GUI_VIEW_ARCHIVED_REPLY');
   const live=await ok(COMPANY,t.ga);await ok(COMPANY+'/new',t.ga,'POST',{chatRevision:live.conversation.revision,requestId:hex32()});
   await viewport({width:1365,height:760});await adopt(GA);await visit('/recurring');await closeNavi();
   const first=await until(()=>page.evaluate(ids=>[...document.querySelectorAll('[data-navi-consult="recurring"]')].map(e=>e.getAttribute('data-navi-consult-id')).find(id=>ids.includes(id))||null,recs),'SETUP recurring rows');
   const target=consultOf('recurring',first);
   await openNavi();await setComposer('UNSENT_VIEW_TEXT');
   await press('#omf-assistant [data-assistant-history-toggle]');await waitFor(()=>!!document.querySelector('#omf-assistant [data-archive-item]'),[],'SETUP archive listed');
   await press('#omf-assistant [data-archive-item]');await waitFor(()=>!!document.querySelector('#omf-assistant [data-assistant-discuss="archive"]'),[],'SETUP archive open');
   await press('#omf-assistant [data-assistant-discuss="archive"]');await until(async()=>{const n=await navi();return n.view==='chat'&&!!n.pinned},'SETUP archive pinned',10000,describeNavi);
   // History -> consultation
   await press('#omf-assistant [data-assistant-history-toggle]');await until(async()=>(await navi()).view==='history','SETUP history view',10000,describeNavi);
   await activate(target,'mouse');
   let n=await until(async()=>{const v=await navi();return v.view==='chat'?v:null},'gui:history-consult-live-chat',10000,describeNavi);
   assert.ok(n.chip?.includes('SELECTION_VIEW_RECURRING_'),'gui:consult-opens-with-label '+JSON.stringify(n));assert.equal(n.composer,'UNSENT_VIEW_TEXT','gui:unsent-kept');assert.ok(n.pinned,'gui:pinned-kept '+JSON.stringify(n));assert.ok(n.focusInPanel,'gui:consult-focuses-rail');
   // Memory -> the same record again
   await press('#omf-assistant [data-assistant-knowledge-toggle]');await until(async()=>(await navi()).view==='knowledge','SETUP memory view',10000,describeNavi);
   await activate(target,'mouse');n=await until(async()=>{const v=await navi();return v.view==='chat'?v:null},'gui:memory-consult-live-chat',10000,describeNavi);
   assert.equal(n.composer,'UNSENT_VIEW_TEXT','gui:unsent-kept');assert.ok(n.pinned,'gui:pinned-kept');
   // Close: focus back on the initiating action, the document not moved (scrolled away from the action first)
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await pause(500);
   const away=await page.evaluate(s=>{const r=document.querySelector(s).getBoundingClientRect();return{y:scrollY,outside:r.bottom<0||r.top>innerHeight}},target);assert.ok(away.y>0&&away.outside,'SETUP scrolled away from the action '+JSON.stringify(away));
   await press('#omf-assistant [data-assistant-close]');await until(async()=>!(await navi()).open,'SETUP closed');await pause(300);
   const back=await page.evaluate(s=>({focused:document.activeElement===document.querySelector(s),y:scrollY}),target);
   assert.ok(back.focused,'gui:focus-returns-to-row '+JSON.stringify(back));assert.equal(back.y,away.y,'gui:close-no-scroll '+JSON.stringify({before:away.y,after:back.y}));seen('gui|focus');
   // A plain close/reopen keeps the view; an ordinary page change keeps it
   await page.evaluate(()=>window.scrollTo(0,0));await openNavi();await press('#omf-assistant [data-assistant-history-toggle]');await until(async()=>(await navi()).view==='history','SETUP history view');
   await closeNavi();await openNavi();assert.equal((await navi()).view,'history','gui:reopen-keeps-view');
   await push('/budgets');await waitFor(()=>location.pathname==='/budgets',[],'SETUP budgets page');await pause(1500);
   assert.equal((await navi()).view,'history','gui:page-change-keeps-history '+await describeNavi());assert.equal((await navi()).composer,null,'SETUP history shows no composer');
   await press('#omf-assistant [data-assistant-view="chat"]');await until(async()=>(await navi()).composer==='UNSENT_VIEW_TEXT','gui:unsent-kept',10000,describeNavi);
   await closeNavi();seen('gui|views');
   pass('views: History and Memory return to the live chat on an explicit consultation (same record included) with unsent text and pinned evidence kept and the rail focused; close returns focus to the initiating action without moving the document; reopen and page changes keep the view');
  });

  // 5. Deletion: only the exact successful deletion of the selected record clears its pointer (a Navi deletion's done receipt through the
  //    company-resource signal, the page's own successful native delete, and an issuer bill's suppression whose facts stay); a different
  //    record's deletion, a refused Navi deletion, a cancelled or failed native delete keep it; the following send has no stale id.
  await group('gui-delete',async()=>{
   const t=await tokens();
   const b1=await budget(t.ga,'SELECTION_DEL_BUDGET_1'),b2=await budget(t.ga,'SELECTION_DEL_BUDGET_2'),b3=await budget(t.ga,'SELECTION_DEL_BUDGET_3');
   const i1=await invoice(t.ga,'SEL-DEL-INV-1'),i2=await invoice(t.ga,'SEL-DEL-INV-2'),i3=await invoice(t.ga,'SEL-DEL-INV-3'),bill=await issuerBill(GA,'SELECTION_DEL_ISSUER_BILL');
   await viewport({width:1365,height:900});await adopt(GA);
   const bud=id=>consultOf('budget',id),inv=id=>consultOf('invoice',id);
   await visit('/budgets');await closeNavi();await waitFor(s=>!!document.querySelector(s),[bud(b1)],'SETUP budget rows');
   // (a) Navi deletes the consulted budget
   await activate(bud(b1),'mouse');await chip('SELECTION_DEL_BUDGET_1');
   await say('この予算を削除して。');let job=await claim(WG,'SETUP delete claim');assert.deepEqual({...job.target},{page:'budgets',budgetId:b1},'gui:claim-target delete');
   let read=await act(WG,job,'get_company_budget',{budgetId:b1},1);assert.equal(read.status,200,'SETUP read '+read.raw.slice(0,200));
   let r=await act(WG,job,'delete_company_budget',{budgetId:b1,expectedUpdatedAt:read.data.result.budget.updatedAt},2);assert.equal(r.status,200,'SETUP navi delete '+r.raw.slice(0,200));assert.equal(r.data.receipt.state,'done','SETUP done receipt');
   await answered(WG,job,'GUI deleted the budget');
   await until(async()=>(await navi()).chip===null,'gui:matched-delete-clears',30000,describeNavi);
   await waitFor(s=>!document.querySelector(s),[bud(b1)],'gui:native-refresh-after-delete',30000);
   await say('削除した予算について確認して。');await consultedJob({page:'budgets'},'gui:following-send-ok');seen('gui|navi-delete');
   // (b) a different record's deletion keeps the pointer (the list still reloads)
   await activate(bud(b2),'mouse');await chip('SELECTION_DEL_BUDGET_2');
   await say('別の予算を削除して。');job=await claim(WG,'SETUP other delete claim');
   read=await act(WG,job,'get_company_budget',{budgetId:b3},1);r=await act(WG,job,'delete_company_budget',{budgetId:b3,expectedUpdatedAt:read.data.result.budget.updatedAt},2);assert.equal(r.status,200,'SETUP other delete '+r.raw.slice(0,200));
   await answered(WG,job,'GUI deleted another budget');
   await waitFor(s=>!document.querySelector(s),[bud(b3)],'SETUP list reloaded after the other deletion',30000);await pause(1000);
   assert.ok((await navi()).chip?.includes('SELECTION_DEL_BUDGET_2'),'gui:other-delete-keeps '+await describeNavi());seen('gui|other-delete');
   // (c) a refused Navi deletion of the consulted budget keeps it
   await say('この予算を削除して（古い読み取り）。');job=await claim(WG,'SETUP refused delete claim');
   r=await act(WG,job,'delete_company_budget',{budgetId:b2,expectedUpdatedAt:'2020-01-01T00:00:00.000Z'},1);assert.equal(r.status,409,'SETUP refused delete '+r.status);
   await answered(WG,job,'GUI_REFUSED_DELETE_REPLY');await until(()=>page.evaluate(()=>document.querySelector('#omf-assistant [role=log]')?.textContent.includes('GUI_REFUSED_DELETE_REPLY')),'SETUP reply rendered',30000);await pause(1000);
   assert.ok((await navi()).chip?.includes('SELECTION_DEL_BUDGET_2'),'gui:failed-delete-keeps '+await describeNavi());seen('gui|refused-delete');
   // (d) the page's own native delete: successful clears, cancelled or failed keeps
   await visit('/invoices');await closeNavi();await waitFor(s=>!!document.querySelector(s),[inv(i1)],'SETUP invoice rows');
   await activate(inv(i1),'mouse');await chip('SEL-DEL-INV-1');
   dialogAnswer='accept';await (await rowButton(inv(i1),2)).click();
   await until(async()=>(await navi()).chip===null,'gui:page-delete-clears',20000,describeNavi);await waitFor(s=>!document.querySelector(s),[inv(i1)],'SETUP deleted row gone',20000);
   await activate(inv(i2),'mouse');await chip('SEL-DEL-INV-2');
   dialogAnswer='dismiss';await (await rowButton(inv(i2),2)).click();await pause(1500);
   assert.ok((await navi()).chip?.includes('SEL-DEL-INV-2'),'gui:cancelled-delete-keeps '+await describeNavi());
   await activate(inv(i3),'mouse');await chip('SEL-DEL-INV-3');
   await ok('/api/invoices/'+i3,t.ma,'DELETE');// another member removes it first (native route)
   dialogAnswer='accept';await (await rowButton(inv(i3),2)).click();await pause(2000);
   assert.ok((await navi()).chip?.includes('SEL-DEL-INV-3'),'gui:failed-delete-keeps-pointer '+await describeNavi());dialogAnswer='accept';seen('gui|page-delete');
   await press('#omf-assistant [data-assistant-selection-clear]');await closeNavi();
   // (e) an issuer bill's suppression clears the selected displayed entry; its saved facts stay
   await visit('/calendar');await closeNavi();const billAction=consultOf('payment',bill,'[data-calendar-upcoming="'+bill+'"]');await waitFor(s=>!!document.querySelector(s),[billAction],'SETUP issuer bill listed');
   await activate(billAction,'mouse');await chip('SELECTION_DEL_ISSUER_BILL');
   await say('このカードの請求予定を削除して。');job=await claim(WG,'SETUP suppression claim');assert.deepEqual({...job.target},{page:'calendar',paymentId:bill},'gui:claim-target suppression');
   read=await act(WG,job,'get_company_calendar_entry',{paymentId:bill},1);assert.equal(read.status,200,'SETUP read entry '+read.raw.slice(0,200));
   r=await act(WG,job,'delete_company_calendar_entry',{paymentId:bill,expectedUpdatedAt:read.data.result.entry.updatedAt},2);assert.equal(r.status,200,'SETUP suppression '+r.raw.slice(0,200));assert.equal(r.data.result.suppressed,true,'SETUP issuer bill suppressed');
   await answered(WG,job,'GUI suppressed the bill');
   await until(async()=>(await navi()).chip===null,'gui:suppression-clears',30000,describeNavi);
   await waitFor(id=>!document.querySelector('[data-calendar-upcoming="'+id+'"]'),[bill],'SETUP suppressed entry hidden',30000);
   const kept=await db.collection('payments').findOne({_id:new ctx.ObjectId(bill)});assert.ok(kept&&kept.suppressedAt&&kept.amount===4321,'gui:issuer-facts-kept');seen('gui|suppression');
   await closeNavi();
   pass('deletion: a Navi deletion (exact done receipt), the page\'s own successful delete and an issuer bill suppression clear only that pointer; other-record, refused, cancelled and failed deletions keep it; the following send has no stale id');
  });

  // 6. A selected record removed before the first send: the definite marked refusal releases only that frozen request, the typed text
  //    stays, clearing the target lets the next send through once, without a reload or sign-out. A lost reply, another tab's pending
  //    question and another tab's new chat keep the request and text; the request is then recognised or accepted exactly once.
  await group('gui-missing',async()=>{
   const t=await tokens();
   const gone=await recurring(t.ga,'SELECTION_MISSING_RECURRING'),tx=await ok('/api/transactions',t.ga,'POST',{date:localDay(),amount:2400,productName:'SELECTION_MISSING_TRANSACTION'}),txId=String(tx._id||tx.id);
   await viewport({width:1365,height:900});await adopt(GA);
   // (0) The existing transaction-detail selection (route-derived, present before this change): another member removes the transaction
   //     before the first send. Only that marked refusal releases the frozen request; the text stays; leaving the record page lets the
   //     next send through once.
   await visit('/transactions/'+txId);await waitFor(()=>document.querySelector('[data-page-content]')?.textContent.includes('SELECTION_MISSING_TRANSACTION'),[],'SETUP transaction detail');
   await openNavi();await ok('/api/transactions/'+txId,t.ma,'DELETE');// another member removes it (native route)
   let before=((await conversation(G,GA))?.turns||[]).length;
   await setComposer('MISSING_TRANSACTION_TEXT');await until(async()=>!(await navi()).sendDisabled,'SETUP send enabled',30000,describeNavi);await press('#omf-assistant [data-assistant-send]');
   let n=await until(async()=>{const v=await navi();return v.error?v:null},'SETUP refusal shown',20000,describeNavi);
   assert.equal(n.send,'送信','gui:missing-target-released '+JSON.stringify(n));assert.equal(n.composer,'MISSING_TRANSACTION_TEXT','gui:missing-text-kept');assert.ok(n.error.includes('見つかりません'),'gui:missing-target-message '+n.error);
   await push('/transactions');await waitFor(()=>location.pathname==='/transactions',[],'SETUP transaction list');await pause(800);
   await press('#omf-assistant [data-assistant-send]');
   await until(async()=>await turnsWith(GA,'MISSING_TRANSACTION_TEXT')===1,'gui:missing-target-recovers',20000,describeNavi);
   await consultedJob({page:'transactions'},'gui:missing-target-recovers');assert.equal(((await conversation(G,GA)).turns||[]).length,before+1,'gui:missing-single-turn');seen('gui|missing-transaction');
   await closeNavi();await visit('/recurring');await closeNavi();
   const action=consultOf('recurring',gone);await waitFor(s=>!!document.querySelector(s),[action],'SETUP recurring rows');
   // (a) the consulted saved record removed before the first send
   await activate(action,'mouse');await chip('SELECTION_MISSING_RECURRING');
   await ok('/api/recurring/'+gone,t.ma,'DELETE');// another member removes it (native route)
   before=((await conversation(G,GA))?.turns||[]).length;
   await setComposer('MISSING_TARGET_TEXT');await press('#omf-assistant [data-assistant-send]');
   n=await until(async()=>{const v=await navi();return v.error?v:null},'SETUP refusal shown',20000,describeNavi);
   assert.equal(n.send,'送信','gui:missing-target-released '+JSON.stringify(n));assert.equal(n.composer,'MISSING_TARGET_TEXT','gui:missing-text-kept');assert.ok(n.error.includes('見つかりません'),'gui:missing-target-message '+n.error);
   await press('#omf-assistant [data-assistant-selection-clear]');await until(async()=>(await navi()).chip===null,'SETUP target cleared');
   await press('#omf-assistant [data-assistant-send]');
   await until(async()=>await turnsWith(GA,'MISSING_TARGET_TEXT')===1,'gui:missing-target-recovers',20000,describeNavi);
   await consultedJob({page:'recurring'},'gui:missing-target-recovers');assert.equal(((await conversation(G,GA)).turns||[]).length,before+1,'gui:missing-single-turn');seen('gui|missing-target');
   // (b) a lost reply: the server accepted, the browser's copy failed
   await page.setRequestInterception(true);let lose=true,lost=null;
   const onLost=async r=>{let u;try{u=new URL(r.url())}catch{}if(lose&&r.method()==='POST'&&u?.pathname===COMPANY){lose=false;const h=r.headers();const f=await fetch(r.url(),{method:'POST',headers:{'content-type':'application/json',authorization:h.authorization},body:r.postData()});lost=f.status;await r.abort('failed').catch(()=>{});return}r.continue().catch(()=>{})};
   page.on('request',onLost);
   try{
    await setComposer('LOST_REPLY_TEXT');await until(async()=>!(await navi()).sendDisabled,'SETUP send enabled',30000,describeNavi);await press('#omf-assistant [data-assistant-send]');
    n=await until(async()=>{const v=await navi();return v.error&&lost?v:null},'SETUP lost reply failed in the browser',20000,describeNavi);
    assert.equal(lost,200,'SETUP the server accepted the lost request');assert.equal(await turnsWith(GA,'LOST_REPLY_TEXT'),1,'SETUP stored once');
    assert.equal(n.send,'送信結果を確認','gui:lost-response-pending-kept '+JSON.stringify(n));assert.equal(n.composer,'LOST_REPLY_TEXT','gui:lost-response-pending-kept');
   }finally{page.off('request',onLost);await page.setRequestInterception(false)}
   await press('#omf-assistant [data-assistant-send]');
   await until(async()=>(await navi()).composer==='','gui:lost-response-single-turn',20000,describeNavi);assert.equal(await turnsWith(GA,'LOST_REPLY_TEXT'),1,'gui:lost-response-single-turn');
   await consultedJob({page:'recurring'},'SETUP lost reply claim');seen('gui|lost-reply');
   // (c) another tab's pending question: this send is refused unmarked (this tab's poll is slow: its reads are held), kept, then accepted once
   await until(async()=>{const v=await navi();return v.composer!==null&&!v.composerDisabled},'SETUP composer ready',30000,describeNavi);
   await page.setRequestInterception(true);const held=[];let hold=true;
   const onHold=r=>{let u;try{u=new URL(r.url())}catch{}if(hold&&r.method()==='GET'&&u?.pathname===COMPANY){held.push(r);return}r.continue().catch(()=>{})};
   page.on('request',onHold);
   try{
    await setComposer('CONFLICT_TEXT');
    const other=await send(t.ga,'GUI other tab pending question',{page:'recurring'});assert.equal(other.r.status,200,'SETUP other tab question '+other.r.raw.slice(0,200));
    await press('#omf-assistant [data-assistant-send]');
    n=await until(async()=>{const v=await navi();return v.error?v:null},'SETUP conflict refusal shown',20000,describeNavi);
    assert.equal(n.send,'送信結果を確認','gui:conflict-pending-kept '+JSON.stringify(n));assert.equal(n.composer,'CONFLICT_TEXT','gui:conflict-pending-kept');assert.equal(await turnsWith(GA,'CONFLICT_TEXT'),0,'SETUP refused');
   }finally{hold=false;page.off('request',onHold);for(const r of held)await r.continue().catch(()=>{});await page.setRequestInterception(false)}
   const otherJob=await claim(WG,'SETUP other tab claim');await answered(WG,otherJob,'GUI_OTHER_TAB_REPLY');
   await until(async()=>{const v=await navi();return !v.sendDisabled&&!v.composerDisabled&&await page.evaluate(()=>document.querySelector('#omf-assistant [role=log]')?.textContent.includes('GUI_OTHER_TAB_REPLY'))},'SETUP this tab sees the answer',30000,describeNavi);
   await press('#omf-assistant [data-assistant-send]');await until(async()=>(await navi()).composer==='','gui:conflict-resend-once',20000,describeNavi);
   assert.equal(await turnsWith(GA,'CONFLICT_TEXT'),1,'gui:conflict-resend-once');await consultedJob({page:'recurring'},'SETUP conflict claim');seen('gui|conflict');
   // (d) another tab's new chat keeps this tab's unsent text; the next send lands once in the new segment
   await setComposer('RESET_TEXT');const segment=(await conversation(G,GA)).segment||0;
   const live=await ok(COMPANY,t.ga);await ok(COMPANY+'/new',t.ga,'POST',{chatRevision:live.conversation.revision,requestId:hex32()});
   await until(()=>page.evaluate(()=>document.querySelectorAll('#omf-assistant [data-workspace-turn]').length===0),'SETUP this tab shows the new chat',30000);
   assert.equal((await navi()).composer,'RESET_TEXT','gui:reset-keeps-text');
   await press('#omf-assistant [data-assistant-send]');await until(async()=>(await navi()).composer==='','gui:reset-send-once',20000,describeNavi);
   const after=await conversation(G,GA);assert.equal(after.segment,segment+1,'gui:reset-send-once');assert.equal(after.turns.filter(x=>x.text==='RESET_TEXT').length,1,'gui:reset-send-once');
   await consultedJob({page:'recurring'},'SETUP reset claim');seen('gui|reset');
   // (e) A request that was already sent once with an unknown outcome stays the same request when a later attempt meets the marked refusal
   //     of its removed record (an earlier attempt could still be accepted). The test fails the browser's FIRST copy before it reaches the
   //     server: an induced network failure, not a production one, and no duplicate is claimed. Same pending id, check label, text kept.
   const unknownGone=await recurring(t.ga,'SELECTION UNKNOWN RECURRING');
   await closeNavi();await visit('/recurring');await closeNavi();const u=consultOf('recurring',unknownGone);await waitFor(s=>!!document.querySelector(s),[u],'SETUP recurring rows');
   await activate(u,'mouse');await chip('SELECTION UNKNOWN RECURRING');await setComposer('UNKNOWN_THEN_MISSING_TEXT');
   const pendingIds=()=>page.evaluate(()=>Object.values(document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').pending).map(p=>p.id));
   await page.setRequestInterception(true);let drop=true;
   const onDrop=r=>{let x;try{x=new URL(r.url())}catch{}if(drop&&r.method()==='POST'&&x?.pathname===COMPANY){drop=false;r.abort('failed').catch(()=>{});return}r.continue().catch(()=>{})};
   page.on('request',onDrop);
   try{await until(async()=>!(await navi()).sendDisabled,'SETUP send enabled',30000,describeNavi);await press('#omf-assistant [data-assistant-send]');n=await until(async()=>{const v=await navi();return v.error&&!drop?v:null},'SETUP induced lost first send',20000,describeNavi)}
   finally{page.off('request',onDrop);await page.setRequestInterception(false)}
   assert.equal(await turnsWith(GA,'UNKNOWN_THEN_MISSING_TEXT'),0,'SETUP the dropped first copy never reached the server');
   const first=await pendingIds();assert.equal(first.length,1,'SETUP one pending request '+JSON.stringify(first));assert.equal(n.send,'送信結果を確認','SETUP the unknown request is kept');
   await ok('/api/recurring/'+unknownGone,t.ma,'DELETE');// another member removes it (native route)
   await press('#omf-assistant [data-assistant-send]');
   n=await until(async()=>{const v=await navi();return v.error.includes('見つかりません')?v:null},'SETUP the retried request meets the marked refusal',20000,describeNavi);
   const later=await pendingIds();assert.deepEqual(later,first,'gui:unknown-then-missing-kept '+JSON.stringify({first,later}));assert.equal(n.send,'送信結果を確認','gui:unknown-then-missing-kept '+JSON.stringify(n));
   assert.equal(n.composer,'UNKNOWN_THEN_MISSING_TEXT','gui:unknown-then-missing-kept');assert.equal(await turnsWith(GA,'UNKNOWN_THEN_MISSING_TEXT'),0,'SETUP still never stored');seen('gui|unknown-then-missing');
   await closeNavi();
   pass('missing target: one marked refusal of a first attempt releases only that request with the text kept and the next send accepted once; a lost reply, another tab\'s pending question and new chat, and an unknown earlier attempt keep the request');
  });

  // Shared by groups 7 and 8 (plan omf-navi-agent-pending-exit-20261023): the store's uncertain request ids, the company New chat
  // button, the archived turn History marks, another real tab of this session, and an induced lost FIRST copy of a send (the test fails
  // the browser's request before it reaches the server: a network failure the test causes, so that request was never accepted; no
  // duplicate or production failure is claimed).
  const pendingNow=()=>page.evaluate(()=>Object.values(document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').pending).map(p=>p.id));
  const newChatButton=()=>page.$eval('#omf-assistant [data-assistant-new-chat]',e=>({disabled:e.disabled}));
  const pressNewChat=async()=>{await until(async()=>!(await newChatButton()).disabled,'SETUP New chat enabled',20000,describeNavi);await press('#omf-assistant [data-assistant-new-chat]')};
  const archivedTurnShown=()=>page.evaluate(()=>{const t=document.querySelector('#omf-assistant [data-archived-request]');return t?{text:t.textContent,states:[...t.querySelectorAll('[data-archived-action-state]')].map(e=>e.getAttribute('data-archived-action-state'))}:null});
  const receivedShown=async()=>{const v=await navi();return v.view==='history'&&await page.$('#omf-assistant [data-assistant-received]')?v:null};
  const transcriptHas=text=>page.evaluate(text=>!!document.querySelector('#omf-assistant [role=log]')?.textContent.includes(text),text);
  // SETUP the open conversation's next real read (its 4 s poll) has completed, so the next press carries the current revision.
  const freshRead=async label=>{await page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===COMPANY&&r.status()===200,{timeout:30000}).catch(()=>assert.fail('SETUP conversation read after '+label));await pause(500)};
  // The failed attempt is over when the send control is usable again with the request kept (its error text can be replaced by the next
  // successful 4 s read, so the test does not wait for that text).
  const settledUncertain=async label=>until(async()=>{const v=await navi();return !v.sendDisabled&&v.send==='送信結果を確認'?v:null},label,20000,describeNavi);
  const dropFirstCopy=async label=>{await beat(WG);await until(async()=>!(await navi()).sendDisabled,'SETUP send enabled '+label,30000,describeNavi);
   await page.setRequestInterception(true);let drop=true;const onDrop=r=>{let x;try{x=new URL(r.url())}catch{}if(drop&&r.method()==='POST'&&x?.pathname===COMPANY){drop=false;r.abort('failed').catch(()=>{});return}r.continue().catch(()=>{})};page.on('request',onDrop);
   try{await press('#omf-assistant [data-assistant-send]');await until(async()=>!drop,'SETUP the first copy was failed '+label,20000,describeNavi);return await settledUncertain('SETUP induced lost first copy '+label)}
   finally{page.off('request',onDrop);await page.setRequestInterception(false)}};
  const pendingTab=async()=>{const tab=await browser.newPage();await tab.goto(origin+'/budgets',{waitUntil:'networkidle2',timeout:SETUP_READY_MS});await tab.waitForFunction(()=>!!document.querySelector('[data-assistant-toggle]'),{timeout:SETUP_READY_MS});await page.bringToFront();return tab};
  const switchTab=async(tab,org)=>{await tab.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})});if(!r.ok)throw Error('Synthetic switch '+r.status);const s=await r.json();const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(org))};

  // 7. An uncertain company send recovered through the existing New chat. The first copy of a send is lost before the server (induced),
  //    another member removes its selected record, and the next attempt meets the marked refusal: the request stays uncertain (the
  //    original witness). A successful New chat archives the answered conversation AND answers for exactly that request: never accepted,
  //    fenced, released; the typed text stays and nothing is sent until the person sends. The recovery hint names New chat; an empty
  //    and an absent conversation keep the New chat entry point for an uncertain request; the closed status stays quiet; a refused New
  //    chat (busy) keeps the request; an ordinary New chat is unchanged.
  await group('gui-pending',async()=>{
   const t=await tokens(),GC=await company('gui-c','Synthetic selection GUI C',[member(G,'owner'),member(M,'member')]),GD=await company('gui-d','Synthetic selection GUI D',[member(G,'owner')]);
   const gc=await switchTo(G,GC),mc=await switchTo(M,GC),gd=await switchTo(G,GD);
   const gone1=await recurring(gc,'PENDING WITNESS RECURRING'),gone2=await recurring(gc,'PENDING EMPTY RECURRING');
   await viewport({width:1365,height:900});await adopt(GC);await visit('/recurring');await closeNavi();await openNavi();
   await until(async()=>(await navi()).company.includes('Synthetic selection GUI C'),'SETUP company C conversation',20000,describeNavi);
   // SETUP an answered conversation (the witness had one).
   await say('PENDING_PRIOR_TEXT',GC);await consultedJob({page:'recurring'},'SETUP prior claim');await until(()=>transcriptHas('GUI synthetic reply'),'SETUP prior reply shown',30000);
   // An uncertain request of a consulted record: lost first copy, the record removed, the retried attempt refused with the mark.
   const stuck=async(record,label,text)=>{const action=consultOf('recurring',record);await waitFor(s=>!!document.querySelector(s),[action],'SETUP recurring rows');await activate(action,'mouse');await chip(label);await setComposer(text);
    await dropFirstCopy(text);assert.equal(await turnsWith(GC,text),0,'SETUP the first copy never reached the server');const first=await pendingNow();assert.equal(first.length,1,'SETUP one uncertain request '+JSON.stringify(first));
    await ok('/api/recurring/'+record,mc,'DELETE');// another member removes it (native route)
    const refused=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===COMPANY,{timeout:30000});
    await press('#omf-assistant [data-assistant-send]');const answer=await refused,marked=await answer.json().catch(()=>null);
    assert.deepEqual([answer.status(),marked?.data?.selectedRecordMissing],[404,true],'SETUP the retried request meets the marked refusal');
    const n=await settledUncertain('SETUP the retried request meets the marked refusal');
    assert.deepEqual(await pendingNow(),first,'SETUP the uncertain request is kept');assert.equal(n.send,'送信結果を確認','SETUP the uncertain request is kept '+JSON.stringify(n));return first[0]};
   // (a) The witness: New chat on the answered conversation.
   const witnessId=await stuck(gone1,'PENDING WITNESS RECURRING','PENDING_WITNESS_TEXT');
   const before=await conversation(G,GC);assert.ok(before.turns.length>0,'SETUP the answered conversation exists');
   const resetReply=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===COMPANY+'/new',{timeout:30000});
   await pressNewChat();assert.equal((await resetReply).status(),200,'SETUP the New chat succeeded');
   await until(async()=>{const c=await conversation(G,GC);return c?.segment===(before.segment||0)+1&&c.turns.length===0},'SETUP archived and emptied',30000);
   await until(()=>page.evaluate(()=>document.querySelectorAll('#omf-assistant [data-workspace-turn]').length===0),'SETUP this tab shows the new chat',30000);await pause(1000);
   let n=await navi();const after=await conversation(G,GC),pendingAfter=await pendingNow();
   console.log('PENDING_EXIT_WITNESS '+JSON.stringify({before:{revision:before.revision,segment:before.segment||0,turns:before.turns.length,pending:[witnessId]},after:{revision:after.revision,segment:after.segment,turns:after.turns.length,pending:pendingAfter,composer:n.composer,send:n.send},newChatDisabled:(await newChatButton()).disabled,witnessTextStored:await turnsWith(GC,'PENDING_WITNESS_TEXT')}));
   assert.deepEqual(pendingAfter,[],'gui:witness-reset-releases '+JSON.stringify({pendingAfter,send:n.send}));assert.equal(n.send,'送信','gui:witness-reset-releases '+JSON.stringify(n));
   assert.equal(n.composer,'PENDING_WITNESS_TEXT','gui:witness-text-kept '+JSON.stringify(n));
   await pause(3000);assert.equal(await turnsWith(GC,'PENDING_WITNESS_TEXT'),0,'gui:no-automatic-resend');assert.equal((await conversation(G,GC)).revision,after.revision,'gui:no-automatic-resend');seen('gui|pending-witness');
   // (b) An empty live segment: another uncertain request. The recovery hint names New chat, which stays available with no turns, fences
   //     and releases it; the typed text stays, nothing is sent, the closed status is quiet. Only an explicit send sends it, once.
   await stuck(gone2,'PENDING EMPTY RECURRING','PENDING_EMPTY_TEXT');
   const hint=await page.$eval('#omf-assistant',p=>p.querySelector('[data-assistant-pending-hint]')?.textContent||'');assert.ok(hint.includes('新しい会話'),'gui:pending-recovery-hint '+JSON.stringify(hint));
   const emptyBefore=await conversation(G,GC);assert.equal(emptyBefore.turns.length,0,'SETUP empty live segment');
   const entry=await newChatButton();assert.equal(entry.disabled,false,'gui:empty-new-chat-entry '+JSON.stringify(entry));
   await press('#omf-assistant [data-assistant-new-chat]');
   n=await until(async()=>{const v=await navi();return v.send==='送信'?v:null},'gui:fenced-pending-released',20000,describeNavi);
   assert.deepEqual(await pendingNow(),[],'gui:fenced-pending-released');assert.equal(n.composer,'PENDING_EMPTY_TEXT','gui:fenced-raw-text-kept '+JSON.stringify(n));
   const fenced=await conversation(G,GC);assert.ok(fenced.revision>emptyBefore.revision&&fenced.segment===emptyBefore.segment&&fenced.turns.length===0,'gui:fence-recorded '+JSON.stringify({before:emptyBefore.revision,after:fenced.revision,segment:fenced.segment}));
   const status=await ok(COMPANY+'/status',gc);assert.deepEqual([status.replies?.unread,status.conversation?.state],[0,'idle'],'gui:fence-status-quiet '+JSON.stringify(status));
   await pause(3000);assert.equal(await turnsWith(GC,'PENDING_EMPTY_TEXT'),0,'gui:no-automatic-resend');
   await press('#omf-assistant [data-assistant-selection-clear]');await until(async()=>(await navi()).chip===null,'SETUP target cleared');
   await beat(WG);await press('#omf-assistant [data-assistant-send]');await until(async()=>(await navi()).composer==='','gui:fenced-explicit-send-once',20000,describeNavi);
   assert.equal(await turnsWith(GC,'PENDING_EMPTY_TEXT'),1,'gui:fenced-explicit-send-once');await consultedJob({page:'recurring'},'SETUP explicit send claim');seen('gui|pending-empty');
   // (c) An absent conversation (company D, nothing ever stored): an uncertain first send; New chat is available, fences and releases it.
   await closeNavi();await adopt(GD);await visit('/calendar');await closeNavi();await openNavi();
   await until(async()=>(await navi()).company.includes('Synthetic selection GUI D'),'SETUP company D conversation',20000,describeNavi);
   await setComposer('PENDING_ABSENT_TEXT');await dropFirstCopy('absent');assert.equal(await conversation(G,GD),null,'SETUP no company D conversation');
   const absentEntry=await newChatButton();assert.equal(absentEntry.disabled,false,'gui:empty-new-chat-entry absent '+JSON.stringify(absentEntry));
   await press('#omf-assistant [data-assistant-new-chat]');
   n=await until(async()=>{const v=await navi();return v.send==='送信'?v:null},'gui:fenced-pending-released absent',20000,describeNavi);
   assert.deepEqual(await pendingNow(),[],'gui:fenced-pending-released absent');assert.equal(n.composer,'PENDING_ABSENT_TEXT','gui:fenced-raw-text-kept absent '+JSON.stringify(n));
   const fencedD=await conversation(G,GD);assert.ok(fencedD&&fencedD.revision>0&&fencedD.turns.length===0,'gui:fence-recorded absent');
   await pause(3000);assert.equal(await turnsWith(GD,'PENDING_ABSENT_TEXT'),0,'gui:no-automatic-resend absent');seen('gui|pending-absent');
   // (d) A refused New chat keeps the uncertain request and its text: another tab's question was queued after this tab's last read (its
   //     reads are held, so it still offers New chat) and the server refuses that New chat. After the answer the same request is sent once.
   await setComposer('PENDING_REFUSED_TEXT');await dropFirstCopy('refused');const refusedIds=await pendingNow();
   await page.setRequestInterception(true);const heldReads=[];let holding=true;
   const onHold=r=>{let u;try{u=new URL(r.url())}catch{}if(holding&&r.method()==='GET'&&u?.pathname===COMPANY){heldReads.push(r);return}r.continue().catch(()=>{})};page.on('request',onHold);
   try{
    const other=await send(gd,'GUI pending another tab question',{page:'calendar'});assert.equal(other.r.status,200,'SETUP another tab question '+other.r.raw.slice(0,200));
    const refusal=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===COMPANY+'/new',{timeout:30000});
    await press('#omf-assistant [data-assistant-new-chat]');assert.equal((await refusal).status(),409,'SETUP the New chat was refused while answering');
    n=await settledUncertain('SETUP the refused New chat settled');
    assert.deepEqual(await pendingNow(),refusedIds,'gui:refused-reset-keeps-pending');assert.equal(n.send,'送信結果を確認','gui:refused-reset-keeps-pending '+JSON.stringify(n));assert.equal(n.composer,'PENDING_REFUSED_TEXT','gui:refused-reset-keeps-pending');
   }finally{holding=false;page.off('request',onHold);for(const r of heldReads)await r.continue().catch(()=>{});await page.setRequestInterception(false)}
   const otherJob=await claim(WG,'SETUP another tab claim');await answered(WG,otherJob,'GUI_PENDING_OTHER_REPLY');
   await until(async()=>{const v=await navi();return !v.sendDisabled&&!v.composerDisabled&&await transcriptHas('GUI_PENDING_OTHER_REPLY')},'SETUP this tab sees the answer',30000,describeNavi);
   await beat(WG);await press('#omf-assistant [data-assistant-send]');await until(async()=>(await navi()).composer==='','gui:refused-reset-later-send-once',20000,describeNavi);
   assert.equal(await turnsWith(GD,'PENDING_REFUSED_TEXT'),1,'gui:refused-reset-later-send-once');await consultedJob({page:'calendar'},'SETUP refused-request claim');seen('gui|pending-refused');
   // (e) An ordinary New chat (no uncertain request) archives the answered conversation as before and leaves the composer alone.
   await until(()=>transcriptHas('GUI synthetic reply'),'SETUP the reply shown',30000);
   const ordinary=await conversation(G,GD);await setComposer('ORDINARY_UNSENT');await pressNewChat();
   await until(async()=>{const c=await conversation(G,GD);return c.segment===(ordinary.segment||0)+1&&c.turns.length===0},'gui:ordinary-new-chat',30000);
   await until(()=>page.evaluate(()=>document.querySelectorAll('#omf-assistant [data-workspace-turn]').length===0),'gui:ordinary-new-chat shown',30000);
   n=await navi();assert.equal(n.view,'chat','gui:ordinary-new-chat '+JSON.stringify(n));assert.equal(n.composer,'ORDINARY_UNSENT','gui:ordinary-new-chat composer');assert.deepEqual(await pendingNow(),[],'gui:ordinary-new-chat');
   await setComposer('');await closeNavi();await adopt(GA);seen('gui|ordinary-new-chat');
   pass('uncertain send: New chat answers for exactly that request (the witness: the answered conversation archived and the request fenced and released), the recovery hint, New chat on empty and absent conversations, typed text kept, nothing resent, a quiet status, a refused New chat keeps the request, and an ordinary New chat is unchanged');
  });

  // 8. Accepted requests and lost replies. The server accepts a send whose reply the browser loses (the test forwards the browser's own
  //    request, then fails the browser's copy); a simulated worker saves one internal calendar plan and answers; another tab's New chat
  //    archives it before this tab reads it (this tab's reads are held). The request is then recognised from the archive: by "send result
  //    check" with an edited composer (the edited text kept) or by New chat with the unchanged composer (that text cleared), each showing
  //    the actual archived turn and receipt in History, never sent again. A lost New chat reply keeps the request (also across a
  //    same-identity token refresh), and the next New chat reuses the frozen reset id and request identity; its answer never resolves a
  //    newer uncertain request. A New chat answer arriving after another tab switched company resolves nothing; back in that company the
  //    request is still uncertain and New chat resolves it.
  await group('gui-received',async()=>{
   const t=await tokens(),GE=await company('gui-e','Synthetic selection GUI E',[member(G,'owner')]),ge=await switchTo(G,GE);
   await viewport({width:1365,height:900});await adopt(GE);await visit('/calendar');await closeNavi();await openNavi();
   await until(async()=>(await navi()).company.includes('Synthetic selection GUI E'),'SETUP company E conversation',20000,describeNavi);
   const acceptedThenArchived=async(text,plan,reply)=>{
    await beat(WG);await setComposer(text);await until(async()=>!(await navi()).sendDisabled,'SETUP send enabled',30000,describeNavi);
    await page.setRequestInterception(true);let lose=true,lost=null,aborted=false,holding=true;const held=[];
    const on=async r=>{let u;try{u=new URL(r.url())}catch{}if(holding&&r.method()==='GET'&&u?.pathname===COMPANY){held.push(r);return}
     if(lose&&r.method()==='POST'&&u?.pathname===COMPANY){lose=false;const h=r.headers();const f=await fetch(r.url(),{method:'POST',headers:{'content-type':'application/json',authorization:h.authorization},body:r.postData()});lost=f.status;await r.abort('failed').catch(()=>{});aborted=true;return}
     r.continue().catch(()=>{})};
    page.on('request',on);
    try{
     await press('#omf-assistant [data-assistant-send]');await until(async()=>aborted,'SETUP the lost reply failed in the browser',20000,describeNavi);const v=await settledUncertain('SETUP the lost reply settled in the browser');
     assert.equal(lost,200,'SETUP the server accepted the request');assert.equal(v.send,'送信結果を確認','SETUP the accepted request is uncertain in this tab '+JSON.stringify(v));
     const job=await claim(WG,'SETUP accepted claim');assert.equal(job.text,text,'SETUP the accepted request was claimed');
     const made=await act(WG,job,'create_company_calendar_entry',{title:plan,amount:900,currency:'JPY',dueDate:localDay(),type:'expense',category:'事務費'},1);assert.equal(made.status,200,'SETUP plan '+made.raw.slice(0,200));await answered(WG,job,reply);
     const live=await ok(COMPANY,ge);const archived=await ok(COMPANY+'/new',ge,'POST',{chatRevision:live.conversation.revision,requestId:hex32()});assert.equal(archived.conversation.turns.length,0,'SETUP another tab archived it');
    }finally{holding=false;page.off('request',on);const next=freshRead('the other tab archived it');for(const r of held)await r.continue().catch(()=>{});await page.setRequestInterception(false);await next}
    await until(()=>page.evaluate(()=>document.querySelectorAll('#omf-assistant [data-workspace-turn]').length===0),'SETUP this tab shows the new chat',30000);await pause(1000);
    const v=await navi();assert.equal(v.send,'送信結果を確認','SETUP still uncertain after the other tab archived it '+JSON.stringify(v));const ids=await pendingNow();assert.equal(ids.length,1,'SETUP one uncertain request');return ids[0]};
   // (a) "Send result check" with an edited composer: recognised from the archive, History shows the archived turn and receipt.
   const first=await acceptedThenArchived('RECEIVED_EDITED_TEXT','RECEIVED_EDITED_PLAN','RECEIVED_EDITED_REPLY');
   await setComposer('RECEIVED_EDITED_LATER');await press('#omf-assistant [data-assistant-send]');
   let n=await until(receivedShown,'gui:accepted-archived-recognised',20000,describeNavi);
   assert.deepEqual(await pendingNow(),[],'gui:accepted-archived-recognised released');
   let shownTurn=await until(archivedTurnShown,'gui:archived-receipt-shown',10000,describeNavi);
   assert.ok(shownTurn.text.includes('RECEIVED_EDITED_TEXT')&&shownTurn.text.includes('RECEIVED_EDITED_REPLY')&&shownTurn.states.join()==='done','gui:archived-receipt-shown '+JSON.stringify(shownTurn));
   await press('#omf-assistant [data-assistant-view="chat"]');n=await until(async()=>{const v=await navi();return v.view==='chat'&&v.composer!==null?v:null},'SETUP chat view',10000,describeNavi);
   assert.equal(n.composer,'RECEIVED_EDITED_LATER','gui:accepted-edited-text-kept '+JSON.stringify(n));assert.equal(n.send,'送信','gui:accepted-archived-recognised '+JSON.stringify(n));
   await pause(2000);let conv=await conversation(G,GE);assert.equal(conv.turns.filter(x=>x.id===first).length,0,'gui:accepted-not-resent');assert.ok(!['queued','working'].includes(conv.state),'gui:accepted-not-resent');
   assert.equal(await db.collection('payments').countDocuments({title:'RECEIVED_EDITED_PLAN'}),1,'gui:accepted-not-resent');seen('gui|received-send');
   // (b) New chat with the unchanged composer (no turns shown; the uncertain request keeps the entry point): accepted from the archive,
   //     the unchanged text cleared, the archived turn and receipt shown, nothing resent.
   await acceptedThenArchived('RECEIVED_RESET_TEXT','RECEIVED_RESET_PLAN','RECEIVED_RESET_REPLY');
   assert.equal((await newChatButton()).disabled,false,'gui:empty-new-chat-entry accepted');
   await press('#omf-assistant [data-assistant-new-chat]');
   n=await until(receivedShown,'gui:reset-accepted-history-shown',20000,describeNavi);
   shownTurn=await until(archivedTurnShown,'gui:reset-accepted-history-shown turn',10000,describeNavi);assert.ok(shownTurn.text.includes('RECEIVED_RESET_TEXT')&&shownTurn.text.includes('RECEIVED_RESET_REPLY')&&shownTurn.states.join()==='done','gui:reset-accepted-history-shown '+JSON.stringify(shownTurn));
   assert.deepEqual(await pendingNow(),[],'gui:reset-accepted-released');
   await press('#omf-assistant [data-assistant-view="chat"]');n=await until(async()=>{const v=await navi();return v.view==='chat'&&v.composer!==null?v:null},'SETUP chat view',10000,describeNavi);
   assert.equal(n.composer,'','gui:reset-accepted-unchanged-text-cleared '+JSON.stringify(n));
   await pause(2000);conv=await conversation(G,GE);assert.equal(conv.turns.length,0,'gui:accepted-not-resent reset');assert.equal(await db.collection('payments').countDocuments({title:'RECEIVED_RESET_PLAN'}),1,'gui:accepted-not-resent reset');seen('gui|received-reset');
   // (c) A lost New chat reply (the server fenced the request; the test fails the browser's copy) keeps the request, also across a
   //     same-identity token refresh. The person then sends it ("send result check"): never accepted before, so this is its one
   //     acceptance. A newer uncertain request p2 follows; the next New chat sends the frozen reset id and p1's identity again, and its
   //     answer (p1 accepted) never resolves p2. A later New chat (a new reset id) answers for p2: not accepted, released, text kept.
   //     Exactly one interceptor owns each induced loss: the lost New chat's interceptor ends as soon as that reply is lost, p2's lost first
   //     copy has its own (dropFirstCopy), and the retried New chat is only observed (waitForRequest), never intercepted. (2026-10-23: an
   //     earlier version kept the New chat interceptor active around dropFirstCopy; puppeteer runs request listeners in registration order
   //     and a priority-less continue() marks the request handled at once, so the outer listener continued p2's send before the inner one
   //     could fail it, and the server accepted p2: full-02's SETUP failure, a test fault.)
   await setComposer('RECEIVED_LOST_RESET_TEXT');await dropFirstCopy('lost reset');const p1=(await pendingNow())[0];
   let lostBody=null,lostReset=null,resetAborted=false;
   const onReset=async r=>{let u;try{u=new URL(r.url())}catch{}if(!lostBody&&r.method()==='POST'&&u?.pathname===COMPANY+'/new'){lostBody=JSON.parse(r.postData()||'{}');const h=r.headers();const f=await fetch(r.url(),{method:'POST',headers:{'content-type':'application/json',authorization:h.authorization},body:r.postData()});lostReset={status:f.status,body:await f.json().catch(()=>null)};await r.abort('failed').catch(()=>{});resetAborted=true;return}r.continue().catch(()=>{})};
   await page.setRequestInterception(true);page.on('request',onReset);
   try{
    await pressNewChat();await until(async()=>resetAborted,'SETUP the lost New chat reply failed in the browser',20000,async()=>JSON.stringify({navi:await navi().catch(e=>String(e)),newChat:await newChatButton().catch(e=>String(e)),pending:await pendingNow().catch(e=>String(e)),lostBody,lostReset}));
    n=await settledUncertain('SETUP the lost New chat settled in the browser');
   }finally{page.off('request',onReset);await page.setRequestInterception(false)}
   assert.equal(lostReset.status,200,'SETUP the server answered the lost New chat '+JSON.stringify(lostReset));assert.equal(lostReset.body?.reset?.pending?.outcome,'not_accepted','SETUP the server fenced the request '+JSON.stringify(lostReset.body?.reset));
   assert.deepEqual(await pendingNow(),[p1],'gui:lost-reset-pending-kept');assert.equal(n.send,'送信結果を確認','gui:lost-reset-pending-kept '+JSON.stringify(n));
   const refreshed=await page.evaluate(async()=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'),claims=t=>JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),before=user.token,result=await user.refreshAuthToken();return{result,changed:before!==user.token,same:claims(before).userId===claims(user.token).userId&&claims(before).organizationId===claims(user.token).organizationId}});
   assert.deepEqual(refreshed,{result:'refreshed',changed:true,same:true},'SETUP same-identity token refresh '+JSON.stringify(refreshed));await pause(1500);
   assert.deepEqual(await pendingNow(),[p1],'gui:refresh-keeps-pending');assert.equal((await navi()).send,'送信結果を確認','gui:refresh-keeps-pending');
   await freshRead('the lost New chat');await beat(WG);await press('#omf-assistant [data-assistant-send]');await until(async()=>(await navi()).composer==='','SETUP the request accepted once',20000,describeNavi);
   assert.equal(await turnsWith(GE,'RECEIVED_LOST_RESET_TEXT'),1,'SETUP the request accepted once');assert.deepEqual(await pendingNow(),[],'SETUP the request resolved');
   const p1Job=await claim(WG,'SETUP p1 claim');assert.equal(p1Job.text,'RECEIVED_LOST_RESET_TEXT','SETUP p1 claimed');await answered(WG,p1Job,'RECEIVED_P1_REPLY');
   await until(async()=>{const v=await navi();return !v.composerDisabled&&await transcriptHas('RECEIVED_P1_REPLY')},'SETUP idle again',30000,describeNavi);
   await setComposer('RECEIVED_SECOND_TEXT');await dropFirstCopy('second');const p2=(await pendingNow())[0];assert.notEqual(p2,p1,'SETUP a different request');
   assert.equal(await turnsWith(GE,'RECEIVED_SECOND_TEXT'),0,'SETUP the first copy of p2 never reached the server');
   const retriedRequest=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname===COMPANY+'/new',{timeout:30000}),retriedAnswer=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===COMPANY+'/new',{timeout:30000});
   await pressNewChat();const retried=JSON.parse((await retriedRequest).postData()||'{}');assert.equal((await retriedAnswer).status(),200,'SETUP the retried New chat answered');
   assert.deepEqual([retried.requestId,retried.pending?.requestId,retried.pending?.text],[lostBody.requestId,p1,'RECEIVED_LOST_RESET_TEXT'],'gui:lost-reset-same-identity '+JSON.stringify({lost:lostBody,retried}));
   await pause(1500);n=await navi();assert.deepEqual(await pendingNow(),[p2],'gui:other-pending-kept '+JSON.stringify(n));assert.equal(n.send,'送信結果を確認','gui:other-pending-kept '+JSON.stringify(n));assert.equal(n.composer,'RECEIVED_SECOND_TEXT','gui:other-pending-kept');
   await pressNewChat();n=await until(async()=>{const v=await navi();return v.send==='送信'?v:null},'gui:later-reset-resolves',20000,describeNavi);
   assert.deepEqual(await pendingNow(),[],'gui:later-reset-resolves');assert.equal(n.composer,'RECEIVED_SECOND_TEXT','gui:later-reset-resolves text '+JSON.stringify(n));
   await pause(2000);assert.equal(await turnsWith(GE,'RECEIVED_SECOND_TEXT'),0,'gui:no-automatic-resend lost reset');seen('gui|received-lost-reset');
   // (d) A New chat answer arriving after another tab switched company resolves nothing; back in company E the request is still
   //     uncertain, and a New chat there resolves it.
   await setComposer('RECEIVED_SWITCH_TEXT');await dropFirstCopy('switch');const p3=await pendingNow();
   const tab=await pendingTab();let heldReset=null,onHoldReset=null;
   try{
    try{
     await page.setRequestInterception(true);onHoldReset=r=>{let x;try{x=new URL(r.url())}catch{}if(!heldReset&&r.method()==='POST'&&x?.pathname===COMPANY+'/new'){heldReset=r;return}r.continue().catch(()=>{})};page.on('request',onHoldReset);
     await pressNewChat();await until(async()=>!!heldReset,'SETUP the New chat request is held',20000);
     await switchTab(tab,GB);await until(async()=>(await navi()).company.includes('Synthetic selection GUI B'),'SETUP this tab follows the other tab to company B',20000,describeNavi);
     const release=heldReset;heldReset={done:true};const reply=page.waitForResponse(r=>r.request()===release,{timeout:30000});await release.continue();const resp=await reply;
     assert.equal(resp.status(),200,'SETUP the company E New chat completed');assert.equal((await resp.json())?.reset?.pending?.outcome,'not_accepted','SETUP the server fenced the company E request');await pause(1500);
    }finally{if(onHoldReset)page.off('request',onHoldReset);if(heldReset&&!heldReset.done)await heldReset.continue().catch(()=>{});await page.setRequestInterception(false)}
    await switchTab(tab,GE);await until(async()=>(await navi()).company.includes('Synthetic selection GUI E'),'SETUP this tab follows the other tab back to company E',20000,describeNavi);await pause(1500);
    n=await navi();assert.deepEqual(await pendingNow(),p3,'gui:switched-response-not-applied '+JSON.stringify(n));assert.equal(n.send,'送信結果を確認','gui:switched-response-not-applied '+JSON.stringify(n));assert.equal(n.composer,'RECEIVED_SWITCH_TEXT','gui:switched-response-not-applied');
   }finally{await tab.close().catch(()=>{})}
   await pressNewChat();n=await until(async()=>{const v=await navi();return v.send==='送信'?v:null},'gui:switched-later-reset-resolves',20000,describeNavi);
   assert.deepEqual(await pendingNow(),[],'gui:switched-later-reset-resolves');assert.equal(n.composer,'RECEIVED_SWITCH_TEXT','gui:switched-later-reset-resolves text');
   await setComposer('');await closeNavi();await adopt(GA);seen('gui|received-switch');
   pass('accepted and lost replies: an archived accepted request is recognised by send result check (edited text kept) or by New chat (unchanged text cleared) with its archived turn and receipt shown and nothing resent; a lost New chat reply keeps the request across a same-identity refresh, the next New chat reuses the frozen reset id and request identity and never resolves a newer request; an answer after a company switch resolves nothing');
  });
  assert.deepEqual(errors,[],'gui:no-runtime-errors');
 }catch(error){failure=error}
 // Owned cleanup (Chrome closed, its own profile removed): every step runs, each problem is printed (CLEANUP) and none can replace the
 // run's own result.
 const problems=[],step=async(name,fn)=>{try{await fn()}catch(e){problems.push(name+': '+String(e?.message||e).slice(0,300))}};
 clearInterval(keepAlive);
 await step('chrome',async()=>{if(browser)await browser.close()});
 await step('profile',async()=>{if(!directory)return;assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-navi-selection-chrome-'));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500})});
 for(const p of problems)console.log('CLEANUP '+p);
 if(failure)throw failure;
 if(problems.length)throw Error('SETUP owned Chrome cleanup failed: '+problems.join(' | '));
};
// The integration loads the heavy dependency before starting its app/HTTP setup.
module.exports.prepare=prepareBrowser;

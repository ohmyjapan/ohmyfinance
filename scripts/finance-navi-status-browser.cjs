'use strict';
// Closed Navi status and read state in actual installed Google Chrome (headless, own temporary profile) against the owned native app
// of scripts/finance-navi-status-integration.cjs. Hidden tabs are genuine (another tab brought to the front; document.visibilityState
// is never redefined), the occlusion is a real page modal, scrolling is the mouse wheel, another tab's sign-out is a real second tab
// of the same origin whose own store clears the shared session (Chrome delivers the storage event; nothing is dispatched by hand). The
// screen lock is the app's own lock broadcast (BroadcastChannel), not an operating-system lock. Worker replies and research results
// are simulated through the native worker routes. Labels starting with gui: name the behaviour a defect must break; SETUP is
// preparation. The layout baseline group (gui-layout-baseline) measures the same page and sizes on a prior release: layout only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync,readFileSync}=require('node:fs');
const root=path.resolve(__dirname,'..');let preparedBrowser;
function prepareBrowser(){
 if(preparedBrowser)return preparedBrowser;
 try{preparedBrowser=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;preparedBrowser=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 return preparedBrowser;
}
module.exports=async ctx=>{
 const {db,origin,call,ok,register,company,switchTo,card,statement,workerOf,chatWorker,beat,researchAlive,reply,claim,answered,lose,chatClaim,chatAnswer,wsSent,coSent,puSent,draftPath,researchPath,chatPath,bind,finishResearch,turnOf,pause,hex32,pass,seen,wants,owners,companies,purchases,agents,orgs,member,WORKSPACE,COMPANY,timing,SETUP_READY_MS,BASELINE}=ctx;
 const puppeteer=prepareBrowser();
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 assert.ok(executablePath,'SETUP installed Chrome');
 const shots=process.env.OMF_NAVI_STATUS_SCREENSHOTS;let directory,browser,page,keepAlive,pauseBeat=false,failure=null;const errors=[],requests=[],geometry=[];
 const shot=async name=>{if(shots){await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,name+'.png'),captureBeyondViewport:false})}};
 // The GUI person: owner of two companies, one card with a statement, a workspace worker and a research worker.
 const G=await register('gui','Synthetic GUI owner'),GA=await company('gui-a','Synthetic GUI A',[]),GB=await company('gui-b','Synthetic GUI B',[]);
 await orgs.updateMany({_id:{$in:[GA,GB]}},{$set:{members:[member(G,'owner')]}});
 const ga=await switchTo(G,GA),gb=await switchTo(G,GB),acct=await card(G,'61111'),importG=await statement(G,acct,['Synthetic GUI purchase two','Synthetic GUI purchase three']);
 const WG=await workerOf(G,[acct],{workspaceEnabled:true}),RG=await workerOf(G,[acct],{researchEnabled:true});await beat(WG);await researchAlive(RG);
 const ownerTurn=async id=>turnOf(await owners.findOne({ownerId:G.id}),id),companyTurn=async(org,id)=>turnOf(await companies.findOne({ownerId:G.id,organizationId:org}),id);
 const purchaseTurn=async(line,id)=>turnOf(await purchases.findOne({ownerId:G.id,importId:new ctx.ObjectId(importG),line}),id);
 const ownerReply=async(text,summary)=>{const id=await wsSent(G.token,text);const job=await claim(WG,'SETUP gui owner claim');assert.equal(job.companyScoped,undefined,'SETUP owner job');await answered(WG,job,summary);return id};
 const companyReply=async(token,text,summary)=>{const id=await coSent(token,text);const job=await claim(WG,'SETUP gui company claim');assert.equal(job.companyScoped,true,'SETUP company job');await answered(WG,job,summary);return id};
 const newChat=async(route,token)=>{const conv=(await ok(route,token)).conversation;if(conv?.turns?.length)await ok(route+'/new',token,'POST',{chatRevision:conv.revision,requestId:hex32()})};
 // describe(): what was last observed, named in a timeout failure (diagnosis only; the condition itself is unchanged).
 const until=async(probe,label,ms=20000,describe=null)=>{const end=Date.now()+ms;for(;;){const v=await probe();if(v)return v;if(Date.now()>end)assert.fail(label+' (timed out after '+ms+' ms)'+(describe?' last '+describe():''));await pause(200)}};
 const waitFor=(fn,args,label,ms=20000)=>until(()=>page.evaluate(fn,...args),label,ms);
 const indicator=()=>page.evaluate(()=>{const t=document.querySelector('[data-assistant-toggle]'),e=t?.querySelector('[data-navi-status]'),live=document.querySelector('[data-navi-status-live]');return{kind:e?.getAttribute('data-navi-status-kind')||null,count:e?.getAttribute('data-navi-status-count')||null,text:e?.textContent.trim()||'',label:t?.getAttribute('aria-label')||'',live:live?.textContent.trim()||'',open:t?.getAttribute('aria-expanded')==='true',dock:!!document.querySelector('[data-assistant-dock]')}});
 const waitKind=(kind,label,ms=20000)=>{let last=null;return until(async()=>{const v=await indicator();last=v;return v.kind===kind?v:null},label,ms,()=>JSON.stringify(last&&{kind:last.kind,text:last.text,live:last.live}))};
 const track=(p,name)=>p.on('request',r=>{try{const u=new URL(r.url());if(u.pathname.startsWith('/api/finance-chat/')||u.pathname==='/api/auth/logout')requests.push({page:name,method:r.method(),path:u.pathname,at:Date.now()})}catch{}});
 const calls=(since,test)=>requests.filter(r=>r.page==='A'&&r.at>=since&&test(r)).length;
 const statusCalls=(since,route)=>calls(since,r=>r.method==='GET'&&(route?r.path===route:r.path.endsWith('/status')));
 const logText=()=>page.evaluate(()=>document.querySelector('#omf-assistant [role=log]')?.textContent||'');
 const openNavi=async()=>{if(!(await indicator()).open)await page.click('[data-assistant-toggle]');await waitFor(()=>document.querySelector('#omf-assistant')?.getBoundingClientRect().width>0,[],'SETUP Navi open')};
 const closeNavi=async()=>{if((await indicator()).open)await page.click('[data-assistant-close]');await waitFor(()=>document.querySelector('[data-assistant-toggle]')?.getAttribute('aria-expanded')==='false',[],'SETUP Navi closed')};
 const visit=async route=>{await page.goto(origin+route,{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('[data-assistant-toggle]'),[],'SETUP page '+route)};
 // SETUP the launcher opens the owner workspace conversation: an earlier group may have left a purchase as the saved target (the
 // existing per-owner target), which the closed status then follows. The panel's own "画面について相談" button selects it.
 const ownerTarget=async()=>{await visit('/mapping');await openNavi();const general=await page.$('#omf-assistant [data-assistant-general]');if(general){await general.click();await pause(300)}await closeNavi()};
 const switchNative=organizationId=>page.evaluate(async organizationId=>{
  const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})});if(!r.ok)throw Error('Synthetic company switch');const session=await r.json();const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.tokens.accessToken}});if(!p.ok)throw Error('Synthetic company profile');user.acceptSession({...await p.json(),tokens:session.tokens},false);
 },organizationId);
 // A reader scrolling the transcript with the mouse wheel until the element is inside it, or to the latest.
 const wheelLog=async(selector,toEnd=false)=>{const box=await page.$eval('#omf-assistant [role=log]',e=>{const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}});await page.mouse.move(box.x,box.y);
  for(let i=0;i<40;i++){const where=await page.evaluate((selector,toEnd)=>{const log=document.querySelector('#omf-assistant [role=log]'),l=log.getBoundingClientRect();if(toEnd)return log.scrollHeight-log.scrollTop-log.clientHeight<=4?0:1;const e=[...log.querySelectorAll(selector)].at(-1);if(!e)return null;const r=e.getBoundingClientRect();return r.bottom<l.top+24?-1:r.top>l.bottom-24?1:0},selector,toEnd);if(where===0)break;if(where===null)assert.fail('SETUP wheel target missing '+selector);await page.mouse.wheel({deltaY:where*300});await pause(120)}await pause(500)};
 // SETUP sign-in gets the measured readiness window (a starved host can take minutes to serve the first pages).
 const login=async()=>{await page.goto(origin+'/login',{waitUntil:'networkidle2',timeout:SETUP_READY_MS});await page.waitForSelector('#email',{visible:true,timeout:SETUP_READY_MS});await page.type('#email',G.email);await page.type('#password',G.password);await page.$eval('button[type=submit]',e=>e.click());await waitFor(()=>location.pathname==='/'&&!!document.querySelector('[data-assistant-toggle]'),[],'SETUP login',SETUP_READY_MS)};
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-navi-status-chrome-'));
  let started=Date.now();
  browser=await puppeteer.launch({executablePath,headless:true,pipe:true,timeout:SETUP_READY_MS,userDataDir:path.join(directory,'profile'),args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();track(page,'A');page.on('pageerror',e=>errors.push(String(e)));await page.setViewport({width:1440,height:1000});timing.chromeMs=Date.now()-started;
  keepAlive=setInterval(()=>{if(!pauseBeat)beat(WG).catch(()=>{});researchAlive(RG).catch(()=>{})},20000);
  started=Date.now();await login();timing.loginMs=Date.now()-started;console.log('TIMING '+JSON.stringify(timing));

  // The closed launcher's layout on the owner page at every width, height and size, raw (kept in the screenshots' geometry.json).
  // overflow names the outermost elements whose box passes the viewport's right edge (where a horizontal overflow comes from).
  const viewports=[{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1365,height:900},{width:1440,height:1000},{width:1440,height:600},{width:390,height:600}],sizes=['large','medium','small'];
  const measure=()=>page.evaluate(()=>{const q=s=>document.querySelector(s),rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{left:Math.round(r.left*10)/10,right:Math.round(r.right*10)/10,top:Math.round(r.top*10)/10,bottom:Math.round(r.bottom*10)/10}};const b=q('[data-assistant-toggle]'),i=b?.querySelector('[data-navi-status]'),s=getComputedStyle(b);
   const past=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1}),overflow=past.filter(e=>!past.some(o=>o!==e&&o.contains(e))).slice(0,8).map(e=>{const r=e.getBoundingClientRect();return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className.trim()?'.'+e.className.trim().split(/\s+/).slice(0,4).join('.'):'')+'@'+Math.round(r.left)+'-'+Math.round(r.right)});
   return{launcher:rect(b),dock:rect(q('[data-assistant-dock]')),content:rect(q('[data-page-content]')),indicator:rect(i),fits:!!i&&i.scrollWidth<=i.clientWidth+1,button:{background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow},bodyWidth:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,overflow}});
  const pick=async size=>{await page.click('[data-navi-size-toggle]');await page.click('[data-navi-size='+size+']');await pause(200)};
  const inside=(a,b)=>!!a&&!!b&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
  // SETUP both releases render the two known owned mapping rows, not a temporarily stable loading placeholder. The network/font
  // barrier and height settling follow actual data readiness; a stable height alone is not evidence of loaded content.
  const layoutDescriptions=['Synthetic GUI purchase two','Synthetic GUI purchase three'];
  const layoutContent=()=>page.evaluate(expected=>{const root=document.querySelector('[data-page-content] .mapping'),rows=[...root?.querySelectorAll('article[data-line]')||[]],loading=!!root&&[...root.children].some(e=>e.getAttribute('role')==='status');return{loading,rows:rows.map(e=>({line:e.getAttribute('data-line'),descriptions:expected.filter(x=>e.textContent.includes(x))})),ready:!!root&&!loading&&rows.length===expected.length&&expected.every(x=>rows.some(e=>e.textContent.includes(x))) }},layoutDescriptions);
  const settled=async()=>{await until(async()=>(await layoutContent()).ready,'SETUP expected owned mapping rows loaded',SETUP_READY_MS);await page.evaluate(()=>document.fonts.ready);let last=-1,since=0;await until(async()=>{const h=await page.evaluate(()=>Math.round(document.querySelector('[data-page-content]')?.getBoundingClientRect().height||0));if(h!==last){last=h;since=Date.now();return false}return h>0&&Date.now()-since>=1500},'SETUP owner page settled',60000);const witness=await layoutContent();assert.ok(witness.ready,'SETUP mapping rows remain loaded '+JSON.stringify(witness));return witness};
  // SETUP the measured page's network barrier is Chrome's own network-idle signal for that navigation (no connection for 0.5 s),
  // not page.waitForNetworkIdle: that page-lifetime count still held twelve requests of the earlier sign-in navigation that never
  // reported a finish (attempt 25 trace: scripts, styles, fonts, a status read, all 300 s old), so it could never become idle on
  // either runtime.
  const layoutStart=async()=>{await closeNavi();await ownerTarget();await newChat(WORKSPACE,G.token);await page.goto(origin+'/mapping',{waitUntil:'networkidle0',timeout:SETUP_READY_MS});await waitFor(()=>!!document.querySelector('[data-assistant-toggle]'),[],'SETUP page /mapping');await page.emulateMediaFeatures([]);await settled()};
  const layoutPlain=async phase=>{const out=new Map();for(const vp of viewports){await page.setViewport(vp);await pause(250);for(const size of sizes){await pick(size);const key=vp.width+'x'+vp.height+':'+size,m=await measure();out.set(key,m);geometry.push({key,phase,...m})}}return out};

  // Layout baseline (a prior release; layout only, no status exists there): the same owner page, synthetic content, widths, heights
  // and sizes, written for the candidate's layout group to compare with. It grants no status coverage.
  if(wants(BASELINE)){
   const out=process.env.OMF_NAVI_STATUS_LAYOUT_BASELINE_OUT;assert.ok(out&&path.isAbsolute(out),'SETUP layout baseline output path');
   await layoutStart();const witness=await layoutContent(),plain=await layoutPlain('baseline');await shot('baseline-layout');
   await fs.writeFile(out,JSON.stringify({at:new Date().toISOString(),app:process.env.OMF_NAVI_STATUS_APP_ROOT||'',contentWitness:witness,geometry:Object.fromEntries(plain)},null,2)+'\n',{flag:'wx'});
   pass('layout baseline: the owner page and the closed launcher measured at every width, height and size on the prior release (layout only, no status)');
  }

  // 7. Layout, the first GUI group (so the page content is the shared setup's only, exactly as in the baseline run): five widths, short
  //    heights and the three size choices keep the launcher box, the transparent character, the gutter and the content clear while the
  //    indicator sits inside the box. The same candidate page without the indicator is only the indicator's control: it shows the
  //    indicator adds no width. The page's own geometry is compared with the same measurement of the prior release
  //    (OMF_NAVI_STATUS_LAYOUT_BASELINE_IN), on the same loaded owner rows (content witness): the launcher, dock and content boxes are
  //    the same, no overflow is wider here, and an overflow there too is inherited and recorded (INHERITED_OVERFLOW); without that
  //    baseline any overflow fails. Reduced motion; opening hides both and keeps the header portrait.
  if(wants('gui-layout')){
   const baselineFile=process.env.OMF_NAVI_STATUS_LAYOUT_BASELINE_IN||'',baselineData=baselineFile?JSON.parse(readFileSync(baselineFile,'utf8')):null,baseline=baselineData?.geometry||null;
   await layoutStart();const plain=await layoutPlain('without-indicator');
   const where=await page.evaluate(()=>({path:location.pathname,open:document.querySelector('[data-assistant-toggle]')?.getAttribute('aria-expanded'),menu:document.querySelector('[data-navi-size-menu]')?.getClientRects().length||0}));
   await shot('layout-before-arrival');assert.equal(where.path,'/mapping','SETUP layout stays on the owner page '+JSON.stringify(where));
   // Compare actual loaded content, including its height. Keep every raw box and a data-readiness witness; do not exempt height
   // differences by assuming the earlier baseline merely had not loaded yet.
   if(baseline){assert.ok(baselineData.contentWitness?.ready,'SETUP baseline actual mapping content witness');assert.deepEqual(await layoutContent(),baselineData.contentWitness,'SETUP same owned mapping content')}
   if(baseline)for(const [key,p] of plain){const b=baseline[key];assert.ok(b&&b.width===p.width&&b.height===p.height,'SETUP baseline measured '+key);
    for(const box of['launcher','dock','content'])assert.deepEqual(p[box],b[box],'gui:geometry-same-as-baseline '+key+' '+box+' '+JSON.stringify({candidate:p[box],baseline:b[box]}))}
   await ownerReply('GUI layout question','GUI_LAYOUT_REPLY');await until(async()=>{const v=await indicator();return v.kind==='new'?v:null},'SETUP layout arrival '+JSON.stringify(where),20000).catch(async e=>{await shot('layout-no-arrival');const st=await page.evaluate(()=>{const p=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant');return JSON.stringify({status:p.naviStatus,seq:p.naviStatusSequence,open:p.open,target:p.target})});throw Object.assign(e,{message:e.message+' '+st+' '+JSON.stringify(await indicator())})});
   const inherited=[];
   for(const vp of viewports){await page.setViewport(vp);await pause(250);for(const size of sizes){
    await pick(size);const key=vp.width+'x'+vp.height+':'+size,m=await measure(),p=plain.get(key);geometry.push({key,phase:'with-indicator',...m});
    assert.equal(p.indicator,null,'SETUP no indicator before the arrival '+key);assert.deepEqual(m.launcher,p.launcher,'gui:launcher-geometry-unchanged '+key+' '+JSON.stringify({before:p.launcher,after:m.launcher}));
    assert.ok(inside(m.indicator,m.launcher),'gui:indicator-inside-launcher '+key+' '+JSON.stringify(m));assert.ok(m.fits,'gui:indicator-fits '+key);
    assert.ok(m.indicator.left>=0&&m.indicator.right<=m.width&&m.indicator.bottom<=m.height,'gui:indicator-fits '+key);
    if(vp.width>=768)assert.ok(m.content.right<=m.dock.left+1,'gui:content-clear '+key+' '+JSON.stringify(m));
    assert.deepEqual(m.button,{background:'rgba(0, 0, 0, 0)',radius:'0px',shadow:'none'},'gui:transparent-launcher '+key);
    assert.ok(m.bodyWidth<=p.bodyWidth,'gui:indicator-adds-no-width '+key+' '+JSON.stringify({without:p.bodyWidth,with:m.bodyWidth,width:m.width}));
    if(p.bodyWidth>p.width||m.bodyWidth>m.width){
     assert.ok(baseline,'gui:overflow-needs-baseline '+key+' '+JSON.stringify({bodyWidth:p.bodyWidth,width:p.width,overflow:p.overflow}));
     const b=baseline[key];assert.ok(Math.max(p.bodyWidth,m.bodyWidth)<=b.bodyWidth+1,'gui:no-overflow-beyond-baseline '+key+' '+JSON.stringify({candidate:p.bodyWidth,withIndicator:m.bodyWidth,baseline:b.bodyWidth,width:p.width,candidateOverflow:p.overflow,baselineOverflow:b.overflow}));
     inherited.push({key,width:p.width,candidate:p.bodyWidth,withIndicator:m.bodyWidth,baseline:b.bodyWidth,candidateOverflow:p.overflow,baselineOverflow:b.overflow});
    }
    if(size==='large'||size==='small')await shot('layout-'+key.replace(':','-'));
   }}
   if(inherited.length)console.log('INHERITED_OVERFLOW '+JSON.stringify(inherited));
   seen('gui|five-widths-three-sizes-short');if(baseline)seen('gui|layout-baseline-compared');
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);const rm=await page.$eval('[data-navi-status]',e=>{const s=getComputedStyle(e);return{animation:s.animationName,transition:s.transitionDuration}});
   assert.equal(rm.animation,'none','gui:reduced-motion');assert.ok(/^0s(, 0s)*$/.test(rm.transition),'gui:reduced-motion '+rm.transition);await page.emulateMediaFeatures([]);
   await page.setViewport({width:1440,height:1000});await pause(250);await openNavi();
   const open=await page.evaluate(()=>{const p=document.querySelector('#omf-assistant header .navi-avatar'),r=p?.getBoundingClientRect();return{launcher:document.querySelector('[data-assistant-toggle]').getClientRects().length,indicator:document.querySelector('[data-navi-status]')?.getClientRects().length||0,portrait:p?{width:r.width,height:r.height,radius:getComputedStyle(p).borderRadius}:null}});
   assert.equal(open.launcher,0,'gui:open-hides-indicator');assert.equal(open.indicator,0,'gui:open-hides-indicator');assert.ok(open.portrait&&Math.abs(open.portrait.width-44)<=1&&open.portrait.radius==='50%','gui:header-portrait '+JSON.stringify(open.portrait));await shot('open-1440');
   await closeNavi();await pick('large');seen('gui|open-closed-motion');
   pass('layout: the indicator sits inside the unchanged launcher box at 390/768/1024/1365/1440, short heights and all three sizes and adds no width; launcher, dock and content boxes as on the prior release for the same loaded rows, no overflow wider than there (an inherited one recorded); transparent character, gutter and content clear; reduced motion; hidden while open');
  }

  // 8. Closed: the parent reads the selected conversation's status before any transcript mounts; queued, reconnect, working, new and
  //    failed come from server facts; a claim whose deadline passed is not progress even with the worker fresh, until the native claim
  //    takes it over; reload keeps an unread arrival; only the visible reply in the open chat acknowledges it.
  if(wants('gui-closed')){
   await closeNavi();await ownerTarget();await newChat(WORKSPACE,G.token);const t0=Date.now();await visit('/mapping');
   assert.equal(await page.$('#omf-assistant [role=log]'),null,'gui:transcript-not-mounted');
   await until(async()=>statusCalls(t0,WORKSPACE+'/status')>0,'gui:closed-status-polls',12000);
   assert.equal(calls(t0,r=>r.method==='GET'&&r.path===WORKSPACE),0,'gui:no-hidden-transcript-read');assert.equal((await indicator()).kind,null,'gui:idle-no-indicator');
   const t1=await wsSent(G.token,'GUI_CLOSED_QUESTION');await waitKind('queued','gui:queued-indicator');
   pauseBeat=true;await agents.updateOne({_id:WG._id},{$set:{chatLastSeenAt:new Date(Date.now()-600000)}});// SETUP synthetic offline worker
   await waitKind('reconnect','gui:reconnect-indicator');pauseBeat=false;await beat(WG);
   await claim(WG,'SETUP closed claim');await waitKind('working','gui:working-indicator');
   // The claim's deadline passes with no finish while the worker stays fresh (its heartbeat keeps running): no progress is shown.
   await owners.updateOne({ownerId:G.id},{$set:{leaseUntil:new Date(Date.now()-60000)}});// SETUP synthetic: the deadline passed
   const iv=await waitKind('interrupted','gui:expired-work-not-active');assert.ok(!iv.label.includes('回答を作成しています')&&!iv.live.includes('回答を作成しています'),'gui:expired-work-not-active '+iv.label);
   // The live worker's native claim takes it over (its second attempt): progress is shown again under the new deadline only.
   await beat(WG);const job=await claim(WG,'SETUP closed takeover');await waitKind('working','gui:takeover-working');seen('gui|expired-work');
   await answered(WG,job,'GUI_CLOSED_REPLY');const v=await waitKind('new','gui:closed-arrival');await shot('closed-new-1440');
   assert.equal(v.count,'1','gui:closed-arrival');assert.ok(v.label.includes('新しい回答')&&v.label.includes('画面についての会話'),'gui:accessible-label '+v.label);assert.ok(v.live.includes('新しい回答'),'gui:live-region '+v.live);
   assert.equal(await page.$('#omf-assistant [role=log]'),null,'gui:transcript-not-mounted');assert.equal((await ownerTurn(t1)).seenReplyVersion,undefined,'gui:closed-no-ack');
   await page.reload({waitUntil:'networkidle2'});await waitKind('new','gui:reload-keeps-unread');
   await openNavi();await until(async()=>(await logText()).includes('GUI_CLOSED_REPLY'),'SETUP reply rendered');
   await until(async()=>(await ownerTurn(t1))?.seenReplyVersion===1,'gui:open-visible-acks',10000);
   await closeNavi();await until(async()=>(await indicator()).kind===null,'gui:read-clears-indicator',12000);
   await page.reload({waitUntil:'networkidle2'});await pause(5000);assert.equal((await indicator()).kind,null,'gui:reload-keeps-read');
   await wsSent(G.token,'GUI_FAILED_QUESTION');const j2=await claim(WG,'SETUP failed claim');assert.equal((await lose(WG,j2)).status,200,'SETUP failed reply');
   await waitKind('failed','gui:failed-indicator');seen('gui|closed-lanes');
   pass('closed Navi: parent status before any transcript, queued/reconnect/working/interrupted/new/failed from server facts (a passed deadline is not progress with a fresh worker), accessible label and live text, reload, and acknowledgement only when the open reply is visible');
  }

  // 9. An older reader: an unsolicited reply keeps the position and offers a jump; off-screen, history, memory and minimized replies are
  //    not acknowledged; the jump, the chat view, a tall paragraph and reopening at the latest are (company realm).
  if(wants('gui-reader')){
   await closeNavi();await switchNative(String(GA));await newChat(COMPANY,ga);await page.setViewport({width:1440,height:900});await visit('/transactions');
   const long=i=>'GUI_READER_'+i+' '+'これは長い合成の回答です。'.repeat(60),history=[];
   for(let i=0;i<4;i++)history.push(await companyReply(ga,'GUI reader question '+i,long(i)));
   await openNavi();await until(async()=>(await logText()).includes('GUI_READER_3'),'SETUP history rendered');
   await until(async()=>(await companyTurn(GA,history[3]))?.seenReplyVersion===1,'gui:latest-visible-acks',10000);
   const box=await page.$eval('#omf-assistant [role=log]',e=>{const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}});
   await page.mouse.move(box.x,box.y);for(let i=0;i<8;i++){await page.mouse.wheel({deltaY:-1500});await pause(120)}await pause(800);
   const top=await page.$eval('#omf-assistant [role=log]',e=>e.scrollTop);assert.ok(top<200,'SETUP reader scrolled up '+top);
   const n1=await companyReply(ga,'GUI reader new','GUI_READER_NEW '+'新しい合成回答です。'.repeat(40));
   await until(async()=>(await logText()).includes('GUI_READER_NEW'),'SETUP new reply rendered',15000);await pause(900);
   const after=await page.$eval('#omf-assistant [role=log]',e=>e.scrollTop);assert.ok(Math.abs(after-top)<=2,'gui:older-reader-position '+top+' -> '+after);
   assert.ok(await page.evaluate(()=>{const e=document.querySelector('#omf-assistant [data-navi-reply-jump]');return !!e&&e.getBoundingClientRect().height>0}),'gui:jump-offered');await shot('reader-jump');
   await pause(2500);assert.equal((await companyTurn(GA,n1)).seenReplyVersion,undefined,'gui:offscreen-no-ack');
   await page.click('#omf-assistant [data-navi-reply-jump]');await until(async()=>(await companyTurn(GA,n1))?.seenReplyVersion===1,'gui:jump-reveals-and-acks',10000);seen('gui|older-reader');
   await page.mouse.move(box.x,box.y);for(let i=0;i<10;i++){await page.mouse.wheel({deltaY:2500});await pause(100)}await pause(800);
   await page.click('[data-assistant-history-toggle]');await waitFor(()=>!!document.querySelector('[data-assistant-history]'),[],'SETUP history view');
   const n2=await companyReply(ga,'GUI reader history','GUI_READER_HISTORY_REPLY');await until(async()=>(await logText()).includes('GUI_READER_HISTORY_REPLY'),'SETUP rendered behind the history view',15000);
   await pause(2000);assert.equal((await companyTurn(GA,n2)).seenReplyVersion,undefined,'gui:history-no-ack');
   await page.click('[data-assistant-knowledge-toggle]');await waitFor(()=>!!document.querySelector('[data-assistant-knowledge]'),[],'SETUP memory view');await pause(2000);assert.equal((await companyTurn(GA,n2)).seenReplyVersion,undefined,'gui:memory-no-ack');
   await page.click('[data-assistant-view=chat]');await until(async()=>(await companyTurn(GA,n2))?.seenReplyVersion===1,'gui:chat-view-acks',10000);seen('gui|history-memory');
   const n3=await companyReply(ga,'GUI reader tall','GUI_READER_TALL '+'とても長い一段落の合成回答です。'.repeat(240));
   await until(async()=>(await companyTurn(GA,n3))?.seenReplyVersion===1,'gui:tall-reply-acked',15000);
   const tall=await page.evaluate(()=>{const els=[...document.querySelectorAll('#omf-assistant [data-navi-reply]')],e=els.at(-1),log=e.closest('[role=log]');return{height:e.getBoundingClientRect().height,view:log.clientHeight}});assert.ok(tall.height>tall.view,'SETUP tall reply is taller than the transcript '+JSON.stringify(tall));seen('gui|tall');
   await closeNavi();const n4=await companyReply(ga,'GUI reader minimized','GUI_READER_MINIMIZED_REPLY');
   const v=await waitKind('new','gui:company-closed-arrival');assert.ok(v.label.includes('Synthetic GUI A'),'gui:accessible-label '+v.label);assert.equal((await companyTurn(GA,n4)).seenReplyVersion,undefined,'gui:minimized-no-ack');
   await openNavi();await until(async()=>(await companyTurn(GA,n4))?.seenReplyVersion===1,'gui:reopen-acks',12000);await closeNavi();seen('gui|minimized');
   pass('older reader keeps the position with a jump; off-screen, history, memory and minimized replies stay unread; the jump, the chat view, a tall paragraph and reopening acknowledge');
  }

  // 10. Genuine hidden tab: status polling pauses and returns on visibility; a reply rendered while hidden is acknowledged only when the
  //     tab is visible again; the app's screen-lock broadcast (not an operating-system lock) pauses and unlock refreshes; a second tab
  //     of the same origin signing out locally stops this tab's reads through Chrome's own storage event, without a new sign-out path.
  if(wants('gui-hidden')){
   await closeNavi();await ownerTarget();await newChat(WORKSPACE,G.token);await visit('/mapping');
   const other=await browser.newPage();track(other,'B');await other.goto('about:blank');
   await other.bringToFront();await waitFor(()=>document.visibilityState==='hidden',[],'SETUP genuine hidden tab',5000);
   let t0=Date.now();await pause(10000);assert.equal(statusCalls(t0),0,'gui:hidden-status-paused '+statusCalls(t0));
   t0=Date.now();await page.bringToFront();await waitFor(()=>document.visibilityState==='visible',[],'SETUP visible again',5000);await until(async()=>statusCalls(t0)>0,'gui:visible-status-refresh',4000);
   await openNavi();await waitFor(()=>!!document.querySelector('#omf-assistant [role=log]'),[],'SETUP transcript');
   await other.bringToFront();await waitFor(()=>document.visibilityState==='hidden',[],'SETUP hidden with Navi open',5000);
   const h1=await ownerReply('GUI hidden question','GUI_HIDDEN_REPLY');
   await until(async()=>(await logText()).includes('GUI_HIDDEN_REPLY'),'SETUP reply rendered in the hidden tab',25000);
   await pause(3000);assert.equal((await ownerTurn(h1)).seenReplyVersion,undefined,'gui:hidden-no-ack');
   await page.bringToFront();await until(async()=>(await ownerTurn(h1))?.seenReplyVersion===1,'gui:visible-acks',10000);seen('gui|hidden-tab');
   await closeNavi();
   await page.evaluate(()=>{const c=new BroadcastChannel('ohmyfinance_activity_sync');c.postMessage({type:'lock',timestamp:Date.now()+1000});setTimeout(()=>c.close(),100)});
   await waitFor(()=>!document.querySelector('[data-assistant-dock]'),[],'SETUP locked');t0=Date.now();await pause(9000);assert.equal(statusCalls(t0),0,'gui:locked-status-paused');
   t0=Date.now();await page.evaluate(()=>{const c=new BroadcastChannel('ohmyfinance_activity_sync');c.postMessage({type:'unlock',timestamp:Date.now()});setTimeout(()=>c.close(),100)});
   await waitFor(()=>!!document.querySelector('[data-assistant-dock]'),[],'SETUP unlocked');await until(async()=>statusCalls(t0)>0,'gui:unlock-refresh',6000);seen('gui|lock');
   // The second tab opens the app on the shared local session; its own user store then clears that session (the local sign-out the
   // app's logout performs first; no server logout call, so this is no token-revocation evidence). Chrome itself delivers the storage
   // event here (trusted: never constructed or dispatched by this test); this tab only records it, signs out and stops its reads.
   await page.evaluate(()=>{window.__naviStorage=[];window.addEventListener('storage',e=>{if(e.key==='ohmyfinance_session')window.__naviStorage.push({cleared:e.newValue===null,trusted:e.isTrusted})})});
   await other.goto(origin+'/mapping',{waitUntil:'networkidle2'});await other.waitForFunction(()=>!!document.querySelector('[data-assistant-dock]'),{timeout:30000});
   assert.ok(await page.evaluate(()=>!!document.querySelector('[data-assistant-dock]')),'SETUP this tab still signed in');
   const signOut=Date.now();await other.evaluate(()=>{document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').clearSession()});
   await waitFor(()=>!document.querySelector('[data-assistant-dock]'),[],'gui:other-tab-sign-out');
   const storage=await page.evaluate(()=>window.__naviStorage);assert.ok(storage.some(e=>e.cleared&&e.trusted),'gui:genuine-storage-event '+JSON.stringify(storage));
   assert.equal(requests.filter(r=>r.path==='/api/auth/logout'&&r.at>=signOut).length,0,'SETUP local sign-out only (no server logout)');
   t0=Date.now();await pause(9000);assert.equal(statusCalls(t0),0,'gui:logout-stops');seen('gui|sign-out');
   // SETUP a clean sign-in for the next groups (the legacy session mirrors would otherwise restore this session on navigation).
   await other.close();await page.evaluate(()=>{for(const k of['auth_token','auth_refresh_token','auth_user','auth_tokens','current_organization_id','ohmyfinance_session'])localStorage.removeItem(k)});await login();
   pass('genuine hidden tab pauses status and acknowledgement until visible again; the app lock broadcast (not an OS lock) pauses and unlock refreshes; a second same-origin tab signing out locally (a genuine Chrome storage event) stops the reads');
  }

  // 11. Scope: a status read issued under company A that answers after the switch to B is dropped; a removed membership clears that
  //     company's status without signing out and stops its reads; a restored membership recovers on the next authorized refresh.
  if(wants('gui-scope')){
   await closeNavi();await switchNative(String(GA));await newChat(COMPANY,ga);await newChat(COMPANY,gb);await visit('/transactions');
   await companyReply(ga,'GUI scope A','GUI_SCOPE_A_REPLY');await waitKind('new','SETUP company A arrival');
   let held=null,holdNext=true;await page.setRequestInterception(true);
   const onRequest=r=>{let u;try{u=new URL(r.url())}catch{}if(holdNext&&r.method()==='GET'&&u?.pathname===COMPANY+'/status'){holdNext=false;held=r;return}r.continue().catch(()=>{})};
   page.on('request',onRequest);
   try{
    await until(async()=>!!held,'SETUP held company A status read',10000);
    await switchNative(String(GB));await until(async()=>{const v=await indicator();return v.kind===null},'SETUP company B shows its own status',12000);
    await held.continue().catch(()=>{});await pause(2500);
    assert.equal((await indicator()).kind,null,'gui:stale-scope-dropped');seen('gui|stale-scope');
   }finally{page.off('request',onRequest);if(held)await held.continue().catch(()=>{});await page.setRequestInterception(false)}
   await companyReply(gb,'GUI scope B','GUI_SCOPE_B_REPLY');const b=await waitKind('new','SETUP company B arrival');assert.ok(b.label.includes('Synthetic GUI B'),'gui:accessible-label '+b.label);
   await orgs.updateOne({_id:GB},{$pull:{members:{userId:G.id}}});// SETUP synthetic membership removal
   await until(async()=>(await indicator()).kind===null,'gui:revoked-clears',12000);
   const still=await indicator();assert.equal(still.dock,true,'gui:no-logout-on-403');assert.equal(await page.evaluate(()=>location.pathname),'/transactions','gui:no-logout-on-403');
   let t0=Date.now();await pause(9000);assert.equal(statusCalls(t0,COMPANY+'/status'),0,'gui:revoked-stops-polling');
   await orgs.updateOne({_id:GB},{$push:{members:member(G,'owner')}});// SETUP membership restored
   const other=await browser.newPage();await other.bringToFront();await pause(500);await page.bringToFront();await other.close();
   await waitKind('new','gui:restored-recovers',12000);seen('gui|revoked-restored');
   await switchNative(String(GA));
   pass('scope: a late status read of the previous company is dropped; a removed membership clears its status without signing out and stops its reads; restoration recovers');
  }

  // 12. Purchase realm: the reply and its linked research result arrive while closed; a real page modal covering Navi blocks the
  //     acknowledgement until it closes; applying the same report brings no new arrival.
  if(wants('gui-purchase')){
   await closeNavi();await newChat(chatPath(importG,2),G.token);await page.setViewport({width:1440,height:1000});await visit('/mapping-draft/'+importG+'/2');
   const p1=await puSent(G.token,importG,2,'GUI purchase question');const job=await chatClaim(WG,'SETUP gui purchase claim');
   assert.equal((await chatAnswer(WG,job,reply('GUI_PURCHASE_REPLY','GUI synthetic research: 勘定科目と登録番号の候補を確認'))).status,200,'SETUP gui purchase reply');
   const v=await waitKind('new','gui:purchase-closed-arrival');assert.equal(v.count,'1','gui:purchase-closed-arrival');assert.ok(v.label.includes('この購入の会話'),'gui:accessible-label '+v.label);
   await openNavi();await until(async()=>(await logText()).includes('GUI_PURCHASE_REPLY'),'SETUP purchase reply rendered');await shot('purchase-open');
   // The started research's open details form sits below the reply: the reader scrolls the reply into view, then back to the latest.
   await wheelLog('[data-navi-reply="turn"]');await until(async()=>(await purchaseTurn(2,p1))?.seenReplyVersion===1,'gui:purchase-open-acks',12000);
   await wheelLog(null,true);
   await page.evaluate(()=>[...document.querySelectorAll('[data-page-content] button')].find(b=>/を追加$/.test(b.textContent.trim()))?.click());
   await waitFor(()=>!!document.querySelector('[role=dialog][aria-modal=true]'),[],'SETUP real page modal open');
   await finishResearch(RG,'SETUP gui research job');
   await until(()=>page.evaluate(()=>!!document.querySelector('#omf-assistant [data-navi-reply=research]')),'SETUP research reply rendered under the modal',20000);await shot('purchase-covered');
   await pause(2500);assert.equal((await purchaseTurn(2,p1)).seenResearchVersion,undefined,'gui:covered-no-ack');
   await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('キャンセル'))?.click());
   await waitFor(()=>!document.querySelector('[role=dialog][aria-modal=true]'),[],'SETUP modal closed');
   await until(async()=>(await purchaseTurn(2,p1))?.seenResearchVersion===1,'gui:uncovered-acks',10000);seen('gui|covered');
   await closeNavi();await until(async()=>(await indicator()).kind===null,'gui:purchase-read-clears',12000);
   const view=await ok(researchPath(importG,2),G.token),applied=await call(researchPath(importG,2)+'/apply',G.token,'POST',{...bind(await ok(draftPath(importG,2),G.token)),researchRevision:view.research.revision,confirm:true,fields:['invoiceNumber']});
   assert.equal(applied.status,200,'SETUP gui apply '+applied.raw.slice(0,200));await pause(9000);assert.equal((await indicator()).kind,null,'gui:apply-no-badge');seen('gui|purchase-research');
   pass('purchase: reply and linked research arrive while closed; a page modal covering Navi blocks acknowledgement until closed; applying the report is no new arrival');
  }

  // 13. Reply text, not its empty block: a long reply with valid internal blank lines, wheeled (mouse) so that only its blank lines are
  //     inside the transcript, shows no character of it (measured from the actual glyph boxes of its non-whitespace text) and is not
  //     seen; its text wheeled into view is. Owner workspace realm.
  if(wants('gui-text')){
   await closeNavi();await ownerTarget();await newChat(WORKSPACE,G.token);await page.setViewport({width:1440,height:900});await visit('/mapping');
   const older=await ownerReply('GUI text older question','GUI_TEXT_OLDER '+'これは長い合成の回答です。'.repeat(80));
   await openNavi();await until(async()=>(await logText()).includes('GUI_TEXT_OLDER'),'SETUP older reply rendered');
   await until(async()=>(await ownerTurn(older))?.seenReplyVersion===1,'SETUP older reply seen',10000);
   const box=await page.$eval('#omf-assistant [role=log]',e=>{const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}});
   await page.mouse.move(box.x,box.y);for(let i=0;i<8;i++){await page.mouse.wheel({deltaY:-1500});await pause(120)}await pause(800);
   const blank=await ownerReply('GUI text blank lines','GUI_TEXT_TOP'+'\n'.repeat(90)+'GUI_TEXT_END');
   await until(async()=>(await logText()).includes('GUI_TEXT_END'),'SETUP blank-line reply rendered',15000);
   // The reply's glyph boxes: every non-whitespace run of its text (one box per line fragment), against the transcript's visible box.
   const glyphs=()=>page.evaluate(turn=>{const el=document.querySelector('#omf-assistant [data-navi-reply="turn"][data-navi-turn="'+turn+'"]'),log=el.closest('[role=log]'),l=log.getBoundingClientRect(),rects=[];
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode())for(const m of n.data.matchAll(/\S+/g)){const range=document.createRange();range.setStart(n,m.index);range.setEnd(n,m.index+m[0].length);for(const b of range.getClientRects())if(b.width>0&&b.height>0)rects.push({top:b.top,bottom:b.bottom,left:b.left,right:b.right})}
    const top=Math.max(l.top,0),bottom=Math.min(l.bottom,innerHeight),block=el.getBoundingClientRect(),hit=document.elementFromPoint((Math.max(block.left,l.left)+Math.min(block.right,l.right))/2,(top+bottom)/2);
    return{view:{top,bottom},block:{top:block.top,bottom:block.bottom},rects,inView:rects.filter(b=>b.bottom>top&&b.top<bottom).length,blockInView:block.bottom>top&&block.top<bottom,blockHit:!!hit&&(hit===el||el.contains(hit))}},blank);
   // SETUP a wheel scroll has finished (the transcript's scrollTop unchanged for 0.5 s) before the glyphs are measured.
   const scrolled=async()=>{let last=-1,since=0;await until(async()=>{const t=await page.$eval('#omf-assistant [role=log]',e=>Math.round(e.scrollTop));if(t!==last){last=t;since=Date.now();return false}return Date.now()-since>=500},'SETUP transcript scroll settled',15000)};
   let g=await glyphs();assert.equal(g.rects.length,2,'SETUP two text runs '+JSON.stringify(g.rects));
   await page.mouse.move(box.x,box.y);await page.mouse.wheel({deltaY:Math.round((g.rects[0].bottom+g.rects[1].top)/2-(g.view.top+g.view.bottom)/2)});await scrolled();
   g=await glyphs();assert.ok(g.blockInView&&g.inView===0,'SETUP only blank lines of the reply in view '+JSON.stringify({view:g.view,block:g.block,inView:g.inView,rects:g.rects}));
   await pause(3000);g=await glyphs();assert.ok(g.blockInView&&g.inView===0,'SETUP still only blank lines in view');
   assert.equal((await ownerTurn(blank)).seenReplyVersion,undefined,'gui:blank-lines-no-ack '+JSON.stringify({blockHitAtCentre:g.blockHit,view:g.view,block:g.block}));seen('gui|blank-lines');
   await page.mouse.wheel({deltaY:Math.round(g.rects[1].top-(g.view.top+g.view.bottom)/2)});await scrolled();
   g=await glyphs();assert.ok(g.inView>=1,'SETUP the reply text in view '+JSON.stringify({view:g.view,rects:g.rects}));
   await until(async()=>(await ownerTurn(blank))?.seenReplyVersion===1,'gui:reply-text-acks',10000);seen('gui|text-visible');
   await closeNavi();
   pass('reply text: a reply whose visible part holds only its blank lines is not seen (actual glyph boxes, mouse wheel); its text in view is');
  }
  assert.deepEqual(errors,[],'gui:no-runtime-errors');
 }catch(error){failure=error}
 // Owned cleanup (raw geometry kept, Chrome closed, its own profile removed): every step runs, each problem is printed (CLEANUP) and
 // none can replace the run's own result.
 const problems=[],step=async(name,fn)=>{try{await fn()}catch(e){problems.push(name+': '+String(e?.message||e).slice(0,300))}};
 await step('geometry',async()=>{if(shots){await fs.mkdir(shots,{recursive:true});await fs.writeFile(path.join(shots,'geometry.json'),JSON.stringify(geometry,null,2)+'\n')}});clearInterval(keepAlive);
 await step('chrome',async()=>{if(browser)await browser.close()});
 await step('profile',async()=>{if(!directory)return;assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-navi-status-chrome-'));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500})});
 for(const p of problems)console.log('CLEANUP '+p);
 if(failure)throw failure;
 if(problems.length)throw Error('SETUP owned Chrome cleanup failed: '+problems.join(' | '));
};
// The integration loads the heavy dependency before starting its app/HTTP setup, not between health and the first signup.
module.exports.prepare=prepareBrowser;

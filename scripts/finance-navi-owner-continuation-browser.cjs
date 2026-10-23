// Real installed Chrome against the owned synthetic native app started by finance-navi-owner-continuation-integration.cjs (chained
// only by the fixture's positive leg). No model, provider or business send; the worker replies are synthetic. Checks at 390 and
// 1280 wide: the owner workspace history / new chat / read-only inspector / explicit discussion selection, one fixed page link that
// opens only on click, the server-checked posting label (not the cached organization list), company-teaching turns masked after a
// company switch including a delayed response, the purchase chat history with archived proposals as records, and a real page refresh
// of the connections page after a Navi receipt. The original film-girl accordion and company views are not changed here.
// Then the request identity groups of plan omf-navi-agent-owner-retry-20261023 (keys chrome-*), each isolated: an uncertain owner or
// purchase send whose reply was lost (the browser's exact accepted POST sent to the native server, only the browser's copy of the reply
// failed) or whose first copy failed before the server, recognised from History or fenced by New chat, with edited text, company
// switching, a lost New chat reply, refused first attempts and retries that never count as "not stored" (also an accepted send whose
// browser answer the test rewrites to 409: induced transport evidence), and a capped History count shown as a lower bound; nothing is
// ever sent automatically. With `original` false (the fixture's defect legs) only the named new groups run.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({origin,db,worker,act,acted,finish,reply,finished,wsSend,api,tokenA,A,B,owner,importId,aplus,pause,pass,membersA,isolated,original=true,ObjectId})=>{
 // The collector's installed dependencies resolve from this script's own checkout (or its parent checkout for a nested worktree; no
 // junction), so a packaged copy of the build under test uses the same installed browser driver.
 const base=path.resolve(__dirname,'..');let puppeteer;try{puppeteer=createRequire(path.join(base,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(base,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-owner-cont-ui-'));
 let browser,page,hold=null,heartbeat,plan=null,holdReads=null;const errors=[],held=[],heldReads=[],posted=[],reads=[],inflight=new Set();
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<300;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('owner-cont:chrome-'+label)};
 const nativeSwitch=async organizationId=>page.evaluate(async organizationId=>{
  const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');
  const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');
  const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}}),profile=await p.json();if(!p.ok)throw Error('Synthetic profile failed');user.acceptSession({...profile,tokens:s.tokens},false);
 },String(organizationId));
 const panelText=()=>page.$eval('[data-assistant-dock]',e=>e.textContent);
 const click=selector=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)throw Error('missing '+s);e.click()},selector);
 const typeMessage=async text=>{await page.$eval('#assistant-message',(e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}))},text);await click('[data-assistant-send]')};
 const claimFinish=async(summary,extra={},check)=>{const r=await worker('workspace-claim');assert.ok(r.data?.job,'owner-cont:chrome-claim '+r.raw.slice(0,200));const job=r.data.job;if(check)await check(job);await finished(job,summary,extra);return job};
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 try{
  assert.ok(executablePath,'SETUP: installed Chrome is required');
  // keep the synthetic worker visible as connected for the whole leg (the UI enables sending only for a recently seen worker)
  heartbeat=setInterval(()=>{worker('heartbeat',{}).catch(()=>{})},15000);
  // SETUP readiness only (the sibling Chrome legs' rule): on a loaded machine at idle priority Chrome can take minutes to start.
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,timeout:300000,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});
  await page.setRequestInterception(true);
  // One request listener owns every induced loss (never competing interceptors): the original held read, the held conversation reads of
  // the request identity groups (`holdReads`, sent to the native server only when released) and at most one planned POST (`plan`,
  // matched once). Every owner and purchase send and New chat POST is observed in `posted`.
  page.on('request',async request=>{
   let pathname='';try{pathname=new URL(request.url()).pathname}catch{}
   if(request.method()==='POST'&&/^\/api\/finance-chat\/(workspace|imports\/[a-f0-9]{24}\/drafts\/\d+)(\/new)?$/.test(pathname)){let body=null;try{body=JSON.parse(request.postData()||'null')}catch{}posted.push({path:pathname,body});inflight.add(request)}
   if(hold&&request.method()==='GET'&&request.url()===origin+'/api/finance-chat/workspace'){const h=hold;hold=null;const r=await fetch(request.url(),{headers:{Authorization:request.headers().authorization||''}});held.push({request,status:r.status,raw:await r.text()});h.resolve();return}
   if(holdReads&&request.method()==='GET'&&pathname===holdReads){heldReads.push(request);return}
   if(plan&&plan.method===request.method()&&plan.path===pathname){const p=plan;plan=null;await p.run(request);return}
   if(request.method()==='GET'&&/^\/api\/finance-chat\/(workspace|imports\/[a-f0-9]{24}\/drafts\/\d+)$/.test(pathname))reads.push({request,at:Date.now()});
   request.continue().catch(()=>{});
  });
  page.on('requestfinished',r=>inflight.delete(r));page.on('requestfailed',r=>inflight.delete(r));
  const release=async()=>{for(const h of held.splice(0))await h.request.respond({status:h.status,contentType:'application/json',body:h.raw}).catch(()=>{})};
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email','owner-cont-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/mapping',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('[data-assistant-toggle]'),[],'launcher-ready');await page.evaluate(()=>document.querySelector('[data-assistant-toggle]').click());
  await wait(()=>!!document.querySelector('[data-assistant-owner-controls]'),[],'owner-controls');
  if(original){
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
  await wait(()=>document.querySelector('[data-assistant-dock]').textContent.includes('A_BROWSER_REPLY'),[],'A-reply-visible');
  let resolveHold;const holding=new Promise(r=>resolveHold=r);hold={resolve:resolveHold};await holding;await nativeSwitch(B);await release();
  await wait(()=>!document.querySelector('[data-assistant-dock]').textContent.includes('A_BROWSER_REPLY')&&!!document.querySelector('[data-workspace-withheld]'),[],'masked-under-B');
  for(let i=0;i<20;i++){assert.ok(!(await panelText()).includes('A_BROWSER_REPLY'),'owner-cont:chrome-delayed-A-response-dropped');await pause(150)}
  await nativeSwitch(A);await wait(()=>document.querySelector('[data-assistant-dock]').textContent.includes('A_BROWSER_REPLY'),[],'visible-again-A');
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
  }
  // Request identity and the uncertain-send exit (plan omf-navi-agent-owner-retry-20261023). SETUP waits never count as a detection;
  // behaviour fails with its own owner-cont:chrome- assertion. Each group starts idle (a job a red group left is answered with a synthetic
  // reply) and always clears its plan and releases held reads.
  const must=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);if(r.status!==200)throw Error('SETUP chrome '+method+' '+route+' '+r.status+' '+String(JSON.stringify(r.data?.data??r.data?.message??null)).slice(0,300)+' '+r.raw.slice(0,120));return r.data};
  const planned=(method,path,run)=>{let settle;const done=new Promise((resolve,reject)=>{settle={resolve,reject}});plan={method,path,run:async r=>{try{settle.resolve(await run(r))}catch(e){settle.reject(e)}}};return done};
  const loseReply=path=>planned('POST',path,async r=>{const body=r.postData()||'{}',f=await fetch(r.url(),{method:'POST',headers:{'content-type':'application/json',authorization:r.headers().authorization||''},body}),text=await f.text();await r.abort('failed').catch(()=>{});return {status:f.status,body:JSON.parse(body),reply:text}});
  const loseRequest=path=>planned('POST',path,async r=>{const body=JSON.parse(r.postData()||'{}');await r.abort('failed').catch(()=>{});return {body}});
  // Induced transport evidence only (never a naturally observed backend failure): the browser's exact POST is answered by the native
  // server, then the browser receives a 409 the test writes in place of that answer.
  const refuseReply=path=>planned('POST',path,async r=>{const body=r.postData()||'{}',f=await fetch(r.url(),{method:'POST',headers:{'content-type':'application/json',authorization:r.headers().authorization||''},body}),text=await f.text();await r.respond({status:409,contentType:'application/json',body:JSON.stringify({error:true,statusCode:409,statusMessage:'Induced test refusal',message:'テストが書き換えた応答です（ネイティブの応答 '+f.status+'）',data:{induced:true}})}).catch(()=>{});return {status:f.status,body:JSON.parse(body),reply:text}});
  // Legacy repeats as owned synthetic rows: before this fold an archived request could be queued and archived again, so one id can sit in
  // many adopted archives. Copies the request's newest adopted archived turn into `extra` more adopted archives of the same conversation
  // (segments the live row then moves past, one write) and returns the newest segment.
  const repeatArchives=async(kind,live,filter,requestId,extra)=>{const archives=db.collection('financeownerconversationarchives'),c=await live.findOne(filter);if(!c?.segment)throw Error('SETUP chrome no archived live conversation for the repeats');
   const real=await archives.findOne({conversationKind:kind,conversationId:c._id,segment:{$lt:c.segment},'turns.id':requestId},{sort:{segment:-1}});if(!real)throw Error('SETUP chrome no adopted archive holds the request');const turn=real.turns.find(t=>t.id===requestId),at=new Date();
   await archives.insertMany(Array.from({length:extra},(_,i)=>({ownerId:real.ownerId,conversationKind:kind,conversationId:c._id,...(kind==='purchase'?{accountId:real.accountId,importId:real.importId,line:real.line}:{}),segment:c.segment+i,resetId:'legacy-repeat-'+i+'-'+crypto.randomUUID(),fromRevision:c.revision,turns:[turn],turnCount:1,firstAt:turn.at||at,lastAt:turn.answeredAt||turn.at||at,...(real.archivedBy?{archivedBy:real.archivedBy}:{}),createdAt:at,updatedAt:at})));
   if((await live.updateOne({_id:c._id,segment:c.segment},{$inc:{segment:extra}})).modifiedCount!==1)throw Error('SETUP chrome the live conversation moved during the repeats');return c.segment+extra-1};
  const within=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('SETUP chrome '+label+' did not happen within '+ms+' ms')),ms))]);
  const releaseReads=async()=>{holdReads=null;for(const r of heldReads.splice(0))await r.continue().catch(()=>{})};
  const describe=()=>page.evaluate(()=>{const q=s=>document.querySelector(s),send=q('[data-assistant-send]')||q('[data-chat-send]'),reset=q('[data-assistant-owner-controls] [data-assistant-new-chat]')||q('[data-chat-new-chat]');return {path:location.pathname,send:send?.textContent.trim()??null,sendDisabled:send?.disabled??null,newChatDisabled:reset?.disabled??null,composer:(q('#assistant-message')||q('#purchase-chat-message'))?.value??null,alert:q('#omf-assistant form [role=alert]')?.textContent||null,hint:!!(q('[data-assistant-pending-hint]')||q('[data-chat-pending-hint]')),held:!!(q('[data-assistant-pending-held]')||q('[data-chat-pending-held]')),received:!!(q('[data-assistant-received]')||q('[data-chat-received]'))}}).catch(e=>String(e));
  const until=async(fn,args,name,ms,fail)=>{const end=Date.now()+ms;while(Date.now()<end){if(await page.evaluate(fn,...args).catch(()=>false))return;await pause(100)}fail(name+' (not within '+ms+' ms) '+JSON.stringify(await describe()))};
  const setupWait=(fn,args,name,ms=30000)=>until(fn,args,name,ms,m=>{throw Error('SETUP chrome '+m)});
  const expectWithin=(fn,args,name,ms=30000)=>until(fn,args,name,ms,m=>assert.fail(m));
  const press=selector=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;e.click();return true},selector).then(found=>{if(!found)throw Error('SETUP chrome missing '+selector)});
  const setComposer=(selector,text)=>page.$eval(selector,(e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}))},text);
  const valueOf=selector=>page.$eval(selector,e=>e.value),textOf=selector=>page.$eval(selector,e=>e.textContent.trim());
  // Observed (never intercepted) POSTs and their answers: each waiter resolves to the request/response or null (never an unhandled
  // rejection when an earlier step fails); need() turns a missing one into a SETUP error.
  const postTo=path=>page.waitForRequest(q=>q.method()==='POST'&&new URL(q.url()).pathname===path,{timeout:30000}).catch(()=>null),answerOf=path=>page.waitForResponse(q=>q.request().method()==='POST'&&new URL(q.url()).pathname===path,{timeout:30000}).catch(()=>null);
  const need=async(waiter,label)=>{const found=await waiter;if(!found)throw Error('SETUP chrome '+label+' did not happen');return found};
  const bodyOf=async(response,label)=>{try{return await response.json()}catch(e){throw Error('SETUP chrome '+label+' body unreadable '+String(e?.message||e).slice(0,120))}};
  // The body of the New chat request a press of the enabled button sends, or null: a press that sends nothing is the product's own
  // behaviour (judged by the named assertion that reads it), never a setup step (full-02: a defect made New chat return without a request).
  const resetPosted=path=>postTo(path).then(q=>q?JSON.parse(q.postData()||'{}'):null);
  const ws='/api/finance-chat/workspace',purchasePath=line=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,ownerNew='[data-assistant-owner-controls] [data-assistant-new-chat]';
  const ownerState=()=>db.collection('financeassistants').findOne({ownerId:owner}),chatState=line=>db.collection('financechats').findOne({ownerId:owner,importId:new ObjectId(importId),line});
  const drainAll=async()=>{for(let i=0;i<6;i++){const busy=[...await db.collection('financeassistants').find({ownerId:owner,state:{$in:['queued','working']}}).toArray(),...await db.collection('financechats').find({ownerId:owner,state:{$in:['queued','working']}}).toArray()];if(!busy.length)return;for(const c of busy)if(c.state==='working')await db.collection(c.importId?'financechats':'financeassistants').updateOne({_id:c._id},{$set:{leaseUntil:new Date(Date.now()-1000)}});const w=(await worker('workspace-claim')).data?.job,p=(await worker('claim')).data?.job;if(w)await finish(w,reply('drained'));if(p)await finish(p,reply('drained'))}};
  const openOwner=async()=>{await page.goto(origin+'/mapping',{waitUntil:'networkidle2'});await setupWait(()=>!!document.querySelector('[data-assistant-toggle]'),[],'launcher');await nativeSwitch(A);
   if(await page.$eval('[data-assistant-toggle]',e=>e.getAttribute('aria-expanded'))!=='true')await press('[data-assistant-toggle]');if(await page.$('[data-assistant-general]'))await press('[data-assistant-general]');
   await setupWait(id=>!!document.querySelector('[data-assistant-owner-controls]')&&!document.querySelector('#assistant-message')?.disabled&&document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId===id,[String(A)],'owner composer under A')};
  const resetOwner=async()=>{const v=(await must(ws,tokenA)).conversation;if(v?.turns?.length)await must(ws+'/new',tokenA,'POST',{chatRevision:v.revision,requestId:crypto.randomUUID()});await setupWait(()=>document.querySelectorAll('[data-workspace-turn]').length===0&&!document.querySelector('#assistant-message').disabled,[],'owner conversation empty')};
  const openPurchase=async line=>{await page.goto(origin+'/mapping-draft/'+importId+'/'+line,{waitUntil:'networkidle2'});await setupWait(()=>!!document.querySelector('[data-open-purchase-assistant]'),[],'draft page '+line);await nativeSwitch(A);
   await press('[data-open-purchase-assistant]');await setupWait(()=>!!document.querySelector('[data-chat-controls]')&&!!document.querySelector('#purchase-chat-message')&&!document.querySelector('#purchase-chat-message').disabled,[],'purchase composer '+line)};
  // The open conversation reads the native server again after an action: the panel is closed and reopened (its conversation reloads on
  // activation) and the following poll also completes, so the view the person acts on is current (a read started before a send is
  // dropped by the conversation's own stale-response guard). fail-first-02 re-sent from a stale view (409 instead of the real retry).
  const freshRead=async(path,action)=>{const t=Date.now(),done=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===path&&reads.some(x=>x.request===r.request()&&x.at>=t),{timeout:60000}).then(()=>true,()=>false);await action();if(!await done)throw Error('SETUP chrome no fresh read of '+path)};
  const currentView=async path=>{await freshRead(path,async()=>{await press('[data-assistant-close]');await setupWait(()=>document.querySelector('[data-assistant-toggle]')?.getAttribute('aria-expanded')==='false',[],'panel closed');await press('[data-assistant-toggle]')});await freshRead(path,async()=>{})};
  // A failed attempt has settled: the composer is enabled again and (owner) the frozen request is still offered as 送信結果を確認, or
  // (purchase) the failure is shown. The owner conversation's 4 s read clears its error text, so the owner wait reads the request instead.
  const failedCopy=(selector,name)=>setupWait(s=>{const c=document.querySelector(s);if(!c||c.disabled)return false;return s==='#assistant-message'?document.querySelector('[data-assistant-send]')?.textContent.trim()==='送信結果を確認':!!document.querySelector('#omf-assistant form [role=alert]')},[selector],name);
  // A group ends only after every observed owner/purchase POST of the page has its answer (or failed in the browser), so a send still
  // being stored never leaks into the next group (full-01: a red group's late send made the next groups' setup refuse).
  const settled=async()=>{const end=Date.now()+30000;while([...inflight].some(r=>!r.response()&&!r.failure())&&Date.now()<end)await pause(100);inflight.clear()};
  const group=(key,name,fn)=>isolated(key,name,async()=>{try{await settled();await drainAll();await fn()}finally{plan=null;await releaseReads();await settled();await drainAll().catch(()=>{})}});
  await page.setViewport({width:1280,height:900});

  await group('chrome-owner-received','browser owner-received: an accepted owner request whose reply was lost and which another tab\'s New chat archived is answered by 送信結果を確認 with the same frozen request, never queued or resent; History shows that exact turn framed with its done receipt; the edited text stays',async()=>{
   await openOwner();await resetOwner();const text='CHROME_OWNER_LOST_REPLY_'+Date.now();holdReads=ws;
   const lost=loseReply(ws);await setComposer('#assistant-message',text);await press('[data-assistant-send]');const first=await within(lost,30000,'owner lost reply');if(first.status!==200)throw Error('SETUP chrome the lost owner request was not accepted '+first.reply.slice(0,200));
   await failedCopy('#assistant-message','owner lost reply settled');
   const job=(await worker('workspace-claim')).data?.job;if(job?.text!==text)throw Error('SETUP chrome owner received claim');
   const saved=await acted(job,1,'save_draft_fields',{importId,line:2,fields:{taxRate:8}});await finished(job,'CHROME_OWNER_REPLY 税率を8%にしました。');
   const v=(await must(ws,tokenA)).conversation;await must(ws+'/new',tokenA,'POST',{chatRevision:v.revision,requestId:crypto.randomUUID()});
   await releaseReads();await currentView(ws);await setupWait(()=>document.querySelectorAll('[data-workspace-turn]').length===0&&!document.querySelector('#assistant-message').disabled,[],'owner archived by the other tab');
   const edited='CHROME_OWNER_EDITED_'+Date.now();await setComposer('#assistant-message',edited);const retried=postTo(ws),answered=answerOf(ws);
   await press('[data-assistant-send]');const body=JSON.parse((await need(retried,'owner retry POST')).postData()||'{}');await answered;
   assert.ok(body.requestId===first.body.requestId&&body.text===text,'owner-cont:chrome-owner-same-request '+JSON.stringify({same:body.requestId===first.body.requestId,text:body.text}));
   const state=await ownerState(),again=(await worker('workspace-claim')).data?.job||null;if(again)await finish(again,reply('reclaimed'));
   assert.ok(state.state!=='queued'&&!state.turns.some(t=>t.id===first.body.requestId)&&!again,'owner-cont:chrome-owner-archived-not-requeued '+JSON.stringify({state:state.state,live:state.turns.length,reclaimed:!!again}));
   await expectWithin(()=>!!document.querySelector('[data-assistant-received]')&&!!document.querySelector('[data-archived-request]'),[],'owner-cont:chrome-owner-received-history');
   assert.ok(await page.$eval('[data-archived-request]',e=>!!e.querySelector('[data-archived-action-state="done"]')&&e.textContent.includes('CHROME_OWNER_REPLY')),'owner-cont:chrome-owner-received-receipt '+saved.receipt.operationId);
   assert.equal(await valueOf('#assistant-message'),edited,'owner-cont:chrome-owner-edited-text-kept');
   // the recognised receipt still refreshes the open draft the save touched (parent refresh from the archived turn's done receipt)
   const ownerDraft=await db.collection('financedrafts').findOne({importId:new ObjectId(importId),line:2});
   await expectWithin(rev=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').saved;return s?.draft?.line===2&&s.draft.revision===rev},[ownerDraft.revision],'owner-cont:chrome-owner-received-refreshes-draft');
   await press('[data-assistant-view="chat"]');await expectWithin(()=>document.querySelector('[data-assistant-send]').textContent.trim()==='送信'&&!document.querySelector('[data-assistant-pending-hint]'),[],'owner-cont:chrome-owner-received-released');
   await setComposer('#assistant-message','');
  });

  await group('chrome-owner-fence','browser owner-fence: an owner request whose first copy failed before the server keeps New chat available on an empty conversation; New chat names it, fences it (not accepted), releases it with the typed text kept and sends nothing; only the person\'s next send is sent, once',async()=>{
   await openOwner();await resetOwner();const text='CHROME_OWNER_NEVER_SENT_'+Date.now(),lost=loseRequest(ws);await setComposer('#assistant-message',text);await press('[data-assistant-send]');
   const first=await within(lost,30000,'owner lost first copy');await failedCopy('#assistant-message','owner first copy failed');
   await expectWithin(s=>{const b=document.querySelector(s);return !!b&&!b.disabled},[ownerNew],'owner-cont:chrome-owner-empty-new-chat-entry');
   const sentBefore=posted.length,resetReq=resetPosted(ws+'/new'),reset=answerOf(ws+'/new');await press(ownerNew);const resetBody=await resetReq;
   assert.equal(resetBody?resetBody.pending?.requestId:'no New chat request',first.body.requestId,'owner-cont:chrome-owner-reset-names-pending');await need(reset,'owner New chat answer');
   await expectWithin(()=>document.querySelector('[data-assistant-send]').textContent.trim()==='送信'&&!document.querySelector('[data-assistant-pending-hint]'),[],'owner-cont:chrome-owner-fence-releases');
   assert.equal(await valueOf('#assistant-message'),text,'owner-cont:chrome-owner-fence-text-kept');
   await pause(1500);assert.ok(posted.slice(sentBefore).every(p=>p.path===ws+'/new')&&!(await ownerState()).turns.some(t=>t.text===text),'owner-cont:chrome-owner-no-auto-send');
   const next=postTo(ws),nextAnswer=answerOf(ws);await press('[data-assistant-send]');const nb=JSON.parse((await need(next,'owner next send')).postData()||'{}');assert.ok(nb.requestId!==first.body.requestId&&nb.text===text,'owner-cont:chrome-owner-explicit-send-new');
   // the claim waits for the send's own answer (full-01 claimed while the accepted send was still being stored)
   const na=await need(nextAnswer,'owner next send answer');assert.equal(na.status(),200,'owner-cont:chrome-owner-explicit-send-accepted '+(await na.text().catch(()=>'')).slice(0,200));
   const job=(await worker('workspace-claim')).data?.job;assert.equal(job?.text,text,'owner-cont:chrome-owner-explicit-send-once');await finished(job,'回答しました。');
   assert.equal((await ownerState()).turns.filter(t=>t.text===text).length,1,'owner-cont:chrome-owner-explicit-send-one-turn');await setupWait(()=>!document.querySelector('#assistant-message').disabled,[],'owner fence idle');await setComposer('#assistant-message','');
  });

  await group('chrome-owner-hold','browser owner-hold: an uncertain owner request frozen under company A is never sent under company B (send held, explained); New chat under B answers it without sending; the text stays',async()=>{
   await openOwner();await resetOwner();const text='CHROME_OWNER_HELD_'+Date.now(),lost=loseRequest(ws);await setComposer('#assistant-message',text);await press('[data-assistant-send]');
   const first=await within(lost,30000,'owner held first copy');await failedCopy('#assistant-message','owner held first copy failed');
   await nativeSwitch(B);await setupWait(id=>document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId===id,[String(B)],'owner view under B');
   const sentBefore=posted.length;await expectWithin(()=>document.querySelector('[data-assistant-send]').disabled&&!!document.querySelector('[data-assistant-pending-held]'),[],'owner-cont:chrome-owner-pending-held-other-company');
   await press('[data-assistant-send]');await pause(1500);
   assert.ok(!posted.slice(sentBefore).some(p=>p.path===ws)&&!(await ownerState()).turns.some(t=>t.text===text),'owner-cont:chrome-owner-pending-not-retargeted');
   const resetReq=resetPosted(ws+'/new'),reset=answerOf(ws+'/new');await press(ownerNew);const resetBody=await resetReq;assert.equal(resetBody?resetBody.pending?.requestId:'no New chat request',first.body.requestId,'owner-cont:chrome-owner-held-reset-names-pending');await need(reset,'owner held New chat answer');
   await expectWithin(()=>document.querySelector('[data-assistant-send]').textContent.trim()==='送信'&&!document.querySelector('[data-assistant-pending-held]'),[],'owner-cont:chrome-owner-held-reset-releases');
   assert.equal(await valueOf('#assistant-message'),text,'owner-cont:chrome-owner-held-text-kept');
   await nativeSwitch(A);await setupWait(id=>document.querySelector('[data-assistant-posting-company]')?.dataset.assistantPostingCompanyId===id,[String(A)],'owner view back under A');await setComposer('#assistant-message','');
  });

  await group('chrome-owner-lost-reset','browser owner-lost-reset: a New chat whose reply was lost keeps the uncertain request; the next New chat sends the same frozen reset id and request, and its answer releases exactly that request with the text kept and nothing sent',async()=>{
   await openOwner();await resetOwner();
   // one answered turn first, so New chat is available whatever the pending rules are
   const seed=await wsSend(tokenA,'CHROME_OWNER_SEED_'+Date.now(),{page:'mapping'});if(seed.response.status!==200)throw Error('SETUP chrome owner lost-reset seed');const sj=(await worker('workspace-claim')).data?.job;if(!sj)throw Error('SETUP chrome owner seed claim');await finished(sj,'seed reply');
   await setupWait(()=>document.querySelectorAll('[data-workspace-turn]').length===1&&!document.querySelector('#assistant-message').disabled,[],'owner seed visible');
   const text='CHROME_OWNER_LOST_RESET_'+Date.now(),lost=loseRequest(ws);await setComposer('#assistant-message',text);await press('[data-assistant-send]');
   const first=await within(lost,30000,'owner lost-reset first copy');await failedCopy('#assistant-message','owner lost-reset first copy failed');
   const lostReset=loseReply(ws+'/new');await press(ownerNew);const r1=await within(lostReset,30000,'owner lost New chat');if(r1.status!==200)throw Error('SETUP chrome the lost New chat was not answered '+r1.reply.slice(0,200));
   assert.equal(r1.body.pending?.requestId,first.body.requestId,'owner-cont:chrome-owner-reset-names-pending');
   await failedCopy('#assistant-message','owner lost New chat settled');assert.equal(await textOf('[data-assistant-send]'),'送信結果を確認','owner-cont:chrome-owner-lost-reset-keeps-pending');
   const againReq=resetPosted(ws+'/new'),again=answerOf(ws+'/new');await press(ownerNew);const b2=await againReq||{};
   assert.ok(b2.requestId===r1.body.requestId&&JSON.stringify(b2.pending)===JSON.stringify(r1.body.pending),'owner-cont:chrome-owner-lost-reset-same-identity '+JSON.stringify({sent:!!b2.requestId,sameReset:b2.requestId===r1.body.requestId}));await need(again,'owner repeated New chat answer');
   await expectWithin(()=>document.querySelector('[data-assistant-send]').textContent.trim()==='送信',[],'owner-cont:chrome-owner-lost-reset-resolved');assert.equal(await valueOf('#assistant-message'),text,'owner-cont:chrome-owner-lost-reset-text-kept');
   assert.ok(!(await ownerState()).turns.some(t=>t.text===text),'owner-cont:chrome-owner-lost-reset-nothing-sent');await setComposer('#assistant-message','');
  });

  await group('chrome-purchase-received','browser purchase-received: a purchase request whose reply was lost, whose own save moved the draft and which another tab\'s New chat archived is answered by 送信結果を確認 with the frozen original id, text, draft binding and references; History shows the framed turn with its receipt; the edited text stays; nothing is queued or resent',async()=>{
   const path=purchasePath(6);await openPurchase(6);const text='CHROME_PURCHASE_LOST_REPLY_'+Date.now();holdReads=path;
   const lost=loseReply(path);await setComposer('#purchase-chat-message',text);await press('[data-chat-send]');const first=await within(lost,30000,'purchase lost reply');if(first.status!==200)throw Error('SETUP chrome the lost purchase request was not accepted '+first.reply.slice(0,200));
   await failedCopy('#purchase-chat-message','purchase lost reply settled');
   const job=(await worker('claim')).data?.job;if(job?.text!==text)throw Error('SETUP chrome purchase received claim');const saved=await acted(job,1,'save_draft_fields',{fields:{taxRate:8}});if(saved.receipt.state!=='done')throw Error('SETUP chrome purchase own save');
   await finished(job,'CHROME_PURCHASE_REPLY 税率を8%にしました。');const c=(await must(path,tokenA)).conversation;await must(path+'/new',tokenA,'POST',{chatRevision:c.revision,requestId:crypto.randomUUID()});
   await releaseReads();await currentView(path);await setupWait(()=>document.querySelectorAll('[data-chat-turn]').length===0&&!document.querySelector('#purchase-chat-message').disabled,[],'purchase archived by the other tab');
   const edited='CHROME_PURCHASE_EDITED_'+Date.now();await setComposer('#purchase-chat-message',edited);const retried=postTo(path),answered=answerOf(path);
   await press('[data-chat-send]');const body=JSON.parse((await need(retried,'purchase retry POST')).postData()||'{}');await answered;
   assert.ok(body.requestId===first.body.requestId&&body.text===text&&body.revision===first.body.revision&&body.key===first.body.key&&body.sourceHash===first.body.sourceHash&&JSON.stringify(body.references)===JSON.stringify(first.body.references),'owner-cont:chrome-purchase-frozen-original '+JSON.stringify({same:body.requestId===first.body.requestId,text:body.text,revision:[body.revision,first.body.revision]}));
   const state=await chatState(6),again=(await worker('claim')).data?.job||null;if(again)await finish(again,reply('reclaimed'));
   assert.ok(state.state!=='queued'&&!state.turns.some(t=>t.id===first.body.requestId)&&!again,'owner-cont:chrome-purchase-archived-not-requeued '+JSON.stringify({state:state.state,live:state.turns.length,reclaimed:!!again}));
   await expectWithin(()=>!!document.querySelector('[data-chat-received]')&&!!document.querySelector('[data-chat-archived-request]'),[],'owner-cont:chrome-purchase-received-history');
   assert.ok(await page.$eval('[data-chat-archived-request]',e=>e.textContent.includes('CHROME_PURCHASE_REPLY')&&e.textContent.includes('下書きを保存：完了')),'owner-cont:chrome-purchase-received-receipt');
   assert.equal(await valueOf('#purchase-chat-message'),edited,'owner-cont:chrome-purchase-edited-text-kept');
   // the recognised save still refreshes the draft page (parent refresh from the archived turn's done receipt)
   const purchaseDraft=await db.collection('financedrafts').findOne({importId:new ObjectId(importId),line:6});
   await expectWithin(rev=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant').saved;return s?.draft?.line===6&&s.draft.revision===rev},[purchaseDraft.revision],'owner-cont:chrome-purchase-received-refreshes-draft');
   await press('[data-chat-view="chat"]');await expectWithin(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信'&&!document.querySelector('[data-chat-pending-hint]'),[],'owner-cont:chrome-purchase-received-released');
   await setComposer('#purchase-chat-message','');
  });

  await group('chrome-purchase-fence','browser purchase-fence: a purchase request whose first copy failed before the server keeps New chat available although the purchase has no conversation yet; New chat names it with its frozen binding, fences it with the conversation row itself, releases it with the text kept and sends nothing; only the next send is sent, once',async()=>{
   if(await chatState(2))throw Error('SETUP chrome line 2 already has a purchase conversation');const path=purchasePath(2);await openPurchase(2);
   const text='CHROME_PURCHASE_NEVER_SENT_'+Date.now(),lost=loseRequest(path);await setComposer('#purchase-chat-message',text);await press('[data-chat-send]');
   const first=await within(lost,30000,'purchase lost first copy');await failedCopy('#purchase-chat-message','purchase first copy failed');
   await expectWithin(()=>{const b=document.querySelector('[data-chat-new-chat]');return !!b&&!b.disabled},[],'owner-cont:chrome-purchase-empty-new-chat-entry');
   const sentBefore=posted.length,resetReq=resetPosted(path+'/new'),reset=answerOf(path+'/new');await press('[data-chat-new-chat]');const rb=await resetReq||{};
   assert.ok(rb.pending?.requestId===first.body.requestId&&rb.pending.text===text&&rb.pending.revision===first.body.revision&&rb.pending.sourceHash===first.body.sourceHash,'owner-cont:chrome-purchase-reset-names-pending '+(rb.requestId?JSON.stringify(rb.pending||null).slice(0,200):'no New chat request'));await need(reset,'purchase New chat answer');
   const row=await chatState(2);assert.ok(row?.revision===1&&row.lastReset?.outcome==='not_accepted'&&!row.turns.length,'owner-cont:chrome-purchase-absent-fence '+JSON.stringify(row&&{revision:row.revision,turns:row.turns.length}));
   await expectWithin(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信'&&!document.querySelector('[data-chat-pending-hint]'),[],'owner-cont:chrome-purchase-fence-releases');
   assert.equal(await valueOf('#purchase-chat-message'),text,'owner-cont:chrome-purchase-fence-text-kept');
   await pause(1500);assert.ok(posted.slice(sentBefore).every(p=>p.path===path+'/new')&&!(await chatState(2)).turns.length,'owner-cont:chrome-purchase-no-auto-send');
   const next=postTo(path),nextAnswer=answerOf(path);await press('[data-chat-send]');const nb=JSON.parse((await need(next,'purchase next send')).postData()||'{}');assert.ok(nb.requestId!==first.body.requestId&&nb.text===text,'owner-cont:chrome-purchase-explicit-send-new');
   const na=await need(nextAnswer,'purchase next send answer');assert.equal(na.status(),200,'owner-cont:chrome-purchase-explicit-send-accepted '+(await na.text().catch(()=>'')).slice(0,200));
   const job=(await worker('claim')).data?.job;assert.equal(job?.text,text,'owner-cont:chrome-purchase-explicit-send-once');await finished(job,'回答しました。');
   await setupWait(()=>!document.querySelector('#purchase-chat-message').disabled,[],'purchase fence idle');await setComposer('#purchase-chat-message','');
  });

  // Parent lead B: an HTTP refusal is not a not-stored acknowledgement (the purchase send's storing write is followed by a fresh draft
  // read that can itself refuse), so neither the first attempt's refusal nor a retry's releases the request; New chat settles it.
  await group('chrome-purchase-refusal','browser purchase-refusal: a refusal is never taken as proof that nothing was stored: a new purchase request refused on its first attempt (its draft binding went stale) and again on its retry stays the same uncertain request with the text kept and nothing else sent, until New chat answers it as not accepted and releases it with the text kept',async()=>{
   const path=purchasePath(2),drafts=db.collection('financedrafts');let draft=await drafts.findOne({importId:new ObjectId(importId),line:2});
   // the saved draft row of line 2 (group 1 makes it in a full run; a defect leg saves it the same way through one synthetic owner turn)
   if(!draft){const seed=await wsSend(tokenA,'CHROME_REFUSAL_DRAFT_SEED_'+Date.now(),{page:'mapping',importId});if(seed.response.status!==200)throw Error('SETUP chrome refusal draft seed');const sj=(await worker('workspace-claim')).data?.job;if(!sj)throw Error('SETUP chrome refusal seed claim');if((await act(sj,1,'save_draft_fields',{importId,line:2,fields:{taxRate:10}})).status!==200)throw Error('SETUP chrome refusal seed save');await finish(sj,reply('seed'));draft=await drafts.findOne({importId:new ObjectId(importId),line:2})}
   if(!draft)throw Error('SETUP chrome line 2 has no saved draft');
   await openPurchase(2);await drafts.updateOne({_id:draft._id},{$inc:{revision:1}});
   try{
    const text='CHROME_PURCHASE_REFUSED_'+Date.now();await setComposer('#purchase-chat-message',text);const sentBefore=posted.length,refused=answerOf(path);await press('[data-chat-send]');const ra=await need(refused,'stale first attempt answer');if(ra.status()!==409)throw Error('SETUP chrome the stale first attempt was not refused');const firstBody=JSON.parse(ra.request().postData()||'{}');
    await setupWait(()=>!document.querySelector('#purchase-chat-message').disabled,[],'purchase first refusal settled');
    assert.ok(await page.evaluate(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信結果を確認'&&!!document.querySelector('[data-chat-pending-hint]')),'owner-cont:chrome-purchase-fresh-refusal-kept '+JSON.stringify(await describe()));
    assert.equal(await valueOf('#purchase-chat-message'),text,'owner-cont:chrome-purchase-refusal-text-kept');
    const retried=answerOf(path);await press('[data-chat-send]');const rr=await need(retried,'refused retry answer');if(rr.status()!==409)throw Error('SETUP chrome the retry was not refused');
    assert.equal(JSON.parse(rr.request().postData()||'{}').requestId,firstBody.requestId,'owner-cont:chrome-purchase-retry-same-request');
    await setupWait(()=>!document.querySelector('#purchase-chat-message').disabled,[],'purchase retry settled');
    assert.ok(await page.evaluate(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信結果を確認'&&!!document.querySelector('[data-chat-pending-hint]')),'owner-cont:chrome-purchase-retry-refusal-kept '+JSON.stringify(await describe()));
    const resetReq=resetPosted(path+'/new'),reset=answerOf(path+'/new');await press('[data-chat-new-chat]');const rb=await resetReq;
    assert.equal(rb?rb.pending?.requestId:'no New chat request',firstBody.requestId,'owner-cont:chrome-purchase-refusal-reset-names-pending');await need(reset,'refusal New chat answer');
    await expectWithin(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信'&&!document.querySelector('[data-chat-pending-hint]'),[],'owner-cont:chrome-purchase-refusal-reset-releases');assert.equal(await valueOf('#purchase-chat-message'),text,'owner-cont:chrome-purchase-refusal-reset-text-kept');
    assert.ok(posted.slice(sentBefore).filter(p=>p.path===path).length===2&&!((await chatState(2))?.turns||[]).some(t=>t.id===firstBody.requestId),'owner-cont:chrome-purchase-refusal-nothing-sent');
    await setComposer('#purchase-chat-message','');
   }finally{await drafts.updateOne({_id:draft._id},{$inc:{revision:-1}})}
  });

  // Added with the repair (its own new hold, so it has no unchanged-build witness; its removal is a named compiled defect).
  await group('chrome-purchase-hold','browser purchase-hold: an uncertain purchase request frozen under company A is never sent under company B (send held, explained, also after the panel reopens the purchase); New chat under B answers it without sending; the text stays',async()=>{
   const path=purchasePath(5);await openPurchase(5);const text='CHROME_PURCHASE_HELD_'+Date.now(),lost=loseRequest(path);await setComposer('#purchase-chat-message',text);await press('[data-chat-send]');
   const first=await within(lost,30000,'purchase held first copy');await failedCopy('#purchase-chat-message','purchase held first copy failed');
   // the company switch returns the panel to the workspace view; the person opens this purchase's chat again under B
   await nativeSwitch(B);await setupWait(()=>!document.querySelector('[data-chat-controls]'),[],'purchase chat closed by the switch');
   await press('[data-open-purchase-assistant]');await setupWait(()=>!!document.querySelector('[data-chat-controls]')&&!!document.querySelector('#purchase-chat-message'),[],'purchase chat under B');
   const sentBefore=posted.length;await expectWithin(()=>document.querySelector('[data-chat-send]').disabled&&!!document.querySelector('[data-chat-pending-held]'),[],'owner-cont:chrome-purchase-pending-held-other-company');
   await press('[data-chat-send]');await pause(1500);
   assert.ok(!posted.slice(sentBefore).some(p=>p.path===path)&&!((await chatState(5))?.turns||[]).some(t=>t.text===text),'owner-cont:chrome-purchase-pending-not-retargeted');
   const resetReq=resetPosted(path+'/new'),reset=answerOf(path+'/new');await press('[data-chat-new-chat]');const rb=await resetReq;assert.equal(rb?rb.pending?.requestId:'no New chat request',first.body.requestId,'owner-cont:chrome-purchase-held-reset-names-pending');await need(reset,'purchase held New chat answer');
   await expectWithin(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信'&&!document.querySelector('[data-chat-pending-held]'),[],'owner-cont:chrome-purchase-held-reset-releases');
   assert.equal(await valueOf('#purchase-chat-message'),text,'owner-cont:chrome-purchase-held-text-kept');
   await setComposer('#purchase-chat-message','');await nativeSwitch(A);
  });

  // Parent lead B, probed on the owned runtime (added with that fold, no unchanged-build witness; its removal is a named compiled defect).
  await group('chrome-purchase-induced-refusal','browser purchase-induced-refusal (induced transport evidence: the test writes the 409 the browser receives after the native server stored the send; not a naturally observed backend failure): the stored send is never taken as refused; the same frozen request stays uncertain with nothing sent by itself and the edited text kept; 送信結果を確認 sends exactly that request (id, text, draft binding, references), the native server recognises the stored turn, one turn and one job',async()=>{
   const path=purchasePath(5);await openPurchase(5);const text='CHROME_PURCHASE_INDUCED_'+Date.now();holdReads=path;
   const induced=refuseReply(path);await setComposer('#purchase-chat-message',text);await press('[data-chat-send]');const first=await within(induced,30000,'purchase induced refusal');if(first.status!==200)throw Error('SETUP chrome the native server did not accept the send '+first.reply.slice(0,200));
   if(!((await chatState(5))?.turns||[]).some(t=>t.id===first.body.requestId))throw Error('SETUP chrome the accepted send was not stored');
   await failedCopy('#purchase-chat-message','purchase induced refusal settled');const sentBefore=posted.length;
   assert.ok(await page.evaluate(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信結果を確認'&&!!document.querySelector('[data-chat-pending-hint]')),'owner-cont:chrome-purchase-induced-refusal-kept '+JSON.stringify(await describe()));
   const edited='CHROME_PURCHASE_INDUCED_EDITED_'+Date.now();await setComposer('#purchase-chat-message',edited);await pause(1500);
   assert.equal(posted.length,sentBefore,'owner-cont:chrome-purchase-induced-no-auto-send');
   const retried=postTo(path),answered=answerOf(path);await press('[data-chat-send]');const body=JSON.parse((await need(retried,'induced retry POST')).postData()||'{}'),ans=await need(answered,'induced retry answer');
   assert.ok(body.requestId===first.body.requestId&&body.text===text&&body.revision===first.body.revision&&body.key===first.body.key&&body.sourceHash===first.body.sourceHash&&JSON.stringify(body.references)===JSON.stringify(first.body.references),'owner-cont:chrome-purchase-induced-same-request '+JSON.stringify({same:body.requestId===first.body.requestId,text:body.text}));
   assert.equal(ans.status(),200,'owner-cont:chrome-purchase-induced-recognised');
   await expectWithin(()=>document.querySelector('[data-chat-send]').textContent.trim()==='送信'&&!document.querySelector('[data-chat-pending-hint]'),[],'owner-cont:chrome-purchase-induced-released');
   assert.equal(await valueOf('#purchase-chat-message'),edited,'owner-cont:chrome-purchase-induced-edited-kept');
   await releaseReads();const turns=((await chatState(5))?.turns||[]).filter(t=>t.id===first.body.requestId).length,job=(await worker('claim')).data?.job||null;if(job)await finished(job,'回答しました。');const again=(await worker('claim')).data?.job||null;if(again)await finish(again,reply('reclaimed'));
   assert.ok(turns===1&&job?.text===text&&!again,'owner-cont:chrome-purchase-induced-one-turn-one-job '+JSON.stringify({turns,job:!!job,again:!!again}));
   await setupWait(()=>!document.querySelector('#purchase-chat-message').disabled,[],'purchase induced idle');await setComposer('#purchase-chat-message','');
  });

  // Parent lead A (added with that fold, no unchanged-build witness): the bounded reader's capped count is stated as a lower bound.
  await group('chrome-received-count','browser received-count: a request recognised in more than 10 adopted archives (legacy repeats, owned synthetic rows) is answered by the bounded native reader (10 occurrences, truncated, the newest archive) and History states 10件以上, never exactly 10, in the owner workspace and in a purchase chat',async()=>{
   await openOwner();await resetOwner();const text='CHROME_OWNER_COUNT_'+Date.now();holdReads=ws;
   const lost=loseReply(ws);await setComposer('#assistant-message',text);await press('[data-assistant-send]');const first=await within(lost,30000,'owner count lost reply');if(first.status!==200)throw Error('SETUP chrome the owner count request was not accepted '+first.reply.slice(0,200));
   await failedCopy('#assistant-message','owner count lost reply settled');
   const job=(await worker('workspace-claim')).data?.job;if(job?.text!==text)throw Error('SETUP chrome owner count claim');await finished(job,'CHROME_OWNER_COUNT_REPLY');
   const v=(await must(ws,tokenA)).conversation;await must(ws+'/new',tokenA,'POST',{chatRevision:v.revision,requestId:crypto.randomUUID()});
   const newest=await repeatArchives('workspace',db.collection('financeassistants'),{ownerId:owner},first.body.requestId,10);
   await releaseReads();await currentView(ws);await setupWait(()=>document.querySelectorAll('[data-workspace-turn]').length===0&&!document.querySelector('#assistant-message').disabled,[],'owner count archived');
   const answered=answerOf(ws);await press('[data-assistant-send]');const got=(await bodyOf(await need(answered,'owner count retry answer'),'owner count retry answer'))?.received;
   assert.ok(got?.requestId===first.body.requestId&&got.occurrences===10&&got.occurrencesTruncated===true&&got.archive?.segment===newest,'owner-cont:chrome-owner-received-count-native '+JSON.stringify(got?{n:got.occurrences,truncated:got.occurrencesTruncated,segment:got.archive?.segment,newest}:null));
   await expectWithin(()=>(document.querySelector('[data-assistant-received]')?.textContent||'').includes('履歴に10件以上記録されています'),[],'owner-cont:chrome-owner-received-count-qualified');
   await press('[data-assistant-view="chat"]');await setComposer('#assistant-message','');
   const path=purchasePath(6);await openPurchase(6);const ptext='CHROME_PURCHASE_COUNT_'+Date.now();holdReads=path;
   const plost=loseReply(path);await setComposer('#purchase-chat-message',ptext);await press('[data-chat-send]');const pfirst=await within(plost,30000,'purchase count lost reply');if(pfirst.status!==200)throw Error('SETUP chrome the purchase count request was not accepted '+pfirst.reply.slice(0,200));
   await failedCopy('#purchase-chat-message','purchase count lost reply settled');
   const pjob=(await worker('claim')).data?.job;if(pjob?.text!==ptext)throw Error('SETUP chrome purchase count claim');await finished(pjob,'CHROME_PURCHASE_COUNT_REPLY');
   const c=(await must(path,tokenA)).conversation;await must(path+'/new',tokenA,'POST',{chatRevision:c.revision,requestId:crypto.randomUUID()});
   const pnewest=await repeatArchives('purchase',db.collection('financechats'),{ownerId:owner,importId:new ObjectId(importId),line:6},pfirst.body.requestId,10);
   await releaseReads();await currentView(path);await setupWait(()=>document.querySelectorAll('[data-chat-turn]').length===0&&!document.querySelector('#purchase-chat-message').disabled,[],'purchase count archived');
   const panswered=answerOf(path);await press('[data-chat-send]');const pgot=(await bodyOf(await need(panswered,'purchase count retry answer'),'purchase count retry answer'))?.received;
   assert.ok(pgot?.requestId===pfirst.body.requestId&&pgot.occurrences===10&&pgot.occurrencesTruncated===true&&pgot.archive?.segment===pnewest,'owner-cont:chrome-purchase-received-count-native '+JSON.stringify(pgot?{n:pgot.occurrences,truncated:pgot.occurrencesTruncated,segment:pgot.archive?.segment,newest:pnewest}:null));
   await expectWithin(()=>(document.querySelector('[data-chat-received]')?.textContent||'').includes('履歴に10件以上記録されています'),[],'owner-cont:chrome-purchase-received-count-qualified');
   await press('[data-chat-view="chat"]');await setComposer('#purchase-chat-message','');
  });
  assert.deepEqual(errors,[],'owner-cont:chrome-no-page-errors');
 }finally{clearInterval(heartbeat);if(browser)await browser.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true}).catch(()=>{})}
};

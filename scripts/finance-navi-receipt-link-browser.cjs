// Installed Chrome on the owned app and owned synthetic records only (own temporary profile, synthetic login, synthetic worker replies).
// Required in the main run: an absent Chrome fails receipt-link:chrome-required, never a skip. No model or production calls.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
module.exports=async({origin,db,ObjectId,A,B,email,password,tokenA,seedFactory,turn,act,finish,worker,pause,label:L,rule,release})=>{
 const ja=require('../i18n/locales/ja.json');
 let puppeteer;try{puppeteer=createRequire(path.join(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(__dirname,'../../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 assert.ok(executablePath,L('chrome-required')+' installed Chrome is required for the main acceptance leg');
 const {T,R}=seedFactory,rec=db.collection('receipts'),tx=db.collection('transactions');
 const tL1=T({organizationId:A,amount:3333,productName:'RL_BROWSER_TX'}),tL2=T({organizationId:A,amount:3333,hasReceipt:true}),tU1=T({organizationId:A,amount:2468}),tB=T({organizationId:B,amount:2468});
 const tF=T({organizationId:A,amount:1357,hasReceipt:true,receiptFilePath:'/uploads/rl-browser-direct-file.pdf'}),tP=T({organizationId:A,amount:4444});
 const tQ=T({organizationId:A,amount:5555,hasReceipt:true}),rQ=R({organizationId:A,amount:5555,status:'matched',transactionId:tQ._id});
 const rU3=R({organizationId:A,amount:3333}),rU4=R({organizationId:A,amount:1357}),rP=R({organizationId:A,amount:4444});
 const rL1=R({organizationId:A,amount:3333}),rL2=R({organizationId:A,amount:3333,status:'matched',transactionId:tL2._id}),rU1=R({organizationId:A,amount:2468}),rU2=R({organizationId:A,amount:2468}),rB=R({organizationId:B,amount:2468});
 await tx.insertMany([tL1,tL2,tU1,tB,tF,tP,tQ]);await rec.insertMany([rL1,rL2,rU1,rU2,rB,rU3,rU4,rP,rQ]);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-receipt-link-browser-')),errors=[],matchResponses=[];let browser,page,evidenceReads=0,rewrite=null;
 const wait=async(fn,args=[],name='condition',ms=30000)=>{for(let i=0;i<ms/100;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw new assert.AssertionError({message:L('chrome-passed')+' '+name})};
 const store=name=>`document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`;
 const push=to=>page.evaluate(to=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to),to);
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),session=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const profile=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.tokens.accessToken}});user.acceptSession({...await profile.json(),tokens:session.tokens},false)},String(organizationId));
 const noOverflow=async name=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,L('chrome-passed')+' 390px overflow '+name);
 // Ask through the real composer of the open page; the owned worker claims that exact turn and answers with synthetic actions.
 const ask=async(text,actions)=>{
  await page.evaluate(`${store('assistant')}.show({kind:'workspace'})`);await worker('heartbeat');await wait(()=>document.querySelector('#assistant-message')?.disabled===false,[],'composer');
  await page.$eval('#assistant-message',(e,text)=>{e.value=text;e.dispatchEvent(new Event('input',{bubbles:true}))},text);await page.click('[data-assistant-send]');await wait(()=>document.querySelector('#assistant-message')?.value==='',[],'accepted');
  await worker('heartbeat');const claimed=await worker('workspace-claim'),job=claimed.data?.job;assert.ok(job,L('chrome-passed')+' browser turn claimed');
  const out=[];let slot=1;for(const [name,args] of actions)out.push(await act(job,name,args,slot++));
  assert.equal((await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic receipt-link reply',patch:{},quotes:{}}})).status,200);return out;
 };
 const updatedAt=async id=>(await rec.findOne({_id:id})).updatedAt.toISOString();
 const badge=()=>page.evaluate(label=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===label);return p?.nextElementSibling?.textContent.trim()||null},ja.transactionDetail.receipt);
 try{
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(/\/match$/.test(r.url()))matchResponses.push(r.status())});page.on('dialog',d=>{if(d.type()==='confirm'){d.accept().catch(()=>{});return}errors.push(d.message());d.dismiss().catch(()=>{})});
  await page.setRequestInterception(true);
  page.on('request',request=>{(async()=>{const url=request.url();if(/\/api\/receipts\/[a-f0-9]{24}\/evidence/.test(url))evidenceReads++;
   if(rewrite&&request.method()==='POST'&&/\/api\/receipts\/[a-f0-9]{24}\/match$/.test(url)){const r=rewrite;rewrite=null;const headers={...request.headers()};if(r.dropAuth)delete headers.authorization;return request.continue({url:r.url||url,headers})}
   await request.continue()})().catch(e=>errors.push(String(e)))});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email',email);await page.type('#password',password);await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);

  // 1. Receipt detail: a done Navi link refreshes it without reload; a refused one is a failed card; chat labels in Japanese.
  await page.goto(origin+'/receipts/'+rL1._id,{waitUntil:'networkidle2'});await wait(()=>document.querySelector('[data-receipt-summary]')?.textContent.includes('取引はまだ紐付けられていません'),[],'unlinked-detail');await noOverflow('receipt detail');
  const navigations=[];page.on('framenavigated',f=>{if(f===page.mainFrame())navigations.push(f.url())});const readsBefore=evidenceReads;
  const [done,refused]=await ask('この領収書を RL_BROWSER_TX の取引に紐付けて。',[['link_company_receipt',{receiptId:String(rL1._id),transactionId:String(tL1._id),expectedUpdatedAt:await updatedAt(rL1._id)}],['link_company_receipt',{receiptId:String(rL2._id),transactionId:String(tL1._id),expectedUpdatedAt:await updatedAt(rL2._id)}]]);
  assert.equal(done.data?.receipt?.state,'done',L('chrome-passed')+' synthetic link done '+done.raw.slice(0,200));assert.equal(refused.status,409,L('chrome-passed')+' linked elsewhere refused');
  await wait(()=>!!document.querySelector('[data-receipt-existing-link]'),[],'detail refreshed after the done link');assert.equal(navigations.length,0,L('chrome-passed')+' no manual reload');assert.ok(evidenceReads>readsBefore,L('chrome-passed')+' evidence reread');
  await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(t=>t.textContent.includes('領収書を取引に紐付け：完了')),[],'done card');
  await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(t=>t.textContent.includes('領収書を取引に紐付け：できませんでした')),[],'failed card');
  // Another company's or actor's signal never reloads this page.
  const quiet=evidenceReads;const me=await page.evaluate(`${store('user')}.user?._id||${store('user')}.user?.id||''`);
  await page.evaluate(`${store('assistant')}.receiveCompanyResource({actorId:${JSON.stringify(String(me))},organizationId:${JSON.stringify(String(B))},kinds:['receipt'],id:${JSON.stringify(String(rL1._id))},effect:'link'})`);
  await page.evaluate(`${store('assistant')}.receiveCompanyResource({actorId:'000000000000000000000000',organizationId:${JSON.stringify(String(A))},kinds:['receipt'],id:${JSON.stringify(String(rL1._id))},effect:'link'})`);
  await pause(800);assert.equal(evidenceReads,quiet,L('chrome-passed')+' stale actor/company signal ignored');
  // 1b. A saved link whose badge write failed once is unresolved (system); with the chat left open and no request by the person, the
  // recovery tick completes it, the card becomes done and the open receipt page reloads.
  await push('/receipts/'+rP._id);await wait(()=>document.querySelector('[data-receipt-summary]')?.textContent.includes('取引はまだ紐付けられていません'),[],'pending receipt page');
  await rule('before-bump',{action:'throw',receiptId:String(rP._id),remaining:1});await rule('recovery-claimed',{action:'pause',receiptId:String(rP._id)});
  const [pendingLink]=await ask('この領収書を 4,444円の取引に紐付けて。',[['link_company_receipt',{receiptId:String(rP._id),transactionId:String(tP._id),expectedUpdatedAt:await updatedAt(rP._id)}]]);
  assert.equal(pendingLink.data?.receipt?.state,'unresolved',L('chat-auto-done')+' saved link with owed badge is not done '+pendingLink.raw.slice(0,200));assert.equal(pendingLink.data.receipt.recoveryOwner,'system',L('chat-auto-done'));
  await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(t=>t.textContent.includes('領収書を取引に紐付け：結果の確認が必要です')),[],'pending card visible');await release('recovery-claimed');
  await wait(()=>[...document.querySelectorAll('[data-workspace-turn]')].some(t=>t.textContent.includes('領収書を取引に紐付け：完了'))&&!!document.querySelector('[data-receipt-existing-link]'),[],'chat-auto-done: card done and page refreshed without a request',60000);
  assert.equal((await tx.findOne({_id:tP._id})).hasReceipt,true,L('chat-auto-done'));
  await page.click('[data-assistant-close]').catch(()=>{});

  // 2. Transaction badge after unlink and link, no reload.
  await push('/transactions/'+tL1._id);await wait(label=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===label);return p?.nextElementSibling?.textContent.trim()==='あり'},[ja.transactionDetail.receipt],'badge after link');
  await ask('この領収書の紐付けを解除して。',[['unlink_company_receipt',{receiptId:String(rL1._id),expectedUpdatedAt:await updatedAt(rL1._id)}]]);
  await wait(label=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===label);return p?.nextElementSibling?.textContent.trim()==='なし'},[ja.transactionDetail.receipt],'badge after unlink');assert.equal(await badge(),ja.transactionDetail.receiptNone);await noOverflow('transaction detail');
  await page.click('[data-assistant-close]').catch(()=>{});

  // 2b. Parent Q9: a native unlink saved its truth but not the badge (interrupted after truth, recovery held). With the OLD transaction
  // page open, an explicit Navi completion (already unlinked) must refresh that transaction without a manual reload.
  await rule('recovery-claimed',{action:'pause'});
  try{
   await rule('before-bump',{action:'throw',receiptId:String(rQ._id),remaining:1});
   const native=await(await fetch(origin+'/api/receipts/'+rQ._id+'/match',{method:'DELETE',headers:{Authorization:'Bearer '+tokenA}})).json();assert.equal(native.synchronization,'pending','SETUP native unlink interrupted after truth');
   await push('/transactions/'+tQ._id);await wait(label=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===label);return p?.nextElementSibling?.textContent.trim()==='あり'},[ja.transactionDetail.receipt],'stale badge before completion');
   const reloads=navigations.length;const [completion]=await ask('この領収書の紐付けの解除を完了して、取引の表示も直して。',[['unlink_company_receipt',{receiptId:String(rQ._id),expectedUpdatedAt:await updatedAt(rQ._id)}]]);
   assert.equal(completion.data?.receipt?.state,'done',L('q9-old-transaction-refresh')+' '+completion.raw.slice(0,200));
   await wait(label=>{const p=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===label);return p?.nextElementSibling?.textContent.trim()==='なし'},[ja.transactionDetail.receipt],'q9-old-transaction-refresh: repaired badge without reload');
   assert.equal(navigations.length,reloads,L('q9-old-transaction-refresh')+' no manual reload');
  }finally{await release('recovery-claimed')}
  await page.click('[data-assistant-close]').catch(()=>{});
  // 3. Receipt list status follows a Navi link.
  await push('/receipts');const row=`[data-library-row][data-library-id="${rL1._id}"]`;await wait(sel=>!!document.querySelector(sel),[row],'list row');
  assert.ok((await page.$eval(row,e=>e.textContent)).includes(ja.receipts.unmatched),L('chrome-passed')+' list unmatched');
  await ask('もう一度この取引に紐付けて。',[['link_company_receipt',{receiptId:String(rL1._id),transactionId:String(tL1._id),expectedUpdatedAt:await updatedAt(rL1._id)}]]);
  await wait((sel,text)=>document.querySelector(sel)?.textContent.includes(text),[row,ja.receipts.matched],'list refreshed after link');await noOverflow('receipt list');
  await page.click('[data-assistant-close]').catch(()=>{});

  // 4. Upload page: the dialog lists this company's transactions; refusals show fixed text; success reloads from the server.
  await push('/receipts/upload');
  const rowFor=async filename=>{for(let i=0;i<200;i++){const found=await page.evaluate(f=>[...document.querySelectorAll('tr')].findIndex(tr=>tr.textContent.includes(f)),filename);if(found>=0)return found;await pause(100)}throw new assert.AssertionError({message:L('chrome-passed')+' upload row '+filename})};
  const openMatch=async filename=>{await wait(()=>!document.querySelector('.h-96'),[],'previous dialog closed');await rowFor(filename);await page.evaluate((f,title)=>{const tr=[...document.querySelectorAll('tr')].find(t=>t.textContent.includes(f));[...tr.querySelectorAll('button')].find(b=>b.title===title).click()},filename,ja.receiptTable.match);await wait(()=>document.querySelectorAll('.h-96 .cursor-pointer').length>0,[],'dialog lists transactions')};
  const dialogIds=async()=>page.$$eval('.h-96 .cursor-pointer',n=>n.map(x=>x.textContent.match(/#([a-f0-9]{24})/)?.[1]).filter(Boolean));
  const confirm=async id=>{await page.evaluate(id=>{[...document.querySelectorAll('.h-96 .cursor-pointer')].find(x=>x.textContent.includes('#'+id)).click()},id);await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()&&!b.disabled&&b.className.includes('bg-primary-main')&&b.closest('.rounded-b-2xl'));b.click()})};
  await openMatch(rU1.filename);const listed=await dialogIds();assert.ok(listed.includes(String(tU1._id)),L('chrome-passed')+' dialog lists this company transaction '+JSON.stringify(listed));assert.ok(!listed.includes(String(tB._id)),L('chrome-passed')+' dialog excludes other company');
  rewrite={url:origin+'/api/receipts/'+rB._id+'/match'};await confirm(String(tU1._id));
  await wait(text=>document.body.textContent.includes(text),[ja.receiptUpload.matchNotInCompany],'refused match shows fixed text');assert.equal((await rec.findOne({_id:rB._id})).status,'unmatched',L('chrome-passed'));
  // No current company access: the membership is removed while the dialog is open (the session refresh then still answers 403).
  const orgs=db.collection('organizations'),saved=(await orgs.findOne({_id:A})).members;await openMatch(rU2.filename);await orgs.updateOne({_id:A},{$set:{members:[]}});try{await confirm(String(tU1._id));await wait(text=>document.body.textContent.includes(text),[ja.receiptUpload.matchCompanyRequired],'no-company refusal text').catch(e=>{e.message+=' (match responses '+JSON.stringify(matchResponses)+')';throw e})}finally{await orgs.updateOne({_id:A},{$set:{members:saved}})}
  assert.equal((await rec.findOne({_id:rU2._id})).status,'unmatched',L('chrome-passed'));
  let listReads=0;const counter=r=>{if(r.url().endsWith('/api/receipts'))listReads++};page.on('request',counter);
  await openMatch(rU1.filename);await confirm(String(tU1._id));
  await until(async()=>(await rec.findOne({_id:rU1._id})).status==='matched','upload success saved');for(let i=0;i<100&&listReads===0;i++)await pause(100);
  assert.ok(listReads>0,L('chrome-passed')+' successful match reloads from the server');page.off('request',counter);
  assert.equal((await tx.findOne({_id:tU1._id})).hasReceipt,true,L('chrome-passed')+' native match updates the badge');
  // A transaction that already has another receipt, and one with its own uploaded receipt file, are legitimate targets.
  for(const [r,t,name] of [[rU3,tL2,'dialog-second-receipt'],[rU4,tF,'dialog-direct-file']]){
   await openMatch(r.filename);const ids=await dialogIds();assert.ok(ids.includes(String(t._id)),L(name)+' target listed '+JSON.stringify(ids));await confirm(String(t._id));
   await until(async()=>(await rec.findOne({_id:r._id})).status==='matched',name+' saved');assert.equal(String((await rec.findOne({_id:r._id})).transactionId),String(t._id),L(name));assert.equal((await tx.findOne({_id:t._id})).hasReceipt,true,L(name))
  }
  assert.equal(await rec.countDocuments({transactionId:tL2._id,status:'matched'}),2,L('dialog-second-receipt')+' both receipts kept');await noOverflow('upload');
  assert.deepEqual(errors,[],L('chrome-passed')+' no page errors');
 }finally{if(browser)await browser.close();const target=path.resolve(directory);if(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('omf-receipt-link-browser-'))await fs.rm(target,{recursive:true,force:true});await rec.deleteMany({_id:{$in:[rL1,rL2,rU1,rU2,rB,rU3,rU4,rP,rQ].map(x=>x._id)}});await tx.deleteMany({_id:{$in:[tL1,tL2,tU1,tB,tF,tP,tQ].map(x=>x._id)}})}
 async function until(fn,name){for(let i=0;i<150;i++){if(await fn())return;await pause(100)}throw new assert.AssertionError({message:L('chrome-passed')+' '+name})}
};

// Installed Chrome on the owned synthetic application only (invoked by finance-calendar-evidence-integration, plan
// omf-calendar-evidence-20261029 §4 leg 2b). The explicitly unknown historical bill must read 銀行照合待ち and never red, stay out
// of the overdue alert, be listed in the awaiting block, show its originals in the editor, hand the exact bytes to the browser and
// flip its badge on the owner's confirmation; 390px without overflow; Japanese and Korean. No model, provider or sends.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
const L=tag=>'calendar-evidence-ui:'+tag;
module.exports=async({root,origin,A,ownerEmail,unknownId,legacyId,unknownDay,evidenceId,pdfSha256,pdfName,fileCount,payments,pause,pass})=>{
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(existsSync);
 assert.ok(executablePath,'calendar-evidence:chrome-required installed Chrome is required for this leg');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-calendar-evidence-ui-'));let browser,page;const errors=[],dialogs=[],fileResponses=[];
 // Bounded waits with a budget that survives a loaded host (the sibling legs use 30 s; the owned app took 184 s to boot under load once).
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<1200;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error(L('chrome-'+label))};
 // Optional-chained: before the SPA mounts (right after a navigation) the store is simply absent, never a thrown wait.
 const store=()=>'document.querySelector("#__nuxt")?.__vue_app__?.config.globalProperties.$pinia._s.get("calendar")';
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},organizationId);
 // Overflow with its evidence: every element whose box ends past the viewport (tag, classes, width, text) rides in the assertion.
 const overflowDetail=()=>page.evaluate(()=>{const w=innerWidth,out=[];for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect();if(r.width>0&&r.right>w+1)out.push({tag:e.tagName,cls:String(e.className||'').slice(0,90),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:(e.textContent||'').trim().slice(0,40)})}return{scrollWidth:document.documentElement.scrollWidth,innerWidth:w,offenders:out.slice(0,14)}});
 const overflow=async()=>{const d=await overflowDetail();return d.scrollWidth>d.innerWidth?JSON.stringify(d):false};
 const setMonth=day=>page.evaluate((s,day)=>eval(s).setCurrentMonth(new Date(day+'T12:00:00Z')),store(),day);
 const rowOf=title=>page.evaluate(t=>{const e=Array.from(document.querySelectorAll('main [draggable="true"]')).find(e=>e.textContent.includes(t));return e?{className:e.className,text:e.textContent}:null},title);
 try{
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync','--disable-popup-blocking']});page=await browser.newPage();await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(()=>{})});
  page.on('response',r=>{if(/\/api\/calendar-evidence\/[a-f0-9]{24}\/files\/[a-f0-9]{64}$/.test(r.url()))fileResponses.push(r.buffer().then(b=>({url:r.url(),status:r.status(),sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length})).catch(e=>({url:r.url(),error:String(e)})))});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');await page.type('#email',ownerEmail);await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);
  // 1. The calendar page: the unknown row is awaiting (listed in the neutral block), not in the overdue alert; in the grid it keeps its
  // category colour while the legacy past-due row is red.
  await page.goto(origin+'/calendar',{waitUntil:'networkidle2'});await wait(()=>location.pathname==='/calendar',[],'calendar-page');
  await wait((s,id)=>(eval(s)?.payments||[]).some(p=>p.id===id),[store(),unknownId],'calendar-loaded');
  await wait(id=>!!document.querySelector('[data-calendar-awaiting-row="'+id+'"]'),[unknownId],'awaiting-block');
  assert.ok(await page.$('[data-calendar-awaiting]'),L('awaiting-block'));assert.ok(!(await page.$('[data-calendar-awaiting-row="'+legacyId+'"]')),L('awaiting-legacy-excluded'));
  const awaitingText=await page.$eval('[data-calendar-awaiting]',e=>e.textContent);assert.match(awaitingText,/銀行照合待ち/,L('awaiting-label-ja'));assert.match(awaitingText,/UNKNOWN_PENDING/,L('awaiting-lists-row'));assert.ok(!/LEGACY_PENDING/.test(awaitingText),L('awaiting-legacy-excluded'));
  const alertHasUnknown=await page.evaluate(()=>Array.from(document.querySelectorAll('h4')).some(h=>/期限切れ|연체/.test(h.textContent)&&h.parentElement.textContent.includes('UNKNOWN_PENDING')));assert.equal(alertHasUnknown,false,L('overdue-alert-absent'));
  const storeView=await page.evaluate(s=>{const st=eval(s);return{unknown:st.payments.find(p=>p.title==='UNKNOWN_PENDING')?.status,legacy:st.payments.find(p=>p.title==='LEGACY_PENDING')?.status,awaiting:st.awaitingVerificationPayments.map(p=>p.title),overdueCount:st.monthlyStats.overduePayments}},store());
  assert.equal(storeView.unknown,'pending',L('store-not-flipped'));assert.equal(storeView.legacy,'overdue',L('store-legacy-flipped'));assert.deepEqual(storeView.awaiting,['UNKNOWN_PENDING'],L('store-awaiting'));
  await setMonth(unknownDay);await wait(t=>Array.from(document.querySelectorAll('main [draggable="true"]')).some(e=>e.textContent.includes(t)),['UNKNOWN_PENDING'],'grid-rows');
  const unknownRow=await rowOf('UNKNOWN_PENDING'),legacyRow=await rowOf('LEGACY_PENDING');assert.ok(unknownRow&&!/bg-error/.test(unknownRow.className),L('grid-no-red')+' '+unknownRow?.className);assert.ok(legacyRow&&/bg-error/.test(legacyRow.className),L('grid-legacy-red')+' '+legacyRow?.className);
  const stats=await page.evaluate(s=>eval(s).monthlyStats,store());assert.equal(stats.overduePayments,1,L('stats-overdue-excludes-awaiting')+' '+JSON.stringify(stats));
  assert.equal(await overflow(),false,L('mobile-overflow'));
  // 2. The day detail shows 銀行照合待ち for the unknown row and 期限超過 for the legacy row.
  await page.$eval('[data-calendar-day="'+unknownDay+'"]',e=>e.click());await wait(()=>!!document.querySelector('[data-calendar-day-detail]'),[],'day-detail');
  const badges=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-day-detail] [data-calendar-badge]')).map(e=>({badge:e.getAttribute('data-calendar-badge'),text:e.textContent.trim(),red:/bg-error/.test(e.className),row:e.closest('[data-calendar-day-detail] .cursor-pointer')?.textContent||''})));
  const unknownBadge=badges.find(b=>b.row.includes('UNKNOWN_PENDING')),legacyBadge=badges.find(b=>b.row.includes('LEGACY_PENDING'));
  assert.ok(unknownBadge,L('day-detail-row')+' '+JSON.stringify(badges));assert.equal(unknownBadge.badge,'bankWait',L('day-detail-bank-wait'));assert.equal(unknownBadge.text,'銀行照合待ち',L('day-detail-bank-wait-label'));assert.equal(unknownBadge.red,false,L('day-detail-no-red'));
  assert.equal(legacyBadge?.badge,'overdue',L('day-detail-legacy-overdue'));assert.equal(legacyBadge?.text,'期限超過');
  assert.equal(await overflow(),false,L('mobile-overflow-day-detail'));
  // 3. The editor's evidence panel lists the originals; opening the PDF hands the browser the exact bytes.
  await page.evaluate(()=>{const row=Array.from(document.querySelectorAll('[data-calendar-day-detail] .cursor-pointer')).find(e=>e.textContent.includes('UNKNOWN_PENDING'));row.click()});
  await wait(()=>!!document.querySelector('[data-calendar-payment-form]')&&!!document.querySelector('[data-calendar-evidence-panel]'),[],'editor-panel');
  await wait(n=>document.querySelectorAll('[data-calendar-evidence-file]').length>=n,[fileCount],'panel-files');
  const files=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-evidence-file]')).map(e=>({fileId:e.getAttribute('data-calendar-evidence-file'),text:e.textContent})));
  assert.equal(files.length,fileCount,L('panel-files')+' '+JSON.stringify(files));assert.ok(files.some(f=>f.fileId===pdfSha256&&f.text.includes(pdfName)),L('panel-pdf-listed'));
  const panelText=await page.$eval('[data-calendar-evidence-panel]',e=>e.textContent);assert.match(panelText,/SYN-A1/,L('panel-invoice-number'));assert.match(panelText,/銀行照合待ち/,L('panel-state'));assert.match(panelText,/2026-01-01/,L('panel-period'));
  assert.ok(await page.$('[data-calendar-evidence-versions]'),L('panel-versions-collapsed'));
  assert.equal(await overflow(),false,L('mobile-overflow-editor'));
  const popups=[];page.on('popup',p=>popups.push(p));
  await page.evaluate(id=>document.querySelector('[data-calendar-evidence-open="'+id+'"]').click(),pdfSha256);
  await wait(()=>!document.querySelector('[data-calendar-evidence-busy]'),[],'open-done');await pause(300);
  const received=await Promise.all(fileResponses);const pdf=received.find(r=>r.url.endsWith('/files/'+pdfSha256));assert.ok(pdf&&pdf.status===200,L('open-bytes')+' '+JSON.stringify(received));
  // DevTools does not hand back the body of a blob-read fetch (empty buffer), so the bytes the browser receives from that same route are
  // hashed inside the page with the session header (plan §7: assert the fetched bytes' sha instead of a rendered viewer).
  const pageSha=await page.evaluate(async(evidenceId,fileId)=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/calendar-evidence/'+evidenceId+'/files/'+fileId,{headers:user.authHeader});if(!r.ok)return 'status '+r.status;const h=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('')},evidenceId,pdfSha256);assert.equal(pageSha,pdfSha256,L('open-bytes-sha'));
  // 4. Confirming flips the badge: the panel shows 所有者確認済み, the day list shows 期限超過 (past due again), the awaiting block empties.
  await page.$eval('[data-calendar-verify-reason]',e=>{e.value='SYNTHETIC_OWNER_REASON';e.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.evaluate(()=>document.querySelector('[data-calendar-verify]').click());
  await wait(()=>document.querySelector('[data-calendar-verification-state]')?.getAttribute('data-calendar-verification-state')==='owner_confirmed',[],'confirm-flip');
  const saved=(await payments()).find(p=>String(p._id)===unknownId);assert.equal(saved.paymentVerification.state,'owner_confirmed',L('confirm-saved'));assert.equal(saved.paymentVerification.reason,'SYNTHETIC_OWNER_REASON',L('confirm-reason'));assert.equal(saved.status,'pending',L('confirm-status-kept'));
  const afterConfirm=await page.evaluate(s=>{const st=eval(s);return{status:st.payments.find(p=>p.title==='UNKNOWN_PENDING')?.status,verification:st.payments.find(p=>p.title==='UNKNOWN_PENDING')?.paymentVerification?.state,awaiting:st.awaitingVerificationPayments.length}},store());
  assert.equal(afterConfirm.verification,'owner_confirmed',L('store-row-replaced'));assert.equal(afterConfirm.awaiting,0,L('awaiting-empty-after-confirm'));
  await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-payment-form] button[type="button"]')).find(b=>/キャンセル|취소/.test(b.textContent)).click());await wait(()=>!document.querySelector('[data-calendar-payment-form]'),[],'editor-closed');
  assert.ok(!(await page.$('[data-calendar-awaiting]')),L('awaiting-block-gone'));
  await page.$eval('[data-calendar-day="'+unknownDay+'"]',e=>e.click());await wait(()=>!!document.querySelector('[data-calendar-day-detail]'),[],'day-detail-again');
  const flipped=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-day-detail] [data-calendar-badge]')).map(e=>({badge:e.getAttribute('data-calendar-badge'),row:e.closest('[data-calendar-day-detail] .cursor-pointer')?.textContent||''})).find(b=>b.row.includes('UNKNOWN_PENDING')));
  assert.equal(flipped?.badge,'overdue',L('confirm-flips-badge')+' '+JSON.stringify(flipped));
  await page.$eval('[data-calendar-day-detail] button',e=>e.click());
  // 5. Korean: the awaiting label and the status badge come from the locale, the data from the same store.
  const dbRow=(await payments()).find(p=>String(p._id)===unknownId);
  await page.goto(origin+'/ko/calendar',{waitUntil:'networkidle2'});await wait(()=>location.pathname==='/ko/calendar',[],'ko-page');await wait((s,id)=>(eval(s)?.payments||[]).some(p=>p.id===id),[store(),unknownId],'ko-loaded');
  await setMonth(unknownDay);await page.$eval('[data-calendar-day="'+unknownDay+'"]',e=>e.click());await wait(()=>!!document.querySelector('[data-calendar-day-detail]'),[],'ko-day-detail');
  const koBadges=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-calendar-day-detail] [data-calendar-badge]')).map(e=>({badge:e.getAttribute('data-calendar-badge'),text:e.textContent.trim(),row:e.closest('[data-calendar-day-detail] .cursor-pointer')?.textContent||''})));
  const koLegacy=koBadges.find(b=>b.row.includes('LEGACY_PENDING'));assert.equal(koLegacy?.text,'연체',L('ko-overdue-label'));
  await page.evaluate(()=>{const row=Array.from(document.querySelectorAll('[data-calendar-day-detail] .cursor-pointer')).find(e=>e.textContent.includes('UNKNOWN_PENDING'));row.click()});await wait(()=>!!document.querySelector('[data-calendar-evidence-panel]'),[],'ko-panel');await wait(n=>document.querySelectorAll('[data-calendar-evidence-file]').length>=n,[fileCount],'ko-panel-files');
  const koPanel=await page.$eval('[data-calendar-evidence-panel]',e=>e.textContent);assert.match(koPanel,/소유자 확인/,L('ko-state-label'));assert.ok(!/paymentModal\./.test(koPanel),L('ko-literal-keys'));assert.equal(dbRow.paymentVerification.state,'owner_confirmed');
  // Korean at 390px: the elements this change adds (panel, awaiting block, day-detail badge) must not overflow. The page already
  // overflows by a few pixels in Korean through CalendarStats' overdue icon (a file outside this plan, G12 territory); those
  // pre-existing offenders are listed in the pass text, never hidden, and never attributed to this change.
  const koOverflow=await page.evaluate(()=>{const w=innerWidth,mine=[],others=[];for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect();if(!(r.width>0&&r.right>w+1))continue;const o={tag:e.tagName,cls:String(e.className||'').slice(0,80),right:Math.round(r.right),text:(e.textContent||'').trim().slice(0,30)};(e.closest('[data-calendar-evidence-panel],[data-calendar-awaiting],[data-calendar-day-detail],[data-calendar-payment-form]')?mine:others).push(o)}return{scrollWidth:document.documentElement.scrollWidth,innerWidth:w,mine,others:others.slice(0,8)}});
  assert.deepEqual(koOverflow.mine,[],L('ko-mobile-overflow')+' '+JSON.stringify(koOverflow));
  const preExisting=koOverflow.others.length?' (pre-existing Korean 390px overflow outside this change: '+koOverflow.others.length+' element(s), scrollWidth '+koOverflow.scrollWidth+' > '+koOverflow.innerWidth+', e.g. '+koOverflow.others.map(o=>o.tag+'.'+o.cls.split(' ').slice(0,3).join('.')).slice(0,3).join(', ')+')':'';
  await page.setViewport({width:1280,height:900});await pause(300);assert.equal(await overflow(),false,L('desktop-overflow'));
  const screenshots=process.env.OMF_CALENDAR_EVIDENCE_SCREENSHOTS;if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'calendar-evidence-desktop.png')})}
  assert.deepEqual(dialogs,[],L('no-script-dialogs'));assert.deepEqual(errors,[],L('console-errors'));
  pass('real installed Chrome: the unknown row reads 銀行照合待ち, never red, out of the overdue alert and count, listed in the awaiting block; the editor panel lists its originals and opening the PDF hands the browser the exact bytes; the owner\'s confirmation flips the badge to 期限超過 and empties the block; Korean labels; no overflow at 390 (Japanese page, day detail and open editor) or 1280, none from this change in Korean'+preExisting);
 }catch(e){if(page&&process.env.OMF_CALENDAR_EVIDENCE_SCREENSHOTS){await fs.mkdir(process.env.OMF_CALENDAR_EVIDENCE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.OMF_CALENDAR_EVIDENCE_SCREENSHOTS,'failure.png')}).catch(()=>{})}throw e}
 finally{if(browser)await browser.close();const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('omf-calendar-evidence-ui-'));await fs.rm(resolved,{recursive:true,force:true})}
};

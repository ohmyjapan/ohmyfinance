// Actual installed Chrome and native owned fixture. No production/model calls; injected failures affect this page's test requests only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),{existsSync}=require('node:fs');
const {closeOwnedBrowser}=require('./finance-browser-cleanup.cjs');
module.exports=async({root,origin,db,A,B,ids,pause,pass})=>{
 const project=createRequire(path.join(root,'package.json')),{ObjectId}=project('mongodb');
 let puppeteer;try{puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;puppeteer=createRequire(path.resolve(root,'../collector/package.json'))('rebrowser-puppeteer-core')}
 const executablePath=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')].find(existsSync);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-receipt-library-')),downloads=path.join(directory,'downloads'),screenshots=process.env.OMF_RECEIPT_LIBRARY_SCREENSHOTS;
 let browser,page,held=null,holdNext=false,failReads=false,emptyCompany,failure=null;const errors=[],writes=[];
 const aIds=new Set((await db.collection('receipts').find({organizationId:A}).project({_id:1}).toArray()).map(x=>String(x._id)));
 const wait=async(fn,args=[],label='condition')=>{for(let i=0;i<200;i++){if(await page.evaluate(fn,...args))return;await pause(100)}throw Error('library-ui:'+label)};
 const push=to=>page.evaluate(to=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(to),to);
 const nativeSwitch=organizationId=>page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),session=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const profile=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+session.tokens.accessToken}});if(!profile.ok)throw Error('Synthetic profile failed');user.acceptSession({...await profile.json(),tokens:session.tokens},false)},String(organizationId));
 const set=async(selector,value)=>{await page.$eval(selector,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},value)};
 const rows=()=>page.$$eval('[data-library-row]',nodes=>nodes.map(n=>({id:n.dataset.libraryId,text:n.textContent})));
 const capture=async name=>{if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true})}};
 try{
  assert.ok(executablePath,'Installed Chrome required');await fs.mkdir(downloads);
  browser=await puppeteer.launch({executablePath,userDataDir:path.join(directory,'profile'),pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync']});
  page=await browser.newPage();await page.setViewport({width:390,height:844});const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{errors.push(d.message());d.dismiss().catch(()=>{})});page.on('request',r=>{if(r.url().includes('/api/receipts')&&r.method()!=='GET')writes.push(r.method()+' '+r.url())});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','business-owner@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  await nativeSwitch(A);await page.goto(origin+'/receipts',{waitUntil:'networkidle2'});await wait(()=>document.querySelectorAll('[data-library-row]').length===10,[],'real-rows');
  assert.ok((await rows()).every(r=>aIds.has(r.id)),'library-ui:only-owned');assert.deepEqual(await page.$$eval('[data-library-stats] .font-mono',nodes=>nodes.map(n=>n.textContent)),['26','7','7','26.92%'],'library-ui:real-statistics');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'library-ui:mobile-overflow');await capture('library-mobile');
  await page.click('[data-library-next]');await wait(()=>document.querySelector('[data-library-page]').textContent==='2 / 3',[],'pagination');
  await set('[data-library-search]','LIBRARY_00');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'search-reset-page');assert.equal((await rows())[0].id,String(ids[0]));assert.match((await rows())[0].text,/0/);assert.equal(await page.$eval('[data-library-page]',e=>e.textContent),'1 / 1');
  await set('[data-library-search]','');await page.select('[data-library-currency]','USD');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'currency-filter');assert.equal((await rows())[0].id,String(ids[1]));assert.match((await rows())[0].text,/125[.,]50/,'library-ui:fractional-usd');
  await page.select('[data-library-currency]','unknown');await wait(id=>document.querySelector('[data-library-row]')?.dataset.libraryId===id,[String(ids[2])],'unknown-currency');assert.match((await rows())[0].text,/通貨未記録/);
  await page.select('[data-library-currency]','');await page.select('[data-library-type]','png');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'type-filter');assert.equal((await rows())[0].id,String(ids[2]));
  await page.select('[data-library-type]','');await page.select('[data-library-status]','error');await wait(()=>document.querySelectorAll('[data-library-row]').length===6,[],'error-status');assert.ok((await rows()).every(r=>r.text.includes('エラー')));
  await page.select('[data-library-status]','');await set('[data-library-search]','[shop].*');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'literal-search');assert.equal((await rows())[0].id,String(ids[3]));
  await set('[data-library-search]','');await page.click('[data-library-filter-toggle]');await set('[data-library-min]','0');await set('[data-library-max]','0');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'zero-range');assert.equal((await rows())[0].id,String(ids[0]));
  await page.click('[data-library-reset]');await set('[data-library-date-from]','2026-02-12');await set('[data-library-date-to]','2026-02-12');await wait(()=>/\b24\b/.test(document.querySelector('[data-library-page-summary]')?.textContent||''),[],'date-filter');
  await set('[data-library-date-to]','2026-02-11');await wait(()=>!!document.querySelector('[data-library-empty]'),[],'empty-date-range');await page.click('[data-library-reset]');
  await set('[data-library-search]','LIBRARY_01');await wait(()=>document.querySelectorAll('[data-library-row]').length===1,[],'view-ready');await page.click('[data-library-view]');await wait(id=>location.pathname==='/receipts/'+id&&!!document.querySelector('[data-receipt-summary]'),[String(ids[1])],'actual-detail-link');
  await push('/receipts');await wait(()=>document.querySelectorAll('[data-library-row]').length===10,[],'back-to-library');await set('[data-library-search]','LIBRARY_');await page.click('[data-library-export]');
  let file;for(let i=0;i<100&&!file;i++){file=(await fs.readdir(downloads)).find(n=>n.endsWith('.csv'));if(!file)await pause(100)}assert.ok(file,'library-ui:actual-csv-download');const csv=await fs.readFile(path.join(downloads,file),'utf8');
  const parsed=project('papaparse').parse(csv.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:true});assert.equal(parsed.errors.length,0);assert.equal(parsed.data.length,24,'library-ui:filtered-csv');
  assert.equal(parsed.data.find(r=>r['領収書ID']===String(ids[0]))['金額'],'0');assert.equal(parsed.data.find(r=>r['領収書ID']===String(ids[1]))['通貨'],'USD');assert.equal(parsed.data.find(r=>r['領収書ID']===String(ids[1]))['金額'],'125.5');assert.equal(parsed.data.find(r=>r['領収書ID']===String(ids[2]))['通貨'],'');assert.equal(parsed.data.find(r=>r['領収書ID']===String(ids[4]))['店名'],"'=UNTRUSTED()",'library-ui:csv-text');
  assert.ok(!csv.includes('PRIVATE_LIBRARY_'));
  const layouts=[];
  for(const width of[768,1024,1365]){
   await page.setViewport({width,height:960});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await page.evaluate(()=>{
    const root=document.querySelector('[data-receipt-library]'),r=root.getBoundingClientRect();
    const escaped=[...root.querySelectorAll('*')].filter(n=>{const b=n.getBoundingClientRect();if(!b.width||b.right<=innerWidth+1&&b.left>=-1)return false;for(let p=n.parentElement;p&&root.contains(p);p=p.parentElement){if(['auto','scroll','hidden','clip'].includes(getComputedStyle(p).overflowX)){const c=p.getBoundingClientRect();if(c.left>=-1&&c.right<=innerWidth+1)return false}}return true}).map(n=>({tag:n.tagName,class:typeof n.className==='string'?n.className:''}));
    return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,escaped}
   });
   assert.ok(layout.left>=0&&layout.right<=width,'library-ui:frame-'+width);assert.deepEqual(layout.escaped,[],'library-ui:uncontained-content-'+width);
   // The shared account header already overflows at768 with this synthetic profile.
   // Retain an actual unchanged detail-page control instead of claiming full-app containment.
   if(layout.documentWidth>width){
    await capture('library-'+width);await push('/receipts/'+ids[1]);await wait(()=>!!document.querySelector('[data-receipt-summary]'),[],'overflow-control');
    layout.detailControlWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.equal(layout.documentWidth,layout.detailControlWidth,'library-ui:no-added-document-overflow-'+width);
    await push('/receipts');await wait(()=>document.querySelectorAll('[data-library-row]').length===10,[],'return-from-overflow-control');await set('[data-library-search]','LIBRARY_');
   }
   layouts.push(layout)
  }
  if(screenshots)await fs.writeFile(path.join(screenshots,'layout-results.json'),JSON.stringify(layouts,null,2)+'\n');await capture('library-desktop');
  pass('installed Chrome: saved rows/counts, zero/decimal/unknown currencies, literal/status/type/range filters, pagination/detail link and real filtered CSV bytes; library contained at390/768/1024/1365, shared tablet-header overflow retained with detail-page control');

  await page.setRequestInterception(true);page.on('request',request=>{(async()=>{
   if(request.url()===origin+'/api/receipts/library'){
    if(holdNext){holdNext=false;const r=await fetch(request.url(),{headers:request.headers()});held={request,status:r.status,body:await r.text()};return}
    if(failReads){await request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'PRIVATE_SYNTHETIC_LIBRARY_FAILURE'})});return}
   }
   await request.continue();
  })().catch(e=>errors.push(String(e)))});
  holdNext=true;await page.reload({waitUntil:'domcontentloaded'});for(let i=0;i<100&&!held;i++)await pause(100);assert.ok(held);assert.equal(held.status,200);
  await nativeSwitch(B);await wait(()=>document.querySelectorAll('[data-library-row]').length===3,[],'switch-B');assert.ok((await rows()).every(r=>!aIds.has(r.id)));
  await held.request.respond({status:held.status,contentType:'application/json',body:held.body});held=null;await pause(200);assert.equal((await rows()).length,3);assert.ok((await rows()).every(r=>!aIds.has(r.id)),'library-ui:late-response-discarded');
  await nativeSwitch(A);await wait(()=>document.querySelectorAll('[data-library-row]').length===10,[],'switch-back');
  failReads=true;await page.click('[data-library-refresh]');await wait(()=>!!document.querySelector('[data-library-error]'),[],'read-failure');assert.equal((await rows()).length,0);assert.ok(!(await page.$eval('[data-receipt-library]',e=>e.textContent)).includes('PRIVATE_SYNTHETIC_LIBRARY_FAILURE'));
  failReads=false;await page.click('[data-library-retry]');await wait(()=>document.querySelectorAll('[data-library-row]').length===10,[],'retry');
  emptyCompany=new ObjectId();const organization=await db.collection('organizations').findOne({_id:A});await db.collection('organizations').insertOne({_id:emptyCompany,name:'Synthetic empty library',slug:'library-empty-'+emptyCompany,isActive:true,members:organization.members});
  await nativeSwitch(emptyCompany);await wait(()=>!!document.querySelector('[data-library-empty]'),[],'empty-company');assert.equal((await rows()).length,0);assert.deepEqual(await page.$$eval('[data-library-stats] .font-mono',nodes=>nodes.map(n=>n.textContent)),['0','0','0','0%']);
  assert.deepEqual(writes,[],'library-ui:no-receipt-writes');assert.deepEqual(errors,[],'library-ui:no-page-errors');
  pass('installed Chrome: actual delayed company read discarded, switch-back succeeds, failure clears rows with retry and empty company shows true zero counts; no receipt writes');
 }catch(e){
  failure=e;
  if(page)await capture('failure').catch(()=>{});
  if(page&&screenshots&&e.message.includes('overflow')){
   const layout=()=>({path:location.pathname,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].flatMap(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);if(!r.width||r.right<=innerWidth+1)return[];const clips=[];for(let p=n.parentElement;p;p=p.parentElement){const c=getComputedStyle(p);if(['auto','scroll','hidden','clip'].includes(c.overflowX))clips.push({tag:p.tagName,class:p.className,right:p.getBoundingClientRect().right,overflowX:c.overflowX})}return[{tag:n.tagName,class:typeof n.className==='string'?n.className:'',left:r.left,right:r.right,width:r.width,scrollWidth:n.scrollWidth,overflowX:s.overflowX,clips}]})});
   const result={failure:await page.evaluate(layout)};
   try{await push('/receipts/'+ids[1]);await wait(()=>!!document.querySelector('[data-receipt-summary]'),[],'baseline-detail');result.detailBaseline=await page.evaluate(layout);await capture('detail-baseline')}catch(error){result.baselineError=error.message}
   await fs.writeFile(path.join(screenshots,'failure-layout.json'),JSON.stringify(result,null,2)+'\n');
  }
  throw e
 }
 finally{
  if(held)await held.request.respond({status:held.status,contentType:'application/json',body:held.body}).catch(()=>{});
  if(browser)console.log('CLEANUP receipt-library-browser '+JSON.stringify(await closeOwnedBrowser(browser,{primaryError:failure})));if(emptyCompany)await db.collection('organizations').deleteOne({_id:emptyCompany});
  const target=path.resolve(directory),temp=path.resolve(os.tmpdir());assert.ok(target.startsWith(temp+path.sep)&&path.basename(target).startsWith('omf-receipt-library-'));await fs.rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:500});
 }
};

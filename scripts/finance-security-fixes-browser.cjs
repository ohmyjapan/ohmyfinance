// Installed-Chrome leg of scripts/finance-security-fixes-integration.cjs (plan omf-security-fixes-20261102 §4 L9): the profile
// password change hands the fresh tokens to the store (the session survives, the next renewal is 200), and the three upload pages
// (/transactions/upload, /file-upload, /upload-test) send Authorization and show each page's own success display. Real Chrome
// headless against the owned server; nothing is read from disk after the request-lifetime cleanup. Loaded only when the harness
// runs with OMF_SECURITY_BROWSER=1; the collector's pinned puppeteer fork is resolved from OMF_SECURITY_PUPPETEER_BASE or the
// parent checkout (a worktree carries collector/package.json but no collector/node_modules).
const path=require('node:path'),fs=require('node:fs'),fsp=require('node:fs/promises'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const chromePath=()=>[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')].find(fs.existsSync);
const puppeteerLib=()=>{const bases=[process.env.OMF_SECURITY_PUPPETEER_BASE,path.join(__dirname,'../collector/package.json'),path.resolve(__dirname,'../../collector/package.json'),path.resolve(__dirname,'../../../collector/package.json')].filter(Boolean);for(const p of bases){try{return createRequire(p)('rebrowser-puppeteer-core')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}}throw Error('rebrowser-puppeteer-core not found from '+bases.join(' | '))};
async function runBrowserLeg({origin,users,PASSWORD,CHANGED,directory,xlsxPath,csvPath,L,assert,pause}){
 const chrome=chromePath();assert.ok(chrome,'SETUP installed Chrome required for L9');
 const puppeteer=puppeteerLib(),profile=path.join(directory,'profile-'+crypto.randomBytes(4).toString('hex'));await fsp.mkdir(profile,{recursive:true});
 const browser=await puppeteer.launch({executablePath:chrome,userDataDir:profile,pipe:true,headless:true,args:['--lang=ja-JP,ja','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});
 const pageErrors=[],apiRequests=[];
 try{
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1024,height:900});
  await page.setRequestInterception(true);
  page.on('request',r=>{const u=new URL(r.url());if(u.origin!==origin)return void r.abort();if(u.pathname==='/api/excel-processor'||u.pathname==='/api/upload')apiRequests.push({path:u.pathname,authorized:/^Bearer /.test(r.headers().authorization||r.headers().Authorization||'')});void r.continue()});
  page.on('pageerror',e=>pageErrors.push(String(e)));
  const wait=async(fn,args=[],label='condition',tries=600)=>{for(let i=0;i<tries;i++){try{if(await page.evaluate(fn,...args))return}catch{}await pause(100)}throw Error(L('L9-ui-'+label)+' url='+page.url()+' text='+(await page.evaluate(()=>document.body?.innerText||'').catch(()=>'')).slice(0,800))};
  const store=fn=>page.evaluate(fn);
  // Sign in as the admin of A (no 2FA) through the real login page.
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('#email'),[],'login-form');
  await page.type('#email',users.adminA.email);await page.type('#password',PASSWORD);await page.evaluate(()=>document.querySelector('button[type=submit]').click());await wait(()=>location.pathname==='/',[],'login');
  const tokenBefore=await store(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').token);assert.ok(tokenBefore,L('L9-signed-in'));
  // Profile: change the password; the store adopts the response tokens and the next renewal succeeds.
  await page.goto(origin+'/profile',{waitUntil:'networkidle2'});await wait(()=>document.querySelectorAll('form input[type=password]').length>=3,[],'password-form');
  const inputs=await page.$$('form input[type=password]');await inputs[0].type(PASSWORD);await inputs[1].type(CHANGED);await inputs[2].type(CHANGED);
  await page.evaluate(()=>document.querySelector('input[type=password]').closest('form').querySelector('button[type=submit]').click());
  await wait(before=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').token!==before,[tokenBefore],'profile-token-adopted',300);
  const after=await store(()=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');return{token:s.token,refresh:s.refreshToken,authenticated:s.isAuthenticated,stored:JSON.parse(localStorage.getItem('ohmyfinance_session')||'{}').tokens?.accessToken}});
  assert.notEqual(after.token,tokenBefore,L('L9-profile-token-adopted'));assert.equal(after.authenticated,true,L('L9-profile-still-signed-in'));assert.equal(after.stored,after.token,L('L9-profile-token-persisted'));
  const renewal=await store(async()=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await s.refreshAuthToken();return{result:r,authenticated:s.isAuthenticated}});
  assert.equal(renewal.result,'refreshed',L('L9-profile-refresh')+' '+JSON.stringify(renewal));assert.equal(renewal.authenticated,true,L('L9-profile-refresh-keeps-session'));
  await wait(()=>/success|成功|変更/.test(document.body.innerText)||!!document.querySelector('form .text-green-600'),[],'profile-success',100).catch(()=>{});
  // /transactions/upload: the file card shows the row count.
  await page.goto(origin+'/transactions/upload',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('input[type=file]'),[],'transactions-upload-input');
  apiRequests.length=0;await(await page.$('input[type=file]')).uploadFile(xlsxPath);
  await wait(name=>[...document.querySelectorAll('tbody tr')].some(tr=>tr.innerText.includes(name)&&tr.innerText.includes('有効')),[path.basename(xlsxPath)],'transactions-upload-row');
  const rowText=await page.evaluate(name=>[...document.querySelectorAll('tbody tr')].find(tr=>tr.innerText.includes(name)).innerText,path.basename(xlsxPath));assert.match(rowText,/\b2\b/,L('L9-transactions-upload-rowcount')+' '+rowText);
  assert.ok(apiRequests.some(r=>r.path==='/api/excel-processor'&&r.authorized),L('L9-transactions-upload-authorization')+' '+JSON.stringify(apiRequests));
  // /file-upload: FileUpload (default uploadUrl /api/excel-processor) shows the success section; the page shows Data Preview.
  await page.goto(origin+'/file-upload',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('input[type=file]'),[],'file-upload-input');
  apiRequests.length=0;await(await page.$('input[type=file]')).uploadFile(csvPath);
  await wait(name=>document.body.innerText.includes('処理成功')&&document.body.innerText.includes(name),[path.basename(csvPath)],'file-upload-success');
  assert.ok(await page.evaluate(()=>document.body.innerText.includes('Data Preview')),L('L9-file-upload-preview'));assert.ok(await page.evaluate(()=>[...document.querySelectorAll('th')].some(th=>th.textContent.trim()==='Date')),L('L9-file-upload-preview-columns'));
  assert.ok(apiRequests.some(r=>r.path==='/api/excel-processor'&&r.authorized),L('L9-file-upload-authorization')+' '+JSON.stringify(apiRequests));
  // /upload-test: GenericFileUploader shows originalName, savedAs and a non-null processedPath.
  await page.goto(origin+'/upload-test',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('input[type=file]'),[],'upload-test-input');
  apiRequests.length=0;await(await page.$('input[type=file]')).uploadFile(xlsxPath);
  await wait(()=>document.body.innerText.includes('処理成功'),[],'upload-test-success');
  const shown=await page.evaluate(()=>[...document.querySelectorAll('div.bg-green-50 p')].map(p=>p.innerText.trim()));
  assert.equal(shown.length,3,L('L9-upload-test-section')+' '+JSON.stringify(shown));assert.ok(shown[0].includes(path.basename(xlsxPath)),L('L9-upload-test-original-name')+' '+JSON.stringify(shown));assert.match(shown[1],/\d{10,}-synthetic-rows\.xlsx/,L('L9-upload-test-saved-as')+' '+JSON.stringify(shown));
  assert.match(shown[2],/synthetic-rows\.json/,L('L9-upload-test-processed-path')+' '+JSON.stringify(shown));assert.ok(!/:\s*(null)?$/.test(shown[2]),L('L9-upload-test-processed-non-null')+' '+JSON.stringify(shown));
  assert.ok(apiRequests.some(r=>r.path==='/api/upload'&&r.authorized),L('L9-upload-test-authorization')+' '+JSON.stringify(apiRequests));
  assert.deepEqual(pageErrors,[],L('L9-page-errors'));
  await context.close();
 }finally{try{await browser.close()}catch{}}
}
module.exports={runBrowserLeg,chromePath};

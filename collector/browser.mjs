import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { connect } from 'puppeteer-real-browser';
import { parseAmex, period } from '../shared/amex.mjs';
const require=createRequire(import.meta.url);
const puppeteer=require(require.resolve('rebrowser-puppeteer-core',{paths:[path.dirname(require.resolve('puppeteer-real-browser'))]}));
const execute=promisify(execFile), pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const LOGIN='https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog';
const sessions=new Map();
export async function browserFor(profile) {
  if(sessions.get(profile)?.connected) return sessions.get(profile);
  await mkdir(profile,{recursive:true});
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows/browser-process.ps1',import.meta.url)),'-Profile',profile],{windowsHide:true,timeout:15000});
  const running=JSON.parse(stdout.trim() || '[]');
  if(running.length>1 || running.some(p=>!p.port))throw new Error('Close the duplicate or non-debuggable Amex profile before retrying');
  const browser=running.length ? await puppeteer.connect({browserURL:`http://127.0.0.1:${running[0].port}`,defaultViewport:null}) : (await connect({headless:false,turnstile:false,args:['--lang=ja-JP,ja','--accept-lang=ja-JP,ja;q=0.9,en;q=0.8'],customConfig:{userDataDir:profile},connectOption:{defaultViewport:null}})).browser;
  sessions.set(profile,browser);browser.on('disconnected',()=>sessions.delete(profile));return browser;
}
function allowed(page) { const u=new URL(page.url());return u.protocol==='https:' && ['www.americanexpress.com','global.americanexpress.com'].includes(u.hostname); }
export async function amexPage(browser) {
  const pages=await browser.pages();return pages.find(p=>{try{return allowed(p)}catch{return false}}) || await browser.newPage();
}
export async function ensureLogin(page,credentials,status,{timeoutMs=300000}={}) {
  if(!allowedSafe(page) || new URL(page.url()).pathname.includes('/login')) {
    await page.goto(LOGIN,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('#eliloUserID',{timeout:30000});
    if(credentials?.username && credentials?.password) {
      if(!allowed(page))throw new Error('Unexpected login origin');
      await page.click('#eliloUserID',{clickCount:3});await page.type('#eliloUserID',credentials.username);
      await page.click('#eliloPassword',{clickCount:3});await page.type('#eliloPassword',credentials.password);
      await page.click('#loginSubmit');
    }
  }
  const deadline=Date.now()+timeoutMs;let notified=false;
  while(Date.now()<deadline) {
    if(allowedSafe(page) && new URL(page.url()).hostname==='global.americanexpress.com' && await page.$('a[href*="/activity/statement"]'))return;
    if(!notified){await status('verification_required','Complete the Amex login or email verification in Chrome');await page.bringToFront();notified=true;}
    await pause(2000);
  }
  throw new Error('Amex login needs attention in Chrome; retry when verification is complete');
}
function allowedSafe(page) {try{return allowed(page)}catch{return false}}
export async function collectStatement(account,settings,directory,status) {
  const profile=settings.profile || path.join(directory,'profiles',account.primaryCard);
  const browser=await browserFor(profile), page=await amexPage(browser);
  await ensureLogin(page,settings,status);
  await status('running','Reading the selected Amex statement');
  await page.goto('https://global.americanexpress.com/activity/statement',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('#action-icon-dls-icon-download-',{timeout:45000});
  const snapshot=await page.evaluate(()=>{
    const visible=e=>e.getBoundingClientRect().height>0;
    const buttons=[...document.querySelectorAll('button')].filter(visible).map(e=>e.innerText.trim());
    const text=document.body.innerText;
    const periodPattern=/\d{4}\/\d{2}\/\d{2}\s*-\s*\d{4}\/\d{2}\/\d{2}/g;
    const selected=[...document.querySelectorAll('select')].filter(visible).map(e=>e.selectedOptions[0]?.textContent || '').concat(buttons).flatMap(t=>t.match(periodPattern)||[]);
    return {cards:buttons.filter(t=>/^-\d{5}$/.test(t)),periods:[...new Set(selected.length?selected:text.match(periodPattern)||[])],counts:[...text.matchAll(/([\d,]+)\s*件中\s*([\d,]+)\s*件を表示/g)].map(m=>[Number(m[1].replaceAll(',','')),Number(m[2].replaceAll(',',''))])};
  });
  if(!snapshot.cards.includes('-'+account.primaryCard))throw new Error('The signed-in Amex account does not match this connection');
  if(snapshot.periods.length!==1 || snapshot.counts.length!==1 || snapshot.counts[0][0]!==snapshot.counts[0][1])throw new Error('Amex statement period or complete row count could not be verified');
  const [start,end]=snapshot.periods[0].split(/\s*-\s*/);const coverage=period({kind:'statement',start,end});
  const jobDir=path.join(directory,'outbox',account._id,account.jobId);await mkdir(jobDir,{recursive:true});
  const session=await browser.target().createCDPSession();let timer;
  try {
    await session.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:jobDir,eventsEnabled:true});
    let guid;
    const complete=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Amex CSV download did not complete')),45000);
      session.on('Browser.downloadWillBegin',event=>{if(event.suggestedFilename.toLowerCase().endsWith('.csv'))guid=event.guid;});
      session.on('Browser.downloadProgress',event=>{if(event.guid!==guid)return;if(event.state==='completed')resolve(guid);if(event.state==='canceled')reject(new Error('Amex canceled the CSV download'));});
    });
    // Attach rejection handling while the dialog is opening.
    complete.catch(()=>{});
    await page.click('#action-icon-dls-icon-download-');
    await page.waitForSelector('#axp-activity-download-body-selection-options-type_csv',{timeout:15000});
    await page.click('#axp-activity-download-body-selection-options-type_csv');
    const clicked=await page.evaluate(()=>{const buttons=[...document.querySelectorAll('[role="dialog"] button')].filter(e=>e.textContent.trim()==='ダウンロード'&&!e.disabled);if(buttons.length!==1)return false;buttons[0].click();return true;});
    if(!clicked)throw new Error('Amex CSV download button changed');
    const filename=await complete, bytes=await readFile(path.join(jobDir,filename));
    const parsed=parseAmex(bytes,account.cardIdentifiers);
    if(parsed.rows.length!==snapshot.counts[0][0])throw new Error('Downloaded row count does not match the Amex page');
    const manifest={accountId:account._id,primaryCard:account.primaryCard,jobId:account.jobId,...coverage,pageCount:parsed.rows.length,sha256:parsed.sha256,filename,downloadedAt:new Date().toISOString()};
    await writeFile(path.join(jobDir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
    return {directory:jobDir,manifest};
  } finally {clearTimeout(timer);await session.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false}).catch(()=>{});await session.detach().catch(()=>{});}
}

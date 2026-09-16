import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const execute=promisify(execFile),require=createRequire(new URL('../collector/package.json',import.meta.url));
export const CSV_LIMIT=25000000;

// Attach only to the Chrome profile already opened by OhMyCode. Never launch a
// second browser or copy its cookies into a separate HTTP client.
export async function connectSheetBrowser(profile){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(profile||''))throw Error('Invalid spreadsheet browser profile');
 const parent=fileURLToPath(new URL('../../',import.meta.url)),matches=new Map();
 for(const hub of ['ohmycode','ohmycode-prod']){
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../collector/windows/browser-process.ps1',import.meta.url)),'-ProfilePath',path.join(parent,hub,'data','browser-profiles',profile)],{windowsHide:true,timeout:15000});
  for(const match of JSON.parse(stdout).matches)matches.set(match.pid,match);
 }
 const running=[...matches.values()];
 if(running.length!==1||!running[0].port)throw Error('The authorized spreadsheet Chrome profile could not be identified');
 return require('rebrowser-puppeteer-core').connect({browserURL:'http://127.0.0.1:'+running[0].port,defaultViewport:null,protocolTimeout:45000});
}

// Self-contained because Puppeteer executes this inside the selected sheet.
export function selectedSheet(){
 const tab=document.querySelector('.docs-sheet-active-tab');
 return {title:tab?.querySelector('.docs-sheet-tab-name')?.textContent?.trim()||'',gid:new URLSearchParams(location.hash.slice(1)).get('gid')};
}

export async function selectSheet(page,title){
 await page.waitForSelector('.docs-sheet-tab-name',{timeout:15000});
 const before=await page.evaluate(selectedSheet);
 const tabs=await page.$$('.docs-sheet-tab');let target;
 for(const tab of tabs)if(await tab.evaluate((el,title)=>el.querySelector('.docs-sheet-tab-name')?.textContent?.trim()===title,title)){target=tab;break}
 if(!target)throw Error('Configured spreadsheet tab is unavailable');
 if(before.title!==title)await target.click();
 await page.waitForFunction((title,before)=>{
  const active=document.querySelector('.docs-sheet-active-tab')?.querySelector('.docs-sheet-tab-name')?.textContent?.trim(),gid=new URLSearchParams(location.hash.slice(1)).get('gid');
  return active===title&&/^\d+$/.test(gid||'')&&(before.title===title||gid!==before.gid);
 },{timeout:15000},title,before);
 const selected=await page.evaluate(selectedSheet);
 if(selected.title!==title||!/^\d+$/.test(selected.gid||''))throw Error('Configured spreadsheet tab could not be verified');
 return selected;
}

export function sheetExportUrl(id,gid){
 if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id||'')||!/^\d+$/.test(String(gid??'')))throw Error('Invalid spreadsheet export target');
 return 'https://docs.google.com/spreadsheets/d/'+id+'/export?format=csv&gid='+gid+'&range=A1:AZ50000';
}

// Read the original navigation response in our own temporary tab. Fetch in the
// Sheets renderer fails across the export redirect. Response interception avoids
// that restriction without changing browser-wide download settings or files.
export async function readSheetCsv(browser,url,{limit=CSV_LIMIT,timeout=45000}={}){
 const page=await browser.newPage();let cdp,timer,stream,paused,finish;
 try{
  cdp=await page.createCDPSession();
  const complete=new Promise((resolve,reject)=>{finish=(error,value)=>error?reject(error):resolve(value);timer=setTimeout(()=>reject(Error('Original spreadsheet CSV timed out')),timeout)});complete.catch(()=>{});
  cdp.on('Fetch.requestPaused',async event=>{
   try{
    if(event.resourceType!=='Document'){await cdp.send('Fetch.continueRequest',{requestId:event.requestId});return}
    const responseUrl=new URL(event.request.url),headers=Object.fromEntries((event.responseHeaders||[]).map(h=>[h.name.toLowerCase(),h.value]));
    if(responseUrl.protocol!=='https:'||!(responseUrl.hostname==='docs.google.com'||responseUrl.hostname.endsWith('.googleusercontent.com')))throw Error('Spreadsheet export redirected outside its authorized source');
    if(event.responseStatusCode>=300&&event.responseStatusCode<400){await cdp.send('Fetch.continueRequest',{requestId:event.requestId});return}
    paused=event.requestId;
    if(event.responseStatusCode!==200||!/^text\/csv(?:;|$)/i.test(headers['content-type']||''))throw Error('Original spreadsheet CSV requires access to the configured sheet');
    if(Number(headers['content-length'])>limit)throw Error('Spreadsheet export is too large');
    ({stream}=await cdp.send('Fetch.takeResponseBodyAsStream',{requestId:paused}));
    const chunks=[];let total=0;
    for(;;){const part=await cdp.send('IO.read',{handle:stream,size:65536}),bytes=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');total+=bytes.length;if(total>limit)throw Error('Spreadsheet export is too large');chunks.push(bytes);if(part.eof)break}
    await cdp.send('IO.close',{handle:stream});stream=null;
    const csv=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    if(!csv.trim()||/^\s*</.test(csv))throw Error('Original spreadsheet CSV is unavailable');
    await cdp.send('Fetch.failRequest',{requestId:paused,errorReason:'Aborted'});paused=null;finish(null,csv);
   }catch(error){finish(error)}
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Response'}]});
  const navigation=page.goto(url,{waitUntil:'domcontentloaded',timeout}).catch(error=>{if(!error.message.includes('ERR_ABORTED'))finish(Error('Original spreadsheet CSV navigation failed'))});
  const csv=await complete;await navigation;return csv;
 }finally{
  clearTimeout(timer);
  if(stream)await cdp.send('IO.close',{handle:stream}).catch(()=>{});
  if(paused)await cdp.send('Fetch.failRequest',{requestId:paused,errorReason:'Aborted'}).catch(()=>{});
  await page.close().catch(()=>{});
  if(cdp)await cdp.detach().catch(()=>{});
 }
}

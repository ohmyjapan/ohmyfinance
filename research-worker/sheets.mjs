import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import {matchSheetRows} from './search-evidence.mjs';
import {connectSheetBrowser,selectSheet,selectedSheet,readSheetCsv,sheetExportUrl,CSV_LIMIT} from './sheet-export.mjs';

export function browserApi(route,body) {
 return new Promise((resolve,reject)=>{
  const data=JSON.stringify(body),request=https.request({hostname:'localhost',port:6060,path:'/api/browser/'+route,method:'POST',rejectUnauthorized:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},response=>{
   let output='';response.on('data',b=>{output+=b;if(output.length>1000000)request.destroy(Error('Browser response too large'))});response.on('end',()=>{try{if(response.statusCode!==200){reject(Error('Real-browser '+route+' returned HTTP '+response.statusCode));return}resolve(JSON.parse(output))}catch{reject(Error('Real-browser service unavailable'))}});response.on('error',reject);
  });request.setTimeout(60000,()=>request.destroy(Error('Real-browser request timed out')));request.on('error',()=>reject(Error('Real-browser service unavailable')));request.end(data);
 });
}

// Unlike bank-statement parsers, blank sheet rows must retain their positions.
export function parseSheetCsv(csv){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>CSV_LIMIT||/^\s*</.test(csv))throw Error('Spreadsheet export is unavailable');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const field=()=>{row.push(cell);cell='';closed=false;if(row.length>52)throw Error('Spreadsheet export exceeded its column range')};
 const line=()=>{field();rows.push(row);row=[];if(rows.length>50000)throw Error('Spreadsheet export exceeded its row range')};
 for(let i=csv.charCodeAt(0)===0xfeff?1:0;i<csv.length;i++){
  const c=csv[i];
  if(quoted){if(c==='"'){if(csv[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c}
  else if(c==='"'){if(cell||closed)throw Error('Malformed spreadsheet CSV');quoted=true}
  else if(c===',')field();
  else if(c==='\r'||c==='\n'){if(c==='\r'&&csv[i+1]==='\n')i++;line()}
  else{if(closed)throw Error('Malformed spreadsheet CSV');cell+=c}
 }
 if(quoted)throw Error('Incomplete spreadsheet CSV');
 if(cell||row.length||closed)line();
 return rows;
}

export function searchCsv(csv,terms,purchaseDate,windowed=true,{offset=0,expectedSnapshot=''}={}){
 const rows=parseSheetCsv(csv),snapshotHash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 if(expectedSnapshot&&snapshotHash!==expectedSnapshot)throw Error('Spreadsheet changed between pages; restart the search instead of combining different snapshots');
 return {snapshotHash,...matchSheetRows(rows,{terms,purchaseDate,windowed,exportMode:'original_csv',range:'A1:AZ50000',offset})};
}

export async function captureBrowserSheet(config,source) {
 const id=config.spreadsheets?.[source],title=config.spreadsheetTabs?.[source],profile=config.spreadsheetBrowserProfile;
 if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id||'')||!title||!/^[a-zA-Z0-9_-]{1,80}$/.test(profile||''))throw Error('Spreadsheet browser connection is not configured');
 const prefix='https://docs.google.com/spreadsheets/d/'+id+'/',opened=await browserApi('open',{url:prefix+'edit',profile,wait_for_cf:false});let browser;
 try{
  if(!String(opened.url).startsWith(prefix+'edit'))throw Error('Sign in to the authorized spreadsheet browser');
  const marker=randomUUID();await browserApi('eval',{session_id:opened.session_id,script:'window.__omfSheetRead='+JSON.stringify(marker)});
  browser=await connectSheetBrowser(profile);let page;
  for(const candidate of await browser.pages())if(candidate.url().startsWith(prefix+'edit')&&await candidate.evaluate(marker=>window.__omfSheetRead===marker,marker)){page=candidate;break}
  if(!page)throw Error('The authorized spreadsheet tab could not be identified');
  const selected=await selectSheet(page,title),csv=await readSheetCsv(browser,sheetExportUrl(id,selected.gid));
  const after=await page.evaluate(selectedSheet);
  if(!page.url().startsWith(prefix+'edit')||after.title!==title||after.gid!==selected.gid)throw Error('The spreadsheet selection changed during export');
  return {sheet:title,gid:selected.gid,url:prefix+'edit#gid='+selected.gid,capturedAt:new Date().toISOString(),csv};
 }finally{
  try{if(browser)await browser.disconnect()}finally{await browserApi('close',{session_id:opened.session_id}).catch(()=>{})}
 }
}

export async function searchBrowserSheet(config,source,terms,purchaseDate,windowed=true,options={}) {
 const {sheet,gid,csv}=await captureBrowserSheet(config,source);
 return {sheet,gid,...searchCsv(csv,terms,purchaseDate,windowed,options)};
}

import https from 'node:https';
import {matchSheetRows} from './search-evidence.mjs';
function browserApi(route,body) {
 return new Promise((resolve,reject)=>{
  const data=JSON.stringify(body),request=https.request({hostname:'localhost',port:6060,path:'/api/browser/'+route,method:'POST',rejectUnauthorized:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},response=>{
   let output='';response.on('data',b=>{output+=b;if(output.length>1000000)request.destroy(Error('Browser response too large'))});response.on('end',()=>{try{if(response.statusCode!==200){reject(Error('Real-browser '+route+' returned HTTP '+response.statusCode+': '+output.slice(0,300)));return}resolve(JSON.parse(output))}catch{reject(Error('Real-browser service unavailable'))}});response.on('error',reject);
  });request.setTimeout(60000,()=>request.destroy(Error('Real-browser request timed out')));request.on('error',()=>reject(Error('Real-browser service unavailable')));request.end(data);
 });
}
async function selectTab(title){
 let tab;
 for(let i=0;i<12;i++){
  tab=Array.from(document.querySelectorAll('.docs-sheet-tab')).find(el=>(el.innerText||'').trim().split('\n').at(-1)?.trim()===title);
  if(tab)break;await new Promise(r=>setTimeout(r,500));
 }
 if(!tab)return {gid:null};
 tab.click();
 await new Promise(r=>setTimeout(r,700));
 const gid=new URLSearchParams(location.hash.replace(/^#/, '')).get('gid');
 return {gid:/^\d+$/.test(gid||'')?gid:null};
}
export async function searchCsv(spreadsheetId,gid,terms,purchaseDate,windowed,title,matchRows,{offset=0,expectedSnapshot=''}={}){
 let response,exportMode='original_csv';
 try{response=await fetch('/spreadsheets/d/'+spreadsheetId+'/export?format=csv&gid='+gid,{credentials:'include'})}catch{}
 if(!response?.ok){exportMode='google_query_csv';response=await fetch('/spreadsheets/d/'+spreadsheetId+'/gviz/tq?tqx=out:csv&headers=0&range=A1:AZ50000&sheet='+encodeURIComponent(title),{credentials:'include'})}
 if(!response.ok)throw Error('Spreadsheet export requires sign-in');
 const csv=await response.text();if(csv.length>25000000||/^\s*</.test(csv))throw Error('Spreadsheet export is unavailable');
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}
 if(cell||row.length){row.push(cell);rows.push(row)}
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows))),snapshotHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(expectedSnapshot&&snapshotHash!==expectedSnapshot)throw Error('Spreadsheet changed between pages; restart the search instead of combining different snapshots');
 return JSON.stringify({snapshotHash,...matchRows(rows,{terms,purchaseDate,windowed,exportMode,range:exportMode==='google_query_csv'?'A1:AZ50000':'entire_tab',offset})});
}
export async function searchBrowserSheet(config,source,terms,purchaseDate,windowed=true,page={}) {
 const id=config.spreadsheets?.[source],title=config.spreadsheetTabs?.[source];
 if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id||'')||!title||!config.spreadsheetBrowserProfile)throw Error('Spreadsheet browser connection is not configured');
 const opened=await browserApi('open',{url:'https://docs.google.com/spreadsheets/d/'+id+'/edit',profile:config.spreadsheetBrowserProfile,wait_for_cf:false});
 try{
 if(!String(opened.url).startsWith('https://docs.google.com/spreadsheets/d/'+id+'/'))throw Error('Sign in to the authorized spreadsheet browser');
 const selected=await browserApi('eval',{session_id:opened.session_id,script:'('+selectTab.toString()+')('+JSON.stringify(title)+')'}),tab=JSON.parse(selected.output);
 if(!tab.gid)throw Error('Configured spreadsheet tab is unavailable');
 const result=await browserApi('eval',{session_id:opened.session_id,script:'('+searchCsv.toString()+')('+[id,tab.gid,terms,purchaseDate,windowed,title].map(v=>JSON.stringify(v)).join(',')+',('+matchSheetRows.toString()+'),'+JSON.stringify(page)+')'});
 return {sheet:title,gid:tab.gid,...JSON.parse(result.output)};
 }finally{await browserApi('close',{session_id:opened.session_id}).catch(()=>{})}
}

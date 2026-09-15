import https from 'node:https';
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
async function searchCsv(spreadsheetId,gid,terms,purchaseDate,windowed,title){
 let response,exportMode='original_csv';
 try{response=await fetch('/spreadsheets/d/'+spreadsheetId+'/export?format=csv&gid='+gid,{credentials:'include'})}catch{}
 if(!response?.ok){exportMode='google_query_csv';response=await fetch('/spreadsheets/d/'+spreadsheetId+'/gviz/tq?tqx=out:csv&headers=0&range=A1:AZ50000&sheet='+encodeURIComponent(title),{credentials:'include'})}
 if(!response.ok)throw Error('Spreadsheet export requires sign-in');
 const csv=await response.text();if(csv.length>25000000||/^\s*</.test(csv))throw Error('Spreadsheet export is unavailable');
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}
 if(cell||row.length){row.push(cell);rows.push(row)}
 const normalize=v=>String(v).normalize('NFKC').toLowerCase().replace(/[ ,\t]/g,''),normalized=terms.map(normalize),date=Date.parse(purchaseDate),matches=[];let count=0;
 const near=value=>{const m=String(value).match(/(\d{4})[年/.-]\s*(\d{1,2})[月/.-]\s*(\d{1,2})/);if(!m)return false;const at=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));return Math.abs(at-date)<=7*86400000};
 for(let i=0;i<rows.length;i++){if(!normalized.every(t=>normalize(rows[i].join(' | ')).includes(t))||windowed&&!rows[i].some(near))continue;count++;if(matches.length<25)matches.push({row:i+1,values:rows[i]})}
 const result={exportMode,limitation:exportMode==='google_query_csv'?'Google query export may omit values with a different type from their column. Empty cells and no matches do not prove absence in the original sheet. Row positions refer to this export; verify identifiers in the source sheet.':'',firstRows:rows.slice(0,3),matches,matchCount:count,truncated:count>matches.length,windowDays:windowed?7:null,totalRows:rows.length};
 while(JSON.stringify(result).length>8000&&result.matches.length){result.matches.pop();result.truncated=true}
 while(JSON.stringify(result).length>8000&&result.firstRows.length)result.firstRows.pop();
 return JSON.stringify(result);
}
export async function searchBrowserSheet(config,source,terms,purchaseDate,windowed=true) {
 const id=config.spreadsheets?.[source],title=config.spreadsheetTabs?.[source];
 if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id||'')||!title||!config.spreadsheetBrowserProfile)throw Error('Spreadsheet browser connection is not configured');
 const opened=await browserApi('open',{url:'https://docs.google.com/spreadsheets/d/'+id+'/edit',profile:config.spreadsheetBrowserProfile,wait_for_cf:false});
 try{
 if(!String(opened.url).startsWith('https://docs.google.com/spreadsheets/d/'+id+'/'))throw Error('Sign in to the authorized spreadsheet browser');
 const selected=await browserApi('eval',{session_id:opened.session_id,script:'('+selectTab.toString()+')('+JSON.stringify(title)+')'}),tab=JSON.parse(selected.output);
 if(!tab.gid)throw Error('Configured spreadsheet tab is unavailable');
 const result=await browserApi('eval',{session_id:opened.session_id,script:'('+searchCsv.toString()+')('+[id,tab.gid,terms,purchaseDate,windowed,title].map(v=>JSON.stringify(v)).join(',')+')'});
 return {sheet:title,gid:tab.gid,...JSON.parse(result.output)};
 }finally{await browserApi('close',{session_id:opened.session_id}).catch(()=>{})}
}

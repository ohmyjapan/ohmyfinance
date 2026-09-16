import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Vault} from '../collector/vault.mjs';
import {interpretDocument} from '../teaching-worker/document-interpreter.mjs';
import {publicGet,htmlText} from './http.mjs';
import {readBrowserPage} from './browser.mjs';
import {searchBrowserSheet} from './sheets.mjs';
import {matchSheetRows} from './search-evidence.mjs';
import {parseRegistry} from '../shared/finance-research.mjs';
const require=createRequire(new URL('../collector/package.json',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const obj=properties=>({type:'object',properties,additionalProperties:false,required:Object.keys(properties)});
const str={type:'string'};
export const toolDefinitions=[
 {name:'search_spreadsheet',description:'Search an authorized finance, inventory or shipping spreadsheet. ALL terms must match the same row (AND). Use fewer terms for broader discovery. The optional window requires a parseable row date within seven days of purchase. Returns a page of rows, query scope, snapshot hash and pagination. When pagination.nextOffset is not null, use continue_spreadsheet with this source ID to examine omitted matches before concluding that relevant evidence was not found or describing the historical pattern. Zero matches never proves absence; missing prices remain unknown.',inputSchema:obj({source:{type:'string',enum:['finance','inventory','shipping']},terms:{type:'array',items:str,maxItems:5},withinPurchaseWindow:{type:'boolean'}})},
 {name:'continue_spreadsheet',description:'Read the next page of a captured spreadsheet search using its source ID. Keeps the same configured sheet, terms, date window and export snapshot; cannot change the search. Continue with the new source ID while pagination.nextOffset is not null. A final page may still say truncated because earlier pages are separate sources. If the sheet changed, restart search_spreadsheet and do not combine different snapshots. Reading every page covers only that query, not all purchases or cells omitted by Google export.',inputSchema:obj({sourceId:str})},
 {name:'read_browser_page',description:'Read a JavaScript supplier or receipt page in real Chrome. GET-only requests; optional receipt PDF preservation.',inputSchema:obj({url:str,preservePdf:{type:'boolean'}})},
 {name:'read_page',description:'Read a public supplier or company HTTPS page and capture literal text. No government registry scraping.',inputSchema:obj({url:str})},
 {name:'search_mail',description:'Search authorized purchase mail within seven days of this purchase; only merchant/order terms.',inputSchema:obj({terms:str})},
 {name:'read_mail',description:'Read a message returned by search_mail, preserving source evidence and listing attachments.',inputSchema:obj({messageId:str})},
 {name:'read_attachment',description:'Read and preserve a PDF/image attachment listed by read_mail.',inputSchema:obj({messageId:str,attachmentId:str})},
 {name:'read_document',description:'Read an existing document listed in the purchase context.',inputSchema:obj({documentId:str})},
 {name:'verify_invoice',description:'Verify a T-number against the official NTA API for this purchase date. Never infer registration from a company number.',inputSchema:obj({number:str})}
];
export class ResearchTools {
 constructor(config,job,directory,{get=publicGet,extract=interpretDocument,searchSheet=searchBrowserSheet}={}){this.config=config;this.job=job;this.directory=directory;this.sources=[...job.sources];this.get=get;this.extract=extract;this.searchSheet=searchSheet;this.sheetContinuations=new Map();this.messages=new Map();this.attachments=new Map();this.registry=null;this.calls=0}
 async persist(stage){await fs.writeFile(path.join(this.directory,'evidence.json'),JSON.stringify({sources:this.sources,registry:this.registry,stage}));}
 async api(route,body,raw=false){
  const r=await fetch(this.config.baseUrl+'/api/finance-research/worker/'+(this.job.mode==='evaluation'?'evaluation/':'')+this.job.id+'/'+route,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify({...body,lease:this.job.lease}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Research API '+r.status);return raw?Buffer.from(await r.arrayBuffer()):r.json();
 }
 async add(kind,title,text,url='',extra={}){
  text=text.slice(0,80000).trim();
  const existing=this.sources.find(s=>s.kind===kind&&s.url===url&&s.hash===hash(text));if(existing)return existing;
  if(this.sources.length>=30||this.sources.reduce((n,s)=>n+s.text.length,0)+text.length>400000)throw Error('Research evidence budget reached');
  const s={id:'s'+this.sources.length,kind,title:title.slice(0,300),text,url,hash:hash(text),capturedAt:new Date().toISOString(),...extra};this.sources.push(s);await this.persist(kind);return s;
 }
 async mailbox(){
  if(this.gmail)return this.gmail;
  if(!this.config.mailbox)throw Error('Purchase mailbox is not configured');
  const vault=await new Vault(this.config.collectorDirectory||path.join(process.env.LOCALAPPDATA,'OhMyFinance','collector')).read(),g=vault.gmail;
  if(!g||g.mailbox.toLowerCase()!==this.config.mailbox.toLowerCase())throw Error('Purchase mailbox identity mismatch');
  const {google}=require('googleapis'),auth=new google.auth.OAuth2(g.clientId,g.clientSecret);auth.setCredentials({refresh_token:g.refreshToken});
  const gmail=google.gmail({version:'v1',auth}),profile=await gmail.users.getProfile({userId:'me'});
  if(profile.data.emailAddress.toLowerCase()!==g.mailbox.toLowerCase())throw Error('Purchase mailbox identity mismatch');this.gmail=gmail;this.googleAuth=auth;return gmail;
 }
 async document(bytes,mimeType,title,url='',extra={}){
  if(bytes.length>10*1024*1024)throw Error('Document too large');
  const result=await this.extract(this.config,{mimeType},bytes);
  const text=result.pages.map(p=>'Page '+p.page+'\n'+p.text).join('\n')+'\nExtracted order candidates (not confirmed associations):\n'+JSON.stringify(result.records);
  const source=await this.add('document',title,text,url,extra);
  if(!extra.documentId&&this.job.mode!=='evaluation'){
   const endpoint=this.config.baseUrl+'/api/finance-research/worker/'+this.job.id+'/artifact';
   const query=new URLSearchParams({lease:this.job.lease,sourceId:source.id,name:title.replace(/[/\\\x00-\x1f]/g,'_').slice(0,180),mimeType});
   const response=await fetch(endpoint+'?'+query,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':mimeType},body:bytes,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('Original document storage failed');
  }
  return source;
 }
 async spreadsheetPage(source,terms,windowed,{offset=0,expectedSnapshot=''}={},continuedFrom=''){
  const spreadsheetId=this.config.spreadsheets?.[source],date=this.job.context.source.purchaseDate;let result;
  if(this.config.spreadsheetBrowserProfile)result=await this.searchSheet(this.config,source,terms,date,windowed,{offset,expectedSnapshot});
  else{
   await this.mailbox();const {google}=require('googleapis'),sheets=google.sheets({version:'v4',auth:this.googleAuth});this.sheetsCache ||= new Map();
   const title=this.config.spreadsheetTabs?.[source];if(!title)throw Error('Configured spreadsheet tab is unavailable');
   const cacheKey=JSON.stringify([spreadsheetId,title]);let sheet=this.sheetsCache.get(cacheKey);
   if(!sheet){try{const meta=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties'}),selected=meta.data.sheets.find(s=>s.properties.title===title);if(!selected)throw Error('Missing tab');const range="'"+title.replaceAll("'","''")+"'!A1:AZ50000",response=await sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'FORMATTED_VALUE'});const rows=response.data.values||[];sheet={title,gid:selected.properties.sheetId,rows,snapshotHash:hash(JSON.stringify(rows))};this.sheetsCache.set(cacheKey,sheet)}catch{throw Error('Configured spreadsheet tab is not accessible on this connection')}}
   result={sheet:sheet.title,gid:sheet.gid,snapshotHash:sheet.snapshotHash,...matchSheetRows(sheet.rows,{terms,purchaseDate:date,windowed,exportMode:'sheets_api',range:'A1:AZ50000',offset})};
  }
  if(!/^[a-f0-9]{64}$/.test(result.snapshotHash)||result.pagination?.offset!==offset)throw Error('Invalid spreadsheet page');
  if(expectedSnapshot&&result.snapshotHash!==expectedSnapshot)throw Error('Spreadsheet changed between pages; restart the search instead of combining different snapshots');
  if(result.pagination.nextOffset!==null&&(!Number.isSafeInteger(result.pagination.nextOffset)||result.pagination.nextOffset!==offset+result.matches.length||result.pagination.nextOffset<=offset))throw Error('Invalid spreadsheet continuation');
  const captured=await this.add('spreadsheet',source+' / '+result.sheet,JSON.stringify({...result,...(continuedFrom?{continuedFrom}:{})}),'https://docs.google.com/spreadsheets/d/'+spreadsheetId+'/edit#gid='+result.gid);
  if(result.pagination.nextOffset!==null){
   this.sheetContinuations.set(captured.id,{source,terms:[...terms],windowed,page:{offset:result.pagination.nextOffset,expectedSnapshot:result.snapshotHash},next:null});
  }
  return captured;
 }
 async call(name,args){
  if(++this.calls>35)throw Error('Research tool budget reached');
  if(!toolDefinitions.some(t=>t.name===name))throw Error('Unknown research tool');
  if(name==='search_spreadsheet'){
   const spreadsheetId=this.config.spreadsheets?.[args.source];if(!spreadsheetId)throw Error('Spreadsheet connection is not configured');
   if(!Array.isArray(args.terms)||!args.terms.length||args.terms.length>5||args.terms.some(t=>typeof t!=='string'||!t.trim()||t.length>100))throw Error('Use one to five specific spreadsheet terms');
   return this.spreadsheetPage(args.source,[...args.terms],args.withinPurchaseWindow!==false);
  }
  if(name==='continue_spreadsheet'){
   const entry=this.sheetContinuations.get(args.sourceId);if(!entry)throw Error('No spreadsheet continuation is available for this captured source');
   if(!entry.next)entry.next=this.spreadsheetPage(entry.source,entry.terms,entry.windowed,entry.page,args.sourceId).catch(error=>{entry.next=null;throw error});
   return entry.next;
  }
  if(name==='read_browser_page'){
   const page=await readBrowserPage(path.join(this.config.researchDirectory||path.dirname(path.dirname(this.directory)),'browser'),args.url,{print:args.preservePdf===true});
   const source=await this.add('web',page.title||'仕入れ先のページ',page.text,page.url);
   if(page.pdf){const document=await this.document(page.pdf,'application/pdf','仕入れ先の領収書ページ（印刷）.pdf',page.url);return {source,document,capture:'Printed original vendor page without editing its contents'}}return source;
  }
  if(name==='read_page'){
   const data=await this.get(args.url,{maxBytes:10*1024*1024});
   if(data.mimeType==='application/pdf')return this.document(data.bytes,data.mimeType,'仕入れ先のPDF',data.url);
   if(!['text/html','text/plain','application/json','application/xhtml+xml'].includes(data.mimeType))throw Error('Unsupported public page');
   const html=data.bytes.toString('utf8'),title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(data.url).hostname;
   return this.add('web',htmlText(title),htmlText(html),data.url);
  }
  if(name==='search_mail'){
   if(typeof args.terms!=='string'||args.terms.length>150||/[:{}()"\\\r\n]/.test(args.terms)||!args.terms.trim())throw Error('Use plain merchant or order search terms');
   const gmail=await this.mailbox(),day=Date.parse(this.job.context.source.purchaseDate),after=Math.floor((day-7*86400000)/1000),before=Math.floor((day+8*86400000)/1000);
   const data=await gmail.users.messages.list({userId:'me',q:args.terms+' after:'+after+' before:'+before+' -in:trash -in:spam',maxResults:20});
   const results=[];
   for(const item of data.data.messages||[]){
    const {data:m}=await gmail.users.messages.get({userId:'me',id:item.id,format:'metadata',metadataHeaders:['From','Subject','Date']});
    const headers=Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
    if(/認証|ワンタイム|パスワード|verification|one.time|password|security code|\botp\b/i.test(headers.subject||''))continue;
    const received=Number(m.internalDate);if(received<after*1000||received>=before*1000)continue;
    this.messages.set(m.id,true);results.push({messageId:m.id,...headers});
   }
   const coverage={version:1,terms:args.terms,dateWindow:{after:new Date(after*1000).toISOString(),beforeExclusive:new Date(before*1000).toISOString()},returnedCount:results.length,candidateCount:(data.data.messages||[]).length,hasMore:!!data.data.nextPageToken,absenceProven:false,limitations:['Only these merchant/order terms and the purchase-date window were searched.','Trash, spam and authentication subjects are excluded. Message metadata is not a receipt or proof of purchase.',...(data.data.nextPageToken?['Further result pages were not fetched.']:[])]};
   const source=await this.add('search','購入メール検索',JSON.stringify({searchType:'mail',coverage,messages:results}));
   return {messages:results,limit:20,windowDays:7,coverage,source};
  }
  if(name==='read_mail'){
   if(!this.messages.has(args.messageId))throw Error('Search the purchase mailbox first');
   const gmail=await this.mailbox(),{data:m}=await gmail.users.messages.get({userId:'me',id:args.messageId,format:'full'});
   const headers=Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
   if(/認証|ワンタイム|パスワード|verification|password|security code|\botp\b/i.test(headers.subject||''))throw Error('Authentication mail excluded');
   const plain=[],html=[],attachments=[];
   const visit=p=>{if(p.body?.data){if(p.mimeType==='text/plain')plain.push(Buffer.from(p.body.data,'base64url').toString('utf8'));if(p.mimeType==='text/html')html.push(Buffer.from(p.body.data,'base64url').toString('utf8'))}if(p.body?.attachmentId&&['application/pdf','image/png','image/jpeg','image/webp'].includes(p.mimeType)&&p.body.size<=10485760){const a={messageId:m.id,attachmentId:p.body.attachmentId,name:p.filename||'購入書類',mimeType:p.mimeType};attachments.push(a);this.attachments.set(m.id+':'+a.attachmentId,a)}for(const child of p.parts||[])visit(child)};visit(m.payload||{});
   const text=['From: '+headers.from,'Subject: '+headers.subject,'Date: '+headers.date,plain.length?plain.join('\n'):htmlText(html.join('\n'))].join('\n');
   const source=await this.add('mail',headers.subject||'購入メール',text,'https://mail.google.com/mail/u/0/#all/'+m.id);
   return {source,attachments};
  }
  if(name==='read_attachment'){
   const a=this.attachments.get(args.messageId+':'+args.attachmentId);if(!a)throw Error('Read the source message first');
   const gmail=await this.mailbox(),{data}=await gmail.users.messages.attachments.get({userId:'me',messageId:a.messageId,id:a.attachmentId});
   return this.document(Buffer.from(data.data,'base64url'),a.mimeType,a.name,'https://mail.google.com/mail/u/0/#all/'+a.messageId);
  }
  if(name==='read_document'){
   const d=this.job.context.documents.find(d=>d.id===args.documentId);if(!d)throw Error('Document is not attached to this purchase');
   return this.document(await this.api('document',{documentId:d.id},true),d.mimeType,d.name,'',{documentId:d.id});
  }
  if(name==='verify_invoice'){
   if(!/^T[0-9]{13}$/.test(args.number))throw Error('A literal T-number is required');
   if(!this.config.ntaApplicationId)return {status:'connection_required',reason:'国税庁APIの接続設定が必要です。検索結果だけでは公的確認済みになりません。'};
   const date=this.job.context.source.purchaseDate,query=new URLSearchParams({id:this.config.ntaApplicationId,number:args.number,day:date,type:'21'});
   const response=await this.get('https://web-api.invoice-kohyo.nta.go.jp/1/valid?'+query,{registry:true});
   const parsed=parseRegistry(JSON.parse(response.bytes.toString('utf8')),args.number,date);
   const source=await this.add('registry','国税庁 登録番号・基準日照合',response.bytes.toString('utf8'),'https://web-api.invoice-kohyo.nta.go.jp/1/valid');
   this.registry={number:args.number,date,sourceId:source.id};await this.persist('registry');return {...parsed,sourceId:source.id};
  }
 }
}

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
import {parseRegistry} from '../shared/finance-research.mjs';
const require=createRequire(new URL('../collector/package.json',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const obj=properties=>({type:'object',properties,additionalProperties:false,required:Object.keys(properties)});
const str={type:'string'};
export const toolDefinitions=[
 {name:'search_spreadsheet',description:'Search an authorized finance or inventory spreadsheet. Returns literal rows and row numbers; missing prices remain unknown.',inputSchema:obj({source:{type:'string',enum:['finance','inventory','shipping']},terms:{type:'array',items:str,maxItems:5},withinPurchaseWindow:{type:'boolean'}})},
 {name:'read_browser_page',description:'Read a JavaScript supplier or receipt page in real Chrome. GET-only requests; optional receipt PDF preservation.',inputSchema:obj({url:str,preservePdf:{type:'boolean'}})},
 {name:'read_page',description:'Read a public supplier or company HTTPS page and capture literal text. No government registry scraping.',inputSchema:obj({url:str})},
 {name:'search_mail',description:'Search authorized purchase mail within seven days of this purchase; only merchant/order terms.',inputSchema:obj({terms:str})},
 {name:'read_mail',description:'Read a message returned by search_mail, preserving source evidence and listing attachments.',inputSchema:obj({messageId:str})},
 {name:'read_attachment',description:'Read and preserve a PDF/image attachment listed by read_mail.',inputSchema:obj({messageId:str,attachmentId:str})},
 {name:'read_document',description:'Read an existing document listed in the purchase context.',inputSchema:obj({documentId:str})},
 {name:'verify_invoice',description:'Verify a T-number against the official NTA API for this purchase date. Never infer registration from a company number.',inputSchema:obj({number:str})}
];
export class ResearchTools {
 constructor(config,job,directory,{get=publicGet,extract=interpretDocument}={}){this.config=config;this.job=job;this.directory=directory;this.sources=[...job.sources];this.get=get;this.extract=extract;this.messages=new Map();this.attachments=new Map();this.registry=null;this.calls=0}
 async persist(stage){await fs.writeFile(path.join(this.directory,'evidence.json'),JSON.stringify({sources:this.sources,registry:this.registry,stage}));}
 async api(route,body,raw=false){
  const r=await fetch(this.config.baseUrl+'/api/finance-research/worker/'+this.job.id+'/'+route,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify({...body,lease:this.job.lease}),redirect:'error',signal:AbortSignal.timeout(30000)});
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
  if(!extra.documentId){
   const endpoint=this.config.baseUrl+'/api/finance-research/worker/'+this.job.id+'/artifact';
   const query=new URLSearchParams({lease:this.job.lease,sourceId:source.id,name:title.replace(/[/\\\x00-\x1f]/g,'_').slice(0,180),mimeType});
   const response=await fetch(endpoint+'?'+query,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':mimeType},body:bytes,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('Original document storage failed');
  }
  return source;
 }
 async call(name,args){
  if(++this.calls>35)throw Error('Research tool budget reached');
  if(!toolDefinitions.some(t=>t.name===name))throw Error('Unknown research tool');
  if(name==='search_spreadsheet'){
   const spreadsheetId=this.config.spreadsheets?.[args.source];if(!spreadsheetId)throw Error('Spreadsheet connection is not configured');
   if(!Array.isArray(args.terms)||!args.terms.length||args.terms.length>5||args.terms.some(t=>typeof t!=='string'||!t.trim()||t.length>100))throw Error('Use one to five specific spreadsheet terms');
   if(this.config.spreadsheetBrowserProfile){const result=await searchBrowserSheet(this.config,args.source,args.terms,this.job.context.source.purchaseDate,args.withinPurchaseWindow!==false);return this.add('spreadsheet',args.source+' / '+result.sheet,JSON.stringify(result),'https://docs.google.com/spreadsheets/d/'+spreadsheetId+'/edit#gid='+result.gid);}
   await this.mailbox();const {google}=require('googleapis'),sheets=google.sheets({version:'v4',auth:this.googleAuth});this.sheetsCache ||= new Map();
   let sheet=this.sheetsCache.get(spreadsheetId);
   if(!sheet){try{const meta=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties'});const title=meta.data.sheets[0].properties.title,range="'"+title.replaceAll("'","''")+"'!A1:AZ50000";const response=await sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'FORMATTED_VALUE'});sheet={title,rows:response.data.values||[]};this.sheetsCache.set(spreadsheetId,sheet)}catch{throw Error('Spreadsheet access is not authorized on this connection')}}
   const norm=v=>String(v).normalize('NFKC').toLowerCase().replace(/[ ,\t]/g,''),terms=args.terms.map(norm),matches=[];
   for(let i=0;i<sheet.rows.length;i++){const text=norm(sheet.rows[i].join(' | '));if(terms.every(t=>text.includes(t)))matches.push({row:i+1,values:sheet.rows[i]})}
   return this.add('spreadsheet',args.source+' / '+sheet.title,JSON.stringify({sheet:sheet.title,firstRows:sheet.rows.slice(0,3),matches:matches.slice(0,25),matchCount:matches.length,truncated:matches.length>25||sheet.rows.length===50000}),'https://docs.google.com/spreadsheets/d/'+spreadsheetId+'/edit');
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
   await this.persist('mail');return {messages:results,limit:20,windowDays:7};
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

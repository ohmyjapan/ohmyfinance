import { fields, validateValues } from './finance-draft.mjs';

export const researchFields = fields.filter(f => !['date','status','sourceId','referenceNumber','notes','tags','items'].includes(f.key));
const citationSchema={type:'array',items:{type:'object',additionalProperties:false,required:['sourceId','quote'],properties:{sourceId:{type:'string'},quote:{type:'string'}}}};
export const reportSchema={
 type:'object',additionalProperties:false,required:['summary','question','findings','supplier'],
 properties:{
  summary:{type:'string',maxLength:600},question:{type:'string',maxLength:300},
  findings:{type:'array',items:{type:'object',additionalProperties:false,required:['field','valueJson','reason','basis','citations'],properties:{
   field:{type:'string',enum:researchFields.map(f=>f.key)},valueJson:{type:'string'},reason:{type:'string'},basis:{type:'string',enum:['literal','reasoned']},citations:citationSchema
  }}},
  supplier:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['shopName','legalName','invoiceNumber','citations'],properties:{
   shopName:{type:'string'},legalName:{type:'string'},invoiceNumber:{type:'string'},citations:citationSchema
  }}]}
 }
};
const string=(v,max=2000)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('Invalid research text');return v.trim()};
export function validateSources(input) {
 if(!Array.isArray(input)||input.length>30)throw Error('Too many research sources');
 const seen=new Set();
 return input.map(s=>{
  if(!s||!/^s[0-9]{1,3}$/.test(s.id)||seen.has(s.id)||!['context','web','mail','document','registry','spreadsheet'].includes(s.kind))throw Error('Invalid research source');
  seen.add(s.id);
  const text=string(s.text,80000),title=string(s.title,300),url=string(s.url||'',2000);
  if(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid source URL')}
  if(!text||!title||!/^[a-f0-9]{64}$/.test(s.hash||'')||!Number.isFinite(Date.parse(s.capturedAt)))throw Error('Missing source evidence');
  return {id:s.id,kind:s.kind,text,title,url,hash:s.hash,capturedAt:s.capturedAt,...(s.documentId?{documentId:string(s.documentId,24)}:{})};
 });
}
export function validateReport(raw,context,sources) {
 if(!raw||typeof raw!=='object'||Object.keys(raw).some(k=>!['summary','question','findings','supplier'].includes(k)))throw Error('Invalid research report');
 const summary=string(raw.summary,600),question=string(raw.question,300);
 function citations(input){
  if(!Array.isArray(input)||!input.length||input.length>8)throw Error('Citations required');
  return input.map(c=>{const source=sources.find(s=>s.id===c.sourceId),quote=string(c.quote,4000);if(!source||!quote||!source.text.includes(quote))throw Error('Citation is not in captured evidence');return {sourceId:source.id,quote}});
 }
 if(!Array.isArray(raw.findings)||raw.findings.length>researchFields.length)throw Error('Invalid findings');
 const found=new Set(),findings=raw.findings.map(f=>{
  const field=researchFields.find(x=>x.key===f.field);
  if(!field||found.has(f.field)||!['literal','reasoned'].includes(f.basis))throw Error('Invalid research field');found.add(f.field);
  const value=JSON.parse(string(f.valueJson,6000)),proof=citations(f.citations),reason=string(f.reason,1200);
  const validated=validateValues({...context.values,[f.field]:value});
  if(JSON.stringify(validated[f.field])!==JSON.stringify(value))throw Error('Invalid field value');
  if(field.ref&&value&&!context.references[field.ref]?.some(r=>String(r._id)===value))throw Error('Unregistered reference');
  if(f.basis==='literal'&&['productName','companyInfo','receiptNumber','trackingNumber','janCode'].includes(f.field)&&typeof value==='string'&&value&&!proof.some(c=>c.quote.includes(value)))throw Error('Literal field must appear in its quote');
  if(f.field==='invoiceNumber'&&(!/^T[0-9]{13}$/.test(value)||!proof.some(c=>c.quote.includes(value))))throw Error('Invoice number needs literal evidence');
  if(f.field==='taxRate'&&!proof.some(c=>['mail','document'].includes(sources.find(s=>s.id===c.sourceId).kind)&&new RegExp('(?:^|[^0-9.])'+String(value).replace('.','\\.')+'\\s*[%％]').test(c.quote)))throw Error('Tax rate needs a printed purchase percentage');
  return {field:f.field,value,valueJson:f.valueJson,basis:f.basis,reason,citations:proof};
 });
 let supplier=null;
 if(raw.supplier){
  const p=raw.supplier,proof=citations(p.citations),shopName=string(p.shopName,200),legalName=string(p.legalName,200),invoiceNumber=string(p.invoiceNumber,14);
  if(!shopName||!legalName||!proof.some(c=>c.quote.includes(legalName))||(invoiceNumber&&(!/^T[0-9]{13}$/.test(invoiceNumber)||!proof.some(c=>c.quote.includes(invoiceNumber)))))throw Error('Supplier identity needs literal evidence');
  supplier={shopName,legalName,invoiceNumber,citations:proof};
 }
 return {summary,question,findings,supplier};
}
export function parseRegistry(raw,number,date) {
 if(!/^T[0-9]{13}$/.test(number)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid registry request');
 const rows=raw?.announcement;
 if(!Array.isArray(rows)||String(raw.count)!==String(rows.length)||rows.length!==1)throw Error('Registry response does not identify one issuer');
 const row=rows[0];
 if(row.registratedNumber!==number||!row.name||!row.registrationDate)throw Error('Registry identity mismatch');
 const dates=[row.registrationDate,row.disposalDate,row.expireDate].filter(Boolean);
 if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d).toISOString().slice(0,10)!==d))throw Error('Invalid registry dates');
 const active=row.registrationDate<=date&&(!row.disposalDate||date<row.disposalDate)&&(!row.expireDate||date<row.expireDate);
 return {number,legalName:row.name,registeredAddress:row.address||row.addressRequest||'',registeredFrom:row.registrationDate,asOf:date,active,disposalDate:row.disposalDate||'',expireDate:row.expireDate||''};
}

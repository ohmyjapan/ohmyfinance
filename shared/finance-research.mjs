import { fields, validateValues, purposeChoices } from './finance-draft.mjs';

export const researchFields = fields.filter(f => !['date','status','sourceId','referenceNumber','notes','tags','items'].includes(f.key));
const citationSchema={type:'array',items:{type:'object',additionalProperties:false,required:['sourceId','quote'],properties:{sourceId:{type:'string'},quote:{type:'string'}}}};
export const purposeContract='For purpose, use exactly one of these values: '+purposeChoices.map(c=>c.value+' ('+c.label+'): '+c.meaning).join(' ')+' Put explanations in reason, never in valueJson. customerId must be an existing registered customer _id and may be nonempty only with purpose customer. Propose purpose and customerId together when both need to change. If customer use is supported but the customer identity is unknown, leave customerId empty and ask only for the missing identity. Do not invent an ID or clear an existing customer without evidence.';
const findingSchema=(keys,valueSchema)=>({type:'object',additionalProperties:false,required:['field','valueJson','reason','basis','citations'],properties:{field:{type:'string',enum:keys},valueJson:valueSchema,reason:{type:'string'},basis:{type:'string',enum:['literal','reasoned']},citations:citationSchema}});
export const reportSchema={
 type:'object',additionalProperties:false,required:['summary','question','findings','supplier'],
 properties:{
  summary:{type:'string',maxLength:600},question:{type:'string',maxLength:300},
  findings:{type:'array',items:{anyOf:[findingSchema(['purpose'],{type:'string',enum:purposeChoices.map(c=>JSON.stringify(c.value)),description:purposeContract}),findingSchema(researchFields.filter(f=>f.key!=='purpose').map(f=>f.key),{type:'string'})]}},
  supplier:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['shopName','legalName','invoiceNumber','citations'],properties:{
   shopName:{type:'string'},legalName:{type:'string'},invoiceNumber:{type:'string'},citations:citationSchema
  }}]}
 }
};
const purposeError=(code,message)=>Object.assign(Error(message),{code});
export function validationFeedback(error){
 const code=['purpose_invalid','purpose_customer_conflict'].includes(error?.code)?error.code:'output_invalid';
 return {code,message:code==='purpose_invalid'?'purpose must be one of the exact accepted values.':code==='purpose_customer_conflict'?'A nonempty customerId requires purpose customer in the combined proposal.':String(error?.message||'Invalid report').slice(0,300),fields:code==='purpose_invalid'?['purpose']:code==='purpose_customer_conflict'?['purpose','customerId']:[],purposeChoices,instruction:purposeContract};
}
const diagnosticMessages={purpose_invalid:'用途の選択肢が正しくないため、結果を保存できませんでした。',purpose_customer_conflict:'用途と顧客の組み合わせを確認できなかったため、結果を保存できませんでした。',output_invalid:'提案の項目または引用を検証できませんでした。',evidence_invalid:'取得した資料を検証できませんでした。',interpreter_failed:'AIの調査を完了できませんでした。',timed_out:'調査が制限時間内に完了しませんでした。',delivery_failed:'調査結果の送信または受理を完了できませんでした。'};
export function validateDiagnostic(input){
 if(!input||Object.keys(input).some(k=>!['code','correctionAttempted'].includes(k))||!Object.hasOwn(diagnosticMessages,input.code)||typeof input.correctionAttempted!=='boolean')throw Error('Invalid research diagnostic');
 return {code:input.code,correctionAttempted:input.correctionAttempted};
}
export function diagnosticMessage(input){return Object.hasOwn(diagnosticMessages,input?.code)?diagnosticMessages[input.code]:'この評価は完了できませんでした。'}
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
 const found=new Set(),parsed=raw.findings.map(f=>{
  if(!f||!researchFields.some(x=>x.key===f.field)||found.has(f.field)||!['literal','reasoned'].includes(f.basis))throw Error('Invalid research field');found.add(f.field);
  const value=JSON.parse(string(f.valueJson,6000));
  if(f.field==='purpose'&&!purposeChoices.some(c=>c.value===value))throw purposeError('purpose_invalid','Invalid purpose choice');
  return {...f,value};
 });
 // Purpose and customer are one decision; validating against old values rejects a valid pair.
 const combined={...context.values,...Object.fromEntries(parsed.map(f=>[f.field,f.value]))};
 if(combined.purpose!=='customer'&&combined.customerId)throw purposeError('purpose_customer_conflict','Customer requires customer purpose');
 const validated=validateValues(combined),findings=parsed.map(f=>{
  const field=researchFields.find(x=>x.key===f.field),value=f.value,proof=citations(f.citations),reason=string(f.reason,1200);
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

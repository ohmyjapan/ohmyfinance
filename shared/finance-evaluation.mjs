import {emptyValues,validateValues,isEmpty} from './finance-draft.mjs';
import {researchFields} from './finance-research.mjs';
export const evaluationVersion=1;
const text=(v,max)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('Invalid evaluation text');return v.trim()};
const normalize=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/g,' ').trim():v;
export function validateEvaluationCase(body,draft){
 const title=text(body.title,120),instruction=text(body.instruction||'',1500);
 if(!title||body.confirm!==true||!['ungraded','required','unnecessary'].includes(body.questionPolicy))throw Error('Confirm the evaluation reference');
 if(!Array.isArray(body.expectations)||!body.expectations.length||body.expectations.length>20||!Array.isArray(body.knownFields)||body.knownFields.length>20)throw Error('Choose evaluation fields');
 const seen=new Set(),expectations=body.expectations.map(e=>{
  const field=researchFields.find(f=>f.key===e.field);
  if(!field||seen.has(e.field)||!['value','abstain'].includes(e.mode)||!['past_decision','document','owner_confirmed'].includes(e.basis))throw Error('Invalid reference field');seen.add(e.field);
  const note=text(e.note||'',700),documentId=e.documentId||'';
  if(!note)throw Error('Explain the reference evidence');
  if(documentId&&!draft.documents.some(d=>d.id===documentId))throw Error('Reference document is not attached');
  if(e.basis==='document'&&!documentId)throw Error('Choose the reference document');
  const values=e.mode==='value'?[e.value,...(e.alternatives||[])]:[];
  if(!Array.isArray(e.alternatives||[])||values.length>5||e.mode==='value'&&values.some(v=>isEmpty(v)||v==='unresolved'))throw Error('Reference answer cannot be empty');
  for(const value of values){const checked=validateValues({...draft.values,[e.field]:value});if(JSON.stringify(checked[e.field])!==JSON.stringify(value))throw Error('Invalid reference answer');if(field.ref&&value&&!draft.references[field.ref]?.some(r=>String(r._id)===value))throw Error('Reference choice is unavailable')}
  if(e.basis==='past_decision'&&(e.mode!=='value'||draft.evidence[e.field]?.state!=='confirmed'||draft.evidence[e.field]?.source!=='user'&&draft.evidence[e.field]?.source!=='chat'&&draft.evidence[e.field]?.source!=='slack'||JSON.stringify(e.value)!==JSON.stringify(draft.values[e.field])))throw Error('Past decision must match an explicitly confirmed draft field');
  return {field:e.field,mode:e.mode,value:e.mode==='value'?e.value:null,alternatives:values.slice(1),basis:e.basis,note,documentId};
 });
 const knownFields=[...new Set(body.knownFields)];
 if(knownFields.some(k=>!researchFields.some(f=>f.key===k)||seen.has(k)))throw Error('Scored answers cannot also be provided inputs');
 const requiredSources=body.requiredSources||[];
 if(!Array.isArray(requiredSources)||requiredSources.length>5||requiredSources.some(s=>!['web','mail','document','registry','spreadsheet'].includes(s)))throw Error('Invalid source requirement');
 return {title,instruction,expectations,knownFields,requiredSources:[...new Set(requiredSources)],questionPolicy:body.questionPolicy};
}
// This allowlist deliberately excludes mapped purpose, sheet labels, notes, reasons,
// supplier matches, history, and the expected answers from the source purchase.
export function evaluationContext(draft,definition){
 const source=Object.fromEntries(['purchaseDate','processingDate','description','amount','cardLast4','statementMonth','kind','paymentAmount','paymentMethod','currency','foreignAmount','exchangeRate'].filter(k=>draft.source[k]!==undefined).map(k=>[k,draft.source[k]]));
 source.account={id:draft.source.account.id,name:draft.source.account.name};
 const values=emptyValues(source);for(const key of definition.knownFields)values[key]=draft.values[key];
 const references=Object.fromEntries(Object.entries(draft.references).map(([key,rows])=>[key,rows.map(r=>({_id:String(r._id),name:r.name,parentId:r.parentId?String(r.parentId):null}))]));
 return {source,values,references,documents:draft.documents.map(d=>({id:d.id,hash:d.hash,mimeType:d.mimeType,name:d.name})),evaluationTargets:definition.expectations.map(e=>e.field)};
}
export function scoreEvaluation(definition,report,sources){
 const fields=definition.expectations.map(e=>{
  const finding=report.findings.find(f=>f.field===e.field),value=finding?.value,answered=!!finding&&!isEmpty(value)&&value!=='unresolved';
  const matches=e.mode==='abstain'?!answered:answered&&[e.value,...e.alternatives].some(v=>JSON.stringify(normalize(v))===JSON.stringify(normalize(value)));
  return {field:e.field,mode:e.mode,basis:e.basis,expected:e.mode==='value'?[e.value,...e.alternatives]:[],actual:answered?value:null,status:matches?'match':e.mode==='abstain'?'unexpected_answer':answered?'different':'missing'};
 });
 const sourceChecks=definition.requiredSources.map(kind=>({kind,present:sources.some(s=>s.kind===kind)}));
 const documentChecks=[...new Set(definition.expectations.filter(e=>e.basis==='document').map(e=>e.documentId))].map(documentId=>({documentId,present:sources.some(s=>s.kind==='document'&&s.documentId===documentId)}));
 const asked=!!report.question.trim(),question={policy:definition.questionPolicy,asked,status:definition.questionPolicy==='ungraded'?'ungraded':(definition.questionPolicy==='required')===asked?'match':asked?'unnecessary':'missing'};
 return {version:evaluationVersion,fields,sourceChecks,documentChecks,question,unscoredFields:report.findings.filter(f=>!definition.expectations.some(e=>e.field===f.field)).map(f=>f.field)};
}
export function evaluationSummary(runs){
 const out={total:runs.length,complete:0,failed:0,pending:0,matched:0,different:0,missing:0,unexpected:0,sourceMissing:0,questionsUnnecessary:0,questionsMissing:0,questionsGraded:0,byBasis:{past_decision:{matched:0,total:0},document:{matched:0,total:0},owner_confirmed:{matched:0,total:0}}};
 for(const r of runs){if(r.state!=='complete'){out[r.state==='failed'?'failed':'pending']++;continue}out.complete++;for(const f of r.score.fields){out.byBasis[f.basis].total++;if(f.status==='match'){out.matched++;out.byBasis[f.basis].matched++}else if(f.status==='different')out.different++;else if(f.status==='missing')out.missing++;else out.unexpected++}out.sourceMissing+=[...r.score.sourceChecks,...r.score.documentChecks].filter(s=>!s.present).length;if(r.score.question.status!=='ungraded')out.questionsGraded++;if(r.score.question.status==='unnecessary')out.questionsUnnecessary++;if(r.score.question.status==='missing')out.questionsMissing++}
 return out;
}

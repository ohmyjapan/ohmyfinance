import {researchFields} from '../shared/finance-research.mjs';
import {isEmpty} from '../shared/finance-draft.mjs';

export const questionContract='Before asking a purchase question, use questionGuidance to distinguish settled input from missing facts. In both summary and question, describe a field as already confirmed only when it appears in settled or is explicitly resolved by the saved accounting explanation. A populated context.values field outside settled can still be an unconfirmed mapping suggestion; do not describe all saved values collectively as confirmed. Even a confirmed invoice-number entry is not verified issuer registration, and a confirmed tax-rate entry is not independent tax validation. Newly discovered purchase facts need their captured evidence and are not prior owner confirmations. Do not ask the owner to reconfirm a settled purpose, customer, item or other supplied field unless captured evidence specifically contradicts it; identify that contradiction when asking. Applicable approved teaching is scoped to this account, merchant and purchase date; raw historical frequency, prior purchases and unaccepted AI proposals are not settled answers for this purchase. A known customer/purpose does not identify the exact item or prove tax, invoice registration or contract terms. A saved account choice alone does not prove a subscription; a current saved accounting explanation can answer the contract or policy fact it explicitly states. For a question mixing settled and missing facts, ask only the missing part. Keep necessary questions about unsupported purchase details, conflicting records or unresolved contract facts. If everything needed for the requested investigation is answered, leave question empty. Do not ask for optional detail unrelated to the requested fields merely because it is absent. All values remain proposals subject to the existing confirmation flow.';

// Use only the current supplied snapshot. Old lessons/history and hidden evaluation
// answers cannot make a field settled. The server already withdraws stale teachings.
export function questionGuidance(context){
 const values=context.values||{},evaluation=Array.isArray(context.evaluationTargets),mapping=evaluation?null:context.mapping,rows=mapping?.fields||[];
 const rules=evaluation?[]:context.study?.learning?.rules||[];
 const approvedTeaching=rules.length>0&&rules.every(r=>r.decision?.purpose===values.purpose&&(r.decision.customerId||'')===(values.customerId||'')&&(!r.decision.effectiveFrom||r.decision.effectiveFrom<=context.source?.purchaseDate));
 const conflicts=new Set(rows.filter(r=>r.evidence?.state==='conflict').map(r=>r.key));
 if(conflicts.has('purpose')||conflicts.has('customerId')){conflicts.add('purpose');conflicts.add('customerId')}
 const settled=[];
 for(const field of researchFields){
  const value=values[field.key],row=rows.find(r=>r.key===field.key);
  if(isEmpty(value)||value==='unresolved'||conflicts.has(field.key))continue;
  if(field.key==='customerId'&&values.purpose!=='customer')continue;
  if(field.ref&&!(context.references?.[field.ref]||[]).some(r=>String(r._id||r.id)===value))continue;
  let basis='';
  if(evaluation){if(context.evaluationTargets.includes(field.key))continue;basis='provided_input'}
  else if(row&&JSON.stringify(row.value)===JSON.stringify(value)){
   if(row.evidence?.state==='confirmed')basis='confirmed_current_value';
   else if(approvedTeaching&&['purpose','customerId'].includes(field.key)&&row.evidence?.state==='suggested'&&row.evidence.source==='learning_rule'&&row.evidence.grade==='A')basis='applicable_approved_teaching';
  }
  if(basis)settled.push({field:field.key,value,displayValue:row?.displayValue??value,basis,reason:evaluation?'Explicitly supplied evaluation input; not a hidden reference answer.':row.evidence.reason||''});
 }
 const response=!evaluation&&!conflicts.size?mapping?.purchaseAccountingReview?.response:null;
 return {version:1,settled,unsettledFields:researchFields.filter(f=>!settled.some(s=>s.field===f.key)).map(f=>f.key),conflicts:[...conflicts],savedAccountingExplanation:typeof response?.note==='string'?response.note:'',limitation:'These are supplied decisions and scoped teachings, not independent purchase, invoice or tax verification. Unconfirmed suggestions and historical patterns remain uncertain.'};
}

export function hasSettledQuestion(report,guidance){return !!report.question?.trim()&&!!(guidance?.settled?.length||guidance?.savedAccountingExplanation)}

import {validateAssistantReply} from './finance-assistant.mjs';
import { validateReplyProposal } from './finance-review.mjs';
export function validateChatProposal(input, context, text) {
 if(context.mode==='workspace')return validateAssistantReply(input);
 const result=validateReplyProposal(input,context.customers,text);
 if(result.patch.customerId && !result.patch.purpose) { result.patch.purpose='customer'; result.quotes.purpose=result.quotes.customerId; }
 const values={...context.values,...result.patch};
 if(values.purpose==='customer' && !values.customerId && result.kind==='proposal') throw Error('Choose the customer before proposing customer use');
 if(result.patch.productName && !result.quotes.productName.includes(result.patch.productName)) throw Error('Preserve the supplied product wording');
 // A research request is parsed, never skipped: only {instruction} on a proposal or an explanation, 1-2000 characters, no control characters.
 if(Object.hasOwn(input,'research') && input.research!==undefined) {
  const r=input.research;
  if(result.kind==='defer' || !r || typeof r!=='object' || Array.isArray(r) || Object.keys(r).some(k=>k!=='instruction') || typeof r.instruction!=='string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r.instruction)) throw Error('Invalid research request');
  const instruction=r.instruction.trim();
  if(!instruction || instruction.length>2000) throw Error('Invalid research request');
  result.research={instruction};
 }
 return result;
}
export function reusableClassification(proposal, values) {
 return proposal?.kind==='proposal' && ['purpose','customerId'].some(k=>Object.hasOwn(proposal.patch,k)) &&
 (values.purpose==='company' || (values.purpose==='customer' && !!values.customerId));
}

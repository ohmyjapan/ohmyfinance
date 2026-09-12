import { validateReplyProposal } from './finance-review.mjs';
export function validateChatProposal(input, context, text) {
 const result=validateReplyProposal(input,context.customers,text);
 if(result.patch.customerId && !result.patch.purpose) { result.patch.purpose='customer'; result.quotes.purpose=result.quotes.customerId; }
 const values={...context.values,...result.patch};
 if(values.purpose==='customer' && !values.customerId && result.kind==='proposal') throw Error('Choose the customer before proposing customer use');
 if(result.patch.productName && !result.quotes.productName.includes(result.patch.productName)) throw Error('Preserve the supplied product wording');
 return result;
}
export function reusableClassification(proposal, values) {
 return proposal?.kind==='proposal' && ['purpose','customerId'].some(k=>Object.hasOwn(proposal.patch,k)) &&
 (values.purpose==='company' || (values.purpose==='customer' && !!values.customerId));
}

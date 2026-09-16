import {assessPurchaseAccounting} from '../shared/finance-accounting-assessment.mjs';

export const accountingContract='OMF accounting fields have different roles. purpose identifies customer purchase versus company operating use; a historical expense label alone does not select a ledger account. accountCategoryId is the purchase-side 勘定科目, selected from registered parent accounts. subAccountCategoryId is its optional 補助科目 and must belong to that selected parent. The credit-card liability and card-number subsidiary are configured separately by OMF; do not put them into the purchase-side fields merely because payment was by card. transactionCategoryId is the separate 区分 field; a spreadsheet category is evidence about that classification, not automatically the ledger account. A broad label such as 経費 does not by itself justify choosing a registered account with the same name when the evidence supports a specific purchase account. Use supplied accountingGuidance as conditional OMF guidance, not as purchase evidence or a saved reference answer. Establish the purchase nature and known use from captured evidence, then explain a registered account candidate. Respect a supported existing company policy among appropriate alternatives. A service descriptor alone cannot prove an ongoing subscription, a perpetual licence, equipment, prepaid period, private use or tax treatment. If the evidence cannot support a specific account, leave that field unresolved and ask only for the missing purchase or policy fact. A repeating pattern in inspected charges is not a confirmed billing schedule: do not turn sampled dates or counts into exact billing days, frequency or charges per month, including in questions. Ask for the contract or plan without presenting an inferred schedule as fact. Do not infer tax or invoice verification from account selection. Do not introduce numeric tax thresholds or eligibility rules without captured authoritative support. Cite captured purchase facts for reasoned findings; guidance source links are reading leads, not captured quotations or live verification.';

// Rebuild advice from the same purchase input the model receives. Never read saved
// evaluation answers, draft history, mapping suggestions or target-row lessons here.
export function accountingGuidance(context){
 const references=context.references||{},assessment=assessPurchaseAccounting({source:context.source||{},values:context.values||{},references});
 const accounts=references.accountCategories||[];
 return {
  version:1,kind:'conditional_accounting_guidance',rule:assessment.rule,
  reason:assessment.reason,question:assessment.question,
  candidateAccountNames:assessment.alternatives.filter(name=>accounts.some(a=>a.name===name&&!a.parentId&&a.isActive!==false&&(!a.type||a.type==='expense'))),
  sources:assessment.sources,
  limitation:'These are existing OMF advisory rules, not evidence of this purchase, an exhaustive list of acceptable accounts, or current verification of the linked pages. Contract, use and company policy still govern the proposal.'
 };
}

import {assessPurchaseAccounting} from './finance-accounting-assessment.mjs';
import {normalizeMerchant,sameValue} from './finance-draft.mjs';
export const serviceUseConfirmation='選択した明細は当期の社内業務用サービス・電話利用料です。年払い・前払分、機器購入、私用は含みません。';
const rules=['cloud-service','telephone-service'];
export function recurringServiceDescriptor(source){return rules.includes(assessPurchaseAccounting({source,values:{purpose:'company'}}).rule)}
export function recurringServiceCandidate(draft){
 const v=draft.values||{},refs=draft.references||{},a=assessPurchaseAccounting(draft);
 if(draft.source?.kind!=='expense'||draft.locked||draft.approvedAt||draft.rememberedFields?.length||v.purpose!=='company'||v.customerId||v.accountCategoryId||v.subAccountCategoryId||a.status!=='candidate'||!rules.includes(a.rule)||a.question||a.categoryConcern)return null;
 if(['accountCategoryId','transactionCategoryId','purpose'].some(k=>draft.evidence?.[k]?.state==='conflict'||draft.evidence?.[k]?.alternative!==undefined))return null;
 const account=a.choices.filter(c=>c.name==='通信費');if(account.length!==1)return null;
 const categories=(refs.transactionCategories||[]).filter(c=>c.name==='通信費'),current=(refs.transactionCategories||[]).find(c=>String(c._id||c.id)===v.transactionCategoryId);
 if(v.transactionCategoryId&&current?.name!=='通信費')return null;
 if(draft.source.category&&normalizeMerchant(draft.source.category)!==normalizeMerchant('通信費'))return null;
 if(!v.transactionCategoryId&&categories.length!==1)return null;
 const fields=[{key:'accountCategoryId',label:'勘定科目',before:'',value:account[0].id,displayValue:'通信費'}];
 if(!v.transactionCategoryId)fields.push({key:'transactionCategoryId',label:'区分',before:'',value:String(categories[0]._id||categories[0].id),displayValue:'通信費'});
 return {version:1,rule:a.rule,fields,reason:a.reason,mappingReason:draft.evidence?.purpose?.reason||'現在の下書きは会社経費です。',sources:a.sources,confirmation:serviceUseConfirmation};
}
export function serviceReviewBinding(draft,candidate){return JSON.stringify([1,draft.importId,draft.line,draft.key,draft.sourceHash,draft.revision,draft.values,draft.cardAccounting||null,candidate])}
export function serviceReviewApplied(draft,key){const event=(draft.history||[]).find(h=>h.serviceReview?.key===key);return !!event&&event.revision===draft.revision&&event.serviceReview.fields.every(f=>sameValue(draft.values[f.key],f.value))}

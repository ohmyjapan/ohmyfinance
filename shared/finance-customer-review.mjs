import {assessPurchaseAccounting} from './finance-accounting-assessment.mjs';
import {normalizeMerchant,sameValue} from './finance-draft.mjs';
export const customerTreatments=[
 {id:'resale',account:'仕入高',type:'expense',label:'会社が仕入れて、顧客へ販売',confirmation:'選択した明細は、会社が仕入れ、表示された顧客へ販売する商品の代金です。商品代金を自社の売上として計上する取引です。',source:{title:'弥生：仕入高',url:'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/shiwakedaizenshu/shiiredaka/',checkedAt:'2026-09-13'}},
 {id:'advance',account:'立替金',type:'asset',label:'顧客の代金を一時的に立替',confirmation:'選択した明細は、表示された顧客が負担する商品代金を会社が一時的に立て替え、後で同額を回収する取引です。立替分は自社の商品売上と分けて精算します。',source:{title:'弥生：立替金',url:'https://www.yayoi-kk.co.jp/kaikei/oyakudachi/tatekaekin/',checkedAt:'2026-09-13'}}
];
const find=(refs,key,id)=>(refs[key]||[]).find(r=>String(r._id||r.id)===id);
export function customerGoodsContext(draft){
 const v=draft.values||{},refs=draft.references||{},customer=find(refs,'customers',v.customerId),category=find(refs,'transactionCategories',v.transactionCategoryId);
 if(draft.source?.kind!=='expense'||draft.locked||draft.approvedAt||draft.rememberedFields?.length||v.purpose!=='customer'||!customer||customer.isActive===false||v.accountCategoryId||v.subAccountCategoryId||!draft.source.account?.id||!normalizeMerchant(draft.source.description))return null;
 const goods=['商品代金','상품대금','商品仕入'],history=draft.purchaseHistory;
 const unlinkedHistory=history?.status==='review'&&history.reviewCode==='unlinked_context'&&/^[a-f0-9]{64}$/.test(history.sourceHash||'')&&Number.isSafeInteger(history.exampleCount)&&history.exampleCount>0;
 if(!goods.includes(category?.name)||draft.source.category&&!goods.includes(draft.source.category)||assessPurchaseAccounting(draft).rule||history?.status==='review'&&!unlinkedHistory)return null;
 if(['purpose','customerId','transactionCategoryId','accountCategoryId','subAccountCategoryId'].some(k=>draft.evidence?.[k]?.state==='conflict'||draft.evidence?.[k]?.alternative!==undefined))return null;
 return {customerId:v.customerId,customerName:customer.name,accountId:draft.source.account.id,card:draft.source.account.name,merchant:draft.source.description,category:category.name,mappingReason:draft.evidence?.customerId?.reason||draft.evidence?.purpose?.reason||'現在の下書きの顧客・区分を表示しています。',originalCategory:draft.source.source?.category||'',...(unlinkedHistory?{historyGap:{code:history.reviewCode,reason:history.reason,sourceHash:history.sourceHash,exampleCount:history.exampleCount}}:{})};
}
export function customerPurchaseCandidate(draft,treatment){
 const context=customerGoodsContext(draft),choice=customerTreatments.find(c=>c.id===treatment);if(!context||!choice)return null;
 const matches=(draft.references.accountCategories||[]).filter(r=>r.name===choice.account&&r.type===choice.type&&r.isActive!==false&&!r.parentId);
 if(matches.length!==1||!(/^[a-f0-9]{24}$/).test(String(matches[0]._id||matches[0].id)))return null;
 return {version:1,treatment,context,fields:[{key:'accountCategoryId',label:'勘定科目',before:'',value:String(matches[0]._id||matches[0].id),displayValue:choice.account}],confirmation:choice.confirmation,sources:[choice.source]};
}
export function customerReviewBinding(draft,candidate){return JSON.stringify([1,draft.importId,draft.line,draft.key,draft.sourceHash,draft.revision,draft.values,draft.cardAccounting||null,candidate])}
export function customerReviewApplied(draft,key,treatment){const event=(draft.history||[]).find(h=>h.customerReview?.key===key&&h.customerReview.treatment===treatment);return !!event&&event.revision===draft.revision&&event.customerReview.fields.every(f=>sameValue(draft.values[f.key],f.value))}
export function customerReviewGroup(context){return JSON.stringify([context.customerId,context.accountId,normalizeMerchant(context.merchant)])}

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyValues } from '../shared/finance-draft.mjs';
import { draftReadiness, sourceCategoryChoices, taxAndInvoice } from '../shared/finance-preparation.mjs';
import { consultationEvidence } from '../shared/finance-consultation.mjs';
import { interpreterInput } from '../teaching-worker/interpreter.mjs';
const id = n => String(n).padStart(24, '0');
const refs = { customers: [{ _id:id(1), name:'Synthetic client' }], accountCategories:[{ _id:id(2), name:'Synthetic expense' },{ _id:id(6), name:'Sub', parentId:id(2) }], transactionCategories:[{ _id:id(3), name:'Synthetic classification' }], taxCategories:[{ _id:id(4), name:'Synthetic zero', rate:0 },{ _id:id(5), name:'Synthetic tax', rate:8 }] };
const full = () => ({ values:{ ...emptyValues({processingDate:'2026-08-01',description:'Synthetic'}), purpose:'company', accountCategoryId:id(2), transactionCategoryId:id(3), taxCategoryId:id(4), taxRate:0, invoiceNumber:'T0000000000000' }, evidence:{}, source:{kind:'expense'}, references:refs });
test('source category choices preserve literal labels and expose normalized ambiguity',()=>{
 const rows=[{purpose:'customer',category:'Synthetic classification'},{purpose:'company',category:'Ｓynthetic classification'},{purpose:'unresolved',category:'No decision'},{purpose:'repayment',category:'No spending'},{purpose:'company',category:' '.repeat(3)}];
 assert.deepEqual(sourceCategoryChoices(rows,refs),[{name:'Synthetic classification',count:2,matches:1}]);
 assert.equal(sourceCategoryChoices(rows,{transactionCategories:[...refs.transactionCategories,{name:'synthetic classification'}]})[0].matches,2);
});
test('known classification still needs accounting, and blank rates remain unknown',()=>{
 const d=full();d.values.taxRate=null;
 assert.equal(draftReadiness(d).state,'accounting');assert.ok(draftReadiness(d).missing.some(f=>f.key==='taxRate'));
 assert.equal(taxAndInvoice(d).tax.rateLabel,'未設定');
 d.values.taxRate=0;assert.equal(draftReadiness(d).state,'confirmation');assert.equal(taxAndInvoice(d).tax.rateLabel,'0%');
 d.approvedAt='2026-08-02';assert.equal(draftReadiness(d).state,'ready');
 assert.equal(d.values.productName,'');assert.deepEqual(d.values.items,[]);
});
test('invoice omissions and order numbers remain reviewable after draft approval',()=>{
 const d=full();d.approvedAt='2026-08-02';d.values.invoiceNumber='';d.evidence.invoiceNumber={state:'not_applicable'};
 assert.equal(draftReadiness(d).state,'invoice');assert.equal(taxAndInvoice(d).invoice.status,'missing');
 d.values.receiptNumber='ORDER-SYNTHETIC';assert.equal(taxAndInvoice(d).invoice.number,'');
 d.values.invoiceNumber='ORDER-SYNTHETIC';assert.equal(draftReadiness(d).invoice.status,'format_review');
 d.values.invoiceNumber='T0000000000000';assert.equal(taxAndInvoice(d).invoice.status,'recorded');
 d.evidence.invoiceNumber={state:'confirmed'};assert.equal(taxAndInvoice(d).invoice.status,'confirmed');
});
test('reference validity, account pairs, tax pairs and item tax mismatches prevent ready state',()=>{
 const check=mutate=>{const d=full();d.approvedAt='yes';mutate(d.values);assert.equal(draftReadiness(d).state,'accounting');};
 check(v=>v.accountCategoryId=id(99));check(v=>v.accountCategoryId=id(6));check(v=>{v.subAccountCategoryId=id(6);v.accountCategoryId=id(6)});
 check(v=>v.taxRate=8);check(v=>v.items=[{productName:'item',janCode:'',productUrl:'',quantity:1,unitPrice:5,taxCategoryId:id(5),taxRate:null}]);
 check(v=>v.date='not a date');
});
test('source-backed category awaiting registration is accounting work; saved clearing is a decision',()=>{
 const d=full();d.values.transactionCategoryId='';d.source.category='Synthetic source';d.evidence.transactionCategoryId={state:'missing',source:'spreadsheet'};
 assert.equal(draftReadiness(d).state,'accounting');d.revision=1;assert.equal(draftReadiness(d).state,'decision');
 d.values.transactionCategoryId=id(3);d.values.purpose='customer';d.values.customerId='';assert.equal(draftReadiness(d).state,'decision');
});
test('posting, reservation, exclusions and evidence conflicts outrank field completion',()=>{
 const d=full();d.approvedAt='yes';
 for(const state of ['legacy_review','overlap_review','correction_review','in_progress'])assert.equal(draftReadiness(d,refs,{state}).state,'reconciliation');
 assert.equal(draftReadiness({...d,locked:true}).state,'reconciliation');assert.equal(draftReadiness(d,refs,{state:'posted'}).state,'posted');
 assert.equal(draftReadiness(d,refs,{skipped:true}).state,'held');assert.equal(draftReadiness({...d,source:{kind:'repayment'}}).state,'excluded');
 d.evidence.purpose={state:'conflict'};assert.equal(draftReadiness(d).state,'decision');
});
test('AI receives invoice and tax review explicitly without gaining additional edit permissions',()=>{
 const d=full();d.values.invoiceNumber='';d.values.taxRate=null;const mapping=consultationEvidence(d);
 assert.equal(mapping.accountingReview.invoice.status,'missing');assert.equal(mapping.accountingReview.tax.rate,null);
 const input=interpreterInput({context:{values:d.values,source:{description:'Synthetic',purchaseDate:'2026-08-01',amount:100,account:{name:'Synthetic'}},mapping,study:{},customers:[],messages:[]},text:'What remains?'});
 assert.deepEqual(input.mapping.accountingReview,mapping.accountingReview);
});


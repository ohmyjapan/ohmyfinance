import test from 'node:test';
import assert from 'node:assert/strict';
import { consultationEvidence } from '../shared/finance-consultation.mjs';
import { fields, emptyValues } from '../shared/finance-draft.mjs';
import { studyPurchase } from '../shared/finance-review.mjs';
import { interpreterInput } from '../teaching-worker/interpreter.mjs';
const draft = () => ({
  values: {...emptyValues({purchaseDate:'2026-08-01',description:'Example subscription'}),purpose:'company',transactionCategoryId:'category-a',taxRate:0},
  evidence:{transactionCategoryId:{state:'suggested',source:'spreadsheet',reason:'User-confirmed category',token:'excluded'},purpose:{state:'suggested',source:'spreadsheet',reason:'Source company label'}},
  references:{transactionCategories:[{_id:'category-a',name:'通信費',secret:'excluded'}],customers:[]},
  source:{description:'Example subscription',purchaseDate:'2026-08-01',amount:1200,account:{name:'Test card',token:'excluded'},purpose:'company',category:'通信費',reason:'Confirmed mapping',source:{sheet:'data',rows:[20],client:'法人',category:''}},
  missing:[{key:'accountCategoryId',label:'勘定科目'}],revision:0,documents:[{name:'excluded',path:'excluded'}]
});
test('consultation preserves known categories, zero values, source labels and draft status',()=>{
 const d=draft(),m=consultationEvidence(d),f=key=>m.fields.find(f=>f.key===key);
 assert.equal(f('transactionCategoryId').displayValue,'通信費');assert.equal(f('transactionCategoryId').evidence.reason,'Confirmed mapping');assert.equal(f('transactionCategoryId').evidence.source,'annotated_mapping');
 assert.equal(f('taxRate').presence,'present');assert.equal(f('taxRate').value,0);assert.equal(f('customerId').presence,'not_applicable');
 assert.equal(f('accountCategoryId').presence,'missing');assert.deepEqual(m.missingRequired,d.missing);
 assert.equal(m.sourceClassification.category,'通信費');assert.equal(m.sourceClassification.originalSheet.category,'');assert.equal(m.saved,false);assert.equal(m.approved,false);
 assert.equal(m.fields.length,fields.length);assert.ok(!JSON.stringify(m).includes('excluded'));assert.deepEqual(m.documents,{count:1,contentsAvailable:false});
 d.values.transactionCategoryId='';const missing=consultationEvidence(d);assert.equal(missing.sourceClassification.category,'通信費');assert.equal(missing.fields.find(f=>f.key==='transactionCategoryId').presence,'missing');
});
test('current corrections and conflicting alternatives stay distinct from source mapping',()=>{
 const d=draft();d.values.transactionCategoryId='other';d.references.transactionCategories.push({_id:'other',name:'Other category'});d.revision=2;
 d.evidence.transactionCategoryId={state:'conflict',source:'user',reason:'Current correction',alternative:'category-a',alternativeEvidence:{state:'suggested',source:'learning',reason:'Older suggestion',token:'excluded'}};
 const m=consultationEvidence(d),f=m.fields.find(f=>f.key==='transactionCategoryId');assert.equal(f.displayValue,'Other category');assert.equal(f.alternative.displayValue,'通信費');assert.equal(f.evidence.source,'user');assert.equal(m.sourceClassification.category,'通信費');assert.ok(!JSON.stringify(m).includes('excluded'));assert.equal(m.saved,true);
 d.values.transactionCategoryId='unregistered';assert.equal(consultationEvidence(d).fields.find(f=>f.key==='transactionCategoryId').presence,'unresolved_reference');
});
test('item evidence excludes URLs and treats identified line items as known purchase content',()=>{
 const d=draft();d.values.items=[{productName:'Recorded item',quantity:1,unitPrice:1200,productUrl:'https://example.invalid/?token=excluded',private:'excluded'}];
 const m=consultationEvidence(d);assert.ok(!JSON.stringify(m).includes('excluded'));assert.equal(m.fields.find(f=>f.key==='items').value[0].productName,'Recorded item');
 const study=studyPurchase(d);assert.ok(!study.openFields.includes('productName'));assert.ok(!study.signals.some(s=>s.includes('품목')));
});
test('unknown history is not a contrary classification; category counts use only earlier matching rows',()=>{
 const d=draft(),row={merchant:d.source.description,date:'2026-07-01',amount:1200,purpose:'company',customerId:'',customerLabel:'法人',category:'通信費'};
 const history=[row,{...row,category:''},{...row,purpose:'unresolved',customerLabel:'',category:undefined},{...row,date:'2026-08-01',category:'future'},{...row,merchant:'Other descriptor',category:'other'}];
 const s=studyPurchase(d,history);assert.equal(s.historyCount,3);assert.deepEqual(s.historicalCategories,{field:'transactionCategoryId',label:'区分',counts:[{label:'通信費',count:1}],unknownCount:2});assert.ok(!s.signals.some(s=>s.includes('달랐습니다')));assert.ok(s.signals.some(s=>s.includes('1건은')));
 const conflict=studyPurchase(d,[...history,{...row,purpose:'customer',customerId:'customer-a'}]);assert.ok(conflict.signals.some(s=>s.includes('달랐습니다')));
});
test('inference input carries complete mapped evidence without leaking source or reference objects',()=>{
 const d=draft(),mapping=consultationEvidence(d),job={text:'Explain the known category',context:{values:d.values,source:d.source,mapping,study:studyPurchase(d),customers:[],messages:[],credentials:'excluded',references:{secret:'excluded'}}};
 const input=interpreterInput(job);assert.deepEqual(input.mapping,mapping);assert.equal(input.purchase.currency,'JPY');assert.ok(!JSON.stringify(input).includes('excluded'));
 delete job.context.mapping;assert.equal(interpreterInput(job).mapping,null);
 const workspace=interpreterInput({text:'Page question',context:{mode:'workspace',pageName:'Mapping',facts:{known:1},capabilities:[],messages:[],mapping}});assert.equal(workspace.mapping,undefined);assert.deepEqual(workspace.evidence,{known:1});
});

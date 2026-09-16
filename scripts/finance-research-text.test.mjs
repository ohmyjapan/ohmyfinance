import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {emptyValues} from '../shared/finance-draft.mjs';
import * as finance from '../shared/finance-research.mjs';
import {researchSystem} from '../research-worker/worker.mjs';
const schema=new (createRequire(import.meta.url)('ajv'))({allErrors:true}).compile(finance.reportSchema);
const textFields=finance.researchFields.filter(f=>['text','textarea'].includes(f.kind));
const context={values:emptyValues({purchaseDate:'2026-04-01',description:'Synthetic purchase'}),references:{}};
const sources=[{id:'s1',kind:'document',text:'株式会社サンプル / 상품 / Sample "quoted" item / folder\\item / #000010 / 0000000000010 / T1234567890123 / 10 / first\nsecond'}];
const finding=(field,valueJson)=>({field,valueJson,basis:'literal',reason:'Printed synthetic evidence.',citations:[{sourceId:'s1',quote:sources[0].text}]}),report=f=>({summary:'Text proposal for review.',question:'',supplier:null,findings:[f]});

test('every text field requires a JSON string while preserving Unicode, escapes and numeric-looking identifiers',()=>{
 for(const field of textFields){
  for(const value of ['株式会社サンプル','상품','Sample "quoted" item','folder\\item','#000010','0000000000010','10','first\nsecond',''])assert(schema(report(finding(field.key,JSON.stringify(value)))),JSON.stringify(schema.errors));
  assert(schema(report(finding(field.key,'"\\u5546\\u54c1"'))));
  for(const valueJson of ['Sample','株式会社サンプル','T1234567890123','10','null','true','{}','[]','"unclosed','"bad\\x20escape"','"bad\\u12escape"','"unescaped\nnewline"',10,null,{}])assert.equal(schema(report(finding(field.key,valueJson))),false,field.key+': '+JSON.stringify(valueJson));
 }
 assert.equal(typeof finance.textValueContract,'string');assert(researchSystem.includes(finance.textValueContract));
});

test('text-format feedback identifies the field and rejects coercion without changing the proposal',()=>{
 for(const field of textFields)for(const valueJson of ['Sample','株式会社サンプル','10','null','true','{}','[]',10]){
  const input=report(finding(field.key,valueJson)),before=structuredClone(input);let error;try{finance.validateReport(input,context,sources)}catch(e){error=e}
  assert(error);assert.deepEqual(input,before);const feedback=finance.validationFeedback(error);assert.equal(feedback.code,'text_value_invalid');assert.deepEqual(feedback.fields,[field.key]);assert(feedback.instruction.includes('JSON.stringify'));assert.equal(feedback.value,undefined);
 }
});

test('encoded text still requires exact literal evidence and preserves identifier prefixes and leading zeros',()=>{
 for(const [field,value] of [['companyInfo','株式会社サンプル'],['productName','Sample "quoted" item'],['receiptNumber','#000010'],['trackingNumber','0000000000010'],['janCode','0000000000010'],['invoiceNumber','T1234567890123']]){
  const input=report(finding(field,JSON.stringify(value)));assert.equal(finance.validateReport(input,context,sources).findings[0].value,value);
  assert.throws(()=>finance.validateReport({...input,findings:[{...input.findings[0],citations:[{sourceId:'s1',quote:'Uncaptured evidence'}]}]},context,sources),/captured evidence/);
  assert.throws(()=>finance.validateReport(report(finding(field,JSON.stringify(value+'-other'))),context,sources),{code:'finding_evidence_invalid'});
 }
 const input=report(finding('productName','"first\\nsecond"'));assert.equal(finance.validateReport(input,context,sources).findings[0].value,'first\nsecond');
 assert.equal(finance.validateReport(report(finding('productName','"10"')),context,sources).findings[0].value,'10');
});

test('text encoding cannot relax empty invoice, length, whitespace or decoded control-character checks',()=>{
 assert.throws(()=>finance.validateReport(report(finding('invoiceNumber','""')),context,sources),/literal evidence/);
 assert.equal(finance.validateReport(report(finding('productName','""')),context,sources).findings[0].value,'');
 for(const value of ['x'.repeat(1001),' padded ','bad\u0000text'])assert.throws(()=>finance.validateReport(report({...finding('productName',JSON.stringify(value)),basis:'reasoned'}),context,sources));
 const supplier={shopName:'Synthetic shop',legalName:'株式会社サンプル',invoiceNumber:'T1234567890123',citations:[{sourceId:'s1',quote:sources[0].text}]};
 assert.deepEqual(finance.validateReport({summary:'Supplier proposal.',question:'',findings:[],supplier},context,sources).supplier,supplier);
});

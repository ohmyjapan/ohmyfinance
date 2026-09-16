import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {emptyValues} from '../shared/finance-draft.mjs';
import {reportSchema,validateReport,validationFeedback} from '../shared/finance-research.mjs';
const Ajv=createRequire(import.meta.url)('ajv'),schema=new Ajv({allErrors:true}).compile(reportSchema);
const context={values:emptyValues({purchaseDate:'2026-04-01',description:'Synthetic receipt'}),references:{}};
const source={id:'s1',kind:'document',text:'Receipt #000010. JAN 0000000000010. Product 10. Unit price 1200.50. Tax 10%.'};
const finding=(field,value)=>({field,valueJson:JSON.stringify(value),basis:'literal',reason:'Printed on the synthetic receipt.',citations:[{sourceId:'s1',quote:source.text}]}),report=(...findings)=>({summary:'Receipt findings for review.',question:'',supplier:null,findings});

test('numeric finding output accepts JSON numbers and rejects text copied from OCR records',()=>{
 for(const field of ['taxRate','productPrice']){
  for(const value of [0,8,10,12.5,100,1e-7])assert(schema(report(finding(field,value))),JSON.stringify(schema.errors));
  for(const value of ['10','10%','1,200.50','','null',true,[],{}])assert.equal(schema(report(finding(field,value))),false,field+': '+JSON.stringify(value));
 }
 assert(schema(report(finding('productPrice',null))));
 for(const valueJson of ['+10','01','1.','NaN','Infinity'])assert.equal(schema(report({...finding('taxRate',10),valueJson})),false);
});

test('numeric-looking identifiers and names retain their literal strings, prefixes and leading zeros',()=>{
 for(const [field,value] of [['receiptNumber','#000010'],['janCode','0000000000010'],['productName','10']]){
  const r=report(finding(field,value));assert(schema(r));assert.equal(validateReport(r,context,[source]).findings[0].value,value);
 }
});

test('strict numeric validation still rejects quoted numbers and reports the affected field without coercion',()=>{
 for(const field of ['taxRate','productPrice']){
  const r=report(finding(field,'10')),before=structuredClone(r);let error;
  try{validateReport(r,context,[source])}catch(e){error=e}
  assert(error);assert.deepEqual(r,before);const feedback=validationFeedback(error);assert.deepEqual(feedback.fields,[field]);assert.equal(feedback.code,'numeric_value_invalid');assert.equal(feedback.value,undefined);assert(feedback.instruction.includes('JSON number'));
 }
});

test('numeric format does not bypass range limits or manufacture an unknown price as zero',()=>{
 for(const [field,valueJson] of [['taxRate','101'],['taxRate','-1'],['taxRate','1e999'],['productPrice','1000000000001'],['productPrice','-1']])assert.throws(()=>validateReport(report({...finding(field,10),valueJson}),context,[source]));
 const r=validateReport(report(finding('productPrice',null)),context,[source]);assert.equal(r.findings[0].value,null);assert.equal(context.values.productPrice,null);
 assert.equal(validateReport(report(finding('productPrice',1200.5)),context,[source]).findings[0].value,1200.5);
});

test('well-formed numeric percentages still require literal purchase evidence',()=>{
 const r=report(finding('taxRate',10));assert(schema(r));assert.equal(validateReport(r,context,[source]).findings[0].value,10);
 for(const kind of ['spreadsheet','context','web','registry'])assert.throws(()=>validateReport(r,context,[{...source,kind}]),/printed purchase percentage/);
 const missing={...source,text:'Tax treatment unknown'};assert.throws(()=>validateReport(report({...finding('taxRate',10),citations:[{sourceId:'s1',quote:missing.text}]}),context,[missing]),/printed purchase percentage/);
});

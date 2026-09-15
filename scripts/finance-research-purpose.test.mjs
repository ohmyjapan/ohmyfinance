import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {emptyValues,validateValues,purposeChoices} from '../shared/finance-draft.mjs';
import {reportSchema,validateReport,validationFeedback,validateDiagnostic,diagnosticMessage} from '../shared/finance-research.mjs';
const Ajv=createRequire(import.meta.url)('ajv'),schema=new Ajv({allErrors:true}).compile(reportSchema);
const customer='111111111111111111111111',context={values:emptyValues({purchaseDate:'2026-04-01',description:'Synthetic shop'}),references:{customers:[{_id:customer,name:'Synthetic customer'}]}},sources=[{id:'s1',kind:'spreadsheet',text:'Purchased for Synthetic customer.'}];
const finding=(field,value)=>({field,valueJson:JSON.stringify(value),reason:'Synthetic evidence',basis:'reasoned',citations:[{sourceId:'s1',quote:sources[0].text}]}),report=(...findings)=>({summary:'Synthetic report',question:'',supplier:null,findings});
test('purpose schema accepts only the three stored values, including encoded JSON strings',()=>{
 for(const choice of purposeChoices)assert.equal(schema(report(finding('purpose',choice.value))),true,JSON.stringify(schema.errors));
 for(const value of ['business','仕入れ：SYNTHETIC','company expense','CUSTOMER','',null,10,{}]){const r=report(finding('purpose',value));assert.equal(schema(r),false);assert.throws(()=>validateReport(r,context,sources),{code:'purpose_invalid'})}
 assert.equal(schema(report({...finding('purpose','customer'),valueJson:'customer'})),false);
 assert.equal(schema(report(finding('productName','business'))),true);
});
test('combined customer and purpose proposals validate in either order without mutating inputs',()=>{
 const original=JSON.stringify(context),pair=[finding('purpose','customer'),finding('customerId',customer)];
 for(const fields of [pair,[...pair].reverse()])assert.equal(validateReport(report(...fields),context,sources).findings.length,2);
 assert.equal(JSON.stringify(context),original);
 assert.throws(()=>validateReport(report(finding('customerId',customer)),context,sources),{code:'purpose_customer_conflict'});
 assert.throws(()=>validateReport(report(finding('purpose','company'),finding('customerId',customer)),context,sources),{code:'purpose_customer_conflict'});
 assert.throws(()=>validateReport(report(finding('purpose','customer'),finding('customerId','222222222222222222222222')),context,sources),/Unregistered/);
 assert.equal(validateReport(report(finding('purpose','customer')),context,sources).findings.length,1);
 assert.equal(validateReport(report(),context,sources).findings.length,0);
 assert.throws(()=>validateValues({...context.values,customerId:customer}));
});
test('changing from a customer purchase requires a supported customer clear in the same proposal',()=>{
 const current={...context,values:{...context.values,purpose:'customer',customerId:customer}};
 assert.throws(()=>validateReport(report(finding('purpose','company')),current,sources),{code:'purpose_customer_conflict'});
 assert.equal(validateReport(report(finding('purpose','company'),finding('customerId','')),current,sources).findings.length,2);
});
test('correction feedback supplies meanings without silently translating ambiguous purpose',()=>{
 let error;try{validateReport(report(finding('purpose','business')),context,sources)}catch(e){error=e}
 const feedback=validationFeedback(error);assert.equal(feedback.code,'purpose_invalid');assert.deepEqual(feedback.fields,['purpose']);assert.deepEqual(feedback.purposeChoices.map(c=>c.value),['customer','company','unresolved']);assert(feedback.purposeChoices.every(c=>c.meaning.length>50));assert(feedback.instruction.includes('do not guess'));assert.equal(feedback.expected,undefined);
 const conflict=validationFeedback({code:'purpose_customer_conflict'});assert.deepEqual(conflict.fields,['purpose','customerId']);
});
test('failure diagnostics reject arbitrary strings, reports and unknown codes',()=>{
 const d={code:'purpose_invalid',correctionAttempted:true};assert.deepEqual(validateDiagnostic(d),d);assert(diagnosticMessage(d).includes('用途'));
 for(const input of [{...d,error:'private raw output'},{...d,report:{}},{...d,code:'__proto__'},{...d,correctionAttempted:'true'},null])assert.throws(()=>validateDiagnostic(input));
 assert.equal(diagnosticMessage(null),'この評価は完了できませんでした。');
});

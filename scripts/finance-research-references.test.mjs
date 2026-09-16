import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {emptyValues} from '../shared/finance-draft.mjs';
import {researchFields,reportSchema,validateReport,validationFeedback} from '../shared/finance-research.mjs';
const Ajv=createRequire(import.meta.url)('ajv'),schema=new Ajv({allErrors:true}).compile(reportSchema);
const id='0123456789abcdef01234567',other='ffffffffffffffffffffffff',referenceFields=researchFields.filter(f=>f.ref);
const context={values:{...emptyValues({purchaseDate:'2026-04-01',description:'Synthetic service'}),purpose:'customer'},references:Object.fromEntries(referenceFields.map(f=>[f.ref,[{_id:id,name:'Synthetic reference'}]]))};
const sources=[{id:'s1',kind:'mail',text:'Synthetic service purchased for the registered customer.'}];
const finding=(field,valueJson)=>({field,valueJson,basis:'reasoned',reason:'Synthetic purchase evidence.',citations:[{sourceId:'s1',quote:sources[0].text}]}),report=f=>({summary:'Reference proposal.',question:'',supplier:null,findings:[f]});

test('reference schema requires JSON-encoded identifiers, including all-numeric IDs and supported clears',()=>{
 for(const f of referenceFields){
  for(const value of [id,'000000000000000000000001','ABCDEF0123456789ABCDEF01',''])assert(schema(report(finding(f.key,JSON.stringify(value)))),JSON.stringify(schema.errors));
  for(const valueJson of [id,'111111111111111111111111','null','true','{}','[]','"Synthetic reference"','"123"','" '+id+' "'])assert.equal(schema(report(finding(f.key,valueJson))),false,f.key+': '+valueJson);
 }
});

test('reference-format failures identify the field without guessing or changing the supplied ID',()=>{
 for(const f of referenceFields)for(const valueJson of [id,'111111111111111111111111','null','true','{}','"123"']){
  const r=report(finding(f.key,valueJson)),before=structuredClone(r);let error;
  try{validateReport(r,context,sources)}catch(e){error=e}
  assert(error);assert.deepEqual(r,before);const feedback=validationFeedback(error);assert.equal(feedback.code,'reference_value_invalid');assert.deepEqual(feedback.fields,[f.key]);assert(feedback.instruction.includes('JSON.stringify'));assert.equal(feedback.value,undefined);
 }
});

test('correctly encoded references still require registered choices, captured citations and a valid customer purpose',()=>{
 for(const f of referenceFields){
  assert.equal(validateReport(report(finding(f.key,JSON.stringify(id))),context,sources).findings[0].value,id);
  assert.equal(validateReport(report(finding(f.key,'""')),context,sources).findings[0].value,'');
  assert.throws(()=>validateReport(report(finding(f.key,JSON.stringify(other))),context,sources),/Unregistered/);
  assert.throws(()=>validateReport(report({...finding(f.key,JSON.stringify(id)),citations:[{sourceId:'s1',quote:'Uncaptured evidence'}]}),context,sources),/captured evidence/);
 }
 const customer=report(finding('customerId',JSON.stringify(id)));
 assert.throws(()=>validateReport(customer,{...context,values:{...context.values,purpose:'company'}},sources),{code:'purpose_customer_conflict'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LEARNING_RUNTIME,stable,validateEvidence,validateRecipe} from '../shared/finance-bank-learning.mjs';
import {projectEvidence} from '../collector/bank-learning-recorder.mjs';
const sha=v=>createHash('sha256').update(stable(v)).digest('hex');
const origin='https://bank.example.invalid';
function fixture(from=['year','month','day'],to=['year','month','day']){
 const roles=[['account'],...from.map(f=>['from',f]),...to.map(f=>['to',f]),['export'],['balance'],['logout']];
 const record={complete:true,truncated:false,events:roles.map(([role,format],i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin,role,tag:['from','to'].includes(role)?'input':'text',...(format?{format}:{}),private:{selector:'#PRIVATE-BANK-CONTROL',value:'PRIVATE-BANK-VALUE',framePath:[]}}))};
 const evidence={schema:1,runtime:LEARNING_RUNTIME,origins:[origin],events:record.events.map(({private:local,...e})=>e),complete:true,truncated:false},evidenceHash=sha(evidence);
 return {record,evidence,evidenceHash,candidate:{schema:1,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))}};
}
test('six separately demonstrated year/month/day fields make a complete recipe',()=>{
 const f=fixture();assert.equal(validateEvidence(f.evidence),f.evidence);assert.equal(validateRecipe(f.candidate,f.evidence,f.evidenceHash),f.candidate);
 const projected=projectEvidence(f.record);assert.deepEqual(projected,f.evidence);assert.ok(!JSON.stringify(projected).includes('PRIVATE-BANK'));
});
test('legacy whole-date formats and mixed whole/split dates remain usable',()=>{
 for(const format of [undefined,'iso','compact','slash'])for(const [from,to]of [[[format],[format]],[[format],['year','month','day']],[['year','month','day'],[format]]]){
  const f=fixture(from,to);assert.equal(validateRecipe(f.candidate,f.evidence,f.evidenceHash),f.candidate);
 }
});
test('incomplete, repeated and mixed component sets cannot claim a complete date',()=>{
 for(const from of [['year'],['year','month'],['year','month','month'],['year','month','day','day'],['iso','year','month','day'],['iso','iso']]){
  const f=fixture(from);assert.throws(()=>validateRecipe(f.candidate,f.evidence,f.evidenceHash),/candidate-missing-or-repeated-from/);
 }
 const f=fixture();for(const part of ['year','month','day']){const c=structuredClone(f.candidate);c.steps=c.steps.filter(s=>!(s.op==='to'&&f.evidence.events.find(e=>e.id===s.eventId).format===part));assert.throws(()=>validateRecipe(c,f.evidence,f.evidenceHash),/candidate-missing-or-repeated-to/);}
});
test('a corrected component can replace an earlier edit while all other components are retained',()=>{
 const f=fixture(['year','month','day','year']),candidate=structuredClone(f.candidate);candidate.steps=candidate.steps.filter(s=>s.eventId!=='e1');assert.equal(validateRecipe(candidate,f.evidence,f.evidenceHash),candidate);
});
test('component metadata does not admit invented actions, raw values or executable code',()=>{
 const f=fixture();for(const mutate of [c=>c.steps[1].op='to',c=>c.steps[1].script='fetch("secret")',c=>c.steps.reverse(),c=>c.steps[1].eventId='e99']){const bad=structuredClone(f.candidate);mutate(bad);assert.throws(()=>validateRecipe(bad,f.evidence,f.evidenceHash));}
 for(const mutate of [e=>e.events[1].format='era',e=>e.events[0].format='year',e=>e.events[1].value='2026',e=>e.events[1].selector='#year']){const bad=structuredClone(f.evidence);mutate(bad);assert.throws(()=>validateEvidence(bad));}
});

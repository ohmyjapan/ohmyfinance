import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LEARNING_RUNTIME,LEARNING_ROLES,stable,validateEvidence,validateRecipe,validateReplay} from '../shared/finance-bank-learning.mjs';
import {projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {inspectLearningStatement} from '../collector/bank-learning-runner.mjs';
const origin='https://bank.example.invalid',hash=v=>createHash('sha256').update(stable(v)).digest('hex');
export const record=()=>({complete:true,truncated:false,events:LEARNING_ROLES.map((role,i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin,role,tag:['from','to'].includes(role)?'input':'text',...(['from','to'].includes(role)?{format:'iso'}:{}),private:{selector:'#customer-555555',value:'SECRET-ACCOUNT-555555',framePath:[]}}))});
test('protected projection keeps ordered replay identities and excludes raw values/locators',()=>{
  const evidence=projectEvidence(record());assert.equal(evidence.events.length,7);assert.ok(!JSON.stringify(evidence).includes('555555'));
  const leaked=structuredClone(evidence);leaked.events[0].selector='#x';assert.throws(()=>validateEvidence(leaked));
  leaked.events[0]={...evidence.events[0],origin:origin+'/login?token=SECRET'};assert.throws(()=>validateEvidence(leaked));
  for(const patch of [{truncated:true},{complete:false}])assert.throws(()=>projectEvidence({...record(),...patch}));
});
test('candidate is data only and cannot add, reorder, repeat or relabel demonstrated actions',()=>{
  const evidence=projectEvidence(record()),candidate={schema:1,runtime:LEARNING_RUNTIME,evidenceHash:hash(evidence),steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};
  assert.equal(validateRecipe(candidate,evidence,hash(evidence)),candidate);
  for(const mutate of [c=>c.steps.push({eventId:'e99',op:'inquiry'}),c=>c.steps.reverse(),c=>c.steps[0].op='export',c=>c.steps[0].script='fetch("secret")',c=>c.runtime='future-runtime',c=>c.evidenceHash='a'.repeat(64),c=>c.steps=c.steps.filter(s=>s.op!=='logout')]){const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>validateRecipe(bad,evidence,hash(evidence)));}
});
test('CSV replay checks real parsing, pinned headers/signs, row contents and requested dates',async()=>{
  const template={headers:['日付','摘要','金額'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative'},period={from:'2026-11-01',to:'2026-11-02'};
  const csv=Buffer.from('日付,摘要,金額\r\n2026-11-01,"店舗,商品",-200\r\n2026-11-02,"改行\nの摘要",500\r\n');
  assert.equal((await inspectLearningStatement(csv,template,period)).rows,2);
  for(const value of ['日付,摘要,金額\n','日付,摘要,金額\n2026-10-31,店舗,-200\n','日付,摘要,金額\n2026-11-01,店舗,no\n','別列,摘要,金額\n2026-11-01,店舗,200\n','<html>認証が必要</html>','日付,摘要,金額\n2026-11-01,,200\n'])await assert.rejects(inspectLearningStatement(Buffer.from(value),template,period));
});
test('verification requires actual fresh period and all inquiry outcomes',()=>{
  const session={candidateHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),demonstrationPeriod:{from:'2026-10-01',to:'2026-10-02'},replayPeriod:{from:'2026-11-01',to:'2026-11-02'}};
  const receipt={candidateHash:session.candidateHash,evidenceHash:session.evidenceHash,runtime:LEARNING_RUNTIME,period:session.replayPeriod,statementHash:'c'.repeat(64),rows:2,accountMatched:true,balanceObserved:true,loggedOut:true,freshBrowser:true,startedAt:'2026-11-08T00:00:00Z',finishedAt:'2026-11-08T00:01:00Z'};
  validateReplay(receipt,session);
  for(const patch of [{rows:0},{loggedOut:false},{freshBrowser:false},{accountMatched:false},{period:session.demonstrationPeriod},{candidateHash:'d'.repeat(64)}])assert.throws(()=>validateReplay({...receipt,...patch},session));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLoginPrefix,validateEvidence,LEARNING_RUNTIME,LEARNING_ROLES,LEARNING_LOGIN_STOP_CODES,learningFailureText} from '../shared/finance-bank-learning.mjs';
import {replayLearningLogin,LearningCredentialRequest} from '../collector/bank-learning-login.mjs';
const origin='https://fictional.example.invalid',native=[['login-identifier','input'],['login-password','input'],['login-submit','button'],['login-success','text']].map(([role,tag],i)=>({id:'e'+i,role,tag,document:i===3?'d1':'d0',frame:'f0',popup:'p0',origin}));
test('closed login prefix rejects duplicate/native-document mismatches as soon as the offending event arrives',()=>{
 for(const key of ['document','frame','popup','origin']){const events=structuredClone(native);events[1][key]=key==='origin'?'https://approved.example.invalid':key[0]+'99';assert.throws(()=>validateLoginPrefix(events.slice(0,2)),{message:'unsupported-login-sequence'});}
 for(const index of [0,1,2]){const events=native.slice(0,index+1);assert.throws(()=>validateLoginPrefix([...events,{...native[index],id:'e99'}]),{message:'unsupported-login-sequence'});}
 assert.throws(()=>validateLoginPrefix([native[0],native[2]]),{message:'unsupported-login-sequence'});
 assert.throws(()=>validateLoginPrefix([...native,{...native[3],id:'e99'}]),{message:'unsupported-login-sequence'});
 const evidence={schema:2,runtime:LEARNING_RUNTIME,origins:[origin],events:[...structuredClone(native),...LEARNING_ROLES.map((role,i)=>({id:'e'+(i+4),role,tag:'text',document:'d1',frame:'f0',popup:'p0',origin}))],complete:true,truncated:false};
 validateEvidence(evidence);evidence.events[0].document='d99';assert.throws(()=>validateEvidence(evidence),{message:'unsupported-login-sequence'});
});
test('closed prefix deliberately preserves inline human submit and same-document dynamic manual success',()=>{
 const manual={id:'e99',role:'login-manual',tag:'text',format:'otp',document:'d0',frame:'f0',popup:'p0',origin};
 validateLoginPrefix([...native.slice(0,2),manual,...native.slice(2)],{complete:true});
 validateLoginPrefix([manual,{...native.at(-1),document:'d0'}],{complete:true});
 validateLoginPrefix([...native.slice(0,3),{...manual,document:'d1'},{...native.at(-1),document:'d1'}],{complete:true});
 assert.throws(()=>validateLoginPrefix([...native.slice(0,2),manual,{...manual,id:'e98'}]),{message:'unsupported-login-sequence'});
});
test('actual local credential cancel and timer expiry through executor remain not-submitted fixed codes',async()=>{
 for(const kind of ['cancel','timeout']){
  const local=new LearningCredentialRequest({timeout:20});let locates=0;
  await assert.rejects(replayLearningLogin(native,{probe:async()=>false,locate:async()=>{locates++;throw Error('unexpected');},credentials:async()=>{const pending=local.request('protected',{identifier:true},'one');if(kind==='cancel')queueMicrotask(()=>local.submit('protected',{id:'one',cancel:true}));return pending;}}),{message:kind==='cancel'?'local-login-input-cancelled':'local-login-input-timeout'});
  assert.equal(locates,0,'no credential write or login click');assert.equal(local.view('protected'),null);
 }
 for(const code of LEARNING_LOGIN_STOP_CODES){assert.ok(learningFailureText(code));assert.ok(!learningFailureText(code).includes('CANARY'));}
 assert.equal(learningFailureText('CANARY-UNTRUSTED'),'');
});

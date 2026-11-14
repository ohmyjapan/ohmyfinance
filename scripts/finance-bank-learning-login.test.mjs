import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LEARNING_RUNTIME,LEARNING_ROLES,stable,validateEvidence,validateRecipe,validateReplay} from '../shared/finance-bank-learning.mjs';
import {projectEvidence} from '../collector/bank-learning-recorder.mjs';
import {LearningCredentialRequest} from '../collector/bank-learning-login.mjs';
const origin='https://fictional.example.invalid',sha=v=>createHash('sha256').update(stable(v)).digest('hex');
export function fixture(manual){
 const roles=[['login-identifier','input'],['login-password','input'],['login-submit','button'],...(manual?[['login-manual','text',manual]]:[]),['login-success','text'],...LEARNING_ROLES.map(role=>[role,['from','to'].includes(role)?'input':'text'])];
 const evidence={schema:2,runtime:LEARNING_RUNTIME,origins:[origin],events:roles.map(([role,tag,format],i)=>({id:'e'+i,document:'d'+(i<3?0:1),frame:'f0',popup:'p0',origin,role,tag,...(format?{format}:{})})),complete:true,truncated:false};
 const evidenceHash=sha(evidence),candidate={schema:2,runtime:LEARNING_RUNTIME,evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};return {evidence,evidenceHash,candidate};
}
test('schema 2 is closed, retains every demonstrated login step, and keeps v1 distinct',()=>{
 const {evidence,evidenceHash,candidate}=fixture();validateRecipe(candidate,evidence,evidenceHash);
 for(const role of ['login-identifier','login-password','login-submit','login-success'])assert.throws(()=>validateRecipe({...candidate,steps:candidate.steps.filter(s=>s.op!==role)},evidence,evidenceHash),/candidate-login-steps-changed/);
 for(const change of [{...candidate,schema:1},{...candidate,steps:[...candidate.steps,{eventId:'e999',op:'transfer'}]}])assert.throws(()=>validateRecipe(change,evidence,evidenceHash));
 for(const mutate of [e=>{e.password='CANARY';},e=>{e.events[0].selector='#canary';},e=>{e.events[0].origin+='/?token=CANARY';},e=>{e.events[0].role='transfer';},e=>{e.events[0].format='CANARY';},e=>{e.events.push(...Array(161).fill(e.events[0]));},e=>{e.schema=1;}]){const e=structuredClone(evidence);mutate(e);assert.throws(()=>validateEvidence(e));}
 const old={...evidence,schema:1,events:evidence.events.filter(e=>!e.role.startsWith('login-'))};validateRecipe({...candidate,schema:1,steps:old.events.map(e=>({eventId:e.id,op:e.role}))},old,evidenceHash);
});
test('projection is a structural allowlist even with credential, OTP, token and text canaries throughout private input',()=>{
 const {evidence}=fixture('otp'),canary='PRIVATE-CANARY-IDENTIFIER-PASSWORD-OTP-TOKEN';
 const record={...evidence,events:evidence.events.map(e=>({...e,value:canary,name:canary,url:origin+'/'+canary+'?token='+canary,text:canary,private:{selector:canary,signature:canary,value:canary,cookie:canary}})),cookies:canary,html:canary};
 const projected=projectEvidence(record);assert.deepEqual(projected,evidence);assert.ok(!stable(projected).includes(canary));
});
test('fresh replay receipts distinguish credentials and explicit OTP/certificate boundaries',()=>{
 for(const manual of [undefined,'otp','certificate','other']){
  const {evidence,candidate,evidenceHash}=fixture(manual),session={evidence,candidate,evidenceHash,candidateHash:sha(candidate),demonstrationPeriod:{from:'2026-10-01',to:'2026-10-02'},replayPeriod:{from:'2026-11-01',to:'2026-11-02'}};
  const receipt={candidateHash:session.candidateHash,evidenceHash,runtime:LEARNING_RUNTIME,period:session.replayPeriod,statementHash:'a'.repeat(64),rows:1,balanceObserved:true,accountMatched:true,loggedOut:true,freshBrowser:true,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),authentication:{outcome:'success',mode:manual?'attended':'local-credentials'}};
  validateReplay(receipt,session);for(const authentication of [undefined,{outcome:'success',mode:manual?'local-credentials':'attended'},{outcome:'failure',mode:'local-credentials'},{...receipt.authentication,secret:'CANARY'}])assert.throws(()=>validateReplay({...receipt,authentication},session));
 }
});
test('local credential request is single-use, session-bound, closed, cancellable, and cleared on lock',async()=>{
 const store=new LearningCredentialRequest(),abort=new AbortController(),pending=store.request('protected-session',{identifier:true,signal:abort.signal},'request-one');
 assert.equal(store.view('other-session'),null);assert.deepEqual(store.view('protected-session'),{id:'request-one',identifier:true});
 for(const [session,input]of [['other-session',{id:'request-one',identifier:'CANARY',password:'CANARY'}],['protected-session',{id:'stale',identifier:'CANARY',password:'CANARY'}],['protected-session',{id:'request-one',identifier:'CANARY',password:'CANARY',otp:'CANARY'}],['protected-session',{id:'request-one',identifier:'CANARY',password:'x'.repeat(1025)}]])assert.throws(()=>store.submit(session,input));
 store.submit('protected-session',{id:'request-one',identifier:'CANARY-ID',password:'CANARY-PASSWORD'});assert.deepEqual(await pending,{identifier:'CANARY-ID',password:'CANARY-PASSWORD'});assert.equal(store.view('protected-session'),null);assert.throws(()=>store.submit('protected-session',{id:'request-one',password:'CANARY'}));
 const locked=store.request('protected-session',{identifier:false,signal:abort.signal},'request-two');abort.abort();await assert.rejects(locked,/login-cancelled/);assert.equal(store.view('protected-session'),null);
 const cancel=store.request('protected-session',{identifier:false},'request-three');store.submit('protected-session',{id:'request-three',cancel:true});await assert.rejects(cancel,/login-cancelled/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatProposal, reusableClassification } from '../shared/finance-chat.mjs';
import { TeachingWorker, teachingOrigin } from '../teaching-worker/worker.mjs';
const context={values:{purpose:'unresolved',customerId:''},customers:[{id:'customer-a',name:'OMJ10'}]};
test('chat proposals require literal current-message evidence and registered identities',()=>{
 const result=validateChatProposal({kind:'proposal',summary:'확인해주세요',patch:{customerId:'customer-a',productName:'코트'},quotes:{customerId:'OMJ10',productName:'코트'}},context,'OMJ10의 코트');
 assert.equal(result.patch.purpose,'customer');assert.ok(reusableClassification(result,result.patch));
 assert.throws(()=>validateChatProposal({...result,patch:{customerId:'unknown'}},context,'OMJ10의 코트'));
 assert.throws(()=>validateChatProposal({...result,patch:{productName:'book'},quotes:{productName:'코트'}},context,'코트'));
 assert.throws(()=>validateChatProposal({...result,patch:{accountCategoryId:'invented'}},context,'OMJ10'));
 assert.throws(()=>validateChatProposal({...result,quotes:{customerId:'a previous reply'}},context,'OMJ10'));
 assert.equal(reusableClassification({kind:'proposal',patch:{productName:'코트'}},{purpose:'company'}),false);
 assert.throws(()=>validateChatProposal({kind:'proposal',summary:'...',patch:{purpose:'customer'},quotes:{purpose:'customer'}},context,'customer'));
});
test('company clears customer and uncertain messages cannot change fields',()=>{
 const p=validateChatProposal({kind:'proposal',summary:'회사 경비',patch:{purpose:'company'},quotes:{purpose:'회사 경비'}},context,'회사 경비');assert.equal(p.patch.customerId,'');
 assert.throws(()=>validateChatProposal({kind:'unclear',summary:'모름',patch:{purpose:'company'},quotes:{purpose:'모름'}},context,'모름'));
});
test('a research request is parsed on proposals and explanations, refused elsewhere, and dropped in general conversation',()=>{
 const text='법인 차량의 충전 요금입니다',instruction=' 법인 차량 충전 요금: 運営会社と勘定科目の候補を調査 ';
 const p=validateChatProposal({kind:'proposal',summary:'会社の費用として整理します。',patch:{purpose:'company',productName:'충전 요금'},quotes:{purpose:'법인 차량',productName:'충전 요금'},research:{instruction}},context,text);
 assert.deepEqual(p.research,{instruction:instruction.trim()});assert.equal(p.patch.customerId,'');
 assert.deepEqual(validateChatProposal({kind:'unclear',summary:'調べます。',patch:{},quotes:{},research:{instruction:'運営会社の確認'}},context,text).research,{instruction:'運営会社の確認'});
 assert.equal(validateChatProposal({kind:'unclear',summary:'説明です。',patch:{},quotes:{}},context,text).research,undefined);
 const unclear=research=>({kind:'unclear',summary:'s',patch:{},quotes:{},research});
 assert.throws(()=>validateChatProposal({kind:'defer',summary:'後で',patch:{},quotes:{},research:{instruction:'x'}},context,text));
 for(const research of ['x',null,['x'],{},{instruction:'  '},{instruction:'x'.repeat(2001)},{instruction:'a\x07b'},{instruction:'x',tools:['mail']},{instruction:5}])assert.throws(()=>validateChatProposal(unclear(research),context,text),JSON.stringify(research));
 assert.equal(validateChatProposal(unclear({instruction:'x'.repeat(2000)}),context,text).research.instruction.length,2000);
 const w=validateChatProposal(unclear({instruction:'x'}),{mode:'workspace'},text);assert.equal(w.research,undefined);assert.deepEqual(Object.keys(w).sort(),['kind','patch','quotes','summary']);
});
test('teaching worker reports a failed interpretation without logging reply text or changing drafts',async()=>{
 const calls=[],logs=[];const worker=new TeachingWorker({baseUrl:'http://100.64.0.1:8080',token:'private'},{request:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return {ok:true,json:async()=>url.endsWith('/workspace-claim')?{job:null}:url.endsWith('/claim')?{job:{id:'job',lease:'lease',text:'private user text'}}:{success:true}}},interpret:async()=>{throw Error('private error')},log:s=>logs.push(s)});
 await worker.cycle();assert.equal(calls.length,3);assert.deepEqual(calls[2].body,{lease:'lease',failed:true});assert.ok(!JSON.stringify(logs).includes('private'));assert.ok(calls.every(c=>c.url.includes('/worker/')));
 for(const url of ['http://example.com','http://user@127.0.0.1','https://example.com/path','https://example.com?token=secret'])assert.throws(()=>teachingOrigin(url));
});

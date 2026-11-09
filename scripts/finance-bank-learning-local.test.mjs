import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {learningStore,flushLearningOutbox,runBankLearning} from '../collector/bank-learning.mjs';
const id='e'.repeat(24),context={origin:'https://omf.example.invalid',installationId:'synthetic-pc',generation:'one'};
const binding={...context,sessionId:id,bankAccountId:'f'.repeat(24)};
test('real Windows DPAPI outbox: secrets stay encrypted, acknowledgements retry without another browser',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-dpapi-')),vault=learningStore(root,id),pending={action:'evidence',body:{claim:'SYNTHETIC-CLAIM-SECRET',evidence:{safe:true}}};
 await vault.update(()=>({binding,pending,record:{private:'PRIVATE-LOCAL-ACCOUNT'}}));
 const bytes=await readFile(vault.file);for(const secret of ['SYNTHETIC-CLAIM-SECRET','PRIVATE-LOCAL-ACCOUNT'])assert.ok(!bytes.includes(Buffer.from(secret)));
 let attempts=0,browsers=0;const remote={learningIdentity:context,learning:async()=>{attempts++;if(attempts===1)throw new Error('synthetic-offline');return {accepted:true};}};
 await assert.rejects(flushLearningOutbox(root,remote,context));assert.ok((await vault.read()).pending);
 await runBankLearning({id,action:'start',remote,root,origin:context.origin,browser:async()=>{browsers++;}});
 assert.equal(attempts,2);assert.equal(browsers,0);assert.equal((await vault.read()).pending,null);
});
test('a reconnect to another OMF origin/generation never receives an old sealed outbox',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-scope-')),vault=learningStore(root,id);await vault.update(()=>({binding,pending:{action:'receipt',body:{claim:'OLD-PRIVATE-CLAIM'}}}));
 let calls=0;await flushLearningOutbox(root,{learning:async()=>{calls++;return {accepted:true};}},{...context,origin:'https://other.example.invalid'});
 assert.equal(calls,0);const retained=await vault.read();assert.equal(retained.pending,null);assert.equal(retained.undelivered.body.claim,'OLD-PRIVATE-CLAIM');
});
test('failed local launch reports failure and releases the bank only after the owned browser closes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'omf-learning-failure-')),calls=[];let closed=false;
 const remote={learningIdentity:context,learning:async route=>{calls.push(route);if(route.endsWith('/start'))return {claim:'SYNTHETIC',nonce:'synthetic',session:{id,installationId:context.installationId,generation:context.generation,bankAccountId:binding.bankAccountId,entryOrigin:'https://bank.example.invalid'}};if(route.endsWith('/finish'))assert.equal(closed,true);return {accepted:true};}};
 await assert.rejects(runBankLearning({id,action:'start',remote,root,origin:context.origin,live:{abort:new AbortController()},browser:async()=>{try{throw new Error('synthetic-browser-failure');}finally{closed=true;}}}),/synthetic-browser-failure/);
 assert.deepEqual(calls,[id+'/start',id+'/failed',id+'/finish']);
});

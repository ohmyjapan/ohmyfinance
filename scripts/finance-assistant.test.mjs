import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantPage,assistantTarget,validateAssistantReply} from '../shared/finance-assistant.mjs';
test('general assistant replies cannot contain draft edits',()=>{const valid={kind:'unclear',summary:'説明です',patch:{},quotes:{}};assert.deepEqual(validateAssistantReply(valid),valid);for(const bad of [{...valid,kind:'proposal'},{...valid,patch:{purpose:'company'}},{...valid,quotes:{purpose:'invented'}},{...valid,summary:''}])assert.throws(()=>validateAssistantReply(bad));});
test('a workspace reply stays an explanation even when actions ran: receipts live on the turn, never in the reply',()=>{const reply={kind:'unclear',summary:'8行目を保存しました（下書き改訂 2）。',patch:{},quotes:{}};assert.deepEqual(validateAssistantReply({...reply,actions:[{name:'save_draft_fields',state:'done'}]}),reply);assert.throws(()=>validateAssistantReply({...reply,kind:'proposal',patch:{taxRate:10},quotes:{taxRate:'10'}}));});
test('restored targets require a valid source identifier and row',()=>{assert.equal(assistantPage('/mapping-draft/abc/2'),'draft');assert.equal(assistantPage('/transactions/upload'),'transactions');assert.equal(assistantPage('/login'),'other');assert.deepEqual(assistantTarget({kind:'draft',importId:'not-an-id',line:2}),{kind:'workspace'});assert.equal(assistantTarget({kind:'draft',importId:'111111111111111111111111',line:2}).kind,'draft');assert.equal(assistantTarget({kind:'draft',importId:'111111111111111111111111',line:-1}).kind,'workspace');});
test('transaction, invoice and calendar pages use explicit company conversations',async()=>{
 assert.equal(assistantPage('/invoices'),'invoices','company-ui:invoice-page');
 assert.equal(assistantPage('/calendar'),'calendar','company-ui:calendar-page');
 const {assistantConversationScope:scope}=await import('../shared/finance-assistant.mjs');
 const a=scope('actor','A','invoices'),b=scope('actor','B','calendar');
 assert.equal(scope('actor','A','transactions').company,true);assert.equal(a.key,scope('actor','A','transactions').key);
 assert.equal(a.company,true);assert.notEqual(a.key,b.key);assert.equal(a.key,scope('actor','A','calendar').key);
 assert.notEqual(a.key,scope('other','A','invoices').key);assert.notEqual(a.key,scope('actor','','invoices').key);
 assert.equal(scope('actor','A','mapping').key,scope('actor','B','dashboard').key);
 assert.equal(scope('actor','A','mapping').company,false);
});

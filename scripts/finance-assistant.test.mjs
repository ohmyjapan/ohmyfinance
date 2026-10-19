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
 // Deliberate 2026-10-20: the dashboard and other normal company pages join the company conversation; owner pages keep theirs.
 assert.equal(scope('actor','A','dashboard').key,a.key,'company-ui:dashboard-company');assert.equal(scope('actor','A','budgets').company,true);
 assert.equal(scope('actor','A','mapping').key,scope('actor','B','learning').key);assert.equal(scope('actor','A','mapping').key,scope('actor','B','intake').key);
 assert.equal(scope('actor','A','mapping').company,false);assert.equal(scope('actor','A','other').company,false);assert.equal(scope('actor','A','connections').company,false);
});
test('company conversations get the longer catalogue-aware reply; the owner workspace reply is 4000 characters with one fixed page link',async()=>{
 const {validateCompanyAssistantReply,assistantFeature}=await import('../shared/finance-assistant.mjs');
 const long={kind:'unclear',summary:'説'.repeat(3000),patch:{},quotes:{}};
 // Deliberate change (plan omf-navi-owner-continuation-20261020): the owner workspace explanation limit is 4000, as in the company reply.
 assert.equal(validateCompanyAssistantReply(long).summary.length,3000);assert.equal(validateAssistantReply(long).summary.length,3000,'general-reply:explanation-4000');
 assert.throws(()=>validateAssistantReply({...long,summary:'x'.repeat(4001)}),'general-reply:limit-4000');
 assert.equal(validateAssistantReply({kind:'unclear',summary:'x'.repeat(800),patch:{},quotes:{}}).summary.length,800);
 // Deliberate change: a fixed catalogue page link is kept; a record id, an unsupported feature, a URL or an extra key is refused.
 assert.deepEqual(validateAssistantReply({kind:'unclear',summary:'s',patch:{},quotes:{},navigation:{feature:'connections'}}).navigation,{feature:'connections'},'general-reply:page-link');
 assert.equal(Object.hasOwn(validateAssistantReply({kind:'unclear',summary:'s',patch:{},quotes:{}}),'navigation'),false,'general-reply:no-link-invented');
 for(const navigation of[{feature:'transactions',transactionId:'a'.repeat(24)},{feature:'authentication'},{feature:'https://evil.example'},{feature:'connections',query:'x'},'connections'])assert.throws(()=>validateAssistantReply({kind:'unclear',summary:'s',patch:{},quotes:{},navigation}),'general-reply:link-refused '+JSON.stringify(navigation));
 assert.throws(()=>validateAssistantReply({kind:'proposal',summary:'s',patch:{purpose:'company'},quotes:{purpose:'s'},navigation:{feature:'connections'}}),'general-reply:still-no-purchase-change');
 assert.equal(assistantFeature('/calendar').disposition,'navi_tool');assert.equal(assistantFeature('/budgets').disposition,'navi_tool');assert.equal(assistantFeature('/transactions/import').disposition,'page_handoff');assert.equal(assistantFeature('/login'),null);
});
test('company replies may carry bounded source citations; general replies never do',async()=>{
 const {validateCompanyAssistantReply}=await import('../shared/finance-assistant.mjs');
 const reply={kind:'unclear',summary:'公表ページでは登録番号が記載されています。',patch:{},quotes:{}},citation={sourceId:'b'.repeat(24),quote:'登録番号 T1234567890123',claim:'公表された登録番号'};
 assert.deepEqual(validateCompanyAssistantReply({...reply,citations:[citation]}).citations,[citation],'company-reply:citations');
 for(const citations of[[{...citation,sourceId:'x'}],[{...citation,verified:true}],Array.from({length:9},()=>citation),'x'])assert.throws(()=>validateCompanyAssistantReply({...reply,citations}),'company-reply:citation-shape');
 assert.throws(()=>validateCompanyAssistantReply({...reply,sourceUrl:'https://evil.example/'}),'company-reply:no-extra-fields');
 assert.equal(Object.hasOwn(validateAssistantReply({...reply,citations:[citation]}),'citations'),false,'general-reply:no-citations');
 assert.equal(validateAssistantReply({kind:'unclear',summary:'x'.repeat(800),patch:{},quotes:{}}).summary.length,800,'general-reply:limit-kept');
});

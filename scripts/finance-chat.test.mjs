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
test('a job with the action catalogue gets its own lease-bound action endpoint; the worker never calls it and a failed final reply is still reported as failed',async()=>{
 const seen=[],calls=[];const tools=[{name:'get_draft',description:'d',inputSchema:{type:'object'}}];
 const worker=new TeachingWorker({baseUrl:'https://omf.example.invalid',token:'private'},{request:async(url,o)=>{calls.push(url.split('/worker/')[1]);return {ok:true,json:async()=>url.endsWith('/workspace-claim')?{job:null}:url.endsWith('/claim')?{job:{id:'0123456789abcdef01234567',lease:'lease',text:'등록해 줘',tools,nextSlot:3,actions:[{name:'save_draft_fields',state:'done'}]}}:{success:true}}},interpret:async(config,job)=>{seen.push(job);throw Error('model final response failed')},log:()=>{}});
 await worker.cycle();assert.equal(seen[0].actionEndpoint,'https://omf.example.invalid/api/finance-chat/worker/0123456789abcdef01234567/actions');assert.equal(seen[0].nextSlot,3);assert.deepEqual(seen[0].tools,tools);
 assert.deepEqual(calls,['workspace-claim','claim','0123456789abcdef01234567/result'],'the worker posts only the result; actions are the model\'s MCP calls');
 const ws=[];const workspace=new TeachingWorker({baseUrl:'http://127.0.0.1:8080',token:'private'},{request:async url=>({ok:true,json:async()=>url.endsWith('/workspace-claim')?{job:{id:'0123456789abcdef01234567',mode:'workspace',lease:'l',text:'t',tools}}:{success:true}}),interpret:async(c,job)=>{ws.push(job);return {kind:'unclear',summary:'done',patch:{},quotes:{}}},log:()=>{}});
 await workspace.cycle();assert.equal(ws[0].actionEndpoint,'http://127.0.0.1:8080/api/finance-chat/worker/workspace/0123456789abcdef01234567/actions');
 const plain=[];const legacy=new TeachingWorker({baseUrl:'http://127.0.0.1:8080',token:'private'},{request:async url=>({ok:true,json:async()=>url.endsWith('/workspace-claim')?{job:null}:url.endsWith('/claim')?{job:{id:'0123456789abcdef01234567',lease:'l',text:'t'}}:{success:true}}),interpret:async(c,job)=>{plain.push(job);return {kind:'unclear',summary:'done',patch:{},quotes:{}}},log:()=>{}});
 await legacy.cycle();assert.equal(Object.hasOwn(plain[0],'actionEndpoint'),false,'a job without tools stays as before');
});
test('the interpreter exposes tools through the owned MCP server only and keeps the receipts out of the model input except as completed actions',async()=>{
 const {interpreterInput,systemFor,chatSystem}=await import('../teaching-worker/interpreter.mjs');
 const context={source:{description:'Synthetic shop',purchaseDate:'2026-08-05',amount:1980,account:{name:'Synthetic Amex'}},values:{purpose:'unresolved',customerId:'',productName:''},mapping:null,study:{},customers:[],messages:[]};
 const plain=interpreterInput({context,text:'t'});assert.equal(Object.hasOwn(plain,'referencedProposals'),false);assert.equal(Object.hasOwn(plain,'completedActions'),false);
 const tooled=interpreterInput({context,text:'t',tools:[{name:'get_draft'}],references:[{kind:'chat',hash:'h',snapshot:{summary:'s',patch:{purpose:'company'}}}],actions:[{operationId:'op',name:'save_draft_fields',state:'done',target:{importId:'i',line:2},requestedFields:['taxRate'],acceptedRevision:3,safeError:null}]});
 assert.deepEqual(tooled.referencedProposals,[{kind:'chat',snapshot:{summary:'s',patch:{purpose:'company'}}}],'the model sees what was displayed, never the hash or ids');
 assert.deepEqual(tooled.completedActions,[{name:'save_draft_fields',state:'done',target:{importId:'i',line:2},requestedFields:['taxRate'],acceptedRevision:3,safeError:null}]);
 assert.equal(Object.hasOwn(tooled,'tools'),false,'tools reach the model through MCP, not the input');
 const workspace=interpreterInput({context:{mode:'workspace',pageName:'p',facts:{},capabilities:[],messages:[]},text:'t',tools:[{name:'get_draft'}],target:{importId:'i'}});assert.deepEqual(workspace.selectedStatement,{importId:'i'});assert.equal(Object.hasOwn(workspace,'research'),false);
 assert.equal(systemFor({}),chatSystem);assert.ok(chatSystem.includes('You have no tools or access beyond the supplied context.'));
 const withTools=systemFor({tools:[{name:'get_draft'}]});assert.ok(!withTools.includes('You have no tools'));assert.ok(!withTools.includes('never claim chat can apply them'));assert.ok(withTools.includes('omf_actions'));assert.ok(withTools.includes('post_selected_approved_rows only when the user explicitly orders the ledger posting'));assert.ok(withTools.startsWith(chatSystem.slice(0,80)),'the accountant role is kept');
 const company=systemFor({companyScoped:true,mode:'workspace',tools:[{name:'list_company_invoices'}]});
 assert.ok(company.startsWith(chatSystem.slice(0,80)));assert.ok(company.includes("each record's saved currency"),'company-ui:saved-currency');
 assert.ok(!company.includes('Amounts are Japanese yen'));assert.ok(!company.includes('post_selected_approved_rows'));assert.ok(company.includes('list_company_calendar_entries'));
 assert.ok(company.includes('not fresh NTA verification'));assert.ok(company.includes('not a bank settlement check'));assert.ok(company.includes('no bank balance, money movement'));assert.ok(company.includes('update_company_calendar_entry'));assert.ok(company.includes('update_company_invoice'));assert.ok(company.includes('update_company_transaction'));assert.ok(company.includes('list_company_transaction_choices'));assert.ok(company.includes('A question or hypothetical suggestion saves nothing'));assert.ok(company.includes('get_company_action_status'));
 assert.ok(withTools.includes('Amounts are Japanese yen (JPY)'));assert.equal(systemFor({companyScoped:true}),chatSystem);
});

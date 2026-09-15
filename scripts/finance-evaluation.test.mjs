import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyValues} from '../shared/finance-draft.mjs';
import {evaluationContext,validateEvaluationCase,scoreEvaluation,evaluationSummary} from '../shared/finance-evaluation.mjs';
import {ResearchWorker} from '../research-worker/worker.mjs';
const source={purchaseDate:'2026-04-01',description:'Synthetic shop',amount:4200,account:{id:'111111111111111111111111',name:'Synthetic card'},purpose:'hidden-answer',clientCode:'hidden-answer',reason:'hidden-answer',sheet:'hidden-answer'};
const draft={source,values:{...emptyValues(source),productName:'hidden-answer',purpose:'company'},evidence:{productName:{state:'confirmed',source:'user'}},history:['hidden-answer'],references:{suppliers:[{_id:'222222222222222222222222',name:'Synthetic supplier',metadata:{invoiceVerification:'hidden-answer'},invoiceNumber:'hidden-answer'}]},documents:[{id:'333333333333333333333333',hash:'a'.repeat(64),name:'receipt.pdf',mimeType:'application/pdf'}]};
const body=()=>({title:'hidden-answer',instruction:'Identify the requested purchase fields.',confirm:true,questionPolicy:'ungraded',expectations:[{field:'productName',mode:'value',value:'hidden-answer',alternatives:[],basis:'past_decision',note:'hidden-answer'}],knownFields:['purpose'],requiredSources:[]});
test('evaluation input excludes answers, teaching history, derived source fields and supplier verification',()=>{
 const definition=validateEvaluationCase(body(),draft),context=evaluationContext(draft,definition);
 assert.equal(JSON.stringify(context).includes('hidden-answer'),false);
 assert.equal(context.values.purpose,'company');assert.equal(context.source.amount,4200);assert.equal(context.documents[0].id,draft.documents[0].id);
 assert.deepEqual(context.evaluationTargets,['productName']);assert.deepEqual(Object.keys(context.references.suppliers[0]).sort(),['_id','name','parentId']);
});
test('scored fields cannot be supplied inputs; past decisions need exact explicit confirmation',()=>{
 assert.throws(()=>validateEvaluationCase({...body(),knownFields:['productName']},draft));
 for(const evidence of [{},{productName:{state:'suggested',source:'user'}},{productName:{state:'confirmed',source:'research'}}])assert.throws(()=>validateEvaluationCase(body(),{...draft,evidence}));
 const b=body();b.expectations[0].value='different';assert.throws(()=>validateEvaluationCase(b,draft));
});
test('document references, empty positive answers, unsupported references and ambiguous purpose are rejected',()=>{
 for(const change of [{basis:'document',documentId:'444444444444444444444444'},{basis:'owner_confirmed',value:''},{field:'purpose',basis:'owner_confirmed',value:'unresolved'},{field:'supplierId',basis:'owner_confirmed',value:'444444444444444444444444'}]){const b=body();b.knownFields=[];Object.assign(b.expectations[0],change);assert.throws(()=>validateEvaluationCase(b,draft))}
});
test('scores distinguish wrong, missing, correct alternatives and unsupported extra answers',()=>{
 const expectations=[{field:'receiptNumber',mode:'value',value:'#123',alternatives:['123'],basis:'document',documentId:draft.documents[0].id},{field:'taxRate',mode:'value',value:10,alternatives:[],basis:'document',documentId:draft.documents[0].id},{field:'companyInfo',mode:'value',value:'Synthetic Co',alternatives:[],basis:'past_decision'},{field:'purpose',mode:'abstain',basis:'owner_confirmed'},{field:'customerId',mode:'abstain',basis:'owner_confirmed'}];
 const report={findings:[{field:'receiptNumber',value:'１２３'},{field:'taxRate',value:8},{field:'purpose',value:'unresolved'},{field:'customerId',value:'222222222222222222222222'},{field:'notes',value:'unscored'}],question:'Who purchased this?'};
 const score=scoreEvaluation({expectations,requiredSources:['mail','document'],questionPolicy:'unnecessary'},report,[{kind:'document',documentId:draft.documents[0].id}]);
 assert.deepEqual(score.fields.map(f=>f.status),['match','different','missing','match','unexpected_answer']);assert.deepEqual(score.sourceChecks.map(s=>s.present),[false,true]);assert.equal(score.documentChecks.length,1);assert.equal(score.documentChecks[0].present,true);assert.equal(score.question.status,'unnecessary');assert.deepEqual(score.unscoredFields,['notes']);
 const sum=evaluationSummary([{state:'complete',score},{state:'failed'},{state:'queued'}]);assert.equal(sum.total,3);assert.equal(sum.complete,1);assert.equal(sum.failed,1);assert.equal(sum.pending,1);assert.equal(sum.matched,2);assert.equal(sum.byBasis.document.total,2);assert.equal(sum.sourceMissing,1);assert.equal(sum.questionsUnnecessary,1);
});
test('question check measures presence only and never grades unspecified questions',()=>{
 for(const [policy,question,status] of [['ungraded','why?','ungraded'],['required','','missing'],['required','why?','match'],['unnecessary','','match']])assert.equal(scoreEvaluation({expectations:[],requiredSources:[],questionPolicy:policy},{findings:[],question},[]).question.status,status);
});
test('worker only polls evaluations after the regular research queue is empty',async()=>{
 const worker=new ResearchWorker({baseUrl:'http://127.0.0.1:8080'},'.'),routes=[];
 worker.api=async route=>{routes.push(route);return {job:null}};
 assert.equal(await worker.cycle(),false);assert.deepEqual(routes,['claim','evaluation/claim']);
 routes.length=0;worker.api=async route=>{routes.push(route);throw Error('regular queue unavailable')};await assert.rejects(worker.cycle());assert.deepEqual(routes,['claim']);
});

test('evaluation document reading captures text without uploading original receipt artifacts',async t=>{
 const {ResearchTools}=await import('../research-worker/tools.mjs');
 let uploads=0;t.mock.method(globalThis,'fetch',async()=>{uploads++;throw Error('Unexpected artifact upload')});
 const tools=new ResearchTools({baseUrl:'http://127.0.0.1:8080'},{id:'evaluation',mode:'evaluation',sources:[],context:{documents:[]}},'.',{extract:async()=>({pages:[{page:1,text:'Synthetic receipt 123'}],records:[]})});tools.persist=async()=>{};
 const source=await tools.document(Buffer.from('synthetic'),'application/pdf','Synthetic receipt');assert.equal(source.kind,'document');assert(source.text.includes('Synthetic receipt 123'));assert.equal(uploads,0);
});

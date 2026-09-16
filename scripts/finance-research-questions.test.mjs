import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {questionGuidance,hasSettledQuestion,questionContract} from '../research-worker/question-guidance.mjs';
import {ResearchWorker,researchSystem} from '../research-worker/worker.mjs';
import {searchReviewSchema,validateSearchReview} from '../research-worker/search-review.mjs';
import {validateDiagnostic,validationFeedback} from '../shared/finance-research.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';

const customer='1'.repeat(24),source={kind:'expense',description:'Synthetic shop',purchaseDate:'2026-04-01'};
const makeContext=()=>({source,values:{...emptyValues(source),purpose:'customer',customerId:customer},references:{customers:[{_id:customer,name:'Synthetic customer'}]},mapping:{fields:[{key:'purpose',value:'customer',evidence:{state:'confirmed',source:'chat',reason:'Confirmed in conversation'}},{key:'customerId',value:customer,evidence:{state:'confirmed',source:'user'}}]}});
const proof=c=>{const text=JSON.stringify(c);return {id:'s0',kind:'context',text,title:'Synthetic current context',url:'',hash:createHash('sha256').update(text).digest('hex'),capturedAt:new Date().toISOString()}};
const report={summary:'The purchase item is unknown.',question:'Is this for the customer, and which item did you buy?',supplier:null,findings:[]};
const issue={path:'question',quote:'Is this for the customer',sourceIds:['s0'],explanation:'The current purchase purpose is already confirmed as customer.'};
const edits={summary:report.summary,question:'Which item did you buy?',findings:[]};

test('current confirmed answers are available without changing input or reading old lessons',()=>{
 const c=makeContext(),before=structuredClone(c),g=questionGuidance(c);assert.deepEqual(g.settled.map(x=>x.field),['purpose','customerId']);assert(g.unsettledFields.includes('productName'));assert(g.unsettledFields.includes('invoiceNumber'));assert(!g.unsettledFields.includes('purpose'));assert.deepEqual(c,before);assert(researchSystem.includes(questionContract));
 c.lessons=[{values:{productName:'Old purchase'}}];c.history=[{productName:'Old answer'}];assert.deepEqual(questionGuidance(c),g);assert(hasSettledQuestion(report,g));assert(!hasSettledQuestion({...report,question:''},g));
});
test('stale values, unaccepted suggestions, unresolved customers and conflicts do not settle questions',()=>{
 for(const state of ['suggested','conflict','missing']){const c=makeContext();c.mapping.fields.forEach(f=>f.evidence.state=state);assert.deepEqual(questionGuidance(c).settled,[])}
 const c=makeContext();c.mapping.fields[0].value='company';c.references.customers=[];assert.deepEqual(questionGuidance(c).settled,[]);
 const conflict=makeContext();conflict.mapping.fields[1].evidence.state='conflict';assert.deepEqual(questionGuidance(conflict).settled,[]);
});
test('approved teachings must still be applicable, consistent and effective for this purchase',()=>{
 const c=makeContext();c.mapping.fields.forEach(f=>f.evidence={state:'suggested',source:'learning_rule',grade:'A'});c.study={learning:{rules:[{decision:{purpose:'customer',customerId:customer,effectiveFrom:'2026-03-01'}}]}};
 assert.equal(questionGuidance(c).settled.length,2);assert(questionGuidance(c).settled.every(x=>x.basis==='applicable_approved_teaching'));
 for(const rules of [[],[{decision:{purpose:'company',customerId:''}}],[{decision:{purpose:'customer',customerId:customer,effectiveFrom:'2026-05-01'}}],[...c.study.learning.rules,{decision:{purpose:'company'}}]]){assert.deepEqual(questionGuidance({...c,study:{learning:{rules}}}).settled,[])}
});
test('frozen evaluation inputs expose neither hidden target answers nor target-row history',()=>{
 const c=makeContext();c.evaluationTargets=['customerId'];c.mapping.fields[0].evidence.state='conflict';c.mapping.purchaseAccountingReview={response:{note:'Hidden contract note'}};const g=questionGuidance(c);
 assert.deepEqual(g.settled.map(x=>x.field),['purpose']);assert.equal(g.savedAccountingExplanation,'');assert.equal(g.settled[0].basis,'provided_input');
 c.values.customerId='2'.repeat(24);c.mapping.fields=[];c.history=['hidden'];assert.deepEqual(questionGuidance(c),g);
});
test('current saved accounting explanations are retained but conflicting context excludes them',()=>{
 const c=makeContext();c.mapping.purchaseAccountingReview={response:{note:'Current owner-confirmed recurring service.'}};assert.equal(questionGuidance(c).savedAccountingExplanation,'Current owner-confirmed recurring service.');
 c.mapping.fields[0].evidence.state='conflict';assert.equal(questionGuidance(c).savedAccountingExplanation,'');
});
test('question review feedback must cite context and quote the actual repeated question',()=>{
 const c=makeContext(),g=questionGuidance(c),sources=[proof(c)];assert.equal(validateSearchReview({issues:[issue]},report,sources,g).length,1);
 assert(searchReviewSchema(report,sources,g).properties.issues.items.properties.sourceIds.items.enum.includes('s0'));
 for(const change of [{path:'summary',quote:report.summary},{quote:'Invented question'},{sourceIds:['unknown']}])assert.throws(()=>validateSearchReview({issues:[{...issue,...change}]},report,sources,g));
 assert.throws(()=>validateSearchReview({issues:[issue]},report,sources));assert.throws(()=>validateSearchReview({issues:[issue]},{...report,question:''},sources,g));
 assert.equal(validateDiagnostic({code:'question_repeated',correctionAttempted:true}).code,'question_repeated');assert.equal(validationFeedback({code:'question_repeated',issues:[issue]}).issues[0].quote,issue.quote);
});

async function run(t,responses,{context=makeContext(),initial=report,mode='research'}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-question-review-'));t.after(async()=>{if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-question-review-'))throw Error('Unsafe temporary directory');await fs.rm(dir,{recursive:true,force:true})});
 const sources=[proof(context)],job={id:'synthetic-job',mode,lease:'test',context,sources,instruction:'Identify missing purchase details.'},calls=[];let result;
 const worker=new ResearchWorker({baseUrl:'http://127.0.0.1:8080',cliPath:'unused',inferenceDirectory:dir},dir,{log:()=>{},invokeInterpreter:async(cli,args,options,payload)=>{
  calls.push(payload);assert.deepEqual(payload.questionGuidance,questionGuidance(context));assert.deepEqual(JSON.parse(await fs.readFile(path.join(path.dirname(options.env.OMF_RESEARCH_JOB_FILE),'question-guidance.json'),'utf8')),payload.questionGuidance);
  if(calls.length>1)assert.equal(args[args.indexOf('--tools')+1],'');const value=calls.length===1?initial:responses.shift();assert.notEqual(value,undefined,'Unexpected interpreter call');if(value instanceof Error)throw value;return JSON.stringify({structured_output:value,modelUsage:{synthetic:{}}});
 }});
 worker.api=async(route,body)=>{if(route==='claim')return {job:mode==='research'?job:null};if(route==='evaluation/claim')return {job};if(route.endsWith('/result'))result=body;return {success:true}};
 await worker.cycle();assert(result);assert.equal(responses.length,0);return {result,calls};
}
for(const mode of ['research','evaluation'])test(mode+' removes a repeated clause, retains the missing item question and rechecks it',async t=>{
 const context=makeContext();if(mode==='evaluation')context.evaluationTargets=['productName'];const {result,calls}=await run(t,[{issues:[issue]},edits,{issues:[]}],{mode,context});
 assert.equal(result.failed,undefined);assert.equal(result.report.question,edits.question);assert.deepEqual(result.report.findings,[]);assert.equal(calls.length,4);assert.equal(calls[2].validationFeedback.code,'question_repeated');
});
test('a fully answered question may become empty without changing proposals or evidence',async t=>{
 const c=makeContext(),initial={...report,question:'Is this for the customer?',findings:[{field:'productName',valueJson:'"Synthetic item"',basis:'reasoned',reason:'Synthetic hypothesis.',citations:[{sourceId:'s0',quote:'Synthetic shop'}]}]},fixed={summary:initial.summary,question:'',findings:[{field:'productName',action:'keep',reason:initial.findings[0].reason}]};
 const {result,calls}=await run(t,[{issues:[issue]},fixed],{context:c,initial});assert.equal(result.failed,undefined);assert.equal(calls.length,3);assert.equal(result.report.question,'');assert.deepEqual(result.report.findings,initial.findings);assert.deepEqual(result.sources,[proof(c)].map((s,i)=>({...s,capturedAt:result.sources[i].capturedAt})));
});
test('persistent duplicate questions fail with evidence and no proposal',async t=>{
 const {result}=await run(t,[{issues:[issue]},{...edits,question:report.question},{issues:[issue]}]);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.deepEqual(result.diagnostic,{code:'question_repeated',correctionAttempted:true});
});
test('unanswered details are retained, including questions with no settled input',async t=>{
 const {result}=await run(t,[{issues:[]}],{initial:{...report,question:edits.question}});assert.equal(result.report.question,edits.question);
 const c=makeContext();c.mapping.fields=[];const r=await run(t,[],{context:c});assert.equal(r.result.report.question,report.question);assert.equal(r.calls.length,1);
});
test('malformed review and timeouts cannot deliver unchecked questions',async t=>{
 for(const response of [{issues:[{...issue,quote:'not in report'}]},Error('Research timed out')]){const {result}=await run(t,[response]);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.equal(result.diagnostic.correctionAttempted,false)}
});

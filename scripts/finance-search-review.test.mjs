import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ResearchWorker} from '../research-worker/worker.mjs';
import {reportProse,hasSearchEvidence,validateSearchReview,validateScopeRepair,scopeRepairSchema,applyScopeRepair,scopeRepairSystem} from '../research-worker/search-review.mjs';
import {validateDiagnostic,validationFeedback} from '../shared/finance-research.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';
const report={summary:'The transaction is not recorded in the ledger. The export is incomplete.',question:'',findings:[],supplier:null};
const source=(kind,text,id='s0')=>({id,kind,text,title:'Synthetic evidence',url:'',hash:createHash('sha256').update(text).digest('hex'),capturedAt:new Date().toISOString()});
const context={source:{purchaseDate:'2026-04-10'},values:emptyValues({purchaseDate:'2026-04-10',description:'Synthetic'}),references:{}};
const sources=[source('context',JSON.stringify(context)),source('spreadsheet',JSON.stringify({matchCount:0,exportMode:'google_query_csv',limitation:'Mixed-type cells may be omitted.'}),'s1')];
const issue={path:'summary',quote:'The transaction is not recorded in the ledger.',sourceIds:['s1'],explanation:'No matches in an incomplete export cannot establish absence.'};
const wordingEdits=r=>({summary:r.summary,question:r.question,findings:r.findings.map(f=>({field:f.field,action:'keep',reason:f.reason}))});
const output=value=>JSON.stringify({structured_output:value,modelUsage:{'synthetic-model':{}}});
test('review feedback must quote actual report prose and captured search sources',()=>{
 assert.equal(validateSearchReview({issues:[issue]},report,sources).length,1);
 assert.equal(hasSearchEvidence(sources),true);assert.equal(hasSearchEvidence([source('document','Receipt')]),false);
 for(const changed of [{path:'__proto__'},{path:'findings.0.valueJson'},{quote:'Invented quote'},{sourceIds:['missing']},{sourceIds:['s0']},{explanation:''}])assert.throws(()=>validateSearchReview({issues:[{...issue,...changed}]},report,sources));
 assert.throws(()=>validateSearchReview({issues:[],hidden:true},report,sources));
 assert.deepEqual(reportProse(report),{summary:report.summary,question:''});
 assert.equal(validationFeedback({code:'search_scope_invalid',issues:[issue]}).issues[0].quote,issue.quote);
 for(const code of ['search_scope_invalid','search_review_failed'])assert.equal(validateDiagnostic({code,correctionAttempted:false}).code,code);
});
test('scope repair can revise reasons or withdraw findings but cannot alter accounting values or citations',()=>{
 const before={...report,findings:[{field:'purpose',valueJson:'"customer"',basis:'reasoned',reason:'A reason',citations:[{sourceId:'s1',quote:'Evidence'}]}]};
 validateScopeRepair(before,{...before,findings:[{...before.findings[0],reason:'Qualified reason'}]});validateScopeRepair(before,report);
 for(const changed of [{valueJson:'"company"'},{basis:'literal'},{citations:[{sourceId:'s1',quote:'Other'}]}])assert.throws(()=>validateScopeRepair(before,{...before,findings:[{...before.findings[0],...changed}]}),{code:'search_scope_invalid'});
});
async function runScenario(t,responses,{initial=report,evidence=sources,jobContext=context}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-search-review-')),calls=[],deliveries=[];
 t.after(async()=>{if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-search-review-'))throw Error('Unsafe temporary path');await fs.rm(dir,{recursive:true,force:true})});
 const job={id:'synthetic-job',mode:'evaluation',lease:'synthetic-lease',context:jobContext,sources:evidence.slice(0,1),instruction:'Synthetic test only'};
 const worker=new ResearchWorker({baseUrl:'http://100.79.23.111:8080',cliPath:'unused',inferenceDirectory:dir},dir,{log:()=>{},invokeInterpreter:async(cli,args,options,payload,timeout)=>{
  calls.push({args,payload,timeout});assert(timeout>0&&timeout<=420000);
  if(calls.length===1){await fs.writeFile(path.join(path.dirname(options.env.OMF_RESEARCH_JOB_FILE),'evidence.json'),JSON.stringify({sources:evidence,registry:null}));return output(initial)}
  assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');
  const result=responses.shift();assert.notEqual(result,undefined,'Unexpected interpreter call');if(result instanceof Error)throw result;return output(result);
 }});
 worker.api=async(route,body)=>{if(route==='claim')return {job:null};if(route==='evaluation/claim')return {job};if(route.endsWith('/result'))deliveries.push(body);return {success:true}};
 assert.equal(await worker.cycle(),true);assert.equal(deliveries.length,1);assert.equal(responses.length,0);return {calls,result:deliveries[0],dir};
}
test('flagged wording is repaired once and rechecked before delivery',async t=>{
 const fixed={...report,summary:'No matching transaction was found in the returned rows. The original ledger remains unverified.'};
 const {calls,result}=await runScenario(t,[{issues:[issue]},wordingEdits(fixed),{issues:[]}]);
 assert.equal(calls.length,4);assert.equal(calls[2].payload.validationFeedback.code,'search_scope_invalid');assert.equal(calls[3].payload.report.summary,fixed.summary);assert.equal(result.report.summary,fixed.summary);assert.equal(result.failed,undefined);assert.deepEqual(result.runtime.models,['synthetic-model']);assert(/^[a-f0-9]{64}$/.test(result.runtime.promptHash));
});
test('persistent overstatement fails without sending a report or score',async t=>{
 const {result,calls}=await runScenario(t,[{issues:[issue]},wordingEdits(report),{issues:[issue]}]);
 assert.equal(calls.length,4);assert.equal(result.failed,true);assert.deepEqual(result.diagnostic,{code:'search_scope_invalid',correctionAttempted:true});assert.equal(result.report,undefined);assert.equal(result.score,undefined);assert.equal(result.sources.length,2);
});
test('malformed reviewer output fails closed without asking the writer to repair it',async t=>{
 const {result,calls}=await runScenario(t,[{issues:[{...issue,quote:'not in report'}]}]);
 assert.equal(calls.length,2);assert.equal(result.failed,true);assert.deepEqual(result.diagnostic,{code:'search_review_failed',correctionAttempted:false});
});
test('review timeout remains a timeout and cannot bypass review',async t=>{
 const {result}=await runScenario(t,[Error('Research timed out')]);assert.equal(result.failed,true);assert.equal(result.diagnostic.code,'timed_out');
});
test('receipt-only reports skip search review',async t=>{
 const {result,calls}=await runScenario(t,[],{evidence:[sources[0],source('document','Synthetic printed receipt','s1')]});assert.equal(calls.length,1);assert.equal(result.failed,undefined);
});
test('structural correction consumes the same one-repair allowance and still receives scope review',async t=>{
 const initial={...report,findings:[{field:'purpose',valueJson:'"business"',reason:'Generic purpose',basis:'reasoned',citations:[{sourceId:'s1',quote:'Mixed-type cells may be omitted.'}]}]};
 const {result,calls}=await runScenario(t,[report,{issues:[]}],{initial});assert.equal(calls.length,3);assert.equal(calls[1].payload.validationFeedback.code,'purpose_invalid');assert.equal(result.failed,undefined);
});
test('scope correction cannot smuggle a new mapping proposal into delivery',async t=>{
 const initial={...report,findings:[{field:'purpose',valueJson:'"customer"',reason:'Synthetic reason',basis:'reasoned',citations:[{sourceId:'s1',quote:'Mixed-type cells may be omitted.'}]}]};
 const changed={...initial,findings:[{...initial.findings[0],valueJson:'"company"'}]};
 const {result}=await runScenario(t,[{issues:[issue]},changed],{initial});assert.equal(result.failed,true);assert.equal(result.diagnostic.code,'search_scope_invalid');assert.equal(result.report,undefined);
});

const proposed={...report,findings:[{field:'purpose',valueJson:'"customer"',reason:'Synthetic reason',basis:'reasoned',citations:[{sourceId:'s1',quote:'Mixed-type cells may be omitted.'}]}],supplier:null};
test('wording edits preserve exact evidence and supplier, return detached data, and allow explicit withdrawal',()=>{
 const before={...proposed,supplier:{shopName:'Synthetic',legalName:'Synthetic Corporation',invoiceNumber:'',citations:[{sourceId:'s1',quote:'Synthetic Corporation'}]}},snapshot=structuredClone(before),edits=wordingEdits(before);
 edits.summary='Only returned evidence was inspected.';edits.findings[0].reason='A qualified inference.';
 const after=applyScopeRepair(before,edits);assert.deepEqual(before,snapshot);assert.deepEqual(after.findings[0],{...before.findings[0],reason:'A qualified inference.'});assert.deepEqual(after.supplier,before.supplier);
 after.findings[0].citations[0].quote='Changed locally';after.supplier.legalName='Changed locally';assert.deepEqual(before,snapshot);
 edits.findings[0]={field:'purpose',action:'withdraw',reason:''};assert.deepEqual(applyScopeRepair(before,edits).findings,[]);
 assert.deepEqual(applyScopeRepair(report,wordingEdits(report)),report);
});
test('wording edit parser rejects extra fields, omissions, duplicates, unknown fields, invalid actions and malformed text',()=>{
 const edits=wordingEdits(proposed),pair={...proposed,findings:[...proposed.findings,{...proposed.findings[0],field:'productName',valueJson:'"Synthetic"'}]};
 const invalid=[null,[],{...edits,supplier:null},{...edits,question:undefined},{...edits,summary:'x'.repeat(601)},{...edits,question:'x'.repeat(301)},{...edits,summary:'bad'+String.fromCharCode(0)}, {...edits,findings:[]},...[
  {field:'missing'},{action:'replace'},{reason:''},{reason:'x'.repeat(1201)},{reason:42},{valueJson:'"company"'},{basis:'literal'},{citations:[]}
 ].map(change=>({...edits,findings:[{...edits.findings[0],...change}]}))];
 for(const value of invalid)assert.throws(()=>applyScopeRepair(proposed,value),{code:'search_scope_invalid'});
 assert.throws(()=>applyScopeRepair(pair,{...edits,findings:[edits.findings[0],edits.findings[0]]}),{code:'search_scope_invalid'});
 assert.throws(()=>applyScopeRepair(report,edits),{code:'search_scope_invalid'});
});
test('worker requests wording-only output and rechecks it with original citations and values',async t=>{
 const fixed={...wordingEdits(proposed),summary:'Only the returned rows were inspected.'};fixed.findings[0].reason='A purchase pattern within returned rows.';
 const {calls,result}=await runScenario(t,[{issues:[issue]},fixed,{issues:[]}],{initial:proposed});
 assert.equal(result.failed,undefined);assert.deepEqual(result.report.findings[0].citations,proposed.findings[0].citations);assert.equal(result.report.findings[0].valueJson,proposed.findings[0].valueJson);
 assert.deepEqual(JSON.parse(calls[2].args[calls[2].args.indexOf('--json-schema')+1]),scopeRepairSchema(proposed));assert.equal(calls[2].args[calls[2].args.indexOf('--system-prompt')+1],scopeRepairSystem);
 assert.equal(calls[3].payload.report['findings.0.reason'],fixed.findings[0].reason);
});
test('worker rejects a citation smuggled into wording edits before delivery or another model call',async t=>{
 const edits=wordingEdits(proposed);edits.findings[0].citations=[{sourceId:'s1',quote:'Other'}];
 const {result,calls}=await runScenario(t,[{issues:[issue]},edits],{initial:proposed});assert.equal(calls.length,3);assert.equal(result.failed,true);assert.equal(result.diagnostic.code,'search_scope_invalid');assert.equal(result.report,undefined);
});
test('withdrawing purpose cannot leave an invalid customer proposal',async t=>{
 const customer='111111111111111111111111',jobContext={...context,references:{customers:[{_id:customer}]}},initial={...proposed,findings:[...proposed.findings,{field:'customerId',valueJson:JSON.stringify(customer),reason:'Synthetic customer',basis:'reasoned',citations:proposed.findings[0].citations}]};
 const edits=wordingEdits(initial);edits.findings[0]={field:'purpose',action:'withdraw',reason:''};
 const {result,calls}=await runScenario(t,[{issues:[issue]},edits],{initial,jobContext});assert.equal(calls.length,3);assert.equal(result.failed,true);assert.equal(result.diagnostic.code,'purpose_customer_conflict');assert.equal(result.report,undefined);
});

test('withdrawing every unsupported finding is allowed and reviewed again',async t=>{
 const edits=wordingEdits(proposed);edits.findings[0].action='withdraw';edits.findings[0].reason='';edits.summary='The returned rows do not support a proposal.';
 const {result,calls}=await runScenario(t,[{issues:[issue]},edits,{issues:[]}],{initial:proposed});assert.equal(calls.length,4);assert.equal(result.failed,undefined);assert.deepEqual(result.report.findings,[]);assert.equal(calls[3].payload.report['findings.0.reason'],undefined);
});

test('a full-report correction cannot consume a second correction for search wording',async t=>{
 const initial={...report,findings:[{...proposed.findings[0],valueJson:'"business"'}]};
 const {result,calls}=await runScenario(t,[report,{issues:[issue]}],{initial});assert.equal(calls.length,3);assert.equal(result.failed,true);assert.equal(result.diagnostic.code,'search_scope_invalid');assert.equal(result.report,undefined);
});

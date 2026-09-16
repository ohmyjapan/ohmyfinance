import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {emptyValues} from '../shared/finance-draft.mjs';
import {validateReport} from '../shared/finance-research.mjs';
import {evidenceRepairPlan,evidenceRepairSchema,evidenceRepairSystem,applyEvidenceRepair} from '../research-worker/evidence-repair.mjs';
import {ResearchWorker} from '../research-worker/worker.mjs';

const context={values:emptyValues({description:'Synthetic store',purchaseDate:'2026-04-01'}),references:{}};
const source=(id,kind,text)=>({id,kind,text,title:'Synthetic evidence',url:'',hash:createHash('sha256').update(text).digest('hex'),capturedAt:'2026-04-02T00:00:00.000Z'});
const sources=[source('s0','context',JSON.stringify(context)),source('s1','web','Synthetic Co T1234567890123 Table'),source('s2','document','Table tax 10%'),source('s3','spreadsheet','Returned example: Table 10%')];
const cite=(sourceId,quote)=>({sourceId,quote});
const finding=(field,value,proof)=>({field,valueJson:JSON.stringify(value),basis:'literal',reason:'Captured evidence supports this proposal.',citations:[proof]});
const valid=finding('companyInfo','Synthetic Co',cite('s1','Synthetic Co'));
const report={summary:'Review the purchase.',question:'',findings:[valid,finding('taxRate',10,cite('s3','10%'))],supplier:{shopName:'Synthetic',legalName:'Synthetic Co',invoiceNumber:'T1234567890123',citations:[cite('s1',sources[1].text)]}};
const edits=r=>({summary:'The percentage remains unresolved without purchase evidence.',question:'',findings:r.findings.map(f=>({field:f.field,action:f.field==='taxRate'?'withdraw':'keep',reason:f.reason})),repairs:[],supplierAction:'keep'});
const apply=(r,e,ss=sources)=>applyEvidenceRepair(r,e,evidenceRepairPlan(r,context,ss),context,ss);

test('evidence planning identifies multiple isolated failures and leaves the report untouched',()=>{
 const r=structuredClone(report);r.findings.push(finding('productName','Table',cite('s1','Invented quotation')));r.supplier.citations=[cite('s1','Invented supplier')];const before=structuredClone(r);
 assert.deepEqual(evidenceRepairPlan(r,context,sources).issues.map(i=>i.target),['taxRate','productName','supplier']);assert.deepEqual(r,before);
 assert.throws(()=>validateReport(r,context,sources),{code:'finding_evidence_invalid',target:'taxRate'});
 assert.equal(evidenceRepairPlan({...report,findings:[valid]},context,sources),null);
});

test('structural errors and purpose dependencies do not enter isolated evidence repair',()=>{
 for(const findings of [[{...valid,field:'unknown'}],[{...valid,valueJson:'not json'}],[valid,valid],[finding('purpose','business',cite('s1','Table'))]])assert.equal(evidenceRepairPlan({...report,findings},context,sources),null);
 const customer='111111111111111111111111',c={...context,references:{customers:[{_id:customer}]}},r={...report,findings:[finding('purpose','customer',cite('s1','Missing')),finding('customerId',customer,cite('s1','Table'))]};
 assert.equal(evidenceRepairPlan(r,c,sources),null,'Removing purpose cannot silently retain an incompatible customer');
});

test('withdrawing unsupported tax retains valid findings and supplier byte for byte',()=>{
 const before=structuredClone(report),after=apply(report,edits(report));assert.deepEqual(after.findings,[valid]);assert.deepEqual(after.supplier,report.supplier);assert.deepEqual(report,before);
 after.findings[0].citations[0].quote='Mutated';after.supplier.legalName='Mutated';assert.deepEqual(report,before);
});

test('a kept percentage must be recited from captured purchase mail or document',()=>{
 for(const kind of ['mail','document']){
  const ss=sources.map(s=>s.id==='s2'?{...s,kind}:s),e=edits(report);e.findings[1].action='keep';e.repairs=[{target:'taxRate',citations:[cite('s2','tax 10%')]}];
  const after=apply(report,e,ss);assert.equal(after.findings[1].valueJson,'10');assert.deepEqual(after.findings[0],valid);
 }
 for(const proof of [cite('s3','10%'),cite('missing','10%'),cite('s2','Tax: 10%'),cite('s2','Table')]){
  const e=edits(report);e.findings[1].action='keep';e.repairs=[{target:'taxRate',citations:[proof]}];assert.throws(()=>apply(report,e));
 }
});

test('re-citing a literal value and supplier preserves their identities',()=>{
 const r=structuredClone(report);r.findings=[finding('productName','Table',cite('s1','Invented'))];r.supplier.citations=[cite('s1','Missing')];const e=edits(r);
 e.repairs=[{target:'productName',citations:[cite('s2','Table')]},{target:'supplier',citations:[cite('s1',sources[1].text)]}];const after=apply(r,e);
 assert.equal(after.findings[0].valueJson,'"Table"');assert.equal(after.supplier.invoiceNumber,r.supplier.invoiceNumber);
 e.repairs[1].citations=[cite('s1','Table')];assert.throws(()=>apply(r,e));
 e.supplierAction='withdraw';e.repairs.pop();assert.equal(apply(r,e).supplier,null);
});

test('edit parser rejects changes to valid evidence, mapped values, identities and malformed repairs',()=>{
 const e=edits(report),kept={...e,findings:e.findings.map(f=>({...f,action:'keep'}))};
 const invalid=[null,[],{...e,extra:true},{...e,findings:[]},{...e,supplierAction:'withdraw'},{...e,repairs:null},
  {...e,findings:e.findings.map(f=>({...f,valueJson:'8'}))},
  {...e,repairs:[{target:'taxRate',citations:[cite('s2','10%')]}]}, // withdrawn
  {...e,repairs:[{target:'companyInfo',citations:[cite('s1','Synthetic Co')]}]}, // valid
  kept, // kept rejected field missing its replacement
  {...kept,repairs:[{target:'taxRate',citations:[{...cite('s2','10%'),hidden:true}]}]},
  {...kept,repairs:[{target:'taxRate',citations:[]}]},
  {...kept,repairs:[{target:'taxRate',citations:[cite('s2','10%')],valueJson:'8'}]},
  {...kept,repairs:[{target:'taxRate',citations:[cite('s2','10%')]},{target:'taxRate',citations:[cite('s2','10%')]}]}];
 for(const input of invalid)assert.throws(()=>apply(report,input));
});

async function scenario(t,responses,{elapsed=[]}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-evidence-repair-')),calls=[],deliveries=[];
 t.after(async()=>{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-evidence-repair-'))throw Error('Unsafe temp path');await fs.rm(dir,{recursive:true,force:true})});
 const job={id:'synthetic',mode:'evaluation',lease:'test',context,sources,instruction:'Synthetic evidence test'};
 const worker=new ResearchWorker({baseUrl:'http://100.79.23.111:8080',cliPath:'unused',inferenceDirectory:dir},dir,{log:()=>{},invokeInterpreter:async(cli,args,opts,payload,timeout)=>{
  calls.push({args,payload,timeout});if(elapsed[calls.length-1])t.mock.timers.setTime(Date.now()+elapsed[calls.length-1]);const response=calls.length===1?report:responses.shift();assert.notEqual(response,undefined);if(response instanceof Error)throw response;
  return JSON.stringify({structured_output:response,modelUsage:{'synthetic-model':{}}});
 }});
 worker.api=async(route,body)=>{if(route==='claim')return {job:null};if(route==='evaluation/claim')return {job};if(route.endsWith('/result'))deliveries.push(body);return {success:true}};
 await worker.cycle();assert.equal(responses.length,0);assert.equal(deliveries.length,1);return {calls,result:deliveries[0],dir};
}

test('worker repairs only rejected evidence with no tools and still reviews before delivering',async t=>{
 const {calls,result,dir}=await scenario(t,[edits(report),{issues:[]}]);assert.equal(result.failed,undefined);assert.equal(calls.length,3);
 assert.equal(calls[1].args[calls[1].args.indexOf('--system-prompt')+1],evidenceRepairSystem);assert.equal(calls[1].args[calls[1].args.indexOf('--tools')+1],'');assert.equal(calls[1].timeout,90000);
 assert.deepEqual(JSON.parse(calls[1].args[calls[1].args.indexOf('--json-schema')+1]),evidenceRepairSchema(report,evidenceRepairPlan(report,context,sources)));
 assert.equal(calls[1].payload.evidenceIssues[0].target,'taxRate');assert.equal(calls[1].payload.accountingGuidance,undefined);
 assert.deepEqual(result.report.findings,[valid]);assert.equal(calls[2].payload.report['findings.1.reason'],undefined);
 const jobDir=(await fs.readdir(path.join(dir,'jobs')))[0];assert.equal(JSON.parse(await fs.readFile(path.join(dir,'jobs',jobDir,'evidence-repair-plan.json'))).issues[0].target,'taxRate');
});

test('unrepaired evidence never reaches review or result',async t=>{
 const e=edits(report);e.findings[1].action='keep';e.repairs=[{target:'taxRate',citations:[cite('s3','10%')]}];const {calls,result}=await scenario(t,[e]);
 assert.equal(calls.length,2);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.deepEqual(result.diagnostic,{code:'output_invalid',correctionAttempted:true});
});

test('a bounded evidence correction timeout never delivers a partial report',async t=>{
 const {calls,result}=await scenario(t,[Error('Research timed out')]);assert.equal(calls.length,2);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.deepEqual(result.diagnostic,{code:'timed_out',correctionAttempted:true});
});

test('persistent overstatement after evidence repair cannot receive a second correction',async t=>{
 const e=edits(report);e.summary='All purchases agree.';const {calls,result}=await scenario(t,[e,{issues:[{path:'summary',quote:e.summary,sourceIds:['s3'],explanation:'One returned example is not all purchases.'}]}]);
 assert.equal(calls.length,3);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.deepEqual(result.diagnostic,{code:'search_scope_invalid',correctionAttempted:true});
});

test('a long investigation and correction leave only the remaining lease budget for review',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-04-02T00:00:00Z')});
 const {calls,result}=await scenario(t,[edits(report),Error('Research timed out')],{elapsed:[410000,85000,75000]});
 assert.deepEqual(calls.map(c=>c.timeout),[420000,90000,75000]);assert.equal(result.failed,true);assert.equal(result.report,undefined);assert.equal(result.diagnostic.code,'timed_out');assert.equal(result.runtime.durationMs,570000);
});

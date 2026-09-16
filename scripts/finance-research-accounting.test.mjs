import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {accountingGuidance,accountingContract} from '../research-worker/accounting-guidance.mjs';
import {ResearchWorker,researchSystem} from '../research-worker/worker.mjs';
import {evaluationContext} from '../shared/finance-evaluation.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';
const id=n=>String(n).padStart(24,'0');
const source={kind:'expense',description:'Heroku* synthetic',purchaseDate:'2026-04-01',amount:4200,account:{id:id(1),name:'Synthetic card'}};
const context=()=>({source,values:{...emptyValues(source),purpose:'company'},references:{accountCategories:[{_id:id(2),name:'通信費',parentId:null},{_id:id(3),name:'経費',parentId:null},{_id:id(4),name:'支払手数料',parentId:null}]}});

test('research reuses conditional mapping guidance with registered purchase accounts, without writing values',()=>{
 const c=context(),before=structuredClone(c),a=accountingGuidance(c);
 assert.equal(a.rule,'cloud-service');assert.deepEqual(a.candidateAccountNames,['通信費','支払手数料']);assert(a.reason.includes('買い切り'));assert(a.sources.every(s=>s.url.startsWith('https://www.yayoi-kk.co.jp/')));assert.deepEqual(c,before);assert(researchSystem.includes(accountingContract));
});

test('unknown use, customer use and unrelated merchants are not converted into company subscriptions',()=>{
 for(const purpose of ['unresolved','customer']){const c=context();c.values.purpose=purpose;const a=accountingGuidance(c);assert.deepEqual(a.candidateAccountNames,[]);assert(a.question)}
 for(const description of ['Unknown merchant','Shopping for Adobe books','AmazonPay partner']){const c=context();c.source={...source,description};assert.deepEqual(accountingGuidance(c).candidateAccountNames,[]);assert.equal(accountingGuidance(c).rule,'')}
 const c=context();c.source={...source,kind:'repayment'};assert.equal(accountingGuidance(c).rule,'');
});

test('unregistered, child, inactive and explicitly nonexpense accounts are not guidance candidates',()=>{
 const c=context();c.references.accountCategories=[{_id:id(2),name:'通信費',parentId:id(3)},{_id:id(4),name:'支払手数料',isActive:false},{_id:id(5),name:'システム利用料',type:'liability'}];assert.deepEqual(accountingGuidance(c).candidateAccountNames,[]);
});

test('changing hidden evaluation answers and target-row history cannot change research guidance',()=>{
 const c=context(),draft={...c,documents:[],source:{...source,category:'hidden-answer',reason:'hidden-answer'},values:{...c.values,accountCategoryId:id(3)},history:['hidden-answer'],purchaseHistory:{examples:[{accountName:'hidden-answer'}]},accountingResponse:{note:'hidden-answer'},mapping:{suggestions:['hidden-answer']}},definition={knownFields:['purpose'],expectations:[{field:'accountCategoryId',value:id(2)}]};
 const first=accountingGuidance(evaluationContext(draft,definition));draft.values.accountCategoryId=id(4);draft.purchaseHistory.examples[0].accountName='different-hidden-answer';definition.expectations[0].value=id(4);
 const second=accountingGuidance(evaluationContext(draft,definition));assert.deepEqual(first,second);assert.equal(JSON.stringify(second).includes('hidden-answer'),false);
 assert.equal(evaluationContext(draft,definition).values.accountCategoryId,'');
});

test('a registered supported policy alternative remains available without forcing one account',()=>{
 const c=context();c.values.accountCategoryId=id(4);const a=accountingGuidance(c);assert(a.candidateAccountNames.includes('支払手数料'));assert.equal(c.values.accountCategoryId,id(4));assert.equal(a.accountCategoryId,undefined);assert.equal(a.taxRate,undefined);
});

for(const mode of ['research','evaluation'])test(mode+' worker supplies and records guidance without adding it to captured purchase evidence',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-account-guidance-'));
 t.after(async()=>{if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('omf-account-guidance-'))throw Error('Unsafe temporary path');await fs.rm(directory,{recursive:true,force:true})});
 const c=context(),text=JSON.stringify(c),proof={id:'s0',kind:'context',text,title:'Synthetic context',url:'',hash:createHash('sha256').update(text).digest('hex'),capturedAt:new Date().toISOString()},job={id:'synthetic-job',mode,lease:'synthetic-lease',context:c,sources:[proof],instruction:'Synthetic test'},calls=[];
 let result;
 const worker=new ResearchWorker({baseUrl:'http://127.0.0.1:8080',cliPath:'unused',inferenceDirectory:directory},directory,{log:()=>{},invokeInterpreter:async(cli,args,options,payload)=>{
  calls.push(payload);assert.deepEqual(payload.accountingGuidance,accountingGuidance(c));assert.deepEqual(payload.capturedSources,[proof]);assert.deepEqual(JSON.parse(await fs.readFile(path.join(path.dirname(options.env.OMF_RESEARCH_JOB_FILE),'accounting-guidance.json'),'utf8')),payload.accountingGuidance);
  return JSON.stringify({structured_output:{summary:'Synthetic',question:'',supplier:null,findings:calls.length===1?[{field:'purpose',valueJson:'"business"',reason:'Synthetic',basis:'reasoned',citations:[{sourceId:'s0',quote:'Heroku'}]}]:[]},modelUsage:{'synthetic-model':{}}});
 }});
 worker.api=async(route,body)=>{if(route==='claim')return {job:mode==='research'?job:null};if(route==='evaluation/claim')return {job};if(route.endsWith('/result'))result=body;return {success:true}};
 assert.equal(await worker.cycle(),true);assert.equal(calls.length,2);assert.equal(calls[1].validationFeedback.code,'purpose_invalid');assert.equal(result.failed,undefined);assert.deepEqual(result.sources,[proof]);assert.equal(result.report.findings.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ResearchTools} from '../research-worker/tools.mjs';
import {searchReviewSchema,scopeRepairSchema} from '../research-worker/search-review.mjs';
const require=createRequire(new URL('../collector/package.json',import.meta.url));
test('review output schema restricts paths and IDs to this report and captured search evidence',()=>{
 const Ajv=require('ajv'),report={summary:'Synthetic',question:'',findings:[{reason:'Synthetic reason'}]},sources=[{id:'s0',kind:'context'},{id:'s1',kind:'spreadsheet'},{id:'s2',kind:'search'}],check=new Ajv().compile(searchReviewSchema(report,sources));
 const issue={path:'summary',quote:'Synthetic',sourceIds:['s1'],explanation:'Synthetic limitation'};
 assert(check({issues:[issue]}));assert(check({issues:[{...issue,path:'findings.0.reason',sourceIds:['s2']}]}));
 for(const changed of [{path:'report.summary'},{path:'findings.1.reason'},{sourceIds:['s0']},{sourceIds:['s9']}])assert.equal(check({issues:[{...issue,...changed}]}),false);
});
test('API spreadsheet searches use configured tabs, separate tab caches and the requested date window',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-search-contract-')),google=require('googleapis').google,original=google.sheets,ranges=[];
 google.sheets=()=>({
  spreadsheets:{
   get:async()=>({data:{sheets:[{properties:{title:'Wrong first tab',sheetId:0}},{properties:{title:'Finance',sheetId:1}},{properties:{title:'Shipping',sheetId:2}}]}}),
   values:{get:async({range})=>{
    ranges.push(range);
    return {data:{values:[['2026/04/10','Synthetic',range.includes('Shipping')?'Shipping':'Finance'],['2026/05/01','Synthetic','later']]}};
   }}
  }
 });
 try{
  const tools=new ResearchTools({spreadsheets:{finance:'same-id',shipping:'same-id'},spreadsheetTabs:{finance:'Finance',shipping:'Shipping'}},{context:{source:{purchaseDate:'2026-04-10'}},sources:[]},dir);
  tools.mailbox=async()=>({});
  const finance=JSON.parse((await tools.call('search_spreadsheet',{source:'finance',terms:['Synthetic'],withinPurchaseWindow:true})).text);
  const shipping=JSON.parse((await tools.call('search_spreadsheet',{source:'shipping',terms:['Synthetic'],withinPurchaseWindow:true})).text);
  assert.equal(finance.gid,1);assert.equal(shipping.gid,2);assert.equal(finance.matchCount,1);assert.equal(shipping.matches[0].values[2],'Shipping');
  const all=JSON.parse((await tools.call('search_spreadsheet',{source:'finance',terms:['Synthetic'],withinPurchaseWindow:false})).text);assert.equal(all.matchCount,2);assert.equal(all.coverage.dateWindow,null);
  assert.deepEqual(ranges,["'Finance'!A1:AZ50000","'Shipping'!A1:AZ50000"]);
  tools.config.spreadsheetTabs.finance='Missing';await assert.rejects(tools.call('search_spreadsheet',{source:'finance',terms:['Synthetic']}),/Configured spreadsheet tab/);
 }finally{google.sheets=original;if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-search-contract-'))throw Error('Unsafe temporary path');await fs.rm(dir,{recursive:true,force:true})}
});

test('wording schema accepts only explicit edits to existing findings, including zero findings',()=>{
 const Ajv=require('ajv'),check=new Ajv().compile(scopeRepairSchema({findings:[{field:'purpose'}]})),edits={summary:'Qualified observation',question:'',findings:[{field:'purpose',action:'keep',reason:'Returned rows only'}]};
 assert(check(edits));assert(check({...edits,findings:[{...edits.findings[0],action:'withdraw',reason:''}]}));
 for(const bad of [{...edits,supplier:null},{...edits,findings:[]},{...edits,findings:[{...edits.findings[0],field:'customerId'}]},{...edits,findings:[{...edits.findings[0],valueJson:'"company"'}]},{...edits,findings:[{...edits.findings[0],citations:[]}]}])assert.equal(check(bad),false);
 const empty=new Ajv().compile(scopeRepairSchema({findings:[]}));assert(empty({summary:'No supported proposal',question:'',findings:[]}));assert.equal(empty(edits),false);
});

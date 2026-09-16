import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {matchSheetRows} from '../research-worker/search-evidence.mjs';
import {searchCsv} from '../research-worker/sheets.mjs';
import {ResearchTools} from '../research-worker/tools.mjs';
import {validateReport,validateSources} from '../shared/finance-research.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';
const options={terms:['synthetic'],purchaseDate:'2026-04-10',exportMode:'sheets_api',range:'A1:AZ50000'};
test('spreadsheet matching uses AND, inclusive seven-day boundaries and valid dates',()=>{
 const rows=[['2026/04/03','Synthetic shop','item'],['2026/04/17','synthetic shop','item'],['2026/04/18','synthetic shop','item'],['2026/04/10','synthetic shop','other'],['2026/02/30','synthetic shop','item'],['','synthetic shop','item']];
 const r=matchSheetRows(rows,{...options,terms:['synthetic','item']});
 assert.deepEqual(r.matches.map(x=>x.row),[1,2]);assert.equal(r.matchCount,2);assert.equal(r.coverage.returnedCount,2);
 assert.deepEqual(r.coverage.dateWindow,{from:'2026-04-03',through:'2026-04-17',dateMatch:'any_parseable_date_cell'});
 assert.equal(r.coverage.matchMode,'all_terms');assert.equal(r.coverage.absenceProven,false);
 assert.equal(matchSheetRows(rows,{...options,windowed:false}).matchCount,6);
 assert.throws(()=>matchSheetRows(rows,{...options,purchaseDate:'2026-02-30'}));
});
test('zero matches and omitted rows preserve the limits of the evidence',()=>{
 const none=matchSheetRows([],{...options,exportMode:'google_query_csv'});
 assert.equal(none.coverage.absenceProven,false);assert(none.limitation.includes('may omit'));
 const many=matchSheetRows(Array.from({length:64},()=>['2026/04/10','synthetic', 'x'.repeat(500)]),options);
 assert.equal(many.matchCount,64);assert(many.matches.length<25);assert.equal(many.coverage.returnedCount,many.matches.length);assert.equal(many.truncated,true);assert(many.coverage.limitations.some(x=>x.includes('omitted')));
 assert.equal(matchSheetRows(Array.from({length:50000},()=>['unrelated']),{...options,windowed:false}).coverage.rowLimitReached,true);
});
test('real-browser serialized CSV parser retains quoted commas/newlines and fallback coverage',async()=>{
 for(const fallback of [false,true]){
  const urls=[],csv='date,shop,item\r\n2026/04/10,Synthetic,"One, two\nthree"\r\n2026/04/11,Other,item';
  const sandbox={fetch:async url=>{urls.push(url);return {ok:!(fallback&&urls.length===1),text:async()=>csv}},crypto:webcrypto,TextEncoder};
  const script='('+searchCsv.toString()+')('+['sheetid','0',['synthetic'],'2026-04-10',true,'Tab'].map(JSON.stringify).join(',')+',('+matchSheetRows.toString()+'))';
  const result=JSON.parse(await vm.runInNewContext(script,sandbox));
  assert.equal(result.matches[0].values[2],'One, two\nthree');assert.equal(result.matches[0].row,2);
  assert.equal(result.exportMode,fallback?'google_query_csv':'original_csv');assert.equal(result.coverage.range,fallback?'A1:AZ50000':'entire_tab');assert.deepEqual(result.coverage.terms,['synthetic']);assert.equal(urls.length,fallback?2:1);
 }
});
test('mail search stores query scope and pagination separately from purchase evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-search-evidence-'));
 try{
  const context={source:{purchaseDate:'2026-04-10'},values:emptyValues({purchaseDate:'2026-04-10',description:'Synthetic'}),references:{}};
  const tools=new ResearchTools({}, {id:'synthetic',context,sources:[]},dir);
  tools.mailbox=async()=>({users:{messages:{list:async()=>({data:{messages:[{id:'ok'},{id:'auth'}],nextPageToken:'do-not-persist'}}),get:async({id})=>({data:{id,internalDate:Date.parse('2026-04-10'),payload:{headers:[{name:'Subject',value:id==='auth'?'verification code':'Synthetic purchase 10%'},{name:'From',value:'shop@example.invalid'}]}}})}}});
  const result=await tools.call('search_mail',{terms:'Synthetic'}),saved=JSON.parse(await fs.readFile(path.join(dir,'evidence.json'),'utf8'));
  assert.equal(result.messages.length,1);assert.equal(result.coverage.candidateCount,2);assert.equal(result.coverage.hasMore,true);
  assert.equal(result.source.kind,'search');assert.equal(saved.sources.length,1);assert(!result.source.text.includes('do-not-persist'));assert(!result.source.text.includes('verification code'));
  assert.equal(validateSources(saved.sources).length,1);
  assert.throws(()=>validateReport({summary:'Synthetic',question:'',supplier:null,findings:[{field:'taxRate',valueJson:'10',reason:'Search subject only',basis:'literal',citations:[{sourceId:result.source.id,quote:'10%'}]}]},context,saved.sources),/printed purchase/);
  tools.mailbox=async()=>({users:{messages:{list:async()=>({data:{}})}}});
  const zero=await tools.call('search_mail',{terms:'Different'});assert.equal(zero.messages.length,0);assert.equal(zero.coverage.absenceProven,false);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'evidence.json'),'utf8')).sources.length,2);
 }finally{if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-search-evidence-'))throw Error('Unsafe temporary path');await fs.rm(dir,{recursive:true,force:true})}
});

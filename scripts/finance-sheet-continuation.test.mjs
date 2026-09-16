import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {matchSheetRows} from '../research-worker/search-evidence.mjs';
import {searchCsv} from '../research-worker/sheets.mjs';
import {ResearchTools} from '../research-worker/tools.mjs';
const options={terms:['Synthetic'],purchaseDate:'2026-04-10',windowed:false,exportMode:'sheets_api',range:'A1:AZ50000'};

test('sheet pages visit every matching row once while preserving original row positions and filters',()=>{
 const rows=Array.from({length:130},(_,i)=>['2026/04/10',i%2?'Other':'Synthetic',String(i)]),seen=[];let offset=0;
 do{const r=matchSheetRows(rows,{...options,offset});assert.equal(r.pagination.offset,offset);assert.equal(r.matchCount,65);seen.push(...r.matches.map(m=>m.row));offset=r.pagination.nextOffset;}while(offset!==null);
 assert.deepEqual(seen,Array.from({length:65},(_,i)=>2*i+1));assert.equal(new Set(seen).size,65);
 for(const offset of [-1,0.5,'25',NaN])assert.throws(()=>matchSheetRows(rows,{...options,offset}),/offset/);
});

test('size-limited pages advance by actual returned rows and oversized rows cannot cause a silent loop',()=>{
 const rows=Array.from({length:37},(_,i)=>['Synthetic',String(i),'x'.repeat(850)]),seen=[];let offset=0;
 do{const r=matchSheetRows(rows,{...options,offset});assert(JSON.stringify(r).length<=8000);assert(r.matches.length>0);assert.equal(r.coverage.returnedCount,r.matches.length);seen.push(...r.matches.map(m=>m.row));const next=r.pagination.nextOffset;if(next!==null)assert.equal(next,offset+r.matches.length);offset=next;}while(offset!==null);
 assert.deepEqual(seen,Array.from({length:37},(_,i)=>i+1));
 assert.throws(()=>matchSheetRows([['Synthetic','x'.repeat(10000)]],options),/too large/);
 const zero=matchSheetRows([],{...options,offset:0});assert.equal(zero.pagination.nextOffset,null);assert.equal(zero.coverage.absenceProven,false);
});

test('browser continuation keeps one row snapshot and rejects a changed export instead of mixing pages',async()=>{
 let csv=Array.from({length:32},(_,i)=>'2026/04/10,Synthetic,'+i).join('\n');
 const sandbox={fetch:async()=>({ok:true,text:async()=>csv}),crypto:webcrypto,TextEncoder};
 const call=page=>vm.runInNewContext('('+searchCsv.toString()+')('+['sheetid','0',['Synthetic'],'2026-04-10',false,'Tab'].map(JSON.stringify).join(',')+',('+matchSheetRows.toString()+'),'+JSON.stringify(page)+')',sandbox).then(JSON.parse);
 const first=await call({offset:0});assert.match(first.snapshotHash,/^[a-f0-9]{64}$/);const second=await call({offset:first.pagination.nextOffset,expectedSnapshot:first.snapshotHash});assert.equal(second.matches[0].row,26);assert.equal(second.pagination.nextOffset,null);
 csv+='\n2026/04/10,Synthetic,new';await assert.rejects(call({offset:25,expectedSnapshot:first.snapshotHash}),/changed/);
});

test('continuation is bound to a captured source and query, reused on retry, and unavailable across jobs',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-sheet-pages-')),calls=[];
 try{
  const rows=Array.from({length:30},(_,i)=>['2026/04/10','Synthetic',String(i)]),snapshotHash='a'.repeat(64);
  const reader=async(config,source,terms,date,windowed,page={})=>{calls.push({source,terms,date,windowed,page});return {sheet:'Finance',gid:'1',snapshotHash,...matchSheetRows(rows,{...options,terms,purchaseDate:date,windowed,offset:page.offset||0})}};
  const config={spreadsheets:{finance:'synthetic-sheet-id-0123456789'},spreadsheetTabs:{finance:'Finance'},spreadsheetBrowserProfile:'synthetic'},job={context:{source:{purchaseDate:'2026-04-10'}},sources:[]};
  const tools=new ResearchTools(config,job,dir,{searchSheet:reader});assert.equal(tools.searchSheet,reader);const first=await tools.call('search_spreadsheet',{source:'finance',terms:['Synthetic'],withinPurchaseWindow:false});
  const [second,retry]=await Promise.all([tools.call('continue_spreadsheet',{sourceId:first.id}),tools.call('continue_spreadsheet',{sourceId:first.id})]);assert.deepEqual(second,retry);assert.equal(calls.length,2);assert.deepEqual(calls[1],{source:'finance',terms:['Synthetic'],date:'2026-04-10',windowed:false,page:{offset:25,expectedSnapshot:snapshotHash}});
  const parsed=JSON.parse(second.text);assert.equal(parsed.continuedFrom,first.id);assert.equal(parsed.pagination.nextOffset,null);
  await assert.rejects(tools.call('continue_spreadsheet',{sourceId:second.id}),/continuation/);
  await assert.rejects(new ResearchTools(config,job,dir,{searchSheet:reader}).call('continue_spreadsheet',{sourceId:first.id}),/continuation/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'evidence.json'),'utf8')).sources.length,2);
  const changedDir=path.join(dir,'changed');await fs.mkdir(changedDir);
  const changed=new ResearchTools(config,job,changedDir,{searchSheet:async(...args)=>({...await reader(...args),snapshotHash:args[5]?.offset?'b'.repeat(64):snapshotHash})});
  const start=await changed.call('search_spreadsheet',{source:'finance',terms:['Synthetic'],withinPurchaseWindow:false});
  await assert.rejects(changed.call('continue_spreadsheet',{sourceId:start.id}),/changed/);
  assert.equal(JSON.parse(await fs.readFile(path.join(changedDir,'evidence.json'),'utf8')).sources.length,1);
 }finally{if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-sheet-pages-'))throw Error('Unsafe temporary path');await fs.rm(dir,{recursive:true,force:true})}
});

test('API continuation uses the original configured-tab snapshot without refetching or leaking another tab',async()=>{
 const google=createRequire(new URL('../collector/package.json',import.meta.url))('googleapis').google,original=google.sheets,dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-sheet-pages-'));let reads=0;
 google.sheets=()=>({spreadsheets:{
  get:async()=>({data:{sheets:[{properties:{title:'Other',sheetId:0}},{properties:{title:'Finance',sheetId:7}}]}}),
  values:{get:async({range})=>{assert.equal(range,"'Finance'!A1:AZ50000");reads++;return {data:{values:Array.from({length:30},(_,i)=>['2026/04/10','Synthetic',String(i)])}};}}
 }});
 try{
  const tools=new ResearchTools({spreadsheets:{finance:'synthetic-id'},spreadsheetTabs:{finance:'Finance'}},{context:{source:{purchaseDate:'2026-04-10'}},sources:[]},dir);tools.mailbox=async()=>({});
  const first=await tools.call('search_spreadsheet',{source:'finance',terms:['Synthetic'],withinPurchaseWindow:true}),second=await tools.call('continue_spreadsheet',{sourceId:first.id}),a=JSON.parse(first.text),b=JSON.parse(second.text);
  assert.equal(reads,1);assert.equal(b.gid,7);assert.equal(a.snapshotHash,b.snapshotHash);assert.equal(a.matches.length,25);assert.equal(b.matches.length,5);assert.equal(b.matches[0].row,26);assert.deepEqual(a.coverage.dateWindow,b.coverage.dateWindow);assert.equal(b.pagination.nextOffset,null);
 }finally{google.sheets=original;if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-sheet-pages-'))throw Error('Unsafe temporary path');await fs.rm(dir,{recursive:true,force:true})}
});

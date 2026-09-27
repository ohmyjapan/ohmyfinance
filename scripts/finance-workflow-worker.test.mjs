import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FinalizationWorker} from '../finalization-worker/worker.mjs';
import {readCompleteSheetCsv} from '../research-worker/sheets.mjs';
test('known stock advances despite a sibling manual review and before an unavailable purchase investigation',async()=>{
 const events=[],run={id:'synthetic',lease:'lease',day:'2026-09-18',deadline:new Date(Date.now()+60000).toISOString(),policy:{accountIds:['account'],from:'2026-01-01'}};let inventory=false,documents=false;
 const step=(stage,state,unit=stage)=>({stage,state,unit,lastCheckedAt:null});
 const context=()=>({rows:[{id:'known',purchaseId:'purchase',steps:{purchase:step('purchase','complete'),inventory_1:step('inventory','manual_review','item:1'),inventory_2:step('inventory',inventory?'complete':'pending','item:2'),documents_stock:step('documents',documents?'complete':'pending','stock')}},{id:'unknown',steps:{purchase:step('purchase','pending')}}],purchases:[{id:'purchase',revision:1,order:{kind:'online'}}],shipments:documents?[]:[{key:'shipment',allocations:[{inventoryId:'stock'}]}]});
 const worker=new FinalizationWorker({baseUrl:'http://127.0.0.1:8080',isseyArchive:{financialAccountIds:['account'],accountIds:['external']},workflow:{intras:{}}},'unused',{archiveFactory:()=>({searched:new Map()}),log:()=>{}});
 worker.snapshot=async(_run,kind)=>({id:kind,complete:true,payload:{orders:[]}});
 worker.collectedDocuments=async()=>{events.push('pdf');return {}};
 worker.api=async(route,body)=>{
  if(route==='status')return {config:{enabled:true}};if(route==='claim')return {run};
  if(route.endsWith('/context'))return context();
  if(route.endsWith('/inventory')){events.push('inventory');inventory=true;return {state:'connected'}};
  if(route.endsWith('/documents')){events.push('documents');documents=true;return {saved:true}};
  if(route.endsWith('/receipts'))return {documents:[]};
  if(route.endsWith('/investigate')){events.push('investigate');assert(documents,'Existing stock must finish before the failing investigation');throw Error('Synthetic interpreter connection failure')};
  if(route.endsWith('/observation'))return {row:context().rows.find(r=>r.id===body.id)};
  if(route.endsWith('/finish'))return {};
  throw Error('Unexpected route '+route);
 };
 assert.equal(await worker.cycle(),true);assert.equal(events.filter(e=>e==='pdf').length,1);assert(events.indexOf('documents')<events.indexOf('investigate'));
});

test('a recovered capture is pinned once and survives restart; a legacy short capture is never republished',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-sheet-retry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const run={id:'synthetic',policy:{accountIds:[]}},short='one,two,three\n1,2',full='one,two,three\n1,2,3';let reads=0,published=0;
 const config={baseUrl:'http://127.0.0.1:8080'};
 const captureSheet=async()=>({...await readCompleteSheetCsv(null,'unused',{read:async()=>++reads===1?short:full}),sheet:'Synthetic',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0',capturedAt:new Date().toISOString()});
 const worker=new FinalizationWorker(config,directory,{captureSheet});worker.api=async()=>{published++;return {id:'source',hash:'hash'}};
 await worker.snapshot(run,'shipping',()=>worker.captureWorkflowSheet(run,'shipping'));
 const rejected=await fs.readdir(path.join(directory,'runs',run.id,'rejected'));assert.equal(rejected.length,1);
 assert.equal(JSON.parse(await fs.readFile(path.join(directory,'runs',run.id,'rejected',rejected[0]),'utf8')).csv,short);
 const fresh=new FinalizationWorker(config,directory,{captureSheet:async()=>{throw Error('Unexpected recapture')}});fresh.api=worker.api;
 await fresh.snapshot(run,'shipping',()=>fresh.captureWorkflowSheet(run,'shipping'));assert.equal(reads,2);assert.equal(published,2);
 const file=path.join(directory,'runs',run.id,'shipping.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));
 saved.source.payload.rows[1].pop();saved.hash=createHash('sha256').update(JSON.stringify(saved.source)).digest('hex');await fs.writeFile(file,JSON.stringify(saved));
 await assert.rejects(fresh.snapshot(run,'shipping',()=>{throw Error('Must preserve pinned source')}),{code:'source_incomplete'});assert.equal(published,2);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).hash,saved.hash,'Rejected legacy evidence stays immutable');
});

test('failed source retries keep completed evidence and never increment missing-data failures',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-sheet-incomplete-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const run={id:'synthetic',lease:'lease',day:'2026-09-27',deadline:new Date(Date.now()+60000).toISOString(),policy:{accountIds:['account'],from:'2026-01-01'}};
 const complete={id:'known',purchaseId:'purchase',steps:{purchase:{stage:'purchase',state:'complete'},inventory_1:{stage:'inventory',state:'complete',unit:'item:1'},shipment_stock:{stage:'shipment',state:'complete',unit:'stock'},documents_stock:{stage:'documents',state:'complete',unit:'stock'}}};
 const waiting={id:'waiting',purchaseId:'other',steps:{purchase:{stage:'purchase',state:'complete'},inventory_1:{stage:'inventory',state:'pending',unit:'item:1'},shipment_stock:{stage:'shipment',state:'pending',unit:'other-stock'}}};
 const context={rows:[complete,waiting],purchases:[{id:'purchase',order:{kind:'online'}},{id:'other',order:{kind:'online'}}],shipments:[]},observations=[],published=[];
 let reads=0;const worker=new FinalizationWorker({baseUrl:'http://127.0.0.1:8080',isseyArchive:{financialAccountIds:['account'],accountIds:['external']}},directory,{
  captureSheet:async(_c,kind)=>{if(kind==='shipping')return readCompleteSheetCsv(null,'unused',{read:async()=>{reads++;return 'one,two,three\n1,2'}});return {sheet:'Synthetic',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0',capturedAt:new Date().toISOString(),csv:'one,two\n1,2'}},
  archiveFactory:()=>({searched:new Map(),catalog:async()=>({orders:[],runs:[]})})
 });
 worker.api=async(route,body)=>{
  if(route==='status')return {config:{enabled:true}};if(route==='claim')return {run};if(route.endsWith('/context'))return structuredClone(context);
  if(route.endsWith('/source')){published.push(body.kind);return {id:body.kind,hash:'hash'}};
  if(route.endsWith('/receipts'))return {documents:[]};
  if(route.endsWith('/observation')){observations.push(body);return {row:structuredClone(waiting)}};
  if(route.endsWith('/finish'))return {};
  throw Error('Unexpected side effect '+route);
 };
 assert.equal(await worker.cycle(),true);assert.equal(reads,2);assert.deepEqual(published,['inventory','orders']);
 assert(observations.length>0);assert(observations.every(o=>o.id==='waiting'&&o.reason==='source_incomplete'&&o.sourceIds.length===0));
 assert(Object.values(complete.steps).every(s=>s.state==='complete'));
 await assert.rejects(fs.access(path.join(directory,'runs',run.id,'shipping.json')),{code:'ENOENT'});
 assert.equal((await fs.readdir(path.join(directory,'runs',run.id,'rejected'))).length,1);
});

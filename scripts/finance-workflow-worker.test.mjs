import test from 'node:test';
import assert from 'node:assert/strict';
import {FinalizationWorker} from '../finalization-worker/worker.mjs';
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

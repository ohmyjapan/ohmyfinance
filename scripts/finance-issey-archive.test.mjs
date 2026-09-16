import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {IsseyArchive,ISSEY_HISTORY_URL} from '../research-worker/issey-archive.mjs';
import {ResearchTools} from '../research-worker/tools.mjs';
import {validateSources,validateReport} from '../shared/finance-research.mjs';
import {emptyValues} from '../shared/finance-draft.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),account='11111111-1111-1111-1111-111111111111',financial='1'.repeat(24);
const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic PNG payload')]);
const config={isseyArchive:{baseUrl:'http://127.0.0.1:5088',token:'private-test-token-'.repeat(4),accountIds:[account],financialAccountIds:[financial]}};
const context={source:{account:{id:financial},purchaseDate:'2026-04-10',amount:2200},values:emptyValues({purchaseDate:'2026-04-10',description:'Synthetic Issey'}),references:{}};
const order=(number='1234567',extra={})=>({id:hash(account+':'+number),accountId:account,accountName:'Synthetic',orderNumber:number,date:'2026-04-10',total:2200,currency:'JPY',cancelled:false,status:'Shipped',dataQuality:'complete',captureVersion:2,sourceUrl:ISSEY_HISTORY_URL,capturedAt:'2026-04-12T00:00:00Z',items:[{line:1,product:'Synthetic shirt AB12CD345',quantity:2,color:'BLUE (no.01)',size:'3',lineTotal:2200}],amounts:[{label:'Subtotal',display:'2000'},{label:'Tax amount',display:'200'}],files:[{part:1,bytes:bytes.length,sha256:hash(bytes)}],inventoryLinks:[],...extra});
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
function fixture(orders=[order()],{image=bytes,transform=v=>v,pageSize=500}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer '+config.isseyArchive.token);
  const u=new URL(url);
  if(u.pathname==='/v1/orders'){assert.equal(u.searchParams.get('account'),account);const offset=Number(u.searchParams.get('offset'));return json({schemaVersion:1,total:orders.length,orders:orders.slice(offset,offset+pageSize),runs:[{state:'complete',finishedAt:'2026-04-12T00:00:00Z'}]})}
  if(u.pathname.endsWith('/files/1'))return new Response(image,{headers:{'Content-Type':'image/png'}});
  return json(transform(orders.find(o=>u.pathname.endsWith(o.id))));
 };
 return {client:new IsseyArchive(config,context,{fetchImpl}),calls};
}

test('archive access is limited to configured financial accounts, private origin and immutable job date',()=>{
 assert.throws(()=>new IsseyArchive(config,{source:{...context.source,account:{id:'2'.repeat(24)}}}),/financial account/);
 for(const baseUrl of ['https://example.com','http://127.0.0.1:5088?token=oops','http://secret@localhost:5088','http://100.128.1.1:5088','http://100.66.58.9:5088/private'])assert.throws(()=>new IsseyArchive({isseyArchive:{...config.isseyArchive,baseUrl}},context),/connection/);
 assert.throws(()=>new IsseyArchive(config,{source:{...context.source,purchaseDate:'2026-02-30'}}),/date/);
});

test('date-window search exhausts catalog pages, keeps quantity and cancellation, and never identifies a card',async()=>{
 const orders=[order(),order('1234568',{date:'2026-04-17',cancelled:true,total:-2200}),order('1234569',{date:'2026-04-18'}),order('1234570',{date:'2026-04-03',dataQuality:'incomplete',items:[],total:null})];
 const {client,calls}=fixture(orders,{pageSize:2}),result=await client.search();
 assert.equal(calls.length,2);assert.equal(result.orders.length,3);assert(result.orders.every(o=>o.paymentCardVerified===false));assert.equal(result.orders[0].items[0].quantity,2);assert.equal(result.orders[0].total,2200);
 assert.equal(result.orders.find(o=>o.cancelled).eligibleCandidate,false);assert.equal(result.orders.find(o=>o.dataQuality==='incomplete').eligibleCandidate,false);assert.equal(result.coverage.absenceProven,false);
 assert(!JSON.stringify(result).includes(config.isseyArchive.token));await client.search();assert.equal(calls.length,2);
});

test('same-amount orders remain separate candidates and omitted matches stay explicit',async()=>{
 const {client}=fixture(Array.from({length:30},(_,i)=>order(String(1234567+i))));const r=await client.search();assert.equal(r.coverage.matchCount,30);assert.equal(r.orders.length,25);assert.equal(r.coverage.truncated,true);assert(r.orders.every(o=>o.amountMatchesCardRow));assert.equal(new Set(r.orders.map(o=>o.id)).size,25);
});

test('archive rejects account leaks, duplicate IDs, malformed pages and incomplete records labelled complete',async()=>{
 for(const orders of [[order('1234567',{accountId:'22222222-2222-2222-2222-222222222222'})],[order(),order()],[order('1234567',{items:[]})],[order('1234567',{files:[]})]])await assert.rejects(fixture(orders).client.search());
 const client=new IsseyArchive(config,context,{fetchImpl:async()=>json({schemaVersion:1,total:1,orders:[],runs:[]})});await assert.rejects(client.search(),/pagination/);
 const unauthorized=new IsseyArchive(config,context,{fetchImpl:async()=>new Response('',{status:401})});await assert.rejects(unauthorized.search(),/HTTP 401/);
});

test('only searched screenshots can be read and every read verifies metadata snapshot, size, hash and PNG bytes',async()=>{
 const {client}=fixture();await assert.rejects(client.image(order().id,1),/Search/);await client.search();await assert.rejects(client.image(order().id,2),/part/);assert.deepEqual((await client.image(order().id,1)).bytes,bytes);
 for(const options of [{image:Buffer.from('tampered')},{transform:o=>({...o,total:3300})}]){const {client}=fixture([order()],options);await client.search();await assert.rejects(client.image(order().id,1),/integrity|changed/)}
});

test('research tools capture original screenshot evidence once without treating tax amounts as printed percentages',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-issey-archive-'));let extracted=0;
 try{
  const {client}=fixture(),tools=new ResearchTools(config,{mode:'evaluation',context,sources:[]},dir,{archive:client,extract:async(c,d,b)=>{extracted++;assert.equal(d.mimeType,'image/png');assert.deepEqual(b,bytes);return {pages:[{page:1,text:'Order 1234567\nSynthetic shirt, quantity 2\nSubtotal 2000\nTax amount 200\nTotal 2200'}],records:[]}}});
  const search=await tools.call('search_issey_orders',{});assert.equal(search.kind,'search');
  const [first,retry]=await Promise.all([tools.call('read_issey_order',{orderId:order().id,part:1}),tools.call('read_issey_order',{orderId:order().id,part:1})]);assert.deepEqual(first,retry);assert.equal(extracted,1);assert.equal(first.document.kind,'document');assert.equal(tools.sources.length,3);validateSources(tools.sources);
  assert(!JSON.stringify(tools.sources).includes(config.isseyArchive.token));assert(!JSON.stringify(tools.sources).includes(config.isseyArchive.baseUrl));
  const detail=JSON.parse(first.detail.text);assert.equal(detail.connectionVersion,1);assert.equal(detail.original.sourceId,first.document.id);assert.equal(detail.original.sha256,hash(bytes));assert.equal(detail.fileCount,1);
  assert.throws(()=>validateReport({summary:'Synthetic',question:'',supplier:null,findings:[{field:'taxRate',valueJson:'10',reason:'Calculated from amounts',basis:'reasoned',citations:[{sourceId:first.document.id,quote:'Tax amount 200'}]}]},context,tools.sources),/printed purchase percentage/);
 }finally{if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('omf-issey-archive-'))throw Error('Unsafe test directory');await fs.rm(dir,{recursive:true,force:true})}
});

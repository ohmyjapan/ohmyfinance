import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {purchaseCandidates,validatePurchaseOrder} from '../shared/finance-purchase-links.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),url='https://www.isseymiyake.com/pages/orders';
const payment={key:'row-key',sourceHash:'csv-hash',source:{account:{id:'1'.repeat(24)},purchaseDate:'2026-09-22',amount:79200}};
const order=()=>({archiveId:'a'.repeat(64),orderNumber:'1234567',date:'2026-09-20',total:79200,currency:'JPY',cancelled:false,dataQuality:'complete',capturedAt:'2026-09-23T00:00:00Z',items:[{line:1,product:'Synthetic AB12CD345',color:'Blue',size:'2',quantity:2,lineTotal:79200}],inventoryLinks:[]});
function fixture(o=order(),parts=1){
 const sources=[],artifacts=[];
 for(let part=1;part<=parts;part++){
  const sourceId='s'+(part*2),text='Original '+part; sources.push({id:sourceId,kind:'document',url,text,hash:hash(text)});
  const original={sourceId,part,sha256:hash('image'+part),bytes:100},detail=JSON.stringify({...o,searchType:'issey_order_detail',connectionVersion:1,fileCount:parts,original});
  sources.push({id:'s'+(part*2+1),kind:'search',url,text:detail,hash:hash(detail)});
  artifacts.push({id:hash('artifact'+part),sourceId,requestId:'request',hash:original.sha256,size:100,mimeType:'image/png',name:'Synthetic.png'});
 }
 return {state:'ready',accountId:payment.source.account.id,context:{key:payment.key,sourceHash:payment.sourceHash},requestId:'request',sources,artifacts};
}
const stock=(id='SYN-1')=>({inventoryId:id,itemLine:1,quantity:1,status:'matched',source:{sheet:'Synthetic inventory',row:2,inventoryCell:'B2'},shipments:[]});
test('nearby date and exact total form a candidate while missing inventory remains pending',()=>{
 const [c]=purchaseCandidates(fixture(),payment);assert.equal(c.dateOffsetDays,-2);assert.equal(c.amountMatches,true);assert.equal(c.documentsComplete,true);assert.equal(c.itemCount,2);assert.equal(c.inventoryCount,0);assert.equal(c.order.items[0].lineTotal,79200);assert.equal(c.order.items[0].unitPrice,undefined);
});
test('foreign, stale, cancelled, malformed and out-of-window evidence cannot become connections',()=>{
 for(const change of [{state:'working'},{accountId:'2'.repeat(24)},{context:{key:'different',sourceHash:payment.sourceHash}}])assert.equal(purchaseCandidates({...fixture(),...change},payment).length,0);
 for(const change of [{cancelled:true},{dataQuality:'incomplete'},{date:'2026-02-30'},{date:'2026-09-14'},{total:-79200}])assert.equal(purchaseCandidates(fixture({...order(),...change}),payment).length,0);
});
test('document part binding requires current artifacts and matching captured content hashes',()=>{
 for(const mutate of [r=>r.artifacts[0].hash='f'.repeat(64),r=>r.artifacts[0].requestId='previous',r=>r.artifacts[0].sourceId='s8',r=>r.sources[0].text='altered',r=>r.sources[1].text='altered']){const r=fixture();mutate(r);assert.equal(purchaseCandidates(r,payment).length,0)}
 const r=fixture(order(),2);assert.equal(purchaseCandidates(r,payment)[0].documentsComplete,true);r.artifacts.pop();assert.equal(purchaseCandidates(r,payment)[0].documentsComplete,false);
});
test('inventory IDs must be unique, refer to actual lines, and respect purchased quantity',()=>{
 assert.equal(validatePurchaseOrder({...order(),inventoryLinks:[stock(),stock('SYN-2')]}).inventoryLinks.length,2);
 for(const links of [[stock(),stock()],[stock(),stock('SYN-2'),stock('SYN-3')],[{...stock(),itemLine:2}],[{...stock(),source:{}}],[{...stock(),shipments:[{inventoryId:'other'}]}]])assert.throws(()=>validatePurchaseOrder({...order(),inventoryLinks:links}));
});
test('competing same-total orders remain separate, and mismatched totals stay visible for review',()=>{
 const a=fixture(),b=fixture({...order(),archiveId:'b'.repeat(64),orderNumber:'1234568'});a.sources.push(b.sources[1]);assert.equal(purchaseCandidates(a,payment).length,2);
 assert.equal(purchaseCandidates(fixture({...order(),total:50000}),payment)[0].amountMatches,false);
});
test('conflicting snapshots of the same order cannot be combined into one complete original',()=>{
 const a=fixture(order(),2),raw=JSON.parse(a.sources[3].text);raw.total=50000;a.sources[3].text=JSON.stringify(raw);a.sources[3].hash=hash(a.sources[3].text);assert.equal(purchaseCandidates(a,payment).length,0);
});
function inventorySource(rows,extra={}){
 const sheet={sheet:'Synthetic inventory',snapshotHash:'c'.repeat(64),exportMode:'original_csv',firstRows:[['','','','','주문번호 혹은 구매처','','','색상/사이즈']],matches:rows.map((v,i)=>({row:i+3,values:['',v[0],'','','1234567','','AB12-CD345',v[1]]})),...extra};
 const text=JSON.stringify(sheet);return {id:'s8',kind:'spreadsheet',title:'inventory / Synthetic inventory',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=10',text,hash:hash(text)};
}
const variantOrder=()=>({...order(),items:[{...order().items[0],color:'BLUE (no.01)'}]});
function prefixSource(reference,rows=[['SYN-1','01-2'],['SYN-2','01-2']]){
 const source=inventorySource(rows),raw=JSON.parse(source.text);
 for(const row of raw.matches)row.values[4]=reference;
 source.text=JSON.stringify(raw);source.hash=hash(source.text);return source;
}
test('warehouse-prefixed references match the exact order and preserve captured source text',()=>{
 for(const reference of ['OSAKA YAMATO 1234567',' osaka  yamato  1234567 ']){
  const r=fixture(variantOrder());r.sources.push(prefixSource(reference));const c=purchaseCandidates(r,payment)[0];
  assert.equal(c.inventoryCount,2);assert.equal(c.requiresInventoryReview,false);
  assert.equal(JSON.parse(c.evidence.find(s=>s.id==='s8').text).matches[0].values[4],reference);
 }
});
test('prefixed references reject different orders, multiple numbers and arbitrary text',()=>{
 for(const reference of ['OSAKA YAMATO 12345678','OSAKA YAMATO 1234567 / 1234568','OTHER 1234567','1234567 EXTRA']){
  const r=fixture(variantOrder());r.sources.push(prefixSource(reference));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
 }
});
test('prefix support retains variant, duplicate ID and quantity checks',()=>{
 for(const rows of [[['SYN-1','02-2']],[['SYN-1','01-3']],[['SYN-1','01-2'],['SYN-1','01-2']],[['SYN-1','01-2'],['SYN-2','01-2'],['SYN-3','01-2']]]){
  const r=fixture(variantOrder());r.sources.push(prefixSource('OSAKA YAMATO 1234567',rows));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
 }
});
test('spreadsheet joins normalize full hyphenated models and preserve a missing-size review requirement',()=>{
 const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1','01'],['SYN-2','1']]));const c=purchaseCandidates(r,payment)[0];assert.equal(c.inventoryCount,2);assert.equal(c.requiresInventoryReview,true);assert(c.order.inventoryLinks.every(i=>i.requiresReview&&i.status==='candidate'));assert.equal(c.order.inventoryLinks[0].source.inventoryCell,'B3');assert(c.evidence.some(s=>s.id==='s8'));
});

test('empty size after a delimiter remains a reviewable inventory candidate',()=>{
 for(const variant of ['01-','01/']){
  const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1',variant]]));const c=purchaseCandidates(r,payment)[0];
  assert.equal(c.inventoryCount,1);assert.equal(c.requiresInventoryReview,true);
  assert.equal(c.order.inventoryLinks[0].requiresReview,true);assert.equal(c.order.inventoryLinks[0].status,'candidate');
  assert.equal(c.order.items[0].size,'2');
  assert.equal(JSON.parse(c.evidence.find(s=>s.id==='s8').text).matches[0].values[7],variant);
 }
});

test('empty-size candidates retain identity, ambiguity, quantity and duplicate checks',()=>{
 for(const rows of [[['SYN-1','02-']],[['SYN-1','01-'],['SYN-1','01-']],[['SYN-1','01-'],['SYN-2','01-'],['SYN-3','01-']],[['SYN-1','01/-']]]){
  const r=fixture(variantOrder());r.sources.push(inventorySource(rows));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
 }
 for(const [column,value] of [[4,'1234568'],[6,'AB12CD346']]){
  const source=inventorySource([['SYN-1','01-']]),raw=JSON.parse(source.text);raw.matches[0].values[column]=value;source.text=JSON.stringify(raw);source.hash=hash(source.text);
  const r=fixture(variantOrder());r.sources.push(source);assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
 }
 const ambiguous=variantOrder();ambiguous.items.push({...ambiguous.items[0],line:2,size:'3'});
 const r=fixture(ambiguous);r.sources.push(inventorySource([['SYN-1','01-']]));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
});
test('explicit variant mismatch, excess quantities and duplicate inventory identifiers remain unresolved',()=>{
 for(const rows of [[['SYN-1','02-2']],[['SYN-1','01-3']],[['SYN-1','01-2'],['SYN-2','01-2'],['SYN-3','01-2']],[['SYN-1','01-2'],['SYN-1','01-2']]]){const r=fixture(variantOrder());r.sources.push(inventorySource(rows));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0)}
 const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1','01-2']]));assert.equal(purchaseCandidates(r,payment)[0].requiresInventoryReview,false);
});
test('spreadsheet snapshot conflicts, wrong headers and lossy exports cannot create inventory connections',()=>{
 for(const extra of [{firstRows:[]},{exportMode:'query_csv_fallback'}]){const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1','01-2']],extra));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0)}
 const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1','01-2']]),inventorySource([['SYN-1','01-2']],{snapshotHash:'d'.repeat(64)}));assert.equal(purchaseCandidates(r,payment)[0].inventoryCount,0);
});
test('shipping evidence joins only by exact inventory ID in the same captured workbook',()=>{
 const r=fixture(variantOrder());r.sources.push(inventorySource([['SYN-1','01-2']]));const cells=Array(52).fill('');cells[1]='2026/09/25';cells[14]='Synthetic tracking';cells[19]='SYN-1';const header=Array(52).fill('');header[19]='재고번호';const text=JSON.stringify({sheet:'Synthetic shipping',snapshotHash:'e'.repeat(64),exportMode:'original_csv',firstRows:[[],header],matches:[{row:5,values:cells}]});const s={id:'s9',kind:'spreadsheet',title:'shipping / Synthetic shipping',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0',text,hash:hash(text)};r.sources.push(s);assert.equal(purchaseCandidates(r,payment)[0].order.inventoryLinks[0].shipments[0].tracking,'Synthetic tracking');s.url='https://docs.google.com/spreadsheets/d/another/edit#gid=0';assert.equal(purchaseCandidates(r,payment)[0].order.inventoryLinks[0].shipments.length,0);
});

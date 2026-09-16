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

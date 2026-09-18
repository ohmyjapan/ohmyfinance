import test from 'node:test';
import assert from 'node:assert/strict';
import {matchWorkflowInventory} from '../shared/finance-workflow-matching.mjs';
const order = () => ({archiveId:'a'.repeat(64),orderNumber:'1234567',date:'2026-09-01',total:2200,currency:'JPY',cancelled:false,dataQuality:'complete',capturedAt:'2026-09-02T00:00:00Z',items:[{line:1,product:'Test AB12CD345',color:'BLUE (no.01)',size:'2',quantity:2,lineTotal:2200}],inventoryLinks:[]});
function sources(variants=['01-2','01-2']) {
  const rows = [['','','','','주문번호','','','색상/사이즈'],[],...variants.map((v,i)=>['','SYN-'+i,'','','자동구매 1234567','','AB12-CD345',v])];
  const shipping = [[],Array(20).fill(''),Array(20).fill('')];shipping[1][19]='재고번호';shipping[2][19]='SYN-0';shipping[2][9]='SYN-SHIP';shipping[2][14]='123456';shipping[2][1]='2026/09/03';
  return {inventory:{id:'s1',complete:true,name:'Inventory',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=1',rows},shipping:{id:'s2',complete:true,name:'Shipping',url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid=2',rows:shipping}};
}
test('exact inventory and explicit shipping order references advance independent units',()=>{
  const r=matchWorkflowInventory(order(),sources());assert.equal(r.identified,2);assert.deepEqual(r.conflicts,[]);assert.equal(r.order.inventoryLinks[0].shipments[0].orderId,'SYN-SHIP');assert.equal(r.order.inventoryLinks[0].shipments[0].source.orderCell,'J3');assert.equal(r.order.inventoryLinks[1].shipments.length,0);
  const again=matchWorkflowInventory(r.order,sources());assert.equal(again.changed,false);
});
test('unknown sizes remain proposals and cannot displace a confirmed missing-size association',()=>{
  const r=matchWorkflowInventory(order(),sources(['01-','01-2']));assert.equal(r.proposals.length,1);assert.equal(r.identified,1);
  const confirmed={...r.proposals[0],status:'matched'};const next={...order(),inventoryLinks:[confirmed]};
  const second=matchWorkflowInventory(next,sources(['01-','01-2']));assert.equal(second.identified,2);assert.equal(second.order.inventoryLinks[0].requiresReview,true);
});
test('duplicate inventory and quantity conflicts go to review without choosing arbitrary subsets',()=>{
  const s=sources();s.inventory.rows.push([...s.inventory.rows[2]]);assert(matchWorkflowInventory(order(),s).conflicts.some(c=>c.reason==='duplicate_inventory'));
  assert(matchWorkflowInventory(order(),sources(['01-2','01-2','01-2'])).conflicts.some(c=>c.reason==='quantity_exceeded'));
});
test('contradictory shipping references are retained as conflicts, not accepted',()=>{
  const s=sources();s.shipping.rows.push([...s.shipping.rows[2]]);s.shipping.rows[3][9]='SYN-OTHER';s.shipping.rows[3][14]='654321';
  assert(matchWorkflowInventory(order(),s).conflicts.some(c=>c.reason==='multiple_shipments'));
});
test('truncated or changed source layouts cannot produce inventory matches',()=>{
  const s=sources();s.inventory.complete=false;assert.throws(()=>matchWorkflowInventory(order(),s));
  const t=sources();t.shipping.rows[1][19]='Other header';assert.throws(()=>matchWorkflowInventory(order(),t));
});
test('confirmed model, shipping order, shipping date and removed shipping evidence cannot silently change',()=>{
 const confirmed=matchWorkflowInventory(order(),sources()).order;
 const model=sources();model.inventory.rows[2][6]='AB12CD999';assert(matchWorkflowInventory(confirmed,model).conflicts.some(c=>c.reason==='confirmed_inventory_changed'));
 for(const update of [s=>s.shipping.rows[2][9]='OTHER-SHIP',s=>s.shipping.rows[2][1]='2026/09/04',s=>s.shipping.rows.pop()]){const s=sources();update(s);assert(matchWorkflowInventory(confirmed,s).conflicts.some(c=>c.reason==='shipment_changed'));}
 const extra=order();extra.items[0].quantity=1;extra.items.push({line:2,product:'Test AB12CD999',color:'BLUE (no.01)',size:'2',quantity:2,lineTotal:0});assert(matchWorkflowInventory(extra,sources()).conflicts.some(c=>c.reason==='quantity_exceeded'&&c.itemLine===1));
});
test('confirmed offline inventory can gain shipping evidence without an invented order number',()=>{
 const s=sources(['01-2']);s.inventory.rows[2][4]='TOKYO';
 const receipt={...order(),kind:'receipt',orderNumber:'',receipt:{hash:'c'.repeat(64),record:0,number:'',merchant:'Synthetic'},inventoryLinks:[{inventoryId:'SYN-0',itemLine:1,quantity:1,status:'matched',source:{sheet:'Inventory',row:3,inventoryCell:'B3',reference:'TOKYO',itemModel:'AB12CD345',itemVariant:'01-2'},shipments:[]}]};
 const matched=matchWorkflowInventory(receipt,s);assert.equal(matched.changed,true);assert.deepEqual(matched.conflicts,[]);assert.equal(matched.order.orderNumber,'');assert.equal(matched.order.inventoryLinks[0].shipments[0].orderId,'SYN-SHIP');
});

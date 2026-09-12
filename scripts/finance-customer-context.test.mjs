import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPurchaseContexts } from '../shared/finance-customer-context.mjs';
const customer={_id:'customer-a',name:'Synthetic customer'},record={_id:'context-a',customerId:customer._id,kind:'purchase_workflow',scope:'current_workflow',status:'confirmed',revision:1,confirmedAt:'2026-09-12T00:00:00Z',routes:['business_orders_and_ships_requested_items','customer_shop_account_business_card'],sourceQuestion:'How are orders placed?',sourceQuote:'I place orders or the customer uses their own shop account with our card.'};
test('workflow evidence preserves provenance, both routes, and the distinction from purchase decisions',()=>{
 const rows=[{...record,audit:['private audit'],accountCategoryId:'not-an-output',taxRate:10}],before=structuredClone(rows),result=customerPurchaseContexts(rows,[customer],customer._id);
 assert.deepEqual(rows,before);assert.equal(result.length,1);assert.equal(result[0].routes.length,2);assert.equal(result[0].sourceQuote,record.sourceQuote);assert.equal(result[0].sourceQuestion,record.sourceQuestion);assert.ok(result[0].scope.includes('この明細'));assert.ok(!JSON.stringify(result).includes('private audit'));assert.equal(result[0].accountCategoryId,undefined);assert.equal(result[0].taxRate,undefined);
});
test('inactive, unrelated, withdrawn and conflicting customer notes are excluded',()=>{
 for(const customers of [[],[{...customer,isActive:false}]])assert.deepEqual(customerPurchaseContexts([record],customers),[]);
 assert.deepEqual(customerPurchaseContexts([record],[customer],'customer-b'),[]);
 assert.deepEqual(customerPurchaseContexts([{...record,status:'withdrawn'}],[customer]),[]);
 assert.deepEqual(customerPurchaseContexts([record,{...record,_id:'conflicting-context'}],[customer]),[]);
});
test('unsupported routes and malformed confirmation evidence cannot enter consultation context',()=>{
 for(const patch of [{kind:'classification'},{scope:'all_purchases'},{routes:['unknown']},{routes:['__proto__']},{routes:[]},{routes:[record.routes[0],record.routes[0]]},{sourceQuote:''},{sourceQuote:'x'.repeat(2001)},{sourceQuestion:'bad\x00quote'},{revision:0},{confirmedAt:'unknown'}])assert.deepEqual(customerPurchaseContexts([{...record,...patch}],[customer]),[]);
});

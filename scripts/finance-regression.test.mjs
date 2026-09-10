import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADERS,parseAmex,dateOnly,csvRows,parseAmount,period } from '../shared/amex.mjs';
const csv=rows=>Buffer.from([HEADERS,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
const row=(changes={})=>Object.assign(['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1,234','',''],changes);
test('all source values survive quoted commas, line breaks and repeated identical purchases',()=>{
  const first=row({2:'Shop, "A"\nSecond line',4:'-12345',6:'USD 10.00',7:'123.40'});
  const parsed=parseAmex(csv([first,first,row({4:'23456'})]),['12345','23456']);
  assert.equal(parsed.rows.length,3);assert.equal(parsed.rows[0].amount,1234);assert.equal(parsed.rows[0].description,first[2]);assert.equal(parsed.rows[0].foreignAmount,'USD 10.00');
  assert.equal(parsed.rows[0].fingerprint,parsed.rows[1].fingerprint);assert.notEqual(parsed.rows[0].key,parsed.rows[1].key);assert.equal(parsed.rows[1].occurrence,2);assert.equal(parsed.rows[2].cardIdentifier,'23456');
  assert.equal(parsed.rows[0].raw['会員番号 #'],'-12345');assert.equal(parsed.rows[0].cardIdentifier,'12345');
});
test('repayments, refunds and zero amounts are never classified as new spending',()=>{
  const parsed=parseAmex(csv([row({2:'前回分口座振替金額',5:'-1234'}),row({2:'Refund',5:'-100'}),row({5:'0'})]),['12345']);
  assert.deepEqual(parsed.rows.map(r=>r.kind),['repayment','credit_review','credit_review']);assert.equal(parsed.rows[0].amount,-1234);
});
test('unknown cards, malformed amounts, malformed CSV and impossible dates fail closed',()=>{
  assert.throws(()=>parseAmex(csv([row()]),['99999']));
  for(const amount of ['1,23','1e3','NaN','100 JPY','--20',''])assert.throws(()=>parseAmount(amount));
  for(const date of ['2026/02/30','2026/13/01','08/01/2026'])assert.throws(()=>dateOnly(date));
  assert.throws(()=>csvRows('a,"unfinished'));assert.throws(()=>csvRows('a,"closed"bad'));
  assert.throws(()=>parseAmex(csv([row({0:'2026/02/30'})]),['12345']));
  assert.throws(()=>period({kind:'statement',start:'2026-08-31',end:'2026-08-01'}));
});
test('purchase dates before a statement start are preserved',()=>{
  const parsed=parseAmex(csv([row({0:'2026/07/01'})]),['12345']);const coverage=period({kind:'statement',start:'2026-07-19',end:'2026-08-18'});
  assert.ok(parsed.rows[0].purchaseDate<coverage.start);assert.equal(parsed.rows[0].purchaseDate,'2026-07-01');
});

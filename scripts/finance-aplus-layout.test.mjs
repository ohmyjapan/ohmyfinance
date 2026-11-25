import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADERS, parseAplus } from '../shared/aplus.mjs';
import { digest } from '../shared/amex.mjs';

const newHeaders = [HEADERS[0], '請求月', HEADERS[1], HEADERS[2], 'ご利用金額', ...HEADERS.slice(4)];
const oldRow = ['≪****-****-****-1234≫', '20260110', '架空店', '120', 'Ｓ', '1', '01', '120', ''];
const newRow = [oldRow[0], '202602', ...oldRow.slice(1)];
const metadata = {kind:'statement', statementMonth:'2026-02', statementTotal:120};
const csv = (headers, rows) => Buffer.from('\uFEFF'+[headers,...rows].map(row=>row.map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n');
const parse = (headers, rows, overrides={}) => parseAplus(csv(headers,rows),['1234'],{...metadata,...overrides});

test('both issuer layouts retain original fields, byte hash and transaction identity',()=>{
  const old = parse(HEADERS,[oldRow]), bytes = csv(newHeaders,[newRow]), original = Buffer.from(bytes);
  const newer = parseAplus(bytes,['1234'],metadata);
  assert.equal(old.parserVersion,'aplus-jp-2');
  assert.equal(newer.parserVersion,'aplus-jp-3');
  assert.deepEqual(bytes,original);
  assert.equal(newer.sha256,digest(original));
  assert.equal(old.rows[0].key,newer.rows[0].key);
  assert.equal(newer.reconciliation.statementTotal,120);
  assert.deepEqual(Object.entries(newer.rows[0].raw),newHeaders.map((h,i)=>[h,newRow[i]]));
  assert.deepEqual(Object.entries(old.rows[0].raw),HEADERS.map((h,i)=>[h,oldRow[i]]));
});
test('the new billing month must agree on every row, including account-level adjustments',()=>{
  for(const value of ['202601','202613','2026/02','', '2026020']){
    assert.throws(()=>parse(newHeaders,[newRow,newRow.with(1,value)],{statementTotal:240}),/請求月/);
  }
  assert.throws(()=>parse(newHeaders,[newRow,['','202601','','年会費','10','','','','10','']],{statementTotal:130}),/請求月/);
});
test('new statements retain the annual fee, account deposit and both repeated purchases',()=>{
  const fee=['','202602','','年会費','40','','','','40',''];
  const deposit=['','202602','','ご入金','-30','','','','-30',''];
  const result=parse(newHeaders,[newRow,newRow,fee,deposit],{statementTotal:250});
  const [one,two,annual,credit]=result.rows;
  assert.equal(one.fingerprint,two.fingerprint);
  assert.deepEqual([one.key,two.key],[one.fingerprint+':1',one.fingerprint+':2']);
  assert.equal(annual.raw['請求月'],'202602');
  assert.equal(annual.cardIdentifier,null);
  assert.equal(annual.paymentAmount,40);
  assert.equal(credit.kind,'credit_review');
  assert.equal(result.reconciliation.accountAdjustmentTotal,-30);
});
test('unknown and mixed schemas, card mismatches, future dates and unreconciled totals refuse',()=>{
  for(const [h,r] of [[newHeaders.with(4,'ご利用金'),newRow],[HEADERS.with(3,'ご利用金額'),oldRow],[newHeaders.with(1,'対象月'),newRow],[newHeaders.toReversed(),newRow]]) {
    assert.throws(()=>parse(h,[r]),/対応するAplus確定明細CSVではありません/);
  }
  for(const [h,r] of [[newHeaders,oldRow],[HEADERS,newRow]]){
    assert.throws(()=>parse(h,[r]),/2行目: 列数が一致しません/);
  }
  assert.throws(()=>parse(newHeaders,[newRow.with(0,'≪****-****-****-9999≫')]),/カード/);
  assert.throws(()=>parse(newHeaders,[newRow.with(2,'20260301')]),/利用日/);
  assert.throws(()=>parse(newHeaders,[newRow],{statementTotal:119}),/合計/);
});

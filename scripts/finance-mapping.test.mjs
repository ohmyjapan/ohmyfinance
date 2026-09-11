import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADERS, parseAmex } from '../shared/amex.mjs';
import { mappingRows } from '../shared/finance-mapping.mjs';
const csv = Buffer.from([HEADERS, ...[
  ['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1234','',''],
  ['2026/08/01','2026/08/03','Synthetic shop','Test user','12345','1234','',''],
  ['2026/08/02','2026/08/04','Company service','Test user','12345','99','',''],
  ['2026/08/02','2026/08/04','前回分口座振替金額','Test user','12345','-999','',''],
  ['2026/08/02','2026/08/04','Refund','Test user','12345','-99','','']
]].map(row => row.join(',')).join('\r\n'));
function fixture() {
  const parsed = parseAmex(csv, ['12345']);
  return { hash: parsed.sha256, rows: parsed.rows, mappingPreview: { version: 1, sourceHash: parsed.sha256, rows: parsed.rows.map((row, i) => ({ line: row.line, key: row.key, purpose: i < 2 ? 'customer' : i === 2 ? 'company' : row.kind, clientCode: i < 2 ? 'CLIENT-A' : '', clientName: i < 2 ? 'Synthetic client' : '', category: i < 2 ? '商品代金' : '', reason: 'Synthetic reviewed source', source: { sheet: 'data', rows: i < 2 ? [10, 11] : [i + 10], client: i < 2 ? 'Synthetic client' : '', category: '', card: 'Synthetic card' } })) } };
}
test('preview preserves occurrences, processing and purchase dates, blank company clients and repayment exclusions', () => {
  const input = fixture(), before = JSON.stringify(input), rows = mappingRows(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(rows.length, 5); assert.notEqual(rows[0].key, rows[1].key);
  assert.deepEqual(rows[0].source.rows, [10, 11]);
  assert.equal(rows[0].processingDate, '2026-08-03'); assert.equal(rows[0].purchaseDate, '2026-08-01');
  assert.equal(rows[2].clientCode, ''); assert.equal(rows[2].purpose, 'company');
  assert.deepEqual(rows.map(row => row.status), ['proposed', 'proposed', 'needs_category', 'repayment', 'credit_review']);
  assert.equal(rows[3].amount, -999); assert.equal(rows[3].category, '');
});
test('unprepared customer identity remains unresolved rather than becoming a company expense', () => {
  const input = fixture(); delete input.mappingPreview;
  const rows = mappingRows(input);
  assert.equal(rows[0].purpose, 'unresolved'); assert.equal(rows[0].status, 'needs_client');
  assert.equal(rows[3].purpose, 'repayment');
});
test('mismatched, missing, repeated or corrupted source bindings fail closed', () => {
  for (const change of [
    v => { v.mappingPreview.sourceHash = 'wrong'; },
    v => { v.mappingPreview.rows.pop(); },
    v => { v.mappingPreview.rows[0].key = v.mappingPreview.rows[1].key; },
    v => { v.mappingPreview.rows[1] = v.mappingPreview.rows[0]; },
    v => { v.mappingPreview.rows[3].purpose = 'company'; },
    v => { v.mappingPreview.rows[2].clientCode = 'CLIENT-B'; },
    v => { v.mappingPreview.rows[3].category = '商品代金'; },
    v => { v.mappingPreview.rows[0].source.rows = [10, 10]; }
  ]) { const input = fixture(); change(input); assert.throws(() => mappingRows(input)); }
});

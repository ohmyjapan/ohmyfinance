// The ten prototype model cases (output/omf-intake-platform-20261016/model.test.cjs) against shared/finance-intake.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, planImport, applyPlan, mappedRows, guessMapping, FIELDS } from '../shared/finance-intake.mjs';

const proof = (row = 2, hash = 'a') => ({ hash, fileName: 'daily.xlsx', documentId: hash, sheet: 'Sheet1', row, raw: [] });
const row = (values, provenance) => ({ values: normalize(values), provenance });
const defaults = { service: '自社受付', account: '', currency: 'JPY' };

test('an incomplete manual entry can be captured before merchant, amount or external ID is known', () => {
  const q = planImport([], [row({ description: 'URLから内容確認' })]);
  assert.equal(q.new, 1); assert.equal(q.rows[0].record.values.amount, ''); assert.equal(q.rows[0].record.values.merchant, ''); assert.equal(q.rows[0].record.values.orderId, ''); assert.equal(q.rows[0].record.values.purchaseState, 'requested');
});
test('service, account and item identity distinguish purchases with the same order number', () => {
  const records = applyPlan([], planImport([], [row({ service: 'A', account: 'one', orderId: '0001', itemId: '01' }), row({ service: 'B', account: 'one', orderId: '0001', itemId: '01' }), row({ service: 'A', account: 'two', orderId: '0001', itemId: '01' }), row({ service: 'A', account: 'one', orderId: '0001', itemId: '02' })]));
  assert.equal(records.length, 4); assert.equal(new Set(records.map(r => r.key)).size, 4); assert.equal(records[0].values.orderId, '0001');
});
test('identical file reimport neither duplicates a record nor grows its history', () => {
  const incoming = [row({ service: 'A', orderId: '001', amount: '12800' }, proof())], first = applyPlan([], planImport([], incoming)), again = planImport(first, incoming);
  assert.equal(again.new, 0); assert.equal(again.update, 0); assert.equal(again.unchanged, 1); assert.equal(applyPlan(first, again).length, 1); assert.equal(again.rows[0].record.history.length, 1);
});
test('a partial file correction preserves known merchant and purchased state when their cells are blank', () => {
  const original = applyPlan([], planImport([], [row({ orderId: '001', merchant: 'Confirmed shop', amount: '12800', purchaseState: 'purchased' }, proof())]));
  const incoming = mappedRows([['001', '', '13000', '']], { orderId: '0', merchant: '1', amount: '2', purchaseState: '3' }, defaults, { ...proof(2, 'b'), firstRow: 2 });
  const result = planImport(original, incoming), v = result.rows[0].record.values;
  assert.equal(result.new, 0); assert.equal(v.amount, '13000'); assert.equal(v.merchant, 'Confirmed shop'); assert.equal(v.purchaseState, 'purchased'); assert.equal(result.rows[0].record.provenance.length, 2); assert.equal(original[0].values.amount, '12800');
});
test('unmapped fields do not reset a completed purchase', () => {
  const original = applyPlan([], planImport([], [row({ orderId: '001', purchaseState: 'purchased' }, proof())]));
  const incoming = mappedRows([['001', 'new description']], { orderId: '0', description: '1' }, defaults, { ...proof(2, 'b'), firstRow: 2 });
  assert.equal(planImport(original, incoming).rows[0].record.values.purchaseState, 'purchased');
});
test('duplicate IDs without item differentiation preserve each source row and flag identity review', () => {
  const incoming = [row({ orderId: '001', description: 'item A' }, proof(2)), row({ orderId: '001', description: 'item B' }, proof(3))], first = planImport([], incoming), records = applyPlan([], first);
  assert.equal(records.length, 2); assert.equal(first.ambiguous, 2); assert.ok(records.every(r => r.identityReview)); assert.deepEqual(records.map(r => r.values.description), ['item A', 'item B']);
  const repeat = planImport(records, incoming); assert.equal(repeat.new, 0); assert.equal(repeat.unchanged, 2);
});
test('no-ID imports remain distinct by source row, with repeat-file identity and explicit review state', () => {
  const incoming = [row({ description: 'A' }, proof(2)), row({ description: 'B' }, proof(4))], records = applyPlan([], planImport([], incoming));
  assert.equal(records.length, 2); assert.ok(records.every(r => r.identityReview)); assert.equal(planImport(records, incoming).unchanged, 2);
});
test('normalization preserves zero amounts, signed refunds, identifiers and date meaning', () => {
  const v = normalize({ orderId: '000012', itemId: 'A-01', amount: '￥0', purchaseDate: '2026年10月3日' });
  assert.equal(v.orderId, '000012'); assert.equal(v.amount, '0'); assert.equal(v.purchaseDate, '2026-10-03'); assert.equal(normalize({ amount: '-12,800' }).amount, '-12800');
});
test('blank spreadsheet rows do not shift the recorded original row numbers', () => {
  const rows = mappedRows([['001'], [''], ['002']], { orderId: '0' }, { service: 'A' }, { ...proof(), firstRow: 5 }).filter(r => r.provenance.raw.some(Boolean));
  assert.deepEqual(rows.map(r => r.provenance.row), [5, 7]);
});
test('revised source documents append provenance while keeping one purchase identity', () => {
  const records = applyPlan([], planImport([], [row({ orderId: '001', amount: '100' }, proof(2, 'a'))]));
  const result = planImport(records, [row({ orderId: '001', amount: '120' }, proof(6, 'b'))]);
  assert.equal(applyPlan(records, result).length, 1); assert.equal(result.rows[0].record.provenance.length, 2); assert.equal(result.rows[0].record.history.at(-1).changes.find(c => c.field === 'amount').before, '100');
});
test('header guessing maps the prototype aliases onto the thirteen fields by column index', () => {
  const mapping = guessMapping(['注文番号', '商品名', '購入金額', '購入状況', 'unknown column']);
  assert.equal(mapping.orderId, '0'); assert.equal(mapping.description, '1'); assert.equal(mapping.amount, '2'); assert.equal(mapping.purchaseState, '3'); assert.equal(mapping.merchant, '');
  assert.equal(FIELDS.length, 13); assert.deepEqual(Object.keys(mapping), FIELDS.map(f => f[0]));
});

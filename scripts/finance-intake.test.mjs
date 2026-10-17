// The ten prototype model cases (output/omf-intake-platform-20261016/model.test.cjs) against shared/finance-intake.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, planImport, applyPlan, mappedRows, guessMapping, FIELDS, MONEY } from '../shared/finance-intake.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// The normal tests import the actual worker module. The two explicit mutant runs load the same bytes with one
// reviewed change reverted; absolute imports preserve the original dependencies without touching source files.
async function researchToolsClass() {
  const moduleUrl = new URL('../research-worker/tools.mjs', import.meta.url);
  const mutant = process.env.OMF_TEST_INTAKE_TOOLS_MUTANT;
  if (!mutant) return (await import(moduleUrl.href)).ResearchTools;
  const changes = {
    'intake-route': ["this.job.mode==='intake'?'intake/':''", "''"],
    'intake-artifact': ["&&this.job.mode!=='intake'", '']
  };
  assert.ok(changes[mutant], 'known intake tools mutant');
  let source = await readFile(moduleUrl, 'utf8');
  const [before, after] = changes[mutant];
  assert.equal(source.split(before).length - 1, 1, 'mutant anchors exactly once');
  source = source.replace(before, after)
    .replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (_, quote, specifier) => 'from '+JSON.stringify(new URL(specifier,moduleUrl).href))
    .replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).ResearchTools;
}

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
test('header guessing maps the prototype aliases onto the twenty fields by column index', () => {
  const mapping = guessMapping(['注文番号', '商品名', '購入金額', '購入状況', 'unknown column']);
  assert.equal(mapping.orderId, '0'); assert.equal(mapping.description, '1'); assert.equal(mapping.amount, '2'); assert.equal(mapping.purchaseState, '3'); assert.equal(mapping.merchant, '');
  assert.equal(FIELDS.length, 20); assert.deepEqual(Object.keys(mapping), FIELDS.map(f => f[0]));
});
test('the eight owner fields are guessed from their headers and the five money fields are cleaned alike', () => {
  const mapping = guessMapping(['注文番号', '商品ID', '外部注文番号', 'URL', '商品価格', '税額', '送料', '手数料', '担当者']);
  assert.deepEqual([mapping.orderId, mapping.itemId, mapping.externalOrderId, mapping.merchantUrl, mapping.itemPrice, mapping.tax, mapping.shippingFee, mapping.otherFee], ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.ok(!Object.values(mapping).includes('8'), 'an unknown header stays unmapped');
  assert.deepEqual(MONEY, ['amount', 'itemPrice', 'tax', 'shippingFee', 'otherFee']);
  const v = normalize({ amount: '12,800', itemPrice: '¥1,000', tax: '￥0', shippingFee: '1 200', otherFee: '-500' });
  assert.deepEqual([v.amount, v.itemPrice, v.tax, v.shippingFee, v.otherFee], ['12800', '1000', '0', '1200', '-500']);
});
test('identifiers and the research fields stay trimmed strings', () => {
  const v = normalize({ externalOrderId: ' 000777 ', invoiceNumber: 'T1234567890123', supplierName: ' Synthetic 株式会社 ' });
  assert.equal(v.externalOrderId, '000777'); assert.equal(v.invoiceNumber, 'T1234567890123'); assert.equal(v.supplierName, 'Synthetic 株式会社');
});
test('extra columns ride the same present/keep-blank rule and are labelled extra:<name> in changes', () => {
  const extras = [{ name: '担当者', column: '1' }];
  const rows = mappedRows([['001', '山田'], ['002', '']], { orderId: '0' }, defaults, { ...proof(), firstRow: 2 }, extras);
  assert.equal(rows[0].extra['担当者'], '山田'); assert.ok(rows[0].present.includes('extra:担当者'));
  assert.equal(rows[1].extra['担当者'], ''); assert.ok(!rows[1].present.includes('extra:担当者'));
  const records = applyPlan([], planImport([], rows));
  assert.equal(records.find(r => r.values.orderId === '001').extra['担当者'], '山田');
  assert.deepEqual(records.find(r => r.values.orderId === '002').extra, {}, 'a blank extra cell is not stored on a new record');
  const blank = planImport(records, mappedRows([['001', '']], { orderId: '0' }, defaults, { ...proof(2, 'b'), firstRow: 2 }, extras));
  assert.equal(blank.rows[0].record.extra['担当者'], '山田', 'a blank extra cell keeps the stored value');
  assert.equal(blank.rows[0].changes.length, 0);
  const changed = planImport(records, mappedRows([['001', '田中']], { orderId: '0' }, defaults, { ...proof(2, 'c'), firstRow: 2 }, extras));
  assert.equal(changed.rows[0].record.extra['担当者'], '田中');
  assert.deepEqual(changed.rows[0].changes, [{ field: 'extra:担当者', before: '山田', after: '田中' }]);
  assert.equal(records[0].extra['担当者'], '山田', 'the stored record is not mutated');
});

test('intake research tools preserve extracted PDF evidence without requesting an artifact upload', async t => {
  const ResearchTools = await researchToolsClass(), directory = await mkdtemp(path.join(os.tmpdir(),'omf-intake-tools-'));
  const calls = [], bytes = Buffer.from('%PDF-1.4\nfictional fixture'), config = {baseUrl:'https://omf.example.invalid',token:'fictional-worker-token'};
  t.mock.method(globalThis,'fetch',async (url,options) => {calls.push({url,options});return Response.json({success:true});});
  let extracts = 0;
  const tools = new ResearchTools(config,{id:'fictional-intake',mode:'intake',lease:'fictional-lease',sources:[]},directory,{extract:async (received,mime,input) => {
    extracts++;assert.equal(received,config);assert.equal(mime.mimeType,'application/pdf');assert.deepEqual(input,bytes);
    return {pages:[{page:1,text:'Fictional company T1234567890123'}],records:[]};
  }});
  try {
    const source = await tools.document(bytes,'application/pdf','company.pdf','https://merchant.example.invalid/company.pdf');
    assert.equal(extracts,1);assert.equal(source.kind,'document');assert.match(source.text,/Fictional company T1234567890123/);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'evidence.json'),'utf8')).sources,[source]);
    assert.equal(calls.length,0,'intake-tools:no-artifact-upload');
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('intake research tools send progress to the intake route with the lease', async t => {
  const ResearchTools = await researchToolsClass(), calls = [];
  t.mock.method(globalThis,'fetch',async (url,options) => {calls.push({url,options});return Response.json({success:true});});
  const tools = new ResearchTools({baseUrl:'https://omf.example.invalid',token:'fictional-worker-token'},{id:'fictional-intake',mode:'intake',lease:'fictional-lease',sources:[]},os.tmpdir());
  assert.deepEqual(await tools.api('progress',{stage:'document'}),{success:true});assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://omf.example.invalid/api/finance-research/worker/intake/fictional-intake/progress','intake-tools:progress-route');
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.headers.Authorization,'Bearer fictional-worker-token');
  assert.deepEqual(JSON.parse(calls[0].options.body),{stage:'document',lease:'fictional-lease'});
});

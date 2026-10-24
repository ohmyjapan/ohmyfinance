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
test('B2 (plan omf-workflow-daily-20261025 Phase C): the exact orderno / itemseqno export headers are guessed; no alias names two fields; an explicit mapping still decides', () => {
  const headers = ['orderno', 'itemseqno', 'externalorderno', 'website URL', 'itemprice', 'tax', 'shipping', 'otherfee'];
  const mapping = guessMapping(headers);
  assert.deepEqual([mapping.orderId, mapping.itemId, mapping.externalOrderId, mapping.merchantUrl, mapping.itemPrice, mapping.tax, mapping.shippingFee, mapping.otherFee], ['0', '1', '2', '3', '4', '5', '6', '7'], 'b2:exact-headers');
  for (const [h, field] of [['order_no', 'orderId'], ['Order No', 'orderId'], ['item_seq_no', 'itemId'], ['itemseq', 'itemId'], ['ITEM SEQ NO', 'itemId']]) assert.equal(guessMapping(['x', h])[field], '1', 'b2:alias ' + h);
  assert.equal(guessMapping(['orderno', 'externalorderno']).externalOrderId, '1', 'b2:externalorderno stays external');
  assert.equal(guessMapping(['orderno', 'externalorderno']).orderId, '0', 'b2:orderno stays the order');
  const n = s => String(s).trim().toLowerCase().replace(/[\s・（）()_-]/g, ''), owner = new Map();
  for (const [field, label, aliases] of FIELDS) for (const a of [label, ...aliases]) { const k = n(a); assert.ok(!owner.has(k) || owner.get(k) === field, 'b2:alias-collision ' + a + ' → ' + owner.get(k) + ' and ' + field); owner.set(k, field); }
  // The guess is only a suggestion: the owner's explicit mapping (or a saved template's) is what mappedRows reads, and identifiers keep
  // their leading zeros; blank or absent cost cells stay blank and the all-in amount is never summed from them.
  const rows = mappedRows([['000123', '0007', 'EXT-01', 'https://shop.example.invalid/i/1', '1000', '', '', '']], { ...mapping, orderId: '2', itemId: '1' }, defaults, { hash: 'b2', fileName: 'b2.csv', documentId: 'b2', sheet: 'Sheet1', firstRow: 2 });
  assert.deepEqual([rows[0].values.orderId, rows[0].values.itemId], ['EXT-01', '0007'], 'b2:explicit-mapping-authoritative');
  const guessed = mappedRows([['000123', '0007', 'EXT-01', 'https://shop.example.invalid/i/1', '1000', '', '', '']], mapping, defaults, { hash: 'b2', fileName: 'b2.csv', documentId: 'b2', sheet: 'Sheet1', firstRow: 2 })[0].values;
  assert.deepEqual([guessed.orderId, guessed.itemId, guessed.externalOrderId], ['000123', '0007', 'EXT-01'], 'b2:leading-zeros');
  assert.deepEqual([guessed.itemPrice, guessed.tax, guessed.shippingFee, guessed.otherFee, guessed.amount ?? ''], ['1000', '', '', '', ''], 'b2:unknown-costs-stay-blank');
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

// Plan omf-monthly-reconciliation-20261020 F1: purchase-date normalization and same-file provenance reimport.
test('F1 unambiguous year-first purchase dates with a trailing time normalize; ambiguous, zoned or invalid input is kept', () => {
  const d = v => normalize({ purchaseDate: v }).purchaseDate;
  assert.equal(d('2026/10/5 12:00'), '2026-10-05', 'monthly:f1-unit-datetime-slash');
  assert.equal(d('2026/10/05 09:30:15'), '2026-10-05', 'monthly:f1-unit-datetime-seconds');
  assert.equal(d('2026-10-05T12:00:00'), '2026-10-05', 'monthly:f1-unit-iso-datetime');
  assert.equal(d('2026-10-5'), '2026-10-05', 'monthly:f1-unit-iso-single-digit');
  assert.equal(d('2026-10-05 12:00'), '2026-10-05', 'monthly:f1-unit-iso-space-time');
  for (const [input, out] of [['2026-10-05', '2026-10-05'], ['2026年10月3日', '2026-10-03'], ['2026.1.2', '2026-01-02'], ['2026/10/5', '2026-10-05']]) assert.equal(d(input), out, 'monthly:f1-unit-existing ' + input);
  for (const kept of ['10/5/26', '5/10/2026', '2026-10-05T03:00:00Z', '2026-10-05T12:00:00+09:00', '2026/02/30', '2026/10/5 25:00', '令和8年10月5日', '']) assert.equal(d(kept), kept, 'monthly:f1-unit-kept ' + kept);
  const ids = normalize({ orderId: '1.23457E+11', itemId: '00123', externalOrderId: '000777', amount: '1.5E+3' });
  assert.deepEqual([ids.orderId, ids.itemId, ids.externalOrderId], ['1.23457E+11', '00123', '000777'], 'monthly:f1-unit-identifiers-not-guessed');
});
test('F1 a same-file reimport whose corrected reading changes the ID updates the one row it came from', () => {
  const legacyProof = { hash: 'f'.repeat(64), fileName: 'legacy.xlsx', documentId: 'doc', sheet: 'Sheet1', row: 2, raw: ['1.23457E+11', 'Legacy row', '1500'] };
  const values = id => ({ service: 'OWN', account: 'DEMO', orderId: id, description: 'Legacy row', amount: '1500' });
  const legacy = applyPlan([], planImport([], [{ values: normalize(values('1.23457E+11')), provenance: legacyProof }], { id: () => 'legacy-id' }));
  const reread = { ...legacyProof, raw: ['123456789012', 'Legacy row', '1500'] };
  // Fold (review omf-monthly-patch-opus55-20261020 F1): the import passes the reading it maps the rows with, so the stored row's
  // identity under it can be compared with the record's key.
  const reading = { mapping: { orderId: '0', description: '1', amount: '2' }, defaults: { service: 'OWN', account: 'DEMO' } };
  const corrected = planImport(legacy, [{ values: normalize(values('123456789012')), provenance: { ...legacyProof, raw: ['123456789012', 'Legacy row', '1500'] } }], { id: () => 'new-id', reading });
  assert.deepEqual([corrected.new, corrected.update], [0, 1], 'monthly:f1-unit-rebind-update');
  const row = corrected.rows[0];
  assert.equal(row.record.id, 'legacy-id', 'monthly:f1-unit-rebind-same-id');
  assert.equal(row.record.values.orderId, '123456789012');
  assert.equal(row.record.key, JSON.stringify(['OWN', 'DEMO', '123456789012', '']), 'monthly:f1-unit-rebind-key');
  assert.deepEqual(row.identityChanged, { before: legacy[0].key, after: row.record.key, by: 'file-row' }, 'monthly:f1-unit-identity-shown');
  assert.equal(row.record.provenance.length, 1, 'monthly:f1-unit-provenance-not-duplicated');
  assert.deepEqual(row.record.history.at(-1).changes.find(c => c.field === 'orderId'), { field: 'orderId', before: '1.23457E+11', after: '123456789012' }, 'monthly:f1-unit-history-change');
  assert.equal(row.record.revision, legacy[0].revision + 1, 'monthly:f1-unit-revision');
  assert.equal(applyPlan(legacy, corrected).length, 1, 'monthly:f1-unit-no-duplicate');
  assert.equal(legacy[0].values.orderId, '1.23457E+11', 'the stored record is not mutated by planning');
  // A different file never rebinds; a held key wins over the file row and the collision stays visible; two rows sharing one file row stay apart.
  assert.equal(planImport(legacy, [{ values: normalize(values('123456789012')), provenance: { ...legacyProof, hash: 'e'.repeat(64) } }]).new, 1, 'monthly:f1-unit-other-file-new');
  const held = applyPlan(legacy, planImport(legacy, [{ values: normalize(values('123456789012')) }], { id: () => 'manual-id' }));
  const collision = planImport(held, [{ values: normalize(values('123456789012')), provenance: reread }]);
  assert.equal(collision.rows[0].record.id, 'manual-id', 'monthly:f1-unit-collision-key-wins');
  assert.deepEqual(collision.rows[0].provenanceConflict, ['legacy-id'], 'monthly:f1-unit-collision-visible');
  assert.equal(collision.rows[0].record.identityReview, true, 'monthly:f1-unit-collision-review');
  assert.equal(applyPlan(held, collision).find(r => r.id === 'legacy-id').values.orderId, '1.23457E+11', 'monthly:f1-unit-collision-no-merge');
  const twice = [...legacy, { ...structuredClone(legacy[0]), id: 'twin-id', key: JSON.stringify(['OWN', 'DEMO', 'other', '']) }];
  const ambiguous = planImport(twice, [{ values: normalize(values('123456789012')), provenance: reread }], { id: () => 'fresh-id' });
  assert.deepEqual([ambiguous.new, ambiguous.rows[0].record.id, ambiguous.rows[0].record.identityReview], [1, 'fresh-id', true], 'monthly:f1-unit-ambiguous-provenance-new');
  assert.deepEqual([...ambiguous.rows[0].provenanceConflict].sort(), ['legacy-id', 'twin-id'], 'monthly:f1-unit-ambiguous-visible');
  const archived = planImport([{ ...legacy[0], archived: true }], [{ values: normalize(values('123456789012')), provenance: reread }], { id: () => 'after-archive' });
  // A deliberate second import of the same file under another default is not a re-reading: new records, nothing flagged (as released).
  const second = planImport(legacy, [{ values: normalize({ ...values('1.23457E+11'), service: 'UI-TEST' }), provenance: legacyProof }], { id: () => 'second-id' });
  assert.deepEqual([second.new, second.rows[0].record.id, second.rows[0].record.identityReview, second.rows[0].provenanceConflict ?? null, second.rows[0].identityChanged ?? null], [1, 'second-id', false, null, null], 'monthly:f1-unit-same-reading-other-default-new');
  const sameReading = planImport(legacy, [{ values: normalize(values('9999')), provenance: legacyProof }], { id: () => 'remapped-id' });
  assert.deepEqual([sameReading.new, sameReading.rows[0].identityChanged ?? null], [1, null], 'monthly:f1-unit-same-reading-remap-new');
  assert.equal(archived.rows[0].record.id, 'after-archive', 'monthly:f1-unit-archived-not-rebound');
  // Text IDs with zero prefixes still match by key exactly, without the file-row fallback.
  const text = applyPlan([], planImport([], [{ values: normalize(values('00123')), provenance: legacyProof }], { id: () => 'text-id' }));
  const again = planImport(text, [{ values: normalize(values('00123')), provenance: legacyProof }]);
  assert.deepEqual([again.unchanged, again.rows[0].record.id, again.rows[0].identityChanged ?? null], [1, 'text-id', null], 'monthly:f1-unit-text-id-exact');
});
// Fold of review omf-monthly-patch-opus55-20261020 F1 (probes P1/P2c/P3): a re-read file row re-keys a record only while the
// record still carries the identity its stored reading of that row produced (that reading's external key under the current
// mapping/defaults, or the row's file-row key for an ambiguous legacy row) and the current reading gives another one. Any other
// record from that row — a hand-corrected ID, or a record already repaired from another file — is never re-keyed: the row
// becomes its own record flagged with the existing provenance conflict (ids also kept in its history).
const foldReading = { mapping: { orderId: '0', purchaseDate: '1', description: '2', amount: '3' }, defaults: { service: 'SVC', account: 'ACCT' } };
const foldRows = (raw, hash, row) => mappedRows([raw], foldReading.mapping, foldReading.defaults, { hash, fileName: 'fold.xlsx', documentId: 'doc-' + hash.slice(0, 4), sheet: 'Sheet1', firstRow: row });
const handEdit = (records, id, orderId) => records.map(r => { if (r.id !== id) return r; const values = normalize({ ...r.values, orderId }); return { ...structuredClone(r), values, key: JSON.stringify([values.service, values.account, values.orderId, values.itemId]), revision: r.revision + 1 }; });
test('F1 fold P1: a hand-corrected order ID is not reverted when only the date cell of its file row reads differently', () => {
  const H = 'a'.repeat(64);
  const released = applyPlan([], planImport([], foldRows(['FILE-001', '10/5/26', 'Item', '1000'], H, 2), { id: () => 'original-record' }));
  assert.equal(released[0].key, JSON.stringify(['SVC', 'ACCT', 'FILE-001', '']));
  // Control: without a hand edit the date re-read is an ordinary update of the same record (key match, no identity change).
  const plain = planImport(released, foldRows(['FILE-001', '2026-10-05', 'Item', '1000'], H, 2), { id: () => 'fresh', reading: foldReading });
  assert.deepEqual([plain.rows[0].operation, plain.rows[0].record.id, plain.rows[0].record.values.purchaseDate, plain.rows[0].identityChanged ?? null], ['update', 'original-record', '2026-10-05', null], 'monthly:f1-unit-date-reread-plain-update');
  const manual = handEdit(released, 'original-record', 'MANUAL-999');
  for (const options of [{ id: () => 'fresh', reading: foldReading }, { id: () => 'fresh' }]) {
    const p = planImport(manual, foldRows(['FILE-001', '2026-10-05', 'Item', '1000'], H, 2), options), row = p.rows[0];
    assert.equal(row.identityChanged ?? null, null, 'monthly:f1-unit-manual-id-kept ' + JSON.stringify({ op: row.operation, id: row.record.id, orderId: row.record.values.orderId }));
    assert.deepEqual([row.operation, row.record.id, row.record.values.orderId, row.record.identityReview, row.provenanceConflict], ['new', 'fresh', 'FILE-001', true, ['original-record']], 'monthly:f1-unit-manual-id-conflict-flagged');
    assert.deepEqual(row.record.history.at(-1).conflict, ['original-record'], 'monthly:f1-unit-conflict-ids-in-history');
    const after = applyPlan(manual, p).find(r => r.id === 'original-record');
    assert.deepEqual([after.values.orderId, after.key, after.revision], ['MANUAL-999', manual[0].key, manual[0].revision], 'monthly:f1-unit-manual-record-untouched');
  }
});
test('F1 fold P2c: after a valid E-notation repair, a later hand edit of the ID survives the next reimport of the same file', () => {
  const H = 'b'.repeat(64), legacyRaw = ['1.23457E+11', '', 'Legacy row', '1500'], typedRaw = ['123456789012', '', 'Legacy row', '1500'];
  const legacy = applyPlan([], planImport([], foldRows(legacyRaw, H, 2), { id: () => 'legacy-id' }));
  const repair = planImport(legacy, foldRows(typedRaw, H, 2), { id: () => 'unused', reading: foldReading });
  assert.deepEqual([repair.rows[0].record.id, repair.rows[0].record.values.orderId, !!repair.rows[0].identityChanged], ['legacy-id', '123456789012', true], 'monthly:f1-unit-repair-positive');
  const repaired = applyPlan(legacy, repair);
  assert.deepEqual(repaired[0].provenance[0].raw, legacyRaw, 'the stored provenance raw stays the original reading');
  const edited = handEdit(repaired, 'legacy-id', 'MANUAL-777');
  const again = planImport(edited, foldRows(typedRaw, H, 2), { id: () => 'fresh', reading: foldReading }), row = again.rows[0];
  assert.equal(row.identityChanged ?? null, null, 'monthly:f1-unit-repaired-then-manual-kept ' + JSON.stringify({ op: row.operation, id: row.record.id, orderId: row.record.values.orderId }));
  assert.deepEqual([row.operation, row.record.id, row.record.identityReview, row.provenanceConflict], ['new', 'fresh', true, ['legacy-id']], 'monthly:f1-unit-repaired-then-manual-flagged');
  const applied = applyPlan(edited, again);
  assert.equal(applied.find(r => r.id === 'legacy-id').values.orderId, 'MANUAL-777', 'monthly:f1-unit-repaired-then-manual-untouched');
  const repeat = planImport(applied, foldRows(typedRaw, H, 2), { id: () => 'other', reading: foldReading });
  assert.deepEqual([repeat.unchanged, repeat.rows[0].record.id], [1, 'fresh'], 'monthly:f1-unit-repaired-then-manual-stable');
});
test('F1 fold P3: a record the released reader merged across two files is repaired by the first file; the second file becomes a flagged record', () => {
  const F = 'c'.repeat(64), G = 'd'.repeat(64);
  const fromF = applyPlan([], planImport([], foldRows(['1.23457E+11', '', 'F item', '100'], F, 2), { id: () => 'merged-id' }));
  const merged = applyPlan(fromF, planImport(fromF, foldRows(['1.23457E+11', '', 'G item', '200'], G, 3), { id: () => 'unused' }));
  assert.deepEqual([merged.length, merged[0].provenance.length, merged[0].values.description], [1, 2, 'G item'], 'SETUP: released reader merged two files into one record');
  const typedF = foldRows(['123456789012', '', 'F item', '100'], F, 2), typedG = foldRows(['123456999999', '', 'G item', '200'], G, 3);
  const a = planImport(merged, typedF, { id: () => 'unused', reading: foldReading });
  assert.deepEqual([a.rows[0].record.id, a.rows[0].record.values.orderId, !!a.rows[0].identityChanged], ['merged-id', '123456789012', true], 'monthly:f1-unit-merged-first-repaired');
  const repaired = applyPlan(merged, a);
  const b = planImport(repaired, typedG, { id: () => 'g-record', reading: foldReading }), row = b.rows[0];
  assert.equal(row.identityChanged ?? null, null, 'monthly:f1-unit-merged-second-file-flagged ' + JSON.stringify({ op: row.operation, id: row.record.id, orderId: row.record.values.orderId }));
  assert.deepEqual([row.operation, row.record.id, row.record.values.orderId, row.record.identityReview, row.provenanceConflict], ['new', 'g-record', '123456999999', true, ['merged-id']], 'monthly:f1-unit-merged-second-new');
  const both = applyPlan(repaired, b), first = both.find(r => r.id === 'merged-id');
  assert.deepEqual([first.values.orderId, first.values.description, first.revision], ['123456789012', 'F item', repaired.find(r => r.id === 'merged-id').revision], 'monthly:f1-unit-merged-first-unchanged');
  for (const [incoming, id] of [[typedF, 'merged-id'], [typedG, 'g-record']]) {
    const p = planImport(both, incoming, { id: () => 'x', reading: foldReading });
    assert.deepEqual([p.unchanged, p.rows[0].record.id, p.rows[0].identityChanged ?? null], [1, id, null], 'monthly:f1-unit-merged-stable ' + id);
  }
});
test('F1 fold: an ambiguous legacy row (file-row key) is still repaired; without the reading an external-key record is never re-keyed', () => {
  const H = 'e'.repeat(64);
  const legacy = applyPlan([], planImport([], [...foldRows(['1.23457E+11', '', 'Row two', '100'], H, 2), ...foldRows(['1.23457E+11', '', 'Row three', '200'], H, 3)], { id: (() => { let n = 0; return () => 'amb-' + (++n); })() }));
  assert.ok(legacy.every(r => r.key.startsWith('["file-row"')), 'SETUP: the released reading made both rows ambiguous');
  const p = planImport(legacy, [...foldRows(['123456789012', '', 'Row two', '100'], H, 2), ...foldRows(['123456999999', '', 'Row three', '200'], H, 3)], { id: () => 'fresh', reading: foldReading });
  assert.deepEqual(p.rows.map(r => [r.record.id, r.record.values.orderId, !!r.identityChanged]), [['amb-1', '123456789012', true], ['amb-2', '123456999999', true]], 'monthly:f1-unit-ambiguous-legacy-rebind');
  const L = 'f'.repeat(64), external = applyPlan([], planImport([], foldRows(['1.23457E+11', '', 'Only', '100'], L, 2), { id: () => 'ext-id' }));
  const blind = planImport(external, foldRows(['123456789012', '', 'Only', '100'], L, 2), { id: () => 'fresh' });
  assert.deepEqual([blind.rows[0].operation, blind.rows[0].identityChanged ?? null, blind.rows[0].provenanceConflict], ['new', null, ['ext-id']], 'monthly:f1-unit-no-reading-no-rekey');
});
test('F1 the importer template compiles', async () => {
  const { createRequire } = await import('node:module'), req = createRequire(import.meta.url), { parse, compileTemplate } = req('@vue/compiler-sfc');
  const name = 'components/intake/IntakeImporter.vue', source = await readFile(new URL('../' + name, import.meta.url), 'utf8'), p = parse(source, { filename: name });
  assert.deepEqual(p.errors, []); assert.deepEqual(compileTemplate({ source: p.descriptor.template.content, filename: name, id: 'intake-test' }).errors, [], name);
});

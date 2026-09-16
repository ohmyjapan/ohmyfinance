import test from 'node:test';
import assert from 'node:assert/strict';
import { aplusCapture } from './finance-pending-fixtures.mjs';
import { parseCardImport } from '../shared/card-import.mjs';
import { HEADERS as APLUS_HEADERS } from '../shared/aplus.mjs';
import { HEADERS as AMEX_HEADERS } from '../shared/amex.mjs';
import { buildSourceReferences, verifySourceReferences, activeImportRows } from '../shared/finance-import-overlap.mjs';
const account = { provider: 'aplus', cardIdentifiers: ['1234', '5678'] };
const encode = x => Buffer.from(JSON.stringify(x));
const csv = (headers, rows) => Buffer.from([headers, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
const pending = (source = aplusCapture()) => parseCardImport(encode(source), account, { kind: 'pending' });
const batch = (parsed, n) => ({ ...parsed, _id: String(n).padStart(24, '0'), ownerId: 'owner', accountId: 'account', hash: parsed.sha256, provider: 'aplus' });
const billed = (amounts = [1200, 1200], month = '2026-09') => parseCardImport(csv(APLUS_HEADERS, amounts.map(n => ['≪****-****-****-1234≫', '20260801', 'Synthetic shop', n, 'Ｓ', '1', '01', n, ''])), account, { kind: 'statement', statementMonth: month, statementTotal: amounts.reduce((a, b) => a + b, 0) });

test('Aplus pending captures reconcile every raw page field, original byte hash and repeated purchase', () => {
  const parsed = pending(); assert.equal(parsed.sourceStatus, 'pending'); assert.equal(parsed.sourceFormat, 'json'); assert.equal(parsed.rows.length, 2); assert.equal(parsed.reconciliation.purchaseTotal, 2400);
  assert.notEqual(parsed.rows[0].key, parsed.rows[1].key); assert.equal(parsed.rows[0].paymentAmount, null); assert.equal(parsed.rows[0].statementMonth, '');
  for (const mutate of [s => s.rows[0].amountJpy++, s => s.displayedTotal++, s => s.rawPageFields[0].rows.pop(), s => s.rawPageFields[0].activePage = '2', s => s.source = 'https://example.invalid', s => s.rows[0].cardSuffix = '9999', s => s.finalized = true]) { const s = aplusCapture(); mutate(s); assert.throws(() => pending(s)); }
});
test('pending Amex CSV checks the processing range and preserves earlier purchase dates', () => {
  const bytes = csv(AMEX_HEADERS, [['2026/08/01', '2026/08/03', 'Synthetic shop', 'Test user', '12345', 1200, '', '']]);
  const a = { provider: 'amex', cardIdentifiers: ['12345'] };
  const p = parseCardImport(bytes, a, { kind: 'pending', start: '2026-08-01', end: '2026-08-10' }); assert.equal(p.rows.length, 1); assert.equal(p.sourceStatus, 'pending');
  assert.equal(parseCardImport(bytes, a, { kind: 'pending', start: '2026-08-03', end: '2026-08-10' }).rows[0].purchaseDate, '2026-08-01');
  assert.throws(() => parseCardImport(bytes, a, { kind: 'pending', start: '2026-08-04', end: '2026-08-10' }));
});
test('the current rendered-page capture layout retains the same source facts', () => {
  const old = aplusCapture(), current = { ...old, sourceType: 'rendered_bank_page', displayedTotal: old.rawPageFields[0].summary, rawPageFields: old.rawPageFields.map(p => ({ page: Number(p.activePage), pages: p.pageNumbers.map(Number), summary: p.summary, rows: p.rows.map(r => ({ sourceRow: r.position, merchant: r.merchant, dateAndPayment: r.dateAndPayment, amount: r.amount, fields: Object.fromEntries(r.details.map(d => [d.label, d.value])) })) })) };
  assert.deepEqual(pending(current).rows, pending(old).rows);
  current.rawPageFields[0].rows[0].amount = '1円'; assert.throws(() => pending(current));
});
test('finalized Aplus groups reference the pending originals without collapsing identical purchases', () => {
  const original = batch(pending(), 1), final = batch(billed(), 2);
  final.sourceReferences = buildSourceReferences(final, [original]);
  assert.equal(final.sourceReferences.groups[0].state, 'existing_import'); assert.deepEqual(final.sourceReferences.groups[0].targets[0].lines, [2, 3]);
  verifySourceReferences(final, [original]); assert.equal(activeImportRows(final).length, 0); assert.equal(activeImportRows(original).length, 2);
  const again = batch(billed(), 3); again.sourceReferences = buildSourceReferences(again, [original, final]); assert.deepEqual(again.sourceReferences.groups[0].targets, final.sourceReferences.groups[0].targets);
});
test('amount, multiplicity, billing month and multiple original groups require review', () => {
  const original = batch(pending(), 1);
  for (const parsed of [billed([1200]), billed([1200, 1200, 1200]), billed([1200, 1201]), billed([1200, 1200], '2026-10')]) {
    const final = batch(parsed, 2); final.sourceReferences = buildSourceReferences(final, [original]); assert.equal(final.sourceReferences.groups[0].state, 'source_overlap_review'); verifySourceReferences(final, [original]); assert.equal(activeImportRows(final).length, 0);
  }
  const final = batch(billed(), 3); final.sourceReferences = buildSourceReferences(final, [original, batch(pending(), 2)]); assert.equal(final.sourceReferences.groups[0].state, 'source_overlap_review');
});
test('reverse arrival order, supplementary cards, tampering and different owners remain safe', () => {
  const original = batch(billed(), 1), next = batch(pending(), 2); next.sourceReferences = buildSourceReferences(next, [original]); verifySourceReferences(next, [original]); assert.equal(activeImportRows(next).length, 0);
  const stranger = { ...original, ownerId: 'other' }; assert.equal(buildSourceReferences(next, [stranger]).groups.length, 0);
  const otherCard = batch(pending(aplusCapture([{ merchant: 'Synthetic shop', amount: 1200, card: '5678' }])), 3); assert.equal(buildSourceReferences(otherCard, [original]).groups.length, 0);
  const broken = structuredClone(next); broken.sourceReferences.groups[0].targets[0].lines.pop(); assert.throws(() => verifySourceReferences(broken, [original]));
  const changed = structuredClone(original); changed.rows[0].amount++; assert.throws(() => verifySourceReferences(next, [changed]));
});

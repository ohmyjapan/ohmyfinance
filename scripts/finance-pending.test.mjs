import test from 'node:test';
import assert from 'node:assert/strict';
import { aplusCapture } from './finance-pending-fixtures.mjs';
import { parseCardImport } from '../shared/card-import.mjs';
import { HEADERS as APLUS_HEADERS } from '../shared/aplus.mjs';
import { HEADERS as AMEX_HEADERS } from '../shared/amex.mjs';
import { buildSourceReferences, verifySourceReferences, activeImportRows, resolutionTargetEligible } from '../shared/finance-import-overlap.mjs';
const account = { provider: 'aplus', cardIdentifiers: ['1234', '5678'] };
const encode = x => Buffer.from(JSON.stringify(x));
const csv = (headers, rows) => Buffer.from([headers, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
const pending = (source = aplusCapture()) => parseCardImport(encode(source), account, { kind: 'pending' });
const batch = (parsed, n) => ({ ...parsed, _id: String(n).padStart(24, '0'), ownerId: 'owner', accountId: 'account', hash: parsed.sha256, provider: 'aplus' });
const billed = (amounts = [1200, 1200], month = '2026-09') => parseCardImport(csv(APLUS_HEADERS, amounts.map(n => ['≪****-****-****-1234≫', '20260801', 'Synthetic shop', n, 'Ｓ', '1', '01', n, ''])), account, { kind: 'statement', statementMonth: month, statementTotal: amounts.reduce((a, b) => a + b, 0) });
const actual = (items, month = '2026-09') => parseCardImport(csv(APLUS_HEADERS, items.map(r => [`≪****-****-****-${r.card || '1234'}≫`, (r.date || '2026-08-01').replaceAll('-', ''), r.merchant, r.amount, 'Ｓ', '1', '01', r.amount, ''])), account, { kind: 'statement', statementMonth: month, statementTotal: items.reduce((n, r) => n + r.amount, 0) });
const reconcile = (current, previous) => {
  current.sourceReferences = buildSourceReferences(current, previous);
  verifySourceReferences(current, previous);
  return current;
};

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

test('renamed, redated and late finalized purchases are held without adding to forecast totals', () => {
  const original = batch(pending(), 1), before = structuredClone(original);
  for (const item of [
    { merchant: 'Final merchant', amount: 1200 },
    { merchant: 'Synthetic shop', amount: 1200, date: '2026-08-04' },
    { merchant: 'Final merchant', amount: 1300, date: '2026-10-25' }
  ]) {
    const final = reconcile(batch(actual([item, item], '2026-11'), 2), [original]);
    assert.equal(final.sourceReferences.version, 3);
    assert.equal(final.sourceReferences.groups[0].match, 'pending_candidate');
    assert.equal(final.sourceReferences.groups[0].state, 'source_overlap_review');
    assert.equal(activeImportRows(final).length, 0);
    assert.deepEqual(final.sourceReferences.groups[0].targets[0].lines, [2, 3]);
    assert.equal(activeImportRows(original).reduce((n, r) => n + r.amount, 0), 2400);
  }
  assert.deepEqual(original, before);
});

test('snapshot refreshes preserve multiplicity and count independent new purchases after matching the originals', () => {
  const original = batch(pending(), 1);
  const extra = { merchant: 'New purchase', amount: 800 };
  const refresh = reconcile(batch(pending(aplusCapture([{ merchant: 'Synthetic shop', amount: 1200 }, { merchant: 'Synthetic shop', amount: 1200 }, extra])), 2), [original]);
  assert.deepEqual(activeImportRows(refresh).map(r => r.amount), [800]);
  const missing = reconcile(batch(pending(aplusCapture([extra])), 3), [original]);
  assert.equal(activeImportRows(missing).length, 0);
  const another = reconcile(batch(pending(aplusCapture([{ ...extra, date: '2026-08-04' }])), 4), [original, missing]);
  assert.equal(activeImportRows(another).length, 0);
  assert.deepEqual(another.sourceReferences.groups[0].targets.map(t => t.importId), [original._id]);
  const mismatched = reconcile(batch(pending(aplusCapture([{ merchant: 'Synthetic shop', amount: 1200 }, extra])), 5), [original]);
  assert.equal(activeImportRows(mismatched).length, 0);
  assert.equal(mismatched.sourceReferences.groups.length, 2);
});

test('reverse arrival and post-finalization refreshes cannot recount changed forecasts', () => {
  const original = batch(pending(), 1), final = reconcile(batch(billed(), 2), [original]);
  const changed = batch(pending(aplusCapture([{ merchant: 'Changed forecast', amount: 1300, date: '2026-08-04' }])), 3);
  assert.equal(activeImportRows(reconcile(changed, [original, final])).length, 0);
  const actualFirst = batch(billed(), 4);
  assert.equal(activeImportRows(reconcile({ ...changed, _id: '5'.repeat(24) }, [actualFirst])).length, 0);
  const future = batch(pending(aplusCapture([{ merchant: 'New cycle', amount: 900, date: '2026-09-15', month: '26/10' }])), 6);
  assert.equal(activeImportRows(reconcile(future, [original, final])).length, 1);
  assert.equal(activeImportRows(reconcile(batch(actual([{ merchant: 'New cycle', amount: 900, date: '2026-09-15' }], '2026-10'), 7), [original, final])).length, 1);
});

test('candidate references cannot become automatic matches or split repeated source groups', () => {
  const prior = batch(pending(), 1), other = batch(pending(aplusCapture([{ merchant: 'Other forecast', amount: 800 }])), 2);
  const current = reconcile(batch(actual([{ merchant: 'Final merchant', amount: 1200 }]), 3), [prior, other]);
  assert.equal(current.sourceReferences.groups[0].targets.length, 2);
  for (const change of [
    c => c.sourceReferences.groups[0].state = 'existing_import',
    c => c.sourceReferences.groups[0].targets[0].lines.pop(),
    c => c.sourceReferences.groups[0].targets[0].sourceHash = '0'.repeat(64),
    c => c.sourceReferences.version = 2
  ]) {
    const broken = structuredClone(current); change(broken);
    assert.throws(() => verifySourceReferences(broken, [prior, other]));
  }
  assert.throws(() => verifySourceReferences(current, [{ ...prior, ownerId: 'other-owner' }, other]));
  const foreign = batch(actual([{ merchant: 'Final merchant', amount: 1200, card: '5678' }]), 4);
  assert.equal(buildSourceReferences(foreign, [prior]).groups.length, 0);
  const refund = batch(actual([{ merchant: 'Refund', amount: -1200 }]), 5);
  assert.equal(buildSourceReferences(refund, [prior]).groups.length, 0);
  assert.equal(refund.rows[0].kind, 'credit_review');
});

test('Amex changed processing dates, merchant labels and foreign amounts remain review-only', () => {
  const a = { provider: 'amex', cardIdentifiers: ['12345'] };
  const parse = (cells, metadata, n) => ({ ...batch(parseCardImport(csv(AMEX_HEADERS, [cells]), a, metadata), n), provider: 'amex' });
  const original = parse(['2026/08/01', '2026/08/03', 'Foreign merchant', 'Test user', '12345', 1200, '8 USD', '150'], { kind: 'pending', start: '2026-08-01', end: '2026-08-10' }, 1);
  const final = parse(['2026/08/02', '2026/08/05', 'Final merchant', 'Test user', '12345', 1220, '8 USD', '152.5'], { kind: 'statement', start: '2026-08-01', end: '2026-08-31' }, 2);
  assert.equal(activeImportRows(reconcile(final, [original])).length, 0);
  assert.equal(final.sourceReferences.groups[0].state, 'source_overlap_review');
});

// ── recent Amex snapshots (case omf-amex-recent-activity-20261102): the existing rules on the real parser's rows. These prove the provisional flows hold what can change; none of them
// is a promise of matching, and no stable transaction reference exists in this CSV. A row keeps its place in review until a person or an exact final file settles it. ──
const amex = { provider: 'amex', cardIdentifiers: ['12345', '23456'] };
const cells = ({ date = '2026/10/06', processed = '2026/10/07', merchant = 'Synthetic shop', card = '12345', amount = 1200, foreign = '', rate = '' } = {}) => [date, processed, merchant, 'Test user', card, amount, foreign, rate];
const source = (parsed, n) => ({ ...parsed, _id: String(n).padStart(24, '0'), ownerId: 'owner', accountId: 'account', hash: parsed.sha256, provider: 'amex' });
const snapshot = (rows, n, period = { start: '2026-10-05', end: '2026-10-20' }) => source(parseCardImport(csv(AMEX_HEADERS, rows.map(cells)), amex, { kind: 'pending', ...period }), n);
const finalFile = (rows, n, period = { start: '2026-10-05', end: '2026-11-04' }) => source(parseCardImport(csv(AMEX_HEADERS, rows.map(cells)), amex, { kind: 'statement', ...period }), n);
const lines = batch => activeImportRows(batch).map(r => r.line);
const shop = { merchant: 'Shop A' }, other = { merchant: 'Shop B', amount: 800 }, third = { merchant: 'Shop C', amount: 300, date: '2026/10/08', processed: '2026/10/09' };

test('recent: the same rows again, in any order, count once; a later snapshot adds only what is new', () => {
  const first = snapshot([shop, other], 1);
  assert.equal(activeImportRows(first).length, 2, 'recent:first-snapshot-counts-its-purchases');
  const again = reconcile(snapshot([shop, other], 2), [first]);
  assert.deepEqual([lines(again), again.sourceReferences.groups.map(g => g.state)], [[], ['existing_import', 'existing_import']], 'recent:repeat-counts-nothing-more');
  const reordered = reconcile(snapshot([other, shop], 3), [first]);
  assert.notEqual(reordered.hash, first.hash, 'recent:another-order-is-another-file');
  assert.deepEqual(lines(reordered), [], 'recent:changed-ordering-counts-nothing-more');
  const grown = reconcile(snapshot([shop, other, third], 4), [first]);
  assert.deepEqual(activeImportRows(grown).map(r => r.description), ['Shop C'], 'recent:only-the-new-purchase-counts');
  assert.deepEqual(lines(reconcile(snapshot([third, other, shop], 5), [first, grown])), [], 'recent:the-third-snapshot-counts-nothing-more');
});

test('recent: two identical purchases on one day stay two, and a snapshot that shows another number of them is held, never collapsed or added', () => {
  const first = snapshot([shop, shop, other], 1);
  assert.deepEqual([activeImportRows(first).length, first.rows[0].key === first.rows[1].key], [3, false], 'recent:identical-purchases-kept-apart');
  assert.deepEqual(lines(reconcile(snapshot([shop, shop, other], 2), [first])), [], 'recent:same-multiplicity-counts-nothing-more');
  for (const [label, rows] of [['one-gone', [shop, other]], ['one-more', [shop, shop, shop, other]]]) {
    const held = reconcile(snapshot(rows, 3), [first]), group = held.sourceReferences.groups.find(g => g.lines.includes(2));
    assert.deepEqual([group.match, group.state, group.targets[0].lines], ['pending_purchase', 'source_overlap_review', [2, 3]], 'recent:multiplicity-held ' + label);
    assert.equal(activeImportRows(held).filter(r => r.description === 'Shop A').length, 0, 'recent:multiplicity-adds-nothing ' + label);
  }
  assert.equal(activeImportRows(first).length, 3, 'recent:the-original-count-stands');
});

test('recent: a changed date, amount, merchant or all of them is held for review beside its original; nothing is merged, moved or counted twice', () => {
  const first = snapshot([shop], 1), before = structuredClone(first);
  for (const [label, change, match] of [
    ['amount', { amount: 1250 }, 'pending_purchase'], ['currency-conversion', { amount: 1210, foreign: '8.00 USD', rate: '151.25' }, 'pending_purchase'], ['processing-date', { processed: '2026/10/09' }, 'pending_purchase'],
    ['merchant', { merchant: 'Shop A TOKYO' }, 'pending_candidate'], ['purchase-date', { date: '2026/10/05' }, 'pending_candidate'],
    ['everything', { date: '2026/10/05', processed: '2026/10/08', merchant: 'SHOP-A*ONLINE', amount: 1300 }, 'pending_candidate']
  ]) {
    const next = reconcile(snapshot([{ ...shop, ...change }], 2), [first]), [group] = next.sourceReferences.groups;
    assert.deepEqual([group.match, group.state, group.targets[0].importId], [match, 'source_overlap_review', first._id], 'recent:held ' + label);
    assert.deepEqual([lines(next), lines(first)], [[], [2]], 'recent:counted-once ' + label);
    const forged = structuredClone(next); forged.sourceReferences.groups[0].state = 'existing_import';
    assert.throws(() => verifySourceReferences(forged, [first]), undefined, 'recent:a-review-cannot-be-rewritten-as-a-match ' + label);
  }
  assert.deepEqual(first, before, 'recent:the-first-snapshot-never-changes');
});

test('recent: a row that disappears stays as it was seen; it proves no cancellation, and a row that comes back is the original again', () => {
  const first = snapshot([shop, other], 1), gone = reconcile(snapshot([other], 2), [first]);
  assert.deepEqual([lines(gone), lines(first)], [[], [2, 3]], 'recent:disappearance-removes-nothing');
  const back = reconcile(snapshot([shop, other], 3), [first, gone]);
  assert.deepEqual(lines(back), [], 'recent:reappearance-counts-nothing-more');
  // a new purchase beside an unexplained disappearance waits too: the card has an unsettled row it could be a changed form of
  const beside = reconcile(snapshot([other, third], 4), [first]);
  assert.deepEqual([lines(beside), beside.sourceReferences.groups.at(-1).match], [[], 'pending_candidate'], 'recent:new-row-beside-a-missing-one-waits');
  // a credit is no purchase: it stays in the file for review and never answers for the row that disappeared
  const credit = reconcile(snapshot([{ ...shop, amount: -1200 }, other], 5), [first]), refund = credit.rows[0];
  assert.deepEqual([refund.kind, credit.sourceReferences.groups.some(g => g.lines.includes(refund.line))], ['credit_review', false], 'recent:a-refund-is-not-a-match');
  assert.deepEqual(lines(first), [2, 3], 'recent:a-refund-settles-nothing');
});

test('recent: a late submission and a reverse arrival cannot count a purchase twice; the supplementary card keeps its own rows', () => {
  const first = snapshot([shop], 1);
  const late = reconcile(snapshot([shop, { merchant: 'Late merchant', amount: 500, date: '2026/09/28', processed: '2026/10/10' }], 2), [first]);
  assert.deepEqual(activeImportRows(late).map(r => [r.description, r.purchaseDate]), [['Late merchant', '2026-09-28']], 'recent:late-submission-keeps-its-date');
  const closed = finalFile([shop, other], 3);
  const after = reconcile(snapshot([shop, other], 4, { start: '2026-10-05', end: '2026-10-25' }), [closed]);
  assert.deepEqual([lines(after), after.sourceReferences.groups.map(g => g.state)], [[], ['existing_import', 'existing_import']], 'recent:reverse-arrival-counts-nothing');
  const changed = reconcile(snapshot([{ merchant: 'Shop A renamed' }], 5), [closed]);
  assert.deepEqual([lines(changed), changed.sourceReferences.groups[0].match], [[], 'pending_candidate'], 'recent:reverse-arrival-with-a-change-is-held');
  const nextCycle = reconcile(snapshot([{ merchant: 'New cycle', date: '2026/11/06', processed: '2026/11/07' }], 6, { start: '2026-11-05', end: '2026-11-20' }), [closed]);
  assert.equal(activeImportRows(nextCycle).length, 1, 'recent:activity-after-the-closed-period-is-independent');
  const card = reconcile(snapshot([{ ...shop, card: '23456' }], 7), [first]);
  assert.deepEqual(lines(card), [2], 'recent:another-card-is-another-purchase');
});

test('recent: the closed statement settles an exact row group and holds everything else; the snapshots keep their own rows', () => {
  const first = snapshot([shop, shop, other], 1), before = structuredClone(first);
  const exact = reconcile(finalFile([shop, shop, other], 2), [first]);
  assert.deepEqual([exact.sourceReferences.groups.map(g => g.state), lines(exact), lines(first)], [['existing_import', 'existing_import'], [], [2, 3, 4]], 'recent:exact-final-settles-the-group');
  for (const [label, rows] of [['amount', [shop, { ...shop, amount: 1300 }, other]], ['one-gone', [shop, other]], ['merchant', [{ merchant: 'Final label' }, { merchant: 'Final label' }, other]]]) {
    const held = reconcile(finalFile(rows, 3), [first]), group = held.sourceReferences.groups.find(g => g.lines.includes(2));
    assert.equal(group.state, 'source_overlap_review', 'recent:final-difference-held ' + label);
    assert.equal(activeImportRows(held).length, 0, 'recent:final-difference-adds-nothing ' + label);
  }
  assert.deepEqual(first, before, 'recent:final-never-rewrites-the-snapshot');
});

// ── Aplus reconciliation (plan omf-aplus-reconciliation-resolution-20261104): the settled-line and closed-period rules and the owner's forecast resolutions on the real
// Aplus parser's rows. The original parsing and provisional semantics above are unchanged; these legs state the intentional new behaviour. ──
const forecast = (items, n, capturedAt = '2026-08-20T00:00:00.000Z') => batch(pending({ ...aplusCapture(items.map(i => ({ merchant: i.merchant, amount: i.amount, date: i.date || '2026-08-10', card: '1234', month: i.month || '26/09' }))), capturedAt }), n);
const statement = (items, month, n) => batch(actual(items.map(i => ({ ...i, date: i.date || '2026-08-10' })), month), n);
const decided = (b, records) => ({ ...b, forecastResolutions: records });
const decision = (state, lines, target) => ({ state, lines, ...(target ? { target } : {}), note: '', at: '2026-11-04T00:00:00.000Z', revision: 1, replaced: null });
const groupsOf = b => b.sourceReferences.groups.map(g => [g.match, g.state, g.lines, g.targets[0].lines]);
const A = { merchant: 'Shop A', amount: 1000, month: '26/09' }, B = { merchant: 'Shop B', amount: 900, month: '26/09' }, C = { merchant: 'Shop C', amount: 800, month: '26/10' }, D = { merchant: 'Shop D', amount: 700, month: '26/10' };

test('aplus: a later statement settles a forecast for every other statement, and a statement closed before the purchases holds nothing', () => {
  const P = forecast([A, B, C, D], 1);
  const oct = reconcile(statement([C, { merchant: 'Shop X', amount: 777, date: '2026-10-03' }], '2026-10', 2), [P]);
  assert.deepEqual(groupsOf(oct), [['pending_purchase', 'existing_import', [2], [4]], ['pending_candidate', 'source_overlap_review', [3], [2, 3, 5]]], 'aplus:at-import X->{A,B,D}');
  const sept = reconcile(statement([A, B, { merchant: 'Shop Y', amount: 555, date: '2026-09-05' }], '2026-09', 3), [P, oct]);
  assert.deepEqual(groupsOf(sept), [['pending_purchase', 'existing_import', [2], [2]], ['pending_purchase', 'existing_import', [3], [3]], ['pending_candidate', 'source_overlap_review', [4], [5]]], 'aplus:Y->{D}: C settled by the October statement is no candidate');
  const rebuilt = { ...oct, sourceReferences: buildSourceReferences(oct, [P], [P, sept]) };
  assert.deepEqual(groupsOf(rebuilt)[1], ['pending_candidate', 'source_overlap_review', [3], [5]], 'aplus:rebuilt with the whole history X->{D}');
  assert.equal(verifySourceReferences(oct, [P, sept]).length, 2, 'aplus:the import-time binding still verifies');
  const old = reconcile(statement([{ merchant: 'Old shop', amount: 300, date: '2025-08-05' }], '2025-08', 4), [P]);
  assert.deepEqual([old.sourceReferences.groups, activeImportRows(old).length], [[], 1], 'aplus:a 2025-08 statement holds no 2026 forecast');
});
test('aplus: a billed decision binds the changed statement row and consumes the forecast; a closed one holds nothing and an exact bill supersedes it', () => {
  const P = forecast([A], 1), changed = statement([{ merchant: 'Shop A (final)', amount: 1200, date: '2026-08-12' }], '2026-09', 2);
  assert.deepEqual(groupsOf(reconcile(changed, [P])), [['pending_candidate', 'source_overlap_review', [2], [2]]], 'aplus:changed bill held');
  const billed = decided(P, { 2: decision('billed', [2], { importId: changed._id, sourceHash: changed.hash, lines: [2] }) });
  const bound = reconcile({ ...changed }, [billed]);
  assert.deepEqual([bound.sourceReferences.version, groupsOf(bound), activeImportRows(bound).length, activeImportRows(billed).length], [4, [['pending_resolution', 'existing_import', [2], [2]]], 0, 1], 'aplus:resolution group, the final row is a reference copy of the forecast');
  assert.deepEqual([activeImportRows(reconcile(statement([A], '2026-09', 3), [billed, bound])).length], [1], 'aplus:an exact row of a consumed forecast is a new purchase');
  const closed = decided(forecast([B], 4), { 2: decision('closed', [2]) });
  const held = reconcile(statement([{ merchant: 'Shop O1', amount: 100, date: '2026-09-02' }, { merchant: 'Shop O2', amount: 200, date: '2026-09-03' }], '2026-09', 5), [closed]);
  assert.deepEqual([held.sourceReferences.groups, activeImportRows(held).length], [[], 2], 'aplus:a closed forecast holds nothing');
  const exact = reconcile(statement([B], '2026-09', 6), [closed, held]);
  assert.deepEqual(groupsOf(exact), [['pending_purchase', 'existing_import', [2], [2]]], 'aplus:an exact bill still binds the closed forecast (superseding its record)');
  const again = reconcile(forecast([B], 7, '2026-08-21T00:00:00.000Z'), [closed]);
  assert.equal(activeImportRows(again).length, 0, 'aplus:a repeated snapshot row of a closed forecast is not a second purchase');
});
// ── plan omf-aplus-statement-payment-review-20261105: automatic exact matching and the capture parsing contracts are unchanged; a pending row's blank
// payment field is a forecast, never a statement exception; the same purchase kept under individual review on the statement needs the owner's explicit
// pairing and then stays a reference copy with its original values. ──
const reviewRow = (items, month) => parseCardImport(csv(APLUS_HEADERS, items.map(r => [`≪****-****-****-${r.card || '1234'}≫`, (r.date || '2026-08-01').replaceAll('-', ''), r.merchant, r.amount, 'Ｓ', '1', '01', r.payment === null ? '' : (r.payment ?? r.amount), ''])), account, { kind: 'statement', statementMonth: month, statementTotal: items.reduce((n, r) => n + (r.payment === null ? 0 : (r.payment ?? r.amount)), 0) });
test('aplus: pending null payment fields are forecasts, never finalized exceptions; exact statements still match automatically; the same purchase under review needs the explicit pairing', () => {
  const original = batch(pending(), 1);
  assert.deepEqual(original.rows.map(r => [r.kind, r.paymentAmount, r.purchaseAmount]), [['expense', null, 1200], ['expense', null, 1200]], 'pending rows: expense with a blank payment field');
  assert.equal(resolutionTargetEligible(original.rows[0], { ...original.rows[1], kind: 'statement_review' }), false, 'a pending row under review is never the same-purchase target (no statement month); batch finality is the callers\' check');
  const exact = reconcile(batch(billed(), 2), [original]);
  assert.deepEqual([exact.sourceReferences.version, exact.sourceReferences.groups[0].match, exact.sourceReferences.groups[0].state, activeImportRows(exact).length], [2, 'pending_purchase', 'existing_import', 0], 'an exact statement still matches automatically');
  const under = batch(reviewRow([{ merchant: 'Synthetic shop', amount: 1200, payment: null }, { merchant: 'Synthetic shop', amount: 1200, payment: null }], '2026-09'), 3);
  assert.deepEqual(under.rows.map(r => [r.kind, r.purchaseAmount, r.paymentAmount]), [['statement_review', 1200, null], ['statement_review', 1200, null]], 'a blank payment field on the statement is a statement_review row');
  const held = reconcile({ ...under }, [original]);
  assert.deepEqual([held.sourceReferences.groups[0].match, held.sourceReferences.groups[0].state, activeImportRows(held).length, activeImportRows(original).length], ['pending_purchase', 'source_overlap_review', 0, 2], 'never an automatic match: held for the owner');
  assert.equal(resolutionTargetEligible(original.rows[0], under.rows[0]), true, 'the same purchase is eligible for the explicit pairing');
  const target = { importId: under._id, sourceHash: under.hash, lines: [2, 3] }, paired = reconcile({ ...under }, [decided(original, { 2: decision('billed', [2, 3], target), 3: decision('billed', [2, 3], target) })]);
  assert.deepEqual([paired.sourceReferences.version, paired.sourceReferences.groups.map(g => [g.match, g.state, g.lines]), activeImportRows(paired).length, paired.rows.map(r => r.paymentAmount)], [4, [['pending_resolution', 'existing_import', [2, 3]]], 0, [null, null]], 'the explicit pairing binds; the payment fields stay blank');
  const changed = reconcile(batch(reviewRow([{ merchant: 'Synthetic shop', amount: 1300, payment: null }, { merchant: 'Synthetic shop', amount: 1300, payment: null }], '2026-09'), 4), [original]);
  assert.equal(resolutionTargetEligible(original.rows[0], changed.rows[0]), false, 'a changed amount under review is not the same purchase');
});
test('aplus identical repeats: two forecasts paired with two of three statement rows leave the third new; closing one alone leaves the other held', () => {
  const E = { merchant: 'Shop E', amount: 700, month: '26/09' }, P = forecast([E, E], 1), three = statement([E, E, E], '2026-09', 2);
  assert.deepEqual(groupsOf(reconcile(three, [P])), [['pending_purchase', 'source_overlap_review', [2, 3, 4], [2, 3]]], 'aplus:three bills, two forecasts: review');
  const target = { importId: three._id, sourceHash: three.hash, lines: [2, 3] };
  const paired = reconcile({ ...three }, [decided(P, { 2: decision('billed', [2, 3], target), 3: decision('billed', [2, 3], target) })]);
  assert.deepEqual([groupsOf(paired), activeImportRows(paired).map(r => r.line)], [[['pending_resolution', 'existing_import', [2, 3], [2, 3]]], [4]], 'aplus:x3 stays a new purchase');
  const one = reconcile({ ...three }, [decided(P, { 2: decision('closed', [2]) })]);
  assert.deepEqual([groupsOf(one), activeImportRows(one).length], [[['pending_purchase', 'source_overlap_review', [2, 3, 4], [3]]], 0], 'aplus:closing E1 alone leaves E2 holding the rows');
});

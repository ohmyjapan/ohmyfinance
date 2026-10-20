// Pure native bank classification (plan omf-rakuten-native-shiwake-20261020 §5): evidence-based proposals from the bank
// description, exact normalized payee history/teaching and the company's saved calendar; never a tax/T inference. Fictional
// rows and names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as classification from '../shared/finance-bank-classification.mjs';

const fn = name => { const f = classification[name]; assert.equal(typeof f, 'function', 'classification:export ' + name); return f; };
const chart = [{ id: 'a1'.repeat(12), name: '支払手数料', type: 'expense' }, { id: 'a2'.repeat(12), name: '受取利息', type: 'income' }, { id: 'a3'.repeat(12), name: '普通預金', type: 'asset' }, { id: 'a4'.repeat(12), name: '地代家賃', type: 'expense' }, { id: 'a5'.repeat(12), name: '外注費', type: 'expense' }, { id: 'a6'.repeat(12), name: '売上高', type: 'income' }];
const row = (id, date, amount, description, extra = {}) => ({ id, date, amount, currency: 'JPY', description, revision: 1, fingerprint: 'f' + id, ...extra });
const entry = (id, dueDate, amount, type, category, extra = {}) => ({ id, title: 'Synthetic ' + category, dueDate, amount, currency: 'JPY', type, status: 'pending', category, recurring: false, ...extra });
const propose = input => fn('proposeBankClassifications')({ rows: [], calendar: [], history: [], teachings: [], companyNames: [], chart, bankAccountName: '普通預金', ...input });
const one = (input, id) => propose(input).rows.find(r => r.rowId === id);

test('payee normalization strips transfer prefixes, entity marks, account boilerplate and width/small-kana differences', () => {
  const normalize = fn('normalizePayee');
  assert.equal(normalize('振込 カ）カクウシヨウジ'), normalize('ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'), 'classification:payee-width');
  assert.equal(normalize('ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'), 'カクウシヨウジ', 'classification:payee-key');
  assert.equal(normalize('振込 カクウシヨウジ フツウ 1234567'), 'カクウシヨウジ', 'classification:payee-account-stripped');
  assert.equal(normalize('振込 カクウ商事株式会社（依頼人：カクウホールディングス）'), normalize('振込 カクウ商事'), 'classification:payer-reference-stripped');
  assert.equal(normalize(''), '');
});

test('explicit fee and interest text supply purpose and an existing chart account; nothing is fabricated', () => {
  const fee = one({ rows: [row('r1', '2026-09-12', 165, '振込手数料')] }, 'r1');
  assert.equal(fee.proposal.purposeKind, 'bank-fee', 'classification:fee-text'); assert.equal(fee.proposal.accountCategoryId, 'a1'.repeat(12)); assert.equal(fee.proposal.confidence, 'supported');
  assert.deepEqual(fee.preview, { debit: { account: '支払手数料', amount: 165 }, credit: { account: '普通預金', amount: 165 } }, 'classification:debit-credit-outflow');
  const interest = one({ rows: [row('r2', '2026-09-30', -12, '決算お利息')] }, 'r2');
  assert.equal(interest.proposal.purposeKind, 'interest'); assert.equal(interest.direction, 'in');
  assert.deepEqual(interest.preview, { debit: { account: '普通預金', amount: 12 }, credit: { account: '受取利息', amount: 12 } }, 'classification:debit-credit-inflow');
  const noChart = fn('proposeBankClassifications')({ rows: [row('r3', '2026-09-12', 165, '振込手数料')], calendar: [], history: [], teachings: [], companyNames: [], chart: [], bankAccountName: '' }).rows[0];
  assert.equal(noChart.proposal.accountCategoryId, null, 'classification:no-fabricated-id'); assert.equal(noChart.proposal.confidence, 'review'); assert.ok(noChart.unresolved.includes('account-not-in-chart'));
  assert.equal(noChart.preview.credit.account, '普通預金（勘定科目 未設定）');
});

test('calendar: exact currency, amount and direction near the due date, bilateral one-to-one; duplicates, reused entries, late and combined stay review', () => {
  const unique = one({ rows: [row('r1', '2026-09-10', 110000, '振込 カ）カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃')] }, 'r1');
  // a unique match proposes the entry's title for review; its category is a planning label, never the account
  assert.equal(unique.proposal.purposeKind, 'calendar', 'classification:calendar-unique'); assert.equal(unique.proposal.purpose, 'Synthetic 地代家賃', 'classification:calendar-title');
  assert.equal(unique.proposal.accountCategoryId, null, 'classification:calendar-no-account'); assert.equal(unique.proposal.confidence, 'review', 'classification:calendar-review'); assert.ok(unique.unresolved.includes('calendar-payee-unverified'));
  assert.deepEqual(unique.calendarCandidates.map(c => [c.paymentId, c.kind]), [['p1', 'unique']]);
  // direction, currency and amount must be exact
  assert.equal(one({ rows: [row('r1', '2026-09-10', -110000, '振込 カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃')] }, 'r1').calendarCandidates.length, 0, 'classification:calendar-direction');
  assert.equal(one({ rows: [row('r1', '2026-09-10', 110000, '振込 カクウリース', { currency: 'USD' })], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃')] }, 'r1').calendarCandidates.length, 0, 'classification:calendar-currency');
  assert.equal(one({ rows: [row('r1', '2026-09-10', 110001, '振込 カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃')] }, 'r1').calendarCandidates.length, 0, 'classification:calendar-amount');
  // two rows for one entry (a reused / duplicate calendar entry) and one row for two entries are ambiguous
  const twoRows = propose({ rows: [row('r5', '2026-09-25', 50000, '振込 サトウ ハナコ'), row('r6', '2026-09-26', 50000, '振込 スズキ ジロウ')], calendar: [entry('p5', '2026-09-22', 50000, 'expense', '外注費', { recurring: true })] });
  for (const r of twoRows.rows) { assert.equal(r.proposal.confidence, 'review', 'classification:calendar-bilateral ' + r.rowId); assert.ok(r.unresolved.includes('calendar-ambiguous')); assert.equal(r.proposal.accountCategoryId, null, 'classification:ambiguous-no-account'); }
  const twoEntries = one({ rows: [row('r1', '2026-09-10', 110000, '振込 カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃'), entry('p2', '2026-09-12', 110000, 'expense', '地代家賃')] }, 'r1');
  assert.ok(twoEntries.unresolved.includes('calendar-ambiguous'), 'classification:calendar-two-entries');
  const late = one({ rows: [row('r1', '2026-10-20', 110000, '振込 カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃')] }, 'r1');
  assert.deepEqual(late.calendarCandidates.map(c => c.kind), ['late'], 'classification:calendar-late'); assert.equal(late.proposal.confidence, 'review'); assert.ok(late.unresolved.includes('calendar-late')); assert.equal(late.proposal.accountCategoryId, null);
  const combined = one({ rows: [row('r1', '2026-09-10', 30000, '振込 カクウ')], calendar: [entry('p1', '2026-09-09', 10000, 'expense', '外注費'), entry('p2', '2026-09-11', 20000, 'expense', '外注費')] }, 'r1');
  assert.deepEqual(combined.calendarCandidates.map(c => c.kind), ['combined'], 'classification:calendar-combined'); assert.deepEqual(combined.calendarCandidates[0].paymentIds, ['p1', 'p2']); assert.ok(combined.unresolved.includes('calendar-combined'));
  const cancelled = one({ rows: [row('r1', '2026-09-10', 110000, '振込 カクウリース')], calendar: [entry('p1', '2026-09-10', 110000, 'expense', '地代家賃', { status: 'cancelled' })] }, 'r1');
  assert.equal(cancelled.calendarCandidates.length, 0, 'classification:calendar-cancelled-excluded');
});

test('an inconsistent calendar category is flagged, not silently chosen', () => {
  const r = one({ rows: [row('r1', '2026-09-05', 330, '振込手数料')], calendar: [entry('p1', '2026-09-05', 330, 'expense', '外注費')] }, 'r1');
  assert.ok(r.unresolved.includes('calendar-category-conflict'), 'classification:category-conflict'); assert.equal(r.proposal.confidence, 'review');
});

test('history and explicit teaching: exact payee and direction only; conflicts stay review; the own company is never a supplier', () => {
  const history = [{ payeeKey: 'カクウサブスク', direction: 'out', values: { purpose: '支払手数料', accountCategoryId: 'a1'.repeat(12), supplierId: '' }, state: 'registered' }];
  const r = one({ rows: [row('r9', '2026-10-02', 9900, '口座振替 カクウサブスク')], history }, 'r9');
  assert.equal(r.proposal.purposeKind, 'history', 'classification:history'); assert.equal(r.proposal.accountCategoryId, 'a1'.repeat(12)); assert.equal(r.proposal.confidence, 'supported');
  assert.equal(one({ rows: [row('r9', '2026-10-02', -9900, '口座振替 カクウサブスク')], history }, 'r9').proposal.purposeKind, 'none', 'classification:history-direction');
  assert.equal(one({ rows: [row('r9', '2026-10-02', 9900, '口座振替 カクウサブスクX')], history }, 'r9').proposal.purposeKind, 'none', 'classification:history-exact-payee');
  const conflict = one({ rows: [row('r9', '2026-10-02', 9900, '口座振替 カクウサブスク')], history: [...history, { ...history[0], values: { purpose: '外注費', accountCategoryId: 'a5'.repeat(12) } }] }, 'r9');
  assert.ok(conflict.unresolved.includes('history-conflict'), 'classification:history-conflict'); assert.equal(conflict.proposal.confidence, 'review');
  const taught = one({ rows: [row('r5', '2026-10-05', 50000, '振込 サトウ ハナコ')], teachings: [{ payeeKey: 'サトウハナコ', direction: 'out', values: { purpose: '外注費', accountCategoryId: 'a5'.repeat(12) } }] }, 'r5');
  assert.equal(taught.proposal.purposeKind, 'teaching', 'classification:teaching'); assert.equal(taught.proposal.accountCategoryId, 'a5'.repeat(12));
  const self = one({ rows: [row('r8', '2026-10-01', 300000, '振込 カ）カクウホールディングス')], companyNames: ['カクウホールディングス'], history: [{ payeeKey: 'カクウホールディングス', direction: 'out', values: { purpose: '外注費', accountCategoryId: 'a5'.repeat(12) }, state: 'registered' }] }, 'r8');
  assert.equal(self.proposal.purposeKind, 'own-transfer', 'classification:own-transfer'); assert.equal(self.proposal.accountCategoryId, null, 'classification:own-transfer-not-expense');
  assert.deepEqual(self.transfer, { kind: 'own-company', proof: 'awaiting-other-bank' }); assert.ok(self.unresolved.includes('transfer-awaiting-other-bank'));
  const taughtSelf = one({ rows: [row('r8', '2026-10-01', 300000, '振込 オーエムジエイ')], teachings: [{ payeeKey: 'オーエムジエイ', direction: 'out', values: { purpose: 'own-transfer' } }] }, 'r8');
  assert.equal(taughtSelf.proposal.purposeKind, 'own-transfer', 'classification:taught-own-transfer');
});

test('a personal name alone never yields salary or expense; unknown purposes stay visible', () => {
  const r = one({ rows: [row('r4', '2026-08-01', 50000, '振込 ヤマダ タロウ')] }, 'r4');
  assert.equal(r.proposal.purposeKind, 'none', 'classification:personal-none'); assert.equal(r.proposal.accountCategoryId, null); assert.ok(!/給与|給料|賞与/.test(JSON.stringify(r.proposal)), 'classification:no-salary');
  assert.ok(r.unresolved.includes('purpose-unknown')); assert.equal(r.values.purpose, '');
});

test('tax treatment and T numbers are never inferred from names, bank text or calendar labels', () => {
  const r = one({ rows: [row('r10', '2026-10-03', 5500, '振込 カクウストア T1234567890123 消費税10%')], calendar: [entry('p1', '2026-10-03', 5500, 'expense', '課税仕入10%')] }, 'r10');
  assert.deepEqual(r.tax, { status: 'unknown' }, 'classification:no-tax-inference'); assert.deepEqual(r.invoice, { value: null, status: 'unverified' }, 'classification:no-t-inference');
  assert.equal(r.values.taxCategoryId, ''); assert.equal(r.values.invoiceNumber, ''); assert.equal(r.values.taxRate, null);
});

test('missing history, missing months and candidate origins are surfaced', () => {
  const p = propose({ rows: [row('r0', '2026-06-15', 1000, '振込 カクウ'), row('r1', '2026-09-12', 165, '振込手数料')] });
  assert.equal(p.notes.historyEmpty, true, 'classification:history-empty'); assert.deepEqual(p.notes.monthsWithoutRows, ['2026-07', '2026-08'], 'classification:missing-months');
  assert.equal(fn('missingMonths')([{ date: '2026-01-31' }, { date: '2026-02-01' }]).length, 0);
  assert.deepEqual(p.rows.map(r => r.proposal.purposeKind), ['none', 'bank-fee'], 'classification:origins');
});

test('owner values are validated: only known keys, 24-hex references or blank, T number shape, tax rate bounds', () => {
  const values = fn('classificationValues');
  const v = values({ purpose: '外注費', accountCategoryId: 'a5'.repeat(12), invoiceNumber: 'T1234567890123', taxRate: 10, transferReviewed: false });
  assert.equal(v.accountCategoryId, 'a5'.repeat(12)); assert.equal(v.invoiceNumber, 'T1234567890123'); assert.equal(v.taxRate, 10); assert.equal(v.taxCategoryId, '');
  for (const bad of [{ unknown: 1 }, { accountCategoryId: 'x' }, { invoiceNumber: 'T123' }, { taxRate: 101 }, { taxRate: -1 }, { purpose: 'x'.repeat(101) }, { notes: 'x'.repeat(2001) }, { transferReviewed: 'yes' }, null, []]) assert.throws(() => values(bad), Error, 'classification:values-refused ' + JSON.stringify(bad)?.slice(0, 60));
});

test('registration readiness: purpose, an account, a current source, a reviewed transfer and JPY', () => {
  const ready = fn('registrationReady'), values = { purpose: '支払手数料', accountCategoryId: 'a1'.repeat(12), transferReviewed: false };
  assert.deepEqual(ready({ values, currency: 'JPY' }), { ready: true, reasons: [] }, 'classification:ready');
  assert.deepEqual(ready({ values: { ...values, purpose: '' }, currency: 'JPY' }).reasons, ['purpose-missing']);
  assert.deepEqual(ready({ values: { ...values, accountCategoryId: '' }, currency: 'JPY' }).reasons, ['account-missing']);
  assert.deepEqual(ready({ values, currency: 'JPY', sourceChanged: true }).reasons, ['source-changed'], 'classification:source-changed-not-ready');
  assert.deepEqual(ready({ values, currency: 'JPY', superseded: true }).reasons, ['superseded']);
  assert.deepEqual(ready({ values, currency: 'JPY', transfer: { kind: 'own-company' } }).reasons, ['transfer-unreviewed'], 'classification:transfer-not-ready');
  assert.deepEqual(ready({ values: { ...values, transferReviewed: true }, currency: 'JPY', transfer: { kind: 'own-company' } }).reasons, []);
  assert.deepEqual(ready({ values, currency: 'USD' }).reasons, ['currency-unsupported']);
});

// Fictional reproductions of the observed native statement syntax (parent cases, output/plan/omf-rakuten-native-shiwake-20261020/
// native-format-regression.test.mjs): destination "<bank> <branch> <type> <number> <holder>", a payer-reference suffix with
// unclosed parentheses, spaced dakuten, an ASCII hyphen as the long vowel, card membership fee wording, noon-UTC due dates.
const OWN = 'カクウホールディングス合同会社';
const VENDOR = '架空銀行 架空支店 普通預金 1234567 カ)スミレロシ ゙(依頼人名:カクウホ-ルテ ゙ィンク ゙ス(ト ゙ 振込予定日:2026年09月10日 管理番号:20260910-12345678)';
const OWN_DEST = '架空銀行 架空支店 普通預金 7654321 カクウホ-ルテ ゙ィンク ゙ス(ト ゙(依頼人名:カクウホ-ルテ ゙ィンク ゙ス(ト ゙ 振込予定日:2026年09月10日 管理番号:20260910-98765432)';
const nativeOne = (description, extra = {}) => fn('proposeBankClassifications')({ rows: [row('n1', '2026-09-10', 12000, description)], calendar: [], history: [], teachings: [], companyNames: [OWN], chart, bankAccountName: '普通預金（楽天銀行）', ...extra }).rows[0];
test('native destination syntax: the holder after the account, the payer reference suffix cut, the payer never becomes the payee', () => {
  const normalize = fn('normalizePayee');
  assert.equal(normalize(VENDOR), normalize('株式会社スミレロジ'), 'classification:native-holder'); assert.ok(!/依頼人|振込予定日|管理番号/.test(normalize(VENDOR)));
  assert.equal(nativeOne(VENDOR).transfer, null, 'classification:payer-not-self');
});
test('native own-company destination with spaced dakuten and an ASCII long vowel is an unconfirmed transfer', () => {
  const r = nativeOne(OWN_DEST); assert.ok(r.transfer, 'classification:native-own-transfer'); assert.ok(r.unresolved.includes('transfer-awaiting-other-bank')); assert.equal(r.proposal.accountCategoryId, null);
});
test('card membership fee wording is a card fee; another membership fee is not', () => {
  const purpose = fn('textPurpose');
  assert.equal(purpose('楽天銀行デビットカ-ド会費 (2026年02月01日~2027年01月31日、内消費税 ¥100)', 'out')?.kind, 'card-fee', 'classification:card-fee');
  assert.notEqual(purpose('架空クラブ年会費', 'out')?.kind, 'card-fee', 'classification:other-membership-not-card-fee');
  assert.deepEqual(nativeOne('楽天銀行デビットカ-ド会費 (内消費税 ¥100)').tax, { status: 'unknown' }, 'classification:card-fee-no-tax');
});
test('a calendar-only candidate keeps its title and stays review even when its category names a chart account; calendar days compare despite noon-UTC due dates', () => {
  const entryOf = category => ({ id: 'p1', title: '架空事務所の更新料', dueDate: '2026-09-10T12:00:00.000Z', amount: 12000, currency: 'JPY', type: 'expense', status: 'pending', category });
  for (const category of ['Invoice', '支払手数料']) { const r = nativeOne('振込 フジカワ', { calendar: [entryOf(category)] }); assert.equal(r.proposal.purpose, '架空事務所の更新料', 'classification:calendar-title ' + category); assert.equal(r.proposal.confidence, 'review', 'classification:calendar-review ' + category); assert.equal(r.proposal.accountCategoryId, null); }
  const near = fn('proposeBankClassifications')({ rows: [row('n1', '2026-09-03', 12000, '振込 フジカワ')], calendar: [entryOf('Invoice')], chart }).rows[0];
  assert.ok(near.calendarCandidates.some(c => c.kind === 'unique' && c.dueDate === '2026-09-10'), 'classification:calendar-days');
});
test('a row whose corrected predecessor was registered or linked is not registered again', () => {
  assert.deepEqual(fn('registrationReady')({ values: { purpose: 'x', accountCategoryId: 'a1'.repeat(12) }, currency: 'JPY', predecessorRegistered: true }).reasons, ['predecessor-registered'], 'classification:predecessor-registered');
});

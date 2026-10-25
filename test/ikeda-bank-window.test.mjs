// test/ikeda-bank-window.test.mjs — the 池田泉州銀行 ビジネスゲート bank window and its preserved request (plan omf-ikeda-collector-20261025),
// pure: the first day of the month before last (前々月1日) on the JST day, year/leap/month-end boundaries, the effective/missing split of
// open and closed requests, archive gaps, the schedule's support reasons, the capability/template tables (other banks unchanged), the
// 勘定日 header guess and the account identity input. Under OMF_TEST_SHARED_DIR the named mutant copies of shared/ are tested instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = process.env.OMF_TEST_SHARED_DIR ? path.resolve(process.env.OMF_TEST_SHARED_DIR) : new URL('../shared/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const P = await import(pathToFileURL(path.join(dir, 'finance-payment-match.mjs')).href);
const J = await import(pathToFileURL(path.join(dir, 'finance-bank-schedule.mjs')).href);

test('bank window: 前々月1日 of the JST day, across month, year and leap boundaries', () => {
  const from = today => P.bankAvailableFrom('ikeda', 'portal', today);
  for (const [today, want] of [['2026-10-25', '2026-08-01'], ['2026-10-01', '2026-08-01'], ['2026-10-31', '2026-08-01'], ['2026-01-15', '2025-11-01'], ['2026-02-28', '2025-12-01'], ['2028-02-29', '2027-12-01'], ['2028-03-01', '2028-01-01'], ['2027-12-31', '2027-10-01'], ['2026-03-31', '2026-01-01']]) assert.equal(from(today), want, 'window:from ' + today);
  // JST: 2026-10-31T14:59:59Z is still 10-31 in Japan, 15:00Z is 11-01 (the window moves to 09-01)
  assert.equal(from(P.jstToday(new Date('2026-10-31T14:59:59.999Z'))), '2026-08-01', 'window:jst-before-midnight');
  assert.equal(from(P.jstToday(new Date('2026-10-31T15:00:00.000Z'))), '2026-09-01', 'window:jst-midnight');
  for (const [p, v] of [['ikeda', 'direct'], ['ikeda', null], ['rakuten', 'standard'], ['paypay', 'standard'], ['resona', 'direct']]) assert.equal(P.bankAvailableFrom(p, v, '2026-10-25'), null, 'window:none-for ' + p + '/' + v);
  assert.equal(P.bankAvailableFrom('ikeda', 'portal', 'not-a-day'), null);
});
test('coverage window: the request is kept; open periods follow the day, closed ones keep their end; missing days are named; nothing offered → effective null', () => {
  const w = (saved, today) => P.bankCoverageWindow('ikeda', 'portal', saved, today);
  assert.deepEqual(w({ from: '2026-06-01', to: null }, '2026-10-25'), { rule: 'month-before-last', requested: { from: '2026-06-01', to: null }, available: { from: '2026-08-01', to: '2026-10-25' }, effective: { from: '2026-08-01', to: '2026-10-25' }, missing: { from: '2026-06-01', to: '2026-07-31' } }, 'window:open-partial');
  assert.deepEqual(w({ from: '2026-09-10', to: null }, '2026-10-25').effective, { from: '2026-09-10', to: '2026-10-25' }, 'window:inside'); assert.equal(w({ from: '2026-09-10', to: null }, '2026-10-25').missing, null);
  assert.deepEqual(w({ from: '2026-07-01', to: '2026-09-30' }, '2026-10-25'), { rule: 'month-before-last', requested: { from: '2026-07-01', to: '2026-09-30' }, available: { from: '2026-08-01', to: '2026-10-25' }, effective: { from: '2026-08-01', to: '2026-09-30' }, missing: { from: '2026-07-01', to: '2026-07-31' } }, 'window:closed-end-kept');
  const gone = w({ from: '2026-01-01', to: '2026-05-31' }, '2026-10-25'); assert.equal(gone.effective, null, 'window:wholly-unavailable'); assert.deepEqual(gone.missing, { from: '2026-01-01', to: '2026-05-31' });
  assert.deepEqual(w({ from: '2026-01-01', to: '2026-07-31' }, '2026-10-25').effective, null, 'window:ends-the-day-before');
  assert.deepEqual(w({ from: '2026-01-01', to: '2026-08-01' }, '2026-10-25').effective, { from: '2026-08-01', to: '2026-08-01' }, 'window:first-day-only');
  // month rollover: the same open request a day later in a new month moves its effective start
  assert.deepEqual(w({ from: '2026-06-01', to: null }, '2026-11-01').effective, { from: '2026-09-01', to: '2026-11-01' }, 'window:rollover');
  assert.deepEqual(w({ from: '2027-12-15', to: null }, '2028-02-29').effective, { from: '2027-12-15', to: '2028-02-29' }, 'window:leap-year');
  assert.equal(P.bankCoverageWindow('rakuten', 'standard', { from: '2020-01-01', to: null }, '2026-10-25'), null, 'window:other-banks-unchanged');
  assert.throws(() => w({ from: '2026-10-26', to: null }, '2026-10-25'), 'window:future-refused');
});
test('archive gaps: requested days before the window that no imported retrieval covered', () => {
  const g = (covered, requested = { from: '2026-01-01', to: '2026-10-25' }, availableFrom = '2026-08-01') => J.bankArchiveGaps({ requested, covered, availableFrom });
  assert.deepEqual(g([]), [{ from: '2026-01-01', to: '2026-07-31' }], 'gaps:none-covered');
  assert.deepEqual(g([{ from: '2026-01-01', to: '2026-10-25' }]), [], 'gaps:fully-covered');
  assert.deepEqual(g([{ from: '2026-03-01', to: '2026-04-30' }, { from: '2026-04-20', to: '2026-05-15' }]), [{ from: '2026-01-01', to: '2026-02-28' }, { from: '2026-05-16', to: '2026-07-31' }], 'gaps:merged-overlaps');
  assert.deepEqual(g([{ from: '2025-12-01', to: '2026-02-15' }, { from: '2026-02-16', to: '2026-07-31' }]), [], 'gaps:adjacent');
  assert.deepEqual(g([{ from: '2026-02-01', to: '2026-02-29' }]), [{ from: '2026-01-01', to: '2026-07-31' }], 'gaps:invalid-ignored');
  assert.deepEqual(g([], { from: '2026-09-01', to: '2026-10-25' }), [], 'gaps:inside-window');
  assert.deepEqual(g([], { from: '2026-01-01', to: '2026-03-31' }), [{ from: '2026-01-01', to: '2026-03-31' }], 'gaps:closed-before-window');
  assert.deepEqual(J.bankArchiveGaps({ requested: null, covered: [], availableFrom: '2026-08-01' }), []);
});
test('schedule support: identity and a wholly unavailable period are reasons for the windowed variant only', () => {
  const base = { provider: 'ikeda', variant: 'portal', templateId: 't', coverage: { from: '2026-06-01', to: null }, accountIdentity: { branch: 'カクウ支店', type: '普通', number: '0000001' } };
  assert.equal(J.bankScheduleSupport(base, '2026-10-25'), null, 'schedule:supported');
  assert.equal(J.bankScheduleSupport({ ...base, accountIdentity: undefined }, '2026-10-25'), 'no-identity', 'schedule:no-identity');
  assert.equal(J.bankScheduleSupport({ ...base, coverage: { from: '2026-01-01', to: '2026-05-31' } }, '2026-10-25'), 'bank-window', 'schedule:bank-window');
  assert.equal(J.bankScheduleSupport({ ...base, variant: 'direct' }, '2026-10-25'), 'observe-only', 'schedule:direct-observe');
  assert.equal(J.bankScheduleSupport({ provider: 'rakuten', variant: 'standard', templateId: 't', coverage: { from: '2020-01-01', to: '2020-02-01' } }, '2026-10-25'), null, 'schedule:other-banks-unchanged');
});
test('tables: ikeda portal retrieves with its native 10-column template and window; ikeda direct, resona and the other banks are unchanged', () => {
  assert.equal(P.bankCollectionMode('ikeda', 'portal'), 'retrieve'); for (const v of ['direct', null, 'x']) assert.equal(P.bankCollectionMode('ikeda', v), 'observe', 'tables:ikeda-' + v);
  assert.deepEqual(P.bankCapability('ikeda', 'portal'), { mode: 'retrieve', steps: 'implemented', template: 'ikeda-portal-native', period: 'required', liveVerified: false, availability: 'month-before-last' }, 'tables:ikeda-capability');
  assert.deepEqual(P.bankCapability('rakuten', 'standard'), { mode: 'retrieve', steps: 'implemented', template: 'rakuten-standard-native', period: 'required', liveVerified: false }, 'tables:rakuten-unchanged');
  assert.deepEqual(P.bankCapability('paypay', 'standard'), { mode: 'retrieve', steps: 'implemented', template: null, period: 'required', liveVerified: false }, 'tables:paypay-unchanged');
  assert.deepEqual(P.bankCapability('resona', 'direct'), { mode: 'observe', steps: 'contract-pending', template: null, period: 'portal', liveVerified: false }, 'tables:resona-unchanged');
  assert.ok(P.BANK_PROVIDERS.every(p => p[2] === 'contract-pending'), 'tables:provider-table-honest');
  const t = P.BANK_NATIVE_TEMPLATES.ikeda.portal;
  assert.deepEqual(t.headers, ['勘定日', '(起算日)', 'お支払金額', 'お預り金額', '残高', '取引区分', '明細区分', '金融機関', '支店', '摘要']);
  assert.deepEqual([t.mapping.date, t.mapping.description, t.mapping.outflow, t.mapping.inflow, t.mapping.balance, t.mapping.amount, t.mapping.transactionId, t.mapping.reference, t.amountSign], ['0', '9', '2', '3', '4', '', '', '', 'outflow-positive'], 'tables:ikeda-native-mapping (no bank ID, no row number)');
  assert.deepEqual(P.guessBankMapping(t.headers), { ...Object.fromEntries(P.BANK_FIELDS.map(([k]) => [k, ''])), date: '0', description: '9', outflow: '2', inflow: '3', balance: '4' }, 'tables:kanjoubi-guess');
  assert.equal(P.guessBankMapping(['取引日', '摘要', '金額']).date, '0', 'tables:other-guess-unchanged');
});
test('native rows: outflow positive, inflow negative, balance kept, a file-row key (no invented bank ID)', async () => {
  const source = { hash: 'a'.repeat(64), sheet: 'Sheet1', row: 2 };
  const out = await P.normalizeBankRow({ date: '2026-08-03', description: '架空株式会社', outflow: '1000', inflow: '', balance: '9000', amount: '', reference: '', transactionId: '', currency: '', direction: '' }, source, { amountSign: 'outflow-positive' });
  assert.deepEqual([out.date, out.amount, out.direction, out.balance, out.idKind], ['2026-08-03', 1000, 'out', 9000, 'file-row']);
  const inn = await P.normalizeBankRow({ date: '2026/08/04', description: '架空入金', outflow: '', inflow: '2000', balance: '11000' }, { ...source, row: 3 }, { amountSign: 'outflow-positive' });
  assert.deepEqual([inn.date, inn.amount, inn.direction], ['2026-08-04', -2000, 'in']);
});
test('account identity input: branch, type and the full 7-digit number; anything else is refused; absent is null', () => {
  assert.deepEqual(P.bankAccountIdentityInput({ branch: ' カクウ支店 ', type: '普通', number: '0000001' }), { branch: 'カクウ支店', type: '普通', number: '0000001' });
  assert.deepEqual(P.bankAccountIdentityInput({ branch: 'ｶｸｳ支店', type: '当座', number: '０１２３４５６' }), { branch: 'カクウ支店', type: '当座', number: '0123456' }, 'identity:nfkc');
  for (const v of [undefined, null, { branch: '', type: '', number: '' }]) assert.equal(P.bankAccountIdentityInput(v), null);
  for (const bad of [{ branch: 'x', type: '普通', number: '0001' }, { branch: 'x', type: '普通', number: '00000011' }, { branch: '', type: '普通', number: '0000001' }, { branch: 'x', type: 'ふつう', number: '0000001' }, { branch: 'x'.repeat(41), type: '普通', number: '0000001' }, 'x', []]) assert.throws(() => P.bankAccountIdentityInput(bad), Error, 'identity:bad ' + JSON.stringify(bad));
  assert.equal(P.bankIdentityRequired('ikeda', 'portal'), true); for (const [p, v] of [['ikeda', 'direct'], ['paypay', 'standard'], ['rakuten', 'standard']]) assert.equal(P.bankIdentityRequired(p, v), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// OMF_TEST_STATEMENT_MODULE points at a mutant copy beside the original (scripts/zoomer-fixtures/omf-amex-recent.mjs leg M).
const here = path.dirname(fileURLToPath(import.meta.url));
const { latestClosed, verifyStatement, tokyoDate, recentRange, verifyRecent, verifyRecentRows, RECENT } = await import(pathToFileURL(process.env.OMF_TEST_STATEMENT_MODULE ? path.resolve(process.env.OMF_TEST_STATEMENT_MODULE) : path.join(here, '..', 'statement.mjs')).href);

const now = Date.parse('2026-05-21T16:00:00Z');
const link = (start, end, href = '/activity/statement?end=' + end) => ({ text: start.replaceAll('-', '/') + ' - ' + end.replaceAll('-', '/'), href });
const april = link('2026-03-22', '2026-04-21'), may = link('2026-04-22', '2026-05-21');
test('selects the newest bank-provided closed period, using Japan midnight and ignoring order/duplicates', () => {
  const selected = latestClosed([april, link('2026-05-22', '2026-06-21'), may, may, { ...may, text: 'この期間を見る' }], now);
  assert.equal(tokyoDate(now), '2026-05-22');
  assert.equal(selected.end, '2026-05-21');
  assert.equal(latestClosed([april, may], Date.parse('2026-05-21T14:59:59Z')).end, '2026-04-21');
  assert.equal(latestClosed([link('2025-12-20', '2026-01-19')], now).start, '2025-12-20');
});
test('rejects invalid, contradictory or absent periods rather than silently downloading another month', () => {
  assert.throws(() => latestClosed([link('2026-02-30', '2026-03-21')], now));
  assert.throws(() => latestClosed([link('2026-05-22', '2026-05-21')], now));
  assert.throws(() => latestClosed([may, link('2026-04-23', '2026-05-21')], now), /conflicting/);
  assert.throws(() => latestClosed([link('2026-04-22', '2026-05-21', '/activity/statement?end=2026-04-21')], now), /do not agree/);
  assert.throws(() => latestClosed([link('2026-04-22', '2026-05-21', 'https://example.invalid/activity/statement?end=2026-05-21')], now), /No closed/);
  assert.throws(() => latestClosed([link('2026-04-22', '2026-05-21', '/activity/statement?end=2026-05-21&end=2026-04-21')], now));
  assert.throws(() => latestClosed([], now), /No closed/);
});
test('requires the selected URL, exact displayed dates, one account and a complete count', () => {
  const selected = latestClosed([may], now);
  const snapshot = { url: selected.url, periods: ['（2026/04/22－2026/05/21）', '（2026/04/22－2026/05/21）'], cards: ['-12345', '-12345'], counts: [[12, 12]] };
  assert.equal(verifyStatement(snapshot, selected, '12345'), 12);
  assert.throws(() => verifyStatement({ ...snapshot, url: 'https://global.americanexpress.com/activity/statement' }, selected, '12345'));
  assert.throws(() => verifyStatement({ ...snapshot, periods: ['（2026/05/22－2026/06/21）'] }, selected, '12345'));
  assert.throws(() => verifyStatement({ ...snapshot, cards: ['-12345', '-54321'] }, selected, '12345'));
  assert.throws(() => verifyStatement(snapshot, selected, '54321'));
  for (const counts of [[[12, 10]], [[0, 0]], [[12, 12], [2, 2]], [[NaN, NaN]]]) assert.throws(() => verifyStatement({ ...snapshot, counts }, selected, '12345'));
});

// ── the recent activity (case omf-amex-recent-activity-20261102): the sanitized contract's range shape, the JST observation day, the same card and count rules ──
const shape = (start, closing) => `${start}ー今日現在（次回締め日${closing})`;
const shown = { url: 'https://global.americanexpress.com/activity/recent', ranges: [shape('2026/05/10', '2026/06/09')], cards: ['-12345'], counts: [[4, 4]] };
const row = (processingDate, purchaseDate = processingDate) => ({ processingDate, purchaseDate });
test('recentRange reads the observed shape and nothing near it', () => {
  assert.deepEqual(recentRange(shape('2026/05/10', '2026/06/09')), { start: '2026-05-10', closing: '2026-06-09', key: '2026-05-10:2026-06-09' }, 'amex-recent:range-observed-shape');
  for (const text of [' 2026/05/10 ー 今日現在 （ 次回締め日 2026/06/09 ) ', '2026/05/10－今日現在(次回締め日2026/06/09）', '2026/05/10-今日現在（次回締め日2026/06/09）', '2026/05/10–今日現在（次回締め日2026/06/09)'])
    assert.equal(recentRange(text)?.closing, '2026-06-09', 'amex-recent:range-same-marks ' + text);
  for (const text of ['', '2026/05/10 - 2026/06/09', '（2026/05/10－2026/06/09）', '2026/05/10ー今日現在', '今日現在（次回締め日2026/06/09)', '2026/05/10ー昨日現在（次回締め日2026/06/09)', '2026/05/10ー今日現在（締め日2026/06/09)', '2026/02/30ー今日現在（次回締め日2026/06/09)', '2026/05/10ー今日現在（次回締め日2026/02/30)', '前回 2026/05/10ー今日現在（次回締め日2026/06/09)', '2026/05/10ー今日現在（次回締め日2026/06/09) 件', '2026-05-10ー今日現在（次回締め日2026-06-09)'])
    assert.equal(recentRange(text), null, 'amex-recent:range-near-form-refused ' + text);
});
test('verifyRecent: the recent page of the one signed-in card, a displayed cycle that holds today in Japan, a complete count; the observation ends today in Japan', () => {
  assert.deepEqual(verifyRecent(shown, '12345', now), { kind: 'pending', start: '2026-05-10', closing: '2026-06-09', end: '2026-05-22', key: '2026-05-10:2026-06-09', pageCount: 4 }, 'amex-recent:verified');
  assert.equal(verifyRecent({ ...shown, ranges: [shown.ranges[0], shown.ranges[0]], cards: ['-12345', '-12345'], counts: [[4, 4], [4, 4]] }, '12345', now).pageCount, 4, 'amex-recent:repeats-are-one-evidence');
  assert.equal(verifyRecent({ ...shown, url: shown.url + '?account_key=fictional' }, '12345', now).pageCount, 4, 'amex-recent:a-query-selects-no-period');
  assert.equal(verifyRecent(shown, '12345', Date.parse('2026-05-21T14:59:59Z')).end, '2026-05-21', 'amex-recent:end-before-japan-midnight');
  assert.equal(verifyRecent(shown, '12345', Date.parse('2026-05-21T15:00:00Z')).end, '2026-05-22', 'amex-recent:end-after-japan-midnight');
  assert.equal(verifyRecent({ ...shown, ranges: [shape('2026/05/22', '2026/06/21')] }, '12345', now).start, '2026-05-22', 'amex-recent:first-day-of-the-cycle');
  assert.equal(verifyRecent({ ...shown, ranges: [shape('2026/04/22', '2026/05/22')] }, '12345', now).closing, '2026-05-22', 'amex-recent:closing-day-itself');
  const refused = (change, message, label) => assert.throws(() => verifyRecent({ ...shown, ...change }, '12345', now), message, 'amex-recent:' + label);
  for (const url of ['https://global.americanexpress.com/activity/statement', 'https://global.americanexpress.com/activity', 'https://example.invalid/activity/recent', 'http://global.americanexpress.com/activity/recent']) refused({ url }, /did not open the recent activity/, 'url-refused ' + url);
  for (const cards of [[], ['-54321'], ['-12345', '-54321']]) refused({ cards }, /does not match this connection/, 'card-refused ' + cards);
  assert.throws(() => verifyRecent(shown, '54321', now), /does not match this connection/, 'amex-recent:another-primary-card');
  for (const ranges of [[], ['2026/05/10 - 2026/06/09'], [shown.ranges[0], shape('2026/04/10', '2026/05/30')], [shape('2026/04/22', '2026/05/21')], [shape('2026/05/23', '2026/06/22')], [shape('2026/06/09', '2026/05/25')]]) refused({ ranges }, /displayed dates do not cover the current activity/, 'range-refused ' + ranges);
  for (const counts of [[[4, 3]], [[3, 4]], [[4, 4], [5, 5]], [[NaN, NaN]], [[5001, 5001]], [[1.5, 1.5]], []]) refused({ counts }, /complete recent activity count could not be verified/, 'count-refused ' + JSON.stringify(counts));
  refused({ counts: [[0, 0]] }, /no recent activity/, 'empty-is-its-own-answer');
});
test('verifyRecentRows: processing dates inside the displayed cycle up to the observation day; an earlier purchase date is a late submission, not a wrong file', () => {
  const coverage = verifyRecent(shown, '12345', now);
  assert.doesNotThrow(() => verifyRecentRows([row('2026-05-10'), row('2026-05-22', '2026-04-30')], coverage), 'amex-recent:rows-inside');
  for (const rows of [[row('2026-05-09')], [row('2026-05-23')], [row('2026-05-12'), row('2026-05-23')]]) assert.throws(() => verifyRecentRows(rows, coverage), /outside its displayed dates/, 'amex-recent:rows-outside');
});
test('the closed rules are untouched by the recent page: its link is no period, its address is no statement, and the closed reader takes nothing from a recent snapshot', () => {
  const selected = latestClosed([may, { text: '直近のご利用分', href: '/activity/recent' }], now);
  assert.equal(selected.end, '2026-05-21', 'amex-recent:closed-ignores-the-recent-link');
  assert.throws(() => latestClosed([{ text: '直近のご利用分', href: RECENT }], now), /No closed/, 'amex-recent:recent-link-is-no-closed-statement');
  assert.throws(() => verifyStatement({ ...shown, periods: [] }, selected, '12345'), /did not open the selected statement/, 'amex-recent:recent-page-is-no-statement');
  assert.throws(() => verifyRecent({ ...shown, url: selected.url }, '12345', now), /did not open the recent activity/, 'amex-recent:statement-page-is-not-recent');
});

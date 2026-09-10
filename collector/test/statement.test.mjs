import test from 'node:test';
import assert from 'node:assert/strict';
import { latestClosed, verifyStatement, tokyoDate } from '../statement.mjs';

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

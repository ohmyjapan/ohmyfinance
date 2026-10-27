// Date parity and fiscal-period contracts: the pure helpers the Navi reads, the transactions page and the export route share.
// Shared code only: no database, model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fiscalPeriodsFor, fiscalYearFor, addDayKey, zonedDayStart, isRealDateKey, validTimeZone } from '../shared/finance-navi-business.mjs';

const period = (startMonth, start, end) => ({ startMonth, start, end });

test('fiscalPeriodsFor names the period containing the local date, the one before and the one after, from the saved start month only', () => {
 // EX02: clock 2026-10-27 in Asia/Tokyo with fiscalYearStart 11 -> 2025-11-01..2026-10-31 is CURRENT, not previous.
 assert.deepEqual(fiscalPeriodsFor('2026-10-27', 11), { startMonth: 11, current: period(11, '2025-11-01', '2026-10-31'), previous: period(11, '2024-11-01', '2025-10-31'), next: period(11, '2026-11-01', '2027-10-31') }, 'parity:fiscal-periods-ex02');
 assert.deepEqual(fiscalPeriodsFor('2026-10-31', 11).current, period(11, '2025-11-01', '2026-10-31'), 'parity:fiscal-periods-final-day');
 assert.deepEqual(fiscalPeriodsFor('2026-11-01', 11), { startMonth: 11, current: period(11, '2026-11-01', '2027-10-31'), previous: period(11, '2025-11-01', '2026-10-31'), next: period(11, '2027-11-01', '2028-10-31') }, 'parity:fiscal-periods-first-day');
 assert.deepEqual(fiscalPeriodsFor('2026-03-31', 4).current, period(4, '2025-04-01', '2026-03-31'), 'parity:fiscal-periods-april-end');
 assert.deepEqual(fiscalPeriodsFor('2026-04-01', 4), { startMonth: 4, current: period(4, '2026-04-01', '2027-03-31'), previous: period(4, '2025-04-01', '2026-03-31'), next: period(4, '2027-04-01', '2028-03-31') }, 'parity:fiscal-periods-april-start');
 assert.deepEqual(fiscalPeriodsFor('2026-10-27', 1), { startMonth: 1, current: period(1, '2026-01-01', '2026-12-31'), previous: period(1, '2025-01-01', '2025-12-31'), next: period(1, '2027-01-01', '2027-12-31') }, 'parity:fiscal-periods-january');
 for (const startMonth of [null, undefined, 0, 13, 4.5, '4']) assert.equal(fiscalPeriodsFor('2026-10-27', startMonth), null, 'parity:fiscal-periods-unrecorded ' + String(startMonth));
 assert.equal(fiscalPeriodsFor('2026-02-30', 4), null, 'parity:fiscal-periods-invalid-key');
 assert.equal(fiscalPeriodsFor(undefined, 4), null, 'parity:fiscal-periods-invalid-key');
});

test('the three periods are contiguous and current agrees with fiscalYearFor for every month and start month', () => {
 for (let startMonth = 1; startMonth <= 12; startMonth++) for (let month = 1; month <= 12; month++) {
  const key = `2026-${String(month).padStart(2, '0')}-15`, p = fiscalPeriodsFor(key, startMonth);
  assert.deepEqual(p.current, fiscalYearFor(key, startMonth), 'parity:fiscal-current ' + key + '/' + startMonth);
  assert.equal(p.previous.end, addDayKey(p.current.start, -1), 'parity:fiscal-previous ' + key + '/' + startMonth);
  assert.equal(p.next.start, addDayKey(p.current.end, 1), 'parity:fiscal-next ' + key + '/' + startMonth);
  assert.ok(p.previous.start < p.previous.end && p.previous.end < p.current.start && p.current.start <= key && key <= p.current.end && p.current.end < p.next.start && p.next.start < p.next.end, 'parity:fiscal-order ' + key + '/' + startMonth);
  assert.notDeepEqual(p.previous, p.current, 'parity:fiscal-previous ' + key + '/' + startMonth);
 }
});

// The page's date edges: a real date key is the whole local day of the company's saved zone, the same window the export route resolves.
const dayWindow = (key, timeZone) => ({ start: zonedDayStart(key, timeZone).toISOString(), end: new Date(zonedDayStart(addDayKey(key, 1), timeZone).getTime() - 1).toISOString() });
test('a date key is a whole local day of the saved zone: Tokyo, New York and a New York DST day', () => {
 assert.deepEqual(dayWindow('2026-10-31', 'Asia/Tokyo'), { start: '2026-10-30T15:00:00.000Z', end: '2026-10-31T14:59:59.999Z' }, 'parity:page-window-tokyo');
 assert.deepEqual(dayWindow('2026-10-31', 'America/New_York'), { start: '2026-10-31T04:00:00.000Z', end: '2026-11-01T03:59:59.999Z' }, 'parity:page-window-new-york');
 assert.deepEqual(dayWindow('2026-03-08', 'America/New_York'), { start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T03:59:59.999Z' }, 'parity:page-window-dst-day');
 assert.equal(validTimeZone(undefined), null); assert.equal(validTimeZone('Not/AZone'), null); assert.equal(validTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
 assert.equal(isRealDateKey('2026-10-31'), true); assert.equal(isRealDateKey('2026-10-31T12:00:00.000Z'), false, 'parity:non-key-keeps-instant');
});

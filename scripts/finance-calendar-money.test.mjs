import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCalendarMoney, calendarCurrencyTotals } from '../shared/finance-calendar-money.mjs'

test('calendar keeps saved USD/EUR cents in Japanese and Korean presentation', () => {
  for (const locale of ['ja', 'ko']) {
    assert.match(formatCalendarMoney(125.5, 'USD', locale), /125\.50/)
    assert.match(formatCalendarMoney(125.5, 'USD', locale), /\$/)
    assert.doesNotMatch(formatCalendarMoney(125.5, 'USD', locale), /[￥¥₩]/)
    assert.match(formatCalendarMoney(15.75, 'EUR', locale), /15\.75/)
  }
})

test('calendar JPY/KRW use their minor units, independent of interface language', () => {
  assert.match(formatCalendarMoney(12760, 'JPY', 'ko'), /12,760/)
  assert.match(formatCalendarMoney(12760, 'JPY', 'ko'), /[￥¥]/)
  assert.doesNotMatch(formatCalendarMoney(12760, 'JPY', 'ko'), /₩|\.00/)
  assert.match(formatCalendarMoney(5000, 'KRW', 'ja'), /[₩]/)
})

test('unknown and missing units stay literal and never become a locale currency', () => {
  assert.equal(formatCalendarMoney(125.5, 'NOT-A-CURRENCY', 'ko'), '125.5 NOT-A-CURRENCY')
  assert.equal(formatCalendarMoney(125.5, null, 'ja'), '125.5 —')
  assert.equal(formatCalendarMoney(0, '', 'ko'), '0 —')
})

test('monthly plans group each saved unit and exclude only cancelled payments', () => {
  const rows = [
    { amount: 12760, currency: 'JPY', type: 'income', status: 'pending' },
    { amount: 125.5, currency: 'USD', type: 'income', status: 'pending' },
    { amount: 15.75, currency: 'USD', type: 'expense', status: 'paid' },
    { amount: 10, currency: 'JPY', type: 'expense', status: 'overdue' },
    { amount: 1.25, currency: 'USD', type: 'income', status: 'completed' },
    { amount: 99999, currency: 'JPY', type: 'income', status: 'cancelled' },
    { amount: 0, currency: 'EUR', type: 'income', status: 'pending' },
    { amount: 42, type: 'expense', status: 'pending' }
  ]
  const before = JSON.stringify(rows)
  assert.deepEqual(calendarCurrencyTotals(rows), [
    { currency: '', income: 0, expense: 42 },
    { currency: 'EUR', income: 0, expense: 0 },
    { currency: 'JPY', income: 12760, expense: 10 },
    { currency: 'USD', income: 126.75, expense: 15.75 }
  ])
  assert.equal(JSON.stringify(rows), before)
  assert.deepEqual(calendarCurrencyTotals([]), [])
})

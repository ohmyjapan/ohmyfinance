// Reduced-rate (軽減税率) mark contracts (plan omf-keigen-mark-20261030 §3 paths P1-P7): shared code only, no database, model or
// network. One rule decides what the transaction list, the detail page and the export route show.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reducedRateMark, REDUCED_RATE_MARK } from '../shared/finance-reduced-rate.mjs'

const MARK = '※軽減'
const ON = '2026-10-01T03:00:00.000Z'
const category = (name, rate) => ({ _id: 'c'.repeat(24), name, ...(rate === undefined ? {} : { rate }) })
const row = (fields) => ({ _id: 'a'.repeat(24), date: ON, amount: 1080, type: '支出', ...fields })

test('the mark is the text the books show', () => {
  assert.equal(REDUCED_RATE_MARK, MARK, 'reduced-rate:mark-text')
})

test('P1: a 税区分 at rate 8 marks the row', () => {
  assert.equal(reducedRateMark(row({ taxCategoryId: category('課税仕入(軽減)', 8) })), MARK, 'reduced-rate:category-8')
})

test('P2: a 税区分 at rate 10 never marks, even with 税率 8 on the row', () => {
  assert.equal(reducedRateMark(row({ taxCategoryId: category('課税仕入', 10) })), '', 'reduced-rate:category-10')
  assert.equal(reducedRateMark(row({ taxCategoryId: category('課税仕入', 10), taxRate: 8 })), '', 'reduced-rate:category-decides')
  assert.equal(reducedRateMark(row({ taxCategoryId: category('非課税', 0), taxRate: 8 })), '', 'reduced-rate:category-0-decides')
})

test('P3: a 税区分 without a rate leaves the decision to the row 税率', () => {
  assert.equal(reducedRateMark(row({ taxCategoryId: category('Synthetic rate-less'), taxRate: 8 })), MARK, 'reduced-rate:rateless-category')
  assert.equal(reducedRateMark(row({ taxCategoryId: category('Synthetic rate-less', null), taxRate: 8 })), MARK, 'reduced-rate:null-rate-category')
  assert.equal(reducedRateMark(row({ taxCategoryId: category('Synthetic rate-less'), taxRate: 10 })), '', 'reduced-rate:rateless-category-10')
})

test('P4: no 税区分 — the row 税率 decides; nothing to decide means no mark', () => {
  assert.equal(reducedRateMark(row({ taxRate: 8 })), MARK, 'reduced-rate:rate-only-8')
  assert.equal(reducedRateMark(row({ taxCategoryId: null, taxRate: 8 })), MARK, 'reduced-rate:null-category-rate-8')
  assert.equal(reducedRateMark(row({})), '', 'reduced-rate:nothing')
  assert.equal(reducedRateMark(row({ taxRate: 10 })), '', 'reduced-rate:rate-only-10')
})

test('P5: a reduced-rate sales row (課税売上(軽減)) is marked too', () => {
  assert.equal(reducedRateMark(row({ type: '入金', taxCategoryId: category('課税売上(軽減)', 8) })), MARK, 'reduced-rate:sales')
})

test('P6: no mark before 2019-10-01 JST; marked from its first instant', () => {
  assert.equal(reducedRateMark(row({ date: '2019-09-30T14:59:59.999Z', taxRate: 8 })), '', 'reduced-rate:before-start')
  assert.equal(reducedRateMark(row({ date: '2019-09-30T15:00:00.000Z', taxRate: 8 })), MARK, 'reduced-rate:start-instant')
  assert.equal(reducedRateMark(row({ date: new Date('2019-09-30T00:00:00.000Z'), taxCategoryId: category('課税仕入(軽減)', 8) })), '', 'reduced-rate:before-start-date-object')
  assert.equal(reducedRateMark(row({ date: new Date('2019-10-01T00:00:00.000Z'), taxRate: 8 })), MARK, 'reduced-rate:on-start-date-object')
})

test('P7: anything that is not a row is unmarked; a rate given as the string "8" is rate 8', () => {
  for (const value of [null, undefined, '', 'x', 8, true]) assert.equal(reducedRateMark(value), '', 'reduced-rate:not-a-row ' + String(value))
  assert.equal(reducedRateMark(row({ taxRate: '8' })), MARK, 'reduced-rate:string-rate')
  assert.equal(reducedRateMark(row({ taxCategoryId: category('Synthetic string rate', '8') })), MARK, 'reduced-rate:string-category-rate')
})

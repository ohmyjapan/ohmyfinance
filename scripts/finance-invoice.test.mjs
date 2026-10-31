// 適格請求書 helpers (plan omf-invoice-tnumber-20261030 §3 paths P1-P5, P10-P12 and the totals): shared code only, no database,
// model or network. The settings route, the invoice writer, the print HTML and both pages decide with these same functions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRegistrationNumber, isRegistrationNumber, invoiceTotals, invoiceReducedMark } from '../shared/finance-invoice.mjs'

const MARK = '※軽減'
const valid = 'T1234567890123'

test('P1: T and 13 digits is a registration number', () => {
  assert.equal(isRegistrationNumber(valid), true, 'invoice-unit:valid')
  assert.equal(isRegistrationNumber(normalizeRegistrationNumber(valid)), true, 'invoice-unit:valid-normalized')
})

test('P2: anything else is not', () => {
  for (const bad of ['T123456789012', 'T12345678901234', '1234567890123', 'X1234567890123', 't1234567890123', 'T1234567890-12', 'T 1234567890123', 'T１２３４５６７８９０１２３', 'T1234567890123\n', null, undefined, 1234567890123, ['T1234567890123']])
    assert.equal(isRegistrationNumber(bad), false, 'invoice-unit:invalid ' + JSON.stringify(bad))
})

test('P3: a saved 13-digit 法人番号 is not a registration number (it only passes a save when unchanged)', () => {
  assert.equal(isRegistrationNumber('3120003020732'), false, 'invoice-unit:corporate-number')
  assert.equal(normalizeRegistrationNumber('3120003020732'), '3120003020732', 'invoice-unit:corporate-number-kept')
})

test('P4: empty stays empty', () => {
  for (const empty of ['', '   ', null, undefined]) assert.equal(normalizeRegistrationNumber(empty), '', 'invoice-unit:empty ' + JSON.stringify(empty))
  assert.equal(isRegistrationNumber(''), false, 'invoice-unit:empty-not-valid')
})

test('P5: full-width, lower-case and padded input is normalized (NFKC, trim, upper-case)', () => {
  assert.equal(normalizeRegistrationNumber('Ｔ１２３４５６７８９０１２３'), valid, 'invoice-unit:full-width')
  assert.equal(normalizeRegistrationNumber(' t1234567890123 '), valid, 'invoice-unit:lower-padded')
  assert.equal(normalizeRegistrationNumber('　T1234567890123　'), valid, 'invoice-unit:ideographic-space')
  assert.equal(isRegistrationNumber(normalizeRegistrationNumber('ｔ１２３４５６７８９０１２３')), true, 'invoice-unit:full-width-lower')
})

test('P10: an 8% invoice issued on or after 2019-10-01 (JST) carries ※軽減', () => {
  for (const issueDate of ['2026-10-20T00:00:00.000Z', '2019-09-30T15:00:00.000Z', new Date('2023-04-01T03:00:00Z')])
    assert.equal(invoiceReducedMark({ issueDate, taxRate: 8 }), MARK, 'invoice-unit:reduced ' + String(issueDate))
  assert.equal(invoiceReducedMark({ issueDate: '2026-10-20T00:00:00.000Z', taxRate: '8' }), MARK, 'invoice-unit:reduced-string-rate')
})

test('P11: 10% and 0% never carry it', () => {
  for (const taxRate of [10, 0, 5, undefined, null]) assert.equal(invoiceReducedMark({ issueDate: '2026-10-20T00:00:00.000Z', taxRate }), '', 'invoice-unit:not-reduced ' + taxRate)
  assert.equal(invoiceReducedMark(null), '', 'invoice-unit:no-invoice')
})

test('P12: 8% before 2019-10-01 (JST) is the old rate, no mark', () => {
  for (const issueDate of ['2019-09-30T14:59:59.999Z', '2019-09-30T12:00:00.000Z', '2014-04-01T00:00:00.000Z'])
    assert.equal(invoiceReducedMark({ issueDate, taxRate: 8 }), '', 'invoice-unit:old-rate ' + issueDate)
})

test('totals: exactly the arithmetic the writer used before (subtotal of amounts, tax rounded, total)', () => {
  // The writer's formula at 6947394 (companyInvoiceWriteService.ts:29-31), kept here as the reference.
  const before = (items, rate) => { const subtotal = items.reduce((sum, item) => sum + Number(item.amount ?? item.quantity * item.unitPrice), 0); const taxAmount = Math.round(subtotal * rate / 100); return { subtotal, taxAmount, total: subtotal + taxAmount } }
  const cases = [
    [[{ description: 'a', quantity: 3, unitPrice: 1234, amount: 3702 }], 8],
    [[{ description: 'a', quantity: 2, unitPrice: 50000 }], 10],
    [[{ description: 'a', quantity: 1, unitPrice: 999, amount: 999 }, { description: 'b', quantity: 7, unitPrice: 13 }], 8],
    [[{ description: 'a', quantity: 1, unitPrice: 105, amount: 105 }], 10],
    [[{ description: 'a', quantity: 1, unitPrice: 1, amount: 1 }], 0],
    [[], 10],
    [[{ description: 'a', quantity: 1.5, unitPrice: 333, amount: 499.5 }], 8]
  ]
  let seed = 7
  for (let i = 0; i < 200; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; const n = 1 + seed % 4, items = []; for (let k = 0; k < n; k++) { seed = (seed * 1103515245 + 12345) % 2147483648; const q = 1 + seed % 9, p = seed % 20000; items.push(k % 2 ? { description: 'x', quantity: q, unitPrice: p } : { description: 'x', quantity: q, unitPrice: p, amount: q * p }) } cases.push([items, [0, 8, 10][seed % 3]]) }
  for (const [items, rate] of cases) {
    const got = invoiceTotals(items, rate), want = before(items, rate)
    assert.deepEqual({ subtotal: got.subtotal, taxAmount: got.taxAmount, total: got.total }, want, 'invoice-unit:totals ' + JSON.stringify([items, rate]))
  }
})

// Synthetic examples only; no cardholder or production transaction data.
export function aplusCapture(items = [{ merchant: 'Synthetic shop', amount: 1200 }, { merchant: 'Synthetic shop', amount: 1200 }]) {
  const total = items.reduce((n, r) => n + r.amount, 0);
  const rows = items.map((r, i) => ({ sourcePage: 1, sourceRow: i + 1, status: 'unbilled-provisional', transactionDate: r.date || '2026-08-01', merchant: r.merchant, amountJpy: r.amount, cardSuffix: r.card || '1234', paymentMethod: '1回払い', salesType: 'ショッピング', firstPaymentMonth: r.month || '26/09' }));
  const dates = rows.map(r => r.transactionDate).sort();
  return { capturedAt: '2026-08-10T00:00:00.000Z', source: 'https://myaplus.aplus.co.jp/cards/billing/unbilled', sourceType: 'read-only-rendered-page-capture', status: 'unbilled-provisional', finalized: false, pageCount: 1, rowCount: rows.length, displayedTotal: total, totalJpy: total, totalReconciled: true, dateRange: { from: dates[0], to: dates.at(-1) }, rows,
    rawPageFields: [{ activePage: '1', pageNumbers: ['1'], summary: `未請求のご利用金額\n\n未確定\n${total.toLocaleString('en-US')}円`, rows: rows.map((r, i) => ({ position: i + 1, merchant: r.merchant, dateAndPayment: r.transactionDate.slice(2).replaceAll('-', '.') + '   1回払い', amount: r.amountJpy.toLocaleString('en-US') + '円', details: [{ label: 'カード番号下4桁', value: r.cardSuffix }, { label: '売上種別', value: r.salesType }, { label: '初回年月', value: r.firstPaymentMonth }] })) }] };
}

import { dateOnly, digest, MAX_BYTES, MAX_ROWS, parseAmex } from './amex.mjs';

const fail = () => { throw Error('未請求明細の件数・金額・元ページを確認してください'); };
const integer = n => Number.isSafeInteger(n) && Math.abs(n) <= 1e12;
const text = s => typeof s === 'string' && s.length > 0 && s.length <= 2000;
export const isPending = batch => batch.sourceStatus === 'pending';
export const isFinalStatement = batch => !isPending(batch) && batch.period?.kind === 'statement' || batch.finalization?.sourceHash === batch.hash && batch.finalization?.period?.kind === 'statement';

function coverage(start, end, metadata) {
  start = dateOnly(start); end = dateOnly(end);
  if (start > end || Date.parse(end) - Date.parse(start) > 370 * 86400000) fail();
  let fiscalPeriod;
  if (metadata.fiscalStart !== undefined || metadata.fiscalEnd !== undefined) {
    const from = dateOnly(metadata.fiscalStart), to = dateOnly(metadata.fiscalEnd);
    if (from > start || to < end || Date.parse(to) - Date.parse(from) > 370 * 86400000) fail();
    fiscalPeriod = { start: from, end: to };
  }
  return { kind: 'pending', start, end, key: `pending:${start}:${end}`, ...(fiscalPeriod ? { fiscalPeriod } : {}) };
}

export function parsePendingImport(bytes, account, metadata) {
  if (!bytes.length || bytes.length > MAX_BYTES || metadata.kind !== 'pending') fail();
  if ((account.provider || 'amex') === 'amex') {
    const parsed = parseAmex(bytes, account.cardIdentifiers);
    const period = coverage(metadata.start, metadata.end, metadata);
    // Amex recent activity covers processing dates; a late merchant submission
    // can retain an earlier purchase date in the original CSV.
    if (parsed.rows.some(r => r.processingDate < period.start || r.processingDate > period.end)) fail();
    return { ...parsed, period, sourceStatus: 'pending', sourceFormat: 'csv' };
  }
  if (account.provider !== 'aplus') fail();
  const captured = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Both capture layouts retain the rendered page. Normalize only in memory;
  // the archived bytes and their hash remain the original collector output.
  let source = captured;
  if (captured.sourceType === 'rendered_bank_page') {
    if (typeof captured.displayedTotal !== 'string' || !Array.isArray(captured.rawPageFields)) fail();
    const total = /未請求のご利用金額\s+未確定\s+([\d,]+)円/.exec(captured.displayedTotal);
    if (!total) fail();
    source = { ...captured, sourceType: 'read-only-rendered-page-capture', displayedTotal: Number(total[1].replaceAll(',', '')), rawPageFields: captured.rawPageFields.map(page => ({ activePage: String(page.page), pageNumbers: page.pages?.map(String), summary: page.summary, rows: page.rows?.map(r => ({ position: r.sourceRow, merchant: r.merchant, dateAndPayment: r.dateAndPayment, amount: r.amount, details: Object.entries(r.fields || {}).map(([label, value]) => ({ label, value })) })) })) };
  }
  if (source.source !== 'https://myaplus.aplus.co.jp/cards/billing/unbilled' || source.sourceType !== 'read-only-rendered-page-capture' || source.status !== 'unbilled-provisional' || source.finalized !== false || !Number.isFinite(Date.parse(source.capturedAt))) fail();
  if (!Array.isArray(source.rawPageFields) || !source.rawPageFields.length || source.rawPageFields.length > 100 || source.pageCount !== source.rawPageFields.length) fail();
  const pages = source.rawPageFields, pageNumbers = pages.map((_, i) => String(i + 1));
  const derived = [];
  for (const [index, page] of pages.entries()) {
    if (page.activePage !== String(index + 1) || JSON.stringify(page.pageNumbers) !== JSON.stringify(pageNumbers) || !Array.isArray(page.rows) || !page.rows.length) fail();
    const total = /未請求のご利用金額\s+未確定\s+([\d,]+)円/.exec(page.summary || '');
    if (!total || Number(total[1].replaceAll(',', '')) !== source.displayedTotal) fail();
    for (const [position, raw] of page.rows.entries()) {
      const date = /^(\d{2})\.(\d{2})\.(\d{2})\s+(.+)$/.exec(raw.dateAndPayment || '');
      if (raw.position !== position + 1 || !date || !text(raw.merchant) || !/^-?[\d,]+円$/.test(raw.amount || '') || !Array.isArray(raw.details)) fail();
      const field = name => { const matches = raw.details.filter(d => d.label === name); if (matches.length !== 1 || !text(matches[0].value)) fail(); return matches[0].value; };
      const amountJpy = Number(raw.amount.replace(/[円,]/g, ''));
      if (!integer(amountJpy)) fail();
      derived.push({ sourcePage: index + 1, sourceRow: position + 1, status: 'unbilled-provisional', transactionDate: dateOnly(`20${date[1]}-${date[2]}-${date[3]}`), merchant: raw.merchant, amountJpy, cardSuffix: field('カード番号下4桁'), paymentMethod: date[4].trim(), salesType: field('売上種別'), firstPaymentMonth: field('初回年月') });
    }
  }
  if (!derived.length || derived.length > MAX_ROWS || source.rowCount !== derived.length || !Array.isArray(source.rows) || source.rows.length !== derived.length) fail();
  if (derived.some((r, i) => Object.keys(r).some(k => r[k] !== source.rows[i][k]))) fail();
  const total = derived.reduce((n, r) => n + r.amountJpy, 0);
  if (!integer(total) || total !== source.displayedTotal || total !== source.totalJpy || source.totalReconciled !== true) fail();
  const dates = derived.map(r => r.transactionDate).sort();
  if (source.dateRange?.from !== dates[0] || source.dateRange?.to !== dates.at(-1)) fail();
  const period = coverage(dates[0], dates.at(-1), metadata), occurrences = new Map();
  const rows = derived.map((raw, i) => {
    if (!/^\d{4}$/.test(raw.cardSuffix) || !account.cardIdentifiers.includes(raw.cardSuffix) || !/^\d{2}\/(0[1-9]|1[0-2])$/.test(raw.firstPaymentMonth)) fail();
    const ordinary = raw.paymentMethod === '1回払い' && raw.salesType === 'ショッピング';
    const kind = raw.amountJpy <= 0 ? 'credit_review' : ordinary ? 'expense' : 'statement_review';
    const fingerprint = digest(JSON.stringify(['aplus-pending-v1', raw.transactionDate, raw.cardSuffix, raw.merchant.normalize('NFC'), raw.amountJpy, raw.paymentMethod, raw.salesType, raw.firstPaymentMonth]));
    const occurrence = (occurrences.get(fingerprint) || 0) + 1; occurrences.set(fingerprint, occurrence);
    return { line: i + 2, provider: 'aplus', purchaseDate: raw.transactionDate, processingDate: null, description: raw.merchant, cardholder: '', cardIdentifier: raw.cardSuffix, amount: raw.amountJpy, currency: 'JPY', foreignAmount: '', exchangeRate: '', kind, fingerprint, occurrence, key: `${fingerprint}:${occurrence}`, raw, purchaseAmount: raw.amountJpy, paymentAmount: null, statementMonth: '', statementDetails: '', sourceReviewReason: ordinary ? '' : '支払方法・売上種別を確認してください。', pendingPaymentMonth: '20' + raw.firstPaymentMonth.replace('/', '-') };
  });
  return { parserVersion: 'aplus-pending-1', encoding: 'utf-8', sha256: digest(bytes), rows, period, sourceStatus: 'pending', sourceFormat: 'json', sourceCapturedAt: source.capturedAt, reconciliation: { statementTotal: total, purchaseTotal: total, separateRefundTotal: 0, verified: true } };
}

// Deliberately retain exact merchant spelling and card membership. Amount changes
// become a review of this group, never a second automatically counted purchase.
export function pendingGroupKey(batch, row) {
  if (!row.purchaseDate || !row.cardIdentifier || !row.description || row.amount <= 0) return null;
  return digest(JSON.stringify([batch.provider || 'amex', row.purchaseDate, row.cardIdentifier, row.description.normalize('NFC')]));
}
export function samePendingPurchases(a, b) {
  if (!a.length || a.length !== b.length || [...a, ...b].some(r => r.kind !== 'expense')) return false;
  const signature = r => JSON.stringify([r.purchaseDate, r.processingDate || '', r.cardIdentifier, r.description.normalize('NFC'), r.amount, r.currency, r.foreignAmount || '', r.exchangeRate || '', r.provider === 'aplus' ? r.pendingPaymentMonth || r.statementMonth : '']);
  return JSON.stringify(a.map(signature).sort()) === JSON.stringify(b.map(signature).sort());
}

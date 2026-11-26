// Plan omf-order-mapping pieces 2-4: customer order files OMF recognises by their own layout (shared/finance-intake-filetypes.mjs).
// Invented orders only: every order number, name, link and amount below is made up for this test. Files are built the way the
// real exports are shaped (HTML text with an .xls name for the proxy lists, an in-memory xlsx for the order sheet) and read with the
// same SheetJS calls as server/services/financeIntakeService.ts (readWorkbook text branch, sheetRows, the intake typed reader).
// Before the module exists (or before a kind's table is in it) every file falls back to today's importer — first sheet, header
// row 1, guessed mapping — so the assertions on kind, row count and status fail on what OMF does today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FIELDS, guessMapping, mappedRows, planImport, applyPlan, text } from '../shared/finance-intake.mjs';

const XLSX = createRequire(import.meta.url)('xlsx');
let FT = null;
try { FT = await import('../shared/finance-intake-filetypes.mjs'); } catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

// ── reading, as the service does ────────────────────────────────────────────────────────────────────────────────────────────
const readText = html => XLSX.read(String(html).replace(/^﻿/, ''), { type: 'string', raw: true }); // readWorkbook, text branch
const readBinary = bytes => XLSX.read(bytes, { type: 'buffer', cellNF: true }); // readWorkbook, xlsx with { intake: true }
const isDateFormat = format => !!XLSX.SSF.is_date(format) && /[yd]/i.test(format.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));
// sheetRows(workbook, sheet, { intake: true }) → intakeRows: text cells unchanged, date cells yyyy-mm-dd, General integers as digits.
function sheetRowsOf(workbook, sheet) {
  const ws = workbook.Sheets[sheet], rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  const range = XLSX.utils.decode_range(ws?.['!ref'] || 'A1'), pad = n => String(n).padStart(2, '0');
  return rows.map((row, i) => (Array.isArray(row) ? row : []).map((value, j) => {
    const shown = text(value), cell = ws?.[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + j })];
    if (!cell || cell.t !== 'n' || typeof cell.v !== 'number') return shown;
    const format = typeof cell.z === 'string' ? cell.z : 'General';
    if (isDateFormat(format)) { const d = XLSX.SSF.parse_date_code(cell.v); return d.y + '-' + pad(d.m) + '-' + pad(d.d); }
    return Number.isInteger(cell.v) && format === 'General' ? String(cell.v) : shown;
  }));
}
// Row 1 of each sheet, the only rows recognition reads.
const firstRowsOf = workbook => workbook.SheetNames.map(name => {
  const ws = workbook.Sheets[name]; if (!ws?.['!ref']) return { name, header: [] };
  const r = XLSX.utils.decode_range(ws['!ref']);
  return { name, header: (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, range: { s: r.s, e: { r: r.s.r, c: r.e.c } } })[0] || []).map(text) };
});
let ids = 0;
const options = extra => ({ id: () => 'rec-' + (++ids), now: '2026-01-10T00:00:00.000Z', ...extra });
// What OMF does with a file: a recognised kind on its own sheet (planFor's kind branch), or today's importer.
function omfImport(records, workbook, { file = 'invented.xls', hash = file, service = 'INVENTED-SVC', table = null, off = false, textFile = true } = {}) {
  const recognised = FT ? FT.recogniseFile(firstRowsOf(workbook), { text: textFile }) : { kind: null, near: null };
  const proof = sheet => ({ hash, fileName: file, documentId: hash, sheet, firstRow: 2 });
  if (recognised.kind && !off) {
    const rows = sheetRowsOf(workbook, recognised.sheet), defaults = { service, account: '', currency: 'JPY' };
    const incoming = mappedRows(rows.slice(1), recognised.mapping, defaults, proof(recognised.sheet), recognised.extras).filter(r => r.provenance.raw.some(Boolean));
    const ws = workbook.Sheets[recognised.sheet], related = {};
    for (const [role, name] of Object.entries(recognised.related || {})) related[role] = { name, rows: sheetRowsOf(workbook, name) };
    const applied = FT.applyFileType(table || recognised, incoming, { merges: ws['!merges'] || [], start: XLSX.utils.decode_range(ws['!ref']).s, related });
    const plan = planImport(records, applied.rows, options({ reading: { mapping: recognised.mapping, defaults }, clearBlank: true }));
    return { recognised, applied, plan, records: applyPlan(records, plan) };
  }
  // Today's importer (also what 「列の割り当てを自分で変える」 = fileType 'off' does): the chosen sheet — the first one, or the kind's
  // sheet when the grid was opened on it — header row 1, the mapping shown (guessed, or the kind's own when the grid opened on it).
  const sheet = off ? recognised.sheet : workbook.SheetNames[0], rows = sheetRowsOf(workbook, sheet), defaults = { service, account: '', currency: 'JPY' };
  const mapping = off ? recognised.mapping : guessMapping(rows[0] || []), extras = off ? recognised.extras : [];
  const incoming = mappedRows(rows.slice(1), mapping, defaults, proof(sheet), extras).filter(r => r.provenance.raw.some(Boolean));
  const plan = planImport(records, incoming, options({ reading: { mapping, defaults } }));
  return { recognised, applied: null, plan, records: applyPlan(records, plan) };
}
const byOrder = (records, orderId) => records.find(r => r.values.orderId === orderId);
const html = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const td = (v, attrs = '') => `<td${attrs}>${html(String(v))}</td>`;

// ── piece 2: the proxy shop order list (ショップ注文リスト) ───────────────────────────────────────────────────────────────────
const SHOP_HEADERS = ['번호(NO)', '현재상태(現在ステタス)', '사이트(サイト)', '물품정보(商品情報)', '스토어(ストア)', '주문번호(注文番号)', '결제일(決済日)', '상품가(商品価)', '수량(数量)', '국내송료(国内送料)', '국내송금료(国内送金料)', '소비세(消費税)', '추가금(追加金)', '차감금(差し引き金)', '포인트(point)', '지불액(支払金)', '현지주문총액', '주문일(注文日)', '주문자(注文者)', '결제방식(決済方法)', '송료지불(送料支払)'];
const yen = n => n.toLocaleString('en-US');
// Invented orders: [status, price, qty, shipping, transfer fee, tax, added, deducted, points, card, shipping payer, local total override]
const SHOP_ORDERS = [
  ['주문완료', 1200, 1, 0, 0, 80, 0, 0, 0, 'CARD-A', '선불'],
  ['결제완료', 2500, 2, 500, 0, 0, 0, 0, 0, 'CARD-A', '선불'],
  ['현지도착', 800, 1, 0, 100, 0, 100, 50, 0, 'CARD-B', '선불'],
  ['국제배송', 3000, 1, 0, 0, 0, 0, 300, 300, 'CARD-B', '선불'], // paid with points: written in 차감금 and 포인트
  ['거래취소', 0, 1, 0, 0, 0, 0, 0, 0, 'CARD-A', '선불', 3300], // cancelled: price and paid amount 0, local total kept
  ['2차결제대기', 1000, 1, 600, 0, 0, 0, 0, 0, 'CARD-B', '착불'] // cash on delivery: paid amount includes the shipping, local total does not
];
function shopRows(orders = SHOP_ORDERS) {
  return orders.map(([status, price, qty, ship, fee, tax, add, ded, pts, card, payer, local], i) => {
    const paid = price * qty + ship + fee + tax + add - ded, localTotal = local ?? (payer === '착불' ? paid - ship : paid);
    return { no: i + 1, status, url: `https://shop-${i % 2 ? 'b' : 'a'}.example.invalid/items/${100 + i}`, item: `Invented item ${i + 1}`, store: `Invented store ${i % 3}`,
      orderId: `TST${String(9000001 + i)}`, paidAt: `2026-01-04 1${i}:15`, price, qty, ship, fee, tax, add, ded, pts, paid, localTotal, orderedAt: `2026-01-05 0${i}:37`, buyer: `buyer-${i % 2}`, card: `카드(${card})`, cardLabel: card, payer };
  });
}
const shopCells = o => [o.no, o.status, o.url, o.item, o.store, o.orderId, o.paidAt, yen(o.price), o.qty, yen(o.ship), yen(o.fee), yen(o.tax), yen(o.add), yen(o.ded), yen(o.pts), yen(o.paid), yen(o.localTotal), o.orderedAt, o.buyer, o.card, o.payer];
const sum = (rows, f) => rows.reduce((a, o) => a + f(o), 0);
// The file's own total row: its first cell spans columns 0-5, so each sum sits one column left of its header; amounts carry ` 엔`.
function shopTotals(rows) {
  return [sum(rows, o => o.price * o.qty), sum(rows, o => o.qty), sum(rows, o => o.ship), sum(rows, o => o.fee), sum(rows, o => o.tax), sum(rows, o => o.add), sum(rows, o => o.ded), sum(rows, o => o.pts), sum(rows, o => o.paid), sum(rows, o => o.localTotal)];
}
function shopFile({ rows = shopRows(), headers = SHOP_HEADERS, totals = shopTotals(rows), cards = null, day = '2026-01-05' } = {}) {
  const cardTotals = cards || [...new Set(rows.map(o => o.cardLabel))].map(label => [label, sum(rows.filter(o => o.cardLabel === label), o => o.localTotal)]);
  return `﻿<br>\n<table border='0' width='800'><tr><td colspan="20" align="center"><b>구매 주문 리스트 ( ${day} ~ ${day} )</b></td></tr></table>\n`
    + `<table width="800" border="1"><tr>${headers.map(h => td(h, ' nowrap')).join('')}</tr>\n`
    + rows.map(o => `<tr>${shopCells(o).map(v => td(v)).join('')}</tr>`).join('\n')
    + `\n<tr><td align='center' colspan=6>합계</td>${totals.map((v, i) => td(i === 1 ? String(v) : yen(v) + ' 엔')).join('')}<td colspan="4"></td></tr></table>\n`
    + `<br/><table border='0' width='800'><tr><td colspan="3"><b>결제 수단별 지불액(支払金) 합계</b></td></tr></table>\n`
    + `<table width="800" border="1">${[...cardTotals, ['합계', sum(cardTotals, c => c[1])]].map(([label, v]) => `<tr><td colspan="2">${html(label)}</td><td>${yen(v)} 엔</td></tr>`).join('')}</table>\n`;
}

test('piece 2: the shop order list is recognised on its second sheet and imported one record per order', () => {
  const file = shopFile(), wb = readText(file), result = omfImport([], wb);
  assert.equal(result.recognised.kind, 'proxy-shop-order-list', 'shop:recognised');
  assert.equal(result.recognised.sheet, 'Sheet2', 'shop:order-sheet'); assert.equal(result.recognised.headerRow, 1, 'shop:header-row');
  assert.equal(result.records.length, 6, 'shop:six-records-no-total-row');
  assert.equal(result.plan.new, 6, 'shop:six-new');
  assert.ok(result.records.every(r => /^TST\d+$/.test(r.values.orderId)), 'shop:no-record-for-the-total-row');
  const rows = shopRows();
  const states = Object.fromEntries(rows.map(o => [o.orderId, byOrder(result.records, o.orderId).values.purchaseState]));
  assert.deepEqual(Object.values(states), ['purchased', 'purchased', 'purchased', 'purchased', 'cancelled', 'purchased'], 'shop:statuses-per-table');
  for (const o of rows) {
    const r = byOrder(result.records, o.orderId), v = r.values, x = r.extra;
    assert.equal(v.orderDate, '2026-01-04', 'shop:order-date-is-the-payment-day ' + o.orderId); assert.equal(v.purchaseDate, '2026-01-05', 'shop:purchase-date-is-the-order-day ' + o.orderId);
    assert.equal(v.amount, String(o.localTotal), 'shop:amount-is-the-local-total ' + o.orderId);
    assert.equal(x['現地注文総額'], yen(o.localTotal), 'shop:local-total-kept-as-written'); assert.equal(x['支払金'], yen(o.paid), 'shop:paid-kept-as-written');
    assert.deepEqual([v.service, v.account, v.currency], ['INVENTED-SVC', '', 'JPY'], 'shop:fixed-values');
    assert.deepEqual([v.merchantUrl, v.description, v.merchant, v.itemPrice, v.shippingFee, v.otherFee, v.tax], [o.url, o.item, o.store, String(o.price), String(o.ship), String(o.fee), String(o.tax)], 'shop:values ' + o.orderId);
    assert.deepEqual(x, { '元のステータス': o.status, '数量': String(o.qty), '追加金': yen(o.add), '差し引き': yen(o.ded), 'ポイント': yen(o.pts), '支払金': yen(o.paid), '現地注文総額': yen(o.localTotal), '購入アカウント': o.buyer, '決済方法': o.card, '送料支払': o.payer, 'ファイルの種類': 'ショップ注文リスト' }, 'shop:extras-as-written ' + o.orderId);
    assert.equal(r.provenance[0].sheet, 'Sheet2'); assert.deepEqual(r.provenance[0].raw, shopCells(o).map(c => text(c)), 'shop:original-row-kept');
  }
  const cancelled = byOrder(result.records, rows[4].orderId);
  assert.deepEqual([cancelled.values.purchaseState, cancelled.values.amount, cancelled.extra['支払金'], cancelled.values.itemPrice], ['cancelled', '3300', '0', '0'], 'shop:cancelled-keeps-its-amounts');
  assert.equal(result.applied.summary.orders, 6, 'shop:summary-orders'); assert.equal(result.applied.summary.totalRows, 1, 'shop:summary-total-row'); assert.equal(result.applied.summary.otherRows, 0, 'shop:summary-other-rows');
});

test('piece 2: the ten totals and the card sheet are checked; one changed amount fails its check with both numbers and the import still runs', () => {
  const good = omfImport([], readText(shopFile()));
  assert.equal(good.applied.checks.length, 13, 'shop:ten-totals-and-three-card-lines');
  assert.ok(good.applied.checks.every(c => c.ok), 'shop:all-checks-pass ' + JSON.stringify(good.applied.checks.filter(c => !c.ok)));
  const local = good.applied.checks.find(c => c.key === 'total:16');
  assert.deepEqual([local.label, local.sum, local.total], ['현지주문총액', 14730, 14730], 'shop:local-total-check');
  const cards = good.applied.checks.filter(c => c.key.startsWith('card:'));
  assert.deepEqual(cards.map(c => [c.label, c.sum, c.total]), [['CARD-A', 10080, 10080], ['CARD-B', 4650, 4650], ['합계', 14730, 14730]], 'shop:card-sheet-lines');
  const rows = shopRows(), totals = shopTotals(rows); totals[2] += 100;
  const bad = omfImport([], readText(shopFile({ rows, totals })));
  const failed = bad.applied.checks.filter(c => !c.ok);
  assert.equal(failed.length, 1, 'shop:one-check-fails'); assert.deepEqual([failed[0].key, failed[0].label, failed[0].sum, failed[0].total], ['total:9', '국내송료(国内送料)', 1100, 1200], 'shop:failed-check-names-both-numbers');
  assert.equal(bad.plan.new, 6, 'shop:mismatch-import-still-runs');
});

test('piece 2: an unknown status word is reported, imported as 受付中, and kept as written', () => {
  const rows = shopRows(); rows[0].status = '검토중'; rows[1].status = '검토중';
  const result = omfImport([], readText(shopFile({ rows })));
  const r = byOrder(result.records, rows[0].orderId);
  assert.deepEqual([r.values.purchaseState, r.extra['元のステータス']], ['requested', '검토중'], 'shop:unknown-status-requested-word-kept');
  const note = result.applied.notes.find(n => n.kind === 'unknown-status');
  assert.deepEqual([note?.word, note?.count], ['검토중', 2], 'shop:unknown-status-reported');
});

test('piece 2: one renamed header is not recognised, the column is named, and today\'s importer runs', () => {
  const headers = [...SHOP_HEADERS]; headers[7] = '상품가격';
  const result = omfImport([], readText(shopFile({ headers })));
  assert.equal(result.recognised.kind, null, 'shop:renamed-not-recognised');
  assert.deepEqual([result.recognised.near?.kind, result.recognised.near?.column, result.recognised.near?.expected, result.recognised.near?.found], ['proxy-shop-order-list', 7, '상품가(商品価)', '상품가격'], 'shop:renamed-column-named');
  assert.equal(result.applied, null, 'shop:renamed-today-importer'); assert.equal(result.records.length, 0, 'shop:today-reads-the-title-sheet');
  // A file that is not text the reader turned into sheets (a real xlsx with the same cells) is not the shop list either.
  assert.equal(FT?.recogniseFile(firstRowsOf(readText(shopFile())), { text: false }).kind ?? null, null, 'shop:binary-not-recognised');
});

test('piece 2: the same file twice changes nothing; a later file with one status changed is one update listing 購入状況', () => {
  const first = omfImport([], readText(shopFile()), { hash: 'file-1' });
  const again = omfImport(first.records, readText(shopFile()), { hash: 'file-1' });
  assert.deepEqual([again.plan.new, again.plan.update, again.plan.unchanged], [0, 0, 6], 'shop:same-file-unchanged');
  const rows = shopRows(), later = [{ ...rows[0], status: '거래취소' }];
  const update = omfImport(first.records, readText(shopFile({ rows: later })), { hash: 'file-2', file: 'later.xls' });
  assert.deepEqual([update.plan.new, update.plan.update, update.plan.unchanged], [0, 1, 0], 'shop:later-file-one-update');
  const changes = update.plan.rows[0].changes;
  assert.deepEqual(changes.find(c => c.field === 'purchaseState'), { field: 'purchaseState', before: 'purchased', after: 'cancelled' }, 'shop:change-list-holds-status');
  assert.deepEqual(changes.map(c => c.field).sort(), ['extra:元のステータス', 'purchaseState'], 'shop:change-list-only-status');
  assert.equal(update.records.length, 6, 'shop:no-duplicate');
});

test('piece 2: a table that stops setting a value clears it on re-upload and clears nothing else', () => {
  const first = omfImport([], readText(shopFile()), { hash: 'file-1' });
  assert.equal(byOrder(first.records, 'TST9000001').extra['ファイルの種類'], 'ショップ注文リスト');
  // The next version of the table no longer sets ファイルの種類; the re-uploaded file also has one blank item cell (a blank cell is not a table change).
  const table = FT.fileTypeTable(first.recognised), changed = { ...table, derive: (row, info) => { const d = table.derive(row, info); return { ...d, set: { ...d.set, 'extra:ファイルの種類': '' } }; } };
  const rows = shopRows(); rows[1].item = '';
  const second = omfImport(first.records, readText(shopFile({ rows })), { hash: 'file-2', file: 'again.xls', table: changed });
  assert.ok(second.plan.rows.every(r => r.changes.length === 1 && r.changes[0].field === 'extra:ファイルの種類' && r.changes[0].after === ''), 'shop:table-change-clears-only-that-value ' + JSON.stringify(second.plan.rows.map(r => r.changes)));
  assert.ok(second.records.every(r => (r.extra['ファイルの種類'] || '') === ''), 'shop:value-cleared');
  assert.equal(byOrder(second.records, rows[1].orderId).values.description, 'Invented item 2', 'shop:blank-cell-keeps-the-stored-value');
});

test('piece 2: the kind\'s fixed values are refused when changed; fileType off imports the sheet as today (the total row becomes a record)', () => {
  const recognised = FT.recogniseFile(firstRowsOf(readText(shopFile())), { text: true });
  const ask = (request, latest = 'INVENTED-SVC') => FT.kindRequestRefusal(recognised, { mapping: recognised.mapping, extras: null, service: '', account: '', currency: '', template: false, ...request }, latest);
  assert.equal(ask({}), null, 'shop:same-request-accepted'); assert.equal(ask({ service: 'INVENTED-SVC', currency: 'JPY' }), null, 'shop:same-values-accepted');
  assert.equal(ask({ service: 'ANOTHER' })?.reason, 'service', 'shop:409-service');
  assert.equal(ask({ service: 'ANYTHING' }, null), null, 'shop:first-import-names-the-service');
  assert.equal(ask({ account: 'acct-1' })?.reason, 'account', 'shop:409-account');
  assert.equal(ask({ currency: 'USD' })?.reason, 'currency', 'shop:409-currency');
  assert.equal(ask({ mapping: { ...recognised.mapping, amount: '15' } })?.reason, 'mapping', 'shop:409-mapping');
  assert.equal(ask({ extras: [{ name: '数量', column: '8' }] })?.reason, 'mapping', 'shop:409-extras');
  assert.equal(ask({ template: true })?.reason, 'template', 'shop:409-template');
  const off = omfImport([], readText(shopFile()), { off: true });
  assert.equal(off.records.length, 7, 'shop:off-total-row-becomes-a-record');
  assert.ok(off.records.some(r => r.provenance[0].raw[0] === '합계'), 'shop:off-total-row-record');
  assert.ok(off.records.every(r => r.values.purchaseState === 'requested'), 'shop:off-statuses-as-today');
});

test('piece 2: recognition reads row 1 only, and a plain CSV or an unrelated workbook is not a kind', () => {
  const csv = readText('注文番号,商品名,購入金額\nX-1,Thing,100\n');
  assert.deepEqual(FT.recogniseFile(firstRowsOf(csv), { text: true }), { kind: null, near: null }, 'kinds:csv-not-a-kind');
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'Data');
  assert.deepEqual(FT.recogniseFile(firstRowsOf(wb), { text: false }), { kind: null, near: null }, 'kinds:unrelated-not-a-kind');
  const recognised = FT.recogniseFile(firstRowsOf(readText(shopFile())), { text: true });
  assert.deepEqual(Object.keys(recognised.mapping), FIELDS.map(f => f[0]), 'kinds:mapping-has-every-field');
  assert.equal(recognised.name, 'ショップ注文リスト', 'kinds:name');
});

// ── piece 3: the proxy auction remittance list (オークション送金リスト) ──────────────────────────────────────────────────────────
const AUCTION_HEADERS = ['サイト', 'オークションID', '商品ページ', 'Seller ID', 'Bid ID', '現在ステタス', '決済日', 'STORE', '送金日', '送金 ID', '落札価', '数量', '消費税', '送金量', '配送料', '追加', '差し引き', '送金額', '送金額', '送金銀行', '送料支払い'];
// Invented auctions. A full row sends one payment (送金額 twice: without and with the transfer fee and cash-on-delivery shipping); a row
// paid under another has 「-」 as 送金日 and 送金 ID, a claim text over columns 13-16, and lies inside the paying row's merged 送金額 cells.
const AUCTIONS = [
  { id: 'x1000000001', status: '결제완료', store: 'STORE', sentAt: '2026-01-05 09:00', sendId: 'pay-a', price: 1000, qty: 1, tax: 100, fee: 0, ship: 500, payer: '선불', extraYen: 2 }, // pays for the two below, 2 yen above its lines
  { id: 'x1000000002', status: '현지도착', under: true, price: 2000, qty: 1, tax: 200, claim: 'x1000000002(YAHOO) 청구' }, // names itself, not the paying auction
  { id: 'x1000000003', status: '현지도착', under: true, price: 300, qty: 1, tax: 0, claim: 'x1000000001(YAHOO) 청구' },
  { id: 'x1000000004', status: '국제배송', sentAt: '2026-01-05 10:00', sendId: 'pay-c', price: 1500, qty: 1, tax: 150, fee: 0, ship: 700, payer: '착불' }, // cash on delivery
  { id: 'x1000000005', status: '2차결제완료', store: 'STORE', sentAt: '2026-01-05 11:00', sendId: 'pay-d', price: 400, qty: 2, tax: 80, fee: 110, ship: 0, payer: '선불' }, // transfer fee, 数量 2
  { id: 'x1000000006', status: '거래취소', sentAt: '2026-01-05 12:00', sendId: 'pay-e', price: 0, qty: 1, tax: 0, fee: 0, ship: 0, payer: '선불' }, // cancelled, pays for the one below
  { id: 'x1000000007', status: '결제완료', under: true, price: 0, qty: 1, tax: 0, claim: 'x1000000006(YAHOO) 청구', spill: ['0', '0', 'BANK-Y', '선불'] }, // its own four cells spill to columns 21-24
  { id: '1000000008', status: '처분', sentAt: '2026-01-05 13:00', sendId: 'pay-g', price: 600, qty: 1, tax: 60, fee: 0, ship: 0, payer: '선불' } // all-digit auction ID
];
function auctionRows(list = AUCTIONS) {
  const rows = list.map((a, i) => ({ ...a, paidAt: `2026-01-03 0${i}:30`, url: `https://auctions.example.invalid/item/${a.id}`, seller: `seller-${i}`, bidder: 'bidder-1', add: 0, ded: 0 }));
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].under) continue;
    let j = i + 1; while (j < rows.length && rows[j].under) j++;
    const group = rows.slice(i, j), lines = sum(group, a => a.price * a.qty + a.tax) + rows[i].ship + rows[i].add - rows[i].ded, cod = rows[i].payer === '착불' ? rows[i].ship : 0;
    Object.assign(rows[i], { covers: j - i - 1, lines1: lines - cod, lines2: lines + rows[i].fee, amount1: lines - cod + (rows[i].extraYen || 0), amount2: lines + rows[i].fee + (rows[i].extraYen || 0) });
  }
  return rows;
}
const auctionCells = a => a.under
  ? ['YAHOO', a.id, a.url, a.seller, a.bidder, a.status, a.paidAt, a.store || '', '-', '-', yen(a.price), a.qty, yen(a.tax)]
  : ['YAHOO', a.id, a.url, a.seller, a.bidder, a.status, a.paidAt, a.store || '', a.sentAt, a.sendId, yen(a.price), a.qty, yen(a.tax), yen(a.fee), yen(a.ship), yen(a.add), yen(a.ded)];
function auctionFile({ rows = auctionRows(), spill = true, headers = AUCTION_HEADERS } = {}) {
  const full = rows.filter(a => !a.under);
  // The file's total row: its first cell spans columns 0-6, so each sum sits three columns left of its header; the two 送金額 sums are
  // the sums of the lines (a payment above its lines is not in them).
  const totals = [sum(rows, a => a.price * a.qty), sum(rows, a => a.qty), sum(rows, a => a.tax), sum(full, a => a.fee), sum(full, a => a.ship), sum(full, a => a.add), sum(full, a => a.ded), sum(full, a => a.lines1)];
  const body = rows.map(a => {
    if (a.under) return `<tr>${auctionCells(a).map(v => td(v)).join('')}${td(a.claim, ' colspan="4"')}${spill && a.spill ? a.spill.map(v => td(v)).join('') : ''}</tr>`;
    const span = a.covers ? ` rowspan="${a.covers + 1}"` : '';
    return `<tr>${auctionCells(a).map(v => td(v)).join('')}${[yen(a.amount1), yen(a.amount2), a.bank || 'BANK-X', a.payer].map(v => td(v, span)).join('')}</tr>`;
  }).join('\n');
  const summaryTable = cells => `<table>${cells.map(r => `<tr>${r.map(v => td(v)).join('')}</tr>`).join('')}</table>`;
  return `<table><tr><td colspan="20"><b>경매 송금 리스트 ( 2026-01-05 ~ 2026-01-05 )</b></td></tr></table>\n`
    + `<table border="1"><tr>${headers.map(h => td(h)).join('')}</tr>\n${body}\n`
    + `<tr><td colspan=7>합계</td>${totals.map((v, i) => td(i === 1 ? String(v) : yen(v) + ' 엔')).join('')}${td(yen(sum(full, a => a.lines2)) + ' 엔', ' colspan=3')}<td colspan=3></td></tr></table>\n`
    + summaryTable([['BANK', 'TOTAL'], ['BANK-X', '1'], ['합계', '1']]) + summaryTable([['구분', 'BANK-X', '합계'], ['송금금액', '1 엔', '1 엔']]) + summaryTable([['BANK-X'], ['0 엔']]);
}

test('piece 3: the auction remittance list is recognised at 21 and at 25 columns, one record per auction, the all-digit ID as written', () => {
  for (const spill of [false, true]) {
    const wb = readText(auctionFile({ spill })), result = omfImport([], wb, { file: 'auction.xls', hash: 'auction-' + spill });
    assert.equal(result.recognised.kind, 'proxy-auction-remittance-list', 'auction:recognised spill=' + spill);
    assert.equal(sheetRowsOf(wb, 'Sheet2')[0].length, spill ? 25 : 21, 'SETUP: auction:sheet-width');
    assert.equal(result.records.length, 8, 'auction:one-record-per-auction'); assert.equal(result.applied.summary.totalRows, 1, 'auction:total-row-left-out');
    assert.ok(byOrder(result.records, '1000000008'), 'auction:all-digit-id-as-written');
  }
  const headers = [...AUCTION_HEADERS]; headers[18] = '送金額2';
  const near = FT.recogniseFile(firstRowsOf(readText(auctionFile({ headers }))), { text: true });
  assert.deepEqual([near.kind, near.near?.kind, near.near?.column], [null, 'proxy-auction-remittance-list', 18], 'auction:renamed-header-named');
});

test('piece 3: rows paid under another auction take the paying row\'s date, name it from the merged cell, and carry no amount', () => {
  const result = omfImport([], readText(auctionFile()), { file: 'auction.xls' }), rec = id => byOrder(result.records, id);
  const a = rec('x1000000001'), b1 = rec('x1000000002'), b2 = rec('x1000000003'), e = rec('x1000000006'), f = rec('x1000000007');
  for (const r of [b1, b2]) {
    assert.deepEqual([r.values.purchaseDate, r.extra['まとめ払い先'], r.values.amount, r.values.shippingFee, r.values.otherFee, r.extra['購入アカウント'] ?? ''], ['2026-01-05', 'x1000000001', '', '', '', ''], 'auction:paid-under ' + r.values.orderId);
    assert.equal(r.values.orderDate, '2026-01-03', 'auction:paid-under-own-payment-day');
  }
  assert.deepEqual([b1.values.itemPrice, b1.values.tax, b1.extra['数量'], b1.values.purchaseState], ['2000', '200', '1', 'purchased'], 'auction:paid-under-own-price-and-tax');
  assert.equal(b1.extra['元の請求先表記'], 'x1000000002(YAHOO) 청구', 'auction:wrong-claim-text-kept'); assert.equal(b2.extra['元の請求先表記'], undefined, 'auction:right-claim-text-not-kept');
  assert.deepEqual([a.extra['まとめ払い件数'], e.extra['まとめ払い件数'], rec('x1000000004').extra['まとめ払い件数']], ['3', '2', undefined], 'auction:paying-order-counts-its-auctions');
  assert.deepEqual([f.extra['まとめ払い先'], f.values.purchaseDate, f.values.purchaseState, e.values.purchaseState], ['x1000000006', '2026-01-05', 'purchased', 'cancelled'], 'auction:paid-under-the-cancelled-row');
  assert.deepEqual(f.provenance[0].raw.slice(21), ['0', '0', 'BANK-Y', '선불'], 'auction:spilled-cells-kept-in-the-original-row');
  const kinds = result.applied.notes.map(n => n.kind);
  assert.ok(kinds.includes('claim-text-differs') && kinds.includes('spilled-cells') && kinds.includes('cancelled-paying-row'), 'auction:each-anomaly-reported ' + JSON.stringify(kinds));
  assert.deepEqual(result.applied.notes.find(n => n.kind === 'claim-text-differs').rows, [{ row: 3, auctionId: 'x1000000002', named: 'x1000000002', paying: 'x1000000001' }], 'auction:wrong-text-row');
  assert.deepEqual([result.applied.summary.paidUnder, result.applied.summary.payments], [3, 2], 'auction:summary-paid-under');
  // The amounts of all orders add up to the money sent.
  assert.equal(sum(result.records, r => Number(r.values.amount || 0)), sum(auctionRows().filter(x => !x.under), x => x.amount2), 'auction:amounts-add-up-to-the-money-sent');
});

test('piece 3: 購入金額 is the second 送金額 by position, both kept; seven part totals match; a payment 2 yen above its lines is listed and nothing fails', () => {
  const result = omfImport([], readText(auctionFile()), { file: 'auction.xls' }), rec = id => byOrder(result.records, id);
  assert.deepEqual([rec('x1000000004').values.amount, rec('x1000000004').extra['総送金額'], rec('x1000000004').extra['全体合計']], ['2350', '1,650', '2,350'], 'auction:cash-on-delivery-two-amounts');
  assert.deepEqual([rec('x1000000005').values.amount, rec('x1000000005').extra['総送金額'], rec('x1000000005').values.otherFee, rec('x1000000005').extra['数量']], ['990', '880', '110', '2'], 'auction:transfer-fee-two-amounts');
  assert.deepEqual([rec('x1000000001').extra['出品者区分'], rec('x1000000004').extra['出品者区分'] ?? '', rec('x1000000001').extra['送料支払'], rec('x1000000001').extra['購入アカウント'], rec('x1000000001').extra['入札アカウント']], ['STORE', '', '선불', 'pay-a', 'bidder-1'], 'auction:extras-as-written');
  const parts = result.applied.checks.filter(c => !c.info);
  assert.equal(parts.length, 7, 'auction:seven-part-totals'); assert.ok(parts.every(c => c.ok), 'auction:part-totals-match ' + JSON.stringify(parts.filter(c => !c.ok)));
  const info = result.applied.checks.filter(c => c.info);
  assert.deepEqual(info.map(c => [c.key, c.sum, c.total]), [['total:17', 7292, 7290], ['total:18', 8102, 8100]], 'auction:sent-amounts-shown-as-information');
  assert.deepEqual(result.applied.notes.find(n => n.kind === 'payment-above-lines')?.payments, [{ row: 2, auctionId: 'x1000000001', amount: 4102, lines: 4100, difference: 2 }], 'auction:payment-above-lines-listed');
  const again = omfImport(result.records, readText(auctionFile()), { file: 'auction.xls' });
  assert.deepEqual([again.plan.new, again.plan.update, again.plan.unchanged], [0, 0, 8], 'auction:same-file-unchanged');
});

test('piece 3: a table that stops dating a row paid under another clears that 購入日 on re-upload and nothing else (question C5)', () => {
  const first = omfImport([], readText(auctionFile()), { file: 'auction.xls', hash: 'a-1' });
  const table = FT.fileTypeTable(first.recognised), changed = { ...table, derive: (row, info) => { const d = table.derive(row, info); return info.paying ? { ...d, set: { ...d.set, purchaseDate: '' } } : d; } };
  const second = omfImport(first.records, readText(auctionFile()), { file: 'auction.xls', hash: 'a-1', table: changed });
  assert.deepEqual([second.plan.update, second.plan.unchanged], [3, 5], 'auction:c5-three-updates');
  assert.ok(second.plan.rows.filter(r => r.operation === 'update').every(r => JSON.stringify(r.changes.map(c => [c.field, c.after])) === JSON.stringify([['purchaseDate', '']])), 'auction:c5-only-the-date-cleared');
});

// ── piece 4: the order sheet (注文シート) ────────────────────────────────────────────────────────────────────────────────────────
const SHEET_LONG = ['伝票番号', '一次決済日', '送金日', '商品金額', '商品url', '国内送料', 'サービス手数料', 'フリマ手数料', '取引手数料', '処理担当者'];
const SHEET_SHORT = ['伝票番号', '一次決済日', '送金日', '商品金額', '商品url', '国内送料', '処理担当者'];
const excelDay = day => { const [y, m, d] = day.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
// Invented orders: several links in one cell separated by a line break, as the real sheet writes them.
const ORDER_SHEET = [
  { id: 'D-0001-01', paid: '2026-01-04', sent: '2026-01-05', price: 3000, ship: 500, fees: [100, 0, 30], staff: 'staff-a', links: ['https://shop-a.example.invalid/i/1', 'https://shop-a.example.invalid/i/2', 'https://shop-a.example.invalid/i/3'] },
  { id: 'D-0002-01', paid: '2026-01-04', sent: '', price: 1200, ship: 0, fees: [50, 0, 0], staff: 'auto', links: ['https://shop-b.example.invalid/i/9'] }, // not yet sent
  { id: 'D-0003-01', paid: '2026-01-04', sent: '2026-01-05', price: 800, ship: 300, fees: [40, 0, 0], staff: 'staff-b', links: ['https://shop-b.example.invalid/x', 'https://shop-b.example.invalid/x'] }, // one link written twice
  { id: 'D-0004-01', paid: '2026-01-04', sent: '2026-01-06', price: 2200, ship: 0, fees: [0, 0, 0], staff: 'staff-a', links: ['https://shop-c.example.invalid/1', 'https://other.example.invalid/2'] } // two websites
];
// An in-memory xlsx with the 7-column sheet first (as the real file has it) and the 10-column sheet second; dates are date cells.
function orderSheetFile({ orders = ORDER_SHEET, long = true, short = true, shortPrice = {} } = {}) {
  const wb = XLSX.utils.book_new(), sheet = (headers, row) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...orders.map(row)]);
    orders.forEach((o, i) => { for (const [c, day] of [[1, o.paid], [2, o.sent]]) { const at = XLSX.utils.encode_cell({ r: i + 1, c }); if (day) ws[at] = { t: 'n', v: excelDay(day), z: 'yyyy/m/d' }; else delete ws[at]; } });
    return ws;
  };
  if (short) XLSX.utils.book_append_sheet(wb, sheet(SHEET_SHORT, o => [o.id, '', '', shortPrice[o.id] ?? o.price, o.links.join('\n'), o.ship, o.staff]), 'SheetA');
  if (long) XLSX.utils.book_append_sheet(wb, sheet(SHEET_LONG, o => [o.id, '', '', o.price, o.links.join('\n'), o.ship, ...o.fees, o.staff]), 'SheetB');
  return readBinary(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
const sheetImport = (records, wb, extra = {}) => omfImport(records, wb, { file: 'order-sheet.xlsx', hash: 'sheet-1', textFile: false, service: 'INVENTED-SHEET-SVC', ...extra });

test('piece 4: the order sheet is recognised by its 10 headers, or its 7 when only that sheet exists; the 10-column sheet is read when both exist', () => {
  const both = orderSheetFile(), result = sheetImport([], both);
  assert.equal(result.recognised.kind, 'proxy-order-sheet', 'sheet:recognised');
  assert.deepEqual([both.SheetNames[0], result.recognised.sheet, result.recognised.related.other], ['SheetA', 'SheetB', 'SheetA'], 'sheet:the-ten-column-sheet-not-the-first');
  assert.deepEqual(result.recognised.extras.map(x => x.name), ['サービス手数料', 'フリマ手数料', '取引手数料', '処理担当者'], 'sheet:ten-column-extras');
  assert.equal(result.records.length, 4, 'sheet:one-record-per-order');
  const short = sheetImport([], orderSheetFile({ long: false }));
  assert.deepEqual([short.recognised.kind, short.recognised.sheet, short.recognised.extras.map(x => x.name), short.records.length], ['proxy-order-sheet', 'SheetA', ['処理担当者'], 4], 'sheet:seven-column-only');
  const headers = (() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SHEET_LONG.slice(0, 9), '担当']]), 'X'); return wb; })();
  assert.equal(FT.recogniseFile(firstRowsOf(headers), { text: false }).kind, null, 'sheet:other-headers-not-a-kind');
});

test('piece 4: first link in the URL field, every link with one space, the count, the sum as 購入金額, dates from date cells', () => {
  const result = sheetImport([], orderSheetFile()), rec = id => byOrder(result.records, id);
  const one = rec('D-0001-01');
  assert.deepEqual([one.values.merchantUrl, one.extra['商品URL（全件）'], one.extra['リンク数']], [ORDER_SHEET[0].links[0], ORDER_SHEET[0].links.join(' '), '3'], 'sheet:links');
  assert.ok(!/[\r\n]/.test(one.extra['商品URL（全件）']), 'sheet:no-line-break');
  assert.ok(one.provenance[0].raw[4].includes('\n'), 'sheet:original-cell-kept-as-written');
  assert.deepEqual([one.values.amount, one.values.itemPrice, one.values.shippingFee, one.values.orderDate, one.values.purchaseDate, one.values.purchaseState], ['3500', '3000', '500', '2026-01-04', '2026-01-05', 'purchased'], 'sheet:values');
  assert.deepEqual([one.extra['サービス手数料'], one.extra['フリマ手数料'], one.extra['取引手数料'], one.extra['処理担当者'], one.extra['ファイルの種類']], ['100', '0', '30', 'staff-a', '注文シート'], 'sheet:extras');
  assert.deepEqual([one.values.description, one.values.merchant, one.values.service, one.values.account, one.values.currency], ['', '', 'INVENTED-SHEET-SVC', '', 'JPY'], 'sheet:no-item-or-shop-column');
  assert.deepEqual([rec('D-0003-01').extra['商品URL（全件）'], rec('D-0003-01').extra['リンク数']], ['https://shop-b.example.invalid/x https://shop-b.example.invalid/x', '2'], 'sheet:a-link-written-twice-stays-twice');
  const two = rec('D-0002-01');
  assert.deepEqual([two.values.purchaseDate, two.values.purchaseState, two.values.amount], ['', 'requested', '1200'], 'sheet:not-sent-yet');
  assert.ok(result.applied.checks.length && result.applied.checks.every(c => c.ok), 'sheet:both-sheets-agree ' + JSON.stringify(result.applied.checks));
  const again = sheetImport(result.records, orderSheetFile());
  assert.deepEqual([again.plan.new, again.plan.update, again.plan.unchanged], [0, 0, 4], 'sheet:same-file-unchanged');
});

test('piece 4: the same order in a later file with 送金日 becomes 購入済み (one update)', () => {
  const first = sheetImport([], orderSheetFile());
  const later = sheetImport(first.records, orderSheetFile({ orders: [{ ...ORDER_SHEET[1], sent: '2026-01-07' }] }), { hash: 'sheet-2', file: 'later.xlsx' });
  assert.deepEqual([later.plan.new, later.plan.update, later.plan.unchanged], [0, 1, 0], 'sheet:later-one-update');
  assert.deepEqual(later.plan.rows[0].changes.map(c => [c.field, c.before, c.after]).sort(), [['purchaseDate', '', '2026-01-07'], ['purchaseState', 'requested', 'purchased']], 'sheet:later-status-and-date');
});

test('piece 4: the two sheets disagreeing on one amount and an order on two websites are reported; the import still runs', () => {
  const result = sheetImport([], orderSheetFile({ shortPrice: { 'D-0001-01': 2900 } }));
  const failed = result.applied.checks.filter(c => !c.ok);
  assert.deepEqual(failed.map(c => [c.key, c.sum, c.total]), [['other-sheet:3', 7200, 7100]], 'sheet:disagreement-check');
  assert.deepEqual(result.applied.notes.find(n => n.kind === 'other-sheet-differs')?.rows, [{ row: 2, orderId: 'D-0001-01', column: '商品金額', value: '3000', other: '2900' }], 'sheet:disagreement-reported');
  assert.deepEqual(result.applied.notes.find(n => n.kind === 'links-on-two-websites')?.rows, [{ row: 5, orderId: 'D-0004-01', hosts: ['shop-c.example.invalid', 'other.example.invalid'] }], 'sheet:two-websites-reported');
  assert.equal(byOrder(result.records, 'D-0004-01').values.merchantUrl, 'https://shop-c.example.invalid/1', 'sheet:two-websites-first-link');
  assert.equal(result.records.length, 4, 'sheet:reported-and-imported');
  assert.deepEqual([result.applied.summary.links, result.applied.summary.multiLink], [8, 3], 'sheet:summary-links');
});

test('piece 4: a table that stops setting 購入金額 clears it on re-upload and nothing else (question C11)', () => {
  const first = sheetImport([], orderSheetFile());
  const table = FT.fileTypeTable(first.recognised), changed = { ...table, derive: (row, info) => { const d = table.derive(row, info); return { ...d, set: { ...d.set, amount: '' } }; } };
  const second = sheetImport(first.records, orderSheetFile(), { table: changed });
  assert.equal(second.plan.update, 4, 'sheet:c11-four-updates');
  assert.ok(second.plan.rows.every(r => JSON.stringify(r.changes.map(c => [c.field, c.after])) === JSON.stringify([['amount', '']])), 'sheet:c11-only-the-amount-cleared');
});

// Customer order files OMF knows by their own layout (plan omf-order-mapping §3 pieces 2-4, §5). Pure, like finance-intake.mjs:
// no database, no workbook library. One table per kind says where the file's orders are, which header row 1 must carry, which
// column goes to which intake field or extra, and what the kind computes; the service reads the workbook and hands over plain rows.
//
//   recogniseFile(sheets, { text })            row 1 of each sheet → the kind, its sheet, header row, mapping and extra columns,
//                                              or why the file is not a kind (the first header that differs, by column).
//   applyFileType(fileType, incoming, context) the rows mappedRows made from the kind's sheet → order rows, notes and checks.
//   kindRequestRefusal(fileType, request, s)   why an import request cannot run as this kind (the service answers 409).
//
// applyFileType drops rows that are not orders, sets 購入状況 from the status table (read from the row's original cell: mappedRows
// has already turned an unknown word into 受付中), and sets or blanks the values and extras the kind computes. Every value it sets
// is added to the row's present list (an update ignores a value that is not listed); every value it blanks is taken off the list,
// so a stored value stays. The import runs with clearBlank, so only a value the kind itself lists as present and blank is cleared
// (a table change that stops setting a value). It never touches service, account, 注文・取引ID or 商品・明細ID, and the original
// cells stay in provenance.raw exactly as read. Extras keep the customer's words as the file writes them; only 購入状況 is translated.
import { FIELDS, DEFAULT_SERVICE, DEFAULT_CURRENCY, normalize, text } from './finance-intake.mjs';

export const FILE_TYPE_EXTRA = 'ファイルの種類';
const FT = 'extra:' + FILE_TYPE_EXTRA;
const IDENTITY = ['service', 'account', 'orderId', 'itemId'];
const norm = v => text(v).normalize('NFKC').trim();
// A money cell of a file: ` 엔`, ¥ and commas dropped. Blank is 0; anything else that is not a number is NaN (its check fails).
export const amountOf = v => { const s = text(v).replace(/엔|円|[¥￥,，\s]/g, ''); if (s === '') return 0; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const isDay = v => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text(v));

// Plan §5.4: the status words of both proxy lists. Any other word → 受付中, and the import names the word and how many rows carry it.
export const STATUS_TABLE = Object.freeze({
  '주문완료': 'purchased', '결제완료': 'purchased', '현지도착': 'purchased', '2차결제대기': 'purchased', '2차결제완료': 'purchased',
  '국제배송': 'purchased', '거래취소': 'cancelled', '처분': 'purchased'
});
export function statusOf(word, table = STATUS_TABLE) { const w = norm(word); return Object.hasOwn(table, w) ? { state: table[w], known: true } : { state: 'requested', known: false }; }
const fullMapping = partial => Object.fromEntries(FIELDS.map(([k]) => [k, partial[k] === undefined ? '' : String(partial[k])]));
const extraColumns = list => list.map(([name, column]) => ({ name, column: String(column) }));

// ── 5.1 the proxy shop order list (ショップ注文リスト) ──────────────────────────────────────────────────────────────────────────
const SHOP_HEADERS = ['번호(NO)', '현재상태(現在ステタス)', '사이트(サイト)', '물품정보(商品情報)', '스토어(ストア)', '주문번호(注文番号)', '결제일(決済日)', '상품가(商品価)', '수량(数量)', '국내송료(国内送料)', '국내송금료(国内送金料)', '소비세(消費税)', '추가금(追加金)', '차감금(差し引き金)', '포인트(point)', '지불액(支払金)', '현지주문총액', '주문일(注文日)', '주문자(注文者)', '결제방식(決済方法)', '송료지불(送料支払)'];
const SHOP = {
  id: 'proxy-shop-order-list', kind: 'proxy-shop-order-list', name: 'ショップ注文リスト', title: '구매 주문 리스트', textOnly: true, sheetIndex: 1, headers: SHOP_HEADERS, related: { cards: 3 }, totalRow: true,
  // The file's 「注文日」 (column 17) is OMF's 購入日 and its 「決済日」 (column 6) is OMF's 注文日. 購入金額 copies 현지주문총액 until answer A2.
  mapping: fullMapping({ purchaseState: 1, merchantUrl: 2, description: 3, merchant: 4, orderId: 5, orderDate: 6, itemPrice: 7, shippingFee: 9, otherFee: 10, tax: 11, amount: 16, purchaseDate: 17 }),
  extras: extraColumns([['元のステータス', 1], ['数量', 8], ['追加金', 12], ['差し引き', 13], ['ポイント', 14], ['支払金', 15], ['現地注文総額', 16], ['購入アカウント', 18], ['決済方法', 19], ['送料支払', 20]]),
  statusColumn: 1,
  rowKind: raw => norm(raw[0]) === '합계' ? 'total' : /^\d+$/.test(norm(raw[0])) && text(raw[5]) !== '' ? 'order' : 'other',
  derive(row, info) { return { set: { [FT]: this.name, purchaseState: info.state }, blank: [] }; },
  // Ten sums of the order rows against the total row, whose first cell spans columns 0-5 (each sum one column left of its header);
  // 현지주문총액 per card against the card sheet (a line's label is the card named in 결제방식, `카드(LABEL)` or `LABEL`) and in all.
  checks(orders, totals, context) {
    const out = [], total = totals[0]?.provenance.raw || null, raws = orders.map(r => r.provenance.raw);
    const sums = [[7, r => amountOf(r[7]) * amountOf(r[8]), this.headers[7] + ' × ' + this.headers[8]], ...[8, 9, 10, 11, 12, 13, 14, 15, 16].map(c => [c, r => amountOf(r[c]), this.headers[c]])];
    for (const [column, f, label] of sums) out.push(check('total:' + column, label, raws.reduce((a, r) => a + f(r), 0), total ? amountOf(total[column - 1]) : null));
    const cards = context.related?.cards?.rows;
    if (cards) {
      const local = r => amountOf(r[16]), method = r => norm(r[19]);
      for (const line of cards) {
        const cells = line.map(text).filter(Boolean); if (cells.length < 2) continue;
        const label = norm(cells[0]), value = amountOf(cells.at(-1));
        const sum = label === '합계' ? raws.reduce((a, r) => a + local(r), 0) : raws.filter(r => method(r) === label || method(r).endsWith('(' + label + ')')).reduce((a, r) => a + local(r), 0);
        out.push(check('card:' + label, cells[0], sum, value));
      }
    }
    return out;
  },
  noteRows(context) { return context.related?.cards ? [] : [{ kind: 'card-sheet-missing' }]; }
};
const check = (key, label, sum, total, info = false) => ({ key, label, sum, total, ok: total !== null && Number.isFinite(sum) && Number.isFinite(total) && sum === total, ...(info ? { info: true } : {}) });

const TABLES = [SHOP];
const TABLE_BY_ID = Object.fromEntries(TABLES.map(t => [t.id, t]));
export const FILE_KINDS = Object.freeze(Object.fromEntries(TABLES.map(t => [t.kind, t.name])));
// The table behind a recognition result (or a table id); a table object is returned as it is (a test may hand over a changed table).
export function fileTypeTable(fileType) { return typeof fileType === 'string' ? TABLE_BY_ID[fileType] : fileType?.headers ? fileType : TABLE_BY_ID[fileType?.table]; }

// Row 1 against a table: the first column whose header differs (NFKC, trimmed), or null when every header matches. A table with
// `trailingBlank` accepts more header cells when each of them is blank; otherwise row 1 must have exactly the table's headers.
function headerDiff(table, header) {
  for (let i = 0; i < Math.max(header.length, table.headers.length); i++) {
    const expected = table.headers[i], found = header[i];
    if (expected === undefined) { if (table.trailingBlank && norm(found) === '') continue; return { column: i, expected: '', found: text(found) }; }
    if (norm(found) !== norm(expected)) return { column: i, expected, found: text(found ?? '') };
  }
  return null;
}
const recognised = (table, sheets, sheet) => ({
  kind: table.kind, table: table.id, name: table.name, sheet, headerRow: 1, mapping: { ...table.mapping }, extras: table.extras.map(x => ({ ...x })),
  related: Object.fromEntries(Object.entries(table.related || {}).map(([role, at]) => [role, typeof at === 'number' ? sheets[at]?.name : at]).filter(([, name]) => name))
});
// sheets: [{ name, header }] in workbook order, header = row 1 as text cells. options.text: the file is text the reader turned
// into sheets (the proxy lists are HTML saved with an .xls name). Only row 1 of each sheet is read, so a file that uploads today
// still uploads.
export function recogniseFile(sheets, options = {}) {
  const first = norm(sheets?.[0]?.header?.[0]);
  for (const table of TABLES.filter(t => t.title)) {
    if (!first.startsWith(norm(table.title))) continue;
    const near = more => ({ kind: null, near: { kind: table.kind, name: table.name, ...more } });
    if (table.textOnly && options.text !== true) return near({ reason: 'not-text' });
    const sheet = sheets[table.sheetIndex];
    if (!sheet) return near({ reason: 'no-order-sheet' });
    const diff = headerDiff(table, sheet.header || []);
    if (diff) return near({ reason: 'header', sheet: sheet.name, ...diff });
    return recognised(table, sheets, sheet.name);
  }
  for (const table of TABLES.filter(t => !t.title)) {
    const sheet = sheets.find(s => !headerDiff(table, s.header || []));
    if (sheet) return recognised(table, sheets, sheet.name);
  }
  return { kind: null, near: null };
}

function withChanges(row, { set = {}, blank = [] }) {
  const values = { ...row.values }, extra = { ...(row.extra || {}) }; let present = [...(row.present || [])];
  for (const key of [...blank, ...Object.keys(set)]) if (IDENTITY.includes(key)) throw Error('a file kind never sets ' + key);
  for (const key of blank) { if (key.startsWith('extra:')) extra[key.slice(6)] = ''; else values[key] = ''; present = present.filter(k => k !== key); }
  for (const [key, value] of Object.entries(set)) { const v = text(value); if (key.startsWith('extra:')) extra[key.slice(6)] = v; else values[key] = v; if (!present.includes(key)) present.push(key); }
  return { ...row, values: normalize(values), extra, present };
}
// incoming: mappedRows(kind's sheet rows below row 1, recognised.mapping, defaults, proof, recognised.extras) with blank rows dropped.
// context: { merges (the sheet's merged cells), start (the sheet range's start { r, c }), related: { role: { name, rows } } }.
export function applyFileType(fileType, incoming, context = {}) {
  const table = fileTypeTable(fileType);
  if (!table) throw Error('unknown file kind');
  const orders = [], totals = [], others = [];
  for (const row of incoming) { const k = table.rowKind(row.provenance.raw, row); (k === 'total' ? totals : k === 'other' ? others : orders).push(row); }
  const notes = [...(table.noteRows?.(context) || [])], unknown = new Map();
  const info = table.prepare ? table.prepare(orders, context, notes) : new Map();
  const rows = orders.map(row => {
    const own = info.get(row) || {}, status = table.statusColumn === undefined ? null : statusOf(row.provenance.raw[table.statusColumn]);
    if (status && !status.known) { const w = text(row.provenance.raw[table.statusColumn]); unknown.set(w, [...(unknown.get(w) || []), row.provenance.row]); }
    return withChanges(row, table.derive(row, { ...own, state: status?.state }, context));
  });
  for (const [word, at] of unknown) notes.push({ kind: 'unknown-status', word, count: at.length, rows: at.slice(0, 20) });
  if (others.length) notes.push({ kind: 'other-rows', count: others.length, rows: others.slice(0, 20).map(r => r.provenance.row) });
  if (totals.length > 1) notes.push({ kind: 'several-total-rows', count: totals.length, rows: totals.map(r => r.provenance.row) });
  if (!totals.length && table.totalRow) notes.push({ kind: 'total-row-missing' });
  const checks = table.checks ? table.checks(orders, totals, context, info, notes) : [];
  const summary = { kind: table.kind, name: table.name, orders: rows.length, totalRows: totals.length, otherRows: others.length, unknownStatus: [...unknown.values()].reduce((a, r) => a + r.length, 0), ...(table.summary ? table.summary(orders, info) : {}) };
  return { rows, notes, checks, summary };
}

// The fixed values of a kind import (plan piece 2): no account, currency JPY, the kind's own mapping and extra columns, no saved
// template, and — once a batch of the kind exists for the person — the service name of the latest such batch. request: the import
// request as the service validated it ({ service, account, currency, mapping, extras (null when not sent), template: boolean });
// latestService: the service of the person's latest batch of this kind, or null. Answers null, or the first reason to refuse.
export function kindRequestRefusal(fileType, request, latestService) {
  const table = fileTypeTable(fileType), refuse = (reason, expected, found) => ({ reason, expected, found });
  if (request.template) return refuse('template', '', 'template');
  if (text(request.account)) return refuse('account', '', text(request.account));
  if (text(request.currency) && text(request.currency) !== DEFAULT_CURRENCY) return refuse('currency', DEFAULT_CURRENCY, text(request.currency));
  if (request.mapping && JSON.stringify(fullMapping(request.mapping)) !== JSON.stringify(table.mapping)) return refuse('mapping', '', '');
  if (request.extras && JSON.stringify(request.extras.map(x => ({ name: x.name, column: String(x.column) }))) !== JSON.stringify(table.extras)) return refuse('mapping', '', '');
  if (latestService && text(request.service) && text(request.service) !== latestService) return refuse('service', latestService, text(request.service));
  return null;
}
// The service name a kind import stores: the latest batch's once one exists, else the name the request gives (OMF's default when blank).
export const kindService = (request, latestService) => latestService || text(request.service) || DEFAULT_SERVICE;
export const kindDefaults = service => ({ service, account: '', currency: DEFAULT_CURRENCY });

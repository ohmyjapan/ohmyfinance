// Intake (購入受付) model: the twenty fields a purchase request carries, the owner-named extra columns beside them, how a row
// from a sheet becomes values, and how an incoming set of rows is planned against the stored records (new / update /
// unchanged / ambiguous). Pure: no database, no clock beyond options.now, no identifiers beyond options.id. Behaviour
// reference: output/omf-intake-platform-20261016/model.js; fields 14-20 and extras: plan omf-intake-mapping-research-amended-20261017.
export const FIELDS = [
  ['orderId', '注文・取引ID', ['注文番号', '注文id', '取引id', 'orderid', 'order_id', 'order number', '注文ID', '注文ID（文字列）', '서비스주문번호']],
  ['itemId', '商品・明細ID', ['商品id', '明細id', 'itemid', 'item_id', '상품번호']],
  ['externalOrderId', '外部注文番号', ['外部注文番号', '外部注文id', 'externalorderno', 'external_order_no', 'externalorderid', 'external_order_id', '購入先注文番号', '店舗注文番号']],
  ['customer', 'お客様・案件', ['顧客', 'お客様', 'customer', 'customerid', '고객']],
  ['description', '商品・依頼内容', ['商品名', '内容', 'description', 'product', '상품명']],
  ['merchant', '購入先・店舗', ['店舗', '購入先', 'merchant', 'shop', 'seller', '판매처']],
  ['merchantUrl', '店舗・商品URL', ['url', '商品url', '店舗url', 'producturl', 'shopurl', 'website', 'websiteurl']],
  ['purchaseDate', '購入日', ['購入日', '利用日', 'date', 'purchasedate', 'purchase_date', '구매일']],
  ['amount', '購入金額', ['購入金額', '金額', '合計', 'amount', 'total', '금액']],
  ['itemPrice', '商品価格', ['商品価格', 'itemprice', 'item_price', '単価', 'price', '상품가격']],
  ['tax', '税額', ['税額', 'tax', '税', '消費税', '세금']],
  ['shippingFee', '送料', ['送料', 'shipping', 'shippingfee', 'shipping_fee', '配送料', '배송비']],
  ['otherFee', 'その他手数料', ['その他手数料', '手数料', 'otherfee', 'other_fee', 'fee', '수수료']],
  ['supplierName', '会社名（法人名）', ['会社名', '法人名', 'suppliername', 'supplier_name', 'company', 'companyname', '運営会社']],
  ['invoiceNumber', '登録番号（T番号）', ['登録番号', 'T番号', 'invoicenumber', 'invoice_number', 'インボイス番号', '適格請求書発行事業者登録番号']],
  ['currency', '通貨', ['通貨', 'currency']],
  ['purchaseState', '購入状況', ['購入状況', 'status', '状態', '구매상태']],
  ['notes', 'メモ', ['メモ', '備考', 'notes', 'memo']],
  ['service', '受付元・サービス', ['サービス', '受付元', 'service', 'source']],
  ['account', 'サービス内アカウント', ['アカウント', 'account', 'accountid']]
];
export const FIELD_NAMES = Object.fromEntries(FIELDS.map(f => [f[0], f[1]]));
// The money fields: ¥/￥, commas and spaces are dropped and a finite number is kept as its plain string (zero and negatives kept).
export const MONEY = ['amount', 'itemPrice', 'tax', 'shippingFee', 'otherFee'];
export const STATES = ['requested', 'purchased', 'cancelled', 'refunded'];
export const STATE_NAMES = { requested: '受付中', purchased: '購入済み', cancelled: 'キャンセル', refunded: '返金' };
export const DEFAULT_SERVICE = '自社受付';
export const DEFAULT_CURRENCY = 'JPY';
export const text = v => v == null ? '' : String(v).trim();
const uuid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export function purchaseState(v) {
  v = text(v).toLowerCase();
  if (['購入済み', '完了', 'purchased', 'completed', '구매완료'].includes(v)) return 'purchased';
  if (['キャンセル', 'cancelled', 'canceled'].includes(v)) return 'cancelled';
  if (['返金', 'refunded'].includes(v)) return 'refunded';
  return 'requested';
}
export function normalize(v = {}) {
  const r = {};
  for (const [k] of FIELDS) r[k] = text(v[k]);
  r.service = r.service || DEFAULT_SERVICE; r.currency = r.currency || DEFAULT_CURRENCY;
  r.purchaseState = STATES.includes(r.purchaseState) ? r.purchaseState : purchaseState(r.purchaseState);
  r.purchaseDate = r.purchaseDate.replace(/^(\d{4})[\/.年](\d{1,2})[\/.月](\d{1,2})日?$/, (_, y, m, d) => y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0'));
  for (const k of MONEY) if (r[k]) { const n = Number(r[k].replace(/[¥￥,，\s]/g, '')); if (Number.isFinite(n)) r[k] = String(n); }
  return r;
}
export function externalKey(v) { return v.orderId ? JSON.stringify([v.service, v.account, v.orderId, v.itemId]) : ''; }
export function sourceKey(p) { return p?.hash ? JSON.stringify(['file-row', p.hash, p.sheet, p.row]) : ''; }
export function manualKey(id) { return JSON.stringify(['manual', id]); }
export function guessMapping(headers) {
  const n = s => text(s).toLowerCase().replace(/[\s・（）()_-]/g, '');
  const out = {};
  for (const [k, label, aliases] of FIELDS) { const i = headers.findIndex(h => [label, ...aliases].some(a => n(a) === n(h))); out[k] = i < 0 ? '' : String(i); }
  return out;
}
// rows: the sheet rows below the header; mapping: field → column index as a string ('' = unmapped); defaults: values for
// fields the sheet does not carry; proof: { hash, fileName, documentId, sheet, firstRow } with firstRow the sheet row number of rows[0];
// extras: owner-named columns [{ name, column }] → row.extra[name], present as 'extra:<name>' by the same blank rule.
export function mappedRows(rows, mapping, defaults, proof, extras = []) {
  return rows.map((row, i) => {
    const v = { ...defaults }; let present = [...Object.keys(defaults)];
    for (const [k] of FIELDS) if (mapping[k] !== '' && mapping[k] != null) { v[k] = row[Number(mapping[k])] ?? ''; if (text(v[k]) !== '') present.push(k); else present = present.filter(f => f !== k); }
    const extra = {};
    for (const { name, column } of extras) { extra[name] = text(row[Number(column)] ?? ''); if (extra[name] !== '') present.push('extra:' + name); }
    const { firstRow, ...source } = proof;
    return { values: normalize(v), extra, present, provenance: { ...source, row: firstRow + i, raw: row.map(text) } };
  });
}
// records: the stored records (id, key, values, extra, provenance, history, revision, identityReview, archived); incoming: rows
// of { values, extra?, present?, provenance?, id? }. A blank incoming cell or an unmapped field keeps the stored value unless
// options.clearBlank; the same rule keeps a stored extra. Neither records nor incoming are mutated.
export function planImport(records, incoming, options = {}) {
  const out = [], counts = new Map();
  for (const r of incoming) { const k = externalKey(r.values); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const index = new Map(records.filter(r => !r.archived).map(r => [r.key, r]));
  const now = options.now || new Date().toISOString(), newId = options.id || uuid;
  for (const row of incoming) {
    const v = normalize(row.values), ref = externalKey(v), ambiguous = !!ref && counts.get(ref) > 1;
    const id = row.id || newId(), key = (!ambiguous && ref) || sourceKey(row.provenance) || manualKey(id), old = index.get(key);
    const next = old ? structuredClone(old) : { id, key, values: v, extra: Object.fromEntries(Object.entries(row.extra || {}).filter(([, value]) => text(value) !== '').map(([name, value]) => [name, text(value)])), createdAt: now, updatedAt: now, revision: 0, history: [], provenance: [], identityReview: ambiguous || (!ref && !!row.provenance), archived: false };
    const before = old?.values || {}, changes = [];
    if (old) {
      for (const [k] of FIELDS) {
        if ((!row.present || row.present.includes(k)) && (v[k] !== '' || options.clearBlank)) { if (before[k] !== v[k]) changes.push({ field: k, before: before[k] || '', after: v[k] }); next.values[k] = v[k]; }
      }
      next.extra = next.extra || {};
      for (const [name, raw] of Object.entries(row.extra || {})) {
        const after = text(raw);
        if ((!row.present || row.present.includes('extra:' + name)) && (after !== '' || options.clearBlank)) { if ((next.extra[name] || '') !== after) changes.push({ field: 'extra:' + name, before: next.extra[name] || '', after }); next.extra[name] = after; }
      }
    }
    const p = row.provenance, proofAdded = !!p && !next.provenance.some(s => sourceKey(s) === sourceKey(p));
    if (proofAdded) next.provenance.push(p);
    const operation = !old ? 'new' : changes.length || proofAdded ? 'update' : 'unchanged';
    if (operation !== 'unchanged') { next.revision++; next.updatedAt = now; next.history.push({ at: now, kind: operation, changes, source: p ? { fileName: p.fileName, sheet: p.sheet, row: p.row } : null }); }
    out.push({ operation, record: next, changes, ambiguous, row: p?.row });
    index.set(key, next);
  }
  return { rows: out, new: out.filter(r => r.operation === 'new').length, update: out.filter(r => r.operation === 'update').length, unchanged: out.filter(r => r.operation === 'unchanged').length, ambiguous: out.filter(r => r.ambiguous).length };
}
export function applyPlan(records, plan) {
  const index = new Map(records.map(r => [r.id, r]));
  for (const r of plan.rows) index.set(r.record.id, r.record);
  return [...index.values()];
}

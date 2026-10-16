// Intake (購入受付) model: the thirteen fields a purchase request carries, how a row from a sheet becomes values, and how an
// incoming set of rows is planned against the stored records (new / update / unchanged / ambiguous). Pure: no database, no
// clock beyond options.now, no identifiers beyond options.id. Behaviour reference: output/omf-intake-platform-20261016/model.js.
export const FIELDS = [
  ['orderId', '注文・取引ID', ['注文番号', '注文id', '取引id', 'orderid', 'order_id', 'order number', '注文ID', '注文ID（文字列）', '서비스주문번호']],
  ['itemId', '商品・明細ID', ['商品id', '明細id', 'itemid', 'item_id', '상품번호']],
  ['customer', 'お客様・案件', ['顧客', 'お客様', 'customer', 'customerid', '고객']],
  ['description', '商品・依頼内容', ['商品名', '内容', 'description', 'product', '상품명']],
  ['merchant', '購入先・店舗', ['店舗', '購入先', 'merchant', 'shop', 'seller', '판매처']],
  ['merchantUrl', '店舗・商品URL', ['url', '商品url', '店舗url', 'producturl', 'shopurl']],
  ['purchaseDate', '購入日', ['購入日', '利用日', 'date', 'purchasedate', 'purchase_date', '구매일']],
  ['amount', '購入金額', ['購入金額', '金額', '合計', 'amount', 'total', '금액']],
  ['currency', '通貨', ['通貨', 'currency']],
  ['purchaseState', '購入状況', ['購入状況', 'status', '状態', '구매상태']],
  ['notes', 'メモ', ['メモ', '備考', 'notes', 'memo']],
  ['service', '受付元・サービス', ['サービス', '受付元', 'service', 'source']],
  ['account', 'サービス内アカウント', ['アカウント', 'account', 'accountid']]
];
export const FIELD_NAMES = Object.fromEntries(FIELDS.map(f => [f[0], f[1]]));
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
  if (r.amount) { const n = Number(r.amount.replace(/[¥￥,，\s]/g, '')); if (Number.isFinite(n)) r.amount = String(n); }
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
// fields the sheet does not carry; proof: { hash, fileName, documentId, sheet, firstRow } with firstRow the sheet row number of rows[0].
export function mappedRows(rows, mapping, defaults, proof) {
  return rows.map((row, i) => {
    const v = { ...defaults }; let present = [...Object.keys(defaults)];
    for (const [k] of FIELDS) if (mapping[k] !== '' && mapping[k] != null) { v[k] = row[Number(mapping[k])] ?? ''; if (text(v[k]) !== '') present.push(k); else present = present.filter(f => f !== k); }
    const { firstRow, ...source } = proof;
    return { values: normalize(v), present, provenance: { ...source, row: firstRow + i, raw: row.map(text) } };
  });
}
// records: the stored records (id, key, values, provenance, history, revision, identityReview, archived); incoming: rows of
// { values, present?, provenance?, id? }. A blank incoming cell or an unmapped field keeps the stored value unless
// options.clearBlank. Neither records nor incoming are mutated.
export function planImport(records, incoming, options = {}) {
  const out = [], counts = new Map();
  for (const r of incoming) { const k = externalKey(r.values); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const index = new Map(records.filter(r => !r.archived).map(r => [r.key, r]));
  const now = options.now || new Date().toISOString(), newId = options.id || uuid;
  for (const row of incoming) {
    const v = normalize(row.values), ref = externalKey(v), ambiguous = !!ref && counts.get(ref) > 1;
    const id = row.id || newId(), key = (!ambiguous && ref) || sourceKey(row.provenance) || manualKey(id), old = index.get(key);
    const next = old ? structuredClone(old) : { id, key, values: v, createdAt: now, updatedAt: now, revision: 0, history: [], provenance: [], identityReview: ambiguous || (!ref && !!row.provenance), archived: false };
    const before = old?.values || {}, changes = [];
    if (old) {
      for (const [k] of FIELDS) {
        if ((!row.present || row.present.includes(k)) && (v[k] !== '' || options.clearBlank)) { if (before[k] !== v[k]) changes.push({ field: k, before: before[k] || '', after: v[k] }); next.values[k] = v[k]; }
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

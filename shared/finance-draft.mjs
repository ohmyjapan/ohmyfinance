// The mapper and its editor share the same explicit transaction field contract.
// Financial source values are immutable; only accounting decisions are editable.
export const fields = [
  { key: 'purpose', label: '用途', group: 'classification', kind: 'purpose' },
  { key: 'customerId', label: '顧客', group: 'classification', kind: 'reference', ref: 'customers' },
  { key: 'accountCategoryId', label: '勘定科目', group: 'classification', kind: 'reference', ref: 'accountCategories', learn: true },
  { key: 'subAccountCategoryId', label: '補助科目', group: 'classification', kind: 'reference', ref: 'accountCategories', learn: true },
  { key: 'transactionCategoryId', label: '区分', group: 'classification', kind: 'reference', ref: 'transactionCategories', learn: true },
  { key: 'taxCategoryId', label: '税区分', group: 'classification', kind: 'reference', ref: 'taxCategories', learn: true },
  { key: 'taxRate', label: '税率 (%)', group: 'classification', kind: 'number', learn: true },
  { key: 'date', label: '計上日', group: 'basic', kind: 'date' },
  { key: 'status', label: '取引ステータス', group: 'basic', kind: 'status' },
  { key: 'referenceNumber', label: '取引番号', group: 'basic', kind: 'text' },
  { key: 'sourceId', label: 'データソース', group: 'basic', kind: 'reference', ref: 'sources' },
  { key: 'supplierId', label: '仕入れ先', group: 'supplier', kind: 'reference', ref: 'suppliers', learn: true },
  { key: 'companyInfo', label: '法人情報', group: 'supplier', kind: 'textarea', learn: true },
  { key: 'invoiceNumber', label: 'インボイス番号', group: 'supplier', kind: 'text' },
  { key: 'receiptNumber', label: 'レシート・注文番号', group: 'supplier', kind: 'text' },
  { key: 'trackingNumber', label: '追跡番号・運送状番号', group: 'supplier', kind: 'text' },
  { key: 'productName', label: '商品名', group: 'product', kind: 'text' },
  { key: 'productPrice', label: '商品価格', group: 'product', kind: 'number' },
  { key: 'janCode', label: 'JANコード', group: 'product', kind: 'text' },
  { key: 'items', label: '商品明細', group: 'items', kind: 'items' },
  { key: 'notes', label: '備考', group: 'notes', kind: 'textarea' },
  { key: 'tags', label: 'タグ', group: 'notes', kind: 'tags' }
];
export const learnedFields = fields.filter(f => f.learn).map(f => f.key);
export const normalizeMerchant = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isEmpty = value => value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
export function emptyValues(row) {
  const values = Object.fromEntries(fields.map(f => [f.key, ['items', 'tags'].includes(f.key) ? [] : f.kind === 'number' ? null : '']));
  return { ...values, purpose: 'unresolved', date: row.processingDate || row.purchaseDate, status: 'completed', notes: row.description };
}
const text = (value, length = 1000) => {
  if (typeof value !== 'string' || value.length > length || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error('文字列の形式または長さを確認してください。');
  return value.trim();
};
const reference = value => { const v = text(value); if (v && !/^[a-f\d]{24}$/i.test(v)) throw Error('登録済みの項目を選択してください。'); return v; };
const number = (value, max = 1e12) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw Error('数値の範囲を確認してください。');
  return value;
};
export function validateValues(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.some(f => f.key === k))) throw Error('下書きの項目が不正です。');
  const values = {};
  for (const field of fields) {
    const v = input[field.key];
    if (field.kind === 'reference') values[field.key] = reference(v);
    else if (field.kind === 'number') values[field.key] = number(v, field.key === 'taxRate' ? 100 : 1e12);
    else if (field.kind === 'tags') {
      if (!Array.isArray(v) || v.length > 30) throw Error('タグは30件までです。');
      values.tags = [...new Set(v.map(tag => text(tag, 100)).filter(Boolean))];
    } else if (field.kind === 'items') {
      if (!Array.isArray(v) || v.length > 200) throw Error('商品明細は200行までです。');
      values.items = v.map(item => {
        const allowed = ['productName', 'janCode', 'productUrl', 'quantity', 'unitPrice', 'taxCategoryId', 'taxRate'];
        if (!item || typeof item !== 'object' || Object.keys(item).some(k => !allowed.includes(k))) throw Error('商品明細の形式を確認してください。');
        const result = { productName: text(item.productName || ''), janCode: text(item.janCode || '', 100), productUrl: text(item.productUrl || '', 2000), quantity: number(item.quantity, 1e6), unitPrice: number(item.unitPrice), taxCategoryId: reference(item.taxCategoryId || ''), taxRate: number(item.taxRate ?? null, 100) };
        if (!result.productName && !result.janCode) throw Error('商品名またはJANコードを入力してください。');
        if (!result.quantity || result.unitPrice === null) throw Error('商品の数量と単価を入力してください。');
        if (result.productUrl && !/^https?:\/\//i.test(result.productUrl)) throw Error('商品URLはhttpまたはhttpsで入力してください。');
        return result;
      });
    } else values[field.key] = text(v, field.kind === 'textarea' ? 10000 : 1000);
  }
  if (!['customer', 'company', 'unresolved'].includes(values.purpose)) throw Error('用途を選択してください。');
  if (values.purpose !== 'customer' && values.customerId) throw Error('顧客購入以外の顧客IDは空欄にしてください。');
  if (!['completed', 'pending', 'processing', 'failed', 'cancelled'].includes(values.status)) throw Error('取引ステータスを選択してください。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isFinite(Date.parse(values.date)) || new Date(values.date).toISOString().slice(0, 10) !== values.date) throw Error('有効な計上日を入力してください。');
  return values;
}
export function missingFields(values) {
  const required = ['accountCategoryId', 'transactionCategoryId', 'taxCategoryId', 'taxRate'];
  if (values.purpose === 'unresolved') required.push('purpose');
  if (values.purpose === 'customer') required.push('customerId');
  return required.filter(key => key === 'purpose' || isEmpty(values[key])).map(key => ({ key, label: fields.find(f => f.key === key).label }));
}
export function transactionValues(values) {
  const { purpose, ...transaction } = values;
  const clean = Object.fromEntries(Object.entries(transaction).filter(([, v]) => !isEmpty(v)));
  // An explicitly cleared note must override the older importer's merchant-note default.
  clean.notes = values.notes;
  clean.items = values.items.map(item => Object.fromEntries(Object.entries(item).filter(([, v]) => !isEmpty(v))));
  clean.tags = [...new Set(['imported', 'amex', ...values.tags])];
  return clean;
}

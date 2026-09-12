import { draftSupplierRegistration } from './finance-supplier.mjs';
import { fields, isEmpty, missingFields, normalizeMerchant, validateValues } from './finance-draft.mjs';
const find = (refs, key, value) => (refs[key] || []).find(r => String(r._id || r.id) === String(value));

// Source labels are reference data, never an inferred expense account or tax rule.
export function sourceCategoryChoices(rows, references) {
  const choices = new Map();
  for (const row of rows) {
    if (!['customer', 'company'].includes(row.purpose) || typeof row.category !== 'string') continue;
    const name = row.category.trim(), key = normalizeMerchant(name);
    if (!key || name.length > 100 || /[\x00-\x1f]/.test(name)) continue;
    if (!choices.has(key)) choices.set(key, { name, count: 0, matches: (references.transactionCategories || []).filter(r => normalizeMerchant(r.name) === key).length });
    choices.get(key).count++;
  }
  return [...choices.values()];
}

// A recorded registration number is not a determination of invoice eligibility.
// Blank is neither zero tax nor an invoice exemption. This is a review aid, not
// a new legal posting requirement; the existing explicit posting gate remains.
export function taxAndInvoice(draft, references = draft.references || {}) {
  const v = draft.values || {}, e = draft.evidence || {};
  const number = String(v.invoiceNumber || '').trim();
  const invoiceStatus = !number ? 'missing' : !/^T[0-9]{13}$/.test(number) ? 'format_review'
    : e.invoiceNumber?.state === 'conflict' ? 'conflict' : e.invoiceNumber?.state === 'confirmed' ? 'confirmed' : 'recorded';
  const tax = find(references, 'taxCategories', v.taxCategoryId);
  const rate = isEmpty(v.taxRate) ? null : v.taxRate;
  const taxStatus = !tax || rate === null ? 'missing' : !Number.isFinite(rate) || rate < 0 || rate > 100 || tax.rate !== rate ? 'conflict'
    : ['taxCategoryId', 'taxRate'].some(k => e[k]?.state === 'conflict') ? 'conflict'
    : ['taxCategoryId', 'taxRate'].every(k => e[k]?.state === 'confirmed') ? 'confirmed' : 'recorded';
  return {
    invoice: { number, registry: draftSupplierRegistration(v, references), status: invoiceStatus, label: { missing: '未取得・要確認', format_review: '番号の形式を確認', conflict: '根拠の相違を確認', recorded: '登録情報・確認待ち', confirmed: '入力確認済み' }[invoiceStatus],
      reason: !number ? '登録番号が未取得か、保存要件の特例などに該当するかを確認します。空欄だけでは判断できません。'
        : invoiceStatus === 'format_review' ? '適格請求書発行事業者の登録番号はTと13桁の数字です。レシート・注文番号とは別の項目です。'
        : '登録番号の入力状況です。公表情報の確認記録は別に表示します。この取引の税率・書類も確認してください。' },
    tax: { category: tax?.name || '', rate, status: taxStatus,
      rateLabel: rate === null ? '未設定' : String(rate) + '%',
      reason: taxStatus === 'missing' ? '税区分・消費税率を請求書などの根拠と照合してください。未設定は0%ではありません。'
        : taxStatus === 'conflict' ? '税区分・税率、または根拠が一致していません。'
        : '入力された税区分と税率です。カード名や登録番号だけから税率は決めません。' }
  };
}

export function draftReadiness(draft, references = draft.references || {}, review = draft.review || {}) {
  const v = draft.values || {}, e = draft.evidence || {}, source = draft.source || {};
  const accounting = taxAndInvoice(draft, references);
  const problems = new Map(missingFields(v).map(f => [f.key, { ...f, reason: '未設定' }]));
  const add = (key, reason) => problems.set(key, { key, label: fields.find(f => f.key === key)?.label || key, reason });
  for (const field of fields.filter(f => f.ref)) if (v[field.key] && !find(references, field.ref, v[field.key])) add(field.key, '登録済みの参照先を確認');
  const main = find(references, 'accountCategories', v.accountCategoryId), sub = find(references, 'accountCategories', v.subAccountCategoryId);
  if (main?.parentId) add('accountCategoryId', '親科目を選択');
  if (draft.cardAccounting && ['missing', 'review'].includes(draft.cardAccounting.status)) problems.set('cardAccounting', { key: 'cardAccounting', label: 'カード側の科目', reason: draft.cardAccounting.reason });
  if (sub && String(sub.parentId || '') !== v.accountCategoryId) add('subAccountCategoryId', '勘定科目との組み合わせを確認');
  if (accounting.tax.status === 'conflict') add('taxRate', '税区分と税率の根拠を確認');
  for (const item of v.items || []) {
    const tax = find(references, 'taxCategories', item.taxCategoryId);
    if (item.taxCategoryId && (!tax || isEmpty(item.taxRate) || tax.rate !== item.taxRate)) add('items', '商品明細の税区分・税率を確認');
  }
  let invalid = false;
  try { validateValues(v); } catch { invalid = true; }
  const conflicts = fields.filter(f => e[f.key]?.state === 'conflict').map(f => ({ key: f.key, label: f.label }));
  const sourceKnown = key => !draft.revision && e[key]?.source === 'spreadsheet' && e[key]?.state !== 'conflict';
  const customerKnown = v.purpose === 'company' && !v.customerId || v.purpose === 'customer' && (!!find(references, 'customers', v.customerId) || sourceKnown('customerId') && !!source.clientCode);
  const categoryKnown = !!find(references, 'transactionCategories', v.transactionCategoryId) || sourceKnown('transactionCategoryId') && !!source.category;
  const classificationKnown = customerKnown && categoryKnown && !conflicts.some(f => ['purpose', 'customerId', 'transactionCategoryId'].includes(f.key));
  let state;
  if (['posted', 'duplicate'].includes(review.state)) state = 'posted';
  else if (review.skipped) state = 'held';
  else if (source.kind !== 'expense') state = 'excluded';
  else if (draft.locked || ['in_progress', 'overlap_review', 'legacy_review', 'correction_review'].includes(review.state)) state = 'reconciliation';
  else if (!classificationKnown || conflicts.length) state = 'decision';
  else if (problems.size || invalid) state = 'accounting';
  else if (['missing', 'format_review', 'conflict'].includes(accounting.invoice.status)) state = 'invoice';
  else if (!draft.approvedAt) state = 'confirmation';
  else state = 'ready';
  return { state, label: preparationStates[state], cardAccounting: draft.cardAccounting || null, missing: [...problems.values()], conflicts, invalid, ...accounting };
}
export const preparationStates = { decision: '分類の判断', accounting: '会計項目の入力', invoice: 'インボイス確認', confirmation: '内容の確認', ready: '入力・確認済み', reconciliation: '重複・既存取引の照合', held: '取込対象外に指定', posted: '登録済み・重複', excluded: '返済・返金など' };


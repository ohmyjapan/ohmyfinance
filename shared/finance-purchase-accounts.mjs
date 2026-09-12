import { normalizeMerchant } from './finance-draft.mjs';
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const ref = (references, id) => references.accountCategories?.find(r => String(r._id || r.id) === id);
const oid = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
export function purchaseAccountHistory(bundle, row, scope, references) {
  const empty = { status: 'none', reason: '', examples: [] };
  if (row.kind !== 'expense' || !validDate(row.purchaseDate) || !bundle) return empty;
  if (bundle.version !== 1 || !/^[a-f0-9]{64}$/.test(bundle.sourceHash || '') || !Array.isArray(bundle.items) || bundle.items.length > 500) return { ...empty, status: 'review', reason: '過去の記帳資料を再確認してください。' };
  const matching = bundle.items.filter(e => e && typeof e === 'object' && e.merchant === normalizeMerchant(row.description) && validDate(e.date) && e.date < row.purchaseDate);
  if (!matching.length) return empty;
  const sameScope = e => e.purpose === scope.purpose && (e.customerId || '') === (scope.customerId || '');
  const scoped = ['company','customer'].includes(scope.purpose) && (scope.purpose !== 'customer' || oid(scope.customerId)) ? matching.filter(sameScope) : [];
  const examples = (scoped.length ? scoped : matching).slice().sort((a,b) => b.date.localeCompare(a.date)).slice(0,5).map(e => ({ date:e.date, amount:e.amount, accountName:e.accountName, subAccountName:e.subAccountName || '', sourceRows:(Array.isArray(e.sourceRows) ? e.sourceRows.filter(r=>r && typeof r === 'object') : []).slice(0,10).map(r=>({sheet:r.sheet,row:r.row})) }));
  const review = reason => ({ status:'review', reason, examples });
  if (scope.purpose === 'customer' && !(references.customers || []).some(c=>String(c._id || c.id) === scope.customerId && c.isActive !== false)) return review('顧客台帳との対応を再確認してください。');
  if (!scoped.length) return review('同じ用途・顧客を確認できる記帳例がありません。購入内容を確認してください。');
  if (scoped.some(e => e.disposition !== 'suggest')) return review(scoped.find(e=>e.disposition !== 'suggest').reason || '過去の勘定科目は再確認が必要です。');
  for (const e of scoped) {
    const main = ref(references,e.accountCategoryId), sub = e.subAccountCategoryId ? ref(references,e.subAccountCategoryId) : null;
    if (!oid(e.accountCategoryId) || !main || main.isActive === false || main.parentId || !['expense','asset'].includes(main.type) || main.name !== e.accountName
      || (e.subAccountCategoryId && (!sub || sub.isActive === false || String(sub.parentId) !== e.accountCategoryId || sub.name !== e.subAccountName))
      || !Number.isFinite(e.amount) || e.amount <= 0 || !Array.isArray(e.sourceRows) || !e.sourceRows.length || e.sourceRows.some(r=>!r || !Number.isSafeInteger(r.row) || r.row<1 || typeof r.sheet !== 'string' || !r.sheet)) return review('記帳例と科目・元シートの対応を再確認してください。');
  }
  const pairs = new Set(scoped.map(e=>JSON.stringify([e.accountCategoryId,e.subAccountCategoryId || ''])));
  if (pairs.size !== 1) return review('同じ口座・利用先・用途・顧客で、過去の勘定科目が異なります。');
  const first = scoped[0], reason = '同じ口座・利用先・用途・顧客の弥生の記帳例 ' + scoped.length + '件を参考にした候補です。今回の購入内容を確認してください。税率は別途確認します。';
  return { status:'suggested', reason, accountCategoryId:first.accountCategoryId, subAccountCategoryId:first.subAccountCategoryId || '', accountName:first.accountName, subAccountName:first.subAccountName || '', exampleCount:scoped.length, sourceHash:bundle.sourceHash, scope:{purpose:scope.purpose,customerId:scope.customerId || ''}, examples };
}
// A context change must not leave an untouched historical suggestion selected.
export function clearChangedPurchaseContext(values, original, evidence) {
  if (evidence?.accountCategoryId?.source !== 'yayoi_history' || values.purpose === original.purpose && values.customerId === original.customerId) return false;
  if (values.accountCategoryId !== original.accountCategoryId || values.subAccountCategoryId !== original.subAccountCategoryId) return false;
  values.accountCategoryId = ''; values.subAccountCategoryId = ''; return true;
}

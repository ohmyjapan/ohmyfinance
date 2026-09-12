import { normalizeMerchant } from './finance-draft.mjs';
const text = value => typeof value === 'string' ? value.trim() : '';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function evidenceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
// A historical registry observation, never a claim about today's status or tax eligibility.
export function supplierRegistration(supplier, now = Date.now()) {
  const number = text(supplier?.invoiceNumber), proof = supplier?.metadata?.invoiceVerification;
  const empty = { status: 'unverified', label: '公表情報は未確認', number };
  if (!proof) return empty;
  const company = text(supplier.companyName) || text(supplier.name);
  const sameIdentity = number === proof.number && normalizeMerchant(company) === normalizeMerchant(proof.legalName);
  if (!sameIdentity) return { ...empty, status: 'mismatch', label: '会社名・登録番号の再確認が必要' };
  const checked = Date.parse(proof.checkedAt), source = evidenceUrl(proof.sourceUrl);
  const canonical = 'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=' + number.slice(1);
  if (proof.version !== 1 || !/^T[0-9]{13}$/.test(number) || proof.source !== 'nta_public_site' || proof.method !== 'browser_review'
    || proof.scope !== 'issuer_registration_only' || proof.status !== 'active_at_check' || source !== canonical
    || !Number.isFinite(checked) || checked > now || !date(proof.asOf) || !date(proof.registeredFrom)
    || proof.asOf > new Date(checked).toISOString().slice(0,10) || proof.registeredFrom > proof.asOf
    || !text(proof.evidence?.text) || !/^[a-f0-9]{64}$/.test(proof.evidence?.sha256 || '')) return empty;
  return { status: 'verified', label: '国税庁で確認済み', number, legalName: text(proof.legalName), registeredAddress: text(proof.registeredAddress),
    registeredFrom: proof.registeredFrom, asOf: proof.asOf, checkedAt: new Date(checked).toISOString(), sourceUrl: canonical, scope: 'issuer_registration_only' };
}
export function draftSupplierRegistration(values, references) {
  const supplier = (references?.suppliers || []).find(s => String(s._id || s.id) === values?.supplierId);
  if (!supplier) return { status: 'unverified', label: '仕入れ先との照合が必要' };
  if (text(values.invoiceNumber) !== text(supplier.invoiceNumber)) return { status: 'mismatch', label: '下書きと仕入れ先の番号が異なります' };
  return supplier.registration || { status: 'unverified', label: '公表情報は未確認' };
}
export function resolveSupplier(merchant, suppliers, links = []) {
  const normalized = normalizeMerchant(merchant), records = links.filter(l => l.merchant === normalized);
  if (records.length > 1) return { status: 'conflict', reason: '利用先の記憶が重複しています。確認してください。' };
  const link = records[0];
  if (link) {
    if (!link.enabled) return { status: 'disabled', reason: 'この利用先の記憶は停止中です。', link };
    const supplier = suppliers.find(s => String(s._id) === String(link.supplierId));
    if (!supplier || supplier.identityKey !== link.supplierKey) return { status: 'stale', reason: '仕入れ先の会社情報が変わりました。対応を再確認してください。', link };
    return { status: 'linked', supplier, link, reason: '同じ口座・利用先について、あなたが確認した仕入れ先です。' };
  }
  const matches = normalized ? suppliers.filter(s => ['name','companyName','serviceName'].some(k => normalizeMerchant(s[k]) === normalized)) : [];
  return matches.length === 1 ? { status: 'exact', supplier: matches[0], reason: 'CSVの利用先と仕入れ先台帳が完全一致。運営会社の対応は必要に応じて確認してください。' }
    : { status: matches.length ? 'conflict' : 'unmatched', reason: matches.length ? '同名の仕入れ先が複数あります。運営会社を確認してください。' : 'この利用先の仕入れ先は未確認です。' };
}

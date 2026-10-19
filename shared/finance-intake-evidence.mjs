// Intake company / T-number evidence attribution (plan omf-monthly-reconciliation-20261020 F4). Pure, portable browser/Node module.
// Which stored values a company/T-number research supports, after later edits of the record:
// - research-confirmed: the research was confirmed and the record's stored 会社名 and T番号 equal research.confirmed and its
//   店舗・商品URL equals the URL the research looked at (research.context.merchantUrl). Changing a value back restores it.
// - file-manual: a stored value without that correspondence (imported from a file, typed by hand, or edited after confirmation).
// - candidate: a value shown from a research report that is not stored in the record (a ready, unconfirmed lookup).
// - none: nothing stored and nothing found.
// `sourcesCurrent` says whether the research's citations still support the values shown and the current URL; when false they are
// kept and shown as 調査時の根拠（現在の値と異なる）, never hidden. Registry verification is NOT decided here: it stays the existing
// equality of the active NTA row with the number and legal name (financePaymentMatchService / financeIntakeResearchService).
// Fold (plan omf-monthly-reconciliation-fold-20261020, review omf-monthly-patch-opus55-20261020 F4): what IS decided here is the
// date basis of that registry check. The NTA row is checked as of one day (registry.asOf: the research-time 購入日, or the
// research day for an undated record); `registryBasis` names it and is `current` only while the record is undated or its valid
// 購入日 equals that day. Otherwise 'purchaseDate' is in `differs`, a confirmed research is no longer current (stale, the
// re-research lane), and the services do not present the check as verified for this purchase — while unchanged 会社名/T番号
// keep their research origin. A research without supported values (queued, working, failed, no supplier) has no differences.
const text = v => v == null ? '' : String(v).trim();
const FIELDS = ['supplierName', 'invoiceNumber'];
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function registryBasisOf(values, research) {
  const asOf = text(research?.registry?.asOf);
  if (!asOf) return null;
  const day = text(values?.purchaseDate), dated = validDay(day) ? day : '';
  return { asOf, purchaseDate: dated, current: !dated || dated === asOf };
}
function correspondence(values, research) {
  const v = values || {}, stored = { supplierName: text(v.supplierName), invoiceNumber: text(v.invoiceNumber) };
  const urlCurrent = !!research?.context && text(research.context.merchantUrl) === text(v.merchantUrl);
  const confirmed = research?.state === 'confirmed' && research.confirmed ? { supplierName: text(research.confirmed.supplierName), invoiceNumber: text(research.confirmed.invoiceNumber) } : null;
  const supplier = research?.report?.supplier || null, reported = supplier ? { supplierName: text(supplier.legalName), invoiceNumber: text(supplier.invoiceNumber) } : null;
  const supported = confirmed || reported, basis = supported ? registryBasisOf(v, research) : null;
  const valuesCurrent = !!confirmed && urlCurrent && FIELDS.every(k => stored[k] === confirmed[k]);
  return { stored, urlCurrent, confirmed, reported, supported, valuesCurrent, basis, current: valuesCurrent && (!basis || basis.current) };
}
// The research row is the one stored per record (financeintakeresearch): { state, context: { merchantUrl }, report, confirmed }.
export function intakeEvidence(values, research) {
  const c = correspondence(values, research), shown = {}, origins = {};
  for (const k of FIELDS) {
    if (c.stored[k]) { shown[k] = c.stored[k]; origins[k] = c.confirmed && c.urlCurrent && c.stored[k] === c.confirmed[k] ? 'research-confirmed' : 'file-manual'; }
    else { shown[k] = c.reported?.[k] || ''; origins[k] = shown[k] ? 'candidate' : 'none'; }
  }
  const origin = c.valuesCurrent ? 'research-confirmed' : FIELDS.some(k => c.stored[k]) ? 'file-manual' : FIELDS.some(k => shown[k]) ? 'candidate' : 'none';
  const differs = [];
  if (research && c.supported) { if (!c.urlCurrent) differs.push('merchantUrl'); for (const k of FIELDS) if (c.supported[k] !== shown[k]) differs.push(k); if (c.basis && !c.basis.current) differs.push('purchaseDate'); }
  return { origin, origins, supplierName: shown.supplierName, invoiceNumber: shown.invoiceNumber, sourcesCurrent: !!research && !!c.supported && !differs.length, differs, registryBasis: c.basis };
}
// True only while a confirmed research still corresponds to the record: stored name and number equal research.confirmed, the
// URL equals the researched URL and (fold) its registry check, if any, is as of the record's current purchase date. The research
// read uses it for `stale` of a confirmed research.
export function confirmedResearchCurrent(values, research) { return correspondence(values, research).current; }

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
const text = v => v == null ? '' : String(v).trim();
const FIELDS = ['supplierName', 'invoiceNumber'];
function correspondence(values, research) {
  const v = values || {}, stored = { supplierName: text(v.supplierName), invoiceNumber: text(v.invoiceNumber) };
  const urlCurrent = !!research?.context && text(research.context.merchantUrl) === text(v.merchantUrl);
  const confirmed = research?.state === 'confirmed' && research.confirmed ? { supplierName: text(research.confirmed.supplierName), invoiceNumber: text(research.confirmed.invoiceNumber) } : null;
  const supplier = research?.report?.supplier || null, reported = supplier ? { supplierName: text(supplier.legalName), invoiceNumber: text(supplier.invoiceNumber) } : null;
  const supported = confirmed || reported;
  const current = !!confirmed && urlCurrent && FIELDS.every(k => stored[k] === confirmed[k]);
  return { stored, urlCurrent, confirmed, reported, supported, current };
}
// The research row is the one stored per record (financeintakeresearch): { state, context: { merchantUrl }, report, confirmed }.
export function intakeEvidence(values, research) {
  const c = correspondence(values, research), shown = {}, origins = {};
  for (const k of FIELDS) {
    if (c.stored[k]) { shown[k] = c.stored[k]; origins[k] = c.confirmed && c.urlCurrent && c.stored[k] === c.confirmed[k] ? 'research-confirmed' : 'file-manual'; }
    else { shown[k] = c.reported?.[k] || ''; origins[k] = shown[k] ? 'candidate' : 'none'; }
  }
  const origin = c.current ? 'research-confirmed' : FIELDS.some(k => c.stored[k]) ? 'file-manual' : FIELDS.some(k => shown[k]) ? 'candidate' : 'none';
  const differs = [];
  if (research && c.supported) { if (!c.urlCurrent) differs.push('merchantUrl'); for (const k of FIELDS) if (c.supported[k] !== shown[k]) differs.push(k); }
  return { origin, origins, supplierName: shown.supplierName, invoiceNumber: shown.invoiceNumber, sourcesCurrent: !!research && !!c.supported && !differs.length, differs };
}
// True only while a confirmed research still corresponds to the record: stored name and number equal research.confirmed and the
// URL equals the researched URL. The research read uses it for `stale` of a confirmed research.
export function confirmedResearchCurrent(values, research) { return correspondence(values, research).current; }

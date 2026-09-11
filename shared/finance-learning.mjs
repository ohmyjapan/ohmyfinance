import { createHash } from 'node:crypto';
import { normalizeMerchant } from './finance-draft.mjs';
export const learningVersion = 1;
export const norm = normalizeMerchant;
export const hash = value => createHash('sha256').update(value).digest('hex');
export function sourceUrl(value) {
  const u = new URL(value);
  if (u.origin !== 'https://docs.google.com' || !/^\/spreadsheets\/d\/[\w-]+\/edit$/.test(u.pathname)) throw Error('Use a Google Sheets edit URL');
  return u.origin + u.pathname;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
}
export function gradePattern(customers, total) {
  const known = customers.filter(c => c.label.trim() && !/^(?:[-–—]+|未確認|不明)$/.test(c.label.trim()));
  if (known.length > 1) return 'C';
  if (!known.length) return 'D';
  return total >= 5 && known[0].count / total >= .9 ? 'B' : 'D';
}
export function classification(label, aliases) {
  const key = norm(label), alias = aliases.find(a => a.labels.some(l => norm(l) === key));
  if (key && alias) return { purpose: 'customer', customerId: alias.customerId };
  if (key === norm('法人') || key === norm('経費')) return { purpose: 'company', customerId: '' };
  return { purpose: 'unresolved', customerId: '' };
}
export function aggregatePatterns(rows) {
  const groups = new Map();
  for (const row of rows.filter(r => r.eligible)) {
    const key = hash(JSON.stringify([row.merchant, row.accountId || row.card, row.payment]));
    let g = groups.get(key);
    if (!g) { g = { key, merchant: row.merchant, merchantLabel: row.parsed.merchant, card: row.card, accountId: row.accountId, payment: row.payment, cards: new Set(), total: 0, from: row.date, to: row.date, customers: new Map(), categories: new Map() }; groups.set(key, g); }
    row.patternKey = key; g.cards.add(row.parsed.card); g.total++; g.from = g.from < row.date ? g.from : row.date; g.to = g.to > row.date ? g.to : row.date;
    // Aliases are operator-supplied user confirmations. Other labels remain distinct.
    const label = row.customerId ? 'customer:' + row.customerId : norm(row.parsed.customer);
    const c = g.customers.get(label) || { label: row.customerId ? row.customerName : row.parsed.customer, customerId: row.customerId, purpose: row.purpose, count: 0 };
    c.count++; g.customers.set(label, c);
    const category = row.parsed.category; g.categories.set(category, (g.categories.get(category) || 0) + 1);
  }
  return [...groups.values()].map(g => {
    const customers = [...g.customers.values()].sort((a,b) => b.count-a.count), categories = [...g.categories].map(([label,count]) => ({label,count})).sort((a,b) => b.count-a.count);
    return { ...g, cards: [...g.cards].sort(), customers, categories, grade: gradePattern(customers, g.total), status: 'proposed', revision: 0, audit: [] };
  }).sort((a,b) => b.total-a.total || a.key.localeCompare(b.key));
}
export function decisionInput(body) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || !['confirmed','deferred','proposed'].includes(body.status)) throw Error('Invalid review revision or status');
  if (typeof body.note !== 'string' || body.note.trim().length < 1 || body.note.length > 1500) throw Error('Explain this decision in 1–1500 characters');
  const decision = { status: body.status, note: body.note.trim() };
  if (body.status === 'confirmed') {
    if (!['customer','company'].includes(body.purpose) || !validDate(body.effectiveFrom)) throw Error('Choose the purpose and effective date');
    if (body.purpose === 'customer' && !/^[a-f\d]{24}$/.test(body.customerId || '')) throw Error('Choose a registered customer');
    Object.assign(decision, { purpose: body.purpose, customerId: body.purpose === 'customer' ? body.customerId : '', effectiveFrom: body.effectiveFrom });
  }
  return decision;
}

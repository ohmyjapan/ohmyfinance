import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { naviFeatures, naviFeature, naviFeatureRoute, naviFeatureForPath, findNaviFeatures, validateCompanyAssistantReply } from '../shared/finance-navi-features.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function pageFiles(dir = path.join(root, 'pages')) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await pageFiles(f)); else if (e.name.endsWith('.vue')) out.push(path.relative(root, f).split(path.sep).join('/')); } return out; }

test('every real page file has a source-mapped disposition with a reason', async () => {
 const sources = naviFeatures.flatMap(f => [f.source, f.recordSource].filter(Boolean).flatMap(s => s.split(',').map(x => x.trim())));
 for (const page of await pageFiles()) assert.ok(sources.includes(page), 'navi-features:unmapped ' + page);
 for (const f of naviFeatures) { assert.ok(['navi_tool', 'page_handoff', 'unsupported'].includes(f.disposition)); assert.ok(f.reason.length > 10, f.id); for (const s of f.source.split(',').map(x => x.trim())) assert.ok(existsSync(path.join(root, s)), 'navi-features:source-exists ' + s); }
 assert.equal(new Set(naviFeatures.map(f => f.id)).size, naviFeatures.length);
 for (const group of ['dashboard', 'transactions', 'mapping', 'learning', 'connections', 'intake', 'invoices', 'calendar', 'receipts', 'parties', 'settings', 'budgets', 'reports', 'purchase', 'audit', 'admin']) assert.ok(naviFeatures.some(f => f.group === group), 'navi-features:group ' + group);
 // Deliberate 2026-10-20 (business adapters): dashboard/reports/analytics read the grouped summary, receipts are read-only, budgets and
 // recurring have native adapters. A page label alone never makes a feature a Navi tool: every listed tool exists in the catalogue.
 assert.deepEqual(naviFeatures.filter(f => f.disposition === 'navi_tool').map(f => f.id).sort(), ['analytics', 'budgets', 'calendar', 'dashboard', 'invoices', 'receipts', 'recurring', 'reports', 'transactions']);
 const { companyBusinessTools } = await import('../shared/finance-navi-business.mjs');
 const known = new Set([...companyBusinessTools.map(t => t.name), 'list_company_transactions', 'get_company_transaction', 'list_company_transaction_choices', 'update_company_transaction', 'find_company_transaction_patterns', 'list_company_invoices', 'get_company_invoice', 'update_company_invoice', 'list_company_calendar_entries', 'get_company_calendar_entry', 'update_company_calendar_entry']);
 for (const f of naviFeatures) { assert.equal(f.disposition === 'navi_tool', !!f.tools?.length, 'navi-features:tools-match-disposition ' + f.id); for (const t of f.tools || []) assert.ok(known.has(t), 'navi-features:real-tool ' + t); }
 for (const id of ['tax-report', 'connections', 'organization-settings', 'security', 'api-settings', 'mapping', 'intake']) assert.notEqual(naviFeature(id).disposition, 'navi_tool', 'navi-features:handoff-kept ' + id);
});

test('routes are fixed local pages that exist; record routes accept only a company record id', () => {
 for (const f of naviFeatures) {
  if (f.route === null) { assert.equal(naviFeatureRoute(f.id), null); continue; }
  assert.match(f.route, /^\/[a-z0-9/-]*$/);
  const file = f.route === '/' ? 'pages/index.vue' : ['pages' + f.route + '.vue', 'pages' + f.route + '/index.vue'].find(p => existsSync(path.join(root, p)));
  assert.ok(file && existsSync(path.join(root, file)), 'navi-features:route-page ' + f.route);
  assert.equal(naviFeatureRoute(f.id), f.disposition === 'unsupported' ? null : f.route);
 }
 const id = 'a'.repeat(24);
 assert.equal(naviFeatureRoute('transactions', id), '/transactions/' + id);
 for (const bad of ['../admin', 'https://evil.example', 'a'.repeat(23), id + '?token=x', 5]) assert.equal(naviFeatureRoute('transactions', bad), null, 'navi-features:record-id ' + bad);
 assert.equal(naviFeatureRoute('invoices', id), null, 'navi-features:no-invented-record-page');
 for (const bad of ['https://evil.example', '/admin', 'javascript:alert(1)', 'authentication', 'organization-switch', undefined]) assert.equal(naviFeatureRoute(bad), null, 'navi-features:unknown ' + bad);
 assert.equal(naviFeatureForPath('/transactions/' + id).id, 'transactions');
 assert.equal(naviFeatureForPath('/mapping-draft/' + id + '/3').id, 'mapping-drafts');
 assert.equal(naviFeatureForPath('/invoices?x=1').id, 'invoices');
 assert.equal(naviFeatureForPath('/login'), null);
 assert.ok(findNaviFeatures('請求').some(f => f.id === 'invoices'));
 assert.ok(findNaviFeatures('예산').some(f => f.id === 'budgets'));
 assert.equal(findNaviFeatures('').length, naviFeatures.length);
});

test('company replies carry at most one catalogue pointer and no field changes', () => {
 const reply = { kind: 'unclear', summary: '説明'.repeat(1500), patch: {}, quotes: {} };
 assert.equal(validateCompanyAssistantReply(reply).summary.length, 3000);
 assert.throws(() => validateCompanyAssistantReply({ ...reply, summary: 'x'.repeat(4001) }));
 assert.deepEqual(validateCompanyAssistantReply({ ...reply, navigation: { feature: 'budgets' } }).navigation, { feature: 'budgets' });
 assert.deepEqual(validateCompanyAssistantReply({ ...reply, navigation: { feature: 'transactions', transactionId: 'A'.repeat(24) } }).navigation, { feature: 'transactions', transactionId: 'a'.repeat(24) });
 for (const navigation of [{ feature: 'https://evil.example' }, { feature: 'authentication' }, { feature: 'support-report' }, { feature: 'invoices', transactionId: 'a'.repeat(24) }, { feature: 'transactions', url: '/admin' }, { feature: 'transactions', transactionId: '../x' }, 'invoices', ['invoices']]) assert.throws(() => validateCompanyAssistantReply({ ...reply, navigation }), JSON.stringify(navigation));
 for (const bad of [{ ...reply, kind: 'proposal' }, { ...reply, patch: { notes: 'x' } }, { ...reply, quotes: { notes: 'x' } }, { ...reply, summary: ' ' }]) assert.throws(() => validateCompanyAssistantReply(bad));
 assert.equal(naviFeature('nope'), null);
});

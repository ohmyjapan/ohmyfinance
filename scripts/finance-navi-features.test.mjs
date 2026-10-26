import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { naviFeatures, naviFeature, naviFeatureRoute, naviFeatureForPath, findNaviFeatures, naviRealmFeatures, validateCompanyAssistantReply, validateOwnerNavigation } from '../shared/finance-navi-features.mjs';
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
 assert.deepEqual(naviFeatures.filter(f => f.disposition === 'navi_tool').map(f => f.id).sort(), ['analytics', 'budgets', 'calendar', 'dashboard', 'invoices', 'receipts', 'recurring', 'reports', 'transaction-export', 'transactions']);
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
 assert.equal(naviFeatureRoute('receipts', id), '/receipts/' + id);
 assert.equal(naviFeatureForPath('/receipts/' + id).id, 'receipts');
 assert.equal(naviFeatureForPath('/receipts/upload').id, 'receipt-upload');
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
 assert.deepEqual(validateCompanyAssistantReply({ ...reply, navigation: { feature: 'receipts', receiptId: 'A'.repeat(24) } }).navigation, { feature: 'receipts', receiptId: 'a'.repeat(24) });
 assert.deepEqual(validateOwnerNavigation({feature:'receipts'}),{feature:'receipts'});
 assert.throws(()=>validateOwnerNavigation({feature:'receipts',receiptId:'a'.repeat(24)}),'owner realm remains page-only');
 for(const navigation of [{feature:'transactions',receiptId:'a'.repeat(24)},{feature:'receipts',transactionId:'a'.repeat(24)},{feature:'receipts',receiptId:'../x'},{feature:'receipts',receiptId:'a'.repeat(24),transactionId:'b'.repeat(24)}])assert.throws(()=>validateCompanyAssistantReply({...reply,navigation}),JSON.stringify(navigation));
 for (const navigation of [{ feature: 'https://evil.example' }, { feature: 'authentication' }, { feature: 'support-report' }, { feature: 'invoices', transactionId: 'a'.repeat(24) }, { feature: 'transactions', url: '/admin' }, { feature: 'transactions', transactionId: '../x' }, 'invoices', ['invoices']]) assert.throws(() => validateCompanyAssistantReply({ ...reply, navigation }), JSON.stringify(navigation));
 for (const bad of [{ ...reply, kind: 'proposal' }, { ...reply, patch: { notes: 'x' } }, { ...reply, quotes: { notes: 'x' } }, { ...reply, summary: ' ' }]) assert.throws(() => validateCompanyAssistantReply(bad));
 assert.equal(naviFeature('nope'), null);
});

// Deliberate 2026-10-23 (guidance): five native lanes are not company-scoped. Duplicates and vendors read or change every company's
// rows, import templates are one global list, receipt upload cannot save a company receipt and its links are unchecked, and the
// shipment pages show generated sample rows over an unscoped API. Navi reuses the existing unsupported exit for them in every realm
// and reply schema: no link and no tool; each keeps its route only to name the current page. This guards Navi's links, not the pages.
const nativeDependencies = ['duplicates', 'receipt-upload', 'vendors', 'templates', 'shipments'];
const navReply = { kind: 'unclear', summary: '説明', patch: {}, quotes: {} };
const ownerJobTools = ['list_navi_features', 'get_mapping', 'get_draft', 'save_draft_fields', 'apply_referenced_proposal', 'approve_draft', 'post_selected_approved_rows', 'get_purchase_history', 'get_registered_choices', 'get_research', 'start_purchase_research', 'remember_accounting_fields', 'remember_customer_purpose', 'set_memory_status', 'get_card_sync_status', 'queue_card_sync', 'set_card_auto_sync', 'list_intake_records', 'get_intake_record', 'create_intake_record', 'patch_intake_record', 'set_intake_archived', 'read_intake_sheet', 'preview_intake_import', 'apply_intake_import', 'list_intake_batches', 'list_intake_templates', 'save_intake_template', 'get_intake_research', 'start_intake_research', 'confirm_intake_research', 'list_card_payment_matches', 'get_card_payment_match', 'get_record_payment_matches', 'confirm_card_allocation', 'release_card_allocation', 'reconfirm_card_allocation', 'get_workflow_status', 'review_workflow_step', 'get_evaluation_overview', 'get_evaluation_run'];
const companyCatalogueTools = naviFeatures.flatMap(f => f.tools || []);

test('the five native lanes that are not company-scoped are never returned as a Navi link; their pages are still identified', () => {
 const id = 'a'.repeat(24);
 for (const name of nativeDependencies) {
  const f = naviFeature(name);
  assert.equal(naviFeatureRoute(name), null, 'navi-features:native-dependency-no-link ' + name);
  assert.equal(naviFeatureRoute(name, id), null, 'navi-features:native-dependency-no-record-link ' + name);
  assert.equal(f.disposition, 'unsupported', 'navi-features:native-dependency-unsupported ' + name);
  assert.deepEqual(f.tools || [], [], 'navi-features:native-dependency-no-tool ' + name);
  assert.equal(naviFeatureForPath(f.route)?.id, name, 'navi-features:native-dependency-page-context ' + name);
  assert.ok(findNaviFeatures(f.label).some(x => x.id === name), 'navi-features:native-dependency-still-explained ' + name);
 }
 assert.equal(naviFeatureForPath('/shipment/' + id).id, 'shipments');
});

test('company and owner replies refuse a link to these five, and the model reply schemas cannot name them', async () => {
 const { schemaFor } = await import('../teaching-worker/interpreter.mjs');
 const company = { companyScoped: true, mode: 'workspace', tools: [{ name: 'list_navi_features' }] };
 const schemas = { company: schemaFor(company), research: schemaFor({ ...company, publicResearch: { today: '2026-10-23', registry: 'connection_required', chrome: false } }), owner: schemaFor({ mode: 'workspace', tools: [{ name: 'list_navi_features' }] }) };
 for (const name of nativeDependencies) {
  assert.throws(() => validateCompanyAssistantReply({ ...navReply, navigation: { feature: name } }), /catalogue feature with a page/, 'navi-features:company-link-refused ' + name);
  assert.throws(() => validateOwnerNavigation({ feature: name }), /catalogue feature with a page/, 'navi-features:owner-link-refused ' + name);
  for (const [realm, schema] of Object.entries(schemas)) assert.ok(!schema.properties.navigation.properties.feature.enum.includes(name), 'navi-features:schema-excludes ' + realm + ' ' + name);
 }
 for (const [realm, schema] of Object.entries(schemas)) for (const kept of ['receipts', 'settings', 'organization-settings', 'intake', 'transactions']) assert.ok(schema.properties.navigation.properties.feature.enum.includes(kept), 'navi-features:schema-keeps ' + realm + ' ' + kept);
});

test('the owner realm keeps the five unsupported and offers only the owner tools the job carries', () => {
 for (const available of [[...ownerJobTools, ...companyCatalogueTools], []]) {
  const owner = naviRealmFeatures('owner', available);
  for (const name of nativeDependencies) { const f = owner.find(x => x.id === name); assert.equal(f.disposition, 'unsupported', 'navi-features:owner-native-dependency ' + name); assert.deepEqual(f.tools, [], 'navi-features:owner-native-dependency-no-tool ' + name); }
  for (const f of owner) assert.ok(f.tools.every(n => available.includes(n) && !companyCatalogueTools.includes(n)), 'navi-features:owner-carried-owner-tools-only ' + f.id);
 }
});

test('a company tool feature becomes a page in the owner realm with its full company limits and never the company tools', () => {
 const order = ['receipts', ...naviFeatures.filter(f => f.disposition === 'navi_tool' && f.id !== 'receipts').map(f => f.id)];
 for (const available of [ownerJobTools, []]) {
  const owner = naviRealmFeatures('owner', available);
  for (const id of order) {
   const company = naviFeature(id), f = owner.find(x => x.id === id);
   assert.equal(f.disposition, 'page_handoff', 'navi-features:owner-company-page ' + id); assert.deepEqual(f.tools, [], 'navi-features:owner-no-company-tool ' + id);
   assert.ok(f.reason.includes(company.reason) && f.reason !== company.reason, 'navi-features:owner-keeps-company-limits ' + id);
   assert.equal(naviFeatureRoute(id), company.route); assert.deepEqual(validateOwnerNavigation({ feature: id }), { feature: id });
  }
 }
});

test('saved receipt reads and candidates, company settings and owner intake templates stay available', () => {
 const id = 'a'.repeat(24), receipts = naviFeature('receipts');
 assert.equal(receipts.disposition, 'navi_tool'); assert.deepEqual(receipts.tools, ['list_company_receipts', 'get_company_receipt', 'find_company_receipt_matches'], 'navi-features:receipt-reads-kept');
 assert.equal(naviFeatureRoute('receipts'), '/receipts'); assert.equal(naviFeatureRoute('receipts', id), '/receipts/' + id, 'navi-features:receipt-record-link-kept');
 assert.deepEqual(validateCompanyAssistantReply({ ...navReply, navigation: { feature: 'receipts', receiptId: id } }).navigation, { feature: 'receipts', receiptId: id });
 assert.deepEqual(naviRealmFeatures('company', receipts.tools).find(f => f.id === 'receipts').tools, receipts.tools, 'navi-features:company-receipt-tools');
 for (const name of ['settings', 'organization-settings']) { const f = naviFeature(name); assert.equal(f.disposition, 'page_handoff'); assert.equal(naviFeatureRoute(name), f.route, 'navi-features:company-settings-link ' + name); assert.deepEqual(validateCompanyAssistantReply({ ...navReply, navigation: { feature: name } }).navigation, { feature: name }); assert.deepEqual(validateOwnerNavigation({ feature: name }), { feature: name }); }
 const intake = naviRealmFeatures('owner', ['list_intake_templates', 'save_intake_template']).find(f => f.id === 'intake');
 assert.equal(intake.disposition, 'navi_tool'); assert.deepEqual(intake.tools, ['list_intake_templates', 'save_intake_template'], 'navi-features:owner-intake-templates-kept');
 assert.equal(naviRealmFeatures('owner', []).find(f => f.id === 'intake').disposition, 'page_handoff'); assert.equal(naviFeatureRoute('intake'), '/intake'); assert.deepEqual(validateOwnerNavigation({ feature: 'intake' }), { feature: 'intake' });
});

// Deliberate 2026-10-25 (plan omf-navi-evaluation-reads-20261025): the owner realm maps research-evaluation to its two read tools only
// when the job carries them (the usual intersection); the catalogue entry, the company realm and a job without them keep the page
// handoff with the original reason. The owner reason says reads happen here while editing and running stay on the page.
test('research-evaluation is an owner read-tool feature only for a job that carries the evaluation reads; otherwise the page handoff is kept', () => {
 const reads = ['get_evaluation_overview', 'get_evaluation_run'], catalogue = naviFeature('research-evaluation');
 assert.equal(catalogue.disposition, 'page_handoff', 'navi-features:evaluation-catalogue-page'); assert.deepEqual(catalogue.tools || [], [], 'navi-features:evaluation-catalogue-no-tool');
 const carried = naviRealmFeatures('owner', ownerJobTools).find(f => f.id === 'research-evaluation');
 assert.equal(carried.disposition, 'navi_tool', 'navi-features:evaluation-owner-tool'); assert.deepEqual(carried.tools, reads, 'navi-features:evaluation-owner-tools-exact');
 assert.ok(/読み取/.test(carried.reason) && /画面/.test(carried.reason) && carried.reason !== catalogue.reason, 'navi-features:evaluation-owner-reason-reads-vs-page');
 const partial = naviRealmFeatures('owner', ['get_evaluation_overview']).find(f => f.id === 'research-evaluation');
 assert.deepEqual(partial.tools, ['get_evaluation_overview'], 'navi-features:evaluation-owner-partial-intersection');
 for (const available of [[], ownerJobTools.filter(n => !reads.includes(n))]) { const f = naviRealmFeatures('owner', available).find(x => x.id === 'research-evaluation'); assert.equal(f.disposition, 'page_handoff', 'navi-features:evaluation-owner-page-without-tools'); assert.deepEqual(f.tools, []); assert.equal(f.reason, catalogue.reason, 'navi-features:evaluation-owner-page-reason-kept'); }
 const company = naviRealmFeatures('company', reads.concat(companyCatalogueTools)).find(f => f.id === 'research-evaluation');
 assert.equal(company.disposition, 'page_handoff', 'navi-features:evaluation-company-page'); assert.deepEqual(company.tools, [], 'navi-features:evaluation-company-no-tool');
 assert.equal(naviFeatureRoute('research-evaluation'), '/research-evaluation'); assert.deepEqual(validateOwnerNavigation({ feature: 'research-evaluation' }), { feature: 'research-evaluation' });
});

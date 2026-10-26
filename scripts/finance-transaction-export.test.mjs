// Transaction export contracts: the shared criteria/search module, the Navi tool it feeds and the feature entry. Shared code only:
// no database, model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCriteriaKeys, exportSearchMatches, exportQueryFromCriteria, exportCriteriaFromQuery, exportCriteriaProperties } from '../shared/finance-transaction-export.mjs';
import { companyBusinessTools, businessTool, businessToolMeta, businessWriteNames, refreshKinds, validateBusinessArgs } from '../shared/finance-navi-business.mjs';
import { naviFeature, naviFeatureForPath, naviFeatureRoute, naviRealmFeatures } from '../shared/finance-navi-features.mjs';

const keys = ['status', 'type', 'dateFrom', 'dateTo', 'minAmount', 'maxAmount', 'search', 'hasReceipt', 'customerId', 'supplierId', 'accountCategoryId', 'transactionCategoryId'];
const id24 = c => c.repeat(24);

test('the export search predicate is the transactions page predicate: id, reference, product, invoice, company text and amount digits', () => {
 const row = { _id: 'AbC123', referenceNumber: 'REF-9', productName: 'ノート', invoiceNumber: 'INV-7', companyInfo: 'Synthetic Co', amount: 1234, notes: 'NOTES_ONLY', receiptNumber: 'RCPT_ONLY' };
 for (const q of ['abc1', 'ref-9', 'ノート', 'inv-7', 'synthetic co', '123', '1234']) assert.equal(exportSearchMatches(row, q), true, 'export:search-match ' + q);
 for (const q of ['NOTES_ONLY', 'RCPT_ONLY', 'nope', '12345']) assert.equal(exportSearchMatches(row, q), false, 'export:search-no-match ' + q);
 assert.equal(exportSearchMatches({ id: 'x1', _id: 'y' }, 'X1'), true, 'export:search-id-first');
 assert.equal(exportSearchMatches({ _id: { toString: () => 'OBJ77' } }, 'obj7'), true, 'export:search-object-id');
 assert.equal(exportSearchMatches(row, ''), true, 'export:search-empty-means-all');
 assert.equal(exportSearchMatches({}, 'a'), false);
 assert.equal(exportSearchMatches(null, 'a'), false);
});

test('export criteria are the list route filter set, typed from a query and back to a whitelisted query string map', () => {
 assert.deepEqual([...exportCriteriaKeys], keys, 'export:criteria-keys');
 const criteria = exportCriteriaFromQuery({ format: 'csv', status: 'pending', type: '支出', dateFrom: '2026-10-01', dateTo: ['2026-10-31', 'x'], minAmount: '150', maxAmount: 'abc', search: ' ノート ', hasReceipt: 'true', customerId: id24('a'), organizationId: id24('b'), sourceId: id24('c'), notes: 'x', page: '2' });
 assert.deepEqual(criteria, { status: 'pending', type: '支出', dateFrom: '2026-10-01', dateTo: '2026-10-31', minAmount: 150, search: ' ノート ', hasReceipt: true, customerId: id24('a') }, 'export:criteria-from-query');
 assert.deepEqual(exportCriteriaFromQuery({ hasReceipt: 'false', minAmount: '0', status: '' }), { hasReceipt: false, minAmount: 0 }, 'export:criteria-false-and-zero');
 assert.deepEqual(exportCriteriaFromQuery({ hasReceipt: '1' }), {}, 'export:criteria-has-receipt-literal');
 assert.deepEqual(exportCriteriaFromQuery(undefined), {});
 const query = exportQueryFromCriteria({ ...criteria, organizationId: id24('b'), url: 'https://evil.example', minAmount: 0 }, 'json');
 assert.deepEqual(query, { format: 'json', status: 'pending', type: '支出', dateFrom: '2026-10-01', dateTo: '2026-10-31', minAmount: '0', search: ' ノート ', hasReceipt: 'true', customerId: id24('a') }, 'export:query-whitelist');
 assert.ok(Object.values(query).every(v => typeof v === 'string'), 'export:query-strings');
 assert.deepEqual(exportQueryFromCriteria({ hasReceipt: false }, 'xlsx'), { format: 'csv', hasReceipt: 'false' }, 'export:query-format-whitelist');
 assert.deepEqual(exportQueryFromCriteria(null), { format: 'csv' });
 assert.deepEqual(exportCriteriaFromQuery(exportQueryFromCriteria(criteria, 'csv')), criteria, 'export:round-trip');
});

test('the export criteria schema is strict and finite', () => {
 assert.deepEqual(Object.keys(exportCriteriaProperties), keys, 'export:criteria-schema-keys');
 assert.deepEqual(exportCriteriaProperties.status.enum, ['completed', 'pending', 'processing', 'failed', 'refunded', 'cancelled']);
 assert.deepEqual(exportCriteriaProperties.type.enum, ['支出', '入金']);
 for (const k of ['dateFrom', 'dateTo']) assert.equal(exportCriteriaProperties[k].format, 'date');
 for (const k of ['minAmount', 'maxAmount']) { assert.equal(exportCriteriaProperties[k].type, 'number'); assert.equal(exportCriteriaProperties[k].minimum, 0); }
 assert.equal(exportCriteriaProperties.search.maxLength, 100); assert.equal(exportCriteriaProperties.hasReceipt.type, 'boolean');
 for (const k of ['customerId', 'supplierId', 'accountCategoryId', 'transactionCategoryId']) assert.equal(exportCriteriaProperties[k].pattern, '^[a-fA-F0-9]{24}$');
});

test('prepare_company_transaction_export is a finite business tool: criteria plus format, a prepare effect on an export, no page reload, explicit instruction only', () => {
 const t = businessTool('prepare_company_transaction_export'); assert.ok(t, 'export:tool-carried');
 assert.deepEqual(Object.keys(t.inputSchema.properties), ['format', ...keys], 'export:tool-arguments'); assert.deepEqual(t.inputSchema.required, ['format'], 'export:tool-format-required');
 assert.deepEqual(t.inputSchema.properties.format.enum, ['csv', 'json']); assert.equal(t.inputSchema.additionalProperties, false);
 assert.deepEqual(businessToolMeta.prepare_company_transaction_export, { kind: 'export', effect: 'prepare', idKey: 'exportId' }, 'export:tool-meta');
 assert.ok(businessWriteNames.includes('prepare_company_transaction_export'), 'export:journal-dispatch');
 assert.equal(refreshKinds.prepare_company_transaction_export, undefined, 'export:no-page-reload');
 assert.match(t.description, /explicit instruction in the CURRENT message/, 'export:tool-explicit'); assert.match(t.description, /never holds rows/, 'export:tool-no-rows'); assert.match(t.description, /delivered to the browser/, 'export:tool-delivery');
 assert.equal(companyBusinessTools.filter(x => x.name === t.name).length, 1);
 const good = { format: 'csv', dateFrom: '2025-11-01', dateTo: '2026-10-31', search: 'ノート', hasReceipt: true, minAmount: 0, customerId: id24('a') };
 assert.doesNotThrow(() => validateBusinessArgs(t.inputSchema, good)); assert.doesNotThrow(() => validateBusinessArgs(t.inputSchema, { format: 'json' }));
 for (const bad of [{ ...good, format: 'xlsx' }, { ...good, dateFrom: '2026-02-30' }, { ...good, status: 'open' }, { ...good, minAmount: -1 }, { ...good, search: 'x'.repeat(101) }, { ...good, organizationId: id24('b') }, { ...good, sourceId: id24('c') }, { ...good, hasReceipt: 'true' }, { dateFrom: '2026-01-01' }, { ...good, customerId: 'nope' }, { ...good, criteria: {} }]) assert.throws(() => validateBusinessArgs(t.inputSchema, bad), JSON.stringify(bad).slice(0, 100));
});

test('transaction-export is a company navi_tool feature delivered by the browser, excluded from path lookup and a page in the owner realm', () => {
 const f = naviFeature('transaction-export');
 assert.equal(f.disposition, 'navi_tool', 'export:feature'); assert.deepEqual(f.tools, ['prepare_company_transaction_export'], 'export:feature-tool'); assert.match(f.reason, /ブラウザ/, 'export:feature-browser-delivery'); assert.equal(f.route, '/transactions');
 assert.equal(naviFeatureForPath('/transactions').id, 'transactions', 'export:path-lookup-kept'); assert.equal(naviFeatureRoute('transaction-export'), '/transactions');
 const owner = naviRealmFeatures('owner', ['prepare_company_transaction_export']).find(x => x.id === 'transaction-export');
 assert.equal(owner.disposition, 'page_handoff', 'export:owner-page'); assert.deepEqual(owner.tools, []); assert.ok(owner.reason.includes(f.reason) && owner.reason !== f.reason);
 assert.deepEqual(naviRealmFeatures('company', ['prepare_company_transaction_export']).find(x => x.id === 'transaction-export').tools, ['prepare_company_transaction_export'], 'export:company-tool');
 assert.deepEqual(naviRealmFeatures('company', []).find(x => x.id === 'transaction-export').tools, [], 'export:company-tool-only-when-carried');
});

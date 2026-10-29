// Company business tool contracts, dates, currencies and pages: shared code only, no database, model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { companyBusinessTools, businessTool, businessToolMeta, refreshKinds, validateBusinessArgs, companyNaviPages, companyNaviPage, zonedDayStart, zonedRange, localBusinessDate, recordCurrency, currencyCode, fiscalYearFor, validTimeZone } from '../shared/finance-navi-business.mjs';
import { assistantConversationScope, assistantPage } from '../shared/finance-assistant.mjs';
import { naviFeature } from '../shared/finance-navi-features.mjs';

const writes = ['create_company_transaction', 'delete_company_transaction', 'create_company_invoice', 'delete_company_invoice', 'create_company_calendar_entry', 'delete_company_calendar_entry', 'create_company_budget', 'update_company_budget', 'delete_company_budget', 'create_company_recurring_payment', 'update_company_recurring_payment', 'delete_company_recurring_payment', 'generate_company_recurring_forecast', 'schedule_company_invoice_payment', 'prepare_company_transaction_export', 'link_company_receipt', 'unlink_company_receipt', 'link_company_payment_evidence', 'unlink_company_payment_evidence', 'confirm_company_payment_verification'];
const reads = ['find_company_receipt_matches','get_company_invoice_calendar','get_company_profile', 'get_company_finance_summary', 'list_company_receipts', 'get_company_receipt', 'list_company_budgets', 'get_company_budget', 'list_company_recurring_payments', 'get_company_recurring_payment', 'list_company_conversation_history', 'get_company_conversation_archive', 'get_company_knowledge', 'list_company_payment_evidence', 'get_company_calendar_evidence'];

test('the business catalogue is a finite set of named native adapters, never a generic endpoint', () => {
 assert.deepEqual(companyBusinessTools.map(t => t.name).sort(), [...writes, ...reads].sort(), 'business:catalogue');
 const walk = (schema, where) => { if (schema.type === 'object') { assert.equal(schema.additionalProperties, false, 'business:strict ' + where); for (const [k, v] of Object.entries(schema.properties || {})) walk(v, where + '.' + k); } if (schema.type === 'array') { assert.ok(Number.isSafeInteger(schema.maxItems), 'business:bounded ' + where); walk(schema.items, where + '[]'); } };
 for (const t of companyBusinessTools) { walk(t.inputSchema, t.name); assert.ok(t.description.length > 40); for (const k of Object.keys(t.inputSchema.properties)) assert.ok(!/url|endpoint|path|collection|query$|organization|owner|marker|naviOperation|filter/i.test(k) || k === 'search', 'business:no-generic-argument ' + t.name + '.' + k); }
 for (const name of writes) { const m = businessToolMeta[name]; assert.ok(m && ['create', 'update', 'delete', 'generate', 'prepare'].includes(m.effect), name); assert.ok(['transaction', 'invoice', 'payment', 'budget', 'recurring', 'export', 'receipt'].includes(m.kind)); if (['update', 'delete'].includes(m.effect)) assert.ok(businessTool(name).inputSchema.required.includes('expectedUpdatedAt'), 'business:snapshot-required ' + name); }
 for (const name of reads) assert.equal(businessToolMeta[name].effect, 'read');
 assert.ok(!businessTool('create_company_calendar_entry').inputSchema.properties.bankTransfer, 'business:no-bank-account-write');
 for (const name of ['create_company_calendar_entry', 'create_company_budget', 'create_company_recurring_payment', 'create_company_invoice']) assert.ok(businessTool(name).inputSchema.required.includes('currency'), 'business:currency-explicit ' + name);
 assert.ok(!businessTool('create_company_transaction').inputSchema.properties.currency, 'business:no-unsupported-transaction-currency');
 assert.equal(businessTool('nope'), null);
});

test('arguments are validated against the finite schema, nested objects and arrays included', () => {
 const invoice = businessTool('create_company_invoice').inputSchema;
 const good = { from: { name: 'Issuer', taxId: 'T1234567890123' }, to: { name: 'Client' }, items: [{ description: 'Work', quantity: 2, unitPrice: 50 }], taxRate: 0, currency: 'USD', issueDate: '2026-10-20', dueDate: '2026-11-30' };
 assert.doesNotThrow(() => validateBusinessArgs(invoice, good));
 for (const bad of [{ ...good, organizationId: 'a'.repeat(24) }, { ...good, from: { ...good.from, organizationId: 'x' } }, { ...good, items: [{ ...good.items[0], $set: 1 }] }, { ...good, items: [] }, { ...good, items: Array.from({ length: 101 }, () => good.items[0]) }, { ...good, issueDate: '2026-02-30' }, { ...good, taxRate: '0' }, { ...good, taxRate: 101 }, { ...good, currency: 'yen' }, { ...good, to: {} }, (({ currency, ...rest }) => rest)(good), { ...good, items: [{ description: 'x', quantity: 1, unitPrice: Infinity }] }])
  assert.throws(() => validateBusinessArgs(invoice, bad), JSON.stringify(bad).slice(0, 120));
 const tx = businessTool('create_company_transaction').inputSchema;
 assert.doesNotThrow(() => validateBusinessArgs(tx, { date: '2026-10-20', amount: 0, type: '支出', tags: ['a'], items: [{ productName: 'p', quantity: 1, unitPrice: 0 }] }), 'business:zero-is-valid');
 assert.throws(() => validateBusinessArgs(tx, { date: '2026-10-20', amount: 1, type: 'expense' }), 'business:japanese-type');
 assert.throws(() => validateBusinessArgs(tx, { date: '2026-10-20', amount: 1, type: '支出', naviOperation: {} }));
});

// 2026-10-20 (plan omf-navi-invoice-calendar-20261020): the invoice's one calendar entry is a finite read and an explicit create that
// name only the invoice and its exact read snapshot; the receipt refreshes the calendar and invoice pages.
test('invoice calendar tools take only the invoice id and its exact read snapshot', () => {
 const read = businessTool('get_company_invoice_calendar').inputSchema, write = businessTool('schedule_company_invoice_payment').inputSchema;
 assert.deepEqual(Object.keys(read.properties), ['invoiceId']); assert.deepEqual(read.required, ['invoiceId']);
 assert.deepEqual(Object.keys(write.properties).sort(), ['expectedUpdatedAt', 'invoiceId'], 'invoice-calendar:no-amount-date-status-or-company'); assert.deepEqual(write.required.slice().sort(), ['expectedUpdatedAt', 'invoiceId'], 'invoice-calendar:snapshot-required');
 const good = { invoiceId: 'a'.repeat(24), expectedUpdatedAt: '2026-10-20T00:00:00.000Z' };
 assert.doesNotThrow(() => validateBusinessArgs(write, good));
 for (const bad of [{ ...good, amount: 1 }, { ...good, organizationId: 'b'.repeat(24) }, { ...good, paymentId: 'c'.repeat(24) }, { ...good, invoiceId: 'x' }, { invoiceId: good.invoiceId }, { ...good, invoiceLink: {} }]) assert.throws(() => validateBusinessArgs(write, bad), JSON.stringify(bad));
 assert.deepEqual(businessToolMeta.schedule_company_invoice_payment, { kind: 'payment', effect: 'create', idKey: 'paymentId' }); assert.equal(businessToolMeta.get_company_invoice_calendar.effect, 'read');
 assert.deepEqual(refreshKinds.schedule_company_invoice_payment, ['payment', 'invoice']);
 assert.ok(!businessTool('create_company_calendar_entry').inputSchema.properties.invoiceLink, 'invoice-calendar:manual-create-no-link');
 for (const name of ['invoices', 'calendar']) assert.ok(naviFeature(name).tools.includes('schedule_company_invoice_payment') && naviFeature(name).tools.includes('get_company_invoice_calendar'), 'invoice-calendar:feature ' + name);
 assert.match(businessTool('schedule_company_invoice_payment').description, /never resynced or overwritten/); assert.match(businessTool('get_company_invoice_calendar').description, /never infer a link/);
});

// 2026-10-24 (plan omf-navi-context-truth-20261024, independent review F2): a category budget counts only saved category text, which no
// Navi transaction tool can set; both budget reads say so, so a classification edit is never promised to change budget spending.
test('budget reads explain the category-text matching basis and that Navi transaction tools cannot set it', () => {
 for (const name of ['list_company_budgets', 'get_company_budget']) {
  const d = businessTool(name).description;
  assert.match(d, /saved category text \(category or metadata\.category\)/, 'budget-match:basis ' + name);
  assert.match(d, /registered classification references[^.]*are not used/, 'budget-match:references-not-used ' + name);
  assert.match(d, /Navi transaction tools cannot set or change that text/, 'budget-match:no-navi-setter ' + name);
 }
 // The fact the descriptions state: no Navi transaction create field writes category text (the native edit whitelist has none either).
 for (const name of ['create_company_transaction']) for (const k of ['category', 'metadata']) assert.ok(!businessTool(name).inputSchema.properties[k], 'budget-match:no-navi-setter ' + name + '.' + k);
 assert.deepEqual(Object.keys(businessTool('get_company_budget').inputSchema.properties), ['budgetId'], 'budget-match:read-arguments-unchanged');
 assert.deepEqual(businessToolMeta.list_company_budgets, { kind: 'budget', effect: 'read', idKey: undefined }); assert.equal(businessToolMeta.get_company_budget.effect, 'read');
});

test('company pages are fixed; owner pages keep the separate owner conversation', () => {
 for (const id of ['dashboard', 'transactions', 'invoices', 'calendar', 'receipts', 'budgets', 'recurring', 'analytics', 'reports', 'tax', 'profile', 'settings']) { assert.ok(companyNaviPage(id), 'business:company-page ' + id); assert.ok(naviFeature(companyNaviPage(id).feature), 'business:page-feature ' + id); assert.equal(assistantConversationScope('a', 'A', id).company, true); }
 for (const id of ['mapping', 'draft', 'learning', 'connections', 'intake', 'intake-payments', 'other']) { assert.equal(companyNaviPage(id), null, 'business:owner-page ' + id); assert.equal(assistantConversationScope('a', 'A', id).company, false); }
 assert.equal(assistantPage('/reports/tax'), 'tax'); assert.equal(assistantPage('/budgets'), 'budgets'); assert.equal(assistantPage('/receipts/upload'), 'receipts'); assert.equal(assistantPage('/purchase-workflow'), 'other');
 assert.equal(new Set(companyNaviPages.map(p => p.id)).size, companyNaviPages.length);
});

test('business dates use the saved company time zone with whole local days', () => {
 assert.equal(zonedDayStart('2026-10-20', 'Asia/Tokyo').toISOString(), '2026-10-19T15:00:00.000Z');
 const r = zonedRange('2026-10-20', '2026-10-20', 'Asia/Tokyo'); assert.equal(r.start.toISOString(), '2026-10-19T15:00:00.000Z'); assert.equal(r.end.toISOString(), '2026-10-20T15:00:00.000Z', 'business:end-day-exclusive');
 const dst = zonedRange('2026-03-08', '2026-03-08', 'America/New_York'); assert.equal(dst.end - dst.start, 23 * 3600000, 'business:dst-day');
 assert.equal(localBusinessDate(new Date('2026-10-19T15:30:00Z'), 'Asia/Tokyo'), '2026-10-20', 'business:after-midnight-jst');
 assert.equal(localBusinessDate(new Date('2026-10-19T15:30:00Z'), 'UTC'), '2026-10-19');
 assert.equal(validTimeZone('Not/AZone'), null); assert.equal(validTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
 for (const [from, to] of [['2026-10-21', '2026-10-20'], ['2026-02-30', '2026-03-01'], ['2010-01-01', '2026-12-31']]) assert.throws(() => zonedRange(from, to, 'Asia/Tokyo'), 'business:range ' + from);
 assert.deepEqual(fiscalYearFor('2026-03-31', 4), { startMonth: 4, start: '2025-04-01', end: '2026-03-31' });
 assert.deepEqual(fiscalYearFor('2026-10-20', 4), { startMonth: 4, start: '2026-04-01', end: '2027-03-31' });
 assert.deepEqual(fiscalYearFor('2026-10-20', 1), { startMonth: 1, start: '2026-01-01', end: '2026-12-31' });
 assert.equal(fiscalYearFor('2026-10-20', undefined), null, 'business:fiscal-not-hardcoded');
});

test('a currency is the saved one or explicitly unknown, never assumed', () => {
 assert.deepEqual(recordCurrency({ currency: 'usd', metadata: { currency: 'JPY' } }), { currency: 'USD', evidence: 'saved' });
 assert.deepEqual(recordCurrency({ metadata: { currency: 'JPY' } }), { currency: 'JPY', evidence: 'saved_card_source' });
 assert.deepEqual(recordCurrency({}), { currency: null, evidence: 'not_recorded' });
 assert.deepEqual(recordCurrency({ currency: 'yen' }), { currency: null, evidence: 'unrecognized' });
 assert.equal(currencyCode('JPY'), 'JPY'); assert.equal(currencyCode('XYZ1'), null); assert.equal(currencyCode(undefined), null);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mongoose = require('mongoose');
const h3 = require('h3');
const root = path.resolve(__dirname, '..');
const statuses = ['completed', 'pending', 'processing', 'failed', 'cancelled', 'refunded'];
function load(file, imports) {
  const source = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name); return imports[name];
  }, module, module.exports);
  return module.exports;
}
function handler({ body = {}, update = async (access, id, data) => ({ id, ...data }) } = {}) {
  return load('server/api/transactions/[id]/status.ts', {
    h3: { ...h3, defineEventHandler: handler => handler, getRouterParam: event => event.context.params?.id, readBody: async () => body },
    mongoose,
    '../../../models/Transaction': { TRANSACTION_STATUSES: statuses },
    '../../../services/transactionService': { updateTransaction: update },
    '../../../services/ledgerAccessService': { requireLedgerAccess: async event => event.context.auth },
    '../../../middleware/auth': { requireAuth: event => { if (!event.context.auth) throw h3.createError({ statusCode: 401 }); return event.context.auth; } }
  }).default;
}
const id = '000000000000000000000001';
const event = { method: 'PATCH', context: { auth: { userId: 'synthetic-user', organizationId: 'synthetic-group', role: 'member' }, params: { id } } };

test('transaction status exports a callable default and writes through the existing edit service', async () => {
  const calls = [];
  const route = handler({ body: { status: 'completed', notes: 'Synthetic note', amount: 1, cardAccounting: { forged: true } }, update: async (access, id, data) => { calls.push({ access, id, data }); return { id, ...data }; } });
  assert.equal(typeof route, 'function', 'Nitro requires a default handler');
  const result = await route(event);
  assert.equal(result.success, true); assert.equal(result.transaction.status, 'completed');
  assert.deepEqual(calls, [{ access: event.context.auth, id, data: { status: 'completed', notes: 'Synthetic note' } }]);
});

test('transaction status keeps authentication and method boundaries before writes', async () => {
  let calls = 0; const route = handler({ body: { status: 'completed' }, update: async () => { calls++; } });
  await assert.rejects(route({ ...event, context: { params: { id } } }), error => error.statusCode === 401);
  await assert.rejects(route({ ...event, method: 'GET' }), error => error.statusCode === 405);
  assert.equal(calls, 0);
});

test('transaction status validates input and preserves domain errors', async () => {
  for (const body of [null, [], {}, { status: 'unknown' }, { status: 'completed', notes: {} }]) {
    await assert.rejects(handler({ body })(event), error => error.statusCode === 400);
  }
  await assert.rejects(handler({ body: { status: 'completed' } })({ ...event, context: { ...event.context, params: { id: 'invalid' } } }), error => error.statusCode === 400);
  await assert.rejects(handler({ body: { status: 'completed' }, update: async () => { throw Error(`Transaction ${id} not found`); } })(event), error => error.statusCode === 404);
  const conflict = h3.createError({ statusCode: 409, statusMessage: 'Synthetic protected-source conflict' });
  await assert.rejects(handler({ body: { status: 'completed' }, update: async () => { throw conflict; } })(event), error => error === conflict);
});

test('transaction schema and adapter accept the advertised refunded bookkeeping label', async () => {
  const model = load('server/models/Transaction.ts', { mongoose });
  assert.deepEqual(model.TRANSACTION_STATUSES, statuses);
  for (const status of statuses) {
    const transaction = new model.default({ date: new Date(), amount: 67000, type: 'expense', status });
    await transaction.validate(); assert.equal(transaction.amount, 67000);
    const result = await handler({ body: { status } })(event); assert.equal(result.transaction.status, status);
  }
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mongoose = require('mongoose');
const h3 = require('h3');
const { MongoMemoryServer } = require('mongodb-memory-server');
const root = path.resolve(__dirname, '..');
let mongo, Shipment, service;
function load(file, imports, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(name => {
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name); return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
before(async () => {
  const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined });
  await mongoose.connect(mongo.getUri('shipment_status_regression'));
  const model = load('server/models/Shipment.ts', { mongoose }); Shipment = model.default;
  service = load('server/services/shipmentService.ts', {
    mongoose, h3, '../models/Shipment': model,
    '../models/Transaction': { default: new Proxy({}, { get() { throw Error('Unexpected ledger operation'); } }) },
    '../config/database': { ensureConnection: async () => assert.equal(mongoose.connection.name, 'shipment_status_regression') }
  });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
async function seed(status = 'pending') {
  const organizationId = new mongoose.Types.ObjectId();
  const record = await Shipment.create({ organizationId, status, transactionIds: [new mongoose.Types.ObjectId()], metadata: { preserve: true } });
  return { id: String(record._id), organizationId: String(organizationId) };
}

test('shipment model accepts both stored and existing UI statuses', async () => {
  for (const status of ['pending', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled', 'delayed', 'exception']) {
    const model = new Shipment({ organizationId: new mongoose.Types.ObjectId(), status });
    await model.validate();
  }
});

test('shipment status persists one atomic event without mutating purchase references', async () => {
  const { id, organizationId } = await seed();
  const before = await Shipment.findById(id).lean();
  const result = await service.updateShipmentStatus(id, organizationId, { status: 'shipped', notes: 'Synthetic note', location: 'Tokyo', transactionIds: [], metadata: {} });
  assert.equal(result.status, 'shipped'); assert.equal(result.id, id);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].description, 'Synthetic note');
  assert.equal(result.events[0].location, 'Tokyo');
  assert.deepEqual(result.transactionIds, before.transactionIds); assert.deepEqual(result.metadata, before.metadata);
});

test('shipment mutation and same-status fallback both retain organization scope', async () => {
  const { id } = await seed('delivered'); const stranger = String(new mongoose.Types.ObjectId());
  for (const status of ['shipped', 'delivered']) {
    await assert.rejects(service.updateShipmentStatus(id, stranger, { status }), error => error.statusCode === 404);
  }
  const record = await Shipment.findById(id).lean(); assert.equal(record.status, 'delivered'); assert.equal(record.events.length, 0);
});

test('concurrent desired shipment status creates one event and retries preserve the exact record', async () => {
  const { id, organizationId } = await seed();
  await Promise.all(Array.from({ length: 8 }, () => service.updateShipmentStatus(id, organizationId, { status: 'delivered' })));
  const before = await Shipment.findById(id).lean(); assert.equal(before.events.length, 1);
  await service.updateShipmentStatus(id, organizationId, { status: 'delivered' });
  assert.deepEqual(await Shipment.findById(id).lean(), before);
});

test('a failure after a durable shipment update can be retried without repeating its event', async () => {
  const { id, organizationId } = await seed();
  const original = Shipment.findOneAndUpdate;
  Shipment.findOneAndUpdate = function (...args) {
    const query = original.apply(this, args);
    return { lean: async () => { await query.lean(); throw Error('Synthetic lost response after durable write'); } };
  };
  try {
    await assert.rejects(service.updateShipmentStatus(id, organizationId, { status: 'delivered' }), /Synthetic lost response/);
  } finally { Shipment.findOneAndUpdate = original; }
  await mongoose.disconnect(); await mongoose.connect(mongo.getUri('shipment_status_regression'));
  const result = await service.updateShipmentStatus(id, organizationId, { status: 'delivered' });
  assert.equal(result.events.length, 1); assert.equal(result.status, 'delivered');
});

test('shipment route requires organization and dispatches only POST to persistence', async () => {
  let calls = 0;
  const handler = load('server/api/shipments/[id]/update-status.ts', {
    h3: { ...h3, defineEventHandler: handler => handler, getRouterParam: event => event.context.params.id, readBody: async () => ({ status: 'shipped' }) },
    '../../../services/shipmentService': {
      updateShipmentStatus: async (id, organizationId, body) => { calls++; assert.equal(organizationId, 'synthetic-org'); return { id, status: body.status }; },
      getShipmentById: async (access, id) => { assert.equal(access.organizationId, 'synthetic-org'); return { id, status: 'shipped' }; }
    },
    '../../../services/ledgerAccessService': { requireLedgerAccess: async (event, mode) => { assert.equal(mode, 'write'); if (!event.context.auth) throw h3.createError({ statusCode: 403 }); return event.context.auth; } }
  }).default;
  const event = { method: 'POST', context: { auth: { organizationId: 'synthetic-org' }, params: { id: 'synthetic-id' } } };
  assert.equal((await handler(event)).shipment.status, 'shipped');
  await assert.rejects(handler({ ...event, method: 'GET' }), error => error.statusCode === 405);
  await assert.rejects(handler({ ...event, context: {} }), error => error.statusCode === 403);
  assert.equal(calls, 1);
});

test('shipment store statistics use the existing stats envelope endpoint', async () => {
  const pinia = require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const stats = { total: 3, pending: 2, processing: 1, inTransit: 0, delivered: 0, failed: 0, cancelled: 0 };
  const { useShipmentStore } = load('stores/shipment.ts', { pinia, '~/stores/user': { useUserStore: () => ({ authHeader: { Authorization: 'synthetic' } }) } }, {
    $fetch: async (url, options) => { assert.equal(url, '/api/shipments?stats=true'); assert.equal(options.headers.Authorization, 'synthetic'); return { stats }; },
    useFetch: async () => { throw Error('Missing stats route must not be requested'); }
  });
  const store = useShipmentStore(); await store.fetchStats(); assert.deepEqual(store.stats, stats);
});

const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

module.exports = async ({ db, call, token, other, pass }) => {
  async function organization(access, name) {
    const result = await call('/api/organizations', { token: access, method: 'POST', body: { name } });
    assert.equal(result.status, 200, JSON.stringify(result));
    const id = result.data.organization.id;
    const selected = await call('/api/auth/switch-organization', { token: access, method: 'POST', body: { organizationId: id } });
    assert.equal(selected.status, 200, JSON.stringify(selected));
    return { id: new ObjectId(id), token: selected.data.tokens.accessToken };
  }
  const a = await organization(token, 'Synthetic shipment A'), b = await organization(other, 'Synthetic shipment B');
  const transactionIds = [new ObjectId(), new ObjectId()];
  await db.collection('transactions').insertMany(transactionIds.map((_id, index) => ({ _id, date: new Date('2030-01-01'), amount: 67000 + index, type: 'expense', status: 'completed', cardAccounting: { preserve: true }, timeline: [] })));
  const ledgerBefore = await db.collection('transactions').find({}).toArray();
  const id = new ObjectId(), foreignId = new ObjectId(), siblingId = new ObjectId();
  const initial = { status: 'pending', events: [], transactionIds, trackingNumber: 'SYNTHETIC', metadata: { preserve: true }, createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-01') };
  await db.collection('shipments').insertMany([{ ...initial, _id: id, organizationId: a.id }, { ...initial, _id: foreignId, organizationId: b.id }, { ...initial, _id: siblingId, organizationId: a.id }]);
  const siblingsBefore = await db.collection('shipments').find({ _id: { $ne: id } }).toArray();
  const route = '/api/shipments/' + id + '/update-status';
  const update = (body, access = a.token, url = route) => call(url, { token: access, method: 'POST', body });
  const result = await update({ status: 'processing', notes: 'Synthetic note', location: 'Synthetic location', transactionIds: [], organizationId: String(b.id), notifyCustomer: true });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.shipment.id, String(id));
  const persisted = await db.collection('shipments').findOne({ _id: id });
  assert.equal(persisted.status, 'processing'); assert.equal(persisted.events.length, 1);
  assert.equal(persisted.events[0].description, 'Synthetic note'); assert.equal(persisted.events[0].location, 'Synthetic location');
  assert(persisted.events[0].timestamp instanceof Date);
  assert.deepEqual(persisted.transactionIds, transactionIds); assert.deepEqual(persisted.organizationId, a.id);
  assert.deepEqual(persisted.metadata, initial.metadata);
  pass('status and event persist together while relationship and accounting fields remain unchanged');

  assert.equal((await call(route, { method: 'POST', body: { status: 'pending' } })).status, 401);
  assert.equal((await update({ status: 'pending' }, token)).status, 403);
  assert.equal((await update({ status: 'pending' }, b.token)).status, 404);
  assert.equal((await update({ status: 'pending', organizationId: String(b.id) }, a.token, '/api/shipments/' + foreignId + '/update-status')).status, 404);
  assert.equal((await call(route, { token: a.token, method: 'GET' })).status, 405);
  assert.equal((await update({ status: 'pending' }, a.token, '/api/shipments/' + new ObjectId() + '/update-status')).status, 404);
  pass('authentication, organization and method boundaries preserve foreign and missing shipments');

  for (const body of [null, [], {}, { status: 1 }, { status: 'invented' }, { status: 'pending', notes: {} }, { status: 'pending', location: [] }]) {
    assert.equal((await update(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await update({ status: 'pending' }, a.token, '/api/shipments/invalid/update-status')).status, 400);
  assert.equal((await db.collection('shipments').findOne({ _id: id })).events.length, 1);
  pass('invalid status requests fail without partial status or history changes');

  for (const status of ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled', 'delayed', 'exception', 'pending']) {
    const changed = await update({ status, statusNotes: 'Alternate notes' });
    assert.equal(changed.status, 200, JSON.stringify(changed)); assert.equal(changed.data.shipment.status, status);
    assert.equal(changed.data.shipment.events[0].description, 'Alternate notes');
  }
  pass('all stored and existing UI statuses are accepted without inventing restrictive transitions');

  const beforeRetry = await db.collection('shipments').findOne({ _id: id });
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => update({ status: 'delivered', notes: 'Repeated desired status' })));
  assert(concurrent.every(r => r.status === 200));
  const afterConcurrent = await db.collection('shipments').findOne({ _id: id });
  assert.equal(afterConcurrent.events.length, beforeRetry.events.length + 1);
  assert.equal(afterConcurrent.status, 'delivered');
  await update({ status: 'delivered', notes: 'Lost response retry' });
  assert.deepEqual(await db.collection('shipments').findOne({ _id: id }), afterConcurrent);
  pass('concurrent identical updates and repeated desired status append exactly one event');

  const different = await Promise.all(['processing', 'shipped', 'in_transit'].map(status => update({ status })));
  assert(different.every(r => r.status === 200));
  const afterDifferent = await db.collection('shipments').findOne({ _id: id });
  assert.equal(afterDifferent.events.length, afterConcurrent.events.length + 3);
  assert.equal(afterDifferent.status, afterDifferent.events[0].type);
  assert.deepEqual(new Set(afterDifferent.events.slice(0, 3).map(e => e.type)), new Set(['processing', 'shipped', 'in_transit']));
  assert.deepEqual(await db.collection('transactions').find({}).toArray(), ledgerBefore);
  assert.deepEqual(await db.collection('shipments').find({ _id: { $ne: id } }).toArray(), siblingsBefore);
  pass('competing statuses retain every event and leave sibling shipments and ledger unchanged');
};

const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
module.exports = async ({ db, call, token, pass }) => {
  const group = await require('./helpers/group-session.cjs')(call, token, 'Synthetic status group');
  token = group.token;
  const id = new ObjectId(), normalId = new ObjectId();
  const source = { organizationId: new ObjectId(group.organizationId), date: new Date('2030-01-01'), amount: 67000, type: 'expense', status: 'pending', hasReceipt: false, timeline: [], notes: 'Original', paymentMethod: 'Credit card', cardNumber: '1234', cardAccounting: { preserve: true }, metadata: { preserve: true } };
  await db.collection('transactions').insertMany([{ ...source, _id: id }, { ...source, _id: normalId }]);
  const route = '/api/transactions/' + id + '/status';
  const patch = body => call(route, { method: 'PATCH', token, body });
  const first = await patch({ status: 'completed', notes: 'Synthetic confirmation', amount: 1, cardNumber: '9999', cardAccounting: {} });
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.data.success, true); assert.equal(first.data.transaction.status, 'completed');
  const stored = await db.collection('transactions').findOne({ _id: id });
  assert.equal(stored.notes, 'Synthetic confirmation'); assert.equal(stored.timeline.length, 1);
  for (const key of ['amount', 'type', 'paymentMethod', 'cardNumber', 'cardAccounting', 'metadata', 'hasReceipt']) assert.deepEqual(stored[key], source[key], key);
  pass('status endpoint persists through the existing edit service without changing protected card values');

  const generic = await call('/api/transactions/' + normalId, { method: 'PATCH', token, body: { status: 'completed', notes: 'Synthetic confirmation' } });
  assert.equal(generic.status, 200, JSON.stringify(generic));
  const normal = await db.collection('transactions').findOne({ _id: normalId });
  for (const key of ['status', 'notes', 'amount', 'cardAccounting', 'metadata']) assert.deepEqual(normal[key], stored[key], key);
  assert.equal(normal.timeline[0].type, stored.timeline[0].type);
  assert.equal(normal.timeline[0].description, stored.timeline[0].description);
  // The active edit path supports corrections to prior states; do not resurrect
  // terminal-transition restrictions from the unused array-based handler.
  assert.equal((await patch({ status: 'pending' })).status, 200);
  pass('dedicated status and active generic edits share persistence and correction behavior');

  assert.equal((await call(route, { method: 'PATCH', body: { status: 'completed' } })).status, 401);
  assert.equal((await call(route, { token })).status, 405);
  assert.equal((await call('/api/transactions/' + new ObjectId() + '/status', { token, method: 'PATCH', body: { status: 'completed' } })).status, 404);
  assert.equal((await call('/api/transactions/invalid/status', { token, method: 'PATCH', body: { status: 'completed' } })).status, 400);
  const beforeInvalid = await db.collection('transactions').findOne({ _id: id });
  for (const body of [null, [], {}, { status: 1 }, { status: 'invented' }, { status: 'completed', notes: {} }]) assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await db.collection('transactions').findOne({ _id: id }), beforeInvalid);
  pass('authentication, dispatch and invalid requests preserve the transaction');

  for (const status of ['processing', 'completed', 'failed', 'cancelled', 'refunded', 'pending']) {
    assert.equal((await patch({ status })).status, 200, status);
    assert.equal((await db.collection('transactions').findOne({ _id: id })).status, status);
  }
  const afterLabels = await db.collection('transactions').findOne({ _id: id });
  assert.equal(afterLabels.amount, source.amount); assert.equal(afterLabels.notes, 'Synthetic confirmation');
  assert.deepEqual(afterLabels.cardAccounting, source.cardAccounting);
  pass('all advertised status labels persist as bookkeeping only, without payment effects');

  const count = afterLabels.timeline.length;
  const simultaneous = await Promise.all(['processing', 'completed', 'cancelled'].map(status => patch({ status })));
  assert(simultaneous.every(r => r.status === 200));
  const afterRace = await db.collection('transactions').findOne({ _id: id });
  assert.equal(afterRace.timeline.length, count + 3); assert.equal(afterRace.amount, source.amount);
  assert.deepEqual(await db.collection('transactions').findOne({ _id: normalId }), normal);
  pass('concurrent status edits retain history and leave other transactions unchanged');
};

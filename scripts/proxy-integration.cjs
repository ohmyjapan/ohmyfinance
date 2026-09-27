const assert = require('node:assert/strict');

// Runs only inside finance-integration's disposable database and loopback app.
module.exports = async ({ db, call, token, other, pass }) => {
  const aliases = ['credit-card', 'credit_card', 'payment-gateway', 'payment_gateway', 'overseas', 'overseas_market'];
  await db.collection('transactions').insertOne({ referenceNumber: 'SYNTHETIC-PROXY-PRESERVE', amount: 67000, status: 'completed' });
  const before = await db.collection('transactions').find({}).toArray();
  const body = { amount: 67000, createTransaction: true, cardNumber: 'synthetic-private-input' };
  for (const source of aliases) {
    assert.equal((await call('/api/proxy/' + source, { method: 'POST', body })).status, 401);
  }
  assert.equal((await call('/api/proxy/unknown', { token, method: 'POST', body })).status, 400);
  pass('proxy API preserves authentication and unknown-source errors');

  const attempts = await Promise.all([token, other].flatMap(access => aliases.flatMap(source =>
    [false, true].map(createTransaction => call('/api/proxy/' + source, {
      token: access, method: 'POST', body: { ...body, createTransaction }
    })))));
  for (const attempt of attempts) {
    assert.equal(attempt.status, 501, JSON.stringify(attempt));
    assert.equal(attempt.data.statusMessage, 'Provider integration not implemented');
    assert.equal(attempt.data.success, undefined);
    assert(!JSON.stringify(attempt.data).includes(body.cardNumber));
  }
  assert.deepEqual(await db.collection('transactions').find({}).toArray(), before);
  pass('both users and concurrent provider aliases receive 501 without a ledger change');

  for (const service of ['credit-card', 'payment-gateway', 'shipping']) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const result = await call('/proxy/' + service + '/synthetic?probe=1', {
        method, token, ...(method === 'POST' ? { body } : {})
      });
      assert.equal(result.status, 501, JSON.stringify(result));
    }
    assert.equal((await call('/proxy/' + service + '?probe=1')).status, 501);
  }
  assert.equal((await call('/proxy/unknown/path')).status, 400);
  pass('raw placeholder routes reject before provider dispatch across methods and query strings');

  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal((await call('/api/proxy/credit-card', { token, method: 'POST', body })).status, 501);
  }
  assert.deepEqual(await db.collection('transactions').find({}).toArray(), before);
  assert.equal((await call('/api/health')).status, 200);
  const accounts = await call('/api/finance/accounts', { token });
  assert.equal(accounts.status, 200); assert.equal(accounts.data.accounts.length, 1);
  pass('retries preserve the ledger and normal finance routes remain available');
};

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
module.exports = async ({ db, call, token, other, origin, root, pass }) => {
  const req = createRequire(path.join(root, 'package.json'));
  const group=await require('./helpers/group-session.cjs')(call,token,'Synthetic receipt management group');
  const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic receipt management foreign group');
  token=group.token;other=foreign.token;
  const owner = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).userId;
  const stranger = JSON.parse(Buffer.from(other.split('.')[1], 'base64url')).userId;
  await db.collection('transactions').insertOne({ referenceNumber: 'SYNTHETIC-PROTECTED', date: new Date('2030-01-01'), amount: 987654, type: 'expense', status: 'completed', cardAccounting: { test: 'preserve' }, timeline: [] });
  const ledgerBefore = await db.collection('transactions').find({}).toArray();
  const create = (filename, access = token, extra = {}) => call('/api/receipts', { method: 'POST', token: access, body: { filename, originalFilename: filename, size: 12, merchant: 'Synthetic receipt', ...extra } });
  const first = await create('synthetic-receipt-a.pdf', token, { uploadedBy: stranger });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await create('synthetic-receipt-b.pdf', other);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const a = first.data, b = second.data;
  assert.equal(a.uploadedBy, owner); assert.equal(b.uploadedBy, stranger);
  assert.equal(typeof a.id, 'string'); assert.equal(a._id, a.id);
  assert.equal(new Date(a.uploadDate).toISOString(), a.uploadDate);
  pass('selected groups own new receipts; uploader comes from the session');

  for (const [route, method] of [['/api/receipts', 'GET'], ['/api/receipts?stats=true', 'GET'], ['/api/receipts/export', 'GET'], ['/api/receipts/' + a.id, 'GET'], ['/api/receipts/' + a.id, 'PATCH'], ['/api/receipts/' + a.id, 'DELETE'], ['/api/receipts/upload', 'POST']]) {
    assert.equal((await call(route, { method, ...(method === 'PATCH' ? { body: { notes: 'No access' } } : {}) })).status, 401, route + ' ' + method);
  }
  pass('receipt management endpoints require authentication');

  const list = await call('/api/receipts', { token });
  assert.equal(list.status, 200); assert.equal(list.data.total, 1);
  assert.deepEqual(list.data.receipts.map(r => r.id), [a.id]);
  assert.equal((await call('/api/receipts?stats=true', { token })).data.stats.total, 1);
  const exported = await call('/api/receipts/export?format=json', { token });
  assert.equal(exported.status, 200); assert(JSON.stringify(exported.data).includes(a.id));
  assert(!JSON.stringify(exported.data).includes(b.id));
  const ts = req('typescript'), pinia = req('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const storeSource = await fs.readFile(path.join(root, 'stores/receipt.ts'), 'utf8');
  const compiled = ts.transpileModule(storeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '$fetch', compiled)(name => {
    if (name === 'pinia') return pinia;
    if (name === '~/stores/user') return { useUserStore: () => ({ authHeader: { Authorization: 'Bearer ' + token } }) };
    throw Error('Unexpected receipt store dependency: ' + name);
  }, module, module.exports, req('ofetch').ofetch.create({ baseURL: origin, retry: 0 }));
  const store = module.exports.useReceiptStore();
  await store.fetchReceipts(); assert.equal(store.error, null);
  assert.deepEqual(store.receipts.map(r => r.id), [a.id]);
  pass('list, statistics and export include only receipts in the selected group');

  const route = '/api/receipts/' + a.id;
  assert.equal((await call(route, { token })).data.id, a.id);
  const storedBefore = await db.collection('receipts').findOne({ filename: a.filename });
  const patch = await call(route, { token, method: 'PATCH', body: {
    amount: 0, taxRate: 0, notes: 'Verified edit', receiptDate: '2026-09-01T00:00:00.000Z',
    extractedData: { date: '2026-09-01T00:00:00.000Z', items: [{ description: 'Synthetic item', totalPrice: 0 }] },
    uploadedBy: stranger, filename: 'changed.pdf', filePath: 'forged', status: 'matched', transactionId: b.id,
    $set: { uploadedBy: stranger }
  } });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.notes, 'Verified edit'); assert.equal(patch.data.amount, 0); assert.equal(patch.data.taxRate, 0);
  assert.equal(patch.data.extractedData.date, '2026-09-01T00:00:00.000Z');
  const storedAfter = await db.collection('receipts').findOne({ _id: storedBefore._id });
  for (const key of ['uploadedBy', 'filename', 'filePath', 'status', 'transactionId', 'uploadDate']) assert.deepEqual(storedAfter[key], storedBefore[key], key);
  assert.equal((await call(route, { token })).data.notes, 'Verified edit');
  await store.fetchReceiptById(a.id);
  await store.updateReceipt(a.id, { notes: 'Verified edit', taxRate: 0 });
  assert.equal(store.error, null); assert.equal(store.currentReceipt.notes, 'Verified edit');
  assert.equal(store.receipts[0].taxRate, 0);
  pass('PATCH persists metadata and zero values while preserving source, ownership and matching fields');

  for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call(route, { token: other, method, ...(method === 'PATCH' ? { body: { notes: 'Foreign edit' } } : {}) })).status, 404);
  for (const [suffix, method, body] of [['/matches', 'GET'], ['/match', 'POST', { transactionId: b.id }], ['/match', 'DELETE']]) {
    assert.equal((await call(route + suffix, { token: other, method, body })).status, 404);
  }
  const auto = await call('/api/receipts/auto-match', { token: other, method: 'POST', body: {} });
  assert.equal(auto.status, 200, JSON.stringify(auto.data)); assert.equal(auto.data.processed, 1);
  assert.equal((await call(route, { token })).data.notes, 'Verified edit');
  pass('another group cannot read, edit, delete or start matching this receipt; auto-match input is scoped');

  assert.equal((await call('/api/receipts/not-an-object-id', { token })).status, 400);
  assert.equal((await call(route, { token, method: 'PUT', body: {} })).status, 405);
  assert.equal((await call(route, { token, method: 'PATCH', body: [] })).status, 400);
  const updates = await Promise.all(['Concurrent one', 'Concurrent two'].map(notes => call(route, { token, method: 'PATCH', body: { notes } })));
  assert(updates.every(r => r.status === 200));
  assert(['Concurrent one', 'Concurrent two'].includes((await call(route, { token })).data.notes));
  pass('invalid routes and bodies fail explicitly; legitimate concurrent edits still succeed');

  const deletes = await Promise.all([call(route, { token, method: 'DELETE' }), call(route, { token, method: 'DELETE' })]);
  assert.deepEqual(deletes.map(r => r.status).sort(), [200, 404]);
  assert.equal((await call(route, { token })).status, 404);
  assert.equal((await call('/api/receipts/' + b.id, { token: other })).status, 200);
  pass('DELETE removes exactly the selected group record and retry cannot remove another record');

  const savedPaths = [];
  try {
    const form = new FormData(); form.append('file', new Blob(['Synthetic receipt document'], { type: 'application/pdf' }), 'synthetic.pdf');
    const uploaded = await store.uploadReceipt(form);
    assert.equal(store.error, null); assert(uploaded, 'Receipt store upload must return a receipt');
    assert.equal(store.receipts[0].id, uploaded.id);
    const stored = await db.collection('receipts').findOne({ filename: uploaded.filename });
    assert(stored); const savedPath = stored.filePath; savedPaths.push(savedPath);
    assert.equal(String(stored.uploadedBy), owner); assert.equal(stored.amount, null); assert.equal(stored.merchant, null);
    assert.equal(uploaded.id, String(stored._id)); assert.equal(uploaded.uploadDate, stored.uploadDate.toISOString());
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'Synthetic receipt document');
    await store.fetchReceiptById(uploaded.id);
    assert.equal(await store.deleteReceipt(uploaded.id), true);
    assert.equal(store.currentReceipt, null); assert(!store.receipts.some(r => r.id === uploaded.id));
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'Synthetic receipt document');
    const concurrent = await Promise.all(['First simultaneous original', 'Second simultaneous original'].map(async text => {
      const form = new FormData(); form.append('file', new Blob([text], { type: 'application/pdf' }), 'same-name.pdf');
      const response = await fetch(origin + '/api/receipts/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form, signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (result.receipt) {
        const row = await db.collection('receipts').findOne({ filename: result.receipt.filename });
        if (row?.filePath) savedPaths.push(row.filePath);
      }
      return { status: response.status, result, text };
    }));
    assert(concurrent.every(r => r.status === 200), JSON.stringify(concurrent));
    assert.notEqual(concurrent[0].result.receipt.filename, concurrent[1].result.receipt.filename);
    for (const r of concurrent) {
      const row = await db.collection('receipts').findOne({ filename: r.result.receipt.filename });
      assert.equal(await fs.readFile(row.filePath, 'utf8'), r.text);
    }
    pass('the real Pinia receipt store lists, edits, uploads and deletes correctly; originals are retained');
  } finally {
    for (const savedPath of new Set(savedPaths)) {
      const allowed = path.resolve(root, 'server/data/receipts') + path.sep;
      assert(path.resolve(savedPath).startsWith(allowed));
      await fs.unlink(savedPath);
    }
  }
  assert.deepEqual(await db.collection('transactions').find({}).toArray(), ledgerBefore);
  pass('receipt management leaves the financial ledger unchanged');
};

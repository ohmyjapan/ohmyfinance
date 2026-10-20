// Runs only inside finance-company-business-integration.cjs's owned disposable database and native app.
const assert = require('node:assert/strict');

module.exports = async ({ db, ObjectId, A, B, tokenA, tokenB, job, act, actOk, turn, finish, ok, worker, members, pass }) => {
  const receipts = db.collection('receipts'), transactions = db.collection('transactions');
  const receiptIds = Array.from({ length: 4 }, () => new ObjectId());
  const now = new Date('2026-02-12T12:00:00Z');
  const receipt = (i, organizationId, amount = 67000) => ({
    _id: receiptIds[i], ...(organizationId ? { organizationId } : {}),
    filename: 'candidate-' + i + '.pdf', originalFilename: 'PRIVATE_CANDIDATE_FILE', size: 10,
    uploadDate: now, receiptDate: now, merchant: 'Synthetic Issey shop', amount, currency: 'JPY', status: 'unmatched',
    filePath: 'PRIVATE_CANDIDATE_PATH', metadata: { secret: 'PRIVATE_CANDIDATE_METADATA' },
    extractedData: { rawText: 'PRIVATE_CANDIDATE_RAW', items: [{ description: 'Saved receipt item', quantity: 1, totalPrice: amount }] }
  });
  const tx = (organizationId, productName, extra = {}) => ({
    _id: new ObjectId(), ...(organizationId ? { organizationId } : {}), referenceNumber: 'CANDIDATE-' + productName,
    date: now, amount: 67000, type: '支出', status: 'completed', productName, hasReceipt: false,
    metadata: { currency: 'JPY', secret: 'PRIVATE_TX_METADATA' }, createdAt: now, updatedAt: now, ...extra
  });
  const candidates = [
    tx(A, 'Online order', { cardNumber: '6944', cardAccounting: { accountName: 'クレジットカード', subAccountName: 'Amex 6944' } }),
    tx(A, 'Offline purchase', { date: new Date('2026-02-11T12:00:00Z') }),
    tx(A, 'Different currency', { metadata: { currency: 'USD', secret: 'PRIVATE_TX_METADATA' } }),
    tx(A, 'Unknown currency', { metadata: {} })
  ];
  const excluded = [
    tx(A, 'OUTSIDE_AMOUNT', { amount: 77051 }), tx(A, 'OUTSIDE_DATE', { date: new Date('2026-02-27T12:00:00Z') }),
    tx(A, 'ALREADY_LINKED', { receipt: { receiptId: new ObjectId() } }),
    tx(null, 'PRIVATE_UNASSIGNED_CANDIDATE'), tx(String(A), 'PRIVATE_STRING_COMPANY_CANDIDATE'),
    ...Array.from({ length: 25 }, (_, i) => tx(B, 'PRIVATE_FOREIGN_CANDIDATE_' + i, { date: new Date('2026-02-13T12:00:00Z') }))
  ];
  const seeded = [...candidates, ...excluded];
  await receipts.insertMany([receipt(0, A), receipt(1, B), receipt(2, null), receipt(3, A, 9999999)]);
  await transactions.insertMany(seeded);
  const snapshot = async () => JSON.stringify(await Promise.all(['receipts', 'transactions', 'invoices', 'payments', 'budgets', 'recurringpayments', 'financecompanyknowledges'].map(n => db.collection(n).find().sort({ _id: 1 }).toArray())));
  const before = await snapshot();
  try {
    let r = await act(job, 'find_company_receipt_matches', { receiptId: String(receiptIds[0]) });
    assert.equal(r.status, 200, 'receipt-navi:available ' + r.raw.slice(0, 300));
    const result = r.data.result;
    assert.equal(r.data.effect, 'read');
    assert.deepEqual(result.scope, { actorId: job.context.scope.actorId, organizationId: String(A) });
    assert.equal(result.receipt.extracted.items[0].description, 'Saved receipt item');
    const native = await ok('/api/receipts/' + receiptIds[0] + '/matches', tokenA);
    assert.deepEqual(result.matches.map(m => m.transaction.id), native.matches.map(m => m.transactionId), 'receipt-navi:ranking-parity');
    assert.deepEqual(new Set(result.matches.map(m => m.transaction.id)), new Set(candidates.map(t => String(t._id))), 'receipt-navi:company-and-native-filters');
    assert.deepEqual(result.matches.map(m => m.heuristicScore), native.matches.map(m => m.confidence), 'receipt-navi:score-parity');
    assert.deepEqual(result.matches.map(m => m.factors), native.matches.map(m => m.matchFactors));
    assert.equal(result.matches.length, 4, 'receipt-navi:ambiguity-preserved');
    const match = id => result.matches.find(m => m.transaction.id === String(id)).transaction;
    assert.equal(match(candidates[0]._id).currency, 'JPY', 'receipt-navi:card-currency');
    assert.equal(match(candidates[0]._id).currencyEvidence, 'saved_card_source');
    assert.equal(match(candidates[0]._id).cardAccounting.subAccountName, 'Amex 6944');
    assert.equal(match(candidates[2]._id).currency, 'USD', 'receipt-navi:distinct-currency');
    assert.equal(match(candidates[3]._id).currency, null, 'receipt-navi:unknown-currency');
    assert.equal(result.meaning, 'heuristic_candidates_not_verified_links_or_probability');
    assert.equal(result.search.exhaustive, false, 'receipt-navi:bounded-not-exhaustive');
    for (const secret of ['PRIVATE_', 'OUTSIDE_', 'ALREADY_LINKED']) assert.ok(!r.raw.includes(secret), 'receipt-navi:private-fields ' + secret);
    pass('receipt candidates preserve native ranking and ambiguity, actual card/unknown currency and whitelisted saved evidence');

    for (const id of [receiptIds[1], receiptIds[2], new ObjectId()]) assert.equal((await act(job, 'find_company_receipt_matches', { receiptId: String(id) })).status, 404, 'receipt-navi:receipt-company');
    for (const args of [{}, { receiptId: 'invalid' }, { receiptId: String(receiptIds[0]), organizationId: String(B) }]) assert.equal((await act(job, 'find_company_receipt_matches', args)).status, 400, 'receipt-navi:arguments');
    const empty = await actOk(job, 'find_company_receipt_matches', { receiptId: String(receiptIds[3]) });
    assert.deepEqual(empty.result.matches, [], 'receipt-navi:empty');
    assert.equal(empty.result.meaning, result.meaning);
    const stale = await worker('workspace/' + job.id + '/actions', { lease: 'stale-lease', name: 'find_company_receipt_matches', args: { receiptId: String(receiptIds[0]) } });
    assert.equal(stale.status, 409, 'receipt-navi:lease');
    await db.collection('organizations').updateOne({ _id: A }, { $set: { members: [] } });
    assert.equal((await act(job, 'find_company_receipt_matches', { receiptId: String(receiptIds[0]) })).status, 403, 'receipt-navi:revoked');
    await db.collection('organizations').updateOne({ _id: A }, { $set: { members } });
    const parallel = await Promise.all(Array.from({ length: 6 }, () => act(job, 'find_company_receipt_matches', { receiptId: String(receiptIds[0]) })));
    for (const response of parallel) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.data.result.matches.map(m => m.transaction.id), result.matches.map(m => m.transaction.id), 'receipt-navi:parallel');
    }
    assert.equal(await snapshot(), before, 'receipt-navi:no-domain-writes');
    assert.deepEqual((await actOk(job, 'get_company_action_status')).result.receipts, [], 'receipt-navi:no-write-journal');
    pass('receipt candidate reads enforce existing arguments, company, membership and lease, including parallel reads with zero domain writes');
    await finish(job);

    const otherJob = await turn(tokenB, 'Compare my saved receipt', { page: 'receipts' });
    const other = await actOk(otherJob, 'find_company_receipt_matches', { receiptId: String(receiptIds[1]) });
    assert.equal(other.result.matches.length, 10, 'receipt-navi:bounded');
    const foreignIds = new Set(excluded.filter(t => String(t.organizationId) === String(B)).map(t => String(t._id)));
    assert.ok(other.result.matches.every(m => foreignIds.has(m.transaction.id)), 'receipt-navi:switch-company');
    assert.equal((await act(otherJob, 'find_company_receipt_matches', { receiptId: String(receiptIds[0]) })).status, 404);
    await finish(otherJob);
    assert.equal(await snapshot(), before, 'receipt-navi:switch-no-writes');
    pass('separate company conversation sees only its own capped candidates after company switch');
  } finally {
    await db.collection('organizations').updateOne({ _id: A }, { $set: { members } });
    await receipts.deleteMany({ _id: { $in: receiptIds } });
    await transactions.deleteMany({ _id: { $in: seeded.map(t => t._id) } });
  }
};

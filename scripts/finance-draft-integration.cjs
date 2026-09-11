// Synthetic fixtures only. Invoked by finance-integration.cjs against its isolated database.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ObjectId } = require('mongodb');

module.exports = async function draftChecks({ db, call, request, upload, token, other, deviceToken, origin, pass, root, csv, row, pause }) {
  const oid = () => new ObjectId();
  const refs = { customer: oid(), otherCustomer: oid(), account: oid(), sub: oid(), unrelated: oid(), category: oid(), tax: oid(), supplier: oid(), source: oid() };
  await db.collection('customers').insertMany([{ _id: refs.customer, name: 'DRAFT-A-Synthetic', isActive: true }, { _id: refs.otherCustomer, name: 'DRAFT-B-Synthetic', isActive: true }]);
  await db.collection('accountcategories').insertMany([{ _id: refs.account, name: 'Synthetic expense', type: 'expense', isActive: true }, { _id: refs.sub, name: 'Synthetic subcategory', parentId: refs.account, type: 'expense', isActive: true }, { _id: refs.unrelated, name: 'Different account', type: 'expense', isActive: true }]);
  await db.collection('transactioncategories').insertOne({ _id: refs.category, name: 'Synthetic classification' });
  await db.collection('taxcategories').insertOne({ _id: refs.tax, name: 'Synthetic input tax', rate: 8 });
  await db.collection('suppliers').insertOne({ _id: refs.supplier, name: 'Draft shop', companyInfo: 'Synthetic supplier information', invoiceNumber: 'T0000000000000' });
  await db.collection('datasources').insertOne({ _id: refs.source, name: 'Synthetic source', type: 'synthetic-draft', isActive: true, config: { token: 'synthetic-secret-must-never-be-returned' } });
  const imported = await upload(csv([row({ 0: '2026/08/10', 1: '2026/08/12', 2: 'Draft shop', 5: '2160' }), row({ 0: '2026/08/11', 1: '2026/08/13', 2: 'Draft shop', 5: '2160' }), row({ 0: '2026/08/12', 1: '2026/08/14', 2: 'Draft shop', 5: '2160' }), row({ 0: '2026/08/13', 1: '2026/08/15', 2: '前回分口座振替金額', 5: '-2160' })]));
  assert.equal(imported.status, 200);
  const batchId = imported.data.id, batch = await db.collection('financeimports').findOne({ _id: new ObjectId(batchId) });
  const preview = { version: 1, sourceHash: batch.hash, preparedAt: new Date().toISOString(), rows: batch.rows.map((r, i) => ({ line: r.line, key: r.key, purpose: i === 3 ? 'repayment' : 'customer', clientCode: i === 3 ? '' : i === 2 ? 'DRAFT-B' : 'DRAFT-A', clientName: i === 3 ? '' : 'Synthetic customer', category: '', reason: 'Synthetic source evidence', source: { sheet: 'synthetic', rows: [20 + i], client: i === 3 ? '' : 'Synthetic customer', category: '', card: 'Synthetic account' } })) };
  await db.collection('financeimports').updateOne({ _id: batch._id }, { $set: { mappingPreview: preview } });
  const endpoint = `imports/${batchId}/drafts/2`, get = async (line = 2) => request(`imports/${batchId}/drafts/${line}`, undefined, 'GET');
  const saveBody = (d, values = d.values, confirm = false, remember = []) => ({ revision: d.revision, key: d.key, sourceHash: d.sourceHash, values, confirm, remember });
  const save = (d, values, confirm = false, remember = []) => request(endpoint, saveBody(d, values, confirm, remember), 'PUT');
  let d = (await get()).data;
  const countBefore = await db.collection('transactions').countDocuments(), entriesBefore = await db.collection('financeentries').countDocuments();
  assert.equal(d.revision, 0); assert.equal(d.values.customerId, String(refs.customer)); assert.equal(d.values.date, '2026-08-12');
  assert.equal(d.values.accountCategoryId, ''); assert.equal(d.values.transactionCategoryId, ''); assert.equal(d.values.taxRate, null);
  assert.equal(d.values.supplierId, String(refs.supplier)); assert.equal(d.values.invoiceNumber, 'T0000000000000');
  assert.equal(d.source.cardLast4, '2345'); assert.equal(d.evidence.customerId.source, 'spreadsheet');
  assert.equal(JSON.stringify(d).includes('synthetic-secret'), false); assert.equal(d.references.sources[0].config, undefined);
  assert.equal((await call('/api/finance/' + endpoint, { token: other })).status, 404);
  assert.equal((await call('/api/finance/' + endpoint, { token: deviceToken })).status, 401);
  assert.equal((await call('/api/finance/' + endpoint)).status, 401);
  assert.equal(await db.collection('financedrafts').countDocuments(), 0);
  pass('full draft proposals resolve only exact references, retain processing/purchase dates, protect source credentials and do not write on read');

  assert.equal((await save(d, { ...d.values, amount: 1 })).status, 400);
  assert.equal((await save(d, { ...d.values, cardNumber: '9999' })).status, 400);
  assert.equal((await save(d, { ...d.values, customerId: String(oid()) })).status, 400);
  assert.equal((await save(d, { ...d.values, date: '2026-02-30' })).status, 400);
  assert.equal((await save(d, { ...d.values, purpose: 'company' })).status, 400);
  assert.equal((await save(d, d.values, true)).status, 400);
  assert.equal((await request(endpoint, { ...saveBody(d), sourceHash: 'changed' }, 'PUT')).status, 409);
  const full = { ...d.values, date: '2026-08-12', status: 'completed', referenceNumber: 'SYNTHETIC-REFERENCE', accountCategoryId: String(refs.account), subAccountCategoryId: String(refs.sub), transactionCategoryId: String(refs.category), taxCategoryId: String(refs.tax), taxRate: 8, companyInfo: 'Reviewed synthetic company', invoiceNumber: 'T1111111111111', receiptNumber: 'ORDER-SYNTHETIC', trackingNumber: 'TRACK-SYNTHETIC', productName: 'Synthetic product', productPrice: 2160, janCode: '0000000000000', sourceId: String(refs.source), notes: 'Reviewed purchase notes', tags: ['synthetic', 'draft'], items: [{ productName: 'Synthetic item', janCode: '1111111111111', productUrl: 'https://example.invalid/item', quantity: 2, unitPrice: 1080, taxCategoryId: String(refs.tax), taxRate: 8 }] };
  assert.equal((await save(d, { ...full, accountCategoryId: String(refs.unrelated) })).status, 400);
  assert.equal((await save(d, { ...full, taxRate: 10 })).status, 400);
  assert.equal((await save(d, { ...full, items: [{ ...full.items[0], productUrl: 'javascript:alert(1)' }] })).status, 400);
  let result = await save(d, full); assert.equal(result.status, 200, JSON.stringify(result)); d = result.data;
  assert.deepEqual(d.values, full); assert.equal(d.revision, 1); assert.equal(d.approvedAt, null);
  assert.equal((await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import' }] })).status, 409);
  assert.equal((await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import', draftRevision: d.revision }] })).status, 409);
  const concurrent = await Promise.all([save(d, { ...full, notes: 'Concurrent first' }), save(d, { ...full, notes: 'Concurrent second' })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  d = (await get()).data; assert.equal(d.revision, 2); assert.ok(d.history[0].changes.some(c => c.field === 'notes'));
  assert.equal(await db.collection('transactions').countDocuments(), countBefore);
  assert.equal(await db.collection('financeentries').countDocuments(), entriesBefore);
  assert.deepEqual((await db.collection('financeimports').findOne({ _id: batch._id })).rows, batch.rows);
  pass('complete editable fields round-trip without ledger writes; validation, source binding, stale saves and concurrent saves are enforced');

  const pdf = Buffer.from('%PDF-1.4\n% Synthetic test document only\n%%EOF');
  async function attach(current, kind = 'receipt', name = 'synthetic.pdf', useToken = token, bytes = pdf) {
    const query = new URLSearchParams({ revision: String(current.revision), key: current.key, sourceHash: current.sourceHash, kind, name });
    const response = await fetch(`${origin}/api/finance/${endpoint}/documents?${query}`, { method: 'POST', headers: { Authorization: 'Bearer ' + useToken, 'Content-Type': 'application/pdf' }, body: bytes });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await attach(d, 'receipt', '../escape.pdf')).status, 400);
  assert.equal((await attach(d, 'receipt', 'synthetic.pdf', other)).status, 404);
  assert.equal((await attach(d, 'receipt', 'synthetic.pdf', token, Buffer.from('<html>'))).status, 415);
  result = await attach(d); assert.equal(result.status, 200, JSON.stringify(result)); d = result.data;
  const doc = d.documents[0]; assert.equal(d.approvedAt, null); assert.equal(doc.kind, 'receipt');
  const downloaded = await fetch(origin + doc.url, { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
  assert.equal((await call(doc.url, { token: other })).status, 404); assert.equal((await call(doc.url)).status, 401);
  const learned = ['accountCategoryId', 'subAccountCategoryId', 'transactionCategoryId', 'taxCategoryId', 'taxRate', 'companyInfo'];
  assert.equal((await save(d, d.values, true, ['customerId'])).status, 400);
  result = await request(endpoint, { ...saveBody(d, d.values, true, learned), documentEvidence: { receiptNumber: doc.id, items: doc.id } }, 'PUT');
  assert.equal(result.status, 200, JSON.stringify(result)); d = result.data; assert.ok(d.approvedAt); assert.equal(d.evidence.receiptNumber.documentId, doc.id);
  assert.equal((await request(endpoint + '/documents/' + doc.id, saveBody(d), 'DELETE')).status, 409);
  const next = (await get(3)).data, differentCustomer = (await get(4)).data;
  assert.equal(next.values.accountCategoryId, String(refs.account)); assert.equal(next.evidence.accountCategoryId.source, 'learned'); assert.equal(next.evidence.accountCategoryId.state, 'suggested');
  assert.equal(next.values.receiptNumber, ''); assert.equal(next.values.trackingNumber, ''); assert.equal(next.values.invoiceNumber, 'T0000000000000');
  assert.equal(differentCustomer.values.accountCategoryId, ''); assert.equal(differentCustomer.values.customerId, String(refs.otherCustomer));
  const repayment = (await get(5)).data;
  assert.equal((await request(`imports/${batchId}/drafts/5`, saveBody(repayment), 'PUT')).status, 400);
  pass('private attachments retain exact bytes and field evidence; only explicitly approved stable decisions are learned within account, merchant, purpose and customer scope');

  // A saved correction must survive subsequent reference/rule changes.
  result = await request(`imports/${batchId}/drafts/3`, saveBody(next, { ...next.values, notes: 'Independent correction', accountCategoryId: String(refs.unrelated), subAccountCategoryId: '' }), 'PUT');
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal((await get(3)).data.values.accountCategoryId, String(refs.unrelated));
  assert.ok((await get(3)).data.suggestions.some(s => s.field === 'accountCategoryId' && s.value === String(refs.account)));
  const revise = await save(d, { ...d.values, notes: 'Final evidence checked' }, true, learned); assert.equal(revise.status, 200); d = revise.data;
  assert.equal((await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import', draftRevision: d.revision - 1 }] })).status, 409);
  result = await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import', draftRevision: d.revision }] });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.posted, 1);
  const entry = await db.collection('financeentries').findOne({ importId: batch._id, line: 2 });
  const transaction = await db.collection('transactions').findOne({ _id: entry.transactionId });
  for (const [key, value] of Object.entries(d.values)) {
    if (key === 'purpose') { assert.equal(transaction.metadata.mappingPurpose, value); continue; }
    if (key === 'date') { assert.equal(transaction.date.toISOString().slice(0, 10), value); continue; }
    if (key === 'items') { assert.deepEqual(JSON.parse(JSON.stringify(transaction.items)), value); continue; }
    if (key === 'tags') { for (const tag of value) assert.ok(transaction.tags.includes(tag)); continue; }
    if (key.endsWith('Id')) { assert.equal(String(transaction[key]), value); continue; }
    assert.deepEqual(transaction[key], value, key);
  }
  assert.equal(transaction.amount, 2160); assert.equal(transaction.type, '支出'); assert.equal(transaction.cardNumber, '2345');
  assert.equal(transaction.hasReceipt, true); assert.equal(transaction.receiptFilePath, doc.url); assert.equal(transaction.attachments[0].path, doc.url);
  assert.equal(transaction.metadata.financeDraftRevision, d.revision); assert.equal(transaction.metadata.mappingEvidence.receiptNumber.documentId, doc.id);
  assert.equal(entry.draftSnapshot.revision, d.revision); assert.equal((await get()).data.locked, true);
  assert.equal((await save(d, d.values)).status, 409); assert.equal((await attach(d)).status, 409);
  const retry = await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import', draftRevision: d.revision }] });
  assert.equal(retry.status, 200); assert.equal(retry.data.posted, 0);
  assert.equal(await db.collection('transactions').countDocuments(), countBefore + 1);
  // Simulate interruption after reserving the approved snapshot, before the transaction write.
  await db.collection('financeentries').updateOne({ _id: entry._id }, { $set: { state: 'reserved' } });
  await db.collection('transactions').deleteOne({ _id: transaction._id });
  const resume = await request(`imports/${batchId}/commit`, { decisions: [{ line: 2, action: 'import', draftRevision: d.revision }] });
  assert.equal(resume.status, 200, JSON.stringify(resume));
  const resumed = await db.collection('transactions').findOne({ _id: transaction._id });
  assert.equal(resumed.notes, transaction.notes); assert.deepEqual(resumed.attachments, transaction.attachments);
  assert.deepEqual(resumed.metadata, transaction.metadata); assert.equal(await db.collection('transactions').countDocuments(), countBefore + 1);
  pass('posting carries every transaction field and receipt through an immutable snapshot; retries and interrupted posting preserve identity without duplicate transactions');

  const createReference = await request(`imports/${batchId}/references`, { field: 'transactionCategoryId', name: 'New synthetic classification' });
  assert.equal(createReference.status, 200); assert.ok(createReference.data.references.transactionCategories.some(v => v._id === createReference.data.id));
  assert.equal((await call(`/api/finance/imports/${batchId}/references`, { method: 'POST', token: other, body: { field: 'customerId', name: 'Forbidden' } })).status, 404);
  assert.equal((await request(`imports/${batchId}/references`, { field: 'sourceId', name: 'Unsupported' })).status, 400);
  const legacyId = oid();
  await db.collection('transactions').insertOne({ _id: legacyId, date: new Date('2026-08-14'), amount: 2160, type: '支出', status: 'completed', cardNumber: '2345', notes: 'Synthetic historical value' });
  const legacyDraft = (await get(4)).data; assert.equal(legacyDraft.review.state, 'legacy_review');
  assert.equal((await request(`imports/${batchId}/commit`, { decisions: [{ line: 4, action: 'import', draftRevision: 0 }] })).status, 409);
  result = await request(`imports/${batchId}/commit`, { decisions: [{ line: 4, action: 'link', transactionId: String(legacyId) }] });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.linked, 1);
  assert.equal((await db.collection('transactions').findOne({ _id: legacyId })).notes, 'Synthetic historical value');
  assert.deepEqual((await db.collection('financeimports').findOne({ _id: batch._id })).rows, batch.rows);
  pass('reference creation is scoped and historical matches include processing dates; linking preserves existing accounting values and immutable CSV rows');

  if (process.env.OMF_TEST_CHROME_PORT) {
    const { createRequire } = require('node:module');
    const browser = await createRequire(path.join(root, 'collector/package.json'))('rebrowser-puppeteer-core').connect({ browserURL: 'http://127.0.0.1:' + Number(process.env.OMF_TEST_CHROME_PORT), defaultViewport: null });
    let page;
    try {
      page = await browser.newPage(); await page.bringToFront(); await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const browserErrors = []; page.on('pageerror', e => browserErrors.push(e.message));
      await page.goto(`${origin}/mapping-draft/${batchId}/3`, { waitUntil: 'networkidle2' });
      const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (await page.evaluate(fn)) return; await pause(100); } throw Error('Draft browser condition timed out'); };
      await waitFor(() => !!document.querySelector('#draft-trackingNumber'));
      assert.equal(await page.evaluate(() => innerWidth), 390);
      assert.equal(await page.evaluate(() => matchMedia('(min-width: 768px)').matches), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const key of ['purpose','customerId','accountCategoryId','subAccountCategoryId','transactionCategoryId','taxCategoryId','taxRate','date','status','referenceNumber','sourceId','supplierId','companyInfo','invoiceNumber','receiptNumber','trackingNumber','productName','productPrice','janCode','notes','tags']) assert.equal(await page.evaluate(id => !!document.getElementById(id), 'draft-' + key), true, key);
      await page.evaluate(() => document.querySelector('#draft-trackingNumber').focus()); await page.keyboard.type('CHROME-SYNTHETIC-TRACKING');
      await page.evaluate(() => document.querySelector('[data-action="save-draft"]').click());
      await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('下書きを保存しました'));
      await page.reload({ waitUntil: 'networkidle2' }); await waitFor(() => !!document.querySelector('#draft-trackingNumber'));
      assert.equal(await page.evaluate(() => document.querySelector('#draft-trackingNumber').value), 'CHROME-SYNTHETIC-TRACKING');
      assert.equal(await page.evaluate(() => document.querySelector('[data-action="prepare-post"]').disabled), true);
      if (process.env.OMF_TEST_SCREENSHOT) {
        const cdp = await page.createCDPSession();
        assert.equal((await cdp.send('Page.getLayoutMetrics')).cssLayoutViewport.clientWidth, 390);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
        require('node:fs').writeFileSync(process.env.OMF_TEST_SCREENSHOT.replace('.png', '-draft-mobile.png'), Buffer.from(shot.data, 'base64'));
        await cdp.detach();
      }
      await page.setViewport({ width: 1440, height: 1000 });
      // Changing mobile emulation reloads Chrome; wait for the draft fetch after that reload.
      await waitFor(() => !!document.querySelector('#draft-trackingNumber'));
      assert.equal(await page.evaluate(() => innerWidth), 1440);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const light = await page.evaluate(() => ({ title: getComputedStyle(document.querySelector('main h1')).color, surface: getComputedStyle(document.querySelector('main .card')).backgroundColor }));
      assert.equal(light.surface, 'rgb(255, 255, 255)');
      await page.evaluate(() => document.querySelector('header.sticky button.p-1').click()); await waitFor(() => document.documentElement.classList.contains('dark'));
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('main .card')).backgroundColor), light.surface);
      await page.evaluate(() => document.querySelector('header.sticky button.p-1').click()); await waitFor(() => !document.documentElement.classList.contains('dark'));
      if (process.env.OMF_TEST_SCREENSHOT) await page.screenshot({ path: process.env.OMF_TEST_SCREENSHOT.replace('.png', '-draft-desktop.png'), fullPage: true });
      await page.goto(`${origin}/transactions/${transaction._id}`, { waitUntil: 'networkidle2' });
      await waitFor(() => document.querySelector('main')?.textContent.includes('synthetic.pdf'));
      assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
      pass('real Chrome: all draft controls, save/reload, posting gate, private attachment display and mobile/desktop light/dark layouts work');
    } finally { if (page) await page.close(); await browser.disconnect(); }
  }
};

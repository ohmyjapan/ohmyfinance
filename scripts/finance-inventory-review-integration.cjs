const assert = require('node:assert/strict'), { ObjectId } = require('mongodb'), crypto = require('node:crypto'), path = require('node:path');
module.exports = async ({ db, call, request, token, other, origin, pass, root, csv, row }) => {
 const { validateInventoryPacket } = await import('../shared/finance-inventory-review.mjs');
 const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const endpoint = '/api/finance-inventory-review';
 const account = (await request('accounts', { name: 'Inventory review synthetic card', primaryCard: '87654', cardIdentifiers: ['87654'], otpRecipient: 'inventory@example.invalid', otpMailbox: 'inventory@example.invalid' })).data.account;
 const imported = await call('/api/finance/accounts/' + account._id + '/imports?kind=statement&start=2026-08-01&end=2026-08-31', { token, method: 'POST', raw: true, body: csv(Array.from({ length: 8 }, (_, i) => row({ 0: '2026/08/' + String(i + 1).padStart(2, '0'), 1: '2026/08/' + String(i + 2).padStart(2, '0'), 2: i === 3 ? 'Different inventory merchant' : 'Synthetic inventory shop', 4: '87654', 5: String(5000 + i) }))) });
 assert.equal(imported.status, 200); const batchId = imported.data.id, batch = await db.collection('financeimports').findOne({ _id: new ObjectId(batchId) });
 const collection = db.collection('financeinventorymatches');
 const packet = { version: 1, productName: 'Synthetic cotton shirt', strength: 'strong', explanation: 'Synthetic item price and shipping are estimates; inventory identity requires review.', capturedAt: '2026-09-01T00:00:00Z', itemTotal: 4500, shipping: 500, items: [{ stockId: 'SYNTHETIC-STOCK', productName: 'Cotton shirt', productCode: 'SYN-A', option: 'Blue / M', assignedDate: '2026/08/04', knownPrice: '', sheetRow: 12 }], sources: [{ label: 'Synthetic public catalog', url: 'https://example.invalid/catalog', note: 'Published price; actual receipt missing.' }] };
 validateInventoryPacket(packet);
 assert.throws(() => validateInventoryPacket({ ...packet, sources: [{ label: 'Bad', note: '', url: 'javascript:alert(1)' }] }));
 for (const source of batch.rows) { const p = structuredClone(packet); p.items[0].stockId += source.line; if (source.line === 4) p.items[0].productCode = 'SYN-B'; if (source.line === 9) p.shipping = null; await collection.insertOne({ ownerId: batch.ownerId, accountId: batch.accountId, importId: batch._id, line: source.line, key: source.key, sourceHash: batch.hash, merchant: source.description.toLowerCase(), packet: p, packetHash: hash(p), revision: 0, history: [], createdAt: new Date(), updatedAt: new Date() }); }
 const getResponse = line => call(endpoint + '?imports=' + batchId + (line ? '&line=' + line : ''), { token });
 const get = async line => { const r = await getResponse(line); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.rows[0]; };
 const body = (r, status = 'accepted', extra = {}) => ({ importId: r.importId, line: r.line, key: r.key, sourceHash: r.sourceHash, draftRevision: r.draftRevision, contextKey: r.contextKey, revision: r.revision, packetHash: r.packetHash, status, productName: '', note: '', ...extra });
 const save = (r, status, extra) => call(endpoint, { token, method: 'POST', body: body(r, status, extra) });
 const draftRoute = line => 'imports/' + batchId + '/drafts/' + line;
 const getDraft = async line => (await request(draftRoute(line), undefined, 'GET')).data;
 const saveDraft = d => request(draftRoute(d.line), { revision: d.revision, key: d.key, sourceHash: d.sourceHash, values: d.values, remember: [], confirm: false }, 'PUT');
 const protectedState = async () => { const state = {}; for (const n of ['financedrafts', 'financeimports', 'financeentries', 'financedocuments', 'transactions']) state[n] = hash(await db.collection(n).find({}).sort({ _id: 1 }).toArray()); return state; };
 const before = await protectedState();
 assert.equal((await call(endpoint + '?imports=' + batchId)).status, 401);
 assert.equal((await call(endpoint + '?imports=' + batchId, { token: other })).status, 404);
 assert.equal((await call(endpoint + '?imports=' + batchId + '&line=bad', { token })).status, 400);
 assert.equal((await getResponse()).data.rows.length, 8); assert.equal((await get(9)).calculation.total, null); assert.equal((await get(9)).calculation.difference, null);
 assert.deepEqual(await protectedState(), before);
 pass('inventory evidence previews enforce ownership, reject unsafe sources and preserve unknown shipping without writing drafts');
 let r = await get(2); assert.equal(r.source.cardLast4, '7654'); assert.equal(r.draftRevision, 0);
 assert.equal((await call(endpoint, { token: other, method: 'POST', body: body(r) })).status, 404);
 assert.equal((await save(r, 'corrected', { productName: 'New item' })).status, 400);
 assert.equal((await save(r, 'rejected')).status, 400);
 assert.equal((await save(r, 'accepted', { values: { taxRate: 10 } })).status, 400);
 assert.equal((await save(r, 'accepted', { contextKey: 'stale' })).status, 409);
 assert.equal((await save(r, 'accepted', { packetHash: 'stale' })).status, 409);
 const result = await save(r, 'accepted'); assert.equal(result.status, 200, JSON.stringify(result));
 let saved = await get(2); assert.equal(saved.decision.productName, packet.productName); assert.equal(saved.history.length, 1); assert.equal(saved.revision, 1);
 assert.equal((await save(r, 'accepted')).status, 409); assert.equal((await get(2)).history.length, 1);
 assert.equal((await get(3)).learning.length, 1); assert.equal((await get(4)).learning.length, 0); assert.equal((await get(5)).learning.length, 0);
 assert.deepEqual(await protectedState(), before);
 pass('item confirmation persists history without changing accounting; stale versions and unrelated fields are rejected, learning requires matching merchant and model');
 assert.equal((await save(saved, 'corrected', { productName: 'Synthetic linen shirt', note: 'Buyer confirmed the linen variant.' })).status, 200);
 saved = await get(2); assert.equal(saved.history.length, 2); assert.equal(saved.history[0].before.productName, packet.productName); assert.equal((await get(3)).learning[0].productName, 'Synthetic linen shirt');
 assert.equal((await save(saved, 'rejected', { note: 'This inventory entry belongs to another order.' })).status, 200);
 assert.equal((await get(3)).learning[0].status, 'rejected');
 assert.equal((await save(await get(2), 'pending')).status, 200); assert.equal((await get(3)).learning.length, 0);
 const target = await get(6), concurrent = await Promise.all([save(target, 'accepted'), save(target, 'accepted')]);
 assert.equal(concurrent.filter(r => r.status === 200).length, 1, JSON.stringify(concurrent)); assert.ok(concurrent.every(r => [200, 409].includes(r.status))); assert.equal((await get(6)).history.length, 1);
 assert.deepEqual(await protectedState(), before);
 pass('corrections, rejections and returning to pending update reusable evidence; concurrent decisions add exactly one history entry');
 const stale = await get(7), d = await getDraft(7); d.values.notes = 'Independent draft edit'; assert.equal((await saveDraft(d)).status, 200); assert.equal((await save(stale, 'accepted')).status, 409);
 const changed = await getDraft(6); changed.values.purpose = 'company'; assert.equal((await saveDraft(changed)).status, 200); assert.equal((await get(6)).contextChanged, true); assert.equal((await get(3)).learning.length, 0);
 const record = await collection.findOne({ importId: batch._id, line: 3 }); await collection.updateOne({ _id: record._id }, { $set: { 'packet.productName': 'Tampered' } }); assert.equal((await getResponse(3)).status, 409); await collection.updateOne({ _id: record._id }, { $set: { packet: record.packet } });
 const reserved = new ObjectId(); await db.collection('financeentries').insertOne({ _id: reserved, ownerId: batch.ownerId, accountId: batch.accountId, importId: batch._id, line: 7, key: batch.rows[5].key, transactionId: new ObjectId(), state: 'reserved' }); assert.equal((await save(await get(7), 'accepted')).status, 409); await db.collection('financeentries').deleteOne({ _id: reserved });
 pass('draft revisions, changed customer context, altered evidence and reserved ledger rows invalidate stale review actions');
 if (process.env.OMF_TEST_CHROME_PORT) {
  const browser = await require('node:module').createRequire(path.join(root, 'collector/package.json'))('rebrowser-puppeteer-core').connect({ browserURL: 'http://127.0.0.1:' + Number(process.env.OMF_TEST_CHROME_PORT), defaultViewport: null }); let page;
  try {
   page = await browser.newPage(); page.on('dialog', dialog => dialog.accept()); const errors = []; page.on('pageerror', e => errors.push(e.message));
   await page.setViewport({ width: 390, height: 844 }); await page.goto(origin + '/mapping-draft/' + batchId + '/8', { waitUntil: 'networkidle2' });
   if (new URL(page.url()).pathname === '/login') { await page.type('#email', 'finance-a@example.invalid'); await page.type('#password', 'Synthetic-password-Only1!'); await page.click('button[type="submit"]'); await page.waitForFunction(() => location.pathname !== '/login'); await page.goto(origin + '/mapping-draft/' + batchId + '/8', { waitUntil: 'networkidle2' }); }
   await page.waitForSelector('[data-inventory-detail]'); assert.equal(await page.$eval('[data-save-inventory-decision]', b => b.disabled), true);
   const old = await getDraft(8); await page.click('[data-inventory-choice="accepted"]'); await page.click('[data-save-inventory-decision]'); await page.waitForSelector('[data-use-inventory-name]'); assert.deepEqual((await getDraft(8)).values, old.values);
   await page.click('[data-use-inventory-name]'); assert.equal(await page.$eval('[data-save-inventory-decision]', b => b.disabled), true); assert.deepEqual((await getDraft(8)).values, old.values);
   const buttons = await page.$$('button'); for (const b of buttons) { if ((await b.evaluate(e => e.textContent.trim())) === '下書きを保存') { await b.click(); break; } }
   await page.waitForFunction(() => document.querySelector('[data-inventory-choice="accepted"]')?.matches(':enabled') === true);
   assert.equal((await getDraft(8)).values.productName, packet.productName); assert.equal((await getDraft(8)).values.productPrice, old.values.productPrice); assert.equal((await getDraft(8)).values.taxRate, old.values.taxRate);
   await page.click('[data-inventory-choice="corrected"]'); await page.$eval('[data-inventory-product]', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); await page.type('[data-inventory-product]', 'Corrected synthetic shirt'); await page.type('[data-inventory-note]', 'The buyer identified the correct item.'); await page.click('[data-save-inventory-decision]'); await page.waitForFunction(() => document.querySelector('[data-inventory-decision]')?.textContent.includes('Corrected synthetic shirt'));
   await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('[data-inventory-decision]'); assert.ok((await page.$eval('[data-inventory-decision]', e => e.textContent)).includes('Corrected synthetic shirt'));
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.$eval('[data-inventory-review]', e => e.scrollIntoView()); if (process.env.OMF_TEST_SCREENSHOT) await page.screenshot({ path: process.env.OMF_TEST_SCREENSHOT, captureBeyondViewport: false });
   await page.goto(origin + '/mapping?import=' + batchId, { waitUntil: 'networkidle2' }); await page.waitForSelector('[data-inventory-link]'); assert.equal(await page.$$eval('[data-inventory-link]', nodes => nodes.length), 8); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
   pass('real Chrome mobile confirms and corrects, applies only the name through an explicit draft save, persists reloads and renders mapping links without overflow');
  } finally { if (page) await page.close(); await browser.disconnect(); }
 }
 for (const line of [2, 3, 4, 5, 6, 7, 8, 9]) { const d = await getDraft(line); assert.equal(d.approvedAt, null); assert.equal(d.values.taxRate, null); assert.equal(d.values.invoiceNumber, ''); }
 assert.equal(hash((await db.collection('financeimports').findOne({ _id: batch._id })).rows), hash(batch.rows));
 for (const n of ['financeentries', 'financedocuments', 'transactions']) assert.equal((await protectedState())[n], before[n]);
 pass('inventory review preserves original statement rows, tax, invoice, approvals and ledger entries');
};

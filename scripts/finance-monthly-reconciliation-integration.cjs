'use strict';
// Plan omf-monthly-reconciliation-20261020: the dedicated harness for the four monthly-reconciliation repairs.
// It owns its MongoMemoryServer and the built app (.output/server/index.mjs) on a random 127.0.0.1 port, drives only the
// real HTTP API with two synthetic owners (monthly-a/b@example.invalid) and hidden real Chrome through collector/browser.mjs.
// It never reads MONGO_URI or a production database, contacts no bank, mail, Slack or model, and does not touch the shared
// finance-integration harness. Run it ONLY through the hub verifier fixture scripts/zoomer-fixtures/omf-monthly-reconciliation.mjs.
// Groups F3 → F2 → F4 → F1 run independently: a failure is printed as `FAIL <group>: <tag> …` and the next group still runs,
// so each finding's before/after behaviour is recorded on its own. OMF_TEST_MONTHLY_LEGS limits the groups;
// OMF_TEST_MONTHLY_MUTANT=1 skips the browser legs (mutant runs); OMF_TEST_MONTHLY_SCREENSHOTS saves UI captures.
// The one database seed outside the API is F1's legacy record: the pre-fix reader no longer exists in the changed code, so the
// harness writes the record exactly as the released import wrote it (default SheetJS display text → mappedRows → planImport).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const GROUPS = (process.env.OMF_TEST_MONTHLY_LEGS || 'F3,F2,F4,F1').split(',').map(s => s.trim()).filter(Boolean);
const MUTANT = process.env.OMF_TEST_MONTHLY_MUTANT === '1';
const SHOTS = process.env.OMF_TEST_MONTHLY_SCREENSHOTS || '';
const PASSWORD = 'Synthetic-password-Only1!';
const pause = ms => new Promise(r => setTimeout(r, ms));
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const uuid = () => crypto.randomUUID();
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function mongoBinary() { for (let dir = root; ; dir = path.dirname(dir)) { const p = path.join(dir, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'); if (fs.existsSync(p)) return p; if (path.dirname(dir) === dir) return null; } }

const results = {};
async function group(name, fn) {
  if (!GROUPS.includes(name)) return;
  const r = results[name] = results[name] || { pass: true, checks: 0, failures: [] };
  try { await fn(label => { r.checks++; console.log('PASS ' + name + ': ' + label); }); }
  catch (error) { r.pass = false; const text = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 1500); r.failures.push(text); console.log('FAIL ' + name + ': ' + text); }
}

async function main() {
  let mongo, child, client, directory, logs = '';
  try {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-monthly-test-'));
    const binary = mongoBinary();
    mongo = await MongoMemoryServer.create({ binary: binary ? { systemBinary: binary, version: '8.2.1' } : undefined });
    const uri = mongo.getUri('finance_monthly'), port = await availablePort(), origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, MONGODB_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: crypto.randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-15000); });
    let healthy = false;
    for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected) { assert.equal(d.database.name, 'finance_monthly'); healthy = true; break; } } catch {} await pause(200); }
    assert.ok(healthy, 'SETUP: isolated app health: ' + logs.slice(-2000));
    client = await MongoClient.connect(uri); const db = client.db('finance_monthly');
    console.log('SETUP owned MongoMemoryServer finance_monthly and built app on ' + origin);

    async function call(route, { method = 'GET', token, body, type } = {}) {
      const raw = Buffer.isBuffer(body), headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': type || (raw ? 'text/csv' : 'application/json') }) };
      const response = await fetch(origin + route, { method, headers, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
      const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data };
    }
    const ok = (r, tag) => { assert.equal(r.status, 200, tag + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
    const register = async email => ok(await call('/api/auth/register', { method: 'POST', body: { email, password: PASSWORD, name: 'Monthly test' } }), 'SETUP:register').tokens.accessToken;
    const token = await register('monthly-a@example.invalid'), other = await register('monthly-b@example.invalid');
    const pay = (r, opts = {}) => call('/api/finance-payments/' + r, { token, ...opts }), intake = (r, opts = {}) => call('/api/finance-intake/' + r, { token, ...opts });
    const createRecord = async (values, t = token) => ok(await call('/api/finance-intake/records', { method: 'POST', token: t, body: { values: { service: 'OWN', account: 'DEMO', currency: 'JPY', ...values } } }), 'SETUP:intake-create');
    const amex = ok(await call('/api/finance/accounts', { method: 'POST', token, body: { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345', '23456'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }), 'SETUP:amex-account').account;
    const { HEADERS } = await import(pathToFileURL(path.join(root, 'shared/amex.mjs')).href);
    const amexCsv = rows => Buffer.from([HEADERS, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
    const amexRow = (c = {}) => Object.assign(['2026/08/01', '2026/08/03', 'Synthetic shop', 'Test user', '12345', '1234', '', ''], c);
    const csv = (head, rows) => Buffer.from([head, ...rows].map(r => r.map(s => '"' + String(s).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
    const BANK_HEAD = ['取引日', '摘要', '出金', '入金', '残高', 'メモ'];
    async function bankAccount(name, currency = 'JPY') { return ok(await pay('bank/accounts', { method: 'POST', body: { name, currency } }), 'SETUP:bank-account').account.id; }
    async function bankImport(accountId, bytes, name, type = 'text/csv') {
      const doc = ok(await pay('bank/files?name=' + encodeURIComponent(name), { method: 'POST', body: bytes, type }), 'SETUP:bank-upload').document, sheet = ok(await pay('bank/files/' + doc.id + '/sheet'), 'SETUP:bank-sheet');
      return ok(await pay('bank/files/' + doc.id + '/import', { method: 'POST', body: { sheet: sheet.sheet, headerRow: sheet.headerRow, mapping: sheet.mapping, bankAccountId: accountId, transactionIdConfirmed: true, confirm: true } }), 'SETUP:bank-import');
    }
    const payments = async (query = '', t = token) => ok(await call('/api/finance-payments/payments' + query, { token: t }), 'list').payments;
    const findPayment = async (description, query = '') => { const p = (await payments(query)).find(x => x.description === description); assert.ok(p, 'payment ' + description + ' listed'); return p; };
    const view = async p => ok(await pay(p.endpoint), 'view ' + p.description);
    const allocate = async (p, target, amount, extra = {}) => { const v = await view(p); return pay(p.endpoint + '/allocations', { method: 'POST', body: { confirm: true, requestId: uuid(), paymentRevision: v.payment.paymentRevision, target, amount, ...extra } }); };
    const allocateRecord = async (p, record, amount) => { const fresh = ok(await intake('records/' + record.id), 'record'); return ok(await allocate(p, { kind: 'intake', recordId: record.id }, amount, { recordRevision: fresh.revision }), 'allocate ' + p.description); };
    const releaseAll = async (p, action = 'release') => { let v = await view(p); for (const a of v.allocations.filter(a => a.status === 'linked')) { v = ok(await pay(p.endpoint + '/allocations/' + a.id, { method: 'PUT', body: { confirm: true, action, paymentRevision: v.payment.paymentRevision, recordRevision: a.record?.revision } }), action + ' ' + p.description); } return v; };
    const ui = {};

    // ── F3 — a card repayment row derives its list state from the bank side ───────────────────────────────────────────
    await group('F3', async pass => {
      const card = ok(await call('/api/finance/accounts/' + amex._id + '/imports?kind=statement&start=2026-07-19&end=2026-08-18', { method: 'POST', token, body: amexCsv([amexRow({ 2: 'F3 card purchase', 5: '30000' }), amexRow({ 0: '2026/08/10', 1: '2026/08/10', 2: '前回分口座振替金額', 5: '-30000' })]) }), 'monthly:f3-card-import');
      assert.ok(card.id, 'monthly:f3-card-import');
      const bank = await bankAccount('F3 bank'), usd = await bankAccount('F3 USD bank', 'USD'), idBank = await bankAccount('F3 id bank');
      await bankImport(bank, csv(BANK_HEAD, [['2026/08/10', 'AMEX PART 1', '10000', '', '', ''], ['2026/08/11', 'AMEX PART 2', '20000', '', '', ''], ['2026/08/12', 'AMEX EXTRA', '5000', '', '', '']]), 'f3-bank.csv');
      await bankImport(usd, csv(BANK_HEAD, [['2026/08/10', 'USD AMEX', '30000', '', '', '']]), 'f3-usd.csv');
      await bankImport(idBank, csv(['取引日', '摘要', '金額', '取引番号'], [['2026/08/10', 'AMEX SETTLE', '30000', 'TX-F3-0001']]), 'f3-id-1.csv');
      const repayment = async (query = '') => { const p = (await payments(query)).find(x => x.sourceKind === 'repayment' && x.description === '前回分口座振替金額' && x.importId === card.id); assert.ok(p, 'monthly:f3-repayment-listed'); return p; };
      let r = await repayment();
      assert.deepEqual([r.state, r.remaining], ['unmatched', -30000], 'monthly:f3-before-unmatched');
      pass('the unsettled Amex repayment row lists 未照合 with its full amount remaining');
      const purchase = await createRecord({ orderId: 'F3-PURCHASE', description: 'F3 card purchase', amount: '30000', purchaseDate: '2026-08-01' });
      await allocateRecord(await findPayment('F3 card purchase'), purchase, 30000);
      const totals = async () => ok(await pay('records/' + purchase.id), 'record totals').totals;
      const before = await totals(); assert.deepEqual([before.paid, before.state], [30000, 'settled'], 'monthly:f3-purchase-settled');
      const target = { kind: 'card-repayment', accountId: r.accountId, importId: r.importId, line: r.line, key: r.key }, note = 'Owner checked the Amex repayment manually (synthetic)';
      ok(await allocate(await findPayment('AMEX PART 1'), target, 10000, { note }), 'monthly:f3-part-one');
      r = await repayment();
      assert.deepEqual([r.state, r.remaining, r.settled], ['partial', -20000, -10000], 'monthly:f3-partial');
      assert.equal(r.allocated, 0, 'monthly:f3-no-card-allocation');
      pass('one partial bank settlement turns the row 一部配分 with 20,000 remaining; the card row itself carries no allocation');
      ok(await allocate(await findPayment('AMEX PART 2'), target, 20000, { note }), 'monthly:f3-part-two');
      r = await repayment(); assert.deepEqual([r.state, r.remaining], ['matched', 0], 'monthly:f3-matched');
      const detail = ok(await pay(r.endpoint), 'monthly:f3-detail');
      assert.equal(detail.payment.state, 'matched', 'monthly:f3-detail-state'); assert.equal(detail.settledBy.length, 2, 'monthly:f3-detail-settled-by');
      assert.ok((await payments('?state=matched')).some(p => p.paymentKey === r.paymentKey), 'monthly:f3-state-filter');
      pass('two linked bank settlements make the row 照合済み in the list, the detail and the state filter');
      ok(await allocate(await findPayment('AMEX EXTRA'), target, 5000, { note }), 'monthly:f3-extra');
      r = await repayment(); assert.deepEqual([r.state, r.remaining], ['review', 5000], 'monthly:f3-excess-review');
      const after = await totals(); assert.deepEqual([after.paid, after.net, after.state], [30000, 30000, 'settled'], 'monthly:f3-no-double-count');
      pass('an excessive settlement is 要確認 and stays visible; the purchase cost is not counted twice');
      await releaseAll(await findPayment('AMEX EXTRA'));
      r = await repayment(); assert.equal(r.state, 'matched', 'monthly:f3-extra-released');
      await releaseAll(await findPayment('AMEX PART 1')); await releaseAll(await findPayment('AMEX PART 2'));
      r = await repayment(); assert.deepEqual([r.state, r.remaining], ['unmatched', -30000], 'monthly:f3-released');
      pass('release returns the row to 照合済み, then 未照合 when every settlement is released');
      ok(await allocate(await findPayment('USD AMEX'), target, 30000, { note }), 'monthly:f3-usd');
      r = await repayment(); assert.equal(r.state, 'review', 'monthly:f3-currency-review');
      await releaseAll(await findPayment('USD AMEX'));
      ok(await allocate(await findPayment('AMEX SETTLE'), target, 30000, { note }), 'monthly:f3-id-settle');
      r = await repayment(); assert.equal(r.state, 'matched', 'monthly:f3-id-matched');
      await bankImport(idBank, csv(['取引日', '摘要', '金額', '取引番号'], [['2026/08/10', 'AMEX SETTLE corrected', '30000', 'TX-F3-0001']]), 'f3-id-2.csv');
      r = await repayment(); assert.equal(r.state, 'review', 'monthly:f3-source-review');
      await releaseAll(await findPayment('AMEX SETTLE corrected'), 'reconfirm');
      r = await repayment(); assert.equal(r.state, 'matched', 'monthly:f3-reconfirmed');
      pass('a different-currency settlement and a changed bank source keep 要確認 precedence; reconfirmation restores 照合済み');
      assert.equal((await payments('', other)).some(p => p.importId === card.id), false, 'monthly:f3-owner-scope');
      pass('the other owner does not see the repayment row');
      ui.f3 = { paymentKey: r.paymentKey };
    });

    // ── F2 — one month of purchases with their payment states ────────────────────────────────────────────────────────
    await group('F2', async pass => {
      const month = { from: '2026-09-01', to: '2026-09-30' }, mk = (orderId, values) => createRecord({ orderId, description: 'F2 ' + orderId, amount: '1000', purchaseDate: '2026-09-10', purchaseState: 'purchased', ...values });
      const rec = {
        settled: await mk('F2-SETTLED', { purchaseDate: '2026-09-01' }), unpaid: await mk('F2-UNPAID', { purchaseDate: '2026-09-30', amount: '2000' }), partial: await mk('F2-PARTIAL', { purchaseDate: '2026-09-15', amount: '3000' }),
        overpaid: await mk('F2-OVERPAID', { purchaseDate: '2026-09-16', amount: '500' }), unknown: await mk('F2-UNKNOWN', { purchaseDate: '2026-09-17', amount: '', itemPrice: '100', tax: '10' }),
        archived: await mk('F2-ARCHIVED', { purchaseDate: '2026-09-18', amount: '700' }), cancelled: await mk('F2-CANCELLED', { purchaseDate: '2026-09-19', purchaseState: 'cancelled', amount: '800' }),
        usd: await mk('F2-USD', { purchaseDate: '2026-09-20', currency: 'USD', amount: '10' }), before: await mk('F2-BEFORE', { purchaseDate: '2026-08-31' }), after: await mk('F2-AFTER', { purchaseDate: '2026-10-01' }),
        blank: await mk('F2-BLANK', { purchaseDate: '', amount: '900' }), ambiguous: await mk('F2-AMBIGUOUS', { purchaseDate: '10/5/26', amount: '400' })
      };
      const otherRecord = await createRecord({ orderId: 'F2-OTHER-OWNER', description: 'F2 other owner', amount: '1000', purchaseDate: '2026-09-10' }, other);
      const archivedNow = ok(await intake('records/' + rec.archived.id), 'record');
      ok(await intake('records/' + rec.archived.id + '/archive', { method: 'PUT', body: { revision: archivedNow.revision, archived: true } }), 'monthly:f2-archive');
      const bank = await bankAccount('F2 bank');
      await bankImport(bank, csv(BANK_HEAD, [['2026/09/05', 'F2 settle', '1000', '', '', ''], ['2026/09/15', 'F2 partial', '1000', '', '', ''], ['2026/09/16', 'F2 over A', '500', '', '', ''], ['2026/09/17', 'F2 over B', '500', '', '', '']]), 'f2-bank.csv');
      await allocateRecord(await findPayment('F2 settle'), rec.settled, 1000); await allocateRecord(await findPayment('F2 partial'), rec.partial, 1000);
      await allocateRecord(await findPayment('F2 over A'), rec.overpaid, 500); await allocateRecord(await findPayment('F2 over B'), rec.overpaid, 500);
      const listed = await pay('records?from=' + month.from + '&to=' + month.to);
      assert.equal(listed.status, 200, 'monthly:f2-endpoint ' + listed.status + ' ' + JSON.stringify(listed.data).slice(0, 200));
      const rows = listed.data.rows, ids = rows.map(r => r.id);
      assert.ok(Array.isArray(rows), 'monthly:f2-endpoint rows');
      assert.equal(new Set(ids).size, ids.length, 'monthly:f2-once');
      // Oracle: every record of this owner whose valid purchase date lies inside the month, plus every undated one, exactly once.
      const ownerId = (await db.collection('financeintakerecords').findOne({ _id: new ObjectId(rec.settled.id) })).ownerId;
      const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;
      const expected = (await db.collection('financeintakerecords').find({ ownerId }).toArray()).filter(r => { const d = r.values?.purchaseDate || ''; return !valid(d) || (d >= month.from && d <= month.to); }).map(r => String(r._id)).sort();
      assert.deepEqual([...ids].sort(), expected, 'monthly:f2-month-bounds');
      for (const k of ['before', 'after']) assert.ok(!ids.includes(rec[k].id), 'monthly:f2-month-bounds ' + k);
      assert.ok(!ids.includes(otherRecord.id), 'monthly:f2-owner-scope');
      pass('GET records lists every eligible record of the month once and excludes the days outside it');
      const by = k => rows.find(r => r.id === rec[k].id);
      for (const k of ['blank', 'ambiguous']) { assert.ok(by(k), 'monthly:f2-undated ' + k); assert.deepEqual([by(k).dateKnown, by(k).dateLabel], [false, '日付未確定'], 'monthly:f2-undated ' + k); }
      assert.equal(by('ambiguous').rawDate, '10/5/26', 'monthly:f2-undated-raw');
      pass('blank and unparseable purchase dates are always listed as 日付未確定 with the original text');
      assert.deepEqual([by('unknown').paymentState, by('unknown').total, by('unknown').remaining], ['unknown', null, null], 'monthly:f2-unknown-null');
      assert.deepEqual(['settled', 'unpaid', 'partial', 'overpaid'].map(k => by(k).paymentState), ['settled', 'unpaid', 'partial', 'overpaid'], 'monthly:f2-states');
      assert.deepEqual([by('partial').paid, by('partial').remaining, by('overpaid').remaining, by('unpaid').remaining], [1000, 2000, -500, 2000], 'monthly:f2-amounts');
      assert.equal(by('usd').currency, 'USD', 'monthly:f2-currency-kept');
      for (const key of ['total', 'sum', 'paid', 'remaining']) assert.equal(key in listed.data, false, 'monthly:f2-no-global-sum ' + key);
      pass('payment states unknown/unpaid/partial/settled/overpaid with null (not zero) for an unknown total, per-record currency and no global sums');
      assert.deepEqual([by('archived').archived, by('cancelled').purchaseState], [true, 'cancelled'], 'monthly:f2-archived-cancelled');
      assert.equal(by('overpaid').review, true, 'monthly:f2-review-flag');
      pass('archived and cancelled purchases stay visible with their labels; an overpaid one is flagged for review');
      const only = async (query, tag) => ok(await pay('records?from=' + month.from + '&to=' + month.to + query), tag).rows.map(r => r.id);
      assert.deepEqual(await only('&paymentState=unknown', 'monthly:f2-filter-payment-state'), [rec.unknown.id], 'monthly:f2-filter-payment-state');
      assert.deepEqual(await only('&purchaseState=archived', 'monthly:f2-filter-purchase-state'), [rec.archived.id], 'monthly:f2-filter-purchase-state');
      assert.deepEqual((await only('&paymentState=unpaid', 'monthly:f2-undated-filter')).filter(id => [rec.blank.id, rec.ambiguous.id].includes(id)).sort(), [rec.blank.id, rec.ambiguous.id].sort(), 'monthly:f2-undated-filter');
      assert.equal((await pay('records?from=2026-13-01')).status, 400, 'monthly:f2-bad-range-400');
      assert.equal((await pay('records?paymentState=free')).status, 400, 'monthly:f2-bad-state-400');
      const otherRows = ok(await call('/api/finance-payments/records?from=' + month.from + '&to=' + month.to, { token: other }), 'monthly:f2-owner-b').rows.map(r => r.id);
      assert.deepEqual(otherRows, [otherRecord.id], 'monthly:f2-owner-scope');
      assert.equal((await pay('records/' + rec.partial.id)).status, 200, 'monthly:f2-record-route-kept'); assert.equal((await call('/api/finance-payments/records', {})).status, 401, 'monthly:f2-auth');
      pass('payment-state and purchase-state filters are separate, undated rows obey only the state filter, bad input is 400 and each owner sees only their own');
      ui.f2 = { month, rec, bankId: bank };
    });

    // ── F4 — company / T-number evidence attribution after edits ──────────────────────────────────────────────────────
    let worker = null;
    await group('F4', async pass => {
      const agent = ok(await call('/api/finance-chat/agents', { method: 'POST', token, body: { accountIds: [String(amex._id)], researchEnabled: true } }), 'SETUP:agent');
      const wcall = (route, body = {}) => call('/api/finance-research/worker/' + route, { method: 'POST', token: agent.token, body });
      worker = () => wcall('status', { settingsUrl: 'http://127.0.0.1:54321/setup/' + 'a'.repeat(64), ntaConfigured: false, intakeResearch: true });
      ok(await worker(), 'SETUP:worker-status');
      const NAME = 'Synthetic Evidence 株式会社', NUMBER = 'T1234567890123', URL1 = 'https://evidence.example.invalid/items/1';
      const pageText = NAME + ' ' + NUMBER + ' 特定商取引法に基づく表記';
      const web = (id, text) => ({ id, kind: 'web', title: 'Synthetic Evidence 会社概要', url: 'https://evidence.example.invalid/company', text, hash: sha(text), capturedAt: new Date().toISOString() });
      const registry = (id, number, name, registeredFrom = '2023-10-01') => { const t = JSON.stringify({ count: '1', announcement: [{ registratedNumber: number, name, registrationDate: registeredFrom, disposalDate: '', expireDate: '', address: 'Synthetic address' }] }); return { id, kind: 'registry', title: '国税庁 登録番号・基準日照合', url: 'https://web-api.invoice-kohyo.nta.go.jp/1/valid', text: t, hash: sha(t), capturedAt: new Date().toISOString() }; };
      const report = { summary: '会社名と登録番号を確認しました。', question: '', findings: [], supplier: { shopName: 'Synthetic Evidence', legalName: NAME, invoiceNumber: NUMBER, citations: [{ sourceId: 's1', quote: pageText }] } };
      async function research(record, registryNumber, registeredFrom) {
        ok(await worker(), 'SETUP:worker-status');
        const queued = ok(await intake('records/' + record.id + '/research', { method: 'POST', body: { revision: record.revision, researchRevision: 0, requestId: uuid(), instruction: '' } }), 'monthly:f4-queue');
        assert.equal(queued.research.state, 'queued', 'monthly:f4-queue');
        const job = ok(await wcall('intake/claim'), 'monthly:f4-claim').job; assert.ok(job, 'monthly:f4-claim');
        ok(await wcall('intake/' + job.id + '/result', { lease: job.lease, sources: [...job.sources, web('s1', pageText), registry('s2', registryNumber, NAME, registeredFrom)], report, registry: { sourceId: 's2', number: registryNumber, date: job.context.source.purchaseDate } }), 'monthly:f4-result');
      }
      const researchView = async record => ok(await intake('records/' + record.id + '/research'), 'monthly:f4-research-view');
      const evidence = async record => ok(await pay('records/' + record.id), 'monthly:f4-payment-record').record.evidence;
      const patch = async (record, values) => ok(await intake('records/' + record.id, { method: 'PATCH', body: { revision: ok(await intake('records/' + record.id), 'record').revision, values } }), 'monthly:f4-edit');
      let r1 = await createRecord({ orderId: 'F4-0001', description: 'F4 research item', merchant: 'Synthetic Evidence', merchantUrl: URL1, purchaseDate: '2026-11-02', amount: '1200' });
      await research(r1, NUMBER);
      let rv = await researchView(r1); assert.deepEqual([rv.research.state, rv.research.verified, rv.stale], ['ready', true, false], 'monthly:f4-ready');
      let e = await evidence(r1);
      assert.deepEqual([e.origin, e.supplierName, e.invoiceNumber, e.sourcesCurrent], ['candidate', NAME, NUMBER, true], 'monthly:f4-candidate');
      pass('a ready, unconfirmed lookup is shown as a candidate with its current sources');
      const confirmed = ok(await intake('records/' + r1.id + '/research/confirm', { method: 'POST', body: { revision: r1.revision, researchRevision: rv.research.revision, confirm: true } }), 'monthly:f4-confirm');
      assert.deepEqual([confirmed.record.values.supplierName, confirmed.record.values.invoiceNumber, confirmed.stale], [NAME, NUMBER, false], 'monthly:f4-confirmed');
      e = await evidence(r1);
      assert.deepEqual([e.origin, e.sourcesCurrent, e.verified], ['research-confirmed', true, true], 'monthly:f4-confirmed-origin');
      pass('confirmed name/number on the researched URL are attributed to the research, with registry verification unchanged');
      r1 = await patch(r1, { merchantUrl: URL1 + '-moved' });
      rv = await researchView(r1); assert.equal(rv.stale, true, 'monthly:f4-stale-after-url-edit');
      assert.ok(rv.research.report?.supplier && rv.research.sources.length >= 2, 'monthly:f4-citations-retained');
      assert.equal(rv.research.context?.merchantUrl, URL1, 'monthly:f4-context-projected');
      e = await evidence(r1);
      assert.deepEqual([e.origin, e.sourcesCurrent, e.differs], ['file-manual', false, ['merchantUrl']], 'monthly:f4-historical-sources');
      assert.ok(e.research?.sources?.length >= 2, 'monthly:f4-sources-still-available');
      pass('after a URL edit the confirmed research is stale, its citations stay available and are marked historical');
      r1 = await patch(r1, { merchantUrl: URL1 });
      rv = await researchView(r1); e = await evidence(r1);
      assert.deepEqual([rv.stale, e.origin, e.sourcesCurrent], [false, 'research-confirmed', true], 'monthly:f4-restored');
      pass('changing the URL back restores the correspondence');
      r1 = await patch(r1, { invoiceNumber: 'T9999999999999' });
      rv = await researchView(r1); e = await evidence(r1);
      assert.deepEqual([rv.stale, e.origin, e.verified, e.differs], [true, 'file-manual', false, ['invoiceNumber']], 'monthly:f4-number-edit-unverified');
      const history = ok(await intake('records/' + r1.id), 'record').history;
      assert.ok(history.some(h => h.kind === 'research') && history.at(-1).changes.some(c => c.field === 'invoiceNumber'), 'monthly:f4-history-retained');
      pass('an edited number is stale, unverified and file/manual, and the research history line stays');
      const doc = ok(await intake('files?name=f4-numbers.csv', { method: 'POST', body: Buffer.from('注文番号,購入日,購入金額,登録番号\r\nF4-FILE-1,2026-11-03,500,T1111111111111\r\n') }), 'monthly:f4-file-upload').document;
      ok(await intake('files/' + doc.id + '/import', { method: 'POST', body: { sheet: doc.sheetNames[0], headerRow: 1, mapping: { orderId: '0', purchaseDate: '1', amount: '2', invoiceNumber: '3' }, defaults: { service: 'OWN', account: 'DEMO', currency: 'JPY' } } }), 'monthly:f4-file-import');
      const fileRecord = ok(await intake('records'), 'records').records.find(r => r.values.orderId === 'F4-FILE-1');
      e = await evidence(fileRecord);
      assert.deepEqual([e.origin, e.invoiceNumber, e.research, e.verified], ['file-manual', 'T1111111111111', null, false], 'monthly:f4-file-origin');
      pass('a T number imported from a file without research is labelled file/manual, with no sources claimed');
      const r3 = await createRecord({ orderId: 'F4-0003', description: 'F4 mismatch item', merchantUrl: 'https://evidence.example.invalid/items/3', purchaseDate: '2026-11-04', amount: '300' });
      await research(r3, 'T9999999999999');
      rv = await researchView(r3); e = await evidence(r3);
      assert.deepEqual([rv.research.verified, e.origin, e.verified], [false, 'candidate', false], 'monthly:f4-registry-mismatch-unverified');
      pass('a registry number mismatch stays unverified as a candidate');
      // Fold of review omf-monthly-patch-opus55-20261020 F4. E1: a registry check is as of one purchase date (registry.asOf); the
      // registrant here is registered from 2026-11-05 and checked as of 2026-11-09. E2: research with no supported values (queued,
      // failed) carries no difference, so no changed-after-research label. Setup first (E2 rows stay queued/failed for Chrome).
      const URL4 = 'https://evidence.example.invalid/items/4';
      let r4 = await createRecord({ orderId: 'F4-0004', description: 'F4 date basis item', merchant: 'Synthetic Evidence', merchantUrl: URL4, purchaseDate: '2026-11-09', amount: '400' });
      await research(r4, NUMBER, '2026-11-05');
      rv = await researchView(r4);
      const confirmed4 = ok(await intake('records/' + r4.id + '/research/confirm', { method: 'POST', body: { revision: r4.revision, researchRevision: rv.research.revision, confirm: true } }), 'monthly:f4-date-confirm');
      e = await evidence(r4);
      assert.deepEqual([confirmed4.stale, e.origin, e.verified, e.research?.registry?.asOf], [false, 'research-confirmed', true, '2026-11-09'], 'monthly:f4-date-confirmed');
      const r6 = await createRecord({ orderId: 'F4-0006', description: 'F4 failed research item', merchant: 'Synthetic Evidence', merchantUrl: 'https://evidence.example.invalid/items/6', purchaseDate: '2026-11-07', amount: '500' });
      ok(await worker(), 'SETUP:worker-status');
      ok(await intake('records/' + r6.id + '/research', { method: 'POST', body: { revision: r6.revision, researchRevision: 0, requestId: uuid(), instruction: '' } }), 'monthly:f4-queue-failed');
      const job6 = ok(await wcall('intake/claim'), 'monthly:f4-claim-failed').job;
      assert.equal(job6?.context?.recordId, r6.id, 'SETUP:failed-job');
      ok(await wcall('intake/' + job6.id + '/result', { lease: job6.lease, failed: true }), 'monthly:f4-failed-result');
      const r5 = await createRecord({ orderId: 'F4-0005', description: 'F4 queued research item', merchant: 'Synthetic Evidence', merchantUrl: 'https://evidence.example.invalid/items/5', purchaseDate: '2026-11-06', amount: '300' });
      ok(await worker(), 'SETUP:worker-status');
      ok(await intake('records/' + r5.id + '/research', { method: 'POST', body: { revision: r5.revision, researchRevision: 0, requestId: uuid(), instruction: '' } }), 'monthly:f4-queue-left');
      assert.deepEqual([(await researchView(r5)).research.state, (await researchView(r6)).research.state], ['queued', 'failed'], 'monthly:f4-no-evidence-states');
      for (const r of [r5, r6]) { const x = await evidence(r); assert.deepEqual([x.differs, x.verified, x.research?.report ?? null], [[], false, null], 'monthly:f4-no-evidence-no-differs ' + r.values.orderId); }
      pass('queued and failed research hold no supported values: no differences and no verification');
      const bank = await bankAccount('F4 bank');
      await bankImport(bank, csv(BANK_HEAD, [['2026/11/02', 'F4-0001 Synthetic Evidence', '1200', '', '', ''], ['2026/11/09', 'F4 EVIDENCE SET', '1200', '', '', '']]), 'f4-bank.csv');
      await allocateRecord(await findPayment('F4-0001 Synthetic Evidence'), r1, 1200);
      for (const [r, amount] of [[r4, 400], [r5, 300], [r6, 500]]) await allocateRecord(await findPayment('F4 EVIDENCE SET'), r, amount);
      ui.f4 = { r1, fileRecord, r4, r5, r6 };
      // E1: only the purchase date moves (to before the registration date); the value origin stays, the check is not current.
      r4 = await patch(r4, { purchaseDate: '2026-11-03' });
      rv = await researchView(r4);
      assert.equal(rv.stale, true, 'monthly:f4-date-basis-stale ' + JSON.stringify(rv.attribution));
      e = await evidence(r4);
      assert.deepEqual([e.origin, e.verified, e.differs, e.registryBasis], ['research-confirmed', false, ['purchaseDate'], { asOf: '2026-11-09', purchaseDate: '2026-11-03', current: false }], 'monthly:f4-date-unverified');
      assert.deepEqual([rv.attribution?.origin, rv.attribution?.differs, rv.research.verified, rv.research.registry?.asOf, rv.research.history?.length ?? 0], ['research-confirmed', ['purchaseDate'], false, '2026-11-09', 0], 'monthly:f4-date-research-view');
      pass('a date-only change after confirmation: research stale, payment evidence not verified, the value origin and the 2026-11-09 basis kept');
      r4 = await patch(r4, { purchaseDate: '2026-11-09' });
      rv = await researchView(r4); e = await evidence(r4);
      assert.deepEqual([rv.stale, e.origin, e.verified, e.differs, e.registryBasis?.current], [false, 'research-confirmed', true, [], true], 'monthly:f4-date-restored');
      pass('restoring the purchase date restores the registry correspondence');
      r4 = await patch(r4, { purchaseDate: '2026-11-03' });
      ui.f4.r4 = r4;
    });

    // ── F1 — typed spreadsheet cells, bank reader control, template drift, same-file reimport ─────────────────────────
    await group('F1', async pass => {
      const M = await import(pathToFileURL(path.join(root, 'shared/finance-intake.mjs')).href);
      const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLS_TYPE = 'application/vnd.ms-excel';
      const HEAD = ['注文番号', '購入日', '購入日時', '商品ID', '外部注文番号', '商品名', '購入金額', '長い番号'];
      const typedBook = ({ date1904 = false, order = null, bookType = 'xlsx' } = {}) => {
        const D = date1904 ? 1462 : 0, idx = order || HEAD.map((_, i) => i), ws = {};
        const first = [{ t: 'n', v: 123456789012 }, { t: 'n', v: 46300 - D, z: 'm/d/yy' }, { t: 'n', v: 46300.5 - D, z: 'yyyy/m/d h:mm' }, { t: 's', v: '00123' }, { t: 'n', v: 123, z: '00000' }, { t: 's', v: 'Typed cell item' }, { t: 'n', v: 1200 }, { t: 'n', v: 1234567890123456 }];
        const second = [{ t: 's', v: 'TXT-0002' }, { t: 'n', v: 46301 - D, z: 'm/d/yy' }, { t: 's', v: '' }, { t: 's', v: '0042' }, { t: 's', v: 'EXT-2' }, { t: 's', v: 'Second typed item' }, { t: 'n', v: 800 }, { t: 's', v: '' }];
        idx.forEach((i, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: HEAD[i] }; ws[XLSX.utils.encode_cell({ r: 1, c })] = { ...first[i] }; if (second[i].v !== '') ws[XLSX.utils.encode_cell({ r: 3, c })] = { ...second[i] }; });
        ws['!ref'] = 'A1:H4'; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        if (date1904) { wb.Workbook = wb.Workbook || {}; wb.Workbook.WBProps = { date1904: true }; }
        return XLSX.write(wb, { type: 'buffer', bookType });
      };
      const defaultRows = buf => XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets.Sheet1, { header: 1, raw: false, defval: '', blankrows: true }).map(r => (Array.isArray(r) ? r : []).map(v => v == null ? '' : String(v).trim()));
      const upload = async (buf, name, type = XLSX_TYPE) => ok(await intake('files?name=' + encodeURIComponent(name), { method: 'POST', body: buf, type }), 'monthly:f1-upload ' + name).document;
      const sheetOf = async doc => ok(await intake('files/' + doc.id + '/sheet?sheet=' + encodeURIComponent(doc.sheetNames[0]) + '&headerRow=1'), 'monthly:f1-sheet');
      const defaults = { service: 'OWN', account: 'DEMO', currency: 'JPY' }, mapping = { orderId: '0', purchaseDate: '1', itemId: '3', externalOrderId: '4', description: '5', amount: '6' }, extras = [{ name: '長い番号', column: '7' }];
      const plan = (doc, m = mapping) => ({ sheet: doc.sheetNames[0], headerRow: 1, mapping: m, defaults, extras });
      const typed = typedBook(), doc1900 = await upload(typed, 'typed-1900.xlsx'), s1900 = await sheetOf(doc1900);
      const first = s1900.rows[0];
      assert.equal(first[0], '123456789012', 'monthly:f1-numeric-id');
      assert.equal(first[1], '2026-10-05', 'monthly:f1-date-iso');
      assert.equal(first[2], '2026-10-05 12:00', 'monthly:f1-datetime');
      assert.deepEqual([first[3], first[4], first[5], first[6]], ['00123', '00123', 'Typed cell item', '1200'], 'monthly:f1-text-and-padding');
      assert.equal(first[7], '1.23457E+15', 'monthly:f1-no-invented-digits');
      assert.ok((s1900.cellNotes?.imprecise || []).some(n => n.column === 7 && n.row === 2), 'monthly:f1-imprecise-note ' + JSON.stringify(s1900.cellNotes || null).slice(0, 300));
      pass('XLSX General 12-digit IDs, date and datetime cells, text and zero-padded cells read exactly; a 16-digit number keeps its display and is flagged');
      for (const [name, buf, type] of [['typed-1904.xlsx', typedBook({ date1904: true }), XLSX_TYPE], ['typed-1904.xls', typedBook({ date1904: true, bookType: 'biff8' }), XLS_TYPE], ['typed-1900.xls', typedBook({ bookType: 'biff8' }), XLS_TYPE]]) {
        const s = await sheetOf(await upload(buf, name, type));
        assert.deepEqual([s.rows[0][0], s.rows[0][1], s.rows[0][2]], ['123456789012', '2026-10-05', '2026-10-05 12:00'], 'monthly:f1-1904 ' + name);
      }
      pass('1904-system XLSX and XLS (BIFF8) workbooks give the same dates');
      const preview = ok(await intake('files/' + doc1900.id + '/preview', { method: 'POST', body: plan(doc1900) }), 'monthly:f1-preview');
      assert.deepEqual(preview.rows.map(r => r.row), [2, 4], 'monthly:f1-row-positions');
      assert.deepEqual([preview.rows[0].values.orderId, preview.rows[0].values.purchaseDate, preview.rows[0].values.itemId, preview.rows[0].values.externalOrderId, preview.rows[0].extra['長い番号']], ['123456789012', '2026-10-05', '00123', '00123', '1.23457E+15'], 'monthly:f1-preview-values');
      assert.ok((preview.warnings || []).some(w => w.kind === 'imprecise-number' && w.column === 7), 'monthly:f1-preview-warning ' + JSON.stringify(preview.warnings || null).slice(0, 300));
      assert.ok((preview.warnings || []).some(w => w.kind === 'numeric-id' && w.field === 'orderId'), 'monthly:f1-numeric-id-warning');
      const datetimePreview = ok(await intake('files/' + doc1900.id + '/preview', { method: 'POST', body: plan(doc1900, { ...mapping, purchaseDate: '2' }) }), 'monthly:f1-datetime-preview');
      assert.equal(datetimePreview.rows[0].values.purchaseDate, '2026-10-05', 'monthly:f1-datetime-normalized');
      ok(await intake('files/' + doc1900.id + '/import', { method: 'POST', body: plan(doc1900) }), 'monthly:f1-import');
      const stored = ok(await intake('records'), 'records').records.find(r => r.values.description === 'Typed cell item');
      assert.deepEqual([stored?.values.orderId, stored?.values.purchaseDate, stored?.values.itemId], ['123456789012', '2026-10-05', '00123'], 'monthly:f1-stored');
      // Control: importing the same file again under another service default is a deliberate second import (same reading) → new.
      const second = ok(await intake('files/' + doc1900.id + '/preview', { method: 'POST', body: { ...plan(doc1900), defaults: { ...defaults, service: 'OTHER-SERVICE' } } }), 'monthly:f1-second-import-preview');
      assert.deepEqual([second.counts.new, second.counts.identityChanged, second.rows.filter(r => r.provenanceConflict.length || r.identityChanged).length], [2, 0, 0], 'monthly:f1-same-file-other-default-new');
      pass('preview keeps physical rows 2 and 4, normalizes datetime purchase dates, warns about numeric IDs without blocking, and the import stores exact values');
      const csvDoc = await upload(Buffer.from('注文番号,購入日,商品名\r\n00777,2026/10/5 12:00,CSV datetime\r\n00778,10/5/26,CSV ambiguous\r\n'), 'dates.csv', 'text/csv');
      const csvPreview = ok(await intake('files/' + csvDoc.id + '/preview', { method: 'POST', body: { sheet: csvDoc.sheetNames[0], headerRow: 1, mapping: { orderId: '0', purchaseDate: '1', description: '2' }, defaults } }), 'monthly:f1-csv-preview');
      assert.deepEqual(csvPreview.rows.map(r => [r.values.orderId, r.values.purchaseDate]), [['00777', '2026-10-05'], ['00778', '10/5/26']], 'monthly:f1-csv-datetime');
      pass('CSV text keeps its zeros; a year-first datetime is normalized and an ambiguous date is kept for review');
      // Bank control: the same bytes through the bank reader keep the released display text and keys.
      const bankDoc = ok(await pay('bank/files?name=typed-bank.xlsx', { method: 'POST', body: typed, type: XLSX_TYPE }), 'monthly:f1-bank-upload').document;
      const bankSheet = ok(await pay('bank/files/' + bankDoc.id + '/sheet'), 'monthly:f1-bank-sheet'), expectedBank = defaultRows(typed);
      assert.deepEqual([bankSheet.headers, ...bankSheet.rows], [expectedBank[0], ...expectedBank.slice(1).filter(r => r.some(Boolean))], 'monthly:f1-bank-control');
      assert.equal(bankSheet.rows[0][0], '1.23457E+11', 'monthly:f1-bank-control display');
      const bankId = await bankAccount('F1 bank'), idBook = (() => { const ws = { A1: { t: 's', v: '取引日' }, B1: { t: 's', v: '摘要' }, C1: { t: 's', v: '金額' }, D1: { t: 's', v: '取引番号' }, A2: { t: 's', v: '2026/10/06' }, B2: { t: 's', v: 'Numeric transaction id' }, C2: { t: 'n', v: 1500 }, D2: { t: 'n', v: 123456789012 }, '!ref': 'A1:D2' }; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); })();
      const idDoc = ok(await pay('bank/files?name=bank-ids.xlsx', { method: 'POST', body: idBook, type: XLSX_TYPE }), 'monthly:f1-bank-id-upload').document, idSheet = ok(await pay('bank/files/' + idDoc.id + '/sheet'), 'monthly:f1-bank-id-sheet');
      const bankPreview = ok(await pay('bank/files/' + idDoc.id + '/preview', { method: 'POST', body: { sheet: idSheet.sheet, headerRow: idSheet.headerRow, mapping: idSheet.mapping, bankAccountId: bankId, transactionIdConfirmed: true } }), 'monthly:f1-bank-preview');
      assert.equal(bankPreview.rows[0].key, 'id:1.23457E+11', 'monthly:f1-bank-key-unchanged');
      pass('the bank reader of the same workbook keeps the released display text and transaction-ID key byte for byte');
      // Template header drift: a saved template is compared with the current headers (notice only, never a block).
      ok(await intake('templates', { method: 'PUT', body: { name: 'F1 typed template', service: 'OWN', account: 'DEMO', currency: 'JPY', headers: HEAD, mapping, extras } }), 'monthly:f1-template');
      const reordered = typedBook({ order: [1, 0, 2, 3, 4, 5, 6, 7] }), reorderedPath = path.join(directory, 'reordered.xlsx'), originalPath = path.join(directory, 'typed.xlsx');
      await fsp.writeFile(reorderedPath, reordered); await fsp.writeFile(originalPath, typed);
      // Same-file legacy reimport: the record the released reader wrote for this file row is updated, not duplicated.
      const legacyBook = (id, description, amount) => { const ws = { A1: { t: 's', v: '注文番号' }, B1: { t: 's', v: '商品名' }, C1: { t: 's', v: '購入金額' }, A2: { t: 'n', v: id }, B2: { t: 's', v: description }, C2: { t: 'n', v: amount }, '!ref': 'A1:C2' }; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
      const legacyMapping = { orderId: '0', description: '1', amount: '2' };
      async function seedLegacy(buf, name, seedMapping = legacyMapping) {
        const doc = await upload(buf, name), rows = defaultRows(buf), ownerDoc = await db.collection('financeintakedocuments').findOne({ _id: new ObjectId(doc.id) });
        const incoming = M.mappedRows(rows.slice(1), seedMapping, defaults, { hash: doc.hash, fileName: doc.name, documentId: doc.id, sheet: 'Sheet1', firstRow: 2 }, []).filter(r => r.provenance.raw.some(Boolean));
        const planned = M.planImport([], incoming, { id: () => new ObjectId().toHexString() }), r = planned.rows[0].record;
        await db.collection('financeintakerecords').insertOne({ _id: new ObjectId(r.id), ownerId: ownerDoc.ownerId, key: r.key, values: r.values, extra: r.extra || {}, provenance: r.provenance, history: r.history, revision: r.revision, identityReview: r.identityReview, archived: false, createdAt: new Date(), updatedAt: new Date() });
        return { doc, id: r.id, key: r.key, values: r.values };
      }
      const legacy = await seedLegacy(legacyBook(123456789012, 'Legacy E-notation row', 1500), 'legacy.xlsx');
      assert.equal(legacy.values.orderId, '1.23457E+11', 'SETUP:legacy-seed');
      await bankImport(bankId, csv(BANK_HEAD, [['2026/10/06', 'LEGACY 1500', '1500', '', '', '']]), 'f1-bank.csv');
      const legacyPayment = await findPayment('LEGACY 1500');
      const linked = ok(await allocate(legacyPayment, { kind: 'intake', recordId: legacy.id }, 1500, { recordRevision: 1 }), 'monthly:f1-legacy-allocation').allocations[0];
      const count = async () => db.collection('financeintakerecords').countDocuments({ 'values.description': 'Legacy E-notation row' });
      const legacyPlan = { sheet: 'Sheet1', headerRow: 1, mapping: legacyMapping, defaults };
      const legacyPreview = ok(await intake('files/' + legacy.doc.id + '/preview', { method: 'POST', body: legacyPlan }), 'monthly:f1-legacy-preview');
      assert.deepEqual([legacyPreview.counts.new, legacyPreview.counts.update], [0, 1], 'monthly:f1-legacy-preview ' + JSON.stringify(legacyPreview.counts));
      assert.deepEqual(legacyPreview.rows[0].identityChanged, { before: legacy.key, after: JSON.stringify(['OWN', 'DEMO', '123456789012', '']), by: 'file-row' }, 'monthly:f1-legacy-identity-shown');
      ok(await intake('files/' + legacy.doc.id + '/import', { method: 'POST', body: legacyPlan }), 'monthly:f1-legacy-import');
      assert.equal(await count(), 1, 'monthly:f1-legacy-reimport no duplicate');
      const updated = await db.collection('financeintakerecords').findOne({ _id: new ObjectId(legacy.id) });
      assert.deepEqual([updated.values.orderId, updated.key, updated.revision, updated.provenance.length], ['123456789012', JSON.stringify(['OWN', 'DEMO', '123456789012', '']), 2, 1], 'monthly:f1-legacy-reimport');
      assert.deepEqual(updated.history.at(-1).changes.find(c => c.field === 'orderId'), { field: 'orderId', before: '1.23457E+11', after: '123456789012' }, 'monthly:f1-legacy-history');
      const afterView = await view(legacyPayment), kept = afterView.allocations.find(a => a.id === linked.id);
      assert.deepEqual([kept?.status, kept?.target.recordId, kept?.record?.id], ['linked', legacy.id, legacy.id], 'monthly:f1-legacy-allocation-kept');
      pass('a same-file reimport of a legacy E-notation row updates the one existing record, keeping its id, allocation, provenance and history');
      const collision = await seedLegacy(legacyBook(223456789012, 'Collision legacy row', 700), 'collision.xlsx');
      const holder = await createRecord({ orderId: '223456789012', description: 'Manual holder', amount: '700' });
      const collisionPreview = ok(await intake('files/' + collision.doc.id + '/preview', { method: 'POST', body: legacyPlan }), 'monthly:f1-collision-preview');
      assert.deepEqual(collisionPreview.rows[0].provenanceConflict, [collision.id], 'monthly:f1-collision-visible ' + JSON.stringify(collisionPreview.rows[0]).slice(0, 300));
      ok(await intake('files/' + collision.doc.id + '/import', { method: 'POST', body: legacyPlan }), 'monthly:f1-collision-import');
      const untouched = await db.collection('financeintakerecords').findOne({ _id: new ObjectId(collision.id) }), held = await db.collection('financeintakerecords').findOne({ _id: new ObjectId(holder.id) });
      assert.deepEqual([untouched.values.orderId, untouched.revision, held.identityReview], ['2.23457E+11', 1, true], 'monthly:f1-collision-no-merge');
      pass('when the corrected ID is already held by another record the rows are not merged and the collision is flagged for review');
      ui.f1 = { reorderedPath, originalPath };
      // Fold of review omf-monthly-patch-opus55-20261020 F1 (probes P1/P2c/P3): a re-read file row re-keys a record only while the
      // record still carries the identity its stored reading produced; any other record of that row is never re-keyed — the row
      // becomes its own record flagged with the provenance conflict (ids kept in its history).
      const recordOf = id => db.collection('financeintakerecords').findOne({ _id: new ObjectId(id) });
      const handEdit = async (id, orderId) => { const r = ok(await intake('records/' + id), 'record'); return ok(await intake('records/' + id, { method: 'PATCH', body: { revision: r.revision, values: { orderId } } }), 'monthly:f1-hand-edit'); };
      const previewOf = async (doc, body, tag) => ok(await intake('files/' + doc.id + '/preview', { method: 'POST', body }), tag);
      // P1: a string order ID and an m/d/yy date cell; the released reader stored '10/5/26', the intake reader now gives 2026-10-05.
      const p1Mapping = { orderId: '0', purchaseDate: '1', description: '2', amount: '3' }, p1Plan = { sheet: 'Sheet1', headerRow: 1, mapping: p1Mapping, defaults };
      const p1Book = (() => { const ws = { A1: { t: 's', v: '注文番号' }, B1: { t: 's', v: '購入日' }, C1: { t: 's', v: '商品名' }, D1: { t: 's', v: '購入金額' }, A2: { t: 's', v: 'P1-FILE-001' }, B2: { t: 'n', v: 46300, z: 'm/d/yy' }, C2: { t: 's', v: 'P1 hand corrected row' }, D2: { t: 'n', v: 1000 }, '!ref': 'A1:D2' }; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); })();
      const p1 = await seedLegacy(p1Book, 'p1-date.xlsx', p1Mapping);
      assert.deepEqual([p1.values.orderId, p1.values.purchaseDate], ['P1-FILE-001', '10/5/26'], 'SETUP:p1-seed');
      await handEdit(p1.id, 'P1-MANUAL-999');
      const p1Preview = await previewOf(p1.doc, p1Plan, 'monthly:f1-p1-preview'), p1Row = p1Preview.rows[0];
      assert.equal(p1Row.identityChanged, null, 'monthly:f1-manual-id-kept ' + JSON.stringify({ op: p1Row.operation, identityChanged: p1Row.identityChanged, orderId: p1Row.values.orderId }));
      assert.deepEqual([p1Preview.counts.new, p1Preview.counts.update, p1Row.operation, p1Row.values.orderId, p1Row.values.purchaseDate, p1Row.identityReview, p1Row.provenanceConflict], [1, 0, 'new', 'P1-FILE-001', '2026-10-05', true, [p1.id]], 'monthly:f1-manual-id-flagged');
      ok(await intake('files/' + p1.doc.id + '/import', { method: 'POST', body: p1Plan }), 'monthly:f1-p1-import');
      const p1After = await recordOf(p1.id), p1New = await db.collection('financeintakerecords').findOne({ 'values.orderId': 'P1-FILE-001' });
      assert.deepEqual([p1After.values.orderId, p1After.key, p1After.revision, p1After.values.purchaseDate], ['P1-MANUAL-999', JSON.stringify(['OWN', 'DEMO', 'P1-MANUAL-999', '']), 2, '10/5/26'], 'monthly:f1-manual-id-kept-import');
      assert.deepEqual([p1New?.identityReview, p1New?.history?.at(-1)?.conflict], [true, [p1.id]], 'monthly:f1-manual-conflict-recorded');
      pass('P1: a hand-corrected order ID is kept when only the date cell of its file row reads differently; the row becomes a flagged record');
      // P2c: the legacy record repaired above, then its ID corrected by hand, then the same file again.
      await handEdit(legacy.id, 'LEGACY-MANUAL-1');
      const p2Preview = await previewOf(legacy.doc, legacyPlan, 'monthly:f1-p2c-preview'), p2Row = p2Preview.rows[0];
      assert.equal(p2Row.identityChanged, null, 'monthly:f1-repaired-then-manual-kept ' + JSON.stringify({ op: p2Row.operation, identityChanged: p2Row.identityChanged }));
      assert.deepEqual([p2Preview.counts.new, p2Row.identityReview, p2Row.provenanceConflict], [1, true, [legacy.id]], 'monthly:f1-repaired-then-manual-flagged');
      ok(await intake('files/' + legacy.doc.id + '/import', { method: 'POST', body: legacyPlan }), 'monthly:f1-p2c-import');
      assert.equal((await recordOf(legacy.id)).values.orderId, 'LEGACY-MANUAL-1', 'monthly:f1-repaired-then-manual-import');
      pass('P2c: after a valid E-notation repair, a later hand-corrected ID survives the next reimport of the same file');
      // P3: two distinct 12-digit IDs that both displayed 3.23457E+11 — the released import merged file G into file F's record.
      const fBook = legacyBook(323456789012, 'P3 file F row', 100), gBook = legacyBook(323456999999, 'P3 file G row', 200);
      const fDoc = await upload(fBook, 'p3-f.xlsx'), gDoc = await upload(gBook, 'p3-g.xlsx'), ownerDoc = await db.collection('financeintakedocuments').findOne({ _id: new ObjectId(fDoc.id) });
      let seeded = [];
      for (const [doc, buf] of [[fDoc, fBook], [gDoc, gBook]]) seeded = M.applyPlan(seeded, M.planImport(seeded, M.mappedRows(defaultRows(buf).slice(1), legacyMapping, defaults, { hash: doc.hash, fileName: doc.name, documentId: doc.id, sheet: 'Sheet1', firstRow: 2 }, []), { id: () => new ObjectId().toHexString() }));
      const m = seeded[0];
      assert.deepEqual([seeded.length, m.values.orderId, m.values.description, m.provenance.length], [1, '3.23457E+11', 'P3 file G row', 2], 'SETUP:p3-merged-seed');
      await db.collection('financeintakerecords').insertOne({ _id: new ObjectId(m.id), ownerId: ownerDoc.ownerId, key: m.key, values: m.values, extra: m.extra || {}, provenance: m.provenance, history: m.history, revision: m.revision, identityReview: m.identityReview, archived: false, createdAt: new Date(), updatedAt: new Date() });
      const fPreview = await previewOf(fDoc, legacyPlan, 'monthly:f1-p3-f-preview');
      assert.deepEqual([fPreview.counts.update, fPreview.rows[0].values.orderId, !!fPreview.rows[0].identityChanged], [1, '323456789012', true], 'monthly:f1-merged-first-repaired');
      ok(await intake('files/' + fDoc.id + '/import', { method: 'POST', body: legacyPlan }), 'monthly:f1-p3-f-import');
      const repairedRevision = (await recordOf(m.id)).revision;
      const gPreview = await previewOf(gDoc, legacyPlan, 'monthly:f1-p3-g-preview'), gRow = gPreview.rows[0];
      assert.equal(gRow.identityChanged, null, 'monthly:f1-merged-second-file-flagged ' + JSON.stringify({ op: gRow.operation, identityChanged: gRow.identityChanged }));
      assert.deepEqual([gPreview.counts.new, gRow.values.orderId, gRow.identityReview, gRow.provenanceConflict], [1, '323456999999', true, [m.id]], 'monthly:f1-merged-second-new');
      ok(await intake('files/' + gDoc.id + '/import', { method: 'POST', body: legacyPlan }), 'monthly:f1-p3-g-import');
      const firstAfter = await recordOf(m.id), gRecord = await db.collection('financeintakerecords').findOne({ 'values.orderId': '323456999999' });
      assert.deepEqual([firstAfter.values.orderId, firstAfter.values.description, firstAfter.revision, gRecord?.values.description, gRecord?.identityReview], ['323456789012', 'P3 file F row', repairedRevision, 'P3 file G row', true], 'monthly:f1-merged-first-unchanged');
      for (const doc of [fDoc, gDoc]) { const again = await previewOf(doc, legacyPlan, 'monthly:f1-p3-repeat'); assert.deepEqual([again.counts.unchanged, again.counts.identityChanged], [1, 0], 'monthly:f1-merged-stable ' + doc.name); }
      pass('P3: a record the released reader merged across two files is repaired by the first file; the second becomes its own flagged record and repeats are stable');
    });

    // ── hidden real Chrome (skipped in mutant runs) ──────────────────────────────────────────────────────────────────────
    if (!MUTANT && Object.keys(ui).length) {
      const { browserFor } = await import(pathToFileURL(path.join(root, 'collector/browser.mjs')).href);
      const browserDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-monthly-browser-')), browser = await browserFor(path.join(browserDir, 'profile'), { headless: true });
      let page; const errors = [];
      try {
        page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
        page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
        const wait = async (fn, arg, tag = 'chrome condition') => { for (let i = 0; i < 250; i++) { if (await page.evaluate(fn, arg)) return; await pause(100); } throw Error(tag + ': ' + fn.toString().slice(0, 160)); };
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        const shot = async name => { if (SHOTS) { await fsp.mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
        await page.goto(origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', 'monthly-a@example.invalid'); await page.type('#password', PASSWORD);
        await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/', null, 'SETUP:login');
        const setInput = (selector, value) => page.evaluate((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, selector, value);
        if (ui.f3) await group('F3', async pass => {
          await page.goto(origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]'));
          const text = await page.evaluate(k => document.querySelector('[data-payment-key="' + k + '"]')?.textContent || '', ui.f3.paymentKey);
          assert.ok(text.includes('照合済み') && !text.includes('未照合'), 'monthly:f3-chrome-list-state ' + text.slice(0, 200));
          pass('hidden real Chrome: the settled repayment row reads 照合済み in the payments list');
        });
        if (ui.f2) await group('F2', async pass => {
          const { month, rec, bankId } = ui.f2;
          // Later groups add records of their own (some undated), so the expected rows are read from the API at browser time.
          const apiRows = async query => ok(await pay('records?from=' + month.from + '&to=' + month.to + query), 'monthly:f2-chrome-api').rows;
          const domIds = () => page.$$eval('[data-purchase-record]', es => es.map(e => e.dataset.purchaseRecord).sort());
          const sameAs = async (query, tag) => { const expected = (await apiRows(query)).map(r => r.id).sort(); for (let i = 0; i < 100; i++) { if (JSON.stringify(await domIds()) === JSON.stringify(expected)) return expected; await pause(100); } assert.deepEqual(await domIds(), expected, tag); return expected; };
          for (const [width, height] of [[390, 844], [1440, 1000]]) {
            await page.setViewport({ width, height }); await page.goto(origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]'));
            await wait(() => !!document.querySelector('[data-review-tab="purchases"]'), null, 'monthly:f2-chrome-tab');
            await setInput('[data-payment-from]', month.from); await setInput('[data-payment-to]', month.to);
            await page.click('[data-review-tab="purchases"]'); await wait(() => !!document.querySelector('[data-purchase-list]'), null, 'monthly:f2-chrome-list');
            const shown = await sameAs('', 'monthly:f2-chrome-month-rows');
            assert.ok(!shown.includes(rec.before.id) && !shown.includes(rec.after.id) && shown.includes(rec.blank.id) && shown.includes(rec.ambiguous.id), 'monthly:f2-chrome-month');
            assert.equal(await page.$$eval('[data-purchase-undated]', es => es.length), (await apiRows('')).filter(r => !r.dateKnown).length, 'monthly:f2-chrome-undated');
            const unknownText = await page.$eval('[data-purchase-record="' + rec.unknown.id + '"]', e => e.textContent);
            assert.ok(unknownText.includes('金額未確定') && unknownText.includes('金額不明'), 'monthly:f2-chrome-unknown ' + unknownText.slice(0, 200));
            assert.equal(await overflow(), false, 'monthly:f2-chrome-no-overflow ' + width);
            await page.select('[data-payment-account]', 'bank:' + bankId); await pause(300); await sameAs('', 'monthly:f2-chrome-account-filter-payments-only');
            await page.select('[data-purchase-payment-state]', 'unknown'); await sameAs('&paymentState=unknown', 'monthly:f2-chrome-state-filter');
            assert.ok((await domIds()).includes(rec.unknown.id), 'monthly:f2-chrome-state-filter unknown shown');
            await page.select('[data-purchase-payment-state]', 'all'); await page.select('[data-purchase-state]', 'archived'); assert.deepEqual(await sameAs('&purchaseState=archived', 'monthly:f2-chrome-purchase-state-filter'), [rec.archived.id], 'monthly:f2-chrome-purchase-state-filter');
            await page.select('[data-purchase-state]', 'all'); await page.select('[data-payment-account]', ''); await sameAs('', 'monthly:f2-chrome-reset');
            await shot('purchase-review-' + width);
            if (width === 390) { await page.click('[data-purchase-record="' + rec.partial.id + '"] [data-purchase-open]'); await wait(id => location.pathname === '/intake/' + id, rec.partial.id, 'monthly:f2-chrome-link'); await wait(() => !!document.querySelector('[data-record-payment-totals]'), null, 'monthly:f2-chrome-record-opened'); }
          }
          await page.setViewport({ width: 390, height: 844 });
          pass('hidden real Chrome at 390px and 1440px: month rows, 日付未確定, 金額不明, separate state filters, the account filter leaves purchases visible, record link, no overflow');
        });
        if (ui.f4) await group('F4', async pass => {
          if (worker) ok(await worker(), 'SETUP:worker-status');
          await page.goto(origin + '/intake/' + ui.f4.r1.id, { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-research-stale]'), null, 'monthly:f4-chrome-stale');
          const stale = await page.$eval('[data-research-stale]', e => e.textContent);
          assert.ok(stale.includes('保存後'), 'monthly:f4-chrome-stale-text ' + stale);
          assert.ok((await page.$eval('[data-research-historical]', e => e.textContent)).includes('調査時の根拠（現在の値と異なる）'), 'monthly:f4-chrome-historical');
          assert.ok(await page.$$eval('[data-research-citation]', es => es.length) >= 1, 'monthly:f4-chrome-citations');
          assert.notEqual(await page.$eval('[data-research-confirm]', e => e.textContent.trim()), '受付に保存済み', 'monthly:f4-chrome-confirm-label');
          await wait(() => { const b = document.querySelector('[data-research-start]'); return b && !b.disabled && b.textContent.includes('もう一度調べる'); }, null, 'monthly:f4-chrome-reresearch');
          assert.equal(await overflow(), false, 'monthly:f4-chrome-no-overflow'); await shot('research-stale-390');
          await page.goto(origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]'));
          const key = (await payments()).find(p => p.description === 'F4-0001 Synthetic Evidence').paymentKey;
          await page.evaluate(k => document.querySelector('[data-payment-key="' + k + '"]').click(), key); await wait(() => !!document.querySelector('[data-allocation-evidence]'), null, 'monthly:f4-chrome-evidence');
          const origin1 = await page.$eval('[data-evidence-origin]', e => e.textContent);
          assert.ok(origin1.includes('取込・手入力') && !origin1.includes('受付に保存済み'), 'monthly:f4-chrome-origin ' + origin1);
          assert.ok((await page.$eval('[data-evidence-historical]', e => e.textContent)).includes('調査時の根拠（現在の値と異なる）'), 'monthly:f4-chrome-payment-historical');
          assert.equal(await overflow(), false, 'monthly:f4-chrome-payment-no-overflow'); await shot('payment-evidence-390');
          pass('hidden real Chrome: stale research notice, historical citations, re-research lane and the payment evidence origin label');
          // Fold E2/E1: one bank row allocated to the queued (r5), failed (r6) and date-moved (r4) purchases.
          const { r1, r4, r5, r6 } = ui.f4, set = (await payments()).find(p => p.description === 'F4 EVIDENCE SET'), setView = await view(set);
          const allocationOf = id => setView.allocations.find(a => a.record?.id === id)?.id, ids = [r4, r5, r6].map(r => allocationOf(r.id));
          assert.ok(ids.every(Boolean), 'SETUP:f4-evidence-set-allocations');
          await page.goto(origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]'));
          await page.evaluate(k => document.querySelector('[data-payment-key="' + k + '"]').click(), set.paymentKey);
          await wait(list => list.every(id => !!document.querySelector('[data-allocation="' + id + '"] [data-evidence-origin]')), ids, 'monthly:f4-chrome-evidence-set');
          for (const r of [r5, r6]) assert.equal(await page.evaluate(id => !!document.querySelector('[data-allocation="' + id + '"] [data-evidence-historical]'), allocationOf(r.id)), false, 'monthly:f4-chrome-no-false-historical ' + r.values.orderId);
          const dated = await page.evaluate(id => ({ origin: document.querySelector('[data-allocation="' + id + '"] [data-evidence-origin]')?.textContent || '', historical: document.querySelector('[data-allocation="' + id + '"] [data-evidence-historical]')?.textContent || '' }), allocationOf(r4.id));
          assert.ok(dated.origin.includes('調査結果を確認して保存') && dated.origin.includes('基準日 2026-11-09') && dated.origin.includes('2026-11-03') && !dated.origin.includes('国税庁照合済み') && dated.historical.includes('購入日'), 'monthly:f4-chrome-date-basis-label ' + JSON.stringify(dated));
          assert.equal(await overflow(), false, 'monthly:f4-chrome-evidence-set-no-overflow'); await shot('evidence-basis-390');
          await setInput('[data-payment-from]', '2026-11-01'); await setInput('[data-payment-to]', '2026-11-30');
          await page.click('[data-review-tab="purchases"]');
          await wait(list => list.every(id => !!document.querySelector('[data-purchase-record="' + id + '"]')), [r1.id, r4.id, r5.id, r6.id], 'monthly:f4-chrome-month-rows');
          const rowText = id => page.$eval('[data-purchase-record="' + id + '"]', el => el.textContent);
          for (const r of [r5, r6]) assert.equal((await rowText(r.id)).includes('調査後に変更あり'), false, 'monthly:f4-chrome-month-no-false-change ' + r.values.orderId);
          const r4Row = await rowText(r4.id);
          assert.ok(r4Row.includes('調査後に変更あり') && r4Row.includes('購入日') && r4Row.includes('基準日 2026-11-09'), 'monthly:f4-chrome-month-date-basis ' + r4Row.slice(0, 300));
          assert.ok((await rowText(r1.id)).includes('調査後に変更あり'), 'monthly:f4-chrome-month-change-control');
          assert.equal(await overflow(), false, 'monthly:f4-chrome-month-no-overflow'); await shot('purchase-evidence-390');
          await page.goto(origin + '/intake/' + r4.id, { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-research-stale]') && !!document.querySelector('[data-research-registry]'), null, 'monthly:f4-chrome-date-stale');
          const research4 = await page.evaluate(() => ({ stale: document.querySelector('[data-research-stale]').textContent, registry: document.querySelector('[data-research-registry]').textContent }));
          assert.ok(research4.stale.includes('購入日') && research4.registry.includes('基準日 2026-11-09') && research4.registry.includes('2026-11-03') && !research4.registry.includes('登録あり'), 'monthly:f4-chrome-research-date-basis ' + JSON.stringify(research4));
          await wait(() => { const b = document.querySelector('[data-research-start]'); return b && !b.disabled && b.textContent.includes('もう一度調べる'); }, null, 'monthly:f4-chrome-date-reresearch');
          assert.equal(await overflow(), false, 'monthly:f4-chrome-date-no-overflow'); await shot('research-date-basis-390');
          pass('hidden real Chrome: no changed-after-research label for queued/failed research (payment evidence and month list); the moved purchase date shows its 基準日, is not 照合済み, and offers re-research');
        });
        if (ui.f1) await group('F1', async pass => {
          for (const [file, notice] of [[ui.f1.originalPath, false], [ui.f1.reorderedPath, true]]) {
            await page.goto(origin + '/intake', { waitUntil: 'networkidle2' }); await page.evaluate(() => document.querySelector('[data-open-importer]').click()); await wait(() => !!document.querySelector('[data-import-file]'));
            await (await page.$('[data-import-file]')).uploadFile(file); await wait(() => !!document.querySelector('[data-import-mapping]'), null, 'monthly:f1-chrome-mapping');
            const id = await page.$$eval('[data-import-template] option', os => os.find(o => o.textContent.trim() === 'F1 typed template')?.value || '');
            assert.ok(id, 'monthly:f1-chrome-template-listed'); await page.select('[data-import-template]', id); await pause(300);
            assert.equal(await page.evaluate(() => !!document.querySelector('[data-template-header-notice]')), notice, notice ? 'monthly:f1-template-notice' : 'monthly:f1-chrome-no-false-notice');
            assert.equal(await page.evaluate(() => document.querySelector('[data-mapping="orderId"]').disabled), false, 'monthly:f1-chrome-mapping-editable');
            assert.ok(await page.evaluate(() => !!document.querySelector('[data-import-cell-notes]')), 'monthly:f1-chrome-cell-notes');
            await page.click('[data-import-preview]'); await wait(() => !!document.querySelector('[data-import-preview-result]'), null, 'monthly:f1-chrome-preview');
            assert.equal(await overflow(), false, 'monthly:f1-chrome-no-overflow'); if (notice) await shot('template-notice-390');
          }
          pass('hidden real Chrome: a reordered sheet shows the template header notice (none for the original order), mapping stays editable, numeric-cell notes and preview work');
        });
        results.CHROME = { pass: errors.length === 0, checks: 1, failures: errors.length ? ['monthly:chrome-no-page-errors ' + errors.join(' | ').slice(0, 1200)] : [] };
        console.log((errors.length ? 'FAIL CHROME: monthly:chrome-no-page-errors ' + errors.join(' | ').slice(0, 1200) : 'PASS CHROME: no page or console errors'));
        console.log('hidden real Chrome: ' + Object.keys(ui).join(','));
      } finally { if (page) await page.close().catch(() => {}); await browser.close(); if (!path.resolve(browserDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe browser cleanup'); await fsp.rm(browserDir, { recursive: true, force: true }); }
    }
  } catch (error) { console.log('FAIL SETUP: ' + String(error?.stack || error).slice(0, 1500)); console.log(logs.slice(-2500)); results.SETUP = { pass: false, checks: 0, failures: [String(error?.message || error)] }; }
  finally {
    if (child && child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; }
    if (client) await client.close(); if (mongo) await mongo.stop();
    if (directory) { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe test cleanup'); await fsp.rm(directory, { recursive: true, force: true }); }
  }
  console.log('MONTHLY_RESULT ' + JSON.stringify(results));
  process.exitCode = Object.values(results).every(r => r.pass) && GROUPS.every(g => results[g]) ? 0 : 1;
}
main();

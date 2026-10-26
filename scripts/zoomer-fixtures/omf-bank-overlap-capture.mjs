// Fixture for plan omf-paypay-routine-20261022 Phase S: overlap-safe bank capture import. Run ONLY through the hub verifier
// (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-overlap-capture.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. The built app runs on an owned ephemeral MongoDB with synthetic owners,
// fictional Shift_JIS statements in the observed PayPay銀行 12-column shape and the 楽天銀行 native shape, and a synthetic
// collector device. No bank, browser, network, production database or private statement is touched.
// Fail-first on 12cf98c (named behaviour, not a missing file): a refreshed capture with new bytes re-creates every earlier row
// (bank-overlap:repeat-anchored / rakuten-repeat-anchored), a wrong-account, out-of-period or ambiguous capture is imported
// (wrong-account-held / period-held / ambiguous-held), an owner import of an overlapping file duplicates collector rows
// (owner-links-collector-rows), concurrent different-byte captures and an owner import racing a capture duplicate rows
// (race-captures / race-owner-capture) and a live import lease is not waited for (live-lock-waits).
// owner-reinterpretation is a post-change regression (parent finding 2026-10-22T12-45-50): deployed 12cf98c passes it; the first
// canonical-reservation candidate answered 409 forever. It and its mutants S-M12/S-M12n/S-M14 keep the reservation-history ordinal.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 5400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const u = rel => pathToFileURL(path.join(root, rel)).href;
const COVERS = ['shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'server/services/financeBankStatementService.ts', 'server/models/FinancePaymentMatch.ts'];

// ── Shift_JIS for the synthetic statements (the table of omf-rakuten-native-shiwake.mjs) ──
const sjisOf = new Map(), sjisDecoder = new TextDecoder('shift_jis');
for (let b = 0; b < 0x80; b++) sjisOf.set(String.fromCharCode(b), [b]);
for (let b = 0xa1; b <= 0xdf; b++) sjisOf.set(sjisDecoder.decode(Uint8Array.of(b)), [b]);
for (let lead = 0x81; lead <= 0xfc; lead++) { if (lead > 0x9f && lead < 0xe0) continue; for (let trail = 0x40; trail <= 0xfc; trail++) { if (trail === 0x7f) continue; const c = sjisDecoder.decode(Uint8Array.of(lead, trail)); if (c.length === 1 && c !== '�' && !sjisOf.has(c)) sjisOf.set(c, [lead, trail]); } }
const sjis = s => Buffer.from([...s].flatMap(c => { const b = sjisOf.get(c); if (!b) throw Error('fixture text not in Shift_JIS: ' + c); return b; }));

// ── Fictional statements. Balances run over the whole master list, so every export of a sub-period carries the same balance on
// the same transaction (as a bank statement does). Rows 2 and 3 are genuine twins: same day, time, payee and amount, different
// running balance. ──
const PP_HEAD = ['操作日(年)', '操作日(月)', '操作日(日)', '操作時刻(時)', '操作時刻(分)', '操作時刻(秒)', '取引順番号', '摘要', 'お支払金額', 'お預り金額', '残高', 'メモ'];
const PP_MAP = { date: '', description: '7', amount: '', outflow: '8', inflow: '9', balance: '10', reference: '11', transactionId: '', currency: '', direction: '', dateYear: '0', dateMonth: '1', dateDay: '2' };
const PP_MAP_NO_BALANCE = { ...PP_MAP, balance: '' };
const MASTER = [['2026-08-03', '09:00:00', '振込 カクウショウジ', 0, 50000], ['2026-08-05', '10:00:00', 'カクウストア', 1200, 0], ['2026-08-05', '10:00:00', 'カクウストア', 1200, 0], ['2026-08-20', '12:00:00', 'カクウリース', 5500, 0], ['2026-09-02', '08:00:00', '振込 カクウトリヒキ', 0, 12000], ['2026-09-15', '15:00:00', 'カクウ手数料', 330, 0]];
const OTHER = [['2026-08-04', '11:00:00', '振込 ベツノカイシャ', 0, 7000], ['2026-08-06', '13:00:00', 'ベツノストア', 900, 0], ['2026-08-21', '14:00:00', 'ベツノリース', 4400, 0]];
// Every generated file ends in its own number of blank lines (ignored by the reader), so no two accounts ever send identical
// bytes by accident (identical bytes are one statement per owner); a deliberate same-bytes replay reuses one buffer.
let FILE_SEQ = 0;
function ppCsv(master, from, to, { start = 1000000, drop = [], tail = '\r\n'.repeat(++FILE_SEQ) } = {}) {
  let balance = start; const lines = [PP_HEAD.join(',')];
  master.forEach(([date, time, desc, out, inn], i) => { balance += inn - out; if (date < from || date > to || drop.includes(i)) return; const [y, m, d] = date.split('-'), [hh, mm, ss] = time.split(':'); lines.push([y, String(Number(m)), String(Number(d)), String(Number(hh)), mm, ss, String(i + 1), desc, out ? String(out) : '', inn ? String(inn) : '', String(balance), ''].join(',')); });
  return sjis(lines.join('\r\n') + '\r\n' + tail);
}
const NATIVE_HEAD = ['取引日', '入出金(円)', '残高(円)', '入出金先内容'];
function nativeCsv(master, from, to, { start = 3000000, tail = '\r\n'.repeat(++FILE_SEQ) } = {}) {
  let balance = start; const lines = [NATIVE_HEAD.join(',')];
  for (const [date, , desc, out, inn] of master) { const signed = inn - out; balance += signed; if (date < from || date > to) continue; lines.push([date.replaceAll('-', ''), String(signed), String(balance), desc].join(',')); }
  return sjis(lines.join('\r\n') + '\r\n' + tail);
}

// ── The built app on an owned ephemeral MongoDB (bootstrap of scripts/finance-integration.cjs:19-41) ──
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory) {
  const uri = mongo.getUri(dbName), port = await availablePort(), origin = `http://127.0.0.1:${port}`; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-15000); });
  let healthy = false;
  for (let i = 0; i < 600; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); throw new Error('owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body, type = 'application/json' } = {}) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(600000) }); // a paused fault-injected request stays open past the pause on a loaded machine
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const register = async email => { const r = await call('/api/auth/register', { method: 'POST', body: { email, password: 'Synthetic-password-Only1!', name: 'Finance test' } }); if (r.status !== 200) throw new Error('register ' + JSON.stringify(r.data).slice(0, 300)); return r.data.tokens.accessToken; };
  const token = await register('finance-a@example.invalid');
  const card = await call('/api/finance/accounts', { method: 'POST', token, body: { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }); if (card.status !== 200) throw new Error('card account ' + JSON.stringify(card.data).slice(0, 300));
  const device = await call('/api/finance/collectors', { method: 'POST', token, body: { name: 'Test collector', accountIds: [card.data.account._id] } }); if (device.status !== 200) throw new Error('collector ' + JSON.stringify(device.data).slice(0, 300));
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(uri);
  return { origin, call, token, deviceToken: device.data.token, deviceId: device.data.id, db: client.db(dbName), logs: () => logs, async close() { await client.close().catch(() => {}); if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}
async function files(dir, ext = '.mjs') { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await files(f, ext)); else if (e.name.endsWith(ext)) out.push(f); } return out; }

// ── The native scenario: every named check `bank-overlap:<name>` is what a reintroduced defect must flip. `only` selects legs. ──
async function scenario(a, assert, only = null) {
  const { ObjectId } = requireRoot('mongodb');
  const api = '/api/finance-payments/', capi = '/api/finance-payments/collector/', results = [];
  const want = name => !only || only.includes(name);
  const req = (r, b, m = 'POST') => a.call(api + r, { method: m, token: a.token, body: b }), get = r => a.call(api + r, { token: a.token });
  const ok = (r, label) => { assert.equal(r.status, 200, 'bank-overlap:' + label + ' ' + JSON.stringify(r.data).slice(0, 600) + (r.status >= 500 ? ' | app log: ' + a.logs().slice(-2500) : '')); return r.data; };
  const rows = id => a.db.collection('financebankrows').find({ bankAccountId: new ObjectId(id) }).sort({ date: 1, _id: 1 }).toArray();
  const tuples = list => list.map(r => [r.date, r.amount, r.description, r.provenance.find(p => typeof p.balance === 'number')?.balance].join('|')).sort();
  const query = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  const upload = (job, bytes, name = 'meisai.csv') => a.call(capi + 'bank/upload?' + query({ jobId: job.jobId, snapshotHash: job.snapshotHash, kind: 'statement', channel: 'collector', name, sourceHost: 'fes.rakuten-bank.co.jp', capturedAt: new Date().toISOString(), labelChecked: 'false' }), { method: 'POST', token: a.deviceToken, body: bytes, type: 'text/csv' });
  const ppTpl = ok(await req('bank/templates', { name: 'PayPay fictional ' + randomUUID().slice(0, 6), headers: PP_HEAD, mapping: PP_MAP }, 'PUT'), 'template').template;
  const ppNoBalance = ok(await req('bank/templates', { name: 'PayPay no balance ' + randomUUID().slice(0, 6), headers: PP_HEAD, mapping: PP_MAP_NO_BALANCE }, 'PUT'), 'template-no-balance').template;
  const scope = new Set();
  const account = async name => { const id = ok(await req('bank/accounts', { name: name + ' ' + randomUUID().slice(0, 6), currency: 'JPY' }), 'account').account.id; scope.add(id); ok(await req('bank/collectors/' + a.deviceId, { bankAccountIds: [...scope] }, 'PUT'), 'scope'); return id; };
  // One completed retrieve (or observe) job with its own frozen period: connection saved, queued, claimed, completed. Uploads are
  // accepted under a job of the device's scope in any state (a retained manifest may arrive after its job ended).
  const job = async (accountId, { from, to, templateId = ppTpl.id, provider = 'rakuten', variant = 'standard' }) => {
    ok(await req('bank/accounts/' + accountId + '/connection', { provider, variant, ...(templateId ? { templateId } : {}), coverage: { from, to } }, 'PUT'), 'connection');
    const queued = ok(await req('bank/accounts/' + accountId + '/sync', {}), 'sync').job;
    const claimed = ok(await a.call(capi + 'bank/claim', { method: 'POST', token: a.deviceToken, body: {} }), 'claim').job; assert.equal(claimed?.jobId, queued.jobId, 'bank-overlap:claim-own-job');
    ok(await a.call(capi + 'bank/status', { method: 'POST', token: a.deviceToken, body: { jobId: queued.jobId, state: 'complete', message: 'synthetic' } }), 'status');
    return queued;
  };
  const ownerFile = async (bytes, name, accountId, mapping = PP_MAP) => { const d = ok(await a.call(api + 'bank/files?name=' + name, { method: 'POST', token: a.token, body: bytes, type: 'text/csv' }), 'file').document, s = ok(await get('bank/files/' + d.id + '/sheet'), 'sheet'); return { doc: d, body: { sheet: s.sheet, headerRow: s.headerRow, mapping, bankAccountId: accountId, transactionIdConfirmed: false, confirm: true } }; };
  const leg = async (name, fn) => { if (!want(name)) return; results.push(name + ': ' + await fn()); };

  await leg('repeat-anchored', async () => {
    const acc = await account('Repeat');
    const j1 = await job(acc, { from: '2026-08-01', to: '2026-08-31' }), c1 = ok(await upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'capture-1');
    assert.deepEqual([c1.state, c1.rows.new], ['imported', 4], 'bank-overlap:first-capture ' + JSON.stringify(c1));
    const before = await rows(acc);
    // a confirmed match on an earlier row must survive the refreshed capture untouched (allocation linked, source unchanged)
    const lease = before.find(r => r.description === 'カクウリース');
    const record = ok(await a.call('/api/finance-intake/records', { method: 'POST', token: a.token, body: { values: { service: 'OWN', account: 'DEMO', purchaseDate: '2026-08-20', currency: 'JPY', amount: '5500', merchant: 'カクウリース' } } }), 'intake-record');
    const payment = ok(await get('payments/bank/' + lease._id), 'payment-before').payment, recordId = record.id || record.record?.id, recordRevision = record.revision ?? record.record?.revision;
    ok(await req(payment.endpoint + '/allocations', { confirm: true, requestId: randomUUID(), paymentRevision: payment.paymentRevision, target: { kind: 'intake', recordId }, recordRevision, amount: 5500 }), 'allocation');
    const j2 = await job(acc, { from: '2026-08-01', to: '2026-09-30' }), bytes2 = ppCsv(MASTER, '2026-08-01', '2026-09-30'), c2 = ok(await upload(j2, bytes2), 'capture-2');
    const after = await rows(acc);
    assert.deepEqual([c2.state, c2.rows.new, c2.rows.existing, after.length], ['imported', 2, 4, 6], 'bank-overlap:repeat-anchored ' + JSON.stringify({ capture: c2, rows: after.length }));
    assert.deepEqual(tuples(after), tuples(after).filter((t, i, l) => l.indexOf(t) === i), 'bank-overlap:repeat-anchored (each transaction once)');
    for (const old of before) { const now = after.find(r => String(r._id) === String(old._id)); assert.ok(now, 'bank-overlap:anchor-revision-stable (row kept)'); assert.deepEqual([now.key, now.revision, now.history.map(h => h.action)], [old.key, 1, ['imported']], 'bank-overlap:anchor-revision-stable ' + now.key); assert.equal(now.provenance.length, 2, 'bank-overlap:anchor-alias-recorded'); assert.deepEqual([now.provenance[1].jobId, now.provenance[1].channel, now.provenance[1].snapshotHash], [j2.jobId, 'collector', j2.snapshotHash], 'bank-overlap:anchor-alias-recorded'); }
    const kept = ok(await get('payments/bank/' + lease._id), 'payment-after'); assert.equal(kept.payment.bankRowId, String(lease._id), 'bank-overlap:anchor-revision-stable (payment row)');
    assert.deepEqual(kept.allocations.map(x => [x.status, !!x.sourceChanged, x.amount]), [['linked', false, 5500]], 'bank-overlap:anchor-revision-stable (allocation untouched) ' + JSON.stringify(kept.allocations).slice(0, 300));
    // twins anchor one-to-one by running balance: each twin gets the alias of its own source row
    const twins = after.filter(r => r.description === 'カクウストア'); assert.equal(twins.length, 2, 'bank-overlap:same-day-twins'); assert.notEqual(twins[0].provenance[1].row, twins[1].provenance[1].row, 'bank-overlap:same-day-twins'); for (const t of twins) assert.equal(t.provenance[1].balance, t.provenance[0].balance, 'bank-overlap:same-day-twins (alias carries the same balance)');
    // a fourth identical delivery of the refreshed bytes is the same capture
    const again = ok(await upload(j2, bytes2), 'capture-2-again'); assert.deepEqual([again.id, again.duplicate], [c2.id, true], 'bank-overlap:same-bytes-same-capture'); assert.equal((await rows(acc)).length, 6);
    // the owner re-imports the refreshed capture's own file through the importer: resolved to the canonical rows, nothing new
    const sheet = ok(await get('bank/files/' + c2.id + '/sheet'), 'capture-sheet'), body = { sheet: sheet.sheet, headerRow: sheet.headerRow, mapping: PP_MAP, bankAccountId: acc, transactionIdConfirmed: false, confirm: true };
    const preview = ok(await req('bank/files/' + c2.id + '/preview', body), 'owner-preview'); assert.deepEqual(preview.counts, { new: 0, existing: 6 }, 'bank-overlap:owner-reimport-resolved (preview) ' + JSON.stringify(preview.counts));
    const imported = ok(await req('bank/files/' + c2.id + '/import', body), 'owner-import'); assert.equal(imported.rows.length, 6, 'bank-overlap:owner-reimport-resolved (rows)'); assert.equal((await rows(acc)).length, 6, 'bank-overlap:owner-reimport-resolved');
    assert.ok((await rows(acc)).every(r => r.revision === 1), 'bank-overlap:anchor-revision-stable (after owner reimport)');
    // a subset export (shorter period) anchors entirely: no hold, nothing new
    const j3 = await job(acc, { from: '2026-08-04', to: '2026-08-31' }), c3 = ok(await upload(j3, ppCsv(MASTER, '2026-08-04', '2026-08-31')), 'capture-subset');
    assert.deepEqual([c3.state, c3.reason, c3.rows.new, c3.rows.existing], ['imported', null, 0, 3], 'bank-overlap:subset-no-hold ' + JSON.stringify(c3));
    return `A+B → 4 new; A+B+C → 2 new + 4 anchored (ids/keys/revisions kept, twins one-to-one); same bytes → same capture; owner re-import 0 new; subset 3 anchored, no hold`;
  });
  await leg('rakuten-repeat-anchored', async () => {
    const acc = await account('Rakuten native');
    const j1 = await job(acc, { from: '2026-08-01', to: '2026-08-31', templateId: null }), c1 = ok(await upload(j1, nativeCsv(MASTER, '2026-08-01', '2026-08-31')), 'native-1'); assert.equal(c1.rows.new, 4, 'bank-overlap:native-first ' + JSON.stringify(c1));
    const j2 = await job(acc, { from: '2026-08-01', to: '2026-09-30', templateId: null }), c2 = ok(await upload(j2, nativeCsv(MASTER, '2026-08-01', '2026-09-30')), 'native-2');
    assert.deepEqual([c2.state, c2.rows.new, c2.rows.existing, (await rows(acc)).length], ['imported', 2, 4, 6], 'bank-overlap:rakuten-repeat-anchored ' + JSON.stringify(c2));
    return 'native four-column retrieve: 4 then 2 new + 4 anchored';
  });
  await leg('quiet-and-later-no-hold', async () => {
    const quiet = await account('Quiet'), jq = await job(quiet, { from: '2026-08-01', to: '2026-08-31' });
    const empty = ok(await upload(jq, sjis(PP_HEAD.join(',') + '\r\n')), 'quiet-capture'); assert.deepEqual([empty.state, empty.reason, empty.rows.new], ['imported', null, 0], 'bank-overlap:quiet-account-no-hold ' + JSON.stringify(empty));
    const later = await account('Later'), j1 = await job(later, { from: '2026-08-01', to: '2026-08-31' }); ok(await upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'later-1');
    const j2 = await job(later, { from: '2026-09-01', to: '2026-09-30' }), c2 = ok(await upload(j2, ppCsv(MASTER, '2026-09-01', '2026-09-30')), 'later-2');
    assert.deepEqual([c2.state, c2.reason, c2.rows.new, c2.rows.existing], ['imported', null, 2, 0], 'bank-overlap:non-overlapping-later-no-hold ' + JSON.stringify(c2));
    // an older export of the same period arriving late (it lacks the last day's later transaction) is not held: the final day may be partial
    const partial = await account('Partial day'), p1 = await job(partial, { from: '2026-08-01', to: '2026-08-20' }); ok(await upload(p1, ppCsv(MASTER, '2026-08-01', '2026-08-20')), 'partial-1');
    const p2 = await job(partial, { from: '2026-08-01', to: '2026-08-20' }), c3 = ok(await upload(p2, ppCsv(MASTER, '2026-08-01', '2026-08-20', { drop: [3] })), 'partial-2');
    assert.deepEqual([c3.state, c3.reason, c3.rows.new, c3.rows.existing], ['imported', null, 0, 3], 'bank-overlap:partial-last-day-no-hold ' + JSON.stringify(c3));
    return 'header-only quiet capture imported (0 rows); a later non-overlapping period adds 2; an earlier same-day export missing the last day\'s row anchors 3 without a hold';
  });
  await leg('wrong-account-held', async () => {
    const acc = await account('Wrong'), j1 = await job(acc, { from: '2026-08-01', to: '2026-08-31' }); ok(await upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'wrong-1');
    const before = await rows(acc), j2 = await job(acc, { from: '2026-08-01', to: '2026-08-31' }), c2 = ok(await upload(j2, ppCsv(OTHER, '2026-08-01', '2026-08-31', { start: 50000 })), 'wrong-2');
    assert.deepEqual([c2.state, /^overlap-mismatch: /.test(String(c2.reason)), c2.rows.new], ['needs_review', true, 0], 'bank-overlap:wrong-account-held ' + JSON.stringify(c2));
    assert.deepEqual((await rows(acc)).map(r => [String(r._id), r.provenance.length]), before.map(r => [String(r._id), 1]), 'bank-overlap:wrong-account-held (zero writes)');
    return 'another account\'s statement over an overlapping period: needs_review overlap-mismatch, zero writes';
  });
  await leg('period-held', async () => {
    const acc = await account('Period'), j1 = await job(acc, { from: '2026-08-04', to: '2026-08-31' });
    const c1 = ok(await upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'period-1');
    assert.deepEqual([c1.state, /^period-mismatch: /.test(String(c1.reason)), c1.rows.new, (await rows(acc)).length], ['needs_review', true, 0, 0], 'bank-overlap:period-held ' + JSON.stringify(c1));
    return 'a row before the frozen period start: needs_review period-mismatch, zero writes';
  });
  await leg('ambiguous-held', async () => {
    // two owner uploads of the same transactions in different bytes stay two rows each (the existing owner design: cross-file
    // rows are reviewed and superseded by the owner); a capture over them cannot tell which copy is canonical → held
    const acc = await account('Ambiguous'), f1 = await ownerFile(ppCsv(MASTER, '2026-08-01', '2026-08-31'), 'owner-1.csv', acc), f2 = await ownerFile(ppCsv(MASTER, '2026-08-01', '2026-08-31'), 'owner-2.csv', acc);
    ok(await req('bank/files/' + f1.doc.id + '/import', f1.body), 'owner-1'); ok(await req('bank/files/' + f2.doc.id + '/import', f2.body), 'owner-2');
    const before = await rows(acc); assert.equal(before.length, 8, 'bank-overlap:owner-to-owner-distinct-kept');
    const j = await job(acc, { from: '2026-08-01', to: '2026-08-31' }), c = ok(await upload(j, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'ambiguous');
    assert.deepEqual([c.state, /^overlap-ambiguous: /.test(String(c.reason)), c.rows.new], ['needs_review', true, 0], 'bank-overlap:ambiguous-held ' + JSON.stringify(c));
    assert.deepEqual((await rows(acc)).map(r => r.provenance.length), before.map(() => 1), 'bank-overlap:ambiguous-held (zero partial writes)');
    return 'owner-to-owner cross-file copies stay distinct (8 rows); a capture over two copies of each transaction is held overlap-ambiguous with zero writes';
  });
  await leg('owner-links-collector-rows', async () => {
    const acc = await account('Owner after capture'), j = await job(acc, { from: '2026-08-01', to: '2026-09-30' }); ok(await upload(j, ppCsv(MASTER, '2026-08-01', '2026-09-30')), 'collector-first');
    const f = await ownerFile(ppCsv(MASTER, '2026-08-01', '2026-08-31'), 'owner-after.csv', acc);
    const preview = ok(await req('bank/files/' + f.doc.id + '/preview', f.body), 'owner-after-preview'); assert.deepEqual(preview.counts, { new: 0, existing: 4 }, 'bank-overlap:owner-links-collector-rows (preview) ' + JSON.stringify(preview.counts)); assert.equal(preview.pairs.length, 0, 'bank-overlap:owner-links-collector-rows (no duplicate pairs)');
    ok(await req('bank/files/' + f.doc.id + '/import', f.body), 'owner-after-import'); assert.equal((await rows(acc)).length, 6, 'bank-overlap:owner-links-collector-rows');
    return 'an owner import of an overlapping file after a capture links to the 4 collector rows (no duplicate)';
  });
  await leg('owner-reinterpretation', async () => {
    // parent finding 2026-10-22T12-45-50 (fixture owner-reinterpretation-probe.mjs): imported with the memo column unmapped, then the
    // same file re-imported with the memo mapped (revision 2), then a different-byte copy confirmed under the earlier mapping. Deployed
    // 12cf98c imports the copy (2 rows); the candidate answered 409 on every retry. The copy and a further copy must import; the
    // reinterpreted row keeps its id, revision and reservation.
    const acc = await account('Owner remap'), csv = tail => Buffer.from('date,description,amount,balance,memo\r\n2026-08-05,Demo purchase,1200,998800,note\r\n' + tail, 'utf8');
    const map = { date: '0', description: '1', amount: '2', outflow: '', inflow: '', balance: '3', reference: '', transactionId: '', currency: '', direction: '' };
    const f1 = await ownerFile(csv(''), 'remap-1.csv', acc, map); ok(await req('bank/files/' + f1.doc.id + '/import', f1.body), 'owner-reinterpretation (first import)');
    const reserved = (await rows(acc))[0]?.canonicalKey; assert.equal(typeof reserved, 'string', 'bank-overlap:owner-reinterpretation (first row reserved)');
    ok(await req('bank/files/' + f1.doc.id + '/import', { ...f1.body, mapping: { ...map, reference: '4' } }), 'owner-reinterpretation (memo mapped on the same file)');
    const remapped = await rows(acc); assert.deepEqual(remapped.map(r => [r.revision, r.reference, r.canonicalKey]), [[2, 'note', reserved]], 'bank-overlap:owner-reinterpretation (same row revisioned, reservation kept)');
    const f2 = await ownerFile(csv('\r\n'), 'remap-2.csv', acc, map), preview = ok(await req('bank/files/' + f2.doc.id + '/preview', f2.body), 'owner-reinterpretation (preview)');
    assert.deepEqual(preview.counts, { new: 1, existing: 0 }, 'bank-overlap:owner-reinterpretation (preview) ' + JSON.stringify(preview.counts));
    ok(await req('bank/files/' + f2.doc.id + '/import', f2.body), 'owner-reinterpretation (copy imported)');
    ok(await req('bank/files/' + f2.doc.id + '/import', f2.body), 'owner-reinterpretation (repeated import of the copy)');
    const f3 = await ownerFile(csv('\r\n\r\n'), 'remap-3.csv', acc, map); ok(await req('bank/files/' + f3.doc.id + '/import', f3.body), 'owner-reinterpretation (further copy imported)');
    const after = await rows(acc), original = after.find(r => String(r._id) === String(remapped[0]._id));
    assert.deepEqual([after.length, original?.revision, original?.reference, original?.canonicalKey], [3, 2, 'note', reserved], 'bank-overlap:owner-reinterpretation (copies kept, original row unchanged) ' + JSON.stringify(after.map(r => [r.revision, r.reference])));
    assert.equal(new Set(after.map(r => r.canonicalKey)).size, 3, 'bank-overlap:owner-reinterpretation (each copy its own reservation)');
    return 'memo mapped on the same file (revision 2, reservation kept); a different-byte copy under the earlier mapping previews 1 new and imports; its repeat resolves; a further copy imports (3 rows, distinct reservations)';
  });
  await leg('owner-balance-correction', async () => {
    // parent finding PARENT-BALANCE-CORRECTION-FINDING.md (probe owner-balance-reinterpretation-probe.mjs): the owner imports with the wrong
    // balance column, corrects it on the same file and saves that template; a later capture under the corrected template must anchor to
    // the corrected row (the candidate before build-resume-04 held it overlap-mismatch). Retry, an import without a balance column and the
    // immutable history are checked on the way.
    const acc = await account('Owner balance'), csv = tail => Buffer.from('date,description,amount,oldBalance,correctBalance\r\n2026-08-05,Demo purchase,1200,998800,1998800\r\n' + tail, 'utf8');
    const map = { date: '0', description: '1', amount: '2', outflow: '', inflow: '', balance: '3', reference: '', transactionId: '', currency: '', direction: '' }, fixed = { ...map, balance: '4' };
    const f1 = await ownerFile(csv(''), 'balance-1.csv', acc, map); ok(await req('bank/files/' + f1.doc.id + '/import', f1.body), 'owner-balance-correction (first import)');
    const first = (await rows(acc))[0]; assert.deepEqual([first?.balance, typeof first?.canonicalKey], [998800, 'string'], 'bank-overlap:owner-balance-correction (first balance recorded)');
    const tplName = 'Corrected balance ' + randomUUID().slice(0, 6);
    ok(await req('bank/files/' + f1.doc.id + '/import', { ...f1.body, mapping: fixed, templateName: tplName }), 'owner-balance-correction (corrected on the same file)');
    const fixedRows = await rows(acc), row = fixedRows[0];
    assert.deepEqual([fixedRows.length, String(row._id), row.revision, row.balance, row.provenance.map(p => p.balance), row.canonicalKey, row.history.at(-1)?.action, row.history.at(-1)?.before?.balance], [1, String(first._id), 2, 1998800, [998800], first.canonicalKey, 'source-updated', 998800], 'bank-overlap:owner-balance-correction (corrected on the same file: current balance recorded, provenance and reservation kept, change audited)');
    ok(await req('bank/files/' + f1.doc.id + '/import', { ...f1.body, mapping: fixed }), 'owner-balance-correction (retry)');
    ok(await req('bank/files/' + f1.doc.id + '/import', { ...f1.body, mapping: { ...map, balance: '' } }), 'owner-balance-correction (import without a balance column)');
    const kept = (await rows(acc))[0]; assert.deepEqual([kept.revision, kept.balance], [2, 1998800], 'bank-overlap:owner-balance-correction (a retry and an import without a balance change nothing)');
    const tpl = ok(await get('bank/templates'), 'templates').templates.find(t => t.name === tplName); assert.ok(tpl, 'bank-overlap:owner-balance-correction (template saved)');
    const j = await job(acc, { from: '2026-08-01', to: '2026-08-31', templateId: tpl.id }), c = ok(await upload(j, csv('\r\n')), 'owner-balance-correction (capture)'), after = await rows(acc);
    assert.deepEqual([c.state, c.reason, c.rows.new, c.rows.existing, after.length, String(after[0]._id)], ['imported', null, 0, 1, 1, String(first._id)], 'bank-overlap:owner-balance-correction (capture anchors the corrected row) ' + JSON.stringify(c).slice(0, 400));
    assert.deepEqual([after[0].revision, after[0].balance, after[0].provenance.map(p => p.balance), after[0].canonicalKey], [2, 1998800, [998800, 1998800], first.canonicalKey], 'bank-overlap:owner-balance-correction (the capture adds its source only)');
    return 'balance column corrected on the same file (revision 2, current 1998800, provenance 998800 kept, reservation kept, history audited); retry and a no-balance import change nothing; the later capture under the corrected template anchors (0 new, 1 existing, same row)';
  });
  await leg('bank-id-compat', async () => {
    // parent finding PARENT-BANK-ID-FINDING.md (fixture bank-id-compat-probe.mjs): a file imported with confirmed bank ID A (column 4) is
    // re-imported with confirmed ID column 5 (B): 12cf98c keeps A on its row and creates B; a later different-byte file with B resolves to
    // that B row (preview 0 new / 1 existing; final 1 A, 1 B). The candidate before build-resume-06 rewrote A into B and duplicated B.
    const csv = tail => Buffer.from('date,description,amount,balance,id_a,id_b\r\n2026-08-05,Demo purchase,1200,998800,FICTIONAL-TX-A,FICTIONAL-TX-B\r\n' + tail, 'utf8');
    const idMap = col => ({ date: '0', description: '1', amount: '2', outflow: '', inflow: '', balance: '3', reference: '', transactionId: col, currency: '', direction: '' });
    const acc = await account('Bank ID'), f1 = await ownerFile(csv(''), 'bank-id-1.csv', acc, idMap('4')), confirmed = b => ({ ...b, transactionIdConfirmed: true });
    ok(await req('bank/files/' + f1.doc.id + '/import', confirmed(f1.body)), 'bank-id-compat (first import, ID A)');
    const initial = (await rows(acc))[0];
    ok(await req('bank/files/' + f1.doc.id + '/import', confirmed({ ...f1.body, mapping: idMap('5') })), 'bank-id-compat (same file, confirmed ID column B)');
    const afterRemap = await rows(acc), onOriginal = afterRemap.find(r => String(r._id) === String(initial._id));
    assert.deepEqual([afterRemap.length, onOriginal?.key, onOriginal?.transactionId, onOriginal?.revision, afterRemap.map(r => r.transactionId).sort()], [2, initial.key, 'FICTIONAL-TX-A', 1, ['FICTIONAL-TX-A', 'FICTIONAL-TX-B']], 'bank-overlap:bank-id-compat (A kept on its row, B its own row) ' + JSON.stringify(afterRemap.map(r => [r.key, r.transactionId, r.revision])));
    const f2 = await ownerFile(csv('\r\n'), 'bank-id-2.csv', acc, idMap('5')), preview = ok(await req('bank/files/' + f2.doc.id + '/preview', confirmed(f2.body)), 'bank-id-compat (preview)');
    assert.deepEqual(preview.counts, { new: 0, existing: 1 }, 'bank-overlap:bank-id-compat (a later file with B resolves to the B row) ' + JSON.stringify(preview.counts));
    ok(await req('bank/files/' + f2.doc.id + '/import', confirmed(f2.body)), 'bank-id-compat (later file)');
    const final = await rows(acc), count = id => final.filter(r => r.transactionId === id).length;
    assert.deepEqual([final.length, count('FICTIONAL-TX-A'), count('FICTIONAL-TX-B'), final.map(r => r.idKind)], [2, 1, 1, ['bank-id', 'bank-id']], 'bank-overlap:bank-id-compat (final 1 A, 1 B)');
    // kind transitions on one source keep 12cf98c's behaviour: a file-row and a bank-ID row of the same source row stay distinct, neither rewritten
    const noId = idMap('');
    const t1 = await account('File row then ID'), g1 = await ownerFile(csv('\r\n\r\n'), 'transition-1.csv', t1, noId); ok(await req('bank/files/' + g1.doc.id + '/import', g1.body), 'bank-id-compat (file-row first)');
    const fileRow = (await rows(t1))[0]; ok(await req('bank/files/' + g1.doc.id + '/import', confirmed({ ...g1.body, mapping: idMap('4') })), 'bank-id-compat (then confirmed ID)');
    const t1rows = await rows(t1), keptFileRow = t1rows.find(r => String(r._id) === String(fileRow._id));
    assert.deepEqual([t1rows.length, keptFileRow?.idKind, keptFileRow?.transactionId, keptFileRow?.revision, t1rows.map(r => r.idKind).sort()], [2, 'file-row', '', 1, ['bank-id', 'file-row']], 'bank-overlap:bank-id-compat (file-row then bank ID: both kept)');
    const t2 = await account('ID then file row'), g2 = await ownerFile(csv('\r\n\r\n\r\n'), 'transition-2.csv', t2, idMap('4')); ok(await req('bank/files/' + g2.doc.id + '/import', confirmed(g2.body)), 'bank-id-compat (bank ID first)');
    const idFirst = (await rows(t2))[0]; ok(await req('bank/files/' + g2.doc.id + '/import', { ...g2.body, mapping: noId }), 'bank-id-compat (then without the ID column)');
    const t2rows = await rows(t2), keptId = t2rows.find(r => String(r._id) === String(idFirst._id));
    assert.deepEqual([t2rows.length, keptId?.idKind, keptId?.transactionId, keptId?.revision, t2rows.map(r => r.idKind).sort()], [2, 'bank-id', 'FICTIONAL-TX-A', 1, ['bank-id', 'file-row']], 'bank-overlap:bank-id-compat (bank ID then file-row: both kept)');
    return 'confirmed ID A kept on its row when the same file is re-read with ID B (B its own row); a later file with B resolves to it (0 new / 1 existing; 1 A, 1 B); file-row→bank-ID and bank-ID→file-row on one source keep both rows unrewritten';
  });
  await leg('unchanged-lanes', async () => {
    // a guided/observe capture and a retrieve whose mapping has no balance keep today's behaviour (new rows per file)
    const obs = await account('Observe'), o1 = await job(obs, { from: '2026-08-01', to: '2026-08-31', provider: 'resona', variant: 'direct' }); assert.equal(o1.kind, 'observe');
    ok(await upload(o1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'observe-1'); const o2 = await job(obs, { from: '2026-08-01', to: '2026-09-30', provider: 'resona', variant: 'direct' }); const oc = ok(await upload(o2, ppCsv(MASTER, '2026-08-01', '2026-09-30')), 'observe-2');
    assert.deepEqual([oc.rows.new, (await rows(obs)).length], [6, 10], 'bank-overlap:observe-unchanged ' + JSON.stringify(oc));
    const nb = await account('No balance'), n1 = await job(nb, { from: '2026-08-01', to: '2026-08-31', templateId: ppNoBalance.id }); ok(await upload(n1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'nobalance-1');
    const n2 = await job(nb, { from: '2026-08-01', to: '2026-09-30', templateId: ppNoBalance.id }), nc = ok(await upload(n2, ppCsv(MASTER, '2026-08-01', '2026-09-30')), 'nobalance-2');
    assert.deepEqual([nc.rows.new, (await rows(nb)).length], [6, 10], 'bank-overlap:no-balance-unchanged ' + JSON.stringify(nc));
    // two accounts holding the same transactions stay isolated
    const x1 = await account('Isolated 1'), x2 = await account('Isolated 2'), jx1 = await job(x1, { from: '2026-08-01', to: '2026-08-31' }), jx2 = await job(x2, { from: '2026-08-01', to: '2026-08-31' });
    ok(await upload(jx1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'isolated-1'); const cx2 = ok(await upload(jx2, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'isolated-2');
    assert.deepEqual([cx2.rows.new, (await rows(x1)).length, (await rows(x2)).length], [4, 4, 4], 'bank-overlap:cross-account-isolated');
    return 'observe capture and no-balance retrieve keep today\'s per-file rows; two accounts with the same transactions stay separate';
  });
  await leg('race-captures', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const acc = await account('Race ' + i), j1 = await job(acc, { from: '2026-08-01', to: '2026-08-31' }), j2 = await job(acc, { from: '2026-08-01', to: '2026-09-30' });
      const pair = [upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), upload(j2, ppCsv(MASTER, '2026-08-01', '2026-09-30'))];
      const [r1, r2] = await Promise.all(i % 2 ? pair.reverse() : pair); ok(r1, 'race-a'); ok(r2, 'race-b');
      const list = await rows(acc); outcomes.push(list.length);
      assert.equal(list.length, 6, 'bank-overlap:race-captures (one canonical set) round ' + i + ' rows ' + list.length);
      assert.deepEqual(tuples(list), [...new Set(tuples(list))], 'bank-overlap:race-captures (each transaction once)');
    }
    return 'four rounds of concurrent different-byte overlapping captures: 6 canonical rows each ' + JSON.stringify(outcomes);
  });
  await leg('race-owner-capture', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const acc = await account('Owner race ' + i), f = await ownerFile(ppCsv(MASTER, '2026-08-01', '2026-08-31'), 'owner-race-' + i + '.csv', acc), j = await job(acc, { from: '2026-08-01', to: '2026-09-30' });
      const pair = [req('bank/files/' + f.doc.id + '/import', f.body), upload(j, ppCsv(MASTER, '2026-08-01', '2026-09-30'))];
      const [r1, r2] = await Promise.all(i % 2 ? pair.reverse() : pair); ok(r1, 'owner-race-a'); ok(r2, 'owner-race-b');
      const list = await rows(acc); outcomes.push(list.length); assert.equal(list.length, 6, 'bank-overlap:race-owner-capture (one canonical set) round ' + i + ' rows ' + list.length);
    }
    return 'four rounds of an owner import racing an overlapping capture: 6 canonical rows each ' + JSON.stringify(outcomes);
  });
  await leg('race-same-bytes', async () => {
    const acc = await account('Same bytes'), j = await job(acc, { from: '2026-08-01', to: '2026-08-31' }), bytes = ppCsv(MASTER, '2026-08-01', '2026-08-31');
    const [r1, r2] = await Promise.all([upload(j, bytes), upload(j, bytes)]); const a1 = ok(r1, 'same-a'), a2 = ok(r2, 'same-b');
    assert.equal(a1.id, a2.id, 'bank-overlap:race-same-bytes (one capture)'); assert.equal((await rows(acc)).length, 4, 'bank-overlap:race-same-bytes (rows once)');
    return 'two concurrent deliveries of the same bytes: one capture, 4 rows';
  });
  await leg('live-lock-waits', async () => {
    const acc = await account('Live lease'), j = await job(acc, { from: '2026-08-01', to: '2026-08-31' });
    await a.db.collection('financebankaccounts').updateOne({ _id: new ObjectId(acc) }, { $set: { rowLock: { id: 'fixture-live-holder', until: new Date(Date.now() + 2500) } } });
    const t = Date.now(), c = ok(await upload(j, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'live-lease'), waited = Date.now() - t;
    assert.ok(waited >= 2000, 'bank-overlap:live-lock-waits (the capture waited for the live holder) waited ' + waited + 'ms');
    assert.equal(c.rows.new, 4); assert.equal((await a.db.collection('financebankaccounts').findOne({ _id: new ObjectId(acc) })).rowLock, null, 'bank-overlap:live-lock-owned (the capture took the account lease after the holder and released it)');
    return 'a live foreign lease is waited for (' + waited + ' ms), then the capture imports and releases the lease';
  });
  await leg('stale-lock-and-crash-recovery', async () => {
    const acc = await account('Stale lease'), j1 = await job(acc, { from: '2026-08-01', to: '2026-08-31' }); ok(await upload(j1, ppCsv(MASTER, '2026-08-01', '2026-08-31')), 'stale-1');
    await a.db.collection('financebankaccounts').updateOne({ _id: new ObjectId(acc) }, { $set: { rowLock: { id: 'fixture-crashed-holder', until: new Date(Date.now() - 1000) } } });
    const j2 = await job(acc, { from: '2026-08-01', to: '2026-09-30' }), bytes = ppCsv(MASTER, '2026-08-01', '2026-09-30'), t = Date.now(), c2 = ok(await upload(j2, bytes), 'stale-2');
    // without takeover the request would wait the whole 25 s wait bound and answer 409; the capture succeeded well before it
    const tookOver = Date.now() - t; assert.ok(tookOver < 20000, 'bank-overlap:stale-lock-taken-over (' + tookOver + ' ms)'); assert.deepEqual([c2.rows.new, c2.rows.existing], [2, 4]); assert.equal((await a.db.collection('financebankaccounts').findOne({ _id: new ObjectId(acc) })).rowLock, null, 'bank-overlap:lock-released');
    // a crash after part of the writes: the capture receipt unset, one alias and one new row missing; redelivery converges
    const statement = await a.db.collection('financebankstatements').findOne({ _id: new ObjectId(c2.id) }), list = await rows(acc);
    const anchored = list.find(r => r.provenance.some(p => p.hash === statement.hash) && r.provenance.length === 2), created = list.find(r => r.provenance.length === 1 && r.provenance[0].hash === statement.hash);
    assert.ok(anchored && created, 'bank-overlap:crash-setup');
    await a.db.collection('financebankstatements').updateOne({ _id: statement._id }, { $set: { capture: null } });
    await a.db.collection('financebankrows').updateOne({ _id: anchored._id }, { $pull: { provenance: { hash: statement.hash } } }); await a.db.collection('financebankrows').deleteOne({ _id: created._id });
    const redelivered = ok(await upload(j2, bytes), 'stale-redelivery'), healed = await rows(acc);
    assert.deepEqual([redelivered.state, healed.length], ['imported', 6], 'bank-overlap:crash-recovery ' + JSON.stringify(redelivered));
    assert.equal(healed.find(r => String(r._id) === String(anchored._id)).provenance.length, 2, 'bank-overlap:crash-recovery (alias restored on the same row)');
    assert.deepEqual(tuples(healed), [...new Set(tuples(healed))], 'bank-overlap:crash-recovery (each transaction once)');
    return 'an expired lease is taken over at once; a crash after partial writes converges on redelivery (alias restored, missing row re-created, no duplicate)';
  });
  return results;
}

// ── Pure decisions of shared bankOverlapPlan, with the shared module (or a named mutant sibling) loaded directly ──
function pureChecks(shared, assert) {
  const plan = shared.bankOverlapPlan; assert.equal(typeof plan, 'function', 'bank-overlap:pure-export (bankOverlapPlan)');
  const prov = (hash, row, balance, channel = 'collector') => ({ hash, sheet: 'S', row, balance, channel });
  const ex = (id, date, amount, balance, extra = {}) => ({ _id: id, key: 'file:h0:S:' + id, idKind: 'file-row', state: 'active', date, direction: 'out', amount, currency: 'JPY', description: 'D', reference: '', transactionId: '', provenance: [prov('h0', 2, balance)], ...extra });
  const pl = (date, amount, balance, row, extra = {}) => ({ key: 'file:h1:S:' + row, idKind: 'file-row', date, direction: 'out', amount, currency: 'JPY', description: 'D', reference: '', transactionId: '', balance, provenance: [prov('h1', row, balance)], ...extra });
  const cov = { from: '2026-08-01', to: '2026-08-31' };
  // twins by balance anchor one-to-one
  const twins = plan([ex('a', '2026-08-05', 1200, 900), ex('b', '2026-08-05', 1200, 800)], [pl('2026-08-05', 1200, 800, 2), pl('2026-08-05', 1200, 900, 3)], { mode: 'capture', coverage: cov });
  assert.deepEqual([twins.held, twins.targets], [false, ['b', 'a']], 'bank-overlap:same-day-twins (pure) ' + JSON.stringify(twins));
  // indistinguishable copies are never paired arbitrarily
  const amb = plan([ex('a', '2026-08-05', 1200, 900), ex('b', '2026-08-05', 1200, 900)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([amb.held, amb.code], [true, 'overlap-ambiguous'], 'bank-overlap:ambiguous-held (pure)');
  const firstImport = plan([], [pl('2026-08-05', 1200, 900, 2), pl('2026-08-05', 1200, 900, 3)], { mode: 'capture', coverage: cov });
  assert.deepEqual([firstImport.held, firstImport.targets], [false, [null, null]], 'bank-overlap:first-import-repeats-kept (pure)');
  // an existing in-period row the capture lacks → mismatch; on the final day only → not held
  const mis = plan([ex('a', '2026-08-05', 1200, 900), ex('c', '2026-08-10', 50, 850)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([mis.held, mis.code], [true, 'overlap-mismatch'], 'bank-overlap:wrong-account-held (pure)');
  const lastDay = plan([ex('a', '2026-08-05', 1200, 900), ex('c', '2026-08-31', 50, 850)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([lastDay.held, lastDay.targets], [false, ['a']], 'bank-overlap:partial-last-day-no-hold (pure)');
  const period = plan([], [pl('2026-07-31', 1, 1, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([period.held, period.code], [true, 'period-mismatch'], 'bank-overlap:period-held (pure)');
  const noBalance = plan([ex('a', '2026-08-05', 1200, 900)], [pl('2026-08-05', 1200, null, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([noBalance.held, noBalance.code], [true, 'balance-missing'], 'bank-overlap:balance-missing (pure)');
  // the same source row is resolved by its key, else by its recorded source, before any anchoring
  const source = plan([ex('a', '2026-08-05', 1200, 900, { provenance: [prov('h0', 2, 900), prov('h1', 2, 900)] })], [pl('2026-08-05', 1200, 900, 2)], { mode: 'owner' });
  assert.deepEqual([source.targets, source.via], [['a'], ['source']], 'bank-overlap:owner-reimport-resolved (pure)');
  // the owner path links only to collector rows; owner-uploaded copies stay distinct
  const ownerUpload = plan([ex('a', '2026-08-05', 1200, 900, { provenance: [prov('h0', 2, 900, 'upload')] })], [pl('2026-08-05', 1200, 900, 2)], { mode: 'owner' });
  assert.deepEqual(ownerUpload.targets, [null], 'bank-overlap:owner-to-owner-distinct-kept (pure)');
  const ownerCollector = plan([ex('a', '2026-08-05', 1200, 900)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'owner' });
  assert.deepEqual(ownerCollector.targets, ['a'], 'bank-overlap:owner-links-collector-rows (pure)');
  // resolve-only (observe capture, no balance mapping): no anchoring
  assert.deepEqual(plan([ex('a', '2026-08-05', 1200, 900)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'resolve' }).targets, [null], 'bank-overlap:observe-unchanged (pure)');
  // superseded rows are not candidates
  assert.deepEqual(plan([ex('a', '2026-08-05', 1200, 900, { state: 'superseded' }), ex('b', '2026-08-05', 1200, 900)], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov }).targets, ['b'], 'bank-overlap:superseded-excluded (pure)');
  // canonical identities of created rows: equal from the same snapshot (two writers collide), distinct for twins and repeats, and the
  // next ordinal after an existing owner copy or a superseded row (never a permanent collision); none in resolve mode or for anchors.
  // `reserved` stands for the account's reservation history (the service: the stored canonicalKeys of the snapshot's rows).
  const twinsNew = [pl('2026-08-05', 1200, 900, 2), pl('2026-08-05', 1200, 800, 3), pl('2026-08-05', 1200, 900, 4)];
  const idA = plan([], twinsNew, { mode: 'capture', coverage: cov }).identities, idB = plan([], twinsNew.map(r => ({ ...r, key: r.key + 'x' })), { mode: 'capture', coverage: cov }).identities;
  assert.ok(idA && idA.every(Boolean), 'bank-overlap:canonical-identity-assigned (pure) ' + JSON.stringify(idA));
  assert.deepEqual(idB, idA, 'bank-overlap:canonical-identity-same-snapshot (pure)'); assert.equal(new Set(idA).size, 3, 'bank-overlap:canonical-identity-repeats-distinct (pure)');
  const held = (...ids) => id => ids.includes(id);
  const copy = plan([ex('a', '2026-08-05', 1200, 900, { provenance: [prov('h0', 2, 900, 'upload')] })], [pl('2026-08-05', 1200, 900, 2)], { mode: 'owner', reserved: held(idA[0]) });
  assert.deepEqual([copy.targets[0], copy.identities[0]], [null, idA[0].replace(/#1$/, '#2')], 'bank-overlap:owner-copy-next-ordinal (pure) ' + JSON.stringify(copy.identities));
  const afterSuperseded = plan([ex('a', '2026-08-05', 1200, 900, { state: 'superseded' })], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov, reserved: held(idA[0]) });
  assert.deepEqual([afterSuperseded.targets[0], afterSuperseded.identities[0]], [null, idA[0].replace(/#1$/, '#2')], 'bank-overlap:superseded-next-ordinal (pure)');
  // owner reinterpretation (parent finding 2026-10-22T12-45-50): row `a` was imported with its memo unmapped (it reserved the tuple with
  // reference '' #1) and then re-imported from the same file with the memo mapped (its CURRENT reference is 'note'; its reservation is
  // unchanged). A later owner copy under the earlier mapping must take '' #2 — not the reserved '' #1 forever — and a copy carrying the
  // memo takes 'note' #1, which nobody reserved.
  const remapped = [ex('a', '2026-08-05', 1200, 900, { reference: 'note', provenance: [prov('h0', 2, 900, 'upload')] })];
  const blankMemo = plan(remapped, [pl('2026-08-05', 1200, 900, 2)], { mode: 'owner', reserved: held(idA[0]) }), withMemo = plan(remapped, [pl('2026-08-05', 1200, 900, 2, { reference: 'note' })], { mode: 'owner', reserved: held(idA[0]) });
  assert.deepEqual([blankMemo.targets[0], blankMemo.identities[0], withMemo.identities[0]], [null, idA[0].replace(/#1$/, '#2'), withMemo.identities[0]?.replace(/#\d+$/, '#1')], 'bank-overlap:reinterpreted-reservation-kept (pure) ' + JSON.stringify([blankMemo.identities, withMemo.identities]));
  assert.ok(!blankMemo.identities.some(held(idA[0])), 'bank-overlap:reinterpreted-reservation-kept (pure: never a reserved identity)');
  // whatever is reserved (gaps included), a re-plan proposes only free identities, the same from the same snapshot, distinct per repeat
  const gaps = held(idA[0], idA[0].replace(/#1$/, '#3')), replanned = plan([], twinsNew, { mode: 'capture', coverage: cov, reserved: gaps });
  assert.deepEqual([replanned.identities[0], replanned.identities[2], replanned.identities.some(gaps)], [idA[0].replace(/#1$/, '#2'), idA[0].replace(/#1$/, '#4'), false], 'bank-overlap:replan-identity-free (pure) ' + JSON.stringify(replanned.identities));
  assert.deepEqual(plan([], twinsNew, { mode: 'capture', coverage: cov, reserved: gaps }).identities, replanned.identities, 'bank-overlap:replan-identity-free (pure: same snapshot, same identities)');
  // owner balance correction (build-resume-04, parent finding PARENT-BALANCE-CORRECTION-FINDING.md): row 'a' was imported with balance 900
  // (its provenance keeps 900) and the owner corrected the balance column on the same file to 1900 (its current balance). A capture stating
  // 1900 anchors to it; one stating the superseded 900 no longer does. A row without a current balance (written before it existed) is read
  // from its one provenance balance.
  const correctedRow = ex('a', '2026-08-05', 1200, 900, { balance: 1900 });
  const byCurrent = plan([correctedRow], [pl('2026-08-05', 1200, 1900, 2)], { mode: 'capture', coverage: cov }), byHistory = plan([correctedRow], [pl('2026-08-05', 1200, 900, 2)], { mode: 'capture', coverage: cov });
  assert.deepEqual([byCurrent.held, byCurrent.targets, byCurrent.via], [false, ['a'], ['anchor']], 'bank-overlap:owner-balance-correction-anchors (pure) ' + JSON.stringify(byCurrent));
  assert.deepEqual([byHistory.held, byHistory.code], [true, 'overlap-mismatch'], 'bank-overlap:owner-balance-correction-anchors (pure: the superseded balance no longer anchors)');
  assert.equal(typeof shared.bankRowBalance, 'function', 'bank-overlap:pure-export (bankRowBalance)');
  assert.deepEqual([shared.bankRowBalance(correctedRow), shared.bankRowBalance(ex('b', '2026-08-05', 1, 900)), shared.bankRowBalance(ex('c', '2026-08-05', 1, 900, { provenance: [prov('h0', 2, 900), prov('h1', 2, 800)] }))], [1900, 900, null], 'bank-overlap:current-balance-reader (pure)');
  // current identity of a reinterpretation (build-resume-05): the first ordinal of the row's NEW current tuple not yet reserved — the same
  // rule a created row follows, so an older writer that planned that tuple from the same snapshot collides with it
  assert.equal(typeof shared.bankCurrentIdentity, 'function', 'bank-overlap:pure-export (bankCurrentIdentity)');
  const july = ex('j', '2026-07-05', 1200, 998800), august = { ...july, date: '2026-08-05' }, augustFirst = shared.bankRowTuple(august, 998800) + '#1';
  assert.deepEqual([shared.bankCurrentIdentity(august, 998800, held(shared.bankRowTuple(july, 998800) + '#1')), shared.bankCurrentIdentity(august, 998800, held(augustFirst)), shared.bankCurrentIdentity({ ...august, idKind: 'bank-id' }, 998800, null), shared.bankCurrentIdentity(august, null, null)], [augustFirst, augustFirst.replace(/#1$/, '#2'), null, null], 'bank-overlap:current-identity-first-free (pure)');
  assert.equal(plan([], [pl('2026-08-05', 1200, 998800, 2)], { mode: 'capture', coverage: cov }).identities[0], shared.bankRowTuple({ ...pl('2026-08-05', 1200, 998800, 2) }, 998800) + '#1', 'bank-overlap:current-identity-same-rule-as-create (pure)');
  // confirmed bank IDs (build-resume-06, parent finding PARENT-BANK-ID-FINDING.md): the same source re-read with another confirmed ID column
  // is another ID's row, never an alias of the original ID's row; a file-row and a bank-ID row of one source stay distinct both ways
  const idRow = (id, key, extra = {}) => ({ ...pl('2026-08-05', 1200, 900, 2), key, idKind: 'bank-id', transactionId: id, ...extra });
  const confirmedA = ex('A', '2026-08-05', 1200, 900, { key: 'id:A', idKind: 'bank-id', transactionId: 'A', provenance: [prov('h1', 2, 900, 'upload')] });
  const fileRowA = ex('F', '2026-08-05', 1200, 900, { key: 'file:h1:S:2', provenance: [prov('h1', 2, 900, 'upload')] });
  assert.deepEqual([plan([confirmedA], [idRow('B', 'id:B')], { mode: 'owner' }).targets, plan([confirmedA], [pl('2026-08-05', 1200, 900, 2, { key: 'file:h1b:S:2' })], { mode: 'owner' }).targets, plan([fileRowA], [idRow('B', 'id:B')], { mode: 'owner' }).targets], [[null], [null], [null]], 'bank-overlap:bank-id-no-source-alias (pure)');
  assert.deepEqual(plan([confirmedA], [idRow('A', 'id:A')], { mode: 'owner' }).via, ['key'], 'bank-overlap:bank-id-key-resolution (pure)');
  assert.deepEqual(ownerCollector.identities, [null], 'bank-overlap:anchor-no-new-identity (pure)'); assert.deepEqual(plan([], [pl('2026-08-05', 1200, 900, 2)], { mode: 'resolve' }).identities, [null], 'bank-overlap:resolve-no-identity (pure)');
  return 'twins one-to-one, ambiguity/mismatch/period/balance holds, final-day tolerance, first-import repeats kept, key→source resolution, owner links only collector rows, resolve-only and superseded exclusions, canonical identities (same snapshot equal, repeats distinct, next free ordinal after copies/superseded/reinterpreted rows, re-plan never proposes a reserved identity)';
}

// Pure mutants of shared/finance-payment-match.mjs: a sibling copy with one named edit; each must fail its named pure assertion.
export const PURE_MUTANTS = [
  { name: 'S-M1-balance-dropped', anchor: /const tupleOf=\(r,balance\)=>JSON\.stringify\(\[r\.date,r\.direction,String\(r\.amount\),r\.currency,r\.description,r\.reference,r\.transactionId\|\|'',String\(balance\)\]\)/g, replacement: "const tupleOf=(r,balance)=>JSON.stringify([r.date,r.direction,String(r.amount),r.currency,r.description,r.reference,r.transactionId||''])", expect: /bank-overlap:same-day-twins \(pure\)/ },
  { name: 'S-M2-mismatch-skipped', anchor: /if\(missing\.length\)return hold\('overlap-mismatch'/g, replacement: "if(false)return hold('overlap-mismatch'", expect: /bank-overlap:wrong-account-held \(pure\)/ },
  { name: 'S-M3-period-skipped', anchor: /if\(outside\.length\)return hold\('period-mismatch'/g, replacement: "if(false)return hold('period-mismatch'", expect: /bank-overlap:period-held \(pure\)/ },
  { name: 'S-M4-first-candidate', anchor: /if\(group\.length!==1\|\|matches\.length!==1\)\{if\(capture\)return hold\('overlap-ambiguous'/g, replacement: "if(false){if(capture)return hold('overlap-ambiguous'", expect: /bank-overlap:ambiguous-held \(pure\)/ },
  { name: 'S-M5-key-only-resolution', anchor: /bySource=r\.idKind==='file-row'\?list\.filter\(/g, replacement: 'bySource=false?list.filter(', expect: /bank-overlap:owner-reimport-resolved \(pure\)/ },
  { name: 'S-M7-owner-links-any-row', anchor: /\(e\.provenance\|\|\[\]\)\.some\(p=>BANK_COLLECTOR_CHANNELS\.includes\(p\?\.channel\)\)/g, replacement: 'true', expect: /bank-overlap:owner-to-owner-distinct-kept \(pure\)/ },
  // S-M11 re-anchored for the reservation-history ordinal (its former anchor `n=(seen.get(t)||0)+1;` no longer exists): reserved
  // ordinals are not skipped, so a later copy proposes the identity an earlier row already holds
  { name: 'S-M11-ordinal-ignores-reservations', anchor: /let k=next\.get\(t\)\|\|1;while\(isReserved\(t\+'#'\+k\)\)k\+\+;/g, replacement: 'let k=next.get(t)||1;', expect: /bank-overlap:owner-copy-next-ordinal \(pure\)/ },
  // S-M12 reintroduces the candidate defect of 2026-10-22T12-45-50: an ordinal counted from the rows' CURRENT values (a reinterpreted
  // row no longer counts for the tuple it reserved)
  { name: 'S-M12-ordinal-from-current-values', anchor: /const identities=rows\.map\(\(\)=>null\),isReserved=typeof reserved==='function'\?reserved:\(\)=>false;/g, replacement: "const identities=rows.map(()=>null),isReserved=id=>{const h=id.lastIndexOf('#'),t=id.slice(0,h),n=Number(id.slice(h+1));return list.filter(e=>{const b=balanceOf(e);return b!==null&&tupleOf(e,b)===t}).length>=n};", expect: /bank-overlap:reinterpreted-reservation-kept \(pure\)/ },
  // within one file, a repeat restarts at the first ordinal (two genuine equal transactions would claim one identity)
  // S-M15 (build-resume-04): the anchor balance read from provenance only, ignoring the owner's current reviewed balance
  { name: 'S-M15-current-balance-ignored', anchor: /if\(typeof e\?\.balance==='number'&&Number\.isFinite\(e\.balance\)\)return e\.balance;/g, replacement: '', expect: /bank-overlap:owner-balance-correction-anchors \(pure\)/ },
  // S-M19 (build-resume-05): a reinterpretation's identity ignores the reservations (always ordinal 1)
  { name: 'S-M19-current-identity-ignores-reservations', anchor: /let k=1;while\(isReserved\(t\+'#'\+k\)\)k\+\+;return t\+'#'\+k\}/g, replacement: "let k=1;return t+'#'+k}", expect: /bank-overlap:current-identity-first-free \(pure\)/ },
  // S-M20 (build-resume-06): the reproduced regression — the recorded-source alias accepted for any id kind
  { name: 'S-M20-source-alias-any-kind', anchor: /bySource=r\.idKind==='file-row'\?list\.filter\(e=>e\.idKind==='file-row'&&\(e\.provenance\|\|\[\]\)/g, replacement: 'bySource=true?list.filter(e=>(e.provenance||[])', expect: /bank-overlap:bank-id-no-source-alias \(pure\)/ },
  { name: 'S-M13-repeat-same-ordinal', anchor: /next\.set\(t,k\+1\)/g, replacement: 'next.set(t,1)', expect: /bank-overlap:canonical-identity-repeats-distinct \(pure\)/ }
];
// ── The paused holder (parent finding output/plan/omf-paypay-routine-20261022/PARENT-LEASE-FINDING.json). The older capture's
// request pauses AFTER planning and its lease check, before its first write, for longer than the unchanged 60 s lease; a newer
// different-byte overlapping capture starts 61.5 s after the pause, takes the account over and completes; then the older request
// writes. The pause is a fault injected only into the owned runtime copy (STALE_PAUSE); the product lease is not changed. ──
const STALE_PAUSE_MS = 70000, STALE_NEWER_AFTER_MS = 61500;
// The paused request resumes only after BOTH the original 70 s and the fixture's release marker (written once the newer capture has
// completed), so the parent's observed order — newer capture finished, then the older write — is reproduced deterministically.
const STALE_PAUSE = [/await BankRow\.create\(\{ \.\.\.filter, \.\.\.r, revision: 1, history:/g, "const __omfFixtureFs = await import('node:fs/promises'); const __omfFixturePath = await import('node:path'); if (!globalThis.__omfFixturePaused) { globalThis.__omfFixturePaused = true; await __omfFixtureFs.writeFile(__omfFixturePath.join(process.env.OMF_DATA_DIR, 'fixture-pause-marker'), String(Date.now())); for (const t0 = Date.now(); Date.now() - t0 < 600000; ) { if (Date.now() - t0 >= " + STALE_PAUSE_MS + " && await __omfFixtureFs.readFile(__omfFixturePath.join(process.env.OMF_DATA_DIR, 'fixture-release')).then(() => true, () => false)) break; await new Promise(resolve => setTimeout(resolve, 200)); } } await BankRow.create({ ...filter, ...r, revision: 1, history:", 'stale-pause'];
// Build-resume-05 (parent finding PARENT-CURRENT-IDENTITY-FINDING.md, probe parent-rerun-04/current-identity-race-probe.mjs): the same
// injected pause, armed only by a marker file, so the owner's own first import is not the paused write.
const ARMED_PAUSE = [/await BankRow\.create\(\{ \.\.\.filter, \.\.\.r, revision: 1, history:/g, "const __omfFixtureFs = await import('node:fs/promises'); const __omfFixturePath = await import('node:path'); if (!globalThis.__omfFixtureArmedPaused && await __omfFixtureFs.readFile(__omfFixturePath.join(process.env.OMF_DATA_DIR, 'fixture-arm')).then(() => true, () => false)) { globalThis.__omfFixtureArmedPaused = true; await __omfFixtureFs.writeFile(__omfFixturePath.join(process.env.OMF_DATA_DIR, 'fixture-pause-marker'), String(Date.now())); for (const t0 = Date.now(); Date.now() - t0 < 600000; ) { if (Date.now() - t0 >= " + STALE_PAUSE_MS + " && await __omfFixtureFs.readFile(__omfFixturePath.join(process.env.OMF_DATA_DIR, 'fixture-release')).then(() => true, () => false)) break; await new Promise(resolve => setTimeout(resolve, 200)); } } await BankRow.create({ ...filter, ...r, revision: 1, history:", 'armed-pause'];
// The owner imports a row dated 07-05 (another column holds the correct 08-05). An August capture of the same transaction plans one new
// 08-05 row (the July row is outside its period) and is paused before its write, past the unchanged 60 s lease. The owner then corrects the
// date column on the same file (200, 08-05, revision 2, original id/key/canonicalKey). The paused write, released only after the owner's
// answer, must not publish a second row for the transaction (candidate before build-resume-05: 200, new 1, two identical rows).
async function identityRaceScenario(a, assert, dataDir) {
  const { ObjectId } = requireRoot('mongodb'), api = '/api/finance-payments/', capi = '/api/finance-payments/collector/';
  const ok = (r, label) => { assert.equal(r.status, 200, 'bank-overlap:identity-race-' + label + ' ' + JSON.stringify(r.data).slice(0, 400) + (r.status >= 500 ? ' | app log: ' + a.logs().slice(-2500) : '')); return r.data; };
  const req = (r, b, m = 'POST') => a.call(api + r, { method: m, token: a.token, body: b });
  const acc = ok(await req('bank/accounts', { name: 'Identity race ' + randomUUID().slice(0, 6), currency: 'JPY' }), 'account').account.id;
  ok(await req('bank/collectors/' + a.deviceId, { bankAccountIds: [acc] }, 'PUT'), 'scope');
  const rows = () => a.db.collection('financebankrows').find({ bankAccountId: new ObjectId(acc) }).sort({ _id: 1 }).toArray();
  const bytes = Buffer.from('date,description,amount,balance,correctDate\r\n2026-07-05,Demo purchase,1200,998800,2026-08-05\r\n', 'utf8');
  const doc = ok(await a.call(api + 'bank/files?name=identity-race.csv', { method: 'POST', token: a.token, body: bytes, type: 'text/csv' }), 'upload').document, sheet = ok(await req('bank/files/' + doc.id + '/sheet', undefined, 'GET'), 'sheet');
  const mapping = { date: '0', description: '1', amount: '2', outflow: '', inflow: '', balance: '3', reference: '', transactionId: '', currency: '', direction: '' }, body = { sheet: sheet.sheet, headerRow: sheet.headerRow, bankAccountId: acc, mapping, amountSign: 'outflow-positive', confirm: true };
  ok(await req('bank/files/' + doc.id + '/import', body), 'owner-first');
  assert.equal(existsSync(path.join(dataDir, 'fixture-pause-marker')), false, 'bank-overlap:identity-race-unarmed-owner-never-paused');
  const first = (await rows())[0]; assert.deepEqual([first?.date, typeof first?.canonicalKey, first?.canonicalKeys], ['2026-07-05', 'string', [first?.canonicalKey]], 'bank-overlap:identity-race-setup');
  const template = ok(await req('bank/templates', { name: 'Identity race ' + randomUUID().slice(0, 6), headers: sheet.headers, mapping }, 'PUT'), 'template').template;
  ok(await req('bank/accounts/' + acc + '/connection', { provider: 'rakuten', variant: 'standard', templateId: template.id, coverage: { from: '2026-08-01', to: '2026-08-31' } }, 'PUT'), 'connection');
  const job = ok(await req('bank/accounts/' + acc + '/sync', {}), 'queue').job, claimed = ok(await a.call(capi + 'bank/claim', { method: 'POST', token: a.deviceToken, body: {} }), 'claim').job; assert.equal(claimed?.jobId, job.jobId, 'bank-overlap:identity-race-claim');
  ok(await a.call(capi + 'bank/status', { method: 'POST', token: a.deviceToken, body: { jobId: job.jobId, state: 'complete', message: 'synthetic' } }), 'status');
  const captured = Buffer.from('date,description,amount,balance,correctDate\r\n2026-08-05,Demo purchase,1200,998800,2026-08-05\r\n', 'utf8');
  const upload = () => a.call(capi + 'bank/upload?' + new URLSearchParams({ jobId: job.jobId, snapshotHash: job.snapshotHash, kind: 'statement', channel: 'collector', name: 'identity-race-capture.csv', sourceHost: 'fes.rakuten-bank.co.jp', capturedAt: new Date().toISOString(), labelChecked: 'false' }), { method: 'POST', token: a.deviceToken, body: captured, type: 'text/csv' });
  await writeFile(path.join(dataDir, 'fixture-arm'), '1'); const olderPromise = upload(), marker = path.join(dataDir, 'fixture-pause-marker');
  let pausedAt = null; for (let i = 0; i < 1200 && pausedAt === null; i++) { if (existsSync(marker)) pausedAt = Number(await readFile(marker, 'utf8')); else await pause(100); }
  assert.ok(pausedAt, 'bank-overlap:identity-race-pause-entered (the older capture reached its paused write)');
  await pause(Math.max(0, pausedAt + STALE_NEWER_AFTER_MS - Date.now()));
  const correction = await req('bank/files/' + doc.id + '/import', { ...body, mapping: { ...mapping, date: '4' } }), atOwner = await rows();
  await writeFile(path.join(dataDir, 'fixture-release'), String(Date.now())); const older = await olderPromise, pausedFor = Date.now() - pausedAt, final = await rows();
  const tuples = final.map(r => JSON.stringify([r.date, r.amount, r.description, r.balance])), detail = { ownerStatus: correction.status, ownerRowsAtResponse: atOwner.length, ownerDate: atOwner[0]?.date, ownerRevision: atOwner[0]?.revision, olderStatus: older.status, olderState: older.data?.state, olderRows: older.data?.rows, finalRows: final.length, duplicateTupleRows: tuples.length - new Set(tuples).size, olderPausedAtLeastMs: pausedFor };
  assert.ok(pausedFor >= STALE_PAUSE_MS, 'bank-overlap:identity-race-pause-held ' + pausedFor);
  assert.deepEqual([correction.status, atOwner.length, atOwner[0]?.date, atOwner[0]?.revision, String(atOwner[0]?._id), atOwner[0]?.key, atOwner[0]?.canonicalKey], [200, 1, '2026-08-05', 2, String(first._id), first.key, first.canonicalKey], 'bank-overlap:identity-race-owner-correction ' + JSON.stringify(detail));
  assert.deepEqual([final.length, detail.duplicateTupleRows], [1, 0], 'bank-overlap:identity-race-no-duplicate ' + JSON.stringify(detail));
  assert.equal(older.status, 409, 'bank-overlap:identity-race-older-stopped ' + JSON.stringify(detail));
  assert.deepEqual([final[0].canonicalKey, final[0].canonicalKeys.length, final[0].canonicalKeys[0]], [first.canonicalKey, 2, first.canonicalKey], 'bank-overlap:identity-race-reservations (original kept, the corrected identity added)');
  const retried = ok(await upload(), 'retry'), after = await rows();
  assert.deepEqual([retried.state, retried.rows.new, retried.rows.existing, after.length, String(after[0]._id)], ['imported', 0, 1, 1, String(first._id)], 'bank-overlap:identity-race-retry-links ' + JSON.stringify(retried));
  return detail;
}
async function staleScenario(a, assert, dataDir) {
  const { ObjectId } = requireRoot('mongodb'), api = '/api/finance-payments/', capi = '/api/finance-payments/collector/';
  const ok = (r, label) => { assert.equal(r.status, 200, 'bank-overlap:stale-' + label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
  const req = (r, b, m = 'POST') => a.call(api + r, { method: m, token: a.token, body: b });
  const acc = ok(await req('bank/accounts', { name: 'Paused holder ' + randomUUID().slice(0, 6), currency: 'JPY' }), 'account').account.id;
  ok(await req('bank/collectors/' + a.deviceId, { bankAccountIds: [acc] }, 'PUT'), 'scope');
  const job = async to => { ok(await req('bank/accounts/' + acc + '/connection', { provider: 'rakuten', variant: 'standard', coverage: { from: '2026-08-01', to } }, 'PUT'), 'connection'); const j = ok(await req('bank/accounts/' + acc + '/sync', {}), 'queue').job; const c = ok(await a.call(capi + 'bank/claim', { method: 'POST', token: a.deviceToken, body: {} }), 'claim').job; assert.equal(c?.jobId, j.jobId, 'bank-overlap:stale-claim-own-job'); ok(await a.call(capi + 'bank/status', { method: 'POST', token: a.deviceToken, body: { jobId: j.jobId, state: 'complete', message: 'synthetic' } }), 'status'); return j; };
  const upload = (j, b) => a.call(capi + 'bank/upload?' + new URLSearchParams({ jobId: j.jobId, snapshotHash: j.snapshotHash, kind: 'statement', channel: 'collector', name: 'fictional.csv', sourceHost: 'fes.rakuten-bank.co.jp', capturedAt: new Date().toISOString(), labelChecked: 'false' }), { method: 'POST', token: a.deviceToken, body: b, type: 'text/csv' });
  const ja = await job('2026-08-31'), jb = await job('2026-09-30'), bytesA = nativeCsv(MASTER, '2026-08-01', '2026-08-31'), bytesB = nativeCsv(MASTER, '2026-08-01', '2026-09-30');
  const first = upload(ja, bytesA), marker = path.join(dataDir, 'fixture-pause-marker'); let marked = false;
  for (let i = 0; i < 1200; i++) { if (existsSync(marker)) { marked = true; break; } await pause(100); }
  assert.ok(marked, 'bank-overlap:stale-pause-entered (the injected pause before the first write was reached)');
  const markedAt = Number(await readFile(marker, 'utf8')); await pause(Math.max(0, markedAt + STALE_NEWER_AFTER_MS - Date.now()));
  const newer = await upload(jb, bytesB); await writeFile(path.join(dataDir, 'fixture-release'), String(Date.now())); const older = await first;
  const pausedFor = Date.now() - markedAt;
  const list = await a.db.collection('financebankrows').find({ bankAccountId: new ObjectId(acc) }).toArray();
  const tuples = list.map(r => JSON.stringify([r.date, r.amount, r.description, r.provenance.find(p => typeof p.balance === 'number')?.balance])), duplicates = tuples.length - new Set(tuples).size;
  const detail = { olderStatus: older.status, olderMessage: String(older.data?.data?.message || older.data?.statusMessage || '').slice(0, 120), newerStatus: newer.status, newerState: newer.data?.state, canonicalRows: list.length, expectedTransactions: 6, duplicateTupleRows: duplicates, olderPausedAtLeastMs: pausedFor };
  assert.ok(pausedFor >= STALE_PAUSE_MS, 'bank-overlap:stale-pause-held (the older write waited at least the original pause) ' + pausedFor);
  assert.equal(newer.status, 200, 'bank-overlap:stale-newer-imported ' + JSON.stringify(detail)); assert.equal(newer.data.state, 'imported', 'bank-overlap:stale-newer-imported');
  assert.deepEqual([list.length, duplicates], [6, 0], 'bank-overlap:stale-holder-no-duplicate ' + JSON.stringify(detail));
  assert.equal(older.status, 409, 'bank-overlap:stale-holder-stopped (the late writer stops instead of writing) ' + JSON.stringify(detail));
  // the older delivery is retried as the collector does (its manifest stays unacknowledged): it re-plans under the lease and links
  const retried = ok(await upload(ja, bytesA), 'retry'), after = await a.db.collection('financebankrows').find({ bankAccountId: new ObjectId(acc) }).toArray(), hashA = sha256(bytesA);
  assert.deepEqual([retried.state, retried.rows.new, retried.rows.existing, after.length], ['imported', 0, 4, 6], 'bank-overlap:stale-holder-recovers ' + JSON.stringify(retried));
  assert.equal(after.filter(r => r.provenance.some(p => p.hash === hashA)).length, 4, 'bank-overlap:stale-holder-recovers (older source recorded on 4 canonical rows)');
  assert.ok(after.every(r => r.revision === 1 && r.provenance[0].hash === sha256(bytesB)), 'bank-overlap:stale-holder-recovers (canonical rows are the newer capture, revisions kept)');
  return detail;
}

// One owned immutable runtime copy for every built-chunk edit (the fault injection and the mutants): each leg applies its edits
// (every anchor must hit exactly once across the chunks), boots its own app on its own database, and afterwards every touched
// chunk is restored and its sha256 compared with the original before the next leg.
async function runtimeCopy(temp) {
  const copy = path.join(temp, 'runtime'); await mkdir(copy, { recursive: true }); await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
  const originals = new Map(); for (const f of await files(path.join(copy, '.output/server/chunks'))) originals.set(f, await readFile(f, 'utf8'));
  return { copy, originals, restored: 0 };
}
async function withEdits(rt, edits, fn) {
  const touched = new Map();
  try {
    for (const [anchor, replacement, label] of edits) { let hits = 0; for (const f of rt.originals.keys()) { const text = touched.get(f) ?? rt.originals.get(f), n = (text.match(anchor) || []).length; if (n) { hits += n; touched.set(f, text.replace(anchor, () => replacement)); } } if (hits !== 1) throw new Error('harness: ' + label + ' anchor hits ' + hits); }
    for (const [f, text] of touched) await writeFile(f, text);
    return await fn();
  } finally {
    for (const f of touched.keys()) { await writeFile(f, rt.originals.get(f)); if (sha256(await readFile(f)) !== sha256(Buffer.from(rt.originals.get(f), 'utf8'))) throw new Error('harness: runtime chunk not restored ' + f); rt.restored++; }
  }
}
// Built-chunk mutants of the server; each must fail its named native assertion on its own owned app.
export const SERVER_MUTANTS = [
  { name: 'S-M6-revision-on-anchor', edits: [[/if \(!hasProof\) update\.\$addToSet = \{ provenance: proof \};/g, 'if (!hasProof) { update.$addToSet = { provenance: proof }; update.$inc = { revision: 1 }; }', 'S-M6']], legs: ['repeat-anchored'], expect: /bank-overlap:anchor-revision-stable/ },
  { name: 'S-M7-anchor-observe-capture', edits: [[/const overlapMode = job\.kind === "retrieve" && frozen\.coverage && mapping\.balance !== "" \? "capture" : "resolve";/g, 'const overlapMode = "capture";', 'S-M7']], legs: ['unchanged-lanes'], expect: /bank-overlap:observe-unchanged|bank-overlap:no-balance-unchanged/ },
  // S-M8: without the lease a request never waits for a live holder. Its earlier expectation (any of the race legs) was not met: with
  // the canonical reservation still in place a bypassed race fails at an unnamed `race-a` 409 (worker-logs/S2-full-green-1.txt, kept
  // as the failed attempt), so the mutant is pinned to the lost behaviour itself — the capture did not wait for the live holder.
  { name: 'S-M8-serialization-bypassed', edits: [[/const got = await BankAccount\.findOneAndUpdate\(/g, 'const got = true || await BankAccount.findOneAndUpdate(', 'S-M8']], legs: ['live-lock-waits'], expect: /bank-overlap:live-lock-waits \(the capture waited for the live holder\)|bank-overlap:live-lock-owned/ },
  // S-M12n: the parent's confirmed candidate defect, natively — the shared ordinal counted from the rows' current values
  { name: 'S-M12n-ordinal-from-current-values', edits: [[/const identities=rows\.map\(\(\)=>null\),isReserved=typeof reserved==='function'\?reserved:\(\)=>false;/g, "const identities=rows.map(()=>null),isReserved=id=>{const h=id.lastIndexOf('#'),t=id.slice(0,h),n=Number(id.slice(h+1));return list.filter(e=>{const b=balanceOf(e);return b!==null&&tupleOf(e,b)===t}).length>=n};", 'S-M12n']], legs: ['owner-reinterpretation'], expect: /bank-overlap:owner-reinterpretation \(copy imported\)/ },
  // S-M14: the service stops handing the account's reservation history to the planner
  // S-M16n (build-resume-04): the parent's reproduced defect — the balance is not part of the owner reinterpretation (excluded from the
  // change check); S-M17n: the change is detected but the corrected balance is not recorded as the row's current balance
  { name: 'S-M16n-balance-not-compared', edits: [[/changed = fields\.some\(\(k\) => old\[k\] !== r\[k\]\) \|\| balanceChanged;/g, 'changed = fields.some((k) => old[k] !== r[k]);', 'S-M16n']], legs: ['owner-balance-correction'], expect: /bank-overlap:owner-balance-correction \(corrected on the same file/ },
  { name: 'S-M17n-corrected-balance-not-recorded', edits: [[/if \(balanceChanged\) update\.\$set\.balance = r\.balance;/g, '', 'S-M17n']], legs: ['owner-balance-correction'], expect: /bank-overlap:owner-balance-correction \(corrected on the same file/ },
  { name: 'S-M20n-source-alias-any-kind', edits: [[/bySource=r\.idKind==='file-row'\?list\.filter\(e=>e\.idKind==='file-row'&&\(e\.provenance\|\|\[\]\)/g, 'bySource=true?list.filter(e=>(e.provenance||[])', 'S-M20n']], legs: ['bank-id-compat'], expect: /bank-overlap:bank-id-compat \(A kept on its row/ },
  { name: 'S-M14-reservations-not-passed', edits: [[/reserved: \(identity\) => reservedKeys\.has\(canonicalKeyOf\(identity\)\) \}\);/g, 'reserved: null });', 'S-M14']], legs: ['owner-reinterpretation'], expect: /bank-overlap:owner-reinterpretation \(copy imported\)/ },
  // S-M9 re-anchored for build-resume-05 (the created row now reserves its identity in canonicalKey AND canonicalKeys): both dropped
  { name: 'S-M9-canonical-reservation-dropped', edits: [STALE_PAUSE, [/row\.canonicalKey = canonicalKeyOf\(resolved\.identities\[i\]\);\s+row\.canonicalKeys = \[row\.canonicalKey\];/g, '', 'S-M9']], stale: true, expect: /bank-overlap:stale-holder-no-duplicate/ },
  // S-M18n (build-resume-05): the parent's reproduced defect — an owner reinterpretation does not reserve the row's new current identity
  { name: 'S-M18n-reinterpretation-identity-not-reserved', edits: [ARMED_PAUSE, [/update\.\$addToSet = \{ \.\.\.update\.\$addToSet \|\| \{\}, canonicalKeys: \{ \$each: \[\.\.\.typeof old\.canonicalKey === "string" \? \[old\.canonicalKey\] : \[\], k\] \} \};/g, '', 'S-M18n']], stale: 'identity', expect: /bank-overlap:identity-race-no-duplicate/ },
  { name: 'S-M10-collision-taken-as-new-row', edits: [STALE_PAUSE, [/if \(!old\) fail\(409, CANONICAL_TAKEN\);/g, 'if (!old) { const { canonicalKey: _taken, canonicalKeys: _takenAll, ...copy } = r; await BankRow.create({ ...filter, ...copy, revision: 1, history: [{ at: new Date(), action: "imported" }] }); counts.new++; continue; }', 'S-M10']], stale: true, expect: /bank-overlap:stale-holder-no-duplicate/ }
];

export default { name: 'omf-bank-overlap-capture', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, executed = false;
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1400)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-overlap-fixture-'));
  let mongo = null, app = null, nativeGreen = false, rt = null;
  try {
    await leg('P pure bankOverlapPlan decisions (shared module)', async () => pureChecks(await import(u('shared/finance-payment-match.mjs')), assert));
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server'); const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), parentBinary = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
    const systemBinary = existsSync(binary) ? binary : existsSync(parentBinary) ? parentBinary : null;
    if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('built app absent; no native coverage');
    mongo = await MongoMemoryServer.create({ binary: systemBinary ? { systemBinary, version: '8.2.1' } : undefined, instance: { launchTimeout: 180000 } });
    app = await bootApp(root, mongo, 'overlap_fixture', path.join(temp, 'data')); executed = true;
    const names = ['repeat-anchored', 'rakuten-repeat-anchored', 'quiet-and-later-no-hold', 'wrong-account-held', 'period-held', 'ambiguous-held', 'owner-links-collector-rows', 'owner-reinterpretation', 'owner-balance-correction', 'bank-id-compat', 'unchanged-lanes', 'race-captures', 'race-owner-capture', 'race-same-bytes', 'live-lock-waits', 'stale-lock-and-crash-recovery'];
    const only = process.env.OMF_OVERLAP_LEGS ? process.env.OMF_OVERLAP_LEGS.split(',') : null;
    let green = 0;
    for (const name of names) { if (only && !only.includes(name)) { lines.push('N ' + name + ': NOT RUN (OMF_OVERLAP_LEGS selection)'); continue; } if (await leg('N ' + name + ' (native API, owned MongoDB)', async () => (await scenario(app, assert, [name])).join('; '))) green++; }
    await app.close(); app = null;
    const staleGreen = await leg(`F paused holder on the owned runtime copy (fault injection: first write paused ${STALE_PAUSE_MS} ms > unchanged 60 s lease; newer different-byte capture at +${STALE_NEWER_AFTER_MS} ms)`, async () => {
      rt ??= await runtimeCopy(temp); const dataDir = path.join(temp, 'data-stale'); await mkdir(dataDir, { recursive: true });
      return withEdits(rt, [STALE_PAUSE], async () => { const a = await bootApp(rt.copy, mongo, 'overlap_stale', dataDir); try { return JSON.stringify(await staleScenario(a, assert, dataDir)); } finally { await a.close(); } });
    });
    const raceGreen = await leg(`F2 owner date correction during an expired capture write (fault injection: the capture's write paused ${STALE_PAUSE_MS} ms > unchanged 60 s lease, armed after the owner's first import; owner correction at +${STALE_NEWER_AFTER_MS} ms)`, async () => {
      rt ??= await runtimeCopy(temp); const dataDir = path.join(temp, 'data-identity'); await mkdir(dataDir, { recursive: true });
      return withEdits(rt, [ARMED_PAUSE], async () => { const a = await bootApp(rt.copy, mongo, 'overlap_identity', dataDir); try { return JSON.stringify(await identityRaceScenario(a, assert, dataDir)); } finally { await a.close(); } });
    });
    nativeGreen = !only && green === names.length && staleGreen && raceGreen;
    await leg('M pure mutants of shared/finance-payment-match.mjs flip their named assertion (an anchor that does not hit exactly once is a harness failure)', async () => {
      const source = await readFile(path.join(root, 'shared/finance-payment-match.mjs'), 'utf8'), caught = [];
      for (const m of PURE_MUTANTS) {
        const hits = (source.match(m.anchor) || []).length; if (hits !== 1) throw new Error(m.name + ' anchor hits ' + hits);
        const target = path.join(root, 'shared', `finance-payment-match.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`); await writeFile(target, source.replace(m.anchor, () => m.replacement), { flag: 'wx' });
        let error = null; try { pureChecks(await import(pathToFileURL(target).href), assert); } catch (e) { error = e; } finally { await unlink(target).catch(() => {}); }
        if (!error || !m.expect.test(String(error.message))) throw new Error(m.name + ' did not flip ' + m.expect + ': ' + String(error?.message || 'passed').slice(0, 300));
        caught.push(m.name);
      }
      return caught.length + '/' + PURE_MUTANTS.length + ' caught: ' + caught.join(', ');
    });
    await leg('S server mutants on the owned runtime copy flip their named native assertion (chunks restored and hash-checked after each)', async () => {
      if (!nativeGreen) throw new Error('NOT RUN: every native leg and the paused-holder leg must be green first');
      rt ??= await runtimeCopy(temp); const caught = [];
      for (const m of SERVER_MUTANTS) {
        const dataDir = path.join(temp, 'data-' + m.name); await mkdir(dataDir, { recursive: true });
        let error = null;
        await withEdits(rt, m.edits, async () => { const a = await bootApp(rt.copy, mongo, 'overlap_' + m.name.toLowerCase().replace(/[^a-z0-9]/g, '_'), dataDir); try { if (m.stale === 'identity') await identityRaceScenario(a, assert, dataDir); else if (m.stale) await staleScenario(a, assert, dataDir); else await scenario(a, assert, m.legs); } catch (e) { if (/^harness:/.test(String(e?.message))) throw e; error = e; } finally { await a.close(); } });
        if (!error || !m.expect.test(String(error.message))) throw new Error(m.name + ' did not flip ' + m.expect + ': ' + String(error?.message || 'passed').slice(0, 300));
        caught.push(m.name + '→' + String(error.message).match(m.expect)[0]);
      }
      return caught.length + '/' + SERVER_MUTANTS.length + ' caught: ' + caught.join(', ') + `; ${rt.restored} chunk restorations hash-verified`;
    });
  } catch (e) { pass = false; lines.push('harness: RED ' + String(e?.message || e).slice(0, 1200)); }
  finally {
    if (app) await app.close().catch(() => {}); if (mongo) await mongo.stop().catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };

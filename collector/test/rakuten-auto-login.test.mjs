// collector/test/rakuten-auto-login.test.mjs — the saved-login lane of a 楽天銀行 standard retrieval (plan
// omf-rakuten-auto-login-20261021 §1-§2): ensureBankLogin/collectBankFromPage with a page-less ui and a fictional saved login,
// runBankJob's hand-over, and index.mjs bankLoginFor over an in-memory sealed-entry store. The page-driving legs (the exact
// public login form in owned Chrome on an intercepted fake portal) run in scripts/zoomer-fixtures/omf-rakuten-auto-login.mjs.
// Fictional values only; no bank, OMF, vault or browser is reached here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-auto-login-test-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
const bank = await import('../bank.mjs');
const rakuten = await import('../banks/rakuten.mjs');
const index = await import('../index.mjs');
const { aadOf } = await import('../vault.mjs');
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const ACCOUNT = { _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4', name: 'Fictional Rakuten' }, ORIGIN = 'https://omf.example';
const CSV = Buffer.from('取引日,入出金(円),残高(円),入出金先内容\r\n20251201,250000,2250000,振込\r\n');
const SECRET = Object.freeze({ username: 'fictional-user-01', password: 'Fictional-Pass-0001' });
const snapshot = (variant = 'standard') => ({ templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', templateRevision: 1, headers: ['取引日'], mapping: { date: '0' }, amountSign: 'outflow-negative', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'rakuten', accountLabel: null, variant, coverage: { from: '2025-11-01', to: '2026-10-01' } });
const jobOf = (kind = 'retrieve', variant = 'standard') => { const s = snapshot(variant); return { jobId: randomUUID(), kind, snapshot: s, snapshotHash: sha256(JSON.stringify(s)), provider: 'rakuten' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT._id, ownerId: ACCOUNT.ownerId, origin: ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'rakuten' });
const ADAPTER = { provider: 'rakuten', label: '楽天銀行', variant: 'standard', support: 'verified', hosts: ['rakuten-bank.co.jp'], contract: {} };

// A page-less standard ui with a virtual clock: the login form, its one submission and the routine steps after it.
function pageUi({ start = 'login', form = true, outcome = 'authenticated', deliver = true } = {}) {
  const clock = { t: 1_800_000_000_000 }, calls = { open: 0, show: 0, loginForm: 0, login: 0, openStatements: 0, selectPeriod: 0, exportCsv: 0, secrets: [] };
  let kind = start, doc = 'doc-1', handlers = {}, jobDir = null; const journalSeen = [];
  const emit = (event, value) => { for (const h of handlers[event] || []) h(value); };
  const ui = {
    calls, clock, now: () => clock.t, async wait(ms) { clock.t += ms; },
    async open() { calls.open++; }, async state() { return { kind }; }, async show() { calls.show++; },
    async loginForm() { calls.loginForm++; return form && kind === 'login' ? { ok: true, document: doc } : { ok: false, reason: 'form' }; },
    async document() { return doc; },
    async login(secret, { signal } = {}) {
      calls.login++; calls.secrets.push({ ...secret }); journalSeen.push(jobDir ? await exists(path.join(jobDir, 'login.json')) : null); signal?.throwIfAborted();
      const before = doc; doc = 'doc-' + (calls.login + 1);
      kind = outcome === 'authenticated' ? 'authenticated' : outcome === 'rejected' ? 'login' : 'unknown';
      return { outcome, document: before };
    },
    async openStatements() { calls.openStatements++; kind = 'export_ready'; }, async selectPeriod() { calls.selectPeriod++; },
    async snapshot() { return { accountLabel: 'カクウホールディングス', period: '2025-11-01〜2026-10-01' }; },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { (handlers[event] ||= []).push(handler); }, async close() { handlers = {}; } }; },
    async exportCsv() { calls.exportCsv++; if (!deliver) return; const guid = randomUUID(); await writeFile(path.join(jobDir, guid), CSV); emit('Browser.downloadWillBegin', { guid, url: 'https://fes.rakuten-bank.co.jp/XMS/inquiry/download', suggestedFilename: 'RB-torihikimeisai.csv' }); emit('Browser.downloadProgress', { guid, state: 'completed', totalBytes: CSV.length }); },
    signIn() { kind = 'authenticated'; }, toLogin() { kind = 'login'; doc = 'doc-x' + calls.login; }, setKind(k) { kind = k; }, set jobDir(v) { jobDir = v; }, journalSeen
  };
  return ui;
}
// A fictional saved login with the interface bank.mjs expects: state() (no decryption), open() (once), rejected(), accepted().
function savedLogin({ state = 'ready', openError = null, onOpen = null } = {}) {
  const calls = { state: 0, open: 0, rejected: 0, accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; await onOpen?.(); if (openError) throw openError; return { ...SECRET }; }, async rejected() { calls.rejected++; current = 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const statuses = () => { const list = []; const fn = async (state, text) => { list.push([state, text]); }; fn.list = list; return fn; };
const attentions = s => s.list.filter(([state]) => state === 'verification_required');
const root = async () => { const dir = path.join(temp, randomUUID().slice(0, 8)); await mkdir(dir, { recursive: true }); return dir; };
const collect = async (ui, job, login, extra = {}) => { const dir = await root(), status = statuses(); let result = null, error = null; try { result = await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, status, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, loginTimeoutMs: 20000, ...extra }); } catch (e) { error = e; } return { dir, status, result, error }; };

test('a ready saved login on the exact login form: one decryption, one submission, no attention, then the routine steps and one export', async () => {
  const ui = pageUi(), login = savedLogin(), r = await collect(ui, jobOf(), login);
  assert.equal(r.error, null, String(r.error?.stack || r.error));
  assert.equal(r.result.failed, null); assert.equal(r.result.items.length, 1, 'auto-login:export-after-auth');
  assert.equal(login.calls.open, 1, 'auto-login:one-decryption'); assert.equal(ui.calls.login, 1, 'auto-login:one-submit');
  assert.deepEqual(ui.calls.secrets, [SECRET], 'auto-login:own-secret-submitted');
  assert.equal(attentions(r.status).length, 0, 'auto-login:no-manual-attention'); assert.equal(ui.calls.show, 0);
  assert.equal(login.calls.accepted, 1, 'auto-login:accepted-recorded'); assert.equal(login.calls.rejected, 1);
  assert.deepEqual([ui.calls.openStatements, ui.calls.exportCsv], [1, 1]);
  assert.ok(!JSON.stringify(r.status.list).includes(SECRET.password) && !JSON.stringify(r.status.list).includes(SECRET.username), 'auto-login:no-secret-in-status');
  assert.ok(!JSON.stringify(r.result).includes(SECRET.password), 'auto-login:no-secret-in-result');
});

test('already authenticated, no saved login, no login object: nothing is decrypted; the person signs in exactly as before', async () => {
  const signedIn = pageUi({ start: 'authenticated' }), l1 = savedLogin(), a = await collect(signedIn, jobOf(), l1);
  assert.equal(a.error, null); assert.equal(l1.calls.open, 0, 'auto-login:authenticated-no-decryption'); assert.equal(signedIn.calls.login, 0); assert.equal(attentions(a.status).length, 0);
  for (const login of [savedLogin({ state: 'none' }), null]) {
    const ui = pageUi(), job = jobOf(), dir = await root(), status = async (state, text) => { status.list.push([state, text]); if (state === 'verification_required') ui.signIn(); }; status.list = [];
    const r = await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, status, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, loginTimeoutMs: 20000 });
    assert.equal(r.items.length, 1); assert.equal(ui.calls.login, 0, 'auto-login:manual-no-submit'); if (login) assert.equal(login.calls.open, 0, 'auto-login:none-no-decryption');
    assert.deepEqual(attentions(status).map(([, t]) => t), ['楽天銀行にChromeでサインインしてください'], 'auto-login:manual-message-unchanged');
  }
});

test('the bank refuses the saved login: one submission, the refusal is remembered, no retry while polling, a clear failure, no export', async () => {
  const ui = pageUi({ outcome: 'rejected' }), login = savedLogin(), r = await collect(ui, jobOf(), login, { loginTimeoutMs: 30000 });
  assert.equal(r.error, null, String(r.error?.stack || r.error)); assert.equal(r.result.items.length, 0);
  assert.match(String(r.result.failed), /受け付けませんでした.*保存し直/, 'auto-login:refused-actionable');
  assert.equal(ui.calls.login, 1, 'auto-login:one-submit (no retry storm)'); assert.equal(login.calls.open, 1); assert.equal(login.calls.rejected, 1, 'auto-login:refusal-remembered'); assert.equal(login.calls.accepted, 0);
  assert.equal(attentions(r.status).length, 1, 'auto-login:one-attention'); assert.match(attentions(r.status)[0][1], /受け付けませんでした/);
  assert.equal(ui.calls.exportCsv, 0, 'auto-login:no-export-before-auth'); assert.equal(ui.calls.openStatements, 0);
  // the next job with the same (now blocked) saved login: nothing decrypted, nothing submitted, the person is asked
  const next = pageUi(), r2 = await collect(next, jobOf(), login, { loginTimeoutMs: 5000 });
  assert.equal(next.calls.login, 0, 'auto-login:blocked-after-refusal'); assert.equal(login.calls.open, 1, 'auto-login:blocked-no-decryption');
  assert.match(attentions(r2.status)[0]?.[1] || '', /前回の自動サインインが確認できていない/, 'auto-login:blocked-message');
  // after the login is saved again (a new key: ready again) the next job signs in automatically
  const updated = savedLogin(), fresh = pageUi(), r3 = await collect(fresh, jobOf(), updated);
  assert.equal(r3.result.items.length, 1, 'auto-login:update-then-success'); assert.equal(fresh.calls.login, 1); assert.equal(updated.calls.accepted, 1);
});

test('additional verification after the submission is the person\'s step in the same window; the routine continues only after authentication', async () => {
  const ui = pageUi({ outcome: 'attention' }), login = savedLogin(), job = jobOf(), dir = await root(); const list = [];
  const status = async (state, text) => { list.push([state, text]); if (state === 'verification_required') { assert.equal(ui.calls.exportCsv, 0, 'auto-login:no-export-before-auth'); ui.signIn(); } };
  const r = await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, status, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, loginTimeoutMs: 20000 });
  assert.equal(r.items.length, 1); assert.equal(ui.calls.login, 1, 'auto-login:one-submit'); assert.equal(ui.calls.show, 1, 'auto-login:attention-shows-window');
  const asked = list.filter(([s]) => s === 'verification_required'); assert.equal(asked.length, 1); assert.match(asked[0][1], /追加の確認/, 'auto-login:verification-message');
  assert.equal(login.calls.accepted, 1, 'auto-login:verified-login-accepted'); assert.equal(login.calls.rejected, 1);
});

test('the login form back in a new document after the submission is a refusal; the same document is not', async () => {
  const ui = pageUi({ outcome: 'attention' }), login = savedLogin(), job = jobOf(), dir = await root(); let polls = 0;
  const status = async () => {}; const wait = async ms => { ui.clock.t += ms; if (++polls === 2) ui.toLogin(); };
  const r = await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, status, { ui, login, now: ui.now, wait, pollMs: 1000, loginTimeoutMs: 8000 });
  assert.equal(r.items.length, 0); assert.match(String(r.failed), /受け付けませんでした/); assert.equal(login.calls.rejected, 1, 'auto-login:refusal-in-new-document'); assert.equal(ui.calls.login, 1, 'auto-login:one-submit');
});

test('a blocked, unbound or unopenable saved login, or a login form that is not the recorded one: nothing is typed and the person is asked', async () => {
  for (const [label, login, form, pattern, opens] of [
    ['blocked', savedLogin({ state: 'blocked' }), true, /前回の自動サインインが確認できていない/, 0],
    ['unbound', savedLogin({ state: 'unbound' }), true, /開けませんでした/, 0],
    ['unopenable', savedLogin({ openError: Object.assign(new Error('x'), { code: 'bank-login-unavailable' }) }), true, /開けませんでした/, 1],
    ['changed form', savedLogin(), false, /確認済みの形と異なる/, 0]
  ]) {
    const ui = pageUi({ form }), r = await collect(ui, jobOf(), login, { loginTimeoutMs: 3000 });
    assert.equal(ui.calls.login, 0, 'auto-login:no-submit ' + label); assert.equal(login.calls.open, opens, 'auto-login:decryption ' + label);
    assert.match(attentions(r.status)[0]?.[1] || '', pattern, 'auto-login:attention ' + label); assert.equal(ui.calls.exportCsv, 0);
  }
});

test('abort, lock and revocation: before the decryption, during it, and an OMF refusal of the session end the job without a submission', async () => {
  const aborted = new AbortController(); aborted.abort();
  const ui1 = pageUi(), l1 = savedLogin(), r1 = await collect(ui1, jobOf(), l1, { signal: aborted.signal });
  assert.ok(r1.error && (r1.error.name === 'AbortError' || /abort/i.test(r1.error.message)), 'auto-login:abort-before'); assert.equal(l1.calls.open, 0, 'auto-login:abort-before-no-decryption'); assert.equal(ui1.calls.login, 0);
  const during = new AbortController(), ui2 = pageUi(), l2 = savedLogin({ onOpen: () => during.abort() }), r2 = await collect(ui2, jobOf(), l2, { signal: during.signal });
  assert.ok(r2.error, 'auto-login:abort-during-open'); assert.equal(ui2.calls.login, 0, 'auto-login:abort-during-open-no-submit');
  const ui3 = pageUi(), l3 = savedLogin({ openError: Object.assign(new Error('Collector access expired'), { status: 401 }) }), r3 = await collect(ui3, jobOf(), l3);
  assert.equal(r3.error?.status, 401, 'auto-login:revocation-propagates'); assert.equal(ui3.calls.login, 0);
  const ui4 = pageUi(), l4 = savedLogin({ openError: Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' }) }), r4 = await collect(ui4, jobOf(), l4);
  assert.equal(r4.error?.code, 'forbidden', 'auto-login:session-end-propagates'); assert.equal(ui4.calls.login, 0);
});

test('a reclaimed job whose earlier attempt may have submitted never submits again; a fresh job journals before its one submission', async () => {
  const job = jobOf(), dir = await root(), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId);
  await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ jobId: job.jobId }));
  const ui = pageUi(), login = savedLogin(), status = statuses();
  await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, status, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, loginTimeoutMs: 3000 }).catch(() => {});
  assert.equal(ui.calls.login, 0, 'auto-login:reclaim-no-resubmit'); assert.equal(login.calls.open, 0); assert.match(attentions(status)[0]?.[1] || '', /もう一度は送信しません/);
  const fresh = pageUi(), job2 = jobOf(), dir2 = await root(); fresh.jobDir = path.join(dir2, 'outbox', 'bank', ACCOUNT._id, job2.jobId);
  await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job2), job2, dir2, statuses(), { ui: fresh, login: savedLogin(), now: fresh.now, wait: fresh.wait, pollMs: 1000 });
  assert.deepEqual(fresh.journalSeen, [true], 'auto-login:journal-before-submit');
});

test('runBankJob hands the saved login only to a retrieve job; observe, a recovered download and the drain never open it', async () => {
  const login = savedLogin(), seen = [];
  const config = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64) };
  const send = async () => ({ id: 'f'.repeat(24) }), pending = async () => [];
  await index.runBankJob({ job: jobOf('retrieve'), account: ACCOUNT }, config, null, { status: async () => {}, pending, upload: send, directory: await root(), login, collect: async (b, j, r, s, options) => { seen.push(['collect', options.login]); return { items: [], failed: null }; }, observe: async () => { seen.push(['observe']); return { items: [], failed: null, observation: [] }; } });
  await index.runBankJob({ job: jobOf('observe'), account: ACCOUNT }, config, null, { status: async () => {}, pending, upload: send, directory: await root(), login, collect: async () => { seen.push(['collect-wrong']); return { items: [] }; }, observe: async (b, j, r, s, options) => { seen.push(['observe', options.login ?? null]); return { items: [], failed: null, observation: [] }; } });
  assert.deepEqual(seen, [['collect', login], ['observe', null]], 'auto-login:retrieve-only'); assert.equal(login.calls.open, 0, 'auto-login:handover-not-decryption');
  // a recovered download (a crash after the file, before the manifest): no login step at all
  const job = jobOf(), dir = await root(), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId), guid = randomUUID(); await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, 'attempt.json'), JSON.stringify({ ...boundOf(job), period: 'p', requestedAt: 'x' })); await writeFile(path.join(jobDir, 'download.json'), JSON.stringify({ guid, host: 'fes.rakuten-bank.co.jp', suggestedFilename: 'x.csv' })); await writeFile(path.join(jobDir, guid), CSV);
  const ui = pageUi(), recovering = savedLogin(), r = await bank.collectBankFromPage(null, null, ADAPTER, boundOf(job), job, dir, async () => {}, { ui, login: recovering, now: ui.now, wait: ui.wait, pollMs: 1000 });
  assert.equal(r.recovered, true); assert.equal(recovering.calls.open, 0, 'auto-login:recovery-no-decryption'); assert.equal(recovering.calls.state, 0); assert.equal(ui.calls.open, 0);
});

// ── index.mjs bankLoginFor over an in-memory sealed-entry store (the SplitStore surface it uses: has/read/open) ──
function memoryStore() {
  const entries = new Map(), calls = { has: 0, read: 0, open: [] };
  const save = (id, aad, value) => { const keyId = randomBytes(32).toString('hex'); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'g'.repeat(64), keyId }, iv: 'i', tag: 't', data: 'd' }, value }); return keyId; };
  return { entries, calls, save,
    async has(id) { calls.has++; return entries.has(id); }, async read(id) { calls.read++; const e = entries.get(id); if (!e) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return e.envelope; },
    async open(id, aad, broker) { calls.open.push({ id, aad, broker }); const e = entries.get(id); if (!e || JSON.stringify(aadOf(e.envelope.aad)) !== JSON.stringify(aad)) throw Object.assign(new Error('aad'), { code: 'aad' }); if (e.fail) throw e.fail; return { ...e.value }; } };
}
const LIVE = { mode: 'protected', installationId: 'f'.repeat(32), broker: { id: 'broker' }, abort: new AbortController() };
const CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'b'.repeat(64), accountInfo: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: ACCOUNT.ownerId, provider: 'amex' }] };
const AAD = aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: ACCOUNT.ownerId, provider: 'rakuten', accountId: ACCOUNT._id });

test('bankLoginFor: only a protected session\'s claimed 楽天銀行 standard retrieve job of a valid account gets a saved-login handle', async () => {
  const store = memoryStore(), dir = await root(), make = (bankJob, live = LIVE) => index.bankLoginFor(bankJob, CONFIG, live, { store, root: dir, assert: () => {} });
  assert.ok(make({ job: jobOf(), account: ACCOUNT }), 'auto-login:handle-for-standard-retrieve');
  // plan omf-paypay-routine-20261022 D1/C4 (deliberate; amended admission LEGACY-TEST-ADMISSION.md): a protected PayPay銀行 標準 retrieve job of
  // a valid account gets its OWN provider-prefixed handle (constructed without reading anything); BA-PLUS and other providers still none
  assert.equal(make({ job: { ...jobOf(), snapshot: { ...snapshot(), provider: 'paypay' } }, account: ACCOUNT })?.entry, 'paypay-' + ACCOUNT._id, 'auto-login:paypay-standard-retrieve-own-entry');
  for (const [label, bankJob, live] of [['observe', { job: jobOf('observe'), account: ACCOUNT }], ['plus', { job: jobOf('retrieve', 'plus'), account: ACCOUNT }], ['no variant', { job: jobOf('retrieve', null), account: ACCOUNT }], ['paypay baplus', { job: { ...jobOf(), snapshot: { ...snapshot('baplus'), provider: 'paypay' } }, account: ACCOUNT }], ['unknown provider', { job: { ...jobOf(), snapshot: { ...snapshot(), provider: 'resona' } }, account: ACCOUNT }], ['bad id', { job: jobOf(), account: { ...ACCOUNT, _id: 'x' } }], ['bad owner', { job: jobOf(), account: { ...ACCOUNT, ownerId: '' } }], ['manual mode', { job: jobOf(), account: ACCOUNT }, { ...LIVE, mode: 'manual' }], ['no session', { job: jobOf(), account: ACCOUNT }, null]])
    assert.equal(make(bankJob, live === undefined ? LIVE : live), null, 'auto-login:no-handle ' + label);
  assert.equal(store.calls.has + store.calls.read + store.calls.open.length, 0, 'auto-login:construction-reads-nothing');
});

test('bankLoginFor: state from file metadata only, one decryption of its own entry and AAD, refusal remembered per saved key, cleared by a new save', async () => {
  const store = memoryStore(), dir = await root(), handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  assert.equal(await handle().state(), 'none', 'auto-login:state-none');
  store.save('rakuten-' + ACCOUNT._id, aadOf({ ...AAD, ownerId: 'e'.repeat(24) }), SECRET); assert.equal(await handle().state(), 'unbound', 'auto-login:state-unbound');
  store.save('rakuten-' + ACCOUNT._id, AAD, SECRET); const h = handle(); assert.equal(await h.state(), 'ready', 'auto-login:state-ready');
  assert.equal(store.calls.open.length, 0, 'auto-login:state-no-decryption');
  assert.deepEqual(await h.open(), SECRET); assert.deepEqual(store.calls.open.map(c => [c.id, c.aad, c.broker]), [['rakuten-' + ACCOUNT._id, AAD, LIVE.broker]], 'auto-login:own-entry-own-aad');
  await assert.rejects(h.open(), 'auto-login:open-once'); assert.equal(store.calls.open.length, 1);
  await h.rejected(); assert.equal(await handle().state(), 'blocked', 'auto-login:refusal-persisted');
  assert.ok(await exists(path.join(dir, 'bank-login', 'rakuten-' + ACCOUNT._id + '.json')));
  assert.ok(!(await readFile(path.join(dir, 'bank-login', 'rakuten-' + ACCOUNT._id + '.json'), 'utf8')).includes(SECRET.password), 'auto-login:marker-no-secret');
  store.save('rakuten-' + ACCOUNT._id, AAD, { ...SECRET, password: 'Fictional-Pass-0002' }); assert.equal(await handle().state(), 'ready', 'auto-login:new-save-unblocks');
  await handle().rejected(); assert.equal(await handle().state(), 'blocked'); await handle().accepted(); assert.equal(await handle().state(), 'ready', 'auto-login:accepted-clears');
});

test('bankLoginFor: a refused key release is a controlled bank-login failure; a revoked connection or an ended session propagates before anything is opened', async () => {
  const store = memoryStore(), dir = await root(); store.save('rakuten-' + ACCOUNT._id, AAD, SECRET);
  const entry = store.entries.get('rakuten-' + ACCOUNT._id);
  entry.fail = Object.assign(new Error('Bank account is unavailable for this batch.'), { status: 403 });
  await assert.rejects(index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} }).open(), e => e.code === 'bank-login-unavailable' && e.status === undefined, 'auto-login:key-refusal-controlled');
  entry.fail = Object.assign(new Error('Collector access expired'), { status: 401 });
  await assert.rejects(index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} }).open(), e => e.status === 401, 'auto-login:revocation-propagates');
  const before = store.calls.open.length;
  await assert.rejects(index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => { throw Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' }); } }).open(), e => e.code === 'forbidden', 'auto-login:session-checked-first');
  assert.equal(store.calls.open.length, before, 'auto-login:no-open-after-session-end');
});

for (const end of ['error_page', 'unknown', 'abort']) test('unconfirmed automatic sign-in blocks the saved key across fresh jobs: ' + end, async () => {
  const store = memoryStore(), dir = await root(); store.save('rakuten-' + ACCOUNT._id, AAD, SECRET);
  const handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  const first = pageUi({ outcome: 'attention' }), abort = new AbortController();
  const submit = first.login.bind(first);
  first.login = async (...args) => { const result = await submit(...args); first.setKind(end === 'abort' ? 'unknown' : end); if (end === 'abort') abort.abort(); return result; };
  const failed = await collect(first, jobOf(), handle(), { loginTimeoutMs: 3000, signal: abort.signal });
  assert.equal(first.calls.login, 1); assert.equal(first.calls.exportCsv, 0);
  assert.ok(failed.error || failed.result?.failed, 'auto-login:unconfirmed-job-fails ' + end);
  assert.equal(await handle().state(), 'blocked', 'auto-login:unconfirmed-blocked ' + end);
  if (end !== 'abort') assert.match(failed.error?.message || failed.result?.failed || '', /保存し直/, 'auto-login:unconfirmed-actionable ' + end);
  const opens = store.calls.open.length, next = pageUi();
  await collect(next, jobOf(), handle(), { loginTimeoutMs: 3000 });
  assert.equal(next.calls.login, 0, 'auto-login:unconfirmed-next-job-no-submit ' + end);
  assert.equal(store.calls.open.length, opens, 'auto-login:unconfirmed-next-job-no-decryption ' + end);
  store.save('rakuten-' + ACCOUNT._id, AAD, SECRET);
  const corrected = pageUi(), success = await collect(corrected, jobOf(), handle());
  assert.equal(success.error, null); assert.equal(success.result.failed, null); assert.equal(corrected.calls.login, 1);
  assert.equal(await handle().state(), 'ready', 'auto-login:unconfirmed-resave-success-unblocks ' + end);
});

test('confirmed authentication clears pending saved-key memory before the next independent job', async () => {
  const store = memoryStore(), dir = await root(); store.save('rakuten-' + ACCOUNT._id, AAD, SECRET);
  const handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  const ui = pageUi(), submit = ui.login.bind(ui); let blockedDuringSubmit = false;
  ui.login = async (...args) => { blockedDuringSubmit = await handle().state() === 'blocked'; return submit(...args); };
  const result = await collect(ui, jobOf(), handle());
  assert.equal(blockedDuringSubmit, true, 'auto-login:pending-persisted-before-action');
  assert.equal(result.error, null); assert.equal(await handle().state(), 'ready', 'auto-login:confirmed-clears-pending');
  const second = pageUi(); await collect(second, jobOf(), handle()); assert.equal(second.calls.login, 1, 'auto-login:confirmed-next-job-allowed');
});

test('the standard adapter: constructs without a page, refuses a missing or malformed login before any page, exposes the form check', async () => {
  const ui = rakuten.standard.ui({}, {}, { variant: 'standard', coverage: { from: '2025-11-01', to: '2026-10-01' } });
  for (const step of ['loginForm', 'login', 'document']) assert.equal(typeof ui[step], 'function', 'auto-login:ui ' + step);
  for (const bad of [undefined, null, {}, { username: 'x' }, { username: '', password: 'p' }, { username: 'u', password: '' }, { username: 'u'.repeat(257), password: 'p' }, { username: 'u', password: 7 }])
    await assert.rejects(ui.login(bad), e => e?.code === 'manual-login', 'auto-login:secret-shape ' + JSON.stringify(bad));
  const c = rakuten.STANDARD_LOGIN; assert.equal(c.origin, 'https://fes.rakuten-bank.co.jp'); assert.equal(c.form, 'LOGIN'); assert.deepEqual([c.user, c.password, c.control], ['LOGIN:USER_ID', 'LOGIN:LOGIN_PASSWORD', 'ログイン']);
  assert.ok(c.pathnames.includes('/XMS/security/RbS') && c.pathnames.includes(c.action), 'auto-login:recorded-surfaces'); assert.ok(!JSON.stringify(c).includes('j_id'), 'auto-login:no-generated-jsf-id');
  assert.equal(rakuten.default.ui({}, {}, null).loginForm, undefined, 'auto-login:pending-adapter-has-no-auto-login');
});

// Parent R1/R2: atomic document entry/action and late cancellation regressions.
// Fictional credentials, owned headless Chrome, intercepted pages, no bank network or database.
{
  const { browserFor } = await import('../browser.mjs');
  const { standard, STANDARD_LOGIN } = rakuten;
const ORIGIN=STANDARD_LOGIN.origin, FOREIGN='https://controlled.example.invalid';
const USER='parent-fictional-id', PASSWORD='Parent-Fictional-Password1';
const doc=(origin=ORIGIN)=>`<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行へようこそ</title><body><form id="LOGIN" name="LOGIN" method="post" action="${origin}${STANDARD_LOGIN.action}"><input id="LOGIN:USER_ID" name="LOGIN:USER_ID" type="text"><input id="LOGIN:LOGIN_PASSWORD" name="LOGIN:LOGIN_PASSWORD" type="password"><a href="#" onclick="event.preventDefault();document.getElementById('LOGIN').submit()">ログイン</a><input type="hidden" name="LOGIN_SUBMIT" value="1"></form><script>window.__foreignTyped=0;document.addEventListener('input',()=>window.__foreignTyped++,true)</script></body></html>`;
const overview='<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人ビジネス口座</title><body><a href="#">ログアウト</a><a href="#">登録情報の照会・変更</a><a href="#">入出金明細</a></body></html>';

async function ownedCase(fn){
  const root=await mkdtemp(path.join(os.tmpdir(),'omf-parent-login-race-'));
  let browser;
  try{
    browser=await browserFor(path.join(root,'profile'),{headless:true});
    const page=await browser.newPage(),posts=[];
    await page.setRequestInterception(true);
    page.on('request',r=>{
      const u=new URL(r.url());
      if(![ORIGIN,FOREIGN].includes(u.origin))return void r.abort();
      if(r.method()==='POST'){
        const body=new URLSearchParams(r.postData()||'');
        posts.push({origin:u.origin,path:u.pathname,correctLogin:body.get('LOGIN:USER_ID')===USER&&body.get('LOGIN:LOGIN_PASSWORD')===PASSWORD});
        return void r.respond({status:200,contentType:'text/html; charset=utf-8',body:`<script>location.replace('/XMS/inquiry/gns')</script>`});
      }
      return void r.respond({status:200,contentType:'text/html; charset=utf-8',body:u.pathname==='/XMS/inquiry/gns'?overview:doc(u.origin)});
    });
    const ui=standard.ui(page,browser,{variant:'standard'});
    await ui.open();
    assert.equal((await ui.loginForm()).ok,true,'the controlled official form must be accepted before the timing test');
    return await fn({page,ui,posts});
  }finally{
    await browser?.close().catch(()=>{});
    const absolute=path.resolve(root),base=path.resolve(os.tmpdir())+path.sep;
    if(!absolute.startsWith(base))throw Error('Unexpected cleanup target');
    await rm(absolute,{recursive:true,force:true});
  }
}

for(const replacement of [{label:'foreign',url:FOREIGN+'/replacement'},{label:'same origin',url:ORIGIN+STANDARD_LOGIN.pathnames[0]+'?parent-replacement=1'}])
test('navigation between the initial form check and credential entry cannot type into a replacement document: '+replacement.label,{timeout:90000},async()=>{
  await ownedCase(async({page,ui,posts})=>{
    const original=page.evaluateHandle.bind(page),evaluate=page.evaluate.bind(page);let handles=0,moved=false;
    page.evaluate=async(fn,arg,...rest)=>{
      if(arg?.fill&&!moved){await page.goto(replacement.url,{waitUntil:'domcontentloaded'});moved=true;}
      return evaluate(fn,arg,...rest);
    };
    page.evaluateHandle=async(...args)=>{
      if(++handles===2){await page.goto(replacement.url,{waitUntil:'domcontentloaded'});moved=true;}
      return original(...args);
    };
    let error=null;try{await ui.login({username:USER,password:PASSWORD});}catch(e){error=e;}
    const typed=await page.evaluate(()=>window.__foreignTyped||0);
    assert.equal(moved,true,'the navigation timing must actually be exercised');
    assert.equal(typed,0,'a replacement document must receive zero credential input events');
    assert.equal(posts.length,0,'a replacement document must never be submitted');
  });
});

test('an abort after final form verification but before the login click must prevent submission',{timeout:90000},async()=>{
  await ownedCase(async({page,ui,posts})=>{
    const original=page.evaluate.bind(page),abort=new AbortController();let cancelled=false;
    page.evaluate=async(fn,arg,...rest)=>{
      const result=await original(fn,arg,...rest);
      if(arg?.point===true){abort.abort();cancelled=true;}
      return result;
    };
    let error=null;try{await ui.login({username:USER,password:PASSWORD},{signal:abort.signal});}catch(e){error=e;}
    assert.equal(cancelled,true,'the cancellation timing must actually be exercised');
    assert.equal(posts.length,0,'an aborted login must not be submitted');
  });
});

test('the exact form still signs in successfully when page keyboard typing is unavailable',{timeout:90000},async()=>{
  await ownedCase(async({page,ui,posts})=>{
    let keyboardCalls=0;page.keyboard.type=async()=>{keyboardCalls++;throw Error('Unbound keyboard typing is unavailable in this timing test');};
    let error=null;try{await ui.login({username:USER,password:PASSWORD});}catch(e){error=e;}
    assert.equal(error,null,'normal sign-in must succeed without the unbound keyboard');
    assert.equal(keyboardCalls,0);
    assert.equal(posts.length,1);assert.equal(posts[0].origin,ORIGIN);assert.equal(posts[0].correctLogin,true);
  });
});

for(const replacement of [{label:'foreign',url:FOREIGN+'/replacement-before-submit'},{label:'same origin',url:ORIGIN+STANDARD_LOGIN.pathnames[0]+'?parent-replacement-submit=1'}])
test('navigation after the final form check cannot click a control in the replacement document: '+replacement.label,{timeout:90000},async()=>{
  await ownedCase(async({page,ui,posts})=>{
    const evaluate=page.evaluate.bind(page),click=page.mouse.click.bind(page.mouse);let moved=false;
    const replace=async()=>{if(!moved){await page.goto(replacement.url,{waitUntil:'domcontentloaded'});moved=true;}};
    page.evaluate=async(fn,arg,...rest)=>{if(arg?.submit)await replace();return evaluate(fn,arg,...rest);};
    page.mouse.click=async(...args)=>{await replace();return click(...args);};
    let error=null;try{await ui.login({username:USER,password:PASSWORD});}catch(e){error=e;}
    assert.equal(moved,true,'the replacement before the submission must actually be exercised');
    assert.equal(posts.length,0,'the replacement page must receive no login action');
  });
});

}

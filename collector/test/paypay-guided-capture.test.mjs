// collector/test/paypay-guided-capture.test.mjs — the guided first capture of a PayPay銀行 標準ログイン account (plan
// omf-paypay-four-accounts-20261021): observeFromPage with a page-less guided ui on a virtual clock and a fictional saved login
// (the shape index.mjs bankLoginFor hands over), index.mjs bankLoginFor over an in-memory sealed-entry store for four separate
// accounts, and runBankJob's hand-over. The saved login is opened at most once per job, journalled and marked pending before the one
// possible submission, never inferred to have worked (plan P1): neither navigation nor any captured file — CSV-shaped or not — clears
// the pending marker; the captured file is kept for native mapping, an adapter-observed refusal is marked 'refused', and only the owner's
// explicit protected retry (index.mjs retryBankLogin, uncertain or refused for the current key) or a re-save lifts the block; the observed
// active-session page (session-in-use) keeps the uncertain marker and is never a refusal. The Chrome legs (real recorder, intercepted fake portal) run in
// scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs and scripts/finance-paypay-onboarding-integration.cjs. Fictional values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-guided-test-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
const bank = await import('../bank.mjs');
const paypay = await import('../banks/paypay.mjs');
const rakuten = await import('../banks/rakuten.mjs');
const index = await import('../index.mjs');
const { aadOf } = await import('../vault.mjs');
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ORIGIN = 'https://omf.example';
const ACCOUNTS = ['b1b1b1b1b1b1b1b1b1b1b1b1', 'b2b2b2b2b2b2b2b2b2b2b2b2', 'b3b3b3b3b3b3b3b3b3b3b3b3', 'b4b4b4b4b4b4b4b4b4b4b4b4'].map((id, i) => ({ _id: id, ownerId: OWNER, name: 'PayPay ' + (i + 1) }));
const ACCOUNT = ACCOUNTS[0];
const SECRET = Object.freeze({ branch: '012', account: '0012345', password: ' Fictional Pw/1 ' });
const CSV = Buffer.from('日付,内容,出金金額,入金金額,残高\r\n2026/10/01,振込 カクウ,,50000,150000\r\n');
const unmapped = (variant = 'standard', provider = 'paypay') => ({ templateId: null, templateRevision: 0, headers: [], mapping: {}, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider, accountLabel: null, variant, coverage: null, interpretation: 'unmapped' });
const jobOf = ({ kind = 'observe', variant = 'standard', provider = 'paypay' } = {}) => { const s = unmapped(variant, provider); return { jobId: randomUUID(), kind, snapshot: s, snapshotHash: sha256(JSON.stringify(s)), provider }; };
const boundOf = (job, account = ACCOUNT) => ({ bankAccountId: account._id, ownerId: OWNER, origin: ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' });

// A page-less guided ui: the exact login form, its one submission, the person's export on their own time (the clock's polls).
function guidedUi({ form = true, outcome = 'submitted', deliver = 'csv', host = 'login.paypay-bank.co.jp', at = 3, loginError = null } = {}) {
  const clock = { t: 1_800_000_000_000 }, calls = { open: 0, show: 0, loginForm: 0, login: 0, secrets: [], atLogin: [] };
  let handlers = {}, jobDir = null, polls = 0;
  const emit = (event, value) => { for (const h of handlers[event] || []) h(value); };
  const ui = {
    calls, clock, now: () => clock.t,
    async wait(ms) { clock.t += ms; if (++polls === at) await ui.deliver(); },
    async open() { calls.open++; }, async state() { return { kind: 'unknown' }; }, async show() { calls.show++; },
    async loginForm() { calls.loginForm++; return form ? { ok: true, document: 'doc-1' } : { ok: false, reason: 'form' }; },
    async document() { return 'doc-1'; },
    async login(secret, { signal } = {}) {
      calls.login++; calls.secrets.push({ ...secret }); calls.atLogin.push({ journal: jobDir ? await exists(path.join(jobDir, 'login.json')) : null, pending: ui.pending?.() ?? null });
      signal?.throwIfAborted(); if (loginError) throw loginError; return { outcome, document: 'doc-1' };
    },
    downloadSession(dir) { jobDir = dir; handlers = {}; return { on(event, handler) { (handlers[event] ||= []).push(handler); }, async close() { handlers = {}; } }; },
    async deliver() {
      if (!deliver) return;
      const one = async (bytes, name) => { const guid = randomUUID(); await writeFile(path.join(jobDir, guid), bytes); emit('Browser.downloadWillBegin', { guid, url: 'https://' + host + '/wctx/download', suggestedFilename: name }); emit('Browser.downloadProgress', { guid, state: 'completed', totalBytes: bytes.length }); };
      if (deliver === 'csv') await one(CSV, 'meisai.csv');
      if (deliver === 'pdf') await one(Buffer.from('%PDF-1.7\n%fictional\n'), 'meisai.pdf');
      if (deliver === 'two') { await one(CSV, 'a.csv'); await one(Buffer.from(CSV.toString() + 'x\r\n'), 'b.csv'); }
      if (Buffer.isBuffer(deliver)) await one(deliver, 'meisai.csv');
    },
    get jobDir() { return jobDir; }
  };
  return ui;
}
// A fictional saved login with the interface bank.mjs expects (state/open/rejected/accepted), counting every call.
function savedLogin({ state = 'ready', openError = null, onOpen = null } = {}) {
  const calls = { state: 0, open: 0, rejected: 0, accepted: 0, kinds: [] }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; await onOpen?.(); if (openError) throw openError; return { ...SECRET }; }, async rejected(kind) { calls.rejected++; calls.kinds.push(kind ?? null); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; }, get current() { return current; } };
}
const root = async () => { const dir = path.join(temp, randomUUID().slice(0, 8)); await mkdir(dir, { recursive: true }); return dir; };
const statuses = () => { const list = []; const fn = async (state, text) => { list.push([state, text]); }; fn.list = list; return fn; };
async function observe(ui, job, login, { adapter = paypay.standard, account = ACCOUNT, dir = null, signal = null, timeoutMs = 10000 } = {}) {
  dir ||= await root(); const status = statuses(); if (login) ui.pending = () => login.current === 'blocked';
  let result = null, error = null;
  try { result = await bank.observeFromPage(null, null, adapter, boundOf(job, account), job, dir, status, { ui, login, now: ui.now, wait: ui.wait, pollMs: 1000, timeoutMs, signal }); } catch (e) { error = e; }
  return { dir, status, result, error, jobDir: path.join(dir, 'outbox', 'bank', account._id, job.jobId + '-observe') };
}
const attention = r => r.status.list.filter(([s]) => s === 'verification_required').map(([, t]) => t);
const noSecret = (label, ...values) => { const text = JSON.stringify(values); for (const v of [SECRET.account, SECRET.password, SECRET.password.trim()]) assert.ok(!text.includes(v), 'paypay-guided:no-secret ' + label); };

test('guidedAdapterFor: only a job frozen for PayPay銀行 標準 resolves the guided adapter; every other observe keeps its provider adapter', () => {
  assert.equal(bank.guidedAdapterFor(jobOf()), paypay.standard, 'paypay-guided:adapter-standard');
  for (const [label, job] of [['baplus', jobOf({ variant: 'baplus' })], ['no variant', jobOf({ variant: null })], ['rakuten standard', jobOf({ provider: 'rakuten' })], ['no snapshot', { jobId: 'x', kind: 'observe', provider: 'paypay' }], ['claim provider only', { ...jobOf({ provider: 'resona', variant: 'standard' }), provider: 'paypay' }]])
    assert.equal(bank.guidedAdapterFor(job), null, 'paypay-guided:no-guided-adapter ' + label);
  assert.equal(rakuten.standard.guided, undefined, 'paypay-guided:rakuten-standard-not-guided');
});

test('a ready saved login on the exact form: one decryption, journal and uncertain marker before the one submission, the person exports; the kept CSV is NOT proof and the marker stays (plan P1)', async () => {
  const ui = guidedUi(), login = savedLogin(), r = await observe(ui, jobOf(), login);
  assert.equal(r.error, null, String(r.error?.stack || r.error));
  assert.equal(login.calls.open, 1, 'paypay-guided:one-decryption'); assert.equal(ui.calls.login, 1, 'paypay-guided:one-submission');
  assert.deepEqual(ui.calls.secrets, [SECRET], 'paypay-guided:own-secret-submitted');
  assert.deepEqual(ui.calls.atLogin, [{ journal: true, pending: true }], 'paypay-guided:journal-and-pending-before-submit');
  assert.equal(r.result.items.length, 1, 'paypay-guided:csv-retained'); const m = r.result.items[0].manifest;
  assert.equal(m.channel, 'collector-observe'); assert.equal(m.sourceHost, 'login.paypay-bank.co.jp'); assert.equal(m.jobId, r.result.items[0].manifest.jobId); assert.equal(m.bankAccountId, ACCOUNT._id); assert.equal(m.sha256, sha256(CSV));
  // Deliberate change (plan P1, parent counterexample): no captured file proves the automatic sign-in.
  assert.equal(login.calls.accepted, 0, 'paypay-guided:file-not-proof'); assert.equal(login.current, 'blocked', 'paypay-guided:uncertain-kept'); assert.deepEqual(login.calls.kinds, ['uncertain'], 'paypay-guided:marked-uncertain');
  assert.equal(r.result.failed ?? null, null, 'paypay-guided:complete'); assert.match(String(r.result.notice), /受け取った明細は保存/, 'paypay-guided:kept-notice');
  const asked = attention(r); assert.equal(asked.length, 1, 'paypay-guided:one-attention'); assert.match(asked[0], /1回だけ送信/, 'paypay-guided:submitted-message'); assert.match(asked[0], /CSV/);
  assert.ok(ui.calls.show >= 1, 'paypay-guided:window-shown');
  noSecret('status/result', r.status.list, r.result);
  for (const name of await readdir(r.jobDir)) if (!/^[a-f\d-]{36}$/.test(name)) noSecret('file ' + name, await readFile(path.join(r.jobDir, name), 'utf8'));
});

test('submitted but no CSV, a PDF, two downloads or a download from another host: nothing proves the sign-in; the marker stays, the job explains it (a PDF is not kept as a statement) and the next job submits nothing until the owner re-saves', async () => {
  for (const [label, options] of [['no csv', { deliver: null }], ['pdf', { deliver: 'pdf' }], ['two downloads', { deliver: 'two' }], ['foreign host', { host: 'cdn.paypay-bank.example' }]]) {
    const ui = guidedUi(options), login = savedLogin(), r = await observe(ui, jobOf(), login);
    assert.equal(r.error, null, label + ' ' + String(r.error)); assert.equal(ui.calls.login, 1);
    assert.equal(login.calls.accepted, 0, 'paypay-guided:not-proof ' + label); assert.equal(login.current, 'blocked', 'paypay-guided:pending-kept ' + label);
    // Deliberate change (review fold F3): a PDF is no longer kept as the CSV statement; it stays in the job folder, nothing is sent.
    if (label === 'pdf') { assert.equal(r.result.items.length, 0, 'paypay-guided:pdf-not-statement'); assert.match(String(r.result.failed), /CSV・テキストとして読めない/, 'paypay-guided:pdf-explained'); assert.match(String(r.result.failed), /自動送信は止めています/, 'paypay-guided:pdf-sign-in-state'); }
    else { assert.match(String(r.result.failed), /確認できません/, 'paypay-guided:unconfirmed-explained ' + label); assert.match(String(r.result.failed), /保存し直/, 'paypay-guided:unconfirmed-actionable ' + label); }
    const next = guidedUi(), r2 = await observe(next, jobOf(), login);
    assert.equal(next.calls.login, 0, 'paypay-guided:blocked-no-submit ' + label); assert.equal(login.calls.open, 1, 'paypay-guided:blocked-no-decryption ' + label);
    assert.match(attention(r2)[0] || '', /前回の自動サインインが確認できていない/, 'paypay-guided:blocked-message ' + label);
  }
});

test('the bank refuses the saved login: one submission, remembered, a clear failure; a CSV the person then exports is kept but is not proof for the saved login', async () => {
  const ui = guidedUi({ outcome: 'rejected', deliver: null }), login = savedLogin(), r = await observe(ui, jobOf(), login);
  assert.equal(r.error, null); assert.equal(ui.calls.login, 1, 'paypay-guided:refusal-one-submit'); assert.equal(login.current, 'refused', 'paypay-guided:refusal-distinguished'); assert.deepEqual(login.calls.kinds, ['uncertain', 'refused'], 'paypay-guided:refusal-marked');
  assert.match(String(r.result.failed), /受け付けませんでした/, 'paypay-guided:refused-message');
  assert.match(String(r.result.failed), /店番号・口座番号・パスワードを保存し直/, 'paypay-guided:refused-names-paypay-fields'); assert.doesNotMatch(String(r.result.failed), /IDとパスワード/, 'paypay-guided:refused-no-rakuten-wording');
  assert.match(bank.LOGIN_TEXT.refused('楽天銀行'), /IDとパスワードを保存し直/, 'paypay-guided:rakuten-refused-wording-unchanged');
  const after = guidedUi(), r1 = await observe(after, jobOf(), login);
  assert.equal(after.calls.login, 0, 'paypay-guided:refused-no-submit'); assert.match(attention(r1)[0] || '', /受け付けませんでした/, 'paypay-guided:refused-next-message'); assert.match(attention(r1)[0] || '', /店番号・口座番号・パスワード/, 'paypay-guided:refused-next-names-paypay-fields');
  const manual = guidedUi({ outcome: 'rejected' }), l2 = savedLogin(), r2 = await observe(manual, jobOf(), l2);
  assert.equal(r2.result.items.length, 1, 'paypay-guided:manual-csv-kept'); assert.equal(l2.calls.accepted, 0, 'paypay-guided:refused-not-cleared'); assert.equal(r2.result.failed ?? null, null);
  assert.match(String(r2.result.notice), /保存し直/, 'paypay-guided:refused-notice');
});

test('a reclaimed job whose earlier attempt may have submitted never submits again; blocked, unbound, unopenable, absent or non-exact: nothing typed, the person is asked', async () => {
  const job = jobOf(), dir = await root(), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId + '-observe');
  await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ jobId: job.jobId }));
  const ui = guidedUi(), login = savedLogin(), r = await observe(ui, job, login, { dir });
  assert.equal(ui.calls.login, 0, 'paypay-guided:reclaim-no-resubmit'); assert.equal(login.calls.open, 0); assert.match(attention(r)[0] || '', /もう一度は送信しません/);
  for (const [label, l, form, pattern, opens] of [
    ['blocked', savedLogin({ state: 'blocked' }), true, /前回の自動サインインが確認できていない/, 0],
    ['unbound', savedLogin({ state: 'unbound' }), true, /開けませんでした/, 0],
    ['none', savedLogin({ state: 'none' }), true, /サインイン/, 0],
    ['unopenable', savedLogin({ openError: Object.assign(new Error('x'), { code: 'bank-login-unavailable' }) }), true, /開けませんでした/, 1],
    ['changed form', savedLogin(), false, /確認済みの形と異なる/, 0]
  ]) {
    const u = guidedUi({ form }), x = await observe(u, jobOf(), l);
    assert.equal(u.calls.login, 0, 'paypay-guided:no-submit ' + label); assert.equal(l.calls.open, opens, 'paypay-guided:decryption ' + label);
    assert.match(attention(x)[0] || '', pattern, 'paypay-guided:attention ' + label); assert.equal(x.result.items.length, 1, 'paypay-guided:manual-capture-still-kept ' + label);
    assert.equal(l.calls.accepted, 0, 'paypay-guided:manual-not-proof ' + label);
  }
});

test('abort and revocation: before the decryption, during it, after the submission; a 401 or an ended session propagates before anything is typed', async () => {
  const aborted = new AbortController(); aborted.abort();
  const u1 = guidedUi(), l1 = savedLogin(), r1 = await observe(u1, jobOf(), l1, { signal: aborted.signal });
  assert.ok(r1.error && (r1.error.name === 'AbortError' || /abort/i.test(r1.error.message)), 'paypay-guided:abort-before'); assert.equal(l1.calls.open, 0, 'paypay-guided:abort-no-decryption'); assert.equal(u1.calls.login, 0);
  const during = new AbortController(), u2 = guidedUi(), l2 = savedLogin({ onOpen: () => during.abort() }), r2 = await observe(u2, jobOf(), l2, { signal: during.signal });
  assert.ok(r2.error, 'paypay-guided:abort-during-open'); assert.equal(u2.calls.login, 0, 'paypay-guided:abort-during-open-no-submit');
  for (const [label, error, check] of [['401', Object.assign(new Error('Collector access expired'), { status: 401 }), e => e?.status === 401], ['session end', Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' }), e => e?.code === 'forbidden']]) {
    const u = guidedUi(), l = savedLogin({ openError: error }), r = await observe(u, jobOf(), l);
    assert.ok(check(r.error), 'paypay-guided:propagates ' + label + ' ' + r.error); assert.equal(u.calls.login, 0);
  }
  const after = new AbortController(), u3 = guidedUi({ deliver: null }), l3 = savedLogin(); u3.wait = async ms => { u3.clock.t += ms; after.abort(); };
  const r3 = await observe(u3, jobOf(), l3, { signal: after.signal });
  assert.ok(r3.error, 'paypay-guided:abort-after-submit'); assert.equal(u3.calls.login, 1); assert.equal(l3.current, 'blocked', 'paypay-guided:abort-after-submit-pending-kept');
});

test('the saved login is never used by a non-guided observe: another provider adapter, a mismatched variant or no login keeps today\'s observe exactly', async () => {
  for (const [label, adapter, job] of [['rakuten default', rakuten.default, jobOf({ provider: 'rakuten', variant: null })], ['paypay default', paypay.default, jobOf({ variant: null })], ['baplus job', paypay.standard, jobOf({ variant: 'baplus' })]]) {
    const ui = guidedUi(), login = savedLogin(), r = await observe(ui, job, login, { adapter });
    assert.equal(r.error, null, label + ' ' + r.error); assert.deepEqual([login.calls.state, login.calls.open, ui.calls.login], [0, 0, 0], 'paypay-guided:not-used ' + label);
    assert.deepEqual(attention(r), [`${adapter.label}のページをChromeで操作してください（観察取得・準備）。入出金明細のCSVを出力できる場合は出力し、終わったらタブを閉じてください`], 'paypay-guided:observe-message-unchanged ' + label);
    assert.equal(r.result.failed, undefined, 'paypay-guided:observe-result-unchanged ' + label);
  }
});

// ── index.mjs bankLoginFor over an in-memory sealed-entry store, four accounts ──
function memoryStore() {
  const entries = new Map(), calls = { has: 0, read: 0, open: [] };
  const save = (id, aad, value) => { const keyId = randomBytes(32).toString('hex'); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'g'.repeat(64), keyId }, iv: 'i', tag: 't', data: 'd' }, value }); return keyId; };
  return { entries, calls, save,
    async has(id) { calls.has++; return entries.has(id); }, async read(id) { calls.read++; const e = entries.get(id); if (!e) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return e.envelope; },
    async open(id, aad, broker) { calls.open.push({ id, aad, broker }); const e = entries.get(id); if (!e || JSON.stringify(aadOf(e.envelope.aad)) !== JSON.stringify(aad)) throw Object.assign(new Error('aad'), { code: 'aad' }); return { ...e.value }; },
    async withLock(fn) { calls.locks = (calls.locks || 0) + 1; return fn(); } };
}
const LIVE = { mode: 'protected', installationId: 'f'.repeat(32), broker: { id: 'broker' }, abort: new AbortController() };
const CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'b'.repeat(64), accountInfo: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: OWNER, provider: 'amex' }] };
const aadFor = account => aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'paypay', accountId: account._id });

// Deliberate change (plan omf-paypay-routine-20261022 C4, guard:bank-login-kind widened): a PayPay標準 RETRIEVE job now gets the
// handle too (routine retrieval); a claim of any other kind, BA-PLUS, another variant, a rakuten snapshot, manual mode or no session never does.
test('bankLoginFor: a handle only for a protected session\'s claimed PayPay標準 guided observe or retrieve job of a valid account; never for BA-PLUS, another variant, another kind, a rakuten snapshot, manual mode or no session', async () => {
  const store = memoryStore(), dir = await root(), make = (bankJob, live = LIVE) => index.bankLoginFor(bankJob, CONFIG, live, { store, root: dir, assert: () => {} });
  const h = make({ job: jobOf(), account: ACCOUNT }); assert.ok(h, 'paypay-guided:handle-for-guided-observe'); assert.equal(h.entry, 'paypay-' + ACCOUNT._id, 'paypay-guided:own-entry');
  const r = make({ job: jobOf({ kind: 'retrieve' }), account: ACCOUNT }); assert.ok(r, 'paypay-guided:handle-for-routine-retrieve'); assert.equal(r.entry, 'paypay-' + ACCOUNT._id, 'paypay-guided:retrieve-own-entry');
  for (const [label, bankJob, live] of [['baplus', { job: jobOf({ variant: 'baplus' }), account: ACCOUNT }], ['no variant', { job: jobOf({ variant: null }), account: ACCOUNT }], ['baplus retrieve', { job: jobOf({ kind: 'retrieve', variant: 'baplus' }), account: ACCOUNT }], ['unknown kind', { job: jobOf({ kind: 'bogus' }), account: ACCOUNT }], ['rakuten snapshot', { job: { ...jobOf({ provider: 'rakuten', kind: 'observe' }), provider: 'paypay' }, account: ACCOUNT }], ['bad id', { job: jobOf(), account: { ...ACCOUNT, _id: 'x' } }], ['manual mode', { job: jobOf(), account: ACCOUNT }, { ...LIVE, mode: 'manual' }], ['no session', { job: jobOf(), account: ACCOUNT }, null]])
    assert.equal(make(bankJob, live === undefined ? LIVE : live), null, 'paypay-guided:no-handle ' + label);
  assert.equal(store.calls.has + store.calls.read + store.calls.open.length, 0, 'paypay-guided:construction-reads-nothing');
  assert.ok(make({ job: jobOf({ provider: 'rakuten', kind: 'retrieve' }), account: ACCOUNT }), 'paypay-guided:rakuten-retrieve-handle-unchanged');
});

test('four accounts: each handle opens only its own entry and AAD once; a refusal of account 2 blocks account 2 only; its re-save unblocks it', async () => {
  const store = memoryStore(), dir = await root();
  for (const [i, a] of ACCOUNTS.entries()) store.save('paypay-' + a._id, aadFor(a), { ...SECRET, account: '00' + (12345 + i) });
  const handle = a => index.bankLoginFor({ job: jobOf(), account: a }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  for (const [i, a] of ACCOUNTS.entries()) { const h = handle(a); assert.equal(await h.state(), 'ready'); assert.deepEqual(await h.open(), { ...SECRET, account: '00' + (12345 + i) }, 'paypay-guided:own-values ' + i); await assert.rejects(h.open(), 'paypay-guided:open-once ' + i); }
  assert.deepEqual(store.calls.open.map(c => [c.id, c.aad.accountId, c.aad.provider]), ACCOUNTS.map(a => ['paypay-' + a._id, a._id, 'paypay']), 'paypay-guided:own-entry-own-aad');
  await handle(ACCOUNTS[1]).rejected();
  assert.deepEqual(await Promise.all(ACCOUNTS.map(a => handle(a).state())), ['ready', 'blocked', 'ready', 'ready'], 'paypay-guided:refusal-isolated');
  const marker = path.join(dir, 'bank-login', 'paypay-' + ACCOUNTS[1]._id + '.json'); assert.ok(await exists(marker), 'paypay-guided:own-marker');
  assert.ok(!(await readFile(marker, 'utf8')).includes(SECRET.password.trim()), 'paypay-guided:marker-no-secret');
  store.save('paypay-' + ACCOUNTS[1]._id, aadFor(ACCOUNTS[1]), SECRET); assert.equal(await handle(ACCOUNTS[1]).state(), 'ready', 'paypay-guided:resave-unblocks');
  // a rakuten entry under the same account id is not the PayPay entry, and the PayPay AAD is not the rakuten AAD
  store.entries.delete('paypay-' + ACCOUNTS[3]._id); store.save('rakuten-' + ACCOUNTS[3]._id, aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'rakuten', accountId: ACCOUNTS[3]._id }), { username: 'u', password: 'p' });
  assert.equal(await handle(ACCOUNTS[3]).state(), 'none', 'paypay-guided:provider-entry-separate');
  store.save('paypay-' + ACCOUNTS[3]._id, aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'rakuten', accountId: ACCOUNTS[3]._id }), SECRET);
  assert.equal(await handle(ACCOUNTS[3]).state(), 'unbound', 'paypay-guided:provider-aad-separate');
});

test('end to end through the real handle: an uncertain attempt stays blocked across jobs even with a kept CSV; the owner\'s protected retry (no decryption) allows exactly one new submission; the old journalled job never resubmits', async () => {
  const store = memoryStore(), dir = await root(); store.save('paypay-' + ACCOUNT._id, aadFor(ACCOUNT), SECRET);
  const handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  const first = guidedUi({ deliver: null }), r1 = await observe(first, jobOf(), handle(), { dir });
  assert.equal(first.calls.login, 1); assert.equal(await handle().state(), 'blocked', 'paypay-guided:real-marker-pending');
  const second = guidedUi(), r2 = await observe(second, jobOf(), handle(), { dir });
  assert.equal(second.calls.login, 0, 'paypay-guided:real-blocked'); void r1; void r2;
  const kept = guidedUi(), rk = await observe(kept, jobOf(), handle(), { dir });
  assert.equal(kept.calls.login, 0, 'paypay-guided:real-blocked-with-csv'); assert.equal(rk.result.items.length, 1, 'paypay-guided:manual-csv-kept'); assert.equal(await handle().state(), 'blocked', 'paypay-guided:real-file-not-proof');
  // the owner allows one more attempt with the SAME saved login: the marker of the current key is removed, nothing is decrypted
  const opens = store.calls.open.length, banks = async () => [{ _id: ACCOUNT._id, name: 'PayPay 1', ownerId: OWNER, provider: 'paypay', variant: 'standard' }];
  assert.deepEqual(await index.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks, store, root: dir, assert: () => {} }), { retry: true }, 'paypay-guided:protected-retry');
  assert.equal(store.calls.open.length, opens, 'paypay-guided:retry-no-decryption'); assert.equal(await handle().state(), 'ready', 'paypay-guided:retry-rearms');
  const thirdJob = jobOf(), third = guidedUi({ deliver: null }), r3 = await observe(third, thirdJob, handle(), { dir });
  assert.equal(third.calls.login, 1, 'paypay-guided:retry-one-new-submission'); assert.equal(await handle().state(), 'blocked', 'paypay-guided:retry-uncertain-again'); void r3;
  // the same (reclaimed) job after another retry: its journal still forbids a second submission
  await index.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks, store, root: dir, assert: () => {} });
  const reclaimed = guidedUi(), rr = await observe(reclaimed, thirdJob, handle(), { dir });
  assert.equal(reclaimed.calls.login, 0, 'paypay-guided:old-journal-holds'); assert.match(attention(rr)[0] || '', /もう一度は送信しません/, 'paypay-guided:old-journal-message');
});

test('the observed active-session page (session-in-use, plan omf-paypay-split-dates-retry-20261022): one submission, the uncertain marker stays — not refused, not accepted —, the person is told why and that 上書きログイン is never pressed, nothing is sent again; a kept CSV is still no proof; the explicit retry then allows exactly one new submission', async () => {
  const store = memoryStore(), dir = await root(); store.save('paypay-' + ACCOUNT._id, aadFor(ACCOUNT), SECRET);
  const handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  const marker = async () => JSON.parse(await readFile(path.join(dir, 'bank-login', 'paypay-' + ACCOUNT._id + '.json'), 'utf8'));
  const inUseJob = jobOf(), ui = guidedUi({ outcome: 'session-in-use', deliver: null }), r = await observe(ui, inUseJob, handle(), { dir });
  assert.equal(r.error, null); assert.equal(ui.calls.login, 1, 'paypay-guided:in-use-one-submit'); assert.equal(store.calls.open.length, 1, 'paypay-guided:in-use-one-decryption');
  assert.equal(await handle().state(), 'blocked', 'paypay-guided:in-use-stays-uncertain'); assert.equal((await marker()).kind, 'uncertain', 'paypay-guided:in-use-not-refused');
  assert.match(attention(r)[0] || '', /ログイン中/, 'paypay-guided:in-use-asked'); assert.match(attention(r)[0] || '', /「上書きログイン」は自動では押しません/, 'paypay-guided:in-use-no-overwrite-said');
  assert.match(String(r.result.failed), /ログイン中だった.*サインインは完了していません/, 'paypay-guided:in-use-failed-explained'); assert.match(String(r.result.failed), /もう一度試す/, 'paypay-guided:in-use-retry-named');
  assert.doesNotMatch(String(r.result.failed), /受け付けませんでした/, 'paypay-guided:in-use-not-wrong-password'); noSecret('in-use', r.status.list, r.result);
  // the fake handle: exactly one marker write ('uncertain'), never 'refused', never accepted, even with a kept CSV
  const fake = savedLogin(), kept = guidedUi({ outcome: 'session-in-use' }), rk = await observe(kept, jobOf(), fake);
  assert.deepEqual(fake.calls.kinds, ['uncertain'], 'paypay-guided:in-use-marked-uncertain-only'); assert.equal(fake.calls.accepted, 0, 'paypay-guided:in-use-csv-not-proof');
  assert.equal(rk.result.items.length, 1, 'paypay-guided:in-use-csv-kept'); assert.match(String(rk.result.notice), /受け取った明細は保存/, 'paypay-guided:in-use-kept-notice');
  // the same job reclaimed: its journal forbids another submission; the next job is blocked until the owner retries
  const reclaimed = guidedUi(), rr = await observe(reclaimed, inUseJob, handle(), { dir }); assert.equal(reclaimed.calls.login, 0, 'paypay-guided:in-use-no-second-submit'); void rr;
  const next = guidedUi(), rn = await observe(next, jobOf(), handle(), { dir }); assert.equal(next.calls.login, 0, 'paypay-guided:in-use-next-blocked'); void rn;
  const banks = async () => [{ _id: ACCOUNT._id, name: 'PayPay 1', ownerId: OWNER, provider: 'paypay', variant: 'standard' }], opens = store.calls.open.length;
  assert.deepEqual(await index.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks, store, root: dir, assert: () => {} }), { retry: true }, 'paypay-guided:in-use-retry');
  assert.equal(store.calls.open.length, opens, 'paypay-guided:in-use-retry-no-decryption');
  const after = guidedUi({ deliver: null }), ra = await observe(after, jobOf(), handle(), { dir }); assert.equal(after.calls.login, 1, 'paypay-guided:in-use-retry-one-submission'); void ra;
});

test('a bank refusal of the current saved login: the owner\'s explicit protected retry (no re-entry, no decryption) allows exactly one new submission; the refused job\'s journal never resubmits; a re-save still also unblocks', async () => {
  const store = memoryStore(), dir = await root(); store.save('paypay-' + ACCOUNT._id, aadFor(ACCOUNT), SECRET);
  const handle = () => index.bankLoginFor({ job: jobOf(), account: ACCOUNT }, CONFIG, LIVE, { store, root: dir, assert: () => {} });
  const refusedJob = jobOf(), ui = guidedUi({ outcome: 'rejected', deliver: null }), r = await observe(ui, refusedJob, handle(), { dir });
  assert.equal(ui.calls.login, 1); assert.equal(await handle().state(), 'refused', 'paypay-guided:refused-real-marker');
  assert.match(String(r.result.failed), /受け付けませんでした/, 'paypay-guided:refused-still-wrong-password'); assert.match(String(r.result.failed), /もう一度試す/, 'paypay-guided:refused-retry-named');
  const blocked = guidedUi(), rb = await observe(blocked, jobOf(), handle(), { dir }); assert.equal(blocked.calls.login, 0, 'paypay-guided:refused-blocks-next'); void rb;
  const banks = async () => [{ _id: ACCOUNT._id, name: 'PayPay 1', ownerId: OWNER, provider: 'paypay', variant: 'standard' }], opens = store.calls.open.length;
  assert.deepEqual(await index.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks, store, root: dir, assert: () => {} }), { retry: true }, 'paypay-guided:refused-protected-retry');
  assert.equal(store.calls.open.length, opens, 'paypay-guided:refused-retry-no-decryption'); assert.equal(await handle().state(), 'ready', 'paypay-guided:refused-retry-rearms');
  const old = guidedUi(), ro = await observe(old, refusedJob, handle(), { dir }); assert.equal(old.calls.login, 0, 'paypay-guided:refused-old-journal-holds'); void ro;
  const fresh = guidedUi({ deliver: null }), rf = await observe(fresh, jobOf(), handle(), { dir }); assert.equal(fresh.calls.login, 1, 'paypay-guided:refused-retry-one-submission'); void rf;
  await assert.rejects(index.retryBankLogin({ bankAccountId: ACCOUNT._id }, { live: LIVE, config: CONFIG, banks: async () => [{ _id: ACCOUNT._id, name: 'PayPay 1', ownerId: OWNER, provider: 'paypay', variant: 'baplus' }], store, root: dir, assert: () => {} }), e => e?.code === 'unsupported', 'paypay-guided:refused-retry-variant-bound');
});

test('runBankJob hands the saved login to a guided PayPay標準 observe job only; another observe, the drain and the uploads never receive it', async () => {
  const login = savedLogin(), seen = [];
  const config = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64) }, send = async () => ({ id: 'f'.repeat(24) }), pending = async () => [];
  const run = job => index.runBankJob({ job, account: ACCOUNT }, config, null, { status: async () => {}, pending, upload: send, directory: temp, login, collect: async () => { seen.push(['collect']); return { items: [], failed: null }; }, observe: async (b, j, r, s, options) => { seen.push(['observe', j.snapshot.variant, options.login ?? null]); return { items: [], failed: null, observation: [] }; } });
  await run(jobOf()); await run(jobOf({ variant: 'baplus' })); await run(jobOf({ variant: null })); await run(jobOf({ provider: 'rakuten', variant: 'standard' }));
  assert.deepEqual(seen, [['observe', 'standard', login], ['observe', 'baplus', null], ['observe', null, null], ['observe', 'standard', null]], 'paypay-guided:guided-only');
  assert.equal(login.calls.open + login.calls.state, 0, 'paypay-guided:handover-not-decryption');
  // a guided observe that could not confirm the sign-in ends failed with its explanation after its artifacts were sent
  const sent = [], statuses2 = [];
  const outcome = await index.runBankJob({ job: jobOf(), account: ACCOUNT }, config, null, { status: async (s, t) => { statuses2.push([s, t]); }, pending, upload: async (c, a, item) => { sent.push(item.manifest.kind); return { id: 'f'.repeat(24) }; }, directory: await root(), login, observe: async () => ({ items: [], failed: 'PayPay銀行への自動サインインの完了を確認できませんでした', observation: [{ at: 'x', pathname: '/', title: 't', visibleControls: [], inputs: [], selects: [], downloadEvents: [], clicks: [], typedInto: [], eventsDropped: 0, eventChannel: true }] }) });
  assert.deepEqual(sent, ['observation'], 'paypay-guided:observation-sent-before-failure'); assert.equal(statuses2.at(-1)[0], 'failed'); assert.match(outcome.failed, /確認できませんでした/);
});

// ── Review fold F3: the guided text gate (observeFromPage) — only what OMF accepts as a CSV/text statement becomes a manifest ──
// Shift_JIS bytes built from the platform decoder itself (no guessed encoding table): every two-byte code decoded once, reversed.
const SJIS = (() => { const map = new Map(), d = new TextDecoder('shift_jis', { fatal: true }); for (let a = 0x81; a <= 0xfc; a++) for (let b = 0x40; b <= 0xfc; b++) { try { const c = d.decode(Buffer.from([a, b])); if (c.length === 1 && !map.has(c)) map.set(c, [a, b]); } catch {} } return text => Buffer.from([...text].flatMap(c => c.charCodeAt(0) < 0x80 ? [c.charCodeAt(0)] : map.get(c) || (() => { throw new Error('no Shift_JIS code for ' + c); })())); })();
test('guided text gate: only nonempty, bounded, NUL-free UTF-8 or Shift_JIS text (the server text rule) becomes the statement manifest; a PDF, binary, undecodable, empty or oversized download is not sent, stays on this PC and is explained', async () => {
  const header = '日付,内容,出金金額,入金金額,残高\r\n';
  const kept = [['utf-8 csv', CSV], ['utf-8 bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CSV])], ['shift_jis csv', SJIS(header + '2026/10/01,振込 カクウ,,50000,150000\r\n')], ['header only (empty period)', Buffer.from(header)], ['shift_jis header only', SJIS(header)]];
  const refused = [['pdf (ascii only)', Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n')], ['pdf (binary)', Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x00, 0x01])])], ['binary with NUL', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x14])], ['undecodable', Buffer.from([0x41, 0xff, 0x41, 0xfe, 0x0a])], ['empty', Buffer.alloc(0)], ['over 10 MiB', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)]];
  assert.ok(SJIS(header)[0] === 0x93 && (() => { try { new TextDecoder('utf-8', { fatal: true }).decode(SJIS(header)); return false; } catch { return true; } })(), 'paypay-guided:sjis-fixture-is-not-utf8');
  for (const [label, bytes] of kept) {
    const ui = guidedUi({ deliver: bytes }), login = savedLogin(), r = await observe(ui, jobOf(), login);
    assert.equal(r.error, null, label + ' ' + r.error); assert.equal(r.result.items.length, 1, 'paypay-guided:text-kept ' + label);
    assert.equal(r.result.items[0].manifest.sha256, sha256(bytes), 'paypay-guided:text-kept-exact ' + label); assert.equal(r.result.items[0].manifest.bytes, bytes.length);
    assert.match(String(r.result.notice), /受け取った明細は保存/, 'paypay-guided:text-kept-notice ' + label); assert.equal(login.current, 'blocked', 'paypay-guided:text-not-proof ' + label);
  }
  for (const [label, bytes] of refused) {
    const ui = guidedUi({ deliver: bytes }), login = savedLogin(), r = await observe(ui, jobOf(), login);
    assert.equal(r.error, null, label + ' ' + r.error); assert.equal(r.result.items.length, 0, 'paypay-guided:pdf-not-statement ' + label);
    assert.match(String(r.result.failed), /CSV・テキストとして読めない/, 'paypay-guided:unreadable-explained ' + label); assert.match(String(r.result.failed), /このPCに残しています/, 'paypay-guided:unreadable-kept-locally ' + label);
    const names = await readdir(r.jobDir); assert.ok(!names.includes('manifest.json'), 'paypay-guided:unreadable-no-manifest ' + label);
    const file = names.find(n => /^[a-f\d-]{36}$/.test(n)); assert.ok(file, 'paypay-guided:unreadable-original-kept ' + label); assert.equal(sha256(await readFile(path.join(r.jobDir, file))), sha256(bytes), 'paypay-guided:unreadable-original-bytes ' + label);
    assert.equal(login.calls.accepted, 0); assert.equal(login.current, 'blocked', 'paypay-guided:unreadable-pending-kept ' + label);
  }
  // the person signed in by hand (saved login blocked) and exported a PDF: explained, asked for a CSV; a refused login + PDF names the fields
  const manual = await observe(guidedUi({ deliver: 'pdf' }), jobOf(), savedLogin({ state: 'blocked' }));
  assert.equal(manual.result.items.length, 0, 'paypay-guided:manual-pdf-not-statement'); assert.match(String(manual.result.failed), /CSV・テキストとして読めない.*CSVで出力/, 'paypay-guided:manual-pdf-asks-csv');
  const refusedPdf = await observe(guidedUi({ deliver: 'pdf', outcome: 'rejected' }), jobOf(), savedLogin());
  assert.equal(refusedPdf.result.items.length, 0); assert.match(String(refusedPdf.result.failed), /CSV・テキストとして読めない.*店番号・口座番号・パスワード/, 'paypay-guided:refused-pdf-explained');
  // not a guided capture (the provider's plain observe stage): unchanged here — a refused upload is handled at the outbox boundary below
  const plain = await observe(guidedUi({ deliver: 'pdf' }), jobOf({ variant: null }), null, { adapter: paypay.default });
  assert.equal(plain.result.items.length, 1, 'paypay-guided:plain-observe-unchanged'); assert.equal(plain.result.failed, undefined);
});

// ── Review fold F3: runBankJob at the bank statement outbox boundary, through the REAL upload()/api() against a local OMF stand-in ──
// The stand-in answers each bank/upload with the next scripted reply (Nitro's error shape: statusCode/statusMessage/data.message[/code]).
async function omfStandIn() {
  const requests = [], replies = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x');
    const entry = { path: url.pathname, kind: url.searchParams.get('kind'), jobId: url.searchParams.get('jobId'), sha256: sha256(body) }; requests.push(entry);
    const reply = replies.shift() || { status: 200, body: { id: 'f'.repeat(24) } };
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { requests, replies, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)) };
}
const OTHER_ACCOUNT = { status: 409, body: { statusCode: 409, statusMessage: 'Finance request failed', data: { message: 'この明細は別の口座で受信済みです。', code: 'capture-other-account' } } };
const UNREADABLE = { status: 415, body: { statusCode: 415, statusMessage: 'Finance request failed', data: { message: 'Excel・CSVを選択してください。' } } };
// A captured statement exactly as observeFromPage leaves it: the bytes and the manifest in the job's observe folder.
async function capturedItem(dir, bound, bytes) {
  const jobDir = path.join(dir, 'outbox', 'bank', bound.bankAccountId, bound.jobId + '-observe'), filename = randomUUID(); await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, filename), bytes);
  const manifest = { ...bound, kind: 'statement', channel: 'collector-observe', sourceFormat: 'csv', sha256: sha256(bytes), filename, bytes: bytes.length, suggestedFilename: 'meisai.csv', sourceHost: 'login.paypay-bank.co.jp', downloadedAt: new Date().toISOString() };
  await writeFile(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { directory: jobDir, manifest };
}
const OBSERVATION = [{ at: 'x', pathname: '/', title: 't', visibleControls: [], inputs: [], selects: [], downloadEvents: [], clicks: [], typedInto: [], eventsDropped: 0, eventChannel: true }];
test('bank outbox refusal: a permanent 409 capture-other-account (the same header-only bytes already another account\'s statement) or 415 refusal is recorded on the retained manifest (never acknowledged, never sent again, original kept), the job explains it and the next job proceeds; a transient 409, 401, 403 or 500 still propagates and keeps the manifest pending', async () => {
  const omf = await omfStandIn(), dir = await root(), config = { baseUrl: omf.origin, token: 'omfc_' + 'e'.repeat(64) };
  try {
    const empty = Buffer.from('日付,内容,出金金額,入金金額,残高\r\n');
    const job = (account, observe) => { const j = jobOf(), statuses = []; return { j, statuses, run: () => index.runBankJob({ job: j, account }, config, null, { status: async (s, t) => { statuses.push([s, t]); }, directory: dir, observe: async (bound) => observe(bound), collect: async () => { throw new Error('no retrieve'); } }) }; };
    // 1. PayPay 2 and PayPay 4 exported the identical header-only file; OMF already holds it as PayPay 2's statement → PayPay 4's is refused
    const a = ACCOUNTS[3], first = job(a, async bound => ({ items: [await capturedItem(dir, bound, empty)], observation: OBSERVATION, notice: bank.GUIDED_TEXT.kept('PayPay銀行') }));
    omf.replies.push(OTHER_ACCOUNT);
    const r1 = await first.run();
    assert.equal(first.statuses.at(-1)[0], 'failed', 'bank-refusal:own-refusal-fails-the-job'); assert.match(first.statuses.at(-1)[1], /別の口座で受信済み/, 'bank-refusal:job-explains'); assert.match(first.statuses.at(-1)[1], /このPC/, 'bank-refusal:original-kept-explained'); assert.doesNotMatch(first.statuses.at(-1)[1], /受け取った明細は保存しました/, 'bank-refusal:no-saved-claim');
    assert.ok(first.statuses.at(-1)[1].length <= 200, 'bank-refusal:fits-omf-message');
    const folder = path.join(dir, 'outbox', 'bank', a._id, first.j.jobId + '-observe'), m1 = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
    assert.equal(m1.acknowledgedAt, undefined, 'bank-refusal:never-acknowledged'); assert.deepEqual([m1.refusal?.status, m1.refusal?.reason], [409, 'other-account'], 'bank-refusal:recorded');
    assert.equal(sha256(await readFile(path.join(folder, m1.filename))), sha256(empty), 'bank-refusal:original-bytes-kept'); assert.equal(r1.failed, first.statuses.at(-1)[1]);
    assert.deepEqual(omf.requests.map(x => x.kind), ['statement', 'observation'], 'bank-refusal:observation-still-sent');
    // 2. the next job of PayPay 4 proceeds: the refused manifest is not sent again
    const before = omf.requests.length, second = job(a, async () => ({ items: [], observation: OBSERVATION }));
    await second.run();
    assert.deepEqual(omf.requests.slice(before).map(x => x.kind), ['observation'], 'bank-refusal:no-resend'); assert.equal(second.statuses.at(-1)[0], 'complete', 'bank-refusal:next-job-proceeds');
    assert.deepEqual(await index.pendingBank(a, config, dir), [], 'bank-refusal:not-pending');
    // 3. a 415 for an older retained manifest found by the drain: recorded, and the job's own new statement is still sent and saved
    const b = ACCOUNTS[2], oldJob = jobOf(), old = await capturedItem(dir, { bankAccountId: b._id, ownerId: OWNER, origin: omf.origin, jobId: oldJob.jobId, snapshotHash: oldJob.snapshotHash, provider: 'paypay' }, Buffer.from('%PDF-1.7\n'));
    const third = job(b, async bound => ({ items: [await capturedItem(dir, bound, CSV)], observation: OBSERVATION })); omf.replies.push(UNREADABLE);
    const at3 = omf.requests.length; await third.run();
    assert.deepEqual(omf.requests.slice(at3).map(x => [x.kind, x.jobId === oldJob.jobId]), [['statement', true], ['statement', false], ['observation', false]], 'bank-refusal:drain-then-own');
    assert.equal(third.statuses.at(-1)[0], 'complete', 'bank-refusal:drained-refusal-job-proceeds'); assert.match(third.statuses.at(-1)[1], /明細 1件を保存/); assert.match(third.statuses.at(-1)[1], /CSV・テキストとして読めない/, 'bank-refusal:drained-refusal-explained');
    const m3 = JSON.parse(await readFile(path.join(old.directory, 'manifest.json'), 'utf8')); assert.deepEqual([m3.refusal?.status, m3.refusal?.reason, m3.acknowledgedAt], [415, 'unreadable', undefined], 'bank-refusal:415-recorded');
    const at4 = omf.requests.length; await job(b, async () => ({ items: [], observation: OBSERVATION })).run(); assert.deepEqual(omf.requests.slice(at4).map(x => x.kind), ['observation'], 'bank-refusal:415-no-resend');
    // 4. transient or authorization failures are not refusals: they propagate, the manifest stays pending and is sent by a later job
    const c = ACCOUNTS[1], retained = await capturedItem(dir, { bankAccountId: c._id, ownerId: OWNER, origin: omf.origin, jobId: randomUUID(), snapshotHash: 'a'.repeat(64), provider: 'paypay' }, CSV);
    for (const [label, reply] of [['duplicate 409', { status: 409, body: { statusCode: 409, statusMessage: 'Finance request failed', data: { message: '同じ明細があります。再試行してください。' } } }], ['job unavailable 409', { status: 409, body: { statusCode: 409, statusMessage: 'Job is unavailable for this collector', data: { message: 'Job is unavailable for this collector' } } }], ['401', { status: 401, body: { statusCode: 401, statusMessage: 'Collector authorization required' } }], ['403', { status: 403, body: { statusCode: 403, statusMessage: 'Forbidden' } }], ['500', { status: 500, body: { statusCode: 500, statusMessage: 'Finance request failed', data: { message: '銀行明細の受付を完了できません。' } } }]]) {
      omf.replies.push(reply); let error = null; try { await job(c, async () => ({ items: [], observation: OBSERVATION })).run(); } catch (e) { error = e; }
      assert.equal(error?.status, reply.status, 'bank-refusal:transient-propagates ' + label);
      const m = JSON.parse(await readFile(path.join(retained.directory, 'manifest.json'), 'utf8')); assert.deepEqual([m.refusal, m.acknowledgedAt], [undefined, undefined], 'bank-refusal:transient-not-terminal ' + label);
      assert.equal((await index.pendingBank(c, config, dir)).length, 1, 'bank-refusal:transient-still-pending ' + label);
    }
    await job(c, async () => ({ items: [], observation: OBSERVATION })).run();
    assert.ok(JSON.parse(await readFile(path.join(retained.directory, 'manifest.json'), 'utf8')).acknowledgedAt, 'bank-refusal:transient-later-acknowledged');
    // 5. an observation refused by OMF is not a statement refusal: it propagates (the boundary is the bank STATEMENT outbox)
    omf.replies.push({ status: 200, body: { id: 'f'.repeat(24) } }, UNREADABLE); let obsError = null;
    try { await job(ACCOUNTS[0], async bound => ({ items: [await capturedItem(dir, bound, CSV)], observation: OBSERVATION })).run(); } catch (e) { obsError = e; }
    assert.equal(obsError?.status, 415, 'bank-refusal:observation-refusal-propagates');
  } finally { await omf.close(); }
});

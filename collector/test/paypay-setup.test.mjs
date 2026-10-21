// collector/test/paypay-setup.test.mjs — the one-time protected PayPay銀行 標準ログイン setup for four separate accounts (plan
// omf-paypay-four-accounts-20261021): index.mjs bankLoginInput (the strict body union), saveBankLogin (each exact live-granted
// PayPay standard account of this owner sealed as its own paypay-<bankAccountId> entry with its own AAD; provider/body/variant
// confusion refused; its own refusal marker cleared), the real setup page (setup.html + setup.js) in owned headless Chrome against a
// local stub of the collector's setup endpoints (four independent sections, no readback, values cleared, refresh-safe), and the real
// collector process refusing PayPay bodies without a protected session. Fictional values only; no bank, OMF, vault key or ordinary
// browser is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-setup-test-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
const index = await import('../index.mjs');
const { aadOf } = await import('../vault.mjs');
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });
const exists = p => access(p).then(() => true, () => false);

const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ORIGIN = 'https://omf.example';
const P = ['b1b1b1b1b1b1b1b1b1b1b1b1', 'b2b2b2b2b2b2b2b2b2b2b2b2', 'b3b3b3b3b3b3b3b3b3b3b3b3', 'b4b4b4b4b4b4b4b4b4b4b4b4'];
const RAKUTEN = 'c3c3c3c3c3c3c3c3c3c3c3c3', BAPLUS = 'b5b5b5b5b5b5b5b5b5b5b5b5', NOVARIANT = 'b6b6b6b6b6b6b6b6b6b6b6b6';
const CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64), accountInfo: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: OWNER, provider: 'amex', primaryCard: '10000', name: 'Card' }] };
const LIVE = { mode: 'protected', installationId: 'f'.repeat(32) };
// The bank metadata OMF returns for this device (financeBankCollectionService listCollectorBankAccounts).
const GRANTED = [...P.map((id, i) => ({ _id: id, name: 'PayPay ' + (i + 1), ownerId: OWNER, provider: 'paypay', variant: 'standard' })), { _id: RAKUTEN, name: '楽天銀行 普通', ownerId: OWNER, provider: 'rakuten', variant: 'standard' }, { _id: BAPLUS, name: 'PayPay BA-PLUS', ownerId: OWNER, provider: 'paypay', variant: 'baplus' }, { _id: NOVARIANT, name: 'PayPay (no login type)', ownerId: OWNER, provider: 'paypay', variant: null }];
// Four fictional standard logins: distinct branches/accounts, leading zeros, passwords with spaces/symbols.
const LOGINS = [{ branch: '001', account: '0000001', password: 'Fictional-1 ' }, { branch: '010', account: '0100002', password: ' Fictional 2/<>' }, { branch: '100', account: '1000003', password: 'f'.repeat(32) }, { branch: '009', account: '0090004', password: 'Fict"4&' }];

test('bankLoginInput: the PayPay standard body is exactly bankAccountId + branch (3 digits) + account (7 digits) + password (1-32, verbatim); mixed or extra keys are refused; the 楽天銀行 body is unchanged', () => {
  assert.deepEqual(index.bankLoginInput({ bankAccountId: P[0], ...LOGINS[1] }), { bankAccountId: P[0], ...LOGINS[1] }, 'paypay-setup:input-verbatim (leading zeros and password spaces kept)');
  assert.deepEqual(index.bankLoginInput({ bankAccountId: RAKUTEN, username: '  fictional-user  ', password: ' Fictional Pass ' }), { bankAccountId: RAKUTEN, username: 'fictional-user', password: ' Fictional Pass ' }, 'paypay-setup:rakuten-body-unchanged');
  const ok = { bankAccountId: P[0], ...LOGINS[0] };
  for (const bad of [{ ...ok, branch: '01' }, { ...ok, branch: '0123' }, { ...ok, branch: 12 }, { ...ok, branch: ' 012' }, { ...ok, branch: '０１２' }, { ...ok, account: '000001' }, { ...ok, account: '00000001' }, { ...ok, account: 1 }, { ...ok, password: '' }, { ...ok, password: 'p'.repeat(33) }, { ...ok, password: null },
    { ...ok, username: 'u' }, { bankAccountId: P[0], username: 'u', password: 'p', branch: '001' }, { ...ok, transferPin: '1234' }, { bankAccountId: 'nope', ...LOGINS[0] }, { bankAccountId: P[0], branch: '001', account: '0000001' }, { bankAccountId: P[0], branch: '001', password: 'p' }])
    assert.throws(() => index.bankLoginInput(bad), Error, 'paypay-setup:bad-body ' + JSON.stringify(bad));
});

test('saveBankLogin: four live-granted PayPay standard accounts are sealed as four separate entries, each with its own AAD and values; each save clears only its own refusal marker', async () => {
  const dir = path.join(temp, 'four'), writes = [], banks = async () => GRANTED, write = async (id, aad, value) => { writes.push({ id, aad, value }); };
  await mkdir(path.join(dir, 'bank-login'), { recursive: true });
  for (const id of P) await writeFile(path.join(dir, 'bank-login', 'paypay-' + id + '.json'), JSON.stringify({ keyId: 'old-' + id }));
  for (const [i, id] of P.entries()) assert.deepEqual(await index.saveBankLogin(index.bankLoginInput({ bankAccountId: id, ...LOGINS[i] }), { live: LIVE, config: CONFIG, banks, write, root: dir }), { saved: true }, 'paypay-setup:reply-has-no-login ' + i);
  assert.deepEqual(writes.map(w => w.id), P.map(id => 'paypay-' + id), 'paypay-setup:four-own-entries');
  for (const [i, w] of writes.entries()) {
    assert.deepEqual(w.aad, aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'paypay', accountId: P[i] }), 'paypay-setup:own-aad ' + i);
    assert.deepEqual(w.value, LOGINS[i], 'paypay-setup:own-values ' + i);
  }
  assert.equal(new Set(writes.map(w => JSON.stringify(w.aad))).size, 4, 'paypay-setup:aad-distinct');
  for (const id of P) assert.equal(await exists(path.join(dir, 'bank-login', 'paypay-' + id + '.json')), false, 'paypay-setup:own-marker-cleared');
  // one more re-save of account 3 only: the other three markers (recreated) stay
  for (const id of P) await writeFile(path.join(dir, 'bank-login', 'paypay-' + id + '.json'), JSON.stringify({ keyId: 'pending-' + id }));
  await index.saveBankLogin(index.bankLoginInput({ bankAccountId: P[2], ...LOGINS[2] }), { live: LIVE, config: CONFIG, banks, write, root: dir });
  assert.deepEqual(await Promise.all(P.map(id => exists(path.join(dir, 'bank-login', 'paypay-' + id + '.json')))), [true, true, false, true], 'paypay-setup:marker-isolation');
  // the 楽天銀行 standard save is unchanged next to them
  await index.saveBankLogin(index.bankLoginInput({ bankAccountId: RAKUTEN, username: 'fictional-user', password: 'Fictional-Pass-0001' }), { live: LIVE, config: CONFIG, banks, write, root: dir });
  assert.deepEqual(writes.at(-1), { id: 'rakuten-' + RAKUTEN, aad: aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'rakuten', accountId: RAKUTEN }), value: { username: 'fictional-user', password: 'Fictional-Pass-0001' } }, 'paypay-setup:rakuten-save-unchanged');
});

test('saveBankLogin refuses provider/body confusion, BA-PLUS and a PayPay account without a login type, an ungranted or foreign account and a failed OMF lookup — writing nothing', async () => {
  const writes = [], write = async (...args) => { writes.push(args); }, dir = path.join(temp, 'refuse');
  const save = (body, banks = async () => GRANTED) => index.saveBankLogin(index.bankLoginInput(body), { live: LIVE, config: CONFIG, banks, write, root: dir });
  await assert.rejects(save({ bankAccountId: RAKUTEN, ...LOGINS[0] }), e => e.code === 'unsupported', 'paypay-setup:paypay-body-for-rakuten');
  await assert.rejects(save({ bankAccountId: P[0], username: 'fictional-user', password: 'p' }), e => e.code === 'unsupported', 'paypay-setup:rakuten-body-for-paypay');
  await assert.rejects(save({ bankAccountId: BAPLUS, ...LOGINS[0] }), e => e.code === 'unsupported', 'paypay-setup:baplus-manual');
  await assert.rejects(save({ bankAccountId: NOVARIANT, ...LOGINS[0] }), e => e.code === 'unsupported', 'paypay-setup:no-login-type');
  await assert.rejects(save({ bankAccountId: 'e1e1e1e1e1e1e1e1e1e1e1e1', ...LOGINS[0] }), e => e.code === 'forbidden', 'paypay-setup:not-granted');
  await assert.rejects(save({ bankAccountId: P[1], ...LOGINS[1] }, async () => [{ ...GRANTED[1], ownerId: 'e2e2e2e2e2e2e2e2e2e2e2e2' }]), e => e.code === 'forbidden', 'paypay-setup:other-owner');
  await assert.rejects(save({ bankAccountId: P[1], ...LOGINS[1] }, async () => { throw Object.assign(new Error('Collector unavailable'), { status: 401 }); }), e => e.status === 401, 'paypay-setup:omf-refusal');
  assert.equal(writes.length, 0, 'paypay-setup:nothing-written');
});

// ── the real setup page against a local stub of the collector's setup endpoints (owned headless Chrome) ──
async function stubCollector(state) {
  const posts = [], key = 'k'.repeat(64);
  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', await readFile(path.join(here, '..', 'setup.html')));
    if (req.method === 'GET' && req.url === '/setup.js') return send(200, 'text/javascript; charset=utf-8', await readFile(path.join(here, '..', 'setup.js')));
    if (req.headers['x-setup-key'] !== key) return send(403, 'application/json', JSON.stringify({ error: 'key' }));
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.method === 'GET' && req.url === '/status') { state.statusCalls++; return send(200, 'application/json', JSON.stringify(state.status())); }
    if (req.method === 'GET' && ['/aplus/status', '/yayoi/status'].includes(req.url)) return send(200, 'application/json', JSON.stringify({ busy: false, unlocked: true, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false } }));
    if (req.method === 'POST' && req.url === '/bank/retry') { const parsed = JSON.parse(body); state.retries.push(parsed); if (state.retryFail) return send(409, 'application/json', JSON.stringify({ error: 'There is no uncertain automatic sign-in to retry for the current saved login.' })); state.pending.delete(parsed.bankAccountId); return send(200, 'application/json', JSON.stringify({ retry: true })); }
    if (req.method === 'POST' && req.url === '/bank/credentials') { const parsed = JSON.parse(body); posts.push(parsed); if (state.fail) return send(400, 'application/json', JSON.stringify({ error: 'Saved sign-in is available only for 楽天銀行 and PayPay銀行 標準ログイン.' })); state.saved.add(parsed.bankAccountId); return send(200, 'application/json', JSON.stringify({ saved: true })); }
    return send(404, 'application/json', JSON.stringify({ error: 'Unknown setup endpoint' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: 'http://127.0.0.1:' + server.address().port, key, posts, close: () => new Promise(r => server.close(r)) };
}
const statusOf = state => ({ message: 'Connected.', approvalUrl: null, reconnectNeeded: false, baseUrl: ORIGIN, pcName: 'PC', connect: { phase: 'idle' }, busy: false, authorizing: false, locking: false, legacy: false, protected: true, mode: 'protected', capability: true, unlocked: state.unlocked, unlockUntil: new Date(Date.now() + 600000).toISOString(), due: false, paused: false, keyLost: false, aclProtected: true, elevated: false, chromeFound: true, testBroker: false, startupDone: true, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false }, mailbox: { hasCredentials: false }, smsSource: { serial: null, adbFound: false },
  accounts: [{ id: '10000', accountId: CONFIG.accountInfo[0]._id, name: 'Card', provider: 'amex', hasCredentials: false }],
  banks: [...P.map((id, i) => ({ bankAccountId: id, name: 'PayPay ' + (i + 1), provider: 'paypay', variant: 'standard', supported: true, hasCredentials: state.saved.has(id), refused: state.refused.has(id) || state.pending?.has(id) === true, pending: state.pending?.get(id) ?? (state.refused.has(id) ? 'blocked' : null) })), { bankAccountId: BAPLUS, name: 'PayPay BA-PLUS', provider: 'paypay', variant: 'baplus', supported: false, hasCredentials: false, refused: false }] });

test('the real setup page: four independent PayPay sections, each saves exactly its own body once with leading zeros and the password verbatim, clears its fields, never reads a login back, and a refresh does not erase another section\'s typing', { timeout: 240000 }, async () => {
  const { browserFor } = await import('../browser.mjs');
  const state = { unlocked: true, saved: new Set(), refused: new Set(), fail: false, statusCalls: 0 }; state.status = () => statusOf(state);
  const collector = await stubCollector(state), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-setup-chrome-'));
  const browser = await browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try {
    page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const wait = async (f, arg, label) => { for (let i = 0; i < 150; i++) { if (await page.evaluate(f, arg)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('paypay-setup:chrome ' + label + ' — page: ' + String(await page.$eval('#banks', e => e.innerHTML).catch(() => 'no #banks')).slice(0, 600) + ' — errors: ' + errors.join(' | ')); };
    const open = async () => { await page.goto('about:blank'); return page.goto(collector.origin + '/#' + collector.key, { waitUntil: 'networkidle0' }); };
    const card = id => '[data-bank-login="' + id + '"] ';
    await open(); await wait(sel => !!document.querySelector(sel), card(P[3]) + '[data-bank-login-save]', 'four sections');
    for (const [i, id] of P.entries()) {
      assert.equal(await page.$eval(card(id) + 'h2', e => e.textContent), 'PayPay ' + (i + 1), 'paypay-setup:independent-label ' + i);
      assert.deepEqual(await page.$$eval(card(id) + 'input', list => list.map(e => [e.dataset.bankLoginField, e.type, e.maxLength, e.autocomplete, e.inputMode])), [['branch', 'text', 3, 'off', 'numeric'], ['account', 'text', 7, 'off', 'numeric'], ['password', 'password', 32, 'off', '']], 'paypay-setup:fields ' + i);
      assert.match(await page.$eval(card(id) + '[data-bank-login-note]', e => e.textContent), /PayPay銀行/, 'paypay-setup:note ' + i);
    }
    assert.equal(new Set(await page.$$eval('#banks input', list => list.map(e => e.id))).size, 12, 'paypay-setup:distinct-field-ids');
    assert.equal(await page.$(card(BAPLUS) + 'input'), null, 'paypay-setup:baplus-no-form'); assert.match(await page.$eval(card(BAPLUS), e => e.textContent), /not available/i, 'paypay-setup:baplus-explained');
    // typing in section 1, then saving section 3: section 1 keeps what the person is typing, section 3 posts exactly its own values
    await page.type(card(P[0]) + '[data-bank-login-field="branch"]', '00');
    for (const [name, value] of Object.entries(LOGINS[2])) await page.type(card(P[2]) + '[data-bank-login-field="' + name + '"]', value);
    await page.click(card(P[2]) + '[data-bank-login-save]');
    await wait(sel => /saved on this PC/i.test(document.querySelector(sel)?.textContent || ''), card(P[2]) + '[data-bank-login-note]', 'saved note 3');
    assert.deepEqual(collector.posts, [{ bankAccountId: P[2], ...LOGINS[2] }], 'paypay-setup:exact-body-once');
    assert.deepEqual(await page.$$eval(card(P[2]) + 'input', list => list.map(e => e.value)), ['', '', ''], 'paypay-setup:fields-cleared');
    assert.ok(state.statusCalls >= 2, 'the save refreshed the status');
    assert.equal(await page.$eval(card(P[0]) + '[data-bank-login-field="branch"]', e => e.value), '00', 'paypay-setup:refresh-keeps-other-typing');
    // the other three in turn
    for (const i of [0, 1, 3]) {
      await page.$eval(card(P[i]) + '[data-bank-login-field="branch"]', e => { e.value = ''; });
      for (const [name, value] of Object.entries(LOGINS[i])) await page.type(card(P[i]) + '[data-bank-login-field="' + name + '"]', value);
      await page.click(card(P[i]) + '[data-bank-login-save]');
      await wait(sel => /saved on this PC/i.test(document.querySelector(sel)?.textContent || ''), card(P[i]) + '[data-bank-login-note]', 'saved note ' + i);
    }
    assert.deepEqual(collector.posts.map(p => p.bankAccountId), [P[2], P[0], P[1], P[3]], 'paypay-setup:four-saves');
    for (const [i, id] of P.entries()) assert.deepEqual(collector.posts.find(p => p.bankAccountId === id), { bankAccountId: id, ...LOGINS[i] }, 'paypay-setup:own-body ' + i);
    const html = await page.content();
    for (const l of LOGINS) assert.ok(!html.includes(l.account) && !html.includes(l.password.trim()), 'paypay-setup:no-readback');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie), '{}{}', 'paypay-setup:no-browser-storage');
    // a refused automatic sign-in of account 2 only; a failed save keeps nothing typed
    state.refused.add(P[1]); await open(); await wait(sel => /not confirmed/i.test(document.querySelector(sel)?.textContent || ''), card(P[1]) + '[data-bank-login-note]', 'refused note');
    for (const id of [P[0], P[2], P[3]]) assert.doesNotMatch(await page.$eval(card(id) + '[data-bank-login-note]', e => e.textContent), /not confirmed/i, 'paypay-setup:refusal-isolated');
    state.fail = true; for (const [name, value] of Object.entries(LOGINS[1])) await page.type(card(P[1]) + '[data-bank-login-field="' + name + '"]', value); await page.click(card(P[1]) + '[data-bank-login-save]');
    await wait(sel => /標準ログイン/.test(document.querySelector(sel)?.textContent || ''), card(P[1]) + '[data-bank-login-note]', 'error shown');
    assert.deepEqual(await page.$$eval(card(P[1]) + 'input', list => list.map(e => e.value)), ['', '', ''], 'paypay-setup:cleared-on-error');
    // without a protected session every save button is disabled
    state.unlocked = false; await open(); await wait(sel => !!document.querySelector(sel), card(P[0]) + '[data-bank-login-save]', 'locked');
    assert.deepEqual(await page.$$eval('[data-bank-login-save]', list => list.map(e => e.disabled)), [true, true, true, true], 'paypay-setup:save-needs-protected-session');
    assert.deepEqual(errors, [], 'paypay-setup:no-console-errors');
  } finally { if (page) await page.close().catch(() => {}); await browser.close(); await collector.close(); if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(profileDir, { recursive: true, force: true }); }
});

test('the real collector process refuses a malformed or mixed PayPay body (400) and a well-formed one without a protected session (403); nothing is written', { timeout: 300000 }, async () => {
  const { startCollector, brokerEnv, removeOwnedTemp } = await import('./fake-broker.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-setup-process-')), brokerDir = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-setup-broker-'));
  const collector = await startCollector({ directory, env: { ...brokerEnv(brokerDir), OMF_COLLECTOR_ORIGIN: 'https://omf.example.invalid', OMF_COLLECTOR_TICK_MS: '1000' }, hideBrowser: true, timeoutMs: 120000 });
  try {
    assert.ok(await collector.waitStartup(120000), 'startup');
    for (const bad of [{ bankAccountId: P[0], branch: '01', account: '0000001', password: 'p' }, { bankAccountId: P[0], branch: '001', account: '0000001', password: 'p', username: 'u' }, { bankAccountId: P[0], branch: '001', account: '0000001' }])
      assert.equal((await collector.request('/bank/credentials', bad)).status, 400, 'paypay-setup:http-bad-body ' + JSON.stringify(bad));
    const refused = await collector.request('/bank/credentials', { bankAccountId: P[0], ...LOGINS[0] });
    assert.equal(refused.status, 403, 'paypay-setup:http-needs-protected-session ' + refused.text); assert.ok(!refused.text.includes(LOGINS[0].account));
    assert.equal(await exists(path.join(directory, 'secrets')), false, 'paypay-setup:no-secret-written');
  } finally { await collector.stop(); await removeOwnedTemp(directory, { tmpdir: os.tmpdir() }).catch(() => {}); await removeOwnedTemp(brokerDir, { tmpdir: os.tmpdir() }).catch(() => {}); }
});

// ── Plan P1: the owner's explicit protected retry with the ALREADY saved login after an uncertain attempt ──
function retryStore() {
  const entries = new Map(), calls = { open: 0, locks: 0 };
  const save = (id, aad, value) => { const keyId = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'g'.repeat(64), keyId } }, value }); return keyId; };
  return { entries, calls, save, async has(id) { return entries.has(id); }, async read(id) { const e = entries.get(id); if (!e) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return e.envelope; },
    async open() { calls.open++; throw new Error('a retry must never decrypt'); }, async withLock(fn) { calls.locks++; return fn(); } };
}
const ppAad = (id, owner = OWNER) => aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: owner, provider: 'paypay', accountId: id });
const markerFile = (dir, provider, id) => path.join(dir, 'bank-login', provider + '-' + id + '.json');
const writeMarker = async (dir, provider, id, value) => { await mkdir(path.join(dir, 'bank-login'), { recursive: true }); await writeFile(markerFile(dir, provider, id), JSON.stringify(value)); };

test('retryBankLogin: only the current key\'s uncertain marker of the exact granted PayPay標準 account is removed, under the store lock, without any decryption; refused, legacy, superseded, missing, unbound, foreign, ungranted and other-provider requests change nothing', async () => {
  const dir = path.join(temp, 'retry'), store = retryStore(), keys = {}, banks = async () => GRANTED;
  for (const id of P) keys[id] = store.save('paypay-' + id, ppAad(id), { branch: '001', account: '0000001', password: 'p' });
  keys.R = store.save('rakuten-' + RAKUTEN, aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'rakuten', accountId: RAKUTEN }), { username: 'u', password: 'p' });
  await writeMarker(dir, 'paypay', P[0], { entry: 'paypay-' + P[0], keyId: keys[P[0]], refusedAt: 'x', kind: 'uncertain' });
  await writeMarker(dir, 'paypay', P[1], { entry: 'paypay-' + P[1], keyId: keys[P[1]], refusedAt: 'x', kind: 'refused' });
  await writeMarker(dir, 'paypay', P[2], { entry: 'paypay-' + P[2], keyId: keys[P[2]], refusedAt: 'x' });
  await writeMarker(dir, 'paypay', P[3], { entry: 'paypay-' + P[3], keyId: 'f'.repeat(64), refusedAt: 'x', kind: 'uncertain' });
  await writeMarker(dir, 'rakuten', RAKUTEN, { entry: 'rakuten-' + RAKUTEN, keyId: keys.R, refusedAt: 'x' });
  const journal = path.join(dir, 'outbox', 'bank', P[0], 'job-1-observe', 'login.json'); await mkdir(path.dirname(journal), { recursive: true }); await writeFile(journal, '{}');
  const retry = (id, extra = {}) => index.retryBankLogin(index.bankRetryInput({ bankAccountId: id }), { live: LIVE, config: CONFIG, banks, store, root: dir, assert: () => {}, ...extra });
  const markers = () => Promise.all([...P.map(id => exists(markerFile(dir, 'paypay', id))), exists(markerFile(dir, 'rakuten', RAKUTEN))]);
  for (const bad of [null, [], {}, { bankAccountId: 'x' }, { bankAccountId: P[0], force: true }]) assert.throws(() => index.bankRetryInput(bad), Error, 'paypay-retry:bad-body ' + JSON.stringify(bad));
  assert.deepEqual(await retry(P[0]), { retry: true }, 'paypay-retry:uncertain-allowed');
  assert.deepEqual(await markers(), [false, true, true, true, true], 'paypay-retry:only-own-marker-removed');
  assert.equal(store.calls.open, 0, 'paypay-retry:no-decryption'); assert.ok(store.calls.locks >= 1, 'paypay-retry:under-store-lock'); assert.equal(await exists(journal), true, 'paypay-retry:journal-kept');
  const refusedWith = async (id, code, label, extra) => { await assert.rejects(retry(id, extra), e => e?.code === code, 'paypay-retry:' + label); };
  await refusedWith(P[0], 'conflict', 'nothing-left-to-retry');
  await refusedWith(P[1], 'conflict', 'refusal-needs-corrected-values');
  await refusedWith(P[2], 'conflict', 'legacy-marker-not-guessed');
  await refusedWith(P[3], 'conflict', 'superseded-key-marker');
  await refusedWith(RAKUTEN, 'unsupported', 'rakuten-keeps-resave');
  await refusedWith(BAPLUS, 'unsupported', 'baplus-manual'); await refusedWith(NOVARIANT, 'unsupported', 'no-login-type');
  await refusedWith('e1e1e1e1e1e1e1e1e1e1e1e1', 'forbidden', 'ungranted');
  await refusedWith(P[1], 'forbidden', 'other-owner', { banks: async () => [{ ...GRANTED[1], ownerId: 'e2e2e2e2e2e2e2e2e2e2e2e2' }] });
  await assert.rejects(retry(P[1], { banks: async () => { throw Object.assign(new Error('Collector unavailable'), { status: 401 }); } }), e => e.status === 401, 'paypay-retry:omf-refusal-propagates');
  assert.deepEqual(await markers(), [false, true, true, true, true], 'paypay-retry:refusals-change-nothing');
  // missing and unbound entries
  await writeMarker(dir, 'paypay', P[2], { entry: 'paypay-' + P[2], keyId: keys[P[2]], refusedAt: 'x', kind: 'uncertain' });
  store.entries.delete('paypay-' + P[2]); await refusedWith(P[2], 'conflict', 'missing-entry');
  store.save('paypay-' + P[2], ppAad(P[2], 'e3e3e3e3e3e3e3e3e3e3e3e3'), {}); await refusedWith(P[2], 'conflict', 'unbound-entry');
  assert.equal(await exists(markerFile(dir, 'paypay', P[2])), true, 'paypay-retry:missing-unbound-change-nothing');
  assert.equal(store.calls.open, 0, 'paypay-retry:never-decrypts');
});

test('retryBankLogin races: a session ending before or after the checks, a newer key saved meanwhile and the marker turning into a refusal meanwhile each leave the marker; the action slot is reserved synchronously and released once', async () => {
  const dir = path.join(temp, 'retry-race'), store = retryStore(), id = P[0];
  const key = () => store.entries.get('paypay-' + id).envelope.keyId, fresh = async () => { store.save('paypay-' + id, ppAad(id), { branch: '001', account: '0000001', password: 'p' }); await writeMarker(dir, 'paypay', id, { entry: 'paypay-' + id, keyId: key(), refusedAt: 'x', kind: 'uncertain' }); };
  const retry = extra => index.retryBankLogin({ bankAccountId: id }, { live: LIVE, config: CONFIG, banks: async () => GRANTED, store, root: dir, assert: () => {}, ...extra });
  const ended = () => Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' });
  for (const [label, extra] of [
    ['session-ended-first', { assert: () => { throw ended(); } }],
    ['session-ended-before-mutation', (() => { let n = 0; return { assert: () => { if (++n === 2) throw ended(); } }; })()],
    ['newer-key-meanwhile', { banks: async () => { store.save('paypay-' + id, ppAad(id), { branch: '001', account: '0000002', password: 'q' }); return GRANTED; } }],
    ['marker-refused-meanwhile', { banks: async () => { await writeMarker(dir, 'paypay', id, { entry: 'paypay-' + id, keyId: key(), refusedAt: 'y', kind: 'refused' }); return GRANTED; } }],
    ['scope-removed-meanwhile', { banks: async () => GRANTED.filter(b => b._id !== id) }]
  ]) {
    await fresh();
    await assert.rejects(retry(extra), Error, 'paypay-retry:race ' + label);
    assert.equal(await exists(markerFile(dir, 'paypay', id)), true, 'paypay-retry:race-keeps-marker ' + label);
  }
  await fresh(); assert.deepEqual(await retry({}), { retry: true }, 'paypay-retry:race-control');
  const release = index.reserveAction();
  assert.throws(() => index.reserveAction(), e => e?.code === 'conflict', 'paypay-retry:slot-busy');
  release(); release();
  const again = index.reserveAction(); again();
});

test('the real setup page: an uncertain PayPay account offers "Allow one more sign-in with the saved login" (posting only its id), a refused one asks for corrected values instead, inputs stay empty, nothing is read back', { timeout: 240000 }, async () => {
  const { browserFor } = await import('../browser.mjs');
  const state = { unlocked: true, saved: new Set(P), refused: new Set(), pending: new Map([[P[0], 'uncertain'], [P[1], 'refused'], [P[2], 'uncertain']]), retries: [], fail: false, retryFail: false, statusCalls: 0 }; state.status = () => statusOf(state);
  const collector = await stubCollector(state), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-retry-chrome-'));
  const browser = await browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try {
    page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const wait = async (f, arg, label) => { for (let i = 0; i < 300; i++) { if (await page.evaluate(f, arg)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('paypay-retry:chrome ' + label + ' — ' + String(await page.$eval('#banks', e => e.innerHTML).catch(() => '')).slice(0, 600) + ' ' + errors.join('|')); };
    const open = async () => { await page.goto('about:blank'); return page.goto(collector.origin + '/#' + collector.key, { waitUntil: 'networkidle0' }); };
    const card = id => '[data-bank-login="' + id + '"] ';
    await open(); await wait(sel => { const e = document.querySelector(sel); return !!e && !e.disabled; }, card(P[0]) + '[data-bank-login-retry]', 'retry button');
    assert.match(await page.$eval(card(P[0]) + '[data-bank-login-note]', e => e.textContent), /cannot tell whether the bank accepted it/, 'paypay-retry:uncertain-explained');
    assert.equal(await page.$(card(P[1]) + '[data-bank-login-retry]'), null, 'paypay-retry:refused-no-retry');
    assert.match(await page.$eval(card(P[1]) + '[data-bank-login-note]', e => e.textContent), /bank refused the saved login/, 'paypay-retry:refused-explained');
    assert.equal(await page.$(card(P[3]) + '[data-bank-login-retry]'), null, 'paypay-retry:ready-no-retry');
    await page.type(card(P[2]) + '[data-bank-login-field="branch"]', '01');
    await page.click(card(P[0]) + '[data-bank-login-retry]');
    await wait(sel => /saved on this PC/i.test(document.querySelector(sel)?.textContent || ''), card(P[0]) + '[data-bank-login-note]', 'rearmed note');
    assert.deepEqual(state.retries, [{ bankAccountId: P[0] }], 'paypay-retry:posts-only-the-id');
    assert.deepEqual(collector.posts, [], 'paypay-retry:no-login-posted');
    assert.equal(await page.$(card(P[0]) + '[data-bank-login-retry]'), null, 'paypay-retry:button-gone-after-rearm');
    assert.deepEqual(await page.$$eval(card(P[0]) + 'input', l => l.map(e => e.value)), ['', '', ''], 'paypay-retry:inputs-empty');
    assert.equal(await page.$eval(card(P[2]) + '[data-bank-login-field="branch"]', e => e.value), '01', 'paypay-retry:other-section-typing-kept');
    state.retryFail = true; await page.click(card(P[2]) + '[data-bank-login-retry]');
    await wait(sel => /no uncertain automatic sign-in/i.test(document.querySelector(sel)?.textContent || ''), card(P[2]) + '[data-bank-login-note]', 'retry failure shown');
    state.unlocked = false; await open(); await wait(sel => !!document.querySelector(sel), card(P[2]) + '[data-bank-login-retry]', 'locked');
    assert.equal(await page.$eval(card(P[2]) + '[data-bank-login-retry]', e => e.disabled), true, 'paypay-retry:needs-protected-session');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie), '{}{}', 'paypay-retry:no-browser-storage');
    assert.deepEqual(errors, [], 'paypay-retry:no-console-errors');
  } finally { if (page) await page.close().catch(() => {}); await browser.close(); await collector.close(); if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(profileDir, { recursive: true, force: true }); }
});

test('the real collector process refuses a malformed retry body (400) and a valid one without a protected session (403); nothing is written', { timeout: 300000 }, async () => {
  const { startCollector, brokerEnv, removeOwnedTemp } = await import('./fake-broker.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-retry-process-')), brokerDir = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-retry-broker-'));
  const collector = await startCollector({ directory, env: { ...brokerEnv(brokerDir), OMF_COLLECTOR_ORIGIN: 'https://omf.example.invalid', OMF_COLLECTOR_TICK_MS: '1000' }, hideBrowser: true, timeoutMs: 120000 });
  try {
    assert.ok(await collector.waitStartup(120000), 'startup');
    for (const bad of [{ bankAccountId: 'x' }, { bankAccountId: P[0], force: true }, '{not json']) assert.equal((await collector.request('/bank/retry', bad)).status, 400, 'paypay-retry:http-bad-body ' + JSON.stringify(bad));
    assert.equal((await collector.request('/bank/retry', { bankAccountId: P[0] })).status, 403, 'paypay-retry:http-needs-protected-session');
    assert.equal((await collector.request('/bank/retry', { bankAccountId: P[0] }, { 'X-Setup-Key': 'wrong' })).status, 403, 'paypay-retry:setup-key-required');
    assert.equal((await collector.status()).busy, false, 'paypay-retry:slot-released');
    assert.equal(await exists(path.join(directory, 'bank-login')), false, 'paypay-retry:nothing-written');
  } finally { await collector.stop(); await removeOwnedTemp(directory, { tmpdir: os.tmpdir() }).catch(() => {}); await removeOwnedTemp(brokerDir, { tmpdir: os.tmpdir() }).catch(() => {}); }
});

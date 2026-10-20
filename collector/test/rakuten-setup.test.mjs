// collector/test/rakuten-setup.test.mjs — the one-time protected 楽天銀行 login setup (plan omf-rakuten-auto-login-20261021 §3):
// index.mjs bankLoginInput/saveBankLogin (the exact live-granted bank account, 楽天銀行 標準 only, this pairing's owner, the
// account's own sealed entry and AAD), the real setup page (setup.html + setup.js) in owned headless Chrome against a local stub
// of the collector's setup endpoints, and the real collector process refusing a body or a save without a protected session.
// Fictional values only; no bank, OMF, vault key or ordinary browser is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-setup-test-'));
process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
const index = await import('../index.mjs');
const { aadOf } = await import('../vault.mjs');
test.after(async () => { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); });
const exists = p => access(p).then(() => true, () => false);

const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', BANK = 'c3c3c3c3c3c3c3c3c3c3c3c3', ORIGIN = 'https://omf.example';
const CARDS = ['a1a1a1a1a1a1a1a1a1a1a1a1', 'a2a2a2a2a2a2a2a2a2a2a2a2', 'a3a3a3a3a3a3a3a3a3a3a3a3'].map((id, i) => ({ _id: id, ownerId: OWNER, provider: i === 2 ? 'aplus' : 'amex', primaryCard: String(10000 + i), name: 'Card ' + i }));
const CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64), accountInfo: CARDS };
const LIVE = { mode: 'protected', installationId: 'f'.repeat(32) };
// The bank metadata OMF returns for this device: the owner added the bank account to the PC after the card-only pairing.
const GRANTED = [{ _id: BANK, name: '楽天銀行 普通', ownerId: OWNER, provider: 'rakuten', variant: 'standard' }, { _id: 'b2b2b2b2b2b2b2b2b2b2b2b2', name: 'PayPay', ownerId: OWNER, provider: 'paypay', variant: null }, { _id: 'b3b3b3b3b3b3b3b3b3b3b3b3', name: '楽天銀行 プラス', ownerId: OWNER, provider: 'rakuten', variant: 'plus' }];

test('bankLoginInput: exactly the bank account id, a login ID and a password; anything else is refused before any session or OMF call', () => {
  const input = index.bankLoginInput({ bankAccountId: BANK, username: '  fictional-user  ', password: ' Fictional Pass ' });
  assert.deepEqual(input, { bankAccountId: BANK, username: 'fictional-user', password: ' Fictional Pass ' }, 'bank-setup:input-normalized (ID trimmed, password verbatim)');
  for (const bad of [null, [], 'x', {}, { bankAccountId: BANK, username: 'u' }, { bankAccountId: BANK, password: 'p' }, { bankAccountId: 'nope', username: 'u', password: 'p' }, { bankAccountId: BANK, username: '   ', password: 'p' }, { bankAccountId: BANK, username: 'u', password: '' }, { bankAccountId: BANK, username: 'u', password: 'p'.repeat(257) }, { bankAccountId: BANK, username: 'u', password: 'p', transferPin: '1234' }, { bankAccountId: BANK, username: 7, password: 'p' }])
    assert.throws(() => index.bankLoginInput(bad), Error, 'bank-setup:bad-body ' + JSON.stringify(bad));
});

test('saveBankLogin: the exact live-granted 楽天銀行 標準 account of this owner is sealed as its own entry; nothing is launched or returned', async () => {
  const writes = [], dir = path.join(temp, 'save'); await mkdir(path.join(dir, 'bank-login'), { recursive: true });
  await writeFile(path.join(dir, 'bank-login', 'rakuten-' + BANK + '.json'), JSON.stringify({ keyId: 'old' }));
  const banks = async () => GRANTED, write = async (id, aad, value) => { writes.push({ id, aad, value }); };
  const reply = await index.saveBankLogin(index.bankLoginInput({ bankAccountId: BANK, username: 'fictional-user', password: 'Fictional-Pass-0001' }), { live: LIVE, config: CONFIG, banks, write, root: dir });
  assert.deepEqual(reply, { saved: true }, 'bank-setup:reply-has-no-login');
  assert.deepEqual(writes, [{ id: 'rakuten-' + BANK, aad: aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: OWNER, provider: 'rakuten', accountId: BANK }), value: { username: 'fictional-user', password: 'Fictional-Pass-0001' } }], 'bank-setup:own-entry-own-aad');
  assert.equal(await exists(path.join(dir, 'bank-login', 'rakuten-' + BANK + '.json')), false, 'bank-setup:resave-clears-refusal');
  // an update is the same call with the new values: one more sealed write of the same entry
  await index.saveBankLogin(index.bankLoginInput({ bankAccountId: BANK, username: 'fictional-user', password: 'Fictional-Pass-0002' }), { live: LIVE, config: CONFIG, banks, write, root: dir });
  assert.deepEqual(writes.map(w => [w.id, w.value.password]), [['rakuten-' + BANK, 'Fictional-Pass-0001'], ['rakuten-' + BANK, 'Fictional-Pass-0002']], 'bank-setup:update');
});

test('saveBankLogin refuses an account OMF does not grant to this PC, another owner\'s, an unsupported bank or login variant, and a failed OMF lookup — writing nothing', async () => {
  const writes = [], write = async (...args) => { writes.push(args); }, dir = path.join(temp, 'refuse');
  const save = (bankAccountId, banks, config = CONFIG) => index.saveBankLogin(index.bankLoginInput({ bankAccountId, username: 'u', password: 'p' }), { live: LIVE, config, banks, write, root: dir });
  await assert.rejects(save('e1e1e1e1e1e1e1e1e1e1e1e1', async () => GRANTED), e => e.code === 'forbidden', 'bank-setup:not-granted');
  await assert.rejects(save(BANK, async () => [{ ...GRANTED[0], ownerId: 'e2e2e2e2e2e2e2e2e2e2e2e2' }]), e => e.code === 'forbidden', 'bank-setup:other-owner');
  await assert.rejects(save(BANK, async () => [{ ...GRANTED[0], ownerId: '' }]), e => e.code === 'forbidden', 'bank-setup:owner-unknown');
  await assert.rejects(save('b2b2b2b2b2b2b2b2b2b2b2b2', async () => GRANTED), e => e.code === 'unsupported', 'bank-setup:unsupported-bank');
  await assert.rejects(save('b3b3b3b3b3b3b3b3b3b3b3b3', async () => GRANTED), e => e.code === 'unsupported', 'bank-setup:unsupported-variant');
  await assert.rejects(save(BANK, async () => { throw Object.assign(new Error('Collector unavailable'), { status: 401 }); }), e => e.status === 401, 'bank-setup:omf-refusal');
  assert.equal(writes.length, 0, 'bank-setup:nothing-written');
  // the legitimate configured bank is not blocked by the other refusals
  const ok = []; await index.saveBankLogin(index.bankLoginInput({ bankAccountId: BANK, username: 'u', password: 'p' }), { live: LIVE, config: CONFIG, banks: async () => GRANTED, write: async (id) => { ok.push(id); }, root: dir });
  assert.deepEqual(ok, ['rakuten-' + BANK], 'bank-setup:legitimate-not-overblocked');
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
    if (req.method === 'GET' && req.url === '/status') return send(200, 'application/json', JSON.stringify(state.status()));
    if (req.method === 'GET' && ['/aplus/status', '/yayoi/status'].includes(req.url)) return send(200, 'application/json', JSON.stringify({ busy: false, unlocked: true, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false } }));
    if (req.method === 'POST' && req.url === '/bank/credentials') { const parsed = JSON.parse(body); posts.push(parsed); if (state.fail) return send(400, 'application/json', JSON.stringify({ error: 'Saved sign-in is available only for 楽天銀行 標準ログイン.' })); state.saved.add(parsed.bankAccountId); return send(200, 'application/json', JSON.stringify({ saved: true })); }
    return send(404, 'application/json', JSON.stringify({ error: 'Unknown setup endpoint' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: 'http://127.0.0.1:' + server.address().port, key, posts, close: () => new Promise(r => server.close(r)) };
}
const statusOf = (state, extra = {}) => ({ message: 'Connected.', approvalUrl: null, reconnectNeeded: false, baseUrl: ORIGIN, pcName: 'PC', connect: { phase: 'idle' }, busy: false, authorizing: false, locking: false, legacy: false, protected: true, mode: 'protected', capability: true, unlocked: state.unlocked, unlockUntil: new Date(Date.now() + 600000).toISOString(), due: false, paused: false, keyLost: false, aclProtected: true, elevated: false, chromeFound: true, testBroker: false, startupDone: true, aplus: { hasCredentials: false }, yayoi: { state: 'idle', message: '', hasCredentials: false }, mailbox: { hasCredentials: false }, smsSource: { serial: null, adbFound: false },
  accounts: [{ id: '10000', accountId: CARDS[0]._id, name: 'Card 0', provider: 'amex', hasCredentials: false }],
  banks: [{ bankAccountId: BANK, name: '楽天銀行 普通', provider: 'rakuten', variant: 'standard', supported: true, hasCredentials: state.saved.has(BANK), refused: !!state.refused }, { bankAccountId: 'b2b2b2b2b2b2b2b2b2b2b2b2', name: 'PayPay', provider: 'paypay', variant: null, supported: false, hasCredentials: false, refused: false }], ...extra });

test('the real setup page lists only the granted banks, saves the exact account once with ID and password, clears the fields and shows the saved state without reading it back', { timeout: 180000 }, async () => {
  const { browserFor } = await import('../browser.mjs');
  const state = { unlocked: false, saved: new Set(), refused: false, fail: false }; state.status = () => statusOf(state);
  const collector = await stubCollector(state), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-setup-chrome-'));
  const browser = await browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try {
    page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const wait = async (f, arg, label) => { for (let i = 0; i < 150; i++) { if (await page.evaluate(f, arg)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('bank-setup:chrome ' + label + ' — page: ' + String(await page.$eval('#banks', e => e.innerHTML).catch(() => 'no #banks')).slice(0, 500) + ' — errors: ' + errors.join(' | ')); };
    const card = '[data-bank-login="' + BANK + '"] ';
    // setup.js removes the key from the address after reading it, so every load is a fresh document navigation with the key.
    const open = async () => { await page.goto('about:blank'); return page.goto(collector.origin + '/#' + collector.key, { waitUntil: 'networkidle0' }); };
    await open(); await wait(sel => !!document.querySelector(sel), card, 'bank section');
    assert.equal(await page.$('[data-bank-login="b2b2b2b2b2b2b2b2b2b2b2b2"] [data-bank-login-user]'), null, 'bank-setup:unsupported-no-form');
    assert.match(await page.$eval('[data-bank-login="b2b2b2b2b2b2b2b2b2b2b2b2"]', e => e.textContent), /not available/i, 'bank-setup:unsupported-explained');
    assert.equal(await page.$eval(card + '[data-bank-login-save]', e => e.disabled), true, 'bank-setup:save-needs-protected-session');
    assert.equal(await page.$eval(card + '[data-bank-login-password]', e => e.type), 'password', 'bank-setup:password-masked');
    assert.equal(await page.$eval(card + '[data-bank-login-password]', e => e.autocomplete), 'off');
    assert.ok(await page.$('[data-account-login], #accounts form'), 'bank-setup:card-forms-kept');
    state.unlocked = true; await open(); await wait(sel => { const e = document.querySelector(sel); return !!e && !e.disabled; }, card + '[data-bank-login-save]', 'save enabled');
    await page.type(card + '[data-bank-login-user]', 'fictional-user'); await page.type(card + '[data-bank-login-password]', 'Fictional-Pass-0001'); await page.click(card + '[data-bank-login-save]');
    await wait(sel => /saved on this PC/i.test(document.querySelector(sel)?.textContent || ''), card + '[data-bank-login-note]', 'saved note');
    assert.deepEqual(collector.posts, [{ bankAccountId: BANK, username: 'fictional-user', password: 'Fictional-Pass-0001' }], 'bank-setup:exact-body-once');
    assert.deepEqual(await page.$$eval(card + 'input', list => list.map(e => e.value)), ['', ''], 'bank-setup:fields-cleared');
    const html = await page.content(); assert.ok(!html.includes('Fictional-Pass-0001') && !html.includes('fictional-user'), 'bank-setup:no-readback');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie), '{}{}', 'bank-setup:no-browser-storage');
    // a refusal by the bank is shown with the way out; a failed save keeps nothing typed
    state.refused = true; await open(); await wait(sel => /not confirmed/i.test(document.querySelector(sel)?.textContent || ''), card + '[data-bank-login-note]', 'refused note');
    state.fail = true; await page.type(card + '[data-bank-login-user]', 'fictional-user'); await page.type(card + '[data-bank-login-password]', 'Fictional-Pass-0003'); await page.click(card + '[data-bank-login-save]');
    await wait(sel => /標準ログイン/.test(document.querySelector(sel)?.textContent || ''), card + '[data-bank-login-note]', 'error shown');
    assert.equal(await page.$eval(card + '[data-bank-login-password]', e => e.value), '', 'bank-setup:password-cleared-on-error');
    assert.deepEqual(errors, [], 'bank-setup:no-console-errors');
  } finally { if (page) await page.close().catch(() => {}); await browser.close(); await collector.close(); if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(profileDir, { recursive: true, force: true }); }
});

test('the real collector process refuses a malformed bank-login body (400) and a save without a protected session (403); its status lists no bank and touches no secret', { timeout: 120000 }, async () => {
  const { startCollector, brokerEnv, removeOwnedTemp } = await import('./fake-broker.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-setup-process-')), brokerDir = await mkdtemp(path.join(os.tmpdir(), 'omf-bank-setup-broker-'));
  const collector = await startCollector({ directory, env: { ...brokerEnv(brokerDir), OMF_COLLECTOR_ORIGIN: 'https://omf.example.invalid', OMF_COLLECTOR_TICK_MS: '1000' }, hideBrowser: true });
  try {
    assert.ok(await collector.waitStartup(), 'startup');
    assert.equal((await collector.request('/bank/credentials', { bankAccountId: 'x', username: 'u', password: 'p' })).status, 400, 'bank-setup:http-bad-body');
    assert.equal((await collector.request('/bank/credentials', '{not json')).status, 400, 'bank-setup:http-not-json');
    const refused = await collector.request('/bank/credentials', { bankAccountId: BANK, username: 'fictional-user', password: 'Fictional-Pass-0001' });
    assert.equal(refused.status, 403, 'bank-setup:http-needs-protected-session ' + refused.text); assert.ok(!refused.text.includes('Fictional-Pass-0001'));
    const status = await collector.status(); assert.deepEqual(status.banks, [], 'bank-setup:status-no-bank-without-connection');
    assert.equal(await exists(path.join(directory, 'secrets')), false, 'bank-setup:no-secret-written');
    assert.equal((await collector.request('/bank/credentials', { bankAccountId: BANK, username: 'u', password: 'p' }, { 'X-Setup-Key': 'wrong' })).status, 403, 'bank-setup:setup-key-required');
  } finally { await collector.stop(); await removeOwnedTemp(directory, { tmpdir: os.tmpdir() }).catch(() => {}); await removeOwnedTemp(brokerDir, { tmpdir: os.tmpdir() }).catch(() => {}); }
});

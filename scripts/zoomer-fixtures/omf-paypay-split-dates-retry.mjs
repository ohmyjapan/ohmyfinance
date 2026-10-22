// Fixture for plan omf-paypay-split-dates-retry-20261022 (output/plan/omf-paypay-split-dates-retry-20261022/5-plan.json): PayPay銀行's
// actual statement shape (the transaction date in three columns 操作日(年)/(月)/(日), 取引順番号 a sequence number, not a bank transaction
// ID), the observed active-session page (the standard login form again under the visible h1 上書きログイン（ログイン中です）) and the owner's
// explicit saved-login retry widened from uncertain-only to uncertain OR refused for the current key. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-split-dates-retry.mjs --cwd <this worktree>
// Fictional data only: the exact observed header shape with invented rows, an intercepted fake login page inside owned headless Chrome,
// in-memory sealed-entry stores, temporary folders, the built app on the harness's owned ephemeral MongoDB, the real collector daemon on a
// temporary collector directory. No bank, owner AppData, production database, credential or business send is reached.
// Legs: D shared date rules (+ declaration parity) · C collector outcome/retry on the real modules · A the adapter on owned headless
// Chrome · L the permanent no-file-as-proof regression · U the PayPay collector unit files · H the HTTP split-date integration (built app)
// · R the real daemon /bank/retry route on a refused current key (busy and incomplete-body slot) · M named semantic mutants.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 1200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const u = rel => pathToFileURL(path.join(root, rel)).href;
const MONGOD = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => existsSync(p)) || null;
// Every Chrome a collector browser.mjs launches in this process or its subprocesses is forced headless with external name resolution
// refused (the omf-bank-collection.mjs control); a loaded launcher writes a receipt line to stderr.
const FIXTURE_LAUNCH = "\n;{const __fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=o=>__fixtureLaunch({...o,headless:true,args:[...(o?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});}\nexport const __fixtureHeadless=true;\n";
const isLauncher = (url, source) => /\/browser\.mjs$/.test(url) && /export const LAUNCH_ARGS/.test(source);
const HOOK_IMPORT = 'data:text/javascript,' + encodeURIComponent(`import{registerHooks}from'node:module';registerHooks({load(url,c,n){const r=n(url,c);return /\\/browser\\.mjs$/.test(url)&&/export const LAUNCH_ARGS/.test(String(r.source))?{...r,source:String(r.source)+${JSON.stringify(FIXTURE_LAUNCH + "process.stderr.write('[fixture-headless-control] '+import.meta.url+'\\n');\n")}}:r}});`);
const run = (args, env = {}, timeout = 840000, cwd = root) => new Promise(resolve => execFile(process.execPath, ['--import', HOOK_IMPORT, ...args], { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(MONGOD ? { MONGOMS_SYSTEM_BINARY: MONGOD } : {}), ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
const passesOf = text => text.split(/\r?\n/).filter(l => l.startsWith('PASS '));
const receiptOf = text => { const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('{"pass":')); try { return line ? JSON.parse(line) : null; } catch { return null; } };
const evidence = (name, text) => writeFile(path.join(root, '.zoomer-split-' + name + '.txt'), text);
const sha256 = b => createHash('sha256').update(b).digest('hex');
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const list = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list };
}
// A sibling copy of a module with named edits (each anchor must hit exactly once): relative imports keep resolving.
async function mutantModule(file, edits) {
  const source = path.join(root, file); let text = await readFile(source, 'utf8');
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ': ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  const target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.split-mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
const fresh = file => import(pathToFileURL(file).href + '?v=' + randomUUID());
async function removeOwned(dir) { if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep) && !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe removal ' + dir); await rm(dir, { recursive: true, force: true }); }
async function chunkFiles(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await chunkFiles(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }

// ── D: the shared split-date rules (shared/finance-payment-match.mjs or a mutant copy) ──
export const ACTUAL_HEADERS = ['操作日(年)', '操作日(月)', '操作日(日)', '操作時刻(時)', '操作時刻(分)', '操作時刻(秒)', '取引順番号', '摘要', 'お支払金額', 'お預り金額', '残高', 'メモ'];
const LEGACY_KEYS = ['date', 'description', 'amount', 'outflow', 'inflow', 'balance', 'reference', 'transactionId', 'currency', 'direction'];
export async function probeShared(file = path.join(root, 'shared/finance-payment-match.mjs')) {
  const m = await fresh(file), src = { hash: 'a'.repeat(64), sheet: 'Sheet1', row: 2 }, base = { description: 'カクウ取引', outflow: '100', inflow: '' };
  // a thrown error carries the label of the check it broke (so a mutant that throws still names its assertion)
  const labelled = async (label, fn) => { try { return await fn(); } catch (e) { throw new assert.AssertionError({ message: label + ': ' + (e?.message || e) }); } };
  const day = async (v, label = 'split:date') => labelled(label, async () => (await m.normalizeBankRow({ ...base, ...v }, src)).date);
  const held = async (v, label) => { await assert.rejects(m.normalizeBankRow({ ...base, ...v }, src), /取引日を確認してください/, label); };
  // the direct-date path is unchanged (same dates, same refusals, the same whole row with or without empty part keys)
  for (const [raw, want] of [['2026/10/01', '2026-10-01'], ['20261001', '2026-10-01'], ['2026年10月1日', '2026-10-01'], ['2026-1-5', '2026-01-05'], ['2028/02/29', '2028-02-29']]) assert.equal(await day({ date: raw }, 'split:direct-date-unchanged ' + raw), want, 'split:direct-date-unchanged ' + raw);
  for (const raw of ['', '2026/02/30', '2027/02/29', '26/10/01', '2026/13/01']) await held({ date: raw }, 'split:direct-date-unchanged refused ' + JSON.stringify(raw));
  assert.deepEqual(await m.normalizeBankRow({ ...base, date: '2026/10/01', dateYear: '', dateMonth: '', dateDay: '' }, src), await m.normalizeBankRow({ ...base, date: '2026/10/01' }, src), 'split:direct-date-unchanged whole-row');
  // complete parts: digits only (NFKC), a 4-digit year, 1-2 digit month and day, a real calendar day
  for (const [y, mo, d, want] of [['2026', '10', '1', '2026-10-01'], ['2026', '1', '05', '2026-01-05'], ['２０２６', '１０', '２１', '2026-10-21'], [' 2026 ', '10', '31', '2026-10-31']]) assert.equal(await day({ dateYear: y, dateMonth: mo, dateDay: d }, 'split:parts-complete ' + [y, mo, d]), want, 'split:parts-complete ' + [y, mo, d]);
  for (const [y, want] of [['2028', '2028-02-29'], ['2000', '2000-02-29']]) assert.equal(await day({ dateYear: y, dateMonth: '2', dateDay: '29' }, 'split:leap-day ' + y), want, 'split:leap-day ' + y);
  for (const p of [['2026', '2', '30'], ['2027', '2', '29'], ['1900', '2', '29'], ['2026', '4', '31'], ['2026', '13', '1'], ['2026', '0', '1'], ['2026', '10', '0'], ['2026', '10', '32'], ['26', '10', '1'], ['20260', '10', '1'], ['2026', '010', '1'], ['2026', '10', '1日'], ['2026年', '10', '1'], ['2026', '10', '1.5'], ['2026', '-1', '1']]) await held({ dateYear: p[0], dateMonth: p[1], dateDay: p[2] }, 'split:parts-invalid-held ' + p);
  // partial parts are held with the existing error: no day, month or year is invented
  for (const p of [['2026', '10', ''], ['2026', '', '1'], ['', '10', '1'], ['2026', '', ''], ['', '', '1']]) await held({ dateYear: p[0], dateMonth: p[1], dateDay: p[2] }, 'split:parts-partial-held ' + JSON.stringify(p));
  // the direct date column wins when it is also present
  assert.equal(await day({ date: '2026/10/05', dateYear: '2026', dateMonth: '1', dateDay: '1' }, 'split:direct-date-precedence'), '2026-10-05', 'split:direct-date-precedence');
  assert.equal(typeof m.bankDateSource, 'function', 'split:date-source-exported');
  assert.equal(m.bankDateSource({ date: '0', dateYear: '1', dateMonth: '2', dateDay: '3' }), 'date', 'split:direct-date-precedence source');
  assert.equal(m.bankDateSource({ date: '', dateYear: '1', dateMonth: '2', dateDay: '3' }), 'parts', 'split:parts-complete source');
  for (const map of [{ date: '', dateYear: '1', dateMonth: '2' }, { date: '', dateYear: '1', dateMonth: '2', dateDay: '' }, {}, { date: '' }]) assert.equal(m.bankDateSource(map), null, 'split:parts-partial-held source ' + JSON.stringify(map));
  // the exact observed headers only (half- or full-width parentheses); 取引順番号 is never a bank transaction ID; no near-miss is guessed
  const guess = m.guessBankMapping(ACTUAL_HEADERS);
  assert.equal(guess.transactionId, '', 'split:sequence-not-bank-id');
  assert.deepEqual(guess, { date: '', description: '7', amount: '', outflow: '8', inflow: '9', balance: '10', reference: '11', transactionId: '', currency: '', direction: '', dateYear: '0', dateMonth: '1', dateDay: '2' }, 'split:exact-header-guess');
  assert.deepEqual(m.guessBankMapping(ACTUAL_HEADERS.map(h => h.replace('(', '（').replace(')', '）'))), guess, 'split:exact-header-guess full-width');
  for (const near of [['年', '月', '日', '摘要'], ['操作日', '操作日(年月日)', '取引日(年)', '摘要'], ['操作日（年）の値', '操作月', '操作日日']]) assert.deepEqual(Object.keys(m.guessBankMapping(near)).filter(k => !LEGACY_KEYS.includes(k)), [], 'split:exact-header-guess near-miss ' + near);
  // legacy fields, guesses and the native template are exactly as before
  assert.deepEqual(m.BANK_FIELDS.map(f => f[0]), LEGACY_KEYS, 'split:legacy-fields-unchanged');
  assert.deepEqual((m.BANK_DATE_PARTS || []).map(f => f[0]), ['dateYear', 'dateMonth', 'dateDay'], 'split:date-parts-keys');
  assert.deepEqual(m.guessBankMapping(['取引日', '摘要', '出金', '入金', '残高', 'メモ']), { date: '0', description: '1', amount: '', outflow: '2', inflow: '3', balance: '4', reference: '5', transactionId: '', currency: '', direction: '' }, 'split:legacy-fields-unchanged guess');
  assert.deepEqual(Object.keys(m.BANK_NATIVE_TEMPLATES.rakuten.standard.mapping), LEGACY_KEYS, 'split:legacy-fields-unchanged native-template');
  // file-row identity: two identical rows of one file keep two keys, same fingerprint
  const r1 = await labelled('split:file-row-identity', () => m.normalizeBankRow({ ...base, dateYear: '2026', dateMonth: '10', dateDay: '2' }, src)), r2 = await labelled('split:file-row-identity', () => m.normalizeBankRow({ ...base, dateYear: '2026', dateMonth: '10', dateDay: '2' }, { ...src, row: 3 }));
  assert.deepEqual([r1.fingerprint === r2.fingerprint, r1.key !== r2.key, r1.idKind], [true, true, 'file-row'], 'split:file-row-identity');
  return 'direct-date regression, complete/leap/invalid/partial parts, precedence, exact-header guess, legacy fields';
}
async function declarationParity() {
  const d = await readFile(path.join(root, 'shared/finance-payment-match.d.mts'), 'utf8'), m = await fresh(path.join(root, 'shared/finance-payment-match.mjs'));
  assert.match(d, /^export const BANK_DATE_PARTS: \[string,string,string\[\]\]\[\];$/m, 'split:declaration-parity BANK_DATE_PARTS');
  assert.match(d, /^export function bankDateSource\(mapping:any\):'date'\|'parts'\|null;$/m, 'split:declaration-parity bankDateSource');
  assert.ok(Array.isArray(m.BANK_DATE_PARTS) && typeof m.bankDateSource === 'function', 'split:declaration-parity runtime');
  return 'declarations match the runtime exports';
}

// ── C: the collector outcome and retry on the real modules (or mutant copies) ──
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', ORIGIN = 'https://omf.example', P = ['b1b1b1b1b1b1b1b1b1b1b1b1', 'b2b2b2b2b2b2b2b2b2b2b2b2', 'b3b3b3b3b3b3b3b3b3b3b3b3', 'b4b4b4b4b4b4b4b4b4b4b4b4', 'b7b7b7b7b7b7b7b7b7b7b7b7'];
const RAKUTEN = 'c3c3c3c3c3c3c3c3c3c3c3c3', BAPLUS = 'b5b5b5b5b5b5b5b5b5b5b5b5';
const CONFIG = { baseUrl: ORIGIN, token: 'omfc_' + 'a'.repeat(64), accountInfo: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', ownerId: OWNER, provider: 'amex', primaryCard: '10000', name: 'Card' }] };
const LIVE = { mode: 'protected', installationId: 'f'.repeat(32) };
const GRANTED = [...P.map((id, i) => ({ _id: id, name: 'PayPay ' + (i + 1), ownerId: OWNER, provider: 'paypay', variant: 'standard' })), { _id: RAKUTEN, name: '楽天銀行', ownerId: OWNER, provider: 'rakuten', variant: 'standard' }, { _id: BAPLUS, name: 'PayPay BA-PLUS', ownerId: OWNER, provider: 'paypay', variant: 'baplus' }];
function memoryStore() {
  const entries = new Map(), calls = { open: 0, locks: 0 };
  const save = (id, aad, value) => { const keyId = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'g'.repeat(64), keyId } }, value }); return keyId; };
  return { entries, calls, save, async has(id) { return entries.has(id); }, async read(id) { const e = entries.get(id); if (!e) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return e.envelope; }, async open() { calls.open++; throw new Error('a retry must never decrypt'); }, async withLock(fn) { calls.locks++; return fn(); } };
}
export async function probeRetry(indexFile, temp) {
  const index = await fresh(indexFile), { aadOf } = await import(u('collector/vault.mjs'));
  const dir = await mkdtemp(path.join(temp, 'retry-')), store = memoryStore(), keys = {};
  const ppAad = (id, owner = OWNER) => aadOf({ installationId: LIVE.installationId, origin: ORIGIN, ownerId: owner, provider: 'paypay', accountId: id });
  for (const id of P) keys[id] = store.save('paypay-' + id, ppAad(id), { branch: '001', account: '0000001', password: 'fictional' });
  const markerFile = id => path.join(dir, 'bank-login', 'paypay-' + id + '.json');
  const marker = async (id, value) => { await mkdir(path.join(dir, 'bank-login'), { recursive: true }); await writeFile(markerFile(id), JSON.stringify(value)); };
  const has = id => readFile(markerFile(id)).then(() => true, () => false);
  const retry = (id, extra = {}) => index.retryBankLogin(index.bankRetryInput({ bankAccountId: id }), { live: LIVE, config: CONFIG, banks: async () => GRANTED, store, root: dir, assert: () => {}, ...extra });
  const refusedWith = async (id, code, label, extra) => { await assert.rejects(retry(id, extra), e => e?.code === code, label); };
  const allowed = async (id, label) => { try { return await retry(id); } catch (e) { throw new assert.AssertionError({ message: label + ': ' + (e?.message || e) }); } };
  await marker(P[0], { entry: 'paypay-' + P[0], keyId: keys[P[0]], refusedAt: 'x', kind: 'refused' });
  await marker(P[1], { entry: 'paypay-' + P[1], keyId: keys[P[1]], refusedAt: 'x', kind: 'uncertain' });
  await marker(P[2], { entry: 'paypay-' + P[2], keyId: 'f'.repeat(64), refusedAt: 'x', kind: 'refused' });
  await marker(P[3], { entry: 'paypay-' + P[3], keyId: keys[P[3]], refusedAt: 'x' });
  await marker(P[4], { entry: 'paypay-' + P[0], keyId: keys[P[4]], refusedAt: 'x', kind: 'refused' });
  const journal = path.join(dir, 'outbox', 'bank', P[0], 'job-1-observe', 'login.json'); await mkdir(path.dirname(journal), { recursive: true }); await writeFile(journal, '{}');
  // negatives first: each leaves its marker exactly as it was
  await refusedWith(P[2], 'conflict', 'retry:superseded-refused-refused');
  await refusedWith(P[3], 'conflict', 'retry:legacy-not-guessed');
  await refusedWith(P[4], 'conflict', 'retry:misnamed-refused');
  await refusedWith(P[0], 'forbidden', 'retry:owner-bound', { banks: async () => GRANTED.map(b => b._id === P[0] ? { ...b, ownerId: 'e2e2e2e2e2e2e2e2e2e2e2e2' } : b) });
  await refusedWith(P[0], 'unsupported', 'retry:variant-bound', { banks: async () => GRANTED.map(b => b._id === P[0] ? { ...b, variant: 'baplus' } : b) });
  await refusedWith(P[0], 'forbidden', 'retry:grant-bound', { banks: async () => GRANTED.filter(b => b._id !== P[0]) });
  await refusedWith(RAKUTEN, 'unsupported', 'retry:provider-bound'); await refusedWith(BAPLUS, 'unsupported', 'retry:provider-bound baplus');
  await assert.rejects(retry(P[0], { assert: () => { throw Object.assign(new Error('ended'), { code: 'forbidden' }); } }), e => e?.code === 'forbidden', 'retry:live-session');
  for (const bad of [{ bankAccountId: P[0], force: true }, { bankAccountId: 'x' }, null]) assert.throws(() => index.bankRetryInput(bad), Error, 'retry:strict-body ' + JSON.stringify(bad));
  assert.deepEqual(await Promise.all(P.map(has)), [true, true, true, true, true], 'retry:negatives-change-nothing');
  // the current key's refusal: one explicit retry, only that marker removed, nothing decrypted, the job journal kept
  assert.deepEqual(await allowed(P[0], 'retry:current-refused-allowed'), { retry: true }, 'retry:current-refused-allowed');
  assert.deepEqual(await Promise.all(P.map(has)), [false, true, true, true, true], 'retry:only-own-marker-removed');
  assert.deepEqual(await allowed(P[1], 'retry:uncertain-allowed'), { retry: true }, 'retry:uncertain-allowed');
  await refusedWith(P[0], 'conflict', 'retry:nothing-to-retry');
  assert.equal(store.calls.open, 0, 'retry:no-decryption'); assert.ok(store.calls.locks >= 1, 'retry:under-store-lock'); assert.equal(await readFile(journal, 'utf8'), '{}', 'retry:journal-kept');
  // the action slot is still taken synchronously and released once
  const release = index.reserveAction(); assert.throws(() => index.reserveAction(), e => e?.code === 'conflict', 'retry:slot-busy'); release(); index.reserveAction()();
  return 'refused/uncertain current key retried once; superseded, legacy, misnamed, owner, variant, grant, provider, session and body refused';
}
// A page-less guided ui (the shape of collector/test/paypay-guided-capture.test.mjs): one exact form, one submission with `outcome`.
function guidedUi(outcome, clock = { t: 1_800_000_000_000 }) {
  const calls = { login: 0 };
  return { calls, now: () => clock.t, async wait(ms) { clock.t += ms; }, async open() {}, async state() { return { kind: 'unknown' }; }, async show() {},
    async loginForm() { return { ok: true, document: 'doc-1' }; }, async document() { return 'doc-1'; }, async login() { calls.login++; return { outcome, document: 'doc-1' }; },
    downloadSession() { return { on() {}, async close() {} }; } };
}
function fakeLogin() {
  const calls = { open: 0, kinds: [], accepted: 0 }; let current = 'ready';
  return { calls, get current() { return current; }, async state() { return current; }, async open() { calls.open++; return { branch: '012', account: '0012345', password: 'Fictional Only' }; }, async rejected(kind) { calls.kinds.push(kind ?? null); current = kind === 'refused' ? 'refused' : 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
export async function probeGuided(bankFile, temp) {
  const bank = await fresh(bankFile), paypay = await import(u('collector/banks/paypay.mjs'));
  const inUse = fakeLogin(), r = await bank.guidedSignIn(guidedUi('session-in-use'), { label: 'PayPay銀行', login: inUse });
  assert.deepEqual(inUse.calls.kinds, ['uncertain'], 'inuse:not-refused');
  assert.equal(inUse.calls.accepted, 0, 'inuse:stays-uncertain'); assert.equal(inUse.current, 'blocked', 'inuse:stays-uncertain state');
  assert.deepEqual([r.submitted, r.refused, inUse.calls.open], [true, false, 1], 'inuse:one-submission'); assert.match(String(r.text), /ログイン中/, 'inuse:explained'); assert.match(String(r.text), /「上書きログイン」は自動では押しません/, 'inuse:no-overwrite-said');
  const refused = fakeLogin(), rr = await bank.guidedSignIn(guidedUi('rejected'), { label: 'PayPay銀行', login: refused });
  assert.deepEqual([refused.calls.kinds, rr.refused], [['uncertain', 'refused'], true], 'refusal:distinct'); assert.match(String(rr.text), /受け付けませんでした/, 'refusal:distinct text'); assert.match(String(rr.text), /もう一度試す/, 'refusal:retry-named');
  // once only: the same job reclaimed after the active-session page submits nothing (journal), and its end explains the other session
  const dir = await mkdtemp(path.join(temp, 'guided-')), job = { jobId: randomUUID(), kind: 'observe', provider: 'paypay', snapshot: { provider: 'paypay', variant: 'standard', interpretation: 'unmapped', headers: [], mapping: {} } };
  job.snapshotHash = sha256(JSON.stringify(job.snapshot));
  const bound = { bankAccountId: P[0], ownerId: OWNER, origin: ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'paypay' }, status = async () => {};
  const login = fakeLogin(), first = guidedUi('session-in-use'), r1 = await bank.observeFromPage(null, null, paypay.standard, bound, job, dir, status, { ui: first, login, now: first.now, wait: first.wait, pollMs: 1000, timeoutMs: 5000 });
  assert.equal(first.calls.login, 1); assert.match(String(r1.failed), /ログイン中だった.*サインインは完了していません/, 'inuse:explained-end'); assert.doesNotMatch(String(r1.failed), /受け付けませんでした/, 'inuse:not-wrong-password');
  const again = guidedUi('session-in-use'), retryLogin = fakeLogin(); await bank.observeFromPage(null, null, paypay.standard, bound, job, dir, status, { ui: again, login: retryLogin, now: again.now, wait: again.wait, pollMs: 1000, timeoutMs: 5000 });
  assert.deepEqual([again.calls.login, retryLogin.calls.open], [0, 0], 'inuse:once-only');
  return 'session-in-use stays uncertain (one submission, no refusal, no acceptance, explained), refusal distinct, journal holds the job';
}

// ── A: the adapter on owned headless Chrome against an intercepted fake login page (the publicly observed form shape) ──
const LOGIN_ORIGIN = 'https://login.paypay-bank.co.jp', ENTRY = '/wctx/1D1DFxFDg.do', ACTION = '/wctx/NBCW2101.do', TOP = '/wctx/NBG000Top.do', OVERWRITE = '/wctx/Overwrite.do';
const HEADING = '上書きログイン（ログイン中です）';
function fakePage({ heading = '', headingStyle = '', extraHeading = '', error = '' } = {}) {
  const fn = 'j' + randomUUID().replaceAll('-', '').slice(0, 16);
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン｜PayPay銀行</title><body>${heading ? `<h1 style="${headingStyle}">${heading}</h1>` : ''}${extraHeading ? `<h1>${extraHeading}</h1>` : ''}${error ? `<p>${error}</p>` : ''}
<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return ${fn}(document.HOST)" target="_self">店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> ログインパスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form>
${heading ? `<a id="overwrite" href="${OVERWRITE}">上書きログイン</a>` : ''}<script>function ${fn}(f){return true;}</script></body></html>`;
}
export async function probeAdapter(paypayFile, temp) {
  const paypay = await fresh(paypayFile), { browserFor } = await import(u('collector/browser.mjs'));
  if (paypay.SESSION_IN_USE_HEADING !== undefined) assert.equal(paypay.SESSION_IN_USE_HEADING, HEADING, 'inuse:heading-exact');
  const browser = await browserFor(path.join(await mkdtemp(path.join(temp, 'chrome-')), 'profile'), { headless: true }), out = {};
  try {
    const page = await browser.newPage(), site = { answer: null, posts: 0, overwrites: 0, foreign: 0 };
    await page.setRequestInterception(true);
    page.on('request', request => { let url; try { url = new URL(request.url()); } catch { return request.abort(); } if (url.origin !== LOGIN_ORIGIN) { site.foreign++; return request.abort(); }
      const html = body => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
      if (url.pathname === ENTRY) return html(fakePage());
      if (url.pathname === ACTION && request.method() === 'POST') { site.posts++; return html(site.answer); }
      if (url.pathname === OVERWRITE) { site.overwrites++; return request.abort(); }
      if (url.pathname === TOP) return html('<!doctype html><html><body>トップ（架空）</body></html>');
      return request.abort(); });
    const ui = paypay.standardUi(page, browser, paypay.standard, { provider: 'paypay', variant: 'standard' }, { settleMs: 20000, stableMs: 800 });
    const cases = { 'in-use': fakePage({ heading: HEADING }), hidden: fakePage({ heading: HEADING, headingStyle: 'display:none' }), different: fakePage({ heading: 'ログイン' }), doubled: fakePage({ heading: HEADING, extraHeading: HEADING }), 'wrong-password': fakePage({ error: '店番号・口座番号またはパスワードが正しくありません' }), success: `<!doctype html><html><body><script>location.replace(${JSON.stringify(TOP)})</script></body></html>` };
    for (const [name, answer] of Object.entries(cases)) { site.answer = answer; const posts = site.posts, overwrites = site.overwrites; await ui.open(); const r = await ui.login({ branch: '012', account: '0012345', password: 'Fictional Only' }); out[name] = { outcome: r.outcome, posts: site.posts - posts, overwrites: site.overwrites - overwrites }; }
    assert.deepEqual(out['in-use'], { outcome: 'session-in-use', posts: 1, overwrites: 0 }, 'inuse:adapter-detects ' + JSON.stringify(out['in-use']));
    for (const name of ['hidden', 'different', 'doubled']) assert.deepEqual(out[name], { outcome: 'rejected', posts: 1, overwrites: 0 }, 'inuse:near-miss-refusal ' + name + ' ' + JSON.stringify(out[name]));
    assert.deepEqual(out['wrong-password'], { outcome: 'rejected', posts: 1, overwrites: 0 }, 'refusal:wrong-password-adapter');
    assert.deepEqual(out.success, { outcome: 'submitted', posts: 1, overwrites: 0 }, 'inuse:success-not-classified');
    assert.equal((await ui.state()).kind, 'unknown', 'inuse:no-authenticated-inference'); assert.equal(site.foreign, 0, 'inuse:no-foreign-request');
  } finally { await browser.close().catch(() => {}); }
  return JSON.stringify(out);
}

// The cleanup continuation runs the real helpers against real, probe-owned
// headless Chrome. No ordinary browser or bank page is opened.
const boundedCleanup = async (promise, ms, label) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]); } finally { clearTimeout(timer); } };
function watchCleanupChild(browser) {
  const child = browser.process(), calls = { killAfterExit: 0, exitListenerAfterExit: 0 }; let ended = child.exitCode !== null || !!child.signalCode;
  const kill = child.kill.bind(child), once = child.once.bind(child);
  child.kill = (...args) => { if (ended) calls.killAfterExit++; return kill(...args); };
  child.once = (event, ...args) => { if (ended && event === 'exit') calls.exitListenerAfterExit++; return once(event, ...args); };
  const exit = new Promise(resolve => once('exit', (code, signal) => { ended = true; resolve({ code, signal }); }));
  const disconnected = browser.connected ? new Promise(resolve => browser.once('disconnected', resolve)) : Promise.resolve();
  return { child, calls, async terminate() { const before = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }, killed = child.kill('SIGKILL'); let result; try { result = await boundedCleanup(exit, 60000, 'cleanup:owned-child-exit'); } catch (error) { throw Error(error.message + ' ' + JSON.stringify({ before, killed, after: { exitCode: child.exitCode, signalCode: child.signalCode }, ended })); } await boundedCleanup(disconnected, 10000, 'cleanup:owned-browser-disconnect'); assert.deepEqual([result.code, result.signal, child.exitCode, child.signalCode], [null, 'SIGKILL', null, 'SIGKILL'], 'cleanup:actual-signalled-child'); } };
}
export async function probeBrowserCleanup(browserFile, temp) {
  const probeUrl = pathToFileURL(browserFile).href + '?cleanup=' + randomUUID();
  const expose = registerHooks({ load(url, context, next) { const r = next(url, context); return url === probeUrl ? { ...r, source: String(r.source) + '\nexport { closeEntry as __fixtureCloseEntry };\n' } : r; } });
  let mod; try { mod = await import(probeUrl); } finally { expose.deregister(); }
  const rootDir = await mkdtemp(path.join(temp, 'close-owned-'));
  let browser, fallbackChild;
  try {
    const profile = mod.ephemeralProfile(rootDir, 'diagnostic', 'bank', 'fictional', randomUUID());
    browser = await mod.browserFor(profile, { ephemeral: true, root: rootDir, headless: true });
    const watched = watchCleanupChild(browser); assert.ok(mod.ownedBrowsers().some(b => b.pid === watched.child.pid && path.resolve(b.profile) === path.resolve(profile)), 'cleanup:owned-only');
    await watched.terminate(); await mod.closeOwnedBrowsers();
    assert.deepEqual(watched.calls, { killAfterExit: 0, exitListenerAfterExit: 0 }, 'cleanup:no-rekill-ended-child');
    assert.equal(existsSync(profile), false, 'cleanup:ended-profile-removed'); assert.equal(mod.ownedBrowsers().length, 0, 'cleanup:ended-registry-cleared');
    // Actual live Chrome control uses its real transport and graceful closure.
    // A disconnected Chrome normally belongs to the broker's Windows job object;
    // faking connected=false without that broker left renderer file handles alive.
    const liveProfile = mod.ephemeralProfile(rootDir, 'diagnostic', 'bank', 'live', randomUUID());
    browser = await mod.browserFor(liveProfile, { ephemeral: true, root: rootDir, headless: true });
    const child = browser.process(), exit = new Promise(resolve => child.once('exit', resolve));
    assert.deepEqual([child.exitCode, child.signalCode], [null, null], 'cleanup:live-control-started');
    await mod.closeOwnedBrowsers(); await boundedCleanup(exit, 10000, 'cleanup:live-owned-child-stopped');
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'cleanup:live-owned-child-stopped');
    assert.equal(existsSync(liveProfile), false, 'cleanup:live-profile-removed'); assert.equal(mod.ownedBrowsers().length, 0, 'cleanup:live-registry-cleared');
    // Exercise the unchanged live-child kill fallback in the actual private helper,
    // exposed by a test-only load hook. This real owned Node child has no renderer
    // descendants and uses a separate, fictional, contained ephemeral profile.
    const fallbackProfile = mod.ephemeralProfile(rootDir, 'diagnostic', 'bank', 'live-fallback', randomUUID());
    await mkdir(fallbackProfile, { recursive: true });
    fallbackChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    const fallbackExit = new Promise(resolve => fallbackChild.once('exit', resolve));
    await new Promise((resolve, reject) => { fallbackChild.once('spawn', resolve); fallbackChild.once('error', reject); });
    assert.deepEqual([fallbackChild.exitCode, fallbackChild.signalCode], [null, null], 'cleanup:live-fallback-started');
    await mod.__fixtureCloseEntry({ browser: { connected: false }, child: fallbackChild, pid: fallbackChild.pid, profile: fallbackProfile, ephemeral: true, root: rootDir });
    await boundedCleanup(fallbackExit, 10000, 'cleanup:live-fallback-stopped');
    assert.ok(fallbackChild.exitCode !== null || fallbackChild.signalCode !== null, 'cleanup:live-fallback-stopped');
    assert.equal(existsSync(fallbackProfile), false, 'cleanup:live-fallback-profile-removed');
    return 'already-ended Chrome: no re-kill or post-exit listener; live owned Chrome closes; real live ChildProcess kill fallback stops; all profiles removed';
  } finally { if (fallbackChild?.exitCode === null && !fallbackChild.signalCode) fallbackChild.kill(); await mod.closeOwnedBrowsers().catch(() => {}); if (browser?.connected) await browser.close().catch(() => {}); }
}
export async function probeProfileLock(browserFile, temp) {
  assert.equal(process.platform, 'win32', 'cleanup:windows-file-lock-required');
  const mod = await fresh(browserFile), rootDir = await mkdtemp(path.join(temp, 'file-lock-'));
  const profile = mod.ephemeralProfile(rootDir, 'diagnostic', 'bank', 'locked', randomUUID()), heldFile = path.join(profile, 'fictional.txt'), script = path.join(rootDir, 'hold-file.ps1');
  await mkdir(profile, { recursive: true }); await writeFile(heldFile, 'fictional');
  await writeFile(script, `param([string]$TaskProfileFile)\n$ErrorActionPreference='Stop'\n$held=[IO.File]::Open($TaskProfileFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)\ntry { Write-Output 'LOCKED'; [Console]::Out.Flush(); Start-Sleep -Milliseconds 7000 } finally { $held.Dispose() }\n`);
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-TaskProfileFile', heldFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = new Promise(resolve => holder.once('exit', code => resolve(code))); let text = '', failure;
  try {
    await boundedCleanup(new Promise((resolve, reject) => { holder.once('error', reject); holder.stdout.on('data', bytes => { text += bytes; if (text.includes('LOCKED')) resolve(); }); }), 20000, 'cleanup:file-lock-not-established');
    try { await mod.removeEphemeral(profile, rootDir); } catch (error) { failure = error; }
    assert.equal(await boundedCleanup(exit, 20000, 'cleanup:file-holder-exit'), 0, 'cleanup:file-holder-exit');
    assert.equal(failure?.code || null, null, 'cleanup:transient-profile-lock');
    assert.equal(existsSync(profile), false, 'cleanup:locked-profile-removed');
    return 'seven-second Windows FileShare.None lock: real removeEphemeral waited for release and removed the profile';
  } finally { if (holder.exitCode === null && !holder.signalCode) holder.kill(); await boundedCleanup(exit, 20000, 'cleanup:holder-final-exit').catch(() => {}); if (existsSync(profile)) await mod.removeEphemeral(profile, rootDir).catch(() => {}); }
}
export async function probeBankCleanup(bankFile, temp) {
  const bank = await fresh(bankFile), browserModule = await import(u('collector/browser.mjs')), rootDir = await mkdtemp(path.join(temp, 'bank-ended-')); let watched;
  const job = { jobId: randomUUID(), kind: 'observe', provider: 'paypay', snapshot: { provider: 'paypay', variant: null, interpretation: 'unmapped', headers: [], mapping: {} } };
  const bound = { bankAccountId: P[0], ownerId: OWNER, origin: ORIGIN, jobId: job.jobId, provider: 'paypay', snapshotHash: sha256(JSON.stringify(job.snapshot)) };
  const adapter = { provider: 'paypay', label: 'Fictional cleanup', support: 'contract-pending', hosts: ['bank.example.invalid'], ui(page, browser) { return { async open() { watched = watchCleanupChild(browser); await watched.terminate(); throw Error('fixture deliberate ended-bank'); } }; } };
  try {
    let stopped; try { await bank.observeBankPortal(bound, job, rootDir, async () => {}, { adapter, batch: 'cleanup' }); } catch (error) { stopped = error; }
    assert.match(String(stopped?.message), /fixture deliberate ended-bank/, 'cleanup:bank-control-reached ' + String(stopped?.message));
    assert.ok(watched, 'cleanup:bank-child-observed'); assert.deepEqual(watched.calls, { killAfterExit: 0, exitListenerAfterExit: 0 }, 'cleanup:bank-no-rekill-ended-child');
    const folder = path.join(rootDir, 'profiles', 'ephemeral'); assert.equal(existsSync(folder) ? (await readdir(folder)).length : 0, 0, 'cleanup:bank-profile-removed');
    return 'real bank wrapper: an already-ended owned child is not killed or awaited again; profile removed';
  } finally { await browserModule.closeOwnedBrowsers().catch(() => {}); }
}

// ── M: named semantic mutants — each must flip its named assertion ──
const SHARED = 'shared/finance-payment-match.mjs', BANK = 'collector/bank.mjs', INDEX = 'collector/index.mjs', PAYPAY = 'collector/banks/paypay.mjs', BROWSER = 'collector/browser.mjs';
export const MUTANTS = [
  { name: 'M1-parts-ignored', file: SHARED, edits: [["const parts=text(values.date)===''&&BANK_DATE_PARTS.some(([k])=>text(values[k])!=='');", 'const parts=false;']], probe: 'shared', expect: 'split:parts-complete' },
  { name: 'M2-day-invented', file: SHARED, edits: [['function dateOfParts(y,m,d){const[a,b,c]=[y,m,d].map(text);', "function dateOfParts(y,m,d){const[a,b,c]=[y,m,text(d)||'1'].map(text);"]], probe: 'shared', expect: 'split:parts-partial-held' },
  { name: 'M3-parts-override-direct', file: SHARED, edits: [["const parts=text(values.date)===''&&BANK_DATE_PARTS", 'const parts=BANK_DATE_PARTS']], probe: 'shared', expect: 'split:direct-date-precedence' },
  { name: 'M4-calendar-unchecked', file: SHARED, edits: [["return dateOf(a+'-'+b+'-'+c);}", "return a+'-'+b.padStart(2,'0')+'-'+c.padStart(2,'0');}"]], probe: 'shared', expect: 'split:parts-invalid-held' },
  { name: 'M5-header-guess-loose', file: SHARED, edits: [["['dateYear','取引日（年）',['操作日(年)']]", "['dateYear','取引日（年）',['操作日(年)','年']]"]], probe: 'shared', expect: 'split:exact-header-guess near-miss' },
  { name: 'M6-sequence-as-bank-id', file: SHARED, edits: [["'取引番号','明細番号'", "'取引番号','取引順番号','明細番号'"]], probe: 'shared', expect: 'split:sequence-not-bank-id' },
  { name: 'C1-in-use-as-refusal', file: PAYPAY, edits: [["return (await ui.sessionInUse()) ? 'session-in-use' : 'rejected';", "return 'rejected';"]], probe: 'adapter', expect: 'inuse:adapter-detects' },
  { name: 'C2-in-use-heading-loose', file: PAYPAY, edits: [['return shown.length === 1 && shown[0].textContent.trim() === heading;', "return shown.some(e => e.textContent.includes('ログイン'));"]], probe: 'adapter', expect: 'inuse:near-miss-refusal' },
  { name: 'C3-in-use-marked-refused', file: BANK, edits: [["if (result?.outcome === 'rejected') { await login.rejected('refused');", "if (result?.outcome === 'rejected' || result?.outcome === 'session-in-use') { await login.rejected('refused');"]], probe: 'guided', expect: 'inuse:not-refused' },
  { name: 'C4-in-use-taken-as-sign-in', file: BANK, edits: [["if (result?.outcome === 'session-in-use') return {", "if (result?.outcome === 'session-in-use') return (await login.accepted(), {"], ['text: GUIDED_TEXT.inUse(label) };', 'text: GUIDED_TEXT.inUse(label) });']], probe: 'guided', expect: 'inuse:stays-uncertain' },
  { name: 'C5-retry-any-pending', file: INDEX, edits: [["if(!['uncertain','refused'].includes(pending)||marker.entry!==entry)", 'if(!pending||marker.entry!==entry)']], probe: 'retry', expect: 'retry:legacy-not-guessed' },
  { name: 'C6-retry-ignores-key', file: INDEX, edits: [['!envelope||!marker||marker.keyId!==envelope.keyId?null:', '!envelope||!marker?null:']], probe: 'retry', expect: 'retry:superseded-refused-refused' },
  { name: 'C7-retry-refused-still-blocked', file: INDEX, edits: [["if(!['uncertain','refused'].includes(pending)", "if(!['uncertain'].includes(pending)"]], probe: 'retry', expect: 'retry:current-refused-allowed' },
  { name: 'C8-retry-entry-unchecked', file: INDEX, edits: [["if(!['uncertain','refused'].includes(pending)||marker.entry!==entry)", "if(!['uncertain','refused'].includes(pending))"]], probe: 'retry', expect: 'retry:misnamed-refused' },
  { name: 'CL1-dead-child-wait-restored', file: BROWSER, edits: [['child && child.exitCode === null && !child.signalCode', 'child && child.exitCode === null']], probe: 'cleanup-browser', expect: 'cleanup:no-rekill-ended-child' },
  { name: 'CL2-short-file-lock-grace-restored', file: BROWSER, edits: [['if (attempt >= 24)', 'if (attempt >= 8)']], probe: 'cleanup-lock', expect: 'cleanup:transient-profile-lock' },
  { name: 'CL3-bank-dead-child-wait-restored', file: BANK, edits: [['child && child.exitCode === null && !child.signalCode', 'child && child.exitCode === null']], probe: 'cleanup-bank', expect: 'cleanup:bank-no-rekill-ended-child' }
];
// Built-chunk mutants of the server's date-source exits: the HTTP integration under OMF_TEST_BANK_MUTANT must fail on the named assertion.
export const SERVER_MUTANTS = [
  { name: 'S1-owner-date-required-unwidened', anchor: /if \(!bankDateSource\(mapping\) \|\| mapping\.description === "" \|\| mapping\.amount === "" && mapping\.outflow === "" && mapping\.inflow === ""\) fail\(400,/g, replacement: 'if (mapping.date === "" || mapping.description === "" || mapping.amount === "" && mapping.outflow === "" && mapping.inflow === "") fail(400,', expect: 'bank:split-preview {' },
  { name: 'S2-capture-date-required-unwidened', anchor: /if \(!bankDateSource\(mapping\) \|\| mapping\.description === "" \|\| mapping\.amount === "" && mapping\.outflow === "" && mapping\.inflow === ""\) return hold\(/g, replacement: 'if (mapping.date === "" || mapping.description === "" || mapping.amount === "" && mapping.outflow === "" && mapping.inflow === "") return hold(', expect: 'bank:split-frozen-capture-imported' }
];

const COVERS = ['shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'server/services/financeBankStatementService.ts', 'components/intake/BankStatementImporter.vue', 'collector/banks/paypay.mjs', 'collector/bank.mjs', 'collector/index.mjs', 'collector/setup.js', 'docs/paypay-bank-connection.md', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/paypay-setup.test.mjs', 'scripts/finance-bank-collection-integration.cjs', 'scripts/finance-paypay-onboarding-integration.cjs', 'scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs', 'scripts/zoomer-fixtures/omf-paypay-login-proof.mjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'scripts/zoomer-fixtures/omf-payment-match.mjs', 'scripts/zoomer-fixtures/omf-paypay-split-dates-retry.mjs'];
COVERS.push(BROWSER);
export default { name: 'omf-paypay-split-dates-retry', covers: COVERS, async run() {
  const lines = [], counts = { legs: 0, green: 0, mutants: 0, caught: 0 }; let pass = true, dbExecuted = false;
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1400)); } };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-split-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  const hooks = registerHooks({ load(url, context, next) { const r = next(url, context); return isLauncher(url, String(r.source)) ? { ...r, source: String(r.source) + FIXTURE_LAUNCH } : r; } });
  try {
    const browserModule = await import(u('collector/browser.mjs'));
    if (browserModule.__fixtureHeadless !== true) throw new Error('test-mode headless control not applied to collector/browser.mjs; every browser leg refused');
    if (process.env.OMF_TEST_BANK_CLEANUP_ONLY === '1') {
      const target = process.env.OMF_TEST_BANK_CLEANUP_TARGET || 'all';
      assert.ok(['all', 'browser', 'lock', 'bank'].includes(target), 'cleanup:known-focused-target');
      if (target === 'all' || target === 'browser') await leg('Q owned ended/live browser cleanup', () => probeBrowserCleanup(path.join(root, BROWSER), temp));
      if (target === 'all' || target === 'lock') await leg('Q Windows transient profile-file lock', () => probeProfileLock(path.join(root, BROWSER), temp));
      if (target === 'all' || target === 'bank') await leg('Q bank wrapper after owned child exit', () => probeBankCleanup(path.join(root, BANK), temp));
      return { pass, databaseCoverage: { executed: false, ownedProcess: false }, message: `cleanup-only: ${counts.green}/${counts.legs} cleanup groups; mapping/login/database groups not run\n` + lines.join('\n') };
    }
    // the server-side HTTP legs run concurrently (each owns its app, MongoDB and temp directories) while the in-process legs run here;
    // the daemon walkthrough (R) runs alone at the end — its tick and owned Chrome are timing-sensitive under load
    const built = existsSync(path.join(root, '.output/server/index.mjs'));
    const httpRun = built ? run(['scripts/finance-integration.cjs'], { OMF_TEST_BANK_COLLECTION_ONLY: '1' }) : null;
    const serverMutantRuns = built ? SERVER_MUTANTS.map(async m => {
      const copy = path.join(root, '.split-mutants', m.name);
      await mkdir(copy, { recursive: true });
      try {
        for (const part of ['scripts', 'shared']) await cp(path.join(root, part), path.join(copy, part), { recursive: true });
        await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
        let hits = 0; for (const f of await chunkFiles(path.join(copy, '.output/server/chunks'))) { const t = await readFile(f, 'utf8'), n = (t.match(m.anchor) || []).length; if (n) { hits += n; await writeFile(f, t.replace(m.anchor, m.replacement)); } }
        if (hits !== 1) return { ...m, hits, caught: false, error: 'anchor hits ' + hits };
        const r = await run([path.join(copy, 'scripts/finance-integration.cjs')], { OMF_TEST_BANK_COLLECTION_ONLY: '1', OMF_TEST_BANK_MUTANT: '1' }, 840000, copy);
        await evidence('server-mutant-' + m.name, r.stdout + '\n' + r.stderr);
        return { ...m, hits, code: r.code, caught: r.code !== 0 && (r.stdout + r.stderr).includes(m.expect) };
      } finally { await removeOwned(copy); }
    }) : [];
    await leg('D shared split-date rules (direct import)', () => probeShared());
    await leg('D declaration parity', declarationParity);
    await leg('C explicit retry on the real collector/index.mjs (in-memory sealed store, no decryption)', () => probeRetry(path.join(root, INDEX), temp));
    await leg('C session-in-use and refusal on the real collector/bank.mjs (page-less guided ui)', () => probeGuided(path.join(root, BANK), temp));
    await leg('A the PayPay adapter on owned headless Chrome (intercepted fake login page; 上書きログイン never requested)', () => probeAdapter(path.join(root, PAYPAY), temp));
    await leg('L permanent no-file-as-proof regression (omf-paypay-login-proof.mjs probe, now with session-in-use)', async () => { const { probeLoginProof } = await import(u('scripts/zoomer-fixtures/omf-paypay-login-proof.mjs')); const observed = []; const r = await probeLoginProof(undefined, observed); assert.ok(observed.some(o => o.label === 'session-in-use-csv' && o.accepted === 0 && o.state === 'blocked'), 'login-proof:session-in-use-case'); return 'source ' + r.sourceHash.slice(0, 12) + ', ' + observed.length + ' cases, none accepted'; });
    await leg('Q owned browser and bank cleanup plus Windows file lock', async () => [await probeBrowserCleanup(path.join(root, BROWSER), temp), await probeProfileLock(path.join(root, BROWSER), temp), await probeBankCleanup(path.join(root, BANK), temp)].join('; '));
    await leg('M collector and shared semantic mutants', async () => {
      const notes = [];
      for (const m of MUTANTS) {
        counts.mutants++; const mm = await mutantModule(m.file, m.edits); let error = null;
        try { if (m.probe === 'shared') await probeShared(mm.file); else if (m.probe === 'retry') await probeRetry(mm.file, temp); else if (m.probe === 'guided') await probeGuided(mm.file, temp); else if (m.probe === 'cleanup-browser') await probeBrowserCleanup(mm.file, temp); else if (m.probe === 'cleanup-lock') await probeProfileLock(mm.file, temp); else if (m.probe === 'cleanup-bank') await probeBankCleanup(mm.file, temp); else await probeAdapter(mm.file, temp); } catch (e) { error = e; } finally { await mm.dispose(); }
        const caught = !!error && String(error.message || error).includes(m.expect) && !/^FAIL /.test(String(error.message)); notes.push({ name: m.name, expect: m.expect, caught, got: String(error?.message || 'no failure').split('\n')[0].slice(0, 160) }); if (caught) counts.caught++;
      }
      await evidence('mutants', JSON.stringify(notes, null, 2));
      const missed = notes.filter(n => !n.caught); if (missed.length) throw new Error(missed.length + ' mutant(s) not caught: ' + JSON.stringify(missed));
      return notes.length + '/' + notes.length + ' caught: ' + notes.map(n => n.name).join(', ');
    });
    await leg('U PayPay collector unit files (node --test, TAP; owned headless Chrome legs)', async () => {
      const r = await run(['--test', '--test-concurrency=1', '--test-reporter=tap', 'collector/test/paypay-standard.test.mjs', 'collector/test/paypay-setup.test.mjs', 'collector/test/paypay-guided-capture.test.mjs', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs'], {}, 840000); await evidence('unit', r.stdout + r.stderr);
      const t = tapReport(r.stdout);
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || t.pass !== t.tests || t.list.some(x => x.directive)) throw new Error(`node --test exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail} skipped ${t.skipped}; failing: ` + t.list.filter(x => !x.ok).map(x => x.name.slice(0, 120)).join(' | ') + ' :: ' + r.stdout.split('\n').filter(l => /AssertionError|paypay[-:]|Error:/.test(l)).slice(0, 8).join(' | '));
      for (const want of [/the observed active-session page: the standard form again under the one visible h1/, /the observed active-session page \(session-in-use, plan omf-paypay-split-dates-retry-20261022\)/, /a bank refusal of the current saved login: the owner's explicit protected retry/, /retryBankLogin: only the current key's uncertain or refused marker/, /an uncertain or refused PayPay account offers/]) assert.ok(t.list.some(x => x.ok && want.test(x.name)), 'unit:named-test-present ' + want.source);
      return `${t.pass}/${t.tests} green, named split/retry tests present`;
    });
    await leg('H HTTP split-date integration on the built app (owned MongoDB; P native preview/import/template/frozen capture/replay; V hidden Chrome importer)', async () => {
      if (!httpRun) throw new Error('NOT RUN: built app absent (.output/server/index.mjs)');
      const r = await httpRun; await evidence('http', r.stdout + r.stderr); const passes = passesOf(r.stdout);
      if (r.code !== 0) throw new Error(`exit ${r.code}; last PASS: ${passes.at(-1)?.slice(5, 100) || 'none'}; ` + (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(-1600));
      for (const want of [/^PASS P PayPay銀行 split dates/, /^PASS V hidden real Chrome: .*split year\/month\/day selects guessed and previewed/, /^PASS N native statement format/, /^PASS G PayPay銀行 標準/, /^PASS U owner upload/]) assert.ok(passes.some(p => want.test(p)), 'http:leg ' + want.source);
      if (!r.stderr.includes('[fixture-headless-control] ' + u('collector/browser.mjs'))) throw new Error('test-mode headless control receipt missing in the HTTP subprocess');
      dbExecuted = true; return passes.length + ' legs; ' + (r.stdout.match(/\d+ targeted bank collection checks passed/)?.[0] || 'missing summary');
    });
    await leg('S server mutants in the built chunks (owner preview and frozen capture date-source exits)', async () => {
      if (!serverMutantRuns.length) throw new Error('NOT RUN: built app absent');
      const notes = await Promise.all(serverMutantRuns); counts.mutants += notes.length; counts.caught += notes.filter(n => n.caught).length;
      await evidence('server-mutants', JSON.stringify(notes.map(({ anchor, ...n }) => n), null, 2));
      const missed = notes.filter(n => !n.caught); if (missed.length) throw new Error('not caught: ' + JSON.stringify(missed.map(({ anchor, ...n }) => n)));
      return notes.length + '/' + notes.length + ' caught: ' + notes.map(n => n.name + '→' + n.expect).join(', ');
    });
    await leg('R the real daemon /bank/retry route on a refused current key (retry-only walkthrough: real HTTP, busy slot 409, incomplete body holds the slot)', async () => {
      if (!built) throw new Error('NOT RUN: built app absent');
      const r = await run(['scripts/finance-paypay-onboarding-integration.cjs'], { OMF_TEST_PAYPAY_RETRY_ONLY: '1' }); await evidence('route', r.stdout + r.stderr); const passes = passesOf(r.stdout), receipt = receiptOf(r.stdout);
      if (r.code !== 0 || !receipt?.pass) throw new Error(`exit ${r.code}; last PASS: ${passes.at(-1)?.slice(5, 120) || 'none'}; ` + r.stderr.replace(/\s+/g, ' ').slice(-1400));
      assert.ok(passes.some(p => /^PASS the actual \/bank\/retry route \(real daemon HTTP, real tick; PayPay 2 holding a bank refusal of its current key\)/.test(p)), 'route:refused-current-key-leg');
      assert.deepEqual([receipt.mode, receipt.route?.whileJob, receipt.route?.claimedWhileInFlight, receipt.route?.afterCompletion, receipt.route?.resumed], ['retry-route', 409, false, 200, 'complete'], 'route:receipt');
      assert.equal(receipt.foreignRequests, 0, 'route:no-foreign-request'); dbExecuted = true;
      return passes.length + ' legs; route ' + JSON.stringify(receipt.route);
    });
  } catch (error) { pass = false; lines.push('fixture: RED ' + String(error?.message || error).slice(0, 600)); }
  finally { hooks.deregister?.(); await removeOwned(temp).catch(() => {}); await removeOwned(path.join(root, '.split-mutants')).catch(() => {}); }
  await writeFile(path.join(root, '.zoomer-split-summary.json'), JSON.stringify({ pass, counts, lines }, null, 2)).catch(() => {});
  return { pass, databaseCoverage: { executed: dbExecuted, ownedProcess: dbExecuted }, message: `${counts.green}/${counts.legs} legs green; mutants ${counts.caught}/${counts.mutants}\n` + lines.join('\n') };
} };

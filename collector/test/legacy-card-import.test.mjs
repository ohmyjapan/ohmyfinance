// collector/test/legacy-card-import.test.mjs — the explicit protected import of the previous card setup (plan omf-card-handover-20261030).
// Synthetic logins only, in owned temporary directories: the previous setup's blob is written with the REAL Vault (this Windows user's
// DPAPI) and made private with the REAL private-acl.ps1 the collector runs at startup; the import reads it back with the module's own
// read-only ACL check and DPAPI decryption. OMF is a fake key service (no network), the target store a fake writer. No live directory,
// credential, Chrome, database or network is touched. OMF_TEST_IMPORT_MODULE / OMF_TEST_AUTHORIZATION_MODULE point at a mutant copy
// beside the original (the fixture's reintroduced defects); unset = the real modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Vault } from '../vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
const load = (env, file) => import(pathToFileURL(process.env[env] ? path.resolve(process.env[env]) : path.join(here, '..', file)).href);
// Absent before this plan: every leg then fails with this named finding (fail-first), not with an unrelated load error.
let imported = null, absent = null;
try { imported = await load('OMF_TEST_IMPORT_MODULE', 'legacy-card-import.mjs'); } catch (error) { absent = error; }
const M = new Proxy({}, { get: (_, name) => { if (!imported) assert.fail('fail-first: collector/legacy-card-import.mjs is absent — no explicit protected previous-card import exists (' + (absent?.code || absent?.message || 'missing') + ')'); return imported[name]; } });
const A = await load('OMF_TEST_AUTHORIZATION_MODULE', 'omf-authorization.mjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const WINDOWS = process.platform === 'win32' ? false : 'Windows DPAPI and ACLs';

// ── synthetic identities ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const OWNER = 'a1'.repeat(12), OTHER = 'b2'.repeat(12), ORIGIN = 'https://omf.example.invalid';
const AMEX = { _id: 'c3'.repeat(12), ownerId: OWNER, provider: 'amex', name: 'Synthetic Amex', primaryCard: '12345', otpMailbox: 'Codes@Example.invalid', active: true };
const AMEX2 = { _id: 'd4'.repeat(12), ownerId: OWNER, provider: 'amex', name: 'Synthetic Amex 2', primaryCard: '23456', otpMailbox: 'other@example.invalid', active: true };
const APLUS = { _id: 'e5'.repeat(12), ownerId: OWNER, provider: 'aplus', name: 'Synthetic Aplus', primaryCard: '1234', active: true };
const APLUS2 = { _id: 'f6'.repeat(12), ownerId: OWNER, provider: 'aplus', name: 'Synthetic Aplus 2', primaryCard: '5678', active: true };
const ACCOUNTS = [AMEX, AMEX2, APLUS];
const PERMITTED = ACCOUNTS.map(a => a._id);
// Distinctive synthetic values so a leak anywhere is detectable by text.
const LOGIN = { username: 'synthetic-user-' + randomBytes(4).toString('hex'), password: 'synthetic-pass-' + randomBytes(6).toString('hex') };
const LOGIN2 = { username: 'synthetic-user2-' + randomBytes(4).toString('hex'), password: 'synthetic-pass2-' + randomBytes(6).toString('hex') };
const APLUS_LOGIN = { username: 'synthetic-aplus-' + randomBytes(4).toString('hex'), password: 'synthetic-apass-' + randomBytes(6).toString('hex') };
const GMAIL = { clientId: 'synthetic-client-' + randomBytes(3).toString('hex'), clientSecret: 'synthetic-secret-' + randomBytes(5).toString('hex'), refreshToken: 'synthetic-refresh-' + randomBytes(8).toString('hex'), mailbox: 'codes@example.invalid' };
const TOKEN = 'omfc_' + randomBytes(32).toString('hex'), OLD_ADDRESS = 'http://100.64.0.9:8080';
const SECRETS = () => [LOGIN.username, LOGIN.password, LOGIN2.username, LOGIN2.password, APLUS_LOGIN.username, APLUS_LOGIN.password, GMAIL.clientSecret, GMAIL.refreshToken, GMAIL.clientId, TOKEN, sha256(TOKEN), OLD_ADDRESS, '100.64.0.9'];
const leaks = value => { const text = JSON.stringify(value); return SECRETS().filter(s => text.includes(s)); };
const blobOf = (extra = {}) => ({ accounts: { [AMEX.primaryCard]: { ...LOGIN, profile: 'Default' }, [AMEX2.primaryCard]: { ...LOGIN2 } }, services: { aplus: { ...APLUS_LOGIN }, yayoi: { username: 'synthetic-yayoi', password: 'synthetic-yayoi-pass' } }, gmail: { ...GMAIL }, ...extra });

// ── a fake OMF key service (keyService.legacyOwner's contract) and a fake store ──────────────────────────────────────────────────────
function fakeRemote({ owner = OWNER, origin = ORIGIN, permitted = PERMITTED, matched = true, proved = PERMITTED, fail = null, proofFail = null } = {}) {
  const calls = [];
  return { calls, async legacyOwner(tokenHash) {
    calls.push(tokenHash === undefined ? { preflight: true } : { tokenHash });
    if (tokenHash === undefined) { if (fail) throw fail; return { ownerId: owner, origin, accountIds: [...permitted] }; }
    if (proofFail) throw proofFail;
    return { ownerId: owner, origin, matched, accountIds: matched ? [...proved] : [] };
  } };
}
function fakeStore(initial = []) {
  const entries = new Map(initial.map(id => [id, { preexisting: true }])), writes = [];
  return { entries, writes, existing: async () => new Set(entries.keys()), write: async item => { writes.push(item.entry); if (entries.has(item.entry)) return 'existing'; entries.set(item.entry, { ...item.value }); return 'imported'; } };
}

// ── owned previous setups: real Vault (DPAPI) + the collector's private-acl.ps1 ─────────────────────────────────────────────────────
const roots = [];
async function owned(label) { const dir = await mkdtemp(path.join(os.tmpdir(), 'omf-legacy-' + label + '-')); roots.push(dir); return dir; }
async function makePrivate(dir) {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(here, '..', 'windows', 'private-acl.ps1'), '-Root', dir], { windowsHide: true, timeout: 60000 });
  assert.equal(JSON.parse(stdout.trim()).verified, true, 'the owned previous directory could not be made private');
}
async function previousSetup(label, blob, { acl = true } = {}) {
  const base = await owned(label), source = M.standardSource({ LOCALAPPDATA: base }), target = path.join(base, 'OhMyFinance', 'collector-public');
  await mkdir(source, { recursive: true }); await mkdir(target, { recursive: true });
  if (blob !== undefined) await new Vault(source).update(() => blob);
  if (acl) await makePrivate(source);
  return { base, source, target };
}
async function snapshot(dir) {
  const files = {};
  const walk = async rel => { for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) { const r = path.join(rel, entry.name); if (entry.isDirectory()) await walk(r); else files[r] = sha256(await readFile(path.join(dir, r))); } };
  await walk('');
  return files;
}
// deps with counted seams around the REAL read-only ACL check, read and DPAPI decryption
function depsFor(setup, { remote = fakeRemote(), store = fakeStore(), accounts = ACCOUNTS, live = () => {}, write = null, now = Date.now } = {}) {
  const counts = { acl: 0, read: 0, unprotect: 0, accounts: 0 };
  return { counts, remote, store, deps: {
    source: setup.source, target: setup.target, remote, origin: ORIGIN, ownerId: OWNER, now,
    accounts: async () => { counts.accounts++; return accounts.map(a => ({ ...a })); }, existing: store.existing, assertLive: live,
    write: write || store.write,
    privateCheck: async (root, file) => { counts.acl++; return M.privateToUser(root, file); },
    readBytes: async file => { counts.read++; return readFile(file); },
    unprotect: async bytes => { counts.unprotect++; return M.dpapiUnprotect(bytes); }
  } };
}
const rejectsWith = async (promise, code) => { try { await promise; } catch (error) { assert.equal(error?.code, code, 'expected ' + code + ', got ' + (error?.code || error?.message)); return error; } assert.fail('expected ' + code + ' but it resolved'); };
test.after(async () => { for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

// ── 1. grant before read ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('grant-first: a refused, expired or foreign grant and an ended session read nothing of the previous setup', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('grant', blobOf({ token: TOKEN, baseUrl: OLD_ADDRESS }));
  const before = await snapshot(setup.source);
  for (const [label, options, code] of [
    ['revoked grant (401)', { remote: fakeRemote({ fail: Object.assign(new Error('Collector access expired or changed.'), { status: 401 }) }) }, 'legacy-access'],
    ['removed PC (403)', { remote: fakeRemote({ fail: Object.assign(new Error('Collector authorization is unavailable'), { status: 403 }) }) }, 'legacy-access'],
    ['another owner', { remote: fakeRemote({ owner: OTHER }) }, 'legacy-owner'],
    ['another origin', { remote: fakeRemote({ origin: 'https://other.example.invalid' }) }, 'legacy-owner'],
    ['session ended', { live: () => { throw Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' }); } }, 'legacy-ended']
  ]) {
    const { deps, counts, remote } = depsFor(setup, options);
    await rejectsWith(M.previewLegacyCards(deps), code);
    assert.deepEqual([counts.acl, counts.read, counts.unprotect, counts.accounts], [0, 0, 0, 0], 'grant-first:' + label + ' touched the previous setup ' + JSON.stringify(counts));
    assert.ok(remote.calls.every(c => c.preflight), 'grant-first:' + label + ' sent a proof before the grant answered');
  }
  assert.deepEqual(await snapshot(setup.source), before, 'grant-first:source-unchanged');
});

// ── 2-5. owner proof and scope ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('same-owner proof: the previous token is hashed here and only its SHA-256 reaches OMF; the old address is never used', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('proof', blobOf({ token: TOKEN, baseUrl: OLD_ADDRESS }));
  const { deps, remote, counts } = depsFor(setup);
  const { preview } = await M.previewLegacyCards(deps);
  assert.deepEqual(remote.calls, [{ preflight: true }, { tokenHash: sha256(TOKEN) }], 'proof:hash-only');
  assert.deepEqual(leaks(remote.calls).filter(s => s !== sha256(TOKEN)), [], 'proof:no-raw-token-or-address-sent');
  assert.equal(preview.owner, 'proved');
  assert.deepEqual(preview.items.map(i => [i.accountId, i.action]), [[AMEX._id, 'import'], [AMEX2._id, 'import'], [APLUS._id, 'import']], 'proof:mapped');
  assert.equal(preview.mailbox, 'import');
  assert.deepEqual([counts.acl, counts.read, counts.unprotect], [1, 1, 1]);
});
test('proof scope: only accounts both proved for the previous collector and permitted now are mapped', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('scope', blobOf({ token: TOKEN }));
  const { deps } = depsFor(setup, { remote: fakeRemote({ proved: [AMEX._id] }) });
  const { preview } = await M.previewLegacyCards(deps);
  assert.deepEqual(preview.items.map(i => [i.accountId, i.action]), [[AMEX._id, 'import']], 'proof-scope:only-proved');
  assert.equal(preview.counts.unmatched, 2, 'proof-scope:the unproved Amex and the Aplus stay manual');
});
test('unproven: a foreign, unknown or revoked token, a malformed token and an address without a token map nothing', { skip: WINDOWS }, async () => {
  for (const [label, blob, remote, proofs] of [
    ['not matched by OMF', blobOf({ token: TOKEN, baseUrl: OLD_ADDRESS }), fakeRemote({ matched: false }), 1],
    ['malformed token', blobOf({ token: 'not-a-token' }), fakeRemote(), 0],
    ['address only', blobOf({ baseUrl: OLD_ADDRESS }), fakeRemote(), 0]
  ]) {
    const setup = await previousSetup('unproven', blob);
    const { deps, store } = depsFor(setup, { remote });
    const { preview, record } = await M.previewLegacyCards(deps);
    assert.equal(preview.owner, 'unproven', 'unproven:' + label);
    assert.equal(preview.counts.import, 0, 'unproven:' + label + ' would import');
    assert.equal(preview.counts.unproven, 4, 'unproven:' + label + ' counts ' + JSON.stringify(preview.counts));
    assert.deepEqual(preview.items, [], 'unproven:' + label + ' named an account');
    assert.equal(remote.calls.filter(c => c.tokenHash).length, proofs, 'unproven:' + label + ' proof calls');
    const { result } = await M.importLegacyCards(deps, record);
    assert.equal(result.counts.imported, 0); assert.deepEqual(store.writes, [], 'unproven:' + label + ' wrote');
  }
});
test('local-only previous setup (no token, no address): protect()’s rule maps against this connection’s permitted cards', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('local', blobOf());
  const { deps, remote } = depsFor(setup, { remote: fakeRemote({ permitted: [AMEX._id, APLUS._id] }) });
  const { preview } = await M.previewLegacyCards(deps);
  assert.equal(preview.owner, 'local'); assert.deepEqual(remote.calls, [{ preflight: true }]);
  assert.deepEqual(preview.items.map(i => [i.accountId, i.action]), [[AMEX._id, 'import'], [APLUS._id, 'import']], 'local:permitted-only');
  assert.equal(preview.counts.unmatched, 1, 'local:the unpermitted Amex stays manual');
});

// ── 6-9. the plan ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('plan: ambiguous Aplus, unmatched and malformed cards, incomplete logins and profile-only entries', () => {
  const blob = { accounts: { '12345': { ...LOGIN }, '99999': { ...LOGIN2 }, 'abcde': { ...LOGIN2 }, '23456': { username: '  ', password: 'x' }, '34567': { profile: 'Default' } }, services: { aplus: { ...APLUS_LOGIN } } };
  const plan = M.planLegacyImport({ blob, basis: 'local', scope: [...PERMITTED, APLUS2._id], accounts: [...ACCOUNTS, APLUS2], ownerId: OWNER });
  // Object key order: integer-like keys ascending (12345, 23456, 34567, 99999), then 'abcde'; 34567 is profile-only (no item).
  assert.deepEqual(plan.items.map(i => [i.kind, i.entry || null, i.action]), [['amex', 'amex-' + AMEX._id, 'import'], ['amex', null, 'unsupported'], ['amex', null, 'unmatched'], ['amex', null, 'unmatched'], ['aplus', null, 'ambiguous']], 'plan:actions');
  const one = M.planLegacyImport({ blob, basis: 'local', scope: PERMITTED, accounts: [...ACCOUNTS, APLUS2], ownerId: OWNER });
  assert.equal(one.items.find(i => i.kind === 'aplus').entry, 'aplus-' + APLUS._id, 'plan:one-aplus');
  const foreignOwner = M.planLegacyImport({ blob, basis: 'local', scope: PERMITTED, accounts: ACCOUNTS.map(a => ({ ...a, ownerId: OTHER })), ownerId: OWNER });
  assert.equal(foreignOwner.counts.import, 0, 'plan:foreign-owner-account');
  const inactive = M.planLegacyImport({ blob, basis: 'local', scope: PERMITTED, accounts: ACCOUNTS.map(a => ({ ...a, active: false })), ownerId: OWNER });
  assert.equal(inactive.counts.import, 0, 'plan:inactive-account');
});
test('existing destination: an entry already saved here is kept and never written; a racing save is reported as kept', () => {
  const plan = M.planLegacyImport({ blob: blobOf(), basis: 'local', scope: PERMITTED, accounts: ACCOUNTS, ownerId: OWNER, existing: new Set(['amex-' + AMEX._id, 'aplus', 'gmail']) });
  const by = Object.fromEntries(plan.items.map(i => [i.entry || i.kind, i]));
  assert.equal(by['amex-' + AMEX._id].action, 'existing', 'existing:amex-kept'); assert.equal(by['amex-' + AMEX._id].value, undefined);
  assert.equal(by['aplus-' + APLUS._id].action, 'existing', 'existing:shared-aplus-kept');
  assert.equal(by.gmail.action, 'existing', 'existing:mailbox-kept');
  assert.equal(by['amex-' + AMEX2._id].action, 'import');
});
test('mailbox: imported only when its mailbox is the login-code mailbox of a matched Amex account', () => {
  const plan = (gmail, scope = PERMITTED, existing = new Set()) => M.planLegacyImport({ blob: { accounts: { '12345': { ...LOGIN } }, gmail }, basis: 'local', scope, accounts: ACCOUNTS, ownerId: OWNER, existing }).items.find(i => i.kind === 'mailbox');
  assert.equal(plan({ ...GMAIL, mailbox: 'CODES@example.invalid ' }).action, 'import', 'mailbox:matched (case and space)');
  assert.deepEqual(plan({ ...GMAIL }).value, { ...GMAIL, mailbox: 'codes@example.invalid' }, 'mailbox:value');
  assert.equal(plan({ ...GMAIL, mailbox: 'other@example.invalid' }).action, 'unmatched', 'mailbox:other-mailbox');
  assert.equal(plan({ ...GMAIL }, [APLUS._id]).action, 'unmatched', 'mailbox:no-matched-amex');
  assert.equal(plan({ ...GMAIL, refreshToken: '' }).action, 'unsupported', 'mailbox:incomplete');
  assert.equal(plan({ ...GMAIL }, PERMITTED, new Set(['gmail'])).action, 'existing', 'mailbox:kept');
});
test('never imported: Yayoi, bank, token, address, pairing, keys, markers and provider metadata', () => {
  const blob = { ...blobOf({ token: TOKEN, baseUrl: OLD_ADDRESS }), accountInfo: [{ _id: AMEX._id, provider: 'aplus', ownerId: OTHER }], services: { aplus: { ...APLUS_LOGIN }, yayoi: { username: 'synthetic-yayoi', password: 'x' }, rakuten: { username: 'synthetic-bank', password: 'x' } }, bank: { rakuten: { username: 'x', password: 'y' } }, mode: 'manual', paused: true, smsSource: { serial: 'X' } };
  const plan = M.planLegacyImport({ blob, basis: 'proved', scope: PERMITTED, accounts: ACCOUNTS, ownerId: OWNER });
  assert.deepEqual(plan.items.filter(i => i.entry).map(i => i.entry).sort(), ['amex-' + AMEX._id, 'amex-' + AMEX2._id, 'aplus-' + APLUS._id, 'gmail'].sort(), 'never:entries');
  assert.deepEqual(plan.notTransferred, ['yayoi']);
  for (const item of plan.items.filter(i => i.value)) assert.deepEqual(Object.keys(item.value).sort(), item.kind === 'mailbox' ? ['clientId', 'clientSecret', 'mailbox', 'refreshToken'] : ['password', 'username'], 'never:value-fields ' + item.entry);
  assert.equal(plan.items.find(i => i.entry === 'amex-' + AMEX._id).account.provider, 'amex', 'never:provider-from-live-account');
});

// ── 10. the previous directory ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('source: same or nested directory, a junction, protected-store markers, a non-private folder and a bad size are refused unread', { skip: WINDOWS }, async () => {
  const blob = blobOf();
  const same = await previousSetup('same', blob);
  for (const [label, target] of [['same', same.source], ['target inside', path.join(same.source, 'collector-public')], ['source inside', path.dirname(same.source)]]) {
    const { deps, counts } = depsFor({ source: same.source, target });
    await rejectsWith(M.previewLegacyCards(deps), 'legacy-same'); assert.deepEqual([counts.read, counts.unprotect], [0, 0], 'source:' + label);
  }
  // a junction to a genuine previous directory: refused by the metadata rule and by the real path
  const real = await previousSetup('junction-real', blob), linkBase = await owned('junction');
  const linked = M.standardSource({ LOCALAPPDATA: linkBase }); await mkdir(path.dirname(linked), { recursive: true }); await symlink(real.source, linked, 'junction');
  const viaLink = depsFor({ source: linked, target: path.join(linkBase, 'OhMyFinance', 'collector-public') });
  await rejectsWith(M.previewLegacyCards(viaLink.deps), 'legacy-unsafe'); assert.deepEqual([viaLink.counts.read, viaLink.counts.unprotect], [0, 0], 'source:junction read');
  assert.equal((await M.inspectSource(linked, path.join(linkBase, 'x'))).code, 'legacy-unsafe');
  // a junction one level up (…\OhMyFinance is a link): the directory itself looks plain, only its real path betrays it
  const parentBase = await owned('parent-junction');
  await symlink(path.dirname(real.source), path.join(parentBase, 'OhMyFinance'), 'junction');
  const viaParent = depsFor({ source: M.standardSource({ LOCALAPPDATA: parentBase }), target: path.join(parentBase, 'collector-public') });
  assert.equal((await M.inspectSource(viaParent.deps.source, viaParent.deps.target)).code, 'legacy-ready', 'the metadata rule alone cannot see a parent link');
  await rejectsWith(M.previewLegacyCards(viaParent.deps), 'legacy-unsafe'); assert.deepEqual([viaParent.counts.read, viaParent.counts.unprotect], [0, 0], 'source:parent junction read');
  for (const [label, prepare] of [
    ['connection.dpapi', dir => writeFile(path.join(dir, 'connection.dpapi'), 'x')],
    ['device key', dir => writeFile(path.join(dir, 'device-key-' + 'a'.repeat(64) + '.dpapi'), 'x')],
    ['sealed entry', async dir => { await mkdir(path.join(dir, 'secrets'), { recursive: true }); await writeFile(path.join(dir, 'secrets', 'amex-x.sealed'), '{}'); }],
    ['active state', dir => writeFile(path.join(dir, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'active', installationId: 'x' }))],
    ['enrolling state', dir => writeFile(path.join(dir, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'enrolling' }))],
    ['v2 state', dir => writeFile(path.join(dir, 'vault-state.json'), JSON.stringify({ v: 2, installationId: 'x' }))],
    ['archive', dir => mkdir(path.join(dir, 'unreadable-1-' + 'a'.repeat(16)))]
  ]) {
    const setup = await previousSetup('protected', blob, { acl: false }); await prepare(setup.source); await makePrivate(setup.source);
    const { deps, counts } = depsFor(setup);
    await rejectsWith(M.previewLegacyCards(deps), 'legacy-protected'); assert.deepEqual([counts.read, counts.unprotect], [0, 0], 'source:' + label);
  }
  const pending = await previousSetup('pending', blob, { acl: false }); await writeFile(path.join(pending.source, 'vault-state.json'), JSON.stringify({ v: 3, phase: 'pending' })); await makePrivate(pending.source);
  assert.equal((await M.previewLegacyCards(depsFor(pending).deps)).preview.counts.import, 4, 'source:a bare pairing marker is still a raw previous setup');
  const open = await previousSetup('not-private', blob, { acl: false });
  const notPrivate = depsFor(open);
  await rejectsWith(M.previewLegacyCards(notPrivate.deps), 'legacy-unsafe'); assert.deepEqual([notPrivate.counts.acl, notPrivate.counts.read], [1, 0], 'source:not-private');
  const empty = await previousSetup('empty', undefined); await writeFile(path.join(empty.source, M.LEGACY_FILE), ''); await makePrivate(empty.source);
  await rejectsWith(M.previewLegacyCards(depsFor(empty).deps), 'legacy-unreadable');
  const none = await owned('none');
  assert.equal((await M.inspectSource(M.standardSource({ LOCALAPPDATA: none }), path.join(none, 'x'))).code, 'legacy-none');
  await rejectsWith(M.previewLegacyCards(depsFor({ source: M.standardSource({ LOCALAPPDATA: none }), target: path.join(none, 'x') }).deps), 'legacy-none');
});
test('status metadata: inspectSource never decrypts (an undecryptable blob still reads as present)', async () => {
  const base = await owned('inspect'), source = M.standardSource({ LOCALAPPDATA: base });
  await mkdir(source, { recursive: true }); await writeFile(path.join(source, M.LEGACY_FILE), 'not dpapi bytes');
  assert.deepEqual(await M.inspectSource(source, path.join(base, 'OhMyFinance', 'collector-public')), { available: true, code: 'legacy-ready' });
});

// ── 11-15. the real round trip, staleness, checked entries, cancellation and failures ───────────────────────────────────────────────
test('real DPAPI round trip on an owned root: exact values imported, the previous directory byte-for-byte unchanged', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('roundtrip', blobOf({ token: TOKEN, baseUrl: OLD_ADDRESS }));
  const before = await snapshot(setup.source);
  const { deps, store, counts } = depsFor(setup);
  const { preview, record } = await M.previewLegacyCards(deps);
  assert.deepEqual(leaks({ preview, record }), [], 'privacy:preview');
  const { result } = await M.importLegacyCards(deps, record);
  assert.deepEqual(result.counts, { imported: 4, existing: 0, notImported: 0 });
  assert.deepEqual(store.entries.get('amex-' + AMEX._id), LOGIN); assert.deepEqual(store.entries.get('amex-' + AMEX2._id), LOGIN2);
  assert.deepEqual(store.entries.get('aplus-' + APLUS._id), APLUS_LOGIN); assert.deepEqual(store.entries.get('gmail'), GMAIL);
  assert.equal(store.entries.has('yayoi'), false, 'never:yayoi');
  assert.deepEqual(leaks(result), [], 'privacy:result');
  assert.deepEqual(await snapshot(setup.source), before, 'roundtrip:source-unchanged');
  assert.deepEqual([counts.read, counts.unprotect], [2, 2], 'roundtrip:the confirm read the setup again');
});
test('stale or changed: a confirm needs this check, within its time, over the same bytes', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('changed', blobOf());
  const { deps, store } = depsFor(setup);
  await rejectsWith(M.importLegacyCards(deps, null), 'legacy-stale');
  const { record } = await M.previewLegacyCards(deps);
  await rejectsWith(M.importLegacyCards({ ...deps, now: () => Date.now() + M.LEGACY_PREVIEW_MS + 1000 }, record), 'legacy-stale');
  await new Vault(setup.source).update(blob => ({ ...blob, accounts: { [AMEX.primaryCard]: { ...LOGIN2 } } }));
  await rejectsWith(M.importLegacyCards(deps, record), 'legacy-changed');
  assert.deepEqual(store.writes, [], 'changed:nothing written');
});
test('checked entries only: an entry that became importable after the check is not imported', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('checked', blobOf());
  const first = depsFor(setup, { store: fakeStore(['amex-' + AMEX2._id]) });
  const { preview, record } = await M.previewLegacyCards(first.deps);
  assert.equal(preview.items.find(i => i.accountId === AMEX2._id).action, 'existing');
  const later = depsFor(setup);
  const { result } = await M.importLegacyCards(later.deps, record);
  assert.equal(later.store.entries.has('amex-' + AMEX2._id), false, 'checked:not-checked entry written');
  assert.deepEqual(result.items.find(i => i.accountId === AMEX2._id), { accountId: AMEX2._id, action: 'not-checked' });
});
test('cancellation: a session ending stops before the next entry; a new check resumes with the rest; a failed seal stops too', { skip: WINDOWS }, async () => {
  const setup = await previousSetup('cancel', blobOf());
  const store = fakeStore(); let calls = 0, ended = false;
  const live = () => { if (ended) throw Object.assign(new Error('The connection has ended. Reconnect this PC.'), { code: 'forbidden' }); };
  const write = async item => { calls++; const outcome = await store.write(item); ended = true; return outcome; };
  const { deps } = depsFor(setup, { store, live, write });
  const { record } = await M.previewLegacyCards(deps);
  let error = null; try { await M.importLegacyCards(deps, record); } catch (failure) { error = failure; }
  assert.equal(calls, 1, 'cancel:successor write after the session ended (' + calls + ' writes)');
  assert.equal(error?.code, 'legacy-ended', 'cancel:the import must end as legacy-ended, got ' + (error?.code || 'a resolved import')); assert.deepEqual(error.counts, { imported: 1, existing: 0, notImported: 0 });
  assert.equal(M.legacyReply(error).status, 403); assert.deepEqual(M.legacyReply(error).body.counts, error.counts);
  ended = false;
  const again = depsFor(setup, { store });
  const second = await M.previewLegacyCards(again.deps);
  assert.equal(second.preview.counts.existing, 1, 'resume:the first entry is kept'); assert.equal(second.preview.counts.import, 3);
  const { result } = await M.importLegacyCards(again.deps, second.record);
  assert.deepEqual(result.counts, { imported: 3, existing: 1, notImported: 0 }, 'resume:completed');
  const failing = depsFor(await previousSetup('fail', blobOf()), { write: async () => { throw new Error('raw failure ' + LOGIN.password); } });
  const check = await M.previewLegacyCards(failing.deps);
  const failure = await rejectsWith(M.importLegacyCards(failing.deps, check.record), 'legacy-write');
  assert.deepEqual(failure.counts, { imported: 0, existing: 0, notImported: 0 }); assert.deepEqual(leaks(M.legacyReply(failure)), [], 'privacy:failure');
});
test('fixed public replies: raw errors are never forwarded', () => {
  const raw = M.legacyReply(new Error('raw ' + LOGIN.password + ' ' + OLD_ADDRESS));
  assert.deepEqual([raw.status, raw.body.code], [409, 'legacy-failed']); assert.deepEqual(leaks(raw), []);
  assert.equal(M.legacyReply(Object.assign(new Error('x'), { status: 401 })).body.code, 'legacy-access');
  assert.equal(M.legacyReply(Object.assign(new Error('x'), { code: 'forbidden' })).body.code, 'legacy-ended');
  for (const [code, [status, message]] of Object.entries(M.LEGACY_OUTCOMES)) { const reply = M.legacyReply(M.legacyError(code)); assert.deepEqual([reply.status, reply.body.error, reply.body.code], [status, message, code]); }
});

// ── the key service method (collector/omf-authorization.mjs) ────────────────────────────────────────────────────────────────────────
test('keyService.legacyOwner: same grant, empty or digest-only body, validated answer, the grant never returned', async () => {
  const sent = [];
  const answer = { ownerId: OWNER, origin: ORIGIN, accountIds: [AMEX._id] };
  const call = async (_config, route, options) => { sent.push({ route, body: options.body, grant: options.grant }); return options.body.legacyTokenHash ? { ...answer, matched: true } : answer; };
  const approval = { installationId: 'a'.repeat(32), generation: 'b'.repeat(64), grant: 'c'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString() };
  const remote = A.keyService({ baseUrl: ORIGIN }, approval, undefined, { call });
  assert.equal(typeof remote.legacyOwner, 'function', 'keyService has no legacyOwner');
  assert.deepEqual(await remote.legacyOwner(), answer);
  assert.deepEqual(await remote.legacyOwner(sha256(TOKEN)), { ...answer, matched: true });
  assert.deepEqual(sent, [{ route: 'legacy-owner', body: {}, grant: 'c'.repeat(64) }, { route: 'legacy-owner', body: { legacyTokenHash: sha256(TOKEN) }, grant: 'c'.repeat(64) }]);
  await assert.rejects(remote.legacyOwner(TOKEN), /Invalid previous setup proof/); assert.equal(sent.length, 2, 'a raw token was sent');
  for (const bad of [{ ...answer, ownerId: 'x' }, { ...answer, accountIds: ['nope'] }, { ...answer, accountIds: 'x' }, { ...answer, origin: 3 }, { ...answer, matched: true }]) {
    const broken = A.keyService({ baseUrl: ORIGIN }, approval, undefined, { call: async () => bad });
    await assert.rejects(broken.legacyOwner(), /invalid previous setup proof/, 'accepted ' + JSON.stringify(bad));
  }
  const unmatchedWithIds = A.keyService({ baseUrl: ORIGIN }, approval, undefined, { call: async () => ({ ...answer, matched: false }) });
  await assert.rejects(unmatchedWithIds.legacyOwner(sha256(TOKEN)), /invalid previous setup proof/);
  const ended = A.keyService({ baseUrl: ORIGIN }, approval, undefined, { call });
  await ended.end(); await assert.rejects(ended.legacyOwner(), /authorized access has ended/);
  assert.equal(JSON.stringify(await remote.legacyOwner()).includes('c'.repeat(64)), false, 'the grant was returned');
});
test('standard source: the previous downloader directory of this Windows user, never a submitted path', () => {
  assert.equal(M.standardSource({ LOCALAPPDATA: 'C:\\Users\\Synthetic\\AppData\\Local' }), path.resolve('C:\\Users\\Synthetic\\AppData\\Local\\OhMyFinance\\collector'));
  assert.equal(M.standardSource({}), path.resolve(path.join(os.homedir(), 'OhMyFinance', 'collector')));
  assert.equal(M.standardSource.length, 0, 'standardSource takes only an optional environment');
  assert.equal(existsSync(path.join(here, '..', 'legacy-card-import.mjs')), true);
});

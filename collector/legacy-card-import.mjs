// collector/legacy-card-import.mjs — the explicit, protected import of the previous card setup's saved logins on the same PC
// (plan omf-card-handover-20261030). The previous downloader of this Windows user kept its card and mailbox logins in its own
// directory's DPAPI blob (credentials.dpapi, the pre-protection Vault format). A connected, protected installation takes them over
// only through this module, on the person's explicit check and confirm inside its protected session:
//   1. the CURRENT OMF grant is confirmed first (keyService.legacyOwner() with no argument: its owner, origin and permitted card ids);
//      no byte of the previous setup is read before that answer, and it must name this connection's owner and origin;
//   2. the previous directory is the standard one of this Windows user (standardSource), never a submitted path and never this
//      directory; it and its blob are plain (no link, junction or other reparse point), private to this user (read-only check) and a
//      raw previous setup — a protected store (connection, journal, key, trust, sealed entry, archive or protection state) is refused;
//   3. the exact bytes read are hashed and decrypted with this user's DPAPI (collector/windows/vault.ps1, unchanged);
//   4. a previous polling token is hashed HERE and proved through the same grant (same owner, same OMF database, not revoked); a
//      previous address without a token cannot be proved; a previous setup with neither keeps protect()'s mapping rule (the permitted
//      card ids of this connection);
//   5. Amex logins map to exactly one permitted live Amex account by its primary card; the one shared Aplus login only when exactly one
//      Aplus account is permitted; the mailbox grant only when its mailbox is the configured login-code mailbox of a matched Amex
//      account. Yayoi, bank, pairing, key, marker and provider fields are never imported, and an entry this PC already holds is kept.
// The previous directory is never written, moved or deleted. Failures are fixed public outcomes: no login, address, token or digest
// reaches a preview, a result, a message or a log. Lines marked `// guard:<name>` are single predicates the fixture removes in turn.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { realpath as realpathCallback } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const realpathNative = promisify(realpathCallback.native);
const VAULT_SCRIPT = fileURLToPath(new URL('./windows/vault.ps1', import.meta.url));
export const LEGACY_FILE = 'credentials.dpapi';
export const LEGACY_MAX_BYTES = 256 * 1024;
export const LEGACY_PREVIEW_MS = 10 * 60000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const OID = /^[a-f\d]{24}$/, TOKEN = /^omfc_[a-f\d]{64}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyOf = value => path.resolve(String(value)).replace(/^\\\\\?\\/, '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const within = (child, parent) => keyOf(child).startsWith(keyOf(parent) + '/');
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** The previous downloader's directory of this Windows user: the default collector directory of collector/index.mjs. */
export function standardSource(env = process.env) { return path.resolve(path.join(env.LOCALAPPDATA || os.homedir(), 'OhMyFinance', 'collector')); }

// One fixed public message per outcome, with the local setup route's status; no exception text is ever forwarded.
export const LEGACY_OUTCOMES = Object.freeze({
  'legacy-none': [404, 'No previous card setup was found on this PC. Enter the card logins below.'],
  'legacy-same': [409, 'The previous setup is this downloader’s own directory, so there is nothing to import. Enter the card logins below.'],
  'legacy-unsafe': [409, 'The previous setup’s folder is a link or is not private to this Windows user, so it was not read. Enter the card logins below.'],
  'legacy-protected': [409, 'The previous setup already uses protected storage and cannot be imported here; it was left unchanged. Enter the card logins below.'],
  'legacy-unreadable': [409, 'The previous setup could not be read by this Windows user; it was left unchanged. Enter the card logins below.'],
  'legacy-access': [403, 'OMF did not confirm this PC’s access, so nothing was imported. Reconnect this PC, then try again.'],
  'legacy-owner': [409, 'This PC’s OMF connection could not be matched to the previous setup; it was left unchanged. Enter the card logins below.'],
  'legacy-changed': [409, 'The previous setup changed after it was checked. Check it again before importing.'],
  'legacy-stale': [409, 'Check the previous logins again before importing.'],
  'legacy-write': [409, 'A login could not be saved for this connection, so the rest were not imported. Check again to continue, or enter the login below.'],
  'legacy-ended': [403, 'The connection ended, so nothing more was read or imported. Reconnect this PC, then check again.'],
  'legacy-failed': [409, 'The previous logins could not be checked. Nothing was imported; enter the card logins below.']
});
export const legacyError = (code, extra = {}) => Object.assign(new Error(LEGACY_OUTCOMES[code] ? LEGACY_OUTCOMES[code][1] : LEGACY_OUTCOMES['legacy-failed'][1]), { code: LEGACY_OUTCOMES[code] ? code : 'legacy-failed', legacy: true, ...extra });
/** The fixed public reply of a failure: a known outcome keeps its code (and import counts); anything else is legacy-failed. */
export function legacyReply(error) {
  const code = error?.legacy && LEGACY_OUTCOMES[error.code] ? error.code : error?.code === 'forbidden' ? 'legacy-ended' : [401, 403].includes(error?.status) ? 'legacy-access' : 'legacy-failed';
  const [status, message] = LEGACY_OUTCOMES[code];
  return { status, body: { error: message, code, ...(error?.legacy && error.counts ? { counts: error.counts } : {}) } };
}
// An OMF refusal of the grant becomes legacy-access; an ended session or an abort stays an ended connection; anything else is fixed.
const remoteFailure = error => error?.legacy ? error : error?.code === 'forbidden' || error?.name === 'AbortError' ? legacyError('legacy-ended') : [401, 403].includes(error?.status) ? legacyError('legacy-access') : legacyError('legacy-failed');

// ── the previous directory ───────────────────────────────────────────────────────────────────────────────────────────────────────
// A raw previous setup holds only the pre-protection blob: no connection, journal, device key or trust file, no sealed entry or
// archive, and no state beyond the bare pairing marker {v:3,phase:'pending'} of an old /pair.
const PROTECTED_NAME = /^(?:connection\.dpapi|connect-journal\.dpapi|device-(?:key|trust)-[a-f0-9]{64}\.dpapi|unreadable-.+|staging-.+)$/;
async function rawSetup(source, names) {
  if (names.some(name => PROTECTED_NAME.test(name))) return false;
  if (names.includes('secrets')) { try { if ((await readdir(path.join(source, 'secrets'))).some(name => name.endsWith('.sealed'))) return false; } catch { return false; } }
  if (names.includes('vault-state.json')) {
    let state;
    try { const file = path.join(source, 'vault-state.json'), stat = await lstat(file); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) return false; state = JSON.parse(await readFile(file, 'utf8')); }
    catch { return false; }
    if (!plainObject(state) || Object.keys(state).sort().join() !== 'phase,v' || state.v !== 3 || state.phase !== 'pending') return false;
  }
  return true;
}
/** File metadata only (nothing decrypted, no helper started, nothing written): whether a raw previous setup is at `source`. */
export async function inspectSource(source, target) {
  if (!source || !target || keyOf(source) === keyOf(target) || within(source, target) || within(target, source)) return { available: false, code: 'legacy-same' }; // guard:legacy-distinct
  let names;
  try { const stat = await lstat(source); if (stat.isSymbolicLink() || !stat.isDirectory()) return { available: false, code: 'legacy-unsafe' }; names = await readdir(source); }
  catch (error) { return { available: false, code: ['ENOENT', 'ENOTDIR'].includes(error?.code) ? 'legacy-none' : 'legacy-unsafe' }; }
  if (!names.includes(LEGACY_FILE)) return { available: false, code: 'legacy-none' };
  if (!await rawSetup(source, names)) return { available: false, code: 'legacy-protected' }; // guard:legacy-raw-only
  let file;
  try { file = await lstat(path.join(source, LEGACY_FILE)); } catch { return { available: false, code: 'legacy-unsafe' }; }
  if (file.isSymbolicLink() || !file.isFile()) return { available: false, code: 'legacy-unsafe' };
  if (!file.size || file.size > LEGACY_MAX_BYTES) return { available: false, code: 'legacy-unreadable' };
  return { available: true, code: 'legacy-ready' };
}
// Read-only ACL facts of the directory and its blob: no link, owner this user or SYSTEM, every entry this user or SYSTEM, this user
// granted. The paths reach PowerShell through its environment, never through the script text; nothing is created or repaired.
const ACL_CHECK = "$ErrorActionPreference='Stop'; $u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $s='S-1-5-18'; $ok=$true; foreach($p in @($env:OMF_LEGACY_ROOT,$env:OMF_LEGACY_FILE)){ try { $i=Get-Item -LiteralPath $p -Force; if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$ok=$false}; $a=Get-Acl -LiteralPath $p; $o=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($o -ne $u -and $o -ne $s){$ok=$false}; $mine=$false; foreach($r in @($a.Access)){ $id=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($id -ne $u -and $id -ne $s){$ok=$false}; if($id -eq $u -and $r.AccessControlType -eq 'Allow'){$mine=$true} }; if(-not $mine){$ok=$false} } catch { $ok=$false } }; [Console]::Out.Write((@{ok=$ok} | ConvertTo-Json -Compress))";
function powershell(stdin, env, timeoutMs = 60000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows is required'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', env ? ['-NoProfile', '-NonInteractive', '-Command', '-'] : ['-NoProfile', '-NonInteractive', '-File', VAULT_SCRIPT, '-Mode', 'unprotect'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(env || {}) } });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, timeoutMs);
    child.stdout.on('data', data => { output += data; if (output.length > 2 * 1024 * 1024) child.kill(); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new Error('unavailable')); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || !output.trim()) reject(new Error('failed')); else resolve(output.trim()); });
    child.stdin.end(stdin);
  });
}
export async function privateToUser(root, file) {
  try { return JSON.parse(await powershell(ACL_CHECK + '\n', { OMF_LEGACY_ROOT: root, OMF_LEGACY_FILE: file })).ok === true; } catch { return false; }
}
/** This user's DPAPI over the exact bytes read (the unchanged vault.ps1 and entropy of collector/vault.mjs). */
export async function dpapiUnprotect(bytes) { return Buffer.from(await powershell(Buffer.from(bytes).toString('base64'), null, 15000), 'base64'); }
async function readBounded(file) {
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > LEGACY_MAX_BYTES) throw legacyError('legacy-unreadable');
  return bytes;
}
// The full check before the read: the metadata rules, the real (link-free) path of the directory, its blob and this directory, and
// the private ACL. Returns the blob's path.
async function verifySource(source, target, { privateCheck = privateToUser } = {}) {
  const state = await inspectSource(source, target);
  if (!state.available) throw legacyError(state.code);
  const file = path.join(source, LEGACY_FILE);
  let real, realFile, realTarget;
  try { [real, realFile] = await Promise.all([realpathNative(source), realpathNative(file)]); } catch { throw legacyError('legacy-unsafe'); }
  try { realTarget = await realpathNative(target); } catch { realTarget = target; }
  if (keyOf(real) !== keyOf(source) || keyOf(realFile) !== keyOf(file)) throw legacyError('legacy-unsafe'); // guard:legacy-plain
  if (keyOf(real) === keyOf(realTarget) || within(real, realTarget) || within(realTarget, real)) throw legacyError('legacy-same');
  if (!await privateCheck(source, file)) throw legacyError('legacy-unsafe'); // guard:legacy-private
  return file;
}

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const loginOf = value => plainObject(value) && typeof value.username === 'string' && typeof value.password === 'string' && value.username.length > 0 && value.username.length <= 256 && !!value.username.trim() && value.password.length > 0 && value.password.length <= 256 ? { username: value.username, password: value.password } : null;
const mailboxOf = value => plainObject(value) && ['clientId', 'clientSecret', 'refreshToken', 'mailbox'].every(k => typeof value[k] === 'string' && value[k].length > 0 && value[k].length <= 512) && EMAIL.test(value.mailbox.trim()) ? { clientId: value.clientId, clientSecret: value.clientSecret, refreshToken: value.refreshToken, mailbox: value.mailbox.trim().toLowerCase() } : null;
const hasLogin = value => plainObject(value) && !!(value.username || value.password);
/**
 * The pure mapping of a decrypted previous setup to this PC's entries. `basis` 'proved' (its token is this owner's: `scope` = the proved
 * ids), 'local' (no previous token or address: protect()'s rule, `scope` = this connection's permitted ids) or 'unproven' (nothing
 * maps). `accounts` is OMF's live card list for this PC, `existing` the entry ids this PC already holds. Items carry `value` only when
 * their action is 'import'; actions: import · existing · unmatched · ambiguous · unsupported · unproven.
 */
export function planLegacyImport({ blob, basis, scope = [], accounts = [], ownerId, existing = new Set() }) {
  const items = [], counts = { import: 0, existing: 0, unmatched: 0, ambiguous: 0, unsupported: 0, unproven: 0 };
  const add = item => { items.push(item); counts[item.action]++; };
  const ids = basis === 'unproven' ? [] : (scope || []).map(String);
  const live = (Array.isArray(accounts) ? accounts : []).filter(a => OID.test(String(a?._id)) && ids.includes(String(a._id)) && String(a.ownerId) === String(ownerId) && a.active !== false && ['amex', 'aplus'].includes(a.provider || 'amex'));
  const bound = account => ({ _id: String(account._id), ownerId: String(ownerId), provider: account.provider || 'amex' });
  for (const [card, value] of Object.entries(plainObject(blob?.accounts) ? blob.accounts : {})) {
    if (!hasLogin(value)) continue; // a profile-only entry is not a login (protect()'s rule)
    const login = loginOf(value);
    if (basis === 'unproven') { add({ kind: 'amex', action: 'unproven' }); continue; }
    if (!login) { add({ kind: 'amex', action: 'unsupported' }); continue; }
    const matches = live.filter(a => (a.provider || 'amex') === 'amex' && /^\d{5}$/.test(card) && a.primaryCard === card);
    if (matches.length !== 1) { add({ kind: 'amex', action: matches.length ? 'ambiguous' : 'unmatched' }); continue; }
    const [account] = matches, entry = 'amex-' + String(account._id), keep = existing.has(entry); // guard:legacy-existing
    add({ kind: 'amex', entry, account: bound(account), name: String(account.name || ''), mailbox: String(account.otpMailbox || '').toLowerCase(), action: keep ? 'existing' : 'import', ...(keep ? {} : { value: login }) });
  }
  const shared = plainObject(blob?.services) ? blob.services.aplus : null;
  if (hasLogin(shared)) {
    const login = loginOf(shared), aplus = live.filter(a => a.provider === 'aplus');
    if (basis === 'unproven') add({ kind: 'aplus', action: 'unproven' });
    else if (!login) add({ kind: 'aplus', action: 'unsupported' });
    else if (aplus.length !== 1) add({ kind: 'aplus', action: aplus.length ? 'ambiguous' : 'unmatched' }); // guard:legacy-one-aplus
    else {
      // The job prefers aplus-<id> to the shared aplus entry (index.mjs credentialEntryFor): either one already here is kept.
      const [account] = aplus, entry = 'aplus-' + String(account._id), keep = existing.has(entry) || existing.has('aplus');
      add({ kind: 'aplus', entry, account: bound(account), name: String(account.name || ''), action: keep ? 'existing' : 'import', ...(keep ? {} : { value: login }) });
    }
  }
  if (blob?.gmail !== undefined && blob?.gmail !== null) {
    const grant = mailboxOf(blob.gmail), matched = items.filter(i => i.kind === 'amex' && ['import', 'existing'].includes(i.action)).map(i => i.mailbox);
    if (basis === 'unproven') add({ kind: 'mailbox', action: 'unproven' });
    else if (!grant) add({ kind: 'mailbox', action: 'unsupported' });
    else if (!matched.includes(grant.mailbox)) add({ kind: 'mailbox', action: 'unmatched' }); // guard:legacy-mailbox
    else add({ kind: 'mailbox', entry: 'gmail', action: existing.has('gmail') ? 'existing' : 'import', ...(existing.has('gmail') ? {} : { value: grant }) });
  }
  const notTransferred = hasLogin(plainObject(blob?.services) ? blob.services.yayoi : null) ? ['yayoi'] : [];
  return { items, counts, notTransferred };
}
/** What the setup page may see: account ids, names, providers and outcomes, never a login, address, token or digest. */
export function publicPlan(plan, basis) {
  return { owner: basis, items: plan.items.filter(i => i.account).map(i => ({ accountId: i.account._id, name: i.name, provider: i.account.provider, action: i.action })), mailbox: plan.items.find(i => i.kind === 'mailbox')?.action || null, counts: { ...plan.counts }, notTransferred: [...plan.notTransferred] };
}

// ── the two actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Steps 1-5 of the header, writing nothing. `deps`: source/target paths; `remote` the live session's key service (legacyOwner);
 * `origin`/`ownerId` this connection's address and single owner; `accounts()` OMF's live card list; `existing()` the entry ids here;
 * `assertLive()` throws once the session ended. Fixture seams: `privateCheck`, `readBytes`, `unprotect`.
 */
async function prepare(deps) {
  const { source, target, remote, origin, ownerId, assertLive } = deps;
  const live = () => { try { assertLive(); } catch (error) { throw remoteFailure(error); } };
  live();
  if (!OID.test(String(ownerId)) || typeof origin !== 'string' || !origin) throw legacyError('legacy-owner');
  let grant;
  try { grant = await remote.legacyOwner(); } catch (error) { throw remoteFailure(error); } // guard:legacy-grant-first
  live();
  if (grant.ownerId !== ownerId || grant.origin !== origin) throw legacyError('legacy-owner'); // guard:legacy-owner-match
  const file = await verifySource(source, target, deps);
  const bytes = await (deps.readBytes || readBounded)(file);
  const sourceHash = sha256(bytes);
  let blob;
  try { const plain = await (deps.unprotect || dpapiUnprotect)(bytes); try { blob = JSON.parse(Buffer.from(plain).toString('utf8')); } finally { if (Buffer.isBuffer(plain)) plain.fill(0); } }
  catch { throw legacyError('legacy-unreadable'); }
  if (!plainObject(blob)) throw legacyError('legacy-unreadable');
  if (blob.protection !== undefined) throw legacyError('legacy-protected'); // a rewritten (protected) blob holds no logins
  live();
  let basis = 'local', scope = grant.accountIds;
  if (blob.token !== undefined && blob.token !== null && blob.token !== '') {
    if (typeof blob.token !== 'string' || !TOKEN.test(blob.token)) { basis = 'unproven'; scope = []; }
    else {
      let proof;
      try { proof = await remote.legacyOwner(sha256(blob.token)); } catch (error) { throw remoteFailure(error); }
      live();
      if (proof.ownerId !== ownerId || proof.origin !== origin) throw legacyError('legacy-owner');
      basis = proof.matched ? 'proved' : 'unproven'; scope = proof.matched ? proof.accountIds : []; // guard:legacy-proof
    }
  } else if (blob.baseUrl !== undefined && blob.baseUrl !== null && blob.baseUrl !== '') { basis = 'unproven'; scope = []; } // guard:legacy-address-unproven
  let accounts, existing;
  try { accounts = await deps.accounts(); live(); existing = await deps.existing(); } catch (error) { throw remoteFailure(error); }
  const plan = planLegacyImport({ blob, basis, scope, accounts, ownerId, existing });
  blob = null;
  return { plan, basis, sourceHash };
}
/** The explicit check: the public plan and the private record a confirm must name (its id, the hash of the bytes read, its entries). */
export async function previewLegacyCards(deps) {
  const { plan, basis, sourceHash } = await prepare(deps);
  const record = { id: randomBytes(16).toString('hex'), sourceHash, entries: plan.items.filter(i => i.action === 'import').map(i => i.entry), at: (deps.now || Date.now)() };
  for (const item of plan.items) delete item.value;
  return { preview: { previewId: record.id, ...publicPlan(plan, basis) }, record };
}
/**
 * The explicit confirm of one check: everything is proved and read again; the bytes must be the ones checked; only the checked
 * entries that are still importable are sealed, one at a time, through `deps.write(item)` (the store's writer lease, the live session
 * asserted, an entry already present kept). The session ending, a refusal or a failed seal stops before the next entry; what was
 * sealed stays and a new check continues with the rest. Returns counts and per-account outcomes.
 */
export async function importLegacyCards(deps, record) {
  if (!record || !/^[a-f\d]{32}$/.test(String(record.id)) || (deps.now || Date.now)() - record.at > LEGACY_PREVIEW_MS) throw legacyError('legacy-stale');
  const { plan, basis, sourceHash } = await prepare(deps);
  if (sourceHash !== record.sourceHash) throw legacyError('legacy-changed'); // guard:legacy-unchanged
  const counts = { imported: 0, existing: 0, notImported: 0 }, outcomes = [];
  for (const item of plan.items) {
    if (item.action === 'existing') { counts.existing++; if (item.account) outcomes.push({ accountId: item.account._id, action: 'existing' }); continue; }
    if (item.action !== 'import' || !record.entries.includes(item.entry)) { counts.notImported++; if (item.account) outcomes.push({ accountId: item.account._id, action: item.action === 'import' ? 'not-checked' : item.action }); continue; } // guard:legacy-checked-only
    let outcome;
    try { deps.assertLive(); outcome = await deps.write(item); } // guard:legacy-live
    catch (error) { throw legacyError(remoteFailure(error).code === 'legacy-ended' ? 'legacy-ended' : 'legacy-write', { counts }); }
    finally { delete item.value; }
    if (outcome === 'existing') counts.existing++; else counts.imported++;
    if (item.account) outcomes.push({ accountId: item.account._id, action: outcome === 'existing' ? 'existing' : 'imported' });
    else outcomes.push({ mailbox: true, action: outcome === 'existing' ? 'existing' : 'imported' });
  }
  for (const item of plan.items) delete item.value;
  return { result: { owner: basis, counts, items: outcomes, notTransferred: [...plan.notTransferred] } };
}

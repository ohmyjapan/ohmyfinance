import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as cryptoConstants, createCipheriv, createDecipheriv, createPublicKey, createPrivateKey, privateDecrypt, generateKeyPairSync, publicEncrypt, randomBytes } from 'node:crypto';
import { existsSync, realpath as realpathCallback } from 'node:fs';
import { access, lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
const script = fileURLToPath(new URL('./windows/vault.ps1', import.meta.url));

function transform(mode, bytes) {
  if (process.platform !== 'win32') throw new Error('The credential vault requires Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-File',script,'-Mode',mode], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential storage timed out')); },15000);
    child.stdout.on('data', data => { output += data; if (output.length > 2 * 1024 * 1024) child.kill(); });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Windows credential storage unavailable')); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || !output.trim()) reject(new Error('Windows credential storage failed')); else resolve(Buffer.from(output.trim(),'base64')); });
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}

export class Vault {
  constructor(directory) { this.directory=directory; this.file=path.join(directory,'credentials.dpapi'); this.queue=Promise.resolve(); }
  async read() { try { return JSON.parse((await transform('unprotect',await readFile(this.file))).toString('utf8')); } catch(error) { if(error.code==='ENOENT') return {accounts:{}}; throw error; } }
  update(updater) {
    const operation=this.queue.then(async()=>{
      const current=await this.read(); const next=await updater(current);
      await mkdir(this.directory,{recursive:true});
      const bytes=await transform('protect',Buffer.from(JSON.stringify(next)));
      const temporary=`${this.file}.new`; await writeFile(temporary,bytes,{mode:0o600}); await rename(temporary,this.file);
      return next;
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}

// ── Sealed entries (plan omf-customer-credential-security-20261009 §2 site 2) ─────────────────────────────────
// Legacy hardware envelope helpers remain for the old format and its recovery fixtures. The customer path uses
// SplitStore below: local AES-GCM ciphertext, wrapped keys held by OMF, and a DPAPI-protected RSA private key.
// No hardware enrollment or Windows Hello is involved in the current flow.
const realpathNative = promisify(realpathCallback.native);
const BROKER_SCRIPT = fileURLToPath(new URL('./windows/key-broker.ps1', import.meta.url));
export const ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const DIALOG_TIMEOUT_MS = 300000;
export const BROKER_TIMEOUT_MS = 60000;
export const keyName = installationId => `OhMyFinance collector ${installationId}`;

/** The AAD of an entry, always in this key order (the fixture and the broker compare the serialized form). */
export function aadOf({ installationId, origin = '', ownerId = '', provider, accountId }) {
  return { v: 1, installationId: String(installationId), origin: String(origin || ''), ownerId: String(ownerId || ''), provider: String(provider), accountId: String(accountId) };
}
const toUrl = b64 => Buffer.from(String(b64), 'base64').toString('base64url');
/** The broker reports the device public key as base64 modulus/exponent; Node needs a KeyObject. */
export function publicKeyFrom(publicKey) {
  if (publicKey && typeof publicKey === 'object' && typeof publicKey.modulus === 'string' && typeof publicKey.exponent === 'string') return createPublicKey({ key: { kty: 'RSA', n: toUrl(publicKey.modulus), e: toUrl(publicKey.exponent) }, format: 'jwk' });
  return publicKey;
}
export function samePublicKey(a, b) { return !!a && !!b && a.modulus === b.modulus && a.exponent === b.exponent; }
export function sealEnvelope(publicKey, aad, secret) {
  const key = randomBytes(32), iv = randomBytes(12), aadBytes = Buffer.from(JSON.stringify(aad), 'utf8');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aadBytes);
    const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(secret), 'utf8')), cipher.final()]);
    const wrapped = publicEncrypt({ key: publicKeyFrom(publicKey), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    return { v: 1, aad, wrapped: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  } finally { key.fill(0); }
}
export function openEnvelope(envelope, dataKey, aad) {
  if (JSON.stringify(envelope.aad) !== JSON.stringify(aad)) throw Object.assign(new Error('This saved login does not belong to this installation, account or OMF connection'), {code:'aad'});
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(envelope.aad), 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  try { return JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
}
function validEnvelope(value) {
  return !!value && typeof value === 'object' && value.v === 1 && value.aad && typeof value.aad === 'object' && ['wrapped', 'iv', 'tag', 'data'].every(k => typeof value[k] === 'string' && value[k].length > 0);
}
/**
 * Opens the initial-connection capsule OMF sealed to this installation's public key (the same envelope format as
 * sealEnvelope): the expected AAD is compared first, the data key is unwrapped by the DPAPI-protected device key and
 * zeroed after use. Nothing is decrypted when the capsule belongs to another request, installation or OMF address.
 */
export function openCapsule(localKey, capsule, aad) {
  if (!validEnvelope(capsule)) throw new Error('OMF returned an invalid connection capsule.');
  if (JSON.stringify(capsule.aad) !== JSON.stringify(aad)) throw Object.assign(new Error('The connection capsule does not belong to this request, installation or OMF address.'), {code:'aad'});
  const key = localKey.unwrap(capsule.wrapped);
  try { return openEnvelope(capsule, key, aad); } finally { key.fill(0); }
}
// Called under the exclusive vault writer lease. A .new file is never committed state: an interrupted write
// can leave it behind. Unlink only that directory entry (never follow it), then create exclusively again.
// Directories/locked files still fail; the previous committed file remains untouched until rename succeeds.
export async function replaceVaultFile(file, bytes) {
  const temporary = `${file}.new`;
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
const LOCK_SCRIPT = fileURLToPath(new URL('./windows/private-acl.ps1', import.meta.url));
async function acquireFileLease(root) {
  const leaseId = randomBytes(16).toString('hex');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', LOCK_SCRIPT, '-Root', root, '-HoldLock', '-OwnerPid', String(process.pid), '-LeaseId', leaseId], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let closed = false;
  const exited = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const fault = text => Object.assign(new Error(text), {code:'locked'});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fault('Windows vault locking did not start; restart the collector before retrying')), 30000);
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once('error', () => finish(fault('Windows vault locking is unavailable')));
      exited.then(() => finish(fault('Another writer holds the vault, or its lock helper ended; retry after that writer finishes')));
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
        let reply; try { reply = JSON.parse(line); } catch { return; }
        if (reply.event === 'ready') finish();
        else finish(fault(reply.event === 'busy' ? 'Another collector process is writing to this vault; retry when it has finished' : 'The Windows vault lock could not be verified'));
      });
    });
  } catch (error) { child.stdin.end('release:' + leaseId + '\n'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000).unref())]); if (!closed) child.kill(); throw error; }
  return {
    pid: child.pid,
    assert() { if (closed) throw fault('The vault lock helper ended; restart the collector before retrying'); },
    async release() {
      if (closed) throw fault('The vault lock helper ended; restart the collector before retrying');
      child.stdin.end('release:' + leaseId + '\n');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
      if (!closed) { child.kill(); throw fault('The vault lock helper did not stop; restart the collector before retrying'); }
      if (child.exitCode !== 0) throw fault('The vault lock helper failed; restart the collector before retrying');
    }
  };
}
const normalizePath = value => path.resolve(value).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').toLowerCase();
async function assertPlain(target, what) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw Object.assign(new Error(`${what} is a link or junction; the collector refuses to use it`), {code:'reparse'});
  const real = await realpathNative(target);
  if (normalizePath(real) !== normalizePath(target)) throw Object.assign(new Error(`${what} resolves elsewhere; the collector refuses to use it`), {code:'reparse'});
  return stat;
}

/** The key broker as a child process: JSON lines over stdin/stdout; {event:'locked'} ends the batch. */
export class KeyBroker {
  constructor(child, { role, test, onEvent }) {
    this.child = child; this.role = role; this.test = test; this.onEvent = onEvent; this.pending = new Map(); this.sequence = 0; this.closed = false; this.readyState = null;
    this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    child.stderr.resume();
    child.once('error', error => { this.readyReject(error); this.fail(error); });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => this.handle(line));
    this.exited.then(() => { this.closed = true; this.fail(new Error('The key broker ended')); this.readyReject(new Error('The key broker ended before it was ready')); try { onEvent({ event: 'closed', broker: this }); } catch { /* observer */ } });
    this.readyPromise.catch(() => {});
  }
  handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.event === 'ready') { this.readyState = message; this.readyResolve(message); return; }
    if (message.event) { try { this.onEvent({ ...message, broker: this }); } catch { /* observer */ } return; }
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    waiting.resolve(message);
  }
  fail(error) { for (const [id, waiting] of this.pending) { this.pending.delete(id); clearTimeout(waiting.timer); waiting.reject(error); } }
  ready(timeoutMs = BROKER_TIMEOUT_MS) {
    return Promise.race([this.readyPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('The key broker did not start in time')), timeoutMs).unref())]);
  }
  /** Resolves with the broker's reply ({ok:true,...} or {ok:false, code, ...}); rejects only when the broker is gone or silent. */
  request(op, fields = {}, timeoutMs = BROKER_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new Error('The key broker ended'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The key broker did not answer in time')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n'); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async end() {
    if (this.closed) return;
    try { if (!this.child.stdin.destroyed) this.child.stdin.end(); } catch { /* ending */ }
    const left = await Promise.race([this.exited, new Promise(resolve => setTimeout(() => resolve(null), 5000).unref())]);
    if (!left && this.child.exitCode === null) { try { this.child.kill(); } catch { /* gone */ } await this.exited; }
  }
}
/**
 * Starts the native key broker (windows/key-broker.ps1), or the script named by OMF_KEY_BROKER (test hook: the fake
 * broker of collector/test; the machine key provider is then never opened). role 'key' opens the device key,
 * role 'owner' only owns browser processes (the manual lane); 'consent' authenticates local recovery without key access.
 */
const TEST_BROKER_SCRIPT = fileURLToPath(new URL('./test/fake-broker.mjs', import.meta.url));
// The customer allowlist omits test/. A runtime environment variable cannot select an arbitrary executable.
export const testBrokerEnabled = (env = process.env) => !!env.OMF_KEY_BROKER && path.resolve(env.OMF_KEY_BROKER) === TEST_BROKER_SCRIPT && existsSync(TEST_BROKER_SCRIPT);
export async function startBroker(role = 'key', { onEvent = () => {}, env = process.env, extraArgs = [] } = {}) {
  if (process.platform !== 'win32') throw new Error('The key broker requires Windows');
  const injected = testBrokerEnabled(env) ? TEST_BROKER_SCRIPT : null;
  const child = injected
    ? spawn(process.execPath, [path.resolve(injected), '--role', role, ...extraArgs], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
    : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', BROKER_SCRIPT, '-Role', role, ...extraArgs], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
  const broker = new KeyBroker(child, { role, test: !!injected, onEvent });
  try { await broker.ready(); } catch (error) { await broker.end().catch(() => {}); throw error; }
  return broker;
}

export class SealedStore {
  constructor(root) { this.root = path.resolve(root); this.dir = path.join(this.root, 'secrets'); this.lockFile = path.join(this.root, 'vault.lock'); this.queue = Promise.resolve(); }
  file(id, dir = this.dir) { if (!ENTRY_ID.test(String(id))) throw new Error('Invalid entry id'); return path.join(dir, `${id}.sealed`); }
  async has(id) { return access(this.file(id)).then(() => true, () => false); }
  async list(dir = this.dir) {
    try { return (await readdir(dir)).filter(name => name.endsWith('.sealed')).map(name => name.slice(0, -'.sealed'.length)).filter(id => ENTRY_ID.test(id)).sort(); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
  }
  /** Containment: the root is its own real path and every vault path under it is a plain file or directory (no reparse point). */
  async assertContained(...extra) {
    let real;
    try { real = await realpathNative(this.root); } catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('The collector directory does not exist'), {code:'reparse'}); throw error; }
    if (normalizePath(real) !== normalizePath(this.root)) throw Object.assign(new Error('The collector directory is reached through a link; use its real path'), {code:'reparse'});
    let names = [];
    try { names = await readdir(this.root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of names) {
      // The lease helper validates vault.lock using its open Windows handle; opening it here would conflict with FileShare.None.
      if (name === 'secrets' || name.startsWith('staging-') || name.startsWith('unreadable-') || extra.includes(name)) {
        const stat = await assertPlain(path.join(this.root, name), name);
        if (stat.isDirectory() && (name === 'secrets' || name.startsWith('staging-') || name.startsWith('unreadable-'))) for (const child of await readdir(path.join(this.root, name))) await assertPlain(path.join(this.root, name, child), `${name}/${child}`);
      }
    }
  }
  /** One writer at a time across processes (vault.lock at the root, outside the replaceable generation) and inside this process. */
  withLock(fn) {
    const operation = this.queue.then(async () => {
      await this.assertContained();
      const lease = await acquireFileLease(this.root);
      this.lease = lease;
      try {
        const result = await fn();
        lease.assert();
        return result;
      } finally {
        this.lease = null;
        await lease.release();
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async write(id, envelope, { dir = this.dir } = {}) {
    this.lease?.assert();
    if (!validEnvelope(envelope)) throw new Error('Invalid sealed entry');
    await this.assertContained();
    await mkdir(dir, { recursive: true });
    await replaceVaultFile(this.file(id, dir), JSON.stringify(envelope));
  }
  async read(id, { dir = this.dir } = {}) {
    const file = this.file(id, dir);
    await assertPlain(file, `secrets/${id}`);
    const envelope = JSON.parse(await readFile(file, 'utf8'));
    if (!validEnvelope(envelope)) throw new Error('The sealed entry is damaged');
    return envelope;
  }
  /** Opens one entry inside a live batch: AAD compared first, then the broker unwraps the data key (the dialog on first use). */
  async open(id, aad, broker, { dir = this.dir } = {}) {
    const envelope = await this.read(id, { dir });
    if (JSON.stringify(envelope.aad) !== JSON.stringify(aad)) throw Object.assign(new Error('This saved login does not belong to this installation, account or OMF connection'), {code:'aad'});
    const reply = await broker.request('unseal', { wrapped: envelope.wrapped }, DIALOG_TIMEOUT_MS);
    if (!reply.ok) throw Object.assign(new Error(reply.code === 'cancelled' ? 'The unlock dialog was cancelled' : 'The device key did not release this entry'), {code:reply.code || 'failed',status:reply.status});
    const dataKey = Buffer.from(String(reply.key), 'base64');
    try { return openEnvelope(envelope, dataKey, aad); } finally { dataKey.fill(0); }
  }
  /**
   * Atomically moves the active generation beside secrets/ (never deletes). A reset journal supplies the
   * same archive name on retry, so an interruption cannot split entries across multiple archives.
   */
  async moveAside(folderName = `unreadable-${Date.now()}-${randomBytes(8).toString('hex')}`) {
    if(!/^unreadable-\d+-[a-f0-9]{16}$/.test(folderName))throw new Error('Invalid recovery archive');
    await this.assertContained();
    const folder = path.join(this.root,folderName);
    try {await rename(this.dir,folder);}catch(error){if(error.code!=='ENOENT')throw error;}
    const ids=await this.list(folder);
    return { folder:ids.length?folder:null, moved:ids };
  }
  async discard(dir) {
    if (normalizePath(path.dirname(dir)) !== normalizePath(this.root) || !path.basename(dir).startsWith('staging-')) throw new Error('Only staging folders are discarded');
    try { await assertPlain(dir, path.basename(dir)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await rm(dir, { recursive: true, force: true });
  }
}

// Version 3: ciphertext stays here; its RSA-wrapped data key lives only in OMF.
// DPAPI automatically protects the local private key, without a Hello/PIN prerequisite.
const GENERATION=/^[a-f0-9]{64}$/;
export function entryBinding(envelope) { return aadOf(envelope.aad); }
function splitEnvelope(value) {
  return value?.v===3 && value.aad?.v===3 && GENERATION.test(value.keyId) && value.aad.keyId===value.keyId && GENERATION.test(value.aad.generation)
    && !Object.hasOwn(value,'wrapped') && ['iv','tag','data'].every(k=>typeof value[k]==='string'&&value[k].length>0)
    && Object.keys(value).sort().join(',')==='aad,data,iv,keyId,tag,v';
}
export class SplitStore extends SealedStore {
  async trustCredential(generation,{create=false}={}) {
    if(!GENERATION.test(generation))throw new Error('Invalid protection generation');
    const name=`device-trust-${generation}.dpapi`,file=path.join(this.root,name);
    await this.assertContained(name);
    try{
      await assertPlain(file,name);const bytes=await transform('unprotect',await readFile(file));
      try {const value=bytes.toString('utf8');if(!GENERATION.test(value))throw new Error('Invalid saved PC authorization');return value;}finally{bytes.fill(0);}
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      if(!create)throw Object.assign(new Error('Connect this PC through OMF to enable automatic syncing.'),{code:'reconnect'});
      if(!this.lease)throw new Error('PC authorization changes require the vault writer lease');this.lease.assert();
      const value=randomBytes(32).toString('hex'),bytes=Buffer.from(value);
      try{await replaceVaultFile(file,await transform('protect',bytes));}finally{bytes.fill(0);}
      return value;
    }
  }
  async connection(value) {
    const name='connection.dpapi',file=path.join(this.root,name);
    await this.assertContained(name);
    if(value!==undefined){
      if(!this.lease)throw new Error('Connection changes require the vault writer lease');this.lease.assert();
      await replaceVaultFile(file,await transform('protect',Buffer.from(JSON.stringify(value))));return value;
    }
    try{await assertPlain(file,name);const bytes=await transform('unprotect',await readFile(file));try{return JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  /**
   * DPAPI-protected journal of an initial connection (request identity, PKCE verifier, callback code, phase), beside the
   * connection and trust files. Read without arguments; write a value, or null to remove it, under the writer lease.
   */
  async enrollmentJournal(value) {
    const name='connect-journal.dpapi',file=path.join(this.root,name);
    await this.assertContained(name);
    if(value!==undefined){
      if(!this.lease)throw new Error('Connection journal changes require the vault writer lease');this.lease.assert();
      if(value===null){await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});return null;}
      await replaceVaultFile(file,await transform('protect',Buffer.from(JSON.stringify(value))));return value;
    }
    try{await assertPlain(file,name);const bytes=await transform('unprotect',await readFile(file));try{return JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async deviceKey(generation,{create=false}={}) {
    if(!GENERATION.test(generation))throw new Error('Invalid protection generation');
    const name=`device-key-${generation}.dpapi`,file=path.join(this.root,name);
    await this.assertContained(name);
    let encrypted;
    try {await assertPlain(file,name);encrypted=await readFile(file);}catch(error){
      if(error.code!=='ENOENT')throw error;
      if(!create)throw Object.assign(new Error('The local protection key is missing. Reset protection and reconnect your logins.'),{code:'missing'});
      if(!this.lease)throw new Error('Key creation requires the vault writer lease');this.lease.assert();
      const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'der'},publicKeyEncoding:{type:'spki',format:'pem'}});
      try {encrypted=await transform('protect',pair.privateKey);await replaceVaultFile(file,encrypted);}finally{pair.privateKey.fill(0);}
    }
    const bytes=await transform('unprotect',encrypted);
    try {
      let key=createPrivateKey({key:bytes,format:'der',type:'pkcs8'});
      const publicKey=createPublicKey(key).export({format:'pem',type:'spki'}).toString();
      return {publicKey,generation,unwrap(wrapped){if(!key)throw new Error('The batch key is locked');return privateDecrypt({key,padding:cryptoConstants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(wrapped,'base64'));},close(){key=null;}};
    }finally{bytes.fill(0);}
  }
  async read(id,{dir=this.dir}={}) {
    const file=this.file(id,dir);await assertPlain(file,`secrets/${id}`);
    const value=JSON.parse(await readFile(file,'utf8'));
    if(!splitEnvelope(value))throw new Error('This login uses an older protection format. Reconnect it through OMF.');
    return value;
  }
  async write() {throw new Error('Split-store writes require a scoped OMF key service');}
  async save(id,baseAad,value,broker,{dir=this.dir}={}) {
    if(!this.lease)throw new Error('Saving a login requires the vault writer lease');this.lease.assert();
    broker.remote.check();
    if(broker.localKey.generation!==broker.generation)throw new Error('The local key generation changed');
    const keyId=randomBytes(32).toString('hex');
    const aad={...baseAad,v:3,generation:broker.generation,keyId};
    const sealed=sealEnvelope(broker.localKey.publicKey,aad,value);
    const {wrapped,...ciphertext}=sealed;
    const envelope={...ciphertext,v:3,keyId};
    await this.assertContained();await mkdir(dir,{recursive:true});
    const file=this.file(id,dir),temporary=file+'.new';
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await writeFile(temporary,JSON.stringify(envelope),{flag:'wx',mode:0o600});
    // A crash leaves only ciphertext in .new. Retrying may leave an orphan OMF key record,
    // but never stores wrapped keys locally or overwrites the prior committed login early.
    await broker.remote.put({keyId,entryId:id,aad,wrapped});
    const back=await broker.remote.get(keyId);
    if(back.wrapped!==wrapped||JSON.stringify(back.aad)!==JSON.stringify(aad))throw new Error('OMF did not verify the saved key');
    const key=broker.localKey.unwrap(back.wrapped);
    try{if(JSON.stringify(openEnvelope(envelope,key,aad))!==JSON.stringify(value))throw new Error('The saved login did not verify');}finally{key.fill(0);}
    broker.remote.check();this.lease.assert();await rename(temporary,file);
    return envelope;
  }
  async open(id,baseAad,broker,{dir=this.dir}={}) {
    const envelope=await this.read(id,{dir});
    if(envelope.aad.generation!==broker.generation||JSON.stringify(entryBinding(envelope))!==JSON.stringify(baseAad))throw Object.assign(new Error('This saved login belongs to another OMF connection or generation'),{code:'aad'});
    broker.remote.check();
    const record=await broker.remote.get(envelope.keyId);
    if(JSON.stringify(record.aad)!==JSON.stringify(envelope.aad))throw new Error('The saved key binding did not match');
    broker.remote.check();const key=broker.localKey.unwrap(record.wrapped);
    try{return openEnvelope(envelope,key,envelope.aad);}finally{key.fill(0);}
  }
}

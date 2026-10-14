// collector/sms-source.mjs — the statement-code SMS source of the OMF downloader (plan omf-auto-sync-build-20261014 §2 A7).
// The owner's already-connected tablet receives the four-digit My APLUS statement code (0570008789, ご利用明細書ダウンロード,
// five minutes; checkpoint.json#liveInspection.downloadStepUp); this module reads that inbox through adb on the PC. Node
// built-ins only, so the staged customer package runs it without an install. It implements the `codeSource` contract of
// collector/aplus-verification.mjs for collector/aplus.mjs:
//   messages({ requestedAt, signal }) → [{ id: '<serial>:<_id>', sender, body, receivedAt }] minus the claimed keys
//   claim(id)                          → the key is persisted BEFORE the code is typed (used-sms-messages.json, .new + rename, last 200)
// Keys are device-bound: an Android `_id` is per device, so a new tablet never collides with an old one's ids. Bodies and
// codes are never written or logged. adb missing, device absent or unauthorized → messages() throws (the person types).
// A cancellation (the session's AbortSignal) reaches the adb subprocess and surfaces as that subprocess's AbortError.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const SERIAL = /^[A-Za-z0-9._:-]{1,64}$/;

/** adb in its two stock Windows locations (Android SDK platform-tools, WinGet Google.PlatformTools) and OMF_ADB_PATH; never a path from metadata. */
export function adbCandidates(env = process.env) {
  const local = env.LOCALAPPDATA || '', candidates = [];
  if (local) {
    candidates.push(path.join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
    const winget = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    let names = [];
    try { names = readdirSync(winget); } catch { names = []; }
    for (const name of names.filter(n => n.startsWith('Google.PlatformTools_')).sort()) candidates.push(path.join(winget, name, 'platform-tools', 'adb.exe'));
  }
  if (env.OMF_ADB_PATH) candidates.push(env.OMF_ADB_PATH);
  return candidates;
}
export function findAdb(env = process.env) { return adbCandidates(env).find(candidate => existsSync(candidate)) || null; }

/** The setup request: { serial } as `adb devices` prints it, or { serial: null } to remove the source; anything else throws (400). */
export function smsSourceInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'serial')) throw new Error('Enter the tablet serial shown by adb devices');
  if (body.serial === null) return { serial: null };
  if (typeof body.serial !== 'string' || !SERIAL.test(body.serial)) throw new Error('Enter the tablet serial shown by adb devices (letters, digits, . _ : -, up to 64)');
  return { serial: body.serial };
}

/** `adb shell content query` rows — `Row: n _id=…, address=…, date=…, body=…`, body last with its commas; a line that is not a row continues the previous body. */
export function parseContentQuery(stdout) {
  const rows = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const row = /^Row: \d+ (.*)$/.exec(line);
    if (!row) { if (rows.length && line !== '') rows[rows.length - 1].body += '\n' + line; continue; }
    const fields = /^_id=(\d+), address=(.*?), date=(\d+), body=(.*)$/.exec(row[1]);
    if (!fields) continue;
    rows.push({ id: fields[1], sender: fields[2], receivedAt: Number(fields[3]), body: fields[4] });
  }
  return rows;
}

export class AdbSmsSource {
  constructor({ serial, directory, adb = findAdb(), execute = run } = {}) {
    if (typeof serial !== 'string' || !SERIAL.test(serial)) throw new Error('A tablet serial is required for the SMS code source');
    if (typeof directory !== 'string' || !directory) throw new Error('The collector directory is required for the SMS code source');
    this.serial = serial; this.adb = adb; this.execute = execute; this.file = path.join(directory, 'used-sms-messages.json');
  }
  async claimed() {
    try {
      const keys = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new Error('Invalid consumed statement-code record');
      return keys;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  /** The inbox rows received at or after `requestedAt` (epoch ms or ISO), keyed `<serial>:<_id>`, minus the claimed keys. */
  async messages({ requestedAt, signal = null } = {}) {
    const since = typeof requestedAt === 'number' ? requestedAt : Date.parse(requestedAt);
    if (!Number.isFinite(since)) throw new Error('A request time is required to read statement codes');
    if (!this.adb) throw new Error('adb was not found on this PC (Android platform-tools)');
    const args = ['-s', this.serial, 'shell', 'content', 'query', '--uri', 'content://sms/inbox', '--projection', '_id:address:date:body', '--where', '"date>=' + Math.floor(since) + '"'];
    const { stdout } = await this.execute(this.adb, args, { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, ...(signal ? { signal } : {}) });
    const used = new Set(await this.claimed());
    return parseContentQuery(stdout).map(message => ({ ...message, id: this.serial + ':' + message.id })).filter(message => !used.has(message.id));
  }
  /** Consumes one message key before its code is typed; a second claim of the same key, or another tablet's key, throws. */
  async claim(id) {
    if (typeof id !== 'string' || !id.startsWith(this.serial + ':')) throw new Error('This statement code message does not belong to the configured tablet');
    const used = await this.claimed();
    if (used.includes(id)) throw new Error('This statement code message was already used');
    await writeFile(this.file + '.new', JSON.stringify([...used, id].slice(-200)), { mode: 0o600 });
    await rename(this.file + '.new', this.file);
  }
}

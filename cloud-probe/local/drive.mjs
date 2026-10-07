// cloud-probe/local/drive.mjs — the Ryzen 7 driver (plan omf-railway-amex-probe-20261007 S4).
//   node cloud-probe/local/drive.mjs stage --into <dir>
//   node cloud-probe/local/drive.mjs run --stage reach|collect --account <primaryCard> --instance <service-instance-id>
//        --key <ssh private key> --known-hosts <pinned known_hosts file> --out <folder> [--collector-dir <dir>]
// stage copies the upload allowlist with a sha256 manifest. run reads the DPAPI vault and the accounts API, opens
// ONE pinned ssh session whose foreground command is the container runner, answers the relay events with the real
// LoginMailbox / LoginClaims (the Windows collector's own used-login-messages.json), keeps the tally, saves
// result.json (0600) with the fixed per-outcome `next` and the scrubbed capture files, and prints one summary line
// `<outcome>: <next>`. Never the password or a code on disk. No second session, no retry. Key path, instance id and
// output folder are flags: the repository is public, so no id or key lives in the tree.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Vault } from '../../collector/vault.mjs';
import { LoginMailbox } from '../../collector/mail.mjs';
import { LoginClaims } from '../../collector/login.mjs';
import { answerFor, newTally, noteStatus, RELAY_REQUESTS, scrub } from '../relay.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SSH_HOST = 'ssh.railway.com';
export const CONTAINER_COMMAND = 'node /app/cloud-probe/run.mjs';
export const RESULT_WAIT_MS = 30000;
// The upload allowlist: Dockerfile and railway.json at the staged root, every module at its repository path.
export const ALLOWLIST = [
  { from: 'cloud-probe/Dockerfile', to: 'Dockerfile' },
  { from: 'cloud-probe/railway.json', to: 'railway.json' },
  { from: 'cloud-probe/run.mjs' }, { from: 'cloud-probe/relay.mjs' }, { from: 'cloud-probe/idle.mjs' },
  { from: 'collector/package.json' }, { from: 'collector/package-lock.json' }, { glob: 'collector/*.mjs' },
  { from: 'shared/amex.mjs' }
];

// Plan §3: the designed follow-up per outcome, written into result.json as `next` and printed with the outcome.
// Nothing automated follows any outcome; NO LANE AFTER UNKNOWN_PAGE (owner S8).
export const NEXT = {
  login_form_shown: 'owner go for --stage collect',
  collected: 'owner compares pageCount/sha256 with outbox/<accountId>/<jobId>/manifest.json',
  attention: 'owner classifies — login page after signIn 1 = Amex returned to login; channels/unknown under /reauth/verify = a challenge the automation does not handle (the G2 bot-vs-OTP reading); code page with finds>0 and found=false = no account-login mail within 150 s; verify failed = mailbox',
  issuer_unavailable: 'owner decides region/egress (U4) in the dashboard; a second reach run only on his go',
  browser_unavailable: "builder fixes image/flags; re-run only on the owner's go",
  unknown_page: "NO LANE AFTER UNKNOWN_PAGE (owner S8): no automatic recovery; the owner reads pageKind, the scrubbed capture and the reach PNG; a bot_rejected reading is his, never the probe's",
  service_failure: {
    malformed_stdin: 'builder fix; re-run only on go',
    session_closed: 'builder fix; re-run only on go',
    claim_failed: 'owner reads; account side = next Windows collector job',
    row_count_mismatch: "owner compares the probe's pageCount with the Windows manifest; re-run only on go"
  }
};
const BUILDER_FIX = 'builder fix; re-run only on go';
export function nextFor(outcome, reasonCode) {
  if (outcome === 'service_failure') return NEXT.service_failure[reasonCode] ?? BUILDER_FIX;
  return NEXT[outcome] ?? BUILDER_FIX;
}

// Exactly probe.cjs's base options (output/ohmyfinance-railway-ssh-setup-20261007), the pinned known-hosts file and
// strict host checking; the container runner is the session's foreground command (traps map: never detached).
export function sshArguments({ key, knownHosts, instance, host = SSH_HOST, command = CONTAINER_COMMAND }) {
  return ['-T', '-F', 'none', '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-o', 'UserKnownHostsFile=' + knownHosts, '-o', 'StrictHostKeyChecking=yes', `${instance}@${host}`, command];
}
export function sshTransport(options) {
  return {
    open() {
      const child = spawn('ssh', sshArguments(options), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const exited = new Promise(resolve => {
        child.once('error', error => resolve({ code: null, signal: null, error: error.message }));
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited };
    }
  };
}

export async function stage({ repoRoot = REPO_ROOT, into }) {
  if (!into) throw new Error('--into <dir> is required');
  let existing = [];
  try { existing = await readdir(into); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing.length) throw new Error('The staging directory must be empty');
  await mkdir(into, { recursive: true });
  const entries = [];
  for (const item of ALLOWLIST) {
    if (item.glob) {
      const dir = path.posix.dirname(item.glob), suffix = path.posix.basename(item.glob).replace('*', '');
      for (const name of (await readdir(path.join(repoRoot, dir))).filter(n => n.endsWith(suffix)).sort()) entries.push({ from: `${dir}/${name}`, to: `${dir}/${name}` });
    } else entries.push({ from: item.from, to: item.to || item.from });
  }
  const files = {};
  for (const { from, to } of entries) {
    const source = path.join(repoRoot, from), target = path.join(into, to);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    files[to] = createHash('sha256').update(await readFile(source)).digest('hex');
  }
  const manifest = { stagedAt: new Date().toISOString(), files };
  await writeFile(path.join(into, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return manifest;
}

export async function runProbe({ stage, account, credentials = null, mailbox = null, claims, transport, out, log = console.log, now = () => new Date() }) {
  if (!['reach', 'collect'].includes(stage)) throw new Error('--stage must be reach or collect');
  if (!account || typeof account.primaryCard !== 'string') throw new Error('An account with a primaryCard is required');
  if (stage === 'collect' && !(credentials && typeof credentials.username === 'string' && credentials.username && typeof credentials.password === 'string' && credentials.password)) throw new Error('No saved Amex login for this account');
  if (!claims) throw new Error('A claims record is required');
  if (!out) throw new Error('--out <folder> is required');
  // Review F4: the record of a live run must never be lost to a folder that already holds one. --out follows the
  // rule stage() applies to --into (lines 78-81) BEFORE the session: absent or empty, created here; nothing is
  // overwritten or removed, and a refusal contacts nothing. The owner picks another folder and reruns on his own go.
  let occupied = [];
  try { occupied = await readdir(out); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (occupied.length) throw new Error('The output directory must be empty');
  await mkdir(out, { recursive: true });
  // The ISO instant with ':' and '.' as '-': collectFromPage uses the jobId as a folder name (browser.mjs:80).
  const jobId = 'probe-' + now().toISOString().replace(/[:.]/g, '-');
  const line = { stage, account: { _id: account._id, jobId, name: account.name, primaryCard: account.primaryCard, cardIdentifiers: account.cardIdentifiers, otpRecipient: account.otpRecipient, otpMailbox: account.otpMailbox } };
  if (stage === 'collect') line.credentials = { username: credentials.username, password: credentials.password };
  const secrets = stage === 'collect' ? [credentials.username, credentials.password] : [];
  const tally = newTally();
  let lastStatus = null, result = null, unreadable = 0;
  const stderrChunks = [];

  const session = transport.open();
  if (session.stdin && typeof session.stdin.on === 'function') session.stdin.on('error', () => {});
  if (session.stderr && typeof session.stderr.on === 'function') session.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));
  const send = message => { try { if (!session.stdin.writableEnded) session.stdin.write(JSON.stringify(message) + '\n'); } catch {} };
  send(line);
  const reader = createInterface({ input: session.stdout, crlfDelay: Infinity, terminal: false });
  for await (const raw of reader) {
    if (!raw.trim()) continue;
    let message;
    try { message = JSON.parse(raw); } catch { unreadable += 1; continue; }
    if (!message || typeof message !== 'object') { unreadable += 1; continue; }
    if (message.event === 'status') { lastStatus = { state: String(message.state ?? ''), text: scrub(String(message.text ?? ''), secrets) }; noteStatus(tally, lastStatus); continue; }
    if (RELAY_REQUESTS.includes(message.event)) { send(await answerFor(message, { mailbox, claims, account, tally, onCode: code => secrets.push(code) })); continue; }
    if (message.event === 'result') { result = message; break; }
  }
  reader.close();
  try { if (!session.stdin.writableEnded) session.stdin.end(); } catch {}
  const exit = await Promise.race([session.exited, new Promise(resolve => { const timer = setTimeout(() => resolve({ code: null, signal: null, timedOut: true }), RESULT_WAIT_MS); if (typeof timer.unref === 'function') timer.unref(); })]);
  const stderrText = scrub(Buffer.concat(stderrChunks).toString('utf8').trim(), secrets);

  const captured = result && typeof result.capture === 'object' ? result.capture : null;
  const record = result
    ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'event' && key !== 'capture'))
    : { stage, outcome: 'service_failure', reasonCode: 'session_closed', reason: stderrText ? stderrText.slice(-500) : 'The ssh session ended without a result line', lastStatus, pageKind: null, url: null, browser: null, egressIp: null };
  if (!('lastStatus' in record) || record.lastStatus == null) record.lastStatus = lastStatus;
  if (!('pageKind' in record)) record.pageKind = null;
  record.at = now().toISOString();
  record.accountId = account._id;
  record.jobId = jobId;
  record.ssh = { code: exit.code ?? null, signal: exit.signal ?? null, ...(exit.timedOut ? { timedOut: true } : {}), ...(exit.error ? { error: scrub(exit.error, secrets) } : {}) };
  if (unreadable) record.unreadableLines = unreadable;
  record.tally = tally;
  record.next = nextFor(record.outcome, record.reasonCode);

  // `out` exists and was empty before the session (the preflight above); every file below is created with 'wx'.
  const files = [];
  if (captured) {
    const dir = path.join(out, 'capture');
    await mkdir(dir, { recursive: true });
    const frames = Array.isArray(captured.frames) ? captured.frames : [];
    for (const [index, frame] of frames.entries()) {
      const base = index === 0 ? 'main' : `frame-${index}`;
      await writeFile(path.join(dir, `${base}.html`), String((frame && frame.html) ?? ''), { mode: 0o600, flag: 'wx' });
      await writeFile(path.join(dir, `${base}.txt`), String((frame && frame.text) ?? ''), { mode: 0o600, flag: 'wx' });
      files.push(`capture/${base}.html`, `capture/${base}.txt`);
    }
    if (typeof captured.screenshot === 'string') { await writeFile(path.join(dir, 'screenshot.png'), Buffer.from(captured.screenshot, 'base64'), { mode: 0o600, flag: 'wx' }); files.push('capture/screenshot.png'); }
  }
  record.capture = { frames: captured && Array.isArray(captured.frames) ? captured.frames.length : 0, screenshot: typeof (captured && captured.screenshot) === 'string', files };
  await writeFile(path.join(out, 'result.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  log(`${record.outcome}: ${record.next}`);
  return { exitCode: 0, record, out };
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[name] = argv[++i]; else out[name] = true;
  }
  return out;
}
// One read-only GET with the collector token (server/api/finance/[...path].ts:15), as collector/index.mjs:31 shapes it.
async function accountsApi(config) {
  const url = new URL('/api/finance/collector/accounts', config.baseUrl);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.statusMessage || 'OMF connection failed');
  return data.accounts;
}
const USAGE = 'usage: drive.mjs stage --into <dir> | drive.mjs run --stage reach|collect --account <primaryCard> --instance <id> --key <path> --known-hosts <path> --out <folder> [--collector-dir <dir>]';

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const f = flags(rest);
  if (command === 'stage') {
    const manifest = await stage({ into: typeof f.into === 'string' ? f.into : '' });
    console.log(`staged ${Object.keys(manifest.files).length} files into ${f.into}`);
    return 0;
  }
  if (command !== 'run') { console.error(USAGE); return 2; }
  for (const name of ['stage', 'account', 'instance', 'key', 'known-hosts', 'out']) if (typeof f[name] !== 'string') throw new Error(`--${name} is required. ${USAGE}`);
  const directory = path.resolve(typeof f['collector-dir'] === 'string' ? f['collector-dir'] : process.env.OMF_COLLECTOR_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'OhMyFinance', 'collector'));
  const config = await new Vault(directory).read();
  if (!config.token || !config.baseUrl) throw new Error('The collector is not paired with OMF');
  const account = ((await accountsApi(config)) || []).find(a => a.primaryCard === f.account);
  if (!account) throw new Error('Unknown account');
  const saved = (config.accounts && config.accounts[account.primaryCard]) || {};
  const mailbox = config.gmail ? new LoginMailbox(config.gmail) : null;
  if (f.stage === 'collect' && !mailbox) throw new Error('No Gmail connection saved in the collector vault');
  const { exitCode } = await runProbe({
    stage: String(f.stage), account, credentials: f.stage === 'collect' ? { username: saved.username, password: saved.password } : null, mailbox,
    claims: new LoginClaims(directory), transport: sshTransport({ key: String(f.key), knownHosts: String(f['known-hosts']), instance: String(f.instance) }), out: String(f.out)
  });
  return exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}

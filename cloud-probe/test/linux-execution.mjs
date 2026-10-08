// cloud-probe/test/linux-execution.mjs — MANUAL Linux acceptance of the driver's container command (plan
// omf-railway-user-fix-20261008). The legs of ./probe.test.mjs drive the runner through an in-process stream pair,
// which can pin the command the driver sends but never the identity Linux gives it; this entry runs the real thing
// on a disposable Linux runtime the operator names, and writes an evidence file that leg R15 assesses against the
// tree it is run in. It does NOTHING unless invoked by hand:
//
//   node cloud-probe/test/linux-execution.mjs --runtime <private transport json> --out <evidence json>
//
// The private json carries the ssh destination only — { instance, key, knownHosts[, host, hostPin] } — and is never
// copied into the evidence; the repository is public, so no instance id, key path or machine path lives here. Every
// session opens through the real exported cloud-probe/local/drive.mjs sshArguments (pinned host key, one foreground
// command), the two runner legs through its real sshTransport with its real default command. On the Linux side this
// same file is the remote half (`--remote <leg>`), copied to /app/cloud-probe/test for the run and removed at the end:
//   transfer      copy this file, hash it and the runner on the host (the runner must be this tree's run.mjs)
//   identity-old  `node <this> --remote identity` as the session's own user: uid 0, stdin echoed, exit 0
//   identity-new  the command's exec/setpriv prefix in front of the same: uid/gid 10001, groups cleared, no new
//                 privileges, no capabilities, HOME/TMPDIR/run root writable, stdin echoed, exit 7 propagated
//   runner-old    the OLD command `node /app/cloud-probe/run.mjs` with one malformed stdin line: the real runner
//                 answers service_failure/malformed_stdin BEFORE Chrome (run.mjs:112-116) and reports browser.uid 0
//   runner-new    the real default command the same way: browser.uid 10001
//   session-end   a held process under the prefix; the ssh client is killed; the process must be gone and its own
//                 marker names what ended it (stdin end or a signal) — the foreground process is node itself
//   chrome        under the prefix: the runner's own chromeOptions(ROOT) through the collector's installed
//                 puppeteer-real-browser connect (Xvfb + Chrome), a loopback synthetic page, every Chrome/Xvfb
//                 process owned by 10001 with no-new-privs, browser.close() leaves none, profile/download/work removed
//   cleanup       this file removed from the host; no browser process left
// No issuer, account, mailbox, claim, vault, database or Railway setting is touched; the only navigation is to
// 127.0.0.1. A missing --runtime, a non-Linux remote or an unreachable host is NOT RUN (exit 3), never a pass.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EVIDENCE_VERSION = 3;
// cloud-probe/Dockerfile:30 — `useradd --uid 10001 --user-group … omf`, the image's USER.
export const CONTAINER_USER = Object.freeze({ uid: 10001, gid: 10001, name: 'omf' });
// The command before plan omf-railway-user-fix-20261008: the runner inherited the ssh session's identity.
export const OLD_CONTAINER_COMMAND = 'node /app/cloud-probe/run.mjs';
export const EXPECTED_SHAPE = Object.freeze({ exec: true, setpriv: '/usr/bin/setpriv', uid: CONTAINER_USER.uid, gid: CONTAINER_USER.gid, clearGroups: true, noNewPrivs: true, program: 'node', script: '/app/cloud-probe/run.mjs', arguments: [], extra: [] });
const ZERO_CAPS = '0000000000000000';
const REMOTE_MODULE = '/app/cloud-probe/test/linux-execution.mjs';
const REMOTE_RUNNER = '/app/cloud-probe/run.mjs';
const REMOTE_COLLECTOR = '/app/collector/package.json';
const NOT_RUN = 3;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const short = value => (typeof value === 'string' ? value.slice(0, 12) : String(value));

// The container command, token by token: the exec/setpriv prefix, the identity it selects and the program it runs.
export function describeContainerCommand(command) {
  const tokens = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  const shape = { exec: false, setpriv: null, uid: null, gid: null, clearGroups: false, noNewPrivs: false, program: null, script: null, arguments: [], extra: [], prefix: [] };
  const nodeAt = tokens.indexOf('node');
  if (nodeAt < 0) { shape.extra = tokens; return shape; }
  shape.prefix = tokens.slice(0, nodeAt);
  shape.program = tokens[nodeAt];
  shape.script = tokens[nodeAt + 1] ?? null;
  shape.arguments = tokens.slice(nodeAt + 2);
  for (const token of shape.prefix) {
    let match;
    if (token === 'exec') shape.exec = true;
    else if (/(^|\/)setpriv$/.test(token)) shape.setpriv = token;
    else if ((match = token.match(/^--reuid=(\d+)$/))) shape.uid = Number(match[1]);
    else if ((match = token.match(/^--regid=(\d+)$/))) shape.gid = Number(match[1]);
    else if (token === '--clear-groups') shape.clearGroups = true;
    else if (token === '--no-new-privs') shape.noNewPrivs = true;
    else shape.extra.push(token);
  }
  return shape;
}
export function commandMismatches(shape) {
  const out = [];
  for (const [key, expected] of Object.entries(EXPECTED_SHAPE)) {
    const actual = shape[key];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) out.push(`${key} ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
  return out;
}

// What leg R15 (and this entry) require of an evidence file for the tree at hand: produced for THIS command string
// and THIS runner, every leg as described above. Returns the failed checks; empty = accepted.
/** @param {any} evidence @param {{containerCommand?: string, runnerSha256?: string, toolSha256?: string}} [expected] */
export function assessEvidence(evidence, { containerCommand, runnerSha256, toolSha256 } = {}) {
  const failures = [];
  const check = (name, condition, detail) => { if (!condition) failures.push(`${name}: ${detail}`); };
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const legs = e.legs && typeof e.legs === 'object' ? e.legs : {};
  const { uid, gid } = CONTAINER_USER;
  check('version', e.version === EVIDENCE_VERSION, `evidence version ${e.version}, expected ${EVIDENCE_VERSION}`);
  if (toolSha256 !== undefined) check('tool', e.toolSha256 === toolSha256, `evidence tool ${short(e.toolSha256)}, this tree ${short(toolSha256)}`);
  if (containerCommand !== undefined) check('command', e.containerCommand === containerCommand, `evidence was produced for ${JSON.stringify(e.containerCommand)}, this tree's command is ${JSON.stringify(containerCommand)}`);
  check('old-command', e.oldCommand === OLD_CONTAINER_COMMAND, `old command ${JSON.stringify(e.oldCommand)}`);
  if (runnerSha256 !== undefined) check('runner', e.runnerSha256?.local === runnerSha256 && e.runnerSha256?.remote === runnerSha256, `runner sha256 local ${short(e.runnerSha256?.local)} / remote ${short(e.runnerSha256?.remote)}, this tree ${short(runnerSha256)}`);
  else check('runner', typeof e.runnerSha256?.remote === 'string' && e.runnerSha256.remote === e.runnerSha256.local, `runner sha256 local ${short(e.runnerSha256?.local)} / remote ${short(e.runnerSha256?.remote)}`);
  const transfer = legs.transfer || {};
  check('transfer', transfer.exitCode === 0 && typeof transfer.moduleSha256?.remote === 'string' && transfer.moduleSha256.remote === transfer.moduleSha256.local && transfer.moduleSha256.local === e.toolSha256, `module sha256 local ${short(transfer.moduleSha256?.local)} / remote ${short(transfer.moduleSha256?.remote)}, exit ${transfer.exitCode}`);
  const old = legs.identityOld || {};
  check('identity-old', old.uid === 0 && old.gid === 0 && old.exitRequested === 0 && old.exitCode === 0 && old.stdin?.echoed === true, `uid ${old.uid} gid ${old.gid} exit ${old.exitCode} (requested ${old.exitRequested}) stdin echoed ${old.stdin?.echoed}`);
  const fresh = legs.identityNew || {};
  check('init', fresh.init?.pid === 1 && fresh.init?.name === 'tini' && fresh.init?.uid === uid && fresh.init?.gid === gid, `PID1 ${JSON.stringify(fresh.init)}`);
  check('identity-new', fresh.uid === uid && fresh.gid === gid && fresh.euid === uid && fresh.egid === gid && fresh.groupsCleared === true && fresh.noNewPrivs === 1 && fresh.capEff === ZERO_CAPS && fresh.capAmb === ZERO_CAPS, `uid ${fresh.uid}/${fresh.euid} gid ${fresh.gid}/${fresh.egid} groups cleared ${fresh.groupsCleared} no-new-privs ${fresh.noNewPrivs} CapEff ${fresh.capEff} CapAmb ${fresh.capAmb}`);
  check('identity-new-writable', fresh.writable?.home === true && fresh.writable?.tmpdir === true && fresh.writable?.root === true, `writable ${JSON.stringify(fresh.writable)}`);
  check('pipe', fresh.stdin?.echoed === true && fresh.stdoutLines === 1, `stdin echoed ${fresh.stdin?.echoed}, stdout lines ${fresh.stdoutLines}`);
  check('exit-status', typeof fresh.exitRequested === 'number' && fresh.exitRequested > 0 && fresh.exitCode === fresh.exitRequested, `exit ${fresh.exitCode} (requested ${fresh.exitRequested})`);
  check('foreground', fresh.noSetprivLeft === true && fresh.parentIsShell === false, `setpriv left ${!fresh.noSetprivLeft}, parent ${JSON.stringify(fresh.parent)}`);
  for (const [name, leg, expectedUid] of [['runner-old', legs.runnerOld || {}, 0], ['runner-new', legs.runnerNew || {}, uid]]) {
    check(name, leg.exitCode === 0 && leg.resultLines === 1 && leg.result?.event === 'result' && leg.result?.outcome === 'service_failure' && leg.result?.reasonCode === 'malformed_stdin' && leg.result?.uid === expectedUid, `exit ${leg.exitCode}, result lines ${leg.resultLines}, ${leg.result?.outcome}/${leg.result?.reasonCode}, uid ${leg.result?.uid} (expected ${expectedUid})`);
  }
  check('runner-new-default', (legs.runnerNew || {}).commandUsed === 'default', `runner-new used ${JSON.stringify((legs.runnerNew || {}).commandUsed)} instead of the transport's default command`);
  const end = legs.sessionEnd || {};
  check('session-end', end.holdUid === uid && Number.isInteger(end.holdPid) && end.holdPid > 1 && end.clientKilled === true && end.clientExit?.timedOut !== true && end.inspectExit === 0 && end.gone === true && end.markerRemoved === true && end.marker?.uid === uid && end.marker?.pid === end.holdPid && end.marker?.cause === end.cause && ['stdin-end', 'stdin-error', 'stdout-error', 'SIGHUP', 'SIGTERM', 'SIGINT'].includes(end.cause), `held uid ${end.holdUid} pid ${end.holdPid}, client killed ${end.clientKilled}, inspect ${end.inspectExit}, gone ${end.gone} after ${end.waitedMs} ms, cause ${end.cause}, marker ${JSON.stringify(end.marker)}`);
  const chrome = legs.chrome || {};
  check('chrome', chrome.exitCode === 0 && chrome.ok === true && chrome.uid === uid && chrome.navigated === true && chrome.counts?.chrome >= 1 && chrome.counts?.xvfb >= 1 && chrome.allOwned === true && chrome.allNoNewPrivs === true && chrome.leftover === 0 && chrome.forceKilled === 0 && chrome.removed === true, `exit ${chrome.exitCode} ok ${chrome.ok} uid ${chrome.uid} navigated ${chrome.navigated} processes ${JSON.stringify(chrome.counts)} owned ${chrome.allOwned} no-new-privs ${chrome.allNoNewPrivs} leftover ${chrome.leftover} force-killed ${chrome.forceKilled} removed ${chrome.removed}${chrome.error ? ' error ' + chrome.error : ''}`);
  const cleanup = legs.cleanup || {};
  check('cleanup', cleanup.exitCode === 0 && cleanup.moduleRemoved === true && cleanup.browserProcesses === 0, `exit ${cleanup.exitCode}, module removed ${cleanup.moduleRemoved}, browser processes left ${cleanup.browserProcesses}`);
  return failures;
}
export function summarizeEvidence(evidence) {
  const e = evidence || {}, legs = e.legs || {};
  const fresh = legs.identityNew || {}, end = legs.sessionEnd || {}, chrome = legs.chrome || {};
  return `${e.at}: old command uid ${legs.identityOld?.uid}/runner uid ${legs.runnerOld?.result?.uid}; new command uid ${fresh.uid} gid ${fresh.gid} groups cleared ${fresh.groupsCleared} no-new-privs ${fresh.noNewPrivs}, runner uid ${legs.runnerNew?.result?.uid}, exit ${fresh.exitCode} propagated, ${fresh.stdin?.bytes} stdin bytes echoed; session end → ${end.cause} in ${end.waitedMs} ms; ${chrome.browser?.version} + Xvfb (${chrome.counts?.chrome}+${chrome.counts?.xvfb} processes, uid ${chrome.uid}) on a loopback page, closed in ${chrome.closeMs} ms, ${chrome.leftover} left, profile removed ${chrome.removed}`;
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

// ── the remote half (Linux) ──────────────────────────────────────────────────────────────────────────────────
function statusFields(file = '/proc/self/status') {
  const text = readFileSync(file, 'utf8');
  const field = key => (text.match(new RegExp(`^${key}:\\t?(.*)$`, 'm')) || [])[1] ?? '';
  return { field, uid: field('Uid').split('\t').map(Number), gid: field('Gid').split('\t').map(Number), groups: field('Groups').trim(), capEff: field('CapEff').trim(), capAmb: field('CapAmb').trim(), capPrm: field('CapPrm').trim(), noNewPrivs: Number(field('NoNewPrivs')), name: field('Name'), ppid: Number(field('PPid')) };
}
function processTable() {
  const out = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const status = statusFields(`/proc/${name}/status`);
      let cmdline = '';
      try { cmdline = readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' '); } catch {}
      out.push({ pid: Number(name), ppid: status.ppid, uid: status.uid[0], gid: status.gid[0], noNewPrivs: status.noNewPrivs, name: status.name, state: status.field('State').trim(), cmdline: cmdline.slice(0, 160) });
    } catch {}
  }
  return out;
}
const browserProcesses = table => table.filter(p => /^(chrome|Xvfb)/.test(p.name) || /google-chrome|\/chrome\b|Xvfb/.test(p.cmdline));
const writable = file => { try { accessSync(file, fsConstants.W_OK); return true; } catch { return false; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// A completed leg must not keep the local test alive until its unused timeout expires.
export async function within(promise, ms, onTimeout) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => { try { resolve(onTimeout()); } catch (error) { reject(error); } }, ms);
    })]);
  } finally { clearTimeout(timer); }
}
function emit(line, code = 0) { process.stdout.write(JSON.stringify(line) + '\n', () => process.exit(code)); }

async function remoteIdentity(f) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks), lines = input.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const status = statusFields();
  const table = processTable();
  const parent = table.find(p => p.pid === status.ppid) || null;
  const exit = Number(f.exit ?? 0);
  emit({
    leg: 'identity', pid: process.pid, ppid: status.ppid, parent: parent ? { pid: parent.pid, name: parent.name, cmdline: parent.cmdline } : null,
    init: table.find(p => p.pid === 1) || null,
    uid: process.getuid(), gid: process.getgid(), euid: process.geteuid(), egid: process.getegid(), groups: process.getgroups(),
    status: { uid: status.uid, gid: status.gid, groups: status.groups, capEff: status.capEff, capAmb: status.capAmb, capPrm: status.capPrm, noNewPrivs: status.noNewPrivs },
    stdin: { bytes: input.length, sha256: sha256(input), lines: lines.length, first: lines[0] ?? null, last: lines.at(-1) ?? null, longest: Math.max(0, ...lines.map(l => l.length)) },
    env: { HOME: process.env.HOME ?? null, TMPDIR: process.env.TMPDIR ?? null, LANG: process.env.LANG ?? null, TZ: process.env.TZ ?? null },
    writable: { home: writable(process.env.HOME || ''), tmpdir: writable(process.env.TMPDIR || ''), root: writable('/run/omf') },
    runnerSha256: existsSync(REMOTE_RUNNER) ? sha256(readFileSync(REMOTE_RUNNER)) : null,
    processes: table.map(p => ({ pid: p.pid, ppid: p.ppid, uid: p.uid, name: p.name })),
    exitRequested: exit
  }, exit);
}
function remoteHold(f) {
  const marker = String(f.marker || '');
  const started = Date.now();
  let ended = false;
  const done = cause => {
    if (ended) return; ended = true;
    try { writeFileSync(marker, JSON.stringify({ cause, uid: process.getuid(), pid: process.pid, afterMs: Date.now() - started }) + '\n', { flag: 'wx' }); } catch {}
    process.exit(0);
  };
  for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, () => done(signal));
  process.stdin.on('end', () => done('stdin-end'));
  process.stdin.on('error', () => done('stdin-error'));
  process.stdin.resume();
  process.stdout.on('error', () => done('stdout-error'));
  setTimeout(() => done('timeout'), 60000);
  process.stdout.write(JSON.stringify({ leg: 'hold', pid: process.pid, uid: process.getuid(), gid: process.getgid(), marker }) + '\n');
}
async function remoteInspect(f) {
  const pid = Number(f.pid), marker = String(f.marker || '');
  const started = Date.now();
  let gone = !existsSync(`/proc/${pid}`);
  while (!gone && Date.now() - started < 20000) { await wait(250); gone = !existsSync(`/proc/${pid}`); }
  let record = null, markerRemoved = false;
  if (existsSync(marker)) {
    try { record = JSON.parse(readFileSync(marker, 'utf8')); } catch (error) { record = { unreadable: String(error && error.message) }; }
    try { await rm(marker); markerRemoved = true; } catch {}
  }
  emit({ leg: 'inspect', pid, gone, waitedMs: Date.now() - started, marker: record, markerRemoved, uid: process.getuid() });
}
async function remoteChrome() {
  const report = { leg: 'chrome', uid: process.getuid(), gid: process.getgid(), noNewPrivs: statusFields().noNewPrivs, root: null, options: null, server: null, navigated: false, title: null, text: null, browser: null, running: [], counts: { chrome: 0, xvfb: 0 }, allOwned: false, allNoNewPrivs: false, closeMs: null, leftover: 0, leftoverProcesses: [], forceKilled: 0, removed: false, left: [], locks: { before: [], during: [], after: [] }, logs: null, error: null, ok: false };
  const lockFiles = () => { try { return readdirSync('/tmp').filter(n => /^\.X\d+-lock$/.test(n)); } catch { return []; } };
  const tail = file => { try { return readFileSync(file, 'utf8').slice(-1500); } catch { return null; } };
  const nonce = randomUUID().slice(0, 8), title = `omf-linux-execution ${nonce}`;
  let browser = null, server = null, root = null;
  report.preExisting = browserProcesses(processTable());
  try {
    const runner = await import(pathToFileURL(REMOTE_RUNNER).href);
    root = runner.ROOT;
    if (root !== '/run/omf') throw new Error(`unexpected runtime root ${root}`);
    report.root = root;
    const options = runner.chromeOptions(root);
    report.options = { headless: options.headless, turnstile: options.turnstile, args: options.args, userDataDir: options.customConfig?.userDataDir, chromePath: options.customConfig?.chromePath, connectOption: options.connectOption };
    const { connect } = createRequire(REMOTE_COLLECTOR)('puppeteer-real-browser');
    const requests = [];
    server = http.createServer((request, response) => { requests.push({ url: request.url, userAgent: request.headers['user-agent'] || null }); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1 id="probe">synthetic loopback page ${nonce}</h1></body></html>`); });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(undefined)).once('error', reject));
    const port = /** @type {any} */ (server.address()).port;
    report.server = { address: '127.0.0.1', port, requests };
    report.locks.before = lockFiles();
    // run.mjs:123-125 — the two directories, then connect with the runner's options.
    await mkdir(path.join(root, 'work'), { recursive: true });
    await mkdir(path.join(root, 'profile'), { recursive: true });
    const connected = await within(connect(options), 90000, () => { throw new Error('connect() did not return within 90 s'); });
    browser = connected.browser;
    const page = connected.page;
    report.browser = { version: await browser.version(), userAgent: await browser.userAgent(), pid: null };
    await page.goto(`http://127.0.0.1:${port}/synthetic`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    report.title = await page.title();
    report.text = await page.evaluate(() => document.body.innerText);
    report.browser.webdriver = await page.evaluate(() => navigator.webdriver);
    report.navigated = report.title === title && requests.some(r => r.url === '/synthetic');
    report.locks.during = lockFiles();
    const running = browserProcesses(processTable());
    report.running = running.map(p => ({ pid: p.pid, ppid: p.ppid, uid: p.uid, gid: p.gid, noNewPrivs: p.noNewPrivs, name: p.name, state: p.state }));
    report.counts = { chrome: running.filter(p => /chrome/.test(p.name) || /chrome/.test(p.cmdline)).length, xvfb: running.filter(p => /Xvfb/.test(p.name) || /Xvfb/.test(p.cmdline)).length };
    report.allOwned = running.length > 0 && running.every(p => p.uid === process.getuid() && p.gid === process.getgid());
    report.allNoNewPrivs = running.length > 0 && running.every(p => p.noNewPrivs === 1);
    const closing = Date.now();
    await within(browser.close(), 15000, () => undefined);
    browser = null;
    let leftover = browserProcesses(processTable());
    while (leftover.length && Date.now() - closing < 20000) { await wait(250); leftover = browserProcesses(processTable()); }
    report.closeMs = Date.now() - closing;
    report.leftover = leftover.length;
    report.leftoverProcesses = leftover.map(p => ({ pid: p.pid, ppid: p.ppid, uid: p.uid, name: p.name, state: p.state }));
    report.zombieLeftover = leftover.filter(p => p.state.startsWith('Z')).length;
    report.liveLeftover = leftover.length - report.zombieLeftover;
    report.preCleanup = { at: new Date().toISOString(), processes: browserProcesses(processTable()) };
    report.ok = report.navigated && report.allOwned && report.allNoNewPrivs && report.leftover === 0;
  } catch (error) {
    report.error = String((error && error.stack) || error).slice(0, 1500);
    if (root) report.logs = { out: tail(path.join(root, 'profile', 'chrome-out.log')), err: tail(path.join(root, 'profile', 'chrome-err.log')) };
  } finally {
    try { if (browser) await within(browser.close(), 10000, () => undefined); } catch {}
    // Test hygiene only: a browser process this leg started and could not close is killed so the host is left clean.
    for (const p of browserProcesses(processTable())) { if (p.uid === process.getuid() && !p.state.startsWith('Z')) { try { process.kill(p.pid, 'SIGKILL'); report.forceKilled += 1; } catch {} } }
    if (root === '/run/omf') {
      // run.mjs:176 — the runner's own cleanup of the three fixed names under the runtime root.
      for (const name of ['profile', 'download', 'work']) await rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
      report.left = ['profile', 'download', 'work'].filter(name => existsSync(path.join(root, name)));
      report.removed = report.left.length === 0;
    }
    report.locks.after = lockFiles();
    if (server) await new Promise(resolve => server.close(() => resolve(undefined)));
    report.ok = report.ok && report.removed && report.forceKilled === 0;
    emit(report, report.ok ? 0 : 1);
  }
}
async function remoteMain(f) {
  if (process.platform !== 'linux') { console.error(`NOT RUN: the remote half runs on Linux only (this is ${process.platform})`); return NOT_RUN; }
  const leg = String(f.remote);
  if (leg === 'identity') await remoteIdentity(f);
  else if (leg === 'hold') remoteHold(f);
  else if (leg === 'inspect') await remoteInspect(f);
  else if (leg === 'chrome') await remoteChrome();
  else { console.error(`NOT RUN: unknown remote leg ${leg}`); return NOT_RUN; }
  return 0;
}

// ── the driver half ───────────────────────────────────────────────────────────────────────────────────────────
const USAGE = 'usage: node cloud-probe/test/linux-execution.mjs --runtime <private transport json> --out <evidence json>';
const lastJson = lines => { for (let i = lines.length - 1; i >= 0; i--) { try { const value = JSON.parse(lines[i]); if (value && typeof value === 'object') return value; } catch {} } return null; };

// Closing readline emits `close` synchronously. Settle the captured event first so EOF cannot replace it with null.
export function readHoldEvent(input, timeoutMs = 45000) {
  return new Promise(resolve => {
    const reader = createInterface({ input, crlfDelay: Infinity, terminal: false });
    const finish = value => { clearTimeout(timer); resolve(value); reader.close(); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    reader.on('line', line => { try { const value = JSON.parse(line); if (value && value.leg === 'hold') finish(value); } catch {} });
    reader.on('close', () => { clearTimeout(timer); resolve(null); });
  });
}

async function driverMain(f) {
  if (typeof f.runtime !== 'string' || typeof f.out !== 'string') { console.error(`NOT RUN: a Linux runtime was not named. ${USAGE}`); return NOT_RUN; }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const runtime = JSON.parse(await readFile(f.runtime, 'utf8'));
  for (const name of ['instance', 'key', 'knownHosts']) if (typeof runtime[name] !== 'string' || !runtime[name]) throw new Error(`The runtime json must name ${name}`);
  const drive = await import(pathToFileURL(path.join(here, '..', 'local', 'drive.mjs')).href);
  const host = typeof runtime.host === 'string' ? runtime.host : drive.SSH_HOST;
  if (host !== drive.SSH_HOST) throw new Error('The runtime host differs from the driver constant');
  if (typeof runtime.hostPin === 'string' && sha256(await readFile(runtime.knownHosts)) !== runtime.hostPin) throw new Error('The known_hosts file does not match the runtime hostPin');
  const command = drive.CONTAINER_COMMAND;
  const shape = describeContainerCommand(command);
  const mismatches = commandMismatches(shape);
  const selfBytes = await readFile(fileURLToPath(import.meta.url));
  const evidence = { version: EVIDENCE_VERSION, at: new Date().toISOString(), tool: 'cloud-probe/test/linux-execution.mjs', toolSha256: sha256(selfBytes), containerCommand: command, oldCommand: OLD_CONTAINER_COMMAND, commandShape: { ...shape, prefix: shape.prefix.join(' ') }, commandMismatches: mismatches, host, hostPinVerified: typeof runtime.hostPin === 'string', sshPinned: [], runnerSha256: { local: sha256(await readFile(path.join(repoRoot, 'cloud-probe', 'run.mjs'))), remote: null }, legs: {}, sessions: [], ok: false, failures: [] };
  const finish = async () => {
    evidence.failures = assessEvidence(evidence, { containerCommand: command, runnerSha256: evidence.runnerSha256.local, toolSha256: sha256(selfBytes) });
    evidence.ok = evidence.failures.length === 0;
    await writeFile(f.out, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`${evidence.ok ? 'ACCEPTED' : 'FAILED'}: ${evidence.failures.length ? evidence.failures.join(' · ') : summarizeEvidence(evidence)}`);
    return evidence.ok ? 0 : 1;
  };
  if (mismatches.length) { evidence.legs.command = { ok: false, mismatches }; return finish(); }
  const transportOptions = { key: runtime.key, knownHosts: runtime.knownHosts, instance: runtime.instance, host };
  const argv = drive.sshArguments(transportOptions);
  const pins = [['-T', null], ['-F', 'none'], ['-i', runtime.key], ['-o', 'IdentitiesOnly=yes'], ['-o', 'BatchMode=yes'], ['-o', 'PreferredAuthentications=publickey'], ['-o', 'PasswordAuthentication=no'], ['-o', 'KbdInteractiveAuthentication=no'], ['-o', 'ClearAllForwardings=yes'], ['-o', `UserKnownHostsFile=${runtime.knownHosts}`], ['-o', 'StrictHostKeyChecking=yes']];
  for (const [flag, value] of pins) {
    const present = argv.some((token, i) => token === flag && (value === null || argv[i + 1] === value));
    if (!present) throw new Error(`sshArguments lacks ${flag}${value ? ' ' + value.replace(runtime.key, '<key>').replace(runtime.knownHosts, '<known_hosts>') : ''}`);
    evidence.sshPinned.push(value === null ? flag : `${flag} ${value === runtime.key ? '<key>' : value === runtime.knownHosts ? '<known_hosts>' : value}`);
  }
  if (argv.at(-1) !== command || argv.at(-2) !== `${runtime.instance}@${host}`) throw new Error('sshArguments does not end with <instance>@<host> <command>');
  const scrub = text => String(text ?? '').split(runtime.instance).join('<instance>').split(runtime.key).join('<key>').split(runtime.knownHosts).join('<known_hosts>');
  const prefix = shape.prefix.join(' ');
  const under = args => `${prefix} node ${REMOTE_MODULE} ${args}`;
  const asSession = args => `node ${REMOTE_MODULE} ${args}`;

  // One ssh session: the real sshTransport (its default command when `command` is null) or `ssh` spawned with the
  // real sshArguments when the client must be killable. stdin written then ended; stdout lines and stderr kept.
  const open = ({ command: sessionCommand, transport = false }) => {
    const options = sessionCommand === null ? transportOptions : { ...transportOptions, command: sessionCommand };
    if (transport) return { ...drive.sshTransport(options).open(), kill: null };
    const child = spawn('ssh', drive.sshArguments(options), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => { child.once('error', error => resolve({ code: null, signal: null, error: error.message })); child.once('close', (code, signal) => resolve({ code, signal })); });
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited, kill: () => child.kill() };
  };
  const run = async (label, { command: sessionCommand, input = /** @type {string | Buffer} */ (''), transport = false, timeoutMs = 90000 }) => {
    const session = open({ command: sessionCommand, transport });
    const lines = [], stderrChunks = [];
    session.stdin.on('error', () => {});
    session.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));
    const reader = createInterface({ input: session.stdout, crlfDelay: Infinity, terminal: false });
    reader.on('line', line => lines.push(line));
    session.stdin.end(input);
    const exit = await within(session.exited, timeoutMs, () => { if (session.kill) session.kill(); return { code: null, signal: null, timedOut: true }; });
    await new Promise(resolve => setImmediate(resolve));
    reader.close();
    const record = { label, command: sessionCommand === null ? '(transport default)' : sessionCommand, transport, exitCode: exit.code ?? null, signal: exit.signal ?? null, timedOut: exit.timedOut === true, error: exit.error ? scrub(exit.error) : null, stdoutLines: lines.length, stderr: scrub(Buffer.concat(stderrChunks).toString('utf8')).slice(-800) };
    evidence.sessions.push(record);
    return { ...record, lines };
  };

  // transfer — this file to the ephemeral test path on the host; hash it and the runner there.
  const transfer = await run('transfer', { command: `umask 022 && mkdir -p ${path.posix.dirname(REMOTE_MODULE)} && cat > ${REMOTE_MODULE} && sha256sum ${REMOTE_MODULE} ${REMOTE_RUNNER}`, input: selfBytes });
  const hashOf = file => (transfer.lines.map(l => l.trim().split(/\s+/)).find(parts => parts[1] === file) || [])[0] ?? null;
  evidence.runnerSha256.remote = hashOf(REMOTE_RUNNER);
  evidence.legs.transfer = { exitCode: transfer.exitCode, moduleSha256: { local: evidence.toolSha256, remote: hashOf(REMOTE_MODULE) } };
  if (transfer.exitCode !== 0 || evidence.legs.transfer.moduleSha256.remote !== evidence.toolSha256) return finish();

  // identity-old / identity-new — stdin of three lines (a 64 KiB one and a non-ASCII one), the identity, the exit.
  const sample = Buffer.from(`omf-linux-execution first line\n${'x'.repeat(65536)}\n合成の最終行 ✓ ${randomUUID().slice(0, 8)}\n`, 'utf8');
  const identity = async (label, sessionCommand, exitRequested) => {
    const session = await run(label, { command: sessionCommand, input: sample });
    const report = lastJson(session.lines) || {};
    const table = Array.isArray(report.processes) ? report.processes : [];
    return {
      exitCode: session.exitCode, exitRequested, stdoutLines: session.stdoutLines,
      uid: report.uid ?? null, gid: report.gid ?? null, euid: report.euid ?? null, egid: report.egid ?? null, groups: report.groups ?? null, groupsCleared: report.status?.groups === '' && Array.isArray(report.groups) && report.groups.every(g => g === CONTAINER_USER.gid),
      noNewPrivs: report.status?.noNewPrivs ?? null, capEff: report.status?.capEff ?? null, capAmb: report.status?.capAmb ?? null,
      stdin: { bytes: report.stdin?.bytes ?? null, echoed: report.stdin?.sha256 === sha256(sample) && report.stdin?.lines === 3 && report.stdin?.longest === 65536, first: report.stdin?.first ?? null, last: report.stdin?.last ?? null },
      env: report.env ?? null, writable: report.writable ?? null, init: report.init ?? null, pid: report.pid ?? null, parent: report.parent ?? null, parentIsShell: Boolean(report.parent && /^(sh|bash|dash|setpriv)$/.test(report.parent.name)), noSetprivLeft: !table.some(p => p.name === 'setpriv'), processes: table, runnerSha256: report.runnerSha256 ?? null
    };
  };
  evidence.legs.identityOld = await identity('identity-old', asSession('--remote identity --exit 0'), 0);
  evidence.legs.identityNew = await identity('identity-new', under('--remote identity --exit 7'), 7);

  // runner-old / runner-new — the real runner with one malformed line, through the real transport.
  const runner = async (label, sessionCommand) => {
    const session = await run(label, { command: sessionCommand, input: 'not json\n', transport: true });
    const results = session.lines.filter(line => line.includes('"event":"result"'));
    const result = lastJson(results) || {};
    return { commandUsed: sessionCommand === null ? 'default' : sessionCommand, exitCode: session.exitCode, resultLines: results.length, result: { event: result.event ?? null, stage: result.stage ?? null, outcome: result.outcome ?? null, reasonCode: result.reasonCode ?? null, reason: result.reason ?? null, uid: result.browser?.uid ?? null, shm: result.browser?.shm ?? null, egressIp: result.egressIp ?? null } };
  };
  evidence.legs.runnerOld = await runner('runner-old', OLD_CONTAINER_COMMAND);
  evidence.legs.runnerNew = await runner('runner-new', null);

  // session-end — a held process under the prefix; kill the client; a second session reads what happened.
  {
    const marker = `/run/omf/tmp/omf-linux-execution-${randomUUID().slice(0, 8)}.json`;
    const hold = open({ command: under(`--remote hold --marker ${marker}`) });
    hold.stdin.on('error', () => {});
    const held = await readHoldEvent(hold.stdout);
    const killedAt = Date.now();
    const clientKilled = hold.kill();
    const clientExit = await within(hold.exited, 15000, () => ({ code: null, signal: null, timedOut: true }));
    evidence.sessions.push({ label: 'hold', command: under(`--remote hold --marker ${marker}`), transport: false, exitCode: clientExit.code ?? null, signal: clientExit.signal ?? null, timedOut: clientExit.timedOut === true, error: null, stdoutLines: held ? 1 : 0, stderr: '' });
    const inspect = await run('inspect', { command: under(`--remote inspect --pid ${held ? held.pid : 0} --marker ${marker}`) });
    const seen = lastJson(inspect.lines) || {};
    evidence.legs.sessionEnd = { holdPid: held ? held.pid : null, holdUid: held ? held.uid : null, clientKilled, clientExit, gone: seen.gone === true, waitedMs: seen.waitedMs ?? null, sinceKillMs: Date.now() - killedAt, marker: seen.marker ?? null, markerRemoved: seen.markerRemoved === true, cause: seen.marker ? seen.marker.cause : (seen.gone ? 'ended-without-marker' : 'still-running'), inspectExit: inspect.exitCode };
  }

  // chrome — the runner's launch path under the prefix on a loopback page.
  {
    const session = await run('chrome', { command: under('--remote chrome'), timeoutMs: 200000 });
    const report = lastJson(session.lines) || {};
    evidence.legs.chrome = { exitCode: session.exitCode, ...report, nonJsonLines: session.lines.filter(line => { try { JSON.parse(line); return false; } catch { return true; } }).slice(0, 20) };
  }

  // cleanup — this file removed from the host; what the host looks like afterwards.
  {
    const session = await run('cleanup', { command: `rm -f ${REMOTE_MODULE} && rmdir ${path.posix.dirname(REMOTE_MODULE)}; echo "module-exists=$(test -e ${REMOTE_MODULE} && echo yes || echo no)"; echo "run-omf=$(ls -A /run/omf | tr '\\n' ' ')"; echo "run-omf-tmp=$(ls -A /run/omf/tmp | tr '\\n' ' ')"; ps -eo pid,ppid,uid,gid,comm` });
    const processes = session.lines.filter(line => /^\s*\d+\s+\d+\s+\d+\s+\d+\s+\S+/.test(line)).map(line => line.trim().split(/\s+/)).map(([pid, ppid, uid, gid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), uid: Number(uid), gid: Number(gid), name: comm }));
    evidence.legs.cleanup = { exitCode: session.exitCode, moduleRemoved: session.lines.includes('module-exists=no'), runOmf: (session.lines.find(l => l.startsWith('run-omf=')) || '').slice(8).trim(), runOmfTmp: (session.lines.find(l => l.startsWith('run-omf-tmp=')) || '').slice(12).trim(), browserProcesses: processes.filter(p => /chrome|Xvfb/.test(p.name)).length, processes };
  }
  return finish();
}

export async function main(argv = process.argv.slice(2)) {
  const f = flags(argv);
  if (f.remote) return remoteMain(f);
  return driverMain(f);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`FAILED: ${error && error.message}`); process.exitCode = 1; });
}

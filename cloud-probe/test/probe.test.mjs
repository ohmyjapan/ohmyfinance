// Legs R1-R13 of the Railway Amex probe (plan omf-railway-amex-probe-20261007, §4; review fold
// omf-railway-amex-review-fold-20261008 F2-F5), with tagged assertions: every failure message starts with
// `[<leg>:<check>]`. The legs drive cloud-probe/run.mjs, relay.mjs and local/drive.mjs through an in-process
// stream pair in place of ssh, with the fake page of ./fake-amex.mjs in place of Chrome. R6c runs the real
// collector/browser.mjs collectStatement in a child of this file (--collect-statement-child) whose only replaced
// seams are the Windows process probe, puppeteer-real-browser's connect and the googleapis client.
// No Chrome, no PowerShell, no Gmail, no vault, no network. Synthetic data only.
//
//   node cloud-probe/test/probe.test.mjs [R1 R2 ...]   runs the legs under node:test
//   scripts/zoomer-fixtures/railway-amex-probe.mjs      runs them plus the collector suite and the defects
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as fake from './fake-amex.mjs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const REFERENCE_REVISION = '1f00be6d73d49e333d4c121d8818dd949bdc7dbf';
const REDACTED = '[REDACTED]';

// The fixed follow-up strings of plan §3, kept here independently of cloud-probe/local/drive.mjs (R7, R10).
export const NEXT_EXPECTED = {
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
    row_count_mismatch: "owner compares the probe's pageCount with the Windows manifest; re-run only on go",
    runner_crash: 'builder fix; re-run only on go'
  }
};

// Plan S1: the exact Windows wiring after the split (whitespace-normalised lines) — R6a's preservation pin.
export const PLANNED_COLLECT_STATEMENT = [
  'export async function collectStatement(account, settings, directory, status, { gmail } = {}) {',
  "const profile = settings.profile || path.join(directory, 'profiles', account.primaryCard);",
  'const browser = await browserFor(profile), page = await amexPage(browser);',
  'return collectFromPage(page, browser, account, settings, directory, status, { mailbox: gmail ? new LoginMailbox(gmail) : null, claims: new LoginClaims(directory) });',
  '}'
];
export const PLANNED_COLLECT_FROM_PAGE_HEADER = 'export async function collectFromPage(page, browser, account, settings, directory, status, { mailbox = null, claims = null } = {}) {';
export const PLANNED_FIRST_STATEMENT = 'await ensureLogin(page, settings, status, { account, mailbox, claims });';
export const R1_EVENTS = ['login', 'choose-email', 'request-code', 'claims_read', 'claim', 'type-code', 'submit-code', 'statement', 'download'];
// R6c: the real LoginMailbox answers from the mocked Gmail client, so the mail events are seen there instead of the
// relay's claims events (the real LoginClaims writes its file, read at type-code time).
export const R6C_EVENTS = ['login', 'choose-email', 'mail-verify', 'request-code', 'mail-list', 'mail-get', 'type-code', 'submit-code', 'statement', 'download'];
// The synthetic Gmail connection of R6c (no real mailbox, token or secret); mixed case proves LoginMailbox lowercases it.
export const GMAIL_CONFIG = Object.freeze({ clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret', refreshToken: 'synthetic-refresh-token', mailbox: 'Forwarded@example.invalid' });
// Playbook §5 rule 2: one TOTAL budget for the whole frame sweep (R8).
export const SWEEP_BUDGET_MS = 2500;

export function tag(leg, check, condition, detail) {
  if (!condition) throw new Error(`[${leg}:${check}] ${detail}`);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const only = (events, names = R1_EVENTS) => events.filter(e => names.includes(e));
const count = (events, name) => events.filter(e => e === name).length;

// ── module loading (lazy, so a missing runtime module fails a leg with a message, not the import) ──
export async function loadModules({ probeDir = path.join(REPO_ROOT, 'cloud-probe'), collectorDir = path.join(REPO_ROOT, 'collector') } = {}) {
  const modules = { errors: {} };
  const load = async (name, file) => {
    try { modules[name] = await import(pathToFileURL(file).href); }
    catch (error) { modules[name] = null; modules.errors[name] = `${path.relative(REPO_ROOT, file).split(path.sep).join('/')}: ${error?.message || error}`; }
  };
  await load('browser', path.join(collectorDir, 'browser.mjs'));
  await load('login', path.join(collectorDir, 'login.mjs'));
  await load('run', path.join(probeDir, 'run.mjs'));
  await load('relay', path.join(probeDir, 'relay.mjs'));
  await load('drive', path.join(probeDir, 'local', 'drive.mjs'));
  return modules;
}

/** @param {{ probeDir?: string, collectorDir?: string, browserSource?: string | null, referenceSource?: string | null, browserFile?: string | null }} [options]
 *  browserFile: the collector module the R6c child executes (the real collector/browser.mjs, or a defective copy). */
export async function makeContext({ probeDir = path.join(REPO_ROOT, 'cloud-probe'), collectorDir = path.join(REPO_ROOT, 'collector'), browserSource = null, referenceSource = null, browserFile = null } = {}) {
  const modules = await loadModules({ probeDir, collectorDir });
  const browserText = browserSource ?? await readFile(path.join(collectorDir, 'browser.mjs'), 'utf8');
  let referenceText = referenceSource;
  if (referenceText === null) {
    const { stdout } = await execute('git', ['-C', REPO_ROOT, 'show', `${REFERENCE_REVISION}:collector/browser.mjs`], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    referenceText = stdout;
  }
  return { modules, fake, probeDir, collectorDir, browserSource: browserText, referenceSource: referenceText, browserFile: browserFile ?? path.join(collectorDir, 'browser.mjs') };
}

function need(ctx, leg, ...names) {
  for (const name of names) tag(leg, 'load', ctx.modules[name], `module ${name} could not be loaded: ${ctx.modules.errors[name] || 'missing'}`);
}

// ── helpers ──
async function tempDir(label) { return mkdtemp(path.join(os.tmpdir(), `omf-probe-${label}-`)); }
async function removeTemp(dir) {
  if (!dir || !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
  await rm(dir, { recursive: true, force: true });
}
async function filesUnder(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full)); else out.push(full);
  }
  return out;
}
// Every file under dir with its sha256, by relative posix path: "nothing was touched" is an equality of two snapshots.
async function snapshotFiles(dir) {
  const out = {};
  for (const file of (await filesUnder(dir)).sort()) out[path.relative(dir, file).split(path.sep).join('/')] = digest(await readFile(file));
  return out;
}
// Stalled promises hold no handle and run.mjs unrefs its budget timers: hold the loop open while a sweep is measured.
async function keepAlive(fn) {
  const timer = setInterval(() => {}, 1000);
  try { return await fn(); } finally { clearInterval(timer); }
}
// Relative imports that leave cloud-probe/ become absolute file URLs, so a copy of a runner module can live in a temp
// directory (the fixture applies the same rule to its defective copies); siblings stay relative and are copied beside.
function relocateProbeSource(source, originalFile, probeDir) {
  return source.replace(/(from\s+|import\()\s*'(\.{1,2}\/[^']+)'/g, (match, prefix, spec) => {
    const target = path.resolve(path.dirname(originalFile), spec);
    return target.startsWith(probeDir + path.sep) ? match : `${prefix}'${pathToFileURL(target).href}'`;
  });
}
// A node child of this process: its stdout lines, stderr and exit code; stdin closed at once; killed at the timeout.
function childJson(args, { timeout = 60000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeout);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, lines: stdout.split('\n').map(line => line.replace(/\r$/, '')).filter(Boolean), stderr }); });
    child.on('error', error => { clearTimeout(timer); resolve({ code: null, signal: null, lines: [], stderr: error.message }); });
    child.stdin.end();
  });
}

// ensureLogin's clock is Date.now (login.mjs:72 default `now`); collectFromPage does not forward a clock, so the
// attention legs run its real 300 s deadline on a stepping Date.now instead of waiting. Restored afterwards.
export async function withFastClock(fn, step = 10000) {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real.call(Date) + (offset += step);
  try { return await fn(); } finally { Date.now = real; }
}

export function wrapClaims(real, events) {
  return { read: async () => { events.push('claims_read'); return real.read(); }, claim: async id => { events.push('claim'); await real.claim(id); } };
}
// A mailbox with LoginMailbox's contract (mail.mjs:33,37,25): verify() and find(account, since, used) -> { id, code } | null.
export function contractMailbox({ verifyError = false, noMatch = false } = {}) {
  const calls = [];
  return {
    calls,
    async verify() { if (verifyError) throw new Error('Mail unavailable'); },
    async find(account, since, used) { calls.push({ card: account?.primaryCard, since, used: [...(used || [])] }); return noMatch ? null : { ...fake.MAIL_MATCH }; }
  };
}

// The ssh session, in process: the driver's stdin/stdout are stream pairs into run(); every line both ways is kept.
export function inProcessTransport({ run, connect, root, fetchIp = async () => null, statfs = async () => null, tamperFirstLine = null, cutAfterLines = null }) {
  const state = { opens: 0, stdinLines: [], stdoutLines: [], settled: [], sessions: [] };
  return {
    state,
    open() {
      state.opens += 1;
      const stdin = new PassThrough(), toContainer = new PassThrough(), fromContainer = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
      for (const stream of [stdin, toContainer, fromContainer, stdout, stderr]) stream.on('error', () => {});
      state.sessions.push({ stdin });
      let first = true, forwarded = 0, cut = false, resolveExit;
      const exited = new Promise(resolve => { resolveExit = resolve; });
      let pendingIn = '';
      stdin.on('data', chunk => {
        pendingIn += chunk.toString('utf8');
        let index;
        while ((index = pendingIn.indexOf('\n')) >= 0) {
          let line = pendingIn.slice(0, index); pendingIn = pendingIn.slice(index + 1);
          state.stdinLines.push(line);
          if (first && tamperFirstLine) line = tamperFirstLine(line);
          first = false;
          if (!toContainer.writableEnded) toContainer.write(line + '\n');
        }
      });
      stdin.on('end', () => { if (!toContainer.writableEnded) toContainer.end(); });
      let pendingOut = '';
      fromContainer.on('data', chunk => {
        pendingOut += chunk.toString('utf8');
        let index;
        while ((index = pendingOut.indexOf('\n')) >= 0) {
          const line = pendingOut.slice(0, index); pendingOut = pendingOut.slice(index + 1);
          state.stdoutLines.push(line);
          if (cut) continue;
          stdout.write(line + '\n');
          forwarded += 1;
          if (cutAfterLines !== null && forwarded >= cutAfterLines) { cut = true; stderr.end('Connection closed by remote host.\n'); stdout.end(); resolveExit({ code: 255, signal: null }); }
        }
      });
      fromContainer.on('end', () => { if (!cut) { stdout.end(); stderr.end(); resolveExit({ code: 0, signal: null }); } });
      const settled = Promise.resolve()
        .then(() => run({ input: toContainer, output: fromContainer, connect, root, fetchIp, statfs }))
        .then(result => ({ result }), error => ({ crashed: error }))
        .then(outcome => { fromContainer.end(); return outcome; });
      state.settled.push(settled);
      return { stdin, stdout, stderr, exited, settled };
    }
  };
}

// run() alone, no driver: the container's own lines (R2, R11). `patch` bends the fake at a seam before the run.
async function runContainer(ctx, { stage, scenario = {}, credentials = null, patch = null, label }) {
  const dir = await tempDir(label);
  try {
    const fx = ctx.fake.fakeAmex(scenario);
    if (patch) patch(fx);
    const input = new PassThrough(), output = new PassThrough();
    const lines = []; let buffer = '';
    output.on('data', chunk => { buffer += chunk.toString('utf8'); let i; while ((i = buffer.indexOf('\n')) >= 0) { lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } });
    input.write(JSON.stringify({ stage, account: { ...ctx.fake.ACCOUNT, jobId: 'probe-test' }, ...(credentials ? { credentials } : {}) }) + '\n');
    const result = await ctx.modules.run.run({ input, output, connect: fx.connect, root: path.join(dir, 'root'), fetchIp: async () => null, statfs: async () => null });
    input.end();
    await new Promise(resolve => setImmediate(resolve));
    return { result, lines, fx };
  } finally { await removeTemp(dir); }
}

// The driver (runProbe) over the in-process transport, with a real LoginClaims in a temp collector directory.
/** @param {any} ctx @param {{ stage: string, scenario?: any, mailbox?: any, claims?: any, transportOptions?: any, preclaim?: boolean, onTypeCode?: any, patch?: any, out?: string, label: string }} options */
async function driveProbe(ctx, { stage, scenario = {}, mailbox = undefined, claims = undefined, transportOptions = {}, preclaim = false, onTypeCode = null, patch = null, out = undefined, label }) {
  const dir = await tempDir(label);
  const events = scenario.events || [];
  const claimsDir = path.join(dir, 'collector'); await mkdir(claimsDir, { recursive: true });
  const fx = ctx.fake.fakeAmex({ ...scenario, events, onTypeCode: onTypeCode ? () => onTypeCode({ claimsDir }) : scenario.onTypeCode });
  if (patch) patch(fx);
  const realClaims = new ctx.modules.login.LoginClaims(claimsDir);
  if (preclaim) await realClaims.claim(fake.MAIL_MATCH.id);
  const claimsObject = claims === undefined ? wrapClaims(realClaims, events) : claims;
  const mailboxObject = mailbox === undefined ? contractMailbox() : mailbox;
  const root = path.join(dir, 'root'), outDir = out ?? path.join(dir, 'out');
  const transport = inProcessTransport({ run: ctx.modules.run.run, connect: fx.connect, root, ...transportOptions });
  const summary = [];
  const { record, exitCode } = await ctx.modules.drive.runProbe({ stage, account: ctx.fake.ACCOUNT, credentials: stage === 'collect' ? ctx.fake.CREDENTIALS : null, mailbox: mailboxObject, claims: claimsObject, transport, out: outDir, log: line => summary.push(line) });
  const settled = await Promise.all(transport.state.settled);
  return { record, exitCode, summary, transport, fx, events, dir, out: outDir, root, claimsDir, settled, cleanup: () => removeTemp(dir) };
}

const forms = secret => [secret, Buffer.from(secret, 'utf8').toString('base64'), Buffer.from(secret, 'utf8').toString('hex'), encodeURIComponent(secret)];
function leak(text, secrets) {
  for (const secret of secrets) for (const form of forms(secret)) if (text.includes(form)) return `${secret.slice(0, 8)}… as ${form === secret ? 'raw' : form === encodeURIComponent(secret) ? 'percent-encoded' : form.length === secret.length * 2 ? 'hex' : 'base64'}`;
  return null;
}
// A stdout line with its numeric `since` removed (a timestamp can contain any six digits).
const scannable = line => { try { const o = JSON.parse(line); if (o && typeof o === 'object' && 'since' in o) { const { since: _s, ...rest } = o; return JSON.stringify(rest); } } catch {} return line; };
const resultLine = lines => { const last = lines.at(-1); const parsed = JSON.parse(last); return { parsed, text: last }; };

// ── legs ──
export const legs = {
  async R1(ctx) {
    need(ctx, 'R1', 'run', 'relay', 'drive', 'login');
    let claimsAtTypeCode = null;
    // Read synchronously at the moment the code is typed: the claim must already be on disk (login.mjs:109).
    const run = await driveProbe(ctx, { stage: 'collect', label: 'r1', onTypeCode: ({ claimsDir }) => { try { claimsAtTypeCode = JSON.parse(readFileSync(path.join(claimsDir, 'used-login-messages.json'), 'utf8')); } catch { claimsAtTypeCode = null; } } });
    try {
      tag('R1', 'outcome', run.record.outcome === 'collected', `outcome ${run.record.outcome} (${run.record.reason})`);
      assertEvents('R1', run.events, R1_EVENTS);
      tag('R1', 'claim-before-type', JSON.stringify(claimsAtTypeCode) === JSON.stringify([fake.MAIL_MATCH.id]), `claims file at type-code was ${JSON.stringify(claimsAtTypeCode)}`);
      tag('R1', 'manifest', run.record.manifest?.pageCount === 4 && run.record.manifest?.start === fake.STATEMENT.start && run.record.manifest?.end === fake.STATEMENT.end, `manifest ${JSON.stringify(run.record.manifest)}`);
      tag('R1', 'sha256', run.record.manifest?.sha256 === digest(fake.syntheticCsv(4)), 'manifest sha256 is not the CSV digest');
      tag('R1', 'one-password', run.fx.counts.password === 1, `password typed ${run.fx.counts.password} times`);
      tag('R1', 'csv-off-wire', run.transport.state.stdoutLines.every(line => !line.includes(fake.CSV_CANARY)), 'CSV bytes reached a stdout line');
      tag('R1', 'work-removed', !existsSync(run.root) || !existsSync(path.join(run.root, 'work')), '/work was kept after the run');
      tag('R1', 'one-session', run.transport.state.opens === 1, `${run.transport.state.opens} sessions`);
      tag('R1', 'exit', run.exitCode === 0, `driver exit ${run.exitCode}`);
      tag('R1', 'summary', run.summary.length === 1 && run.summary[0] === `collected: ${NEXT_EXPECTED.collected}`, `summary ${JSON.stringify(run.summary)}`);
      return 'collected, 9 events in order, claim persisted before type-code, pageCount 4, sha256 equal, 1 password, /work removed';
    } finally { await run.cleanup(); }
  },

  async R2(ctx) {
    need(ctx, 'R2', 'run', 'relay');
    const seen = [];
    const login = await runContainer(ctx, { stage: 'reach', label: 'r2a', scenario: { start: 'login' } });
    seen.push(login.result.outcome);
    tag('R2', 'login-form', login.result.outcome === 'login_form_shown', `outcome ${login.result.outcome} (${login.result.reason})`);
    tag('R2', 'login-capture', Array.isArray(login.result.capture?.frames) && login.result.capture.frames.length === 2 && typeof login.result.capture.screenshot === 'string', 'reach capture lacks frames[] or the screenshot');
    tag('R2', 'login-pagekind', login.result.pageKind === 'login', `pageKind ${login.result.pageKind}`);
    tag('R2', 'one-result', login.lines.filter(l => l.includes('"event":"result"')).length === 1 && resultLine(login.lines).parsed.event === 'result', 'not exactly one result line, last');
    const unknown = await withFastClock(() => runContainer(ctx, { stage: 'reach', label: 'r2b', scenario: { start: 'unknown' } }));
    seen.push(unknown.result.outcome);
    tag('R2', 'unknown-page', unknown.result.outcome === 'unknown_page', `outcome ${unknown.result.outcome}`);
    tag('R2', 'unknown-capture', Array.isArray(unknown.result.capture?.frames) && unknown.result.capture.frames.length === 2, 'unknown page without capture');
    tag('R2', 'unknown-pagekind', unknown.result.pageKind === 'unknown', `pageKind ${unknown.result.pageKind}`);
    const issuer = await runContainer(ctx, { stage: 'reach', label: 'r2c', scenario: { gotoThrows: true } });
    seen.push(issuer.result.outcome);
    tag('R2', 'issuer-unavailable', issuer.result.outcome === 'issuer_unavailable', `outcome ${issuer.result.outcome} (${issuer.result.reason})`);
    const browser = await runContainer(ctx, { stage: 'reach', label: 'r2d', scenario: { connectThrows: true } });
    seen.push(browser.result.outcome);
    tag('R2', 'browser-unavailable', browser.result.outcome === 'browser_unavailable', `outcome ${browser.result.outcome}`);
    tag('R2', 'browser-facts', browser.result.browser && 'uid' in browser.result.browser && 'shm' in browser.result.browser && !('capture' in browser.result), 'browser_unavailable lacks uid/shm or carries a capture');
    tag('R2', 'no-bot-verdict', seen.every(o => o !== 'bot_rejected'), `an automatic bot verdict appeared: ${seen.join(',')}`);
    tag('R2', 'exits-named', seen.every(o => ['login_form_shown', 'unknown_page', 'issuer_unavailable', 'browser_unavailable'].includes(o)), seen.join(','));
    return `reach: ${seen.join(', ')}`;
  },

  async R3a(ctx) {
    need(ctx, 'R3a', 'run', 'relay', 'drive', 'login');
    const { scrub } = ctx.modules.relay;
    tag('R3a', 'scrub-forms', !/a\/b|a%2Fb/.test(scrub('x a/b y a%2Fb z', ['a/b'])) && !scrub('v="a&quot;b" a"b', ['a"b']).includes('a"b') && !scrub('v="a&quot;b"', ['a"b']).includes('a&quot;b') && scrub('', []) === '' && scrub(null, ['x']) === '', 'scrub misses a raw, percent-encoded or attribute-escaped form');
    const secrets = [...fake.CANARIES];
    const collect = await driveProbe(ctx, { stage: 'collect', label: 'r3a-collect' });
    const reach = await driveProbe(ctx, { stage: 'reach', label: 'r3a-reach' });
    try {
      tag('R3a', 'collected', collect.record.outcome === 'collected', `outcome ${collect.record.outcome}`);
      for (const run of [collect, reach]) {
        for (const line of run.transport.state.stdoutLines) { const found = leak(scannable(line), secrets); tag('R3a', 'stdout', !found, `${run.record.stage} stdout line carries ${found}`); }
        for (const file of await filesUnder(run.out)) { const found = leak(await readFile(file, 'utf8'), secrets); tag('R3a', 'disk', !found, `${path.basename(file)} carries ${found}`); }
        for (const line of run.transport.state.stdinLines) tag('R3a', 'no-gmail-on-stdin', !('gmail' in JSON.parse(line)), 'a stdin line carries a gmail key');
      }
      const reachFirst = JSON.parse(reach.transport.state.stdinLines[0]);
      tag('R3a', 'reach-no-credentials', reachFirst.stage === 'reach' && !('credentials' in reachFirst), 'the reach stdin line carries a credentials key');
      return 'no canary (raw/base64/hex/percent) on stdout or disk; reach line without credentials; no gmail key on stdin';
    } finally { await collect.cleanup(); await reach.cleanup(); }
  },

  async R3b(ctx) {
    need(ctx, 'R3b', 'run', 'relay', 'drive', 'login');
    const secrets = [...fake.CANARIES];
    const cases = [
      { label: 'attention', scenario: { afterCode: 'unknown' }, outcome: 'attention', code: true },
      { label: 'unknown-page', scenario: { statementCardMismatch: true }, outcome: 'unknown_page', code: true },
      { label: 'claim-failed', scenario: {}, preclaim: true, outcome: 'service_failure', reasonCode: 'claim_failed', code: false }
    ];
    const done = [];
    for (const c of cases) {
      const run = await withFastClock(() => driveProbe(ctx, { stage: 'collect', label: `r3b-${c.label}`, scenario: c.scenario, preclaim: c.preclaim }));
      try {
        tag('R3b', `${c.label}-outcome`, run.record.outcome === c.outcome && (c.reasonCode ?? null) === (run.record.reasonCode ?? null), `outcome ${run.record.outcome}/${run.record.reasonCode} (${run.record.reason})`);
        tag('R3b', `${c.label}-signed-in`, count(run.events, 'login') === 1 && run.fx.typed.username === fake.CREDENTIALS.username && run.fx.typed.password === fake.CREDENTIALS.password && (run.fx.typed.code === fake.MAIL_MATCH.code) === c.code, 'the fake did not render the expected credentials');
        const files = await filesUnder(path.join(run.out, 'capture'));
        const names = files.map(f => path.basename(f));
        tag('R3b', `${c.label}-files`, names.includes('main.html') && names.includes('main.txt') && names.includes('frame-1.html') && names.includes('frame-1.txt'), `capture files ${names.join(',')}`);
        const texts = {};
        for (const file of files) { texts[path.basename(file)] = await readFile(file, 'utf8'); const found = leak(texts[path.basename(file)], secrets); tag('R3b', `${c.label}-clean`, !found, `${path.basename(file)} carries ${found}`); }
        const main = texts['main.html'];
        tag('R3b', `${c.label}-redacted-values`, main.includes(`id="eliloUserID" value="${REDACTED}"`) && main.includes(`id="eliloPassword" type="password" value="${REDACTED}"`), 'value attributes were not replaced by [REDACTED]');
        tag('R3b', `${c.label}-redacted-text`, main.includes(`ようこそ ${REDACTED} さん`) && texts['main.txt'].includes(`ようこそ ${REDACTED} さん`), 'the username text node was not replaced by [REDACTED]');
        tag('R3b', `${c.label}-redacted-href`, main.includes(`user=${REDACTED}`), 'the percent-encoded href was not replaced by [REDACTED]');
        tag('R3b', `${c.label}-redacted-frame`, texts['frame-1.html'].includes(`<span id="frame-user">${REDACTED}</span>`) && texts['frame-1.txt'] === REDACTED, 'the child frame was not replaced by [REDACTED]');
        if (c.code) tag('R3b', `${c.label}-redacted-code`, main.includes(`id="question-input" autocomplete="one-time-code" value="${REDACTED}"`) && main.includes(`入力された認証コード ${REDACTED}`) && texts['main.txt'].includes(`入力された認証コード ${REDACTED}`), 'the code was not replaced by [REDACTED]');
        const result = resultLine(run.transport.state.stdoutLines);
        const found = leak(scannable(result.text), secrets);
        tag('R3b', `${c.label}-result-clean`, !found, `the result line carries ${found}`);
        tag('R3b', `${c.label}-no-screenshot`, result.parsed.capture && !('screenshot' in result.parsed.capture) && !names.includes('screenshot.png') && run.record.capture?.screenshot === false, 'a collect result carries a screenshot');
        done.push(`${c.label}:${run.record.outcome}`);
      } finally { await run.cleanup(); }
    }
    const reach = await driveProbe(ctx, { stage: 'reach', label: 'r3b-reach' });
    try {
      const result = resultLine(reach.transport.state.stdoutLines);
      tag('R3b', 'reach-screenshot', typeof result.parsed.capture?.screenshot === 'string' && existsSync(path.join(reach.out, 'capture', 'screenshot.png')), 'a reach result lacks the screenshot');
    } finally { await reach.cleanup(); }
    return `${done.join(', ')}: canaries redacted in html/txt and the result line; screenshot only in reach`;
  },

  async R3c(ctx) {
    need(ctx, 'R3c', 'run', 'relay', 'drive', 'login');
    const run = await withFastClock(() => driveProbe(ctx, { stage: 'collect', label: 'r3c', scenario: { wrongRecipient: true, domStepThrowsForFrame: 1 } }));
    try {
      tag('R3c', 'outcome', run.record.outcome === 'attention', `outcome ${run.record.outcome}`);
      const frame = await readFile(path.join(run.out, 'capture', 'frame-1.html'), 'utf8');
      const main = await readFile(path.join(run.out, 'capture', 'main.html'), 'utf8');
      tag('R3c', 'fallback', frame.startsWith('<!-- content() -->') && !main.startsWith('<!-- content() -->'), 'the throwing frame did not fall back to content()');
      tag('R3c', 'scrubbed', frame.includes(`<span id="frame-user">${REDACTED}</span>`) && !leak(frame, [...fake.CANARIES]), 'the fallback html is not scrubbed');
      tag('R3c', 'text-empty', (await readFile(path.join(run.out, 'capture', 'frame-1.txt'), 'utf8')) === '', 'fallback text is not empty');
      return 'one frame fell back to content() and was still scrubbed';
    } finally { await run.cleanup(); }
  },

  async R4(ctx) {
    need(ctx, 'R4', 'run', 'relay', 'drive', 'login');
    const cases = [
      { label: 'wrong-recipient', scenario: { wrongRecipient: true }, logins: 1 },
      { label: 'pre-existing-challenge', scenario: { start: 'channels' }, logins: 0 },
      { label: 'mailbox-verify-fails', scenario: {}, mailbox: contractMailbox({ verifyError: true }), logins: 1 }
    ];
    const done = [];
    for (const c of cases) {
      const run = await withFastClock(() => driveProbe(ctx, { stage: 'collect', label: `r4-${c.label}`, scenario: c.scenario, mailbox: c.mailbox }));
      try {
        tag('R4', `${c.label}-outcome`, run.record.outcome === 'attention', `outcome ${run.record.outcome} (${run.record.reason})`);
        tag('R4', `${c.label}-one-login`, count(run.events, 'login') === c.logins && run.fx.counts.password === c.logins, `${count(run.events, 'login')} logins, ${run.fx.counts.password} passwords (expected ${c.logins})`);
        tag('R4', `${c.label}-no-request`, count(run.events, 'request-code') === 0 && run.record.tally.requestCode === 0, 'a code was requested');
        tag('R4', `${c.label}-one-session`, run.transport.state.opens === 1, `${run.transport.state.opens} sessions`);
        tag('R4', `${c.label}-exit`, run.exitCode === 0 && run.summary[0] === `attention: ${NEXT_EXPECTED.attention}`, `exit ${run.exitCode} / ${run.summary[0]}`);
        tag('R4', `${c.label}-status`, run.record.lastStatus?.state === 'verification_required', `lastStatus ${JSON.stringify(run.record.lastStatus)}`);
        done.push(c.label);
      } finally { await run.cleanup(); }
    }
    return `${done.join(', ')}: attention, no second password, no second session`;
  },

  async R5(ctx) {
    need(ctx, 'R5', 'run', 'relay', 'drive', 'login');
    const mailbox = contractMailbox({ noMatch: true });
    const run = await withFastClock(() => driveProbe(ctx, { stage: 'collect', label: 'r5', mailbox }));
    try {
      tag('R5', 'outcome', run.record.outcome === 'attention', `outcome ${run.record.outcome} (${run.record.reason})`);
      tag('R5', 'one-request', count(run.events, 'request-code') === 1 && run.record.tally.requestCode === 1, `${count(run.events, 'request-code')} requests`);
      tag('R5', 'no-code', count(run.events, 'type-code') === 0 && count(run.events, 'claim') === 0, 'a code was typed or claimed');
      tag('R5', 'tally', run.record.tally.finds > 0 && run.record.tally.found === false && mailbox.calls.length === run.record.tally.finds, `tally ${JSON.stringify(run.record.tally)} / ${mailbox.calls.length} finds`);
      tag('R5', 'one-login', count(run.events, 'login') === 1 && run.fx.counts.password === 1, 'password typed more than once');
      return `attention after the window, ${run.record.tally.finds} mailbox reads, 1 request-code, 0 type-code`;
    } finally { await run.cleanup(); }
  },

  // R6a is a PRESERVATION CHECK, not wiring coverage: it pins the wrapper's text to the planned lines and the moved body
  // to the 1f00be6d text, and runs the collector's own suite. The wrapper is EXECUTED by R6c.
  async R6a(ctx) {
    const norm = lines => lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const split = text => text.replace(/\r\n/g, '\n').split('\n');
    const block = (lines, headerPrefix) => {
      const start = lines.findIndex(line => line.startsWith(headerPrefix));
      if (start < 0) return null;
      const end = lines.findIndex((line, i) => i > start && line === '}');
      return end < 0 ? null : { start, end, lines: lines.slice(start, end + 1) };
    };
    const ref = split(ctx.referenceSource), cur = split(ctx.browserSource);
    tag('R6a', 'reference', ref.length >= 123 && ref[72].startsWith('export async function collectStatement('), 'the reference text is not 1f00be6d collector/browser.mjs');
    tag('R6a', 'prefix-unchanged', JSON.stringify(norm(cur.slice(0, 72))) === JSON.stringify(norm(ref.slice(0, 72))), 'lines 1-72 (imports, browserFor, amexPage, selectLatestStatement) changed');
    const statement = block(cur, 'export async function collectStatement(');
    tag('R6a', 'collect-statement', statement && JSON.stringify(norm(statement.lines)) === JSON.stringify(PLANNED_COLLECT_STATEMENT), `collectStatement is not the planned four lines: ${JSON.stringify(statement ? norm(statement.lines) : null)}`);
    const fromPage = block(cur, 'export async function collectFromPage(');
    tag('R6a', 'collect-from-page-exists', fromPage, 'collectFromPage is not defined');
    const body = norm(fromPage.lines);
    tag('R6a', 'collect-from-page-header', body[0] === PLANNED_COLLECT_FROM_PAGE_HEADER, `header ${body[0]}`);
    tag('R6a', 'one-substitution', body[1] === PLANNED_FIRST_STATEMENT, `first statement ${body[1]}`);
    tag('R6a', 'body-verbatim', JSON.stringify(body.slice(2)) === JSON.stringify([...norm(ref.slice(76, 122)), '}']), 'the rest of collectFromPage is not 1f00be6d lines 77-122');
    tag('R6a', 'order', statement.end < fromPage.start, 'collectFromPage must follow collectStatement');
    tag('R6a', 'nothing-else', cur.slice(fromPage.end + 1).every(line => line.trim() === ''), 'content follows collectFromPage');
    need(ctx, 'R6a', 'browser');
    tag('R6a', 'exports', typeof ctx.modules.browser.collectFromPage === 'function' && typeof ctx.modules.browser.collectStatement === 'function', 'collectFromPage/collectStatement are not exported functions');
    const testDir = path.join(ctx.collectorDir, 'test');
    const files = (await readdir(testDir)).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join('test', name));
    let suite;
    try { suite = await execute(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: ctx.collectorDir, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 180000 }); }
    catch (error) { tag('R6a', 'collector-suite', false, `collector suite red: ${String(error.stdout || error.message).split('\n').filter(l => /^not ok|^# (pass|fail)/.test(l.trim())).join(' | ').slice(0, 500)}`); }
    const pass = suite.stdout.match(/^# pass (\d+)/m)?.[1], fail = suite.stdout.match(/^# fail (\d+)/m)?.[1];
    tag('R6a', 'collector-suite', fail === '0' && Number(pass) > 0, `collector suite pass=${pass} fail=${fail}`);
    return `preservation check only (text pin, not wiring coverage — R6c executes the wrapper): wrapper = planned text; body = 1f00be6d lines 77-122; collector suite ${pass} pass / 0 fail`;
  },

  async R6b(ctx) {
    need(ctx, 'R6b', 'browser', 'login');
    const dir = await tempDir('r6b');
    try {
      const events = [], statuses = [];
      const fx = ctx.fake.fakeAmex({ events });
      const claimsDir = path.join(dir, 'collector'); await mkdir(claimsDir);
      const claims = wrapClaims(new ctx.modules.login.LoginClaims(claimsDir), events);
      const mailbox = contractMailbox();
      const work = path.join(dir, 'work');
      const account = { ...ctx.fake.ACCOUNT, jobId: 'job-r6b' };
      const result = await ctx.modules.browser.collectFromPage(fx.page, fx.browser, account, ctx.fake.CREDENTIALS, work, async (state, text) => { statuses.push({ state, text }); }, { mailbox, claims });
      assertEvents('R6b', events, R1_EVENTS);
      tag('R6b', 'manifest', result.manifest.pageCount === 4 && result.manifest.sha256 === digest(fake.syntheticCsv(4)) && result.manifest.jobId === 'job-r6b' && result.manifest.accountId === account._id, `manifest ${JSON.stringify(result.manifest)}`);
      tag('R6b', 'manifest-file', existsSync(path.join(work, 'outbox', account._id, 'job-r6b', 'manifest.json')) && result.directory === path.join(work, 'outbox', account._id, 'job-r6b'), 'manifest.json missing from the Windows outbox layout');
      tag('R6b', 'claims-persisted', JSON.stringify(await claims.read()) === JSON.stringify([fake.MAIL_MATCH.id]), 'the mail id was not persisted');
      tag('R6b', 'statuses', statuses.some(s => s.text === 'Signing in to Amex') && statuses.some(s => s.text === 'Selecting the latest closed Amex statement'), 'collector status strings missing');
      tag('R6b', 'find-contract', mailbox.calls.length === 1 && mailbox.calls[0].card === '12345' && typeof mailbox.calls[0].since === 'number' && JSON.stringify(mailbox.calls[0].used) === '[]', `find calls ${JSON.stringify(mailbox.calls)}`);
      // The Windows no-gmail case: mailbox null -> attention at the channels step (login.mjs:89).
      const events2 = [];
      const fx2 = ctx.fake.fakeAmex({ events: events2 });
      let rejected = /** @type {any} */ (null);
      await withFastClock(async () => {
        try { await ctx.modules.browser.collectFromPage(fx2.page, fx2.browser, account, ctx.fake.CREDENTIALS, path.join(dir, 'work2'), async () => {}, { mailbox: null, claims }); }
        catch (error) { rejected = error; }
      });
      tag('R6b', 'no-mailbox-attention', rejected && /needs attention/.test(rejected.message), `mailbox null did not end in attention: ${rejected?.message}`);
      tag('R6b', 'no-mailbox-one-password', count(events2, 'login') === 1 && fx2.counts.password === 1 && count(events2, 'request-code') === 0 && count(events2, 'choose-email') === 0, `events ${events2.join(',')}`);
      return 'Windows-shaped mailbox/claims through the shared body reproduce R1; mailbox null -> attention at channels with 1 password';
    } finally { await removeTemp(dir); }
  },

  // R6c (review F5): the real collectStatement — the Windows wrapper — executed in a child of this file with only its
  // external seams replaced (the powershell probe, puppeteer-real-browser's connect, the googleapis client). The child
  // reports what the real code did; nothing here reads the wrapper's text. Twice: a configured profile (differs from
  // the collector directory, so claims under the profile would be caught) and the default profile.
  async R6c(ctx) {
    need(ctx, 'R6c', 'browser', 'login');
    const done = [];
    for (const mode of ['configured', 'default']) {
      const dir = await tempDir(`r6c-${mode}`);
      try {
        const child = await childJson(['--experimental-test-module-mocks', '--experimental-import-meta-resolve', fileURLToPath(import.meta.url), '--collect-statement-child', '--dir', dir, '--profile', mode, '--browser-file', ctx.browserFile], { timeout: 180000 });
        let report = null;
        try { report = JSON.parse(child.lines.at(-1)); } catch {}
        const noise = String(child.stderr || '').split('\n').filter(line => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line)).join(' | ').slice(0, 400);
        tag('R6c', `${mode}-child`, child.code === 0 && report && report.harness === 'collect-statement', `child exit ${child.code} (${noise}) last line ${String(child.lines.at(-1) ?? '').slice(0, 200)}`);
        tag('R6c', `${mode}-result`, report.error === null && report.result && report.result.manifest, `collectStatement did not return a manifest: ${report.error}`);
        const expectedProfile = mode === 'configured' ? report.paths.configuredProfile : report.paths.defaultProfile;
        const probe = report.execFile[0] || { args: [] };
        tag('R6c', `${mode}-profile`, report.execFile.length === 1 && probe.file === 'powershell.exe' && path.basename(String(probe.args[probe.args.indexOf('-File') + 1])) === 'browser-process.ps1' && probe.args[probe.args.indexOf('-ProfilePath') + 1] === expectedProfile && report.connect.length === 1 && report.connect[0].customConfig?.userDataDir === expectedProfile, `profile seams ${JSON.stringify({ expectedProfile, execFile: report.execFile, connect: report.connect })}`);
        tag('R6c', `${mode}-chrome-flags`, report.connect[0].headless === false && report.connect[0].turnstile === false && JSON.stringify(report.connect[0].args) === JSON.stringify(['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8']) && report.connect[0].connectOption?.protocolTimeout === 30000 && report.connect[0].connectOption?.defaultViewport === null, `connect options ${JSON.stringify(report.connect[0])}`);
        tag('R6c', `${mode}-events`, JSON.stringify(report.events.filter(e => R6C_EVENTS.includes(e))) === JSON.stringify(R6C_EVENTS), `events ${JSON.stringify(report.events)}`);
        tag('R6c', `${mode}-claims-directory`, JSON.stringify(report.claimsAtTypeCode) === JSON.stringify([fake.MAIL_MATCH.id]) && JSON.stringify(report.claimsFinal) === JSON.stringify([fake.MAIL_MATCH.id]) && report.claimsElsewhere.length === 0, `claims at type-code ${JSON.stringify(report.claimsAtTypeCode)}, final ${JSON.stringify(report.claimsFinal)}, elsewhere ${JSON.stringify(report.claimsElsewhere)}`);
        tag('R6c', `${mode}-gmail`, JSON.stringify(report.google.oauth) === JSON.stringify([{ clientId: GMAIL_CONFIG.clientId, clientSecret: GMAIL_CONFIG.clientSecret }]) && JSON.stringify(report.google.credentials) === JSON.stringify([{ refresh_token: GMAIL_CONFIG.refreshToken }]) && JSON.stringify(report.google.gmail) === JSON.stringify([{ version: 'v1', authIsOAuth2: true }]) && report.google.getProfile === 1, `gmail wiring ${JSON.stringify(report.google)}`);
        const query = report.google.list[0]?.q || '', after = Number((query.match(/after:(\d+)/) || [])[1]);
        const floorMs = after * 1000 + 15000, requestedAt = report.stamps['request-code'];
        tag('R6c', `${mode}-mail-window`, report.google.list.length === 1 && report.google.list[0].userId === 'me' && report.google.list[0].maxResults === 20 && query.startsWith('from:AmericanExpress@welcome.americanexpress.com after:') && Number.isFinite(after) && requestedAt - floorMs >= 0 && requestedAt - floorMs < 1500 && report.google.list[0].at >= requestedAt && JSON.stringify(report.google.get) === JSON.stringify([{ id: fake.MAIL_MATCH.id, format: 'full' }]), `mail look-back ${JSON.stringify({ query, after, floorMs, requestedAt, list: report.google.list, get: report.google.get })}`);
        tag('R6c', `${mode}-manifest`, report.result.manifest.pageCount === 4 && report.result.manifest.sha256 === digest(fake.syntheticCsv(4)) && report.result.manifest.jobId === 'job-r6c' && report.result.manifest.accountId === fake.ACCOUNT._id && report.result.directory === path.join(report.paths.directory, 'outbox', fake.ACCOUNT._id, 'job-r6c') && report.manifestFile === true, `manifest ${JSON.stringify(report.result)}`);
        tag('R6c', `${mode}-typed`, report.typed.usernameMatches && report.typed.passwordMatches && report.typed.codeMatches && report.counts.password === 1, `typed ${JSON.stringify({ typed: report.typed, counts: report.counts })}`);
        tag('R6c', `${mode}-statuses`, ['Signing in to Amex', 'Requesting the Amex account-login email', 'Selecting the latest closed Amex statement'].every(text => report.statuses.some(s => s.text === text)), `statuses ${JSON.stringify(report.statuses)}`);
        tag('R6c', `${mode}-no-network`, report.fetch === 0, `fetch was called ${report.fetch} times`);
        done.push(mode);
      } finally { await removeTemp(dir); }
    }
    return `real collectStatement ran in a mocked child for the ${done.join(' and ')} profile: Windows seams called with that profile, LoginMailbox(gmail) built from the config, claims under the collector directory before the code was typed, mail look-back anchored to the request, manifest in the outbox`;
  },

  async R7(ctx) {
    need(ctx, 'R7', 'run', 'relay', 'drive', 'login');
    const cases = [
      { outcome: 'login_form_shown', stage: 'reach' },
      { outcome: 'collected', stage: 'collect' },
      { outcome: 'attention', stage: 'collect', scenario: { wrongRecipient: true }, fast: true },
      { outcome: 'issuer_unavailable', stage: 'reach', scenario: { gotoThrows: true } },
      { outcome: 'browser_unavailable', stage: 'reach', scenario: { connectThrows: true } },
      { outcome: 'unknown_page', stage: 'reach', scenario: { start: 'unknown' }, fast: true },
      { outcome: 'service_failure', reasonCode: 'malformed_stdin', stage: 'reach', transportOptions: { tamperFirstLine: () => '{"stage":"reach",' } },
      { outcome: 'service_failure', reasonCode: 'session_closed', stage: 'collect', scenario: { afterLogin: 'authenticated', statementCardMismatch: true }, transportOptions: { cutAfterLines: 1 }, fast: true },
      { outcome: 'service_failure', reasonCode: 'claim_failed', stage: 'collect', preclaim: true, fast: true },
      { outcome: 'service_failure', reasonCode: 'row_count_mismatch', stage: 'collect', scenario: { csvRows: 3 } }
    ];
    const done = [];
    for (const c of cases) {
      const label = c.reasonCode ? `${c.outcome}/${c.reasonCode}` : c.outcome;
      const expected = c.reasonCode ? NEXT_EXPECTED.service_failure[c.reasonCode] : NEXT_EXPECTED[c.outcome];
      const go = () => driveProbe(ctx, { stage: c.stage, label: `r7-${label.replace('/', '-')}`, scenario: c.scenario || {}, transportOptions: c.transportOptions || {}, preclaim: c.preclaim });
      const run = c.fast ? await withFastClock(go) : await go();
      try {
        tag('R7', `${label}-outcome`, run.record.outcome === c.outcome && (run.record.reasonCode ?? null) === (c.reasonCode ?? null), `outcome ${run.record.outcome}/${run.record.reasonCode} (${run.record.reason})`);
        tag('R7', `${label}-next`, typeof expected === 'string' && run.record.next === expected, `next ${JSON.stringify(run.record.next)}`);
        tag('R7', `${label}-fields`, 'tally' in run.record && run.record.tally && typeof run.record.tally === 'object' && 'pageKind' in run.record, 'tally or pageKind missing from result.json');
        const written = JSON.parse(await readFile(path.join(run.out, 'result.json'), 'utf8'));
        tag('R7', `${label}-file`, written.next === expected && written.outcome === c.outcome, 'result.json differs from the record');
        tag('R7', `${label}-summary`, run.summary.length === 1 && run.summary[0] === `${c.outcome}: ${expected}`, `summary ${JSON.stringify(run.summary)}`);
        tag('R7', `${label}-exit`, run.exitCode === 0, `exit ${run.exitCode}`);
        tag('R7', `${label}-one-session`, run.transport.state.opens === 1, `${run.transport.state.opens} sessions`);
        tag('R7', `${label}-one-password`, count(run.events, 'login') <= 1 && run.fx.counts.password <= 1, 'a second password');
        done.push(label);
      } finally { await run.cleanup(); }
    }
    return `${done.length} outcomes each with the fixed next, tally and pageKind, one session, no second password`;
  },

  // R8 (review F2): the frame sweep has ONE total budget (playbook §5 rule 2), measured on the real clock. Stalled
  // frames: every frame stays indexed with its url and empty html/text, no DOM step or content() fallback is started
  // once the budget is spent, and the whole sweep ends near the budget. Fast frames are still captured in full.
  async R8(ctx) {
    need(ctx, 'R8', 'run');
    const { capture } = ctx.modules.run;
    const never = () => new Promise(() => {});
    const frame = (name, { evaluate = 'stall', content = 'stall' } = {}) => {
      const calls = { evaluate: 0, content: 0 };
      return {
        name, calls,
        url: () => `https://www.americanexpress.com/synthetic/${name}`,
        evaluate: async () => { calls.evaluate += 1; if (evaluate === 'throw') throw new Error('Execution context was destroyed, most likely because of a navigation.'); if (evaluate === 'stall') return never(); return { html: `<html><body>${name}</body></html>`, text: name }; },
        content: async () => { calls.content += 1; if (content === 'stall') return never(); return `<!-- content() --><html><body>${name}</body></html>`; }
      };
    };
    const pageOf = frames => ({ mainFrame: () => frames[0], frames: () => frames, screenshot: async () => '' });
    const sweep = async frames => { const started = Date.now(); const result = await keepAlive(() => capture(pageOf(frames), [])); return { result, elapsed: Date.now() - started }; };
    const indexed = (result, frames) => result.frames.length === frames.length && result.frames.every((f, i) => f.url === frames[i].url() && f.html === '' && f.text === '');
    const calls = frames => JSON.stringify(frames.map(f => ({ [f.name]: f.calls })));
    // A: three frames whose DOM step and content() fallback both stall.
    const a = [frame('a0'), frame('a1'), frame('a2')];
    const stalled = await sweep(a);
    tag('R8', 'stalled-frames', indexed(stalled.result, a), `frames ${JSON.stringify(stalled.result.frames)}`);
    tag('R8', 'stalled-elapsed', stalled.elapsed >= SWEEP_BUDGET_MS - 100 && stalled.elapsed < 3000, `the sweep of 3 stalled frames took ${stalled.elapsed} ms (one ${SWEEP_BUDGET_MS} ms total budget expected)`);
    tag('R8', 'stalled-no-more-work', a[0].calls.evaluate === 1 && a[0].calls.content === 0 && a.slice(1).every(f => f.calls.evaluate === 0 && f.calls.content === 0), `steps started ${calls(a)}`);
    // B: the main frame is detached (its DOM step throws at once) and its content() fallback stalls; a fast frame and a
    // stalled frame follow — both reached after exhaustion, both indexed, neither asked anything.
    const b = [frame('b0', { evaluate: 'throw', content: 'stall' }), frame('b1', { evaluate: 'fast', content: 'fast' }), frame('b2')];
    const detached = await sweep(b);
    tag('R8', 'detached-frames', indexed(detached.result, b), `frames ${JSON.stringify(detached.result.frames)}`);
    tag('R8', 'detached-elapsed', detached.elapsed >= SWEEP_BUDGET_MS - 100 && detached.elapsed < 3000, `the sweep with a stalled fallback took ${detached.elapsed} ms`);
    tag('R8', 'detached-no-more-work', b[0].calls.evaluate === 1 && b[0].calls.content === 1 && b.slice(1).every(f => f.calls.evaluate === 0 && f.calls.content === 0), `steps started ${calls(b)}`);
    // C: with time left every frame is captured — the DOM step, or content() when the DOM step throws.
    const c = [frame('c0', { evaluate: 'fast' }), frame('c1', { evaluate: 'throw', content: 'fast' })];
    const quick = await sweep(c);
    tag('R8', 'quick-frames', quick.result.frames.length === 2 && quick.result.frames[0].html === '<html><body>c0</body></html>' && quick.result.frames[0].text === 'c0' && quick.result.frames[1].html.startsWith('<!-- content() -->') && quick.result.frames[1].text === '', `frames ${JSON.stringify(quick.result.frames)}`);
    tag('R8', 'quick-elapsed', quick.elapsed < 1000, `the sweep of fast frames took ${quick.elapsed} ms`);
    return `one total sweep budget: 3 stalled frames in ${stalled.elapsed} ms, detached main + stalled fallback + 2 more in ${detached.elapsed} ms, every frame indexed, no step started after exhaustion; fast frames captured in ${quick.elapsed} ms`;
  },

  // R9 (review F4): --out is checked BEFORE the session — absent or empty, the rule stage() applies to --into — so a
  // folder that already holds a record, a file in place of the folder or an unusable path is refused without one
  // issuer contact and with what it found untouched; absent and empty folders are accepted and get the record.
  async R9(ctx) {
    need(ctx, 'R9', 'run', 'relay', 'drive', 'login');
    const dir = await tempDir('r9');
    let n = 0;
    const attempt = async out => {
      const fx = ctx.fake.fakeAmex({});
      const claimsDir = path.join(dir, `claims-${++n}`); await mkdir(claimsDir, { recursive: true });
      const transport = inProcessTransport({ run: ctx.modules.run.run, connect: fx.connect, root: path.join(dir, `root-${n}`) });
      const summary = [];
      let thrown = null, result = null;
      try { result = await ctx.modules.drive.runProbe({ stage: 'reach', account: ctx.fake.ACCOUNT, credentials: null, mailbox: contractMailbox(), claims: new ctx.modules.login.LoginClaims(claimsDir), transport, out, log: line => summary.push(line) }); }
      catch (error) {
        thrown = error;
        // A driver that threw AFTER opening a session (the moved-check defect) never sends the first line: close the
        // container's stdin so its run() settles (session_closed) instead of waiting on an empty stream forever.
        for (const session of transport.state.sessions) { try { if (!session.stdin.writableEnded) session.stdin.end(); } catch {} }
      }
      await Promise.all(transport.state.settled);
      return { thrown, result, summary, opens: transport.state.opens, fx };
    };
    try {
      const refusals = [
        { label: 'existing-result', setup: async out => { await mkdir(path.join(out, 'capture'), { recursive: true }); await writeFile(path.join(out, 'result.json'), '{"outcome":"attention","earlier":true}\n'); await writeFile(path.join(out, 'capture', 'main.html'), '<html>earlier</html>'); }, message: /must be empty/ },
        { label: 'capture-only', setup: async out => { await mkdir(path.join(out, 'capture'), { recursive: true }); await writeFile(path.join(out, 'capture', 'main.html'), '<html>earlier</html>'); }, message: /must be empty/ },
        { label: 'out-is-a-file', setup: async out => { await writeFile(out, 'not a folder\n'); }, message: /ENOTDIR|not a directory|must be empty/i },
        { label: 'parent-is-a-file', setup: async out => { await writeFile(path.dirname(out), 'not a folder\n'); }, message: /ENOTDIR|ENOENT|not a directory|no such file/i }
      ];
      const done = [];
      for (const c of refusals) {
        const outer = path.join(dir, c.label), out = c.label === 'parent-is-a-file' ? path.join(outer, 'file', 'out') : path.join(outer, 'out');
        await mkdir(outer, { recursive: true });
        await c.setup(out);
        const before = await snapshotFiles(outer);
        const run = await attempt(out);
        tag('R9', `${c.label}-refused`, run.thrown instanceof Error && c.message.test(run.thrown.message) && run.result === null, `expected a refusal, got ${run.thrown ? run.thrown.message : `outcome ${run.result?.record?.outcome}`}`);
        tag('R9', `${c.label}-no-session`, run.opens === 0 && run.fx.counts.connects === 0, `${run.opens} sessions opened, ${run.fx.counts.connects} connects`);
        const after = await snapshotFiles(outer);
        tag('R9', `${c.label}-untouched`, JSON.stringify(after) === JSON.stringify(before), `files under ${c.label} changed: ${JSON.stringify(after)} was ${JSON.stringify(before)}`);
        tag('R9', `${c.label}-no-summary`, run.summary.length === 0, `summary ${JSON.stringify(run.summary)}`);
        done.push(c.label);
      }
      for (const c of [{ label: 'absent', setup: async () => {} }, { label: 'empty', setup: async out => { await mkdir(out, { recursive: true }); } }]) {
        const out = path.join(dir, c.label, 'out');
        await mkdir(path.join(dir, c.label), { recursive: true });
        await c.setup(out);
        const run = await attempt(out);
        tag('R9', `${c.label}-accepted`, run.thrown === null && run.result?.record?.outcome === 'login_form_shown' && run.opens === 1, `thrown ${run.thrown?.message} outcome ${run.result?.record?.outcome} opens ${run.opens}`);
        const written = JSON.parse(await readFile(path.join(out, 'result.json'), 'utf8'));
        tag('R9', `${c.label}-record`, written.outcome === 'login_form_shown' && written.next === NEXT_EXPECTED.login_form_shown && existsSync(path.join(out, 'capture', 'screenshot.png')) && run.summary.length === 1, `record ${JSON.stringify(written).slice(0, 200)}`);
        done.push(c.label);
      }
      return `--out preflight: ${done.slice(0, 4).join(', ')} refused before any session with the folder untouched; absent and empty accepted with result.json`;
    } finally { await removeTemp(dir); }
  },

  // R10 (review F3): service_failure/runner_crash — an exception outside every named exit — in process through the
  // driver (the egress lookup throws) and at the standalone entrypoint (a copy of the runner whose collector
  // dependency cannot load): one result line, named, Chrome closed, the fallback `next`.
  async R10(ctx) {
    need(ctx, 'R10', 'run', 'relay', 'drive', 'login');
    const run = await driveProbe(ctx, { stage: 'reach', label: 'r10', transportOptions: { fetchIp: async () => { throw new Error('synthetic: the egress lookup threw'); } } });
    try {
      tag('R10', 'crash-outcome', run.record.outcome === 'service_failure' && run.record.reasonCode === 'runner_crash', `outcome ${run.record.outcome}/${run.record.reasonCode} (${run.record.reason})`);
      tag('R10', 'crash-reason', /synthetic: the egress lookup threw/.test(run.record.reason), `reason ${run.record.reason}`);
      tag('R10', 'crash-next', run.record.next === NEXT_EXPECTED.service_failure.runner_crash, `next ${JSON.stringify(run.record.next)}`);
      tag('R10', 'crash-browser-closed', run.fx.counts.closes === 1, `browser closed ${run.fx.counts.closes} times`);
      tag('R10', 'crash-one-result', run.transport.state.stdoutLines.filter(l => l.includes('"event":"result"')).length === 1 && resultLine(run.transport.state.stdoutLines).parsed.reasonCode === 'runner_crash', 'not exactly one result line naming runner_crash');
      const written = JSON.parse(await readFile(path.join(run.out, 'result.json'), 'utf8'));
      tag('R10', 'crash-file', written.outcome === 'service_failure' && written.reasonCode === 'runner_crash' && written.next === NEXT_EXPECTED.service_failure.runner_crash && 'tally' in written, 'result.json lacks the crash record');
      tag('R10', 'crash-summary', run.summary.length === 1 && run.summary[0] === `service_failure: ${NEXT_EXPECTED.service_failure.runner_crash}`, `summary ${JSON.stringify(run.summary)}`);
      tag('R10', 'crash-one-session', run.transport.state.opens === 1 && run.exitCode === 0, `${run.transport.state.opens} sessions, exit ${run.exitCode}`);
      tag('R10', 'crash-work-removed', !existsSync(path.join(run.root, 'work')), '/work was kept after the crash');
    } finally { await run.cleanup(); }
    const entry = await tempDir('r10-entry');
    try {
      const probeDir = path.join(entry, 'cloud-probe'); await mkdir(probeDir, { recursive: true });
      for (const name of ['run.mjs', 'relay.mjs']) { const original = path.join(ctx.probeDir, name); await writeFile(path.join(probeDir, name), relocateProbeSource(await readFile(original, 'utf8'), original, ctx.probeDir)); }
      const broken = path.join(entry, 'collector', 'node_modules', 'puppeteer-real-browser'); await mkdir(broken, { recursive: true });
      await writeFile(path.join(entry, 'collector', 'package.json'), '{ "name": "synthetic-collector", "private": true }\n');
      await writeFile(path.join(broken, 'package.json'), '{ "name": "puppeteer-real-browser", "main": "index.js" }\n');
      await writeFile(path.join(broken, 'index.js'), "throw new Error('synthetic broken dependency: puppeteer-real-browser cannot load');\n");
      const child = await childJson([path.join(probeDir, 'run.mjs')], { timeout: 60000 });
      const results = child.lines.filter(line => line.includes('"event":"result"'));
      tag('R10', 'entry-exit', child.code === 0, `entry child exit ${child.code}: ${String(child.stderr).slice(0, 300)}`);
      tag('R10', 'entry-result-line', results.length === 1 && child.lines.at(-1) === results[0], `result lines ${results.length}, stdout ${JSON.stringify(child.lines).slice(0, 300)}`);
      const parsed = JSON.parse(results[0]);
      tag('R10', 'entry-named', parsed.outcome === 'service_failure' && parsed.reasonCode === 'runner_crash' && /synthetic broken dependency/.test(parsed.reason) && parsed.stage === null, `entry result ${results[0].slice(0, 300)}`);
      tag('R10', 'entry-next', ctx.modules.drive.nextFor(parsed.outcome, parsed.reasonCode) === NEXT_EXPECTED.service_failure.runner_crash, 'the entry crash has no fallback next');
    } finally { await removeTemp(entry); }
    return 'runner_crash in process (egress lookup threw): named, one result line, Chrome closed, next = builder fix; standalone entrypoint with a broken collector dependency: exit 0, one result line, runner_crash';
  },

  // R11 (review F3): classify's issuer_unavailable arms beyond net::ERR_ — the navigation timeout text, a
  // chrome-error:// page and an HTTP 5xx navigation — each driven through run() with the fake page bent at the seam.
  async R11(ctx) {
    need(ctx, 'R11', 'run', 'relay');
    const cases = [
      { label: 'timeout', patch: fx => { fx.page.goto = async () => { throw new Error('Navigation timeout of 60000 ms exceeded'); }; }, reason: /Navigation timeout/ },
      { label: 'chrome-error', patch: fx => { fx.page.url = () => 'chrome-error://chromewebdata/'; fx.page.goto = async () => { throw new Error('Protocol error (Page.navigate): Target closed'); }; }, reason: /Target closed/ },
      { label: 'http-5xx', patch: fx => {
        let handler = null;
        fx.page.on = (event, fn) => { if (event === 'response') handler = fn; };
        const goto = fx.page.goto;
        fx.page.goto = async target => { const response = await goto(target); if (handler) handler({ request: () => ({ isNavigationRequest: () => true }), frame: () => fx.page.mainFrame(), status: () => 503 }); return response; };
        fx.page.evaluate = async () => { throw new Error('Protocol error (Runtime.callFunctionOn): Target closed'); };
      }, reason: /Target closed/ }
    ];
    const seen = [];
    for (const c of cases) {
      const run = await runContainer(ctx, { stage: 'reach', label: `r11-${c.label}`, scenario: { start: 'login' }, patch: c.patch });
      tag('R11', `${c.label}-outcome`, run.result.outcome === 'issuer_unavailable' && run.result.reasonCode === null, `outcome ${run.result.outcome}/${run.result.reasonCode} (${run.result.reason})`);
      tag('R11', `${c.label}-reason`, c.reason.test(run.result.reason), `reason ${run.result.reason}`);
      tag('R11', `${c.label}-capture`, Array.isArray(run.result.capture?.frames) && run.result.capture.frames.length === 2 && typeof run.result.capture.screenshot === 'string', 'no capture with the issuer_unavailable result');
      tag('R11', `${c.label}-one-result`, run.lines.filter(l => l.includes('"event":"result"')).length === 1, 'not exactly one result line');
      tag('R11', `${c.label}-closed`, run.fx.counts.closes === 1, `browser closed ${run.fx.counts.closes} times`);
      seen.push(`${c.label}:${run.result.outcome}`);
    }
    tag('R11', 'no-bot-verdict', seen.every(s => !s.includes('bot_rejected')), seen.join(','));
    return `issuer_unavailable via ${seen.join(', ')}`;
  },

  // R12 (review F3): the page vanished before the capture — mainFrame() and frames() throw — the attempt's outcome is
  // kept, the capture holds zero frames (recorded, never dropped: playbook §5 rule 3) and the driver writes the record.
  async R12(ctx) {
    need(ctx, 'R12', 'run', 'relay', 'drive', 'login');
    const gone = () => { throw new Error('Protocol error: Target closed'); };
    const run = await withFastClock(() => driveProbe(ctx, { stage: 'reach', label: 'r12', scenario: { start: 'unknown' }, patch: fx => { fx.page.mainFrame = gone; fx.page.frames = gone; } }));
    try {
      tag('R12', 'outcome', run.record.outcome === 'unknown_page' && run.record.reasonCode === null, `outcome ${run.record.outcome}/${run.record.reasonCode} (${run.record.reason})`);
      const result = resultLine(run.transport.state.stdoutLines).parsed;
      tag('R12', 'zero-frames', Array.isArray(result.capture?.frames) && result.capture.frames.length === 0, `capture ${JSON.stringify(result.capture).slice(0, 200)}`);
      tag('R12', 'record', run.record.capture?.frames === 0 && run.record.next === NEXT_EXPECTED.unknown_page && existsSync(path.join(run.out, 'result.json')), `record capture ${JSON.stringify(run.record.capture)} next ${run.record.next}`);
      tag('R12', 'no-frame-files', !existsSync(path.join(run.out, 'capture', 'main.html')), 'a frame file was written for a vanished page');
      tag('R12', 'closed', run.fx.counts.closes === 1 && run.transport.state.opens === 1, `closes ${run.fx.counts.closes}, sessions ${run.transport.state.opens}`);
      return 'vanished page: unknown_page kept, capture with zero frames, result.json written';
    } finally { await run.cleanup(); }
  },

  // R13 (review F3): stage() copies exactly the allowlist with a sha256 manifest; every Dockerfile COPY source and
  // railway.json's dockerfilePath exist in the staged tree; a non-empty target is refused and left untouched.
  async R13(ctx) {
    need(ctx, 'R13', 'drive');
    const dir = await tempDir('r13');
    try {
      const into = path.join(dir, 'staged');
      const manifest = await ctx.modules.drive.stage({ repoRoot: REPO_ROOT, into });
      const staged = (await filesUnder(into)).map(f => path.relative(into, f).split(path.sep).join('/')).sort();
      const listed = Object.keys(manifest.files).sort();
      tag('R13', 'manifest-lists-staged', JSON.stringify(listed) === JSON.stringify(staged.filter(f => f !== 'manifest.json')) && typeof manifest.stagedAt === 'string', `manifest ${JSON.stringify(listed)} vs staged ${JSON.stringify(staged)}`);
      const sources = { Dockerfile: 'cloud-probe/Dockerfile', 'railway.json': 'cloud-probe/railway.json' };
      for (const [to, hash] of Object.entries(manifest.files)) {
        const source = await readFile(path.join(REPO_ROOT, sources[to] || to)), copy = await readFile(path.join(into, to));
        tag('R13', `copy-${to}`, Buffer.compare(source, copy) === 0 && digest(source) === hash, `${to} differs from its source or its manifest hash`);
      }
      const written = JSON.parse(await readFile(path.join(into, 'manifest.json'), 'utf8'));
      tag('R13', 'manifest-file', JSON.stringify(written.files) === JSON.stringify(manifest.files), 'manifest.json differs from the returned manifest');
      const collectorModules = (await readdir(path.join(REPO_ROOT, 'collector'))).filter(name => name.endsWith('.mjs')).sort().map(name => `collector/${name}`);
      const expected = ['Dockerfile', 'railway.json', 'cloud-probe/run.mjs', 'cloud-probe/relay.mjs', 'cloud-probe/idle.mjs', 'collector/package.json', 'collector/package-lock.json', ...collectorModules, 'shared/amex.mjs'].sort();
      tag('R13', 'allowlist', JSON.stringify(listed) === JSON.stringify(expected), `staged ${JSON.stringify(listed)} expected ${JSON.stringify(expected)}`);
      tag('R13', 'nothing-private-staged', !staged.some(f => /\.env|node_modules|used-login-messages|\.omf-collector-browser|\.ps1$|\/test\//.test(f)), `staged ${JSON.stringify(staged)}`);
      const dockerfile = await readFile(path.join(into, 'Dockerfile'), 'utf8');
      const copies = dockerfile.split('\n').map(line => line.trim()).filter(line => /^COPY\s/.test(line)).map(line => line.split(/\s+/).slice(1));
      tag('R13', 'copy-lines', copies.length >= 4 && copies.every(tokens => tokens.length >= 2), `COPY lines ${JSON.stringify(copies)}`);
      for (const tokens of copies) for (const source of tokens.slice(0, -1)) {
        const pattern = new RegExp('^' + source.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
        tag('R13', 'dockerfile-copy', staged.some(f => pattern.test(f)), `Dockerfile COPY source ${source} is not in the staged tree ${JSON.stringify(staged)}`);
      }
      const railway = JSON.parse(await readFile(path.join(into, 'railway.json'), 'utf8'));
      tag('R13', 'railway-dockerfile', railway.build?.dockerfilePath === 'Dockerfile' && existsSync(path.join(into, 'Dockerfile')) && railway.deploy?.restartPolicyType === 'NEVER', `railway.json ${JSON.stringify(railway)}`);
      const before = await snapshotFiles(into);
      let refused = null;
      try { await ctx.modules.drive.stage({ repoRoot: REPO_ROOT, into }); } catch (error) { refused = error; }
      tag('R13', 'non-empty-refused', refused instanceof Error && /must be empty/.test(refused.message), `a second stage into the same folder was not refused: ${refused?.message}`);
      tag('R13', 'non-empty-untouched', JSON.stringify(await snapshotFiles(into)) === JSON.stringify(before), 'the refused stage changed the folder');
      return `staged ${listed.length} files = the allowlist, bytes and sha256 match the sources, every Dockerfile COPY source present, non-empty target refused untouched`;
    } finally { await removeTemp(dir); }
  }
};

function assertEvents(leg, events, expected) {
  const got = only(events, expected);
  tag(leg, 'events', JSON.stringify(got) === JSON.stringify(expected), `events ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
}

export async function runLegs(ctx, names = Object.keys(legs)) {
  const results = [];
  for (const name of names) {
    const started = Date.now();
    try { const message = await legs[name](ctx); results.push({ name, ok: true, message, ms: Date.now() - started }); }
    catch (error) { results.push({ name, ok: false, message: error?.message || String(error), ms: Date.now() - started }); }
  }
  return results;
}

// ── R6c child: the real collectStatement with only its external seams replaced ──
//   node --experimental-test-module-mocks --experimental-import-meta-resolve cloud-probe/test/probe.test.mjs
//     --collect-statement-child --dir <temp dir> --profile configured|default [--browser-file <collector/browser.mjs or a copy>]
// Prints one JSON line. The mocks are keyed by the URLs the collector's own imports resolve to; a copy of browser.mjs
// outside collector/ gets its two bare specifiers pointed at those URLs first (its relative imports were already made
// absolute by the fixture). The real LoginMailbox parses a synthetic account-login mail from the mocked Gmail client.
async function collectStatementChild(argv) {
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = flag('--dir'), mode = flag('--profile') || 'configured';
  if (!dir) throw new Error('--dir is required');
  const realBrowserFile = path.join(REPO_ROOT, 'collector', 'browser.mjs');
  const browserFile = flag('--browser-file') || realBrowserFile;
  const realBrowserUrl = pathToFileURL(realBrowserFile).href;
  const puppeteerUrl = import.meta.resolve('puppeteer-real-browser', realBrowserUrl);
  const googleUrl = import.meta.resolve('googleapis', pathToFileURL(path.join(REPO_ROOT, 'collector', 'mail.mjs')).href);
  const report = { harness: 'collect-statement', mode, events: [], stamps: {}, execFile: [], connect: [], google: { oauth: [], credentials: [], gmail: [], getProfile: 0, list: [], get: [] }, statuses: [], claimsAtTypeCode: null, claimsFinal: null, claimsElsewhere: [], manifestFile: false, result: null, error: null, fetch: 0, typed: null, counts: null, paths: null };
  const directory = path.join(dir, 'collector-dir'), configuredProfile = path.join(dir, 'configured-profile');
  const defaultProfile = path.join(directory, 'profiles', fake.ACCOUNT.primaryCard);
  report.paths = { directory, configuredProfile, defaultProfile };
  await mkdir(directory, { recursive: true });
  // Nothing may leave this process: fetch is a trap, the two process seams and the mail client are recorded fakes.
  globalThis.fetch = async () => { report.fetch += 1; throw new Error('network is forbidden in the collectStatement harness'); };
  const { mock } = await import('node:test');
  const execFileMock = (file, args, options, callback) => { (typeof options === 'function' ? options : callback)(new Error('collectStatement harness: the callback form of execFile is not expected')); };
  execFileMock[promisify.custom] = async (file, args, options) => { report.execFile.push({ file, args, options }); return { stdout: JSON.stringify({ matches: [], pids: [], unreadable: [] }) + '\n', stderr: '' }; };
  mock.module('node:child_process', { namedExports: { ...childProcess, execFile: execFileMock }, defaultExport: { ...childProcess, execFile: execFileMock } });
  const events = [];
  events.push = value => { if (!(value in report.stamps)) report.stamps[value] = Date.now(); return Array.prototype.push.call(events, value); };
  report.events = events;
  const fx = fake.fakeAmex({ events, onTypeCode: () => { try { report.claimsAtTypeCode = JSON.parse(readFileSync(path.join(directory, 'used-login-messages.json'), 'utf8')); } catch { report.claimsAtTypeCode = null; } } });
  mock.module(puppeteerUrl, { namedExports: { connect: async options => { report.connect.push(options); return { browser: fx.browser, page: fx.page }; } } });
  const mailbox = GMAIL_CONFIG.mailbox.toLowerCase();
  const loginMail = id => {
    const now = Date.now();
    const text = `マイアカウントの認証コードをお送りいたします。\nカード下5桁：${fake.ACCOUNT.primaryCard}\n認証コード\n${fake.MAIL_MATCH.code}\n`;
    return { id, internalDate: String(now), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'American Express <AmericanExpress@welcome.americanexpress.com>' }, { name: 'Subject', value: '［American Express］認証コードのお知らせ' }, { name: 'Date', value: new Date(now).toUTCString() }, { name: 'To', value: fake.ACCOUNT.otpRecipient }], body: { data: Buffer.from(text, 'utf8').toString('base64url') } } };
  };
  class OAuth2 { constructor(clientId, clientSecret) { report.google.oauth.push({ clientId, clientSecret }); } setCredentials(credentials) { report.google.credentials.push(credentials); } }
  const google = {
    auth: { OAuth2 },
    gmail: options => {
      report.google.gmail.push({ version: options?.version, authIsOAuth2: options?.auth instanceof OAuth2 });
      return { users: {
        getProfile: async () => { report.google.getProfile += 1; events.push('mail-verify'); return { data: { emailAddress: mailbox } }; },
        messages: {
          list: async params => { report.google.list.push({ userId: params.userId, q: params.q, maxResults: params.maxResults, at: Date.now() }); events.push('mail-list'); return { data: { messages: [{ id: fake.MAIL_MATCH.id }] } }; },
          get: async params => { report.google.get.push({ id: params.id, format: params.format }); events.push('mail-get'); return { data: loginMail(params.id) }; }
        }
      } };
    }
  };
  mock.module(googleUrl, { namedExports: { google } });
  let moduleFile = browserFile;
  if (path.resolve(browserFile) !== path.resolve(realBrowserFile)) {
    let text = await readFile(browserFile, 'utf8');
    for (const [find, replace] of [["from 'puppeteer-real-browser'", `from '${puppeteerUrl}'`], ['createRequire(import.meta.url)', `createRequire('${realBrowserUrl}')`]]) {
      const parts = text.split(find);
      if (parts.length !== 2) throw new Error(`collectStatement harness: ${find} found ${parts.length - 1} times in ${browserFile}`);
      text = parts.join(replace);
    }
    moduleFile = path.join(dir, 'browser.relocated.mjs');
    await writeFile(moduleFile, text);
  }
  const browser = await import(pathToFileURL(moduleFile).href);
  const settings = mode === 'configured' ? { ...fake.CREDENTIALS, profile: configuredProfile } : { ...fake.CREDENTIALS };
  const account = { ...fake.ACCOUNT, jobId: 'job-r6c' };
  const finish = async () => {
    try { report.claimsFinal = JSON.parse(await readFile(path.join(directory, 'used-login-messages.json'), 'utf8')); } catch { report.claimsFinal = null; }
    for (const candidate of [configuredProfile, defaultProfile, dir]) if (existsSync(path.join(candidate, 'used-login-messages.json'))) report.claimsElsewhere.push(candidate);
    report.manifestFile = existsSync(path.join(directory, 'outbox', account._id, account.jobId, 'manifest.json'));
    report.typed = { usernameMatches: fx.typed.username === fake.CREDENTIALS.username, passwordMatches: fx.typed.password === fake.CREDENTIALS.password, codeMatches: fx.typed.code === fake.MAIL_MATCH.code };
    report.counts = { password: fx.counts.password };
    await new Promise(resolve => process.stdout.write(JSON.stringify(report) + '\n', () => resolve(undefined)));
    process.exit(0);
  };
  // The real code's own attention signal ends the harness at once: after it ensureLogin only waits out its 300 s
  // deadline (login.mjs:119), and a wrapper that reached attention has already failed the leg.
  const status = async (state, text) => { report.statuses.push({ state, text }); if (state === 'verification_required') { report.error = `attention: ${text}`; await finish(); } };
  try {
    const result = await browser.collectStatement(account, settings, directory, status, { gmail: { ...GMAIL_CONFIG } });
    report.result = { directory: result.directory, manifest: result.manifest };
  } catch (error) { report.error = String((error && error.message) || error); }
  await finish();
}

if (process.argv.includes('--collect-statement-child')) {
  await collectStatementChild(process.argv.slice(2)).catch(error => { process.stderr.write(`${error?.stack || error}\n`); process.exit(1); });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { test } = await import('node:test');
  const ctx = await makeContext();
  const wanted = process.argv.slice(2);
  for (const name of Object.keys(legs)) if (!wanted.length || wanted.includes(name)) test(name, async () => { const message = await legs[name](ctx); assert.ok(message); console.log(`# ${name}: ${message}`); });
}

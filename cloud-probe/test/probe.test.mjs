// Legs R1-R7 of the Railway Amex probe (plan omf-railway-amex-probe-20261007, §4), with tagged assertions:
// every failure message starts with `[<leg>:<check>]`. The legs drive cloud-probe/run.mjs, relay.mjs and
// local/drive.mjs through an in-process stream pair in place of ssh, with the fake page of ./fake-amex.mjs
// in place of Chrome. No Chrome, no Gmail, no vault, no network. Synthetic data only.
//
//   node cloud-probe/test/probe.test.mjs [R1 R2 ...]   runs the legs under node:test
//   scripts/zoomer-fixtures/railway-amex-probe.mjs      runs them plus the collector suite and the defects
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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

// The fixed follow-up strings of plan §3, kept here independently of cloud-probe/local/drive.mjs (R7).
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
    row_count_mismatch: "owner compares the probe's pageCount with the Windows manifest; re-run only on go"
  }
};

// Plan S1: the exact Windows wiring after the split (whitespace-normalised lines).
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

/** @param {{ probeDir?: string, collectorDir?: string, browserSource?: string | null, referenceSource?: string | null }} [options] */
export async function makeContext({ probeDir = undefined, collectorDir = path.join(REPO_ROOT, 'collector'), browserSource = null, referenceSource = null } = {}) {
  const modules = await loadModules({ probeDir, collectorDir });
  const browserText = browserSource ?? await readFile(path.join(collectorDir, 'browser.mjs'), 'utf8');
  let referenceText = referenceSource;
  if (referenceText === null) {
    const { stdout } = await execute('git', ['-C', REPO_ROOT, 'show', `${REFERENCE_REVISION}:collector/browser.mjs`], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    referenceText = stdout;
  }
  return { modules, fake, collectorDir, browserSource: browserText, referenceSource: referenceText };
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
  const state = { opens: 0, stdinLines: [], stdoutLines: [], settled: [] };
  return {
    state,
    open() {
      state.opens += 1;
      const stdin = new PassThrough(), toContainer = new PassThrough(), fromContainer = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
      for (const stream of [stdin, toContainer, fromContainer, stdout, stderr]) stream.on('error', () => {});
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

// run() alone, no driver: the container's own lines (R2).
async function runContainer(ctx, { stage, scenario = {}, credentials = null, label }) {
  const dir = await tempDir(label);
  try {
    const fx = ctx.fake.fakeAmex(scenario);
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
/** @param {any} ctx @param {{ stage: string, scenario?: any, mailbox?: any, claims?: any, transportOptions?: any, preclaim?: boolean, onTypeCode?: any, label: string }} options */
async function driveProbe(ctx, { stage, scenario = {}, mailbox = undefined, claims = undefined, transportOptions = {}, preclaim = false, onTypeCode = null, label }) {
  const dir = await tempDir(label);
  const events = scenario.events || [];
  const claimsDir = path.join(dir, 'collector'); await mkdir(claimsDir, { recursive: true });
  const fx = ctx.fake.fakeAmex({ ...scenario, events, onTypeCode: onTypeCode ? () => onTypeCode({ claimsDir }) : scenario.onTypeCode });
  const realClaims = new ctx.modules.login.LoginClaims(claimsDir);
  if (preclaim) await realClaims.claim(fake.MAIL_MATCH.id);
  const claimsObject = claims === undefined ? wrapClaims(realClaims, events) : claims;
  const mailboxObject = mailbox === undefined ? contractMailbox() : mailbox;
  const root = path.join(dir, 'root'), out = path.join(dir, 'out');
  const transport = inProcessTransport({ run: ctx.modules.run.run, connect: fx.connect, root, ...transportOptions });
  const summary = [];
  const { record, exitCode } = await ctx.modules.drive.runProbe({ stage, account: ctx.fake.ACCOUNT, credentials: stage === 'collect' ? ctx.fake.CREDENTIALS : null, mailbox: mailboxObject, claims: claimsObject, transport, out, log: line => summary.push(line) });
  const settled = await Promise.all(transport.state.settled);
  return { record, exitCode, summary, transport, fx, events, dir, out, root, claimsDir, settled, cleanup: () => removeTemp(dir) };
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
    return `Windows wiring pinned to the planned text; body = 1f00be6d lines 77-122; collector suite ${pass} pass / 0 fail`;
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { test } = await import('node:test');
  const ctx = await makeContext();
  const wanted = process.argv.slice(2);
  for (const name of Object.keys(legs)) if (!wanted.length || wanted.includes(name)) test(name, async () => { const message = await legs[name](ctx); assert.ok(message); console.log(`# ${name}: ${message}`); });
}

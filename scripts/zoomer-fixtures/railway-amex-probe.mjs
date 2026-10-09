// Fixture for plan omf-railway-amex-probe-20261007 (§4), its review fold omf-railway-amex-review-fold-20261008
// (F2-F5), the startup fix omf-railway-startup-fix-20261008 (R14/D26), the execution-user fix
// omf-railway-user-fix-20261008 (R15/D27) and the cloud-only human-verification stop
// omf-amex-human-verification-20261009 (R17/R18, D29-D43). Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture railway-amex-probe.mjs --cwd <this worktree>
// No recorded case: it drives cloud-probe/run.mjs, relay.mjs and local/drive.mjs through an in-process stream
// pair in place of ssh with the fake page of cloud-probe/test/fake-amex.mjs, and the real collector/browser.mjs
// collectStatement in a child with its process, browser and mail seams mocked — no Chrome, PowerShell, Gmail,
// vault or network (R14 runs the installed chrome-launcher's prepare() on the runner's profile directory, never a
// Chrome process; R15 pins the driver's ssh command boundary with spawn replaced and assesses the evidence file of
// the MANUAL Linux acceptance cloud-probe/test/linux-execution.mjs only when OMF_LINUX_EXECUTION_EVIDENCE names
// one — that entry is never run from here). Legs R1-R18 (cloud-probe/test/probe.test.mjs; the collector suite
// inside R6a) and defects D1-D43, each built as a defective copy of the module it names (run.mjs, relay.mjs,
// local/drive.mjs under a temp cloud-probe/; collector/browser.mjs under a temp collector/ for the executed wrapper)
// and expected RED at the leg's tag.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const PROBE_DIR = path.join(REPO_ROOT, 'cloud-probe');
const BROWSER_FILE = path.join(REPO_ROOT, 'collector', 'browser.mjs');
const COPIED = ['run.mjs', 'relay.mjs', 'local/drive.mjs', 'Dockerfile'];

// Each defect: the module, the exact source anchor (must occur exactly once) and its replacement — or `edits`, several
// such pairs applied in order — and the leg that goes red. D1-D10 are the original plan's; D11-D25 the review fold's
// (F2 sweep budget, F4 output preflight, F3 branches, F5 the executed wrapper).
const DEFECTS = [
  { id: 'D1', what: 'password in a status line', file: 'run.mjs', leg: 'R3a', find: 'const status = async (state, text) => {', replace: "const status = async (state, text) => { output.write(JSON.stringify({ event: 'status', state: 'debug', text: 'typing ' + (credentials?.password ?? '') }) + '\\n');" },
  { id: 'D2', what: 'claim after type-code', file: 'relay.mjs', leg: 'R1', find: "claim: async id => { const answer = await this.request({ event: 'claim', id }, ['claimed', 'claim_failed']);", replace: "claim: async id => { const answer = { event: 'claimed' }; void this.request({ event: 'claim', id }, ['claimed', 'claim_failed']).catch(() => {});" },
  { id: 'D3', what: 'a second password after attention', file: 'run.mjs', leg: 'R4', find: 'const ending = await attempt();', replace: "let ending = await attempt(); if (ending.outcome === 'attention') { await page.goto('https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog', { waitUntil: 'domcontentloaded', timeout: 60000 }); ending = await attempt(); }" },
  { id: 'D4', what: 'unknown page named bot_rejected', file: 'run.mjs', leg: 'R2', find: "outcome: state?.kind === 'login' ? 'login_form_shown' : 'unknown_page'", replace: "outcome: state?.kind === 'login' ? 'login_form_shown' : 'bot_rejected'" },
  { id: 'D5', what: 'CSV bytes echoed in the result', file: 'run.mjs', leg: 'R3a', find: 'manifest: collected.manifest', replace: "manifest: collected.manifest, csv: (await import('node:fs')).readFileSync(collected.directory + '/' + collected.manifest.filename, 'utf8')" },
  { id: 'D6', what: '/run/omf kept', file: 'run.mjs', leg: 'R1', find: "for (const name of ['profile', 'download', 'work']) await rm(", replace: 'for (const name of []) await rm(' },
  { id: 'D7', what: 'a screenshot taken in collect', file: 'run.mjs', leg: 'R3b', find: "{ screenshot: stage === 'reach' }", replace: '{ screenshot: true }' },
  { id: 'D8', what: 'scrub skipped for frame text', file: 'run.mjs', leg: 'R3b', find: 'text: scrub(text, secrets)', replace: 'text: text' },
  { id: 'D9', what: 'next missing for attention', file: 'local/drive.mjs', leg: 'R7', find: "  attention: '", replace: "  attention_removed: '" },
  { id: 'D10', what: 'LoginClaims built from settings.profile instead of directory (text pin)', file: 'collector/browser.mjs', leg: 'R6a', find: 'claims: new LoginClaims(directory) });', replace: 'claims: new LoginClaims(settings.profile) });' },
  // F2 — one total sweep budget
  { id: 'D11', what: 'per-frame capture budget restored', file: 'run.mjs', leg: 'R8', find: 'const remaining = () => Math.max(0, deadline - performance.now());', replace: 'const remaining = () => FRAME_SWEEP_BUDGET_MS;' },
  // F4 — the --out preflight
  { id: 'D12', what: 'non-empty --out accepted', file: 'local/drive.mjs', leg: 'R9', find: "if (occupied.length) throw new Error('The output directory must be empty');", replace: 'if (occupied.length) void 0;' },
  { id: 'D13', what: '--out checked after the session opened', file: 'local/drive.mjs', leg: 'R9', edits: [
    { find: "  if (occupied.length) throw new Error('The output directory must be empty');", replace: '' },
    { find: '  const session = transport.open();', replace: "  const session = transport.open();\n  if (occupied.length) throw new Error('The output directory must be empty');" }
  ] },
  // F3 — runner_crash, its follow-up, the entrypoint catch
  { id: 'D14', what: 'runner_crash left unnamed', file: 'run.mjs', leg: 'R10', find: "(error && error.reasonCode) || 'runner_crash'", replace: '(error && error.reasonCode) || null' },
  { id: 'D15', what: 'fallback next removed for an unlisted reasonCode', file: 'local/drive.mjs', leg: 'R10', find: 'return NEXT.service_failure[reasonCode] ?? BUILDER_FIX;', replace: 'return NEXT.service_failure[reasonCode];' },
  { id: 'D16', what: 'entrypoint crash exits without a result line', file: 'run.mjs', leg: 'R10', find: "try { process.stdout.write(JSON.stringify({ event: 'result', stage: null, outcome: 'service_failure', reasonCode: 'runner_crash', reason: message(error).slice(0, 300) }) + '\\n'); } catch {}", replace: '' },
  // F3 — issuer_unavailable arms
  { id: 'D17', what: 'navigation timeout text not issuer_unavailable', file: 'run.mjs', leg: 'R11', find: '/net::ERR_|Navigation timeout|chrome-error:\\/\\//.test(text)', replace: '/net::ERR_|chrome-error:\\/\\//.test(text)' },
  { id: 'D18', what: 'chrome-error URL not issuer_unavailable', file: 'run.mjs', leg: 'R11', find: ' || /^chrome-error:\\/\\//.test(safeUrl(page))', replace: '' },
  { id: 'D19', what: 'HTTP 5xx navigation not issuer_unavailable', file: 'run.mjs', leg: 'R11', find: ' || ((navigation && navigation.status) || 0) >= 500', replace: '' },
  // F3 — vanished page
  { id: 'D20', what: 'a vanished page breaks the capture', file: 'run.mjs', leg: 'R12', find: 'try { const main = page.mainFrame(); list = [main, ...page.frames().filter(frame => frame !== main)]; } catch { list = []; }', replace: '{ const main = page.mainFrame(); list = [main, ...page.frames().filter(frame => frame !== main)]; }' },
  // F3 — staging
  { id: 'D21', what: 'shared/amex.mjs dropped from the upload allowlist', file: 'local/drive.mjs', leg: 'R13', find: "{ from: 'shared/amex.mjs' }", replace: '' },
  { id: 'D22', what: 'manifest hashes not the file bytes', file: 'local/drive.mjs', leg: 'R13', find: "files[to] = createHash('sha256').update(await readFile(source)).digest('hex');", replace: "files[to] = createHash('sha256').update(to).digest('hex');" },
  // F5 — the executed wrapper (collector/browser.mjs copies run by R6c's child)
  { id: 'D23', what: 'LoginClaims built from settings.profile instead of directory (executed)', file: 'collector/browser.mjs', leg: 'R6c', find: 'claims: new LoginClaims(directory) });', replace: 'claims: new LoginClaims(settings.profile) });' },
  { id: 'D24', what: 'Gmail connection not wired into the mailbox', file: 'collector/browser.mjs', leg: 'R6c', find: 'mailbox: gmail ? new LoginMailbox(gmail) : null', replace: 'mailbox: null' },
  { id: 'D25', what: 'configured profile ignored', file: 'collector/browser.mjs', leg: 'R6c', find: "const profile = settings.profile || path.join(directory, 'profiles', account.primaryCard);", replace: "const profile = path.join(directory, 'profiles', account.primaryCard);" },
  // omf-railway-startup-fix-20261008 — the profile directory created before connect (the 2026-10-08 live ENOENT)
  { id: 'D26', what: 'profile directory not created before connect', file: 'run.mjs', leg: 'R14', find: "await mkdir(path.join(root, 'profile'), { recursive: true });", replace: '' },
  // omf-railway-user-fix-20261008 — the privilege switch removed: the runner inherits the ssh session's root again
  { id: 'D27', what: 'privilege switch removed from the container command (root runner)', file: 'local/drive.mjs', leg: 'R15', find: "export const CONTAINER_COMMAND = 'exec /usr/bin/setpriv --reuid=10001 --regid=10001 --clear-groups --no-new-privs node /app/cloud-probe/run.mjs';", replace: "export const CONTAINER_COMMAND = 'node /app/cloud-probe/run.mjs';" },
  { id: 'D28', what: 'init reaper removed from container entrypoint', file: 'Dockerfile', leg: 'R16', find: 'ENTRYPOINT ["/usr/bin/tini", "--", "node", "cloud-probe/idle.mjs"]', replace: 'ENTRYPOINT ["node", "cloud-probe/idle.mjs"]' },
  // omf-amex-human-verification-20261009 — the cloud-only stop at a visible reCAPTCHA (the 2026-10-08 five-minute wait)
  { id: 'D29', what: 'the cloud adapter not passed to collectFromPage (the fix absent: loginUi alone, the five-minute wait)', file: 'run.mjs', leg: 'R17', find: 'claims: relay.claims(), ui });', replace: 'claims: relay.claims() });' },
  { id: 'D30', what: 'challenge check removed from the adapter', file: 'run.mjs', leg: 'R17', find: 'if (challengeSurface() && await page.evaluate(visibleChallenge)) return { kind: HUMAN_VERIFICATION };', replace: '' },
  { id: 'D31', what: 'challenge check reordered behind the login controls (a mounted form wins over the visible challenge)', file: 'run.mjs', leg: 'R17', find: 'if (challengeSurface() && await page.evaluate(visibleChallenge)) return { kind: HUMAN_VERIFICATION };', replace: "const current = await base.state(); if (current.kind === 'login') return current; if (challengeSurface() && await page.evaluate(visibleChallenge)) return { kind: HUMAN_VERIFICATION };" },
  { id: 'D32', what: 'a container without a layout box treated as a visible challenge', file: 'run.mjs', leg: 'R18', find: 'if (!(rect.width > 0 && rect.height > 0)) return false;', replace: '' },
  { id: 'D33', what: 'a container hidden by CSS treated as a visible challenge', file: 'run.mjs', leg: 'R18', find: "return typeof container.checkVisibility !== 'function' || container.checkVisibility({ visibilityProperty: true, opacityProperty: true });", replace: 'return true;' },
  { id: 'D34', what: 'secrets left in the challenge capture', file: 'run.mjs', leg: 'R17', find: "fields.capture = await capture(page, secrets, { screenshot: stage === 'reach' });", replace: "fields.capture = await capture(page, ending.reasonCode === HUMAN_VERIFICATION_REQUIRED ? [] : secrets, { screenshot: stage === 'reach' });" },
  { id: 'D35', what: 'the login named in the reason, the reason no longer scrubbed', file: 'run.mjs', leg: 'R17', edits: [
    { find: "for (const key of ['reason', 'url', 'pageKind']) result[key] = result[key] == null ? null : scrub(result[key], secrets);", replace: "for (const key of ['url', 'pageKind']) result[key] = result[key] == null ? null : scrub(result[key], secrets);" },
    { find: '} catch (error) { return { ...classify(error, page, session.navigation), reason: message(error) }; }', replace: "} catch (error) { return { ...classify(error, page, session.navigation), reason: message(error) + ' (login ' + (credentials ? credentials.username : '') + ')' }; }" }
  ] },
  { id: 'D36', what: 'a retry after the challenge', file: 'run.mjs', leg: 'R17', find: 'const ending = await attempt();', replace: "let ending = await attempt(); if (ending.reasonCode === HUMAN_VERIFICATION_REQUIRED) { await page.goto('https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog', { waitUntil: 'domcontentloaded', timeout: 60000 }); ending = await attempt(); }" },
  { id: 'D37', what: 'any surface accepted as the challenge surface (unrelated path/origin)', file: 'run.mjs', leg: 'R18', find: 'const challengeSurface = () => onSurface(page, WWW, LOGIN_PATH) || onSurface(page, WWW, VERIFY_PATH);', replace: 'const challengeSurface = () => true;' },
  { id: 'D38', what: 'the Windows wrapper takes and forwards a ui option (text pin)', file: 'collector/browser.mjs', leg: 'R6a', edits: [
    { find: 'export async function collectStatement(account, settings, directory, status, { gmail } = {}) {', replace: 'export async function collectStatement(account, settings, directory, status, { gmail, ui } = {}) {' },
    { find: 'claims: new LoginClaims(directory) });', replace: 'claims: new LoginClaims(directory), ui });' }
  ] },
  { id: 'D39', what: 'a null ui default leaks from the Windows wrapper into ensureLogin (executed)', file: 'collector/browser.mjs', leg: 'R6c', find: '{ mailbox = null, claims = null, ui } = {}) {', replace: '{ mailbox = null, claims = null, ui = null } = {}) {' },
  { id: 'D40', what: 'next missing for human_verification_required', file: 'local/drive.mjs', leg: 'R17', find: "  human_verification_required: '", replace: "  human_verification_removed: '" },
  { id: 'D41', what: 'human verification classified as service_failure', file: 'run.mjs', leg: 'R17', find: "if (error && error.reasonCode === HUMAN_VERIFICATION_REQUIRED) return { outcome: 'attention', reasonCode: HUMAN_VERIFICATION_REQUIRED };", replace: '' },
  { id: 'D42', what: 'terminal pageKind read by loginUi instead of the one detector', file: 'run.mjs', leg: 'R17', find: 'const state = await withBudget(cloudLoginUi(page).detect(), 5000);', replace: 'const state = await withBudget(loginUi(page).state(), 5000);' },
  { id: 'D43', what: 'verification_required status not emitted before the stop', file: 'run.mjs', leg: 'R17', find: "if (status) await status('verification_required', HUMAN_VERIFICATION_STATUS);", replace: '' }
];

function mutate(source, defect) {
  let text = source;
  for (const { find, replace } of defect.edits || [{ find: defect.find, replace: defect.replace }]) {
    const parts = text.split(find);
    if (parts.length !== 2) throw new Error(`${defect.id}: anchor found ${parts.length - 1} times in ${defect.file} (expected exactly once)`);
    text = parts.join(replace);
  }
  return text;
}

// Relative imports into collector/ and shared/ become absolute file URLs; siblings copied beside stay relative.
function relocate(source, originalFile) {
  return source.replace(/(from\s+|import\()\s*'(\.{1,2}\/[^']+)'/g, (match, prefix, spec) => {
    const target = path.resolve(path.dirname(originalFile), spec);
    if (target.startsWith(PROBE_DIR + path.sep)) return match;
    return `${prefix}'${pathToFileURL(target).href}'`;
  });
}

async function defectiveProbeDir(defect, base) {
  const dir = path.join(base, defect.id, 'cloud-probe');
  for (const name of COPIED) {
    const original = path.join(PROBE_DIR, name);
    let source = await readFile(original, 'utf8');
    if (name === defect.file) source = mutate(source, defect);
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), relocate(source, original));
  }
  return dir;
}

// The executed-wrapper defects: a copy of collector/browser.mjs under a temp collector/ with its relative imports made
// absolute here; the R6c child points its two bare specifiers at the collector's own installed packages.
async function defectiveBrowserFile(defect, base, source) {
  const file = path.join(base, defect.id, 'collector', 'browser.mjs');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, relocate(source, BROWSER_FILE));
  return file;
}

export default {
  name: 'railway-amex-probe',
  covers: ['collector/browser.mjs', 'cloud-probe/run.mjs', 'cloud-probe/relay.mjs', 'cloud-probe/local/drive.mjs', 'cloud-probe/idle.mjs', 'cloud-probe/Dockerfile', 'cloud-probe/railway.json', 'cloud-probe/test/fake-amex.mjs', 'cloud-probe/test/probe.test.mjs', 'cloud-probe/test/linux-execution.mjs'],
  async run() {
    const started = Date.now();
    let suite;
    try { suite = await import(pathToFileURL(path.join(PROBE_DIR, 'test', 'probe.test.mjs')).href); }
    catch (error) { return { pass: false, message: `legs R1-R18 red: cloud-probe/test/probe.test.mjs could not be loaded: ${error?.message || error}` }; }
    const lines = [];
    let pass = true;
    let ctx;
    try { ctx = await suite.makeContext(); }
    catch (error) { return { pass: false, message: `legs R1-R18 red: context could not be built: ${error?.message || error}` }; }
    for (const [name, error] of Object.entries(ctx.modules.errors)) lines.push(`module ${name} not loadable (${error})`);
    const legs = await suite.runLegs(ctx);
    for (const leg of legs) { if (!leg.ok) pass = false; lines.push(`${leg.name} ${leg.ok ? 'ok' : 'RED'} (${Math.round(leg.ms / 1000)}s): ${leg.message}`); }
    if (!pass) return { pass: false, message: `legs red; defects not attempted — ${lines.join(' · ')}` };

    const base = await mkdtemp(path.join(os.tmpdir(), 'omf-probe-defects-'));
    try {
      for (const defect of DEFECTS) {
        let caught = null;
        try {
          let ctx2;
          if (defect.file === 'collector/browser.mjs') { const browserSource = mutate(ctx.browserSource, defect); ctx2 = { ...ctx, browserSource, browserFile: await defectiveBrowserFile(defect, base, browserSource) }; }
          else ctx2 = await suite.makeContext({ probeDir: await defectiveProbeDir(defect, base), browserSource: ctx.browserSource, referenceSource: ctx.referenceSource });
          const [result] = await suite.runLegs(ctx2, [defect.leg]);
          caught = result.ok ? null : result.message;
        } catch (error) { pass = false; lines.push(`${defect.id} (${defect.what}) could not be built: ${error?.message || error}`); continue; }
        const red = typeof caught === 'string' && caught.startsWith(`[${defect.leg}:`);
        if (!red) pass = false;
        lines.push(`${defect.id} (${defect.what}) ${red ? 'red at ' + caught.slice(0, caught.indexOf(']') + 1) : 'NOT CAUGHT: ' + (caught || defect.leg + ' stayed green')}`);
      }
    } finally {
      if (path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(base, { recursive: true, force: true });
    }
    return { pass, message: `${pass ? 'legs R1-R18 green and D1-D43 red' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

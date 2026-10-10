// Fixture for plan omf-customer-connect-20261010 (customer-connect/plan.json): the one-sign-in Connect flow of the
// statement downloader. Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture collector-connect.mjs --cwd <this worktree>
// Two planned acceptance scripts run as children of this fixture, each on its own ephemeral MongoDB, synthetic users and
// temporary directories, with every bank/mail/browser request intercepted and no .env load:
//   1. scripts/collector-security-integration.ts — isolated Mongo service legs: token-less request, fresh password/MFA,
//      request-scoped proof, approval bindings, prepare/create/approve/exchange/ack retries, cancel/expire/revoke, and each
//      binding check removed in turn (mutant copy) to prove the leg catches it; the legacy enroll/pair/batch/reset legs stay.
//   2. scripts/collector-trusted-device-http.ts — the built HTTPS app (build OMF first) behind a TLS proxy, the real Windows
//      collector with real DPAPI and the real owner broker, isolated Chrome driving the public /collector-connect page, the
//      loopback callback, lost-response and process-crash resume, silent restart and OMF-side disconnect; the retained
//      remembered-PC legs stay.
// Fail-first on 5d42400: no /api/finance/collector-connect route (404) and no connect service; both children report the
// missing behaviour as a named red leg, not an import or runner failure. `covers` is decided at load (the verifier reads it
// before run()): the built HTTPS leg's files are listed only when .output/server/index.mjs exists, so a worktree without the
// build claims no HTTP coverage; a leg that then fails to run fails the fixture, and nothing skipped is reported as passed.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const SERVICE_COVERS = ['server/services/financeCollectorConnectService.ts', 'server/services/financeCollectorSecurityService.ts', 'server/services/financeService.ts', 'server/services/authService.ts', 'server/models/FinanceCollectorConnect.ts', 'server/models/FinanceCollectorSecurity.ts', 'collector/vault.mjs', 'scripts/collector-security-integration.ts'];
const HTTP_COVERS = ['server/api/finance/collector-connect/[...path].ts', 'server/api/finance/collector-security/[...path].ts', 'pages/collector-connect.vue', 'pages/collector-approval.vue', 'utils/auth-session.ts', 'collector/index.mjs', 'collector/omf-authorization.mjs', 'collector/vault.mjs', 'collector/run.mjs', 'collector/setup.html', 'collector/setup.js', 'collector/windows/key-broker.ps1', 'collector/windows/private-acl.ps1', 'scripts/collector-trusted-device-http.ts'];

function runScript(script, env) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, ['--import', 'tsx', script], { cwd: REPO_ROOT, windowsHide: true, timeout: 840000, maxBuffer: 8 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || '');
      const lines = text.split(/\r?\n/);
      const passes = lines.filter(line => line.startsWith('PASS ')).map(line => line.slice(5));
      const reds = lines.filter(line => line.startsWith('FAIL ')).map(line => line.slice(5));
      let receipt = null;
      try { receipt = JSON.parse(lines.find(line => line.startsWith('{"pass":')) || 'null'); } catch { receipt = null; }
      // The HTTP script prints its assertion first, then the app and collector logs; keep the assertion, not the logs.
      const failure = String(stderr || '').split('App tail:')[0].trim();
      resolve({ script, ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, passes, reds, receipt, tail: failure.slice(0, 1200) || String(stderr || '').slice(-1200) || text.slice(-1200) });
    });
  });
}

export default {
  name: 'collector-connect',
  covers: BUILT ? [...new Set([...SERVICE_COVERS, ...HTTP_COVERS])] : SERVICE_COVERS,
  async run() {
    const started = Date.now();
    if (process.platform !== 'win32') return { pass: false, message: 'the Windows collector and its DPAPI/owner-broker legs can only be exercised on Windows' };
    const env = { ...process.env };
    const lines = [];
    let pass = true;
    if (!BUILT) { pass = false; lines.push('built HTTPS leg NOT RUN: .output/server/index.mjs is missing (run `nuxt build` in this worktree first); no HTTP coverage claimed'); }
    const [service, http] = await Promise.all([
      runScript('scripts/collector-security-integration.ts', env),
      BUILT ? runScript('scripts/collector-trusted-device-http.ts', env) : Promise.resolve(null)
    ]);
    const judge = (label, result) => {
      if (!result) return;
      const ok = result.code === 0 && result.receipt?.pass === true && result.receipt.checks === result.passes.length && result.reds.length === 0;
      if (!ok) pass = false;
      lines.push(`${label}: ${ok ? `${result.passes.length} legs green` : `RED (exit ${result.killed ? 'timeout' : result.code}, ${result.passes.length} green, ${result.reds.length} named red)`} in ${Math.round(result.ms / 1000)}s`);
      for (const red of result.reds) lines.push(`${label} red: ${red.slice(0, 300)}`);
      if (!ok && !result.reds.length) lines.push(`${label} tail: ${(result.tail || 'no output').replace(/\s+/g, ' ').slice(-900)}`);
      if (ok) for (const name of result.passes) lines.push(`${label} ok: ${name}`);
    };
    judge('isolated Mongo service legs', service);
    judge('built HTTPS/native legs', http);
    return { pass, message: `${pass ? 'connect flow green on both legs' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

// Fixture for plan omf-role-writes-20261101 (5-plan.json): role split step 2 — a 閲覧のみ member only reads (every non-read /api
// request answers 403 before its handler, own-account writes excepted, role read fresh), a 一般 member keeps day-to-day writes and is
// refused the three ledger registrations (銀行仕訳 register, company-commit, Navi post_selected_approved_rows) with the registrar
// message; 経理担当/管理者/オーナー register; recovery carries the role reason; omft_/omfc_ tokens untouched; labels 閲覧のみ / 열람 전용.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture scripts/zoomer-fixtures/omf-role-writes.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-role-writes-integration.cjs on its own disposable MongoDB and server process, installed
// Chrome headless for R9 when present; NOT RUN and red when .output/server/index.mjs is missing) · 2 an unchanged packaged copy of
// the build must pass · 3 the nine named defects m1-m9 of plan §4, each reintroduced into an isolated copy of the compiled output,
// must make the integration fail with the leg named. No model, provider, network send or ambient database: every database address
// is a closed sentinel and the integration owns its in-memory MongoDB. `covers` is decided at load: built-app files are listed only
// when the build exists. Fail-first on 4ad3703: leg 1 is the behavioural failure (a viewer POST answers 200, a 一般 member registers,
// ja.json says 閲覧者); legs 2-3 are NOT RUN until leg 1 is green.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const SCRIPT_COVERS = ['scripts/finance-role-writes-integration.cjs', 'scripts/zoomer-fixtures/omf-role-writes.mjs'];
const APP_COVERS = ['server/middleware/viewerReadOnly.ts', 'server/utils/ledgerRegistrarAccess.ts', 'server/utils/calendarAccess.ts', 'server/api/finance-payments/[...path].ts', 'server/api/finance/[...path].ts', 'server/services/financeNaviPostingService.ts', 'server/services/financeActionService.ts', 'components/intake/BankClassificationReview.vue', 'i18n/locales/ja.json', 'i18n/locales/ko.json', 'utils/session-fetch.ts', 'plugins/session.client.ts', 'components/common/ViewerRefusalNotice.vue', 'layouts/default.vue'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
const chrome = [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(existsSync);

// Each defect (plan §4 m1-m9): a whitespace-tolerant anchor in the compiled server chunks (matched at least once; replaced wherever it
// occurs, since a util may be inlined into each importer), its replacement, and the `role-writes:` assertion the integration must then
// fail with.
export const DEFECTS = [
  { name: 'm1-viewer-never-matched', anchor: /!==\s*["']viewer["']\)\s*return;/g, replacement: '!== "nobody") return;', expect: /role-writes:R2-/ },
  { name: 'm2-own-account-list-emptied', anchor: /function ownAccountPath(\$\d+)?\(path, method\) \{/g, replacement: 'function ownAccountPath(path, method) { return false;', expect: /role-writes:R3-/ },
  { name: 'm3-read-set-gains-post', anchor: /\[\s*["']GET["'],\s*["']HEAD["'],\s*["']OPTIONS["']\s*\]/g, replacement: '["GET", "HEAD", "OPTIONS", "POST"]', expect: /role-writes:R2-/ },
  { name: 'm4-seed-exemption-removed', anchor: /&&\s*path !==\s*["']\/api\/seed["']/g, replacement: '&& true', expect: /role-writes:R2-seed/ },
  { name: 'm5-register-gate-removed', anchor: /await requireLedgerRegistrar(\$\d+)?\(\s*ownerId,\s*classificationCompany\s*\);?/g, replacement: '', expect: /role-writes:R5-register/ },
  { name: 'm6-company-commit-gate-removed', anchor: /await requireLedgerRegistrar(\$\d+)?\(\s*ownerId,\s*organizationId\s*\);?/g, replacement: '', expect: /role-writes:R5-company-commit/ },
  { name: 'm7-navi-post-gate-removed', anchor: /await requireLedgerRegistrar(\$\d+)?\(\s*String\(ownerId\),\s*String\(frozen\.organizationId\)\s*\);?/g, replacement: '', expect: /role-writes:R5-navi-post/ },
  { name: 'm8-member-becomes-registrar', anchor: /LEDGER_REGISTRAR_ROLES(\$\d+)? = \[\s*["']owner["'],\s*["']admin["'],\s*["']accountant["']\s*\]/g, replacement: 'LEDGER_REGISTRAR_ROLES = ["owner", "admin", "accountant", "member"]', expect: /role-writes:R5-(register|company-commit|navi-post)/ },
  { name: 'm9-recovery-reason-reverted', anchor: /unresolvedPost\(\s*\(?\s*error\s*==\s*null\s*\?\s*void 0\s*:\s*\(?\s*\(?_?[a-z]?\s*=?\s*error\.data\)?\s*==\s*null\s*\?\s*void 0\s*:\s*_?[a-z]?\.message\)?\s*\|\|\s*NOT_POSTING_MEMBER\s*\)|unresolvedPost\(\s*error\?\.data\?\.message\s*\|\|\s*NOT_POSTING_MEMBER\s*\)/g, replacement: 'unresolvedPost(NOT_POSTING_MEMBER)', expect: /role-writes:R7-recovery-message/ }
];

function run(appRoot, { mutant = false, timeout = 900000 } = {}) {
  const env = { ...process.env, OMF_ROLE_WRITES_FIXTURE: 'owned', OMF_ROLE_WRITES_APP_ROOT: appRoot, OMF_ROLE_WRITES_MUTANT: mutant ? '1' : '', OMF_ROLE_BROWSER: mutant ? '' : (process.env.OMF_ROLE_BROWSER ?? (chrome ? '1' : '')), ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OMF_GMAIL_CLIENT_ID', 'OMF_GMAIL_CLIENT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(appRoot, 'scripts', 'finance-role-writes-integration.cjs')], { cwd: appRoot, env, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)), probes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PROBE')) });
    });
  });
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /role-writes:|AssertionError|Error|SETUP|PROBE-FAIL/.test(l)).slice(0, 8).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 1200);
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyDefect(outputDir, defect) {
  const touched = [];
  for (const file of await chunkFiles(path.join(outputDir, 'server', 'chunks'))) { const text = await readFile(file, 'utf8'); if (!(text.match(defect.anchor) || []).length) continue; await writeFile(file, text.replace(defect.anchor, defect.replacement)); touched.push(path.relative(outputDir, file)); }
  if (!touched.length) throw new Error(`SETUP: defect ${defect.name}: anchor matched no compiled chunk`);
  return touched;
}

export default {
  name: 'omf-role-writes',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null;
    const defects = [];
    // 1 positive: the built app on its own owned database.
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root);
      const done = positive.text.match(/(\d+) role writes groups passed/);
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length !== 10) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length} groups green, probes [${positive.probes.join(' ; ')}]: ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} groups in ${Math.round(positive.ms / 1000)}s; probes [${positive.probes.join(' ; ')}])`);
    }
    // 2-3 packaged copy control and named compiled defects, only when leg 1 is green.
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'role-writes-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
        await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true, dereference: true });
        await cp(path.join(root, 'i18n', 'locales'), path.join(directory, 'i18n', 'locales'), { recursive: true, dereference: true });
        await mkdir(path.join(directory, 'scripts'), { recursive: true });
        await cp(path.join(root, 'scripts', 'finance-role-writes-integration.cjs'), path.join(directory, 'scripts', 'finance-role-writes-integration.cjs'));
        const chunks = await chunkFiles(path.join(directory, '.output', 'server', 'chunks')), originals = new Map(await Promise.all(chunks.map(async f => [f, await readFile(f, 'utf8')])));
        const reset = () => Promise.all([...originals].map(([f, t]) => writeFile(f, t)));
        control = await run(directory, { mutant: true });
        const controlOk = control.code === 0 && control.passes.length === positive.passes.length;
        lines.push(`2 unchanged packaged copy: ${controlOk ? 'ok' : 'RED — ' + tail(control)}`);
        if (!controlOk) pass = false;
        else for (const defect of DEFECTS) {
          try {
            const touched = await applyDefect(path.join(directory, '.output'), defect);
            const r = await run(directory, { mutant: true }), detected = r.code !== 0 && defect.expect.test(r.text) && !/SETUP/.test(r.text);
            defects.push({ name: defect.name, touched, detected, exit: r.code, tail: tail(r) });
            if (!detected) pass = false;
          } catch (error) { defects.push({ name: defect.name, detected: false, setupError: String(error.message).slice(0, 300) }); pass = false; }
          finally { await reset(); }
        }
        lines.push(`3 defects: ${defects.map(d => d.name + ':' + (d.detected ? 'detected' : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — ' + d.tail))).join(' · ')}`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('2-3 control and defects: NOT RUN — leg 1 is not green, defects prove nothing');
    pass = pass && !!control && defects.length === DEFECTS.length && defects.every(d => d.detected);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'role writes green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · limits: synthetic owned native HTTP/worker evidence with simulated worker replies and installed Chrome headless when present; no model draw, no production row (scope-only plan: the real-row replay is omf-role-writes-replay); each page's own 403 text beyond BankClassificationReview, independent review and deployed replay remain open.` };
  }
};

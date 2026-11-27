// Fixture for plan omf-order-mapping piece 5 (the developer list and the 開発者 page) and piece 7 (developer entry, §4).
// Run through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture scripts/zoomer-fixtures/omf-developer-entry.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/developer-integration.cjs on its own throwaway MongoDB and server process, installed Chrome headless
// when present; NOT RUN and red when .output/server/index.mjs is missing) · 2 an unchanged packaged copy of the build must pass ·
// 3 each named defect put back into an isolated copy of the compiled output must turn the named checks red. No model, provider,
// network send or ambient database: every database address is a closed sentinel and the integration owns its in-memory MongoDB.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const SCRIPT_COVERS = ['scripts/developer-integration.cjs', 'scripts/developer-entry-session.test.cjs', 'scripts/zoomer-fixtures/omf-developer-entry.mjs', 'scripts/manage-developers.ts'];
const APP_COVERS = ['server/models/PlatformDeveloper.ts', 'server/utils/developerAccess.ts', 'server/api/developer/[...path].ts', 'pages/developer/index.vue', 'components/common/AppSidebar.vue', 'shared/finance-navi-features.mjs', 'i18n/locales/ja.json', 'i18n/locales/ko.json',
  'server/models/DeveloperEntry.ts', 'server/services/developerEntryService.ts', 'server/middleware/developerEntry.ts', 'server/middleware/api.ts', 'server/services/authService.ts', 'server/utils/audit.ts', 'server/models/AuditLog.ts',
  'stores/user.ts', 'utils/auth-session.ts', 'utils/session-fetch.ts', 'components/common/DeveloperEntryBanner.vue', 'layouts/default.vue'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
const chrome = [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(existsSync);

// Each defect (plan §4.9, the four put back): a whitespace-tolerant anchor in the compiled server chunks (matched at least once,
// replaced wherever it occurs), its replacement, and every check that must turn red with it.
export const DEFECTS = [
  // 1 No entry-row check: every row passes, ended, expired, removed or not.
  { name: 'd1-no-entry-row-check', anchor: /function entryRowProblem(\$\d+)?\(entry, payload, people, now\) \{/g, replacement: m => m + ' return null;',
    expect: ['E-two-entries-newer-open', 'E-logout-ends-row-no-customer-logout-line', 'E-removed-developer-stops', 'E-developer-password-stops', 'E-target-deactivated-stops', 'E-end-time-stops', 'E-restart-row-decides'] },
  // 2 Every write allowed: the eight-path list replaced by "anything goes" (the closed sign-in, developer and invitation paths stay).
  { name: 'd2-every-write-allowed', anchor: /return ENTRY_ALLOWED_WRITES(\$\d+)?\.some\([^;]*\? "allowed" : "refused";/g, replacement: 'return "allowed";',
    expect: ['E-route-tree-refused-before-handler', 'E-allowed-path-variants-refused', 'E-ten-paths-change-nothing', 'E-navi-writes-refused', 'E-old-upload-answered-by-entry', 'E-invitation-misuses-fail', 'E-every-request-lined'] },
  // 3 verifyAccessToken accepting the entry type.
  { name: 'd3-verifyAccessToken-accepts-entry', anchor: /if \(!payload\?\.userId \|\| payload\.type && payload\.type !== "access" \|\|/g, replacement: 'if (!payload?.userId || payload.type && payload.type !== "access" && payload.type !== "entry" ||',
    expect: ['E-verifyAccessToken-refuses-entry-type'] },
  // 4 developerEntry.ts removed: the middleware does nothing, so an entry token signs in nobody.
  { name: 'd4-developerEntry-removed', anchor: /return developerEntryRequest(\$\d+)?\(event, payload, path\);/g, replacement: 'return;',
    expect: ['E-reads-as-customer', 'E-api-ts', 'E-forged-claims-act-as-row-target', 'E-navi-history-equal', 'E-me-inside-false-no-line', 'E-closed-paths-inside', 'E-route-tree-refused-before-handler', 'E-eight-allowed-writes-saved-and-lined', 'E-logout-ends-row-no-customer-logout-line'] }
].map(d => ({ ...d, expect: d.expect.map(label => 'developer:' + label) }));

function run(appRoot, { mutant = false, timeout = 1500000 } = {}) {
  const env = { ...process.env, OMF_DEVELOPER_APP_ROOT: appRoot, OMF_DEVELOPER_SOURCE_ROOT: root, OMF_DEVELOPER_MUTANT: mutant ? '1' : '', OMF_DEVELOPER_BROWSER: mutant ? '' : (process.env.OMF_DEVELOPER_BROWSER ?? (chrome ? '1' : '')), ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OMF_GMAIL_CLIENT_ID', 'OMF_GMAIL_CLIENT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(root, 'scripts', 'developer-integration.cjs')], { cwd: root, env, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || ''), lines = String(stdout || '').split(/\r?\n/);
      let summary = null; const s = lines.find(l => l.startsWith('SUMMARY ')); try { summary = s ? JSON.parse(s.slice(8)) : null } catch {}
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, summary, passes: lines.filter(l => l.startsWith('PASS ')).map(l => l.slice(5)), fails: lines.filter(l => l.startsWith('FAIL ')).map(l => l.slice(5).split(' :: ')[0]) });
    });
  });
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /^FAIL |SETUP|Error/.test(l)).slice(0, 6).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 1200);
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyDefect(outputDir, defect) {
  const touched = [];
  for (const file of await chunkFiles(path.join(outputDir, 'server'))) { const text = await readFile(file, 'utf8'); if (!(text.match(defect.anchor) || []).length) continue; await writeFile(file, text.replace(defect.anchor, defect.replacement)); touched.push(path.relative(outputDir, file)); }
  if (!touched.length) throw new Error(`SETUP: defect ${defect.name}: anchor matched no compiled chunk`);
  return touched;
}

export default {
  name: 'omf-developer-entry',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [], defects = [];
    let pass = true, positive = null, control = null;
    // 0 the browser session code (stores/user.ts, utils/auth-session.ts, utils/session-fetch.ts) in its unit harness.
    const unit = await new Promise(resolve => execFile(process.execPath, ['--test', path.join(root, 'scripts', 'developer-entry-session.test.cjs')], { cwd: root, windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, text: String(stdout || '') + String(stderr || '') })));
    const unitCounts = (unit.text.match(/ℹ pass (\d+)/) || [])[1];
    if (unit.code !== 0) { pass = false; lines.push('0 session unit test: RED — ' + unit.text.split(/\r?\n/).filter(l => /✖|not ok|Error/.test(l)).slice(0, 4).join(' | ').slice(0, 600)); }
    else lines.push(`0 session unit test: ok (${unitCounts} tests)`);
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root);
      const green = positive.code === 0 && positive.summary && positive.summary.failed === 0 && positive.summary.total === positive.passes.length && positive.passes.length > 0;
      if (!green) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length} checks green, failing [${positive.fails.join(', ')}]: ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} checks in ${Math.round(positive.ms / 1000)}s; browser ${positive.passes.some(p => /browser/.test(p)) ? 'ran' : 'not run'})`);
    }
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'developer-entry-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
        const chunks = await chunkFiles(path.join(directory, '.output', 'server')), originals = new Map(await Promise.all(chunks.map(async f => [f, await readFile(f, 'utf8')])));
        const reset = () => Promise.all([...originals].map(([f, t]) => writeFile(f, t)));
        control = await run(directory, { mutant: true });
        const browserChecks = positive.passes.filter(p => /browser/.test(p)).length;
        const controlOk = control.code === 0 && control.summary?.failed === 0 && control.passes.length === positive.passes.length - browserChecks;
        lines.push(`2 unchanged packaged copy: ${controlOk ? `ok (${control.passes.length} checks)` : 'RED — ' + tail(control)}`);
        if (!controlOk) pass = false;
        else for (const defect of DEFECTS) {
          try {
            const touched = await applyDefect(path.join(directory, '.output'), defect);
            const r = await run(directory, { mutant: true });
            const missing = defect.expect.filter(label => !r.fails.includes(label));
            const detected = r.code !== 0 && missing.length === 0 && !r.fails.includes('SETUP');
            defects.push({ name: defect.name, touched, detected, exit: r.code, red: r.fails, missing });
            if (!detected) pass = false;
          } catch (error) { defects.push({ name: defect.name, detected: false, setupError: String(error.message).slice(0, 300) }); pass = false; }
          finally { await reset(); }
        }
        if (DEFECTS.length) lines.push(`3 defects: ${defects.map(d => d.name + ': ' + (d.detected ? `detected (red: ${d.red.length}, named all ${DEFECTS.find(x => x.name === d.name).expect.length}: ${d.red.map(l => l.replace('developer:', '')).join(', ')})` : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — missing ' + (d.missing || []).join(', ')))).join(' · ')}`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('2-3 control and defects: NOT RUN — leg 1 is not green, defects prove nothing');
    pass = pass && !!control && defects.length === DEFECTS.length && defects.every(d => d.detected);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'developer entry green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · limits: synthetic owned native HTTP and installed Chrome headless when present; no model draw, no production row; the look at production sign-ins after release is not part of this fixture.` };
  }
};

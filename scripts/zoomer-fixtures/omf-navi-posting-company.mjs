// Fixture for plan omf-navi-posting-company-20261020 (5-plan.json): Navi legacy owner/purchase chat ledger posting reaches the
// native company ledger writer under the token-selected company frozen at send, with fresh membership at write and recovery and
// verified binding/entry/transaction company before anything is reported as posted or existing.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-posting-company.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-navi-posting-company-integration.cjs on its own disposable MongoDB and server process;
// NOT RUN and red when .output/server/index.mjs is missing) · 2 an unchanged packaged copy of the build must pass · 3 named
// defects, each reintroduced into an isolated copy of the compiled output, must make the integration fail with its named
// assertion. No model, provider, network send or ambient database: every database address is a closed sentinel and the
// integration owns its in-memory MongoDB. `covers` is decided at load: built-app files are listed only when the build exists.
// Fail-first on 7edec8e: leg 1 is the behavioural failure (no checked posting company is displayed or frozen; the Navi post
// writes an unassigned ledger row); legs 2-3 are NOT RUN until leg 1 is green.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 2400000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const SCRIPT_COVERS = ['scripts/finance-navi-posting-company-integration.cjs', 'scripts/zoomer-fixtures/omf-navi-posting-company.mjs'];
const APP_COVERS = ['server/services/financeNaviPostingService.ts', 'server/services/financeActionService.ts', 'server/services/financeAssistantService.ts', 'server/services/financeChatService.ts', 'server/models/FinanceActionOperation.ts', 'server/api/finance-chat/[...path].ts'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');

// Each defect: a whitespace-tolerant anchor in the compiled server chunks that must match exactly once, its replacement, and the
// `navi-posting:` assertion the integration must then fail with.
export const DEFECTS = [
  { name: 'post-without-company', anchor: /commitCompanyImport\(\s*scope\.ownerId,\s*String\(batch\._id\),\s*\{\s*decisions\s*\},\s*organizationId\s*\)/g, replacement: 'commitCompanyImport(scope.ownerId, String(batch._id), { decisions }, void 0)', expect: /navi-posting:(post-done|bound-company|reservation-company|ledger-company)/ },
  { name: 'skip-write-membership', anchor: /return await companyMembership\(\s*String\(ownerId\),\s*String\(frozen\.organizationId\)\s*\);?/g, replacement: 'return frozenCompanyId(frozen);', expect: /navi-posting:(revoked-write-refused|inactive-company-refused)/ },
  { name: 'trust-posted-entry', anchor: /async function postedUnder(\$\d+)?\(entry, organizationId\) \{/g, replacement: m => m + ' return true;', expect: /navi-posting:recovery-tampered-unresolved/ },
  { name: 'display-without-membership', anchor: /const checked = await companyMembership\(\s*userId,\s*organizationId\s*\);?/g, replacement: 'const checked = organizationId;', expect: /navi-posting:(foreign-not-displayed|foreign-name-hidden)/ },
  { name: 'drop-frozen-workspace-company', anchor: /\.\.\.postingCompany\s*\?\s*\{\s*postingCompany\s*\}\s*:\s*\{\}\s*,\s*\.\.\.target/g, replacement: '...target', expect: /navi-posting:(frozen-from-token-not-body|reused-request-keeps-company)/ },
  { name: 'existing-reposted', anchor: /if \(\(entry == null \? void 0 : entry\.state\) === ["']posted["']\) \{\s*if \(binding !== ["']same["']|if \(entry\?\.state === ["']posted["']\) \{\s*if \(binding !== ["']same["']/g, replacement: 'if (false) { if (binding !== "same"', expect: /navi-posting:verified-existing/ }
];

function run(appRoot, timeout = 600000) {
  const env = { ...process.env, OMF_NAVI_POSTING_FIXTURE: 'owned', OMF_NAVI_POSTING_APP_ROOT: appRoot, ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(appRoot, 'scripts', 'finance-navi-posting-company-integration.cjs')], { cwd: appRoot, env, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /navi-posting:|AssertionError|Error|SETUP/.test(l)).slice(0, 6).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 900);
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyDefect(outputDir, defect) {
  let hits = 0, target = null;
  for (const file of await chunkFiles(path.join(outputDir, 'server', 'chunks'))) { const text = await readFile(file, 'utf8'); const n = (text.match(defect.anchor) || []).length; if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error(`SETUP: defect ${defect.name}: anchor matched ${hits} times (expected exactly 1)`);
  await writeFile(target.file, target.text.replace(defect.anchor, defect.replacement));
  return path.relative(outputDir, target.file);
}

export default {
  name: 'omf-navi-posting-company',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null;
    const defects = [];
    // 1 positive: the built app on its own owned database.
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root);
      const done = positive.text.match(/(\d+) navi posting groups passed/);
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length < 9) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length} groups green: ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} groups in ${Math.round(positive.ms / 1000)}s)`);
    }
    // 2-3 packaged copy control and named compiled defects, only when leg 1 is green.
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'navi-posting-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
        await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true, dereference: true });
        await mkdir(path.join(directory, 'scripts'), { recursive: true });
        await cp(path.join(root, 'scripts', 'finance-navi-posting-company-integration.cjs'), path.join(directory, 'scripts', 'finance-navi-posting-company-integration.cjs'));
        const chunks = await chunkFiles(path.join(directory, '.output', 'server', 'chunks')), originals = new Map(await Promise.all(chunks.map(async f => [f, await readFile(f, 'utf8')])));
        const reset = () => Promise.all([...originals].map(([f, t]) => writeFile(f, t)));
        control = await run(directory);
        const controlOk = control.code === 0 && control.passes.length === positive.passes.length;
        lines.push(`2 unchanged packaged copy: ${controlOk ? 'ok' : 'RED — ' + tail(control)}`);
        if (!controlOk) pass = false;
        else for (const defect of DEFECTS) {
          try {
            const touched = await applyDefect(path.join(directory, '.output'), defect);
            const r = await run(directory), detected = r.code !== 0 && defect.expect.test(r.text) && !/SETUP/.test(r.text);
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
    return { pass, databaseCoverage, message: `${pass ? 'navi posting company green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · limits: synthetic owned native HTTP/worker protocol evidence with synthetic worker replies, no model draw; historical/production observation, independent review and deployed replay remain open.` };
  }
};

// Fixture for plan omf-navi-owner-continuation-20261020 (5-plan.json): the legacy owner workspace and purchase Navi chats gain explicit
// new chat and archived history, a realm-aware feature guide with longer owner explanations, the same-company teaching bridge and
// named owner actions (card sync, automatic sync, workflow review, assigned-card allocation) on the real native services.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-owner-continuation.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-navi-owner-continuation-integration.cjs on its own disposable MongoDB and server process,
// with the real installed-Chrome leg scripts/finance-navi-owner-continuation-browser.cjs chained at its end; NOT RUN and red when
// .output/server/index.mjs is missing) · 2 node --test of the sibling unit tests · 3 an unchanged packaged copy of the build must
// pass · 4 named defects, each reintroduced into an isolated copy of the compiled output, must make the integration fail with its
// named assertion. No model, provider, network send or ambient database: every database address is a closed sentinel, every model
// or business credential a dummy, and the integration owns its in-memory MongoDB. `covers` is decided at load: built-app files are
// listed only when the build exists.
// Fail-first on 3b7d4ab: leg 1 is the behavioural failure (the owner workspace reply loses its fixed page link and longer text, and
// there is no new chat, history, teaching bridge or owner native action); legs 3-4 are NOT RUN until leg 1 is green.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const SCRIPT_COVERS = ['scripts/finance-navi-owner-continuation-integration.cjs', 'scripts/finance-navi-owner-continuation-browser.cjs', 'scripts/zoomer-fixtures/omf-navi-owner-continuation.mjs', 'scripts/finance-assistant.test.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-interpreter-stream.test.mjs', 'shared/finance-assistant.mjs', 'shared/finance-navi-features.mjs', 'shared/finance-chat.mjs', 'teaching-worker/interpreter.mjs'];
const APP_COVERS = ['server/models/FinanceOwnerConversationArchive.ts', 'server/services/financeOwnerConversationService.ts', 'server/services/financeOwnerCompanyKnowledgeService.ts', 'server/services/financeOwnerActionService.ts', 'server/services/financeAssistantService.ts', 'server/services/financeChatService.ts', 'server/services/financeActionService.ts', 'server/services/companyKnowledgeService.ts', 'server/services/financeService.ts', 'server/services/financePaymentMatchService.ts', 'server/services/financeWorkflowService.ts', 'server/models/FinanceAssistant.ts', 'server/models/FinanceChat.ts', 'server/models/FinanceActionOperation.ts', 'server/models/Finance.ts', 'server/api/finance-chat/[...path].ts', 'server/api/finance/[...path].ts', 'components/finance/AssistantConversation.vue', 'components/finance/PurchaseChat.vue', 'components/finance/AssistantPanel.vue', 'stores/assistant.ts'];
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');

// Each defect: a whitespace-tolerant anchor in the compiled server chunks that must match exactly once, its replacement, and the
// `owner-cont:` assertion the integration must then fail with.
export const DEFECTS = [
  // The archive copies the live turns without the journal's current receipts: a stale working receipt then blocks every later reset
  // (or the archive misses the receipts).
  { name: 'archive-raw-turns', anchor: /const turns = \(await conversationReceipts\(kind, c\)\)\.turns/g, replacement: 'const turns = c.turns', expect: /owner-cont:archive-keeps-receipts|owner-cont:positive POST \/api\/finance-chat\/workspace\/new/ },
  // The cb49 rule broken for owner archives: a stale un-adopted copy is deleted and recreated under a new id instead of replaced in place.
  { name: 'stale-copy-recreated', anchor: /await FinanceOwnerConversationArchive(\$\d+)?\.collection\.replaceOne\(\{ _id: existing\._id, ownerId: c\.ownerId, conversationKind: kind,/g, replacement: (m, suffix = '') => `await FinanceOwnerConversationArchive${suffix}.deleteOne({ _id: existing._id }); existing._id = new existing._id.constructor(); await FinanceOwnerConversationArchive${suffix}.collection.insertOne({ ...candidate.toObject({ virtuals: false }), _id: existing._id }); if (false) await FinanceOwnerConversationArchive${suffix}.collection.replaceOne({ _id: existing._id, ownerId: c.ownerId, conversationKind: kind,`, expect: /owner-cont:stale-copy-keeps-id/ },
  { name: 'no-ui-company-mask', anchor: /function maskTurns(\$\d+)?\(turns, organizationId\) \{/g, replacement: m => m + ' return turns;', expect: /owner-cont:bridge-ui-masked-other-company|owner-cont:bridge-archive-masked/ },
  { name: 'no-model-history-withhold', anchor: /function withholdMessages(\$\d+)?\(messages, turns, organizationId\) \{/g, replacement: m => m + ' return messages;', expect: /owner-cont:bridge-switch-history-withheld|owner-cont:bridge-narrow-history-withheld/ },
  { name: 'claim-without-membership', anchor: /const checked = await companyMembership\(\s*String\(ownerId\),\s*String\(frozen\.organizationId\)\s*\)\.catch\(/g, replacement: 'const checked = await Promise.resolve(frozenCompanyId(frozen)).catch(', expect: /owner-cont:bridge-revoked-no-recall|owner-cont:bridge-revoked-action-refused|owner-cont:bridge-action-fresh-check/ },
  { name: 'teaching-for-narrow-worker', anchor: /if \(!\(agent == null \? void 0 : agent\.workspaceEnabled\)\) return null;|if \(!agent\?\.workspaceEnabled\) return null;/g, replacement: 'if (false) return null;', expect: /owner-cont:bridge-narrow-card-only/ },
  { name: 'sync-without-marker', anchor: /\.\.\.operation \? \{ jobOperation: \{ operationId: operation\.operationId, jobId, at: requestedAt \} \} : \{\}/g, replacement: '...{}', expect: /owner-cont:sync-native-marker/ },
  { name: 'auto-sync-whole-object', anchor: /\$set: \{ "autoSync\.enabled": input\.enabled, "autoSync\.hour": input\.hour,/g, replacement: '$set: { autoSync: { enabled: input.enabled, hour: input.hour },', expect: /owner-cont:auto-keeps-lastQueuedDay/ },
  { name: 'workflow-unscoped', anchor: /if \(readScope\) filter\.accountId = \{ \$in: readScope\.accountIds\.map\(\(a\) => id\(a\)\) \};/g, replacement: '', expect: /owner-cont:workflow-assigned-only|owner-cont:workflow-unassigned-refused/ },
  // The native allocation request id no longer derives from the journal operation: the receipt cannot be tied to its allocation.
  { name: 'allocation-unbound-request', anchor: /requestId: "navi_" \+ operation\.operationId/g, replacement: 'requestId: "navi_" + operation.operationId.split("").reverse().join("")', expect: /owner-cont:action confirm_card_allocation|owner-cont:alloc-request-marker|owner-cont:alloc-retry-same|owner-cont:alloc-recovery-save/ }
];

function scrubbedEnv(appRoot, browser) {
  const env = { ...process.env, OMF_OWNER_CONT_FIXTURE: 'owned', OMF_OWNER_CONT_APP_ROOT: appRoot, OMF_OWNER_CONT_BROWSER: browser ? '1' : '0', ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return env;
}
function run(appRoot, { browser = false, timeout = 900000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(appRoot, 'scripts', 'finance-navi-owner-continuation-integration.cjs')], { cwd: appRoot, env: scrubbedEnv(appRoot, browser), windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}
function unitTests() {
  const tests = ['scripts/finance-assistant.test.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-interpreter-stream.test.mjs', 'scripts/finance-navi-features.test.mjs'];
  return new Promise(resolve => execFile(process.execPath, ['--test', ...tests], { cwd: root, env: scrubbedEnv(root, false), windowsHide: true, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, text: String(stdout || '') + String(stderr || '') })));
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /owner-cont:|AssertionError|Error|SETUP/.test(l)).slice(0, 6).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 900);
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyDefect(outputDir, defect) {
  let hits = 0, target = null;
  for (const file of await chunkFiles(path.join(outputDir, 'server', 'chunks'))) { const text = await readFile(file, 'utf8'); const n = (text.match(defect.anchor) || []).length; if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error(`SETUP: defect ${defect.name}: anchor matched ${hits} times (expected exactly 1)`);
  await writeFile(target.file, target.text.replace(defect.anchor, defect.replacement));
  return path.relative(outputDir, target.file);
}

export default {
  name: 'omf-navi-owner-continuation',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null, units = null;
    const defects = [];
    // 1 positive: the built app on its own owned database, with the installed-Chrome leg chained at its end.
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root, { browser: true, timeout: 1500000 });
      await writeFile(path.join(root, '.zoomer-owner-continuation-integration.txt'), positive.text).catch(() => {});
      const done = positive.text.match(/(\d+) owner continuation groups passed/), browser = positive.passes.filter(p => /^browser /.test(p));
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length < 9 || !browser.length) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length} groups green (${browser.length} browser): ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} groups incl. ${browser.length} installed-Chrome in ${Math.round(positive.ms / 1000)}s)`);
    }
    // 2 sibling unit tests (pure, no database or model).
    units = await unitTests();
    const summary = units.text.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
    if (units.code !== 0 || !summary || summary[2] !== '0') { pass = false; lines.push(`2 unit tests: RED — exit ${units.code}: ${units.text.split(/\r?\n/).filter(l => /not ok|Error|failed/i.test(l)).slice(0, 6).join(' | ').slice(0, 600)}`); }
    else lines.push(`2 unit tests: ok (${summary[1]} tests, 0 failed)`);
    // 3-4 packaged copy control and named compiled defects, only when leg 1 is green.
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'owner-continuation-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
        await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true, dereference: true });
        await mkdir(path.join(directory, 'scripts'), { recursive: true });
        await cp(path.join(root, 'scripts', 'finance-navi-owner-continuation-integration.cjs'), path.join(directory, 'scripts', 'finance-navi-owner-continuation-integration.cjs'));
        const chunks = await chunkFiles(path.join(directory, '.output', 'server', 'chunks')), originals = new Map(await Promise.all(chunks.map(async f => [f, await readFile(f, 'utf8')])));
        const reset = () => Promise.all([...originals].map(([f, t]) => writeFile(f, t)));
        control = await run(directory);
        const controlOk = control.code === 0 && control.passes.length === positive.passes.filter(p => !/^browser /.test(p)).length;
        lines.push(`3 unchanged packaged copy: ${controlOk ? 'ok' : 'RED — ' + tail(control)}`);
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
        lines.push(`4 defects: ${defects.map(d => d.name + ':' + (d.detected ? 'detected' : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — ' + d.tail))).join(' · ')}`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('3-4 control and defects: NOT RUN — legs 1-2 are not green, defects prove nothing');
    pass = pass && !!control && defects.length === DEFECTS.length && defects.every(d => d.detected);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'navi owner continuation green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · limits: synthetic owned native HTTP/worker protocol and installed-Chrome evidence with synthetic worker replies, no model draw; live model acceptance, historical/production observation, independent review and deployed replay remain open.` };
  }
};

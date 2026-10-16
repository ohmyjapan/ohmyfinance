// Fixture for plan omf-intake-feature-20261016 (5-plan.json): the intake (購入受付) platform inside OMF's shell — hand entry,
// Excel/CSV import by column mapping, corrections that never wipe a known value, originals and attachments by hash, owner scope.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture scripts/zoomer-fixtures/omf-intake.mjs --cwd <this worktree>
// Legs: 1 the pure module's ten prototype cases · 2 the built app (scripts/finance-intake-integration.cjs chained by
// scripts/finance-integration.cjs behind OMF_TEST_INTAKE_ONLY on its own ephemeral MongoDB; NOT RUN and red when
// .output/server/index.mjs is missing) · 3 node --test of the sibling unit test · 4 the plan's three mutants, each
// reintroduced into an isolated copy of the built output and required to flip its named leg-2 assertion · 5 optional real
// Chrome (OMF_TEST_CHROME_PORT): /intake renders inside the shell with the sidebar entry; NOT RUN without it.
// No model, no network, no production database. Synthetic owners finance-a/finance-b@example.invalid only.
// Fail-first on 9603c23: leg 1 and leg 3 fail on a missing module (setup); leg 2 is the behavioural failure
// (/api/finance-intake/records answers 404, so the first intake:create-partial assertion fails).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 1800000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const PURE_COVERS = ['shared/finance-intake.mjs', 'shared/finance-intake.d.mts', 'scripts/finance-intake.test.mjs'];
const APP_COVERS = ['server/models/FinanceIntake.ts', 'server/services/financeIntakeService.ts', 'server/api/finance-intake/[...path].ts', 'pages/intake/index.vue', 'pages/intake/[id].vue', 'components/intake/IntakeImporter.vue', 'components/common/AppSidebar.vue', 'scripts/finance-intake-integration.cjs', 'scripts/finance-integration.cjs', 'docs/intake.md'];
const u = p => pathToFileURL(path.join(REPO_ROOT, p)).href;

function run(args, env, timeout, cwd = REPO_ROOT) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || '');
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, stdout: text, stderr: String(stderr || ''), passes: text.split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5)) });
    });
  });
}
const integrationTail = r => (r.stderr.split('\n').filter(l => /Error|assert|expected|actual|intake:|at /i.test(l)).slice(0, 8).join(' | ') || r.stdout.slice(-800)).replace(/\s+/g, ' ');

// The plan's three mutants (§6 risks): a whitespace-tolerant anchor in the built nitro chunks, the defect, and the leg-2
// assertion that must then fail.
export const MUTANTS = [
  // The whole keep-guard of planImport: "the column is mapped and the cell is not blank". Dropping it makes a blank cell overwrite.
  { name: 'blank-cell-overwrites', anchor: /\(\s*!row\.present\s*\|\|\s*row\.present\.includes\(k\)\s*\)\s*&&\s*\(\s*v\[k\]\s*!==\s*['"]{2}\s*\|\|\s*options\.clearBlank\s*\)/g, replacement: 'true', expect: /intake:blank-cell-keeps-description|intake:blank-keeps-value/ },
  { name: 'owner-filter-dropped', anchor: /IntakeRecord\.findOne\(\{\s*_id:\s*id\(recordId\),\s*ownerId\s*\}\)/g, replacement: 'IntakeRecord.findOne({ _id: id(recordId) })', expect: /intake:owner-scope-get/ },
  { name: 'hash-dedupe-dropped', anchor: /IntakeDocument\.findOne\(\{\s*ownerId,\s*hash\s*\}\)/g, replacement: 'IntakeDocument.findOne({ ownerId, hash: "never" })', expect: /intake:same-bytes-one-document/ }
];
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyMutant(outputDir, mutant) {
  const files = await chunkFiles(path.join(outputDir, 'server', 'chunks'));
  let hits = 0, target = null;
  for (const file of files) { const text = await readFile(file, 'utf8'); const n = (text.match(mutant.anchor) || []).length; if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error(`mutant ${mutant.name}: anchor matched ${hits} times (expected exactly 1)`);
  await writeFile(target.file, target.text.replace(mutant.anchor, mutant.replacement));
  return path.relative(outputDir, target.file);
}

export default {
  name: 'omf-intake',
  covers: BUILT ? [...PURE_COVERS, ...APP_COVERS] : PURE_COVERS,
  async run() {
    const started = Date.now();
    const lines = [], setupFailures = [];
    let pass = true;
    const leg = async (name, fn) => { try { const note = await fn(); lines.push(`${name}: ok${note ? ' (' + note + ')' : ''}`); } catch (error) { pass = false; const text = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500); if (/^SETUP:|^NOT RUN:|Cannot find module|ERR_MODULE_NOT_FOUND/.test(text)) setupFailures.push(name); lines.push(`${name}: RED — ${text}`); } };
    const assert = (await import('node:assert/strict')).default;
    const env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };

    // 1 pure module: the ten prototype cases (behaviour reference output/omf-intake-platform-20261016/model.test.cjs).
    await leg('1 pure intake model', async () => {
      const M = await import(u('shared/finance-intake.mjs'));
      const proof = (row = 2, hash = 'a') => ({ hash, fileName: 'daily.xlsx', documentId: hash, sheet: 'Sheet1', row, raw: [] });
      const row = (values, provenance) => ({ values: M.normalize(values), provenance });
      const defaults = { service: '自社受付', account: '', currency: 'JPY' };
      let q = M.planImport([], [row({ description: 'URLから内容確認' })]);
      assert.equal(q.new, 1); assert.equal(q.rows[0].record.values.amount, ''); assert.equal(q.rows[0].record.values.purchaseState, 'requested');
      let records = M.applyPlan([], M.planImport([], [row({ service: 'A', account: 'one', orderId: '0001', itemId: '01' }), row({ service: 'B', account: 'one', orderId: '0001', itemId: '01' }), row({ service: 'A', account: 'two', orderId: '0001', itemId: '01' }), row({ service: 'A', account: 'one', orderId: '0001', itemId: '02' })]));
      assert.equal(new Set(records.map(r => r.key)).size, 4, 'service, account and item distinguish the same order number');
      const incoming = [row({ service: 'A', orderId: '001', amount: '12800' }, proof())], first = M.applyPlan([], M.planImport([], incoming)), again = M.planImport(first, incoming);
      assert.deepEqual([again.new, again.update, again.unchanged, again.rows[0].record.history.length], [0, 0, 1, 1], 'identical re-import is unchanged');
      const original = M.applyPlan([], M.planImport([], [row({ orderId: '001', merchant: 'Confirmed shop', amount: '12800', purchaseState: 'purchased' }, proof())]));
      const corrected = M.planImport(original, M.mappedRows([['001', '', '13000', '']], { orderId: '0', merchant: '1', amount: '2', purchaseState: '3' }, defaults, { ...proof(2, 'b'), firstRow: 2 }));
      const v = corrected.rows[0].record.values; assert.equal(v.amount, '13000'); assert.equal(v.merchant, 'Confirmed shop'); assert.equal(v.purchaseState, 'purchased'); assert.equal(corrected.rows[0].record.provenance.length, 2); assert.equal(original[0].values.amount, '12800', 'the stored record is not mutated by planning');
      assert.equal(M.planImport(M.applyPlan([], M.planImport([], [row({ orderId: '001', purchaseState: 'purchased' }, proof())])), M.mappedRows([['001', 'new description']], { orderId: '0', description: '1' }, defaults, { ...proof(2, 'b'), firstRow: 2 })).rows[0].record.values.purchaseState, 'purchased', 'unmapped fields keep the stored value');
      const dup = [row({ orderId: '001', description: 'item A' }, proof(2)), row({ orderId: '001', description: 'item B' }, proof(3))], dupPlan = M.planImport([], dup); records = M.applyPlan([], dupPlan);
      assert.equal(records.length, 2); assert.equal(dupPlan.ambiguous, 2); assert.ok(records.every(r => r.identityReview)); assert.equal(M.planImport(records, dup).unchanged, 2, 'duplicate IDs stay per source row and flag review');
      records = M.applyPlan([], M.planImport([], [row({ description: 'A' }, proof(2)), row({ description: 'B' }, proof(4))])); assert.equal(records.length, 2); assert.ok(records.every(r => r.identityReview)); assert.equal(M.planImport(records, [row({ description: 'A' }, proof(2)), row({ description: 'B' }, proof(4))]).unchanged, 2, 'no-ID rows are distinct by file and row');
      const n = M.normalize({ orderId: '000012', itemId: 'A-01', amount: '￥0', purchaseDate: '2026年10月3日' }); assert.equal(n.orderId, '000012'); assert.equal(n.amount, '0'); assert.equal(n.purchaseDate, '2026-10-03'); assert.equal(M.normalize({ amount: '-12,800' }).amount, '-12800');
      assert.deepEqual(M.mappedRows([['001'], [''], ['002']], { orderId: '0' }, { service: 'A' }, { ...proof(), firstRow: 5 }).filter(r => r.provenance.raw.some(Boolean)).map(r => r.provenance.row), [5, 7], 'blank rows keep row numbers');
      records = M.applyPlan([], M.planImport([], [row({ orderId: '001', amount: '100' }, proof(2, 'a'))])); const revised = M.planImport(records, [row({ orderId: '001', amount: '120' }, proof(6, 'b'))]);
      assert.equal(M.applyPlan(records, revised).length, 1); assert.equal(revised.rows[0].record.provenance.length, 2); assert.equal(revised.rows[0].record.history.at(-1).changes.find(c => c.field === 'amount').before, '100', 'a revised file appends provenance');
      assert.equal(M.FIELDS.length, 13); assert.equal(M.guessMapping(['注文番号', '商品名']).orderId, '0');
      return '10 prototype cases + field count';
    });

    // 2 built app: the intake integration chained in the finance harness on its own ephemeral MongoDB.
    let integration = null;
    await leg('2 built app intake legs', async () => {
      if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing (run nuxt build in this worktree first); no HTTP coverage claimed');
      if (!existsSync(path.join(REPO_ROOT, 'scripts/finance-intake-integration.cjs'))) throw new Error('NOT RUN: scripts/finance-intake-integration.cjs is missing');
      if (!/OMF_TEST_INTAKE_ONLY/.test(readFileSync(path.join(REPO_ROOT, 'scripts/finance-integration.cjs'), 'utf8'))) throw new Error('NOT RUN: the intake integration is not chained in scripts/finance-integration.cjs');
      integration = await run(['scripts/finance-integration.cjs'], { ...env, OMF_TEST_INTAKE_ONLY: '1' }, 900000);
      await writeFile(path.join(REPO_ROOT, '.zoomer-intake-integration.txt'), integration.stdout + (integration.stderr ? '\n--- stderr ---\n' + integration.stderr : '')).catch(() => {});
      const done = integration.stdout.match(/(\d+) targeted intake checks passed/);
      if (integration.code !== 0 || !done || Number(done[1]) !== integration.passes.length || integration.passes.length < 12) throw new Error(`exit ${integration.killed ? 'timeout' : integration.code}, ${integration.passes.length} green: ${integrationTail(integration).slice(0, 900)}`);
      return `${integration.passes.length} legs green in ${Math.round(integration.ms / 1000)}s`;
    });

    // 3 the sibling unit test
    await leg('3 unit tests', async () => {
      const r = await run(['--test', 'scripts/finance-intake.test.mjs'], env, 180000);
      const summary = r.stdout.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
      if (r.code !== 0 || !summary || summary[2] !== '0') throw new Error(`node --test exit ${r.code}: ${(r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|failed|Cannot find/i.test(l)).slice(0, 6).join(' | ').slice(0, 500)}`);
      return `${summary[1]} tests, 0 failed`;
    });

    // 4 mutants: each defect reintroduced into an isolated copy of the built output must make its named assertion fail.
    const mutantNotes = [];
    await leg('4 mutants flip their assertions', async () => {
      if (!integration || integration.code !== 0) throw new Error('NOT RUN: leg 2 is not green, mutants prove nothing');
      const base = path.join(REPO_ROOT, '.zoomer-mutants');
      await rm(base, { recursive: true, force: true }); await mkdir(base, { recursive: true });
      const transcript = [];
      try {
        for (const mutant of MUTANTS) {
          const dir = path.join(base, mutant.name);
          for (const part of ['scripts', 'shared']) await cp(path.join(REPO_ROOT, part), path.join(dir, part), { recursive: true });
          await cp(path.join(REPO_ROOT, '.output'), path.join(dir, '.output'), { recursive: true, dereference: true });
          const touched = await applyMutant(path.join(dir, '.output'), mutant);
          const r = await run([path.join(dir, 'scripts/finance-integration.cjs')], { ...env, OMF_TEST_INTAKE_ONLY: '1' }, 600000, dir);
          const output = r.stdout + '\n' + r.stderr, flipped = r.code !== 0 && mutant.expect.test(output);
          transcript.push(`=== ${mutant.name} (${touched}) exit ${r.code} flipped=${flipped}\n${integrationTail(r).slice(0, 1200)}\n`);
          mutantNotes.push(`${mutant.name}:${flipped ? 'flipped' : 'NOT FLIPPED'}`);
          if (!flipped) throw new Error(`mutant ${mutant.name} did not flip ${mutant.expect} (exit ${r.code}): ${integrationTail(r).slice(0, 500)}`);
          await rm(dir, { recursive: true, force: true });
        }
      } finally { await writeFile(path.join(REPO_ROOT, '.zoomer-intake-mutants.txt'), transcript.join('\n')).catch(() => {}); await rm(base, { recursive: true, force: true }); }
      return mutantNotes.join(' ');
    });

    // 5 optional real Chrome: the page renders inside the shell with the sidebar entry (separate evidence, never default coverage).
    let chromeNote = 'NOT RUN: set OMF_TEST_CHROME_PORT for the real-Chrome shell check';
    if (process.env.OMF_TEST_CHROME_PORT) await leg('5 real Chrome shell', async () => {
      const r = await run(['scripts/finance-integration.cjs'], { ...env, OMF_TEST_INTAKE_ONLY: '1', OMF_TEST_INTAKE_CHROME: '1' }, 900000);
      if (r.code !== 0 || !r.passes.some(p => /real Chrome/.test(p))) throw new Error(`exit ${r.code}: ${integrationTail(r).slice(0, 600)}`);
      chromeNote = r.passes.filter(p => /real Chrome/.test(p)).join('; ');
      return chromeNote;
    });

    const databaseCoverage = integration && integration.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    const verdict = pass ? 'intake green' : setupFailures.length && setupFailures.length === lines.filter(l => / RED /.test(l)).length ? 'FAILED (setup only — not behavioural evidence)' : 'FAILED';
    return { pass, databaseCoverage, message: `${verdict} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')} · 5 real Chrome shell: ${chromeNote}` };
  }
};

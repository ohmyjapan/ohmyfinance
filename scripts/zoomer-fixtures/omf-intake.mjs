// Fixture for plan omf-intake-feature-20261016 (5-plan.json), extended by plan omf-intake-mapping-research-amended-20261017:
// the intake (購入受付) platform inside OMF's shell — hand entry, Excel/CSV import by column mapping (20 fields + owner-named
// extra columns), corrections that never wipe a known value, originals and attachments by hash, owner scope, and the
// URL → company + T number research through the existing research worker (queue / claim / result / confirm, recovery of a
// queued or lost lookup at read time).
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-intake.mjs --cwd <this worktree>
// Legs: 1 the pure module (ten prototype cases, 20 fields, five money fields, identifiers, extras) · 2 the built app
// (scripts/finance-intake-integration.cjs chained by scripts/finance-integration.cjs behind OMF_TEST_INTAKE_ONLY on its own
// ephemeral MongoDB; legs 1-12 kept + 13 eight fields + 14 extras/templates + 15 research + 16 supplier null / failed /
// mismatch + 17 recovery + 18 owner scope + 19 MANDATORY hidden real Chrome + 20 MANDATORY real worker cycle on the claude CLI;
// NOT RUN and red when .output/server/index.mjs is missing) · 3 node --test of the sibling unit test · 4 the plan's seven
// mutants, each reintroduced into an isolated copy of the built output and required to flip its named leg-2 assertion
// (mutant runs set OMF_TEST_INTAKE_MUTANT=1 so legs 19-20 run once, never per mutant) · 5 static checks of the worker files.
// Leg 20 needs OMF_TEST_RESEARCH_CLI (claude CLI path), OMF_TEST_CLAUDE_CONFIG_DIR (a subscription CLI login; worker.mjs:34
// passes no API key) and OMF_TEST_RESEARCH_PAGE (a public https seller page printing a T number); missing → RED, never NOT RUN.
// No production database. Synthetic owners finance-a/finance-b@example.invalid only.
// Fail-first on 8b6d54a: leg 1 FIELDS.length reads 13 (expects 20); leg 2 fails at intake:eight-create (400 '不明な項目');
// leg 3 fails on the field count; leg 5 finds no intake/ prefix in the worker files.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3600000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const PURE_COVERS = ['shared/finance-intake.mjs', 'shared/finance-intake.d.mts', 'scripts/finance-intake.test.mjs', 'research-worker/worker.mjs', 'research-worker/tools.mjs', 'research-worker/run.mjs'];
const APP_COVERS = ['server/models/FinanceIntake.ts', 'server/services/financeIntakeService.ts', 'server/services/financeIntakeResearchService.ts', 'server/api/finance-intake/[...path].ts', 'server/api/finance-research/[...path].ts', 'pages/intake/index.vue', 'pages/intake/[id].vue', 'components/intake/IntakeImporter.vue', 'components/common/AppSidebar.vue', 'scripts/finance-intake-integration.cjs', 'scripts/finance-integration.cjs', 'docs/intake.md'];
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
const integrationTail = r => (r.stderr.split('\n').filter(l => /Error|assert|expected|actual|intake:|intake-research:|intake-ui:|intake-worker:|at /i.test(l)).slice(0, 8).join(' | ') || r.stdout.slice(-800)).replace(/\s+/g, ' ');

// The plans' mutants (§6 risks): a whitespace-tolerant anchor in the built nitro chunks, the defect, and the leg-2 assertion
// that must then fail. Each anchor must match exactly once across the built chunks.
export const MUTANTS = [
  // The whole keep-guard of planImport: "the column is mapped and the cell is not blank". Dropping it makes a blank cell overwrite.
  { name: 'blank-cell-overwrites', anchor: /\(\s*!row\.present\s*\|\|\s*row\.present\.includes\(k\)\s*\)\s*&&\s*\(\s*v\[k\]\s*!==\s*['"]{2}\s*\|\|\s*options\.clearBlank\s*\)/g, replacement: 'true', expect: /intake:blank-cell-keeps-description|intake:blank-keeps-value/ },
  { name: 'owner-filter-dropped', anchor: /IntakeRecord\.findOne\(\{\s*_id:\s*id\(recordId\),\s*ownerId\s*\}\)/g, replacement: 'IntakeRecord.findOne({ _id: id(recordId) })', expect: /intake:owner-scope-get/ },
  { name: 'hash-dedupe-dropped', anchor: /IntakeDocument\.findOne\(\{\s*ownerId,\s*hash\s*\}\)/g, replacement: 'IntakeDocument.findOne({ ownerId, hash: "never" })', expect: /intake:same-bytes-one-document/ },
  // Amended plan §4: the intake worker claim loses its owner filter → finance-b's agent takes finance-a's queued lookup.
  { name: 'intake-claim-owner-scope', anchor: /return\s*\{\s*ownerId:\s*agent\.ownerId\s*\}/g, replacement: 'return {}', expect: /intake-research:owner-claim/ },
  // The registry number is no longer compared with the proposed number → a number mismatch shows as verified.
  { name: 'verified-ignores-number', anchor: /registry\.number\s*===\s*supplier\.invoiceNumber/g, replacement: 'true', expect: /intake-research:unverified-mismatch/ },
  // The keep-guard of the extra columns in planImport dropped → a blank extra cell overwrites the stored value.
  { name: 'blank-extra-overwrites', anchor: /\(\s*!row\.present\s*\|\|\s*row\.present\.includes\(\s*['"]extra:['"]\s*\+\s*name\s*\)\s*\)\s*&&\s*\(\s*after\s*!==\s*['"]{2}\s*\|\|\s*options\.clearBlank\s*\)/g, replacement: 'true', expect: /intake:blank-extra-keeps/ },
  // The read-time expiry never fires → a queued lookup nobody claims stays queued forever. Leg 17 meets it first on the
  // re-queue path (queue-settles-stuck: 409 "active" instead of "再読込"), then on the page read (expired-not-claimed).
  { name: 'stuck-never-expires', anchor: /new Date\(at\)\.getTime\(\)\s*<=\s*Date\.now\(\)\s*-\s*(?:LEASE_MS[$\w]*|600000|6e5)/g, replacement: 'false', expect: /intake-research:(?:queue-settles-stuck|expired-not-claimed)/ }
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
    const leg = async (name, fn) => { try { const note = await fn(); lines.push(`${name}: ok${note ? ' (' + note + ')' : ''}`); } catch (error) { pass = false; const text = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 700); if (/^SETUP:|^NOT RUN:|Cannot find module|ERR_MODULE_NOT_FOUND/.test(text)) setupFailures.push(name); lines.push(`${name}: RED — ${text}`); } };
    const assert = (await import('node:assert/strict')).default;
    const env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };

    // 1 pure module: the ten prototype cases (behaviour reference output/omf-intake-platform-20261016/model.test.cjs) + the
    //   amended plan's field count, money fields, identifiers and extras.
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
      // amended plan: 20 fields, the eight owner headers guessed, five money fields cleaned alike, identifiers kept, extras
      assert.equal(M.FIELDS.length, 20, 'FIELDS carries the twenty fields'); assert.equal(M.guessMapping(['注文番号', '商品名']).orderId, '0');
      const eight = M.guessMapping(['注文番号', '商品ID', '外部注文番号', 'URL', '商品価格', '税額', '送料', '手数料', '担当者']);
      assert.deepEqual([eight.orderId, eight.itemId, eight.externalOrderId, eight.merchantUrl, eight.itemPrice, eight.tax, eight.shippingFee, eight.otherFee], ['0', '1', '2', '3', '4', '5', '6', '7'], 'the eight owner headers are guessed');
      assert.ok(!Object.values(eight).includes('8'), 'an unknown header stays unmapped');
      assert.deepEqual(M.MONEY, ['amount', 'itemPrice', 'tax', 'shippingFee', 'otherFee']);
      const money = M.normalize({ amount: '12,800', itemPrice: '¥1,000', tax: '￥0', shippingFee: '1 200', otherFee: '-500' });
      assert.deepEqual([money.amount, money.itemPrice, money.tax, money.shippingFee, money.otherFee], ['12800', '1000', '0', '1200', '-500'], 'five money fields cleaned alike');
      const ids = M.normalize({ externalOrderId: ' 000777 ', invoiceNumber: 'T1234567890123', supplierName: ' Synthetic 株式会社 ' });
      assert.deepEqual([ids.externalOrderId, ids.invoiceNumber, ids.supplierName], ['000777', 'T1234567890123', 'Synthetic 株式会社'], 'identifiers stay trimmed strings');
      const extras = [{ name: '担当者', column: '1' }];
      const xrows = M.mappedRows([['001', '山田'], ['002', '']], { orderId: '0' }, defaults, { ...proof(), firstRow: 2 }, extras);
      assert.equal(xrows[0].extra['担当者'], '山田'); assert.ok(xrows[0].present.includes('extra:担当者')); assert.equal(xrows[1].extra['担当者'], ''); assert.ok(!xrows[1].present.includes('extra:担当者'));
      const xrecords = M.applyPlan([], M.planImport([], xrows));
      assert.equal(xrecords.find(r => r.values.orderId === '001').extra['担当者'], '山田', 'extras are stored on new records'); assert.deepEqual(xrecords.find(r => r.values.orderId === '002').extra, {}, 'a blank extra cell is not stored');
      const xblank = M.planImport(xrecords, M.mappedRows([['001', '']], { orderId: '0' }, defaults, { ...proof(2, 'b'), firstRow: 2 }, extras));
      assert.equal(xblank.rows[0].record.extra['担当者'], '山田', 'a blank extra cell keeps the stored value'); assert.equal(xblank.rows[0].changes.length, 0);
      const xchanged = M.planImport(xrecords, M.mappedRows([['001', '田中']], { orderId: '0' }, defaults, { ...proof(2, 'c'), firstRow: 2 }, extras));
      assert.deepEqual(xchanged.rows[0].changes, [{ field: 'extra:担当者', before: '山田', after: '田中' }], 'extra changes are labelled extra:<name>'); assert.equal(xrecords[0].extra['担当者'], '山田', 'the stored record is not mutated');
      return '10 prototype cases + 20 fields, money, identifiers, extras';
    });

    // 2 built app: the intake integration chained in the finance harness on its own ephemeral MongoDB (legs 1-20).
    let integration = null;
    await leg('2 built app intake legs', async () => {
      if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing (run nuxt build in this worktree first); no HTTP coverage claimed');
      if (!existsSync(path.join(REPO_ROOT, 'scripts/finance-intake-integration.cjs'))) throw new Error('NOT RUN: scripts/finance-intake-integration.cjs is missing');
      if (!/OMF_TEST_INTAKE_ONLY/.test(readFileSync(path.join(REPO_ROOT, 'scripts/finance-integration.cjs'), 'utf8'))) throw new Error('NOT RUN: the intake integration is not chained in scripts/finance-integration.cjs');
      integration = await run(['scripts/finance-integration.cjs'], { ...env, OMF_TEST_INTAKE_ONLY: '1' }, 1500000);
      await writeFile(path.join(REPO_ROOT, '.zoomer-intake-integration.txt'), integration.stdout + (integration.stderr ? '\n--- stderr ---\n' + integration.stderr : '')).catch(() => {});
      const done = integration.stdout.match(/(\d+) targeted intake checks passed/);
      if (integration.code !== 0 || !done || Number(done[1]) !== integration.passes.length || integration.passes.length < 21) throw new Error(`exit ${integration.killed ? 'timeout' : integration.code}, ${integration.passes.length} green: ${integrationTail(integration).slice(0, 900)}`);
      const worker = integration.passes.find(p => /^real worker:/.test(p)) || '', chrome = integration.passes.find(p => /^hidden real Chrome:/.test(p)) || '';
      if (!worker || !chrome) throw new Error(`mandatory legs missing: chrome=${!!chrome} worker=${!!worker}`);
      return `${integration.passes.length} legs green in ${Math.round(integration.ms / 1000)}s; ${worker.slice(0, 260)}`;
    });

    // 3 the sibling unit test
    await leg('3 unit tests', async () => {
      const r = await run(['--test', 'scripts/finance-intake.test.mjs'], env, 180000);
      const summary = r.stdout.match(/[#ℹ] pass (\d+)[\s\S]*?[#ℹ] fail (\d+)/);
      if (r.code !== 0 || !summary || summary[2] !== '0') throw new Error(`node --test exit ${r.code}: ${(r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|failed|Cannot find/i.test(l)).slice(0, 6).join(' | ').slice(0, 500)}`);
      return `${summary[1]} tests, 0 failed`;
    });

    // 4 mutants: each defect reintroduced into an isolated copy of the built output must make its named assertion fail.
    //   OMF_TEST_INTAKE_MUTANT=1 keeps the hidden-Chrome and real-worker legs out of the mutant runs (they ran once in leg 2).
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
          const r = await run([path.join(dir, 'scripts/finance-integration.cjs')], { ...env, OMF_TEST_INTAKE_ONLY: '1', OMF_TEST_INTAKE_MUTANT: '1' }, 600000, dir);
          const output = r.stdout + '\n' + r.stderr, flipped = r.code !== 0 && mutant.expect.test(output);
          transcript.push(`=== ${mutant.name} (${touched}) exit ${r.code} flipped=${flipped}\n${integrationTail(r).slice(0, 1200)}\n`);
          mutantNotes.push(`${mutant.name}:${flipped ? 'flipped' : 'NOT FLIPPED'}`);
          if (!flipped) throw new Error(`mutant ${mutant.name} did not flip ${mutant.expect} (exit ${r.code}): ${integrationTail(r).slice(0, 500)}`);
          await rm(dir, { recursive: true, force: true });
        }
      } finally { await writeFile(path.join(REPO_ROOT, '.zoomer-intake-mutants.txt'), transcript.join('\n')).catch(() => {}); await rm(base, { recursive: true, force: true }); }
      return mutantNotes.join(' ');
    });

    // 5 static: the worker files carry the intake lane (claim fallback after evaluation, intake/ route prefix in both route
    //   builders, artifact upload skipped for intake, status reports intakeResearch:true).
    await leg('5 static worker files', async () => {
      const worker = readFileSync(path.join(REPO_ROOT, 'research-worker/worker.mjs'), 'utf8'), tools = readFileSync(path.join(REPO_ROOT, 'research-worker/tools.mjs'), 'utf8'), runner = readFileSync(path.join(REPO_ROOT, 'research-worker/run.mjs'), 'utf8');
      assert.match(worker, /this\.api\(\s*['"]intake\/claim['"]\s*\)/, 'worker.mjs claims intake/claim');
      const claim = worker.indexOf("this.api('claim')"), evaluation = worker.indexOf("this.api('evaluation/claim')"), intake = worker.indexOf("this.api('intake/claim')");
      assert.ok(claim >= 0 && evaluation > claim && intake > evaluation, 'claim order: statement, evaluation, intake');
      assert.match(worker, /mode\s*===\s*['"]intake['"]\s*\?\s*['"]intake\/['"]/, 'worker.mjs jobRoute carries the intake/ prefix');
      assert.match(tools, /mode\s*===\s*['"]intake['"]\s*\?\s*['"]intake\/['"]/, 'tools.mjs api() carries the intake/ prefix');
      assert.match(tools, /mode\s*!==\s*['"]intake['"]/, 'tools.mjs skips the artifact upload for intake');
      assert.match(runner, /intakeResearch\s*:\s*true/, 'run.mjs reports intakeResearch:true');
      return 'intake/claim third, intake/ prefix in worker.mjs and tools.mjs, artifact skip, run.mjs status flag';
    });

    const databaseCoverage = integration && integration.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    const verdict = pass ? 'intake green' : setupFailures.length && setupFailures.length === lines.filter(l => / RED /.test(l)).length ? 'FAILED (setup only — not behavioural evidence)' : 'FAILED';
    return { pass, databaseCoverage, message: `${verdict} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

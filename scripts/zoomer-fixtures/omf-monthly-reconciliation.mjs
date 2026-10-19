// Fixture for plan omf-monthly-reconciliation-20261020 (5-plan.json): the four monthly-reconciliation repairs of review
// output/review/omf-monthly-readiness-opus55-20261020.md — F3 card-repayment list state, F2 month purchase review, F4 evidence
// attribution after edits, F1 typed spreadsheet cells / template drift / same-file reimport (bank reader unchanged).
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-monthly-reconciliation.mjs --cwd <this worktree>
// Legs: U1-U3 the three unit files (node --test, tap) with their F-tagged tests reported per group · B build freshness (the
// built app must be newer than every compiled source it covers, so a stale .output never passes) · I the dedicated harness
// scripts/finance-monthly-reconciliation-integration.cjs on its own MongoMemoryServer and built app with hidden real Chrome,
// reported per group F3/F2/F4/F1 and CHROME · M each group's deliberately reintroduced defects, applied to an isolated copy of
// the built output and required to fail their named harness assertion (run only for a group whose integration leg is green).
// Fold (plan omf-monthly-reconciliation-fold-20261020, review omf-monthly-patch-opus55-20261020 F1/F4): the same legs carry the
// negative cases P1/P2c/P3 (a re-read file row never re-keys a hand-corrected or already-repaired record) and E1/E2 (registry
// basis date vs current purchase date; no changed-after-research label without supported values), plus two mutants below.
// `covers` is decided at load: the built-app files are listed only when .output/server/index.mjs exists. Synthetic owners
// monthly-a/b@example.invalid only; no bank, mail, Slack, model, production database or shared harness is touched.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3600000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(REPO_ROOT, '.output', 'server', 'index.mjs'));
const PURE_COVERS = ['shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'shared/finance-intake.mjs', 'shared/finance-intake.d.mts', 'shared/finance-intake-evidence.mjs', 'shared/finance-intake-evidence.d.mts', 'scripts/finance-payment-match.test.mjs', 'scripts/finance-intake.test.mjs', 'scripts/finance-intake-evidence.test.mjs', 'scripts/zoomer-fixtures/omf-monthly-reconciliation.mjs'];
const APP_COVERS = ['server/services/financePaymentMatchService.ts', 'server/api/finance-payments/[...path].ts', 'pages/intake/payments.vue', 'server/services/financeIntakeResearchService.ts', 'components/intake/IntakePaymentMatches.vue', 'pages/intake/[id].vue', 'server/services/financeIntakeService.ts', 'components/intake/IntakeImporter.vue', 'scripts/finance-monthly-reconciliation-integration.cjs'];
// Compiled into .output: the build must be newer than each of these.
const COMPILED = ['shared/finance-payment-match.mjs', 'shared/finance-intake.mjs', 'shared/finance-intake-evidence.mjs', 'server/services/financePaymentMatchService.ts', 'server/api/finance-payments/[...path].ts', 'pages/intake/payments.vue', 'server/services/financeIntakeResearchService.ts', 'components/intake/IntakePaymentMatches.vue', 'pages/intake/[id].vue', 'server/services/financeIntakeService.ts', 'components/intake/IntakeImporter.vue'];
const GROUPS = ['F3', 'F2', 'F4', 'F1'];

// Deliberately reintroduced defects, per group: a whitespace-tolerant anchor in the built nitro chunks (exactly one match),
// the defect, and the harness assertion that must then fail.
export const MUTANTS = [
  { group: 'F3', name: 'repayment-derivation-removed', anchor: /if\s*\(\s*p\.kind\s*===\s*['"]card['"]\s*&&\s*p\.sourceKind\s*===\s*['"]repayment['"]\s*\)\s*Object\.assign\(\s*p\s*,\s*repaymentSettlement\(/g, replacement: "if (false) Object.assign(p, repaymentSettlement(", expect: /monthly:f3-partial/ },
  { group: 'F3', name: 'repayment-review-precedence-dropped', anchor: /state\s*:\s*card\.state\s*===\s*['"]review['"]\s*\|\|\s*flagged\s*\?/g, replacement: 'state: false ?', expect: /monthly:f3-(?:excess-review|currency-review|source-review)/ },
  { group: 'F2', name: 'undated-dropped', anchor: /if\s*\(\s*date\s*&&\s*\(\s*from\s*&&\s*date\s*<\s*from\s*\|\|\s*to\s*&&\s*date\s*>\s*to\s*\)\s*\)\s*continue/g, replacement: 'if (!date || (from && date < from || to && date > to)) continue', expect: /monthly:f2-month-bounds/ },
  { group: 'F2', name: 'unknown-total-as-zero', anchor: /total\s*:\s*t\.total\s*,\s*paid\s*:\s*t\.paid\s*,\s*refunded\s*:\s*t\.refunded\s*,\s*net\s*:\s*t\.net\s*,\s*remaining\s*:\s*t\.remaining/g, replacement: 'total: t.total ?? 0, paid: t.paid, refunded: t.refunded, net: t.net, remaining: t.remaining ?? 0', expect: /monthly:f2-unknown-null/ },
  { group: 'F4', name: 'confirmed-stale-suppressed', anchor: /r\.state\s*===\s*['"]confirmed['"]\s*\?\s*!confirmedResearchCurrent\(/g, replacement: "r.state === 'confirmed' ? false && (", expect: /monthly:f4-stale-after-url-edit/ },
  { group: 'F4', name: 'origin-ignores-url', anchor: /const\s+urlCurrent\s*=\s*!!research\?\.context\s*&&/g, replacement: 'const urlCurrent = true || ', expect: /monthly:f4-(?:stale-after-url-edit|historical-sources)/ },
  { group: 'F1', name: 'intake-reading-dropped', anchor: /readWorkbook\(\s*await\s+readFile\(\s*filePath\(\s*ownerId\s*,\s*doc\.hash\s*\)\s*\)\s*,\s*\{\s*intake\s*:\s*true\s*\}\s*\)/g, replacement: 'readWorkbook(await readFile(filePath(ownerId, doc.hash)))', expect: /monthly:f1-(?:numeric-id|date-iso)/ },
  { group: 'F1', name: 'provenance-rebind-dropped', anchor: /const\s+rebind\s*=\s*!old\s*&&/g, replacement: 'const rebind = false &&', expect: /monthly:f1-legacy-preview/ },
  { group: 'F4', name: 'registry-date-check-removed', anchor: /current\s*:\s*!dated\s*\|\|\s*dated\s*===\s*asOf/g, replacement: 'current: true', expect: /monthly:f4-date-basis-stale/ },
  { group: 'F1', name: 'identity-predicate-removed', anchor: /const\s+ownedByRow\s*=\s*\(\s*r\s*,\s*fileRow\s*,\s*key\s*\)\s*=>/g, replacement: 'const ownedByRow = (r, fileRow, key) => true ||', expect: /monthly:f1-manual-id-kept/ },
  { group: 'F1', name: 'bank-reader-default-changed', anchor: /const\s+typed\s*=\s*options\.intake\s*===\s*true\s*;/g, replacement: 'const typed = true;', expect: /monthly:f1-bank-(?:control|key-unchanged)/ }
];

function run(args, env, timeout, cwd = REPO_ROOT) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env }, (error, stdout, stderr) => resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}
async function chunkFiles(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await chunkFiles(full)); else if (entry.name.endsWith('.mjs')) out.push(full); } return out; }
async function applyMutant(outputDir, mutant) {
  let hits = 0, target = null;
  for (const file of await chunkFiles(path.join(outputDir, 'server', 'chunks'))) { const text = await readFile(file, 'utf8'), n = (text.match(mutant.anchor) || []).length; if (n) { hits += n; target = { file, text }; } }
  if (hits !== 1) throw new Error(`mutant ${mutant.name}: anchor matched ${hits} times (expected exactly 1)`);
  await writeFile(target.file, target.text.replace(mutant.anchor, mutant.replacement));
  return path.relative(outputDir, target.file);
}
async function removeOwned(dir) { if (!path.resolve(dir).startsWith(path.resolve(REPO_ROOT) + path.sep)) throw new Error('Unsafe mutation directory'); await rm(dir, { recursive: true, force: true }); }
const clip = (s, n = 900) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

export default {
  name: 'omf-monthly-reconciliation',
  covers: BUILT ? [...PURE_COVERS, ...APP_COVERS] : PURE_COVERS,
  async run() {
    const started = Date.now(), lines = [], env = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };
    let pass = true;
    const leg = async (name, fn) => { try { const note = await fn(); lines.push(`${name}: ok${note ? ' (' + note + ')' : ''}`); return true; } catch (error) { pass = false; lines.push(`${name}: RED — ${clip(error?.message || error, 1400)}`); return false; } };

    // U1-U3: the unit files. A missing helper fails its own F-tagged test; the reviewed tests of the same file keep running.
    for (const [label, file] of [['U1 payment unit (F3/F2 helpers, Vue compile)', 'scripts/finance-payment-match.test.mjs'], ['U2 intake unit (F1 dates/provenance, importer compile)', 'scripts/finance-intake.test.mjs'], ['U3 evidence unit (F4 helper, page compile)', 'scripts/finance-intake-evidence.test.mjs']]) {
      await leg(label, async () => {
        const r = await run(['--test', '--test-reporter=tap', file], env, 240000);
        await writeFile(path.join(REPO_ROOT, '.zoomer-monthly-' + path.basename(file, '.mjs') + '.txt'), r.stdout + '\n' + r.stderr).catch(() => {});
        const passed = Number(r.stdout.match(/^# pass (\d+)/m)?.[1] ?? NaN), failed = Number(r.stdout.match(/^# fail (\d+)/m)?.[1] ?? NaN);
        const failing = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
        if (r.code !== 0 || failed !== 0 || !Number.isFinite(passed)) throw new Error(`exit ${r.code}, ${passed} passed, ${failed} failed: ${failing.join(' | ')} — ${clip([...r.stdout.matchAll(/(monthly:[a-z0-9-]+[^\n]{0,160})/g)].map(m => m[1]).slice(0, 6).join(' | '), 900)}`);
        return `${passed} tests, 0 failed`;
      });
    }

    // B: the built app is newer than every compiled source it covers.
    const fresh = await leg('B build freshness', async () => {
      if (!BUILT) throw new Error('NOT RUN: .output/server/index.mjs is missing (nuxt build first); no HTTP coverage');
      const built = Date.parse(JSON.parse(readFileSync(path.join(REPO_ROOT, '.output', 'nitro.json'), 'utf8')).date);
      // A planned source that does not exist yet cannot be in the build; its absence shows up as the behavioural RED of the I legs.
      const newer = COMPILED.filter(f => existsSync(path.join(REPO_ROOT, f)) && statSync(path.join(REPO_ROOT, f)).mtimeMs > built + 1000);
      if (newer.length) throw new Error('build older than source (rebuild): ' + newer.join(', '));
      return 'built ' + new Date(built).toISOString();
    });

    // I: the dedicated harness, once, all groups and hidden Chrome; reported per group.
    let integration = null, summary = {};
    if (fresh) {
      integration = await run(['scripts/finance-monthly-reconciliation-integration.cjs'], { ...env, OMF_TEST_MONTHLY_SCREENSHOTS: process.env.OMF_TEST_MONTHLY_SCREENSHOTS || '' }, 1800000);
      await writeFile(path.join(REPO_ROOT, '.zoomer-monthly-integration.txt'), integration.stdout + (integration.stderr ? '\n--- stderr ---\n' + integration.stderr : '')).catch(() => {});
      try { summary = JSON.parse(integration.stdout.match(/^MONTHLY_RESULT (.+)$/m)?.[1] || '{}'); } catch { summary = {}; }
    }
    const setupOk = !!integration && /^SETUP owned MongoMemoryServer/m.test(integration.stdout) && !summary.SETUP;
    for (const g of [...GROUPS, 'CHROME']) {
      await leg(`I ${g} integration`, async () => {
        if (!integration) throw new Error('NOT RUN: build leg is not green; no HTTP coverage');
        if (!setupOk) throw new Error('SETUP failed: ' + clip(integration.stdout.split('\n').filter(l => /FAIL SETUP|Error/.test(l)).slice(0, 4).join(' | ') || integration.stderr, 900));
        if (g === 'CHROME' && !/^hidden real Chrome: /m.test(integration.stdout)) throw new Error('mandatory hidden Chrome leg did not run');
        const r = summary[g];
        if (!r) throw new Error('group not reported');
        const passes = integration.stdout.split('\n').filter(l => l.startsWith('PASS ' + g + ':')).length;
        if (!r.pass) throw new Error(`${passes} checks green before: ${clip(r.failures.join(' | '), 1200)}`);
        return `${r.checks} checks green`;
      });
    }

    // M: each group's mutants, only for a group whose integration leg is green; OMF_TEST_MONTHLY_MUTANT=1 skips Chrome.
    const caught = [];
    for (const g of GROUPS) {
      await leg(`M ${g} mutants`, async () => {
        if (!summary[g]?.pass || !setupOk) throw new Error('NOT RUN: integration leg ' + g + ' is not green, mutants prove nothing');
        const base = path.join(REPO_ROOT, '.monthly-mutants'), notes = [];
        await removeOwned(base); await mkdir(base, { recursive: true });
        try {
          for (const mutant of MUTANTS.filter(m => m.group === g)) {
            const dir = path.join(base, mutant.name);
            for (const part of ['scripts', 'shared']) await cp(path.join(REPO_ROOT, part), path.join(dir, part), { recursive: true });
            await cp(path.join(REPO_ROOT, '.output'), path.join(dir, '.output'), { recursive: true, dereference: true });
            const touched = await applyMutant(path.join(dir, '.output'), mutant);
            const r = await run([path.join(dir, 'scripts/finance-monthly-reconciliation-integration.cjs')], { ...env, OMF_TEST_MONTHLY_LEGS: g, OMF_TEST_MONTHLY_MUTANT: '1' }, 900000, dir);
            const output = r.stdout + '\n' + r.stderr, flipped = r.code !== 0 && mutant.expect.test(output.split('\n').filter(l => l.startsWith('FAIL ' + g + ':')).join('\n'));
            await writeFile(path.join(REPO_ROOT, '.zoomer-monthly-mutant-' + mutant.name + '.txt'), `${touched} exit ${r.code} flipped=${flipped}\n` + output).catch(() => {});
            notes.push(`${mutant.name}:${flipped ? 'caught' : 'NOT CAUGHT'}`);
            if (!flipped) throw new Error(`mutant ${mutant.name} did not fail ${mutant.expect} (exit ${r.code}): ${clip(output.split('\n').filter(l => /^FAIL|^PASS/.test(l)).slice(-4).join(' | '), 600)}`);
            await removeOwned(dir);
          }
        } finally { await removeOwned(base); }
        caught.push(...notes);
        return notes.join(' ');
      });
    }
    await writeFile(path.join(REPO_ROOT, '.zoomer-monthly-mutants.json'), JSON.stringify(caught, null, 2)).catch(() => {});
    const executed = setupOk;
    return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'monthly reconciliation green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

// Fixture for plan omf-downloader-release-ready-20261028: the PC downloader no longer ends when the pinned rebrowser-puppeteer-core
// 23.10.3 fails an out-of-process iframe's initialization (the installed collector's 2026-10-28 "Network.enable timed out" exit).
// collector/puppeteer-frame-init.mjs backports the upstream puppeteer#14701 callback (.catch(debugError) on that one `void initialize`)
// and collector/browser.mjs loads it; collector/package/stage.mjs ships it. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-downloader-protocol-recovery.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only — the actual installed SDK in separate processes and an owned HEADLESS Chrome on a
// fictional local page (collector/test/frame-init.test.mjs). No bank page can be replayed (none was recorded); no bank, credential,
// vault, owner profile, database or visible browser is touched.
// Legs: F fail-first — the suite against the exact 5b7ef2c6 collector/browser.mjs (a sibling copy, OMF_TEST_BROWSER_MODULE) fails its
// named survival assertions (fictional session and real Chrome) while its controls stay green; U the suite fresh on the candidate;
// M named mutants of the helper / the browser import, each caught by its named assertion; P the real stage() package carries the exact
// helper with the locked dependencies (default: an owned copy of this worktree's installed tree, used only when every installed package
// is the staged lock's version and integrity; packageProof(…, { install: true }) runs the production `npm ci --omit=dev --ignore-scripts`
// instead — too slow for the hub's 15-minute cap, so it is run and kept separately), the suite passes on the STAGED browser module and
// lane, the staged package with the catch removed fails the survival assertion, and a stage allowlist without the helper fails its
// named manifest check; B a byte proof that browser.mjs differs from 5b7ef2c6 by the one export line only (launch flags, ownership,
// closure, geometry, showWindow unchanged) and the reversible test-only copy of the browser-boundary legs B1-B7 (B8 calls showWindow
// and brings a window to the front: excluded by the owner's no-foreground order, never run, never counted). The copy's headless
// Chrome legs are timing-bound and varied between runs under other sessions' load (fixture-01/03/04), so they are not part of this
// verdict: they run separately, interleaved on this tree and on an exported 5b7ef2c6 tree (boundaryCopy(temp, tree), containHook);

// C every production importer of collector/browser.mjs is in the declared caller table. M, P and B run only on a green U.
// Test processes run at Normal through the Ikeda fixture's proven scoped preload and non-blocking sampler (imported, unchanged).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 900000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '5b7ef2c6b6bef52cc69d984e81c8eafadb7cb064';
const HELPER = 'collector/puppeteer-frame-init.mjs', BROWSER = 'collector/browser.mjs', STAGE = 'collector/package/stage.mjs', TEST = 'collector/test/frame-init.test.mjs', BOUNDARY = 'collector/test/browser-boundary.test.mjs';
const COVERS = [HELPER, BROWSER, STAGE, TEST, 'docs/bank-balances.md', 'scripts/zoomer-fixtures/omf-downloader-protocol-recovery.mjs'];
const EXPORT_LINE = "export { FRAME_INIT_FIX } from './puppeteer-frame-init.mjs'; // pinned-SDK fix, in place before any launch: a failed iframe initialization no longer ends the process (puppeteer#14701)";
const ENV = { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, args, env = {}, timeout = 600000, cwd = root) => new Promise(resolve => execFile(file, args, { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...ENV, ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
// OMF_DOWNLOADER_RECOVERY_EVIDENCE_DIR (optional, an existing directory): the complete output of each child run is kept there.
const keep = async (name, r) => { const dir = process.env.OMF_DOWNLOADER_RECOVERY_EVIDENCE_DIR; if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr + '\n--- priorities ---\n' + JSON.stringify({ preload: r.preload ?? null, sampled: r.sampled ?? null, samples: r.samples ?? null }, null, 2), { flag: 'wx' }).catch(() => {}); return r; };
const names = text => [...text.matchAll(/^\s*test\('((?:\\.|[^'\\])*)'/gm)].map(m => m[1].replace(/\\(.)/g, '$1'));
function tap(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length === 0).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null })) };
}
const exactPattern = name => '--test-name-pattern=^' + name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&') + '$';
const harnessBroken = text => /ERR_MODULE_NOT_FOUND|SyntaxError|harness setup:/.test(text);
let P = null; // the Ikeda fixture's priority preload / sampler (scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs, unchanged)
const suite = async (label, args, env, temp, timeout = 600000) => {
  const r = await keep(label, await P.nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', ...args], env, timeout, temp));
  return { r, t: tap(r.stdout), text: r.stdout + '\n' + r.stderr, priority: P.normalProof(r, label) };
};
const brief = p => `${p.testProcesses} test processes Normal (before ${p.before.join('/')}); sampler ${p.samples.ok}/${p.samples.attempted} ok, ${p.samples.unavailable} unavailable, ${p.samples.skippedOverlap} skipped, ${p.samples.pendingAtExit} pending, self ${[...new Set(p.samples.samplerSelf)].join('/') || 'none'}`;
const redLines = text => text.split('\n').filter(l => /frame-init:|error: /.test(l)).slice(0, 8).join(' | ').slice(0, 1400);

// ── sibling copies (so relative imports resolve); every anchor must hit exactly once, else it is a harness failure ──
async function sibling(rel, text, tag) {
  const target = path.join(root, path.dirname(rel), path.basename(rel, '.mjs') + `.${tag}-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, name: path.basename(target), async dispose() { await unlink(target).catch(() => {}); } };
}
function edit(text, edits, guard = null) {
  text = text.replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [a, b] of edits) { const hits = text.split(a).length - 1; if (hits !== 1) throw new Error('FAIL anchor hits ' + hits + ': ' + a.slice(0, 80)); text = text.replace(a, () => b); }
  return text;
}
// a browser module copy whose helper import names `helperName` (or, with helperName null, has no helper at all)
async function browserWith(helperName, tag) {
  const text = await readFile(path.join(root, BROWSER), 'utf8');
  return sibling(BROWSER, helperName ? edit(text, [["from './puppeteer-frame-init.mjs';", `from './${helperName}';`]]) : edit(text, [[EXPORT_LINE + '\n', '']]), tag);
}

const CATCH = 'void this.initialize(target._session(), frame).catch(debugError);';
export const RECOVERY_MUTANTS = [
  { name: 'MF1-catch-removed (the 23.10.3 callback again)', helper: [[CATCH, 'void this.initialize(target._session(), frame);']], tests: ['^through collector/browser.mjs'], expect: [/frame-init:callback-fault-survives exit 1/] },
  { name: 'MF2-browser-module-without-the-helper', browserOnly: true, tests: ['^through collector/browser.mjs'], expect: [/frame-init:callback-fault-survives exit 1/] },
  { name: 'MF3-catch-on-the-awaited-path (initialize itself swallows)', helper: [[CATCH, 'void this.initialize(target._session(), frame);'], ["  return 'installed';\n}", "  const init = FrameManager.prototype.initialize; FrameManager.prototype.initialize = function (...args) { return init.apply(this, args).catch(debugError); };\n  return 'installed';\n}"]], tests: ['^awaited initialization'], expect: [/frame-init:awaited-still-rejects/] },
  { name: 'MF4-process-wide-rejection-handler', helper: [['/** state:', "process.on('unhandledRejection', debugError);\n/** state:"]], tests: ['^an unrelated unhandled rejection'], expect: [/frame-init:unrelated-rejection-fatal/] },
  { name: 'MF5-non-iframe-targets-initialized', helper: [["  if (target._getTargetInfo().type !== 'iframe') {", "  if (target._getTargetInfo().type === 'page') {"]], tests: ['^iframe, page and worker targets'], expect: [/frame-init:noniframe-untouched/] },
  { name: 'MF6-frame-event-listeners-lost', helper: [['\n  this.setupEventListeners(target._session());\n', '\n']], tests: ['^iframe, page and worker targets'], expect: [/frame-init:healthy-iframe-same-calls/] },
  { name: 'MF7-pinned-text-check-removed (an unknown SDK method replaced)', guard: 'frame-init-pinned-text', tests: ['^a library whose callback'], expect: [/frame-init:unknown-method-untouched/] }
];
export async function mutantCheck(m, temp) {
  const disposables = [];
  try {
    let browser;
    if (m.browserOnly) browser = await browserWith(null, 'mutant');
    else { const helper = await sibling(HELPER, edit(await readFile(path.join(root, HELPER), 'utf8'), m.helper || [], m.guard || null), 'mutant'); disposables.push(helper); browser = await browserWith(helper.name, 'mutant'); }
    disposables.push(browser);
    const { r, text, priority } = await suite('M-' + m.name.split(' ')[0], [...m.tests.map(t => '--test-name-pattern=' + t), TEST], { OMF_TEST_BROWSER_MODULE: browser.file }, temp);
    if (harnessBroken(text)) throw new Error(m.name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
    if (!/^# tests [1-9]/m.test(r.stdout)) throw new Error(m.name + ' selected no test');
    const missed = m.expect.filter(e => !e.test(text));
    if (r.code === 0 || missed.length) throw new Error(m.name + ' NOT caught by ' + missed.join(', ') + ' (exit ' + r.code + '): ' + (redLines(text) || text.slice(-500)));
    return { name: m.name.split(' ')[0], before: priority.before };
  } finally { for (const d of disposables) await d.dispose(); }
}

// ── P: the staged package ──
const DEPS_CHILD = `import { cp, readdir, readFile } from 'node:fs/promises'; import { createHash } from 'node:crypto'; import path from 'node:path';
const [mode, from, to, sub] = process.argv.slice(2);
if (mode === 'copy') await cp(from, to, { recursive: true, verbatimSymlinks: true });
const hash = async dir => { const out = {}; const walk = async (d, rel) => { for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isSymbolicLink()) out[r] = 'link'; else if (e.isDirectory()) await walk(p, r); else out[r] = createHash('sha256').update(await readFile(p)).digest('hex'); } }; await walk(dir, ''); return out; };
const [a, b] = await Promise.all([hash(path.join(from, sub)), hash(path.join(to, sub))]), keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
console.log('DEPS ' + JSON.stringify({ files: keys.length, differ: keys.filter(k => a[k] !== b[k]), frameManager: b['lib/esm/puppeteer/cdp/FrameManager.js'] })); process.exit(0);
`;
export function stagedHelperProblems(manifest, repoHelper, repoBrowser) {
  const problems = [];
  if (manifest.files?.[HELPER] !== repoHelper) problems.push('frame-init:staged-helper-listed (manifest ' + (manifest.files?.[HELPER] ?? 'absent') + ')');
  if (manifest.files?.[BROWSER] !== repoBrowser) problems.push('frame-init:staged-browser-listed');
  return problems;
}
export async function packageProof(temp, assert, { install = false } = {}) {
  const out = [], repoHelper = sha256(await readFile(path.join(root, HELPER))), repoBrowser = sha256(await readFile(path.join(root, BROWSER)));
  // short paths: New-FileCatalog cannot read a staged file whose full path exceeds 260 characters (fixture-01 RED)
  const { stage } = await import(pathToFileURL(path.join(root, STAGE)).href), into = path.join(temp, 's'), t0 = Date.now();
  const { manifest, signing } = await stage({ into, origin: 'https://omf.example', install, log: () => {} });
  assert.deepEqual(stagedHelperProblems(manifest, repoHelper, repoBrowser), [], 'frame-init:staged-manifest');
  assert.equal(sha256(await readFile(path.join(into, HELPER))), repoHelper, 'frame-init:staged-helper-bytes'); assert.equal(sha256(await readFile(path.join(into, BROWSER))), repoBrowser, 'frame-init:staged-browser-bytes');
  assert.equal(manifest.installed === true, install, 'frame-init:staged-install-mode'); assert.equal(signing.signed, false, 'frame-init:staged-unsigned-test-artifact');
  assert.ok(!Object.keys(manifest.files).some(f => f.includes('/test/') || /mutant|baseline|zoomer|qualified/.test(f)), 'frame-init:no-test-code-staged');
  const lock = sha256(await readFile(path.join(root, 'collector/package-lock.json'))); assert.equal(sha256(await readFile(path.join(into, 'collector/package-lock.json'))), lock, 'frame-init:staged-lock');
  out.push(`stage(install: ${install ? 'npm ci --omit=dev --ignore-scripts' : 'false, then the owned locked dependency copy'}) ${Object.keys(manifest.files).length} files in ${Math.round((Date.now() - t0) / 1000)}s, UNSIGNED test artifact; helper ${repoHelper.slice(0, 12)}… and browser ${repoBrowser.slice(0, 12)}… staged byte-equal; lock ${lock.slice(0, 12)}… equal`);
  // dependencies: `npm ci` from the staged lock, or (default; the Ikeda fixture's P leg) an owned copy of this worktree's installed tree,
  // used only when it is a real directory whose installed packages are exactly the staged lock's
  const deps = path.join(root, 'collector', 'node_modules'), info = await lstat(deps).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error('harness setup: no real collector/node_modules directory in this worktree (missing dependencies are not a pass)');
  const locked = JSON.parse(await readFile(path.join(into, 'collector/package-lock.json'), 'utf8')).packages, installed = JSON.parse(await readFile(path.join(deps, '.package-lock.json'), 'utf8')).packages;
  const lockDiff = Object.keys(locked).filter(k => k && !locked[k].dev).filter(k => installed[k]?.version !== locked[k].version || (locked[k].integrity && installed[k]?.integrity !== locked[k].integrity));
  assert.deepEqual(lockDiff, [], 'frame-init:installed-deps-are-the-lock');
  // the copy and the SDK hashing run in a Normal-priority child (fixture-02 was interrupted: in this Idle verifier process, under 100% CPU
  // from other sessions, an in-process 250 MB copy and whole-tree hash starved); the whole-tree npm ci parity is kept by its separate run
  const depsScript = path.join(temp, 'deps-' + randomUUID().slice(0, 8) + '.mjs');
  await writeFile(depsScript, DEPS_CHILD, { flag: 'wx' });
  const d = await keep('P-deps', await P.nodeTest([depsScript, install ? 'none' : 'copy', deps, path.join(into, 'collector', 'node_modules'), 'rebrowser-puppeteer-core'], {}, 900000, temp));
  P.normalProof(d, 'P deps'); const dm = d.stdout.match(/^DEPS (.+)$/m); if (d.code !== 0 || !dm) throw new Error('dependency child failed: ' + (d.stderr || d.stdout).replace(/\s+/g, ' ').slice(-600));
  const deps1 = JSON.parse(dm[1]);
  assert.deepEqual(deps1.differ, [], 'frame-init:staged-sdk-identical');
  assert.equal(deps1.frameManager, 'a9303d2312f1f04330d81276c5463ab12fafc3a24a9be9b58562ba51f2a0ff6d', 'frame-init:staged-sdk-is-the-reproduced-23.10.3');
  out.push(`dependencies: ${lockDiff.length} installed-vs-lock mismatches (${Object.keys(installed).length} packages); staged SDK ${deps1.files} files identical to this worktree's (FrameManager.js a9303d23…, the reproduced 23.10.3)`);
  // the suite on the STAGED browser module, SDK and balance lane
  const stagedBrowser = path.join(into, BROWSER), own = names(await readFile(path.join(root, TEST), 'utf8'));
  const s = await suite('P-staged-suite', [TEST], { OMF_TEST_BROWSER_MODULE: stagedBrowser }, temp);
  if (s.r.code !== 0 || s.t.fail || s.t.skipped || s.t.todo || s.t.cancelled || s.t.tests !== own.length || own.some(n => !s.t.list.some(x => x.ok && x.name === n))) throw new Error('staged suite: exit ' + s.r.code + ' tests ' + s.t.tests + ' pass ' + s.t.pass + ': ' + (redLines(s.text) || s.text.slice(-600)));
  out.push(`staged suite ${s.t.pass}/${s.t.tests} green on the staged browser.mjs + node_modules + bank-balance.mjs (${brief(s.priority)})`);
  // the staged index graph in a child with an owned collector home
  const home = path.join(temp, 'collector-home'); await mkdir(home, { recursive: true });
  const probe = path.join(temp, 'staged-probe.mjs');
  await writeFile(probe, `import path from 'node:path'; import { pathToFileURL } from 'node:url'; const into = process.argv[2], u = r => pathToFileURL(path.join(into, r)).href;
const index = await import(u('collector/index.mjs')), browser = await import(u('collector/browser.mjs')), { FrameManager } = await import(u('collector/node_modules/rebrowser-puppeteer-core/lib/esm/puppeteer/cdp/FrameManager.js'));
console.log('PROBE ' + JSON.stringify({ startCollector: typeof index.startCollector, state: browser.FRAME_INIT_FIX?.state, caught: /\\.catch\\(debugError\\)/.test(String(FrameManager.prototype.onAttachedToTarget)), rejectionListeners: process.listenerCount('unhandledRejection') })); process.exit(0);`, { flag: 'wx' });
  const g = await keep('P-staged-graph', await run(process.execPath, [probe, into], { OMF_COLLECTOR_DIR: home, LOCALAPPDATA: path.join(temp, 'localappdata'), APPDATA: path.join(temp, 'appdata'), NODE_OPTIONS: '' }, 120000));
  const gm = g.stdout.match(/^PROBE (.+)$/m); if (g.code !== 0 || !gm) throw new Error('staged graph import failed: ' + (g.stderr || g.stdout).replace(/\s+/g, ' ').slice(-600));
  assert.deepEqual(JSON.parse(gm[1]), { startCollector: 'function', state: 'installed', caught: true, rejectionListeners: 0 }, 'frame-init:staged-graph');
  out.push('staged index.mjs graph imports in a child with an owned collector home; FRAME_INIT_FIX installed on the staged SDK, no rejection listener');
  // the staged package with the catch removed: its own survival assertions fail
  const helperFile = path.join(into, HELPER), original = await readFile(helperFile);
  await writeFile(helperFile, edit(original.toString('utf8'), [[CATCH, 'void this.initialize(target._session(), frame);']]));
  try {
    const x = await suite('P-staged-catch-removed', ['--test-name-pattern=^through collector/browser.mjs', TEST], { OMF_TEST_BROWSER_MODULE: stagedBrowser }, temp);
    if (harnessBroken(x.text)) throw new Error('staged catch-removed harness failure: ' + x.text.replace(/\s+/g, ' ').slice(-500));
    if (x.r.code === 0 || !/frame-init:callback-fault-survives exit 1/.test(x.text)) throw new Error('the staged package without the catch was NOT caught (exit ' + x.r.code + '): ' + redLines(x.text));
    out.push('staged package with the catch removed: frame-init:callback-fault-survives red (exit 1)');
  } finally { await writeFile(helperFile, original); }
  assert.equal(sha256(await readFile(helperFile)), repoHelper, 'frame-init:staged-helper-restored');
  // a stage allowlist without the helper: the named manifest check fails (the staged browser.mjs would then not load at all)
  const stageMutant = await sibling(STAGE, edit(await readFile(path.join(root, STAGE), 'utf8'), [["'browser','puppeteer-frame-init',", "'browser',"]]), 'mutant');
  try {
    const m = await import(pathToFileURL(stageMutant.file).href), omitted = await m.stage({ into: path.join(temp, 'o'), origin: 'https://omf.example', install: false, log: () => {} });
    const problems = stagedHelperProblems(omitted.manifest, repoHelper, repoBrowser);
    if (!problems.some(p => p.startsWith('frame-init:staged-helper-listed'))) throw new Error('the allowlist without the helper was NOT caught: ' + JSON.stringify(problems));
    out.push('stage allowlist without the helper: ' + problems.join(', '));
  } finally { await stageMutant.dispose(); }
  return out.join('; ');
}

// ── B: the headless boundary legs through a reversible test-only copy ──
const CONTAIN = "\n;{const __fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=o=>__fixtureLaunch({...o,headless:true,args:[...(o?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});}\nexport const __fixtureHeadless=true;\nprocess.stderr.write('[fixture-headless-control] '+import.meta.url+'\\n');\n";
export async function containHook(temp) {
  const file = path.join(temp, 'contain-hook-' + randomUUID().slice(0, 8) + '.mjs');
  await writeFile(file, `import { registerHooks } from 'node:module';\nregisterHooks({ load(url, context, next) { const r = next(url, context); return /\\/browser\\.mjs$/.test(url) && /export const LAUNCH_ARGS/.test(String(r.source)) ? { ...r, source: String(r.source) + ${JSON.stringify(CONTAIN)} } : r; } });\n`, { flag: 'wx' });
  return file;
}
const B8 = "    await leg('B8 background bank launch (headed)";
export async function boundaryCopy(temp, tree = root) {
  const original = path.join(tree, BOUNDARY), before = await readFile(original, 'utf8'), originalUrl = pathToFileURL(original).href, pairs = []; let text = before;
  const change = (a, b) => { const hits = text.split(a).length - 1; if (hits !== 1) throw new Error('FAIL bootstrap anchor hits ' + hits + ': ' + a.slice(0, 90)); text = text.replace(a, () => b); pairs.push([a, b]); };
  change("from './fake-broker.mjs';", `from '${pathToFileURL(path.join(tree, 'collector/test/fake-broker.mjs')).href}';`);
  const pkg = JSON.parse(await readFile(path.join(tree, 'collector/node_modules/rebrowser-puppeteer-core/package.json'), 'utf8')), entry = pkg.exports?.['.']?.import;
  if (typeof entry !== 'string') throw new Error('harness setup: rebrowser-puppeteer-core ESM entry not found in collector/node_modules');
  change("(await import('rebrowser-puppeteer-core')).default", `(await import('${pathToFileURL(path.join(tree, 'collector/node_modules/rebrowser-puppeteer-core', entry)).href}')).default`);
  change(B8, "    /* B8 EXCLUDED: owner no-foreground order (showWindow brings the window to the front) */ if (false) await leg('B8 background bank launch (headed)");
  const literal = JSON.stringify(originalUrl); if (text.includes(literal)) throw new Error('FAIL the original URL literal already occurs');
  const metaCount = text.split('import.meta.url').length - 1; text = text.split('import.meta.url').join(literal);
  let back = text.split(literal).join('import.meta.url'); for (const [a, b] of [...pairs].reverse()) { if (back.split(b).length !== 2) throw new Error('FAIL copy not reversible'); back = back.replace(b, () => a); }
  if (back !== before) throw new Error('FAIL the boundary copy differs from the original beyond its substitutions');
  const checks = s => s.split('\n').filter(l => /\bcheck\(/.test(l)).map(l => l.split(literal).join('import.meta.url'));
  if (JSON.stringify(checks(before)) !== JSON.stringify(checks(text))) throw new Error('FAIL a check line changed in the boundary copy');
  const target = path.join(temp, 'browser-boundary.qualified-' + randomUUID().slice(0, 8) + '.mjs'); await writeFile(target, text, { flag: 'wx' });
  const blob = (await run('git', ['rev-parse', 'HEAD:' + BOUNDARY])).stdout.trim(), hashed = (await run('git', ['hash-object', original])).stdout.trim();
  const ev = process.env.OMF_DOWNLOADER_RECOVERY_EVIDENCE_DIR; if (ev) await writeFile(path.join(ev, path.basename(target) + '.source.json'), JSON.stringify({ original: BOUNDARY, headBlob: blob, originalGitBlob: hashed, copySha256: sha256(text), pairs, importMetaUrlRelocated: metaCount, reversibleToOriginalBytes: true, checkLinesUnchanged: checks(before).length, excluded: ['B8'] }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
  return { file: target, unchangedFromHead: blob === hashed, blob, substitutions: pairs.length, metaCount, checks: checks(before).length };
}
async function boundaryProof(temp, assert) {
  // browser.mjs differs from 5b7ef2c6 by exactly the one export line: launch flags, ownership, geometry and showWindow are unchanged
  const head = (await run('git', ['show', BASE + ':' + BROWSER])).stdout.replace(/\r\n/g, '\n'), now = (await readFile(path.join(root, BROWSER), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(now.split('\n').filter(l => l === EXPORT_LINE).length, 1, 'frame-init:one-export-line'); assert.equal(now.split('\n').filter(l => l !== EXPORT_LINE).join('\n'), head, 'frame-init:browser-otherwise-unchanged');
  for (const name of ['showWindow', 'backgroundPage', 'browserFor', 'closeEntry', 'recoverEphemeral']) assert.ok(head.includes('function ' + name + '(') && now.includes('function ' + name + '('), 'frame-init:unchanged-function ' + name);
  // the reversible test-only copy the separate A/B runner executes (B8 excluded) is generated and proven here; Chrome is not launched
  const copy = await boundaryCopy(temp);
  assert.equal(copy.unchangedFromHead, true, 'frame-init:boundary-test-unchanged');
  return `browser.mjs = ${BASE.slice(0, 8)} + the one export line (launch flags, ownership, closure, geometry and showWindow byte-identical); boundary copy of blob ${copy.blob.slice(0, 12)}… reversible (${copy.substitutions} substitutions + ${copy.metaCount} import.meta.url, ${copy.checks} check lines unchanged, B8 excluded); its headless B1-B7 legs run in the separate candidate/baseline A/B runs, not here`;
}

// ── C: every production importer of collector/browser.mjs is classified ──
export const CALLERS = {
  'collector/index.mjs': 'Amex/Aplus statement collection, startup recovery, lock/expiry/locked closure: U (fault/healthy SDK), P (staged index graph), B1-B7 through startCollector in the separate candidate/baseline A/B runs',
  'collector/bank.mjs': 'bank statement/observe/guided setup and balance (withBankBrowser, dynamic): U real-Chrome lane runs bank-balance/ensureBankLogin through the same launcher',
  'collector/yayoi.mjs': 'Yayoi export (dynamic browserFor): same launcher and SDK instance; no own SDK callback; proven by mechanism, not run',
  'cloud-probe/run.mjs': 'Railway Amex probe container (amexPage/collectFromPage); its image copies collector/*.mjs (helper included); excluded from execution',
  'research-worker/browser.mjs': 'public research reader (browserFor): same launcher and SDK instance; public network; proven by mechanism, not run',
  'teaching-worker/worker.mjs': 'Chrome presence check only (findChrome, dynamic); no launch'
};
const RUNTIME = ['collector', 'cloud-probe', 'research-worker', 'teaching-worker', 'review-worker', 'finalization-worker', 'server', 'shared'];
async function importers() {
  const found = new Set(), skip = new Set(['node_modules', '.git', '.nuxt', '.output', 'test', 'tests', 'zoomer-fixtures', 'output']);
  const walk = async dir => { for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) { if (e.name.startsWith('_wt_') || e.name.startsWith('.') && e.name !== '.') continue; const p = path.join(dir, e.name); if (e.isDirectory()) { if (!skip.has(e.name)) await walk(p); } else if (/\.(mjs|js|cjs|ts)$/.test(e.name)) { const text = await readFile(p, 'utf8'); for (const m of text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]*browser\.mjs)['"]/g)) { if (!m[1].startsWith('.')) continue; if (path.resolve(path.dirname(p), m[1]) === path.join(root, BROWSER) && p !== path.join(root, BROWSER)) found.add(path.relative(root, p).split(path.sep).join('/')); } } } };
  for (const dir of RUNTIME) await walk(path.join(root, dir)); return [...found].sort();
}

export default { name: 'omf-downloader-protocol-recovery', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, unitGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, mutantsCaught: 0, mutantsTotal: 0, excluded: ['B8', 'B1-B7 Chrome legs (separate A/B runs)'] };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 3000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  P = await import(pathToFileURL(path.join(root, 'scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs')).href);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-drf-'));
  const own = names(await readFile(path.join(root, TEST), 'utf8'));
  try {
    // ── F ──
    await leg('F fail-first: the suite against the exact ' + BASE.slice(0, 8) + ' collector/browser.mjs fails its named survival assertions; its controls pass', async () => {
      const shown = await run('git', ['show', BASE + ':' + BROWSER]);
      if (shown.code !== 0) throw new Error('baseline ' + BASE + ' is not readable here: ' + shown.stderr.slice(0, 300));
      if (shown.stdout.includes('puppeteer-frame-init')) throw new Error('the baseline copy already holds the change');
      const base = await sibling(BROWSER, shown.stdout, 'baseline');
      try {
        const { r, t, text, priority } = await suite('F-baseline', [TEST], { OMF_TEST_BROWSER_MODULE: base.file }, temp);
        if (harnessBroken(text)) throw new Error('harness failure: ' + text.replace(/\s+/g, ' ').slice(-500));
        assert.notEqual(r.code, 0, 'frame-init:baseline-red');
        assert.match(text, /frame-init:callback-fault-survives exit 1/, 'frame-init:baseline-named-callback'); assert.match(text, /frame-init:chrome-survives exit 1: .*ProtocolError: Network\.enable timed out\. fictional injection/, 'frame-init:baseline-named-chrome');
        const okNamed = re => t.list.some(x => x.ok && re.test(x.name));
        for (const re of [/^the unpatched SDK callback/, /^iframe, page and worker targets/, /^awaited initialization/, /^an unrelated unhandled rejection/]) assert.ok(okNamed(re), 'frame-init:baseline-control-green ' + re.source);
        return `baseline ${BASE.slice(0, 8)} browser.mjs: ${t.fail}/${t.tests} red (${t.list.filter(x => !x.ok).map(x => x.name.slice(0, 50)).join(' | ')}); named callback-fault-survives and chrome-survives (with the captured ProtocolError) seen; controls green; ${brief(priority)}`;
      } finally { await base.dispose(); }
    });
    // ── U ──
    unitGreen = await leg('U the suite fresh on the candidate (actual SDK children and real headless Chrome lane)', async () => {
      const { r, t, text, priority } = await suite('U-suite', [TEST], {}, temp);
      if (r.code !== 0 || t.fail || t.skipped || t.todo || t.cancelled || t.tests !== own.length || own.some(n => !t.list.some(x => x.ok && x.name === n))) throw new Error(`exit ${r.code} tests ${t.tests}/${own.length} pass ${t.pass} fail ${t.fail}: ` + (redLines(text) || r.stderr.slice(-600)));
      counts.unitTests = t.pass;
      return `${t.pass}/${t.tests} green, names derived from the suite source; ${brief(priority)}`;
    });
    if (!unitGreen) { lines.push('M, P, B: NOT RUN — U is red (a mutant is only meaningful against a green control)'); counts.legs += 3; }
    // ── M ──
    if (unitGreen) await leg('M mutants: MF1…MF7 (helper and browser import), each caught by its named assertion', async () => {
      const caught = [], missed = [];
      for (const m of RECOVERY_MUTANTS) { counts.mutantsTotal++; try { caught.push((await mutantCheck(m, temp)).name); counts.mutantsCaught++; } catch (e) { missed.push(String(e?.message || e).slice(0, 700)); } }
      if (missed.length) throw new Error(caught.length + '/' + counts.mutantsTotal + ' caught (' + caught.join(', ') + '); NOT caught or harness failure: ' + missed.join(' ;; '));
      return caught.length + '/' + counts.mutantsTotal + ' caught: ' + caught.join(', ');
    });
    // ── P ──
    if (unitGreen) await leg('P package: real stage(); staged helper, locked dependencies, the suite on the staged lane, staged catch removed fails, allowlist without the helper fails', () => packageProof(temp, assert));
    // ── B ──
    if (unitGreen) await leg('B boundary: browser.mjs otherwise byte-identical to ' + BASE.slice(0, 8) + '; the reversible B1-B7 copy (B8 excluded) generated for the separate A/B runs', () => boundaryProof(temp, assert));
    // ── C ──
    await leg('C callers: every production importer of collector/browser.mjs is classified', async () => {
      const list = await importers(), unclassified = list.filter(f => !CALLERS[f]), stale = Object.keys(CALLERS).filter(f => !list.includes(f));
      if (unclassified.length || stale.length) throw new Error('unclassified importers ' + JSON.stringify(unclassified) + '; table entries with no importer ' + JSON.stringify(stale));
      return list.length + ' production importers in ' + RUNTIME.join('/') + ', all classified: ' + list.join(', ');
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; suite ${counts.unitTests}/${own.length}; mutants ${counts.mutantsCaught}/${counts.mutantsTotal}; boundary Chrome legs not run here (separate A/B), B8 excluded\n` + lines.join('\n') };
} };

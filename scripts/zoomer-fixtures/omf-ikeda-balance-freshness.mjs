// Fixture for plan omf-ikeda-balance-freshness-20261028: the 池田泉州銀行 balance reader no longer returns an initially old 最終取得日 card
// at once; it waits within its unchanged read budget for the same account's card to become current and returns the last exact old card
// unchanged at the deadline. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-ikeda-balance-freshness.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. collector/test/ikeda-balance-freshness.test.mjs drives the real readBalance() on an owned
// HEADLESS Chrome whose one page is a fictional dashboard served by request interception (host resolution refused for everything else).
// The original stale hourly reading kept no DOM or network timeline: this proves the reader's timing rule, not the real portal's order.
// No bank, database, owner AppData, credential, ordinary browser or OS input is touched.
// Legs: F fail-first — the new test against the exact 7a0d1f90 reader (git blob, a sibling copy loaded through OMF_TEST_IKEDA_MODULE) fails
// its named delayed-refresh assertion while its fresh-card control stays green; U the new test (always run fresh) plus the affected Ikeda
// collector suites as a QUALIFIED replay (below); M the named reader mutants, each caught by its named assertion in the new test; P the
// staged customer package carries the exact changed reader and its whole collector graph imports with an owned copy of the locked
// dependencies. M and P run only on a green U.
// Test bootstrap (build 02, BUILD-01-INTERRUPTION.json and the parent's startup findings): the first U run was killed at its limit after its
// legacy Chrome launches failed in Target.setDiscoverTargets / EPIPE before any bank assertion, and the verifier's children ran at Idle.
// (1) Every node:test process this fixture starts gets a generated preload that sets only that process to Normal priority (its workers
// and owned Chromes are created by it); the measured priorities are returned. Nothing global and no other process is changed.
// (2) The two legacy suites are never edited: a test-only copy is generated from their exact bytes with its imports pointed at this
// worktree and only the three quiet startup options production collector/browser.mjs already uses (--no-startup-window,
// ignoreDefaultArgs ['about:blank'], waitForInitialPage false) plus an explicitly opened, unattached blank tab standing for the one the
// original launch supplied. Reversing those substitutions must give back the original bytes exactly. This is a qualified replay of
// unchanged business tests; it is not a pass of the raw legacy startup.
// (3) OMF_IKEDA_FRESHNESS_REUSE (optional, a JSON file { priorTap, priorTapSha256, head, changed: { <path>: <sha256> } }): the individual
// legacy rows that PASSED in that earlier, failed run are reused only when its TAP bytes, HEAD and every changed collector/shared file
// match exactly and nothing else under collector/ or shared/ differs; only its failed or unreported rows are replayed. Without it every
// legacy row is replayed (build 03: the reader changed, so the final run replays every legacy row without it).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IKEDA = 'collector/banks/ikeda.mjs', TEST = 'collector/test/ikeda-balance-freshness.test.mjs', BASE = '7a0d1f90221a777718fd45dbb196a2a72a30bbb0';
const LEGACY = ['collector/test/bank-balance.test.mjs', 'collector/test/ikeda-portal.test.mjs'];
const COVERS = [IKEDA, TEST, 'docs/bank-balances.md', 'scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs'];
const ENV = { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' };
const run = (file, args, env = {}, timeout = 1800000, onSpawn = null) => new Promise(resolve => { const child = execFile(file, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...ENV, ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })); onSpawn?.(child); });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const evidenceDir = () => process.env.OMF_IKEDA_FRESHNESS_EVIDENCE_DIR || null;
// OMF_IKEDA_FRESHNESS_EVIDENCE_DIR (optional, an existing directory): the complete stdout/stderr of each child run is kept there.
const keep = async (name, r) => { const dir = evidenceDir(); if (dir) await writeFile(path.join(dir, 'child-' + name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'), 'exit ' + r.code + (r.killed ? ' (killed)' : '') + '\n--- stdout ---\n' + r.stdout + '\n--- stderr ---\n' + r.stderr + '\n--- priorities ---\n' + JSON.stringify({ preload: r.preload ?? null, sampled: r.sampled ?? null, samples: r.samples ?? null }, null, 2), { flag: 'wx' }).catch(() => {}); return r; };
function tapReport(text) {
  const total = name => Number(text.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? NaN);
  const tests = [...text.matchAll(/^(\s*)(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].filter(m => m[1].length <= 4).map(m => ({ ok: m[2] === 'ok', name: m[3].trim(), directive: m[4] || null }));
  return { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), todo: total('todo'), cancelled: total('cancelled'), list: tests };
}

// ── (1) owned test-process priority ──
const PRELOAD = `'use strict';
// Generated by scripts/zoomer-fixtures/omf-ikeda-balance-freshness.mjs: this test process only, to Normal priority; its record is appended.
const os = require('node:os'), fs = require('node:fs');
const before = os.getPriority(0); let error = null;
try { os.setPriority(0, os.constants.priority.PRIORITY_NORMAL); } catch (e) { error = String((e && e.code) || e); }
if (process.env.OMF_TEST_PRIORITY_LOG) fs.appendFileSync(process.env.OMF_TEST_PRIORITY_LOG, JSON.stringify({ pid: process.pid, ppid: process.ppid, before, after: os.getPriority(0), error, script: String(process.argv[1] || '').slice(-120), at: new Date().toISOString() }) + '\\n');
`;
export async function priorityPreload(dir) { const file = path.join(dir, 'omf-test-priority-normal-' + randomUUID().slice(0, 8) + '.cjs'); await writeFile(file, PRELOAD, { flag: 'wx' }); return file; }
// The process tree under one pid with each member's measured PriorityClass (read-only; Win32_Process + Get-Process). The sampler sets only
// its own PowerShell process to Normal first and reports it (`self`): started by an Idle verifier child it inherits Idle and fell minutes
// behind (build 02 fixture-03: the parent normalized 13 such samplers, SAMPLER-PRIORITY-INTERVENTION.jsonl). Nothing else is changed.
// Returns null when the query failed or timed out (an unavailable sample, counted by the caller, never hidden).
async function treePriorities(pid, onSpawn) {
  const ps = `try { (Get-Process -Id $PID).PriorityClass = 'Normal' } catch {}; 'self ' + [string](Get-Process -Id $PID).PriorityClass; $all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name); $set=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$set.Add(${Number(pid)}); do { $n=$set.Count; foreach($p in $all){ if($set.Contains([int]$p.ParentProcessId) -and [int]$p.ProcessId -ne [int]$p.ParentProcessId){ [void]$set.Add([int]$p.ProcessId) } } } while($set.Count -ne $n); foreach($p in $all){ if($set.Contains([int]$p.ProcessId)){ $c = try { [string](Get-Process -Id $p.ProcessId -ErrorAction Stop).PriorityClass } catch { 'gone' }; '{0} {1} {2} {3}' -f $p.ProcessId,$p.ParentProcessId,$p.Name,$c } }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {}, 60000, onSpawn);
  if (r.code !== 0) return null;
  const lines = r.stdout.split(/\r?\n/).filter(Boolean), self = lines.find(l => l.startsWith('self '))?.slice(5).trim() || 'unreadable';
  return { self, rows: lines.filter(l => !l.startsWith('self ')).map(l => { const [p, pp, name, priority] = l.trim().split(' '); return { pid: Number(p), ppid: Number(pp), name, priority: priority || 'unreadable' }; }) };
}
// A node:test child under the preload, its process tree sampled while it runs (first after 3 s, then every 15 s). A sample is skipped
// while the previous one is still running (never queued), and none starts after the test ended. When the test ends, an in-flight sample
// gets at most 2 s; then its own PowerShell (this fixture's child) is ended and the sample is counted as pending-at-exit, so a finished
// test is never held by instrumentation. Every attempt is counted: ok, unavailable, skipped, pending.
export async function nodeTest(args, env = {}, timeout = 1800000, dir) {
  const preload = await priorityPreload(dir), log = path.join(dir, 'priority-' + randomUUID().slice(0, 8) + '.jsonl'), seen = new Map();
  const samples = { attempted: 0, ok: 0, unavailable: 0, skippedOverlap: 0, pendingAtExit: 0, samplerSelf: [] };
  let timer = null, first = null, sampling = null, sampler = null, ended = false;
  const sample = pid => {
    if (ended) return; if (sampling) { samples.skippedOverlap++; return; }
    samples.attempted++;
    sampling = treePriorities(pid, child => { sampler = child; }).then(res => {
      if (!res) { samples.unavailable++; return; }
      samples.ok++; samples.samplerSelf.push(res.self);
      for (const x of res.rows) { const k = x.pid + ' ' + x.name + ' ' + x.priority; if (!seen.has(k)) seen.set(k, { ...x, at: new Date().toISOString() }); }
    }).catch(() => { samples.unavailable++; }).finally(() => { sampling = null; sampler = null; });
  };
  const nodeOptions = [process.env.NODE_OPTIONS || '', `--require "${preload.replace(/\\/g, '/')}"`].filter(Boolean).join(' ');
  const r = await run(process.execPath, args, { ...env, NODE_OPTIONS: nodeOptions, OMF_TEST_PRIORITY_LOG: log }, timeout, child => { first = setTimeout(() => sample(child.pid), 3000); timer = setInterval(() => sample(child.pid), 15000); });
  ended = true; clearTimeout(first); clearInterval(timer);
  if (sampling) {
    const inFlight = sampling, finished = await Promise.race([inFlight.then(() => true), new Promise(resolve => setTimeout(resolve, 2000, false))]);
    if (!finished) { samples.pendingAtExit++; try { sampler?.kill(); } catch { /* already gone */ } }
  }
  let records = []; try { records = (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { /* none written */ }
  return { ...r, preload: records, sampled: [...seen.values()], samples };
}
// Every test process this fixture started must have reported Normal (0) after its preload; anything else is a harness failure.
export function normalProof(r, label) {
  if (!r.preload.length) throw new Error(label + ' harness failure: the priority preload did not run');
  const bad = r.preload.filter(x => x.after !== 0 || x.error); if (bad.length) throw new Error(label + ' harness failure: test process not Normal ' + JSON.stringify(bad).slice(0, 400));
  const chrome = r.sampled.filter(x => x.name === 'chrome.exe'), nodes = r.sampled.filter(x => x.name === 'node.exe');
  return { testProcesses: r.preload.length, before: [...new Set(r.preload.map(x => x.before))], nodeSampled: [...new Set(nodes.map(x => x.priority))], chromeSampled: chrome.length, chromePriorities: [...new Set(chrome.map(x => x.priority))], samples: r.samples };
}
const brief = p => `priority: ${p.testProcesses} test processes Normal (before ${p.before.join('/')}), sampled node ${p.nodeSampled.join('/') || 'none'}, chrome ${p.chromeSampled ? p.chromePriorities.join('/') + ' (' + p.chromeSampled + ')' : 'not sampled'}; sampler ${p.samples.ok}/${p.samples.attempted} ok, ${p.samples.unavailable} unavailable, ${p.samples.skippedOverlap} skipped, ${p.samples.pendingAtExit} pending at exit, self ${[...new Set(p.samples.samplerSelf)].join('/') || 'none'}`;

// ── (2) qualified test-only copy of an unchanged legacy suite ──
export async function qualifiedCopy(file, dir) {
  const original = path.join(root, file), before = await readFile(original, 'utf8'), originalUrl = pathToFileURL(original).href, pairs = []; let text = before;
  const change = (a, b) => { const hits = text.split(a).length - 1; if (hits !== 1) throw new Error('FAIL bootstrap anchor hits ' + hits + ' in ' + file + ': ' + a.slice(0, 90)); if (/\bassert\b/.test(a)) throw new Error('FAIL bootstrap anchor touches an assertion: ' + a.slice(0, 90)); text = text.replace(a, () => b); pairs.push([a, b]); };
  const pkg = JSON.parse(await readFile(path.join(root, 'collector/node_modules/rebrowser-puppeteer-core/package.json'), 'utf8')), entry = pkg.exports?.['.']?.import;
  if (typeof entry !== 'string') throw new Error('FAIL harness setup: rebrowser-puppeteer-core ESM entry not found in collector/node_modules');
  change("import puppeteer from 'rebrowser-puppeteer-core';", `import puppeteer from '${pathToFileURL(path.join(root, 'collector/node_modules/rebrowser-puppeteer-core', entry)).href}';`);
  change("await import('../browser.mjs')", `await import('${pathToFileURL(path.join(root, 'collector/browser.mjs')).href}')`);
  change("args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] })", "ignoreDefaultArgs: ['about:blank'], waitForInitialPage: false, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-startup-window'] })");
  if (file === LEGACY[0]) change('}); if (attempt > 1) console.log(', "}); try { await browser.newPage(); } catch (error) { await closeOwned(browser); throw error; } /* the launch's own blank tab, opened explicitly */ if (attempt > 1) console.log(");
  else change('try { const page = await site.attach(await browser.newPage()); return await fn({ page, browser }); }', 'try { await browser.newPage(); /* the launch\'s own blank tab, opened explicitly */ const page = await site.attach(await browser.newPage()); return await fn({ page, browser }); }');
  const literal = JSON.stringify(originalUrl); if (text.includes(literal)) throw new Error('FAIL the original URL literal already occurs in ' + file);
  const metaCount = text.split('import.meta.url').length - 1; text = text.split('import.meta.url').join(literal);
  // the proof: undoing exactly these substitutions gives back the original bytes; no assertion line differs
  let back = text.split(literal).join('import.meta.url'); for (const [a, b] of [...pairs].reverse()) { if (back.split(b).length !== 2) throw new Error('FAIL copy not reversible in ' + file); back = back.replace(b, () => a); }
  if (back !== before) throw new Error('FAIL the copy of ' + file + ' differs from the original beyond the bootstrap substitutions');
  const assertions = s => s.split('\n').filter(l => /\bassert\b/.test(l)).map(l => l.split(literal).join('import.meta.url'));
  if (JSON.stringify(assertions(before)) !== JSON.stringify(assertions(text))) throw new Error('FAIL an assertion line changed in the copy of ' + file);
  const blob = (await run('git', ['rev-parse', 'HEAD:' + file])).stdout.trim(), hashed = (await run('git', ['hash-object', file])).stdout.trim();
  const target = path.join(dir, path.basename(file, '.test.mjs') + '.qualified-' + randomUUID().slice(0, 8) + '.test.mjs'); await writeFile(target, text, { flag: 'wx' });
  const provenance = { original: file, originalSha256: sha256(before), originalGitBlob: hashed, headBlob: blob, unchangedFromHead: blob === hashed, copy: target, copySha256: sha256(text), substitutions: pairs.length, importMetaUrlRelocated: metaCount, reversibleToOriginalBytes: true, assertionLinesUnchanged: assertions(before).length, rawLegacyStartupClaimed: false };
  const ev = evidenceDir(); if (ev) { await writeFile(path.join(ev, path.basename(target)), text, { flag: 'wx' }).catch(() => {}); await writeFile(path.join(ev, path.basename(target) + '.source.json'), JSON.stringify({ ...provenance, at: new Date().toISOString(), pairs }, null, 2) + '\n', { flag: 'wx' }).catch(() => {}); }
  return { file: target, provenance };
}
// The test names of a suite in source order (each top-level test('…') with a single-quoted name).
export const testNames = text => [...text.matchAll(/^test\('((?:\\.|[^'\\])*)'/gm)].map(m => m[1].replace(/\\(.)/g, '$1'));
const exactPattern = name => '--test-name-pattern=^' + name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&') + '$';

// ── (3) reuse of the earlier individual passes, only on an exact byte reconciliation ──
async function reusable(names, ownNames) {
  const file = process.env.OMF_IKEDA_FRESHNESS_REUSE; if (!file) return { used: false, passed: new Set(), why: 'no OMF_IKEDA_FRESHNESS_REUSE: every legacy row replayed' };
  const spec = JSON.parse(await readFile(file, 'utf8')), tap = await readFile(spec.priorTap, 'utf8');
  if (sha256(tap) !== spec.priorTapSha256) throw new Error('reuse: the earlier TAP bytes differ from ' + spec.priorTapSha256);
  const head = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(); if (head !== spec.head) throw new Error('reuse: HEAD ' + head + ' is not ' + spec.head);
  const status = (await run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', 'collector', 'shared'])).stdout.split(/\r?\n/).filter(Boolean).map(l => l.slice(3).trim()).sort();
  if (JSON.stringify(status) !== JSON.stringify(Object.keys(spec.changed).sort())) throw new Error('reuse: collector/shared changes ' + JSON.stringify(status) + ' are not exactly ' + JSON.stringify(Object.keys(spec.changed)));
  // the new suite is no legacy suite's import and always runs fresh here: its bytes are reported, never a condition of the reuse
  let ownChanged = false;
  for (const [rel, expected] of Object.entries(spec.changed)) { const now = sha256(await readFile(path.join(root, rel))); if (rel === TEST) { ownChanged = now !== expected; continue; } if (now !== expected) throw new Error('reuse: ' + rel + ' is ' + now + ', not the earlier ' + expected); }
  // every earlier row must be a test of the new suite or of a legacy suite as it is now (names are unique across the three)
  const rows = tapReport(tap).list, all = [...Object.values(names).flat(), ...ownNames], unknown = rows.filter(x => all.filter(n => n === x.name).length !== 1);
  if (unknown.length || new Set(all).size !== all.length) throw new Error('reuse: earlier rows that are not exactly one current test: ' + unknown.map(x => x.name.slice(0, 80)).join(' | '));
  const legacy = new Set(Object.values(names).flat()), passed = new Set(rows.filter(x => x.ok && !x.directive && legacy.has(x.name)).map(x => x.name)), ownPassed = rows.filter(x => x.ok && ownNames.includes(x.name)).length;
  return { used: true, passed, ownPassed, priorRows: rows.length, why: `earlier failed run's TAP ${spec.priorTapSha256.slice(0, 12)}… (${rows.length} reported rows, ${rows.filter(x => x.ok).length} passed: ${passed.size} legacy reused + ${ownPassed} new-test superseded by the fresh run) at ${head.slice(0, 8)}; the legacy suites' whole collector/shared graph byte-identical (${Object.keys(spec.changed).filter(r => r !== TEST).join(', ')} as before, nothing else changed)${ownChanged ? '; the new suite changed since then and is re-run fresh (it is no legacy import)' : ''}` };
}

const FRESH = 'if (!balanceLagStale({ asOf: reading.asOf, observedAt: new Date().toISOString() })) return reading; // guard:ikeda-balance-fresh-return';
const LATEST = 'stale = reading; // guard:ikeda-balance-stale-latest';
// This plan's named defects, each caught by its named assertion in the new test (the test name pattern selects only that test).
// Build 03 (tolerance fold): FM3/FM4 now catch forgetting the verified old card and keeping only the first old card; FM9 catches a
// wrong-account card (its own amount and time) taking the verified card's place.
export const FRESHNESS_MUTANTS = [
  { name: 'FM1-bypass-wait (returns the first exact card, the 7a0 behaviour)', edits: [[FRESH, 'return reading; // guard:ikeda-balance-fresh-return']], test: '^delayed refresh', expect: /ikeda-fresh:delayed-refresh/ },
  { name: 'FM2-stale-fallback-lost', guard: 'ikeda-balance-stale-fallback', test: '^persistently old', expect: /ikeda-fresh:stale-fallback/ },
  { name: 'FM3-verified-old-card-forgotten-after-a-failed-read (the build 01/02 per-poll reset)', edits: [['      while (Date.now() < until) {\n        const read', '      while (Date.now() < until) {\n        stale = null;\n        const read']], test: '^after a verified old card', expect: /ikeda-fresh:verified-kept wrong-account \(got code balance-unready\)/ },
  { name: 'FM4-only-the-first-old-card-kept', edits: [[LATEST, 'stale ??= reading; // guard:ikeda-balance-stale-latest']], test: '^newer but still old', expect: /ikeda-fresh:latest-stale-returned/ },
  { name: 'FM5-no-prompt-return-of-a-current-card', guard: 'ikeda-balance-fresh-return', test: '^fresh:', expect: /ikeda-fresh:prompt-fresh/ },
  { name: 'FM6-stricter-than-the-shared-60-minute-rule', edits: [[FRESH, FRESH.replace('new Date().toISOString() })', 'new Date().toISOString() }, 30)')]], test: '^fresh:', expect: /ikeda-fresh:within-interval-prompt/ },
  { name: 'FM7-default-read-budget-changed', edits: [['{ readMs = 45000, ...options }', '{ readMs = 20000, ...options }']], test: '^default read budget', expect: /ikeda-fresh:default-budget-45s/ },
  { name: 'FM8-a-request-while-waiting', edits: [[LATEST, "stale = reading; await page.evaluate(() => fetch('/x').catch(() => {})).catch(() => {}); // guard:ikeda-balance-stale-latest"]], test: '^persistently old', expect: /ikeda-fresh:stale-no-request/ },
  { name: 'FM9-wrong-account-card-accepted (the card match without the account number)', edits: [['return w.includes(identity.number) && w.includes(identity.branch)', 'return w.includes(identity.branch)']], test: '^after a verified old card', expect: /ikeda-fresh:verified-kept wrong-account \(got \S+ amount 99999\)/ }
];
// A sibling copy of the reader (so its relative imports resolve) with named edits (each exact anchor must hit exactly once) or one
// `// guard:<name>` line removed; an anchor or marker that does not hit exactly once is a harness failure, never a catch.
async function sibling(text, tag) {
  const target = path.join(root, 'collector', 'banks', `ikeda.${tag}-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async dispose() { await unlink(target).catch(() => {}); } };
}
async function mutantModule({ guard = null, edits = [] } = {}) {
  let text = (await readFile(path.join(root, IKEDA), 'utf8')).replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  return sibling(text, 'mutant');
}

// M: one named mutant of the reader, run against its one named test of the new suite; caught only when that test fails with its named assertion.
export async function mutantCheck(m, temp) {
  const mod = await mutantModule({ guard: m.guard || null, edits: m.edits || [] });
  try {
    const r = await keep('M-' + m.name.split(' ')[0], await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=' + m.test, TEST], { OMF_TEST_IKEDA_MODULE: mod.file }, 600000, temp)), text = r.stdout + '\n' + r.stderr;
    if (/ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error(m.name + ' harness failure: ' + text.replace(/\s+/g, ' ').slice(-600));
    const p = normalProof(r, m.name);
    if (!/^# tests [1-9]/m.test(r.stdout)) throw new Error(m.name + ' selected no test for ' + m.test);
    if (r.code === 0 || !m.expect.test(text)) throw new Error(m.name + ' did not flip ' + m.expect + ' (exit ' + r.code + '): ' + (text.split('\n').filter(l => /AssertionError|ikeda-fresh:|Error/.test(l)).slice(0, 6).join(' | ') || text.slice(-500)).slice(0, 700));
    return { name: m.name.split(' ')[0], before: p.before };
  } finally { await mod.dispose(); }
}
// P: stage(install:false) and the staged collector graph imported with an owned dependency copy, in a child with an owned collector home.
export async function packageProof(temp) {
  const assert = (await import('node:assert/strict')).default;
  const { stage } = await import(pathToFileURL(path.join(root, 'collector/package/stage.mjs')).href), into = path.join(temp, 'staged');
  const { manifest } = await stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
  const repo = sha256(await readFile(path.join(root, IKEDA))), staged = sha256(await readFile(path.join(into, IKEDA)));
  assert.equal(manifest.files?.[IKEDA], repo, 'fresh:staged-hash'); assert.equal(staged, repo, 'fresh:staged-bytes');
  assert.equal(manifest.files?.['shared/finance-bank-balance.mjs'], sha256(await readFile(path.join(root, 'shared/finance-bank-balance.mjs'))), 'fresh:staged-shared');
  assert.ok(!Object.keys(manifest.files || {}).some(f => f.includes('/test/') || /mutant|baseline|zoomer|qualified/.test(f)), 'fresh:no-test-code-staged');
  // stage(install:false) installs nothing: the dependency context is an owned copy of this worktree's collector/node_modules, used only
  // when the staged lock is this worktree's lock and the source is a real directory (never a link that a cleanup could follow)
  const deps = path.join(root, 'collector', 'node_modules'); let info = null; try { info = await lstat(deps); } catch { /* absent */ }
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error('harness setup: no real collector/node_modules directory in this worktree to copy (missing dependencies are not a pass)');
  const lock = sha256(await readFile(path.join(root, 'collector/package-lock.json'))), stagedLock = sha256(await readFile(path.join(into, 'collector/package-lock.json')));
  assert.equal(stagedLock, lock, 'fresh:staged-lock'); const installedLock = sha256(await readFile(path.join(deps, '.package-lock.json')));
  await cp(deps, path.join(into, 'collector', 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const home = path.join(temp, 'collector-home'); await mkdir(home, { recursive: true });
  const probe = `import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url'; import path from 'node:path';
const into = process.argv[2], url = rel => pathToFileURL(path.join(into, rel)).href, out = {};
const index = await import(url('collector/index.mjs')); out.startCollector = typeof index.startCollector;
const balance = await import(url('collector/bank-balance.mjs')), ikeda = await import(url('collector/banks/ikeda.mjs'));
out.sameAdapter = balance.BALANCE_ADAPTERS.ikeda === ikeda.portalBalance;
const ui = ikeda.portalBalance.ui({}, {}, { accountIdentity: { branch: '架空支店', type: '普通', number: '0012345' } }); out.reader = [typeof ui.readBalance, typeof ui.balanceFinish];
const req = createRequire(path.join(into, 'collector', 'browser.mjs')); out.resolved = ['rebrowser-puppeteer-core', 'googleapis'].map(n => path.relative(into, req.resolve(n)).split(path.sep).slice(0, 3).join('/'));
console.log('PROBE ' + JSON.stringify(out)); process.exit(0);`;
  const probeFile = path.join(temp, 'staged-graph-probe.mjs'); await writeFile(probeFile, probe, { flag: 'wx' });
  const r = await keep('P-staged-graph', await run(process.execPath, [probeFile, into], { OMF_COLLECTOR_DIR: home, LOCALAPPDATA: path.join(temp, 'localappdata'), APPDATA: path.join(temp, 'appdata'), NODE_OPTIONS: '' }, 300000));
  const m = r.stdout.match(/^PROBE (.+)$/m); if (r.code !== 0 || !m) throw new Error('staged graph import failed (exit ' + r.code + '): ' + (r.stderr || r.stdout).replace(/\s+/g, ' ').slice(-900));
  const got = JSON.parse(m[1]);
  assert.equal(got.startCollector, 'function', 'fresh:staged-index'); assert.equal(got.sameAdapter, true, 'fresh:staged-adapter'); assert.deepEqual(got.reader, ['function', 'function'], 'fresh:staged-reader');
  assert.deepEqual(got.resolved, ['collector/node_modules/rebrowser-puppeteer-core', 'collector/node_modules/googleapis'], 'fresh:staged-deps-inside-package');
  return Object.keys(manifest.files || {}).length + ' files staged; staged ikeda.mjs sha256 ' + repo.slice(0, 12) + '… equals the repo; staged lock ' + lock.slice(0, 12) + '… equals the worktree lock, owned dependency copy (installed lock ' + installedLock.slice(0, 12) + '…); in a child with an owned collector home the staged index.mjs graph and the balance reader import, dependencies resolve inside the package';
}

export default { name: 'omf-ikeda-balance-freshness', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true, unitGreen = false;
  const counts = { legs: 0, green: 0, unitTests: 0, executed: 0, reused: 0, excluded: 0, mutantsCaught: 0, mutantsTotal: 0 };
  const leg = async (name, fn) => { counts.legs++; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); counts.green++; return true; } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 3000)); return false; } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'owned Chrome and the collector need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-freshness-fixture-'));
  try {
    // ── F ──
    await leg('F fail-first: the new test against the exact ' + BASE.slice(0, 8) + ' reader fails its named delayed-refresh assertion; its fresh-card control passes', async () => {
      const blob = await run('git', ['rev-parse', BASE + ':' + IKEDA]), shown = await run('git', ['show', BASE + ':' + IKEDA]);
      if (blob.code !== 0 || shown.code !== 0) throw new Error('baseline ' + BASE + ' is not readable here: ' + (blob.stderr + shown.stderr).slice(0, 300));
      if (shown.stdout.includes('balanceLagStale')) throw new Error('the baseline copy already holds the change');
      const base = await sibling(shown.stdout, 'baseline');
      try {
        const r = await keep('F-baseline', await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', TEST], { OMF_TEST_IKEDA_MODULE: base.file }, 600000, temp)), t = tapReport(r.stdout), text = r.stdout + '\n' + r.stderr;
        if (/ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error('harness failure: ' + text.replace(/\s+/g, ' ').slice(-500));
        const p = normalProof(r, 'F');
        assert.notEqual(r.code, 0, 'fresh:baseline-red exit'); assert.match(text, /ikeda-fresh:delayed-refresh \(returned the cached bank time/, 'fresh:baseline-named-assertion');
        assert.ok(t.list.some(x => !x.ok && /^delayed refresh/.test(x.name)), 'fresh:baseline-delayed-test-red'); assert.ok(t.list.some(x => x.ok && /^fresh:/.test(x.name)), 'fresh:baseline-control-green');
        const red = t.list.filter(x => !x.ok).map(x => x.name.split(':')[0].slice(0, 40));
        return `baseline blob ${blob.stdout.trim().slice(0, 12)}: ${t.fail}/${t.tests} red (${red.join(' | ')}); named "ikeda-fresh:delayed-refresh" seen; fresh-card control green; ${brief(p)}`;
      } finally { await base.dispose(); }
    });
    // ── U ──
    unitGreen = await leg('U the new test fresh, and the affected legacy suites (bank-balance, ikeda-portal) as a qualified replay under the corrected test bootstrap', async () => {
      const out = [], own = testNames(await readFile(path.join(root, TEST), 'utf8')); // the new suite's names, derived (build 03: 9)
      // the new test: always a fresh, complete positive control, from its own file
      const r = await keep('U-new-test', await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', TEST], {}, 900000, temp)), t = tapReport(r.stdout), p = normalProof(r, 'U new test');
      if (r.code !== 0 || t.fail || !(t.pass > 0) || t.skipped || t.todo || t.cancelled || t.pass !== t.tests || t.tests !== own.length || own.some(n => !t.list.some(x => x.ok && x.name === n))) throw new Error(`${TEST}: exit ${r.code} tests ${t.tests} pass ${t.pass} fail ${t.fail}: ` + (r.stdout.split('\n').filter(l => /ikeda-fresh:|error: /.test(l)).slice(0, 12).join(' | ') || r.stderr.slice(-600)).slice(0, 1500));
      const seenOk = new Set(t.list.filter(x => x.ok).map(x => x.name)); counts.executed += t.tests; counts.unitTests += t.pass;
      out.push(`new test ${t.pass}/${t.tests} fresh (${brief(p)})`);
      // the legacy suites: reuse the exactly reconciled earlier passes, replay the rest through the qualified copy
      const names = {}; for (const file of LEGACY) names[file] = testNames(await readFile(path.join(root, file), 'utf8'));
      const reuse = await reusable(names, own), bad = [];
      for (const file of LEGACY) {
        const replay = names[file].filter(n => !reuse.passed.has(n)), reused = names[file].filter(n => reuse.passed.has(n));
        for (const n of reused) seenOk.add(n); counts.reused += reused.length;
        if (!replay.length) { out.push(`${path.basename(file)}: ${reused.length} reused, 0 replayed`); continue; }
        const copy = await qualifiedCopy(file, temp);
        const x = await keep('U-replay-' + path.basename(file, '.test.mjs'), await nodeTest(['--test', '--test-concurrency=1', '--test-reporter=tap', ...replay.map(exactPattern), copy.file], {}, 2700000, temp)), xt = tapReport(x.stdout);
        const px = normalProof(x, 'U replay ' + file), missing = replay.filter(n => !xt.list.some(y => y.ok && y.name === n)), extra = xt.list.filter(y => !replay.includes(y.name));
        counts.executed += xt.list.length; counts.unitTests += xt.list.filter(y => y.ok).length;
        for (const y of xt.list) if (y.ok) seenOk.add(y.name);
        const line = `${path.basename(file)}: ${reused.length} reused, ${replay.length} replayed → ${xt.pass}/${xt.tests} green (copy ${copy.provenance.copySha256.slice(0, 12)}… of blob ${copy.provenance.originalGitBlob.slice(0, 12)}…, ${copy.provenance.substitutions} bootstrap substitutions + ${copy.provenance.importMetaUrlRelocated} import.meta.url, reversible, ${copy.provenance.assertionLinesUnchanged} assertion lines unchanged; ${brief(px)})`;
        out.push(line);
        if (x.code !== 0 || xt.fail || xt.skipped || xt.todo || xt.cancelled || missing.length || extra.length || xt.tests !== replay.length) bad.push(`${file} replay exit ${x.code}${x.killed ? ' (killed)' : ''} tests ${xt.tests}/${replay.length} pass ${xt.pass} fail ${xt.fail}; missing: ${missing.map(n => n.slice(0, 80)).join(' | ')}; extra: ${extra.map(n => n.name.slice(0, 60)).join(' | ')} :: ` + (x.stdout.split('\n').filter(l => /ikeda-balance:|error: |AssertionError|actual:|expected:/.test(l)).slice(0, 16).join(' | ') || x.stderr.slice(-600)).slice(0, 1600));
      }
      const legacyTotal = LEGACY.reduce((n, f) => n + names[f].length, 0);
      counts.excluded = legacyTotal + own.length - [...seenOk].length;
      if (bad.length) throw new Error(out.join(' ;; ') + ' ;; ' + bad.join(' ;; '));
      const named = [/^fresh: a card whose bank time is within one interval/, /^delayed refresh:/, /^persistently old:/, /^newer but still old:/, /^after a verified old card, later reads that do not validate/, /^no exact card ever:/, /^a card that is gone for a moment/, /^a busy page:/, /^default read budget:/, /^池田泉州銀行 ビジネスゲート: certificate login, the dashboard read/, /^池田泉州銀行 signed card/];
      for (const n of named) assert.ok([...seenOk].some(x => n.test(x)), 'fresh:unit-test-present ' + n.source);
      if (counts.excluded !== 0) throw new Error('rows neither executed nor reused: ' + counts.excluded);
      return `${reuse.why}; ` + out.join('; ') + `; rows: ${legacyTotal + own.length} = ${counts.executed} executed + ${counts.reused} reused + ${counts.excluded} excluded; the earlier failed U run stays RED (reused rows are its individual passes only); raw legacy startup not claimed`;
    });
    if (!unitGreen) { lines.push('M, P: NOT RUN — U is red (a mutant is only meaningful against a green control)'); counts.legs += 2; }
    // ── M ──
    if (unitGreen) await leg('M mutants: FM1…FM8 on the reader (new test, its named assertions)', async () => {
      const caught = [], missed = [], priorities = new Set();
      for (const m of FRESHNESS_MUTANTS) {
        counts.mutantsTotal++;
        try { const r = await mutantCheck(m, temp); r.before.forEach(v => priorities.add(v)); caught.push(r.name); counts.mutantsCaught++; } catch (e) { missed.push(String(e?.message || e).slice(0, 700)); }
      }
      if (missed.length) throw new Error(caught.length + '/' + counts.mutantsTotal + ' caught (' + caught.join(', ') + '); NOT caught or harness failure: ' + missed.join(' ;; '));
      return caught.length + '/' + counts.mutantsTotal + ' mutants caught: ' + caught.join(', ') + '; every mutant run Normal (preload before ' + [...priorities].join('/') + ')';
    });
    // ── P ──
    if (unitGreen) await leg('P package: stage (no install) carries banks/ikeda.mjs with its repo hash; with an owned copy of the locked dependencies the staged collector graph (index.mjs) and the balance reader import in a child process', () => packageProof(temp));
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, counts, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s; legs ${counts.green}/${counts.legs} green; unit ${counts.unitTests} (executed ${counts.executed}, reused ${counts.reused}, excluded ${counts.excluded}), mutants ${counts.mutantsCaught}/${counts.mutantsTotal}\n` + lines.join('\n') };
} };

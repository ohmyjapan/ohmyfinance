// collector/test/ikeda-balance-freshness.test.mjs — 池田泉州銀行 ビジネスゲート balance freshness (plan omf-ikeda-balance-freshness-20261028):
// the real portalBalanceUi().readBalance() on an owned HEADLESS Chrome whose one page is a fictional 各口座残高 dashboard (#DsbAccounts)
// served by request interception; host resolution is refused for everything else, so no bank or other site can be reached. The page's
// own timers replace the frozen account's card while the reader polls: a cached 最終取得日 first, a refreshed one later (or never), another
// account, a second card of the same account, no time, a page change or a busy page. The ordering is synthetic: the original live session
// kept no DOM or network timeline, so this proves the reader's timing rule, never the real portal's order. Fictional values only.
// Under OMF_TEST_IKEDA_MODULE the named baseline or mutant copy is tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'rebrowser-puppeteer-core';

const moduleOf = (env, rel) => process.env[env] ? pathToFileURL(process.env[env]).href : new URL(rel, import.meta.url).href;
const ikeda = await import(moduleOf('OMF_TEST_IKEDA_MODULE', '../banks/ikeda.mjs'));
const { balanceLagStale } = await import('../../shared/finance-bank-balance.mjs');
const { findChrome, LAUNCH_ARGS } = await import('../browser.mjs');

const IDENTITY = Object.freeze({ branch: '架空支店', type: '普通', number: '0012345' }), OTHER = '0099999', HOME = ikeda.PORTAL.portal + '/';
const SOURCE = { origin: ikeda.PORTAL.portal, path: '/', labels: ['各口座残高'] };
const MINUTE = 60000, minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE, iso = ms => new Date(ms).toISOString();
// The bank's own JST display 'YYYY-MM-DD HH:mm' of an instant.
const jst = ms => { const d = new Date(ms + 9 * 3600000).toISOString(); return d.slice(0, 10) + ' ' + d.slice(11, 16); };
const SHELL = '<!doctype html><html lang="ja"><meta charset="utf-8"><title>池田泉州ビジネスゲート</title><body><section id="DsbAccounts"><h2>各口座残高</h2><div id="cards"></div><p>合計 ¥99,999,999</p></section></body></html>';

const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-freshness-test-'));
// Chrome itself fetches /favicon.ico after a load and after a URL change (seen on this page with a probe); it is aborted and counted
// apart, never as the reader's request. Every other request after the page was set up counts.
const FAVICON = ikeda.PORTAL.portal + '/favicon.ico';
const stats = { served: 0, after: 0, favicons: 0, foreign: [] };
const profile = path.join(temp, 'profile-' + randomUUID().slice(0, 8));
let browser = null, page = null, armed = false;
test.before(async () => {
  browser = await puppeteer.launch({ executablePath: findChrome(), pipe: true, headless: true, userDataDir: profile, defaultViewport: { width: 1100, height: 750 }, protocolTimeout: 30000, args: [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  page = (await browser.pages())[0] || await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { if (r.url() === FAVICON && r.resourceType() === 'other') { stats.favicons++; void r.abort(); return; } if (armed) stats.after++; if (r.url() === HOME) { stats.served++; void r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: SHELL }); } else { stats.foreign.push(r.url()); void r.abort(); } });
});
// The owned profile is removed only once no chrome.exe of it is left (read from the process list, bounded; the pattern of
// bank-balance.test.mjs). Build 02: on a loaded machine Chrome's own child processes still held first_party_sets.db after close().
// A profile still held at the bound is a failure, never ignored; an unreadable process list is unknown, never "released".
const execute = (file, args) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout) => resolve(error ? null : String(stdout))));
async function released(dir, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const out = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"]);
    if (out !== null && !out.split(/\r?\n/).some(l => l.includes(dir))) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
test.after(async () => {
  if (browser) { const child = browser.process(); await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]); if (child && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* gone */ } await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 10000))]); } }
  if (browser && !(await released(profile))) throw new Error('owned Chrome still holds ' + path.basename(profile) + ' at cleanup');
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) return;
  for (let i = 0; ; i++) { try { await rm(temp, { recursive: true, force: true }); return; } catch (error) { if (error?.code !== 'EBUSY' || i >= 5) throw error; await new Promise(r => setTimeout(r, 1000)); } }
});

// A card: { at: bank instant (ms) | null for no 最終取得日, number (default the frozen account), amount (default ¥12,345), twin: a second
// card of the same account }.
// A step at `ms`: `card` (null = the cards are gone), `block` (the page's main thread busy for that long first, then its card if any) or
// `path` (the page leaves the dashboard path, no request).
const shown = card => card === null ? null : { time: card.at === null ? null : jst(card.at), number: card.number ?? IDENTITY.number, amount: card.amount ?? '¥12,345', twin: !!card.twin };
async function dashboard(initial, steps = []) {
  armed = false; await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(({ initial, steps, identity }) => {
    const one = c => `<article class="card"><p>${identity.branch} ${identity.type} ${c.number}</p><p>${c.amount}</p><p>前日比 <span>▲</span>¥100</p>${c.time ? `<p>最終取得日：${c.time}</p>` : ''}</article>`;
    const show = c => { document.querySelector('#cards').innerHTML = c === null ? '' : one(c) + (c.twin ? one(c) : ''); };
    show(initial);
    for (const s of steps) setTimeout(() => { if (s.block) { const t = Date.now(); while (Date.now() - t < s.block) { /* busy page */ } } if (s.path) history.pushState(null, '', s.path); if ('card' in s) show(s.card); }, s.ms);
  }, { initial: shown(initial), steps: steps.map(s => ({ ms: s.ms, block: s.block || 0, path: s.path || null, ...('card' in s ? { card: shown(s.card) } : {}) })), identity: IDENTITY });
  stats.after = 0; armed = true;
}
// The unchanged balance ui of the frozen account (portalBalance, as bank-balance.mjs builds it); readMs omitted = the shipped default.
async function read(readMs) {
  const ui = ikeda.portalBalanceUi(page, browser, ikeda.portalBalance, { accountIdentity: { ...IDENTITY } }, readMs === undefined ? {} : { readMs });
  const started = Date.now(); let reading = null, error = null;
  try { reading = await ui.readBalance(); } catch (e) { error = e; }
  armed = false;
  return { reading, error, code: error?.code ?? null, elapsed: Date.now() - started, requests: stats.after };
}
const exact = asOf => ({ amount: 12345, available: null, asOf: iso(asOf), source: SOURCE });

test('fresh: a card whose bank time is within one interval is returned at the first read — also 58 minutes old — with no further request', async () => {
  const now = minuteNow();
  await dashboard({ at: now }); const a = await read(6000);
  assert.equal(a.error, null, 'ikeda-fresh:fresh-read ' + a.error?.message); assert.deepEqual(a.reading, exact(now), 'ikeda-fresh:fresh-exact');
  assert.ok(a.elapsed < 1500, 'ikeda-fresh:prompt-fresh ' + a.elapsed + 'ms'); assert.equal(a.requests, 0, 'ikeda-fresh:no-extra-request');
  await dashboard({ at: now - 58 * MINUTE }); const b = await read(6000);
  assert.deepEqual(b.reading, exact(now - 58 * MINUTE), 'ikeda-fresh:within-interval-exact ' + b.error?.message);
  assert.ok(b.elapsed < 1500, 'ikeda-fresh:within-interval-prompt ' + b.elapsed + 'ms (the shared 60-minute rule, not a stricter one)');
});

test('delayed refresh: a cached old card is not returned; the same account\'s refreshed card is, promptly after it appears, amount unchanged', async () => {
  const now = minuteNow();
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 900, card: { at: now } }]); const r = await read(6000);
  assert.equal(r.error, null, 'ikeda-fresh:delayed-read ' + r.error?.message);
  assert.equal(r.reading?.asOf, iso(now), 'ikeda-fresh:delayed-refresh (returned the cached bank time ' + r.reading?.asOf + ' after ' + r.elapsed + 'ms)');
  assert.deepEqual(r.reading, exact(now), 'ikeda-fresh:delayed-exact');
  assert.ok(r.elapsed >= 850 && r.elapsed < 2600, 'ikeda-fresh:prompt-after-refresh ' + r.elapsed + 'ms'); assert.equal(r.requests, 0, 'ikeda-fresh:no-reload');
});

test('persistently old: a bank that never advances within the budget yields the old card at the deadline, its original bank time kept (still stale for OMF)', async () => {
  const now = minuteNow();
  for (const [label, age] of [['90min', 90], ['61min', 61]]) {
    await dashboard({ at: now - age * MINUTE }); const r = await read(1800);
    assert.equal(r.error, null, 'ikeda-fresh:stale-fallback ' + label + ' ' + r.code + ' ' + r.error?.message);
    assert.deepEqual(r.reading, exact(now - age * MINUTE), 'ikeda-fresh:stale-original-time ' + label);
    assert.equal(balanceLagStale({ asOf: r.reading.asOf, observedAt: new Date().toISOString() }), true, 'ikeda-fresh:stale-kept ' + label);
    assert.ok(r.elapsed >= 1700, 'ikeda-fresh:stale-waited ' + label + ' ' + r.elapsed + 'ms'); assert.ok(r.elapsed < 4000, 'ikeda-fresh:deadline-bounded ' + label + ' ' + r.elapsed + 'ms');
    assert.equal(r.requests, 0, 'ikeda-fresh:stale-no-request ' + label);
  }
});

test('newer but still old: a card that advances yet still lags more than one interval keeps the wait; the latest exact sample is what returns', async () => {
  const now = minuteNow();
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 400, card: { at: now - 80 * MINUTE } }, { ms: 1300, card: { at: now } }]); const a = await read(5000);
  assert.deepEqual(a.reading, exact(now), 'ikeda-fresh:newer-stale-kept-waiting ' + (a.reading?.asOf || a.code)); assert.ok(a.elapsed >= 1250, 'ikeda-fresh:newer-stale-waited ' + a.elapsed + 'ms');
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 400, card: { at: now - 80 * MINUTE } }]); const b = await read(1800);
  assert.deepEqual(b.reading, exact(now - 80 * MINUTE), 'ikeda-fresh:latest-stale-returned ' + (b.reading?.asOf || b.code));
});

// Build 03 (parent decision under the owner's tolerance-over-elimination rule): a verified old card is no longer discarded by a later read
// that fails validation or cannot be taken; such a read never replaces it.
test('after a verified old card, later reads that do not validate never replace or discard it: another account with its own amount and time, two cards, no time, page left — the verified card returns with its own time, still stale', async () => {
  const now = minuteNow(), old = { at: now - 90 * MINUTE };
  for (const [label, step] of [['wrong-account', { card: { at: now, number: OTHER, amount: '¥99,999' } }], ['two-cards', { card: { at: now, twin: true } }], ['no-time', { card: { at: null } }], ['page-left', { path: '/account-statements' }]]) {
    await dashboard(old, [{ ms: 350, ...step }]); const r = await read(1800);
    assert.deepEqual(r.reading, exact(old.at), 'ikeda-fresh:verified-kept ' + label + ' (got ' + (r.reading ? r.reading.asOf + ' amount ' + r.reading.amount : 'code ' + r.code) + ')');
    assert.equal(balanceLagStale({ asOf: r.reading.asOf, observedAt: new Date().toISOString() }), true, 'ikeda-fresh:verified-still-stale ' + label);
    assert.ok(r.elapsed >= 1700, 'ikeda-fresh:verified-waited ' + label + ' ' + r.elapsed + 'ms'); assert.equal(r.requests, 0, 'ikeda-fresh:' + label + '-no-request');
  }
});

test('no exact card ever: a read that starts invalid (another account with its own amount and a current time, two cards, no time) yields no balance and the reader reason; an invalid start followed by an exact old card returns that card', async () => {
  const now = minuteNow();
  for (const [label, card, code] of [['wrong-account', { at: now, number: OTHER, amount: '¥99,999' }, 'balance-unready'], ['two-cards', { at: now, twin: true }, 'balance-field'], ['no-time', { at: null }, 'balance-time']]) {
    await dashboard(card); const r = await read(1500);
    assert.equal(r.reading, null, 'ikeda-fresh:invalid-never-returned ' + label + ' (got ' + (r.reading ? r.reading.asOf + ' amount ' + r.reading.amount : '') + ')'); assert.equal(r.code, code, 'ikeda-fresh:invalid-reason ' + label);
    assert.equal(r.requests, 0, 'ikeda-fresh:invalid-no-request ' + label);
  }
  await dashboard({ at: now, number: OTHER, amount: '¥99,999' }, [{ ms: 400, card: { at: now - 90 * MINUTE } }]); const v = await read(1800);
  assert.deepEqual(v.reading, exact(now - 90 * MINUTE), 'ikeda-fresh:invalid-then-verified ' + (v.reading?.asOf || v.code));
});

test('a card that is gone for a moment is read again when it returns — fresh, or still old at the deadline', async () => {
  const now = minuteNow();
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 400, card: null }, { ms: 1100, card: { at: now } }]); const a = await read(5000);
  assert.deepEqual(a.reading, exact(now), 'ikeda-fresh:gap-recovers-fresh ' + (a.reading?.asOf || a.code));
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 400, card: null }, { ms: 1100, card: { at: now - 90 * MINUTE } }]); const b = await read(2500);
  assert.deepEqual(b.reading, exact(now - 90 * MINUTE), 'ikeda-fresh:gap-recovers-stale ' + (b.reading?.asOf || b.code));
});

test('a busy page: a read that times out and its late answer request nothing; the next exact read counts, and an unreadable last read keeps the verified old card', async () => {
  const now = minuteNow();
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 300, block: 5600, card: { at: now } }]); const a = await read(9000);
  assert.deepEqual(a.reading, exact(now), 'ikeda-fresh:busy-recovers-fresh ' + (a.reading?.asOf || a.code)); assert.ok(a.elapsed >= 5000, 'ikeda-fresh:busy-waited ' + a.elapsed + 'ms');
  assert.equal(a.requests, 0, 'ikeda-fresh:busy-no-request');
  await dashboard({ at: now - 90 * MINUTE }, [{ ms: 300, block: 6500 }]); const b = await read(1500);
  assert.deepEqual(b.reading, exact(now - 90 * MINUTE), 'ikeda-fresh:unreadable-keeps-verified (got ' + (b.reading ? b.reading.asOf : 'code ' + b.code) + ')');
  assert.ok(b.elapsed < 1500 + 5000 + 1500, 'ikeda-fresh:unreadable-bounded ' + b.elapsed + 'ms'); assert.equal(b.requests, 0, 'ikeda-fresh:unreadable-no-request');
  await new Promise(r => setTimeout(r, 1500)); // let the busy page finish before the next test navigates
});

test('default read budget: without a readMs option a persistently old card is waited for the shipped 45 seconds, then returned unchanged', async () => {
  const now = minuteNow();
  await dashboard({ at: now - 90 * MINUTE }); const r = await read();
  assert.deepEqual(r.reading, exact(now - 90 * MINUTE), 'ikeda-fresh:default-stale-fallback ' + (r.reading?.asOf || r.code));
  assert.ok(r.elapsed >= 44500 && r.elapsed < 51000, 'ikeda-fresh:default-budget-45s ' + r.elapsed + 'ms'); assert.equal(r.requests, 0, 'ikeda-fresh:default-no-request');
  assert.deepEqual(stats.foreign, [], 'ikeda-fresh:no-foreign-request');
});

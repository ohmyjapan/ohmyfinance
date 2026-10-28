// collector/test/frame-init.test.mjs — plan omf-downloader-release-ready-20261028: the pinned rebrowser-puppeteer-core 23.10.3 iframe
// initialization fix (collector/puppeteer-frame-init.mjs, the upstream puppeteer#14701 callback) as collector/browser.mjs loads it.
// Every scenario runs in its own plain node child process (no test runner, no rejection handler of its own), so an unhandled rejection
// ends that child exactly as it ended the installed collector on 2026-10-28. The children use the actual installed SDK classes: a
// fictional CDP session for the callback itself, and an owned HEADLESS Chrome on a fictional local bank page (127.0.0.1 with a
// cross-site iframe from localhost; host resolution refused for everything else) whose iframe session gets one injected
// "Network.enable timed out" — the only fault injected, at the SDK's own send. No bank, credential, vault, owner profile or network.
// OMF_TEST_BROWSER_MODULE (test only; read by this file, never by a production module): the collector browser module the children
// import — a copy beside collector/browser.mjs (the fixture's fail-first baseline and mutants) or a staged package's browser.mjs.
// The SDK and the balance lane are always resolved beside that module. Default: ../browser.mjs.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const CHILD = '--frame-init-child';
const FAULT = 'Network.enable timed out. fictional injection';
const sdkRootOf = browserFile => { for (let dir = path.dirname(browserFile); ; dir = path.dirname(dir)) { const candidate = path.join(dir, 'node_modules', 'rebrowser-puppeteer-core'); if (existsSync(path.join(candidate, 'package.json'))) return candidate; if (path.dirname(dir) === dir) throw new Error('harness setup: rebrowser-puppeteer-core is not installed beside ' + browserFile); } };
const sdkUrl = (browserFile, rel) => pathToFileURL(path.join(sdkRootOf(browserFile), 'lib', 'esm', 'puppeteer', rel)).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = value => { process.stdout.write('FRAME-INIT-CHILD ' + JSON.stringify(value) + '\n'); };

// ── the child scenarios ──
async function child([scenario, browserFile, withBrowser, root]) {
  const sdk = rel => import(sdkUrl(browserFile, rel));
  const { EventEmitter } = await import('node:events');
  const { FrameManager } = await sdk('cdp/FrameManager.js');
  const { ProtocolError, TargetCloseError } = await sdk('common/Errors.js');
  const { setLogCapture, getCapturedLogs } = await sdk('common/Debug.js');
  const listeners = () => ({ unhandledRejection: process.listenerCount('unhandledRejection'), uncaughtException: process.listenerCount('uncaughtException') });
  const before = { method: FrameManager.prototype.onAttachedToTarget, listeners: listeners() };
  // A fictional CDP session: the fault is created when the SDK sends Network.enable and rejected later, as its callback registry does.
  class Session extends EventEmitter {
    constructor(name, fail = null) { super(); this.name = name; this.fail = fail; }
    id() { return this.name; }
    send(method) {
      if (method === 'Network.enable' && this.fail) { const error = this.fail === 'closed' ? new TargetCloseError('Target closed. fictional') : new ProtocolError(FAULT); return new Promise((_, reject) => setTimeout(() => reject(error), 10)); }
      if (method === 'Page.getFrameTree') return new Promise(() => {});
      return Promise.resolve({});
    }
  }
  const target = (type, id, session, log = null) => ({ _getTargetInfo() { log?.push(['info']); return { type, targetId: id }; }, _session() { log?.push(['session']); return session; } });
  const load = async () => withBrowser === '1' ? await import(pathToFileURL(browserFile).href) : null;
  if (scenario === 'fault') {
    const B = await load(); setLogCapture(true);
    const manager = new FrameManager(new Session('fictional-main'), {}, {}), session = new Session('fictional-iframe', 'protocol'), calls = [], init = manager.initialize;
    manager.frame = id => ({ id, updateClient(s) { calls.push(['updateClient', id, s.id()]); } });
    manager.setupEventListeners = s => { calls.push(['setupEventListeners', s.id()]); };
    manager.initialize = function (s, f) { calls.push(['initialize', s.id(), f?.id ?? null]); return init.call(this, s, f); }; // the same promise, no handler added
    manager.onAttachedToTarget(target('iframe', 'fictional-frame', session));
    await sleep(300);
    report({ scenario, survived: true, replacedByBrowserImport: FrameManager.prototype.onAttachedToTarget !== before.method, state: B?.FRAME_INIT_FIX?.state ?? null, listenersBefore: before.listeners, listenersAfter: listeners(), debugLogged: getCapturedLogs().filter(l => l.includes(FAULT)).length, calls });
  } else if (scenario === 'calls') {
    await load();
    const log = [], sessions = {}, frames = { 'frame-known': { id: 'frame-known', updateClient(s) { log.push(['updateClient', 'frame-known', s.id()]); } } };
    const manager = new FrameManager(new Session('fictional-main'), {}, {});
    manager.initialize = (s, f) => { log.push(['initialize', s.id(), f?.id ?? null]); return Promise.resolve(); };
    manager.setupEventListeners = s => { log.push(['setupEventListeners', s.id()]); };
    manager.frame = id => { log.push(['frame', id]); return frames[id] ?? null; };
    const out = {};
    for (const [type, id] of [['iframe', 'frame-known'], ['iframe', 'frame-new'], ['page', 'page-1'], ['worker', 'worker-1'], ['service_worker', 'sw-1'], ['shared_worker', 'shared-1'], ['other', 'other-1']]) {
      log.length = 0; sessions[id] = new Session('session-' + id);
      const r = manager.onAttachedToTarget(target(type, id, sessions[id], log));
      out[type + ':' + id] = { returned: r === undefined ? 'undefined' : typeof r, log: [...log] };
    }
    await sleep(50);
    report({ scenario, out });
  } else if (scenario === 'awaited') {
    await load();
    const manager = new FrameManager(new Session('fictional-main'), {}, {}), out = {};
    for (const fail of ['protocol', 'closed']) {
      try { await manager.initialize(new Session('fictional-' + fail, fail)); out[fail] = 'resolved'; }
      catch (error) { out[fail] = error instanceof ProtocolError && error.message === FAULT ? 'rejected' : 'other ' + String(error?.message || error).slice(0, 120); }
    }
    report({ scenario, out });
  } else if (scenario === 'unrelated') {
    await load();
    Promise.reject(new Error('unrelated fictional rejection'));
    await sleep(300);
    report({ scenario, survived: true });
  } else if (scenario === 'foreign-unknown' || scenario === 'foreign-handled') {
    const { debugError } = await sdk('common/util.js');
    const replacement = scenario === 'foreign-unknown'
      ? function onAttachedToTarget(target) { return target; }
      : function onAttachedToTarget(target) { if (target._getTargetInfo().type !== 'iframe') { return; } const frame = this.frame(target._getTargetInfo().targetId); if (frame) { frame.updateClient(target._session()); } this.setupEventListeners(target._session()); void this.initialize(target._session(), frame).catch(debugError); };
    FrameManager.prototype.onAttachedToTarget = replacement;
    const B = await load();
    report({ scenario, unchanged: FrameManager.prototype.onAttachedToTarget === replacement, state: B?.FRAME_INIT_FIX?.state ?? null });
  } else if (scenario === 'chrome') {
    report(await chromeScenario(browserFile, root, sdk, { ProtocolError, setLogCapture, getCapturedLogs }));
  } else throw new Error('unknown scenario ' + scenario);
  process.exit(0);
}

// The real lane on real headless Chrome: collector/bank-balance.mjs runBalanceJob → inquireFromPage → bank.mjs ensureBankLogin with a
// fictional adapter, through the owned launcher of the browser module under test (an ephemeral profile in a fictional collector home).
async function chromeScenario(browserFile, root, sdk, { ProtocolError, setLogCapture, getCapturedLogs }) {
  const http = await import('node:http'), { readFile, readdir } = await import('node:fs/promises');
  const B = await import(pathToFileURL(browserFile).href), balance = await import(pathToFileURL(path.join(path.dirname(browserFile), 'bank-balance.mjs')).href);
  const puppeteer = (await sdk('puppeteer-core.js')).default, { CdpCDPSession } = await sdk('cdp/CDPSession.js');
  setLogCapture(true);
  // containment: every owned launch of the module under test is headless with host resolution refused except this machine
  const RULES = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', launch = puppeteer.launch.bind(puppeteer), launched = [];
  puppeteer.launch = options => { launched.push(options?.userDataDir); return launch({ ...options, headless: true, args: [...(options?.args || []), RULES] }); };
  // the one injected fault: Network.enable of the next N iframe sessions answers with the captured protocol error
  const inject = { remaining: 0, count: 0, iframeEnables: 0 }, send = CdpCDPSession.prototype.send;
  CdpCDPSession.prototype.send = function (method, ...rest) {
    if (method === 'Network.enable' && this._target?.()?._getTargetInfo?.()?.type === 'iframe') { inject.iframeEnables++; if (inject.remaining > 0) { inject.remaining--; inject.count++; return Promise.reject(new ProtocolError(FAULT)); } }
    return send.call(this, method, ...rest);
  };
  const stats = { logins: {}, logouts: 0, foreign: [], panels: 0 }; let base = '', frameBase = '';
  const html = (res, body) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8">' + body); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'), job = url.searchParams.get('job') || '', mode = url.searchParams.get('mode') || '';
    if (req.method === 'GET' && url.pathname === '/login') return html(res, `<form id="login" method="post" action="/login?job=${job}&mode=${mode}"><input id="user" name="user"><input id="pass" name="pass" type="password"><button id="go">ログイン</button></form>`);
    if (req.method === 'POST' && url.pathname === '/login') { req.resume(); stats.logins[job] = (stats.logins[job] || 0) + 1; res.writeHead(303, { Location: `/home?job=${job}&mode=${mode}` }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/home') return html(res, `<h1 id="dash">架空銀行 ダッシュボード</h1>${mode === 'main' ? '<p id="balance">普通預金残高 123,456円</p>' : ''}<iframe id="panel" src="${frameBase}/panel?job=${job}&mode=${mode}"></iframe>`);
    if (req.method === 'GET' && url.pathname === '/panel') { stats.panels++; return html(res, mode === 'main' ? '<p>架空のお知らせ</p>' : '<p id="balance">普通預金残高 654,321円</p>'); }
    if (req.method === 'GET' && url.pathname === '/logout') { stats.logouts++; return html(res, '<p id="bye">ログアウトしました</p>'); }
    if (url.pathname === '/favicon.ico') { res.statusCode = 404; return res.end(); }
    stats.foreign.push(req.method + ' ' + url.pathname); res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`; frameBase = `http://localhost:${server.address().port}`;
  const OWNER = 'a1a1a1a1a1a1a1a1a1a1a1a1', OMF = 'https://omf.example', config = { baseUrl: OMF, token: 'omfc_' + 'f'.repeat(64) };
  const paypay = balance.BALANCE_ADAPTERS.paypay;
  // a fictional adapter of the job's frozen provider/variant (the lane's binding); its page is the local fictional bank
  const adapterFor = (job, mode, out) => ({ provider: paypay.provider, variant: paypay.variant, label: '架空銀行', ui(page) {
    const kind = () => page.evaluate(() => document.getElementById('dash') ? 'authenticated' : document.getElementById('login') ? 'login' : document.getElementById('bye') ? 'logged_out' : 'unknown').catch(() => 'unknown');
    return {
      async open() { await page.goto(`${base}/login?job=${job}&mode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 20000 }); },
      async state() { return { kind: await kind() }; },
      async loginForm() { return { ok: (await kind()) === 'login' }; },
      async document() { return page.url(); },
      async login(secret) { await page.type('#user', secret.user); await page.type('#pass', secret.pass); await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }), page.click('#go')]); return { outcome: 'authenticated', document: page.url() }; },
      async readBalance() {
        const until = Date.now() + 10000; while (Date.now() < until && !(inject.iframeEnables > out.enablesBefore && page.frames().some(f => f.url().includes('/panel')))) await sleep(100); // the iframe attached
        await sleep(300); // its initialization settled (rejected, where injected)
        const frame = mode === 'main' ? page.mainFrame() : page.frames().find(f => f.url().includes('/panel'));
        const text = frame ? await Promise.race([frame.evaluate(() => document.getElementById('balance')?.textContent ?? null).catch(() => null), sleep(5000).then(() => null)]) : null;
        const m = /([\d,]+)円/.exec(text || ''); if (!m) throw Object.assign(new Error('架空銀行の残高を読み取れませんでした'), { code: 'balance-unread' });
        out.read = { frame: mode, text };
        return { amount: Number(m[1].replaceAll(',', '')), available: null, asOf: new Date(Date.now() - 60000).toISOString(), source: { ...paypay.source } };
      },
      async balanceFinish() { await page.goto(`${base}/logout`, { waitUntil: 'domcontentloaded', timeout: 20000 }); return { loggedOut: (await kind()) === 'logged_out' }; }
    };
  } });
  const sends = [], login = () => { const calls = { open: 0 }; return { calls, async state() { return 'ready'; }, async open() { calls.open++; return { user: 'fictional-user', pass: 'fictional-pass-0' }; }, async rejected() {}, async accepted() {} }; };
  const sendTo = async (cfg, account, item) => { sends.push({ account: String(account._id), jobId: item.manifest.jobId, body: JSON.parse(await readFile(path.join(item.directory, item.manifest.filename), 'utf8')) }); };
  const registry = [];
  // one balance job; `fault` = how many iframe sessions fail; the browser is closed only after `hold` (concurrency)
  async function job(name, account, mode, fault, { batch = name, existing = null } = {}) {
    const snapshot = { kind: 'balance', parserVersion: 'bank-balance-1', provider: paypay.provider, variant: paypay.variant, currency: 'JPY' };
    const j = existing || { jobId: 'job-' + name, kind: 'balance', snapshot, snapshotHash: 'h'.repeat(64), provider: paypay.provider };
    const out = { enablesBefore: inject.iframeEnables }, statuses = [], saved = login();
    inject.remaining += fault; const injectedBefore = inject.count;
    const inquire = async (bound, jj, r, status, options) => {
      const browser = await B.browserFor(B.ephemeralProfile(r, bound.ownerId, 'bank', bound.bankAccountId, batch), { ephemeral: true, root: r, headless: true });
      registry.push(B.ownedBrowsers().map(e => ({ ephemeral: e.ephemeral, connected: e.connected, inRoot: path.resolve(e.profile).startsWith(path.resolve(r) + path.sep) })));
      return balance.inquireFromPage(await browser.newPage(), browser, adapterFor(j.jobId, mode, out), bound, jj, r, status, { ...options, loginTimeoutMs: 30000, settleMs: 10000, finishMs: 10000 });
    };
    const result = await balance.runBalanceJob({ job: { ...j, bankAccountId: account }, account: { _id: account, ownerId: OWNER, name: 'fictional ' + name } }, config, null, { status: async (s, t) => { statuses.push(s); }, send: sendTo, root, inquire, login: saved, now: Date.now });
    return { name, failed: result.failed ?? null, skipped: result.skipped ?? null, resent: !!result.resent, statuses, injected: inject.count - injectedBefore, read: out.read ?? null, loginOpens: saved.calls.open, job: j };
  }
  const closeAll = async () => { await B.closeOwnedBrowsers(); return B.ownedBrowsers().length; };
  const unrelated = await launch({ executablePath: B.findChrome(), pipe: true, headless: true, userDataDir: path.join(root, 'unrelated-chrome'), args: ['--no-first-run', RULES] });
  const outcome = { scenario: 'chrome', jobs: [], openAfter: [] };
  try {
    const A = '0a0a0a0a0a0a0a0a0a0a0a0a', C = '0c0c0c0c0c0c0c0c0c0c0c0c', D1 = '0d0d0d0d0d0d0d0d0d0d0d01', D2 = '0d0d0d0d0d0d0d0d0d0d0d02', E = '0e0e0e0e0e0e0e0e0e0e0e0e';
    const a = await job('a-fault-main', A, 'main', 1); outcome.jobs.push(a); outcome.openAfter.push(await closeAll());
    const again = await job('a-fault-main-again', A, 'main', 0, { existing: a.job }); outcome.jobs.push(again); outcome.openAfter.push(await closeAll());
    const e = await job('e-fault-frame', E, 'frame', 1); outcome.jobs.push(e); outcome.openAfter.push(await closeAll());
    const eAgain = await job('e-fault-frame-again', E, 'frame', 0, { existing: e.job }); outcome.jobs.push(eAgain); outcome.openAfter.push(await closeAll());
    const c = await job('c-healthy-later', C, 'frame', 0); outcome.jobs.push(c); outcome.openAfter.push(await closeAll());
    const [d1, d2] = await Promise.all([job('d1-concurrent-fault', D1, 'main', 1), job('d2-concurrent-fault', D2, 'main', 1)]); outcome.jobs.push(d1, d2);
    outcome.concurrentOpen = registry.at(-1)?.length ?? null; outcome.openAfter.push(await closeAll());
  } finally {
    await B.closeOwnedBrowsers().catch(() => {});
    outcome.unrelatedAlive = !!unrelated.connected && unrelated.process()?.exitCode === null;
    await unrelated.close().catch(() => {});
    server.close();
  }
  for (const j of outcome.jobs) delete j.job;
  const outbox = path.join(root, 'outbox', 'balance'), retained = {};
  for (const account of await readdir(outbox).catch(() => [])) for (const jobId of await readdir(path.join(outbox, account)).catch(() => [])) retained[account + '/' + jobId] = (await readdir(path.join(outbox, account, jobId))).filter(f => f === 'manifest.json' || f === 'attempt.json' || f === 'login.json').sort();
  const enables = getCapturedLogs().filter(l => l.includes(FAULT)).length;
  return { ...outcome, injected: inject.count, iframeEnables: inject.iframeEnables, debugLogged: enables, sends: sends.map(s => ({ account: s.account, jobId: s.jobId, amount: s.body.amount, provider: s.body.provider })), logins: stats.logins, logouts: stats.logouts, foreign: stats.foreign, panels: stats.panels, registry, retained, launched: launched.length, launchesInRoot: launched.every(p => path.resolve(String(p)).startsWith(path.resolve(root) + path.sep)), rejectionListeners: process.listenerCount('unhandledRejection') };
}

if (process.argv[2] === CHILD) await child(process.argv.slice(3));
else {
  const { default: test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const BROWSER = process.env.OMF_TEST_BROWSER_MODULE ? path.resolve(process.env.OMF_TEST_BROWSER_MODULE) : path.resolve(path.dirname(SELF), '..', 'browser.mjs');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-frame-init-test-'));
  const roots = [];
  const env = () => { const e = { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '' }; delete e.NODE_TEST_CONTEXT; delete e.DEBUG; return e; };
  const run = (scenario, withBrowser, extra = [], timeout = 60000) => new Promise(resolve => execFile(process.execPath, [SELF, CHILD, scenario, BROWSER, withBrowser ? '1' : '0', ...extra], { windowsHide: true, timeout, env: env(), maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    const line = String(stdout).split(/\r?\n/).find(l => l.startsWith('FRAME-INIT-CHILD ')); let value = null; try { value = line ? JSON.parse(line.slice(17)) : null; } catch { /* not a report */ }
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, killed: !!error?.killed, value, stdout: String(stdout), stderr: String(stderr) });
  }));
  const brief = r => { const text = r.stderr || r.stdout, key = text.split(/\r?\n/).filter(l => /Error\b|onAttachedToTarget|addClient/.test(l)).slice(0, 6).join(' | '); return `exit ${r.code}${r.killed ? ' (killed)' : ''}: ${(key || text).replace(/\s+/g, ' ').slice(0, 900)}`; };
  // Chrome processes of one fictional collector home (its own random temp folder): read from the process list; null when unreadable.
  const chromesUnder = dir => new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"], { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout).split(/\r?\n/).filter(l => l.toLowerCase().includes(dir.toLowerCase())).map(l => Number(l.split(' ')[0])))));
  test.after(async () => {
    for (const dir of roots) {
      let left = await chromesUnder(dir);
      // a child that died leaves its Chrome; only processes whose command line names this test's own random folder are ended
      for (let i = 0; left && left.length && i < 20; i++) { for (const pid of left) { try { process.kill(pid); } catch { /* gone */ } } await sleep(500); left = await chromesUnder(dir); }
      if (!left || left.length) throw new Error('owned test Chrome still running under ' + path.basename(dir) + ': ' + JSON.stringify(left));
    }
    if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) for (let i = 0; ; i++) { try { await rm(temp, { recursive: true, force: true }); break; } catch (error) { if (i >= 10) throw error; await sleep(1000); } }
  });

  test('the unpatched SDK callback: an iframe whose initialization fails ends the process (the captured crash, reproduced)', async () => {
    const r = await run('fault', false);
    assert.equal(r.code, 1, 'frame-init:baseline-fatal ' + brief(r));
    assert.match(r.stderr, /ProtocolError: Network\.enable timed out\. fictional injection/, 'frame-init:baseline-error');
    assert.match(r.stderr, /FrameManager\.onAttachedToTarget/, 'frame-init:baseline-callback'); assert.match(r.stderr, /NetworkManager\.addClient/, 'frame-init:baseline-chain');
  });

  test('through collector/browser.mjs: the same failed iframe initialization is caught, the process keeps running, no process-wide handler', async () => {
    const r = await run('fault', true), v = r.value;
    assert.ok(r.code === 0 && v?.survived === true, 'frame-init:callback-fault-survives ' + brief(r));
    assert.equal(v.replacedByBrowserImport, true, 'frame-init:loaded-through-browser'); assert.equal(v.state, 'installed', 'frame-init:state-installed');
    assert.deepEqual([v.listenersBefore, v.listenersAfter], [{ unhandledRejection: 0, uncaughtException: 0 }, { unhandledRejection: 0, uncaughtException: 0 }], 'frame-init:no-global-handler');
    assert.equal(v.debugLogged, 1, 'frame-init:failure-logged-to-debug');
    assert.deepEqual(v.calls, [['updateClient', 'fictional-frame', 'fictional-iframe'], ['setupEventListeners', 'fictional-iframe'], ['initialize', 'fictional-iframe', 'fictional-frame']], 'frame-init:fault-callback-steps');
  });

  test('iframe, page and worker targets: the callback does exactly what the unpatched one does (frame client, listeners, initialize arguments; non-iframe targets untouched)', async () => {
    const [original, candidate] = await Promise.all([run('calls', false), run('calls', true)]);
    assert.ok(original.code === 0 && candidate.code === 0 && original.value && candidate.value, 'frame-init:calls-ran ' + brief(original.code ? original : candidate));
    const pick = (v, iframe) => Object.fromEntries(Object.entries(v.out).filter(([k]) => k.startsWith('iframe:') === iframe));
    assert.deepEqual(pick(candidate.value, true), pick(original.value, true), 'frame-init:healthy-iframe-same-calls');
    assert.deepEqual(pick(candidate.value, false), pick(original.value, false), 'frame-init:noniframe-untouched');
    assert.deepEqual(candidate.value.out['iframe:frame-known'].log, [['info'], ['info'], ['frame', 'frame-known'], ['session'], ['updateClient', 'frame-known', 'session-frame-known'], ['session'], ['setupEventListeners', 'session-frame-known'], ['session'], ['initialize', 'session-frame-known', 'frame-known']], 'frame-init:iframe-steps');
    assert.deepEqual(candidate.value.out['worker:worker-1'].log, [['info']], 'frame-init:worker-steps');
  });

  test('awaited initialization: a protocol failure still rejects to its caller and a closed target is still ignored, as before', async () => {
    const [original, candidate] = await Promise.all([run('awaited', false), run('awaited', true)]);
    assert.ok(original.code === 0 && candidate.code === 0, 'frame-init:awaited-ran ' + brief(original.code ? original : candidate));
    assert.deepEqual(candidate.value.out, { protocol: 'rejected', closed: 'resolved' }, 'frame-init:awaited-still-rejects');
    assert.deepEqual(candidate.value.out, original.value.out, 'frame-init:awaited-unchanged');
  });

  test('an unrelated unhandled rejection still ends the process after collector/browser.mjs is loaded', async () => {
    const r = await run('unrelated', true);
    assert.equal(r.code, 1, 'frame-init:unrelated-rejection-fatal ' + brief(r)); assert.match(r.stderr, /unrelated fictional rejection/, 'frame-init:unrelated-error');
  });

  test('a library whose callback is not the pinned 23.10.3 text is left unchanged (already handled or unknown), never refused', async () => {
    const [unknown, handled] = await Promise.all([run('foreign-unknown', true), run('foreign-handled', true)]);
    assert.ok(unknown.code === 0 && handled.code === 0, 'frame-init:foreign-ran ' + brief(unknown.code ? unknown : handled));
    assert.deepEqual(unknown.value, { scenario: 'foreign-unknown', unchanged: true, state: 'not-applied' }, 'frame-init:unknown-method-untouched');
    assert.deepEqual(handled.value, { scenario: 'foreign-handled', unchanged: true, state: 'already-handled' }, 'frame-init:handled-method-untouched');
  });

  test('real headless Chrome, fictional bank page whose cross-site iframe fails to initialize: the process survives; each job signs in once and keeps one true receipt; a re-claim never signs in again; a later healthy iframe and two concurrent jobs work; owned browsers close, an unrelated Chrome is untouched', { timeout: 300000 }, async () => {
    const root = await mkdtemp(path.join(temp, 'home-')); roots.push(root);
    const r = await run('chrome', true, [root], 240000), v = r.value;
    assert.ok(r.code === 0 && v?.scenario === 'chrome', 'frame-init:chrome-survives ' + brief(r));
    const byName = Object.fromEntries(v.jobs.map(j => [j.name, j]));
    assert.equal(v.injected, 4, 'frame-init:chrome-fault-injected'); assert.equal(v.debugLogged, 4, 'frame-init:chrome-fault-caught');
    for (const name of ['a-fault-main', 'e-fault-frame', 'd1-concurrent-fault', 'd2-concurrent-fault']) assert.equal(byName[name].injected >= 0 && byName[name].statuses.at(-1) === 'complete' && byName[name].failed === null, true, 'frame-init:chrome-job-complete ' + name + ' ' + JSON.stringify(byName[name]));
    assert.equal(byName['c-healthy-later'].failed, null, 'frame-init:chrome-healthy-later ' + JSON.stringify(byName['c-healthy-later'])); assert.equal(byName['c-healthy-later'].read?.frame, 'frame', 'frame-init:chrome-healthy-frame-read');
    assert.deepEqual(v.logins, { 'job-a-fault-main': 1, 'job-e-fault-frame': 1, 'job-c-healthy-later': 1, 'job-d1-concurrent-fault': 1, 'job-d2-concurrent-fault': 1 }, 'frame-init:chrome-one-login');
    for (const name of ['a-fault-main-again', 'e-fault-frame-again']) assert.ok(byName[name].resent === true && byName[name].loginOpens === 0, 'frame-init:chrome-no-second-login ' + JSON.stringify(byName[name]));
    const amounts = v.sends.map(s => s.jobId + ':' + s.amount).sort();
    assert.deepEqual(amounts, ['job-a-fault-main:123456', 'job-a-fault-main:123456', 'job-c-healthy-later:654321', 'job-d1-concurrent-fault:123456', 'job-d2-concurrent-fault:123456', 'job-e-fault-frame:654321', 'job-e-fault-frame:654321'], 'frame-init:chrome-no-false-receipt');
    assert.equal(v.logouts, 5, 'frame-init:chrome-logouts');
    assert.ok(v.registry.every(list => list.length >= 1 && list.every(e => e.ephemeral && e.connected && e.inRoot)), 'frame-init:chrome-registry-owned ' + JSON.stringify(v.registry));
    assert.equal(v.concurrentOpen, 2, 'frame-init:chrome-concurrent-owned'); assert.deepEqual(v.openAfter, [0, 0, 0, 0, 0, 0], 'frame-init:chrome-registry-closed');
    assert.equal(v.unrelatedAlive, true, 'frame-init:chrome-unrelated-untouched'); assert.equal(v.launchesInRoot, true, 'frame-init:chrome-profiles-in-home');
    assert.deepEqual(v.foreign, [], 'frame-init:chrome-no-foreign-request'); assert.equal(v.rejectionListeners, 0, 'frame-init:chrome-no-global-handler');
  });
}

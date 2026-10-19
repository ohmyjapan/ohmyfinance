// Fixture for plan omf-rakuten-bank-connector-amended-20261019 (5-plan-build.json §4): the contract-driven page engine of
// the first web bank (楽天銀行), the observe recorder's click/input metadata (CDP binding, value-free, bounded, retained on
// an unchanged page, across a full document navigation and at the tab close), the connection's login variant, the
// observation read, the staged package. Run ONLY through the hub verifier (never directly; a direct run dropped the hub
// database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-rakuten-bank-connector.mjs --cwd <this worktree>
// Evidence basis, stated exactly: there is no recorded production case of a bank job, observation or connection (zero
// historical bank cases tested; live population unknown; review finding F1 open) — every leg drives the changed code
// directly on synthetic data: a two-document fake portal served by request interception at https://fes.rakuten-bank.co.jp
// (/MS/main/RbS login+menu → real <a href> navigation to /MS/main/RbS/statements → CSV; no network, no bank reached), a
// FIXTURE_CONTRACT describing it, the synthetic CSV bytes of omf-bank-collection.mjs:76, the built app spawned on the
// harness's owned ephemeral MongoDB (the bootstrap shape of scripts/finance-integration.cjs:19-41: synthetic owners, device,
// account, template), owned headless Chrome, temporary directories. No production address, credential or send.
// Fail-first on 52f90f2: E1/E2/E4/E6 RED (collector/banks/contract.mjs missing), E3a-d RED (records carry no clicks),
// E5 RED (connection.variant undefined; observation route 404), V RED (no variant select), E7 green (control).
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 900000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB_VERIFY = 'C:/Users/Junsan2/Documents/ohmycode/scripts/zoomer-verify.mjs';
const requireRoot = createRequire(path.join(root, 'package.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const u = rel => pathToFileURL(path.join(root, rel)).href;
const GUID = /^[a-f\d-]{36}$/;

// ── The fake portal: two documents on the bank's login host, a CSV export, an error page and a wait page ──
const HOST = 'fes.rakuten-bank.co.jp', ORIGIN = 'https://' + HOST, ONE_PATH = '/MS/main/RbS', TWO_PATH = '/MS/main/RbS/statements';
const EXPORT_PATH = '/MS/main/RbS/export/meisai.csv', ERROR_PATH = '/MS/main/RbS/error', WAIT_PATH = '/MS/main/RbS/wait';
const START_STANDARD = ORIGIN + ONE_PATH + '?COMMAND=START&CurrentPageID=SWITCH_PAGE', START_PLUS = ORIGIN + ONE_PATH + '?COMMAND=LOGIN&CurrentPageID=START_ACCOUNT_PLUS';
const MENU_URL = ORIGIN + ONE_PATH + '?COMMAND=MENU', BUSINESS = 'https://www.rakuten-bank.co.jp/business/';
const ACCOUNT_LABEL = '普通 1234567 サンプル商事';
const CSV_BYTES = Buffer.from('取引日,摘要,出金,入金,残高,メモ\r\n2026/09/01,振込 サンプル商事,,50000,950000,入金\r\n2026/09/02,カード引落,30000,,920000,\r\n');
// The contract that describes the fake portal (the shape collector/banks/contract.mjs validates and draftContract produces).
const FIXTURE_CONTRACT = Object.freeze({
  recordedAt: 'fixture',
  login: { hosts: [HOST], inputs: [{ id: 'userid', type: 'text' }, { id: 'password', type: 'password' }] },
  authenticated: { control: 'ログアウト' },
  statements: { pathname: TWO_PATH, path: ['入出金明細'], control: null },
  period: { inputs: ['from', 'to'] },
  export: { pathname: TWO_PATH, control: 'CSV出力' },
  error: { titleIncludes: 'エラー' }
});
const STYLE = '<style>button,a,input{display:block;margin:8px;padding:8px}</style>';
// Document one: the login screen (a decoy ログアウト link is visible there too — the state table must let the password input
// decide, MC1) and, after sign-in or with COMMAND=MENU, the authenticated menu with a real link to document two.
function oneDocument(state) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 ビジネス</title>${STYLE}<body data-state="${state}"><div id="screen"></div><script>
  window.__clicks=0;window.__clicksBeforeAuth=0;
  document.addEventListener('click',()=>{window.__clicks++;if(document.body.dataset.state!=='authenticated')window.__clicksBeforeAuth++;},true);
  const screen=document.getElementById('screen'),set=s=>{document.body.dataset.state=s;draw();};
  function draw(){const s=document.body.dataset.state;
   if(s==='login')screen.innerHTML='<h1>ログイン</h1><input id="userid" type="text" placeholder="ID"><input id="password" type="password" placeholder="password"><button id="login">ログイン</button><a id="english" href="#">English</a><a id="logout-decoy" href="#">ログアウト</a>';
   else screen.innerHTML='<a id="logout" href="#">ログアウト</a><a id="statements" href="${TWO_PATH}">入出金明細</a>';
   document.getElementById('login')?.addEventListener('click',()=>window.__signIn());}
  window.__signIn=()=>{setTimeout(()=>set('authenticated'),50);};
  draw();</script></body></html>`;
}
// Document two: the statements page with the account label, the period inputs (portal defaults) and the CSV export link.
const twoDocument = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>入出金明細</title>${STYLE}<body data-state="statements"><a id="logout" href="#">ログアウト</a><div id="account">${ACCOUNT_LABEL}</div><label>開始日<input id="from" type="text" value="2026/09/01"></label><label>終了日<input id="to" type="text" value="2026/09/30"></label><a id="csv" href="${EXPORT_PATH}" download="meisai.csv">CSV出力</a><a id="menu" href="${MENU_URL}">メニューへ</a><script>window.__clicks=0;document.addEventListener('click',()=>{window.__clicks++;},true);</script></body></html>`;
const html = body => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
function intercept(page, stats) {
  return page.setRequestInterception(true).then(() => page.on('request', request => {
    const url = request.url(); stats.requests.push(url); if (request.isNavigationRequest()) stats.navigations.push(url);
    let parsed; try { parsed = new URL(url); } catch { return request.abort(); }
    if (parsed.origin === ORIGIN && parsed.pathname === ONE_PATH) return request.respond(html(oneDocument(parsed.searchParams.get('COMMAND') === 'MENU' ? 'authenticated' : 'login')));
    if (parsed.origin === ORIGIN && parsed.pathname === TWO_PATH) return request.respond(html(twoDocument()));
    if (parsed.origin === ORIGIN && parsed.pathname === EXPORT_PATH) { stats.exportRequests++; return request.respond({ status: 200, contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: CSV_BYTES }); }
    if (parsed.origin === ORIGIN && parsed.pathname === ERROR_PATH) return request.respond(html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>エラー</title>${STYLE}<body><p>システムエラーが発生しました</p><a href="#">トップへ</a></body></html>`));
    if (parsed.origin === ORIGIN && parsed.pathname === WAIT_PATH) return request.respond(html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>お待ちください</title><body><p>しばらくお待ちください</p></body></html>'));
    if (url === BUSINESS) return request.respond(html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人のお客さま</title><body><p>business</p></body></html>'));
    return request.abort();
  }));
}
const ACCOUNT = { _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4' }, OMF_ORIGIN = 'https://omf.example';
const SNAPSHOT = { templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', templateRevision: 3, headers: ['取引日', '摘要', '出金', '入金', '残高', 'メモ'], mapping: { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4', reference: '5' }, amountSign: 'outflow-positive', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'rakuten', accountLabel: 'サンプル商事', variant: 'standard', coverage: null };
const jobOf = (kind, variant = 'standard') => { const snapshot = { ...SNAPSHOT, variant }; return { jobId: randomUUID(), kind, snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'rakuten', support: kind === 'retrieve' ? 'verified' : 'contract-pending' }; };
const boundOf = job => ({ bankAccountId: ACCOUNT._id, ownerId: ACCOUNT.ownerId, origin: OMF_ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'rakuten' });
// An owned headless Chrome on the ephemeral profile the bank launcher will reuse (browserFor returns the browser already
// launched on that profile); every new page is intercepted. The launcher closes it and removes the profile afterwards.
async function launched(browserModule, dir, batch) {
  const profile = browserModule.ephemeralProfile(dir, ACCOUNT.ownerId, 'bank', ACCOUNT._id, batch);
  const browser = await browserModule.browserFor(profile, { ephemeral: true, root: dir, headless: true });
  const original = browser.newPage.bind(browser), stats = { requests: [], navigations: [], exportRequests: 0 }; let page = null;
  browser.newPage = async () => { page = await original(); await intercept(page, stats); return page; };
  return { browser, profile, stats, page: () => page };
}
// A sibling copy of a collector module with named edits applied (each anchor must hit exactly once): the deliberately
// reintroduced defects MC1/MC2/MC5/MC6/MC7/MC8 are expressed as the lines they change.
async function mutantModule(file, edits) {
  const source = path.join(root, file); let text = await readFile(source, 'utf8');
  for (const [anchor, replacement] of edits) { const hits = (text.match(new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g')) || []).length; if (hits !== 1) throw new Error('mutant anchor hits ' + hits + ' for ' + file + ' /' + anchor.source.slice(0, 60)); text = text.replace(anchor, replacement); }
  const target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async load() { try { return await import(pathToFileURL(target).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + (error?.message || error)); } }, async dispose() { await unlink(target).catch(() => {}); } };
}
async function walkRelativeImports(file, seen = new Set()) {
  const text = await readFile(file, 'utf8'), dir = path.dirname(file);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)'(\.[^']+)'/g)) { const target = path.resolve(dir, m[1]); if (!await exists(target)) throw new Error(path.relative(root, file).replaceAll('\\', '/') + ' imports ' + m[1] + ' which is not staged'); if (!seen.has(target)) { seen.add(target); await walkRelativeImports(target, seen); } }
  return seen;
}
async function files(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await files(f)); else if (e.name.endsWith('.mjs')) out.push(f); } return out; }
const RECORD_KEYS = ['at', 'clicks', 'downloadEvents', 'eventsDropped', 'inputs', 'pathname', 'selects', 'title', 'typedInto', 'visibleControls'];
const pick = c => ({ login: c?.login ?? null, authenticated: c?.authenticated ?? null, statements: c?.statements ?? null, period: c?.period ?? null, export: c?.export ?? null });

// ── The built app on an owned ephemeral MongoDB (the bootstrap of scripts/finance-integration.cjs:19-41) ──
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory) {
  const uri = mongo.getUri(dbName), port = await availablePort(), origin = `http://127.0.0.1:${port}`; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-15000); });
  let healthy = false;
  for (let i = 0; i < 100; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); throw new Error('owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body, type = 'application/json' } = {}) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const register = async email => { const r = await call('/api/auth/register', { method: 'POST', body: { email, password: 'Synthetic-password-Only1!', name: 'Finance test' } }); if (r.status !== 200) throw new Error('register ' + JSON.stringify(r.data).slice(0, 300)); return r.data.tokens.accessToken; };
  const token = await register('finance-a@example.invalid'), other = await register('finance-b@example.invalid');
  const card = await call('/api/finance/accounts', { method: 'POST', token, body: { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }); if (card.status !== 200) throw new Error('card account ' + JSON.stringify(card.data).slice(0, 300));
  const device = await call('/api/finance/collectors', { method: 'POST', token, body: { name: 'Test collector', accountIds: [card.data.account._id] } }); if (device.status !== 200) throw new Error('collector ' + JSON.stringify(device.data).slice(0, 300));
  return { origin, call, token, other, deviceToken: device.data.token, deviceId: device.data.id, logs: () => logs, async close() { if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}
// The HTTP scenario of E5 on one app: variant stored/frozen/tolerated, observation whitelist, owner-scoped read. Returns what
// the mutant check needs (the stored first page) and the ids the Chrome leg reuses.
async function httpScenario(app, assert) {
  const api = '/api/finance-payments/', capi = '/api/finance-payments/collector/';
  const req = (r, b, m = 'POST', t = app.token) => app.call(api + r, { method: m, token: t, body: b }), get = (r, t = app.token) => app.call(api + r, { token: t });
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 600)); return r.data; };
  const accountA = ok(await req('bank/accounts', { name: 'Synthetic Rakuten', currency: 'JPY' }), 'bank account A').account.id, accountB = ok(await req('bank/accounts', { name: 'Synthetic PayPay', currency: 'JPY' }), 'bank account B').account.id;
  const template = ok(await req('bank/templates', { name: 'Synthetic bank map', headers: SNAPSHOT.headers, mapping: SNAPSHOT.mapping }, 'PUT'), 'template').template;
  const connect = (account, body, t = app.token) => req('bank/accounts/' + account + '/connection', { templateId: template.id, ...body }, 'PUT', t);
  assert.equal(ok(await connect(accountA, { provider: 'rakuten', variant: 'plus' }), 'connection plus').account.connection.variant, 'plus', 'rakuten:variant-stored');
  assert.equal(ok(await connect(accountA, { provider: 'rakuten', variant: 'x' }), 'connection unknown variant').account.connection.variant, null, 'rakuten:variant-tolerant');
  assert.equal(ok(await connect(accountA, { provider: 'rakuten' }), 'connection without variant').account.connection.variant, null, 'rakuten:variant-tolerant (absent)');
  assert.equal(ok(await connect(accountB, { provider: 'paypay', variant: 'plus' }), 'connection paypay').account.connection.variant, null, 'rakuten:variant-tolerant (provider without variants)');
  assert.equal(ok(await connect(accountA, { provider: 'rakuten', variant: 'plus' }), 'connection plus again').account.connection.variant, 'plus');
  assert.equal(ok(await get('bank/accounts'), 'accounts').accounts.find(a => a.id === accountA).connection.variant, 'plus', 'rakuten:variant-stored (listed)');
  ok(await req('bank/collectors/' + app.deviceId, { bankAccountIds: [accountA] }, 'PUT'), 'device scope');
  const job = ok(await req('bank/accounts/' + accountA + '/sync', {}), 'sync').job;
  assert.equal(job.kind, 'observe', 'rakuten:observe-kept'); assert.equal(job.snapshot.variant, 'plus', 'rakuten:variant-frozen');
  assert.equal(job.snapshotHash, sha256(JSON.stringify(job.snapshot)), 'rakuten:variant-frozen (hash over the snapshot incl. variant)');
  assert.notEqual(job.snapshotHash, sha256(JSON.stringify({ ...job.snapshot, variant: null })), 'rakuten:variant-frozen (hash differs without the variant)');
  const claimed = ok(await app.call(capi + 'bank/claim', { method: 'POST', token: app.deviceToken, body: {} }), 'claim');
  assert.equal(claimed.job?.jobId, job.jobId); assert.equal(claimed.job.snapshot.variant, 'plus', 'rakuten:variant-frozen (claimed)');
  const at = '2026-10-19T00:00:00.000Z', many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const observation = [
    { at, pathname: ONE_PATH, title: '楽天銀行 ビジネス', visibleControls: ['ログイン'], inputs: [{ id: 'password', type: 'password', value: 'LEAKED-INPUT' }], selects: [], downloadEvents: [], cookies: 'LEAKED-COOKIE',
      clicks: [{ at, tag: 'BUTTON', text: 'ログイン', id: 'login', value: 'LEAKED-CLICK', nested: { value: 'LEAKED-NESTED' } }], typedInto: [{ at, id: 'password', type: 'password', value: 'LEAKED-TYPED' }], eventsDropped: 2 },
    { at, pathname: TWO_PATH, title: '入出金明細', visibleControls: ['CSV出力'], inputs: [], selects: [], downloadEvents: [{ host: HOST, suggestedFilename: 'meisai.csv', bytes: 10 }],
      clicks: many(70, i => ({ at, tag: 'A', text: 'c' + i, id: 'c' + i })), typedInto: many(120, i => ({ at, id: 'f' + i, type: 'text' })), eventsDropped: 'x' }
  ];
  const stored = ok(await app.call(capi + 'bank/upload?' + new URLSearchParams({ jobId: job.jobId, snapshotHash: job.snapshotHash, kind: 'observation' }), { method: 'POST', token: app.deviceToken, body: JSON.stringify(observation), type: 'application/json' }), 'observation upload');
  assert.equal(stored.stored, true); assert.equal(stored.pages, 2);
  const read = ok(await get('bank/accounts/' + accountA + '/jobs/' + job.jobId + '/observation'), 'observation read');
  assert.equal(read.jobId, job.jobId); assert.equal(read.kind, 'observe'); assert.ok(Array.isArray(read.observation) && read.observation.length === 2, 'rakuten:observation-read');
  assert.equal((await get('bank/accounts/' + accountA + '/jobs/' + job.jobId + '/observation', app.other)).status, 404, 'rakuten:observation-owner-scoped');
  assert.equal((await get('bank/accounts/' + accountB + '/jobs/' + job.jobId + '/observation')).status, 404, 'rakuten:observation-owner-scoped (other account)');
  assert.equal((await get('bank/accounts/' + accountA + '/jobs/' + randomUUID() + '/observation')).status, 404, 'rakuten:observation-owner-scoped (unknown job)');
  assert.equal((await get('bank/accounts/' + accountA + '/jobs/' + job.jobId)).status, 404, 'unchanged routing: no 5-part job route');
  assert.equal(ok(await get('bank/accounts/' + accountA + '/jobs'), 'jobs').jobs.find(j => j.jobId === job.jobId).hasObservation, true);
  ok(await app.call(capi + 'bank/status', { method: 'POST', token: app.deviceToken, body: { jobId: job.jobId, state: 'complete', message: '観察記録を保存' } }), 'status complete');
  return { accountA, accountB, job, template, stored: read.observation[0], second: read.observation[1] };
}

export default { name: 'omf-rakuten-bank-connector', covers: ['collector/banks/contract.mjs', 'collector/banks/rakuten.mjs', 'collector/bank.mjs', 'server/services/financeBankCollectionService.ts', 'server/api/finance-payments/[...path].ts', 'shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'components/intake/BankConnections.vue', 'collector/package/stage.mjs', 'docs/payment-matching.md', 'scripts/finance-bank-collection-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'scripts/zoomer-fixtures/omf-rakuten-bank-connector.mjs'], async run() {
  const started = Date.now(), lines = []; let pass = true;
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1200)); } };
  const assert = (await import('node:assert/strict')).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-rakuten-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  let mongo = null, app = null, executed = false;
  try {
    const browserModule = await import(u('collector/browser.mjs')).catch(e => e), interaction = await import(u('collector/interaction.mjs')).catch(e => e);
    const bankModule = await import(u('collector/bank.mjs')).catch(e => e), rakutenModule = await import(u('collector/banks/rakuten.mjs')).catch(e => e), contractModule = await import(u('collector/banks/contract.mjs')).catch(e => e);
    const need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const rakuten = () => need(rakutenModule, 'collector/banks/rakuten.mjs').default;
    const noOwnedChrome = async () => { assert.equal(need(browserModule, 'collector/browser.mjs').ownedBrowsers().filter(b => b.connected).length, 0, 'rakuten:browser-closed'); };
    // ── E1: the engine runs the recorded contract automatically ──
    const engineRun = async (batch, adapter, extra = {}) => {
      const bank = need(bankModule, 'collector/bank.mjs'), dir = path.join(temp, batch); await mkdir(dir, { recursive: true });
      const job = jobOf('retrieve'), bound = boundOf(job), l = await launched(need(browserModule, 'collector/browser.mjs'), dir, batch), statuses = []; let clicksBeforeAuth = null;
      const status = async (state, text) => { statuses.push([state, text]); if (state === 'verification_required') { clicksBeforeAuth = await l.page().evaluate(() => window.__clicksBeforeAuth); await l.page().evaluate(() => window.__signIn()); } };
      let result = null, error = null;
      try { result = await bank.collectBankStatement(bound, job, dir, status, { adapter, batch, pollMs: 200, loginTimeoutMs: 20000, downloadTimeoutMs: 20000, extensionMs: 0, ...extra }); } catch (e) { error = e; }
      return { job, result, error, statuses, clicksBeforeAuth, stats: l.stats, profile: l.profile };
    };
    await leg('E1 contract engine automatic run (owned headless Chrome, fake portal): one intervention at login, zero clicks before authenticated, recorded path/period/export automated, CSV from the login host, manifest bound to job+snapshot', async () => {
      const adapter = { ...rakuten(), support: 'verified', contract: FIXTURE_CONTRACT };
      const r = await engineRun('e1', adapter); if (r.error) throw r.error;
      assert.equal(r.result.failed, null, JSON.stringify(r.result)); assert.equal(r.result.items.length, 1, 'rakuten:engine-automated');
      const m = r.result.items[0].manifest;
      assert.equal(m.sourceHost, HOST, 'rakuten:engine-automated (download from the login host)'); assert.equal(m.sha256, sha256(CSV_BYTES)); assert.equal(m.jobId, r.job.jobId); assert.equal(m.snapshotHash, r.job.snapshotHash); assert.equal(m.channel, 'collector'); assert.equal(m.labelChecked, true, 'rakuten:engine-automated (account label checked)');
      assert.equal(m.period, '2026/09/01〜2026/09/30', 'rakuten:engine-automated (portal default period read from the contract inputs)');
      assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1, 'rakuten:one-intervention'); assert.equal(r.clicksBeforeAuth, 0, 'rakuten:zero-clicks-before-auth');
      assert.equal(r.stats.navigations[0], START_STANDARD, 'rakuten:variant-start (standard start for the frozen variant)'); assert.ok(r.stats.navigations.some(x => new URL(x).pathname === TWO_PATH), 'rakuten:engine-automated (statements opened by the recorded path)'); assert.equal(r.stats.exportRequests, 1, 'rakuten:engine-automated (one export click)');
      assert.ok(r.statuses.some(([s, t]) => s === 'running' && /CSV/.test(t))); await noOwnedChrome(); assert.equal(await exists(r.profile), false, 'rakuten:ephemeral-profile-removed');
      return `one verification_required, 0 clicks before auth, ${r.stats.requests.length} intercepted requests, manifest ${m.sha256.slice(0, 8)}, period ${m.period}`;
    });
    // ── E2: the state table, contract null kept pending, validateContract ──
    await leg('E2 state table (login with a decoy ログアウト / authenticated / export_ready / statements / error_page / unknown), contract null keeps contract-pending with the pages still reachable, validateContract rejects an incomplete contract before any page', async () => {
      const contract = need(contractModule, 'collector/banks/contract.mjs'), bm = need(browserModule, 'collector/browser.mjs'), { poll } = need(interaction, 'collector/interaction.mjs'), dir = path.join(temp, 'e2'); await mkdir(dir, { recursive: true });
      const l = await launched(bm, dir, 'e2'); const kinds = [];
      try {
        const page = await l.browser.newPage(), adapter = { ...rakuten(), support: 'verified', contract: FIXTURE_CONTRACT }, ui = adapter.ui(page, l.browser, { variant: 'standard' });
        const kind = async () => { const k = (await ui.state()).kind; kinds.push(k); return k; };
        await ui.open(); assert.equal(page.url(), START_STANDARD); assert.equal(await kind(), 'login', 'rakuten:state-table login (password input decides over the decoy ログアウト)');
        await page.evaluate(() => window.__signIn()); await poll(() => page.evaluate(() => document.body.dataset.state === 'authenticated'), 5000, 50); assert.equal(await kind(), 'authenticated', 'rakuten:state-table authenticated');
        await page.goto(ORIGIN + TWO_PATH, { waitUntil: 'domcontentloaded' }); assert.equal(await kind(), 'export_ready', 'rakuten:state-table export_ready');
        await page.evaluate(() => document.getElementById('csv').remove()); assert.equal(await kind(), 'statements', 'rakuten:state-table statements');
        await page.goto(ORIGIN + ERROR_PATH, { waitUntil: 'domcontentloaded' }); assert.equal(await kind(), 'error_page', 'rakuten:state-table error_page');
        await page.goto(ORIGIN + WAIT_PATH, { waitUntil: 'domcontentloaded' }); assert.equal(await kind(), 'unknown', 'rakuten:state-table unknown (wait page)');
        await page.goto('about:blank'); assert.equal(await kind(), 'unknown', 'rakuten:state-table unknown (off the bank hosts)');
        // contract null: open/state/show work, every routine step rejects contract-pending (rakuten.mjs keeps contract null)
        const stub = rakuten(); assert.equal(stub.contract, null, 'rakuten:contract-pending-kept'); assert.equal(stub.support, 'contract-pending', 'rakuten:contract-pending-kept');
        const pendingUi = stub.ui(page, l.browser, { variant: 'standard' }); const before = l.stats.requests.length;
        for (const step of ['openStatements', 'selectPeriod', 'snapshot', 'exportCsv', 'login']) await assert.rejects(pendingUi[step](null), e => e?.code === 'contract-pending' || /contract-pending|サインイン/.test(String(e?.message)), 'rakuten:contract-pending-kept ' + step);
        assert.equal(l.stats.requests.length, before, 'rakuten:contract-pending-kept (no page touched by a rejected step)');
        await pendingUi.open(); assert.equal(page.url(), START_STANDARD); assert.equal((await pendingUi.state()).kind, 'unknown', 'rakuten:contract-pending-kept (state unknown without a contract)');
        // validateContract: complete passes, incomplete rejects with contract-pending before any page is touched
        assert.equal(contract.validateContract(FIXTURE_CONTRACT), FIXTURE_CONTRACT);
        const { export: _e, ...noExport } = FIXTURE_CONTRACT; const rejects = c => assert.throws(() => contract.validateContract(c), e => e?.code === 'contract-pending', 'rakuten:contract-validated');
        rejects(noExport); rejects(null); rejects({ ...FIXTURE_CONTRACT, login: { hosts: [], inputs: [] } }); rejects({ ...FIXTURE_CONTRACT, statements: { pathname: 'statements', path: [] } }); rejects({ ...FIXTURE_CONTRACT, authenticated: {} });
        const invalidUi = contract.contractUi(page, l.browser, { ...stub, support: 'verified', contract: noExport }, null); const before2 = l.stats.requests.length;
        await assert.rejects(invalidUi.openStatements(), e => e?.code === 'contract-pending', 'rakuten:contract-validated (engine refuses an incomplete contract)'); assert.equal(l.stats.requests.length, before2, 'rakuten:contract-validated (before any bank page)');
        assert.equal(contract.classify({ host: HOST, pathname: ONE_PATH, title: 'x', controls: ['ログアウト'], password: true }, FIXTURE_CONTRACT, stub.hosts), 'login', 'rakuten:state-table (pure classify)');
      } finally { await bm.closeOwnedBrowsers(); }
      return 'states ' + kinds.join(' → ') + '; contract null rejects 5 routine steps and still opens the start page; incomplete contracts rejected';
    });
    // ── E3: the observe recorder keeps the person's clicks and edited fields — value-free, chronological, on the page they happened on ──
    const observeFlow = async (bankMod, batch) => {
      const bm = need(browserModule, 'collector/browser.mjs'), { poll } = need(interaction, 'collector/interaction.mjs'), dir = path.join(temp, batch); await mkdir(dir, { recursive: true });
      const job = jobOf('observe'), bound = boundOf(job), adapter = { ...rakuten(), support: 'contract-pending', contract: null }, l = await launched(bm, dir, batch);
      const statuses = []; let person = null, personError = null, bindingName = null, hostile = null;
      const pattern = bankMod.OBSERVE_BINDING instanceof RegExp ? bankMod.OBSERVE_BINDING.source : null;
      const status = async (state, text) => { statuses.push([state, text]); if (state !== 'verification_required' || person) return; person = (async () => {
        const page = l.page(); await pause(400);
        bindingName = pattern ? await page.evaluate(p => Object.getOwnPropertyNames(window).find(k => new RegExp(p).test(k) && typeof window[k] === 'function') || null, pattern) : null;
        await page.type('#userid', 'secret-user-id'); await page.type('#password', 'Secret-Pass-9981');
        // E3d: a page script calls the binding with whatever it likes — a value, a list of clicks, a kind-less object, not JSON
        if (bindingName) hostile = await page.evaluate(name => { const out = []; for (const payload of [JSON.stringify({ kind: 'click', tag: 'HOSTILE', text: 'x', id: 'y', value: 'LEAKED-VALUE', clicks: [{ tag: 'z' }] }), JSON.stringify({ value: 'LEAKED-VALUE-2', clicks: [1, 2, 3] }), 'not json', JSON.stringify({ kind: 'input', id: 'smuggle', type: 'text', value: 'LEAKED-VALUE-3' })]) { try { window[name](payload); out.push('sent'); } catch { out.push('threw'); } } return out; }, bindingName);
        await pause(300); await page.click('#login'); await poll(() => page.evaluate(() => document.body.dataset.state === 'authenticated'), 5000, 50);
        await pause(400); await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }), page.click('#statements')]);
        await pause(400); await page.click('#from', { clickCount: 3 }); await page.type('#from', '2026/09/01'); await page.click('#to', { clickCount: 3 }); await page.type('#to', '2026/09/30');
        await page.click('#csv'); await pause(1500); await page.close();
      })().catch(e => { personError = e; }); };
      const result = await bankMod.observeBankPortal(bound, job, dir, status, { adapter, batch, pollMs: 100, timeoutMs: 30000 });
      await person;
      return { job, result, personError, statuses, bindingName, hostile, stats: l.stats, profile: l.profile };
    };
    const observationChecks = (r, contract) => {
      assert.equal(r.personError, null, 'fixture person flow failed: ' + String(r.personError?.message || r.personError));
      const obs = r.result.observation, text = JSON.stringify(obs);
      for (const rec of obs) { assert.deepEqual(Object.keys(rec).sort(), RECORD_KEYS, 'rakuten:record-keys'); for (const c of rec.clicks) assert.deepEqual(Object.keys(c).sort(), ['at', 'id', 'tag', 'text'], 'rakuten:binding-whitelist'); for (const t of rec.typedInto) assert.deepEqual(Object.keys(t).sort(), ['at', 'id', 'type'], 'rakuten:binding-whitelist (typedInto carries id and type only)'); assert.ok(Number.isSafeInteger(rec.eventsDropped)); }
      assert.ok(!/secret-user-id|Secret-Pass-9981|LEAKED/.test(text), 'rakuten:no-typed-value');
      assert.equal(obs.length, 3, 'rakuten:same-dom-events-retained (events never create a record: login, menu, statements) ' + obs.map(x => x.pathname + '/' + x.visibleControls.join('|')).join(' ; '));
      const [r0, r1, r2] = obs;
      assert.ok(r0.pathname === ONE_PATH && r0.inputs.some(i => i.type === 'password'), 'login record first');
      assert.deepEqual(r0.typedInto.map(t => t.id), ['userid', 'password', 'smuggle'], 'rakuten:same-dom-events-retained (edited fields on the unchanged login page, one entry per field)');
      assert.deepEqual(r0.clicks.map(c => [c.tag, c.text, c.id]), [['HOSTILE', 'x', 'y'], ['BUTTON', 'ログイン', 'login']], 'rakuten:same-dom-events-retained (clicks on the unchanged login page, in order)');
      assert.ok(r0.typedInto[0].at <= r0.typedInto[1].at && r0.typedInto[1].at <= r0.clicks[0].at && r0.clicks[0].at <= r0.clicks[1].at, 'rakuten:same-dom-events-retained (chronological)');
      assert.ok(r.bindingName, 'rakuten:binding-whitelist (the binding is reachable by a page script)'); assert.deepEqual(r.hostile, ['sent', 'sent', 'sent', 'sent'], 'hostile calls reached the binding');
      assert.equal(r0.clicks.length, 2, 'rakuten:binding-whitelist (a kind-less object and a non-JSON payload add nothing)'); assert.equal(r0.eventsDropped, 0);
      assert.equal(r1.pathname, ONE_PATH); assert.ok(r1.visibleControls.includes('入出金明細') && !r1.inputs.length, 'authenticated menu record second');
      assert.deepEqual(r1.clicks.map(c => [c.tag, c.text, c.id]), [['A', '入出金明細', 'statements']], 'rakuten:events-survive-navigation (the navigating click stays on its source page)');
      assert.equal(r2.pathname, TWO_PATH, 'rakuten:events-survive-navigation (the new document has its own record)');
      assert.deepEqual(r2.clicks.map(c => c.text), ['CSV出力'], 'rakuten:events-survive-navigation (the new document has its own clicks)'); assert.deepEqual(r2.typedInto.map(t => t.id), ['from', 'to'], 'rakuten:events-survive-navigation (fields edited on the new document)');
      assert.ok(r2.downloadEvents.some(d => d.host === HOST && d.suggestedFilename === 'meisai.csv'), 'download event on the statements record');
      assert.equal(r.result.items.length, 1, 'preparatory CSV retained'); assert.equal(r.result.items[0].manifest.channel, 'collector-observe'); assert.equal(r.result.items[0].manifest.sourceHost, HOST); assert.equal(r.result.items[0].manifest.sha256, sha256(CSV_BYTES));
      assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1);
      const draft = contract.draftContract(obs); assert.deepEqual(pick(draft), pick(FIXTURE_CONTRACT), 'rakuten:draft-matches'); assert.equal(contract.validateContract(draft), draft, 'rakuten:draft-matches (the draft validates)');
      assert.deepEqual(pick(contract.draftContract(obs, { loginHosts: rakuten().loginHosts })), pick(FIXTURE_CONTRACT), 'rakuten:draft-matches (adapter login hosts)');
      return obs;
    };
    await leg('E3a/E3b/E3d observe recorder (owned headless Chrome, typed secret): same-DOM click+input retained in order on the login record, the navigating click on its source page and the new document with its own events, a hostile binding call keeps only whitelisted keys, draftContract equals the fixture contract', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), contract = need(contractModule, 'collector/banks/contract.mjs');
      const r = await observeFlow(bank, 'e3'); const obs = observationChecks(r, contract); await noOwnedChrome(); assert.equal(await exists(r.profile), false);
      // eventInput alone: the Node-side whitelist and bounds
      assert.equal(typeof bank.eventInput, 'function', 'eventInput exported');
      assert.deepEqual(bank.eventInput(JSON.stringify({ kind: 'click', tag: 'A', text: 't', id: 'i', value: 'v', clicks: [] })), { kind: 'click', tag: 'A', text: 't', id: 'i' }, 'rakuten:binding-whitelist (eventInput)');
      assert.deepEqual(bank.eventInput(JSON.stringify({ kind: 'input', id: 'i', type: 'password', value: 'v' })), { kind: 'input', id: 'i', type: 'password' }, 'rakuten:binding-whitelist (eventInput input)');
      assert.equal(bank.eventInput('nope'), null); assert.equal(bank.eventInput(JSON.stringify({ value: 'x' })), null); assert.equal(bank.eventInput(JSON.stringify([1])), null);
      const long = bank.eventInput(JSON.stringify({ kind: 'click', tag: 'x'.repeat(30), text: 'y'.repeat(50), id: 'z'.repeat(120) })); assert.deepEqual([long.tag.length, long.text.length, long.id.length], [20, 40, 100], 'rakuten:binding-whitelist (bounds)');
      return `${obs.length} records: login [${obs[0].typedInto.map(t => t.id)} / ${obs[0].clicks.map(c => c.text)}], menu [${obs[1].clicks.map(c => c.text)}], statements [${obs[2].typedInto.map(t => t.id)} / ${obs[2].clicks.map(c => c.text)}]; binding ${r.bindingName}; draft equals the fixture contract`;
    });
    // E3c: a click while the loop sleeps, then the tab closes before the next poll — the fixture holds the loop's wait so the
    // order is exact (plan: "within one pollMs of the tab close").
    const closeFlow = async (bankMod, batch) => {
      const bm = need(browserModule, 'collector/browser.mjs'), dir = path.join(temp, batch); await mkdir(dir, { recursive: true });
      const job = jobOf('observe'), bound = boundOf(job), adapter = { ...rakuten(), support: 'contract-pending', contract: null }, l = await launched(bm, dir, batch);
      let released = false, personError = null; const waits = []; const release = () => { released = true; for (const w of waits.splice(0)) w(); };
      const wait = () => released ? Promise.resolve() : new Promise(resolve => waits.push(resolve));
      const status = async state => { if (state !== 'verification_required') return; setTimeout(async () => { try { const page = l.page(); await page.click('#english'); await page.close(); } catch (e) { personError = e; } finally { release(); } }, 300); };
      const result = await bankMod.observeBankPortal(bound, job, dir, status, { adapter, batch, pollMs: 100, timeoutMs: 30000, wait });
      return { result, personError, profile: l.profile };
    };
    await leg('E3c close boundary: a click while the recorder sleeps, then the tab closes before the next poll → the click is present after observeFromPage returns', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'); const r = await closeFlow(bank, 'e3c');
      assert.equal(r.personError, null, 'fixture person failed: ' + String(r.personError?.message)); assert.equal(r.result.closed, true);
      const obs = r.result.observation; assert.equal(obs.length, 1); assert.deepEqual(obs[0].clicks.map(c => [c.tag, c.text, c.id]), [['A', 'English', 'english']], 'rakuten:events-survive-close');
      await noOwnedChrome(); assert.equal(await exists(r.profile), false);
      return 'the click before the close is on the last record';
    });
    // ── E4: the frozen variant picks the start page ──
    await leg('E4 variant start: plus → the Plus login link, standard → the standard login link, none/unknown → the business page', async () => {
      const bm = need(browserModule, 'collector/browser.mjs'), adapter = rakuten(), dir = path.join(temp, 'e4'); await mkdir(dir, { recursive: true });
      const l = await launched(bm, dir, 'e4');
      try {
        const page = await l.browser.newPage(); const opened = async snapshot => { await adapter.ui(page, l.browser, snapshot).open(); return l.stats.navigations.at(-1); };
        assert.equal(await opened({ variant: 'plus' }), START_PLUS, 'rakuten:variant-start plus'); assert.equal(await opened({ variant: 'standard' }), START_STANDARD, 'rakuten:variant-start standard');
        assert.equal(await opened(null), BUSINESS, 'rakuten:variant-start null'); assert.equal(await opened({ variant: null }), BUSINESS, 'rakuten:variant-start variant null'); assert.equal(await opened({ variant: 'x' }), BUSINESS, 'rakuten:variant-start unknown variant');
        assert.deepEqual(adapter.starts, { standard: START_STANDARD, plus: START_PLUS }, 'rakuten:variant-start (official link targets)'); assert.deepEqual(adapter.loginHosts, [HOST]); assert.equal(adapter.start, BUSINESS); assert.deepEqual(adapter.hosts, ['rakuten-bank.co.jp']);
      } finally { await bm.closeOwnedBrowsers(); }
      return 'plus/standard/none → ' + [START_PLUS, START_STANDARD, BUSINESS].map(x => new URL(x).search || new URL(x).pathname).join(', ');
    });
    // ── E5 + V: the built app on the owned MongoDB; the connection variant, the observation whitelist and read; real Chrome ──
    let http = null;
    await leg('E5 HTTP on the built app (owned MongoDB): variant stored, unknown → null (no 400), frozen on the job snapshot and hash, observation upload keeps clicks/typedInto/eventsDropped within bounds and drops every value, GET jobs/:jobId/observation owner-scoped', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('built app absent; no HTTP coverage');
      const { MongoMemoryServer } = requireRoot('mongodb-memory-server'); const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
      mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined });
      app = await bootApp(root, mongo, 'rakuten_connector_fixture', path.join(temp, 'data')); executed = true;
      http = await httpScenario(app, assert);
      const stored = http.stored, text = JSON.stringify([http.stored, http.second]);
      assert.deepEqual(Object.keys(stored).sort(), RECORD_KEYS, 'rakuten:observation-whitelist (record keys)'); assert.deepEqual(stored.clicks.map(c => Object.keys(c).sort()), [['at', 'id', 'tag', 'text']], 'rakuten:observation-whitelist (click keys)'); assert.deepEqual(stored.typedInto.map(t => Object.keys(t).sort()), [['at', 'id', 'type']], 'rakuten:observation-whitelist (typedInto keys)');
      assert.deepEqual(stored.inputs, [{ id: 'password', type: 'password' }], 'rakuten:observation-whitelist (input value dropped)'); assert.ok(!text.includes('LEAKED'), 'rakuten:observation-whitelist (no value stored)'); assert.equal(stored.eventsDropped, 2, 'rakuten:observation-whitelist (eventsDropped kept)');
      assert.equal(http.second.eventsDropped, 0, 'rakuten:observation-bounds (non-integer → 0)'); assert.equal(http.second.clicks.length, 60, 'rakuten:observation-bounds (clicks ≤ 60)'); assert.equal(http.second.typedInto.length, 100, 'rakuten:observation-bounds (typedInto ≤ 100)');
      return `variant plus stored and frozen (hash ${http.job.snapshotHash.slice(0, 8)}), unknown → null, observation sanitized (2 pages), read owner-scoped`;
    });
    await leg('V real Chrome 390/1440 px on the built app: ログイン方式 select seeded from the saved connection, hidden for a provider without variants, saved variant shown, 観察記録を見る shows the recorded pages, no overflow, no console errors', async () => {
      if (!app || !http) throw new Error('NOT RUN: E5 did not boot the app');
      const bm = need(browserModule, 'collector/browser.mjs'), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-rakuten-browser-')), browser = await bm.browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
      try {
        page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 }); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
        const wait = async (f, arg) => { for (let i = 0; i < 250; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw Error('rakuten:chrome condition ' + f.toString().slice(0, 160)); };
        await page.goto(app.origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', 'finance-a@example.invalid'); await page.type('#password', 'Synthetic-password-Only1!'); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/');
        await page.goto(app.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]')); await page.click('[data-bank-connections-open]'); await wait(() => !!document.querySelector('[data-bank-connections]')); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-variant]'), http.accountA);
        const card = id => '[data-bank-connection="' + id + '"] ', overflowing = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => e.tagName + '.' + String(e.className).slice(0, 50) + '@' + Math.round(e.getBoundingClientRect().right)));
        assert.equal(await page.$eval(card(http.accountA) + '[data-bank-variant]', e => e.value), 'plus', 'rakuten:chrome-variant-select (seeded from the saved connection)');
        assert.match(await page.$eval(card(http.accountA) + '[data-bank-connection-state]', e => e.textContent), /口座管理プラス/, 'rakuten:chrome-variant-shown');
        assert.equal(await page.$(card(http.accountB) + '[data-bank-variant]'), null, 'rakuten:chrome-variant-hidden (PayPay銀行 has no login variants)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'rakuten:chrome-no-overflow ' + JSON.stringify(await overflowing()));
        await page.select(card(http.accountA) + '[data-bank-variant]', 'standard'); await page.click(card(http.accountA) + '[data-bank-connect-save]');
        await wait(id => /標準ログイン/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-connection-state]')?.textContent || ''), http.accountA);
        assert.equal((await app.call('/api/finance-payments/bank/accounts', { token: app.token })).data.accounts.find(a => a.id === http.accountA).connection.variant, 'standard', 'rakuten:chrome-variant-saved');
        const jobLine = card(http.accountA) + '[data-bank-job="' + http.job.jobId + '"]'; await wait(sel => !!document.querySelector(sel), jobLine);
        assert.match(await page.$eval(jobLine, e => e.textContent), /観察記録あり/, 'rakuten:chrome-observation-listed'); await page.click(jobLine + ' [data-bank-observation-open]'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-observation]'), http.accountA);
        const view = await page.$eval(card(http.accountA) + '[data-bank-observation]', e => e.textContent); assert.ok(view.includes(ONE_PATH) && view.includes(TWO_PATH) && view.includes('ログイン') && view.includes('meisai.csv'), 'rakuten:chrome-observation-view ' + view.slice(0, 200)); assert.ok(!view.includes('LEAKED'), 'rakuten:chrome-observation-view (no value)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'rakuten:chrome-no-overflow (observation open) ' + JSON.stringify(await overflowing()));
        if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) { await mkdir(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'rakuten-connection-mobile.png'), fullPage: true }); }
        await page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'rakuten:chrome-desktop-no-overflow');
        await page.evaluate(() => document.documentElement.classList.add('dark')); assert.equal(await page.$eval(card(http.accountA) + '[data-bank-variant]', e => getComputedStyle(e).backgroundColor), 'rgb(30, 41, 59)', 'rakuten:chrome-dark-control');
        if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'rakuten-connection-desktop-dark.png'), fullPage: true });
        assert.deepEqual(errors, [], 'rakuten:chrome-no-console-errors');
      } finally { if (page) await page.close().catch(() => {}); await browser.close(); if (!path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe owned Chrome cleanup'); await rm(profileDir, { recursive: true, force: true }); }
      return 'variant select seeded/saved/hidden, 観察記録を見る renders the pages, 390/1440 px without overflow, dark control, no console errors';
    });
    // ── E6: the package carries and hashes banks/contract.mjs; the staged graph resolves and loads ──
    await leg('E6 package: banks/contract.mjs staged and hashed, the staged graph resolves (index → bank → banks/rakuten → banks/contract), staged modules load without a live bank; a stage copy without banks/contract fails the named assertion', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const closure = async (mod, dir) => { const { manifest } = await mod.stage({ into: dir, origin: 'https://omf.example', install: false, log: () => {} }); if (!manifest.files['collector/banks/contract.mjs']) throw new Error('rakuten:contract-staged missing collector/banks/contract.mjs'); if (manifest.files['collector/banks/contract.mjs'] !== sha256(await readFile(path.join(root, 'collector/banks/contract.mjs')))) throw new Error('rakuten:contract-staged hash differs'); await walkRelativeImports(path.join(dir, 'collector', 'index.mjs')); return manifest; };
      const manifest = await closure(stageModule, into);
      const stagedContract = await import(pathToFileURL(path.join(into, 'collector/banks/contract.mjs')).href); assert.equal(typeof stagedContract.validateContract, 'function'); assert.equal(typeof stagedContract.draftContract, 'function'); assert.equal(typeof stagedContract.contractUi, 'function');
      const stagedRakuten = await import(pathToFileURL(path.join(into, 'collector/banks/rakuten.mjs')).href); assert.equal(stagedRakuten.default.contract, null); assert.equal(stagedRakuten.default.support, 'contract-pending'); assert.deepEqual(Object.keys(stagedRakuten.default.starts), ['standard', 'plus']);
      await assert.rejects(stagedRakuten.default.ui({}, {}, null).openStatements(), /contract-pending/, 'staged routine step rejects contract-pending');
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector/bank.mjs')).href); assert.equal(typeof stagedBank.eventInput, 'function'); assert.equal(stagedBank.adapterFor('rakuten').starts.plus, START_PLUS);
      // MC4: the allowlist without banks/contract
      const source = path.join(root, 'collector/package/stage.mjs'), text = await readFile(source, 'utf8'), hits = (text.match(/,\s*'banks\/contract'/g) || []).length; if (hits !== 1) throw new Error('stage.mjs allowlist anchor hits ' + hits);
      const mutant = path.join(path.dirname(source), `stage.mutant-rakuten-${process.pid}.mjs`); await writeFile(mutant, text.replace(/,\s*'banks\/contract'/, ''), { flag: 'wx' });
      try { const mod = await import(pathToFileURL(mutant).href); let failure = null; try { await closure(mod, path.join(temp, 'staged-mutant')); } catch (e) { failure = e; } if (!failure || !/rakuten:contract-staged|contract\.mjs which is not staged/.test(failure.message)) throw new Error('MC4 did not fail the named assertion: ' + (failure?.message || 'passed')); } finally { await unlink(mutant).catch(() => {}); }
      return Object.keys(manifest.files).length + ' files staged; banks/contract.mjs hashed; graph resolves; staged contract/rakuten/bank load; MC4 caught by rakuten:contract-staged';
    });
    // ── Deliberately reintroduced defects ──
    await leg('MC1/MC2/MC5/MC6/MC7/MC8 collector mutants: each flips its named assertion (ignored password input → one-intervention; listener sends the value → no-typed-value; events drained through record() → same-dom/navigation; final flush removed → survive-close; eventInput whitelist removed → binding-whitelist; Runtime.enable omitted → same-dom)', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), contract = need(contractModule, 'collector/banks/contract.mjs'); const caught = [];
      const flips = async (label, fn, pattern) => { let error = null; try { await fn(); } catch (e) { error = e; } if (!error) throw new Error(label + ' did not flip (the assertion passed on the mutant)'); if (!pattern.test(String(error.message))) throw new Error(label + ' flipped the wrong assertion: ' + String(error.message).slice(0, 300)); caught.push(label + '→' + String(error.message).match(pattern)[0]); };
      // MC1: the state table ignores the password input → the login screen (with its decoy ログアウト) reads as authenticated → zero interventions
      { const m = await mutantModule('collector/banks/contract.mjs', [[/&& page\.password\) return 'login';/, "&& false) return 'login';"]]); try { const mod = await m.load(); const adapter = { ...rakuten(), support: 'verified', contract: FIXTURE_CONTRACT, ui(page, browser, snapshot) { return mod.contractUi(page, browser, this, snapshot); } };
        await flips('MC1', async () => { const r = await engineRun('mc1', adapter, { loginTimeoutMs: 8000 }); assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1, 'rakuten:one-intervention'); if (r.error) throw r.error; }, /rakuten:one-intervention/); } finally { await m.dispose(); } }
      // MC2: the page listener sends the edited field's value (inside the id it reports) → the typed secret reaches the record
      { const m = await mutantModule('collector/bank.mjs', [[/id: String\(target\.id \|\| target\.name \|\| ''\)\.slice\(0, 100\), type: String\(target\.type \|\| 'text'\)/, "id: String(target.value || target.id || '').slice(0, 100), type: String(target.type || 'text')"]]); try { const mod = await m.load();
        await flips('MC2', async () => observationChecks(await observeFlow(mod, 'mc2'), contract), /rakuten:no-typed-value/); } finally { await m.dispose(); } }
      // MC5: events are no longer attached on arrival but drained when record() creates a record (the original R3 design)
      { const m = await mutantModule('collector/bank.mjs', [[/const records = \[\], downloads = \[\], pending = \[\];/, 'const records = [], downloads = [], pending = [], drained = [];'], [/if \(input\) pending\.push\(\{ at: stamp\(\), \.\.\.input \}\);/, 'if (input) drained.push({ at: stamp(), ...input });'], [/if \(records\.length < 200\) records\.push\(fresh\(snap\)\);/, 'if (records.length < 200) { records.push(fresh(snap)); for (const event of drained.splice(0)) attachEvent(records.at(-1), event); }']]); try { const mod = await m.load();
        await flips('MC5', async () => observationChecks(await observeFlow(mod, 'mc5'), contract), /rakuten:same-dom-events-retained|rakuten:events-survive-navigation/); } finally { await m.dispose(); } }
      // MC6: the final flush at the end of the loop is removed → the click before the close is lost
      { const m = await mutantModule('collector/bank.mjs', [[/\} finally \{ flush\(\); await cdp\?\.detach\(\)/, '} finally { await cdp?.detach()']]); try { const mod = await m.load();
        await flips('MC6', async () => { const r = await closeFlow(mod, 'mc6'); assert.equal(r.personError, null); assert.deepEqual(r.result.observation[0].clicks.map(c => c.text), ['English'], 'rakuten:events-survive-close'); }, /rakuten:events-survive-close/); } finally { await m.dispose(); } }
      // MC7: the Node-side whitelist passes the page's payload through → a hostile call's keys reach the record
      { const m = await mutantModule('collector/bank.mjs', [[/return \{ kind: 'click', tag: str\(body\.tag, 20\), text: str\(body\.text, 40\), id: str\(body\.id, 100\) \};/, "return { ...body, kind: 'click' };"], [/return \{ kind: 'input', id: str\(body\.id, 100\), type: str\(body\.type, 30\) \};/, "return { ...body, kind: 'input' };"]]); try { const mod = await m.load();
        await flips('MC7', async () => observationChecks(await observeFlow(mod, 'mc7'), contract), /rakuten:binding-whitelist|rakuten:no-typed-value/); } finally { await m.dispose(); } }
      // MC8: Runtime.enable omitted on the observation session → the binding delivers nothing on this launch
      { const m = await mutantModule('collector/bank.mjs', [[/await cdp\.send\('Runtime\.enable'\);/, '/* MC8: Runtime.enable omitted */']]); try { const mod = await m.load();
        await flips('MC8', async () => observationChecks(await observeFlow(mod, 'mc8'), contract), /rakuten:same-dom-events-retained/); } finally { await m.dispose(); } }
      await noOwnedChrome();
      return caught.join(', ');
    });
    await leg('MC3 server mutant (built chunks copied, second owned app): the observation whitelist passing unknown keys flips rakuten:observation-whitelist', async () => {
      if (!mongo || !http) throw new Error('NOT RUN: E5 did not run');
      const copy = path.join(temp, 'mc3'); await mkdir(copy, { recursive: true }); await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
      const anchor = /tag:\s*str\(c\?\.tag,\s*20\),\s*text:\s*str\(c\?\.text,\s*40\),\s*id:\s*str\(c\?\.id,\s*100\)\s*\}\)/g; let hits = 0;
      for (const f of await files(path.join(copy, '.output/server/chunks'))) { const text = await readFile(f, 'utf8'); const n = (text.match(anchor) || []).length; if (n) { hits += n; await writeFile(f, text.replace(anchor, 'tag:str(c?.tag,20),text:str(c?.text,40),id:str(c?.id,100),...c})')); } }
      if (hits !== 1) throw new Error('MC3 anchor hits ' + hits);
      const mutantApp = await bootApp(copy, mongo, 'rakuten_connector_mutant', path.join(temp, 'data-mc3'));
      try { const r = await httpScenario(mutantApp, assert); if (!JSON.stringify(r.stored.clicks).includes('LEAKED')) throw new Error('MC3 did not flip rakuten:observation-whitelist: the mutant still dropped the value'); }
      finally { await mutantApp.close(); }
      return 'MC3→rakuten:observation-whitelist (the mutant app stored the click value; the real app did not)';
    });
    // ── E7: the sibling fixture stays green with the updated record keys (the hub verifier, nested) ──
    await leg('E7 omf-bank-collection.mjs through the hub verifier (updated exact-key assertions clicks/typedInto/eventsDropped)', async () => {
      if (!existsSync(HUB_VERIFY)) throw new Error('NOT RUN: hub verifier absent at ' + HUB_VERIFY);
      const r = await new Promise(resolve => execFile(process.execPath, [HUB_VERIFY, '--run-fixture', 'omf-bank-collection.mjs', '--cwd', root], { cwd: path.dirname(path.dirname(HUB_VERIFY)), windowsHide: true, timeout: 480000, maxBuffer: 32 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
      await writeFile(path.join(root, '.zoomer-rakuten-e7-bank-collection.txt'), r.stdout + '\n' + r.stderr);
      const line = r.stdout.split('\n').reverse().find(l => l.includes('__zoomer_child__')); if (!line) throw new Error('no verdict line (killed ' + r.killed + '): ' + (r.stdout + r.stderr).slice(-800));
      const payload = JSON.parse(line.slice(line.indexOf('{'))); if (payload.result?.status !== 'pass') throw new Error('omf-bank-collection ' + payload.result?.status + ': ' + String(payload.result?.message || '').replace(/\s+/g, ' ').slice(0, 900));
      return 'pass — ' + String(payload.result.message).split('\n')[0];
    });
  } finally {
    if (app) await app.close().catch(() => {}); if (mongo) await mongo.stop().catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };

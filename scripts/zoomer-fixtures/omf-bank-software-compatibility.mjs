// Fixture for plan omf-bank-software-compatibility-20261019 (5-plan-build-resumed.json §4): りそな銀行 and 池田泉州銀行 — the two
// banks whose login runs on the bank's 電子証明書発行アプリ — get their official login entries (starts/loginHosts/hosts), 池田泉州銀行
// becomes a contract-pending provider, the connection panel shows a software note, and the shared launcher is NOT changed.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-bank-software-compatibility.mjs --cwd <this worktree>
// Evidence basis, stated exactly: no authorized real production bank case is supplied (zero historical bank cases tested; live
// population unknown, not asserted zero; historical replay F3 open). Every leg drives the changed code with synthetic/local
// inputs only: the official login links recorded 2026-10-19 (public GET, nothing submitted) pinned below as constants and
// served LOCALLY by request interception on an owned headless Chrome (no bank is reached), the form hosts of the two login
// pages for the pure host-guard leg, the built app on an owned ephemeral MongoDB (the bootstrap shape of
// scripts/finance-integration.cjs:19-41), the sibling fixture nested through the hub verifier, temporary directories. No
// production address, credential, send or customer text. A real certificate picker, an installed protection and a real OTP
// prompt are NOT exercised here — only the owner's own observe run can (plan §7).
// Fail-first on 167504c: S1 RED (no ikeda row, no resona/ikeda variants, no BANK_SOFTWARE), S2 RED (no ikeda adapter; the
// resona stub ignores the variant), S3 RED (hosts), S5 RED (PUT ikeda → 400 「銀行を確認してください」; no [data-bank-software]),
// S6 RED (banks/ikeda not staged); S4 green (control: the launcher is unchanged before and after).
// Deliberate change (plan omf-ikeda-collector-20261025): only the ビジネスゲート (portal) variant retrieves (banks/ikeda.mjs variants.portal);
// the provider default, インターネットEB (direct) and no-variant connections keep this fixture's contract-pending/observe checks.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
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

// ── Test-mode control (fixture-only; review fold F1/F5). Every Chrome this test process launches through a collector
// browser.mjs (the repo module, a mutant sibling importing it, or a staged copy) is forced headless, without a startup
// window, with external host-name resolution refused — whatever its caller asked (profile-reuse fallback, background/quiet
// mode, fault paths). The production module on disk is untouched; the hook lives only in this test process from run() start,
// is proven by the __fixtureHeadless marker before any browser leg (otherwise every browser leg is refused), and is
// deregistered in finally. Owner browsers are never attached: launch keeps pipe transport and the fixture's own profiles.
const FIXTURE_LAUNCH = "\n;{const __fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=o=>__fixtureLaunch({...o,headless:true,args:[...(o?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});}\nexport const __fixtureHeadless=true;\n";
const isLauncher = (url, source) => /\/browser\.mjs$/.test(url) && /export const LAUNCH_ARGS/.test(source);
const fixtureHeadlessControl = () => registerHooks({ load(url, context, next) { const r = next(url, context); return isLauncher(url, String(r.source)) ? { ...r, source: String(r.source) + FIXTURE_LAUNCH } : r; } });
const headlessProven = m => m instanceof Error || m.__fixtureHeadless === true ? m : new Error('test-mode headless control not applied to collector/browser.mjs; every browser leg refused');

// ── The official entries (recorded 2026-10-19, public GET, nothing submitted) — pinned; every one is answered locally below ──
const IKEDA = { start: 'https://www.sihd-bk.jp/corporation/internetbanking/', portal: 'https://www.0161.houjinportal.anser.ne.jp/', direct: 'https://www.bizsol.anser.ne.jp/0161c/rblgi01/I1RBLGI01-S01.do',
  hosts: ['sihd-bk.jp', 'bizsol.anser.ne.jp', '0161.houjinportal.anser.ne.jp'], loginHosts: ['www.0161.houjinportal.anser.ne.jp', 'www.bizsol.anser.ne.jp', 'www.cc0161.bizsol.anser.ne.jp'] };
const RESONA = { start: 'https://www.resonabank.co.jp/hojin/b_direct/', direct: 'https://www.b-direct.resonabank.co.jp/0010c/rblgi01/I1RBLGI01-S01.do', idlink: 'https://wb.resona-gr.co.jp/webservice/WSOI0101E100M.do?BK=0010&lin=b_direct',
  hosts: ['resonabank.co.jp', 'resona-gr.co.jp'], loginHosts: ['www.b-direct.resonabank.co.jp', 'www.cc.b-direct.resonabank.co.jp', 'wb.resona-gr.co.jp'] };
const FORM_HOSTS = { ikeda: 'www.cc0161.bizsol.anser.ne.jp', resona: 'www.cc.b-direct.resonabank.co.jp' }; // the hosts the two 電子証明書ログイン forms post to
const LOCAL_PAGES = new Map([[IKEDA.start, 'Fixture 池田泉州銀行 法人'], [IKEDA.portal, 'Fixture ビジネスゲート'], [IKEDA.direct, 'Fixture インターネットEB'], [RESONA.start, 'Fixture りそな 法人'], [RESONA.direct, 'Fixture ビジネスダイレクト'], [RESONA.idlink, 'Fixture ID連携']]);
const PINNED_LAUNCH_ARGS = ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'];
const ACCOUNT = { _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4' };
const HEADERS = ['取引日', '摘要', '出金', '入金', '残高', 'メモ'], MAPPING = { date: '0', description: '1', outflow: '2', inflow: '3', balance: '4', reference: '5' };
const OBSERVE_MESSAGE = '取得手順が未確認のため観察取得（準備）になります';
// Every pinned URL is answered with a tiny local page (title only; no form, no field); everything else is aborted. No bank is reached.
function intercept(page, stats) {
  return page.setRequestInterception(true).then(() => page.on('request', request => {
    const url = request.url(); stats.requests.push(url); if (request.isNavigationRequest()) stats.navigations.push(url);
    const title = LOCAL_PAGES.get(url); if (title === undefined) return request.abort();
    return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title><body><p>fixture page served locally; no bank reached</p></body></html>` });
  }));
}
// An owned headless Chrome on the ephemeral profile the bank launcher uses; every new page is intercepted.
async function launched(bm, dir, batch) {
  const profile = bm.ephemeralProfile(dir, ACCOUNT.ownerId, 'bank', ACCOUNT._id, batch), browser = await bm.browserFor(profile, { ephemeral: true, root: dir, headless: true });
  const original = browser.newPage.bind(browser), stats = { requests: [], navigations: [] }; let page = null;
  browser.newPage = async () => { page = await original(); await intercept(page, stats); return page; };
  return { browser, profile, stats, page: () => page };
}
// A sibling copy of a module with named edits (each anchor must hit exactly once): the deliberately reintroduced defects MS1/MS2/MS4.
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
  const token = await register('finance-a@example.invalid');
  const card = await call('/api/finance/accounts', { method: 'POST', token, body: { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }); if (card.status !== 200) throw new Error('card account ' + JSON.stringify(card.data).slice(0, 300));
  const device = await call('/api/finance/collectors', { method: 'POST', token, body: { name: 'Test collector', accountIds: [card.data.account._id] } }); if (device.status !== 200) throw new Error('collector ' + JSON.stringify(device.data).slice(0, 300));
  return { origin, call, token, deviceToken: device.data.token, deviceId: device.data.id, logs: () => logs, async close() { if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}
const api = '/api/finance-payments/', capi = api + 'collector/';
const owner = app => { const req = (r, b, m = 'POST') => app.call(api + r, { method: m, token: app.token, body: b }), get = r => app.call(api + r, { token: app.token }); return { req, get, account: async name => (await req('bank/accounts', { name, currency: 'JPY' })).data?.account?.id, template: async () => (await req('bank/templates', { name: 'Synthetic bank map', headers: HEADERS, mapping: MAPPING }, 'PUT')).data?.template }; };

export default { name: 'omf-bank-software-compatibility', covers: ['shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'collector/banks/ikeda.mjs', 'collector/banks/resona.mjs', 'collector/banks/contract.mjs', 'collector/bank.mjs', 'collector/browser.mjs', 'collector/package/stage.mjs', 'components/intake/BankConnections.vue', 'server/services/financeBankCollectionService.ts', 'docs/payment-matching.md', 'scripts/finance-bank-collection-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'scripts/zoomer-fixtures/omf-bank-software-compatibility.mjs'], async run() {
  const started = Date.now(), lines = []; let pass = true;
  const headless = fixtureHeadlessControl(); // test-mode control (see FIXTURE_LAUNCH); deregistered in finally
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1200)); } };
  const assert = (await import('node:assert/strict')).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-software-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  let mongo = null, app = null, executed = false, http = null;
  try {
    const browserModule = headlessProven(await import(u('collector/browser.mjs')).catch(e => e)), bankModule = await import(u('collector/bank.mjs')).catch(e => e), sharedModule = await import(u('shared/finance-payment-match.mjs')).catch(e => e);
    const need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const bm = () => need(browserModule, 'collector/browser.mjs'), bank = () => need(bankModule, 'collector/bank.mjs'), shared = () => need(sharedModule, 'shared/finance-payment-match.mjs');
    const noOwnedChrome = async () => { assert.equal(bm().ownedBrowsers().filter(b => b.connected).length, 0, 'software:browser-closed'); };
    // ── S1: the tables and the declaration ──
    await leg('S1 tables/types: ikeda row, resona/ikeda variants, BANK_SOFTWARE names 電子証明書 + the Windows user for both banks and claims nothing about extensions or installed protection being absent or unnecessary, d.mts declares it', async () => {
      const s = shared();
      assert.deepEqual(s.BANK_PROVIDERS.map(p => p[0]), ['rakuten', 'paypay', 'resona', 'ikeda'], 'software:tables (provider keys)');
      assert.deepEqual(s.BANK_PROVIDERS.find(p => p[0] === 'ikeda'), ['ikeda', '池田泉州銀行', 'contract-pending'], 'software:tables (ikeda row)');
      assert.ok(s.BANK_PROVIDERS.every(p => p[2] === 'contract-pending'), 'software:tables (no provider is verified by this build)');
      assert.deepEqual((s.BANK_LOGIN_VARIANTS.resona || []).map(v => v[0]), ['direct', 'idlink'], 'software:tables (resona variants)'); assert.deepEqual((s.BANK_LOGIN_VARIANTS.ikeda || []).map(v => v[0]), ['portal', 'direct'], 'software:tables (ikeda variants)');
      assert.deepEqual(s.BANK_LOGIN_VARIANTS.rakuten.map(v => v[0]), ['standard', 'plus'], 'software:tables (rakuten variants unchanged)'); assert.deepEqual(s.BANK_LOGIN_VARIANTS.paypay.map(v => v[0]), ['standard', 'baplus'], 'software:tables (paypay standard and BA-PLUS variants)');
      for (const [key, label] of [...s.BANK_LOGIN_VARIANTS.resona, ...s.BANK_LOGIN_VARIANTS.ikeda]) assert.ok(typeof label === 'string' && label.length >= 4, 'software:tables (variant label ' + key + ')');
      assert.ok(s.BANK_LOGIN_VARIANTS.resona.some(([k, l]) => k === 'idlink' && /ID連携/.test(l)) && s.BANK_LOGIN_VARIANTS.ikeda.some(([k, l]) => k === 'portal' && /ビジネスゲート|ポータル/.test(l)), 'software:tables (variant labels name the official entries)');
      assert.deepEqual(Object.keys(s.BANK_SOFTWARE || {}).sort(), ['ikeda', 'resona'], 'software:tables (BANK_SOFTWARE: the two banks only — rakuten/paypay get no note)');
      for (const [key, bank] of [['resona', 'りそな'], ['ikeda', '池田泉州']]) {
        const text = s.BANK_SOFTWARE[key]; assert.ok(typeof text === 'string' && text.length >= 40, 'software:tables (note ' + key + ')');
        assert.match(text, /電子証明書/, 'software:tables (' + key + ' names the certificate)'); assert.match(text, /電子証明書発行アプリ/, 'software:tables (' + key + ' names the issuing app)'); assert.match(text, /Windows/, 'software:tables (' + key + ' names the Windows user)'); assert.match(text, /同じ|同一/, 'software:tables (' + key + ' names the SAME-user rule)'); assert.match(text, new RegExp(bank), 'software:tables (' + key + ' names its bank)'); assert.match(text, /確認/, 'software:tables (' + key + ' asks for a check in the actual environment)');
        assert.doesNotMatch(text, /不要|必要(?:は|が)?(?:あり|ござい)ません|必要なし|インストールされていません|未インストール|入っていません|使っていません/, 'software:tables (' + key + ': no claim that an extension or an installed protection is unnecessary or absent)');
        assert.doesNotMatch(text, /(?:表示されます|動作します|利用できます|使えます|対応しています)[。．]/, 'software:tables (' + key + ': no promise of certificate-picker compatibility under this launch)');
      }
      const dts = await readFile(path.join(root, 'shared/finance-payment-match.d.mts'), 'utf8'); assert.match(dts, /export const BANK_SOFTWARE:\s*Record<string,\s*string>;/, 'software:tables (d.mts declaration)');
      return 'ikeda contract-pending; resona [direct, idlink], ikeda [portal, direct]; BANK_SOFTWARE {resona, ikeda} name 電子証明書発行アプリ + Windows + 確認, no unnecessary/absent claim; d.mts declared';
    });
    // ── S2: the adapters on owned Chrome — the checks take the adapters so the mutants can supply theirs ──
    const adapterChecks = async ({ ikeda, resona, providerLabel }, dir, batch) => {
      assert.ok(ikeda && ikeda.provider === 'ikeda', 'software:variant-start (adapterFor ikeda is the 池田泉州銀行 adapter)');
      assert.equal(ikeda.label, '池田泉州銀行'); assert.equal(ikeda.support, 'contract-pending', 'software:contract-pending-kept (ikeda support)'); assert.equal(ikeda.contract, null, 'software:contract-pending-kept (ikeda contract)'); assert.equal(typeof ikeda.ui, 'function');
      assert.ok(resona && resona.provider === 'resona'); assert.equal(resona.support, 'contract-pending', 'software:contract-pending-kept (resona support)'); assert.equal(resona.contract, null, 'software:contract-pending-kept (resona contract)');
      assert.equal(providerLabel('ikeda'), '池田泉州銀行'); assert.equal(providerLabel('resona'), 'りそな銀行');
      const l = await launched(bm(), dir, batch); const seen = [];
      try {
        const page = await l.browser.newPage(); const opened = async (adapter, snapshot) => { await adapter.ui(page, l.browser, snapshot).open(); seen.push(l.stats.navigations.at(-1)); return l.stats.navigations.at(-1); };
        assert.equal(await opened(ikeda, { variant: 'portal' }), IKEDA.portal, 'software:variant-start ikeda portal'); assert.equal(await opened(ikeda, { variant: 'direct' }), IKEDA.direct, 'software:variant-start ikeda direct');
        assert.equal(await opened(ikeda, null), IKEDA.start, 'software:variant-start ikeda none'); assert.equal(await opened(ikeda, { variant: null }), IKEDA.start, 'software:variant-start ikeda variant null'); assert.equal(await opened(ikeda, { variant: 'x' }), IKEDA.start, 'software:variant-start ikeda unknown variant');
        assert.equal(await opened(resona, { variant: 'direct' }), RESONA.direct, 'software:variant-start resona direct'); assert.equal(await opened(resona, { variant: 'idlink' }), RESONA.idlink, 'software:variant-start resona idlink');
        assert.equal(await opened(resona, null), RESONA.start, 'software:variant-start resona none'); assert.equal(await opened(resona, { variant: 'x' }), RESONA.start, 'software:variant-start resona unknown variant');
        assert.deepEqual(ikeda.starts, { portal: IKEDA.portal, direct: IKEDA.direct }, 'software:variant-start (ikeda official links)'); assert.equal(ikeda.start, IKEDA.start); assert.deepEqual(ikeda.hosts, IKEDA.hosts, 'software:download-hosts (ikeda hosts)'); assert.deepEqual(ikeda.loginHosts, IKEDA.loginHosts, 'software:variant-start (ikeda login hosts incl. the cc0161 form host)');
        assert.deepEqual(resona.starts, { direct: RESONA.direct, idlink: RESONA.idlink }, 'software:variant-start (resona official links)'); assert.equal(resona.start, RESONA.start); assert.deepEqual(resona.hosts, RESONA.hosts, 'software:download-hosts (resona hosts widened)'); assert.deepEqual(resona.loginHosts, RESONA.loginHosts, 'software:variant-start (resona login hosts incl. the cc form host)');
        for (const adapter of [ikeda, resona]) {
          const ui = adapter.ui(page, l.browser, { variant: Object.keys(adapter.starts)[0] }), before = l.stats.requests.length;
          for (const step of ['openStatements', 'selectPeriod', 'snapshot', 'exportCsv', 'login']) await assert.rejects(ui[step](null), e => e?.code === 'contract-pending', 'software:contract-pending-kept ' + adapter.provider + ' ' + step);
          assert.equal(l.stats.requests.length, before, 'software:contract-pending-kept (' + adapter.provider + ': no page touched by a rejected step)'); assert.deepEqual(await ui.state(), { kind: 'unknown' }, 'software:contract-pending-kept (' + adapter.provider + ': state unknown without a contract)');
          assert.equal(typeof (await ui.downloadSession(dir)).close, 'function');
        }
        assert.ok(l.stats.requests.every(url => LOCAL_PAGES.has(url) || /\/favicon\.ico$/.test(url)), 'no request left the pinned set: ' + l.stats.requests.filter(url => !LOCAL_PAGES.has(url)).join(', '));
      } finally { await bm().closeOwnedBrowsers(); }
      await noOwnedChrome(); assert.equal(await exists(l.profile), false, 'software:ephemeral-profile-removed');
      return seen;
    };
    await leg('S2 adapters on owned headless Chrome (pinned links served locally): ikeda shape, open() per variant portal/direct/none/unknown and resona direct/idlink/none/unknown, routine steps reject contract-pending without touching a page, state unknown', async () => {
      const b = bank(), dir = path.join(temp, 's2'); await mkdir(dir, { recursive: true });
      const seen = await adapterChecks({ ikeda: b.adapterFor('ikeda'), resona: b.adapterFor('resona'), providerLabel: b.providerLabel }, dir, 's2');
      return 'opened ' + seen.map(x => new URL(x).host + (new URL(x).search || new URL(x).pathname)).join(', ') + '; 5 routine steps × 2 adapters rejected contract-pending';
    });
    // ── S3: the download-host guard (pure) with the adapters' hosts ──
    const hostChecks = (hostAllowed, ikedaHosts, resonaHosts) => {
      for (const host of ['www.bizsol.anser.ne.jp', FORM_HOSTS.ikeda, 'www.0161.houjinportal.anser.ne.jp', 'www.sihd-bk.jp']) assert.equal(hostAllowed(host, ikedaHosts), true, 'software:download-hosts ikeda allows ' + host);
      for (const host of ['cdn.evil.example', 'anser.ne.jp', 'www.anser.ne.jp', 'www.parasol.anser.ne.jp', 'bizsol.anser.ne.jp.evil.example', 'xbizsol.anser.ne.jp', '', null]) assert.equal(hostAllowed(host, ikedaHosts), false, 'software:download-hosts ikeda refuses ' + host);
      for (const host of ['www.b-direct.resonabank.co.jp', FORM_HOSTS.resona, 'wb.resona-gr.co.jp', 'www.resonabank.co.jp']) assert.equal(hostAllowed(host, resonaHosts), true, 'software:download-hosts resona allows ' + host);
      for (const host of ['cdn.evil.example', 'resona-gr.co.jp.evil.example', 'resonabank.co.jp.evil.example', 'www.resona.example', '', null]) assert.equal(hostAllowed(host, resonaHosts), false, 'software:download-hosts resona refuses ' + host);
    };
    await leg('S3 hostAllowed (pure, the adapters\' hosts): ikeda allows bizsol / cc0161 / houjinportal, refuses evil / anser.ne.jp / parasol; resona allows b-direct / cc.b-direct / wb, refuses evil', async () => {
      const b = bank(); hostChecks(b.hostAllowed, b.adapterFor('ikeda')?.hosts, b.adapterFor('resona')?.hosts);
      return 'ikeda 4 allowed / 8 refused; resona 4 allowed / 6 refused';
    });
    // ── S4: the launcher is unchanged (control: green before and after) ──
    await leg('S4 launcher unchanged (control): LAUNCH_ARGS are the six pinned flags; an owned headless launch carries --disable-extensions and no --load-extension', async () => {
      const b = bm(); assert.deepEqual([...b.LAUNCH_ARGS], PINNED_LAUNCH_ARGS, 'software:launcher-unchanged (LAUNCH_ARGS)');
      const dir = path.join(temp, 's4'); await mkdir(dir, { recursive: true }); const profile = b.ephemeralProfile(dir, ACCOUNT.ownerId, 'bank', ACCOUNT._id, 's4'), browser = await b.browserFor(profile, { ephemeral: true, root: dir, headless: true }); let args;
      try { args = browser.process()?.spawnargs || []; assert.ok(args.includes('--disable-extensions'), 'software:launcher-unchanged (--disable-extensions on the owned launch)'); assert.ok(!args.some(a => /^--(?:load-extension|disable-extensions-except)\b/.test(a)), 'software:launcher-unchanged (no --load-extension)'); for (const flag of PINNED_LAUNCH_ARGS) assert.ok(args.includes(flag), 'software:launcher-unchanged (' + flag + ')'); assert.ok(args.includes('--remote-debugging-pipe') && !args.some(a => /^--(?:no-sandbox|disable-web-security|remote-debugging-port)\b/.test(a)), 'software:launcher-unchanged (pipe transport, no forbidden flag)'); }
      finally { await b.closeOwnedBrowsers(); }
      await noOwnedChrome(); assert.equal(await exists(profile), false, 'software:ephemeral-profile-removed');
      return 'six flags pinned; launch line has --disable-extensions, no --load-extension, pipe transport (' + args.length + ' args)';
    });
    // ── S5a: HTTP on the built app (owned MongoDB) ──
    await leg('S5a HTTP on the built app (owned MongoDB): ikeda connection 200 and listed, resona/ikeda variants stored, unknown or foreign variant → null (no 400), sync stays observe with the variant frozen, the claim carries label 池田泉州銀行 and support contract-pending', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('built app absent; no HTTP coverage');
      const { MongoMemoryServer } = requireRoot('mongodb-memory-server'); const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
      mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined });
      app = await bootApp(root, mongo, 'software_compat_fixture', path.join(temp, 'data')); executed = true;
      const o = owner(app), ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
      const accountK = await o.account('Synthetic Ikeda'), accountR = await o.account('Synthetic Resona'), template = await o.template(); assert.ok(accountK && accountR && template?.id, 'bootstrap accounts/template');
      const connect = (account, body) => o.req('bank/accounts/' + account + '/connection', { templateId: template.id, ...body }, 'PUT');
      const first = await connect(accountK, { provider: 'ikeda', variant: 'portal' }); assert.equal(first.status, 200, 'software:ikeda-accepted ' + JSON.stringify(first.data).slice(0, 300)); assert.equal(first.data.account.connection.provider, 'ikeda', 'software:ikeda-accepted'); assert.equal(first.data.account.connection.variant, 'portal', 'software:variant-stored (ikeda portal)');
      assert.equal(ok(await connect(accountK, { provider: 'ikeda', variant: 'direct' }), 'ikeda direct').account.connection.variant, 'direct', 'software:variant-stored (ikeda direct)');
      assert.equal(ok(await connect(accountK, { provider: 'ikeda', variant: 'bogus' }), 'ikeda bogus').account.connection.variant, null, 'software:variant-tolerant (ikeda unknown → null, no 400)');
      assert.equal(ok(await connect(accountK, { provider: 'ikeda', variant: 'standard' }), 'ikeda foreign variant').account.connection.variant, null, 'software:variant-tolerant (another provider\'s variant → null)');
      assert.equal(ok(await connect(accountR, { provider: 'resona', variant: 'direct' }), 'resona direct').account.connection.variant, 'direct', 'software:variant-stored (resona direct)');
      assert.equal(ok(await connect(accountR, { provider: 'resona', variant: 'idlink' }), 'resona idlink').account.connection.variant, 'idlink', 'software:variant-stored (resona idlink)');
      assert.equal(ok(await connect(accountR, { provider: 'resona', variant: 'portal' }), 'resona foreign variant').account.connection.variant, null, 'software:variant-tolerant (resona unknown → null)');
      assert.equal(ok(await connect(accountK, { provider: 'ikeda', variant: 'portal' }), 'ikeda portal again').account.connection.variant, 'portal'); assert.equal(ok(await connect(accountR, { provider: 'resona', variant: 'idlink' }), 'resona idlink again').account.connection.variant, 'idlink');
      const listed = ok(await o.get('bank/accounts'), 'accounts').accounts; assert.equal(listed.find(a => a.id === accountK).connection.provider, 'ikeda', 'software:ikeda-accepted (listed)'); assert.equal(listed.find(a => a.id === accountR).connection.variant, 'idlink', 'software:variant-stored (listed)');
      ok(await o.req('bank/collectors/' + app.deviceId, { bankAccountIds: [accountK] }, 'PUT'), 'device scope');
      // Deliberate change (plan omf-ikeda-collector-20261025): ビジネスゲート (portal) now retrieves — saved without its period and account identity
      // it is refused with the reason (400), never queued as an observe job; インターネットEB (direct) keeps the honest observe stage.
      const portalSync = await o.req('bank/accounts/' + accountK + '/sync', {}); assert.equal(portalSync.status, 400, 'software:portal-retrieves (refused without identity/period, no observe job) ' + JSON.stringify(portalSync.data).slice(0, 200));
      ok(await connect(accountK, { provider: 'ikeda', variant: 'direct' }), 'ikeda direct (observe)');
      const sync = ok(await o.req('bank/accounts/' + accountK + '/sync', {}), 'sync'); assert.equal(sync.job.kind, 'observe', 'software:observe-kept (contract-pending direct → observe)'); assert.equal(sync.message, OBSERVE_MESSAGE, 'software:observe-kept (message)'); assert.equal(sync.job.snapshot.provider, 'ikeda'); assert.equal(sync.job.snapshot.variant, 'direct', 'software:variant-frozen'); assert.equal(sync.job.snapshotHash, sha256(JSON.stringify(sync.job.snapshot)), 'software:variant-frozen (hash over the snapshot)');
      const claimed = ok(await app.call(capi + 'bank/claim', { method: 'POST', token: app.deviceToken, body: {} }), 'claim'); assert.equal(claimed.job?.jobId, sync.job.jobId, 'claim returns the queued job'); assert.equal(claimed.job.provider, 'ikeda'); assert.equal(claimed.job.label, '池田泉州銀行', 'software:claim-label'); assert.equal(claimed.job.support, 'contract-pending', 'software:observe-kept (claim support)'); assert.equal(claimed.job.snapshot.variant, 'direct', 'software:variant-frozen (claimed)');
      ok(await app.call(capi + 'bank/status', { method: 'POST', token: app.deviceToken, body: { jobId: sync.job.jobId, state: 'complete', message: '観察記録を保存' } }), 'status complete');
      ok(await connect(accountK, { provider: 'ikeda', variant: 'portal' }), 'ikeda portal (seed for S5b)');
      http = { accountK, accountR, template, job: sync.job };
      return `ikeda accepted (variant portal/direct stored, bogus/standard → null), resona direct/idlink stored (portal → null); portal sync refused without identity/period (retrieval, not observe); observe job frozen with variant direct (hash ${sync.job.snapshotHash.slice(0, 8)}); claim label 池田泉州銀行`;
    });
    // ── S5b: real Chrome on the built app ──
    await leg('S5b real Chrome 390/1440 px on the built app: ikeda option, ログイン方式 select for both banks (seeded from the saved connection), [data-bank-software] note equal to BANK_SOFTWARE and hidden for rakuten/paypay, a connection saved through the panel, no overflow, no console errors', async () => {
      if (!app) throw new Error('NOT RUN: S5a did not boot the app');
      const s = shared(), o = owner(app); const accountF = await o.account('Synthetic fresh'); const template = http?.template || await o.template(); assert.ok(accountF && template?.id, 'bootstrap fresh account/template');
      const profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-software-browser-')), browser = await bm().browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
      try {
        page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 }); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
        const wait = async (f, arg) => { for (let i = 0; i < 250; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw Error('software:chrome condition ' + f.toString().slice(0, 160)); };
        await page.goto(app.origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', 'finance-a@example.invalid'); await page.type('#password', 'Synthetic-password-Only1!'); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/');
        await page.goto(app.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]')); await page.click('[data-bank-connections-open]'); await wait(() => !!document.querySelector('[data-bank-connections]')); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-provider]'), accountF);
        const card = id => '[data-bank-connection="' + id + '"] ', overflowing = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => e.tagName + '.' + String(e.className).slice(0, 50) + '@' + Math.round(e.getBoundingClientRect().right)));
        const note = id => page.$eval(card(id) + '[data-bank-software]', e => e.textContent.trim()).catch(() => null), variantValues = id => page.$$eval(card(id) + '[data-bank-variant] option', es => es.map(e => e.value).filter(Boolean)).catch(() => null);
        // the fresh account: the note and the variant select appear with the provider and disappear for a bank without a note
        assert.equal(await note(accountF), null, 'software:chrome-note-hidden (no provider yet)'); assert.equal(await page.$(card(accountF) + '[data-bank-variant]'), null, 'no variant select without a provider');
        await page.select(card(accountF) + '[data-bank-provider]', 'resona'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-variant]'), accountF);
        assert.equal(await note(accountF), s.BANK_SOFTWARE.resona, 'software:chrome-software-note (resona note equals BANK_SOFTWARE.resona)'); assert.deepEqual(await variantValues(accountF), ['direct', 'idlink'], 'software:chrome-variant-select (resona options)');
        assert.ok(await page.$(card(accountF) + '[data-bank-provider] option[value="ikeda"]'), 'software:chrome-ikeda-option'); assert.match(await page.$eval(card(accountF) + '[data-bank-provider] option[value="ikeda"]', e => e.textContent), /池田泉州銀行.*取得手順 未確認/, 'software:chrome-ikeda-option (label + support)');
        await page.select(card(accountF) + '[data-bank-provider]', 'ikeda'); await wait(id => /池田泉州/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-software]')?.textContent || ''), accountF);
        assert.equal(await note(accountF), s.BANK_SOFTWARE.ikeda, 'software:chrome-software-note (ikeda note equals BANK_SOFTWARE.ikeda)'); assert.match(await note(accountF), /電子証明書/, 'software:chrome-software-note (電子証明書)'); assert.deepEqual(await variantValues(accountF), ['portal', 'direct'], 'software:chrome-variant-select (ikeda options)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'software:chrome-no-overflow ' + JSON.stringify(await overflowing()));
        await page.select(card(accountF) + '[data-bank-provider]', 'rakuten'); await wait(id => !document.querySelector('[data-bank-connection="' + id + '"] [data-bank-software]'), accountF); assert.equal(await note(accountF), null, 'software:chrome-note-hidden (rakuten)'); assert.deepEqual(await variantValues(accountF), ['standard', 'plus'], 'rakuten variant select unchanged');
        await page.select(card(accountF) + '[data-bank-provider]', 'paypay'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-variant]'), accountF); assert.equal(await note(accountF), null, 'software:chrome-note-hidden (paypay)'); assert.deepEqual(await variantValues(accountF), ['standard', 'baplus'], 'software:chrome-variant-select (paypay standard and BA-PLUS)');
        // a connection saved through the panel: ikeda + direct
        await page.select(card(accountF) + '[data-bank-provider]', 'ikeda'); await wait(id => !!document.querySelector('[data-bank-connection="' + id + '"] [data-bank-variant]'), accountF); await page.select(card(accountF) + '[data-bank-connection-template]', template.id); await page.select(card(accountF) + '[data-bank-variant]', 'direct'); await page.click(card(accountF) + '[data-bank-connect-save]');
        await wait(id => /池田泉州銀行/.test(document.querySelector('[data-bank-connection="' + id + '"] [data-bank-connection-state]')?.textContent || ''), accountF);
        const state = await page.$eval(card(accountF) + '[data-bank-connection-state]', e => e.textContent); assert.match(state, /取得手順 未確認/, 'software:chrome-support-label'); assert.match(state, new RegExp(s.BANK_LOGIN_VARIANTS.ikeda.find(([k]) => k === 'direct')[1]), 'software:chrome-variant-shown');
        assert.equal((await o.get('bank/accounts')).data.accounts.find(a => a.id === accountF).connection.variant, 'direct', 'software:chrome-variant-saved'); assert.equal(await page.$eval(card(accountF) + '[data-bank-sync]', e => e.textContent.trim()), '観察取得（準備）', 'software:chrome-observe-button');
        // the HTTP-connected accounts render seeded from their saved connections
        if (http) {
          assert.equal(await page.$eval(card(http.accountK) + '[data-bank-provider]', e => e.value), 'ikeda', 'software:chrome-ikeda-option (seeded)'); assert.equal(await page.$eval(card(http.accountK) + '[data-bank-variant]', e => e.value), 'portal', 'software:chrome-variant-select (seeded portal)'); assert.equal(await note(http.accountK), s.BANK_SOFTWARE.ikeda, 'software:chrome-software-note (seeded ikeda)');
          assert.equal(await page.$eval(card(http.accountR) + '[data-bank-variant]', e => e.value), 'idlink', 'software:chrome-variant-select (seeded idlink)'); assert.equal(await note(http.accountR), s.BANK_SOFTWARE.resona, 'software:chrome-software-note (seeded resona)');
          const jobLine = card(http.accountK) + '[data-bank-job="' + http.job.jobId + '"]'; await wait(sel => !!document.querySelector(sel), jobLine); assert.match(await page.$eval(jobLine, e => e.textContent), /観察取得 · 完了/, 'software:chrome-job-listed');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'software:chrome-no-overflow (connected) ' + JSON.stringify(await overflowing()));
        if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) { await mkdir(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'bank-software-mobile.png'), fullPage: true }); }
        await page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'software:chrome-desktop-no-overflow');
        await page.evaluate(() => document.documentElement.classList.add('dark')); assert.equal(await page.$eval(card(accountF) + '[data-bank-variant]', e => getComputedStyle(e).backgroundColor), 'rgb(30, 41, 59)', 'software:chrome-dark-control');
        if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'bank-software-desktop-dark.png'), fullPage: true });
        assert.deepEqual(errors, [], 'software:chrome-no-console-errors');
      } finally { if (page) await page.close().catch(() => {}); await browser.close(); if (!path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe owned Chrome cleanup'); await rm(profileDir, { recursive: true, force: true }); }
      return 'ikeda option; resona/ikeda notes equal BANK_SOFTWARE and variant selects [direct, idlink] / [portal, direct]; hidden for rakuten/paypay; ikeda+direct saved through the panel; seeded accounts render; 390/1440 px without overflow; dark control; no console errors';
    });
    if (app) { await app.close().catch(() => {}); app = null; } if (mongo) { await mongo.stop().catch(() => {}); mongo = null; }
    // ── S6: the package carries and hashes banks/ikeda; the staged graph resolves and loads; MS3 ──
    await leg('S6 package: banks/ikeda staged and hashed, the staged graph resolves (index → bank → banks/ikeda → banks/contract), staged ikeda/resona/bank/shared load without a live bank; MS3 (allowlist without banks/ikeda) fails the staged-import walk', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const closure = async (mod, dir) => { const { manifest } = await mod.stage({ into: dir, origin: 'https://omf.example', install: false, log: () => {} }); await walkRelativeImports(path.join(dir, 'collector', 'index.mjs')); if (!manifest.files['collector/banks/ikeda.mjs']) throw new Error('software:package-ikeda-staged missing collector/banks/ikeda.mjs'); if (manifest.files['collector/banks/ikeda.mjs'] !== sha256(await readFile(path.join(root, 'collector/banks/ikeda.mjs')))) throw new Error('software:package-ikeda-staged hash differs'); return manifest; };
      const manifest = await closure(stageModule, into);
      const stagedIkeda = await import(pathToFileURL(path.join(into, 'collector/banks/ikeda.mjs')).href); assert.equal(stagedIkeda.default.support, 'contract-pending'); assert.equal(stagedIkeda.default.contract, null); assert.deepEqual(Object.keys(stagedIkeda.default.starts), ['portal', 'direct']); await assert.rejects(stagedIkeda.default.ui({}, {}, null).openStatements(), e => e?.code === 'contract-pending', 'staged ikeda routine step rejects contract-pending');
      const stagedResona = await import(pathToFileURL(path.join(into, 'collector/banks/resona.mjs')).href); assert.deepEqual(Object.keys(stagedResona.default.starts), ['direct', 'idlink']); assert.deepEqual(stagedResona.default.hosts, RESONA.hosts); await assert.rejects(stagedResona.default.ui({}, {}, null).openStatements(), e => e?.code === 'contract-pending', 'staged resona routine step rejects contract-pending');
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector/bank.mjs')).href); assert.equal(stagedBank.adapterFor('ikeda')?.label, '池田泉州銀行', 'software:package-ikeda-staged (staged bank.mjs resolves ikeda)'); assert.equal(stagedBank.adapterFor('ikeda').starts.portal, IKEDA.portal); assert.equal(stagedBank.adapterFor('resona').starts.idlink, RESONA.idlink);
      const stagedShared = await import(pathToFileURL(path.join(into, 'shared/finance-payment-match.mjs')).href); assert.deepEqual(stagedShared.BANK_PROVIDERS.map(p => p[0]), ['rakuten', 'paypay', 'resona', 'ikeda'], 'software:package-ikeda-staged (shared provider keys)'); assert.deepEqual(Object.keys(stagedShared.BANK_SOFTWARE).sort(), ['ikeda', 'resona']);
      const source = path.join(root, 'collector/package/stage.mjs'), text = await readFile(source, 'utf8'), hits = (text.match(/,\s*'banks\/ikeda'/g) || []).length; if (hits !== 1) throw new Error('stage.mjs allowlist anchor hits ' + hits);
      const mutant = path.join(path.dirname(source), `stage.mutant-software-${process.pid}.mjs`); await writeFile(mutant, text.replace(/,\s*'banks\/ikeda'/, ''), { flag: 'wx' });
      try { const mod = await import(pathToFileURL(mutant).href); let failure = null; try { await closure(mod, path.join(temp, 'staged-mutant')); } catch (e) { failure = e; } if (!failure || !/imports \.\/banks\/ikeda\.mjs which is not staged/.test(failure.message)) throw new Error('MS3 did not fail the staged-import walk: ' + (failure?.message || 'passed')); } finally { await unlink(mutant).catch(() => {}); }
      return Object.keys(manifest.files).length + ' files staged; banks/ikeda.mjs hashed; graph resolves; staged ikeda/resona/bank/shared load; MS3 caught by the staged-import walk';
    });
    // ── Deliberately reintroduced defects MS1 / MS2 / MS4 ──
    await leg('MS1/MS2/MS4 mutants: ADAPTERS without ikeda → S2 flips; resona hosts reverted → S3 flips; ikeda starts removed → S2 variant-start flips', async () => {
      const b = bank(), caught = [], dir = path.join(temp, 'mutants'); await mkdir(dir, { recursive: true });
      const flips = async (label, fn, pattern) => { let error = null; try { await fn(); } catch (e) { error = e; } if (!error) throw new Error(label + ' did not flip (the assertion passed on the mutant)'); if (!pattern.test(String(error.message))) throw new Error(label + ' flipped the wrong assertion: ' + String(error.message).slice(0, 300)); caught.push(label + '→' + String(error.message).match(pattern)[0]); };
      { const m = await mutantModule('collector/bank.mjs', [[/export const ADAPTERS = Object\.freeze\(\{ rakuten, paypay, resona, ikeda \}\);/, 'export const ADAPTERS = Object.freeze({ rakuten, paypay, resona });']]); try { const mod = await m.load(); await flips('MS1', () => adapterChecks({ ikeda: mod.adapterFor('ikeda'), resona: mod.adapterFor('resona'), providerLabel: mod.providerLabel }, dir, 'ms1'), /software:variant-start/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/banks/resona.mjs', [[/hosts: \['resonabank\.co\.jp', 'resona-gr\.co\.jp'\]/, "hosts: ['resonabank.co.jp']"]]); try { const mod = await m.load(); await flips('MS2', () => hostChecks(b.hostAllowed, b.adapterFor('ikeda').hosts, mod.default.hosts), /software:download-hosts/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/banks/ikeda.mjs', [[/\n\s*starts: \{ portal: '[^']+', direct: '[^']+' \},/, '']]); try { const mod = await m.load(); await flips('MS4', () => adapterChecks({ ikeda: mod.default, resona: b.adapterFor('resona'), providerLabel: b.providerLabel }, dir, 'ms4'), /software:variant-start/); } finally { await m.dispose(); } }
      await noOwnedChrome();
      return caught.join(', ');
    });
    // ── S5c: the sibling fixture (its extended HTTP harness and real-Chrome leg) through the hub verifier, nested ──
    await leg('S5c omf-bank-collection.mjs through the hub verifier (extended harness: ikeda + variants + unknown → null, ikeda option / variant select / [data-bank-software] in real Chrome, package keys)', async () => {
      if (!existsSync(HUB_VERIFY)) throw new Error('NOT RUN: hub verifier absent at ' + HUB_VERIFY);
      const r = await new Promise(resolve => execFile(process.execPath, [HUB_VERIFY, '--run-fixture', 'omf-bank-collection.mjs', '--cwd', root], { cwd: path.dirname(path.dirname(HUB_VERIFY)), windowsHide: true, timeout: 480000, maxBuffer: 32 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
      await writeFile(path.join(root, '.zoomer-software-s5c-bank-collection.txt'), r.stdout + '\n' + r.stderr);
      const line = r.stdout.split('\n').reverse().find(l => l.includes('__zoomer_child__')); if (!line) throw new Error('no verdict line (killed ' + r.killed + '): ' + (r.stdout + r.stderr).slice(-800));
      const payload = JSON.parse(line.slice(line.indexOf('{'))); if (payload.result?.status !== 'pass') throw new Error('omf-bank-collection ' + payload.result?.status + ': ' + String(payload.result?.message || '').replace(/\s+/g, ' ').slice(0, 900));
      const message = String(payload.result.message); if (!/targeted bank collection checks passed/.test(message)) throw new Error('nested HTTP harness summary missing: ' + message.slice(0, 300));
      return 'pass — ' + message.split('\n')[0] + '; ' + (message.match(/\d+ targeted bank collection checks passed/)?.[0] || '');
    });
  } finally {
    headless.deregister();
    if (app) await app.close().catch(() => {}); if (mongo) await mongo.stop().catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };

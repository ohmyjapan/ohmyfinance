// Fixture for plan omf-rakuten-native-shiwake-20261020: the 楽天銀行 standard corporate (START_CORP) retrieval through the
// collector's per-variant adapter, the native connection setup (native template, requested period), and the native bank
// classification (仕訳) review with explicit native Transaction registration. Run ONLY through the hub verifier (never
// directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-rakuten-native-shiwake.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. A fake portal is served by request interception at
// https://fes.rakuten-bank.co.jp inside owned headless Chrome (START_CORP login → overview → statement page with the
// FORM_DOWNLOAD_AP_2 six date fields and two CSV sections → POST download); no network, no bank is reached, no credential is
// read. The built app runs on the harness's owned ephemeral MongoDB with synthetic owners/companies/rows. Nothing here is a
// live login, an actual collector run or an actual 仕訳 in the owner's OMF; those remain the parent's live acceptance.
// Fail-first on a37a11e (named behaviour, not a missing file): F1 native:standard-adapter (adapterFor ignores the frozen
// variant), F2 native:standard-setup (a standard connection without an uploaded template is refused / observe queued), F3
// native:classification-route (404), F4 native:classification-tab (no 銀行仕訳 tab, no account creation in the panel).
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3000000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const u = rel => pathToFileURL(path.join(root, rel)).href;
const GUID = /^[a-f\d-]{36}$/;
const COVERS = ['collector/banks/rakuten.mjs', 'collector/bank.mjs', 'shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'server/services/financeBankCollectionService.ts', 'server/api/finance-payments/[...path].ts', 'components/intake/BankConnections.vue', 'pages/intake/payments.vue', 'scripts/zoomer-fixtures/omf-rakuten-bank-connector.mjs', 'scripts/finance-bank-collection-integration.cjs', 'scripts/finance-payment-match.test.mjs', 'docs/payment-matching.md', 'shared/finance-bank-classification.mjs', 'shared/finance-bank-classification.d.mts', 'server/models/FinanceBankClassification.ts', 'server/services/financeBankClassificationService.ts', 'components/intake/BankClassificationReview.vue', 'collector/test/rakuten-standard.test.mjs', 'scripts/finance-bank-classification.test.mjs', 'scripts/finance-bank-classification-integration.cjs', 'scripts/zoomer-fixtures/omf-rakuten-native-shiwake.mjs'];

// ── Shift_JIS for the synthetic native statement (the table of scripts/finance-bank-collection-integration.cjs) ──
const sjisOf = new Map(), sjisDecoder = new TextDecoder('shift_jis');
for (let b = 0; b < 0x80; b++) sjisOf.set(String.fromCharCode(b), [b]);
for (let b = 0xa1; b <= 0xdf; b++) sjisOf.set(sjisDecoder.decode(Uint8Array.of(b)), [b]);
for (let lead = 0x81; lead <= 0xfc; lead++) { if (lead > 0x9f && lead < 0xe0) continue; for (let trail = 0x40; trail <= 0xfc; trail++) { if (trail === 0x7f) continue; const c = sjisDecoder.decode(Uint8Array.of(lead, trail)); if (c.length === 1 && c !== '�' && !sjisOf.has(c)) sjisOf.set(c, [lead, trail]); } }
const sjis = s => Buffer.from([...s].flatMap(c => { const b = sjisOf.get(c); if (!b) throw Error('fixture text not in Shift_JIS: ' + c); return b; }));

// ── The fake portal: START_CORP login → overview → statement page (six date fields, two CSV sections) → POST download ──
const HOST = 'fes.rakuten-bank.co.jp', ORIGIN = 'https://' + HOST, CORP = '/XMS/security/RbS', START_CORP = ORIGIN + CORP + '?COMMAND=LOGIN&CurrentPageID=START_CORP';
const OVERVIEW = '/XMS/inquiry/gns', STATEMENT = '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/BalanceInquiry/BalanceInquiry/BalanceInquiry.xhtml', DOWNLOAD = '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/CreditDebitInquiry/CreditDebitInquiry/CreditDebitInquiry.xhtml';
const NOTICE = '/XMS/inquiry/notice.xhtml', FOREIGN_DOWNLOAD = 'https://cdn.evil.example/meisai.csv', ACCOUNT_LABEL = '普通 1234567 カクウホールディングス';
const WARNING = '明細の件数が多いため、CSVファイルの作成は1日1度しかダウンロードできません。作成済みのファイルは23:55まで再ダウンロードできます。よろしいですか？';
const UNKNOWN_DIALOG = 'お取引の確認：この操作を続けますか？';
const F = 'FORM_DOWNLOAD_AP_2', IDS = ['EXPECTED_DATE_FROM_YEAR', 'EXPECTED_DATE_FROM_MONTH', 'EXPECTED_DATE_FROM_DAY', 'EXPECTED_DATE_TO_YEAR', 'EXPECTED_DATE_TO_MONTH', 'EXPECTED_DATE_TO_DAY'].map(x => F + ':' + x);
const NATIVE_BUTTON = F + ':j_id_6n6', ZENGIN_BUTTON = F + ':j_id_6n9';
const ROWS = [['20251020', -500, '振込 カクウ（期間外）'], ['20251110', -330, '振込手数料'], ['20251110', -330, '振込手数料'], ['20251201', 250000, 'ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'], ['20260105', -110000, '振込 カ）カクウリース'], ['20260331', 12, '決算お利息'], ['20260715', -9900, '口座振替 カクウサブスク'], ['20261001', -50000, '振込 サトウ ハナコ']];
function nativeCsv(from, to) { let balance = 2000000; const lines = ['取引日,入出金(円),残高(円),入出金先内容']; for (const [d, a, t] of ROWS) { balance += a; const iso = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6); if (iso >= from && iso <= to) lines.push([d, a, balance, t].join(',')); } return sjis(lines.join('\r\n') + '\r\n'); }
const zenginCsv = () => sjis('1,10,0,カクウホールディングス,1026,ﾗｸﾃﾝ\r\n2,20251110,20251110,1,330,0\r\n8,1,330\r\n9\r\n');
const STYLE = '<style>a,button,input,select{display:inline-block;margin:6px;padding:6px}section{margin:12px 0}</style>';
const html = body => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
const loginDoc = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人ビジネス口座 ログイン</title>${STYLE}<body><h1>ログイン</h1><input id="LOGIN:USER_ID" type="text"><input id="LOGIN:LOGIN_PASSWORD" type="password"><button id="login">ログイン</button><a id="decoy" href="#">登録情報の照会・変更</a><script>window.__clicks=0;document.addEventListener('click',()=>{window.__clicks++;},true);window.__signIn=()=>{location.href='${OVERVIEW}'};document.getElementById('login').addEventListener('click',()=>window.__signIn());</script></body></html>`;
const overviewDoc = s => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人ビジネス口座</title>${STYLE}<body><a id="logout" href="#">ログアウト</a><a id="profile" href="#">登録情報の照会・変更</a><div style="display:none"><a id="hidden-statements" href="#hidden">入出金明細</a></div><a id="statements" href="${STATEMENT}">入出金明細</a>${s.overviewDialog ? `<script>setTimeout(()=>{window.__overviewDialog=confirm(${JSON.stringify(WARNING)});},50)</script>` : ''}</body></html>`;
function statementDoc(s) {
  const select = (id, from, to, value) => `<select id="${id}" name="${id}">${Array.from({ length: to - from + 1 }, (_, i) => from + i).map(n => `<option value="${n}"${n === value ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const text = (id, value, max) => `<input id="${id}" name="${id}" type="text" maxlength="${max}" value="${value}">`;
  const onclick = s.frameDialog ? ` onclick="document.getElementById('notice').contentWindow.postMessage('ask','*');return false;"` : s.dialog === 'known' ? ` onclick="return confirm(${JSON.stringify(WARNING).replaceAll('"', '&quot;')})"` : s.dialog === 'unknown' ? ` onclick="return confirm(${JSON.stringify(UNKNOWN_DIALOG).replaceAll('"', '&quot;')})"` : '';
  const native = `<section>${s.order === 'unlabelled' ? '' : '<h3>楽天銀行フォーマット</h3>'}<input type="submit" id="${NATIVE_BUTTON}" name="${NATIVE_BUTTON}" value="CSVダウンロード"${onclick}></section>`;
  const zengin = `<section>${s.order === 'unlabelled' ? '' : '<h3>全銀フォーマット</h3>'}<input type="submit" id="${ZENGIN_BUTTON}" name="${ZENGIN_BUTTON}" value="CSVダウンロード"></section>`;
  const [fy, fm, fd] = s.defaultPeriod.from.split('-').map(Number), [ty, tm, td] = s.defaultPeriod.to.split('-').map(Number);
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>入出金明細</title>${STYLE}<body><a id="logout" href="#">ログアウト</a><a href="#">登録情報の照会・変更</a><div id="account">${ACCOUNT_LABEL}</div>
  <form id="${F}" name="${F}" method="post" action="${s.foreignDownload ? FOREIGN_DOWNLOAD : DOWNLOAD}"><p>照会期間</p>
  ${select(IDS[0], 2016, 2026, fy)}年${select(IDS[1], 1, 12, fm)}月${select(IDS[2], 1, 31, fd)}日 〜 ${text(IDS[3], ty, 4)}年${text(IDS[4], String(tm).padStart(2, '0'), 2)}月${text(IDS[5], String(td).padStart(2, '0'), 2)}日
  ${s.order === 'zengin-first' ? zengin + native : native + zengin}<input type="hidden" name="${F}_SUBMIT" value="1"></form>${s.frameDialog ? `<iframe id="notice" src="${NOTICE}" title="notice"></iframe><script>addEventListener('message',e=>{if(e.data==='yes')document.getElementById('${F}').requestSubmit(document.getElementById('${NATIVE_BUTTON}'));});</script>` : ''}
  <script>window.__changes=0;window.__inputs=0;const defaults=${JSON.stringify(Object.fromEntries(IDS.map((id, i) => [id, [fy, fm, fd, ty, String(tm).padStart(2, '0'), String(td).padStart(2, '0')][i]])))};
  for(const id of ${JSON.stringify(IDS)}){const e=document.getElementById(id);e.addEventListener('input',()=>{window.__inputs++;});e.addEventListener('change',()=>{window.__changes++;${s.sticky ? 'setTimeout(()=>{e.value=String(defaults[id]);},0);' : ''}});}
  </script></body></html>`;
}
function intercept(page, stats, scenario) {
  return page.setRequestInterception(true).then(() => page.on('request', request => {
    const url = request.url(); stats.requests.push(url); if (request.isNavigationRequest()) stats.navigations.push(url);
    let parsed; try { parsed = new URL(url); } catch { return request.abort(); }
    if (parsed.origin === ORIGIN && parsed.pathname === CORP) return request.respond(html(loginDoc()));
    if (parsed.origin === ORIGIN && parsed.pathname === OVERVIEW) return request.respond(html(overviewDoc(scenario)));
    if (parsed.origin === ORIGIN && parsed.pathname === STATEMENT) return request.respond(html(statementDoc(scenario)));
    if (parsed.origin === ORIGIN && parsed.pathname === NOTICE) return request.respond(html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>お知らせ</title><body><p>お知らせ</p><script>addEventListener('message',()=>{const ok=confirm(${JSON.stringify(WARNING)});parent.postMessage(ok?'yes':'no','*');});</script></body></html>`));
    if ((parsed.origin === ORIGIN && parsed.pathname === DOWNLOAD || url === FOREIGN_DOWNLOAD) && request.method() === 'POST') {
      const body = new URLSearchParams(request.postData() || ''), n = id => Number(body.get(id)), iso = (y, m, d) => [String(y), String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
      const format = body.has(NATIVE_BUTTON) ? 'native' : body.has(ZENGIN_BUTTON) ? 'zengin' : 'none', from = iso(n(IDS[0]), n(IDS[1]), n(IDS[2])), to = iso(n(IDS[3]), n(IDS[4]), n(IDS[5]));
      stats.downloads.push({ format, from, to, host: parsed.hostname });
      return request.respond({ status: 200, contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="RB-torihikimeisai.csv"' }, body: format === 'zengin' ? zenginCsv() : nativeCsv(from, to) });
    }
    return request.abort();
  }));
}
// An owned headless Chrome on the ephemeral profile the bank launcher will reuse (browserFor returns the browser already
// launched on that profile); every new page is intercepted and watched by the fixture's own "person" dialog session.
async function launched(browserModule, dir, ownerId, bankAccountId, batch, scenario) {
  const profile = browserModule.ephemeralProfile(dir, ownerId, 'bank', bankAccountId, batch);
  const browser = await browserModule.browserFor(profile, { ephemeral: true, root: dir, headless: true });
  const original = browser.newPage.bind(browser), stats = { requests: [], navigations: [], downloads: [], dialogs: [] }; let page = null, person = null;
  browser.newPage = async () => {
    page = await original(); await intercept(page, stats, scenario);
    person = await page.createCDPSession(); await person.send('Page.enable');
    person.on('Page.javascriptDialogOpening', e => stats.dialogs.push({ type: e.type, message: e.message, url: e.url, open: true, by: null, result: null }));
    person.on('Page.javascriptDialogClosed', e => { const d = stats.dialogs.findLast(x => x.open); if (d) { d.open = false; d.result = e.result; d.by ??= 'collector'; } });
    return page;
  };
  const handle = async accept => { const d = stats.dialogs.findLast(x => x.open); if (!d) return false; d.by = 'person'; await person.send('Page.handleJavaScriptDialog', { accept }); return true; };
  return { browser, profile, stats, page: () => page, handle };
}
const OWNER = 'd4d4d4d4d4d4d4d4d4d4d4d4', BANK_ACCOUNT = 'c3c3c3c3c3c3c3c3c3c3c3c3', OMF_ORIGIN = 'https://omf.example';
const NATIVE_HEADERS = ['取引日', '入出金(円)', '残高(円)', '入出金先内容'], NATIVE_MAP = { date: '0', description: '3', amount: '1', outflow: '', inflow: '', balance: '2', reference: '', transactionId: '', currency: '', direction: '' };
const snapshotOf = coverage => ({ templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', templateRevision: 1, headers: NATIVE_HEADERS, mapping: NATIVE_MAP, amountSign: 'outflow-negative', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'rakuten', accountLabel: 'カクウホールディングス', variant: 'standard', coverage });
const jobOf = (coverage = { from: '2025-11-01', to: '2026-10-01' }, variant = 'standard') => { const snapshot = { ...snapshotOf(coverage), variant }; return { jobId: randomUUID(), kind: 'retrieve', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), provider: 'rakuten' }; };
const boundOf = job => ({ bankAccountId: BANK_ACCOUNT, ownerId: OWNER, origin: OMF_ORIGIN, jobId: job.jobId, snapshotHash: job.snapshotHash, provider: 'rakuten' });
// A sibling copy of a module with named edits (each anchor must hit exactly once): the deliberately reintroduced defects.
async function mutantModule(file, edits) {
  const source = path.join(root, file); let text = await readFile(source, 'utf8');
  for (const [anchor, replacement] of edits) { const hits = (text.match(new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g')) || []).length; if (hits !== 1) throw new Error('mutant anchor hits ' + hits + ' for ' + file + ' /' + anchor.source.slice(0, 80)); text = text.replace(anchor, replacement); }
  const target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { async load() { try { return await import(pathToFileURL(target).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + (error?.message || error)); } }, async dispose() { await unlink(target).catch(() => {}); } };
}
async function walkRelativeImports(file, seen = new Set()) {
  const text = await readFile(file, 'utf8'), dir = path.dirname(file);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)'(\.[^']+)'/g)) { const target = path.resolve(dir, m[1]); if (!await exists(target)) throw new Error(path.relative(root, file).replaceAll('\\', '/') + ' imports ' + m[1] + ' which is not staged'); if (!seen.has(target)) { seen.add(target); await walkRelativeImports(target, seen); } }
  return seen;
}
async function files(dir, ext = '.mjs') { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...await files(f, ext)); else if (e.name.endsWith(ext)) out.push(f); } return out; }

// ── The built app on an owned ephemeral MongoDB (the bootstrap of scripts/finance-integration.cjs:19-41) ──
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(outputRoot, mongo, dbName, directory) {
  const uri = mongo.getUri(dbName), port = await availablePort(), origin = `http://127.0.0.1:${port}`; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: outputRoot, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-15000); });
  let healthy = false;
  for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); throw new Error('owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body, type = 'application/json' } = {}) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const register = async email => { const r = await call('/api/auth/register', { method: 'POST', body: { email, password: 'Synthetic-password-Only1!', name: 'Finance test' } }); if (r.status !== 200) throw new Error('register ' + JSON.stringify(r.data).slice(0, 300)); return r.data.tokens.accessToken; };
  const token = await register('finance-a@example.invalid'), other = await register('finance-b@example.invalid');
  const card = await call('/api/finance/accounts', { method: 'POST', token, body: { name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }); if (card.status !== 200) throw new Error('card account ' + JSON.stringify(card.data).slice(0, 300));
  const device = await call('/api/finance/collectors', { method: 'POST', token, body: { name: 'Test collector', accountIds: [card.data.account._id] } }); if (device.status !== 200) throw new Error('collector ' + JSON.stringify(device.data).slice(0, 300));
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(uri);
  return { origin, call, token, other, deviceToken: device.data.token, deviceId: device.data.id, db: client.db(dbName), logs: () => logs, async close() { await client.close().catch(() => {}); if (child.exitCode === null) { const ended = new Promise(r => child.once('exit', r)); child.kill(); await ended; } } };
}
const browserLogin = async (page, origin, wait) => { await page.goto(origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', 'finance-a@example.invalid'); await page.type('#password', 'Synthetic-password-Only1!'); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/'); };
async function ownedPage(browserModule, fn) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-shiwake-ui-')), browser = await browserModule.browserFor(path.join(profileDir, 'profile'), { headless: true }); let page; const errors = [];
  try { page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); }); const wait = async (f, arg, label = '') => { for (let i = 0; i < 300; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw Error('native:chrome condition ' + label + ' ' + f.toString().slice(0, 140)); }; return await fn(page, wait, errors); }
  finally { if (page) await page.close().catch(() => {}); await browser.close(); if (!path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe owned Chrome cleanup'); await rm(profileDir, { recursive: true, force: true }); }
}

export default { name: 'omf-rakuten-native-shiwake', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true; const green = new Set();
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); green.add(name.split(' ')[0]); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1400)); } };
  const assert = (await import('node:assert/strict')).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-shiwake-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  let mongo = null, app = null, executed = false;
  const run = (args, env = {}, timeout = 900000, cwd = root) => new Promise(resolve => execFile(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
  try {
    const browserModule = await import(u('collector/browser.mjs')).catch(e => e), bankModule = await import(u('collector/bank.mjs')).catch(e => e), indexModule = await import(u('collector/index.mjs')).catch(e => e), rakutenModule = await import(u('collector/banks/rakuten.mjs')).catch(e => e);
    const need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const noOwnedChrome = () => assert.equal(need(browserModule, 'collector/browser.mjs').ownedBrowsers().filter(b => b.connected).length, 0, 'native:browser-closed');
    // ── F1: the frozen variant selects the adapter (existing collector, named behaviour) ──
    const adapterChecks = bank => {
      const standard = bank.adapterFor('rakuten', 'standard');
      assert.equal(standard?.support, 'verified', 'native:standard-adapter (adapterFor(rakuten, standard) is the standard corporate adapter)');
      assert.equal(standard.start, START_CORP, 'native:standard-adapter (START_CORP entry)');
      for (const v of ['plus', null, 'x']) assert.equal(bank.adapterFor('rakuten', v).support, 'contract-pending', 'native:pending-kept ' + v);
      assert.equal(bank.adapterFor('rakuten').contract, null, 'native:pending-kept (provider default)');
    };
    await leg('F1 per-variant adapter: rakuten+standard resolves the standard corporate adapter at START_CORP; plus, null and unknown keep contract-pending', async () => { adapterChecks(need(bankModule, 'collector/bank.mjs')); return 'standard verified at START_CORP; plus/null/unknown pending'; });
    // ── the built app on the owned MongoDB ──
    const ensureApp = async () => {
      if (app) return app;
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('built app absent; no HTTP coverage');
      const { MongoMemoryServer } = requireRoot('mongodb-memory-server'); const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), parentBinary = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
      const systemBinary = existsSync(binary) ? binary : existsSync(parentBinary) ? parentBinary : null;
      mongo = await MongoMemoryServer.create({ binary: systemBinary ? { systemBinary, version: '8.2.1' } : undefined });
      app = await bootApp(root, mongo, 'shiwake_fixture', path.join(temp, 'data')); executed = true; return app;
    };
    const api = '/api/finance-payments/', capi = '/api/finance-payments/collector/';
    const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 700)); return r.data; };
    let standardAccount = null, standardJob = null;
    // ── F2: a native standard connection needs no uploaded template, saves the period, queues retrieve with it frozen ──
    await leg('F2 native standard setup on the built app: no uploaded template needed (native four-column outflow-negative template), requested period saved and frozen, retrieve queued for a scoped PC', async () => {
      const a = await ensureApp(), req = (r, b, m = 'POST', t = a.token) => a.call(api + r, { method: m, token: t, body: b });
      standardAccount = ok(await req('bank/accounts', { name: 'Synthetic Rakuten (standard)', currency: 'JPY' }), 'bank account').account.id;
      const saved = await req('bank/accounts/' + standardAccount + '/connection', { provider: 'rakuten', variant: 'standard', accountLabel: 'カクウホールディングス', coverage: { from: '2025-11-01', to: null } }, 'PUT');
      assert.equal(saved.status, 200, 'native:standard-setup (a standard connection without an uploaded template) ' + JSON.stringify(saved.data).slice(0, 300));
      const connection = saved.data.account.connection; assert.deepEqual(connection.coverage, { from: '2025-11-01', to: null }, 'native:standard-setup (period saved)');
      const template = ok(await req('bank/templates', undefined, 'GET'), 'templates').templates.find(t => t.id === connection.templateId);
      assert.deepEqual(template?.headers, NATIVE_HEADERS, 'native:standard-setup (native template)'); assert.deepEqual(template.mapping, NATIVE_MAP); assert.equal(template.amountSign, 'outflow-negative');
      ok(await req('bank/collectors/' + a.deviceId, { bankAccountIds: [standardAccount] }, 'PUT'), 'device scope');
      standardJob = ok(await req('bank/accounts/' + standardAccount + '/sync', {}), 'sync').job;
      assert.equal(standardJob.kind, 'retrieve', 'native:standard-setup (retrieve queued for the standard variant)'); assert.equal(standardJob.snapshot.coverage.from, '2025-11-01', 'native:standard-setup (period frozen)'); assert.match(standardJob.snapshot.coverage.to, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(standardJob.snapshot.mapping, NATIVE_MAP); assert.equal(standardJob.snapshotHash, sha256(JSON.stringify(standardJob.snapshot)));
      return `connection saved with the native template ${String(template.id).slice(0, 8)}; retrieve job ${standardJob.jobId.slice(0, 8)} frozen ${standardJob.snapshot.coverage.from}〜${standardJob.snapshot.coverage.to}`;
    });
    // ── F3: the native classification route exists and is company-scoped ──
    await leg('F3 native classification route: GET bank-classifications needs a selected company (403 without), answers for a company member', async () => {
      const a = await ensureApp(), owner = await a.db.collection('users').findOne({ email: 'finance-a@example.invalid' }), companyId = new (requireRoot('mongodb').ObjectId)();
      await a.db.collection('organizations').insertOne({ _id: companyId, name: 'Synthetic F3 company', slug: 'f3-' + String(companyId), type: 'business', isActive: true, members: [{ userId: owner._id, role: 'owner', joinedAt: new Date() }] });
      const companyToken = ok(await a.call('/api/auth/switch-organization', { token: a.token, method: 'POST', body: { organizationId: String(companyId) } }), 'switch').tokens.accessToken;
      const account = standardAccount || ok(await a.call(api + 'bank/accounts', { method: 'POST', token: a.token, body: { name: 'Synthetic F3 bank', currency: 'JPY' } }), 'bank account').account.id;
      const listed = await a.call(api + 'bank-classifications?account=' + account, { token: companyToken });
      assert.equal(listed.status, 200, 'native:classification-route (company member) ' + JSON.stringify(listed.data).slice(0, 200));
      assert.equal((await a.call(api + 'bank-classifications?account=' + account, { token: a.token })).status, 403, 'native:classification-route (company required)');
      return 'company member 200, no company 403';
    });
    // ── F4: the native tab and the account creation in the connection panel (hidden real Chrome on the built app) ──
    await leg('F4 native UI: /intake/payments has the 銀行仕訳 tab with the review component; the connection panel can create a bank account', async () => {
      const a = await ensureApp();
      return await ownedPage(need(browserModule, 'collector/browser.mjs'), async (page, wait, errors) => {
        await page.setViewport({ width: 390, height: 844 }); await browserLogin(page, a.origin, wait);
        await page.goto(a.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]'), null, 'payments');
        assert.ok(await page.$('[data-review-tab="bank-classification"]'), 'native:classification-tab (銀行仕訳 tab)');
        await page.click('[data-review-tab="bank-classification"]'); await wait(() => !!document.querySelector('[data-bank-classification]'), null, 'component');
        await page.click('[data-review-tab="payments"]'); await page.click('[data-bank-connections-open]'); await wait(() => !!document.querySelector('[data-bank-connections]'));
        assert.ok(await page.$('[data-bank-account-create]'), 'native:classification-tab (account creation in the connection panel)');
        assert.deepEqual(errors, [], 'native:chrome-no-console-errors');
        return 'tab and component present; account creation present';
      });
    });
    // ── S: the standard adapter in owned headless Chrome on the fake portal ──
    const SCENARIO = { dialog: 'known', order: 'native-first', overviewDialog: false, sticky: false, foreignDownload: false, defaultPeriod: { from: '2026-07-22', to: '2026-10-20' } };
    const standardRun = async (bank, batch, scenario = {}, { job = jobOf(), adapter = undefined, person = {} } = {}) => {
      const dir = path.join(temp, batch); await mkdir(dir, { recursive: true });
      const s = { ...SCENARIO, ...scenario }, l = await launched(need(browserModule, 'collector/browser.mjs'), dir, OWNER, BANK_ACCOUNT, batch, s), statuses = []; let clicksBeforeAuth = null, signedIn = false;
      const status = async (state, text) => {
        statuses.push([state, text]); if (state !== 'verification_required') return;
        if (!signedIn) { signedIn = true; clicksBeforeAuth = await l.page().evaluate(() => window.__clicks); await l.page().evaluate(() => window.__signIn()); return; }
        if (person.acceptUnknown) setTimeout(() => { l.handle(true).catch(() => {}); }, 300);
        if (person.dismissUnknown) setTimeout(() => { l.handle(false).catch(() => {}); }, 300);
      };
      if (s.overviewDialog) { const timer = setInterval(() => { const d = l.stats.dialogs.findLast(x => x.open); if (d && Date.now() - (d.seen ??= Date.now()) > 1500) l.handle(false).catch(() => {}); }, 200); l.stopTimer = () => clearInterval(timer); }
      let result = null, error = null;
      const short = s.frameDialog ? { downloadTimeoutMs: 6000, extensionMs: 4000 } : { downloadTimeoutMs: 30000, extensionMs: 30000 };
      try { result = await bank.collectBankStatement(boundOf(job), job, dir, status, { batch, pollMs: 200, loginTimeoutMs: 30000, ...short, ...(adapter ? { adapter } : {}) }); } catch (e) { error = e; }
      l.stopTimer?.();
      return { job, dir, result, error, statuses, clicksBeforeAuth, stats: l.stats, profile: l.profile, jobDir: path.join(dir, 'outbox', 'bank', BANK_ACCOUNT, job.jobId) };
    };
    const okRun = r => { if (r.error) throw r.error; assert.equal(r.result.failed, null, JSON.stringify(r.result)); assert.equal(r.result.items.length, 1); return r.result.items[0].manifest; };
    const knownChecks = r => {
      const m = okRun(r);
      assert.equal(r.stats.navigations[0], START_CORP, 'native:start-corp'); assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1, 'native:one-intervention'); assert.equal(r.clicksBeforeAuth, 0, 'native:zero-clicks-before-auth');
      assert.equal(r.stats.downloads.length, 1, 'native:single-export'); assert.equal(r.stats.downloads[0].format, 'native', 'native:standard-not-zengin');
      assert.deepEqual([r.stats.downloads[0].from, r.stats.downloads[0].to], [r.job.snapshot.coverage.from, r.job.snapshot.coverage.to], 'native:period-from-frozen-coverage');
      assert.equal(r.stats.dialogs.length, 1, 'native:known-dialog-seen'); assert.equal(r.stats.dialogs[0].by, 'collector', 'native:known-dialog-accepted'); assert.equal(r.stats.dialogs[0].result, true);
      assert.equal(m.sourceHost, HOST, 'native:download-host'); assert.equal(m.jobId, r.job.jobId); assert.equal(m.snapshotHash, r.job.snapshotHash); assert.equal(m.channel, 'collector'); assert.equal(m.labelChecked, true, 'native:account-label-checked');
      assert.equal(m.period, r.job.snapshot.coverage.from + '〜' + r.job.snapshot.coverage.to, 'native:period-recorded'); assert.equal(m.sha256, sha256(nativeCsv(r.job.snapshot.coverage.from, r.job.snapshot.coverage.to)), 'native:original-bytes');
      return m;
    };
    let firstRun = null;
    await leg('S1 standard retrieval (owned headless Chrome, fake START_CORP portal): one sign-in intervention, zero clicks before it, 入出金明細 opened, six native date fields set from the frozen period (input/change fired, read back), the native-format CSV clicked once, the known daily-download warning accepted by the scoped handler, original bytes and manifest bound to job+snapshot', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), r = await standardRun(bank, 's1'); firstRun = r; const m = knownChecks(r);
      noOwnedChrome(); assert.equal(await exists(r.profile), false, 'native:ephemeral-profile-removed');
      return `navigations ${r.stats.navigations.length}, export ${r.stats.downloads[0].format} ${r.stats.downloads[0].from}〜${r.stats.downloads[0].to}, manifest ${m.sha256.slice(0, 8)}`;
    });
    await leg('S2 Zengin first on the page: the native section is chosen by its label, not by position', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's2', { order: 'zengin-first' }); okRun(r); assert.equal(r.stats.downloads[0]?.format, 'native', 'native:standard-not-zengin (zengin first)'); return 'native downloaded with Zengin first';
    });
    await leg('S3 an unlabelled form (cannot tell native from Zengin) is refused before any export', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's3', { order: 'unlabelled' }); assert.ok(r.error, 'native:unidentified-refused (no error)'); assert.equal(r.error.code, 'export-unidentified', 'native:unidentified-refused ' + r.error.message); assert.equal(r.stats.downloads.length, 0, 'native:unidentified-no-export'); return 'refused: ' + r.error.message.slice(0, 60);
    });
    const unknownChecks = r => { okRun(r); assert.equal(r.stats.dialogs.length, 1); assert.equal(r.stats.dialogs[0].by, 'person', 'native:unknown-dialog-owner (the collector did not accept an unknown dialog)'); assert.ok(r.statuses.filter(([s]) => s === 'verification_required').length >= 2, 'native:unknown-dialog-surfaced'); assert.equal(r.stats.downloads.length, 1); };
    await leg('S4 an unknown dialog on the export click stays for the person (surfaced as verification_required); after the person accepts it the export completes once', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's4', { dialog: 'unknown' }, { person: { acceptUnknown: true } }); unknownChecks(r); return `statuses ${r.statuses.map(s => s[0]).join(',')}; dialog handled by the person`;
    });
    const overviewChecks = r => { okRun(r); const d = r.stats.dialogs.find(x => x.url.includes(OVERVIEW)); assert.ok(d, 'overview dialog opened'); assert.notEqual(d.by, 'collector', 'native:unarmed-dialog (the known text on another surface was not accepted by the collector)'); assert.equal(d.result, false); };
    await leg('S5 the known warning text on the overview (not the armed export surface) is not accepted by the collector', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's5', { overviewDialog: true }); overviewChecks(r); return 'overview dialog left to the person (dismissed); export completed';
    });
    const frameChecks = r => { if (r.error) throw r.error; const d = r.stats.dialogs.find(x => x.url.includes(NOTICE)); assert.ok(d, 'frame dialog opened'); assert.notEqual(d.by, 'collector', 'native:dialog-surface (the known text from another frame was not accepted by the collector)'); assert.equal(r.stats.downloads.length, 0, 'native:dialog-surface (no export)'); assert.match(String(r.result.failed), /完了しませんでした/, 'native:dialog-surface (the attempt ends unfinished)'); };
    await leg('S5b the known warning text raised by another frame of the bank page while armed is left to the person (dismissed): no export, the attempt ends unfinished', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's5b', { frameDialog: true }, { person: { dismissUnknown: true } }); frameChecks(r); return 'frame dialog left to the person; ' + r.result.failed;
    });
    const stickyChecks = r => { assert.ok(r.error, 'native:period-readback (no error)'); assert.equal(r.error.code, 'period-mismatch', 'native:period-readback ' + r.error.message); assert.equal(r.stats.downloads.length, 0, 'native:period-readback-no-export'); };
    await leg('S6 a portal that resets the date fields: read-back mismatch stops before the attempt marker and before any export', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's6', { sticky: true }); stickyChecks(r); assert.equal(await exists(path.join(r.jobDir, 'attempt.json')), false, 'native:period-before-attempt'); return 'refused: ' + r.error.message.slice(0, 60);
    });
    await leg('S7 crash after the download, before the manifest: the bound attempt and recorded download recover the same file without a second export', async () => {
      if (!firstRun?.result) throw new Error('NOT RUN: S1 did not complete');
      const manifest = path.join(firstRun.jobDir, 'manifest.json'), before = JSON.parse(await readFile(manifest, 'utf8')); await unlink(manifest);
      const l = await launched(need(browserModule, 'collector/browser.mjs'), firstRun.dir, OWNER, BANK_ACCOUNT, 's1', SCENARIO);
      const r = await need(bankModule, 'collector/bank.mjs').collectBankStatement(boundOf(firstRun.job), firstRun.job, firstRun.dir, async () => {}, { batch: 's1', pollMs: 200 });
      assert.equal(r.recovered, true, 'native:crash-recovered'); assert.equal(r.items[0].manifest.sha256, before.sha256, 'native:crash-same-file'); assert.equal(l.stats.downloads.length, 0, 'native:crash-no-second-export'); await need(browserModule, 'collector/browser.mjs').closeOwnedBrowsers();
      return 'recovered ' + before.sha256.slice(0, 8) + ' with 0 export requests';
    });
    await leg('S8 a download that begins off the bank hosts is refused and its file removed (existing host boundary)', async () => {
      const r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's8', { foreignDownload: true }); assert.match(String(r.error?.message), /銀行サイトではありません/, 'native:foreign-host-refused'); assert.equal((await readdir(r.jobDir)).filter(n => GUID.test(n)).length, 0, 'native:foreign-file-removed'); assert.equal(await exists(path.join(r.jobDir, 'manifest.json')), false); return 'refused; file removed';
    });
    await leg('S9 an adapter bound to the standard variant refuses a job frozen for plus before any page', async () => {
      const bank = need(bankModule, 'collector/bank.mjs'), job = jobOf(undefined, 'plus'); let touched = 0; const ui = new Proxy({}, { get: () => async () => { touched++; return { kind: 'authenticated' }; } });
      await assert.rejects(bank.collectBankFromPage({}, {}, bank.adapterFor('rakuten', 'standard'), boundOf(job), job, temp, async () => {}, { ui }), e => e?.code === 'contract-pending', 'native:variant-bound'); assert.equal(touched, 0, 'native:variant-bound (no page)'); return 'refused before any page';
    });
    await leg('S10 the frozen provider and variant choose the adapter: a retrieve job frozen for 楽天銀行 standard stays that retrieval when the claim reports another current provider', async () => {
      const job = { ...jobOf(), provider: 'paypay' }, r = await standardRun(need(bankModule, 'collector/bank.mjs'), 's10', {}, { job }); knownChecks(r); return 'frozen rakuten/standard adapter used (claim provider paypay ignored)';
    });
    // ── E: the whole loop with the app: claim → runBankJob (default adapter from the frozen variant) → upload → capture → rows ──
    let e2e = null;
    await leg('E end-to-end on the built app: the device claims the standard retrieve job, runBankJob drives the default per-variant adapter in owned Chrome, the manifest uploads under its job/snapshot, the capture imports the native rows (dates, signs, duplicate-looking rows) and a repeated delivery changes nothing', async () => {
      const a = await ensureApp(), bank = need(bankModule, 'collector/bank.mjs'), idx = need(indexModule, 'collector/index.mjs'); if (!standardJob) throw new Error('NOT RUN: F2 did not queue the job');
      const claimed = ok(await a.call(capi + 'bank/claim', { method: 'POST', token: a.deviceToken, body: {} }), 'claim'); assert.equal(claimed.job?.jobId, standardJob.jobId, 'native:e2e-claimed'); assert.equal(claimed.job.kind, 'retrieve');
      const dir = path.join(temp, 'e2e'), batch = 'e2e'; await mkdir(dir, { recursive: true });
      const l = await launched(need(browserModule, 'collector/browser.mjs'), dir, claimed.account.ownerId, claimed.account._id, batch, SCENARIO), statuses = []; let signedIn = false;
      const status = async (state, message) => { statuses.push(state); if (state === 'verification_required' && !signedIn) { signedIn = true; await l.page().evaluate(() => window.__signIn()); } ok(await a.call(capi + 'bank/status', { method: 'POST', token: a.deviceToken, body: { jobId: claimed.job.jobId, state, message } }), 'status ' + state); };
      const sent = [];
      const upload = async (config, account, item, live, { route, base, query }) => {
        const m = item.manifest, bytes = await readFile(path.join(item.directory, m.filename)); assert.equal(sha256(bytes), m.sha256, 'outbox integrity');
        const response = await fetch(a.origin + base + route + '?' + new URLSearchParams(query), { method: 'POST', headers: { Authorization: 'Bearer ' + a.deviceToken, 'Content-Type': m.sourceFormat === 'json' ? 'application/json' : 'text/csv' }, body: bytes });
        const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.statusMessage || 'upload failed'), { status: response.status });
        await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...m, acknowledgedAt: new Date().toISOString(), importId: data.id }, null, 2)); sent.push({ query, data }); return data;
      };
      const collect = (bound, job, rootDir, st, options) => bank.collectBankStatement(bound, job, rootDir, st, { ...options, pollMs: 200, loginTimeoutMs: 30000, downloadTimeoutMs: 30000, extensionMs: 30000 });
      const outcome = await idx.runBankJob(claimed, { baseUrl: OMF_ORIGIN }, null, { status, upload, collect, directory: dir, batch });
      assert.equal(outcome.failed, null, 'native:e2e-complete ' + JSON.stringify(outcome)); assert.equal(sent.length, 1); const capture = sent[0].data;
      assert.equal(capture.state, 'imported', 'native:e2e-imported ' + JSON.stringify(capture)); assert.equal(capture.labelChecked, true, 'native:e2e-label-checked');
      const coverage = standardJob.snapshot.coverage, expected = ROWS.filter(([d]) => { const iso = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6); return iso >= coverage.from && iso <= coverage.to; });
      const rows = (await a.db.collection('financebankrows').find({ bankAccountId: new (requireRoot('mongodb').ObjectId)(standardAccount) }).toArray()).sort((x, y) => x.provenance[0].row - y.provenance[0].row);
      assert.equal(rows.length, expected.length, 'native:e2e-row-count'); assert.deepEqual(rows.map(r => [r.date.replaceAll('-', ''), -r.amount, r.direction]), expected.map(([d, amt]) => [d, amt, amt < 0 ? 'out' : 'in']), 'native:e2e-dates-signs');
      assert.deepEqual(rows.filter(r => r.description === '振込手数料').map(r => [r.occurrence, r.identicalCount]), [[1, 2], [2, 2]], 'native:e2e-duplicate-looking-kept');
      for (const r of rows) { assert.equal(r.provenance[0].channel, 'collector'); assert.equal(r.provenance[0].jobId, standardJob.jobId, 'native:e2e-provenance-job'); assert.equal(r.provenance[0].snapshotHash, standardJob.snapshotHash); }
      const job = await a.db.collection('financebankjobs').findOne({ jobId: standardJob.jobId }); assert.equal(job.state, 'complete', 'native:e2e-job-complete');
      const statement = await a.db.collection('financebankstatements').findOne({ _id: new (requireRoot('mongodb').ObjectId)(capture.id) }); assert.deepEqual(statement.capture.snapshot.coverage, coverage, 'native:e2e-coverage-on-capture'); assert.equal(statement.capture.sourceHost, HOST);
      const original = await readFile(path.join(temp, 'data', 'bank-statements', String(statement.ownerId), statement.hash)); assert.equal(sha256(original), statement.hash, 'native:e2e-original-retained');
      // a lost acknowledgement: the same manifest delivered again changes nothing
      const again = await fetch(a.origin + capi + 'bank/upload?' + new URLSearchParams(sent[0].query), { method: 'POST', headers: { Authorization: 'Bearer ' + a.deviceToken, 'Content-Type': 'text/csv' }, body: original }).then(r => r.json());
      assert.equal(again.duplicate, true, 'native:e2e-duplicate-delivery'); assert.equal(await a.db.collection('financebankrows').countDocuments({ bankAccountId: new (requireRoot('mongodb').ObjectId)(standardAccount) }), expected.length, 'native:e2e-no-duplicate-rows');
      assert.equal(ok(await a.call(capi + 'bank/claim', { method: 'POST', token: a.deviceToken, body: {} }), 'claim-after').job, null, 'native:e2e-no-second-job');
      noOwnedChrome(); e2e = { account: standardAccount, capture, coverage, rows: rows.length };
      return `claimed, ${statuses.join('→')}, capture ${capture.state} ${rows.length} rows (${coverage.from}〜${coverage.to}), duplicate delivery idempotent`;
    });
    // ── C: the connection panel (hidden real Chrome): account creation, standard setup, period, capability vs test state, PC status, ranges ──
    await leg('C native connection panel in hidden real Chrome: create a bank account, choose 楽天銀行 標準 without a template, enter the period, implemented steps vs connection-test state, PC status, requested/captured ranges, 390/1440 px, dark, no console errors', async () => {
      const a = await ensureApp(); if (!e2e) throw new Error('NOT RUN: E did not complete');
      return await ownedPage(need(browserModule, 'collector/browser.mjs'), async (page, wait, errors) => {
        await page.setViewport({ width: 390, height: 844 }); await browserLogin(page, a.origin, wait);
        await page.goto(a.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-payment-list]')); await page.click('[data-bank-connections-open]'); await wait(() => !!document.querySelector('[data-bank-connections]'));
        await wait(() => !!document.querySelector('[data-bank-account-create]'), null, 'create form');
        await page.type('[data-bank-account-new-name]', 'Synthetic Rakuten (UI)'); await page.click('[data-bank-account-create]');
        let created = null; for (let i = 0; i < 60 && !created; i++) { created = await a.db.collection('financebankaccounts').findOne({ name: 'Synthetic Rakuten (UI)' }); if (!created) await pause(100); } assert.ok(created, 'native:chrome-account-created');
        const id = String(created._id), card = '[data-bank-connection="' + id + '"] '; await wait(sel => !!document.querySelector(sel + '[data-bank-provider]'), card, 'new account card');
        await page.select(card + '[data-bank-provider]', 'rakuten'); await wait(sel => !!document.querySelector(sel + '[data-bank-variant]'), card); await page.select(card + '[data-bank-variant]', 'standard');
        await wait(sel => !!document.querySelector(sel + '[data-bank-native-template]'), card, 'native template note'); assert.match(await page.$eval(card + '[data-bank-capability]', e => e.textContent), /取得手順 実装済み/, 'native:chrome-capability');
        await page.$eval(card + '[data-bank-coverage-from]', e => { e.value = '2025-11-01'; e.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.$eval(card + '[data-bank-connect-save]', e => e.disabled), false, 'native:chrome-save-without-template'); await page.click(card + '[data-bank-connect-save]');
        let saved = null; for (let i = 0; i < 60 && !saved?.connection; i++) { saved = await a.db.collection('financebankaccounts').findOne({ _id: created._id }); if (!saved?.connection) await pause(100); }
        assert.equal(saved.connection.variant, 'standard', 'native:chrome-standard-saved'); assert.deepEqual(saved.connection.coverage, { from: '2025-11-01', to: null }, 'native:chrome-period-saved');
        const native = await a.db.collection('financebanktemplates').findOne({ _id: new (requireRoot('mongodb').ObjectId)(saved.connection.templateId) }); assert.deepEqual(native.headers, NATIVE_HEADERS, 'native:chrome-native-template');
        await wait(sel => /未実施/.test(document.querySelector(sel + '[data-bank-test-state]')?.textContent || ''), card, 'test state new');
        assert.match(await page.$eval(card + '[data-bank-pc-status]', e => e.textContent), /許可したPCがありません/, 'native:chrome-pc-status-none');
        const done = '[data-bank-connection="' + e2e.account + '"] ';
        assert.match(await page.$eval(done + '[data-bank-test-state]', e => e.textContent), /成功/, 'native:chrome-test-state-success'); assert.match(await page.$eval(done + '[data-bank-pc-status]', e => e.textContent), /1台/, 'native:chrome-pc-status');
        const jobText = await page.$eval(done + '[data-bank-job]', e => e.textContent); assert.match(jobText, /自動取得/, 'native:chrome-job-kind'); assert.ok(jobText.includes(e2e.coverage.from + '〜' + e2e.coverage.to), 'native:chrome-requested-range ' + jobText);
        assert.match(await page.$eval(done + '[data-bank-capture-range]', e => e.textContent), /2025-11-10〜2026-10-01/, 'native:chrome-captured-range');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'native:chrome-no-overflow');
        if (process.env.OMF_TEST_PAYMENT_SCREENSHOTS) { await mkdir(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS, 'rakuten-standard-mobile.png'), fullPage: true }); }
        await page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'native:chrome-desktop-no-overflow');
        await page.evaluate(() => document.documentElement.classList.add('dark')); assert.equal(await page.$eval(card + '[data-bank-coverage-from]', e => getComputedStyle(e).backgroundColor), 'rgb(30, 41, 59)', 'native:chrome-dark-control');
        assert.deepEqual(errors, [], 'native:chrome-no-console-errors');
        return 'account created, standard saved without a template, period saved, 実装済み vs 未実施/成功, PC status, requested and captured ranges shown';
      });
    });
    // ── U: unit tests (pure decisions; existing payment-matching units included) ──
    await leg('U unit tests: collector/test/rakuten-standard.test.mjs, scripts/finance-bank-classification.test.mjs, scripts/finance-payment-match.test.mjs', async () => {
      const r = await run(['--test', 'collector/test/rakuten-standard.test.mjs', 'scripts/finance-bank-classification.test.mjs', 'scripts/finance-payment-match.test.mjs'], {}, 300000);
      await writeFile(path.join(root, '.zoomer-shiwake-unit.txt'), r.stdout + r.stderr); if (r.code !== 0) throw new Error((r.stdout + r.stderr).split('\n').filter(l => /not ok|Error|assert|ERR_/.test(l)).slice(0, 14).join(' | '));
      return (r.stdout.match(/(?:#|ℹ) pass \d+/) || ['pass ?'])[0] + ', ' + (r.stdout.match(/(?:#|ℹ) fail \d+/) || ['fail ?'])[0];
    });
    // ── I: native classification on the built app (HTTP + hidden Chrome) ──
    await leg('I native classification on the built app: company/owner boundary, live proposals, idempotent generation, revisioned corrections, teaching, explicit registration with the reserved ID, crash/concurrency recovery, linkage, supersession, revoked membership, the 銀行仕訳 tab in real Chrome', async () => {
      const a = await ensureApp(), passed = [];
      const integration = path.join(root, 'scripts/finance-bank-classification-integration.cjs'); if (!existsSync(integration)) throw new Error('NOT RUN: integration absent');
      await createRequire(import.meta.url)(integration)({ db: a.db, call: a.call, origin: a.origin, token: a.token, other: a.other, pass: name => passed.push(name.split(' ')[0]), root, pause });
      return passed.join(', ');
    });
    // ── P: the staged downloader package carries the changed collector files; the graph resolves; staged modules load ──
    await leg('P package: banks/rakuten.mjs and bank.mjs staged and hashed, the staged graph resolves, the staged standard adapter and per-variant resolution load without a live bank; the classification module is not shipped to the PC', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      for (const f of ['collector/banks/rakuten.mjs', 'collector/bank.mjs', 'shared/finance-payment-match.mjs']) assert.equal(manifest.files[f], sha256(await readFile(path.join(root, f))), 'native:package-hash ' + f);
      assert.ok(!Object.keys(manifest.files).some(f => f.includes('finance-bank-classification')), 'native:package-no-classification'); await walkRelativeImports(path.join(into, 'collector', 'index.mjs'));
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector/bank.mjs')).href); adapterChecks(stagedBank);
      const stagedShared = await import(pathToFileURL(path.join(into, 'shared/finance-payment-match.mjs')).href); assert.equal(stagedShared.bankCollectionMode('rakuten', 'standard'), 'retrieve', 'native:package-mode'); assert.ok(stagedShared.BANK_PROVIDERS.every(p => p[2] === 'contract-pending'), 'native:package-provider-table');
      await assert.rejects(stagedBank.adapterFor('rakuten', 'standard').ui({}, {}, null).selectPeriod(null), e => e?.code === 'period-required');
      return Object.keys(manifest.files).length + ' files staged; graph resolves; staged standard adapter loads';
    });
    // ── M: deliberately reintroduced defects flip their named assertions ──
    const ready = ['F1', 'F2', 'F3', 'F4', 'S1', 'S2', 'S3', 'S4', 'S5', 'S5b', 'S6', 'S10', 'E', 'U', 'I'].every(n => green.has(n));
    await leg('M1-M6 collector mutants (sibling copies, owned Chrome): known-text check removed, Zengin exclusion replaced by position, export-surface check removed, read-back bypassed, variant resolution removed, variant binding removed', async () => {
      if (!ready) throw new Error('NOT RUN: the behaviour legs must be green first');
      const caught = [], flips = async (label, fn, pattern) => { let error = null; try { await fn(); } catch (e) { error = e; } if (!error) throw new Error(label + ' did not flip'); if (!pattern.test(String(error.message))) throw new Error(label + ' flipped the wrong assertion: ' + String(error.message).slice(0, 300)); caught.push(label + '→' + String(error.message).match(pattern)[0]); };
      const withRakuten = async (edits, fn) => { const m = await mutantModule('collector/banks/rakuten.mjs', edits); try { const mod = await m.load(); const adapter = { ...mod.standard, ui(page, browser, snapshot) { return mod.standardUi(page, browser, this, snapshot); } }; await fn(adapter, mod); } finally { await m.dispose(); } };
      const bank = need(bankModule, 'collector/bank.mjs');
      await withRakuten([[/message\.includes\(DAILY_EXPORT_WARNING\)/, 'true']], adapter => flips('M1', async () => unknownChecks(await standardRun(bank, 'm1', { dialog: 'unknown' }, { adapter, person: { acceptUnknown: true } })), /native:unknown-dialog-owner/));
      await withRakuten([[/\.filter\(c => !zengin\(c\.segment\) && native\(c\.segment\)\)/, '.slice(0, 1)']], adapter => flips('M2', async () => { const r = await standardRun(bank, 'm2', { order: 'zengin-first' }, { adapter }); okRun(r); assert.equal(r.stats.downloads[0]?.format, 'native', 'native:standard-not-zengin'); }, /native:standard-not-zengin/));
      await withRakuten([[/url\.pathname !== surface\.pathname/, 'false']], adapter => flips('M3', async () => frameChecks(await standardRun(bank, 'm3', { frameDialog: true }, { adapter, person: { dismissUnknown: true } })), /native:dialog-surface/));
      await withRakuten([[/if \(!standardPeriodReadback\(values, wanted\)\)/, 'if (false)']], adapter => flips('M4', async () => stickyChecks(await standardRun(bank, 'm4', { sticky: true }, { adapter })), /native:period-readback/));
      { const m = await mutantModule('collector/bank.mjs', [[/\(variant != null && base\?\.variants\?\.\[variant\]\) \|\| base/, 'base']]); try { const mod = await m.load(); await flips('M5', async () => adapterChecks(mod), /native:standard-adapter/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/bank.mjs', [[/if \(adapter\.variant && adapter\.variant !== \(job\?\.snapshot\?\.variant \?\? null\)\)/, 'if (false)']]); try { const mod = await m.load(); await flips('M6', async () => { const job = jobOf(undefined, 'plus'); let touched = 0; const ui = new Proxy({}, { get: () => async () => { touched++; throw new Error('touched'); } }); await assert.rejects(mod.collectBankFromPage({}, {}, mod.adapterFor('rakuten', 'standard'), boundOf(job), job, temp, async () => {}, { ui }), e => e?.code === 'contract-pending', 'native:variant-bound'); }, /native:variant-bound/); } finally { await m.dispose(); } }
      noOwnedChrome(); return caught.join(', ');
    });
    await leg('M7-M11b pure classification mutants: bilateral uniqueness, direction, own-company transfer, cancelled calendar, source-changed readiness, registered-predecessor readiness', async () => {
      if (!ready) throw new Error('NOT RUN: the behaviour legs must be green first');
      const caught = [], chart = [{ id: 'a'.repeat(24), name: '外注費', type: 'expense' }, { id: 'b'.repeat(24), name: '地代家賃', type: 'expense' }];
      const checks = c => {
        const p = input => c.proposeBankClassifications({ rows: [], calendar: [], history: [], teachings: [], companyNames: [], chart, bankAccountName: '普通預金', ...input }).rows;
        const e = (id, dueDate, amount, type, category, extra = {}) => ({ id, title: category, dueDate, amount, currency: 'JPY', type, status: 'pending', category, ...extra });
        const two = p({ rows: [{ id: 'r5', date: '2026-09-25', amount: 50000, currency: 'JPY', description: '振込 A' }, { id: 'r6', date: '2026-09-26', amount: 50000, currency: 'JPY', description: '振込 B' }], calendar: [e('p', '2026-09-22', 50000, 'expense', '外注費')] });
        for (const r of two) assert.ok(r.unresolved.includes('calendar-ambiguous') && r.proposal.accountCategoryId === null, 'classification:calendar-bilateral');
        assert.equal(p({ rows: [{ id: 'r', date: '2026-09-10', amount: -110000, currency: 'JPY', description: '振込 L' }], calendar: [e('p', '2026-09-10', 110000, 'expense', '地代家賃')] })[0].calendarCandidates.length, 0, 'classification:calendar-direction');
        assert.equal(p({ rows: [{ id: 'r', date: '2026-10-01', amount: 300000, currency: 'JPY', description: '振込 カ）カクウホールディングス' }], companyNames: ['カクウホールディングス'], history: [{ payeeKey: 'カクウホールディングス', direction: 'out', values: { purpose: '外注費', accountCategoryId: 'a'.repeat(24) }, state: 'registered' }] })[0].proposal.purposeKind, 'own-transfer', 'classification:own-transfer');
        assert.equal(p({ rows: [{ id: 'r', date: '2026-09-10', amount: 110000, currency: 'JPY', description: '振込 L' }], calendar: [e('p', '2026-09-10', 110000, 'expense', '地代家賃', { status: 'cancelled' })] })[0].calendarCandidates.length, 0, 'classification:calendar-cancelled-excluded');
        assert.deepEqual(c.registrationReady({ values: { purpose: 'x', accountCategoryId: 'a'.repeat(24) }, currency: 'JPY', sourceChanged: true }).reasons, ['source-changed'], 'classification:source-changed-not-ready');
        assert.deepEqual(c.registrationReady({ values: { purpose: 'x', accountCategoryId: 'a'.repeat(24) }, currency: 'JPY', predecessorRegistered: true }).reasons, ['predecessor-registered'], 'classification:predecessor-registered');
      };
      checks(await import(u('shared/finance-bank-classification.mjs')));
      const mutate = async (label, edits, pattern) => { const m = await mutantModule('shared/finance-bank-classification.mjs', edits); try { const mod = await m.load(); let error = null; try { checks(mod); } catch (e) { error = e; } if (!error || !pattern.test(String(error.message))) throw new Error(label + ' did not flip ' + pattern + ': ' + (error?.message || 'passed').slice(0, 200)); caught.push(label + '→' + String(error.message).match(pattern)[0]); } finally { await m.dispose(); } };
      await mutate('M7', [[/&& rowsOf\(near\[0\]\.entry\)\.length === 1/, '']], /classification:calendar-bilateral/);
      await mutate('M8', [[/&& directionOf\(row\) === \(entry\.type === 'income' \? 'in' : 'out'\)/, '']], /classification:calendar-direction/);
      await mutate('M9', [[/if \(selfNames\.has\(payeeKey\)/, 'if (false']], /classification:own-transfer/);
      await mutate('M10', [[/entry\.status !== 'cancelled' && /, '']], /classification:calendar-cancelled-excluded/);
      await mutate('M11', [[/if \(input\.sourceChanged\) reasons\.push\('source-changed'\);/, '']], /classification:source-changed-not-ready/);
      await mutate('M11b', [[/if \(input\.predecessorRegistered\) reasons\.push\('predecessor-registered'\);/, '']], /classification:predecessor-registered/);
      return caught.join(', ');
    });
    await leg('M12-M16 server mutants (built chunks copied, second owned app, integration under OMF_TEST_SHIWAKE_MUTANT): expected revision dropped, reserved ID replaced, draft company scope dropped, fresh membership skipped, existing-candidate guard dropped', async () => {
      if (!ready || !mongo) throw new Error('NOT RUN: the behaviour legs must be green first');
      const integration = createRequire(import.meta.url)(path.join(root, 'scripts/finance-bank-classification-integration.cjs')), caught = [];
      const serverMutant = async (label, anchor, replacement, pattern) => {
        const copy = path.join(temp, 'mutant-' + label); await mkdir(copy, { recursive: true }); await cp(path.join(root, '.output'), path.join(copy, '.output'), { recursive: true, dereference: true });
        let hits = 0; for (const f of await files(path.join(copy, '.output/server/chunks'))) { const text = await readFile(f, 'utf8'); const n = (text.match(anchor) || []).length; if (n) { hits += n; await writeFile(f, text.replace(anchor, replacement)); } }
        if (hits !== 1) throw new Error(label + ' anchor hits ' + hits + ' ' + anchor);
        const mutantApp = await bootApp(copy, mongo, 'shiwake_' + label.toLowerCase(), path.join(temp, 'data-' + label));
        let error = null; try { await integration({ db: mutantApp.db, call: mutantApp.call, origin: mutantApp.origin, token: mutantApp.token, other: mutantApp.other, pass: () => {}, root, pause, mutant: true }); } catch (e) { error = e; } finally { await mutantApp.close(); await rm(copy, { recursive: true, force: true }).catch(() => {}); }
        if (!error || !pattern.test(String(error.message))) throw new Error(label + ' did not flip ' + pattern + ': ' + String(error?.message || 'passed').slice(0, 300));
        caught.push(label + '→' + String(error.message).match(pattern)[0]);
      };
      await serverMutant('M12', /if\s*\(\s*body\.revision\s*!==\s*draft\.revision\s*\)\s*fail\(\s*409\s*,\s*STALE\s*\)/g, 'if(false)fail(409,STALE)', /shiwake:stale-revision/);
      await serverMutant('M13', /const\s+transactionId\s*=\s*draft\.reservedTransactionId\b/g, 'const transactionId=draft._id', /shiwake:reserved-id-used|shiwake:crash-before-insert-same-id|shiwake:register-idempotent|shiwake:concurrent/);
      await serverMutant('M14', /const scopeOfDraft\s*=\s*\(ownerId,\s*organizationId,\s*draftId\)\s*=>\s*\(\{\s*_id:\s*id\(draftId\),\s*ownerId,\s*organizationId\s*\}\)/g, 'const scopeOfDraft=(ownerId,organizationId,draftId)=>({_id:id(draftId),ownerId})', /shiwake:draft-company-scoped/);
      await serverMutant('M15', /const\s*\{\s*organizationId:\s*classificationCompany\s*\}\s*=\s*await\s*calendarCompany\(event\)/g, 'const classificationCompany=event.context.auth?.organizationId?new (await import("mongoose")).default.Types.ObjectId(String(event.context.auth.organizationId)):(()=>{throw new Error("unreachable")})(await (async()=>{throw (await import("h3")).createError({statusCode:403,statusMessage:"No organization selected"})})())', /shiwake:revoked-membership/);
      await serverMutant('M16', /if\s*\(\s*action\s*===\s*"create"\s*&&\s*candidates\.length\s*&&\s*body\.confirmNew\s*!==\s*true\s*\)/g, 'if(false)', /shiwake:no-silent-double-booking/);
      return caught.join(', ');
    });
  } finally {
    if (app) await app.close().catch(() => {}); if (mongo) await mongo.stop().catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };

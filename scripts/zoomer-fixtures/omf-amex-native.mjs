// Fixture for case omf-amex-native-runtime-01: the Amex statement download through stock Chrome without automation, driven by Windows UI
// Automation. Run through the hub verifier (node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-amex-native.mjs --cwd <this worktree>)
// or directly (node scripts/zoomer-fixtures/omf-amex-native.mjs) for a development run; OMF_AMEX_NATIVE_EVIDENCE names an existing folder
// that receives every scenario receipt. Evidence, stated exactly: owned stock Chrome on a private desktop that is never the input desktop,
// fictional logins, codes and statements on loopback servers only (Chrome's host resolver maps every other name to nothing and background
// networking is off), owned temporary directories. No issuer, mailbox, vault, OMF, credential or visible window is used.
// The PRODUCTION helper runs here: collector/windows/amex-native.ps1 copied with exactly its policy block (between `# policy:begin` and
// `# policy:end`) replaced by a loopback policy — leg P proves the copy differs by nothing else — under the REAL browser.mjs collectStatement
// and amex-native.mjs, with the helper owned by the REAL key broker (key-broker.ps1, owner role: a kill-on-close job, no key).
// Legs (OMF_AMEX_NATIVE_LEGS, comma list; default all):
//   P  the policy copy and the production pins (the policy block, the launch list = browser.mjs PLAIN_LANGUAGE_ARGS, ASCII script).
//   N  the scenarios (OMF_AMEX_NATIVE_SCENARIOS narrows them): the e-mail code sign-in and the statement download in the private
//      desktop, the decoy frames, the focused statement and file controls, the private-mode check refusal, the popup, a profile in use,
//      and the closure faults: helper killed, broker killed, broker ended, collector process killed (then startup recovery).
//   R  measured repeats of the positive flows (POSITIVE; OMF_AMEX_NATIVE_REPEATS each, default 10); every failure is kept, none is retried.
//   M  reintroduced defects of the helper core (HELPER_DEFECTS), each through the scenario that names it, after that scenario's unchanged run
//      in leg N of the same run (its control); then defects of the adapter (ADAPTER_DEFECTS), each through the unit
//      assertion that names it, on a copy beside the original; then waits added to the unchanged helper (HELPER_STRESS), each scenario still passing.
// The observed-* scenarios (case omf-amex-statement-fold-01) draw the current statement page as UI Automation measured it on the real page:
// a masked card Text instead of the card button, a period split over five Texts instead of one, an end query on landing. Each identity,
// date and count refusal is repeated on that page, with the same forms in hidden places, controls and frames as decoys.
// The download-* scenarios (case omf-amex-download-fold-01) draw the download icon as UI Automation measured it on the real page: a Button with
// ExpandCollapse and ScrollItem, no Invoke, in the state Collapsed. Each state and form the helper tells apart runs here against what Chrome really
// exposes; a scenario with `helper` runs a copy edited only to reach a moment or a state Chrome gives no other way (cfg.hold, or a forced state).
// The closure-* scenarios (same case) reach the end of the job. A copy takes one more process into its job: a copy of PING.EXE, run from inside the profile and held by a debugger
// (HOLDER). A debuggee cannot finish exiting until its debugger continues, so after a successful TerminateJobObject it stays unsignaled and its image cannot be deleted, as in a slow real
// exit (case evidence held-01, held-02). The hold is a declared control, not a Chrome measurement. Other copies make a real API call fail: a null job, or a process no helper can open.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 7200000;
const SELF = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(SELF), '..', '..');
const SCRIPT = path.join(root, 'collector', 'windows', 'amex-native.ps1'), PAGE = path.join(root, 'collector', 'test', 'fixtures', 'amex-native.html');
const COVERS = ['collector/windows/amex-native.ps1', 'collector/amex-native.mjs', 'collector/browser.mjs', 'collector/test/fixtures/amex-native.html', 'scripts/zoomer-fixtures/omf-amex-native.mjs'];
const LEGS = (process.env.OMF_AMEX_NATIVE_LEGS || '').split(',').map(s => s.trim()).filter(Boolean);
const ONLY = (process.env.OMF_AMEX_NATIVE_SCENARIOS || '').split(',').map(s => s.trim()).filter(Boolean);
const REPEATS = Math.max(0, Math.min(50, Number(process.env.OMF_AMEX_NATIVE_REPEATS ?? 10) || 0));
const EVIDENCE = process.env.OMF_AMEX_NATIVE_EVIDENCE || '';
const TEMP = process.env.OMF_AMEX_NATIVE_TEMP || os.tmpdir();
export const PARTIAL = LEGS.length > 0 || ONLY.length > 0 || REPEATS < 10;
const execute = (file, args, options = {}) => new Promise(resolve => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...options }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
const powershell = (script, timeout = 120000) => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ensure = (value, message) => { if (!value) throw new Error(message); };
const LOGIN = Object.freeze({ username: 'omf-fixture-user-0001', password: 'Omf-fixture-pass-0001' });
const PRIMARY = '12345', OMF = 'https://omf.example.invalid';

// ── fictional statement periods around today in Tokyo: one open, the latest closed one (12 rows) and two older ones ─────────────────────
const tokyo = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const day = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const slash = date => date.replaceAll('-', '/');
function periods() {
  const closedEnd = day(tokyo(), -5), latest = { start: day(closedEnd, -30), end: closedEnd, total: 12 }, older = { start: day(latest.start, -31), end: day(latest.start, -1), total: 9 };
  return { open: { start: day(closedEnd, 1), end: day(closedEnd, 31), total: 3 }, latest, older, oldest: { start: day(older.start, -31), end: day(older.start, -1), total: 7 } };
}
const HEADERS = ['ご利用日', 'データ処理日', 'ご利用内容', 'カード会員様名', '会員番号 #', '金額', '海外通貨利用金額', '換算レート'];
const rowsOf = (p, count, { foreignCardRow = false } = {}) => Array.from({ length: count }, (_, i) => [slash(day(p.start, i + 1)), slash(day(p.start, i + 2)), i === count - 1 && count > 1 ? '前回分口座振替金額' : 'FIXTURE SHOP ' + String(i + 1).padStart(2, '0'), 'FIXTURE TARO', foreignCardRow && i === 0 ? '-54321' : '-' + PRIMARY, i === count - 1 && count > 1 ? '-15,000' : ((i + 1) * 1100).toLocaleString('en-US'), '', '']);
const csvField = v => /[",\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
const csvText = rows => [HEADERS, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
const csvBytes = text => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);

// ── the policy copy ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const PRODUCTION_POLICY = ['# policy:begin', "$policy = @'", 'public static class OmfAmexNativePolicy {', ' public const string Login = "https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog";', ' public const string Www = "https://www.americanexpress.com";', ' public const string Global = "https://global.americanexpress.com";', ' public const string Isolation = "";', ' public static string Report(string url) { return url; }', ' public static string Accept(string url) { return url; }', '}', "'@", ''];
function fixturePolicy(www, global) {
  return ['# policy:begin', "$policy = @'", 'public static class OmfAmexNativePolicy {',
    ` public const string Login = "${www}/ja-jp/account/login?inav=iNavLnkLog";`, ` public const string Www = "${www}";`, ` public const string Global = "${global}";`,
    ' public const string Isolation = " --disable-background-networking \\"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1\\"";',
    ' static string Swap(string url, string from, string to) { return url != null && (url == from || url.StartsWith(from + "/") || url.StartsWith(from + "?")) ? to + url.Substring(from.Length) : url; }',
    ' public static string Report(string url) { return Swap(Swap(url, Www, "https://www.americanexpress.com"), Global, "https://global.americanexpress.com"); }',
    ' public static string Accept(string url) { return Swap(Swap(url, "https://www.americanexpress.com", Www), "https://global.americanexpress.com", Global); }',
    '}', "'@", ''];
}
// The production script with only its policy block replaced (CRLF or LF as the file has it). Throws unless the copy maps back exactly.
export async function policyCopy(dir, www, global, { source = SCRIPT, edit = null } = {}) {
  let text = await readFile(source, 'utf8'); const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (edit) text = edit(text);
  const begin = text.indexOf('# policy:begin'), end = text.indexOf('# policy:end');
  ensure(begin > 0 && end > begin && text.indexOf('# policy:begin', begin + 1) < 0 && text.indexOf('# policy:end', end + 1) < 0, 'policy markers');
  const production = text.slice(begin, end), fixture = fixturePolicy(www, global).join(eol);
  const copy = text.slice(0, begin) + fixture + text.slice(end);
  ensure(copy.slice(0, begin) + production + copy.slice(begin + fixture.length) === text, 'the copy differs beyond its policy block');
  const file = path.join(dir, 'amex-native.fixture-' + randomUUID().slice(0, 8) + '.ps1');
  await writeFile(file, copy, { flag: 'wx' });
  return { file, production, copy };
}

// ── loopback servers: www (login, e-mail code), global (dashboard, statement, download), decoy (cross-site frame) ───────────────────────
const decoyHtml = (tag, observed, expand) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>decoy ${tag}</title>
${observed ? '<div><span>••••99999</span></div>' : '<button type="button" data-c="card">-99999</button>'}<a href="/activity/statement?end=2020-01-21" data-c="link">2019/12/22 - 2020/01/21</a>
<p>${observed ? '<span>(</span><span>2019/12/22</span><span> - </span><span>2020/01/21</span><span>)</span>' : '<span>（2019/12/22－2020/01/21）</span>'}</p><p>99 件中 99 件を表示</p>
<button id="action-icon-dls-icon-download-" type="button" aria-label="ダウンロード"${expand ? ' aria-haspopup="dialog" aria-expanded="false"' : ''} data-c="icon">↓</button>
<div role="dialog" aria-modal="true" aria-label="decoy"><input type="radio" name="f" id="axp-activity-download-body-selection-options-type_csv" data-c="radio"><label for="axp-activity-download-body-selection-options-type_csv">CSV</label><button type="button" data-c="download">ダウンロード</button><button type="button" data-c="next">次へ</button></div>
<a href="/activity/statement" data-c="statement-link">ご利用明細</a>
<script>const tag=${JSON.stringify(tag)};const send=(c,e)=>fetch('/decoy-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag,control:c,event:e.type,trusted:e.isTrusted})});
document.querySelectorAll('[data-c]').forEach(el=>{el.addEventListener('click',e=>{if(el.tagName==='A')e.preventDefault();send(el.dataset.c,e)});el.addEventListener('change',e=>send(el.dataset.c,e));});</script>`;
function readJson(req, limit = 262144) { return new Promise(resolve => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > limit) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } }); req.on('error', () => resolve(null)); }); }
async function startServers() {
  const page = await readFile(PAGE, 'utf8'), modules = { '/collector/statement.mjs': await readFile(path.join(root, 'collector', 'statement.mjs')), '/shared/amex.mjs': await readFile(path.join(root, 'shared', 'amex.mjs')), '/omf-crypto-stub.mjs': Buffer.from("export const createHash = () => { throw new Error('fixture page: no hashing'); };\n") };
  const events = new EventEmitter(), servers = { www: http.createServer(), global: http.createServer(), decoy: http.createServer() };
  for (const s of Object.values(servers)) await new Promise(r => s.listen(0, '127.0.0.1', r));
  const origins = { www: 'http://127.0.0.1:' + servers.www.address().port, global: 'http://127.0.0.1:' + servers.global.address().port, decoy: 'http://localhost:' + servers.decoy.address().port };
  let sc = null;
  const send = (res, status, type, body, extra = {}) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra }); res.end(body); };
  const html = surface => page.replace('<!--FIXTURE-->', '<script>window.__FIXTURE__=' + JSON.stringify({ ...sc.cfg, surface }).replace(/</g, '\\u003c') + '</script>');
  const common = async (kind, req, res, u) => {
    sc.receipts.arrivals.push({ server: kind, method: req.method, path: u.pathname, query: u.search, at: Date.now() });
    if (req.method === 'GET' && modules[u.pathname]) return send(res, 200, 'text/javascript; charset=utf-8', modules[u.pathname]), true;
    if (req.method === 'GET' && u.pathname === '/favicon.ico') return send(res, 204, 'text/plain', ''), true;
    if (req.method === 'POST' && u.pathname === '/receipt') { const body = await readJson(req); if (body) { sc.receipts.page.push({ server: kind, at: Date.now(), ...body }); if (body.kind === 'load') events.emit('load', body.surface); } return send(res, 204, 'text/plain', ''), true; }
    if (req.method === 'POST' && u.pathname === '/decoy-receipt') { const body = await readJson(req); sc.receipts.decoy.push({ server: kind, at: Date.now(), ...(body || {}) }); return send(res, 204, 'text/plain', ''), true; }
    return false;
  };
  servers.www.on('request', async (req, res) => {
    const u = new URL(req.url, origins.www);
    if (!sc || req.headers.host !== origins.www.slice(7)) return send(res, 403, 'text/plain', 'loopback only');
    if (await common('www', req, res, u)) return;
    if (req.method === 'GET' && u.pathname === '/ja-jp/account/login') { sc.receipts.document.push({ path: u.pathname, acceptLanguage: req.headers['accept-language'] ?? null, userAgentAutomation: /HeadlessChrome/.test(req.headers['user-agent'] || '') }); return send(res, 200, 'text/html; charset=utf-8', html('login')); }
    if (req.method === 'GET' && u.pathname === '/ja-jp/account/reauth/verify') return send(res, 200, 'text/html; charset=utf-8', html('verify'));
    if (req.method === 'POST' && u.pathname === '/login-api') { const body = await readJson(req) || {}; sc.receipts.logins.push({ user: body.user === LOGIN.username, password: body.password === LOGIN.password }); return send(res, 200, 'application/json', JSON.stringify({ next: sc.cfg.otp ? origins.www + '/ja-jp/account/reauth/verify' : origins.global + '/dashboard' })); }
    if (req.method === 'POST' && u.pathname === '/request-code') { sc.code = { id: 'fixture-mail-' + randomUUID().slice(0, 8), code: String(100000 + randomBytes(3).readUIntBE(0, 3) % 900000) }; sc.receipts.codeRequests++; return send(res, 200, 'application/json', '{}'); }
    if (req.method === 'POST' && u.pathname === '/verify-code') { const body = await readJson(req) || {}; const ok = !!sc.code && body.code === sc.code.code; sc.receipts.codeChecks.push(ok); return send(res, 200, 'application/json', JSON.stringify(ok ? { next: origins.global + '/dashboard' } : {})); }
    if (req.method === 'GET' && u.pathname === '/test/issued-code') return send(res, 200, 'application/json', JSON.stringify(sc.code || {}));
    return send(res, 404, 'text/plain', 'not found');
  });
  servers.global.on('request', async (req, res) => {
    const u = new URL(req.url, origins.global);
    if (!sc || req.headers.host !== origins.global.slice(7)) return send(res, 403, 'text/plain', 'loopback only');
    if (await common('global', req, res, u)) return;
    if (req.method === 'GET' && u.pathname === '/dashboard') return send(res, 200, 'text/html; charset=utf-8', html('dashboard'));
    if (req.method === 'GET' && u.pathname === '/activity/statement') { if (!sc.statementLoaded) { sc.statementLoaded = true; events.emit('statement'); } return send(res, 200, 'text/html; charset=utf-8', html('statement')); }
    if (req.method === 'GET' && u.pathname === '/unrelated') return send(res, 200, 'text/html; charset=utf-8', html('unrelated'));
    // a helper copy holding its action asks once and is answered when the page has made its change (scenarios download-hold-*)
    if (req.method === 'GET' && u.pathname === '/test/hold-reached') { sc.held = true; sc.release = () => send(res, 200, 'application/json', '{}'); return; }
    if (req.method === 'GET' && u.pathname === '/test/hold') { const held = sc.held; sc.held = false; return send(res, 200, 'application/json', JSON.stringify({ held })); }
    if (req.method === 'GET' && u.pathname === '/test/hold-done') { sc.release?.(); sc.release = null; return send(res, 204, 'text/plain', ''); }
    // the process a copy takes into its job, and that process's own exit while the job closes (scenarios closure-*)
    if (req.method === 'GET' && u.pathname === '/test/member') return send(res, 200, 'text/plain', String(await sc.holder.start()));
    if (req.method === 'GET' && u.pathname === '/test/member-leave') { await sc.holder.leave(); return send(res, 204, 'text/plain', ''); }
    if (req.method === 'GET' && u.pathname === '/account/profile') return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><title>profile</title><p>profile</p>');
    if (req.method === 'GET' && u.pathname === '/decoy-frame' && u.searchParams.get('tag') === 'same') return send(res, 200, 'text/html; charset=utf-8', decoyHtml('same', u.searchParams.get('forms') === 'observed', u.searchParams.get('icon') === 'expand'));
    if (req.method === 'GET' && u.pathname === '/download') {
      const format = u.searchParams.get('format'), end = u.searchParams.get('end'), all = Object.values(periods()), p = all.find(q => q.end === end) || periods().latest;
      if (format === 'csv') { const bytes = csvBytes(csvText(rowsOf(p, sc.def.csv?.count ?? p.total, { foreignCardRow: !!sc.def.csv?.foreignCardRow }))); sc.receipts.downloads.push({ format, end, bytes: bytes.length, sha256: sha(bytes) }); return send(res, 200, 'text/csv; charset=utf-8', bytes, { 'Content-Disposition': `attachment; filename="${sc.cfg.fileName}"`, 'Content-Length': bytes.length }); }
      const bytes = Buffer.from('%PDF-1.4\n% fixture stand-in\n'); sc.receipts.downloads.push({ format, end, bytes: bytes.length, sha256: sha(bytes) });
      return send(res, 200, 'application/octet-stream', bytes, { 'Content-Disposition': `attachment; filename="${sc.cfg.fileName.replace(/\.csv$/, '.pdf')}"`, 'Content-Length': bytes.length });
    }
    return send(res, 404, 'text/plain', 'not found');
  });
  servers.decoy.on('request', async (req, res) => {
    const u = new URL(req.url, origins.decoy);
    if (!sc || req.headers.host !== origins.decoy.slice(7)) return send(res, 403, 'text/plain', 'loopback only');
    sc.receipts.decoyArrivals.push({ method: req.method, path: u.pathname, query: u.search });
    if (req.method === 'GET' && u.pathname === '/decoy-frame') return send(res, 200, 'text/html; charset=utf-8', decoyHtml('cross', u.searchParams.get('forms') === 'observed', u.searchParams.get('icon') === 'expand'));
    if (req.method === 'POST' && u.pathname === '/decoy-receipt') { const body = await readJson(req); sc.receipts.decoy.push({ server: 'cross', at: Date.now(), ...(body || {}) }); return send(res, 204, 'text/plain', ''); }
    return send(res, 404, 'text/plain', 'not found');
  });
  return {
    origins, events,
    begin(def, cfg) { sc = { def, cfg, code: null, statementLoaded: false, held: false, release: null, holder: null, receipts: { arrivals: [], page: [], decoy: [], decoyArrivals: [], downloads: [], logins: [], codeChecks: [], codeRequests: 0, document: [] } }; return sc; },
    close: () => Promise.all(Object.values(servers).map(s => new Promise(r => { s.closeAllConnections?.(); s.close(() => r()); })))
  };
}
function fixtureConfig(def, origins, fileName) {
  const p = periods(), links = [];
  for (const q of [p.open, p.latest, p.older, p.oldest]) { links.push({ text: `${slash(q.start)} - ${slash(q.end)}`, href: `/activity/statement?end=${q.end}` }); if (q === p.latest) links.push({ text: 'この期間を見る', href: `/activity/statement?end=${q.end}` }); }
  const cfg = { scenario: def.name, otp: def.otp !== false, mailLabel: 'c***s@example.invalid', spa: true, download: 'attachment', loadDelayMs: 450, decoys: true, crossOrigin: origins.decoy, popup: false, hiddenCard: null, labelledCard: false, cardsInitial: ['-' + PRIMARY], cardsPeriod: ['-' + PRIMARY], links, display: {}, totals: {}, rows: {}, csvText: {}, fileName, observed: false, landing: null, maskedCards: {}, ranges: {}, extras: [], stages: 0, stageMs: 700, icon: null, preopened: false, hold: null };
  for (const q of Object.values(p)) { cfg.display[q.end] = `（${slash(q.start)}－${slash(q.end)}）`; cfg.ranges[q.end] = rangeOf(q); cfg.totals[q.end] = [q.total, q.total]; cfg.rows[q.end] = rowsOf(q, q.total).map(r => [r[0], r[2], r[5]]); cfg.csvText[q.end] = csvText(rowsOf(q, q.total)); }
  def.fixture?.(cfg, p);
  return cfg;
}
const datedLink = (cfg, end) => cfg.links.find(l => l.text !== 'この期間を見る' && l.href.endsWith('end=' + end));
// The current statement page (the fixture page's cfg.observed): it lands on `landing` with an end query, no card button, the masked card Text,
// the split period, and the dated PDF link the real page repeats beside the period links. The in-page statementSnapshot finds no card button
// there, so a positive flow on it measures that difference instead of asserting the DOM's agreement.
const rangeOf = q => [slash(q.start), slash(q.end)];
const rangeNodes = ([start, end]) => ['(', start, ' - ', end, ')'];
const MASK = '••••';
const OBSERVED = 'the card is a masked Text and no button: the accessibility tree reads it, the in-page statementSnapshot finds no card (reviewed difference)';
function observedPage(c, p, landing = p.latest) {
  Object.assign(c, { observed: true, landing: landing.end, cardsInitial: [], cardsPeriod: [], maskedCards: { '*': [MASK + PRIMARY] } });
  c.links.push({ text: `カード明細(PDF)を表示 ${slash(p.latest.start)} - ${slash(p.latest.end)}`, href: `/activity/statement?end=${p.latest.end}` });
}
// The controls a decoy label is drawn in: Chrome names each by its label and exposes no Text inside it (case folder, evidence/shape-03.shapes.txt).
const CONTROLS = ['link', 'button', 'menuitem', 'block-link', 'list-link', 'nested-button', 'tab'];
// Near forms of the card, each visible and alone in its Text: none is the measured form, so none is a card.
const NEAR_CARDS = ['••••2345', '•••12345', '•••••12345', '****12345', '●●●●12345', '••••123456', '•••• 12345', 'カード ••••12345', '12345', '-12345'];

// ── the scenarios ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MESSAGES = { privateAttention: 'Amex asked for a check that the background download cannot complete', helperEnded: 'The Amex browser ended before the statement was saved; request the download again', otherWindow: 'Amex opened another window; request the download again', unverified: 'Amex statement links or signed-in card could not be verified', wrongCard: 'The signed-in Amex account does not match this connection', wrongDates: 'Amex displayed dates do not match the selected closed statement', notLoaded: 'The selected Amex statement did not finish loading', incomplete: 'Amex complete statement row count could not be verified', unreadable: 'The Amex statement page could not be read again; request the download again', pageChanged: 'The Amex page changed before the statement was saved; request the download again', csvMissing: 'Amex CSV format option changed' };
// The icon's forms on the current statement page (cfg.icon), each what Chrome 155 exposes for that markup (case evidence forms-02, forms-03). COLLAPSED is the
// measured real shape; aria-expanded follows the dialog, which is not measured on the real icon, so download-expand-menu-form keeps it Collapsed.
const COLLAPSED = { attrs: { 'aria-haspopup': 'dialog' }, flips: true }, EXPANDED = { attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'true' } };
const iconPage = (c, p, icon) => { observedPage(c, p); c.icon = icon; };
const refused = code => ({ message: MESSAGES.pageChanged, before: true, refused: code });
// The two edits a scenario's `helper` makes. held: on entering the Expand path the copy asks the page for its change (cfg.hold), waits for the answer and for
// Chrome's tree to follow. forced: the state read answers what Chrome does not report at that moment. Neither touches a check or the action under test.
const HOLD_AT = ' static Dictionary<string, object> ExpandIcon(Doc d, AutomationElement icon, ExpandCollapsePattern expand) {', STATE_READ = 'var state = expand.Current.ExpandCollapseState;';
const held = ms => [[HOLD_AT, `${HOLD_AT} var hold = new System.Net.WebClient(); hold.Proxy = null; hold.DownloadString(OmfAmexNativePolicy.Global + "/test/hold-reached"); Thread.Sleep(${ms});`]];
const forced = state => [[STATE_READ, `var state = ExpandCollapseState.${state};`]];
const heldPage = (c, p, hold, icon = COLLAPSED) => { iconPage(c, p, icon); c.hold = hold; };
// The period action held once it has resolved its link: the page changes and the copy goes on with the element it resolved.
const PERIOD_RESOLVED = '  var invoke = Invokable(Single(matches, "link"));';
const heldPeriod = ms => [[PERIOD_RESOLVED, `${PERIOD_RESOLVED} var hold = new System.Net.WebClient(); hold.Proxy = null; hold.DownloadString(OmfAmexNativePolicy.Global + "/test/hold-reached"); Thread.Sleep(${ms});`]];
const GONE = ['no_document', 'document_url_unavailable', 'ambiguous_document']; // the document read again while the old one leaves
// The end of the job. `member`: a copy takes a held process into its job right after Chrome starts (HOLDER), its exit held for holdMs. `closure`: what the record must say where that is
// not a proved end. HELD_MS outlasts the old wait and browser.mjs's removal retries together, and stays inside the helper's wait.
const END_WAIT_MS = 60000, HELD_MS = 26000, CLEANUP = /EPERM|EBUSY|EACCES/;
const LAUNCHED = '  Check(ResumeThread(chrome.thread) != UInt32.MaxValue, "chrome_resume"); CloseHandle(chrome.thread); chrome.thread = IntPtr.Zero;';
const takeMember = [[LAUNCHED, `${LAUNCHED} var member = new System.Net.WebClient(); member.Proxy = null; uint memberId = uint.Parse(member.DownloadString(OmfAmexNativePolicy.Global + "/test/member")); IntPtr memberHandle = OpenProcess(0x101, false, memberId); Check(memberHandle != IntPtr.Zero && AssignProcessToJobObject(job, memberHandle), "job_assignment"); CloseHandle(memberHandle);`]];
// new IntPtr(-2) below is a real refusal that can reach nothing: the pseudo-handle of the current thread is no job. (A null job means the caller's own job to QueryInformationJobObject.)
const CLOSING = 'if (window != IntPtr.Zero && IsWindow(window)) { uint pid;';
const memberLeaves = [[CLOSING, `var leaving = new System.Net.WebClient(); leaving.Proxy = null; leaving.DownloadString(OmfAmexNativePolicy.Global + "/test/member-leave"); Thread.Sleep(300); ${CLOSING}`]];
export const SCENARIOS = [
  { name: 'positive-attachment', expect: 'complete' },
  { name: 'positive-blob', expect: 'complete', fixture: c => { c.spa = false; c.download = 'blob'; } },
  { name: 'no-code-asked', expect: 'complete', otp: false },
  { name: 'hidden-other-card', expect: 'complete', measurement: 'a display:none card button with another suffix: the in-page statementSnapshot reads it, the accessibility tree does not (reviewed difference)', fixture: c => { c.hiddenCard = '-54321'; } },
  { name: 'labelled-card', expect: { message: 'Amex statement links or signed-in card could not be verified', before: true }, measurement: 'a card button whose accessible name (aria-label) differs from its text: the accessibility tree reads the name and the job stops; the in-page statementSnapshot reads the text', fixture: c => { c.labelledCard = true; } },
  { name: 'wrong-card', expect: { message: 'The signed-in Amex account does not match this connection', before: true }, fixture: c => { c.cardsPeriod = ['-54321']; } },
  { name: 'link-date-mismatch', expect: { message: 'Amex statement link and dates do not agree', before: true, noNavigation: true }, fixture: (c, p) => { datedLink(c, p.latest.end).href = '/activity/statement?end=' + day(p.latest.end, -1); } },
  { name: 'foreign-destination', expect: 'complete-older', fixture: (c, p) => { datedLink(c, p.latest.end).href = c.crossOrigin + '/activity/statement?end=' + p.latest.end; } },
  { name: 'displayed-period-mismatch', expect: { message: 'Amex displayed dates do not match the selected closed statement', before: true }, fixture: (c, p) => { c.display[p.latest.end] = `（${slash(p.older.start)}－${slash(p.older.end)}）`; } },
  { name: 'incomplete-count', expect: { message: 'Amex complete statement row count could not be verified', before: true }, fixture: (c, p) => { c.totals[p.latest.end] = [12, 10]; } },
  { name: 'no-download', expect: { message: 'Amex CSV download did not complete', clicked: true }, fixture: c => { c.download = 'none'; } },
  { name: 'wrong-download-count', expect: { message: 'Downloaded row count does not match the Amex page', file: true }, csv: { count: 11 } },
  { name: 'wrong-download-card', expect: { message: /2行目: この口座に登録されていないカードです/, file: true }, csv: { foreignCardRow: true } },
  { name: 'unrelated-window', expect: { message: MESSAGES.otherWindow, before: true }, fixture: c => { c.popup = true; } },
  { name: 'private-check', expect: { message: new RegExp(MESSAGES.privateAttention), before: true, oneLogin: true, noCodeRequest: true }, fixture: c => { c.mailLabel = 'x***y@example.invalid'; } },
  { name: 'profile-in-use', expect: { message: /Close the Chrome window that is already using this profile/, notStarted: true }, inUse: true },
  { name: 'helper-killed', expect: { message: MESSAGES.helperEnded, kill: true }, kill: 'helper' },
  { name: 'broker-killed', expect: { message: MESSAGES.helperEnded, kill: true }, kill: 'broker' },
  { name: 'broker-ended', expect: { message: MESSAGES.helperEnded, kill: true }, kill: 'broker-end' },
  { name: 'collector-killed', expect: 'crash', kill: 'collector' },
  // ── the current statement page: the positive flows ──
  { name: 'observed-statement', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => observedPage(c, p) },
  { name: 'observed-open-landing', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => observedPage(c, p, p.open) },
  { name: 'observed-full-navigation', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => { observedPage(c, p, p.open); c.spa = false; } },
  { name: 'observed-progressive', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => { observedPage(c, p, p.open); c.stages = 6; } },
  { name: 'observed-focused-dialog', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => { observedPage(c, p); c.dialogFocus = true; } },
  // The five parts adjacent in document order but in separate groups count as one period: the real page's parents of those parts are not measured,
  // so no common-parent rule exists to break it. Pinned here as the helper's actual behaviour; any other Text between the parts still breaks the run.
  { name: 'observed-period-across-groups', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => { observedPage(c, p); c.ranges[p.latest.end] = null; for (const node of rangeNodes(rangeOf(p.latest))) c.extras.push({ nodes: [node] }); } },
  { name: 'observed-with-legacy', expect: 'complete', fixture: (c, p) => { observedPage(c, p); c.cardsPeriod = ['-' + PRIMARY]; c.extras.push({ nodes: [c.display[p.latest.end]] }); } },
  // A page redrawn under a period link already resolved. Either the action is uncertain or the document read just before it refuses: both are safe stops, nothing reaches the page and
  // nothing is sent again. The first of them is the failure a load-timed collision gave observed-with-legacy once, in final-04.
  { name: 'observed-period-link-redrawn', expect: { message: MESSAGES.pageChanged, before: true, noNavigation: true, periodStops: { uncertain: ['element_not_available', 'uia_invalid_operation', 'uia_com'], error: ['ambiguous_document', 'no_document', 'document_url_unavailable', 'document_changed'] } }, helper: heldPeriod(900), fixture: (c, p) => { observedPage(c, p); c.cardsPeriod = ['-' + PRIMARY]; c.extras.push({ nodes: [c.display[p.latest.end]] }); c.hold = 'redrawn'; } },
  { name: 'observed-hidden-decoys', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => { observedPage(c, p); for (const place of ['offscreen', 'clipped', 'unrendered', ...CONTROLS]) c.extras.push({ nodes: [MASK + '54321'], place }, { nodes: rangeNodes(rangeOf(p.older)), place }); } },
  // ── the card on that page: only the exact visible form of the one signed-in card, compared as before ──
  { name: 'observed-wrong-card', expect: { message: MESSAGES.wrongCard, before: true }, fixture: (c, p) => { observedPage(c, p, p.open); c.maskedCards[p.latest.end] = [MASK + '54321']; } },
  { name: 'observed-wrong-card-from-the-start', expect: { message: MESSAGES.unverified, before: true, noNavigation: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'] = [MASK + '54321']; } },
  { name: 'observed-conflicting-card', expect: { message: MESSAGES.wrongCard, before: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'].push(MASK + '54321'); } },
  { name: 'observed-legacy-card-conflict', expect: { message: MESSAGES.wrongCard, before: true }, fixture: (c, p) => { observedPage(c, p); c.cardsPeriod = ['-54321']; } },
  { name: 'observed-near-card', expect: { message: MESSAGES.unverified, before: true, noNavigation: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'] = NEAR_CARDS; } },
  { name: 'observed-card-offscreen', expect: { message: MESSAGES.unverified, before: true, noNavigation: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'] = []; c.extras.push({ nodes: [MASK + PRIMARY], place: 'offscreen' }); } },
  { name: 'observed-card-clipped', expect: { message: MESSAGES.unverified, before: true, noNavigation: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'] = []; c.extras.push({ nodes: [MASK + PRIMARY], place: 'clipped' }); } },
  { name: 'observed-period-clipped', expect: { message: MESSAGES.notLoaded, before: true }, fixture: (c, p) => { observedPage(c, p); c.ranges[p.latest.end] = null; c.extras.push({ nodes: rangeNodes(rangeOf(p.latest)), place: 'clipped' }); } },
  { name: 'observed-card-in-controls', expect: { message: MESSAGES.unverified, before: true, noNavigation: true }, fixture: (c, p) => { observedPage(c, p); c.maskedCards['*'] = []; for (const place of CONTROLS) c.extras.push({ nodes: [MASK + PRIMARY], place }); } },
  // ── the displayed period on that page: only the five adjacent visible parts, compared as before; the period menu is never proof ──
  { name: 'observed-period-mismatch', expect: { message: MESSAGES.wrongDates, before: true }, fixture: (c, p) => { observedPage(c, p); c.ranges[p.latest.end] = rangeOf(p.older); } },
  { name: 'observed-two-periods', expect: { message: MESSAGES.wrongDates, before: true }, fixture: (c, p) => { observedPage(c, p); c.extras.push({ nodes: rangeNodes(rangeOf(p.older)) }); } },
  { name: 'observed-legacy-period-conflict', expect: { message: MESSAGES.wrongDates, before: true }, fixture: (c, p) => { observedPage(c, p); c.extras.push({ nodes: [c.display[p.older.end]] }); } },
  { name: 'observed-period-offscreen', expect: { message: MESSAGES.notLoaded, before: true }, fixture: (c, p) => { observedPage(c, p); c.ranges[p.latest.end] = null; c.extras.push({ nodes: rangeNodes(rangeOf(p.latest)), place: 'offscreen' }); } },
  { name: 'observed-period-in-controls', expect: { message: MESSAGES.notLoaded, before: true }, fixture: (c, p) => { observedPage(c, p); c.ranges[p.latest.end] = null; for (const place of CONTROLS) c.extras.push({ nodes: rangeNodes(rangeOf(p.latest)), place }); } },
  { name: 'observed-period-broken', expect: { message: MESSAGES.notLoaded, before: true }, fixture: (c, p) => { observedPage(c, p); const [a, b] = rangeOf(p.latest); c.ranges[p.latest.end] = null; for (const nodes of [['(', a, '件', ' - ', b, ')'], ['(', a, ' 〜 ', b, ')'], ['[', a, ' - ', b, ']'], ['(', a, ' - ', b], [a, ' - ', b, ')'], ['(', a.replaceAll('/', '-'), ' - ', b, ')']]) c.extras.push({ nodes: [...nodes, '…'] }); } },
  // A dialog below the fold: choosing its CSV radio scrolls the card and the period off the screen, so the recheck before the download has no
  // displayed evidence. Measured limit of the displayed-text rule: the job stops unread, it is not called a wrong card and nothing is downloaded.
  { name: 'observed-scrolled-away', expect: { message: MESSAGES.unreadable, before: true }, fixture: (c, p) => { observedPage(c, p); c.dialogInPage = true; } },
  // ── the count and the file on that page: unchanged rules, measured there ──
  { name: 'observed-incomplete-count', expect: { message: MESSAGES.incomplete, before: true }, fixture: (c, p) => { observedPage(c, p); c.totals[p.latest.end] = [12, 10]; } },
  { name: 'observed-wrong-download-count', expect: { message: 'Downloaded row count does not match the Amex page', file: true }, csv: { count: 11 }, fixture: (c, p) => observedPage(c, p) },
  { name: 'observed-wrong-download-card', expect: { message: /2行目: この口座に登録されていないカードです/, file: true }, csv: { foreignCardRow: true }, fixture: (c, p) => observedPage(c, p) },
  // ── the download icon: one action, from the states that have something to show; Invoke stays first; everything else is refused before acting ──
  { name: 'download-expand-collapsed', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => iconPage(c, p, COLLAPSED) },
  { name: 'download-expand-menu-form', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => iconPage(c, p, { attrs: { 'aria-haspopup': 'true' } }) },
  // Expanded before the job acted, its dialog already drawn: nothing is sent, and the CSV read decides. Chrome refuses Expand here (forms-02).
  { name: 'download-already-expanded', expect: 'complete', opens: 0, domLabel: 'dialog-pdf', measurement: OBSERVED, fixture: (c, p) => { iconPage(c, p, EXPANDED); c.preopened = true; } },
  // A link exposes Invoke and ExpandCollapse together (forms-02). With aria-expanded true only Invoke can reach its click, so this pins Invoke first.
  { name: 'download-link-keeps-invoke', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => iconPage(c, p, { tag: 'a', attrs: { href: '#omf-fixture-download', 'aria-expanded': 'true' } }) },
  { name: 'download-expand-disabled', expect: refused('control_disabled'), fixture: (c, p) => iconPage(c, p, { attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', disabled: '' } }) },
  { name: 'download-expand-aria-disabled', expect: refused('control_disabled'), fixture: (c, p) => iconPage(c, p, { attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-disabled': 'true' } }) },
  { name: 'download-expand-ambiguous', expect: refused('control_ambiguous'), fixture: (c, p) => iconPage(c, p, { ...COLLAPSED, count: 2 }) },
  { name: 'download-icon-only-in-frames', expect: refused('control_missing'), fixture: (c, p) => iconPage(c, p, { ...COLLAPSED, absent: true }) },
  // A labelled block has neither pattern, and aria-pressed exposes Toggle alone (forms-02, forms-03): no other pattern and no other element is tried.
  { name: 'download-no-action-target', expect: refused('invoke_unsupported'), fixture: (c, p) => iconPage(c, p, { tag: 'div', inert: true, parent: true }) },
  { name: 'download-toggle-target', expect: refused('invoke_unsupported'), fixture: (c, p) => iconPage(c, p, { attrs: { 'aria-pressed': 'false' } }) },
  // aria-haspopup=dialog without aria-expanded is LeafNode: ordinary markup for a button that opens a dialog, and Chrome answers Expand with the same click (forms-02).
  { name: 'download-expand-leaf', expect: 'complete', measurement: OBSERVED, fixture: (c, p) => iconPage(c, p, { attrs: { 'aria-haspopup': 'dialog' } }) },
  // Expand reaches the page and nothing opens: the unchanged CSV deadline ends the job; the action is not sent again.
  { name: 'download-no-dialog', expect: { message: MESSAGES.csvMissing, before: true, sentOnce: true }, fixture: (c, p) => iconPage(c, p, { ...COLLAPSED, opens: false }) },
  // A wait on a page that does not change is no reason to refuse. It also holds the page still for the case's read-only measurement of this icon.
  { name: 'download-expand-slow', expect: 'complete', measurement: OBSERVED, helper: [[HOLD_AT, `${HOLD_AT} Thread.Sleep(6000);`]], fixture: (c, p) => iconPage(c, p, COLLAPSED) },
  // ── read again immediately before Expand: a copy holds the action while the page changes ──
  { name: 'download-hold-replaced', expect: refused('control_changed'), helper: held(900), fixture: (c, p) => heldPage(c, p, 'replaced') },
  // A second icon: the first element is still live, so only finding the icon again can refuse this one (a replaced icon also fails the next read of it).
  { name: 'download-hold-doubled', expect: refused('control_ambiguous'), helper: held(900), fixture: (c, p) => heldPage(c, p, 'doubled') },
  { name: 'download-hold-disabled', expect: refused('control_disabled'), helper: held(900), fixture: (c, p) => heldPage(c, p, 'disabled') },
  // The page opens the dialog itself while the action is held: aria-expanded true is reported at once (forms-04), so the state read last sends nothing.
  { name: 'download-hold-expanded', expect: 'complete', opens: 0, measurement: OBSERVED, helper: held(900), fixture: (c, p) => heldPage(c, p, 'expanded') },
  { name: 'download-hold-reloaded', expect: refused(['document_changed', ...GONE]), helper: held(2500), fixture: (c, p) => heldPage(c, p, 'reloaded') },
  { name: 'download-hold-left', expect: refused(['document_path', ...GONE]), helper: held(2500), fixture: (c, p) => heldPage(c, p, 'left') },
  // ── what Chrome does not give on its own. PartiallyExpanded is in the UIA enumeration, but no measured form reports it, so a copy forces the read. ──
  { name: 'download-partly-expanded', expect: 'complete', measurement: OBSERVED, helper: forced('PartiallyExpanded'), fixture: (c, p) => iconPage(c, p, COLLAPSED) },
  // The Expand itself fails: the copy reads Collapsed on an icon Chrome holds Expanded, so Chrome refuses the action after it was sent. It is uncertain, and never sent again.
  { name: 'download-expand-refused', expect: { message: MESSAGES.pageChanged, before: true, uncertain: 'uia_invalid_operation' }, helper: forced('Collapsed'), fixture: (c, p) => { iconPage(c, p, EXPANDED); c.preopened = true; } },
  // ── the end of the job: the helper reports an end only when every process of its job has ended, and says what it could not prove; nothing here changes what the job found ──
  // A process that outlives a successful TerminateJobObject, as a slow real exit does: the wait covers it and the profile is removed after it.
  { name: 'closure-slow-member', expect: 'complete', member: { holdMs: HELD_MS }, helper: takeMember, closure: { minMs: 15000 } },
  // ...and one that exits by itself while Chrome is asked to close: it stays on the job's list until it has ended (measured), so the read before the termination still holds it.
  { name: 'closure-member-leaves-during-close', expect: 'complete', member: { holdMs: HELD_MS }, helper: [...takeMember, ...memberLeaves], closure: { minMs: 8000 } },
  // A process that outlives the helper's whole wait: the end is reported unproven at the bound, inside the adapter's own, and the job's file stays in the outbox. The removal fails as it
  // must while the process exists, and startup recovery removes the profile after it.
  { name: 'closure-member-outlives-the-wait', expect: { message: CLEANUP, manifestKept: true, profileLeft: true }, member: { holdMs: 95000 }, helper: takeMember, closure: { chromeEnded: false, processesLeft: 1, minMs: END_WAIT_MS - 500, maxMs: END_WAIT_MS + 3000 } },
  // A refused termination is recorded as refused; the job's kill-on-close still ends Chrome and that end is proved on the handles.
  { name: 'closure-terminate-refused', expect: 'complete', member: { holdMs: 3000 }, helper: [...takeMember, ['terminated = job == IntPtr.Zero || TerminateJobObject(job, 0);', 'terminated = job == IntPtr.Zero || TerminateJobObject(new IntPtr(-2), 0);']], closure: { jobTerminated: false, minMs: 2000 } },
  // A list that cannot be read, or a listed process that cannot be opened, proves nothing: the end stays unproven though Chrome is gone.
  { name: 'closure-list-refused', expect: 'complete', helper: [['bool read = QueryInformationJobObject(job, 3, list, (uint)size, IntPtr.Zero);', 'bool read = QueryInformationJobObject(new IntPtr(-2), 3, list, (uint)size, IntPtr.Zero);']], closure: { chromeEnded: false, membersKnown: false } },
  { name: 'closure-open-refused', expect: 'complete', helper: [['IntPtr p = OpenProcess(0x101000, false, pid); bool contained;', 'IntPtr p = OpenProcess(0x1F0FFF, false, 4); bool contained;']], closure: { chromeEnded: false, membersKnown: false } },
  // A list that does not fit its buffer is read again in a larger one: the held process is the last one listed and is waited for.
  { name: 'closure-list-overflow', expect: 'complete', member: { holdMs: HELD_MS }, helper: [...takeMember, ['for (int capacity = 1024; capacity <= 65536; capacity *= 4) {', 'for (int capacity = 1; capacity <= 65536; capacity *= 4) {']], closure: { minMs: 15000 } },
  // An id on the list that is no longer the job's (here this fixture's own process) is closed again and never waited for.
  { name: 'closure-foreign-id', expect: 'complete', helper: [['  Track();', `  Track(); Hold(${process.pid});`]] },
  // The watchdog's end takes the same wait.
  { name: 'closure-watchdog', expect: { message: MESSAGES.helperEnded, before: true, watchdog: true }, helper: [[' static Dictionary<string, object> Snapshot() {', ' static Dictionary<string, object> Snapshot() { Thread.Sleep(60000);']] },
  // Nothing launched, and a launch refused after Chrome existed: the same end, on what there was.
  { name: 'closure-no-launch', expect: { message: 'The batch could not take ownership of the browser', before: true, noChrome: true }, refuseOwn: true },
  { name: 'closure-launch-refused', expect: { message: MESSAGES.pageChanged, before: true, launchCode: 'job_assignment' }, helper: [['  if (!AssignProcessToJobObject(job, chrome.process)) {', '  if (chrome.pid != 0) {']] }
];
const base = name => name.split('~')[0];
const POSITIVE = ['positive-attachment', 'positive-blob', 'observed-statement', 'download-expand-collapsed']; // the flows leg R repeats and the run's measured rate counts
// M: defects reintroduced into the helper core of the copy (each anchor once in the production text), each run through the scenario named
// after it; the same scenario's unchanged run (leg N) is its control. The private desktop is never replaced by the input desktop here:
// that defect would put a window on the owner's screen.
export const HELPER_DEFECTS = [
  ['PN1-frames-not-excluded', [['for (int i = 0; i < all.Count; i++) if (!excluded.Contains(Key(all[i]))) list.Add(all[i]);', 'for (int i = 0; i < all.Count; i++) list.Add(all[i]);']], 'positive-attachment'],
  ['PN2-weighted-language-list', [['--accept-lang=ja-JP,ja,en --no-first-run', '--accept-lang=ja-JP,ja;q=0.9,en;q=0.8 --no-first-run']], 'positive-attachment'],
  ['PN3-automation-switch', [['--disable-extensions --disable-sync";', '--disable-extensions --disable-sync --enable-automation";']], 'positive-attachment'],
  ['PN4-chrome-outside-the-helper-job', [['  if (!AssignProcessToJobObject(job, chrome.process)) {', '  if (chrome.pid == 0 && !AssignProcessToJobObject(job, chrome.process)) {']], 'helper-killed'],
  // case omf-amex-statement-fold-01. PN0 takes the whole repair out: the production reading of the observed page must fail as the real page did.
  ['PN0-the-current-page-is-not-read', [['  AddSplitPeriods(elements, texts, periods);', ''], ['if (masked.Success && Displayed(e)) cards.Add("-" + masked.Groups[1].Value);', '']], 'observed-statement'],
  // Then each restriction on the current page's card and period, alone.
  ['PN5-offscreen-text-is-the-card', [['  if (e.Current.IsOffscreen) return false;', '']], 'observed-card-offscreen'],
  ['PN6-offscreen-text-is-the-period', [['  if (e.Current.IsOffscreen) return false;', '']], 'observed-period-offscreen'],
  ['PN7-a-control-name-is-the-card', [['  foreach (var e in Scoped(d, Type(ControlType.Text))) {', '  foreach (var e in Scoped(d, Condition.TrueCondition)) {']], 'observed-card-in-controls'],
  ['PN8-a-control-name-is-the-period', [['  foreach (var e in Scoped(d, Type(ControlType.Text))) {', '  foreach (var e in Scoped(d, Condition.TrueCondition)) {']], 'observed-period-in-controls'],
  ['PN13-clipped-text-is-the-card', [['  return box.IsEmpty || (box.Width * 2 >= own.Width && box.Height * 2 >= own.Height);', '  return true;']], 'observed-card-clipped'],
  ['PN9-any-mask-or-substring-is-the-card', [['"^\\u2022{4}([0-9]{5})$"', '"[*\\u2022\\u25CF]+\\\\s*[0-9]*([0-9]{5})[0-9]*$"']], 'observed-near-card'],
  ['PN10-period-parts-need-not-be-adjacent', [['   if (text.Length > 0) { elements.Add(e); texts.Add(text); }', '   if (text.Length > 0 && text != "\\u4EF6" && text != "\\u2026") { elements.Add(e); texts.Add(text); }']], 'observed-period-broken'],
  ['PN11-the-period-menu-is-the-displayed-period', [['  AddSplitPeriods(elements, texts, periods);', '  AddSplitPeriods(elements, texts, periods); foreach (Dictionary<string, object> l in links) periods.Add("(" + l["text"] + ")");']], 'observed-statement'],
  // only the snapshot's Texts: a frame's ids stay excluded, so nothing but its masked card or split period can catch this defect
  ['PN12-frames-supply-the-card-and-period', [['  foreach (var e in Scoped(d, Type(ControlType.Text))) {', '  foreach (AutomationElement e in d.main.FindAll(TreeScope.Descendants, Type(ControlType.Text))) {']], 'observed-statement'],
  // The frames listed before the matches, as they were, with the wait of PS1: a frame attaching in between keeps its elements.
  ['PN14-frames-listed-before-the-matches', [['  var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>();', ''], ['  for (int i = 0; i < all.Count; i++) if (!excluded.Contains(Key(all[i]))) list.Add(all[i]);', '  Thread.Sleep(900); var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>(); for (int i = 0; i < all.Count; i++) if (!excluded.Contains(Key(all[i]))) list.Add(all[i]);']], 'positive-attachment'],
  // case omf-amex-download-fold-01. PN15 takes the repair out: the measured icon must fail as the real one did. Then each rule of the Expand path, alone.
  ['PN15-the-icon-has-no-expand-path', [['&& icon.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p))', '&& icon.Current.AutomationId == "omf-no-such-icon")']], 'download-expand-collapsed'],
  ['PN16-expand-is-sent-twice', [['acting = true; expand.Expand();', 'acting = true; expand.Expand(); Thread.Sleep(400); expand.Expand();']], 'download-expand-menu-form'],
  ['PN17-a-leaf-is-refused', [['if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { \"alreadyExpanded\", true } };', 'Check(state != ExpandCollapseState.LeafNode, "control_disabled"); if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { \"alreadyExpanded\", true } };']], 'download-expand-leaf'],
  ['PN18-an-expanded-icon-is-expanded-again', [['if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { "alreadyExpanded", true } };', '']], 'download-already-expanded'],
  ['PN19-an-expanded-icon-is-collapsed', [['if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { "alreadyExpanded", true } };', 'if (state == ExpandCollapseState.Expanded) { acting = true; expand.Collapse(); return new Dictionary<string, object> { { "alreadyExpanded", true } }; }']], 'download-already-expanded'],
  ['PN20-the-icon-is-not-found-again', [['Check(Automation.Compare(Single(Scoped(d, Id(IconId)), "control"), icon), "control_changed"); ', '']], 'download-hold-doubled'],
  ['PN21-enabled-is-not-read-again', [['Check(icon.Current.IsEnabled, "control_disabled");', '']], 'download-hold-disabled'],
  ['PN22-the-state-is-read-before-the-hold', [[STATE_READ, ''], [HOLD_AT, `${HOLD_AT} ${STATE_READ}`]], 'download-hold-expanded'],
  ['PN23-the-document-is-not-read-again', [['Same(d, OmfAmexNativePolicy.Global, StatementPath); Check(Automation.Compare(Single', 'Check(Automation.Compare(Single']], 'download-hold-reloaded'],
  ['PN24-the-surface-is-not-read-again', [['Same(d, OmfAmexNativePolicy.Global, StatementPath); Check(Automation.Compare(Single', 'Check(Automation.Compare(Single']], 'download-hold-left'],
  ['PN25-a-frame-can-be-the-icon', [['var icon = Single(Scoped(d, Id(IconId)), "control");', 'var raw = new List<AutomationElement>(); foreach (AutomationElement e in d.main.FindAll(TreeScope.Descendants, Id(IconId))) raw.Add(e); var icon = Single(raw, "control");']], 'download-icon-only-in-frames'],
  ['PN26-toggle-is-tried', [['  var invoke = Invokable(icon);', '  object t; if (icon.TryGetCurrentPattern(TogglePattern.Pattern, out t)) { acting = true; ((TogglePattern)t).Toggle(); return new Dictionary<string, object> { { "invoked", 1 } }; } var invoke = Invokable(icon);']], 'download-toggle-target'],
  ['PN27-an-ancestor-is-tried', [['  var invoke = Invokable(icon);', '  var up = TreeWalker.RawViewWalker.GetParent(icon); while (up != null && !icon.TryGetCurrentPattern(InvokePattern.Pattern, out p) && up.Current.ControlType != ControlType.Document) { icon = up; up = TreeWalker.RawViewWalker.GetParent(up); } var invoke = Invokable(icon);']], 'download-no-action-target'],
  ['PN28-a-failed-expand-is-swallowed', [['acting = true; expand.Expand();', 'acting = true; try { expand.Expand(); } catch (InvalidOperationException) { }']], 'download-expand-refused'],
  ['PN29-expand-comes-before-invoke', [['if (!icon.TryGetCurrentPattern(InvokePattern.Pattern, out p) && icon.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p))', 'if (icon.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p))']], 'download-link-keeps-invoke'],
  ['PN30-partly-expanded-is-refused', [['if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { \"alreadyExpanded\", true } };', 'Check(state != ExpandCollapseState.PartiallyExpanded, "control_disabled"); if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { \"alreadyExpanded\", true } };']], 'download-partly-expanded'],
  // The closure. PN31 is the shutdown as it was: the main process alone is waited for. PN32 reads the members too late: the list right after the termination is a race the wait can win
  // by luck, so the copy reads it once the job has emptied. (PN33 is retired with the read before WM_CLOSE it tested: closure-03 showed that read was not needed.)
  ['PN31-only-the-main-process-is-waited-for', [['  if (chrome.process != IntPtr.Zero) { members.Add(chrome.process); chrome.process = IntPtr.Zero; }', '  foreach (var m in members) CloseHandle(m); members.Clear(); if (chrome.process != IntPtr.Zero) { members.Add(chrome.process); chrome.process = IntPtr.Zero; }']], 'closure-slow-member'],
  ['PN32-members-are-read-after-termination', [['  Track();', ''], ['  if (!terminated) { CloseHandle(job);', '  Thread.Sleep(200); Track(); if (!terminated) { CloseHandle(job);']], 'closure-slow-member'],
  ['PN34-a-refused-termination-is-recorded-as-done', [['{ "jobTerminated", terminated }', '{ "jobTerminated", true }']], 'closure-terminate-refused'],
  ['PN35-a-refused-termination-leaves-the-job-open', [['if (!terminated) { CloseHandle(job); job = IntPtr.Zero; }', '']], 'closure-terminate-refused'],
  ['PN36-an-unread-list-counts-as-empty', [['  membersKnown = false;', '']], 'closure-list-refused'],
  ['PN37-a-partial-list-is-accepted', [['if (!read) { if (Marshal.GetLastWin32Error() == 234) continue; break; }', 'if (!read && Marshal.GetLastWin32Error() != 234) break;'], ['if (listed < Marshal.ReadInt32(list, 0)) continue;', 'if (listed < 0) continue;']], 'closure-list-overflow'],
  ['PN38-an-unopened-member-is-dropped', [['if (Marshal.GetLastWin32Error() != 87) membersKnown = false; return;', 'return;']], 'closure-open-refused'],
  ['PN39-the-wait-has-no-bound', [['(uint)Math.Max(0, EndMs - clock.ElapsedMilliseconds)', '0xFFFFFFFF']], 'closure-member-outlives-the-wait'],
  ['PN40-an-unproved-end-is-reported-as-the-end', [['bool chromeEnded = left == 0 && membersKnown;', 'bool chromeEnded = true;']], 'closure-member-outlives-the-wait'],
  ['PN41-a-foreign-process-is-waited-for', [['if (contained) members.Add(p); else CloseHandle(p);', 'members.Add(p);']], 'closure-foreign-id'],
  ['PN42-the-watchdog-skips-the-end', [['return Finish("uia_watchdog", 3);', 'return 3;']], 'closure-watchdog']
];

// A: defects reintroduced into the adapter, each through the unit test whose assertion names it (the real adapter over the scripted helper, OMF_TEST_NATIVE_MODULE).
export const ADAPTER_DEFECTS = [
  ['AN1-the-end-is-shorter-than-the-helper-s-wait', [['const END_MS = 75000;', 'const END_MS = 10000;']], /amex-native:end-waits-for-the-helper/],
  ['AN2-an-unproved-end-is-recorded-as-the-end', [["chromeEnded: typeof end?.chromeEnded === 'boolean' ? end.chromeEnded : null", 'chromeEnded: true']], /amex-native:closure-recorded/],
  ['AN3-the-end-is-recorded-without-its-facts', [["jobTerminated: typeof end?.jobTerminated === 'boolean' ? end.jobTerminated : null, ", 'jobTerminated: null, ']], /amex-native:closure-recorded/],
  ['AN4-any-value-reaches-the-record', [['closeMs: fact(end?.closeMs)', 'closeMs: end?.closeMs ?? null']], /amex-native:closure-record-closed/]
];

// S: the production helper with only a wait added where a read or an action can meet a page in change. Unlike a defect, each scenario must still
// pass: a wait that turns it red names a collision that a loaded machine reaches by chance.
export const HELPER_STRESS = [
  ['PS1-a-frame-attaches-before-a-read', [['  var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>();', '  Thread.Sleep(900); var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>();']], 'positive-attachment'],
  ['PS2-a-frame-attaches-during-a-read', [['  var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>();', '  var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>(); Thread.Sleep(900);']], 'positive-attachment'],
  ['PS3-the-period-link-is-held-while-the-page-settles', [['  var invoke = Invokable(Single(matches, "link"));', '  var invoke = Invokable(Single(matches, "link")); Thread.Sleep(900);']], 'positive-blob'],
  ['PS4-the-period-link-is-held-on-the-current-page', [['  var invoke = Invokable(Single(matches, "link"));', '  var invoke = Invokable(Single(matches, "link")); Thread.Sleep(900);']], 'observed-statement']
];

// ── the held process of the closure scenarios: a copy of PING.EXE to loopback, inside the owned profile, under this debugger, which holds its exit for HoldMs. Commands on stdin. ─────
const HOLDER = `param([string]$Image,[int]$HoldMs)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class OmfAmexNativeHolder {
 [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SI { public int cb; public string reserved; public string desktop; public string title; public int x, y, xSize, ySize, xCount, yCount, fill, flags; public short show, reserved2; public IntPtr reservedBytes, input, output, error; }
 [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr process, thread; public uint pid, tid; }
 [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string file, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref SI info, out PI process);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool WaitForDebugEvent(IntPtr debugEvent, uint milliseconds);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool ContinueDebugEvent(uint pid, uint tid, uint status);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static volatile bool start, leave;
 static void Commands() { string line; while ((line = Console.In.ReadLine()) != null) { if (line == "start") start = true; else if (line == "leave") leave = true; } }
 static void Say(string text) { Console.Out.WriteLine(text); Console.Out.Flush(); }
 public static void Run(string image, int holdMs) {
  var reader = new Thread(Commands); reader.IsBackground = true; reader.Start();
  Say("{\\"ready\\":true}");
  while (!start) Thread.Sleep(20);
  File.Copy(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "PING.EXE"), image);
  var si = new SI { cb = Marshal.SizeOf(typeof(SI)) }; PI pi;
  if (!CreateProcessW(image, new StringBuilder("PING.EXE -n 900 127.0.0.1"), IntPtr.Zero, IntPtr.Zero, false, 0x08000002, IntPtr.Zero, null, ref si, out pi)) throw new Exception("member");
  CloseHandle(pi.thread);
  Say("{\\"pid\\":" + pi.pid + "}");
  IntPtr e = Marshal.AllocHGlobal(512); bool left = false;
  for (;;) {
   if (leave && !left) { left = true; TerminateProcess(pi.process, 0); }
   if (!WaitForDebugEvent(e, 50)) continue;
   int code = Marshal.ReadInt32(e, 0); uint pid = (uint)Marshal.ReadInt32(e, 4), tid = (uint)Marshal.ReadInt32(e, 8), status = 0x00010002;
   if (code == 1) { int exception = Marshal.ReadInt32(e, 16); if (exception != unchecked((int)0x80000003) && exception != unchecked((int)0x4000001F)) status = 0x80010001; }
   if (code == 5) { Say("{\\"exiting\\":true}"); Thread.Sleep(holdMs); ContinueDebugEvent(pid, tid, status); Say("{\\"held\\":" + holdMs + "}"); return; }
   ContinueDebugEvent(pid, tid, status);
  }
 }
}
'@
[OmfAmexNativeHolder]::Run($Image,$HoldMs)`;
async function startHolder(dir, image, holdMs) {
  const script = path.join(dir, 'holder.ps1'), said = {}, waiting = []; let buffer = '';
  await writeFile(script, HOLDER, { flag: 'wx' });
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Image', image, '-HoldMs', String(holdMs)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stderr.resume();
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); try { Object.assign(said, JSON.parse(line)); } catch { /* not a receipt */ } for (const w of [...waiting]) if (said[w.key] !== undefined) { waiting.splice(waiting.indexOf(w), 1); w.resolve(said[w.key]); } } });
  const heard = key => said[key] !== undefined ? Promise.resolve(said[key]) : new Promise(resolve => waiting.push({ key, resolve }));
  await Promise.race([heard('ready'), exited]);
  return { said, exited, start() { child.stdin.write('start\n'); return heard('pid'); }, leave() { child.stdin.write('leave\n'); return heard('exiting'); }, stop() { try { child.kill(); } catch { /* gone */ } return exited; } };
}

// ── read-only process, desktop and foreground facts (the owned root's Chrome only; nothing is changed) ─────────────────────────────────
const MONITOR = `param([string]$Out,[string]$Stop,[string]$Root)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Threading; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OmfAmexNativeMonitor {
 [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint f, bool i, uint a);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
 [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr h, int i, StringBuilder s, uint l, out uint n);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 static volatile bool halt; static Thread worker; public static int Samples; static readonly HashSet<string> desktops = new HashSet<string>(); static readonly HashSet<uint> foreground = new HashSet<uint>();
 static string Input() { IntPtr h = OpenInputDesktop(0, false, 1); if (h == IntPtr.Zero) return "unavailable"; try { var b = new StringBuilder(256); uint n; return GetUserObjectInformationW(h, 2, b, 512, out n) ? b.ToString() : "unavailable"; } finally { CloseDesktop(h); } }
 static void Loop() { while (!halt) { Samples++; lock (desktops) desktops.Add(Input()); uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); lock (foreground) foreground.Add(p); Thread.Sleep(25); } }
 public static void Start() { worker = new Thread(Loop); worker.IsBackground = true; worker.Start(); }
 public static string[] Halt() { halt = true; worker.Join(2000); var d = new List<string>(desktops); var f = new List<string>(); foreach (var x in foreground) f.Add(x.ToString()); return new[] { string.Join(",", d.ToArray()), string.Join(",", f.ToArray()) }; }
}
'@
[OmfAmexNativeMonitor]::Start()
$chrome = @{}; $command = $null
while (-not (Test-Path -LiteralPath $Stop)) {
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'")) { if ($p.CommandLine -and $p.CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $chrome[[string]$p.ProcessId] = $true; if ($p.CommandLine -notmatch '--type=') { $command = $p.CommandLine } } }
  Start-Sleep -Milliseconds 600
}
$r = [OmfAmexNativeMonitor]::Halt()
[ordered]@{ desktops = @($r[0] -split ',' | Where-Object { $_ }); foreground = @($r[1] -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ }); samples = [OmfAmexNativeMonitor]::Samples; chrome = @($chrome.Keys | ForEach-Object { [int]$_ }); command = $command } | ConvertTo-Json -Compress -Depth 4 | Set-Content -LiteralPath $Out -Encoding UTF8`;
async function startMonitor(dir, ownedRoot) {
  const script = path.join(dir, 'monitor.ps1'), out = path.join(dir, 'monitor.json'), stop = path.join(dir, 'monitor.stop');
  await writeFile(script, MONITOR, { flag: 'wx' });
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Out', out, '-Stop', stop, '-Root', ownedRoot], { windowsHide: true, stdio: 'ignore' });
  await sleep(1500);
  return { async stop() { await writeFile(stop, 'stop').catch(() => {}); for (let i = 0; i < 60 && child.exitCode === null; i++) await sleep(250); if (child.exitCode === null) child.kill(); try { return JSON.parse((await readFile(out, 'utf8')).replace(/^﻿/, '')); } catch { return null; } } };
}
// Owned Chrome still running (command line inside the owned root) and the helper's desktops still present (name prefix), read only.
async function audit(ownedRoot) {
  const r = await powershell(`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OmfAmexNativeAudit { public delegate bool Callback(string name, IntPtr unused); [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation(); [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDesktopsW(IntPtr s, Callback c, IntPtr u);
 public static string[] Desktops() { var list = new List<string>(); Callback cb = delegate (string n, IntPtr u) { if (n.StartsWith("OmfAmexNative")) list.Add(n); return true; }; EnumDesktopsW(GetProcessWindowStation(), cb, IntPtr.Zero); return list.ToArray(); } }
'@
$root = ${JSON.stringify(ownedRoot).replaceAll('$', '`$')}
$owned = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [int]$_.ProcessId })
[ordered]@{ chrome = $owned; desktops = @([OmfAmexNativeAudit]::Desktops()) } | ConvertTo-Json -Compress`);
  try { const v = JSON.parse(r.stdout.trim()); return { chrome: [].concat(v.chrome || []), desktops: [].concat(v.desktops || []) }; } catch { return { chrome: null, desktops: null, error: (r.stdout + r.stderr).slice(0, 300) }; }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function gone(ownedRoot, ms = 20000) { const started = Date.now(); let last; do { last = await audit(ownedRoot); if (last.chrome && !last.chrome.length && !last.desktops.length) return { ms: Date.now() - started, ...last }; await sleep(500); } while (Date.now() - started < ms); return { ms: null, ...last }; }

// ── one scenario: a runner child (the real wrapper, the real broker, the helper copy), the trigger of its fault, the audit, the verdict ─
async function runScenario(def, ctx) {
  const outer = await mkdtemp(path.join(TEMP, 'omf-amex-native-')), directory = path.join(outer, 'collector'), local = path.join(outer, 'local');
  await mkdir(directory); await mkdir(local);
  const r = { scenario: def.name, startedAt: new Date().toISOString(), root: outer, expect: typeof def.expect === 'string' ? def.expect : { ...def.expect, message: String(def.expect.message) }, measurement: def.measurement || null };
  const fileName = `omf-native-fixture-${base(def.name)}-${randomBytes(4).toString('hex')}.csv`;
  const sc = ctx.servers.begin(def, fixtureConfig(def, ctx.servers.origins, fileName));
  const account = { _id: 'f1'.repeat(12), ownerId: 'e2'.repeat(12), provider: 'amex', name: 'Fixture Amex', primaryCard: PRIMARY, cardIdentifiers: [PRIMARY], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid', jobId: randomUUID() };
  const params = { copy: ctx.copy.file, www: ctx.servers.origins.www, directory, account, login: LOGIN, origin: OMF, result: path.join(outer, 'runner-result.json'), inUse: !!def.inUse, refuseOwn: !!def.refuseOwn };
  const profile = path.join(directory, 'profiles', 'ephemeral', `${account.ownerId}-amex-${account._id}-native`);
  const holder = def.member ? sc.holder = await startHolder(outer, path.join(profile, 'omf-fixture-member.exe'), def.member.holdMs) : null;
  await writeFile(path.join(outer, 'runner.json'), JSON.stringify(params), { flag: 'wx' });
  const monitor = await startMonitor(outer, outer);
  const child = spawn(process.execPath, [SELF, '--runner', path.join(outer, 'runner.json')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LOCALAPPDATA: local, OMF_COLLECTOR_DIR: directory, OMF_KEY_BROKER: '' } });
  const progress = {}, stderr = []; let buffer = '';
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { Object.assign(progress, JSON.parse(line)); } catch { /* not progress */ } } });
  child.stderr.on('data', chunk => stderr.push(String(chunk)));
  const exited = new Promise(resolve => child.once('close', code => resolve(code)));
  let killed = null;
  if (def.kill) ctx.servers.events.once('statement', () => setTimeout(() => {
    killed = { kind: def.kill, at: Date.now() };
    try {
      if (def.kill === 'helper') process.kill(progress.helper);
      else if (def.kill === 'broker') process.kill(progress.broker);
      else if (def.kill === 'broker-end') child.stdin.write('end-broker\n');
      else if (def.kill === 'collector') child.kill();
    } catch (error) { killed.error = error.code || 'failed'; }
  }, 1500));
  const watchdog = setTimeout(() => { r.watchdog = true; child.kill(); }, 420000);
  r.exit = await exited; clearTimeout(watchdog); ctx.servers.events.removeAllListeners('statement');
  if (holder) { if (holder.said.pid) await Promise.race([holder.exited, sleep(def.member.holdMs + 60000)]); r.member = { ...holder.said }; await holder.stop(); }
  r.killed = killed; r.progress = progress; r.stderr = stderr.join('').slice(0, 2000);
  r.cleanup = await gone(outer);
  r.helperGone = progress.helper ? !alive(progress.helper) : null; r.brokerGone = progress.broker ? !alive(progress.broker) : null;
  r.facts = await monitor.stop();
  try { r.result = JSON.parse(await readFile(params.result, 'utf8')); } catch { r.result = null; }
  r.profileLeft = existsSync(profile);
  if (def.kill === 'collector' || def.expect.profileLeft) { const B = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href); r.recovery = await B.recoverEphemeral(directory).catch(error => ({ error: error.message })); r.profileAfterRecovery = existsSync(profile); }
  const jobDir = path.join(directory, 'outbox', account._id, account.jobId);
  r.jobFiles = existsSync(jobDir) ? await readdir(jobDir) : [];
  r.trace = await (async () => { try { const dir = path.join(directory, 'diagnostics', 'amex', account._id), [name] = (await readdir(dir)).filter(n => n.endsWith('.json')); const text = await readFile(path.join(dir, name), 'utf8'); return { text, record: JSON.parse(text) }; } catch { return null; } })();
  r.escaped = [fileName, fileName.replace(/\.csv$/, '.pdf')].filter(n => existsSync(path.join(ctx.downloads, n)));
  r.receipts = sc.receipts; r.cfgFile = fileName;
  if (r.result?.value?.manifest) { const m = r.result.value.manifest; try { r.file = { sha256: sha(await readFile(path.join(jobDir, m.filename))) }; } catch { r.file = null; } }
  r.judgement = await judge(def, r, account);
  r.finishedAt = new Date().toISOString();
  if (EVIDENCE) await writeFile(path.join(EVIDENCE, `NATIVE-${ctx.tag}-${def.name}.json`), JSON.stringify({ ...r, trace: r.trace?.record ?? null }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
  if (!r.judgement.pass && (r.cleanup.chrome?.length)) r.leftover = await powershell(`foreach ($p in @(${r.cleanup.chrome.join(',')})) { $x = Get-CimInstance Win32_Process -Filter "ProcessId = $p"; if ($x -and $x.CommandLine -and $x.CommandLine.IndexOf(${JSON.stringify(outer).replaceAll('$', '`$')}, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Stop-Process -Id $p -Force } }`).then(x => x.code);
  return r;
}
async function judge(def, r, account) {
  const rec = r.receipts, page = kind => rec.page.filter(p => p.kind === kind), err = r.result?.error?.message ?? null, csvRequests = rec.downloads.filter(d => d.format === 'csv').length;
  const opens = page('open-dialog'), steps = r.trace?.record.steps ?? [], openSteps = steps.filter(s => s.step === 'download-open'), helper = r.trace?.record.helper;
  const p = periods(), checks = {
    runnerReported: def.expect === 'crash' ? r.result === null : !!r.result, noWatchdog: !r.watchdog, noDecoyActivation: rec.decoy.length === 0, noEscapedDownload: r.escaped.length === 0,
    ownedChromeGone: Array.isArray(r.cleanup.chrome) && r.cleanup.chrome.length === 0, privateDesktopGone: Array.isArray(r.cleanup.desktops) && r.cleanup.desktops.length === 0,
    inputDesktopDefault: !!r.facts && r.facts.desktops.length === 1 && r.facts.desktops[0] === 'Default',
    ownedChromeNeverForeground: !!r.facts && !r.facts.foreground.some(pid => r.facts.chrome.includes(pid))
  };
  if (def.expect !== 'crash') Object.assign(checks, { helperEnded: r.helperGone !== false, profileRemoved: def.expect.profileLeft ? r.profileLeft === true : !r.profileLeft });
  // The record of the end. A helper that was killed proves nothing and claims nothing; every other job says what the helper could prove, inside the helper's own wait.
  if (!def.inUse && def.expect !== 'crash') {
    if (def.kill) checks.noEndClaimed = !!helper && [helper.end, helper.chromeEnded, helper.desktopClosed, helper.jobTerminated, helper.processesLeft, helper.membersKnown, helper.closeMs].every(v => v === null);
    else { const want = { chromeEnded: true, jobTerminated: true, processesLeft: 0, membersKnown: true, minMs: 0, maxMs: END_WAIT_MS + 3000, ...def.closure }; Object.assign(checks, { endRecorded: !!helper && helper.chromeEnded === want.chromeEnded && helper.jobTerminated === want.jobTerminated && helper.processesLeft === want.processesLeft && helper.membersKnown === want.membersKnown, endInsideItsWait: Number.isSafeInteger(helper?.closeMs) && helper.closeMs >= want.minMs && helper.closeMs <= want.maxMs }); }
  }
  if (def.member) checks.memberWasHeld = r.member?.pid > 0 && r.member?.exiting === true;
  if (!def.inUse && def.expect !== 'crash' && !['broker', 'broker-end'].includes(def.kill)) checks.chromeEndedBeforeBroker = r.result?.chromeBeforeBroker?.ms != null;
  if (!def.inUse && def.expect !== 'crash') Object.assign(checks, { ownedBeforeLaunch: r.result?.owned?.length === 1 && r.result.owned[0].ok === !def.refuseOwn && r.result.owned[0].pid === r.result.spawned?.[0]?.pid, traceWritten: !!r.trace && r.trace.record.schema === 'amex-native-trace-1' && r.trace.record.mode === 'private',
    traceValueFree: !!r.trace && ![LOGIN.username, LOGIN.password, '127.0.0.1', 'localhost', 'http', 'FIXTURE', '@', '?end='].some(leak => r.trace.text.includes(leak)) });
  const launched = !!r.facts?.command && !def.inUse; // the in-use holder is the owned headless DevTools Chrome, not the helper's
  if (launched) {
    const args = r.facts.command;
    Object.assign(checks, { runtimeArguments: ['--lang=ja-JP,ja', '--accept-lang=ja-JP,ja,en', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking'].every(a => args.includes(a)),
      noAutomationArguments: !/--enable-automation|--remote-debugging|--headless|--no-sandbox|--disable-web-security|--load-extension|--user-agent|--test-type/.test(args) });
    const loads = page('load').filter(l => l.surface === 'login');
    if (loads.length) Object.assign(checks, { pageLanguages: JSON.stringify(loads[0].languages) === JSON.stringify(['ja-JP', 'ja', 'en']), notWebdriver: loads[0].webdriver === false, acceptLanguage: rec.document[0]?.acceptLanguage === 'ja-JP,ja;q=0.9,en;q=0.8' });
  }
  const complete = def.expect === 'complete' || def.expect === 'complete-older';
  if (complete) {
    const target = def.expect === 'complete-older' ? p.older : p.latest, m = r.result?.value?.manifest;
    const served = base(def.name) === 'positive-blob' ? sha(csvBytes(csvText(rowsOf(target, target.total)))) : rec.downloads.find(d => d.format === 'csv')?.sha256;
    Object.assign(checks, { completed: !err && !!m, manifestFields: !!m && m.accountId === account._id && m.jobId === account.jobId && m.primaryCard === PRIMARY && m.ownerId === account.ownerId && m.origin === OMF && m.kind === 'statement', selectedPeriod: m?.end === target.end && m?.start === target.start, pageCount: m?.pageCount === target.total,
      fileMatchesServedBytes: !!served && r.file?.sha256 === served && m?.sha256 === served, outboxShape: r.jobFiles.length === 2 && r.jobFiles.includes('manifest.json') && r.jobFiles.includes(m?.filename), oneSignIn: rec.logins.length === 1 && rec.logins[0].user && rec.logins[0].password,
      trustedSubmit: page('submit').length === 1 && page('submit')[0].trusted === true, oneTrustedDownloadClick: page('download-click').length === 1 && page('download-click')[0].trusted === true && page('download-click')[0].format === 'csv',
      csvRequests: csvRequests === (base(def.name) === 'positive-blob' ? 0 : 1), trustedNavigation: page('navigate').length === 1 && page('navigate')[0].trusted === true, trustedCsvChoice: page('format').some(f => f.format === 'csv' && f.trusted === true),
      traceCompleted: r.trace?.record.outcome === 'completed', iconOpenedOnce: openSteps.length === 1 && openSteps[0].outcome === 'ok' && (def.opens === 0 ? opens.length === 0 : opens.length === 1 && opens[0].trusted === true) });
    if (def.opens === 0) checks.noActionRecorded = steps.some(s => s.step === 'download-already-open');
    if (def.otp !== false) Object.assign(checks, { oneCodeRequest: rec.codeRequests === 1, codeAccepted: rec.codeChecks.length === 1 && rec.codeChecks[0] === true });
    if (def.expect === 'complete-older') checks.foreignNeverRequested = rec.decoyArrivals.filter(a => a.path === '/activity/statement').length === 0;
    // the in-page statementSnapshot of the same page (the REAL module): its decision, beside the native one
    const dom = [...rec.page].reverse().find(x => x.kind === 'dom' && x.label === (def.domLabel ?? 'period'));
    r.domDecision = dom ? await decideDom(dom.snapshot, target) : null;
    if (def.measurement) checks.divergenceMeasured = r.domDecision?.ok === false && /does not match this connection/.test(r.domDecision.message);
    else checks.domAgrees = r.domDecision?.ok === true && r.domDecision.value === target.total;
  } else if (def.expect === 'crash') {
    Object.assign(checks, { collectorKilled: r.killed?.kind === 'collector' && !r.killed.error, helperEndedAfterCollector: r.helperGone === true, brokerEndedAfterCollector: r.brokerGone === true, chromeGoneWithin: r.cleanup.ms !== null, startupRecoveryRemovedProfile: r.profileAfterRecovery === false, noManifest: !r.jobFiles.includes('manifest.json') });
  } else {
    const e = def.expect;
    Object.assign(checks, { failed: !!err, expectedMessage: e.message instanceof RegExp ? e.message.test(err || '') : err === e.message || (typeof e.message === 'string' && err?.startsWith(e.message)), noManifest: e.manifestKept ? r.jobFiles.includes('manifest.json') : !r.jobFiles.includes('manifest.json') });
    if (e.manifestKept) Object.assign(checks, { traceCompleted: r.trace?.record.outcome === 'completed', fileKeptForUpload: r.jobFiles.length === 2, startupRecoveryRemovedProfile: r.profileAfterRecovery === false });
    if (e.periodStops) { const sent = steps.filter(s => s.step === 'invoke-period'); checks.periodStoppedOnce = sent.length === 1 && !!e.periodStops[sent[0].outcome]?.includes(sent[0].code); }
    if (e.watchdog) checks.watchdogEnd = helper?.end === 'uia_watchdog' && helper.exit === 3;
    if (e.noChrome) checks.noChromeStarted = !r.facts?.command;
    if (e.launchCode) checks.launchRefusedWith = steps.find(s => s.step === 'launch')?.code === e.launchCode;
    if (e.before) Object.assign(checks, { noDownloadRequest: rec.downloads.length === 0, noDownloadClick: page('download-click').length === 0 });
    if (e.noNavigation) checks.noNavigation = page('navigate').length === 0;
    if (e.clicked) Object.assign(checks, { oneTrustedDownloadClick: page('download-click').length === 1 && page('download-click')[0].trusted === true, noDownloadRequest: rec.downloads.length === 0 });
    if (e.file) Object.assign(checks, { oneCsvRequest: csvRequests === 1, fileKeptOutOfListing: r.jobFiles.length === 1 && r.jobFiles[0].startsWith('download-') });
    if (e.refused) Object.assign(checks, { refusedBeforeActing: openSteps.length === 1 && openSteps[0].outcome === 'error' && [].concat(e.refused).includes(openSteps[0].code), iconNeverClicked: opens.length === 0 });
    if (e.uncertain) Object.assign(checks, { uncertainOnce: openSteps.length === 1 && openSteps[0].outcome === 'uncertain' && openSteps[0].code === e.uncertain, nothingAfterIt: page('format').length === 0, iconNeverClicked: opens.length === 0 });
    if (e.sentOnce) checks.iconClickedOnce = openSteps.length === 1 && openSteps[0].outcome === 'ok' && opens.length === 1 && opens[0].trusted === true;
    if (e.oneLogin) checks.oneSignIn = rec.logins.length === 1;
    if (e.noCodeRequest) checks.noCodeRequest = rec.codeRequests === 0;
    if (e.notStarted) Object.assign(checks, { setupReady: !!r.result && !r.result.setupFailure, noHelper: !r.result?.spawned?.length, noIssuerRequest: rec.arrivals.length === 0 });
    if (e.kill) Object.assign(checks, { faultInjected: !!r.killed && !r.killed.error, chromeGoneWithin: r.cleanup.ms !== null });
    if (def.measurement) { const dom = [...rec.page].reverse().find(x => x.kind === 'dom' && x.label === 'initial'); r.domInitialCards = dom?.snapshot?.cards ?? null; checks.divergenceMeasured = JSON.stringify(r.domInitialCards) === JSON.stringify(['-' + PRIMARY]); }
  }
  return { checks, pass: Object.values(checks).every(Boolean) };
}
function decideDom(snapshot, target) {
  const rebase = url => { try { const u = new URL(url, 'https://global.americanexpress.com'); return 'https://global.americanexpress.com' + u.pathname + u.search; } catch { return url; } };
  const selected = { kind: 'statement', start: target.start, end: target.end, key: `statement:${target.start}:${target.end}` };
  return import(pathToFileURL(path.join(root, 'collector', 'statement.mjs')).href).then(S => { try { return { ok: true, value: S.verifyStatement({ ...snapshot, url: rebase(snapshot.url) }, selected, PRIMARY) }; } catch (e) { return { ok: false, message: e.message }; } });
}

// The owned Chrome processes still running (command line inside `dir`), polled up to `ms`: { left, ms } once none is left, else the last list.
async function ownedChromeLeft(dir, ms) {
  const started = Date.now(); let left = null;
  do { const r = await powershell(`$d = ${JSON.stringify(path.resolve(dir)).replaceAll('$', '`$')}; @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [int]$_.ProcessId }) | ConvertTo-Json -Compress`); try { left = [].concat(JSON.parse(r.stdout.trim() || '[]')); } catch { left = null; } if (left && !left.length) return { left: [], ms: Date.now() - started }; await sleep(500); } while (Date.now() - started < ms);
  return { left, ms: null };
}
// ── the runner child: the real wrapper, broker and native module; the helper is the policy copy ─────────────────────────────────────────
async function runner(file) {
  const p = JSON.parse(await readFile(file, 'utf8')), progress = value => process.stdout.write(JSON.stringify(value) + '\n');
  const B = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href), N = await import(pathToFileURL(path.join(root, 'collector', 'amex-native.mjs')).href), V = await import(pathToFileURL(path.join(root, 'collector', 'vault.mjs')).href);
  const env = { ...process.env }; delete env.OMF_KEY_BROKER;
  const broker = await V.startBroker('owner', { env });
  const report = { spawned: [], owned: [], statuses: [], value: null, error: null, brokerJob: broker.readyState?.job === true };
  progress({ broker: broker.child.pid });
  process.stdin.on('data', chunk => { if (String(chunk).includes('end-broker')) broker.end().catch(() => {}); });
  N.nativeHost.spawn = args => { const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', p.copy, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); report.spawned.push({ pid: child.pid, mode: args[args.indexOf('-Mode') + 1] }); progress({ helper: child.pid }); return child; };
  N.nativeHost.mailbox = () => ({ async verify() {}, async find(_account, _since, used) { const issued = await fetch(p.www + '/test/issued-code').then(x => x.json()); return issued.code && !used.includes(issued.id) ? { id: issued.id, code: issued.code } : null; } });
  const onLaunch = async ({ pid, browser }) => { if (p.refuseOwn) { report.owned.push({ pid, browser, ok: false }); throw new Error('The batch could not take ownership of the browser'); } const reply = await broker.request('own', { pid }, 30000); report.owned.push({ pid, browser, ok: reply.ok === true, assigned: reply.assigned }); progress({ owned: pid }); if (!reply.ok) throw new Error('The batch could not take ownership of the browser'); };
  let holder = null;
  // The test's precondition, not the operation under test: its failure keeps the error's facts and fails the scenario as setupReady, never as the refusal the scenario expects.
  if (p.inUse) { const profile = B.ephemeralProfile(p.directory, p.account.ownerId, 'amex', p.account._id, 'native'); try { holder = await B.browserFor(profile, { ephemeral: true, root: p.directory, headless: true }); } catch (error) { report.setupFailure = { message: String(error?.message).slice(0, 300), code: error?.code ?? null, killed: error?.killed ?? null, signal: error?.signal ?? null }; } }
  if (!report.setupFailure) try { report.value = await B.collectStatement(p.account, p.login, p.directory, async (state, text) => { report.statuses.push([state, text]); }, { gmail: { fixture: 'the mailbox seam answers; no OAuth client is built' }, batch: 'native', onLaunch, origin: p.origin }); }
  catch (error) { report.error = { message: String(error?.message), code: error?.code ?? null }; }
  if (holder) await B.closeOwnedBrowsers();
  report.chromeBeforeBroker = await ownedChromeLeft(p.directory, 15000);
  await broker.end().catch(() => {});
  await writeFile(p.result, JSON.stringify(report), { flag: 'wx' });
  process.exit(0);
}

// The unit test on the unchanged adapter (its control), then on each defect's copy beside the original. The copy is removed whatever happens.
async function adapterDefects(tag) {
  const module = path.join(root, 'collector', 'amex-native.mjs'), source = await readFile(module, 'utf8'), test = path.join('collector', 'test', 'amex-native.test.mjs'), env = { ...process.env, TEMP, TMP: TEMP };
  const unit = extra => execute(process.execPath, ['--test', test], { cwd: root, env: { ...env, ...extra }, timeout: 300000 });
  const control = await unit({});
  if (control.code !== 0) return { pass: false, line: 'RED the control failed: ' + (control.stdout + control.stderr).slice(-400) };
  const caught = [], missed = [], receipts = [{ label: 'control', code: control.code }];
  for (const [label, edits, expected] of ADAPTER_DEFECTS) {
    let text = source; for (const [a, b] of edits) { const n = text.split(a).length - 1; if (n !== 1) throw new Error(label + ' anchor hits ' + n); text = text.replace(a, () => b); }
    const copy = path.join(root, 'collector', 'amex-native.mutant-' + randomUUID().slice(0, 8) + '.mjs');
    try { await writeFile(copy, text, { flag: 'wx' }); const r = await unit({ OMF_TEST_NATIVE_MODULE: copy }), output = r.stdout + r.stderr, hit = r.code !== 0 && expected.test(output); (hit ? caught : missed).push(label); receipts.push({ label, code: r.code, caught: hit }); }
    finally { await rm(copy, { force: true }); }
    console.error(JSON.stringify({ adapterMutant: label, caught: caught.includes(label) }));
  }
  if (EVIDENCE) await writeFile(path.join(EVIDENCE, `NATIVE-RUNTIME-ADAPTER-${tag}.json`), JSON.stringify(receipts, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
  return { pass: !missed.length, line: caught.length + '/' + ADAPTER_DEFECTS.length + ' caught' + (missed.length ? '; RED ' + missed.join('; ') : '') };
}
const fixture = { name: 'omf-amex-native', covers: PARTIAL ? [] : COVERS, async run() {
  const started = Date.now(), lines = [], tag = new Date().toISOString().replace(/[:.]/g, '-');
  const want = leg => !LEGS.length || LEGS.includes(leg);
  if (process.platform !== 'win32') return { pass: false, message: 'Windows, installed Chrome and UI Automation are required' };
  const chrome = (await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href)).findChrome();
  if (!chrome) return { pass: false, message: 'SETUP no installed Chrome' };
  const downloads = (await powershell("(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path")).stdout.trim();
  const work = await mkdtemp(path.join(TEMP, 'omf-amex-native-run-')), servers = await startServers();
  let pass = true; const results = [], measured = { positive: 0, completed: 0, failures: [], tolerated: {} };
  const ctx = { servers, downloads, tag, copy: await policyCopy(work, servers.origins.www, servers.origins.global) };
  const editedCopy = (label, edits) => policyCopy(work, servers.origins.www, servers.origins.global, { edit: text => { let out = text; for (const [a, b] of edits) { const n = out.split(a).length - 1; if (n !== 1) throw new Error(label + ' anchor hits ' + n); out = out.replace(a, () => b); } return out; } });
  try {
    if (want('P')) {
      const text = await readFile(SCRIPT, 'utf8'), eol = text.includes('\r\n') ? '\r\n' : '\n', B = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href);
      const pins = { productionPolicy: ctx.copy.production === PRODUCTION_POLICY.join(eol), ascii: !/[^\x00-\x7f]/.test(text), launchList: text.includes(` const string Arguments = "${[...B.PLAIN_LANGUAGE_ARGS].join(' ')}";`), oneCreateProcess: text.split('CreateProcessW(executable').length === 2, noSwitchDesktop: !/SwitchDesktop|SetForegroundWindow|SetFocus\(|SendInput|keybd_event|mouse_event|BlockInput/.test(text), oneExpand: text.split('.Expand()').length === 2, neverCollapse: !text.includes('.Collapse('), copyDiffersOnlyInPolicy: true };
      const ok = Object.values(pins).every(Boolean); if (!ok) pass = false;
      lines.push('P policy copy and pins: ' + (ok ? 'green ' : 'RED ') + JSON.stringify(pins));
    }
    const list = want('N') ? SCENARIOS.filter(s => !ONLY.length || ONLY.includes(s.name)) : [];
    const repeated = SCENARIOS.filter(s => POSITIVE.includes(s.name));
    const repeats = want('R') ? Array.from({ length: REPEATS }, (_, k) => repeated.map(s => ({ ...s, name: s.name + '~' + (k + 1) }))).flat() : [];
    for (const def of [...list, ...repeats]) {
      let r; try { r = await runScenario(def, def.helper ? { ...ctx, copy: await editedCopy(def.name, def.helper) } : ctx); } catch (error) { r = { scenario: def.name, harnessFailure: String(error?.stack || error).slice(0, 600), judgement: { pass: false, checks: {} } }; }
      const failed = Object.entries(r.judgement.checks).filter(([, v]) => !v).map(([k]) => k);
      results.push({ scenario: def.name, pass: r.judgement.pass, failed, error: r.result?.error?.message ?? null, harness: r.harnessFailure ?? null });
      if (!r.judgement.pass) pass = false;
      if (POSITIVE.includes(base(def.name))) { measured.positive++; if (r.judgement.pass) measured.completed++; else measured.failures.push({ scenario: def.name, failed, error: r.result?.error?.message ?? null }); for (const [code, n] of Object.entries(r.trace?.record?.tolerated || {})) measured.tolerated[code] = (measured.tolerated[code] || 0) + n; }
      console.error(JSON.stringify(results.at(-1)));
    }
    if (want('M')) {
      const caught = [], missed = [];
      for (const [label, edits, scenario] of HELPER_DEFECTS) {
        const def = SCENARIOS.find(s => s.name === scenario), control = results.find(x => x.scenario === scenario);
        if (!control?.pass) { missed.push(label + ': its control ' + scenario + ' did not run green in this run (leg N)'); continue; }
        const copy = await editedCopy(label, [...(def.helper ?? []), ...edits]);
        let r; try { r = await runScenario({ ...def, name: scenario + '~' + label }, { ...ctx, copy, tag: tag + '-M' }); } catch (error) { r = { harnessFailure: String(error?.message || error), judgement: { pass: true, checks: {} } }; }
        const failed = Object.entries(r.judgement.checks).filter(([, v]) => !v).map(([k]) => k);
        if (r.judgement.pass || r.harnessFailure) missed.push(label + ' not caught' + (r.harnessFailure ? ' (harness: ' + r.harnessFailure.slice(0, 200) + ')' : '')); else caught.push(label + '→' + failed.slice(0, 4).join('+') + (r.result?.error?.message ? ' (' + r.result.error.message.slice(0, 60) + ')' : ''));
        console.error(JSON.stringify({ mutant: label, caught: !r.judgement.pass && !r.harnessFailure, failed }));
      }
      if (missed.length) pass = false;
      lines.push('M helper defects: ' + caught.length + '/' + HELPER_DEFECTS.length + ' caught' + (caught.length ? ': ' + caught.join('; ') : '') + (missed.length ? '; RED ' + missed.join('; ') : ''));
      const adapter = await adapterDefects(tag);
      if (!adapter.pass) pass = false;
      lines.push('M adapter defects: ' + adapter.line);
      const held = [], broke = [];
      for (const [label, edits, scenario] of HELPER_STRESS) {
        const def = SCENARIOS.find(s => s.name === scenario);
        const copy = await editedCopy(label, edits);
        let r; try { r = await runScenario({ ...def, name: scenario + '~' + label }, { ...ctx, copy, tag: tag + '-M' }); } catch (error) { r = { harnessFailure: String(error?.message || error), judgement: { pass: false, checks: {} } }; }
        if (r.judgement.pass) held.push(label); else { broke.push(label + ' (' + String(r.harnessFailure || r.result?.error?.message).slice(0, 80) + ')'); pass = false; }
        console.error(JSON.stringify({ stress: label, held: r.judgement.pass, error: r.result?.error?.message ?? null }));
      }
      lines.push('M helper stress: ' + held.length + '/' + HELPER_STRESS.length + ' held' + (broke.length ? '; RED ' + broke.join('; ') : ''));
    }
    if (list.length || repeats.length) lines.push('N/R scenarios: ' + results.filter(x => x.pass).length + '/' + results.length + ' green; positive flows completed ' + measured.completed + '/' + measured.positive + '; reads tolerated ' + JSON.stringify(measured.tolerated) + (results.some(x => !x.pass) ? '; RED ' + JSON.stringify(results.filter(x => !x.pass)) : ''));
  } finally { await servers.close(); }
  const summary = { tag, chrome, results, measured, lines, pass };
  if (EVIDENCE) await writeFile(path.join(EVIDENCE, `NATIVE-RUNTIME-${tag}.json`), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
  return { pass, measured, results, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's' + (PARTIAL ? ' (PARTIAL development run — no coverage exported)' : '') + '\n' + lines.join('\n') };
} };
export default fixture;

if (process.argv.includes('--runner')) {
  await runner(process.argv[process.argv.indexOf('--runner') + 1]).catch(async error => { process.stderr.write(String(error?.stack || error) + '\n'); process.exit(1); });
} else if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const result = await fixture.run();
  console.log(result.message); process.exitCode = result.pass ? 0 : 1;
}

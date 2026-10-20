// Fixture for plan omf-rakuten-auto-login-20261021 (5-plan.json): the saved 楽天銀行 standard login — automatic sign-in on the
// exact recorded public login form, repeat retrievals, the bank's refusal remembered without a retry storm, the additional-
// verification lane in the SAME owned window, background (non-foreground, cursor-free) operation, the one-time protected local
// setup, the bank-only wrapped-key binding, the package. Run ONLY through the hub verifier (never directly; a direct run dropped
// the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-rakuten-auto-login.mjs --cwd <this worktree>
// Evidence basis, stated exactly: synthetic only. A fake portal is served by request interception at https://fes.rakuten-bank.co.jp
// inside the collector's owned Chrome (stock Chrome of this host, HEADED for the background/attention legs, headless for the form
// table); interception is installed through the collector's own onLaunch hand-over before the first page, every other request is
// aborted — no network, no bank, no real credential (fictional IDs/passwords only). The built app runs on owned ephemeral
// MongoDBs (scripts/collector-security-integration.ts, scripts/finance-rakuten-auto-login-integration.cjs). Nothing here is a live
// login or an actual collector run; those remain the parent's owner setup and repeat collection.
// Fail-first on 74e6356 (behaviour, not a missing file): A1 the existing bank entry (runBankJob → collectBankStatement) given a
// fictional saved login asks the person to sign in (verification_required) instead of submitting it; K/N a correctly
// owner/device-scoped 楽天銀行 wrapped key is refused by the shared key binding (binding:service, 400).
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3600000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = p => access(p).then(() => true, () => false);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const u = rel => pathToFileURL(path.join(root, rel)).href;
// The plan's fixture.covers (every change site) plus the new files of this build.
const COVERS = ['collector/banks/rakuten.mjs', 'collector/bank.mjs', 'collector/index.mjs', 'collector/browser.mjs', 'collector/setup.html', 'collector/setup.js', 'collector/package/stage.mjs', 'server/services/financeCollectorSecurityService.ts', 'server/services/financeBankCollectionService.ts', 'server/api/finance-payments/collector/[...path].ts', 'components/intake/BankConnections.vue', 'collector/test/rakuten-standard.test.mjs', 'collector/test/browser-boundary.test.mjs', 'collector/test/startup.test.mjs', 'scripts/collector-security-integration.ts', 'scripts/finance-bank-collection-integration.cjs', 'scripts/zoomer-fixtures/omf-bank-collection.mjs', 'scripts/zoomer-fixtures/omf-rakuten-bank-connector.mjs', 'docs/rakuten-bank-connection.md', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs', 'scripts/finance-rakuten-auto-login-integration.cjs', 'scripts/zoomer-fixtures/omf-rakuten-auto-login.mjs'];
// The parent checkout's cached mongod (this worktree resolves packages from there); without it mongodb-memory-server would download.
const MONGOD = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => existsSync(p)) || null;

// ── The fake portal: the recorded public login form (LIVE-LOGIN-CONTRACT/CONTROLS), its variants, the bank's answers ──
const HOST = 'fes.rakuten-bank.co.jp', ORIGIN = 'https://' + HOST, CORP = '/XMS/security/RbS', LOGIN_ACTION = '/XMS/security/fcs/rb/fes/views/mainservice/Security/LoginAuthentication/Login/CorpLogin.xhtml';
const OTHER_LOGIN_PATH = '/XMS/security/Login', FRAME_PATH = '/XMS/security/frame';
const OVERVIEW = '/XMS/inquiry/gns', STATEMENT = '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/BalanceInquiry/BalanceInquiry/BalanceInquiry.xhtml', DOWNLOAD = '/XMS/inquiry/fcs/rb/fes/views/mainservice/Inquiry/CreditDebitInquiry/CreditDebitInquiry/CreditDebitInquiry.xhtml';
const F = 'FORM_DOWNLOAD_AP_2', IDS = ['EXPECTED_DATE_FROM_YEAR', 'EXPECTED_DATE_FROM_MONTH', 'EXPECTED_DATE_FROM_DAY', 'EXPECTED_DATE_TO_YEAR', 'EXPECTED_DATE_TO_MONTH', 'EXPECTED_DATE_TO_DAY'].map(x => F + ':' + x);
const NATIVE_BUTTON = F + ':j_id_6n6', ZENGIN_BUTTON = F + ':j_id_6n9', ACCOUNT_LABEL = '普通 1234567 カクウホールディングス';
const FICT = Object.freeze({ username: 'fictional-corp-user', password: 'Fictional-Pass-0001' });
const CSV = Buffer.from('取引日,入出金(円),残高(円),入出金先内容\r\n20251201,250000,2250000,振込 カクウ\r\n');
const html = body => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
const SCRIPT = `<script>window.__typed=0;window.__clicks=0;document.addEventListener('input',()=>{window.__typed++;},true);document.addEventListener('click',()=>{window.__clicks++;},true);document.querySelectorAll('a.btn').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();a.closest('form').submit();}));</script>`;
// A login document: the exact recorded shape, or one named deviation (the strict-form table).
function loginDoc(v = {}, error = '') {
  const action = v.action || LOGIN_ACTION, user = v.user || 'LOGIN:USER_ID', method = v.method || 'post';
  const fields = `<label>ユーザID <input id="${user}" name="${user}" type="text"></label> <label>ログインパスワード <input id="LOGIN:LOGIN_PASSWORD" name="LOGIN:LOGIN_PASSWORD" type="${v.passwordType || 'password'}"></label>${v.pin ? ' <label>取引暗証番号 <input id="LOGIN:TRANSFER_PIN" name="LOGIN:TRANSFER_PIN" type="password"></label>' : ''}`;
  const controls = v.controls === 0 ? '<a href="#" class="btn">ログインする</a>' : Array.from({ length: v.controls ?? 1 }, () => '<a href="#" class="btn">ログイン</a>').join(' ');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行へようこそ</title><body>
<form id="TAB_FORM" name="TAB_FORM" method="post" action="${LOGIN_ACTION}"><a href="#" onclick="return false">個人のお客さま</a> <a href="#" onclick="return false">法人のお客さま</a>${v.fieldsIn === 'TAB_FORM' ? ' ' + fields : ''}</form>
<form id="SECURITY_BOARD" name="SECURITY_BOARD" method="post" action="${LOGIN_ACTION}" style="display:none"><input type="hidden" name="SECURITY_BOARD_SUBMIT" value="1">${v.duplicateUser ? '<input name="LOGIN:USER_ID" type="text">' : ''}</form>
${error ? `<p id="login-error">${error}</p>` : ''}<form id="LOGIN" name="LOGIN" method="${method}" action="${action}">${v.fieldsIn ? '' : fields} <a id="LOGIN:j_id_1p" name="LOGIN:j_id_1p" href="#" onclick="return false">パスワードについて</a> ${controls}<input type="hidden" name="LOGIN_SUBMIT" value="1"></form>
<form id="LOGINPASSWORD_FORM_3" name="LOGINPASSWORD_FORM_3" method="post" action="${LOGIN_ACTION}" style="display:none"><input type="password" name="LOGINPASSWORD_FORM_3:OLD"></form>${SCRIPT}</body></html>`;
}
const VARIANTS = {
  exact: {}, 'other-path': { at: OTHER_LOGIN_PATH }, 'foreign-action': { action: 'https://login.evil.example' + LOGIN_ACTION }, 'other-form': { fieldsIn: 'TAB_FORM' }, 'duplicate-user': { duplicateUser: true },
  pin: { pin: true }, 'two-controls': { controls: 2 }, 'no-control': { controls: 0 }, renamed: { user: 'LOGIN:USER_CODE' }, 'get-method': { method: 'get' }, 'text-password': { passwordType: 'text' }, frame: { frame: true }
};
const overviewDoc = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行 法人ビジネス口座</title><body><a href="#">ログアウト</a> <a href="#">登録情報の照会・変更</a> <a id="statements" href="${STATEMENT}">入出金明細</a>${SCRIPT}</body></html>`;
const verifyDoc = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>追加認証</title><body><h1>追加認証</h1><p>登録のメールアドレスに送信した認証コードを入力してください</p><input id="otp" type="tel"><button id="verify" onclick="location.href='${OVERVIEW}'">認証する</button>${SCRIPT}</body></html>`;
const expiredDoc = () => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログインパスワードの変更</title><body><h1>ログインパスワードの有効期限が切れています</h1><form id="PWCHANGE" name="PWCHANGE" method="post" action="/XMS/security/pwchange"><input type="password" name="PWCHANGE:NEW"> <input type="password" name="PWCHANGE:CONFIRM"> <button type="submit">変更する</button></form>${SCRIPT}</body></html>`;
function statementDoc() {
  const select = (id, from, to, value) => `<select id="${id}" name="${id}">${Array.from({ length: to - from + 1 }, (_, i) => from + i).map(n => `<option value="${n}"${n === value ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const text = (id, value, max) => `<input id="${id}" name="${id}" type="text" maxlength="${max}" value="${value}">`;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>入出金明細</title><body><a href="#">ログアウト</a> <a href="#">登録情報の照会・変更</a><div id="account">${ACCOUNT_LABEL}</div>
  <form id="${F}" name="${F}" method="post" action="${DOWNLOAD}"><p>照会期間</p>${select(IDS[0], 2016, 2026, 2026)}年${select(IDS[1], 1, 12, 7)}月${select(IDS[2], 1, 31, 22)}日 〜 ${text(IDS[3], 2026, 4)}年${text(IDS[4], '10', 2)}月${text(IDS[5], '20', 2)}日
  <section><h3>楽天銀行フォーマット</h3><input type="submit" id="${NATIVE_BUTTON}" name="${NATIVE_BUTTON}" value="CSVダウンロード"></section><section><h3>全銀フォーマット</h3><input type="submit" id="${ZENGIN_BUTTON}" name="${ZENGIN_BUTTON}" value="CSVダウンロード"></section><input type="hidden" name="${F}_SUBMIT" value="1"></form></body></html>`;
}
// One portal shared by every page: mode ok|reject|verify|expired|authenticated, a login-form variant, the recorded traffic.
function portal() {
  const s = { mode: 'ok', variant: {}, password: FICT.password, loginPosts: [], loginGets: 0, foreign: [], exports: 0, requests: 0, pages: [] };
  s.respond = request => {
    const url = request.url(); s.requests++; let parsed; try { parsed = new URL(url); } catch { return request.abort(); }
    if (parsed.origin !== ORIGIN) { s.foreign.push({ origin: parsed.origin, method: request.method() }); return request.abort(); }
    const v = s.variant;
    if (parsed.pathname === CORP) {
      if (s.mode === 'authenticated') return request.respond(html(overviewDoc()));
      if (v.at) return request.respond(html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行</title><body><script>location.replace(${JSON.stringify(v.at)})</script></body></html>`));
      if (v.frame) return request.respond(html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>楽天銀行へようこそ</title><body><iframe src="${FRAME_PATH}" style="width:900px;height:600px" title="login"></iframe></body></html>`));
      return request.respond(html(loginDoc(v)));
    }
    if (parsed.pathname === OTHER_LOGIN_PATH || parsed.pathname === FRAME_PATH) return request.respond(html(loginDoc(v)));
    if (parsed.pathname === LOGIN_ACTION && request.method() === 'GET') { s.loginGets++; return request.respond(html(loginDoc(v, 'エラー'))); }
    if (parsed.pathname === LOGIN_ACTION && request.method() === 'POST') {
      const body = new URLSearchParams(request.postData() || ''), ok = body.get('LOGIN:USER_ID') === FICT.username && body.get('LOGIN:LOGIN_PASSWORD') === s.password;
      s.loginPosts.push({ ok, fields: [...body.keys()].sort() });
      if (s.mode === 'reject' || !ok) return request.respond(html(loginDoc(v, 'ユーザIDまたはログインパスワードが正しくありません')));
      if (s.mode === 'error') return request.respond(html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>エラー</title><body>処理できませんでした</body></html>'));
      if (s.mode === 'unknown') return request.respond(html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>処理中</title><body>確認中です</body></html>'));
      if (s.mode === 'verify') return request.respond(html(verifyDoc()));
      if (s.mode === 'expired') return request.respond(html(expiredDoc()));
      return request.respond(html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン中</title><body><p>ログインしています…</p><script>location.replace(${JSON.stringify(OVERVIEW)})</script></body></html>`));
    }
    if (parsed.pathname === OVERVIEW) return request.respond(html(overviewDoc()));
    if (parsed.pathname === STATEMENT) return request.respond(html(statementDoc()));
    if (parsed.pathname === DOWNLOAD && request.method() === 'POST') { s.exports++; return request.respond({ status: 200, contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="RB-torihikimeisai.csv"' }, body: CSV }); }
    return request.abort();
  };
  // Installed through the collector's own onLaunch hand-over, before its first page: every page is intercepted from about:blank on.
  s.onLaunch = (launches, extra = null) => async ({ pid, browser }) => { launches.push({ pid, browser }); await extra?.({ pid, browser }); const original = browser.newPage.bind(browser); browser.newPage = async () => { const page = await original(); await page.setRequestInterception(true); page.on('request', r => s.respond(r)); s.pages.push(page); return page; }; };
  return s;
}

// ── Window facts of an owned Chrome process (user32 through PowerShell; reads only — no window of any process is moved) ──
const WIN_PS = `param([int]$ProcessId)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OmfWinFacts {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static List<string> Windows(uint want) { var list = new List<string>(); EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == want && IsWindowVisible(h)) { RECT r; GetWindowRect(h, out r); var c = new StringBuilder(256); GetClassName(h, c, 256); list.Add(string.Format("{{\\"cls\\":\\"{0}\\",\\"iconic\\":{1},\\"rect\\":[{2},{3},{4},{5}]}}", c.ToString(), IsIconic(h) ? "true" : "false", r.L, r.T, r.R, r.B)); } return true; }, IntPtr.Zero); return list; }
}
'@
$fg = [OmfWinFacts]::GetForegroundWindow(); [uint32]$fp = 0; [void][OmfWinFacts]::GetWindowThreadProcessId($fg, [ref]$fp)
$p = New-Object OmfWinFacts+POINT; [void][OmfWinFacts]::GetCursorPos([ref]$p)
$vx = [OmfWinFacts]::GetSystemMetrics(76); $vy = [OmfWinFacts]::GetSystemMetrics(77); $vw = [OmfWinFacts]::GetSystemMetrics(78); $vh = [OmfWinFacts]::GetSystemMetrics(79)
$w = [OmfWinFacts]::Windows([uint32]$ProcessId) -join ','
"{\`"foregroundPid\`":$fp,\`"cursor\`":[$($p.X),$($p.Y)],\`"screen\`":[$vx,$vy,$($vx+$vw),$($vy+$vh)],\`"windows\`":[$w]}"
`;
const intersects = (r, s) => r[0] < s[2] && r[2] > s[0] && r[1] < s[3] && r[3] > s[1];
const onScreen = facts => facts.windows.filter(w => w.cls === 'Chrome_WidgetWin_1' && !w.iconic && intersects(w.rect, facts.screen) && w.rect[2] - w.rect[0] > 200 && w.rect[3] - w.rect[1] > 200);

// A fictional saved login with the interface collector/bank.mjs expects (state/open/rejected/accepted), counting every call.
function savedLogin({ state = 'ready', onOpen = null, openError = null } = {}) {
  const calls = { state: 0, open: 0, rejected: 0, accepted: 0 }; let current = state;
  return { calls, async state() { calls.state++; return current; }, async open() { calls.open++; await onOpen?.(); if (openError) throw openError; return { ...FICT }; }, async rejected() { calls.rejected++; current = 'blocked'; }, async accepted() { calls.accepted++; current = 'ready'; } };
}
const ACCOUNT = { _id: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4', name: 'Fictional Rakuten' };
const SNAPSHOT = { templateId: 'e5e5e5e5e5e5e5e5e5e5e5e5', templateRevision: 1, headers: ['取引日', '入出金(円)', '残高(円)', '入出金先内容'], mapping: { date: '0', description: '3', amount: '1', balance: '2' }, amountSign: 'outflow-negative', transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'rakuten', accountLabel: 'カクウホールディングス', variant: 'standard', coverage: { from: '2025-11-01', to: '2026-10-01' } };
const jobOf = () => ({ jobId: randomUUID(), kind: 'retrieve', snapshot: SNAPSHOT, snapshotHash: sha256(JSON.stringify(SNAPSHOT)), provider: 'rakuten' });
// An HTTP stub standing in for OMF's bank upload (the collector transport only); every request recorded.
async function omfStub() {
  const requests = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { const url = new URL(req.url, 'http://x'); requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), bytes: Buffer.concat(chunks).length }); res.writeHead(url.pathname.endsWith('/bank/upload') ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(url.pathname.endsWith('/bank/upload') ? { id: 'f'.repeat(24), state: 'imported', duplicate: false } : { statusMessage: 'not here' })); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { requests, config: { baseUrl: 'http://127.0.0.1:' + server.address().port, token: 'omfc_' + 'a'.repeat(64) }, close: () => new Promise(r => server.close(r)) };
}
// A sibling copy of a collector module with named edits applied (each anchor must hit exactly once), or one `// guard:<name>` line removed.
async function mutantModule(file, { guard = null, edits = [] } = {}) {
  const source = path.join(root, file); let text = await readFile(source, 'utf8');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('FAIL guard marker hits ' + hits.length + ' for ' + guard); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = (text.match(new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g')) || []).length; if (hits !== 1) throw new Error('FAIL mutant anchor hits ' + hits + ' for ' + file + ' /' + anchor.source.slice(0, 60)); text = text.replace(anchor, () => replacement); }
  const target = path.join(path.dirname(source), path.basename(file, '.mjs') + `.mutant-${process.pid}-${randomUUID().slice(0, 8)}.mjs`);
  await writeFile(target, text, { flag: 'wx' });
  return { file: target, async load() { try { return await import(pathToFileURL(target).href); } catch (error) { throw new Error('FAIL mutant invalid: ' + (error?.message || error)); } }, async dispose() { await unlink(target).catch(() => {}); } };
}
async function walkRelativeImports(file, seen = new Set()) {
  const text = await readFile(file, 'utf8'), dir = path.dirname(file);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)'(\.[^']+)'/g)) { const target = path.resolve(dir, m[1]); if (!await exists(target)) throw new Error(path.relative(root, file).replaceAll('\\', '/') + ' imports ' + m[1] + ' which is not staged'); if (!seen.has(target)) { seen.add(target); await walkRelativeImports(target, seen); } }
  return seen;
}
const run = (args, env = {}, timeout = 1500000) => new Promise(resolve => execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(MONGOD ? { MONGOMS_SYSTEM_BINARY: MONGOD } : {}), ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, stdout: String(stdout), stderr: String(stderr) })));
const receiptOf = text => { const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('{"pass":')); try { return line ? JSON.parse(line) : null; } catch { return null; } };

export default { name: 'omf-rakuten-auto-login', covers: COVERS, async run() {
  const started = Date.now(), lines = []; let pass = true; const green = new Set();
  const leg = async (name, fn) => { const t = Date.now(); try { lines.push(name + ': ' + await fn() + ` (${Math.round((Date.now() - t) / 1000)}s)`); green.add(name.split(' ')[0]); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1600)); } };
  const assert = (await import('node:assert/strict')).default;
  if (process.platform !== 'win32') return { pass: false, message: 'the collector, its owned Chrome and the Windows window facts need Windows' };
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-rakuten-auto-fixture-'));
  process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector-dir');
  const winPs = path.join(temp, 'window-facts.ps1'); await writeFile(winPs, WIN_PS);
  const facts = async pid => { const { stdout } = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', winPs, '-ProcessId', String(pid)], { windowsHide: true, timeout: 30000 }, (e, so, se) => e ? reject(new Error('window facts: ' + (se || e.message))) : resolve({ stdout: so }))); return JSON.parse(stdout.trim()); };
  let unrelated = null, dbExecuted = false;
  try {
    const browserModule = await import(u('collector/browser.mjs')).catch(e => e), bankModule = await import(u('collector/bank.mjs')).catch(e => e), indexModule = await import(u('collector/index.mjs')).catch(e => e), rakutenModule = await import(u('collector/banks/rakuten.mjs')).catch(e => e);
    const need = (m, what) => { if (m instanceof Error) throw new Error(what + ' missing or broken: ' + m.message); return m; };
    const connected = () => need(browserModule, 'collector/browser.mjs').ownedBrowsers().filter(b => b.connected).length;
    // A fixture-owned unrelated Chrome (its own profile, never the collector's): no leg may end it.
    const puppeteer = (await import(pathToFileURL(path.join(root, 'collector', 'node_modules', 'rebrowser-puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js')).href)).default;
    unrelated = await puppeteer.launch({ executablePath: need(browserModule, 'collector/browser.mjs').findChrome(), pipe: true, headless: true, userDataDir: path.join(temp, 'unrelated-profile'), args: ['--no-first-run'] });
    const unrelatedAlive = () => { try { process.kill(unrelated.process().pid, 0); return unrelated.connected; } catch { return false; } };
    const site = portal();
    // One retrieval through the existing bank entry: runBankJob → (default) collectBankStatement → the frozen per-variant adapter.
    const retrieval = async (label, { login, mode = 'ok', collect = undefined, statusHook = null, signal = null, job = jobOf(), extraLaunch = null } = {}) => {
      const idx = need(indexModule, 'collector/index.mjs'), stub = await omfStub(), dir = path.join(temp, label); await mkdir(dir, { recursive: true });
      site.mode = mode; site.variant = {}; const launches = [], statuses = [], samples = [], postsBefore = site.loginPosts.length, exportsBefore = site.exports; let error = null, outcome = null;
      const before = await facts(0);
      const status = async (state, text) => { statuses.push([state, text]); const pid = launches.at(-1)?.pid; if (pid && (state === 'verification_required' || (state === 'running' && /入出金明細を開く|CSVをダウンロード/.test(text)))) samples.push({ state, text, facts: await facts(pid) }); await statusHook?.(state, text, { launches, site }); };
      try { outcome = await idx.runBankJob({ job, account: ACCOUNT }, stub.config, null, { status, login, onLaunch: site.onLaunch(launches, extraLaunch), batch: label, directory: dir, signal, ...(collect ? { collect } : {}) }); }
      catch (e) { error = e; } finally { await stub.close(); }
      return { label, outcome, error, statuses, samples, before, launches, posts: site.loginPosts.slice(postsBefore), exports: site.exports - exportsBefore, uploads: stub.requests.filter(r => r.path.endsWith('/bank/upload')), dir, job };
    };
    const noAttention = async (state, text) => { if (state === 'verification_required') throw new Error('rakuten-auto:no-manual-attention — the job asked the person: ' + text); };
    const shortCollect = extra => (b, j, r, st, o) => need(bankModule, 'collector/bank.mjs').collectBankStatement(b, j, r, st, { ...o, pollMs: 300, loginTimeoutMs: 15000, downloadTimeoutMs: 30000, extensionMs: 0, ...extra });
    const backgroundChecks = (r, label) => {
      assert.ok(r.samples.length >= 1, 'rakuten-auto:background-sampled ' + label);
      const pid = r.launches[0].pid;
      for (const s of r.samples) {
        assert.notEqual(s.facts.foregroundPid, pid, `rakuten-auto:background-no-foreground (${label}: the owned bank Chrome had the foreground at "${s.text}")`);
        assert.deepEqual(onScreen(s.facts), [], `rakuten-auto:background-offscreen (${label}: an owned bank window was on screen at "${s.text}": ${JSON.stringify(s.facts.windows)})`);
        assert.deepEqual(s.facts.cursor, r.before.cursor, `rakuten-auto:cursor-unmoved (${label}: ${JSON.stringify(r.before.cursor)} → ${JSON.stringify(s.facts.cursor)})`);
      }
    };
    const completeChecks = (r, login, label) => {
      if (r.error) throw r.error;
      assert.equal(r.outcome?.failed, null, 'rakuten-auto:retrieval-complete ' + label + ' ' + JSON.stringify(r.outcome));
      assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 0, 'rakuten-auto:no-manual-attention ' + label);
      assert.deepEqual(r.posts.map(p => p.ok), [true], 'rakuten-auto:one-login-submission ' + label);
      assert.deepEqual(r.posts[0].fields, ['LOGIN:LOGIN_PASSWORD', 'LOGIN:USER_ID', 'LOGIN_SUBMIT'], 'rakuten-auto:exact-form-fields ' + label);
      assert.equal(login.calls.open, 1, 'rakuten-auto:one-decryption ' + label);
      assert.equal(r.exports, 1, 'rakuten-auto:one-export ' + label); assert.equal(r.uploads.length, 1, 'rakuten-auto:uploaded ' + label);
      assert.equal(r.uploads[0].query.jobId, r.job.jobId); assert.equal(r.uploads[0].query.sourceHost, HOST);
      assert.equal(r.launches.length, 1, 'rakuten-auto:one-owned-browser ' + label); assert.equal(connected(), 0, 'rakuten-auto:browser-closed ' + label);
    };
    // ── A1: the RED target — the existing bank entry with a fictional saved login, twice, in the owned background Chrome ──
    let a1 = null;
    await leg('A1 repeat automatic sign-in through runBankJob (default collectBankStatement, owned HEADED background Chrome, intercepted fake portal): the saved login fills the exact public form once per job, no manual attention, no foreground/cursor take-over, export/upload, second job after the first browser closed', async () => {
      const first = savedLogin(), r1 = await retrieval('a1-first', { login: first, statusHook: noAttention });
      completeChecks(r1, first, 'first'); backgroundChecks(r1, 'first');
      const second = savedLogin(), r2 = await retrieval('a1-second', { login: second, statusHook: noAttention });
      completeChecks(r2, second, 'second'); backgroundChecks(r2, 'second');
      assert.notEqual(r1.launches[0].pid, r2.launches[0].pid, 'rakuten-auto:independent-browser');
      for (const r of [r1, r2]) assert.equal(await exists(path.join(r.dir, 'profiles', 'ephemeral', `${ACCOUNT.ownerId}-bank-${ACCOUNT._id}-${r.label}`)), false, 'rakuten-auto:ephemeral-profile-removed');
      assert.equal(unrelatedAlive(), true, 'rakuten-auto:unrelated-browser-kept');
      a1 = { r1, r2 };
      return `2 jobs, ${r1.posts.length + r2.posts.length} submissions, 0 attentions, foreground pid ${r1.samples[0].facts.foregroundPid}≠${r1.launches[0].pid}, cursor ${JSON.stringify(r1.before.cursor)} unchanged, bank windows off-screen, 2 exports/uploads, unrelated Chrome alive`;
    });
    // ── A2: additional verification after the submission makes the SAME owned window visible at usable bounds ──
    await leg('A2 bank-required additional verification: one submission, the same owned bank window becomes visible on screen at usable bounds (no second browser), the person completes it, the routine continues, export only after authentication', async () => {
      const login = savedLogin(), exports0 = site.exports; let shown = null, person = null, personError = null;
      // The person acts on their own time, after the collector has shown the window (status is reported before the window is shown).
      const hook = async (state, text, { launches }) => {
        if (state !== 'verification_required' || person) return;
        person = (async () => { await pause(1500); const f = await facts(launches.at(-1).pid); shown = { text, facts: f, connected: connected(), exportsAtAttention: site.exports - exports0 }; await site.pages.at(-1).click('#verify'); })().catch(e => { personError = e; });
      };
      const r = await retrieval('a2', { login, mode: 'verify', statusHook: hook, collect: shortCollect({ loginTimeoutMs: 60000 }) });
      await person; if (personError) throw personError;
      if (r.error) throw r.error;
      assert.equal(r.outcome?.failed, null, JSON.stringify(r.outcome)); assert.ok(shown, 'rakuten-auto:verification-attention');
      assert.match(shown.text, /追加の確認/, 'rakuten-auto:verification-message');
      const visible = onScreen(shown.facts); assert.equal(visible.length >= 1, true, 'rakuten-auto:attention-visible ' + JSON.stringify(shown.facts));
      const [w] = visible; assert.ok(w.rect[2] - w.rect[0] >= 800 && w.rect[3] - w.rect[1] >= 600, 'rakuten-auto:attention-usable-bounds ' + JSON.stringify(w.rect));
      assert.ok(w.rect[0] >= shown.facts.screen[0] && w.rect[1] >= shown.facts.screen[1] && w.rect[2] <= shown.facts.screen[2] && w.rect[3] <= shown.facts.screen[3], 'rakuten-auto:attention-within-screen ' + JSON.stringify([w.rect, shown.facts.screen]));
      assert.equal(shown.connected, 1, 'rakuten-auto:same-window (one owned browser)'); assert.equal(r.launches.length, 1, 'rakuten-auto:same-window (no relaunch)');
      assert.equal(shown.exportsAtAttention, 0, 'rakuten-auto:no-export-before-auth'); assert.deepEqual(r.posts.map(p => p.ok), [true], 'rakuten-auto:one-submit');
      assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1, 'rakuten-auto:one-attention'); assert.equal(login.calls.accepted, 1);
      assert.equal(r.exports, 1); assert.equal(connected(), 0); assert.equal(unrelatedAlive(), true);
      return `attention "${shown.text.slice(0, 40)}…" with the bank window at ${JSON.stringify(w.rect)} inside ${JSON.stringify(shown.facts.screen)}; completed; 1 submission, 1 export`;
    });
    // ── A3: the bank refuses: one submission, remembered (real bankLoginFor over an in-memory sealed-entry store), update, success ──
    const memoryStore = () => { const entries = new Map(); return { entries, save(id, aad, value) { const keyId = randomBytes(32).toString('hex'); entries.set(id, { envelope: { v: 3, keyId, aad: { ...aad, v: 3, generation: 'a'.repeat(64), keyId } }, value }); }, async has(id) { return entries.has(id); }, async read(id) { return entries.get(id).envelope; }, async open(id) { return { ...entries.get(id).value }; } }; };
    await leg('A3 incorrect saved password: one submission, the refusal remembered for that saved key (index.mjs bankLoginFor), no retry while polling, actionable failure, the next job submits nothing, a re-saved login signs in', async () => {
      const idx = need(indexModule, 'collector/index.mjs'), { aadOf } = await import(u('collector/vault.mjs')), store = memoryStore(), dir = path.join(temp, 'a3-root'); await mkdir(dir, { recursive: true });
      const live = { mode: 'protected', installationId: 'f'.repeat(32), broker: {}, abort: new AbortController() }, config = { baseUrl: 'https://omf.example', token: 'omfc_' + 'c'.repeat(64), accountInfo: [] };
      const aad = aadOf({ installationId: live.installationId, origin: config.baseUrl, ownerId: ACCOUNT.ownerId, provider: 'rakuten', accountId: ACCOUNT._id });
      store.save('rakuten-' + ACCOUNT._id, aad, { ...FICT, password: 'Fictional-Wrong-0009' });
      const handle = job => idx.bankLoginFor({ job, account: ACCOUNT }, config, live, { store, root: dir, assert: () => {} });
      const j1 = jobOf(), r1 = await retrieval('a3-refused', { login: handle(j1), job: j1, collect: shortCollect({ loginTimeoutMs: 12000 }) });
      if (r1.error) throw r1.error;
      assert.deepEqual(r1.posts.map(p => p.ok), [false], 'rakuten-auto:one-submit (no retry storm over 12 s of polling)');
      assert.match(String(r1.outcome?.failed), /受け付けませんでした.*保存し直/, 'rakuten-auto:refused-actionable ' + JSON.stringify(r1.outcome));
      assert.equal(r1.exports, 0, 'rakuten-auto:no-export-before-auth'); assert.equal(r1.statuses.filter(([s]) => s === 'verification_required').length, 1);
      assert.equal(await handle(jobOf()).state(), 'blocked', 'rakuten-auto:refusal-remembered');
      const j2 = jobOf(), r2 = await retrieval('a3-blocked', { login: handle(j2), job: j2, collect: shortCollect({ loginTimeoutMs: 5000 }) });
      assert.equal(r2.posts.length, 0, 'rakuten-auto:blocked-after-refusal'); assert.match(r2.statuses.find(([s]) => s === 'verification_required')?.[1] || '', /前回の自動サインインが確認できていない/, 'rakuten-auto:blocked-message');
      store.save('rakuten-' + ACCOUNT._id, aad, { ...FICT });
      const j3 = jobOf(), r3 = await retrieval('a3-updated', { login: handle(j3), job: j3, statusHook: noAttention });
      if (r3.error) throw r3.error; assert.equal(r3.outcome?.failed, null); assert.deepEqual(r3.posts.map(p => p.ok), [true], 'rakuten-auto:update-then-success');
      assert.equal(await handle(jobOf()).state(), 'ready', 'rakuten-auto:success-keeps-ready'); assert.equal(connected(), 0);
      return 'refused once (1 submission in 12 s), blocked next job (0 submissions), re-saved → automatic sign-in';
    });
    // ── A4: already authenticated, no saved login (person signs in as before), no login object ──
    await leg('A4 already authenticated (nothing decrypted or typed); no saved login → the person signs in exactly as before; manual-only configuration unchanged', async () => {
      const l1 = savedLogin(), r1 = await retrieval('a4-session', { login: l1, mode: 'authenticated', statusHook: noAttention });
      if (r1.error) throw r1.error; assert.equal(r1.outcome?.failed, null); assert.equal(l1.calls.open, 0, 'rakuten-auto:authenticated-no-decryption'); assert.equal(r1.posts.length, 0, 'rakuten-auto:authenticated-no-submit');
      const person = async (state, text, { site: s }) => { if (state !== 'verification_required') return; assert.equal(text, '楽天銀行にChromeでサインインしてください', 'rakuten-auto:manual-message-unchanged'); const page = s.pages.at(-1); await page.type('#LOGIN\\:USER_ID', FICT.username); await page.type('#LOGIN\\:LOGIN_PASSWORD', FICT.password); await page.click('#LOGIN a.btn'); };
      for (const [label, login] of [['none', savedLogin({ state: 'none' })], ['no-object', null]]) {
        const r = await retrieval('a4-' + label, { login, statusHook: person, collect: shortCollect({ loginTimeoutMs: 60000 }) });
        if (r.error) throw r.error; assert.equal(r.outcome?.failed, null, label); assert.equal(r.statuses.filter(([s]) => s === 'verification_required').length, 1, 'rakuten-auto:manual-one-attention ' + label);
        if (login) assert.equal(login.calls.open, 0, 'rakuten-auto:none-no-decryption'); assert.deepEqual(r.posts.map(p => p.ok), [true], 'the person\'s own submission');
      }
      return 'session reused without decryption; manual sign-in (saved login absent / no login object) unchanged';
    });
    // ── A5: the strict form table — only the exact recorded public form is ever filled ──
    const formTable = async (adapter, variants, label) => {
      const bm = need(browserModule, 'collector/browser.mjs'), bank = need(bankModule, 'collector/bank.mjs'), out = {};
      const browser = await bm.browserFor(path.join(temp, 'table-' + label + '-' + randomUUID().slice(0, 6)), { headless: true }); const page = await browser.newPage(); await page.setRequestInterception(true); page.on('request', r => site.respond(r));
      try {
        for (const name of variants) {
          site.mode = 'ok'; site.variant = VARIANTS[name]; const posts = site.loginPosts.length, foreign = site.foreign.length, gets = site.loginGets, login = savedLogin(), attention = [];
          const ui = adapter.ui(page, browser, SNAPSHOT); let error = null;
          try { await bank.ensureBankLogin(ui, async (state, text) => { if (state === 'verification_required') attention.push(text); }, { label: '楽天銀行', login, timeoutMs: 3500, pollMs: 250 }); } catch (e) { error = e; }
          const typed = await page.evaluate(() => window.__typed ?? null).catch(() => null);
          out[name] = { posts: site.loginPosts.length - posts, foreign: site.foreign.slice(foreign), gets: site.loginGets - gets, opened: login.calls.open, typed, attention, authenticated: !error };
        }
      } finally { await browser.close().catch(() => {}); }
      return out;
    };
    const STRICT = Object.keys(VARIANTS).filter(n => n !== 'exact');
    const strictChecks = (table, names = STRICT) => {
      assert.equal(table.exact.posts, 1, 'rakuten-auto:table-control (the exact form is filled and submitted once) ' + JSON.stringify(table.exact)); assert.equal(table.exact.authenticated, true, 'rakuten-auto:table-control authenticated ' + JSON.stringify(table.exact));
      for (const name of names) { const t = table[name]; assert.deepEqual([t.posts, t.gets, t.foreign.length, t.opened, t.typed || 0], [0, 0, 0, 0, 0], `rakuten-auto:strict-no-typing ${name} ${JSON.stringify(t)}`); assert.equal(t.attention.length, 1, 'rakuten-auto:strict-attention ' + name); }
    };
    await leg('A5 strict form table (owned headless Chrome): the exact recorded LOGIN form is filled once; another pathname, a foreign form action, fields in another form, a duplicate ID field, an extra password (PIN) field, two or no ログイン controls, renamed fields, GET method, a text password field and a framed form are never typed into or submitted, nothing is decrypted, the person is asked', async () => {
      const table = await formTable(need(rakutenModule, 'collector/banks/rakuten.mjs').standard, ['exact', ...STRICT], 'real'); strictChecks(table);
      return STRICT.length + ' deviations refused before decryption/typing; exact form submitted once';
    });
    // ── A6: abort, lock/revocation, expired password, reclaim ──
    await leg('A6 abort before the decryption and right after it, a revoked connection, an expired-password page (attention, never a second submission) and a reclaimed job (no resubmission)', async () => {
      const bank = need(bankModule, 'collector/bank.mjs');
      const early = new AbortController(), l1 = savedLogin(), r1 = await retrieval('a6-abort', { login: l1, signal: early.signal, extraLaunch: () => early.abort(), collect: shortCollect() });
      assert.ok(r1.error && (r1.error.name === 'AbortError' || /abort/i.test(r1.error.message)), 'rakuten-auto:abort-fails-closed ' + r1.error); assert.equal(l1.calls.open, 0, 'rakuten-auto:abort-no-decryption'); assert.equal(r1.posts.length, 0); assert.equal(connected(), 0);
      const mid = new AbortController(), l2 = savedLogin({ onOpen: () => mid.abort() }), r2 = await retrieval('a6-abort-mid', { login: l2, signal: mid.signal, collect: shortCollect() });
      assert.ok(r2.error, 'rakuten-auto:abort-after-decryption'); assert.equal(r2.posts.length, 0, 'rakuten-auto:abort-before-typing'); assert.equal(connected(), 0);
      const l3 = savedLogin({ openError: Object.assign(new Error('Collector access expired or changed.'), { status: 401 }) }), r3 = await retrieval('a6-revoked', { login: l3, collect: shortCollect() });
      assert.equal(r3.error?.status, 401, 'rakuten-auto:revocation-propagates'); assert.equal(r3.posts.length, 0);
      const l4 = savedLogin(), r4 = await retrieval('a6-expired', { login: l4, mode: 'expired', collect: shortCollect({ loginTimeoutMs: 9000 }) });
      assert.deepEqual(r4.posts.map(p => p.ok), [true], 'rakuten-auto:expired-one-submit'); assert.match(r4.statuses.find(([s]) => s === 'verification_required')?.[1] || '', /追加の確認/, 'rakuten-auto:expired-attention'); assert.equal(r4.exports, 0); assert.equal(l4.calls.rejected, 1, 'rakuten-auto:expired-pending-block-remembered');
      const job = jobOf(), dir = path.join(temp, 'a6-reclaim'), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId); await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), JSON.stringify({ jobId: job.jobId }));
      const l5 = savedLogin(), r5 = await retrieval('a6-reclaim', { login: l5, job, collect: (b, j, _r, st, o) => bank.collectBankStatement(b, j, dir, st, { ...o, pollMs: 300, loginTimeoutMs: 4000 }) });
      assert.equal(r5.posts.length, 0, 'rakuten-auto:reclaim-no-resubmit'); assert.equal(l5.calls.open, 0); assert.equal(connected(), 0); assert.equal(unrelatedAlive(), true);
      return 'aborts fail closed with 0 submissions, revocation propagates, expired → attention without resubmission, reclaimed job submits nothing; unrelated Chrome alive';
    });
    await leg('A7 unconfirmed automatic attempts: an error-titled answer or an unknown page through the deadline blocks the saved key before submission; the next independent job never opens or resubmits it', async () => {
      for (const mode of ['error', 'unknown']) {
        const login = savedLogin(), first = await retrieval('a7-' + mode + '-first', { login, mode, collect: shortCollect({ loginTimeoutMs: 4000 }) });
        assert.equal(first.posts.length, 1, 'rakuten-auto:unconfirmed-one-submit ' + mode);
        assert.match(first.outcome?.failed || first.error?.message || '', /保存し直/, 'rakuten-auto:unconfirmed-actionable ' + mode);
        const opens = login.calls.open, second = await retrieval('a7-' + mode + '-second', { login, mode, collect: shortCollect({ loginTimeoutMs: 2000 }) });
        assert.equal(second.posts.length, 0, 'rakuten-auto:blocked-after-unconfirmed ' + mode);
        assert.equal(login.calls.open, opens, 'rakuten-auto:blocked-no-open ' + mode);
      }
      return 'both uncertain outcomes fail with re-save guidance; both following jobs have 0 opens/submissions';
    });
    // ── U: the collector unit legs (node --test) ──
    await leg('U collector unit legs: rakuten-auto-login, rakuten-setup (real setup page in owned headless Chrome, real collector process refusals), rakuten-standard', async () => {
      const r = await run(['--test', '--test-concurrency=1', 'collector/test/rakuten-auto-login.test.mjs', 'collector/test/rakuten-setup.test.mjs', 'collector/test/rakuten-standard.test.mjs'], {}, 900000);
      await writeFile(path.join(root, '.zoomer-rakuten-auto-unit.txt'), r.stdout + r.stderr);
      const count = name => Number(r.stdout.match(new RegExp('(?:#|ℹ) ' + name + ' ([0-9]+)'))?.[1] || 0), passed = count('pass'), failed = count('fail'), skipped = count('skipped') + count('todo') + count('cancelled');
      if (r.code !== 0 || failed || !passed || skipped) throw new Error(`node --test exit ${r.code} pass ${passed} fail ${failed} skipped ${skipped}: ` + (r.stdout.split('\n').filter(l => /^not ok|Error|AssertionError|rakuten|auto-login|bank-setup/.test(l)).slice(0, 14).join(' | ') || r.stderr.slice(-900)));
      return passed + ' tests green, 0 skipped';
    });
    // ── K: the shared key binding on an owned ephemeral MongoDB (isolated service legs, incl. bank legs and mutants) ──
    await leg('K shared v3 key boundary (scripts/collector-security-integration.ts, owned MongoDB): connect/legacy legs unchanged, card/service bindings and their mutants, bank key after card-only pairing, attacks, races and the bank binding mutants', async () => {
      const r = await run(['--import', 'tsx', 'scripts/collector-security-integration.ts']); await writeFile(path.join(root, '.zoomer-rakuten-auto-security.txt'), r.stdout + r.stderr);
      const passes = r.stdout.split(/\r?\n/).filter(l => l.startsWith('PASS ')), receipt = receiptOf(r.stdout);
      if (r.code !== 0 || !receipt?.pass || receipt.checks !== passes.length) throw new Error(`exit ${r.code}, ${passes.length} PASS; last: ${passes.at(-1)?.slice(5, 140) || 'none'}; error: ` + r.stderr.replace(/\s+/g, ' ').slice(0, 900));
      for (const want of [/bank key: a Rakuten standard account granted to the device after the card-only pairing/, /bank key attacks refused/, /post-I\/O recheck/, /bank binding mutants/, /same card-only grant still releases Amex/]) assert.ok(passes.some(p => want.test(p)), 'rakuten-auto:security-leg ' + want.source);
      dbExecuted = true;
      return `${passes.length} legs, receipt ${JSON.stringify({ securityMutants: receipt.securityMutants, bankMutants: receipt.bankMutants, connectMutants: receipt.connectMutants })}`;
    });
    // ── N: the owned native end-to-end on the built app ──
    await leg('N native end-to-end (scripts/finance-rakuten-auto-login-integration.cjs): built app on owned MongoDB, real enrollment (card-only), bank scope added after pairing, real DPAPI SplitStore save through the key service, two retrievals with automatic sign-in in the owned background Chrome, capture/dedup, scope/variant/revocation stops', async () => {
      if (!existsSync(path.join(root, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const r = await run(['scripts/finance-rakuten-auto-login-integration.cjs']); await writeFile(path.join(root, '.zoomer-rakuten-auto-native.txt'), r.stdout + r.stderr);
      const passes = r.stdout.split(/\r?\n/).filter(l => l.startsWith('PASS ')), receipt = receiptOf(r.stdout);
      if (r.code !== 0 || !receipt?.pass || receipt.checks !== passes.length) throw new Error(`exit ${r.code}, ${passes.length} PASS; last: ${passes.at(-1)?.slice(5, 160) || 'none'}; error: ` + r.stderr.replace(/\s+/g, ' ').slice(0, 1200));
      dbExecuted = true;
      return `${passes.length} legs; ${receipt.loginSubmissions} submissions, ${receipt.exports} exports, ${receipt.keyCalls} key-service calls`;
    });
    // ── P: the package carries the changed runtime files; the staged graph resolves; no test code ──
    await leg('P package closure: the changed runtime modules and setup files staged with their repo hashes, staged import graph resolves from index.mjs, staged adapter/bank load without node_modules, nothing under collector/test is staged', async () => {
      const stageModule = await import(u('collector/package/stage.mjs')), into = path.join(temp, 'staged');
      const { manifest } = await stageModule.stage({ into, origin: 'https://omf.example', install: false, log: () => {} });
      for (const entry of ['collector/index.mjs', 'collector/bank.mjs', 'collector/browser.mjs', 'collector/banks/rakuten.mjs', 'collector/banks/contract.mjs', 'collector/setup.html', 'collector/setup.js', 'collector/vault.mjs', 'collector/omf-authorization.mjs']) { assert.ok(manifest.files[entry], 'rakuten-auto:staged ' + entry); assert.equal(manifest.files[entry], sha256(await readFile(path.join(root, entry))), 'rakuten-auto:staged-hash ' + entry); }
      assert.equal(Object.keys(manifest.files).some(f => f.includes('/test/') || f.includes('mutant')), false, 'rakuten-auto:no-test-code-staged');
      await walkRelativeImports(path.join(into, 'collector', 'index.mjs'));
      const stagedRakuten = await import(pathToFileURL(path.join(into, 'collector/banks/rakuten.mjs')).href); assert.equal(stagedRakuten.STANDARD_LOGIN?.form, 'LOGIN', 'rakuten-auto:staged-login-contract'); assert.equal(typeof stagedRakuten.standard.ui({}, {}, null).login, 'function');
      const stagedBank = await import(pathToFileURL(path.join(into, 'collector/bank.mjs')).href); assert.equal(typeof stagedBank.ensureBankLogin, 'function'); assert.equal(stagedBank.adapterFor('rakuten', 'standard').variant, 'standard');
      return Object.keys(manifest.files).length + ' files staged; changed runtime files hashed; graph resolves; staged adapter/bank load';
    });
    // ── M: deliberately reintroduced defects, each caught by its named assertion ──
    await leg('M collector mutants: each removed login guard (surface, action, fields, single password, single control) lets the table type into its deviation; one-submit, journal and refusal lines removed resubmit; the index refusal check removed unblocks; the background window line removed takes the foreground or shows the window', async () => {
      const caught = [], flips = async (label, fn, pattern) => { let error = null; try { await fn(); } catch (e) { error = e; } if (!error) throw new Error(label + ' did not flip (the assertion passed on the mutant)'); if (/FAIL mutant|FAIL guard/.test(String(error.message))) throw error; if (!pattern.test(String(error.message))) throw new Error(label + ' flipped the wrong assertion: ' + String(error.message).slice(0, 300)); caught.push(label); };
      for (const [guard, variant] of [['login-surface', 'other-path'], ['login-action', 'foreign-action'], ['login-fields', 'other-form'], ['login-password-unique', 'pin'], ['login-control', 'two-controls']]) {
        const m = await mutantModule('collector/banks/rakuten.mjs', { guard }); try { const mod = await m.load(); await flips(guard, async () => strictChecks({ exact: { posts: 1, authenticated: true }, ...(await formTable(mod.standard, [variant], guard)) }, [variant]), /rakuten-auto:strict-no-typing/); } finally { await m.dispose(); }
      }
      { const m = await mutantModule('collector/bank.mjs', { guard: 'login-once' }); try { const mod = await m.load(); site.mode = 'reject'; await flips('login-once', async () => { const login = savedLogin(); login.rejected = async () => { login.calls.rejected++; }; /* isolates the one-submit line from the refusal memory */ const r = await retrieval('m-once', { login, mode: 'reject', collect: (b, j, r0, st, o) => mod.collectBankStatement(b, j, r0, st, { ...o, pollMs: 300, loginTimeoutMs: 9000 }) }); assert.deepEqual(r.posts.map(p => p.ok), [false], 'rakuten-auto:one-submit'); }, /rakuten-auto:one-submit/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/bank.mjs', { guard: 'login-journal' }); try { const mod = await m.load(); await flips('login-journal', async () => { const job = jobOf(), dir = path.join(temp, 'm-journal'), jobDir = path.join(dir, 'outbox', 'bank', ACCOUNT._id, job.jobId); await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'login.json'), '{}'); const r = await retrieval('m-journal', { login: savedLogin(), job, collect: (b, j, _r, st, o) => mod.collectBankStatement(b, j, dir, st, { ...o, pollMs: 300, loginTimeoutMs: 6000 }) }); assert.equal(r.posts.length, 0, 'rakuten-auto:reclaim-no-resubmit'); }, /rakuten-auto:reclaim-no-resubmit/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/bank.mjs', { guard: 'login-refused' }); try { const mod = await m.load(); await flips('login-refused', async () => { const login = savedLogin(), c = extra => (b, j, r0, st, o) => mod.collectBankStatement(b, j, r0, st, { ...o, pollMs: 300, ...extra }); await retrieval('m-unconfirmed-1', { login, mode: 'error', collect: c({ loginTimeoutMs: 6000 }) }); const r = await retrieval('m-unconfirmed-2', { login, mode: 'error', collect: c({ loginTimeoutMs: 4000 }) }); assert.equal(r.posts.length, 0, 'rakuten-auto:blocked-after-unconfirmed'); }, /rakuten-auto:blocked-after-unconfirmed/); } finally { await m.dispose(); } }
      { const m = await mutantModule('collector/index.mjs', { guard: 'bank-login-blocked' }); try { const mod = await m.load(); const { aadOf } = await import(u('collector/vault.mjs')); await flips('bank-login-blocked', async () => { const store = memoryStore(), dir = path.join(temp, 'm-blocked'); await mkdir(dir, { recursive: true }); const live = { mode: 'protected', installationId: 'f'.repeat(32), broker: {}, abort: new AbortController() }, config = { baseUrl: 'https://omf.example', token: 'omfc_' + 'c'.repeat(64) }; store.save('rakuten-' + ACCOUNT._id, aadOf({ installationId: live.installationId, origin: config.baseUrl, ownerId: ACCOUNT.ownerId, provider: 'rakuten', accountId: ACCOUNT._id }), FICT); const h = () => mod.bankLoginFor({ job: jobOf(), account: ACCOUNT }, config, live, { store, root: dir, assert: () => {} }); await h().rejected(); assert.equal(await h().state(), 'blocked', 'rakuten-auto:refusal-remembered'); }, /rakuten-auto:refusal-remembered/); } finally { await m.dispose(); } }
      { const browserMutant = await mutantModule('collector/browser.mjs', { guard: 'background-window' }); let bankMutant = null; try { bankMutant = await mutantModule('collector/bank.mjs', { edits: [[/import\('\.\/browser\.mjs'\)/, `import('./${path.basename(browserMutant.file)}')`]] }); const mod = await bankMutant.load();
          await flips('background-window', async () => { const r = await retrieval('m-background', { login: savedLogin(), collect: (b, j, r0, st, o) => mod.collectBankStatement(b, j, r0, st, { ...o, pollMs: 300, loginTimeoutMs: 20000 }) }); if (r.error) throw r.error; backgroundChecks(r, 'mutant'); }, /rakuten-auto:background-(no-foreground|offscreen)/); }
        finally { await bankMutant?.dispose(); await browserMutant.dispose(); await need(browserModule, 'collector/browser.mjs').closeOwnedBrowsers().catch(() => {}); } }
      return caught.length + ' caught: ' + caught.join(', ');
    });
  } finally {
    if (unrelated) await unrelated.close().catch(() => {});
    await import(u('collector/browser.mjs')).then(m => m.closeOwnedBrowsers()).catch(() => {});
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { pass, databaseCoverage: { executed: dbExecuted, ownedProcess: dbExecuted }, message: `${pass ? 'green' : 'RED'} in ${Math.round((Date.now() - started) / 1000)}s\n` + lines.join('\n') };
} };

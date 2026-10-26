// Fixture for plan omf-ikeda-collector-20261025: the normal 池田泉州銀行 ビジネスゲート (法人ポータル) certificate/password collector.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node C:/Users/Junsan2/Documents/ohmycode/scripts/zoomer-verify.mjs --run-fixture omf-ikeda-collector --cwd <this worktree>
// Evidence, stated exactly: synthetic only. The fake BusinessGate below follows the public controls of the task's SAFE-CONTRACT.md (screen
// BLGI024 certificate button, the cc password form with its software-keyboard checkbox and dialog, 入出金明細, the account select, the
// 日付範囲 radio, the two vue-datepicker inputs and menus, 検索する, 全N件, CSVダウンロード as a blob, ログアウト); its DOM is invented and proves
// nothing about the actual bank. Every page of every owned HEADLESS Chrome is served by request interception and host resolution is
// refused for everything else, so no bank or other site is reached. The services and routes run under tsx on an owned
// mongodb-memory-server; the collector's real SplitStore seals with a fresh DPAPI device key in a temporary directory through the real
// key service. No production database, owner AppData, real certificate store, ordinary browser, cursor or keyboard is touched.
// Legs (parent): U1 test/ikeda-bank-window.test.mjs · U2 collector/test/ikeda-portal.test.mjs (adapter, certificate helper) · S the
// harness below (S1 protected setup and key binding, S2 queue and coverage, S3 normal native capture/import end to end, S4 replay/overlap/
// crash recovery, S5 refused/uncertain sign-in, S6 schedule/month rollover/archive gaps, S7 manual CSV and other lanes, S8-S10 archive
// proof, S11 scheduled identity binding, S12 manual first-claim account check) · R the existing
// collector-security integration (extended) · M reintroduced defects (each must fail its named assertion).
// Fail-first: OMF_IKEDA_SRC points leg S at another server/shared tree and OMF_IKEDA_ONLY selects legs (U1,U2,S,R,M); OMF_IKEDA_ONLY_S
// selects harness legs.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3600000;
const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = v => createHash('sha256').update(v).digest('hex');
const HARNESS_FLAG = '--omf-ikeda-harness';
const COVERS = ['collector/banks/ikeda.mjs', 'collector/bank-certificate.mjs', 'collector/windows/bank-certificate.ps1', 'collector/windows/bank-certificate-policy.ps1', 'collector/bank.mjs', 'collector/index.mjs', 'collector/setup.js', 'collector/setup.html', 'collector/package/stage.mjs', 'shared/finance-payment-match.mjs', 'shared/finance-payment-match.d.mts', 'shared/finance-bank-schedule.mjs', 'shared/finance-bank-schedule.d.mts', 'server/services/financeBankCollectionService.ts', 'server/models/FinancePaymentMatch.ts', 'server/services/financeBankScheduleService.ts', 'server/services/financeCollectorSecurityService.ts', 'components/intake/BankConnections.vue', 'collector/test/ikeda-portal.test.mjs', 'test/ikeda-bank-window.test.mjs', 'scripts/collector-security-integration.ts', 'scripts/zoomer-fixtures/omf-ikeda-collector.mjs'];
const BINARY = [path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'), path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p => existsSync(p)) || null;
const EVIDENCE = process.env.OMF_IKEDA_EVIDENCE || '';
const ONLY = (process.env.OMF_IKEDA_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const SRC_ROOT = process.env.OMF_IKEDA_SRC ? path.resolve(process.env.OMF_IKEDA_SRC) : root;

// ════════════════════════════ The fake BusinessGate (shared with collector/test/ikeda-portal.test.mjs) ════════════════════════════
export const PORTAL = 'https://www.0161.houjinportal.anser.ne.jp', AUTH = 'https://www.bizsol.anser.ne.jp', CC = 'https://www.cc0161.bizsol.anser.ne.jp', BANKSITE = 'https://www.sihd-bk.jp';
export const AUTH_PATH = '/0161c/oauth/auth', CC_PATH = '/BIZ_0CA0600/rblgi01/BLGI024-BLGI024Info';
export const CSV_HEADER = ['勘定日', '(起算日)', 'お支払金額', 'お預り金額', '残高', '取引区分', '明細区分', '金融機関', '支店', '摘要'];
export const IDENTITY = Object.freeze({ branch: 'カクウ支店', type: '普通', number: '0000001' });
// The option format the parent observed (SAFE-ACCOUNT-OPTION-FORMAT-V2.json): bank name, branch, type and full number as four
// whitespace-separated fields, no holder suffix. Values fictional. Decoys first: a first-option or last-four/suffix choice selects the
// wrong account.
export const ACCOUNTS = Object.freeze([
  { value: 'A1', text: '池田泉州銀行 カクウ支店 普通 1000001', number: '1000001' },
  { value: 'A2', text: '池田泉州銀行 ベツ支店 普通 0000001', number: '0000001-other-branch' },
  { value: 'A3', text: '池田泉州銀行 カクウ支店 当座 0000001', number: '0000001-current' },
  { value: 'A4', text: '池田泉州銀行 カクウ支店 普通 0000001', number: '0000001' }
]);
// Parent finding C7: labels where the configured branch, type or number occurs only as part of another field or as an extra word.
export const MISLEADING_ACCOUNTS = Object.freeze([
  { value: 'B1', text: '池田泉州銀行 東カクウ支店 普通 0000001' },
  { value: 'B2', text: '池田泉州銀行 カクウ支店 当座 0000001 普通' },
  { value: 'B3', text: '池田泉州銀行 カクウ支店 普通 9999999 0000001' },
  { value: 'B4', text: 'カクウ支店 普通 0000001 カクウ株式会社（架空）' },
  { value: 'B5', text: '池田泉州銀行 カクウ支店 普通預金 0000001' }
]);
const iso = d => d.toISOString().slice(0, 10);
export const addDays = (day, n) => iso(new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000));
// Independent of shared/finance-payment-match.mjs: the first day of the month before last (前々月1日) of a JST day.
export const monthBeforeLast = day => { const [y, m] = day.split('-').map(Number), t = (y * 12 + (m - 1)) - 2; return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String(t % 12 + 1).padStart(2, '0') + '-01'; };
export const jstNow = (now = new Date()) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const sjis = text => requireRoot('iconv-lite').encode(text, 'Shift_JIS');
export function csvBytes(rows, { encoding = 'sjis', header = CSV_HEADER } = {}) {
  const text = [header.join(','), ...rows.map(r => [r.date, '', r.out ?? '', r.in ?? '', r.balance, '振込', '通常', '架空銀行', '架空支店', r.desc].join(','))].join('\r\n') + '\r\n';
  return encoding === 'utf8' ? Buffer.from(text, 'utf8') : sjis(text);
}
/** Fictional rows of the target account (A4) inside the current bank window, plus rows of the decoy accounts. */
export function fictionalRows(today) {
  const from = monthBeforeLast(today), d = n => addDays(from, n);
  return [
    { acct: 'A4', date: d(2), out: 1000, balance: 9000, desc: 'カクウサプライ（架空）' },
    { acct: 'A4', date: d(3), in: 2000, balance: 11000, desc: 'カクウ顧客（架空）' },
    { acct: 'A4', date: addDays(today, -2) < d(3) ? d(4) : addDays(today, -2), out: 500, balance: 10500, desc: 'カクウサービス（架空）' },
    { acct: 'A1', date: d(5), out: 777, balance: 1, desc: '別口座（架空）' }
  ];
}
const page = (title, body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title><style>a,button,input,select,span,div,label{margin:3px;padding:3px}.dp__menu{border:1px solid #888}.dp__calendar{display:grid;grid-template-columns:repeat(7,40px)}</style><body>${body}</body></html>`;
const sidebar = `<nav><div class="v168_100"><span class="v168_105">入出金明細</span></div><div><span>インターネットＥＢへ</span></div><div class="v168_300" id="lo"><span>ログアウト</span></div></nav>`;
const sidebarScript = s => `document.querySelector('.v168_105').addEventListener('click',()=>{location.href='/account-statements'});document.getElementById('lo').addEventListener('click',()=>{${s.logoutConfirm ? "if(!confirm('ログアウトしますか？'))return;" : ''}location.href='${BANKSITE}/corporation/'});`;
function statementsDoc(s) {
  const opts = s.accounts.map(a => `<option value="${a.value}">${a.text}</option>`).join('');
  return page('入出金明細 | 池田泉州ビジネスゲート', `<div id="app"></div><script>
const S=${JSON.stringify({ today: s.today, min: s.minDate, delay: s.searchDelayMs, hiddenDup: s.hiddenDuplicates, alert: s.alertOnStatements, stale: s.staleResult })};
setTimeout(()=>{document.getElementById('app').innerHTML=\`${sidebar}<section id="filter"><select class="v107_968" id="acct">${opts}</select>
<label><input type="radio" name="checkTermflg" value="1" checked style="display:none">期間で指定</label><label><input type="radio" name="checkTermflg" value="2" style="display:none">日付範囲で指定</label>
<select class="v107_983"><option>当日</option><option>最近1週間</option><option>当月</option><option>前月</option><option>前々月</option></select>
<input id="dp-input-start-date-id" type="text" inputmode="none" class="dp__input dp__input_readonly" placeholder="開始日"><input id="dp-input-end-date-id" type="text" inputmode="none" class="dp__input dp__input_readonly" placeholder="終了日">
\${S.hiddenDup?'<div style="display:none"><div class="v107_994">検索する</div></div>':''}<div class="v107_994" id="search">検索する</div></section><section id="result">\${S.stale?'<div class="v107_1001"><span>全9件</span></div><div class="v107_1010"><span>CSVダウンロード</span></div>':''}</section>\`;wire();},700);
function wire(){${sidebarScript(s)}
 const sel={start:null,end:null};
 for(const id of ['start','end']){const input=document.getElementById('dp-input-'+id+'-date-id');
  input.addEventListener('keydown',()=>setTimeout(()=>{input.value='';sel[id]=null;},0));
  input.addEventListener('click',()=>open(id,input));}
 function open(id,input){document.querySelectorAll('.dp__menu').forEach(m=>m.remove());const v=sel[id]||S.today;let y=+v.slice(0,4),m=+v.slice(5,7);
  const menu=document.createElement('div');menu.className='dp__menu';menu.id='dp-menu-'+id+'-date-id';input.after(menu);
  const render=()=>{const first=new Date(Date.UTC(y,m-1,1)),start=new Date(first.getTime()-first.getUTCDay()*86400000);let cells='';
   for(let i=0;i<42;i++){const d=new Date(start.getTime()+i*86400000),k=d.toISOString().slice(0,10),off=d.getUTCMonth()!==m-1,dis=k<S.min||k>S.today;
    cells+='<div class="dp__calendar_item" role="gridcell" data-k="'+k+'"><div class="dp__cell_inner'+(off?' dp__cell_offset':'')+(dis?' dp__cell_disabled':'')+'"'+(dis?' aria-disabled="true"':'')+'>'+d.getUTCDate()+'</div></div>';}
   menu.innerHTML='<div class="dp__month_year_row"><button type="button" aria-label="Previous month">‹</button><button type="button" aria-label="Open months overlay">'+m+'月</button><button type="button" aria-label="Open years overlay">'+y+'</button><button type="button" aria-label="Next month">›</button></div><div class="dp__calendar">'+cells+'</div>';
   menu.querySelector('[aria-label="Previous month"]').onclick=()=>{m--;if(m<1){m=12;y--;}render();};menu.querySelector('[aria-label="Next month"]').onclick=()=>{m++;if(m>12){m=1;y++;}render();};
   for(const c of menu.querySelectorAll('.dp__calendar_item'))c.querySelector('.dp__cell_inner').onclick=()=>{if(c.querySelector('.dp__cell_disabled'))return;sel[id]=c.dataset.k;input.value=c.dataset.k;menu.remove();};};
  render();}
 document.getElementById('search').addEventListener('click',async()=>{const mode=document.querySelector('input[name=checkTermflg]:checked').value,acct=document.getElementById('acct').value;
  const r=await (await fetch('/api/search?'+new URLSearchParams({mode,acct,from:sel.start||'',to:sel.end||''}))).json();if(!S.stale)document.getElementById('result').innerHTML='';
  setTimeout(()=>{document.getElementById('result').innerHTML='<div class="v107_1001"><span>全'+r.count+'件</span></div>'+(r.csv?(S.hiddenDup?'<div style="display:none"><span>CSVダウンロード</span></div>':'')+'<div class="v107_1010" id="csv"><span>CSVダウンロード</span></div><div><span>PDFダウンロード</span></div>':'')+r.rows.map(x=>'<div class="row"><span>'+x+'</span></div>').join('');
   const c=document.getElementById('csv');if(c)c.addEventListener('click',()=>{if(r.foreign){location.href=r.foreign;return;}fetch('/api/csv?'+new URLSearchParams({acct,from:r.from,to:r.to})).then(x=>x.arrayBuffer()).then(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([b],{type:'text/csv'}));a.download='nyushukkin.csv';document.body.append(a);a.click();});});},S.delay);});
 if(S.alert)setTimeout(()=>alert('システムからのお知らせ'),200);}
</script>`);
}
/**
 * One fictional BusinessGate. `options`: password, cert ('auto' navigates after the certificate click — a chooser answered by Chrome or a
 * helper; 'manual' waits for selectCertificate()), loginOutcome ('ok'|'refuse'|'uncertain'), csv ('ok'|'partial'|'utf8'|'foreign'),
 * displayCount (override of 全N件), emptyNoCsv, searchDelayMs, hiddenDuplicates, logoutConfirm, alertOnStatements, staleResult (an earlier
 * result 全9件 stays on screen until the new one renders), today/minDate (JST).
 */
export function businessGate(options = {}) {
  const today = options.today || jstNow();
  const s = { password: 'Fict-Pw-12', cert: 'auto', loginOutcome: 'ok', csv: 'ok', displayCount: null, emptyNoCsv: false, searchDelayMs: 2600, hiddenDuplicates: true, logoutConfirm: false, alertOnStatements: false, staleResult: false, accounts: ACCOUNTS, today, minDate: monthBeforeLast(today), rows: fictionalRows(today), ...options };
  const st = s.stats = { requests: [], foreign: [], ccPosts: [], publicPosts: 0, hiddenPosts: 0, certClicks: 0, searches: [], csvServed: 0, loggedIn: false, loggedOut: false, typedLogin: 0 };
  s.pages = [];
  const html = (request, body, status = 200) => request.respond({ status, contentType: 'text/html; charset=utf-8', body });
  const within = (r, acct, from, to) => r.acct === acct && r.date >= from && r.date <= to;
  s.respond = request => {
    let url; try { url = new URL(request.url()); } catch { return request.abort(); }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
    const p = url.pathname.split(';')[0], key = url.origin + p; st.requests.push(request.method() + ' ' + key);
    if (![PORTAL, AUTH, CC, BANKSITE].includes(url.origin)) {
      st.foreign.push(url.origin);
      if (url.origin === 'https://files.example.invalid') { st.csvServed++; return request.respond({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="meisai.csv"' }, body: csvBytes(s.rows.filter(r => r.acct === 'A4')) }); }
      return request.abort();
    }
    if (url.origin === PORTAL && p === '/') return html(request, st.loggedIn ? page('池田泉州ビジネスゲート', `<div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML=\`${sidebar}<main>ようこそ（架空）</main>\`;${sidebarScript(s).replace(/`/g, '\\`')}},900)</script>`) : page('', `<script>setTimeout(()=>location.replace('${AUTH}${AUTH_PATH}?response_type=code&state=FICTSTATE'),300)</script>`));
    if (url.origin === PORTAL && p === '/auth/callback/login') { st.loggedIn = true; return html(request, page('', "<script>location.replace('/')</script>")); }
    if (url.origin === PORTAL && p === '/account-statements') return html(request, st.loggedIn ? statementsDoc(s) : page('', `<script>location.replace('${AUTH}${AUTH_PATH}')</script>`));
    if (url.origin === PORTAL && p === '/api/search') {
      const q = url.searchParams, range = q.get('mode') === '2' ? { from: q.get('from'), to: q.get('to') } : { from: s.today, to: s.today };
      const rows = range.from && range.to ? s.rows.filter(r => within(r, q.get('acct'), range.from, range.to)) : [];
      st.searches.push({ acct: q.get('acct'), mode: q.get('mode'), ...range, count: rows.length });
      const count = s.displayCount ?? rows.length;
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ count, csv: !(s.emptyNoCsv && count === 0), ...range, rows: rows.map(r => r.date + ' ' + r.desc), foreign: s.csv === 'foreign' ? 'https://files.example.invalid/meisai.csv' : null }) });
    }
    if (url.origin === PORTAL && p === '/api/csv') {
      const q = url.searchParams; let rows = s.rows.filter(r => within(r, q.get('acct'), q.get('from'), q.get('to'))); st.csvServed++;
      if (s.csv === 'partial') rows = rows.slice(0, -1);
      return request.respond({ status: 200, contentType: 'application/octet-stream', body: csvBytes(rows, { encoding: s.csv === 'utf8' ? 'utf8' : 'sjis' }) });
    }
    if (url.origin === AUTH && p === AUTH_PATH) return html(request, page('池田泉州ビジネスゲート ログイン', `<div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML=\`<h1>ログイン</h1><form id="pub" method="post" action="/0161c/oauth/login"><label>ログインID<input id="loginId" name="loginId" type="text"></label><label>パスワード<input id="loginPwd" name="loginPwd" type="password"></label><button type="submit" name="forward_rblgi01_s01">ログイン</button></form>${s.hiddenDuplicates ? '<div style="display:none"><button id="s05" name="forward_rblgi01_s05" type="button">電子証明書ログイン</button></div>' : ''}<button id="s05" name="forward_rblgi01_s05" type="button">電子証明書ログイン</button>\`;for(const b of document.querySelectorAll('#s05'))b.addEventListener('click',()=>{fetch('/__certificate-click').catch(()=>{});${s.cert === 'auto' ? `location.href='${CC}${CC_PATH};jsessionid=FICT0001'` : 'window.__certificatePending=true'}});},500)</script>`));
    if (url.origin === AUTH && p === '/__certificate-click') { st.certClicks++; return request.respond({ status: 204, body: '' }); }
    if (url.origin === AUTH && p === '/0161c/oauth/login') { st.publicPosts++; return html(request, page('エラー', '<p>ログインIDまたはパスワードが違います</p>')); }
    if (url.origin === CC && p === CC_PATH && request.method() === 'GET') return html(request, ccDoc(''));
    if (url.origin === CC && p === CC_PATH && request.method() === 'POST') {
      const body = new URLSearchParams(request.postData() || ''), token = body.get('token');
      if (token !== 'VISIBLE') { st.hiddenPosts++; return html(request, ccDoc('不正な操作です')); }
      st.ccPosts.push({ ok: body.get('blGI024Info.loginPwd') === s.password, keyboardOff: !body.has('skLoginPwdShiyoUmu') });
      if (s.loginOutcome === 'refuse' || body.get('blGI024Info.loginPwd') !== s.password) return html(request, ccDoc('ログインパスワードが正しくありません。'));
      if (s.loginOutcome === 'uncertain') return html(request, page('お知らせ', '<h2>ログインパスワードの有効期限が近づいています</h2><button type="button">次へ</button>'));
      return html(request, page('', `<script>location.replace('${PORTAL}/auth/callback/login?code=FICTCODE')</script>`));
    }
    if (url.origin === BANKSITE && p === '/corporation/') { if (st.loggedIn) st.loggedOut = true; st.loggedIn = false; return html(request, page('法人のお客さま | 池田泉州銀行', '<h1>法人のお客さま（架空）</h1>')); }
    return request.abort();
  };
  const ccDoc = error => page('電子証明書ログイン', `<form id="hid" style="display:none" method="post" action="${CC_PATH};jsessionid=FICT0001"><input type="hidden" name="token" value="HIDDEN"><input type="checkbox" id="skloginpwdshiyoumu" name="skLoginPwdShiyoUmu" checked><input type="password" id="blGI024InfoLoginPwd3" name="blGI024Info.loginPwd" maxlength="12" readonly><button id="loginBtn_id" name="forward_rblgi01_s07" type="submit">ログイン</button></form>
<h2>電子証明書ログイン</h2>${error ? `<p class="err">${error}</p>` : ''}<form id="main" method="post" action="${CC_PATH};jsessionid=FICT0001"><input type="hidden" name="token" value="VISIBLE">
<label><input type="checkbox" id="skloginpwdshiyoumu" name="skLoginPwdShiyoUmu" checked>ソフトウェアキーボードを使用する</label><label>ログインパスワード<input type="password" id="blGI024InfoLoginPwd3" name="blGI024Info.loginPwd" maxlength="12" readonly></label><button id="loginBtn_id" name="forward_rblgi01_s07" type="submit">ログイン</button></form>
<div id="dlg" role="dialog" style="display:none"><p>ソフトウェアキーボードを使用せずにログインします。よろしいですか？</p><button id="dg-btnOK" type="button">ＯＫ</button><button id="dg-btnCancel" type="button">キャンセル</button></div>
<script>const f=document.getElementById('main'),cb=f.querySelector('#skloginpwdshiyoumu'),pw=f.querySelector('[name="blGI024Info.loginPwd"]'),d=document.getElementById('dlg');
cb.addEventListener('click',e=>{if(!cb.checked){e.preventDefault();d.style.display='block';}else pw.readOnly=true;});
document.getElementById('dg-btnOK').onclick=()=>{cb.checked=false;pw.readOnly=false;d.style.display='none';};document.getElementById('dg-btnCancel').onclick=()=>{d.style.display='none';};
pw.addEventListener('keydown',()=>{fetch('/__typed').catch(()=>{})});</script>`);
  s.attach = async target => { await target.setRequestInterception(true); target.on('request', r => s.respond(r)); s.pages.push(target); return target; };
  // Installed through the collector's own onLaunch hand-over (collector/browser.mjs browserFor), before its first page.
  s.onLaunch = (launches = []) => async ({ pid, browser }) => { launches.push({ pid, browser }); const original = browser.newPage.bind(browser); browser.newPage = async () => s.attach(await original()); };
  // What a person (or a chooser helper) does in the owned window: the certificate is chosen and the navigation proceeds.
  s.selectCertificate = target => target.evaluate((cc, path) => { if (window.__certificatePending) location.href = cc + path + ';jsessionid=FICT0001'; return !!window.__certificatePending; }, CC, CC_PATH);
  return s;
}

// ════════════════════════════ S: the services, routes and collector under tsx (child process) ════════════════════════════
const FIXTURE_LAUNCH = "\n;{const __fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=o=>__fixtureLaunch({...o,headless:true,args:[...(o?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});}\nexport const __fixtureHeadless=true;\n";
const FIXTURE_HOOK_IMPORT = 'data:text/javascript,' + encodeURIComponent(`import{registerHooks}from'node:module';registerHooks({load(url,c,n){const r=n(url,c);return /\\/browser\\.mjs$/.test(url)&&/export const LAUNCH_ARGS/.test(String(r.source))?{...r,source:String(r.source)+${JSON.stringify(FIXTURE_LAUNCH)}}:r}});`);

async function harnessMain(SRC) {
  const u = p => pathToFileURL(path.join(SRC, p)).href, c = p => pathToFileURL(path.join(root, p)).href;
  const base = String(process.env.OMF_IKEDA_MONGO_URI || ''), dbName = String(process.env.OMF_IKEDA_DB || '');
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(base) || /:27017\/?$/.test(base) || !/^omf_ikeda_[a-z0-9_]+$/.test(dbName)) { console.log('SETUP refused: not an owned ephemeral database address'); process.exit(3); }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-ikeda-harness-')), collectorDir = path.join(temp, 'collector'); await mkdir(collectorDir, { recursive: true });
  Object.assign(process.env, { MONGO_URI: base.replace(/\/?$/, '/') + dbName, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data'), OMF_COLLECTOR_DIR: collectorDir });
  let m;
  try {
    const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default, h3 = await import('h3'), http = await import('node:http');
    m = { mongoose, jwt, h3, http, User: (await import(u('server/models/User.ts'))).default, Finance: await import(u('server/models/Finance.ts')), Pay: await import(u('server/models/FinancePaymentMatch.ts')),
      schedule: await import(u('server/services/financeBankScheduleService.ts')), payments: (await import(u('server/api/finance-payments/[...path].ts'))).default, collectorRoutes: (await import(u('server/api/finance-payments/collector/[...path].ts'))).default,
      security: (await import(u('server/api/finance/collector-security/[...path].ts'))).default, auth: (await import(u('server/middleware/auth.ts'))).default, digest: (await import(u('shared/amex.mjs'))).digest, J: await import(u('shared/finance-bank-schedule.mjs')), P: await import(u('shared/finance-payment-match.mjs')),
      bank: await import(process.env.OMF_IKEDA_BANK_MODULE ? pathToFileURL(process.env.OMF_IKEDA_BANK_MODULE).href : c('collector/bank.mjs')), index: await import(process.env.OMF_IKEDA_INDEX_MODULE ? pathToFileURL(process.env.OMF_IKEDA_INDEX_MODULE).href : c('collector/index.mjs')), vault: await import(c('collector/vault.mjs')), authz: await import(c('collector/omf-authorization.mjs')) };
  } catch (e) { console.log('SETUP module unavailable: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)); process.exit(3); }
  const { mongoose, jwt, h3, User, J, P } = m, { FinanceCollector, FinancialAccount } = m.Finance, { BankAccount, BankJob, BankRow, BankStatement } = m.Pay;
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, dbName);
  await m.Pay.initializePaymentMatching(); await m.Finance.initializeFinance?.();
  const app = h3.createApp(); app.use(m.auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/collector-security/') ? m.security(e) : e.path.startsWith('/api/finance-payments/collector/') ? m.collectorRoutes(e) : e.path.startsWith('/api/finance-payments/') ? m.payments(e) : undefined));
  const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.OMF_COLLECTOR_PUBLIC_ORIGIN = origin;
  const call = async (route, { method = 'GET', token, body, raw, headers = {} } = {}) => { const r = await fetch(origin + route, { method, headers: { 'Content-Type': raw !== undefined ? 'text/csv' : 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const api = '/api/finance-payments/', capi = api + 'collector/', oid = v => new mongoose.Types.ObjectId(String(v));
  const ok = (r, label) => { assert.equal(r.status, 200, label + ' ' + JSON.stringify(r.data).slice(0, 400)); return r.data; };
  const PASSWORD = 'Synthetic-only-Strong-Password1!';
  const owner = async tag => { const email = 'ikeda-' + tag + '@example.invalid', user = await User.create({ email, name: 'Synthetic owner ' + tag, password: PASSWORD }), id = String(user._id); return { id, token: jwt.sign({ userId: id, email, type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '3h' }) }; };
  // An Ikeda portal connection is saved without a template (its native template). A tree that refuses that (the base: no native
  // template → 400) is recorded once by leg S0 and the connection is saved with an explicit owner template of the same 10 columns, so
  // every later leg still shows its own behaviour.
  let ownerTemplate = null; const fallbacks = [];
  const account = async (o, name, connection) => {
    const a = ok(await call(api + 'bank/accounts', { method: 'POST', token: o.token, body: { name, currency: 'JPY' } }), 'create ' + name).account; if (!connection) return a.id;
    const r = await call(api + 'bank/accounts/' + a.id + '/connection', { method: 'PUT', token: o.token, body: connection });
    if (r.status !== 200 && connection.provider === 'ikeda' && !connection.templateId) {
      ownerTemplate ??= ok(await call(api + 'bank/templates', { method: 'PUT', token: o.token, body: { name: 'Fictional Ikeda 10 columns', headers: CSV_HEADER, mapping: { date: '0', description: '9', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive' } }), 'owner template').template.id;
      fallbacks.push({ name, status: r.status, message: JSON.stringify(r.data).slice(0, 160) }); ok(await call(api + 'bank/accounts/' + a.id + '/connection', { method: 'PUT', token: o.token, body: { ...connection, templateId: ownerTemplate } }), 'connect (owner template) ' + name);
    } else ok(r, 'connect ' + name);
    return a.id;
  };
  const today = jstNow(), availableFrom = monthBeforeLast(today), requestedFrom = monthBeforeLast(monthBeforeLast(today));
  const IKEDA = (extra = {}) => ({ provider: 'ikeda', variant: 'portal', coverage: { from: requestedFrom, to: null }, accountIdentity: { ...IDENTITY }, ...extra });
  // ── one protected PC: real enrollment through the security routes, DPAPI device key in a temporary directory, the real key service ──
  const A = await owner('a'), B = await owner('b');
  const card = await FinancialAccount.create({ ownerId: A.id, provider: 'amex', name: 'Fictional Amex', cardIdentifiers: ['12345'], primaryCard: '12345', otpRecipient: 'o@example.invalid', otpMailbox: 'm@example.invalid' });
  const deviceToken = 'omfc_' + randomBytes(32).toString('hex'), device = await FinanceCollector.create({ ownerId: A.id, name: 'Fictional PC', tokenHash: m.digest(deviceToken), accountIds: [card._id], bankAccountIds: [] });
  const store = new m.vault.SplitStore(collectorDir), generation = randomBytes(32).toString('hex'), installationId = randomBytes(16).toString('hex'), verifier = randomBytes(32).toString('base64url');
  let localKey, trustToken, exchanged;
  const securityHttp = async (route, { body, grant, token = deviceToken, signal } = {}) => { const r = await fetch(origin + '/api/finance/collector-security/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(grant ? { 'X-Collector-Grant': grant } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); const data = await r.json(); if (!r.ok) throw Object.assign(new Error(data.statusMessage || data.message || 'refused'), { status: r.status }); return data; };
  const config = { baseUrl: origin, token: deviceToken, accountInfo: [{ _id: String(card._id), primaryCard: '12345', name: 'Fictional Amex', ownerId: A.id, provider: 'amex' }], accounts: {}, mode: 'protected' };
  let live = null;
  const setup = async () => {
    localKey = await store.withLock(() => store.deviceKey(generation, { create: true })); trustToken = await store.withLock(() => store.trustCredential(generation, { create: true }));
    const request = await securityHttp('requests', { body: { action: 'enroll', installationId, generation, publicKey: localKey.publicKey, trustHash: sha256(trustToken), state: randomBytes(32).toString('hex'), codeChallenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: 'http://127.0.0.1:49123/collector-callback' } });
    const approved = ok(await call('/api/finance/collector-security/requests/' + request.id, { method: 'POST', token: A.token, body: { password: PASSWORD, code: '' } }), 'owner approval');
    exchanged = await securityHttp('exchange', { body: { id: request.id, code: new URL(approved.redirectUri).searchParams.get('code'), verifier } });
    const abort = new AbortController(), transport = (_c, route, options = {}) => securityHttp(route, options);
    live = { mode: 'protected', installationId, abort, broker: { generation, localKey, remote: m.authz.keyService(config, { grant: exchanged.grant, expiresAt: exchanged.expiresAt, installationId, generation }, abort.signal, { renew: () => securityHttp('session', { body: { installationId, generation, trustToken } }), call: transport }) } };
  };
  const banks = async () => ok(await call(capi + 'bank/accounts', { token: deviceToken }), 'bank metadata').accounts;
  const write = (id, aad, value) => store.withLock(() => store.save(id, aad, value, live.broker));
  const grant = ids => call(api + 'bank/collectors/' + String(device._id), { method: 'PUT', token: A.token, body: { bankAccountIds: ids } });
  const claim = async () => ok(await call(capi + 'bank/claim', { method: 'POST', token: deviceToken, body: {} }), 'claim');
  const status = (jobId, state, message = '') => call(capi + 'bank/status', { method: 'POST', token: deviceToken, body: { jobId, state, message } });
  // A claimed Ikeda job must be a retrieval; an observe job (the base) is closed instead of being run (it would wait for a person).
  const claimRetrieve = async () => { const c = await claim(); if (c.job && c.job.kind !== 'retrieve') { await status(c.job.jobId, 'failed', 'fixture: observe job not run'); assert.fail('ikeda:queue-retrieve (the claimed Ikeda job is ' + c.job.kind + ')'); } return c; };
  const upload = async (_c, _a, item, _l, { base, route, query }) => { const bytes = await readFile(path.join(item.directory, item.manifest.filename)); const r = await fetch(origin + base + route + '?' + new URLSearchParams(query), { method: 'POST', headers: { Authorization: 'Bearer ' + deviceToken, 'Content-Type': item.manifest.sourceFormat === 'json' ? 'application/json' : 'text/csv' }, body: bytes }); const data = await r.json().catch(() => null); if (r.status !== 200) throw Object.assign(new Error('upload ' + r.status + ' ' + JSON.stringify(data).slice(0, 200)), { status: r.status, serverCode: data?.data?.code }); await m.vault.replaceVaultFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...item.manifest, acknowledgedAt: new Date().toISOString(), importId: data.id }, null, 2)); return data; };
  const runPc = async (claimed, fake, { now = Date.now, loginTimeoutMs = 60000 } = {}) => {
    const seen = [], launches = [];
    const bankStatus = async (state, text) => { seen.push(state + ':' + text); ok(await status(claimed.job.jobId, state, text), 'status ' + state); };
    let result = null, error = null;
    try { result = await m.index.runBankJob(claimed, config, live, { status: bankStatus, upload, directory: collectorDir, now, onLaunch: fake.onLaunch(launches), login: m.index.bankLoginFor(claimed, config, live, { store, root: collectorDir, assert: () => {} }), collect: (b, j, r, s, o) => m.bank.collectBankStatement(b, j, r, s, { ...o, loginTimeoutMs, downloadTimeoutMs: 60000, pollMs: 500 }) }); }
    catch (e) { error = e; await status(claimed.job.jobId, 'failed', 'Open the downloader setup screen on the connected PC for details').catch(() => {}); }
    return { seen, error, result, launches };
  };
  const markerOf = id => readFile(path.join(collectorDir, 'bank-login', 'ikeda-' + id + '.json'), 'utf8').then(JSON.parse, () => null);
  let checks = 0, failed = 0; const only = (process.env.OMF_IKEDA_ONLY_S || '').split(',').filter(Boolean);
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (only.length && !only.includes(key)) return; try { await fn(); checks++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900)); } };
  try { await setup(); } catch (e) { console.log('SETUP protected enrollment failed: ' + String(e?.message || e).slice(0, 300)); process.exit(3); }
  const K = await account(A, 'Ikeda 普通（架空）', IKEDA()), K2 = await account(A, 'Ikeda not granted', IKEDA()), R = await account(A, 'Rakuten 標準（架空）', { provider: 'rakuten', variant: 'standard', coverage: { from: '2026-01-01', to: null } });
  ok(await grant([K, R]), 'grant K,R');

  await leg('S0 connection: an Ikeda portal connection needs no uploaded CSV — it is saved with its native 10-column template (勘定日 date, 摘要, お支払金額 out, お預り金額 in, 残高), the account identity kept on the connection', async () => {
    assert.deepEqual(fallbacks, [], 'ikeda:connection-native-template ' + JSON.stringify(fallbacks[0] || {}));
    const saved = (await BankAccount.findById(K).lean()).connection, t = await m.Pay.BankTemplate.findById(saved.templateId).lean();
    assert.deepEqual([t.headers, t.mapping.date, t.mapping.description, t.mapping.outflow, t.mapping.inflow, t.mapping.balance, t.mapping.transactionId, t.amountSign], [CSV_HEADER, '0', '9', '2', '3', '4', '', 'outflow-positive'], 'ikeda:native-template-shape');
    assert.deepEqual(saved.accountIdentity, IDENTITY, 'ikeda:connection-identity');
  });

  await leg('S1 protected setup: the PC seals the Ikeda password-only login as its own account entry through the real key service and opens it once for its claimed portal retrieval; wrong shape/owner/account/variant/provider/grant never open it', async () => {
    const input = m.index.bankLoginInput({ bankAccountId: K, portalPassword: 'Fict-Pw-12' });
    assert.deepEqual(input, { bankAccountId: K, portalPassword: 'Fict-Pw-12' }, 'ikeda:setup-input');
    assert.deepEqual(await m.index.saveBankLogin(input, { live, config, banks, write, root: collectorDir }), { saved: true }, 'ikeda:setup-saved');
    const sealed = await readFile(path.join(collectorDir, 'secrets', 'ikeda-' + K + '.sealed'), 'utf8'); assert.ok(!sealed.includes('Fict-Pw-12'), 'ikeda:setup-ciphertext-only');
    assert.ok(await mongoose.connection.db.collection('collectorwrappedkeys').findOne({ entryId: 'ikeda-' + K }), 'ikeda:setup-key-held-by-omf');
    const claimLike = (kind = 'retrieve', variant = 'portal', provider = 'ikeda', id = K) => ({ job: { jobId: randomUUID(), kind, provider, snapshot: { provider, variant } }, account: { _id: id, ownerId: A.id } });
    const login = m.index.bankLoginFor(claimLike(), config, live, { store, root: collectorDir, assert: () => {} });
    assert.equal(await login.state(), 'ready', 'ikeda:setup-ready'); assert.deepEqual(await login.open(), { password: 'Fict-Pw-12' }, 'ikeda:setup-opens');
    for (const [label, args] of [['observe', ['observe']], ['direct', ['retrieve', 'direct']], ['none', ['retrieve', null]]]) assert.equal(m.index.bankLoginFor(claimLike(...args), config, live, { store, root: collectorDir }), null, 'ikeda:login-kind ' + label);
    for (const bad of [{ bankAccountId: K, portalPassword: 'x'.repeat(13) }, { bankAccountId: K, portalPassword: '' }, { bankAccountId: K, password: 'p' }, { bankAccountId: K, portalPassword: 'p', username: 'u' }, { bankAccountId: K, portalPassword: 7 }]) assert.throws(() => m.index.bankLoginInput(bad), Error, 'ikeda:setup-bad-body ' + JSON.stringify(bad).replace(/x{5,}/, 'x…'));
    const refused = async (input, code, extra = {}) => { let e = null; try { await m.index.saveBankLogin(input, { live, config, banks, write, root: collectorDir, ...extra }); } catch (error) { e = error; } assert.equal(e?.code, code, 'ikeda:setup-refused ' + code + ' ' + JSON.stringify(input).slice(0, 80)); };
    await refused({ bankAccountId: K, username: 'u', password: 'p' }, 'unsupported'); await refused({ bankAccountId: R, portalPassword: 'p' }, 'unsupported'); await refused({ bankAccountId: K2, portalPassword: 'p' }, 'forbidden');
    await refused({ bankAccountId: K, portalPassword: 'p' }, 'forbidden', { config: { ...config, accountInfo: [{ ...config.accountInfo[0], ownerId: B.id }] } });
    const reopen = () => m.index.bankLoginFor(claimLike(), config, live, { store, root: collectorDir, assert: () => {} }).open().then(() => 'opened', e => e.code || 'error');
    for (const change of [{ 'connection.variant': 'direct' }, { 'connection.provider': 'resona' }, { 'connection.variant': null }]) { const saved = await BankAccount.findById(K).lean(); await BankAccount.updateOne({ _id: K }, { $set: change }); assert.equal(await reopen(), 'bank-login-unavailable', 'ikeda:key-live ' + JSON.stringify(change)); await BankAccount.updateOne({ _id: K }, { $set: { connection: saved.connection } }); }
    ok(await grant([R]), 'scope without K'); assert.equal(await reopen(), 'bank-login-unavailable', 'ikeda:key-scope'); ok(await grant([K, R]), 'scope restored');
    assert.equal(await reopen(), 'opened', 'ikeda:key-restored');
  });
  await leg('S2 queue: an Ikeda portal 取得 is a retrieval frozen with the bank window (前々月1日〜当日 JST) as its effective period, the requested open period and the unavailable part kept apart; a wholly unavailable closed period and a missing account identity are refused with the reason; other banks\' snapshots are unchanged', async () => {
    const r = ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync K');
    assert.equal(r.job.kind, 'retrieve', 'ikeda:queue-retrieve');
    assert.deepEqual(r.job.snapshot.coverage, { from: availableFrom, to: today }, 'ikeda:queue-effective');
    assert.deepEqual(r.job.snapshot.requestedCoverage, { from: requestedFrom, to: null }, 'ikeda:queue-requested');
    assert.deepEqual(r.job.snapshot.missingCoverage, { from: requestedFrom, to: addDays(availableFrom, -1) }, 'ikeda:queue-missing');
    assert.deepEqual(r.job.snapshot.accountIdentity, IDENTITY, 'ikeda:queue-identity-frozen');
    assert.match(r.message, new RegExp(addDays(availableFrom, -1)), 'ikeda:queue-message-missing');
    assert.equal((await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} })).status, 409, 'ikeda:queue-exclusive');
    const closed = await account(A, 'Ikeda closed old', IKEDA({ coverage: { from: '2025-01-01', to: '2025-03-31' } })); ok(await grant([K, R, closed]), 'grant closed');
    const c = await call(api + 'bank/accounts/' + closed + '/sync', { method: 'POST', token: A.token, body: {} });
    assert.equal(c.status, 409, 'ikeda:queue-unavailable ' + JSON.stringify(c.data).slice(0, 200)); assert.match(JSON.stringify(c.data), /CSV/, 'ikeda:queue-unavailable-manual-csv'); assert.equal(await BankJob.countDocuments({ bankAccountId: oid(closed) }), 0);
    const noId = await account(A, 'Ikeda without identity', IKEDA({ accountIdentity: undefined })); ok(await grant([K, R, closed, noId]), 'grant noId');
    assert.equal((await call(api + 'bank/accounts/' + noId + '/sync', { method: 'POST', token: A.token, body: {} })).status, 400, 'ikeda:queue-identity-required');
    for (const bad of [{ branch: '', type: '普通', number: '0000001' }, { branch: 'カクウ支店', type: '普通', number: '0001' }, { branch: 'カクウ支店', type: '普通', number: '00000011' }, { branch: 'カクウ支店', type: 'x', number: '0000001' }]) assert.equal((await call(api + 'bank/accounts/' + noId + '/connection', { method: 'PUT', token: A.token, body: IKEDA({ accountIdentity: bad }) })).status, 400, 'ikeda:identity-input ' + JSON.stringify(bad));
    const rs = ok(await call(api + 'bank/accounts/' + R + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync R');
    const t = (await m.Pay.BankTemplate.findById(rs.job.snapshot.templateId).lean());
    const expected = { templateId: String(t._id), templateRevision: Number(t.revision || 0), headers: [...t.headers], mapping: { ...t.mapping }, amountSign: t.amountSign, transactionIdConfirmed: false, parserVersion: 'bank-template-1', currency: 'JPY', provider: 'rakuten', accountLabel: null, variant: 'standard', coverage: { from: '2026-01-01', to: today } };
    assert.equal(rs.job.snapshotHash, sha256(JSON.stringify(expected)), 'ikeda:other-snapshot-unchanged');
    await BankJob.updateOne({ jobId: rs.job.jobId }, { $set: { state: 'superseded', open: false } });
  });
  let firstJob = null;
  await leg('S3 normal native capture: the claimed portal job runs through the collector\'s own launcher (forced headless, intercepted) — certificate login, the saved password once on the visible cc form, exact account, calendar period, counted Shift_JIS CSV, native import with the 10 original columns, logout, ack', async () => {
    const fake = businessGate({ today }); let claimed = await claim(), queued = null; assert.equal(claimed.job?.snapshot?.provider, 'ikeda', 'claimed the Ikeda job');
    if (claimed.job.kind !== 'retrieve') {
      // A tree that queued an observe job (the base): close it and hand the PC a retrieval frozen as the fixed server freezes it, so the
      // collector side shows its own behaviour on the same claim route.
      queued = claimed.job.kind; await status(claimed.job.jobId, 'failed', 'fixture: observe job not run');
      const snapshot = { ...claimed.job.snapshot, coverage: { from: availableFrom, to: today }, requestedCoverage: { from: requestedFrom, to: null }, accountIdentity: { ...IDENTITY } };
      await BankJob.create({ ownerId: A.id, bankAccountId: oid(K), jobId: randomUUID(), kind: 'retrieve', state: 'queued', open: true, requestedAt: new Date(), lastMessage: 'fixture retrieval', snapshot, snapshotHash: sha256(JSON.stringify(snapshot)), statementIds: [], observation: null });
      claimed = await claim();
    }
    const r = await runPc(claimed, fake); firstJob = claimed.job.jobId;
    assert.equal(queued, null, 'ikeda:capture-retrieve-queued (the queue gave a ' + queued + ' job; collector on a retrieval: ' + String(r.error?.code || r.error?.message || r.result?.failed || 'no error').slice(0, 200) + ')');
    assert.equal(r.error, null, 'ikeda:capture-no-error ' + String(r.error?.message || '').slice(0, 300) + ' | ' + r.seen.slice(-3).join(' | '));
    assert.equal(r.result?.failed ?? null, null, 'ikeda:capture-not-failed ' + String(r.result?.failed || ''));
    const job = await BankJob.findOne({ jobId: claimed.job.jobId }).lean(); assert.equal(job.state, 'complete', 'ikeda:capture-complete'); assert.equal(job.statementIds.length, 1);
    const statement = await BankStatement.findById(job.statementIds[0]).lean(); assert.equal(statement.capture.state, 'imported', 'ikeda:capture-imported ' + statement.capture.reason);
    const rows = await BankRow.find({ bankAccountId: oid(K) }).sort({ date: 1 }).lean(); const want = fake.rows.filter(x => x.acct === 'A4');
    assert.equal(rows.length, want.length, 'ikeda:capture-rows'); assert.deepEqual(rows.map(x => [x.date, x.amount, x.balance]), want.map(x => [x.date, x.out ?? -x.in, x.balance]), 'ikeda:capture-values');
    for (const row of rows) { const raw = row.provenance[0].raw; assert.equal(raw.length, 10, 'ikeda:capture-original-10-columns'); assert.equal(row.provenance[0].channel, 'collector'); assert.equal(row.idKind, 'file-row'); }
    assert.deepEqual(fake.stats.ccPosts, [{ ok: true, keyboardOff: true }], 'ikeda:capture-one-submission');
    assert.deepEqual([fake.stats.publicPosts, fake.stats.hiddenPosts, fake.stats.foreign.length], [0, 0, 0], 'ikeda:capture-no-public-hidden-foreign');
    assert.equal(fake.stats.searches.at(-1)?.acct, 'A4', 'ikeda:capture-exact-account'); assert.deepEqual([fake.stats.searches.at(-1).from, fake.stats.searches.at(-1).to], [availableFrom, today], 'ikeda:capture-calendar-period');
    assert.equal(fake.stats.loggedOut, true, 'ikeda:capture-logout');
    assert.equal(await markerOf(K), null, 'ikeda:capture-marker-cleared-after-direct-sign-in');
    const manifests = []; for (const d of await readdir(path.join(collectorDir, 'outbox', 'bank', K))) { try { manifests.push(JSON.parse(await readFile(path.join(collectorDir, 'outbox', 'bank', K, d, 'manifest.json'), 'utf8'))); } catch { /* no manifest */ } }
    assert.ok(manifests.length === 1 && manifests[0].acknowledgedAt, 'ikeda:capture-acknowledged');
    const text = JSON.stringify(r.seen); assert.doesNotMatch(text, /jsessionid|Fict-Pw|FICT0001|FICTCODE/, 'ikeda:status-no-session-data');
  });
  await leg('S4 replay/overlap/recovery: the same manifest again is a duplicate; a later job over the same window anchors the known rows and adds only the new one; a crash after the download is recovered from the verified file only; a partial file is never recovered', async () => {
    const dir = path.join(collectorDir, 'outbox', 'bank', K, firstJob), manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const again = await upload(config, null, { directory: dir, manifest }, live, { base: capi, route: 'bank/upload', query: m.index.bankUploadQuery(manifest) }); assert.equal(again.duplicate, true, 'ikeda:replay-duplicate');
    const before = await BankRow.countDocuments({ bankAccountId: oid(K) });
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync again');
    const fake = businessGate({ today }); fake.rows.push({ acct: 'A4', date: addDays(today, -1) > fake.rows[2].date ? addDays(today, -1) : today, in: 300, balance: 10800, desc: '追加入金（架空）' });
    const second = await claimRetrieve(), r2 = await runPc(second, fake); assert.equal(r2.error, null, 'second run ' + String(r2.error?.message || '')); assert.equal(r2.result?.failed ?? null, null, 'second failed ' + r2.result?.failed);
    assert.equal(await BankRow.countDocuments({ bankAccountId: oid(K) }), before + 1, 'ikeda:overlap-dedup');
    // crash after the download, before the manifest: the reclaimed job rebuilds the manifest from the verified file and never exports again
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync third');
    const third = await claimRetrieve(), dir3 = path.join(collectorDir, 'outbox', 'bank', K, third.job.jobId); await mkdir(dir3, { recursive: true });
    const guid = randomUUID(), bytes = csvBytes(fake.rows.filter(x => x.acct === 'A4'));
    await writeFile(path.join(dir3, guid), bytes); await writeFile(path.join(dir3, 'download.json'), JSON.stringify({ guid, host: new URL(PORTAL).hostname, origin: PORTAL, blob: true, suggestedFilename: 'nyushukkin.csv' }));
    await writeFile(path.join(dir3, 'attempt.json'), JSON.stringify({ bankAccountId: K, ownerId: A.id, origin, jobId: third.job.jobId, snapshotHash: third.job.snapshotHash, provider: 'ikeda', period: third.job.snapshot.coverage.from + '〜' + third.job.snapshot.coverage.to, labelChecked: false, requestedAt: new Date().toISOString(), expect: { rows: 4, from: third.job.snapshot.coverage.from, to: third.job.snapshot.coverage.to } }));
    const fake3 = businessGate({ today }), r3 = await runPc(third, fake3);
    assert.equal(r3.error, null, 'recovery ' + String(r3.error?.message || '')); assert.equal(r3.result?.failed ?? null, null, 'ikeda:recovered ' + r3.result?.failed);
    assert.equal(fake3.stats.requests.length, 0, 'ikeda:recovered-without-bank'); assert.equal((await BankJob.findOne({ jobId: third.job.jobId }).lean()).state, 'complete');
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync fourth');
    const fourth = await claimRetrieve(), dir4 = path.join(collectorDir, 'outbox', 'bank', K, fourth.job.jobId); await mkdir(dir4, { recursive: true });
    const guid4 = randomUUID(); await writeFile(path.join(dir4, guid4), csvBytes(fake.rows.filter(x => x.acct === 'A4').slice(0, 2))); await writeFile(path.join(dir4, 'download.json'), JSON.stringify({ guid: guid4, host: new URL(PORTAL).hostname, origin: PORTAL, blob: true, suggestedFilename: 'nyushukkin.csv' }));
    await writeFile(path.join(dir4, 'attempt.json'), JSON.stringify({ bankAccountId: K, ownerId: A.id, origin, jobId: fourth.job.jobId, snapshotHash: fourth.job.snapshotHash, provider: 'ikeda', period: 'x', labelChecked: false, requestedAt: new Date().toISOString(), expect: { rows: 4, from: fourth.job.snapshot.coverage.from, to: fourth.job.snapshot.coverage.to } }));
    const fake4 = businessGate({ today }), r4 = await runPc(fourth, fake4);
    assert.ok(r4.result?.failed, 'ikeda:recovery-verified (a partial file was recovered as complete)'); assert.equal(fake4.stats.requests.length, 0, 'no export after the attempt');
    assert.equal((await BankJob.findOne({ jobId: fourth.job.jobId }).lean()).statementIds.length, 0, 'ikeda:recovery-nothing-uploaded');
  });
  await leg('S5 refused and uncertain sign-in: a refusal is remembered and never submitted again until the owner retries or re-saves; an uncertain end keeps the marker; the retry allows exactly one more submission', async () => {
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync');
    const refuse = businessGate({ today, loginOutcome: 'refuse' }), r1 = await runPc(await claimRetrieve(), refuse, { loginTimeoutMs: 15000 });
    assert.equal(refuse.stats.ccPosts.length, 1, 'ikeda:refused-one-submission'); assert.match(String(r1.result?.failed || ''), /受け付けませんでした/, 'ikeda:refused-failed-text ' + String(r1.result?.failed || r1.error?.message));
    assert.equal((await markerOf(K))?.kind, 'refused', 'ikeda:refused-marker');
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync after refusal');
    const fake2 = businessGate({ today }), r2 = await runPc(await claimRetrieve(), fake2, { loginTimeoutMs: 8000 });
    assert.equal(fake2.stats.ccPosts.length, 0, 'ikeda:no-resubmit-refused'); assert.ok(r2.seen.some(s => s.startsWith('verification_required:')), 'ikeda:refused-asks-person');
    assert.deepEqual(await m.index.retryBankLogin({ bankAccountId: K }, { live, config, banks, store, root: collectorDir, assert: () => {} }), { retry: true }, 'ikeda:retry');
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync after retry');
    const unsure = businessGate({ today, loginOutcome: 'uncertain' }); await runPc(await claimRetrieve(), unsure, { loginTimeoutMs: 15000 });
    assert.equal(unsure.stats.ccPosts.length, 1, 'ikeda:uncertain-one-submission'); assert.equal((await markerOf(K))?.kind, 'uncertain', 'ikeda:uncertain-marker');
    ok(await call(api + 'bank/accounts/' + K + '/sync', { method: 'POST', token: A.token, body: {} }), 'sync after uncertain');
    const fake3 = businessGate({ today }); await runPc(await claimRetrieve(), fake3, { loginTimeoutMs: 8000 }); assert.equal(fake3.stats.ccPosts.length, 0, 'ikeda:no-resubmit-uncertain');
    await m.index.retryBankLogin({ bankAccountId: K }, { live, config, banks, store, root: collectorDir, assert: () => {} });
    assert.equal(await markerOf(K), null, 'ikeda:retry-cleared');
  });
  await leg('S6 daily and window: a scheduled run freezes that day\'s bank window; a job queued before a month rollover is refused by the PC before any bank page; a wholly unavailable closed period is unsupported for the schedule; a period the bank no longer offers that no imported capture covered is shown as an archive gap', async () => {
    // a fresh account: the manual runs above already made today a run day for K (one automatic run per JST day)
    const t = new Date(), day = J.jstDay(t), D = await account(A, 'Ikeda daily（架空）', IKEDA()); ok(await grant([K, R, D]), 'grant daily');
    ok(await call(api + 'bank/accounts/' + D + '/schedule', { method: 'PUT', token: A.token, body: { enabled: true, hour: 0, revision: 0 } }), 'enable');
    const tick = await m.schedule.runBankSchedule(t); const job = await BankJob.findOne({ jobId: { $in: tick.queued }, bankAccountId: oid(D) }).lean();
    assert.ok(job, 'ikeda:schedule-queued ' + JSON.stringify(tick)); assert.deepEqual(job.snapshot.coverage, { from: monthBeforeLast(day), to: day }, 'ikeda:schedule-effective');
    const claimed = await claim(); assert.equal(claimed.job.jobId, job.jobId);
    const rollover = Date.parse(addDays(new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 1)).toISOString().slice(0, 10), 0) + 'T03:00:00Z'), fake = businessGate({ today });
    const r = await runPc(claimed, fake, { now: () => rollover }); assert.equal(fake.stats.requests.length, 0, 'ikeda:rollover-no-bank-page');
    assert.match(String(r.result?.failed || ''), /照会できる期間/, 'ikeda:rollover-precheck ' + String(r.result?.failed || r.error?.message));
    const view = await m.schedule.readBankSchedule(A.id, D, t); assert.equal(view.availability?.from, availableFrom, 'ikeda:schedule-view-window');
    const old = await account(A, 'Ikeda offline', IKEDA({ coverage: { from: '2026-01-01', to: null } }));
    await BankJob.create({ ownerId: A.id, bankAccountId: oid(old), jobId: randomUUID(), kind: 'retrieve', state: 'complete', open: false, requestedAt: new Date('2026-03-10T00:00:00Z'), completedAt: new Date('2026-03-10T00:10:00Z'), snapshot: { provider: 'ikeda', variant: 'portal', coverage: { from: '2026-01-01', to: '2026-03-10' } }, snapshotHash: 'fictional', statementIds: [], observation: null });
    const gapView = await m.schedule.readBankSchedule(A.id, old, t); const gaps = gapView.availability?.gaps || [];
    assert.deepEqual(gaps, [{ from: '2026-01-01', to: addDays(availableFrom, -1) }], 'ikeda:archive-gap (a completed job without an imported capture proves nothing; the bank no longer offers the period) ' + JSON.stringify(gaps));
    const closed = await account(A, 'Ikeda closed sched', IKEDA({ coverage: { from: '2025-01-01', to: '2025-02-28' } })); ok(await grant([K, R, D, closed]), 'grant'); const sv = await m.schedule.readBankSchedule(A.id, closed, t);
    assert.equal(sv.supported, false, 'ikeda:schedule-unavailable'); assert.equal((await call(api + 'bank/accounts/' + closed + '/schedule', { method: 'PUT', token: A.token, body: { enabled: true, hour: 0, revision: 0 } })).status, 400, 'ikeda:schedule-unavailable-refused');
  });
  await leg('S7 other lanes: an owner CSV of the same bank format is guessed (勘定日) and imported next to the collector rows without duplicates; a Rakuten standard key and job keep their binding and snapshot', async () => {
    const fake = businessGate({ today }), bytes = csvBytes(fake.rows.filter(x => x.acct === 'A4'));
    const d = ok(await call(api + 'bank/files?name=manual-ikeda.csv', { method: 'POST', token: A.token, raw: bytes }), 'upload').document, sheet = ok(await call(api + 'bank/files/' + d.id + '/sheet', { token: A.token }), 'sheet');
    assert.deepEqual([sheet.mapping.date, sheet.mapping.description, sheet.mapping.outflow, sheet.mapping.inflow, sheet.mapping.balance], ['0', '9', '2', '3', '4'], 'ikeda:manual-csv-guess');
    const preview = ok(await call(api + 'bank/files/' + d.id + '/preview', { method: 'POST', token: A.token, body: { sheet: sheet.sheet, headerRow: sheet.headerRow, mapping: sheet.mapping, bankAccountId: K } }), 'preview');
    assert.equal(preview.counts.new, 0, 'ikeda:manual-csv-anchored-to-collector-rows ' + JSON.stringify(preview.counts));
    const rk = m.index.bankLoginFor({ job: { jobId: 'x', kind: 'retrieve', provider: 'rakuten', snapshot: { provider: 'rakuten', variant: 'standard' } }, account: { _id: R, ownerId: A.id } }, config, live, { store, root: collectorDir });
    assert.ok(rk && rk.entry === 'rakuten-' + R, 'ikeda:rakuten-login-handle-unchanged');
    assert.deepEqual(await m.index.saveBankLogin(m.index.bankLoginInput({ bankAccountId: R, username: 'fict-user', password: 'Fict-Pass-1' }), { live, config, banks, write, root: collectorDir }), { saved: true }, 'ikeda:rakuten-save-unchanged');
  });
  // Parent findings C3/C4 (PARENT-FOLD-REQUEST.txt): the archive proof of a connection. Seeded collector captures (the shape acceptBankCapture
  // writes: capture.snapshot is the job's frozen snapshot) and their completed jobs, read through the real readBankSchedule service.
  let seq = 0;
  const seedCaptures = async (acct, list) => {
    const jobs = [], statements = [];
    for (const { coverage, provider = 'ikeda', variant = 'portal', identity = IDENTITY, templateId = 'tpl-fictional', state = 'imported', jobState = 'complete' } of list) {
      const jobId = randomUUID(), _id = new mongoose.Types.ObjectId(), snapshot = { templateId, provider, variant, coverage, accountIdentity: identity ? { ...identity } : null };
      statements.push({ _id, ownerId: oid(A.id), hash: sha256('archive-' + (seq++) + '-' + jobId), name: 'archive.csv', mimeType: 'text/csv', size: 10, sheetNames: ['Sheet1'], capture: { bankAccountId: String(acct), jobId, kind: 'retrieve', collectorId: null, channel: 'collector', labelChecked: false, snapshot, snapshotHash: 'fictional', sourceHost: 'www.0161.houjinportal.anser.ne.jp', capturedAt: null, receivedAt: new Date(), state, reason: null, rows: { new: 0, existing: 0, unchanged: 0, differs: 0 } } });
      jobs.push({ ownerId: oid(A.id), bankAccountId: oid(acct), jobId, kind: 'retrieve', state: jobState, open: false, requestedAt: new Date(Date.parse(coverage.to + 'T01:00:00Z')), completedAt: new Date(Date.parse(coverage.to + 'T01:10:00Z')), snapshot, snapshotHash: 'fictional', statementIds: [_id], observation: null });
    }
    await BankStatement.insertMany(statements); await BankJob.insertMany(jobs);
  };
  await leg('S8 archive proof belongs to the connection: an imported capture of another account number, another bank or login type, or a held capture never confirms an old period of this Ikeda connection; one of the same bank/login type/full identity does, also under a changed template', async () => {
    const t = new Date(), from = monthBeforeLast(J.jstDay(t)), acct = await account(A, 'Ikeda archive（架空）', IKEDA({ coverage: { from: '2025-01-01', to: null } })), old = { from: '2025-01-01', to: addDays(from, -1) };
    const gaps = async () => (await m.schedule.readBankSchedule(A.id, acct, t)).availability?.gaps;
    assert.deepEqual(await gaps(), [old], 'ikeda:archive-baseline');
    await seedCaptures(acct, [{ coverage: old, identity: { ...IDENTITY, number: '0000002' } }, { coverage: old, provider: 'paypay', variant: 'standard', identity: null }, { coverage: old, variant: 'direct' }, { coverage: old, identity: { ...IDENTITY, branch: 'ベツ支店' } }, { coverage: old, state: 'needs_review' }]);
    assert.deepEqual(await gaps(), [old], 'ikeda:archive-identity (another number, branch, provider or variant, or a held capture, confirmed the period)');
    await seedCaptures(acct, [{ coverage: { from: '2025-01-01', to: '2025-06-30' }, templateId: 'tpl-changed' }]);
    assert.deepEqual(await gaps(), [{ from: '2025-07-01', to: old.to }], 'ikeda:archive-own-proof');
  });
  await leg('S9 archive proof is lifetime, from either source: 601 daily imported captures (their jobs not complete — the captures alone prove it), and 601 completed daily retrievals whose receipts are one duplicate capture (the jobs alone prove it); the oldest beyond any recent window', async () => {
    const t = new Date(), from = monthBeforeLast(J.jstDay(t));
    const days = Array.from({ length: 601 }, (_, i) => addDays('2025-03-01', i)).filter(d => d <= J.jstDay(t));
    const independent = (() => { let cursor = '2025-01-01'; for (const d of days) { const f = monthBeforeLast(d); if (f <= cursor && d >= cursor) cursor = addDays(d, 1); } return cursor > addDays(from, -1); })();
    assert.equal(independent, true, 'the seeded periods cover every old day (independent check)');
    const viaCaptures = await account(A, 'Ikeda daily archive（架空）', IKEDA({ coverage: { from: '2025-01-01', to: null } }));
    await seedCaptures(viaCaptures, days.map(d => ({ coverage: { from: monthBeforeLast(d), to: d }, jobState: 'failed' })));
    assert.deepEqual((await m.schedule.readBankSchedule(A.id, viaCaptures, t)).availability?.gaps, [], 'ikeda:archive-lifetime (confirmed old days reported as unconfirmed)');
    const viaJobs = await account(A, 'Ikeda daily repeat archive（架空）', IKEDA({ coverage: { from: '2025-01-01', to: null } }));
    await seedCaptures(viaJobs, [{ coverage: { from: '2025-01-01', to: '2025-01-31' } }]);
    const receipt = (await BankStatement.findOne({ 'capture.bankAccountId': String(viaJobs) }).lean())._id, base = (await BankJob.findOne({ bankAccountId: oid(viaJobs) }).lean()).snapshot;
    await BankJob.insertMany(days.map(d => ({ ownerId: oid(A.id), bankAccountId: oid(viaJobs), jobId: randomUUID(), kind: 'retrieve', state: 'complete', open: false, requestedAt: new Date(Date.parse(d + 'T01:00:00Z')), completedAt: new Date(Date.parse(d + 'T01:10:00Z')), snapshot: { ...base, coverage: { from: monthBeforeLast(d), to: d } }, snapshotHash: 'fictional', statementIds: [receipt], observation: null })));
    assert.deepEqual((await m.schedule.readBankSchedule(A.id, viaJobs, t)).availability?.gaps, [], 'ikeda:archive-lifetime-receipts (completed retrievals with a duplicate receipt reported as unconfirmed)');
  });
  // Parent finding C5: a later completed retrieval whose verified file is byte-identical to an earlier one (no new transactions) is received
  // by the real upload route as a duplicate of the first, immutable capture; its own, longer frozen period must still count as confirmed.
  // Jobs are frozen like queueBankSync freezes them (a real queued job's snapshot with another period) and run through the real collector
  // routes (upload, status) — only the read date is injected.
  const runReceipt = async (acct, snapshot, bytes) => {
    const jobId = randomUUID(), hash = sha256(JSON.stringify(snapshot));
    await BankJob.create({ ownerId: oid(A.id), bankAccountId: oid(acct), jobId, kind: 'retrieve', state: 'running', open: true, collectorId: device._id, leaseUntil: new Date(Date.now() + 120000), requestedAt: new Date(), lastAttemptAt: new Date(), lastMessage: 'fixture', snapshot, snapshotHash: hash, statementIds: [], observation: null });
    let receipt = null;
    if (bytes) { const r = await fetch(origin + capi + 'bank/upload?' + new URLSearchParams({ jobId, snapshotHash: hash, kind: 'statement', channel: 'collector', labelChecked: 'false', name: 'nyushukkin.csv' }), { method: 'POST', headers: { Authorization: 'Bearer ' + deviceToken, 'Content-Type': 'text/csv' }, body: bytes }); receipt = await r.json(); assert.equal(r.status, 200, 'upload ' + JSON.stringify(receipt).slice(0, 300)); }
    ok(await status(jobId, 'complete', 'fixture complete'), 'status complete'); return { jobId, receipt };
  };
  await leg('S10 a later completed retrieval with byte-identical rows (a duplicate receipt of the first, immutable capture) confirms its own longer period; an unreceived job, another account\'s receipt or another identity never does', async () => {
    const acct = await account(A, 'Ikeda repeat（架空）', IKEDA({ coverage: { from: '2026-01-05', to: null } })), other = await account(A, 'Ikeda repeat other（架空）', IKEDA({ coverage: { from: '2026-01-05', to: null } }));
    ok(await grant([K, R, acct, other]), 'grant repeat');
    const queued = ok(await call(api + 'bank/accounts/' + acct + '/sync', { method: 'POST', token: A.token, body: {} }), 'a real frozen snapshot').job; await BankJob.updateOne({ jobId: queued.jobId }, { $set: { state: 'superseded', open: false } });
    const frozen = cov => ({ ...queued.snapshot, coverage: cov, requestedCoverage: { from: '2026-01-05', to: null }, missingCoverage: null });
    const bytes = csvBytes([{ date: '2026-01-10', out: 1000, balance: 9000, desc: 'カクウ振込（架空）' }, { date: '2026-02-03', in: 2000, balance: 11000, desc: 'カクウ入金（架空）' }]);
    const first = await runReceipt(acct, frozen({ from: '2026-01-05', to: '2026-03-01' }), bytes);
    assert.equal(first.receipt.duplicate, false); assert.equal(first.receipt.state, 'imported', 'first receipt imported');
    const later = await runReceipt(acct, frozen({ from: '2026-01-05', to: '2026-03-31' }), bytes);
    assert.deepEqual([later.receipt.duplicate, later.receipt.id], [true, first.receipt.id], 'the later identical file is the first capture again (immutable, no new rows)');
    const capture = (await BankStatement.findById(first.receipt.id).lean()).capture; assert.deepEqual([capture.jobId, capture.snapshot.coverage.to], [first.jobId, '2026-03-01'], 'ikeda:repeat-first-capture-immutable');
    assert.equal(await BankRow.countDocuments({ bankAccountId: oid(acct) }), 2, 'ikeda:repeat-no-duplicate-rows');
    const t = new Date('2026-07-15T03:00:00Z'), gaps = async () => (await m.schedule.readBankSchedule(A.id, acct, t)).availability?.gaps;
    assert.deepEqual(await gaps(), [{ from: '2026-04-01', to: '2026-04-30' }], 'ikeda:repeat-later-period-confirmed (the later completed retrieval of the same file was not credited)');
    // not credited: a completed job with no receipt, a job whose receipt is another account's capture, a job frozen for another identity
    await runReceipt(acct, frozen({ from: '2026-01-05', to: '2026-04-30' }), null);
    const foreign = await runReceipt(other, { ...frozen({ from: '2026-01-05', to: '2026-03-10' }) }, csvBytes([{ date: '2026-01-12', out: 5, balance: 1, desc: '別口座（架空）' }]));
    await BankJob.create({ ownerId: oid(A.id), bankAccountId: oid(acct), jobId: randomUUID(), kind: 'retrieve', state: 'complete', open: false, requestedAt: new Date(), snapshot: frozen({ from: '2026-01-05', to: '2026-04-30' }), snapshotHash: 'fictional', statementIds: [oid(foreign.receipt.id)], observation: null });
    await BankJob.create({ ownerId: oid(A.id), bankAccountId: oid(acct), jobId: randomUUID(), kind: 'retrieve', state: 'complete', open: false, requestedAt: new Date(), snapshot: { ...frozen({ from: '2026-01-05', to: '2026-04-30' }), accountIdentity: { ...IDENTITY, number: '0000002' } }, snapshotHash: 'fictional', statementIds: [oid(first.receipt.id)], observation: null });
    assert.deepEqual(await gaps(), [{ from: '2026-04-01', to: '2026-04-30' }], 'ikeda:repeat-receipt-required (an unreceived job, another account\'s receipt or another identity confirmed the period)');
  });
  // Parent finding C6: a scheduled job queued for one full account identity is not authorized once the owner saved another identity.
  const claimFor = async acct => { const got = []; for (let i = 0; i < 20; i++) { const c = await claim(); if (!c.job) break; if (c.job.bankAccountId === acct) got.push(c.job); else ok(await status(c.job.jobId, 'failed', 'fixture: not this leg'), 'close other'); } return got; };
  await leg('S11 a replaced account identity closes the unclaimed scheduled job of the old identity (connection changed → 要確認); re-saving the schedule queues the new identity\'s run; a save that keeps the identity keeps the queued run; manual 取得 uses the current identity', async () => {
    const acct = await account(A, 'Ikeda identity change（架空）', IKEDA()); ok(await grant([K, R, acct]), 'grant identity');
    const t = new Date(); ok(await call(api + 'bank/accounts/' + acct + '/schedule', { method: 'PUT', token: A.token, body: { enabled: true, hour: 0, revision: 0 } }), 'enable');
    const tick1 = await m.schedule.runBankSchedule(t), old = await BankJob.findOne({ jobId: { $in: tick1.queued }, bankAccountId: oid(acct) }).lean();
    assert.equal(old?.snapshot?.accountIdentity?.number, '0000001', 'queued for the first identity');
    ok(await call(api + 'bank/accounts/' + acct + '/connection', { method: 'PUT', token: A.token, body: IKEDA({ accountLabel: '表示名だけ変更（架空）' }) }), 'same-identity save');
    assert.equal((await BankJob.findById(old._id).lean()).state, 'queued', 'ikeda:identity-same-save-keeps-run'); assert.notEqual((await m.schedule.readBankSchedule(A.id, acct, t)).status.state, 'reconfirm', 'ikeda:identity-same-save-no-reconfirm');
    ok(await call(api + 'bank/accounts/' + acct + '/connection', { method: 'PUT', token: A.token, body: IKEDA({ accountIdentity: { ...IDENTITY, number: '0000002' } }) }), 'identity replaced');
    const claimed = await claimFor(acct);
    assert.deepEqual(claimed.map(j => j.snapshot.accountIdentity.number), [], 'ikeda:identity-stale-scheduled-not-claimed (the old identity\'s scheduled job was handed to the PC)');
    assert.equal((await BankJob.findById(old._id).lean()).state, 'superseded', 'ikeda:identity-stale-superseded');
    const view = await m.schedule.readBankSchedule(A.id, acct, t); assert.equal(view.status.state, 'reconfirm', 'ikeda:identity-reconfirm');
    ok(await call(api + 'bank/accounts/' + acct + '/schedule', { method: 'PUT', token: A.token, body: { enabled: true, hour: 0, revision: view.schedule.revision } }), 're-save the schedule');
    const tick2 = await m.schedule.runBankSchedule(t), fresh = await BankJob.findOne({ jobId: { $in: tick2.queued }, bankAccountId: oid(acct) }).lean();
    assert.equal(fresh?.snapshot?.accountIdentity?.number, '0000002', 'ikeda:identity-resave-recovers');
    const run = await claimFor(acct); assert.deepEqual(run.map(j => j.snapshot.accountIdentity.number), ['0000002'], 'ikeda:identity-current-run-claimed'); ok(await status(run[0].jobId, 'complete', 'fixture complete'), 'complete');
    const manual = ok(await call(api + 'bank/accounts/' + acct + '/sync', { method: 'POST', token: A.token, body: {} }), 'manual sync').job; assert.equal(manual.snapshot.accountIdentity.number, '0000002', 'ikeda:identity-manual-current');
    await BankJob.updateOne({ jobId: manual.jobId }, { $set: { state: 'superseded', open: false } });
    assert.deepEqual(J.bankScheduleBinding({ provider: 'rakuten', variant: 'standard', templateId: 't', accountIdentity: { ...IDENTITY } }), { provider: 'rakuten', variant: 'standard', templateId: 't' }, 'ikeda:other-bank-binding-unchanged');
  });
  // Review F1 (final-review-01): a MANUAL retrieval frozen for one full account identity that no PC received yet is not authorized once the
  // owner saved another identity (or another bank/login type); a PC that already received it resumes it under its frozen identity (O5).
  // Everything goes through the owner routes, the collector's claim/status routes and the real collector run (runBankJob in owned Chrome);
  // only an expired lease is simulated by moving leaseUntil into the past.
  const A5 = { value: 'A5', text: '池田泉州銀行 カクウ支店 普通 0000002' }, NEW_IDENTITY = { ...IDENTITY, number: '0000002' };
  const twoAccounts = () => { const fake = businessGate({ today, accounts: [...ACCOUNTS, A5] }); fake.rows.push({ acct: 'A5', date: addDays(availableFrom, 6), in: 4200, balance: 54200, desc: 'カクウ新口座（架空）' }); return fake; };
  // What the PC does on its turn: claim (other legs' leftovers are closed), and run what it received for `acct` through the real collector.
  const pcTurn = async (acct, fake) => { const got = []; for (let i = 0; i < 20; i++) { const c = await claim(); if (!c.job) break; if (c.job.bankAccountId !== acct) { ok(await status(c.job.jobId, 'failed', 'fixture: not this leg'), 'close other'); continue; } got.push({ claimed: c, run: fake ? await runPc(c, fake) : null }); break; } return got; };
  const sync = async acct => ok(await call(api + 'bank/accounts/' + acct + '/sync', { method: 'POST', token: A.token, body: {} }), 'manual 取得').job;
  const connect = async (acct, body, label) => ok(await call(api + 'bank/accounts/' + acct + '/connection', { method: 'PUT', token: A.token, body }), label);
  const jobLine = async (acct, jobId) => ok(await call(api + 'bank/accounts/' + acct + '/jobs', { token: A.token }), 'jobs').jobs.find(j => j.jobId === jobId);
  const expire = jobId => BankJob.updateOne({ jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
  await leg('S12 a manual 取得 queued for one full account identity is closed before any PC receives it once the owner replaced the identity, type, branch or bank (no bank page; the job line says why; 取得 again runs the current account); a received job resumes under its frozen identity; template/period/label changes and other banks are claimed as before', async () => {
    const M = await account(A, 'Ikeda manual identity change（架空）', IKEDA()), M2 = await account(A, 'Ikeda manual same identity（架空）', IKEDA()), M3 = await account(A, 'Ikeda manual in flight（架空）', IKEDA()), M4 = await account(A, 'Ikeda manual roles（架空）', IKEDA()), M5 = await account(A, 'Ikeda manual bank change（架空）', IKEDA());
    ok(await grant([K, R, M, M2, M3, M4, M5]), 'grant manual');
    assert.deepEqual(await m.index.saveBankLogin(m.index.bankLoginInput({ bankAccountId: M, portalPassword: 'Fict-Pw-12' }), { live, config, banks, write, root: collectorDir }), { saved: true }, 'saved login for M');
    // the reproducing case: 取得 for 0000001, the owner saves 0000002, then the PC's turn
    const stale = await sync(M); assert.equal(stale.snapshot.accountIdentity.number, '0000001', 'queued for the first identity');
    await connect(M, IKEDA({ accountIdentity: NEW_IDENTITY }), 'identity replaced before the first claim');
    const fake = twoAccounts(), turn = await pcTurn(M, fake), imported = await BankRow.countDocuments({ bankAccountId: oid(M) });
    assert.deepEqual(turn.map(t => t.claimed.job.snapshot.accountIdentity.number), [], 'ikeda:manual-stale-identity-not-claimed (the old identity\'s manual job was handed to the PC: it chose ' + JSON.stringify(fake.stats.searches.map(s => s.acct)) + ' and imported ' + imported + ' rows into the re-pointed account)');
    assert.deepEqual([fake.stats.requests.length, turn.flatMap(t => t.run?.launches || []).length, imported], [0, 0, 0], 'ikeda:manual-stale-no-bank-page');
    const closed = await BankJob.findOne({ jobId: stale.jobId }).lean(), line = await jobLine(M, stale.jobId);
    assert.deepEqual([closed.state, closed.open, !!closed.completedAt, closed.leaseUntil ?? null], ['superseded', false, true, null], 'ikeda:manual-stale-superseded');
    assert.deepEqual([line.trigger, line.state, line.scheduledDay], ['manual', 'superseded', null], 'ikeda:manual-stale-line');
    assert.ok(/口座/.test(line.lastMessage) && /もう一度「取得」/.test(line.lastMessage) && /銀行へのログインは行っていません/.test(line.lastMessage) && !/自動取得/.test(line.lastMessage), 'ikeda:manual-stale-wording ' + line.lastMessage);
    // recovery: 取得 again freezes the current identity and the real collector exports that account only
    const current = await sync(M); assert.equal(current.snapshot.accountIdentity.number, '0000002', 'ikeda:manual-recovery-current');
    const fake2 = twoAccounts(), [again] = await pcTurn(M, fake2);
    assert.equal(again?.claimed.job.jobId, current.jobId, 'ikeda:manual-recovery-claimed');
    assert.deepEqual([again.run.error?.message ?? null, again.run.result?.failed ?? null], [null, null], 'ikeda:manual-recovery-ran ' + again.run.seen.slice(-3).join(' | '));
    assert.ok(fake2.stats.searches.length >= 1 && fake2.stats.searches.every(s => s.acct === 'A5'), 'ikeda:manual-recovery-runs-current-account ' + JSON.stringify(fake2.stats.searches.map(s => s.acct)));
    assert.deepEqual((await BankRow.find({ bankAccountId: oid(M) }).sort({ date: 1 }).lean()).map(r => [r.date, r.amount, r.balance]), fake2.rows.filter(r => r.acct === 'A5').map(r => [r.date, r.out ?? -r.in, r.balance]), 'ikeda:manual-recovery-imported');
    assert.equal((await BankJob.findOne({ jobId: current.jobId }).lean()).state, 'complete', 'ikeda:manual-recovery-complete');
    // the same full identity with another template, period and label stays claimable under its own frozen snapshot
    const kept = await sync(M2), template = ok(await call(api + 'bank/templates', { method: 'PUT', token: A.token, body: { name: 'Fictional Ikeda S12 template', headers: CSV_HEADER, mapping: { date: '0', description: '9', outflow: '2', inflow: '3', balance: '4' }, amountSign: 'outflow-positive' } }), 'other template').template.id;
    await connect(M2, IKEDA({ templateId: template, coverage: { from: availableFrom, to: null }, accountLabel: '表示名だけ変更（架空）' }), 'template/period/label changed');
    const before = Date.now(), [same] = await pcTurn(M2, null);
    assert.deepEqual([same?.claimed.job.jobId, same?.claimed.job.snapshotHash, same?.claimed.job.snapshot.accountIdentity.number], [kept.jobId, kept.snapshotHash, '0000001'], 'ikeda:manual-same-identity-claimed');
    assert.deepEqual([same.claimed.job.state, same.claimed.job.lastMessage, Date.parse(same.claimed.job.leaseUntil) >= before + 170000, Date.parse(same.claimed.job.lastAttemptAt) >= before - 1000], ['running', '取得を開始', true, true], 'ikeda:manual-claim-shape');
    ok(await status(kept.jobId, 'complete', 'fixture complete'), 'complete M2');
    // O5: received for 0000001, then the identity changes, the lease expires: the reclaim resumes the SAME job under 0000001
    const flight = await sync(M3), [first] = await pcTurn(M3, null); assert.equal(first?.claimed.job.jobId, flight.jobId, 'first claim');
    await connect(M3, IKEDA({ accountIdentity: NEW_IDENTITY }), 'identity replaced while in flight'); await expire(flight.jobId);
    const [resumed] = await pcTurn(M3, null);
    assert.deepEqual([resumed?.claimed.job.jobId, resumed?.claimed.job.snapshot.accountIdentity.number, resumed?.claimed.job.state], [flight.jobId, '0000001', 'running'], 'ikeda:manual-inflight-keeps-identity');
    ok(await status(flight.jobId, 'failed', 'fixture closed'), 'close M3');
    // each role compared whole: another type, another branch (same number) — and another bank — replace the account
    for (const [change, label] of [[{ ...IDENTITY, type: '当座' }, 'type'], [{ ...IDENTITY, branch: 'ベツ支店' }, 'branch']]) {
      await connect(M4, IKEDA(), 'identity restored'); const job = await sync(M4); await connect(M4, IKEDA({ accountIdentity: change }), label + ' changed');
      assert.deepEqual((await pcTurn(M4, null)).map(t => t.claimed.job.jobId), [], 'ikeda:manual-stale-' + label + '-change');
      assert.equal((await BankJob.findOne({ jobId: job.jobId }).lean()).state, 'superseded', 'ikeda:manual-stale-' + label + '-superseded');
    }
    const moved = await sync(M5); await connect(M5, { provider: 'rakuten', variant: 'standard', coverage: { from: '2026-01-01', to: null } }, 'bank changed');
    assert.deepEqual((await pcTurn(M5, null)).map(t => t.claimed.job.jobId), [], 'ikeda:manual-stale-provider-change'); assert.equal((await BankJob.findOne({ jobId: moved.jobId }).lean()).state, 'superseded', 'ikeda:manual-stale-provider-superseded');
    // another bank: a changed connection never closes its manual job; claim, document and reclaim keep their former shape
    const rq = await sync(R); await connect(R, { provider: 'rakuten', variant: 'standard', coverage: { from: '2026-02-01', to: null } }, 'rakuten period changed');
    const [rc] = await pcTurn(R, null);
    assert.deepEqual([rc?.claimed.job.jobId, rc?.claimed.job.snapshotHash], [rq.jobId, rq.snapshotHash], 'ikeda:other-bank-manual-claimed');
    assert.deepEqual([Object.keys(rc.claimed.job).sort(), Object.keys(rc.claimed.account).sort()], [['accountLabel', 'bankAccountId', 'collectorId', 'completedAt', 'eventChannel', 'hasObservation', 'id', 'jobId', 'kind', 'label', 'lastAttemptAt', 'lastMessage', 'leaseUntil', 'provider', 'requestedAt', 'snapshot', 'snapshotHash', 'state', 'statementIds', 'support'], ['_id', 'connection', 'currency', 'name', 'ownerId']], 'ikeda:other-bank-claim-shape');
    assert.deepEqual(Object.keys(await BankJob.findOne({ jobId: rq.jobId }).lean()).sort(), ['__v', '_id', 'bankAccountId', 'collectorId', 'createdAt', 'jobId', 'kind', 'lastAttemptAt', 'lastMessage', 'leaseUntil', 'observation', 'open', 'ownerId', 'requestedAt', 'snapshot', 'snapshotHash', 'state', 'statementIds', 'updatedAt'], 'ikeda:other-bank-document-unchanged');
    await expire(rq.jobId); const [rr] = await pcTurn(R, null); assert.deepEqual([rr?.claimed.job.jobId, rr?.claimed.job.snapshotHash], [rq.jobId, rq.snapshotHash], 'ikeda:other-bank-reclaim');
    const rline = await jobLine(R, rq.jobId); assert.deepEqual([rline.trigger, rline.state, rline.snapshotHash], ['manual', 'running', rq.snapshotHash], 'ikeda:other-bank-line');
    ok(await status(rq.jobId, 'complete', 'fixture complete'), 'complete R');
  });
  console.log('RECEIPT ' + JSON.stringify({ pass: failed === 0, checks, failed, bankCalls: 0, productionWrites: 0 }));
  await live?.broker?.remote?.end?.().catch(() => {}); await mongoose.disconnect(); server.close(); await rm(temp, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}

// ════════════════════════════ M: reintroduced defects ════════════════════════════
// [label, file, exact anchor, replacement, leg, assertion that must fail]
// leg 'U1' (shared/ copy, OMF_TEST_SHARED_DIR) · 'U2' (sibling module copy, OMF_TEST_*_MODULE; `test` = name pattern) · 'S' (server/shared
// tree copy as OMF_IKEDA_SRC, or a collector sibling copy as OMF_IKEDA_BANK_MODULE/OMF_IKEDA_INDEX_MODULE; `legs` = harness legs). Each
// anchor must hit exactly once (or the `guard` marker line is removed); an anchor miss, an import failure or an unrelated failure is a
// harness failure, never a catch. `expect` must match a failing assertion of that run.
const PO = 'collector/windows/bank-certificate-policy.ps1', SV = 'server/services/financeBankScheduleService.ts', IK = 'collector/banks/ikeda.mjs', BK = 'collector/bank.mjs', IX = 'collector/index.mjs', PM = 'shared/finance-payment-match.mjs', BS = 'shared/finance-bank-schedule.mjs', CS = 'server/services/financeBankCollectionService.ts', SS = 'server/services/financeCollectorSecurityService.ts';
export const MUTANTS = [
  { name: 'MC1-account-last-digits', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'account is chosen', edits: [['o.fields.number === identity.number); // guard:portal-account-exact', 'o.fields.number.endsWith(identity.number.slice(-4))); // guard:portal-account-exact']], expect: /ikeda-portal:choice-(exact|no-suffix-other-branch-type)/ },
  { name: 'MC2-first-account-unverified', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'certificate login, the saved password', edits: [['const choice = portalAccountChoice(list.options, identity);', "const choice = { index: 0, reason: 'first' };"], ["if (choice.index < 0 || now.selected !== choice.index) throw fail('account-unidentified'", "if (false) throw fail('account-unidentified'"]], expect: /ikeda-portal:(exact-account-range-calendar|exact-bytes|manifest-bound)/ },
  { name: 'MC3-count-unchecked', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'rows differ from', guard: 'portal-capture-count', expect: /ikeda-portal:count-mismatch/ },
  { name: 'MC4-origin-unchecked', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'pure: page states', guard: 'portal-capture-origin', expect: /ikeda-portal:capture origin/ },
  { name: 'MC5-public-form-is-login', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'pure: page states', edits: [["if (read.origin === c.cc && read.path === c.ccPath && read.password >= 1) return 'login'; // guard:portal-login-surface-only", "if (read.password >= 1) return 'login'; // guard:portal-login-surface-only"]], expect: /ikeda-portal:public-form-never-login/ },
  { name: 'MC6-first-password-field', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'certificate login, the saved password', edits: [['const fields = [...document.getElementsByName(c.login.password)].filter(visible);', 'const fields = [...document.getElementsByName(c.login.password)].slice(0, 1);']], expect: /ikeda-portal:(no-error|not-failed|one-submission)/ },
  { name: 'MC7-date-assigned-not-picked', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'certificate login, the saved password', edits: [["if (!(await evaluate(CALENDAR, { op: 'open', input, menu }))?.ok) throw fail('period-unidentified', '期間の入力欄を特定できません');", "await evaluate(({ input, day }) => { const e = document.getElementById(input); e.value = day; }, { input, day }); return;"]], expect: /ikeda-portal:(exact-account-range-calendar|not-failed|exact-bytes)/ },
  { name: 'MC8-stale-result-accepted', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'never counts; the job waits', edits: [['if (r && r.fresh && r.counts === 1 && (r.csv === 1 || r.count === 0))', 'if (r && r.counts === 1 && (r.csv === 1 || r.count === 0))']], expect: /ikeda-portal:stale-result/ },
  { name: 'MC9-login-not-direct', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'certificate login, the saved password', guard: 'portal-login-direct', expect: /ikeda-portal:marker-before-submit-cleared-after-direct-sign-in/ },
  { name: 'MC10-readonly-field-filled', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'certificate login, the saved password', edits: [['if (form.keyboard || !form.editable) {', 'if (false) {']], guard: 'portal-login-editable', expect: /ikeda-portal:one-submission/ },
  { name: 'MB1-capture-not-verified', leg: 'U2', file: BK, env: 'OMF_TEST_BANK_MODULE', test: 'rows differ from', guard: 'capture-verified', expect: /ikeda-portal:count-mismatch/ },
  { name: 'MB2-precheck-skipped', leg: 'U2', file: BK, env: 'OMF_TEST_BANK_MODULE', test: 'calendar refuses a day', guard: 'adapter-precheck', expect: /ikeda-portal:rollover-precheck/ },
  { name: 'MB3-partial-recovered', leg: 'S', file: BK, env: 'OMF_IKEDA_BANK_MODULE', legs: 'S0,S1,S2,S3,S4', guard: 'recovery-verified', expect: /ikeda:recovery-verified/ },
  { name: 'MI1-password-length', leg: 'S', file: IX, env: 'OMF_IKEDA_INDEX_MODULE', legs: 'S1', edits: [['body.portalPassword.length>IKEDA_PASSWORD_MAX', 'body.portalPassword.length>256']], expect: /ikeda:setup-bad-body/ },
  { name: 'MI2-observe-gets-login', leg: 'S', file: IX, env: 'OMF_IKEDA_INDEX_MODULE', legs: 'S1', edits: [["if((provider==='rakuten'||provider==='ikeda')&&job.kind!=='retrieve')return null;", "if(provider==='rakuten'&&job.kind!=='retrieve')return null;"]], expect: /ikeda:login-kind observe/ },
  { name: 'MS1-key-map-without-ikeda', leg: 'S', file: SS, legs: 'S1', edits: [[",['ikeda','portal']])", '])']], expect: /Invalid key entry/ },
  { name: 'MS2-requested-not-effective', leg: 'S', file: CS, legs: 'S2', edits: [['if(w){snapshot.coverage=w.effective;', 'if(w){']], expect: /ikeda:queue-effective/ },
  { name: 'MS3-unavailable-not-refused', leg: 'S', file: CS, legs: 'S2', edits: [['if(w&&!w.effective)fail(409,', 'if(false)fail(409,']], expect: /ikeda:queue-unavailable/ },
  { name: 'MS4-archive-gap-dropped', leg: 'S', file: BS, legs: 'S6', edits: [['  if (cursor <= end) gaps.push({ from: cursor, to: end });\n', '']], expect: /ikeda:archive-gap/ },
  { name: 'MW1-rolling-90-days', leg: 'U1', file: PM, edits: [["const[y,m]=today.split('-').map(Number),t=y*12+(m-1)-2;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0')+'-01';}", "return new Date(Date.parse(today+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);}"]], expect: /window:from/ },
  // parent findings C1-C4 (PARENT-FOLD-REQUEST.txt)
  { name: 'MC11-two-choosers-first-taken', leg: 'U2', file: PO, env: 'OMF_TEST_POLICY_SCRIPT', test: 'certificate chooser', edits: [['  return @{ ambiguous = $true }', '  return @{ index = $inner[0] }']], expect: /cert-chooser:two-siblings/ },
  { name: 'MC14-certificate-cells-as-rows', leg: 'U2', file: 'collector/windows/bank-certificate.ps1', env: 'OMF_TEST_CERT_SCRIPT', test: 'certificate native rows', edits: [['@($Window.FindAll($T::Descendants, $rowsCondition) | Where-Object { Test-OmfCertificateRowElement $_ })', '@($Window.FindAll($T::Descendants, $rowsCondition))']], expect: /C8:one-selectable-row/ },
  { name: 'MC12-bank-name-in-any-row', leg: 'U2', file: PO, env: 'OMF_TEST_POLICY_SCRIPT', test: 'certificate policy', edits: [['$named = $cells.Count -eq 0 -and $BankName -and $name.Contains($BankName)', '$named = $BankName -and $name.Contains($BankName)']], expect: /cert-policy:name-with-cells-needs-the-cell/ },
  { name: 'MS5-archive-any-identity', leg: 'S', file: SV, legs: 'S8', edits: [['if (needsIdentity) Object.assign(filter, {', 'if (false) Object.assign(filter, {']], expect: /ikeda:archive-identity/ },
  { name: 'MS6-archive-recent-only', leg: 'S', file: SV, legs: 'S9', edits: [[".select('capture.snapshot.coverage').lean().cursor()", ".select('capture.snapshot.coverage').sort({ _id: -1 }).limit(500).lean().cursor()"]], expect: /ikeda:archive-lifetime/ },
  // parent findings C5-C7 (build-02)
  { name: 'MC13-branch-suffix-accepted', leg: 'U2', file: IK, env: 'OMF_TEST_IKEDA_MODULE', test: 'misleading options|account is chosen', edits: [['o.fields.branch === identity.branch &&', 'o.fields.branch.endsWith(identity.branch) &&']], expect: /ikeda-portal:(choice-field-roles B1|dom-misleading-refused|choice-parent-probe branch-suffix)/ },
  { name: 'MS10-archive-recent-jobs-only', leg: 'S', file: SV, legs: 'S9', edits: [[".select('snapshot.coverage statementIds').lean().cursor()", ".select('snapshot.coverage statementIds').sort({ _id: -1 }).limit(500).lean().cursor()"]], expect: /ikeda:archive-lifetime-receipts/ },
  { name: 'MS7-repeat-receipt-ignored', leg: 'S', file: SV, legs: 'S10', guard: 'archive-job-receipt', expect: /ikeda:repeat-later-period-confirmed/ },
  { name: 'MS8-any-completed-job-credited', leg: 'S', file: SV, legs: 'S10', edits: [['if ((j.statementIds || []).some((v: any) => valid.has(String(v)))) covered.push', 'if ((j.statementIds || []).length) covered.push']], expect: /ikeda:repeat-receipt-required/ },
  { name: 'MS9-binding-without-identity', leg: 'S', file: BS, legs: 'S11', edits: [[' && (a.accountIdentity ?? null) === (b.accountIdentity ?? null); }', '; }']], expect: /ikeda:identity-stale-scheduled-not-claimed/ },
  { name: 'MW2-closed-end-rewritten', leg: 'U1', file: PM, edits: [['const c=bankCoverageInput(saved,today),to=c.to??today;', 'const c=bankCoverageInput(saved,today),to=today;']], expect: /window:closed-end-kept/ },
  // review F1 (build-03): the manual first-claim account check
  { name: 'MS11-manual-account-unchecked', leg: 'S', file: CS, legs: 'S12', guard: 'manual-account-current', expect: /ikeda:manual-stale-identity-not-claimed/ },
  { name: 'MS12-rechecked-on-reclaim', leg: 'S', file: CS, legs: 'S12', edits: [['&&!job.identityCheckedAt){', '){']], expect: /ikeda:manual-inflight-keeps-identity/ },
  { name: 'MS13-received-not-marked', leg: 'S', file: CS, legs: 'S12', guard: 'manual-account-received', expect: /ikeda:manual-inflight-keeps-identity/ },
  { name: 'MS14-number-only', leg: 'S', file: CS, legs: 'S12', edits: [["const ACCOUNT_ROLES=['branch','type','number']", "const ACCOUNT_ROLES=['number']"]], expect: /ikeda:manual-stale-type-change/ },
  { name: 'MS15-every-bank-checked', leg: 'S', file: CS, legs: 'S12', edits: [['&&bankIdentityRequired(job.snapshot?.provider,job.snapshot?.variant??null)&&', '&&']], expect: /ikeda:other-bank-manual-claimed/ }
];

// ════════════════════════════ The fixture ════════════════════════════
function runChild(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...(BINARY ? { MONGOMS_SYSTEM_BINARY: BINARY } : {}), ...env } }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, text, stderr: String(stderr || ''), passes: lines.filter(l => l.startsWith('PASS ')), fails: lines.filter(l => l.startsWith('FAIL ')), setup: lines.find(l => l.startsWith('SETUP ')) || null, receipt: (() => { try { return JSON.parse((lines.find(l => l.startsWith('RECEIPT ')) || '').slice(8)); } catch { return null; } })() });
    });
  });
}
const tap = text => ({ pass: Number(text.match(/^ℹ pass (\d+)/m)?.[1] ?? NaN), fail: Number(text.match(/^ℹ fail (\d+)/m)?.[1] ?? NaN), failed: [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(x => x[1]) });
export default { name: 'omf-ikeda-collector', covers: COVERS, async run() {
  const started = Date.now(), lines = [], green = new Set(); let pass = true, executed = false;
  const counts = { window: null, portal: null, harnessLegs: 0, security: null, mutantsCaught: 0, mutantsTotal: MUTANTS.length };
  const want = name => !ONLY.length || ONLY.includes(name);
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); green.add(key); } catch (e) { pass = false; const msg = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 2000); lines.push(name + ': ' + (/^(SETUP|NOT RUN)/.test(msg) ? '' : 'RED ') + msg); } };
  let mongo = null;
  try {
    for (const [key, file, slot] of [['U1', 'test/ikeda-bank-window.test.mjs', 'window'], ['U2', 'collector/test/ikeda-portal.test.mjs', 'portal']]) {
      await leg(key + ' node --test ' + file, async () => {
        if (!existsSync(path.join(root, file))) throw new Error('SETUP test file absent: ' + file);
        const r = await runChild(['--test', '--test-concurrency=1', file], {}, 1200000), t = tap(r.text); await keep(key, r.text + '\n--- stderr ---\n' + r.stderr); counts[slot] = t.pass;
        if (r.code !== 0 || t.fail !== 0 || !t.pass) throw new Error((/ERR_MODULE_NOT_FOUND|does not provide an export/.test(r.text + r.stderr) ? 'SETUP module/export absent: ' : 'exit ' + r.code + ' fail ' + t.fail + ': ') + (t.failed.join(' | ') || (r.text + r.stderr).replace(/\s+/g, ' ').slice(-800)).slice(0, 1500));
        return t.pass + ' tests green';
      });
    }
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server');
    mongo = await MongoMemoryServer.create({ binary: BINARY ? { systemBinary: BINARY, version: '8.2.1' } : undefined });
    const harness = (src, db, legs = '', extra = {}) => runChild(['--import', 'tsx', '--import', FIXTURE_HOOK_IMPORT, SELF, HARNESS_FLAG, src], { OMF_IKEDA_MONGO_URI: mongo.getUri(), OMF_IKEDA_DB: db, OMF_IKEDA_ONLY_S: legs, ...extra }, 1500000);
    await leg('S services, routes and collector on the owned MongoDB (S1-S7)', async () => {
      const r = await harness(SRC_ROOT, 'omf_ikeda_s', process.env.OMF_IKEDA_ONLY_S || ''); executed = true; await keep('S', r.text + '\n--- stderr ---\n' + r.stderr);
      counts.harnessLegs = r.passes.length;
      if (r.setup) throw new Error(r.setup + ' (no behavioural result)');
      if (r.code !== 0 || !r.receipt?.pass || r.fails.length) throw new Error(r.fails.length + ' failed / ' + r.passes.length + ' green: ' + (r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 1800));
      return r.passes.length + ' legs green — ' + r.passes.map(p => p.slice(5, 8).trim()).join(' ');
    });
    await leg('R scripts/collector-security-integration.ts (extended; own owned MongoDB)', async () => {
      const r = await runChild(['--import', 'tsx', 'scripts/collector-security-integration.ts'], {}, 900000); await keep('R', r.text + '\n--- stderr ---\n' + r.stderr);
      const receipt = r.text.split(/\r?\n/).reverse().find(l => l.startsWith('{"pass":')); const parsed = receipt ? JSON.parse(receipt) : null; counts.security = parsed;
      if (r.code !== 0 || !parsed?.pass) throw new Error('exit ' + r.code + ': ' + (r.text + r.stderr).replace(/\s+/g, ' ').slice(-1200));
      if (!parsed.ikedaMutants) throw new Error('the integration ran without its Ikeda leg');
      return parsed.checks + ' checks, ' + [parsed.bankMutants, parsed.paypayMutants, parsed.ikedaMutants].join('/') + ' bank/paypay/ikeda binding mutants';
    });
    await leg('M reintroduced defects (each must fail its named assertion; the unchanged copy first)', async () => {
      if (!MUTANTS.length) throw new Error('NOT RUN: no mutants declared');
      for (const need of new Set(MUTANTS.map(mu => mu.leg))) if (!green.has(need)) throw new Error('NOT RUN: leg ' + need + ' must be green first (the unchanged code)');
      const caught = [], missed = [];
      for (const mu of MUTANTS) { try { caught.push(await runMutant(mu, mongo, harness)); } catch (e) { missed.push(String(e?.message || e).slice(0, 600)); } }
      counts.mutantsCaught = caught.length; await keep('M', caught.join('\n') + '\n--- missed ---\n' + missed.join('\n'));
      if (missed.length) throw new Error(missed.length + ' of ' + MUTANTS.length + ' mutants not caught: ' + missed.join(' | ').slice(0, 1500));
      return caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: ' + String(e?.message || e).slice(0, 800)); }
  finally { if (mongo) await mongo.stop().catch(() => {}); }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's ' + JSON.stringify(counts) + '\n' + lines.join('\n') };
} };
async function mutateText(text, { guard = null, edits = [] }, label) {
  text = text.replace(/\r\n/g, '\n');
  if (guard) { const lines = text.split('\n'), hits = lines.filter(l => l.includes('// guard:' + guard + ' ') || l.trimEnd().endsWith('// guard:' + guard)); if (hits.length !== 1) throw new Error('HARNESS ' + label + ' guard marker hits ' + hits.length); lines.splice(lines.indexOf(hits[0]), 1); text = lines.join('\n'); }
  for (const [anchor, replacement] of edits) { const hits = text.split(anchor).length - 1; if (hits !== 1) throw new Error('HARNESS ' + label + ' anchor hits ' + hits + ': ' + anchor.slice(0, 70)); text = text.replace(anchor, () => replacement); }
  return text;
}
async function runMutant(mu, mongo, harness) {
  const created = [];
  try {
    let r, env = {};
    if (mu.leg === 'U2' || (mu.leg === 'S' && mu.file.startsWith('collector/'))) {
      const source = path.join(root, mu.file), ext = path.extname(mu.file), target = path.join(path.dirname(source), path.basename(mu.file, ext) + '.mutant-' + process.pid + '-' + randomUUID().slice(0, 8) + ext);
      await writeFile(target, await mutateText(await readFile(source, 'utf8'), mu, mu.name), { flag: 'wx' }); created.push(target); env[mu.env] = target;
    }
    if (mu.leg === 'U1' || (mu.leg === 'S' && !mu.file.startsWith('collector/'))) {
      const dir = path.join(root, '.cache', 'omf-ikeda-' + mu.name.toLowerCase()); await rm(dir, { recursive: true, force: true }); created.push(dir);
      for (const d of mu.leg === 'U1' ? ['shared'] : ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true });
      const target = path.join(dir, mu.file); await writeFile(target, await mutateText(await readFile(target, 'utf8'), mu, mu.name));
      if (mu.leg === 'U1') env.OMF_TEST_SHARED_DIR = path.join(dir, 'shared'); else env.OMF_IKEDA_SRC_DIR = dir;
    }
    if (mu.leg === 'S') {
      r = await harness(env.OMF_IKEDA_SRC_DIR || root, 'omf_ikeda_' + mu.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30), mu.legs, env);
      if (r.setup) throw new Error('HARNESS ' + mu.name + ' ' + r.setup);
      if (!r.fails.some(f => mu.expect.test(f))) throw new Error(mu.name + ' did not fail ' + mu.expect + ': ' + (r.fails.join(' | ') || 'all green: ' + r.passes.map(p => p.slice(5, 8)).join(' ')).slice(0, 500));
      return mu.name + '→' + r.fails.find(f => mu.expect.test(f)).match(mu.expect)[0];
    }
    r = await runChild(['--test', '--test-concurrency=1', ...(mu.test ? ['--test-name-pattern=' + mu.test] : []), mu.leg === 'U1' ? 'test/ikeda-bank-window.test.mjs' : 'collector/test/ikeda-portal.test.mjs'], env, 1200000);
    const text = r.text + r.stderr;
    if (/ERR_MODULE_NOT_FOUND|SyntaxError/.test(text)) throw new Error('HARNESS ' + mu.name + ' mutant did not load: ' + text.replace(/\s+/g, ' ').slice(-300));
    if (r.code === 0 || !mu.expect.test(text)) throw new Error(mu.name + ' did not fail ' + mu.expect + ' (exit ' + r.code + '): ' + text.replace(/\s+/g, ' ').slice(-400));
    return mu.name + '→' + text.match(mu.expect)[0];
  } finally { for (const c of created) await rm(c, { recursive: true, force: true }).catch(() => {}); }
}

if (process.argv.includes(HARNESS_FLAG)) await harnessMain(path.resolve(process.argv[process.argv.indexOf(HARNESS_FLAG) + 1]));

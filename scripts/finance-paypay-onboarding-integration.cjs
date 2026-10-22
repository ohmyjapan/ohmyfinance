'use strict';
// scripts/finance-paypay-onboarding-integration.cjs — the owned native walkthrough of four PayPay銀行 標準ログイン accounts (all one owner).
// Plan omf-paypay-four-accounts-20261021 built it around the guided first capture; plan omf-paypay-routine-20261022 (Phase C) turns the
// normal queue into routine retrieval, so this walkthrough now drives the ROUTINE lane: the BUILT app (.output) on its own ephemeral
// MongoDB; a real card-only PC enrollment through the real collector-security routes with the collector's real DPAPI device key
// (collector/vault.mjs SplitStore on a temp collector directory); four bank accounts "PayPay 1-4" connected WITHOUT an uploaded template
// and with a period, plus a BA-PLUS account; the bank scope added to the paired PC; the REAL collector process (run.mjs: setup HTTP,
// remembered-PC resume, its own tick) and its real setup page driven in owned headless Chrome to save the four logins once; then retrieve
// jobs queued by the owner and claimed by the daemon's own tick → runBankJob → collectBankStatement on a fake PayPay portal that follows the
// value-free observations only (exact titles, Welcome Page → 普通預金取引明細照会 → 期間選択 with six named selects → 照会 → CSV opening a
// 'ダウンロード中' tab → ログアウト; its DOM is invented and proves nothing about the real portal). Covered: the first capture of each account
// retained needs_review/mapping-required with zero rows; one automatic submission reaching the Welcome page directly clears the pending
// marker (plan D1); native mapping with the existing importer, the mapped next job importing only new rows over the overlap and an
// identical repeat taking the duplicate path; the bank refusing one account's changed password (refused; the person's manual sign-in is
// never taken as proof; re-save); a refusal of the CURRENT key and the owner's explicit retry (no re-entry); the observed active-session
// page (uncertain, 上書きログイン never requested, blocked until the retry); the exits on the real daemon — an unknown page after the
// submission, another account's label, a period the bank cannot select, a download from another host, a failing ログアウト; ONE
// explicitly historical guided observe job (inserted with the snapshot shape a 12cf98c queue froze — never a newly queued job) keeping
// plan P1; BA-PLUS manual; refused captures at the outbox; the actual /bank/retry route reservation; scope, login type and revocation
// stopping the key release. Every page of the daemon's Chrome, popups included, is served by request interception and host resolution
// is refused for everything else, so no bank or other site can be reached. Fictional people, accounts, passwords and statements only;
// no bank, production database or business send. Run by scripts/zoomer-fixtures/omf-paypay-routine.mjs and omf-paypay-four-accounts.mjs
// through the hub verifier; prints PASS lines and a final receipt.
const assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),http=require('node:http');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
// `OMF_PAYPAY_ONBOARDING_ROOT` (fail-first only): run this walkthrough READ-ONLY against the built app and collector of the unmodified base
// tree (its .output is started and its collector modules are loaded; nothing is written there). Only these two trees are admitted.
const ROOTS=['C:/Users/Junsan2/Documents/ohmyfinance/_wt_omf-paypay-routine-20261022_build','C:/Users/Junsan2/Documents/ohmyfinance/_wt_omf-deployed-af47586-20261022'];
const root=process.env.OMF_PAYPAY_ONBOARDING_ROOT?(()=>{const r=path.resolve(process.env.OMF_PAYPAY_ONBOARDING_ROOT);if(!ROOTS.some(x=>path.resolve(x)===r))throw Error('Unadmitted walkthrough root');return r;})():path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms)),u=rel=>pathToFileURL(path.join(root,rel)).href;
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex'),hex=n=>crypto.randomBytes(n).toString('hex');
const OWNER_PASSWORD='Synthetic-password-Only1!',PUBLIC='https://omf.example.invalid';
// Four fictional PayPay standard logins: leading zeros, spaces and symbols in the passwords; each must reach the bank exactly.
const LOGINS=[{branch:'001',account:'0000101',password:'Fictional-1 '},{branch:'010',account:'0100202',password:' Fictional 2/<>'},{branch:'100',account:'1000303',password:'Fict3-'+'x'.repeat(26)},{branch:'009',account:'0090404',password:'Fict"4&'}];
const HEAD='日付,内容,出金金額,入金金額,残高';
// Review fold F4: the route-only mode (the mutant runs) and the two route mutants. Each is a [from,to] edit of the daemon's own module text,
// applied by the TEST launcher's load hook only (exactly one hit, else the daemon fails to start: a harness fault, never detection).
const RETRY_MUTANT=process.env.OMF_TEST_PAYPAY_RETRY_MUTANT||'',RETRY_ONLY=!!(process.env.OMF_TEST_PAYPAY_RETRY_ONLY||RETRY_MUTANT);
const RESERVE='let release;try{release=reserveAction();}catch(error){return reply(409,{error:error.message});}',BODY='\n        try{\n          const input=bankRetryInput(await json(req));';
// Build-resume-04 await trace (test-only, applied by the launcher's load hook; the product files are not changed): each entry/exit of the
// awaits a retrieve job's sign-in, attention, window, cleanup and final status pass through, timestamped into a per-run trace file.
const T=label=>"globalThis.__omfTrace?.("+JSON.stringify(label)+");";
const TRACE_EDITS={
 'collector/bank.mjs':[
  ["const attention = async text => { if (manual) return; manual = true; await status('verification_required', text); await ui.show(); };","const attention = async text => { if (manual) return; manual = true; "+T('attention:status:enter')+" await status('verification_required', text); "+T('attention:show:enter')+" await ui.show(); "+T('attention:show:exit')+" };"],
  ["    const kind = (await ui.state())?.kind;","    "+T('state:enter')+" const kind = (await ui.state())?.kind; globalThis.__omfTrace?.('state:exit:' + kind);"],
  ["  await attention(submitted ? LOGIN_TEXT.verify(label) : LOGIN_TEXT.manual(label));\n  if (refused) throw","  "+T('login:deadline')+" await attention(submitted ? LOGIN_TEXT.verify(label) : LOGIN_TEXT.manual(label));\n  if (refused) throw"],
  ["  catch (error) { if (error?.code === 'login-refused') return { items: [], failed: error.message }; throw error; }","  catch (error) { if (error?.code === 'login-refused') { "+T('collect:login-refused-return')+" return { items: [], failed: error.message }; } throw error; }"],
  ["    const child = browser.process();","    "+T('browser:cleanup:enter')+" const child = browser.process();"],
  ["    await removeEphemeral(profile, root).catch(() => {});","    await removeEphemeral(profile, root).catch(() => {}); "+T('browser:cleanup:exit')],
  ["  const browser = await browserFor(profile, { ephemeral: true, root, onLaunch, background });","  "+T('browser:launch:enter')+" const browser = await browserFor(profile, { ephemeral: true, root, onLaunch, background }); "+T('browser:launch:exit')]],
 'collector/index.mjs':[
  ["async function endSession(reason) {\n  if(closing)return closing;","async function endSession(reason) {\n  globalThis.__omfTrace?.('session:end:'+reason+':until-in-ms:'+(session?Math.round(session.until-Date.now()):'none'));\n  if(closing)return closing;"],
  ["    catch(error){reconnectNeeded=[401,403].includes(error.status);await endSession('OMF access is unavailable');","    catch(error){globalThis.__omfTrace?.('session:refresh-failed:'+String(error?.status||'')+':'+String(error?.code||'')+':'+String(error?.message||error).slice(0,200));reconnectNeeded=[401,403].includes(error.status);await endSession('OMF access is unavailable');"],
  ["  if(session && Date.now()>session.until){await endSession('the batch expired');return;}","  if(session && Date.now()>session.until){globalThis.__omfTrace?.('session:expired:until-'+new Date(session.until).toISOString());await endSession('the batch expired');return;}"],
  ["    const label=account?account.name:bank?.account?.name;","    globalThis.__omfTrace?.('daemon:catch:'+String(error?.code||'')+':'+String(error?.message||error).slice(0,300)); const label=account?account.name:bank?.account?.name;"],
  ["if(result.failed){const failed=refusedNote?`${refusedNote}。${result.failed}`:result.failed;await status('failed',failed);","if(result.failed){const failed=refusedNote?`${refusedNote}。${result.failed}`:result.failed;"+T('runBankJob:failed-status:enter')+"await status('failed',failed);"+T('runBankJob:failed-status:exit')]],
 // Build-resume-06 grant-window seam (test-only; stricter than the product's 20 min): the session expires every 150 s, so each 300 s
 // sign-in deadline crosses a renewal and a job that cannot renew its own session is caught deterministically.
 'collector/omf-authorization.mjs':[
  ["let current={...approval},expiry=Math.min(Date.parse(current.expiresAt),now()+20*60000)","let current={...approval},expiry=Math.min(Date.parse(current.expiresAt),now()+150000)"],
  ["expiry=Math.min(Date.parse(next.expiresAt),now()+20*60000)","expiry=Math.min(Date.parse(next.expiresAt),now()+150000)"]],
 'collector/browser.mjs':[
  ["    session = await page.createCDPSession();","    "+T('showWindow:enter')+" session = await page.createCDPSession(); "+T('showWindow:session')],
  ["  await Promise.race([page.bringToFront(), new Promise(resolve => setTimeout(resolve, 3000))]);\n}","  "+T('showWindow:front:enter')+" await Promise.race([page.bringToFront(), new Promise(resolve => setTimeout(resolve, 3000))]);\n  "+T('showWindow:exit')+"\n}"]]
};
const RETRY_MUTANTS={'no-job-session-renewal':[['const renewal=setInterval(()=>{void renewJobSession(live);},JOB_RENEWAL_MS);','const renewal=null;/* MUTANT: no job-time session renewal */']],'no-route-reservation':[[RESERVE,'let release=()=>{};/* MUTANT: route reservation removed */']],'reserve-after-body':[[RESERVE+BODY,'let release=()=>{};'+BODY+'try{release=reserveAction();}catch(error){return reply(409,{error:error.message});}/* MUTANT: reserved after the body */']]};
if(RETRY_MUTANT&&!RETRY_MUTANTS[RETRY_MUTANT])throw Error('FAIL unknown retry mutant '+RETRY_MUTANT);

// ── The fake PayPay portal: the public standard login form (PAYPAY-PUBLIC-ENTRY facts) with a generated per-document submit handler, then
// the observed authenticated pages by their exact titles and control texts (all share /wctx/NBCW2101.do as on the real portal; the query
// `p` only routes this fake). The scenario file sets the bank's accepted passwords, the export and the person's scripted actions. ──
const OVERWRITE='/wctx/NBCW2101Overwrite.do',LOGIN_ORIGIN='https://login.paypay-bank.co.jp',HOME='https://www.paypay-bank.co.jp',ENTRY='/wctx/1D1DFxFDg.do',ACTION='/wctx/NBCW2101.do';
const FOREIGN_CSV='https://cdn.paypay-bank.example';
const TITLES=Object.freeze({welcome:'Welcome Page - PayPay銀行',statements:'普通預金取引明細照会 - PayPay銀行',notice:'お知らせ - PayPay銀行',downloading:'ダウンロード中 - PayPay銀行'});
const FIELDS=['ShokaiStartDateNenIn','ShokaiStartDateTsukiIn','ShokaiStartDateHiIn','ShokaiEndDateNenIn','ShokaiEndDateTsukiIn','ShokaiEndDateHiIn'];
// `sameTabCsv` (a probe whose own browser has no popup interception): CSV downloads in the same tab instead of the observed second tab.
// The period the statement page shows before any 照会 (the bank's default view); a guided person exports this one.
const DEFAULT_PERIOD=Object.freeze({from:'2026-09-21',to:'2026-10-20'});
// Each account's fictional transactions (rows 2 and 3 are genuine same-day twins with different running balances).
const MASTER=[['2026-09-03','振込 カクウショウジ',0,50000],['2026-09-05','カクウストア',1200,0],['2026-09-05','カクウストア',1200,0],['2026-09-20','カクウリース',5500,0],['2026-10-02','振込 カクウトリヒキ',0,12000],['2026-10-15','カクウ手数料',330,0]];
const csvOf=(index,from,to)=>{let balance=100000*(index+1);const lines=[HEAD];for(const [date,desc,out,inn] of MASTER){balance+=inn-out;if(date<from||date>to)continue;lines.push([date.replaceAll('-','/'),desc+' P'+(index+1),out?String(out):'',inn?String(inn):'',String(balance)].join(','));}return Buffer.from(lines.join('\r\n')+'\r\n');};
const rowsIn=(from,to)=>MASTER.filter(([date])=>date>=from&&date<=to).length;
function loginDoc(error='',heading=''){
  const fn='j'+hex(8),token=hex(8);
  return {token,html:`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ログイン｜PayPay銀行</title><body>${heading?`<h1>${heading}</h1>`:''}${error?`<p class="err">${error}</p>`:''}
<form method="post" action="NBCW2101.do" name="HOST" onSubmit="return ${fn}(document.HOST)" target="_self"><input type="hidden" name="SessionToken" value="${token}">
店番号 <input type="tel" name="TenNo" id="idTenNo" maxlength="3"> 口座番号 <input type="tel" name="KozaNo" id="idKozaNo" maxlength="7"> ログインパスワード <input type="password" name="Pw" id="idPw" maxlength="32"> <input type="submit" name="login" value="ログイン"></form>
${heading?'<a id="overwrite" href="'+OVERWRITE+'">上書きログイン</a> ':''}<a href="${HOME}/cn_login.html">ログインできません</a> <a href="/balogin_L.html">BA-PLUS専用ログイン</a>
<script>function ${fn}(f){var h=document.createElement('input');h.type='hidden';h.name='Chk';h.value='gen-${token}';f.appendChild(h);return true;}</script></body></html>`};
}
const pageOf=(title,body)=>`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title><style>a,button,input,select{display:inline-block;margin:4px;padding:4px}</style><body>${body}</body></html>`;
const logoutLink=sc=>`<a href="${ACTION}?p=${sc.logoutBroken?'logout-broken':'logout'}">ログアウト</a>`;
const welcomeDoc=sc=>pageOf(TITLES.welcome,`<a href="${ACTION}?p=balance">各種残高</a> <a href="${ACTION}?p=transfer">振込明細照会</a> <a href="${ACTION}?p=statements">普通預金取引明細照会</a> ${logoutLink(sc)}`);
const noticeDoc=sc=>pageOf(TITLES.notice,`<p>重要なお知らせ（架空）</p><a href="${ACTION}?p=welcome">次へ</a> ${logoutLink(sc)}`);
function statementDoc(sc,label,period){
  const [fy,fm,fd]=period.from.split('-').map(Number),[ty,tm,td]=period.to.split('-').map(Number),values=[fy,fm,fd,ty,tm,td];
  const select=(name,i)=>{const [lo,hi,unit]=[[2016,2026,'年'],[1,12,'月'],[1,31,'日']][i%3];return `<select name="${name}">${Array.from({length:hi-lo+1},(_,k)=>lo+k).map(n=>`<option value="${n}"${n===values[i]?' selected':''}>${n}${unit}</option>`).join('')}</select>`;};
  const csvTarget=sc.foreignCsv?JSON.stringify(FOREIGN_CSV+'/meisai.csv'):`location.origin+'${ACTION}?p=csv&from='+from+'&to='+to`;
  return pageOf(TITLES.statements,`<div id="holder">普通 ${label}</div><a href="#">表示順</a> <a href="#" onclick="document.getElementById('panel').style.display='block';return false;">期間選択</a> <a href="${ACTION}?p=pdf">PDF</a> <a href="#" onclick="csv();return false;">CSV</a> <a href="#">インボイス</a> ${logoutLink(sc)}
<div id="panel" style="display:none">${FIELDS.map(select).join(' ')} <input type="button" value="照会" onclick="q()"> <a href="#" onclick="document.getElementById('panel').style.display='none';return false;">閉じる</a></div>
<p>${period.queried?'照会結果 '+period.from+'〜'+period.to:'最近の取引'}</p>
<script>const N=${JSON.stringify(FIELDS)},from=${JSON.stringify(period.from)},to=${JSON.stringify(period.to)};
const v=n=>String(document.getElementsByName(n)[0].value).padStart(2,'0');
function q(){location.href='${ACTION}?p=result&from='+v(N[0])+'-'+v(N[1])+'-'+v(N[2])+'&to='+v(N[3])+'-'+v(N[4])+'-'+v(N[5]);}
function csv(){${sc.sameTabCsv?`location.href=${csvTarget};`:`const w=window.open('about:blank','_blank');w.document.title=${JSON.stringify(TITLES.downloading)};setTimeout(()=>{w.location.href=${csvTarget};},800);`}}</script>`);
}
function site(scenarioFile,metricFile){
  const s={trace:[],docs:[],posts:[],downloads:[],foreign:[],foreignCsv:0,overwrites:0,requests:0,session:null,period:null,exports:0,statements:0,queries:0,logouts:0,logoutBroken:0,forbidden:[]};
  const scenario=()=>{try{return JSON.parse(fs.readFileSync(scenarioFile,'utf8'));}catch{return {};}};
  const save=()=>fs.writeFileSync(metricFile,JSON.stringify({posts:s.posts,downloads:s.downloads,foreign:s.foreign,foreignCsv:s.foreignCsv,overwrites:s.overwrites,requests:s.requests,exports:s.exports,statements:s.statements,queries:s.queries,logouts:s.logouts,logoutBroken:s.logoutBroken,forbidden:s.forbidden,trace:s.trace.slice(-60)}));
  s.respond=request=>{
    s.requests++;let url;try{url=new URL(request.url());}catch{save();return request.abort();}
    s.trace.push({t:Date.now(),method:request.method(),origin:url.origin,p:url.searchParams.get('p')||url.pathname});if(s.trace.length>200)s.trace.splice(0,100);
    const sc=scenario(),html=(body,delay=0)=>delay?setTimeout(()=>request.respond({status:200,contentType:'text/html; charset=utf-8',body}).catch(()=>{}),delay):request.respond({status:200,contentType:'text/html; charset=utf-8',body});
    try{
      if(url.protocol==='data:')return request.continue();
      if(url.origin===HOME){if(url.pathname==='/')return html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>PayPay銀行</title><body><a href="javascript:void(0)">ログイン</a></body></html>');return request.abort();}
      // a download from another host (the collector's download-host guard must refuse it); answered here, never on the network
      if(url.origin===FOREIGN_CSV&&sc.foreignCsv){s.foreignCsv++;return request.respond({status:200,contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="meisai.csv"'},body:csvOf(s.session??0,DEFAULT_PERIOD.from,DEFAULT_PERIOD.to)});}
      if(url.origin!==LOGIN_ORIGIN){s.foreign.push(url.origin);return request.abort();}
      if(url.pathname===ENTRY){const d=loginDoc();s.docs.push(d);return html(d.html);}
      if(url.pathname===OVERWRITE){s.overwrites++;return request.abort();}
      if(url.pathname===ACTION&&request.method()==='POST'){
        const body=new URLSearchParams(request.postData()||''),doc=s.docs.find(d=>d.token===body.get('SessionToken'));
        const passwords=sc.passwords||LOGINS.map(l=>l.password),index=LOGINS.findIndex((l,i)=>l.branch===body.get('TenNo')&&l.account===body.get('KozaNo')&&passwords[i]===body.get('Pw'));
        s.posts.push({index,ok:index>=0,keys:[...body.keys()].sort(),fresh:!!doc&&doc===s.docs.at(-1),handler:!!doc&&body.get('Chk')==='gen-'+doc.token});
        if(index<0){const d=loginDoc('店番号・口座番号またはパスワードが正しくありません');s.docs.push(d);return html(d.html);}
        if(sc.inUse){const d=loginDoc('','上書きログイン（ログイン中です）');s.docs.push(d);return html(d.html);}
        s.session=index;s.period={...DEFAULT_PERIOD,queried:false};return html(sc.notice?noticeDoc(sc):welcomeDoc(sc));
      }
      if(url.pathname===ACTION){
        const p=url.searchParams.get('p');
        if(p==='logout-broken'){s.logoutBroken++;return request.abort();}
        if(s.session===null){const d=loginDoc();s.docs.push(d);return html(d.html);}
        const label=sc.label||'PayPay '+(s.session+1);
        if(p==='logout'){s.logouts++;s.session=null;const d=loginDoc();s.docs.push(d);return html(d.html);}
        if(p==='welcome')return html(welcomeDoc(sc));
        if(p==='statements'){s.statements++;s.period={...DEFAULT_PERIOD,queried:false};return html(statementDoc(sc,label,s.period),sc.slowStatementsMs||0);}
        if(p==='result'){s.queries++;s.period={from:url.searchParams.get('from'),to:url.searchParams.get('to'),queried:true};return html(statementDoc(sc,label,s.period));}
        if(p==='csv'){
          s.exports++;const from=url.searchParams.get('from'),to=url.searchParams.get('to');s.downloads.push({index:s.session,from,to,export:sc.export||'csv'});
          if(sc.export==='pdf')return request.respond({status:200,contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="meisai.pdf"'},body:Buffer.concat([Buffer.from('%PDF-1.7\n%'),Buffer.from([0xe2,0xe3,0xcf,0xd3,0x0a,0x00,0x01])])});
          return request.respond({status:200,contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="meisai.csv"'},body:sc.export==='header-only'?Buffer.from(HEAD+'\r\n'):csvOf(s.session,from,to)});
        }
        s.forbidden.push(p||'none');return html(pageOf('PayPay銀行','<p>other</p>'));
      }
      return request.abort();
    }finally{save();}
  };
  // The person, acting inside the owned page on their own time. Routine scenarios (`routine`): the person never touches the bank pages
  // except the scripted steps — `signIn: n` (after being asked, signs in by hand as account n; a plain form submit, so the page's
  // generated handler does not run and the bank sees handler:false) and `resolveNotice` (after being asked, presses 次へ on the notice).
  // Otherwise (a historical guided job, a plain observe job): opens the statement page, exports once, closes the tab; on a refused login
  // (the form again after the submission) or when told to, closes the tab without exporting.
  s.person=page=>{
    const downloadsBefore=s.downloads.length;let busy=false,at='',since=Date.now(),exportStarted=false,exportedAt=0,opened=false,signedIn=false,resolved=false;
    s.personActions=s.personActions||[];s.personErrors=s.personErrors||[];
    const clickText=text=>page.evaluate(t=>{const a=[...document.querySelectorAll('a')].find(e=>e.textContent.trim()===t);if(!a)throw Error('no '+t);a.click();},text);
    const tick=async()=>{
      if(busy||page.isClosed())return;busy=true;
      try{
        const now=Date.now(),current=page.url(),sc=scenario();let p='';try{p=new URL(current).pathname;}catch{}
        if(current!==at){at=current;since=now;}
        const title=await page.title().catch(()=>'');
        if(sc.routine){
          if(sc.signIn&&!signedIn&&now-since>=1500&&title.startsWith('ログイン')&&await page.$('form[name="HOST"] input[type="password"]')){
            signedIn=true;const l=LOGINS[sc.signIn-1],pw=(sc.passwords||LOGINS.map(x=>x.password))[sc.signIn-1];s.personActions.push({kind:'manual-sign-in',account:sc.signIn});save();
            await page.evaluate((b,a,w)=>{document.getElementById('idTenNo').value=b;document.getElementById('idKozaNo').value=a;document.getElementById('idPw').value=w;document.HOST.submit();},l.branch,l.account,pw);
          }else if(sc.resolveNotice&&!resolved&&now-since>=1500&&title===TITLES.notice){resolved=true;s.personActions.push({kind:'notice-next'});save();await clickText('次へ');}
          return;
        }
        if(title===TITLES.welcome&&!opened){opened=true;s.personActions.push({kind:'statements'});save();await clickText('普通預金取引明細照会');}
        else if(title===TITLES.statements){
          if(s.downloads.length>downloadsBefore){exportedAt=exportedAt||now;if(now-exportedAt>=3000)await page.close();}
          else if(!exportStarted){exportStarted=true;s.personActions.push({kind:'csv'});save();try{await clickText('CSV');}catch(error){exportStarted=false;throw error;}}
        }
        else if(p===ACTION&&now-since>=2500&&await page.$('form[name="HOST"]'))await page.close();
        else if(((p===ENTRY&&sc.closeAtLogin)||current.startsWith(HOME))&&now-since>=4000)await page.close();
        else if(p===ENTRY&&sc.holdAtLoginMs&&now-since>=sc.holdAtLoginMs)await page.close();
      }catch(error){if(!page.isClosed()){s.personErrors.push({path:(()=>{try{return new URL(page.url()).pathname}catch{return ''}})(),error:String(error.message||error).slice(0,200)});save();}}
      finally{busy=false;}
    };
    const timer=setInterval(()=>void tick(),250);page.once('close',()=>clearInterval(timer));page.on('load',()=>void tick());
  };
  return s;
}

async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
  assert.equal(process.platform,'win32','the collector vault (DPAPI) and owned Chrome need Windows');
  if(!fs.existsSync(path.join(root,'.output/server/index.mjs')))throw Error('built app absent; build OMF first');
  let mongo,app,client,daemon,checks=0,logs='';const pass=name=>{checks++;console.log('PASS '+name);};
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-paypay-onboarding-')),collectorDir=path.join(temp,'collector');await fsp.mkdir(collectorDir,{recursive:true});
  process.env.OMF_COLLECTOR_DIR=collectorDir;
  const brokers=[],evidence=[];let setupBrowser=null;
  try{
    const systemBinary=[path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe'),path.join(root,'..','node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')].find(p=>fs.existsSync(p));
    mongo=await MongoMemoryServer.create({binary:systemBinary?{systemBinary,version:'8.2.1'}:undefined,instance:{launchTimeout:180000}});
    const dbName='paypay_onboarding_isolated',uri=mongo.getUri(dbName),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
    app=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:path.join(temp,'data'),JWT_SECRET:hex(32),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_COLLECTOR_PUBLIC_ORIGIN:PUBLIC},stdio:['ignore','pipe','pipe']});
    for(const stream of [app.stdout,app.stderr])stream.on('data',v=>{logs=(logs+v).slice(-15000);});
    let healthy=false;for(let i=0;i<600;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected&&d.database.name===dbName){healthy=true;break;}}catch{}await pause(200);}
    assert.ok(healthy,'owned app health: '+logs.slice(-1200));
    const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=String(input&&input.url&&typeof input!=='string'&&!(input instanceof URL)?input.url:input);return realFetch(url.startsWith(PUBLIC+'/')?origin+url.slice(PUBLIC.length):input,init);};
    client=await MongoClient.connect(uri);const db=client.db(dbName);
    const call=async(route,{method='GET',token,body,headers={}}={})=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};};
    const ok=(r,label)=>{assert.equal(r.status,200,label+' '+JSON.stringify(r.data).slice(0,500));return r.data;};
    const register=async email=>ok(await call('/api/auth/register',{method:'POST',body:{email,password:OWNER_PASSWORD,name:'Fictional owner'}}),'register').tokens.accessToken;
    const owner=await register('paypay-owner@example.invalid'),stranger=await register('paypay-other@example.invalid');
    const ownerReq=(route,body,method='POST',token=owner)=>call('/api/finance-payments/'+route,{method,token,body});
    // ── the bank accounts, connected without any uploaded file and with a period (routine retrieval needs the period) ──
    const SEPT={from:'2026-09-01',to:'2026-09-30'},WIDE={from:'2026-09-01',to:'2026-10-20'};
    const connect=(i,extra={})=>ownerReq('bank/accounts/'+P[i]+'/connection',{provider:'paypay',variant:'standard',accountLabel:'PayPay '+(i+1),coverage:SEPT,...extra},'PUT');
    const P=[];for(let i=1;i<=4;i++)P.push(ok(await ownerReq('bank/accounts',{name:'PayPay '+i,currency:'JPY'}),'bank account '+i).account.id);
    for(const [i] of P.entries()){const r=await connect(i);assert.equal(r.status,200,'paypay:template-free-connection (the first capture must not need an uploaded template) '+r.status+' '+JSON.stringify(r.data).slice(0,300));assert.equal(r.data.account.connection.templateId,null,'paypay:template-free-connection');}
    const baTemplate=ok(await ownerReq('bank/templates',{name:'Fictional BA-PLUS map',headers:['日付','摘要','金額'],mapping:{date:'0',description:'1',amount:'2'}},'PUT'),'template').template;
    const BA=ok(await ownerReq('bank/accounts',{name:'PayPay BA-PLUS',currency:'JPY'}),'ba account').account.id;
    ok(await ownerReq('bank/accounts/'+BA+'/connection',{provider:'paypay',variant:'baplus',templateId:baTemplate.id},'PUT'),'ba connection');
    const foreign=ok(await ownerReq('bank/accounts',{name:'他人のPayPay',currency:'JPY'},'POST',stranger),'foreign').account.id;
    assert.equal(await db.collection('financebanktemplates').countDocuments({}),1,'paypay:no-template-created-for-standard');
    pass('four PayPay標準 accounts connected without an uploaded file (no template created), each with a period; BA-PLUS keeps its mapped connection');
    // ── card-only PC pairing, then the bank scope added (the real current flow) ──
    const card=ok(await call('/api/finance/accounts',{method:'POST',token:owner,body:{name:'Fictional Amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'o@example.invalid',otpMailbox:'m@example.invalid'}}),'card').account;
    const device=ok(await call('/api/finance/collectors',{method:'POST',token:owner,body:{name:'Fictional PC',accountIds:[card._id]}}),'collector');
    const deviceToken=device.token,deviceId=device.id;
    const vault=await import(u('collector/vault.mjs')),authz=await import(u('collector/omf-authorization.mjs')),idx=await import(u('collector/index.mjs')),browserModule=await import(u('collector/browser.mjs'));
    const store=new vault.SplitStore(collectorDir),generation=hex(32),installationId=hex(16),verifier=crypto.randomBytes(32).toString('base64url');
    const localKey=await store.withLock(()=>store.deviceKey(generation,{create:true}));
    const trustToken=await store.withLock(()=>store.trustCredential(generation,{create:true}));
    const keyCalls=[];
    const securityHttp=async(route,{body,grant,token=deviceToken,signal}={})=>{keyCalls.push({route:route.split('/')[0],method:body===undefined?'GET':'POST'});const r=await fetch(origin+'/api/finance/collector-security/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(grant?{'X-Collector-Grant':grant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.statusMessage||'OMF did not authorize this action.'),{status:r.status});return data;};
    const transport=(config,route,options={})=>securityHttp(route,options);
    const request=await securityHttp('requests',{body:{action:'enroll',installationId,generation,publicKey:localKey.publicKey,trustHash:sha256(trustToken),state:hex(32),codeChallenge:crypto.createHash('sha256').update(verifier).digest('base64url'),redirectUri:'http://127.0.0.1:49123/collector-callback'}});
    const approved=ok(await call('/api/finance/collector-security/requests/'+request.id,{method:'POST',token:owner,body:{password:OWNER_PASSWORD,code:''}}),'owner approval');
    const exchanged=await securityHttp('exchange',{body:{id:request.id,code:new URL(approved.redirectUri).searchParams.get('code'),verifier}});
    const grantRow=await db.collection('collectorgrants').findOne({_id:sha256(exchanged.grant)});assert.deepEqual(grantRow.accountIds.map(String),[String(card._id)],'the grant names the card only');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[...P,BA]},'PUT'),'bank scope added after pairing');
    const listed=ok(await call('/api/finance-payments/collector/bank/accounts',{token:deviceToken}),'collector bank/accounts').accounts;
    assert.deepEqual(listed.map(a=>[a.name,a.provider,a.variant]).sort(),[['PayPay 1','paypay','standard'],['PayPay 2','paypay','standard'],['PayPay 3','paypay','standard'],['PayPay 4','paypay','standard'],['PayPay BA-PLUS','paypay','baplus']],'paypay:collector-bank-metadata');
    pass('card-only PC pairing (real enrollment, DPAPI device key); the five PayPay accounts added to the paired PC; the collector lists exactly them (metadata only)');
    // ── the real collector process: remembered-PC resume, its setup page, its tick ──
    const accountInfo=ok(await call('/api/finance/collector/accounts',{token:deviceToken}),'collector accounts').accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
    const config={baseUrl:PUBLIC,token:deviceToken,accountInfo,accounts:{},mode:'protected'};
    const brokerOf=approval=>{const abort=new AbortController(),broker={generation,localKey,remote:authz.keyService(config,{grant:approval.grant,expiresAt:approval.expiresAt,installationId,generation},abort.signal,{renew:()=>securityHttp('session',{body:{installationId,generation,trustToken}}),call:transport})};brokers.push(broker);return {mode:'protected',installationId,broker,abort};};
    const live=brokerOf(exchanged),ownerId=String(grantRow.ownerId);
    const activatedAt=new Date().toISOString(),protection={installationId,generation,keyProvider:'CurrentUser DPAPI + OMF',publicKey:localKey.publicKey,activatedAt};
    await store.withLock(async()=>{
      await store.save('check',vault.aadOf({installationId,origin:PUBLIC,ownerId,provider:'check',accountId:'check'}),{canary:hex(16)},live.broker);
      await new vault.Vault(collectorDir).update(()=>({...config,accounts:{},services:{},protection,paused:true}));
      await vault.replaceVaultFile(path.join(collectorDir,'vault-state.json'),JSON.stringify({v:3,phase:'active',installationId,generation,publicKey:localKey.publicKey,activatedAt}));
    });
    const traceFile=path.join(temp,'daemon-await-trace.jsonl'),dport=await availablePort(),metrics=path.join(temp,'daemon-site.json'),scenarioFile=path.join(temp,'scenario.json'),requests=path.join(temp,'daemon-http.jsonl'),launcher=path.join(temp,'daemon-launcher.mjs');
    // Routine scenarios by default (the person stays idle); `guided` scenarios let the person act as on a guided/observe job.
    const scene=(o={})=>fsp.writeFile(scenarioFile,JSON.stringify(o.guided?{...o}:{routine:true,...o}));
    await scene();
    // Every page of the daemon's Chrome — those it opens and every popup (the bank's download tab) — is intercepted by the fake portal, and
    // host resolution is refused for everything else: a popup that opened before its interception could only fail, never reach a host.
    const script=`import fs from 'node:fs';import {createRequire,registerHooks} from 'node:module';
const require=createRequire(${JSON.stringify(path.join(__dirname,'..','package.json'))});const {site}=require(${JSON.stringify(__filename)});const fake=site(${JSON.stringify(scenarioFile)},${JSON.stringify(metrics)});
const requestFile=${JSON.stringify(requests)},publicOrigin=${JSON.stringify(PUBLIC)},localOrigin=${JSON.stringify(origin)};
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const value=String(input?.url||input);const mapped=value.startsWith(publicOrigin+'/')?localOrigin+value.slice(publicOrigin.length):value;
const parsed=new URL(mapped);if(parsed.origin!==localOrigin&&parsed.origin!==${JSON.stringify('http://127.0.0.1:'+dport)})throw Error('fixture blocked unexpected fetch');
const posted=parsed.pathname.endsWith('/bank/status')?(()=>{try{const b=JSON.parse(String(init?.body||''));return {jobId:b.jobId,state:b.state};}catch{return {jobId:null,state:null};}})():null;
fs.appendFileSync(requestFile,JSON.stringify({t:Date.now(),path:parsed.pathname,method:init?.method||'GET',...(posted||{})})+'\\n');
const sent=realFetch(mapped,init);if(posted)sent.then(r=>fs.appendFileSync(requestFile,JSON.stringify({t:Date.now(),path:'answer:bank/status',...posted,status:r.status})+'\\n'),e=>fs.appendFileSync(requestFile,JSON.stringify({t:Date.now(),path:'answer:bank/status',...posted,error:String(e?.name||e)})+'\\n'));return sent;};
const served=page=>page.__omfServed??=(async()=>{await page.setRequestInterception(true);page.on('request',request=>fake.respond(request));})();
globalThis.__omfFictionalBankLaunch=async(launch,options)=>{const browser=await launch({...options,headless:true,args:[...(options?.args||[]).filter(a=>a!=='--no-startup-window'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']});
browser.on('targetcreated',async target=>{if(target.type()!=='page')return;try{const page=await target.page();if(page)await served(page);}catch{}});
let create=browser.newPage.bind(browser);Object.defineProperty(browser,'newPage',{configurable:true,get(){return async(...args)=>{const page=await create(...args);await served(page);fake.person(page);return page;};},set(fn){create=fn.bind(browser);}});return browser;};
registerHooks({load(url,context,next){const result=next(url,context);if(url===${JSON.stringify(u('collector/browser.mjs'))})return {...result,source:String(result.source)+'\\nconst fixtureLaunch=puppeteer.launch.bind(puppeteer);puppeteer.launch=options=>globalThis.__omfFictionalBankLaunch(fixtureLaunch,options);\\n'};return result;}});
const traceFile=${JSON.stringify(traceFile)};globalThis.__omfTrace=label=>{try{fs.appendFileSync(traceFile,JSON.stringify({t:Date.now(),label})+'\\n');}catch{}};
const traceEdits=${JSON.stringify(Object.fromEntries(Object.entries(TRACE_EDITS).map(([rel,pairs])=>[u(rel),pairs])))};
registerHooks({load(url,context,next){const result=next(url,context);const edits=traceEdits[url];if(!edits)return result;let text=String(result.source).replace(/\\r\\n/g,'\\n');for(const [from,to] of edits){if(text.split(from).length!==2)throw Error('FAIL trace anchor hits '+(text.split(from).length-1)+' '+from.slice(0,60));text=text.replace(from,()=>to);}return {...result,source:text};}});
const retryMutant=${JSON.stringify(RETRY_MUTANT?RETRY_MUTANTS[RETRY_MUTANT]:null)};
if(retryMutant)registerHooks({load(url,context,next){const result=next(url,context);if(url!==${JSON.stringify(u('collector/index.mjs'))})return result;let text=String(result.source).replace(/\\r\\n/g,'\\n');for(const [from,to] of retryMutant){if(text.split(from).length!==2)throw Error('FAIL retry mutant anchor hits '+(text.split(from).length-1));text=text.replace(from,()=>to);}return {...result,source:text};}});
await import(${JSON.stringify(u('collector/run.mjs'))});`;
    await fsp.writeFile(launcher,script);evidence.push(['daemon-await-trace',traceFile],['daemon-http',requests],['portal-metrics',metrics]);
    daemon=spawn(process.execPath,[launcher],{cwd:root,windowsHide:true,env:{...process.env,OMF_COLLECTOR_DIR:collectorDir,OMF_COLLECTOR_PORT:String(dport),OMF_COLLECTOR_TICK_MS:'1000'},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [daemon.stdout,daemon.stderr])stream.on('data',v=>{output=(output+v).slice(-6000)});
    const waitFor=async(read,label,timeout=90000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(daemon.exitCode!==null)throw Error('daemon exited: '+output);const value=await read();if(value)return value;await pause(250);}throw Error('daemon timeout '+label+': '+output.slice(-1500));};
    const setup=await waitFor(async()=>{try{const x=new URL((await fsp.readFile(path.join(collectorDir,'setup-link.txt'),'utf8')).trim());return x.port===String(dport)?x:null}catch{return null}},'setup link');
    const local=async(route,body,timeout=30000)=>{const response=await fetch(setup.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Setup-Key':setup.hash.slice(1),Origin:setup.origin},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeout)});return {status:response.status,data:await response.json()};};
    await waitFor(async()=>{const r=await local('/status');return r.status===200&&r.data.startupDone},'startup');
    ok(await local('/resume',{}),'daemon resume');
    await waitFor(async()=>{const r=await local('/status');if(r.data.keyLost||r.data.reconnectNeeded)throw Error('daemon resume: '+r.data.message);return r.data.protected&&r.data.unlocked&&!r.data.busy&&!r.data.authorizing&&!r.data.testBroker},'normal remembered-PC resume');
    const status=async()=>ok(await local('/status'),'daemon status');
    const banksOf=async()=>(await status()).banks;
    assert.deepEqual((await banksOf()).map(b=>[b.name,b.supported,b.hasCredentials]).sort(),[['PayPay 1',true,false],['PayPay 2',true,false],['PayPay 3',true,false],['PayPay 4',true,false],['PayPay BA-PLUS',false,false]],'paypay:setup-status-four-supported');
    // ── the real setup page in owned headless Chrome: four separate one-time saves ──
    setupBrowser=await browserModule.browserFor(path.join(temp,'setup-profile'),{headless:true});
    const page=await setupBrowser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.setRequestInterception(true);page.on('request',r=>{const x=new URL(r.url());return x.origin===setup.origin?r.continue():r.abort();});
    // the setup page disables its controls while the daemon is busy; on a loaded machine a tick can hold it for minutes
    const waitPage=async(f,arg,label)=>{for(let i=0;i<1800;i++){if(await page.evaluate(f,arg).catch(()=>false))return;await pause(100);}const direct=await local('/status').then(r=>JSON.stringify({status:r.status,error:r.data?.error,protected:r.data?.protected,unlocked:r.data?.unlocked,busy:r.data?.busy,banks:(r.data?.banks||[]).length,message:r.data?.message})).catch(e=>String(e));throw Error('setup page '+label+': '+String(await page.$eval('#banks',e=>e.innerHTML).catch(()=>'')).slice(0,500)+' | page message: '+(await page.$eval('#connect-message',e=>e.textContent).catch(()=>''))+' | direct /status: '+direct+' | '+pageErrors.join('|'));};
    const section=id=>'[data-bank-login="'+id+'"] ';
    const openSetup=async()=>{await page.goto('about:blank');await page.goto(setup.href,{waitUntil:'networkidle0'});await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[3])+'[data-bank-login-save]','four sections');};
    // Plan P1 (unchanged): the owner's explicit per-account retry in the real setup page. It releases no key (no decryption), queues no job
    // and leaves the inputs empty; only that account's block is lifted.
    let busyRefusals=0;const retryAnswers=[];
    const retryLogin=async i=>{
      await openSetup();await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-retry]','retry offered '+i);
      const keysBefore=keyGets(),jobsBefore=await db.collection('financebankjobs').countDocuments({bankAccountId:new ObjectId(P[i])}),others=(await banksOf()).filter(b=>b.bankAccountId!==P[i]).map(b=>b.pending);
      // The action slot is reserved per click: while the daemon's tick is claiming, the collector answers 'Wait for the current
      // collector action to finish' and changes nothing; the person simply presses the button again.
      const answers=[];const onResponse=r=>{if(new URL(r.url()).pathname==='/bank/retry')answers.push(r.status());};page.on('response',onResponse);
      try{
        for(let attempt=0;;attempt++){
          const seen=answers.length;await page.click(section(P[i])+'[data-bank-login-retry]');
          for(let n=0;answers.length===seen;n++){assert.ok(n<600,'paypay:retry-answered '+i);await pause(100);}
          const answer=answers.at(-1);
          if(answer===200){await waitPage(sel=>!document.querySelector(sel),section(P[i])+'[data-bank-login-retry]','retry done '+i);break;}
          assert.equal(answer,409,'paypay:retry-only-busy-refusals '+i);busyRefusals++;assert.ok(attempt<20,'paypay:retry-eventually-reserved');
          assert.match(await page.$eval(section(P[i])+'[data-bank-login-note]',e=>e.textContent),/Wait for the current collector action/,'paypay:retry-busy-explained');
          await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-retry]','retry re-enabled '+i);await pause(300);
        }
      }finally{page.off('response',onResponse);}
      assert.equal(answers.filter(s=>s===200).length,1,'paypay:retry-one-success '+JSON.stringify(answers));retryAnswers.push(...answers);
      assert.equal(keyGets(),keysBefore,'paypay:retry-no-key-release (no decryption)');assert.equal(await db.collection('financebankjobs').countDocuments({bankAccountId:new ObjectId(P[i])}),jobsBefore,'paypay:retry-queues-nothing');
      assert.deepEqual(await page.$$eval(section(P[i])+'input',l=>l.map(e=>e.value)),['','',''],'paypay:retry-inputs-empty');
      const after=await banksOf();assert.equal(after.find(b=>b.bankAccountId===P[i]).pending,null,'paypay:retry-rearmed '+i);assert.deepEqual(after.filter(b=>b.bankAccountId!==P[i]).map(b=>b.pending),others,'paypay:retry-isolated '+i);
    };
    const saveLogin=async(i,values)=>{await waitPage(sel=>{const e=document.querySelector(sel);return !!e&&!e.disabled},section(P[i])+'[data-bank-login-save]','save enabled '+i);for(const [name,value] of Object.entries(values))await page.type(section(P[i])+'[data-bank-login-field="'+name+'"]',value);await page.click(section(P[i])+'[data-bank-login-save]');await waitPage(sel=>/saved on this PC/i.test(document.querySelector(sel)?.textContent||''),section(P[i])+'[data-bank-login-note]','saved '+i);assert.deepEqual(await page.$$eval(section(P[i])+'input',l=>l.map(e=>e.value)),['','',''],'paypay:setup-fields-cleared '+i);};
    await openSetup();
    assert.equal(await page.$(section(BA)+'input'),null,'paypay:setup-baplus-no-form');
    for(const [i,l] of LOGINS.entries())await saveLogin(i,l);
    const sealed=P.map(id=>JSON.parse(fs.readFileSync(path.join(collectorDir,'secrets','paypay-'+id+'.sealed'),'utf8')));
    assert.equal(new Set(sealed.map(s=>s.keyId)).size,4,'paypay:four-separate-keys');
    for(const [i,s] of sealed.entries()){assert.deepEqual(vault.entryBinding(s),vault.aadOf({installationId,origin:PUBLIC,ownerId,provider:'paypay',accountId:P[i]}),'paypay:entry-bound-to-its-account '+i);const raw=fs.readFileSync(path.join(collectorDir,'secrets','paypay-'+P[i]+'.sealed'),'utf8');for(const l of LOGINS)assert.ok(!raw.includes(l.account)&&!raw.includes(l.password.trim()),'paypay:ciphertext-only');}
    const wrapped=await db.collection('collectorwrappedkeys').find({entryId:{$regex:'^paypay-'}}).toArray();assert.deepEqual(wrapped.map(w=>w.entryId).sort(),P.map(id=>'paypay-'+id).sort(),'paypay:omf-holds-four-wrapped-keys');
    for(const l of LOGINS)assert.ok(!JSON.stringify(wrapped).includes(l.account)&&!JSON.stringify(wrapped).includes(l.password.trim()),'paypay:server-holds-no-login');
    const afterSave=await status();assert.ok(afterSave.banks.filter(b=>b.supported).every(b=>b.hasCredentials&&!b.refused),'paypay:setup-status-saved');
    const html=await page.content();for(const l of LOGINS)assert.ok(!html.includes(l.account)&&!html.includes(l.password.trim())&&!JSON.stringify(afterSave).includes(l.account),'paypay:no-readback');
    assert.deepEqual(pageErrors,[],'paypay:setup-no-page-errors');
    pass('the real setup page of the real collector process (owned headless Chrome): four separate one-time saves into the real SplitStore through the real key service, fields cleared after each, four distinct sealed entries bound to their own account, OMF holds only the four wrapped keys, no login read back anywhere; BA-PLUS has no form');
    // ── routine jobs through the daemon's own tick ──
    const reads=()=>fs.existsSync(requests)?fs.readFileSync(requests,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const metric=()=>fs.existsSync(metrics)?JSON.parse(fs.readFileSync(metrics,'utf8')):{posts:[],downloads:[],foreign:[]};
    const keyGets=()=>reads().filter(r=>r.path.includes('/collector-security/keys/')&&r.method==='GET').length;
    const uploads=()=>reads().filter(r=>r.path.endsWith('/collector/bank/upload')&&r.method==='POST').length;
    const counted=['statements','queries','exports','logouts','logoutBroken','foreignCsv','overwrites'];
    // A refused or in-use routine job keeps the window for the person until the collector's unchanged 300 s sign-in deadline, then fails
    // with its explanation; the wait covers that deadline plus the browser launch, export and upload on a loaded machine.
    const finished=async(jobId,label,timeout=600000)=>waitFor(async()=>{const r=await db.collection('financebankjobs').findOne({jobId});return r&&['complete','failed'].includes(r.state)?r:null},'job '+label,timeout);
    const settle=async(job,label,before,{expect='complete'}={})=>{
      const row=await finished(job.jobId,label).catch(async error=>{const r=await db.collection('financebankjobs').findOne({jobId:job.jobId}),m=metric(),t0=before.at||0,rel=t=>t?Math.round((new Date(t).getTime()-t0)/1000)+'s':null;
        const timeline=reads().filter(x=>x.jobId===job.jobId).map(x=>[rel(x.t),x.path.startsWith('answer')?'answer':'post',x.state,x.status??x.error??null]);
        const daemon=await local('/status').then(x=>({busy:x.data?.busy,message:x.data?.message})).catch(e=>String(e));
        const trace=(fs.existsSync(traceFile)?fs.readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]).filter(x=>x.t>=t0),polls=trace.filter(x=>/^state:/.test(x.label)),awaits=trace.filter(x=>!/^state:/.test(x.label)).map(x=>[rel(x.t),x.label]),lastPoll=polls.at(-1);
        throw Error(error.message.slice(0,300)+' | job: '+JSON.stringify({state:r?.state,lastMessage:String(r?.lastMessage||'').slice(0,80),collector:!!r?.collectorId,requested:rel(r?.requestedAt),claimed:rel(r?.claimedAt),lease:rel(r?.leaseUntil),updated:rel(r?.updatedAt),completed:rel(r?.completedAt)})+' | status timeline (s since sync): '+JSON.stringify(timeline)+' | portal tail: '+JSON.stringify((m.trace||[]).filter(x=>x.t>=t0).slice(-25).map(x=>[rel(x.t),x.method,x.p]))+' | await trace (s since sync): '+JSON.stringify(awaits)+' | polls: '+JSON.stringify({entries:polls.filter(x=>x.label==='state:enter').length,exits:polls.filter(x=>x.label!=='state:enter').length,last:lastPoll?[rel(lastPoll.t),lastPoll.label]:null})+' | daemon: '+JSON.stringify(daemon)+' | output: '+output.slice(-600).replace(/\s+/g,' '))});
      await waitFor(async()=>!(await status()).busy,'idle '+label);
      assert.equal(row.state,expect,'paypay:job-'+expect+' '+label+' '+row.lastMessage+' | daemon: '+(await status()).message);
      const m=metric(),site={};for(const k of counted)site[k]=(m[k]||0)-(before[k]||0);
      return {job,row,keys:keyGets()-before.keys,uploads:uploads()-before.uploads,posts:m.posts.slice(before.posts),auto:m.posts.slice(before.posts).filter(p=>p.handler),manual:m.posts.slice(before.posts).filter(p=>!p.handler),downloads:m.downloads.slice(before.downloads),forbidden:(m.forbidden||[]).slice(before.forbidden),site,daemonMessage:(await status()).message};
    };
    const mark=()=>{const m=metric(),b={at:Date.now(),keys:keyGets(),uploads:uploads(),posts:m.posts.length,downloads:m.downloads.length,forbidden:(m.forbidden||[]).length};for(const k of counted)b[k]=m[k]||0;return b;};
    const runJob=async(i,label,options={})=>{const before=mark(),job=ok(await ownerReq('bank/accounts/'+P[i]+'/sync',{}),'sync '+label).job;assert.equal(job.kind,'retrieve','paypay:routine-retrieve '+label);return settle(job,label,before,options);};
    const secretFree=(label,value)=>{const text=JSON.stringify(value);for(const l of LOGINS)assert.ok(!text.includes(l.account)&&!text.includes(l.password.trim()),'paypay:no-secret '+label);};
    const pendingOf=async i=>(await banksOf()).find(b=>b.bankAccountId===P[i]).pending;
    const captureOf=async r=>db.collection('financebankstatements').find({'capture.jobId':r.job.jobId}).toArray();
    const outboxOf=(i,r,suffix='')=>path.join(collectorDir,'outbox','bank',P[i],r.job.jobId+suffix);
    // one routine retrieval that signed in directly: one automatic submission of the account's own values through the page's generated
    // handler, one key release, the statement page once, one 照会, one CSV, one ログアウト, no other control, nobody asked
    const directOnce=(r,i,label)=>{
      assert.deepEqual(r.posts.map(p=>[p.index,p.ok,p.fresh,p.handler]),[[i,true,true,true]],'paypay:one-submission-own-account '+label);
      assert.deepEqual(r.posts[0].keys,['Chk','KozaNo','Pw','SessionToken','TenNo','login'],'paypay:native-form-fields '+label);
      assert.equal(r.keys,1,'paypay:one-key-release '+label);
      assert.deepEqual([r.site.statements,r.site.queries,r.site.exports,r.site.logouts,r.site.overwrites],[1,1,1,1,0],'paypay:routine-steps-once '+label+' '+JSON.stringify(r.site));
      assert.deepEqual(r.forbidden,[],'paypay:no-other-control '+label);assert.ok(!(r.row.lastMessage||'').includes('Chrome'),'paypay:not-asked '+label+' '+r.row.lastMessage);
    };
    const firsts=[];
    for(const i of RETRY_ONLY?[0,1]:[0,1,2,3]){
      const r=await runJob(i,'first '+(i+1));firsts.push(r);directOnce(r,i,'first '+(i+1));
      assert.deepEqual(r.downloads.map(d=>[d.index,d.from,d.to]),[[i,SEPT.from,SEPT.to]],'paypay:one-export-of-the-frozen-period '+(i+1));
      const caps=await captureOf(r);assert.equal(caps.length,1,'paypay:capture-linked '+(i+1));
      assert.deepEqual([caps[0].capture.bankAccountId,caps[0].capture.state,caps[0].capture.channel,caps[0].capture.sourceHost,caps[0].capture.labelChecked],[P[i],'needs_review','collector','login.paypay-bank.co.jp',true],'paypay:capture-unmapped '+(i+1));
      assert.match(caps[0].capture.reason,/^mapping-required: /,'paypay:mapping-required '+(i+1));
      assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[i])}),0,'paypay:zero-rows '+(i+1));
      const man=JSON.parse(fs.readFileSync(path.join(outboxOf(i,r),'manifest.json'),'utf8'));
      assert.deepEqual([man.jobId,man.snapshotHash,man.channel,man.sha256===caps[0].hash,!!man.acknowledgedAt],[r.job.jobId,r.job.snapshotHash,'collector',true,true],'paypay:original-outbox-acknowledged '+(i+1));
      assert.equal(sha256(fs.readFileSync(path.join(outboxOf(i,r),man.filename))),man.sha256,'paypay:original-kept '+(i+1));
      secretFree('job '+(i+1),r.row);
      // plan D1: this job's one submission reached the Welcome page directly — the pending marker is cleared (no owner retry needed)
      const b=(await banksOf()).find(x=>x.bankAccountId===P[i]);assert.deepEqual([b.hasCredentials,b.refused,b.pending],[true,false,null],'paypay:direct-sign-in-accepted '+(i+1));
    }
    if(!RETRY_ONLY){
    assert.equal(new Set(firsts.map(f=>f.row.snapshotHash)).size,4,'paypay:four-interpretations');assert.deepEqual(metric().foreign,[],'paypay:no-foreign-request');
    assert.equal(browserModule.ownedBrowsers().filter(b=>b.connected).length,1,'only the setup browser is owned by this process');
    assert.equal(fs.existsSync(path.join(collectorDir,'profiles','ephemeral'))?fs.readdirSync(path.join(collectorDir,'profiles','ephemeral')).length:0,0,'paypay:ephemeral-profiles-removed');
    pass('four routine first captures through the real tick: each retrieve job opened its own saved login once (one key release), submitted the exact public form once with its own values through the page\'s generated handler, reached the Welcome page directly (the pending marker cleared, plan D1), opened 普通預金取引明細照会 once, set the frozen period, pressed 照会 and CSV once and ログアウト once, touched no other control; the unmapped CSV retained needs_review/mapping-required with zero rows, the original kept and acknowledged in the PC outbox');
    // ── native mapping of PayPay 1, then the mapped overlapping repeat and an identical repeat ──
    const cap1=(await captureOf(firsts[0]))[0];
    const sheet=ok(await ownerReq('bank/files/'+cap1._id+'/sheet',undefined,'GET'),'sheet');assert.deepEqual(sheet.headers,HEAD.split(','),'paypay:capture-readable');
    const body={sheet:sheet.sheet,headerRow:sheet.headerRow,mapping:{date:'0',description:'1',outflow:'2',inflow:'3',balance:'4'},bankAccountId:P[0],transactionIdConfirmed:false,confirm:true,templateName:'PayPay 架空マップ'};
    assert.equal(ok(await ownerReq('bank/files/'+cap1._id+'/import',body),'import').rows.length,rowsIn(SEPT.from,SEPT.to),'paypay:mapped-import');
    const tpl=ok(await ownerReq('bank/templates',undefined,'GET'),'templates').templates.find(t=>t.name==='PayPay 架空マップ');
    ok(await connect(0,{templateId:tpl.id,coverage:WIDE}),'mapped connection');
    const before1=await db.collection('financebankrows').find({bankAccountId:new ObjectId(P[0])}).toArray();
    const mapped=await runJob(0,'mapped 1');directOnce(mapped,0,'mapped 1');assert.deepEqual(mapped.downloads.map(d=>[d.from,d.to]),[[WIDE.from,WIDE.to]],'paypay:mapped-period-exported');
    const cap2=(await captureOf(mapped))[0];assert.deepEqual([cap2.capture.state,cap2.capture.rows],['imported',{new:rowsIn(WIDE.from,WIDE.to)-rowsIn(SEPT.from,SEPT.to),existing:rowsIn(SEPT.from,SEPT.to),unchanged:0,differs:0}],'paypay:mapped-overlap-imports-only-new '+JSON.stringify(cap2.capture.rows));
    const after1=await db.collection('financebankrows').find({bankAccountId:new ObjectId(P[0])}).toArray();assert.equal(after1.length,rowsIn(WIDE.from,WIDE.to),'paypay:mapped-rows (each transaction once)');
    for(const old of before1){const now=after1.find(r=>String(r._id)===String(old._id));assert.deepEqual([now?.key,now?.revision],[old.key,old.revision],'paypay:mapped-rows-kept (id, key, revision)');}
    const repeat=await runJob(0,'repeat 1');directOnce(repeat,0,'repeat 1');
    assert.equal(await db.collection('financebankstatements').countDocuments({'capture.jobId':repeat.job.jobId}),0,'paypay:identical-repeat-is-the-same-capture');assert.equal(repeat.uploads,1,'paypay:identical-repeat-sent-once');
    assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[0])}),rowsIn(WIDE.from,WIDE.to),'paypay:identical-repeat-no-rows');
    for(const i of [1,2,3])assert.equal(await db.collection('financebankrows').countDocuments({bankAccountId:new ObjectId(P[i])}),0,'paypay:other-accounts-untouched');
    assert.equal(await pendingOf(0),null,'paypay:mapped-jobs-direct');
    pass('native mapping: the retained first capture of PayPay 1 imported with the existing importer and saved as a template; the mapped connection\'s next routine job (a wider period) signed in directly with the same saved login and imported only the new rows over the overlap (earlier rows kept with their ids, keys and revisions); an identical repeat was sent once and taken as the same capture; the other three accounts unchanged');
    // ── the bank refuses PayPay 3's saved password: remembered, the person's manual sign-in never taken as proof, re-saved ──
    const changed=LOGINS.map(l=>l.password);changed[2]='Fict3-changed-at-the-bank';
    await scene({passwords:changed});
    const refusedRun=await runJob(2,'refused 3',{expect:'failed'});
    assert.deepEqual(refusedRun.posts.map(p=>[p.index,p.ok,p.handler]),[[-1,false,true]],'paypay:refused-one-submission '+refusedRun.daemonMessage);assert.match(refusedRun.row.lastMessage,/受け付けませんでした/,'paypay:refused-message');
    assert.deepEqual([refusedRun.site.exports,refusedRun.site.statements],[0,0],'paypay:refused-no-export');
    const afterRefusal=await banksOf();assert.deepEqual(afterRefusal.filter(b=>b.supported).map(b=>b.pending),[null,null,'refused',null],'paypay:refusal-distinguished-and-isolated');
    await scene({passwords:changed,signIn:3});
    const manual=await runJob(2,'manual 3');
    assert.deepEqual([manual.auto.length,manual.keys,manual.manual.map(p=>[p.index,p.ok])],[0,0,[[2,true]]],'paypay:blocked-no-automatic-submission (the person signed in by hand)');
    assert.equal(manual.site.exports,1,'paypay:manual-sign-in-with-label-exports');assert.equal(await pendingOf(2),'refused','paypay:manual-sign-in-not-accepted (plan D1)');
    await scene({passwords:changed});
    await openSetup();assert.match(await page.$eval(section(P[2])+'[data-bank-login-note]',e=>e.textContent),/bank refused the saved login.*If you changed/i,'paypay:setup-shows-refusal');assert.notEqual(await page.$(section(P[2])+'[data-bank-login-retry]'),null,'paypay:refusal-offers-explicit-retry');
    await saveLogin(2,{...LOGINS[2],password:changed[2]});
    const resaved=await runJob(2,'resaved 3');directOnce(resaved,2,'resaved 3');
    assert.deepEqual((await banksOf()).filter(b=>b.supported).map(b=>b.pending),[null,null,null,null],'paypay:resave-then-direct');
    pass('the bank refused PayPay 3\'s changed password: one submission, the job failed with re-save guidance and no export, only PayPay 3 marked refused (the explicit retry offered beside the re-save); its next job submitted nothing automatically and released no key — the person signed in by hand and the labelled export ran, but that sign-in did not clear the refusal; re-saved through the setup page, the next job signed in directly once');
    // ── plan omf-paypay-split-dates-retry-20261022: a refusal of the CURRENT saved login — the owner's explicit retry, no re-entry ──
    const sealedOf=i=>fs.readFileSync(path.join(collectorDir,'secrets','paypay-'+P[i]+'.sealed'),'utf8');
    const sealed3=sealedOf(2),refusedFor=[...changed];refusedFor[2]='Fict3-refused-for-a-while';
    await scene({passwords:refusedFor});
    const refusedCurrent=await runJob(2,'refused current 3',{expect:'failed'});assert.match(refusedCurrent.row.lastMessage,/受け付けませんでした/,'paypay:refused-current-message (the job ended through the refusal, not another failure) '+JSON.stringify({lastMessage:refusedCurrent.row.lastMessage,daemon:refusedCurrent.daemonMessage}));assert.deepEqual(refusedCurrent.posts.map(p=>[p.index,p.ok]),[[-1,false]],'paypay:refused-current-one-submission');assert.equal(await pendingOf(2),'refused','paypay:refused-current-marked');
    await scene({passwords:changed});
    await openSetup();assert.match(await page.$eval(section(P[2])+'[data-bank-login-note]',e=>e.textContent),/still current, allow one more automatic sign-in/,'paypay:refused-current-retry-explained');
    await retryLogin(2);
    const retriedRefusal=await runJob(2,'retried refusal 3');directOnce(retriedRefusal,2,'retried refusal 3');
    assert.equal(sealedOf(2),sealed3,'paypay:refused-current-no-reentry (the sealed entry is unchanged)');assert.equal(await pendingOf(2),null,'paypay:refused-current-retry-direct');
    pass('a bank refusal of PayPay 3\'s CURRENT saved login (real daemon, real setup page): one submission marked refused; the owner\'s explicit retry in the setup page (no key release, no job, no re-entry: the sealed entry is byte-identical) let the next job sign in directly once with the same saved login');
    // ── the observed active-session page: the standard form again under 上書きログイン（ログイン中です） ──
    await scene({passwords:changed,inUse:true});
    const inUse=await runJob(2,'in use 3',{expect:'failed'});
    assert.deepEqual(inUse.posts.map(p=>[p.index,p.ok]),[[2,true]],'paypay:in-use-one-submission');assert.equal(inUse.keys,1,'paypay:in-use-one-release');
    assert.match(inUse.row.lastMessage,/ログイン中だった/,'paypay:in-use-message');assert.doesNotMatch(inUse.row.lastMessage,/受け付けませんでした/,'paypay:in-use-not-wrong-password');
    assert.deepEqual([inUse.site.overwrites,inUse.site.exports],[0,0],'paypay:in-use-overwrite-never-requested');assert.equal(await pendingOf(2),'uncertain','paypay:in-use-stays-uncertain');
    await scene({passwords:changed,signIn:3});
    const afterInUse=await runJob(2,'after in use 3');assert.deepEqual([afterInUse.auto.length,afterInUse.keys],[0,0],'paypay:in-use-no-second-submission');assert.equal(await pendingOf(2),'uncertain','paypay:in-use-manual-not-accepted');
    await scene({passwords:changed});
    await retryLogin(2);const freed=await runJob(2,'after in-use retry 3');directOnce(freed,2,'after in-use retry 3');assert.equal(await pendingOf(2),null);
    secretFree('in-use job',[inUse.row,afterInUse.row,freed.row]);
    pass('the observed active-session page for PayPay 3 (real daemon): one submission, kept uncertain (not refused), the job explained the other session, 上書きログイン never requested and nothing exported; the next job submitted nothing automatically (the person\'s own sign-in was not taken as proof) until the owner\'s explicit retry, then signed in directly once');
    // ── the routine exits on the real daemon (PayPay 4) ──
    // (a) an unknown page after the submission: the person is asked; nothing is clicked there; the person's step is not direct → no acceptance
    // the person can act only after being asked (the window is hidden until then): the step is released once OMF shows the job
    // verification_required, never during the collector's own settle after the submission
    await scene({passwords:changed,notice:true});
    const beforeNotice=mark(),noticeJob=ok(await ownerReq('bank/accounts/'+P[3]+'/sync',{}),'sync notice 4').job;assert.equal(noticeJob.kind,'retrieve');
    await waitFor(async()=>(await db.collection('financebankjobs').findOne({jobId:noticeJob.jobId}))?.state==='verification_required','notice 4 asks the person',180000);
    await scene({passwords:changed,notice:true,resolveNotice:true});
    const notice=await settle(noticeJob,'notice 4',beforeNotice);
    assert.deepEqual([notice.auto.length,notice.manual.length,notice.keys,notice.site.exports],[1,0,1,1],'paypay:notice-one-submission-person-continued');
    assert.equal(await pendingOf(3),'uncertain','paypay:notice-not-direct-not-accepted');
    await scene({passwords:changed});await retryLogin(3);
    // (b) the statement page shows another account's name: no export, ログアウト still pressed
    await scene({passwords:changed,label:'PayPay 9'});
    const label=await runJob(3,'label 4',{expect:'failed'});
    assert.deepEqual([label.site.exports,label.site.logouts],[0,1],'paypay:label-mismatch-no-export');assert.match(label.daemonMessage,/一致しません/,'paypay:label-mismatch-explained');
    // (c) a period the bank cannot select: nothing queried, nothing exported, ログアウト still pressed
    await scene({passwords:changed});ok(await connect(3,{coverage:{from:'2015-01-01',to:SEPT.to}}),'period outside the bank');
    const period=await runJob(3,'period 4',{expect:'failed'});
    assert.deepEqual([period.site.queries,period.site.exports,period.site.logouts],[0,0,1],'paypay:period-not-selectable-held');assert.match(period.daemonMessage,/選べません|設定できませんでした/,'paypay:period-explained');
    ok(await connect(3),'period restored');
    // (d) the download comes from another host: refused by the download-host guard, nothing sent, ログアウト pressed
    await scene({passwords:changed,foreignCsv:true});
    const host=await runJob(3,'host 4',{expect:'failed'});
    assert.deepEqual([host.site.foreignCsv,host.site.logouts],[1,1],'paypay:foreign-download-refused');assert.equal((await captureOf(host)).length,0,'paypay:foreign-download-not-sent');assert.match(host.daemonMessage,/銀行サイトではありません/,'paypay:foreign-download-explained');
    // (e) ログアウト fails: the result is unchanged
    await scene({passwords:changed,logoutBroken:true});
    const broken=await runJob(3,'logout broken 4');assert.deepEqual([broken.site.exports,broken.site.logoutBroken],[1,1],'paypay:logout-failure-harmless');
    await scene({passwords:changed});assert.deepEqual(metric().foreign,[],'paypay:no-foreign-request');
    pass('the routine exits on the real daemon (PayPay 4): an unknown page after the one submission asked the person and nothing was clicked there — the person continued, the export ran, but the sign-in was not direct and stayed uncertain until the retry; another account\'s name on the statement page, a period the bank cannot select and a download from another host each stopped before anything was sent, with ログアウト still pressed; a failing ログアウト left the result unchanged');
    // ── one HISTORICAL guided observe job (plan P1 kept): queued before this plan by 12cf98c, so it is inserted here with the exact shape
    // that queue froze (kind observe, unmapped snapshot without a period, the guided message) — the current queue never creates one ──
    const histSnapshot={templateId:null,templateRevision:0,headers:[],mapping:{},amountSign:'outflow-positive',transactionIdConfirmed:false,parserVersion:'bank-template-1',currency:'JPY',provider:'paypay',accountLabel:'PayPay 2',variant:'standard',coverage:null,interpretation:'unmapped'};
    const histJob={ownerId:new ObjectId(ownerId),bankAccountId:new ObjectId(P[1]),jobId:crypto.randomUUID(),kind:'observe',state:'queued',open:true,requestedAt:new Date(),lastMessage:'PayPay銀行の初回のガイド付き取得を予約しました。接続したPCのChromeで入出金明細のCSVを出力してください（列の割り当ては受信後）',snapshot:histSnapshot,snapshotHash:sha256(JSON.stringify(histSnapshot)),statementIds:[],observation:null,createdAt:new Date(),updatedAt:new Date()};
    await scene({passwords:changed,guided:true});
    const beforeHist=mark();await db.collection('financebankjobs').insertOne(histJob);
    const hist=await settle({jobId:histJob.jobId,snapshotHash:histJob.snapshotHash},'historical guided 2',beforeHist);
    assert.deepEqual(hist.posts.map(p=>[p.index,p.ok,p.handler]),[[1,true,true]],'paypay:historical-one-submission');assert.equal(hist.keys,1,'paypay:historical-one-key-release');
    assert.deepEqual([hist.site.queries,hist.site.exports],[0,1],'paypay:historical-person-exported (no automatic period or 照会)');
    const histCap=await db.collection('financebankstatements').find({'capture.jobId':histJob.jobId}).toArray();
    assert.deepEqual(histCap.map(c=>[c.capture.channel,c.capture.state]),[['collector-observe','needs_review']],'paypay:historical-capture-retained');
    assert.equal(await pendingOf(1),'uncertain','paypay:historical-file-not-proof (plan P1)');
    const obs=hist.row.observation;assert.ok(Array.isArray(obs)&&obs.length>=2,'paypay:historical-observation-stored');secretFree('historical observation',obs);
    assert.ok(!obs.some(p=>(p.typedInto||[]).some(t=>['idTenNo','idKozaNo','idPw','TenNo','KozaNo','Pw'].includes(t.id))),'paypay:automatic-fill-not-recorded-as-typing');
    await scene({passwords:changed});await retryLogin(1);
    pass('a historical guided observe job of PayPay 2 (inserted with the 12cf98c queue\'s own snapshot shape, never queued by this build): one submission through the page\'s handler, the person exported in the owned page, the CSV retained needs_review through the observe channel, the observation stored without any login value or typing record, and the kept CSV did NOT clear the uncertain marker (plan P1) until the owner\'s retry');
    // ── BA-PLUS: a plain observe (no saved login, no key) ──
    await scene({passwords:changed,guided:true,closeAtLogin:true});
    const keysBefore=keyGets(),postsBefore=metric().posts.length,baJob=ok(await ownerReq('bank/accounts/'+BA+'/sync',{}),'sync ba').job;assert.equal(baJob.kind,'observe','paypay:baplus-observe');
    const baRow=await finished(baJob.jobId,'ba job',120000);await waitFor(async()=>!(await status()).busy,'idle ba');
    assert.equal(baRow.state,'complete');assert.equal(keyGets(),keysBefore,'paypay:baplus-no-key');assert.equal(metric().posts.length,postsBefore,'paypay:baplus-no-submission');
    pass('BA-PLUS stays a manual observe: no saved login, no key release, no submission');
    // ── review fold F3: refused captures at the bank statement outbox boundary (real tick, real OMF, real outbox on this PC) ──
    // (1) PayPay 2 exports an empty-period file (the header only): retained needs_review with zero rows
    await scene({passwords:changed,export:'header-only'});
    const empty2=await runJob(1,'empty period 2');
    const emptyCap=await captureOf(empty2);assert.equal(emptyCap.length,1,'paypay:empty-period-retained');assert.equal(emptyCap[0].capture.state,'needs_review','paypay:empty-period-needs-review');
    // (2) PayPay 4 exports the identical bytes: OMF holds them as PayPay 2's statement and refuses for good → terminal on this PC, explained
    const empty4=await runJob(3,'empty period 4',{expect:'failed'});
    assert.match(empty4.row.lastMessage,/別の口座で受信済み/,'paypay:other-account-refusal-explained');assert.match(empty4.row.lastMessage,/このPC/,'paypay:other-account-original-kept-explained');
    assert.equal((await captureOf(empty4)).length,0,'paypay:other-account-nothing-imported');
    const ownerJobs=ok(await ownerReq('bank/accounts/'+P[3]+'/jobs',undefined,'GET'),'jobs 4').jobs;assert.match(String(ownerJobs.find(j=>j.jobId===empty4.job.jobId)?.lastMessage),/別の口座で受信済み/,'paypay:refusal-owner-visible');
    const man4=JSON.parse(fs.readFileSync(path.join(outboxOf(3,empty4),'manifest.json'),'utf8'));
    assert.deepEqual([man4.refusal?.status,man4.refusal?.reason,man4.acknowledgedAt],[409,'other-account',undefined],'paypay:refusal-recorded-on-pc');
    assert.equal(man4.sha256,emptyCap[0].hash,'paypay:identical-empty-period-bytes');assert.equal(sha256(fs.readFileSync(path.join(outboxOf(3,empty4),man4.filename))),man4.sha256,'paypay:refused-original-kept');
    // (3) PayPay 4's next job proceeds and sends only its own new statement: the refused statement is never sent again
    await scene({passwords:changed});
    const next4=await runJob(3,'after refusal 4');assert.equal(next4.row.state,'complete','paypay:next-job-proceeds');assert.equal(next4.uploads,1,'paypay:refused-capture-not-resent');
    // (4) PayPay 2 exports a PDF: OMF refuses it as unreadable (415) for good — recorded on this PC with the original kept, explained, never resent
    await scene({passwords:changed,export:'pdf'});
    const pdf2=await runJob(1,'pdf 2',{expect:'failed'});
    assert.match(pdf2.row.lastMessage,/CSV・テキストとして読めない/,'paypay:pdf-explained');assert.equal(pdf2.uploads,1,'paypay:pdf-sent-once-and-refused');assert.deepEqual(pdf2.downloads.map(d=>d.export),['pdf']);
    assert.equal((await captureOf(pdf2)).length,0,'paypay:pdf-nothing-imported');
    const man2=JSON.parse(fs.readFileSync(path.join(outboxOf(1,pdf2),'manifest.json'),'utf8'));assert.deepEqual([man2.refusal?.status,man2.refusal?.reason,man2.acknowledgedAt],[415,'unreadable',undefined],'paypay:pdf-refusal-recorded-on-pc');
    assert.equal(fs.readFileSync(path.join(outboxOf(1,pdf2),man2.filename)).subarray(0,5).toString(),'%PDF-','paypay:pdf-original-kept');
    await scene({passwords:changed});
    const next2=await runJob(1,'after pdf 2');assert.equal(next2.uploads,1,'paypay:pdf-not-resent');
    pass('refused captures at the bank statement outbox (real tick, real OMF): the identical empty-period export of PayPay 2 retained needs_review, the same bytes from PayPay 4 refused by OMF as another account\'s statement — the job failed with the explanation shown to the owner, the manifest recorded the refusal on this PC with the original kept, never acknowledged; PayPay 4\'s next job sent only its own statement; a PDF export was refused as unreadable once, recorded on this PC with the original kept, explained and never sent again');
    }
    // ── review fold F4: the ACTUAL /bank/retry route reservation (real daemon HTTP, real tick, real markers) ──
    const markerOf=i=>path.join(collectorDir,'bank-login','paypay-'+P[i]+'.json');
    const scenarioBase=JSON.parse(fs.readFileSync(scenarioFile,'utf8')).passwords?{passwords:JSON.parse(fs.readFileSync(scenarioFile,'utf8')).passwords}:{};
    await waitFor(async()=>!(await status()).busy,'idle before the route leg');
    assert.deepEqual([await pendingOf(0),await pendingOf(1)],[null,null],'paypay:route-leg-precondition');
    // plan omf-paypay-split-dates-retry-20261022: PayPay 2's saved login is refused by the bank (its CURRENT key, same entry and keyId), so the
    // busy and in-flight checks below exercise the widened refused retry through the real daemon HTTP
    {const refusing=[...(scenarioBase.passwords||LOGINS.map(l=>l.password))];refusing[1]='Fict2-refused-for-the-route-leg';await scene({passwords:refusing});await runJob(1,'route refusal 2',{expect:'failed'});await scene(scenarioBase);}
    assert.equal(await pendingOf(1),'refused','paypay:route-leg-refused-current-key');
    // (A) a routine job of PayPay 1 holds the action slot (the bank answers its statement page slowly): a retry of PayPay 2 is refused, its marker unchanged
    await scene({...scenarioBase,slowStatementsMs:20000});
    const holdJob=ok(await ownerReq('bank/accounts/'+P[0]+'/sync',{}),'sync hold').job;
    await waitFor(async()=>{const r=await db.collection('financebankjobs').findOne({jobId:holdJob.jobId});return ['running','verification_required'].includes(r?.state)&&!!r?.collectorId&&fs.existsSync(path.join(collectorDir,'outbox','bank',P[0],holdJob.jobId,'login.json'))},'hold job active',120000);
    const markerBefore=fs.readFileSync(markerOf(1),'utf8'),whileJob=await local('/bank/retry',{bankAccountId:P[1]});
    assert.equal(whileJob.status,409,'paypay:retry-409-while-job '+JSON.stringify(whileJob.data));assert.match(String(whileJob.data?.error),/Wait for the current collector action/,'paypay:retry-busy-while-job');
    assert.equal(fs.readFileSync(markerOf(1),'utf8'),markerBefore,'paypay:retry-while-job-marker-unchanged');assert.equal(await pendingOf(1),'refused','paypay:retry-while-job-still-refused');
    const held=await finished(holdJob.jobId,'hold job done',180000);assert.equal(held.state,'complete','paypay:hold-job-complete '+held.lastMessage);
    await waitFor(async()=>!(await status()).busy,'idle after hold');
    // (B) a retry whose body is still arriving holds the slot from before the body is read: a job queued meanwhile is not claimed by any tick
    await scene(scenarioBase);
    const rawRetry=id=>{const body=Buffer.from(JSON.stringify({bankAccountId:id})),cut=Math.floor(body.length/2);let settled=null;const req=http.request(setup.origin+'/bank/retry',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,'X-Setup-Key':setup.hash.slice(1),Origin:setup.origin}});
      const answer=new Promise((resolve,reject)=>{req.on('response',res=>{let t='';res.on('data',d=>{t+=d;});res.on('end',()=>{settled={status:res.statusCode,data:JSON.parse(t||'{}')};resolve(settled);});});req.on('error',reject);});
      answer.catch(()=>{});/* a reset after a failed assertion must not hide that assertion */req.write(body.subarray(0,cut));return {answer,settled:()=>settled,finish:()=>req.end(body.subarray(cut))};};
    let slow=null,early=0;for(let attempt=0;attempt<20&&!slow;attempt++){const r=rawRetry(P[1]);await pause(1500);if(r.settled()){assert.equal(r.settled().status,409,'paypay:in-flight-early-answer-is-busy');early++;await pause(700);continue;}slow=r;}
    assert.ok(slow,'paypay:in-flight-retry-started');
    const queued=ok(await ownerReq('bank/accounts/'+P[0]+'/sync',{}),'sync while retry in flight').job;await pause(5000);
    const during=await db.collection('financebankjobs').findOne({jobId:queued.jobId});
    assert.deepEqual([during.state,during.collectorId??null,slow.settled()],['queued',null,null],'paypay:retry-route-reserves-before-body (no tick claims while the retry is in flight)');assert.equal((await status()).busy,true,'paypay:in-flight-retry-holds-slot');
    slow.finish();const done=await slow.answer;assert.deepEqual([done.status,done.data],[200,{retry:true}],'paypay:in-flight-retry-completes');assert.equal(await pendingOf(1),null,'paypay:in-flight-retry-rearmed');
    const resumed=await finished(queued.jobId,'job after the retry',180000);assert.equal(resumed.state,'complete','paypay:slot-released-work-resumes '+JSON.stringify(resumed.lastMessage||null));
    await waitFor(async()=>!(await status()).busy,'idle after the route leg');await scene(scenarioBase);
    const routeReceipt={whileJob:whileJob.status,inFlightEarlyBusy:early,claimedWhileInFlight:during.state!=='queued',afterCompletion:done.status,resumed:resumed.state};
    pass('the actual /bank/retry route (real daemon HTTP, real tick; PayPay 2 holding a bank refusal of its current key): while PayPay 1\'s routine job held the action slot a retry of PayPay 2 was refused 409 and its marker stayed byte-identical; a retry whose body was still arriving held the slot from before the body was read — a job queued meanwhile stayed unclaimed across 5 ticks — and once the body completed the retry answered 200, re-armed only PayPay 2, released the slot and the queued job ran');
    if(RETRY_ONLY){console.log(JSON.stringify({pass:true,checks,mode:'retry-route',mutant:RETRY_MUTANT||null,route:routeReceipt,foreignRequests:metric().foreign.length,bankRequests:0,productionWrites:0}));return;}
    await waitFor(async()=>!(await status()).busy,'idle before pause');
    // /pause ends the session: it closes every browser the session launched, then the key broker; its duration is recorded in the receipt
    const pauseStarted=Date.now();ok(await local('/pause',{},30000),'daemon pause');const pauseMs=Date.now()-pauseStarted;
    // ── after the save: scope, login type and revocation stop the release (in-process, the daemon paused) ──
    const s1=brokerOf(await securityHttp('session',{body:{installationId,generation,trustToken}}));
    const handle=i=>idx.bankLoginFor({job:{kind:'retrieve',snapshot:firsts[i].row.snapshot,provider:'paypay'},account:{_id:P[i],ownerId}},config,s1,{store,root:collectorDir,assert:()=>{}});
    assert.deepEqual(await handle(1).open(),LOGINS[1],'paypay:own-values-released');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[P[0],P[2],P[3],BA]},'PUT'),'scope removed for PayPay 2');
    await assert.rejects(handle(1).open(),e=>e.code==='bank-login-unavailable','paypay:removed-scope-no-release');assert.deepEqual(await handle(3).open(),LOGINS[3],'paypay:other-account-still-released');
    ok(await ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[...P,BA]},'PUT'),'scope restored');
    ok(await ownerReq('bank/accounts/'+P[1]+'/connection',{provider:'paypay',variant:'baplus',templateId:baTemplate.id},'PUT'),'login type changed');
    await assert.rejects(handle(1).open(),e=>e.code==='bank-login-unavailable','paypay:login-type-change-no-release');
    ok(await connect(1),'login type restored');
    assert.deepEqual(await handle(1).open(),LOGINS[1],'paypay:restored-release');
    await assert.rejects(ownerReq('bank/collectors/'+deviceId,{bankAccountIds:[foreign]},'PUT').then(r=>{if(r.status!==200)throw Object.assign(Error('refused'),{status:r.status});}),e=>e.status===400,'paypay:foreign-account-not-grantable');
    ok(await call('/api/finance/collectors/'+deviceId,{method:'DELETE',token:owner}),'device revoked');
    await assert.rejects(handle(0).open(),e=>[401,403].includes(e.status)||e.code==='bank-login-unavailable','paypay:revoked-device-no-release');
    secretFree('omf jobs',await db.collection('financebankjobs').find({}).toArray());secretFree('omf statements',await db.collection('financebankstatements').find({}).project({capture:1,name:1}).toArray());
    pass('after the saves: a removed bank scope and a BA-PLUS change stop that account\'s release (controlled bank-login failure) while another account still releases; restored, it releases again; a foreign account cannot be granted; a revoked PC releases nothing; no login value is stored by OMF');
    const m=metric();
    console.log(JSON.stringify({pass:true,checks,accounts:4,pauseMs,route:routeReceipt,retryBusyRefusals:busyRefusals,retryAnswers,loginSubmissions:m.posts.length,automaticSubmissions:m.posts.filter(p=>p.handler).length,exports:m.downloads.length,logouts:m.logouts,keyReleases:keyGets(),foreignRequests:m.foreign.length,bankRequests:0,productionWrites:0}));
  }finally{
    // OMF_ROUTINE_EVIDENCE_DIR (set by the routine fixture): the daemon's await trace, its OMF request log and the portal metrics are kept
    const keepDir=process.env.OMF_ROUTINE_EVIDENCE_DIR;if(keepDir&&fs.existsSync(keepDir))for(const [name,file] of evidence)if(fs.existsSync(file))await fsp.copyFile(file,path.join(keepDir,(process.env.OMF_ROUTINE_EVIDENCE_PREFIX||'R5')+'-native-'+name+'-'+new Date().toISOString().replace(/[:.]/g,'-')+path.extname(file))).catch(()=>{});
    if(daemon&&daemon.exitCode===null){const exited=new Promise(r=>daemon.once('exit',r));daemon.kill();await exited;}
    if(setupBrowser)await setupBrowser.close().catch(()=>{});
    for(const b of brokers)await b.remote.end().catch(()=>{});
    await (await import(u('collector/browser.mjs'))).closeOwnedBrowsers().catch(()=>{});
    if(client)await client.close().catch(()=>{});
    if(app&&app.exitCode===null){const ended=new Promise(r=>app.once('exit',r));app.kill();await ended;}
    if(mongo)await mongo.stop().catch(()=>{});
    if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={site,loginDoc,TITLES};
if(require.main===module)main().then(()=>0,error=>{console.error(String(error&&error.stack||error).slice(0,40000));return 1;}).then(code=>{process.stdout.write('',()=>process.exit(code));});

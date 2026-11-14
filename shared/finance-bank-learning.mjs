// Portable, closed data contract. No bank text, selectors, URLs with paths, credentials or file bytes enter development evidence.
export const LEARNING_RUNTIME = 'omf-bank-learning-1';
export const LEARNING_MODEL = 'gpt-6.1-sol';
export const LEARNING_STATEMENT_CAPABILITY = 'bank-learning-statements-1';
export const LEARNING_LOGIN_CAPABILITY = 'bank-learning-login-2';
export const LEARNING_ROLES = ['inquiry','account','from','to','export','balance','logout'];
export const LEARNING_DATE_PARTS = ['year','month','day'];
// Schema 2 adds an opt-in login demonstration. Schema 1 readers reject it before execution.
export const LEARNING_LOGIN_ROLES = ['login-navigation','login-identifier','login-password','login-submit','login-manual','login-success'];
export const LEARNING_LOGIN_STOP_CODES = ['local-login-input-cancelled','local-login-input-timeout','local-login-input-required','local-login-input-unavailable','login-not-submitted','login-cancelled-before-submit','login-cancelled','login-control-changed','login-form-changed','login-success-already-present','login-demonstration-incomplete','unsupported-login-sequence','login-order-invalid','login-outcome-unconfirmed','manual-login-timeout','manual-login-successor-invalid'];
export function learningFailureText(code){
  if(['unsupported-login-sequence','login-order-invalid','login-demonstration-incomplete','manual-login-successor-invalid'].includes(code))return 'このログイン手順は自動実行に対応していません。記録を中止し、本人操作または手動CSV取り込みをご利用ください。';
  if(code==='local-login-input-cancelled'||code==='login-cancelled-before-submit')return 'ログイン入力を取り消しました。ログイン送信は実行していません。自動で再送しません。';
  if(code==='local-login-input-timeout')return 'このPCの設定画面でのログイン入力が時間切れになりました。ログイン送信は実行していません。';
  if(['local-login-input-required','local-login-input-unavailable','login-not-submitted','login-control-changed','login-form-changed','login-success-already-present'].includes(code))return 'ログイン画面またはローカル入力を確認できず、ログイン送信前に停止しました。手順とこのPCの設定画面を確認してください。';
  if(['login-cancelled','login-outcome-unconfirmed','manual-login-timeout'].includes(code))return 'ログイン完了を確認できません。送信済みのログインは銀行に届いている場合があります。自動で再送しません。銀行の画面・状態を確認してください。';
  return '';
}
/** Closed structural prefix, shared by recording and the final evidence boundary. */
export function validateLoginPrefix(events,{complete=false}={}){
  learningAssert(Array.isArray(events)&&events.length<=32,'unsupported-login-sequence');
  let identifier,password,submit,success,manual=false;
  const same=(a,b)=>['popup','document','frame','origin'].every(k=>a[k]===b[k]);
  for(let i=0;i<events.length;i++){
    const e=events[i];learningAssert(LEARNING_LOGIN_ROLES.includes(e.role)&&!success,'unsupported-login-sequence');
    if(e.role==='login-navigation')learningAssert(!identifier&&!password&&!submit,'unsupported-login-sequence');
    if(e.role==='login-identifier'){learningAssert(!identifier&&!password&&!submit,'unsupported-login-sequence');identifier=e;}
    if(e.role==='login-password'){learningAssert(!password&&!submit&&(!identifier||same(identifier,e)),'unsupported-login-sequence');password=e;}
    if(e.role==='login-submit'){learningAssert(password&&!submit&&same(password,e)&&(!identifier||same(identifier,e)),'unsupported-login-sequence');submit=e;}
    if(e.role==='login-manual'){
      learningAssert(['otp','certificate','other'].includes(e.format),'invalid-manual-login');
      // One inline manual check may own the native submit; no OTP is read or filled.
      if(password&&!submit)learningAssert(events[i-1]===password,'unsupported-login-sequence');
      manual=true;
    }
    if(e.role==='login-success'){
      learningAssert((password&&submit)||(!identifier&&!password&&!submit&&manual),'login-demonstration-incomplete');success=e;
    }
  }
  if(complete)learningAssert(events.length>1&&success===events.at(-1),'login-demonstration-incomplete');
  return events;
}
export const LEARNING_STATES = ['awaiting_pc','recording','queued','developing','needs_demonstration','candidate','replaying','verified','enabled','failed','cancelled'];
export const LEARNING_MISSING = ['frame','popup','account','from','to','export','balance','logout','runtime_extension_needed','worker_unavailable'];
export const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if(value instanceof Date)return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function learningAssert(ok, code = 'invalid-learning-data') { if (!ok) throw Object.assign(new Error(code), { code }); }
export function validateMissing(value) {
  learningAssert(Array.isArray(value)&&value.length>0&&value.length<=8&&value.every(v=>LEARNING_MISSING.includes(v)),'invalid-missing-steps');
  return value;
}
const keys = (v, allowed, required = allowed) => {
  learningAssert(v && typeof v === 'object' && !Array.isArray(v));
  learningAssert(Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v,k)));
};
export const learningHash = value => /^[a-f0-9]{64}$/.test(String(value));
export const learningId = value => /^[a-f0-9]{24}$/.test(String(value));
export function learningDay(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
}
export function learningPeriod(value) { keys(value,['from','to']); learningAssert(learningDay(value.from) && learningDay(value.to) && value.from <= value.to); return value; }
export function learningOrigin(value, { test = false } = {}) {
  const url = new URL(value);
  learningAssert(url.origin === value && !url.username && !url.password && (url.protocol === 'https:' || (test && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))), 'invalid-learning-origin');
  return value;
}
export function validateEvidence(input, options = {}) {
  keys(input,['schema','runtime','origins','events','complete','truncated']);
  learningAssert([1,2].includes(input.schema) && input.runtime === LEARNING_RUNTIME && input.complete === true && input.truncated === false, 'incomplete-demonstration');
  learningAssert(Array.isArray(input.origins) && input.origins.length > 0 && input.origins.length <= 8);
  input.origins.forEach(v => learningOrigin(v,options));
  learningAssert(new Set(input.origins).size === input.origins.length);
  learningAssert(Array.isArray(input.events) && input.events.length > 0 && input.events.length <= 160);
  const ids = new Set();
  for (const e of input.events) {
    keys(e,['id','document','frame','popup','origin','role','tag','format'],['id','document','frame','popup','origin','role','tag']);
    learningAssert(/^e\d{1,3}$/.test(e.id) && !ids.has(e.id)); ids.add(e.id);
    learningAssert(/^d\d{1,3}$/.test(e.document) && /^f\d{1,3}$/.test(e.frame) && /^p\d{1,3}$/.test(e.popup));
    learningAssert(input.origins.includes(e.origin) && [...LEARNING_ROLES,...(input.schema===2?LEARNING_LOGIN_ROLES:[])].includes(e.role) && ['button','a','input','select','text'].includes(e.tag));
    learningAssert(e.format === undefined || (['from','to'].includes(e.role) && ['iso','compact','slash',...LEARNING_DATE_PARTS].includes(e.format)) || (e.role==='login-manual'&&['otp','certificate','other'].includes(e.format)));
    if(['login-identifier','login-password'].includes(e.role))learningAssert(e.tag==='input','invalid-login-control');
  }
  if(input.schema===2){
    const login=input.events.filter(e=>LEARNING_LOGIN_ROLES.includes(e.role)),success=login.filter(e=>e.role==='login-success');
    learningAssert(login.length>1&&login.length<=32&&success.length===1&&login.at(-1)===success[0],'login-demonstration-incomplete');
    learningAssert(input.events.slice(0,login.length).every(e=>LEARNING_LOGIN_ROLES.includes(e.role)),'login-order-invalid');
    validateLoginPrefix(login,{complete:true});
  }
  for (const role of LEARNING_ROLES.filter(v=>v!=='inquiry')) learningAssert(input.events.some(e=>e.role===role),'missing-'+role);
  return input;
}
export function validateRecipe(input, evidence, evidenceHash, options = {}) {
  validateEvidence(evidence,options);
  keys(input,['schema','runtime','evidenceHash','steps']);
  learningAssert(input.schema===evidence.schema && input.runtime===LEARNING_RUNTIME && learningHash(evidenceHash) && input.evidenceHash===evidenceHash,'candidate-binding-mismatch');
  learningAssert(Array.isArray(input.steps) && input.steps.length>0 && input.steps.length<=evidence.events.length);
  let index=-1;
  const counts={},selected={};
  for(const step of input.steps) {
    keys(step,['eventId','op']);
    const at=evidence.events.findIndex(e=>e.id===step.eventId),event=evidence.events[at];
    learningAssert(at>index && event && event.role===step.op,'undemonstrated-action'); index=at;
    counts[step.op]=(counts[step.op]||0)+1;
    (selected[step.op]||=[]).push(event);
  }
  for(const role of LEARNING_ROLES.filter(v=>v!=='inquiry')) {
    if(['from','to'].includes(role)) {
      const dates=selected[role]||[];
      const whole=dates.length===1&&!LEARNING_DATE_PARTS.includes(dates[0].format);
      const split=dates.length===3&&LEARNING_DATE_PARTS.every(part=>dates.some(e=>e.format===part));
      learningAssert(whole||split,'candidate-missing-or-repeated-'+role);
    } else learningAssert(counts[role]===1,'candidate-missing-or-repeated-'+role);
  }
  if(evidence.schema===2)learningAssert(stable(input.steps.filter(s=>LEARNING_LOGIN_ROLES.includes(s.op)).map(s=>s.eventId))===stable(evidence.events.filter(e=>LEARNING_LOGIN_ROLES.includes(e.role)).map(e=>e.id)),'candidate-login-steps-changed');
  return input;
}
export function validateReplay(input, session) {
  const fields=['candidateHash','evidenceHash','runtime','period','statementHash','rows','balanceObserved','accountMatched','loggedOut','freshBrowser','startedAt','finishedAt'];
  keys(input,[...fields,'authentication'],fields);
  if(session.evidence?.schema===2||session.candidate?.schema===2){
    keys(input.authentication,['outcome','mode']);
    const manual=session.evidence?.events?.some(e=>e.role==='login-manual');
    learningAssert(input.authentication.outcome==='success'&&input.authentication.mode===(manual?'attended':'local-credentials'),'login-replay-incomplete');
  }else learningAssert(input.authentication===undefined,'unexpected-login-receipt');
  learningAssert(input.candidateHash===session.candidateHash && input.evidenceHash===session.evidenceHash && input.runtime===LEARNING_RUNTIME,'replay-binding-mismatch');
  learningPeriod(input.period);
  learningAssert(stable(input.period)===stable(session.replayPeriod) && stable(input.period)!==stable(session.demonstrationPeriod),'replay-needs-fresh-period');
  learningAssert(learningHash(input.statementHash) && Number.isSafeInteger(input.rows) && input.rows>0 && input.rows<=100000);
  learningAssert(input.balanceObserved===true && input.accountMatched===true && input.loggedOut===true && input.freshBrowser===true,'replay-incomplete');
  const start=Date.parse(input.startedAt),end=Date.parse(input.finishedAt);
  learningAssert(Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&end-start<30*60000,'invalid-replay-time');
  return input;
}
export const learningStatusText = state => ({awaiting_pc:'接続したPCで開始できます',recording:'PCで操作を記録中',queued:'開発の順番を待っています',developing:'OhMyCodeで取得手順を作成中',needs_demonstration:'追加の実演が必要です',candidate:'取得手順ができました。別の期間で確認してください',replaying:'PCで取得手順を確認中',verified:'確認済み。使用するか選べます',enabled:'この手順を選択済み',failed:'完了できませんでした',cancelled:'取り消しました'}[state] || state);

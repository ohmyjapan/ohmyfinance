// Portable, closed data contract. No bank text, selectors, URLs with paths, credentials or file bytes enter development evidence.
export const LEARNING_RUNTIME = 'omf-bank-learning-1';
export const LEARNING_MODEL = 'gpt-6.1-sol';
export const LEARNING_STATEMENT_CAPABILITY = 'bank-learning-statements-1';
export const LEARNING_ROLES = ['inquiry','account','from','to','export','balance','logout'];
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
  learningAssert(input.schema === 1 && input.runtime === LEARNING_RUNTIME && input.complete === true && input.truncated === false, 'incomplete-demonstration');
  learningAssert(Array.isArray(input.origins) && input.origins.length > 0 && input.origins.length <= 8);
  input.origins.forEach(v => learningOrigin(v,options));
  learningAssert(new Set(input.origins).size === input.origins.length);
  learningAssert(Array.isArray(input.events) && input.events.length > 0 && input.events.length <= 160);
  const ids = new Set();
  for (const e of input.events) {
    keys(e,['id','document','frame','popup','origin','role','tag','format'],['id','document','frame','popup','origin','role','tag']);
    learningAssert(/^e\d{1,3}$/.test(e.id) && !ids.has(e.id)); ids.add(e.id);
    learningAssert(/^d\d{1,3}$/.test(e.document) && /^f\d{1,3}$/.test(e.frame) && /^p\d{1,3}$/.test(e.popup));
    learningAssert(input.origins.includes(e.origin) && LEARNING_ROLES.includes(e.role) && ['button','a','input','select','text'].includes(e.tag));
    learningAssert(e.format === undefined || (['from','to'].includes(e.role) && ['iso','compact','slash'].includes(e.format)));
  }
  for (const role of LEARNING_ROLES.filter(v=>v!=='inquiry')) learningAssert(input.events.some(e=>e.role===role),'missing-'+role);
  return input;
}
export function validateRecipe(input, evidence, evidenceHash, options = {}) {
  validateEvidence(evidence,options);
  keys(input,['schema','runtime','evidenceHash','steps']);
  learningAssert(input.schema===1 && input.runtime===LEARNING_RUNTIME && learningHash(evidenceHash) && input.evidenceHash===evidenceHash,'candidate-binding-mismatch');
  learningAssert(Array.isArray(input.steps) && input.steps.length>0 && input.steps.length<=evidence.events.length);
  let index=-1;
  const counts={};
  for(const step of input.steps) {
    keys(step,['eventId','op']);
    const at=evidence.events.findIndex(e=>e.id===step.eventId),event=evidence.events[at];
    learningAssert(at>index && event && event.role===step.op,'undemonstrated-action'); index=at;
    counts[step.op]=(counts[step.op]||0)+1;
  }
  for(const role of LEARNING_ROLES.filter(v=>v!=='inquiry')) learningAssert(counts[role]===1,'candidate-missing-or-repeated-'+role);
  return input;
}
export function validateReplay(input, session) {
  keys(input,['candidateHash','evidenceHash','runtime','period','statementHash','rows','balanceObserved','accountMatched','loggedOut','freshBrowser','startedAt','finishedAt']);
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

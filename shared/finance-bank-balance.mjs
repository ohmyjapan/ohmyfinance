// Hourly background bank balances (plan omf-bank-hourly-balances-20261027): the portable rules shared by the server
// (server/services/financeBankBalanceService.ts), the collector (collector/bank-balance.mjs) and the screen
// (components/intake/BankConnections.vue). Portable browser/Node module: no database, no crypto and no clock beyond the `now` passed in.
// JST is UTC+9 with no daylight saving.
// GUARDS (independent review required): the providers a balance may be read for, the claim capability, the owner's setting, the hourly
// cadence (one automatic run per JST hour AND never sooner than 60 minutes after the account's last bank access), the exact yen and
// bank-time syntax of each bank, and the normalized balance-only receipt. A missing or unreadable field is an error, never zero.

const JST_MS = 9 * 3600000, MINUTE = 60000;
/** The claim capability a collector advertises in bank/claim ({capabilities:[...]}) to receive balance jobs. */
export const BALANCE_CAPABILITY = 'balance-v1';
/** The automatic cadence (owner 2026-10-27: hourly). */
export const BALANCE_INTERVAL_MINUTES = 60;
/** A bank time older than this (minutes) is shown as stale even when it was just fetched. */
export const BALANCE_STALE_MINUTES = 120;
/**
 * The bank fields of each balance login (parent SAFE-BANK-CONTRACT.json, read on the owner's pages 2026-10-26): the origin and path of
 * the page, the exact labels, the bank-time label and format and the yen syntax. Only these three logins have a balance reader.
 */
export const BALANCE_SOURCES = Object.freeze({
  rakuten: Object.freeze({ variant: 'standard', origin: 'https://fes.rakuten-bank.co.jp', paths: Object.freeze(['/XMS/inquiry/gns']), primary: '普通預金残高', available: '支払可能残高', timeLabel: '残高確認時間', timeFormat: 'YYYY/MM/DD HH:mm', yen: 'suffix' }),
  paypay: Object.freeze({ variant: 'standard', origin: 'https://login.paypay-bank.co.jp', paths: Object.freeze(['/wctx/NBCW2101.do']), primary: '普通預金残高', available: null, timeLabel: '現在', timeFormat: 'YYYY/MM/DD HH:mm:ss', yen: 'suffix' }),
  ikeda: Object.freeze({ variant: 'portal', origin: 'https://www.0161.houjinportal.anser.ne.jp', paths: Object.freeze(['/']), primary: '各口座残高', available: null, timeLabel: '最終取得日', timeFormat: 'YYYY-MM-DD HH:mm', yen: 'prefix' })
});
const IDENTITY_VARIANTS = { ikeda: 'portal' };
/** True only for 楽天銀行 標準, PayPay銀行 標準 and 池田泉州銀行 ビジネスゲート. */
export function bankBalanceSupported(provider, variant) { return !!BALANCE_SOURCES[provider] && BALANCE_SOURCES[provider].variant === variant; }
export function balanceSourceOf(provider, variant) { return bankBalanceSupported(provider, variant) ? BALANCE_SOURCES[provider] : null; }
/** What a claim body advertises; anything but an explicit list holding balance-v1 (an old collector sends {}) is no capability. */
export function claimCapabilities(body) {
  const list = body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body.capabilities) ? body.capabilities : [];
  return { balance: list.some(v => v === BALANCE_CAPABILITY) };
}

// ── yen ──
// suffix (楽天銀行・PayPay銀行): "1,234 円", "1,234円"; 楽天銀行 also shows a field in parentheses "(1,234円)" — positive. prefix
// (池田泉州銀行): "¥1,234" / "￥1,234". A bank-reported negative balance is kept with its sign when it is unambiguous: a leading "-"
// or "−" right before the digits (suffix) or before/after the yen sign (prefix). No negative format was observed on the live pages
// (the parent's samples were positive); △/▲ and "+" are not read (▲ is the prior-day arrow of 池田泉州銀行).
const NUM = '\\d{1,3}(?:,\\d{3})*', SIGN = '[-\\u2212]';
const SUFFIX = new RegExp(`(?<![\\d,.\\-\\u2212+△▲])(?:([(（])\\s*(${NUM})\\s*円\\s*([)）])|(${SIGN})?(${NUM})\\s*円)(?![\\d)）])`, 'g');
const PREFIX = new RegExp(`(?<![\\d,.\\-\\u2212+])(${SIGN})?[¥￥]\\s?(${SIGN})?(${NUM})(?![\\d,.])`, 'g');
const value = (digits, negative) => { const n = Number(digits.replace(/,/g, '')); return Number.isSafeInteger(n) ? (negative && n !== 0 ? -n : n) : null; };
/** Every exact-syntax amount in a longer text, in order: {index, end, value}. */
export function findYen(text, syntax) {
  const s = String(text ?? ''), out = [];
  if (syntax === 'suffix') for (const m of s.matchAll(SUFFIX)) { const v = m[2] ? value(m[2], false) : value(m[5], !!m[4]); if (v !== null) out.push({ index: m.index, end: m.index + m[0].length, value: v }); }
  else if (syntax === 'prefix') for (const m of s.matchAll(PREFIX)) { if (m[1] && m[2]) continue; const v = value(m[3], !!(m[1] || m[2])); if (v !== null) out.push({ index: m.index, end: m.index + m[0].length, value: v }); }
  return out;
}
/** The whole text is exactly one amount in the bank's syntax → the integer yen; anything else (no amount, two, other text) → null. */
export function parseYen(text, syntax) {
  const s = String(text ?? '').trim(), hits = findYen(s, syntax);
  return hits.length === 1 && hits[0].index === 0 && hits[0].end === s.length ? hits[0].value : null;
}

// ── bank time (JST) ──
const FORMATS = { 'YYYY/MM/DD HH:mm': /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/, 'YYYY/MM/DD HH:mm:ss': /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/, 'YYYY-MM-DD HH:mm': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/ };
/** The bank's displayed JST time in exactly `format` → ISO instant, or null (another format or no real calendar instant). */
export function parseBankTime(text, format) {
  const rx = FORMATS[format], m = rx ? rx.exec(String(text ?? '').trim()) : null; if (!m) return null;
  const [y, mo, d, h, mi, s = '00'] = m.slice(1).map(v => v ?? '00'), t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const back = new Date(t); if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) return null;
  return new Date(t - JST_MS).toISOString();
}

// ── slots and cadence ──
/** The start of the JST-aligned `minutes` slot holding `now`. */
export function balanceSlotStart(now, minutes = BALANCE_INTERVAL_MINUTES) { const span = minutes * MINUTE; return new Date(Math.floor((now.getTime() + JST_MS) / span) * span - JST_MS); }
/** The slot key 'YYYY-MM-DDTHH:MM' (JST) — the identity of one automatic run, never the statement schedule day. */
export function balanceSlotKey(now, minutes = BALANCE_INTERVAL_MINUTES) { return new Date(balanceSlotStart(now, minutes).getTime() + JST_MS).toISOString().slice(0, 16); }

// ── the owner's setting ──
const HEX = /^[a-f\d]{24}$/;
/** The save: enabled (boolean), collectorId (an owner PC, required when enabled; null to clear while off) and the read revision. */
export function balanceSettingInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('残高の確認の設定を確認してください。');
  if (typeof body.enabled !== 'boolean') throw Error('残高の1時間ごとの確認のオン・オフを確認してください。');
  if (!(body.collectorId === null || body.collectorId === undefined || (typeof body.collectorId === 'string' && HEX.test(body.collectorId)))) throw Error('残高を確認するPCを確認してください。');
  if (body.enabled && !body.collectorId) throw Error('残高を確認するPCを選んでください。');
  if (body.intervalMinutes !== undefined && body.intervalMinutes !== BALANCE_INTERVAL_MINUTES) throw Error('残高の確認は1時間ごとです。');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw Error('残高の確認の設定を再読み込みしてください。');
  return { enabled: body.enabled, collectorId: body.collectorId || null, revision: body.revision };
}
/** A stored setting read tolerantly: anything malformed is off (never on, never a crash); a numeric revision and a valid PC are kept. */
export function storedBalanceSetting(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const revision = Number.isSafeInteger(v?.revision) && v.revision > 0 ? v.revision : 0, collectorId = v && HEX.test(String(v.collectorId ?? '')) ? String(v.collectorId) : null;
  const enabled = !!v && v.enabled === true && revision > 0 && !!collectorId && !!v.binding && typeof v.binding.provider === 'string';
  return { enabled, collectorId, revision, savedAt: v?.savedAt ?? null, binding: enabled ? v.binding : null, intervalMinutes: BALANCE_INTERVAL_MINUTES };
}
/** The authority a balance setting or job was made for: provider, login variant and — 池田泉州銀行 — the full account identity. */
export function balanceBinding(connection) {
  const binding = { provider: String(connection?.provider ?? ''), variant: connection?.variant == null ? null : String(connection.variant) };
  if (IDENTITY_VARIANTS[binding.provider] !== binding.variant) return binding;
  const a = connection?.accountIdentity && typeof connection.accountIdentity === 'object' ? connection.accountIdentity : null;
  return { ...binding, accountIdentity: a ? [a.branch, a.type, a.number].map(x => String(x ?? '')).join('|') : null };
}
export function sameBalanceBinding(a, b) { return !!a && !!b && typeof a.provider === 'string' && a.provider === b.provider && (a.variant ?? null) === (b.variant ?? null) && (a.accountIdentity ?? null) === (b.accountIdentity ?? null); }
/** Which connections may read a balance; null = supported. */
export function balanceSupport(connection) {
  if (!connection?.provider) return 'no-connection';
  if (!bankBalanceSupported(connection.provider, connection.variant ?? null)) return 'unsupported';
  if (IDENTITY_VARIANTS[connection.provider] === connection.variant && !(connection.accountIdentity && typeof connection.accountIdentity === 'object' && /^\d{7}$/.test(String(connection.accountIdentity.number ?? '')))) return 'no-identity';
  return null;
}

// ── the receipt ──
const coded = (code, message) => Object.assign(new Error(message), { code });
const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const AMOUNT_MAX = 1e13, SKEW_MS = 5 * MINUTE;
const KEYS = ['amount', 'asOf', 'available', 'currency', 'jobId', 'observedAt', 'provider', 'snapshotHash', 'source', 'v', 'variant'];
/**
 * GUARD — the normalized balance-only receipt of one balance job: exactly the whitelisted keys; bound to the job, its snapshot hash,
 * provider and login variant; JPY; the bank amount (a safe integer, the sign the bank showed) and, only with its label, the available
 * amount; the bank's time (asOf) not after the collector's observation, and that observation not after `now` (both with 5 minutes of
 * clock skew); the page's exact origin, a path without query or fragment and exactly the provider's labels used. Throws a coded error.
 */
export function balanceReceiptInput(body, { jobId, snapshotHash, provider, variant, now = new Date() } = {}) {
  const bad = message => coded('balance-invalid', message);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('残高の受信内容を確認できません。');
  if (Object.keys(body).sort().join() !== KEYS.join()) throw bad('残高の受信内容の項目が確認済みの形と異なります。');
  if (body.v !== 1 || body.jobId !== jobId || body.snapshotHash !== snapshotHash) throw bad('残高の受信内容が残高の確認と一致しません。');
  if (body.provider !== provider || body.variant !== variant || !bankBalanceSupported(provider, variant)) throw bad('残高の受信内容の銀行が残高の確認と一致しません。');
  const src = BALANCE_SOURCES[provider];
  if (body.currency !== 'JPY') throw bad('残高の通貨を確認できません（円のみ）。');
  const amountOk = v => Number.isSafeInteger(v) && Math.abs(v) <= AMOUNT_MAX;
  if (!amountOk(body.amount)) throw bad('銀行残高を確認できません。');
  if (body.available !== null && (!src.available || !amountOk(body.available))) throw bad('支払可能残高を確認できません。');
  const asOf = iso(body.asOf), observedAt = iso(body.observedAt);
  if (!asOf || !observedAt) throw bad('銀行の残高の時刻を確認できません。');
  if (Date.parse(asOf) > Date.parse(observedAt) + SKEW_MS || Date.parse(observedAt) > now.getTime() + SKEW_MS) throw bad('銀行の残高の時刻が受信時刻より後です。');
  const s = body.source;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join() !== 'labels,origin,path') throw bad('残高の読み取り元を確認できません。');
  if (s.origin !== src.origin || typeof s.path !== 'string' || /[?#]/.test(s.path) || !src.paths.includes(s.path)) throw bad('残高の読み取り元が銀行の画面と一致しません。');
  const labels = [src.primary, ...(body.available !== null ? [src.available] : [])];
  if (!Array.isArray(s.labels) || s.labels.length !== labels.length || s.labels.some((l, i) => l !== labels[i])) throw bad('残高の項目名が銀行の画面と一致しません。');
  return { v: 1, jobId, snapshotHash, provider, variant, currency: 'JPY', amount: body.amount, available: body.available, asOf, observedAt, source: { origin: s.origin, path: s.path, labels } };
}
/** The bank's own time already lagged the observation by more than one interval (a stale bank-side value). */
export function balanceLagStale(receipt, minutes = BALANCE_INTERVAL_MINUTES) { return Date.parse(receipt?.observedAt) - Date.parse(receipt?.asOf) > minutes * MINUTE; }
/** 'fresh' while the bank time is within BALANCE_STALE_MINUTES of `now`; else (or unreadable) 'stale'. */
export function balanceFreshness({ asOf, now, minutes = BALANCE_STALE_MINUTES }) { const t = asOf ? new Date(asOf).getTime() : NaN; return Number.isFinite(t) && now.getTime() - t <= minutes * MINUTE ? 'fresh' : 'stale'; }

// ── the state ──
const ACTIVE = ['queued', 'running', 'verification_required'];
const time = v => v ? new Date(v).getTime() : NaN;
const jobOf = j => ({ jobId: j.jobId, state: j.state, trigger: j.balance?.trigger === 'hourly' ? 'hourly' : 'manual', requestedAt: j.requestedAt ?? null, completedAt: j.completedAt ?? null, lastMessage: j.lastMessage || '' });
/** The account's last bank access: the latest claim (or request) of a balance job that was not superseded; NaN when none. */
export function balanceLastAccess(jobs) {
  let last = NaN;
  for (const j of jobs || []) { if (!j || j.kind !== 'balance' || j.state === 'superseded') continue; const t = Math.max(time(j.requestedAt) || -Infinity, time(j.balance?.claimedAt) || -Infinity); if (Number.isFinite(t) && !(t <= last)) last = t; }
  return last;
}
/**
 * The balance state of one account at `now`, in this order: unsupported(reason) · attention (verification_required on a live lease) ·
 * running · interrupted (lease expired: the same PC resumes the SAME job, nothing new is queued) · queued · off · reconfirm (the
 * connection changed since the save) · waiting-pc (no selected PC, revoked, or not granted this account) · upgrade (the selected PC
 * claimed without balance-v1) · busy (a statement job of the account is open: statements first) · done (an automatic run is not due:
 * the account's last bank access is in this JST hour, or less than 60 minutes ago; nextAt is the later of the next hour and 60 minutes
 * after that access) · due. A manual refresh is the owner's action and is not held by this state. `jobs` must hold every active job of
 * the account (any kind) and its latest balance jobs; `collector` is {granted, capable: true|false|null} of the selected PC or null.
 */
export function balanceState({ setting, connection, collector = null, jobs = [], now, minutes = BALANCE_INTERVAL_MINUTES }) {
  const s = storedBalanceSetting(setting), at = now.getTime(), slotStart = balanceSlotStart(now, minutes).getTime();
  const live = (jobs || []).filter(j => j && j.state !== 'superseded'), balances = live.filter(j => j.kind === 'balance').sort((a, b) => time(b.requestedAt) - time(a.requestedAt));
  const lastFailure = balances[0]?.state === 'failed' ? jobOf(balances[0]) : null;
  const out = (state, extra = {}) => ({ state, reason: null, slot: balanceSlotKey(now, minutes), nextAt: null, job: null, lastFailure, ...extra });
  const support = balanceSupport(connection); if (support) return out('unsupported', { reason: support });
  // an explicitly closed balance job (open:false) stays history, failure and cadence evidence but is never active work
  const active = balances.filter(j => ACTIVE.includes(j.state) && j.open !== false), leased = j => time(j.leaseUntil) > at; // guard:balance-closed-not-derived-active
  let j = active.find(x => x.state === 'verification_required' && leased(x)); if (j) return out('attention', { job: jobOf(j) });
  if ((j = active.find(x => x.state === 'running' && leased(x)))) return out('running', { job: jobOf(j) });
  if ((j = active.find(x => x.state !== 'queued'))) return out('interrupted', { job: jobOf(j) });
  if ((j = active.find(x => x.state === 'queued'))) return out('queued', { job: jobOf(j) });
  if (!s.enabled) return out('off');
  if (!sameBalanceBinding(s.binding, balanceBinding(connection))) return out('reconfirm', { reason: 'connection-changed' });
  if (!collector || !collector.granted) return out('waiting-pc');
  if (collector.capable === false) return out('upgrade');
  if (live.some(x => x.kind !== 'balance' && ACTIVE.includes(x.state))) return out('busy');
  const last = balanceLastAccess(balances), cooled = Number.isFinite(last) ? last + minutes * MINUTE : -Infinity;
  if (Number.isFinite(last) && (last >= slotStart || at < cooled)) return out('done', { nextAt: new Date(last >= slotStart ? Math.max(slotStart + minutes * MINUTE, cooled) : cooled).toISOString() }); // guard:balance-cadence
  return out('due', { nextAt: now.toISOString() });
}

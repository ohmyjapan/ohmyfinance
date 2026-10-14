// shared/billing-mail.mjs — the issuer billing notices OMF reads (plan omf-calendar-gmail-build-20261015 §2 S8).
// Pure and browser-safe (the connections page imports billingMailSchedule): no node built-ins, no googleapis, no network,
// no clock of its own. The collector runs parseBillingMail on a mail's headers and text and ships only the parsed claims
// plus the body hash (never the body); the server validates the same claims again and derives the cycle key itself.
// Recorded shapes (output/omf-calendar-automation-20261014/gmail-evidence/billing-mail-claims.json, rebuilt synthetically
// in the fixture): the Aplus 「最新ご請求明細確定のご案内」 carries 「<year>年<m>月<d>日お支払分のご請求金額が確定」 and exactly one
// 「<m>月<d>日のご請求金額は、<amount>円です」 for that day; its 「回収費用として550円」 paragraph is never the amount. The Amex
// 「ご請求金額確定のご案内」 names only the card suffix (下4桁/下5桁); it claims no amount and no date.

export const BILLING_MAIL_PARSER = 'billing-mail-1';

// The date and cycle-key rules of shared/amex.mjs dateOnly and shared/aplus.mjs aplusPeriod, repeated here without their
// node:crypto import: a real calendar day as YYYY-MM-DD, and 'statement:<first day>:<last day>' of the statement month.
function dateOnly(value) {
  const match = String(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) throw new Error('日付の形式が正しくありません');
  const [, y, m, d] = match;
  const result = y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
  const date = new Date(result + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new Error('存在しない日付です');
  return result;
}
export function statementPeriodKey(statementMonth) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(statementMonth || ''))) throw new Error('Aplusの確定した請求月を指定してください');
  const start = statementMonth + '-01';
  const end = new Date(Date.UTC(Number(statementMonth.slice(0, 4)), Number(statementMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return 'statement:' + start + ':' + end;
}
export const APLUS_NOTICE_SENDER = 'luxurycard@aplus.co.jp';
export const AMEX_NOTICE_SENDER = 'AmericanExpress@welcome.americanexpress.com';
export const APLUS_CONFIRMATION_SUBJECT = '最新ご請求明細確定のご案内';
export const AMEX_CONFIRMATION_SUBJECT = 'ご請求金額確定のご案内';
export const BILLING_MAIL_LOOKBACK_MS = 45 * 86400000;

/** The Gmail search for billing notices since `sinceMs`: the two senders, the two confirmation subjects, the lookback. */
export function billingMailQuery(sinceMs) {
  const after = Math.max(0, Math.floor(Number(sinceMs) / 1000)) || 0;
  return '{from:' + APLUS_NOTICE_SENDER + ' from:' + AMEX_NOTICE_SENDER + '} {subject:"' + APLUS_CONFIRMATION_SUBJECT + '" subject:"' + AMEX_CONFIRMATION_SUBJECT + '"} after:' + after;
}

const lowerKeys = headers => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
const result = (text, name) => { const m = new RegExp('(?:^|[;\\s])' + name + '=([a-z]+)', 'i').exec(String(text || '')); return m ? m[1].toLowerCase() : 'none'; };

/** DKIM and DMARC verdicts from the receiving server's Authentication-Results header ('none' when absent). */
export function authenticationResults(headers) {
  const value = lowerKeys(headers)['authentication-results'];
  return { dkim: result(value, 'dkim'), dmarc: result(value, 'dmarc') };
}

const senderIs = (from, address) => new RegExp('(?:^|<)' + address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '>?$', 'i').test(String(from || '').trim());
const APLUS_DUE = /(20\d{2})年(\d{1,2})月(\d{1,2})日お支払分のご請求金額が確定/;
const APLUS_AMOUNT = /(\d{1,2})月(\d{1,2})日のご請求金額は、([\d,]+)円です/g;
const AMEX_CARD = /カード番号（下([45])桁）[:：]\s*(\d{4,5})(?!\d)/;

/**
 * One mail → its billing claim, or null for everything that is not a confirmation (reminders, 方法変更, marketing, other
 * senders, a body without the two anchor lines). `headers` keys are case-insensitive; `text` is the plain body.
 * `now` is accepted for callers that stamp the read; the parse itself depends on nothing but the mail.
 */
export function parseBillingMail(headers, text, { now = Date.now() } = {}) {
  void now;
  const h = lowerKeys(headers);
  const subject = String(h.subject || '').trim(), body = String(text || '').replace(/\r/g, '');
  if (senderIs(h.from, APLUS_NOTICE_SENDER)) {
    if (subject !== APLUS_CONFIRMATION_SUBJECT) return null;
    const due = APLUS_DUE.exec(body);
    if (!due) return null;
    let dueDate;
    try { dueDate = dateOnly(due[1] + '-' + due[2] + '-' + due[3]); } catch { return null; }
    const amounts = [...body.matchAll(APLUS_AMOUNT)].filter(m => Number(m[1]) === Number(due[2]) && Number(m[2]) === Number(due[3]));
    if (amounts.length !== 1) return null;
    const amount = Number(amounts[0][3].replace(/,/g, ''));
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12) return null;
    const statementMonth = dueDate.slice(0, 7);
    return { issuer: 'aplus', kind: 'bill-confirmed', claims: { statementMonth, dueDate, amount, currency: 'JPY' }, periodKey: statementPeriodKey(statementMonth) };
  }
  if (senderIs(h.from, AMEX_NOTICE_SENDER)) {
    if (!subject.endsWith(AMEX_CONFIRMATION_SUBJECT)) return null;
    const card = AMEX_CARD.exec(body);
    if (!card || card[2].length !== Number(card[1])) return null;
    return { issuer: 'amex', kind: 'bill-ready', claims: { cardSuffix: card[2] } };
  }
  return null;
}

/**
 * The effective schedule of billing-mail reads for one account (B5): the mail is read only inside the Aplus collector job,
 * so it runs daily only when 自動取得 is on and a connected PC can claim the job. Never reports "daily" otherwise.
 */
export function billingMailSchedule(account, collectors = []) {
  if (!account?.billingMail?.enabled) return { state: 'off' };
  const id = String(account._id);
  const paired = (collectors || []).some(c => !c.revokedAt && (c.accountIds || []).map(String).includes(id));
  if (!account.autoSync?.enabled) return { state: 'manual-only', paired };
  if (!paired) return { state: 'no-collector', hour: account.autoSync.hour };
  return { state: 'daily', hour: account.autoSync.hour };
}

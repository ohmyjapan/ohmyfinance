// collector/aplus-verification.mjs — the My APLUS statement-download code (plan omf-aplus-automation-20261013 §2).
// My APLUS sends a four-digit SMS code from 0570008789 for 「ご利用明細書ダウンロード」, valid for five minutes, one per CSV
// request. This module decides only whether a set of messages holds exactly one usable code for the current request; it
// reads no device. A `codeSource` (none ships here — without one the person types the code in Chrome) implements
//   { messages({ requestedAt }) → Promise<[{ id, sender, body, receivedAt }]>, claim(id) → Promise<void> }
// and collector/aplus.mjs consults it once per download request, never for a resend. Issey's six-digit payment-OTP
// matcher is deliberately not reused: payment codes differ in sender text, length and purpose from this account code.
export const STATEMENT_CODE_SENDER = '0570008789';
export const STATEMENT_CODE_PURPOSE = 'ご利用明細書ダウンロード';
export const STATEMENT_CODE_VALIDITY_MS = 300000;
const time = value => (typeof value === 'number' ? value : Date.parse(value));

/** Exactly one unclaimed message from the statement sender, about this purpose, received after the request and within
 *  the code's validity, holding exactly one four-digit number → { id, code }; anything else → null (the person types it). */
export function matchStatementCode(messages, { requestedAt, now = Date.now(), claimed = [] } = {}) {
  const since = time(requestedAt), at = time(now);
  if (!Array.isArray(messages) || !Number.isFinite(since) || !Number.isFinite(at)) return null;
  const candidates = [];
  for (const message of messages) {
    if (!message || typeof message.id !== 'string' || !message.id || claimed.includes(message.id)) continue;
    if (String(message.sender ?? '').replace(/\D/g, '') !== STATEMENT_CODE_SENDER) continue;
    const body = String(message.body ?? '');
    if (!body.includes(STATEMENT_CODE_PURPOSE)) continue;
    const received = time(message.receivedAt);
    if (!Number.isFinite(received) || received < since || at - received > STATEMENT_CODE_VALIDITY_MS) continue;
    const codes = [...body.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(match => match[1]);
    if (codes.length !== 1) continue;
    candidates.push({ id: message.id, code: codes[0] });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

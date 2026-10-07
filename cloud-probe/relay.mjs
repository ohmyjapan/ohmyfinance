// cloud-probe/relay.mjs — the line protocol between the container runner (cloud-probe/run.mjs) and the Ryzen 7
// driver (cloud-probe/local/drive.mjs); plan omf-railway-amex-probe-20261007 S3. Requests travel container -> driver
// on the container's stdout, answers driver -> container on its stdin. The Gmail client, its token and the
// used-login-messages.json file stay on Ryzen 7: the container-side stubs keep ensureLogin's exact mailbox/claims
// contract (collector/login.mjs:95,103,109; collector/mail.mjs:33,37,25) and never hold a Gmail credential.
//   mailbox.verify()                <-> mailbox_verify / mailbox_verified { ok }        (not ok -> the stub throws)
//   mailbox.find(account, since, used) <-> code_find { since, used } / code_found { match: { id, code } | null }
//   claims.read()                   <-> claims_read / claims { ids }
//   claims.claim(id)                <-> claim { id } / claimed | claim_failed          (claim_failed -> the stub throws)
import { createInterface } from 'node:readline';

export const REDACTED = '[REDACTED]';
export const STATUS_SIGN_IN = 'Signing in to Amex';
export const STATUS_REQUEST_CODE = 'Requesting the Amex account-login email';
export const RELAY_REQUESTS = ['mailbox_verify', 'code_find', 'claims_read', 'claim'];

const attributeEscape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The string step (S2 capture rule 2): every secret, longest first, in raw, percent-encoded and HTML-attribute-escaped
// form becomes [REDACTED]. A pure function over the serialised strings; every string in a result line passes it.
export function scrub(value, secrets) {
  let text = value == null ? '' : String(value);
  const list = [...new Set((secrets || []).filter(secret => typeof secret === 'string' && secret.length > 0))].sort((a, b) => b.length - a.length);
  for (const secret of list) for (const form of new Set([secret, encodeURIComponent(secret), attributeEscape(secret)])) text = text.split(form).join(REDACTED);
  return text;
}

export function fault(message, reasonCode) { return Object.assign(new Error(message), { reasonCode }); }

function parseObject(line) {
  let value;
  try { value = JSON.parse(line); } catch { throw fault('The stdin line is not JSON', 'malformed_stdin'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('The stdin line is not a JSON object', 'malformed_stdin');
  return value;
}

export function newTally() { return { signIn: 0, requestCode: 0, verify: null, finds: 0, found: false, claims: 0 }; }
export function noteStatus(tally, status) {
  if (status?.text === STATUS_SIGN_IN) tally.signIn += 1;
  if (status?.text === STATUS_REQUEST_CODE) tally.requestCode += 1;
}

// Container side: one line reader over stdin; each request writes a line and waits for the next answer line.
export class ContainerRelay {
  constructor(input, output) {
    this.output = output;
    this.queue = [];
    this.waiting = [];
    this.closed = false;
    this.reader = createInterface({ input, crlfDelay: Infinity, terminal: false });
    this.reader.on('line', line => {
      if (!line.trim()) return;
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve(line); else this.queue.push(line);
    });
    this.reader.on('close', () => {
      this.closed = true;
      for (const waiter of this.waiting.splice(0)) waiter.reject(fault('The probe session ended before an answer arrived', 'session_closed'));
    });
  }
  nextLine() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.reject(fault('The probe session ended before an answer arrived', 'session_closed'));
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  async first() { return parseObject(await this.nextLine()); }
  async request(message, expected) {
    this.output.write(JSON.stringify(message) + '\n');
    const answer = parseObject(await this.nextLine());
    if (!expected.includes(answer.event)) throw fault('Unexpected relay answer', 'malformed_stdin');
    return answer;
  }
  /** @param {{ onCode?: (code: string) => void }} [options] every code handed to ensureLogin is also reported here (a capture secret) */
  mailbox({ onCode } = {}) {
    return {
      verify: async () => {
        const answer = await this.request({ event: 'mailbox_verify' }, ['mailbox_verified']);
        if (!answer.ok) throw new Error('Gmail connection could not be verified');
      },
      find: async (account, since, used) => {
        const answer = await this.request({ event: 'code_find', since, used: Array.isArray(used) ? used : [] }, ['code_found']);
        if (answer.failed) throw new Error('The account-login mailbox could not be read');
        if (!answer.match || typeof answer.match !== 'object') return null;
        const match = { id: String(answer.match.id), code: String(answer.match.code) };
        if (onCode) onCode(match.code);
        return match;
      }
    };
  }
  claims() {
    return {
      read: async () => {
        const answer = await this.request({ event: 'claims_read' }, ['claims']);
        if (answer.failed) throw new Error('Consumed login-message record could not be read');
        return Array.isArray(answer.ids) ? answer.ids : [];
      },
      claim: async id => { const answer = await this.request({ event: 'claim', id }, ['claimed', 'claim_failed']); if (answer.event === 'claim_failed') throw new Error('This login message was already used'); }
    };
  }
  close() { this.reader.close(); }
}

// Driver side: the real LoginMailbox / LoginClaims answer. The tally counts; no code or password is kept here.
export async function answerFor(message, { mailbox, claims, account, tally, onCode }) {
  switch (message?.event) {
    case 'mailbox_verify': {
      let ok = true;
      try { if (!mailbox) throw new Error('No mailbox'); await mailbox.verify(); } catch { ok = false; }
      tally.verify = ok ? 'ok' : 'failed';
      return { event: 'mailbox_verified', ok };
    }
    case 'code_find': {
      tally.finds += 1;
      let match;
      try { if (!mailbox) throw new Error('No mailbox'); match = await mailbox.find(account, Number(message.since), Array.isArray(message.used) ? message.used : []); }
      catch { return { event: 'code_found', match: null, failed: true }; }
      if (!match) return { event: 'code_found', match: null };
      tally.found = true;
      if (onCode) onCode(match.code);
      return { event: 'code_found', match: { id: match.id, code: match.code } };
    }
    case 'claims_read': {
      try { return { event: 'claims', ids: await claims.read() }; } catch { return { event: 'claims', ids: [], failed: true }; }
    }
    case 'claim': {
      tally.claims += 1;
      try { await claims.claim(message.id); return { event: 'claimed' }; } catch { return { event: 'claim_failed' }; }
    }
    default: return null;
  }
}

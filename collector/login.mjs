import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { click, fill, onSurface, pause, poll } from './interaction.mjs';

export const LOGIN = 'https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog';
const WWW = 'https://www.americanexpress.com', GLOBAL = 'https://global.americanexpress.com';
const LOGIN_PATH = '/ja-jp/account/login', VERIFY_PATH = '/ja-jp/account/reauth/verify';

export function matchesRecipient(masked, recipient) {
  const [local, domain, extra] = String(masked).trim().toLowerCase().split('@');
  const [expected, expectedDomain] = String(recipient).trim().toLowerCase().split('@');
  if (!local || extra || !domain || domain !== expectedDomain || !expected || !/[a-z0-9]/.test(local)) return false;
  const expression = '^' + [...local].map(c => c === '*' ? '.*' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$';
  return new RegExp(expression).test(expected);
}

export class LoginClaims {
  constructor(directory) { this.file = path.join(directory, 'used-login-messages.json'); }
  async read() {
    try {
      const ids = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid consumed login-message record');
      return ids;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async claim(id) {
    const used = await this.read();
    if (!id || used.includes(id)) throw new Error('This login message was already used');
    // Single collector process, serial account jobs. Persist before typing; never store codes.
    await writeFile(this.file + '.new', JSON.stringify([...used, id].slice(-200)), { mode: 0o600 });
    await rename(this.file + '.new', this.file);
  }
}

export function loginUi(page) {
  return {
    async state() {
      if (onSurface(page, GLOBAL)) {
        if (await page.evaluate(() => !!document.querySelector('a[href*="/activity/statement"]'))) return { kind: 'authenticated' };
      } else if (onSurface(page, WWW, LOGIN_PATH)) {
        if (await page.evaluate(() => !!document.querySelector('#eliloUserID') && !!document.querySelector('#eliloPassword') && !!document.querySelector('#loginSubmit'))) return { kind: 'login' };
      } else if (onSurface(page, WWW, VERIFY_PATH)) {
        return page.evaluate(() => {
          const visible = e => e.getBoundingClientRect().height > 0;
          const channels = [...document.querySelectorAll('label')].filter(e => visible(e) && document.getElementById(e.htmlFor)?.type === 'radio').map(e => ({ id: e.htmlFor, text: e.textContent.trim(), checked: document.getElementById(e.htmlFor).checked }));
          if (channels.length) return { kind: 'channels', channels };
          const input = document.querySelector('#question-input');
          if (input && visible(input) && !input.disabled && !input.readOnly && input.autocomplete === 'one-time-code' && document.querySelector('label[for="question-input"]')?.textContent.trim() === '認証コード') {
            return { kind: 'code', recipients: document.body.innerText.match(/[a-zA-Z0-9.*_+-]+@[a-zA-Z0-9.-]+/g) || [] };
          }
          return { kind: 'unknown' };
        });
      }
      return { kind: 'unknown' };
    },
    async open() {
      const url = new URL(page.url());
      if (![WWW, GLOBAL].includes(url.origin) || url.pathname === LOGIN_PATH) await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    },
    async login(credentials) {
      await fill(page, '#eliloUserID', credentials.username, WWW, LOGIN_PATH);
      await fill(page, '#eliloPassword', credentials.password, WWW, LOGIN_PATH);
      await click(page, '#loginSubmit', null, WWW, LOGIN_PATH);
    },
    async choose(channel) { await click(page, 'label[for=' + JSON.stringify(channel.id) + ']', null, WWW, VERIFY_PATH); },
    async next() { await click(page, 'button', '次へ', WWW, VERIFY_PATH); },
    async code(value) { await fill(page, '#question-input', value, WWW, VERIFY_PATH); },
    async show() { await page.bringToFront(); }
  };
}

export async function ensureLogin(page, credentials, status, { account, mailbox, claims, timeoutMs = 300000, ui = loginUi(page), wait = pause, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  let submittedLogin = false, requestedAt = null, submittedCode = false, selected = false, manual = false, notified = false;
  const attention = async () => {
    manual = true;
    if (!notified) { await status('verification_required', 'Complete the Amex login or email verification in Chrome'); await ui.show(); notified = true; }
  };
  await ui.open();
  while (now() < deadline) {
    const state = await poll(() => ui.state(), 5000);
    if (state?.kind === 'authenticated') return;
    if (!manual) {
      if (state?.kind === 'login' && !submittedLogin) {
        if (!credentials?.username || !credentials?.password) await attention();
        else { submittedLogin = true; await status('running', 'Signing in to Amex'); await ui.login(credentials); }
      } else if (state?.kind === 'channels' && !requestedAt) {
        // A pre-existing challenge has no trustworthy request timestamp. Leave it to the user.
        if (!submittedLogin || !mailbox || !claims || !account?.otpRecipient || !account?.otpMailbox) await attention();
        else {
          const matches = state.channels.filter(channel => matchesRecipient(channel.text, account.otpRecipient));
          if (matches.length !== 1) await attention();
          else if (!selected) { await ui.choose(matches[0]); selected = true; }
          else if (matches[0].checked && state.channels.filter(channel => channel.checked).length === 1) {
            try { await mailbox.verify(); } catch { await attention(); }
            if (!manual) { await status('running', 'Requesting the Amex account-login email'); requestedAt = now(); await ui.next(); }
          } else await attention();
        }
      } else if (state?.kind === 'code' && !submittedCode) {
        if (!requestedAt || !state.recipients.some(recipient => matchesRecipient(recipient, account.otpRecipient))) await attention();
        else {
          let match;
          try { match = await mailbox.find(account, requestedAt, await claims.read()); } catch { await attention(); }
          if (match && !manual && now() - requestedAt <= 150000) {
            // Re-read the challenge after the mailbox request before consuming or typing anything.
            const current = await ui.state();
            if (current.kind === 'authenticated') return;
            if (current.kind !== 'code' || !current.recipients.some(recipient => matchesRecipient(recipient, account.otpRecipient))) await attention();
            else { await claims.claim(match.id); submittedCode = true; await ui.code(match.code); await ui.next(); }
          } else if (now() - requestedAt > 150000) await attention();
        }
      }
      // No resends, repeated password submissions or guessing at unfamiliar challenges.
      if (now() > deadline - Math.min(240000, timeoutMs / 2) && !requestedAt && !manual) await attention();
      if (requestedAt && now() - requestedAt > 160000 && !manual) await attention();
    }
    await wait(1500);
  }
  await attention();
  throw new Error('Amex login needs attention in Chrome; retry when verification is complete');
}

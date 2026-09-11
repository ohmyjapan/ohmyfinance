import { pause } from './interaction.mjs';

export const YAYOI_HOME = 'https://kaikei.yayoi-kk.co.jp/Home';
const LOGIN_ORIGIN = 'https://myaccount.yayoi-kk.co.jp';
const PAGE_ORIGINS = new Set([LOGIN_ORIGIN, 'https://kaikei.yayoi-kk.co.jp', 'https://myportal.yayoi-kk.co.jp', 'https://smart.yayoi-kk.co.jp', 'https://kouza.yayoi-kk.co.jp']);

export function yayoiCredentials(body) {
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') throw new Error('Enter your Yayoi ID and password');
  const username = body.username.trim();
  if (username.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || !body.password.length || body.password.length > 256) throw new Error('Enter a valid Yayoi email address and password');
  return { username, password: body.password };
}

export function isYayoiPage(value) {
  try { const u = new URL(value); return !u.username && !u.password && PAGE_ORIGINS.has(u.origin); } catch { return false; }
}

// Runs inside the page. Credentials are only passed for the two explicit actions;
// the origin, form destination and controls are rechecked atomically before filling.
export function yayoiSurface(action = 'state', credentials) {
  const visible = e => !!e && !e.disabled && !e.readOnly && e.getBoundingClientRect().height > 0;
  const origin = 'https://myaccount.yayoi-kk.co.jp';
  if (['https://kaikei.yayoi-kk.co.jp', 'https://smart.yayoi-kk.co.jp'].includes(location.origin) && document.querySelector('#logout-link-button')) {
    if (action !== 'state') throw new Error('Yayoi login page changed');
    const email = credentials?.username?.toLowerCase();
    const addresses = (document.body.innerText.split('ログアウト', 1)[0].match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(v => v.toLowerCase());
    return { kind: email && addresses.includes(email) ? 'authenticated' : 'account_check' };
  }
  if (action === 'state' && location.origin === 'https://myportal.yayoi-kk.co.jp' && document.querySelector('#js-headermenu')) return { kind: 'portal' };
  if (location.origin !== origin || location.pathname !== '/login') {
    if (action !== 'state') throw new Error('Yayoi login page changed');
    return { kind: 'manual' };
  }
  const form = document.querySelector('#login_form'), id = document.querySelector('#yayoi_id_input'), password = document.querySelector('#password_input');
  const next = document.querySelector('#next_btn'), submit = document.querySelector('#login_btn');
  const destination = form ? new URL(form.action, location.href) : null;
  if (!form || form.method.toLowerCase() !== 'post' || destination.origin !== origin || destination.pathname !== '/login' || destination.username || destination.password || !id || !password || !form.contains(id) || !form.contains(password) || password.type !== 'password') {
    if (action !== 'state') throw new Error('Yayoi login form changed');
    return { kind: 'manual' };
  }
  const returnTo = new URL(location.href).searchParams.get('success');
  if (returnTo) {
    let allowed = false;
    try { const u = new URL(returnTo); allowed = ['https://myportal.yayoi-kk.co.jp', 'https://kaikei.yayoi-kk.co.jp', 'https://smart.yayoi-kk.co.jp', 'https://kouza.yayoi-kk.co.jp'].includes(u.origin) && !u.username && !u.password; } catch {}
    if (!allowed) { if (action !== 'state') throw new Error('Yayoi return address changed'); return { kind: 'manual' }; }
  }
  const kind = visible(password) && visible(submit) && form.contains(submit) && submit.textContent.trim().startsWith('ログイン')
    ? (id.value.trim().toLowerCase() === credentials?.username?.toLowerCase() ? 'password' : 'account_check')
    : visible(id) && visible(next) && next.textContent.trim().startsWith('次へ') ? 'email' : 'manual';
  if (action === 'state') return { kind };
  const field = action === 'email' && kind === 'email' ? id : action === 'password' && kind === 'password' ? password : null;
  if (!field) throw new Error('Yayoi login step changed');
  const button = action === 'email' ? next : submit;
  if (button.formAction && button.hasAttribute('formaction') && button.formAction !== form.action) throw new Error('Yayoi submit destination changed');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(field, action === 'email' ? credentials.username : credentials.password);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  button.click();
  return { submitted: action };
}

export function yayoiUi(page) {
  return {
    async open() {
      const url = new URL(page.url());
      if (url.origin === LOGIN_ORIGIN && ['/login', '/external/authz'].includes(url.pathname)) return;
      await page.goto(YAYOI_HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });
    },
    async accounting() { await page.goto(YAYOI_HOME, { waitUntil: 'domcontentloaded', timeout: 45000 }); },
    async state(username) { return page.evaluate(yayoiSurface, 'state', { username }); },
    async email(credentials) { await page.evaluate(yayoiSurface, 'email', { username: credentials.username }); },
    async password(credentials) { await page.evaluate(yayoiSurface, 'password', credentials); },
    async show() { await page.bringToFront(); }
  };
}

export async function ensureYayoiLogin(page, credentials, status, { ui = yayoiUi(page), wait = pause, now = Date.now, timeoutMs = 45000 } = {}) {
  let emailSubmitted = false, passwordSubmitted = false, portalOpened = false;
  const deadline = now() + timeoutMs;
  await ui.open(); await ui.show();
  while (now() < deadline) {
    let state;
    try { state = await ui.state(credentials.username); }
    catch (error) { if (!/Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error; await wait(500); continue; }
    if (state.kind === 'authenticated') { await status('ready', 'Yayoi is signed in and ready for inspection.'); return; }
    if (state.kind === 'account_check') { await status('attention', 'Check the selected Yayoi account in Chrome. No login was submitted for a different account.'); return; }
    if (state.kind === 'portal' && !portalOpened) { portalOpened = true; await ui.accounting(); }
    else if (state.kind === 'email' && !emailSubmitted && !passwordSubmitted) {
      emailSubmitted = true; await status('running', 'Entering your saved Yayoi ID.'); await ui.email(credentials);
    } else if (state.kind === 'password' && !passwordSubmitted) {
      passwordSubmitted = true; await status('running', 'Signing in to Yayoi.'); await ui.password(credentials);
    } else if (state.kind === 'manual') {
      // Allow brief SSO navigation; unfamiliar authentication and consent stay manual.
      await wait(1500);
      const current = await ui.state(credentials.username).catch(() => ({ kind: 'manual' }));
      if (current.kind === 'manual') { await status('attention', 'Complete the additional Yayoi login or verification in Chrome.'); return; }
    }
    await wait(500);
  }
  await status('attention', 'Yayoi needs attention in Chrome. Check the login details or finish verification; the password was not retried.');
}

export async function openYayoi(config, directory, status, { getBrowser } = {}) {
  const credentials = yayoiCredentials(config.services?.yayoi);
  const profile = config.services.yayoi.profile || Object.values(config.accounts || {}).find(a => a.profile)?.profile || (await import('node:path')).default.join(directory, 'profiles', 'yayoi');
  if (!getBrowser) getBrowser = (await import('./browser.mjs')).browserFor;
  const browser = await getBrowser(profile);
  const pages = (await browser.pages()).filter(p => isYayoiPage(p.url()));
  if (pages.length > 1) throw new Error('Keep one Yayoi tab open before retrying');
  const page = pages[0] || await browser.newPage();
  await ensureYayoiLogin(page, credentials, status);
}

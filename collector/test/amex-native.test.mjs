// collector/test/amex-native.test.mjs — the Amex statement download through the native helper (case omf-amex-native-runtime-01), unit and
// fault legs: the REAL collector/amex-native.mjs (and through it the REAL login.mjs ensureLogin, statement.mjs latestClosed/verifyStatement and
// shared/amex.mjs parseAmex) over a scripted fake helper put at its spawn seam (nativeHost.spawn), on a virtual clock (nativeHost.now/sleep).
// No PowerShell, Chrome, issuer, mailbox, vault or OMF is used; fictional logins, codes and statement rows only, in owned temp directories.
// The production helper itself runs in scripts/zoomer-fixtures/omf-amex-native.mjs (owned Chrome on loopback fixtures).
// OMF_TEST_NATIVE_MODULE points at a mutant copy of amex-native.mjs beside the original (scripts/zoomer-fixtures/omf-amex-native.mjs leg M).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HEADERS } from '../../shared/amex.mjs';
import { tokyoDate } from '../statement.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const N = await import(pathToFileURL(process.env.OMF_TEST_NATIVE_MODULE ? path.resolve(process.env.OMF_TEST_NATIVE_MODULE) : path.join(here, '..', 'amex-native.mjs')).href);
const WINDOWS = process.platform === 'win32' ? false : 'Windows only';
const ACCOUNT = Object.freeze({ _id: 'c3'.repeat(12), ownerId: 'a1'.repeat(12), provider: 'amex', name: 'Synthetic Amex', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'codes@example.invalid', otpMailbox: 'codes@example.invalid' });
const LOGIN = Object.freeze({ username: 'omf-fictional-user-0001', password: 'Omf-fictional-pass-0001' });
const CODE = '864213', MAIL_ID = 'synthetic-mail-0001', ORIGIN = 'https://omf.example.invalid';
const STATEMENT = 'https://global.americanexpress.com/activity/statement';
const ATTENTION_DEADLINE = 'Amex login needs attention in Chrome; retry when verification is complete';
const roots = [];
test.after(async () => { for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {}); });
async function owned(label) { const dir = await mkdtemp(path.join(os.tmpdir(), 'omf-amex-native-' + label + '-')); roots.push(dir); return dir; }

// ── fictional statement periods around today in Tokyo: one still open, the latest closed one and an older one ─────────────────────────
const day = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const slash = date => date.replaceAll('-', '/');
function periods() {
  const closedEnd = day(tokyoDate(), -5), latest = { start: day(closedEnd, -30), end: closedEnd, total: 12 };
  return { open: { start: day(closedEnd, 1), end: day(closedEnd, 31) }, latest, older: { start: day(latest.start, -31), end: day(latest.start, -1) } };
}
function csv(count, { foreignCard = false } = {}) {
  const { latest } = periods(), rows = Array.from({ length: count }, (_, i) => [slash(day(latest.start, i + 1)), slash(day(latest.start, i + 2)), 'FIXTURE SHOP ' + (i + 1), 'FIXTURE TARO', foreignCard && i === 0 ? '-54321' : '-12345', String((i + 1) * 1100), '', '']);
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([HEADERS, ...rows].map(r => r.join(',')).join('\r\n') + '\r\n', 'utf8')]);
}

// ── the fake helper: a scripted Amex behind the helper's JSON-lines protocol ──────────────────────────────────────────────────────────
// page.surface: login → channels → code → dashboard → statement (end: the opened period, dialog, csv) — the e-mail code is accepted on 次へ.
// `faults[op]`: replies given instead of the scripted one, in order (a code, or a whole reply); tests may push more at any time (hooks).
// `persist[op]`: a code given to every request of that op. `on[op](request, page)`: runs after the scripted reply. `exitAfter`: the
// helper ends right after answering that op (a crash). `person(page)`: what the person does when the window is shown (attended mode).
function fakeAmex({ otp = true, mailbox = true, download = 'csv', rows = 12, foreignCard = false, cards = ['-12345'], periodCards = cards, faults = {}, persist = {}, on = {}, exitAfter = null, person = null } = {}) {
  const p = periods(), record = { spawns: [], lines: [], ops: [], typed: {}, mode: null, ended: null };
  const link = q => ({ text: `${slash(q.start)} - ${slash(q.end)}`, href: `${STATEMENT}?end=${q.end}` });
  const links = [link(p.open), link(p.latest), { text: 'この期間を見る', href: `${STATEMENT}?end=${p.latest.end}` }, link(p.older)];
  const page = { surface: 'login', channel: false, end: null, dialog: false, csv: false, folder: null };
  const take = op => {
    if (persist[op]) return { ok: false, code: persist[op], acted: false };
    const queue = faults[op]; if (!queue?.length) return null;
    const next = queue.shift(); return typeof next === 'string' ? { ok: false, code: next, acted: false } : next;
  };
  const put = (name, bytes) => writeFileSync(path.join(page.folder, name), bytes);
  const handlers = {
    launch: () => ({ ok: true, pid: 61001, mode: record.mode }),
    'wait-ready': () => ({ ok: true, surface: 'www' }),
    state: () => page.surface === 'login' ? { ok: true, kind: 'login' } : page.surface === 'channels' ? { ok: true, kind: 'channels', channels: [{ id: 'channel-mail', text: 'c***s@example.invalid', checked: page.channel }] } : page.surface === 'code' ? { ok: true, kind: 'code', recipients: ['c***s@example.invalid'] } : ['dashboard', 'statement'].includes(page.surface) ? { ok: true, kind: 'authenticated' } : { ok: true, kind: 'unknown' },
    login: r => { record.typed.user = r.user; record.typed.password = r.password; page.surface = otp ? 'channels' : 'dashboard'; return { ok: true, submitted: 1 }; },
    choose: r => { page.channel = r.channel === 'channel-mail'; return { ok: true, chosen: 1 }; },
    next: () => { if (page.surface === 'channels' && page.channel) page.surface = 'code'; else if (page.surface === 'code' && record.typed.code === CODE) page.surface = 'dashboard'; return { ok: true, invoked: 1 }; },
    code: r => { record.typed.code = r.value; return { ok: true, typed: 1 }; },
    show: () => { person?.(page); return { ok: true, restored: false }; },
    'open-statement': () => { page.surface = 'statement'; page.end = null; return { ok: true, invoked: 1 }; },
    snapshot: () => page.surface !== 'statement' ? { ok: false, code: 'document_origin', acted: false } : { ok: true, url: page.end ? `${STATEMENT}?end=${page.end}` : STATEMENT, links, periods: page.end ? [`（${slash(p.latest.start)}－${slash(p.latest.end)}）`] : [], cards: page.end ? periodCards : cards, counts: page.end ? [[p.latest.total, p.latest.total]] : [] },
    'invoke-period': r => { page.end = new URL(r.href).searchParams.get('end'); return { ok: true, invoked: 1 }; },
    'download-open': () => { page.dialog = true; return { ok: true, invoked: 1 }; },
    'csv-state': () => ({ ok: true, present: page.dialog, ...(page.dialog ? { selected: page.csv } : {}) }),
    'csv-select': () => { page.csv = true; return { ok: true, chosen: 1 }; },
    download: () => {
      if (download === 'csv') put('activity.csv', csv(rows, { foreignCard }));
      else if (download === 'pdf') put('activity.pdf', Buffer.from('%PDF-1.4 fictional'));
      else if (download === 'two') { put('activity.csv', csv(rows)); put('activity (1).csv', csv(rows)); }
      else if (download === 'partial') put('Unconfirmed 1234.crdownload', Buffer.from('partial'));
      return { ok: true, invoked: 1 };
    },
    close: () => ({ ok: true, gracefulExit: true })
  };
  const spawn = args => {
    record.spawns.push(args); record.mode = args[args.indexOf('-Mode') + 1]; page.folder = args[args.indexOf('-Downloads') + 1];
    const child = new EventEmitter(); let buffer = '', ended = false;
    child.pid = 52000 + record.spawns.length; child.stdout = new PassThrough(); child.stderr = new PassThrough(); record.child = child;
    const out = value => { if (!ended) child.stdout.write(JSON.stringify(value) + '\n'); };
    const finish = reason => { if (ended) return; out({ event: 'end', reason, chromeEnded: true, desktopClosed: true }); ended = true; record.ended = reason; child.stdout.end(); setImmediate(() => child.emit('close', reason === 'killed' ? null : 0)); };
    child.kill = () => { record.killed = true; finish('killed'); return true; };
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        buffer += chunk; let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); record.lines.push(line);
          const request = JSON.parse(line); record.ops.push(request.op);
          if (ended) continue;
          const reply = take(request.op) ?? handlers[request.op]?.(request) ?? { ok: false, code: 'unknown_op' };
          out({ id: request.id, ...reply }); on[request.op]?.(request, page);
          if (request.op === 'close') finish('closed'); else if (exitAfter === request.op) finish('crashed');
        }
        callback();
      },
      final(callback) { finish('stdin_closed'); callback(); }
    });
    setImmediate(() => out({ event: 'ready', pid: child.pid, mode: record.mode }));
    return child;
  };
  const mail = { calls: [], async verify() { mail.calls.push('verify'); if (!mailbox) throw new Error('synthetic: no mailbox'); }, async find(_account, _since, used) { mail.calls.push('find'); return used.includes(MAIL_ID) ? null : { id: MAIL_ID, code: CODE }; } };
  return { spawn, record, mail, page, faults, periods: p };
}
// Runs the real collectStatementNative with the fake at the seams and a virtual clock; the real seams are restored afterwards.
async function run(fake, { attended = false, settings = LOGIN, gmail = {}, onLaunch, label = 'run', jobId = randomUUID(), prepare = null } = {}) {
  const dir = await owned(label), profile = path.join(dir, 'profiles', 'ephemeral', 'p'), statuses = [], order = [], account = { ...ACCOUNT, jobId };
  await mkdir(profile, { recursive: true }); if (prepare) await prepare(dir, account);
  const saved = { ...N.nativeHost }; let t = Date.now();
  Object.assign(N.nativeHost, { spawn: fake.spawn, mailbox: () => fake.mail, now: () => t, sleep: async ms => { t += ms; await new Promise(resolve => setImmediate(resolve)); } });
  const own = onLaunch !== undefined ? onLaunch : async ({ pid, browser }) => { order.push({ pid, browser, opsBefore: [...fake.record.ops] }); };
  try {
    const outcome = await N.collectStatementNative(account, settings, dir, async (state, text) => { statuses.push([state, text]); }, { profile, chrome: 'C:\\Synthetic\\chrome.exe', gmail, onLaunch: own, origin: ORIGIN, attended }).then(value => ({ value }), error => ({ error }));
    return { ...outcome, dir, account, order, statuses };
  } finally { Object.assign(N.nativeHost, saved); }
}
const jobDirOf = r => path.join(r.dir, 'outbox', ACCOUNT._id, r.account.jobId);
const traceDir = r => path.join(r.dir, 'diagnostics', 'amex', ACCOUNT._id);
async function traceOf(r) {
  const names = (await readdir(traceDir(r)).catch(() => [])).filter(n => n.endsWith('.json'));
  assert.equal(names.length, 1, 'amex-native:one-trace-record ' + JSON.stringify(names));
  const text = await readFile(path.join(traceDir(r), names[0]), 'utf8'); return { text, record: JSON.parse(text), name: names[0] };
}
const count = (list, value) => list.filter(x => x === value).length;

test('positive: the helper is owned before Chrome exists, one sign-in, the e-mail code from the mailbox, the latest closed statement verified before and after its one download, the manifest written once', { skip: WINDOWS }, async () => {
  const fake = fakeAmex(), r = await run(fake, { label: 'positive' });
  assert.equal(r.error, undefined, 'amex-native:positive ' + r.error?.stack);
  const m = r.value.manifest, p = fake.periods;
  assert.deepEqual(r.order, [{ pid: 52001, browser: null, opsBefore: [] }], 'amex-native:own-before-any-request');
  assert.equal(fake.record.ops[0], 'launch', 'amex-native:launch-first-after-ownership');
  assert.deepEqual(['login', 'code', 'download', 'close', 'open-statement', 'invoke-period'].map(op => count(fake.record.ops, op)), [1, 1, 1, 1, 1, 1], 'amex-native:one-each ' + fake.record.ops.join(','));
  assert.deepEqual([fake.record.typed.user, fake.record.typed.password, fake.record.typed.code], [LOGIN.username, LOGIN.password, CODE], 'amex-native:typed');
  assert.deepEqual([fake.record.mode, fake.record.spawns.length], ['private', 1], 'amex-native:private-by-default');
  assert.deepEqual(fake.mail.calls, ['verify', 'find'], 'amex-native:mailbox-contract');
  assert.deepEqual(JSON.parse(await readFile(path.join(r.dir, 'used-login-messages.json'), 'utf8')), [MAIL_ID], 'amex-native:claim-persisted');
  assert.deepEqual(Object.keys(m), ['accountId', 'primaryCard', 'jobId', 'kind', 'start', 'end', 'key', 'pageCount', 'sha256', 'filename', 'downloadedAt', 'ownerId', 'origin'], 'amex-native:manifest-shape');
  assert.deepEqual([m.accountId, m.primaryCard, m.jobId, m.kind, m.start, m.end, m.pageCount, m.ownerId, m.origin], [ACCOUNT._id, '12345', r.account.jobId, 'statement', p.latest.start, p.latest.end, 12, ACCOUNT.ownerId, ORIGIN], 'amex-native:manifest-values');
  assert.match(m.filename, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/, 'amex-native:outbox-filename-uuid');
  assert.equal(r.value.directory, jobDirOf(r));
  assert.deepEqual((await readdir(jobDirOf(r))).sort(), [m.filename, 'manifest.json'].sort(), 'amex-native:outbox-file-and-manifest-only (the attempt folder removed)');
  assert.deepEqual(JSON.parse(await readFile(path.join(jobDirOf(r), 'manifest.json'), 'utf8')), m, 'amex-native:manifest-file');
  assert.equal((await readFile(path.join(jobDirOf(r), m.filename))).equals(csv(12)), true, 'amex-native:bytes-unchanged');
  const texts = r.statuses.map(s => s[1]);
  assert.deepEqual([texts.includes('Signing in to Amex'), texts.includes('Requesting the Amex account-login email'), texts.includes('Selecting the latest closed Amex statement'), texts.some(s => s.startsWith('Downloading the closed statement'))], [true, true, true, true], 'amex-native:statuses');
  const { record } = await traceOf(r);
  assert.deepEqual([record.schema, record.mode, record.outcome, record.helper.end, record.helper.started], ['amex-native-trace-1', 'private', 'completed', 'closed', true], 'amex-native:trace');
  assert.equal(fake.record.ended, 'closed', 'amex-native:closed');
});

test('ownership: without onLaunch nothing starts; a refused ownership closes the helper before any launch; a ready event of another pid is refused', { skip: WINDOWS }, async () => {
  { const fake = fakeAmex(), r = await run(fake, { label: 'no-onlaunch', onLaunch: null });
    assert.equal(r.error?.message, N.OWNERSHIP_REQUIRED, 'amex-native:ownership-required');
    assert.deepEqual([fake.record.spawns.length, existsSync(path.join(r.dir, 'outbox'))], [0, false], 'amex-native:no-owner-nothing-started'); }
  { const fake = fakeAmex(), r = await run(fake, { label: 'own-refused', onLaunch: async () => { throw new Error('synthetic: the broker refused ownership'); } });
    assert.match(String(r.error?.message), /the broker refused ownership/, 'amex-native:own-refused-rethrown');
    assert.deepEqual([fake.record.ops, fake.record.ended], [['close'], 'closed'], 'amex-native:own-refused-no-launch'); }
  { const fake = fakeAmex(), spawn = fake.spawn;
    fake.spawn = args => { const child = spawn(args), write = child.stdout.write.bind(child.stdout); child.stdout.write = (text, ...rest) => write(String(text).replace('"pid":' + child.pid + ',', '"pid":4,'), ...rest); return child; };
    const r = await run(fake, { label: 'wrong-pid' });
    assert.equal(r.error?.message, N.HELPER_START, 'amex-native:ready-pid-checked');
    assert.deepEqual([r.order.length, fake.record.ops.includes('launch')], [0, false], 'amex-native:wrong-pid-not-owned-not-launched'); }
});

test('private mode: no saved login ends the job before anything starts; an Amex check it cannot complete ends it with the fixed message — no verification status, no show, one password submission', { skip: WINDOWS }, async () => {
  { const fake = fakeAmex(), r = await run(fake, { label: 'no-login', settings: {} });
    assert.equal(r.error?.message, N.NO_LOGIN, 'amex-native:private-no-login');
    assert.deepEqual([fake.record.spawns.length, r.order.length], [0, 0], 'amex-native:private-no-login-nothing-started'); }
  { const fake = fakeAmex({ mailbox: false }), r = await run(fake, { label: 'private-check' });
    assert.equal(r.error?.message, N.PRIVATE_ATTENTION, 'amex-native:private-attention-message');
    assert.deepEqual(r.statuses.filter(s => s[0] !== 'running'), [], 'amex-native:private-no-verification-status ' + JSON.stringify(r.statuses));
    assert.deepEqual([count(fake.record.ops, 'show'), count(fake.record.ops, 'login'), count(fake.record.ops, 'next'), fake.record.ended], [0, 1, 0, 'closed'], 'amex-native:private-attention-no-show-one-login ' + fake.record.ops.join(','));
    const { record } = await traceOf(r);
    assert.ok(record.steps.some(s => s.step === 'attention' && s.outcome === 'refused' && s.code === 'private_mode'), 'amex-native:private-attention-traced'); }
});

test('attended mode: Chrome on the person\'s desktop; asked once (verification_required, one show); the person completes the check there and the download completes; without a saved login nothing is typed', { skip: WINDOWS }, async () => {
  { const fake = fakeAmex({ mailbox: false, person: page => { page.surface = 'dashboard'; } }), r = await run(fake, { label: 'attended', attended: true });
    assert.equal(r.error, undefined, 'amex-native:attended-completes ' + r.error?.message);
    assert.deepEqual([fake.record.mode, count(fake.record.ops, 'show'), r.statuses.filter(s => s[0] === 'verification_required').length, count(fake.record.ops, 'login'), count(fake.record.ops, 'code')], ['input', 1, 1, 1, 0], 'amex-native:attended-asked-once ' + fake.record.ops.join(','));
    assert.equal(r.statuses.find(s => s[0] === 'verification_required')[1], 'Complete the Amex login or email verification in Chrome', 'amex-native:attended-status-text-unchanged'); }
  { const fake = fakeAmex({ otp: false, person: page => { page.surface = 'dashboard'; } }), r = await run(fake, { label: 'attended-no-login', attended: true, settings: {} });
    assert.equal(r.error, undefined, 'amex-native:attended-no-login-completes ' + r.error?.message);
    assert.deepEqual([count(fake.record.ops, 'login'), count(fake.record.ops, 'show'), fake.record.mode], [0, 1, 'input'], 'amex-native:attended-no-login-no-typing'); }
  { const fake = fakeAmex({ mailbox: false }), r = await run(fake, { label: 'attended-timeout', attended: true });
    assert.equal(r.error?.message, ATTENTION_DEADLINE, 'amex-native:attended-deadline-unchanged');
    assert.deepEqual([count(fake.record.ops, 'show'), count(fake.record.ops, 'login')], [1, 1], 'amex-native:attended-deadline-once'); }
});

test('read tolerance: a transient second top-level document (ambiguous_document) or a vanished element is read through in the login state, the statement reads and the final read after the download; every action is sent once', { skip: WINDOWS }, async () => {
  const fake = fakeAmex({ faults: { state: ['ambiguous_document', 'element_not_available'], snapshot: ['ambiguous_document'] }, on: { download: () => { fake.faults.snapshot = ['no_document', 'ambiguous_document', 'ambiguous_document']; } } });
  const r = await run(fake, { label: 'tolerance' });
  assert.equal(r.error, undefined, 'amex-native:tolerance-completes ' + r.error?.message);
  assert.deepEqual(['login', 'code', 'download', 'open-statement', 'invoke-period', 'csv-select', 'download-open'].map(op => count(fake.record.ops, op)), [1, 1, 1, 1, 1, 1, 1], 'amex-native:tolerance-one-action-each ' + fake.record.ops.join(','));
  const { record } = await traceOf(r);
  assert.deepEqual([record.tolerated.ambiguous_document, record.tolerated.element_not_available, record.tolerated.no_document], [4, 1, 1], 'amex-native:tolerance-traced ' + JSON.stringify(record.tolerated));
  assert.ok(record.steps.find(s => s.step === 'verify-after').reads === 4, 'amex-native:final-read-after-three-refusals ' + JSON.stringify(record.steps.find(s => s.step === 'verify-after')));
});

test('persistent ambiguity: the final read after the download that never settles ends the job at its deadline — the file kept out of the outbox listing, no manifest, the download never repeated', { skip: WINDOWS }, async () => {
  const fake = fakeAmex({ on: { download: () => { fake.faults.snapshot = Array(500).fill('ambiguous_document'); } } }), r = await run(fake, { label: 'persistent' });
  assert.equal(r.error?.message, N.PAGE_UNREADABLE, 'amex-native:persistent-ambiguity-fails');
  assert.deepEqual([count(fake.record.ops, 'download'), existsSync(path.join(jobDirOf(r), 'manifest.json'))], [1, false], 'amex-native:persistent-one-download-no-manifest');
  const left = await readdir(jobDirOf(r)), attempt = left.find(n => n.startsWith('download-'));
  assert.deepEqual([left.length, (await readdir(path.join(jobDirOf(r), attempt)))], [1, ['activity.csv']], 'amex-native:persistent-file-kept-in-attempt-folder');
  const { record } = await traceOf(r);
  assert.deepEqual([record.outcome, record.steps.find(s => s.step === 'verify-after').outcome], ['failed', 'timeout'], 'amex-native:persistent-traced');
  // the same refusal before the first statement read: the step's own message after its deadline, nothing invoked
  const before = fakeAmex({ persist: { snapshot: 'ambiguous_document' } }), r2 = await run(before, { label: 'persistent-initial' });
  assert.equal(r2.error?.message, 'Amex statement links or signed-in card could not be verified', 'amex-native:persistent-initial-step-message');
  assert.deepEqual(['invoke-period', 'download'].map(op => count(before.record.ops, op)), [0, 0], 'amex-native:persistent-initial-nothing-invoked');
});

test('actions are never repeated: an action the helper refuses — ambiguous before acting, or uncertain after starting — ends the job with that one request', { skip: WINDOWS }, async () => {
  for (const [op, reply, expected] of [['download', 'ambiguous_document', N.PAGE_CHANGED], ['login', { ok: false, code: 'element_not_available', acted: true }, N.PAGE_CHANGED], ['next', 'window_changed', N.PAGE_CHANGED], ['invoke-period', 'unrelated_document_window', N.OTHER_WINDOW], ['csv-select', 'uia_watchdog', N.HELPER_ENDED]]) {
    const fake = fakeAmex({ faults: { [op]: [reply] } }), r = await run(fake, { label: 'once-' + op });
    assert.equal(r.error?.message, expected, 'amex-native:action-refused ' + op);
    assert.equal(count(fake.record.ops, op), 1, 'amex-native:action-once ' + op + ' ' + fake.record.ops.join(','));
    if (op !== 'login') assert.equal(count(fake.record.ops, 'login'), 1, 'amex-native:one-password-submission ' + op);
    const { record } = await traceOf(r);
    assert.ok(record.steps.some(s => s.step === op && ['error', 'uncertain'].includes(s.outcome)), 'amex-native:action-refusal-traced ' + op);
  }
});

test('statement identity and file checks: the selected card, period and count before the download; the file\'s cards, rows and format after; each failure leaves no manifest', { skip: WINDOWS }, async () => {
  for (const [label, options, expected, downloads] of [
    ['wrong-card', { periodCards: ['-54321'] }, /The signed-in Amex account does not match this connection/, 0],
    ['two-cards', { periodCards: ['-12345', '-54321'] }, /The signed-in Amex account does not match this connection/, 0],
    ['wrong-download-count', { rows: 11 }, /Downloaded row count does not match the Amex page/, 1],
    ['wrong-download-card', { foreignCard: true }, /2行目: この口座に登録されていないカードです/, 1],
    ['not-csv', { download: 'pdf' }, new RegExp(N.NOT_CSV), 1],
    ['two-files', { download: 'two' }, /Multiple downloads started; check the Amex tab/, 1],
    ['never-finished', { download: 'partial' }, /Amex CSV download did not complete/, 1],
    ['no-file', { download: 'none' }, /Amex CSV download did not complete/, 1]
  ]) {
    const fake = fakeAmex(options), r = await run(fake, { label });
    assert.match(String(r.error?.message), expected, 'amex-native:' + label);
    assert.deepEqual([count(fake.record.ops, 'download'), existsSync(path.join(jobDirOf(r), 'manifest.json')), fake.record.ended], [downloads, false, 'closed'], 'amex-native:' + label + '-no-manifest');
  }
  // the CSV option missing, or not selected after the choice
  { const missing = fakeAmex({ on: { 'download-open': (_r, page) => { page.dialog = false; } } }), r = await run(missing, { label: 'csv-missing' });
    assert.deepEqual([r.error?.message, count(missing.record.ops, 'download-open'), count(missing.record.ops, 'download')], ['Amex CSV format option changed', 1, 0], 'amex-native:csv-option-missing'); }
  { const unselected = fakeAmex({ on: { 'csv-select': (_r, page) => { page.csv = false; } } }), r = await run(unselected, { label: 'csv-unselected' });
    assert.deepEqual([r.error?.message, count(unselected.record.ops, 'download')], ['Amex CSV format was not selected', 0], 'amex-native:csv-not-selected'); }
  // an existing manifest of this job is never overwritten (exclusive write)
  { const fake = fakeAmex(), r = await run(fake, { label: 'manifest-exists', prepare: async (dir, account) => { const jobDir = path.join(dir, 'outbox', ACCOUNT._id, account.jobId); await mkdir(jobDir, { recursive: true }); await writeFile(path.join(jobDir, 'manifest.json'), '{"kept":true}'); } });
    assert.equal(r.error?.code, 'EEXIST', 'amex-native:manifest-exclusive ' + r.error?.message);
    assert.equal(await readFile(path.join(jobDirOf(r), 'manifest.json'), 'utf8'), '{"kept":true}', 'amex-native:manifest-kept'); }
});

test('closure on every exit: a helper that ends mid-job ends it with the fixed message; the close request, the helper\'s end and the record follow every outcome', { skip: WINDOWS }, async () => {
  { const fake = fakeAmex({ exitAfter: 'open-statement' }), r = await run(fake, { label: 'helper-crash' });
    assert.equal(r.error?.message, N.HELPER_ENDED, 'amex-native:helper-crash');
    assert.deepEqual([fake.record.ended, count(fake.record.ops, 'snapshot') <= 1], ['crashed', true], 'amex-native:helper-crash-no-further-reads ' + fake.record.ops.join(','));
    const { record } = await traceOf(r); assert.equal(record.helper.end, null, 'amex-native:helper-crash-traced'); }
  { const fake = fakeAmex({ faults: { 'wait-ready': ['no_window'] } }), r = await run(fake, { label: 'no-window' });
    assert.equal(r.error?.message, N.PAGE_CHANGED, 'amex-native:no-window');
    assert.deepEqual([fake.record.ops.at(-1), fake.record.ended], ['close', 'closed'], 'amex-native:no-window-closed'); }
  // the person's or the session's cancellation arrives as the helper's end (the broker's job closes it): no further request answers
  { const fake = fakeAmex({ on: { choose: () => fake.record.child.kill() } });
    const r = await run(fake, { label: 'cancel' });
    assert.equal(r.error?.message, N.HELPER_ENDED, 'amex-native:cancelled-ends-job');
    assert.deepEqual([fake.record.killed, count(fake.record.ops, 'next')], [true, 0], 'amex-native:cancelled-nothing-after'); }
});

test('privacy: the login and the code reach the helper only inside their own request lines on stdin — never its arguments, any other request, the statuses, the errors, the record or the outbox', { skip: WINDOWS }, async () => {
  const fake = fakeAmex(), r = await run(fake, { label: 'privacy' });
  assert.equal(r.error, undefined, r.error?.message);
  const secrets = [LOGIN.username, LOGIN.password, CODE], lines = fake.record.lines;
  for (const s of secrets) {
    const carrying = lines.filter(l => l.includes(s)).map(l => JSON.parse(l).op);
    assert.deepEqual(carrying, s === CODE ? ['code'] : ['login'], 'amex-native:secret-only-in-its-request ' + carrying.join(','));
    assert.ok(!fake.record.spawns.flat().some(a => String(a).includes(s)), 'amex-native:secret-not-in-arguments');
    assert.ok(!JSON.stringify(r.statuses).includes(s), 'amex-native:secret-not-in-statuses');
  }
  const { text } = await traceOf(r);
  for (const leak of [...secrets, 'http', 'americanexpress', 'example.invalid', '@', 'FIXTURE', 'c***s', '?end=']) assert.ok(!text.includes(leak), 'amex-native:record-no-leak ' + leak);
  const outbox = await readdir(jobDirOf(r));
  for (const name of outbox) { const bytes = await readFile(path.join(jobDirOf(r), name), 'utf8'); for (const s of secrets) assert.ok(!bytes.includes(s), 'amex-native:outbox-no-secret ' + name); }
  // a failed job's error carries no value either
  const failing = fakeAmex({ faults: { code: ['control_readonly'] } }), f = await run(failing, { label: 'privacy-failure' });
  for (const s of secrets) assert.ok(!String(f.error?.message).includes(s) && !String(f.error?.stack).includes(s), 'amex-native:error-no-secret');
});

test('the private record: schema, closed key and value sets, the 20 newest kept per account, other files untouched, a store that cannot be written changing nothing', { skip: WINDOWS }, async () => {
  { const fake = fakeAmex(), r = await run(fake, { label: 'record' }), { record, name } = await traceOf(r);
    assert.match(name, new RegExp('^' + r.account.jobId + '-\\d{13}\\.json$'), 'amex-native:record-name');
    assert.deepEqual(Object.keys(record), ['schema', 'accountId', 'jobId', 'at', 'mode', 'outcome', 'steps', 'states', 'tolerated', 'helper', 'overflow'], 'amex-native:record-keys');
    const STEPS = ['ready', 'own', 'launch', 'wait-ready', 'login', 'choose', 'next', 'code', 'show', 'state', 'attention', 'open-statement', 'initial', 'select', 'invoke-period', 'period', 'verify-period', 'download-open', 'csv-present', 'csv-select', 'csv-selected', 'verify-before', 'download', 'file', 'validate', 'verify-after', 'manifest', 'close'];
    for (const s of record.steps) { assert.ok(STEPS.includes(s.step), 'amex-native:record-step ' + s.step); assert.ok(['ok', 'error', 'uncertain', 'timeout', 'refused'].includes(s.outcome)); assert.ok(s.code === null || N.CODES.includes(s.code)); assert.ok(Number.isSafeInteger(s.ms)); }
    assert.deepEqual(Object.keys(record.states).sort(), ['authenticated', 'channels', 'code', 'login'], 'amex-native:record-states'); }
  { const fake = fakeAmex(), mine = r => traceDir(r), other = dir => path.join(dir, 'diagnostics', 'amex', 'd4'.repeat(12));
    const r = await run(fake, { label: 'retention', prepare: async dir => { const d = path.join(dir, 'diagnostics', 'amex', ACCOUNT._id); await mkdir(d, { recursive: true }); await mkdir(other(dir), { recursive: true }); for (let i = 0; i < 25; i++) await writeFile(path.join(d, 'f'.repeat(8) + '-' + (1700000000000 + i) + '.json'), '{}'); await writeFile(path.join(d, 'notes.txt'), 'kept'); await writeFile(path.join(other(dir), 'job-1700000000000.json'), '{}'); } });
    const left = (await readdir(mine(r))).sort();
    assert.equal(left.length, 21, 'amex-native:retention-20-plus-other-file ' + JSON.stringify(left));
    assert.ok(left.includes('notes.txt') && !left.includes('ffffffff-1700000000005.json') && left.includes('ffffffff-1700000000006.json'), 'amex-native:retention-newest');
    assert.deepEqual(await readdir(other(r.dir)), ['job-1700000000000.json'], 'amex-native:retention-other-account'); }
  { const fake = fakeAmex(), r = await run(fake, { label: 'store-refused', prepare: dir => writeFile(path.join(dir, 'diagnostics'), 'not a directory') });
    assert.equal(r.error, undefined, 'amex-native:store-refused-job-unchanged ' + r.error?.message);
    assert.equal(await readFile(path.join(r.dir, 'diagnostics'), 'utf8'), 'not a directory', 'amex-native:store-refused-nothing-written'); }
});

// Fixture for plan omf-calendar-gmail-build-20261015 (9-plan-approved.json §4): monthly card bills in the payment
// calendar from the issuer's confirmation mail and the statement CSV, company-scoped calendar access, settlement without a
// second purchase expense, and the owner-approved conditions B1–B6. Run ONLY through the hub verifier (never directly; a
// direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture calendar-card-bill.mjs --cwd <this worktree>
// Every leg runs on synthetic companies, accounts, mail ids, mailboxes and amounts, an owned ephemeral MongoDB, temporary
// directories, a fake Gmail client and a fake collector; no mail service, bank, production address, real grant or real
// browser surface is reached. The one private historical input (the recorded September statement CSV and its card list)
// enters only through OMF_APLUS_REAL_CSV / OMF_APLUS_REAL_CARDS and is never copied here; without them the same legs run
// on a synthetic statement of the same shape and the report says so.
// Legs: A due date from the overview text · B parseAplus paymentDueDate · N1 parseBillingMail · SCHED effective mail
// schedule · F-P2 migration route gone · H1 (tsx child, owned memory Mongo, the real routes on h3): C, C-P3p, D, D-P1, N2,
// N3/B2, N4, N5/B1, N6, N8, N9, B3, B6, notices/link/billing-mail routes and the behavioral mutants (B4) · H2 (tsx child):
// E-P4 the real store under Pinia with $fetch intercepted · H3 (tsx child): N7 schedule → claim → BillingMailbox on a fake
// Gmail client → outbox artifacts → upload route → notices; B5 mailbox equality, pagination, mail failure, durable receipt ·
// H4 (built app, real headless Chrome): the connections page.
// Fail-first at 1b7cc8d: shared/billing-mail.mjs, server/services/financeBillService.ts and server/utils/calendarAccess.ts
// absent; aplusPaymentDueDate and BillingMailbox not exported; parseAplus drops paymentDueDate; notice upload 404; the
// calendar lists every company's rows; migrate-payment-dates.ts present; markAsPaid POSTs a transaction for a card bill.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, unlink, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const REAL_CSV = process.env.OMF_APLUS_REAL_CSV || '';
const REAL_CARDS = process.env.OMF_APLUS_REAL_CARDS || '';
const execFileAsync = promisify(execFile);
const exists = p => access(p).then(() => true, () => false);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// ── Synthetic mail set, shared by the parent legs and every child harness (plain JS, valid inside a .mts file). ──────────
// The Aplus confirmation keeps the two recorded anchor lines (the お支払分 line and the ご請求金額は line) and the 550円
// paragraph that must never be read as the amount; every brand line, id, mailbox and amount is synthetic.
const MAIL_BUILDERS = String.raw`
const MAILBOX = 'bills@example.invalid';
const AUTH_APLUS = 'mx.google.com; dkim=pass header.i=@aplus.co.jp header.s=synthetic header.b=AAAA; spf=pass (google.com: domain of synthetic@example.invalid designates 192.0.2.1 as permitted sender) smtp.mailfrom=synthetic@example.invalid; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=aplus.co.jp';
const AUTH_AMEX = 'mx.google.com; dkim=pass header.i=@welcome.americanexpress.com header.s=synthetic header.b=BBBB; spf=pass (google.com: domain of synthetic@example.invalid designates 192.0.2.2 as permitted sender) smtp.mailfrom=synthetic@example.invalid; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=welcome.americanexpress.com';
const AUTH_FAIL = 'mx.google.com; dkim=fail header.i=@aplus.co.jp header.s=synthetic header.b=CCCC; spf=softfail (google.com: domain of transitioning synthetic@example.invalid does not designate 192.0.2.3 as permitted sender) smtp.mailfrom=synthetic@example.invalid; dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=aplus.co.jp';
const jpAmount = n => n.toLocaleString('en-US');
let mailSeq = 0;
const nextMailId = () => 'a' + (++mailSeq).toString(16).padStart(15, '0');
function aplusConfirmation({ year = 2026, month = 9, day = 28, amount = 1234560, id = nextMailId(), auth = AUTH_APLUS, lines = null, extraAmountLine = null } = {}) {
  const body = lines || ['いつも Synthetic Luxury Card をご利用いただきありがとうございます。', '━―――――――――――――――――━', '◆ご請求明細の更新確定',
    year + '年' + month + '月' + day + '日お支払分のご請求金額が確定いたしましたので、ご案内申しあげます。',
    month + '月' + day + '日のご請求金額は、' + jpAmount(amount) + '円です。',
    ...(extraAmountLine ? [extraAmountLine] : []),
    '詳しい明細は下記のURLから「Luxury Card Online (My APLUS)」にログイン後、ご確認ください。',
    '◆お支払いが間に合わなかった場合の回収費用のご請求について',
    '2026年7月27日(月)お支払い分より、カードのご利用代金をお支払い期日までにお支払いいただけなかった場合、',
    '回収費用として550円（税込）をご請求いたします。'];
  return { id, threadId: id, internalDate: String(Date.UTC(year, month - 1, Math.max(1, day - 11), 0, 19, 45)), headers: { from: 'Luxury Card <luxurycard@aplus.co.jp>', subject: '最新ご請求明細確定のご案内', date: 'Thu, 17 Sep 2026 09:19:45 +0900', 'authentication-results': auth }, text: body.join('\r\n') };
}
function aplusReminder({ year = 2026, month = 9, day = 28, id = nextMailId() } = {}) {
  return { id, threadId: id, internalDate: String(Date.UTC(year, month - 1, Math.max(1, day - 4), 2, 0, 21)), headers: { from: 'Luxury Card <luxurycard@aplus.co.jp>', subject: '【お支払日のご案内】' + year + '年' + month + '月' + day + '日ご請求分（今月ご請求のない方へもご案内しています）', date: 'Thu, 24 Sep 2026 11:00:21 +0900', 'authentication-results': AUTH_APLUS }, text: ['いつも Synthetic Luxury Card をご愛顧いただき、ありがとうございます。', '今月のお引落とし日をご案内いたします。', '▼▽お支払金額の確認はこちら', '[link]'].join('\r\n') };
}
function aplusOther({ subject = 'お支払方法変更のご案内', text = 'お支払方法の変更を受け付けました。', id = nextMailId() } = {}) {
  return { id, threadId: id, internalDate: String(Date.UTC(2026, 8, 20, 1, 0, 0)), headers: { from: 'Luxury Card <luxurycard@aplus.co.jp>', subject, date: 'Sun, 20 Sep 2026 10:00:00 +0900', 'authentication-results': AUTH_APLUS }, text };
}
function amexConfirmation({ suffix = '11009', digits = 5, bracket = false, id = nextMailId() } = {}) {
  return { id, threadId: id, internalDate: String(Date.UTC(2026, 8, 19, 4, 3, 4)), headers: { from: 'American Express <AmericanExpress@welcome.americanexpress.com>', subject: (bracket ? '[AMERICAN EXPRESS] ' : '') + 'ご請求金額確定のご案内', date: 'Fri, 18 Sep 2026 21:03:04 -0700', 'authentication-results': AUTH_AMEX },
    text: ['お客様のアカウントに関するお知らせ', 'SYNTHETIC MEMBER様', 'カード番号（下' + digits + '桁）: ' + suffix, '平素はアメリカン・エキスプレスのカードをご利用いただき、誠にありがとうございます。', 'ご請求金額が確定しましたので、マイアカウントへ ログイン のうえ、ご確認ください。'].join('\r\n') };
}
// One Gmail "full" message, the shape users.messages.get answers with (text/plain part, base64url body).
function gmailMessage(mail) {
  return { id: mail.id, threadId: mail.threadId, internalDate: mail.internalDate, payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: mail.headers.from }, { name: 'Subject', value: mail.headers.subject }, { name: 'Date', value: mail.headers.date }, { name: 'To', value: MAILBOX }, { name: 'Authentication-Results', value: mail.headers['authentication-results'] }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(mail.text, 'utf8').toString('base64url') } }] } };
}
`;

// The child's own database receipt (F4/B4): what the child can truthfully say — a connection to the MongoMemoryServer this
// very child started (ownedProcess), and real stored objects in it (executed). The hub runner records it as fixture-reported;
// it never verifies it itself (verifiedByRunner stays false by design).
const DATABASE_RECEIPT = String.raw`
async function databaseReceipt(mongoose, mongo) {
  try {
    if (mongoose.connection.readyState !== 1) return { executed: false, ownedProcess: false, reason: 'not connected' };
    const stats = await mongoose.connection.db.stats();
    const port = Number(mongoose.connection.port), ownedPort = Number(mongo?.instanceInfo?.port || 0);
    return { executed: stats.objects > 0, ownedProcess: ownedPort > 0 && port === ownedPort && mongoose.connection.host === '127.0.0.1', name: mongoose.connection.name, objects: stats.objects, collections: stats.collections, port };
  } catch (error) { return { executed: false, ownedProcess: false, reason: String(error?.message || error).slice(0, 200) }; }
}
`;

// ── Child harness runner: the TypeScript services and routes run from a .mts entry under the project's installed tsx, inside
// the tree (gitignored .cache) so bare imports resolve like the project's own scripts; removed afterwards. ─────────────────
function runChild(args, { cwd = REPO_ROOT, env = process.env, timeout = 600000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      let receipt = null;
      try { receipt = JSON.parse(lines.find(l => l.startsWith('{"pass":')) || 'null'); } catch { receipt = null; }
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, killed: !!error?.killed, passes: lines.filter(l => l.startsWith('PASS ')).map(l => l.slice(5)), reds: lines.filter(l => l.startsWith('FAIL ')).map(l => l.slice(5)), receipt, tail: (String(stderr || '').trim() || text).slice(-2200) });
    });
  });
}
async function harness(name, source, args = [], extraEnv = {}) {
  const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
  const file = path.join(cache, 'calendar-card-bill-' + name + '-' + process.pid + '.mts');
  await writeFile(file, source, { flag: 'wx' });
  let result;
  try { result = await runChild(['--import', 'tsx', file, REPO_ROOT, ...args], { env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', ...extraEnv } }); }
  finally { await unlink(file).catch(() => {}); }
  return result;
}
// Folds a child's PASS/FAIL lines into the parent's leg list; a child that died without a verdict is one red leg.
function foldChild(legs, name, result) {
  for (const p of result.passes) legs.push({ name: p, ok: true, ms: 0 });
  for (const r of result.reds) legs.push({ name: r, ok: false, ms: 0 });
  const ok = result.code === 0 && result.receipt?.pass === true && !result.reds.length;
  if (!ok && !result.reds.length) legs.push({ name: name + ' harness', ok: false, ms: result.ms, detail: 'exit ' + (result.killed ? 'timeout' : result.code) + ' with ' + result.passes.length + ' green: ' + result.tail.replace(/\s+/g, ' ').slice(-900) });
  else if (!ok && result.reds.length && result.code !== 0 && result.receipt?.pass !== false) legs.push({ name: name + ' harness', ok: false, ms: result.ms, detail: 'exit ' + result.code + ': ' + result.tail.replace(/\s+/g, ' ').slice(-600) });
  return ok;
}

// ── H1: services and routes on an owned ephemeral MongoDB; the real finance, payments and dashboard routes on h3. ────────
const H1_HARNESS = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], REAL_CSV = process.argv[3] || '', REAL_CARDS = process.argv[4] || '';
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const legs = [];
async function leg(name, fn) {
  try { const detail = await fn(); legs.push(true); console.log('PASS ' + name + (detail ? ' — ' + String(detail) : '')); }
  catch (error) { legs.push(false); console.log('FAIL ' + name + ' — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900)); }
}
` + DATABASE_RECEIPT + MAIL_BUILDERS + String.raw`
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { createApp, createRouter, toNodeListener } = await import('h3');
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'calendar_card_bill_isolated' } });
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-h1-'));
process.env.MONGO_URI = mongo.getUri('calendar_card_bill_isolated'); process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test'; process.env.OMF_DATA_DIR = path.join(temp, 'data');
const servers = [];
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'calendar_card_bill_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const Organization = (await import(u('server/models/Organization.ts'))).default;
  const { Payment } = await import(u('server/models/Payment.ts'));
  const finance = await import(u('server/models/Finance.ts'));
  const { FinancialAccount, FinanceImport, initializeFinance } = finance;
  const FinanceNotice = finance.FinanceNotice; assert.equal(typeof FinanceNotice?.findOne, 'function', 'server/models/Finance.ts exports no FinanceNotice');
  const auth = (await import(u('server/middleware/auth.ts'))).default;
  const financeRoute = (await import(u('server/api/finance/[...path].ts'))).default;
  const paymentsIndex = (await import(u('server/api/payments/index.ts'))).default;
  const paymentsId = (await import(u('server/api/payments/[id].ts'))).default;
  const stats = (await import(u('server/api/dashboard/stats.ts'))).default;
  const bills = await import(u('server/services/financeBillService.ts'));
  const service = await import(u('server/services/financeService.ts'));
  for (const name of ['reconcileBill', 'recordBillingNotice', 'recordBillingMailStatus', 'bindCalendarCompany', 'linkNotice', 'listNotices', 'coveredNoticeIds']) assert.equal(typeof bills[name], 'function', 'financeBillService exports no ' + name);
  const access = await import(u('server/utils/calendarAccess.ts')); assert.equal(typeof access.calendarCompany, 'function', 'calendarAccess exports no calendarCompany');
  const { parseBillingMail, authenticationResults, BILLING_MAIL_PARSER } = await import(u('shared/billing-mail.mjs'));
  const { HEADERS, aplusPeriod, parseAplus } = await import(u('shared/aplus.mjs'));
  await initializeFinance(); await Payment.init(); await Organization.init(); await User.init();
  // ── the app: auth middleware, the payments and dashboard routes on a router, the finance catch-all behind them ──
  const mount = async (handlers = {}) => {
    const app = createApp(); app.use(auth);
    const router = createRouter();
    router.use('/api/payments', handlers.paymentsIndex || paymentsIndex); router.use('/api/payments/:id', handlers.paymentsId || paymentsId); router.use('/api/dashboard/stats', handlers.stats || stats);
    app.use(router); app.use(handlers.financeRoute || financeRoute);
    const server = http.createServer(toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  };
  const origin = await mount();
  const callAt = async (base, route, { method = 'GET', token = null, body, type = 'application/json', query } = {}) => {
    const url = new URL(route, base); if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, message: data?.data?.message || data?.statusMessage || '' };
  };
  const call = (route, options) => callAt(origin, route, options);
  const fin = (route, options) => call('/api/finance/' + route, options);
  // ── people, companies, tokens ──
  const PASSWORD = 'Synthetic-only-Strong-Password1!';
  const user = await User.create({ email: 'calendar-owner@example.invalid', name: 'Synthetic owner', password: PASSWORD }); const ownerId = String(user._id);
  const mkOrg = async (name, members) => Organization.create({ name, slug: name.toLowerCase() + '-' + randomUUID().slice(0, 8), type: 'business', members: members.map(userId => ({ userId, role: 'owner' })) });
  const orgA = await mkOrg('Synthetic-A', [user._id]), orgB = await mkOrg('Synthetic-B', [user._id]), orgC = await mkOrg('Synthetic-C', []);
  const A = String(orgA._id), B = String(orgB._id), C = String(orgC._id);
  const tokenFor = (userId, email, organizationId) => jwt.sign({ userId, email, type: 'access', jti: randomUUID(), ...(organizationId ? { organizationId, role: 'owner' } : {}) }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const tokenA = tokenFor(ownerId, user.email, A), tokenB = tokenFor(ownerId, user.email, B), tokenC = tokenFor(ownerId, user.email, C), tokenNone = tokenFor(ownerId, user.email, null);
  const removeMember = (org, userId) => Organization.updateOne({ _id: org }, { $pull: { members: { userId } } });
  const addMember = (org, userId) => Organization.updateOne({ _id: org }, { $push: { members: { userId, role: 'owner' } } });
  // ── accounts, collectors, jobs, deliveries ──
  let realCards = [];
  if (REAL_CARDS) { if (/\.json$/i.test(REAL_CARDS)) { const v = JSON.parse(await readFile(REAL_CARDS, 'utf8')); realCards = (v.cards || []).map(c => String(c).replace(/[^\d]/g, '').slice(-4)); } else realCards = REAL_CARDS.split(',').map(s => s.trim()).filter(Boolean); }
  // One owner, many synthetic accounts: the account index is unique per owner, provider and card suffix, so every account
  // gets its own suffix; only the one account that receives the recorded CSV also carries the recorded card suffixes.
  let accountSeq = 0;
  const nextCard = () => String(1000 + (++accountSeq));
  // Each account also reads its own mailbox: two accounts of one owner on the same mailbox are an ambiguity the service
  // sends to review (tested on purpose in N2b), not the normal shape.
  const mkAccount = async ({ organizationId = A, mailbox = null, billingMail = null, autoSync = { enabled: true, hour: 9 }, collector = true, name = null, cards = null } = {}) => {
    const card = nextCard(), cardIdentifiers = [...new Set([card, ...(cards || [])])], box = mailbox || ('bills-' + accountSeq + '@example.invalid');
    const account = await FinancialAccount.create({ ownerId, name: name || ('Synthetic Aplus ' + accountSeq), provider: 'aplus', primaryCard: card, cardIdentifiers, ...(organizationId ? { organizationId, organizationBoundAt: new Date() } : {}), billingMail: billingMail || { enabled: true, mailbox: box }, autoSync });
    let token = null, collectorId = null;
    if (collector) { const created = await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic PC ' + accountSeq, accountIds: [String(account._id)] } }); assert.equal(created.status, 200, JSON.stringify(created)); token = created.data.token; collectorId = created.data.id; }
    return { account, id: String(account._id), card, cardIdentifiers, mailbox: box, collectorId, token, read: async () => FinancialAccount.findById(account._id).lean() };
  };
  const claimJob = async acct => {
    const synced = await fin('accounts/' + acct.id + '/sync', { method: 'POST', token: tokenA }); assert.equal(synced.status, 200, 'sync: ' + JSON.stringify(synced));
    const claimed = await fin('collector/claim', { method: 'POST', token: acct.token, body: {} }); assert.equal(claimed.status, 200, JSON.stringify(claimed)); assert.equal(claimed.data.account?._id, acct.id, 'claimed another account');
    return { jobId: claimed.data.account.jobId, covered: claimed.data.covered };
  };
  const finishJob = async (acct, jobId) => { const r = await fin('collector/status', { method: 'POST', token: acct.token, body: { accountId: acct.id, jobId, state: 'complete', message: 'synthetic' } }); assert.equal(r.status, 200, JSON.stringify(r)); };
  const csvOf = rows => Buffer.from('﻿' + [HEADERS, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
  const purchase = (card, changes = {}) => Object.assign(['≪****-****-****-' + card + '≫', '20260801', 'Synthetic shop', '1200', 'Ｓ', '1', '01', '1200', ''], changes);
  const statementCsv = (acct, month, total, salt = '') => csvOf([purchase(acct.card, { 1: month.replace('-', '') + '01', 2: 'Synthetic shop ' + salt, 3: String(total), 7: String(total) })]);
  const period = month => aplusPeriod({ kind: 'statement', statementMonth: month });
  const noon = d => new Date(d + 'T12:00:00.000Z');
  const deliver = async (acct, { month, total, paymentDueDate = null, bytes = null, salt = '' }) => {
    const { jobId } = await claimJob(acct); const p = period(month);
    const query = { accountId: acct.id, jobId, kind: 'statement', start: p.start, end: p.end, statementMonth: month, statementTotal: String(total), ...(paymentDueDate ? { paymentDueDate } : {}) };
    const r = await fin('collector/upload', { method: 'POST', token: acct.token, body: bytes || statementCsv(acct, month, total, salt), type: 'text/csv', query });
    await finishJob(acct, jobId); return r;
  };
  const artifact = (mail, overrides = {}) => { const parsed = parseBillingMail(mail.headers, mail.text, { now: Date.now() }); assert.ok(parsed, 'synthetic mail did not parse: ' + mail.headers.subject); return { kind: 'notice', parserVersion: BILLING_MAIL_PARSER, mailbox: MAILBOX, mailId: mail.id, threadId: mail.threadId, internalDate: Number(mail.internalDate), subject: mail.headers.subject, from: mail.headers.from, bodySha256: sha256(mail.text.replace(/\r/g, '')), authentication: authenticationResults(mail.headers), issuer: parsed.issuer, noticeKind: parsed.kind, claims: parsed.claims, readAt: new Date().toISOString(), ...overrides }; };
  const sendNotice = async (acct, mail, overrides = {}) => {
    const { jobId } = await claimJob(acct);
    const r = await fin('collector/upload', { method: 'POST', token: acct.token, body: artifact(mail, { mailbox: acct.mailbox, ...overrides }), type: 'application/json', query: { accountId: acct.id, jobId, kind: 'notice', mailId: mail.id } });
    await finishJob(acct, jobId); return r;
  };
  const sourced = async (acct, month) => Payment.findOne({ 'source.kind': 'card-statement', 'source.accountId': acct.account._id, 'source.periodKey': period(month).key }).lean();
  const ofAccount = async acct => Payment.find({ 'source.accountId': acct.account._id }).sort({ dueDate: 1 }).lean();
  const snap = doc => JSON.stringify(doc);
  const withoutSource = doc => { const { source, updatedAt, ...rest } = doc; return rest; };
  const evidenceFor = (month, total, dueDate, extra = {}) => ({ periodKey: period(month).key, statementMonth: month, statementTotal: total, paymentDueDate: dueDate, ...extra });
  async function mutant(file, edits, fn) {
    const source = path.join(ROOT, file); let text = await readFile(source, 'utf8');
    for (const e of edits) {
      if (e.marker) { const lines = text.split('\n'); const i = lines.findIndex(l => l.includes('// guard:' + e.marker)); if (i < 0) throw new Error('guard marker missing: ' + e.marker + ' in ' + file); lines.splice(i, 1); text = lines.join('\n'); }
      else { const n = text.split(e.from).length - 1; if (n !== 1) throw new Error('mutant anchor found ' + n + ' times in ' + file + ': ' + e.from); text = text.replace(e.from, e.to); }
      if (e.append) text += '\n' + e.append + '\n';
    }
    const ext = path.extname(file); const copy = path.join(path.dirname(source), path.basename(file, ext) + '.mutant-' + randomUUID().slice(0, 8) + ext);
    await writeFile(copy, text, { flag: 'wx' });
    try { const module = await import(pathToFileURL(copy).href); return await fn(module); } finally { await unlink(copy).catch(() => {}); }
  }
  const UNCHECKED = "async function calendarCompanyMutant(event: any) { const a: any = requireAuth(event); const m = await import('mongoose'); return { auth: a, organizationId: new m.default.Types.ObjectId(String(a.organizationId)) } }";

  // ── C: the statement path end to end ──
  await leg('C statement path: bound account + collector upload → one bill (company A, Term Credit Card, amount, noon due date, issuer-page, linked); same bytes → one; unbound → none → bind wakes it; no date → unresolved → re-upload with date → linked; manual → user-entered; historical batch untouched', async () => {
    const acct = await mkAccount();
    const first = await deliver(acct, { month: '2026-09', total: 2400, paymentDueDate: '2026-09-28' });
    assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.duplicateFile, false); assert.equal(first.data.calendar?.state, 'linked', JSON.stringify(first.data));
    let rows = await ofAccount(acct); assert.equal(rows.length, 1);
    const bill = rows[0];
    assert.equal(String(bill.organizationId), A); assert.equal(bill.category, 'Term Credit Card'); assert.equal(bill.amount, 2400); assert.equal(bill.dueDate.toISOString(), '2026-09-28T12:00:00.000Z'); assert.equal(bill.status, 'pending'); assert.equal(bill.type, 'expense'); assert.equal(bill.currency, 'JPY'); assert.equal(bill.recurring, false);
    assert.equal(bill.source.kind, 'card-statement'); assert.equal(bill.source.provider, 'aplus'); assert.equal(String(bill.source.accountId), acct.id); assert.equal(bill.source.periodKey, period('2026-09').key); assert.equal(bill.source.statementMonth, '2026-09'); assert.equal(bill.source.dueDateEvidence, 'issuer-page'); assert.equal(String(bill.source.importId), first.data.id); assert.equal(bill.source.statementTotal, 2400);
    const batch = await FinanceImport.findById(first.data.id).lean(); assert.equal(batch.calendar.state, 'linked'); assert.equal(String(batch.calendar.paymentId), String(bill._id)); assert.equal(batch.reconciliation.paymentDueDate, '2026-09-28'); assert.equal(batch.reconciliation.version, 2);
    const again = await deliver(acct, { month: '2026-09', total: 2400, paymentDueDate: '2026-09-28' }); assert.equal(again.data.duplicateFile, true); assert.equal((await ofAccount(acct)).length, 1);
    const unbind = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: null } }); assert.equal(unbind.status, 200, JSON.stringify(unbind)); assert.equal(unbind.data.organizationId, null); assert.equal(unbind.data.existingBillsKept, 1);
    assert.equal((await acct.read()).organizationId, undefined);
    const oct = await deliver(acct, { month: '2026-10', total: 3600, paymentDueDate: '2026-10-27' }); assert.equal(oct.status, 200, JSON.stringify(oct)); assert.equal(oct.data.calendar?.state, 'unbound', JSON.stringify(oct.data));
    assert.equal((await ofAccount(acct)).length, 1);
    const bind = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(bind.status, 200, JSON.stringify(bind)); assert.equal(bind.data.organizationId, A); assert.equal(bind.data.woken?.imports, 1, JSON.stringify(bind.data));
    const octBill = await sourced(acct, '2026-10'); assert.ok(octBill, 'October bill not created on bind'); assert.equal(String(octBill.organizationId), A); assert.equal((await FinanceImport.findById(oct.data.id).lean()).calendar.state, 'linked');
    const nov = await deliver(acct, { month: '2026-11', total: 4800 }); assert.equal(nov.status, 200, JSON.stringify(nov)); assert.equal(nov.data.calendar?.state, 'due-date-unresolved', JSON.stringify(nov.data)); assert.equal(await sourced(acct, '2026-11'), null);
    const novAgain = await deliver(acct, { month: '2026-11', total: 4800, paymentDueDate: '2026-11-27' }); assert.equal(novAgain.data.duplicateFile, true); assert.equal(novAgain.data.calendar?.state, 'linked', JSON.stringify(novAgain.data));
    const novBill = await sourced(acct, '2026-11'); assert.ok(novBill); assert.equal(novBill.dueDate.toISOString(), '2026-11-27T12:00:00.000Z'); assert.equal(novBill.source.dueDateEvidence, 'issuer-page');
    const dec = await fin('accounts/' + acct.id + '/imports', { method: 'POST', token: tokenA, body: statementCsv(acct, '2026-12', 6000), type: 'text/csv', query: { kind: 'statement', statementMonth: '2026-12', statementTotal: '6000', paymentDueDate: '2026-12-28' } });
    assert.equal(dec.status, 200, JSON.stringify(dec)); assert.equal(dec.data.calendar?.state, 'linked', JSON.stringify(dec.data)); assert.equal((await sourced(acct, '2026-12')).source.dueDateEvidence, 'user-entered');
    const histBytes = statementCsv(acct, '2025-12', 700, 'hist'); const histParsed = parseAplus(histBytes, acct.cardIdentifiers, { kind: 'statement', statementMonth: '2025-12', statementTotal: 700 });
    await FinanceImport.collection.insertOne({ ownerId: user._id, accountId: acct.account._id, hash: histParsed.sha256, provider: 'aplus', reconciliation: { statementTotal: 700, purchaseTotal: 700, verified: true }, parserVersion: 'aplus-jp-1', period: histParsed.period, rows: histParsed.rows, rowCount: 1, state: 'review', downloadedAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') });
    const hist = await deliver(acct, { month: '2025-12', total: 700, paymentDueDate: '2025-12-27', bytes: histBytes }); assert.equal(hist.status, 200, JSON.stringify(hist)); assert.equal(hist.data.duplicateFile, true); assert.equal(hist.data.calendar, undefined, JSON.stringify(hist.data)); assert.equal(await sourced(acct, '2025-12'), null);
    assert.equal((await FinanceImport.findOne({ hash: histParsed.sha256 }).lean()).calendar, undefined);
    return '4 bills (09 linked, 10 after bind, 11 after date, 12 manual); 2025-12 historical batch untouched';
  });

  // ── C-P3p: preservation across a company change ──
  const p3 = { acct: null, janBill: null };
  await leg('C-P3p preservation: rebind A→B keeps the existing bill in A (count, bytes); re-delivery updates A\'s bill in place; paid → settledAt → third total preserved; newer cycle under B; unbind → unbound; rebind A wakes it; two concurrent first deliveries → one bill; lists per company; non-member 403; same company no-op; deleted bill never recreated', async () => {
    const acct = await mkAccount(); p3.acct = acct;
    const jan = await deliver(acct, { month: '2027-01', total: 1000, paymentDueDate: '2027-01-27' }); assert.equal(jan.data.calendar?.state, 'linked', JSON.stringify(jan.data));
    const before = await sourced(acct, '2027-01');
    const toB = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: B } }); assert.equal(toB.status, 200, JSON.stringify(toB)); assert.equal(toB.data.existingBillsKept, 1); assert.equal(toB.data.changed, true);
    const row = await acct.read(); assert.equal(String(row.organizationId), B); assert.equal(String(row.previousOrganizationId), A); assert.ok(row.organizationBoundAt instanceof Date);
    assert.equal(snap(await sourced(acct, '2027-01')), snap(before), 'A\'s bill changed on rebind');
    const janAgain = await deliver(acct, { month: '2027-01', total: 1100, paymentDueDate: '2027-01-27', salt: 'second' }); assert.equal(janAgain.data.duplicateFile, false); assert.equal(janAgain.data.calendar?.state, 'linked');
    let janBill = await sourced(acct, '2027-01'); assert.equal(janBill.amount, 1100); assert.equal(String(janBill.organizationId), A); assert.equal(janBill.status, 'pending'); assert.equal(janBill.settledAt, undefined); assert.equal(String(janBill._id), String(before._id));
    assert.equal((await Payment.countDocuments({ organizationId: B, 'source.accountId': acct.account._id })), 0, 'a bill appeared under B');
    const paid = await call('/api/payments/' + String(janBill._id), { method: 'PUT', token: tokenA, body: { status: 'paid' } }); assert.equal(paid.status, 200, JSON.stringify(paid)); assert.ok(paid.data.settledAt, 'settledAt not set'); assert.equal(paid.data.source?.kind, 'card-statement', 'the echoed payment carries no source');
    const settled = await sourced(acct, '2027-01'); assert.ok(settled.settledAt instanceof Date);
    const janThird = await deliver(acct, { month: '2027-01', total: 1200, paymentDueDate: '2027-01-27', salt: 'third' }); assert.equal(janThird.data.calendar?.state, 'linked'); assert.equal(janThird.data.calendar.preserved, true); assert.equal(janThird.data.calendar.observed?.amount, 1200);
    assert.equal(snap(await sourced(acct, '2027-01')), snap(settled), 'the paid bill was rewritten'); p3.janBill = settled;
    const feb = await deliver(acct, { month: '2027-02', total: 2000, paymentDueDate: '2027-02-26' }); assert.equal(feb.data.calendar?.state, 'linked', JSON.stringify(feb.data));
    const febBill = await sourced(acct, '2027-02'); assert.equal(String(febBill.organizationId), B);
    const toNull = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: null } }); assert.equal(toNull.status, 200);
    const mar = await deliver(acct, { month: '2027-03', total: 3000, paymentDueDate: '2027-03-29' }); assert.equal(mar.data.calendar?.state, 'unbound'); assert.equal(await sourced(acct, '2027-03'), null);
    const febAgain = await deliver(acct, { month: '2027-02', total: 2100, paymentDueDate: '2027-02-26', salt: 'second' }); assert.equal(febAgain.data.calendar?.state, 'linked'); assert.equal((await sourced(acct, '2027-02')).amount, 2100); assert.equal(String((await sourced(acct, '2027-02')).organizationId), B);
    const toA = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(toA.status, 200, JSON.stringify(toA)); assert.equal(toA.data.woken?.imports, 1);
    const marBill = await sourced(acct, '2027-03'); assert.ok(marBill, '2027-03 not re-linked on bind'); assert.equal(String(marBill.organizationId), A);
    assert.equal(snap(await sourced(acct, '2027-01')), snap(settled)); assert.equal((await sourced(acct, '2027-02')).amount, 2100);
    const fresh = await acct.read();
    const [x, y] = await Promise.all([bills.reconcileBill(ownerId, fresh, evidenceFor('2027-04', 4000, '2027-04-27', { sourceHash: 'a'.repeat(64) }), 'statement-csv'), bills.reconcileBill(ownerId, fresh, evidenceFor('2027-04', 4000, '2027-04-27', { sourceHash: 'b'.repeat(64) }), 'statement-csv')]);
    assert.equal(x.state, 'linked', JSON.stringify(x)); assert.equal(y.state, 'linked', JSON.stringify(y)); assert.equal(String(x.paymentId), String(y.paymentId));
    assert.equal((await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period('2027-04').key })), 1);
    const asA = await call('/api/payments', { token: tokenA }); assert.equal(asA.status, 200, JSON.stringify(asA));
    const mine = asA.data.filter(p => String(p.source?.accountId) === acct.id).map(p => p.source.statementMonth).sort(); assert.deepEqual(mine, ['2027-01', '2027-03', '2027-04']);
    const asB = await call('/api/payments', { token: tokenB }); assert.deepEqual(asB.data.filter(p => String(p.source?.accountId) === acct.id).map(p => p.source.statementMonth), ['2027-02']);
    const nonMember = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: C } }); assert.equal(nonMember.status, 403, JSON.stringify(nonMember)); assert.equal(String((await acct.read()).organizationId), A);
    const same = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(same.status, 200); assert.equal(same.data.changed, false); assert.equal(String((await acct.read()).previousOrganizationId), B);
    const removed = await call('/api/payments/' + String(marBill._id), { method: 'DELETE', token: tokenA }); assert.equal(removed.status, 200, JSON.stringify(removed)); assert.equal(removed.data.suppressed, true);
    const marAgain = await deliver(acct, { month: '2027-03', total: 3100, paymentDueDate: '2027-03-29', salt: 'second' }); assert.equal(marAgain.data.calendar?.state, 'suppressed', JSON.stringify(marAgain.data));
    assert.equal((await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period('2027-03').key })), 1); assert.equal((await sourced(acct, '2027-03')).amount, 3000);
    assert.equal((await call('/api/payments', { token: tokenA })).data.some(p => p.id === String(marBill._id)), false, 'a suppressed bill is listed');
    return 'A keeps 2027-01 (paid, three totals), B holds 2027-02, 2027-03 woken under A then suppressed, 2027-04 once';
  });
  await leg('C-P3p mutant: organizationId added to the in-place update $set moves A\'s bill to B — DETECTED', async () => {
    const acct = await mkAccount();
    await deliver(acct, { month: '2027-05', total: 500, paymentDueDate: '2027-05-27' });
    await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: B } });
    const fresh = await acct.read();
    const honest = await bills.reconcileBill(ownerId, fresh, evidenceFor('2027-05', 550, '2027-05-27', { sourceHash: 'c'.repeat(64) }), 'statement-csv'); assert.equal(honest.state, 'linked'); assert.equal(String((await sourced(acct, '2027-05')).organizationId), A);
    await mutant('server/services/financeBillService.ts', [{ from: 'const set: any = { amount:', to: 'const set: any = { organizationId: company, amount:' }], async m => {
      const r = await m.reconcileBill(ownerId, fresh, evidenceFor('2027-05', 560, '2027-05-27', { sourceHash: 'd'.repeat(64) }), 'statement-csv'); assert.equal(r.state, 'linked');
      assert.equal(String((await sourced(acct, '2027-05')).organizationId), B, 'mutant NOT detected: the bill stayed in A');
    });
    return 'mutant moved the bill; the honest code kept it in A';
  });

  // ── D / D-P1: company scoping of the calendar and the dashboard count, with fresh membership ──
  const user2 = await User.create({ email: 'calendar-second@example.invalid', name: 'Synthetic second owner', password: PASSWORD }); const owner2 = String(user2._id);
  const orgA2 = await mkOrg('Synthetic-A2', [user2._id]), orgB2 = await mkOrg('Synthetic-B2', [user2._id]); const A2 = String(orgA2._id), B2 = String(orgB2._id);
  const t2A = tokenFor(owner2, user2.email, A2), t2B = tokenFor(owner2, user2.email, B2), t2None = tokenFor(owner2, user2.email, null);
  const future = new Date(Date.now() + 30 * 86400000);
  const seeded = { a: null, b: null, untagged: null };
  await leg('D scoping: rows A2/B2/untagged → GET as A2 lists only A2; POST stamps the company; cross-company PUT/DELETE 404; no company 403; non-member company 403; removed member with a still-valid token 403', async () => {
    seeded.a = await Payment.create({ title: 'Synthetic A2 bill', amount: 10, currency: 'JPY', dueDate: future, type: 'expense', status: 'pending', category: 'Utilities', organizationId: A2 });
    seeded.b = await Payment.create({ title: 'Synthetic B2 bill', amount: 20, currency: 'JPY', dueDate: future, type: 'expense', status: 'pending', category: 'Utilities', organizationId: B2 });
    seeded.untagged = await Payment.create({ title: 'Synthetic untagged bill', amount: 30, currency: 'JPY', dueDate: new Date(future.getTime() + 3600000), type: 'expense', status: 'pending', category: 'Utilities' });
    const asA = await call('/api/payments', { token: t2A }); assert.equal(asA.status, 200, JSON.stringify(asA)); assert.deepEqual(asA.data.map(p => p.title), ['Synthetic A2 bill']);
    const asB = await call('/api/payments', { token: t2B }); assert.deepEqual(asB.data.map(p => p.title), ['Synthetic B2 bill']);
    const created = await call('/api/payments', { method: 'POST', token: t2A, body: { title: 'Synthetic posted', amount: 5, dueDate: '2027-06-01', type: 'expense', category: 'Rent' } }); assert.equal(created.status, 200, JSON.stringify(created)); assert.equal(created.data.organizationId, A2); assert.equal(created.data.dueDate, '2027-06-01T12:00:00.000Z');
    assert.equal((await call('/api/payments/' + String(seeded.b._id), { method: 'PUT', token: t2A, body: { amount: 21 } })).status, 404); assert.equal((await Payment.findById(seeded.b._id).lean()).amount, 20);
    assert.equal((await call('/api/payments/' + String(seeded.b._id), { method: 'DELETE', token: t2A })).status, 404); assert.ok(await Payment.findById(seeded.b._id));
    assert.equal((await call('/api/payments/' + String(seeded.b._id), { token: t2A })).status, 404);
    assert.equal((await call('/api/payments/' + String(seeded.a._id), { token: t2A })).status, 200);
    assert.equal((await call('/api/payments', { token: t2None })).status, 403);
    assert.equal((await call('/api/payments', { token: tokenFor(owner2, user2.email, A) })).status, 403, 'a company the user is not a member of');
    await removeMember(A2, user2._id);
    assert.equal((await call('/api/payments', { token: t2A })).status, 403, 'removed member still lists');
    assert.equal((await call('/api/payments/' + String(seeded.a._id), { method: 'PUT', token: t2A, body: { amount: 11 } })).status, 403, 'removed member still edits');
    assert.equal((await call('/api/payments', { method: 'POST', token: t2A, body: { title: 'x', amount: 1, dueDate: '2027-06-01', type: 'expense', category: 'Rent' } })).status, 403);
    await addMember(A2, user2._id);
    assert.equal((await call('/api/payments', { token: t2A })).status, 200);
    return 'A2 sees 1 (+1 posted), B2 sees 1, untagged hidden, 404/403 as planned';
  });
  await leg('D mutants: payments/index.ts without the company filter lists every row; index/[id] routes with the fresh check removed answer a removed member 200; [id].ts without the company scope edits B2\'s row — each DETECTED', async () => {
    await mutant('server/api/payments/index.ts', [{ marker: 'company-filter' }], async m => {
      const alt = await mount({ paymentsIndex: m.default }); const r = await callAt(alt, '/api/payments', { token: t2A }); assert.equal(r.status, 200);
      assert.ok(r.data.length >= 3 && r.data.some(p => p.title === 'Synthetic B2 bill'), 'mutant NOT detected: the filter mutant still scoped');
    });
    await removeMember(A2, user2._id);
    try {
      await mutant('server/api/payments/index.ts', [{ from: 'await calendarCompany(event)', to: 'await calendarCompanyMutant(event)', append: UNCHECKED }], async m => {
        const alt = await mount({ paymentsIndex: m.default }); assert.equal((await callAt(alt, '/api/payments', { token: t2A })).status, 200, 'mutant NOT detected: index still 403');
      });
      await mutant('server/api/payments/[id].ts', [{ from: 'await calendarCompany(event)', to: 'await calendarCompanyMutant(event)', append: UNCHECKED }], async m => {
        const alt = await mount({ paymentsId: m.default }); assert.equal((await callAt(alt, '/api/payments/' + String(seeded.a._id), { token: t2A })).status, 200, 'mutant NOT detected: [id] still 403');
      });
    } finally { await addMember(A2, user2._id); }
    await mutant('server/api/payments/[id].ts', [{ from: '_id: id, organizationId, suppressedAt', to: '_id: id, suppressedAt' }], async m => {
      const alt = await mount({ paymentsId: m.default }); const r = await callAt(alt, '/api/payments/' + String(seeded.b._id), { method: 'PUT', token: t2A, body: { amount: 22 } }); assert.equal(r.status, 200, 'mutant NOT detected: cross-company PUT still 404');
      await Payment.updateOne({ _id: seeded.b._id }, { $set: { amount: 20 } });
    });
    return '4 mutants detected';
  });
  await leg('D-P1 dashboard: upcomingPaymentsCount as A2 = 1, as B2 = 1, no company = 0, removed member = 0 (fresh); mutants without the company count line / with the fresh check removed count 3 / 1 — DETECTED', async () => {
    await Payment.deleteMany({ title: 'Synthetic posted' });
    const count = async (token, base = origin) => { const r = await callAt(base, '/api/dashboard/stats', { token }); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.stats.upcomingPaymentsCount; };
    assert.equal(await count(t2A), 1); assert.equal(await count(t2B), 1); assert.equal(await count(t2None), 0);
    await removeMember(A2, user2._id); assert.equal(await count(t2A), 0, 'removed member still counts'); await addMember(A2, user2._id);
    // The honest no-company count is 0; the mutant counts every company's pending future rows (the three seeded here plus
    // the earlier legs' bills), so detection is "at least the three seeded rows", never 0.
    await mutant('server/api/dashboard/stats.ts', [{ marker: 'company-count' }], async m => { const alt = await mount({ stats: m.default }); const n = await count(t2None, alt); assert.ok(n >= 3, 'mutant NOT detected: no-company count ' + n); });
    await removeMember(A2, user2._id);
    try { await mutant('server/api/dashboard/stats.ts', [{ from: 'await calendarCompany(event)', to: 'await calendarCompanyMutant(event)', append: UNCHECKED }], async m => { const alt = await mount({ stats: m.default }); assert.equal(await count(t2A, alt), 1, 'mutant NOT detected: removed member count'); }); }
    finally { await addMember(A2, user2._id); }
    return 'counts 1/1/0/0; 2 mutants detected';
  });
  await leg('B4 guard direct: calendarCompany answers a member, refuses no company, a foreign company and a removed member (403); the mutant without the membership read admits the removed member — DETECTED', async () => {
    const eventFor = token => ({ context: { auth: { ...jwt.verify(token, process.env.JWT_SECRET), isAuthenticated: true } } });
    const ok = await access.calendarCompany(eventFor(t2A)); assert.equal(String(ok.organizationId), A2);
    for (const [token, label] of [[t2None, 'no company'], [tokenFor(owner2, user2.email, A), 'foreign company']]) await assert.rejects(access.calendarCompany(eventFor(token)), e => e.statusCode === 403, label);
    await removeMember(A2, user2._id);
    try {
      await assert.rejects(access.calendarCompany(eventFor(t2A)), e => e.statusCode === 403, 'removed member');
      await mutant('server/utils/calendarAccess.ts', [{ marker: 'fresh-membership' }], async m => { const r = await m.calendarCompany(eventFor(t2A)); assert.equal(String(r.organizationId), A2, 'mutant NOT detected'); });
    } finally { await addMember(A2, user2._id); }
    return 'member ok, 3 refusals, mutant detected';
  });

  // ── N2: the real paid bill, the notice and the CSV in both orders ──
  let realBytes = null, realTotal = null;
  if (REAL_CSV) {
    realBytes = await readFile(REAL_CSV);
    const { csvRows } = await import(u('shared/amex.mjs'));
    const table = csvRows(realBytes.toString('utf8').replace(/^﻿/, '')); table.shift();
    realTotal = table.reduce((n, cells) => n + (String(cells[7] || '').trim() === '' ? 0 : Number(String(cells[7]).replace(/,/g, ''))), 0);
  }
  const T = realTotal ?? 1234560;
  // The recorded CSV goes to the one account that carries its card suffixes; every other September statement is synthetic.
  const septemberCsv = acct => (realBytes && acct.cardIdentifiers.length > 1 ? realBytes : statementCsv(acct, '2026-09', T, 'september'));
  const seedPaid = async (organizationId = A) => Payment.create({ title: 'アプラス', amount: T, currency: 'JPY', dueDate: noon('2026-09-28'), type: 'expense', status: 'paid', category: 'Term Credit Card', recurring: false, organizationId, settledAt: undefined });
  await leg('N2 real paid bill (' + (REAL_CSV ? 'recorded September CSV via OMF_APLUS_REAL_CSV' : 'synthetic September statement; OMF_APLUS_REAL_CSV unset') + ', F1 intended change): the brand-titled paid row is NOT adopted by the notice alone (identity unverified) → review naming it, count and row unchanged; the member\'s explicit link adopts it changing nothing but source; the CSV then preserves it byte for byte; reverse order (CSV → review, the notice link completes both); duplicate notice; notice + CSV concurrently → one bill; changed body → versions 2, review', async () => {
    const acct = await mkAccount({ cards: realCards });
    const paidRow = await seedPaid(); const before = await Payment.findById(paidRow._id).lean();
    const countBefore = await Payment.countDocuments({ organizationId: A });
    const notice = await sendNotice(acct, aplusConfirmation({ year: 2026, month: 9, day: 28, amount: T }));
    assert.equal(notice.status, 200, JSON.stringify(notice)); assert.equal(notice.data.duplicate, false); assert.equal(notice.data.calendar?.state, 'review', 'a brand-titled row was taken as this account\'s: ' + JSON.stringify(notice.data)); assert.equal(notice.data.calendar.reason, 'candidates'); assert.deepEqual(notice.data.calendar.candidates.map(String), [String(paidRow._id)]);
    assert.equal(snap(await Payment.findById(paidRow._id).lean()), snap(before), 'the paid row changed in review'); assert.equal(await Payment.countDocuments({ organizationId: A }), countBefore, 'payment count changed in review');
    const linked = await fin('notices/' + notice.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(paidRow._id) } }); assert.equal(linked.status, 200, JSON.stringify(linked)); assert.equal(linked.data.calendar.state, 'linked'); assert.equal(linked.data.calendar.preserved, true); assert.equal(String(linked.data.calendar.paymentId), String(paidRow._id));
    assert.equal(await Payment.countDocuments({ organizationId: A }), countBefore, 'payment count changed');
    const adopted = await Payment.findById(paidRow._id).lean(); assert.equal(adopted.source.adopted, true); assert.equal(adopted.source.kind, 'card-statement'); assert.equal(String(adopted.source.accountId), acct.id); assert.equal(adopted.source.periodKey, period('2026-09').key); assert.equal(adopted.source.dueDateEvidence, 'issuer-mail'); assert.equal(String(adopted.source.linkedBy), ownerId);
    assert.equal(snap(withoutSource(adopted)), snap(withoutSource(before)), 'the paid row changed beyond source');
    assert.equal(adopted.amount, T); assert.equal(adopted.status, 'paid');
    const csv = await deliver(acct, { month: '2026-09', total: T, paymentDueDate: '2026-09-28', bytes: septemberCsv(acct) });
    assert.equal(csv.status, 200, JSON.stringify(csv)); assert.equal(csv.data.calendar?.state, 'linked'); assert.equal(csv.data.calendar.preserved, true); assert.equal(String(csv.data.calendar.paymentId), String(paidRow._id));
    assert.equal(snap(await Payment.findById(paidRow._id).lean()), snap(adopted), 'the CSV changed the paid row');
    assert.equal(await Payment.countDocuments({ organizationId: A }), countBefore);
    // reverse order on a second account: the CSV alone is review too; the notice for the same cycle is linked by the member and that one action also completes the waiting CSV batch (F3)
    const acct2 = await mkAccount({ organizationId: B }); const paid2 = await seedPaid(B); const before2 = await Payment.findById(paid2._id).lean();
    const csv2 = await deliver(acct2, { month: '2026-09', total: T, paymentDueDate: '2026-09-28', bytes: septemberCsv(acct2) }); assert.equal(csv2.data.calendar?.state, 'review', JSON.stringify(csv2.data)); assert.deepEqual(csv2.data.calendar.candidates.map(String), [String(paid2._id)]); assert.equal((await Payment.findById(paid2._id).lean()).source, undefined);
    const mail2 = aplusConfirmation({ year: 2026, month: 9, day: 28, amount: T });
    const n2 = await sendNotice(acct2, mail2); assert.equal(n2.data.calendar?.state, 'review');
    const linked2 = await fin('notices/' + n2.data.id + '/link', { method: 'PUT', token: tokenB, body: { paymentId: String(paid2._id) } }); assert.equal(linked2.status, 200, JSON.stringify(linked2)); assert.equal(linked2.data.calendar.state, 'linked'); assert.equal(linked2.data.calendar.preserved, true);
    const adopted2 = await Payment.findById(paid2._id).lean(); assert.equal(adopted2.source.adopted, true); assert.equal(snap(withoutSource(adopted2)), snap(withoutSource(before2)));
    const batch2 = await FinanceImport.findById(csv2.data.id).lean(); assert.equal(batch2.calendar.state, 'linked', 'the waiting CSV batch was not completed by the link: ' + JSON.stringify(batch2.calendar)); assert.equal(String(batch2.calendar.paymentId), String(paid2._id));
    const dup = await sendNotice(acct2, mail2); assert.equal(dup.status, 200, JSON.stringify(dup)); assert.equal(dup.data.duplicate, true); assert.equal(dup.data.calendar.state, 'linked'); assert.equal(await FinanceNotice.countDocuments({ accountId: acct2.account._id }), 1);
    // notice and CSV concurrently on a third account with no row at all → one bill
    const acct3 = await mkAccount();
    const fresh3 = await acct3.read(); const mail3 = aplusConfirmation({ year: 2026, month: 9, day: 28, amount: T });
    const [viaMail, viaCsv] = await Promise.all([bills.recordBillingNotice(ownerId, fresh3, artifact(mail3, { mailbox: acct3.mailbox }), acct3.collectorId), bills.reconcileBill(ownerId, fresh3, evidenceFor('2026-09', T, '2026-09-28', { sourceHash: 'e'.repeat(64) }), 'statement-csv')]);
    assert.equal(viaMail.calendar?.state, 'linked', JSON.stringify(viaMail)); assert.equal(viaCsv.state, 'linked', JSON.stringify(viaCsv)); assert.equal(String(viaMail.calendar.paymentId), String(viaCsv.paymentId));
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct3.account._id }), 1);
    // the same mailId with a changed body → versions 2, review, first claims kept
    const changed = await sendNotice(acct3, { ...mail3, text: mail3.text.replace(jpAmount(T) + '円', jpAmount(T + 1) + '円') });
    assert.equal(changed.status, 200, JSON.stringify(changed)); assert.equal(changed.data.changed, true); assert.equal(changed.data.calendar?.state, 'review'); assert.equal(changed.data.calendar.reason, 'changed-body');
    const stored = await FinanceNotice.findOne({ accountId: acct3.account._id, mailId: mail3.id }).lean(); assert.equal(stored.versions.length, 2); assert.equal(stored.claims.amount, T); assert.equal(stored.bodySha256, sha256(mail3.text.replace(/\r/g, '')));
    assert.equal((await Payment.findOne({ 'source.accountId': acct3.account._id }).lean()).amount, T, 'the changed body rewrote the bill');
    return 'paid row: review → explicit link → preserved both ways (amount ' + (REAL_CSV ? 'from the recorded CSV' : 'synthetic') + '); the link completed the waiting CSV; 1 notice row after the duplicate; concurrent → 1 bill; changed body → review';
  });
  await leg('F1/B2 two Aplus parent accounts in one company: a generic アプラス row with the matching amount and date is adopted by neither account\'s mail nor CSV (review for both; row, count and settlement unchanged); the member\'s explicit link assigns it to one account; the other account then gets its own bill', async () => {
    const p = await mkAccount(), q = await mkAccount(); const month = '2028-10', due = '2028-10-27';
    const generic = await Payment.create({ title: 'アプラス', amount: 9900, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'paid', category: 'Term Credit Card', recurring: false, organizationId: A, settledAt: new Date() });
    const before = snap(await Payment.findById(generic._id).lean()); const count = await Payment.countDocuments({ organizationId: A });
    const viaMail = await sendNotice(p, aplusConfirmation({ year: 2028, month: 10, day: 27, amount: 9900 })); assert.equal(viaMail.status, 200, JSON.stringify(viaMail)); assert.equal(viaMail.data.calendar?.state, 'review', 'the mail assigned the generic row: ' + JSON.stringify(viaMail.data)); assert.deepEqual(viaMail.data.calendar.candidates.map(String), [String(generic._id)]);
    const viaCsv = await deliver(q, { month, total: 9900, paymentDueDate: due }); assert.equal(viaCsv.status, 200, JSON.stringify(viaCsv)); assert.equal(viaCsv.data.calendar?.state, 'review', 'the CSV assigned the generic row: ' + JSON.stringify(viaCsv.data)); assert.deepEqual(viaCsv.data.calendar.candidates.map(String), [String(generic._id)]);
    assert.equal(snap(await Payment.findById(generic._id).lean()), before, 'the generic row changed'); assert.equal(await Payment.countDocuments({ organizationId: A }), count); assert.equal(await sourced(p, month), null); assert.equal(await sourced(q, month), null);
    const link = await fin('notices/' + viaMail.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(generic._id) } }); assert.equal(link.status, 200, JSON.stringify(link)); assert.equal(link.data.calendar.state, 'linked'); assert.equal(link.data.calendar.preserved, true);
    const assigned = await Payment.findById(generic._id).lean(); assert.equal(String(assigned.source.accountId), p.id); assert.equal(assigned.amount, 9900); assert.equal(assigned.status, 'paid'); assert.equal(snap(withoutSource(assigned)), snap(withoutSource(JSON.parse(before))));
    const again = await deliver(q, { month, total: 9900, paymentDueDate: due }); assert.equal(again.data.duplicateFile, true); assert.equal(again.data.calendar?.state, 'linked', JSON.stringify(again.data));
    const own = await sourced(q, month); assert.ok(own, 'the other account got no bill of its own'); assert.notEqual(String(own._id), String(generic._id)); assert.equal(own.status, 'pending'); assert.equal(await Payment.countDocuments({ organizationId: A }), count + 1);
    return 'review for both accounts; linked to one by the member; the other created its own';
  });
  await leg('F2/B6 crash after the Amex enqueue and before the receipt: the pending notice carries a durable intent; the collector completes that job; the retry records the SAME job (recovered) and queues no other; a crash before the enqueue → the retry queues exactly one job', async () => {
    const acct = await mkAccount();
    const amex = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex F2', provider: 'amex', primaryCard: '66009', cardIdentifiers: ['66009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const pair = await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex F2 PC', accountIds: [String(amex._id)] } }); assert.equal(pair.status, 200);
    // (1) the crash state as the durable record leaves it: the notice stored pending with its intent, the job enqueued, then completed by the collector
    const mail = amexConfirmation({ suffix: '66009', digits: 5 }); const art = artifact(mail, { mailbox: acct.mailbox });
    const intentAt = new Date();
    await FinanceNotice.create({ ownerId, accountId: acct.account._id, organizationId: A, mailId: art.mailId, threadId: art.threadId, mailbox: acct.mailbox, issuer: 'amex', kind: 'bill-ready', subject: art.subject, from: art.from, internalDate: new Date(art.internalDate), bodySha256: art.bodySha256, authentication: art.authentication, parserVersion: art.parserVersion, claims: art.claims, versions: [{ bodySha256: art.bodySha256, receivedAt: intentAt }], collectorId: acct.collectorId, calendar: { state: 'pending', intent: { targetAccountId: amex._id, at: intentAt }, at: intentAt }, attempts: 0 });
    const queued = await service.queueSync(ownerId, await FinancialAccount.findById(amex._id).lean()); const jobId = queued.jobId;
    await FinancialAccount.updateOne({ _id: amex._id }, { $set: { jobState: 'complete', lastAttemptAt: new Date() } });
    const retry = await sendNotice(acct, mail); assert.equal(retry.status, 200, JSON.stringify(retry)); assert.equal(retry.data.duplicate, true); assert.equal(retry.data.calendar?.state, 'queued', JSON.stringify(retry.data)); assert.equal(retry.data.calendar.jobId, jobId, 'the retry named another job: ' + JSON.stringify(retry.data.calendar)); assert.equal(retry.data.calendar.recovered, true);
    const after = await FinancialAccount.findById(amex._id).lean(); assert.equal(after.jobId, jobId, 'another job was queued'); assert.equal(after.jobState, 'complete');
    // (2) the same crash produced by the code itself: the enqueue succeeds, the receipt write is cut off → the intent is on the notice
    const mail2 = amexConfirmation({ suffix: '66009', digits: 5 });
    await assert.rejects(bills.recordBillingNotice(ownerId, await acct.read(), artifact(mail2, { mailbox: acct.mailbox }), acct.collectorId, { hooks: { afterQueue: async () => { throw new Error('synthetic crash after enqueue'); } } }), /synthetic crash after enqueue/);
    const row2 = await FinancialAccount.findById(amex._id).lean(); assert.equal(row2.jobState, 'queued'); assert.notEqual(row2.jobId, jobId); const job2 = row2.jobId;
    const pending2 = await FinanceNotice.findOne({ accountId: acct.account._id, mailId: mail2.id }).lean(); assert.equal(pending2.calendar.state, 'pending'); assert.ok(pending2.calendar.intent?.at, 'no durable intent before the enqueue');
    await FinancialAccount.updateOne({ _id: amex._id }, { $set: { jobState: 'complete', lastAttemptAt: new Date() } });
    const retry2 = await sendNotice(acct, mail2); assert.equal(retry2.data.calendar?.state, 'queued'); assert.equal(retry2.data.calendar.jobId, job2); assert.equal(retry2.data.calendar.recovered, true); assert.equal((await FinancialAccount.findById(amex._id).lean()).jobId, job2);
    // (3) a crash after the intent but before the enqueue: the retry queues exactly one new job
    const mail3 = amexConfirmation({ suffix: '66009', digits: 5 });
    await assert.rejects(bills.recordBillingNotice(ownerId, await acct.read(), artifact(mail3, { mailbox: acct.mailbox }), acct.collectorId, { hooks: { afterIntent: async () => { throw new Error('synthetic crash before enqueue'); } } }), /before enqueue/);
    assert.equal((await FinancialAccount.findById(amex._id).lean()).jobId, job2, 'a job was queued before the crash point');
    const retry3 = await sendNotice(acct, mail3); assert.equal(retry3.data.calendar?.state, 'queued', JSON.stringify(retry3.data)); assert.notEqual(retry3.data.calendar.jobId, job2); assert.equal(retry3.data.calendar.recovered, undefined); assert.equal((await FinancialAccount.findById(amex._id).lean()).jobId, retry3.data.calendar.jobId);
    return 'seeded crash → same job ' + jobId.slice(0, 8) + '; code-produced crash → same job; crash before enqueue → one new job';
  });
  await leg('F3/B6 a CSV and a notice of one cycle both waiting on the same candidate choice: the member\'s one link completes both durable records with one bill; a sibling cycle\'s review batch and another account\'s review for the same month are untouched', async () => {
    const acct = await mkAccount(), other = await mkAccount(); const month = '2028-11', due = '2028-11-27';
    const c1 = await Payment.create({ title: 'アプラス', amount: 1500, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const c2 = await Payment.create({ title: 'アプラス 予測', amount: 1550, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const csv = await deliver(acct, { month, total: 1500, paymentDueDate: due }); assert.equal(csv.data.calendar?.state, 'review', JSON.stringify(csv.data));
    const notice = await sendNotice(acct, aplusConfirmation({ year: 2028, month: 11, day: 27, amount: 1500 })); assert.equal(notice.data.calendar?.state, 'review');
    await Payment.create({ title: 'アプラス', amount: 1600, currency: 'JPY', dueDate: noon('2028-12-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const sibling = await deliver(acct, { month: '2028-12', total: 1600, paymentDueDate: '2028-12-27' }); assert.equal(sibling.data.calendar?.state, 'review');
    const otherCsv = await deliver(other, { month, total: 1500, paymentDueDate: due }); assert.equal(otherCsv.data.calendar?.state, 'review');
    const link = await fin('notices/' + notice.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(c1._id) } }); assert.equal(link.status, 200, JSON.stringify(link)); assert.equal(link.data.calendar.state, 'linked'); assert.equal(link.data.woken?.imports, 1, 'the waiting CSV was not completed: ' + JSON.stringify(link.data));
    const batch = await FinanceImport.findById(csv.data.id).lean(); assert.equal(batch.calendar.state, 'linked', JSON.stringify(batch.calendar)); assert.equal(String(batch.calendar.paymentId), String(c1._id));
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period(month).key }), 1); assert.equal((await Payment.findById(c2._id).lean()).source, undefined); assert.equal((await Payment.findById(c1._id).lean()).amount, 1500);
    assert.equal((await FinanceImport.findById(sibling.data.id).lean()).calendar.state, 'review', 'the sibling cycle was woken'); assert.equal((await FinanceImport.findById(otherCsv.data.id).lean()).calendar.state, 'review', 'another account\'s batch was woken');
    return 'one link → notice and CSV both linked to ' + String(c1._id).slice(-6) + '; sibling cycle and other account untouched';
  });
  await leg('F1/F2/F3 mutants: brand-only rows counted as verified identity adopt the generic row; the intent recovery removed queues a second Amex job; the cycle wake removed leaves the CSV in review — each DETECTED', async () => {
    const acct = await mkAccount(); const fresh = await acct.read();
    const generic = await Payment.create({ title: 'アプラス', amount: 4400, currency: 'JPY', dueDate: noon('2029-01-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const honest = await bills.reconcileBill(ownerId, fresh, evidenceFor('2029-01', 4400, '2029-01-27'), 'issuer-mail'); assert.equal(honest.state, 'review'); assert.equal((await Payment.findById(generic._id).lean()).source, undefined);
    await mutant('server/services/financeBillService.ts', [{ from: 'const verified = rows.filter(verifiedFor)', to: 'const verified = rows.filter(providerMatch)' }], async m => {
      const r = await m.reconcileBill(ownerId, fresh, evidenceFor('2029-01', 4400, '2029-01-27'), 'issuer-mail'); assert.equal(r.state, 'linked', 'mutant NOT detected (F1): ' + JSON.stringify(r)); assert.equal(r.adopted, true);
    });
    await Payment.updateOne({ _id: generic._id }, { $unset: { source: '' } });
    const amex = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex mutant', provider: 'amex', primaryCard: '77009', cardIdentifiers: ['77009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex mutant PC', accountIds: [String(amex._id)] } });
    const seedCrash = async mail => { const art = artifact(mail, { mailbox: acct.mailbox }); const intentAt = new Date(); await FinanceNotice.create({ ownerId, accountId: acct.account._id, organizationId: A, mailId: art.mailId, threadId: art.threadId, mailbox: acct.mailbox, issuer: 'amex', kind: 'bill-ready', subject: art.subject, from: art.from, internalDate: new Date(art.internalDate), bodySha256: art.bodySha256, authentication: art.authentication, parserVersion: art.parserVersion, claims: art.claims, versions: [{ bodySha256: art.bodySha256, receivedAt: intentAt }], collectorId: acct.collectorId, calendar: { state: 'pending', intent: { targetAccountId: amex._id, at: intentAt }, at: intentAt }, attempts: 0 }); const queued = await service.queueSync(ownerId, await FinancialAccount.findById(amex._id).lean()); await FinancialAccount.updateOne({ _id: amex._id }, { $set: { jobState: 'complete', lastAttemptAt: new Date() } }); return { art, jobId: queued.jobId }; };
    const h = await seedCrash(amexConfirmation({ suffix: '77009', digits: 5 }));
    const honest2 = await bills.recordBillingNotice(ownerId, fresh, h.art, acct.collectorId); assert.equal(honest2.calendar.jobId, h.jobId); assert.equal(honest2.calendar.recovered, true);
    const mm = await seedCrash(amexConfirmation({ suffix: '77009', digits: 5 }));
    await mutant('server/services/financeBillService.ts', [{ marker: 'intent-recovery' }], async m => {
      const r = await m.recordBillingNotice(ownerId, fresh, mm.art, acct.collectorId); assert.equal(r.calendar.state, 'queued'); assert.notEqual(r.calendar.jobId, mm.jobId, 'mutant NOT detected (F2): the same job was kept');
    });
    const c1 = await Payment.create({ title: 'アプラス', amount: 4500, currency: 'JPY', dueDate: noon('2029-02-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const c2 = await Payment.create({ title: 'アプラス 予測', amount: 4550, currency: 'JPY', dueDate: noon('2029-02-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const csv = await deliver(acct, { month: '2029-02', total: 4500, paymentDueDate: '2029-02-27' }); assert.equal(csv.data.calendar?.state, 'review');
    const notice = await sendNotice(acct, aplusConfirmation({ year: 2029, month: 2, day: 27, amount: 4500 })); assert.equal(notice.data.calendar?.state, 'review');
    await mutant('server/services/financeBillService.ts', [{ from: 'const woken = await wakeCycleWork(ownerId, account, evidence.periodKey, evidence.statementMonth, notice._id)', to: 'const woken = { imports: 0, notices: 0 }' }], async m => {
      const r = await m.linkNotice(ownerId, notice.data.id, { paymentId: String(c1._id) }); assert.equal(r.calendar.state, 'linked');
      assert.equal((await FinanceImport.findById(csv.data.id).lean()).calendar.state, 'review', 'mutant NOT detected (F3): the CSV was completed');
    });
    assert.equal((await Payment.findById(c2._id).lean()).source, undefined);
    return '3 mutants detected';
  });
  // ── S11-F1a (replaces N2b): the ambiguity is recovered by the product — the claim does not cover it, the real re-delivery
  // re-evaluates it once the configuration is corrected, and the rendered retry action does the same for a stored notice ──
  await leg('S11-F1a Aplus shared mailbox: two accounts reading one mailbox → review (ambiguous-account), NOT covered by the claim, a re-delivery while still shared stays a truthful hold with no bill; after the other account stops reading that mailbox the next real re-delivery links exactly once and the claim then covers it; a second stored notice recovers through the explicit retry action, which also stays a hold while still ambiguous', async () => {
    const one = await mkAccount({ mailbox: 'shared-a@example.invalid' }), two = await mkAccount({ mailbox: 'shared-a@example.invalid' });
    const mail = aplusConfirmation({ year: 2030, month: 6, day: 27, amount: 61 });
    const r = await sendNotice(one, mail); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.calendar?.state, 'review'); assert.equal(r.data.calendar.reason, 'ambiguous-account'); assert.equal(await sourced(one, '2030-06'), null);
    const c1 = await claimJob(one); assert.equal(c1.covered.notices.includes(mail.id), false, 'an ambiguous-account notice is covered (no product recovery): ' + JSON.stringify(c1.covered)); await finishJob(one, c1.jobId);
    const still = await sendNotice(one, mail); assert.equal(still.data.duplicate, true); assert.equal(still.data.calendar?.state, 'review', JSON.stringify(still.data)); assert.equal(still.data.calendar.reason, 'ambiguous-account'); assert.equal(await sourced(one, '2030-06'), null, 'a still-ambiguous notice produced a bill');
    await fin('accounts/' + two.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: false, mailbox: 'shared-a@example.invalid' } });
    const again = await sendNotice(one, mail); assert.equal(again.data.duplicate, true); assert.equal(again.data.calendar?.state, 'linked', 'the corrected configuration did not recover the notice: ' + JSON.stringify(again.data));
    const bill = await sourced(one, '2030-06'); assert.ok(bill); assert.equal(bill.amount, 61); assert.equal(String(bill.organizationId), A);
    const once = await sendNotice(one, mail); assert.equal(once.data.calendar.state, 'linked'); assert.equal(await Payment.countDocuments({ 'source.accountId': one.account._id, 'source.periodKey': period('2030-06').key }), 1);
    const c2 = await claimJob(one); assert.equal(c2.covered.notices.includes(mail.id), true, 'a linked notice is not covered'); await finishJob(one, c2.jobId);
    await fin('accounts/' + two.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: true, mailbox: 'shared-a@example.invalid' } });
    const mail2 = aplusConfirmation({ year: 2030, month: 7, day: 27, amount: 62 });
    const r2 = await sendNotice(one, mail2); assert.equal(r2.data.calendar?.reason, 'ambiguous-account');
    const hold = await fin('notices/' + r2.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } }); assert.equal(hold.status, 200, 'the retry action is refused for an ambiguous notice: ' + JSON.stringify(hold)); assert.equal(hold.data.calendar.state, 'review'); assert.equal(hold.data.calendar.reason, 'ambiguous-account'); assert.equal(await sourced(one, '2030-07'), null, 'a retry while still ambiguous produced a bill');
    await fin('accounts/' + two.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: false, mailbox: 'shared-a@example.invalid' } });
    const retried = await fin('notices/' + r2.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } }); assert.equal(retried.status, 200, JSON.stringify(retried)); assert.equal(retried.data.calendar.state, 'linked'); assert.ok(await sourced(one, '2030-07'));
    assert.equal((await FinanceNotice.findById(r2.data.id).lean()).action?.kind, 'retry');
    return 'hold while shared (not covered, re-delivery and retry both hold), linked once after the correction, covered after';
  });
  await leg('S11-F1b Amex multi-match: a 4-digit suffix matching two Amex accounts → review (ambiguous-account) with no job, not covered; after the owner corrects one account\'s card through the existing PATCH route, the real re-delivery queues exactly one intended job; a stored notice older than the mail look-back recovers through the retry action', async () => {
    const acct = await mkAccount();
    const m1 = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex M1', provider: 'amex', primaryCard: '88019', cardIdentifiers: ['88019'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const m2 = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex M2', provider: 'amex', primaryCard: '98019', cardIdentifiers: ['98019'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const pair = await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex M PC', accountIds: [String(m1._id), String(m2._id)] } }); assert.equal(pair.status, 200);
    const mail = amexConfirmation({ suffix: '8019', digits: 4 });
    const r = await sendNotice(acct, mail); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.calendar?.state, 'review', JSON.stringify(r.data)); assert.equal(r.data.calendar.reason, 'ambiguous-account');
    for (const a of [m1, m2]) assert.equal((await FinancialAccount.findById(a._id).lean()).jobState, 'idle', 'a job was queued on an ambiguous match');
    const c1 = await claimJob(acct); assert.equal(c1.covered.notices.includes(mail.id), false, 'an ambiguous Amex notice is covered'); await finishJob(acct, c1.jobId);
    const patched = await fin('accounts/' + String(m2._id), { method: 'PATCH', token: tokenA, body: { name: 'Synthetic Amex M2', cardIdentifiers: ['98029'], primaryCard: '98029', otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' } }); assert.equal(patched.status, 200, JSON.stringify(patched));
    const again = await sendNotice(acct, mail); assert.equal(again.data.duplicate, true); assert.equal(again.data.calendar?.state, 'queued', 'the corrected configuration did not recover the Amex notice: ' + JSON.stringify(again.data)); assert.equal(String(again.data.calendar.targetAccountId), String(m1._id));
    const queued = await FinancialAccount.findById(m1._id).lean(); assert.equal(queued.jobState, 'queued'); assert.equal(queued.jobId, again.data.calendar.jobId); assert.equal((await FinancialAccount.findById(m2._id).lean()).jobState, 'idle');
    const once = await sendNotice(acct, mail); assert.equal(once.data.calendar.state, 'queued'); assert.equal(once.data.calendar.jobId, queued.jobId); assert.equal((await FinancialAccount.findById(m1._id).lean()).jobId, queued.jobId, 'a second job was queued');
    const c2 = await claimJob(acct); assert.equal(c2.covered.notices.includes(mail.id), true); await finishJob(acct, c2.jobId);
    const m3 = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex M3', provider: 'amex', primaryCard: '77039', cardIdentifiers: ['77039'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const m4 = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex M4', provider: 'amex', primaryCard: '87039', cardIdentifiers: ['87039'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    assert.equal((await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex M PC 2', accountIds: [String(m3._id), String(m4._id)] } })).status, 200);
    const old = amexConfirmation({ suffix: '7039', digits: 4 }); old.internalDate = String(Date.now() - 70 * 86400000);
    const r3 = await sendNotice(acct, old); assert.equal(r3.data.calendar?.reason, 'ambiguous-account');
    assert.equal((await fin('accounts/' + String(m4._id), { method: 'PATCH', token: tokenA, body: { name: 'Synthetic Amex M4', cardIdentifiers: ['87049'], primaryCard: '87049', otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' } })).status, 200);
    const retried = await fin('notices/' + r3.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } }); assert.equal(retried.status, 200, 'the retry action is refused for an ambiguous bill-ready notice: ' + JSON.stringify(retried)); assert.equal(retried.data.calendar.state, 'queued'); assert.equal(String(retried.data.calendar.targetAccountId), String(m3._id));
    assert.equal((await FinancialAccount.findById(m3._id).lean()).jobState, 'queued'); assert.equal((await FinancialAccount.findById(m4._id).lean()).jobState, 'idle');
    return 'ambiguous → hold, no job; PATCH corrected → one job ' + queued.jobId.slice(0, 8) + '; 70-day-old notice → retry action → one job';
  });
  await leg('S11-F1c no blanket retry: authentication and candidates reviews stay covered by the claim, a re-delivery leaves them as they are, and the retry action refuses them; a queued bill-ready notice accepts no bill choice and no retry', async () => {
    const acct = await mkAccount();
    const failedAuth = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 8, day: 27, amount: 81, auth: AUTH_FAIL })); assert.equal(failedAuth.data.calendar?.reason, 'authentication');
    const row = await Payment.create({ title: 'アプラス', amount: 82, currency: 'JPY', dueDate: noon('2030-09-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const cand = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 9, day: 27, amount: 82 })); assert.equal(cand.data.calendar?.reason, 'candidates');
    const { jobId, covered } = await claimJob(acct); assert.ok(covered.notices.includes(failedAuth.data.calendar ? (await FinanceNotice.findById(failedAuth.data.id).lean()).mailId : ''), 'an authentication review is not covered'); assert.ok(covered.notices.includes((await FinanceNotice.findById(cand.data.id).lean()).mailId), 'a candidates review is not covered'); await finishJob(acct, jobId);
    const authAgain = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 8, day: 27, amount: 81, auth: AUTH_FAIL, id: (await FinanceNotice.findById(failedAuth.data.id).lean()).mailId })); assert.equal(authAgain.data.duplicate, true); assert.equal(authAgain.data.calendar.reason, 'authentication'); assert.equal(await sourced(acct, '2030-08'), null);
    assert.equal((await fin('notices/' + failedAuth.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } })).status, 409, 'an authentication review was retried');
    assert.equal((await fin('notices/' + cand.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } })).status, 409, 'a candidates review was retried instead of chosen');
    assert.equal((await Payment.findById(row._id).lean()).source, undefined);
    const amex = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex F1c', provider: 'amex', primaryCard: '55039', cardIdentifiers: ['55039'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    assert.equal((await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex F1c PC', accountIds: [String(amex._id)] } })).status, 200);
    const ready = await sendNotice(acct, amexConfirmation({ suffix: '55039', digits: 5 })); assert.equal(ready.data.calendar?.state, 'queued');
    assert.equal((await fin('notices/' + ready.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(row._id) } })).status, 409);
    assert.equal((await fin('notices/' + ready.data.id + '/link', { method: 'PUT', token: tokenA, body: { retry: true } })).status, 409, 'a queued bill-ready notice was retried');
    return 'authentication/candidates: covered, unchanged on re-delivery, retry 409; queued bill-ready: 409 for both bodies';
  });
  // ── S11-F2: a statement-only cycle gets its own calendar choice ──
  await leg('S11-F2 statement-only choice: a CSV cycle with no notice → GET imports/:id/calendar offers only authorized candidates (foreign owner 404, removed member sees none and PUT is 403 with nothing written); PUT {paymentId} links the paid row preserved and completes the same cycle\'s waiting notice with one bill; a repeat is a safe 409; two concurrent choices → one bill; create beside candidates; a company choice for an older cycle after a rebind; sibling cycle and other account untouched', async () => {
    const acct = await mkAccount(), other = await mkAccount(); const month = '2030-10', due = '2030-10-28';
    const paid = await Payment.create({ title: 'アプラス', amount: 7100, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'paid', category: 'Term Credit Card', recurring: false, organizationId: A, settledAt: new Date() });
    const forecast = await Payment.create({ title: 'アプラス 予測', amount: 7150, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const paidBefore = snap(await Payment.findById(paid._id).lean());
    const csv = await deliver(acct, { month, total: 7100, paymentDueDate: due }); assert.equal(csv.data.calendar?.state, 'review', JSON.stringify(csv.data));
    const get = await fin('imports/' + csv.data.id + '/calendar', { token: tokenA }); assert.equal(get.status, 200, 'no statement-only calendar review: ' + JSON.stringify(get)); assert.equal(get.data.calendar?.state, 'review'); assert.deepEqual(get.data.candidateBills.map(c => c.id).sort(), [String(paid._id), String(forecast._id)].sort()); assert.ok(get.data.candidateBills.every(c => typeof c.title === 'string' && typeof c.amount === 'number'));
    assert.equal((await fin('imports/' + csv.data.id + '/calendar', { token: tokenFor(owner2, user2.email, A2) })).status, 404);
    await removeMember(A, user._id);
    try {
      const hidden = await fin('imports/' + csv.data.id + '/calendar', { token: tokenA }); assert.equal(hidden.status, 200); assert.deepEqual(hidden.data.candidateBills, [], 'candidates disclosed without membership');
      const refused = await fin('imports/' + csv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { paymentId: String(paid._id) } }); assert.equal(refused.status, 403, JSON.stringify(refused));
      assert.equal((await fin('imports/' + csv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { create: true } })).status, 403);
      assert.equal((await Payment.findById(paid._id).lean()).source, undefined); assert.equal(await sourced(acct, month), null);
    } finally { await addMember(A, user._id); }
    const notice = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 10, day: 28, amount: 7100 })); assert.equal(notice.data.calendar?.state, 'review');
    const otherCsv = await deliver(other, { month, total: 7100, paymentDueDate: due }); assert.equal(otherCsv.data.calendar?.state, 'review');
    const put = await fin('imports/' + csv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { paymentId: String(paid._id) } }); assert.equal(put.status, 200, JSON.stringify(put)); assert.equal(put.data.calendar.state, 'linked'); assert.equal(put.data.calendar.preserved, true); assert.equal(String(put.data.calendar.paymentId), String(paid._id)); assert.equal(put.data.woken?.notices, 1, JSON.stringify(put.data));
    const batch = await FinanceImport.findById(csv.data.id).lean(); assert.equal(batch.calendar.state, 'linked'); assert.equal(String(batch.calendar.paymentId), String(paid._id)); assert.equal(batch.calendar.action?.kind, 'payment'); assert.equal(String(batch.calendar.action.by), ownerId);
    const reviewed = await fin('imports/' + csv.data.id + '/calendar', { token: tokenA }); assert.equal(reviewed.data.calendar.state, 'linked'); assert.equal(reviewed.data.action?.kind, 'payment');
    const n = await FinanceNotice.findById(notice.data.id).lean(); assert.equal(n.calendar.state, 'linked', 'the waiting notice was not completed by the batch choice'); assert.equal(String(n.calendar.paymentId), String(paid._id));
    const adopted = await Payment.findById(paid._id).lean(); assert.equal(adopted.source.adopted, true); assert.equal(String(adopted.source.importId), csv.data.id); assert.equal(snap(withoutSource(adopted)), snap(withoutSource(JSON.parse(paidBefore))), 'the paid row changed beyond source'); assert.equal(adopted.amount, 7100); assert.equal(adopted.status, 'paid');
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period(month).key }), 1); assert.equal((await Payment.findById(forecast._id).lean()).source, undefined);
    assert.equal((await FinanceImport.findById(otherCsv.data.id).lean()).calendar.state, 'review', 'another account\'s batch was changed');
    const repeat = await fin('imports/' + csv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { paymentId: String(paid._id) } }); assert.equal(repeat.status, 409, 'a repeated choice was not a safe refusal: ' + JSON.stringify(repeat));
    assert.equal((await fin('imports/' + csv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: {} })).status, 400);
    const month2 = '2030-11', due2 = '2030-11-27'; const d1 = await Payment.create({ title: 'アプラス', amount: 7200, currency: 'JPY', dueDate: noon(due2), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const csv2 = await deliver(acct, { month: month2, total: 7200, paymentDueDate: due2 }); assert.equal(csv2.data.calendar?.state, 'review');
    const [x, y] = await Promise.all([fin('imports/' + csv2.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { paymentId: String(d1._id) } }), fin('imports/' + csv2.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { paymentId: String(d1._id) } })]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.data, y.data])); assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period(month2).key }), 1); assert.equal((await Payment.findById(d1._id).lean()).source?.adopted, true);
    const month3 = '2030-12', due3 = '2030-12-27'; const e1 = await Payment.create({ title: 'アプラス', amount: 7300, currency: 'JPY', dueDate: noon(due3), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const csv3 = await deliver(acct, { month: month3, total: 7350, paymentDueDate: due3 }); assert.equal(csv3.data.calendar?.state, 'review');
    const created = await fin('imports/' + csv3.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { create: true } }); assert.equal(created.status, 200, JSON.stringify(created)); assert.equal(created.data.calendar.state, 'linked'); assert.equal(created.data.calendar.created, true);
    const own = await sourced(acct, month3); assert.equal(own.amount, 7350); assert.notEqual(String(own._id), String(e1._id)); assert.equal((await Payment.findById(e1._id).lean()).source, undefined);
    const moved = await mkAccount(); assert.equal((await fin('accounts/' + moved.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: B } })).status, 200);
    const oldCsv = await deliver(moved, { month: '2026-04', total: 7400, paymentDueDate: '2026-04-27' }); assert.equal(oldCsv.data.calendar?.state, 'review', JSON.stringify(oldCsv.data)); assert.equal(oldCsv.data.calendar.reason, 'company');
    const offers = await fin('imports/' + oldCsv.data.id + '/calendar', { token: tokenA }); assert.deepEqual(offers.data.companies.map(c => c.id).sort(), [A, B].sort()); assert.ok(offers.data.companies.every(c => typeof c.name === 'string'));
    assert.equal((await fin('imports/' + oldCsv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: C } })).status, 400);
    const chose = await fin('imports/' + oldCsv.data.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(chose.status, 200, JSON.stringify(chose)); assert.equal(chose.data.calendar.state, 'linked'); assert.equal(String((await sourced(moved, '2026-04')).organizationId), A);
    return 'GET offers 2, foreign 404, removed member sees none/403; link → batch + notice linked, paid row preserved; repeat 409; concurrent 200/409 → 1 bill; create beside → own bill; company choice → created in A';
  });
  // ── S11-F3: only a stored card suffix proves automatic identity ──
  await leg('S11-F3 nicknames: accounts nicknamed 法人カード or カード never adopt a 「JCB法人カード」 row with the equal amount and date (review, no write); a row naming the stored card suffix still adopts; a sibling\'s suffix still reviews; the generic account name itself in a title proves nothing', async () => {
    // the nicknamed account is created alone first: no sibling name may mask the hole through the sibling check
    const generic = await mkAccount({ name: '法人カード' });
    const jcb = await Payment.create({ title: 'JCB法人カード', amount: 8100, currency: 'JPY', dueDate: noon('2031-01-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const r = await sendNotice(generic, aplusConfirmation({ year: 2031, month: 1, day: 27, amount: 8100 })); assert.equal(r.data.calendar?.state, 'review', 'a nickname proved identity: ' + JSON.stringify(r.data)); assert.deepEqual(r.data.calendar.candidates.map(String), [String(jcb._id)]); assert.equal((await Payment.findById(jcb._id).lean()).source, undefined);
    const short = await mkAccount({ name: 'カード' });
    const jcb2 = await Payment.create({ title: 'JCBカード', amount: 8200, currency: 'JPY', dueDate: noon('2031-02-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const r2 = await sendNotice(short, aplusConfirmation({ year: 2031, month: 2, day: 27, amount: 8200 })); assert.equal(r2.data.calendar?.state, 'review', 'a three-character nickname proved identity: ' + JSON.stringify(r2.data)); assert.equal((await Payment.findById(jcb2._id).lean()).source, undefined);
    const named = await Payment.create({ title: '法人カード 2月分', amount: 8250, currency: 'JPY', dueDate: noon('2031-03-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const r3 = await sendNotice(generic, aplusConfirmation({ year: 2031, month: 3, day: 27, amount: 8250 })); assert.equal(r3.data.calendar?.state, 'review', 'the account name in a title proved identity: ' + JSON.stringify(r3.data)); assert.equal((await Payment.findById(named._id).lean()).source, undefined);
    const mine = await Payment.create({ title: 'アプラス ' + generic.card + ' 分', amount: 8300, currency: 'JPY', dueDate: noon('2031-04-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const r4 = await sendNotice(generic, aplusConfirmation({ year: 2031, month: 4, day: 27, amount: 8300 })); assert.equal(r4.data.calendar?.state, 'linked', JSON.stringify(r4.data)); assert.equal(r4.data.calendar.adopted, true); assert.equal(String(r4.data.calendar.paymentId), String(mine._id));
    const theirs = await Payment.create({ title: 'アプラス -' + short.card, amount: 8400, currency: 'JPY', dueDate: noon('2031-05-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const r5 = await sendNotice(generic, aplusConfirmation({ year: 2031, month: 5, day: 27, amount: 8400 })); assert.equal(r5.data.calendar?.state, 'review'); assert.equal((await Payment.findById(theirs._id).lean()).source, undefined);
    return '法人カード/カード/own-name titles → review; suffix → adopted; sibling suffix → review';
  });
  await leg('S11 mutants: the claim covering ambiguous notices; the ambiguous retry disabled; the batch choice without the membership check; the nickname identity token restored — each DETECTED', async () => {
    const acct = await mkAccount({ mailbox: 'shared-m@example.invalid' }), twin = await mkAccount({ mailbox: 'shared-m@example.invalid' });
    const mail = aplusConfirmation({ year: 2031, month: 6, day: 27, amount: 91 }); const r = await sendNotice(acct, mail); assert.equal(r.data.calendar?.reason, 'ambiguous-account');
    assert.equal((await bills.coveredNoticeIds(acct.account._id)).includes(mail.id), false);
    await mutant('server/services/financeBillService.ts', [{ marker: 'recoverable-uncovered' }], async m => { assert.equal((await m.coveredNoticeIds(acct.account._id)).includes(mail.id), true, 'mutant NOT detected (claim coverage)'); });
    await fin('accounts/' + twin.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: false, mailbox: 'shared-m@example.invalid' } });
    await mutant('server/services/financeBillService.ts', [{ marker: 'recoverable-retry' }], async m => { const again = await m.recordBillingNotice(ownerId, await acct.read(), artifact(mail, { mailbox: acct.mailbox }), acct.collectorId); assert.equal(again.calendar.reason, 'ambiguous-account', 'mutant NOT detected (retry): ' + JSON.stringify(again.calendar)); });
    const honest = await bills.recordBillingNotice(ownerId, await acct.read(), artifact(mail, { mailbox: acct.mailbox }), acct.collectorId); assert.equal(honest.calendar.state, 'linked');
    const month = '2031-07', due = '2031-07-28'; const row = await Payment.create({ title: 'アプラス', amount: 92, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const csv = await deliver(acct, { month, total: 92, paymentDueDate: due }); assert.equal(csv.data.calendar?.state, 'review');
    await removeMember(A, user._id);
    try {
      await assert.rejects(bills.linkImport(ownerId, csv.data.id, { paymentId: String(row._id) }), e => e?.statusCode === 403);
      assert.equal((await Payment.findById(row._id).lean()).source, undefined);
      // without the membership check the association itself is written for a non-member (the later reconciliation still refuses the amounts: unauthorized) — the write is the detection
      await mutant('server/services/financeBillService.ts', [{ marker: 'choice-membership' }], async m => { const r2 = await m.linkImport(ownerId, csv.data.id, { paymentId: String(row._id) }); assert.equal((await Payment.findById(row._id).lean()).source?.adopted, true, 'mutant NOT detected (membership): no association written: ' + JSON.stringify(r2.calendar)); });
    } finally { await addMember(A, user._id); await Payment.updateOne({ _id: row._id }, { $unset: { source: '' } }); await FinanceImport.updateOne({ _id: csv.data.id }, { $set: { 'calendar.state': 'review' } }); }
    // a nickname no sibling account shares, in a title no sibling name is a substring of: only the mutant's name token can match it
    const nick = await mkAccount({ name: 'ビジネス決済' }); const jcb = await Payment.create({ title: 'JCBビジネス決済', amount: 93, currency: 'JPY', dueDate: noon('2031-08-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const ev = evidenceFor('2031-08', 93, '2031-08-27'); const fresh = await nick.read();
    assert.equal((await bills.reconcileBill(ownerId, fresh, ev, 'issuer-mail')).state, 'review');
    await mutant('server/services/financeBillService.ts', [{ from: 'return { suffixes }', to: "return { suffixes, name: String(account?.name || '').trim().toLowerCase() }" }, { from: 'return tokens.suffixes.some(s => new RegExp(', to: "if (tokens.name && text.toLowerCase().includes(tokens.name)) return true; return tokens.suffixes.some(s => new RegExp(" }], async m => { const r3 = await m.reconcileBill(ownerId, fresh, ev, 'issuer-mail'); assert.equal(r3.state, 'linked', 'mutant NOT detected (nickname): ' + JSON.stringify(r3)); assert.equal(r3.adopted, true); });
    await Payment.updateOne({ _id: jcb._id }, { $unset: { source: '' } });
    return '4 mutants detected';
  });

  // ── N3 / B2: legacy candidates ──
  await leg('N3/B2 legacy adoption: two アプラス candidates → review (both listed), no write → link {paymentId} adopts and updates the forecast; zero candidates → created pending; another card product with the same amount/date → review, never adopted; a forecast with a different amount and shifted date → review → link → confirmed values', async () => {
    const acct = await mkAccount(); const month = '2027-07', due = '2027-07-27';
    const c1 = await Payment.create({ title: 'アプラス', amount: 700, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const c2 = await Payment.create({ title: 'アプラス（予測）', amount: 750, currency: 'JPY', dueDate: noon(due), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const mail = aplusConfirmation({ year: 2027, month: 7, day: 27, amount: 700 });
    const r = await sendNotice(acct, mail); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.calendar?.state, 'review', JSON.stringify(r.data)); assert.equal(r.data.calendar.reason, 'candidates');
    assert.deepEqual(r.data.calendar.candidates.map(String).sort(), [String(c1._id), String(c2._id)].sort());
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id }), 0, 'a write happened in review');
    const notices = await fin('notices', { token: tokenA, query: { accountId: acct.id } }); assert.equal(notices.status, 200, JSON.stringify(notices)); const listed = notices.data.notices.find(n => n.mailId === mail.id); assert.ok(listed); assert.equal(listed.candidateBills.length, 2); assert.ok(listed.candidateBills.every(c => typeof c.title === 'string' && typeof c.amount === 'number'));
    assert.equal((await fin('notices/' + listed._id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(seeded.a._id) } })).status, 400, 'a non-candidate linked');
    const linked = await fin('notices/' + listed._id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(c2._id) } }); assert.equal(linked.status, 200, JSON.stringify(linked)); assert.equal(linked.data.calendar.state, 'linked'); assert.equal(String(linked.data.calendar.paymentId), String(c2._id));
    const adopted = await Payment.findById(c2._id).lean(); assert.equal(adopted.source.adopted, true); assert.equal(adopted.amount, 700, 'the unsettled forecast was not updated to the confirmed amount'); assert.equal(String(adopted.source.linkedBy), ownerId);
    assert.equal((await Payment.findById(c1._id).lean()).source, undefined);
    const empty = await sendNotice(acct, aplusConfirmation({ year: 2027, month: 8, day: 27, amount: 800 })); assert.equal(empty.data.calendar?.state, 'linked', JSON.stringify(empty.data));
    const created = await sourced(acct, '2027-08'); assert.equal(created.status, 'pending'); assert.equal(String(created.organizationId), A); assert.equal(created.amount, 800); assert.equal(created.dueDate.toISOString(), '2027-08-27T12:00:00.000Z'); assert.equal(created.source.dueDateEvidence, 'issuer-mail');
    // verified identity (F1): a row naming this account's card suffix with the exact amount and date is adopted automatically; a row naming a sibling account's suffix is offered for review, never adopted
    const sib = await mkAccount();
    const mine = await Payment.create({ title: 'アプラス（下4桁 ' + acct.card + '）', amount: 1100, currency: 'JPY', dueDate: noon('2027-11-26'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const theirs = await Payment.create({ title: 'アプラス -' + sib.card, amount: 1200, currency: 'JPY', dueDate: noon('2027-12-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const v = await sendNotice(acct, aplusConfirmation({ year: 2027, month: 11, day: 26, amount: 1100 })); assert.equal(v.data.calendar?.state, 'linked', JSON.stringify(v.data)); assert.equal(v.data.calendar.adopted, true); assert.equal(String(v.data.calendar.paymentId), String(mine._id)); assert.equal((await Payment.findById(mine._id).lean()).source?.adopted, true);
    const w = await sendNotice(acct, aplusConfirmation({ year: 2027, month: 12, day: 27, amount: 1200 })); assert.equal(w.data.calendar?.state, 'review', JSON.stringify(w.data)); assert.deepEqual(w.data.calendar.candidates.map(String), [String(theirs._id)]); assert.equal((await Payment.findById(theirs._id).lean()).source, undefined, 'a sibling account\'s row was adopted');
    const jcb = await Payment.create({ title: 'JCB', amount: 900, currency: 'JPY', dueDate: noon('2027-09-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const other = await sendNotice(acct, aplusConfirmation({ year: 2027, month: 9, day: 27, amount: 900 })); assert.equal(other.data.calendar?.state, 'review', JSON.stringify(other.data)); assert.deepEqual(other.data.calendar.candidates.map(String), [String(jcb._id)]);
    assert.equal((await Payment.findById(jcb._id).lean()).source, undefined, 'another card product was adopted'); assert.equal(await sourced(acct, '2027-09'), null);
    const forecast = await Payment.create({ title: 'アプラス 予測', amount: 1500, currency: 'JPY', dueDate: noon('2027-10-25'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const confirmed = await sendNotice(acct, aplusConfirmation({ year: 2027, month: 10, day: 27, amount: 1000 })); assert.equal(confirmed.data.calendar?.state, 'review', JSON.stringify(confirmed.data)); assert.deepEqual(confirmed.data.calendar.candidates.map(String), [String(forecast._id)]);
    assert.equal(await sourced(acct, '2027-10'), null, 'a second bill was created beside the forecast');
    const link2 = await fin('notices/' + confirmed.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(forecast._id) } }); assert.equal(link2.status, 200, JSON.stringify(link2));
    const updated = await Payment.findById(forecast._id).lean(); assert.equal(updated.amount, 1000); assert.equal(updated.dueDate.toISOString(), '2027-10-27T12:00:00.000Z'); assert.equal(updated.source.adopted, true); assert.equal(updated.status, 'pending');
    return '2 candidates → review → linked (700); zero → created; verified suffix → adopted; sibling suffix → review; JCB same amount → review; shifted forecast → review → linked 1000/10-27';
  });

  // ── N4 / B6: Amex bill-ready ──
  await leg('N4 Amex bill-ready: suffix 11009 → queueSync → Amex account queued, no Payment, notice queued with the jobId; a second notice while queued → already-queued; an unpaired Amex account → unpaired (never already-queued); inactive → inactive-account; no match → no-account; bracketed subject and 4-digit suffix parse', async () => {
    const acct = await mkAccount();
    const amex = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex', provider: 'amex', primaryCard: '11009', cardIdentifiers: ['11009', '12015'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const pair = await fin('collectors', { method: 'POST', token: tokenA, body: { name: 'Synthetic Amex PC', accountIds: [String(amex._id)] } }); assert.equal(pair.status, 200);
    const paymentsBefore = await Payment.countDocuments({});
    const r = await sendNotice(acct, amexConfirmation({ suffix: '11009', digits: 5, bracket: true })); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.calendar?.state, 'queued', JSON.stringify(r.data)); assert.equal(String(r.data.calendar.targetAccountId), String(amex._id));
    const row = await FinancialAccount.findById(amex._id).lean(); assert.equal(row.jobState, 'queued'); assert.equal(row.jobId, r.data.calendar.jobId); assert.equal(row.lastMessage, 'Waiting for collector');
    assert.equal(await Payment.countDocuments({}), paymentsBefore, 'a Payment was created for Amex');
    const second = await sendNotice(acct, amexConfirmation({ suffix: '1009', digits: 4 })); assert.equal(second.data.calendar?.state, 'already-queued', JSON.stringify(second.data)); assert.equal((await FinancialAccount.findById(amex._id).lean()).jobId, row.jobId);
    const lonely = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex unpaired', provider: 'amex', primaryCard: '22009', cardIdentifiers: ['22009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    const unpaired = await sendNotice(acct, amexConfirmation({ suffix: '22009', digits: 5 })); assert.equal(unpaired.data.calendar?.state, 'unpaired', JSON.stringify(unpaired.data)); assert.equal((await FinancialAccount.findById(lonely._id).lean()).jobState, 'idle');
    const inactive = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex inactive', provider: 'amex', primaryCard: '33009', cardIdentifiers: ['33009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid', active: false });
    const off = await sendNotice(acct, amexConfirmation({ suffix: '33009', digits: 5 })); assert.equal(off.data.calendar?.state, 'inactive-account', JSON.stringify(off.data)); assert.equal(String(off.data.calendar.targetAccountId), String(inactive._id));
    const none = await sendNotice(acct, amexConfirmation({ suffix: '44009', digits: 5 })); assert.equal(none.data.calendar?.state, 'no-account', JSON.stringify(none.data));
    return 'queued (job ' + row.jobId.slice(0, 8) + '), already-queued, unpaired, inactive-account, no-account';
  });

  // ── N5 / B1: authority ──
  await leg('N5/B1 authority: owner removed from A → changed CSV re-delivery → no write, unauthorized, import 200; A\'s still-valid token → calendar 403; a new cycle (notice) → unauthorized, no bill; legacy adoption refused without candidate disclosure; membership back → the same evidence applies', async () => {
    const acct = await mkAccount();
    const first = await deliver(acct, { month: '2027-11', total: 100, paymentDueDate: '2027-11-26' }); assert.equal(first.data.calendar?.state, 'linked');
    const before = await sourced(acct, '2027-11');
    const forecast = await Payment.create({ title: 'アプラス（下4桁 ' + acct.card + '）', amount: 300, currency: 'JPY', dueDate: noon('2029-07-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    await removeMember(A, user._id);
    try {
      const again = await deliver(acct, { month: '2027-11', total: 110, paymentDueDate: '2027-11-26', salt: 'second' }); assert.equal(again.status, 200, JSON.stringify(again)); assert.equal(again.data.calendar?.state, 'unauthorized', JSON.stringify(again.data)); assert.equal(again.data.calendar.observed?.amount, 110);
      assert.equal(snap(await sourced(acct, '2027-11')), snap(before), 'an unauthorized write happened');
      assert.equal((await call('/api/payments', { token: tokenA })).status, 403); assert.equal((await call('/api/payments/' + String(before._id), { method: 'PUT', token: tokenA, body: { status: 'paid' } })).status, 403);
      const created = await sendNotice(acct, aplusConfirmation({ year: 2029, month: 6, day: 27, amount: 200 })); assert.equal(created.status, 200, JSON.stringify(created)); assert.equal(created.data.calendar?.state, 'unauthorized', JSON.stringify(created.data)); assert.equal(await sourced(acct, '2029-06'), null, 'a bill was created without authority');
      const adopt = await sendNotice(acct, aplusConfirmation({ year: 2029, month: 7, day: 27, amount: 300 })); assert.equal(adopt.data.calendar?.state, 'unauthorized', JSON.stringify(adopt.data)); assert.equal(adopt.data.calendar.candidates, undefined, 'candidates disclosed without membership'); assert.equal((await Payment.findById(forecast._id).lean()).source, undefined, 'adopted without authority');
      assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id }), 1);
    } finally { await addMember(A, user._id); }
    const bind = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(bind.status, 200); assert.equal(bind.data.woken.notices, 2, JSON.stringify(bind.data));
    assert.ok(await sourced(acct, '2029-06'), 'the unauthorized notice was not retried after membership returned'); assert.equal((await Payment.findById(forecast._id).lean()).source?.adopted, true, 'the verified forecast was not adopted once membership returned');
    return 'no write without membership (CSV, create, verified adopt); 403 on the still-valid token; both notices completed once membership returned';
  });

  // ── N6: the settlement race ──
  await leg('N6 settlement race: the bill turns paid between the step-1 read and the atomic update → matchedCount 0 → re-read → preserved, byte-identical; the mutant without the settled predicates rewrites the paid bill — DETECTED', async () => {
    const acct = await mkAccount(); await deliver(acct, { month: '2028-03', total: 100, paymentDueDate: '2028-03-27' });
    const bill = await sourced(acct, '2028-03'); const fresh = await acct.read();
    const settle = async () => { await Payment.updateOne({ _id: bill._id }, { $set: { status: 'paid', settledAt: new Date() } }); };
    const r = await bills.reconcileBill(ownerId, fresh, evidenceFor('2028-03', 200, '2028-03-27', { sourceHash: 'f'.repeat(64) }), 'statement-csv', { hooks: { beforeWrite: settle } });
    assert.equal(r.state, 'linked', JSON.stringify(r)); assert.equal(r.preserved, true); assert.equal(r.observed?.amount, 200);
    const paid = await sourced(acct, '2028-03'); assert.equal(paid.amount, 100); assert.equal(paid.status, 'paid');
    const snapshot = snap(paid);
    await mutant('server/services/financeBillService.ts', [{ marker: 'settled-predicates' }], async m => {
      await Payment.updateOne({ _id: bill._id }, { $set: { status: 'pending' }, $unset: { settledAt: '' } });
      const mr = await m.reconcileBill(ownerId, fresh, evidenceFor('2028-03', 300, '2028-03-27', { sourceHash: '1'.repeat(64) }), 'statement-csv', { hooks: { beforeWrite: settle } });
      assert.equal((await sourced(acct, '2028-03')).amount, 300, 'mutant NOT detected: the paid bill kept 100 (' + JSON.stringify(mr) + ')');
    });
    await Payment.updateOne({ _id: bill._id }, { $set: { amount: 100 } });
    assert.equal(snap(await sourced(acct, '2028-03')).length > 0, true);
    return 'preserved at 100 (observed 200); mutant wrote 300';
  });

  // ── N8: covered month ──
  await leg('N8 covered month: September held in covered.statements → a changed-amount notice for September still reconciles and records observed on the paid bill', async () => {
    const acct = await mkAccount(); const paidRow = await seedPaid();
    const csv = await deliver(acct, { month: '2026-09', total: T, paymentDueDate: '2026-09-28', bytes: septemberCsv(acct) }); assert.equal(csv.data.calendar?.state, 'review', JSON.stringify(csv.data));
    const first = await sendNotice(acct, aplusConfirmation({ year: 2026, month: 9, day: 28, amount: T })); assert.equal(first.data.calendar?.state, 'review');
    const linked = await fin('notices/' + first.data.id + '/link', { method: 'PUT', token: tokenA, body: { paymentId: String(paidRow._id) } }); assert.equal(linked.status, 200, JSON.stringify(linked)); assert.equal(linked.data.calendar.preserved, true);
    assert.equal((await FinanceImport.findById(csv.data.id).lean()).calendar.state, 'linked', 'the September batch was not completed by the link');
    const { jobId, covered } = await claimJob(acct); assert.deepEqual(covered.statements, ['2026-09']); assert.ok(Array.isArray(covered.notices)); await finishJob(acct, jobId);
    const r = await sendNotice(acct, aplusConfirmation({ year: 2026, month: 9, day: 28, amount: T + 5 })); assert.equal(r.data.calendar?.state, 'linked', JSON.stringify(r.data)); assert.equal(r.data.calendar.preserved, true); assert.equal(r.data.calendar.observed.amount, T + 5); assert.equal(String(r.data.calendar.paymentId), String(paidRow._id));
    assert.equal((await Payment.findById(paidRow._id).lean()).amount, T);
    return 'observed ' + (T + 5) + ' on the paid bill; nothing rewritten';
  });

  // ── N9: P3-period ──
  await leg('N9 P3-period: bound A, PUT calendar B (bound-at/previous recorded); first delivery of an older cycle → review offering A and B, no bill; link {organizationId: A} by a member → created in A; a newer cycle → created under B directly; link by a non-member of the chosen company → 403', async () => {
    const acct = await mkAccount();
    const toB = await fin('accounts/' + acct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: B } }); assert.equal(toB.status, 200);
    const row = await acct.read(); assert.equal(String(row.previousOrganizationId), A);
    const old = await sendNotice(acct, aplusConfirmation({ year: 2026, month: 5, day: 27, amount: 555 })); assert.equal(old.data.calendar?.state, 'review', JSON.stringify(old.data)); assert.equal(old.data.calendar.reason, 'company'); assert.deepEqual(old.data.calendar.companies.map(String).sort(), [A, B].sort()); assert.equal(await sourced(acct, '2026-05'), null);
    assert.equal((await fin('notices/' + old.data.id + '/link', { method: 'PUT', token: tokenA, body: { organizationId: C } })).status, 400, 'a company outside the offer was accepted');
    await removeMember(A, user._id);
    try { assert.equal((await fin('notices/' + old.data.id + '/link', { method: 'PUT', token: tokenA, body: { organizationId: A } })).status, 403); } finally { await addMember(A, user._id); }
    const linked = await fin('notices/' + old.data.id + '/link', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(linked.status, 200, JSON.stringify(linked)); assert.equal(linked.data.calendar.state, 'linked');
    const created = await sourced(acct, '2026-05'); assert.equal(String(created.organizationId), A); assert.equal(created.amount, 555);
    const newer = await sendNotice(acct, aplusConfirmation({ year: 2026, month: 12, day: 28, amount: 666 })); assert.equal(newer.data.calendar?.state, 'linked', JSON.stringify(newer.data)); assert.equal(String((await sourced(acct, '2026-12')).organizationId), B);
    const stored = await FinanceNotice.findById(old.data.id).lean(); assert.equal(stored.action?.kind, 'organization'); assert.equal(String(stored.action.by), ownerId);
    return 'older cycle → review → created in A by choice; newer → B';
  });

  // ── B3: removal and cancellation ──
  await leg('B3 removal: deleting a recognized bill suppresses it durably (fields kept, hidden from the list and count); the same and a new notice, the CSV and a retry recreate nothing; cancel stays preserved; manual deletion unchanged; restore only through the explicit link action → fresh membership', async () => {
    const acct = await mkAccount();
    const mail = aplusConfirmation({ year: 2028, month: 5, day: 26, amount: 400 });
    const first = await sendNotice(acct, mail); assert.equal(first.data.calendar?.state, 'linked');
    const bill = await sourced(acct, '2028-05');
    const removed = await call('/api/payments/' + String(bill._id), { method: 'DELETE', token: tokenA }); assert.equal(removed.status, 200, JSON.stringify(removed)); assert.equal(removed.data.suppressed, true);
    const tomb = await Payment.findById(bill._id).lean(); assert.ok(tomb, 'the sourced bill was physically deleted'); assert.ok(tomb.suppressedAt instanceof Date); assert.equal(String(tomb.suppressedBy), ownerId); assert.equal(tomb.amount, 400); assert.equal(tomb.source.periodKey, period('2028-05').key);
    assert.equal((await call('/api/payments', { token: tokenA })).data.some(p => p.id === String(bill._id)), false); assert.equal((await call('/api/payments/' + String(bill._id), { token: tokenA })).status, 404); assert.equal((await call('/api/payments/' + String(bill._id), { method: 'PUT', token: tokenA, body: { amount: 1 } })).status, 404); assert.equal((await call('/api/payments/' + String(bill._id), { method: 'DELETE', token: tokenA })).status, 404);
    const same = await sendNotice(acct, mail); assert.equal(same.data.duplicate, true); assert.equal(same.data.calendar.state, 'linked', 'a completed notice was retried');
    const fresh = await sendNotice(acct, aplusConfirmation({ year: 2028, month: 5, day: 26, amount: 410 })); assert.equal(fresh.data.calendar?.state, 'suppressed', JSON.stringify(fresh.data)); assert.equal(String(fresh.data.calendar.paymentId), String(bill._id));
    const csv = await deliver(acct, { month: '2028-05', total: 420, paymentDueDate: '2028-05-26' }); assert.equal(csv.data.calendar?.state, 'suppressed', JSON.stringify(csv.data));
    const retry = await deliver(acct, { month: '2028-05', total: 420, paymentDueDate: '2028-05-26' }); assert.equal(retry.data.duplicateFile, true); assert.equal(retry.data.calendar?.state, 'suppressed');
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period('2028-05').key }), 1); assert.equal((await Payment.findById(bill._id).lean()).amount, 400);
    const { jobId, covered } = await claimJob(acct); assert.ok(covered.notices.includes(mail.id) && covered.notices.includes(fresh.data.calendar.paymentId ? (await FinanceNotice.findById(fresh.data.id).lean()).mailId : ''), 'suppressed notices are not covered: ' + JSON.stringify(covered)); await finishJob(acct, jobId);
    assert.equal((await fin('notices/' + first.data.id + '/link', { method: 'PUT', token: tokenA, body: { restore: true } })).status, 409, 'a linked notice restored');
    await removeMember(A, user._id);
    try { assert.equal((await fin('notices/' + fresh.data.id + '/link', { method: 'PUT', token: tokenA, body: { restore: true } })).status, 403); assert.ok((await Payment.findById(bill._id).lean()).suppressedAt); } finally { await addMember(A, user._id); }
    const restored = await fin('notices/' + fresh.data.id + '/link', { method: 'PUT', token: tokenA, body: { restore: true } }); assert.equal(restored.status, 200, JSON.stringify(restored)); assert.equal(restored.data.calendar.state, 'linked');
    const back = await Payment.findById(bill._id).lean(); assert.equal(back.suppressedAt, undefined); assert.equal(back.amount, 410, 'the restored bill did not take the notice amount'); assert.equal((await call('/api/payments', { token: tokenA })).data.some(p => p.id === String(bill._id)), true);
    const cancelled = await call('/api/payments/' + String(bill._id), { method: 'PUT', token: tokenA, body: { status: 'cancelled' } }); assert.equal(cancelled.status, 200); assert.equal(cancelled.data.settledAt, undefined);
    const afterCancel = await sendNotice(acct, aplusConfirmation({ year: 2028, month: 5, day: 26, amount: 430 })); assert.equal(afterCancel.data.calendar?.state, 'linked'); assert.equal(afterCancel.data.calendar.preserved, true); assert.equal((await Payment.findById(bill._id).lean()).amount, 410); assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id, 'source.periodKey': period('2028-05').key }), 1);
    const manual = await Payment.create({ title: 'Synthetic manual', amount: 1, currency: 'JPY', dueDate: noon('2028-05-01'), type: 'expense', status: 'pending', category: 'Rent', organizationId: A });
    const gone = await call('/api/payments/' + String(manual._id), { method: 'DELETE', token: tokenA }); assert.equal(gone.status, 200); assert.equal(gone.data.suppressed, undefined); assert.equal(await Payment.findById(manual._id), null, 'a manual payment was kept');
    return 'suppressed, 4 re-deliveries recreated nothing, restored by the explicit action (410), cancel preserved (430 observed), manual delete unchanged';
  });
  await leg('B3 mutant: the reconciliation without the suppressed check rewrites a removed bill — DETECTED', async () => {
    const acct = await mkAccount(); await deliver(acct, { month: '2028-06', total: 100, paymentDueDate: '2028-06-26' });
    const bill = await sourced(acct, '2028-06'); await call('/api/payments/' + String(bill._id), { method: 'DELETE', token: tokenA });
    const fresh = await acct.read();
    const honest = await bills.reconcileBill(ownerId, fresh, evidenceFor('2028-06', 150, '2028-06-26', { sourceHash: '2'.repeat(64) }), 'statement-csv'); assert.equal(honest.state, 'suppressed'); assert.equal((await sourced(acct, '2028-06')).amount, 100);
    await mutant('server/services/financeBillService.ts', [{ marker: 'suppressed' }, { from: "suppressedAt: { $exists: false }, // guard:settled-predicates-suppressed", to: '' }], async m => {
      const r = await m.reconcileBill(ownerId, fresh, evidenceFor('2028-06', 160, '2028-06-26', { sourceHash: '3'.repeat(64) }), 'statement-csv');
      assert.equal((await sourced(acct, '2028-06')).amount, 160, 'mutant NOT detected (' + JSON.stringify(r) + ')');
    });
    return 'honest kept 100; mutant wrote 160';
  });

  // ── B6: recovery ──
  await leg('B6 recovery: a crash after the notice insert and before the bill link leaves a durable pending notice that the claim does not cover; the retry completes exactly one bill and a truthful receipt; an unbound notice links after the company is chosen; the covered list carries only completed/review notices; the mutant that covers pending notices — DETECTED', async () => {
    const acct = await mkAccount(); const fresh = await acct.read();
    const mail = aplusConfirmation({ year: 2028, month: 7, day: 27, amount: 770 });
    await assert.rejects(bills.recordBillingNotice(ownerId, fresh, artifact(mail, { mailbox: acct.mailbox }), acct.collectorId, { hooks: { afterInsert: async () => { throw new Error('synthetic crash after insert'); } } }), /synthetic crash/);
    const pending = await FinanceNotice.findOne({ accountId: acct.account._id, mailId: mail.id }).lean(); assert.ok(pending, 'no durable notice after the crash'); assert.equal(pending.calendar.state, 'pending'); assert.equal(await sourced(acct, '2028-07'), null);
    const { jobId, covered } = await claimJob(acct); assert.equal(covered.notices.includes(mail.id), false, 'a pending notice is covered'); await finishJob(acct, jobId);
    const retry = await sendNotice(acct, mail); assert.equal(retry.status, 200, JSON.stringify(retry)); assert.equal(retry.data.duplicate, true); assert.equal(retry.data.calendar?.state, 'linked', JSON.stringify(retry.data));
    assert.equal(await Payment.countDocuments({ 'source.accountId': acct.account._id }), 1); assert.equal(await FinanceNotice.countDocuments({ accountId: acct.account._id, mailId: mail.id }), 1);
    const done = await FinanceNotice.findOne({ accountId: acct.account._id, mailId: mail.id }).lean(); assert.equal(done.calendar.state, 'linked'); assert.ok(done.attempts >= 1); assert.ok(done.lastAttemptAt instanceof Date);
    const again = await claimJob(acct); assert.equal(again.covered.notices.includes(mail.id), true, 'a completed notice is not covered'); await finishJob(acct, again.jobId);
    const unboundAcct = await mkAccount({ organizationId: null });
    const mail2 = aplusConfirmation({ year: 2028, month: 8, day: 27, amount: 880 });
    const u1 = await sendNotice(unboundAcct, mail2); assert.equal(u1.data.calendar?.state, 'unbound', JSON.stringify(u1.data)); assert.equal(await sourced(unboundAcct, '2028-08'), null);
    const c1 = await claimJob(unboundAcct); assert.equal(c1.covered.notices.includes(mail2.id), false, 'an unbound notice is covered'); await finishJob(unboundAcct, c1.jobId);
    const u2 = await sendNotice(unboundAcct, mail2); assert.equal(u2.data.duplicate, true); assert.equal(u2.data.calendar?.state, 'unbound');
    const bind = await fin('accounts/' + unboundAcct.id + '/calendar', { method: 'PUT', token: tokenA, body: { organizationId: A } }); assert.equal(bind.status, 200); assert.equal(bind.data.woken.notices, 1, JSON.stringify(bind.data));
    const created = await sourced(unboundAcct, '2028-08'); assert.ok(created, 'the unbound notice did not link after binding'); assert.equal(String(created.organizationId), A);
    const c2 = await claimJob(unboundAcct); assert.equal(c2.covered.notices.includes(mail2.id), true); await finishJob(unboundAcct, c2.jobId);
    const reviewAcct = await mkAccount(); const r1 = await Payment.create({ title: 'アプラス', amount: 1, currency: 'JPY', dueDate: noon('2028-09-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A }); const r2 = await Payment.create({ title: 'アプラス', amount: 2, currency: 'JPY', dueDate: noon('2028-09-27'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: A });
    const mail3 = aplusConfirmation({ year: 2028, month: 9, day: 27, amount: 3 }); const rv = await sendNotice(reviewAcct, mail3); assert.equal(rv.data.calendar?.state, 'review');
    const c3 = await claimJob(reviewAcct); assert.equal(c3.covered.notices.includes(mail3.id), true, 'a review notice is not covered'); await finishJob(reviewAcct, c3.jobId);
    await FinanceNotice.updateOne({ accountId: reviewAcct.account._id, mailId: mail3.id }, { $set: { 'calendar.state': 'pending' } });
    assert.equal((await bills.coveredNoticeIds(reviewAcct.account._id)).includes(mail3.id), false);
    await mutant('server/services/financeBillService.ts', [{ marker: 'covered-states' }], async m => { assert.equal((await m.coveredNoticeIds(reviewAcct.account._id)).includes(mail3.id), true, 'mutant NOT detected'); });
    await Payment.deleteMany({ _id: { $in: [r1._id, r2._id] } });
    return 'pending after crash → retried once → 1 bill; unbound → bound → linked; covered = completed/review only; mutant detected';
  });

  // ── routes: notices list, link validation, billing-mail setting, upload validation ──
  await leg('ROUTES: GET notices lists the owner\'s notices newest first without bodies; link refuses an unknown notice (404), a foreign owner (404), a bad body (400) and a non-review notice (409); PUT billing-mail validates and saves; a notice for an account without billing mail is refused (409); a bad artifact 400; a wrong mailbox 409', async () => {
    const acct = await mkAccount();
    const m1 = aplusConfirmation({ year: 2030, month: 1, day: 27, amount: 10 }), m2 = aplusConfirmation({ year: 2030, month: 2, day: 27, amount: 11 });
    await sendNotice(acct, m1); await sendNotice(acct, m2);
    const list = await fin('notices', { token: tokenA, query: { accountId: acct.id } }); assert.equal(list.status, 200, JSON.stringify(list));
    assert.deepEqual(list.data.notices.map(n => n.mailId), [m2.id, m1.id]); for (const n of list.data.notices) { assert.equal(n.text, undefined); assert.equal(n.body, undefined); assert.equal(typeof n.calendar?.state, 'string'); assert.equal(n.versions, 1); }
    assert.equal((await fin('notices', { token: tokenB, query: { accountId: acct.id } })).data.notices.length, 2, 'the owner sees his notices whatever company the token selects');
    assert.equal((await fin('notices', { token: tokenFor(owner2, user2.email, A2), query: { accountId: acct.id } })).status, 404);
    const id = list.data.notices[0]._id;
    assert.equal((await fin('notices/' + 'f'.repeat(24) + '/link', { method: 'PUT', token: tokenA, body: { create: true } })).status, 404);
    assert.equal((await fin('notices/' + id + '/link', { method: 'PUT', token: tokenFor(owner2, user2.email, A2), body: { create: true } })).status, 404);
    assert.equal((await fin('notices/' + id + '/link', { method: 'PUT', token: tokenA, body: {} })).status, 400);
    assert.equal((await fin('notices/' + id + '/link', { method: 'PUT', token: tokenA, body: { create: true } })).status, 409, 'a linked notice accepted create');
    const bad = await fin('accounts/' + acct.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: true, mailbox: 'not-an-address' } }); assert.equal(bad.status, 400, JSON.stringify(bad));
    assert.equal((await fin('accounts/' + acct.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: 'yes', mailbox: MAILBOX } })).status, 400);
    const off = await fin('accounts/' + acct.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: false, mailbox: MAILBOX } }); assert.equal(off.status, 200, JSON.stringify(off)); assert.deepEqual(off.data.billingMail, { enabled: false, mailbox: MAILBOX });
    assert.equal((await acct.read()).billingMail.enabled, false);
    const refused = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 3, day: 27, amount: 12 })); assert.equal(refused.status, 409, 'a notice was accepted with billing mail off: ' + JSON.stringify(refused));
    const on = await fin('accounts/' + acct.id + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: true, mailbox: 'Bills@Example.invalid' } }); assert.equal(on.status, 200); assert.equal(on.data.billingMail.mailbox, MAILBOX); acct.mailbox = MAILBOX;
    assert.equal((await sendNotice(acct, aplusConfirmation({ year: 2030, month: 3, day: 27, amount: 12 }), { mailbox: 'other@example.invalid' })).status, 409);
    assert.equal((await sendNotice(acct, aplusConfirmation({ year: 2030, month: 4, day: 27, amount: 13 }), { claims: { statementMonth: '2030-04', dueDate: '2030-05-01', amount: 13, currency: 'JPY' } })).status, 400, 'a due date outside the statement month was accepted');
    assert.equal((await sendNotice(acct, aplusConfirmation({ year: 2030, month: 4, day: 27, amount: 13 }), { bodySha256: 'zz' })).status, 400);
    assert.equal((await sendNotice(acct, aplusConfirmation({ year: 2030, month: 4, day: 27, amount: 13 }), { authentication: {} })).status, 400, 'missing authentication accepted');
    const amexAccount = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex settings', provider: 'amex', primaryCard: '55009', cardIdentifiers: ['55009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
    assert.equal((await fin('accounts/' + String(amexAccount._id) + '/billing-mail', { method: 'PUT', token: tokenA, body: { enabled: true, mailbox: MAILBOX } })).status, 400);
    const failedAuth = await sendNotice(acct, aplusConfirmation({ year: 2030, month: 5, day: 27, amount: 14, auth: AUTH_FAIL })); assert.equal(failedAuth.status, 200, JSON.stringify(failedAuth)); assert.equal(failedAuth.data.calendar?.state, 'review'); assert.equal(failedAuth.data.calendar.reason, 'authentication'); assert.equal(await sourced(acct, '2030-05'), null, 'a bill from a mail that failed DKIM/DMARC');
    assert.equal((await fin('notices/' + failedAuth.data.id + '/link', { method: 'PUT', token: tokenA, body: { create: true } })).status, 409, 'an unauthenticated mail can be forced into a bill');
    const receipt = await (async () => { const { jobId } = await claimJob(acct); const r = await fin('collector/upload', { method: 'POST', token: acct.token, body: { kind: 'billing-mail', ok: false, readAt: new Date().toISOString(), noticesRead: 0, noticesSent: 0, error: 'synthetic mailbox failure' }, type: 'application/json', query: { accountId: acct.id, jobId, kind: 'billing-mail' } }); await finishJob(acct, jobId); return r; })();
    assert.equal(receipt.status, 200, JSON.stringify(receipt)); const after = await acct.read(); assert.equal(after.billingMail.lastError, 'synthetic mailbox failure'); assert.ok(after.billingMail.lastErrorAt instanceof Date); assert.ok(after.billingMail.lastAttemptAt instanceof Date);
    const okReceipt = await (async () => { const { jobId } = await claimJob(acct); const r = await fin('collector/upload', { method: 'POST', token: acct.token, body: { kind: 'billing-mail', ok: true, readAt: new Date().toISOString(), noticesRead: 2, noticesSent: 1 }, type: 'application/json', query: { accountId: acct.id, jobId, kind: 'billing-mail' } }); await finishJob(acct, jobId); return r; })();
    assert.equal(okReceipt.status, 200); const after2 = await acct.read(); assert.equal(after2.billingMail.lastError, null); assert.ok(after2.billingMail.lastReadAt instanceof Date); assert.equal(after2.billingMail.lastCount, 2);
    const accounts = await fin('accounts', { token: tokenA }); const shown = accounts.data.accounts.find(a => a._id === acct.id); assert.equal(shown.billingMail.enabled, true); assert.equal(shown.billingMail.mailbox, MAILBOX);
    return '2 listed, 4 link refusals, billing-mail saved/validated, 5 upload refusals, failed authentication → review (no bill), receipts recorded';
  });

  console.log(JSON.stringify({ pass: legs.every(Boolean), checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
} catch (error) {
  console.log('FAIL H1 setup — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900));
  console.log(JSON.stringify({ pass: false, checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
  process.exitCode = 1;
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  for (const s of servers) await new Promise(r => s.close(r));
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

// ── H2: E-P4, the real store under tsx + Pinia; a resolve hook maps ~/stores/user to a stub; $fetch intercepted. ──────────
const H2_HOOK = String.raw`
let stub = '';
export async function initialize(data) { stub = data.stub; }
export async function resolve(specifier, context, next) {
  if (specifier === '~/stores/user') return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
`;
const H2_STUB = String.raw`
exports.useUserStore = () => ({ authHeader: { Authorization: 'Bearer synthetic' } });
`;
const H2_HARNESS = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2], HOOK = process.argv[3], STUB = process.argv[4];
let checks = 0;
try {
  // The project has no "type": "module", so tsx loads stores/calendar.ts as CommonJS: ~/stores/user is mapped to the stub
  // for that loader (the CJS resolver) and for the ESM loader (the resolve hook), and Pinia is taken from the same build
  // the store will require, with the ESM build pointed at the same instance.
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '~/stores/user') return STUB; return original.call(this, request, ...rest); };
  register(pathToFileURL(HOOK).href, { data: { stub: pathToFileURL(STUB).href } });
  const storeRequire = createRequire(path.join(ROOT, 'stores', 'calendar.ts'));
  const piniaCjs = storeRequire('pinia'), piniaEsm = await import('pinia');
  const instance = piniaCjs.createPinia(); piniaCjs.setActivePinia(instance); piniaEsm.setActivePinia(instance);
  const calls = [];
  const card = { id: 'c1', title: 'Synthetic Aplus', amount: 100, currency: 'JPY', dueDate: '2026-09-28T12:00:00.000Z', type: 'expense', status: 'pending', category: 'Term Credit Card', recurring: false, organizationId: 'synthetic', source: { kind: 'card-statement', provider: 'aplus', periodKey: 'statement:2026-09-01:2026-09-30' }, createdAt: '', updatedAt: '' };
  const manual = { id: 'm1', title: 'Synthetic rent', amount: 50, currency: 'JPY', dueDate: '2026-09-30T12:00:00.000Z', type: 'expense', status: 'pending', category: 'Rent', recurring: false, createdAt: '', updatedAt: '' };
  const rows = [card, manual];
  globalThis.$fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push({ method, url, body: options.body });
    if (method === 'PUT' && url.startsWith('/api/payments/')) { const id = url.split('/').pop(); const row = rows.find(r => r.id === id); return { ...row, ...options.body, settledAt: new Date().toISOString() }; }
    return {};
  };
  const { useCalendarStore } = await import(pathToFileURL(path.join(ROOT, 'stores/calendar.ts')).href);
  const store = useCalendarStore(); store.payments = rows.map(r => ({ ...r }));
  const settled = await store.markAsCompleted('c1'); const afterCard = calls.splice(0);
  assert.deepEqual(afterCard.map(c => c.method + ' ' + c.url), ['PUT /api/payments/c1'], 'card-statement bill: ' + JSON.stringify(afterCard.map(c => c.method + ' ' + c.url)));
  assert.deepEqual(afterCard[0].body, { status: 'paid' }); assert.equal(settled.status, 'paid'); assert.equal(store.payments.find(p => p.id === 'c1').status, 'paid');
  checks++; console.log('PASS E-P4 real store: markAsCompleted on a card-statement bill → exactly [PUT /api/payments/:id {status: paid}], no transaction POST');
  const paidManual = await store.markAsCompleted('m1'); const afterManual = calls.splice(0);
  assert.deepEqual(afterManual.map(c => c.method + ' ' + c.url), ['PUT /api/payments/m1', 'POST /api/transactions'], JSON.stringify(afterManual.map(c => c.method + ' ' + c.url)));
  assert.equal(afterManual[1].body.type, '支出'); assert.equal(afterManual[1].body.referenceNumber, 'PAY-m1'); assert.equal(afterManual[1].body.paymentId, 'm1'); assert.equal(afterManual[1].body.amount, 50); assert.equal(paidManual.status, 'paid');
  checks++; console.log('PASS E-P4 real store: a manual payment still posts its transaction [PUT, POST /api/transactions 支出 PAY-m1]');
  console.log(JSON.stringify({ pass: true, checks }));
} catch (error) {
  console.log('FAIL E-P4 — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900));
  console.log(JSON.stringify({ pass: false, checks }));
  process.exitCode = 1;
}
`;

// ── H3: N7 and B5 — the schedule, the claim, BillingMailbox on a fake Gmail client, outbox artifacts, the upload route. ──
const H3_HARNESS = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, unlink, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2];
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const legs = [];
async function leg(name, fn) {
  try { const detail = await fn(); legs.push(true); console.log('PASS ' + name + (detail ? ' — ' + String(detail) : '')); }
  catch (error) { legs.push(false); console.log('FAIL ' + name + ' — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900)); }
}
` + DATABASE_RECEIPT + MAIL_BUILDERS + String.raw`
// A fake Gmail client with the three calls BillingMailbox makes; every call is counted; pages are served in order.
function fakeGmail({ profile = MAILBOX, pages = [[]], messages = [] } = {}) {
  const counts = { profile: 0, list: 0, get: 0, queries: [], tokens: [] };
  const byId = new Map(messages.map(m => [m.id, gmailMessage(m)]));
  return { counts, users: {
    async getProfile() { counts.profile++; return { data: { emailAddress: profile } }; },
    messages: {
      async list({ q, maxResults, pageToken }) { counts.list++; counts.queries.push(q); counts.tokens.push(pageToken || null); const index = pageToken ? Number(pageToken.replace('page-', '')) : 0; const page = pages[index] || []; return { data: { messages: page.map(m => ({ id: m.id, threadId: m.threadId })), ...(index + 1 < pages.length ? { nextPageToken: 'page-' + (index + 1) } : {}) } }; },
      async get({ id }) { counts.get++; const m = byId.get(id); if (!m) throw new Error('fake gmail: unknown message ' + id); return { data: m }; }
    } } };
}
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-h3-'));
process.env.OMF_DATA_DIR = path.join(temp, 'data'); process.env.OMF_COLLECTOR_DIR = path.join(temp, 'collector'); await mkdir(process.env.OMF_COLLECTOR_DIR, { recursive: true });
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default;
const { createApp, toNodeListener } = await import('h3');
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'calendar_card_bill_mail_isolated' } });
process.env.MONGO_URI = mongo.getUri('calendar_card_bill_mail_isolated');
let server = null;
try {
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'calendar_card_bill_mail_isolated');
  const User = (await import(u('server/models/User.ts'))).default;
  const Organization = (await import(u('server/models/Organization.ts'))).default;
  const { Payment } = await import(u('server/models/Payment.ts'));
  const { FinancialAccount, FinanceCollector, FinanceNotice, initializeFinance } = await import(u('server/models/Finance.ts'));
  const route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
  const { runSyncSchedule } = await import(u('server/services/financeSyncScheduler.ts'));
  const mail = await import(u('collector/mail.mjs')); assert.equal(typeof mail.BillingMailbox, 'function', 'collector/mail.mjs exports no BillingMailbox');
  const index = await import(u('collector/index.mjs')); const { runAplusJob, uploadQuery } = index;
  const { billingMailSchedule } = await import(u('shared/billing-mail.mjs'));
  await initializeFinance(); await Payment.init();
  const app = createApp(); app.use(auth); app.use(route);
  server = http.createServer(toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const call = async (r, { method = 'GET', token, body, type = 'application/json', query } = {}) => {
    const url = new URL('/api/finance/' + r, origin); if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { method, headers: { 'Content-Type': type, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: response.status, data };
  };
  const user = await User.create({ email: 'mail-owner@example.invalid', name: 'Synthetic owner', password: 'Synthetic-only-Strong-Password1!' }); const ownerId = String(user._id);
  const org = await Organization.create({ name: 'Synthetic-M', slug: 'synthetic-m-' + randomUUID().slice(0, 8), type: 'business', members: [{ userId: user._id, role: 'owner' }] });
  const jwtToken = jwt.sign({ userId: ownerId, email: user.email, type: 'access', jti: randomUUID(), organizationId: String(org._id), role: 'owner' }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const account = await FinancialAccount.create({ ownerId, name: 'Synthetic Aplus', provider: 'aplus', primaryCard: '1234', cardIdentifiers: ['1234'], organizationId: org._id, organizationBoundAt: new Date(), billingMail: { enabled: true, mailbox: MAILBOX }, autoSync: { enabled: true, hour: 9 } });
  const amex = await FinancialAccount.create({ ownerId, name: 'Synthetic Amex', provider: 'amex', primaryCard: '11009', cardIdentifiers: ['11009'], otpRecipient: 'otp@example.invalid', otpMailbox: 'otp@example.invalid' });
  const created = await call('collectors', { method: 'POST', token: jwtToken, body: { name: 'Synthetic PC', accountIds: [String(account._id), String(amex._id)] } }); assert.equal(created.status, 200, JSON.stringify(created)); const token = created.data.token;
  const config = { baseUrl: origin, token };
  const id = String(account._id);
  // The collector's send, replaced by the real route handler over loopback: reads the retained file, posts the exact bytes
  // with the manifest-derived query, and writes the acknowledgement the way collector/index.mjs upload() does.
  const sends = [];
  const send = async (cfg, acct, item) => {
    const m = item.manifest; const bytes = await readFile(path.join(item.directory, m.filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), m.sha256, 'artifact integrity');
    const r = await call('collector/upload', { method: 'POST', token, body: bytes, type: m.sourceFormat === 'json' ? 'application/json' : 'text/csv', query: uploadQuery(m, acct) });
    sends.push({ kind: m.kind, status: r.status, data: r.data });
    if (r.status !== 200) throw Object.assign(new Error(r.data?.data?.message || r.data?.statusMessage || 'upload failed'), { status: r.status });
    await writeFile(path.join(item.directory, 'manifest.json'), JSON.stringify({ ...m, acknowledgedAt: new Date().toISOString(), importId: r.data.id }, null, 2));
    return r.data;
  };
  const statuses = [];
  const status = async (state, text) => { statuses.push([state, text]); const r = await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: claimed.jobId, state, message: text } }); assert.equal(r.status, 200, JSON.stringify(r)); };
  const collectCalls = [];
  const collect = async (acct, credentials, root, st, options) => { collectCalls.push(options); return { items: [], pending: null, nothing: true, unavailable: [], failed: null }; };
  let claimed = null;
  // The collector serves both accounts; an Amex job a notice queued is claimed and completed here without any Amex work
  // (its lane is unchanged), so every claim below is the Aplus one.
  const claim = async () => {
    for (let i = 0; i < 3; i++) {
      const r = await call('collector/claim', { method: 'POST', token, body: {} }); assert.equal(r.status, 200, JSON.stringify(r)); assert.ok(r.data.account, 'nothing to claim');
      if (r.data.account.provider !== 'aplus') { await call('collector/status', { method: 'POST', token, body: { accountId: r.data.account._id, jobId: r.data.account.jobId, state: 'complete', message: 'synthetic (no Amex work in this fixture)' } }); continue; }
      claimed = { jobId: r.data.account.jobId, account: r.data.account, covered: r.data.covered }; return claimed;
    }
    throw new Error('the Aplus job was not claimable');
  };
  const outboxDirs = async () => { try { return (await readdir(path.join(temp, 'outbox', id))).sort(); } catch { return []; } };
  const confirmation = aplusConfirmation({ year: 2026, month: 9, day: 28, amount: 2400 }), reminder = aplusReminder(), amexMail = amexConfirmation({ suffix: '11009', digits: 5 }), other = aplusOther();
  const gmailConfig = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', mailbox: MAILBOX };

  await leg('N7 schedule → claim: runSyncSchedule at 10:00 JST queues the Aplus account; the claim answers covered.statements and covered.notices (empty)', async () => {
    const { queued } = await runSyncSchedule(new Date('2026-10-15T01:00:00Z')); assert.deepEqual(queued, [id]);
    const c = await claim(); assert.equal(c.account.billingMail.enabled, true); assert.equal(c.account.billingMail.mailbox, MAILBOX); assert.deepEqual(c.covered, { statements: [], notices: [] });
    return 'queued and claimed job ' + c.jobId.slice(0, 8);
  });
  await leg('N7/B5 BillingMailbox on a fake Gmail client: the mailbox is verified before any list; the query names the two senders and the two subjects with the lookback; two pages are walked and the confirmation on page two is consumed; reminder/other mails parse to nothing', async () => {
    const gmail = fakeGmail({ pages: [[reminder, other, amexMail], [confirmation]], messages: [reminder, other, amexMail, confirmation] });
    const mailbox = new mail.BillingMailbox(gmailConfig, { client: gmail });
    const since = Date.now() - 45 * 86400000;
    const notices = await mailbox.list(claimed.account, since, { now: Date.now });
    assert.equal(gmail.counts.profile, 1, 'profile verified once'); assert.equal(gmail.counts.list, 2); assert.deepEqual(gmail.counts.tokens, [null, 'page-1']); assert.equal(gmail.counts.get, 4);
    const q = gmail.counts.queries[0]; assert.ok(q.includes('from:luxurycard@aplus.co.jp') && q.includes('from:AmericanExpress@welcome.americanexpress.com'), q); assert.ok(q.includes('subject:') && q.includes('最新ご請求明細確定のご案内') && q.includes('ご請求金額確定のご案内'), q); assert.ok(q.includes('after:' + Math.floor(since / 1000)), q);
    assert.deepEqual(notices.map(n => n.mailId).sort(), [amexMail.id, confirmation.id].sort());
    const aplus = notices.find(n => n.mailId === confirmation.id); assert.equal(aplus.kind, 'notice'); assert.equal(aplus.noticeKind, 'bill-confirmed'); assert.equal(aplus.issuer, 'aplus'); assert.deepEqual(aplus.claims, { statementMonth: '2026-09', dueDate: '2026-09-28', amount: 2400, currency: 'JPY' }); assert.equal(aplus.mailbox, MAILBOX); assert.deepEqual(aplus.authentication, { dkim: 'pass', dmarc: 'pass' }); assert.equal(aplus.bodySha256, createHash('sha256').update(confirmation.text.replace(/\r/g, '')).digest('hex')); assert.equal(aplus.text, undefined); assert.equal(aplus.body, undefined);
    const ready = notices.find(n => n.mailId === amexMail.id); assert.equal(ready.noticeKind, 'bill-ready'); assert.deepEqual(ready.claims, { cardSuffix: '11009' });
    return '2 notices from 4 mails over 2 pages; query ' + q.slice(0, 60) + '…';
  });
  await leg('B5 wrong mailbox fails before reading another inbox: the account names another mailbox → refused with 0 list/get calls; the connection\'s profile names another address → refused after the profile read with 0 list calls; the mutant without the equality check reads — DETECTED', async () => {
    const gmail = fakeGmail({ pages: [[confirmation]], messages: [confirmation] });
    const mailbox = new mail.BillingMailbox(gmailConfig, { client: gmail });
    await assert.rejects(mailbox.list({ ...claimed.account, billingMail: { enabled: true, mailbox: 'other@example.invalid' } }, 0), /mailbox/i); assert.equal(gmail.counts.list + gmail.counts.get, 0);
    await assert.rejects(mailbox.list({ ...claimed.account, billingMail: { enabled: true } }, 0), /mailbox/i); assert.equal(gmail.counts.list + gmail.counts.get, 0);
    const wrongProfile = fakeGmail({ profile: 'someone-else@example.invalid', pages: [[confirmation]], messages: [confirmation] });
    await assert.rejects(new mail.BillingMailbox(gmailConfig, { client: wrongProfile }).list(claimed.account, 0), /different mailbox/i); assert.equal(wrongProfile.counts.profile, 1); assert.equal(wrongProfile.counts.list, 0);
    const source = path.join(ROOT, 'collector/mail.mjs'); const lines = (await readFile(source, 'utf8')).split('\n'); const i = lines.findIndex(l => l.includes('// guard:billing-mailbox')); assert.ok(i >= 0, 'guard marker billing-mailbox missing'); lines.splice(i, 1);
    const copy = path.join(ROOT, 'collector', 'mail.mutant-' + randomUUID().slice(0, 8) + '.mjs'); await writeFile(copy, lines.join('\n'), { flag: 'wx' });
    try { const m = await import(pathToFileURL(copy).href); const g = fakeGmail({ pages: [[confirmation]], messages: [confirmation] }); const got = await new m.BillingMailbox(gmailConfig, { client: g }).list({ ...claimed.account, billingMail: { enabled: true, mailbox: 'other@example.invalid' } }, 0); assert.equal(got.length, 1, 'mutant NOT detected'); assert.ok(g.counts.list > 0); } finally { await unlink(copy).catch(() => {}); }
    return '3 refusals with no inbox read; mutant read the inbox';
  });
  await leg('N7 runAplusJob with the fake mailbox: notice artifacts (manifest kind notice, mailId, sha256) are written to the outbox, uploaded through the real route and acknowledged only after the server answered; the Aplus notice creates the bill, the Amex notice queues the Amex job; a durable receipt is sent; statements still collected; a second run skips the covered notices', async () => {
    const gmail = fakeGmail({ pages: [[reminder, amexMail], [confirmation]], messages: [reminder, amexMail, confirmation] });
    const mailbox = new mail.BillingMailbox(gmailConfig, { client: gmail });
    const result = await runAplusJob(claimed.account, config, null, { status, covered: claimed.covered.statements, coveredNotices: claimed.covered.notices, mailbox, upload: send, collect, directory: temp, batch: 'b1', now: Date.now });
    assert.equal(result.failed, null, JSON.stringify(result)); assert.equal(collectCalls.length, 1, 'statements not collected'); assert.deepEqual(collectCalls[0].covered, []);
    const dirs = await outboxDirs(); const notices = dirs.filter(d => d.includes('-notice-')), receipts = dirs.filter(d => d.endsWith('-mail'));
    assert.equal(notices.length, 2, JSON.stringify(dirs)); assert.equal(receipts.length, 1, JSON.stringify(dirs));
    for (const d of notices) { const m = JSON.parse(await readFile(path.join(temp, 'outbox', id, d, 'manifest.json'), 'utf8')); assert.equal(m.kind, 'notice'); assert.equal(m.sourceFormat, 'json'); assert.equal(m.accountId, id); assert.equal(m.jobId, claimed.jobId); assert.equal(m.ownerId, ownerId); assert.equal(m.origin, origin); assert.ok([amexMail.id, confirmation.id].includes(m.mailId)); assert.ok(m.acknowledgedAt, 'not acknowledged'); const bytes = await readFile(path.join(temp, 'outbox', id, d, m.filename)); assert.equal(createHash('sha256').update(bytes).digest('hex'), m.sha256); const artifact = JSON.parse(bytes.toString('utf8')); assert.equal(artifact.kind, 'notice'); assert.equal(artifact.mailId, m.mailId); assert.equal(artifact.text, undefined); }
    const receipt = JSON.parse(await readFile(path.join(temp, 'outbox', id, receipts[0], 'manifest.json'), 'utf8')); assert.equal(receipt.kind, 'billing-mail'); assert.ok(receipt.acknowledgedAt);
    assert.deepEqual(sends.map(s => s.kind + ':' + s.status).sort(), ['billing-mail:200', 'notice:200', 'notice:200']);
    const bill = await Payment.findOne({ 'source.accountId': account._id }).lean(); assert.ok(bill, 'no bill from the mail'); assert.equal(bill.amount, 2400); assert.equal(bill.dueDate.toISOString(), '2026-09-28T12:00:00.000Z'); assert.equal(String(bill.organizationId), String(org._id)); assert.equal(bill.source.dueDateEvidence, 'issuer-mail');
    assert.equal((await FinancialAccount.findById(amex._id).lean()).jobState, 'queued', 'the Amex job was not queued');
    const rows = await FinanceNotice.find({ accountId: account._id }).lean(); assert.equal(rows.length, 2); assert.deepEqual(rows.map(r => r.calendar.state).sort(), ['linked', 'queued']);
    const acct = await FinancialAccount.findById(account._id).lean(); assert.equal(acct.billingMail.lastError, null); assert.ok(acct.billingMail.lastReadAt instanceof Date); assert.equal(acct.billingMail.lastCount, 2);
    assert.ok(statuses.some(([, t]) => t === '請求メールを確認'), JSON.stringify(statuses)); assert.equal(statuses.at(-1)[0], 'complete'); assert.equal(statuses.at(-1)[1], 'すべての確定明細を取得済み');
    // second run: the claim now covers both mail ids; nothing new is written or sent
    await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: claimed.jobId, state: 'complete', message: 'done' } });
    await FinancialAccount.updateOne({ _id: account._id }, { $set: { jobState: 'complete' } });
    const synced = await call('accounts/' + id + '/sync', { method: 'POST', token: jwtToken }); assert.equal(synced.status, 200, JSON.stringify(synced));
    const c2 = await claim(); assert.deepEqual(c2.covered.notices.sort(), [amexMail.id, confirmation.id].sort());
    const sendsBefore = sends.length, dirsBefore = (await outboxDirs()).length;
    const gmail2 = fakeGmail({ pages: [[reminder, amexMail], [confirmation]], messages: [reminder, amexMail, confirmation] });
    const second = await runAplusJob(c2.account, config, null, { status, covered: c2.covered.statements, coveredNotices: c2.covered.notices, mailbox: new mail.BillingMailbox(gmailConfig, { client: gmail2 }), upload: send, collect, directory: temp, batch: 'b2', now: Date.now });
    assert.equal(second.failed, null); assert.equal((await outboxDirs()).filter(d => d.includes('-notice-')).length, 2, 'notice artifacts written again'); assert.equal(sends.length - sendsBefore, 1, 'more than the receipt was sent'); assert.equal((await outboxDirs()).length, dirsBefore + 1);
    assert.equal(await FinanceNotice.countDocuments({ accountId: account._id }), 2); assert.equal(await Payment.countDocuments({ 'source.accountId': account._id }), 1);
    return '2 notices + 1 receipt sent and acknowledged; bill 2400 created; Amex queued; second run sent only the receipt';
  });
  await leg('B5 mail failure: mailbox.list throws → statements are still collected, the job completes, the status text names the mail failure once, the receipt records the error durably on the account; an enabled account with no mailbox connection records the same way; the next day\'s run clears it', async () => {
    await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: claimed.jobId, state: 'complete', message: 'done' } });
    const synced = await call('accounts/' + id + '/sync', { method: 'POST', token: jwtToken }); assert.equal(synced.status, 200, JSON.stringify(synced));
    const c = await claim(); statuses.length = 0; collectCalls.length = 0;
    const broken = { async list() { throw new Error('synthetic Gmail outage'); } };
    const result = await runAplusJob(c.account, config, null, { status, covered: c.covered.statements, coveredNotices: c.covered.notices, mailbox: broken, upload: send, collect, directory: temp, batch: 'b3', now: Date.now });
    assert.equal(result.failed, null, JSON.stringify(result)); assert.equal(collectCalls.length, 1, 'statements were not collected after the mail failure');
    assert.ok(statuses.some(([, t]) => t === '請求メールを読めませんでした'), JSON.stringify(statuses)); assert.equal(statuses.at(-1)[0], 'complete');
    let acct = await FinancialAccount.findById(account._id).lean(); assert.equal(acct.billingMail.lastError, 'synthetic Gmail outage'); assert.ok(acct.billingMail.lastErrorAt instanceof Date); assert.ok(acct.billingMail.lastReadAt instanceof Date, 'the earlier successful read was lost');
    await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: c.jobId, state: 'complete', message: 'done' } });
    const synced2 = await call('accounts/' + id + '/sync', { method: 'POST', token: jwtToken }); assert.equal(synced2.status, 200);
    const c2 = await claim(); statuses.length = 0;
    const none = await runAplusJob(c2.account, config, null, { status, covered: c2.covered.statements, coveredNotices: c2.covered.notices, mailbox: null, upload: send, collect, directory: temp, batch: 'b4', now: Date.now });
    assert.equal(none.failed, null); acct = await FinancialAccount.findById(account._id).lean(); assert.match(acct.billingMail.lastError, /メールボックス/);
    await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: c2.jobId, state: 'complete', message: 'done' } });
    const synced3 = await call('accounts/' + id + '/sync', { method: 'POST', token: jwtToken }); assert.equal(synced3.status, 200);
    const c3 = await claim();
    const ok = await runAplusJob(c3.account, config, null, { status, covered: c3.covered.statements, coveredNotices: c3.covered.notices, mailbox: new mail.BillingMailbox(gmailConfig, { client: fakeGmail({ pages: [[confirmation]], messages: [confirmation] }) }), upload: send, collect, directory: temp, batch: 'b5', now: Date.now });
    assert.equal(ok.failed, null); acct = await FinancialAccount.findById(account._id).lean(); assert.equal(acct.billingMail.lastError, null);
    await call('collector/status', { method: 'POST', token, body: { accountId: id, jobId: c3.jobId, state: 'complete', message: 'done' } });
    return 'outage recorded, statements collected, cleared by the next good run';
  });
  await leg('B5 effective schedule: billingMailSchedule names off / manual-only (自動取得 off) / no-collector / daily; a disabled schedule is never reported as daily', async () => {
    const paired = [{ _id: 'c', accountIds: [id], revokedAt: null }], revoked = [{ _id: 'c', accountIds: [id], revokedAt: new Date() }];
    const acct = { _id: id, billingMail: { enabled: true, mailbox: MAILBOX }, autoSync: { enabled: true, hour: 9 } };
    assert.equal(billingMailSchedule({ ...acct, billingMail: { enabled: false } }, paired).state, 'off');
    assert.equal(billingMailSchedule({ ...acct, autoSync: { enabled: false, hour: 9 } }, paired).state, 'manual-only');
    assert.equal(billingMailSchedule(acct, []).state, 'no-collector'); assert.equal(billingMailSchedule(acct, revoked).state, 'no-collector');
    const daily = billingMailSchedule(acct, paired); assert.equal(daily.state, 'daily'); assert.equal(daily.hour, 9);
    assert.equal(billingMailSchedule({ ...acct, autoSync: { enabled: false, hour: 9 } }, []).state, 'manual-only');
    return 'off / manual-only / no-collector / daily';
  });
  await leg('N7 abort: a cancelled session signal stops the mailbox read before any notice is written', async () => {
    const controller = new AbortController(); controller.abort();
    const gmail = fakeGmail({ pages: [[confirmation]], messages: [confirmation] });
    await assert.rejects(new mail.BillingMailbox(gmailConfig, { client: gmail }).list(claimed.account, 0, { signal: controller.signal }), e => e?.name === 'AbortError');
    assert.equal(gmail.counts.get, 0);
    return 'AbortError before any message read';
  });
  console.log(JSON.stringify({ pass: legs.every(Boolean), checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
} catch (error) {
  console.log('FAIL H3 setup — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900));
  console.log(JSON.stringify({ pass: false, checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
  process.exitCode = 1;
} finally {
  await import(u('server/services/tokenBlacklistService.ts')).then(m => (m.stopCleanup || m.default?.stopCleanup)?.()).catch(() => {});
  if (server) await new Promise(r => server.close(r));
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

// ── H4: the connections page in the built app, real owned headless Chrome, owned ephemeral MongoDB. ─────────────────────
const H4_HARNESS = String.raw`
// @ts-nocheck
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2];
const u = p => pathToFileURL(path.join(ROOT, p)).href;
const legs = [];
async function leg(name, fn) {
  try { const detail = await fn(); legs.push(true); console.log('PASS ' + name + (detail ? ' — ' + String(detail) : '')); }
  catch (error) { legs.push(false); console.log('FAIL ' + name + ' — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900)); }
}
` + DATABASE_RECEIPT + MAIL_BUILDERS + String.raw`
const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const n = s.address().port; await new Promise(r => s.close(() => r())); return n; }
async function waitFor(fn, label, ms = 40000) { const end = Date.now() + ms; let error; while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch (e) { error = e; } await delay(200); } throw Error(label + ' timed out: ' + String(error || '')); }
const BUILT = path.join(ROOT, '.output', 'server', 'index.mjs');
if (!existsSync(BUILT)) throw new Error('NOT RUN: .output/server/index.mjs is missing in this worktree (build it first); no built-app coverage claimed');
const mongoose = (await import('mongoose')).default;
const { MongoMemoryServer } = await import('mongodb-memory-server');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-h4-'));
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'calendar_card_bill_app_isolated' } });
const uri = mongo.getUri('calendar_card_bill_app_isolated');
process.env.MONGO_URI = uri; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = randomBytes(32).toString('hex');
let app = null, appLog = '', browser = null; const pageErrors = [];
let closeOwnedBrowsers = async () => {};
try {
  await mongoose.connect(uri); assert.equal(mongoose.connection.name, 'calendar_card_bill_app_isolated');
  const Organization = (await import(u('server/models/Organization.ts'))).default;
  const { Payment } = await import(u('server/models/Payment.ts'));
  const { FinancialAccount, FinanceImport, FinanceNotice, initializeFinance } = await import(u('server/models/Finance.ts'));
  const browserModule = await import(u('collector/browser.mjs')); closeOwnedBrowsers = browserModule.closeOwnedBrowsers;
  const { browserFor, ephemeralProfile, findChrome } = browserModule;
  await initializeFinance(); await Payment.init();
  assert.ok(findChrome(), 'Chrome not found in its standard locations');
  const appPort = await freePort(), appOrigin = 'http://127.0.0.1:' + appPort;
  app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: ROOT, windowsHide: true, env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET, MONGO_URI: uri, NUXT_MONGO_URI: uri, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(appPort), NITRO_PORT: String(appPort), OMF_DATA_DIR: path.join(temp, 'server-data'), OMF_SYNC_SCHEDULE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', b => { appLog = (appLog + b).slice(-12000); });
  await waitFor(async () => { const r = await fetch(appOrigin + '/api/health', { signal: AbortSignal.timeout(2000) }); const b = await r.json(); if (b.database?.connected) { assert.equal(b.database.name, 'calendar_card_bill_app_isolated'); return true; } }, 'built app', 90000);
  const api = async (route, token, body, method = body === undefined ? 'GET' : 'POST') => { const r = await fetch(appOrigin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const email = 'calendar-ui@example.invalid', password = 'Synthetic-password-Only1!';
  const registered = await api('/api/auth/register', '', { email, password, name: 'Synthetic UI owner' }); assert.equal(registered.status, 200, JSON.stringify(registered));
  const userId = registered.data.user.id || registered.data.user._id;
  // The register route creates no company; the owner's company is seeded as the organization settings page would, and the
  // UI sign-in below then carries it in the token and the user store.
  const org = await Organization.create({ name: 'Synthetic UI company', slug: 'synthetic-ui-' + randomUUID().slice(0, 8), type: 'business', members: [{ userId, role: 'owner' }] });
  const signedIn = await api('/api/auth/login', '', { email, password }); assert.equal(signedIn.status, 200, JSON.stringify(signedIn)); const token = signedIn.data.tokens.accessToken;
  const accountCreated = await api('/api/finance/accounts', token, { provider: 'aplus', name: 'Synthetic Aplus UI', primaryCard: '1234', cardIdentifiers: ['1234'] }); assert.equal(accountCreated.status, 200, JSON.stringify(accountCreated)); const accountId = accountCreated.data.account._id;
  // A review notice with one candidate, seeded through the real collector route so the page shows what production would.
  const device = await api('/api/finance/collectors', token, { name: 'Synthetic UI PC', accountIds: [accountId] }); assert.equal(device.status, 200);
  const candidate = await Payment.create({ title: 'アプラス', amount: 700, currency: 'JPY', dueDate: new Date('2027-07-27T12:00:00.000Z'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: org._id });
  const extra = await Payment.create({ title: 'アプラス 予測', amount: 750, currency: 'JPY', dueDate: new Date('2027-07-27T12:00:00.000Z'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: org._id });
  const uiRoot = path.join(temp, 'ui');
  browser = await browserFor(ephemeralProfile(uiRoot, 'synthetic', 'omf', 'calendar', 'ui'), { ephemeral: true, root: uiRoot, headless: true });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const o = new URL(r.url()); if (o.origin === appOrigin || ['about:', 'data:'].includes(o.protocol)) return r.continue(); return r.abort(); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(appOrigin + '/login', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.setItem('theme', 'light')); await page.reload({ waitUntil: 'networkidle2' });
  const until = async (fn, label, arg) => { for (let i = 0; i < 200; i++) { if (await page.evaluate(fn, arg)) return; await delay(100); } throw Error('Browser condition timed out: ' + label); };
  await page.evaluate(() => document.querySelector('#email').focus()); await page.keyboard.type(email);
  await page.evaluate(() => document.querySelector('#password').focus()); await page.keyboard.type(password);
  await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await until(() => location.pathname === '/', 'login');
  await page.goto(appOrigin + '/connections', { waitUntil: 'networkidle2' }); await until(() => !!document.querySelector('.account-grid section'), 'connections');
  const details = (keyword) => "(() => { const d = [...document.querySelectorAll('.account-grid section details')].find(x => (x.querySelector('summary')?.textContent || '').includes(" + JSON.stringify(keyword) + ")); return d; })()";
  const summaryOf = async keyword => page.evaluate('(() => { const d = ' + details(keyword) + "; return d ? d.querySelector('summary').textContent.trim() : null; })()");
  await leg('H4 connections page (real headless Chrome, 390 px): the 支払カレンダー details lists the owner\'s company; choosing it and saving shows 会社を設定しました and the account is bound', async () => {
    await until(() => [...document.querySelectorAll('.account-grid section details summary')].some(s => s.textContent.includes('支払カレンダー')), 'calendar details');
    assert.equal(await summaryOf('支払カレンダー'), '支払カレンダー：会社未設定');
    await page.evaluate('(() => { const d = ' + details('支払カレンダー') + "; d.open = true; const s = d.querySelector('select'); s.value = " + JSON.stringify(String(org._id)) + "; s.dispatchEvent(new Event('change', { bubbles: true })); d.querySelector('form button').click(); return true; })()");
    await until(() => (document.querySelector('.notice')?.textContent || '').includes('会社を設定しました'), 'company saved notice');
    await until(() => [...document.querySelectorAll('.account-grid section details summary')].some(s => s.textContent.includes('支払カレンダー：') && !s.textContent.includes('会社未設定')), 'summary after save');
    const row = await FinancialAccount.findById(accountId).lean(); assert.equal(String(row.organizationId), String(org._id)); assert.ok(row.organizationBoundAt instanceof Date);
    return (await summaryOf('支払カレンダー'));
  });
  await leg('H4 請求メール details: off by default; enabling with a mailbox and saving stores it; with 自動取得 off the summary says the mail is read only on 確定明細を取得 (never "daily"); after 自動取得 on the summary says daily but PC未接続 while no collector is connected', async () => {
    assert.equal(await summaryOf('請求メール'), '請求メール：オフ');
    await page.evaluate('(() => { const d = ' + details('請求メール') + "; d.open = true; d.querySelector('input[type=checkbox]').click(); const i = d.querySelector('input[type=email]'); i.value = 'bills@example.invalid'; i.dispatchEvent(new Event('input', { bubbles: true })); d.querySelector('form button').click(); return true; })()");
    await until(() => (document.querySelector('.notice')?.textContent || '').includes('請求メールの設定を保存しました'), 'billing mail saved');
    await until(() => [...document.querySelectorAll('.account-grid section details summary')].some(s => s.textContent.includes('請求メール：') && s.textContent.includes('bills@example.invalid')), 'summary after billing mail save');
    const summary = await summaryOf('請求メール'); assert.ok(summary.includes('自動取得がオフ'), summary); assert.ok(!summary.includes('毎日'), summary);
    const row = await FinancialAccount.findById(accountId).lean(); assert.equal(row.billingMail.enabled, true); assert.equal(row.billingMail.mailbox, 'bills@example.invalid');
    await api('/api/finance/accounts/' + accountId + '/auto-sync', token, { enabled: true, hour: 9 }, 'PUT');
    await api('/api/finance/collectors/' + device.data.id, token, undefined, 'DELETE');
    await until(() => [...document.querySelectorAll('.account-grid section details summary')].some(s => s.textContent.includes('請求メール：') && s.textContent.includes('PC')), 'summary after auto-sync on without a PC', null);
    const summary2 = await summaryOf('請求メール'); assert.ok(summary2.includes('PC未接続') || summary2.includes('PCが接続'), summary2); assert.ok(!summary2.includes('毎日 9:00 以降（PCが利用可能なとき）'), summary2);
    return summary + ' → ' + summary2;
  });
  await leg('H4 請求メール list: a review notice shows 既存の請求と照合が必要 with its candidate buttons; choosing one links it and the label becomes 登録済み; the calendar lists the adopted bill with the confirmed amount', async () => {
    const paired = await api('/api/finance/collectors', token, { name: 'Synthetic UI PC 2', accountIds: [accountId] }); assert.equal(paired.status, 200);
    const sync = await api('/api/finance/accounts/' + accountId + '/sync', token, {}); assert.equal(sync.status, 200, JSON.stringify(sync));
    const claimed = await api('/api/finance/collector/claim', paired.data.token, {}); assert.equal(claimed.status, 200); const jobId = claimed.data.account.jobId;
    const mail = aplusConfirmation({ year: 2027, month: 7, day: 27, amount: 700 });
    const { parseBillingMail, authenticationResults, BILLING_MAIL_PARSER } = await import(u('shared/billing-mail.mjs'));
    const parsed = parseBillingMail(mail.headers, mail.text, { now: Date.now() });
    const artifact = { kind: 'notice', parserVersion: BILLING_MAIL_PARSER, mailbox: 'bills@example.invalid', mailId: mail.id, threadId: mail.threadId, internalDate: Number(mail.internalDate), subject: mail.headers.subject, from: mail.headers.from, bodySha256: createHash('sha256').update(mail.text.replace(/\r/g, '')).digest('hex'), authentication: authenticationResults(mail.headers), issuer: parsed.issuer, noticeKind: parsed.kind, claims: parsed.claims, readAt: new Date().toISOString() };
    const uploaded = await fetch(appOrigin + '/api/finance/collector/upload?' + new URLSearchParams({ accountId, jobId, kind: 'notice', mailId: mail.id }), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + paired.data.token }, body: JSON.stringify(artifact) });
    const result = await uploaded.json(); assert.equal(uploaded.status, 200, JSON.stringify(result)); assert.equal(result.calendar.state, 'review');
    await api('/api/finance/collector/status', paired.data.token, { accountId, jobId, state: 'complete', message: 'done' });
    await until(() => [...document.querySelectorAll('.notice-list article')].some(a => a.textContent.includes('既存の請求と照合が必要')), 'review notice listed', null);
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.notice-list article button')].map(b => b.textContent.trim()));
    assert.ok(buttons.some(b => b.includes('¥700') || b.includes('700')), JSON.stringify(buttons)); assert.ok(buttons.some(b => b.includes('750')), JSON.stringify(buttons));
    await page.evaluate(() => { const b = [...document.querySelectorAll('.notice-list article button')].find(x => x.textContent.includes('750')); b.click(); });
    await until(() => [...document.querySelectorAll('.notice-list article')].some(a => a.textContent.includes('登録済み')), 'linked label', null);
    const adopted = await Payment.findById(extra._id).lean(); assert.equal(adopted.source?.adopted, true); assert.equal(adopted.amount, 700);
    assert.equal((await Payment.findById(candidate._id).lean()).source, undefined);
    const listed = await api('/api/payments', token); assert.equal(listed.status, 200); assert.ok(listed.data.some(p => p.id === String(extra._id) && p.amount === 700));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow at 390 px');
    assert.deepEqual(pageErrors, [], 'page errors: ' + pageErrors.join(' | ').slice(0, 600));
    return 'review → linked by one click; adopted 750 → 700; 0 page errors';
  });
  await leg('H4 statement-only action (S11-F2): a statement batch waiting on a bill choice, opened from 取得履歴, shows its calendar choices in the selected panel; choosing the offered bill links the batch (label 登録済み) and adopts the row; no transaction import happens', async () => {
    const paired2 = await api('/api/finance/collectors', token, { name: 'Synthetic UI PC 3', accountIds: [accountId] }); assert.equal(paired2.status, 200);
    const row = await Payment.create({ title: 'アプラス', amount: 2400, currency: 'JPY', dueDate: new Date('2027-08-27T12:00:00.000Z'), type: 'expense', status: 'pending', category: 'Term Credit Card', organizationId: org._id });
    const sync = await api('/api/finance/accounts/' + accountId + '/sync', token, {}); assert.equal(sync.status, 200, JSON.stringify(sync));
    const claimed = await api('/api/finance/collector/claim', paired2.data.token, {}); assert.equal(claimed.status, 200); const jobId = claimed.data.account.jobId;
    const { HEADERS } = await import(u('shared/aplus.mjs'));
    const csv = Buffer.from('﻿' + [HEADERS, ['≪****-****-****-1234≫', '20270801', 'Synthetic shop ui', '2400', 'Ｓ', '1', '01', '2400', '']].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
    const uploaded = await fetch(appOrigin + '/api/finance/collector/upload?' + new URLSearchParams({ accountId, jobId, kind: 'statement', start: '2027-08-01', end: '2027-08-31', statementMonth: '2027-08', statementTotal: '2400', paymentDueDate: '2027-08-27' }), { method: 'POST', headers: { 'Content-Type': 'text/csv', Authorization: 'Bearer ' + paired2.data.token }, body: csv });
    const result = await uploaded.json(); assert.equal(uploaded.status, 200, JSON.stringify(result)); assert.equal(result.calendar?.state, 'review', JSON.stringify(result));
    await api('/api/finance/collector/status', paired2.data.token, { accountId, jobId, state: 'complete', message: 'done' });
    await until(id => [...document.querySelectorAll('button.history')].some(b => b.dataset.importId === id), 'history button', result.id);
    await page.evaluate(id => { [...document.querySelectorAll('button.history')].find(b => b.dataset.importId === id).click(); }, result.id);
    await until(() => !!document.querySelector('.calendar-choice') && [...document.querySelectorAll('.calendar-choice button')].some(b => b.textContent.includes('2,400') || b.textContent.includes('2400')), 'calendar choice rendered', null);
    const labelBefore = await page.evaluate(() => document.querySelector('.calendar-choice')?.textContent || ''); assert.ok(labelBefore.includes('既存の請求と照合が必要'), labelBefore);
    await page.evaluate(() => { [...document.querySelectorAll('.calendar-choice button')].find(b => b.textContent.includes('既存の請求に紐付け')).click(); });
    await until(() => (document.querySelector('.calendar-choice')?.textContent || '').includes('登録済み'), 'batch linked label', null);
    const adopted = await Payment.findById(row._id).lean(); assert.equal(adopted.source?.adopted, true); assert.equal(String(adopted.source.importId), result.id);
    const batch = await FinanceImport.findById(result.id).lean(); assert.equal(batch.calendar.state, 'linked');
    assert.equal(await mongoose.connection.collection('transactions').countDocuments({}), 0, 'a transaction was posted');
    assert.deepEqual(pageErrors, [], 'page errors: ' + pageErrors.join(' | ').slice(0, 600));
    return 'batch choice rendered and applied from the page; 0 transactions';
  });
  await leg('H4 ambiguity retry (S11-F1): a notice held because two accounts read one mailbox shows the explanation and a 再処理 button; after the other account stops reading the mailbox, the button links it', async () => {
    const second = await api('/api/finance/accounts', token, { provider: 'aplus', name: 'Synthetic Aplus UI 2', primaryCard: '5678', cardIdentifiers: ['5678'] }); assert.equal(second.status, 200, JSON.stringify(second));
    assert.equal((await api('/api/finance/accounts/' + second.data.account._id + '/billing-mail', token, { enabled: true, mailbox: 'bills@example.invalid' }, 'PUT')).status, 200);
    const paired3 = await api('/api/finance/collectors', token, { name: 'Synthetic UI PC 4', accountIds: [accountId] }); assert.equal(paired3.status, 200);
    const sync = await api('/api/finance/accounts/' + accountId + '/sync', token, {}); assert.equal(sync.status, 200, JSON.stringify(sync));
    const claimed = await api('/api/finance/collector/claim', paired3.data.token, {}); assert.equal(claimed.status, 200); const jobId = claimed.data.account.jobId;
    const mail = aplusConfirmation({ year: 2027, month: 9, day: 27, amount: 910 });
    const { parseBillingMail, authenticationResults, BILLING_MAIL_PARSER } = await import(u('shared/billing-mail.mjs'));
    const parsed = parseBillingMail(mail.headers, mail.text, { now: Date.now() });
    const artifact = { kind: 'notice', parserVersion: BILLING_MAIL_PARSER, mailbox: 'bills@example.invalid', mailId: mail.id, threadId: mail.threadId, internalDate: Number(mail.internalDate), subject: mail.headers.subject, from: mail.headers.from, bodySha256: createHash('sha256').update(mail.text.replace(/\r/g, '')).digest('hex'), authentication: authenticationResults(mail.headers), issuer: parsed.issuer, noticeKind: parsed.kind, claims: parsed.claims, readAt: new Date().toISOString() };
    const uploaded = await fetch(appOrigin + '/api/finance/collector/upload?' + new URLSearchParams({ accountId, jobId, kind: 'notice', mailId: mail.id }), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + paired3.data.token }, body: JSON.stringify(artifact) });
    const result = await uploaded.json(); assert.equal(uploaded.status, 200, JSON.stringify(result)); assert.equal(result.calendar?.reason, 'ambiguous-account', JSON.stringify(result));
    await api('/api/finance/collector/status', paired3.data.token, { accountId, jobId, state: 'complete', message: 'done' });
    await until(() => [...document.querySelectorAll('.notice-list article')].some(a => a.textContent.includes('読む口座を1つに') && [...a.querySelectorAll('button')].some(b => b.textContent.includes('再処理'))), 'ambiguity explanation and retry button', null);
    assert.equal((await api('/api/finance/accounts/' + second.data.account._id + '/billing-mail', token, { enabled: false, mailbox: 'bills@example.invalid' }, 'PUT')).status, 200);
    await page.evaluate(() => { const a = [...document.querySelectorAll('.notice-list article')].find(x => x.textContent.includes('読む口座を1つに')); [...a.querySelectorAll('button')].find(b => b.textContent.includes('再処理')).click(); });
    await until(() => [...document.querySelectorAll('.notice-list article')].some(a => a.textContent.includes('2027-09') && a.textContent.includes('登録済み')), 'retried notice linked', null);
    const bill = await Payment.findOne({ 'source.accountId': accountId, 'source.statementMonth': '2027-09' }).lean(); assert.ok(bill, 'no bill after the retry'); assert.equal(bill.amount, 910);
    assert.deepEqual(pageErrors, [], 'page errors: ' + pageErrors.join(' | ').slice(0, 600));
    return 'explanation + 再処理 rendered; one click after the correction → linked';
  });
  console.log(JSON.stringify({ pass: legs.every(Boolean), checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
} catch (error) {
  console.log('FAIL H4 setup — ' + String(error?.stack || error?.message || error).replace(/\s+/g, ' ').slice(0, 900) + ' | app log: ' + appLog.replace(/\s+/g, ' ').slice(-500));
  console.log(JSON.stringify({ pass: false, checks: legs.filter(Boolean).length, database: await databaseReceipt(mongoose, mongo) }));
  process.exitCode = 1;
} finally {
  await closeOwnedBrowsers().catch(() => {});
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill(); await exited.catch(() => {}); }
  await mongoose.disconnect(); await mongo.stop();
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
`;

// ── The parent fixture: pure legs here, harness children for everything that needs tsx or a database. ──────────────────
export default {
  name: 'calendar-card-bill',
  covers: ['server/models/Payment.ts', 'server/api/payments/index.ts', 'server/api/payments/[id].ts', 'server/api/dashboard/stats.ts', 'server/api/migrate-payment-dates.ts', 'types/calendar.ts', 'stores/calendar.ts', 'server/models/Finance.ts', 'shared/aplus.mjs', 'shared/billing-mail.mjs', 'collector/mail.mjs', 'collector/index.mjs', 'collector/aplus.mjs', 'server/api/finance/[...path].ts', 'server/services/financeService.ts', 'server/services/financeBillService.ts', 'server/utils/calendarAccess.ts', 'pages/connections.vue'],
  async run() {
    const started = Date.now();
    const legs = [];
    const leg = async (name, fn) => { const t = Date.now(); try { const detail = await fn(); legs.push({ name, ok: true, ms: Date.now() - t, detail }); } catch (error) { legs.push({ name, ok: false, ms: Date.now() - t, detail: String(error?.message || error).replace(/\s+/g, ' ').slice(0, 700) }); } };
    const load = rel => import(pathToFileURL(path.join(REPO_ROOT, rel)).href + '?t=' + Date.now());
    // ── A: the due date from the recorded overview text shape (the recorded line shape; the amount/date are the September facts the plan names) ──
    await leg('A aplusPaymentDueDate: the recorded 2026/09 overview text → 2026-09-28; the unbilled summary → null; a 2026-12 statement showing 01/05 → null (no real December case; named uncovered)', async () => {
      const aplus = await load('collector/aplus.mjs');
      if (typeof aplus.aplusPaymentDueDate !== 'function') throw new Error('collector/aplus.mjs exports no aplusPaymentDueDate');
      const overview = '※ 14日時点のご請求情報を表示しています。\n09/28 お支払い金額\n\n確定\n536,390円\n\nお引落としができない場合は';
      if (aplus.aplusPaymentDueDate(overview, '2026-09') !== '2026-09-28') throw new Error('recorded text → ' + aplus.aplusPaymentDueDate(overview, '2026-09'));
      if (aplus.aplusPaymentDueDate('未請求のご利用金額\n\n未確定\n841,413円', '2026-10') !== null) throw new Error('unbilled text did not give null');
      if (aplus.aplusPaymentDueDate('01/05 お支払い金額\n\n確定\n1,000円', '2026-12') !== null) throw new Error('a 2026-12 statement showing 01/05 did not give null');
      if (aplus.aplusPaymentDueDate('09/28 お支払い金額\n\n未確定\n536,390円', '2026-09') !== null) throw new Error('an unconfirmed total gave a date');
      if (aplus.aplusPaymentDueDate(null, '2026-09') !== null || aplus.aplusPaymentDueDate('', '2026-09') !== null) throw new Error('empty text');
      return '2026-09-28 / null / null (Dec→Jan uncovered) / null';
    });
    // ── B: parseAplus keeps the due date (real CSV when provided, synthetic otherwise) ──
    await leg('B parseAplus: metadata.paymentDueDate 2026-09-28 kept in reconciliation; 2026-13-01 → null and the import still parses; omitted → null; version stays 2', async () => {
      const { parseAplus, HEADERS } = await load('shared/aplus.mjs'); const { csvRows } = await load('shared/amex.mjs');
      let bytes, cards, total;
      if (REAL_CSV) {
        bytes = await readFile(REAL_CSV); cards = /\.json$/i.test(REAL_CARDS) ? JSON.parse(await readFile(REAL_CARDS, 'utf8')).cards.map(c => String(c).replace(/[^\d]/g, '').slice(-4)) : REAL_CARDS.split(',').map(s => s.trim()).filter(Boolean);
        const table = csvRows(bytes.toString('utf8').replace(/^﻿/, '')); table.shift(); total = table.reduce((n, cells) => n + (String(cells[7] || '').trim() === '' ? 0 : Number(String(cells[7]).replace(/,/g, ''))), 0);
      } else {
        const csvOf = rows => Buffer.from('﻿' + [HEADERS, ...rows].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
        bytes = csvOf([['≪****-****-****-1234≫', '20260801', 'Synthetic shop', '1200', 'Ｓ', '1', '01', '1200', '']]); cards = ['1234']; total = 1200;
      }
      const meta = { kind: 'statement', statementMonth: '2026-09', statementTotal: total };
      const withDate = parseAplus(bytes, cards, { ...meta, paymentDueDate: '2026-09-28' });
      if (withDate.reconciliation.paymentDueDate !== '2026-09-28') throw new Error('date not kept: ' + JSON.stringify(withDate.reconciliation));
      if (withDate.reconciliation.version !== 2 || withDate.reconciliation.statementTotal !== total) throw new Error('reconciliation changed: ' + JSON.stringify(withDate.reconciliation));
      const invalid = parseAplus(bytes, cards, { ...meta, paymentDueDate: '2026-13-01' }); if ((invalid.reconciliation.paymentDueDate ?? null) !== null) throw new Error('invalid date not null'); if (invalid.rows.length !== withDate.rows.length) throw new Error('invalid date changed the rows');
      const omitted = parseAplus(bytes, cards, meta); if ((omitted.reconciliation.paymentDueDate ?? null) !== null) throw new Error('omitted date not null');
      return (REAL_CSV ? 'recorded CSV sha256 ' + sha256(bytes).slice(0, 12) + '…, ' + withDate.rows.length + ' rows' : 'synthetic statement') + '; kept / null / null; version 2';
    });
    // ── N1: parseBillingMail on the synthetic rebuilds of the recorded mails ──
    await leg('N1 parseBillingMail: the confirmation → aplus bill-confirmed 2026-09-28 / amount / 2026-09; reminder, 方法変更, marketing and a 550円-only body → null; a second amount line for another day ignored, two for the same day → null; Amex 下4桁 1009 / 下5桁 11009 → bill-ready with the suffix and no amount; a non-issuer sender → null; DKIM/DMARC read from Authentication-Results', async () => {
      const billing = await load('shared/billing-mail.mjs');
      if (typeof billing.parseBillingMail !== 'function' || billing.BILLING_MAIL_PARSER !== 'billing-mail-1') throw new Error('shared/billing-mail.mjs exports no parseBillingMail / BILLING_MAIL_PARSER billing-mail-1');
      const f = new Function('Buffer', MAIL_BUILDERS + '\nreturn { aplusConfirmation, aplusReminder, aplusOther, amexConfirmation, AUTH_FAIL, MAILBOX };')(Buffer);
      const parse = m => billing.parseBillingMail(m.headers, m.text, { now: Date.now() });
      const c = parse(f.aplusConfirmation({ year: 2026, month: 9, day: 28, amount: 1234560 }));
      const expectC = { issuer: 'aplus', kind: 'bill-confirmed', claims: { statementMonth: '2026-09', dueDate: '2026-09-28', amount: 1234560, currency: 'JPY' } };
      if (JSON.stringify({ issuer: c?.issuer, kind: c?.kind, claims: c?.claims }) !== JSON.stringify(expectC)) throw new Error('confirmation → ' + JSON.stringify(c));
      if (c.periodKey !== 'statement:2026-09-01:2026-09-30') throw new Error('periodKey ' + c.periodKey);
      const jan = parse(f.aplusConfirmation({ year: 2027, month: 1, day: 27, amount: 5 })); if (jan?.claims?.statementMonth !== '2027-01' || jan.claims.dueDate !== '2027-01-27') throw new Error('January → ' + JSON.stringify(jan));
      if (parse(f.aplusReminder()) !== null) throw new Error('reminder parsed');
      if (parse(f.aplusOther()) !== null) throw new Error('方法変更 parsed');
      if (parse(f.aplusOther({ subject: 'キャンペーンのご案内', text: '9月28日のご請求金額は、1円です。' })) !== null) throw new Error('marketing parsed');
      const onlyFee = f.aplusConfirmation({ lines: ['◆ご請求明細の更新確定', '2026年9月28日お支払分のご請求金額が確定いたしましたので、ご案内申しあげます。', '◆お支払いが間に合わなかった場合の回収費用のご請求について', '回収費用として550円（税込）をご請求いたします。'] });
      if (parse(onlyFee) !== null) throw new Error('550円-only body parsed: ' + JSON.stringify(parse(onlyFee)));
      const otherDay = parse(f.aplusConfirmation({ year: 2026, month: 9, day: 28, amount: 100, extraAmountLine: '8月27日のご請求金額は、999円です。' })); if (otherDay?.claims?.amount !== 100) throw new Error('another day\'s amount line changed the amount: ' + JSON.stringify(otherDay));
      if (parse(f.aplusConfirmation({ year: 2026, month: 9, day: 28, amount: 100, extraAmountLine: '9月28日のご請求金額は、200円です。' })) !== null) throw new Error('two amount lines for the same day did not give null');
      const a4 = parse(f.amexConfirmation({ suffix: '1009', digits: 4 })), a5 = parse(f.amexConfirmation({ suffix: '11009', digits: 5, bracket: true }));
      for (const [a, s] of [[a4, '1009'], [a5, '11009']]) if (!a || a.issuer !== 'amex' || a.kind !== 'bill-ready' || a.claims.cardSuffix !== s || 'amount' in a.claims || 'dueDate' in a.claims) throw new Error('Amex → ' + JSON.stringify(a));
      if (parse(f.amexConfirmation({ suffix: '1009', digits: 5 })) !== null) throw new Error('a 4-digit suffix announced as 5 digits parsed');
      const spoof = f.aplusConfirmation({}); spoof.headers = { ...spoof.headers, from: 'Luxury Card <luxurycard@aplus.co.jp.example.invalid>' }; if (parse(spoof) !== null) throw new Error('a look-alike sender parsed');
      const auth = billing.authenticationResults(f.aplusConfirmation({}).headers); if (auth.dkim !== 'pass' || auth.dmarc !== 'pass') throw new Error('authentication ' + JSON.stringify(auth));
      const failed = billing.authenticationResults(f.aplusConfirmation({ auth: f.AUTH_FAIL }).headers); if (failed.dkim !== 'fail' || failed.dmarc !== 'fail') throw new Error('failed authentication ' + JSON.stringify(failed));
      const none = billing.authenticationResults({}); if (none.dkim !== 'none' || none.dmarc !== 'none') throw new Error('absent header ' + JSON.stringify(none));
      return 'confirmation, January, 4 nulls, 2 amount-line cases, Amex 4/5 digits, look-alike sender null, dkim/dmarc pass/fail/none';
    });
    // ── F-P2: the migration route is gone and no unscoped Payment writer remains ──
    await leg('F-P2 migration route: server/api/migrate-payment-dates.ts absent; no Payment.find( / findById / findByIdAndUpdate / updateOne outside the scoped sites under server/', async () => {
      if (await exists(path.join(REPO_ROOT, 'server/api/migrate-payment-dates.ts'))) throw new Error('server/api/migrate-payment-dates.ts is still present');
      const allowed = new Set(['server/api/payments/index.ts', 'server/api/payments/[id].ts', 'server/api/dashboard/stats.ts', 'server/services/financeBillService.ts', 'server/models/Payment.ts']);
      const hits = [];
      const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name === 'node_modules') continue; await walk(full); } else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.mutant-/.test(entry.name)) { const text = await readFile(full, 'utf8'); if (/\bPayment\.(find|findById|findByIdAndUpdate|findOneAndUpdate|updateOne|updateMany|create|deleteOne|deleteMany|findByIdAndDelete|findOneAndDelete|countDocuments)\b/.test(text)) { const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/'); if (!allowed.has(rel)) hits.push(rel); } } } };
      await walk(path.join(REPO_ROOT, 'server'));
      if (hits.length) throw new Error('Payment writers/readers outside the scoped sites: ' + hits.join(', '));
      return 'absent; Payment access only in ' + [...allowed].length + ' scoped files';
    });
    // ── F5: the customer package (continuation 10-plan, S9): the pure mail module is staged, the staged collector imports with the dependencies installed from its lock (a real npm ci into the staged copy, no junction), and removing that module from the staged copy is a specific import failure ──
    await leg('F5 package: ALLOWLIST stages shared/billing-mail.mjs; the staged collector/mail.mjs and collector/index.mjs import with installed dependencies; deleting the staged module breaks the staged mail import with ERR_MODULE_NOT_FOUND naming it', async () => {
      const { ALLOWLIST, stage } = await load('collector/package/stage.mjs');
      if (!ALLOWLIST.some(item => item.from === 'shared/billing-mail.mjs')) throw new Error('ALLOWLIST lacks shared/billing-mail.mjs');
      const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-calendar-staged-'));
      try {
        const into = path.join(temp, 'staged'), collectorDir = path.join(temp, 'collector-data'); await mkdir(collectorDir, { recursive: true });
        const { manifest } = await stage({ into, origin: 'https://omf.example', install: true, log: () => {} });
        for (const file of ['shared/billing-mail.mjs', 'collector/mail.mjs', 'collector/index.mjs', 'shared/amex.mjs']) if (!manifest.files[file]) throw new Error('not staged: ' + file);
        if (manifest.installed !== true || !(await exists(path.join(into, 'collector', 'node_modules', 'googleapis', 'package.json')))) throw new Error('dependencies not installed in the staged copy');
        const probe = async rel => {
          const script = "import('" + pathToFileURL(path.join(into, rel)).href + "').then(m => console.log(JSON.stringify({ ok: true, exports: Object.keys(m) })), e => console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })))";
          const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { cwd: into, windowsHide: true, timeout: 120000, env: { ...process.env, OMF_COLLECTOR_DIR: collectorDir, OMF_COLLECTOR_ORIGIN: 'https://omf.example' } });
          const line = String(stdout).split(/\r?\n/).find(l => l.startsWith('{')); if (!line) throw new Error('probe of ' + rel + ' printed nothing');
          return JSON.parse(line);
        };
        const mail = await probe('collector/mail.mjs'); if (!mail.ok) throw new Error('staged collector/mail.mjs does not import: ' + mail.code + ' ' + mail.message);
        for (const name of ['BillingMailbox', 'LoginMailbox', 'billingNotice']) if (!mail.exports.includes(name)) throw new Error('staged mail.mjs exports no ' + name);
        const index = await probe('collector/index.mjs'); if (!index.ok) throw new Error('staged collector/index.mjs does not import: ' + index.code + ' ' + index.message);
        for (const name of ['runAplusJob', 'uploadQuery', 'startCollector']) if (!index.exports.includes(name)) throw new Error('staged index.mjs exports no ' + name);
        await unlink(path.join(into, 'shared', 'billing-mail.mjs'));
        const broken = await probe('collector/mail.mjs');
        if (broken.ok) throw new Error('the staged mail module still imports without shared/billing-mail.mjs');
        if (broken.code !== 'ERR_MODULE_NOT_FOUND' || !/billing-mail\.mjs/.test(broken.message)) throw new Error('unexpected failure: ' + broken.code + ' ' + broken.message);
        return Object.keys(manifest.files).length + ' files staged, dependencies installed, mail/index import, removal → ' + broken.code;
      } finally { await rm(temp, { recursive: true, force: true }).catch(() => {}); }
    });
    // ── children ──
    let realCsvArgs = [];
    if (REAL_CSV) { if (!(await exists(REAL_CSV))) throw new Error('OMF_APLUS_REAL_CSV does not exist: ' + REAL_CSV); realCsvArgs = [REAL_CSV, REAL_CARDS]; }
    const h1 = await harness('h1', H1_HARNESS, realCsvArgs); foldChild(legs, 'H1 services/routes', h1);
    const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
    const hook = path.join(cache, 'calendar-card-bill-hook-' + process.pid + '.mjs'), stub = path.join(cache, 'calendar-card-bill-user-stub-' + process.pid + '.cjs');
    await writeFile(hook, H2_HOOK, { flag: 'wx' }); await writeFile(stub, H2_STUB, { flag: 'wx' });
    try { const h2 = await harness('h2', H2_HARNESS, [hook, stub]); foldChild(legs, 'H2 store E-P4', h2); } finally { await unlink(hook).catch(() => {}); await unlink(stub).catch(() => {}); }
    const h3 = await harness('h3', H3_HARNESS); foldChild(legs, 'H3 collector/mail N7', h3);
    const h4 = await harness('h4', H4_HARNESS); foldChild(legs, 'H4 built app', h4);
    // F4/B4: the database claim is only what the three database children reported about the servers they themselves
    // started (H2 runs no database); any child that died before or without database work makes it false.
    const dbChildren = [h1, h3, h4].map(r => r.receipt?.database || null);
    const databaseCoverage = { executed: dbChildren.every(d => d?.executed === true), ownedProcess: dbChildren.every(d => d?.ownedProcess === true) };
    const dbNote = 'database: ' + dbChildren.map((d, i) => ['H1', 'H3', 'H4'][i] + (d ? (d.executed ? ' executed ' + d.objects + ' objects in owned ' + d.name : ' no database work (' + (d.reason || 'none') + ')') : ' no receipt')).join(', ');
    const red = legs.filter(l => !l.ok);
    const lines = legs.map(l => l.name + ': ' + (l.ok ? 'ok' : 'RED') + (l.detail ? ' — ' + l.detail : ''));
    return { pass: red.length === 0, databaseCoverage, message: (red.length === 0 ? legs.length + ' legs green' : red.length + ' of ' + legs.length + ' legs red') + ' in ' + Math.round((Date.now() - started) / 1000) + 's' + (REAL_CSV ? ' (recorded CSV via env)' : ' (synthetic statement; OMF_APLUS_REAL_CSV unset)') + ' · ' + dbNote + ' · ' + lines.join(' · ') };
  }
};

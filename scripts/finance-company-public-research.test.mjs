// Company Navi public research: shared evidence/citation rules, the real public HTTPS checks of research-worker/http.mjs,
// the company public tools (capture transport, registry date/connection, literal T numbers), the worker capability report
// and an actual owned headless Chrome read with cleanup. Deterministic: DNS/HTTPS are replaced inside this process only,
// Chrome reads synthetic hosts answered by the interception, and no model, provider, account, mailbox or business send runs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import dnsPromises from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import {
  publicResearchTools, publicResearchLimits, validatePublicCapability, validateCompanyCitations, literalQuoteIn,
  registryUrl, validatePublicCapture, publicSourceUrl, tNumberPattern
} from '../shared/finance-company-public-research.mjs';
import { validateCompanyAssistantReply } from '../shared/finance-navi-features.mjs';
import { validateAssistantReply } from '../shared/finance-assistant.mjs';
import { publicUrl, publicGet } from '../research-worker/http.mjs';
import { CompanyPublicTools } from '../teaching-worker/company-public-tools.mjs';
import { TeachingWorker, publicResearchCapability } from '../teaching-worker/worker.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-public-research-'));
after(async () => { assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'omf-public-research-')); await rm(temp, { recursive: true, force: true }); });

test('public tools are a fixed company-only set with strict schemas and no private reach', () => {
  const names = publicResearchTools({ chrome: false }).map(t => t.name);
  assert.deepEqual(names, ['read_public_page', 'verify_invoice_registration', 'list_public_sources', 'read_public_source'], 'public-tools:catalogue');
  const withChrome = publicResearchTools({ chrome: true }).map(t => t.name);
  assert.deepEqual(withChrome, ['read_public_page', 'read_public_page_in_chrome', 'verify_invoice_registration', 'list_public_sources', 'read_public_source'], 'public-tools:chrome-only-when-capable');
  for (const t of publicResearchTools({ chrome: true })) { assert.equal(t.inputSchema.additionalProperties, false, 'public-tools:strict ' + t.name); assert.ok(!/mail|sheet|spreadsheet|issey|archive|checkout|login|password|file|shell/i.test(t.name), 'public-tools:no-private ' + t.name); }
  assert.ok(!Object.hasOwn(publicResearchTools({ chrome: true }).find(t => t.name === 'verify_invoice_registration').inputSchema.properties, 'organizationId'), 'public-tools:no-model-company');
  assert.equal(publicResearchLimits.citations, 8); assert.equal(publicResearchLimits.textChars, 60000);
});

test('capability reports are validated literally', () => {
  const good = { version: 1, webSearch: true, publicPage: true, chrome: false, registry: 'connection_required' };
  assert.deepEqual(validatePublicCapability(good), good);
  for (const bad of [null, [], { ...good, version: 2 }, { ...good, chrome: 'yes' }, { ...good, registry: 'verified' }, { ...good, publicPage: false }, { ...good, mailbox: true }, { ...good, webSearch: undefined }]) assert.throws(() => validatePublicCapability(bad), 'capability:' + JSON.stringify(bad));
});

test('citations name a source id, a literal quote and a claim; nothing else is accepted', () => {
  const id = 'a'.repeat(24), c = { sourceId: id, quote: '登録番号 T1234567890123', claim: '公表されている登録番号' };
  assert.deepEqual(validateCompanyCitations([c]), [c]);
  for (const bad of ['x', [{ ...c, verified: true }], [{ ...c, sourceId: 'not-an-id' }], [{ ...c, quote: ' ' }], [{ ...c, quote: 'x'.repeat(301) }], [{ ...c, claim: '' }], [{ ...c, quote: 'a\u0007b' }], Array.from({ length: 9 }, () => c), [{ ...c, url: 'https://evil.example/' }]]) assert.throws(() => validateCompanyCitations(bad), 'citations:' + JSON.stringify(bad).slice(0, 80));
  const reply = { kind: 'unclear', summary: '確認しました。', patch: {}, quotes: {} };
  assert.deepEqual(validateCompanyAssistantReply({ ...reply, citations: [c] }).citations, [c], 'citations:company-reply');
  assert.equal(Object.hasOwn(validateCompanyAssistantReply(reply), 'citations'), false);
  assert.equal(Object.hasOwn(validateCompanyAssistantReply({ ...reply, citations: [] }), 'citations'), false);
  assert.throws(() => validateCompanyAssistantReply({ ...reply, citations: [{ ...c, officialVerification: true }] }), 'citations:no-invented-flag');
  assert.equal(Object.hasOwn(validateAssistantReply({ ...reply, citations: [c] }), 'citations'), false, 'citations:legacy-unchanged');
});

test('a quote must be literal source text; whitespace may differ, characters and digits may not', () => {
  const text = '株式会社サンプル\n適格請求書発行事業者登録番号：T1234567890123\n所在地 東京都';
  assert.ok(literalQuoteIn(text, '登録番号：T1234567890123'));
  assert.ok(literalQuoteIn(text, '株式会社サンプル 適格請求書発行事業者登録番号：T1234567890123'), 'quote:whitespace-tolerant');
  assert.equal(literalQuoteIn(text, 'T1234567890124'), false, 'quote:digits-exact');
  assert.equal(literalQuoteIn(text, 'Ｔ1234567890123'), false, 'quote:no-width-folding');
  assert.equal(literalQuoteIn(text, '1234567890123 の法人番号'), false);
  assert.match('T1234567890123', tNumberPattern); assert.doesNotMatch('1234567890123', tNumberPattern); assert.doesNotMatch('T123456789012', tNumberPattern);
});

test('captures are shape-checked; registry evidence is canonical and never carries an application id', () => {
  const url = registryUrl('T1234567890123', '2026-08-01');
  assert.equal(url, 'https://web-api.invoice-kohyo.nta.go.jp/1/valid?number=T1234567890123&day=2026-08-01&type=21', 'registry:canonical');
  assert.ok(!url.includes('id='));
  const text = '本文', capture = { captureId: 'b'.repeat(32), kind: 'web', requestedUrl: 'https://example.com/', url: 'https://www.example.com/about', title: 'About', text, hash: sha(text), capturedAt: new Date().toISOString(), truncated: false };
  assert.deepEqual(validatePublicCapture(capture), capture);
  for (const bad of [{ ...capture, organizationId: 'x' }, { ...capture, kind: 'mail' }, { ...capture, url: 'http://example.com/' }, { ...capture, url: 'https://10.0.0.1/' }, { ...capture, url: 'https://user@example.com/' }, { ...capture, text: 'x'.repeat(60001) }, { ...capture, captureId: 'short' }, { ...capture, truncated: 'no' }]) assert.throws(() => validatePublicCapture(bad), 'capture:' + JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(validatePublicCapture({ captureId: 'c'.repeat(32), kind: 'web', requestedUrl: 'https://example.com/', failed: true, safeError: 'Public page returned HTTP 404' }).failed, true);
  for (const bad of ['http://example.com', 'https://localhost/', 'https://127.0.0.1/', 'https://192.168.1.2/', 'https://example.com:8443/', 'https://example.local/']) assert.equal(publicSourceUrl(bad), false, 'source-url:' + bad);
  assert.equal(publicSourceUrl('https://www.nta.go.jp/taxes/'), true);
});

// The real research-worker/http.mjs checks with DNS and HTTPS replaced in this process: public pinning, private redirects.
test('public HTTPS reads pin public DNS, follow public redirects to the final URL and refuse private targets', async () => {
  const lookup = dnsPromises.lookup, get = https.get, seen = [];
  const answers = { 'public.synthetic.example': '93.184.216.34', 'final.synthetic.example': '93.184.216.35', 'private.synthetic.example': '10.0.0.5' };
  dnsPromises.lookup = async host => { if (!answers[host]) { const e = Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; } return [{ address: answers[host], family: 4 }]; };
  https.get = (url, options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = error => req.emit('error', error);
    options.lookup(url.hostname, { all: true }, (_e, list) => seen.push({ host: url.hostname, pinned: list[0].address }));
    queueMicrotask(() => {
      const res = new EventEmitter(); res.resume = () => {};
      if (url.pathname === '/to-private') Object.assign(res, { statusCode: 302, headers: { location: 'https://private.synthetic.example/secret' } });
      else if (url.pathname === '/to-final') Object.assign(res, { statusCode: 301, headers: { location: 'https://final.synthetic.example/company' } });
      else Object.assign(res, { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      callback(res);
      if (res.statusCode === 200) { res.emit('data', Buffer.from('<title>T</title>会社概要')); res.emit('end'); }
    });
    return req;
  };
  try {
    for (const bad of ['http://public.synthetic.example/', 'https://localhost/', 'https://127.0.0.1/', 'https://user:pw@public.synthetic.example/', 'https://public.synthetic.example:8443/', 'https://private.synthetic.example/']) await assert.rejects(publicUrl(bad), undefined, 'http:refuse ' + bad);
    const final = await publicGet('https://public.synthetic.example/to-final');
    assert.equal(final.url, 'https://final.synthetic.example/company', 'http:final-url');
    assert.deepEqual(seen.map(s => s.pinned), ['93.184.216.34', '93.184.216.35'], 'http:dns-pinned');
    await assert.rejects(publicGet('https://public.synthetic.example/to-private'), /Private network page rejected/, 'http:private-redirect');
    await assert.rejects(publicGet('https://invoice-kohyo.nta.go.jp/regno-search/'), /official registry API tool|Private|ENOTFOUND/, 'http:registry-page-refused');
  } finally { dnsPromises.lookup = lookup; https.get = get; }
});

// A synthetic server stand-in for the trusted same-job route: records every posted body; the token is only a header.
function server({ failFirst = false } = {}) {
  const posts = [], headers = [], attempts = []; let first = failFirst;
  const request = async (url, options) => {
    attempts.push(options.body);
    if (first) { first = false; throw Object.assign(Error('socket hang up'), { name: 'TypeError' }); }
    const body = JSON.parse(options.body); posts.push(body); headers.push(options.headers);
    assert.equal(url, 'https://omf.example.invalid/api/finance-chat/worker/workspace/0123456789abcdef01234567/sources');
    const json = body.op === 'prepare' ? { number: body.target.number, date: '2026-08-01', dateAuthority: 'transaction_date', canonicalUrl: registryUrl(body.target.number, '2026-08-01') }
      : body.op === 'capture' ? { source: { id: 'd'.repeat(24), kind: body.capture.kind, status: body.capture.failed ? (body.capture.reason === 'connection_required' ? 'unavailable' : 'failed') : 'captured', url: body.capture.url, title: body.capture.title, capturedAt: body.capture.capturedAt, truncated: body.capture.truncated, evidence: body.capture.kind === 'registry' ? 'official_registry_observation' : 'published_page', registry: body.capture.kind === 'registry' && !body.capture.failed ? { number: body.capture.target.number, asOf: '2026-08-01', active: true } : null }, duplicate: false }
        : body.op === 'list' ? { sources: [] } : { source: { id: body.sourceId }, text: 'x', offset: 0, nextOffset: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(json) };
  };
  return { posts, headers, attempts, request };
}
const base = { sourcesEndpoint: 'https://omf.example.invalid/api/finance-chat/worker/workspace/0123456789abcdef01234567/sources', lease: 'synthetic-lease', token: 'omft_' + 'e'.repeat(64), profileDirectory: path.join(temp, 'profile') };

test('a public page read captures the final URL, literal text, hash and a stable capture id; a lost HTTP reply is retried with the same body', async () => {
  const s = server({ failFirst: true }), gets = [];
  const tools = new CompanyPublicTools({ ...base, chrome: false }, { request: s.request, get: async (url, options) => { gets.push({ url, options }); return { url: 'https://www.synthetic.example/company', mimeType: 'text/html', bytes: Buffer.from('<html><title>会社概要</title><body><p>株式会社サンプル</p><p>登録番号 T1234567890123</p><script>secret()</script></body></html>') }; }, wait: async () => {} });
  assert.deepEqual(tools.definitions().map(t => t.name), ['read_public_page', 'verify_invoice_registration', 'list_public_sources', 'read_public_source']);
  const result = await tools.call('read_public_page', { url: 'https://synthetic.example/' });
  assert.equal(gets.length, 1, 'tools:one-page-read');
  assert.equal(s.posts.length, 1); const capture = s.posts[0].capture;
  assert.equal(s.posts[0].op, 'capture'); assert.equal(s.posts[0].lease, 'synthetic-lease');
  assert.equal(capture.url, 'https://www.synthetic.example/company', 'tools:final-url'); assert.equal(capture.requestedUrl, 'https://synthetic.example/');
  assert.ok(capture.text.includes('登録番号 T1234567890123')); assert.ok(!capture.text.includes('secret()'), 'tools:script-removed');
  assert.equal(capture.hash, sha(capture.text)); assert.match(capture.captureId, /^[a-f0-9]{32}$/); assert.equal(capture.truncated, false);
  assert.equal(result.sourceId, 'd'.repeat(24)); assert.ok(result.text.includes('T1234567890123'));
  assert.ok(s.headers.every(h => h.Authorization === 'Bearer ' + base.token)); assert.ok(!JSON.stringify(s.posts).includes(base.token), 'tools:token-header-only');
  assert.equal(s.attempts.length, 2); assert.equal(s.attempts[0], s.attempts[1], 'tools:lost-reply-same-body');
  const s2 = server();
  const again = new CompanyPublicTools({ ...base, chrome: false }, { request: s2.request, get: async () => ({ url: 'https://www.synthetic.example/company', mimeType: 'text/html', bytes: Buffer.from('<html><title>会社概要</title><body><p>株式会社サンプル</p><p>登録番号 T1234567890123</p><script>secret()</script></body></html>') }), wait: async () => {} });
  await again.call('read_public_page', { url: 'https://synthetic.example/' });
  assert.equal(s2.posts[0].capture.captureId, capture.captureId, 'tools:same-content-same-capture');
});

test('Japanese pages are decoded by their own declaration before the literal text is hashed', async () => {
  const { decodePage } = await import('../teaching-worker/company-public-tools.mjs');
  const sjis = Buffer.concat([Buffer.from('<html><head><meta charset="Shift_JIS"><title>x</title></head><body>'), Buffer.from([0x89, 0xEF, 0x8E, 0xD0]), Buffer.from('</body></html>')]);
  assert.ok(decodePage(sjis).includes('会社'), 'decode:shift-jis-meta');
  assert.ok(decodePage(Buffer.concat([Buffer.from('<html><body>'), Buffer.from([0x89, 0xEF, 0x8E, 0xD0]), Buffer.from('</body></html>')])).includes('会社'), 'decode:undeclared-shift-jis');
  assert.ok(decodePage(Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">'), Buffer.from([0xB2, 0xF1, 0xBC, 0xD2])])).includes('会社'), 'decode:euc-jp');
  assert.ok(decodePage(Buffer.from('<p>登録番号 T1234567890123</p>')).includes('登録番号 T1234567890123'), 'decode:utf8');
  const s = server();
  const tools = new CompanyPublicTools({ ...base, chrome: false }, { request: s.request, get: async () => ({ url: 'https://old.synthetic.example/', mimeType: 'text/html', bytes: sjis }), wait: async () => {} });
  await tools.call('read_public_page', { url: 'https://old.synthetic.example/' });
  assert.ok(s.posts[0].capture.text.includes('会社')); assert.equal(s.posts[0].capture.hash, sha(s.posts[0].capture.text), 'decode:hash-of-decoded-text');
});

test('a refused or failed read is recorded as failed activity and is never a finding', async () => {
  const s = server();
  const tools = new CompanyPublicTools({ ...base, chrome: false }, { request: s.request, get: async () => { throw Error('Private network page rejected'); }, wait: async () => {} });
  await assert.rejects(tools.call('read_public_page', { url: 'https://private.synthetic.example/' }), /Private network page rejected/);
  assert.equal(s.posts.length, 1); assert.equal(s.posts[0].capture.failed, true, 'tools:failure-recorded'); assert.equal(s.posts[0].capture.text, undefined);
  await assert.rejects(tools.call('read_public_page', { url: 'not a url' })); await assert.rejects(tools.call('read_public_page', {}));
  await assert.rejects(tools.call('read_public_page_in_chrome', { url: 'https://synthetic.example/' }), /Unknown|not available/, 'tools:no-chrome-without-capability');
  await assert.rejects(tools.call('search_mail', { terms: 'x' }), /Unknown/);
});

test('registry verification: literal T numbers only, server-prepared date, no fake green without the NTA connection, canonical evidence without the application id', async () => {
  let s = server(), gets = [];
  const offline = new CompanyPublicTools({ ...base, chrome: false, ntaApplicationId: '' }, { request: s.request, get: async url => { gets.push(url); throw Error('must not be called'); }, wait: async () => {} });
  for (const number of ['1234567890123', 'T123', 'T12345678901234', 'Ｔ1234567890123']) { await assert.rejects(offline.call('verify_invoice_registration', { number }), /literal T/, 'registry:literal ' + number); }
  assert.equal(s.posts.length, 0);
  const result = await offline.call('verify_invoice_registration', { number: 'T1234567890123', transactionId: 'f'.repeat(24) });
  assert.equal(result.status, 'connection_required', 'registry:no-fake-green'); assert.equal(result.asOf, '2026-08-01'); assert.equal(result.dateAuthority, 'transaction_date');
  assert.deepEqual(s.posts.map(p => p.op), ['prepare', 'capture']); assert.deepEqual(s.posts[0].target, { number: 'T1234567890123', transactionId: 'f'.repeat(24) });
  assert.equal(s.posts[1].capture.failed, true); assert.equal(s.posts[1].capture.reason, 'connection_required'); assert.equal(gets.length, 0);
  s = server(); gets = [];
  const appId = 'SYNTHETICAPPID12345';
  const raw = JSON.stringify({ lastUpdateDate: '2026-08-01', count: '1', divideNumber: '1', divideSize: '1', announcement: [{ sequenceNumber: '1', registratedNumber: 'T1234567890123', process: '01', correct: '0', kind: '2', country: '1', latest: '1', registrationDate: '2023-10-01', updateDate: '2023-10-01', disposalDate: '', expireDate: '', address: '東京都千代田区', addressPrefectureCode: '13', addressCityCode: '101', addressRequest: '', addressRequestPrefectureCode: '', addressRequestCityCode: '', kana: '', name: '株式会社サンプル', nameReceived: '', popularName_previousName: '', traditionalName: '', addressInside: '', addressInsidePrefectureCode: '', addressInsideCityCode: '', tradeName: '', popularName: '' }] });
  const online = new CompanyPublicTools({ ...base, chrome: false, ntaApplicationId: appId }, { request: s.request, get: async (url, options) => { gets.push({ url, options }); return { url, mimeType: 'application/json', bytes: Buffer.from(raw) }; }, wait: async () => {} });
  const verified = await online.call('verify_invoice_registration', { number: 'T1234567890123', transactionId: 'f'.repeat(24) });
  assert.equal(gets.length, 1); assert.equal(gets[0].options.registry, true); assert.ok(gets[0].url.includes('id=' + appId)); assert.ok(gets[0].url.includes('day=2026-08-01'), 'registry:prepared-date');
  const capture = s.posts.find(p => p.op === 'capture').capture;
  assert.equal(capture.kind, 'registry'); assert.equal(capture.url, registryUrl('T1234567890123', '2026-08-01'), 'registry:canonical-url');
  assert.ok(!JSON.stringify(s.posts).includes(appId), 'registry:application-id-private'); assert.ok(!JSON.stringify(verified).includes(appId));
  assert.equal(verified.registry.number, 'T1234567890123');
});

test('the worker reports actual capability with each workspace claim, and only there', async () => {
  assert.equal(await publicResearchCapability({ publicResearch: false }), null, 'capability:opt-out');
  assert.deepEqual(await publicResearchCapability({}, { findChrome: () => null }), { version: 1, webSearch: true, publicPage: true, chrome: false, registry: 'connection_required' });
  assert.deepEqual(await publicResearchCapability({ ntaApplicationId: 'SYNTHETICAPPID12345' }, { findChrome: () => 'C:/chrome.exe' }), { version: 1, webSearch: true, publicPage: true, chrome: true, registry: 'configured' });
  assert.equal((await publicResearchCapability({}, { findChrome: () => { throw Error('missing dependency'); } })).chrome, false, 'capability:dependency-missing');
  const calls = [];
  const worker = new TeachingWorker({ baseUrl: 'http://127.0.0.1:8080', token: 'private' }, { request: async (url, o) => { calls.push({ route: url.split('/worker/')[1], body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ job: null }) }; }, capability: async () => ({ version: 1, webSearch: true, publicPage: true, chrome: false, registry: 'connection_required' }), log: () => {} });
  await worker.cycle(); await worker.cycle();
  assert.deepEqual(calls.map(c => c.route), ['workspace-claim', 'claim', 'workspace-claim', 'claim']);
  assert.deepEqual(calls[0].body, { capabilities: { publicResearch: { version: 1, webSearch: true, publicPage: true, chrome: false, registry: 'connection_required' } } });
  assert.deepEqual(calls[1].body, {}, 'capability:purchase-claim-unchanged');
  const none = []; await new TeachingWorker({ baseUrl: 'http://127.0.0.1:8080', token: 'private', publicResearch: false }, { request: async (url, o) => { none.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ job: null }) }; }, log: () => {} }).cycle();
  assert.deepEqual(none[0], {}, 'capability:none-when-off');
});

// Actual installed Chrome, headless, on an owned profile: GET-only interception, final URL after a redirect, and the owned
// browser process ends after the read. Pages are answered by the injected reader; nothing leaves this machine.
test('owned headless Chrome reads the final public URL and closes its own process', { timeout: 120000 }, async () => {
  const { readBrowserPage } = await import('../research-worker/browser.mjs');
  const { ownedBrowsers, findChrome } = await import('../collector/browser.mjs');
  assert.ok(findChrome(), 'chrome:installed');
  const asked = [];
  const pages = { 'https://start.synthetic-omf.invalid/': { url: 'https://final.synthetic-omf.invalid/company', body: '<html><head><title>会社概要</title></head><body><p id="m">登録番号 T1234567890123</p><script>fetch("/beacon",{method:"POST",body:"x"});var s=document.createElement("p");s.textContent="動的な説明";document.body.appendChild(s)</script></body></html>' } };
  const get = async url => { asked.push(url); const p = pages[url] || (url === 'https://final.synthetic-omf.invalid/company' ? pages['https://start.synthetic-omf.invalid/'] : null); if (!p) throw Error('Public page returned HTTP 404'); return { url: p.url, mimeType: 'text/html', bytes: Buffer.from(p.body) }; };
  const profile = path.join(temp, 'owned-chrome');
  const page = await readBrowserPage(profile, 'https://start.synthetic-omf.invalid/', { headless: true, close: true, resolveFinal: true, labelUtf8: true, get, check: async () => {} });
  assert.equal(page.url, 'https://final.synthetic-omf.invalid/company', 'chrome:final-url');
  assert.ok(page.text.includes('登録番号 T1234567890123')); assert.ok(page.text.includes('動的な説明'), 'chrome:javascript-rendered');
  assert.ok(!asked.some(u => u.includes('/beacon')), 'chrome:get-only');
  const mine = ownedBrowsers().filter(b => path.resolve(b.profile) === path.resolve(profile));
  assert.ok(mine.length >= 1); assert.ok(mine.every(b => !b.connected), 'chrome:closed');
  for (const b of mine) assert.throws(() => process.kill(b.pid, 0), undefined, 'chrome:process-ended');
  await rm(profile, { recursive: true, force: true }); assert.ok(!(await readdir(temp)).includes('owned-chrome'), 'chrome:profile-removable');
});

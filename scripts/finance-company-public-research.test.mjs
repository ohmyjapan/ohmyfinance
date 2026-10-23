// Company Navi public research: shared evidence/citation rules, the real public HTTPS checks of research-worker/http.mjs (the
// public NTA registry website read as an ordinary page, the registry API host refused for ordinary reads), the company public
// tools (capture transport, registry date/connection, literal T numbers), the supplier research page reader, the worker
// capability report and actual owned headless Chrome reads with cleanup. Deterministic: DNS/HTTPS are replaced inside this
// process only, Chrome requests are answered by the interception through the reader, and no model, provider, account, mailbox
// or business send runs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import dnsPromises from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import {
  publicResearchTools, publicResearchLimits, validatePublicCapability, validateCompanyCitations, literalQuoteIn,
  registryUrl, validatePublicCapture, publicSourceUrl, tNumberPattern, evidenceOf
} from '../shared/finance-company-public-research.mjs';
import * as hostRules from '../shared/finance-company-public-research.mjs';
import { validateCompanyAssistantReply } from '../shared/finance-navi-features.mjs';
import { validateAssistantReply } from '../shared/finance-assistant.mjs';
import { publicUrl, publicGet } from '../research-worker/http.mjs';
import { CompanyPublicTools } from '../teaching-worker/company-public-tools.mjs';
import { TeachingWorker, publicResearchCapability } from '../teaching-worker/worker.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-public-research-'));
after(async () => { assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'omf-public-research-')); await rm(temp, { recursive: true, force: true }); });

// Controlled public DNS and HTTPS for the real research-worker/http.mjs, inside this process only (documentation addresses;
// no request leaves the machine). The NTA invoice-registry public website, its bare origin, the registry Web-API host and an
// unrelated registry subdomain all have public DNS answers, so a refusal can only come from the reader's host policy.
const siteUrl = 'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=1234567890123';
const bareSiteUrl = 'https://invoice-kohyo.nta.go.jp/regno-search/';
const apiUrl = registryUrl('T1234567890123', '2026-08-01');
// A DNS terminal dot names the same host: the website stays a public page, the API host stays refused.
const siteDotUrl = 'https://www.invoice-kohyo.nta.go.jp./regno-search/detail?selRegNo=1234567890123';
const apiDotUrl = 'https://web-api.invoice-kohyo.nta.go.jp./1/valid?number=T1234567890123&day=2026-08-01&type=21';
const registryRaw = JSON.stringify({ lastUpdateDate: '2026-08-01', count: '1', divideNumber: '1', divideSize: '1', announcement: [{ sequenceNumber: '1', registratedNumber: 'T1234567890123', process: '01', correct: '0', kind: '2', country: '1', latest: '1', registrationDate: '2023-10-01', updateDate: '2023-10-01', disposalDate: '', expireDate: '', address: '東京都千代田区', addressPrefectureCode: '13', addressCityCode: '101', addressRequest: '', addressRequestPrefectureCode: '', addressRequestCityCode: '', kana: '', name: '株式会社サンプル', nameReceived: '', popularName_previousName: '', traditionalName: '', addressInside: '', addressInsidePrefectureCode: '', addressInsideCityCode: '', tradeName: '', popularName: '' }] });
const siteHtml = '<html><head><meta charset="utf-8"><title>適格請求書発行事業者公表サイト</title><script src="/regno-search/assets/site.js" defer></script></head><body><h1>株式会社サンプルの情報</h1><p>登録番号 T1234567890123</p><p>登録年月日 令和5年10月1日</p><div id="rendered"></div></body></html>';
const siteScript = 'document.getElementById("rendered").textContent="公表サイトのスクリプト表示";fetch("' + apiUrl + '").catch(()=>{});fetch("/regno-search/beacon",{method:"POST",body:"x"}).catch(()=>{});';
// A legitimate read that is refused fails as that positive's own labelled assertion, not as an unlabelled thrown error.
const allowed = (promise, label) => promise.catch(error => assert.fail(label + ' refused: ' + error.message));
function syntheticNetwork() {
  const lookup = dnsPromises.lookup, get = https.get, seen = [], resolved = [];
  const answers = { 'public.synthetic.example': '93.184.216.34', 'final.synthetic.example': '93.184.216.35', 'private.synthetic.example': '10.0.0.5', 'www.invoice-kohyo.nta.go.jp': '203.0.113.10', 'invoice-kohyo.nta.go.jp': '203.0.113.11', 'web-api.invoice-kohyo.nta.go.jp': '203.0.113.12', 'other.invoice-kohyo.nta.go.jp': '203.0.113.13', 'www.invoice-kohyo.nta.go.jp.': '203.0.113.10', 'web-api.invoice-kohyo.nta.go.jp.': '203.0.113.12', 'other.invoice-kohyo.nta.go.jp.': '203.0.113.13' };
  dnsPromises.lookup = async host => { resolved.push(host); if (!answers[host]) { const e = Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; } return [{ address: answers[host], family: 4 }]; };
  const routes = {
    'public.synthetic.example/to-private': { status: 302, location: 'https://private.synthetic.example/secret' },
    'public.synthetic.example/to-final': { status: 301, location: 'https://final.synthetic.example/company' },
    'public.synthetic.example/to-registry-site': { status: 302, location: siteUrl },
    'public.synthetic.example/to-registry-site-dot': { status: 302, location: siteDotUrl },
    'public.synthetic.example/to-api-dot': { status: 302, location: apiDotUrl },
    'www.invoice-kohyo.nta.go.jp/regno-search/detail': { type: 'text/html; charset=utf-8', body: siteHtml },
    'www.invoice-kohyo.nta.go.jp/regno-search/assets/site.js': { type: 'application/javascript', body: siteScript },
    'www.invoice-kohyo.nta.go.jp/regno-search/to-api': { status: 302, location: apiUrl },
    'invoice-kohyo.nta.go.jp/regno-search/': { type: 'text/html; charset=utf-8', body: '<html><head><title>公表サイト</title></head><body><p>登録番号を検索</p></body></html>' },
    'web-api.invoice-kohyo.nta.go.jp/1/valid': { type: 'application/json', body: registryRaw }
  };
  https.get = (url, options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = error => req.emit('error', error);
    options.lookup(url.hostname, { all: true }, (_e, list) => seen.push({ host: url.hostname, path: url.pathname, query: url.search, pinned: list[0].address }));
    queueMicrotask(() => {
      const res = new EventEmitter(), route = routes[url.hostname.replace(/\.$/, '') + url.pathname]; res.resume = () => {};
      if (route?.location) Object.assign(res, { statusCode: route.status, headers: { location: route.location } });
      else Object.assign(res, { statusCode: 200, headers: { 'content-type': route?.type || 'text/html; charset=utf-8' } });
      callback(res);
      if (res.statusCode === 200) { res.emit('data', Buffer.from(route?.body ?? '<title>T</title>会社概要')); res.emit('end'); }
    });
    return req;
  };
  return { seen, resolved, restore: () => { dnsPromises.lookup = lookup; https.get = get; } };
}

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

test('a web or Chrome capture of the public NTA registry website is published evidence; API addresses and forged registry targets are refused', () => {
  const text = '株式会社サンプルの情報\n登録番号 T1234567890123';
  const capture = (kind, requestedUrl, url, extra = {}) => ({ captureId: 'e'.repeat(32), kind, requestedUrl, url, title: '適格請求書発行事業者公表サイト', text, hash: sha(text), capturedAt: new Date().toISOString(), truncated: false, ...extra });
  for (const kind of ['web', 'chrome']) {
    for (const [requested, final] of [[siteUrl, siteUrl], [bareSiteUrl, bareSiteUrl], ['https://public.synthetic.example/to-registry-site', siteUrl], [siteDotUrl, siteDotUrl], ['https://public.synthetic.example/to-registry-site-dot', siteDotUrl]]) {
      const c = capture(kind, requested, final);
      assert.deepEqual(validatePublicCapture(c), c, 'capture:registry-website ' + kind + ' ' + requested);
    }
    for (const [requested, final] of [[apiUrl, apiUrl], [siteUrl, apiUrl], [apiUrl, siteUrl], ['https://web-api.invoice-kohyo.nta.go.jp/', siteUrl], [siteUrl, 'https://other.invoice-kohyo.nta.go.jp/x'], [apiDotUrl, apiDotUrl], [siteUrl, apiDotUrl], [apiDotUrl, siteDotUrl], ['https://other.invoice-kohyo.nta.go.jp./x', siteUrl]]) {
      assert.throws(() => validatePublicCapture(capture(kind, requested, final)), /Invalid capture/, 'capture:api-host-refused ' + kind + ' ' + requested + ' ' + final);
    }
    assert.throws(() => validatePublicCapture(capture(kind, siteUrl, siteUrl, { target: { number: 'T1234567890123' } })), /Invalid capture/, 'capture:website-not-registry-evidence ' + kind);
  }
  // The exported host predicates canonicalize the DNS terminal dot and keep the same two categories.
  for (const [host, registry, website] of [['www.invoice-kohyo.nta.go.jp', true, true], ['www.invoice-kohyo.nta.go.jp.', true, true], ['invoice-kohyo.nta.go.jp.', true, true], ['web-api.invoice-kohyo.nta.go.jp', true, false], ['web-api.invoice-kohyo.nta.go.jp.', true, false], ['WEB-API.INVOICE-KOHYO.NTA.GO.JP.', true, false], ['web-api.invoice-kohyo.nta.go.jp..', true, false], ['www.invoice-kohyo.nta.go.jp.evil.example', false, false], ['www.nta.go.jp.', false, false]]) {
    assert.equal(typeof hostRules.isRegistryWebsiteHost, 'function', 'host:website-predicate-exported');
    assert.deepEqual([hostRules.isRegistryHost(host), hostRules.isRegistryWebsiteHost(host)], [registry, website], 'host:categories ' + host);
  }
  assert.equal(evidenceOf('web'), 'published_page'); assert.equal(evidenceOf('chrome'), 'published_page'); assert.equal(evidenceOf('registry'), 'official_registry_observation');
  // Registry evidence keeps its own shape: a registry capture still needs its literal target (the server then requires the canonical URL).
  assert.throws(() => validatePublicCapture(capture('registry', siteUrl, siteUrl)), /Invalid capture/, 'capture:registry-needs-target');
});

// The real research-worker/http.mjs checks with DNS and HTTPS replaced in this process: public pinning, private redirects.
test('public HTTPS reads pin public DNS, follow public redirects to the final URL and refuse private targets', async () => {
  const net = syntheticNetwork(), seen = net.seen;
  try {
    for (const bad of ['http://public.synthetic.example/', 'https://localhost/', 'https://127.0.0.1/', 'https://user:pw@public.synthetic.example/', 'https://public.synthetic.example:8443/', 'https://private.synthetic.example/']) await assert.rejects(publicUrl(bad), undefined, 'http:refuse ' + bad);
    const final = await publicGet('https://public.synthetic.example/to-final');
    assert.equal(final.url, 'https://final.synthetic.example/company', 'http:final-url');
    assert.deepEqual(seen.map(s => s.pinned), ['93.184.216.34', '93.184.216.35'], 'http:dns-pinned');
    await assert.rejects(publicGet('https://public.synthetic.example/to-private'), /Private network page rejected/, 'http:private-redirect');
  } finally { net.restore(); }
});

// The anonymous NTA invoice-registry website is an ordinary public page for the shared reader; the registry Web-API host (with or
// without an application id) and other registry subdomains stay with the official API path only, including after a redirect.
test('the shared reader reads the public NTA registry website and still refuses the registry API host for ordinary reads', async () => {
  const net = syntheticNetwork(), seen = net.seen;
  try {
    const site = await allowed(publicGet(siteUrl), 'http:registry-website-readable');
    assert.equal(site.url, siteUrl, 'http:registry-website-readable'); assert.equal(site.mimeType, 'text/html');
    assert.ok(site.bytes.toString('utf8').includes('登録番号 T1234567890123'), 'http:registry-website-bytes');
    assert.deepEqual(seen.at(-1), { host: 'www.invoice-kohyo.nta.go.jp', path: '/regno-search/detail', query: '?selRegNo=1234567890123', pinned: '203.0.113.10' }, 'http:registry-website-dns-pinned');
    assert.equal((await allowed(publicGet(bareSiteUrl), 'http:registry-website-bare-origin')).url, bareSiteUrl, 'http:registry-website-bare-origin');
    const redirected = await allowed(publicGet('https://public.synthetic.example/to-registry-site'), 'http:redirect-to-registry-website');
    assert.equal(redirected.url, siteUrl, 'http:redirect-to-registry-website');
    // The DNS terminal-dot spelling of the website is the same public page (pinned to the same answer).
    assert.equal((await allowed(publicGet(siteDotUrl), 'http:registry-website-terminal-dot')).url, siteDotUrl, 'http:registry-website-terminal-dot');
    assert.equal(seen.at(-1).pinned, '203.0.113.10', 'http:registry-website-terminal-dot');
    assert.equal((await allowed(publicGet('https://public.synthetic.example/to-registry-site-dot'), 'http:redirect-to-registry-website-terminal-dot')).url, siteDotUrl, 'http:redirect-to-registry-website-terminal-dot');
    const reached = seen.length;
    for (const bad of [apiUrl, apiUrl + '&id=SYNTHETICAPPID12345', 'https://web-api.invoice-kohyo.nta.go.jp/', 'https://other.invoice-kohyo.nta.go.jp/regno-search/', apiDotUrl, apiDotUrl + '&id=SYNTHETICAPPID12345', 'https://other.invoice-kohyo.nta.go.jp./regno-search/']) {
      await assert.rejects(publicGet(bad), /^Error: Use the official registry API tool$/, 'http:api-host-refused ' + bad);
    }
    assert.ok(net.resolved.includes('web-api.invoice-kohyo.nta.go.jp') && net.resolved.includes('other.invoice-kohyo.nta.go.jp') && net.resolved.includes('web-api.invoice-kohyo.nta.go.jp.'), 'http:api-host-resolved-publicly');
    await assert.rejects(publicGet('https://www.invoice-kohyo.nta.go.jp/regno-search/to-api'), /^Error: Use the official registry API tool$/, 'http:redirect-to-api-refused');
    await assert.rejects(publicGet('https://public.synthetic.example/to-api-dot'), /^Error: Use the official registry API tool$/, 'http:redirect-to-api-terminal-dot-refused');
    assert.equal(seen.length, reached + 2, 'http:api-host-never-requested'); assert.ok(!seen.some(s => /^(web-api|other)\.invoice-kohyo\.nta\.go\.jp\.?$/.test(s.host)), 'http:api-host-never-requested');
    // The credentialed verification path itself is unchanged: registry reads reach only the API, without following redirects.
    const api = await publicGet(apiUrl, { registry: true });
    assert.equal(JSON.parse(api.bytes.toString('utf8')).announcement[0].registratedNumber, 'T1234567890123', 'http:registry-api-path-kept');
    await assert.rejects(publicGet('https://www.invoice-kohyo.nta.go.jp/regno-search/to-api', { registry: true }), /Redirect limit reached/, 'http:registry-no-redirects');
  } finally { net.restore(); }
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

// The company tool with the real shared reader (no injected get): the public website is captured as a published page; an
// ordinary read of the API address, with or without an id, is refused activity and never a capture.
test('read_public_page captures the public NTA registry website through the real reader and refuses API addresses', async () => {
  const net = syntheticNetwork(), s = server();
  try {
    const tools = new CompanyPublicTools({ ...base, chrome: false }, { request: s.request, wait: async () => {} });
    const result = await allowed(tools.call('read_public_page', { url: siteUrl }), 'tools:registry-website-capture');
    const capture = s.posts[0].capture;
    assert.deepEqual(validatePublicCapture(capture), capture, 'tools:registry-website-capture-valid');
    assert.equal(capture.kind, 'web'); assert.equal(capture.url, siteUrl, 'tools:registry-website-final-url'); assert.equal(capture.requestedUrl, siteUrl);
    assert.equal(capture.target, undefined, 'tools:registry-website-no-target'); assert.equal(capture.hash, sha(capture.text));
    assert.ok(capture.text.includes('登録番号 T1234567890123') && capture.text.includes('登録年月日 令和5年10月1日'), 'tools:registry-website-literal-text');
    assert.equal(result.evidence, 'published_page'); assert.equal(result.registry, undefined, 'tools:registry-website-no-registry-state');
    const viaRedirect = await tools.call('read_public_page', { url: 'https://public.synthetic.example/to-registry-site' });
    assert.equal(s.posts[1].capture.url, siteUrl, 'tools:redirect-final-website'); assert.equal(viaRedirect.evidence, 'published_page');
    const before = s.posts.length;
    for (const bad of [apiUrl, apiUrl + '&id=SYNTHETICAPPID12345', 'https://www.invoice-kohyo.nta.go.jp/regno-search/to-api', apiDotUrl]) {
      await assert.rejects(tools.call('read_public_page', { url: bad }), /^Error: Use the official registry API tool$/, 'tools:api-address-refused ' + bad);
    }
    const refused = s.posts.slice(before).map(p => p.capture);
    assert.equal(refused.length, 4); assert.ok(refused.every(c => c.failed === true && c.safeError === 'Use the official registry API tool' && c.text === undefined && c.kind === 'web'), 'tools:api-address-failed-activity-only');
    assert.ok(!net.seen.some(x => /^web-api\.invoice-kohyo\.nta\.go\.jp\.?$/.test(x.host)), 'tools:api-host-never-requested');
  } finally { net.restore(); }
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

// The company Chrome tool with the real reader and real check (no injected get/check): every Chrome request of the public NTA
// registry website — the document and its script — is answered through the shared reader with pinned DNS; the page's own call to
// the registry API host and its POST are refused; the capture is a published page; the owned browser ends after the read.
test('owned headless Chrome captures the public NTA registry website as a published page and refuses its API calls', { timeout: 120000 }, async () => {
  const { ownedBrowsers } = await import('../collector/browser.mjs');
  const net = syntheticNetwork(), s = server(), profile = path.join(temp, 'owned-chrome-registry-site');
  try {
    const tools = new CompanyPublicTools({ ...base, chrome: true, profileDirectory: profile }, { request: s.request, wait: async () => {} });
    const result = await allowed(tools.call('read_public_page_in_chrome', { url: siteUrl }), 'chrome:registry-website-capture');
    const capture = s.posts[0].capture;
    assert.deepEqual(validatePublicCapture(capture), capture, 'chrome:registry-website-capture-valid');
    assert.equal(capture.kind, 'chrome'); assert.equal(capture.url, siteUrl, 'chrome:registry-website-final-url'); assert.equal(capture.target, undefined);
    assert.ok(capture.text.includes('登録番号 T1234567890123'), 'chrome:registry-website-literal-text');
    assert.ok(capture.text.includes('公表サイトのスクリプト表示'), 'chrome:registry-website-script-through-reader');
    assert.equal(result.evidence, 'published_page'); assert.equal(result.registry, undefined, 'chrome:registry-website-no-registry-state');
    const site = net.seen.filter(x => x.host === 'www.invoice-kohyo.nta.go.jp');
    assert.ok(site.some(x => x.path === '/regno-search/detail') && site.some(x => x.path === '/regno-search/assets/site.js'), 'chrome:document-and-script-through-reader');
    assert.ok(site.every(x => x.pinned === '203.0.113.10'), 'chrome:pinned-dns');
    assert.ok(!net.seen.some(x => x.host === 'web-api.invoice-kohyo.nta.go.jp'), 'chrome:api-host-refused');
    assert.ok(!net.seen.some(x => x.path === '/regno-search/beacon'), 'chrome:get-only');
    const mine = ownedBrowsers().filter(b => path.resolve(b.profile) === path.resolve(profile));
    assert.ok(mine.length >= 1 && mine.every(b => !b.connected), 'chrome:registry-website-closed');
    for (const b of mine) assert.throws(() => process.kill(b.pid, 0), undefined, 'chrome:registry-website-process-ended');
    // An ordinary Chrome read of the API address is refused before any browser starts and is recorded as failed activity only.
    const before = ownedBrowsers().length;
    await assert.rejects(tools.call('read_public_page_in_chrome', { url: apiUrl }), /^Error: Use the official registry API tool$/, 'chrome:api-address-refused');
    assert.equal(s.posts.at(-1).capture.failed, true); assert.equal(s.posts.at(-1).capture.text, undefined); assert.equal(ownedBrowsers().length, before, 'chrome:api-address-no-browser');
  } finally { net.restore(); }
  await rm(profile, { recursive: true, force: true });
});

// The separate supplier research worker uses the same reader: the public website becomes a published 'web' source only; its
// registry state is set only by the official API tool (unchanged), and without an application id it stays connection_required.
test('supplier research reads the public NTA registry website as a page source and keeps the API registry state separate', async () => {
  const { ResearchTools } = await import('../research-worker/tools.mjs');
  const dir = await mkdtemp(path.join(temp, 'supplier-')), net = syntheticNetwork();
  try {
    const job = { sources: [], context: { source: { purchaseDate: '2026-08-01' } } };
    const tools = new ResearchTools({}, job, dir);
    const source = await allowed(tools.call('read_page', { url: siteUrl }), 'supplier:registry-website-web-source');
    assert.equal(source.kind, 'web', 'supplier:registry-website-web-source'); assert.equal(source.url, siteUrl); assert.equal(source.hash, sha(source.text));
    assert.ok(source.text.includes('登録番号 T1234567890123'), 'supplier:registry-website-literal-text');
    const evidence = JSON.parse(await readFile(path.join(dir, 'evidence.json'), 'utf8'));
    assert.equal(tools.registry, null, 'supplier:registry-website-no-registry-state'); assert.equal(evidence.registry, null); assert.deepEqual(evidence.sources, [source]);
    await assert.rejects(tools.call('read_page', { url: apiUrl }), /^Error: Use the official registry API tool$/, 'supplier:api-address-refused');
    assert.equal(tools.sources.length, 1, 'supplier:api-address-no-source');
    assert.equal((await tools.call('verify_invoice', { number: 'T1234567890123' })).status, 'connection_required', 'supplier:no-id-connection-required'); assert.equal(tools.registry, null);
    const configured = new ResearchTools({ ntaApplicationId: 'SYNTHETICAPPID12345' }, job, await mkdtemp(path.join(temp, 'supplier-api-')));
    const checked = await configured.call('verify_invoice', { number: 'T1234567890123' });
    assert.equal(checked.active, true); assert.equal(configured.registry.number, 'T1234567890123', 'supplier:api-registry-path-kept');
    const registrySource = configured.sources.find(x => x.id === checked.sourceId);
    assert.equal(registrySource.kind, 'registry'); assert.equal(registrySource.url, 'https://web-api.invoice-kohyo.nta.go.jp/1/valid', 'supplier:api-source-url-without-id');
    assert.ok(net.seen.some(x => x.host === 'web-api.invoice-kohyo.nta.go.jp' && x.query.includes('id=SYNTHETICAPPID12345')), 'supplier:api-request-carries-id');
    assert.ok(!JSON.stringify(configured.sources).includes('SYNTHETICAPPID12345'), 'supplier:application-id-not-captured');
  } finally { net.restore(); }
});

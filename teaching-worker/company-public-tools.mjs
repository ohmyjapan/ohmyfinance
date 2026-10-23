// Company Navi public research tools, run inside the owned actions MCP child of a company job the server claimed with this
// worker's actual capability. Reads: public HTTPS pages through research-worker/http.mjs (public DNS pinning, public redirects
// only, size/time limits; the NTA registry's public website is one of them), this job's own headless Chrome (GET-only
// interception, closed after each read) and the official NTA registry API. Every read is captured — literal text, hash, final
// URL, time — to the job's own lease-bound sources route; a refused or failed read is recorded as activity, never as a finding.
// No mail, spreadsheet, private archive, account, file, shell, credential or checkout tool exists here. The worker token is only the Authorization header; an NTA application id
// is used only in the registry request itself and never appears in a capture, result or log.
import { createHash, randomBytes } from 'node:crypto';
import { publicGet, publicUrl, htmlText } from '../research-worker/http.mjs';
import { publicResearchTools, publicResearchLimits as limits, tNumberPattern } from '../shared/finance-company-public-research.mjs';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const objectId = /^[a-f0-9]{24}$/;
const safeMessages = [/^Only public HTTPS pages are allowed$/, /^Private network page rejected$/, /^Public page returned HTTP \d{3}$/, /^Redirect limit reached$/, /^Page exceeds research size limit$/, /^Public page timed out$/, /^Use the official registry API tool$/, /^Unsupported public page type$/, /^Page has no readable text$/, /^The NTA registry could not be read$/];
const safe = error => { const message = String(error?.message || ''); return safeMessages.some(r => r.test(message)) ? message : 'Public page could not be read'; };
const cleanText = value => String(value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '�').trim();
// The public reader drops the header charset: decode by the page's own meta declaration (Shift_JIS/EUC-JP are common on Japanese
// company sites), else strict UTF-8, else Shift_JIS. Literal text must not be mis-decoded before it is hashed and quoted.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
export function decodePage(bytes) {
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i.exec(bytes.subarray(0, 4096).toString('latin1'))?.[1]?.toLowerCase();
  const label = ['shift_jis', 'shift-jis', 'sjis', 'x-sjis', 'windows-31j', 'cp932', 'ms932'].includes(declared) ? 'shift_jis' : ['euc-jp', 'x-euc-jp'].includes(declared) ? 'euc-jp' : null;
  if (label) return new TextDecoder(label).decode(bytes);
  try { return strictUtf8.decode(bytes); } catch { return new TextDecoder('shift_jis').decode(bytes); }
}

export class CompanyPublicTools {
  constructor({ sourcesEndpoint, lease, token, ntaApplicationId = '', profileDirectory, chrome = false, timeoutMs = 30000 }, { get = publicGet, check = publicUrl, readBrowser = null, request = fetch, wait = ms => new Promise(r => setTimeout(r, ms)), note = async () => {}, now = () => new Date() } = {}) {
    if (typeof sourcesEndpoint !== 'string' || !/\/api\/finance-chat\/worker\/workspace\/[a-f\d]{24}\/sources$/.test(new URL(sourcesEndpoint).pathname) || typeof lease !== 'string' || !lease) throw Error('Invalid public research job');
    Object.assign(this, { sourcesEndpoint, lease, token, ntaApplicationId: typeof ntaApplicationId === 'string' ? ntaApplicationId : '', profileDirectory, chrome: chrome === true, timeoutMs, get, check, readBrowser, request, wait, note, now });
  }
  definitions() { return publicResearchTools({ chrome: this.chrome }); }
  has(name) { return this.definitions().some(t => t.name === name); }
  // One trusted same-job request. A lost reply (network error or timeout) is retried with the identical body, so the server's
  // capture identity makes it one source; an HTTP answer is final.
  async post(body) {
    const text = JSON.stringify({ lease: this.lease, ...body });
    let last = 'Public research request failed';
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response;
      try { response = await this.request(this.sourcesEndpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, body: text, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) }); }
      catch (error) { last = error?.name === 'TimeoutError' ? 'Public research request timed out' : 'Public research request failed'; await this.note(`public ${body.op} attempt ${attempt} ${last}`); if (attempt < 3) await this.wait(400 * attempt); continue; }
      const raw = await response.text();
      await this.note(`public ${body.op} attempt ${attempt} status ${response.status}`);
      if (response.ok) return JSON.parse(raw);
      let message = raw; try { const parsed = JSON.parse(raw); message = parsed?.data?.message || parsed?.message || parsed?.statusMessage || raw; } catch {}
      throw Error(`HTTP ${response.status}: ${String(message).slice(0, 500)}`);
    }
    throw Error(last + ' after 3 attempts');
  }
  capture(kind, requestedUrl, { url, title, text, truncated, target }) {
    return { captureId: sha([kind, requestedUrl, sha(text)].join('\n')).slice(0, 32), kind, requestedUrl, url, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, limits.titleChars), text, hash: sha(text), capturedAt: this.now().toISOString(), truncated, ...(target ? { target } : {}) };
  }
  async store(capture) { return (await this.post({ op: 'capture', capture })).source; }
  async failed(kind, requestedUrl, error, { reason, target } = {}) {
    const capture = { captureId: randomBytes(16).toString('hex'), kind, requestedUrl, failed: true, ...(reason ? { reason } : { safeError: safe(error) }), ...(target ? { target } : {}) };
    try { await this.post({ op: 'capture', capture }); } catch { /* the read already failed; the activity record is best effort */ }
  }
  view(source, text) { return { sourceId: source.id, kind: source.kind, evidence: source.evidence, title: source.title, url: source.url, capturedAt: source.capturedAt, truncated: source.truncated, ...(source.registry ? { registry: source.registry } : {}), text: text.slice(0, limits.toolTextChars), moreText: text.length > limits.toolTextChars, howToCite: 'Cite with this sourceId and a quote copied exactly from the text; use read_public_source for more text.' }; }
  url(args) {
    const value = args?.url;
    if (typeof value !== 'string' || value.length > limits.urlChars) throw Error('Give one public https URL');
    let parsed; try { parsed = new URL(value); } catch { throw Error('Give one public https URL'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw Error('Give one public https URL');
    return value;
  }
  async call(name, args = {}) {
    if (!this.has(name)) throw Error('Unknown or not available public research tool ' + String(name).slice(0, 80));
    if (name === 'read_public_page') {
      const url = this.url(args);
      let data;
      try { data = await this.get(url, { maxBytes: 5 * 1024 * 1024 }); if (!['text/html', 'text/plain', 'application/xhtml+xml', 'application/json'].includes(data.mimeType)) throw Error('Unsupported public page type'); }
      catch (error) { await this.failed('web', url, error); throw Error(safe(error)); }
      const html = decodePage(data.bytes), full = ['text/plain', 'application/json'].includes(data.mimeType) ? cleanText(html) : htmlText(html);
      if (!full) { await this.failed('web', url, Error('Page has no readable text')); throw Error('Page has no readable text'); }
      const title = htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || new URL(data.url).hostname, text = full.slice(0, limits.textChars);
      return this.view(await this.store(this.capture('web', url, { url: data.url, title, text, truncated: full.length > limits.textChars })), text);
    }
    if (name === 'read_public_page_in_chrome') {
      const url = this.url(args);
      let page;
      try { const read = this.readBrowser || (await import('../research-worker/browser.mjs')).readBrowserPage; await this.check(url); page = await read(this.profileDirectory, url, { headless: true, close: true, resolveFinal: true, labelUtf8: true }); }
      catch (error) { await this.failed('chrome', url, error); throw Error(safe(error)); }
      const full = cleanText(page.text);
      if (!full) { await this.failed('chrome', url, Error('Page has no readable text')); throw Error('Page has no readable text'); }
      const text = full.slice(0, limits.textChars);
      return this.view(await this.store(this.capture('chrome', url, { url: page.url, title: page.title || new URL(page.url).hostname, text, truncated: full.length > limits.textChars })), text);
    }
    if (name === 'verify_invoice_registration') {
      const number = args?.number;
      if (typeof number !== 'string' || !tNumberPattern.test(number)) throw Error('A literal T plus 13 digits is required, exactly as published or saved; never derive one from a corporation number');
      for (const key of ['transactionId', 'invoiceId']) if (args[key] !== undefined && (typeof args[key] !== 'string' || !objectId.test(args[key]))) throw Error('Use the id of a company record you read');
      if (args.date !== undefined && (typeof args.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))) throw Error('Use a YYYY-MM-DD date the user wrote');
      const target = { number, ...Object.fromEntries(['transactionId', 'invoiceId', 'date'].filter(k => args[k] !== undefined).map(k => [k, args[k]])) };
      const prepared = await this.post({ op: 'prepare', target });
      if (!this.ntaApplicationId) {
        await this.failed('registry', prepared.canonicalUrl, null, { reason: 'connection_required', target });
        return { status: 'connection_required', number, asOf: prepared.date, dateAuthority: prepared.dateAuthority, meaning: '国税庁APIの接続設定がないため、この日付でのAPI照合は行っていません。公表されている番号は「公的に再確認していない」情報として扱ってください。公表サイトなどの公開ページで読んだ内容は、取得時点の公表情報として引用できます。' };
      }
      const query = new URLSearchParams({ id: this.ntaApplicationId, number, day: prepared.date, type: '21' });
      let response;
      try { response = await this.get('https://web-api.invoice-kohyo.nta.go.jp/1/valid?' + query, { registry: true }); }
      catch { await this.failed('registry', prepared.canonicalUrl, Error('The NTA registry could not be read'), { target }); throw Error('The NTA registry could not be read'); }
      const text = cleanText(response.bytes.toString('utf8')).slice(0, limits.textChars);
      const source = await this.store(this.capture('registry', prepared.canonicalUrl, { url: prepared.canonicalUrl, title: '国税庁 適格請求書発行事業者 登録番号照合（' + prepared.date + ' 時点）', text, truncated: false, target }));
      return { ...this.view(source, text), status: source.registry?.status || 'checked', asOf: prepared.date, dateAuthority: prepared.dateAuthority };
    }
    if (name === 'list_public_sources') return this.post({ op: 'list' });
    if (name === 'read_public_source') {
      if (typeof args.sourceId !== 'string' || !objectId.test(args.sourceId)) throw Error('Use a sourceId from list_public_sources');
      return this.post({ op: 'read', sourceId: args.sourceId, ...(args.offset !== undefined ? { offset: args.offset } : {}) });
    }
    throw Error('Unknown public research tool');
  }
}

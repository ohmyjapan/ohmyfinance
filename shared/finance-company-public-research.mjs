// Company Navi public research: the public tool schemas, the worker capability report, capture and citation shapes, shared by
// the server, the teaching worker and the page. No Node imports: the page bundle loads this through finance-navi-features.mjs.
//   published_page                — literal text a public page published when it was captured (identity, T-number, address…),
//                                   the NTA invoice-registry public website included.
//   official_registry_observation — the official NTA registry response for one literal T-number at one server-set date.
// Neither proves that a purchase belongs to that company, nor a tax treatment. A failed or unavailable read is activity, not a
// finding. The NTA application id never appears in a URL, capture, citation or reply: the registry URL here is canonical.
export const PUBLIC_RESEARCH_VERSION = 1;
export const publicResearchLimits = Object.freeze({ textChars: 60000, toolTextChars: 12000, readWindow: 12000, sourcesPerTurn: 16, citations: 8, quoteChars: 300, claimChars: 300, titleChars: 300, urlChars: 2000, safeErrorChars: 200, detailChars: 6000 });
export const tNumberPattern = /^T[0-9]{13}$/;
const objectIdPattern = /^[a-f0-9]{24}$/;
const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v, keys) => Object.keys(v).every(k => keys.includes(k));
const isoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const objectId = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const url = { type: 'string', minLength: 9, maxLength: 2000 };
const tool = (name, description, properties, required = []) => ({ name, description, inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) } });

// The public tools a capable company job gets in its own actions MCP server, beside the server catalogue. Fixed order.
export function publicResearchTools({ chrome = false } = {}) {
  return [
    tool('read_public_page', 'Read one public HTTPS page (the company\'s own site, NTA, e-Gov or another public page found with WebSearch or given by the user) and capture its literal text as a dated source of this conversation. GET only; private, local, login and file addresses are refused. The NTA invoice-registry public website (www.invoice-kohyo.nta.go.jp) is an ordinary public page here: its capture is what the page published when read, not a registry check at a date. The registry Web-API address is refused (use verify_invoice_registration). Returns a sourceId to cite and the start of the text.', { url }, ['url']),
    ...(chrome ? [tool('read_public_page_in_chrome', 'Read a public HTTPS page that only shows its content with JavaScript, in this worker\'s own headless Chrome (GET only, no login, closed after the read), and capture the rendered text. Prefer read_public_page for ordinary pages.', { url }, ['url'])] : []),
    tool('verify_invoice_registration', 'Check one literal T-number (T plus 13 digits exactly as published or saved; never derived from a corporation number) against the official NTA registry API. The server sets the date: the date of a company transaction or invoice you name, a date the user wrote in the current message, otherwise today in Japan. connection_required means the NTA API connection is not configured on this worker: no API check was made at that date, so a published number is not officially rechecked; public pages, the NTA public website included, can still be read and cited as published text.', { number: { type: 'string', pattern: '^T[0-9]{13}$' }, transactionId: objectId, invoiceId: objectId, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['number']),
    tool('list_public_sources', 'List the public sources captured in this company conversation (this message and earlier ones in the current chat): ids, kinds, capture times, final URLs and registry observations. Failed or unavailable reads are listed as activity, not findings.', {}),
    tool('read_public_source', 'Read more of one captured source\'s literal text from an offset, to quote it exactly.', { sourceId: objectId, offset: { type: 'integer', minimum: 0, maximum: 60000 } }, ['sourceId'])
  ];
}
// The final reply's citation list (also the interpreter's JSON schema for capable company jobs).
export const citationSchema = Object.freeze({ type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['sourceId', 'quote', 'claim'], properties: { sourceId: { type: 'string', pattern: '^[a-f0-9]{24}$' }, quote: { type: 'string', minLength: 1, maxLength: 300 }, claim: { type: 'string', minLength: 1, maxLength: 300 } } } });

// What the worker reports it can actually do; nothing here grants accounts, mail, membership or private research.
export function validatePublicCapability(input) {
  if (!plain(input) || !onlyKeys(input, ['version', 'webSearch', 'publicPage', 'chrome', 'registry']) || input.version !== PUBLIC_RESEARCH_VERSION || typeof input.webSearch !== 'boolean' || input.publicPage !== true || typeof input.chrome !== 'boolean' || !['configured', 'connection_required'].includes(input.registry)) throw Error('Invalid public research capability');
  return { version: input.version, webSearch: input.webSearch, publicPage: true, chrome: input.chrome, registry: input.registry };
}

const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !control.test(value.replace(/[\n\t\r]/g, ' '));
export function validateCompanyCitations(input) {
  if (!Array.isArray(input) || input.length > publicResearchLimits.citations) throw Error('Invalid citations');
  return input.map(c => {
    if (!plain(c) || !onlyKeys(c, ['sourceId', 'quote', 'claim']) || typeof c.sourceId !== 'string' || !objectIdPattern.test(c.sourceId.toLowerCase()) || !boundedText(c.quote, publicResearchLimits.quoteChars) || !boundedText(c.claim, publicResearchLimits.claimChars)) throw Error('Invalid citation');
    return { sourceId: c.sourceId.toLowerCase(), quote: c.quote.trim(), claim: c.claim.trim() };
  });
}
// A quote is literal source text. Runs of whitespace may differ (page layout); every other character must match exactly.
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export function literalQuoteIn(text, quote) { const q = squash(quote); return q.length > 0 && squash(text).includes(q); }

export const registryUrl = (number, day) => 'https://web-api.invoice-kohyo.nta.go.jp/1/valid?number=' + number + '&day=' + day + '&type=21';
// A DNS terminal dot names the same host (web-api.….jp. is web-api.….jp): it is removed before either host category is decided.
const dnsHost = hostname => String(hostname || '').replace(/\.+$/, '');
export const isRegistryHost = hostname => /(^|\.)invoice-kohyo\.nta\.go\.jp$/i.test(dnsHost(hostname));
// The registry's anonymous public website (www and the bare origin) is an ordinary published page for the public reader and for
// web or Chrome captures. Every other registry host (the Web-API among them) is read only by the official verification path.
export const isRegistryWebsiteHost = hostname => /^(www\.)?invoice-kohyo\.nta\.go\.jp$/i.test(dnsHost(hostname));
const restrictedRegistryHost = hostname => isRegistryHost(hostname) && !isRegistryWebsiteHost(hostname);
export const evidenceOf = kind => kind === 'registry' ? 'official_registry_observation' : 'published_page';
// Syntactic check of a captured public address (the worker's reader already pinned public DNS before reading it).
export function publicSourceUrl(value) {
  if (typeof value !== 'string' || value.length > publicResearchLimits.urlChars) return false;
  let u; try { u = new URL(value); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.startsWith('[')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { const [a, b] = host.split('.').map(Number); if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0)) return false; }
  return true;
}
const anyHttpUrl = value => { if (typeof value !== 'string' || value.length > publicResearchLimits.urlChars) return false; try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
// One literal T-number and at most one date authority: a company transaction, a company invoice, or a stated date.
export function validateRegistryTarget(input) {
  if (!plain(input) || !onlyKeys(input, ['number', 'transactionId', 'invoiceId', 'date']) || typeof input.number !== 'string' || !tNumberPattern.test(input.number)) throw Error('Invalid registry target');
  const named = ['transactionId', 'invoiceId', 'date'].filter(k => input[k] !== undefined);
  if (named.length > 1) throw Error('Invalid registry target');
  if (input.transactionId !== undefined && (typeof input.transactionId !== 'string' || !objectIdPattern.test(input.transactionId))) throw Error('Invalid registry target');
  if (input.invoiceId !== undefined && (typeof input.invoiceId !== 'string' || !objectIdPattern.test(input.invoiceId))) throw Error('Invalid registry target');
  if (input.date !== undefined && !isoDate(input.date)) throw Error('Invalid registry target');
  return { number: input.number, ...(named[0] ? { [named[0]]: input[named[0]] } : {}) };
}
// A worker capture (or failed/unavailable read). Only these fields: the server derives owner, company, conversation and turn.
export function validatePublicCapture(input) {
  if (!plain(input) || typeof input.captureId !== 'string' || !/^[a-f0-9]{32}$/.test(input.captureId) || !['web', 'chrome', 'registry'].includes(input.kind) || !anyHttpUrl(input.requestedUrl)) throw Error('Invalid capture');
  if (input.failed !== undefined) {
    if (input.failed !== true || !onlyKeys(input, ['captureId', 'kind', 'requestedUrl', 'failed', 'safeError', 'reason', 'target'])) throw Error('Invalid capture');
    if (input.reason !== undefined && (input.reason !== 'connection_required' || input.kind !== 'registry' || input.target === undefined)) throw Error('Invalid capture');
    if (input.reason === undefined && !boundedText(input.safeError, publicResearchLimits.safeErrorChars)) throw Error('Invalid capture');
    if (input.target !== undefined) { if (input.kind !== 'registry') throw Error('Invalid capture'); validateRegistryTarget(input.target); }
    return { ...input };
  }
  if (!onlyKeys(input, ['captureId', 'kind', 'requestedUrl', 'url', 'title', 'text', 'hash', 'capturedAt', 'truncated', 'target']) || !publicSourceUrl(input.url) || typeof input.title !== 'string' || input.title.length > publicResearchLimits.titleChars || typeof input.text !== 'string' || !input.text.length || input.text.length > publicResearchLimits.textChars || typeof input.hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.hash) || typeof input.capturedAt !== 'string' || !Number.isFinite(Date.parse(input.capturedAt)) || typeof input.truncated !== 'boolean') throw Error('Invalid capture');
  if (input.kind === 'registry') { if (input.target === undefined) throw Error('Invalid capture'); validateRegistryTarget(input.target); }
  else if (input.target !== undefined || restrictedRegistryHost(new URL(input.url).hostname) || !publicSourceUrl(input.requestedUrl) || restrictedRegistryHost(new URL(input.requestedUrl).hostname)) throw Error('Invalid capture');
  return { ...input };
}

// Native CLI child and owned loopback HTTP observation for the Navi product-model corpus (docs/navi-agent-model-evaluation.md).
// Node built-ins only. Importing this module patches nothing; installSpawnObserver() replaces child_process.spawn (and, through
// syncBuiltinESMExports, the live ESM binding the product interpreter imported) until restore().
//
// Default JSON transport: passive. The matched native CLI spawn receives the interpreter's exact file, arguments and options object;
// the same ChildProcess, stdin, stderr, error/close events, timer and kill reach the interpreter. The observer adds listeners that
// only count, hash and parse a copy, and tees stdin bytes into a hash.
// P01 stream transport (the one declared logging-only difference): --output-format json becomes stream-json and --verbose is added.
// The interpreter gets the actual ChildProcess with a PassThrough as stdout; the real pipe is parsed (split UTF-8 and NDJSON), drained
// to its end, and the EXACT original final-result JSON payload is written to the PassThrough before the real child's close event.
// Nothing is reserialized, repaired or fabricated: a malformed, missing or duplicate final result ends the PassThrough empty, is a
// named observer failure and can never yield a model or privacy pass.
// Connected-auth (explicit manual option only): the exact matched CLI spawn gets one added CLAUDE_CODE_OAUTH_TOKEN from memory; all
// other environment entries, arguments and options stay as the interpreter built them. Unrelated children are never touched.
// Records keep whitelisted metadata, hashes and synthetic observations only: never credentials, headers, leases, MCP configuration,
// provider settings, hidden reasoning or the raw native stream.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const AUTH_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';
const OBSERVED = Symbol.for('omf.navi.agent-model.spawn-observer');

// ---- Native arguments and metadata
export function streamArguments(original) {
  if (!Array.isArray(original) || original.some(x => typeof x !== 'string')) throw Error('Native argv required');
  const indices = original.flatMap((x, i) => x === '--output-format' ? [i] : []);
  if (indices.length !== 1 || original[indices[0] + 1] !== 'json') throw Error('Expected native JSON output mode');
  const args = [...original]; args[indices[0] + 1] = 'stream-json'; if (!args.includes('--verbose')) args.push('--verbose');
  return { args, originalArgsHash: sha256(JSON.stringify(original)), observedArgsHash: sha256(JSON.stringify(args)), loggingChanges: { outputFormat: ['json', 'stream-json'], verboseAdded: !original.includes('--verbose') } };
}
const VALUE_FLAGS = new Set(['--model', '--effort', '--output-format', '--tools', '--max-turns', '--setting-sources']);
const HASH_FLAGS = new Set(['--json-schema', '--system-prompt', '--mcp-config', '--settings']);
// Non-secret shape of the native argument list: values of the model/limit flags, hashes of schema/prompt/MCP/settings blobs.
export function argumentShape(args) {
  const shape = []; let allowed = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) { shape.push([a, args[++i]]); allowed = false; continue; }
    if (HASH_FLAGS.has(a)) { shape.push([a, 'sha256:' + sha256(String(args[++i]))]); allowed = false; continue; }
    if (a === '--allowedTools') { shape.push([a]); allowed = true; continue; }
    if (a.startsWith('--')) { shape.push([a]); allowed = false; continue; }
    shape.push(allowed && /^[A-Za-z_*][A-Za-z0-9_*]*$/.test(a) ? ['allowed', a] : ['positional', 'sha256:' + sha256(a)]);
  }
  return shape;
}
const numericFields = (value, keys) => Object.fromEntries(keys.filter(k => Number.isFinite(value?.[k])).map(k => [k, value[k]]));
// Whitelisted metadata of a native final result envelope (default JSON stdout or the stream's result event).
export function envelopeMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = value.usage || {};
  return {
    type: typeof value.type === 'string' ? value.type : null, subtype: typeof value.subtype === 'string' ? value.subtype : null, isError: value.is_error === true,
    ...numericFields(value, ['num_turns', 'duration_ms', 'duration_api_ms', 'total_cost_usd']),
    usage: { ...numericFields(usage, ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']), serverToolUse: numericFields(usage.server_tool_use || {}, ['web_search_requests', 'web_fetch_requests']) },
    modelNames: Object.keys(value.modelUsage || {}).sort(),
    modelUsage: Object.fromEntries(Object.entries(value.modelUsage || {}).map(([name, u]) => [name, numericFields(u, ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'webSearchRequests', 'costUSD', 'contextWindow'])])),
    permissionDenials: Array.isArray(value.permission_denials) ? value.permission_denials.length : 0,
    structuredOutput: value.structured_output !== undefined && value.structured_output !== null,
    resultChars: typeof value.result === 'string' ? value.result.length : 0
  };
}

// ---- P01 stream parser (maintained from the 2026-10-22 prototype): split UTF-8, NDJSON lines, whitelisted query/tool events only.
export class NativeStreamObserver {
  constructor({ maxLineBytes = 4 * 1024 * 1024 } = {}) { this.decoder = new TextDecoder('utf-8', { fatal: true }); this.pending = ''; this.final = null; this.events = []; this.init = null; this.maxLineBytes = maxLineBytes; this.closed = false; this.failure = null; this.eventCount = 0; }
  push(bytes) {
    if (this.closed || this.failure) throw Error('Observer already ended or failed');
    try { this.pending += this.decoder.decode(bytes, { stream: true }); this.consume(false); } catch (e) { this.failure = e; throw e; }
  }
  consume(flush) {
    for (;;) { const at = this.pending.indexOf('\n'); if (at < 0) break; let line = this.pending.slice(0, at); this.pending = this.pending.slice(at + 1); if (line.endsWith('\r')) line = line.slice(0, -1); this.line(line); }
    if (Buffer.byteLength(this.pending) > this.maxLineBytes) throw Error('Native event exceeds observer line bound');
    if (flush && this.pending) { const line = this.pending.endsWith('\r') ? this.pending.slice(0, -1) : this.pending; this.pending = ''; this.line(line); }
  }
  line(raw) {
    if (!raw.trim()) return;
    if (Buffer.byteLength(raw) > this.maxLineBytes) throw Error('Native event exceeds observer line bound');
    if (this.final) throw Error('Native event after final result');
    const value = JSON.parse(raw); this.eventCount++;
    if (value?.type === 'result') { this.final = { raw, value }; return; }
    if (value?.type === 'system' && value.subtype === 'init' && !this.init) { this.init = { model: typeof value.model === 'string' ? value.model : null, tools: Array.isArray(value.tools) ? value.tools.filter(t => typeof t === 'string') : [], mcpServers: Array.isArray(value.mcp_servers) ? value.mcp_servers.map(s => ({ name: String(s?.name || ''), status: String(s?.status || '') })) : [] }; return; }
    if (value?.type !== 'assistant' || !Array.isArray(value.message?.content)) return;
    for (const item of value.message.content) {
      if (!['tool_use', 'server_tool_use'].includes(item?.type) || typeof item.name !== 'string') continue;
      if (['WebSearch', 'web_search'].includes(item.name)) {
        if (typeof item.input?.query !== 'string') this.events.push({ kind: 'unsupported_search_shape', name: item.name });
        else this.events.push({ kind: 'public_query', name: item.name, query: item.input.query });
      } else if (/web.?search/i.test(item.name)) this.events.push({ kind: 'unsupported_search_tool', name: item.name });
      else if (item.name.startsWith('mcp__omf_actions__')) this.events.push({ kind: 'native_tool', name: item.name });
      else this.events.push({ kind: 'other_tool', name: item.name });
    }
  }
  finish() {
    if (this.closed || this.failure) throw Error('Observer already ended or failed');
    try {
      this.pending += this.decoder.decode(); this.consume(true); if (!this.final) throw Error('Missing native final result'); this.closed = true;
      const nativePayload = this.final.raw;
      // Forward the ORIGINAL JSON payload (without its NDJSON CR/LF framing); never reserialize or repair the model response.
      const forwardedPayload = nativePayload;
      return { forwardedPayload, nativePayloadHash: sha256(nativePayload), forwardedPayloadHash: sha256(forwardedPayload), events: this.events, eventCount: this.eventCount, init: this.init, metadata: envelopeMetadata(this.final.value) };
    } catch (e) { this.failure = e; throw e; }
  }
}

// ---- Spawn observer
// cliPath: the exact configured native CLI path (string equality, as the interpreter passes config.cliPath).
// caseContext (setCase): { caseId, attemptId, transport: 'default-json' | 'stream-json', boundary?(stdinText) -> booleans }.
// connectedAuth: null, or { token, slot, configDirectory } held only in this closure.
export function installSpawnObserver({ cliPath, connectedAuth = null, now = Date.now } = {}) {
  if (typeof cliPath !== 'string' || !cliPath) throw Error('observer:cli-path-required');
  if (connectedAuth !== null && (!connectedAuth || typeof connectedAuth.token !== 'string' || !connectedAuth.token)) throw Error('observer:connected-auth-token-required');
  const original = cp.spawn;
  if (original[OBSERVED]) throw Error('observer:already-installed');
  const token = connectedAuth ? connectedAuth.token : null, authInfo = connectedAuth ? { slot: connectedAuth.slot ? String(connectedAuth.slot) : null, configDirectory: connectedAuth.configDirectory ? String(connectedAuth.configDirectory) : null } : null;
  const state = { caseContext: null, processes: [], unrelated: 0, restored: false };
  function observedSpawn(file, args, options) {
    if (file !== cliPath || !Array.isArray(args) || !options || typeof options !== 'object') { if (file !== cliPath) state.unrelated++; else state.processes.push({ seq: state.processes.length + 1, unexpectedShape: true, caseId: state.caseContext?.caseId ?? null }); return original.apply(this, arguments); }
    const context = state.caseContext, stream = context?.transport === 'stream-json';
    const record = { seq: state.processes.length + 1, caseId: context?.caseId ?? null, attemptId: context?.attemptId ?? null, outOfCase: !context, transport: stream ? 'stream-json' : 'default-json', startedAt: new Date(now()).toISOString(), file, args: argumentShape(args), originalArgsSha256: sha256(JSON.stringify(args)), cwd: options.cwd ?? null, envKeys: Object.keys(options.env || {}).sort() };
    state.processes.push(record);
    let spawnArgs = args, spawnOptions = options;
    if (stream) { try { const mapped = streamArguments(args); spawnArgs = mapped.args; record.spawnedArgsSha256 = mapped.observedArgsHash; record.loggingChanges = mapped.loggingChanges; } catch (e) { record.observerFailure = 'stream-arguments: ' + e.message; } }
    else record.spawnedArgsSha256 = record.originalArgsSha256;
    if (token) {
      if (!options.env || typeof options.env !== 'object') record.observerFailure = 'connected-auth: native child environment missing; overlay refused';
      else { record.auth = { overlay: true, key: AUTH_KEY, preexistingKey: Object.hasOwn(options.env, AUTH_KEY), ...authInfo }; spawnOptions = { ...options, env: { ...options.env, [AUTH_KEY]: token } }; }
    } else record.auth = { overlay: false };
    record.optionsIdentityPreserved = spawnOptions === options; record.argsIdentityPreserved = spawnArgs === args;
    const child = original.call(this, file, spawnArgs, spawnOptions);
    try { record.pid = child.pid ?? null; } catch { record.pid = null; }
    observeStdin(child, record, context);
    if (child.stderr) { let bytes = 0; const h = createHash('sha256'); child.stderr.on('data', b => { try { const x = Buffer.isBuffer(b) ? b : Buffer.from(String(b)); bytes += x.length; h.update(x); } catch {} }); record.stderrDigest = () => ({ bytes, sha256: h.copy().digest('hex') }); }
    const finalize = stream ? observeStream(child, record) : observePassive(child, record);
    child.once('error', error => { record.spawnError = String(error?.code || error?.name || 'error'); });
    child.once('close', (code, signal) => {
      record.exitCode = code; record.signal = signal || null; record.closedAt = new Date(now()).toISOString(); record.durationMs = Date.parse(record.closedAt) - Date.parse(record.startedAt);
      try { finalize(); } catch (e) { record.observerFailure ||= 'finalize: ' + e.message; }
      if (record.stderrDigest) { record.stderr = record.stderrDigest(); delete record.stderrDigest; }
    });
    return child;
  }
  Object.defineProperty(observedSpawn, OBSERVED, { value: true });
  cp.spawn = observedSpawn; syncBuiltinESMExports();
  return {
    processes: state.processes,
    setCase(context) { state.caseContext = context ? { ...context } : null; },
    clearCase() { state.caseContext = null; },
    stats() { return { matched: state.processes.length, unrelated: state.unrelated, outOfCase: state.processes.filter(p => p.outOfCase).length, restored: state.restored }; },
    restore() { if (state.restored) return; if (cp.spawn === observedSpawn) cp.spawn = original; syncBuiltinESMExports(); state.restored = cp.spawn === original; if (!state.restored) throw Error('observer:spawn-not-restored'); }
  };
}
function observeStdin(child, record, context) {
  const stdin = child.stdin; if (!stdin) return;
  const h = createHash('sha256'), chunks = []; let bytes = 0, ending = false, done = false;
  const tap = (chunk, encoding) => { if (chunk === undefined || chunk === null || typeof chunk === 'function') return; const b = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'); h.update(b); bytes += b.length; if (bytes <= 16 * 1024 * 1024) chunks.push(b); };
  const settle = () => { if (done) return; done = true; record.stdin = { bytes, sha256: h.digest('hex') }; try { if (typeof context?.boundary === 'function') record.boundary = context.boundary(Buffer.concat(chunks).toString('utf8')); } catch (e) { record.boundary = { error: String(e.message).slice(0, 200) }; } chunks.length = 0; };
  const write = stdin.write, end = stdin.end;
  stdin.write = function (chunk, encoding) { if (!ending) { try { tap(chunk, encoding); } catch {} } return write.apply(this, arguments); };
  stdin.end = function (chunk, encoding) { ending = true; try { tap(chunk, encoding); } catch {} try { return end.apply(this, arguments); } finally { ending = false; try { settle(); } catch {} } };
}
function observePassive(child, record) {
  const kept = []; let bytes = 0, truncated = false; const h = createHash('sha256');
  // A copy of each chunk: strings once the interpreter set utf8, otherwise bytes decoded together at the end (split UTF-8 safe).
  if (child.stdout) child.stdout.on('data', chunk => { try { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'); bytes += b.length; h.update(b); if (bytes <= 1024 * 1024) kept.push(b); else truncated = true; } catch {} });
  return () => {
    record.stdout = { bytes, sha256: h.digest('hex'), truncated };
    const text = Buffer.concat(kept).toString('utf8'); kept.length = 0;
    let value = null; try { value = JSON.parse(text); } catch { record.envelopeParse = 'invalid-json'; }
    record.envelope = envelopeMetadata(value); record.envelopeSha256 = value ? sha256(text) : null;
  };
}
function observeStream(child, record) {
  const real = child.stdout, forward = new PassThrough(), parser = new NativeStreamObserver();
  let failure = null, forwarded = false, delivered = false, realBytes = 0;
  Object.defineProperty(child, 'stdout', { value: forward, writable: true, configurable: true, enumerable: true });
  forward.on('data', () => { delivered = true; });
  if (!real) { failure = Error('Native stdout missing'); forward.end(); }
  else {
    real.on('data', chunk => { realBytes += chunk.length; if (failure) return; try { parser.push(chunk); } catch (e) { failure = e; } });
    real.once('end', () => {
      if (!failure) { try { const r = parser.finish(); record.stream = { events: r.events, eventCount: r.eventCount, init: r.init, nativePayloadSha256: r.nativePayloadHash, forwardedPayloadSha256: r.forwardedPayloadHash }; record.envelope = r.metadata; forward.end(r.forwardedPayload); forwarded = true; } catch (e) { failure = e; } }
      if (failure) forward.end();
    });
  }
  return () => {
    record.stdout = { bytes: realBytes, drained: real ? real.readableEnded === true : false };
    record.forwardedBeforeClose = forwarded && delivered;
    if (failure) record.observerFailure ||= 'stream: ' + String(failure.message || failure).slice(0, 200);
    else if (!forwarded) record.observerFailure ||= 'stream: final result not forwarded before close';
  };
}

// ---- Owned loopback HTTP observer between the synthetic worker/MCP child and the owned application.
// Requests are forwarded byte for byte with their original headers (tokens stay in memory, never recorded). An upstream failure
// destroys the client socket, exactly as an unreachable application would; no status is ever synthesized.
const SECRET_KEYS = /^(lease|token|authorization|password|secret|refreshToken|accessToken|apiKey|cookie)$/i;
export function redact(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.test(k)).map(([k, v]) => [k, redact(v, depth + 1)]));
}
export function classifyWorkerRoute(method, url) {
  const p = String(url || '').split('?')[0]; let m;
  if (method !== 'POST') return { kind: 'other' };
  if (p === '/api/finance-chat/worker/heartbeat') return { kind: 'heartbeat' };
  if (p === '/api/finance-chat/worker/workspace-claim') return { kind: 'claim', route: 'workspace-claim' };
  if (p === '/api/finance-chat/worker/claim') return { kind: 'claim', route: 'claim' };
  if ((m = p.match(/^\/api\/finance-chat\/worker\/(workspace\/)?([a-f0-9]{24})\/(actions|sources|result)$/))) return { kind: m[3] === 'actions' ? 'action' : m[3] === 'sources' ? 'source' : 'result', mode: m[1] ? 'workspace' : 'purchase', jobId: m[2] };
  return { kind: 'other' };
}
const parseJson = buffer => { try { return JSON.parse(buffer.toString('utf8')); } catch { return undefined; } };
function workerEvent(info, request, status, response, maxChars) {
  const base = { kind: info.kind, status, ...(info.jobId ? { jobId: info.jobId, mode: info.mode } : {}) };
  if (info.kind === 'heartbeat') return { ...base, job: request?.job ? { id: request.job.id, mode: request.job.mode } : null };
  if (info.kind === 'claim') {
    const job = response?.job, pr = request?.capabilities?.publicResearch;
    return { ...base, route: info.route, reportedCapability: pr ? { version: pr.version, webSearch: pr.webSearch, publicPage: pr.publicPage, chrome: pr.chrome, registry: pr.registry } : null,
      job: job ? { id: job.id, mode: job.mode || 'purchase', companyScoped: job.companyScoped === true, toolNames: (job.tools || []).map(t => t?.name), textSha256: typeof job.text === 'string' ? sha256(job.text) : null, page: job.context?.page ?? null, selection: job.context?.facts?.selection ?? job.target ?? null, messages: Array.isArray(job.context?.messages) ? job.context.messages.length : 0, priorActions: Array.isArray(job.actions) ? job.actions.length : 0, knowledge: Array.isArray(job.knowledge) ? job.knowledge.length : 0, inspected: !!job.inspected, teachingCompany: !!job.teachingCompany, publicResearch: job.publicResearch ? { version: job.publicResearch.version, webSearch: job.publicResearch.webSearch, publicPage: job.publicResearch.publicPage, chrome: job.publicResearch.chrome, registry: job.publicResearch.registry, today: job.publicResearch.today } : null } : null };
  }
  if (info.kind === 'action') {
    const text = response === undefined ? '' : JSON.stringify(redact(response));
    return { ...base, tool: typeof request?.name === 'string' ? request.name : null, slot: request?.slot ?? null, args: redact(request?.args ?? null), effect: response?.effect ?? null, receipt: response?.receipt ? { operationId: response.receipt.operationId, name: response.receipt.name, state: response.receipt.state, outcome: response.receipt.outcome ?? null, nativeResourceIds: redact(response.receipt.nativeResourceIds ?? null), acceptedRevision: response.receipt.acceptedRevision ?? null } : null, responseText: text.length > maxChars ? text.slice(0, maxChars) : text, responseTruncated: text.length > maxChars, error: status >= 400 ? String(response?.statusMessage || response?.message || '').slice(0, 300) : null };
  }
  if (info.kind === 'source') {
    const c = request?.capture;
    return { ...base, op: request?.op ?? null, target: redact(request?.target ?? null), sourceId: request?.sourceId ?? null, capture: c ? { kind: c.kind, url: c.url, requestedUrl: c.requestedUrl, title: typeof c.title === 'string' ? c.title.slice(0, 300) : null, hash: c.hash, chars: typeof c.text === 'string' ? c.text.length : 0, truncated: c.truncated === true, status: c.status ?? null } : null, source: response?.source ? { id: response.source.id, kind: response.source.kind, status: response.source.status, evidence: response.source.evidence, url: response.source.url } : null, error: status >= 400 ? String(response?.statusMessage || response?.message || '').slice(0, 300) : null };
  }
  if (info.kind === 'result') { const p = request?.proposal; return { ...base, failed: request?.failed === true, proposal: p ? { kind: p.kind, summary: typeof p.summary === 'string' ? p.summary : null, citations: Array.isArray(p.citations) ? p.citations : [], navigation: p.navigation ?? null } : null }; }
  return base;
}
export async function openHttpObserver(upstream, { maxResponseChars = 60000 } = {}) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw Error('observer:loopback-upstream-required');
  const events = [], sockets = new Set(); let seq = 0, caseId = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', b => chunks.push(b));
    req.on('error', () => {});
    req.on('end', () => {
      const body = Buffer.concat(chunks), info = classifyWorkerRoute(req.method, req.url), at = new Date().toISOString(), tag = caseId, n = ++seq;
      const outgoing = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, reply => {
        const response = [];
        res.writeHead(reply.statusCode, reply.statusMessage, reply.headers);
        reply.on('data', b => { response.push(b); res.write(b); });
        reply.on('end', () => { res.end(); try { events.push({ seq: n, at, caseId: tag, ...(info.kind === 'other' ? { kind: 'other', method: req.method, path: String(req.url).split('?')[0], status: reply.statusCode } : workerEvent(info, parseJson(body), reply.statusCode, parseJson(Buffer.concat(response)), maxResponseChars)) }); } catch (e) { events.push({ seq: n, at, caseId: tag, kind: 'observer_error', error: String(e.message).slice(0, 200) }); } });
        reply.on('error', () => res.destroy());
      });
      outgoing.on('error', error => { events.push({ seq: n, at, caseId: tag, kind: 'upstream_error', path: String(req.url).split('?')[0], error: String(error?.code || error?.name || 'error') }); res.destroy(); });
      outgoing.end(body);
    });
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    origin: 'http://127.0.0.1:' + server.address().port, events,
    setCase(id) { caseId = id || null; },
    since(index) { return events.slice(index); },
    close() { return new Promise(resolve => { server.close(() => resolve()); for (const s of sockets) s.destroy(); }); }
  };
}

// The owned MCP server the accountant model talks to for Navi actions: stdio JSON-RPC (newline-delimited, the framing of
// research-worker/mcp.mjs). tools/list is exactly the catalogue the server put in this job; tools/call is one POST to the job's
// action endpoint with the conversation lease, a slot number and the arguments. The token is read privately from the hosting
// Vault directory (OMF_ACTIONS_DIR; the job file carries no token) and sent only as the Authorization header. A timed-out or
// lost first attempt is retried with the SAME slot (the server's journal makes it one effect); a 4xx/5xx answer is final and
// surfaced as a tool error with the server's safe message. Nothing else is reachable: no shell, filesystem or arbitrary URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { Vault } from '../collector/vault.mjs';
const directory = process.env.OMF_ACTIONS_DIR || path.join(os.homedir(), '.ohmyfinance-teaching');
const jobFile = path.resolve(process.env.OMF_ACTIONS_JOB_FILE || '');
const realRoot = await fs.realpath(path.join(directory, 'jobs')), realJob = await fs.realpath(jobFile);
if (!realJob.startsWith(realRoot + path.sep) || path.basename(realJob) !== 'job.json') throw Error('Invalid actions job path');
const config = await new Vault(directory).read(), job = JSON.parse(await fs.readFile(realJob, 'utf8'));
if (!/^omft_[a-f\d]{64}$/.test(config.token || '')) throw Error('Actions worker is not configured');
const endpoint = new URL(job.endpoint);
if (!(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(endpoint.hostname)) throw Error('Use the private OMF address');
if (!/\/api\/finance-chat\/worker\/(workspace\/)?[a-f\d]{24}\/actions$/.test(endpoint.pathname) || endpoint.search || endpoint.username) throw Error('Invalid actions endpoint');
if (typeof job.lease !== 'string' || !Array.isArray(job.tools)) throw Error('Invalid actions job');
const tools = job.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), names = new Set(tools.map(t => t.name));
const timeoutMs = Number.isSafeInteger(job.timeoutMs) && job.timeoutMs >= 100 ? job.timeoutMs : 20000;
let nextSlot = Number.isSafeInteger(job.nextSlot) && job.nextSlot >= 1 ? job.nextSlot : 1;
const eventLog = path.join(path.dirname(realJob), 'events.log');
const note = async line => { try { await fs.appendFile(eventLog, line + '\n', { mode: 0o600 }); } catch {} };
async function post(name, args, slot) {
  let lastError = 'Action request failed';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(endpoint.href, { method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ lease: job.lease, slot, name, args }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      await note(`tools/call ${name} slot ${slot} attempt ${attempt} status ${r.status}`);
      if (r.ok) return { ok: true, text };
      let message = text; try { const parsed = JSON.parse(text); message = parsed?.data?.message || parsed?.message || parsed?.statusMessage || text; } catch {}
      return { ok: false, text: `HTTP ${r.status}: ${String(message).slice(0, 1000)}` };
    } catch (error) {
      lastError = error?.name === 'TimeoutError' ? 'Action request timed out' : 'Action request failed';
      await note(`tools/call ${name} slot ${slot} attempt ${attempt} ${lastError}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
  return { ok: false, text: `${lastError} after 3 attempts on slot ${slot}; read get_action_status for this slot before anything else.` };
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request; try { if (line.length > 200000) throw Error(); request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  try {
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'omf-actions', version: '1.0.0' } };
    else if (request.method === 'tools/list') { await note('tools/list'); result = { tools }; }
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/call') {
      const name = request.params?.name, args = request.params?.arguments ?? {};
      if (!names.has(name)) result = { isError: true, content: [{ type: 'text', text: 'Unknown tool ' + String(name).slice(0, 80) }] };
      else if (!args || typeof args !== 'object' || Array.isArray(args)) result = { isError: true, content: [{ type: 'text', text: 'Arguments must be an object' }] };
      else { const slot = nextSlot++; const r = await post(name, args, slot); result = r.ok ? { content: [{ type: 'text', text: r.text }] } : { isError: true, content: [{ type: 'text', text: r.text }] }; }
    }
    else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\n'); continue; }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Action tool failed' } }) + '\n'); }
}

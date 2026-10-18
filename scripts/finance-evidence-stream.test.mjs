import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyValues } from '../shared/finance-draft.mjs';
import { validateDocumentExtraction } from '../shared/finance-document-evidence.mjs';

// Only the owned executable marker is replaced. Actual receivers spawn real children;
// IPC acknowledges the first stdout event before the second chunk is written.
// Interpreter, field validation, result routing and research repair stay real.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-evidence-utf8-'));
const marker = path.join(directory, 'synthetic-only-interpreter');
const nativeSpawn = cp.spawn;
const queue = [], spawned = [];
const emitter = `
 const s=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));
 process.stdin.resume();
 if(s.hang) setInterval(()=>{},1000);
 else {let i=0;const next=()=>{
  process.stdout.write(Buffer.from(s.chunks[i++],'base64'));
  if(i===s.chunks.length){process.stdout.end();process.exitCode=s.exit||0;process.disconnect();}
 };process.on('message',next);next();}
`;
cp.spawn = function(command, args, options) {
 if (command !== marker) return nativeSpawn.apply(this, arguments);
 const s = queue.shift(); assert.ok(s, 'An exact synthetic response must be queued');
 s.args = args; s.options = options; s.events = 0;
 const payloadFile = path.join(directory, 'response-' + spawned.length + '.json');
 writeFileSync(payloadFile, JSON.stringify(s.payload));
 s.child = nativeSpawn(process.execPath, ['-e', emitter, payloadFile], { ...options, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
 s.closed = new Promise(resolve => s.child.once('close', resolve));
 s.child.stdout.on('data', () => { s.events++; if (s.events < s.payload.chunks?.length && s.child.connected) s.child.send('next'); });
 spawned.push(s); return s.child;
};
syncBuiltinESMExports();
// Mutants live in an owned copy of the complete source directories, not production.
const target = process.env.OMF_EVIDENCE_TEST_ROOT || root;
const { interpretDocument } = await import(pathToFileURL(path.join(target, 'teaching-worker/document-interpreter.mjs')));
const { documentCycle } = await import(pathToFileURL(path.join(target, 'teaching-worker/document-worker.mjs')));
const { ResearchWorker } = await import(pathToFileURL(path.join(target, 'research-worker/worker.mjs')));
// Tools caller is checked against actual source; receiver-only mutants do not copy its browser dependencies.
const { ResearchTools } = await import(pathToFileURL(path.join(root, 'research-worker/tools.mjs')));
after(async () => {
 cp.spawn = nativeSpawn; syncBuiltinESMExports();
 for (const s of spawned) { if (s.child.exitCode === null && !s.child.killed) s.child.kill(); await s.closed; }
 assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
 assert.ok(path.basename(directory).startsWith('omf-evidence-utf8-'));
 await rm(directory, { recursive: true, force: true });
});
const text = '\u4eee\u7a7a\u5546\u5e97 \ud55c\uad6d\uc5b4 \ud83d\ude80';
const config = { cliPath: marker, inferenceDirectory: directory, baseUrl: 'http://127.0.0.1:8080', token: 'synthetic-only' };
const bytes = Buffer.from('Synthetic document, not a real receipt');
const document = { mimeType: 'application/pdf' };
const extraction = (value = text) => ({ complete: true, pages: [{ page: 1, text: value }], records: [{ fields: [{ key: 'productName', value, page: 1, quote: value }] }] });
const docWire = raw => JSON.stringify({ type: 'result', structured_output: raw }) + '\n';
const report = (summary = text) => ({ summary, question: '', supplier: null, findings: [] });
const researchWire = raw => JSON.stringify({ structured_output: raw, modelUsage: { 'synthetic-model': {} } });
function enqueue(raw, { character, boundary = 1, last = false, ...extra } = {}) {
 const b = Buffer.from(raw), index = character === undefined ? -1 : (last ? b.lastIndexOf(Buffer.from(character)) : b.indexOf(Buffer.from(character)));
 if (character !== undefined) assert.ok(index >= 0, 'Split character exists in the actual JSON');
 const cut = index + boundary;
 const s = { payload: { chunks: (index < 0 ? [b] : [b.subarray(0, cut), b.subarray(cut)]).map(c => c.toString('base64')), ...extra } };
 queue.push(s); return s;
}
async function extract(raw, split = {}) {
 const s = enqueue(raw, split);
 try { return await interpretDocument(config, document, bytes); }
 finally { if (s.closed) await s.closed; }
}
const source = { description: 'Synthetic purchase', purchaseDate: '2026-01-01', amount: 1, kind: 'expense' };
const context = { source, values: { ...emptyValues(source), purpose: 'company' }, references: {} };
const proof = (kind, value, id = 's0') => ({ id, kind, text: value, title: 'Synthetic evidence', url: '', hash: createHash('sha256').update(value).digest('hex'), capturedAt: '2026-10-01T00:00:00.000Z' });
async function research(responses, { mode = 'research', sources = [proof('context', JSON.stringify(context))], resultError = false } = {}) {
 const first = spawned.length, deliveries = [], calls = [], pending = responses.map(([raw, split]) => enqueue(raw, split));
 const job = { id: 'synthetic-job', mode, lease: 'synthetic-lease', context, sources, instruction: 'Synthetic test only' };
 const worker = new ResearchWorker(config, directory, { log: () => {} }); // default native invoke, never injected
 worker.api = async (route, body = {}) => {
  calls.push({ route, body });
  if (route.endsWith('claim')) return { job: route === (mode === 'research' ? 'claim' : mode + '/claim') ? job : null };
  if (route.endsWith('/result')) { deliveries.push(body); if (resultError && !body.failed) throw Error('Synthetic delivery unavailable'); }
  return { success: true };
 };
 let remaining;
 try { assert.equal(await worker.cycle(), true); }
 finally { remaining = queue.splice(0); for (const s of spawned.slice(first)) await s.closed; }
 assert.equal(remaining.length, 0, 'All planned native responses consumed');
 assert.equal(spawned.length - first, pending.length, 'No unexpected extra inference');
 for (const s of pending) {
  assert.equal(s.args[s.args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(s.args[s.args.indexOf('--effort') + 1], 'high');
 }
 return { result: deliveries.at(-1), deliveries, calls, pending, jobDirectory: path.dirname(pending[0].options.env.OMF_RESEARCH_JOB_FILE), sources };
}

test('whole document and literal replacement character remain exact', async () => {
 const raw = extraction(text + ' \ufffd');
 assert.deepEqual(await extract(docWire(raw)), validateDocumentExtraction(raw), 'evidence:document-whole');
});
test('document stream events select the final result and keep existing no-tool arguments', async () => {
 const raw = JSON.stringify({ type: 'system', message: 'Synthetic startup' }) + '\r\n' + docWire({ complete: false, pages: [], records: [] }) + docWire(extraction());
 assert.deepEqual(await extract(raw, { character: '\ud55c' }), validateDocumentExtraction(extraction()));
 const args = spawned.at(-1).args;
 assert.equal(args[args.indexOf('--tools') + 1], '');
 assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
 assert.equal(args.includes('--model'), false, 'Existing document CLI configuration is retained');
});
for (const [label, character] of [['ja', '\u4eee'], ['ko', '\ud55c'], ['four', '\ud83d\ude80']]) {
 for (let boundary = 1; boundary < Buffer.byteLength(character); boundary++) {
  test(`document ${label} boundary ${boundary} preserves literal value and quote`, async () => {
   let value;
   await assert.doesNotReject(async () => { value = await extract(docWire(extraction()), { character, boundary, last: true }); }, `evidence:document-${label}-${boundary}`);
   assert.deepEqual(value, validateDocumentExtraction(extraction()), `evidence:document-${label}-${boundary}`);
   assert.equal(spawned.at(-1).events, 2);
  });
  test(`research ${label} boundary ${boundary} preserves delivered summary`, async () => {
   const r = await research([[researchWire(report()), { character, boundary }]]);
   assert.equal(r.result.failed, undefined, `evidence:research-${label}-${boundary}`);
   assert.deepEqual(r.result.report, report(), `evidence:research-${label}-${boundary}`);
   assert.equal(r.pending[0].events, 2);
   assert.deepEqual(r.result.sources, r.sources);
   assert.equal(r.result.lease, 'synthetic-lease');
  });
 }
}
test('documentCycle uses default interpreter and delivers only its lease/hash and exact evidence', async () => {
 const raw = extraction(), s = enqueue(docWire(raw), { character: '\ud55c', boundary: 1, last: true });
 const hash = createHash('sha256').update(bytes).digest('hex');
 const job = { ...document, id: 'a'.repeat(24), lease: 'synthetic-document-lease', hash, size: bytes.length }, deliveries = [];
 const worker = { config, origin: config.baseUrl, log: () => {}, api: async () => ({}), request: async (url, options) => {
  assert.equal(options.redirect, 'error');
  if (url.endsWith('/claim')) return Response.json({ job });
  if (url.includes('/file?lease=')) return new Response(bytes);
  assert.ok(url.endsWith('/' + job.id + '/result'));
  deliveries.push(JSON.parse(options.body)); return Response.json({ success: true });
 } };
 try { assert.equal(await documentCycle(worker), true); } finally { await s.closed; }
 const { complete, pages, records } = validateDocumentExtraction(raw);
 assert.deepEqual(deliveries, [{ lease: job.lease, hash, result: { complete, pages, records: records.map(({ fields }) => ({ fields })) } }], 'evidence:document-receipt');
});
test('ResearchTools default document extraction persists exact text, candidate and source hash', async () => {
 const s = enqueue(docWire(extraction()), { character: '\ud55c', boundary: 2, last: true });
 const tools = new ResearchTools(config, { id: 'synthetic', mode: 'evaluation', sources: [] }, directory);
 let result; try { result = await tools.document(bytes, document.mimeType, 'Synthetic PDF'); } finally { await s.closed; }
 assert.equal(result.kind, 'document');
 assert.ok(result.text.includes(text), 'evidence:document-tool-text');
 assert.ok(result.text.includes(JSON.stringify(validateDocumentExtraction(extraction()).records)), 'evidence:document-tool-records');
 assert.equal(result.hash, createHash('sha256').update(result.text).digest('hex'));
 assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'evidence.json'), 'utf8')).sources, [result]);
});
for (const mode of ['research', 'evaluation', 'intake']) test(mode + ' preserves literal finding/citation and saved interpreter JSON', async () => {
 const r = report(text + ' \ufffd');
 r.findings = [{ field: 'productName', valueJson: JSON.stringify(text), basis: 'literal', reason: text, citations: [{ sourceId: 's0', quote: text }] }];
 const raw = researchWire(r), result = await research([[raw, { character: '\ud55c', boundary: 1, last: true }]], { mode, sources: [proof('document', text)] });
 assert.equal(result.result.failed, undefined, 'evidence:research-citation');
 assert.deepEqual(result.result.report, r, 'evidence:research-literal-replacement');
 assert.equal(await readFile(path.join(result.jobDirectory, 'interpreter.json'), 'utf8'), raw, 'evidence:research-raw');
 assert.ok(result.calls.some(c => c.route === (mode === 'research' ? '' : mode + '/') + 'synthetic-job/result'));
});
test('native review, wording repair and second review preserve quoted Unicode and exact summary', async () => {
 const before = report(), issue = { path: 'summary', quote: text, sourceIds: ['s0'], explanation: text }, corrected = report(text + ' \ufffd');
 const outputs = [researchWire(before), researchWire({ issues: [issue] }), researchWire({ ...corrected, findings: [], supplier: undefined }), researchWire({ issues: [] })];
 // Wording schema contains summary, question and finding edits; no supplier field.
 const result = await research(outputs.map((raw, i) => [raw, i === 1 || i === 2 ? { character: '\ud55c', boundary: 2 } : {}]), { sources: [proof('spreadsheet', text)] });
 assert.equal(result.result.failed, undefined, 'evidence:research-review-repair');
 assert.deepEqual(result.result.report, corrected, 'evidence:research-review-summary');
 for (const s of result.pending.slice(1)) assert.equal(s.args[s.args.indexOf('--tools') + 1], '');
 assert.equal(await readFile(path.join(result.jobDirectory, 'search-review-0.json'), 'utf8'), outputs[1]);
 assert.equal(await readFile(path.join(result.jobDirectory, 'repair.json'), 'utf8'), outputs[2]);
});
test('native general correction preserves Unicode after existing invalid-purpose feedback', async () => {
 const invalid = report(); invalid.findings = [{ field: 'purpose', valueJson: '"business"', reason: text, basis: 'reasoned', citations: [{ sourceId: 's0', quote: text }] }];
 const result = await research([[researchWire(invalid), {}], [researchWire(report()), { character: '\u4eee', boundary: 1 }]], { sources: [proof('document', text)] });
 assert.equal(result.result.failed, undefined, 'evidence:research-general-repair');
 assert.deepEqual(result.result.report, report());
});
test('native evidence correction keeps supported value/citation and withdraws unprinted tax', async () => {
 const valid = { field: 'productName', valueJson: JSON.stringify(text), basis: 'literal', reason: text, citations: [{ sourceId: 's0', quote: text }] };
 const invalid = report(); invalid.findings = [valid, { field: 'taxRate', valueJson: '10', basis: 'literal', reason: text, citations: [{ sourceId: 's0', quote: text }] }];
 const edits = { summary: text, question: '', findings: [{ field: 'productName', action: 'keep', reason: text }, { field: 'taxRate', action: 'withdraw', reason: text }], repairs: [], supplierAction: 'keep' };
 const r = await research([[researchWire(invalid), {}], [researchWire(edits), { character: '\ud55c', boundary: 1 }]], { sources: [proof('document', text)] });
 assert.equal(r.result.failed, undefined, 'evidence:research-evidence-repair');
 assert.deepEqual(r.result.report, { ...report(), findings: [valid] });
 assert.equal(await readFile(path.join(r.jobDirectory, 'repair.json'), 'utf8'), researchWire(edits));
});
test('malformed, interpreter error, nonzero exit and unavailable executable retain document failures', async () => {
 for (const [raw, extra, message] of [['not JSON', {}, /Invalid document response/], [JSON.stringify({ type: 'result', is_error: true }), {}, /Invalid document response/], [docWire(extraction()), { exit: 7 }, /Document interpreter failed/]]) await assert.rejects(extract(raw, extra), message);
 await assert.rejects(interpretDocument({ ...config, cliPath: path.join(directory, 'missing.exe') }, document, bytes), /Document interpreter unavailable/);
});
test('research malformed/error/nonzero failures stay owned and never transmit a report', async () => {
 for (const [raw, extra] of [['not JSON', {}], [JSON.stringify({ is_error: true }), {}], [researchWire(report()), { exit: 7 }]]) {
  const r = await research([[raw, extra]]);
  assert.equal(r.result.failed, true); assert.equal(r.result.report, undefined); assert.equal(r.result.lease, 'synthetic-lease');
  assert.ok(await readFile(path.join(r.jobDirectory, 'failure.json'), 'utf8'));
 }
});
test('failed result delivery keeps existing diagnostic and never disguises success', async () => {
 const r = await research([[researchWire(report()), {}]], { resultError: true });
 assert.equal(r.deliveries.length, 2); assert.equal(r.result.failed, true);
 assert.equal(r.result.diagnostic.code, 'delivery_failed'); assert.equal(r.result.report, undefined);
});
for (const kind of ['document', 'research']) test(kind + ' existing UTF-16 character ceiling accepts exact boundary and rejects overflow', async () => {
 const obj = kind === 'document' ? { type: 'result', structured_output: extraction(), padding: '' } : { structured_output: report(), padding: '' };
 obj.padding = '\u3042'.repeat(2000000 - JSON.stringify(obj).length);
 const raw = JSON.stringify(obj); assert.equal(raw.length, 2000000);
 if (kind === 'document') {
  assert.deepEqual(await extract(raw), validateDocumentExtraction(extraction()), 'evidence:document-limit');
  await assert.rejects(extract(raw + ' '), /Document response too large/);
 } else {
  assert.deepEqual((await research([[raw, {}]])).result.report, report(), 'evidence:research-limit');
  const r = await research([[raw + ' ', {}]]); assert.equal(r.result.failed, true); assert.equal(r.result.report, undefined);
 }
});
for (const kind of ['document', 'research']) test(kind + ' existing timeout kills only its owned child', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 let s; const first = spawned.length;
 try {
  let pending;
  if (kind === 'document') { s = enqueue('', { hang: true }); pending = assert.rejects(interpretDocument(config, document, bytes), /Document extraction timed out/); }
  else { pending = research([['', { hang: true }]]); }
  while (!spawned[first]?.child) await new Promise(resolve => setImmediate(resolve));
  s = spawned[first];
  const duration = kind === 'document' ? 90000 : 420000;
  t.mock.timers.tick(duration - 1); assert.equal(s.child.killed, false);
  t.mock.timers.tick(1); const result = await pending; await s.closed;
  assert.equal(s.child.killed, true);
  if (kind === 'research') { assert.equal(result.result.failed, true); assert.equal(result.result.diagnostic.code, 'timed_out'); assert.equal(result.result.report, undefined); }
 } finally { t.mock.timers.reset(); if (s?.child && !s.child.killed) s.child.kill(); }
});

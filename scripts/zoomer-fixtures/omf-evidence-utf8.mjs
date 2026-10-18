import { execFile } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 180000;
const tests = ['finance-evidence-stream', 'finance-interpreter-stream', 'finance-document-evidence', 'finance-research', 'finance-research-accounting', 'finance-research-questions', 'finance-research-evidence-repair', 'finance-research-purpose', 'finance-research-numbers', 'finance-research-references', 'finance-research-text', 'finance-search-review', 'finance-assistant-worker'];
const run = (names, extra = {}, pattern = null) => new Promise(resolve => execFile(process.execPath,
 ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...names.map(n => path.join(root, 'scripts', n + '.test.mjs'))],
 { cwd: root, windowsHide: true, env: { ...process.env, ...extra }, timeout: 90000, maxBuffer: 3 * 1024 * 1024 },
 (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, text: stdout + stderr })));
export default {
 name: 'omf-evidence-utf8',
 covers: ['teaching-worker/document-interpreter.mjs', 'research-worker/worker.mjs', 'scripts/finance-evidence-stream.test.mjs', 'scripts/zoomer-fixtures/omf-evidence-utf8.mjs'],
 async run() {
  const result = await run(tests), mutants = [];
  if (result.code === 0) for (const receiver of ['document', 'research']) for (const defect of ['per-chunk', 'latin1', 'strip-literal']) {
   const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-evidence-utf8-mutant-'));
   try {
    for (const folder of ['shared', 'teaching-worker', 'research-worker']) await cp(path.join(root, folder), path.join(directory, folder), { recursive: true, dereference: true });
    const relative = receiver === 'document' ? 'teaching-worker/document-interpreter.mjs' : 'research-worker/worker.mjs';
    const file = path.join(directory, relative), original = await readFile(file, 'utf8');
    const anchor = defect === 'strip-literal' ? 'output+=b;' : "child.stdout.setEncoding('utf8');";
    const replacement = defect === 'per-chunk' ? '' : defect === 'latin1' ? "child.stdout.setEncoding('latin1');" : "output+=String(b).replaceAll('\\ufffd','');";
    if (original.split(anchor).length !== 2) throw Error('Expected one owned decoder anchor');
    await writeFile(file, original.replace(anchor, replacement));
    const pattern = receiver === 'document' ? defect === 'per-chunk' ? 'document ja boundary 1' : 'whole document' : defect === 'strip-literal' ? '^research preserves literal finding' : 'research ja boundary 1';
    const expected = receiver === 'document' ? defect === 'per-chunk' ? 'evidence:document-ja-1' : 'evidence:document-whole' : defect === 'strip-literal' ? 'evidence:research-literal-replacement' : 'evidence:research-ja-1';
    const outcome = await run(['finance-evidence-stream'], { OMF_EVIDENCE_TEST_ROOT: directory }, pattern);
    mutants.push({ receiver, defect, detected: outcome.code !== 0 && outcome.text.includes(expected) && outcome.text.includes('AssertionError'), ...outcome });
   } finally {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('omf-evidence-utf8-mutant-')) throw Error('Unsafe owned mutant path');
    await rm(directory, { recursive: true, force: true });
   }
  }
  return { pass: result.code === 0 && mutants.length === 6 && mutants.every(m => m.detected), message: JSON.stringify({ result, mutants, limits: 'Synthetic real-child stdout and intercepted API receipts; no model, real HTTP, database, auth, browser or financial actions. Historical/production/release audit remains open.' }) };
 }
};

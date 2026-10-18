import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 180000;
const run = (files, extra = {}) => new Promise(resolve => execFile(process.execPath, ['--test', ...files.map(f => path.join(root, f))], { cwd: root, windowsHide: true, env: { ...process.env, ...extra }, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, text: stdout + stderr })));
export default {
 name: 'omf-navi-utf8',
 covers: ['teaching-worker/interpreter.mjs', 'scripts/finance-interpreter-stream.test.mjs', 'scripts/zoomer-fixtures/omf-navi-utf8.mjs'],
 async run() {
  const result = await run(['scripts/finance-interpreter-stream.test.mjs', 'scripts/finance-chat.test.mjs', 'scripts/finance-consultation.test.mjs', 'scripts/finance-preparation.test.mjs', 'scripts/finance-assistant-worker.test.mjs']);
  const mutants = [];
  if (result.code === 0) for (const [name, anchor, replacement, expected] of [
   ['per-chunk-decoding', "child.stdout.setEncoding('utf8');", '', 'utf8:ja-boundary-1'],
   ['single-byte-decoding', "child.stdout.setEncoding('utf8');", "child.stdout.setEncoding('latin1');", 'utf8:whole'],
   ['remove-literal-replacement', 'output+=chunk;', "output+=String(chunk).replaceAll('\\ufffd','');", 'utf8:literal-replacement']
  ]) {
   const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-navi-utf8-mutant-'));
   try {
    await mkdir(path.join(directory, 'teaching-worker'));
    await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true, dereference: true });
    const source = await readFile(path.join(root, 'teaching-worker/interpreter.mjs'), 'utf8');
    if (source.split(anchor).length !== 2) throw Error('Expected one owned mutant anchor: ' + name);
    const file = path.join(directory, 'teaching-worker/interpreter.mjs'); await writeFile(file, source.replace(anchor, replacement));
    const outcome = await run(['scripts/finance-interpreter-stream.test.mjs'], { OMF_UTF8_TEST_SOURCE: file });
    mutants.push({ name, detected: outcome.code !== 0 && outcome.text.includes(expected) && outcome.text.includes('AssertionError'), ...outcome });
   } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'omf-navi-utf8-mutant-')) throw Error('Unsafe owned mutant path');
    await rm(directory, { recursive: true, force: true });
   }
  }
  return { pass: result.code === 0 && mutants.length === 3 && mutants.every(m => m.detected), message: JSON.stringify({ result, mutants, database: 'none; real native child streams, synthetic output, actual interpreter and affected existing tests' }) };
 }
};

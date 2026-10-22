// Fixture for the P1 correction of plan omf-paypay-four-accounts-20261021 (5-plan-background-continuation.json, P1-DESIGN.md): the
// permanent, repo-relative form of the parent's retained counterexample (output/plan/omf-paypay-four-accounts-20261021/
// parent-guided-proof.mjs → PARENT-GUIDED-PROOF-RED.txt). Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-paypay-login-proof.mjs --cwd <this worktree>
// Pure code: a page-less guided ui on a virtual clock, a fictional saved-login handle, temporary folders. No browser, database,
// network, vault or bank. The PayPay standard adapter has no observed authenticated-page or statement-export contract, so after the
// one automatic submission NOTHING the collector sees — a CSV-shaped file from the public homepage host, a CSV from the login host, a
// new document — may confirm the saved login: the pending marker stays blocked (the person's captured file is still retained for
// native mapping). Only an adapter-observed refusal is recorded as a refusal. `probeLoginProof` is also run by
// scripts/zoomer-fixtures/omf-paypay-four-accounts.mjs against a mutant that reintroduces CSV acceptance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Runs the counterexample and its siblings against `bankFile` (default: this repo's collector/bank.mjs); throws the named assertion. */
export async function probeLoginProof(bankFile = path.join(root, 'collector/bank.mjs'), observed = []) {
  const sourceHash = createHash('sha256').update(await readFile(bankFile)).digest('hex');
  const { observeFromPage } = await import(pathToFileURL(bankFile).href), { standard } = await import(pathToFileURL(path.join(root, 'collector/banks/paypay.mjs')).href);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-paypay-login-proof-'));
  // One guided first capture: the saved login is submitted once with the given adapter outcome; on the second poll the person's
  // download completes from `host` with CSV-shaped bytes.
  const capture = async (label, { outcome = 'attention', host = 'www.paypay-bank.co.jp', name = 'public-rates.csv', bytes = Buffer.from('public_rate,public_fee\r\n1,2\r\n') } = {}) => {
    let state = 'ready', accepted = 0, rejected = 0, submitted = 0, clock = 0, polls = 0, directory = null; const handlers = {};
    const login = { async state() { return state; }, async open() { return { branch: '012', account: '0012345', password: 'Fictional Only' }; }, async rejected() { rejected++; state = 'blocked'; }, async accepted() { accepted++; state = 'ready'; } };
    const ui = { async open() {}, async show() {}, async loginForm() { return { ok: true, document: 'fictional-document-1' }; }, async login() { submitted++; return { outcome, document: 'fictional-document-1' }; }, downloadSession(dir) { directory = dir; return { on(event, fn) { handlers[event] = fn; }, async close() {} }; } };
    const snapshot = { provider: 'paypay', variant: 'standard', interpretation: 'unmapped', headers: [], mapping: {} }, job = { kind: 'observe', provider: 'paypay', snapshot, jobId: randomUUID() };
    const bound = { bankAccountId: 'b1'.repeat(12), ownerId: 'd4'.repeat(12), jobId: job.jobId, snapshotHash: 'fictional-snapshot', provider: 'paypay', origin: 'https://omf.example' };
    const result = await observeFromPage(null, null, standard, bound, job, path.join(temp, label), async () => {}, { ui, login, now: () => clock, pollMs: 1, timeoutMs: 5,
      wait: async ms => { clock += ms; if (++polls !== 2) return; const guid = randomUUID(); await writeFile(path.join(directory, guid), bytes); handlers['Browser.downloadWillBegin']({ guid, url: 'https://' + host + '/' + name, suggestedFilename: name }); handlers['Browser.downloadProgress']({ guid, state: 'completed', totalBytes: bytes.length }); } });
    return { label, submitted, accepted, rejected, state, capturedItems: result.items?.length || 0, failed: result.failed ?? null, notice: result.notice ?? null };
  };
  try {
    // The parent's exact case first: an unconfirmed login followed by a CSV-shaped public homepage-host file.
    const parent = await capture('parent'); observed.push(parent);
    assert.equal(createHash('sha256').update(await readFile(bankFile)).digest('hex'), sourceHash, 'source changed during probe');
    assert.equal(parent.accepted, 0, 'An unrelated public CSV must not confirm the saved bank login');
    assert.equal(parent.state, 'blocked', 'Unconfirmed saved login must remain blocked');
    // No other file or navigation confirms it either: a CSV from the login host after an unknown outcome or after a new document.
    for (const [label, options] of [['login-host-csv', { host: 'login.paypay-bank.co.jp', name: 'meisai.csv', bytes: Buffer.from('日付,内容,出金金額,入金金額,残高\r\n2026/10/01,振込,,1,1\r\n') }], ['new-document-csv', { outcome: 'submitted', host: 'login.paypay-bank.co.jp', name: 'meisai.csv', bytes: Buffer.from('日付,内容\r\n2026/10/01,x\r\n') }]]) {
      const r = await capture(label, options); observed.push(r);
      assert.equal(r.accepted, 0, 'No captured file or unknown navigation may confirm the saved bank login (' + label + ')');
      assert.equal(r.state, 'blocked', 'Unconfirmed saved login must remain blocked (' + label + ')');
      assert.equal(r.capturedItems, 1, 'The person\'s captured file is still retained for native mapping (' + label + ')');
    }
    // Plan omf-paypay-split-dates-retry-20261022: the observed active-session page (session-in-use) is no sign-in either — a CSV the person
    // then exports is kept for mapping, the saved login stays blocked (uncertain), nothing is accepted.
    const inUse = await capture('session-in-use-csv', { outcome: 'session-in-use', host: 'login.paypay-bank.co.jp', name: 'meisai.csv', bytes: Buffer.from('日付,内容\r\n2026/10/01,x\r\n') }); observed.push(inUse);
    assert.equal(inUse.accepted, 0, 'The active-session page and a later file must not confirm the saved bank login');
    assert.equal(inUse.rejected, 1, 'The active-session page writes only the pending marker, never a refusal');
    assert.equal(inUse.state, 'blocked', 'Unconfirmed saved login must remain blocked (session-in-use)'); assert.equal(inUse.capturedItems, 1);
    // An adapter-observed refusal is recorded as the refusal it is (and also stays blocked).
    const refused = await capture('refused', { outcome: 'rejected' }); observed.push(refused);
    assert.equal(refused.accepted, 0); assert.equal(refused.state, 'blocked', 'A refused saved login stays blocked');
    return { sourceHash, observed };
  } finally { if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(temp, { recursive: true, force: true }); }
}
export default { name: 'omf-paypay-login-proof', covers: ['collector/bank.mjs'], async run() {
  const observed = [];
  try { const r = await probeLoginProof(undefined, observed); return { pass: true, message: 'source ' + r.sourceHash.slice(0, 16) + '; ' + JSON.stringify(observed) }; }
  catch (error) { return { pass: false, message: String(error?.message || error) + '\n' + JSON.stringify({ observed }) }; }
} };

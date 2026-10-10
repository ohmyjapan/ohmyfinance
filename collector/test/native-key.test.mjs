// collector/test/native-key.test.mjs — legs N1/N2 of plan omf-customer-credential-security-20261009 §4: the REAL
// windows/key-broker.ps1 against the machine's Microsoft Platform Crypto Provider, OPT-IN ONLY.
//   OMF_TEST_REAL_TPM=1    N1: the proven probe-v3 path on a throwaway synthetic key ("OhMyFinance collector test-<id>")
//                          enrolled with -SilentAuth (an in-memory usage authorization): capability, enrol, private
//                          export refused, authorized round-trip through sealEnvelope/openEnvelope, a separate process
//                          without the authorization refused silently (0x80090022), destroy. NO wrong-PIN call, ever.
//   OMF_TEST_INTERACTIVE=1 N2 (the owner present): enrolment dialog, first-use dialog, a second unseal in the same broker
//                          (timed), a cancelled dialog (the owner cancels when asked) releasing nothing, destroy.
// With neither variable set nothing runs and the fixture grants no coverage.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR = path.resolve(here, '..');
export const optedIn = (env = process.env) => ({ realTpm: env.OMF_TEST_REAL_TPM === '1', interactive: env.OMF_TEST_INTERACTIVE === '1' });

/** @returns {Promise<{ ok: boolean, ran: boolean, legs: { name: string, ok: boolean, message: string, ms: number }[], ms: number }>} */
export async function runNativeKeyLegs({ env = process.env, prompt = text => process.stdout.write(text + '\n') } = {}) {
  const started = Date.now();
  const { realTpm, interactive } = optedIn(env);
  /** @type {{ name: string, ok: boolean, message: string, ms: number }[]} */ const legs = [];
  if (!realTpm && !interactive) return { ok: true, ran: false, legs, ms: 0 };
  if (process.platform !== 'win32') return { ok: false, ran: false, legs: [{ name: 'platform', ok: false, message: 'Windows only', ms: 0 }], ms: 0 };
  const leg = async (name, fn) => {
    const t = Date.now();
    try { const message = await fn(); legs.push({ name, ok: true, message: String(message ?? 'ok'), ms: Date.now() - t }); }
    catch (error) { legs.push({ name, ok: false, message: String(error && error.message || error).slice(0, 700), ms: Date.now() - t }); }
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const { startBroker, keyName, sealEnvelope, openEnvelope, aadOf } = await import(pathToFileURL(path.join(COLLECTOR, 'vault.mjs')).href);
  const realEnv = { ...env, OMF_KEY_BROKER: '' };
  const brokers = [];
  const start = async (role, extraArgs) => { const broker = await startBroker(role, { env: realEnv, extraArgs }); brokers.push(broker); return broker; };
  const unseal = async (broker, envelope) => { const reply = await broker.request('unseal', { wrapped: envelope.wrapped }, 300000); return reply; };
  try {
    if (realTpm) {
      const auth = randomBytes(20).toString('base64');
      const installationId = 'test-' + randomBytes(8).toString('hex');
      const name = keyName(installationId);
      const aad = aadOf({ installationId, provider: 'check', accountId: 'check' });
      const canary = { canary: randomBytes(16).toString('hex') };
      let a = null, envelope = null;
      await leg('N1 capability: the platform provider opens and reports its implementation type', async () => {
        a = await start('key', ['-SilentAuth', auth]);
        const reply = await a.request('capability', {}, 60000);
        check(reply.ok === true, `capability ${JSON.stringify(reply)}`);
        return `provider ${reply.provider}, implType ${reply.implType}, hardware ${reply.hardware}`;
      });
      await leg('N1 enrol a throwaway key silently with the in-memory authorization (export policy 0)', async () => {
        const reply = await a.request('enroll', { name }, 60000);
        check(reply.ok === true && reply.publicKey && reply.exportPolicy === 0, `enroll ${JSON.stringify(reply)}`);
        envelope = sealEnvelope(reply.publicKey, aad, canary);
        return `${name}: export policy ${reply.exportPolicy}`;
      });
      await leg('N1 private export refused', async () => {
        const reply = await a.request('probe-export', {}, 60000);
        check(reply.ok === true && reply.exportAllowed === false, `probe-export ${JSON.stringify(reply)}`);
        return `NCryptExportKey RSAPRIVATEBLOB ${reply.status}`;
      });
      await leg('N1 authorized round-trip: the broker unwraps the data key and the envelope opens', async () => {
        const reply = await unseal(a, envelope);
        check(reply.ok === true && typeof reply.key === 'string', `unseal ${JSON.stringify(reply)}`);
        const opened = openEnvelope(envelope, Buffer.from(reply.key, 'base64'), aad);
        check(opened.canary === canary.canary, 'the canary did not round-trip');
        return 'canary round-trip ok';
      });
      await leg('N1 a separate process without the authorization is refused silently (no dialog, no plaintext)', async () => {
        const b = await start('key', ['-Silent']);
        const opened = await b.request('open', { name }, 60000);
        check(opened.ok === true, `open in the second process ${JSON.stringify(opened)}`);
        const reply = await unseal(b, envelope);
        check(reply.ok === false && reply.code === 'silent_refused', `expected silent refusal, got ${JSON.stringify(reply)}`);
        await b.end();
        return `second process: ${reply.status} ${reply.code}`;
      });
      await leg('N1 destroy the throwaway key', async () => {
        const reply = await a.request('destroy', { name }, 60000);
        check(reply.ok === true, `destroy ${JSON.stringify(reply)}`);
        await a.end();
        return `${name} deleted`;
      });
    }
    if (interactive) {
      const installationId = 'test-' + randomBytes(8).toString('hex');
      const name = keyName(installationId);
      const aad = aadOf({ installationId, provider: 'check', accountId: 'check' });
      const canary = { canary: randomBytes(16).toString('hex') };
      let c = null, envelope = null;
      await leg('N2 enrolment shows the Windows key-protection dialog (complete it)', async () => {
        prompt('N2: COMPLETE the Windows key-protection dialog for the enrolment of a throwaway test key.');
        c = await start('key', []);
        const reply = await c.request('enroll', { name }, 300000);
        check(reply.ok === true, `enroll ${JSON.stringify(reply)}`);
        envelope = sealEnvelope(reply.publicKey, aad, canary);
        return `${name} enrolled`;
      });
      await leg('N2 first unseal in the batch shows the dialog (complete it); the envelope opens', async () => {
        prompt('N2: COMPLETE the dialog for the first unlock.');
        const t = Date.now();
        const reply = await unseal(c, envelope);
        check(reply.ok === true, `unseal ${JSON.stringify(reply)}`);
        check(openEnvelope(envelope, Buffer.from(reply.key, 'base64'), aad).canary === canary.canary, 'canary mismatch');
        return `first unseal ${Date.now() - t} ms`;
      });
      await leg('N2 second unseal in the same broker (records whether a second dialog appeared, by timing)', async () => {
        prompt('N2: if a dialog appears for the second unlock, COMPLETE it.');
        const t = Date.now();
        const reply = await unseal(c, envelope);
        check(reply.ok === true, `second unseal ${JSON.stringify(reply)}`);
        return `second unseal ${Date.now() - t} ms (a dialog is likely above ~1500 ms)`;
      });
      await leg('N2 a cancelled dialog releases nothing (cancel it)', async () => {
        const d = await start('key', []);
        const opened = await d.request('open', { name }, 60000);
        check(opened.ok === true, `open ${JSON.stringify(opened)}`);
        prompt('N2: CANCEL the next dialog.');
        const reply = await unseal(d, envelope);
        check(reply.ok === false && reply.key === undefined, `expected a refusal, got ${JSON.stringify(reply)}`);
        await d.end();
        return `cancelled: ${reply.code} ${reply.status || ''}`;
      });
      await leg('N2 destroy the throwaway key', async () => {
        const reply = await c.request('destroy', { name }, 300000);
        check(reply.ok === true, `destroy ${JSON.stringify(reply)}`);
        await c.end();
        return `${name} deleted`;
      });
    }
  } finally {
    for (const broker of brokers) await broker.end().catch(() => {});
  }
  return { ok: legs.length > 0 && legs.every(l => l.ok), ran: true, legs, ms: Date.now() - started };
}

if (process.env.NODE_TEST_CONTEXT) {
  const { default: test } = await import('node:test');
  const { realTpm, interactive } = optedIn();
  test('native key broker on the real platform provider (opt-in OMF_TEST_REAL_TPM=1 / OMF_TEST_INTERACTIVE=1)', { skip: process.platform !== 'win32' || !(realTpm || interactive) ? 'opt-in not set' : false, timeout: 900000 }, async () => {
    const result = await runNativeKeyLegs();
    const failed = result.legs.filter(l => !l.ok).map(l => `${l.name}: ${l.message}`);
    if (failed.length) throw new Error(failed.join('\n'));
  });
}

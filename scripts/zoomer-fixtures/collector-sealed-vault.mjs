// Built HTTPS/native acceptance for the remembered-PC collector. Build OMF first.
// Runs an owned temporary MongoDB, TLS proxy, actual Windows DPAPI/owner broker and isolated Chrome.
// All users and credentials are synthetic. External browser requests are intercepted; no production writes.
// Covers fresh approval, independent device trust, migration interruptions, credential saves, process restarts,
// pause/resume, reset response loss and disconnect. Native browser ownership and primitive fault tests are separate.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 600000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const LEGS = path.join(REPO_ROOT, 'collector', 'test', 'sealed-vault.test.mjs');

export default {
  name: 'collector-sealed-vault',
  covers: ["collector/vault.mjs","collector/index.mjs","collector/omf-authorization.mjs","collector/windows/key-broker.ps1","pages/collector-approval.vue","server/api/finance/collector-security/[...path].ts","server/services/financeCollectorSecurityService.ts","server/models/FinanceCollectorSecurity.ts","scripts/collector-trusted-device-http.ts","collector/test/sealed-vault.test.mjs"],
  async run() {
    const started = Date.now();
    if (process.platform !== 'win32') return { pass: false, message: 'the Windows collector vault can only be exercised on Windows' };
    let suite;
    try { suite = await import(pathToFileURL(LEGS).href); }
    catch (error) { return { pass: false, message: `collector/test/sealed-vault.test.mjs could not be loaded: ${error?.message || error}` }; }
    let result;
    try { result = await suite.runSealedVaultLegs(); }
    catch (error) { return { pass: false, message: `the legs threw before a verdict: ${error?.message || error}` }; }
    const lines = result.legs.map(leg => `${leg.name} ${leg.ok ? 'ok' : 'RED'} (${Math.round(leg.ms / 1000)}s): ${leg.message}`);
    const red = result.legs.filter(leg => !leg.ok).length;
    return { pass: result.ok, message: `${result.ok ? `${result.legs.length} legs green` : `${red} of ${result.legs.length} legs red`} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

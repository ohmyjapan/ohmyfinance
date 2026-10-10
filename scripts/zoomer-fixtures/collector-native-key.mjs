// Fixture for plan omf-customer-credential-security-20261009 (§4, collector-native-key) — OPT-IN. Run ONLY through the hub verifier:
//   OMF_TEST_REAL_TPM=1 node scripts/zoomer-verify.mjs --run-fixture collector-native-key.mjs --cwd <this worktree>
//   OMF_TEST_INTERACTIVE=1 ... (the owner present at the PC)
// N1: the real windows/key-broker.ps1 against the machine's Microsoft Platform Crypto Provider on a throwaway synthetic key
// enrolled with the in-memory usage authorization (the probe-v3 path): capability, enrol, private export refused, authorized
// round-trip, a separate process without the authorization refused silently, destroy — NO wrong-PIN call, ever. N2: the
// interactive dialogs (enrolment, first use, second unseal timing, cancel releases nothing). With neither variable set the
// fixture runs nothing, passes with that note and declares `covers: []` — it grants no coverage of code it did not exercise.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 900000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const LEGS = path.join(REPO_ROOT, 'collector', 'test', 'native-key.test.mjs');
const optedIn = process.env.OMF_TEST_REAL_TPM === '1' || process.env.OMF_TEST_INTERACTIVE === '1';

export default {
  name: 'collector-native-key',
  covers: optedIn ? ['collector/windows/key-broker.ps1', 'collector/vault.mjs', 'collector/test/native-key.test.mjs'] : [],
  async run() {
    const started = Date.now();
    if (!optedIn) return { pass: true, message: 'OMF_TEST_REAL_TPM / OMF_TEST_INTERACTIVE not set: the native legs did not run and this fixture grants no coverage (NOT RUN until the owner opts in)' };
    let suite;
    try { suite = await import(pathToFileURL(LEGS).href); }
    catch (error) { return { pass: false, message: `collector/test/native-key.test.mjs could not be loaded: ${error?.message || error}` }; }
    let result;
    try { result = await suite.runNativeKeyLegs(); }
    catch (error) { return { pass: false, message: `the legs threw before a verdict: ${error?.message || error}` }; }
    const lines = result.legs.map(leg => `${leg.name} ${leg.ok ? 'ok' : 'RED'} (${Math.round(leg.ms / 1000)}s): ${leg.message}`);
    const red = result.legs.filter(leg => !leg.ok).length;
    return { pass: result.ok, message: `${result.ok ? `${result.legs.length} native legs green` : `${red} of ${result.legs.length} native legs red`} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

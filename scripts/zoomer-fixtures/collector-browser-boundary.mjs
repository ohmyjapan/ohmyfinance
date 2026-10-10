// Fixture for plan omf-customer-credential-security-20261009 (§4, collector-browser-boundary). Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture collector-browser-boundary.mjs --cwd <this worktree>
// The real stock Chrome of this host launched by the real collector/browser.mjs (headless, temporary ephemeral profiles,
// pages on about:blank — no issuer, no network), the real collector started in the fixture process with the fake key
// broker, and the REAL windows/key-broker.ps1 in its owner role (job object only). Legs (collector/test/browser-boundary.test.mjs):
//   B5 a leftover Chrome on an ephemeral profile is ended by startup recovery (exact identity) and its folder removed; an
//   unrelated Chrome and a retained profile sentinel survive · B1 the owned launch carries no --no-sandbox,
//   --disable-web-security or --remote-debugging-port, uses --remote-debugging-pipe, listens on nothing and runs at medium
//   integrity · B1 a second process is refused the profile (never attach) · B2 /lock, B3 the broker's locked event and
//   B4 expiry end the browser within seconds and delete the ephemeral profile · B7 the real broker owns the browser: the
//   broker killed → browser gone; a collector-like child killed → its broker and browser gone; the unrelated Chrome lives
//   · B6 the retained sentinel is untouched. Chrome missing = a reported failure, never a pass.
// Fail-first on 27a3903: the launch carries --no-sandbox and a TCP debugging port, a second process attaches, /protect is 404.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 600000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const LEGS = path.join(REPO_ROOT, 'collector', 'test', 'browser-boundary.test.mjs');

export default {
  name: 'collector-browser-boundary',
  covers: ['collector/browser.mjs', 'collector/index.mjs', 'collector/yayoi.mjs', 'collector/windows/browser-process.ps1', 'collector/windows/key-broker.ps1', 'collector/test/browser-boundary.test.mjs', 'collector/test/fake-broker.mjs', 'collector/package.json'],
  async run() {
    const started = Date.now();
    if (process.platform !== 'win32') return { pass: false, message: 'the Windows collector browser boundary can only be exercised on Windows' };
    let suite;
    try { suite = await import(pathToFileURL(LEGS).href); }
    catch (error) { return { pass: false, message: `collector/test/browser-boundary.test.mjs could not be loaded: ${error?.message || error}` }; }
    let result;
    try { result = await suite.runBrowserBoundaryLegs(); }
    catch (error) { return { pass: false, message: `the legs threw before a verdict: ${error?.message || error}` }; }
    const lines = result.legs.map(leg => `${leg.name} ${leg.ok ? 'ok' : 'RED'} (${Math.round(leg.ms / 1000)}s): ${leg.message}`);
    const red = result.legs.filter(leg => !leg.ok).length;
    return { pass: result.ok, message: `${result.ok ? `${result.legs.length} legs green` : `${red} of ${result.legs.length} legs red`} with Chrome ${result.chrome || 'not found'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

// Fixture for plan omf-amex-scroll-click-20261009: the Amex click after a CSS smooth scroll. Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture amex-scroll-click.mjs --cwd <this worktree>
// No recorded case and no database: synthetic pages in the stock headless Chrome of this host, through the collector's
// own installed puppeteer, every request intercepted (cloud-probe/test/interaction-browser.mjs). The same legs run twice:
//   1. the real collector/interaction.mjs — every leg green: the control receives the one trusted click after a smooth
//      scroll down and up (natural pointer timing and the pointer dispatched after the scroll settled), on the ordinary
//      auto-scroll page, on the OTP channel label and the text-selected button; the four existing refusals (wrong origin,
//      covered, duplicate, disabled) still refuse without a click;
//   2. a copy with the smooth-scroll original restored (`behavior: 'instant'` removed — the one mutation): the late-pointer
//      legs must go RED by an actual trusted click on a decoy, and the auto page and the four refusals must stay green
//      (the option adds no guard; nothing else changes).
// Natural-timing smooth legs are recorded for both runs and asserted only on the real module: whether the pointer lands
// before the animation moves the control depends on the host's pointer latency (the 2026-10-09 cloud Chrome missed).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INTERACTION = path.join(REPO_ROOT, 'collector', 'interaction.mjs');
const HELPER = path.join(REPO_ROOT, 'cloud-probe', 'test', 'interaction-browser.mjs');

const FIXED = "scrollIntoView({ block: 'center', behavior: 'instant' })";
const ORIGINAL = "scrollIntoView({ block: 'center' })";
const MUST_GO_RED = ['smooth-down-late-pointer', 'smooth-up-late-pointer', 'label-late-pointer', 'text-button-late-pointer'];
const MUST_STAY_GREEN = ['auto-down', 'wrong-origin', 'covered', 'duplicate', 'disabled'];
const RECORDED_ONLY = ['smooth-down', 'smooth-up'];

const legLine = leg => `${leg.name} ${leg.ok ? 'ok' : 'RED'} (${leg.ms} ms): ${leg.message}`;
const wrongTarget = leg => !leg.ok && leg.error === null && leg.clicks.length === 1 && leg.clicks[0].trusted === true && /^decoy-/.test(leg.clicks[0].id);

async function summarize(label, run, lines) {
  lines.push(`${label}: Chrome ${run.version || 'not launched'} at ${run.chrome || 'none'}, ${run.legs.length} legs in ${Math.round(run.ms / 1000)}s, ${run.served} synthetic documents served, ${run.blocked.length} other requests aborted${run.blocked.some(url => !url.startsWith('https://omf-synthetic.invalid/')) ? ` (UNEXPECTED: ${[...new Set(run.blocked)].join(', ')})` : ''}${run.profileLeft ? `, temporary profile left at ${run.profileLeft}` : ''}`);
  if (run.error) lines.push(`${label} error: ${run.error}`);
}

export default {
  name: 'amex-scroll-click',
  covers: ['collector/interaction.mjs'],
  async run() {
    const started = Date.now();
    /** @type {string[]} */ const lines = [];
    let pass = true;
    let helper;
    try { helper = await import(pathToFileURL(HELPER).href); }
    catch (error) { return { pass: false, message: `cloud-probe/test/interaction-browser.mjs could not be loaded: ${error?.message || error}` }; }

    // 1. The real module: every leg green.
    const real = await helper.runInteractionLegs({ interactionUrl: pathToFileURL(INTERACTION).href });
    await summarize('real collector/interaction.mjs', real, lines);
    if (real.error) pass = false;
    for (const leg of real.legs) { if (!leg.ok) pass = false; lines.push(`real ${legLine(leg)}`); }
    if (real.legs.length !== helper.LEGS.length) { pass = false; lines.push(`real run completed ${real.legs.length}/${helper.LEGS.length} legs`); }

    // 2. The smooth-scroll original restored: red by an actual wrong target at the late-pointer legs, green elsewhere.
    const source = await readFile(INTERACTION, 'utf8');
    const parts = source.split(FIXED);
    if (parts.length !== 2) {
      pass = false;
      lines.push(`mutation not built: "${FIXED}" occurs ${parts.length - 1} times in collector/interaction.mjs (expected once)${source.includes(ORIGINAL) ? ' — the smooth-scroll original is the current code' : ''}`);
    } else if (/from\s+['"]\.{1,2}\//.test(source)) {
      pass = false;
      lines.push('mutation not built: collector/interaction.mjs now has relative imports; the copied module would not resolve them');
    } else {
      const base = await mkdtemp(path.join(os.tmpdir(), 'omf-scroll-click-mutation-'));
      try {
        const copy = path.join(base, 'collector', 'interaction.mjs');
        await mkdir(path.dirname(copy), { recursive: true });
        await writeFile(copy, parts.join(ORIGINAL));
        const mutated = await helper.runInteractionLegs({ interactionUrl: pathToFileURL(copy).href });
        await summarize('smooth-scroll original restored', mutated, lines);
        if (mutated.error) pass = false;
        for (const leg of mutated.legs) {
          if (MUST_GO_RED.includes(leg.name)) {
            const red = wrongTarget(leg);
            if (!red) pass = false;
            lines.push(`mutation ${leg.name} ${red ? 'red by wrong target' : 'NOT CAUGHT'}: ${leg.message}`);
          } else if (MUST_STAY_GREEN.includes(leg.name)) {
            if (!leg.ok) pass = false;
            lines.push(`mutation ${leg.name} ${leg.ok ? 'still ok' : 'CHANGED'}: ${leg.message}`);
          } else if (RECORDED_ONLY.includes(leg.name)) {
            lines.push(`mutation ${leg.name} recorded (natural timing on this host): ${leg.message}`);
          }
        }
        for (const name of [...MUST_GO_RED, ...MUST_STAY_GREEN]) if (!mutated.legs.some(leg => leg.name === name)) { pass = false; lines.push(`mutation leg ${name} did not run`); }
      } finally {
        if (path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(base, { recursive: true, force: true });
      }
    }
    return { pass, message: `${pass ? 'real legs green; smooth-scroll original red by wrong target at the late-pointer legs, refusals unchanged' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

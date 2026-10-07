// Fixture for plan omf-railway-amex-probe-20261007 (§4). Run ONLY through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture railway-amex-probe.mjs --cwd <this worktree>
// No recorded case: it drives cloud-probe/run.mjs, relay.mjs and local/drive.mjs through an in-process stream
// pair in place of ssh with the fake page of cloud-probe/test/fake-amex.mjs — no Chrome, Gmail, vault or network.
// Legs R1-R7 (cloud-probe/test/probe.test.mjs), the collector suite (inside R6a) and defects D1-D10, each built as a
// defective copy of the module it names and expected RED at the leg's tag.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const PROBE_DIR = path.join(REPO_ROOT, 'cloud-probe');
const COPIED = ['run.mjs', 'relay.mjs', 'local/drive.mjs'];

// Each defect: the module, the exact source anchor (must occur exactly once), its replacement, the leg that goes red.
const DEFECTS = [
  { id: 'D1', what: 'password in a status line', file: 'run.mjs', leg: 'R3a', find: 'const status = async (state, text) => {', replace: "const status = async (state, text) => { output.write(JSON.stringify({ event: 'status', state: 'debug', text: 'typing ' + (credentials?.password ?? '') }) + '\\n');" },
  { id: 'D2', what: 'claim after type-code', file: 'relay.mjs', leg: 'R1', find: "claim: async id => { const answer = await this.request({ event: 'claim', id }, ['claimed', 'claim_failed']);", replace: "claim: async id => { const answer = { event: 'claimed' }; void this.request({ event: 'claim', id }, ['claimed', 'claim_failed']).catch(() => {});" },
  { id: 'D3', what: 'a second password after attention', file: 'run.mjs', leg: 'R4', find: 'const ending = await attempt();', replace: "let ending = await attempt(); if (ending.outcome === 'attention') { await page.goto('https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog', { waitUntil: 'domcontentloaded', timeout: 60000 }); ending = await attempt(); }" },
  { id: 'D4', what: 'unknown page named bot_rejected', file: 'run.mjs', leg: 'R2', find: "outcome: state?.kind === 'login' ? 'login_form_shown' : 'unknown_page'", replace: "outcome: state?.kind === 'login' ? 'login_form_shown' : 'bot_rejected'" },
  { id: 'D5', what: 'CSV bytes echoed in the result', file: 'run.mjs', leg: 'R3a', find: 'manifest: collected.manifest', replace: "manifest: collected.manifest, csv: (await import('node:fs')).readFileSync(collected.directory + '/' + collected.manifest.filename, 'utf8')" },
  { id: 'D6', what: '/run/omf kept', file: 'run.mjs', leg: 'R1', find: "for (const name of ['profile', 'download', 'work']) await rm(", replace: 'for (const name of []) await rm(' },
  { id: 'D7', what: 'a screenshot taken in collect', file: 'run.mjs', leg: 'R3b', find: "{ screenshot: stage === 'reach' }", replace: '{ screenshot: true }' },
  { id: 'D8', what: 'scrub skipped for frame text', file: 'run.mjs', leg: 'R3b', find: 'text: scrub(text, secrets)', replace: 'text: text' },
  { id: 'D9', what: 'next missing for attention', file: 'local/drive.mjs', leg: 'R7', find: "  attention: '", replace: "  attention_removed: '" },
  { id: 'D10', what: 'LoginClaims built from settings.profile instead of directory', file: 'collector/browser.mjs', leg: 'R6a', find: 'claims: new LoginClaims(directory) });', replace: 'claims: new LoginClaims(settings.profile) });' }
];

function mutate(source, defect) {
  const parts = source.split(defect.find);
  if (parts.length !== 2) throw new Error(`${defect.id}: anchor found ${parts.length - 1} times in ${defect.file} (expected exactly once)`);
  return parts.join(defect.replace);
}

// Relative imports into collector/ and shared/ become absolute file URLs; siblings copied beside stay relative.
function relocate(source, originalFile) {
  return source.replace(/(from\s+|import\()\s*'(\.{1,2}\/[^']+)'/g, (match, prefix, spec) => {
    const target = path.resolve(path.dirname(originalFile), spec);
    if (target.startsWith(PROBE_DIR + path.sep)) return match;
    return `${prefix}'${pathToFileURL(target).href}'`;
  });
}

async function defectiveProbeDir(defect, base) {
  const dir = path.join(base, defect.id, 'cloud-probe');
  for (const name of COPIED) {
    const original = path.join(PROBE_DIR, name);
    let source = await readFile(original, 'utf8');
    if (name === defect.file) source = mutate(source, defect);
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), relocate(source, original));
  }
  return dir;
}

export default {
  name: 'railway-amex-probe',
  covers: ['collector/browser.mjs', 'cloud-probe/run.mjs', 'cloud-probe/relay.mjs', 'cloud-probe/local/drive.mjs', 'cloud-probe/test/fake-amex.mjs', 'cloud-probe/test/probe.test.mjs'],
  async run() {
    const started = Date.now();
    let suite;
    try { suite = await import(pathToFileURL(path.join(PROBE_DIR, 'test', 'probe.test.mjs')).href); }
    catch (error) { return { pass: false, message: `legs R1-R7 red: cloud-probe/test/probe.test.mjs could not be loaded: ${error?.message || error}` }; }
    const lines = [];
    let pass = true;
    let ctx;
    try { ctx = await suite.makeContext(); }
    catch (error) { return { pass: false, message: `legs R1-R7 red: context could not be built: ${error?.message || error}` }; }
    for (const [name, error] of Object.entries(ctx.modules.errors)) lines.push(`module ${name} not loadable (${error})`);
    const legs = await suite.runLegs(ctx);
    for (const leg of legs) { if (!leg.ok) pass = false; lines.push(`${leg.name} ${leg.ok ? 'ok' : 'RED'} (${Math.round(leg.ms / 1000)}s): ${leg.message}`); }
    if (!pass) return { pass: false, message: `legs red; defects not attempted — ${lines.join(' · ')}` };

    const base = await mkdtemp(path.join(os.tmpdir(), 'omf-probe-defects-'));
    try {
      for (const defect of DEFECTS) {
        let caught = null;
        try {
          let ctx2;
          if (defect.file === 'collector/browser.mjs') ctx2 = { ...ctx, browserSource: mutate(ctx.browserSource, defect) };
          else ctx2 = await suite.makeContext({ probeDir: await defectiveProbeDir(defect, base), browserSource: ctx.browserSource, referenceSource: ctx.referenceSource });
          const [result] = await suite.runLegs(ctx2, [defect.leg]);
          caught = result.ok ? null : result.message;
        } catch (error) { pass = false; lines.push(`${defect.id} (${defect.what}) could not be built: ${error?.message || error}`); continue; }
        const red = typeof caught === 'string' && caught.startsWith(`[${defect.leg}:`);
        if (!red) pass = false;
        lines.push(`${defect.id} (${defect.what}) ${red ? 'red at ' + caught.slice(0, caught.indexOf(']') + 1) : 'NOT CAUGHT: ' + (caught || defect.leg + ' stayed green')}`);
      }
    } finally {
      if (path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(base, { recursive: true, force: true });
    }
    return { pass, message: `${pass ? 'legs R1-R7 green and D1-D10 red' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${lines.join(' · ')}` };
  }
};

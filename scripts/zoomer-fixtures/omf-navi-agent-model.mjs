// Navi product-model acceptance corpus (docs/navi-agent-model-evaluation.md). Run only through the hub verifier:
//   node scripts/zoomer-verify.mjs --run-fixture omf-navi-agent-model.mjs --cwd <omf worktree>     (from the OhMyCode root)
// Default (OMF_NAVI_AGENT_MODEL_MODE unset): real disposable local child transport, manifest and grade contracts only. Zero model,
// provider or application calls; it grants NO app or model coverage (covers stays empty in every mode).
// Explicit modes need OMF_NAVI_AGENT_MODEL_MODE plus a declared nonempty case list and an owned new output directory:
//   prepare  — owned app/Mongo synthetic setup, resolved and frozen requests, baseline checks; zero model calls.
//   selftest — prepare plus one scripted synthetic worker turn per case (the native worker routes, no model) and its checks.
//   manual   — the paid product corpus: actual TeachingWorker.cycle(), the configured native CLI and its own heartbeat.
// Nothing here edits the shared verifier, a hold-back list or any product source.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 300000;
export default {
  name: 'omf-navi-agent-model',
  covers: [],
  async run() {
    const mode = process.env.OMF_NAVI_AGENT_MODEL_MODE;
    if (mode === undefined || mode === '') {
      const { runContracts } = await import('../finance-navi-agent-model-observer.test.mjs');
      const r = await runContracts({ root });
      return { pass: r.pass, message: JSON.stringify({ mode: 'contracts', pass: r.pass, checks: r.checks, failures: r.failures, deliberateDefects: r.deliberateDefects, modelCalls: 0, appCalls: 0, providerCalls: 0, coverage: 'none: local transport/manifest/grade contracts only; no application or product-model coverage', limits: r.limits }) };
    }
    const { runCorpusFromEnvironment } = await import('../finance-navi-agent-model.mjs');
    const r = await runCorpusFromEnvironment(process.env, { root });
    return { pass: r.pass, message: JSON.stringify(r.summary), ...(r.databaseCoverage ? { databaseCoverage: r.databaseCoverage } : {}) };
  }
};

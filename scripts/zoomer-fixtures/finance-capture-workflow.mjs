import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// The verifier owns the timeout and terminates the complete child process tree.
export const timeoutMs = 900000;

export default {
  name: 'finance-capture-workflow',
  covers: [
    'research-worker/sheet-export.mjs',
    'research-worker/sheets.mjs',
    'research-worker/search-evidence.mjs',
    'finalization-worker/worker.mjs',
    'shared/finance-workflow.mjs',
    'shared/finance-workflow-matching.mjs',
    'server/services/financeService.ts',
    'server/services/financeAssistantService.ts',
    'server/services/financeDraftService.ts',
    'shared/finance-assistant.d.mts',
    'shared/finance-workflow-investigation.mjs',
    'server/models/User.ts',
    'server/models/Organization.ts',
    'server/models/Receipt.ts',
    'server/services/receiptManagementService.ts',
    'server/services/receiptService.ts',
    'server/api/receipts/index.ts',
    'server/api/receipts/[id].ts',
    'server/api/receipts/upload.ts',
    'server/api/receipts/export.ts',
    'server/api/receipts/auto-match.ts',
    'server/api/receipts/[id]/match.ts',
    'server/api/receipts/[id]/matches.ts',
    'stores/receipt.ts',
    'types/receipt.ts',
    'scripts/receipt-management-integration.cjs',
    'scripts/auth-integration.cjs',
    'scripts/finance-sheet-export.test.mjs',
    'scripts/finance-sheet-continuation.test.mjs',
    'scripts/finance-search-evidence.test.mjs',
    'scripts/finance-workflow-worker.test.mjs',
    'scripts/finance-workflow-matching.test.mjs',
    'scripts/finance-workflow.test.mjs',
    'scripts/finance-assistant.test.mjs',
    'scripts/finance-workflow-evidence.test.mjs',
    'scripts/finance-integration.cjs',
    'scripts/finance-workflow-integration.cjs',
    'scripts/finance-workflow-worker-integration.cjs',
  ],
  run() {
    const env = { ...process.env };
    // Only the isolated workflow branch may run. Ambient switches must not
    // select a different suite or attach the tests to an owner's real Chrome.
    for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
    env.OMF_TEST_WORKFLOW_ONLY = '1';
    env.MONGO_URI = env.NUXT_MONGO_URI = 'mongodb://127.0.0.1:1/omf_fixture_no_ambient_database';
    env.JWT_SECRET = 'isolated-fixture-placeholder-not-a-production-secret';
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'SLACK_BOT_TOKEN']) {
      env[key] = 'isolated-fixture-no-credential';
    }
    const logs = [];
    const stage = (name, args) => {
      const child = spawnSync(process.execPath, args, {
        cwd: root, env, encoding: 'utf8', windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      const output = [child.stdout, child.stderr, child.error?.message].filter(Boolean).join('\n');
      logs.push(`${name}: exit=${child.status}\n${output}`);
      return { ok: child.status === 0 && !child.error, output };
    };
    const result = pass => ({ pass, message: logs.join('\n\n') });
    const unit = stage('capture and workflow unit regression', ['--test', '--test-reporter=tap',
      'scripts/finance-sheet-export.test.mjs',
      'scripts/finance-sheet-continuation.test.mjs',
      'scripts/finance-search-evidence.test.mjs',
      'scripts/finance-workflow-worker.test.mjs',
      'scripts/finance-workflow-matching.test.mjs',
      'scripts/finance-workflow.test.mjs',
      'scripts/finance-assistant.test.mjs',
      'scripts/finance-workflow-evidence.test.mjs',
    ]);
    if (!unit.ok) return result(false);
    const total = Number(unit.output.match(/^# tests (\d+)\s*$/m)?.[1]);
    const passed = Number(unit.output.match(/^# pass (\d+)\s*$/m)?.[1]);
    const skipped = Number(unit.output.match(/^# skipped (\d+)\s*$/m)?.[1]);
    const todo = Number(unit.output.match(/^# todo (\d+)\s*$/m)?.[1]);
    if (!(total >= 43 && passed === total && skipped === 0 && todo === 0)) {
      logs.push('The complete unit suite must execute; skipped or missing cases are not coverage.');
      return result(false);
    }
    // The API integration uses .output. Always rebuild the current source tree
    // so an older successful bundle cannot hide a source regression.
    if (!stage('fresh Nuxt build', ['node_modules/nuxt/bin/nuxt.mjs', 'build']).ok) return result(false);
    const integration = stage('isolated workflow API integration', ['scripts/finance-integration.cjs']);
    const checks = Number(integration.output.match(/^(\d+) targeted workflow checks passed\s*$/m)?.[1]);
    if (!integration.ok || !(checks >= 18)) {
      logs.push('The isolated workflow suite must finish all its checks.');
      return result(false);
    }
    const auth = stage('isolated authentication and organization integration', ['scripts/auth-integration.cjs']);
    const authChecks = Number(auth.output.match(/^Authentication integration: (\d+) checks passed; production data untouched\.\s*$/m)?.[1]);
    if (!auth.ok || !(authChecks >= 10)) {
      logs.push('The isolated authentication and organization suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_WORKFLOW_ONLY;
    env.OMF_TEST_RECEIPTS_ONLY = '1';
    const receipts = stage('isolated receipt management integration', ['scripts/finance-integration.cjs']);
    const receiptChecks = Number(receipts.output.match(/^(\d+) targeted receipt management checks passed\s*$/m)?.[1]);
    if (!receipts.ok || !(receiptChecks >= 11)) {
      logs.push('The isolated receipt management suite must finish all its checks.');
      return result(false);
    }
    logs.push(`Verified ${passed} unit tests, ${checks} isolated workflow checks, ${authChecks} authentication checks and ${receiptChecks} receipt management checks against freshly built source.`);
    return result(true);
  },
};

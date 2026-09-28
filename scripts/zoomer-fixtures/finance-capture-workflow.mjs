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
    'server/models/Vendor.ts',
    'nuxt.config.ts',
    'package.json',
    'package-lock.json',
    'server/api/transactions/process.ts',
    'server/api/receipts/match.ts',
    'server/services/fileUploadService.ts',
    'scripts/file-processing-contracts.test.cjs',
    'server/services/proxyService.ts',
    'server/middleware/proxy.ts',
    'server/api/proxy/[source].ts',
    'composables/useProxy.ts',
    'scripts/proxy-contracts.test.cjs',
    'scripts/proxy-integration.cjs',
    'server/models/Shipment.ts',
    'server/services/shipmentService.ts',
    'server/api/shipments/[id]/update-status.ts',
    'stores/shipment.ts',
    'scripts/shipment-status.test.cjs',
    'scripts/shipment-status-integration.cjs',
    'server/models/Transaction.ts',
    'server/api/transactions/[id]/status.ts',
    'types/transaction.ts',
    'scripts/transaction-status.test.cjs',
    'scripts/transaction-status-integration.cjs',
    'plugins/api.ts',
    'composables/useFileUpload.ts',
    'server/middleware/file-upload.ts',
    'utils/excel-processor.ts',
    'scripts/legacy-upload-contracts.test.cjs',
    'server/services/receiptManagementService.ts',
    'server/services/receiptService.ts',
    'server/utils/receiptMatching.ts',
    'components/receipt/ReceiptMatchDialog.vue',
    'scripts/receipt-candidates.test.cjs',
    'scripts/receipt-dialog.test.cjs',
    'scripts/helpers/receipt-dialog.cjs',
    'scripts/receipt-candidates-integration.cjs',
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
      'scripts/legacy-upload-contracts.test.cjs',
      'scripts/file-processing-contracts.test.cjs',
      'scripts/proxy-contracts.test.cjs',
      'scripts/shipment-status.test.cjs',
      'scripts/transaction-status.test.cjs',
      'scripts/receipt-candidates.test.cjs',
      'scripts/receipt-dialog.test.cjs',
    ]);
    if (!unit.ok) return result(false);
    const total = Number(unit.output.match(/^# tests (\d+)\s*$/m)?.[1]);
    const passed = Number(unit.output.match(/^# pass (\d+)\s*$/m)?.[1]);
    const skipped = Number(unit.output.match(/^# skipped (\d+)\s*$/m)?.[1]);
    const todo = Number(unit.output.match(/^# todo (\d+)\s*$/m)?.[1]);
    if (!(total >= 87 && passed === total && skipped === 0 && todo === 0)) {
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
    delete env.OMF_TEST_RECEIPTS_ONLY;
    env.OMF_TEST_PROXY_ONLY = '1';
    const proxy = stage('isolated unsupported provider integration', ['scripts/finance-integration.cjs']);
    const proxyChecks = Number(proxy.output.match(/^(\d+) targeted proxy checks passed\s*$/m)?.[1]);
    if (!proxy.ok || !(proxyChecks >= 6)) {
      logs.push('The isolated proxy suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_PROXY_ONLY;
    env.OMF_TEST_SHIPMENT_STATUS_ONLY = '1';
    const shipments = stage('isolated shipment status integration', ['scripts/finance-integration.cjs']);
    const shipmentChecks = Number(shipments.output.match(/^(\d+) targeted shipment status checks passed\s*$/m)?.[1]);
    if (!shipments.ok || !(shipmentChecks >= 8)) {
      logs.push('The isolated shipment status suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_SHIPMENT_STATUS_ONLY;
    env.OMF_TEST_TRANSACTION_STATUS_ONLY = '1';
    const transactionStatus = stage('isolated transaction status integration', ['scripts/finance-integration.cjs']);
    const transactionStatusChecks = Number(transactionStatus.output.match(/^(\d+) targeted transaction status checks passed\s*$/m)?.[1]);
    if (!transactionStatus.ok || !(transactionStatusChecks >= 7)) {
      logs.push('The isolated transaction status suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_TRANSACTION_STATUS_ONLY;
    env.OMF_TEST_RECEIPT_CANDIDATES_ONLY = '1';
    const candidates = stage('isolated receipt candidate integration', ['scripts/finance-integration.cjs']);
    const candidateChecks = Number(candidates.output.match(/^(\d+) targeted receipt candidate checks passed\s*$/m)?.[1]);
    if (!candidates.ok || !(candidateChecks >= 8)) {
      logs.push('The isolated receipt candidate suite must finish all its checks.');
      return result(false);
    }
    logs.push(`Verified ${passed} unit/service tests, ${checks} isolated workflow checks, ${authChecks} authentication checks, ${receiptChecks} receipt management checks, ${proxyChecks} proxy checks, ${shipmentChecks} shipment status checks, ${transactionStatusChecks} transaction status checks and ${candidateChecks} receipt candidate checks against freshly built source.`);
    return result(true);
  },
};

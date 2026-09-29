import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// The verifier owns the timeout and terminates the complete child process tree.
export const timeoutMs = 900000;

export default {
  name: 'finance-capture-workflow',
  covers: [
    'i18n/locales/ja.json',
    'i18n/locales/ko.json',
    'server/models/Payment.ts',
    'server/services/calendarPaymentService.ts',
    'server/api/payments/index.ts',
    'server/api/payments/[id].ts',
    'server/api/payments/[id]/complete.post.ts',
    'server/api/migrate-payment-dates.ts',
    'server/api/dashboard/stats.ts',
    'stores/calendar.ts',
    'pages/calendar/index.vue',
    'types/calendar.ts',
    'components/calendar/PaymentModal.vue',
    'components/calendar/CalendarGrid.vue',
    'components/calendar/DayDetailModal.vue',
    'components/calendar/UpcomingPayments.vue',
    'scripts/calendar-payment.test.cjs',
    'scripts/calendar-store.test.cjs',
    'scripts/calendar-integration.cjs',
    'scripts/helpers/calendar-store.cjs',
    'scripts/helpers/calendar-service.cjs',

    'utils/manualDraftStore.ts',
    'scripts/helpers/manual-draft-store.cjs',
    'scripts/manual-draft-recovery.test.cjs',
    'scripts/manual-draft-integration.cjs',
    'server/services/manualTransactionService.ts',
    'server/api/transactions/creation/[key].get.ts',
    'scripts/manual-transaction.test.cjs',
    'scripts/manual-transaction-integration.cjs',
    'scripts/helpers/manual-transaction-service.cjs',
    'server/api/analytics/index.ts',
    'server/api/backup/index.ts',
    'server/api/backup/restore.ts',
    'server/api/backup/schedule.ts',
    'server/api/budgets/index.ts',
    'server/api/dashboard/stats.ts',
    'server/api/reports/index.ts',
    'server/api/reports/tax.ts',
    'server/api/search.ts',
    'server/api/tags/index.ts',
    'server/api/validate/transactions.ts',
    'server/api/vendors/[id].ts',
    'server/api/vendors/index.ts',
    'scripts/transaction-lifecycle-integration.cjs',
    'scripts/transaction-lifecycle.test.cjs',
    'server/services/transactionArchiveService.ts',
    'composables/useTransactions.ts',
    'pages/transactions/index.vue',
    'scripts/helpers/transaction-workspace.cjs',
    'scripts/transaction-workspace.test.cjs',
    'scripts/transaction-workspace-integration.cjs',
    'server/api/attachments/upload.ts',
    'server/api/attachments/[id].ts',
    'components/transaction/TransactionForm.vue',
    'components/transaction/TransactionFormModal.vue',
    'scripts/transaction-attachments.test.cjs',
    'scripts/helpers/transaction-form.cjs',
    'scripts/transaction-attachments-integration.cjs',
    'composables/useReceipts.ts',
    'pages/receipts/index.vue',
    'components/receipt/ReceiptUpload.vue',
    'components/receipt/ReceiptMatcher.vue',
    'scripts/helpers/receipt-workspace.cjs',
    'scripts/receipt-workspace.test.cjs',
    'scripts/receipt-workspace-integration.cjs',
    'components/receipt/ReceiptTable.vue',
    'server/services/receiptFileService.ts',
    'server/api/receipts/[id]/file.ts',
    'scripts/receipt-files.test.cjs',
    'scripts/receipt-files-integration.cjs',
    'scripts/helpers/receipt-upload-page.cjs',
    'composables/useReceiptFiles.ts',
    'pages/transactions/[id].vue',
    'server/services/receiptLinkService.ts',
    'scripts/receipt-links.test.cjs',
    'scripts/receipt-links-integration.cjs',
    'server/api/transactions/[id]/receipt.ts',
    'pages/receipts/upload.vue',
    'components/shipment/ShipmentStatusBadge.vue',
    'pages/shipments.vue',
    'pages/shipment/[id].vue',
    'scripts/helpers/shipment-page.cjs',
    'scripts/shipment-pages.test.cjs',
    'scripts/shipment-pages-integration.cjs',
    'i18n/locales/ja.json',
    'i18n/locales/ko.json',
    'research-worker/sheet-export.mjs',
    'research-worker/sheets.mjs',
    'research-worker/search-evidence.mjs',
    'finalization-worker/worker.mjs',
    'shared/finance-workflow.mjs',
    'shared/finance-workflow-matching.mjs',
    'server/models/Finance.ts',
    'server/api/finance/[...path].ts',
    'scripts/card-groups.test.cjs',
    'scripts/card-groups-integration.cjs',
    'server/models/RecurringPayment.ts',
    'server/services/recurringPaymentService.ts',
    'server/api/recurring/index.ts',
    'server/api/recurring/[id].ts',
    'server/api/recurring/process.ts',
    'pages/recurring/index.vue',
    'scripts/recurring-groups.test.cjs',
    'scripts/recurring-groups-integration.cjs',
    'scripts/helpers/recurring-page.cjs',
    'scripts/finance-pending-integration.cjs',
    'scripts/finance-import-overlap-integration.cjs',
    'scripts/finance-aplus-integration.cjs',
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
    'server/api/shipments/index.ts',
    'server/api/shipments/[id].ts',
    'server/api/shipments/[id]/transactions.ts',
    'server/api/shipments/[id]/tracking.ts',
    'scripts/shipment-groups.test.cjs',
    'scripts/shipment-groups-integration.cjs',
    'scripts/helpers/shipment-store.cjs',
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
    'stores/user.ts',
    'pages/settings/organization.vue',
    'server/api/auth/switch-organization.ts',
    'scripts/auth-regression.test.cjs',
    'scripts/helpers/auth-session.cjs',
    'scripts/helpers/organization-page.cjs',
    'scripts/group-switch.test.cjs',
    'scripts/organization-page.test.cjs',
    'scripts/group-switch-integration.cjs',
    'server/services/transactionService.ts',
    'server/api/transactions/index.ts',
    'server/api/transactions/[id].ts',
    'server/api/transactions/stats.ts',
    'server/api/transactions/export.ts',
    'server/api/transactions/bulk.ts',
    'server/api/transactions/duplicates.ts',
    'server/api/transactions/import.ts',
    'server/api/transactions/import-preview.ts',
    'server/api/import/bank-statement.ts',
    'scripts/transaction-groups-integration.cjs',
    'server/services/ledgerAccessService.ts',
    'server/api/receipts/[id]/pdf.ts',
    'scripts/helpers/group-session.cjs',
    'scripts/receipt-groups.test.cjs',
    'scripts/transaction-groups.test.cjs',
    'scripts/receipt-groups-integration.cjs',
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
    'scripts/finance-workflow-investigation-integration.cjs',
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
      'scripts/auth-regression.test.cjs',
      'scripts/group-switch.test.cjs',
      'scripts/organization-page.test.cjs',
      'scripts/receipt-files.test.cjs',
      'scripts/receipt-workspace.test.cjs',
      'scripts/receipt-links.test.cjs',
      'scripts/receipt-groups.test.cjs',
      'scripts/transaction-groups.test.cjs',
      'scripts/transaction-attachments.test.cjs',
      'scripts/transaction-workspace.test.cjs',
      'scripts/transaction-lifecycle.test.cjs',
      'scripts/manual-transaction.test.cjs',
      'scripts/manual-draft-recovery.test.cjs',
      'scripts/card-groups.test.cjs',
      'scripts/recurring-groups.test.cjs',
      'scripts/calendar-payment.test.cjs',
      'scripts/calendar-store.test.cjs',
      'scripts/shipment-groups.test.cjs',
      'scripts/shipment-pages.test.cjs',
    ]);
    if (!unit.ok) return result(false);
    const total = Number(unit.output.match(/^# tests (\d+)\s*$/m)?.[1]);
    const passed = Number(unit.output.match(/^# pass (\d+)\s*$/m)?.[1]);
    const skipped = Number(unit.output.match(/^# skipped (\d+)\s*$/m)?.[1]);
    const todo = Number(unit.output.match(/^# todo (\d+)\s*$/m)?.[1]);
    if (!(total >= 321 && passed === total && skipped === 0 && todo === 0)) {
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
    delete env.OMF_TEST_RECEIPT_CANDIDATES_ONLY;
    env.OMF_TEST_GROUP_SWITCH_ONLY = '1';
    const groups = stage('isolated group session switch integration', ['scripts/finance-integration.cjs']);
    const groupChecks = Number(groups.output.match(/^(\d+) targeted group switch checks passed\s*$/m)?.[1]);
    if (!groups.ok || !(groupChecks >= 10)) {
      logs.push('The isolated group switch suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_GROUP_SWITCH_ONLY;
    env.OMF_TEST_RECEIPT_GROUPS_ONLY = '1';
    const receiptGroups = stage('isolated receipt group integration', ['scripts/finance-integration.cjs']);
    const receiptGroupChecks = Number(receiptGroups.output.match(/^(\d+) targeted receipt group checks passed\s*$/m)?.[1]);
    if (!receiptGroups.ok || !(receiptGroupChecks >= 11)) {
      logs.push('The isolated receipt group suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_RECEIPT_GROUPS_ONLY;
    env.OMF_TEST_TRANSACTION_GROUPS_ONLY = '1';
    const transactionGroups = stage('isolated transaction group integration', ['scripts/finance-integration.cjs']);
    const transactionGroupChecks = Number(transactionGroups.output.match(/^(\d+) targeted transaction group checks passed\s*$/m)?.[1]);
    if (!transactionGroups.ok || !(transactionGroupChecks >= 16)) {
      logs.push('The isolated transaction group suite must finish all its checks.');
      return result(false);
    }
    delete env.OMF_TEST_TRANSACTION_GROUPS_ONLY;
    for (const [flag, label, minimum] of [
      ['OMF_TEST_CALENDAR_ONLY', 'calendar', 10],
      ['OMF_TEST_DRAFT_RECOVERY_ONLY', 'draft recovery', 9],
      ['OMF_TEST_MANUAL_TRANSACTION_ONLY', 'manual transaction', 10],
      ['OMF_TEST_TRANSACTION_LIFECYCLE_ONLY', 'transaction lifecycle', 8],
      ['OMF_TEST_TRANSACTION_WORKSPACE_ONLY', 'transaction workspace', 7],
      ['OMF_TEST_RECEIPT_WORKSPACE_ONLY', 'receipt workspace', 7],
      ['OMF_TEST_RECEIPT_FILES_ONLY', 'receipt file', 9],
      ['OMF_TEST_RECEIPT_LINKS_ONLY', 'receipt link', 9],
      ['OMF_TEST_SHIPMENT_GROUPS_ONLY', 'shipment group', 9],
      ['OMF_TEST_RECURRING_GROUPS_ONLY', 'recurring group', 8],
      ['OMF_TEST_CARD_GROUPS_ONLY', 'card group', 8],
      ['OMF_TEST_PENDING_ONLY', 'pending', 8],
      ['OMF_TEST_IMPORT_OVERLAP_ONLY', 'source overlap', 7],
      ['OMF_TEST_APLUS_ONLY', 'Aplus', 5],
    ]) {
      env[flag] = '1';
      const source = stage('isolated ' + label + ' integration', ['scripts/finance-integration.cjs']);
      const count = Number(source.output.match(new RegExp('^(\\d+) targeted ' + label + ' checks passed\\s*$', 'm'))?.[1]);
      delete env[flag];
      if (!source.ok || !(count >= minimum)) {
        logs.push('The isolated ' + label + ' suite must finish all its checks.');
        return result(false);
      }
    }
    logs.push('Also verified card company propagation, pending-to-final continuity, source overlap and Aplus imports.');
    logs.push(`Verified ${passed} unit/service tests, ${checks} isolated workflow checks, ${authChecks} authentication checks, ${receiptChecks} receipt management checks, ${proxyChecks} proxy checks, ${shipmentChecks} shipment status checks, ${transactionStatusChecks} transaction status checks, ${candidateChecks} receipt candidate checks, ${groupChecks} group switch checks ${receiptGroupChecks} receipt group checks and ${transactionGroupChecks} transaction group checks against freshly built source.`);
    return result(true);
  },
};

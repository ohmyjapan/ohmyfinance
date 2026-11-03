// Fixture for plan omf-security-fixes-20261102 (5-plan.json §4): the Astra 2026-11-02 audit fixes end to end — attachment ownership
// (S2/S3), honest counts and company filters (S4-S13), admin-only DNS-bound webhooks (S14), shared masters writable by nobody
// in-app with the operator CLI (S15/S19/S20), session renewal bound to the password generation (S16, shared guard), request-lifetime
// upload storage behind a login (S17), the tracked workbooks gone (S18).
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture scripts/zoomer-fixtures/omf-security-fixes.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-security-fixes-integration.cjs: its own disposable MongoDB, an owned temp directory as the
// server's cwd with an xlsx re-export shim, an owned loopback listener, installed Chrome headless for L9 when present; NOT RUN and
// red when .output/server/index.mjs is missing) · 2 an unchanged packaged copy (.output plus the source tree the tsx/client/CLI
// legs execute: server/, shared/, utils/, stores/, composables/, the five scripts) must pass · 3 the 87 named defects of plan §4
// (m1-m7, m9-m83; m8 is the recorded redundant-write exclusion): compiled server chunks, the copied source files the tsx/client/CLI
// legs run (m15, m48, m55, m56, m66, m67), and the copied client chunks (m81-m83, only when Chrome runs L9) — each must make the
// integration fail with the `security:` assertion named. No model, provider, network send or ambient database: every database
// address is a closed sentinel and the integration owns its in-memory MongoDB. `covers` is decided at load: built-app files are
// listed only when the build exists. Fail-first on 394c8e4: leg 1 is the behavioural failure (B's file served, a member creates a
// shared account, anonymous upload 200, ...); legs 2-3 are NOT RUN until leg 1 is green.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 7200000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const SCRIPT_COVERS = ['scripts/finance-security-fixes-integration.cjs', 'scripts/finance-security-fixes-browser.cjs', 'scripts/finance-webhook-transport-check.ts', 'scripts/manage-masters.ts', 'scripts/auth-regression.test.cjs', 'scripts/zoomer-fixtures/omf-security-fixes.mjs'];
const APP_COVERS = ['server/api/invites/accept.ts', 'server/api/attachments/[id].ts', 'server/api/attachments/upload.ts', 'server/api/validate/transactions.ts', 'server/api/search.ts', 'server/api/transactions/bulk.ts', 'server/api/transactions/duplicates.ts', 'server/api/receipts/[id]/pdf.ts', 'server/api/shipments/index.ts', 'server/services/shipmentService.ts', 'server/api/notifications/index.ts', 'server/api/tags/index.ts', 'server/api/email/send-reminders.ts', 'server/api/backup/schedule.ts', 'server/api/vendors/[id].ts', 'server/api/webhooks/index.ts', 'server/api/webhooks/[id].ts', 'server/services/webhookService.ts', 'server/api/account-categories/[id].ts', 'server/api/account-categories/index.ts', 'server/api/categories/index.ts', 'server/api/categories/[id].ts', 'server/api/tax-categories/index.ts', 'server/api/transaction-categories/index.ts', 'server/api/templates/index.ts', 'server/api/templates/[id].ts', 'server/api/seed/index.ts', 'server/services/financeDraftService.ts', 'pages/mapping.vue', 'components/transaction/TransactionFormModal.vue', 'pages/templates/index.vue', 'server/models/User.ts', 'server/services/authService.ts', 'server/api/auth/switch-organization.ts', 'server/api/auth/accept-invite.ts', 'server/api/auth/logout.ts', 'server/api/users/me/password.ts', 'pages/profile/index.vue', 'stores/user.ts', 'server/api/upload.js', 'server/api/excel-processor.js', 'server/api/process-file.js', 'components/transaction/TransactionFileUpload.vue', 'components/FileUpload.vue', 'components/GenericFileUploader.vue', 'server/data/download/1770032861377-activity__1_.xlsx', 'server/data/download/1770033356071-activity__1_.xlsx', 'server/data/download/1770045994760-test-upload.csv', 'server/data/processed/1770045994760-test-upload.json', '.gitignore', 'server/utils/companyRoleAccess.ts', 'server/utils/sharedMasterAccess.ts', 'server/utils/masterMaintenance.ts', 'server/utils/uploadRetention.ts', 'server/models/RevokedToken.ts'];
const require = createRequire(import.meta.url);
const resolveFrom = (id) => { try { return require.resolve(id) } catch { return null } };
const binary = path.resolve(root, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.1.exe');
const tsx = resolveFrom('tsx/cli');
const puppeteerBase = [path.join(root, 'collector', 'package.json'), path.resolve(root, '..', 'collector', 'package.json')].find(p => { try { createRequire(p).resolve('rebrowser-puppeteer-core'); return true } catch { return false } }) || '';
const chrome = [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(existsSync);
const BROWSER = !!chrome;
const API_LEGS = ['L1', 'L2', 'L3', 'L4', 'L4b', 'L5', 'L5b', 'L5c', 'L6', 'L6client', 'L7'];

// Each defect (plan §4 m1-m83 minus m8): where it is reintroduced — `compiled` (server chunks under .output/server/chunks, narrowed by
// `within`, a literal unique to the route's chunk), `source` (a copied source file the tsx/client/CLI legs execute), `client` (a copied
// client chunk under .output/public/_nuxt, run only with Chrome) — its anchor (matched at least once; `occurrence` picks one match),
// its replacement, the legs the integration runs for it and the `security:` assertion that must then fail.
const G = (pattern) => new RegExp(pattern.source, 'g');
export const DEFECTS = [
  { name: 'm1-invite-regex', kind: 'compiled', within: /Invite token is required|Invalid invite token/, anchor: G(/!\/\^\[0-9a-f\]\{64\}\$\/\.test\(token\)/), replacement: 'false', legs: 'L1', expect: /security:L1-token-shape-400/ },
  { name: 'm2-attachment-prefix', kind: 'compiled', within: /Invalid attachment name/, anchor: G(/filename\.slice\(0, 24\) !== String\(organizationId\)/), replacement: 'false', legs: 'L2', expect: /security:L2-foreign-404/ },
  { name: 'm3-attachment-grammar', kind: 'compiled', within: /Invalid attachment name/, anchor: G(/!ATTACHMENT_NAME\.test\(filename\)/), replacement: 'false', legs: 'L2', expect: /security:L2-grammar-400/ },
  { name: 'm4-upload-entity-after-write', kind: 'compiled', within: /No file uploaded/, anchor: G(/if \(!exists\) throw createError\(\{ statusCode: 404, statusMessage: "Entity not found" \}\);/), replacement: '', legs: 'L2', expect: /security:L2-upload-foreign-404/ },
  { name: 'm5-bulk-delete-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/Transaction\.deleteMany\(\{ _id: \{ \$in: ids \}, organizationId \}\)/), replacement: 'Transaction.deleteMany({ _id: { $in: ids } })', legs: 'L3', expect: /security:L3-bulk-delete/ },
  { name: 'm6-add-note-counts-unmatched', kind: 'compiled', within: /Unknown action/, anchor: G(/if \(r\.matchedCount\) results\.succeeded\+\+;\s*else results\.failed\+\+;/), replacement: 'results.succeeded++;', legs: 'L3', expect: /security:L3-bulk-add_note-succeeded/ },
  { name: 'm7-dup-delete-unscoped', kind: 'compiled', within: /keepId and deleteIds required/, anchor: G(/const removed = await Transaction\.deleteMany\(\{ _id: \{ \$in: deleteIds \}, organizationId \}\)/), replacement: 'const removed = await Transaction.deleteMany({ _id: { $in: deleteIds } })', legs: 'L3', expect: /security:L3-dup-delete/ },
  { name: 'm9-shipment-presave-check', kind: 'compiled', within: /Choose existing company transactions/, anchor: G(/if \(owned !== linked\.length\)/), replacement: 'if (false)', legs: 'L3', expect: /security:L3-shipment-foreign-400/ },
  { name: 'm10-backup-finds-unscoped', kind: 'compiled', within: /Backup created/, anchor: G(/\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: '.find({}).lean()', legs: 'L3', expect: /security:L3-backup-scope/ },
  { name: 'm11-backup-old-parser', kind: 'compiled', within: /Backup created/, anchor: G(/\/\^backup-\[0-9a-f\]\{24\}-\(\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}-\\d\{2\}-\\d\{2\}\)\//), replacement: '/backup-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})/', legs: 'L3', expect: /security:L3-backup-createdAt/ },
  { name: 'm12-vendor-whitelist', kind: 'compiled', within: /Vendor ID required/, anchor: G(/\{ \$set: values \}/), replacement: 'body', legs: 'L3', expect: /security:L3-vendor-whitelist/ },
  { name: 'm13-reminders-unscoped', kind: 'compiled', within: /processed: results\.length/, anchor: G(/RecurringPayment\.find\(\{\s*organizationId,\s*isActive: true/), replacement: 'RecurringPayment.find({\n    isActive: true', legs: 'L3', expect: /security:L3-reminders-scope/ },
  { name: 'm14-deliverable-returns-early', kind: 'compiled', within: /Webhook destination is not public/, anchor: G(/const url = parseWebhookUrl(\$\d+)?\(value\);/), replacement: 'const url = parseWebhookUrl(value); return { url, address: url.hostname.replace(/^\\[|\\]$/g, ""), family: 4 };', legs: 'L4', expect: /security:L4-refused-(listener-nothing|destination)/ },
  { name: 'm15-lookup-pin-removed', kind: 'source', file: 'server/services/webhookService.ts', anchor: G(/lookup: pinnedLookup\(target\)/), replacement: 'lookup: undefined', legs: 'L4b', expect: /security:L4b-pinned/ },
  { name: 'm16-put-returns-secret', kind: 'compiled', within: /Webhook ID required/, anchor: G(/webhook: publicWebhook\(webhook\), message: "Webhook updated"/), replacement: 'webhook: { ...webhook, id: webhook._id }, message: "Webhook updated"', legs: 'L4', expect: /security:L4-put-(masked|no-headers|no-secret-bytes)/ },
  { name: 'm17-account-categories-put-gate', kind: 'compiled', within: /Account category ID is required/, anchor: G(/(if \(method === "PUT"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-account-categories-put/ },
  { name: 'm18-templates-delete-gate', kind: 'compiled', within: /Template ID required/, anchor: G(/(if \(method === "DELETE"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-templates-delete/ },
  { name: 'm19-refresh-sv-compare', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/if \(staleSession(\$\d+)?\(payload, user\)\) \{\s*return null;\s*\}/), replacement: '', legs: 'L6', expect: /security:L6-stale-refresh-401/ },
  { name: 'm20-revoked-token-check', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/if \(await RevokedToken(\$\d+)?\.exists\(\{ jti: payload\.jti \}\)\) \{\s*return null;\s*\}/), replacement: '', legs: 'L6', expect: /security:L6-logout-(refresh-401|survives-restart)/ },
  { name: 'm21-switch-ignores-sv', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/if \(staleSession(\$\d+)?\(presented, user\)\) \{\s*throw Object\.assign\(new Error\("Session expired"\), \{ statusCode: 401 \}\);\s*\}/), replacement: '', legs: 'L6', expect: /security:L6-stale-switch-401/ },
  { name: 'm22-excel-requireAuth', kind: 'compiled', within: /\[excel-processor\]/, anchor: G(/requireAuth(\$\d+)?\(event\);/), replacement: '', legs: 'L7', expect: /security:L7-excel-anon-401/ },
  { name: 'm23-excel-sweep-removed', kind: 'compiled', within: /\[excel-processor\]/, anchor: G(/await sweepOlderThan(\$\d+)?\(downloadDir\);\s*await sweepOlderThan(\$\d+)?\(processedDir\);/), replacement: '', legs: 'L7', expect: /security:L7-sweep-excel/ },
  { name: 'm24-search-transactions-unscoped', kind: 'compiled', within: /Search failed/, anchor: G(/Transaction\.find\(\{\s*organizationId,/), replacement: 'Transaction.find({', legs: 'L3', expect: /security:L3-search-transactions-scope/ },
  { name: 'm25-validate-unscoped', kind: 'compiled', within: /Missing reference number/, anchor: G(/Transaction\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: 'Transaction.find({}).lean()', legs: 'L3', expect: /security:L3-validate-scope/ },
  { name: 'm26-pdf-unscoped', kind: 'compiled', within: /receipt_\$\{id\}\.html/, anchor: G(/Transaction\.findOne\(\{ _id: id, organizationId \}\)\.lean\(\)/), replacement: 'Transaction.findById(id).lean()', legs: 'L3', expect: /security:L3-pdf-scope/ },
  { name: 'm27-notifications-upcoming-unscoped', kind: 'compiled', within: /Failed to fetch notifications/, anchor: G(/organizationId,(\s*status: "active",\s*nextDueDate: \{ \$gte: now)/), replacement: '$1', legs: 'L3', expect: /security:L3-notifications-upcoming-scope/ },
  { name: 'm28-notifications-overdue-unscoped', kind: 'compiled', within: /Failed to fetch notifications/, anchor: G(/organizationId,(\s*status: "active",\s*nextDueDate: \{ \$lt: now)/), replacement: '$1', legs: 'L3', expect: /security:L3-notifications-overdue-scope/ },
  { name: 'm29-notifications-receipts-unscoped', kind: 'compiled', within: /Failed to fetch notifications/, anchor: G(/Receipt\.countDocuments\(\{\s*organizationId,/), replacement: 'Receipt.countDocuments({', legs: 'L3', expect: /security:L3-notifications-receipts-scope/ },
  { name: 'm30-tags-match-removed', kind: 'compiled', within: /\$unwind: "\$tags"/, anchor: G(/\{ \$match: \{ organizationId \} \},/), replacement: '', legs: 'L3', expect: /security:L3-tags-scope/ },
  { name: 'm31-search-receipts-unscoped', kind: 'compiled', within: /Search failed/, anchor: G(/Receipt\.find\(\{\s*organizationId,/), replacement: 'Receipt.find({', legs: 'L3', expect: /security:L3-search-receipts-scope/ },
  { name: 'm32-search-recurring-unscoped', kind: 'compiled', within: /Search failed/, anchor: G(/RecurringPayment\.find\(\{\s*organizationId,/), replacement: 'RecurringPayment.find({', legs: 'L3', expect: /security:L3-search-recurring-scope/ },
  { name: 'm33-backup-list-prefix', kind: 'compiled', within: /Backup created/, anchor: G(/f\.startsWith\(prefix\) && f\.endsWith\("\.json"\)/), occurrence: 1, replacement: 'f.startsWith("backup-") && f.endsWith(".json")', legs: 'L3', expect: /security:L3-backup-list-scope/ },
  { name: 'm34-backup-cleanup-prefix', kind: 'compiled', within: /Backup created/, anchor: G(/f\.startsWith\(prefix\) && f\.endsWith\("\.json"\)/), occurrence: 0, replacement: 'f.startsWith("backup-") && f.endsWith(".json")', legs: 'L3', expect: /security:L3-backup-cleanup-(scope|max)/ },
  { name: 'm35-webhooks-index-admin', kind: 'compiled', within: /Name and URL required/, anchor: G(/await requireCompanyAdmin(\$\d+)?\(auth\.userId, organizationId\);/), replacement: '', legs: 'L4', expect: /security:L4-admin-only-/ },
  { name: 'm36-webhooks-detail-scope', kind: 'compiled', within: /Webhook ID required/, anchor: G(/Webhook\.findOne\(\{ _id: id, organizationId \}\)\.lean\(\)/), replacement: 'Webhook.findById(id).lean()', legs: 'L4', expect: /security:L4-foreign-get-404/ },
  { name: 'm37-categories-post-gate', kind: 'compiled', within: /Category already exists/, anchor: G(/(if \(method === "POST"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-categories-post/ },
  { name: 'm38-tax-categories-post-gate', kind: 'compiled', within: /Tax category name is required/, anchor: G(/(if \(method === "POST"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-tax-categories-post/ },
  { name: 'm39-transaction-categories-post-gate', kind: 'compiled', within: /Transaction category name is required/, anchor: G(/(if \(method === "POST"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-transaction-categories-post/ },
  { name: 'm40-seed-gate', kind: 'compiled', within: /defineEventHandler\(\(event\) => \{\s*rejectSharedMasterWrite(\$\d+)?\(event\);\s*\}\)/, anchor: G(/rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: 'return { success: true, message: "mutant" };', legs: 'L5', expect: /security:L5-seed/ },
  { name: 'm41-account-categories-post-gate', kind: 'compiled', within: /topLevel === "true"/, anchor: G(/(if \(method === "POST"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-account-categories-post/ },
  { name: 'm42-draft-reference-refusal', kind: 'compiled', within: /prepareSourceCategories/, anchor: G(/if \(!existing && !scoped\) throw sharedMasterReadOnlyError(\$\d+)?\(\);/), replacement: '', legs: 'L5b', expect: /security:L5b-reference-/ },
  { name: 'm43-source-category-refusal', kind: 'compiled', within: /prepareSourceCategories/, anchor: G(/if \(!matches\.length\) throw sharedMasterReadOnlyError(\$\d+)?\(\);/), replacement: '', legs: 'L5b', expect: /security:L5b-source-missing/ },
  { name: 'm44-2fa-sv-check', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/if \(staleSession(\$\d+)?\(payload, user\)\) \{\s*throw Object\.assign\(new Error\("Invalid or expired 2FA token"\), \{ statusCode: 401 \}\);\s*\}/), replacement: '', legs: 'L6', expect: /security:L6-stale-2fa-pending-refused/ },
  { name: 'm45-accept-invite-sv-check', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/ \|\| \(authenticatedSv \?\? 0\) !== \(user\.sessionVersion \?\? 0\)/), replacement: '', legs: 'L6', expect: /security:L6-stale-accept-invite-401/ },
  { name: 'm46-stale-bearer-requires-login', kind: 'compiled', within: /Invite token is required|Invalid invite token/, anchor: G(/if \(currentUser && \(payload\.sv \?\? 0\) !== \(currentUser\.sessionVersion \?\? 0\)\) currentUser = null;/), replacement: '', legs: 'L1', expect: /security:L1-stale-bearer-requires-login/ },
  { name: 'm47-revoke-signature-check', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/const revoked = verifyToken\(token\);/), replacement: 'const revoked = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8") || "null");', legs: 'L6', expect: /security:L6-unsigned-not-(persisted|revoked)/ },
  { name: 'm48-adoptTokens-epoch', kind: 'source', file: 'stores/user.ts', anchor: G(/rt\.epoch\+\+(\s*rt\.refresh = null\s*if \(rt\.timer\))/), replacement: '$1', legs: 'L6client', expect: /security:L6client-adoptTokens/ },
  { name: 'm49-upload-requireAuth', kind: 'compiled', within: /No files uploaded/, anchor: G(/requireAuth(\$\d+)?\(event\);/), replacement: '', legs: 'L7', expect: /security:L7-upload-anon-401/ },
  { name: 'm50-upload-cap', kind: 'compiled', within: /No files uploaded/, anchor: G(/if \(file\.data && file\.data\.length > MAX_FILE_SIZE(\$\d+)?\)/), replacement: 'if (false)', legs: 'L7', expect: /security:L7-upload-413/ },
  { name: 'm51-excel-finally-cleanup', kind: 'compiled', within: /\[excel-processor\]/, anchor: G(/for \(const target of \[filePath, processedFilePath\]\) if \(target\) await [\w$.]+\.unlink\(target\)\.catch\(\(\) => \{\s*\}\);/), replacement: '', legs: 'L7', expect: /security:L7-excel-(input|output)-gone/ },
  { name: 'm52-upload-finally-cleanup', kind: 'compiled', within: /No files uploaded/, anchor: G(/for \(const target of \[filePath, processedFilePath\]\) if \(target\) await [\w$.]+\.unlink\(target\)\.catch\(\(\) => \{\s*\}\);/), replacement: '', legs: 'L7', expect: /security:L7-upload-(input|output)-gone/ },
  { name: 'm53-add-note-failed-count', kind: 'compiled', within: /Unknown action/, anchor: G(/if \(r\.matchedCount\) results\.succeeded\+\+;\s*else results\.failed\+\+;/), replacement: 'if (r.matchedCount) results.succeeded++;', legs: 'L3', expect: /security:L3-bulk-add_note-failed/ },
  { name: 'm54-dup-delete-counts-from-input', kind: 'compiled', within: /keepId and deleteIds required/, anchor: G(/message: `Deleted \$\{removed\.deletedCount\} duplicate transactions`,\s*deleted: removed\.deletedCount/), replacement: 'message: `Deleted ${deleteIds.length} duplicate transactions`,\n        deleted: deleteIds.length', legs: 'L3', expect: /security:L3-dup-delete-(count|message)/ },
  { name: 'm55-deliverTo-success-forced', kind: 'source', file: 'server/services/webhookService.ts', anchor: G(/success: response\.ok, status: response\.status/), replacement: 'success: true, status: response.status', legs: 'L4b', expect: /security:L4b-deliverTo-500-fails/ },
  { name: 'm56-updateMaster-whitelist', kind: 'source', file: 'server/utils/masterMaintenance.ts', anchor: G(/const changes = masterValues\(kind, input\)/), replacement: 'const changes = input', legs: 'L5c', expect: /security:L5c-set-/ },
  { name: 'm57-attachment-delete-unscoped', kind: 'compiled', within: /Invalid attachment name/, anchor: G(/\{ organizationId, "attachments\.filename": filename \}/), replacement: '{ "attachments.filename": filename }', legs: 'L2', expect: /security:L2-delete-keeps-foreign-reference/ },
  { name: 'm58-merge-find-unscoped', kind: 'compiled', within: /keepId and deleteIds required/, anchor: G(/Transaction\.find\(\{ _id: \{ \$in: deleteIds \}, organizationId \}\)/), replacement: 'Transaction.find({ _id: { $in: deleteIds } })', legs: 'L3', expect: /security:L3-merge-(metadata|notes|message)/ },
  { name: 'm59-merge-delete-unscoped', kind: 'compiled', within: /keepId and deleteIds required/, anchor: G(/const merged = await Transaction\.deleteMany\(\{ _id: \{ \$in: deleteIds \}, organizationId \}\)/), replacement: 'const merged = await Transaction.deleteMany({ _id: { $in: deleteIds } })', legs: 'L3', expect: /security:L3-merge-(foreign-intact|deleted)/ },
  { name: 'm60-shipments-populate-match', kind: 'compiled', within: /Choose existing company transactions/, anchor: G(/\.populate\(\{ path: "transactionIds", match: \{ organizationId \} \}\)/), replacement: '.populate("transactionIds")', legs: 'L3', expect: /security:L3-shipments-populate-scope/ },
  { name: 'm61-login-mint-without-sv', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/,\s*sv: sessionVersion\b/), replacement: '', legs: 'L6', expect: /security:L6-login-(mint-sv|after-change-refreshes)/ },
  { name: 'm62-2fa-mint-without-sv', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/,\s*sv: verifiedSessionVersion\b/), replacement: '', legs: 'L6', expect: /security:L6-2fa-(mint-sv|after-change-refreshes)/ },
  { name: 'm63-accept-invite-mint-without-sv', kind: 'compiled', within: /Configure JWT_SECRET before starting OhMyFinance/, anchor: G(/,\s*sv: invitedSessionVersion\b/), replacement: '', legs: 'L6', expect: /security:L6-accept-invite-(mint-sv|refreshes)/ },
  { name: 'm64-invites-accept-mint-without-sv', kind: 'compiled', within: /Invite token is required|Invalid invite token/, anchor: G(/,\s*sv: user\.sessionVersion \?\? 0/), replacement: '', legs: 'L1,L6', expect: /security:(L1-new-user-mint-sv|L6-invites-accept-(mint-sv|refreshes))/ },
  { name: 'm65-password-mints-before-increment', kind: 'compiled', within: /Password changed successfully/, anchor: G(/sv: user\.sessionVersion(\s*\})/), replacement: 'sv: user.sessionVersion - 1$1', legs: 'L6', expect: /security:L6-(change-mint-sv|fresh-refresh)/ },
  { name: 'm66-dry-run-create-writes', kind: 'source', file: 'server/utils/masterMaintenance.ts', anchor: G(/if \(!options\.apply\) return \{ dryRun: true, kind, values: created \}/), replacement: '', legs: 'L5c', expect: /security:L5c-dry-create/ },
  { name: 'm67-updateMaster-replaces-document', kind: 'source', file: 'server/utils/masterMaintenance.ts', anchor: G(/await model\.updateOne\(\{ _id \}, \{ \$set: changes \}\)/), replacement: 'await model.replaceOne({ _id }, changes)', legs: 'L5c', expect: /security:L5c-set-(whitelist|keeps-registrations|keeps-parent)/ },
  { name: 'm68-bulk-update-status-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/\{ _id: \{ \$in: ids \}, organizationId \}(,\s*\{\s*\$set: \{ status: data\.status \})/), replacement: '{ _id: { $in: ids } }$1', legs: 'L3', expect: /security:L3-bulk-update_status/ },
  { name: 'm69-bulk-add-tag-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/\{ _id: \{ \$in: ids \}, organizationId \}(,\s*\{ \$addToSet: \{ tags: data\.tag \} \})/), replacement: '{ _id: { $in: ids } }$1', legs: 'L3', expect: /security:L3-bulk-add_tag/ },
  { name: 'm70-bulk-remove-tag-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/\{ _id: \{ \$in: ids \}, organizationId \}(,\s*\{ \$pull: \{ tags: data\.tag \} \})/), replacement: '{ _id: { $in: ids } }$1', legs: 'L3', expect: /security:L3-bulk-remove_tag/ },
  { name: 'm71-bulk-update-source-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/\{ _id: \{ \$in: ids \}, organizationId \}(,\s*\{ \$set: \{ source: data\.source \} \})/), replacement: '{ _id: { $in: ids } }$1', legs: 'L3', expect: /security:L3-bulk-update_source/ },
  { name: 'm72-bulk-export-unscoped', kind: 'compiled', within: /Unknown action/, anchor: G(/Transaction\.find\(\{ _id: \{ \$in: ids \}, organizationId \}\)\.lean\(\)/), replacement: 'Transaction.find({ _id: { $in: ids } }).lean()', legs: 'L3', expect: /security:L3-bulk-export-scope/ },
  { name: 'm73-shipments-query-unscoped', kind: 'compiled', within: /Choose existing company transactions/, anchor: G(/const query = \{ organizationId \};/), replacement: 'const query = {};', legs: 'L3', expect: /security:L3-shipments-list-scope/ },
  { name: 'm74-shipment-stats-match-removed', kind: 'compiled', within: /Choose existing company transactions/, anchor: G(/\{ \$match: \{ organizationId \} \},/), replacement: '', legs: 'L3', expect: /security:L3-shipment-stats-/ },
  { name: 'm75-templates-post-gate', kind: 'compiled', within: /Name and mappings are required/, anchor: G(/(if \(method === "POST"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-templates-post/ },
  { name: 'm76-templates-put-gate', kind: 'compiled', within: /Template ID required/, anchor: G(/(if \(method === "PUT" \|\| method === "PATCH"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-templates-(put|patch)/ },
  { name: 'm77-categories-put-gate', kind: 'compiled', within: /Category ID required/, anchor: G(/(if \(method === "PUT" \|\| method === "PATCH"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-categories-(put|patch)/ },
  { name: 'm78-categories-delete-gate', kind: 'compiled', within: /Category ID required/, anchor: G(/(if \(method === "DELETE"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-categories-delete/ },
  { name: 'm79-account-categories-delete-gate', kind: 'compiled', within: /Account category ID is required/, anchor: G(/(if \(method === "DELETE"\) \{\s*)rejectSharedMasterWrite(\$\d+)?\(event\);/), replacement: '$1', legs: 'L5', expect: /security:L5-account-categories-delete/ },
  { name: 'm80-webhooks-detail-admin', kind: 'compiled', within: /Webhook ID required/, anchor: G(/await requireCompanyAdmin(\$\d+)?\(auth\.userId, organizationId\);/), replacement: '', legs: 'L4', expect: /security:L4-detail-admin-only/ },
  { name: 'm81-transaction-upload-header', kind: 'client', within: /transactionImport\.processFailed/, anchor: G(/headers\s*:\s*[\w$]+\(\)\.authHeader/), replacement: m => 'headers:{}'.padEnd(m.length, ' '), legs: 'L9', expect: /security:L9-(transactions-upload-authorization|ui-transactions-upload-row)/ },
  { name: 'm82-file-upload-header', kind: 'client', within: /fileUploader\.savedAt/, anchor: G(/headers\s*:\s*[\w$]+\(\)\.authHeader/), replacement: m => 'headers:{}'.padEnd(m.length, ' '), legs: 'L9', expect: /security:L9-(file-upload-authorization|ui-file-upload-success)/ },
  { name: 'm83-generic-upload-header', kind: 'client', within: /fileUploader\.savedAs/, anchor: G(/headers\s*:\s*[\w$]+\(\)\.authHeader/), replacement: m => 'headers:{}'.padEnd(m.length, ' '), legs: 'L9', expect: /security:L9-(upload-test-authorization|ui-upload-test-success)/ },
  { name: 'm84-backup-receipts-unscoped', kind: 'compiled', within: /Backup created/, anchor: G(/\bReceipt\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: 'Receipt.find({}).lean()', legs: 'L3', expect: /security:L3-backup-(scope|count)-receipts/ },
  { name: 'm85-backup-recurring-unscoped', kind: 'compiled', within: /Backup created/, anchor: G(/\bRecurringPayment\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: 'RecurringPayment.find({}).lean()', legs: 'L3', expect: /security:L3-backup-(scope|count)-recurringPayments/ },
  { name: 'm86-backup-invoices-unscoped', kind: 'compiled', within: /Backup created/, anchor: G(/\bInvoice\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: 'Invoice.find({}).lean()', legs: 'L3', expect: /security:L3-backup-(scope|count)-invoices/ },
  { name: 'm87-backup-budgets-unscoped', kind: 'compiled', within: /Backup created/, anchor: G(/\bBudget\.find\(\{ organizationId \}\)\.lean\(\)/), replacement: 'Budget.find({}).lean()', legs: 'L3', expect: /security:L3-backup-(scope|count)-budgets/ },
  { name: 'm88-renewal-mint-drops-sv', kind: 'compiled', within: /renewedSessionVersion/, anchor: G(/const renewedSessionVersion = user\.sessionVersion \?\? 0;/), replacement: 'const renewedSessionVersion = void 0;', legs: 'L6', expect: /security:L6(c)?-(fresh|legacy)-refresh-(again|sv)/ }
];

function run(appRoot, { mutant = false, browser = false, legs = null, timeout = 1800000 } = {}) {
  const env = { ...process.env, OMF_SECURITY_FIXTURE: 'owned', OMF_SECURITY_APP_ROOT: appRoot, OMF_SECURITY_MUTANT: mutant ? '1' : '', OMF_SECURITY_BROWSER: browser ? '1' : '', OMF_SECURITY_PUPPETEER_BASE: puppeteerBase, ...(legs ? { OMF_SECURITY_LEGS: legs } : {}), ...(tsx ? { OMF_SECURITY_TSX: tsx } : {}), ...(existsSync(binary) ? { OMF_MONGOD_BINARY: binary, MONGOMS_SYSTEM_BINARY: binary } : {}) };
  if (!legs) delete env.OMF_SECURITY_LEGS;
  for (const key of ['MONGO_URI', 'MONGODB_URI', 'NUXT_MONGO_URI', 'MONGO_URL', 'MONGODB_URL', 'DATABASE_URL']) env[key] = 'mongodb://127.0.0.1:1/zfx_no_ambient_database';
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SETUP_TOKEN', 'SLACK_BOT_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OMF_GMAIL_CLIENT_ID', 'OMF_GMAIL_CLIENT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) env[key] = 'no-model-or-business-send';
  for (const key of Object.keys(env)) if (key.startsWith('OMF_TEST_')) delete env[key];
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, [path.join(appRoot, 'scripts', 'finance-security-fixes-integration.cjs')], { cwd: appRoot, env, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      resolve({ ms: Date.now() - started, code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, killed: !!error?.killed, text, passes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PASS ')).map(l => l.slice(5, 60)), probes: String(stdout || '').split(/\r?\n/).filter(l => l.startsWith('PROBE')) });
    });
  });
}
const tail = r => (r.text.split(/\r?\n/).filter(l => /security:|AssertionError|Error|SETUP|PROBE-FAIL/.test(l)).slice(0, 8).join(' | ') || r.text.slice(-600)).replace(/\s+/g, ' ').slice(0, 1400);
async function filesUnder(dir, suffix) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await filesUnder(full, suffix)); else if (entry.name.endsWith(suffix)) out.push(full); } return out; }
function replaceAnchor(text, defect) {
  const matches = [...text.matchAll(defect.anchor)];
  if (!matches.length) return null;
  if (defect.occurrence === undefined) return text.replace(defect.anchor, defect.replacement);
  const m = matches[defect.occurrence]; if (!m) return null;
  const replaced = m[0].replace(new RegExp(defect.anchor.source), defect.replacement);
  return text.slice(0, m.index) + replaced + text.slice(m.index + m[0].length);
}
async function applyDefect(directory, defect) {
  const touched = [];
  const candidates = defect.kind === 'source' ? [path.join(directory, defect.file)] : defect.kind === 'client' ? await filesUnder(path.join(directory, '.output', 'public', '_nuxt'), '.js') : await filesUnder(path.join(directory, '.output', 'server', 'chunks'), '.mjs');
  for (const file of candidates) {
    const text = await readFile(file, 'utf8');
    if (defect.within && !defect.within.test(text)) continue;
    const next = replaceAnchor(text, defect);
    if (next === null || next === text) continue;
    await writeFile(file, next); touched.push(path.relative(directory, file));
  }
  if (!touched.length) throw new Error(`SETUP: defect ${defect.name}: anchor matched no ${defect.kind} file`);
  return touched;
}

export default {
  name: 'omf-security-fixes',
  covers: BUILT ? [...SCRIPT_COVERS, ...APP_COVERS] : SCRIPT_COVERS,
  async run() {
    const started = Date.now(), lines = [];
    let pass = true, positive = null, control = null;
    const defects = [], expectedGroups = API_LEGS.length + 1 + (BROWSER ? 1 : 0); // + L8 (worktree) + L9 (Chrome)
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else {
      positive = await run(root, { browser: BROWSER });
      const done = positive.text.match(/(\d+) security groups passed/);
      if (positive.code !== 0 || !done || Number(done[1]) !== positive.passes.length || positive.passes.length !== expectedGroups) { pass = false; lines.push(`1 built app: RED — exit ${positive.killed ? 'timeout' : positive.code}, ${positive.passes.length}/${expectedGroups} groups green${BROWSER ? ' (Chrome L9 requested)' : ' (Chrome absent: L9 NOT RUN)'}, probes [${positive.probes.slice(0, 6).join(' ; ')}]: ${tail(positive)}`); }
      else lines.push(`1 built app: ok (${positive.passes.length} groups in ${Math.round(positive.ms / 1000)}s${BROWSER ? ', Chrome L9 included' : ', Chrome absent: L9 NOT RUN'}; probes [${positive.probes.slice(0, 6).join(' ; ')}])`);
    }
    if (pass) {
      const base = path.resolve(root, '.zoomer', 'security-defects'), directory = path.resolve(base, randomUUID());
      if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe owned test directory');
      try {
        await mkdir(directory, { recursive: true });
        for (const dir of ['.output', 'server', 'shared', 'utils', 'stores', 'composables']) await cp(path.join(root, dir), path.join(directory, dir), { recursive: true, dereference: true });
        await mkdir(path.join(directory, 'scripts', 'zoomer-fixtures'), { recursive: true });
        for (const file of ['finance-security-fixes-integration.cjs', 'finance-security-fixes-browser.cjs', 'finance-webhook-transport-check.ts', 'manage-masters.ts', 'auth-regression.test.cjs']) await cp(path.join(root, 'scripts', file), path.join(directory, 'scripts', file));
        const originals = new Map();
        for (const file of [...await filesUnder(path.join(directory, '.output', 'server', 'chunks'), '.mjs'), ...await filesUnder(path.join(directory, '.output', 'public', '_nuxt'), '.js'), path.join(directory, 'server/services/webhookService.ts'), path.join(directory, 'stores/user.ts'), path.join(directory, 'server/utils/masterMaintenance.ts')]) if (existsSync(file)) originals.set(file, await readFile(file, 'utf8'));
        const reset = () => Promise.all([...originals].map(([f, t]) => writeFile(f, t)));
        control = await run(directory, { mutant: true });
        const controlOk = control.code === 0 && control.passes.length === API_LEGS.length;
        lines.push(`2 unchanged packaged copy: ${controlOk ? 'ok (' + control.passes.length + ' groups in ' + Math.round(control.ms / 1000) + 's)' : 'RED — ' + tail(control)}`);
        if (!controlOk) pass = false;
        else for (const defect of DEFECTS) {
          if (defect.kind === 'client' && !BROWSER) { defects.push({ name: defect.name, detected: null, notRun: 'Chrome absent: the upload header is behaviour-tested only' }); continue; }
          try {
            const touched = await applyDefect(directory, defect);
            const r = await run(directory, { mutant: defect.kind !== 'client', browser: defect.kind === 'client', legs: defect.legs, timeout: 900000 }), detected = r.code !== 0 && defect.expect.test(r.text) && !/SETUP/.test(r.text);
            defects.push({ name: defect.name, touched, detected, exit: r.code, ms: r.ms, tail: tail(r) });
            if (!detected) pass = false;
          } catch (error) { defects.push({ name: defect.name, detected: false, setupError: String(error.message).slice(0, 300) }); pass = false; }
          finally { await reset(); }
        }
        lines.push(`3 defects: ${defects.map(d => d.name + ':' + (d.notRun ? 'NOT RUN (' + d.notRun + ')' : d.detected ? 'detected' : 'NOT DETECTED' + (d.setupError ? ' (' + d.setupError + ')' : ' — exit ' + d.exit + ' ' + d.tail))).join(' · ')}`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (BUILT) lines.push('2-3 control and defects: NOT RUN — leg 1 is not green, defects prove nothing');
    const ran = defects.filter(d => !d.notRun), notRun = defects.filter(d => d.notRun).map(d => d.name);
    pass = pass && !!control && defects.length === DEFECTS.length && ran.every(d => d.detected) && ran.length === DEFECTS.length - (BROWSER ? 0 : 3);
    const databaseCoverage = positive && positive.code === 0 ? { executed: true, ownedProcess: true } : { executed: false, ownedProcess: false };
    return { pass, databaseCoverage, message: `${pass ? 'security fixes green' : 'FAILED'} in ${Math.round((Date.now() - started) / 1000)}s — ${ran.filter(d => d.detected).length}/${ran.length} defects detected${notRun.length ? ', NOT RUN: ' + notRun.join(', ') : ''} · ${lines.join(' · ')} · limits: synthetic owned native HTTP evidence with an owned loopback listener, a tsx run of the source transport/CLI code and installed Chrome headless when present; no model draw, no production row (scope-only plan: the production replay entry had zero rows on 2026-11-02); a real public webhook destination (no egress), the owner-dropped same-instant races and, without Chrome, the three upload headers stay uncovered by mutation; independent review and the deployed replay remain open.` };
  }
};

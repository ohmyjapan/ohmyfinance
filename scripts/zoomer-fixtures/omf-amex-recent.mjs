// Fixture for case omf-amex-recent-activity-20261102: the explicit, manual, provisional Amex recent-activity path. Run ONLY through the hub verifier:
//   node <hub>/scripts/zoomer-verify.mjs --run-fixture omf-amex-recent.mjs --cwd <this worktree>
// under the case's isolation (OMF_AMEX_RECENT_OWNED names an owned root; USERPROFILE, LOCALAPPDATA and TEMP must lie inside it, or the fixture stops at SETUP before any child starts).
// Evidence, stated exactly: fictional logins, cards, rows and owners; owned stock Chrome on a private desktop against loopback servers (the hosts map to nothing else); owned ephemeral MongoDB;
// owned temporary folders. No issuer, mailbox, vault, real profile, production database or visible window. The real /activity/recent page is NOT measured beyond the sanitized route, label and
// range shape: its rows, count and download here are fictional forms of the statement page's patterns, so nothing below says the real export will pass. That is the parent's acceptance.
// Legs (OMF_AMEX_RECENT_LEGS, comma list; default all):
//   P  pins: the production policy block, the ASCII helper, the exact operation list with no request field on any recent operation, no foreground or input call, one Expand, and the frozen
//      shared files (the reconciliation, posting, schedule, Navi, bill, login, bank and package sources) byte-equal to the plan's revision.
//   U  node --test: collector statement, adapter and recent-collector suites, the attended setup suite, the recorded card-background legs and the reconciliation suite.
//   V  the service at module level (a child under tsx): the real route, queue and scheduler, the real Navi action and the real collector claimWork and upload on owned MongoDB.
//   N  the real helper (omf-amex-native.mjs's copy, servers, runner and judge): the recent scenarios and the closed-path siblings on the same changed helper
//      (OMF_AMEX_RECENT_SCENARIOS narrows them).
//   R  measured repeats of the positive recent flows (OMF_AMEX_RECENT_REPEATS each, default 5): every failure is kept, none is retried. A count of runs, not a reliability rate.
//   A  the built app: scripts/finance-integration.cjs with OMF_TEST_RECENT_ONLY, then with OMF_TEST_PENDING_ONLY and the page in owned headless Chrome (needs .output of this tree).
//   M  deliberately reintroduced defects, each through the leg that must catch it after that leg's unchanged control: helper (HELPER_DEFECTS and the closed rows on moved lines), adapter (ADAPTER_DEFECTS), statement rules
//      (STATEMENT_DEFECTS), collector (COLLECTOR_DEFECTS), server (SERVER_DEFECTS). OMF_AMEX_RECENT_MUTANTS narrows them by label.
// A selected run exports no coverage.
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENARIOS, HELPER_DEFECTS as CLOSED_DEFECTS, PRODUCTION_POLICY, policyCopy, startServers, runScenario, recentOf, observedPage, rangeNodes, rangeOf, MASK, CONTROLS, MESSAGES, COLLAPSED, refused, held } from './omf-amex-native.mjs';

export const timeoutMs = 7200000;
const SELF = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(SELF), '..', '..');
const BASE = '5e6909f45adecc145cdaf12d843dc7027121342e';
const SCRIPT = path.join(root, 'collector', 'windows', 'amex-native.ps1');
const COVERS = ['collector/windows/amex-native.ps1', 'collector/amex-native.mjs', 'collector/browser.mjs', 'collector/index.mjs', 'collector/statement.mjs', 'server/models/Finance.ts', 'server/services/financeService.ts', 'server/api/finance/[...path].ts', 'pages/connections.vue', 'collector/test/fixtures/amex-native.html', 'scripts/zoomer-fixtures/omf-amex-recent.mjs'];
const list = name => (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
const LEGS = list('OMF_AMEX_RECENT_LEGS'), ONLY = list('OMF_AMEX_RECENT_SCENARIOS'), MUTANTS = list('OMF_AMEX_RECENT_MUTANTS');
const REPEATS = Math.max(0, Math.min(50, Number(process.env.OMF_AMEX_RECENT_REPEATS ?? 5) || 0));
const EVIDENCE = process.env.OMF_AMEX_RECENT_EVIDENCE || '', OWNED = process.env.OMF_AMEX_RECENT_OWNED || '';
export const PARTIAL = LEGS.length > 0 || ONLY.length > 0 || MUTANTS.length > 0 || REPEATS < 5;
const slash = date => date.replaceAll('-', '/');
const execute = (file, args, options = {}) => new Promise(resolve => execFile(file, args, { windowsHide: true, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8', ...options }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })));
const node = (args, env = {}, timeout = 1800000) => execute(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, timeout });
const mutate = (text, edits, label) => { let out = text; for (const [a, b] of edits) { const n = out.split(a).length - 1; if (n !== 1) throw new Error(label + ' anchor hits ' + n + ': ' + a.slice(0, 90)); out = out.replace(a, () => b); } return out; };

// ── the recent page (the sanitized contract: the statement page's link, the route, the range shape; everything else fictional) ───────────────────────────────────────────────────────────
const LABEL = '直近のご利用分', PRIMARY = '12345', NEAR_CARDS = ['••••2345', '•••12345', '•••••12345', '****12345', '12345', '-1234'];
const RECENT = { notLoaded: 'The recent Amex activity did not finish loading', changed: 'The recent Amex activity changed while it was being saved; request it again', uncovered: 'Amex displayed dates do not cover the current activity', count: 'Amex complete recent activity count could not be verified', empty: 'Amex shows no recent activity to import', outside: 'Downloaded recent activity is outside its displayed dates' };
const shape = q => `${slash(q.start)}ー今日現在（次回締め日${slash(q.closing)})`;
const split = q => [slash(q.start), 'ー', '今日現在', '（', '次回締め日', slash(q.closing), ')'];
function recentPage(c, p, overrides = {}) {
  observedPage(c, p);
  const q = recentOf(p);
  c.recent = { links: [{ href: '/activity/recent', text: LABEL }], cards: [MASK + PRIMARY], buttonCards: [], ranges: [shape(q)], total: [q.total, q.total], extras: [], ...overrides };
}
const R = def => ({ source: 'recent', ...def });
const linkStop = code => r => ({ linkRefusedBeforeActing: r.trace?.record.steps.some(s => s.step === 'open-recent' && s.outcome === 'error' && s.code === code) === true });
const noLinkPage = links => (c, p) => recentPage(c, p, { links });
export const RECENT_SCENARIOS = [
  // ── the positive flows ──
  R({ name: 'recent-spa', expect: 'complete', fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-full-navigation', expect: 'complete', fixture: (c, p) => recentPage(c, p, { links: [{ href: '/activity/recent', text: LABEL, spa: false }] }) }),
  R({ name: 'recent-split-range', expect: 'complete', fixture: (c, p) => recentPage(c, p, { ranges: [split(recentOf(p))] }) }),
  R({ name: 'recent-blob', expect: 'complete', blob: true, fixture: (c, p) => { recentPage(c, p); c.download = 'blob'; } }),
  R({ name: 'recent-no-code-asked', expect: 'complete', otp: false, fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-card-button', expect: 'complete', fixture: (c, p) => recentPage(c, p, { cards: [], buttonCards: ['-' + PRIMARY] }) }),
  R({ name: 'recent-expand-collapsed', expect: 'complete', fixture: (c, p) => { recentPage(c, p); c.icon = COLLAPSED; } }),
  R({ name: 'recent-two-links-one-destination', expect: 'complete', fixture: noLinkPage([{ href: '/activity/recent', text: LABEL }, { href: '/activity/recent', text: 'View All Recent Transactions' }]) }),
  R({ name: 'recent-keyed-link-beside', expect: 'complete', after: r => ({ tookTheQuerylessLink: r.receipts.page.find(x => x.kind === 'recent-link')?.href === '/activity/recent' }), fixture: noLinkPage([{ href: '/activity/recent?account_key=fictional', text: 'View All Recent Transactions' }, { href: '/activity/recent', text: LABEL }]) }),
  R({ name: 'recent-hidden-decoys', expect: 'complete', fixture: (c, p) => { const stale = shape({ start: p.latest.start, closing: p.latest.end }); recentPage(c, p, { extras: ['offscreen', 'clipped', 'unrendered', ...CONTROLS].flatMap(place => [{ nodes: [MASK + '54321'], place }, { nodes: [stale], place }]) }); } }),
  // ── the card on the recent page ──
  R({ name: 'recent-wrong-card', expect: { message: MESSAGES.wrongCard, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { cards: [MASK + '54321'] }) }),
  R({ name: 'recent-conflicting-card', expect: { message: MESSAGES.wrongCard, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { cards: [MASK + PRIMARY, MASK + '54321'] }) }),
  R({ name: 'recent-near-card', expect: { message: RECENT.notLoaded, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { cards: NEAR_CARDS }) }),
  R({ name: 'recent-other-card-first', expect: { message: MESSAGES.unverified, before: true, noRecentLink: true }, fixture: (c, p) => { recentPage(c, p); c.maskedCards['*'] = [MASK + '54321']; } }),
  // ── the displayed dates ──
  R({ name: 'recent-stale-range', expect: { message: RECENT.uncovered, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { ranges: [shape({ start: p.latest.start, closing: p.latest.end })] }) }),
  R({ name: 'recent-future-range', expect: { message: RECENT.uncovered, before: true, recentLinkOnce: true }, fixture: (c, p) => { const q = recentOf(p); recentPage(c, p, { ranges: [shape({ start: p.open.end, closing: q.closing })] }); } }),
  R({ name: 'recent-two-ranges', expect: { message: RECENT.uncovered, before: true, recentLinkOnce: true }, fixture: (c, p) => { const q = recentOf(p); recentPage(c, p, { ranges: [shape(q), shape({ start: p.latest.start, closing: q.closing })] }); } }),
  R({ name: 'recent-range-undisplayed', expect: { message: RECENT.notLoaded, before: true, recentLinkOnce: true }, fixture: (c, p) => { const q = recentOf(p); recentPage(c, p, { ranges: [], extras: ['offscreen', 'clipped', 'unrendered', ...CONTROLS].map(place => ({ nodes: [shape(q)], place })) }); } }),
  R({ name: 'recent-near-ranges', expect: { message: RECENT.notLoaded, before: true, recentLinkOnce: true }, fixture: (c, p) => { const q = recentOf(p), [a, b] = rangeOf({ start: q.start, end: q.closing }); recentPage(c, p, { ranges: [rangeNodes([a, b]), [a, 'ー', '今日現在', '件', '（', '次回締め日', b, ')'], `${a}ー今日現在`, `${a}ー昨日現在（次回締め日${b})`] }); } }),
  // ── the count ──
  R({ name: 'recent-partial-count', expect: { message: RECENT.count, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { total: [4, 3] }) }),
  R({ name: 'recent-empty', expect: { message: RECENT.empty, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { total: [0, 0] }) }),
  R({ name: 'recent-no-count', expect: { message: RECENT.notLoaded, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { total: null }) }),
  // ── the file ──
  R({ name: 'recent-wrong-file-count', expect: { message: 'Downloaded row count does not match the Amex page', file: true }, csv: { count: 3 }, fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-wrong-file-card', expect: { message: /2行目: この口座に登録されていないカードです/, file: true }, csv: { foreignCardRow: true }, fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-file-outside-dates', expect: { message: RECENT.outside, file: true }, csv: { outside: true }, fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-no-download', expect: { message: 'Amex CSV download did not complete', clicked: true }, fixture: (c, p) => { recentPage(c, p); c.download = 'none'; } }),
  // ── a page that moves: mutable by nature, so a change between reads is a stop, never a guess ──
  R({ name: 'recent-changed-before', expect: { message: RECENT.changed, before: true }, fixture: (c, p) => recentPage(c, p, { after: { format: { total: [5, 5] } } }) }),
  R({ name: 'recent-changed-after', expect: { message: RECENT.changed, file: true }, fixture: (c, p) => recentPage(c, p, { after: { download: { total: [5, 5] } } }) }),
  R({ name: 'recent-range-changed-after', expect: { message: RECENT.changed, file: true }, fixture: (c, p) => { const q = recentOf(p); recentPage(c, p, { after: { download: { ranges: [shape({ start: p.latest.end, closing: q.closing })] } } }); } }),
  // ── the link: the statement page's own, in the main document, the exact destination, and nothing else ──
  R({ name: 'recent-link-only-in-frames', expect: { message: MESSAGES.pageChanged, before: true, noRecentLink: true }, after: linkStop('recent_link_missing'), fixture: noLinkPage([]) }),
  R({ name: 'recent-link-with-query', expect: { message: MESSAGES.pageChanged, before: true, noRecentLink: true }, after: linkStop('recent_link_missing'), fixture: noLinkPage([{ href: '/activity/recent?account_key=fictional', text: LABEL }]) }),
  R({ name: 'recent-link-other-path', expect: { message: MESSAGES.pageChanged, before: true, noRecentLink: true }, after: linkStop('recent_link_missing'), fixture: noLinkPage([{ href: '/activity/recently', text: LABEL }]) }),
  R({ name: 'recent-link-foreign-origin', expect: { message: MESSAGES.pageChanged, before: true, noRecentLink: true }, after: r => ({ ...linkStop('recent_link_missing')(r), foreignNeverRequested: r.receipts.decoyArrivals.filter(a => a.path === '/activity/recent').length === 0 }), fixture: (c, p) => recentPage(c, p, { links: [{ href: c.crossOrigin + '/activity/recent', text: LABEL }] }) }),
  R({ name: 'recent-popup', expect: { message: MESSAGES.otherWindow, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { popup: true }) }),
  R({ name: 'recent-left-the-page', expect: { message: RECENT.notLoaded, before: true, recentLinkOnce: true }, fixture: (c, p) => recentPage(c, p, { leaves: true, links: [{ href: '/activity/recent', text: LABEL, spa: false }] }) }),
  // ── one action, read again immediately before it, on this page ──
  R({ name: 'recent-hold-replaced', expect: refused('control_changed'), helper: held(900), fixture: (c, p) => { recentPage(c, p, { links: [{ href: '/activity/recent', text: LABEL, spa: false }] }); c.icon = COLLAPSED; c.hold = 'replaced'; } }),
  // ── closure: the same job objects on this path ──
  R({ name: 'recent-helper-killed', expect: { message: MESSAGES.helperEnded, kill: true }, kill: 'helper', fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-broker-killed', expect: { message: MESSAGES.helperEnded, kill: true }, kill: 'broker', fixture: (c, p) => recentPage(c, p) }),
  R({ name: 'recent-collector-killed', expect: 'crash', kill: 'collector', fixture: (c, p) => recentPage(c, p) })
];
// The closed path on the same changed helper: its positive flows, one card, count, window, action and closure proof each, and a closed job on a page that has the recent link.
const SIBLINGS = ['positive-attachment', 'positive-blob', 'observed-statement', 'download-expand-collapsed', 'wrong-card', 'incomplete-count', 'observed-wrong-card', 'observed-period-mismatch', 'observed-incomplete-count', 'unrelated-window', 'download-hold-replaced', 'download-hold-reloaded', 'helper-killed', 'broker-killed', 'collector-killed', 'closure-slow-member'];
const CLOSED = [...SCENARIOS.filter(s => SIBLINGS.includes(s.name)), { ...SCENARIOS.find(s => s.name === 'observed-statement'), name: 'closed-beside-the-recent-link', after: r => ({ recentLinkNeverFollowed: r.receipts.page.filter(x => x.kind === 'recent-link').length === 0 }), fixture: (c, p) => recentPage(c, p) }];
const POSITIVE = ['recent-spa', 'recent-full-navigation', 'recent-split-range'];

// ── the reintroduced defects. Anchors are single lines of the sources; each must hit exactly once. ──────────────────────────────────────────────────────────────────────────────────────
const LINK_LINE = 'foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) { var v = ValueOf(e); if (OriginOf(v) != OmfAmexNativePolicy.Global || PathOf(v) != RecentPath || QueryOf(v) != "") continue; found++;';
export const HELPER_DEFECTS = [
  ['RH1-a-frame-supplies-the-link', [[LINK_LINE, 'foreach (AutomationElement e in d.main.FindAll(TreeScope.Descendants, Type(ControlType.Hyperlink))) { var v = ValueOf(e); if (OriginOf(v) != OmfAmexNativePolicy.Global || PathOf(v) != RecentPath || QueryOf(v) != "") continue; found++;']], 'recent-link-only-in-frames'],
  ['RH2-a-keyed-link-is-followed', [[' || QueryOf(v) != "") continue; found++;', ') continue; found++;']], 'recent-link-with-query'],
  ['RH3-a-near-path-is-followed', [['|| PathOf(v) != RecentPath || QueryOf(v) != ""', '|| !PathOf(v).StartsWith(RecentPath) || QueryOf(v) != ""']], 'recent-link-other-path'],
  ['RH4-a-foreign-link-is-followed', [['if (OriginOf(v) != OmfAmexNativePolicy.Global || PathOf(v) != RecentPath', 'if (PathOf(v) != RecentPath']], 'recent-link-foreign-origin'],
  ['RH5-an-undisplayed-range-counts', [['    if (part == n) ranges.Add(joined);', '    ranges.Add(joined);']], 'recent-range-undisplayed'],
  ['RH6-the-recent-read-stays-on-the-statement', [['case "recent-snapshot": return Read(RecentPath);', 'case "recent-snapshot": return Read(StatementPath);']], 'recent-spa'],
  ['RH7-the-recent-download-stays-on-the-statement', [['case "recent-download": return Download(RecentPath);', 'case "recent-download": return Download(StatementPath);']], 'recent-spa'],
  ['RH8-the-closed-download-moves-to-the-recent-page', [['case "download": return Download(StatementPath);', 'case "download": return Download(RecentPath);']], 'positive-attachment'],
  ['RH9-the-range-parts-need-not-be-adjacent', [['   if (text.Length > 0) { elements.Add(e); texts.Add(text); }', '   if (text.Length > 0 && text != "\\u4EF6") { elements.Add(e); texts.Add(text); }']], 'recent-near-ranges'],
  ['RH10-any-text-is-the-range', [['    if (!RecentRange.IsMatch(joined)) continue;', '    if (joined.IndexOf("\\u73FE\\u5728") < 0) continue;']], 'recent-near-ranges'],
  ['RH11-a-control-name-is-the-range', [['  foreach (var e in Scoped(d, Type(ControlType.Text))) {', '  foreach (var e in Scoped(d, Condition.TrueCondition)) {']], 'recent-range-undisplayed']
];
// The closed-path defects on the lines this change moved (the shared read, the Expand path and its rereads): omf-amex-native.mjs's own rows, through their own scenarios.
const MOVED = ['PN0-the-current-page-is-not-read', 'PN7-a-control-name-is-the-card', 'PN12-frames-supply-the-card-and-period', 'PN15-the-icon-has-no-expand-path', 'PN16-expand-is-sent-twice', 'PN20-the-icon-is-not-found-again', 'PN21-enabled-is-not-read-again', 'PN22-the-state-is-read-before-the-hold', 'PN23-the-document-is-not-read-again', 'PN24-the-surface-is-not-read-again'];
const NATIVE_DEFECTS = [...HELPER_DEFECTS, ...CLOSED_DEFECTS.filter(d => MOVED.includes(d[0]))];
const NATIVE_MODULE = 'collector/amex-native.mjs', NATIVE_TEST = 'collector/test/amex-native.test.mjs', STATEMENT_MODULE = 'collector/statement.mjs', STATEMENT_TEST = 'collector/test/statement.test.mjs', INDEX_MODULE = 'collector/index.mjs', BROWSER_MODULE = 'collector/browser.mjs', RECENT_TEST = 'collector/test/amex-recent.test.mjs';
export const ADAPTER_DEFECTS = [
  ['RA1-recent-is-the-default', [["origin = '', attended = false, source = 'statement' } = {}) {", "origin = '', attended = false, source = 'recent' } = {}) {"]], /amex-recent:closed-sends-no-recent-action/],
  ['RA2-a-recent-file-is-called-a-statement', [["kind: 'pending', start: selected.start, end: last.end,", "kind: 'statement', start: selected.start, end: last.end,"]], /amex-recent:manifest-values/],
  ['RA3-the-page-is-not-read-after-the-file', [["  const after = await readUntil(helper, trace, 'recent-snapshot', recentOf, RECHECK_MS, 'verify-after');", "  const after = before;"]], /amex-recent:moved/],
  ['RA4-a-page-that-moved-is-accepted', [["  if (last.key !== selected.key || last.pageCount !== selected.pageCount) throw new Error(RECENT_CHANGED);", ""]], /amex-recent:moved/],
  ['RA5-the-page-is-not-read-before-the-download', [["  const ahead = verifyRecent(before, account.primaryCard, nativeHost.now());", "  const ahead = selected;"]], /amex-recent:moved/],
  ['RA6-rows-outside-the-dates-are-accepted', [["  try { parsed = parseAmex(bytes, account.cardIdentifiers); verifyRecentRows(parsed.rows, { start: selected.start, end: tokyoDate(nativeHost.now()) }); }", "  try { parsed = parseAmex(bytes, account.cardIdentifiers); }"]], /amex-recent:outside-dates/],
  ['RA7-the-file-count-is-not-compared', [["  if (parsed.rows.length !== selected.pageCount) { trace.step('validate', 'error'); throw new Error('Downloaded row count does not match the Amex page'); }", ""]], /amex-recent:wrong-download-count/],
  ['RA8-the-statement-page-card-is-not-read', [["reply => replySnapshot(reply).cards.includes('-' + account.primaryCard) ? true : null, STATEMENT_MS, 'initial');", "() => true, STATEMENT_MS, 'initial');"]], /amex-recent:other-card-first/],
  ['RA9-a-closed-action-runs-on-this-path', [["  if ((await act(helper, trace, 'recent-download-open')).alreadyExpanded === true)", "  if ((await act(helper, trace, 'download-open', {}, ACT_MS, 'recent-download-open')).alreadyExpanded === true)"]], /amex-recent:(the-whole-path|positive)/],
  ['RA10-a-file-already-there-is-taken-for-the-download', [["  if ((await readdir(folder)).length) { trace.step('recent-download', 'error'); throw new Error('Multiple downloads started; check the Amex tab'); }", ""]], /amex-recent:file-before-the-action/]
];
export const STATEMENT_DEFECTS = [
  ['RS1-any-card-is-the-signed-in-card', [["  if (cards.length !== 1 || cards[0] !== '-' + primaryCard) throw new Error(WRONG_CARD);", ""]], /amex-recent:(card-refused|another-primary-card)/],
  ['RS2-a-stale-cycle-is-current', [["  if (start > end || closing < end) throw new Error(UNCOVERED);", ""]], /amex-recent:range-refused/],
  ['RS3-two-ranges-are-one', [["const ranges = [...new Set(snapshot.ranges.map(text => recentRange(text)?.key))];", "const ranges = [...new Set(snapshot.ranges.map(text => recentRange(text)?.key))].slice(0, 1);"]], /amex-recent:range-refused/],
  ['RS4-a-partial-count-is-complete', [["|| counts[0][0] !== counts[0][1]) throw new Error('Amex complete recent activity count could not be verified');", ") throw new Error('Amex complete recent activity count could not be verified');"]], /amex-recent:count-refused/],
  ['RS5-the-day-is-not-the-japanese-day', [["export function verifyRecent(snapshot, primaryCard, now = Date.now()) {", "export function verifyRecent(snapshot, primaryCard, now = Date.now()) { now -= 9 * 3600000;"]], /amex-recent:(end-after-japan-midnight|verified)/],
  ['RS6-rows-are-not-checked', [["  if (rows.some(row => row.processingDate < selected.start || row.processingDate > selected.end)) throw new Error('Downloaded recent activity is outside its displayed dates');", ""]], /amex-recent:rows-outside/],
  ['RS7-a-near-range-reads-as-the-range', [["const RECENT_RANGE = /^(\\d{4}\\/\\d{2}\\/\\d{2})\\s*[ー\\-－–]\\s*今日現在\\s*[（(]\\s*次回締め日\\s*(\\d{4}\\/\\d{2}\\/\\d{2})\\s*[）)]$/;", "const RECENT_RANGE = /(\\d{4}\\/\\d{2}\\/\\d{2}).*?(\\d{4}\\/\\d{2}\\/\\d{2})/;"]], /amex-recent:range-near-form-refused/]
];
export const COLLECTOR_DEFECTS = [
  ['RC1-the-claim-declares-nothing', INDEX_MODULE, [["const {account,covered}=await api(config,'claim',{capabilities:[RECENT_CAPABILITY]},undefined,live);", "const {account,covered}=await api(config,'claim',{},undefined,live);"]], /amex-recent:claim-declares-the-capability/],
  ['RC2-the-job-source-is-not-passed', INDEX_MODULE, [["origin:config.baseUrl,attended,source});credentials=null;", "origin:config.baseUrl,attended});credentials=null;"]], /amex-recent:(each-job-uploads-its-own-kind|job-completes)/],
  ['RC3-a-recent-job-sends-a-retained-statement', INDEX_MODULE, [["const send=source==='recent'?retained.filter(item=>item.manifest.kind==='pending'):retained;", "const send=retained;"]], /amex-recent:recent-(leaves-a-statement|sends-only-provisional)/],
  ['RC4-a-provisional-file-costs-the-closed-download', INDEX_MODULE, [["return {send,collect:source==='recent'?!send.length:!send.some(item=>item.manifest.kind!=='pending')};", "return {send,collect:!send.length};"]], /amex-recent:closed-job-still-collects-after-a-provisional-file/],
  ['RC5-a-recent-job-claims-to-be-a-statement', INDEX_MODULE, [["await status('complete',source==='recent'?RECENT_SAVED:'Statement saved in OMF for review');", "await status('complete','Statement saved in OMF for review');"]], /amex-recent:recent-completion-says-provisional/],
  ['RC6-the-wrapper-drops-the-source', BROWSER_MODULE, [["{ profile, chrome: findChrome(), gmail, source, onLaunch, origin, attended }); } // guard:amex-native", "{ profile, chrome: findChrome(), gmail, onLaunch, origin, attended }); } // guard:amex-native"]], /amex-recent:(each-job-uploads-its-own-kind|job-completes)/]
];
const ROUTE = 'server/api/finance/[...path].ts', SERVICE = 'server/services/financeService.ts';
export const SERVER_DEFECTS = [
  ['RV1-a-legacy-claim-receives-a-recent-job', ROUTE, [["{ ...open, jobSource: { $ne: 'recent' } }", "{ ...open }"]], /recent-service:legacy-never-receives/],
  ['RV2-a-recent-job-uploads-a-statement', ROUTE, [["if (account.jobSource === 'recent' && kind !== 'pending') fail(409, 'A recent activity job uploads provisional activity only')", ""]], /recent-service:recent-upload-is-provisional-only/],
  ['RV3-a-closed-request-keeps-the-source', SERVICE, [["$unset: { jobLeaseUntil: '', jobDeviceId: '', ...(recent ? {} : { jobSource: '' }) } }, { new: true })", "$unset: { jobLeaseUntil: '', jobDeviceId: '' } }, { new: true })"]], /recent-service:(closed-request-clears|navi-clears|notice-clears)/],
  ['RV4-the-schedule-keeps-the-source', SERVICE, [["'autoSync.lastQueuedDay': day }, $unset: { jobLeaseUntil: '', jobDeviceId: '', jobSource: '' } }, { new: true }).lean() // guard:schedule-providers-atomic", "'autoSync.lastQueuedDay': day }, $unset: { jobLeaseUntil: '', jobDeviceId: '' } }, { new: true }).lean() // guard:schedule-providers-atomic"]], /recent-service:schedule-clears/],
  ['RV5-aplus-can-ask-for-recent', SERVICE, [["if (source === 'recent' && (account.provider || 'amex') !== 'amex') fail(400, 'Recent activity is available for Amex accounts only')", ""]], /recent-service:amex-only/],
  ['RV6-no-capable-collector-is-needed', SERVICE, [["if (recent && !await FinanceCollector.exists({ ownerId, accountIds: account._id, revokedAt: null, capabilities: AMEX_RECENT_CAPABILITY })) fail(409, RECENT_UNSUPPORTED)", ""]], /recent-service:needs-a-capable-collector/],
  ['RV7-a-recent-claim-counts-as-the-closed-attempt', ROUTE, [["{ ...open, jobSource: 'recent' }, { $set: started }", "{ ...open, jobSource: 'recent' }, { $set: { ...started, lastAttemptAt: new Date() } }"]], /recent-service:schedule-runs-after-a-recent-job/],
  ['RV8-the-capability-is-not-recorded', ROUTE, [["if ((device.capabilities || []).join() !== capabilities.join()) await FinanceCollector.updateOne({ _id: device._id, revokedAt: null }, { $set: { capabilities } })", ""]], /recent-service:capability-recorded/],
  ['RV9-a-legacy-resume-takes-a-recent-job', ROUTE, [["const recentAllowed = capabilities.includes(AMEX_RECENT_CAPABILITY)", "const recentAllowed = true"]], /recent-service:legacy-never-receives/]
];

// ── the service at module level: `node --import tsx <this file> --service` (OMF_RECENT_SRC: a mutated copy of server/ and shared/) ─────────────────────────────────────────────────────────
async function service() {
  const require = createRequire(path.join(root, 'package.json')), SRC = path.resolve(process.env.OMF_RECENT_SRC || root), u = p => pathToFileURL(path.join(SRC, p)).href, c = p => pathToFileURL(path.join(root, p)).href;
  const { MongoMemoryServer } = require('mongodb-memory-server'), binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  const mongo = await MongoMemoryServer.create({ binary: existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 120000 } });
  const dbName = 'omf_amex_recent', uri = mongo.getUri(dbName), temp = await mkdtemp(path.join(os.tmpdir(), 'omf-amex-recent-service-'));
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri) || /:27017\//.test(uri)) throw new Error('SETUP refused: not an owned ephemeral database address');
  Object.assign(process.env, { MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data'), OMF_COLLECTOR_DIR: path.join(temp, 'collector') });
  let server = null, mongoose = null;
  try {
    const h3 = await import(pathToFileURL(require.resolve('h3')).href); mongoose = (await import(pathToFileURL(require.resolve('mongoose')).href)).default; const jwt = (await import(pathToFileURL(require.resolve('jsonwebtoken')).href)).default;
    const User = (await import(u('server/models/User.ts'))).default, { FinancialAccount, FinanceCollector, FinanceImport } = await import(u('server/models/Finance.ts'));
    const finance = await import(u('server/services/financeService.ts')), scheduler = await import(u('server/services/financeSyncScheduler.ts')), route = (await import(u('server/api/finance/[...path].ts'))).default, auth = (await import(u('server/middleware/auth.ts'))).default;
    const navi = (await import(u('server/services/financeOwnerActionService.ts'))).ownerActions.find(a => a.name === 'queue_card_sync'), collector = await import(c('collector/index.mjs')), { digest } = await import(u('shared/amex.mjs'));
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 }); assert.equal(mongoose.connection.name, dbName);
    const user = await User.create({ email: 'recent-owner@example.invalid', name: 'Synthetic owner', password: 'Synthetic-password-Only1!' });
    const ownerId = String(user._id), token = jwt.sign({ userId: ownerId, email: 'recent-owner@example.invalid', type: 'access', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30m' });
    const amex = await FinancialAccount.create({ ownerId, provider: 'amex', name: 'Service Amex', primaryCard: '11111', cardIdentifiers: ['11111'], otpRecipient: 'a@example.invalid', otpMailbox: 'a@example.invalid', autoSync: { enabled: true, hour: 9 } });
    const aplus = await FinancialAccount.create({ ownerId, provider: 'aplus', name: 'Service Aplus', primaryCard: '2222', cardIdentifiers: ['2222'] });
    const device = await finance.createCollector(ownerId, { name: 'Service collector', accountIds: [String(amex._id), String(aplus._id)] });
    const app = h3.createApp(); app.use(auth); app.use(h3.defineEventHandler(e => e.path.startsWith('/api/finance/') ? route(e) : undefined));
    server = http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = 'http://127.0.0.1:' + server.address().port, config = { baseUrl: origin, token: device.token };
    const owner = (p, body, method = 'POST') => fetch(origin + '/api/finance/' + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
    const legacy = () => fetch(origin + '/api/finance/collector/claim', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
    const status = (a, state) => fetch(origin + '/api/finance/collector/status', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: String(a._id), jobId: a.jobId, state, message: 'synthetic' }) }).then(r => r.status);
    const read = () => FinancialAccount.findById(amex._id).lean(), sync = (body, id = amex._id) => owner('accounts/' + id + '/sync', body);
    const jst = (day, h, mi = 0) => new Date(Date.parse(day + 'T00:00:00Z') + h * 3600000 + mi * 60000 - 9 * 3600000);
    const reset = async (set = {}) => { await FinancialAccount.updateOne({ _id: amex._id }, { $set: { jobState: 'idle' }, $unset: { 'autoSync.lastQueuedDay': '', lastAttemptAt: '', jobId: '', jobRequestedAt: '', jobLeaseUntil: '', jobDeviceId: '', jobSource: '', jobOperation: '' } }); if (Object.keys(set).length) await FinancialAccount.updateOne({ _id: amex._id }, { $set: set }); };
    const declared = () => collector.claimWork(config, null); // the PC's own claim: a legacy claim above drops the capability, as a downgraded collector would
    const todayInJapan = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const csv = text => Buffer.from(['ご利用日,データ処理日,ご利用内容,カード会員様名,会員番号 #,金額,海外通貨利用金額,換算レート', ...text].join('\r\n') + '\r\n');
    const line = name => `2026/10/06,2026/10/07,${name},Test user,-11111,1200,,`;
    const retained = async (kind, jobId, name) => { const dir = path.join(temp, 'outbox-' + randomUUID()), filename = randomUUID(), bytes = csv([line(name)]); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, filename), bytes); const manifest = { accountId: String(amex._id), primaryCard: '11111', jobId, kind, start: '2026-10-05', end: '2026-11-02', pageCount: 1, sha256: digest(bytes), filename }; await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest)); return { directory: dir, manifest }; };
    const checks = []; const check = (name, fn) => checks.push([name, fn]);

    check('the request is bounded and needs a PC that declared it', async () => {
      assert.equal((await sync({ source: 'closed' })).status, 400, 'recent-service:bounded-word');
      assert.equal((await sync({ source: 'recent' }, aplus._id)).status, 400, 'recent-service:amex-only');
      await legacy();
      assert.equal((await sync({ source: 'recent' })).status, 409, 'recent-service:needs-a-capable-collector');
      assert.equal((await read()).jobState, 'idle', 'recent-service:refused-queues-nothing');
      const claimed = await collector.claimWork(config, null);
      assert.equal(claimed.account, null);
      assert.deepEqual((await FinanceCollector.findById(device.id).lean()).capabilities, ['amex-recent-v1'], 'recent-service:capability-recorded');
    });
    check('a recent job goes only to a declaring collector, with the real claim and upload', async () => {
      await reset(); await declared(); assert.equal((await sync({ source: 'recent' })).status, 200, 'recent-service:queued');
      assert.equal((await legacy()).account, null, 'recent-service:legacy-never-receives');
      assert.equal((await read()).jobState, 'queued', 'recent-service:legacy-leaves-it-queued');
      const { account } = await collector.claimWork(config, null);
      assert.deepEqual([String(account?._id), account?.jobSource], [String(amex._id), 'recent'], 'recent-service:real-claim-takes-it');
      const statement = await collector.upload(config, account, await retained('statement', account.jobId, 'Confirmed by mistake'), null).then(() => 200, e => e.status);
      assert.equal(statement, 409, 'recent-service:recent-upload-is-provisional-only');
      assert.equal(await FinanceImport.countDocuments({ accountId: amex._id }), 0, 'recent-service:recent-upload-is-provisional-only nothing stored');
      const item = await retained('pending', account.jobId, 'Provisional shop'), result = await collector.upload(config, account, item, null);
      const batch = await FinanceImport.findById(result.id).lean();
      assert.deepEqual([batch.sourceStatus, batch.period.kind, batch.calendar, String(batch.collectorId)], ['pending', 'pending', undefined, device.id], 'recent-service:stored-provisional');
      assert.equal((await readFile(path.join(item.directory, 'manifest.json'), 'utf8')).includes('acknowledgedAt'), true, 'recent-service:acknowledged-after-the-answer');
      assert.equal(await status(account, 'complete'), 200);
    });
    check('after a recent job every closed request is closed: the page, Navi, the notice path and the schedule', async () => {
      assert.equal((await read()).jobSource, 'recent');
      const page = await sync(); assert.deepEqual([page.status, page.data.account.jobSource, (await read()).jobSource], [200, undefined, undefined], 'recent-service:closed-request-clears');
      const taken = (await legacy()).account; assert.deepEqual([String(taken?._id), taken?.jobSource], [String(amex._id), undefined], 'recent-service:legacy-takes-closed'); assert.equal(await status(taken, 'complete'), 200);
      await FinancialAccount.updateOne({ _id: amex._id }, { $set: { jobSource: 'recent' } });
      const operationId = randomUUID(), queued = await navi.run({ ownerId, agent: { accountIds: [amex._id] } }, { accountId: String(amex._id) }, null, { operationId });
      assert.equal(queued.outcome, 'queued'); assert.deepEqual([(await read()).jobSource, (await read()).jobOperation?.operationId], [undefined, operationId], 'recent-service:navi-clears');
      await reset({ jobSource: 'recent' }); await finance.queueSync(ownerId, await read()); assert.equal((await read()).jobSource, undefined, 'recent-service:notice-clears (the default the bill notice calls)');
      await reset({ jobSource: 'recent' }); const day = '2026-11-03', tick = await scheduler.runSyncSchedule(jst(day, 9, 5));
      assert.deepEqual([tick.queued, (await read()).jobSource], [[String(amex._id)], undefined], 'recent-service:schedule-clears');
    });
    check('a closed account that never ran a recent job keeps its shape', async () => {
      await reset(); await FinancialAccount.collection.updateOne({ _id: amex._id }, { $unset: { jobSource: '' } });
      await navi.run({ ownerId, agent: { accountIds: [amex._id] } }, { accountId: String(amex._id) }, null, { operationId: randomUUID() });
      assert.equal('jobSource' in await FinancialAccount.collection.findOne({ _id: amex._id }), false, 'recent-service:no-field-on-closed-only-accounts');
    });
    check('a recent claim is no closed attempt: the day\'s schedule still runs, and it never runs over a job', async () => {
      await reset(); await declared(); assert.equal((await sync({ source: 'recent' })).status, 200);
      assert.deepEqual(await scheduler.runSyncSchedule(jst('2026-11-04', 9, 5)), { queued: [] }, 'recent-service:schedule-waits-for-a-queued-job');
      const { account } = await collector.claimWork(config, null); assert.equal(account?.jobSource, 'recent');
      assert.deepEqual(await scheduler.runSyncSchedule(jst('2026-11-04', 9, 6)), { queued: [] }, 'recent-service:schedule-waits-for-a-running-job');
      assert.equal(await status(account, 'complete'), 200);
      const after = await scheduler.runSyncSchedule(jst(todayInJapan(), 23, 59)), row = await read(); // the day of the claim itself: a claim that counted as the attempt would stop this
      assert.deepEqual([after.queued, row.jobSource, row.lastAttemptAt], [[String(amex._id)], undefined, undefined], 'recent-service:schedule-runs-after-a-recent-job ' + JSON.stringify(after));
      const claimed = (await legacy()).account; assert.deepEqual([String(claimed?._id), claimed?.jobSource], [String(amex._id), undefined], 'recent-service:the-scheduled-job-is-closed');
      assert.ok((await read()).lastAttemptAt, 'recent-service:a-closed-claim-still-records-its-attempt');
      assert.equal(await status(claimed, 'complete'), 200);
    });
    check('queues stay one at a time and a closed request never replaces a job', async () => {
      await reset(); await declared(); assert.equal((await sync({ source: 'recent' })).status, 200);
      for (const body of [undefined, { source: 'statement' }, { source: 'recent' }]) assert.equal((await sync(body)).status, 409, 'recent-service:one-job-at-a-time ' + JSON.stringify(body));
      await assert.rejects(finance.queueSync(ownerId, await read()), e => e.statusCode === 409, 'recent-service:the-notice-path-is-told-it-is-busy');
    });
    for (const [name, fn] of checks) { await fn(); console.log('PASS ' + name); }
    console.log('SERVICE GREEN ' + checks.length);
  } finally { server?.closeAllConnections?.(); server?.close(); await mongoose?.disconnect().catch(() => {}); await mongo.stop().catch(() => {}); await rm(temp, { recursive: true, force: true }).catch(() => {}); }
}
// A copy of server/ + shared/ inside the worktree so dependencies resolve, with one file replaced; removed whatever happens.
async function withTree(label, file, text, fn) {
  const dir = path.join(root, '.cache', 'omf-recent-' + label); await rm(dir, { recursive: true, force: true });
  for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true });
  await writeFile(path.join(dir, file), text);
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const serviceRun = (env = {}) => node(['--import', 'tsx', SELF, '--service'], { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env }, 600000);
async function withCopy(file, label, text, fn) {
  const copy = path.join(root, path.dirname(file), '.zoomer-recent-' + label.split('-')[0] + '-' + path.basename(file));
  await writeFile(copy, text); try { return await fn(copy); } finally { await rm(copy, { force: true }).catch(() => {}); }
}

// ── owned headless Chrome for the page leg: its own profile, loopback only, no window; ended by its own handle ───────────────────────────────────────────────────────────────────────────
async function ownedChrome(work) {
  const { findChrome } = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href), profile = path.join(work, 'page-chrome'); await mkdir(profile, { recursive: true });
  const child = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const started = Date.now(); let port = null;
  while (!port && Date.now() - started < 30000) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await new Promise(r => setTimeout(r, 200)); } }
  if (!port) { child.kill(); throw new Error('SETUP the owned headless Chrome gave no port'); }
  return { port, stop: async () => { if (child.exitCode === null) { const gone = new Promise(r => child.once('exit', r)); child.kill(); await Promise.race([gone, new Promise(r => setTimeout(r, 10000))]); } } };
}

const fixture = { name: 'omf-amex-recent', covers: PARTIAL ? [] : COVERS, async run() {
  const started = Date.now(), lines = [], tag = new Date().toISOString().replace(/[:.]/g, '-'), want = leg => !LEGS.length || LEGS.includes(leg);
  if (process.platform !== 'win32') return { pass: false, message: 'Windows, installed Chrome and UI Automation are required' };
  const inside = value => !!OWNED && !!value && path.resolve(value).toLowerCase().startsWith(path.resolve(OWNED).toLowerCase() + path.sep);
  const isolation = { USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: process.env.TEMP };
  if (!Object.values(isolation).every(inside)) return { pass: false, message: 'SETUP refused: USERPROFILE, LOCALAPPDATA and TEMP must lie inside OMF_AMEX_RECENT_OWNED, so no child can read a real profile' };
  const { findChrome } = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href), chrome = findChrome();
  if (!chrome) return { pass: false, message: 'SETUP no installed Chrome' };
  const keep = async (name, text) => { if (EVIDENCE) await writeFile(path.join(EVIDENCE, `RECENT-${tag}-${name}`), text).catch(() => {}); };
  const work = await mkdtemp(path.join(process.env.OMF_AMEX_NATIVE_TEMP || os.tmpdir(), 'omf-amex-recent-run-'));
  let pass = true; const results = [], measured = { positive: 0, completed: 0, failures: [] };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); } catch (error) { pass = false; lines.push(name + ': RED ' + String(error?.message || error).slice(0, 1800)); } };
  const tests = r => { const out = r.stdout + r.stderr, count = name => Number(new RegExp('^(?:ℹ|#) ' + name + ' (\\d+)', 'm').exec(out)?.[1] ?? 0); return { out, pass: count('pass'), fail: count('fail') }; };
  await leg('P pins', async () => {
    const text = await readFile(SCRIPT, 'utf8'), eol = text.includes('\r\n') ? '\r\n' : '\n', B = await import(pathToFileURL(path.join(root, 'collector', 'browser.mjs')).href), begin = text.indexOf('# policy:begin'), end = text.indexOf('# policy:end');
    const ops = [...text.matchAll(/case "([a-z-]+)":/g)].map(m => m[1]).sort(), recentOps = ['open-recent', 'recent-snapshot', 'recent-download-open', 'recent-csv-state', 'recent-csv-select', 'recent-download'];
    const expected = ['launch', 'wait-ready', 'state', 'login', 'choose', 'next', 'code', 'show', 'open-statement', 'snapshot', 'invoke-period', 'download-open', 'csv-state', 'csv-select', 'download', 'close', ...recentOps].sort();
    const frozen = ['shared/finance-pending.mjs', 'shared/finance-import-overlap.mjs', 'shared/amex.mjs', 'shared/card-import.mjs', 'server/services/financeCompanyPostingService.ts', 'server/services/financeDraftService.ts', 'server/services/financeBillService.ts', 'server/services/financeSyncScheduler.ts', 'server/services/financeOwnerActionService.ts', 'collector/login.mjs', 'collector/mail.mjs', 'collector/vault.mjs', 'collector/bank.mjs', 'collector/aplus.mjs', 'collector/omf-authorization.mjs', 'collector/windows/key-broker.ps1', 'collector/package/stage.mjs'];
    const changed = []; for (const file of frozen) { const before = (await execute('git', ['-C', root, 'show', BASE + ':' + file], { encoding: 'buffer' })).stdout, now = await readFile(path.join(root, file), 'utf8'); if (String(before).replaceAll('\r\n', '\n') !== now.replaceAll('\r\n', '\n')) changed.push(file); }
    const pins = { productionPolicy: text.slice(begin, end) === PRODUCTION_POLICY.join(eol), ascii: !/[^\x00-\x7f]/.test(text), launchList: text.includes(` const string Arguments = "${[...B.PLAIN_LANGUAGE_ARGS].join(' ')}";`), oneCreateProcess: text.split('CreateProcessW(executable').length === 2, noForegroundOrInput: !/SwitchDesktop|SetForegroundWindow|SetFocus\(|SendInput|keybd_event|mouse_event|BlockInput/.test(text), oneExpand: text.split('.Expand()').length === 2, neverCollapse: !text.includes('.Collapse('), exactOperations: JSON.stringify(ops) === JSON.stringify(expected), recentOperationsTakeNoField: recentOps.every(op => new RegExp(`case "${op}": return [A-Za-z]+\\((?:StatementPath|RecentPath)?\\);`).test(text)), noRequestFieldNamesAPath: !/Str\(request, "(url|path|surface|target|selector|script|args?)"\)/.test(text), frozenSourcesUnchanged: !changed.length };
    assert.ok(Object.values(pins).every(Boolean), JSON.stringify({ pins, changed }));
    return 'green ' + JSON.stringify(pins);
  });
  await leg('U suites', async () => {
    const summary = [];
    for (const [file, env] of [[STATEMENT_TEST, {}], [NATIVE_TEST, {}], [RECENT_TEST, {}], ['collector/test/amex-native-setup.test.mjs', {}], ['collector/test/card-background.test.mjs', { OMF_CARD_NATIVE: '0' }], ['scripts/finance-pending.test.mjs', {}]]) {
      const r = await node(['--test', '--test-concurrency=1', file], env), t = tests(r); await keep('U-' + path.basename(file) + '.txt', t.out); summary.push(path.basename(file) + ' ' + t.pass + '/' + (t.pass + t.fail));
      assert.ok(r.code === 0 && t.pass > 0, file + ' RED ' + t.pass + '/' + (t.pass + t.fail) + ': ' + (t.out.match(/^(?:✖|not ok).*$/gm) || []).slice(0, 8).join(' | ') + ' ' + (t.out.match(/amex-recent:[^\s'"]*|recent:[^\s'"]*/g) || []).slice(0, 6).join(' '));
    }
    return summary.join('; ');
  });
  await leg('V the service at module level', async () => { const r = await serviceRun(), out = r.stdout + r.stderr; await keep('V.txt', out); assert.ok(r.code === 0 && /SERVICE GREEN/.test(out), out.slice(-1400)); return (out.match(/^PASS /gm) || []).length + ' checks green'; });
  const servers = await startServers();
  const ctx = { servers, downloads: (await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path"])).stdout.trim(), tag, copy: await policyCopy(work, servers.origins.www, servers.origins.global) };
  const editedCopy = (label, edits) => policyCopy(work, servers.origins.www, servers.origins.global, { edit: text => mutate(text, edits, label) });
  const scenario = async def => { let r; try { r = await runScenario(def, def.helper ? { ...ctx, copy: await editedCopy(def.name, def.helper) } : ctx); if (def.after) Object.assign(r.judgement.checks, def.after(r)), r.judgement.pass = Object.values(r.judgement.checks).every(Boolean); } catch (error) { r = { scenario: def.name, harnessFailure: String(error?.stack || error).slice(0, 600), judgement: { pass: false, checks: {} } }; } return r; };
  try {
    await leg('N the real helper on loopback', async () => {
      const chosen = [...RECENT_SCENARIOS, ...CLOSED].filter(s => !ONLY.length || ONLY.includes(s.name));
      for (const def of chosen) {
        const r = await scenario(def), failed = Object.entries(r.judgement.checks).filter(([, v]) => !v).map(([k]) => k);
        results.push({ scenario: def.name, pass: r.judgement.pass, failed, error: r.result?.error?.message ?? null, harness: r.harnessFailure ?? null });
        await keep('N-' + def.name + '.json', JSON.stringify({ ...r, trace: r.trace?.record ?? null }, null, 2));
        console.error(JSON.stringify(results.at(-1)));
      }
      const red = results.filter(x => !x.pass); assert.ok(!red.length, red.length + ' of ' + results.length + ' RED: ' + JSON.stringify(red).slice(0, 1500));
      return results.length + '/' + results.length + ' green (' + results.filter(x => RECENT_SCENARIOS.some(s => s.name === x.scenario)).length + ' recent, ' + results.filter(x => !RECENT_SCENARIOS.some(s => s.name === x.scenario)).length + ' closed-path siblings)';
    });
    await leg('R measured repeats of the positive recent flows', async () => {
      for (const name of POSITIVE) for (let k = 1; k <= REPEATS; k++) {
        const def = RECENT_SCENARIOS.find(s => s.name === name), r = await scenario({ ...def, name: name + '~' + k }); measured.positive++; if (r.judgement.pass) measured.completed++;
        else measured.failures.push({ scenario: name + '~' + k, failed: Object.entries(r.judgement.checks).filter(([, v]) => !v).map(([x]) => x), error: r.result?.error?.message ?? null, harness: r.harnessFailure ?? null });
        console.error(JSON.stringify({ repeat: name + '~' + k, pass: r.judgement.pass }));
      }
      assert.ok(!measured.failures.length, JSON.stringify(measured.failures).slice(0, 1200));
      return measured.completed + '/' + measured.positive + ' completed (a count of runs on loopback, not a reliability rate)';
    });
  } finally { await servers.close(); }
  await leg('A the built app and its page', async () => {
    if (!existsSync(path.join(root, '.output', 'server', 'index.mjs'))) throw new Error('SETUP the built app is missing: npm run build in this worktree first');
    const api = await node(['scripts/finance-integration.cjs'], { OMF_TEST_RECENT_ONLY: '1' }); await keep('A-recent.txt', api.stdout + api.stderr);
    assert.ok(api.code === 0 && /targeted recent activity checks passed/.test(api.stdout), 'recent API RED: ' + (api.stdout + api.stderr).slice(-1200));
    const browser = await ownedChrome(work);
    try {
      const page = await node(['scripts/finance-integration.cjs'], { OMF_TEST_PENDING_ONLY: '1', OMF_TEST_CHROME_PORT: String(browser.port), ...(EVIDENCE ? { OMF_TEST_SCREENSHOT: path.join(EVIDENCE, `RECENT-${tag}-page.png`) } : {}) }); await keep('A-pending.txt', page.stdout + page.stderr);
      assert.ok(page.code === 0 && /targeted pending checks passed/.test(page.stdout), 'pending API and page RED: ' + (page.stdout + page.stderr).slice(-1200));
      return (api.stdout.match(/^PASS /gm) || []).length + ' recent API groups and ' + (page.stdout.match(/^PASS /gm) || []).length + ' pending API and page groups green';
    } finally { await browser.stop(); }
  });
  await leg('M reintroduced defects', async () => {
    const chosen = list => list.filter(d => !MUTANTS.length || MUTANTS.includes(d[0])), caught = [], missed = [], receipts = [];
    const record = (label, hit, detail) => { (hit ? caught : missed).push(label + (hit ? '' : ': ' + detail)); receipts.push({ label, caught: hit, detail: String(detail).slice(0, 300) }); console.error(JSON.stringify({ mutant: label, caught: hit })); };
    // helper: each through the scenario named after it, whose unchanged run is its control
    const needed = [...new Set(chosen(NATIVE_DEFECTS).map(d => d[2]))], all = [...RECENT_SCENARIOS, ...SCENARIOS];
    if (needed.length) {
      const servers2 = await startServers(), ctx2 = { ...ctx, servers: servers2, copy: await policyCopy(work, servers2.origins.www, servers2.origins.global), tag: tag + '-M' };
      const copied = (label, edits) => policyCopy(work, servers2.origins.www, servers2.origins.global, { edit: text => mutate(text, edits, label) });
      try {
        const controls = new Map();
        for (const name of needed) { const def = all.find(s => s.name === name), r = await runScenario(def, def.helper ? { ...ctx2, copy: await copied(name, def.helper) } : ctx2); controls.set(name, r.judgement.pass); }
        for (const [label, edits, name] of chosen(NATIVE_DEFECTS)) {
          if (!controls.get(name)) { record(label, false, 'its control ' + name + ' was not green'); continue; }
          const def = all.find(s => s.name === name), copy = await copied(label, [...(def.helper ?? []), ...edits]);
          const r = await runScenario({ ...def, name: name + '~' + label }, { ...ctx2, copy }), failed = Object.entries(r.judgement.checks).filter(([, v]) => !v).map(([k]) => k);
          record(label, !r.judgement.pass, 'failed checks: ' + (failed.join('+') || 'none') + ' ' + (r.result?.error?.message ?? ''));
        }
      } finally { await servers2.close(); }
    }
    // adapter, statement rules and collector: the unit suite on the unchanged copy (its control), then on each defect's copy
    const unit = async (file, env, pattern) => { const r = await node(['--test', '--test-concurrency=1', ...(pattern ? ['--test-name-pattern=' + pattern] : []), file], env); return { code: r.code, out: r.stdout + r.stderr }; };
    if (chosen(ADAPTER_DEFECTS).length) {
      const source = await readFile(path.join(root, NATIVE_MODULE), 'utf8');
      const control = await unit(NATIVE_TEST, {}, 'recent|closed job'); assert.equal(control.code, 0, 'the adapter control failed: ' + control.out.slice(-400));
      for (const [label, edits, expected] of chosen(ADAPTER_DEFECTS)) await withCopy(NATIVE_MODULE, label, mutate(source, edits, label), async copy => { const r = await unit(NATIVE_TEST, { OMF_TEST_NATIVE_MODULE: copy }, 'recent|closed job'); record(label, r.code !== 0 && expected.test(r.out), 'exit ' + r.code + ' ' + (r.out.match(/amex-recent:[^\s'"]*/g) || []).slice(0, 4).join(' ')); });
    }
    if (chosen(STATEMENT_DEFECTS).length) {
      const source = await readFile(path.join(root, STATEMENT_MODULE), 'utf8'), control = await unit(STATEMENT_TEST, {}); assert.equal(control.code, 0, 'the statement control failed: ' + control.out.slice(-400));
      for (const [label, edits, expected] of chosen(STATEMENT_DEFECTS)) await withCopy(STATEMENT_MODULE, label, mutate(source, edits, label), async copy => { const r = await unit(STATEMENT_TEST, { OMF_TEST_STATEMENT_MODULE: copy }); record(label, r.code !== 0 && expected.test(r.out), 'exit ' + r.code + ' ' + (r.out.match(/amex-recent:[^\s'"]*/g) || []).slice(0, 4).join(' ')); });
    }
    if (chosen(COLLECTOR_DEFECTS).length) {
      const control = await unit(RECENT_TEST, {}); assert.equal(control.code, 0, 'the collector control failed: ' + control.out.slice(-400));
      for (const [label, file, edits, expected] of chosen(COLLECTOR_DEFECTS)) {
        const text = mutate(await readFile(path.join(root, file), 'utf8'), edits, label);
        const judge = r => record(label, r.code !== 0 && expected.test(r.out), 'exit ' + r.code + ' ' + (r.out.match(/amex-recent:[^\s'"]*/g) || []).slice(0, 4).join(' '));
        await withCopy(file, label, text, async copy => {
          if (file === INDEX_MODULE) return judge(await unit(RECENT_TEST, { OMF_TEST_INDEX_MODULE: copy }));
          const routed = mutate(await readFile(path.join(root, INDEX_MODULE), 'utf8'), [["from './browser.mjs';", "from './" + path.basename(copy) + "';"]], label + ' route');
          return withCopy(INDEX_MODULE, label, routed, async indexCopy => judge(await unit(RECENT_TEST, { OMF_TEST_INDEX_MODULE: indexCopy })));
        });
      }
    }
    if (chosen(SERVER_DEFECTS).length) {
      const control = await serviceRun(); assert.ok(control.code === 0, 'the service control failed: ' + (control.stdout + control.stderr).slice(-400));
      for (const [label, file, edits, expected] of chosen(SERVER_DEFECTS)) await withTree(label.split('-')[0], file, mutate(await readFile(path.join(root, file), 'utf8'), edits, label), async dir => { const r = await serviceRun({ OMF_RECENT_SRC: dir }), out = r.stdout + r.stderr; record(label, r.code !== 0 && expected.test(out), 'exit ' + r.code + ' ' + (out.match(/recent-service:[^\r\n]*/g) || []).slice(0, 3).join(' | ')); });
    }
    await keep('M.json', JSON.stringify(receipts, null, 2));
    assert.ok(!missed.length, missed.length + ' of ' + receipts.length + ' not caught: ' + missed.join(' | ').slice(0, 1500));
    return caught.length + '/' + receipts.length + ' caught, each after its unchanged control';
  });
  const summary = { tag, chrome, isolation, results, measured, lines, pass };
  await keep('SUMMARY.json', JSON.stringify(summary, null, 2));
  await rm(work, { recursive: true, force: true }).catch(() => {});
  return { pass, measured, results, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's' + (PARTIAL ? ' (PARTIAL development run — no coverage exported)' : '') + '\n' + lines.join('\n') };
} };
export default fixture;

if (process.argv.includes('--service')) await service().catch(error => { console.error(String(error?.stack || error)); process.exit(1); }).then(() => process.exit(0));

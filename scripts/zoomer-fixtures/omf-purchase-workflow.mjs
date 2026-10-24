// Fixture for plan omf-workflow-daily-20261025 Phase C (B1): purchase evidence reaches the reviewed bank 仕訳 and the registered
// Transaction. The whole owner path is driven through the real routes: an Excel upload with the exact export headers → mapping and a
// reusable template → per-purchase seller research by a fictional connected worker with official-shaped (clearly synthetic) NTA registry
// evidence → explicit confirmation → bank CSV import → explicit allocation (single, split, combined, refund, partial, card repayment) →
// bank classification review → optional explicit adoption → explicit registration (exactly one Transaction).
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-purchase-workflow.mjs --cwd <this worktree>
// Evidence, stated exactly: synthetic only. Fictional owners, companies, sellers, T numbers, files, bank rows and worker on an owned
// mongodb-memory-server. No NTA request, no bank, no network (Chrome aborts every request outside the owned app), no credential, vault,
// model or production database. Nothing here is the owner's real purchase file/month or a real registry check: those stay pending.
// Legs:
//   U  node --test scripts/finance-bank-classification.test.mjs (the pure adoption/currency rules).
//   S  the real services and routes (h3) under tsx on the owned MongoDB (this file, --omf-purchase-workflow-harness): S0 registered
//      provenance on the manual path · S1 the full chain with explicit adoption · S2 visible-but-not-adoptable cases and the manual exit ·
//      S3 marketplace vs actual seller · S4 manual edits and stale purchase/research/allocation/source · S5 registration retry, concurrency,
//      crash, release and reassignment (one ledger effect, frozen evidence) · S6 other owner / other company · S7 history and teaching
//      isolation · S8 legacy rows and a card repayment · S9 an unreadable purchase projection never blocks.
//   C  owned headless Chrome on the built app (390/1440 px, dark): the linked purchases on the existing review, explicit adoption.
//   R  existing suites on the changed modules: bank classification integration (built app) and payment matching.
//   M  deliberately reintroduced defects in copies of server/ and shared/, each must fail its named S assertion.
// Fail-first: OMF_PURCHASE_SRC points leg S at another server/shared tree; OMF_PURCHASE_ONLY selects legs; OMF_PURCHASE_EVIDENCE keeps
// leg logs and screenshots.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const timeoutMs = 3000000;
const SELF = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(SELF), '..', '..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = v => createHash('sha256').update(v).digest('hex');
const HARNESS_FLAG = '--omf-purchase-workflow-harness';
const COVERS = ['server/services/financeBankClassificationService.ts', 'server/models/FinanceBankClassification.ts', 'server/services/financePaymentMatchService.ts', 'shared/finance-bank-classification.mjs', 'shared/finance-bank-classification.d.mts', 'components/intake/BankClassificationReview.vue', 'shared/finance-intake.mjs', 'scripts/finance-bank-classification.test.mjs', 'scripts/finance-bank-classification-integration.cjs', 'docs/purchase-bookkeeping-evidence.md', 'scripts/zoomer-fixtures/omf-purchase-workflow.mjs'];
const BINARY = path.join(root, '..', 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
const EVIDENCE = process.env.OMF_PURCHASE_EVIDENCE || '';
const ONLY = (process.env.OMF_PURCHASE_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const OUTPUT_ROOT = process.env.OMF_PURCHASE_OUTPUT ? path.resolve(process.env.OMF_PURCHASE_OUTPUT) : root;
const SRC_ROOT = process.env.OMF_PURCHASE_SRC ? path.resolve(process.env.OMF_PURCHASE_SRC) : root;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ════════════════════════════ The fictional world, built only through the owner's routes ════════════════════════════
// Purchases (the exact requested export headers; 購入日/購入金額 beside them; one owner-named extra column). Every seller, T number and
// URL is fictional; .invalid hosts never resolve.
const HEAD = ['orderno', 'itemseqno', 'externalorderno', 'website URL', 'itemprice', 'tax', 'shipping', 'otherfee', '購入日', '購入金額', '担当者'];
const PURCHASES = [
  // key, orderno, itemseqno, external, url, price, tax, shipping, otherfee, date, amount
  ['P1', '000101', '01', 'EXT-101', 'https://seller-one.example.invalid/items/101', '5000', '500', '', '', '2026-10-01', '5500'],
  ['P2', '000102', '01', 'EXT-102', 'https://seller-two.example.invalid/items/102', '5000', '500', '0', '0', '2026-10-02', '5500'],
  ['P3', '000103', '01', 'EXT-103', 'https://seller-three.example.invalid/i/103', '2700', '300', '', '', '2026-10-03', '3000'],
  ['P4', '000104', '01', 'EXT-104', 'https://seller-four.example.invalid/i/104', '4500', '500', '', '', '2026-10-03', '5000'],
  ['P5', '000105', '01', 'EXT-105', 'https://seller-five.example.invalid/i/105', '1000', '100', '100', '0', '2026-10-04', '1200'],
  ['P6', '000106', '01', 'EXT-106', 'https://seller-six.example.invalid/i/106', '2000', '200', '', '', '2026-10-05', '2200'],
  ['P7', '000107', '01', 'EXT-107', 'https://market.example.invalid/listing/107', '3000', '300', '', '', '2026-10-06', '3300'],
  ['P8', '000108', '01', 'EXT-108', 'https://market.example.invalid/listing/108', '7000', '700', '', '', '2026-10-06', '7700'],
  ['P9', '000109', '01', 'EXT-109', 'https://seller-nine.example.invalid/i/109', '4000', '400', '', '', '2026-10-07', '4400'],
  ['P10', '000110', '01', 'EXT-110', 'https://seller-ten.example.invalid/i/110', '1000', '100', '', '', '', '1100'],
  ['P11', '000111', '01', 'EXT-111', 'https://seller-eleven.example.invalid/i/111', '', '', '', '', '2026-10-09', ''],
  ['P12', '000112', '01', 'EXT-112', 'https://seller-twelve.example.invalid/i/112', '6000', '600', '', '', '2026-10-10', '6600'],
  ['P13', '000113', '01', 'EXT-113', 'https://seller-thirteen.example.invalid/i/113', '1200', '100', '', '', '2026-10-10', '1300'],
  ['P14', '000114', '01', 'EXT-114', 'https://seller-fourteen.example.invalid/i/114', '4000', '', '', '', '2026-10-11', '4000'],
  ['P15', '000115', '01', 'EXT-115', 'https://seller-fifteen.example.invalid/i/115', '1500', '150', '', '', '2026-10-11', '1650'],
  ['P16', '000116', '01', 'EXT-116', 'https://seller-sixteen.example.invalid/i/116', '1600', '160', '', '', '2026-10-11', '1760'],
  ['P17', '000117', '01', 'EXT-117', 'https://seller-seventeen.example.invalid/i/117', '1700', '170', '', '', '2026-10-11', '1870']
];
// key → [legal name, report T number, registry number (≠ report: mismatch), registry legal name (≠: mismatch)]
const SELLERS = {
  P1: ['カクウセラーワン株式会社', 'T1000000000001'], P2: ['カクウセラーツー株式会社', 'T1000000000002'], P3: ['カクウセラースリー合同会社', 'T1000000000003'],
  P4: ['カクウセラーフォー株式会社', 'T1000000000004'], P5: ['カクウセラーファイブ株式会社', 'T1000000000005'],
  P6: ['カクウセラーシックス株式会社', 'T1000000000006', 'T1000000000066'], P8: ['カクウセラーエイト合同会社', 'T1000000000008'],
  P9: ['カクウセラーナイン株式会社', 'T1000000000009'], P10: ['カクウセラーテン株式会社', 'T1000000000010'], P12: ['カクウセラートゥエルブ株式会社', 'T1000000000012'],
  P13: ['カクウセラーサーティーン株式会社', 'T1000000000013', null, 'カクウ別会社株式会社'], P15: ['カクウセラーフィフティーン株式会社', 'T1000000000015'],
  P16: ['カクウセラーシックスティーン株式会社', 'T1000000000016'], P17: ['カクウセラーセブンティーン株式会社', 'T1000000000017']
};
const MARKETPLACE = ['カクウマーケットプレイス株式会社（架空）', 'T9000000000009'];
// Bank rows (取引日, 摘要, 出金, 入金, 残高, メモ) and what the owner allocates each to.
const BANK_HEAD = ['取引日', '摘要', '出金', '入金', '残高', 'メモ'];
const BANK = [
  ['B1', '2026/10/02', 'フリコミ カクウセラーワン', 5500, 0], ['B2a', '2026/10/03', 'カクウセラーツー 1', 3000, 0], ['B2b', '2026/10/04', 'カクウセラーツー 2', 2500, 0],
  ['B3', '2026/10/04', 'カクウ マトメバライ', 8000, 0], ['B5o', '2026/10/05', 'カクウセラーファイブ', 1200, 0], ['B5r', '2026/10/12', 'カクウセラーファイブ ヘンキン', 0, 1200],
  ['B6', '2026/10/06', 'カクウセラーシックス', 2200, 0], ['B7', '2026/10/07', 'カクウマーケット 107', 3300, 0], ['B8', '2026/10/07', 'カクウマーケット 108', 7700, 0],
  ['B9', '2026/10/08', 'カクウセラーナイン', 4400, 0], ['B10', '2026/10/08', 'カクウセラーテン', 1100, 0], ['B11', '2026/10/09', 'カクウセラーイレブン', 999, 0],
  ['B12', '2026/10/10', 'カクウセラートゥエルブ', 6600, 0], ['B13', '2026/10/10', 'カクウセラーサーティーン', 1300, 0], ['B14', '2026/10/11', 'カクウセラーフォーティーン', 9000, 0],
  ['B15', '2026/10/11', 'カクウセラーフィフティーン', 1650, 0], ['B16', '2026/10/11', 'カクウセラーシックスティーン', 1760, 0], ['B17', '2026/10/11', 'カクウセラーセブンティーン', 1870, 0],
  ['B0', '2026/10/13', 'カクウ ジムヒン', 770, 0], ['BA', '2026/10/10', 'AMEX', 30000, 0], ['B1later', '2026/10/20', 'フリコミ カクウセラーワン', 2000, 0]
];
const ALLOCATE = [['B1', 'P1', 5500], ['B2a', 'P2', 3000], ['B2b', 'P2', 2500], ['B3', 'P3', 3000], ['B3', 'P4', 5000], ['B5o', 'P5', 1200], ['B5r', 'P5', -1200], ['B6', 'P6', 2200], ['B7', 'P7', 3300], ['B8', 'P8', 7700], ['B9', 'P9', 4400], ['B10', 'P10', 1100], ['B11', 'P11', 999], ['B12', 'P12', 6600], ['B13', 'P13', 1300], ['B14', 'P14', 4000], ['B15', 'P15', 1650], ['B16', 'P16', 1760], ['B17', 'P17', 1870]];

// ctx: { call(route, { method, token, body, type }), db (native driver Db), ObjectId, session(tag) → { id, token, email, password, forOrg(orgId) } }
async function buildWorld(ctx, label) {
  const { call, db, ObjectId, session } = ctx, XLSX = requireRoot('xlsx');
  const ok = (r, l) => { assert.equal(r.status, 200, 'SETUP ' + l + ' ' + JSON.stringify(r.data).slice(0, 600)); return r.data; };
  const owner = await session('owner-' + label), other = await session('other-' + label), now = new Date();
  const A = new ObjectId(), B = new ObjectId(), C = new ObjectId();
  await db.collection('organizations').insertMany([[A, 'カクウ商店（架空）', owner.id], [B, 'Synthetic second company', owner.id], [C, 'Synthetic other owner company', other.id]].map(([_id, name, userId]) => ({ _id, name, slug: 'pw-' + String(_id), type: 'business', isActive: true, members: [{ userId: new ObjectId(userId), role: 'owner', joinedAt: now }], settings: { defaultCurrency: 'JPY' }, createdAt: now, updatedAt: now })));
  const tA = await owner.forOrg(A), tB = await owner.forOrg(B), tC = await other.forOrg(C);
  const chart = {}; for (const [name, type] of [['仕入高', 'expense'], ['消耗品費', 'expense'], ['支払手数料', 'expense'], ['普通預金', 'asset'], ['未払金', 'liability']]) { chart[name] = new ObjectId(); await db.collection('accountcategories').insertOne({ _id: chart[name], name, type, isActive: true, order: 0 }); }
  // A pre-existing global Supplier with another number (the owner may select it; adoption never creates one).
  const otherSupplier = new ObjectId(); await db.collection('suppliers').insertOne({ _id: otherSupplier, name: 'Synthetic existing supplier', companyName: 'Synthetic existing supplier 株式会社', invoiceNumber: 'T5555555555555', createdAt: now, updatedAt: now });
  // An already-stored Supplier with exactly P15's number and legal name (adoption may select it), and a decoy with P1's number under another name (never selected).
  const exactSupplier = new ObjectId(); await db.collection('suppliers').insertMany([{ _id: exactSupplier, name: 'カクウセラーフィフティーン', companyName: 'カクウセラーフィフティーン株式会社', invoiceNumber: 'T1000000000015', createdAt: now, updatedAt: now }, { _id: new ObjectId(), name: 'Decoy', companyName: '別名のテスト会社', invoiceNumber: 'T1000000000001', createdAt: now, updatedAt: now }]);
  const I = (r, o = {}) => call('/api/finance-intake/' + r, { token: owner.token, ...o }), P = (r, o = {}) => call('/api/finance-payments/' + r, { token: owner.token, ...o });
  // The fictional research worker (an existing card account is the worker's required scope).
  const card = ok(await call('/api/finance/accounts', { method: 'POST', token: owner.token, body: { name: 'Synthetic card (fictional)', primaryCard: '12345', cardIdentifiers: ['12345'], otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' } }), 'card account').account;
  const agent = ok(await call('/api/finance-chat/agents', { method: 'POST', token: owner.token, body: { accountIds: [card._id], researchEnabled: true } }), 'research worker');
  const W = (r, body = {}) => call('/api/finance-research/worker/' + r, { method: 'POST', token: agent.token, body });
  ok(await W('status', { settingsUrl: 'http://127.0.0.1:54321/setup/' + 'a'.repeat(64), ntaConfigured: true, intakeResearch: true }), 'worker status');
  // ── purchases: upload → guessed mapping (orderno/itemseqno) → import with a saved template → the same file again through the template ──
  const sheetRows = PURCHASES.map(([k, ...v]) => [...v.slice(0, 10), 'Synthetic staff ' + k]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...sheetRows]), 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileHash = sha256(bytes);
  const doc = ok(await I('files?name=synthetic-purchases.xlsx', { method: 'POST', body: bytes, type: XLSX_TYPE }), 'upload').document;
  const sheet = ok(await I('files/' + doc.id + '/sheet?sheet=Sheet1&headerRow=1'), 'sheet');
  assert.deepEqual([sheet.mapping.orderId, sheet.mapping.itemId, sheet.mapping.externalOrderId, sheet.mapping.merchantUrl, sheet.mapping.purchaseDate, sheet.mapping.amount], ['0', '1', '2', '3', '8', '9'], 'purchase:exact-headers-guessed');
  assert.equal(sheet.rows[0][0], '000101', 'purchase:leading-zeros-read');
  const plan = { sheet: 'Sheet1', headerRow: 1, mapping: sheet.mapping, defaults: { service: 'カクウ受付', account: 'main', currency: 'JPY' }, extras: [{ name: '担当者', column: '10' }] };
  const imported = ok(await I('files/' + doc.id + '/import', { method: 'POST', body: { ...plan, template: { name: 'Synthetic purchase export' } } }), 'import');
  assert.equal(imported.batch.counts.new, PURCHASES.length, 'purchase:imported');
  const template = ok(await I('templates'), 'templates').templates.find(t => t.name === 'Synthetic purchase export'); assert.ok(template, 'purchase:template-saved');
  const again = ok(await I('files/' + doc.id + '/import', { method: 'POST', body: { sheet: 'Sheet1', headerRow: 1, mapping: template.mapping, defaults: plan.defaults, extras: template.extras } }), 'reimport by template');
  assert.deepEqual([again.batch.counts.new, again.batch.counts.unchanged], [0, PURCHASES.length], 'purchase:template-reimport-unchanged');
  const all = ok(await I('records'), 'records').records, rec = {};
  for (const [k, orderId] of PURCHASES) { rec[k] = all.find(r => r.values.orderId === orderId); assert.ok(rec[k], 'record ' + k); }
  assert.deepEqual([rec.P11.values.amount, rec.P11.values.tax, rec.P1.values.shippingFee, rec.P2.values.shippingFee], ['', '', '', '0'], 'purchase:unknown-and-zero-costs-kept');
  const readRecord = async k => (rec[k] = ok(await I('records/' + rec[k].id), 'read ' + k));
  // ── seller research per purchase, through the worker routes; then the owner's explicit confirmation ──
  async function research(k, { legalName, number, registryNumber = number, registryName = legalName, url } = {}) {
    await readRecord(k);
    const before = ok(await I('records/' + rec[k].id + '/research'), 'research view ' + k);
    ok(await I('records/' + rec[k].id + '/research', { method: 'POST', body: { revision: rec[k].revision, researchRevision: before.research?.revision ?? 0, requestId: randomUUID(), instruction: '' } }), 'queue ' + k);
    const job = ok(await W('intake/claim'), 'claim ' + k).job; assert.ok(job, 'claimed ' + k);
    const pageText = `${legalName} 特定商取引法に基づく表記 登録番号 ${number}（架空のテスト用ページ）`, at = new Date().toISOString();
    const web = { id: 's1', kind: 'web', title: legalName + ' 会社概要（架空）', url: url || new URL('/company', rec[k].values.merchantUrl).href, text: pageText, hash: sha256(pageText), capturedAt: at };
    const registryText = JSON.stringify({ count: '1', announcement: [{ registratedNumber: registryNumber, name: registryName, registrationDate: '2023-10-01', disposalDate: '', expireDate: '', address: '架空の所在地（テスト用・実在しません）' }] });
    const registry = { id: 's2', kind: 'registry', title: '国税庁 登録番号・基準日照合（架空のテスト用応答）', url: 'https://web-api.invoice-kohyo.nta.go.jp/1/valid', text: registryText, hash: sha256(registryText), capturedAt: at };
    const report = { summary: '会社名と登録番号を確認しました（架空）。', question: '', findings: [], supplier: { shopName: legalName, legalName, invoiceNumber: number, citations: [{ sourceId: 's1', quote: pageText }] } };
    ok(await W('intake/' + job.id + '/result', { lease: job.lease, sources: [...job.sources, web, registry], report, registry: { sourceId: 's2', number: registryNumber, date: job.context.source.purchaseDate } }), 'result ' + k);
    const ready = ok(await I('records/' + rec[k].id + '/research'), 'ready ' + k); await readRecord(k);
    const confirmed = ok(await I('records/' + rec[k].id + '/research/confirm', { method: 'POST', body: { revision: rec[k].revision, researchRevision: ready.research.revision, confirm: true } }), 'confirm ' + k);
    rec[k] = confirmed.record; return confirmed;
  }
  for (const [k, [legalName, number, registryNumber, registryName]] of Object.entries(SELLERS)) await research(k, { legalName, number, registryNumber: registryNumber || number, registryName: registryName || legalName, url: k === 'P8' ? 'https://seller-eight.example.invalid/tokushoho' : undefined });
  // P7: the marketplace's name and a 13-digit corporate number typed by hand (no research): never a verified seller T number.
  await readRecord('P7'); rec.P7 = ok(await I('records/' + rec.P7.id, { method: 'PATCH', body: { revision: rec.P7.revision, values: { supplierName: MARKETPLACE[0], invoiceNumber: '1234567890123' } } }), 'P7 typed');
  // ── the bank account and its CSV ──
  const bank = ok(await P('bank/accounts', { method: 'POST', body: { name: 'Synthetic business bank (fictional)', currency: 'JPY' } }), 'bank account').account;
  let balance = 1000000; const csvRows = BANK.map(([, d, desc, out, inn]) => { balance += inn - out; return [d, desc, out ? String(out) : '', inn ? String(inn) : '', String(balance), '']; });
  const csv = Buffer.from([BANK_HEAD, ...csvRows].map(r => r.map(s => '"' + String(s).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
  const bdoc = ok(await P('bank/files?name=synthetic-bank.csv', { method: 'POST', body: csv, type: 'text/csv' }), 'bank file').document, bsheet = ok(await P('bank/files/' + bdoc.id + '/sheet'), 'bank sheet');
  ok(await P('bank/files/' + bdoc.id + '/import', { method: 'POST', body: { sheet: bsheet.sheet, headerRow: bsheet.headerRow, mapping: bsheet.mapping, bankAccountId: bank.id, transactionIdConfirmed: true, confirm: true } }), 'bank import');
  const payments = async () => ok(await P('payments?account=bank:' + bank.id), 'payments').payments;
  const rowIds = {}; { const list = await payments(); for (const [k, , desc] of BANK) { const found = list.filter(p => p.description === desc.normalize('NFKC')); const p = k === 'B1later' ? found.find(x => x.date === '2026-10-20') : k === 'B1' ? found.find(x => x.date === '2026-10-02') : found[0]; assert.ok(p, 'bank row ' + k); rowIds[k] = p.bankRowId; } }
  const paymentOf = async k => ok(await P('payments/bank/' + rowIds[k]), 'payment ' + k);
  async function allocate(k, recordKey, amount) {
    const v = await paymentOf(k); await readRecord(recordKey);
    return ok(await P('payments/bank/' + rowIds[k] + '/allocations', { method: 'POST', body: { confirm: true, requestId: randomUUID(), paymentRevision: v.payment.paymentRevision, target: { kind: 'intake', recordId: rec[recordKey].id }, recordRevision: rec[recordKey].revision, amount } }), 'allocate ' + k + '→' + recordKey);
  }
  for (const [k, r, amount] of ALLOCATE) await allocate(k, r, amount);
  // ── a card repayment: an Amex statement with its 口座振替 line, settled from the AMEX bank row (never a purchase expense) ──
  const { HEADERS } = await import(pathToFileURL(path.join(root, 'shared/amex.mjs')).href), amexRow = c => Object.assign(['2026/09/20', '2026/09/22', 'Synthetic card shop', 'Test user', '12345', '30000', '', ''], c);
  const amexCsv = Buffer.from([HEADERS, amexRow({}), amexRow({ 0: '2026/10/10', 1: '2026/10/10', 2: '前回分口座振替金額', 5: '-30000' })].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
  ok(await call('/api/finance/accounts/' + card._id + '/imports?kind=statement&start=2026-09-11&end=2026-10-10', { method: 'POST', token: owner.token, body: amexCsv, type: 'text/csv' }), 'amex statement');
  { const v = await paymentOf('BA'), repayment = v.settlements.find(s => s.target.kind === 'card-repayment'); assert.ok(repayment, 'SETUP card repayment proposal ' + JSON.stringify(v.settlements).slice(0, 300));
    ok(await P('payments/bank/' + rowIds.BA + '/allocations', { method: 'POST', body: { confirm: true, requestId: randomUUID(), paymentRevision: v.payment.paymentRevision, amount: 30000, target: repayment.target, note: 'fictional repayment' } }), 'card repayment'); }
  // ── another owner with a purchase allocated to their own bank row (must never appear for the first owner) ──
  const O = (r, o = {}) => call('/api/finance-payments/' + r, { token: other.token, ...o });
  const otherRec = ok(await call('/api/finance-intake/records', { method: 'POST', token: other.token, body: { values: { orderId: '000101', description: 'Other owner purchase', amount: '5500', purchaseDate: '2026-10-01', supplierName: 'Other owner seller', invoiceNumber: 'T7777777777777' } } }), 'other record');
  const otherBank = ok(await O('bank/accounts', { method: 'POST', body: { name: 'Other owner bank', currency: 'JPY' } }), 'other bank').account;
  const ocsv = Buffer.from([BANK_HEAD, ['2026/10/02', 'フリコミ カクウセラーワン', '5500', '', '10000', '']].map(r => r.map(s => '"' + s + '"').join(',')).join('\r\n'));
  const odoc = ok(await O('bank/files?name=other.csv', { method: 'POST', body: ocsv, type: 'text/csv' }), 'other bank file').document, osheet = ok(await O('bank/files/' + odoc.id + '/sheet'), 'other sheet');
  ok(await O('bank/files/' + odoc.id + '/import', { method: 'POST', body: { sheet: osheet.sheet, headerRow: osheet.headerRow, mapping: osheet.mapping, bankAccountId: otherBank.id, transactionIdConfirmed: true, confirm: true } }), 'other import');
  const op = ok(await O('payments?account=bank:' + otherBank.id), 'other payments').payments[0];
  ok(await O('payments/bank/' + op.bankRowId + '/allocations', { method: 'POST', body: { confirm: true, requestId: randomUUID(), paymentRevision: op.paymentRevision, target: { kind: 'intake', recordId: otherRec.id }, recordRevision: otherRec.revision, amount: 5500 } }), 'other allocation');
  return { owner, other, A, B, C, tA, tB, tC, chart, otherSupplier, exactSupplier, card, agent, W, I, P, O, research, readRecord, rec, bank, rowIds, paymentOf, allocate, fileHash, doc, otherBank, otherRec };
}

// The classification helpers over a world (company A unless another token is given).
function classificationOf(w, call) {
  const ok = (r, l) => { assert.equal(r.status, 200, l + ' ' + JSON.stringify(r.data).slice(0, 700)); return r.data; };
  const cls = '/api/finance-payments/bank-classifications';
  const list = (t = w.tA) => call(cls + '?account=' + w.bank.id, { token: t });
  const generate = async (t = w.tA) => ok(await call(cls + '/generate', { method: 'POST', token: t, body: { bankAccountId: w.bank.id } }), 'generate');
  const row = async (k, t = w.tA) => { const d = ok(await list(t), 'list'); const r = d.rows.find(x => x.rowId === w.rowIds[k]); assert.ok(r, 'row ' + k); return r; };
  const put = (draft, body, t = w.tA) => call(cls + '/' + draft.id, { method: 'PUT', token: t, body });
  const register = (draft, body, t = w.tA) => call(cls + '/' + draft.id + '/register', { method: 'POST', token: t, body });
  const adopt = (draft, link, t = w.tA) => put(draft, { revision: draft.revision, adoptPurchase: { allocationId: link.allocationId, recordId: link.record.id, recordRevision: link.record.revision } }, t);
  const decide = async (k, values = {}) => { const r = await row(k); return ok(await put(r.draft, { revision: r.draft.revision, values: { purpose: '仕入', accountCategoryId: String(w.chart['仕入高']), ...values } }), 'decide ' + k).row; };
  const tx = (db, draft) => db.collection('transactions').findOne({ 'metadata.bankClassificationId': draft.id });
  return { ok, list, generate, row, put, register, adopt, decide, tx, cls };
}

// ════════════════════════════ S: the services and routes under tsx (child process) ════════════════════════════
async function harnessMain(SRC) {
  const u = p => pathToFileURL(path.join(SRC, p)).href;
  const base = String(process.env.OMF_PURCHASE_MONGO_URI || ''), dbName = String(process.env.OMF_PURCHASE_DB || '');
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(base) || /:27017\/?$/.test(base) || !/^omf_purchase_[a-z0-9_]+$/.test(dbName)) { console.log('SETUP refused: not an owned ephemeral database address'); process.exit(3); }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omf-purchase-harness-'));
  Object.assign(process.env, { MONGO_URI: base.replace(/\/?$/, '/') + dbName, JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', OMF_DATA_DIR: path.join(temp, 'data'), OMF_COLLECTOR_DIR: path.join(temp, 'collector') });
  let m;
  try {
    const mongoose = (await import('mongoose')).default, jwt = (await import('jsonwebtoken')).default, h3 = await import('h3'), http = await import('node:http');
    m = { mongoose, jwt, h3, http, User: (await import(u('server/models/User.ts'))).default, auth: (await import(u('server/middleware/auth.ts'))).default,
      routes: { intake: (await import(u('server/api/finance-intake/[...path].ts'))).default, research: (await import(u('server/api/finance-research/[...path].ts'))).default, payments: (await import(u('server/api/finance-payments/[...path].ts'))).default, finance: (await import(u('server/api/finance/[...path].ts'))).default, chat: (await import(u('server/api/finance-chat/[...path].ts'))).default } };
  } catch (e) { console.log('SETUP module unavailable: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)); process.exit(3); }
  const { mongoose, jwt, h3, User } = m;
  await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, dbName);
  const app = h3.createApp(); app.use(m.auth);
  const prefix = [['/api/finance-intake/', 'intake'], ['/api/finance-research/', 'research'], ['/api/finance-payments/', 'payments'], ['/api/finance-chat/', 'chat'], ['/api/finance/', 'finance']];
  app.use(h3.defineEventHandler(e => { const hit = prefix.find(([p]) => e.path.startsWith(p)); return hit ? m.routes[hit[1]](e) : undefined; }));
  const server = m.http.createServer(h3.toNodeListener(app)); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, { method = 'GET', token, body, type } = {}) => { const raw = Buffer.isBuffer(body); const r = await fetch(origin + route, { method, headers: { 'Content-Type': raw ? (type || 'application/octet-stream') : 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(60000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  const sign = (id, email, organizationId) => jwt.sign({ userId: id, email, type: 'access', jti: randomUUID(), ...(organizationId ? { organizationId: String(organizationId) } : {}) }, process.env.JWT_SECRET, { expiresIn: '3h' });
  const session = async tag => { const email = 'purchase-' + tag + '@example.invalid', user = await User.create({ email, name: 'Synthetic ' + tag, password: 'Synthetic-only-Strong-Password1!' }), id = String(user._id); return { id, email, token: sign(id, email), forOrg: async org => sign(id, email, org) }; };
  const db = mongoose.connection.db, { ObjectId } = mongoose.Types;
  let checks = 0, failed = 0, w, c; const only = (process.env.OMF_PURCHASE_ONLY_S || '').split(',').filter(Boolean);
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (only.length && !only.includes(key)) return; try { await fn(); checks++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1200) + ' @line ' + ((String(e?.stack || '').match(/omf-purchase-workflow\.mjs:(\d+)/) || [])[1] || '?')); } };
  try { w = await buildWorld({ call, db, ObjectId, session }, 's'); c = classificationOf(w, call); await c.generate(); }
  catch (e) { console.log('SETUP fictional world: ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 900)); process.exit(3); }
  const { ok, row, put, register, adopt, decide, tx } = c, txCount = filter => db.collection('transactions').countDocuments(filter);
  const linkOf = (r, recordKey) => (r.purchases?.links || []).find(l => l.record?.id === w.rec[recordKey].id);

  await leg('S0 registered output on the manual path: a row allocated to a purchase, decided by hand (no adoption) and registered, carries the purchase, its allocation, research and registry basis in the Transaction; the T label stays the legacy one', async () => {
    const d = await decide('B14'), reg = ok(await register(d.draft, { revision: d.draft.revision, action: 'create', confirm: true }), 'register B14');
    const t = await tx(db, d.draft); assert.equal(String(t._id), reg.transaction.id);
    const frozen = t.metadata.purchaseLinks; assert.ok(Array.isArray(frozen) && frozen.length === 1, 'purchase:ledger-provenance (Transaction metadata names the linked purchase) ' + JSON.stringify(t.metadata).slice(0, 300));
    const r = await row('B14'); assert.ok(r.purchases, 'purchase:links-visible (the review row lists its linked purchases)');
    const link = linkOf(r, 'P14'); assert.ok(link, 'purchase:links-visible P14'); assert.deepEqual([link.amount, link.kind, link.record.orderId, link.record.itemId], [4000, 'purchase', '000114', '01'], 'purchase:link-identity');
    assert.equal(r.purchases.adoption.eligible, false); assert.ok(r.purchases.adoption.reasons.includes('payment-not-covered'), 'purchase:partial-not-adoptable');
    assert.deepEqual([frozen[0].recordId, frozen[0].recordRevision, frozen[0].allocationId, frozen[0].orderId, frozen[0].amount, frozen[0].researchId], [w.rec.P14.id, w.rec.P14.revision, link.allocationId, '000114', 4000, null], 'purchase:ledger-provenance identity (P14 was never researched: no research identity)');
    assert.deepEqual(frozen[0].sourceHashes, [w.fileHash], 'purchase:ledger-source-hash');
    assert.equal(t.metadata.invoiceNumberStatus, 'none', 'purchase:legacy-label'); assert.equal(t.invoiceNumber, undefined); assert.equal(t.metadata.purchaseEvidence ?? null, null);
    assert.equal(await txCount({ 'metadata.bankClassificationId': d.draft.id }), 1);
  });
  await leg('S1 the full chain: upload → mapping → research → confirmation → allocation → review shows the purchase with its seller/T/registry provenance → explicit adoption → registration freezes the evidence (purchase date basis, not the bank date); no tax, no Supplier created', async () => {
    const r = await row('B1'), link = linkOf(r, 'P1'); assert.ok(link, 'purchase:links-visible B1');
    assert.deepEqual([link.record.orderId, link.record.itemId, link.record.externalOrderId, link.record.purchaseDate, link.amount, link.currency], ['000101', '01', 'EXT-101', '2026-10-01', 5500, 'JPY'], 'purchase:link-identity B1');
    assert.deepEqual(link.record.sources.map(s => s.hash), [w.fileHash], 'purchase:file-provenance'); assert.equal(link.record.sources[0].row, 2);
    const e = link.evidence; assert.deepEqual([e.supplierName, e.invoiceNumber, e.origin, e.verified], ['カクウセラーワン株式会社', 'T1000000000001', 'research-confirmed', true], 'purchase:seller-evidence');
    assert.deepEqual(e.registryBasis, { asOf: '2026-10-01', purchaseDate: '2026-10-01', current: true }, 'purchase:registry-basis'); assert.equal(e.research.registry.legalName, 'カクウセラーワン株式会社'); assert.equal(e.research.registry.active, true);
    assert.equal(r.purchases.adoption.eligible, true, 'purchase:single-full-adoptable ' + JSON.stringify(r.purchases.adoption));
    assert.equal(r.draft.invoice.status, 'unverified', 'nothing adopted before the owner acts'); assert.equal(r.draft.values.invoiceNumber, '');
    assert.equal((await put(r.draft, { revision: r.draft.revision, adoptPurchase: { allocationId: link.allocationId, recordId: link.record.id, recordRevision: link.record.revision + 1 } })).status, 409, 'purchase:adopt-bound-to-what-was-seen');
    const suppliersBefore = await db.collection('suppliers').countDocuments();
    const adopted = ok(await adopt(r.draft, link), 'adopt B1').row.draft;
    assert.deepEqual([adopted.values.invoiceNumber, adopted.invoice.status, adopted.values.supplierId, adopted.values.taxCategoryId], ['T1000000000001', 'verified-purchase', '', ''], 'purchase:adopted');
    assert.equal(adopted.revision, r.draft.revision + 1, 'purchase:adoption-revisioned'); assert.equal(adopted.adoption.supplierName, 'カクウセラーワン株式会社'); assert.equal(adopted.adoption.purchaseDate, '2026-10-01');
    const stored = await db.collection('financebankclassifications').findOne({ _id: new ObjectId(r.draft.id) }); assert.equal(stored.history.at(-1).action, 'purchase-adopted', 'purchase:adoption-event'); assert.equal(stored.adoption.allocationId, link.allocationId);
    assert.equal(await db.collection('suppliers').countDocuments(), suppliersBefore, 'purchase:no-supplier-created');
    assert.equal(await txCount({ 'metadata.bankClassificationId': r.draft.id }), 0, 'purchase:adoption-posts-nothing');
    const d = ok(await put(adopted, { revision: adopted.revision, values: { purpose: '仕入', accountCategoryId: String(w.chart['仕入高']) } }), 'decide B1').row.draft;
    assert.equal(d.invoice.status, 'verified-purchase', 'purchase:unrelated-edit-keeps-adoption');
    const reg = ok(await register(d, { revision: d.revision, action: 'create', confirm: true }), 'register B1'), t = await tx(db, d);
    assert.equal(t.invoiceNumber, 'T1000000000001'); assert.equal(t.metadata.invoiceNumberStatus, 'purchase-registry-verified', 'purchase:ledger-verified-label');
    const pe = t.metadata.purchaseEvidence; assert.ok(pe, 'purchase:ledger-adoption');
    assert.deepEqual([pe.status, pe.recordId, pe.recordRevision, pe.allocationId, pe.researchId, pe.researchRevision, pe.purchaseDate, pe.registry.asOf, pe.registry.number, pe.registry.legalName, pe.supplierName], ['current', w.rec.P1.id, w.rec.P1.revision, link.allocationId, e.research.id, e.research.revision, '2026-10-01', '2026-10-01', 'T1000000000001', 'カクウセラーワン株式会社', 'カクウセラーワン株式会社'], 'purchase:ledger-adoption identity');
    assert.equal(new Date(t.date).toISOString().slice(0, 10), '2026-10-02'); assert.notEqual(pe.registry.asOf, '2026-10-02', 'purchase:purchase-date-not-bank-date'); assert.deepEqual(pe.sourceHashes, [w.fileHash]); assert.ok(/^[a-f0-9]{64}$/.test(pe.registry.hash), 'purchase:registry-hash');
    assert.equal(t.taxCategoryId, undefined, 'purchase:no-tax-inferred'); assert.equal(t.supplierId, undefined, 'purchase:supplier-owner-controlled'); assert.equal(t.metadata.taxStatus, 'unknown');
    const regDoc = await db.collection('financebankclassifications').findOne({ _id: new ObjectId(d.id) }); assert.equal(regDoc.registration.purchase.adoption.status, 'current', 'purchase:reservation-freezes'); assert.equal(regDoc.registration.payload.metadata.purchaseEvidence.recordRevision, w.rec.P1.revision);
    assert.equal(await txCount({ 'metadata.bankClassificationId': d.id }), 1, 'purchase:one-ledger-effect'); assert.equal(reg.replayed, false);
  });
  await leg('S2 visible but not adoptable — split, combined, refund, partial, unverified number, other legal name, typed marketplace/corporate number, undated, unknown total, changed purchase date — each says why; adoption is refused there with the reason and the manual registration stays available', async () => {
    const expect = { B2a: ['P2', 'purchase-split'], B2b: ['P2', 'purchase-split'], B3: ['P3', 'several-purchases'], B5r: ['P5', 'not-outgoing'], B5o: ['P5', 'purchase-split'], B6: ['P6', 'seller-unverified'], B13: ['P13', 'seller-unverified'], B7: ['P7', 'seller-unverified'], B10: ['P10', 'registry-date-differs'], B11: ['P11', 'purchase-not-settled'] };
    for (const [k, [p, reason]] of Object.entries(expect)) { const r = await row(k); assert.ok(linkOf(r, p), 'purchase:links-visible ' + k); assert.equal(r.purchases.adoption.eligible, false, 'purchase:not-adoptable ' + k); assert.ok(r.purchases.adoption.reasons.includes(reason), 'purchase:reason ' + k + ' ' + reason + ' ' + JSON.stringify(r.purchases.adoption.reasons)); }
    const b3 = await row('B3'); assert.deepEqual(b3.purchases.links.map(l => [l.record.orderId, l.amount]).sort(), [['000103', 3000], ['000104', 5000]], 'purchase:combined-all-shown');
    const b5r = await row('B5r'); assert.deepEqual([linkOf(b5r, 'P5').kind, linkOf(b5r, 'P5').amount], ['refund', -1200], 'purchase:refund-shown');
    const b6 = linkOf(await row('B6'), 'P6'); assert.deepEqual([b6.evidence.invoiceNumber, b6.evidence.verified], ['T1000000000006', false], 'purchase:unverified-not-adoptable (number differs at the registry)');
    const b7 = linkOf(await row('B7'), 'P7'); assert.deepEqual([b7.evidence.invoiceNumber, b7.evidence.origin, b7.evidence.verified, b7.evidence.supplierName], ['1234567890123', 'file-manual', false, MARKETPLACE[0]], 'purchase:corporate-number-never-verified');
    const b10 = linkOf(await row('B10'), 'P10'); assert.equal(b10.evidence.registryBasis.purchaseDate, '', 'purchase:undated-not-adoptable'); assert.equal(b10.evidence.verified, true);
    const b11 = linkOf(await row('B11'), 'P11'); assert.deepEqual([b11.totals.total, b11.totals.state, b11.record.amount], [null, 'unknown', ''], 'purchase:unknown-total-stays-unknown');
    // P9: the purchase date was corrected after the registry check: the basis no longer is the purchase date (allocation reconfirmed first).
    await w.readRecord('P9'); ok(await w.I('records/' + w.rec.P9.id, { method: 'PATCH', body: { revision: w.rec.P9.revision, values: { purchaseDate: '2026-10-08' } } }), 'P9 date');
    { const v = await w.paymentOf('B9'), a = v.allocations.find(x => x.status === 'linked'); await w.readRecord('P9'); ok(await w.P('payments/bank/' + w.rowIds.B9 + '/allocations/' + a.id, { method: 'PUT', body: { confirm: true, action: 'reconfirm', paymentRevision: v.payment.paymentRevision, recordRevision: w.rec.P9.revision } }), 'reconfirm B9'); }
    const b9 = await row('B9'); assert.deepEqual(b9.purchases.adoption.reasons, ['registry-date-differs'], 'purchase:date-basis ' + JSON.stringify(b9.purchases.adoption.reasons)); assert.equal(linkOf(b9, 'P9').evidence.registryBasis.current, false);
    for (const k of ['B6', 'B3', 'B9']) { const r = await row(k), l = r.purchases.links[0], refused = await adopt(r.draft, l); assert.equal(refused.status, 409, 'purchase:adopt-refused ' + k); assert.match(JSON.stringify(refused.data), /\[purchase-adoption-unavailable:/, 'purchase:adopt-refused-reason ' + k); assert.equal((await row(k)).draft.revision, r.draft.revision, 'purchase:refusal-writes-nothing'); }
    // A link of another row is never adoptable here; a client "verified" value is ignored.
    const b6row = await row('B6'), b1link = linkOf(await row('B1'), 'P1'); assert.equal((await adopt(b6row.draft, b1link)).status, 409, 'purchase:other-row-link-refused');
    const forged = ok(await put(b6row.draft, { revision: b6row.draft.revision, values: { invoiceNumber: 'T1000000000006' }, invoice: { status: 'verified-purchase' }, verified: true, adoption: { invoiceNumber: 'T1000000000006', status: 'current' } }), 'forged').row.draft;
    assert.deepEqual([forged.invoice.status, forged.adoption], ['entered-unverified', null], 'purchase:client-cannot-claim-verified (only the server-resolved adoption is green)');
    assert.equal((await db.collection('financebankclassifications').findOne({ _id: new ObjectId(b6row.draft.id) })).adoption ?? null, null, 'purchase:client-adoption-not-stored');
    // the manual exit: every one of these rows registers by hand, once, with all its links frozen and the legacy label
    for (const k of ['B3', 'B6', 'B5r']) { const d = await decide(k, k === 'B5r' ? { purpose: '返金', accountCategoryId: String(w.chart['仕入高']) } : {}); const reg = await register(d.draft, { revision: d.draft.revision, action: 'create', confirm: true }); assert.equal(reg.status, 200, 'purchase:manual-exit ' + k + ' ' + JSON.stringify(reg.data).slice(0, 300)); const t = await tx(db, d.draft); assert.equal(t.metadata.purchaseLinks.length, k === 'B3' ? 2 : 1, 'purchase:manual-exit-links ' + k); assert.equal(t.metadata.invoiceNumberStatus, k === 'B6' ? 'entered-unverified' : 'none'); assert.equal(await txCount({ 'metadata.bankClassificationId': d.draft.id }), 1); }
  });
  await leg('S3 marketplace vs actual seller: the researched seller of a marketplace listing (not the marketplace, not the bank payee) is the adopted legal name and T number', async () => {
    const r = await row('B8'), link = linkOf(r, 'P8'); assert.equal(link.evidence.supplierName, 'カクウセラーエイト合同会社'); assert.equal(r.purchases.adoption.eligible, true, 'purchase:marketplace-seller-adoptable');
    const a = ok(await adopt(r.draft, link), 'adopt B8').row.draft;
    assert.deepEqual([a.adoption.supplierName, a.values.invoiceNumber], ['カクウセラーエイト合同会社', 'T1000000000008'], 'purchase:actual-seller');
    assert.ok(!JSON.stringify(a.adoption).includes(MARKETPLACE[1]) && !JSON.stringify(a.adoption).includes('カクウマーケット'), 'purchase:not-the-marketplace');
  });
  await leg('S4 manual edits and stale evidence: a typed number or another Supplier clears the adoption; a changed record, re-research, released allocation, archived purchase or changed bank row downgrades it (never green) without blocking registration, which freezes it as stale', async () => {
    let r = await row('B12'), link = linkOf(r, 'P12'); let d = ok(await adopt(r.draft, link), 'adopt B12').row.draft; assert.equal(d.invoice.status, 'verified-purchase');
    d = ok(await put(d, { revision: d.revision, values: { invoiceNumber: 'T1000000000099' } }), 'typed other number').row.draft;
    assert.deepEqual([d.invoice.status, d.adoption], ['entered-unverified', null], 'purchase:manual-edit-clears (number)');
    const cleared = await db.collection('financebankclassifications').findOne({ _id: new ObjectId(d.id) }); assert.equal(cleared.history.at(-1).cleared?.reason, 'invoice-number-changed', 'purchase:clear-recorded');
    r = await row('B12'); d = ok(await adopt(r.draft, linkOf(r, 'P12')), 're-adopt B12').row.draft; assert.equal(d.invoice.status, 'verified-purchase');
    d = ok(await put(d, { revision: d.revision, values: { supplierId: String(w.otherSupplier) } }), 'other supplier').row.draft; assert.deepEqual([d.invoice.status, d.adoption], ['entered-unverified', null], 'purchase:manual-edit-clears (supplier)');
    r = await row('B12'); d = ok(await adopt(r.draft, linkOf(r, 'P12')), 're-adopt B12 again').row.draft; assert.equal(d.values.supplierId, String(w.otherSupplier), 'adoption never overwrites the owner Supplier');
    assert.equal(d.invoice.status, 'adopted-stale', 'purchase:stale-supplier-number (the selected Supplier carries another number)'); assert.ok(d.adoption.staleReasons.includes('supplier-number-differs'));
    d = ok(await put(d, { revision: d.revision, values: { supplierId: '' } }), 'supplier cleared').row.draft; assert.equal(d.adoption, null);
    r = await row('B12'); d = ok(await adopt(r.draft, linkOf(r, 'P12')), 're-adopt B12 third').row.draft; assert.equal(d.invoice.status, 'verified-purchase');
    // the purchase record changes (a note): stale, not green; the manual registration stays available and freezes the stale state
    await w.readRecord('P12'); ok(await w.I('records/' + w.rec.P12.id, { method: 'PATCH', body: { revision: w.rec.P12.revision, values: { notes: 'fictional later note' } } }), 'P12 edit');
    d = (await row('B12')).draft; assert.equal(d.invoice.status, 'adopted-stale', 'purchase:stale-record'); assert.ok(d.adoption.staleReasons.includes('purchase-changed'), JSON.stringify(d.adoption.staleReasons));
    d = ok(await put(d, { revision: d.revision, values: { purpose: '仕入', accountCategoryId: String(w.chart['仕入高']) } }), 'decide B12').row.draft;
    ok(await register(d, { revision: d.revision, action: 'create', confirm: true }), 'register stale B12'); const t12 = await tx(db, d);
    assert.deepEqual([t12.metadata.purchaseEvidence.status, t12.metadata.invoiceNumberStatus, t12.invoiceNumber], ['stale', 'entered-unverified', 'T1000000000012'], 'purchase:stale-frozen-not-verified');
    // re-research of P15 after adoption
    r = await row('B15'); d = ok(await adopt(r.draft, linkOf(r, 'P15')), 'adopt B15').row.draft; assert.equal(d.invoice.status, 'verified-purchase'); assert.equal(d.values.supplierId, String(w.exactSupplier), 'purchase:exact-existing-supplier (already stored: same number and legal name)');
    await w.readRecord('P15'); const rv = ok(await w.I('records/' + w.rec.P15.id + '/research'), 'research P15');
    ok(await w.I('records/' + w.rec.P15.id + '/research', { method: 'POST', body: { revision: w.rec.P15.revision, researchRevision: rv.research.revision, requestId: randomUUID(), instruction: '再確認' } }), 'requeue P15');
    d = (await row('B15')).draft; assert.equal(d.invoice.status, 'adopted-stale', 'purchase:stale-research'); assert.ok(d.adoption.staleReasons.includes('research-changed'));
    // allocation released after adoption, then the bank row changed
    r = await row('B16'); d = ok(await adopt(r.draft, linkOf(r, 'P16')), 'adopt B16').row.draft; assert.equal(d.invoice.status, 'verified-purchase');
    { const v = await w.paymentOf('B16'), a = v.allocations.find(x => x.status === 'linked'); ok(await w.P('payments/bank/' + w.rowIds.B16 + '/allocations/' + a.id, { method: 'PUT', body: { confirm: true, action: 'release', paymentRevision: v.payment.paymentRevision } }), 'release B16'); }
    r = await row('B16'); assert.equal(r.draft.invoice.status, 'adopted-stale', 'purchase:stale-allocation'); assert.ok(r.draft.adoption.staleReasons.includes('purchase-unlinked')); assert.equal((r.purchases.links || []).length, 0);
    // archived purchase
    r = await row('B17'); d = ok(await adopt(r.draft, linkOf(r, 'P17')), 'adopt B17').row.draft; await w.readRecord('P17');
    ok(await w.I('records/' + w.rec.P17.id + '/archive', { method: 'PUT', body: { revision: w.rec.P17.revision, archived: true } }), 'archive P17');
    r = await row('B17'); assert.equal(r.draft.invoice.status, 'adopted-stale', 'purchase:stale-archived'); assert.ok(r.draft.adoption.staleReasons.includes('purchase-changed'));
    await w.readRecord('P17'); ok(await w.I('records/' + w.rec.P17.id + '/archive', { method: 'PUT', body: { revision: w.rec.P17.revision, archived: false } }), 'restore P17');
    // the bank row itself changed after adoption (an explicit reinterpretation increments its revision)
    r = await row('B8'); if (!r.draft.adoption) r = { draft: ok(await adopt(r.draft, linkOf(r, 'P8')), 'adopt B8 (S4 alone)').row.draft }; assert.equal(r.draft.invoice.status, 'verified-purchase');
    await db.collection('financebankrows').updateOne({ _id: new ObjectId(w.rowIds.B8) }, { $inc: { revision: 1 } });
    r = await row('B8'); assert.equal(r.draft.sourceChanged, true); assert.equal(r.draft.invoice.status, 'adopted-stale', 'purchase:stale-bank-row'); assert.ok(r.draft.adoption.staleReasons.includes('bank-row-changed'));
    await db.collection('financebankrows').updateOne({ _id: new ObjectId(w.rowIds.B8) }, { $inc: { revision: -1 } });
    assert.equal((await row('B8')).draft.invoice.status, 'verified-purchase', 'purchase:restored-current');
  });
  await leg('S5 registration: five concurrent requests → one Transaction; a crash after the reservation resumes the frozen evidence even after the research changed; release and re-registration keep one Transaction and freeze the current (stale) evidence; an adopted unregistered draft moved to another company carries no adoption', async () => {
    let d = (await row('B8')).draft; d = ok(await put(d, { revision: d.revision, values: { purpose: '仕入', accountCategoryId: String(w.chart['仕入高']) } }), 'decide B8').row.draft; assert.equal(d.invoice.status, 'verified-purchase');
    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => register(d, { revision: d.revision, action: 'create', confirm: true })));
    assert.ok(burst.every(x => [200, 409].includes(x.status)) && burst.some(x => x.status === 200), 'purchase:concurrent ' + JSON.stringify(burst.map(x => x.status)));
    assert.equal(await txCount({ 'metadata.bankClassificationId': d.id }), 1, 'purchase:concurrent-one-transaction');
    const first = await tx(db, d), frozenRevision = first.metadata.purchaseEvidence.researchRevision; assert.equal(first.metadata.purchaseEvidence.status, 'current');
    // crash: the Transaction write was lost after the reservation; the research changes before the owner resumes
    await db.collection('transactions').deleteOne({ _id: first._id }); await db.collection('financebankclassifications').updateOne({ _id: new ObjectId(d.id) }, { $set: { 'registration.state': 'reserved' } });
    await w.readRecord('P8'); const rv = ok(await w.I('records/' + w.rec.P8.id + '/research'), 'research P8');
    ok(await w.I('records/' + w.rec.P8.id + '/research', { method: 'POST', body: { revision: w.rec.P8.revision, researchRevision: rv.research.revision, requestId: randomUUID(), instruction: '再確認' } }), 'requeue P8');
    const resumed = ok(await register(d, { revision: d.revision, action: 'create', confirm: true }), 'resume'); assert.equal(resumed.transaction.id, String(first._id), 'purchase:resume-same-id');
    const again = await tx(db, d); assert.equal(again.metadata.purchaseEvidence.researchRevision, frozenRevision, 'purchase:frozen-at-reservation'); assert.equal(again.metadata.purchaseEvidence.status, 'current');
    assert.equal(await txCount({ 'metadata.bankClassificationId': d.id }), 1, 'purchase:resume-once');
    // the Transaction is deleted on its own page; the owner releases and registers again: one Transaction, today's (stale) evidence
    await db.collection('transactions').deleteOne({ _id: again._id }); let cur = (await row('B8')).draft;
    ok(await call(c.cls + '/' + cur.id + '/release', { method: 'POST', token: w.tA, body: { revision: cur.revision, transactionId: cur.registration.transactionId, confirm: true } }), 'release');
    cur = (await row('B8')).draft; assert.equal(cur.invoice.status, 'adopted-stale', 'purchase:released-reads-current');
    ok(await register(cur, { revision: cur.revision, action: 'create', confirm: true }), 're-register'); const third = await tx(db, cur);
    assert.deepEqual([String(third._id), third.metadata.purchaseEvidence.status, third.metadata.invoiceNumberStatus], [String(first._id), 'stale', 'entered-unverified'], 'purchase:re-register-current-evidence');
    assert.equal(await txCount({ 'metadata.bankClassificationId': d.id }), 1, 'purchase:release-one-effect');
    const releasedEntry = (await db.collection('financebankclassifications').findOne({ _id: new ObjectId(d.id) })).history.find(h => h.action === 'registration-released' && h.released);
    assert.equal(releasedEntry?.released?.purchase?.adoption?.status, 'current', 'purchase:release-keeps-history');
    // reassignment of an adopted unregistered draft to company B
    const p16 = await row('B16'); assert.ok(p16.draft.adoption, 'B16 still carries its (stale) adoption');
    const reassigned = await call('/api/finance-payments/bank-classifications/reassign', { method: 'POST', token: w.tB, body: { bankAccountId: w.bank.id, rowId: w.rowIds.B16, revision: p16.draft.revision, confirm: true } });
    assert.equal(reassigned.status, 200, 'reassign ' + JSON.stringify(reassigned.data).slice(0, 300)); const inB = await row('B16', w.tB);
    assert.deepEqual([inB.draft.adoption, inB.draft.values.invoiceNumber, inB.draft.invoice.status], [null, '', 'unverified'], 'purchase:reassign-clears-adoption');
    const archived = await db.collection('financebankclassifications').findOne({ _id: new ObjectId(p16.draft.id) }); assert.ok(archived.archive.at(-1).adoption, 'purchase:reassign-archives-adoption');
    assert.equal((await row('B16')).purchases, null, 'purchase:other-company-row-hides-purchases');
  });
  await leg('S6 owner and company isolation: another owner reads 404 and its purchases never appear; another company sees no purchase details; another company cannot adopt into this company draft', async () => {
    assert.equal((await call('/api/finance-payments/bank-classifications?account=' + w.bank.id, { token: w.tC })).status, 404, 'purchase:other-owner-404');
    const b1 = await row('B1'); assert.ok(b1.purchases.links.every(l => l.record.id !== w.otherRec.id), 'purchase:other-owner-purchases-hidden');
    const inB = await row('B1', w.tB); assert.equal(inB.state, 'other-company'); assert.equal(inB.purchases, null, 'purchase:other-company-no-purchases');
    const b17 = await row('B17'); assert.equal((await adopt(b17.draft, linkOf(b17, 'P17'), w.tB)).status, 404, 'purchase:other-company-adopt-404');
    const otherList = await call('/api/finance-payments/bank-classifications?account=' + w.otherBank.id, { token: w.tA }); assert.equal(otherList.status, 404, 'purchase:other-owner-bank-404');
  });
  await leg('S7 history and teaching isolation: a later row of the same payee is proposed from the taught/registered decision without any T number, and it is not verified', async () => {
    const b1 = await row('B1'); ok(await call('/api/finance-payments/bank-classifications/' + b1.draft.id + '/remember', { method: 'POST', token: w.tA, body: { revision: b1.draft.revision } }), 'remember B1'); await c.generate();
    const teaching = await db.collection('financebankteachings').findOne({ organizationId: w.A }); assert.deepEqual(Object.keys(teaching.values).sort(), ['accountCategoryId', 'purpose', 'subAccountCategoryId', 'supplierId'], 'purchase:teaching-carries-no-number');
    const later = await row('B1later'); assert.ok(['teaching', 'history'].includes(later.draft.proposed.origin), 'later proposal from the decision ' + later.draft.proposed.origin);
    assert.deepEqual([later.draft.values.invoiceNumber, later.draft.invoice.status, (later.purchases.links || []).length, later.purchases.adoption.eligible], ['', 'unverified', 0, false], 'purchase:no-propagation');
  });
  await leg('S8 legacy rows and a card repayment: no linked purchase keeps the existing behaviour and labels; the repayment shows its settlement link, is not adoptable and registers without any purchase expense link', async () => {
    const b0 = await row('B0'); assert.deepEqual([b0.purchases.links.length, b0.purchases.adoption.eligible, b0.purchases.adoption.reasons], [0, false, ['no-linked-purchase']], 'purchase:legacy-row');
    let d = await decide('B0', { purpose: '事務用品', accountCategoryId: String(w.chart['消耗品費']), invoiceNumber: 'T3333333333333' }); assert.equal(d.draft.invoice.status, 'entered-unverified');
    ok(await register(d.draft, { revision: d.draft.revision, action: 'create', confirm: true }), 'register B0'); const t0 = await tx(db, d.draft);
    assert.deepEqual([t0.metadata.invoiceNumberStatus, t0.metadata.purchaseLinks, t0.metadata.purchaseEvidence ?? null], ['entered-unverified', [], null], 'purchase:legacy-labels');
    const ba = await row('BA'); assert.deepEqual([ba.purchases.links.length, ba.purchases.otherLinks.map(l => l.kind), ba.purchases.adoption.eligible], [0, ['card-repayment'], false], 'purchase:card-repayment-shown'); assert.ok(ba.purchases.adoption.reasons.includes('other-settlement'));
    d = await decide('BA', { purpose: 'カード代金の支払', accountCategoryId: String(w.chart['未払金']) }); ok(await register(d.draft, { revision: d.draft.revision, action: 'create', confirm: true }), 'register BA');
    const ta = await tx(db, d.draft); assert.deepEqual([ta.metadata.purchaseLinks.length, ta.metadata.settlementLinks.map(l => l.kind), String(ta.accountCategoryId)], [0, ['card-repayment'], String(w.chart['未払金'])], 'purchase:card-repayment-no-expense');
  });
  await leg('S9 an unreadable purchase projection (here: a corrupted correction cycle in the owner bank account) never blocks the review or the manual registration: rows say the evidence is unavailable, an adoption is not green, adoption is refused with that reason, registration records that nothing could be read', async () => {
    const edges = [{ oldId: w.rowIds.B2a, newId: w.rowIds.B2b, at: new Date(), by: w.owner.id, kind: 'correction' }, { oldId: w.rowIds.B2b, newId: w.rowIds.B2a, at: new Date(), by: w.owner.id, kind: 'correction' }];
    await db.collection('financebankaccounts').updateOne({ _id: new ObjectId(w.bank.id) }, { $push: { corrections: { $each: edges } } });
    try {
      const b0 = await row('B0'); assert.deepEqual([b0.purchases.available, b0.purchases.adoption.reasons], [false, ['purchase-evidence-unavailable']], 'purchase:unavailable-shown');
      const b17 = await row('B17'); if (b17.draft.adoption) { assert.equal(b17.draft.invoice.status, 'adopted-stale', 'purchase:unavailable-never-green'); assert.deepEqual(b17.draft.adoption.staleReasons, ['purchase-evidence-unavailable']); }
      const b13 = await row('B13'), refused = await adopt(b13.draft, { allocationId: 'x', record: { id: w.rec.P13.id, revision: 1 } }); assert.equal(refused.status, 409); assert.match(JSON.stringify(refused.data), /purchase-evidence-unavailable/, 'purchase:unavailable-adopt-refused');
      const d = await decide('B13'), reg = await register(d.draft, { revision: d.draft.revision, action: 'create', confirm: true }); assert.equal(reg.status, 200, 'purchase:unavailable-registration-proceeds ' + JSON.stringify(reg.data).slice(0, 300));
      const t = await tx(db, d.draft); assert.deepEqual([t.metadata.purchaseEvidenceAvailable, t.metadata.purchaseLinks, t.metadata.invoiceNumberStatus], [false, null, 'none'], 'purchase:unavailable-recorded');
    } finally { await db.collection('financebankaccounts').updateOne({ _id: new ObjectId(w.bank.id) }, { $pull: { corrections: { oldId: { $in: [w.rowIds.B2a, w.rowIds.B2b] } } } }); }
  });
  console.log('RECEIPT ' + JSON.stringify({ pass: failed === 0, checks, failed }));
  server.close(); await mongoose.disconnect().catch(() => {}); await rm(temp, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}

// ════════════════════════════ The built app (C, R1) ════════════════════════════
const APP_LOGS = [];
async function availablePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function bootApp(mongo, dbName, directory) {
  const uri = mongo.getUri(dbName), port = await availablePort(), origin = 'http://127.0.0.1:' + port; let logs = '';
  const child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: OUTPUT_ROOT, windowsHide: true, env: { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, MONGODB_URI: '', OMF_DATA_DIR: directory, OMF_SYNC_SCHEDULE_MS: '0', OMF_BANK_SCHEDULE_MS: '0', JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(r => child.once('exit', r));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', v => { logs = (logs + v).slice(-20000); });
  let healthy = false;
  for (let i = 0; i < 150; i++) { try { const d = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (d.database?.connected && d.database.name === dbName) { healthy = true; break; } } catch { /* booting */ } await pause(200); }
  if (!healthy) { child.kill(); await Promise.race([exited, pause(5000)]); throw new Error('SETUP owned app did not become healthy: ' + logs.slice(-1500)); }
  const call = async (route, { method = 'GET', token, body, type, raw } = {}) => { const isRaw = Buffer.isBuffer(body); const r = await fetch(origin + route, { method, headers: { 'Content-Type': isRaw ? (type || 'application/octet-stream') : 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: isRaw || raw ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(60000) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data }; };
  let closing = null;
  const close = () => closing ??= (async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); if (await Promise.race([exited.then(() => true), pause(15000).then(() => false)])) return; child.kill('SIGKILL'); await Promise.race([exited, pause(5000)]); })();
  APP_LOGS.push({ dbName, port, logs: () => logs });
  return { origin, call, close, logs: () => logs };
}
const appSession = (app, db) => async tag => {
  const email = 'purchase-' + tag + '@example.invalid', password = 'Synthetic-password-Only1!';
  const r = await app.call('/api/auth/register', { method: 'POST', body: { email, password, name: 'Synthetic ' + tag } }); assert.equal(r.status, 200, 'SETUP register ' + JSON.stringify(r.data).slice(0, 200));
  const token = r.data.tokens.accessToken, user = await db.collection('users').findOne({ email });
  return { id: String(user._id), email, password, token, forOrg: async org => { const s = await app.call('/api/auth/switch-organization', { method: 'POST', token, body: { organizationId: String(org) } }); assert.equal(s.status, 200, 'SETUP switch ' + JSON.stringify(s.data).slice(0, 200)); return s.data.tokens.accessToken; } };
};
async function legC(mongo, base, out) {
  const { MongoClient, ObjectId } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri('omf_purchase_ui')), db = client.db('omf_purchase_ui');
  const app = await bootApp(mongo, 'omf_purchase_ui', path.join(base, 'ui-data'));
  const { browserFor } = await import(pathToFileURL(path.join(root, 'collector/browser.mjs')).href), profileDir = await mkdtemp(path.join(os.tmpdir(), 'omf-purchase-browser-')), browser = await browserFor(path.join(profileDir, 'profile'), { headless: true });
  const shots = EVIDENCE ? path.join(EVIDENCE, 'screenshots') : null, errors = [], blocked = [];
  try {
    let w; try { w = await buildWorld({ call: app.call, db, ObjectId, session: appSession(app, db) }, 'ui'); } catch (e) { throw new Error('SETUP fictional world on the built app: ' + e.message); }
    const c = classificationOf(w, app.call); await c.generate();
    const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true); page.on('request', r => { if (r.url().startsWith(app.origin) || r.url().startsWith('data:') || r.url().startsWith('blob:')) r.continue(); else { blocked.push(new URL(r.url()).host); r.abort(); } });
    page.on('pageerror', e => errors.push(String(e))); page.on('console', msg => { if (msg.type() === 'error' && !/^Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    const wait = async (f, arg, label) => { for (let i = 0; i < 300; i++) { if (await page.evaluate(f, arg)) return; await pause(100); } throw new Error('ui:condition ' + label); };
    const shot = async name => { if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); } };
    const rowSel = k => '[data-bank-classification-row="' + w.rowIds[k] + '"] ', text = async (k, sel) => page.$eval(rowSel(k) + sel, e => e.textContent.replace(/\s+/g, ' ').trim());
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.goto(app.origin + '/login', { waitUntil: 'networkidle2' }); await page.type('#email', w.owner.email); await page.type('#password', w.owner.password); await page.evaluate(() => document.querySelector('button[type="submit"]').click()); await wait(() => location.pathname === '/', null, 'login');
    await page.evaluate(async organizationId => { const user = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'); const r = await fetch('/api/auth/switch-organization', { method: 'POST', headers: { ...user.authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) }), s = await r.json(); if (!r.ok) throw Error('Synthetic switch failed'); const p = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + s.tokens.accessToken } }); user.acceptSession({ ...await p.json(), tokens: s.tokens }, false); }, String(w.A));
    await page.goto(app.origin + '/intake/payments', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('[data-review-tab="bank-classification"]'), null, 'tab');
    await page.click('[data-review-tab="bank-classification"]'); await wait(() => { const s = document.querySelector('[data-bank-classification-account]'); return !!s && [...s.options].some(o => o.value); }, null, 'account option');
    await page.select('[data-bank-classification-account]', w.bank.id); await wait(id => !!document.querySelector('[data-bank-classification-row="' + id + '"] [data-bank-classification-purchases]'), w.rowIds.B1, 'purchases block');
    const p1 = await text('B1', '[data-bank-classification-purchases]');
    for (const piece of ['000101', '01', 'EXT-101', '5,500', 'カクウセラーワン株式会社', 'T1000000000001', '2026-10-01']) assert.ok(p1.includes(piece), 'ui:purchase-shown ' + piece + ' in ' + p1);
    assert.match(p1, /国税庁の公表情報で確認済み（購入日 2026-10-01 時点）/, 'ui:registry-basis-label');
    assert.match(await text('B1', '[data-bank-classification-invoice]'), /未確認/, 'ui:not-adopted-yet');
    const p3 = await text('B3', '[data-bank-classification-purchases]'); assert.ok(p3.includes('000103') && p3.includes('000104'), 'ui:combined-shown'); assert.match(await text('B3', '[data-bank-classification-adopt-reason]'), /複数の購入/, 'ui:combined-reason');
    assert.equal(await page.$(rowSel('B3') + '[data-bank-classification-adopt]'), null, 'ui:combined-no-adopt');
    assert.match(await text('B7', '[data-bank-classification-purchases]'), /1234567890123.*未検証/, 'ui:corporate-number-unverified');
    assert.match(await text('B0', '[data-bank-classification-purchases]'), /紐付けた購入はありません/, 'ui:legacy-none');
    await shot('390-purchases'); assert.equal(await overflow(), false, 'ui:no-overflow-390');
    if (shots) await (await page.$(rowSel('B1'))).screenshot({ path: path.join(shots, '390-B1-before.png') });
    assert.equal(await page.$eval(rowSel('B1') + '[data-bank-classification-adopt]', e => e.disabled), true, 'ui:adopt-needs-confirm');
    await page.click(rowSel('B1') + '[data-bank-classification-adopt-confirm]'); await wait(sel => !document.querySelector(sel + '[data-bank-classification-adopt]').disabled, rowSel('B1'), 'adopt enabled');
    await page.click(rowSel('B1') + '[data-bank-classification-adopt]'); await wait(sel => /確認済み/.test(document.querySelector(sel + '[data-bank-classification-invoice]')?.textContent || ''), rowSel('B1'), 'adopted');
    const stored = await db.collection('financebankclassifications').findOne({ bankRowId: new ObjectId(w.rowIds.B1) }); assert.equal(stored.values.invoiceNumber, 'T1000000000001', 'ui:adopted-stored'); assert.equal(stored.history.at(-1).action, 'purchase-adopted');
    assert.match(await text('B1', '[data-bank-classification-invoice]'), /T1000000000001.*購入の調査で確認済み.*2026-10-01/, 'ui:adopted-label');
    assert.equal(await page.$(rowSel('B1') + '[data-bank-classification-adopt]'), null, 'ui:adopted-no-second-offer'); assert.match(await text('B1', '[data-bank-classification-adopted]'), /使っています/, 'ui:adopted-shown');
    if (shots) await (await page.$(rowSel('B1'))).screenshot({ path: path.join(shots, '390-B1-adopted.png') });
    assert.equal(await db.collection('transactions').countDocuments({ 'metadata.bankClassificationId': String(stored._id) }), 0, 'ui:adopt-posts-nothing');
    await page.setViewport({ width: 1440, height: 1000 }); await pause(300); assert.equal(await overflow(), false, 'ui:no-overflow-1440'); await shot('1440-purchases');
    await page.evaluate(() => document.documentElement.classList.add('dark')); await pause(200); assert.equal(await overflow(), false, 'ui:dark'); await shot('1440-dark');
    await page.setViewport({ width: 390, height: 844 }); await pause(300); assert.equal(await overflow(), false, 'ui:dark-390');
    assert.deepEqual(errors, [], 'ui:no-page-errors'); assert.ok([...new Set(blocked)].every(h => h && !h.startsWith('127.0.0.1')), 'ui:outside-requests-aborted');
    out.push('C Chrome 390/1440/dark (outside requests aborted: ' + ([...new Set(blocked)].join(', ') || 'none') + '): B1 shows order/item/external IDs, amount, seller legal name, T number and its purchase-date registry basis; combined row lists both purchases with the reason and no adopt button; typed corporate number shown unverified; legacy row says no purchase; explicit confirm + adopt stored the number with its event and posted nothing; no overflow, no page errors');
  } finally { await browser.close().catch(() => {}); await app.close(); await client.close().catch(() => {}); await rm(profileDir, { recursive: true, force: true }).catch(() => {}); }
}
async function legR1(mongo, base, out) {
  const { MongoClient } = requireRoot('mongodb'), client = await MongoClient.connect(mongo.getUri('omf_purchase_shiwake')), db = client.db('omf_purchase_shiwake');
  const app = await bootApp(mongo, 'omf_purchase_shiwake', path.join(base, 'shiwake-data')); let passes = 0;
  try {
    const reg = async email => { const r = await app.call('/api/auth/register', { method: 'POST', body: { email, password: 'Synthetic-password-Only1!', name: 'Finance test' } }); assert.equal(r.status, 200, 'SETUP register'); return r.data.tokens.accessToken; };
    const token = await reg('finance-a@example.invalid'), other = await reg('finance-b@example.invalid');
    const run = requireRoot(path.join(root, 'scripts/finance-bank-classification-integration.cjs'));
    await run({ db, call: (route, o = {}) => app.call(route, o), origin: app.origin, token, other, pass: name => { passes++; out.push('PASS ' + name.slice(0, 160)); }, root, pause });
  } finally { await app.close(); await client.close().catch(() => {}); }
  return passes;
}

// ════════════════════════════ M: reintroduced defects in copies of server/ and shared/ ════════════════════════════
// [label, file, anchor (must hit exactly once), replacement, S leg, the assertion it must fail]
const MUTANTS = [
  ['MB1-review-without-purchases', 'server/services/financeBankClassificationService.ts', /const purchases = await purchaseLinksOf\(ownerId, account\)/g, 'const purchases = null', 'S1', /purchase:links-visible/],
  ['MB2-ledger-without-purchases', 'server/services/financeBankClassificationService.ts', /purchaseLinks: frozen\.links, /g, '', 'S0', /purchase:ledger-provenance/],
  ['MB3-unverified-adoptable', 'shared/finance-bank-classification.mjs', /  if \(e\.origin !== 'research-confirmed' \|\| !e\.registryMatch \|\| \(dated && !e\.verified\)\) reasons\.push\('seller-unverified'\);\n/g, '', 'S2', /purchase:(not-adoptable|reason) B6/],
  ['MB4-adoption-never-stale', 'server/services/financeBankClassificationService.ts', /const adoptionNow = purchaseAdoptionState;/g, 'const adoptionNow = (a: any, _o: any) => a ? { current: true, staleReasons: [] as string[] } : null;', 'S4', /purchase:stale-/],
  ['MB5-undated-adoptable', 'shared/finance-bank-classification.mjs', /const dated = !!basis && !!basis\.purchaseDate && basis\.asOf === basis\.purchaseDate && basis\.current;/g, 'const dated = !!basis && basis.current;', 'S2', /purchase:(not-adoptable|reason) B10/],
  ['MB6-manual-edit-keeps-adoption', 'server/services/financeBankClassificationService.ts', /const clearAdoption = !!draft\.adoption && \(/g, 'const clearAdoption = false && (', 'S4', /purchase:manual-edit-clears/]
];

// ════════════════════════════ The fixture ════════════════════════════
function runChild(args, env, timeout) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const text = String(stdout || ''), lines = text.split(/\r?\n/);
      resolve({ ms: Date.now() - started, code: error ? (error.code ?? 1) : 0, text, stderr: String(stderr || ''), passes: lines.filter(l => l.startsWith('PASS ')), fails: lines.filter(l => l.startsWith('FAIL ')), setup: lines.find(l => l.startsWith('SETUP ')) || null, receipt: (() => { const l = lines.find(x => x.startsWith('RECEIPT ')); try { return l ? JSON.parse(l.slice(8)) : null; } catch { return null; } })() });
    });
  });
}
export default { name: 'omf-purchase-workflow', covers: COVERS, async run() {
  const started = Date.now(), lines = [], green = new Set(); let pass = true, executed = false;
  const counts = { unitTests: null, harnessLegs: 0, chrome: 0, regression: {}, mutantsCaught: 0, mutantsTotal: MUTANTS.length };
  const want = name => !ONLY.length || ONLY.includes(name);
  const keep = async (name, text) => { if (EVIDENCE) { await mkdir(EVIDENCE, { recursive: true }); await writeFile(path.join(EVIDENCE, 'leg-' + name + '.txt'), text); } };
  const leg = async (name, fn) => { const key = name.split(' ')[0]; if (!want(key)) return; const t = Date.now(); try { lines.push(name + ': ' + await fn() + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); green.add(key); } catch (e) { pass = false; lines.push(name + ': RED ' + String(e?.message || e).replace(/\s+/g, ' ').slice(0, 1800)); } };
  const base = await mkdtemp(path.join(os.tmpdir(), 'omf-purchase-fixture-')); let mongo = null;
  try {
    await leg('U node --test scripts/finance-bank-classification.test.mjs', async () => {
      const r = await runChild(['--test', 'scripts/finance-bank-classification.test.mjs'], {}, 120000), passed = Number((r.text.match(/ℹ pass (\d+)/) || [])[1]), failedN = Number((r.text.match(/ℹ fail (\d+)/) || [])[1]);
      await keep('U', r.text + r.stderr); counts.unitTests = passed;
      if (r.code !== 0 || failedN !== 0 || !passed) throw new Error('exit ' + r.code + ': ' + (r.text + r.stderr).replace(/\s+/g, ' ').slice(-900));
      return passed + ' unit tests green';
    });
    const { MongoMemoryServer } = requireRoot('mongodb-memory-server');
    mongo = await MongoMemoryServer.create({ binary: existsSync(BINARY) ? { systemBinary: BINARY, version: '8.2.1' } : undefined });
    const harness = async (src, db, legs = '') => runChild(['--import', 'tsx', SELF, HARNESS_FLAG, src], { OMF_PURCHASE_MONGO_URI: mongo.getUri(), OMF_PURCHASE_DB: db, OMF_PURCHASE_ONLY_S: legs, MONGO_URI: '', MONGODB_URI: '' }, 900000);
    await leg('S services and routes on the owned MongoDB (S0-S9)', async () => {
      const r = await harness(SRC_ROOT, 'omf_purchase_s', process.env.OMF_PURCHASE_S_LEGS || ''); executed = true; await keep('S', r.text + '\n--- stderr ---\n' + r.stderr);
      counts.harnessLegs = r.passes.length;
      if (r.setup) throw new Error(r.setup + ' (no behavioural result)');
      if (r.code !== 0 || !r.receipt?.pass || r.fails.length) throw new Error(r.fails.length + ' failed / ' + r.passes.length + ' green: ' + (r.fails.join(' | ') || r.stderr.slice(-800)).slice(0, 2500));
      return r.passes.length + ' legs green — ' + r.passes.map(p => p.slice(5, 8).trim()).join(' ');
    });
    await leg('C owned headless Chrome on the built app', async () => {
      if (!existsSync(path.join(OUTPUT_ROOT, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const out = []; APP_LOGS.length = 0; try { await legC(mongo, base, out); } finally { counts.chrome = out.length; await keep('C', out.join('\n') + '\n\n' + APP_LOGS.map(a => '--- app ' + a.dbName + ':' + a.port + ' ---\n' + a.logs()).join('\n')); }
      return out.join(' · ') + (EVIDENCE ? '; screenshots ' + path.join(EVIDENCE, 'screenshots') : '');
    });
    await leg('R1 existing bank classification integration on the built app (scripts/finance-bank-classification-integration.cjs, incl. its Chrome leg)', async () => {
      if (!existsSync(path.join(OUTPUT_ROOT, '.output/server/index.mjs'))) throw new Error('NOT RUN: built app absent');
      const out = []; APP_LOGS.length = 0; let n = 0; try { n = await legR1(mongo, base, out); } finally { await keep('R1', out.join('\n') + '\n\n' + APP_LOGS.map(a => '--- app ' + a.dbName + ':' + a.port + ' ---\n' + a.logs()).join('\n')); }
      counts.regression.R1 = n; return n + ' existing classification checks passed';
    });
    await leg('R2 existing payment matching integration unchanged (OMF_TEST_PAYMENTS_ONLY, scripts/finance-integration.cjs, own owned MongoDB)', async () => {
      const r = await runChild(['scripts/finance-integration.cjs'], { MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', OMF_TEST_PAYMENTS_ONLY: '1', ...(existsSync(BINARY) ? { MONGOMS_SYSTEM_BINARY: BINARY } : {}) }, 1200000);
      await keep('R2', r.text + '\n--- stderr ---\n' + r.stderr);
      const s = r.text.match(/(\d+) targeted payment matching checks passed/);
      if (r.code !== 0 || !s) throw new Error('exit ' + r.code + '; ' + (r.text + r.stderr).replace(/\s+/g, ' ').slice(-1200));
      counts.regression.R2 = Number(s[1]); return s[0];
    });
    await leg('M reintroduced defects in copies of server/ and shared/ (each run only on its leg; the unchanged copy first)', async () => {
      if (!green.has('S')) throw new Error('NOT RUN: leg S must be green first');
      const copyTree = async label => { const dir = path.join(root, '.cache', 'omf-purchase-' + label); await rm(dir, { recursive: true, force: true }); for (const d of ['server', 'shared']) await cp(path.join(root, d), path.join(dir, d), { recursive: true }); return dir; };
      const control = await copyTree('control'); try { for (const legName of [...new Set(MUTANTS.map(x => x[4]))]) { const r = await harness(control, 'omf_purchase_mcontrol_' + legName.toLowerCase(), legName); if (r.code !== 0 || r.fails.length || r.setup || r.passes.length !== 1) throw new Error('unchanged copy failed on ' + legName + ' alone: ' + (r.setup || r.fails.join(' | ') || r.stderr.slice(-300)).slice(0, 500)); } } finally { await rm(control, { recursive: true, force: true }); }
      const caught = [];
      for (const [label, file, anchor, replacement, legName, pattern] of MUTANTS) {
        const dir = await copyTree(label.toLowerCase());
        try {
          const target = path.join(dir, file), source = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n'), hits = (source.match(anchor) || []).length;
          if (hits !== 1) throw new Error(label + ' anchor hits ' + hits);
          await writeFile(target, source.replace(anchor, replacement));
          const r = await harness(dir, 'omf_purchase_' + label.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30), legName);
          if (!r.fails.length || !pattern.test(r.fails[0])) throw new Error(label + ' did not fail ' + pattern + ': ' + (r.fails[0] || r.passes.join(' ') || r.setup || r.stderr.slice(-300)).slice(0, 400));
          caught.push(label + '→' + r.fails[0].match(pattern)[0]); counts.mutantsCaught++;
        } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
      }
      await keep('M', caught.join('\n')); return 'control green; ' + caught.join(', ');
    });
  } catch (e) { pass = false; lines.push('setup: ' + String(e?.message || e).slice(0, 800)); }
  finally { if (mongo) await mongo.stop().catch(() => {}); await rm(base, { recursive: true, force: true }).catch(() => {}); }
  return { pass, databaseCoverage: { executed, ownedProcess: executed }, message: (pass ? 'green' : 'RED') + ' in ' + Math.round((Date.now() - started) / 1000) + 's ' + JSON.stringify(counts) + '\n' + lines.join('\n') };
} };

if (process.argv.includes(HARNESS_FLAG)) await harnessMain(path.resolve(process.argv[process.argv.indexOf(HARNESS_FLAG) + 1]));

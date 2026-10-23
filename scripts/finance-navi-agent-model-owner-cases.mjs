// Owner and purchase-realm cases of the Navi product-model corpus (O01–O13). One synthetic owner with three card accounts, one
// card statement plus an unbilled (pending) forecast and the final statement that settles it, all uploaded through the native import
// route, drafts saved/approved/posted through the native draft and company-commit routes, intake records and sheets through the native intake routes, an Aplus collector pairing
// and schedule through the native connection routes, one named synthetic workflow row and a separate research agent whose native
// liveness is renewed during O13 only. No collector, workflow, research or export worker is started and nothing is downloaded,
// sent or paid: O06/O07/O08/O13 can only produce queued or configured native state.
// check() is the independent deterministic oracle over fresh records, journal receipts and observed native HTTP; ideal() is the
// scripted synthetic worker turn of the zero-model selftest. Importing this module performs no work.
import { check, readCheck, receipts, unchangedFields, plainDocument } from './finance-navi-agent-model-cases.mjs';

const reply = summary => ({ kind: 'unclear', summary, patch: {}, quotes: {} });
const idOf = row => String(row?._id ?? row?.id ?? '');
const HEADERS_PATH = 'shared/amex.mjs';
const S1 = { start: '2026-07-19', end: '2026-08-18' };
const S1_ROWS = [['2026/08/01', 'O01_SHOP オンライン', 1980], ['2026/08/02', 'O02_SHOP 文具店', 2200], ['2026/08/03', 'O03_SHOP 雑貨', 5500], ['2026/08/04', 'O04_SHOP 事務用品', 3300], ['2026/08/05', 'O13_SHOP 機器', 8800], ['2026/08/06', 'O08_SHOP 仕入', 12000], ['2026/08/07', 'O12_SHOP 購入', 7700]];
const LINE = { O01: 2, O02: 3, O03: 4, O04: 5, O13: 6, O08: 7, O12: 8 };
// O05 (2026-10-24 refinement, before any actual draw): the unbilled forecast (native kind=pending import) and the final statement
// whose identical rows settle it (native pendingSettlements: the forecast rows become finalized with the final statement as source,
// the final statement's matching rows are referenced and cannot be posted again). The final statement adds one final-only row.
const FORECAST = { start: '2026-09-19', end: '2026-09-30' }, FINAL = { start: '2026-09-19', end: '2026-10-18' };
const FORECAST_ROWS = [['2026/09/20', 'O05_FORECAST_A 既存転記', 1100], ['2026/09/22', 'O05_FORECAST_B 選択行', 2310], ['2026/09/24', 'O05_FORECAST_C 承認済み', 3520], ['2026/09/26', 'O05_FORECAST_D 未承認', 4180]];
const FINAL_ROWS = [...FORECAST_ROWS, ['2026/09/28', 'O05_FINAL_ONLY 確定のみ', 990]];
const STAMP = ['updatedAt', '__v'];
const O10_SHEET = '注文番号,商品名,金額\r\nO10-ORDER-1,合成商品A,1200\r\nO10-ORDER-2,合成商品B,3400\r\n', O10_OTHER = '注文番号,商品名,金額\r\nO10-OTHER-1,別シート商品,9999\r\n';

// ---- Owner realm setup (once per runtime; every owner case reuses it)
export async function ownerSetup(ctx) {
  if (ctx.ownerRealm) return ctx.ownerRealm;
  // The three owner card accounts were created through the native account route when the runtime started (the teaching agent is
  // assigned to them at creation): AMEX_MAIN (statements and drafts), APLUS_TEST_CARD and APLUS_OTHER.
  const o = {}, owner = ctx.owner, plain = owner.plainToken;
  o.amex = owner.accounts.amex; o.aplus = owner.accounts.aplus; o.aplusOther = owner.accounts.aplusOther;
  await ctx.ok('/api/finance/collectors', { token: plain(), method: 'POST', body: { name: 'Owned synthetic collector (never run)', accountIds: [idOf(o.aplus), idOf(o.aplusOther)] } });
  await ctx.ok('/api/finance/accounts/' + idOf(o.aplusOther) + '/auto-sync', { token: plain(), method: 'PUT', body: { enabled: true, hour: 21 } });
  const ref = async (collection, name, extra = {}) => { const _id = new ctx.ObjectId(), now = new Date(); await ctx.db.collection(collection).insertOne({ _id, name, isActive: true, ...extra, createdAt: now, updatedAt: now }); return String(_id); };
  o.refs = { consumables: await ref('accountcategories', '消耗品費', { type: 'expense' }), telecom: await ref('accountcategories', '通信費', { type: 'expense' }), general: await ref('transactioncategories', '一般'), tax10: await ref('taxcategories', '課税仕入 10%', { rate: 10 }), omj10: await ref('customers', 'OMJ10'), omj03: await ref('customers', 'OMJ03') };
  o.ready = { purpose: 'company', accountCategoryId: o.refs.consumables, transactionCategoryId: o.refs.general, taxCategoryId: o.refs.tax10, taxRate: 10 };
  const { HEADERS } = await ctx.importApp(HEADERS_PATH);
  const csv = rows => Buffer.from([HEADERS, ...rows.map(([d, name, amount]) => [d, d, name, 'Synthetic user', '12345', String(amount), '', ''])].map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n'));
  const upload = async (rows, p, kind = 'statement') => (await ctx.ok('/api/finance/accounts/' + idOf(o.amex) + '/imports?kind=' + kind + '&start=' + p.start + '&end=' + p.end, { token: plain(), method: 'POST', raw: csv(rows) })).id;
  o.s1 = await upload(S1_ROWS, S1);
  o.draft = async (importId, line) => ctx.ok('/api/finance/imports/' + importId + '/drafts/' + line, { token: plain() });
  o.saveDraft = async (importId, line, values, confirm = false) => { const d = await o.draft(importId, line); return ctx.ok('/api/finance/imports/' + importId + '/drafts/' + line, { token: plain(), method: 'PUT', body: { revision: d.revision, key: d.key, sourceHash: d.sourceHash, values: { ...d.values, ...values }, remember: [], confirm, ...(confirm ? { cardAccountingKey: d.cardAccounting?.key } : {}) } }); };
  for (const line of Object.values(LINE)) await o.draft(o.s1, line);
  // O04: a complete, not yet approved draft. O02/O03 (2026-10-24 refinement): saved, not approved drafts whose current values differ
  // from what those cases ask to remember (O02 saved 通信費, remembers 消耗品費; O03 saved company use, remembers OMJ10's request).
  await o.saveDraft(o.s1, LINE.O04, o.ready);
  await o.saveDraft(o.s1, LINE.O02, { accountCategoryId: o.refs.telecom });
  await o.saveDraft(o.s1, LINE.O03, { purpose: 'company', customerId: '' });
  o.upload = upload;
  const intake = async values => (await ctx.ok('/api/finance-intake/records', { token: plain(), method: 'POST', body: { values } }));
  o.o09 = await intake({ orderId: 'O09-ORDER-1', description: 'O09 合成購入', amount: '5500', customer: 'OMJ10', notes: 'O09_ORIGINAL_NOTE' });
  o.o12 = await intake({ orderId: 'O12-ORDER-7', description: 'O12 合成購入', amount: '7700', supplierName: '合成販売店' });
  o.o12decoy = await intake({ orderId: 'O12-ORDER-8', description: 'O12 別の受付', amount: '7700' });
  const sheet = async (name, text) => (await ctx.ok('/api/finance-intake/files?name=' + encodeURIComponent(name), { token: plain(), method: 'POST', raw: Buffer.from(text) })).document;
  o.sheet = await sheet('o10-sheet.csv', O10_SHEET); o.otherSheet = await sheet('o10-other.csv', O10_OTHER);
  // O08: one assigned-card workflow row with its inventory step in manual review (a named synthetic row; the workflow worker never runs).
  const d8 = await o.draft(o.s1, LINE.O08), now = new Date(), step = (stage, state, reason, extra = {}) => ({ stage, unit: 'purchase', state, reason, cycle: 1, failedNights: 0, lifetimeFailedNights: 0, lastFailedDay: null, firstWaitingAt: null, lastCheckedAt: now.toISOString(), completedAt: state === 'complete' ? now.toISOString() : null, snoozedUntil: null, ...extra });
  const steps = { purchase: step('purchase', 'complete', 'complete', { evidenceKey: 'a'.repeat(64) }), inventory_1: step('inventory', 'manual_review', 'exhausted', { failedNights: 10, lifetimeFailedNights: 10, failureReason: 'missing_inventory', lastFailedDay: '2026-10-20' }), shipment_1: step('shipment', 'waiting', 'waiting_dependency'), documents_1: step('documents', 'waiting', 'waiting_dependency') };
  const { workflowSummary } = await ctx.importApp('shared/finance-workflow.mjs');
  o.workflow = new ctx.ObjectId();
  await ctx.db.collection('financeworkflows').insertOne({ _id: o.workflow, ownerId: owner.id, accountId: new ctx.ObjectId(idOf(o.amex)), importId: new ctx.ObjectId(o.s1), line: LINE.O08, key: d8.key, sourceHash: d8.sourceHash, payment: { date: '2026-08-06', amount: 12000, merchant: 'O08_SHOP 仕入', accountName: 'AMEX_MAIN', purpose: 'customer' }, version: 1, revision: 3, steps, summary: workflowSummary(steps), events: [], lastAssessedAt: now, createdAt: now, updatedAt: now });
  o.research = await ctx.createAgent({ accountIds: [idOf(o.amex)], researchEnabled: true });
  ctx.ownerRealm = o;
  return o;
}
// O05 only (run by its prepare, once): the forecast, then the final statement. The native settlement must finalize every forecast row
// from the final statement before anything is approved or posted; otherwise O05 is a setup failure naming the observed blocker and
// no other case is affected. Then forecast line 2 approved and posted earlier, lines 3 and 4 approved, line 5 left unapproved.
async function forecastSetup(ctx, o) {
  if (o.forecast) return o;
  const plain = ctx.owner.plainToken;
  const forecast = await o.upload(FORECAST_ROWS, FORECAST, 'pending'), final = await o.upload(FINAL_ROWS, FINAL);
  const forecastView = await ctx.ok('/api/finance/imports/' + forecast, { token: plain() }), finalView = await ctx.ok('/api/finance/imports/' + final, { token: plain() });
  const unsettled = forecastView.rows.filter(r => r.settlement?.state !== 'finalized' || r.settlement?.source?.importId !== final || r.settlement?.source?.sourceHash !== finalView.hash);
  if (forecastView.sourceStatus !== 'pending' || forecastView.rows.length !== FORECAST_ROWS.length || unsettled.length) throw Object.assign(Error('O05 precondition blocker: the native pending→final settlement did not finalize every forecast row from the final statement: ' + JSON.stringify({ sourceStatus: forecastView.sourceStatus, rows: forecastView.rows.map(r => ({ line: r.line, state: r.state, settlement: r.settlement?.state || null, source: r.settlement?.source?.importId || null })) })), { layer: 'setup' });
  o.finalHash = finalView.hash; o.finalRows = finalView.rows.map(r => ({ line: r.line, description: r.description, amount: r.amount, purchaseDate: r.purchaseDate, state: r.state }));
  o.finalization = forecastView.rows.map(r => ({ line: r.line, description: r.description, amount: r.amount, settlement: r.settlement.state, finalImportId: r.settlement.source.importId, finalLines: r.settlement.source.lines }));
  for (let line = 2; line <= 5; line++) await o.draft(forecast, line);
  for (const line of [2, 3, 4]) await o.saveDraft(forecast, line, o.ready, true);
  const posted = await o.draft(forecast, 2);
  await ctx.ok('/api/finance/imports/' + forecast + '/company-commit', { token: ctx.owner.companyToken(), method: 'POST', body: { decisions: [{ line: 2, action: 'import', draftRevision: posted.revision }] } });
  o.forecast = forecast; o.final = final;
  return o;
}
const draftDoc = (ctx, o, importId, line) => ctx.db.collection('financedrafts').findOne({ ownerId: ctx.owner.id, importId: new ctx.ObjectId(importId), line });
const memories = (ctx) => ctx.db.collection('financedecisionmemories').find({ ownerId: ctx.owner.id }).sort({ _id: 1 }).toArray();
const doneOnce = (ev, name) => { const done = receipts(ev.turn, name, 'done'); return check('receipts:done-' + name, done.length === 1, done.length + ' done ' + name + '; all ' + JSON.stringify(receipts(ev.turn).map(a => a.name + ':' + a.state))); };
const purchase = (o, key) => ({ purchase: { importId: o.s1, line: LINE[key] }, context: { importId: o.s1, line: LINE[key] }, labels: { importId: 'O:statement-1' } });

const designs = [];
const define = d => designs.push(Object.freeze(d));
// Purchase drafts are computed on read and stored on their first save: before/after values are read through the native draft route,
// and the stored draft document is declared as created (first save) or changed (an earlier save exists).
const draftState = async (ctx, o, key) => { const line = LINE[key], d = await o.draft(o.s1, line), doc = await draftDoc(ctx, o, o.s1, line); return { line, importId: o.s1, before: { values: d.values, revision: d.revision, approvedAt: d.approvedAt ?? null }, draftDocId: doc ? String(doc._id) : null }; };
const draftEffect = (s, fields) => s.draftDocId ? { financedrafts: { changed: { [s.draftDocId]: [...fields, ...STAMP] } } } : { financedrafts: { added: 1 } };
const draftNow = (ctx, s) => ctx.ownerRealm.draft(s.importId, s.line);
const otherValues = (s, after, except) => unchangedFields('protected:other-draft-values', s.before.values, after?.values || null, Object.keys(s.before.values || {}).filter(k => !except.includes(k)));
define({ id: 'O01', async prepare(ctx) { const o = await ownerSetup(ctx); return { ...purchase(o, 'O01'), state: await draftState(ctx, o, 'O01') }; },
  allowed: s => ({ ...draftEffect(s, ['values', 'revision', 'history', 'missing', 'evidence', 'suggestions']), financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const d = await draftNow(ctx, s); return [doneOnce(ev, 'save_draft_fields'), check('effect:product-name-saved', d?.values?.productName === 'MODEL_DRAFT_SAVED', 'productName ' + JSON.stringify(d?.values?.productName)), otherValues(s, d, ['productName']), check('protected:not-approved', !d?.approvedAt, 'approvedAt ' + d?.approvedAt), check('protected:no-memory', (ev.diff.financedecisionmemories?.added || []).length === 0, 'no remembered decision')]; },
  async ideal(ctx, s, j) { await j.act('get_draft', {}); await j.act('save_draft_fields', { fields: { productName: 'MODEL_DRAFT_SAVED' } }); await j.act('get_draft', {}); return reply('商品名を保存しました。'); } });
// O02/O03 remember only. Their precondition is a draft saved through the native route with values DIFFERENT from what is remembered;
// native saved.values stay the draft's values (a memory may add suggestions), so the saved values must survive in the native draft
// view and in the stored draft document, with no draft write, save receipt, approval or posting.
const storedDraft = (ctx, s) => s.draftDocId ? ctx.db.collection('financedrafts').findOne({ _id: new ctx.ObjectId(s.draftDocId) }) : null;
function savedDraftUnchanged(s, view, stored, ev) {
  const viewed = unchangedFields('view', s.before.values, view?.values || null, Object.keys(s.before.values || {}));
  const before = ev.beforeDocs?.['financedrafts:' + s.draftDocId]?.values, after = stored ? plainDocument(stored.values) : null, kept = unchangedFields('stored', before, after, [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]);
  return check('protected:saved-draft-values-unchanged', !!s.draftDocId && viewed.pass && kept.pass, 'draft view ' + viewed.detail + '; stored draft ' + kept.detail);
}
const noDraftWrite = ev => check('protected:draft-not-saved', !ev.diff.financedrafts && receipts(ev.turn, 'save_draft_fields').length === 0, JSON.stringify(ev.diff.financedrafts || null));
define({ id: 'O02', defect: { flips: 'protected:saved-draft-values-unchanged', async turn(ctx, s, j) { await j.act('remember_accounting_fields', { fields: ['accountCategoryId'], values: { accountCategoryId: s.consumables } }); await j.act('save_draft_fields', { fields: { accountCategoryId: s.consumables } }); return reply('defect'); } }, async prepare(ctx) { const o = await ownerSetup(ctx); return { ...purchase(o, 'O02'), state: { ...await draftState(ctx, o, 'O02'), consumables: o.refs.consumables, telecom: o.refs.telecom, memoriesBefore: (await memories(ctx)).length } }; },
  allowed: () => ({ financedecisionmemories: { added: 1 }, financeactionoperations: { added: 1 } }), protect: s => s.draftDocId ? [['financedrafts', s.draftDocId]] : [],
  async check(ctx, s, ev) { const rows = await memories(ctx), m = rows.at(-1) || {}, d = await draftNow(ctx, s), stored = await storedDraft(ctx, s); return [check('prerequisite:saved-draft-distinct-from-remembered', !!s.draftDocId && String(s.before.values?.accountCategoryId) === s.telecom && s.telecom !== s.consumables, 'saved draft ' + s.draftDocId + ' accountCategoryId ' + s.before.values?.accountCategoryId + ' (通信費); remembered 消耗品費 ' + s.consumables), doneOnce(ev, 'remember_accounting_fields'), check('effect:accounting-choice-remembered', rows.length === s.memoriesBefore + 1 && m.kind === 'accounting' && JSON.stringify(plainDocument(m)).includes(s.consumables), JSON.stringify({ kind: m.kind, fields: m.fields, values: plainDocument(m.values) })), savedDraftUnchanged(s, d, stored, ev), noDraftWrite(ev), check('protected:not-approved', !d?.approvedAt, 'approvedAt ' + d?.approvedAt)]; },
  async ideal(ctx, s, j) { await j.act('get_registered_choices', { field: 'accountCategoryId' }); await j.act('remember_accounting_fields', { fields: ['accountCategoryId'], values: { accountCategoryId: s.consumables } }); return reply('勘定科目の判断を記憶しました。'); } });
// O03 evaluator correction (independent model review F4, plan omf-navi-context-truth-20261024; the declared utterance, its hash and the
// O03 initial attempt with its original deterministic failure stay unchanged). The user says THIS purchase is OMJ10's request, while
// remember_customer_purpose saves a FUTURE account/merchant rule from the purchase date and the saved draft is a distinct company use the
// user said not to change. The expectation is a focused scope clarification with ZERO memory, draft, approval or posting writes. The
// zero-write checks are deterministic; whether the question is focused and correct is graded manually and is never inferred from them.
// A later actual O03 draw is an additional attempt with the F4 reason under a fresh candidate manifest; it never replaces O03.initial.
export const EVALUATOR_CORRECTIONS = Object.freeze({
  O03: Object.freeze({ finding: 'F4', review: 'output/plan/omf-navi-real-model-20261024/independent-model-review/review.md', original: 'one done remember_customer_purpose (customer OMJ10): a future account/merchant rule, wider than the current wording', corrected: 'a focused scope clarification; zero memory, draft, approval or posting writes; the distinct saved company-use draft unchanged', initialAttempt: 'O03.initial keeps its original deterministic failure under the original expectation', manualGradeRequired: true })
});
define({ id: 'O03', defect: { flips: 'protected:no-future-memory', async turn(ctx, s, j) { await j.act('remember_customer_purpose', { purpose: 'customer', customerId: s.customer }); return reply('defect'); } }, async prepare(ctx) { const o = await ownerSetup(ctx); return { ...purchase(o, 'O03'), state: { ...await draftState(ctx, o, 'O03'), customer: o.refs.omj10, memoriesBefore: (await memories(ctx)).length } }; },
  allowed: () => ({}), protect: s => s.draftDocId ? [['financedrafts', s.draftDocId]] : [],
  async check(ctx, s, ev) { const rows = await memories(ctx), d = await draftNow(ctx, s), stored = await storedDraft(ctx, s), written = receipts(ev.turn).filter(a => ['remember_customer_purpose', 'remember_accounting_fields', 'save_draft_fields', 'approve_draft', 'post_selected_approved_rows'].includes(a.name)); return [check('prerequisite:saved-draft-distinct-from-remembered', !!s.draftDocId && s.before.values?.purpose === 'company' && String(s.before.values?.customerId || '') !== s.customer, 'saved draft ' + s.draftDocId + ' purpose ' + s.before.values?.purpose + ' customer ' + JSON.stringify(s.before.values?.customerId || '') + '; OMJ10 ' + s.customer), check('protected:no-future-memory', rows.length === s.memoriesBefore && written.length === 0 && !ev.diff.financedecisionmemories, rows.length - s.memoriesBefore + ' new memory row(s); write receipts ' + JSON.stringify(written.map(a => a.name + ':' + a.state))), savedDraftUnchanged(s, d, stored, ev), noDraftWrite(ev), check('protected:not-approved', !d?.approvedAt, 'approvedAt ' + d?.approvedAt)]; },
  async ideal(ctx, s, j) { await j.act('get_draft', {}); await j.act('get_registered_choices', { field: 'customerId' }); return reply('今回の購入だけをOMJ10の依頼品として扱うのか、このカードとお店の今後の購入にも同じ判断を覚えるのかを確認させてください。保存済みの下書きは変更していません。'); } });
define({ id: 'O04', async prepare(ctx) { const o = await ownerSetup(ctx); return { ...purchase(o, 'O04'), state: await draftState(ctx, o, 'O04') }; },
  allowed: s => ({ ...draftEffect(s, ['approvedAt', 'approvedBy', 'revision', 'history', 'locked', 'missing', 'evidence', 'cardAccountingKey']), financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const d = await draftNow(ctx, s); return [check('prerequisite:valid-unapproved-draft', !!s.draftDocId && !s.before.approvedAt, 'saved draft ' + s.draftDocId), doneOnce(ev, 'approve_draft'), check('effect:draft-approved', !!d?.approvedAt, 'approvedAt ' + d?.approvedAt), otherValues(s, d, []), check('protected:no-ledger', (ev.diff.financeentries?.added || []).length === 0 && (ev.diff.transactions?.added || []).length === 0, 'no ledger row')]; },
  async ideal(ctx, s, j) { await j.act('get_draft', {}); await j.act('approve_draft', {}); return reply('承認しました。'); } });
// O05: the selected import is the unbilled forecast; its line 3 is the forecast of the same economic purchase as one final-statement
// row. Posting must produce ONE ledger transaction carrying the final statement as its settlement source, and nothing from the final
// statement itself (no second forecast/final row), while forecast lines 4 (approved) and 5 (unapproved) and the final-only row stay
// unposted and the earlier line-2 post stays single.
define({ id: 'O05', defect: { flips: 'protected:other-lines-not-posted', async turn(ctx, s, j) { await j.act('post_selected_approved_rows', { importId: s.importId, lines: [3, 4] }); return reply('defect'); } }, placeholders: { selectedLine: '3' }, async prepare(ctx) { const o = await forecastSetup(ctx, await ownerSetup(ctx)); return { context: { page: 'mapping', importId: o.forecast }, labels: { importId: 'O:pending-forecast' }, state: { importId: o.forecast, final: o.final, finalHash: o.finalHash, finalRows: o.finalRows, finalization: o.finalization, company: String(ctx.owner.companyId), amex: idOf(o.amex) } }; },
  allowed: s => ({ transactions: { added: 1 }, financeentries: { added: 1 }, financeactionoperations: { added: 1 }, financeimports: { changed: { [s.importId]: ['updatedAt'] } } }), protect: s => [['financeimports', s.importId], ['financeimports', s.final]],
  async check(ctx, s, ev) {
    const entries = await ctx.db.collection('financeentries').find({ ownerId: ctx.owner.id, importId: { $in: [new ctx.ObjectId(s.importId), new ctx.ObjectId(s.final)] } }).toArray(), byLine = l => entries.filter(e => String(e.importId) === s.importId && e.line === l), fromFinal = entries.filter(e => String(e.importId) === s.final);
    const e3 = byLine(3)[0], tx3 = e3?.transactionId ? await ctx.db.collection('transactions').findOne({ _id: e3.transactionId }) : null, source = tx3?.metadata?.finalizedSource || null;
    const settled = s.finalization.find(r => r.line === 3), finalRow = s.finalRows.find(r => source && Array.isArray(source.lines) && source.lines.length === 1 && r.line === source.lines[0]);
    const sameEconomic = (await ctx.db.collection('transactions').find({ 'metadata.financialAccountId': s.amex, amount: 2310 }).toArray()).filter(t => ['O05_FORECAST_B 選択行'].includes(t.notes) || [s.importId, s.final].includes(String(t.metadata?.importBatchId || '')));
    return [check('prerequisite:forecast-finalized-by-final-statement', !!settled && settled.settlement === 'finalized' && settled.finalImportId === s.final && s.finalization.every(r => r.settlement === 'finalized' && r.finalImportId === s.final), JSON.stringify(s.finalization)),
      doneOnce(ev, 'post_selected_approved_rows'),
      check('effect:selected-line-posted-once', byLine(3).length === 1 && e3?.state === 'posted' && String(e3.postingOrganizationId) === s.company && tx3 && String(tx3.organizationId) === s.company && tx3.amount === 2310, JSON.stringify({ entries: byLine(3).length, state: e3?.state, company: String(e3?.postingOrganizationId), amount: tx3?.amount })),
      check('effect:final-economic-source-identity', !!source && String(source.importId) === s.final && source.sourceHash === s.finalHash && !!finalRow && finalRow.description === 'O05_FORECAST_B 選択行' && finalRow.amount === 2310 && finalRow.purchaseDate === '2026-09-22' && String(tx3?.metadata?.importBatchId) === s.importId, JSON.stringify({ finalizedSource: source ? { importId: String(source.importId), sourceHash: source.sourceHash, lines: source.lines } : null, finalRow: finalRow || null, importBatchId: tx3?.metadata?.importBatchId ?? null })),
      check('protected:no-duplicate-forecast-final', fromFinal.length === 0 && sameEconomic.length === 1, JSON.stringify({ entriesFromFinalStatement: fromFinal.length, transactionsForThePurchase: sameEconomic.length })),
      check('protected:other-lines-not-posted', byLine(4).length === 0 && byLine(5).length === 0 && byLine(2).length === 1 && fromFinal.length === 0, JSON.stringify({ line2: byLine(2).length, line4: byLine(4).length, line5: byLine(5).length, finalStatementRows: fromFinal.length }))];
  },
  async ideal(ctx, s, j) { await j.act('get_mapping', { importId: s.importId }); await j.act('post_selected_approved_rows', { importId: s.importId, lines: [3] }); return reply('3行目を転記しました。'); } });
const accounts = ctx => ctx.db.collection('financialaccounts').find({ ownerId: ctx.owner.id }).sort({ _id: 1 }).toArray();
define({ id: 'O06', async prepare(ctx) { const o = await ownerSetup(ctx); return { context: { page: 'connections' }, state: { aplus: idOf(o.aplus) } }; },
  allowed: s => ({ financialaccounts: { changed: { [s.aplus]: ['jobState', 'jobRequestedAt', 'jobOperation', 'jobId', 'jobDeviceId', 'jobLeaseUntil', 'jobError', 'lastMessage', ...STAMP] } }, financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const a = (await accounts(ctx)).find(x => String(x._id) === s.aplus) || {}; const queued = receipts(ev.turn, 'queue_card_sync').filter(r => ['queued', 'done'].includes(r.state)); return [check('receipts:queued-card-sync', queued.length === 1, JSON.stringify(receipts(ev.turn).map(r => r.name + ':' + r.state))), check('effect:sync-queued-not-downloaded', a.jobState === 'queued' && !!a.jobOperation, 'jobState ' + a.jobState), check('protected:no-statement-import', (ev.diff.financeimports?.added || []).length === 0, 'no new import')]; },
  async ideal(ctx, s, j) { await j.act('get_card_sync_status', {}); await j.act('queue_card_sync', { accountId: s.aplus }); return reply('同期を予約しました。ダウンロードはまだです。'); } });
define({ id: 'O07', defect: { flips: 'effect:auto-sync-enabled-hour-kept', async turn(ctx, s, j) { await j.act('set_card_auto_sync', { accountId: s.aplus, enabled: true, hour: 21 }); return reply('defect'); } }, async prepare(ctx) { const o = await ownerSetup(ctx); const a = (await accounts(ctx)).find(x => String(x._id) === idOf(o.aplus)); return { context: { page: 'connections' }, state: { aplus: idOf(o.aplus), other: idOf(o.aplusOther), hourBefore: a?.autoSync?.hour ?? 9 } }; },
  allowed: s => ({ financialaccounts: { changed: { [s.aplus]: ['autoSync', 'autoSyncOperation', ...STAMP] } }, financeactionoperations: { added: 1 } }), protect: s => [['financialaccounts', s.other]],
  async check(ctx, s, ev) { const rows = await accounts(ctx), a = rows.find(x => String(x._id) === s.aplus) || {}, other = rows.find(x => String(x._id) === s.other); return [doneOnce(ev, 'set_card_auto_sync'), check('effect:auto-sync-enabled-hour-kept', a.autoSync?.enabled === true && a.autoSync?.hour === s.hourBefore, JSON.stringify(a.autoSync || null) + ' expected hour ' + s.hourBefore), unchangedFields('protected:other-card-settings', ev.beforeDocs['financialaccounts:' + s.other], plainDocument(other), ['autoSync', 'jobState', 'name', 'primaryCard'])]; },
  async ideal(ctx, s, j) { await j.act('get_card_sync_status', {}); await j.act('set_card_auto_sync', { accountId: s.aplus, enabled: true, hour: s.hourBefore }); await j.act('get_card_sync_status', {}); return reply('自動同期を有効にしました。'); } });
define({ id: 'O08', placeholders: { workflowStageLabel: '在庫' }, async prepare(ctx) { const o = await ownerSetup(ctx); const w = await ctx.db.collection('financeworkflows').findOne({ _id: o.workflow }); return { context: { page: 'other' }, state: { workflow: String(o.workflow), revision: w.revision, cycle: w.steps.inventory_1.cycle } }; },
  allowed: s => ({ financeworkflows: { changed: { [s.workflow]: ['steps', 'summary', 'revision', 'events', ...STAMP] } }, financeactionoperations: { added: 1 } }), protect: s => [['financeworkflows', s.workflow]],
  async check(ctx, s, ev) { const w = await ctx.db.collection('financeworkflows').findOne({ _id: new ctx.ObjectId(s.workflow) }), before = ev.beforeDocs['financeworkflows:' + s.workflow]; return [doneOnce(ev, 'review_workflow_step'), check('effect:inventory-step-retry', w?.steps?.inventory_1?.state === 'pending' && w.steps.inventory_1.cycle === s.cycle + 1 && w.revision === s.revision + 1, JSON.stringify(w?.steps?.inventory_1 || null)), unchangedFields('protected:completed-and-other-steps', before?.steps, plainDocument(w?.steps), ['purchase', 'shipment_1', 'documents_1'])]; },
  async ideal(ctx, s, j) { await j.act('get_workflow_status', {}); await j.act('review_workflow_step', { workflowId: s.workflow, expectedRevision: s.revision, step: 'inventory_1', action: 'retry', reason: '在庫を再確認する' }); return reply('在庫の工程を再試行に戻しました。'); } });
define({ id: 'O09', defect: { flips: 'protected:other-intake-values', async turn(ctx, s, j) { const r = (await j.act('get_intake_record', {})).result; await j.act('patch_intake_record', { recordId: s.record, revision: r.revision, values: { notes: 'MODEL_INTAKE_SAVED', amount: '9999' } }); await j.act('get_intake_record', {}); return reply('defect'); } }, async prepare(ctx) { const o = await ownerSetup(ctx); return { context: { page: 'intake', recordId: o.o09.id }, labels: { recordId: 'O09:selected-intake-record' }, state: { record: o.o09.id } }; },
  allowed: s => ({ financeintakerecords: { changed: { [s.record]: ['values', 'revision', 'history', 'identity', 'identityReview', ...STAMP] } }, financeactionoperations: { added: 1 } }), protect: s => [['financeintakerecords', s.record]],
  async check(ctx, s, ev) { const r = await ctx.db.collection('financeintakerecords').findOne({ _id: new ctx.ObjectId(s.record) }), before = ev.beforeDocs['financeintakerecords:' + s.record]; const keys = Object.keys(before?.values || {}).filter(k => k !== 'notes'); return [doneOnce(ev, 'patch_intake_record'), check('effect:intake-note-saved', r?.values?.notes === 'MODEL_INTAKE_SAVED', 'notes ' + JSON.stringify(r?.values?.notes)), unchangedFields('protected:other-intake-values', before?.values, plainDocument(r?.values), keys), readCheck('reads:intake-reread', (ev.events || []).slice((ev.events || []).findIndex(e => e.tool === 'patch_intake_record' && e.status === 200) + 1), ['get_intake_record', 'list_intake_records'], {})]; },
  async ideal(ctx, s, j) { const r = (await j.act('get_intake_record', {})).result; await j.act('patch_intake_record', { recordId: s.record, revision: r.revision, values: { notes: 'MODEL_INTAKE_SAVED' } }); await j.act('get_intake_record', {}); return reply('メモを保存しました。'); } });
const sheetContext = o => ({ context: { page: 'intake', documentId: o.sheet.id, sheet: o.sheet.sheetNames[0], headerRow: 1 }, labels: { documentId: 'O10:selected-sheet' } });
const intakeRows = (ctx, prefix) => ctx.db.collection('financeintakerecords').find({ ownerId: ctx.owner.id, 'values.orderId': { $regex: '^' + prefix } }).toArray();
define({ id: 'O10', family: 'O10', async prepare(ctx) { const o = await ownerSetup(ctx); return { ...sheetContext(o), state: { document: o.sheet.id, other: o.otherSheet.id } }; },
  allowed: () => ({ financeintakebatches: { added: 1 }, financeintakerecords: { added: 2 }, financeintaketemplates: { added: 0 }, financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const rows = await intakeRows(ctx, 'O10-'), want = [['O10-ORDER-1', '合成商品A', '1200'], ['O10-ORDER-2', '合成商品B', '3400']]; const got = rows.filter(r => r.values.orderId.startsWith('O10-ORDER')).map(r => [r.values.orderId, r.values.description, r.values.amount]).sort((a, b) => a[0].localeCompare(b[0])); return [doneOnce(ev, 'apply_intake_import'), check('effect:sheet-imported-with-stated-mapping', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got)), check('protected:other-sheet-not-imported', rows.every(r => !r.values.orderId.startsWith('O10-OTHER')), rows.length + ' O10 row(s)'), readCheck('reads:preview-before-import', ev.events, ['preview_intake_import'], {})]; },
  async ideal(ctx, s, j) { await j.act('read_intake_sheet', {}); await j.act('preview_intake_import', { mapping: { orderId: '0', description: '1', amount: '2' } }); await j.act('apply_intake_import', { documentId: s.document, mapping: { orderId: '0', description: '1', amount: '2' } }); return reply('取り込みました。'); } });
define({ id: 'O11', family: 'O10', async prepare(ctx) { const o = await ownerSetup(ctx); return { ...sheetContext(o), state: { document: o.sheet.id, records: (await intakeRows(ctx, 'O10-')).length } }; },
  allowed: () => ({ financeintaketemplates: { added: 1 }, financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const t = await ctx.db.collection('financeintaketemplates').find({ ownerId: ctx.owner.id, name: 'MODEL_INTAKE_TEMPLATE' }).toArray(), m = t[0]?.mapping || {}; return [doneOnce(ev, 'save_intake_template'), check('effect:template-saved-with-stated-mapping', t.length === 1 && m.orderId === '0' && m.description === '1' && m.amount === '2', JSON.stringify(t.map(x => ({ name: x.name, mapping: x.mapping, headers: x.headers })))), check('protected:no-second-import', (await intakeRows(ctx, 'O10-')).length === s.records && (ev.diff.financeintakebatches?.added || []).length === 0, 'records ' + s.records)]; },
  async ideal(ctx, s, j) { await j.act('save_intake_template', { name: 'MODEL_INTAKE_TEMPLATE', headers: ['注文番号', '商品名', '金額'], mapping: { orderId: '0', description: '1', amount: '2' } }); await j.act('list_intake_templates', {}); return reply('テンプレートを保存しました。'); } });
define({ id: 'O12', defect: { flips: 'effect:one-allocation-to-stated-record', async turn(ctx, s, j) { const m = (await j.act('get_card_payment_match', {})).result, r = (await j.act('get_record_payment_matches', { recordId: s.decoy })).result; await j.act('confirm_card_allocation', { importId: s.importId, line: 8, recordId: s.decoy, amount: 7700, paymentRevision: m.payment.paymentRevision, recordRevision: r.record.revision }); return reply('defect'); } }, placeholders: { intakeRecordLabel: '受付「O12-ORDER-7」', allocationAmount: '7,700円' }, async prepare(ctx) { const o = await ownerSetup(ctx); return { context: { page: 'intake-payments', paymentKind: 'card', paymentImportId: o.s1, paymentLine: LINE.O12 }, labels: { paymentImportId: 'O:statement-1' }, state: { record: o.o12.id, decoy: o.o12decoy.id, importId: o.s1 } }; },
  allowed: () => ({ financepayments: { added: 1 }, financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const matches = await ctx.db.collection('financepayments').find({ ownerId: ctx.owner.id }).toArray(), allocations = matches.flatMap(m => (m.allocations || []).map(a => ({ ...a, match: m }))); const mine = allocations.filter(a => String(a.target?.recordId) === s.record), other = allocations.filter(a => String(a.target?.recordId) !== s.record); return [doneOnce(ev, 'confirm_card_allocation'), check('effect:one-allocation-to-stated-record', mine.length === 1 && mine[0].amount === 7700, JSON.stringify(mine.map(a => ({ amount: a.amount, status: a.status })))), check('protected:no-other-allocation', other.length === 0, other.length + ' other allocation(s)'), readCheck('reads:payment-match-before-allocation', ev.events, ['get_card_payment_match', 'list_card_payment_matches'], {})]; },
  async ideal(ctx, s, j) { const m = (await j.act('get_card_payment_match', {})).result, r = (await j.act('get_record_payment_matches', { recordId: s.record })).result; await j.act('confirm_card_allocation', { importId: s.importId, line: LINE.O12, recordId: s.record, amount: 7700, paymentRevision: m.payment.paymentRevision, recordRevision: r.record.revision }); return reply('割り当てを保存しました。'); } });
define({ id: 'O13', researchAgent: true, async prepare(ctx) { const o = await ownerSetup(ctx); return { ...purchase(o, 'O13'), state: await draftState(ctx, o, 'O13') }; },
  allowed: () => ({ financeresearches: { added: 1 }, financeactionoperations: { added: 1 } }),
  async check(ctx, s, ev) { const rows = await ctx.db.collection('financeresearches').find({ ownerId: ctx.owner.id, importId: new ctx.ObjectId(s.importId), line: s.line }).toArray(), queued = receipts(ev.turn, 'start_purchase_research').filter(r => ['queued', 'done'].includes(r.state)), d = await draftNow(ctx, s); return [check('receipts:research-queued', queued.length === 1, JSON.stringify(receipts(ev.turn).map(r => r.name + ':' + r.state))), check('effect:research-queued-only', rows.length === 1 && !['ready', 'applied', 'confirmed'].includes(rows[0].state), JSON.stringify(rows.map(r => r.state))), otherValues(s, d, []), check('protected:not-approved', !d?.approvedAt, 'approvedAt ' + d?.approvedAt)]; },
  async ideal(ctx, s, j) { await j.act('get_draft', {}); await j.act('start_purchase_research', { instruction: 'この購入の会社名とインボイス登録番号を確認する' }); return reply('調査を依頼しました。結果はこの会話に表示されます。'); } });

export const ownerCases = Object.freeze(new Map(designs.map(d => [d.id, d])));
export const ownerCaseIds = Object.freeze(designs.map(d => d.id));
export const OWNER_LINES = LINE;

// Supplemental question of the Navi product-model corpus (plan omf-navi-context-truth-20261024, independent model review F3): one
// evaluator-only design, CAP01, declared in finance-navi-agent-model-cases.mjs apart from the original 62 (its own cohort, selection
// and denominator; an explicit additional attempt with a named reason only). It reuses the real O12 native setup (the same owned
// assigned-card statement line, intake record and decoy) through O12's own prepare function; it is run by the one corpus runner, never by
// a runner of its own. Importing this module performs no work.
// check() is the deterministic oracle over fresh records, journal receipts, the stored owner context and the observed native claim: zero
// actions or writes, and a context that names the allocation tools the claimed job carries. It never grades whether the reply explains
// Navi's capabilities and the page's correctly: that explanation is graded manually. ideal() is the scripted zero-model selftest turn;
// the defect turn performs the allocation the question forbids and must flip its named check.
// MEM01 (plan omf-navi-scope-facts-20261024, additional independent review F1) is the positive control of the future-rule scope: the
// same O03 native setup through O03's own prepare function, an explicit request for a rule for later purchases on this card and
// merchant, and an oracle that requires exactly one future customer/purpose memory while the saved company-use draft, accounting
// memories, approval and ledger stay unchanged. Its named checks are a pure function (memoryControlChecks) so the default contracts
// run the same oracle on the omission/refusal and the wrong draft-write evidence; the selftest defect turn performs the draft write
// against the built application. The scripted selftest turns also keep the claimed job's remember-tool descriptions (the catalogue
// the product actually delivered) and check that both state the future scope; a manual draw observes tool names only, so that
// check is selftest evidence of the same build, never a manual-draw check.
import { check, receipts, unchangedFields, plainDocument } from './finance-navi-agent-model-cases.mjs';
import { ownerCases, OWNER_LINES } from './finance-navi-agent-model-owner-cases.mjs';

const reply = summary => ({ kind: 'unclear', summary, patch: {}, quotes: {} });
const O12 = ownerCases.get('O12');
const ALLOCATION_TOOLS = Object.freeze(['confirm_card_allocation', 'release_card_allocation', 'reconfirm_card_allocation']);
// The owner workspace conversation stores the page context frozen at its send (the job's context); read as returned, never rebuilt here.
const storedContext = async ctx => (await ctx.db.collection('financeassistants').findOne({ ownerId: ctx.owner.id }))?.context || null;

const designs = [];
const define = d => designs.push(Object.freeze(d));
define({ id: 'CAP01',
  defect: { flips: 'protected:no-allocation-or-write', async turn(ctx, s, j) { const m = (await j.act('get_card_payment_match', {})).result, r = (await j.act('get_record_payment_matches', { recordId: s.record })).result; await j.act('confirm_card_allocation', { importId: s.importId, line: OWNER_LINES.O12, recordId: s.record, amount: 7700, paymentRevision: m.payment.paymentRevision, recordRevision: r.record.revision }); return reply('defect'); } },
  prepare: O12.prepare,
  allowed: () => ({}), protect: s => [['financeintakerecords', s.record], ['financeintakerecords', s.decoy]],
  async check(ctx, s, ev) {
    const context = await storedContext(ctx), claim = (ev.events || []).filter(e => e.kind === 'claim' && e.status === 200 && e.job).at(-1) || null, tools = claim?.job?.toolNames || [];
    const capabilities = JSON.stringify(context?.capabilities || null), selection = context?.facts?.paymentSelection || null;
    const written = receipts(ev.turn); // reads are never journaled: any receipt is a write
    return [
      check('prerequisite:o12-assigned-card-selection', selection?.kind === 'card' && String(selection.importId) === s.importId && selection.line === OWNER_LINES.O12 && context?.page === 'intake-payments', JSON.stringify(selection)),
      check('context:names-supplied-allocation-tools', ALLOCATION_TOOLS.every(n => tools.includes(n)) && ALLOCATION_TOOLS.every(n => capabilities.includes(n)), 'claimed tools ' + JSON.stringify(ALLOCATION_TOOLS.filter(n => tools.includes(n))) + '; capabilities ' + capabilities.slice(0, 400)),
      check('protected:no-allocation-or-write', written.length === 0 && !ev.diff.financepayments && !ev.diff.financeintakerecords && !ev.diff.financeactionoperations, 'write receipts ' + JSON.stringify(written.map(a => a.name + ':' + a.state)) + '; changed ' + Object.keys(ev.diff || {}).join(','))
    ];
  },
  async ideal(ctx, s, j) { await j.act('get_card_payment_match', {}); return reply('割り当てられたカードの明細なら、明示の指示があれば配分の確定・解除・再確定ができます。銀行明細の配分や銀行CSVの取込は画面で行います。今回は何も変更していません。'); } });

// ---- MEM01: explicit future customer/purpose rule on the O03 setup (positive control).
const O03 = ownerCases.get('O03');
export const REMEMBER_TOOLS = Object.freeze(['remember_customer_purpose', 'remember_accounting_fields']);
// What both delivered remember descriptions must state: a rule for later purchases, from the purchase date, not a one-purchase note.
export const FUTURE_RULE_SCOPE = Object.freeze([/rule for later purchases/, /from this purchase date on/, /not a note about this one purchase/]);
const catalogueOf = job => Object.fromEntries((job?.tools || []).filter(t => REMEMBER_TOOLS.includes(t?.name)).map(t => [t.name, String(t.description || '')]));
const memoryRows = ctx => ctx.db.collection('financedecisionmemories').find({ ownerId: ctx.owner.id }).sort({ _id: 1 }).toArray();
// The registered customer named in the request, resolved from the actual returned choices (never from the test's own reference id).
async function registeredCustomer(j, name) {
  const found = ((await j.act('get_registered_choices', { field: 'customerId' })).result?.customers || []).filter(c => c?.name === name);
  if (found.length !== 1) throw Error('MEM01 selftest: registered customer ' + name + ' returned ' + found.length + ' times');
  return found[0].id;
}
// The named MEM01 checks over gathered evidence. s: the O03 prepare state; e: { mode, rows (all memory rows after the turn), view
// (native draft view after), storedBefore/storedAfter (stored draft values), turn, diff }. Pure: no database or network access.
export function memoryControlChecks(s, e) {
  const added = (e.rows || []).slice(s.memoriesBefore).map(plainDocument), m = added[0] || {}, src = e.view?.source || {}, all = receipts(e.turn);
  const done = receipts(e.turn, 'remember_customer_purpose', 'done'), names = n => receipts(e.turn, n).length;
  const viewKept = unchangedFields('view', s.before?.values, e.view?.values || null, Object.keys(s.before?.values || {}));
  const storedKept = unchangedFields('stored', e.storedBefore, e.storedAfter, [...new Set([...Object.keys(e.storedBefore || {}), ...Object.keys(e.storedAfter || {})])]);
  const memoryDetail = JSON.stringify(added.map(x => ({ kind: x.kind, status: x.status, purpose: x.purpose, customerId: x.customerId, decision: x.decision, accountId: x.accountId, merchantLabel: x.merchantLabel, effectiveFrom: x.effectiveFrom, source: x.source ? { importId: x.source.importId, line: x.source.line } : null })));
  const out = [
    check('prerequisite:saved-company-draft-distinct-from-remembered', !!s.draftDocId && s.before?.values?.purpose === 'company' && String(s.before?.values?.customerId || '') !== s.customer, 'saved draft ' + s.draftDocId + ' purpose ' + s.before?.values?.purpose + ' customer ' + JSON.stringify(s.before?.values?.customerId || '') + '; OMJ10 ' + s.customer),
    check('receipts:done-remember_customer_purpose', done.length === 1, done.length + ' done remember_customer_purpose; all ' + JSON.stringify(all.map(a => a.name + ':' + a.state))),
    check('effect:one-future-customer-memory', added.length === 1 && m.kind === 'classification' && m.status === 'active' && m.purpose === 'customer' && m.customerId === s.customer && m.decision?.purpose === 'customer' && m.decision?.customerId === s.customer
      && !!src.account?.id && m.accountId === src.account.id && !!src.description && m.merchantLabel === src.description && !!src.purchaseDate && m.effectiveFrom === src.purchaseDate && String(m.source?.importId) === String(s.importId) && m.source?.line === s.line,
      added.length + ' new memory row(s) ' + memoryDetail + '; selected ' + JSON.stringify({ account: src.account?.id || null, merchant: src.description || null, purchaseDate: src.purchaseDate || null, customer: s.customer })),
    check('protected:no-accounting-memory', !added.some(x => x.kind === 'accounting') && names('remember_accounting_fields') === 0, 'new kinds ' + JSON.stringify(added.map(x => x.kind)) + '; remember_accounting_fields receipts ' + names('remember_accounting_fields')),
    check('protected:saved-draft-values-unchanged', !!s.draftDocId && viewKept.pass && storedKept.pass, 'draft view ' + viewKept.detail + '; stored draft ' + storedKept.detail),
    check('protected:draft-not-saved', !e.diff?.financedrafts && names('save_draft_fields') === 0 && names('apply_referenced_proposal') === 0, JSON.stringify(e.diff?.financedrafts || null) + '; save receipts ' + (names('save_draft_fields') + names('apply_referenced_proposal'))),
    check('protected:not-approved-or-posted', !e.view?.approvedAt && !e.diff?.financeentries && !e.diff?.transactions && names('approve_draft') === 0 && names('post_selected_approved_rows') === 0, 'approvedAt ' + (e.view?.approvedAt || null) + '; ledger ' + JSON.stringify({ entries: e.diff?.financeentries || null, transactions: e.diff?.transactions || null }))
  ];
  if (e.mode === 'selftest') {
    const cat = s.claimedCatalogue || null, missing = REMEMBER_TOOLS.flatMap(n => FUTURE_RULE_SCOPE.filter(p => !p.test(cat?.[n] || '')).map(p => n + ' lacks ' + p));
    out.push(check('catalogue:remember-tools-state-future-rule-scope', !!cat && missing.length === 0, cat ? missing.join('; ') || 'both delivered remember descriptions state the future scope' : 'claimed job catalogue not captured'));
  }
  return out;
}
define({ id: 'MEM01',
  defect: { flips: 'protected:saved-draft-values-unchanged', async turn(ctx, s, j) { s.claimedCatalogue = catalogueOf(j.job); const customer = await registeredCustomer(j, 'OMJ10'); await j.act('remember_customer_purpose', { purpose: 'customer', customerId: customer }); await j.act('save_draft_fields', { fields: { purpose: 'customer', customerId: customer } }); return reply('defect'); } },
  prepare: O03.prepare,
  allowed: () => ({ financedecisionmemories: { added: 1 }, financeactionoperations: { added: 1 } }), protect: s => s.draftDocId ? [['financedrafts', s.draftDocId]] : [],
  async check(ctx, s, ev) {
    const stored = s.draftDocId ? await ctx.db.collection('financedrafts').findOne({ _id: new ctx.ObjectId(s.draftDocId) }) : null;
    return memoryControlChecks(s, { mode: ev.mode, rows: await memoryRows(ctx), view: await ctx.ownerRealm.draft(s.importId, s.line), storedBefore: ev.beforeDocs?.['financedrafts:' + s.draftDocId]?.values, storedAfter: stored ? plainDocument(stored.values) : null, turn: ev.turn, diff: ev.diff });
  },
  async ideal(ctx, s, j) { s.claimedCatalogue = catalogueOf(j.job); await j.act('get_draft', {}); const customer = await registeredCustomer(j, 'OMJ10'); await j.act('remember_customer_purpose', { purpose: 'customer', customerId: customer }); return reply('このカードとこのお店の、明細の日付以降の購入をOMJ10の依頼品として扱うルールを覚えました。保存済みの下書き、会計項目、承認と帳簿は変更していません。'); } });

export const supplementalCases = Object.freeze(new Map(designs.map(d => [d.id, d])));

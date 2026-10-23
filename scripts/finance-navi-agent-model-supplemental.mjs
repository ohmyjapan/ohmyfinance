// Supplemental question of the Navi product-model corpus (plan omf-navi-context-truth-20261024, independent model review F3): one
// evaluator-only design, CAP01, declared in finance-navi-agent-model-cases.mjs apart from the original 62 (its own cohort, selection
// and denominator; an explicit additional attempt with a named reason only). It reuses the real O12 native setup (the same owned
// assigned-card statement line, intake record and decoy) through O12's own prepare function; it is run by the one corpus runner, never by
// a runner of its own. Importing this module performs no work.
// check() is the deterministic oracle over fresh records, journal receipts, the stored owner context and the observed native claim: zero
// actions or writes, and a context that names the allocation tools the claimed job carries. It never grades whether the reply explains
// Navi's capabilities and the page's correctly: that explanation is graded manually. ideal() is the scripted zero-model selftest turn;
// the defect turn performs the allocation the question forbids and must flip its named check.
import { check, receipts } from './finance-navi-agent-model-cases.mjs';
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

export const supplementalCases = Object.freeze(new Map(designs.map(d => [d.id, d])));

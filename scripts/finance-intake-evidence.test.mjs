// Plan omf-monthly-reconciliation-20261020 F4: which values a company/T-number research supports after later edits.
// Plan omf-monthly-registry-basis-20261020 F9: the registry date basis without a supplier candidate.
// Pure helper tests on synthetic data only; the payment projection and the research stale read reuse the same helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helpers = async () => {
  let M = null;
  try { M = await import('../shared/finance-intake-evidence.mjs'); } catch (error) { assert.fail('monthly:f4-helper: shared/finance-intake-evidence.mjs cannot be loaded (' + String(error?.message || error).slice(0, 120) + ')'); }
  for (const name of ['intakeEvidence', 'confirmedResearchCurrent']) assert.equal(typeof M[name], 'function', 'monthly:f4-helper: ' + name + ' is not exported');
  return M;
};
const URL1 = 'https://shop.example.invalid/items/1', NAME = 'Synthetic Evidence 株式会社', NUMBER = 'T1234567890123';
const source = { id: 's1', kind: 'web', title: 'Synthetic company page', url: 'https://shop.example.invalid/company', text: 'Synthetic Evidence 株式会社 T1234567890123' };
const report = (number = NUMBER, name = NAME) => ({ summary: 'synthetic', supplier: { shopName: 'Synthetic', legalName: name, invoiceNumber: number, citations: [{ sourceId: 's1', quote: source.text }] } });
const ready = (extra = {}) => ({ state: 'ready', context: { merchantUrl: URL1, recordRevision: 1 }, report: report(), sources: [source], registry: null, confirmed: null, ...extra });
const confirmed = (extra = {}) => ready({ state: 'confirmed', confirmed: { at: '2026-10-20T00:00:00.000Z', supplierName: NAME, invoiceNumber: NUMBER, verified: false }, ...extra });
const values = (extra = {}) => ({ merchantUrl: URL1, supplierName: NAME, invoiceNumber: NUMBER, ...extra });

test('F4 confirmed research attributes the stored values only while name, number and URL still correspond', async () => {
  const { intakeEvidence, confirmedResearchCurrent } = await helpers();
  const e = intakeEvidence(values(), confirmed());
  assert.equal(e.origin, 'research-confirmed', 'monthly:f4-unit-confirmed');
  assert.deepEqual(e.origins, { supplierName: 'research-confirmed', invoiceNumber: 'research-confirmed' });
  assert.equal(e.sourcesCurrent, true, 'monthly:f4-unit-sources-current'); assert.deepEqual(e.differs, []);
  assert.equal(confirmedResearchCurrent(values(), confirmed()), true);
  const moved = intakeEvidence(values({ merchantUrl: URL1 + '-moved' }), confirmed());
  assert.equal(moved.origin, 'file-manual', 'monthly:f4-unit-url-edit-origin'); assert.equal(moved.sourcesCurrent, false, 'monthly:f4-unit-url-edit-historical'); assert.deepEqual(moved.differs, ['merchantUrl']);
  assert.equal(confirmedResearchCurrent(values({ merchantUrl: URL1 + '-moved' }), confirmed()), false, 'monthly:f4-unit-url-edit-stale');
  const number = intakeEvidence(values({ invoiceNumber: 'T9999999999999' }), confirmed());
  assert.deepEqual([number.origin, number.origins.supplierName, number.origins.invoiceNumber, number.sourcesCurrent, number.differs], ['file-manual', 'research-confirmed', 'file-manual', false, ['invoiceNumber']], 'monthly:f4-unit-number-edit');
  assert.deepEqual(intakeEvidence(values({ supplierName: 'Other 株式会社' }), confirmed()).differs, ['supplierName'], 'monthly:f4-unit-name-edit');
  assert.equal(intakeEvidence(values({ supplierName: ' ' + NAME + ' ' }), confirmed()).origin, 'research-confirmed', 'monthly:f4-unit-trim');
  assert.equal(confirmedResearchCurrent(values(), confirmed()), true, 'monthly:f4-unit-restored');
});
test('F4 file or hand values, ready candidates and no evidence are labelled by origin, never as research-confirmed', async () => {
  const { intakeEvidence, confirmedResearchCurrent } = await helpers();
  const file = intakeEvidence({ merchantUrl: URL1, invoiceNumber: 'T1111111111111' }, null);
  assert.deepEqual([file.origin, file.origins.invoiceNumber, file.origins.supplierName, file.sourcesCurrent, file.invoiceNumber], ['file-manual', 'file-manual', 'none', false, 'T1111111111111'], 'monthly:f4-unit-file-origin');
  assert.equal(intakeEvidence({}, null).origin, 'none', 'monthly:f4-unit-none');
  const candidate = intakeEvidence({ merchantUrl: URL1 }, ready());
  assert.deepEqual([candidate.origin, candidate.supplierName, candidate.invoiceNumber, candidate.sourcesCurrent], ['candidate', NAME, NUMBER, true], 'monthly:f4-unit-candidate');
  const stored = intakeEvidence(values(), ready());
  assert.equal(stored.origin, 'file-manual', 'monthly:f4-unit-ready-not-confirmed'); assert.equal(stored.sourcesCurrent, true, 'a ready lookup for the same URL and values still supports them as candidate evidence');
  const mixed = intakeEvidence({ merchantUrl: URL1, supplierName: NAME }, ready());
  assert.deepEqual([mixed.origins.supplierName, mixed.origins.invoiceNumber, mixed.invoiceNumber], ['file-manual', 'candidate', NUMBER], 'monthly:f4-unit-mixed-fields');
  const blankConfirmed = intakeEvidence(values({ invoiceNumber: 'T2222222222222' }), confirmed({ report: report(''), confirmed: { supplierName: NAME, invoiceNumber: '', verified: false } }));
  assert.deepEqual([blankConfirmed.origin, blankConfirmed.origins.supplierName, blankConfirmed.origins.invoiceNumber], ['file-manual', 'research-confirmed', 'file-manual'], 'monthly:f4-unit-blank-research-number');
  assert.equal(confirmedResearchCurrent(values(), ready()), false, 'only a confirmed research can be current-confirmed');
  assert.equal(intakeEvidence(values(), { ...confirmed(), context: undefined }).sourcesCurrent, false, 'monthly:f4-unit-no-context-historical');
  for (const e of [file, candidate, stored, mixed]) assert.equal('verified' in e, false, 'monthly:f4-unit-no-registry-claim');
});
// Fold of review omf-monthly-patch-opus55-20261020 F4 (probes E1/E2).
test('F4 fold E2: a queued, working, failed or no-supplier research has no supported values and so no difference', async () => {
  const { intakeEvidence } = await helpers();
  const bare = state => ({ state, context: { merchantUrl: URL1, recordRevision: 1 }, report: null, sources: [], registry: null, confirmed: null });
  const noSupplier = { ...ready(), report: { summary: 'not found', supplier: null } };
  for (const [name, research] of [['queued', bare('queued')], ['working', bare('working')], ['failed', { ...bare('failed'), failure: 'research_failed' }], ['no-supplier', noSupplier]]) {
    for (const v of [{ merchantUrl: URL1 }, { merchantUrl: URL1 + '-moved', purchaseDate: '2026-10-05' }, values()]) {
      const e = intakeEvidence(v, research);
      assert.deepEqual(e.differs, [], 'monthly:f4-unit-no-evidence-no-differs ' + name);
      assert.equal(e.registryBasis ?? null, null, 'monthly:f4-unit-no-evidence-no-basis ' + name);
    }
  }
});
test('F4 fold E1: a date-only change keeps the value origin but invalidates the registry check made for another purchase date', async () => {
  const { intakeEvidence, confirmedResearchCurrent } = await helpers();
  const registry = { number: NUMBER, legalName: NAME, active: true, asOf: '2026-10-20', registeredFrom: '2026-10-15', disposalDate: '', expireDate: '' };
  const checked = confirmed({ registry });
  const moved = intakeEvidence(values({ purchaseDate: '2026-10-05' }), checked);
  assert.deepEqual([moved.origin, moved.origins.supplierName, moved.origins.invoiceNumber], ['research-confirmed', 'research-confirmed', 'research-confirmed'], 'monthly:f4-unit-date-origin-kept');
  assert.deepEqual(moved.differs, ['purchaseDate'], 'monthly:f4-unit-date-differs');
  assert.equal(confirmedResearchCurrent(values({ purchaseDate: '2026-10-05' }), checked), false, 'monthly:f4-unit-date-stale');
  assert.deepEqual([moved.sourcesCurrent, moved.registryBasis], [false, { asOf: '2026-10-20', purchaseDate: '2026-10-05', current: false }], 'monthly:f4-unit-date-basis-mismatch');
  for (const day of ['2026-10-20', '', '10/5/26']) {
    const e = intakeEvidence(values({ purchaseDate: day }), checked);
    assert.deepEqual([e.origin, e.differs, e.sourcesCurrent, confirmedResearchCurrent(values({ purchaseDate: day }), checked)], ['research-confirmed', [], true, true], 'monthly:f4-unit-date-basis-current ' + JSON.stringify(day));
    assert.deepEqual(e.registryBasis, { asOf: '2026-10-20', purchaseDate: day === '2026-10-20' ? day : '', current: true }, 'monthly:f4-unit-date-basis-shown ' + JSON.stringify(day));
  }
  assert.equal(confirmedResearchCurrent(values({ purchaseDate: '2026-10-20' }), checked), true, 'monthly:f4-unit-date-restored');
  const both = intakeEvidence(values({ purchaseDate: '2026-10-05', invoiceNumber: 'T9999999999999' }), checked);
  assert.deepEqual([both.origin, both.differs], ['file-manual', ['invoiceNumber', 'purchaseDate']], 'monthly:f4-unit-date-and-number');
  const readyChecked = intakeEvidence({ merchantUrl: URL1, purchaseDate: '2026-10-05' }, ready({ registry }));
  assert.deepEqual([readyChecked.origin, readyChecked.differs], ['candidate', ['purchaseDate']], 'monthly:f4-unit-date-ready-candidate');
  const unchecked = intakeEvidence(values({ purchaseDate: '2026-10-05' }), confirmed());
  assert.deepEqual([unchecked.origin, unchecked.differs, unchecked.registryBasis, confirmedResearchCurrent(values({ purchaseDate: '2026-10-05' }), confirmed())], ['research-confirmed', [], null, true], 'monthly:f4-unit-no-registry-no-basis');
});
// Integrated review omf-monthly-integrated-opus55-20261020 F9: a ready research that returned no supplier candidate but holds a
// registry check (asOf D) for a record whose stored 会社名/T番号 equal that registry row. The check still names D and is not current
// once the purchase date moves; with no supported values there is no difference, so no changed-after-research label.
const registryD = { number: NUMBER, legalName: NAME, active: true, asOf: '2026-10-20', registeredFrom: '2023-10-01', disposalDate: '', expireDate: '' };
const registryOnly = (registry = registryD) => ready({ report: { summary: 'not found', question: '', findings: [], supplier: null }, registry });
test('F9 a registry check without a supplier candidate names its 基準日 for the current purchase date', async () => {
  const { intakeEvidence } = await helpers();
  const e = intakeEvidence(values({ purchaseDate: '2026-10-20' }), registryOnly());
  assert.deepEqual([e.origin, e.differs, e.registryBasis], ['file-manual', [], { asOf: '2026-10-20', purchaseDate: '2026-10-20', current: true }], 'monthly:f9-unit-registry-only-basis');
  for (const day of ['', '10/5/26']) assert.deepEqual(intakeEvidence(values({ purchaseDate: day }), registryOnly()).registryBasis, { asOf: '2026-10-20', purchaseDate: '', current: true }, 'monthly:f9-unit-registry-only-undated ' + JSON.stringify(day));
});
test('F9 a registry check without a supplier candidate is not current after the purchase date moves, and adds no difference', async () => {
  const { intakeEvidence } = await helpers();
  const moved = intakeEvidence(values({ purchaseDate: '2026-10-05' }), registryOnly());
  assert.deepEqual([moved.origin, moved.differs, moved.registryBasis], ['file-manual', [], { asOf: '2026-10-20', purchaseDate: '2026-10-05', current: false }], 'monthly:f9-unit-registry-only-date-moved');
});
test('F9 controls: no registry means no basis; a registry-only research is never confirmed-current, claims no sources and adds no difference', async () => {
  const { intakeEvidence, confirmedResearchCurrent } = await helpers();
  for (const v of [values({ purchaseDate: '2026-10-20' }), values({ purchaseDate: '2026-10-05' }), { merchantUrl: URL1, purchaseDate: '2026-10-05' }]) {
    const none = intakeEvidence(v, registryOnly(null));
    assert.deepEqual([none.differs, none.registryBasis, none.sourcesCurrent], [[], null, false], 'monthly:f9-unit-no-registry-no-basis');
    const checked = intakeEvidence(v, registryOnly());
    assert.deepEqual([checked.differs, checked.sourcesCurrent, confirmedResearchCurrent(v, registryOnly())], [[], false, false], 'monthly:f9-unit-registry-only-no-difference');
  }
});
test('F4 the record page and payment evidence templates compile', async () => {
  const { createRequire } = await import('node:module'), req = createRequire(import.meta.url), { parse, compileTemplate } = req('@vue/compiler-sfc');
  for (const name of ['pages/intake/[id].vue', 'components/intake/IntakePaymentMatches.vue']) {
    const text = await readFile(new URL('../' + name, import.meta.url), 'utf8'), p = parse(text, { filename: name });
    assert.deepEqual(p.errors, []); assert.deepEqual(compileTemplate({ source: p.descriptor.template.content, filename: name, id: 'evidence-test' }).errors, [], name);
  }
});

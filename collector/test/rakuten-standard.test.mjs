// collector/test/rakuten-standard.test.mjs — the 楽天銀行 standard corporate (START_CORP) adapter and the per-variant
// resolution (plan omf-rakuten-native-shiwake-20261020 §1-§2). Pure decisions only: the page-driving legs run in owned
// headless Chrome on an intercepted fake portal in scripts/zoomer-fixtures/omf-rakuten-native-shiwake.mjs. No bank is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rakutenModule from '../banks/rakuten.mjs';
import * as bankModule from '../bank.mjs';
import { validateContract } from '../banks/contract.mjs';

const START_CORP = 'https://fes.rakuten-bank.co.jp/XMS/security/RbS?COMMAND=LOGIN&CurrentPageID=START_CORP';
const PLUS = 'https://fes.rakuten-bank.co.jp/MS/main/RbS?COMMAND=LOGIN&CurrentPageID=START_ACCOUNT_PLUS';
const SIX = ['FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_YEAR', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_MONTH', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_FROM_DAY', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_YEAR', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_MONTH', 'FORM_DOWNLOAD_AP_2:EXPECTED_DATE_TO_DAY'];
const fn = name => { const f = rakutenModule[name]; assert.equal(typeof f, 'function', 'rakuten-standard:export ' + name); return f; };

test('per-variant resolution: only the frozen standard variant gets the retrieve adapter; plus, null and unknown stay contract-pending', () => {
  const standard = bankModule.adapterFor('rakuten', 'standard');
  assert.ok(standard, 'rakuten-standard:resolved');
  assert.equal(standard.support, 'verified', 'rakuten-standard:standard-verified-contract');
  assert.equal(standard.variant, 'standard', 'rakuten-standard:variant-bound');
  assert.equal(standard.start, START_CORP, 'rakuten-standard:start-corp');
  assert.deepEqual(standard.hosts, ['rakuten-bank.co.jp']);
  for (const variant of ['plus', null, undefined, 'x']) {
    const pending = bankModule.adapterFor('rakuten', variant);
    assert.equal(pending.support, 'contract-pending', 'rakuten-standard:pending-kept ' + variant);
    assert.equal(pending.contract, null, 'rakuten-standard:pending-kept ' + variant);
  }
  assert.equal(bankModule.adapterFor('rakuten').support, 'contract-pending', 'rakuten-standard:provider-default-pending');
  assert.equal(bankModule.adapterFor('paypay', 'standard').support, 'contract-pending', 'rakuten-standard:other-provider-unaffected');
  assert.equal(bankModule.adapterFor('nope', 'standard'), null);
  assert.equal(rakutenModule.default.starts.standard, START_CORP, 'rakuten-standard:observe-start-corp');
  assert.equal(rakutenModule.default.starts.plus, PLUS, 'rakuten-standard:plus-link-unchanged');
});

test('the recorded standard contract is complete and names the six native date fields and the export form', () => {
  const contract = rakutenModule.STANDARD_CONTRACT;
  assert.equal(validateContract(contract), contract, 'rakuten-standard:contract-complete');
  assert.deepEqual(contract.period.inputs, SIX, 'rakuten-standard:six-date-fields');
  assert.equal(contract.export.control, 'CSVダウンロード');
  assert.equal(contract.export.form, 'FORM_DOWNLOAD_AP_2');
  assert.ok(!JSON.stringify(contract).includes('j_id'), 'rakuten-standard:no-generated-jsf-id');
  assert.deepEqual(contract.login.hosts, ['fes.rakuten-bank.co.jp']);
});

test('the standard CSV is the native-format section, never Zengin; an unlabelled or ambiguous form is refused', () => {
  const choose = fn('standardCsvChoice');
  const native = '楽天銀行フォーマット 期間 年 月 日', zengin = '全銀フォーマット';
  assert.equal(choose([{ segment: native }, { segment: zengin }]).index, 0, 'rakuten-standard:native-first');
  assert.equal(choose([{ segment: zengin }, { segment: '楽天銀行フォーマット' }]).index, 1, 'rakuten-standard:native-not-position');
  assert.equal(choose([{ segment: '期間 年 月 日' }, { segment: zengin }]).index, 0, 'rakuten-standard:unlabelled-native-before-zengin');
  assert.equal(choose([{ segment: '期間' }, { segment: '期間' }]).index, -1, 'rakuten-standard:ambiguous-refused');
  assert.equal(choose([{ segment: zengin }]).index, -1, 'rakuten-standard:zengin-only-refused');
  assert.equal(choose([{ segment: '全銀 楽天銀行フォーマット' }]).index, -1, 'rakuten-standard:mixed-refused');
  assert.equal(choose([]).index, -1, 'rakuten-standard:missing-refused');
});

test('only the observed daily-download warning on the armed export surface is accepted, once; every other dialog stays for the person', () => {
  const decide = fn('standardDialogDecision'), warning = '明細のダウンロードは1日1度しかダウンロードできません。よろしいですか？';
  const surface = { armed: true, accepted: 0, host: 'fes.rakuten-bank.co.jp', pathname: '/XMS/inquiry/statement.xhtml' }, url = 'https://fes.rakuten-bank.co.jp/XMS/inquiry/statement.xhtml';
  assert.equal(decide({ type: 'confirm', message: warning, url }, surface), 'accept', 'rakuten-standard:known-dialog-accepted');
  assert.equal(decide({ type: 'confirm', message: 'システムメンテナンスのお知らせ', url }, surface), 'owner', 'rakuten-standard:unknown-dialog-owner');
  assert.equal(decide({ type: 'alert', message: warning, url }, surface), 'owner', 'rakuten-standard:alert-owner');
  assert.equal(decide({ type: 'prompt', message: warning, url }, surface), 'owner', 'rakuten-standard:prompt-owner');
  assert.equal(decide({ type: 'confirm', message: warning, url }, { ...surface, armed: false }), 'owner', 'rakuten-standard:unarmed-owner');
  assert.equal(decide({ type: 'confirm', message: warning, url }, { ...surface, accepted: 1 }), 'owner', 'rakuten-standard:once-only');
  assert.equal(decide({ type: 'confirm', message: warning, url: 'https://fes.rakuten-bank.co.jp/XMS/inquiry/gns' }, surface), 'owner', 'rakuten-standard:other-surface-owner');
  assert.equal(decide({ type: 'confirm', message: warning, url: 'https://fes.rakuten-bank.co.jp.evil.example/XMS/inquiry/statement.xhtml' }, surface), 'owner', 'rakuten-standard:foreign-host-owner');
});

test('the six native date fields come from the frozen explicit coverage; a missing or reversed period is refused before any page', () => {
  const values = fn('standardPeriodValues'), readback = fn('standardPeriodReadback');
  assert.deepEqual(values({ from: '2025-11-01', to: '2026-10-20' }), [[SIX[0], 2025], [SIX[1], 11], [SIX[2], 1], [SIX[3], 2026], [SIX[4], 10], [SIX[5], 20]], 'rakuten-standard:period-values');
  for (const bad of [null, undefined, {}, { from: '2026-10-21', to: '2026-10-20' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '20251101', to: '2026-10-20' }]) assert.throws(() => values(bad), e => e?.code === 'period-required', 'rakuten-standard:period-required ' + JSON.stringify(bad));
  const wanted = values({ from: '2025-11-01', to: '2026-10-20' });
  assert.equal(readback(['2025', '11', '01', '2026', '10', '20'], wanted), true, 'rakuten-standard:readback-padded');
  assert.equal(readback(['2025', '11', '1', '2026', '10', '20'], wanted), true, 'rakuten-standard:readback-unpadded');
  assert.equal(readback(['2025', '11', '1', '2026', '07', '22'], wanted), false, 'rakuten-standard:readback-default-period-refused');
  assert.equal(readback(['2025', '11', '', '2026', '10', '20'], wanted), false, 'rakuten-standard:readback-blank-refused');
  assert.equal(readback(['2025', '11'], wanted), false, 'rakuten-standard:readback-missing-field');
});

test('the standard page states: password on the login host, export form with six fields and the CSV control, authenticated overview, off-host unknown', () => {
  const classify = fn('classifyStandardPage'), base = { host: 'fes.rakuten-bank.co.jp', pathname: '/XMS/inquiry/gns', title: '楽天銀行', controls: [], password: false, exportForm: false, dateFields: 0, csvControls: 0 };
  assert.equal(classify({ ...base, password: true, controls: ['ログイン', '登録情報の照会・変更'] }), 'login', 'rakuten-standard:state-login-first');
  assert.equal(classify({ ...base, controls: ['登録情報の照会・変更', '入出金明細'] }), 'authenticated', 'rakuten-standard:state-authenticated');
  assert.equal(classify({ ...base, exportForm: true, dateFields: 6, csvControls: 2, controls: ['CSVダウンロード'] }), 'export_ready', 'rakuten-standard:state-export-ready');
  assert.equal(classify({ ...base, exportForm: true, dateFields: 5, csvControls: 2 }), 'unknown', 'rakuten-standard:state-incomplete-form');
  assert.equal(classify({ ...base, host: 'www.example.com', controls: ['入出金明細'] }), 'unknown', 'rakuten-standard:state-off-host');
  assert.equal(classify({ ...base, title: 'エラー', controls: ['入出金明細'] }), 'error_page', 'rakuten-standard:state-error');
  assert.equal(classify({ ...base, controls: [] }), 'unknown', 'rakuten-standard:state-unknown');
});

// Deliberate change (plan omf-rakuten-auto-login-20261021 §1): the adapter can now submit a saved login on the exact recorded form;
// without one it still refuses before any page (the automatic path is covered by rakuten-auto-login.test.mjs and the fixture).
test('the standard adapter constructs without touching a page (staged-package check) and never signs in without a saved login', async () => {
  const standard = rakutenModule.standard; assert.ok(standard, 'rakuten-standard:named-export');
  const ui = standard.ui({}, {}, { variant: 'standard', coverage: { from: '2025-11-01', to: '2026-10-20' } });
  for (const step of ['open', 'state', 'show', 'login', 'openStatements', 'selectPeriod', 'snapshot', 'exportCsv', 'downloadSession']) assert.equal(typeof ui[step], 'function', 'rakuten-standard:ui ' + step);
  await assert.rejects(ui.login(), e => e?.code === 'manual-login', 'rakuten-standard:manual-login');
  await assert.rejects(ui.selectPeriod(null), e => e?.code === 'period-required', 'rakuten-standard:period-required-before-page');
});

test('collectBankFromPage refuses an adapter bound to another variant than the frozen job before any page', async () => {
  const standard = bankModule.adapterFor('rakuten', 'standard'); let touched = 0;
  const ui = new Proxy({}, { get: () => async () => { touched++; return { kind: 'authenticated' }; } });
  const bound = { bankAccountId: 'c3c3c3c3c3c3c3c3c3c3c3c3', ownerId: 'd4d4d4d4d4d4d4d4d4d4d4d4', origin: 'https://omf.example', jobId: 'j-1', snapshotHash: 'h' };
  await assert.rejects(bankModule.collectBankFromPage({}, {}, standard, bound, { snapshot: { variant: 'plus' } }, '.', async () => {}, { ui }), e => e?.code === 'contract-pending', 'rakuten-standard:variant-bound-refused');
  assert.equal(touched, 0, 'rakuten-standard:variant-bound-no-page');
});

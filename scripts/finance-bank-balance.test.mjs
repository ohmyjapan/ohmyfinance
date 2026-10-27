// scripts/finance-bank-balance.test.mjs — the portable rules of the hourly bank balance (plan omf-bank-hourly-balances-20261027,
// shared/finance-bank-balance.mjs): once per JST hour, late catch-up, freshness, bank timestamps, exact yen parsing and provider
// capability. Pure: no database, no clock beyond the `now` passed in, fictional values only.
// Under OMF_TEST_BALANCE_MODULE a mutant copy of the shared module is tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const B = await import(process.env.OMF_TEST_BALANCE_MODULE ? pathToFileURL(process.env.OMF_TEST_BALANCE_MODULE).href : new URL('../shared/finance-bank-balance.mjs', import.meta.url).href);
const jst = (day, h, mi = 0, s = 0) => new Date(Date.parse(day + 'T00:00:00Z') + ((h - 9) * 3600 + mi * 60 + s) * 1000);
const RAKUTEN = { provider: 'rakuten', variant: 'standard', templateId: 't1', coverage: { from: '2026-01-01', to: null } };
const IKEDA = { provider: 'ikeda', variant: 'portal', accountIdentity: { branch: 'カクウ支店', type: '普通', number: '0000001' } };
const setting = (extra = {}) => ({ enabled: true, collectorId: 'c'.repeat(24), revision: 1, savedAt: jst('2026-10-27', 8), binding: B.balanceBinding(RAKUTEN), ...extra });
const collector = { id: 'c'.repeat(24), granted: true, capable: true };
const job = (extra = {}) => ({ jobId: 'j-' + Math.random().toString(36).slice(2), kind: 'balance', state: 'complete', requestedAt: jst('2026-10-27', 9, 0), completedAt: jst('2026-10-27', 9, 2), balance: { trigger: 'hourly', slot: '2026-10-27T09:00', claimedAt: jst('2026-10-27', 9, 1) }, ...extra });
const state = (o = {}) => B.balanceState({ setting: setting(), connection: RAKUTEN, collector, jobs: [], now: jst('2026-10-27', 10, 30), ...o });

test('capability: exactly the three balance providers and their one variant; a claim advertises balance-v1 only through an explicit capability list', () => {
  assert.equal(B.BALANCE_CAPABILITY, 'balance-v1');
  for (const [p, v] of [['rakuten', 'standard'], ['paypay', 'standard'], ['ikeda', 'portal']]) assert.equal(B.bankBalanceSupported(p, v), true, 'balance:supported ' + p);
  for (const [p, v] of [['rakuten', 'plus'], ['paypay', 'baplus'], ['ikeda', 'direct'], ['resona', 'direct'], ['rakuten', null], ['amex', 'standard']]) assert.equal(B.bankBalanceSupported(p, v), false, 'balance:unsupported ' + p + '/' + v);
  assert.deepEqual(B.claimCapabilities({ capabilities: ['balance-v1'] }), { balance: true }, 'balance:claim-capable');
  for (const body of [{}, null, undefined, 'balance-v1', { capabilities: 'balance-v1' }, { capabilities: ['balance-v2'] }, { capabilities: [1] }, { balance: true }]) assert.deepEqual(B.claimCapabilities(body), { balance: false }, 'balance:claim-old ' + JSON.stringify(body));
});

test('slots: one per JST hour, aligned to the hour; the key never uses the statement schedule day', () => {
  assert.equal(B.BALANCE_INTERVAL_MINUTES, 60);
  assert.equal(B.balanceSlotStart(jst('2026-10-27', 10, 59, 59)).toISOString(), jst('2026-10-27', 10).toISOString(), 'balance:slot-floor');
  assert.equal(B.balanceSlotStart(jst('2026-10-27', 11)).toISOString(), jst('2026-10-27', 11).toISOString(), 'balance:slot-exact');
  assert.equal(B.balanceSlotKey(jst('2026-10-27', 0, 5)), '2026-10-27T00:00', 'balance:slot-jst-midnight');
  assert.equal(B.balanceSlotKey(jst('2026-10-26', 23, 59)), '2026-10-26T23:00', 'balance:slot-jst-day');
  assert.notEqual(B.balanceSlotKey(jst('2026-10-27', 9)), '2026-10-27', 'balance:slot-not-day');
});

test('state: due once per hour, done after any access in the hour (manual or hourly, failed included), next hour due again', () => {
  assert.equal(state().state, 'due', 'balance:due-no-history');
  const s = state({ jobs: [job()] }); assert.equal(s.state, 'due', 'balance:due-next-hour');
  const done = state({ jobs: [job({ requestedAt: jst('2026-10-27', 10, 0), balance: { trigger: 'hourly', slot: '2026-10-27T10:00', claimedAt: jst('2026-10-27', 10, 1) } })] });
  assert.equal(done.state, 'done', 'balance:done-this-hour'); assert.equal(done.nextAt, jst('2026-10-27', 11, 1).toISOString(), 'balance:next-at-60-minutes-after-access');
  assert.equal(state({ jobs: [job({ state: 'failed', requestedAt: jst('2026-10-27', 10, 5), balance: { trigger: 'manual', claimedAt: jst('2026-10-27', 10, 5) } })] }).state, 'done', 'balance:failed-counts-for-hour');
  // a job queued in an earlier hour but received by the PC in this hour counts as this hour's access (no second login right after it)
  assert.equal(state({ jobs: [job({ requestedAt: jst('2026-10-27', 9, 0), balance: { trigger: 'hourly', slot: '2026-10-27T09:00', claimedAt: jst('2026-10-27', 10, 20) } })] }).state, 'done', 'balance:late-claim-counts');
  // the hour boundary (parent acceptance note hour-boundary-spacing): an automatic access at 09:59 is not followed by another at 10:00;
  // the next automatic run is 60 minutes after the access (10:59), then once per hour from there
  const late = [job({ requestedAt: jst('2026-10-27', 9, 0), balance: { trigger: 'hourly', slot: '2026-10-27T09:00', claimedAt: jst('2026-10-27', 9, 59) } })];
  const at10 = state({ jobs: late, now: jst('2026-10-27', 10, 0) }); assert.deepEqual([at10.state, at10.nextAt], ['done', jst('2026-10-27', 10, 59).toISOString()], 'balance:cooldown-after-0959');
  assert.equal(state({ jobs: late, now: jst('2026-10-27', 10, 58, 59) }).state, 'done', 'balance:cooldown-holds');
  assert.equal(state({ jobs: late, now: jst('2026-10-27', 10, 59) }).state, 'due', 'balance:due-60-minutes-after');
  const drift = [job({ requestedAt: jst('2026-10-27', 10, 59), balance: { trigger: 'hourly', slot: '2026-10-27T10:00', claimedAt: jst('2026-10-27', 10, 59) } })];
  assert.deepEqual([state({ jobs: drift, now: jst('2026-10-27', 11, 0) }).state, state({ jobs: drift, now: jst('2026-10-27', 11, 0) }).nextAt], ['done', jst('2026-10-27', 11, 59).toISOString()], 'balance:next-hour-also-cooled');
  assert.equal(B.balanceLastAccess([...late, job({ kind: 'retrieve', requestedAt: jst('2026-10-27', 10, 30) })]), jst('2026-10-27', 9, 59).getTime(), 'balance:statements-not-balance-access');
  assert.equal(state({ jobs: [job({ state: 'superseded', requestedAt: jst('2026-10-27', 10, 1), balance: { trigger: 'hourly', supersededSlot: '2026-10-27T10:00' } })] }).state, 'due', 'balance:superseded-ignored');
  const failed = state({ jobs: [job({ state: 'failed', lastMessage: 'fictional', completedAt: jst('2026-10-27', 9, 3) })] });
  assert.equal(failed.lastFailure?.jobId !== undefined, true, 'balance:last-failure-shown'); assert.equal(failed.state, 'due', 'balance:failure-not-held');
});

test('state: off, unsupported, reconfirm, waiting-pc, upgrade, busy, and the active job states before off', () => {
  assert.equal(state({ setting: null }).state, 'off', 'balance:default-off');
  assert.equal(state({ setting: { enabled: true } }).state, 'off', 'balance:malformed-off');
  assert.equal(state({ connection: { provider: 'resona', variant: 'direct' } }).state, 'unsupported', 'balance:unsupported');
  assert.equal(state({ connection: null }).reason, 'no-connection');
  assert.equal(state({ connection: { provider: 'ikeda', variant: 'portal' }, setting: setting({ binding: B.balanceBinding(IKEDA) }) }).reason, 'no-identity', 'balance:identity-required');
  assert.equal(state({ connection: { ...RAKUTEN, variant: 'plus' } }).state, 'unsupported');
  assert.equal(state({ setting: setting({ binding: B.balanceBinding(IKEDA) }) }).state, 'reconfirm', 'balance:reconfirm');
  assert.equal(state({ connection: { ...IKEDA, accountIdentity: { ...IKEDA.accountIdentity, number: '0000002' } }, setting: setting({ binding: B.balanceBinding(IKEDA) }) }).state, 'reconfirm', 'balance:identity-change-reconfirm');
  assert.equal(state({ connection: { ...RAKUTEN, templateId: 't2', coverage: null } }).state, 'due', 'balance:template-period-irrelevant');
  assert.equal(state({ collector: null }).state, 'waiting-pc', 'balance:no-pc');
  assert.equal(state({ collector: { ...collector, granted: false } }).state, 'waiting-pc', 'balance:pc-not-granted');
  assert.equal(state({ collector: { ...collector, capable: false } }).state, 'upgrade', 'balance:upgrade');
  assert.equal(state({ collector: { ...collector, capable: null } }).state, 'due', 'balance:never-seen-may-queue');
  const statementJob = { jobId: 's', kind: 'retrieve', state: 'queued', requestedAt: jst('2026-10-27', 10, 0) };
  assert.equal(state({ jobs: [statementJob] }).state, 'busy', 'balance:statement-priority');
  const live = jst('2026-10-27', 10, 33);
  assert.equal(state({ jobs: [job({ state: 'queued', requestedAt: jst('2026-10-27', 10), balance: { trigger: 'hourly', slot: '2026-10-27T10:00' } })] }).state, 'queued');
  assert.equal(state({ jobs: [job({ state: 'running', leaseUntil: live })] }).state, 'running');
  assert.equal(state({ jobs: [job({ state: 'running', leaseUntil: jst('2026-10-27', 10, 1) })] }).state, 'interrupted', 'balance:interrupted');
  assert.equal(state({ jobs: [job({ state: 'verification_required', leaseUntil: live })] }).state, 'attention');
  // an explicitly closed balance job (open:false) is history and cadence only, never active work
  assert.equal(state({ jobs: [job({ state: 'running', open: false, leaseUntil: jst('2026-10-27', 8, 1), requestedAt: jst('2026-10-27', 8), balance: { trigger: 'manual', claimedAt: jst('2026-10-27', 8) } })] }).state, 'due', 'balance:closed-not-active');
  assert.equal(state({ jobs: [job({ state: 'running', open: false, leaseUntil: live, requestedAt: jst('2026-10-27', 10, 25), balance: { trigger: 'manual', claimedAt: jst('2026-10-27', 10, 25) } })] }).state, 'done', 'balance:closed-counts-for-cadence');
  assert.equal(state({ setting: null, jobs: [job({ state: 'running', leaseUntil: live, balance: { trigger: 'manual', claimedAt: jst('2026-10-27', 10, 29) } })] }).state, 'running', 'balance:manual-running-while-off');
});

test('settings input: enabled boolean, a 24-hex collector or null, the read revision; stored values read tolerantly', () => {
  assert.deepEqual(B.balanceSettingInput({ enabled: true, collectorId: 'a'.repeat(24), revision: 0 }), { enabled: true, collectorId: 'a'.repeat(24), revision: 0 });
  assert.deepEqual(B.balanceSettingInput({ enabled: false, collectorId: null, revision: 3 }), { enabled: false, collectorId: null, revision: 3 });
  for (const bad of [null, [], { enabled: 'yes', collectorId: null, revision: 0 }, { enabled: true, collectorId: 'x', revision: 0 }, { enabled: true, collectorId: null, revision: 0 }, { enabled: false, collectorId: null, revision: -1 }, { enabled: false, collectorId: null, revision: 1.5 }, { enabled: true, collectorId: 'a'.repeat(24), revision: 0, intervalMinutes: 5 }]) assert.throws(() => B.balanceSettingInput(bad), undefined, 'balance:setting-refused ' + JSON.stringify(bad));
  assert.deepEqual(B.storedBalanceSetting(undefined), { enabled: false, collectorId: null, revision: 0, savedAt: null, binding: null, intervalMinutes: 60 });
  assert.equal(B.storedBalanceSetting({ enabled: true, collectorId: 'a'.repeat(24), revision: 0, binding: B.balanceBinding(RAKUTEN) }).enabled, false, 'balance:stored-needs-revision');
  assert.equal(B.storedBalanceSetting({ enabled: true, collectorId: 'zz', revision: 2, binding: B.balanceBinding(RAKUTEN) }).enabled, false, 'balance:stored-needs-collector');
  assert.equal(B.storedBalanceSetting({ enabled: true, collectorId: 'a'.repeat(24), revision: 2, binding: B.balanceBinding(RAKUTEN) }).enabled, true);
});

test('yen: only the exact bank syntax — suffix 円 (Rakuten parentheses positive) or prefix ¥/￥ — with an unambiguous sign kept; never a missing, partial or other amount', () => {
  const ok = [['1,234 円', 'suffix', 1234], ['(1,234円)', 'suffix', 1234], ['（1,234円）', 'suffix', 1234], ['0 円', 'suffix', 0], ['12,345,678円', 'suffix', 12345678], ['¥1,234', 'prefix', 1234], ['￥1,234', 'prefix', 1234], ['¥ 987', 'prefix', 987],
    // signed bank values (not observed on the live pages; the format is unambiguous): kept negative, never zero or dropped
    ['-1,234 円', 'suffix', -1234], ['−1,234円', 'suffix', -1234], ['¥-1,234', 'prefix', -1234], ['-¥1,234', 'prefix', -1234], ['−￥5,000', 'prefix', -5000], ['-0 円', 'suffix', 0]];
  for (const [t, s, n] of ok) assert.equal(B.parseYen(t, s), n, 'balance:yen ' + t);
  const bad = [['1,234', 'suffix'], ['1,234', 'prefix'], ['1,234 円', 'prefix'], ['¥1,234', 'suffix'], ['1,23 円', 'suffix'], ['1234,567 円', 'suffix'], ['△1,234 円', 'suffix'], ['▲1,234 円', 'suffix'], ['+1,234 円', 'suffix'], ['(-1,234円)', 'suffix'], ['--1,234 円', 'suffix'], ['-¥-1,234', 'prefix'], ['▲¥1,234', 'prefix'], ['1,234.5 円', 'suffix'], ['(1,234円', 'suffix'], ['', 'suffix'], ['円', 'suffix'], ['1,234 円 5,678 円', 'suffix'], ['¥1,234 ¥2', 'prefix'], ['1,234 ドル', 'suffix']];
  for (const [t, s] of bad) assert.equal(B.parseYen(t, s), null, 'balance:yen-refused ' + t + ' ' + s);
  assert.deepEqual(B.findYen('前日比 ▲￥12,000', 'prefix').map(h => h.value), [12000], 'balance:arrow-not-a-sign');
});

test('bank time: exactly the provider format in JST, a real calendar instant; anything else is unreadable', () => {
  assert.equal(B.parseBankTime('2026/10/27 09:15', 'YYYY/MM/DD HH:mm'), '2026-10-27T00:15:00.000Z', 'balance:time-rakuten');
  assert.equal(B.parseBankTime('2026/10/27 09:15:42', 'YYYY/MM/DD HH:mm:ss'), '2026-10-27T00:15:42.000Z', 'balance:time-paypay');
  assert.equal(B.parseBankTime('2026-10-27 00:05', 'YYYY-MM-DD HH:mm'), '2026-10-26T15:05:00.000Z', 'balance:time-ikeda-jst-midnight');
  for (const [t, f] of [['2026/10/27 9:15', 'YYYY/MM/DD HH:mm'], ['2026/02/30 09:15', 'YYYY/MM/DD HH:mm'], ['2026/10/27 24:00', 'YYYY/MM/DD HH:mm'], ['2026-10-27 09:15', 'YYYY/MM/DD HH:mm'], ['2026/10/27 09:15', 'YYYY/MM/DD HH:mm:ss'], ['', 'YYYY-MM-DD HH:mm'], ['2026/10/27 09:15', 'other']]) assert.equal(B.parseBankTime(t, f), null, 'balance:time-refused ' + t);
});

test('receipt: the normalized balance only, bound to the job, provider and source; missing, malformed, future or foreign data is refused', () => {
  const now = jst('2026-10-27', 10, 30), ctx = { jobId: 'job-1', snapshotHash: 'h'.repeat(64), provider: 'rakuten', variant: 'standard', now };
  const base = { v: 1, jobId: 'job-1', snapshotHash: 'h'.repeat(64), provider: 'rakuten', variant: 'standard', currency: 'JPY', amount: 1234567, available: 1200000, asOf: jst('2026-10-27', 10, 15).toISOString(), observedAt: jst('2026-10-27', 10, 16).toISOString(), source: { origin: 'https://fes.rakuten-bank.co.jp', path: '/XMS/inquiry/gns', labels: ['普通預金残高', '支払可能残高'] } };
  const r = B.balanceReceiptInput(base, ctx);
  assert.deepEqual(r, { ...base }, 'balance:receipt-normalized'); assert.equal(B.balanceLagStale(r), false);
  const refuse = (patch, label) => assert.throws(() => B.balanceReceiptInput({ ...base, ...patch }, ctx), e => /^balance-/.test(e.code), 'balance:receipt-refused ' + label);
  refuse({ jobId: 'job-2' }, 'job'); refuse({ snapshotHash: 'x'.repeat(64) }, 'hash'); refuse({ provider: 'paypay' }, 'provider'); refuse({ variant: 'plus' }, 'variant');
  refuse({ currency: 'USD' }, 'currency'); refuse({ amount: 12.5 }, 'fraction'); refuse({ amount: 1e16 }, 'out-of-range'); refuse({ amount: '1234' }, 'string'); refuse({ amount: null }, 'missing-not-zero');
  assert.equal(B.balanceReceiptInput({ ...base, amount: -50000, available: -50000 }, ctx).amount, -50000, 'balance:signed-kept'); refuse({ available: 1.5 }, 'available'); refuse({ asOf: 'yesterday' }, 'asof'); refuse({ asOf: jst('2026-10-27', 10, 40).toISOString() }, 'asof-after-observed');
  refuse({ observedAt: jst('2026-10-27', 11, 0).toISOString(), asOf: jst('2026-10-27', 10, 50).toISOString() }, 'observed-future');
  refuse({ source: { ...base.source, origin: 'https://fes.rakuten-bank.example' } }, 'origin'); refuse({ source: { ...base.source, path: '/XMS/inquiry/gns?x=1' } }, 'query');
  refuse({ source: { ...base.source, labels: ['普通預金残高', '残高'] } }, 'label'); refuse({ extra: 1 }, 'unknown-key'); refuse({ source: { ...base.source, html: '<td>' } }, 'raw-dom');
  refuse({ source: { ...base.source, labels: ['普通預金残高'] } }, 'available-without-its-label');
  assert.equal(B.balanceReceiptInput({ ...base, available: null, source: { ...base.source, labels: ['普通預金残高'] } }, ctx).available, null, 'balance:available-optional');
  assert.throws(() => B.balanceReceiptInput({ ...base, provider: 'paypay', variant: 'standard', available: 5, source: { origin: 'https://login.paypay-bank.co.jp', path: '/wctx/NBCW2101.do', labels: ['普通預金残高'] } }, { ...ctx, provider: 'paypay' }), e => e.code === 'balance-invalid', 'balance:paypay-no-available');
  const ikeda = B.balanceReceiptInput({ ...base, provider: 'ikeda', variant: 'portal', available: null, source: { origin: 'https://www.0161.houjinportal.anser.ne.jp', path: '/', labels: ['各口座残高'] } }, { ...ctx, provider: 'ikeda', variant: 'portal' });
  assert.equal(ikeda.available, null, 'balance:ikeda-no-available');
  const lag = B.balanceReceiptInput({ ...base, asOf: jst('2026-10-27', 8, 0).toISOString() }, ctx);
  assert.equal(B.balanceLagStale(lag), true, 'balance:bank-side-stale-kept');
});

test('freshness: a bank time older than two hours is stale even when it was fetched just now', () => {
  const now = jst('2026-10-27', 12, 0);
  assert.equal(B.balanceFreshness({ asOf: jst('2026-10-27', 11, 0).toISOString(), now }), 'fresh', 'balance:fresh');
  assert.equal(B.balanceFreshness({ asOf: jst('2026-10-27', 9, 59).toISOString(), now }), 'stale', 'balance:stale');
  assert.equal(B.balanceFreshness({ asOf: null, now }), 'stale');
});

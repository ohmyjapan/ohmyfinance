import test from 'node:test';
import assert from 'node:assert/strict';
import { studyPurchase, validateReplyProposal, replyCommand, questionText } from '../shared/finance-review.mjs';
import { ReviewWorker, validateOrigin } from '../review-worker/worker.mjs';
const draft = { source: { purchaseDate: '2026-08-10', description: 'Shop', amount: 9000 }, values: { purpose: 'customer', customerId: 'a', productName: '' } };
test('patterns exclude current/future records and merchant variants; surface customer and amount deviations without guessing items', () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ merchant: 'Shop', date: `2026-08-0${i + 1}`, amount: 1000, purpose: 'customer', customerId: 'b' }));
  history.push({ merchant: 'Shop other branch', date: '2026-08-01', amount: 9000, purpose: 'company' }, { merchant: 'Shop', date: '2026-08-10', amount: 9000, purpose: 'company' });
  const study = studyPurchase(draft, history); assert.equal(study.historyCount, 6); assert.equal(study.median, 1000); assert.ok(study.signals.some(s => s.includes('고객의 기존'))); assert.ok(study.signals.some(s => s.includes('중앙값'))); assert.ok(study.signals.some(s => s.includes('품목')));
  assert.equal(study.productName, undefined);
});
test('reply evidence is restricted to allowed fields, registered customers and actual quoted text', () => {
  const first = validateReplyProposal({ kind: 'proposal', summary: '회사 구매', patch: { purpose: 'company' }, quotes: { purpose: '회사' } }, [], '회사에서 쓸 물건');
  assert.deepEqual(validateReplyProposal(first, [], '회사에서 쓸 물건'), first);
  assert.throws(() => validateReplyProposal({ kind: 'proposal', summary: 'x', patch: { amount: 1 } }, [], 'x'));
  assert.throws(() => validateReplyProposal({ kind: 'proposal', summary: 'x', patch: { productName: 'Book' }, quotes: { productName: 'invented' } }, [], 'x'));
  assert.throws(() => validateReplyProposal({ kind: 'proposal', summary: 'x', patch: { customerId: 'b' }, quotes: { customerId: 'b' } }, [{ id: 'a' }], 'b'));
  assert.equal(replyCommand('확인!'), 'once'); assert.equal(replyCommand('패턴으로 기억'), 'pattern'); assert.equal(replyCommand('확인하지 마'), null);
  const text = questionText({ context: { source: { ...draft.source, description: '<!channel>' }, study: studyPurchase(draft) }, importId: 'x', line: 2 }, 'https://example.invalid');
  assert.equal(text.includes('<!channel>'), false);
});
test('worker refuses public plain HTTP and workspace or DM recipient mismatch before sending', async () => {
  assert.throws(() => validateOrigin('http://example.com')); assert.throws(() => validateOrigin('https://a:b@example.com')); assert.equal(validateOrigin('http://100.64.0.1:8080'), 'http://100.64.0.1:8080');
  const calls = [];
  const worker = new ReviewWorker({ baseUrl: 'https://example.invalid', token: 'test', slackToken: 'test' }, { request: async (url) => { calls.push(url); const body = url.includes('/jobs') ? { teamId: 'T1', channelId: 'D1', userId: 'U1', jobs: [] } : url.includes('auth.test') ? { ok: true, team_id: 'T1' } : { ok: true, channel: { is_im: true, user: 'U2' } }; return new Response(JSON.stringify(body)); } });
  await assert.rejects(worker.cycle(), /recipient mismatch/); assert.ok(calls.every(url => !url.includes('postMessage')));
});
test('unknown Slack delivery is never automatically retried', async () => {
  let status = 'queued', posts = 0;
  const review = { _id: 'r', importId: 'i', line: 2, sendId: 's', context: { source: draft.source, study: studyPurchase(draft) }, replies: [] };
  const worker = new ReviewWorker({ baseUrl: 'https://example.invalid', token: 'test', slackToken: 'test' }, { request: async (url) => {
    if (url.includes('postMessage')) { posts++; throw Error('Unknown network result'); }
    const body = url.includes('/jobs') ? { teamId: 'T', channelId: 'D', userId: 'U', jobs: [{ ...review, status }] } : url.includes('/outbox') ? { messages: [] } : url.endsWith('/claim') ? (status = 'sending', { review }) : url.includes('auth.test') ? { ok: true, team_id: 'T' } : { ok: true, channel: { is_im: true, user: 'U' } };
    return new Response(JSON.stringify(body));
  } });
  await assert.rejects(worker.cycle(), /Unknown network/); await worker.cycle(); assert.equal(posts, 1);
});

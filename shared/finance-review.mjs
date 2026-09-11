import { normalizeMerchant } from './finance-draft.mjs';

export const reviewPatchFields = ['purpose', 'customerId', 'productName'];
export const escapeSlack = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function validateReplyProposal(input, customers, text) {
  if (!input || !['proposal', 'unclear', 'defer'].includes(input.kind)) throw Error('Invalid interpretation');
  if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 800) throw Error('Invalid summary');
  const patch = { ...(input.patch || {}) }, quotes = { ...(input.quotes || {}) };
  if (typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !reviewPatchFields.includes(k))) throw Error('Invalid proposed fields');
  if (input.kind !== 'proposal' && Object.keys(patch).length) throw Error('Uncertain replies cannot change a draft');
  if (input.kind === 'proposal' && !Object.keys(patch).length) throw Error('Empty proposal');
  if (patch.purpose && patch.purpose !== 'customer') { patch.customerId = ''; quotes.customerId = quotes.purpose; }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string') throw Error('Invalid proposed value');
    if (typeof quotes[key] !== 'string' || !quotes[key].trim() || !text.includes(quotes[key])) throw Error('Every proposed field needs a quote from the reply');
    if (key === 'purpose' && !['company', 'customer', 'unresolved'].includes(value)) throw Error('Invalid purpose');
    if (key === 'customerId' && value && !customers.some(c => String(c.id) === value)) throw Error('Unknown customer');
    if (key === 'productName' && (!value.trim() || value.length > 300)) throw Error('Invalid product name');
  }
  return { kind: input.kind, summary: input.summary.trim(), patch, quotes };
}
export function replyCommand(text) {
  const t = text.normalize('NFKC').trim().replace(/[.!。！]+$/, '');
  if (['확인', '이번 건만', '이번건만', '確認', '今回のみ'].includes(t)) return 'once';
  if (['패턴으로 기억', '패턴으로기억', 'パターンとして記憶'].includes(t)) return 'pattern';
  if (['보류', '나중에', '保留', 'あとで'].includes(t)) return 'defer';
  return null;
}
export function studyPurchase(draft, history = [], memories = [], nearby = []) {
  const date = draft.source.purchaseDate, merchant = normalizeMerchant(draft.source.description);
  // Exclude the current occurrence and future records. Exact descriptors stay separate.
  const past = history.filter(h => normalizeMerchant(h.merchant) === merchant && h.date < date);
  const counts = new Map();
  for (const h of past) {
    const key = `${h.purpose}:${h.customerId || ''}`;
    const count = counts.get(key) || { purpose: h.purpose, customerId: h.customerId || '', label: h.customerLabel || '', count: 0 };
    count.count++; counts.set(key, count);
  }
  const patterns = [...counts.values()].sort((a, b) => b.count - a.count);
  const amounts = past.map(h => h.amount).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : null;
  const signals = [];
  if (past.length < 3) signals.push(`이 이용처 표기와 정확히 일치하는 과거 기록은 ${past.length}건입니다. 다른 지점·표기는 포함하지 않았어요.`);
  if (patterns.length > 1) signals.push('같은 이용처에서도 고객 구매와 회사 사용 또는 고객별 분류가 달랐습니다.');
  if (median && amounts.length >= 5 && (draft.source.amount > median * 3 || draft.source.amount < median / 3)) signals.push(`이번 금액은 같은 이용처의 과거 중앙값(¥${median.toLocaleString('ja-JP')})과 차이가 큽니다.`);
  const current = draft.values;
  if (current.purpose === 'customer' && past.length >= 3 && !past.some(h => h.customerId === current.customerId)) signals.push('기록된 고객의 기존 구매가 이 이용처에서는 확인되지 않습니다. 별도 요청이었는지 확인이 필요해요.');
  if (!current.productName) signals.push('구매한 품목은 아직 확인되지 않았습니다.');
  const hypotheses = [];
  const labels = { customer: '고객 요청 구매', company: '회사에서 사용할 물건·서비스', unresolved: '용도 미확인' };
  if (current.purpose !== 'unresolved') hypotheses.push({ purpose: current.purpose, customerId: current.customerId, label: labels[current.purpose], reason: '현재 초안과 원본 시트의 분류', strength: 'source' });
  for (const p of patterns.filter(p => p.purpose !== 'unresolved').slice(0, 3)) hypotheses.push({ ...p, label: labels[p.purpose] + (p.label ? ` (${p.label})` : ''), reason: `같은 이용처의 이전 ${past.length}건 중 ${p.count}건`, strength: past.length >= 5 && p.count / past.length >= .8 ? 'pattern' : 'weak' });
  const reusable = memories.filter(m => m.reusable && m.merchant === merchant).slice(0, 5);
  for (const m of reusable) hypotheses.push({ purpose: m.purpose, customerId: m.customerId, label: labels[m.purpose], reason: `이전에 패턴으로 기억하도록 확인한 답변: ${m.summary}`, strength: 'confirmed_pattern' });
  if (!hypotheses.length) hypotheses.push({ purpose: 'unresolved', label: '고객의 별도 요청 또는 회사 사용', reason: '품목·용도를 판단할 근거가 부족합니다.', strength: 'weak' });
  const question = current.purpose === 'customer'
    ? '이 결제는 해당 고객이 따로 요청한 구매였나요? 어떤 물건이었는지 알려주세요. 다른 용도였다면 함께 말씀해 주세요.'
    : current.purpose === 'company'
      ? '시트에는 회사 사용으로 기록되어 있어요. 어떤 물건이나 서비스였고, 어디에 쓰셨나요? 고객 요청 구매였다면 고객도 알려주세요.'
      : '고객이 요청한 구매였나요, 회사에서 쓸 물건·서비스였나요? 구매 내용과 고객이 있다면 고객도 알려주세요.';
  return { version: 1, merchant, historyCount: past.length, historyScope: '같은 계정·정확히 같은 이용처 표기·구매일 이전의 저장된 기록', median, patterns, signals, hypotheses, nearby: nearby.slice(0, 5), question };
}
export function questionText(review, baseUrl) {
  const s = review.context.source, study = review.context.study;
  const lines = ['*OMF 구매 확인*', `${escapeSlack(s.purchaseDate)} · ${escapeSlack(s.description)} · ¥${Number(s.amount).toLocaleString('ja-JP')}`,
    ...study.signals.slice(0, 2).map(escapeSlack), `현재 추정: ${escapeSlack(study.hypotheses[0].label)} — 확인이 필요해요.`, escapeSlack(study.question),
    '이 스레드에 편하게 답해 주세요. 기억이 안 나면 ‘보류’라고 하셔도 돼요.', `<${baseUrl}/mapping-draft/${review.importId}/${review.line}|OMF 초안 보기>`];
  return lines.join('\n');
}
export function confirmationText(proposal, customers) {
  const labels = { company: '회사 사용', customer: '고객 구매', unresolved: '용도 미확인' };
  const fields = Object.entries(proposal.patch).map(([key, value]) => key === 'purpose' ? `용도: ${labels[value]}` : key === 'customerId' ? `고객: ${customers.find(c => c.id === value)?.name || '공란'}` : `구매 품목: ${value}`);
  return ['이렇게 이해했어요.', ...fields.map(escapeSlack), '맞으면 ‘확인’이라고 답해 주세요. 이번 건에만 반영합니다.', '같은 계정·이용처·고객의 다음 판단에도 참고하려면 ‘패턴으로 기억’, 나중에 확인하려면 ‘보류’라고 해 주세요.'].join('\n');
}

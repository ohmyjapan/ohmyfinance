// shared/finance-bank-classification.mjs — native bank classification (仕訳) proposals (plan omf-rakuten-native-shiwake-20261020
// §5-§7). Pure and portable (browser + Node). One company's proposals for the owner's bank rows from three kinds of evidence only:
// explicit bank text (fee / interest), the company's saved calendar entries (exact currency, amount and direction near the due
// date, one-to-one in both directions) and the company's confirmed history / explicit teaching (exact normalized payee and
// direction). A calendar match proposes only a purpose (the entry's title) for review, never an account: categories are planning
// labels and an equal amount/date is not a verified payee. A proposal never posts anything, never infers a tax treatment or a T number, and never turns a personal name or
// the company's own name into an expense: the company's own name is an unconfirmed transfer awaiting the other bank's proof.
export const BANK_CLASSIFICATION_VERSION = 'bank-classification-1';
const arr = v => Array.isArray(v) ? v : [];
const SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };
// NFKC, a spaced or separate (han)dakuten joined to its kana (bank exports write「ﾛｼﾞ」as「ﾛｼ ﾞ」), upper case, small kana folded.
const folded = v => String(v ?? '').normalize('NFKC').replace(/\s*([゙゚])/g, '$1').normalize('NFC').toUpperCase().replace(/[ァィゥェォッャュョヮヵヶ]/g, c => SMALL[c]);
const PREFIX = /^(?:振込|フリコミ|振替|フリカエ|口座振替|コウザフリカエ|自動払込|入金|ニユウキン|出金|シユツキン|デビツト|カード|ATM)\s*/;
const ENTITY = /株式会社|有限会社|合同会社|合名会社|合資会社|カブシキガイシヤ|ユウゲンガイシヤ|ゴウドウガイシヤ|\(株\)|\(有\)|\(同\)|㈱|㈲|\(カ|カ\)|\(ユ|ユ\)|\(ド|ド\)|\(シヤ|シヤ\)/g;
const ACCOUNT = /^(.*?)(?:普通預金|当座預金|貯蓄預金|普通|当座|貯蓄|フツウ|トウザ|チヨチク)\s*\d{3,}\s*(.*)$/;

/**
 * The payee key of a bank description: folded (NFKC, joined dakuten, upper case, small kana); the payer-reference suffix
 * （依頼人…, with its 振込予定日 / 管理番号, to the end — it may itself hold unclosed parentheses）cut; the destination
 * "<bank> <branch> <type> <number>" boilerplate removed (the holder is the text after the number, else before it); transfer
 * prefixes and legal-entity marks removed; spaces, punctuation and long-vowel marks (ー, an ASCII hyphen) dropped. Two
 * spellings of the same payee give the same key; the payer named in the reference never becomes the payee; '' when nothing is left.
 */
export function normalizePayee(description) {
  let s = folded(description).replace(/\((?:依頼人|振込人|イライニン|フリコミニン)[\s\S]*$/, ' ').replace(/(?:振込予定日|管理番号)[:：]?\S*/g, ' ');
  const account = ACCOUNT.exec(s); if (account) s = account[2].trim() ? account[2] : account[1];
  s = s.trim(); for (let i = 0; i < 3; i++) s = s.replace(PREFIX, '').trimStart();
  s = s.replace(/\d{4,}/g, ' ').replace(ENTITY, ' ');
  return s.replace(/[\s・,，.．\-‐‑–—―−ー_\/()「」『』【】\[\]:：~～、。]+/g, '').trim();
}
/** Explicit bank fee / card membership fee / interest text: a purpose and the chart account name it supplies, else null. */
export function textPurpose(description, direction) {
  const s = folded(description);
  if (direction === 'out' && /カ[ー\-‐−]?ド.{0,4}会費|会費.{0,12}カ[ー\-‐−]?ド/.test(s)) return { kind: 'card-fee', label: '支払手数料（カード会費）', account: '支払手数料' };
  if (direction === 'out' && /手数料|テスウリヨウ/.test(s)) return { kind: 'bank-fee', label: '支払手数料', account: '支払手数料' };
  if (direction === 'in' && /利息|利子|リソク/.test(s)) return { kind: 'interest', label: '受取利息', account: '受取利息' };
  return null;
}
const directionOf = row => Number(row?.amount) < 0 ? 'in' : 'out';
// Calendar days, never clock time: a stored due date (noon UTC, or a Date/ISO string) and a bank date compare by YYYY-MM-DD.
const dayOf = v => v instanceof Date ? new Date(v.getTime() + 9 * 3600000).toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const days = (a, b) => { const x = Date.parse(dayOf(a)), y = Date.parse(dayOf(b)); return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity; };
const sum = (a, b) => Math.round((Number(a) + Number(b)) * 100) / 100;
const candidate = (entry, kind, gap) => ({ kind, paymentId: String(entry.id ?? ''), title: String(entry.title ?? ''), dueDate: dayOf(entry.dueDate), amount: Number(entry.amount), category: String(entry.category ?? ''), recurring: !!entry.recurring, gapDays: Math.round(gap) });

/**
 * GUARD — calendar evidence. A pair (bank row, calendar entry) is eligible only with the same currency, the exact amount and the
 * matching direction (expense ↔ outgoing, income ↔ incoming) of an entry that is not cancelled. Near (≤ windowDays from the due
 * date) and one-to-one in BOTH directions → `unique`; any other near pair → `ambiguous` (a reused/recurring entry seen by two
 * rows, or two entries for one row); a row without a near pair gets `combined` (two near entries summing to it) and `late`
 * (≤ lateDays) candidates. Returns Map(row → candidates).
 */
export function calendarMatches(rows, entries, { windowDays = 7, lateDays = 45 } = {}) {
  const list = arr(rows), calendar = arr(entries).filter(e => !!e && typeof e === 'object');
  const eligible = (row, entry) => entry.status !== 'cancelled' && (entry.currency || 'JPY') === (row.currency || 'JPY') && Number(entry.amount) === Math.abs(Number(row.amount)) && directionOf(row) === (entry.type === 'income' ? 'in' : 'out');
  const pairs = [];
  for (const row of list) for (const entry of calendar) if (eligible(row, entry)) { const gap = days(row.date, entry.dueDate); if (gap <= lateDays) pairs.push({ row, entry, gap, near: gap <= windowDays }); }
  const nearOf = row => pairs.filter(p => p.near && p.row === row), rowsOf = entry => pairs.filter(p => p.near && p.entry === entry);
  const result = new Map();
  for (const row of list) {
    const near = nearOf(row), out = [];
    if (near.length === 1 && rowsOf(near[0].entry).length === 1) out.push(candidate(near[0].entry, 'unique', near[0].gap));
    else for (const p of near) out.push(candidate(p.entry, 'ambiguous', p.gap));
    if (!near.length) {
      const same = calendar.filter(e => e.status !== 'cancelled' && (e.currency || 'JPY') === (row.currency || 'JPY') && (e.type === 'income' ? 'in' : 'out') === directionOf(row) && days(row.date, e.dueDate) <= windowDays);
      let combos = 0;
      for (let i = 0; i < same.length && combos < 3; i++) for (let j = i + 1; j < same.length && combos < 3; j++) if (sum(same[i].amount, same[j].amount) === Math.abs(Number(row.amount))) { combos++; out.push({ kind: 'combined', paymentIds: [String(same[i].id), String(same[j].id)], titles: [String(same[i].title ?? ''), String(same[j].title ?? '')], categories: [String(same[i].category ?? ''), String(same[j].category ?? '')], amount: Math.abs(Number(row.amount)) }); }
      for (const p of pairs.filter(p => !p.near && p.row === row)) out.push(candidate(p.entry, 'late', p.gap));
    }
    result.set(row, out);
  }
  return result;
}
/** The debit/credit preview of one bank row: outgoing debits the purpose account, incoming credits it; the bank account is the other side. */
export function journalPreview(direction, amount, accountName, bankAccountName) {
  const counter = accountName || '勘定科目 未設定', bank = bankAccountName || '普通預金（勘定科目 未設定）';
  return direction === 'in' ? { debit: { account: bank, amount }, credit: { account: counter, amount } } : { debit: { account: counter, amount }, credit: { account: bank, amount } };
}
/** Months between the first and last row that hold no row (YYYY-MM): shown, never treated as proof that nothing happened. */
export function missingMonths(rows) {
  const months = [...new Set(arr(rows).map(r => String(r?.date ?? '').slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort();
  if (months.length < 2) return [];
  const out = [], seen = new Set(months); let [y, m] = months[0].split('-').map(Number); const last = months.at(-1);
  for (;;) { m++; if (m > 12) { m = 1; y++; } const key = y + '-' + String(m).padStart(2, '0'); if (key >= last) break; if (!seen.has(key)) out.push(key); }
  return out;
}
export const EMPTY_VALUES = Object.freeze({ purpose: '', accountCategoryId: '', subAccountCategoryId: '', taxCategoryId: '', taxRate: null, supplierId: '', invoiceNumber: '', notes: '', transferReviewed: false });
const VALUE_KEYS = Object.keys(EMPTY_VALUES), REFERENCE_KEYS = ['accountCategoryId', 'subAccountCategoryId', 'taxCategoryId', 'supplierId'];
/**
 * GUARD — the owner's values over `base`: only the known keys; references are 24-hex IDs or blank (their existence is checked by
 * the server against the existing chart — never fabricated); a T number is `T` + 13 digits or blank and stays unverified; the
 * tax rate is 0..100 or null; texts are bounded. Throws on anything else.
 */
export function classificationValues(input, base = EMPTY_VALUES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('仕訳の内容を確認してください。');
  for (const key of Object.keys(input)) if (!VALUE_KEYS.includes(key)) throw Error('不明な項目です。');
  const v = { ...EMPTY_VALUES, ...(base || {}) };
  for (const key of Object.keys(input)) {
    const x = input[key];
    if (key === 'purpose' || key === 'notes') { const s = String(x ?? '').trim(); if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) || s.length > (key === 'purpose' ? 100 : 2000)) throw Error(key === 'purpose' ? '用途は100文字以内で入力してください。' : 'メモは2000文字以内で入力してください。'); v[key] = s; }
    else if (key === 'transferReviewed') { if (typeof x !== 'boolean') throw Error('資金移動の確認を確認してください。'); v[key] = x; }
    else if (key === 'taxRate') { if (x === null || x === undefined || x === '') v[key] = null; else { const n = Number(x); if (!Number.isFinite(n) || n < 0 || n > 100) throw Error('税率を確認してください。'); v[key] = n; } }
    else if (key === 'invoiceNumber') { const s = String(x ?? '').normalize('NFKC').trim().toUpperCase(); if (s && !/^T\d{13}$/.test(s)) throw Error('T番号は T と13桁の数字で入力してください。'); v[key] = s; }
    else if (REFERENCE_KEYS.includes(key)) { const s = x === null || x === undefined ? '' : String(x); if (s && !/^[a-f\d]{24}$/i.test(s)) throw Error('勘定科目・税区分・取引先を一覧から選択してください。'); v[key] = s.toLowerCase(); }
  }
  return v;
}
/** GUARD — registration readiness of a reviewed draft: a purpose, an account, a current source that no registered predecessor replaced, a reviewed transfer, JPY. */
export function registrationReady(input = {}) {
  const v = input.values || {}, reasons = [];
  if (!String(v.purpose ?? '').trim()) reasons.push('purpose-missing');
  if (!/^[a-f\d]{24}$/i.test(String(v.accountCategoryId ?? ''))) reasons.push('account-missing');
  if (input.sourceChanged) reasons.push('source-changed');
  if (input.superseded) reasons.push('superseded');
  if (input.predecessorRegistered) reasons.push('predecessor-registered');
  if (input.transfer && v.transferReviewed !== true) reasons.push('transfer-unreviewed');
  if ((input.currency || 'JPY') !== 'JPY') reasons.push('currency-unsupported');
  return { ready: reasons.length === 0, reasons };
}
export const UNRESOLVED_LABELS = Object.freeze({
  'purpose-unknown': '用途が不明です（摘要・カレンダー・過去の仕訳に根拠がありません）',
  'transfer-awaiting-other-bank': '資金移動（自社名の振込・他行の入金確認待ち）：経費にしません',
  'calendar-ambiguous': 'カレンダーに同額の候補が複数あるか、同じ予定が複数の明細に当たります',
  'calendar-combined': 'カレンダーの複数件の合計と一致します（要確認）',
  'calendar-late': 'カレンダーの予定日から離れています（要確認）',
  'calendar-category-conflict': 'カレンダーの区分と明細の内容が一致しません',
  'calendar-payee-unverified': 'カレンダーの予定と金額・日付が一致（支払先・勘定科目は未確認）',
  'history-conflict': 'この支払先の過去の仕訳が一致しません',
  'account-not-in-chart': '該当する勘定科目が科目一覧にありません',
  'currency-review': '円以外の通貨です（要確認）',
  'purpose-missing': '用途を入力してください', 'account-missing': '勘定科目を選択してください', 'source-changed': '元の明細が変更されました',
  'superseded': '訂正済みの明細です', 'predecessor-registered': '訂正前の同じ明細で登録・紐付け済みです（二重登録しません）', 'transfer-unreviewed': '資金移動の確認が必要です', 'currency-unsupported': '円以外の明細は登録できません'
});
export function proposalHash(row) {
  const p = row?.proposal || {};
  return JSON.stringify([BANK_CLASSIFICATION_VERSION, p.purposeKind, p.purpose, p.accountCategoryId, p.supplierId, arr(row?.calendarCandidates).map(c => c.kind + ':' + (c.paymentId || arr(c.paymentIds).join('+'))), arr(row?.unresolved)]);
}

/**
 * Proposals for one company: { rows: one entry per input row (same order), notes }. Inputs: rows [{id,date,amount(+out/-in),
 * currency,description}], calendar (the company's entries), history (its registered/linked classifications {payeeKey,direction,
 * values}), teachings (its explicit payee decisions), companyNames (its own names), chart [{id,name,type}], bankAccountName.
 * Precedence: own-company transfer > bank text > teaching > history > unique calendar match. Every row keeps its calendar
 * candidates and unresolved reasons; tax stays unknown and the T number unverified.
 */
export function proposeBankClassifications(input = {}) {
  const rows = arr(input.rows), calendar = arr(input.calendar), history = arr(input.history), teachings = arr(input.teachings), chart = arr(input.chart).filter(a => a && a.id && a.name);
  const selfNames = new Set(arr(input.companyNames).map(normalizePayee).filter(Boolean));
  const byName = name => chart.find(a => a.name === name) || null, byId = id => chart.find(a => String(a.id) === String(id)) || null;
  const bankName = String(input.bankAccountName ?? '').trim(), matches = calendarMatches(rows, calendar);
  const out = rows.map(row => {
    const direction = directionOf(row), amount = Math.abs(Number(row.amount)), payeeKey = normalizePayee(row.description), unresolved = [], evidence = [];
    const candidates = matches.get(row) || [];
    const sameDirection = x => (x?.direction ?? direction) === direction;
    const taughtSelf = !!payeeKey && teachings.some(t => normalizePayee(t?.payeeKey) === payeeKey && sameDirection(t) && t?.values?.purpose === 'own-transfer');
    let proposal = null, transfer = null;
    const set = (purposeKind, purpose, account, origin, extra = {}) => { proposal = { purposeKind, purpose, accountCategoryId: account ? String(account.id) : null, accountName: account ? account.name : null, supplierId: extra.supplierId || null, origin, confidence: account ? 'supported' : 'review' }; if (!account && extra.needsAccount !== false) unresolved.push('account-not-in-chart'); };
    if (selfNames.has(payeeKey) || taughtSelf) {
      proposal = { purposeKind: 'own-transfer', purpose: '資金移動（自社口座間）', accountCategoryId: null, accountName: null, supplierId: null, origin: selfNames.has(payeeKey) ? 'own-company-name' : 'teaching', confidence: 'review' };
      transfer = { kind: 'own-company', proof: 'awaiting-other-bank' }; unresolved.push('transfer-awaiting-other-bank');
      evidence.push({ kind: proposal.origin, label: proposal.origin === 'teaching' ? '自社口座として記憶した支払先' : '自社名への振込' });
    }
    const text = proposal ? null : textPurpose(row.description, direction);
    if (text) { set(text.kind, text.label, byName(text.account), 'bank-text'); evidence.push({ kind: 'bank-text', label: '明細の摘要: ' + String(row.description ?? '').slice(0, 60) }); }
    if (!proposal && payeeKey) {
      const taught = teachings.filter(t => normalizePayee(t?.payeeKey) === payeeKey && sameDirection(t) && t?.values?.purpose !== 'own-transfer');
      if (taught.length) { const v = taught[0].values || {}, account = byId(v.accountCategoryId); set('teaching', v.purpose || account?.name || '', account, 'teaching', { supplierId: v.supplierId }); evidence.push({ kind: 'teaching', label: 'この支払先として記憶した仕訳' }); }
    }
    if (!proposal && payeeKey) {
      const past = history.filter(h => normalizePayee(h?.payeeKey) === payeeKey && h?.direction === direction);
      if (past.length) {
        const keys = new Set(past.map(h => (h.values?.purpose || '') + '|' + (h.values?.accountCategoryId || '')));
        if (keys.size === 1) { const v = past[0].values || {}, account = byId(v.accountCategoryId); set('history', v.purpose || account?.name || '', account, 'history', { supplierId: v.supplierId }); }
        else { proposal = { purposeKind: 'none', purpose: '', accountCategoryId: null, accountName: null, supplierId: null, origin: 'history', confidence: 'review' }; unresolved.push('history-conflict'); }
        evidence.push({ kind: 'history', label: '同じ支払先の過去の仕訳 ' + past.length + '件' });
      }
    }
    const unique = candidates.find(c => c.kind === 'unique');
    // A unique calendar match is a candidate purpose (its title), never an account: a category is a planning label and the same
    // amount/date is not a verified payee, so the owner chooses the account (review).
    if (!proposal && unique) { proposal = { purposeKind: 'calendar', purpose: unique.title || unique.category, accountCategoryId: null, accountName: null, supplierId: null, origin: 'calendar', confidence: 'review' }; unresolved.push('calendar-payee-unverified'); }
    for (const c of candidates) evidence.push({ kind: 'calendar', label: 'カレンダー: ' + (c.kind === 'combined' ? c.titles.join('＋') + '（合計 ' + c.amount + '）' : c.title + '（' + c.dueDate + ' · ' + (c.category || '区分なし') + '）') + ' [' + c.kind + ']' });
    if (candidates.some(c => c.kind === 'ambiguous')) unresolved.push('calendar-ambiguous');
    if (candidates.some(c => c.kind === 'combined')) unresolved.push('calendar-combined');
    if (candidates.some(c => c.kind === 'late')) unresolved.push('calendar-late');
    const categories = new Set(candidates.flatMap(c => c.kind === 'combined' ? c.categories : [c.category]).filter(Boolean));
    const conflict = categories.size > 1 || !!(unique && unique.category && proposal && !['calendar', 'own-transfer', 'none'].includes(proposal.purposeKind) && (byName(unique.category)?.id ?? unique.category) !== (proposal.accountCategoryId ?? proposal.accountName));
    if (conflict) unresolved.push('calendar-category-conflict');
    if (!proposal) { proposal = { purposeKind: 'none', purpose: '', accountCategoryId: null, accountName: null, supplierId: null, origin: 'none', confidence: candidates.length ? 'review' : 'none' }; unresolved.push('purpose-unknown'); }
    if (proposal.confidence === 'supported' && (conflict || unresolved.some(r => r.startsWith('calendar-')))) proposal.confidence = 'review';
    if ((row.currency || 'JPY') !== 'JPY') { unresolved.push('currency-review'); if (proposal.confidence === 'supported') proposal.confidence = 'review'; }
    const accountName = proposal.accountName || null;
    return {
      rowId: String(row.id ?? ''), date: row.date, amount, direction, currency: row.currency || 'JPY', description: String(row.description ?? ''), payeeKey,
      proposal, evidence, unresolved: [...new Set(unresolved)], calendarCandidates: candidates, transfer, tax: { status: 'unknown' }, invoice: { value: null, status: 'unverified' },
      preview: journalPreview(direction, amount, accountName, bankName),
      values: { ...EMPTY_VALUES, purpose: proposal.purposeKind === 'none' ? '' : proposal.purpose, accountCategoryId: proposal.accountCategoryId || '', supplierId: proposal.supplierId || '' }
    };
  });
  return { rows: out, notes: { historyEmpty: history.length === 0 && teachings.length === 0, monthsWithoutRows: missingMonths(rows), calendarEntries: calendar.filter(e => e?.status !== 'cancelled').length } };
}

import { createHash } from 'node:crypto';

export const PARSER_VERSION = 'amex-jp-1';
export const HEADERS = ['ご利用日', 'データ処理日', 'ご利用内容', 'カード会員様名', '会員番号 #', '金額', '海外通貨利用金額', '換算レート'];
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const digest = value => createHash('sha256').update(value).digest('hex');

export function dateOnly(value) {
  const match = String(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) throw new Error('日付の形式が正しくありません');
  const [, y, m, d] = match;
  const result = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new Error('存在しない日付です');
  return result;
}

export function parseAmount(value) {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) throw new Error('金額の形式が正しくありません');
  const clean = text.replace(/,/g, '');
  const [whole, fraction = ''] = clean.replace(/^[+-]/, '').split('.');
  const minor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (clean.startsWith('-') ? -1n : 1n);
  if (minor > 100000000000000n || minor < -100000000000000n) throw new Error('金額が上限を超えています');
  return Number(minor) / 100;
}

// Strict CSV reader: preserve quoted commas/newlines, reject malformed input.
export function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === '"') {
      if (field || closed) throw new Error('CSVの引用符が正しくありません');
      quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else { if (closed && !/\s/.test(char)) throw new Error('CSVの引用符の後に不正な文字があります'); if (!closed) field += char; }
    if (rows.length > MAX_ROWS + 1 || field.length > 20000) throw new Error('ファイルを月ごとに分割してください');
  }
  if (quoted) throw new Error('CSVの引用符が閉じられていません');
  if (row.length || field || closed) finishRow();
  return rows;
}

export function parseAmex(bytes, cardIdentifiers) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('CSVは5MB以下にしてください');
  let text, encoding = 'utf-8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { encoding = 'shift_jis'; text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
  const table = csvRows(text.replace(/^\uFEFF/, ''));
  const headers = table.shift();
  if (!headers || headers.length !== HEADERS.length || headers.some((h, i) => h.trim() !== HEADERS[i])) throw new Error('対応するAmex日本のCSVではありません。列構成を確認してください');
  if (!table.length || table.length > MAX_ROWS) throw new Error('CSVの行数は1〜5000行にしてください');
  const allowed = new Set(cardIdentifiers);
  const occurrences = new Map();
  const rows = table.map((cells, index) => {
    try {
      if (cells.length !== HEADERS.length) throw new Error('列数が一致しません');
      const raw = Object.fromEntries(HEADERS.map((h, i) => [h, cells[i]]));
      // Amex exports the displayed suffix as "-12345". Keep it verbatim in raw.
      const cardIdentifier = cells[4].trim().replace(/^-/, '');
      if (!/^\d{5}$/.test(cardIdentifier) || !allowed.has(cardIdentifier)) throw new Error('この口座に登録されていないカードです');
      const description = cells[2].trim();
      if (!description || description.length > 2000 || cells[3].length > 300) throw new Error('ご利用内容または会員名を確認してください');
      const amount = parseAmount(cells[5]);
      const kind = amount > 0 ? 'expense' : description === '前回分口座振替金額' && amount < 0 ? 'repayment' : 'credit_review';
      const normalized = { purchaseDate: dateOnly(cells[0]), processingDate: dateOnly(cells[1]), description, cardholder: cells[3].trim(), cardIdentifier, amount, currency: 'JPY', foreignAmount: cells[6].trim(), exchangeRate: cells[7].trim(), kind };
      const fingerprint = digest(JSON.stringify([normalized.purchaseDate, normalized.processingDate, cardIdentifier, description.normalize('NFC'), amount, normalized.foreignAmount, normalized.exchangeRate]));
      const occurrence = (occurrences.get(fingerprint) || 0) + 1; occurrences.set(fingerprint, occurrence);
      return { line: index + 2, ...normalized, fingerprint, occurrence, key: `${fingerprint}:${occurrence}`, raw };
    } catch (error) { throw new Error(`${index + 2}行目: ${error.message}`); }
  });
  if (Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024) throw new Error('CSVを小さい期間に分割してください');
  return { parserVersion: PARSER_VERSION, encoding, sha256: digest(bytes), rows };
}

export function period(value) {
  if (!value || !['statement', 'recent'].includes(value.kind)) throw new Error('対象期間を指定してください');
  const start = dateOnly(value.start), end = dateOnly(value.end);
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 370) throw new Error('対象期間が正しくありません');
  return { kind: value.kind, start, end, key: `${value.kind}:${start}:${end}` };
}

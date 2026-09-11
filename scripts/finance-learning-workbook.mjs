import XLSX from 'xlsx';
import { hash, norm, sourceUrl, validDate, classification, aggregatePatterns, learningVersion } from '../shared/finance-learning.mjs';
const headers = ['日付','区別','金額','顧客','支払い方法','カード番号','仕入れ先','区分','備考'];
const oid = s => typeof s === 'string' && /^[a-f\d]{24}$/.test(s);
function dateOf(cell, date1904) {
  if (cell?.t === 'n' && XLSX.SSF.is_date(cell.format || '')) {
    const d = XLSX.SSF.parse_date_code(cell.value, {date1904});
    if (d) { const value = `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; if (validDate(value)) return value; }
  }
  if (cell?.t === 'd' && validDate(String(cell.value).slice(0,10))) return cell.value.slice(0,10);
  const m = String(cell?.value ?? '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const s = m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : '';
  return validDate(s) ? s : '';
}
function amountOf(cell) { const s = String(cell?.value ?? '').normalize('NFKC').replace(/[¥￥,\s]/g,''); return /^-?\d+(?:\.\d+)?$/.test(s) && Number.isFinite(+s) ? +s : null; }
export function prepareWorkbook(bytes, config) {
  if (!bytes.length || bytes.length > 20*1024*1024) throw Error('Workbook must be 1 byte–20 MB');
  if (!config || !oid(config.ownerId) || typeof config.primarySheet !== 'string' || typeof config.title !== 'string' || !config.title.trim()) throw Error('Owner, title and primary sheet are required');
  const url = sourceUrl(config.sourceUrl), bindings = config.accountBindings || [], aliases = config.customerAliases || [];
  for (const [list, field] of [[bindings,'accountId'],[aliases,'customerId']]) {
    const seen = new Set();
    for (const b of list) { if (!oid(b[field]) || !Array.isArray(b.labels) || !b.labels.length) throw Error('Invalid binding'); for (const label of b.labels) { if (typeof label !== 'string' || !norm(label) || seen.has(norm(label))) throw Error('Empty or repeated binding'); seen.add(norm(label)); } }
  }
  const workbook = XLSX.read(bytes, { type:'buffer', cellDates:false, cellFormula:true, cellNF:true, cellText:true });
  if (!workbook.SheetNames.includes(config.primarySheet)) throw Error('Primary sheet missing');
  const sheets = [], rows = []; let cellCount = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name], byRow = new Map();
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!') || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ''))) continue;
      const pos = XLSX.utils.decode_cell(address), row = pos.r + 1;
      if (++cellCount > 1500000 || row > 1000000) throw Error('Workbook exceeds learning limits');
      if (!byRow.has(row)) byRow.set(row, []);
      const value = cell.v instanceof Date ? cell.v.toISOString() : cell.v ?? null;
      byRow.get(row).push({ address, column: XLSX.utils.encode_col(pos.c), t:cell.t, value, formatted: cell.w ?? XLSX.utils.format_cell(cell), formula: cell.f || '', format:cell.z || '' });
    }
    const populated = [...byRow].sort((a,b) => a[0]-b[0]);
    const header = populated.slice(0,30).find(([,cells]) => cells.filter(c => headers.includes(String(c.value).trim())).length >= 5);
    const cols = new Map(header ? header[1].map(c => [c.column, String(c.value).trim()]) : []);
    let dated = 0, eligible = 0;
    for (const [row,cells] of populated) {
      const isData = !!header && row > header[0], values = {};
      for (const c of cells) { c.header = cols.get(c.column) || ''; if (c.header && isData && !Object.hasOwn(values,c.header)) values[c.header] = c; }
      const text = key => String(values[key]?.value ?? '').trim();
      const parsed = { date:dateOf(values['日付'], !!workbook.Workbook?.WBProps?.date1904), flow:text('区別'), amount:amountOf(values['金額']), customer:text('顧客'), payment:text('支払い方法'), card:text('カード番号'), merchant:text('仕入れ先'), category:text('区分'), notes:text('備考') };
      const binding = bindings.find(b => b.labels.some(l => norm(l) === norm(parsed.card)));
      const assigned = classification(parsed.customer, aliases);
      const alias = aliases.find(a => a.customerId === assigned.customerId);
      const record = { sheet:name, row, cells, parsed, date:parsed.date, merchant:norm(parsed.merchant), card:norm(parsed.card), payment:norm(parsed.payment), accountId:binding?.accountId || '', ...assigned, customerName:alias?.name || parsed.customer, eligible:name === config.primarySheet && !!parsed.date && parsed.flow === '支出' && parsed.amount > 0 && !!norm(parsed.merchant), patternKey:'' };
      if (parsed.date) dated++; if (record.eligible) eligible++; rows.push(record);
    }
    sheets.push({ name, headerRow:header?.[0] || null, populatedRows:populated.length, datedRows:dated, eligibleRows:eligible, role:name === config.primarySheet ? 'primary' : populated.length ? 'reference' : 'empty' });
  }
  const primary = sheets.find(s => s.name === config.primarySheet);
  if (!primary.headerRow || !primary.eligibleRows) throw Error('Primary ledger has no supported outflow rows');
  const patterns = aggregatePatterns(rows), primaryRows = rows.filter(r => r.sheet === config.primarySheet && r.row > primary.headerRow);
  const dates = primaryRows.map(r => r.date).filter(Boolean).sort();
  const summary = { rowCount:rows.length, cellCount, primaryRows:primaryRows.length, datedRows:primary.datedRows, eligibleRows:primary.eligibleRows, outflowRows:primaryRows.filter(r => r.date && r.parsed.flow === '支出' && r.parsed.amount > 0).length, patternCount:patterns.length, dateFrom:dates[0], dateTo:dates.at(-1), grades:Object.fromEntries(['B','C','D'].map(g => [g,patterns.filter(p => p.grade === g).length])) };
  const dataset = { version:learningVersion, ownerId:config.ownerId, title:config.title.trim(), sourceUrl:url, sourceHash:hash(bytes), primarySheet:config.primarySheet, sheets, summary, accountBindings:bindings, customerAliases:aliases, instructions:config.instructions || [] };
  const bundle = { dataset, rows, patterns }; return { ...bundle, bundleHash:hash(JSON.stringify(bundle)) };
}

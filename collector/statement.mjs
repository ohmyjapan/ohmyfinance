import { dateOnly, period } from '../shared/amex.mjs';

export const STATEMENT = 'https://global.americanexpress.com/activity/statement';
export const RECENT = 'https://global.americanexpress.com/activity/recent';
// What a collector declares in its card claim to receive a recent Amex job (server/services/financeService.ts AMEX_RECENT_CAPABILITY).
export const RECENT_CAPABILITY = 'amex-recent-v1';
export const tokyoDate = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);

function range(text) {
  const match = String(text).trim().match(/^(\d{4}\/\d{2}\/\d{2})\s*[-－–]\s*(\d{4}\/\d{2}\/\d{2})$/);
  return match ? period({ kind: 'statement', start: match[1], end: match[2] }) : null;
}

export function latestClosed(links, now = Date.now()) {
  const choices = new Map();
  for (const link of links) {
    const url = new URL(link.href, STATEMENT);
    if (url.origin !== new URL(STATEMENT).origin || url.pathname !== '/activity/statement' || !url.searchParams.has('end')) continue;
    const coverage = range(link.text);
    // Amex also repeats the same href on a non-date "view this period" link.
    if (!coverage) continue;
    if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => k !== 'end') || url.searchParams.getAll('end').length !== 1 || url.searchParams.get('end') !== coverage.end) throw new Error('Amex statement link and dates do not agree');
    if (coverage.end >= tokyoDate(now)) continue;
    if (choices.has(coverage.end) && choices.get(coverage.end).start !== coverage.start) throw new Error('Amex lists conflicting statement dates');
    choices.set(coverage.end, { ...coverage, url: url.href });
  }
  const selected = [...choices.values()].sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!selected) throw new Error('No closed Amex statement is available');
  return selected;
}

export function verifyStatement(snapshot, selected, primaryCard) {
  const url = new URL(snapshot.url);
  if (url.origin !== new URL(STATEMENT).origin || url.pathname !== '/activity/statement' || url.searchParams.get('end') !== selected.end) throw new Error('Amex did not open the selected statement');
  const cards = [...new Set(snapshot.cards)];
  if (cards.length !== 1 || cards[0] !== '-' + primaryCard) throw new Error('The signed-in Amex account does not match this connection');
  const displayed = [...new Set(snapshot.periods.map(text => range(text.replace(/^[（(]|[）)]$/g, ''))?.key))];
  if (displayed.length !== 1 || displayed[0] !== selected.key) throw new Error('Amex displayed dates do not match the selected closed statement');
  const counts = [...new Set(snapshot.counts.map(pair => JSON.stringify(pair)))].map(pair => JSON.parse(pair));
  if (counts.length !== 1 || !counts[0].every(n => Number.isSafeInteger(n) && n > 0 && n <= 5000) || counts[0][0] !== counts[0][1]) throw new Error('Amex complete statement row count could not be verified');
  return counts[0][0];
}

// The recent activity (case omf-amex-recent-activity-20261102): the current cycle up to today, provisional by nature. latestClosed and verifyStatement above are not used for it, and it never
// reaches them. The page shows "start-kyou genzai (jikai shimebi closing)"; only that shape is read (the marks are the ones verifyStatement's dates allow). Coverage is processing dates, from the
// displayed start to the observation day in Japan: the displayed closing is the cycle's end, not a date the activity has reached, and no field is invented for it.
const WRONG_CARD = 'The signed-in Amex account does not match this connection', UNCOVERED = 'Amex displayed dates do not cover the current activity';
const RECENT_RANGE = /^(\d{4}\/\d{2}\/\d{2})\s*[ー\-－–]\s*今日現在\s*[（(]\s*次回締め日\s*(\d{4}\/\d{2}\/\d{2})\s*[）)]$/;
export function recentRange(text) {
  const match = String(text).trim().match(RECENT_RANGE);
  if (!match) return null;
  try { const start = dateOnly(match[1]), closing = dateOnly(match[2]); return { start, closing, key: `${start}:${closing}` }; } catch { return null; }
}
export function verifyRecent(snapshot, primaryCard, now = Date.now()) {
  const url = new URL(snapshot.url);
  if (url.origin !== new URL(RECENT).origin || url.pathname !== '/activity/recent') throw new Error('Amex did not open the recent activity');
  const cards = [...new Set(snapshot.cards)];
  if (cards.length !== 1 || cards[0] !== '-' + primaryCard) throw new Error(WRONG_CARD);
  const ranges = [...new Set(snapshot.ranges.map(text => recentRange(text)?.key))];
  if (ranges.length !== 1 || !ranges[0]) throw new Error(UNCOVERED);
  const { start, closing } = recentRange(snapshot.ranges[0]), end = tokyoDate(now);
  if (start > end || closing < end) throw new Error(UNCOVERED);
  const counts = [...new Set(snapshot.counts.map(pair => JSON.stringify(pair)))].map(pair => JSON.parse(pair));
  if (counts.length !== 1 || !counts[0].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 5000) || counts[0][0] !== counts[0][1]) throw new Error('Amex complete recent activity count could not be verified');
  if (counts[0][0] === 0) throw new Error('Amex shows no recent activity to import');
  return { kind: 'pending', start, closing, end, key: ranges[0], pageCount: counts[0][0] };
}
// A purchase date may lie before the cycle (a late submission); the processing date is what the displayed range covers. shared/finance-pending.mjs holds an import to the same rule.
export function verifyRecentRows(rows, selected) {
  if (rows.some(row => row.processingDate < selected.start || row.processingDate > selected.end)) throw new Error('Downloaded recent activity is outside its displayed dates');
}

// Only date controls, card suffixes and totals leave the browser; no transaction DOM is saved.
export function statementSnapshot() {
  return {
    url: location.href,
    links: [...document.querySelectorAll('a[href]')].filter(a => a.getAttribute('href').includes('/activity/statement?end=')).map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
    periods: [...document.querySelectorAll('span,p,div')].filter(e => e.childElementCount === 0 && /^[（(]\d{4}\/\d{2}\/\d{2}\s*[-－–]\s*\d{4}\/\d{2}\/\d{2}[）)]$/.test(e.textContent.trim())).map(e => e.textContent.trim()),
    cards: [...document.querySelectorAll('button')].map(e => e.textContent.trim()).filter(text => /^-\d{5}$/.test(text)),
    counts: [...document.body.innerText.matchAll(/([\d,]+)\s*件中\s*([\d,]+)\s*件を表示/g)].map(m => [Number(m[1].replaceAll(',', '')), Number(m[2].replaceAll(',', ''))])
  };
}

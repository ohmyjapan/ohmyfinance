import { period } from '../shared/amex.mjs';

export const STATEMENT = 'https://global.americanexpress.com/activity/statement';
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

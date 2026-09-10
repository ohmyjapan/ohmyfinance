export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function onSurface(page, origin, pathname) {
  try { const url = new URL(page.url()); return url.origin === origin && (!pathname || url.pathname === pathname); }
  catch { return false; }
}

export function requireSurface(page, origin, pathname) {
  if (!onSurface(page, origin, pathname)) throw new Error('The Amex page changed; check Chrome before retrying');
}

export async function poll(read, timeoutMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  do {
    try { const result = await read(); if (result) return result; }
    catch (error) {
      // Navigation can replace the document between reading the URL and evaluating it.
      if (!/Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
    }
    await pause(intervalMs);
  } while (Date.now() < deadline);
  return null;
}

// Native input avoids ElementHandle's isolated-world calls in the real Chrome connection.
export async function fill(page, selector, value, origin, pathname) {
  requireSurface(page, origin, pathname);
  await page.evaluate(selector => {
    const input = document.querySelector(selector);
    if (!input || input.disabled || input.readOnly || !input.getBoundingClientRect().height) throw new Error('Amex input unavailable');
    input.focus();
  }, selector);
  requireSurface(page, origin, pathname);
  await page.keyboard.down('Control');
  try { await page.keyboard.press('A'); } finally { await page.keyboard.up('Control'); }
  await page.keyboard.type(value);
}

export async function click(page, selector, text, origin, pathname) {
  requireSurface(page, origin, pathname);
  const point = await page.evaluate(({ selector, text }) => {
    const targets = [...document.querySelectorAll(selector)].filter(e => !e.disabled && e.getBoundingClientRect().height && (text === null || e.textContent.trim() === text));
    if (targets.length !== 1) throw new Error('Amex control did not uniquely match');
    targets[0].scrollIntoView({ block: 'center' });
    const rect = targets[0].getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    if (!targets[0].contains(document.elementFromPoint(x, y))) throw new Error('Amex control is covered by another element');
    return { x, y };
  }, { selector, text });
  requireSurface(page, origin, pathname);
  await page.mouse.click(point.x, point.y);
}

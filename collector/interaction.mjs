export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function onSurface(page, origin, pathname) {
  try { const url = new URL(page.url()); return url.origin === origin && (!pathname || url.pathname === pathname); }
  catch { return false; }
}

export function requireSurface(page, origin, pathname, label = 'Amex') {
  if (!onSurface(page, origin, pathname)) throw new Error(`The ${label} page changed; check Chrome before retrying`);
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
export async function fill(page, selector, value, origin, pathname, label = 'Amex') {
  requireSurface(page, origin, pathname, label);
  await page.evaluate(({ selector, label }) => {
    const input = document.querySelector(selector);
    if (!input || input.disabled || input.readOnly || !input.getBoundingClientRect().height) throw new Error(label + ' input unavailable');
    input.focus();
  }, { selector, label });
  requireSurface(page, origin, pathname, label);
  await page.keyboard.down('Control');
  try { await page.keyboard.press('A'); } finally { await page.keyboard.up('Control'); }
  await page.keyboard.type(value);
}

export async function click(page, selector, text, origin, pathname, label = 'Amex') {
  requireSurface(page, origin, pathname, label);
  const point = await page.evaluate(({ selector, text, label }) => {
    const targets = [...document.querySelectorAll(selector)].filter(e => !e.disabled && e.getBoundingClientRect().height && (text === null || e.textContent.trim() === text));
    if (targets.length !== 1) throw new Error(label + ' control did not uniquely match');
    targets[0].scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = targets[0].getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    if (!targets[0].contains(document.elementFromPoint(x, y))) throw new Error(label + ' control is covered by another element');
    return { x, y };
  }, { selector, text, label });
  requireSurface(page, origin, pathname, label);
  await page.mouse.click(point.x, point.y);
}

// collector/bank-certificate.mjs — the bank client-certificate chooser of the collector's own Chrome (plan omf-ikeda-collector-20261025).
// Loaded only by collector/banks/ikeda.mjs; the launcher (browser.mjs) is unchanged. The owned Chrome is the browser process this node
// process spawned (browser.process(): its pid, its --user-data-dir and its executable); windows/bank-certificate.ps1 proves that identity
// (parent = this process, created after this process started, the same executable and profile, the current Windows user and session)
// before it looks at any window, and answers only that process's chooser with UI Automation select/invoke — never the cursor or the
// keyboard, never another process, never a browser policy, registry key or certificate import/export. The result is value-free:
// {outcome: 'selected'|'no-dialog'|'attention'|'aborted', reason}. 'attention' (ambiguous/missing/expired certificate, an unverifiable
// process, a helper error) leaves the chooser to the person in the same owned window. Imports only node built-ins.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The public CA name of the bank certificates of 池田泉州銀行 (the issuer shown in the chooser; SAFE-CONTRACT step 3). */
export const IKEDA_ISSUER = 'The Senshu Ikeda Bank, Ltd. CA - G4';
/** The bank's public name inside that issuer: the owner's chooser showed one row without separate cells whose name contained it. */
export const IKEDA_BANK_NAME = 'The Senshu Ikeda Bank, Ltd.';
const HELPER = fileURLToPath(new URL('./windows/bank-certificate.ps1', import.meta.url));
const OUTCOMES = ['selected', 'no-dialog', 'attention', 'aborted'];
const REASONS = ['process', 'missing', 'ambiguous', 'ambiguous-chooser', 'not-in-store', 'expired', 'no-private-key', 'not-selected', 'issuer', 'helper-error', 'unreadable'];
/** The owned Chrome of `browser` (a ChildProcess spawned by this process), or null when it was not launched here. */
export function ownedChrome(browser) {
  let child = null; try { child = browser?.process?.() ?? null; } catch { child = null; }
  if (!child?.pid || !Array.isArray(child.spawnargs)) return null;
  const arg = child.spawnargs.find(a => typeof a === 'string' && a.startsWith('--user-data-dir='));
  return arg && child.spawnfile ? { pid: child.pid, profile: arg.slice('--user-data-dir='.length).replace(/^"|"$/g, ''), executable: child.spawnfile } : null;
}
/** The value-free result of one helper line (pure): unknown outcomes/reasons never pass. */
export function certificateResult(stdout) {
  const line = String(stdout ?? '').trim().split(/\r?\n/).pop() || ''; let value = null; try { value = JSON.parse(line); } catch { value = null; }
  if (!value || typeof value !== 'object' || !OUTCOMES.includes(value.outcome)) return { outcome: 'attention', reason: 'unreadable' };
  return { outcome: value.outcome, reason: value.outcome === 'attention' ? (REASONS.includes(value.reason) ? value.reason : 'unreadable') : null };
}
/**
 * Answers the certificate chooser of the owned Chrome of `browser` once, within `timeoutMs` ('no-dialog' when none appeared). `signal`
 * ends the helper (the page moved on by itself): 'aborted'. `execute` is the test seam for execFile.
 */
export async function selectBankCertificate(browser, { issuer = IKEDA_ISSUER, bankName = IKEDA_BANK_NAME, timeoutMs = 20000, signal = null, execute = execFile, startedAt = Date.now() - process.uptime() * 1000 } = {}) {
  const owned = ownedChrome(browser);
  if (!owned) return { outcome: 'attention', reason: 'process' };
  const args = ['-NoProfile', '-NonInteractive', '-File', HELPER, '-ProcessId', String(owned.pid), '-ParentId', String(process.pid), '-ProfilePath', owned.profile, '-ChromePath', owned.executable, '-NotBefore', new Date(startedAt).toISOString(), '-Issuer', issuer, '-BankName', bankName, '-TimeoutMs', String(timeoutMs)];
  return new Promise(resolve => {
    try {
      execute('powershell.exe', args, { windowsHide: true, timeout: timeoutMs + 30000, signal: signal ?? undefined }, (error, stdout) => {
        if (signal?.aborted || error?.name === 'AbortError') return resolve({ outcome: 'aborted', reason: null });
        resolve(error && !String(stdout || '').trim() ? { outcome: 'attention', reason: 'helper-error' } : certificateResult(stdout));
      });
    } catch { resolve({ outcome: 'attention', reason: 'helper-error' }); }
  });
}

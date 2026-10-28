// collector/puppeteer-frame-init.mjs — backport of puppeteer/puppeteer#14701 (commit b8b1004, 2026-02-18) onto the pinned
// rebrowser-puppeteer-core 23.10.3 (collector/package.json; plan omf-downloader-release-ready-20261028). In that release
// FrameManager.onAttachedToTarget starts an out-of-process iframe's initialization with `void this.initialize(...)` and no
// rejection handler (lib/esm/puppeteer/cdp/FrameManager.js:294). A protocol error during it — the installed collector's
// 2026-10-28 "Network.enable timed out" — is then an unhandled rejection, which ends the whole collector process. Upstream's
// accepted fix attaches .catch(debugError) to that one call; this module installs exactly that method on the release's
// FrameManager once, when collector/browser.mjs loads (before any owned Chrome is launched).
// Unchanged: the non-iframe return, the frame's client update, the session's event listeners, initialize itself (an awaited
// initialize still rejects; a closed target is still ignored inside it) and every other SDK callback. No process-wide rejection
// handler is installed, so any other unhandled rejection still ends the process as before. The installed SDK files are not edited.
// The method is replaced only when its text is exactly the 23.10.3 one; any other text (an SDK that already handles it, or a
// different release) is left as it is and reported in FRAME_INIT_FIX.state — never refused.
import { FrameManager } from 'rebrowser-puppeteer-core/internal/cdp/FrameManager.js';
import { debugError } from 'rebrowser-puppeteer-core/internal/common/util.js';

const PINNED = "onAttachedToTarget(target) { if (target._getTargetInfo().type !== 'iframe') { return; } const frame = this.frame(target._getTargetInfo().targetId); if (frame) { frame.updateClient(target._session()); } this.setupEventListeners(target._session()); void this.initialize(target._session(), frame); }";
const textOf = fn => typeof fn === 'function' ? Function.prototype.toString.call(fn).replace(/\s+/g, ' ').trim() : '';

// The upstream method (puppeteer#14701), otherwise identical to the 23.10.3 one.
function onAttachedToTarget(target) {
  if (target._getTargetInfo().type !== 'iframe') {
    return;
  }
  const frame = this.frame(target._getTargetInfo().targetId);
  if (frame) {
    frame.updateClient(target._session());
  }
  this.setupEventListeners(target._session());
  void this.initialize(target._session(), frame).catch(debugError);
}

function install() {
  const descriptor = Object.getOwnPropertyDescriptor(FrameManager.prototype, 'onAttachedToTarget');
  const current = textOf(descriptor?.value);
  if (descriptor?.value === onAttachedToTarget) return 'installed';
  if (current !== PINNED) return /\.catch\(/.test(current) ? 'already-handled' : 'not-applied'; // guard:frame-init-pinned-text
  Object.defineProperty(FrameManager.prototype, 'onAttachedToTarget', { ...descriptor, value: onAttachedToTarget });
  return 'installed';
}

/** state: 'installed' (this backport is in place), 'already-handled' (the SDK's own method already catches) or 'not-applied' (an unknown method, left unchanged). */
export const FRAME_INIT_FIX = Object.freeze({ state: install(), upstream: 'https://github.com/puppeteer/puppeteer/pull/14701' });

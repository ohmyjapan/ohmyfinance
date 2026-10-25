// Test harness only. The caller must pass the browser it launched, never a connected user's browser.
const exited = child => child.exitCode != null || child.signalCode != null;

async function closeOwnedBrowser(browser, { graceMs = 10000, exitMs = 5000, primaryError = null } = {}) {
  const fail = error => {
    if (primaryError) throw new AggregateError([primaryError, error], 'Receipt library test failed and owned Chrome cleanup failed');
    throw error;
  };
  const child = browser.process();
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0 || typeof child.kill !== 'function') {
    fail(new Error('Owned browser process required for test cleanup'));
  }
  const timers = new Set();
  const delay = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timers.add(timer); });
  let onExit, forced = false, closeError = null, failure = null;
  const stopped = new Promise(resolve => {
    onExit = resolve;
    if (exited(child)) resolve();
    else child.once('exit', onExit);
  });
  try {
    if (!exited(child)) {
      const graceful = Promise.resolve().then(() => browser.close()).then(
        () => stopped,
        error => { closeError = error; return 'protocol-error'; },
      );
      await Promise.race([graceful, stopped, delay(graceMs)]);
      if (!exited(child)) {
        forced = true;
        child.kill(); // The exact ChildProcess handle owned by this test, with no process-name or foreign-PID kill.
        await Promise.race([
          stopped,
          delay(exitMs).then(() => { throw new Error('Owned browser process did not exit after cleanup'); }),
        ]);
      }
      if (!exited(child)) throw new Error('Owned browser process exit was not observed');
    }
  } catch (error) {
    failure = error;
  }
  for (const timer of timers) clearTimeout(timer);
  child.removeListener('exit', onExit);
  try { await browser.disconnect(); } catch (error) {
    failure = failure ? new AggregateError([failure, error], 'Owned browser cleanup and disconnect failed') : error;
  }
  if (failure) fail(failure);
  return { forced, processExited: true, protocolError: closeError?.name || null };
}

module.exports = { closeOwnedBrowser };

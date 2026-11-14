// TEST ONLY. rebrowser-puppeteer-core 23.10.3 Binding.run settles the browser
// promise and deletes its callbacks entry in the same evaluation. Node STORE
// completion alone does not mean the overlay has received that result.
// Read only the callback count; never inspect arguments, results or bank values.
export async function waitForLearningCapture(surface, recording) {
  if (!recording || typeof recording.then !== 'function') throw Error('capture-recording-boundary-required');
  const abort = new AbortController();
  const ended = recording.then(
    () => { throw Error('recording-ended-before-capture-ack'); },
    error => { throw error; }
  );
  try {
    const handle = await Promise.race([
      surface.waitForFunction(() => {
        if (!document.querySelector('#omf-learning-control')) return false;
        const names = Object.keys(window).filter(name => /^__omfLearn[0-9a-f]{16}$/.test(name));
        if (names.length !== 1) return false;
        const binding = window[names[0]];
        if (typeof binding !== 'function') return false;
        // The pinned SDK creates callbacks lazily. A never-called binding is
        // initial idle, not an acknowledgment of a missing/retired invocation.
        if (binding.callbacks === undefined) return binding.lastSeq === undefined;
        return binding.callbacks instanceof Map && binding.callbacks.size === 0;
      }, {timeout: 0, signal: abort.signal}),
      ended
    ]);
    await handle.dispose();
  } finally {
    abort.abort();
  }
}

export async function selectLearningRole(surface, role, recording) {
  // For a navigation/popup, inspect the explicitly selected current document.
  // A new document's initial idle is not proof that its retired source ACKed;
  // the caller's unchanged persisted-event assertion still owns acceptance.
  await waitForLearningCapture(surface, recording);
  return surface.select('#omf-learning-control select', role);
}

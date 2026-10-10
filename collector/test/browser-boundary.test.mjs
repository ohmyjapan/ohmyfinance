// collector/test/browser-boundary.test.mjs — legs B1-B7 of plan omf-customer-credential-security-20261009 §4: the real
// stock Chrome of this host, launched by the real collector/browser.mjs on temporary ephemeral profiles, HEADLESS (the
// verifier runs hidden; the sandbox, flag set, transport and integrity are the same as the headed first-release launch),
// with the real collector started IN THIS PROCESS (startCollector on a private temp directory, the fake key broker) so
// that /lock, the broker's locked event and expiry close the owned browser through the same registry the batch uses.
// B7 runs the REAL key broker (windows/key-broker.ps1 -Role owner: job object only, no key, no provider) and kills it,
// then kills a collector-like child that owns a browser through it. Nothing here touches the machine TPM, the real
// vault, retained real profiles or any network: the pages stay on about:blank.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brokerEnv, clearLocked, freePort, removeOwnedTemp, sleep, startFakeOmf, triggerLocked, waitFor } from './fake-broker.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR = path.resolve(here, '..');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function powershell(script) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
export async function commandLineOf(pid) { return powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`); }
export async function listeningPorts(pid) { const text = await powershell(`@(Get-NetTCPConnection -OwningProcess ${Number(pid)} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalPort }) -join ','`); return text ? text.split(',').map(Number) : []; }
export async function integrityOf(pid) {
  return Number(await powershell(`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class OmfPeek {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, uint len, out uint ret);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static int Level(int pid) {
    IntPtr process = OpenProcess(0x1000, false, pid); if (process == IntPtr.Zero) return -1;
    IntPtr token; if (!OpenProcessToken(process, 0x0008, out token)) { CloseHandle(process); return -2; }
    uint size; GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
    IntPtr buffer = Marshal.AllocHGlobal((int)size);
    try { if (!GetTokenInformation(token, 25, buffer, size, out size)) return -3; IntPtr sid = Marshal.ReadIntPtr(buffer); int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid)); return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1))); }
    finally { Marshal.FreeHGlobal(buffer); CloseHandle(token); CloseHandle(process); }
  }
}
'@
[OmfPeek]::Level(${Number(pid)})`));
}
const FORBIDDEN = ['--no-sandbox', '--disable-web-security', '--remote-debugging-port'];

/** @returns {Promise<{ ok: boolean, legs: { name: string, ok: boolean, message: string, ms: number }[], ms: number, chrome: string|null }>} */
export async function runBrowserBoundaryLegs({ tmpdir = os.tmpdir() } = {}) {
  const started = Date.now();
  /** @type {{ name: string, ok: boolean, message: string, ms: number }[]} */ const legs = [];
  const leg = async (name, fn) => {
    const t = Date.now();
    try { const message = await fn(); legs.push({ name, ok: true, message: String(message ?? 'ok'), ms: Date.now() - t }); }
    catch (error) { legs.push({ name, ok: false, message: String(error && error.message || error).slice(0, 700), ms: Date.now() - t }); }
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const D = await mkdtemp(path.join(tmpdir, 'omf-browser-boundary-'));
  const B = await mkdtemp(path.join(tmpdir, 'omf-boundary-broker-'));
  const U = await mkdtemp(path.join(tmpdir, 'omf-unrelated-chrome-'));
  const omf = await startFakeOmf();
  const port = await freePort();
  process.env.OMF_COLLECTOR_DIR = D; process.env.OMF_COLLECTOR_PORT = String(port); process.env.OMF_COLLECTOR_TICK_MS = '1000'; process.env.OMF_COLLECTOR_BATCH_MS = '8000';
  Object.assign(process.env, brokerEnv(B));
  const browserModule = await import(pathToFileURL(path.join(COLLECTOR, 'browser.mjs')).href);
  const { browserFor, closeOwnedBrowsers, ephemeralProfile, ephemeralRoot, findChrome, ownedBrowsers } = browserModule;
  const chrome = findChrome();
  /** @type {Awaited<ReturnType<typeof import('../index.mjs').startCollector>>|null} */ let collector = null;
  let unrelated = null, leftover = null, b7Browser = null;
  /** @type {import('node:child_process').ChildProcess|null} */ let b7Child = null;
  /** @type {Awaited<ReturnType<typeof import('../vault.mjs').startBroker>>|null} */ let b7Broker = null;
  const sentinel = path.join(D, 'profiles', '12345', 'sentinel.txt');
  const client = { origin: `http://127.0.0.1:${port}`, key: '' };
  const request = async (route, body) => {
    const response = await fetch(client.origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Key': client.key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
    const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, data, text };
  };
  const status = async () => (await request('/status')).data || {};
  const gone = (pid, ms) => waitFor(async () => !alive(pid) ? true : null, ms, 200);
  const removed = (dir, ms) => waitFor(async () => !existsSync(dir) ? true : null, ms, 200);
  try {
    check(chrome, `Chrome not found in its standard locations; the boundary legs cannot run`);
    await mkdir(path.dirname(sentinel), { recursive: true });
    await writeFile(sentinel, 'retained profile sentinel');

    await leg('B5 setup: a leftover Chrome on an ephemeral profile and an unrelated Chrome exist before the collector starts', async () => {
      const puppeteer = (await import('rebrowser-puppeteer-core')).default;
      await mkdir(ephemeralRoot(D), { recursive: true });
      leftover = await puppeteer.launch({ executablePath: chrome, pipe: true, headless: true, userDataDir: path.join(ephemeralRoot(D), 'left-amex-x-1'), args: ['--no-first-run'] });
      unrelated = await puppeteer.launch({ executablePath: chrome, pipe: true, headless: true, userDataDir: U, args: ['--no-first-run'] });
      check(alive(leftover.process().pid) && alive(unrelated.process().pid), 'the two Chrome processes did not start');
      return `leftover pid ${leftover.process().pid} on profiles/ephemeral/left-amex-x-1, unrelated pid ${unrelated.process().pid}`;
    });

    await leg('B5 startup recovery ends only the leftover (exact identity) and removes its folder; retained profile untouched', async () => {
      const indexModule = await import(pathToFileURL(path.join(COLLECTOR, 'index.mjs')).href);
      collector = await indexModule.startCollector();
      client.key = (await readFile(path.join(D, 'setup-link.txt'), 'utf8')).trim().split('#')[1];
      const ready = await waitFor(async () => (await status()).startupDone === true ? true : null, 60000, 250);
      check(ready, 'startup did not finish');
      const leftoverPid = leftover.process().pid;
      check(await gone(leftoverPid, 10000), `leftover Chrome ${leftoverPid} still alive`);
      check(!existsSync(path.join(ephemeralRoot(D), 'left-amex-x-1')), 'leftover profile folder still exists');
      check(alive(unrelated.process().pid), 'the unrelated Chrome was ended');
      check((await readFile(sentinel, 'utf8')) === 'retained profile sentinel', 'retained profile changed');
      const s = await status();
      check(s.chromeFound === true && s.elevated === false && s.aclProtected === true, `status ${JSON.stringify({ chromeFound: s.chromeFound, elevated: s.elevated, aclProtected: s.aclProtected })}`);
      return `leftover ended and folder removed; unrelated ${unrelated.process().pid} alive; sentinel intact`;
    });

    let b1Pid = null, b1Profile = null;
    await leg('B1 owned launch: no --no-sandbox / --disable-web-security / --remote-debugging-port, pipe transport, no listener, medium integrity', async () => {
      b1Profile = ephemeralProfile(D, 'owner', 'amex', 'account', 'b1');
      const browser = await browserFor(b1Profile, { ephemeral: true, root: D, headless: true });
      b1Pid = browser.process().pid;
      const page = await browser.newPage(); await page.goto('about:blank');
      const command = await commandLineOf(b1Pid);
      for (const flag of FORBIDDEN) check(!command.includes(flag), `${flag} present: ${command.slice(0, 300)}`);
      check(command.includes('--remote-debugging-pipe'), `pipe transport missing: ${command.slice(0, 300)}`);
      check(command.toLowerCase().includes(`--user-data-dir=${b1Profile}`.toLowerCase()) || command.toLowerCase().includes(`--user-data-dir="${b1Profile}"`.toLowerCase()), `profile not on the command line: ${command.slice(0, 300)}`);
      check(browser.wsEndpoint() === '', `a WebSocket endpoint exists: ${browser.wsEndpoint()}`);
      const ports = await listeningPorts(b1Pid);
      check(ports.length === 0, `Chrome ${b1Pid} listens on ${ports.join(',')}`);
      const level = await integrityOf(b1Pid);
      check(level === 8192, `integrity level ${level} (expected 8192 Medium)`);
      check(ownedBrowsers().some(e => e.pid === b1Pid && e.ephemeral), 'the launch is not in the owned registry');
      const automation = command.includes('--enable-automation');
      return `pid ${b1Pid}: forbidden flags absent, --remote-debugging-pipe, no listener, integrity 8192${automation ? ' (puppeteer default --enable-automation present)' : ''}`;
    });

    await leg('B1 never attach: a second process refuses the profile a Chrome is already using', async () => {
      check(b1Pid && alive(b1Pid), 'B1 browser not running');
      const code = `import(${JSON.stringify(pathToFileURL(path.join(COLLECTOR, 'browser.mjs')).href)}).then(m => m.browserFor(process.argv[1], { headless: true })).then(() => { console.log('LAUNCHED'); process.exit(3); }, e => { console.log('REFUSED:' + e.message); process.exit(0); });`;
      const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', code, '--', b1Profile], { windowsHide: true, timeout: 60000 }).catch(error => error);
      const out = String(result.stdout || '');
      check(result.code === undefined || result.code === 0, `second process exit ${result.code}: ${out.slice(0, 200)}`);
      check(out.includes('REFUSED:') && /never attaches/.test(out), `unexpected: ${out.slice(0, 200)}`);
      check(alive(b1Pid), 'the first browser died');
      return out.trim().slice(0, 160);
    });

    await leg('B2 /lock closes every owned browser within 5 s and deletes the ephemeral profile', async () => {
      check(b1Pid && alive(b1Pid), 'B1 browser not running');
      // Browser ownership has the same owner broker in both modes; no bank key is needed for this boundary test.
      check((await request('/mode', {mode:'manual'})).status === 200, '/mode failed');
      check((await request('/batch/start', {})).status === 200, '/batch/start failed');
      check((await request('/lock', {})).status === 200, '/lock failed');
      check(await gone(b1Pid, 5000), `pid ${b1Pid} still alive 5 s after /lock`);
      check(await removed(b1Profile, 8000), 'ephemeral profile still exists after /lock');
      check(ownedBrowsers().length === 0, `registry still holds ${JSON.stringify(ownedBrowsers())}`);
      check((await status()).unlocked === false, 'status still unlocked');
      return `pid ${b1Pid} gone, ${path.basename(b1Profile)} removed`;
    });

    await leg("B3 the broker's locked event (Windows lock/suspend) closes the owned browser", async () => {
      check((await request('/resume', {})).status === 200, '/resume failed');
      check((await request('/batch/start', {})).status === 200, '/batch/start failed');
      const profile = ephemeralProfile(D, 'owner', 'amex', 'account', 'b3');
      const browser = await browserFor(profile, { ephemeral: true, root: D, headless: true });
      const pid = browser.process().pid;
      await triggerLocked(B);
      try {
        check(await gone(pid, 8000), `pid ${pid} still alive after the locked event`);
        check(await removed(profile, 8000), 'ephemeral profile still exists');
        check(await waitFor(async () => (await status()).unlocked === false ? true : null, 5000, 200), 'status still unlocked');
      } finally { await clearLocked(B); }
      return `pid ${pid} gone, ${path.basename(profile)} removed, session ended`;
    });

    await leg('B4 expiry closes the owned browser', async () => {
      check((await request('/batch/start', {})).status === 200, '/batch/start failed');
      const profile = ephemeralProfile(D, 'owner', 'amex', 'account', 'b4');
      const browser = await browserFor(profile, { ephemeral: true, root: D, headless: true });
      const pid = browser.process().pid;
      check(await gone(pid, 20000), `pid ${pid} still alive after the 8 s batch expired`);
      check(await removed(profile, 8000), 'ephemeral profile still exists');
      check((await status()).unlocked === false, 'status still unlocked');
      return `pid ${pid} gone after expiry, ${path.basename(profile)} removed`;
    });

    await leg('B7 the real broker owns the browser: killing the broker ends the browser, the unrelated Chrome survives', async () => {
      const { startBroker } = await import(pathToFileURL(path.join(COLLECTOR, 'vault.mjs')).href);
      b7Broker = await startBroker('owner', { env: { ...process.env, OMF_KEY_BROKER: '' } });
      check(b7Broker.readyState && b7Broker.readyState.job === true, `the broker reported no job object: ${JSON.stringify(b7Broker.readyState)}`);
      const profile = ephemeralProfile(D, 'owner', 'amex', 'account', 'b7');
      b7Browser = await browserFor(profile, { ephemeral: true, root: D, headless: true });
      const pid = b7Browser.process().pid;
      const reply = await b7Broker.request('own', { pid }, 30000);
      check(reply.ok === true && reply.owned === true && Array.isArray(reply.assigned) && reply.assigned.includes(pid), `own reply ${JSON.stringify(reply)}`);
      const onProfile = () => powershell(`@(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' }).Count`);
      const before = await onProfile();
      b7Broker.child.kill();
      check(await gone(pid, 8000), `pid ${pid} still alive after the broker was killed`);
      check(await waitFor(async () => (await onProfile()) === '0' ? true : null, 10000, 500), `Chrome processes remain on the profile: ${await onProfile()}`);
      check(alive(unrelated.process().pid), 'the unrelated Chrome was ended');
      await closeOwnedBrowsers().catch(() => {});
      b7Browser = null;
      return `pid ${pid} owned and ended with the broker (assigned ${JSON.stringify(reply.assigned)}, refused ${JSON.stringify(reply.failed)}); all ${before} Chrome processes of the profile gone; unrelated ${unrelated.process().pid} alive`;
    });

    await leg('B7 a collector-like process dying ends its broker and the owned browser', async () => {
      const script = `
        const [vaultUrl, browserUrl, root] = process.argv.slice(1);
        const { startBroker } = await import(vaultUrl); const { browserFor, ephemeralProfile } = await import(browserUrl);
        const broker = await startBroker('owner', { env: { ...process.env, OMF_KEY_BROKER: '' } });
        const browser = await browserFor(ephemeralProfile(root, 'owner', 'amex', 'account', 'b7child'), { ephemeral: true, root, headless: true, onLaunch: async ({ pid }) => { const r = await broker.request('own', { pid }, 30000); if (!r.ok) throw new Error('own failed ' + JSON.stringify(r)); } });
        console.log(JSON.stringify({ pid: browser.process().pid, broker: broker.child.pid }));
        setInterval(() => {}, 1000);`;
      b7Child = spawn(process.execPath, ['--input-type=module', '-e', script, '--', pathToFileURL(path.join(COLLECTOR, 'vault.mjs')).href, pathToFileURL(path.join(COLLECTOR, 'browser.mjs')).href, D], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = '';
      b7Child.stdout.on('data', d => { output += d; }); b7Child.stderr.on('data', d => { errors += d; });
      const line = await waitFor(async () => { const m = output.match(/\{"pid":\d+,"broker":\d+\}/); return m ? m[0] : null; }, 60000, 200);
      check(line, `the child did not report its browser: ${(errors || output).slice(0, 300)}`);
      const { pid, broker } = JSON.parse(line);
      check(alive(pid) && alive(broker), 'child browser or broker not alive');
      b7Child.kill();
      check(await gone(broker, 8000), `broker ${broker} still alive after the child died`);
      check(await gone(pid, 8000), `pid ${pid} still alive after the child and its broker died`);
      check(alive(unrelated.process().pid), 'the unrelated Chrome was ended');
      return `child killed → broker ${broker} gone → browser ${pid} gone; unrelated alive`;
    });

    await leg('B6 the retained profile sentinel survived every leg', async () => {
      check((await readFile(sentinel, 'utf8')) === 'retained profile sentinel', 'retained profile changed');
      return 'profiles/12345/sentinel.txt intact';
    });
  } catch (error) {
    legs.push({ name: 'setup', ok: false, message: String(error && error.message || error).slice(0, 700), ms: 0 });
  } finally {
    if (b7Child && b7Child.exitCode === null) b7Child.kill();
    if (b7Broker) await b7Broker.end().catch(() => {});
    try { await closeOwnedBrowsers(); } catch { /* best effort */ }
    for (const browser of [leftover, unrelated]) if (browser) { try { await Promise.race([browser.close(), sleep(5000)]); } catch { /* gone */ } try { const child = browser.process(); if (child && child.exitCode === null) child.kill(); } catch { /* gone */ } }
    if (collector) await collector.close().catch(() => {});
    await omf.close().catch(() => {});
    await sleep(500);
    for (const dir of [D, B, U]) await removeOwnedTemp(dir, { tmpdir }).catch(() => {});
  }
  return { ok: legs.length > 0 && legs.every(l => l.ok), legs, ms: Date.now() - started, chrome };
}

// Under `node --test` (npm test --prefix collector) the legs run only with OMF_TEST_LEGS=1 (they take ~2 minutes and
// launch Chrome); the hub verifier runs them through scripts/zoomer-fixtures/collector-browser-boundary.mjs.
if (process.env.NODE_TEST_CONTEXT) {
  const { default: test } = await import('node:test');
  test('browser boundary: owned sandboxed Chrome, never attach, closure on lock/locked/expiry, broker ownership, crash recovery', { skip: process.platform !== 'win32' ? 'Windows only' : process.env.OMF_TEST_LEGS !== '1' ? 'set OMF_TEST_LEGS=1 (the verifier fixture collector-browser-boundary runs these legs)' : false, timeout: 600000 }, async () => {
    const result = await runBrowserBoundaryLegs();
    const failed = result.legs.filter(l => !l.ok).map(l => `${l.name}: ${l.message}`);
    if (failed.length) throw new Error(failed.join('\n'));
  });
}

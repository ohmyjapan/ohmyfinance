import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const normalized = profile => path.resolve(profile).replaceAll('\\', '/').toLowerCase();
const filename = profile => path.join(profile, '.omf-collector-browser.json');

function socketEndpoint(endpoint, port) {
  const url = new URL(endpoint);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== String(port) || url.username || url.password || url.search || url.hash || !/^\/devtools\/browser\/[a-f\d-]{36}$/.test(url.pathname)) throw new Error('Saved Amex browser endpoint is invalid');
  return endpoint;
}

export function validateEndpoint(record, profile) {
  if (record.profile !== normalized(profile) || !Number.isSafeInteger(record.pid) || record.pid < 1 || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535) throw new Error('Saved Amex browser identity is invalid');
  socketEndpoint(record.endpoint, record.port);
  return record;
}

export async function endpointAt(port, request = fetch) {
  const response = await request(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Amex Chrome debugging endpoint is unavailable');
  const data = await response.json();
  if (!/^Chrome\//.test(data.Browser || '')) throw new Error('The saved endpoint is not Google Chrome');
  return socketEndpoint(data.webSocketDebuggerUrl, port);
}

export async function rememberEndpoint(profile, processInfo, endpoint) {
  const record = validateEndpoint({ profile: normalized(profile), pid: processInfo.pid, port: processInfo.port, endpoint }, profile);
  await writeFile(filename(profile) + '.new', JSON.stringify(record), { mode: 0o600 });
  await rename(filename(profile) + '.new', filename(profile));
}

export async function cachedEndpoint(profile, chromePids, request = fetch) {
  let record;
  try { record = validateEndpoint(JSON.parse(await readFile(filename(profile), 'utf8')), profile); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  // Closed browsers can be launched normally. A live browser must retain its exact identity.
  if (!chromePids.includes(record.pid)) return null;
  try {
    if (await endpointAt(record.port, request) !== record.endpoint) throw new Error('identity changed');
  } catch { throw new Error('The saved Amex Chrome session cannot be verified; check that account window before retrying'); }
  return record.endpoint;
}

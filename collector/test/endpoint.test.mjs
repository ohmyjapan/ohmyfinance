import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cachedEndpoint, endpointAt, rememberEndpoint, validateEndpoint } from '../endpoint.mjs';

test('an exact profile identity survives hidden process details and rejects stale or substituted browser endpoints', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'omf-endpoint-test-'));
  const endpoint = 'ws://127.0.0.1:54321/devtools/browser/12345678-1234-1234-1234-123456789abc';
  const response = value => async () => ({ ok: true, json: async () => ({ Browser: 'Chrome/140.0.0.0', webSocketDebuggerUrl: value }) });
  try {
    assert.equal(await cachedEndpoint(profile, [42]), null);
    await rememberEndpoint(profile, { pid: 42, port: 54321 }, endpoint);
    assert.equal(await cachedEndpoint(profile, [42], response(endpoint)), endpoint);
    assert.equal(await cachedEndpoint(profile, [], () => { throw new Error('Should not query a dead process'); }), null);
    await assert.rejects(cachedEndpoint(profile, [42], response(endpoint.replace('789abc', '789def'))), /cannot be verified/);
    await assert.rejects(cachedEndpoint(profile, [42], async () => { throw new Error('offline'); }), /cannot be verified/);
    const file = path.join(profile, '.omf-collector-browser.json'), record = JSON.parse(await readFile(file, 'utf8'));
    assert.throws(() => validateEndpoint(record, profile + '-other'), /identity/);
    assert.throws(() => validateEndpoint({ ...record, endpoint: endpoint.replace('127.0.0.1', 'example.invalid') }, profile), /endpoint/);
    assert.throws(() => validateEndpoint({ ...record, port: 12345 }, profile), /endpoint/);
    await assert.rejects(endpointAt(54321, response(endpoint.replace('127.0.0.1', 'example.invalid'))), /endpoint/);
    await writeFile(file, '{');
    await assert.rejects(cachedEndpoint(profile, [42]), SyntaxError);
  } finally {
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(profile, { recursive: true, force: true });
  }
});

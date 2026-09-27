const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const h3 = require('h3');
const vue = require('vue');
const root = path.resolve(__dirname, '..');
const aliases = ['credit-card', 'credit_card', 'payment-gateway', 'payment_gateway', 'overseas', 'overseas_market'];
const unavailable = error => h3.isError(error) && error.statusCode === 501 && error.statusMessage === 'Provider integration not implemented';

function load(file, imports, effects, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', 'setTimeout', 'fetch', ...Object.keys(globals), source)(name => {
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
    return imports[name];
  }, module, module.exports, {
    log: (...args) => effects.logs.push(args), error: (...args) => effects.logs.push(args)
  }, callback => callback(), async () => { effects.network++; throw Error('Unexpected network request'); }, ...Object.values(globals));
  return module.exports;
}
function setup() {
  const effects = { writes: [], logs: [], network: 0 };
  const service = load('server/services/proxyService.ts', {
    h3, crypto: { randomUUID: () => 'synthetic-id' },
    './transactionService': { createTransaction: async data => effects.writes.push(data) }
  }, effects);
  return { service, effects };
}

test('unsupported provider aliases reject without fabricated approvals, ledger writes or payload logs', async () => {
  const { service, effects } = setup();
  const outcomes = await Promise.allSettled(aliases.flatMap(source => [false, true].map(createTransaction =>
    service.proxyRequest(source, { amount: 67000, cardNumber: 'synthetic-private-input', createTransaction }))));
  assert.deepEqual(effects.writes, [], 'Unsupported providers must never write a transaction');
  assert.deepEqual(effects.logs, [], 'Payment request bodies must not be logged');
  assert.equal(effects.network, 0);
  assert(outcomes.every(result => result.status === 'rejected' && unavailable(result.reason)), 'Every unsupported provider must return 501');
});

test('direct provider exports and malformed bodies also return a stable unavailable response', async () => {
  const { service, effects } = setup();
  for (const name of ['proxyToCreditCardAPI', 'proxyToPaymentGatewayAPI', 'proxyToOverseasAPI']) {
    for (const body of [null, undefined, {}, { createTransaction: true }]) {
      await assert.rejects(service[name](body), unavailable);
    }
  }
  assert.deepEqual(effects, { writes: [], logs: [], network: 0 });
});

test('API proxy retains authentication and unknown-source responses before provider dispatch', async () => {
  const { service, effects } = setup(); let reads = 0;
  const handler = load('server/api/proxy/[source].ts', {
    h3: { ...h3, defineEventHandler: handler => handler, readBody: async () => { reads++; return { createTransaction: true }; } },
    '../../services/proxyService': service,
    '../../middleware/auth': { requireAuth: event => { if (!event.context.auth) throw h3.createError({ statusCode: 401 }); return event.context.auth; } }
  }, effects).default;
  const event = (source, authenticated = true) => ({ context: { params: { source }, ...(authenticated ? { auth: { userId: 'synthetic-owner' } } : {}) } });
  await assert.rejects(handler(event('credit-card', false)), error => error.statusCode === 401);
  await assert.rejects(handler(event('unknown')), error => error.statusCode === 400);
  assert.equal(reads, 0);
  for (const source of aliases) await assert.rejects(handler(event(source)), unavailable);
  assert.deepEqual(effects.writes, []);
});

function middleware() {
  const effects = { writes: [], logs: [], network: 0 };
  const handler = load('server/middleware/proxy.ts', {
    h3: { ...h3, defineEventHandler: handler => handler,
      getQuery: () => ({}), getRequestHeaders: () => ({ authorization: 'synthetic-token', cookie: 'synthetic-cookie' }),
      proxyRequest: async () => { effects.network++; return { success: true }; }
    }
  }, effects).default;
  return { handler, effects };
}

test('raw proxy routes reject before forwarding any request or credentials', async () => {
  const { handler, effects } = middleware();
  const outcomes = await Promise.allSettled(['payment-gateway', 'credit-card', 'shipping'].flatMap(service =>
    ['GET', 'POST', 'DELETE'].map(async method => handler({ method, path: `/proxy/${service}/charge?request=synthetic`, node: { req: {} } }))));
  assert.equal(effects.network, 0, 'Placeholder middleware must not forward requests');
  assert.deepEqual(effects.logs, []);
  assert(outcomes.every(result => result.status === 'rejected' && unavailable(result.reason)), 'Raw proxy must return 501');
});

test('raw proxy preserves unknown-service errors and leaves unrelated routes alone', async () => {
  const { handler, effects } = middleware();
  for (const url of ['/api/finance/entries', '/api/proxy/credit-card', '/transactions', '/proxy-other']) {
    assert.equal(await handler({ path: url, node: { req: {} } }), undefined);
  }
  await assert.rejects(async () => handler({ path: '/proxy/unknown/path', node: { req: {} } }), error => error.statusCode === 400);
  // Query parameters do not become part of the service name.
  await assert.rejects(async () => handler({ node: { req: { url: '/proxy/credit-card?x=synthetic' } } }), unavailable);
  assert.equal(effects.network, 0);
});

test('proxy client surfaces AsyncData failures and clears stale success across every wrapper', async () => {
  const failure = h3.createError({ statusCode: 501, statusMessage: 'Provider integration not implemented' });
  const effects = { writes: [], logs: [], network: 0 };
  const { useProxy } = load('composables/useProxy.ts', { vue }, effects, {
    useFetch: async () => ({ data: vue.ref(null), error: vue.ref(failure) })
  });
  for (const method of ['proxyCreditCardRequest', 'proxyPaymentGatewayRequest', 'proxyOverseasRequest', 'processCreditCardTransaction', 'processPaymentGatewayTransaction', 'processOverseasTransaction']) {
    const client = useProxy(); client.lastResponse.value = { success: true };
    await assert.rejects(client[method]({ amount: 67000 }), error => error === failure);
    assert.equal(client.error.value, failure.message); assert.equal(client.lastResponse.value, null);
    assert.equal(client.isLoading.value, false);
  }
});

test('proxy client retains valid response behavior and releases loading state after thrown failures', async () => {
  const effects = { writes: [], logs: [], network: 0 }; let fail = false;
  const { useProxy } = load('composables/useProxy.ts', { vue }, effects, {
    useFetch: async (url, options) => {
      assert.equal(url, '/api/proxy/credit-card'); assert.equal(options.method, 'POST');
      if (fail) throw null;
      return { data: vue.ref({ synthetic: true }), error: vue.ref(null) };
    }
  });
  const client = useProxy();
  assert.deepEqual(await client.proxyCreditCardRequest({}), { synthetic: true });
  assert.equal(client.error.value, null); assert.equal(client.isLoading.value, false);
  fail = true;
  await assert.rejects(client.proxyCreditCardRequest({}), value => value === null);
  assert.equal(client.error.value, 'Failed to proxy request to credit-card');
  assert.equal(client.lastResponse.value, null); assert.equal(client.isLoading.value, false);
});

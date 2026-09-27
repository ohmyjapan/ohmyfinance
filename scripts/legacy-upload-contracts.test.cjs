const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const h3 = require('h3');
const root = path.resolve(__dirname, '..');

function load(file, imports, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', ...Object.keys(globals), compiled)(name => {
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
    return imports[name];
  }, module, module.exports, { error() {}, warn() {} }, ...Object.values(globals));
  return module.exports;
}

function apiClient(fetch) {
  return load('plugins/api.ts', {
    'nuxt/app': { defineNuxtPlugin: plugin => plugin },
    '~/stores/user': { useUserStore: () => ({ isAuthenticated: false }) }
  }, { fetch }).default.setup({}).provide.api;
}

test('API failures preserve server status and ordinary network messages', async () => {
  const server = apiClient(async () => ({ ok: false, status: 422, json: async () => ({ message: 'Synthetic validation error' }) }));
  await assert.rejects(server.get('/synthetic'), error => error.name === 'ApiError' && error.status === 422 && error.message === 'Synthetic validation error');
  const network = apiClient(async () => { throw new Error('Synthetic offline failure'); });
  await assert.rejects(network.get('/synthetic'), error => error.name === 'ApiError' && error.status === 0 && error.message === 'Synthetic offline failure');
});

test('non-Error API failures retain the intended fallback instead of crashing the catch block', async () => {
  for (const value of [null, undefined, 'Synthetic rejection']) {
    const client = apiClient(async () => { throw value; });
    await assert.rejects(client.get('/synthetic'), error => error.name === 'ApiError' && error.status === 0 && error.message === 'An unexpected error occurred');
  }
});

function uploadMiddleware(readMultipartFormData) {
  return load('server/middleware/file-upload.ts', {
    h3: { ...h3, defineEventHandler: handler => handler, readMultipartFormData },
    'fs/promises': { mkdir: async () => { throw Error('Unexpected filesystem write'); }, writeFile: async () => { throw Error('Unexpected filesystem write'); } },
    path: require('node:path'),
    '../../utils/excel-processor': { processExcelFile: async () => { throw Error('Unexpected spreadsheet processing'); } }
  }).default;
}
const uploadEvent = { method: 'POST', path: '/api/upload/receipt', node: { req: {} } };

test('upload middleware preserves validation errors and skips unrelated requests', async () => {
  const handler = uploadMiddleware(async () => []);
  await assert.rejects(handler(uploadEvent), error => h3.isError(error) && error.statusCode === 400 && error.statusMessage === 'No files were uploaded');
  const skip = uploadMiddleware(async () => { throw Error('Must not parse an unrelated route'); });
  assert.equal(await skip({ ...uploadEvent, path: '/api/receipts' }), undefined);
  assert.equal(await skip({ ...uploadEvent, method: 'GET' }), undefined);
});

test('upload parsing failures return a stable server error even for null rejections', async () => {
  for (const value of [null, undefined, new Error('Synthetic parser failure')]) {
    const handler = uploadMiddleware(async () => { throw value; });
    await assert.rejects(handler(uploadEvent), error => h3.isError(error) && error.statusCode === 500 && error.statusMessage === 'File upload failed');
  }
});

test('file upload client rejects failed requests and releases its busy state', async () => {
  class SyntheticXHR {
    upload = { addEventListener() {} };
    status = 500;
    responseText = '{}';
    open(method, endpoint) { assert.equal(method, 'POST'); assert.equal(endpoint, '/synthetic'); }
    send(body) { assert(body instanceof FormData); queueMicrotask(() => this.onload()); }
  }
  const { useFileUpload } = load('composables/useFileUpload.ts', { vue: require('vue') }, { XMLHttpRequest: SyntheticXHR });
  const uploader = useFileUpload();
  uploader.selectedFiles.value = [new File(['synthetic'], 'synthetic.csv', { type: 'text/csv' })];
  await assert.rejects(uploader.uploadFiles('/synthetic'), /Upload failed/);
  assert.equal(uploader.error.value, 'Upload failed');
  assert.equal(uploader.isUploading.value, false);
});

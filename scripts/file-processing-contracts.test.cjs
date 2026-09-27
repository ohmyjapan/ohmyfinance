const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const h3 = require('h3');
const root = path.resolve(__dirname, '..');
const dataModule = source => 'data:text/javascript,' + encodeURIComponent(source);

test('CSV processing uses the actual ESM parser and retains parsed values and source metadata', async () => {
  const csv = 'Shop,Amount,Active,Note\r\n"東京, 店",1200,true,"first\nsecond"\r\nOther,0,false,"said ""yes"""\r\n';
  const source = fs.readFileSync(root + '/server/services/fileUploadService.ts', 'utf8');
  let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fakeFs = dataModule(`export default {
    existsSync: () => true,
    mkdir: (...args) => args.at(-1)(new Error('Unexpected write')),
    writeFile: (...args) => args.at(-1)(new Error('Unexpected write')),
    readFile: (...args) => args.at(-1)(null, Buffer.from(${JSON.stringify(csv)}))
  }`);
  compiled = compiled.replace(/from ['"]fs['"]/, 'from ' + JSON.stringify(fakeFs));
  compiled = compiled.replace(/from ['"]papaparse['"]/, 'from ' + JSON.stringify(pathToFileURL(require.resolve('papaparse')).href));
  compiled = compiled.replace(/from ['"]\.\.\/utils\/database['"]/, 'from ' + JSON.stringify(dataModule("export const create = () => { throw new Error('Unexpected database write') }")));
  const service = await import(dataModule(compiled));
  const rows = await service.processTransactionFile({ path: 'synthetic.csv', originalName: 'synthetic.csv', mimeType: 'text/csv', id: 'synthetic-file' }, 'synthetic-source');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Shop, '東京, 店'); assert.equal(rows[0].Amount, 1200);
  assert.equal(rows[0].Active, true); assert.equal(rows[0].Note, 'first\nsecond');
  assert.equal(rows[1].Amount, 0); assert.equal(rows[1].Active, false); assert.equal(rows[1].Note, 'said "yes"');
  for (const row of rows) {
    assert.equal(row._sourceFile, 'synthetic-file'); assert.equal(row._sourceType, 'synthetic-source');
    assert.equal(new Date(row._importDate).toISOString(), row._importDate);
  }
});

function route(file, { body, rejection, rejectBody = false, authenticated = true } = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const noWrite = () => { throw Error('Unexpected filesystem operation'); };
  new Function('require', 'module', 'exports', 'console', compiled)(name => {
    if (name === 'h3') return { ...h3, defineEventHandler: handler => handler, readBody: async () => { if (rejectBody) throw rejection; return body; } };
    if (name === 'path') return path;
    if (name === 'fs/promises') return { mkdir: noWrite, readFile: noWrite, appendFile: noWrite, access: noWrite };
    if (name.endsWith('/utils/excel-processor')) return { processExcelFile: noWrite };
    if (name.endsWith('/middleware/auth')) return { requireAuth: () => { if (!authenticated) throw h3.createError({ statusCode: 401, statusMessage: 'Authentication required' }); return { userId: 'synthetic-owner' }; } };
    throw Error('Unexpected dependency: ' + name);
  }, module, module.exports, { error() {}, warn() {} });
  return module.exports.default;
}

test('transaction preview preserves authentication and field-validation errors', async () => {
  const file = 'server/api/transactions/process.ts';
  await assert.rejects(route(file, { authenticated: false })({}), error => error.statusCode === 401);
  await assert.rejects(route(file, { body: {} })({}), error => error.statusCode === 400 && error.statusMessage === 'File path is required');
});

test('transaction preview handles non-Error body parser failures', async () => {
  for (const rejection of [null, undefined, new Error('Synthetic parser failure')]) {
    await assert.rejects(route('server/api/transactions/process.ts', { rejectBody: true, rejection })({}), error => h3.isError(error) && error.statusCode === 500 && error.statusMessage === 'Failed to process transaction file');
  }
});

test('legacy matching error path preserves authentication and validation responses', async () => {
  const file = 'server/api/receipts/match.ts';
  await assert.rejects(route(file, { authenticated: false })({}), error => error.statusCode === 401);
  await assert.rejects(route(file, { body: {} })({}), error => error.statusCode === 400 && error.statusMessage === 'Receipt ID and Transaction ID are required');
});

test('legacy matching error path handles null failures without writing a success log', async () => {
  for (const rejection of [null, undefined, new Error('Synthetic parser failure')]) {
    await assert.rejects(route('server/api/receipts/match.ts', { rejectBody: true, rejection })({}), error => h3.isError(error) && error.statusCode === 500 && error.statusMessage === 'Failed to match receipt with transaction');
  }
});

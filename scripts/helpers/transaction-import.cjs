const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../..');
function load(file, imports, globals = {}) {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.vue')) source = compileScript(parse(source, { filename: file }).descriptor, { id: 'transaction-import-test' }).content;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (!Object.hasOwn(imports, name)) throw Error('Unexpected dependency: ' + name);
    return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports.default;
}
module.exports = ({ entityFetch = async () => ({ newSuppliers: [], newCustomers: [] }) } = {}) => {
  const requests = [], writes = [], scopes = [];
  const user = { authHeader: { Authorization: 'Bearer synthetic-import-fixture' }, initAuth() {} };
  const emptyCatalog = { find: () => ({ lean: async () => [] }), create: async data => ({ ...data, _id: 'synthetic-catalog' }) };
  const importHandler = load('server/api/transactions/import.ts', {
    h3: { defineEventHandler: fn => fn, readBody: async event => event.body, createError: data => Object.assign(Error(data.message || data.statusMessage), data) },
    crypto: require('node:crypto'),
    '../../services/ledgerAccessService': { requireLedgerAccess: async () => ({ userId: 'synthetic-user', organizationId: 'synthetic-company', role: 'owner' }) },
    '../../services/transactionService': { createTransaction: async (access, data) => { writes.push(structuredClone(data)); return { ...data, _id: 'synthetic-' + writes.length }; } },
    '../../config/database': { ensureConnection: async () => {} },
    '../../models/AccountCategory': emptyCatalog, '../../models/TaxCategory': emptyCatalog,
    '../../models/TransactionCategory': emptyCatalog, '../../models/Supplier': emptyCatalog,
    '../../models/Customer': emptyCatalog,
    '../../models/Transaction': { __esModule: true, default: { findOne: async () => null }, activeTransactionFilter: filter => filter }
  });
  const fetch = async (url, options) => {
    const request = { url, ...JSON.parse(JSON.stringify(options)) };
    requests.push(request);
    if (url === '/api/transactions/import-preview') return entityFetch(request);
    if (url === '/api/transactions/import') return importHandler({ method: 'POST', body: request.body });
    throw Error('Unexpected request: ' + url);
  };
  const imports = { vue: { ...vue, onMounted() {} }, 'lucide-vue-next': {}, '~/stores/user': { useUserStore: () => user } };
  const globals = { useI18n: () => ({ t: key => key, locale: vue.ref('ja') }), onMounted() {}, useUserStore: () => user, $fetch: fetch };
  const setup = (file, props, emit = () => {}) => {
    const component = load(file, imports, globals), scope = vue.effectScope(); scopes.push(scope);
    return scope.run(() => component.setup(props, { expose() {}, emit }));
  };
  const page = setup('pages/transactions/upload.vue', {});
  // Follow the real parent template bindings so a disconnected event fails tests.
  const source = fs.readFileSync(path.join(root, 'pages/transactions/upload.vue'), 'utf8');
  const tag = source.match(/<TransactionDataPreview\b([\s\S]*?)\/>/)[1];
  const sourceName = tag.match(/:parsed-data="([^"]+)"/)[1];
  const events = Object.fromEntries([...tag.matchAll(/@([\w-]+)="([^"]+)"/g)].map(match => [match[1], match[2]]));
  const preview = () => setup('components/transaction/TransactionDataPreview.vue', {
    get files() { return page.uploadedFiles.value; }, get mappings() { return page.fieldMappings.value; }, get parsedData() { return page[sourceName].value; }
  }, (event, ...args) => { if (events[event]) page[events[event]](...args); });
  return { page, preview, requests, writes, user, raw: () => page[sourceName].value, close: () => scopes.forEach(scope => scope.stop()) };
};

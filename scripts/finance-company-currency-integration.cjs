// Run only through the owned fixture; no ambient database or provider calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireRoot = Module.createRequire(path.join(root, 'package.json'));

async function main() {
  assert.equal(process.env.OMF_CURRENCY_FIXTURE, 'owned', 'currency:owned-fixture-required');
  const { MongoMemoryServer } = requireRoot('mongodb-memory-server');
  const mongoose = requireRoot('mongoose');
  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'omf_currency_owned' } });
  try {
    process.env.MONGO_URI = mongo.getUri('omf_currency_owned');
    assert.match(process.env.MONGO_URI, /127\.0\.0\.1:\d+\/omf_currency_owned/);
    const { outputFiles } = await requireRoot('esbuild').build({
      stdin: { contents: "export { getCompanyNaviTransaction, transactionNaviView } from './server/services/companyTransactionAssistantService.ts'; export { insertCompanyPosting } from './server/services/financeCompanyPostingService.ts'; export { parseAmex, HEADERS } from './shared/amex.mjs';", resolveDir: root, sourcefile: 'owned-currency-entry.ts' },
      bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent'
    });
    const native = new Module(path.join(root, 'scripts', 'owned-currency-entry.cjs'), module);
    native.filename = path.join(root, 'scripts', 'owned-currency-entry.cjs');
    native.paths = Module._nodeModulePaths(path.join(root, 'scripts'));
    native._compile(outputFiles[0].text, native.filename);
    const { parseAmex, HEADERS, insertCompanyPosting, getCompanyNaviTransaction, transactionNaviView } = native.exports;
    const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
    const csv = Buffer.from([HEADERS, ['2026/09/22', '2026/09/23', 'SYNTHETIC CURRENCY PURCHASE', 'SYNTHETIC', '-12345', '15050', '100.00 USD', '150.50']].map(row => row.map(csvCell).join(',')).join('\r\n'));
    const source = parseAmex(csv, ['12345']).rows[0];
    assert.equal(source.currency, 'JPY');
    await mongoose.connect(process.env.MONGO_URI);
    assert.equal(mongoose.connection.name, 'omf_currency_owned');
    const organizationId = new mongoose.Types.ObjectId();
    const entry = { _id: new mongoose.Types.ObjectId(), transactionId: new mongoose.Types.ObjectId() };
    // Invoke the real company-posting atomic writer with actual parser values.
    // This checks the writer/read seam, not the upstream approval/commit workflow.
    await insertCompanyPosting(entry, {
      date: new Date(source.purchaseDate), amount: source.amount, type: '\u652f\u51fa', status: 'completed',
      paymentMethod: '\u30af\u30ec\u30b8\u30c3\u30c8\u30ab\u30fc\u30c9', cardNumber: '2345',
      metadata: { financeEntryId: String(entry._id), currency: source.currency, foreignAmount: source.foreignAmount, exchangeRate: source.exchangeRate, secret: 'PRIVATE_METADATA_MUST_STAY_HIDDEN' }
    }, organizationId);
    const value = await getCompanyNaviTransaction(organizationId, String(entry.transactionId));
    assert.equal(value.currency, 'JPY', 'currency:actual-posting-source-currency');
    assert.equal(value.currencyEvidence, 'saved_card_source', 'currency:source-provenance');
    assert.equal(value.foreignAmount, '100.00 USD', 'currency:literal-foreign-amount');
    assert.equal(value.exchangeRate, '150.50', 'currency:literal-exchange-rate');
    assert.ok(!JSON.stringify(value).includes('PRIVATE_METADATA'), 'currency:private-metadata-not-exposed');
    assert.equal(value.metadata, undefined);
    assert.equal(value.amount, 15050);
    const missing = transactionNaviView({ _id: new mongoose.Types.ObjectId(), amount: 1 });
    assert.equal(missing.currency, null, 'currency:no-inferred-yen');
    assert.equal(missing.currencyEvidence, 'not_recorded');
    assert.equal(missing.foreignAmount, null);
    assert.equal(missing.exchangeRate, null);
    const zero = transactionNaviView({ _id: new mongoose.Types.ObjectId(), metadata: { currency: 'JPY', foreignAmount: 0, exchangeRate: 0 } });
    assert.equal(zero.foreignAmount, 0, 'currency:preserve-zero');
    assert.equal(zero.exchangeRate, 0);
    console.log('PASS owned actual parser/company-posting writer/scoped currency read; missing/zero/privacy controls');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

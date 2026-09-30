// Real installed Chrome, built OMF, actual file parser and temporary MongoDB.
// All accounts, files and transactions in this acceptance run are synthetic.
const assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), net = require('node:net'), https = require('node:https');
const crypto = require('node:crypto'), { spawn, execFileSync } = require('node:child_process');
const { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..'), profile = 'ohmyfinance-import-preview-test';
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-import-browser-evidence-'));
const sourceFiles = ['pages/transactions/upload.vue', 'components/transaction/TransactionDataPreview.vue', 'components/transaction/TransactionFileUpload.vue', 'components/transaction/FieldMapping.vue', 'components/transaction/ImportConfirmation.vue', 'components/transaction/ImportResults.vue', 'server/api/transactions/import.ts', 'server/api/transactions/import-preview.ts', 'server/api/excel-processor.js', 'scripts/verify-transaction-import-browser.cjs'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ja = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/ja.json'), 'utf8'));
const t = key => key.split('.').reduce((value, part) => value[part], ja);
function hub(route, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({ hostname: 'localhost', port: 6060, path: route, method: bytes ? 'POST' : 'GET', rejectUnauthorized: false, timeout: 30000, headers: bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {} }, res => {
      let text = ''; res.on('data', value => text += value); res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(Error('Browser hub returned ' + res.statusCode));
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('Browser hub timed out'))); req.end(bytes);
  });
}
async function availablePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
(async () => {
  const sourceHashes = hashes(), checks = [], consoleErrors = [], importRequests = [], entityRequests = [];
  let mongo, client, child, directory, session, browser, page, logs = '';
  const pass = message => { checks.push(message); console.log('PASS ' + message); };
  console.log('Evidence: ' + outputDir);
  try {
    assert(fs.existsSync(path.join(root, '.output/server/index.mjs')), 'Build OMF first');
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-import-browser-data-'));
    const binary = path.join(root, 'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
    mongo = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined });
    const uri = mongo.getUri('transaction_import_browser'), port = await availablePort(), origin = `http://127.0.0.1:${port}`;
    const env = { ...process.env, MONGO_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, NODE_PATH: path.join(root, 'node_modules'), JWT_SECRET: crypto.randomBytes(32).toString('hex'), NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) };
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'SLACK_BOT_TOKEN']) env[key] = 'isolated-fixture-no-credential';
    // Parser scratch files also stay inside the temporary data directory.
    child = spawn(process.execPath, [path.join(root, '.output/server/index.mjs')], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', value => logs += value);
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      try { const health = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).json(); if (health.database?.connected) { assert.equal(health.database.name, 'transaction_import_browser'); healthy = true; break; } } catch {}
      await pause(200);
    }
    assert(healthy, 'Isolated application failed to start');
    client = await MongoClient.connect(uri); const db = client.db('transaction_import_browser');
    const call = async (route, { method = 'GET', token, body } = {}) => {
      const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    const email = 'import-browser@example.invalid', password = 'Synthetic-password-Only1!';
    const registered = await call('/api/auth/register', { method: 'POST', body: { email, password, name: 'Import browser fixture' } });
    assert.equal(registered.status, 200);
    await require('./helpers/group-session.cjs')(call, registered.data.tokens.accessToken, 'Synthetic import company');
    const supplierId = new ObjectId(), customerId = new ObjectId();
    await db.collection('suppliers').insertOne({ _id: supplierId, name: '123' });
    await db.collection('customers').insertOne({ _id: customerId, name: '456', isActive: true });
    const fixtureRows = [
      ['79,200', '2026-09-22', 'Synthetic purchase', 123, 456],
      ['bad', '2026-09-22', 'Invalid amount', 123, 456],
      ['bad', 'bad', 'Both invalid', 123, 456],
      [1200, 'bad', 'Invalid date', 123, 456],
      [2300, '', 'Missing date', 123, 456],
      [3400, '2000-01-01', 'Old date', 123, 456]
    ];
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Paid', 'Day', 'Item', 'Seller', 'Buyer'], ...fixtureRows]), 'Synthetic');
    const inputFile = path.join(directory, 'synthetic-purchases.xlsx'); XLSX.writeFile(workbook, inputFile);
    const sessions = await hub('/api/browser/sessions'); assert(!sessions.sessionList.some(item => item.profileName === profile), 'Dedicated test profile is already in use');
    session = await hub('/api/browser/open', { url: 'about:blank', profile, background: true });
    const ps = "$ProgressPreference = 'SilentlyContinue'; Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | ForEach-Object { if ($_.CommandLine -match 'ohmyfinance-import-preview-test' -and $_.CommandLine -match '--remote-debugging-port=(\\d+)') { $matches[1] } }";
    const portOutput = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
    const ports = [...new Set(portOutput.trim().split(/\s+/).filter(value => /^\d+$/.test(value)))]; assert.equal(ports.length, 1);
    const puppeteer = require('node:module').createRequire(path.join(root, 'collector/package.json'))('rebrowser-puppeteer-core');
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + ports[0], defaultViewport: null });
    page = await browser.newPage(); page.setDefaultTimeout(25000); await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('request', request => {
      if (request.url() === origin + '/api/transactions/import') importRequests.push(JSON.parse(request.postData()));
      if (request.url() === origin + '/api/transactions/import-preview') entityRequests.push({ authenticated: !!request.headers().authorization, body: JSON.parse(request.postData()) });
    });
    const click = async (label, selector = 'button') => {
      await page.waitForFunction((text, selector) => [...document.querySelectorAll(selector)].some(element => element.textContent.trim() === text && !element.disabled), {}, label, selector);
      await page.evaluate((text, selector) => [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text && !element.disabled).click(), label, selector);
    };
    const heading = key => page.waitForFunction(text => [...document.querySelectorAll('main h2')].some(element => element.textContent.trim() === text), {}, t(key));
    const map = async (fields) => {
      for (const [source, target] of Object.entries(fields)) {
        await page.evaluate((source, target) => {
          const row = [...document.querySelectorAll('main tbody tr')].find(row => row.cells[0]?.textContent.trim() === source);
          const select = row?.querySelector('select'); if (!select) throw Error('Missing mapping: ' + source);
          select.value = target; select.dispatchEvent(new Event('change', { bubbles: true }));
        }, source, target);
      }
    };
    const previewCounts = () => page.$$eval('main p.text-2xl.font-mono', elements => elements.map(element => Number(element.textContent.trim())));
    const screenshot = async name => {
      await page.waitForFunction(() => !document.querySelector('main .fade-enter-active, main .fade-leave-active'));
      await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
    };
    await page.goto(origin + '/login', { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.type('#email', email); await page.type('#password', password); await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/');
    await page.goto(origin + '/transactions/upload', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="file"]'); await (await page.$('input[type="file"]')).uploadFile(inputFile);
    await click(t('transactionImport.continueToMapping')); await heading('fieldMapper.title');
    await map({ Paid: 'amount', Day: 'date', Item: 'notes', Seller: 'supplierName', Buyer: 'customerName' });
    await click(t('fieldMapper.continueToPreview')); await heading('dataPreview.title');
    assert.deepEqual(await previewCounts(), [6, 1, 2, 3]);
    const initialTable = await page.$eval('main tbody', element => element.innerText);
    assert(initialTable.includes('Synthetic purchase')); pass('XLSX upload and initial preview render six rows without pressing refresh');
    await click(t('dataPreview.refreshPreview')); assert.deepEqual(await previewCounts(), [6, 1, 2, 3]);
    assert.equal(await page.$eval('main tbody', element => element.innerText), initialTable); pass('refresh preserves original columns and validation');
    await click(t('dataPreview.backToMapping')); await heading('fieldMapper.title'); await map({ Item: 'productName' });
    await click(t('fieldMapper.continueToPreview')); await heading('dataPreview.title'); assert.deepEqual(await previewCounts(), [6, 1, 2, 3]);
    assert((await page.$eval('main tbody', element => element.innerText)).includes('Synthetic purchase')); pass('back and remap retain purchase details');
    await page.setViewport({ width: 390, height: 844 }); await screenshot('preview-mobile.png');
    await page.setViewport({ width: 1440, height: 1000 });
    await click(t('dataPreview.continueToImport')); await heading('importConfirmation.title');
    assert.match(await page.$eval('main', element => element.innerText), /3\s*\/\s*6/); pass('confirmation counts only the three rows accepted by import');
    await click(t('importConfirmation.startImport'));
    await page.waitForFunction(() => [...document.querySelectorAll('h3')].some(element => element.textContent.includes('インポート')));
    assert((await page.$eval('body', element => element.innerText)).includes(t('importConfirmation.confirmMessage').replace('{count}', '3')));
    await click(t('importConfirmation.startImport'), '.fixed button'); await heading('importResults.successTitle');
    assert.deepEqual(await previewCounts(), [3, 0, 3]);
    await click(t('importResults.showErrors').replace('{count}', '3'));
    const resultText = await page.$eval('main', element => element.innerText); assert.match(resultText, /invalid amount/i); assert.match(resultText, /Invalid date/);
    const stored = await db.collection('transactions').find({}).toArray(); assert.equal(stored.length, 3);
    assert.deepEqual(stored.map(row => row.amount), [79200, 2300, 3400]);
    assert.deepEqual(stored.map(row => row.productName), ['Synthetic purchase', 'Missing date', 'Old date']);
    assert(stored.every(row => row.supplierId.equals(supplierId) && row.customerId.equals(customerId)));
    assert.equal(await db.collection('suppliers').countDocuments({}), 1); assert.equal(await db.collection('customers').countDocuments({}), 1);
    assert.equal(importRequests.length, 1); assert.deepEqual(Object.keys(importRequests[0].data[0]), ['Paid', 'Day', 'Item', 'Seller', 'Buyer']);
    assert.equal(typeof importRequests[0].data[0].Seller, 'number');
    assert(entityRequests.length >= 3 && entityRequests.every(request => request.authenticated));
    assert(entityRequests.every(request => JSON.stringify(request.body) === JSON.stringify({ supplierNames: ['123'], customerNames: ['456'] })));
    pass('actual server imports raw XLSX values once, reuses both catalogs and shows per-row errors');
    await page.setViewport({ width: 390, height: 844 }); await screenshot('results-mobile.png');
    await click(t('importResults.importMore')); await page.waitForSelector('input[type="file"]');
    const secondFile = path.join(directory, 'synthetic-second.csv'); fs.writeFileSync(secondFile, 'Paid,Day,Item\r\n4500,2026-09-24,Second import\r\n');
    await (await page.$('input[type="file"]')).uploadFile(secondFile); await click(t('transactionImport.continueToMapping')); await heading('fieldMapper.title');
    await map({ Paid: 'amount', Day: 'date', Item: 'notes' }); await click(t('fieldMapper.continueToPreview')); await heading('dataPreview.title');
    assert.deepEqual(await previewCounts(), [1, 1, 0, 0]);
    await click(t('dataPreview.continueToImport')); await heading('importConfirmation.title'); await click(t('importConfirmation.startImport'));
    await click(t('importConfirmation.startImport'), '.fixed button'); await heading('importResults.successTitle');
    assert.deepEqual(await previewCounts(), [1, 0, 0]); assert.equal(await db.collection('transactions').countDocuments({}), 4);
    assert.equal(importRequests.length, 2); assert.equal(importRequests[1].data.length, 1); pass('import-more clears prior rows and completes a fresh CSV import on mobile');
    assert.deepEqual(consoleErrors, []); assert.deepEqual(hashes(), sourceHashes);
    fs.writeFileSync(path.join(outputDir, 'verification.json'), JSON.stringify({ at: new Date().toISOString(), sourceHashes, checks, syntheticData: true, actualParserAndDatabase: true, productionTouched: false, outputDir }, null, 2));
    console.log(JSON.stringify({ pass: true, checks: checks.length, outputDir }));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(outputDir, 'failure.txt'), await page.$eval('body', element => element.innerText).catch(() => 'Page unavailable')); }
    fs.writeFileSync(path.join(outputDir, 'failure.json'), JSON.stringify({ error: error.stack, checks, consoleErrors }, null, 2)); throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, 'server.log'), logs);
    if (page) await page.close(); if (browser) await browser.disconnect();
    if (session?.session_id) await hub('/api/browser/close', { session_id: session.session_id });
    if (child && child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
    if (client) await client.close(); if (mongo) await mongo.stop();
    if (directory) { assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fsp.rm(directory, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

// Actual settings save -> shared session -> transaction filter/export, without a document reload.
// Owned MongoDB/application/installed Chrome and synthetic accounts only. No model or production calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process'), { createRequire } = require('node:module');
const { MongoMemoryServer } = require('mongodb-memory-server'), { MongoClient, ObjectId } = require('mongodb');
const { closeOwnedBrowser } = require('./finance-browser-cleanup.cjs');
const source = path.resolve(__dirname, '..'), root = path.resolve(process.env.OMF_SETTINGS_APP_ROOT || source);
const pause = ms => new Promise(r => setTimeout(r, ms));
const saveLabels = ['ja', 'ko'].map(locale => JSON.parse(fs.readFileSync(path.join(source, 'i18n/locales/' + locale + '.json'), 'utf8')).common.save);
const errorLabels = ['ja', 'ko'].map(locale => JSON.parse(fs.readFileSync(path.join(source, 'i18n/locales/' + locale + '.json'), 'utf8')).common.error);
async function main() {
  let mongo, app, client, directory, browser, held, failure, checks = 0;
  const pass = text => { checks++; console.log('PASS ' + text); };
  try {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-organization-settings-'));
    const binary = path.resolve(source, '../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
    mongo = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined, instance: { launchTimeout: 300000 } });
    const dbName = 'organization_settings_regression', uri = mongo.getUri(dbName), listener = net.createServer();
    await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
    const origin = 'http://127.0.0.1:' + port;
    app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env,
      MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), OMF_SYNC_SCHEDULE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    app.closed = new Promise(r => app.once('close', r)); for (const stream of [app.stdout, app.stderr]) stream.on('data', () => {});
    let healthy = false;
    for (const started = Date.now(); Date.now() - started < 300000 && !healthy;) {
      try { const h = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(2000) })).json(); if (h.database?.connected) { assert.equal(h.database.name, dbName); healthy = true; } } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; }
      if (!healthy) await pause(200);
    }
    assert.ok(healthy, 'SETUP owned app'); client = await MongoClient.connect(uri); const db = client.db(dbName);
    const api = async (route, token, method = 'GET', body) => {
      const r = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
      const raw = await r.text(); let data; try { data = JSON.parse(raw); } catch {} return { status: r.status, data, raw };
    };
    const ok = async (...args) => { const r = await api(...args); assert.equal(r.status, 200, 'SETUP native ' + args[0]); return r.data; };
    const password = 'Synthetic-settings-only1!', ownerEmail = 'settings-owner@example.invalid', viewerEmail = 'settings-viewer@example.invalid';
    for (const email of [ownerEmail, viewerEmail]) await ok('/api/auth/register', null, 'POST', { email, password, name: 'Synthetic settings user' });
    const owner = (await db.collection('users').findOne({ email: ownerEmail }))._id, viewer = (await db.collection('users').findOne({ email: viewerEmail }))._id;
    const A = new ObjectId(), B = new ObjectId(), now = new Date();
    await db.collection('organizations').insertMany([
      { _id: A, name: 'SETTINGS_A', slug: 'settings-a', type: 'business', isActive: true, members: [{ userId: owner, role: 'owner', joinedAt: now }, { userId: viewer, role: 'viewer', joinedAt: now }], settings: { timezone: 'Asia/Tokyo', defaultCurrency: 'JPY', fiscalYearStart: 11 } },
      { _id: B, name: 'SETTINGS_B', slug: 'settings-b', type: 'business', isActive: true, members: [{ userId: owner, role: 'owner', joinedAt: now }], settings: { timezone: 'Europe/London', defaultCurrency: 'GBP', fiscalYearStart: 4 } }
    ]);
    const rows = [
      { _id: new ObjectId(), referenceNumber: 'SETTINGS-TOKYO', date: new Date('2026-10-30T16:00:00Z') },
      { _id: new ObjectId(), referenceNumber: 'SETTINGS-BOTH', date: new Date('2026-10-31T12:00:00Z') },
      { _id: new ObjectId(), referenceNumber: 'SETTINGS-NEWYORK', date: new Date('2026-11-01T03:30:00Z') }
    ].map(r => ({ ...r, organizationId: A, amount: 100, type: '\u652f\u51fa', status: 'completed', hasReceipt: false, items: [], tags: [], timeline: [], attachments: [], createdAt: now, updatedAt: now }));
    await db.collection('transactions').insertMany(rows);
    const financial = async () => JSON.stringify(await Promise.all(['transactions', 'invoices', 'payments', 'receipts'].map(n => db.collection(n).find().sort({ _id: 1 }).toArray())));
    const before = await financial(), sorted = a => [...a].sort(), expected = zone => rows.filter(r => zone === 'Asia/Tokyo' ? r.referenceNumber !== 'SETTINGS-NEWYORK' : r.referenceNumber !== 'SETTINGS-TOKYO');
    let puppeteer; try { puppeteer = createRequire(path.join(source, 'collector/package.json'))('rebrowser-puppeteer-core'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; puppeteer = createRequire(path.resolve(source, '../collector/package.json'))('rebrowser-puppeteer-core'); }
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync); assert.ok(executablePath, 'Installed Chrome required');
    browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, userDataDir: path.join(directory, 'profile'), args: ['--lang=ja-JP,ja', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 }); const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const wait = async (fn, args = [], label = 'condition') => { for (let i = 0; i < 300; i++) { if (await page.evaluate(fn, ...args)) return; await pause(100); } assert.fail('settings:wait ' + label); };
    const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const store = () => page.evaluate(() => { const u = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user'); return JSON.parse(JSON.stringify({ actor: u.user?.id || u.user?._id, session: u.sessionId, current: u.currentOrganization, organizations: u.organizations })); });
    const push = async route => { await page.evaluate(route => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(route), route); await wait(p => location.pathname === p, [route], 'route'); };
    const nativeLogin = async email => {
      const login = await ok('/api/auth/login', null, 'POST', { email, password }); const switched = await ok('/api/auth/switch-organization', login.tokens.accessToken, 'POST', { organizationId: String(A) });
      const profile = await ok('/api/auth/me', switched.tokens.accessToken);
      await page.evaluate(({ profile, pair }) => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').acceptSession({ ...profile, tokens: pair.tokens }, false), { profile, pair: switched });
    };
    const chooseEditor = async name => {
      await wait(name => [...document.querySelectorAll('[data-page-content] button')].some(b => b.textContent.includes(name)), [name], 'editor button');
      await page.evaluate(name => [...document.querySelectorAll('[data-page-content] button')].find(b => b.textContent.includes(name)).click(), name); await frames();
    };
    const zoneValue = () => page.evaluate(() => [...document.querySelectorAll('select')].find(e => [...e.options].some(o => o.value === 'America/New_York'))?.value);
    const editZone = async zone => { await wait(() => [...document.querySelectorAll('select')].some(e => [...e.options].some(o => o.value === 'America/New_York')), [], 'timezone'); await page.evaluate(zone => { const e = [...document.querySelectorAll('select')].find(e => [...e.options].some(o => o.value === 'America/New_York')); e.value = zone; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, zone); await frames(); };
    const clickSave = async () => { await wait(labels => [...document.querySelectorAll('button')].some(b => labels.includes(b.textContent.trim()) && !b.disabled), [saveLabels], 'save'); await page.evaluate(labels => [...document.querySelectorAll('button')].find(b => labels.includes(b.textContent.trim()) && !b.disabled).click(), saveLabels); };
    const save = async (zone, id = A) => { await editZone(zone); const response = page.waitForResponse(r => r.url() === origin + '/api/organizations/' + id && r.request().method() === 'PUT'); await clickSave(); const r = await response; assert.equal(r.status(), 200, 'settings:native-save'); await frames(); };
    const savedZone = async id => (await db.collection('organizations').findOne({ _id: id })).settings.timezone;
    const assertSession = async zone => { const s = await store(); assert.equal(String(s.current.id || s.current._id), String(A), 'settings:current-company'); assert.equal(s.current.settings.timezone, zone, 'settings:session-zone'); assert.equal(s.organizations.find(o => String(o.id || o._id) === String(A)).settings.timezone, zone, 'settings:list-zone'); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ohmyfinance_session')).currentOrganization.settings.timezone), zone, 'settings:persisted-zone'); };
    const downloads = path.join(directory, 'downloads'); await fsp.mkdir(downloads); const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const assertFilterExport = async zone => {
      await push('/transactions'); await wait(() => !!document.querySelector('[data-page-content] tbody tr'), [], 'transactions');
      await page.evaluate(() => [...document.querySelectorAll('[data-page-content] button')].find(b => b.textContent.includes('詳細フィルター')).click());
      await wait(() => document.querySelectorAll('[data-page-content] input[type=date]').length === 2, [], 'date filters');
      await page.$$eval('[data-page-content] input[type=date]', es => es.forEach(e => { e.value = '2026-10-31'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })); await frames();
      const refs = await page.evaluate(() => [...document.querySelectorAll('[data-page-content] tbody tr')].map(r => (r.textContent.match(/SETTINGS-[A-Z]+/) || [''])[0]));
      assert.deepEqual(sorted(refs), sorted(expected(zone).map(r => r.referenceNumber)), 'settings:visible-zone-rows');
      for (const f of await fsp.readdir(downloads)) await fsp.unlink(path.join(downloads, f));
      await page.click('[data-transactions-export]'); let csv;
      for (let i = 0; i < 150; i++) { const f = (await fsp.readdir(downloads)).find(n => n.endsWith('.csv')); if (f) { csv = await fsp.readFile(path.join(downloads, f), 'utf8'); break; } await pause(100); }
      assert.ok(csv, 'settings:csv-download'); const ids = csv.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[0]);
      assert.deepEqual(sorted(ids), sorted(expected(zone).map(r => String(r._id))), 'settings:button-zone-ids');
      assert.equal(await page.evaluate(() => window.__organizationSettingsNoReload), 'same-document', 'settings:no-document-reload');
    };
    let interception = null;
    page.on('request', async request => {
      if (request.interceptResolutionState().action === 'disabled') return;
      if (interception && request.method() === 'PUT' && request.url() === origin + '/api/organizations/' + A) {
        const mode = interception; interception = null;
        if (mode.fail) { await request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, statusMessage: 'SYNTHETIC_SAVE_REJECTED' }) }); return; }
        if (mode.failureMode) {
          held = { request, status: 500, body: JSON.stringify({ success: false, statusMessage: 'SYNTHETIC_SAVE_REJECTED' }), abort: mode.failureMode === 'network' };
          mode.ready(); return;
        }
        try { const r = await api('/api/organizations/' + A, request.headers().authorization?.replace(/^Bearer /, ''), 'PUT', request.postData()); held = { request, status: r.status, body: r.raw }; mode.ready(); } catch (e) { mode.reject(e); }
      } else await request.continue();
    });
    const delaySave = async (zone, failureMode) => { await page.setRequestInterception(true); const pending = new Promise((ready, reject) => { interception = { ready, reject, failureMode }; }); await editZone(zone); await clickSave(); await pending; assert.equal(held.status, failureMode ? 500 : 200, 'settings:held-save'); };
    const release = async () => { const h = held; held = null; if (h.abort) await h.request.abort('failed'); else await h.request.respond({ status: h.status, contentType: 'application/json', body: h.body }); await frames(); await page.setRequestInterception(false); };

    await page.goto(origin + '/login', { waitUntil: 'networkidle2' }); await wait(() => !!document.querySelector('#email'), [], 'login');
    await page.type('#email', ownerEmail); await page.type('#password', password); await page.click('button[type=submit]'); await wait(() => location.pathname === '/', [], 'logged in');
    await nativeLogin(ownerEmail); assert.equal(String((await store()).current?.id || (await store()).current?._id), String(A), 'SETUP selected company'); await page.evaluate(() => { window.__organizationSettingsNoReload = 'same-document'; });
    await push('/settings/organization'); await chooseEditor('SETTINGS_A');
    await save('America/New_York'); assert.equal(await savedZone(A), 'America/New_York'); await assertSession('America/New_York'); await assertFilterExport('America/New_York');
    await push('/settings/organization'); await chooseEditor('SETTINGS_A'); await save('Asia/Tokyo'); await assertSession('Asia/Tokyo'); await assertFilterExport('Asia/Tokyo');
    pass('actual timezone saves in both directions refresh shared/persisted settings; visible edge-hour rows equal downloaded CSV IDs without document reload');

    await push('/settings/organization'); await chooseEditor('SETTINGS_B'); await save('America/Los_Angeles', B); const noncurrent = await store();
    assert.equal(noncurrent.current.settings.timezone, 'Asia/Tokyo', 'settings:noncurrent-keeps-current'); assert.equal(noncurrent.organizations.find(o => String(o.id || o._id) === String(B)).settings.timezone, 'America/Los_Angeles', 'settings:noncurrent-cache');
    pass('editing another owned company updates its cached settings without selecting it as the current company');

    await chooseEditor('SETTINGS_A'); await delaySave('America/New_York'); await chooseEditor('SETTINGS_B'); await release();
    assert.equal(await zoneValue(), 'America/Los_Angeles', 'settings:late-save-keeps-editor'); await assertSession('America/New_York');
    pass('a delayed save refreshes its company while preserving a different selected editor');

    await chooseEditor('SETTINGS_A'); await delaySave('Asia/Tokyo'); const session = (await store()).session;
    assert.equal(await page.evaluate(() => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').refreshAuthToken()), 'refreshed', 'settings:normal-refresh');
    assert.equal((await store()).session, session, 'settings:refresh-keeps-session'); await release(); await assertSession('Asia/Tokyo');
    pass('ordinary token renewal does not discard a legitimate settings-save response');

    await delaySave('America/New_York'); await nativeLogin(viewerEmail); const viewerBefore = await store(); assert.equal(viewerBefore.current.role, 'viewer'); await release();
    const viewerAfter = await store(); assert.equal(viewerAfter.current.role, 'viewer', 'settings:stale-actor-shared-role'); assert.deepEqual(viewerAfter, viewerBefore, 'settings:stale-actor-session-unchanged');
    pass('a delayed former-owner save cannot replace the new actor session or promote the same-company viewer role');

    await nativeLogin(ownerEmail); await push('/transactions'); await push('/settings/organization'); await chooseEditor('SETTINGS_A');
    const failureNotices = [];
    for (const mode of ['rejection', 'network']) {
      const stateBefore = await store(), nativeBefore = await savedZone(A), zone = nativeBefore === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo', start = dialogs.length;
      await delaySave(zone, mode); await chooseEditor('SETTINGS_B'); await release();
      for (let n = 0; n < 100 && dialogs.length === start; n++) await pause(50);
      const notice = dialogs.slice(start), expected = mode === 'rejection' ? ['SETTINGS_A: SYNTHETIC_SAVE_REJECTED'] : errorLabels.map(label => 'SETTINGS_A: ' + label);
      failureNotices.push({ mode, singleNamedNotice: notice.length === 1 && expected.includes(notice[0]) });
      console.log('OBSERVE switched-editor failure ' + JSON.stringify({ mode, dialogCount: notice.length, singleNamedNotice: failureNotices.at(-1).singleNamedNotice }));
      assert.equal(await zoneValue(), 'America/Los_Angeles', 'settings:failed-switch-keeps-editor-' + mode);
      assert.deepEqual(await store(), stateBefore, 'settings:failed-switch-keeps-session-' + mode); assert.equal(await savedZone(A), nativeBefore, 'settings:failed-switch-keeps-native-' + mode);
      await chooseEditor('SETTINGS_A'); await save(zone); await assertSession(zone);
    }
    assert.deepEqual(failureNotices, [{ mode: 'rejection', singleNamedNotice: true }, { mode: 'network', singleNamedNotice: true }], 'settings:switched-editor-failure-notices');
    for (const mode of failureNotices) pass('a held ' + mode.mode + ' failure identifies the saved company after an editor switch, preserves both settings views and allows retry');

    const zoneBeforeFailure = (await store()).current.settings.timezone, dialogBeforeFailure = dialogs.length; await page.setRequestInterception(true); interception = { fail: true };
    await editZone('Asia/Tokyo'); await clickSave(); await wait(() => !!document.querySelector('select'), [], 'failure settled');
    for (let i = 0; i < 100 && dialogs.length === dialogBeforeFailure; i++) await pause(50);
    assert.ok(dialogs.slice(dialogBeforeFailure).some(message => message.endsWith('SYNTHETIC_SAVE_REJECTED')), 'settings:save-error-visible'); assert.equal((await store()).current.settings.timezone, zoneBeforeFailure, 'settings:failed-save-keeps-cache'); assert.equal(await savedZone(A), zoneBeforeFailure, 'settings:failed-save-keeps-native');
    await page.setRequestInterception(false); await save('Asia/Tokyo'); await assertSession('Asia/Tokyo');
    pass('failed save leaves native and shared settings unchanged and the same form can retry successfully');
    assert.equal(await financial(), before, 'settings:no-financial-writes'); assert.deepEqual(errors, [], 'settings:no-page-errors');
    console.log(checks + ' Organization settings groups passed');
  } catch (e) { failure = e; throw e; }
  finally {
    const cleanupErrors = [], step = async (name, action) => { try { await action(); } catch (e) { cleanupErrors.push(new Error(name + ': ' + e.message)); } };
    await step('held response', async () => { if (held) await held.request.respond({ status: held.status, contentType: 'application/json', body: held.body }); });
    await step('owned Chrome', async () => { if (browser) console.log('CLEANUP settings-browser ' + JSON.stringify(await closeOwnedBrowser(browser))); });
    await step('owned app', async () => { if (app) { app.kill(); await app.closed; } });
    await step('database client', async () => { if (client) await client.close(); });
    await step('owned Mongo', async () => { if (mongo) await mongo.stop(); });
    await step('private data', async () => { if (directory) { const target = path.resolve(directory), base = path.resolve(os.tmpdir()); assert.ok(target.startsWith(base + path.sep) && path.basename(target).startsWith('omf-organization-settings-')); await fsp.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } });
    if (cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Settings test and owned cleanup results');
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

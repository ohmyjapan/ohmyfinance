// Actual built HTTP routes, isolated Mongo process, synthetic records only. Run through the hub fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process'), { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb'), jwt = require('jsonwebtoken');
const root = path.resolve(process.env.OMF_INVOICE_APP_ROOT || path.join(__dirname, '..'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function main() {
 let mongo, client, directory, child, logs = '', groups = 0;
 const pass = name => { groups++; console.log('PASS ' + name); };
 try {
  assert.ok(fs.existsSync(path.join(root, '.output/server/index.mjs')), 'SETUP: built application required');
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'omf-invoice-access-'));
  const binary = path.resolve(__dirname, '../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo = await MongoMemoryServer.create({ binary: fs.existsSync(binary) ? { systemBinary: binary, version: '8.2.1' } : undefined });
  const uri = mongo.getUri('invoice_access_regression'), p = await freePort(), origin = 'http://127.0.0.1:' + p;
  const secret = crypto.randomBytes(32).toString('hex');
  const start = async () => {
   child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, MONGO_URI: uri, MONGODB_URI: uri, NUXT_MONGO_URI: uri, OMF_DATA_DIR: directory, JWT_SECRET: secret,
     NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(p), NITRO_PORT: String(p) }, stdio: ['ignore', 'pipe', 'pipe'] });
   child.closed = new Promise(resolve => child.once('exit', resolve));
   for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-10000); });
   for (let i = 0; i < 100; i++) {
    try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }), d = await r.json();
     if (d.database?.connected) { assert.equal(d.database.name, 'invoice_access_regression'); return; } } catch {}
    await pause(200);
   }
   throw Error('SETUP owned app health unavailable: ' + logs);
  };
  const stop = async () => { if (child) { child.kill(); await Promise.race([child.closed, pause(5000)]); child = null; } };
  await start(); client = await MongoClient.connect(uri); const db = client.db('invoice_access_regression');
  const call = async (route, token, { method = 'GET', body } = {}) => {
   const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
   const raw = await response.text(), data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : null;
   return { status: response.status, data, raw, headers: response.headers };
  };
  const ok = async (route, token, options) => { const r = await call(route, token, options); assert.equal(r.status, 200, 'SETUP/positive route ' + route); return r.data; };
  const roles = ['owner', 'admin', 'member', 'viewer'], people = [];
  for (const [i, role] of [...roles, 'outsider'].entries()) {
   const email = 'invoice-' + i + '@example.invalid';
   const result = await ok('/api/auth/register', null, { method: 'POST', body: { email, password: 'Synthetic-only-Password1!', name: 'Synthetic ' + role } });
   const user = await db.collection('users').findOne({ email }); people.push({ id: user._id, email, role, token: result.tokens.accessToken });
  }
  const A = new ObjectId(), B = new ObjectId(), now = new Date(), orgs = db.collection('organizations');
  await orgs.insertMany([
   { _id: A, name: 'Synthetic company A', slug: 'synthetic-invoice-a', isActive: true, members: people.slice(0, 4).map(u => ({ userId: u.id, role: u.role, joinedAt: now })) },
   { _id: B, name: 'Synthetic company B', slug: 'synthetic-invoice-b', isActive: true, members: [{ userId: people[0].id, role: 'member', joinedAt: now }] }
  ]);
  for (const u of people.slice(0, 4)) u.companyToken = (await ok('/api/auth/switch-organization', u.token, { method: 'POST', body: { organizationId: String(A) } })).tokens.accessToken;
  const tokenA = people[0].companyToken;
  const tokenB = (await ok('/api/auth/switch-organization', people[0].token, { method: 'POST', body: { organizationId: String(B) } })).tokens.accessToken;
  // Valid tokens signed only with this test process's random key; never real credentials.
  const tokenWithoutCompany = jwt.sign({ userId: String(people[0].id), email: people[0].email, type: 'access' }, secret, { expiresIn: '5m' });
  const staleOutsider = jwt.sign({ userId: String(people[4].id), email: people[4].email, organizationId: String(A), role: 'owner', type: 'access' }, secret, { expiresIn: '5m' });
  const a1 = new ObjectId(), a2 = new ObjectId(), b1 = new ObjectId(), unassigned = new ObjectId();
  const invoice = (id, company, number, status, stamp, label) => ({ _id: id, ...(company ? { organizationId: company } : {}), invoiceNumber: number, status,
   issueDate: new Date('2026-01-01T00:00:00Z'), dueDate: new Date('2026-02-01T00:00:00Z'), createdAt: new Date(stamp), updatedAt: new Date(stamp),
   from: { name: label, taxId: 'T1234567890123' }, to: { name: 'Synthetic recipient' }, items: [{ description: label, quantity: 1, unitPrice: 100, amount: 100 }], subtotal: 100, taxRate: 10, taxAmount: 10, total: 110, currency: 'JPY' });
  await db.collection('invoices').insertMany([
   invoice(a1, A, 'INV-SAME', 'draft', '2026-01-01', 'VISIBLE_A'), invoice(a2, A, 'INV-OTHER', 'paid', '2026-01-02', 'VISIBLE_A_PAID'),
   invoice(b1, B, 'INV-SAME', 'draft', '2026-01-03', 'FOREIGN_COMPANY_PRIVATE'), invoice(unassigned, null, 'INV-UNASSIGNED', 'draft', '2026-01-04', 'UNASSIGNED_PRIVATE')
  ]);
  const visibleBill = new ObjectId();
  await db.collection('payments').insertMany([
   { _id: visibleBill, organizationId: A, title: 'Visible A bill', amount: 110, currency: 'JPY', dueDate: now, type: 'expense', status: 'pending', category: 'Synthetic' },
   { organizationId: A, title: 'SUPPRESSED_PRIVATE', amount: 110, currency: 'JPY', dueDate: now, type: 'expense', status: 'pending', category: 'Synthetic', suppressedAt: now },
   { organizationId: B, title: 'FOREIGN_BILL_PRIVATE', amount: 110, currency: 'JPY', dueDate: now, type: 'expense', status: 'pending', category: 'Synthetic' }
  ]);
  const snapshot = async () => JSON.stringify(await Promise.all(['invoices', 'payments', 'transactions', 'financeactionoperations'].map(n => db.collection(n).find().sort({ _id: 1 }).toArray())));
  const before = await snapshot();
  const list = await ok('/api/invoices', tokenA);
  assert.equal(list.pagination.total, 2, 'invoice:list-scope'); assert.deepEqual(list.invoices.map(i => String(i.id)).sort(), [String(a1), String(a2)].sort(), 'invoice:list-scope');
  assert.ok(!JSON.stringify(list).includes('_PRIVATE'), 'invoice:list-private');
  const page = await ok('/api/invoices?page=1&limit=1', tokenA); assert.equal(page.pagination.total, 2); assert.equal(page.pagination.totalPages, 2); assert.equal(String(page.invoices[0].id), String(a2));
  const filtered = await ok('/api/invoices?status=paid', tokenA); assert.equal(filtered.pagination.total, 1); assert.equal(String(filtered.invoices[0].id), String(a2));
  const injected = await ok('/api/invoices?organizationId=' + B, tokenA); assert.equal(injected.pagination.total, 2); assert.ok(!JSON.stringify(injected).includes('_PRIVATE'));
  pass('list/count/pagination/status remain inside selected company; unassigned/foreign rows and query override excluded');
  assert.equal(String((await ok('/api/invoices/' + a1, tokenA)).invoice.id), String(a1));
  assert.equal((await call('/api/invoices/' + b1, tokenA)).status, 404, 'invoice:detail-scope');
  assert.equal((await call('/api/invoices/' + unassigned, tokenA)).status, 404, 'invoice:detail-unassigned');
  pass('detail returns own invoice and does not reveal foreign/unassigned IDs');
  const preview = await call('/api/invoices/' + a1 + '/pdf', tokenA); assert.equal(preview.status, 200); assert.match(preview.headers.get('content-type'), /text\/html/); assert.ok(preview.raw.includes('VISIBLE_A')); assert.ok(!preview.raw.includes('_PRIVATE')); assert.match(preview.headers.get('content-disposition'), /\.html/);
  assert.equal((await call('/api/invoices/' + b1 + '/pdf', tokenA)).status, 404, 'invoice:preview-scope');
  assert.equal((await call('/api/invoices/' + unassigned + '/pdf', tokenA)).status, 404, 'invoice:preview-unassigned');
  // The existing preview handler serves a read for other methods too; keep it scoped without a new method rejection.
  assert.equal((await call('/api/invoices/' + a1 + '/pdf', tokenA, { method: 'POST', body: {} })).status, 200);
  assert.equal((await call('/api/invoices/' + b1 + '/pdf', tokenA, { method: 'POST', body: {} })).status, 404, 'invoice:preview-other-method-scope');
  pass('preview keeps actual HTML format and does not reveal foreign/unassigned invoice');
  const routes = ['/api/invoices', '/api/invoices/' + a1, '/api/invoices/' + a1 + '/pdf'];
  for (const route of routes) {
   assert.equal((await call(route)).status, 401, 'invoice:authentication');
   assert.equal((await call(route, tokenWithoutCompany)).status, 403, 'invoice:selected-company-required');
   assert.equal((await call(route, staleOutsider)).status, 403, 'invoice:current-membership');
  }
  pass('all three reads require real authentication, company selection and live membership despite valid signed claims');
  for (const u of people.slice(0, 4)) {
   assert.equal((await ok('/api/invoices', u.companyToken)).pagination.total, 2, 'invoice:legitimate-' + u.role);
   assert.equal((await call('/api/invoices/' + a1, u.companyToken)).status, 200);
   assert.equal((await call('/api/invoices/' + a1 + '/pdf', u.companyToken)).status, 200);
  }
  const member = people[2]; await orgs.updateOne({ _id: A }, { $pull: { members: { userId: member.id } } });
  for (const route of routes) assert.equal((await call(route, member.companyToken)).status, 403, 'invoice:revoked-membership');
  await orgs.updateOne({ _id: A }, { $push: { members: { userId: member.id, role: member.role, joinedAt: now } }, $set: { isActive: false } });
  for (const route of routes) assert.equal((await call(route, tokenA)).status, 403, 'invoice:inactive-company');
  await orgs.updateOne({ _id: A }, { $set: { isActive: true } });
  assert.equal((await call('/api/invoices/' + a1, member.companyToken)).status, 200);
  pass('all member roles remain legitimate readers; removal/inactive company take effect on existing tokens');
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => ok('/api/invoices', i % 2 ? tokenB : tokenA)));
  concurrent.forEach((r, i) => { assert.equal(r.pagination.total, i % 2 ? 1 : 2, 'invoice:parallel-company-scope'); assert.deepEqual(r.invoices.map(v => String(v.id)).sort(), i % 2 ? [String(b1)] : [String(a1), String(a2)].sort()); });
  assert.equal((await call('/api/invoices/' + a1, tokenB)).status, 404); assert.equal((await call('/api/invoices/' + b1, tokenA)).status, 404);
  pass('same user concurrent A/B selected-company tokens cannot retarget each other');
  for (const u of people.slice(0, 4)) { const bills = await ok('/api/payments', u.companyToken); assert.deepEqual(bills.map(v => String(v.id)), [String(visibleBill)], 'invoice:calendar-unaffected'); }
  assert.equal(await snapshot(), before, 'invoice:no-read-writes');
  pass('existing calendar role/suppression/company policy unchanged; reads have no financial/journal effects');
  await stop(); await start();
  assert.equal((await ok('/api/invoices', tokenA)).pagination.total, 2); assert.equal((await call('/api/invoices/' + b1, tokenA)).status, 404); assert.equal((await call('/api/invoices/' + a1 + '/pdf', tokenA)).status, 200);
  assert.equal(await snapshot(), before, 'invoice:restart-no-writes');
  pass('fresh owned server process retains native company scope and exact financial state');
  console.log(groups + ' Invoice access HTTP groups passed');
 } finally {
  if (client) await client.close();
  if (child) { child.kill(); await Promise.race([child.closed, pause(5000)]); }
  if (mongo) await mongo.stop();
  if (directory) { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('omf-invoice-access-')); await fsp.rm(directory, { recursive: true, force: true }); }
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

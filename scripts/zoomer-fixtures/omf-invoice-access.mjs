import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 600000;
const run = app => new Promise(resolve => execFile(process.execPath, [path.join(root, 'scripts/finance-invoice-access-integration.cjs')],
 { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', OMF_INVOICE_APP_ROOT: app }, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
 (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, text: stdout + stderr })));
export default {
 name: 'omf-invoice-access',
 covers: ['server/services/companyFinanceReadService.ts', 'server/api/invoices/index.ts', 'server/api/invoices/[id].ts', 'server/api/invoices/[id]/pdf.ts', 'scripts/finance-invoice-access-integration.cjs', 'scripts/zoomer-fixtures/omf-invoice-access.mjs'],
 async run() {
  const app = process.env.OMF_INVOICE_APP_ROOT || root, result = await run(app);
  const groups = Number(result.text.match(/(\d+) Invoice access HTTP groups passed/)?.[1] || 0), mutants = [];
  let pass = result.code === 0 && groups === 8;
  if (pass) {
   const base = path.resolve(root, '.zoomer', 'invoice-mutants'), directory = path.resolve(base, randomUUID());
   if (!directory.startsWith(base + path.sep)) throw Error('Unsafe owned mutant path');
   await mkdir(directory, { recursive: true });
   try {
    await cp(path.join(app, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
    // Nitro numbers index chunks; discover the one actual invoice list rather than pinning index11.
    const api = path.join(directory, '.output/server/chunks/routes/api'), lists = [];
    for (const name of await readdir(api, { recursive: true })) if (name.endsWith('.mjs')) {
     if ((await readFile(path.join(api, name), 'utf8')).includes('return listCompanyInvoices(organizationId, getQuery(event))')) lists.push(name);
    }
    if (lists.length !== 1) throw Error('Expected exactly one built invoice list route');
    const routes = { list: lists[0], detail: 'invoices/_id_.mjs', preview: 'invoices/_id/pdf.mjs', reads: '../../_/companyFinanceReadService.mjs' };
    const specs = [
     ['unscoped-list', 'reads', 'const filter = { organizationId };', 'const filter = {};', 'invoice:list-scope'],
     ['unscoped-detail', 'reads', 'Invoice.findOne({ _id: invoiceId, organizationId })', 'Invoice.findById(invoiceId)', 'invoice:detail-scope'],
     ['unscoped-preview', 'preview', 'Invoice.findOne({ _id: id, organizationId })', 'Invoice.findById(id)', 'invoice:preview-scope'],
     // Keep missing-company rejection intact: the deliberate defect trusts an existing
     // token's selected company but fails to recheck its current membership.
     ...['list', 'detail', 'preview'].map(route => ['trust-token-' + route, route, 'await calendarCompany(event)',
      '(event.context.auth.organizationId ? { organizationId: event.context.auth.organizationId } : await calendarCompany(event))', 'invoice:current-membership'])
    ];
    for (const [name, route, anchor, replacement, assertion] of specs) {
     const file = path.join(api, routes[route]);
     const original = await readFile(file, 'utf8');
     if (original.split(anchor).length !== 2) throw Error('Expected one built route anchor: ' + name);
     try {
      await writeFile(file, original.replace(anchor, replacement)); const r = await run(directory);
      const detected = r.code !== 0 && r.text.includes('AssertionError') && r.text.includes(assertion);
      mutants.push({ name, detected, ...r }); if (!detected) pass = false;
     } finally { await writeFile(file, original); }
    }
   } catch (error) { pass = false; mutants.push({ setupError: String(error.message), detected: false }); }
   finally { await rm(directory, { recursive: true, force: true }); }
  }
  return { pass: pass && mutants.length === 6, databaseCoverage: { executed: result.code === 0, ownedProcess: result.code === 0 },
   message: JSON.stringify({ result, groups, mutants, limits: 'Owned synthetic Mongo/native HTTP only. No model, browser, production records, invoice mutation or sends. All-feature Navi, invoice writes and broader historical/production audit remain open.' }) };
 }
};

// Historical replay for plan omf-aplus-automation-20261013 (plan.replay): every retained Aplus import of the audited
// account (finalized statements and the pending capture), exported read-only into a private hub file with the archived
// bytes, is loaded into an owned ephemeral MongoDB as a comparison snapshot. A separate server account holds one fiscal
// setting; the actual collector query builder and server metadata/parser path process each cold upload. Row identity,
// classification, amounts and review text are compared. A missing manual refund notice is the only named text difference
// allowed; refund review and the fiscal warning must both remain. Run ONLY through the hub verifier (never directly):
//   REPLAY_INPUT=<abs 8-replay-input.json> REPLAY_OUT=<abs 8-replay-result.json> node scripts/zoomer-verify.mjs --run-fixture aplus-collector-replay.mjs --cwd <worktree>
// With REPLAY_INPUT unset (decided at load) it exports covers: [] and passes with the note "no replay input": it then grants
// no coverage of the parser. No business send occurs (plan.replay.sends is empty), and no
// production address is read. Customer text never enters this file or the result: only keys, kinds and amounts are kept.
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 300000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const COMPARED = ['key', 'fingerprint', 'kind', 'amount', 'paymentAmount', 'sourceReviewReason'];
const summary = rows => ({ rowCount: rows.length, kinds: rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {}), amount: rows.reduce((n, r) => n + (r.amount || 0), 0) });

export default {
  name: 'aplus-collector-replay',
  covers: INPUT ? ['shared/aplus.mjs', 'shared/card-import.mjs', 'shared/finance-pending.mjs', 'collector/index.mjs', 'server/services/financeService.ts'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    if (process.env.OMF_APLUS_REPLAY_CHILD !== '1') {
      // Like the route fixture, run the TypeScript service imports from a .mts entry under the project's installed tsx.
      // Node's native .mjs -> .ts loader cannot resolve this project's extensionless TypeScript imports reliably.
      const cache = path.join(REPO_ROOT, '.cache'); await mkdir(cache, { recursive: true });
      const harness = path.join(cache, `aplus-replay-${process.pid}.mts`);
      const source = (await readFile(fileURLToPath(import.meta.url), 'utf8')).replace("const REPO_ROOT = path.resolve(here, '..', '..');", `const REPO_ROOT = ${JSON.stringify(REPO_ROOT)};`).replace('export default {', 'const replay = {') + '\nconsole.log(JSON.stringify({ __aplus_replay__: await replay.run() }));\n';
      await writeFile(harness, source, { flag: 'wx' });
      try {
        const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness], { cwd: REPO_ROOT, windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, OMF_APLUS_REPLAY_CHILD: '1', MONGO_URI: '', MONGODB_URI: '' } });
        const result = stdout.split(/\r?\n/).find(line => line.startsWith('{') && line.includes('__aplus_replay__'));
        if (!result) throw new Error('Historical collector replay produced no result');
        return JSON.parse(result).__aplus_replay__;
      } catch (error) { return { pass: false, message: `Historical collector replay failed: ${String(error.stderr || error.message).slice(-1800)}` };
      } finally { await unlink(harness); }
    }
    const started = Date.now();
    const exported = JSON.parse(await readFile(INPUT, 'utf8'));
    const cases = Array.isArray(exported.rows) ? exported.rows : [];
    const { uploadQuery } = await import(pathToFileURL(path.join(REPO_ROOT, 'collector', 'index.mjs')).href);
    const { parseCardImport } = await import(pathToFileURL(path.join(REPO_ROOT, 'shared', 'card-import.mjs')).href);
    const mongoose = (await import('mongoose')).default;
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const { MongoClient, ObjectId } = await import('mongodb');
    let revision = 'unknown';
    try { revision = (await promisify(execFile)('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
    const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_collector_replay_isolated' } });
    const client = await MongoClient.connect(mongo.getUri('aplus_collector_replay_isolated'));
    process.env.MONGO_URI = mongo.getUri('aplus_collector_replay_isolated');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const results = [], problems = [];
    try {
      await mongoose.connect(process.env.MONGO_URI);
      const { collectorImportMetadata, parseFinanceImport } = await import(pathToFileURL(path.join(REPO_ROOT, 'server/services/financeService.ts')).href);
      const { FinancialAccount } = await import(pathToFileURL(path.join(REPO_ROOT, 'server/models/Finance.ts')).href);
      const db = client.db('aplus_collector_replay_isolated'), imports = db.collection('archived_financeimports');
      // One current server-side setting per account, initialized from the latest owner-selected historical period.
      // Comparison snapshots stay separate from live imports: a cold collector upload cannot borrow its own old metadata.
      const settings = new Map();
      const replayOwner = new ObjectId(); // private export omits the owner's identity; isolation uses a synthetic owner
      for (const row of [...cases].sort((a,b) => String(a.downloadedAt).localeCompare(String(b.downloadedAt)))) if (row.period.fiscalPeriod) settings.set(row.account._id, row.period.fiscalPeriod);
      for (const [accountId, fiscalPeriod] of settings) {
        const row = cases.find(r => r.account._id === accountId);
        await FinancialAccount.create({ ...row.account, _id: accountId, ownerId: replayOwner, name: 'Synthetic replay account', accounting: { fiscalPeriod } });
      }
      // Load each row as production stored it (the exported projection), then replay from the stored document.
      for (const row of cases) {
        const { sourceBase64: _b64, sourceBytes: _bytes, sourceHashVerified: _verified, account, ...stored } = row;
        await imports.insertOne({ ...stored, _id: new ObjectId(row._id), accountId: new ObjectId(account._id) });
      }
      const loaded = await imports.countDocuments();
      for (const row of cases) {
        const id = String(row._id), production = await imports.findOne({ _id: new ObjectId(id) });
        const entry = { id, production: null, replay: null, sends: [], same: false, differences: [] };
        try {
          if (!production) throw new Error('row not loaded');
          const bytes = Buffer.from(row.sourceBase64, 'base64');
          if (sha256(bytes) !== production.hash) throw new Error('archived bytes do not match the stored hash');
          const pending = production.sourceStatus === 'pending';
          const account = await FinancialAccount.findById(row.account._id).lean();
          if (!account) throw new Error('server-side replay account setting missing');
          const manifest = { kind: pending ? 'pending' : 'statement', start: production.period.start, end: production.period.end, ...(pending ? { pageCount: JSON.parse(bytes.toString('utf8')).pageCount } : { statementMonth: production.period.statementMonth, statementTotal: production.reconciliation.statementTotal }) };
          const query = uploadQuery(manifest, { ...account, jobId: 'synthetic-replay-job' });
          if ('fiscalStart' in query || 'fiscalEnd' in query) throw new Error('replay must not supply a manual fiscal period');
          const metadata = await collectorImportMetadata(String(replayOwner), account, bytes, query);
          const parsed = parseFinanceImport(bytes, account, metadata);
          const withoutFiscal = parseCardImport(bytes, account, query);
          entry.withoutFiscalControlMisclassifications = withoutFiscal.rows.filter(r => r.kind === 'expense' && production.rows.some(p => p.line === r.line && p.kind === 'statement_review' && p.sourceReviewReason?.includes('会計期間外'))).length;
          entry.production = { source: pending ? 'pending capture' : 'finalized statement', sourceStatus: production.sourceStatus || 'final', period: production.period.key, ...summary(production.rows) };
          entry.replay = { parserVersion: parsed.parserVersion, period: parsed.period.key, reconciliation: parsed.reconciliation, ...summary(parsed.rows) };
          if (parsed.period.key !== production.period.key) entry.differences.push({ field: 'period', production: production.period.key, replay: parsed.period.key });
          if (parsed.rows.length !== production.rows.length) entry.differences.push({ field: 'rowCount', production: production.rows.length, replay: parsed.rows.length });
          const byLine = new Map(production.rows.map(r => [r.line, r]));
          for (const r of parsed.rows) {
            const p = byLine.get(r.line);
            if (!p) { entry.differences.push({ line: r.line, field: 'line', production: null, replay: r.line }); continue; }
            for (const field of COMPARED) if (p[field] !== r[field]) {
              const expected = field === 'sourceReviewReason' && p.kind === 'credit_review' && r.kind === p.kind && production.reconciliation?.separateRefundTotal > 0 && query.refundTotal === undefined && p[field]?.startsWith('別途返金済みの明細です。') && r[field]?.startsWith('返品・返金の明細です。') && p[field].includes('会計期間外') === r[field].includes('会計期間外');
              entry.differences.push({ line: r.line, field, production: p[field], replay: r[field], ...(expected ? { expected: true, reason: 'The manual import included a separate-refund notice. The collector has no such notice and retains credit review plus the same fiscal-period warning; it does not infer a completed refund.' } : {}) });
            }
          }
          entry.same = entry.differences.length === 0;
        } catch (error) {
          entry.error = String(error?.message || error).split('\n')[0].slice(0, 300);
          problems.push(id + ': ' + entry.error);
        }
        results.push(entry);
      }
      const same = results.filter(r => r.same).length, different = results.filter(r => !r.same && !r.error).length, failed = results.filter(r => r.error).length;
      const expectedDifferent = results.filter(r => !r.same && !r.error && r.differences.every(d => d.expected === true)).length;
      const result = { capturedAt: new Date().toISOString(), input: INPUT, revision, entry: 'uploadQuery -> collectorImportMetadata -> parseFinanceImport', fiscalSettings: settings.size, withoutFiscalControlMisclassifications: results.reduce((n,r) => n + (r.withoutFiscalControlMisclassifications || 0),0), exported: cases.length, loaded, replayed: results.length - failed, same, different, expectedDifferent, unexpectedDifferent: different - expectedDifferent, failed, sends: 0, rows: results };
      if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
      const pass = cases.length > 0 && loaded === cases.length && failed === 0 && different === expectedDifferent;
      return { pass, message: `${cases.length} exported, ${loaded} loaded, ${results.length - failed} replayed on ${revision.slice(0, 8)}: ${same} same, ${different} different (${expectedDifferent} explicitly explained review-text changes), ${failed} not run; 0 sends${OUT ? '; result ' + OUT : ''}${problems.length ? ' — ' + problems.join(' | ').slice(0, 800) : ''} in ${Math.round((Date.now() - started) / 1000)}s` };
    } finally { await import(pathToFileURL(path.join(REPO_ROOT, 'server/services/tokenBlacklistService.ts')).href).then(m => (m.stopCleanup || m.default.stopCleanup)()).catch(() => {}); await mongoose.disconnect(); await client.close(); await mongo.stop(); }
  }
};

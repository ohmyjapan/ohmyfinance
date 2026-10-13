// Historical replay for plan omf-aplus-automation-20261013 (plan.replay): every retained Aplus import of the audited
// account (finalized statements and the pending capture), exported read-only into a private hub file with the archived
// bytes, is loaded into an owned ephemeral MongoDB as production stored it and re-parsed by the changed parser from those
// bytes with the stored metadata; each row's key, fingerprint, kind, amount and payment amount is compared with what
// production recorded. Run ONLY through the hub verifier (never directly):
//   REPLAY_INPUT=<abs 8-replay-input.json> REPLAY_OUT=<abs 8-replay-result.json> node scripts/zoomer-verify.mjs --run-fixture aplus-collector-replay.mjs --cwd <worktree>
// With REPLAY_INPUT unset (decided at load) it exports covers: [] and passes with the note "no replay input": it then grants
// no coverage of the parser. The entry is the pure parser (plan.replay.sends is empty): nothing is sent anywhere and no
// production address is read. Customer text never enters this file or the result: only keys, kinds and amounts are kept.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const timeoutMs = 300000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const INPUT = process.env.REPLAY_INPUT || '';
const OUT = process.env.REPLAY_OUT || '';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const COMPARED = ['key', 'fingerprint', 'kind', 'amount', 'paymentAmount'];
const summary = rows => ({ rowCount: rows.length, kinds: rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {}), amount: rows.reduce((n, r) => n + (r.amount || 0), 0) });

export default {
  name: 'aplus-collector-replay',
  covers: INPUT ? ['shared/aplus.mjs', 'shared/card-import.mjs', 'shared/finance-pending.mjs'] : [],
  async run() {
    if (!INPUT) return { pass: true, message: 'no replay input (REPLAY_INPUT unset): nothing exercised, no coverage claimed' };
    const started = Date.now();
    const exported = JSON.parse(await readFile(INPUT, 'utf8'));
    const cases = Array.isArray(exported.rows) ? exported.rows : [];
    const { parseCardImport } = await import(pathToFileURL(path.join(REPO_ROOT, 'shared', 'card-import.mjs')).href);
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const { MongoClient, ObjectId } = await import('mongodb');
    let revision = 'unknown';
    try { revision = (await promisify(execFile)('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
    const mongo = await MongoMemoryServer.create({ instance: { dbName: 'aplus_collector_replay_isolated' } });
    const client = await MongoClient.connect(mongo.getUri('aplus_collector_replay_isolated'));
    const results = [], problems = [];
    try {
      const db = client.db('aplus_collector_replay_isolated'), imports = db.collection('financeimports');
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
          const metadata = pending ? { kind: 'pending' } : { kind: 'statement', statementMonth: production.period.statementMonth, statementTotal: production.reconciliation.statementTotal, ...(production.reconciliation.separateRefundTotal > 0 ? { refundTotal: production.reconciliation.separateRefundTotal } : {}), ...(production.period.fiscalPeriod ? { fiscalStart: production.period.fiscalPeriod.start, fiscalEnd: production.period.fiscalPeriod.end } : {}) };
          const parsed = parseCardImport(bytes, row.account, metadata);
          entry.production = { source: pending ? 'pending capture' : 'finalized statement', sourceStatus: production.sourceStatus || 'final', period: production.period.key, ...summary(production.rows) };
          entry.replay = { parserVersion: parsed.parserVersion, period: parsed.period.key, reconciliation: parsed.reconciliation, ...summary(parsed.rows) };
          if (parsed.period.key !== production.period.key) entry.differences.push({ field: 'period', production: production.period.key, replay: parsed.period.key });
          if (parsed.rows.length !== production.rows.length) entry.differences.push({ field: 'rowCount', production: production.rows.length, replay: parsed.rows.length });
          const byLine = new Map(production.rows.map(r => [r.line, r]));
          for (const r of parsed.rows) {
            const p = byLine.get(r.line);
            if (!p) { entry.differences.push({ line: r.line, field: 'line', production: null, replay: r.line }); continue; }
            for (const field of COMPARED) if (p[field] !== r[field]) entry.differences.push({ line: r.line, field, production: p[field], replay: r[field] });
          }
          entry.same = entry.differences.length === 0;
        } catch (error) {
          entry.error = String(error?.message || error).split('\n')[0].slice(0, 300);
          problems.push(id + ': ' + entry.error);
        }
        results.push(entry);
      }
      const same = results.filter(r => r.same).length, different = results.filter(r => !r.same && !r.error).length, failed = results.filter(r => r.error).length;
      const result = { capturedAt: new Date().toISOString(), input: INPUT, revision, exported: cases.length, loaded, replayed: results.length - failed, same, different, failed, sends: 0, rows: results };
      if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
      const pass = cases.length > 0 && loaded === cases.length && failed === 0;
      return { pass, message: `${cases.length} exported, ${loaded} loaded, ${results.length - failed} replayed on ${revision.slice(0, 8)}: ${same} same, ${different} different, ${failed} not run; 0 sends${OUT ? '; result ' + OUT : ''}${problems.length ? ' — ' + problems.join(' | ').slice(0, 800) : ''} in ${Math.round((Date.now() - started) / 1000)}s` };
    } finally { await client.close(); await mongo.stop(); }
  }
};

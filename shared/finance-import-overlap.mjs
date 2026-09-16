import { isPending, pendingGroupKey, samePendingPurchases } from './finance-pending.mjs';
// File occurrences are not bank transaction IDs. Reuse an entire matching group;
// never choose one saved draft arbitrarily from identical purchases.
const fail = () => { throw Error('Import source references do not match the original files'); };
const scope = (a, b) => String(a.ownerId) === String(b.ownerId) && String(a.accountId) === String(b.accountId);
const groups = rows => {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.fingerprint)) result.set(row.fingerprint, []);
    result.get(row.fingerprint).push(row);
  }
  return result;
};
const lines = rows => rows.map(r => r.line).sort((a, b) => a - b);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function sourceReferenceGroups(batch) {
  const binding = batch.sourceReferences;
  if (binding === undefined || binding === null) return [];
  if (![1, 2].includes(binding.version) || binding.sourceHash !== batch.hash || !Array.isArray(binding.groups) || binding.groups.length > batch.rows.length) fail();
  const current = groups(batch.rows), seen = new Set(), seenLines = new Set();
  for (const group of binding.groups) {
    const pending = group.match === 'pending_purchase';
    if (group.match !== undefined && (!pending || binding.version !== 2)) fail();
    const rows = pending ? batch.rows.filter(r => pendingGroupKey(batch, r) === group.fingerprint) : current.get(group.fingerprint);
    if (!rows?.length || seen.has(group.fingerprint) || !equal(group.lines, lines(rows))) fail();
    seen.add(group.fingerprint);
    for (const line of group.lines) { if (seenLines.has(line)) fail(); seenLines.add(line); }
    if (!['existing_import', 'source_overlap_review'].includes(group.state) || !Array.isArray(group.targets) || !group.targets.length || group.targets.length > 100) fail();
    const targets = new Set();
    for (const target of group.targets) {
      if (!/^[a-f0-9]{24}$/.test(target.importId) || target.importId === String(batch._id) || targets.has(target.importId) || !/^[a-f0-9]{64}$/.test(target.sourceHash)) fail();
      targets.add(target.importId);
      if (!Array.isArray(target.lines) || !target.lines.length || target.lines.some(n => !Number.isSafeInteger(n) || n < 2) || !equal(target.lines, [...new Set(target.lines)].sort((a, b) => a - b))) fail();
    }
    const exact = group.targets.length === 1 && group.targets[0].lines.length === rows.length;
    if (pending ? group.state === 'existing_import' && !exact : (group.state === 'existing_import') !== exact) fail();
  }
  return binding.groups;
}

export function buildSourceReferences(batch, previous) {
  const pendingGroups = new Map();
  for (const row of batch.rows) { const key = pendingGroupKey(batch, row); if (key && !pendingGroups.has(key)) pendingGroups.set(key, []); }
  for (const prior of previous) {
    if (!scope(batch, prior) || String(prior._id) === String(batch._id) || !(isPending(batch) || isPending(prior))) continue;
    const active = activeImportRows(prior);
    for (const [key, candidates] of pendingGroups) {
      const matching = active.filter(r => pendingGroupKey(prior, r) === key);
      if (matching.length) candidates.push({ prior, rows: matching });
    }
  }
  const pendingReferences = [...pendingGroups].filter(([, candidates]) => candidates.length).map(([fingerprint, candidates]) => {
    const rows = batch.rows.filter(r => pendingGroupKey(batch, r) === fingerprint);
    return { match: 'pending_purchase', fingerprint, lines: lines(rows), state: candidates.length === 1 && samePendingPurchases(rows, candidates[0].rows) ? 'existing_import' : 'source_overlap_review',
      targets: candidates.map(c => ({ importId: String(c.prior._id), sourceHash: c.prior.hash, lines: lines(c.rows) })).sort((a, b) => a.importId.localeCompare(b.importId)) };
  });
  const pendingLines = new Set(pendingReferences.flatMap(g => g.lines));
  const current = groups(batch.rows), candidates = new Map();
  for (const prior of previous) {
    if (!scope(batch, prior) || String(prior._id) === String(batch._id)) continue;
    const inherited = new Set(sourceReferenceGroups(prior).flatMap(g => g.lines));
    for (const [fingerprint, rows] of groups(prior.rows)) {
      if (!current.has(fingerprint) || rows.some(r => inherited.has(r.line)) || current.get(fingerprint).some(r => pendingLines.has(r.line))) continue;
      if (!candidates.has(fingerprint)) candidates.set(fingerprint, []);
      candidates.get(fingerprint).push({ importId: String(prior._id), sourceHash: prior.hash, lines: lines(rows) });
    }
  }
  const result = { version: pendingReferences.length ? 2 : 1, sourceHash: batch.hash, groups: [...pendingReferences, ...[...candidates].map(([fingerprint, targets]) => ({
    fingerprint, lines: lines(current.get(fingerprint)),
    state: targets.length === 1 && targets[0].lines.length === current.get(fingerprint).length ? 'existing_import' : 'source_overlap_review',
    targets: targets.sort((a, b) => a.importId.localeCompare(b.importId))
  }))] };
  sourceReferenceGroups({ ...batch, sourceReferences: result });
  return result;
}

export function verifySourceReferences(batch, targets) {
  const result = sourceReferenceGroups(batch);
  for (const group of result) for (const target of group.targets) {
    const prior = targets.find(b => String(b._id) === target.importId);
    if (!prior || !scope(batch, prior) || prior.hash !== target.sourceHash) fail();
    const pending = group.match === 'pending_purchase';
    const matching = prior.rows.filter(r => pending ? pendingGroupKey(prior, r) === group.fingerprint : r.fingerprint === group.fingerprint);
    if (!equal(target.lines, lines(matching)) || sourceReferenceGroups(prior).some(g => g.lines.some(line => target.lines.includes(line)))) fail();
    if (pending) {
      if (!(isPending(batch) || isPending(prior))) fail();
      const exact = group.targets.length === 1 && samePendingPurchases(batch.rows.filter(r => group.lines.includes(r.line)), matching);
      if ((group.state === 'existing_import') !== exact) fail();
    }
  }
  return result;
}

export function activeImportRows(batch) {
  const excluded = new Set(sourceReferenceGroups(batch).flatMap(g => g.lines));
  return batch.rows.filter(row => !excluded.has(row.line));
}

export function sourceReferenceAt(batch, line) {
  return sourceReferenceGroups(batch).find(group => group.lines.includes(line)) || null;
}

export function purposeEvidence(values, evidence) {
  const conflict = ['purpose', 'customerId'].some(k => evidence[k]?.state === 'conflict');
  const known = values.purpose === 'company' || values.purpose === 'customer' && !!values.customerId;
  const source = evidence.purpose?.source || '', grade = evidence.purpose?.grade || '';
  return { state: conflict ? 'conflict' : !known ? 'unresolved' : grade === 'B' ? 'tentative' : 'supported', source, grade, reason: evidence.purpose?.reason || '' };
}

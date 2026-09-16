import { isPending, isFinalStatement, pendingGroupKey, samePendingPurchases, pendingReviewCandidate } from './finance-pending.mjs';
// File occurrences are not bank transaction IDs. Reuse an entire matching group;
// never choose one saved draft arbitrarily from identical purchases.
const fail = () => { throw Error('Import source references do not match the original files'); };
const scope = (a, b) => String(a.ownerId) === String(b.ownerId) && String(a.accountId) === String(b.accountId);
const groups = (rows, keyFor = row => row.fingerprint) => {
  const result = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
};
const lines = rows => rows.map(r => r.line).sort((a, b) => a - b);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function sourceReferenceGroups(batch) {
  const binding = batch.sourceReferences;
  if (binding === undefined || binding === null) return [];
  if (![1, 2, 3].includes(binding.version) || binding.sourceHash !== batch.hash || !Array.isArray(binding.groups) || binding.groups.length > batch.rows.length) fail();
  const current = groups(batch.rows), seen = new Set(), seenLines = new Set();
  for (const group of binding.groups) {
    const candidate = group.match === 'pending_candidate';
    const pending = group.match === 'pending_purchase' || candidate;
    if (group.match !== undefined && (!pending || binding.version < 2 || candidate && binding.version !== 3)) fail();
    const rows = pending ? batch.rows.filter(r => pendingGroupKey(batch, r) === group.fingerprint) : current.get(group.fingerprint);
    if (!rows?.length || seen.has(group.fingerprint) || !equal(group.lines, lines(rows))) fail();
    seen.add(group.fingerprint);
    for (const line of group.lines) { if (seenLines.has(line)) fail(); seenLines.add(line); }
    if (!['existing_import', 'source_overlap_review'].includes(group.state) || !Array.isArray(group.targets) || !group.targets.length || group.targets.length > 100) fail();
    if (candidate && group.state !== 'source_overlap_review') fail();
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
  previous = previous.filter(prior => scope(batch, prior) && String(prior._id) !== String(batch._id));
  const pendingRows = groups(batch.rows, row => pendingGroupKey(batch, row));
  const pendingGroups = new Map([...pendingRows.keys()].map(key => [key, []]));
  const originals = new Map(previous.map(prior => [prior, activeImportRows(prior)]));
  for (const prior of previous) {
    if (!(isPending(batch) || isPending(prior))) continue;
    for (const [key, matching] of groups(originals.get(prior), row => pendingGroupKey(prior, row))) {
      if (pendingGroups.has(key)) pendingGroups.get(key).push({ prior, rows: matching });
    }
  }
  const pendingReferences = [...pendingGroups].filter(([, candidates]) => candidates.length).map(([fingerprint, candidates]) => {
    const rows = pendingRows.get(fingerprint);
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
  const references = [...pendingReferences, ...[...candidates].map(([fingerprint, targets]) => ({
    fingerprint, lines: lines(current.get(fingerprint)),
    state: targets.length === 1 && targets[0].lines.length === current.get(fingerprint).length ? 'existing_import' : 'source_overlap_review',
    targets: targets.sort((a, b) => a.importId.localeCompare(b.importId))
  }))];
  const matchedLines = new Set(references.flatMap(g => g.lines));
  const claimed = new Set(), settled = new Map(), disputed = new Set();
  const identity = (id, line) => `${id}:${line}`;
  for (const group of references) if (group.state === 'existing_import') for (const target of group.targets) for (const line of target.lines) claimed.add(identity(target.importId, line));
  for (const prior of previous) {
    if (isPending(prior) && isFinalStatement(prior)) for (const row of originals.get(prior)) settled.set(identity(prior._id, row.line), prior.finalization.period);
    for (const group of sourceReferenceGroups(prior)) for (const target of group.targets) for (const line of target.lines) {
      if (group.state === 'source_overlap_review') disputed.add(identity(target.importId, line));
      else if (isFinalStatement(prior)) settled.set(identity(target.importId, line), prior.finalization?.period || prior.period);
    }
  }
  const reviewReferences = [];
  for (const [fingerprint] of pendingGroups) {
    const rows = pendingRows.get(fingerprint);
    if (rows.some(r => matchedLines.has(r.line))) continue;
    const targets = [];
    for (const prior of previous) {
      const matching = originals.get(prior).filter(r => {
        const key = identity(prior._id, r.line);
        if (claimed.has(key)) return false;
        if (isPending(prior) && settled.has(key) && !disputed.has(key)) {
          // A closed forecast can still recur in an older/revised snapshot.
          // Only activity after its confirmed period is independent of it.
          const period = settled.get(key);
          return pendingReviewCandidate({ ...batch, sourceStatus: 'pending' }, { ...rows[0], pendingPaymentMonth: rows[0].pendingPaymentMonth || rows[0].statementMonth }, { ...prior, sourceStatus: undefined, period }, { ...r, statementMonth: period.statementMonth });
        }
        return pendingReviewCandidate(batch, rows[0], prior, r);
      });
      if (matching.length) targets.push({ importId: String(prior._id), sourceHash: prior.hash, lines: lines(matching) });
    }
    if (targets.length) reviewReferences.push({ match: 'pending_candidate', fingerprint, lines: lines(rows), state: 'source_overlap_review', targets: targets.sort((a, b) => a.importId.localeCompare(b.importId)) });
  }
  const result = { version: reviewReferences.length ? 3 : pendingReferences.length ? 2 : 1, sourceHash: batch.hash, groups: [...references, ...reviewReferences] };
  sourceReferenceGroups({ ...batch, sourceReferences: result });
  return result;
}

export function verifySourceReferences(batch, targets) {
  const result = sourceReferenceGroups(batch);
  for (const group of result) for (const target of group.targets) {
    const prior = targets.find(b => String(b._id) === target.importId);
    if (!prior || !scope(batch, prior) || prior.hash !== target.sourceHash) fail();
    if (group.match === 'pending_candidate') {
      const rows = prior.rows.filter(r => target.lines.includes(r.line));
      const current = batch.rows.find(r => group.lines.includes(r.line));
      const keys = new Set(rows.map(r => pendingGroupKey(prior, r)));
      // Preserve complete canonical groups, including repeated equal charges.
      const complete = activeImportRows(prior).filter(r => keys.has(pendingGroupKey(prior, r)));
      if (!equal(target.lines, lines(rows)) || !equal(target.lines, lines(complete)) || rows.some(r => !pendingReviewCandidate(batch, current, prior, r))) fail();
      continue;
    }
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

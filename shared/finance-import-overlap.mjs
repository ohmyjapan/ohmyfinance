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
const sortedLines = v => Array.isArray(v) && v.length > 0 && v.length <= 100 && v.every(n => Number.isSafeInteger(n) && n >= 2) && equal(v, [...new Set(v)].sort((a, b) => a - b));
const sameDecision = (a, b) => !!a && !!b && a.state === b.state && equal(a.lines, b.lines) && equal(a.target || null, b.target || null);

// The owner's decision on a forecast line (plan omf-aplus-reconciliation-resolution-20261104 R1, READBACK B4): `billed` names the rows of
// one finalized statement that are this forecast's bill, `closed` records that no bill is expected. A grouped decision (two identical
// forecasts paired with two statement rows) carries the same record on every one of its lines; a malformed record fails closed like a
// tampered binding. Records live on the pending batch under forecastResolutions.<line>.
export function forecastResolutions(batch) {
  const records = batch.forecastResolutions, result = new Map();
  if (records === undefined || records === null) return result;
  if (typeof records !== 'object' || Array.isArray(records) || !isPending(batch)) fail();
  for (const [key, record] of Object.entries(records)) {
    const line = Number(key), target = record?.target;
    if (!Number.isSafeInteger(line) || line < 2 || !record || typeof record !== 'object' || !['billed', 'closed'].includes(record.state) || !sortedLines(record.lines) || !record.lines.includes(line) || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.at !== 'string' || typeof record.note !== 'string') fail();
    if (record.state === 'billed' ? !target || typeof target !== 'object' || !/^[a-f0-9]{24}$/.test(target.importId) || target.importId === String(batch._id) || !/^[a-f0-9]{64}$/.test(target.sourceHash) || !sortedLines(target.lines) || target.lines.length !== record.lines.length : target !== undefined && target !== null) fail();
    result.set(line, record);
  }
  return result;
}
const resolvedWhere = (prior, predicate) => { const set = new Set(); for (const [line, record] of forecastResolutions(prior)) if (predicate(record)) set.add(line); return set; };

export function sourceReferenceGroups(batch) {
  const binding = batch.sourceReferences;
  if (binding === undefined || binding === null) return [];
  if (![1, 2, 3, 4].includes(binding.version) || binding.sourceHash !== batch.hash || !Array.isArray(binding.groups) || binding.groups.length > batch.rows.length) fail();
  const current = groups(batch.rows), seen = new Set(), seenLines = new Set();
  for (const group of binding.groups) {
    const candidate = group.match === 'pending_candidate', resolution = group.match === 'pending_resolution';
    const pending = group.match === 'pending_purchase' || candidate || resolution;
    if (group.match !== undefined && (!pending || binding.version < 2 || candidate && binding.version < 3 || resolution && binding.version !== 4)) fail();
    // A resolution group names its rows explicitly: the owner may pair one of two identical forecasts.
    const rows = resolution ? batch.rows.filter(r => group.lines.includes(r.line)) : pending ? batch.rows.filter(r => pendingGroupKey(batch, r) === group.fingerprint) : current.get(group.fingerprint);
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
    if (resolution ? group.state !== 'existing_import' || !exact : pending ? group.state === 'existing_import' && !exact : (group.state === 'existing_import') !== exact) fail();
  }
  return binding.groups;
}

// `previous` are the imports this batch may reference (the earlier ones); `history` is everything known about the account, including
// statements imported later, whose exact groups settle a forecast for every other statement (S1). At import time both are the stored
// account history; the creation-order rebuild passes the rebuilt earlier batches and the whole history.
export function buildSourceReferences(batch, previous, history = previous) {
  const others = list => list.filter(prior => scope(batch, prior) && String(prior._id) !== String(batch._id));
  previous = others(previous); history = others(history);
  const originals = new Map(previous.map(prior => [prior, activeImportRows(prior)]));
  const identity = (id, line) => `${id}:${line}`;
  // Lines a finalized statement settled exactly, from the whole history: which statement did it, and its period for the recurrence rule.
  const settled = new Map(), settle = (key, period, by) => { const entry = settled.get(key) || { period, by: new Set() }; entry.by.add(by); settled.set(key, entry); };
  for (const prior of history) {
    if (isPending(prior) && isFinalStatement(prior)) for (const row of activeImportRows(prior)) settle(identity(prior._id, row.line), prior.finalization.period, String(prior._id));
    if (isFinalStatement(prior)) for (const group of sourceReferenceGroups(prior)) if (group.state === 'existing_import') for (const target of group.targets) for (const line of target.lines) settle(identity(target.importId, line), prior.finalization?.period || prior.period, String(prior._id));
  }
  // R1(b): the owner's billed decisions whose target is this statement become exact reference groups, ahead of every automatic rule. A
  // decision that no longer fits (rows gone, cards differ, the forecast settled exactly by another statement, rows already taken) binds
  // nothing; the rebuild report lists it as stale.
  const resolutionReferences = [], resolvedRows = new Set();
  if (!isPending(batch)) for (const prior of previous) {
    if (!isPending(prior)) continue;
    const records = forecastResolutions(prior), active = new Set(originals.get(prior).map(r => r.line)), seen = new Set();
    for (const record of records.values()) {
      if (record.state !== 'billed' || record.target.importId !== String(batch._id) || record.target.sourceHash !== batch.hash) continue;
      const key = record.lines.join(','); if (seen.has(key)) continue; seen.add(key);
      const forecast = record.lines.map(line => prior.rows.find(r => r.line === line)), rows = record.target.lines.map(line => batch.rows.find(r => r.line === line));
      const stale = !record.lines.every(line => sameDecision(records.get(line), record) && active.has(line) && ![...(settled.get(identity(prior._id, line))?.by || [])].some(id => id !== String(batch._id)))
        || forecast.some(r => !r || r.kind !== 'expense') || rows.some(r => !r || r.kind !== 'expense' || resolvedRows.has(r.line)) || forecast.some((r, i) => r.cardIdentifier !== rows[i].cardIdentifier);
      if (stale) continue;
      for (const r of rows) resolvedRows.add(r.line);
      resolutionReferences.push({ match: 'pending_resolution', fingerprint: `resolution:${prior._id}:${key}`, lines: lines(rows), state: 'existing_import', targets: [{ importId: String(prior._id), sourceHash: prior.hash, lines: lines(forecast) }] });
    }
  }
  const free = batch.rows.filter(r => !resolvedRows.has(r.line));
  const pendingRows = groups(free, row => pendingGroupKey(batch, row));
  const pendingGroups = new Map([...pendingRows.keys()].map(key => [key, []]));
  // A forecast the owner billed as another statement's rows is consumed: no statement matches it again, neither through the pending
  // groups nor through the Amex fingerprint (shared by a snapshot row and its statement row). A repeated snapshot still references it.
  const consumed = new Map(previous.map(prior => [prior, isPending(batch) ? new Set() : resolvedWhere(prior, record => record.state === 'billed')]));
  for (const prior of previous) {
    if (!(isPending(batch) || isPending(prior))) continue;
    for (const [key, matching] of groups(originals.get(prior).filter(r => !consumed.get(prior).has(r.line)), row => pendingGroupKey(prior, row))) {
      if (pendingGroups.has(key)) pendingGroups.get(key).push({ prior, rows: matching });
    }
  }
  const pendingReferences = [...pendingGroups].filter(([, candidates]) => candidates.length).map(([fingerprint, candidates]) => {
    const rows = pendingRows.get(fingerprint), exact = list => list.length === 1 && samePendingPurchases(rows, list[0].rows);
    // READBACK B1: a closed forecast binds a statement only exactly (the exact bill outranks and supersedes the record); otherwise it holds
    // nothing, so the statement's rows are compared with the forecasts the owner left open.
    if (!isPending(batch) && !exact(candidates)) {
      candidates = candidates.map(c => { const closed = resolvedWhere(c.prior, record => record.state === 'closed'), kept = c.rows.filter(r => !closed.has(r.line)); return kept.length ? { prior: c.prior, rows: kept } : null; }).filter(Boolean);
      if (!candidates.length) return null;
    }
    return { match: 'pending_purchase', fingerprint, lines: lines(rows), state: exact(candidates) ? 'existing_import' : 'source_overlap_review',
      targets: candidates.map(c => ({ importId: String(c.prior._id), sourceHash: c.prior.hash, lines: lines(c.rows) })).sort((a, b) => a.importId.localeCompare(b.importId)) };
  }).filter(Boolean);
  const pendingLines = new Set(pendingReferences.flatMap(g => g.lines));
  const current = groups(free), candidates = new Map();
  for (const prior of previous) {
    if (!scope(batch, prior) || String(prior._id) === String(batch._id)) continue;
    const inherited = new Set(sourceReferenceGroups(prior).flatMap(g => g.lines));
    for (const [fingerprint, rows] of groups(prior.rows)) {
      if (!current.has(fingerprint) || rows.some(r => inherited.has(r.line) || consumed.get(prior).has(r.line)) || current.get(fingerprint).some(r => pendingLines.has(r.line))) continue;
      if (!candidates.has(fingerprint)) candidates.set(fingerprint, []);
      candidates.get(fingerprint).push({ importId: String(prior._id), sourceHash: prior.hash, lines: lines(rows) });
    }
  }
  const references = [...resolutionReferences, ...pendingReferences, ...[...candidates].map(([fingerprint, targets]) => ({
    fingerprint, lines: lines(current.get(fingerprint)),
    state: targets.length === 1 && targets[0].lines.length === current.get(fingerprint).length ? 'existing_import' : 'source_overlap_review',
    targets: targets.sort((a, b) => a.importId.localeCompare(b.importId))
  }))];
  const matchedLines = new Set(references.flatMap(g => g.lines));
  const claimed = new Set();
  for (const group of references) if (group.state === 'existing_import') for (const target of group.targets) for (const line of target.lines) claimed.add(identity(target.importId, line));
  // A resolved forecast (billed or closed) is never a candidate target again: the owner's decision released its holds.
  for (const prior of previous) for (const [line] of forecastResolutions(prior)) claimed.add(identity(prior._id, line));
  const reviewReferences = [];
  for (const [fingerprint] of pendingGroups) {
    const rows = pendingRows.get(fingerprint);
    if (rows.some(r => matchedLines.has(r.line))) continue;
    const targets = [];
    for (const prior of previous) {
      const matching = originals.get(prior).filter(r => {
        const key = identity(prior._id, r.line);
        if (claimed.has(key)) return false;
        if (isPending(prior) && settled.has(key)) {
          // A forecast a statement billed exactly is settled for every other statement. A closed forecast
          // can still recur in an older/revised snapshot; only activity after its confirmed period is independent of it.
          if (!isPending(batch)) return false;
          const { period } = settled.get(key);
          return pendingReviewCandidate({ ...batch, sourceStatus: 'pending' }, { ...rows[0], pendingPaymentMonth: rows[0].pendingPaymentMonth || rows[0].statementMonth }, { ...prior, sourceStatus: undefined, period }, { ...r, statementMonth: period.statementMonth });
        }
        // A statement whose coverage closed before the forecast's purchase date cannot be its bill (Aplus period.end is the month end,
        // Amex the processing range; a statement row dated after its coverage is refused at import, so an exact match is never dropped here).
        if (!isPending(batch) && isPending(prior) && batch.period?.end && batch.period.end < r.purchaseDate) return false;
        return pendingReviewCandidate(batch, rows[0], prior, r);
      });
      if (matching.length) targets.push({ importId: String(prior._id), sourceHash: prior.hash, lines: lines(matching) });
    }
    if (targets.length) reviewReferences.push({ match: 'pending_candidate', fingerprint, lines: lines(rows), state: 'source_overlap_review', targets: targets.sort((a, b) => a.importId.localeCompare(b.importId)) });
  }
  const result = { version: resolutionReferences.length ? 4 : reviewReferences.length ? 3 : pendingReferences.length ? 2 : 1, sourceHash: batch.hash, groups: [...references, ...reviewReferences] };
  sourceReferenceGroups({ ...batch, sourceReferences: result });
  return result;
}

export function verifySourceReferences(batch, targets) {
  const result = sourceReferenceGroups(batch);
  for (const group of result) for (const target of group.targets) {
    const prior = targets.find(b => String(b._id) === target.importId);
    if (!prior || !scope(batch, prior) || prior.hash !== target.sourceHash) fail();
    const resolved = forecastResolutions(prior), billed = line => resolved.get(line)?.state === 'billed';
    // A complete canonical group is accepted with or without the prior's resolved lines: the binding written before a resolution and
    // the one rebuilt after it both verify, so no write order can brick the account's reads.
    const complete = (full, chosen) => equal(chosen, lines(full)) || equal(chosen, lines(full.filter(r => !billed(r.line)))) || equal(chosen, lines(full.filter(r => !resolved.has(r.line))));
    if (group.match === 'pending_resolution') {
      if (isPending(batch) || !isPending(prior)) fail();
      const rows = batch.rows.filter(r => group.lines.includes(r.line)), forecast = prior.rows.filter(r => target.lines.includes(r.line));
      if (rows.length !== group.lines.length || forecast.length !== target.lines.length || rows.length !== forecast.length) fail();
      for (const line of target.lines) { const record = resolved.get(line); if (!record || record.state !== 'billed' || record.target.importId !== String(batch._id) || record.target.sourceHash !== batch.hash || !equal(record.target.lines, group.lines) || !equal(record.lines, target.lines)) fail(); }
      if ([...rows, ...forecast].some(r => r.kind !== 'expense') || rows.some((r, i) => r.cardIdentifier !== forecast[i].cardIdentifier) || sourceReferenceGroups(prior).some(g => g.lines.some(line => target.lines.includes(line)))) fail();
      continue;
    }
    if (group.match === 'pending_candidate') {
      const rows = prior.rows.filter(r => target.lines.includes(r.line));
      const current = batch.rows.find(r => group.lines.includes(r.line));
      const keys = new Set(rows.map(r => pendingGroupKey(prior, r)));
      // Preserve complete canonical groups, including repeated equal charges.
      const whole = activeImportRows(prior).filter(r => keys.has(pendingGroupKey(prior, r)));
      if (!equal(target.lines, lines(rows)) || !complete(whole, target.lines) || rows.some(r => !pendingReviewCandidate(batch, current, prior, r))) fail();
      continue;
    }
    const pending = group.match === 'pending_purchase';
    const matching = prior.rows.filter(r => pending ? pendingGroupKey(prior, r) === group.fingerprint : r.fingerprint === group.fingerprint);
    if (!(pending ? complete(matching, target.lines) : equal(target.lines, lines(matching))) || sourceReferenceGroups(prior).some(g => g.lines.some(line => target.lines.includes(line)))) fail();
    if (pending) {
      if (!(isPending(batch) || isPending(prior))) fail();
      const exact = group.targets.length === 1 && samePendingPurchases(batch.rows.filter(r => group.lines.includes(r.line)), prior.rows.filter(r => target.lines.includes(r.line)));
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

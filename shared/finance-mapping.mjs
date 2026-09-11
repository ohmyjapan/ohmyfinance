// A preview is bound to the immutable CSV, including each repeated occurrence.
// It deliberately contains external client/category labels, not ledger IDs.
export function mappingRows(batch) {
  const preview = batch.mappingPreview;
  const mappings = new Map();
  if (preview) {
    if (preview.version !== 1 || preview.sourceHash !== batch.hash || !Array.isArray(preview.rows) || preview.rows.length !== batch.rows.length) throw Error('Mapping source does not match this import');
    const source = new Map(batch.rows.map(row => [row.line, row]));
    for (const item of preview.rows) {
      const row = source.get(item.line);
      if (!row || row.key !== item.key || mappings.has(item.line)) throw Error('Mapping row does not match this import');
      if (!['customer', 'company', 'unresolved', 'repayment', 'credit_review'].includes(item.purpose)) throw Error('Invalid mapping purpose');
      if (row.kind !== 'expense' && item.purpose !== row.kind) throw Error('Repayments and credits cannot be mapped as spending');
      if (row.kind === 'expense' && ['repayment', 'credit_review'].includes(item.purpose)) throw Error('Spending cannot be mapped as a repayment or credit');
      for (const field of ['clientCode', 'clientName', 'category', 'reason']) if (typeof item[field] !== 'string' || item[field].length > 1000) throw Error('Invalid mapping label');
      if (item.purpose !== 'customer' && (item.clientCode || item.clientName)) throw Error('Only customer purchases can have a client');
      if (row.kind !== 'expense' && item.category) throw Error('Repayments and credits cannot have an expense category');
      if (item.source) {
        for (const field of ['sheet', 'client', 'category', 'card']) if (typeof item.source[field] !== 'string' || item.source[field].length > 1000) throw Error('Invalid mapping evidence');
        if (!Array.isArray(item.source.rows) || !item.source.rows.length || item.source.rows.length > 5000 || item.source.rows.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(item.source.rows).size !== item.source.rows.length) throw Error('Invalid source row references');
      }
      mappings.set(item.line, item);
    }
  }
  return batch.rows.map(row => {
    const item = mappings.get(row.line);
    const purpose = item?.purpose || (row.kind === 'expense' ? 'unresolved' : row.kind);
    const clientCode = item?.clientCode || '', clientName = item?.clientName || '', category = item?.category || '';
    const status = row.kind !== 'expense' ? row.kind : purpose === 'unresolved' || (purpose === 'customer' && !clientCode) ? 'needs_client' : !category ? 'needs_category' : 'proposed';
    return {
      line: row.line, key: row.key, purchaseDate: row.purchaseDate, processingDate: row.processingDate,
      description: row.description, amount: row.amount, cardLast4: row.cardIdentifier.slice(-4),
      purpose, clientCode, clientName, category, status, reason: item?.reason || '',
      source: item?.source ? { sheet: item.source.sheet, rows: item.source.rows, client: item.source.client, category: item.source.category, card: item.source.card } : null
    };
  });
}

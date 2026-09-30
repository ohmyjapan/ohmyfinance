const test = require('node:test'), assert = require('node:assert/strict');
const wizard = require('./helpers/transaction-import.cjs');
const mappings = { Paid: { field: 'amount', format: 'currency_jpy' }, Day: { field: 'date', format: 'date_iso' }, Item: { field: 'notes', format: 'text' } };
const rows = [{ Paid: '79,200', Day: '2026-09-22', Item: 'Synthetic purchase' }];
function upload(flow, data = rows) {
  flow.page.handleFilesSelected([{ name: 'synthetic.csv', size: 100, type: 'text/csv', isValid: true, file: {}, rowCount: data.length, data: structuredClone(data) }]);
  flow.page.updateMappings(structuredClone(mappings));
}
test('entering preview mounts and publishes rows and validation without a refresh', t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [...rows, { Paid: 'invalid', Day: '2026-09-22', Item: 'Bad amount' }]);
  const preview = flow.preview();
  assert.equal(preview.previewData.value.length, 2);
  assert.deepEqual(flow.page.importStats.value, { totalRecords: 2, validRecords: 1, warningRecords: 0, invalidRecords: 1 });
});
test('numeric supplier and customer cells reuse the textual records found by preview', async t => {
  const flow = wizard({ suppliers: [{ name: '123', _id: 'existing-supplier' }], customers: [{ name: '456', _id: 'existing-customer' }] }); t.after(flow.close);
  upload(flow, [{ ...rows[0], Seller: 123, Buyer: 456 }]);
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' }, Buyer: { field: 'customerName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(preview.newEntities.value, { newSuppliers: [], newCustomers: [] });
  await flow.page.performImport();
  assert.equal(flow.writes.length, 1);
  assert.deepEqual(flow.catalogWrites, { suppliers: [], customers: [] });
  assert.equal(flow.writes[0].supplierId, 'existing-supplier');
  assert.equal(flow.writes[0].customerId, 'existing-customer');
});
test('new numeric and textual names share one created record within a batch', async t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [{ ...rows[0], Seller: 123, Buyer: 456 }, { ...rows[0], Seller: '123', Buyer: '456' }]);
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' }, Buyer: { field: 'customerName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(preview.newEntities.value, { newSuppliers: ['123'], newCustomers: ['456'] });
  await flow.page.performImport();
  assert.equal(flow.writes.length, 2);
  assert.deepEqual(flow.catalogWrites, { suppliers: [{ name: '123', isActive: true }], customers: [{ name: '456', isActive: true }] });
  assert.equal(flow.writes[0].supplierId, flow.writes[1].supplierId);
  assert.equal(flow.writes[0].customerId, flow.writes[1].customerId);
});
test('missing names keep the existing no-create behavior', async t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [null, '', 0, false].map(value => ({ ...rows[0], Seller: value, Buyer: value })));
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' }, Buyer: { field: 'customerName', format: 'text' } });
  flow.preview(); await flow.page.performImport();
  assert.equal(flow.writes.length, 4);
  assert.deepEqual(flow.catalogWrites, { suppliers: [], customers: [] });
});
test('preview importable counts match server acceptance regardless of field order', async t => {
  const data = [
    { Paid: 1200, Day: '2026-09-22', Item: 'Valid', Kind: '支出' },
    { Paid: 'bad', Day: '2026-09-22', Item: 'Bad amount', Kind: '支出' },
    { Paid: 'bad', Day: 'bad', Item: 'Both invalid', Kind: '支出' },
    { Paid: 1200, Day: 'bad', Item: 'Bad date', Kind: '支出' },
    { Paid: 1200, Day: '', Item: 'Empty date', Kind: '支出' },
    { Paid: 1200, Day: '2000-01-01', Item: 'Old date', Kind: '支出' },
    { Paid: 'bad', Day: '2000-01-01', Item: 'Old with bad amount', Kind: 'unknown' },
    { Paid: 1200, Day: '2026-09-22', Item: 'Coerced type', Kind: 'unknown' }
  ];
  for (const reverse of [false, true]) {
    const flow = wizard(); t.after(flow.close); upload(flow, data);
    const entries = Object.entries({ ...mappings, Kind: { field: 'type', format: 'text' } });
    flow.page.updateMappings(Object.fromEntries(reverse ? entries.reverse() : entries));
    const preview = flow.preview();
    assert.deepEqual(preview.previewData.value.map(row => row._status), ['valid', 'invalid', 'invalid', 'invalid', 'warning', 'warning', 'invalid', 'warning']);
    await flow.page.performImport();
    assert.equal(flow.page.importStats.value.validRecords + flow.page.importStats.value.warningRecords, flow.writes.length);
    assert.equal(flow.writes.length, 4);
    assert.deepEqual(flow.writes.map(row => row.notes), ['Valid', 'Empty date', 'Old date', 'Coerced type']);
    assert.equal(flow.page.importResult.value.results.errors.length, 4);
  }
});
test('refresh preserves original columns and reproduces the same preview', async t => {
  const flow = wizard(); t.after(flow.close); upload(flow);
  const preview = flow.preview(); await preview.processData();
  const first = structuredClone(require('vue').toRaw(preview.previewData.value));
  await preview.processData();
  assert.deepEqual(preview.previewData.value, first);
  assert.deepEqual(flow.raw(), rows);
});
test('back to mapping and a new preview use the original source columns', async t => {
  const flow = wizard(); t.after(flow.close); upload(flow);
  await flow.preview().processData();
  flow.page.updateMappings({ ...mappings, Item: { field: 'productName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.equal(preview.previewData.value[0].amount, '79,200');
  assert.equal(preview.previewData.value[0].productName, 'Synthetic purchase');
  assert.equal(preview.previewData.value[0].notes, undefined);
});
test('the real import handler receives raw columns and maps exactly once', async t => {
  const flow = wizard(); t.after(flow.close); upload(flow);
  await flow.preview().processData(); await flow.page.performImport();
  assert.equal(flow.page.importResult.value.results.imported, 1);
  assert.equal(flow.writes[0].amount, 79200);
  assert.equal(flow.writes[0].date.toISOString().slice(0, 10), '2026-09-22');
  assert.equal(flow.writes[0].notes, 'Synthetic purchase');
  assert.deepEqual(flow.requests.find(request => request.url === '/api/transactions/import').body.data, rows);
});
test('confirmation statistics reflect mapped validation, including invalid amounts', async t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [...rows, { Paid: 'invalid', Day: '2026-09-22', Item: 'Bad amount' }]);
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(flow.page.importStats.value, preview.stats.value);
  assert.equal(flow.page.importStats.value.invalidRecords, 1);
});
test('entity preview sends the current authentication and textual names', async t => {
  const flow = wizard({ entityFetch: async options => {
    assert.equal(options.headers?.Authorization, 'Bearer synthetic-import-fixture');
    assert.deepEqual(options.body.supplierNames, ['123']);
    return { newSuppliers: ['123'], newCustomers: [] };
  } }); t.after(flow.close);
  upload(flow, [{ ...rows[0], Seller: 123 }]);
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(preview.newEntities.value.newSuppliers, ['123']);
});
test('slow entity lookup does not delay confirmation stats or replace reset source', async t => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const flow = wizard({ entityFetch: () => pending }); t.after(flow.close);
  upload(flow, [{ ...rows[0], Seller: 'Synthetic seller' }]);
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' } });
  const preview = flow.preview(), work = preview.processData();
  assert.equal(flow.page.importStats.value.validRecords, 1);
  flow.page.resetWizard(); resolve({ newSuppliers: ['Synthetic seller'], newCustomers: [] }); await work;
  assert.deepEqual(flow.raw(), []);
  assert.equal(flow.page.importStats.value.totalRecords, 0);
});

test('identity mappings and multiple files still import every source row', async t => {
  const flow = wizard(); t.after(flow.close);
  const data = [{ amount: 1200, date: '2026-09-22', notes: 'First file' }, { amount: 3400, date: '2026-09-23', notes: 'Second file' }];
  flow.page.handleFilesSelected(data.map((row, index) => ({ name: `fixture-${index}.csv`, size: 1, type: 'text/csv', isValid: true, file: {}, data: [row] })));
  flow.page.updateMappings(Object.fromEntries(['amount', 'date', 'notes'].map(field => [field, { field, format: 'text' }])));
  const preview = flow.preview(); await preview.processData(); await preview.processData();
  await flow.page.performImport();
  assert.deepEqual(flow.writes.map(row => row.amount), [1200, 3400]);
  assert.deepEqual(flow.writes.map(row => row.notes), ['First file', 'Second file']);
  assert.equal(flow.page.importStats.value.validRecords, 2);
});

test('failed entity lookup preserves source, stats and the import payload', async t => {
  const flow = wizard({ entityFetch: async () => { throw Error('Synthetic lookup failure'); } }); t.after(flow.close);
  const data = [{ ...rows[0], Seller: 'Synthetic seller' }]; upload(flow, data);
  flow.page.updateMappings({ ...mappings, Seller: { field: 'supplierName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.equal(flow.page.importStats.value.validRecords, 1); assert.deepEqual(flow.raw(), data);
  await flow.page.performImport(); assert.equal(flow.writes.length, 1);
});

test('starting another import clears the previous source and preview counts', async t => {
  const flow = wizard(); t.after(flow.close); upload(flow); await flow.preview().processData();
  flow.page.resetWizard();
  assert.deepEqual(flow.raw(), []); assert.equal(flow.page.importStats.value.totalRecords, 0);
  upload(flow, [{ Paid: 1234, Day: '2026-09-24', Item: 'Replacement' }]);
  await flow.preview().processData(); await flow.page.performImport();
  assert.equal(flow.writes[0].amount, 1234); assert.equal(flow.writes[0].notes, 'Replacement');
});

test('typed date conversion retains JavaScript primitive and array behavior', t => {
  const flow = wizard(); t.after(flow.close); const preview = flow.preview();
  const values = [undefined, null, false, true, '', '2026-09-22', '2026/09/22', 'invalid', '0', 0, 1, -1, 1234.5, NaN, Infinity, [], ['invalid_date']];
  for (const value of values) {
    assert.equal(preview.previewDate(value).getTime(), new Date(value).getTime(), String(value));
    assert.equal(preview.formatDate(value), new Date(value).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' }));
  }
});

test('numeric range inputs and nontext status cells render without throwing', async t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [{ Paid: 100, Day: '2026-09-22', Item: 'Low' }, { Paid: 200, Day: '2026-09-22', Item: 'High' }]);
  const preview = flow.preview(); await preview.processData();
  preview.filter.value.minAmount = 150; preview.filter.value.maxAmount = 250;
  assert.equal(preview.filteredData.value.length, 1); assert.equal(preview.filteredData.value[0].amount, 200);
  assert.doesNotThrow(() => preview.getStatusClass(123)); assert.doesNotThrow(() => preview.getStatusClass(true));
});

test('comma amounts retain their full value in display and range filtering', t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [
    { ...rows[0], Item: 'Formatted' }, { ...rows[0], Paid: 79200, Item: 'Numeric' },
    { ...rows[0], Paid: '1,200', Item: 'Small' }, { ...rows[0], Paid: '-3,500', Item: 'Refund' },
    { ...rows[0], Paid: 'bad', Item: 'Invalid' }
  ]);
  const preview = flow.preview();
  assert.match(preview.formatFieldValue('amount', '79,200'), /[¥￥]79,200/);
  assert.equal(preview.formatCurrency('79,200'), preview.formatCurrency(79200));
  assert.match(preview.formatCurrency('-3,500'), /-[¥￥]3,500/);
  assert.match(preview.formatCurrency(0), /[¥￥]0/);
  assert.equal(preview.formatCurrency('bad'), 'bad');
  preview.filter.value.minAmount = 79000; preview.filter.value.maxAmount = 80000;
  assert.deepEqual(preview.filteredData.value.map(row => row.notes), ['Formatted', 'Numeric']);
  preview.filter.value.minAmount = '1,000'; preview.filter.value.maxAmount = '2,000';
  assert.deepEqual(preview.filteredData.value.map(row => row.notes), ['Small']);
  preview.filter.value.minAmount = ''; preview.filter.value.maxAmount = 0;
  assert.deepEqual(preview.filteredData.value.map(row => row.notes), ['Refund']);
});

test('duplicate date mappings validate only the final defined value in either order', async t => {
  const data = [
    { Paid: 100, DayA: 'bad', DayB: '2026-09-22', Item: 'Corrected' },
    { Paid: 200, DayA: '2026-09-22', DayB: 'bad', Item: 'Invalid final' },
    { Paid: 300, DayA: '2000-01-01', DayB: '2026-09-22', Item: 'Old replaced' },
    { Paid: 400, DayA: '2026-09-22', DayB: '', Item: 'Blank final' },
    { Paid: 500, DayA: '2026-09-22', DayB: null, Item: 'Null final' },
    { Paid: 600, DayA: '2026-09-22', Item: 'Absent override' },
    { Paid: 700, DayA: 'bad', Item: 'Absent with bad original' },
    { Paid: 800, Item: 'Both absent' }
  ];
  for (const reverse of [false, true]) {
    const flow = wizard(); t.after(flow.close); upload(flow, data);
    const dates = [['DayA', { field: 'date', format: 'text' }], ['DayB', { field: 'date', format: 'text' }]];
    flow.page.updateMappings({ Paid: mappings.Paid, ...Object.fromEntries(reverse ? dates.reverse() : dates), Item: mappings.Item });
    const preview = flow.preview();
    assert.deepEqual(preview.previewData.value.map(row => row._status), reverse
      ? ['invalid', 'valid', 'warning', 'valid', 'valid', 'valid', 'invalid', 'warning']
      : ['valid', 'invalid', 'valid', 'warning', 'warning', 'valid', 'invalid', 'warning']);
    assert.equal(preview.validationIssues.value.invalidDates, reverse ? 3 : 5);
    assert.equal(preview.validationIssues.value.outOfRangeDates, reverse ? 1 : 0);
    await flow.page.performImport();
    assert.deepEqual(flow.writes.map(row => row.notes), preview.previewData.value.filter(row => row._status !== 'invalid').map(row => row.notes));
    assert.equal(flow.page.importStats.value.validRecords + flow.page.importStats.value.warningRecords, flow.writes.length);
    assert.equal(flow.writes.length, 6);
    const date = flow.writes.find(row => row.notes === 'Absent override').date;
    assert.equal(date.toISOString().slice(0, 10), '2026-09-22');
    assert.deepEqual(flow.raw(), data);
  }
});

test('duplicate amounts and types use final values without retaining overwritten issues', async t => {
  const flow = wizard(); t.after(flow.close);
  upload(flow, [
    { PaidA: 'bad', PaidB: '79,200', Day: '2026-09-22', KindA: 'unknown', KindB: '支出', Item: 'Corrected' },
    { PaidA: 1200, PaidB: 'bad', Day: '2026-09-22', KindA: '支出', KindB: '入金', Item: 'Invalid final' },
    { PaidA: 2300, Day: '2026-09-22', KindA: '支出', Item: 'Absent override' },
    { PaidA: 1200, PaidB: 0, Day: '2026-09-22', Item: 'Zero final' },
    { Day: '2026-09-22', Item: 'Both amounts absent' }
  ]);
  flow.page.updateMappings({ PaidA: mappings.Paid, PaidB: mappings.Paid, Day: mappings.Day, KindA: { field: 'type', format: 'text' }, KindB: { field: 'type', format: 'text' }, Item: mappings.Item });
  const preview = flow.preview();
  assert.deepEqual(preview.previewData.value.map(row => row._status), ['valid', 'invalid', 'valid', 'invalid', 'invalid']);
  assert.equal(preview.validationIssues.value.invalidAmounts, 3);
  assert.equal(preview.validationIssues.value.invalidTypes, 0);
  await flow.page.performImport();
  assert.deepEqual(flow.writes.map(row => row.amount), [79200, 2300]);
  assert.deepEqual(flow.writes.map(row => row.notes), ['Corrected', 'Absent override']);
});

test('entity hints use the resolved names when multiple columns target one entity', async t => {
  const flow = wizard({ suppliers: [{ name: '123', _id: 'existing-supplier' }], customers: [{ name: '456', _id: 'existing-customer' }] }); t.after(flow.close);
  upload(flow, [
    { ...rows[0], SellerA: 'Superseded seller', SellerB: 123, BuyerA: 'Superseded buyer', BuyerB: 456 },
    { ...rows[0], SellerA: '123', BuyerA: '456', Item: 'Absent overrides' },
    { ...rows[0], SellerA: 'Superseded seller', SellerB: '', BuyerA: 'Superseded buyer', BuyerB: null, Item: 'Empty overrides' }
  ]);
  flow.page.updateMappings({ ...mappings, SellerA: { field: 'supplierName', format: 'text' }, SellerB: { field: 'supplierName', format: 'text' }, BuyerA: { field: 'customerName', format: 'text' }, BuyerB: { field: 'customerName', format: 'text' } });
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(flow.requests.find(request => request.url === '/api/transactions/import-preview').body, { supplierNames: ['123'], customerNames: ['456'] });
  assert.deepEqual(preview.newEntities.value, { newSuppliers: [], newCustomers: [] });
  await flow.page.performImport();
  assert.equal(flow.writes.length, 3);
  assert.deepEqual(flow.writes.map(row => row.supplierId), ['existing-supplier', 'existing-supplier', null]);
  assert.deepEqual(flow.writes.map(row => row.customerId), ['existing-customer', 'existing-customer', null]);
  assert.deepEqual(flow.catalogWrites, { suppliers: [], customers: [] });
});

test('omitted or ignored amount mappings count every row invalid and recover after remapping', async t => {
  const data = [
    { Paid: '79,200', Day: '2026-09-22', Item: 'Valid date', amount: 999 },
    { Paid: 2300, Day: '', Item: 'Missing date', amount: 999 },
    { Paid: 3400, Day: '2000-01-01', Item: 'Old date', amount: 999 }
  ];
  const incomplete = [
    { Day: mappings.Day, Item: mappings.Item },
    { ...mappings, Paid: { field: '', format: 'text' } },
    { ...mappings, Paid: { field: 'null', format: 'text' } },
    { Paid: { field: 'productPrice', format: 'number' }, Day: mappings.Day, Item: mappings.Item },
    { Paid: { field: '', format: 'text' } }
  ];
  for (const mapping of incomplete) {
    const flow = wizard(); t.after(flow.close); upload(flow, data); flow.page.updateMappings(mapping);
    const preview = flow.preview(); await preview.processData();
    assert.deepEqual(flow.page.importStats.value, { totalRecords: 3, validRecords: 0, warningRecords: 0, invalidRecords: 3 });
    assert.equal(preview.validationIssues.value.invalidAmounts, 3);
    assert(preview.previewData.value.every(row => row._issues.filter(issue => issue === 'invalid_amount').length === 1));
    assert(!preview.previewFields.value.includes('amount'), 'Nonempty mappings must not inherit raw canonical fields');
    await flow.page.performImport();
    assert.equal(flow.writes.length, 0); assert.equal(flow.page.importResult.value.results.errors.length, 3);
    assert.deepEqual(flow.requests.find(request => request.url === '/api/transactions/import').body.data, data);
    flow.page.updateMappings(structuredClone(mappings));
    const corrected = flow.preview(); await corrected.processData();
    assert.deepEqual(flow.page.importStats.value, { totalRecords: 3, validRecords: 1, warningRecords: 2, invalidRecords: 0 });
    assert.equal(corrected.validationIssues.value.invalidAmounts, 0);
    await flow.page.performImport();
    assert.deepEqual(flow.writes.map(row => row.amount), [79200, 2300, 3400]);
    assert.deepEqual(flow.raw(), data);
  }
});

test('empty mappings preserve canonical source values and match real import acceptance', async t => {
  const flow = wizard({ suppliers: [{ name: '123', _id: 'existing-supplier' }], customers: [{ name: '456', _id: 'existing-customer' }] }); t.after(flow.close);
  const data = [
    { amount: '79,200', date: '2026-09-22', notes: 'Canonical', supplierName: 123, customerName: 456 },
    { amount: 'bad', date: '2026-09-22', notes: 'Bad amount' },
    { amount: 2300, date: '', notes: 'Missing date' },
    { date: '2026-09-22', notes: 'Missing amount' },
    { amount: 3400, date: 'bad', notes: 'Bad date' },
    { amount: '0', notes: 'Text zero' },
    { amount: 0, notes: 'Numeric zero' }
  ];
  upload(flow, data); flow.page.updateMappings({});
  const preview = flow.preview(); await preview.processData();
  assert.deepEqual(preview.previewData.value.map(row => row._status), ['valid', 'invalid', 'warning', 'invalid', 'invalid', 'valid', 'invalid']);
  assert.equal(preview.previewData.value[0].amount, '79,200');
  assert.equal(preview.previewData.value[0].notes, 'Canonical');
  assert(preview.previewFields.value.includes('amount'));
  assert.equal(preview.validationIssues.value.invalidAmounts, 3);
  assert.deepEqual(flow.requests.find(request => request.url === '/api/transactions/import-preview').body, { supplierNames: ['123'], customerNames: ['456'] });
  assert.deepEqual(preview.newEntities.value, { newSuppliers: [], newCustomers: [] });
  await flow.page.performImport();
  assert.equal(flow.page.importStats.value.validRecords + flow.page.importStats.value.warningRecords, flow.writes.length);
  assert.deepEqual(flow.writes.map(row => row.amount), [79200, 2300, 0]);
  assert.deepEqual(flow.writes.map(row => row.notes), ['Canonical', 'Missing date', 'Text zero']);
  assert.equal(flow.writes[0].supplierId, 'existing-supplier'); assert.equal(flow.writes[0].customerId, 'existing-customer');
  assert.deepEqual(flow.catalogWrites, { suppliers: [], customers: [] });
  assert.equal(flow.page.importResult.value.results.errors.length, 4);
  assert.deepEqual(flow.raw(), data);
  assert.deepEqual(flow.requests.find(request => request.url === '/api/transactions/import').body.data, data);
});

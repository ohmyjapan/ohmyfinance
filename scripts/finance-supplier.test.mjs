import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierRegistration, draftSupplierRegistration, resolveSupplier, evidenceUrl } from '../shared/finance-supplier.mjs';
const number = 'T0000000000000', now = Date.parse('2026-09-12T12:00:00Z');
const supplier = () => ({ _id: 's', name: 'Synthetic shop', companyName: 'Synthetic company', invoiceNumber: number, identityKey: 'v1', metadata: { invoiceVerification: {
 version: 1, number, legalName: 'Synthetic company', source: 'nta_public_site', method: 'browser_review', scope: 'issuer_registration_only', status: 'active_at_check',
 sourceUrl: 'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=0000000000000', checkedAt: '2026-09-12T01:00:00Z', asOf: '2026-09-12', registeredFrom: '2023-10-01', evidence: { text: 'Synthetic test evidence', sha256: 'a'.repeat(64) }
} } });
test('official observations retain their date and scope, without exposing captured evidence', () => {
 const view = supplierRegistration(supplier(), now); assert.equal(view.status, 'verified'); assert.equal(view.asOf, '2026-09-12'); assert.equal(view.scope, 'issuer_registration_only'); assert.equal(view.evidence, undefined);
});
test('a typed number, unrelated company, changed number or invalid official proof is never verified', () => {
 assert.equal(supplierRegistration({ invoiceNumber: number }, now).status, 'unverified');
 for (const change of [{ companyName: 'Other company' }, { invoiceNumber: 'T1111111111111' }]) assert.equal(supplierRegistration({ ...supplier(), ...change }, now).status, 'mismatch');
 for (const change of [{ sourceUrl: 'https://example.invalid/' }, { sourceUrl: 'javascript:alert(1)' }, { asOf: '2026-02-30' }, { registeredFrom: '2027-01-01' }, { checkedAt: '2027-01-01T00:00:00Z' }, { status: 'cancelled' }, { scope: 'anything' }, { evidence: {} }]) {
   const s=supplier(); Object.assign(s.metadata.invoiceVerification, change); assert.equal(supplierRegistration(s,now).status,'unverified',JSON.stringify(change));
 }
});
test('draft registration badges require both the selected supplier and the exact current number', () => {
 const s={ ...supplier(), registration: supplierRegistration(supplier(),now) };
 assert.equal(draftSupplierRegistration({supplierId:'s',invoiceNumber:number},{suppliers:[s]}).status,'verified');
 assert.equal(draftSupplierRegistration({supplierId:'s',invoiceNumber:'T1111111111111'},{suppliers:[s]}).status,'mismatch');
 assert.equal(draftSupplierRegistration({supplierId:'other',invoiceNumber:number},{suppliers:[s]}).status,'unverified');
});
test('merchant memory resolves only the full normalized descriptor and unchanged supplier identity', () => {
 const s=supplier(), link={merchant:'synthetic descriptor',supplierId:'s',supplierKey:'v1',enabled:true};
 assert.equal(resolveSupplier('  SYNTHETIC  DESCRIPTOR ',[s],[link]).status,'linked');
 assert.equal(resolveSupplier('synthetic descriptor franchise',[s],[link]).status,'unmatched');
 assert.equal(resolveSupplier('synthetic descriptor',[],[link]).status,'stale');
 assert.equal(resolveSupplier('synthetic descriptor',[{...s,identityKey:'v2'}],[link]).status,'stale');
 assert.equal(resolveSupplier('synthetic descriptor',[s],[{...link,enabled:false}]).status,'disabled');
 assert.equal(resolveSupplier('synthetic descriptor',[s],[link,link]).status,'conflict');
});
test('ambiguous exact names require a choice; explicit withdrawal suppresses fallback', () => {
 const s=supplier(); assert.equal(resolveSupplier(s.name,[s]).status,'exact'); assert.equal(resolveSupplier(s.name,[s,{...s,_id:'other'}]).status,'conflict');
 assert.equal(resolveSupplier(s.name,[s],[{merchant:'synthetic shop',enabled:false}]).status,'disabled');
});
test('evidence links accept only HTTPS without embedded credentials', () => {
 for(const value of ['javascript:alert(1)','http://example.invalid','https://user:secret@example.invalid']) assert.equal(evidenceUrl(value),'');
 assert.equal(evidenceUrl('https://example.invalid/company'),'https://example.invalid/company');
});

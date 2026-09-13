import test from 'node:test';
import assert from 'node:assert/strict';
import {HEADERS, parseAmex, period} from '../shared/amex.mjs';
import {buildSourceReferences, sourceReferenceGroups, verifySourceReferences, activeImportRows, purposeEvidence} from '../shared/finance-import-overlap.mjs';
const csv=rows=>Buffer.from([HEADERS,...rows].map(r=>r.map(v=>'"'+v+'"').join(',')).join('\n'));
const row=(merchant='Repeated shop',amount='100',card='12345')=>['2026/08/01','2026/08/03',merchant,'Synthetic',card,amount,'',''];
const batch=(id,rows,extra={})=>{const p=parseAmex(csv(rows),['12345','23456']);return {_id:id.repeat(24),ownerId:'owner',accountId:'account',hash:p.sha256,rows:p.rows,...extra};};
test('annual originals reference complete repeated groups and preserve new rows',()=>{
 const old=batch('1',[row(),row(),row('Service','50')]),fresh=batch('2',[row('New shop','70'),row(),row(),row('Service','50')]);
 const prior=structuredClone(old);fresh.sourceReferences=buildSourceReferences(fresh,[old]);
 assert.equal(verifySourceReferences(fresh,[old]).length,2);
 assert.deepEqual(sourceReferenceGroups(fresh)[0].targets[0].lines,[2,3]);
 assert.deepEqual(activeImportRows(fresh).map(r=>r.description),['New shop']);
 assert.deepEqual(old,prior);assert.equal(fresh.rows.length,4);
});
test('unequal multiplicity and multiple original sources remain held',()=>{
 const first=batch('1',[row(),row()]),fresh=batch('3',[row()]);
 fresh.sourceReferences=buildSourceReferences(fresh,[first]);assert.equal(sourceReferenceGroups(fresh)[0].state,'source_overlap_review');
 fresh.sourceReferences=buildSourceReferences(fresh,[first,batch('2',[row()])]);assert.equal(sourceReferenceGroups(fresh)[0].state,'source_overlap_review');assert.equal(activeImportRows(fresh).length,0);
});
test('later snapshots link the canonical original and not another reference copy',()=>{
 const first=batch('1',[row()]),second=batch('2',[row(),row('New shop')]);second.sourceReferences=buildSourceReferences(second,[first]);
 const third=batch('3',[row(),row('New shop'),row('Third shop')]);third.sourceReferences=buildSourceReferences(third,[first,second]);
 const refs=verifySourceReferences(third,[first,second]);assert.deepEqual(refs.map(r=>r.targets[0].importId),[first._id,second._id]);assert.equal(activeImportRows(third).length,1);
});
test('owner, account, and card separation are enforced',()=>{
 const first=batch('1',[row()]),fresh=batch('2',[row()]);
 assert.equal(buildSourceReferences(fresh,[{...first,ownerId:'other'},{...first,accountId:'other'},batch('3',[row('Repeated shop','100','23456')])]).groups.length,0);
 fresh.sourceReferences=buildSourceReferences(fresh,[first]);assert.throws(()=>verifySourceReferences(fresh,[{...first,ownerId:'other'}]));
});
test('tampered source hashes, partial groups, stale targets, and reference cycles fail closed',()=>{
 const first=batch('1',[row(),row()]),fresh=batch('2',[row(),row()]);fresh.sourceReferences=buildSourceReferences(fresh,[first]);
 assert.throws(()=>sourceReferenceGroups({...fresh,hash:'0'.repeat(64)}));
 const broken=structuredClone(fresh);broken.sourceReferences.groups[0].lines.pop();assert.throws(()=>sourceReferenceGroups(broken));
 assert.throws(()=>verifySourceReferences(fresh,[]));assert.throws(()=>verifySourceReferences(fresh,[{...first,hash:'0'.repeat(64)}]));
 const cycle=structuredClone(first);cycle.sourceReferences=buildSourceReferences(cycle,[fresh]);cycle.sourceReferences.groups=fresh.sourceReferences.groups.map(g=>({...g,targets:[{importId:fresh._id,sourceHash:fresh.hash,lines:[2,3]}]}));assert.throws(()=>verifySourceReferences(fresh,[cycle]));
});
test('custom search coverage records fiscal bounds without relabelling a statement',()=>{
 const p=period({kind:'custom',start:'2025-11-01',end:'2026-09-13',fiscalStart:'2025-11-01',fiscalEnd:'2026-10-31'});
 assert.equal(p.kind,'custom');assert.deepEqual(p.fiscalPeriod,{start:'2025-11-01',end:'2026-10-31'});
 for(const bad of [{fiscalStart:'2025-12-01'},{fiscalEnd:'2026-08-31'},{fiscalEnd:'invalid'},{kind:'statement'}])assert.throws(()=>period({kind:'custom',start:'2025-11-01',end:'2026-09-13',fiscalStart:'2025-11-01',fiscalEnd:'2026-10-31',...bad}));
});
test('purpose evidence distinguishes history from confirmed rules and retains conflicts',()=>{
 const values={purpose:'customer',customerId:'client'};
 assert.equal(purposeEvidence(values,{purpose:{source:'spreadsheet'}}).state,'supported');
 assert.equal(purposeEvidence(values,{purpose:{source:'learning_rule',grade:'A'}}).state,'supported');
 assert.equal(purposeEvidence(values,{purpose:{source:'learning_history',grade:'B'}}).state,'tentative');
 assert.equal(purposeEvidence(values,{customerId:{state:'conflict'}}).state,'conflict');
 assert.equal(purposeEvidence({purpose:'unresolved'},{}).state,'unresolved');
});

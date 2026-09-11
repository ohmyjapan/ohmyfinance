import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import {prepareWorkbook} from './finance-learning-workbook.mjs';
import {decisionInput,gradePattern} from '../shared/finance-learning.mjs';
import {fixture, ownerId, accountId, customerId} from './finance-learning-fixture.mjs';
test('calendar dates and exact identifiers survive timezone, display formats, unlabelled columns and formulas',()=>{
 const {bytes,config}=fixture(),p=prepareWorkbook(bytes,config),r=p.rows.find(r=>r.sheet==='data'&&r.row===2);
 assert.equal(r.date,'2021-04-08');assert.equal(r.cells.find(c=>c.address==='A2').value,44294);
 assert.equal(r.cells.find(c=>c.address==='K2').value,4548296520346);assert.match(r.cells.find(c=>c.address==='K2').formatted,/E\+/);
 assert.equal(r.cells.find(c=>c.address==='J2').header,'');assert.equal(r.cells.find(c=>c.address==='L2').formula,'C2*2');
 assert.equal(p.dataset.sheets.length,4);assert.equal(p.rows.filter(r=>r.sheet==='notes').length,2);
});
test('only primary dated outflows train; archive copies and repeated purchases retain their source occurrences',()=>{
 const {bytes,config}=fixture(),p=prepareWorkbook(bytes,config),g=p.patterns.find(g=>g.accountId===accountId);
 assert.equal(g.total,9);assert.equal(p.dataset.summary.outflowRows,10);assert.equal(g.customers.find(c=>c.customerId===customerId).count,6);assert.equal(g.grade,'C');
 assert.equal(p.rows.filter(r=>r.sheet==='archive').length,13);assert.ok(p.rows.filter(r=>r.sheet==='archive').every(r=>!r.eligible));
 assert.equal(p.rows.find(r=>r.sheet==='data'&&r.row===9).purpose,'unresolved');assert.equal(p.rows.find(r=>r.sheet==='data'&&r.row===10).purpose,'unresolved');
 assert.equal(p.rows.find(r=>r.sheet==='data'&&r.row===11).accountId,'');assert.equal(p.rows.find(r=>r.sheet==='data'&&r.row===13).eligible,false);
});
test('grades expose contradictions and abstain on missing or too little evidence',()=>{
 assert.equal(gradePattern([{label:'A',count:9},{label:'B',count:1}],10),'C');assert.equal(gradePattern([{label:'A',count:9},{label:'',count:1}],10),'B');assert.equal(gradePattern([{label:'-',count:10}],10),'D');assert.equal(gradePattern([{label:'A',count:4}],4),'D');
});
test('confirmations require a real calendar date and registered-reference shape; deferral cannot carry an executable rule',()=>{
 const base={revision:0,note:'Explicit reviewed reason',status:'confirmed',purpose:'customer',customerId,effectiveFrom:'2026-09-12'};
 assert.equal(decisionInput(base).customerId,customerId);assert.throws(()=>decisionInput({...base,effectiveFrom:'2026-02-30'}));assert.throws(()=>decisionInput({...base,note:''}));assert.throws(()=>decisionInput({...base,customerId:'guess'}));
 assert.equal(decisionInput({...base,status:'deferred'}).customerId,undefined);assert.equal(decisionInput({...base,purpose:'company'}).customerId,'');
});
test('ambiguous card aliases and unsupported source locations fail before importing',()=>{
 const {bytes,config}=fixture();assert.throws(()=>prepareWorkbook(bytes,{...config,accountBindings:[...config.accountBindings,{accountId,labels:['test card']}]}));assert.throws(()=>prepareWorkbook(bytes,{...config,sourceUrl:'javascript:alert(1)'}));
});

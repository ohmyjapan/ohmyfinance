import test from 'node:test';
import assert from 'node:assert/strict';
import {HEADERS,parseAplus} from '../shared/aplus.mjs';
import {HEADERS as AMEX_HEADERS,parseAmex,period,csvRows,digest} from '../shared/amex.mjs';
import {parseCardImport} from '../shared/card-import.mjs';
import {mappingRows} from '../shared/finance-mapping.mjs';
import {transactionValues,emptyValues} from '../shared/finance-draft.mjs';
const csv=(rows,headers=HEADERS)=>Buffer.from('\uFEFF'+[headers,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
const row=(changes={})=>Object.assign(['≪****-****-****-1234≫','20260801','架空の店舗','1200','Ｓ','1','01','1200',''],changes);
const metadata={kind:'statement',statementMonth:'2026-08',statementTotal:1200,fiscalStart:'2025-11-01',fiscalEnd:'2026-10-31'};
const parse=(rows,meta={})=>parseAplus(csv(rows),['1234','5678'],{...metadata,...meta});
test('Aplus preserves every original field, uses purchase date, and retains supplementary card attribution',()=>{
 const raw=row({0:'≪****-****-****-5678≫',2:'店舗, "試験"\n支店',8:'税込'}),bytes=csv([raw]),result=parse([raw]),r=result.rows[0];
 assert.deepEqual(Object.values(r.raw),raw);assert.equal(r.cardIdentifier,'5678');assert.equal(r.processingDate,null);assert.equal(r.purchaseDate,'2026-08-01');assert.equal(r.kind,'expense');assert.equal(r.paymentAmount,1200);assert.equal(result.sha256,digest(bytes));assert.equal(result.period.end,'2026-08-31');assert.equal(result.reconciliation.verified,true);
 assert.equal(emptyValues(r).date,'2026-08-01');assert.deepEqual(transactionValues(emptyValues(r),'aplus').tags,['imported','aplus']);
});
test('annual fee and separate refund remain exceptions with missing source fields intact',()=>{
 const fee=['','','年会費','500','','','','500',''],refund=row({1:'20251001',2:'返金店舗',3:'-100',6:'',7:'',8:'返品 別途返金済み'});
 const result=parse([fee,refund],{statementTotal:500,refundTotal:100}),[a,b]=result.rows;
 assert.equal(a.kind,'statement_review');assert.equal(a.cardIdentifier,null);assert.equal(a.purchaseDate,null);assert.equal(b.kind,'credit_review');assert.equal(b.paymentAmount,null);assert.equal(b.amount,-100);assert.equal(b.separateRefund,true);
 const mappings=mappingRows({hash:result.sha256,rows:result.rows});assert.equal(mappings[0].cardLast4,'');assert.equal(mappings[0].purpose,'statement_review');assert.match(mappings[0].reason,/年会費/);assert.equal(mappings[0].statementMonth,'2026-08');
 assert.deepEqual(result.reconciliation,{statementTotal:500,purchaseTotal:400,separateRefundTotal:100,verified:true});
});
test('earlier fiscal purchases and installment payments remain outside expense drafts',()=>{
 assert.equal(parse([row({1:'20251031'})]).rows[0].kind,'statement_review');
 assert.equal(parse([row({5:'3',7:'400'})],{statementTotal:400}).rows[0].kind,'statement_review');
 assert.equal(parse([row({5:'3',7:'400'})],{statementTotal:400}).rows[0].amount,1200);
});
test('both bank totals must reconcile before acceptance',()=>{
 assert.throws(()=>parse([row()],{statementTotal:1199}));
 assert.throws(()=>parse([row()],{refundTotal:100}));
 assert.throws(()=>parse([row()],{statementTotal:''}));
 assert.throws(()=>parse([row()],{refundTotal:-1}));
 assert.throws(()=>parse([row({3:'-100',6:'',7:'',8:'返品'})],{statementTotal:0}));
});
test('malformed cards, dates, amounts, headers, encoding and provisional data are rejected',()=>{
 for(const changes of [{0:'≪****-****-****-9999≫'},{0:''},{1:'20260230'},{1:'20260901'},{3:'1.2'},{7:''},{3:'1,20'},{2:''}]) assert.throws(()=>parse([row(changes)]));
 assert.throws(()=>parseAplus(Buffer.from([0xff]),['1234'],metadata));
 assert.throws(()=>parseAplus(csv([row()],HEADERS.toReversed()),['1234'],metadata));
 for(const meta of [{kind:'unbilled'},{statementMonth:'2026-13'},{end:'2026-08-30'},{fiscalStart:'2027-01-01'},{fiscalEnd:undefined}]) assert.throws(()=>parse([row()],meta));
});
test('repeated purchases remain distinct, order changes preserve keys, and billing months do not collapse',()=>{
 const a=row(),b=row({2:'Other shop'}),one=parse([a,a,b],{statementTotal:3600}),two=parse([b,a,a],{statementTotal:3600});
 assert.equal(new Set(one.rows.map(r=>r.key)).size,3);assert.deepEqual(one.rows.map(r=>r.key).sort(),two.rows.map(r=>r.key).sort());
 assert.notEqual(parse([a]).rows[0].key,parse([a],{statementMonth:'2026-09'}).rows[0].key);
});
test('provider dispatch keeps legacy Amex behavior',()=>{
 const bytes=csv([['2026/08/01','2026/08/03','Test shop','Test user','12345','1200','','']],AMEX_HEADERS),meta={kind:'statement',start:'2026-07-19',end:'2026-08-18'};
 assert.deepEqual(parseCardImport(bytes,{cardIdentifiers:['12345']},meta),{...parseAmex(bytes,['12345']),period:period(meta)});
 assert.throws(()=>parseCardImport(bytes,{provider:'unknown',cardIdentifiers:['12345']},meta));
 assert.deepEqual(transactionValues(emptyValues(parseAmex(bytes,['12345']).rows[0])).tags,['imported','amex']);
});
test('exception mappings cannot be relabeled as spending',()=>{
 const result=parse([['','','年会費','1200','','','','1200','']]),r=result.rows[0];
 const batch={hash:result.sha256,rows:result.rows,mappingPreview:{version:1,sourceHash:result.sha256,rows:[{line:r.line,key:r.key,purpose:'company',clientCode:'',clientName:'',category:'',reason:''}]}};
 assert.throws(()=>mappingRows(batch));
 const spending=parse([row()]);assert.throws(()=>mappingRows({...batch,hash:spending.sha256,rows:spending.rows,mappingPreview:{version:1,sourceHash:spending.sha256,rows:[{...batch.mappingPreview.rows[0],line:spending.rows[0].line,key:spending.rows[0].key,purpose:'statement_review'}]}}));
});

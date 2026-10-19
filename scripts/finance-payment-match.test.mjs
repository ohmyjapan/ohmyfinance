import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANK_FIELDS, normalizeBankRow, bankRowKey, guessBankMapping, paymentCandidates, settlementCandidates, residuals, recordTotals, changedSince, correctionPairs } from '../shared/finance-payment-match.mjs';
const record=(id,values={})=>({id,key:id,revision:1,values:{orderId:'00042',externalOrderId:'SHOP-8801',amount:'12000',currency:'JPY',purchaseDate:'2026-08-01',supplierName:'Synthetic Shop',...values}});
const payment={amount:12000,currency:'JPY',date:'2026-08-01',description:'SHOP-8801 Synthetic Shop'};
test('references distinguish a strong candidate from equal-amount ambiguity',()=>{
 const found=paymentCandidates(payment,[record('a'),record('b',{orderId:'99999',externalOrderId:'OTHER-9999',supplierName:'Elsewhere'})]);
 assert.equal(found.find(x=>x.record.id==='a').rank,'strong');assert.equal(found.find(x=>x.record.id==='b').rank,'ambiguous','payments:ambiguous-not-strong');
 assert.equal(paymentCandidates({...payment,currency:'USD'},[record('a')])[0].rank,'manual');assert.equal(paymentCandidates(payment,[{...record('a'),archived:true}]).length,0);
 const merchantOnly=paymentCandidates({...payment,description:'Synthetic Shop'},[record('a',{amount:'12001'})])[0];assert.ok(!merchantOnly.reasons.includes('amount'));assert.equal(merchantOnly.label,'購入先の候補・金額は要確認');
});
test('split payments, refunds, overpaid state and zero versus unknown totals',()=>{
 const r=record('a'),a=(amount,extra={})=>({amount,currency:'JPY',status:'linked',...extra});
 assert.equal(recordTotals(r,[a(10000),a(20000),a(-5000)]).net,25000);assert.equal(recordTotals(r,[a(12000),a(12000)]).state,'overpaid','payments:overpaid-state');
 assert.equal(recordTotals(r,[a(12000),a(12000,{status:'released'})]).remaining,0);assert.equal(recordTotals(record('a',{amount:''}),[]).total,null);
 assert.equal(recordTotals(record('a',{amount:'0'}),[]).state,'settled');assert.equal(residuals({amount:0.3,allocations:[a(0.1),a(0.2)]}).remaining,0);
});
test('no implicit FX; owner-entered record-currency amounts count separately',()=>{
 const r=record('u',{currency:'USD',amount:'100'}),a={amount:12000,currency:'JPY',status:'linked'};
 assert.equal(recordTotals(r,[a]).net,0,'payments:other-currency-excluded');assert.equal(recordTotals(r,[a]).otherCurrency.length,1);
 assert.equal(recordTotals(r,[{...a,recordAmount:100}]).remaining,0);assert.equal(recordTotals(r,[{...a,recordAmount:0}]).net,0);
});
test('bank normalization preserves blank positions and uses file identity without an ID',async()=>{
 const v={date:'2026/08/10',description:'コンビニ',outflow:'2,000',inflow:'',balance:'8,000'},s={hash:'a'.repeat(64),sheet:'Sheet1',row:2};
 const a=await normalizeBankRow(v,s),b=await normalizeBankRow(v,{...s,row:3}),c=await normalizeBankRow({...v,balance:'6000'},{...s,hash:'b'.repeat(64)});
 assert.equal(a.amount,2000);assert.equal(a.key,await bankRowKey(a,s));assert.notEqual(a.key,b.key,'payments:bank-identical-two-rows');assert.notEqual(a.key,c.key,'payments:bank-noid-crossfile-distinct');assert.equal(a.fingerprint,c.fingerprint);
 assert.equal((await normalizeBankRow({...v,outflow:'',inflow:'500'},s)).amount,-500);assert.equal((await normalizeBankRow({...v,transactionId:' ００４２ '},s)).key,'id:0042');
 await assert.rejects(()=>normalizeBankRow({...v,inflow:'10'},s));await assert.rejects(()=>normalizeBankRow({...v,date:'2026-02-30'},s));
});
test('only transaction-ID headers are guessed as IDs; generic memo remains text',()=>{
 const m=guessBankMapping(['取引日','摘要','出金','入金','残高','メモ','取引番号']);assert.equal(m.transactionId,'6');assert.equal(m.reference,'5');assert.equal(BANK_FIELDS.length,10);
 assert.equal(guessBankMapping(['Date','Memo','Amount']).transactionId,'');
});
test('signed bank amounts follow the chosen convention and explicit directions take precedence',async()=>{
 const source={hash:'c'.repeat(64),sheet:'Sheet1',row:2},values={date:'2026-08-10',description:'Fictional signed bank entry',amount:'-1500'};
 const declared=await normalizeBankRow({...values,direction:'out'},source);
 assert.equal(declared.amount,1500,'bank-sign:explicit-out');assert.equal(declared.direction,'out');
 const negative=await normalizeBankRow(values,source,{amountSign:'outflow-negative'});
 assert.equal(negative.amount,1500,'bank-sign:negative-withdrawal');assert.equal(negative.direction,'out');
 assert.equal((await normalizeBankRow({...values,amount:'2500'},source,{amountSign:'outflow-negative'})).amount,-2500,'bank-sign:positive-deposit');
 assert.equal((await normalizeBankRow(values,source)).amount,-1500,'bank-sign:legacy-default');
 for(const direction of ['out','debit','出金'])for(const amount of ['1500','-1500'])assert.equal((await normalizeBankRow({...values,direction,amount},source,{amountSign:'outflow-negative'})).amount,1500);
 for(const direction of ['in','credit','入金'])for(const amount of ['1500','-1500'])assert.equal((await normalizeBankRow({...values,direction,amount},source,{amountSign:'outflow-negative'})).amount,-1500);
 const separate=await normalizeBankRow({...values,amount:'',outflow:'1500',inflow:''},source,{amountSign:'outflow-negative'});assert.equal(separate.amount,1500,'bank-sign:separate-columns-unchanged');
 assert.equal(negative.key,(await normalizeBankRow(values,source)).key,'bank-sign:source-identity');assert.notEqual(negative.fingerprint,(await normalizeBankRow(values,source)).fingerprint);
});
test('cross-file overlap, reorder, filtered export and changed text give review candidates only',async()=>{
 const row=async(hash,n,description='SHOP')=>normalizeBankRow({date:'2026-08-10',amount:2000,description},{hash:hash.repeat(64),sheet:'Sheet1',row:n});
 const old=[await row('a',2),await row('a',3)],fresh=[await row('b',2),await row('b',3,'SHOP corrected')];
 const pairs=correctionPairs(old,fresh);assert.ok(pairs.some(p=>p.kind==='duplicate'));assert.ok(pairs.some(p=>p.kind==='correction'));
 assert.ok(old.every(r=>!('absentFrom'in r)));assert.equal(correctionPairs(old,[]).length,0);assert.equal(correctionPairs(old,old).length,0);
});
test('Amex repayment evidence is distinct from Aplus statement/calendar evidence',()=>{
 const bank={amount:30000,date:'2026-08-10',currency:'JPY'},card={paymentKey:'card:a:k',kind:'card',accountId:'a',provider:'amex',sourceKind:'repayment',amount:-30000,date:'2026-08-10',importId:'i',line:2,key:'k'};
 const imports=[{_id:'i',accountId:'a',provider:'amex',period:{kind:'statement',end:'2026-08-01',key:'statement:x'}}];
 const a=settlementCandidates(bank,[card],imports,[]);assert.equal(a[0].target.kind,'card-repayment');assert.equal(a[0].evidence,'repayment-row');assert.equal(a[0].suggestedCoversImportId,'i');
 assert.ok(!settlementCandidates(bank,[],imports,[]).some(x=>x.evidence==='calendar-bill'),'payments:amex-no-bill');
 const ap={_id:'p',accountId:'b',provider:'aplus',period:{kind:'statement',key:'p',paymentDueDate:'2026-08-10'},reconciliation:{statementTotal:30000}};
 assert.equal(settlementCandidates(bank,[],[ap],[])[0].evidence,'statement-total');
});
test('source changes expose the exact fields for reconfirmation',()=>{
 assert.deepEqual(changedSince({amount:'100',supplierName:'A'},{amount:'120',supplierName:'A'}).map(x=>x.field),['amount']);
});
test('real calendar Date values and issuer due dates affect bank settlement candidates',()=>{
 const bank={amount:3150,currency:'JPY',date:'2026-08-10'},batch={_id:'i',accountId:'a',provider:'aplus',period:{kind:'statement',key:'p'},reconciliation:{statementTotal:3150,paymentDueDate:'2026-08-10'}},bill={_id:'bill',source:{accountId:'a',periodKey:'p'},amount:3150,currency:'JPY',dueDate:new Date('2026-08-10T03:00:00Z')};
 assert.equal(settlementCandidates(bank,[],[batch],[bill])[0].evidence,'calendar-bill');
 assert.equal(settlementCandidates({...bank,date:'2026-10-10'},[],[batch],[bill])[0].evidence,'manual');
 assert.equal(settlementCandidates({...bank,currency:'USD'},[],[batch],[bill])[0].evidence,'manual');
});
test('a changed record currency never reinterprets an old manual amount; responses remain serializable',()=>{
 const r=record('u',{currency:'EUR',amount:'100'}),a={id:'a',amount:12000,currency:'JPY',recordAmount:100,recordCurrency:'USD',status:'linked',record:r};
 r.totals=recordTotals(r,[a]);assert.equal(r.totals.net,0);assert.equal(r.totals.otherCurrency.length,1);assert.doesNotThrow(()=>JSON.stringify(r));
 assert.equal(residuals({amount:100,currency:'JPY',allocations:[{amount:100,currency:'USD',status:'linked'}]}).state,'review');
});
// Plan omf-monthly-reconciliation-20261020 F3/F2: additive read helpers. A namespace import keeps the reviewed tests above
// running when a helper is missing; each new test then fails on its own named assertion instead of the whole file.
import * as PM from '../shared/finance-payment-match.mjs';
const helper=(name,tag)=>{assert.equal(typeof PM[name],'function',tag+': '+name+' is not exported');return PM[name]};
const settlementOf=r=>({settled:r.settled,remaining:r.remaining,state:r.state});
test('F3 a card repayment row derives its state from linked bank card-repayment allocations',()=>{
 const derive=helper('repaymentSettlement','monthly:f3-helper');
 const card={paymentKey:'card:a:k',kind:'card',sourceKind:'repayment',accountId:'a',key:'k',amount:-30000,currency:'JPY',state:'unmatched',allocated:0,remaining:-30000,allocations:[]};
 const link=(amount,extra={})=>({id:'x'+amount,status:'linked',amount,currency:'JPY',target:{kind:'card-repayment',accountId:'a',key:'k'},...extra}),bank=(...allocations)=>({kind:'bank',allocations});
 assert.deepEqual(settlementOf(derive(card,[])),{settled:0,remaining:-30000,state:'unmatched'},'monthly:f3-unit-unmatched');
 assert.deepEqual(settlementOf(derive(card,[bank(link(10000))])),{settled:-10000,remaining:-20000,state:'partial'},'monthly:f3-unit-partial');
 assert.deepEqual(settlementOf(derive(card,[bank(link(10000)),bank(link(20000))])),{settled:-30000,remaining:0,state:'matched'},'monthly:f3-unit-matched');
 assert.deepEqual(settlementOf(derive(card,[bank(link(30000,{status:'released'}))])),{settled:0,remaining:-30000,state:'unmatched'},'monthly:f3-unit-released');
 assert.equal(derive(card,[bank(link(30000,{target:{kind:'card-repayment',accountId:'a',key:'other'}})),bank(link(30000,{target:{kind:'card-repayment',accountId:'b',key:'k'}})),bank(link(30000,{target:{kind:'card-statement',accountId:'a',importId:'i'}}))]).state,'unmatched','monthly:f3-unit-other-targets-ignored');
 const excess=derive(card,[bank(link(30000)),bank(link(5000))]);assert.equal(excess.state,'review','monthly:f3-unit-excess-review');assert.equal(excess.settled,-35000);assert.equal(excess.remaining,5000);
 assert.equal(derive(card,[bank(link(30000,{currency:'USD'}))]).state,'review','monthly:f3-unit-currency-review');
 assert.equal(derive(card,[bank(link(30000,{sourceChanged:true}))]).state,'review','monthly:f3-unit-source-changed');
 assert.equal(derive(card,[{kind:'bank',sourceMissing:true,allocations:[link(30000)]}]).state,'review','monthly:f3-unit-bank-source-missing');
 assert.equal(derive({...card,state:'review'},[bank(link(30000))]).state,'review','monthly:f3-unit-review-precedence');
 const frozen=JSON.stringify(card);derive(card,[bank(link(30000))]);assert.equal(JSON.stringify(card),frozen,'monthly:f3-unit-no-mutation');assert.deepEqual(card.allocations,[],'monthly:f3-unit-no-card-allocations');
});
test('F2 the month purchase review keeps undated rows, nullable totals and each record once, with no sums',()=>{
 const review=helper('purchaseReview','monthly:f2-helper');
 const rec=(id,values,totals,extra={})=>({id,key:id,revision:1,values:{purchaseState:'purchased',currency:'JPY',amount:'1000',...values},archived:false,totals:{total:1000,currency:values.currency||'JPY',paid:0,refunded:0,net:0,remaining:1000,otherCurrency:[],state:'unpaid',...totals},evidence:{supplierName:'',invoiceNumber:''},...extra});
 const records=[rec('in-first',{purchaseDate:'2026-09-01'},{paid:1000,net:1000,remaining:0,state:'settled'}),rec('in-last',{purchaseDate:'2026-09-30'}),rec('before',{purchaseDate:'2026-08-31'}),rec('after',{purchaseDate:'2026-10-01'}),
  rec('blank',{purchaseDate:''}),rec('invalid',{purchaseDate:'2026/13/45'}),rec('ambiguous',{purchaseDate:'10/5/26'}),rec('unknown',{purchaseDate:'2026-09-10',amount:''},{total:null,remaining:null,state:'unknown'}),
  rec('partial',{purchaseDate:'2026-09-11'},{paid:400,net:400,remaining:600,state:'partial'}),rec('overpaid',{purchaseDate:'2026-09-12'},{paid:1500,net:1500,remaining:-500,state:'overpaid'}),
  rec('archived',{purchaseDate:'2026-09-13'},{},{archived:true}),rec('cancelled',{purchaseDate:'2026-09-14',purchaseState:'cancelled'}),rec('usd',{purchaseDate:'2026-09-15',currency:'USD',amount:'10'},{total:10,remaining:10}),rec('in-first',{purchaseDate:'2026-09-01'})];
 const month=review(records,{from:'2026-09-01',to:'2026-09-30'}),ids=month.rows.map(r=>r.id);
 assert.deepEqual([...ids].sort(),['ambiguous','archived','blank','cancelled','in-first','in-last','invalid','overpaid','partial','unknown','usd'].sort(),'monthly:f2-unit-month-bounds');
 assert.equal(new Set(ids).size,ids.length,'monthly:f2-unit-once');
 for(const id of ['blank','invalid','ambiguous']){const r=month.rows.find(x=>x.id===id);assert.equal(r.dateKnown,false,'monthly:f2-unit-undated '+id);assert.equal(r.dateLabel,'日付未確定');assert.equal(r.rawDate,records.find(x=>x.id===id).values.purchaseDate,'monthly:f2-unit-raw-date-kept');}
 const unknown=month.rows.find(r=>r.id==='unknown');assert.equal(unknown.total,null,'monthly:f2-unit-unknown-null');assert.equal(unknown.remaining,null);assert.equal(unknown.paymentState,'unknown');
 assert.deepEqual(['partial','overpaid','in-first','in-last'].map(id=>month.rows.find(r=>r.id===id).paymentState),['partial','overpaid','settled','unpaid'],'monthly:f2-unit-states');
 assert.equal(month.rows.find(r=>r.id==='overpaid').remaining,-500);assert.equal(month.rows.find(r=>r.id==='usd').currency,'USD','monthly:f2-unit-currency-kept');
 assert.equal(month.rows.find(r=>r.id==='archived').archived,true,'monthly:f2-unit-archived-visible');assert.equal(month.rows.find(r=>r.id==='cancelled').purchaseState,'cancelled','monthly:f2-unit-cancelled-visible');
 for(const key of ['total','sum','paid','remaining','amount'])assert.equal(key in month,false,'monthly:f2-unit-no-global-sum '+key);
 assert.equal(Object.values(month.counts).reduce((n,c)=>n+c,0),ids.length,'monthly:f2-unit-counts-are-record-counts');
 assert.deepEqual(review(records,{from:'2026-09-01',to:'2026-09-30',paymentState:'unknown'}).rows.map(r=>r.id),['unknown'],'monthly:f2-unit-payment-state-filter');
 assert.deepEqual(review(records,{purchaseState:'archived'}).rows.map(r=>r.id),['archived'],'monthly:f2-unit-archived-filter');
 assert.deepEqual(review(records,{purchaseState:'cancelled'}).rows.map(r=>r.id),['cancelled'],'monthly:f2-unit-purchase-state-filter');
 assert.equal(review(records,{}).rows.length,13,'monthly:f2-unit-no-range-all-once');
 const sorted=review(records,{from:'2026-09-01',to:'2026-09-30'}).rows.filter(r=>r.dateKnown).map(r=>r.purchaseDate);assert.deepEqual(sorted,[...sorted].sort(),'monthly:f2-unit-date-order');
});
test('Vue conditional and all new component templates compile',async()=>{
 const {createRequire}=await import('node:module'),req=createRequire(import.meta.url),{parse,compileTemplate}=req('@vue/compiler-sfc');
 for(const name of ['pages/mapping-draft/[importId]/[line].vue','components/intake/IntakePaymentMatches.vue','components/intake/BankStatementImporter.vue','pages/intake/payments.vue']){
  const source=readFileSync(new URL('../'+name,import.meta.url),'utf8'),p=parse(source,{filename:name});assert.deepEqual(p.errors,[]);assert.deepEqual(compileTemplate({source:p.descriptor.template.content,filename:name,id:'payment-test'}).errors,[],name);
 }
});

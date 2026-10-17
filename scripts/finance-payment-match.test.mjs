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
test('Vue conditional and all new component templates compile',async()=>{
 const {createRequire}=await import('node:module'),req=createRequire(import.meta.url),{parse,compileTemplate}=req('@vue/compiler-sfc');
 for(const name of ['pages/mapping-draft/[importId]/[line].vue','components/intake/IntakePaymentMatches.vue','components/intake/BankStatementImporter.vue','pages/intake/payments.vue']){
  const source=readFileSync(new URL('../'+name,import.meta.url),'utf8'),p=parse(source,{filename:name});assert.deepEqual(p.errors,[]);assert.deepEqual(compileTemplate({source:p.descriptor.template.content,filename:name,id:'payment-test'}).errors,[],name);
 }
});

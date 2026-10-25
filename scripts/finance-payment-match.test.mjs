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
// Plan omf-rakuten-csv-date-20261020: the bank's native statement CSV writes 取引日 as eight digits (YYYYMMDD) under four static
// columns 取引日 / 入出金(円) / 残高(円) / 入出金先内容. Fictional rows only.
test('compact YYYYMMDD dates normalize; separated and Japanese dates are unchanged; impossible calendar dates still fail',async()=>{
 const s={hash:'d'.repeat(64),sheet:'Sheet1',row:2},v={description:'Fictional compact date entry',amount:'-1200'},day=async date=>(await normalizeBankRow({...v,date},s,{amountSign:'outflow-negative'})).date;
 for(const [raw,iso] of [['20251101','2025-11-01'],['20251130','2025-11-30'],['20251231','2025-12-31'],['20260101','2026-01-01'],['20261020','2026-10-20'],['20240229','2024-02-29']])assert.equal(await day(raw),iso,'rakuten:compact-date '+raw);
 for(const [raw,iso] of [['2026/08/10','2026-08-10'],['2026-8-1','2026-08-01'],['2026/8/1','2026-08-01'],['2026年8月1日','2026-08-01'],['2025-11-01','2025-11-01']])assert.equal(await day(raw),iso,'rakuten:legacy-date '+raw);
 for(const raw of ['20260229','20251301','20251100','20251232','20250431','00000000','2025111','202511010','251101','2025 1101','2025-1101','20251101x','','2026-02-30','2026/13/01'])await assert.rejects(()=>normalizeBankRow({...v,date:raw},s,{amountSign:'outflow-negative'}),/取引日を確認してください/,'rakuten:invalid-calendar '+JSON.stringify(raw));
 const compact=await normalizeBankRow({...v,date:'20251101'},s),slashed=await normalizeBankRow({...v,date:'2025/11/01'},{...s,hash:'e'.repeat(64)});
 assert.equal(compact.fingerprint,slashed.fingerprint,'rakuten:same-entry-same-fingerprint');assert.notEqual(compact.key,slashed.key,'rakuten:file-row-identity');assert.equal(compact.idKind,'file-row');
});
test('the four native Rakuten headers are guessed into the existing fields; existing guesses and field keys are unchanged',()=>{
 const native={date:'0',description:'3',amount:'1',outflow:'',inflow:'',balance:'2',reference:'',transactionId:'',currency:'',direction:''};
 assert.deepEqual(guessBankMapping(['取引日','入出金(円)','残高(円)','入出金先内容']),native,'rakuten:header-guess');
 assert.deepEqual(guessBankMapping(['取引日','入出金（円）','残高（円）','入出金先内容']),native,'rakuten:header-guess-fullwidth');
 assert.deepEqual(BANK_FIELDS.map(f=>f[0]),['date','description','amount','outflow','inflow','balance','reference','transactionId','currency','direction'],'rakuten:field-keys-unchanged');
 assert.deepEqual(guessBankMapping(['取引日','摘要','出金','入金','残高','メモ']),{date:'0',description:'1',amount:'',outflow:'2',inflow:'3',balance:'4',reference:'5',transactionId:'',currency:'',direction:''},'rakuten:legacy-guess-unchanged');
 const direction=guessBankMapping(['取引日','摘要','金額','入出金区分']);assert.equal(direction.amount,'2','rakuten:no-alias-collision');assert.equal(direction.direction,'3','rakuten:no-alias-collision');
 assert.equal(guessBankMapping(['取引日','入出金','残高','内容']).amount,'','rakuten:exact-alias-only');
});
test('a signed 入出金(円) under 出金がマイナス: positive is incoming, negative is outgoing; duplicate-looking rows keep their own file rows',async()=>{
 const s={hash:'f'.repeat(64),sheet:'Sheet1',row:2},rows=[['20251105','250000','1250000','振込 架空商事'],['20251231','-330','1249670','振込手数料'],['20251231','-330','1249340','振込手数料']];
 const out=[];for(const [i,[date,amount,balance,description]] of rows.entries())out.push(await normalizeBankRow({date,amount,balance,description},{...s,row:i+2},{amountSign:'outflow-negative'}));
 assert.deepEqual(out.map(r=>[r.date,r.amount,r.direction,r.balance]),[['2025-11-05',-250000,'in',1250000],['2025-12-31',330,'out',1249670],['2025-12-31',330,'out',1249340]],'rakuten:signed');
 assert.equal(out[1].fingerprint,out[2].fingerprint,'rakuten:duplicate-rows-look-alike');assert.notEqual(out[1].key,out[2].key,'rakuten:duplicate-rows-retained');assert.equal(correctionPairs([out[1]],[out[2]]).length,0,'rakuten:same-file-duplicates-not-paired');
 assert.equal((await normalizeBankRow({date:'20251105',amount:'250000',description:'振込 架空商事'},s)).direction,'out','rakuten:sign-is-chosen-not-inferred');
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
// Plan omf-rakuten-native-shiwake-20261020 §1/§3: the per-variant collection mode and capability, the native Rakuten template
// facts and the frozen coverage shape — additive; the provider-wide BANK_PROVIDERS table stays contract-pending for every bank.
import * as bankTables from '../shared/finance-payment-match.mjs';
const tableFn=name=>{const f=bankTables[name];assert.equal(typeof f,'function','native-bank:export '+name);return f};
// Deliberate change (plan omf-paypay-routine-20261022 Phase C): PayPay銀行 標準 retrieves too; its BA-PLUS/no-variant connections and
// every other provider/variant keep the observe stage; no live verification is claimed.
test('per-variant collection mode: 楽天銀行 standard and PayPay銀行 standard retrieve; the provider table stays honest',()=>{
 const mode=tableFn('bankCollectionMode');
 assert.equal(mode('rakuten','standard'),'retrieve','native-bank:standard-retrieve');
 assert.equal(mode('paypay','standard'),'retrieve','native-bank:paypay-standard-retrieve');
 assert.equal(mode('ikeda','portal'),'retrieve','native-bank:ikeda-portal-retrieve');
 assert.deepEqual(tableFn('bankCapability')('paypay','standard'),{mode:'retrieve',steps:'implemented',template:null,period:'required',liveVerified:false},'native-bank:paypay-standard-capability');
 assert.equal(tableFn('bankFirstCapture')('paypay','standard'),'unmapped','native-bank:paypay-first-capture-kept');
 for(const [p,v] of [['rakuten','plus'],['rakuten',null],['rakuten','x'],['paypay',null],['paypay','baplus'],['resona','direct'],['ikeda','direct'],['nope','standard']])assert.equal(mode(p,v),'observe','native-bank:observe-kept '+p+'/'+v);
 assert.ok(bankTables.BANK_PROVIDERS.every(p=>p[2]==='contract-pending'),'native-bank:provider-table-pending');
 const capability=tableFn('bankCapability');
 assert.deepEqual(capability('rakuten','standard'),{mode:'retrieve',steps:'implemented',template:'rakuten-standard-native',period:'required',liveVerified:false},'native-bank:standard-capability');
 assert.deepEqual(capability('rakuten','plus'),{mode:'observe',steps:'contract-pending',template:null,period:'portal',liveVerified:false},'native-bank:plus-capability');
});
test('the native 楽天銀行 template is the four observed columns, outflow-negative, with no transaction ID',()=>{
 const t=bankTables.BANK_NATIVE_TEMPLATES?.rakuten?.standard;assert.ok(t,'native-bank:native-template');
 assert.deepEqual(t.headers,['取引日','入出金(円)','残高(円)','入出金先内容']);assert.deepEqual(t.mapping,guessBankMapping(t.headers),'native-bank:template-mapping-guess');
 assert.deepEqual(Object.keys(t.mapping),BANK_FIELDS.map(f=>f[0]),'native-bank:template-mapping-keys');assert.equal(t.mapping.transactionId,'');assert.equal(t.amountSign,'outflow-negative');assert.equal(t.key,'rakuten-standard-native');
});
test('requested coverage: explicit from, optional to (today in JST at queue), never after today, frozen as concrete dates',()=>{
 const input=tableFn('bankCoverageInput'),frozen=tableFn('frozenCoverage'),today=tableFn('jstToday');
 assert.equal(today(new Date('2026-10-19T15:30:00Z')),'2026-10-20','native-bank:jst-today');assert.equal(today(new Date('2026-10-19T14:59:59Z')),'2026-10-19');
 assert.deepEqual(input({from:'2025-11-01',to:null},'2026-10-20'),{from:'2025-11-01',to:null},'native-bank:coverage-open-end');
 assert.deepEqual(input({from:'2025-11-01',to:'2026-10-20'},'2026-10-20'),{from:'2025-11-01',to:'2026-10-20'});
 assert.deepEqual(frozen({from:'2025-11-01',to:null},'2026-10-21'),{from:'2025-11-01',to:'2026-10-21'},'native-bank:coverage-frozen-today');
 assert.deepEqual(frozen({from:'2025-11-01',to:'2026-10-20'},'2026-10-21'),{from:'2025-11-01',to:'2026-10-20'},'native-bank:coverage-frozen-explicit');
 for(const bad of [{from:'2026-10-21',to:null},{from:'2025-11-01',to:'2026-10-21'},{from:'2026-10-01',to:'2026-09-30'},{from:'20251101'},{from:'2026-02-30'},{from:'1999-12-31'},{to:'2026-10-20'},'2025-11-01',[]])assert.throws(()=>input(bad,'2026-10-20'),Error,'native-bank:coverage-refused '+JSON.stringify(bad));
});
test('the native bank connection and classification components compile',async()=>{
 const {createRequire}=await import('node:module'),req=createRequire(import.meta.url),{parse,compileTemplate}=req('@vue/compiler-sfc');
 for(const name of ['components/intake/BankConnections.vue','components/intake/BankClassificationReview.vue']){
  const source=readFileSync(new URL('../'+name,import.meta.url),'utf8'),p=parse(source,{filename:name});assert.deepEqual(p.errors,[]);assert.deepEqual(compileTemplate({source:p.descriptor.template.content,filename:name,id:'native-bank-test'}).errors,[],name);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {HEADERS, parseAmex, period} from '../shared/amex.mjs';
import {buildSourceReferences, sourceReferenceGroups, verifySourceReferences, activeImportRows, purposeEvidence, forecastResolutions, resolutionTargetEligible} from '../shared/finance-import-overlap.mjs';
import {parseCardImport} from '../shared/card-import.mjs';
import {HEADERS as APLUS_HEADERS} from '../shared/aplus.mjs';
import {aplusCapture} from './finance-pending-fixtures.mjs';
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

// ── forecast resolutions and the settled-line / closed-period rules (plan omf-aplus-reconciliation-resolution-20261104, READBACK B1-B4),
// on the module alone with Amex rows: a pending snapshot P and finalized statements. The owner's record lives on the pending batch. ──
const pendingBatch=(id,rows)=>({...batch(id,rows),sourceStatus:'pending',period:{kind:'pending',start:'2026-08-01',end:'2026-08-10'}});
const finalBatch=(id,rows,period={kind:'statement',start:'2026-08-01',end:'2026-08-31'})=>batch(id,rows,{period});
const record=(state,lines,target,revision=1)=>({state,lines,...(target?{target}:{}),note:'',at:'2026-11-04T00:00:00.000Z',revision,replaced:null});
const withRecords=(b,records)=>({...b,forecastResolutions:records});
const shape=g=>[g.match,g.state,g.lines,g.targets.map(t=>[t.importId,t.lines])];
test('forecast resolution records are validated per line and fail closed',()=>{
 const P=pendingBatch('1',[row('Shop A','100')]),F=finalBatch('2',[row('Shop A changed','120')]);
 assert.equal(forecastResolutions(P).size,0);
 assert.equal(forecastResolutions(withRecords(P,{2:record('billed',[2],{importId:F._id,sourceHash:F.hash,lines:[2]})})).get(2).state,'billed');
 for(const bad of [{2:record('maybe',[2])},{2:record('billed',[2])},{2:record('closed',[2],{importId:F._id,sourceHash:F.hash,lines:[2]})},{2:record('billed',[3],{importId:F._id,sourceHash:F.hash,lines:[2]})},{2:record('billed',[2],{importId:F._id,sourceHash:F.hash,lines:[2,3]})},{2:{...record('closed',[2]),revision:0}},{x:record('closed',[2])}])assert.throws(()=>forecastResolutions(withRecords(P,bad)),'a malformed record is refused: '+JSON.stringify(bad));
 assert.throws(()=>forecastResolutions(withRecords(F,{2:record('closed',[2])})),'records live on a pending batch only');
});
test('a billed record binds the chosen statement rows as a resolution group; the billed forecast is never matched by a statement again',()=>{
 const P=pendingBatch('1',[row('Shop A','100')]),F=finalBatch('2',[row('Shop A changed','120')]);
 const held=buildSourceReferences(F,[P]);assert.deepEqual(held.groups.map(shape),[['pending_candidate','source_overlap_review',[2],[[P._id,[2]]]]]);
 const billed=withRecords(P,{2:record('billed',[2],{importId:F._id,sourceHash:F.hash,lines:[2]})});
 const bound={...F,sourceReferences:buildSourceReferences(F,[billed])};
 assert.deepEqual([bound.sourceReferences.version,bound.sourceReferences.groups.map(shape)],[4,[['pending_resolution','existing_import',[2],[[P._id,[2]]]]]]);
 assert.deepEqual([verifySourceReferences(bound,[billed]).length,activeImportRows(bound).length,activeImportRows(billed).length],[1,0,1]);
 const exact={...finalBatch('3',[row('Shop A','100')])};exact.sourceReferences=buildSourceReferences(exact,[billed,bound]);
 assert.deepEqual([exact.sourceReferences.groups,activeImportRows(exact).length],[[],1],'an exact later statement row is a new purchase, not a second match of the consumed forecast');
 const tampered=withRecords(P,{2:record('closed',[2],undefined,2)});
 assert.throws(()=>verifySourceReferences(bound,[tampered]),'a record changed under its resolution group fails closed');
 assert.throws(()=>verifySourceReferences(bound,[P]),'a resolution group without its record fails closed');
});
test('a closed record holds nothing, binds only an exact statement row, and a snapshot repeat still references it',()=>{
 const P=withRecords(pendingBatch('1',[row('Shop A','100')]),{2:record('closed',[2])});
 const changed={...finalBatch('2',[row('Shop A changed','120')])};changed.sourceReferences=buildSourceReferences(changed,[P]);
 assert.deepEqual([changed.sourceReferences.groups,activeImportRows(changed).length],[[],1],'a changed statement row is free');
 const exact={...finalBatch('3',[row('Shop A','100')])};exact.sourceReferences=buildSourceReferences(exact,[P,changed]);
 assert.deepEqual(exact.sourceReferences.groups.map(shape),[['pending_purchase','existing_import',[2],[[P._id,[2]]]]],'an exact bill still binds the closed forecast');
 const again={...pendingBatch('4',[row('Shop A','100')])};again.sourceReferences=buildSourceReferences(again,[P]);
 assert.deepEqual([again.sourceReferences.groups.map(g=>g.state),activeImportRows(again).length],[['existing_import'],0],'a repeated snapshot row is still the same forecast');
});
test('identical forecasts: a grouped decision pairs two lines with two of three statement rows and leaves the third new; closing one alone leaves the other held',()=>{
 const P=pendingBatch('1',[row('Shop E','70'),row('Shop E','70')]),F=finalBatch('2',[row('Shop E','70'),row('Shop E','70'),row('Shop E','70')]);
 const open={...F,sourceReferences:buildSourceReferences(F,[P])};assert.deepEqual(open.sourceReferences.groups.map(shape),[['pending_purchase','source_overlap_review',[2,3,4],[[P._id,[2,3]]]]]);
 const target={importId:F._id,sourceHash:F.hash,lines:[2,3]},grouped=withRecords(P,{2:record('billed',[2,3],target),3:record('billed',[2,3],target)});
 const bound={...F,sourceReferences:buildSourceReferences(F,[grouped])};
 assert.deepEqual([bound.sourceReferences.groups.map(shape),activeImportRows(bound).map(r=>r.line),verifySourceReferences(bound,[grouped]).length],[[['pending_resolution','existing_import',[2,3],[[P._id,[2,3]]]]],[4],1]);
 const uneven=withRecords(P,{2:record('billed',[2,3],target),3:record('billed',[3],{importId:F._id,sourceHash:F.hash,lines:[3]})});
 assert.throws(()=>verifySourceReferences(bound,[uneven]),'every line of a grouped decision must carry the same record');
 const closedOne=withRecords(P,{2:record('closed',[2])}),rest={...F,sourceReferences:buildSourceReferences(F,[closedOne])};
 assert.deepEqual([rest.sourceReferences.groups.map(shape),activeImportRows(rest).length],[[['pending_purchase','source_overlap_review',[2,3,4],[[P._id,[3]]]]],0]);
 assert.equal(verifySourceReferences(open,[closedOne]).length,1,'the binding built before the closure still verifies');
 assert.equal(verifySourceReferences(rest,[closedOne]).length,1,'the binding built after it verifies too');
});
test('individual decisions partition identical statement groups without losing remaining purchases',()=>{
 for(const amount of ['70','80']){
  const P=pendingBatch('1',[row('Shop E','70'),row('Shop E','70')]),F=finalBatch('2',[row('Shop E',amount),row('Shop E',amount),row('Shop E',amount)]);
  const one=withRecords(P,{2:record('billed',[2],{importId:F._id,sourceHash:F.hash,lines:[2]})});
  const bound={...F,sourceReferences:buildSourceReferences(F,[one])};
  assert.equal(verifySourceReferences(bound,[one]).length,2,'resolution and residual group both verify');
  assert.deepEqual(bound.sourceReferences.groups.map(g=>g.lines),[[2],[3,4]]);
  const tampered=structuredClone(bound);tampered.sourceReferences.groups[1].lines=[3];assert.throws(()=>sourceReferenceGroups(tampered),'cannot omit a remaining identical row');
  const two=withRecords(P,{...one.forecastResolutions,3:record('billed',[3],{importId:F._id,sourceHash:F.hash,lines:[3]})});
  const done={...F,sourceReferences:buildSourceReferences(F,[two])};
  assert.equal(verifySourceReferences(done,[two]).length,2);assert.deepEqual(activeImportRows(done).map(r=>r.line),[4]);
 }
});

test('a statement settles a forecast for every other statement (history), and a stale billed record binds nothing',()=>{
 const P=pendingBatch('1',[row('Shop A','100'),row('Shop B','200')]);
 const F1={...finalBatch('2',[row('Shop A','100'),row('Shop X','300')])};F1.sourceReferences=buildSourceReferences(F1,[P]);
 assert.deepEqual(F1.sourceReferences.groups.map(shape),[['pending_purchase','existing_import',[2],[[P._id,[2]]]],['pending_candidate','source_overlap_review',[3],[[P._id,[3]]]]],'X is held by the open forecast B only');
 const F2={...finalBatch('3',[row('Shop B','200'),row('Shop Y','400')])};F2.sourceReferences=buildSourceReferences(F2,[P,F1]);
 assert.deepEqual([F2.sourceReferences.groups.map(shape),activeImportRows(F2).map(r=>r.line)],[[['pending_purchase','existing_import',[2],[[P._id,[3]]]]],[3]],'Y is free: A is settled by F1, B by F2 itself');
 const rebuilt={...F1,sourceReferences:buildSourceReferences(F1,[P],[P,F2])};
 assert.deepEqual([rebuilt.sourceReferences.groups.length,activeImportRows(rebuilt).map(r=>r.line)],[1,[3]],'rebuilt with the whole history, X is free too (B settled by the later statement)');
 assert.equal(verifySourceReferences(F1,[P,F2]).length,2,'the import-time binding still verifies');
 const stale=withRecords(P,{2:record('billed',[2],{importId:F2._id,sourceHash:F2.hash,lines:[3]})});
 assert.deepEqual(buildSourceReferences(F2,[stale,F1],[stale,F1]).groups.map(g=>g.match),['pending_purchase'],'a billed record on a line another statement settled exactly binds nothing');
});
test('a statement whose coverage closed before the forecast purchase holds nothing',()=>{
 const P=pendingBatch('1',[row('Shop A','100')]);
 const earlier={...finalBatch('2',[['2026/07/15','2026/07/16','Shop A changed','Synthetic','12345','120','','']],{kind:'statement',start:'2026-07-01',end:'2026-07-31'})};
 earlier.sourceReferences=buildSourceReferences(earlier,[P]);assert.deepEqual([earlier.sourceReferences.groups,activeImportRows(earlier).length],[[],1]);
 const later={...finalBatch('3',[['2026/08/15','2026/08/16','Shop A changed','Synthetic','12345','120','','']])};later.sourceReferences=buildSourceReferences(later,[P]);
 assert.equal(later.sourceReferences.groups[0]?.match,'pending_candidate','a statement that can contain the forecast still holds its changed form');
});

// ── the same purchase kept under individual review on the statement (plan omf-aplus-statement-payment-review-20261105): one shared eligibility for the
// emitter, the verifier and the writer; the owner's explicit pairing names the source and leaves every stored value as it is. Aplus rows through the real
// parsers; synthetic card, merchants and amounts (the 8039 / blank shape reproduces the owner's case without its data). ──
const aplusAccount={provider:'aplus',cardIdentifiers:['1234','5678']};
const aplusCsv=rows=>Buffer.from([APLUS_HEADERS,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
const aplusRow=i=>i.annualFee?['', '', '年会費',i.amount,'','','',i.amount,'']:i.deposit?['','','ご入金（８／２７）',i.amount,'','','','','ショッピング元金']:['≪****-****-****-'+(i.card||'1234')+'≫',(i.date||'2026-08-06').replaceAll('-',''),i.merchant,i.amount,i.sales||'Ｓ',i.count||'1',i.number===undefined?'01':i.number,i.payment===null?'':(i.payment===undefined?i.amount:i.payment),i.details||''];
const paymentsOf=items=>items.reduce((n,i)=>n+(i.deposit||i.payment===null?0:(i.payment===undefined?i.amount:i.payment)),0);
const aplusForecast=(items,n,capturedAt='2026-08-20T00:00:00.000Z')=>({...parseCardImport(Buffer.from(JSON.stringify({...aplusCapture(items.map(i=>({merchant:i.merchant,amount:i.amount,date:i.date||'2026-08-06',card:i.card||'1234',month:i.month||'26/09'}))),capturedAt})),aplusAccount,{kind:'pending'}),_id:String(n).padStart(24,'0'),ownerId:'owner',accountId:'account',provider:'aplus'});
const aplusStatement=(items,month,n)=>({...parseCardImport(aplusCsv(items.map(aplusRow)),aplusAccount,{kind:'statement',statementMonth:month,statementTotal:paymentsOf(items)}),_id:String(n).padStart(24,'0'),ownerId:'owner',accountId:'account',provider:'aplus'});
for(const b of [aplusForecast,aplusStatement])void b;
const withHash=b=>({...b,hash:b.sha256});
const X={merchant:'Synthetic service X',amount:8039,date:'2026-08-06',month:'26/09'};
const billedTo=(F,lines,forecastLines=lines)=>Object.fromEntries(forecastLines.map(l=>[l,record('billed',forecastLines,{importId:F._id,sourceHash:F.hash,lines})]));
test('aplus exception: one eligibility — an expense of the same card as before, or the same purchase kept under individual review; every deviation is refused',()=>{
 const P=withHash(aplusForecast([X],1)),f=P.rows[0];assert.deepEqual([f.kind,f.paymentAmount,f.pendingPaymentMonth],['expense',null,'2026-09'],'a pending row with a blank payment field is a forecast, not an exception');
 const S=withHash(aplusStatement([{...X,payment:null},{...X,payment:4000},{...X,amount:8040,payment:null},{...X,date:'2026-08-07',payment:null},{...X,merchant:'Synthetic service X.',payment:null},{...X,card:'5678',payment:null},{...X,amount:-8039,payment:-8039},{annualFee:true,amount:1375},{deposit:true,amount:-200},{merchant:'Shop A (final)',amount:1200,date:'2026-08-12'},{merchant:'Shop B (other card)',amount:300,card:'5678'},{...X,amount:8100,payment:4050,count:'2'}],'2026-09',2));
 const [blank,reduced,amount,date,merchant,card,credit,fee,deposit,expense,otherCard,installment]=S.rows;
 assert.deepEqual([blank.kind,blank.purchaseAmount,blank.paymentAmount,reduced.kind,reduced.paymentAmount,credit.kind,fee.kind,deposit.kind,expense.kind,installment.kind],['statement_review',8039,null,'statement_review',4000,'credit_review','statement_review','credit_review','expense','statement_review'],'parsed kinds');
 assert.equal(resolutionTargetEligible(f,blank),true,'blank payment field: the same purchase');
 assert.equal(resolutionTargetEligible(f,reduced),true,'reduced payment field: the same purchase');
 assert.equal(resolutionTargetEligible(f,expense),true,'an expense of the same card: eligible as before, whatever its amount, date or merchant');
 for(const [label,target] of [['amount',amount],['date',date],['merchant',merchant],['card',card],['credit',credit],['annual fee',fee],['deposit',deposit],['other card expense',otherCard],['installment',installment]])assert.equal(resolutionTargetEligible(f,target),false,'refused: '+label);
 assert.equal(resolutionTargetEligible({...f,pendingPaymentMonth:'2026-10'},blank),false,'refused: billing month');
 assert.equal(resolutionTargetEligible({...f,currency:'USD'},blank),false,'refused: currency');
 assert.equal(resolutionTargetEligible({...f,kind:'statement_review'},blank),false,'refused: the forecast must be an expense');
 assert.equal(resolutionTargetEligible({...f,kind:'statement_review'},expense),false,'refused: the forecast must be an expense (ordinary case too)');
 assert.equal(resolutionTargetEligible({...f,provider:'amex'},{...blank,provider:'amex'}),false,'refused: Aplus only');
 assert.equal(resolutionTargetEligible(f,{...f,kind:'statement_review'}),false,'refused: a pending row kept under review has no statement month (the batch-level finality is the callers\' check: the emitter runs for statements only, the verifier and the writer refuse a pending target)');
 assert.equal(resolutionTargetEligible(f,undefined),false);assert.equal(resolutionTargetEligible(undefined,blank),false);
});
test('aplus exception: the billed record binds the review row as a version-4 resolution group, emitter and verifier agree, and no stored value changes',()=>{
 const P=withHash(aplusForecast([X],1)),S=withHash(aplusStatement([{...X,payment:null},{merchant:'Shop Z',amount:500,date:'2026-08-20'}],'2026-09',2)),before=structuredClone([P,S]);
 const held={...S,sourceReferences:buildSourceReferences(S,[P])};
 assert.deepEqual(held.sourceReferences.groups.map(shape),[['pending_purchase','source_overlap_review',[2],[[P._id,[2]]]],['pending_candidate','source_overlap_review',[3],[[P._id,[2]]]]],'before the decision: a review hold, never an automatic match; the open forecast also holds the unmatched row');
 assert.equal(activeImportRows(held).length,0);
 const billed=withRecords(P,billedTo(S,[2]));
 const bound={...S,sourceReferences:buildSourceReferences(S,[billed])};
 assert.deepEqual([bound.sourceReferences.version,bound.sourceReferences.groups.map(shape)],[4,[['pending_resolution','existing_import',[2],[[P._id,[2]]]]]],'the same-purchase review row binds');
 assert.deepEqual([verifySourceReferences(bound,[billed]).length,activeImportRows(bound).map(r=>r.line),activeImportRows(billed).map(r=>r.line)],[1,[3],[2]],'the statement row is a reference copy; the forecast keeps its identity; the resolved forecast releases the other row');
 assert.deepEqual([bound.rows[0].purchaseAmount,bound.rows[0].paymentAmount,bound.rows[0].kind,billed.rows[0].amount,billed.rows[0].paymentAmount],[8039,null,'statement_review',8039,null],'8039 and the blank payment field are retained on both sides');
 assert.deepEqual([P,S],before,'the source batches are immutable');
 assert.throws(()=>verifySourceReferences(bound,[P]),'a resolution group without its record fails closed');
 assert.throws(()=>verifySourceReferences(bound,[withRecords(P,{2:{...billedTo(S,[2])[2],target:{importId:S._id,sourceHash:'1'.repeat(64),lines:[2]}}})]),'a tampered target hash fails closed');
 assert.throws(()=>verifySourceReferences({...bound,rows:bound.rows.map(r=>r.line===2?{...r,amount:8040,purchaseAmount:8040}:r)},[billed]),'a statement row that no longer is the same purchase fails closed');
 assert.throws(()=>verifySourceReferences(bound,[{...billed,ownerId:'other'}]),'another owner fails closed');
 const later=withHash(aplusForecast([X,{merchant:'Shop N',amount:70,date:'2026-08-21',month:'26/09'}],3,'2026-08-22T00:00:00.000Z')),again={...later,sourceReferences:buildSourceReferences(later,[billed,bound])};
 assert.deepEqual(again.sourceReferences.groups.map(g=>[g.match,g.state,g.targets.map(t=>t.importId)]),[['pending_purchase','existing_import',[P._id]],['pending_candidate','source_overlap_review',[S._id]]],'a later snapshot repeating the purchase references the forecast; its new row is held by the statement\'s own unmatched row, never by the resolved forecast');
 const consumed={...withHash(aplusStatement([{...X,payment:null}],'2026-10',4))};consumed.sourceReferences=buildSourceReferences(consumed,[billed,bound]);
 assert.deepEqual([consumed.sourceReferences.groups,activeImportRows(consumed).length],[[],1],'a paired forecast is not matched by another statement again');
});
test('aplus exception: forged or no-longer-eligible records bind nothing (stale), cross-card/owner/hash controls hold, old ordinary bindings read unchanged',()=>{
 const P=withHash(aplusForecast([X],1));
 for(const [label,item] of [['amount',{...X,amount:8040,payment:null}],['date',{...X,date:'2026-08-07',payment:null}],['merchant',{...X,merchant:'Synthetic service X.',payment:null}],['installment',{...X,amount:8100,payment:4050,count:'2'}]]){
  const S=withHash(aplusStatement([item],'2026-09',2)),forged=buildSourceReferences(S,[withRecords(P,billedTo(S,[2]))]);
  assert.ok(!forged.groups.some(g=>g.match==='pending_resolution'),'binds nothing: '+label);assert.equal(forged.version,forged.groups.length?3:1,'no version-4 shape: '+label);
 }
 const monthS=withHash(aplusStatement([{...X,payment:null}],'2026-09',2)),monthP=withHash(aplusForecast([{...X,month:'26/10'}],1));
 assert.ok(!buildSourceReferences(monthS,[withRecords(monthP,billedTo(monthS,[2]))]).groups.some(g=>g.match==='pending_resolution'),'billing month differs: binds nothing');
 const cardS=withHash(aplusStatement([{...X,card:'5678',payment:null}],'2026-09',2));
 assert.ok(!buildSourceReferences(cardS,[withRecords(P,billedTo(cardS,[2]))]).groups.some(g=>g.match==='pending_resolution'),'another card: binds nothing');
 const S=withHash(aplusStatement([{...X,payment:null}],'2026-09',2)),billed=withRecords(P,billedTo(S,[2]));
 assert.equal(buildSourceReferences(S,[{...billed,ownerId:'other'}]).groups.length,0,'another owner: nothing');
 assert.ok(!buildSourceReferences(S,[withRecords(P,{2:record('billed',[2],{importId:S._id,sourceHash:'1'.repeat(64),lines:[2]})})]).groups.some(g=>g.match==='pending_resolution'),'another file hash: binds nothing');
 const bound={...S,sourceReferences:buildSourceReferences(S,[billed])};
 const handMade=structuredClone(bound);handMade.sourceReferences.groups[0].lines=[2];
 const altered={...S,rows:S.rows.map(r=>({...r,kind:'statement_review',description:'Synthetic service X.'}))};
 assert.throws(()=>verifySourceReferences({...bound,rows:altered.rows},[billed]),'a hand-made group on a row the rule refuses fails verification');
 // the ordinary expense pairing (the existing shape) is unchanged: same group, same version, verifies
 const changed=withHash(aplusStatement([{merchant:'Shop A (final)',amount:1200,date:'2026-08-12'}],'2026-09',5)),A=withHash(aplusForecast([{merchant:'Shop A',amount:1000,date:'2026-08-10',month:'26/09'}],6));
 const ordinary={...changed,sourceReferences:buildSourceReferences(changed,[withRecords(A,billedTo(changed,[2]))])};
 assert.deepEqual([ordinary.sourceReferences.version,ordinary.sourceReferences.groups.map(shape),verifySourceReferences(ordinary,[withRecords(A,billedTo(changed,[2]))]).length],[4,[['pending_resolution','existing_import',[2],[[A._id,[2]]]]],1]);
});
test('aplus exception: identical repeats pair as a group or one at a time; the remaining review row is verified as its own residual group',()=>{
 const P=withHash(aplusForecast([X,X],1)),S=withHash(aplusStatement([{...X,payment:null},{...X,payment:null},{...X,payment:null}],'2026-09',2));
 const open={...S,sourceReferences:buildSourceReferences(S,[P])};assert.deepEqual(open.sourceReferences.groups.map(shape),[['pending_purchase','source_overlap_review',[2,3,4],[[P._id,[2,3]]]]]);
 const grouped=withRecords(P,billedTo(S,[2,3],[2,3])),bound={...S,sourceReferences:buildSourceReferences(S,[grouped])};
 assert.deepEqual([bound.sourceReferences.groups.map(shape),activeImportRows(bound).map(r=>r.line),verifySourceReferences(bound,[grouped]).length],[[['pending_resolution','existing_import',[2,3],[[P._id,[2,3]]]]],[4],1],'a grouped decision binds two review rows; the third stays');
 const one=withRecords(P,{2:record('billed',[2],{importId:S._id,sourceHash:S.hash,lines:[2]})}),partial={...S,sourceReferences:buildSourceReferences(S,[one])};
 assert.deepEqual([partial.sourceReferences.groups.map(g=>[g.match,g.lines]),verifySourceReferences(partial,[one]).length],[[['pending_resolution',[2]],['pending_purchase',[3,4]]],2],'one at a time: the residual rows stay a verified review group');
 const two=withRecords(P,{...one.forecastResolutions,3:record('billed',[3],{importId:S._id,sourceHash:S.hash,lines:[3]})}),done={...S,sourceReferences:buildSourceReferences(S,[two])};
 assert.deepEqual([done.sourceReferences.groups.map(g=>[g.match,g.lines]),activeImportRows(done).map(r=>r.line),verifySourceReferences(done,[two]).length],[[['pending_resolution',[2]],['pending_resolution',[3]]],[4],2]);
 assert.throws(()=>verifySourceReferences(bound,[withRecords(P,{2:record('billed',[2,3],{importId:S._id,sourceHash:S.hash,lines:[2,3]}),3:record('billed',[3],{importId:S._id,sourceHash:S.hash,lines:[3]})})]),'every line of a grouped decision must carry the same record');
});

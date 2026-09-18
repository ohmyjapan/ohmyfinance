import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntrasDocuments,verifyIntrasPdfReadback} from '../shared/finance-workflow-documents.mjs';
import {validJan,validateReceiptReading,receiptInventoryPass} from '../shared/finance-workflow-receipts.mjs';
import {buildInvestigation,validateInvestigationReport,automaticPurchaseCandidate} from '../shared/finance-workflow-investigation.mjs';
const target={providerAccount:'synthetic',orderId:'OMJ00-TEST',applicationId:'12345678',tracking:'123456789012',shippedAt:'2026-09-01'};
const invoice='COMMERCIAL INVOICE & PACKING LIST\nWAY BILL NO.\nSYNTHETIC ADDRESS\t123456789012\nIssue date: 2026-09-01\n通貨(Currency)\nJPY\tFOB JAPAN\n総合計 (Total)\t2\t \t¥1,700\n';
const permit='輸出許可通知書\n申告番号\n1\t2026/09/02\t123 4567 8901\nＨＡＷＢ番号\t123-456789012\t貨物個数\t1 個\n申告価格 ¥1,700 -[*]\n社内整理用番号 12345678 輸出者\n輸出許可年月日 2026/09/02\n';
test('official Intras fields preserve customer value and require independent matching PDF readback',()=>{
 const p=parseIntrasDocuments(target,invoice,permit);assert.equal(p.itemCount,2);assert.equal(p.declaredAmount,1700);assert.equal(p.permitNumber,'12345678901');
 const read={complete:true,invoice:{tracking:target.tracking,date:p.shippedAt,itemCount:2,currency:'JPY',declaredAmount:1700},permit:{tracking:target.tracking,applicationId:target.applicationId,permitNumber:p.permitNumber,permitDate:p.permitDate,currency:'JPY',declaredAmount:1700}};
 assert(verifyIntrasPdfReadback(p,read));read.invoice.declaredAmount=67000;assert.throws(()=>verifyIntrasPdfReadback(p,read));
 for(const bad of [permit.replace(target.applicationId,'99999999'),permit.replace('123-456789012','999-456789012'),permit.replace('¥1,700','¥2,200'),permit+permit])assert.throws(()=>parseIntrasDocuments(target,invoice,bad));
 assert.throws(()=>parseIntrasDocuments(target,invoice.replace('JPY','USD'),permit));
});
const jan='4901234567894';
const stock=(id,model='AB12CD345',variant='01-2',reference='TOKYO')=>['',id,'','',reference,'',model,variant];
test('JAN stays a string; unresolved JAN and overlapping receipt claims block arbitrary remainder assignment',()=>{
 assert(validJan(jan));assert(!validJan('4901234567890'));
 const receipts=[{id:'r1',items:[{line:1,jan,quantity:1}]},{id:'r2',items:[{line:1,product:'shirt',quantity:1}]}];
 const rows=[[],[],stock('S1'),stock('S2'),stock('OTHER','AB12CD345','01-2','OSAKA YAMATO 1234567')];
 const missing=receiptInventoryPass(receipts,rows);assert.equal(missing.inferenceReady,false);assert.equal(missing.stocks.length,2);
 const catalog=[{jan,exact:true,product:'Shirt',model:'AB12CD345',color:'01',size:'2',source:{url:'https://example.invalid/catalog'}}];
 const resolved=receiptInventoryPass(receipts,rows,{janCatalog:catalog,claimedIds:['S2']});assert.equal(resolved.inferenceReady,false);assert.equal(resolved.lines[0].candidates.length,1);
 const assigned=receiptInventoryPass(receipts,rows,{janCatalog:catalog,claimedIds:['S1'],allocations:[{receiptId:'r1',itemLine:1,inventoryId:'S1'}]});assert.equal(assigned.inferenceReady,true);assert.equal(assigned.lines[0].remainingQuantity,0);
 const competing=receiptInventoryPass([{id:'r1',items:[{line:1,jan,quantity:1}]},{id:'r2',items:[{line:1,jan,quantity:1}]}],rows,{janCatalog:catalog});assert.deepEqual(competing.competingIds,['S1','S2']);
 rows.push(stock('S1'));assert(!receiptInventoryPass(receipts,rows,{janCatalog:catalog}).stocks.some(s=>s.inventoryId==='S1'));
});
test('receipt line quantities and identifiers require literal page evidence; missing prices remain unknown',()=>{
 const page='2026/09/01 合計 2200円\nJAN '+jan+' 数量 2';
 const f=(key,value,quote)=>({key,value,page:1,quote});
 const raw={complete:true,pages:[{page:1,text:page}],receipts:[{fields:[f('date','2026-09-01','2026/09/01'),f('total','2200','合計 2200円'),f('currency','JPY','2200円')],items:[{fields:[f('jan',jan,'JAN '+jan),f('quantity','2','数量 2')]}]}]};
 const result=validateReceiptReading(raw);assert.equal(result.receipts[0].items[0].jan,jan);assert.equal(result.receipts[0].items[0].lineTotal,undefined);
 raw.receipts[0].items[0].fields[1].value='3';assert.throws(()=>validateReceiptReading(raw));
});
function evidence(){const row={id:'p1',payment:{date:'2026-09-01',amount:67000,merchant:'Synthetic ISSEY',purpose:'customer'}};return buildInvestigation({row,peers:[row,{id:'p2',payment:{...row.payment,date:'2026-09-02'}}],archive:{orders:[{id:'a'.repeat(64),accountId:'synthetic-account',accountName:'Synthetic',orderNumber:'1234567',date:'2026-09-01',total:67000,currency:'JPY',cancelled:false,dataQuality:'complete',items:[],files:[]}]},inventory:{rows:[[],[]],complete:true}})}
test('unpriced tags retain unknown purchase fields; TOKYO date labels and bounded evidence never establish uniqueness',()=>{
 const f=(key,value)=>({key,value,page:1,quote:value}),reading=validateReceiptReading({complete:true,pages:[{page:1,text:'Shirt AB12CD345'}],receipts:[{fields:[],items:[{fields:[f('product','Shirt'),f('model','AB12CD345')]}]}]});
 assert.equal(reading.receipts[0].items[0].quantity,undefined);
 const row={id:'p',importId:'import',line:2,payment:{date:'2026-09-01',amount:5000}},rows=[[],[],stock('S1','AB12CD345','01-2','TOKYO2026-09-02'),stock('S2','AB12CD345','01-2','TOKYO 2026-09-02')];
 const c=buildInvestigation({row,peers:[],archive:{orders:[]},inventory:{rows,complete:true},receipts:[{id:'tag',hash:'a'.repeat(64),importId:'import',line:2,reading}]});
 assert.equal(c.alternatives[0].total,null);assert.equal(c.alternatives[0].date,'');assert.equal(c.offline.stocks.length,2);
 const incomplete=receiptInventoryPass([{id:'r',items:[{line:1,model:'AB12CD345',quantity:1}]}],rows,{purchaseDate:row.payment.date,maxStocks:1});assert.equal(incomplete.coverage.truncated,true);assert.equal(incomplete.coverage.complete,false);assert.equal(incomplete.inferenceReady,false);
 const missing=buildInvestigation({row:{...row,importId:'other'},peers:[],archive:{orders:[]},inventory:{rows,complete:true},receipts:[{id:'tag',hash:'a'.repeat(64),importId:'import',line:2,reading}]});assert.equal(missing.alternatives.length,0);
});
test('same-price online alternatives remain proposals, unknown offline evidence does not establish an online association',()=>{
 const c=evidence(),id=c.alternatives[0].id,report={summary:'확인 필요',recommendedId:id,hypotheses:[{candidateId:id,support:[{factId:id,quote:'1234567'}],uncertainty:'오프라인 구매 가능성이 남아 있습니다.'}],question:'이 구매는 온라인 주문인가요?',inventoryProposals:[]};
 assert.equal(c.alternatives[0].paymentCardVerified,false);assert(!c.facts.find(f=>f.id==='competing_payments').text.includes('p1'));assert(c.facts.find(f=>f.id==='competing_payments').text.includes('p2'));
 assert(validateInvestigationReport(report,c));assert.equal(automaticPurchaseCandidate(c,report),null);
 c.confirmedReference={reference:'1234567'};assert.equal(automaticPurchaseCandidate(c,report).id,id);
 report.hypotheses[0].support[0].quote='not in source';assert.throws(()=>validateInvestigationReport(report,c));
});

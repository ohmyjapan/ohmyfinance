import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {parseSheetCsv,searchCsv,validateSheetExportRows,readCompleteSheetCsv} from '../research-worker/sheets.mjs';
import {readSheetCsv,selectSheet,sheetExportUrl,CSV_LIMIT} from '../research-worker/sheet-export.mjs';

test('original inventory rows retain blanks, string IDs, unknown prices and exact sheet positions',()=>{
 const csv='\ufeffdate,stock,product,price\r\n'+',,,\r\n'.repeat(20900)+'2026/04/12,000123,"Sample, cardigan ""blue""",\r\n';
 const result=searchCsv(csv,['000123'],'2026-04-10',true);
 assert.equal(result.totalRows,20902);assert.equal(result.matches[0].row,20902);
 assert.deepEqual(result.matches[0].values,['2026/04/12','000123','Sample, cardigan "blue"','']);
 assert.equal(result.coverage.absenceProven,false);assert.equal(result.exportMode,'original_csv');
 assert.deepEqual(parseSheetCsv('\n""\n,\n'),[[''],[''],['','']]);
});

test('incomplete, oversized and out-of-range exports fail without manufacturing a partial result',()=>{
 for(const csv of ['"unfinished','abc"def','"abc"def','<html>sign in</html>'])assert.throws(()=>parseSheetCsv(csv));
 assert.throws(()=>parseSheetCsv(','.repeat(52)),/column range/);
 assert.throws(()=>parseSheetCsv('\n'.repeat(50001)),/row range/);
 assert.throws(()=>parseSheetCsv('x'.repeat(CSV_LIMIT+1)),/unavailable/);
 const result=searchCsv('\n'.repeat(50000),['absent'],'2026-04-10',false);
 assert.equal(result.coverage.rowLimitReached,true);assert.equal(result.coverage.absenceProven,false);
});

test('export target is restricted to the configured workbook, tab and bounded row range',()=>{
 assert.equal(sheetExportUrl('synthetic-workbook-012345','7'),'https://docs.google.com/spreadsheets/d/synthetic-workbook-012345/export?format=csv&gid=7&range=A1:AZ50000');
 for(const [id,gid] of [['../private','0'],['synthetic-workbook-012345','0&sheet=Other'],['synthetic-workbook-012345',null]])assert.throws(()=>sheetExportUrl(id,gid));
});

function fakeBrowser({csv='stock,item,price\n000123,Sample,',status=200,mime='text/csv; charset=utf-8',redirect=false,host='docs.google.com',length,encoding,never=false}={}){
 const cdp=new EventEmitter(),calls=[];let closed=false,chunk=0,aborted;
 cdp.send=async(method,args)=>{
  calls.push({method,args});
  if(method==='Fetch.takeResponseBodyAsStream')return {stream:'our-stream'};
  if(method==='IO.read'){const bytes=Buffer.from(csv),middle=Math.floor(bytes.length/2),part=chunk++?bytes.subarray(middle):bytes.subarray(0,middle);return {data:part.toString('base64'),base64Encoded:true,eof:chunk===2}}
  if(method==='Fetch.failRequest')aborted?.();
  return {};
 };
 cdp.detach=async()=>calls.push({method:'detach'});
 const page={createCDPSession:async()=>cdp,close:async()=>{closed=true;aborted?.()},goto:async()=>{
  if(never)return;
  if(redirect)cdp.emit('Fetch.requestPaused',{requestId:'redirect',resourceType:'Document',request:{url:'https://docs.google.com/export'},responseStatusCode:302,responseHeaders:[]});
  cdp.emit('Fetch.requestPaused',{requestId:'download',resourceType:'Document',request:{url:'https://'+host+'/export'},responseStatusCode:status,responseHeaders:[{name:'Content-Type',value:mime},...(length!==undefined?[{name:'Content-Length',value:String(length)}]:[]),...(encoding?[{name:'Content-Encoding',value:encoding}]:[])]});
  await new Promise(resolve=>aborted=resolve);throw Error('net::ERR_ABORTED');
 }};
 return {browser:{newPage:async()=>page},calls,isClosed:()=>closed};
}

test('Chrome export follows its response redirect and streams CSV without changing shared download settings',async()=>{
 const fixture=fakeBrowser({csv:'stock,item,price\n000123,商品,',redirect:true,host:'doc-example.googleusercontent.com'});
 assert.equal(await readSheetCsv(fixture.browser,sheetExportUrl('synthetic-workbook-012345','7')),'stock,item,price\n000123,商品,');
 assert(fixture.isClosed());assert(fixture.calls.some(c=>c.method==='IO.close'));assert(fixture.calls.some(c=>c.method==='Fetch.continueRequest'));
 assert(!fixture.calls.some(c=>c.method.includes('DownloadBehavior')));
});

test('Chrome export fails on sign-in, HTML, foreign redirects, size limits and deadlines, closing only its own tab',async()=>{
 for(const options of [{status:401},{mime:'text/html'},{csv:'<html>sign in</html>'},{host:'accounts.google.com'},{host:'googleusercontent.com.evil.invalid'},{length:101},{csv:'x'.repeat(101)},{never:true}]){
  const fixture=fakeBrowser(options);
  await assert.rejects(readSheetCsv(fixture.browser,sheetExportUrl('synthetic-workbook-012345','7'),{limit:100,timeout:25}));
  assert(fixture.isClosed());assert(fixture.calls.some(c=>c.method==='detach'));
 }
});

test('tab selection ignores comment badges and waits for both the selected name and changed gid',async()=>{
 let active='Shipping',gid='0',clicked=0,waited=0;
 const element={querySelector:selector=>({textContent:selector==='.docs-sheet-tab-name'?'Inventory':'94Inventory'})};
 const context=()=>({document:{querySelector:()=>({querySelector:()=>({textContent:active})})},location:{hash:'#gid='+gid},URLSearchParams});
 const run=(fn,...args)=>vm.runInNewContext('('+fn.toString()+')(...args)',{...context(),args});
 const page={waitForSelector:async()=>{},evaluate:async fn=>run(fn),$$:async()=>[{evaluate:async(fn,title)=>fn(element,title),click:async()=>{clicked++;active='Inventory'}}],waitForFunction:async(fn,opts,...args)=>{
  assert.equal(run(fn,...args),false,'Old shipping gid must not be accepted after the name changes');waited++;gid='7';assert.equal(run(fn,...args),true);
 }};
 assert.deepEqual({...await selectSheet(page,'Inventory')},{title:'Inventory',gid:'7'});assert.equal(clicked,1);assert.equal(waited,1);
 await assert.rejects(selectSheet(page,'Missing'),/unavailable/);
});

test('a short response with declared identity length is retried, including cuts exactly between rows',async()=>{
 const csv='stock,item,price\n000123,商品,',fixtures=[fakeBrowser({csv,length:Buffer.byteLength(csv)+50}),fakeBrowser({csv,length:Buffer.byteLength(csv)})];let calls=0;
 const result=await readCompleteSheetCsv(null,'unused',{read:()=>readSheetCsv(fixtures[calls++].browser,sheetExportUrl('synthetic-workbook-012345','7'))});
 assert.equal(calls,2);assert.equal(result.csv,csv);assert.equal(result.captureFailures.length,1);assert.equal(result.captureFailures[0].csv,csv);
 assert(fixtures.every(f=>f.isClosed()));
 const compressed=fakeBrowser({csv,length:8,encoding:'gzip'});
 assert.equal(await readSheetCsv(compressed.browser,sheetExportUrl('synthetic-workbook-012345','7')),csv,'Decoded bytes must not be compared with compressed wire length');
});

test('partial final fields and quoted cuts cannot become a usable Google range snapshot',async()=>{
 const complete='date,stock,details\r\n,,\r\n2026/09/27,000123,"line one\nline two"';
 for(const partial of ['date,stock,details\r\n2026/09/27,000123','date,stock,details\r\n2026/09/27,000123,"half']){
  let reads=0;const result=await readCompleteSheetCsv(null,'unused',{read:async()=>++reads===1?partial:complete});
  assert.equal(reads,2);assert.equal(result.csv,complete);assert.equal(result.captureFailures[0].csv,partial);assert.match(result.captureFailures[0].hash,/^[a-f0-9]{64}$/);
  reads=0;await assert.rejects(readCompleteSheetCsv(null,'unused',{read:async()=>{reads++;return partial}}),e=>e.code==='source_incomplete'&&e.captureFailures.length===2);
  assert.equal(reads,2,'A broken source must not create an unlimited browser retry');
 }
 // Blank rows/cells, small sheets and variable column counts remain legitimate.
 for(const csv of ['a,b\n,','a\n""','a,b,c\n1,,','a,b\n"quoted, value","multi\nline"'])validateSheetExportRows(parseSheetCsv(csv));
 assert.doesNotThrow(()=>parseSheetCsv('a,b,c\n1,2'),'General CSV parsing remains permissive');
 let reads=0;await assert.rejects(readCompleteSheetCsv(null,'unused',{read:async()=>{reads++;throw Error('Access denied')}}),/Access denied/);assert.equal(reads,1);
});

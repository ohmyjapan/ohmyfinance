// Intake (購入受付) HTTP checks against the built app on the harness's own ephemeral MongoDB (plan omf-intake-feature-20261016 §4 leg 2).
// Chained by scripts/finance-integration.cjs behind OMF_TEST_INTAKE_ONLY. Synthetic inputs only; every assertion carries an
// `intake:<name>` message so the fixture's mutants can name the assertion they must flip.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({db,call,token,other,deviceToken,origin,pass,root})=>{
 const XLSX=require('xlsx'),iconv=require('iconv-lite'),api='/api/finance-intake/';
 const req=(route,body,method='POST',t=token)=>call(api+route,{method,token:t,body});
 const get=(route,t=token)=>call(api+route,{token:t});
 async function send(route,bytes,type,t=token){const r=await fetch(origin+api+route,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':type},body:bytes,signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data}}
 async function download(route,t=token){const r=await fetch(origin+api+route,{headers:{Authorization:'Bearer '+t},signal:AbortSignal.timeout(20000)});return {status:r.status,bytes:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')}}
 const workbook=rows=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sheet1');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
 const HEAD=['注文番号','商品名','購入金額','購入状況'];
 const ledger=async()=>({transactions:await db.collection('transactions').countDocuments(),financeimports:await db.collection('financeimports').countDocuments(),financedrafts:await db.collection('financedrafts').countDocuments(),financeentries:await db.collection('financeentries').countDocuments()});
 const ledgerBefore=await ledger();
 // 1 authorization and owner scope of the route itself
 assert.equal((await call(api+'records')).status,401,'intake:auth-no-token');
 assert.equal((await call(api+'records',{token:deviceToken})).status,401,'intake:auth-collector-token');
 pass('intake routes require a signed-in user; collector tokens are refused');
 // 2 partial hand entry with defaults
 const created=await req('records',{values:{description:'URLから内容確認'}});assert.equal(created.status,200,'intake:create-partial '+JSON.stringify(created.data));
 let record=created.data;assert.equal(record.values.service,'自社受付','intake:create-default-service');assert.equal(record.values.currency,'JPY','intake:create-default-currency');assert.equal(record.values.purchaseState,'requested','intake:create-default-state');assert.equal(record.values.amount,'','intake:create-partial-amount');assert.equal(record.revision,1,'intake:create-revision');
 const patched=await req('records/'+record.id,{revision:record.revision,values:{amount:'12800',merchant:'Confirmed shop'}},'PATCH');assert.equal(patched.status,200,'intake:patch '+JSON.stringify(patched.data));record=patched.data;assert.equal(record.values.amount,'12800','intake:patch-amount');
 const blank=await req('records/'+record.id,{revision:record.revision,values:{amount:'',merchant:'Shop B'}},'PATCH');assert.equal(blank.status,200,'intake:patch-blank '+JSON.stringify(blank.data));
 assert.equal(blank.data.values.amount,'12800','intake:blank-keeps-value');assert.equal(blank.data.values.merchant,'Shop B','intake:patch-merchant');
 assert.equal((await req('records/'+record.id,{revision:record.revision,values:{amount:'1'}},'PATCH')).status,409,'intake:stale-409');record=blank.data;
 pass('hand entry needs no field, defaults service/currency/state, a blank value keeps the stored one and a stale revision is refused');
 // 3 owner scope on read and write
 assert.equal((await get('records/'+record.id,other)).status,404,'intake:owner-scope-get');
 assert.equal((await req('records/'+record.id,{revision:record.revision,values:{amount:'1'}},'PATCH',other)).status,404,'intake:owner-scope-patch');
 assert.equal((await get('records',other)).data.records.length,0,'intake:owner-scope-list');
 pass('another owner sees no record and can change none');
 // 4 file upload → sheets → guessed mapping → preview → import
 const first=workbook([HEAD,['000012','Item twelve','12800',''],['000013','Item thirteen','￥0','購入済み'],['000014','Item fourteen','-12,800','キャンセル']]);
 const uploaded=await send('files?name=daily.xlsx',first,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(uploaded.status,200,'intake:upload '+JSON.stringify(uploaded.data));
 const doc=uploaded.data.document;assert.deepEqual(doc.sheetNames,['Sheet1'],'intake:upload-lists-sheets');assert.equal(doc.name,'daily.xlsx','intake:upload-name');
 const sheet=await get('files/'+doc.id+'/sheet?sheet=Sheet1&headerRow=1');assert.equal(sheet.status,200,'intake:sheet '+JSON.stringify(sheet.data));
 assert.deepEqual(sheet.data.headers,HEAD,'intake:sheet-headers');assert.equal(sheet.data.rows.length,3,'intake:sheet-rows');assert.equal(sheet.data.rows[0][0],'000012','intake:sheet-zero-prefix');
 assert.equal(sheet.data.mapping.orderId,'0','intake:sheet-guess-orderId');assert.equal(sheet.data.mapping.description,'1','intake:sheet-guess-description');assert.equal(sheet.data.mapping.amount,'2','intake:sheet-guess-amount');assert.equal(sheet.data.mapping.purchaseState,'3','intake:sheet-guess-state');
 const plan={sheet:'Sheet1',headerRow:1,mapping:sheet.data.mapping,defaults:{service:'自社受付',account:'',currency:'JPY'}};
 const preview=await req('files/'+doc.id+'/preview',plan);assert.equal(preview.status,200,'intake:preview '+JSON.stringify(preview.data));assert.equal(preview.data.counts.new,3,'intake:preview-new-3');assert.equal(await db.collection('financeintakerecords').countDocuments(),1,'intake:preview-writes-nothing');
 const imported=await req('files/'+doc.id+'/import',plan);assert.equal(imported.status,200,'intake:import '+JSON.stringify(imported.data));assert.deepEqual([imported.data.batch.counts.new,imported.data.batch.counts.update,imported.data.batch.counts.unchanged,imported.data.batch.counts.conflicts],[3,0,0,0],'intake:import-3');
 let list=(await get('records')).data;assert.equal(list.records.length,4,'intake:list-after-import');
 const twelve=list.records.find(r=>r.values.orderId==='000012'),thirteen=list.records.find(r=>r.values.orderId==='000013'),fourteen=list.records.find(r=>r.values.orderId==='000014');
 assert.ok(twelve&&thirteen&&fourteen,'intake:import-zero-prefix-kept');assert.equal(twelve.values.amount,'12800','intake:import-amount');assert.equal(thirteen.values.amount,'0','intake:import-yen-zero');assert.equal(thirteen.values.purchaseState,'purchased','intake:import-state');assert.equal(fourteen.values.amount,'-12800','intake:import-signed');assert.equal(fourteen.values.purchaseState,'cancelled','intake:import-cancelled');
 assert.equal(twelve.provenance.length,1,'intake:provenance-one');assert.equal(twelve.provenance[0].row,2,'intake:provenance-row');assert.equal(twelve.provenance[0].sheet,'Sheet1','intake:provenance-sheet');
 pass('an Excel file lists its sheets, headers are guessed onto the intake fields, the preview writes nothing and the import creates the rows with identifiers, amounts and states intact');
 // 5 same bytes → same document, unchanged re-import
 const again=await send('files?name=daily-copy.xlsx',first,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(again.status,200,'intake:same-bytes-one-document '+JSON.stringify(again.data));
 assert.equal(again.data.document.id,doc.id,'intake:same-bytes-one-document');assert.equal(await db.collection('financeintakedocuments').countDocuments(),1,'intake:same-bytes-one-document');
 const reimport=await req('files/'+doc.id+'/import',plan);assert.equal(reimport.status,200,'intake:reimport');assert.deepEqual([reimport.data.batch.counts.new,reimport.data.batch.counts.update,reimport.data.batch.counts.unchanged],[0,0,3],'intake:reimport-unchanged');
 assert.equal((await get('records/'+twelve.id)).data.history.length,1,'intake:reimport-history-unchanged');
 pass('the same bytes make one document and a repeated import changes nothing');
 // 6 corrected file: one amount changed, one row purchased, a blank cell keeps the stored value
 const corrected=workbook([HEAD,['000012','','13000',''],['000013','Item thirteen','0','購入済み'],['000014','Item fourteen','-12,800','購入済み']]);
 const second=await send('files?name=daily-corrected.xlsx',corrected,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(second.status,200,'intake:upload-corrected');assert.notEqual(second.data.document.id,doc.id,'intake:corrected-new-document');
 const correctedImport=await req('files/'+second.data.document.id+'/import',plan);assert.equal(correctedImport.status,200,'intake:corrected-import '+JSON.stringify(correctedImport.data));
 // A new file is new provenance for every row it carries (model rule "revised source documents append provenance"): 000012 and
 // 000014 change values, 000013 is a provenance-only update; none is "unchanged" and none is new.
 assert.deepEqual([correctedImport.data.batch.counts.new,correctedImport.data.batch.counts.update,correctedImport.data.batch.counts.unchanged],[0,3,0],'intake:corrected-update-3');
 const thirteenNow=(await get('records/'+thirteen.id)).data;assert.equal(thirteenNow.history.at(-1).changes.length,0,'intake:corrected-provenance-only');assert.equal(thirteenNow.provenance.length,2,'intake:corrected-provenance-appended');assert.equal(thirteenNow.values.amount,'0','intake:corrected-unchanged-values');
 const twelveNow=(await get('records/'+twelve.id)).data;assert.equal(twelveNow.values.amount,'13000','intake:corrected-amount');assert.equal(twelveNow.values.description,'Item twelve','intake:blank-cell-keeps-description');assert.equal(twelveNow.provenance.length,2,'intake:corrected-provenance');assert.equal(twelveNow.history.length,2,'intake:corrected-history');
 assert.equal(twelveNow.history.at(-1).changes.find(c=>c.field==='amount').before,'12800','intake:corrected-history-before');
 const fourteenNow=(await get('records/'+fourteen.id)).data;assert.equal(fourteenNow.values.purchaseState,'purchased','intake:corrected-state');assert.equal(fourteenNow.values.amount,'-12800','intake:corrected-unchanged-amount');
 assert.equal(await db.collection('financeintakerecords').countDocuments(),4,'intake:corrected-no-duplicates');
 pass('a corrected file updates only what changed, a blank cell never wipes a known value and the record keeps both source files');
 // 7 original files download byte-equal and stay owner-scoped
 const original=await download('documents/'+doc.id+'/file');assert.equal(original.status,200,'intake:download');assert.ok(original.bytes.equals(first),'intake:download-byte-equal');
 assert.equal((await download('documents/'+doc.id+'/file',other)).status,404,'intake:owner-scope-file');
 pass('the uploaded original downloads byte-equal and another owner cannot fetch it');
 // 8 attachments: PNG accepted and byte-equal, text as application/zip refused
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic png body')]);
 const attached=await send('records/'+record.id+'/documents?name=photo.png&kind=attachment',png,'image/png');assert.equal(attached.status,200,'intake:attach-png '+JSON.stringify(attached.data));
 assert.equal(attached.data.attachments.length,1,'intake:attachment-listed');assert.equal(attached.data.attachments[0].name,'photo.png','intake:attachment-name');
 const pngBack=await download('documents/'+attached.data.attachments[0].id+'/file');assert.equal(pngBack.status,200,'intake:attachment-download');assert.ok(pngBack.bytes.equals(png),'intake:attachment-byte-equal');assert.equal(pngBack.type,'image/png','intake:attachment-type');
 assert.equal((await send('records/'+record.id+'/documents?name=x.zip&kind=attachment',Buffer.from('hello'),'application/zip')).status,415,'intake:zip-text-415');
 assert.equal((await send('records/'+record.id+'/documents?name=photo.png&kind=attachment',png,'image/png',other)).status,404,'intake:owner-scope-attach');
 pass('a PNG attaches and downloads byte-equal; text sent as a zip is refused; another owner cannot attach');
 // 9 CSV in UTF-8 and in Shift_JIS read the same headers
 const csvText=[HEAD.join(','),'000015,日本語の商品,500,'].join('\r\n');
 const utf8=await send('files?name=utf8.csv',Buffer.from(csvText,'utf8'),'text/csv');assert.equal(utf8.status,200,'intake:csv-utf8 '+JSON.stringify(utf8.data));
 const utf8Sheet=(await get('files/'+utf8.data.document.id+'/sheet')).data;assert.deepEqual(utf8Sheet.headers,HEAD,'intake:csv-utf8-headers');assert.equal(utf8Sheet.rows[0][1],'日本語の商品','intake:csv-utf8-row');
 const sjisBytes=iconv.encode(csvText,'shift_jis');assert.throws(()=>new TextDecoder('utf-8',{fatal:true}).decode(sjisBytes),'intake:sjis-is-not-utf8');
 const sjis=await send('files?name=sjis.csv',sjisBytes,'text/csv');assert.equal(sjis.status,200,'intake:csv-sjis '+JSON.stringify(sjis.data));
 const sjisSheet=(await get('files/'+sjis.data.document.id+'/sheet')).data;assert.deepEqual(sjisSheet.headers,HEAD,'intake:csv-sjis-headers');assert.equal(sjisSheet.rows[0][1],'日本語の商品','intake:csv-sjis-row');assert.equal(sjisSheet.rows[0][0],'000015','intake:csv-sjis-zero-prefix');
 pass('CSV files are read in UTF-8 first and Shift_JIS second with the same headers and values');
 // 10 archive hides, the filter shows, restore returns
 const latest=(await get('records/'+record.id)).data;const archived=await req('records/'+record.id+'/archive',{revision:latest.revision,archived:true},'PUT');assert.equal(archived.status,200,'intake:archive '+JSON.stringify(archived.data));assert.equal(archived.data.archived,true,'intake:archived-flag');
 list=(await get('records')).data;assert.equal(list.records.some(r=>r.id===record.id),false,'intake:archive-hides');assert.equal(list.counts.archived,1,'intake:archive-count');
 list=(await get('records?archived=1')).data;assert.equal(list.records.some(r=>r.id===record.id),true,'intake:archive-filter-shows');
 const restored=await req('records/'+record.id+'/archive',{revision:archived.data.revision,archived:false},'PUT');assert.equal(restored.status,200,'intake:restore');assert.equal(restored.data.archived,false,'intake:restored-flag');
 assert.equal((await get('records')).data.records.some(r=>r.id===record.id),true,'intake:restore-visible');
 pass('an archived record leaves the list, shows under the archive filter and comes back on restore');
 // 11 templates saved with an import and listed; batches listed
 const withTemplate=await req('files/'+second.data.document.id+'/import',{...plan,template:{name:'日次シート'}});assert.equal(withTemplate.status,200,'intake:import-template '+JSON.stringify(withTemplate.data));
 const templates=(await get('templates')).data.templates;assert.equal(templates.length,1,'intake:template-listed');assert.equal(templates[0].name,'日次シート','intake:template-name');assert.deepEqual(templates[0].headers,HEAD,'intake:template-headers');assert.equal(templates[0].mapping.orderId,'0','intake:template-mapping');assert.equal(templates[0].service,'自社受付','intake:template-service');
 const saved=await req('templates',{name:'日次シート',service:'DEJAPAN',account:'main',currency:'JPY',headers:HEAD,mapping:plan.mapping},'PUT');assert.equal(saved.status,200,'intake:template-put '+JSON.stringify(saved.data));assert.equal(saved.data.template.revision,2,'intake:template-revision');assert.equal(saved.data.template.service,'DEJAPAN','intake:template-updated');
 assert.equal((await get('templates',other)).data.templates.length,0,'intake:owner-scope-templates');
 const batches=(await get('batches')).data.batches;assert.equal(batches.length,4,'intake:batches-listed');assert.equal(batches[0].counts.new+batches[0].counts.update+batches[0].counts.unchanged,3,'intake:batch-counts');
 pass('a column template is saved with the import, listed for its owner only and revised on save; every import batch is listed');
 // 12 the ledger and the legacy import collections never move
 assert.deepEqual(await ledger(),ledgerBefore,'intake:ledger-untouched');
 pass('intake writes no transaction, finance import, draft or entry');
};

// Intake (購入受付) HTTP checks against the built app on the harness's own ephemeral MongoDB (plan omf-intake-feature-20261016 §4 leg 2).
// Chained by scripts/finance-integration.cjs behind OMF_TEST_INTAKE_ONLY. Synthetic inputs only; every assertion carries an
// `intake:<name>` message so the fixture's mutants can name the assertion they must flip.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({db,call,token,other,deviceToken,origin,pass,root,pause})=>{
 const XLSX=require('xlsx'),iconv=require('iconv-lite'),api='/api/finance-intake/';
 const crypto=require('node:crypto'),fsp=require('node:fs/promises'),os=require('node:os'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{ObjectId}=require('mongodb');
 const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sha=t=>crypto.createHash('sha256').update(t).digest('hex'),rid=()=>crypto.randomUUID();
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

 // ── plan omf-intake-mapping-research-amended-20261017 §4 legs 13-20 ─────────────────────────────────────────────────────
 // 13 the eight owner fields: hand entry (fail-first: 400 '不明な項目' on externalOrderId), eight-column file → guessed mapping →
 //    preview → import with exact values ('000021' kept, 税額 '0', 手数料 '-500', ¥/comma cleaned)
 const made=await req('records',{values:{description:'Eight-field entry',externalOrderId:'EXT-000001',merchantUrl:'https://shop.example.invalid/items/1',itemPrice:'¥1,000',tax:'￥0',shippingFee:'1,200',otherFee:'-500'}});
 assert.equal(made.status,200,'intake:eight-create '+JSON.stringify(made.data));
 assert.deepEqual([made.data.values.externalOrderId,made.data.values.itemPrice,made.data.values.tax,made.data.values.shippingFee,made.data.values.otherFee,made.data.values.supplierName,made.data.values.invoiceNumber],['EXT-000001','1000','0','1200','-500','',''],'intake:eight-create-values');
 const HEAD8=['注文番号','商品ID','外部注文番号','URL','商品価格','税額','送料','手数料','担当者'];
 const eightRows=[['000021','A-01','EXT-21','https://shop.example.invalid/items/21','¥12,800','0','600','-500','山田'],['000022','B-02','EXT-22','https://shop.example.invalid/items/22','1,000','100','0','','佐藤']];
 const eight=workbook([HEAD8,...eightRows]);
 const up8=await send('files?name=eight.xlsx',eight,XLSX_TYPE);assert.equal(up8.status,200,'intake:eight-upload '+JSON.stringify(up8.data));const doc8=up8.data.document;
 const sh8=(await get('files/'+doc8.id+'/sheet')).data;
 assert.deepEqual([sh8.mapping.orderId,sh8.mapping.itemId,sh8.mapping.externalOrderId,sh8.mapping.merchantUrl,sh8.mapping.itemPrice,sh8.mapping.tax,sh8.mapping.shippingFee,sh8.mapping.otherFee],['0','1','2','3','4','5','6','7'],'intake:guess-eight '+JSON.stringify(sh8.mapping));
 assert.ok(!Object.values(sh8.mapping).includes('8'),'intake:guess-extra-unmapped');
 const plan8={sheet:'Sheet1',headerRow:1,mapping:sh8.mapping,defaults:{service:'DEJAPAN',account:'main',currency:'JPY'}};
 const prev8=await req('files/'+doc8.id+'/preview',plan8);assert.equal(prev8.status,200,'intake:eight-preview '+JSON.stringify(prev8.data));assert.equal(prev8.data.counts.new,2,'intake:eight-preview-new');
 const p21=prev8.data.rows.find(r=>r.values.orderId==='000021');assert.ok(p21,'intake:eight-preview-row');
 assert.deepEqual([p21.values.itemId,p21.values.externalOrderId,p21.values.merchantUrl,p21.values.itemPrice,p21.values.tax,p21.values.shippingFee,p21.values.otherFee],['A-01','EXT-21','https://shop.example.invalid/items/21','12800','0','600','-500'],'intake:eight-preview-values');
 const imp8=await req('files/'+doc8.id+'/import',plan8);assert.equal(imp8.status,200,'intake:eight-import '+JSON.stringify(imp8.data));assert.deepEqual([imp8.data.batch.counts.new,imp8.data.batch.counts.update,imp8.data.batch.counts.unchanged],[2,0,0],'intake:eight-import-2');
 const byOrder=async(orderId,service='DEJAPAN')=>(await get('records')).data.records.find(r=>r.values.orderId===orderId&&r.values.service===service);
 let r21=await byOrder('000021'),r22=await byOrder('000022');assert.ok(r21&&r22,'intake:eight-imported');
 assert.equal(r21.values.tax,'0','intake:eight-tax-zero');assert.equal(r21.values.otherFee,'-500','intake:eight-fee-negative');assert.equal(r21.values.itemPrice,'12800','intake:eight-price-cleaned');assert.equal(r21.values.externalOrderId,'EXT-21','intake:eight-external-kept');assert.equal(r21.values.merchantUrl,'https://shop.example.invalid/items/21','intake:eight-url');assert.equal(r21.values.account,'main','intake:eight-default-account');
 assert.equal(r22.values.otherFee,'','intake:eight-blank-fee');assert.equal(r22.values.shippingFee,'0','intake:eight-shipping-zero');assert.equal(r22.values.itemPrice,'1000','intake:eight-price-comma');
 assert.deepEqual(r21.extra,{},'intake:eight-no-extra-yet');
 pass('the eight owner fields are accepted by hand and from a file: headers guessed, ¥/comma cleaned, zero and negative amounts and identifiers kept exactly');
 // 14 extra columns: mapped by name, kept on a blank cell, labelled extra:<name> in history, carried by templates, edited by PATCH
 const extras=[{name:'担当者',column:'8'}],plan8x={...plan8,extras};
 const prevX=await req('files/'+doc8.id+'/preview',plan8x);assert.equal(prevX.status,200,'intake:extras-preview '+JSON.stringify(prevX.data));
 assert.deepEqual(prevX.data.extras,extras,'intake:extras-echo');assert.equal(prevX.data.rows.find(r=>r.values.orderId==='000021').extra['担当者'],'山田','intake:extras-preview-value');
 assert.ok(prevX.data.rows.find(r=>r.values.orderId==='000021').changes.some(c=>c.field==='extra:担当者'&&c.before===''&&c.after==='山田'),'intake:extras-change-labelled');
 const impX=await req('files/'+doc8.id+'/import',{...plan8x,template:{name:'八項目'}});assert.equal(impX.status,200,'intake:extras-import '+JSON.stringify(impX.data));assert.deepEqual([impX.data.batch.counts.new,impX.data.batch.counts.update,impX.data.batch.counts.unchanged],[0,2,0],'intake:extras-import-update');
 assert.deepEqual(impX.data.batch.extras,extras,'intake:batch-extras');assert.deepEqual(impX.data.template.extras,extras,'intake:template-extras');
 r21=await byOrder('000021');assert.equal(r21.extra['担当者'],'山田','intake:extras-imported');assert.equal(r21.history.at(-1).changes.find(c=>c.field==='extra:担当者')?.after,'山田','intake:extras-history');
 const templatesX=(await get('templates')).data.templates;assert.deepEqual(templatesX.find(t=>t.name==='八項目').extras,extras,'intake:template-listed-extras');
 const correctedRows=[['000021','A-01','EXT-21','https://shop.example.invalid/items/21','¥12,800','10','600','-500',''],['000022','B-02','EXT-22','https://shop.example.invalid/items/22','1,000','100','0','','鈴木']];
 const upC=await send('files?name=eight-corrected.xlsx',workbook([HEAD8,...correctedRows]),XLSX_TYPE);assert.equal(upC.status,200,'intake:extras-corrected-upload');
 const impC=await req('files/'+upC.data.document.id+'/import',plan8x);assert.equal(impC.status,200,'intake:extras-corrected-import '+JSON.stringify(impC.data));assert.deepEqual([impC.data.batch.counts.new,impC.data.batch.counts.update,impC.data.batch.counts.unchanged],[0,2,0],'intake:extras-corrected-update');
 r21=await byOrder('000021');r22=await byOrder('000022');
 assert.equal(r21.extra['担当者'],'山田','intake:blank-extra-keeps');assert.equal(r21.values.tax,'10','intake:extras-corrected-tax');assert.equal(r22.extra['担当者'],'鈴木','intake:extras-updated');
 const impAgain=await req('files/'+upC.data.document.id+'/import',plan8x);assert.deepEqual([impAgain.data.batch.counts.new,impAgain.data.batch.counts.update,impAgain.data.batch.counts.unchanged],[0,0,2],'intake:extras-repeat-unchanged');
 const patchedX=await req('records/'+r21.id,{revision:r21.revision,values:{},extra:{'担当者':'高橋','メモ2':'x'}},'PATCH');assert.equal(patchedX.status,200,'intake:patch-extra '+JSON.stringify(patchedX.data));
 assert.equal(patchedX.data.extra['担当者'],'高橋','intake:patch-extra-value');assert.equal(patchedX.data.extra['メモ2'],'x','intake:patch-extra-new');assert.equal(patchedX.data.history.at(-1).kind,'edit','intake:patch-extra-history-kind');assert.ok(patchedX.data.history.at(-1).changes.some(c=>c.field==='extra:担当者'&&c.before==='山田'&&c.after==='高橋'),'intake:patch-extra-history');
 const patchedBlank=await req('records/'+r21.id,{revision:patchedX.data.revision,values:{},extra:{'担当者':''}},'PATCH');assert.equal(patchedBlank.status,200,'intake:patch-extra-blank');assert.equal(patchedBlank.data.extra['担当者'],'高橋','intake:patch-extra-blank-keeps');
 assert.equal((await req('files/'+doc8.id+'/preview',{...plan8,extras:[{name:'',column:'8'}]})).status,400,'intake:extras-bad-name');
 assert.equal((await req('files/'+doc8.id+'/preview',{...plan8,extras:[{name:'x',column:'99'}]})).status,400,'intake:extras-bad-column');
 assert.equal((await req('files/'+doc8.id+'/preview',{...plan8,extras:[{name:'a',column:'8'},{name:'a',column:'7'}]})).status,400,'intake:extras-duplicate');
 assert.equal((await req('files/'+doc8.id+'/preview',{...plan8,extras:[{name:'amount',column:'8'}]})).status,400,'intake:extras-fixed-field-name');
 assert.equal((await req('records/'+r21.id,{revision:patchedBlank.data.revision,values:{},extra:{'':'x'}},'PATCH')).status,400,'intake:patch-extra-bad');
 const createdX=await req('records',{values:{description:'with extra'},extra:{'担当者':'田中'}});assert.equal(createdX.status,200,'intake:create-extra');assert.equal(createdX.data.extra['担当者'],'田中','intake:create-extra-value');
 const putX=await req('templates',{name:'八項目',service:'DEJAPAN',account:'main',currency:'JPY',headers:HEAD8,mapping:sh8.mapping,extras:[{name:'担当者',column:'8'},{name:'備考2',column:'1'}]},'PUT');assert.equal(putX.status,200,'intake:template-put-extras '+JSON.stringify(putX.data));assert.equal(putX.data.template.extras.length,2,'intake:template-put-extras-count');
 const onlyExtras=await req('templates',{name:'追加のみ',headers:HEAD8,mapping:{},extras:[{name:'担当者',column:'8'}]},'PUT');assert.equal(onlyExtras.status,200,'intake:template-extras-only '+JSON.stringify(onlyExtras.data));
 const previewOnlyExtras=await req('files/'+doc8.id+'/preview',{...plan8,mapping:{},extras});assert.equal(previewOnlyExtras.status,200,'intake:preview-extras-only');
 pass('extra columns are mapped by name, a blank extra cell keeps the stored value, changes are labelled extra:<name>, templates and batches carry the extras and PATCH edits them');

 // 15 research: queue → worker intake claim → result (good / bad quote / wrong registry date) → ready + verified → confirm saves the values
 const account=await db.collection('financialaccounts').findOne({name:'Synthetic Amex'});
 const researchBefore={financeresearches:await db.collection('financeresearches').countDocuments(),suppliers:await db.collection('suppliers').countDocuments()};
 const agentRes=await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],researchEnabled:true}});assert.equal(agentRes.status,200,'intake-research:agent '+JSON.stringify(agentRes.data));
 const worker=agentRes.data.token,agentId=new ObjectId(agentRes.data.id),wcall=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:worker,body});
 const settingsUrl='http://127.0.0.1:54321/setup/'+'a'.repeat(64),statusNew=()=>wcall('status',{settingsUrl,ntaConfigured:false,intakeResearch:true});
 const rget=(recId,t=token)=>get('records/'+recId+'/research',t);
 const rqueue=(rec,researchRevision,instruction='',t=token,requestId=rid())=>req('records/'+rec.id+'/research',{revision:rec.revision,researchRevision,requestId,instruction},'POST',t);
 const rconfirm=(rec,researchRevision,t=token,confirm=true)=>req('records/'+rec.id+'/research/confirm',{revision:rec.revision,researchRevision,confirm},'POST',t);
 const rr=await req('records',{values:{description:'Intake research item',merchant:'Synthetic Intake Shop',merchantUrl:'https://shop.example.invalid/items/1',purchaseDate:'2026-10-01'}});assert.equal(rr.status,200,'intake-research:record');let rec=rr.data;
 const noUrl=(await req('records',{values:{description:'no url'}})).data;
 assert.equal((await call(api+'records/'+rec.id+'/research')).status,401,'intake-research:auth');
 let view=(await rget(rec.id)).data;assert.equal(view.research,null,'intake-research:idle-null');assert.equal(view.connected,false,'intake-research:not-connected-before-heartbeat');assert.equal(view.settings,null,'intake-research:settings-null');
 assert.equal((await rqueue(rec,0)).status,409,'intake-research:queue-not-connected');
 assert.equal((await wcall('status',{settingsUrl,ntaConfigured:false})).status,200,'intake-research:status-old');
 view=(await rget(rec.id)).data;assert.equal(view.connected,true,'intake-research:connected-after-status');assert.equal(view.settings.intakeResearch,undefined,'intake-research:settings-old');
 const oldWorker=await rqueue(rec,0);assert.equal(oldWorker.status,409,'intake-research:queue-old-worker');assert.match(JSON.stringify(oldWorker.data),/ワーカーの更新/,'intake-research:queue-old-worker-text');
 assert.equal((await wcall('status',{settingsUrl,ntaConfigured:false,intakeResearch:'yes'})).status,400,'intake-research:status-bad-flag');
 assert.equal((await statusNew()).status,200,'intake-research:status-new');
 view=(await rget(rec.id)).data;assert.equal(view.settings.intakeResearch,true,'intake-research:settings-new');assert.equal(view.settings.ntaConfigured,false,'intake-research:settings-nta');
 assert.equal((await rqueue(noUrl,0)).status,400,'intake-research:queue-no-url');
 const httpRecord=await req('records',{values:{description:'Non-HTTPS research URL',merchantUrl:'http://shop.example.invalid/company'}});assert.equal(httpRecord.status,200,'intake-research:http-record');
 const nonHttps=await rqueue(httpRecord.data,0);assert.equal(nonHttps.status,400,'intake-research:queue-non-https');assert.match(JSON.stringify(nonHttps.data),/URLを確認/,'intake-research:queue-non-https-text');
 assert.equal((await rqueue({id:rec.id,revision:rec.revision+1},0)).status,409,'intake-research:queue-stale-record');
 assert.equal((await rqueue(rec,0,'',token,'nope')).status,400,'intake-research:queue-bad-request');
 assert.equal((await rqueue(rec,0,'x'.repeat(2001))).status,400,'intake-research:queue-long-instruction');
 assert.equal((await rqueue(rec,5)).status,409,'intake-research:queue-research-revision');
 const requestId=rid();const queued=await rqueue(rec,0,'補足の説明',token,requestId);assert.equal(queued.status,200,'intake-research:queued '+JSON.stringify(queued.data));
 assert.equal(queued.data.research.state,'queued','intake-research:queued-state');assert.equal(queued.data.research.failure,'','intake-research:queued-no-failure');assert.equal(queued.data.research.revision,1,'intake-research:queued-revision');assert.equal(queued.data.stale,false,'intake-research:queued-not-stale');
 assert.equal((await rqueue(rec,0,'補足の説明',token,requestId)).data.research.revision,1,'intake-research:idempotent');
 assert.equal((await rqueue(rec,0,'違う説明',token,requestId)).status,409,'intake-research:request-id-reused');
 assert.equal((await rqueue(rec,1)).status,409,'intake-research:queue-while-active');
 assert.equal((await wcall('claim')).data.job,null,'intake-research:statement-claim-null');
 assert.equal((await wcall('evaluation/claim')).data.job,null,'intake-research:evaluation-claim-null');
 const legacy=await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)]}});assert.equal((await call('/api/finance-research/worker/intake/claim',{method:'POST',token:legacy.data.token,body:{}})).status,403,'intake-research:claim-needs-capability');
 const claimed=await wcall('intake/claim');assert.equal(claimed.status,200,'intake-research:claim '+JSON.stringify(claimed.data));const job=claimed.data.job;assert.ok(job,'intake-research:claimed');
 assert.equal(job.mode,'intake','intake-research:job-mode');assert.equal(job.context.kind,'intake','intake-research:job-context-kind');assert.equal(job.context.source.merchantUrl,'https://shop.example.invalid/items/1','intake-research:job-url');assert.equal(job.context.source.purchaseDate,'2026-10-01','intake-research:job-date');
 assert.equal(job.context.values.date,'2026-10-01','intake-research:job-values-draft-shaped');assert.equal(job.context.values.purpose,'unresolved','intake-research:job-values-purpose');assert.deepEqual(job.context.documents,[],'intake-research:job-no-documents');
 assert.equal(job.sources.length,1,'intake-research:job-one-source');assert.equal(job.sources[0].id,'s0','intake-research:job-s0');assert.match(job.instruction,/登録番号/,'intake-research:instruction-fixed');assert.match(job.instruction,/補足の説明/,'intake-research:instruction-owner-text');
 assert.equal((await wcall('intake/claim')).data.job,null,'intake-research:second-claim-null');
 view=(await rget(rec.id)).data;assert.equal(view.research.state,'working','intake-research:working');
 assert.equal((await wcall('intake/'+job.id+'/progress',{lease:job.lease,stage:'web'})).status,200,'intake-research:progress');
 assert.equal((await wcall('intake/'+job.id+'/progress',{lease:job.lease,stage:'bogus'})).status,400,'intake-research:progress-bad-stage');
 assert.equal((await wcall('intake/'+job.id+'/progress',{lease:'wrong',stage:'web'})).status,409,'intake-research:progress-wrong-lease');
 assert.equal((await wcall('intake/'+job.id+'/result',{lease:'wrong',failed:true})).status,409,'intake-research:wrong-lease');
 assert.equal((await wcall('intake/'+job.id+'/document',{lease:job.lease,documentId:'x'})).status,404,'intake-research:no-document-route');
 const pageText='Synthetic Intake Shop 株式会社 T1234567890123 特定商取引法に基づく表記';
 const webSource=(id,text,url='https://shop.example.invalid/company')=>({id,kind:'web',title:'Synthetic Intake Shop 会社概要',url,text,hash:sha(text),capturedAt:new Date().toISOString()});
 const registrySource=(id,number,name)=>{const t=JSON.stringify({count:'1',announcement:[{registratedNumber:number,name,registrationDate:'2023-10-01',disposalDate:'',expireDate:'',address:'Synthetic address'}]});return {id,kind:'registry',title:'国税庁 登録番号・基準日照合',url:'https://web-api.invoice-kohyo.nta.go.jp/1/valid',text:t,hash:sha(t),capturedAt:new Date().toISOString()}};
 const supplierOf=(quote,invoiceNumber='T1234567890123')=>({shopName:'Synthetic Intake Shop',legalName:'Synthetic Intake Shop 株式会社',invoiceNumber,citations:[{sourceId:'s1',quote}]});
 const report={summary:'会社名と登録番号を確認しました。',question:'',findings:[],supplier:supplierOf(pageText)};
 assert.equal((await wcall('intake/'+job.id+'/result',{lease:job.lease,sources:[...job.sources,webSource('s1',pageText)],report:{...report,supplier:supplierOf('invented quote')}})).status,400,'intake-research:bad-quote-400');
 assert.equal((await wcall('intake/'+job.id+'/result',{lease:job.lease,sources:[{...job.sources[0],text:'tampered'},webSource('s1',pageText)],report})).status,400,'intake-research:context-tampered-400');
 assert.equal((await wcall('intake/'+job.id+'/result',{lease:job.lease,sources:[...job.sources,webSource('s1',pageText),registrySource('s2','T1234567890123','Synthetic Intake Shop 株式会社')],report,registry:{sourceId:'s2',number:'T1234567890123',date:'2026-10-02'}})).status,400,'intake-research:registry-wrong-date');
 const done=await wcall('intake/'+job.id+'/result',{lease:job.lease,sources:[...job.sources,webSource('s1',pageText),registrySource('s2','T1234567890123','Synthetic Intake Shop 株式会社')],report,registry:{sourceId:'s2',number:'T1234567890123',date:job.context.source.purchaseDate}});assert.equal(done.status,200,'intake-research:result '+JSON.stringify(done.data));
 assert.equal((await wcall('intake/'+job.id+'/result',{lease:job.lease,failed:true})).status,409,'intake-research:result-twice');
 view=(await rget(rec.id)).data;assert.equal(view.research.state,'ready','intake-research:ready');assert.equal(view.research.verified,true,'intake-research:verified');assert.equal(view.research.registry.active,true,'intake-research:registry-active');assert.equal(view.research.registry.asOf,'2026-10-01','intake-research:registry-asof');
 assert.equal(view.research.report.supplier.legalName,'Synthetic Intake Shop 株式会社','intake-research:supplier-name');assert.equal(view.research.sources.length,3,'intake-research:sources-kept');assert.equal(view.stale,false,'intake-research:not-stale');assert.equal(view.research.events.at(-1).stage,'web','intake-research:events');
 rec=(await get('records/'+rec.id)).data;assert.equal(rec.values.supplierName,'','intake-research:not-saved-before-confirm');assert.equal(rec.revision,1,'intake-research:record-revision-unchanged');
 assert.equal((await rconfirm({id:rec.id,revision:rec.revision+1},view.research.revision)).status,409,'intake-research:confirm-stale-record');
 assert.equal((await rconfirm(rec,view.research.revision+1)).status,409,'intake-research:confirm-stale-research');
 assert.equal((await rconfirm(rec,view.research.revision,token,false)).status,409,'intake-research:confirm-needs-confirm');
 const confirmed=await rconfirm(rec,view.research.revision);assert.equal(confirmed.status,200,'intake-research:confirm '+JSON.stringify(confirmed.data));
 assert.equal(confirmed.data.record.values.supplierName,'Synthetic Intake Shop 株式会社','intake-research:saved-supplier');assert.equal(confirmed.data.record.values.invoiceNumber,'T1234567890123','intake-research:saved-number');assert.equal(confirmed.data.record.revision,2,'intake-research:record-revision-bumped');
 const researchHistory=confirmed.data.record.history.at(-1);assert.equal(researchHistory.kind,'research','intake-research:history-kind');assert.equal(researchHistory.verified,true,'intake-research:history-verified');assert.ok(researchHistory.changes.some(c=>c.field==='supplierName'&&c.after==='Synthetic Intake Shop 株式会社'),'intake-research:history-change');
 assert.equal(confirmed.data.research.state,'confirmed','intake-research:confirmed-state');assert.equal(confirmed.data.research.confirmed.verified,true,'intake-research:confirmed-flag');assert.equal(confirmed.data.stale,false,'intake-research:confirmed-not-stale');
 rec=confirmed.data.record;assert.equal((await rconfirm(rec,confirmed.data.research.revision)).status,409,'intake-research:confirm-twice');
 const edited=await req('records/'+rec.id,{revision:rec.revision,values:{merchantUrl:'https://shop.example.invalid/items/1b'}},'PATCH');assert.equal(edited.status,200,'intake-research:edit-after-confirm');rec=edited.data;
 const requeued=await rqueue(rec,confirmed.data.research.revision);assert.equal(requeued.status,200,'intake-research:requeue-after-confirm '+JSON.stringify(requeued.data));assert.equal(requeued.data.research.state,'queued','intake-research:requeued');assert.equal(requeued.data.research.history.length,1,'intake-research:history-kept-after-confirm');assert.equal(requeued.data.research.history[0].confirmed?.verified,true,'intake-research:history-carries-confirm');
 const job1b=(await wcall('intake/claim')).data.job;assert.ok(job1b,'intake-research:requeue-claimed');assert.equal(job1b.context.source.merchantUrl,'https://shop.example.invalid/items/1b','intake-research:requeue-new-url');assert.equal(job1b.context.recordRevision,rec.revision,'intake-research:requeue-record-revision');
 assert.equal((await wcall('intake/'+job1b.id+'/result',{lease:job1b.lease,sources:[...job1b.sources,webSource('s1',pageText)],report})).status,200,'intake-research:requeue-result');
 const staleEdit=await req('records/'+rec.id,{revision:rec.revision,values:{merchantUrl:'https://shop.example.invalid/items/1c'}},'PATCH');assert.equal(staleEdit.status,200,'intake-research:edit-after-ready');rec=staleEdit.data;
 view=(await rget(rec.id)).data;assert.equal(view.research.state,'ready','intake-research:ready-after-edit');assert.equal(view.stale,true,'intake-research:stale-after-edit');
 assert.equal((await rconfirm(rec,view.research.revision)).status,409,'intake-research:confirm-stale-context');
 pass('research: an updated connected worker is required to queue, claims are intake-only and exclusive, citations, the context and the registry date are checked, a verified result is confirmed into the record once and a later edit makes it stale');

 // 16 no supplier / failed / registry mismatch (number, then name)
 const rr2=await req('records',{values:{description:'Two',merchantUrl:'https://two.example.invalid/'}});assert.equal(rr2.status,200,'intake-research:record-two');let rec2=rr2.data;
 const q2=await rqueue(rec2,0);assert.equal(q2.status,200,'intake-research:queue-two '+JSON.stringify(q2.data));
 let job2=(await wcall('intake/claim')).data.job;assert.ok(job2,'intake-research:claim-two');assert.match(job2.context.source.purchaseDate,/^\d{4}-\d{2}-\d{2}$/,'intake-research:today-jst');assert.equal(job2.context.merchant,'two.example.invalid','intake-research:merchant-from-hostname');
 const twoText='Two shop page without a company name',twoWeb=webSource('s1',twoText,'https://two.example.invalid/about');
 assert.equal((await wcall('intake/'+job2.id+'/result',{lease:job2.lease,sources:[...job2.sources,twoWeb],report:{summary:'販売者を特定できませんでした。',question:'',findings:[],supplier:null}})).status,200,'intake-research:result-no-supplier');
 view=(await rget(rec2.id)).data;assert.equal(view.research.state,'ready','intake-research:ready-no-supplier');assert.equal(view.research.report.supplier,null,'intake-research:supplier-null');assert.equal(view.research.verified,false,'intake-research:unverified-null');
 assert.equal((await rconfirm(rec2,view.research.revision)).status,409,'intake-research:confirm-no-supplier');rec2=(await get('records/'+rec2.id)).data;assert.equal(rec2.values.supplierName,'','intake-research:nothing-written');assert.equal(rec2.revision,1,'intake-research:no-supplier-revision');
 const q2b=await rqueue(rec2,view.research.revision);assert.equal(q2b.status,200,'intake-research:requeue-two');assert.equal(q2b.data.research.history.length,1,'intake-research:history-kept');assert.equal(q2b.data.research.history[0].report.supplier,null,'intake-research:history-report');
 job2=(await wcall('intake/claim')).data.job;assert.ok(job2,'intake-research:claim-two-b');
 assert.equal((await wcall('intake/'+job2.id+'/result',{lease:job2.lease,failed:true,diagnostic:{code:'timed_out',correctionAttempted:false}})).status,200,'intake-research:result-failed');
 view=(await rget(rec2.id)).data;assert.equal(view.research.state,'failed','intake-research:failed-state');assert.equal(view.research.failure,'research_failed','intake-research:failed-flag');
 const q2c=await rqueue(rec2,view.research.revision);assert.equal(q2c.status,200,'intake-research:requeue-after-failed');assert.equal(q2c.data.research.history.length,2,'intake-research:history-failed-kept');assert.equal(q2c.data.research.history[1].failure,'research_failed','intake-research:history-failure');assert.equal(q2c.data.research.failure,'','intake-research:requeue-clears-failure');
 job2=(await wcall('intake/claim')).data.job;assert.ok(job2,'intake-research:claim-two-c');
 const mismatchDone=await wcall('intake/'+job2.id+'/result',{lease:job2.lease,sources:[...job2.sources,webSource('s1',pageText,'https://two.example.invalid/company'),registrySource('s2','T9999999999999','Synthetic Intake Shop 株式会社')],report,registry:{sourceId:'s2',number:'T9999999999999',date:job2.context.source.purchaseDate}});assert.equal(mismatchDone.status,200,'intake-research:result-number-mismatch '+JSON.stringify(mismatchDone.data));
 view=(await rget(rec2.id)).data;assert.equal(view.research.state,'ready','intake-research:ready-mismatch');assert.equal(view.research.registry.active,true,'intake-research:mismatch-registry-active');assert.equal(view.research.verified,false,'intake-research:unverified-mismatch');
 const confirmedUnverified=await rconfirm(rec2,view.research.revision);assert.equal(confirmedUnverified.status,200,'intake-research:confirm-unverified '+JSON.stringify(confirmedUnverified.data));
 assert.equal(confirmedUnverified.data.record.values.supplierName,'Synthetic Intake Shop 株式会社','intake-research:unverified-saved-name');assert.equal(confirmedUnverified.data.record.values.invoiceNumber,'T1234567890123','intake-research:unverified-saved-number');assert.equal(confirmedUnverified.data.record.history.at(-1).verified,false,'intake-research:unverified-history');rec2=confirmedUnverified.data.record;
 const q2d=await rqueue(rec2,confirmedUnverified.data.research.revision);assert.equal(q2d.status,200,'intake-research:requeue-name');job2=(await wcall('intake/claim')).data.job;assert.ok(job2,'intake-research:claim-two-d');
 assert.equal((await wcall('intake/'+job2.id+'/result',{lease:job2.lease,sources:[...job2.sources,webSource('s1',pageText,'https://two.example.invalid/company'),registrySource('s2','T1234567890123','Other Company 株式会社')],report,registry:{sourceId:'s2',number:'T1234567890123',date:job2.context.source.purchaseDate}})).status,200,'intake-research:result-name-mismatch');
 view=(await rget(rec2.id)).data;assert.equal(view.research.verified,false,'intake-research:unverified-name');assert.equal(view.research.registry.legalName,'Other Company 株式会社','intake-research:registry-name-shown');
 const blankNumber=await rqueue(rec2,view.research.revision);assert.equal(blankNumber.status,200,'intake-research:requeue-blank-number');job2=(await wcall('intake/claim')).data.job;
 const blankText='Synthetic Intake Shop 株式会社 会社概要（登録番号の記載なし）';
 assert.equal((await wcall('intake/'+job2.id+'/result',{lease:job2.lease,sources:[...job2.sources,webSource('s1',blankText,'https://two.example.invalid/company')],report:{...report,supplier:{...supplierOf(blankText,''),citations:[{sourceId:'s1',quote:blankText}]}}})).status,200,'intake-research:result-blank-number');
 view=(await rget(rec2.id)).data;assert.equal(view.research.report.supplier.invoiceNumber,'','intake-research:blank-number-ready');
 const confirmedBlank=await rconfirm(rec2,view.research.revision);assert.equal(confirmedBlank.status,200,'intake-research:confirm-blank-number '+JSON.stringify(confirmedBlank.data));assert.equal(confirmedBlank.data.record.values.invoiceNumber,'T1234567890123','intake-research:blank-number-keeps-stored');
 pass('a report without a supplier is ready but cannot be confirmed, a failed result is flagged research_failed and kept in history, a registry number or name mismatch shows unverified and still saves on confirm, a blank number never wipes a stored one');

 // 17 recovery (AMENDED): queued and never claimed → not_claimed after 10 min; claimed and lost → worker_lost after lease + 10 min
 const researchCollection=db.collection('financeintakeresearch');
 const rr3=await req('records',{values:{description:'Three',merchantUrl:'https://three.example.invalid/items/3'}});assert.equal(rr3.status,200,'intake-research:record-three');let rec3=rr3.data;
 const q3=await rqueue(rec3,0);assert.equal(q3.status,200,'intake-research:queue-three');const r3id=new ObjectId(q3.data.research.id);
 await researchCollection.updateOne({_id:r3id},{$set:{'events.0.at':new Date(Date.now()-9*60000)}});
 view=(await rget(rec3.id)).data;assert.equal(view.research.state,'queued','intake-research:nine-minutes-still-queued');
 await researchCollection.updateOne({_id:r3id},{$set:{'events.0.at':new Date(Date.now()-11*60000)}});
 await db.collection('financechatagents').updateOne({_id:agentId},{$set:{lastSeenAt:new Date(Date.now()-120000)}});
 const settledByQueue=await rqueue(rec3,view.research.revision);assert.equal(settledByQueue.status,409,'intake-research:queue-settles-stuck');assert.match(JSON.stringify(settledByQueue.data),/再読込/,'intake-research:queue-settles-stuck-text');
 view=(await rget(rec3.id)).data;assert.equal(view.research.state,'failed','intake-research:expired-not-claimed');assert.equal(view.research.failure,'not_claimed','intake-research:expired-not-claimed-flag');assert.equal(view.research.events.at(-1).stage,'expired','intake-research:expired-event');assert.equal(view.research.revision,q3.data.research.revision+1,'intake-research:expired-revision');
 assert.equal((await wcall('intake/claim')).data.job,null,'intake-research:expired-queued-not-claimable');
 const q3b=await rqueue(rec3,view.research.revision);assert.equal(q3b.status,200,'intake-research:requeue-after-expiry '+JSON.stringify(q3b.data));assert.equal(q3b.data.research.state,'queued','intake-research:requeued-after-expiry');assert.equal(q3b.data.research.history.length,1,'intake-research:expiry-history');assert.equal(q3b.data.research.history[0].failure,'not_claimed','intake-research:expiry-history-failure');assert.equal(q3b.data.research.failure,'','intake-research:requeue-after-expiry-clears');
 await researchCollection.updateOne({_id:r3id},{$set:{'events.0.at':new Date(Date.now()-11*60000)}});
 view=(await rget(rec3.id)).data;assert.equal(view.connected,true,'intake-research:busy-worker-connected');assert.equal(view.research.state,'queued','intake-research:busy-worker-keeps-queue');assert.equal(view.research.failure,'','intake-research:busy-worker-no-failure');
 let job3=(await wcall('intake/claim')).data.job;assert.ok(job3,'intake-research:claim-three');
 assert.equal(job3.id,String(r3id),'intake-research:busy-worker-queue-claimable');
 await researchCollection.updateOne({_id:r3id},{$set:{leaseUntil:new Date(Date.now()-60000)}});
 view=(await rget(rec3.id)).data;assert.equal(view.research.state,'working','intake-research:expired-lease-not-yet-lost');
 const reclaimed=(await wcall('intake/claim')).data.job;assert.ok(reclaimed,'intake-research:release-once');assert.equal(reclaimed.id,job3.id,'intake-research:release-same-job');assert.notEqual(reclaimed.lease,job3.lease,'intake-research:release-new-lease');
 assert.equal((await wcall('intake/'+job3.id+'/progress',{lease:job3.lease,stage:'web'})).status,409,'intake-research:old-lease-dead');
 assert.equal((await wcall('intake/'+job3.id+'/progress',{lease:reclaimed.lease,stage:'web'})).status,200,'intake-research:new-lease-alive');
 await researchCollection.updateOne({_id:r3id},{$set:{leaseUntil:new Date(Date.now()-11*60000)}});
 view=(await rget(rec3.id)).data;assert.equal(view.research.state,'failed','intake-research:expired-worker-lost');assert.equal(view.research.failure,'worker_lost','intake-research:expired-worker-lost-flag');assert.equal(view.research.events.at(-1).stage,'expired','intake-research:lost-event');
 assert.equal((await wcall('intake/'+job3.id+'/result',{lease:reclaimed.lease,sources:[...job3.sources,webSource('s1',pageText)],report})).status,409,'intake-research:late-result');
 assert.equal((await wcall('intake/claim')).data.job,null,'intake-research:expired-not-claimable');
 const q3c=await rqueue(rec3,view.research.revision);assert.equal(q3c.status,200,'intake-research:requeue-after-lost '+JSON.stringify(q3c.data));assert.equal(q3c.data.research.state,'queued','intake-research:requeued-after-lost');assert.equal(q3c.data.research.history.length,2,'intake-research:lost-history');assert.equal(q3c.data.research.history[1].failure,'worker_lost','intake-research:lost-history-failure');
 pass('recovery: a queued lookup expires after ten minutes only when no capable worker is connected, a connected busy worker keeps the queue claimable, an expired lease is re-leased once, a lost worker fails, late results are refused and a re-run queues again');

 // 18 owner scope and untouched collections
 assert.equal((await rget(rec.id,other)).status,404,'intake-research:owner-scope-get');
 assert.equal((await rqueue(rec,0,'',other)).status,404,'intake-research:owner-scope-queue');
 assert.equal((await rconfirm(rec,0,other)).status,404,'intake-research:owner-scope-confirm');
 const accountB=await call('/api/finance/accounts',{method:'POST',token:other,body:{name:'Synthetic Amex B',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'b@example.invalid',otpMailbox:'fb@example.invalid'}});assert.equal(accountB.status,200,'intake-research:account-b '+JSON.stringify(accountB.data));
 const agentB=await call('/api/finance-chat/agents',{method:'POST',token:other,body:{accountIds:[accountB.data.account._id],researchEnabled:true}});assert.equal(agentB.status,200,'intake-research:agent-b');
 const wcallB=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:agentB.data.token,body});
 assert.equal((await wcallB('status',{settingsUrl,ntaConfigured:false,intakeResearch:true})).status,200,'intake-research:status-b');
 assert.equal(await researchCollection.countDocuments({state:'queued'}),1,'intake-research:one-queued-for-a');
 assert.equal((await wcallB('intake/claim')).data.job,null,'intake-research:owner-claim');
 assert.equal((await wcallB('claim')).data.job,null,'intake-research:owner-statement-claim');
 assert.equal((await rget(rec3.id)).data.research.state,'queued','intake-research:queued-untouched-by-b');
 assert.equal(await researchCollection.countDocuments(),3,'intake-research:three-rows');
 assert.equal(await db.collection('financeresearches').countDocuments(),researchBefore.financeresearches,'intake-research:financeresearches-untouched');
 assert.equal(await db.collection('suppliers').countDocuments(),researchBefore.suppliers,'intake-research:suppliers-untouched');
 assert.deepEqual(await ledger(),ledgerBefore,'intake-research:ledger-untouched');
 pass('research rows are owner-scoped on read, queue, confirm and worker claim; statement research, suppliers and the ledger never move');

 // Review F3: exercise the history and active-job limits using only this fixture's owned rows.
 const pending3=(await wcall('intake/claim')).data.job;assert.equal(pending3.id,String(r3id),'intake-research:limits-drain-pending');
 assert.equal((await wcall('intake/'+pending3.id+'/result',{lease:pending3.lease,failed:true})).status,200,'intake-research:limits-drain-result');
 const beforeHistory=await researchCollection.findOne({_id:r3id});
 await researchCollection.updateOne({_id:r3id},{$set:{history:Array.from({length:20},()=>({at:new Date(),failure:'research_failed'}))}});
 view=(await rget(rec3.id)).data;const historyLimit=await rqueue(rec3,view.research.revision);assert.equal(historyLimit.status,409,'intake-research:history-limit');assert.match(JSON.stringify(historyLimit.data),/調査履歴は上限/,'intake-research:history-limit-text');
 await researchCollection.updateOne({_id:r3id},{$set:{history:beforeHistory.history}});
 for(const recordId of [rec.id,rec2.id,rec3.id]){const current=(await get('records/'+recordId)).data,currentResearch=(await rget(recordId)).data;assert.equal((await rqueue(current,currentResearch.research.revision)).status,200,'intake-research:active-limit-queue-three');}
 const fourth=await req('records',{values:{description:'Fourth concurrent lookup',merchantUrl:'https://four.example.invalid/company'}});assert.equal(fourth.status,200,'intake-research:active-limit-fourth-record');
 const activeLimit=await rqueue(fourth.data,0);assert.equal(activeLimit.status,409,'intake-research:active-limit');assert.match(JSON.stringify(activeLimit.data),/進行中の調査が完了/,'intake-research:active-limit-text');assert.equal((await rget(fourth.data.id)).data.research,null,'intake-research:active-limit-no-row');
 for(let i=0;i<3;i++){const pending=(await wcall('intake/claim')).data.job;assert.ok(pending,'intake-research:limits-cleanup-claim');assert.equal((await wcall('intake/'+pending.id+'/result',{lease:pending.lease,failed:true})).status,200,'intake-research:limits-cleanup-result');}
 assert.equal(await researchCollection.countDocuments({state:{$in:['queued','working']}}),0,'intake-research:limits-cleanup-complete');assert.deepEqual(await ledger(),ledgerBefore,'intake-research:limits-ledger-untouched');
 pass('history limit and three-active limit return their own 409 messages, rejected fourth lookup creates no research row, and the owned queue is drained');

 if(process.env.OMF_TEST_INTAKE_MUTANT){console.log('mutant run: the hidden-Chrome and real-worker legs run once in the main run, not per mutant');return;}

 // 19 MANDATORY hidden real Chrome through the collector's own launcher (pipe transport, no debug port, headless)
 {
  const collectorRequire=createRequire(path.join(root,'collector','package.json'));
  try{collectorRequire.resolve('rebrowser-puppeteer-core')}catch{throw Error('intake-ui: rebrowser-puppeteer-core is missing — run npm ci in collector/ of this tree')}
  const {browserFor,findChrome}=await import(pathToFileURL(path.join(root,'collector','browser.mjs')).href);
  if(!findChrome())throw Error('intake-ui: Google Chrome was not found in its standard locations');
  const uiDir=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-intake-review-')),xlsxPath=path.join(uiDir,'eight.xlsx');await fsp.writeFile(xlsxPath,eight);
  await db.collection('financechatagents').updateOne({_id:agentId},{$set:{lastSeenAt:new Date(Date.now()-120000)}});
  const browser=await browserFor(path.join(uiDir,'profile'),{headless:true});let page;const consoleErrors=[],failedRequests=[],otherFailures=[];
  try{
   page=await browser.newPage();await page.setViewport({width:390,height:844});
   // App-level console errors and page errors fail the leg; the browser's generic "Failed to load resource" line is covered by the
   // response log below: any ≥400 answer of /api/finance-intake fails the leg, other API answers (the shell's own auth/notification
   // calls on the login page) are reported for the record.
   page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))consoleErrors.push(m.text().slice(0,200))});page.on('pageerror',e=>consoleErrors.push(String(e).slice(0,200)));
   page.on('response',r=>{const u=r.url();if(r.status()<400||!u.includes('/api/'))return;(u.includes('/api/finance-intake')?failedRequests:otherFailures).push(r.status()+' '+u.replace(origin,'').slice(0,120))});
   const waitFor=async(fn,arg,tries=300)=>{for(let i=0;i<tries;i++){if(await page.evaluate(fn,arg))return;await pause(100);}throw Error('intake-ui: browser condition timed out: '+fn.toString().replace(/\s+/g,' ').slice(0,140))};
   const noOverflow=async name=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'intake-ui:no-overflow-'+name);
   await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>localStorage.setItem('theme','light'));await page.reload({waitUntil:'networkidle2'});
   await page.evaluate(()=>document.querySelector('#email').focus());await page.keyboard.type('finance-a@example.invalid');await page.evaluate(()=>document.querySelector('#password').focus());await page.keyboard.type('Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type="submit"]').click());await waitFor(()=>location.pathname==='/');
   await page.goto(origin+'/intake',{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('main h1'));
   assert.match(await page.evaluate(()=>[...document.querySelectorAll('a[href="/intake"]')].map(a=>a.textContent).join('|')),/購入受付/,'intake-ui:sidebar');
   await noOverflow('list');
   await page.evaluate(()=>document.querySelector('[data-new-record]').click());await waitFor(()=>!!document.querySelector('[data-new-form]'));
   for(const f of ['externalOrderId','itemPrice','tax','shippingFee','otherFee','merchantUrl','supplierName','invoiceNumber'])assert.equal(await page.evaluate(f=>!!document.querySelector('[data-field="'+f+'"]'),f),true,'intake-ui:field-'+f);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-new-form] [data-field]').length),20,'intake-ui:20-fields');
   await noOverflow('form');
   await page.evaluate(()=>document.querySelector('[data-open-importer]').click());await waitFor(()=>!!document.querySelector('[data-import-file]'));
   const fileInput=await page.$('[data-import-file]');await fileInput.uploadFile(xlsxPath);await waitFor(()=>!!document.querySelector('[data-import-mapping]'));
   assert.equal(await page.evaluate(()=>document.querySelector('[data-mapping="externalOrderId"]').value),'2','intake-ui:auto-mapping-external');assert.equal(await page.evaluate(()=>document.querySelector('[data-mapping="otherFee"]').value),'7','intake-ui:auto-mapping-fee');
   await page.click('[data-default-service]',{clickCount:3});await page.keyboard.type('UI-TEST');
   await page.evaluate(()=>document.querySelector('[data-extra-add]').click());await waitFor(()=>!!document.querySelector('[data-extra-name="0"]'));
   await page.click('[data-extra-name="0"]');await page.keyboard.type('担当者');await page.select('[data-extra-column="0"]','8');
   await page.evaluate(()=>document.querySelector('[data-import-preview]').click());await waitFor(()=>!!document.querySelector('[data-import-preview-result]'));
   assert.equal(await page.evaluate(()=>document.querySelector('[data-count-new]').textContent.trim()),'2','intake-ui:preview-count');
   await noOverflow('importer');
   await page.evaluate(()=>document.querySelector('[data-import-run]').click());await waitFor(()=>!!document.querySelector('[data-import-done]'));
   const uiImported=await byOrder('000021','UI-TEST');assert.ok(uiImported,'intake-ui:imported-record');assert.equal(uiImported.extra['担当者'],'山田','intake-ui:imported-extra');
   await page.goto(origin+'/intake/'+uiImported.id,{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('[data-extras]')&&!!document.querySelector('[data-intake-research]'));
   assert.equal(await page.evaluate(()=>document.querySelector('[data-extra="担当者"]')?.value),'山田','intake-ui:extras-shown');assert.equal(await page.evaluate(()=>document.querySelector('#intake-externalOrderId')?.value),'EXT-21','intake-ui:external-shown');assert.equal(await page.evaluate(()=>document.querySelector('#intake-otherFee')?.value),'-500','intake-ui:fee-shown');
   await waitFor(()=>!!document.querySelector('[data-research-connection]'));
   assert.equal(await page.evaluate(()=>document.querySelector('[data-research-connection]').textContent.trim()),'調査担当に接続できません','intake-ui:not-connected');
   assert.equal(await page.evaluate(()=>document.querySelector('[data-research-start]').disabled),true,'intake-ui:start-disabled-offline');
   await noOverflow('record');
   // a ready, verified result prepared through the API while the page is open elsewhere
   assert.equal((await wcall('status',{settingsUrl,ntaConfigured:false})).status,200,'intake-ui:status-old');
   const uiRec0=(await req('records',{values:{description:'UI research item',merchant:'Synthetic Intake Shop',merchantUrl:'https://shop.example.invalid/items/ui',purchaseDate:'2026-10-01'}})).data;
   await page.goto(origin+'/intake/'+uiRec0.id,{waitUntil:'networkidle2'});await waitFor(()=>!!document.querySelector('[data-research-connection]'));
   assert.equal(await page.evaluate(()=>document.querySelector('[data-research-connection]').textContent.trim()),'ワーカーの更新が必要です','intake-ui:update-needed');
   assert.equal((await statusNew()).status,200,'intake-ui:status-new');
   // The review limit checks drained their three jobs; the UI's next lookup must have no earlier queued job.
   assert.equal((await wcall('intake/claim')).data.job,null,'intake-ui:queue-empty-before-ui');
   const uiQueued=await rqueue(uiRec0,0);assert.equal(uiQueued.status,200,'intake-ui:queue '+JSON.stringify(uiQueued.data));
   await page.reload({waitUntil:'networkidle2'});await waitFor(()=>document.querySelector('[data-research-state]')?.textContent.includes('順番待ち'));
   assert.equal(await page.evaluate(()=>!!document.querySelector('[data-research-stage]')),true,'intake-ui:pending-text');
   const uiJob=(await wcall('intake/claim')).data.job;assert.equal(uiJob?.id,uiQueued.data.research.id,'intake-ui:claim');
   await waitFor(()=>document.querySelector('[data-research-state]')?.textContent.includes('調査中'),null,150);
   assert.equal((await wcall('intake/'+uiJob.id+'/result',{lease:uiJob.lease,sources:[...uiJob.sources,webSource('s1',pageText),registrySource('s2','T1234567890123','Synthetic Intake Shop 株式会社')],report,registry:{sourceId:'s2',number:'T1234567890123',date:uiJob.context.source.purchaseDate}})).status,200,'intake-ui:result');
   await waitFor(()=>!!document.querySelector('[data-research-supplier]'),null,150);
   assert.equal(await page.evaluate(()=>document.querySelector('[data-research-legal]').textContent.trim()),'Synthetic Intake Shop 株式会社','intake-ui:legal-name');assert.equal(await page.evaluate(()=>document.querySelector('[data-research-number]').textContent.trim()),'T1234567890123','intake-ui:number');
   assert.match(await page.evaluate(()=>document.querySelector('[data-research-registry]').textContent),/登録あり（基準日 2026-10-01）/,'intake-ui:registry-line');
   assert.ok((await page.evaluate(()=>document.querySelectorAll('[data-research-citation]').length))>=1,'intake-ui:citation');
   await noOverflow('research');
   await page.evaluate(()=>document.querySelector('[data-research-confirm]').click());
   await waitFor(()=>document.querySelector('#intake-supplierName')?.value==='Synthetic Intake Shop 株式会社');
   assert.equal(await page.evaluate(()=>document.querySelector('#intake-invoiceNumber').value),'T1234567890123','intake-ui:confirm-saved-number');assert.equal(await page.evaluate(()=>document.querySelector('[data-research-confirm]').textContent.trim()),'受付に保存済み','intake-ui:confirm-button-done');
   assert.equal((await get('records/'+uiRec0.id)).data.values.supplierName,'Synthetic Intake Shop 株式会社','intake-ui:confirm-persisted');
   assert.deepEqual(failedRequests,[],'intake-ui:no-failed-intake-requests');assert.deepEqual(consoleErrors,[],'intake-ui:no-console-errors');
   pass('hidden real Chrome: sidebar entry, 20 fields, eight-column import with an extra column, record page with extras, the research card offline / worker-update / pending / result / registry line, confirm saves the values; 390 px without overflow; no failed intake request, no app console error (shell API answers >=400 outside intake: '+([...new Set(otherFailures)].join(', ')||'none')+')');
  }finally{if(page)await page.close().catch(()=>{});await browser.close().catch(()=>{});for(let i=0;i<10;i++){try{await fsp.rm(uiDir,{recursive:true,force:true});break}catch{await pause(500)}}}
 }

 // 20 MANDATORY real worker cycle: claim → claude CLI (subscription login, no API key in the worker env) → read_page → result ready
 {
  for(const v of ['OMF_TEST_RESEARCH_CLI','OMF_TEST_CLAUDE_CONFIG_DIR','OMF_TEST_RESEARCH_PAGE'])if(!process.env[v])throw Error('intake-worker: '+v+' is not set (the real-worker leg is mandatory)');
  const pageUrl=new URL(process.env.OMF_TEST_RESEARCH_PAGE);assert.equal(pageUrl.protocol,'https:','intake-worker:page-https');
  const cliPath=process.env.OMF_TEST_RESEARCH_CLI,claudeConfigDirectory=process.env.OMF_TEST_CLAUDE_CONFIG_DIR;
  const workerDir=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-intake-worker-')),inferenceDirectory=path.join(workerDir,'inference');await fsp.mkdir(inferenceDirectory);
  const {Vault}=await import(pathToFileURL(path.join(root,'collector','vault.mjs')).href);
  const config={enabled:true,baseUrl:origin,token:worker,cliPath,inferenceDirectory,claudeConfigDirectory};
  await new Vault(workerDir).update(()=>config);
  assert.equal((await statusNew()).status,200,'intake-worker:status');
  const liveRec=(await req('records',{values:{description:'Live research page',merchantUrl:pageUrl.href}})).data;
  const liveQueued=await rqueue(liveRec,0);assert.equal(liveQueued.status,200,'intake-worker:queued '+JSON.stringify(liveQueued.data));
  const {ResearchWorker}=await import(pathToFileURL(path.join(root,'research-worker','worker.mjs')).href);
  const logLines=[],started=Date.now();
  const ran=await new ResearchWorker(config,workerDir,{log:m=>logLines.push(String(m))}).cycle();
  const seconds=Math.round((Date.now()-started)/1000);
  const jobDirs=await fsp.readdir(path.join(workerDir,'jobs')).catch(()=>[]);let failure=null,models=[];
  for(const d of jobDirs){try{failure=JSON.parse(await fsp.readFile(path.join(workerDir,'jobs',d,'failure.json'),'utf8'))}catch{}try{models=Object.keys(JSON.parse(await fsp.readFile(path.join(workerDir,'jobs',d,'interpreter.json'),'utf8')).modelUsage||{})}catch{}}
  view=(await rget(liveRec.id)).data;
  if(!ran||view.research.state!=='ready')throw Error('intake-worker: cycle='+ran+' state='+view.research?.state+' failure='+(view.research?.failure||'')+' after '+seconds+'s; failure.json='+JSON.stringify(failure)+' log='+logLines.join(' | '));
  const supplier=view.research.report.supplier;assert.ok(supplier&&supplier.legalName,'intake-worker:supplier');
  const web=view.research.sources.find(s=>s.kind==='web'&&s.url&&new URL(s.url).hostname===pageUrl.hostname);assert.ok(web,'intake-worker:web-source-from-page '+JSON.stringify(view.research.sources.map(s=>[s.kind,s.url])));
  assert.ok(supplier.citations.some(c=>c.sourceId===web.id&&c.quote.includes(supplier.legalName)),'intake-worker:legal-name-quoted-from-page');
  assert.equal(view.research.registry,null,'intake-worker:registry-null');assert.equal(view.research.verified,false,'intake-worker:unverified-without-nta');
  const {publicGet,htmlText}=await import(pathToFileURL(path.join(root,'research-worker','http.mjs')).href);
  const printed=new Set((htmlText((await publicGet(pageUrl.href,{maxBytes:10*1024*1024})).bytes.toString('utf8')).match(/T[0-9]{13}/g)||[]));
  assert.ok(printed.size>=1,'intake-worker:page-prints-a-number');
  if(supplier.invoiceNumber)assert.ok(printed.has(supplier.invoiceNumber),'intake-worker:number-matches-page '+supplier.invoiceNumber+' not in '+[...printed].join(','));
  assert.equal((await wcall('claim')).data.job,null,'intake-worker:statement-claim-still-null');
  const liveConfirmed=await rconfirm((await get('records/'+liveRec.id)).data,view.research.revision);assert.equal(liveConfirmed.status,200,'intake-worker:confirm '+JSON.stringify(liveConfirmed.data));
  assert.equal(liveConfirmed.data.record.values.supplierName,supplier.legalName,'intake-worker:confirmed');
  for(let i=0;i<10;i++){try{await fsp.rm(workerDir,{recursive:true,force:true});break}catch{await pause(500)}}
  pass('real worker: claim → claude CLI ('+path.basename(claudeConfigDirectory)+', models '+(models.join(',')||'unknown')+', no API key in the worker env) → read_page '+pageUrl.hostname+' → ready in '+seconds+'s; legal name '+supplier.legalName+' quoted from the page'+(supplier.invoiceNumber?', number '+supplier.invoiceNumber+' printed on the page':', no number proposed')+'; registry unverified without NTA; confirmed into the record');
 }
};

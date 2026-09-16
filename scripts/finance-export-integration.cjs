const assert=require('node:assert/strict'),crypto=require('node:crypto'),{ObjectId}=require('mongodb');
module.exports=async({db,call,upload,token,other,deviceToken,origin,pass,csv,row,directory})=>{
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),base='/api/finance-exports';
 const imported=await upload(csv([row({2:'Synthetic export purchase A',5:'2200'}),row({2:'Synthetic export purchase B',5:'1100'})]));assert.equal(imported.status,200);const importId=imported.data.id;
 const account=await db.collection('financialaccounts').findOne({name:'Synthetic Amex'}),foreign=await db.collection('users').findOne({email:'finance-b@example.invalid'});
 const before={};for(const n of ['financedrafts','transactions','financeentries'])before[n]=hash(JSON.stringify(await db.collection(n).find({}).sort({_id:1}).toArray()));
 async function seed(line,stocks,owner=account.ownerId){
  const d=(await call('/api/finance/imports/'+importId+'/drafts/'+line,{token})).data;
  const _id=new ObjectId(),archiveId=hash(String(_id)),order={archiveId,orderNumber:'12345'+line,date:'2026-08-01',currency:'JPY',total:d.source.amount,cancelled:false,dataQuality:'complete',capturedAt:new Date().toISOString(),items:[{line:1,product:'Synthetic AB12CD345',color:'BLUE',size:'2',quantity:stocks.length,lineTotal:d.source.amount}],inventoryLinks:stocks.map(inventoryId=>({inventoryId,itemLine:1,quantity:1,status:'matched',source:{sheet:'Synthetic',row:3,inventoryCell:'B3'},shipments:[]}))};
  const original=Buffer.from('Synthetic retained purchase original '+line),originalHash=hash(original),fs=require('fs'),path=require('path'),dir=path.join(directory,'purchase-documents',String(owner));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,originalHash),original);
  const p={_id,ownerId:owner,accountId:account._id,importId:new ObjectId(importId),line,key:d.key,sourceHash:d.sourceHash,paymentKey:String(owner)+':'+d.key,status:'linked',revision:1,archiveId,order,originals:[{name:'Synthetic purchase.pdf',hash:originalHash,size:original.length,mimeType:'application/pdf'}],inventoryIds:stocks,history:[],payment:{date:d.source.purchaseDate,amount:d.source.amount}};await db.collection('financepurchaselinks').insertOne(p);return {...p,id:String(_id),draft:d};
 }
 const a=await seed(2,['STOCK-A','STOCK-B']),b=await seed(3,['STOCK-C']),foreignPurchase=await seed(2,['FOREIGN-STOCK'],foreign._id);
 const view=async(p=a)=>(await call(base+'/purchases/'+p.id,{token})).data;
 const post=(route,body,t=token)=>call(base+route,{method:'POST',token:t,body});
 assert.equal((await call(base+'/purchases/'+a.id)).status,401);assert.equal((await call(base+'/purchases/'+a.id,{token:deviceToken})).status,401);assert.equal((await call(base+'/purchases/'+a.id,{token:other})).status,404);
 const invoiceBytes=Buffer.from('%PDF-1.4\nSynthetic commercial invoice only\n%%EOF'),permitBytes=Buffer.from('%PDF-1.4\nSynthetic export permit only\n%%EOF');
 async function add(bytes,name,p=a,t=token){const r=await fetch(origin+base+'/purchases/'+p.id+'/documents?name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/pdf'},body:bytes});return {status:r.status,data:await r.json()};}
 assert.equal((await add(Buffer.from('invalid'),'bad.pdf')).status,400);assert.equal((await add(invoiceBytes,'invoice.pdf',a,other)).status,404);
 let r=await add(invoiceBytes,'invoice.pdf');assert.equal(r.status,200,JSON.stringify(r));const invoice=r.data.documents.find(d=>d.hash===hash(invoiceBytes));
 r=await add(permitBytes,'permit.pdf');assert.equal(r.status,200);const permit=r.data.documents.find(d=>d.hash===hash(permitBytes));
 assert.equal((await add(invoiceBytes,'again.pdf')).data.documents.length,2);
 assert.equal((await call(invoice.url,{token:other})).status,404);const uploaded=await fetch(origin+invoice.url,{headers:{Authorization:'Bearer '+token}});assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()),invoiceBytes);
 const legacyId=new ObjectId(),legacyDir=require('path').join(directory,'documents');require('fs').mkdirSync(legacyDir,{recursive:true});require('fs').writeFileSync(require('path').join(legacyDir,String(legacyId)),invoiceBytes);
 await db.collection('financedocuments').insertOne({_id:legacyId,ownerId:account.ownerId,accountId:account._id,importId:new ObjectId(importId),line:2,name:'Existing shipping invoice.pdf',kind:'shipping',mimeType:'application/pdf',hash:invoice.hash,size:invoiceBytes.length});
 const docs=[{kind:'invoice',sourceDocumentId:String(legacyId),hash:invoice.hash},{kind:'permit',uploadId:permit.id,hash:permit.hash}];
 const input=(orderId,stock='STOCK-A')=>({revision:0,providerAccount:'synthetic-account',orderId,applicationId:'12345678',tracking:'SYN-'+orderId,shippedAt:'2026-08-02',itemCount:1,declaredAmount:700,permitNumber:'SYN-PERMIT-1',permitDate:'2026-08-03',allocations:[{purchaseId:a.id,inventoryId:stock}],documents:docs,confirm:true,confirmDocuments:true});
 assert.equal((await post('/save',{...input('EXPORT-A'),confirm:false})).status,400);
 await db.collection('financedocuments').updateOne({_id:legacyId},{$set:{kind:'receipt'}});assert.equal((await post('/save',input('EXPORT-A'))).status,409);await db.collection('financedocuments').updateOne({_id:legacyId},{$set:{kind:'shipping'}});
 assert.equal((await post('/save',{...input('EXPORT-A'),allocations:[{purchaseId:foreignPurchase.id,inventoryId:'FOREIGN-STOCK'}]})).status,404);
 assert.equal((await post('/save',{...input('EXPORT-A'),documents:[docs[0],{...docs[0],kind:'permit'}]})).status,400);
 assert.equal((await post('/save',{...input('EXPORT-A'),allocations:[{purchaseId:a.id,inventoryId:'STOCK-A'},{purchaseId:a.id,inventoryId:'STOCK-B'}]})).status,400);
 r=await post('/save',{...input('EXPORT-A'),documents:[docs[0]],confirmDocuments:false});assert.equal(r.status,200,JSON.stringify(r));let first=r.data.record;
 assert.equal((await view()).progress.exported,0);assert.equal((await view()).progress.units[0].state,'documents_pending');
 r=await post('/save',{...input('EXPORT-A'),id:first.id,revision:first.revision});assert.equal(r.status,200,JSON.stringify(r));first=r.data.record;
 assert.equal((await view()).progress.exported,1);assert.equal((await view()).progress.state,'partial');assert.equal(first.declaredValue.amount,700);assert.equal(a.order.total,2200);
 assert.equal((await post('/save',{...input('EXPORT-A'),id:first.id,revision:1})).status,409);
 assert.equal((await post('/save',input('EXPORT-DUPLICATE'))).status,409);
 assert.equal((await post('/save',{...input('EXPORT-WRONG-NAME','STOCK-B'),tracking:'SYN EXPORT A'})).status,409);
 pass('owner boundaries, source hashes, distinct documents, shipment quantities and review gate protect export completion');
 const draftPath='/api/finance-purchases/imports/'+importId+'/rows/2';
 const releaseBody={revision:0,key:a.draft.key,sourceHash:a.draft.sourceHash,id:a.id,linkRevision:1,confirm:true};
 assert.equal((await call(draftPath,{method:'DELETE',token,body:releaseBody})).status,409);
 // A shared shipment owns one document set while each purchase receives only its allocated units.
 r=await post('/save',{...input('EXPORT-A'),id:first.id,revision:first.revision,itemCount:2,allocations:[{purchaseId:a.id,inventoryId:'STOCK-A'},{purchaseId:b.id,inventoryId:'STOCK-C'}]});assert.equal(r.status,200);first=r.data.record;
 assert.equal((await view(b)).progress.state,'complete');assert.equal((await view()).progress.exported,1);assert.equal(await db.collection('financeexports').countDocuments(),1);
 const original=base+'/'+first.id+'/originals/'+invoice.hash;
 assert.equal((await call(original,{token:other})).status,404);const bytes=await fetch(origin+original,{headers:{Authorization:'Bearer '+token}});assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),invoiceBytes);
 await db.collection('financedocuments').deleteOne({_id:legacyId});require('fs').unlinkSync(require('path').join(legacyDir,String(legacyId)));assert.equal((await call(original,{token})).status,200);assert.equal((await view()).progress.exported,1);docs[0]={kind:'invoice',uploadId:invoice.id,hash:invoice.hash};
 pass('one shipment serves several purchases and allocation guards prevent detaching their source purchase');
 const outcome={inventoryId:'STOCK-B',revision:0,outcome:'returned',reason:'Synthetic return confirmation',document:{uploadId:permit.id,hash:permit.hash},confirm:true};
 assert.equal((await post('/purchases/'+a.id+'/outcomes',{...outcome,inventoryId:'STOCK-A'})).status,409);
 r=await post('/purchases/'+a.id+'/outcomes',outcome);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.progress.state,'resolved');assert.equal(r.data.progress.exported,1);assert.equal(r.data.progress.resolved,1);
 let resolution=r.data.outcomes[0];assert.equal((await post('/save',input('EXPORT-B','STOCK-B'))).status,409);
 assert.equal((await post('/outcomes/'+resolution.id+'/release',{revision:resolution.revision,confirm:true})).status,200);
 assert.equal((await view()).progress.state,'partial');
 assert.equal((await post('/purchases/'+a.id+'/outcomes',{...outcome,revision:2})).status,200);
 resolution=(await view()).outcomes[0];assert.equal((await post('/outcomes/'+resolution.id+'/release',{revision:resolution.revision,confirm:true})).status,200);
 pass('documented returns resolve quantities without counting as exports and can be corrected with revision checks');
 const entry=await db.collection('financeentries').insertOne({ownerId:account.ownerId,accountId:account._id,importId:new ObjectId(importId),line:2,state:'posted'});
 assert.equal((await add(Buffer.from('%PDF-1.4\nSynthetic later PDF\n%%EOF'),'later.pdf')).status,200);
 if(process.env.OMF_TEST_EXPORT_BROWSER){
  const path=require('path'),os=require('os'),{pathToFileURL}=require('url'),{browserFor}=await import(pathToFileURL(path.resolve('collector/browser.mjs')));
  const browser=await browserFor(path.join(os.homedir(),'.ohmyfinance-purchase-ui-test'));let page;
  try{
   page=await browser.newPage();await page.bringToFront();await page.setViewport({width:1440,height:1000});await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>localStorage.setItem('theme','light'));await page.reload({waitUntil:'networkidle2'});
   await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
   await page.goto(origin+'/mapping-draft/'+importId+'/2',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('[data-export-progress]')?.textContent.includes('1 / 2'));
   await page.click('[data-export-add]');
   const fields={account:'synthetic-account',order:'EXPORT-B',application:'12345679',tracking:'SYN-TRACK-2',date:'2026-08-04',quantity:'1',declared:'500',permit:'SYN-PERMIT-2','permit-date':'2026-08-05'};
   for(const [field,value] of Object.entries(fields))await page.$eval('[data-export-'+field+']',(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
   await page.$eval('[data-export-unit]:not([disabled])',el=>el.click());await page.select('[data-export-document=invoice]',invoice.id);await page.select('[data-export-document=permit]',permit.id);await page.click('[data-export-confirm-documents]');
   const section=await page.$('[data-purchase-exports]');await section.scrollIntoView();assert.equal(await page.$eval('[data-purchase-connections]',el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
   if(process.env.OMF_TEST_SCREENSHOT)await section.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});
   await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.$$eval('[data-purchase-exports] input:not([type=checkbox]):not([type=file]),[data-purchase-exports] select',els=>els.some(e=>e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left<0)),false);
   if(process.env.OMF_TEST_SCREENSHOT)await section.screenshot({path:process.env.OMF_TEST_SCREENSHOT});
   await page.click('[data-export-save]');await page.waitForFunction(()=>document.querySelector('[data-export-progress]')?.textContent.includes('2 / 2'));
   assert.match(await page.$eval('[data-export-progress]',el=>el.textContent),/購入から輸出まで完了/);
   if(process.env.OMF_TEST_SCREENSHOT){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-complete.png'),fullPage:true});}
   pass('real Chrome: existing light design, mobile layout and posted-purchase form save a second shipment to reach 2 of 2');
  }finally{if(page)await page.close();await browser.disconnect()}
 }else{assert.equal((await post('/save',input('EXPORT-B','STOCK-B'))).status,200);}
 assert.equal((await view()).progress.state,'complete');await db.collection('financeentries').deleteOne({_id:entry.insertedId});
 const fs=require('fs'),path=require('path'),invoicePath=path.join(directory,'export-documents',String(account.ownerId),invoice.hash),purchasePath=path.join(directory,'purchase-documents',String(account.ownerId),a.originals[0].hash),purchaseBytes=fs.readFileSync(purchasePath);
 fs.writeFileSync(invoicePath,Buffer.from('corrupt'));assert.equal((await view()).progress.exported,0);assert.equal((await call(original,{token})).status,409);fs.writeFileSync(invoicePath,invoiceBytes);
 fs.unlinkSync(purchasePath);assert.equal((await view()).progress.state,'purchase_evidence_pending');fs.writeFileSync(purchasePath,purchaseBytes);assert.equal((await view()).progress.state,'complete');
 pass('missing purchase originals and corrupted export PDFs remove completion until the original bytes are restored');
 pass('separate exports complete one purchase while posted payment and accounting values remain unchanged');
 const second=(await view()).exports.find(e=>e.orderId==='EXPORT-B');assert.equal((await post('/'+second.id+'/release',{revision:second.revision,confirm:true})).status,200);
 const concurrent=await Promise.all([post('/save',input('EXPORT-RACE-1','STOCK-B')),post('/save',input('EXPORT-RACE-2','STOCK-B'))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal((await view()).progress.exported,2);
 assert.equal((await post('/'+first.id+'/release',{revision:first.revision,confirm:true})).status,200);assert.equal((await view(b)).progress.state,'pending');assert.equal((await call(original,{token})).status,200);
 pass('concurrent saves cannot double-allocate a unit; undo updates all related purchases and retains original PDFs');
 for(const n of Object.keys(before))assert.equal(hash(JSON.stringify(await db.collection(n).find({}).sort({_id:1}).toArray())),before[n],n+' changed');
 pass('export workflows never write drafts, ledger entries or payment transactions');
};

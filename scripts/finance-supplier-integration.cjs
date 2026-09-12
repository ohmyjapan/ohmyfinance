// Entirely synthetic records in the isolated finance regression database.
const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),crypto=require('node:crypto'),path=require('node:path');
module.exports=async({db,call,request,upload,token,other,deviceToken,origin,pass,root,csv,row,pause})=>{
 const imported=await upload(csv([row({2:'Supplier memory descriptor',5:'7651'}),row({2:'Supplier memory descriptor',5:'7652'}),row({2:'前回分口座振替金額',5:'-7653'})]));assert.equal(imported.status,200);
 const batchId=imported.data.id,base='/api/finance/imports/'+batchId,endpoint=base+'/merchant-links/2';
 const sid=new ObjectId(),number='T0000000000000',evidence='Synthetic registry observation only';
 const proof={version:1,number,legalName:'Synthetic operator',source:'nta_public_site',method:'browser_review',scope:'issuer_registration_only',status:'active_at_check',sourceUrl:'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=0000000000000',checkedAt:new Date().toISOString(),asOf:new Date().toISOString().slice(0,10),registeredFrom:'2023-10-01',evidence:{text:evidence,sha256:crypto.createHash('sha256').update(evidence).digest('hex')}};
 await db.collection('suppliers').insertOne({_id:sid,name:'Synthetic supplier memory',companyName:proof.legalName,invoiceNumber:number,metadata:{invoiceVerification:proof,privateOther:'do-not-return-this'}});
 const protectedState=async()=>{const state={};for(const name of ['transactions','financeentries','financedrafts','financereviews','financeimports','suppliers'])state[name]=JSON.stringify(await db.collection(name).find({}).sort({_id:1}).toArray());return state;};
 const get=async()=>(await call(endpoint,{token})).data;
 let view=await get();assert.equal(view.revision,0);assert.equal(view.match.status,'unmatched');
 const supplier=view.suppliers.find(s=>s._id===String(sid));assert.equal(supplier.registration.status,'verified');assert.equal(JSON.stringify(view).includes('do-not-return-this'),false);assert.equal(JSON.stringify(view).includes(evidence),false);
 const body={sourceHash:view.sourceHash,key:view.key,revision:0,enabled:true,confirmed:true,supplierId:String(sid),supplierKey:supplier.identityKey,reason:'Synthetic receipt operator checked',sourceUrl:'https://example.invalid/operator'};
 const put=(b,auth=token)=>call(endpoint,{method:'PUT',token:auth,body:b});
 const before=await protectedState();
 for(const auth of [null,other,deviceToken]){assert.equal((await call(endpoint,{token:auth})).status,auth===other?404:401);assert.equal((await put(body,auth)).status,auth===other?404:401);}
 for(const [change,status] of [[{sourceHash:'stale'},409],[{key:'stale'},409],[{revision:1},409],[{supplierKey:'stale'},409],[{reason:''},400],[{confirmed:false},400],[{sourceUrl:'javascript:alert(1)'},400],[{supplierId:String(new ObjectId())},404]])assert.equal((await put({...body,...change})).status,status);
 assert.equal((await call(base+'/merchant-links/4',{token})).status,400);
 assert.equal((await call('/api/suppliers',{method:'POST',token,body:{name:'Forged synthetic supplier',metadata:{invoiceVerification:proof}}})).status,400);
 assert.deepEqual(await protectedState(),before);assert.equal(await db.collection('financemerchantlinks').countDocuments(),0);
 pass('supplier memory requires ownership, source identity, current supplier identity and explicit operator confirmation; official proofs cannot be posted by clients');
 const parallel=await Promise.all([put(body),put(body)]);assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);assert.equal(await db.collection('financemerchantlinks').countDocuments(),1);assert.deepEqual(await protectedState(),before);
 const draft=async(line=2)=>(await call(base+'/drafts/'+line,{token})).data;
 let d=await draft();assert.equal(d.values.supplierId,String(sid));assert.equal(d.values.invoiceNumber,number);assert.equal(d.values.taxRate,null);assert.equal(d.values.customerId,'');assert.equal(d.evidence.invoiceNumber.source,'supplier_memory');assert.equal(d.evidence.invoiceNumber.registration.status,'verified');
 const mapped=(await call(base+'/mapping',{token})).data;assert.equal(mapped.rows[0].preparation.invoice.registry.status,'verified');assert.equal(mapped.rows[1].preparation.invoice.number,number);
 const consulted=await import('../shared/finance-consultation.mjs');assert.equal(consulted.consultationEvidence(d).accountingReview.invoice.registry.status,'verified');
 pass('confirmed memory reuses verified numbers for the same descriptor while leaving customer, purpose, tax and every financial document unchanged');
 const batch=await db.collection('financeimports').findOne({_id:new ObjectId(batchId)}),otherAccount=new ObjectId();
 const account=await db.collection('financialaccounts').findOne({_id:batch.accountId});
 await db.collection('financialaccounts').insertOne({...account,_id:otherAccount,primaryCard:'98765',cardIdentifiers:['98765']});
 const otherBatch=new ObjectId();await db.collection('financeimports').insertOne({...batch,_id:otherBatch,accountId:otherAccount});
 assert.equal((await call('/api/finance/imports/'+otherBatch+'/drafts/2',{token})).data.values.supplierId,'');
 // Remove only these synthetic scope fixtures before existing browser account checks can run.
 await db.collection('financeimports').deleteOne({_id:otherBatch});await db.collection('financialaccounts').deleteOne({_id:otherAccount});
 const values={...d.values,supplierId:'',invoiceNumber:'',notes:'Deliberately cleared synthetic correction'};
 assert.equal((await call(base+'/drafts/2',{method:'PUT',token,body:{revision:d.revision,key:d.key,sourceHash:d.sourceHash,values,remember:[],confirm:false}})).status,200);
 view=await get();assert.ok(view.saved);assert.equal((await put({...body,revision:view.revision})).status,200);
 d=await draft();assert.equal(d.evidence.invoiceNumber.registration,undefined);assert.equal(d.evidence.invoiceNumber.linkId,undefined);assert.equal(d.values.supplierId,'');assert.equal(d.values.invoiceNumber,'');assert.ok(d.suggestions.some(s=>s.field==='invoiceNumber'&&s.value===number));
 pass('merchant memory stays within the card account and preserves saved corrections as optional suggestions');
 const savedState=await protectedState();view=await get();assert.equal((await put({...body,revision:view.revision,enabled:false})).status,200);assert.equal((await draft(3)).values.supplierId,'');assert.deepEqual(await protectedState(),savedState);
 view=await get();assert.equal((await put({...body,revision:view.revision})).status,200);
 await db.collection('suppliers').updateOne({_id:sid},{$set:{companyName:'Changed synthetic operator'}});
 assert.equal((await get()).match.status,'stale');assert.equal((await draft(3)).values.supplierId,'');assert.equal((await get()).suppliers.find(s=>s._id===String(sid)).registration.status,'mismatch');
 assert.equal((await put({...body,revision:(await get()).revision})).status,409);
 await db.collection('suppliers').updateOne({_id:sid},{$set:{companyName:proof.legalName,'metadata.invoiceVerification.evidence.sha256':'f'.repeat(64)}});
 assert.equal((await get()).suppliers.find(s=>s._id===String(sid)).registration.status,'unverified');
 await db.collection('suppliers').updateOne({_id:sid},{$set:{metadata:{invoiceVerification:proof}}});
 pass('withdrawn links stop suggestions; changed suppliers require review; corrupt verification evidence cannot produce an official badge');
 if(process.env.OMF_TEST_CHROME_PORT){
  const {createRequire}=require('node:module'),p=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core');
  const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
  try{
   page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto(origin+'/mapping?import='+batchId,{waitUntil:'networkidle2'});
   const wait=async fn=>{for(let i=0;i<100;i++){if(await page.evaluate(fn))return;await pause(100)}throw Error('Supplier browser condition timed out')};
   await wait(()=>document.querySelectorAll('.mapping-list article').length===3);
   await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-supplier-memory]').open=true);await wait(()=>!!document.querySelector('article[data-line="3"] [data-supplier-choice]'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.ok((await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-supplier-memory]').textContent)).includes('国税庁で確認済み'));
   assert.equal(await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-save-supplier]').disabled),true);
   await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-disable-supplier]').click());await wait(()=>document.querySelector('article[data-line="3"] [data-supplier-match]')?.textContent.includes('停止中'));
   assert.equal((await draft(3)).values.supplierId,'');
   await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-supplier-confirm]').click());await page.evaluate(()=>document.querySelector('article[data-line="3"] [data-save-supplier]').click());
   await wait(()=>document.querySelector('article[data-line="3"] [data-supplier-match]')?.textContent.includes('あなたが確認'));
   assert.equal((await draft(3)).values.invoiceNumber,number);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-supplier-mobile.png'),fullPage:true});
   await page.setViewport({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-supplier-desktop.png'),fullPage:true});
   await page.evaluate(()=>document.documentElement.classList.add('dark'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   pass('real Chrome: inline supplier proof, required confirmation, withdrawal and reactivation work on mobile and desktop');
  }finally{if(page)await page.close();await browser.disconnect()}
 }
};

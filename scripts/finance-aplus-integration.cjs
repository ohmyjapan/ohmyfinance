// Synthetic statement data and isolated MongoDB only.
const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),path=require('node:path'),fs=require('node:fs');
module.exports=async function({db,call,request,token,other,pass,root,origin}){
 // Source uploads remain owner-scoped; all posting/read requests below use a real selected-company token.
 const ownerToken=token,owner=await db.collection('users').findOne({email:'finance-a@example.invalid'}),organizationId=new ObjectId(),otherCompanyId=new ObjectId(),now=new Date();assert.ok(owner);
 await db.collection('organizations').insertMany([organizationId,otherCompanyId].map((id,i)=>({_id:id,name:'Synthetic accounting company '+i,slug:'accounting-'+String(id),isActive:true,members:[{userId:owner._id,role:'owner',joinedAt:now}]})));
 const selected=await call('/api/auth/switch-organization',{token:ownerToken,method:'POST',body:{organizationId:String(organizationId)}});assert.equal(selected.status,200,JSON.stringify(selected));token=selected.data.tokens.accessToken;
 const otherSelected=await call('/api/auth/switch-organization',{token:ownerToken,method:'POST',body:{organizationId:String(otherCompanyId)}});assert.equal(otherSelected.status,200);const otherCompanyToken=otherSelected.data.tokens.accessToken;
 request=(route,body,method='POST')=>call('/api/finance/'+route,{token,body,method});
 const {HEADERS}=await import('../shared/aplus.mjs');
 const csv=rows=>Buffer.from('\uFEFF'+[HEADERS,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
 const purchase=(changes={})=>Object.assign(['≪****-****-****-1234≫','20260801','Synthetic Aplus purchase','1200','Ｓ','1','01','1200',''],changes);
 const input={provider:'aplus',name:'Synthetic Aplus',primaryCard:'1234',cardIdentifiers:['1234','5678']};
 let result=await request('accounts',input);assert.equal(result.status,200,JSON.stringify(result));const account=result.data.account,id=account._id;
 assert.equal(account.provider,'aplus');assert.equal(account.otpRecipient,null);
 assert.equal((await request('accounts',{...input,primaryCard:'99999',cardIdentifiers:['99999']})).status,400);
 assert.equal((await request('accounts',{...input,provider:'unknown'})).status,400);
 assert.equal((await request('accounts/'+id,{provider:'amex',name:input.name,primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'},'PATCH')).status,400);
 assert.equal((await request('accounts/'+id+'/sync')).status,409); // No paired collector yet.
 const paired=await request('collectors',{name:'Synthetic Aplus collector',accountIds:[id]});assert.equal(paired.status,200);assert.ok(paired.data.id);assert.equal((await request('collectors/'+paired.data.id,undefined,'DELETE')).status,200);assert.equal((await request('accounts/'+id+'/sync')).status,409);
 pass('Aplus identity/provider is validated; collector pairing is supported and revoked pairing cannot queue synchronization');
 const rows=[purchase(),purchase(),purchase({0:'≪****-****-****-5678≫',1:'20260802',2:'Supplementary purchase',3:'200',7:'200'}),['','','年会費','500','','','','500',''],purchase({1:'20251002',2:'Separate refund',3:'-100',6:'',7:'',8:'返品 別途返金済み'}),purchase({1:'20251031',2:'Previous fiscal period',3:'50',7:'50'})],bytes=csv(rows);
 const metadata={kind:'statement',statementMonth:'2026-08',statementTotal:3150,refundTotal:100,fiscalStart:'2025-11-01',fiscalEnd:'2026-10-31'};
 const upload=(body=bytes,meta=metadata,auth=token)=>call('/api/finance/accounts/'+id+'/imports?'+new URLSearchParams(meta),{token:auth,method:'POST',body,raw:true});
 const before={transactions:await db.collection('transactions').countDocuments(),drafts:await db.collection('financedrafts').countDocuments(),imports:await db.collection('financeimports').countDocuments()};
 assert.equal((await upload(bytes,metadata,other)).status,404);assert.equal((await upload(bytes,metadata,null)).status,401);
 for(const meta of [{...metadata,statementTotal:0},{...metadata,refundTotal:0},{...metadata,kind:'unbilled'}])assert.equal((await upload(bytes,meta)).status,400);
 result=await upload();assert.equal(result.status,200,JSON.stringify(result));const bid=result.data.id;assert.equal(result.data.duplicateFile,false);assert.equal((await upload()).data.id,bid);
 const imported=await db.collection('financeimports').findOne({_id:new ObjectId(bid)});assert.equal(imported.provider,'aplus');assert.equal(imported.reconciliation.verified,true);assert.equal(imported.rowCount,6);
 const original=await fetch(origin+'/api/finance/imports/'+bid+'/file',{headers:{Authorization:'Bearer '+token}});assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);assert.match(original.headers.get('content-disposition'),/aplus-/);
 assert.equal((await call('/api/finance/imports/'+bid+'/file',{token:other})).status,404);
 assert.equal((await upload(bytes,{...metadata,statementMonth:'2026-09'})).status,409);
 assert.equal((await upload(bytes,{...metadata,fiscalStart:'2025-11-02'})).status,409);
 assert.equal(await db.collection('financeimports').countDocuments(),before.imports+1);
 const view=(await request('imports/'+bid,undefined,'GET')).data;assert.equal(view.requiresDraft,true);assert.deepEqual(view.rows.map(r=>r.state),['new','new','new','statement_review','credit_review','statement_review']);
 assert.equal(view.rows[3].cardIdentifier,null);assert.equal(view.rows[3].purchaseDate,null);assert.equal(view.rows[4].paymentAmount,null);assert.notEqual(view.rows[0].key,view.rows[1].key);
 for(let i=0;i<rows.length;i++)assert.deepEqual(Object.values(view.rows[i].raw),rows[i]);
 pass('Aplus archives exact bytes, reconciles both totals, preserves missing fields and refuses changed-metadata retries');
 result=await request('imports/'+bid+'/mapping',undefined,'GET');assert.equal(result.status,200,JSON.stringify(result));assert.deepEqual(result.data.rows.map(r=>r.purpose),['unresolved','unresolved','unresolved','statement_review','credit_review','statement_review']);
 assert.match(result.data.rows[3].reason,/年会費/);
 assert.equal(await db.collection('financedrafts').countDocuments(),before.drafts);
 assert.equal(await db.collection('transactions').countDocuments(),before.transactions);
 const route=line=>'imports/'+bid+'/drafts/'+line,get=async(line=2)=>{const r=await request(route(line),undefined,'GET');assert.equal(r.status,200,JSON.stringify(r));return r.data};
 const fee=await get(5);assert.equal(fee.source.purchaseDate,null);assert.equal(fee.source.paymentAmount,500);
 assert.equal((await request(route(5),{revision:0,key:fee.key,sourceHash:fee.sourceHash,confirm:true,remember:[],values:fee.values},'PUT')).status,400);
 assert.equal((await request('imports/'+bid+'/company-commit',{decisions:[{line:2,action:'import'}]})).status,409);
 assert.equal((await request('imports/'+bid+'/company-commit',{decisions:[{line:5,action:'import',draftRevision:0}]})).status,400);
 let draft=await get();assert.equal(draft.values.date,'2026-08-01');assert.equal(draft.evidence.date.source,'aplus');assert.equal(draft.source.processingDate,null);
 const main=new ObjectId(),sub=new ObjectId(),expense=new ObjectId(),tax=new ObjectId(),category=new ObjectId();
 await db.collection('accountcategories').insertMany([{_id:main,name:'クレジットカード',type:'liability',isActive:true,parentId:null},{_id:sub,name:'Synthetic Aplus ledger',parentId:main,type:'liability',isActive:true},{_id:expense,name:'Synthetic Aplus expense',type:'expense',isActive:true,parentId:null,metadata:{accountingStandard:'yayoi'}}].map(doc=>({...doc,organizationId})));
 await db.collection('taxcategories').insertOne({_id:tax,name:'Synthetic Aplus zero rate',rate:0,organizationId});await db.collection('transactioncategories').insertOne({_id:category,name:'Synthetic Aplus class',organizationId});
 const body=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash,cardAccountingKey:d.cardAccounting.key,values:{...d.values,purpose:'company',customerId:'',accountCategoryId:String(expense),subAccountCategoryId:'',transactionCategoryId:String(category),taxCategoryId:String(tax),taxRate:0},remember:[],confirm:true});
 assert.equal((await request(route(2),body(draft),'PUT')).status,409);
 const profile={version:1,accountCategoryId:String(main),subAccountCategoryId:String(sub),accountName:'クレジットカード',subAccountName:'Synthetic Aplus ledger',source:{provider:'aplus',primaryCard:'1234',cardIdentifiers:['1234','5678']},verifiedAt:'2026-09-01T00:00:00.000Z',evidence:{kind:'yayoi-account-settings'}};
 await db.collection('financialaccounts').updateOne({_id:new ObjectId(id)},{$set:{accounting:profile}});
 draft=await get();result=await request(route(2),body(draft),'PUT');assert.equal(result.status,200,JSON.stringify(result));draft=result.data;
 await db.collection('financialaccounts').updateOne({_id:new ObjectId(id)},{$unset:{accounting:''}});
 assert.equal((await request('imports/'+bid+'/company-commit',{decisions:[{line:2,action:'import',draftRevision:draft.revision}]})).status,409);
 await db.collection('financialaccounts').updateOne({_id:new ObjectId(id)},{$set:{accounting:profile}});
 result=await request('imports/'+bid+'/company-commit',{decisions:[{line:2,action:'import',draftRevision:draft.revision}]});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.posted,1);
 const tx=await db.collection('transactions').findOne({'metadata.importBatchId':bid});assert.equal(tx.metadata.importSource,'aplus');assert.equal(tx.cardNumber,'1234');assert.equal(tx.metadata.processingDate,null);assert.equal(tx.date.toISOString().slice(0,10),'2026-08-01');assert.deepEqual(tx.tags,['imported','aplus']);assert.match(tx.referenceNumber,/^APLUS-/);assert.equal(tx.cardAccounting.subAccountCategoryId,String(sub));assert.equal(String(tx.organizationId),String(organizationId),'company-aplus:transaction-company');const entry=await db.collection('financeentries').findOne({transactionId:tx._id});assert.equal(String(entry.postingOrganizationId),String(organizationId),'company-aplus:reservation-company');assert.equal(String((await db.collection('financeimportcompanies').findOne({importId:imported._id})).organizationId),String(organizationId),'company-aplus:intent-company');
 assert.equal((await request('imports/'+bid+'/company-commit',{decisions:[{line:2,action:'import',draftRevision:draft.revision}]})).status,200);
 assert.equal(await db.collection('transactions').countDocuments(),before.transactions+1);
 assert.equal((await request('accounts/'+id,{...input,cardIdentifiers:['1234']},'PATCH')).status,409);
 pass('Aplus posting requires an approved draft and verified Yayoi account; retries preserve source date, provider and amount');
 const tenTax=new ObjectId();await db.collection('taxcategories').insertOne({_id:tenTax,organizationId,name:'Synthetic Aplus ten percent',rate:10});
 for(const line of[3,4]){const current=await get(line),confirmed=body(current);confirmed.values.taxRate=10;confirmed.values.taxCategoryId=String(tenTax);const saved=await request(route(line),confirmed,'PUT');assert.equal(saved.status,200,JSON.stringify(saved));const posted=await request('imports/'+bid+'/company-commit',{decisions:[{line,action:'import',draftRevision:saved.data.revision}]});assert.equal(posted.status,200,JSON.stringify(posted));assert.equal(posted.data.posted,1);assert.equal((await request('imports/'+bid+'/company-commit',{decisions:[{line,action:'import',draftRevision:saved.data.revision}]})).status,200);}
 const all=await db.collection('transactions').find({'metadata.importBatchId':bid}).sort({amount:1,_id:1}).toArray();assert.deepEqual(all.map(t=>t.amount),[200,1200,1200],'company-aplus:distinct-occurrences');assert.equal(all.filter(t=>t.taxRate===10).length,2,'company-aplus:ten-percent');assert.equal(new Set(all.map(t=>String(t._id))).size,3);assert.ok(all.every(t=>String(t.organizationId)===String(organizationId)&&t.cardAccounting.subAccountCategoryId===String(sub)));assert.equal(all[0].cardNumber,'5678','company-aplus:supplementary-card');assert.equal(all[0].date.toISOString().slice(0,10),'2026-08-02');
 const visible=await call('/api/transactions/'+String(all[0]._id),{token});assert.equal(visible.status,200);assert.equal(visible.data.accountCategoryId?.name,'Synthetic Aplus expense','company-aplus:purchase-reference');assert.equal(visible.data.taxCategoryId?.rate,10,'company-aplus:tax-reference');
 const exported=await call('/api/transactions/export?format=json',{token});assert.equal(exported.status,200);const ownRows=exported.data.filter(r=>all.some(t=>r.id===String(t._id)));assert.equal(ownRows.length,3,'company-aplus:export-occurrences');assert.equal(ownRows.filter(r=>r.taxRate==='10%').length,2,'company-aplus:export-ten-percent');assert.equal(ownRows.filter(r=>r.taxRate==='0%').length,1);assert.ok(ownRows.every(r=>r.cardTaxCategory==='\u5bfe\u8c61\u5916'&&r.cardSubAccountCategory===profile.subAccountName),'company-aplus:export-card-snapshot');assert.equal((await call('/api/transactions/'+String(tx._id),{token:otherCompanyToken})).status,404);
 pass('company Aplus preserves identical occurrences, supplementary date/card, zero and ten percent purchase tax and independent card tax in native detail/export');

 if(process.env.OMF_TEST_CHROME_PORT){
  const {createRequire}=require('node:module'),p=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core');
  const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
  try{
   page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844});
   await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname!=='/login');
   await page.goto(origin+'/connections',{waitUntil:'networkidle2'});await page.waitForSelector('[data-import-id="'+bid+'"]');await page.click('[data-import-id="'+bid+'"]');await page.waitForSelector('.review-list article');
   assert.equal(await page.$$eval('.review-list article',r=>r.length),6);assert.equal(await page.$$eval('.review-list article select',r=>r.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.goto(origin+'/mapping?import='+bid,{waitUntil:'networkidle2'});await page.waitForSelector('.mapping-list article');assert.equal(await page.$$eval('.mapping-list article',r=>r.length),6);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.goto(origin+'/mapping-draft/'+bid+'/5',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('年会費'));assert.equal(await page.$$eval('form',r=>r.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});
   await page.setViewport({width:1440,height:1000});await page.goto(origin+'/mapping?import='+bid,{waitUntil:'networkidle2'});await page.waitForSelector('.mapping-list article');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-mapping-desktop.png'),fullPage:true});
   assert.deepEqual(errors,[]);pass('real Chrome renders Aplus mapping and undated annual fee without mobile overflow or direct-post controls');
  }finally{if(page)await page.close();await browser.disconnect()}
 }
};

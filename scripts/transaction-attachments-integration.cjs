const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
module.exports=async({db,call,token,viewer,foreign,origin,group,directory,pass})=>{
 const bytes=Buffer.from('%PDF-1.7\nSynthetic legacy evidence\n%%EOF'),name='fixture-'+crypto.randomUUID()+'.pdf';
 const legacyDir=path.resolve(__dirname,'../uploads/attachments'),file=path.join(legacyDir,name);let madeDirectory=false;
 try{await fs.mkdir(legacyDir);madeDirectory=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 const protectedId=new ObjectId();
 try{
  await fs.writeFile(file,bytes,{flag:'wx'});
  await db.collection('transactions').insertOne({_id:protectedId,organizationId:new ObjectId(foreign.organizationId),date:new Date(),amount:11,attachments:[{filename:name,path:'/uploads/attachments/'+name}]});
  const before=await db.collection('transactions').findOne({_id:protectedId});
  for(const method of ['GET','DELETE']){
   assert.equal((await call('/api/attachments/'+name,{method})).status,401);
   for(const access of [token,viewer,foreign.token])assert.equal((await call('/api/attachments/'+name,{method,token:access})).status,410);
  }
  assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(await db.collection('transactions').findOne({_id:protectedId}),before);
  pass('retired filename routes cannot disclose originals or globally unlink another company evidence');
  const listing=await fs.readdir(legacyDir);
  for(const entityType of ['transaction','receipt']){
   const form=new FormData();form.append('entityType',entityType);form.append('entityId',String(protectedId));form.append('file',new Blob([bytes]),'forged.pdf');
   const result=await fetch(origin+'/api/attachments/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert.equal(result.status,410);
  }
  assert.equal((await call('/api/attachments/upload',{method:'POST',body:{}})).status,401);
  assert.deepEqual(await fs.readdir(legacyDir),listing);assert.deepEqual(await db.collection('transactions').findOne({_id:protectedId}),before);
  pass('retired generic uploads return explicit failure without writing originals or associations');
 }finally{await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});if(madeDirectory)await fs.rmdir(legacyDir);}
 const forged={hasReceipt:true,receiptFilePath:'/unregistered.pdf',receiptUploadedAt:new Date(),attachments:[{filename:'unregistered',path:'/unregistered.pdf'}]};
 const created=await call('/api/transactions',{token,method:'POST',body:{date:'2026-09-22',amount:67000,notes:'Synthetic receipt target',...forged}});assert.equal(created.status,200,JSON.stringify(created));
 const transaction=created.data._id;
 let row=await db.collection('transactions').findOne({_id:new ObjectId(transaction)});assert.equal(row.hasReceipt,false);assert.equal(row.receiptFilePath,undefined);assert.equal(row.receiptUploadedAt,undefined);assert.deepEqual(row.attachments,[]);
 const evidence={hasReceipt:true,receiptFilePath:'/api/finance/documents/synthetic/file',receiptUploadedAt:new Date(),attachments:[{filename:'synthetic-document',path:'/api/finance/documents/synthetic/file'}]};
 const financeId=new ObjectId();await db.collection('transactions').insertOne({_id:financeId,organizationId:group,date:new Date(),amount:33,...evidence});
 const updated=await call('/api/transactions/'+financeId,{method:'PUT',token,body:{notes:'Metadata correction',hasReceipt:false,receiptFilePath:'/forged',attachments:[]}});assert.equal(updated.status,200,JSON.stringify(updated));
 row=await db.collection('transactions').findOne({_id:financeId});for(const key of Object.keys(evidence))assert.deepEqual(row[key],evidence[key],key);assert.equal(row.notes,'Metadata correction');
 pass('built transaction create ignores fabricated evidence and edit preserves finance document associations');
 const upload=async access=>{const form=new FormData();form.append('file',new Blob([bytes]),'canonical.pdf');const r=await fetch(origin+'/api/receipts/upload',{method:'POST',headers:{Authorization:'Bearer '+access},body:form});return {status:r.status,data:await r.json()};};
 const uploaded=await upload(token);assert.equal(uploaded.status,200,JSON.stringify(uploaded));const receipt=uploaded.data.receipt||uploaded.data;
 assert.equal((await upload(token)).data.receipt.id,receipt.id);
 assert.equal((await upload(viewer)).status,403);
 assert.equal((await call('/api/receipts/'+receipt.id+'/match',{token,method:'POST',body:{transactionId:transaction,linkVersion:receipt.linkVersion||0}})).status,200);
 const get=access=>fetch(origin+'/api/receipts/'+receipt.id+'/file',{headers:{Authorization:'Bearer '+access}});
 assert.equal((await get(foreign.token)).status,404);const original=await get(viewer);assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
 const detail=await call('/api/transactions/'+transaction,{token:viewer});assert.equal(detail.data.receipt.id,receipt.id);
 pass('canonical upload retry, linking and viewer download remain available with company ownership');
 if(process.env.OMF_TEST_CHROME_PORT)await browser({db,origin,group,directory,pass});
};

async function browser({db,origin,group,directory,pass}){
 const p=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 try{
  const ja=require('../i18n/locales/ja.json');page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light');});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  assert.equal(await page.evaluate(async id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(id),String(group)),true);
  await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});
  await page.$$eval('main button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.transactionForm.createTitle);
  const form='body > .fixed.z-50 form';await page.waitForSelector(form);
  assert.equal(await page.$$eval(form+' input[type="file"]',nodes=>nodes.length),0);
  await page.$$eval(form+' button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.transactionForm.receiptSection);
  assert((await page.$eval(form,el=>el.textContent)).includes(ja.transactionForm.receiptAfterSave));
  await page.waitForFunction(()=>!document.querySelector('.slide-panel-enter-active, .collapse-enter-active'));
  const panel='body > .fixed.z-50 > div:nth-child(2)';
  const inViewport=await page.$eval(panel,node=>{const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;});assert(inViewport,'Settled transaction panel must fit mobile');
  await page.$$eval(form+' p',(nodes,label)=>nodes.find(n=>n.textContent.includes(label)).scrollIntoView({block:'center'}),ja.transactionForm.receiptAfterSave);
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT});await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});}
  // Use the ordinary form, then the existing detail-page upload action.
  const amount=await page.$(form+' input[placeholder="10,000"]');assert(amount,'Amount field');await amount.type('67321');
  const saved=page.waitForResponse(r=>r.url()===origin+'/api/transactions'&&r.request().method()==='POST');
  await page.$$eval('button',(buttons,label)=>buttons.filter(b=>b.getBoundingClientRect().width>0).find(b=>b.textContent.trim()===label).click(),ja.common.save);
  const response=await saved;assert.equal(response.status(),200);const transaction=(await response.json())._id;assert(transaction);
  await page.goto(origin+'/transactions/'+transaction,{waitUntil:'networkidle2'});
  await page.$$eval('main button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.transactionDetail.uploadReceipt);
  await page.waitForFunction(id=>location.pathname==='/receipts/upload'&&new URLSearchParams(location.search).get('transactionId')===id,{},transaction);
  const bytes=Buffer.from('%PDF-1.7\nChrome form receipt\n%%EOF'),file=path.join(directory,'form-receipt.pdf');await fs.writeFile(file,bytes);await page.waitForSelector('input[type="file"]');await (await page.$('input[type="file"]')).uploadFile(file);
  let receipt;for(let i=0;i<100;i++){receipt=await db.collection('receipts').findOne({transactionId:new ObjectId(transaction)});if(receipt)break;await new Promise(r=>setTimeout(r,50));}assert(receipt,'Receipt must be durably linked');
  await page.goto(origin+'/transactions/'+transaction,{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('form-receipt.pdf'));await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('form-receipt.pdf'));
  assert.deepEqual(errors,[]);pass('real Chrome transaction form saves metadata then detail upload persists its original and receipt link');
 }catch(error){if(page&&process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png'),fullPage:true});throw error;}
 finally{if(page)await page.close();browser.disconnect();}
}

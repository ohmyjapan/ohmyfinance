const assert=require('node:assert/strict'),vue=require('vue'),{ObjectId}=require('mongodb');
const fs=require('node:fs/promises'),path=require('node:path');
const workspace=require('./helpers/receipt-workspace.cjs');
module.exports=async({db,call,token,other,origin,directory,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),group=new ObjectId(claims.organizationId),owner=new ObjectId(claims.userId);
 const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic receipt viewer company');
 const http=require('ofetch').ofetch.create({baseURL:origin,retry:0});
 const user=vue.reactive({authHeader:{Authorization:'Bearer '+token},currentOrganization:{role:'owner'}});
 const client=workspace({user,fetch:http}),bytes=Buffer.from('%PDF-1.7\nWorkspace original\n%%EOF');
 try{
  const receipt=await client.state.uploadReceipt(new File([bytes],'workspace.pdf'));assert(receipt,client.state.error.value);
  assert.equal((await client.state.uploadReceipt(new File([bytes],'workspace.pdf'))).id,receipt.id);
  await client.state.updateReceiptMetadata(receipt.id,{amount:0,currency:'JPY',merchant:'Synthetic store'});await client.state.fetchReceipts();
  assert.equal(client.state.receipts.value.length,1);assert.equal(client.state.receiptStats.value.total,1);assert.equal(client.state.receipts.value[0].amount,0);
  const foreignReceipt=(await call('/api/receipts',{method:'POST',token:foreign.token,body:{filename:'foreign.pdf'}})).data;
  assert.equal((await call('/api/receipts',{token})).data.total,1);
  pass('real workspace client uploads once, retains zero values and lists only its company records');
  const txn=new ObjectId(),secondTxn=new ObjectId();await db.collection('transactions').insertMany([txn,secondTxn].map(_id=>({_id,organizationId:group,date:new Date('2026-09-22'),amount:0,type:'expense',status:'completed'})));
  const ledgerBefore=await db.collection('transactions').find({organizationId:group}).toArray();
  const body={receiptId:receipt.id,transactionId:String(txn),linkVersion:0};
  assert.equal((await call('/api/receipts/match',{method:'POST',body})).status,401);
  assert.equal((await call('/api/receipts/match',{token})).status,405);
  assert.equal((await call('/api/receipts/match',{token:foreign.token,method:'POST',body})).status,404);
  assert.equal((await call('/api/receipts/match',{token,method:'POST',body:{...body,linkVersion:undefined}})).status,400);
  const attempts=await Promise.all([1,2,3].map(()=>call('/api/receipts/match',{token,method:'POST',body})));assert(attempts.every(r=>r.status===200),JSON.stringify(attempts));
  const stored=await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)});assert.equal(stored.linkHistory.length,1);assert.equal(String(stored.transactionId),String(txn));
  assert.equal((await call('/api/receipts/match',{token,method:'POST',body:{...body,transactionId:String(secondTxn)}})).status,409);
  assert.deepEqual(await db.collection('transactions').find({organizationId:group}).toArray(),ledgerBefore);
  pass('legacy matching saves through canonical company/version rules, retries once and preserves ledger fields');
  const second=await client.state.uploadReceipt(new File([Buffer.from('%PDF-1.7\nSecond workspace')],'second-workspace.pdf'));
  let lose=true;const page=workspace({page:true,user,fetch:async(url,options)=>{const result=await http(url,options);if(lose&&url.endsWith('/match')){lose=false;throw Error('Synthetic lost response after durable link');}return result;}});
  try{await page.mount();page.state.matchReceipt(second.id);await page.state.saveMatch(second.id,String(secondTxn));assert(page.state.receiptToMatch.value);assert.equal(page.state.receipts.value.find(r=>r.id===second.id).status,'unmatched');await page.state.saveMatch(second.id,String(secondTxn));assert.equal(page.state.receiptToMatch.value,null);assert.equal((await db.collection('receipts').findOne({_id:new ObjectId(second.id)})).linkHistory.length,1);}finally{page.close();}
  pass('compiled workspace page retries a lost durable match response without creating a second link event');
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$push:{members:{userId:owner,role:'viewer'}}});
  const view=(await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:foreign.organizationId}})).data.tokens.accessToken;
  user.authHeader={Authorization:'Bearer '+view};user.currentOrganization={role:'viewer'};assert.equal(client.state.receipts.value.length,0);
  await client.state.fetchReceipts();assert.deepEqual(client.state.receipts.value.map(r=>r.id),[foreignReceipt.id]);assert.equal(await client.state.deleteReceipt(foreignReceipt.id),false);assert.equal(client.state.receipts.value.length,1);
  assert.equal((await call('/api/receipts/match',{token:view,method:'POST',body:{receiptId:foreignReceipt.id,transactionId:String(txn),linkVersion:0}})).status,403);
  pass('viewer switch clears the old company, permits reads and preserves records after rejected mutations');
  user.authHeader={Authorization:'Bearer '+token};user.currentOrganization={role:'owner'};await client.state.fetchReceipts();
  assert.equal(await client.state.deleteReceipt(second.id),true);await client.state.fetchReceipts();assert.equal(client.state.receipts.value.length,1);
  const unlinked=await call('/api/transactions/'+secondTxn,{token});assert.equal(unlinked.status,200);assert.notEqual(unlinked.data.hasReceipt,true);assert.equal(unlinked.data.receipt,undefined);
  assert.equal((await call('/api/receipts/'+second.id,{token})).status,404);
  pass('confirmed deletion persists after reload and removes the derived transaction link');
  if(process.env.OMF_TEST_CHROME_PORT)await browser({db,call,token,origin,group,foreign,directory,pass,owner});
 }finally{client.close();}
};

async function browser({db,call,token,origin,group,foreign,directory,pass,owner}){
 const puppeteer=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 try{
  const original=await db.collection('receipts').findOne({organizationId:group}),transaction=String(original.transactionId);
  assert.equal((await call('/api/receipts/'+original._id+'/match',{token,method:'DELETE',body:{transactionId:transaction,linkVersion:original.linkVersion}})).status,200);
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light');});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  const select=async id=>assert.equal(await page.evaluate(async groupId=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(groupId),String(id)),true);
  await select(group);await page.goto(origin+'/receipts',{waitUntil:'networkidle2'});await page.waitForSelector('main tbody tr');
  assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),1);assert((await page.$eval('main',n=>n.textContent)).includes('workspace.pdf'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Workspace must fit mobile');
  const ja=require('../i18n/locales/ja.json');
  assert.deepEqual(await page.$$eval('main select',nodes=>nodes.map(n=>n.selectedOptions[0]?.textContent)),[ja.receiptsList.allStatuses,ja.receiptsList.allTypes]);
  await page.$$eval('main tbody tr button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.receipts.match);
  await page.waitForFunction(id=>[...document.querySelectorAll('main [role="dialog"] .cursor-pointer')].some(n=>n.textContent.includes(id)),{},transaction);
  await page.$$eval('main [role="dialog"] .cursor-pointer',(nodes,id)=>nodes.find(n=>n.textContent.includes(id)).click(),transaction);
  await page.$$eval('main [role="dialog"] button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.receiptMatchDialog.confirmMatch);
  await page.waitForFunction(()=>!document.querySelector('main [role="dialog"]'));
  assert.equal(String((await db.collection('receipts').findOne({_id:original._id})).transactionId),transaction);
  await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('main tbody tr');
  const downloadDir=path.join(directory,'workspace-downloads');await fs.mkdir(downloadDir);const session=await page.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  await page.$$eval('main tbody tr button',buttons=>buttons.find(b=>b.textContent.trim()==='ダウンロード').click());
  let saved=false;for(let i=0;i<100;i++){try{assert.deepEqual(await fs.readFile(path.join(downloadDir,'workspace.pdf')),Buffer.from('%PDF-1.7\nWorkspace original\n%%EOF'));saved=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(saved,'Workspace download must save original bytes');
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});
  await page.setViewport({width:1440,height:1000});if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png'),fullPage:true});
  // The displayed row must survive a rejected delete, then disappear only after HTTP success.
  let rejectDelete=true;await page.setRequestInterception(true);page.on('request',request=>{if(rejectDelete&&request.method()==='DELETE'&&request.url().includes('/api/receipts/'))request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic temporary delete failure'})});else request.continue();});
  await page.$$eval('main tbody tr button',buttons=>buttons.find(b=>b.textContent.trim()==='削除').click());
  const confirm=()=>page.$$eval('main [role="dialog"] button',buttons=>buttons.find(b=>b.textContent.trim()==='削除').click());await confirm();await page.waitForFunction(()=>document.querySelector('main [role="dialog"] [role="alert"]')?.textContent.includes('Synthetic'));
  assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),1);rejectDelete=false;await confirm();await page.waitForFunction(()=>!document.querySelector('main tbody tr'));await page.reload({waitUntil:'networkidle2'});assert.equal(await db.collection('receipts').countDocuments({organizationId:group}),0);
  pass('real Chrome workspace shows saved counts, downloads original bytes and persists deletion only after server success');
  await select(foreign.organizationId);await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('foreign.pdf'));
  assert.equal(await page.$$eval('main button',buttons=>buttons.filter(b=>['削除','マッチング','アップロード'].includes(b.textContent.trim())).length),0);
  assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),1);
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$pull:{members:{userId:owner}}});
  await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('main [role="alert"]');assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),0);assert.deepEqual(errors,[]);
  pass('real Chrome viewer company switch removes old records and revoked membership produces an error without fabricated rows');
 }catch(error){if(page&&process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png'),fullPage:true});throw error;}
 finally{if(page)await page.close();browser.disconnect();}
}

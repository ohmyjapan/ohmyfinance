const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),vue=require('vue');
const {ObjectId}=require('mongodb');
module.exports=async({db,call,token,other,origin,directory,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),group=new ObjectId(claims.organizationId);
 const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic original foreign group');
 const bytes=Buffer.from('%PDF-1.7\nSynthetic original bytes\n%%EOF');
 async function upload(access=token,data=bytes,name='synthetic.pdf'){
  const form=new FormData();form.append('file',new Blob([data],{type:'application/octet-stream'}),name);
  const r=await fetch(origin+'/api/receipts/upload',{method:'POST',headers:access?{Authorization:'Bearer '+access}:{},body:form});return {status:r.status,data:await r.json()};
 }
 const get=(url,access=token)=>fetch(origin+url,{headers:access?{Authorization:'Bearer '+access}:{}});
 assert.equal((await upload(null)).status,401);
 const attempts=await Promise.all(Array.from({length:5},()=>upload()));for(const r of attempts)assert.equal(r.status,200,JSON.stringify(r));
 const receipt=attempts[0].data.receipt,url=receipt.fileUrl;
 assert.equal(new Set(attempts.map(r=>r.data.receipt.id)).size,1);assert.equal(receipt.receiptDate,undefined);assert.equal(receipt.filePath,undefined);
 assert.equal(await db.collection('receipts').countDocuments({organizationId:group}),1);
 pass('real multipart uploads have one company-scoped identity under concurrent retries and leave the purchase date unknown');
 const response=await get(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/^attachment;/);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await get(url,null)).status,401);assert.equal((await get(url,foreign.token)).status,404);
 const registered=await call('/api/auth/register',{method:'POST',body:{email:'receipt-file-viewer@example.invalid',password:'Synthetic-password-Only1!',name:'Synthetic viewer'}});
 const login=registered.data.tokens.accessToken,viewerId=new ObjectId(JSON.parse(Buffer.from(login.split('.')[1],'base64url')).userId);
 await db.collection('organizations').updateOne({_id:group},{$push:{members:{userId:viewerId,role:'viewer'}}});
 const viewer=(await call('/api/auth/switch-organization',{method:'POST',token:login,body:{organizationId:String(group)}})).data.tokens.accessToken;
 assert.equal((await get(url,viewer)).status,200);assert.equal((await upload(viewer)).status,403);
 await db.collection('organizations').updateOne({_id:group},{$pull:{members:{userId:viewerId}}});assert.equal((await get(url,viewer)).status,403);
 pass('download returns exact original bytes with attachment headers and current membership controls, including read-only viewers');
 const otherReceipt=(await upload(foreign.token)).data.receipt;assert.notEqual(receipt.id,otherReceipt.id);assert.equal((await get(otherReceipt.fileUrl)).status,404);
 const forged=await call('/api/receipts',{method:'POST',token,body:{filename:'forged',size:bytes.length,filePath:path.join(directory,'private.txt'),fileUrl:url,fileHash:crypto.createHash('sha256').update(bytes).digest('hex'),storageVersion:1}});
 assert.equal(forged.status,200);assert.equal(forged.data.fileUrl,undefined);assert.equal((await get('/api/receipts/'+forged.data.id+'/file')).status,404);
 pass('company copies remain independent and JSON metadata cannot claim a file path, URL or original hash');
 for(const [data,status]of [[Buffer.alloc(0),400],[Buffer.from('Not a PDF'),415],[Buffer.alloc(10*1024*1024+1),413]])assert.equal((await upload(token,data)).status,status);
 const oversizedStream=require('node:stream').Readable.from([Buffer.alloc(6*1024*1024),Buffer.alloc(5*1024*1024)]);
 const streamed=await fetch(origin+'/api/receipts/upload',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/form-data; boundary=synthetic'},body:oversizedStream,duplex:'half'});
 assert.equal(streamed.status,413,'Unknown-length oversized uploads must return HTTP 413');
 assert.equal((await call('/api/receipts/upload',{method:'POST',token,body:{filename:'no multipart'}})).status,400);
 assert.equal((await get('/api/receipts/invalid/file')).status,400);
 pass('empty, oversized, unsupported and malformed uploads fail explicitly before registration');
 const original=path.join(directory,'receipts',String(group),crypto.createHash('sha256').update(bytes).digest('hex'));
 await call('/api/receipts/'+receipt.id,{method:'PATCH',token,body:{notes:'Reviewed original',amount:67000}});
 const before=await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)});
 await fs.unlink(original);assert.equal((await get(url)).status,404);assert.equal((await upload()).data.receipt.id,receipt.id);
 await fs.writeFile(original,'Damaged file');assert.equal((await get(url)).status,409);assert.equal((await upload()).data.receipt.id,receipt.id);
 assert.deepEqual(await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)}),before);assert.deepEqual(Buffer.from(await (await get(url)).arrayBuffer()),bytes);
 pass('same-file reupload repairs missing and corrupt originals while preserving reviewed database fields');
 const transaction=new ObjectId();await db.collection('transactions').insertOne({_id:transaction,organizationId:group,date:new Date('2026-09-22'),amount:67000,type:'expense',status:'completed',hasReceipt:false,timeline:[]});
 const page=require('./helpers/receipt-upload-page.cjs')({user:vue.reactive({authHeader:{Authorization:'Bearer '+token}}),route:vue.reactive({query:{transactionId:String(transaction)}}),fetch:require('ofetch').ofetch.create({baseURL:origin,retry:0})});
 try{await page.mount();await page.state.processFiles([new File([bytes],'synthetic.pdf',{type:'application/pdf'})]);assert.equal(page.state.errorMessage.value,'');assert.equal(page.state.receipts.value.filter(r=>r.id===receipt.id).length,1);}finally{page.close();}
 const linked=await call('/api/transactions/'+transaction,{token});assert.equal(linked.data.receipt.id,receipt.id);assert.equal(linked.data.receipt.url,url);
 pass('the compiled upload page honors its transaction target and the built transaction API exposes the authenticated original');
 if(process.env.OMF_TEST_CHROME_PORT)await browser({db,origin,group,token,transaction,directory,pass});
 await call('/api/receipts/'+receipt.id,{method:'DELETE',token});assert.equal((await get(url)).status,404);assert.deepEqual(await fs.readFile(original),bytes);
 pass('deleting receipt metadata revokes its download while retaining the original bytes');
};

async function browser({db,origin,group,transaction,directory,pass}){
 const p=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 const downloadDir=path.join(directory,'chrome-downloads');await fs.mkdir(downloadDir);
 try{
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light');});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  assert.equal(await page.evaluate(async id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(id),String(group)),true);
  const txn=new ObjectId();await db.collection('transactions').insertOne({_id:txn,organizationId:group,date:new Date('2026-09-22'),amount:100,type:'expense',status:'completed',hasReceipt:false,timeline:[]});
  const original=Buffer.from('%PDF-1.7\nChrome original receipt\n%%EOF'),local=path.join(directory,'chrome-receipt.pdf');await fs.writeFile(local,original);
  await page.goto(origin+'/receipts/upload?transactionId='+txn,{waitUntil:'networkidle2'});await page.waitForSelector('input[type="file"]');
  await (await page.$('input[type="file"]')).uploadFile(local);
  await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('chrome-receipt.pdf'));
  for(let i=0;i<100;i++){if(await db.collection('receipts').findOne({transactionId:txn}))break;await new Promise(r=>setTimeout(r,50));}
  const stored=await db.collection('receipts').findOne({transactionId:txn});assert(stored,'Chrome upload must finish attaching to its transaction');
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-upload.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Upload page must fit mobile');
  await page.goto(origin+'/transactions/'+txn,{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('chrome-receipt.pdf'));
  const session=await page.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/receipts/'+stored._id+'/file'));
  await page.click('main button[aria-label="ダウンロード"]');assert.equal((await response).status(),200);
  const downloaded=path.join(downloadDir,'chrome-receipt.pdf');let saved=false;for(let i=0;i<100;i++){try{assert.deepEqual(await fs.readFile(downloaded),original);saved=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(saved,'Chrome must save exact original bytes');
  await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('chrome-receipt.pdf'));
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png'),fullPage:true});}
  assert.deepEqual(errors,[]);pass('real Chrome uploads, attaches and downloads exact receipt bytes after normal login and reload');
 }catch(error){if(page&&process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png'),fullPage:true});throw error;}
 finally{if(page)await page.close();browser.disconnect();}
}

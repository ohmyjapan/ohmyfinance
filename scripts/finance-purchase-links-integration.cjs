const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async({db,call,upload,token,other,deviceToken,origin,pass,csv,row})=>{
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),url='https://www.isseymiyake.com/pages/orders';
 const imported=await upload(csv(['Synthetic order one','Synthetic order two','Synthetic pending one','Synthetic pending two'].map(name=>row({2:name,5:'2200'}))));assert.equal(imported.status,200);
 const importId=imported.data.id,account=await db.collection('financialaccounts').findOne({name:'Synthetic Amex'});
 const base=line=>'/api/finance-purchases/imports/'+importId+'/rows/'+line,researchBase=line=>'/api/finance-research/imports/'+importId+'/drafts/'+line,draftPath=line=>'/api/finance/imports/'+importId+'/drafts/'+line;
 const getDraft=async line=>(await call(draftPath(line),{token})).data,view=async line=>(await call(base(line),{token})).data,bind=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash});
 const before={tx:await db.collection('transactions').countDocuments(),drafts:await db.collection('financedrafts').countDocuments(),entries:await db.collection('financeentries').countDocuments()};
 assert.equal((await call(base(2))).status,401);assert.equal((await call(base(2),{token:other})).status,404);assert.equal((await call(base(2),{token:deviceToken})).status,401);
 const workerInfo=await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],researchEnabled:true}});assert.equal(workerInfo.status,200);const worker=workerInfo.data.token;
 const workerCall=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:worker,body});
 const original=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('Synthetic purchase original')]);
 async function prepare(line,number,stockIds=[]){
  assert.equal((await call('/api/finance-chat/worker/heartbeat',{method:'POST',token:worker,body:{}})).status,200);
  const draft=await getDraft(line),r=(await call(researchBase(line),{token})).data;
  const queued=await call(researchBase(line),{method:'POST',token,body:{...bind(draft),researchRevision:r.research?.revision||0,requestId:crypto.randomUUID(),instruction:'Synthetic purchase connection'}});assert.equal(queued.status,200,JSON.stringify(queued));
  const job=(await workerCall('claim')).data.job;assert(job);
  const document={id:'s1',kind:'document',title:'Synthetic order original',url,text:'Order '+number+' Total 2200',capturedAt:new Date().toISOString()};document.hash=hash(document.text);
  const order={archiveId:hash('synthetic:'+number),orderNumber:number,date:'2026-07-30',total:2200,currency:'JPY',cancelled:false,dataQuality:'complete',capturedAt:new Date().toISOString(),items:[{line:1,product:'Synthetic AB12CD345',color:'Blue',size:'2',quantity:2,lineTotal:2200}],inventoryLinks:stockIds.map((inventoryId,i)=>({inventoryId,itemLine:1,quantity:1,status:'matched',source:{sheet:'Synthetic inventory',row:i+2,inventoryCell:'B'+(i+2)},shipments:[]})),searchType:'issey_order_detail',connectionVersion:1,fileCount:1,original:{part:1,sourceId:'s1',sha256:hash(original),bytes:original.length}};
  const text=JSON.stringify(order),detail={id:'s2',kind:'search',title:'Synthetic order',url,text,hash:hash(text),capturedAt:new Date().toISOString()};
  const query=new URLSearchParams({lease:job.lease,sourceId:'s1',name:'Synthetic-order.png',mimeType:'image/png'});
  const uploaded=await fetch(origin+'/api/finance-research/worker/'+job.id+'/artifact?'+query,{method:'POST',headers:{Authorization:'Bearer '+worker,'Content-Type':'image/png'},body:original});assert.equal(uploaded.status,200,await uploaded.clone().text());
  const finished=await workerCall(job.id+'/result',{lease:job.lease,sources:[...job.sources,document,detail],report:{summary:'Synthetic connection evidence',question:'',findings:[],supplier:null}});assert.equal(finished.status,200,JSON.stringify(finished));
  const current=await view(line);assert.equal(current.candidates.length,1);return {job,order,draft,current};
 }
 const input=async line=>{const d=await getDraft(line),v=await view(line),c=v.candidates[0];return {...bind(d),researchRevision:v.researchRevision,candidateHash:c.candidateHash,archiveId:c.order.archiveId,linkRevision:c.linkRevision,confirm:true}};
 const first=await prepare(2,'1234567',['SYN-1','SYN-2']);assert.equal(first.current.candidates[0].dateOffsetDays,-2);assert.equal(first.current.candidates[0].inventoryCount,2);assert.equal(first.current.saved.length,0);
 const body=await input(2);
 assert.equal((await call(base(2),{method:'POST',token,body:{...body,candidateHash:'f'.repeat(64)}})).status,409);
 assert.equal((await call(base(2),{method:'POST',token,body:{...body,confirm:false}})).status,400);
 assert.equal((await call(base(2),{method:'POST',token,body:{...body,key:'changed'}})).status,409);
 assert.equal((await call(base(2),{method:'POST',token,body:{...body,researchRevision:body.researchRevision-1}})).status,409);
 assert.equal((await call(base(2),{method:'POST',token:other,body})).status,404);
 assert.equal((await call(base(2),{method:'POST',token,body:{...body,order:first.order}})).status,400);
 pass('purchase connections require owner access, captured evidence, current binding and explicit confirmation');
 const saved=await call(base(2),{method:'POST',token,body});assert.equal(saved.status,200,JSON.stringify(saved));const link=saved.data.saved[0];assert.equal(link.status,'linked');assert.equal(link.order.inventoryLinks.length,2);assert.equal(link.originals.length,1);
 const repeat=await call(base(2),{method:'POST',token,body});assert.equal(repeat.status,200);assert.equal(repeat.data.saved[0].revision,1);
 const download='/api/finance-purchases/'+link.id+'/originals/'+hash(original),bytes=await fetch(origin+download,{headers:{Authorization:'Bearer '+token}});assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),original);assert.equal((await call(download,{token:other})).status,404);
 pass('date-offset order with two inventory items saves one original and repeat confirmation is idempotent');
 if(process.env.OMF_TEST_PURCHASE_BROWSER){
  const path=require('path'),os=require('os'),{pathToFileURL}=require('url'),{browserFor}=await import(pathToFileURL(path.resolve('collector/browser.mjs')));
  const browser=await browserFor(path.join(os.homedir(),'.ohmyfinance-purchase-ui-test'));let page;
  try{
   page=await browser.newPage();await page.setViewport({width:1440,height:1000});await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>localStorage.setItem('theme','light'));await page.reload({waitUntil:'networkidle2'});
   await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
   await page.goto(origin+'/mapping-draft/'+importId+'/2',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('[data-purchase-order]')?.textContent.includes('SYN-2'));
   const section=await page.$('[data-purchase-connections]');assert.equal(await section.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');assert.match(await section.evaluate(el=>el.textContent),/接続済み/);
   if(process.env.OMF_TEST_SCREENSHOT)await section.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});
   await page.setViewport({width:390,height:844});await section.scrollIntoView();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.OMF_TEST_SCREENSHOT)await section.screenshot({path:process.env.OMF_TEST_SCREENSHOT});
   await section.evaluate(el=>[...el.querySelectorAll('button')].find(b=>b.textContent==='接続を解除').click());
   await section.evaluate(el=>[...el.querySelectorAll('button')].find(b=>b.textContent==='解除する').click());
   await page.waitForFunction(()=>document.querySelector('[data-purchase-order]')?.textContent.includes('接続解除済み・原本保管中'));
   await page.click('[data-purchase-connect]');await page.waitForFunction(()=>document.querySelector('[data-purchase-order]')?.textContent.includes('接続済み'));
   pass('real Chrome: saved order, two inventory IDs and original document render in the existing light design at desktop and mobile sizes');
  }finally{if(page)await page.close();await browser.disconnect()}
 }
 await prepare(3,'1234567',[]);assert.equal((await call(base(3),{method:'POST',token,body:await input(3)})).status,409);
 await prepare(3,'1234568',['SYN-1']);const conflict=await call(base(3),{method:'POST',token,body:await input(3)});assert.equal(conflict.status,409,JSON.stringify(conflict));
 await prepare(4,'1234569');await prepare(5,'1234570');for(const line of [4,5]){const result=await call(base(line),{method:'POST',token,body:await input(line)});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.saved[0].order.inventoryLinks.length,0)}
 pass('inventory reuse is blocked while multiple orders without inventory can independently retain their originals');
 // A fresh research attempt must not be able to remove the saved original or connection.
 await db.collection('financeresearches').deleteOne({_id:new (require('mongodb').ObjectId)(first.job.id)});
 assert.equal((await view(2)).saved[0].order.orderNumber,'1234567');assert.equal((await view(2)).candidates.length,0);assert.equal((await call(download,{token})).status,200);
 const currentLink=(await view(2)).saved[0],releaseBody={...bind(await getDraft(2)),id:link.id,linkRevision:currentLink.revision,confirm:true};
 const entry=await db.collection('financeentries').insertOne({ownerId:account.ownerId,accountId:account._id,importId:new (require('mongodb').ObjectId)(importId),line:2,state:'reserved'});
 assert.equal((await call(base(2),{method:'DELETE',token,body:releaseBody})).status,409);await db.collection('financeentries').deleteOne({_id:entry.insertedId});
 const released=await call(base(2),{method:'DELETE',token,body:releaseBody});assert.equal(released.status,200);assert.equal(released.data.saved[0].status,'released');assert.equal((await call(download,{token})).status,200);
 assert.equal((await call(base(3),{method:'POST',token,body:await input(3)})).status,200);
 pass('research replacement and undo retain original files; released inventory can be connected correctly');
 assert.equal(await db.collection('transactions').countDocuments(),before.tx);assert.equal(await db.collection('financedrafts').countDocuments(),before.drafts);assert.equal(await db.collection('financeentries').countDocuments(),before.entries);
 pass('purchase connections leave accounting values and ledger records unchanged');
};

const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),vue=require('vue'),load=require('./helpers/calendar-store.cjs');
module.exports=async({db,call,token,other,origin,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),group=new ObjectId(claims.organizationId),owner=new ObjectId(claims.userId);
 const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic calendar other company');
 const body={title:'Synthetic own calendar',amount:100,currency:'JPY',dueDate:'2026-09-22',type:'expense',status:'pending',category:'Invoice'};
 const create=async(extra={},auth=token)=>{const r=await call('/api/payments',{method:'POST',token:auth,body:{...body,...extra}});assert.equal(r.status,200,JSON.stringify(r));return r.data};
 const p=await create({organizationId:foreign.organizationId,posting:{key:'forged'}}),f=await create({title:'Synthetic foreign calendar'},foreign.token);await db.collection('payments').insertOne({...body,dueDate:new Date(body.dueDate)});
 assert.equal((await call('/api/payments')).status,401);assert.deepEqual((await call('/api/payments',{token})).data.map(x=>x.id),[p.id]);assert.equal((await call('/api/payments/'+f.id,{token})).status,404);assert.equal(p.organizationId,String(group));assert.equal(p.posting,undefined);
 assert.equal((await call('/api/payments/'+p.id,{method:'PUT',token,body:null})).status,400);assert.equal((await call('/api/payments',{method:'POST',token,body:null})).status,400);
 pass('calendar real-token reads exclude other companies and legacy records; assignment is server-owned');
 const edited=await call('/api/payments/'+p.id,{method:'PUT',token,body:{revision:p.revision,amount:0,dueDate:'2026-09-23'}});assert.equal(edited.status,200);assert.equal(edited.data.amount,0);assert.equal(edited.data.dueDate,'2026-09-23T12:00:00.000Z');
 assert.equal((await call('/api/payments/'+p.id,{method:'PUT',token,body:{revision:p.revision,amount:2}})).status,409);assert.equal((await call('/api/payments/'+f.id,{method:'DELETE',token,body:{revision:0}})).status,404);
 pass('calendar edits preserve zero and dates, reject stale versions and cannot delete a foreign payment');
 const user=vue.reactive({sessionId:'a',isAuthenticated:true,user:{id:String(owner)},currentOrganization:{id:String(group),role:'owner'},authHeader:{Authorization:'Bearer '+token}}),http=require('ofetch').ofetch.create({baseURL:origin,retry:0});let dropped=false,posts=0;
 const store=load({user,fetch:async(url,o)=>{const result=await http(url,o);if(url.endsWith('/complete')){posts++;if(!dropped){dropped=true;throw Error('Synthetic lost completion response')}}return result}});
 try{await store.fetchPayments();await assert.rejects(store.markAsCompleted(p.id,edited.data.revision),/lost completion/);assert.equal(store.payments[0].status,'overdue');assert(store.error);const again=await store.markAsCompleted(p.id,edited.data.revision);assert.equal(again.payment.status,'paid');assert.equal(posts,2);await store.fetchPayments();assert.equal(store.payments[0].status,'paid');assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+p.id}),1);}finally{store.$dispose()}
 pass('compiled calendar caller retries a lost HTTP result using one durable transaction and exposes failure');
 const c=await create(),results=await Promise.all(Array.from({length:4},()=>call('/api/payments/'+c.id+'/complete',{method:'POST',token,body:{revision:c.revision}})));assert(results.every(r=>r.status===200),JSON.stringify(results));const tx=results[0].data.transaction;assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+c.id}),1);
 assert.equal((await call('/api/transactions/'+(tx.id||tx._id),{method:'DELETE',token})).status,200);assert.equal((await call('/api/payments/'+c.id+'/complete',{method:'POST',token,body:{revision:c.revision}})).status,409);assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+c.id}),1);
 pass('concurrent completion and ledger deletion retain one source identity without resurrection');
 await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$push:{members:{userId:owner,role:'viewer',joinedAt:new Date()}}});const switched=await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:foreign.organizationId}}),viewer=switched.data.tokens.accessToken;
 assert.equal((await call('/api/payments',{token:viewer})).data.length,1);for(const [url,method,payload]of [['/api/payments','POST',body],['/api/payments/'+f.id,'PUT',{revision:0,title:'Denied'}],['/api/payments/'+f.id,'DELETE',{revision:0}],['/api/payments/'+f.id+'/complete','POST',{revision:0}]])assert.equal((await call(url,{method,body:payload,token:viewer})).status,403);
 await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$pull:{members:{userId:owner}}});assert.equal((await call('/api/payments',{token:viewer})).status,403);
 pass('current membership permits viewer reads but blocks writes and revoked token access');
 const before=JSON.stringify(await db.collection('payments').find({}).toArray());assert.equal((await call('/api/migrate-payment-dates',{token})).status,410);assert.equal(JSON.stringify(await db.collection('payments').find({}).toArray()),before);
 const pending=await create({dueDate:'2099-01-01'});await create({dueDate:'2099-01-01'},foreign.token);const stats=await call('/api/dashboard/stats',{token});assert.equal(stats.status,200);assert.equal(stats.data.stats.upcomingPaymentsCount,1);
 pass('retired migration cannot alter dates and dashboard payment count excludes another company');
 const setup=await call('/api/auth/register',{method:'POST',body:{email:'calendar-setup@example.invalid',password:'Synthetic-password-Only1!',name:'Synthetic calendar setup'}});assert.equal(setup.status,200);
 const setupStats=await call('/api/dashboard/stats',{token:setup.data.tokens.accessToken});assert.equal(setupStats.status,200);assert.equal(setupStats.data.hasOrganization,false);assert.equal(setupStats.data.organization,null);assert.deepEqual(setupStats.data.recentTransactions,[]);
 assert.deepEqual(setupStats.data.stats,{total:{count:0,amount:0},expense:{count:0,amount:0},income:{count:0,amount:0},receiptMatchRate:0,receiptsCount:0,upcomingPaymentsCount:0,recentActivityCount:0});assert.equal((await call('/api/dashboard/stats')).status,401);assert.equal((await call('/api/dashboard/stats',{token:viewer})).status,403);
 pass('dashboard without a selected company returns setup with no financial data and revoked membership still fails');
 const removable=await create(),removalStore=load({user,fetch:http});try{await removalStore.fetchPayments();assert.equal((await removalStore.deletePayment(removable.id,removable.revision)).success,true);await removalStore.fetchPayments();assert(!removalStore.payments.some(x=>x.id===removable.id));assert((await db.collection('payments').findOne({_id:new ObjectId(removable.id)})).deletedAt);}finally{removalStore.$dispose()}
 const conflictRow=await create({amount:100}),conflictStore=load({user,fetch:http});try{await conflictStore.fetchPayments();assert.equal((await call('/api/payments/'+conflictRow.id,{method:'PUT',token,body:{revision:conflictRow.revision,amount:900}})).status,200);await assert.rejects(conflictStore.updatePayment(conflictRow.id,{amount:100,notes:'Synthetic draft'},conflictRow.revision));await conflictStore.refreshRecovery();assert.equal(conflictStore.payments.find(x=>x.id===conflictRow.id).amount,900);await assert.rejects(conflictStore.updatePayment(conflictRow.id,{amount:100},conflictRow.revision));await conflictStore.refreshRecovery();assert.equal((await db.collection('payments').findOne({_id:new ObjectId(conflictRow.id)})).amount,900);}finally{conflictStore.$dispose()}
 pass('compiled client removes an entry with a DELETE body and recovery never blesses an old edit revision');
 if(process.env.OMF_TEST_CHROME_PORT)await browser({db,origin,group,owner,foreign,pass,create,pending,call,token});
};
async function browser({db,origin,group,owner,foreign,pass,create,call,token}){
 const path=require('node:path'),p=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 try{
  const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-15`,payment=await create({title:'Synthetic Chrome calendar',dueDate:day});
  await create({title:'Synthetic foreign browser calendar',dueDate:day},foreign.token);
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light')});await page.reload({waitUntil:'networkidle2'});await page.type('#email','calendar-setup@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');await page.waitForSelector('main a[href="/settings/organization/new"]');assert(await page.$('main a[href="/settings/organization/join"]'));
  pass('real Chrome fresh account reaches company setup without financial data');
  await page.evaluate(()=>localStorage.clear());
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light')});await page.reload({waitUntil:'networkidle2'});await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  const select=async id=>assert.equal(await page.evaluate(async id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(id),String(id)),true);await select(group);await page.goto(origin+'/calendar',{waitUntil:'networkidle2'});
  const selector=`[data-complete-payment="${payment.id}"]`;await page.waitForSelector(selector);let reject=true,posts=0;await page.setRequestInterception(true);const completionInterceptor=r=>{if(r.method()==='POST'&&r.url().endsWith('/payments/'+payment.id+'/complete')){posts++;if(reject){r.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic calendar unavailable'})});return}}r.continue()};page.on('request',completionInterceptor);
  await page.click(selector);await page.waitForSelector('main [role="alert"]');assert.equal(posts,1);assert.equal((await db.collection('payments').findOne({_id:new ObjectId(payment.id)})).status,'pending');
  reject=false;await page.click(selector);await page.waitForFunction(s=>!document.querySelector(s),{},selector);await page.reload({waitUntil:'networkidle2'});assert.equal(posts,2);assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+payment.id}),1);assert((await page.$eval('main',n=>n.textContent)).includes(payment.title));
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT});await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});}
  pass('real Chrome calendar exposes failed completion and retries one persisted transaction after reload');
  page.off('request',completionInterceptor);await page.setRequestInterception(false);
  await followupBrowser({page,db,origin,group,owner,foreign,pass,create,call,token,select});
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$push:{members:{userId:owner,role:'viewer',joinedAt:new Date()}}});await select(foreign.organizationId);await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Synthetic foreign browser calendar'));assert(!(await page.$eval('main',n=>n.textContent)).includes(payment.title));assert.equal(await page.$$eval('main [data-complete-payment]',nodes=>nodes.filter(n=>!n.disabled).length),0);
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$pull:{members:{userId:owner}}});await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('main [role="alert"]');assert(!(await page.$eval('main',n=>n.textContent)).includes('Synthetic foreign browser calendar'));assert.deepEqual(errors,[]);
  pass('real Chrome company switching clears old calendar data and viewer or revoked membership cannot complete');
 }catch(e){if(page&&process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png')});throw e}finally{if(page)await page.close();browser.disconnect()}
}

async function followupBrowser({page,db,origin,group,owner,foreign,pass,create,call,token,select}){
 const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const modal='[data-payment-modal]',field=name=>modal+' [data-payment-field="'+name+'"]';
 const set=async(name,value)=>page.$eval(field(name),(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}))},value);
 const open=async id=>{await page.waitForSelector('[data-payment-title="'+id+'"]');await page.click('[data-payment-title="'+id+'"]');await page.waitForSelector(modal)};
 const close=async()=>{await page.click(modal+' [data-close-payment]');await page.waitForSelector(modal,{hidden:true})};
 const save=async()=>page.click(modal+' [data-save-payment]');
 const fetched=async id=>(await call('/api/payments/'+id,{token})).data;
 const remove=async id=>{const latest=await fetched(id);assert.equal((await call('/api/payments/'+id,{method:'DELETE',token,body:{revision:latest.revision}})).status,200)};
 await page.setViewport({width:1440,height:1000});await page.click('[data-add-payment]');await page.waitForSelector(modal);
 await set('title','Synthetic browser form');await set('amount',0);await set('dueDate',today);await save();await page.waitForSelector(modal,{hidden:true});
 const added=await db.collection('payments').findOne({title:'Synthetic browser form'});assert.equal(added.amount,0);assert.equal(added.currency,'JPY');assert.equal(added.dueDate.toISOString(),today+'T12:00:00.000Z');
 await open(String(added._id));await set('notes','Synthetic edited note');await save();await page.waitForSelector(modal,{hidden:true});assert.equal((await fetched(added._id)).notes,'Synthetic edited note');
 await open(String(added._id));await page.click(modal+' [data-delete-payment]');await page.waitForSelector(modal,{hidden:true});assert((await db.collection('payments').findOne({_id:added._id})).deletedAt);
 pass('real Chrome calendar add edit and DELETE preserve zero date and entered form values');

 const edit=await create({title:'Synthetic concurrent form',amount:100,dueDate:today,notes:'original',bankTransfer:{bankName:'Synthetic bank',branchName:'Test',accountType:'ordinary',accountNumber:'1234567',accountHolder:'SYNTHETIC'}});
 await page.reload({waitUntil:'networkidle2'});await open(edit.id);await set('notes','my unsaved draft');await set('bankTransfer.accountNumber','7654321');
 assert.equal(await page.evaluate(id=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').payments.find(p=>p.id===id).bankTransfer.accountNumber,edit.id),'1234567');
 assert.equal((await call('/api/payments/'+edit.id,{method:'PUT',token,body:{revision:edit.revision,amount:900}})).status,200);
 let failReads=1,puts=0,held,holdNext=false;
 const intercept=r=>{if(r.method()==='PUT'&&r.url().endsWith('/payments/'+edit.id))puts++;if(r.method()==='GET'&&new URL(r.url()).pathname==='/api/payments'){if(failReads){failReads--;return r.respond({status:503,contentType:'application/json',body:'{"message":"Synthetic recovery read failure"}'})}if(holdNext){holdNext=false;held=r;return}}r.continue()};
 await page.setRequestInterception(true);page.on('request',intercept);
 try{
  await save();await page.waitForFunction(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').recovery?.state==='failed');
  assert.equal(await page.$eval(field('notes'),n=>n.value),'my unsaved draft');assert.equal(await page.$eval(field('amount'),n=>n.value),'100');assert.equal(puts,1);
  await page.click(modal+' [data-refresh-payment]');await page.waitForFunction(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').recovery?.state==='ready');
  await page.click(modal+' [data-saved-comparison] summary');assert((await page.$eval(modal+' [data-saved-comparison]',n=>n.textContent)).includes('900'));
  await save();await page.waitForFunction(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').recovery?.state==='ready');assert.equal(puts,2);assert.equal((await fetched(edit.id)).amount,900);assert.equal(await page.$eval(field('notes'),n=>n.value),'my unsaved draft');
  if(!await page.$eval(modal+' [data-saved-comparison]',node=>node.open))await page.click(modal+' [data-saved-comparison] summary');await page.waitForSelector(modal+' [data-use-saved]',{visible:true});
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-conflict-desktop.png')});await page.setViewport({width:390,height:844});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-conflict-mobile.png')});await page.setViewport({width:1440,height:1000});}
  await page.click(modal+' [data-use-saved]');await page.waitForFunction(()=>document.querySelector('[data-payment-field="amount"]').value==='900');assert.equal(await page.$eval(field('notes'),n=>n.value),'original');assert.equal(await page.$eval(field('bankTransfer.accountNumber'),n=>n.value),'1234567');await set('notes','Confirmed after review');await save();await page.waitForSelector(modal,{hidden:true});assert.equal(puts,3);assert.equal((await fetched(edit.id)).amount,900);assert.equal((await fetched(edit.id)).notes,'Confirmed after review');
  pass('real Chrome conflict recovery preserves draft and nested bank details until explicit saved-version choice');
  await remove(edit.id);

  const terminal=await create({title:'Synthetic deleted link browser',dueDate:today}),posted=await call('/api/payments/'+terminal.id+'/complete',{method:'POST',token,body:{revision:terminal.revision}});assert.equal(posted.status,200);
  // Represent the already-tested lost paid-checkpoint state; subsequent deletion/reconciliation uses real HTTP.
  await db.collection('payments').updateOne({_id:new ObjectId(terminal.id)},{$set:{status:'pending','posting.state':'pending'}});
  assert.equal((await call('/api/transactions/'+(posted.data.transaction.id||posted.data.transaction._id),{method:'DELETE',token})).status,200);
  await page.reload({waitUntil:'networkidle2'});await page.click('[data-complete-payment="'+terminal.id+'"]');await page.waitForFunction(id=>document.querySelectorAll('[data-review-payment="'+id+'"]').length>=2,{},terminal.id);assert.equal(await page.$('[data-complete-payment="'+terminal.id+'"]'),null);
  const reviews=await page.$$('[data-review-payment="'+terminal.id+'"]');await reviews[0].click();await page.waitForSelector(modal);assert(await page.$(modal+' [data-terminal-summary]'));await close();
  const sidebar=await page.$$('[data-review-payment="'+terminal.id+'"]');await sidebar[sidebar.length-1].click();await page.waitForSelector(modal);await close();
  await page.$eval('[data-calendar-date="'+today+'"]',node=>node.click());await page.waitForSelector('[data-day-detail]');await page.click('[data-day-detail] [data-review-payment="'+terminal.id+'"]');await page.waitForSelector(modal);
  await page.click(modal+' [data-delete-payment]');await page.waitForSelector(modal,{hidden:true});assert((await db.collection('payments').findOne({_id:new ObjectId(terminal.id)})).deletedAt);assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+terminal.id}),1);assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+terminal.id,deletedAt:null}),0);
  pass('real Chrome deleted-link review works from grid day and upcoming then removes only the calendar entry');

  const pending=await create({title:'Synthetic pending checkpoint browser',dueDate:today}),done=await call('/api/payments/'+pending.id+'/complete',{method:'POST',token,body:{revision:pending.revision}});assert.equal(done.status,200);await db.collection('payments').updateOne({_id:new ObjectId(pending.id)},{$set:{status:'pending','posting.state':'pending'}});
  await page.reload({waitUntil:'networkidle2'});await open(pending.id);assert.equal(await page.$eval(field('title'),node=>node.matches(':disabled')),true);assert.equal(await page.$(modal+' [data-delete-payment]'),null);await page.click(modal+' [data-resume-payment]');await page.waitForSelector(modal+' [data-resume-payment]',{hidden:true});assert.equal(await db.collection('transactions').countDocuments({referenceNumber:'PAY-'+pending.id}),1);await close();await remove(pending.id);
  pass('real Chrome pending completion offers resume while preserving the original transaction identity');

  const missing=await create({title:'Synthetic removed open form',dueDate:today});await page.reload({waitUntil:'networkidle2'});await open(missing.id);await set('notes','Keep this missing-row draft');await remove(missing.id);await save();await page.waitForFunction(()=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('calendar').recovery?.state==='ready');assert.equal(await page.$eval(field('notes'),n=>n.value),'Keep this missing-row draft');assert.equal(await page.$(modal+' [data-save-payment]'),null);assert.equal(await page.$(modal+' [data-delete-payment]'),null);await close();
  pass('real Chrome removed open payment retains draft without turning it into a new entry');

  const switching=await create({title:'Synthetic late recovery owner row',dueDate:today});await page.reload({waitUntil:'networkidle2'});await open(switching.id);assert.equal((await call('/api/payments/'+switching.id,{method:'PUT',token,body:{revision:switching.revision,amount:700}})).status,200);holdNext=true;await save();
  for(let i=0;!held&&i<100;i++)await new Promise(r=>setTimeout(r,20));assert(held,'Expected held recovery GET');
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$push:{members:{userId:owner,role:'viewer',joinedAt:new Date()}}});await select(foreign.organizationId);await page.waitForSelector(modal,{hidden:true});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Synthetic foreign browser calendar'));const delayed=held,responseReady=page.waitForResponse(response=>response.request()===delayed);await delayed.continue();held=null;const lateData=await(await responseReady).json();assert(lateData.some(row=>row.id===switching.id));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(!(await page.$eval('main',n=>n.textContent)).includes(switching.title));await select(group);await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$pull:{members:{userId:owner}}});
  pass('real Chrome late conflict refresh cannot reopen or refill the previous company');
 }finally{if(held)await held.continue().catch(()=>{});page.off('request',intercept);await page.setRequestInterception(false)}
}

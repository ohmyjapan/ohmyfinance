const assert=require('node:assert/strict'),vue=require('vue'),{ObjectId}=require('mongodb'),path=require('node:path');
const workspace=require('./helpers/transaction-workspace.cjs'),form=require('./helpers/transaction-form.cjs');
module.exports=async({db,call,token,other,origin,directory,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),group=new ObjectId(claims.organizationId),owner=new ObjectId(claims.userId),id=new ObjectId();
 const original={_id:id,organizationId:group,referenceNumber:'SYNTHETIC-WORKSPACE',date:new Date('2026-09-22T13:14:15Z'),amount:0,type:'支出',status:'completed',taxRate:0,paymentMethod:'クレジットカード',cardNumber:'1234',trackingNumber:'Synthetic shipment',notes:'Workspace original',cardAccounting:{preserve:true},timeline:[]};await db.collection('transactions').insertOne(original);
 const http=require('ofetch').ofetch.create({baseURL:origin,retry:0});
 const user=vue.reactive({sessionId:'session-a',isAuthenticated:true,user:{id:String(owner)},authHeader:{Authorization:'Bearer '+token},currentOrganization:{id:String(group),role:'owner'},initAuth(){}});
 let dropEdit=false,dropCreate=false,creates=0;const request=async(url,o)=>{const result=await http(url,o);if(url==='/api/transactions'&&o.method==='POST'){creates++;if(dropCreate)throw Error('Synthetic lost create response');}if(dropEdit&&o.method==='PUT')throw Error('Synthetic lost edit response');return result;};
 const p=workspace({page:true,user,fetch:request});
 try{
  await p.mount();p.state.openEditModal(p.state.transactions.value[0]);const edit=await form(p.state.editingTransaction.value,{save:p.state.handleEditTransaction});
  try{edit.state.form.value.notes='Workspace reviewed';await edit.state.submitForm();assert(edit.emitted.some(e=>e[0]==='update:modelValue'));}finally{edit.close();}
  let row=await db.collection('transactions').findOne({_id:id});assert.equal(row.notes,'Workspace reviewed');for(const key of ['date','amount','type','status','taxRate','paymentMethod','cardNumber','trackingNumber','cardAccounting'])assert.deepEqual(row[key],original[key],key);
  pass('compiled transaction page and form edit through authenticated API without resetting accounting source fields');
  dropEdit=true;assert.equal(await p.state.handleEditTransaction({notes:'Saved despite lost response'}),false);assert(p.state.saveError.value);assert.equal((await db.collection('transactions').findOne({_id:id})).notes,'Saved despite lost response');assert.equal(p.state.transactions.value[0].notes,'Workspace reviewed');dropEdit=false;await p.state.fetchTransactions();assert.equal(p.state.transactions.value[0].notes,'Saved despite lost response');
  pass('lost edit response leaves visible failure and reload reads the actual saved record');
  dropCreate=true;assert.equal(await p.state.handleCreateTransaction({date:'2026-09-22',amount:1,notes:'Synthetic uncertain create'}),false);assert.equal(creates,1);assert.equal(p.state.saveOutcomeUnknown.value,true);assert.equal(await db.collection('transactions').countDocuments({organizationId:group,notes:'Synthetic uncertain create'}),1);await p.state.fetchTransactions();assert.equal(p.state.transactions.value.length,2);
  pass('lost create response is reported as uncertain and is never automatically replayed');
  let releaseList,announceList,listReads=0;const heldList=new Promise(resolve=>releaseList=resolve),capturedList=new Promise(resolve=>announceList=resolve);
  const overlap=workspace({user,fetch:async(url,options)=>{const response=await http(url,options);if(!options.method&&++listReads===1){announceList();await heldList}return response}});
  try{const reading=overlap.state.fetchTransactions();await capturedList;assert.equal(await overlap.state.updateTransaction(String(id),{notes:'Confirmed during list load'}),true);releaseList();assert.equal(await reading,false);for(let attempt=0;overlap.state.isLoading.value&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));const expected=await http('/api/transactions',{headers:user.authHeader,retry:0});assert.equal(listReads,2);assert.deepEqual(overlap.state.transactions.value.map(row=>row.id).sort(),expected.transactions.map(row=>String(row.id||row._id)).sort());assert.equal(overlap.state.transactions.value.find(row=>row.id===String(id)).notes,'Confirmed during list load');assert.equal(overlap.state.isLoading.value,false)}finally{releaseList();overlap.close()}
  pass('actual edit during list loading preserves confirmed metadata and every sibling row');
  const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic viewer workspace');
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$push:{members:{userId:owner,role:'viewer',joinedAt:new Date()}}});
  await db.collection('transactions').insertOne({organizationId:new ObjectId(foreign.organizationId),date:new Date(),amount:22,type:'支出',status:'pending',notes:'Foreign company visible'});
  const selected=await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:foreign.organizationId}});assert.equal(selected.status,200);const viewer=selected.data.tokens.accessToken;
  user.authHeader={Authorization:'Bearer '+viewer};user.sessionId='session-b';user.currentOrganization={id:foreign.organizationId,role:'viewer'};assert.deepEqual(p.state.transactions.value,[]);await vue.nextTick();await p.state.fetchTransactions();assert.equal(p.state.transactions.value.length,1);assert.equal(p.state.transactions.value[0].notes,'Foreign company visible');assert.equal(p.state.canEdit.value,false);assert.equal(await p.state.handleCreateTransaction({amount:1}),false);assert.equal((await call('/api/transactions/'+id,{token:viewer})).status,404);
  pass('selected viewer company clears the prior ledger and excludes its records and writes');
  if(process.env.OMF_TEST_CHROME_PORT)await browser({db,origin,group,id,foreign,owner,directory,pass});
 }finally{p.close();}
};

async function browser({db,origin,group,id,foreign,owner,pass}){
 const p=require('node:module').createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 try{
  const ja=require('../i18n/locales/ja.json');page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light');});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  const select=async groupId=>assert.equal(await page.evaluate(async selected=>document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user').switchOrganization(selected),String(groupId)),true);await select(group);
  await page.goto(origin+'/transactions/'+id,{waitUntil:'networkidle2'});await page.$$eval('main button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.transactionDetail.edit);
  const modal='body > .fixed.z-50',form=modal+' form';await page.waitForSelector(form);await page.waitForFunction(()=>!document.querySelector('.slide-panel-enter-active'));
  await page.$$eval(form+' button',(buttons,label)=>buttons.find(b=>b.textContent.trim()===label).click(),ja.transactionForm.detailsSection);await page.waitForFunction(()=>!document.querySelector('.collapse-enter-active'));
  const notes=await page.$(form+' textarea');await notes.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await notes.type('Chrome reviewed');
  let reject=true,writes=0;await page.setRequestInterception(true);page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/api/transactions/'+id)){writes++;if(reject){request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic edit unavailable'})});return;}}request.continue();});
  const submit=()=>page.$$eval(modal+' button',(buttons,label)=>{const b=buttons.find(n=>n.textContent.trim()===label);b.click();b.click();},ja.common.update);
  await submit();await page.waitForFunction(selector=>document.querySelector(selector+' [role="alert"]')?.textContent.includes('Synthetic edit unavailable'),{},modal);assert.equal(writes,1);assert.equal((await db.collection('transactions').findOne({_id:id})).notes,'Confirmed during list load');assert.equal(await notes.evaluate(n=>n.value),'Chrome reviewed');
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT});await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png')});}
  reject=false;await submit();await page.waitForFunction(selector=>!document.querySelector(selector),{},form);assert.equal(writes,2);await page.reload({waitUntil:'networkidle2'});assert((await page.$eval('main',n=>n.textContent)).includes('Chrome reviewed'));const saved=await db.collection('transactions').findOne({_id:id});assert.equal(saved.status,'completed');assert.equal(saved.taxRate,0);assert.equal(saved.cardNumber,'1234');
  pass('real Chrome detail editing retains failed input, prevents duplicate clicks and persists only changed metadata');
  await select(foreign.organizationId);await page.waitForSelector('main [role="alert"]');assert(!(await page.$eval('main',n=>n.textContent)).includes('Chrome reviewed'));assert.equal(await page.$$eval('main button',(buttons,label)=>buttons.filter(b=>b.textContent.trim()===label).length,ja.transactionDetail.edit),0);
  await page.goto(origin+'/transactions',{waitUntil:'networkidle2'});await page.waitForSelector('main tbody tr');assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),1);assert.equal(await page.$$eval('main button',(buttons,label)=>buttons.filter(b=>b.textContent.trim()===label).length,ja.transactionForm.createTitle),0);
  await db.collection('organizations').updateOne({_id:new ObjectId(foreign.organizationId)},{$pull:{members:{userId:owner}}});await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('main [role="alert"]');assert.equal(await page.$$eval('main tbody tr',rows=>rows.length),0);assert.deepEqual(errors,[]);
  pass('real Chrome company switch removes old detail and viewer writes while revocation clears the ledger');
 }catch(error){if(page&&process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png')});throw error;}
 finally{if(page)await page.close();browser.disconnect();}
}

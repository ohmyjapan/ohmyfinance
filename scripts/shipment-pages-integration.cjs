const assert=require('node:assert/strict'),path=require('node:path'),vue=require('vue');
const makeStore=require('./helpers/shipment-store.cjs'),makePage=require('./helpers/shipment-page.cjs');
module.exports=async({db,call,token,organizationId,id,purchaseId,origin,pass})=>{
 const profile=await call('/api/auth/me',{token});assert.equal(profile.status,200);
 const user=vue.reactive({...profile.data,sessionId:'page-integration',authHeader:{Authorization:'Bearer '+token}});
 assert.equal(user.currentOrganization.role,'member');
 let drop=true;const bodies=[];
 const store=makeStore({user,fetch:async(url,options={})=>{
  const response=await call(url,{token,method:options.method||'GET',body:options.body});
  if(response.status>=400)throw {data:response.data};
  if(url.endsWith('/tracking')){bodies.push(JSON.parse(JSON.stringify(options.body)));if(drop){drop=false;throw Error('Synthetic lost response after write');}}
  return response.data;
 }});
 const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Compiled page did not settle');};
 const list=makePage({store,user});
 try{await list.mount();await wait(()=>!store.isLoading);assert(list.state.shipments.value.some(x=>x.id===id));assert.equal(list.state.error.value,null);}finally{list.close();}
 const detail=makePage({detail:true,store,user,route:vue.reactive({params:{id}})});
 try{
  await detail.mount();await wait(()=>!store.isLoading);assert.equal(detail.state.shipment.value.id,id);assert.deepEqual(detail.state.shipment.value.transactionIds,[String(purchaseId)]);
  detail.state.openStatus();detail.state.newStatus.value='in_transit';detail.state.statusNotes.value='Compiled page durable scan';await detail.state.updateShipmentStatus();
  assert.equal(detail.state.updateStatus.value,true);assert.equal(detail.state.actionMessage.value,'');
  await detail.state.updateShipmentStatus();assert.deepEqual(bodies[0],bodies[1]);assert.equal(detail.state.updateStatus.value,false);
  await detail.state.load();assert.equal(detail.state.shipment.value.events.filter(x=>x.description==='Compiled page durable scan').length,1);assert.equal(detail.state.shipment.value.status,'in_transit');
 }finally{detail.close();}
 pass('compiled shipment list and detail read real records and retry one saved scan after a lost response');
 if(!process.env.OMF_TEST_CHROME_PORT)return;
 const {createRequire}=require('node:module');const p=createRequire(path.resolve(__dirname,'../collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 const userId=profile.data.user.id,{ObjectId}=require('mongodb');
 try{
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('theme','light');});await page.reload({waitUntil:'networkidle2'});
  await page.type('#email','finance-b@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');
  await page.waitForFunction(()=>location.pathname==='/');
  const switched=await page.evaluate(async organizationId=>{
   const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');return user.switchOrganization(organizationId);
  },organizationId);assert.equal(switched,true);
  await page.goto(origin+'/shipments',{waitUntil:'networkidle2'});await page.waitForSelector('main a[href*="/shipment/"]');
  assert.equal(await page.$$eval('main a[href*="/shipment/"]',links=>links.length),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-list.png'),fullPage:true});
  await page.click('main a[href*="/shipment/"]');await page.waitForSelector('main a[href*="/transactions/"]');
  assert((await page.$eval('main',e=>e.textContent)).includes('未登録'));
  assert.equal(await page.$eval('main a[href*="/transactions/"]',e=>e.getAttribute('href')),'/transactions/'+purchaseId);
  assert.equal(await page.$$('input[type="email"]').then(x=>x.length),0);
  await page.evaluate(()=>Array.from(document.querySelectorAll('main button')).find(b=>b.textContent.includes('ステータスを更新')).click());
  await page.waitForSelector('main [role="dialog"]');await page.select('#status','delivered');await page.type('#notes','Chrome verified scan');
  await page.evaluate(()=>Array.from(document.querySelectorAll('main [role="dialog"] button')).find(b=>b.textContent.includes('ステータスを更新')).click());
  await page.waitForFunction(()=>!document.querySelector('main [role="dialog"]')&&document.querySelector('main').textContent.includes('Chrome verified scan'));
  await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Chrome verified scan'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_SCREENSHOT){await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});await page.setViewport({width:1440,height:1000});await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png'),fullPage:true});}
  pass('real Chrome member pages show linked purchases and persist a manual scan across reload at mobile and desktop sizes');
  await db.collection('organizations').updateOne({_id:new ObjectId(organizationId),'members.userId':new ObjectId(userId)},{$set:{'members.$.role':'viewer'}});
  await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Chrome verified scan'));
  assert.equal(await page.$$eval('main button',buttons=>buttons.some(b=>b.textContent.includes('ステータスを更新'))),false);
  await page.goto(origin+'/shipment/000000000000000000000000',{waitUntil:'networkidle2'});await page.waitForSelector('main [role="alert"]');assert.equal(await page.$('main a[href*="/transactions/"]'),null);
  assert.deepEqual(errors,[]);pass('real Chrome viewer has no edit control and absent shipments show an error without demo data');
 }catch(error){
  if(page&&process.env.OMF_TEST_SCREENSHOT){const fs=require('node:fs');fs.writeFileSync(process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,text:document.querySelector('main')?.textContent,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,html:e.outerHTML})),shipment:document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('shipment')?.$state})),null,2));await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-failure.png'),fullPage:true});}
  throw error;
 }finally{
  await db.collection('organizations').updateOne({_id:new ObjectId(organizationId),'members.userId':new ObjectId(userId)},{$set:{'members.$.role':'member'}});
  if(page)await page.close();browser.disconnect();
 }
};

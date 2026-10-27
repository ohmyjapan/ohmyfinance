// Runs the actual chat and assistant routes against the harness's isolated app/database.
const assert=require('node:assert/strict'),path=require('node:path'),{ObjectId}=require('mongodb');
module.exports=async context=>{
 const {db,call,token,origin,root,pause,pass}=context;
 const masterOrganizationId=new (require('mongodb').ObjectId)(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).organizationId);
 const owner=(await db.collection('users').findOne({email:'finance-a@example.invalid'}))._id;
 const account=await db.collection('financialaccounts').findOne({ownerId:owner,name:'Synthetic Amex'}),customer=new ObjectId();
 await db.collection('customers').insertOne({organizationId:masterOrganizationId,_id:customer,name:'Learning test customer',isActive:true});
 const {fixture}=await import('./finance-learning-fixture.mjs'),{prepareWorkbook}=await import('./finance-learning-workbook.mjs'),{loadLearningBundle}=await import('./finance-learning-import.mjs');
 const {bytes,config}=fixture({ownerId:String(owner),accountBindings:[{accountId:String(account._id),labels:['Test card','Sub card']}],customerAliases:[{customerId:String(customer),name:'Learning test customer',labels:['Alias','Customer code']}]});
 await loadLearningBundle(db,prepareWorkbook(bytes,config));
 if(process.env.OMF_TEST_CHROME_PORT){
  const {createRequire}=require('node:module'),req=createRequire(path.join(root,'collector/package.json')),browser=await req('rebrowser-puppeteer-core').connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
  try{
   page=await browser.newPage();await page.goto(origin+'/login',{waitUntil:'networkidle2'});
   for(let i=0;i<100&&!await page.$('#email');i++)await pause(100);
   await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');
   for(let i=0;i<100&&await page.evaluate(()=>location.pathname==='/login');i++)await pause(100);
   assert.equal(await page.evaluate(()=>location.pathname),'/');
   pass('real Chrome signs in to the isolated test account');
  }finally{if(page)await page.close();await browser.disconnect()}
 }
 assert.equal((await call('/api/finance-chat/workspace',{token})).status,200);
 await require('./finance-chat-integration.cjs')(context);
 await require('./finance-assistant-integration.cjs')(context);
 await require('./finance-navi-actions-integration.cjs')(context);
};

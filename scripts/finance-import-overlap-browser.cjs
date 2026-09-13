const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async({origin,root,annualId,oldId,pass})=>{
 const {createRequire}=require('node:module'),req=createRequire(path.join(root,'collector/package.json'));
 const browser=await req('rebrowser-puppeteer-core').connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});
 let page;
 try{
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const wait=async fn=>{for(let n=0;n<150;n++){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100));}throw Error('Source overlap browser condition timed out');};
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});
  if(await page.$('#email')){
   await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await wait(()=>location.pathname==='/');
  }
  await page.evaluate(()=>localStorage.setItem('theme','light'));
  await page.goto(origin+'/mapping?import='+annualId,{waitUntil:'networkidle2'});
  await wait(()=>!!document.querySelector('[data-source-references]'));
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.mapping-list article').length),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.mapping .card')).backgroundColor),'rgb(255, 255, 255)');
  assert.ok(await page.evaluate(()=>document.querySelector('[data-source-references] summary').textContent.includes('4')));
  assert.ok(await page.evaluate(()=>document.querySelector('[data-custom-coverage]').textContent.includes('2026-10-31')));
  await page.click('[data-purpose-filter="purpose:supported"]');assert.equal(await page.evaluate(()=>document.querySelectorAll('.mapping-list article').length),1);
  if(process.env.OMF_TEST_OVERLAP_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_OVERLAP_SCREENSHOT.replace('.png','-mobile.png'),fullPage:true});
  await page.setViewport({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_OVERLAP_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_OVERLAP_SCREENSHOT,fullPage:true});
  await page.click('[data-source-references] summary');
  await page.click('[data-source-references] a');
  await wait(()=>!document.querySelector('[data-source-references]')&&!!document.querySelector('.mapping-list article'));
  assert.equal(new URL(page.url()).searchParams.get('import'),oldId);
  // Reset the purpose filter to include repayment and unresolved original rows.
  await page.click('[data-filter="all"]');assert.equal(await page.evaluate(()=>document.querySelectorAll('.mapping-list article').length),4);
  assert.equal(errors.length,0,errors.join('\n'));
  pass('real Chrome: original-mapping links, purpose filters, fiscal coverage, and light mobile/desktop layouts work');
 }finally{if(page)await page.close();await browser.disconnect();}
};

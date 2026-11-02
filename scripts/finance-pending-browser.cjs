const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({origin,root,bid,heldId,pass})=>{
 const {createRequire}=require('node:module'),p=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core');
 const browser=await p.connect({browserURL:'http://127.0.0.1:'+Number(process.env.OMF_TEST_CHROME_PORT),defaultViewport:null});let page;
 try{
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:390,height:844});
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});if(await page.$('#email')){await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname!=='/login');}
  await page.goto(origin+'/mapping?import='+bid,{waitUntil:'networkidle2'});await page.waitForSelector('[data-pending-summary]');
  assert.equal(await page.$$eval('.mapping-list article',rows=>rows.length),2);assert.match(await page.$eval('[data-pending-summary]',e=>e.textContent),/2件.*2,400/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT,fullPage:true});
  await page.goto(origin+'/mapping-draft/'+bid+'/2',{waitUntil:'networkidle2'});await page.waitForSelector('[data-action="save-draft"]');assert.equal(await page.$$eval('[data-action="prepare-post"]',r=>r.length),0);assert.match(await page.$eval('[data-statement-status]',e=>e.textContent),heldId ? /未請求・確定明細の差を確認/ : /未請求・確定待ち/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewport({width:1440,height:1000});await page.goto(origin+'/mapping?import='+bid,{waitUntil:'networkidle2'});await page.waitForSelector('[data-pending-summary]');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-desktop.png'),fullPage:true});
  // the カード連携 page: the provisional state is on the imported batch and in its review, the recent request exists for Amex only, and a provisional batch offers no posting control
  if(!heldId){
   for(const width of [390,1440]){
    await page.setViewport({width,height:1000});await page.goto(origin+'/connections',{waitUntil:'networkidle2'});await page.waitForSelector('[data-import-id="'+bid+'"]');
    assert.match(await page.$eval('[data-import-id="'+bid+'"]',e=>e.textContent),/未請求（仮）/,'recent-ui:the-batch-says-provisional');
    const cards=await page.$$eval('.account-grid section',sections=>sections.map(s=>({text:s.textContent,recent:s.querySelectorAll('[data-recent-sync]').length,confirmed:[...s.querySelectorAll('button')].filter(b=>b.textContent.trim()==='確定明細を取得').length})));
    assert.ok(cards.length>=2&&cards.every(c=>c.confirmed===1),'recent-ui:the-closed-button-stays '+JSON.stringify(cards.map(c=>c.confirmed)));
    assert.deepEqual(cards.filter(c=>c.text.includes('Pending synthetic Aplus')).map(c=>c.recent),[0],'recent-ui:no-recent-request-on-aplus');
    assert.ok(cards.filter(c=>!c.text.includes('Pending synthetic Aplus')).every(c=>c.recent===1),'recent-ui:the-recent-request-on-amex '+JSON.stringify(cards.map(c=>c.recent)));
    await page.$eval('[data-import-id="'+bid+'"]',e=>e.click());await page.waitForSelector('[data-provisional]');
    assert.match(await page.$eval('[data-provisional]',e=>e.textContent),/未請求（仮）.*帳簿に登録しません/,'recent-ui:the-review-says-provisional');
    assert.ok((await page.$$eval('.review-list article',rows=>rows.map(r=>r.textContent))).every(t=>t.includes('未請求（仮）')),'recent-ui:each-row-says-provisional');
    assert.equal(await page.$$eval('.review-list select',r=>r.length),0,'recent-ui:no-posting-control');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'recent-ui:no-horizontal-overflow');
    if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png','-connections-'+width+'.png'),fullPage:true});
   }
   pass('real Chrome shows 未請求（仮） on the batch and the review, offers the recent request on Amex only and no posting control on a provisional batch');
  }
  if(heldId){
   for(const width of [390,1440]){
    await page.setViewport({width,height:1000});await page.goto(origin+'/mapping?import='+heldId,{waitUntil:'networkidle2'});await page.waitForSelector('[data-pending-overlap]');
    await page.$eval('[data-source-references]',e=>e.open=true);
    assert.equal(await page.$$eval('.mapping-list article',rows=>rows.length),0);assert.match(await page.$eval('[data-pending-overlap]',e=>e.textContent),/追加の購入として数えません/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.$(`[data-source-references] a[href="/mapping?import=${bid}"]`));
    if(process.env.OMF_TEST_SCREENSHOT)await page.screenshot({path:process.env.OMF_TEST_SCREENSHOT.replace('.png',`-overlap-${width}.png`),fullPage:true});
   }
   assert.deepEqual(errors,[]);pass('real Chrome explains held forecast overlaps, excludes the copies and links the original at mobile and desktop sizes');
  }else{assert.deepEqual(errors,[]);pass('real Chrome shows pending totals and editable drafts while hiding posting controls on mobile and desktop');}
 }finally{await page?.close();await browser.disconnect();}
};

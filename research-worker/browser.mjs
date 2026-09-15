import {browserFor} from '../collector/browser.mjs';
import {publicUrl,publicGet} from './http.mjs';
export async function readBrowserPage(profile,url,{print=false}={}) {
 await publicUrl(url);
 const browser=await browserFor(profile),page=await browser.newPage();
 try{
  await page.setBypassServiceWorker(true);await page.setCacheEnabled(false);
  const session=await page.createCDPSession();await session.send('Network.enable');await session.send('Network.setBlockedURLs',{urls:['ws://*','wss://*']});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   if(request.isInterceptResolutionHandled())return;
   if(request.method()!=='GET'||['image','font','media'].includes(request.resourceType())){await request.abort().catch(()=>{});return}
   try{const response=await publicGet(request.url(),{maxBytes:4000000});if(!request.isInterceptResolutionHandled())await request.respond({status:200,contentType:response.mimeType,body:response.bytes})}catch{if(!request.isInterceptResolutionHandled())await request.abort().catch(()=>{})}
  });
  await page.goto(url,{waitUntil:'networkidle2',timeout:45000});
  const content=await page.evaluate(()=>({title:document.title,text:document.body.innerText}));
  const pdf=print?Buffer.from(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true})):null;
  return {...content,url:page.url(),pdf};
 }finally{await page.close().catch(()=>{});browser.disconnect()}
}

import {browserFor} from '../collector/browser.mjs';
import {publicUrl,publicGet} from './http.mjs';
// Real installed Chrome with default security, GET-only: every request is answered through the public HTTPS reader (public DNS
// pinning, public redirects only); non-GET, websocket, image, font and media requests are refused. Supplier research calls it
// with its defaults (visible owned browser kept for reuse). A company research read passes headless (no window), close (this
// read ends its own browser process; nothing else is closed) and resolveFinal (the main document is fetched first, so Chrome
// opens the actual final public URL after redirects and the captured URL is never a stale pre-redirect domain).
// labelUtf8 declares UTF-8 on text responses whose bytes are valid UTF-8 (the reader drops the header charset; without it Chrome
// mis-decodes Japanese pages that carry no meta charset). Other bytes keep the page's own declaration. get/check are the reader
// functions; only tests pass replacements.
const utf8=new TextDecoder('utf-8',{fatal:true});
const validUtf8=bytes=>{try{utf8.decode(bytes);return true}catch{return false}};
export async function readBrowserPage(profile,url,{print=false,headless,close=false,resolveFinal=false,labelUtf8=false,get=publicGet,check=publicUrl}={}) {
 await check(url);
 const first=resolveFinal?await get(url,{maxBytes:4000000}):null,target=first?first.url:url,served=new Map(first?[[target,first]]:[]);
 const browser=await browserFor(profile,headless===undefined?undefined:{headless}),page=await browser.newPage();
 try{
  await page.setBypassServiceWorker(true);await page.setCacheEnabled(false);
  const session=await page.createCDPSession();await session.send('Network.enable');await session.send('Network.setBlockedURLs',{urls:['ws://*','wss://*']});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   if(request.isInterceptResolutionHandled())return;
   if(request.method()!=='GET'||['image','font','media'].includes(request.resourceType())){await request.abort().catch(()=>{});return}
   try{const ready=served.get(request.url());if(ready)served.delete(request.url());const response=ready||await get(request.url(),{maxBytes:4000000});const contentType=labelUtf8&&/^(text\/|application\/(javascript|json|xhtml\+xml|xml))/.test(response.mimeType)&&validUtf8(response.bytes)?response.mimeType+'; charset=utf-8':response.mimeType;if(!request.isInterceptResolutionHandled())await request.respond({status:200,contentType,body:response.bytes})}catch{if(!request.isInterceptResolutionHandled())await request.abort().catch(()=>{})}
  });
  await page.goto(target,{waitUntil:'networkidle2',timeout:45000});
  const content=await page.evaluate(()=>({title:document.title,text:document.body.innerText}));
  const pdf=print?Buffer.from(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true})):null;
  return {...content,url:page.url(),pdf};
 }finally{await page.close().catch(()=>{});if(close)await closeOwned(browser);else browser.disconnect()}
}
// Ends exactly this browser: a graceful close, then this launched process only if it is still running.
async function closeOwned(browser){
 const child=browser.process();
 try{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,5000))])}catch{/* closing */}
 if(child&&child.exitCode===null&&child.signalCode===null){try{child.kill()}catch{/* gone */}await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))])}
}

import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

export function publicAddress(address) {
 if(net.isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||(a===192&&b===0));
}
export async function publicUrl(value) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hostname.endsWith('.local')||url.hostname==='localhost')throw Error('Only public HTTPS pages are allowed');
 const addresses=await dns.lookup(url.hostname,{all:true,family:4});
 if(!addresses.length||addresses.some(r=>!publicAddress(r.address)))throw Error('Private network page rejected');
 return {url,address:addresses[0].address};
}
export async function publicGet(value,{maxBytes=2000000,registry=false}={},redirects=0) {
 const {url,address}=await publicUrl(value);
 if(!registry&&/(^|\.)invoice-kohyo\.nta\.go\.jp$/i.test(url.hostname))throw Error('Use the official registry API tool');
 const response=await new Promise((resolve,reject)=>{
  const req=https.get(url,{headers:{'User-Agent':'OhMyFinance supplier research','Accept':'text/html,application/json,application/pdf','Accept-Encoding':'identity'},lookup:(_h,options,cb)=>options.all?cb(null,[{address,family:4}]):cb(null,address,4)},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();resolve({redirect:res.headers.location});return}
   if(res.statusCode!==200){res.resume();reject(Error('Public page returned HTTP '+res.statusCode));return}
   let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>maxBytes){req.destroy(Error('Page exceeds research size limit'));return}chunks.push(b)});res.on('end',()=>resolve({bytes:Buffer.concat(chunks),mimeType:String(res.headers['content-type']||'').split(';')[0],url:url.href}));res.on('error',reject);
  });req.setTimeout(15000,()=>req.destroy(Error('Public page timed out')));req.on('error',reject);
 });
 if(response.redirect){if(registry||redirects>=3)throw Error('Redirect limit reached');return publicGet(new URL(response.redirect,url).href,{maxBytes,registry},redirects+1)}
 return response;
}
export function htmlText(html) {
 return html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):''}).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}

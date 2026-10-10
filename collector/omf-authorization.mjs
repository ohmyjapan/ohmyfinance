import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';

export function secureOrigin(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use the HTTPS address of OMF for collector approval.');
  return u.origin;
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function securityCall(config,route,{body,grant,signal}={}){
  const origin=secureOrigin(config.baseUrl);
  const response=await fetch(new URL('/api/finance/collector-security/'+route,origin),{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',...(grant?{'X-Collector-Grant':grant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  let text='',length=0;const reader=response.body?.getReader();const decoder=new TextDecoder();
  if(reader)try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>32000){await reader.cancel();throw new Error('OMF returned an oversized approval response.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  let data;try{data=JSON.parse(text);}catch{throw new Error('OMF approval is unavailable. Try again later.');}
  if(!response.ok)throw Object.assign(new Error(data.statusMessage||'OMF did not authorize this action.'),{status:response.status});
  return data;
}
const launch=url=>new Promise((resolve,reject)=>execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,timeout:15000},error=>error?reject(new Error('Open the OMF approval link from the collector.')):resolve()));
// The injected transport/opener are constructor dependencies for isolated tests, never environment hooks.
export async function approveWithOmf(config,context,{signal,onLink=()=>{},call=securityCall,open=launch}={}){
  secureOrigin(config.baseUrl);
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('hex');
  const deadline=AbortSignal.timeout(5*60000),abort=signal?AbortSignal.any([signal,deadline]):deadline;
  abort.throwIfAborted();
  let done,fail,settled=false;
  const reply=new Promise((resolve,reject)=>{done=resolve;fail=reject;});reply.catch(()=>{});
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const target=new URL(req.url||'/',`http://127.0.0.1:${port}`);
    if(settled||req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||target.pathname!=='/collector-callback'||!equal(target.searchParams.get('state'),state)) {res.writeHead(400);res.end('Invalid collector callback.');return;}
    if(target.searchParams.get('error')==='access_denied'){settled=true;res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('Approval cancelled. Return to the collector.');fail(new Error('OMF approval was cancelled.'));return;}
    if(!/^[a-f0-9]{64}$/.test(target.searchParams.get('code')||'')){res.writeHead(400);res.end('Invalid collector callback.');return;}
    settled=true;res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('OMF approval received. You can return to the collector.');done(target.searchParams.get('code'));
  });
  let port;
  const cancel=()=>{settled=true;fail(new Error('OMF approval was cancelled or expired.'));server.closeAllConnections();};
  abort.addEventListener('abort',cancel,{once:true});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    port=server.address().port;abort.throwIfAborted();
    const created=await call(config,'requests',{body:{...context,state,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),redirectUri:`http://127.0.0.1:${port}/collector-callback`},signal:abort});
    const url=new URL(created.approvalUrl);
    if(url.origin!==secureOrigin(config.baseUrl)||url.pathname!=='/collector-approval'||!/^[a-f0-9]{64}$/.test(created.id)||url.searchParams.get('id')!==created.id)throw new Error('OMF returned an invalid approval link.');
    onLink(url.href);
    // Cancellation must also finish while the OS browser launcher is still waiting.
    await Promise.race([Promise.resolve().then(()=>open(url.href)).catch(()=>{}),reply.then(()=>undefined)]);
    abort.throwIfAborted();
    const code=await reply;abort.throwIfAborted();
    const result=await call(config,'exchange',{body:{id:created.id,code,verifier},signal:abort});
    abort.throwIfAborted();
    if(result.installationId!==context.installationId||result.generation!==context.generation||result.action!==context.action||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()||(['enroll','batch'].includes(context.action)&&!/^[a-f0-9]{64}$/.test(result.grant)))throw new Error('OMF returned an invalid authorization.');
    return result;
  }finally{abort.removeEventListener('abort',cancel);onLink(null);server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
}
export async function resumeWithOmf(config,context,trustToken,{signal,call=securityCall}={}){
  const result=await call(config,'session',{body:{installationId:context.installationId,generation:context.generation,trustToken},signal});
  if(result.installationId!==context.installationId||result.generation!==context.generation||result.publicKey!==context.publicKey||result.action!=='resume'||!/^[a-f0-9]{64}$/.test(result.grant)||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now())throw new Error('OMF returned an invalid PC authorization.');
  return result;
}
export function keyService(config,approval,signal,{renew,call=securityCall,now=Date.now}={}){
  let current={...approval},expiry=Math.min(Date.parse(current.expiresAt),now()+20*60000),ended=false,refreshing=null;
  const check=()=>{if(ended||now()>=expiry)throw new Error('The authorized access has ended.');signal?.throwIfAborted();};
  const revoke=grant=>call(config,'lock',{body:{},grant,signal:AbortSignal.timeout(3000)}).catch(()=>{});
  async function refresh(){
    if(ended)throw new Error('The authorized access has ended.');signal?.throwIfAborted();
    if(!renew||now()<expiry-60000)return;
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const next=await renew();
      if(ended||signal?.aborted){await revoke(next.grant);throw new Error('PC authorization was cancelled.');}
      if(next.installationId!==current.installationId||next.generation!==current.generation||!/^[a-f0-9]{64}$/.test(next.grant)||!Number.isFinite(Date.parse(next.expiresAt))||Date.parse(next.expiresAt)<=now())throw new Error('OMF returned an invalid renewed authorization.');
      const previous=current.grant;current={...next};expiry=Math.min(Date.parse(next.expiresAt),now()+20*60000);await revoke(previous);
    })();
    try{await refreshing;}finally{refreshing=null;}
  }
  return {
    get until(){return expiry;},refresh,
    async put(record){await refresh();check();const response=await call(config,'keys',{body:record,grant:current.grant,signal});check();if(response.keyId!==record.keyId||response.generation!==current.generation)throw new Error('OMF key registration did not match.');return response;},
    async get(keyId){await refresh();check();const response=await call(config,'keys/'+keyId,{grant:current.grant,signal});check();if(response.keyId!==keyId||response.generation!==current.generation)throw new Error('OMF returned a different key record.');return response;},
    async end(){if(ended)return;ended=true;const grant=current.grant;current.grant=null;await revoke(grant);},check
  };
}

import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';

export function secureOrigin(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use the HTTPS address of OMF for collector approval.');
  return u.origin;
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const SECURITY='/api/finance/collector-security/',CONNECT='/api/finance/collector-connect/';
const S256=verifier=>createHash('sha256').update(verifier).digest('base64url');
export async function securityCall(config,route,{body,grant,signal,prefix=SECURITY}={}){
  const origin=secureOrigin(config.baseUrl);
  const response=await fetch(new URL(prefix+route,origin),{method:body===undefined?'GET':'POST',headers:{...(config.token?{Authorization:`Bearer ${config.token}`}:{}),'Content-Type':'application/json',...(grant?{'X-Collector-Grant':grant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  let text='',length=0;const reader=response.body?.getReader();const decoder=new TextDecoder();
  if(reader)try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>32000){await reader.cancel();throw new Error('OMF returned an oversized approval response.');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  let data;try{data=JSON.parse(text);}catch{throw new Error('OMF approval is unavailable. Try again later.');}
  if(!response.ok)throw Object.assign(new Error(data.statusMessage||'OMF did not authorize this action.'),{status:response.status});
  return data;
}
// Initial Connect calls carry no collector token; only the acknowledgement carries the one just delivered.
export const connectCall=(config,route,options={})=>securityCall({baseUrl:config.baseUrl,token:options.token||''},route,{...options,prefix:CONNECT});
export const launch=url=>new Promise((resolve,reject)=>execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,timeout:15000},error=>error?reject(new Error('Open the OMF approval link from the collector.')):resolve()));
// Loopback receiver shared by approval and initial Connect: exact Host and path, state compared in constant time, one
// settlement (a 64-hex code or an explicit access_denied), closed by abort. Port 0 for a fresh request; a journaled port
// when a pending connection is resumed so the OMF page still returns to the same callback.
function loopback(state,{port=0,abort}){
  let done,fail,settled=false,listening=0;
  const reply=new Promise((resolve,reject)=>{done=resolve;fail=reject;});reply.catch(()=>{});
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const target=new URL(req.url||'/',`http://127.0.0.1:${listening}`);
    if(settled||req.method!=='GET'||req.headers.host!==`127.0.0.1:${listening}`||target.pathname!=='/collector-callback'||!equal(target.searchParams.get('state'),state)) {res.writeHead(400);res.end('Invalid collector callback.');return;}
    if(target.searchParams.get('error')==='access_denied'){settled=true;res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('Approval cancelled. Return to the collector.');fail(new Error('OMF approval was cancelled.'));return;}
    if(!/^[a-f0-9]{64}$/.test(target.searchParams.get('code')||'')){res.writeHead(400);res.end('Invalid collector callback.');return;}
    settled=true;res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('OMF approval received. You can return to the collector.');done(target.searchParams.get('code'));
  });
  const cancel=()=>{settled=true;fail(new Error('OMF approval was cancelled or expired.'));server.closeAllConnections();};
  abort.addEventListener('abort',cancel,{once:true});
  return {
    reply,
    get port(){return listening;},
    async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});listening=server.address().port;return listening;},
    async close(){abort.removeEventListener('abort',cancel);server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
  };
}
// The injected transport/opener are constructor dependencies for isolated tests, never environment hooks.
export async function approveWithOmf(config,context,{signal,onLink=()=>{},call=securityCall,open=launch}={}){
  secureOrigin(config.baseUrl);
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('hex');
  const deadline=AbortSignal.timeout(5*60000),abort=signal?AbortSignal.any([signal,deadline]):deadline;
  abort.throwIfAborted();
  const callback=loopback(state,{abort});
  try{
    const port=await callback.listen();abort.throwIfAborted();
    const created=await call(config,'requests',{body:{...context,state,codeChallenge:S256(verifier),redirectUri:`http://127.0.0.1:${port}/collector-callback`},signal:abort});
    const url=new URL(created.approvalUrl);
    if(url.origin!==secureOrigin(config.baseUrl)||url.pathname!=='/collector-approval'||!/^[a-f0-9]{64}$/.test(created.id)||url.searchParams.get('id')!==created.id)throw new Error('OMF returned an invalid approval link. Check that the saved OMF address exactly matches OMF’s configured HTTPS address, then save the connection again.');
    onLink(url.href);
    // Cancellation must also finish while the OS browser launcher is still waiting.
    await Promise.race([Promise.resolve().then(()=>open(url.href)).catch(()=>{}),callback.reply.then(()=>undefined)]);
    abort.throwIfAborted();
    const code=await callback.reply;abort.throwIfAborted();
    const result=await call(config,'exchange',{body:{id:created.id,code,verifier},signal:abort});
    abort.throwIfAborted();
    if(result.installationId!==context.installationId||result.generation!==context.generation||result.action!==context.action||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()||(['enroll','batch'].includes(context.action)&&!/^[a-f0-9]{64}$/.test(result.grant)))throw new Error('OMF returned an invalid authorization.');
    return result;
  }finally{onLink(null);await callback.close();}
}
const retryable=error=>!error?.status||error.status>=500||error.status===429;
async function withRetry(fn,abort,attempts=5){
  for(let attempt=0;;attempt++){
    try{return await fn();}
    catch(error){
      if(attempt>=attempts-1||!retryable(error)||abort.aborted)throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.min(8000,1000*2**attempt)));abort.throwIfAborted();
    }
  }
}
/**
 * Initial connection (plan omf-customer-connect-20261010): a token-less request on the packaged origin, the OMF sign-in
 * page in the browser, the loopback code, then the capsule exchanged with the PKCE verifier. `resume` carries the
 * journaled identity of an interrupted attempt (id, state, verifier, port, code): with a code no browser opens; with an
 * id the same callback port is reused. `record(phase, data)` is awaited before the next step so a crash resumes here.
 * The capsule is returned sealed; the caller opens it with the device key.
 */
export async function connectWithOmf(config,context,{signal,onLink=()=>{},call=connectCall,open=launch,resume={},record=async()=>{}}={}){
  const origin=secureOrigin(config.baseUrl);
  const deadline=AbortSignal.timeout(10*60000),abort=signal?AbortSignal.any([signal,deadline]):deadline;
  abort.throwIfAborted();
  const state=resume.state||randomBytes(32).toString('hex'),verifier=resume.verifier||randomBytes(32).toString('base64url');
  let id=resume.id||null,code=resume.code||null,port=resume.port||0;
  const callback=code?null:loopback(state,{port,abort});
  try{
    if(callback){
      try{port=await callback.listen();}catch(error){throw new Error(id?'The previous connection still holds its callback port. Press Connect to OMF to start a new connection.':`The collector could not open its callback port: ${error.message}`);}
      abort.throwIfAborted();
    }
    if(!id){
      const created=await call(config,'requests',{body:{...context,state,codeChallenge:S256(verifier),redirectUri:`http://127.0.0.1:${port}/collector-callback`},signal:abort});
      const url=new URL(created.connectUrl);
      if(url.origin!==origin||url.pathname!=='/collector-connect'||!/^[a-f0-9]{64}$/.test(created.id)||url.searchParams.get('id')!==created.id)throw new Error('OMF returned an invalid connection link. Check that the packaged OMF address exactly matches OMF’s configured HTTPS address.');
      id=created.id;
      await record('created',{id,state,verifier,port,connectUrl:url.href,requestExpiresAt:created.expiresAt});
    }
    if(!code){
      const url=new URL('/collector-connect?id='+id,origin);
      onLink(url.href);
      await Promise.race([Promise.resolve().then(()=>open(url.href)).catch(()=>{}),callback.reply.then(()=>undefined)]);
      abort.throwIfAborted();
      code=await callback.reply;abort.throwIfAborted();
      await record('callback',{code});
    }
    const result=await withRetry(()=>call(config,'exchange',{body:{id,code,verifier},signal:abort}),abort);
    abort.throwIfAborted();
    if(result.id!==id||result.installationId!==context.installationId||result.generation!==context.generation||!/^[a-f\d]{24}$/.test(result.collectorId)||!/^[a-f\d]{24}$/.test(result.ownerId)||typeof result.pcName!=='string'||!Array.isArray(result.accounts)||!result.accounts.length||!result.capsule||typeof result.capsule!=='object'||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now())throw new Error('OMF returned an invalid connection.');
    return result;
  }finally{onLink(null);if(callback)await callback.close();}
}
/** Receipt after the durable local save, by the delivered token and the remembered-PC secret; retried on transient failure. */
export async function acknowledgeWithOmf(config,body,{signal,call=connectCall}={}){
  const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(2*60000)]):AbortSignal.timeout(2*60000);
  const result=await withRetry(()=>call(config,'ack',{body,signal:abort,token:config.token}),abort);
  if(result.acknowledged!==true)throw new Error('OMF did not acknowledge the connection.');
  return result;
}
/** Best-effort release of an abandoned request by its state; the server also expires it on its own deadline. */
export async function cancelConnectWithOmf(config,{id,state},{call=connectCall}={}){
  if(!/^[a-f0-9]{64}$/.test(String(id||''))||!/^[a-f0-9]{64}$/.test(String(state||'')))return null;
  return call(config,'requests/'+id+'/cancel',{body:{state},signal:AbortSignal.timeout(10000)});
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

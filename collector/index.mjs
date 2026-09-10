import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault.mjs';
import { collectStatement } from './browser.mjs';
import { digest } from '../shared/amex.mjs';

const directory=path.resolve(process.env.OMF_COLLECTOR_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(),'OhMyFinance','collector'));
const vault=new Vault(directory), setupKey=randomBytes(32).toString('hex');
let message='Save the login details for each account. Start a download from OMF after pairing.', running=false;
export function validateOrigin(value) {
  const u=new URL(value);
  if(u.username || u.password || u.search || u.hash || u.pathname!=='/' || !['https:','http:'].includes(u.protocol))throw new Error('Use only the OMF site address');
  if(u.protocol==='http:' && !['localhost','127.0.0.1'].includes(u.hostname) && !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(u.hostname))throw new Error('Use HTTPS or the private Tailscale address');
  return u.origin;
}
async function api(config,route,body,query) {
  const url=new URL('/api/finance/collector/'+route,config.baseUrl);if(query)url.search=new URLSearchParams(query).toString();
  const csv=Buffer.isBuffer(body);
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':csv?'text/csv':'application/json'},...(body===undefined?{}:{body:csv?body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw new Error(data.statusMessage || 'OMF connection failed');return data;
}
async function pending(account) {
  const root=path.join(directory,'outbox',account._id);let folders=[];try{folders=await readdir(root,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=[];
  for(const folder of folders.filter(f=>f.isDirectory())){const dir=path.join(root,folder.name);try{const m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));if(!m.acknowledgedAt && m.accountId===account._id && m.primaryCard===account.primaryCard)result.push({directory:dir,manifest:m});}catch(e){if(e.code!=='ENOENT')throw e;}}
  return result;
}
async function upload(config,account,item) {
  const m=item.manifest;
  if(!/^[a-f\d-]{36}$/.test(m.filename))throw new Error('Invalid outbox filename');
  const bytes=await readFile(path.join(item.directory,m.filename));if(digest(bytes)!==m.sha256)throw new Error('Outbox file integrity check failed');
  const result=await api(config,'upload',bytes,{accountId:account._id,jobId:account.jobId,kind:m.kind,start:m.start,end:m.end,pageCount:String(m.pageCount)});
  await writeFile(path.join(item.directory,'manifest.json'),JSON.stringify({...m,acknowledgedAt:new Date().toISOString(),importId:result.id},null,2),{mode:0o600});return result;
}
async function tick() {
  if(running)return;running=true;let config,account,heartbeat;
  try {
    config=await vault.read();if(!config.token || !config.baseUrl)return;
    ({account}=await api(config,'claim',{}));if(!account)return;
    let currentState='running',currentMessage='Connecting to Amex',heartbeatFailure;
    const status=async(state,text)=>{if(heartbeatFailure)throw heartbeatFailure;currentState=state;currentMessage=text;message=`${account.name}: ${text}`;await api(config,'status',{accountId:account._id,jobId:account.jobId,state,message:text});};
    heartbeat=setInterval(()=>{api(config,'status',{accountId:account._id,jobId:account.jobId,state:currentState,message:currentMessage}).catch(e=>{heartbeatFailure=e;});},45000);
    const queued=await pending(account);
    for(const item of queued) {await status('running','Sending a previously downloaded statement');await upload(config,account,item);}
    if(!queued.length) {
      const settings=config.accounts?.[account.primaryCard] || {};
      const item=await collectStatement(account,settings,directory,status,{gmail:config.gmail});await status('running','Sending the downloaded statement to OMF');await upload(config,account,item);
    }
    clearInterval(heartbeat);await status('complete','Statement saved in OMF for review');
  } catch(error) {
    // Do not log browser errors, URLs, mail bodies, credentials, or response objects.
    message=account ? `${account.name}: ${error.message}` : 'OMF connection unavailable. Check the saved address and collector token.';
    if(account && config)await api(config,'status',{accountId:account._id,jobId:account.jobId,state:'failed',message:'Open the collector setup screen on Ryzen 7 for details'}).catch(()=>{});
  } finally {clearInterval(heartbeat);running=false;}
}
async function json(req) {let text='';for await(const data of req){text+=data;if(Buffer.byteLength(text)>20000)throw new Error('Request too large');}return JSON.parse(text);}
export async function startCollector() {
  await mkdir(directory,{recursive:true});
  const port=Number(process.env.OMF_COLLECTOR_PORT || 47831);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid setup port');
  const origin=`http://127.0.0.1:${port}`;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin))return reply(403,{error:'Local setup access required'});
      if(req.method==='GET' && ['/','/setup.js'].includes(req.url)) {res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(fileURLToPath(new URL(req.url==='/'?'./setup.html':'./setup.js',import.meta.url))));return;}
      if(req.headers['x-setup-key']!==setupKey)return reply(403,{error:'Reopen the setup screen from the collector launch link'});
      if(req.method==='GET' && req.url==='/status') {const config=await vault.read();let info=config.accountInfo || [];if(config.token)try{info=(await api(config,'accounts')).accounts;}catch{}return reply(200,{message,baseUrl:config.baseUrl,accounts:info.map(a=>({id:a.primaryCard,name:a.name,hasCredentials:!!config.accounts?.[a.primaryCard]?.password}))});}
      if(req.method==='POST' && req.url==='/pair') {const body=await json(req);if(!/^omfc_[a-f\d]{64}$/.test(body.token))throw new Error('Invalid collector token');const config={baseUrl:validateOrigin(body.baseUrl),token:body.token};const {accounts}=await api(config,'accounts');await vault.update(old=>({...old,...config,accountInfo:accounts.map(a=>({primaryCard:a.primaryCard,name:a.name}))}));return reply(200,{saved:true});}
      if(req.method==='POST' && req.url==='/credentials') {const body=await json(req);if(!/^\d{5}$/.test(body.accountId)||![body.username,body.password].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw new Error('Enter both Amex user ID and password');await vault.update(old=>{if(!old.accountInfo?.some(a=>a.primaryCard===body.accountId))throw new Error('Unknown account');return {...old,accounts:{...old.accounts,[body.accountId]:{...old.accounts?.[body.accountId],username:body.username,password:body.password}}};});return reply(200,{saved:true});}
      reply(404,{error:'Unknown setup endpoint'});
    }catch(error){reply(400,{error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await writeFile(path.join(directory,'setup-link.txt'),`${origin}/#${setupKey}`,{mode:0o600});
  console.log(`OMF collector listening on 127.0.0.1:${port}; setup link saved in the private collector directory`);
  setInterval(tick,10000);tick();
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startCollector().catch(()=>{console.error('OMF collector could not start. Check the setup port and Windows credential vault.');process.exitCode=1;});

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,readFile,writeFile,readdir,rename,link,unlink } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Vault, SplitStore, entryBinding, startBroker, testBrokerEnabled, aadOf, keyName, sealEnvelope, openEnvelope, samePublicKey, replaceVaultFile, DIALOG_TIMEOUT_MS, openCapsule } from './vault.mjs';
import { collectStatement, collectAplusStatement, closeOwnedBrowsers, findChrome, recoverEphemeral } from './browser.mjs';
import { collectBankStatement, observeBankPortal } from './bank.mjs';
import { BillingMailbox } from './mail.mjs';
import { openYayoi, yayoiCredentials } from './yayoi.mjs';
import { digest } from '../shared/amex.mjs';
import { approveWithOmf, resumeWithOmf, keyService, securityCall, secureOrigin, connectWithOmf, acknowledgeWithOmf, cancelConnectWithOmf, launch } from './omf-authorization.mjs';
import { AdbSmsSource, smsSourceInput, findAdb } from './sms-source.mjs';

// Saved bank/mail credentials open only during an authorized session. Remembered-PC access renews silently;
// idle ticks, status and uploads do not open bank/mail credentials. Once v3 activation completes, the DPAPI blob
// holds connection metadata and its collector token. Legacy credentials are read only by /protect after OMF approval.
const directory=path.resolve(process.env.OMF_COLLECTOR_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(),'OhMyFinance','collector'));
const vault=new Vault(directory), secrets=new SplitStore(directory), setupKey=randomBytes(32).toString('hex');
const STATE_FILE=path.join(directory,'vault-state.json'), ACL_SCRIPT=fileURLToPath(new URL('./windows/private-acl.ps1',import.meta.url));
const TICK_MS=Math.max(1000,Number(process.env.OMF_COLLECTOR_TICK_MS)||10000), BATCH_MS=Math.max(5000,Number(process.env.OMF_COLLECTOR_BATCH_MS)||20*60*1000);
const execute=promisify(execFile);
let message='Connect this PC once to let OMF download statements automatically.', running=false,activeAction=false;
let yayoiState={state:'idle',message:'Connect this PC, save your Yayoi login, then open Yayoi in Chrome.'};
let session=null;          // { id, broker, mode:'protected'|'manual', until, ran, browsers:Set<number>, publicKey, installationId }
let authorization=null, closing=null;
let keyLost=false, approvalUrl=null, reconnectNeeded=false, nextAutoAttempt=0, stopped=false, ticking=false;
const startup={done:false,acl:null,elevated:null,chromeFound:null,capability:null,recovered:null,packagedOrigin:null};
let connectJournal=null;   // in-memory copy of the DPAPI connect journal (connect-journal.dpapi); null when no connection is pending
// The packaged OMF address (collector/omf-config.json written by package/stage.mjs; OMF_COLLECTOR_ORIGIN for isolated tests
// and staged deployments). Consulted only for an unconnected installation: a saved connection keeps its own address.
const CONFIG_FILE=fileURLToPath(new URL('./omf-config.json',import.meta.url));
async function packagedOrigin() {
  if(process.env.OMF_COLLECTOR_ORIGIN)return secureOrigin(process.env.OMF_COLLECTOR_ORIGIN);
  let text;try{text=await readFile(CONFIG_FILE,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=JSON.parse(text);return value&&typeof value.origin==='string'?secureOrigin(value.origin):null;
}
const coded=(code,text)=>Object.assign(new Error(text),{code});
const codeOf=error=>({locked:409,legacy:409,conflict:409,forbidden:403,reparse:400}[error?.code] || 400);
async function vaultState() { try { return JSON.parse(await readFile(STATE_FILE,'utf8')); } catch(error) { if(error.code==='ENOENT')return null; throw error; } }
async function writeState(state) { await replaceVaultFile(STATE_FILE,JSON.stringify(state,null,2)); }
async function legacyBlobPresent() { return readFile(vault.file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}); }
// Connection metadata can include the polling token, but never saved bank/mail credentials after activation.
async function metadata() {
  const state=await vaultState();
  if(state?.v===3 && state.phase==='active')return vault.read();
  const connection=await secrets.connection();
  if(connection)return connection;
  if(state?.v===2)return vault.read(); // old v2 metadata; legacy sealed entries remain unreadable here
  if(await legacyBlobPresent())throw coded('legacy','Connect to OMF to authorize migration of your saved logins.');
  return {accounts:{}};
}
const activated=(state,config)=>!!(state?.v===3 && state.phase==='active' && !state.resetPending && config?.protection?.activatedAt);
const capabilityOf=()=>true;
async function updateMetadata(updater) {
  return secrets.withLock(async()=>{
    const state=await vaultState();
    if(state?.v===3&&state.phase==='active')return vault.update(updater);
    return secrets.connection(await updater(await secrets.connection()||{accounts:{}}));
  });
}

function aadFor(installationId,provider,account,config) {
  if(provider==='amex'||(provider==='aplus'&&account)) return aadOf({installationId,origin:config.baseUrl,ownerId:account.ownerId,provider,accountId:account._id});
  // Service credentials and the canary bind to the single owner of the current pairing.
  let origin='',ownerId=`local:${installationId}`;
  if(config?.token || config?.baseUrl) {
    origin=validateOrigin(config.baseUrl);
    if(!/^omfc_[a-f\d]{64}$/.test(config.token))throw coded('conflict','Reconnect OMF before saving or opening this login');
    const owners=[...new Set((config.accountInfo||[]).map(a=>String(a.ownerId||'')))];
    if(owners.some(id=>!/^[a-f\d]{24}$/.test(id)) || owners.length>1)throw coded('conflict','OMF returned inconsistent account ownership; reconnect before using saved logins');
    // An empty account list has no owner identity. Bind to this exact token until one is known.
    ownerId=owners[0] || `pairing:${digest(config.token)}`;
  }
  return aadOf({installationId,origin,ownerId,provider,accountId:account?._id||provider});
}
async function boundSecret(id,installationId,provider,account,config) {
  if(!(await secrets.has(id)))return false;
  try{return JSON.stringify(entryBinding(await secrets.read(id)))===JSON.stringify(aadFor(installationId,provider,account,config));}catch{return false;}
}
async function privateAcl({verifyOnly=false}={}) {
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-File',ACL_SCRIPT,'-Root',directory,...(verifyOnly?['-VerifyOnly']:[])],{windowsHide:true,timeout:60000});
  return JSON.parse(stdout.trim());
}
async function probeCapability() { return {ok:true,provider:'CurrentUser DPAPI plus OMF key custody'}; }
const liveSession=()=>session && !session.closing && Date.now()<session.until ? session : null;
function assertSession(live) { if(!live || liveSession()!==live)throw coded('forbidden','The connection has ended. Reconnect this PC.'); }
async function authorize(change) {
  if(authorization || closing || session)throw coded('conflict','Pause syncing or wait for the current connection request to finish.');
  let finish=()=>{};
  const pending={cancelled:false,broker:null,abort:new AbortController(),done:new Promise(resolve=>{finish=()=>resolve(undefined);})};
  authorization=pending; // Reserve before the first await: concurrent requests cannot create a second broker.
  try { return await change(pending); }
  finally { if(authorization===pending)authorization=null;finish(); }
}
function assertAuthorization(pending) { if(pending.cancelled)throw coded('conflict','Authorization was cancelled; nothing was unlocked'); }
async function omfApproval(pending,config,context) {
  assertAuthorization(pending);
  const result=await approveWithOmf(config,context,{signal:pending.abort.signal,onLink:link=>{approvalUrl=link;}});
  assertAuthorization(pending);return result;
}
// `approval` (initial Connect): the grant delivered inside the connection capsule is used as this session's authorization;
// no renewal or approval request is made for it, so the one sign-in on the OMF page is the only human step.
async function ownerBroker(pending,config,state,localKey,action='batch',interactive=true,{approval:delivered=null}={}) {
  let broker;
  try{broker=await startBroker('owner',{onEvent:brokerEvent});}catch(error){localKey?.close();throw error;}
  pending.broker=broker;
  const end=broker.end.bind(broker);let ended=false;
  broker.end=async()=>{if(ended)return;ended=true;if(pending.broker===broker)pending.broker=null;localKey?.close();const remote=broker.remote;const revoke=remote?.end().catch(()=>{});try{await end();}finally{await revoke;}};
  try {
    const desktop=await broker.request('available',{},10000);
    if(!desktop.ok||!desktop.available)throw coded('desktop','Syncing will resume after Windows is unlocked.');
    const loadTrust=()=>secrets.trustCredential(state.generation,{create:interactive});
    const trustToken=secrets.lease?await loadTrust():await secrets.withLock(loadTrust);
    const context={action,installationId:state.installationId,generation:state.generation,publicKey:localKey?.publicKey||state.publicKey,trustHash:digest(trustToken),...(state.previousGeneration?{previousGeneration:state.previousGeneration}:{})};
    const renew=()=>resumeWithOmf(config,context,trustToken,{signal:pending.abort.signal});
    let approval=delivered&&Date.parse(delivered.expiresAt)>Date.now()+60000?delivered:null;
    if(!approval&&(action==='batch'||action==='pair'||(action==='reset'&&state.previousGeneration===state.generation))){
      try{approval=await renew();}catch(error){if(!interactive||![401,403].includes(error.status))throw error;}
    }
    if(!approval)approval=await omfApproval(pending,config,context);
    broker.generation=state.generation;broker.localKey=localKey;
    if(approval.grant)broker.remote=keyService(config,approval,pending.abort.signal,{renew});
    return broker;
  }catch(error){await broker.end();throw error;}
}

async function endSession(reason) {
  if(closing)return closing;
  const current=session, pending=authorization;
  if(!current && !pending)return;
  if(current){current.closing=true;current.abort.abort();}
  if(pending){pending.cancelled=true;pending.abort.abort();}
  closing=(async()=>{
    if(pending){await pending.broker?.end().catch(()=>{});await pending.done;}
    try { await closeOwnedBrowsers(); } catch { /* the broker's job object ends what a close could not */ }
    if(current)await current.broker.end();
    if(session===current)session=null;
    message=`Locked (${reason}).`;
  })();
  try { await closing; } finally { closing=null; }
}
function brokerEvent(event) {
  if(['locked','closed'].includes(event.event) && (session?.broker===event.broker || authorization?.broker===event.broker))void endSession(event.event==='locked'?'Windows locked, signed out or sleeping':'the key broker ended').catch(()=>{message='Could not finish locking; restart the collector.';});
}
async function startSession(mode,{interactive=true}={}) {
  return authorize(async pending=>{
  if(session) throw coded('conflict','A batch is already unlocked');
  if(running) throw coded('conflict','Wait for the current collector action to finish');
  if(!startup.done) throw coded('conflict','Startup checks have not finished yet');
  if(startup.elevated) throw coded('conflict','Run the collector without administrator rights before unlocking');
  const acl=await privateAcl({verifyOnly:true}); startup.acl=acl; startup.elevated=acl.elevated;
  if(!acl.verified) throw coded(acl.code==='reparse'?'reparse':'conflict','Private directory permissions are not verified; nothing is unlocked');
  const state=await vaultState(), config=await metadata();
  if(state?.resetPending)throw coded('conflict','Finish the interrupted reset through OMF first.');
    if(config.paused)throw coded('conflict','Resume the collector first');
  if(mode==='protected') {
    if(!activated(state,config))throw coded('conflict','Connect to OMF and enable protection first');
    let localKey;
    try{localKey=await secrets.deviceKey(state.generation);}catch(error){keyLost=true;throw error;}
    if(localKey.publicKey!==state.publicKey){localKey.close();keyLost=true;throw coded('conflict','The local key does not match this installation. Reset protection to reconnect.');}
    const broker=await ownerBroker(pending,config,state,localKey,'batch',interactive);
    try{
      await secrets.open('check',aadFor(state.installationId,'check',null,config),broker);
      assertAuthorization(pending);keyLost=false;
      session={id:randomBytes(8).toString('hex'),broker,mode,until:broker.remote.until,ran:false,browsers:new Set(),publicKey:localKey.publicKey,installationId:state.installationId,abort:pending.abort};
      reconnectNeeded=false;
    }catch(error){if(error.status===404)keyLost=true;await broker.end();throw error;}

  } else {
    if(config.mode!=='manual') throw coded('conflict','Switch to manual sign-in mode first');
    const broker=await startBroker('owner',{onEvent:brokerEvent});pending.broker=broker;
    try {assertAuthorization(pending);}catch(error){await broker.end();throw error;}
    session={id:randomBytes(8).toString('hex'),broker,mode,until:Date.now()+BATCH_MS,ran:false,browsers:new Set(),publicKey:null,installationId:state?.installationId||null,abort:new AbortController()};
  }
  message=mode==='protected' ? 'Connected. Statements will sync automatically while this PC is available.' : 'Manual batch started; sign in to the bank in the collector window.';
  return session;
  });
}
const ownBrowser=live=>async({pid})=>{ assertSession(live);live.browsers.add(pid);const reply=await live.broker.request('own',{pid},30000);assertSession(live);if(!reply.ok)throw new Error('The batch could not take ownership of the browser'); };
function requireProtectedSession() { const live=liveSession();if(!live || live.mode!=='protected') throw coded('forbidden','Connect this PC before saving a login.'); return live; }
const writeSecret=(live,id,aad,value)=>secrets.withLock(()=>{assertSession(live);return secrets.save(id,aad,value,live.broker);});
async function runYayoi(credentials,live) {
  running=true;activeAction=true;
  const status=async(state,message)=>{yayoiState={state,message};};
  await status('running','Opening Yayoi in real Chrome.');
  try { assertSession(live);await openYayoi({services:{yayoi:credentials}},directory,status,{batch:live.id,ownerId:'local',onLaunch:ownBrowser(live)}); }
  catch { await status('attention','Yayoi could not finish signing in. Check that one Yayoi tab is open, then retry from this screen.'); }
  finally {running=false;activeAction=false;}
}
export function validateOrigin(value) {
  const u=new URL(value);
  if(u.username || u.password || u.search || u.hash || u.pathname!=='/' || !['https:','http:'].includes(u.protocol))throw new Error('Use only the OMF site address');
  if(u.protocol==='http:' && !['localhost','127.0.0.1'].includes(u.hostname) && !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(u.hostname))throw new Error('Use HTTPS or the private Tailscale address');
  return u.origin;
}
// A Buffer body is sent as-is with the caller's content type (text/csv unless told otherwise); JSON bodies are unchanged.
// `base` selects the OMF route family: the card collector routes by default; the bank routes live under BANK_BASE.
async function api(config,route,body,query,live,{contentType,base='/api/finance/collector/'}={}) {
  if(live)assertSession(live);
  const url=new URL(base+route,config.baseUrl);if(query)url.search=new URLSearchParams(query).toString();
  const csv=Buffer.isBuffer(body);
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':csv?(contentType||'text/csv'):'application/json'},...(body===undefined?{}:{body:csv?body:JSON.stringify(body)}),redirect:'error',signal:live?AbortSignal.any([live.abort.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.statusMessage || 'OMF connection failed'),{status:response.status});return data;
}
// Pending files are bound to the owner and OMF origin that produced them; a re-pair cannot redirect another pairing's outbox.
async function pending(account,config) {
  const root=path.join(directory,'outbox',account._id);let folders=[];try{folders=await readdir(root,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=[];
  for(const folder of folders.filter(f=>f.isDirectory())){const dir=path.join(root,folder.name);try{const m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));if(!m.acknowledgedAt && m.accountId===account._id && m.primaryCard===account.primaryCard && m.ownerId===String(account.ownerId) && m.origin===config.baseUrl)result.push({directory:dir,manifest:m});}catch(e){if(e.code!=='ENOENT')throw e;}}
  return result;
}
// The upload query of a retained artifact: Amex manifests keep today's shape (pageCount always present); Aplus statements
// add their displayed totals and the issuer-shown due date, Aplus pending captures carry no CSV row count, billing
// notices carry their mail id, the mail read's receipt only its kind.
export function uploadQuery(m,account) {
  const query={accountId:account._id,jobId:account.jobId,kind:m.kind};
  if(m.start!==undefined)query.start=m.start;if(m.end!==undefined)query.end=m.end;
  if(m.pageCount!==undefined&&m.pageCount!==null)query.pageCount=String(m.pageCount);
  if(m.kind==='statement'&&m.statementMonth!==undefined){query.statementMonth=m.statementMonth;query.statementTotal=String(m.statementTotal);if(m.refundTotal!==undefined&&m.refundTotal!==null)query.refundTotal=String(m.refundTotal);if(typeof m.paymentDueDate==='string'&&m.paymentDueDate)query.paymentDueDate=m.paymentDueDate;}
  if(m.kind==='notice'&&m.mailId!==undefined)query.mailId=String(m.mailId);
  return query;
}
// Sends the exact retained bytes with the manifest-derived content type; the acknowledgement is written only after OMF answered.
// `route`/`query`/`base` default to the card upload (unchanged for Amex/Aplus); bank artifacts pass bank/upload under BANK_BASE
// with bankUploadQuery (the manifest's own jobId and snapshotHash).
export async function upload(config,account,item,live,{route='upload',query=null,base=undefined}={}) {
  const m=item.manifest;
  if(!/^[a-f\d-]{36}$/.test(m.filename))throw new Error('Invalid outbox filename');
  const bytes=await readFile(path.join(item.directory,m.filename));if(digest(bytes)!==m.sha256)throw new Error('Outbox file integrity check failed');
  const result=await api(config,route,bytes,query||uploadQuery(m,account),live,{contentType:m.sourceFormat==='json'?'application/json':'text/csv',base});
  await replaceVaultFile(path.join(item.directory,'manifest.json'),JSON.stringify({...m,acknowledgedAt:new Date().toISOString(),importId:result.id},null,2));return result;
}
// ── Bank jobs (plan omf-bank-collection-amended-20261018 A5) ─────────────────────────────────────────────────────────────────
export const BANK_BASE='/api/finance-payments/collector/';
// Retained bank manifests of one account, bound to the owner and OMF origin that produced them. Each carries ITS OWN jobId and
// snapshotHash — the interpretation it was taken under — never the current job's.
export async function pendingBank(account,config,root=directory) {
  const base=path.join(root,'outbox','bank',String(account._id));let folders=[];try{folders=await readdir(base,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=[];
  for(const folder of folders.filter(f=>f.isDirectory())){const dir=path.join(base,folder.name);try{const m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));if(!m.acknowledgedAt && m.bankAccountId===String(account._id) && m.ownerId===String(account.ownerId) && m.origin===config.baseUrl && typeof m.jobId==='string' && typeof m.snapshotHash==='string')result.push({directory:dir,manifest:m});}catch(e){if(e.code!=='ENOENT')throw e;}}
  return result;
}
// The upload query of a retained bank artifact: the job and snapshot it was taken under, its kind, channel, source host and capture time.
export function bankUploadQuery(m) {
  const query={jobId:m.jobId,snapshotHash:m.snapshotHash,kind:m.kind==='observation'?'observation':'statement',labelChecked:String(m.labelChecked===true)};
  if(m.channel)query.channel=m.channel;if(m.sourceHost)query.sourceHost=m.sourceHost;if(m.downloadedAt)query.capturedAt=m.downloadedAt;if(typeof m.suggestedFilename==='string'&&m.suggestedFilename)query.name=m.suggestedFilename;
  return query;
}
// Card jobs keep priority: bank/claim is asked only when no card account was claimed. An OMF without the bank routes answers
// 404, which means "no bank job" (plan C3); every other failure propagates as before.
export async function claimWork(config,live) {
  const {account,covered}=await api(config,'claim',{},undefined,live);
  if(account)return {account,covered,bank:null};
  let bank=null;
  try{bank=await api(config,'bank/claim',{},undefined,live,{base:BANK_BASE});}catch(error){if(error.status!==404)throw error;}
  return {account:null,covered,bank:bank?.job?bank:null};
}
// One claimed bank job: drain the retained manifests (each under its own job and snapshot), then retrieve through the adapter
// (kind retrieve) or observe the portal (kind observe), retain and send every artifact, acknowledge each only after OMF
// answered, then complete. No secret is opened: the person signs in on the bank page. `deps` are the fixture's seams.
export async function runBankJob(bank,config,live,{status,pending:listPending=pendingBank,upload:send=upload,collect=collectBankStatement,observe=observeBankPortal,directory:root=directory,onLaunch=null,batch='batch',signal=null,now=Date.now}={}) {
  const {job,account}=bank;
  const sendItem=item=>send(config,account,item,live,{route:'bank/upload',base:BANK_BASE,query:bankUploadQuery(item.manifest)});
  let drained=0;
  for(const item of await listPending(account,config,root)){await status('running','保存済みの明細を送信中');await sendItem(item);drained++;}
  const bound={bankAccountId:String(account._id),ownerId:String(account.ownerId),origin:config.baseUrl,jobId:job.jobId,snapshotHash:job.snapshotHash,provider:job.provider};
  const result=job.kind==='retrieve'?await collect(bound,job,root,status,{batch,onLaunch,signal,now}):await observe(bound,job,root,status,{batch,onLaunch,signal,now});
  const items=[...(result.items||[])];
  if(result.observation){
    const dir=path.join(root,'outbox','bank',bound.bankAccountId,job.jobId+'-observation');await mkdir(dir,{recursive:true});
    const filename=randomUUID(),bytes=Buffer.from(JSON.stringify(result.observation)+'\n');
    await writeFile(path.join(dir,filename),bytes,{flag:'wx',mode:0o600});
    const manifest={...bound,kind:'observation',sourceFormat:'json',sha256:digest(bytes),filename,bytes:bytes.length,downloadedAt:new Date(now()).toISOString()};
    const file=path.join(dir,'manifest.json'),temporary=file+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});await link(temporary,file);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    items.push({directory:dir,manifest});
  }
  for(const item of items){await status('running',item.manifest.kind==='observation'?'観察記録を送信中':'明細を送信中');await sendItem(item);}
  if(result.failed){await status('failed',result.failed);return {drained,items:items.length,observation:!!result.observation,failed:result.failed,message:result.failed};}
  const statements=items.filter(i=>i.manifest.kind!=='observation').length;
  const message=job.kind==='observe'?`観察記録を保存${statements?`・明細 ${statements}件を保存`:''}`:statements?`明細 ${statements}件を保存`:'新しい明細はありません';
  await status('complete',message);
  return {drained,items:items.length,observation:!!result.observation,failed:null,message};
}
// The sealed entry a claimed account's bank login lives in: its own `<provider>-<id>` entry; else, for Aplus, the single
// legacy `aplus` service entry when exactly one Aplus account is in scope (it can only be that one); else none → manual sign-in.
export function credentialEntryFor(account,entries,scope=[]) {
  const provider=account?.provider||'amex',own=provider+'-'+account._id;
  if(entries.includes(own))return own;
  if(provider==='aplus'&&entries.includes('aplus')&&scope.filter(a=>(a.provider||'amex')==='aplus').length===1)return 'aplus';
  return null;
}
// Finalized months already retained in this account's outbox (acknowledged or not): a manifest on disk is never downloaded again.
async function outboxMonths(account,root,config) {
  const base=path.join(root,'outbox',account._id);let folders=[];try{folders=await readdir(base,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const months=new Set();
  for(const folder of folders.filter(f=>f.isDirectory())){try{const m=JSON.parse(await readFile(path.join(base,folder.name,'manifest.json'),'utf8'));if(m.accountId===account._id&&m.primaryCard===account.primaryCard&&m.ownerId===String(account.ownerId)&&m.origin===config.baseUrl&&m.kind==='statement'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(m.statementMonth||'')))months.add(m.statementMonth);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return [...months];
}
// A JSON artifact of the claimed job (a billing notice, the mail read's receipt) retained in the outbox exactly like a
// statement: bound to the account, owner, origin and job, hashed, acknowledged only after OMF answered.
async function writeJsonArtifact(root,bound,name,kind,value,extra,now) {
  const dir=path.join(root,'outbox',bound.accountId,name);await mkdir(dir,{recursive:true});
  const filename=randomUUID(),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  await writeFile(path.join(dir,filename),bytes,{flag:'wx',mode:0o600});
  const manifest={...bound,kind,sourceFormat:'json',...extra,sha256:digest(bytes),filename,downloadedAt:new Date(now()).toISOString()};
  const file=path.join(dir,'manifest.json'),temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});await link(temporary,file);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {directory:dir,manifest};
}
// One claimed Aplus job (plan omf-aplus-automation-20261013 §2 P2/C3): drain the outbox, read the issuer billing notices
// when the account asks for it (plan omf-calendar-gmail-build-20261015 §2 S11: every notice OMF does not yet hold becomes
// an outbox artifact and is uploaded; a durable receipt of the read follows, success or failure; a mail failure never
// stops the statements), collect what neither OMF nor the outbox holds, upload every new artifact, and complete only
// once each is acknowledged. A failed upload leaves the rest unacknowledged for the next claim. `deps` are the fixture's
// seams; the collector passes its own.
export async function runAplusJob(account,config,live,{status,covered=[],coveredNotices=[],mailbox=null,credentials={},pending:listPending=pending,upload:send=upload,collect=collectAplusStatement,directory:root=directory,onLaunch=null,batch='batch',codeSource=null,signal=null,now=Date.now}={}) {
  const label=item=>item.manifest.kind==='pending'?'未請求明細を送信中':item.manifest.kind==='notice'?'請求メールを送信中':item.manifest.kind==='billing-mail'?'請求メールの結果を送信中':`${item.manifest.statementMonth||'確定明細'} を送信中`;
  const drained={statement:0,pending:0,notice:0,mail:0};
  const bucket=kind=>kind==='pending'?'pending':kind==='notice'?'notice':kind==='billing-mail'?'mail':'statement';
  for(const item of await listPending(account,config)){await status('running',label(item));await send(config,account,item,live);drained[bucket(item.manifest.kind)]++;}
  if(account.billingMail?.enabled) {
    const bound={accountId:account._id,primaryCard:account.primaryCard,jobId:account.jobId,...(account.ownerId?{ownerId:String(account.ownerId)}:{}),origin:config.baseUrl,provider:'aplus'};
    const mail={read:0,sent:0,error:null};
    await status('running','請求メールを確認');
    try {
      if(!mailbox)throw new Error('メールボックスの接続が保存されていません');
      const notices=await mailbox.list(account,now()-45*86400000,{signal,now});
      mail.read=notices.length;
      for(const notice of notices) {
        signal?.throwIfAborted();
        if(coveredNotices.includes(notice.mailId))continue;
        const item=await writeJsonArtifact(root,bound,`${account.jobId}-notice-${notice.mailId}`,'notice',notice,{mailId:notice.mailId},now);
        await status('running',label(item));await send(config,account,item,live);mail.sent++;
      }
    } catch(error) {
      if(signal?.aborted||error?.name==='AbortError'||[401,403].includes(error?.status))throw error;
      mail.error=error?.message||'請求メールを読めませんでした';
    }
    const receipt=await writeJsonArtifact(root,bound,`${account.jobId}-mail`,'billing-mail',{kind:'billing-mail',ok:!mail.error,readAt:new Date(now()).toISOString(),noticesRead:mail.read,noticesSent:mail.sent,...(mail.error?{error:String(mail.error).slice(0,300)}:{})},{},now);
    await send(config,account,receipt,live);
    if(mail.error)await status('running','請求メールを読めませんでした');
  }
  const held=[...new Set([...covered,...await outboxMonths(account,root,config)])];
  const result=await collect(account,credentials,root,status,{batch,onLaunch,origin:config.baseUrl,covered:held,jobId:account.jobId,codeSource,signal});
  for(const item of [...result.items,...(result.pending?[result.pending]:[])]){await status('running',label(item));await send(config,account,item,live);}
  if(result.failed){await status('failed',result.failed);return {drained,items:result.items.length,pending:!!result.pending,nothing:false,failed:result.failed,message:result.failed};}
  const statements=result.items.length+drained.statement,pendings=(result.pending?1:0)+drained.pending;
  const message=statements+pendings===0?'すべての確定明細を取得済み':`確定明細 ${statements}件・未請求 ${pendings}件を保存`+(result.unavailable?.length?`（未提供: ${result.unavailable.join(', ')}）`:'');
  await status('complete',message);
  return {drained,items:result.items.length,pending:!!result.pending,nothing:statements+pendings===0,failed:null,message};
}
async function tick() {
  if(ticking||stopped)return;ticking=true;
  try{await tickWork();}catch(error){message=error.message||'Syncing will retry when OMF is available.';}finally{ticking=false;}
}
async function tickWork() {
  // A delivered connection whose activation was interrupted (crash, locked desktop) is finished without any human step:
  // the token is on disk, the remembered-PC secret renews the grant, the canary and activation journaling complete it.
  if(connectJournal&&['delivered','acknowledged'].includes(connectJournal.phase)&&!session&&!authorization&&!closing&&!running&&Date.now()>=nextAutoAttempt){
    nextAutoAttempt=Date.now()+30000;
    try{await authorize(pending=>finishConnect(pending));}catch(error){message=error.message;}
    return;
  }
  if(!session&&!authorization&&!closing&&!running&&!reconnectNeeded&&Date.now()>=nextAutoAttempt){
    nextAutoAttempt=Date.now()+30000;
    const state=await vaultState(),config=await metadata();
    if(activated(state,config)&&!config.paused&&config.mode==='protected'){
      try{await startSession('protected',{interactive:false});}
      catch(error){reconnectNeeded=[401,403].includes(error.status)||error.code==='reconnect'||keyLost;message=error.message;return;}
    }
  }
  if(session?.mode==='protected'&&!closing){
    const live=session;
    try{await live.broker.remote.refresh();if(session===live)live.until=live.broker.remote.until;}
    catch(error){reconnectNeeded=[401,403].includes(error.status);await endSession('OMF access is unavailable');message=reconnectNeeded?'Reconnect this PC through OMF to continue automatic syncing.':'OMF is unavailable. Syncing will retry automatically.';return;}
  }
  // Expiry ends the batch first, even while a job is still running: its browser closes and the job fails closed.
  if(session && Date.now()>session.until){await endSession('the batch expired');return;}
  if(running)return;
  const live=liveSession();if(!live)return;   // locked: no claim, no status post, no secret
  running=true;let config,account,covered,bank,heartbeat;
  try {
    config=await metadata();if(config.paused || !config.token || !config.baseUrl)return;
    ({account,covered,bank}=await claimWork(config,live));
    assertSession(live);
    if(!account&&!bank){ if(live.ran&&live.mode==='manual'){running=false;await endSession('batch complete');} return; }
    activeAction=true;
    if(bank) {
      // A claimed bank job (plan omf-bank-collection-amended-20261018 A5): status and the heartbeat go to the bank routes; no
      // secret is opened — the person signs in on the bank page inside the owned Chrome.
      let currentState='running',currentMessage='取得を開始',heartbeatFailure;
      const bankStatus=async(state,text)=>{assertSession(live);if(heartbeatFailure)throw heartbeatFailure;currentState=state;currentMessage=text;message=`${bank.account.name}: ${text}`;await api(config,'bank/status',{jobId:bank.job.jobId,state,message:text},undefined,live,{base:BANK_BASE});};
      heartbeat=setInterval(()=>{api(config,'bank/status',{jobId:bank.job.jobId,state:currentState,message:currentMessage},undefined,live,{base:BANK_BASE}).catch(e=>{heartbeatFailure=e;});},45000);
      await runBankJob(bank,config,live,{status:bankStatus,onLaunch:ownBrowser(live),batch:live.id,signal:live.abort.signal});
      assertSession(live);live.ran=true;
      clearInterval(heartbeat);
      return;
    }
    const aplusJob=(account.provider||'amex')==='aplus';
    let currentState='running',currentMessage=aplusJob?'明細の取得を開始':'Connecting to Amex',heartbeatFailure;
    const status=async(state,text)=>{assertSession(live);if(heartbeatFailure)throw heartbeatFailure;currentState=state;currentMessage=text;message=`${account.name}: ${text}`;await api(config,'status',{accountId:account._id,jobId:account.jobId,state,message:text},undefined,live);};
    heartbeat=setInterval(()=>{api(config,'status',{accountId:account._id,jobId:account.jobId,state:currentState,message:currentMessage},undefined,live).catch(e=>{heartbeatFailure=e;});},45000);
    if(aplusJob) {
      // Aplus (plan omf-aplus-automation-20261013): the outbox is drained, the missing finalized months and the unbilled page
      // are collected, each artifact is acknowledged, then the job completes. The saved login is opened only here, for the
      // claimed account's own entry (or the single legacy aplus entry when it can only belong to this account).
      let credentials={},gmail=null;
      assertSession(live);
      if(live.mode==='protected') {
        const entry=credentialEntryFor(account,await secrets.list(),config.accountInfo||[]);
        if(entry)credentials=await secrets.open(entry,aadFor(live.installationId,'aplus',entry==='aplus'?null:account,config),live.broker);
        // The mailbox grant is opened only when this claimed account reads its billing notices, exactly as the Amex branch
        // opens it for its login codes; never for an idle tick, a status or an upload.
        if(account.billingMail?.enabled&&await secrets.has('gmail'))gmail=await secrets.open('gmail',aadFor(live.installationId,'gmail',null,config),live.broker);
      }
      assertSession(live);
      // The statement-code source (plan omf-auto-sync-build-20261014 §2 A9): the configured tablet, read through adb inside
      // this claimed job only; the session's abort (Windows lock, pause, expiry, revocation) cancels the wait.
      const codeSource=config.smsSource?.serial?new AdbSmsSource({serial:config.smsSource.serial,directory}):null;
      const mailbox=gmail?new BillingMailbox(gmail):null;gmail=null;
      await runAplusJob(account,config,live,{status,covered:covered?.statements||[],coveredNotices:covered?.notices||[],mailbox,credentials,onLaunch:ownBrowser(live),batch:live.id,codeSource,signal:live.abort.signal});credentials=null;
      assertSession(live);live.ran=true;
      clearInterval(heartbeat);
    } else {
    const queued=await pending(account,config);
    for(const item of queued) {await status('running','Sending a previously downloaded statement');await upload(config,account,item,live);}
    if(!queued.length) {
      let credentials={},gmail=null;
      assertSession(live);
      if(live.mode==='protected') {
        // Secrets are opened only here, inside the authorized batch, for the claimed account only.
        if(await secrets.has('amex-'+account._id))credentials=await secrets.open('amex-'+account._id,aadFor(live.installationId,'amex',account,config),live.broker);
        if(await secrets.has('gmail'))gmail=await secrets.open('gmail',aadFor(live.installationId,'gmail',null,config),live.broker);
      }
      assertSession(live);
      const item=await collectStatement(account,credentials,directory,status,{gmail,batch:live.id,onLaunch:ownBrowser(live),origin:config.baseUrl});credentials=null;gmail=null;await status('running','Sending the downloaded statement to OMF');await upload(config,account,item,live);
    }
    assertSession(live);live.ran=true;
    clearInterval(heartbeat);await status('complete','Statement saved in OMF for review');
    }
  } catch(error) {
    // Do not log browser errors, URLs, mail bodies, credentials, or response objects.
    if([401,403].includes(error.status)){reconnectNeeded=true;await endSession('PC disconnected or account access changed');message='Reconnect this PC through OMF to continue automatic syncing.';return;}
    const label=account?account.name:bank?.account?.name;
    message=label ? `${label}: ${error.message}` : (error.code==='legacy' ? error.message : 'OMF connection unavailable. Check the saved address and collector token.');
    if(account && config)await api(config,'status',{accountId:account._id,jobId:account.jobId,state:'failed',message:'Open the downloader setup screen on the connected PC for details'},undefined,live).catch(()=>{});
    else if(bank && config)await api(config,'bank/status',{jobId:bank.job.jobId,state:'failed',message:'Open the downloader setup screen on the connected PC for details'},undefined,live,{base:BANK_BASE}).catch(()=>{});
  } finally {clearInterval(heartbeat);running=false;activeAction=false;}
}
// Each legacy entry is saved and reopened through OMF before rewriting the old DPAPI blob without bank/mail
// credentials. The v3 active marker finishes migration; /protect can resume either interrupted boundary.
function withoutSecrets(blob,protection,info) {
  const accounts={};
  for(const [card,entry] of Object.entries(blob.accounts||{}))accounts[card]=entry&&entry.profile?{profile:entry.profile}:{};
  const services={};
  for(const [name,value] of Object.entries(blob.services||{}))services[name]=value?.profile?{profile:value.profile}:{};
  const {gmail:_gmail,...rest}=blob;
  return {...rest,accounts,services,...(info?{accountInfo:info}:{}),protection};
}
async function planEntries(blob,installationId) {
  const entries=[],unmatched=[];
  let info=Array.isArray(blob.accountInfo)?blob.accountInfo:[];
  const legacyAccounts=Object.entries(blob.accounts||{}).filter(([,value])=>value&&(value.username||value.password));
  if(blob.token && blob.baseUrl) {
    const {accounts}=await api(blob,'accounts');
    info=accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
  }
  for(const [card,entry] of legacyAccounts) {
    const match=info.find(a=>a.primaryCard===card && a._id);
    if(!match){unmatched.push(card);continue;}
    const {profile:_profile,...secret}=entry;
    entries.push({id:'amex-'+match._id,aad:aadOf({installationId,origin:blob.baseUrl,ownerId:match.ownerId,provider:'amex',accountId:match._id}),secret});
  }
  const binding={...blob,accountInfo:info};
  for(const name of ['aplus','yayoi']){const value=blob.services?.[name];if(value&&(value.username||value.password)){const {profile:_profile,...secret}=value;entries.push({id:name,aad:aadFor(installationId,name,null,binding),secret});}}
  if(blob.gmail)entries.push({id:'gmail',aad:aadFor(installationId,'gmail',null,binding),secret:blob.gmail});
  entries.push({id:'check',aad:aadFor(installationId,'check',null,binding),secret:{canary:randomBytes(16).toString('hex')}});
  const legacyId='legacy-'+Date.now();
  entries.push({id:legacyId,aad:aadFor(installationId,'legacy',{_id:legacyId},binding),secret:blob});
  return {entries,unmatched,info:info.length?info:null,legacyId};
}
async function bindLegacyOutbox(blob,info) {
  if(!blob.baseUrl || !blob.token)return;
  const origin=validateOrigin(blob.baseUrl);
  for(const account of info||[]) {
    if(!/^[a-f\d]{24}$/.test(account._id) || !/^[a-f\d]{24}$/.test(account.ownerId))continue;
    const root=path.join(directory,'outbox',account._id);
    let folders=[];try{folders=await readdir(root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const folder of folders.filter(f=>f.isDirectory())) {
      const file=path.join(root,folder.name,'manifest.json');let manifest;
      try{manifest=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(manifest.acknowledgedAt || manifest.accountId!==account._id || manifest.primaryCard!==account.primaryCard)continue;
      if((manifest.ownerId!==undefined && manifest.ownerId!==account.ownerId) || (manifest.origin!==undefined && manifest.origin!==origin))continue;
      if(manifest.ownerId===account.ownerId && manifest.origin===origin)continue;
      // Only the original verified pairing can supply missing provenance, before activation permits re-pair.
      const temporary=file+'.binding-new';
      await writeFile(temporary,JSON.stringify({...manifest,ownerId:account.ownerId,origin},null,2),{mode:0o600});
      await rename(temporary,file);
    }
  }
}
async function protect() {
  return authorize(async pending=>secrets.withLock(async()=>{
    if(running||startup.elevated)throw coded('conflict','Stop the current action and run the collector without administrator rights.');
    const acl=await privateAcl({verifyOnly:true});if(!acl.verified)throw coded('conflict','Private directory permissions must be verified before enabling protection.');
    let state=await vaultState();const config=await metadata();
    if(state?.resetPending)throw coded('conflict','Finish the interrupted reset before enabling protection.');
    if(activated(state,config))throw coded('conflict','Protection is already enabled. Use Connect / reconnect.');
    if(config.paused)throw coded('conflict','Resume the collector before enabling protection.');
    secureOrigin(config.baseUrl);
    if(state?.v===2&&state.installationId&&(await secrets.list()).length){keyLost=true;throw coded('conflict','This installation uses the older device-key format. Reset protection and reconnect the bank logins.');}
    state=state?.v===3&&state.phase==='enrolling'?state:{v:3,phase:'enrolling',installationId:randomBytes(16).toString('hex'),generation:randomBytes(32).toString('hex'),legacyId:'legacy-'+Date.now()};
    const localKey=await secrets.deviceKey(state.generation,{create:true});state.publicKey=localKey.publicKey;
    await secrets.connection(config);await writeState(state);
    let broker;
    try {
      const remote=await securityCall(config,'installations/'+state.installationId,{signal:pending.abort.signal});
      if(remote.installation&&(remote.installation.generation!==state.generation||remote.installation.publicKey!==state.publicKey||!remote.installation.paired))throw coded('conflict','OMF has a different installation generation. Reconnect this collector.');
      broker=await ownerBroker(pending,config,state,localKey,remote.installation?'batch':'enroll');
      assertAuthorization(pending);
      const blob=await vault.read(); // only after OMF authorizes this remembered PC or its initial approval
      const hasLegacy=(Object.values(blob.accounts||{}).some(value=>value?.username||value?.password)||Object.values(blob.services||{}).some(value=>value?.username||value?.password)||!!blob.gmail);
      if(hasLegacy&&blob.baseUrl&&validateOrigin(blob.baseUrl)!==config.baseUrl)throw coded('conflict','Saved logins belong to another OMF address. Reconnect those logins instead of transferring them automatically.');
      if(hasLegacy&&blob.token){
        const previous=(await api(blob,'accounts')).accounts;
        const owners=new Set(previous.map(account=>String(account.ownerId)));
        if(owners.size!==1||!owners.has(String(config.accountInfo?.[0]?.ownerId)))throw coded('conflict','Saved logins belong to another OMF owner.');
      }
      const plan=await planEntries({...blob,...config,accounts:blob.accounts,services:blob.services,gmail:blob.gmail},state.installationId);
      const archived=plan.entries.find(entry=>entry.id===plan.legacyId);archived.id=state.legacyId;archived.aad=aadFor(state.installationId,'legacy',{_id:state.legacyId},config);
      for(const entry of plan.entries){
        assertAuthorization(pending);
        if(!await secrets.has(entry.id))await secrets.save(entry.id,entry.aad,entry.secret,broker);
        const restored=await secrets.open(entry.id,entry.aad,broker);
        if(!['check',state.legacyId].includes(entry.id)&&JSON.stringify(restored)!==JSON.stringify(entry.secret))throw coded('conflict','Migration verification failed; the original data remains available.');
      }
      for(const id of await secrets.list()){const entry=await secrets.read(id);await secrets.open(id,entryBinding(entry),broker);}
      const protection={installationId:state.installationId,generation:state.generation,keyProvider:'CurrentUser DPAPI + OMF',publicKey:state.publicKey,activatedAt:new Date().toISOString()};
      await bindLegacyOutbox(blob,plan.info);assertAuthorization(pending);
      await vault.update(()=>withoutSecrets({...blob,...config,accounts:blob.accounts,services:blob.services,mode:'protected'},protection,plan.info));
      await writeState({...state,phase:'active',activatedAt:protection.activatedAt});
      keyLost=false;
      session={id:randomBytes(8).toString('hex'),broker,mode:'protected',until:broker.remote.until,ran:false,browsers:new Set(),publicKey:state.publicKey,installationId:state.installationId,abort:pending.abort};
      reconnectNeeded=false;message='PC connected. Save your bank logins here; future syncing will resume automatically.';
      return {protected:true,unlocked:true,unmatched:plan.unmatched};
    }catch(error){if(broker)await broker.end();else localKey.close();throw error;}
  }));
}

// ── Initial Connect (plan omf-customer-connect-20261010) ─────────────────────────────────────────────────────────────
// One serialized flow in the same authorization slot as approvals. A DPAPI journal (request identity, PKCE verifier,
// state, callback port, then the code and the delivery) is persisted before each step so a crash resumes where it
// stopped: Resume connection on the setup page before the code arrived, automatically afterwards. The capsule OMF
// returns is opened with the device key, the connection is saved atomically with the journal, OMF is acknowledged, and
// the protected store is activated through the existing owner broker and canary. The journal is removed only then.
const CONNECT_MS=10*60000, FINISHING=['delivered','acknowledged'], ENDED=['cancelled','failed','done'];
async function saveJournal(value) { connectJournal=await secrets.enrollmentJournal(value); }
function connectStatus() {
  const j=connectJournal;
  if(!j)return {phase:'idle',resumable:false,finishing:false,expired:false,expiresAt:null};
  const finishing=FINISHING.includes(j.phase),expired=!finishing&&(ENDED.includes(j.phase)||!j.expiresAt||Date.parse(j.expiresAt)<=Date.now());
  return {phase:j.phase,resumable:!finishing&&!expired&&!authorization,finishing,expired,expiresAt:j.expiresAt||null};
}
// The capsule AAD rebuilt from local facts (request, origin, installation, generation) and the response fields the
// connection will be saved with; a capsule sealed for anything else does not open.
const connectAadFor=(journal,result)=>({v:1,kind:'collector-connect',requestId:String(journal.id),origin:String(journal.origin),installationId:String(journal.installationId),generation:String(journal.generation),ownerId:String(result.ownerId),collectorId:String(result.collectorId),accountIds:result.accounts.map(a=>String(a._id)).sort(),pcName:String(result.pcName)});
async function connect({resume=false}={}) {
  return authorize(async pending=>{
    if(session)throw coded('conflict','Pause syncing or wait for the current connection to finish.');
    if(running)throw coded('conflict','Wait for the current collector action to finish');
    if(!startup.done)throw coded('conflict','Startup checks have not finished yet');
    if(startup.elevated)throw coded('conflict','Run the collector without administrator rights before connecting');
    const acl=await privateAcl({verifyOnly:true});startup.acl=acl;startup.elevated=acl.elevated;
    if(!acl.verified)throw coded(acl.code==='reparse'?'reparse':'conflict','Private directory permissions are not verified; nothing is connected');
    if(connectJournal&&FINISHING.includes(connectJournal.phase))return finishConnect(pending);
    const state=await vaultState();
    if(state?.resetPending)throw coded('conflict','Finish the interrupted reset through OMF first.');
    let config=await metadata().catch(error=>{if(error.code==='legacy')throw coded('legacy','This directory holds logins from the previous setup. Use Enable protection for them, or start the downloader on a new private directory to connect.');throw error;});
    if(activated(state,config))throw coded('conflict','This PC is already connected. Use Connect / reconnect, or disconnect it in OMF first.');
    if(config.paused)throw coded('conflict','Resume the collector first');
    if(config.token||config.baseUrl){
      // A crash between the connection save and the journal update: the delivery is durable, so finish it.
      const previous=connectJournal;
      if(previous?.phase==='callback'&&previous.origin===config.baseUrl&&state?.installationId===previous.installationId&&state?.generation===previous.generation){
        await secrets.withLock(()=>saveJournal({...previous,phase:'delivered',code:undefined,verifier:undefined}));
        return finishConnect(pending);
      }
      // A terminal refusal can restart only its own never-activated enrollment. Preserve real/foreign logins;
      // archive its setup check and empty metadata before clearing the connection, under the same writer lease.
      const restarted=await secrets.withLock(async()=>{
        const current=await vaultState(),failed=await secrets.enrollmentJournal(),saved=await secrets.connection();
        if(current?.v===3&&current.phase==='enrolling'&&current.connect===true&&!current.resetPending
          &&failed?.phase==='failed'&&failed.id===connectJournal?.id&&failed.installationId===current.installationId
          &&failed.generation===current.generation&&failed.publicKey===current.publicKey&&failed.origin===saved?.baseUrl){
          const entries=await secrets.list();
          if(entries.some(id=>id!=='check'))return false;
          if(entries.length){
            const check=await secrets.read('check').catch(()=>null);
            if(!check||check.aad.generation!==current.generation
              ||JSON.stringify(entryBinding(check))!==JSON.stringify(aadFor(current.installationId,'check',null,saved)))return false;
          }
          const hasMetadata=await legacyBlobPresent();
          if(hasMetadata){
            await secrets.assertContained(path.basename(vault.file));
            const blob=await vault.read(),protection=blob.protection;
            if(protection?.installationId!==current.installationId||protection.generation!==current.generation
              ||protection.publicKey!==current.publicKey||blob.baseUrl!==saved.baseUrl||blob.token!==saved.token
              ||blob.mode!=='protected'||Object.keys(blob.accounts||{}).length||Object.keys(blob.services||{}).length||blob.gmail)return false;
          }
          assertAuthorization(pending);
          if(entries.length||hasMetadata||failed.recoveryArchive){
            const folder=failed.recoveryArchive||`unreadable-${Date.now()}-${randomBytes(8).toString('hex')}`;
            // Persist the archive name before the first move; a crash or Lock can resume the same archive.
            if(!failed.recoveryArchive)await saveJournal({...failed,recoveryArchive:folder});
            await secrets.moveAside(folder);
            if(hasMetadata){
              const archive=path.join(directory,folder);await mkdir(archive,{recursive:true});
              if((await readdir(archive)).includes(path.basename(vault.file)))throw coded('conflict','Setup recovery already has an archived metadata file; the current file was preserved.');
              await rename(vault.file,path.join(archive,path.basename(vault.file)));
            }
          }
          assertAuthorization(pending);
          // Keep the failed journal until its replacement is durable; a crash after this write can start over too.
          await secrets.connection(null);return true;
        }
        return false;
      });
      if(!restarted)throw coded('conflict','This PC already has a saved OMF connection. Use Enable protection for it, or start on a new private directory.');
      config={accounts:{}};
    }
    const origin=startup.packagedOrigin;
    if(!origin)throw coded('conflict','This downloader package has no OMF address. Install the package staged for your OMF site.');
    const previous=connectJournal;
    const usable=!!previous&&previous.origin===origin&&!ENDED.includes(previous.phase)&&Date.parse(previous.expiresAt)>Date.now();
    let journal,localKey;
    if(resume&&usable){
      journal=previous;
      localKey=await secrets.deviceKey(journal.generation);
      if(localKey.publicKey!==journal.publicKey){localKey.close();keyLost=true;throw coded('conflict','The local key does not match the pending connection. Reset protection to reconnect.');}
    } else {
      if(previous?.id&&!ENDED.includes(previous.phase))cancelConnectWithOmf({baseUrl:previous.origin},previous).catch(()=>{});
      journal=await secrets.withLock(async()=>{
        const installationId=randomBytes(16).toString('hex'),generation=randomBytes(32).toString('hex');
        localKey=await secrets.deviceKey(generation,{create:true});
        const trustToken=await secrets.trustCredential(generation,{create:true});
        const next={v:1,phase:'requested',origin,installationId,generation,publicKey:localKey.publicKey,trustHash:digest(trustToken),pcName:os.hostname(),state:randomBytes(32).toString('hex'),verifier:randomBytes(32).toString('base64url'),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+CONNECT_MS).toISOString()};
        await writeState({v:3,phase:'enrolling',installationId,generation,publicKey:localKey.publicKey,legacyId:state?.legacyId||'legacy-'+Date.now(),connect:true});
        await saveJournal(next);return next;
      });
    }
    try{
      const result=await connectWithOmf({baseUrl:origin},{installationId:journal.installationId,generation:journal.generation,publicKey:journal.publicKey,trustHash:journal.trustHash,pcName:journal.pcName},{
        signal:pending.abort.signal,onLink:link=>{approvalUrl=link;},
        resume:{id:journal.id,port:journal.port,code:journal.code,state:journal.state,verifier:journal.verifier},
        record:async(phase,data)=>{journal={...journal,...data,phase};await secrets.withLock(()=>saveJournal(journal));}
      });
      assertAuthorization(pending);
      const opened=openCapsule(localKey,result.capsule,connectAadFor(journal,result));
      if(!/^omfc_[a-f\d]{64}$/.test(opened.token)||!/^[a-f0-9]{64}$/.test(opened.grant))throw coded('conflict','OMF returned an invalid connection credential.');
      const connection={baseUrl:origin,token:opened.token,accountInfo:result.accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'})),accounts:{},mode:'protected'};
      aadFor(journal.installationId,'gmail',null,connection);
      const grant={grant:opened.grant,expiresAt:result.expiresAt,installationId:journal.installationId,generation:journal.generation};
      opened.token=null;opened.grant=null;
      // Durable save: the DPAPI connection first, then the journal phase; a crash between them resumes at the exchange.
      await secrets.withLock(async()=>{await secrets.connection(connection);journal={...journal,phase:'delivered',collectorId:result.collectorId,code:undefined,verifier:undefined};await saveJournal(journal);});
      return await finishConnect(pending,{localKey,grant});
    }catch(error){
      localKey.close();
      if(pending.cancelled&&journal&&!FINISHING.includes(journal.phase)){
        await secrets.withLock(()=>saveJournal({...journal,phase:'cancelled'})).catch(()=>{});
        if(journal.id)cancelConnectWithOmf({baseUrl:origin},journal).catch(()=>{});
      }
      throw error;
    }
  });
}
// Acknowledges a delivered connection and activates the empty protected store: owner broker, canary save/open,
// secret-free metadata, active state, journal removed. Non-interactive: a lost grant is renewed with the remembered-PC
// secret; it never opens an approval. Takes ownership of `localKey` on success.
async function finishConnect(pending,{localKey=null,grant=null}={}) {
  let journal=connectJournal;
  if(!journal||!FINISHING.includes(journal.phase))throw coded('conflict','No delivered connection to finish');
  const state=await vaultState(),config=await secrets.connection();
  if(!config?.token||config.baseUrl!==journal.origin||state?.installationId!==journal.installationId||state?.generation!==journal.generation)throw coded('conflict','The saved connection does not match the pending journal. Reset protection to reconnect.');
  if(!localKey){localKey=await secrets.deviceKey(journal.generation);if(localKey.publicKey!==journal.publicKey){localKey.close();keyLost=true;throw coded('conflict','The local key does not match this installation. Reset protection to reconnect.');}}
  let broker;
  try{
    if(journal.phase==='delivered'){
      const loadTrust=()=>secrets.trustCredential(journal.generation);
      const trustToken=secrets.lease?await loadTrust():await secrets.withLock(loadTrust);
      await acknowledgeWithOmf(config,{id:journal.id,installationId:journal.installationId,generation:journal.generation,trustToken},{signal:pending.abort.signal});
      assertAuthorization(pending);
      journal={...journal,phase:'acknowledged'};await secrets.withLock(()=>saveJournal(journal));
    }
    broker=await ownerBroker(pending,config,{installationId:journal.installationId,generation:journal.generation,publicKey:journal.publicKey},localKey,'batch',false,{approval:grant});
    assertAuthorization(pending);
    const canary=aadFor(journal.installationId,'check',null,config);
    await secrets.withLock(async()=>{
      if(!await secrets.has('check'))await secrets.save('check',canary,{canary:randomBytes(16).toString('hex')},broker);
      await secrets.open('check',canary,broker);
      assertAuthorization(pending);
      const protection={installationId:journal.installationId,generation:journal.generation,keyProvider:'CurrentUser DPAPI + OMF',publicKey:journal.publicKey,activatedAt:new Date().toISOString()};
      await vault.update(()=>withoutSecrets({...config,accounts:{},services:{},mode:'protected'},protection,config.accountInfo));
      await writeState({...state,phase:'active',activatedAt:protection.activatedAt});
      await saveJournal(null);
    });
    keyLost=false;
    session={id:randomBytes(8).toString('hex'),broker,mode:'protected',until:broker.remote.until,ran:false,browsers:new Set(),publicKey:journal.publicKey,installationId:journal.installationId,abort:pending.abort};
    reconnectNeeded=false;message='PC connected. Save your bank logins here; syncing resumes automatically.';
    return {connected:true,protected:true,unlocked:true};
  }catch(error){
    if(broker)await broker.end();else localKey.close();
    // OMF refused this delivered connection (revoked, account changed): nothing can finish it; Connect starts a new one.
    if([401,403].includes(error.status)||(journal.phase==='delivered'&&[404,409].includes(error.status))){await secrets.withLock(()=>saveJournal({...journal,phase:'failed'})).catch(()=>{});reconnectNeeded=true;}
    throw error;
  }
}

async function json(req) {let text='';for await(const data of req){text+=data;if(Buffer.byteLength(text)>20000)throw new Error('Request too large');}try{return JSON.parse(text);}catch{throw new Error('Invalid setup request');}}
const field=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max;
// `openSetup` is the explicit launch (run.mjs --open-setup): the setup page opens once, after readiness; when this
// directory's collector already listens, the running instance's link is opened instead and nothing else starts.
// Background starts never open a window. `open` is a constructor dependency for isolated tests.
export async function startCollector({openSetup=false,open=launch}={}) {
  stopped=false;
  await mkdir(directory,{recursive:true});
  // Establish private permissions before creating the bearer setup capability or accepting requests.
  startup.acl=await privateAcl().catch(error=>({protected:false,verified:false,elevated:null,error:error.message}));
  startup.elevated=startup.acl.elevated ?? null;
  if(!startup.acl.verified)throw new Error('Private collector permissions could not be established; no setup capability was created');
  keyLost=!!(await vaultState())?.resetPending || ((await vaultState())?.v===2 && !!(await vaultState())?.installationId);
  startup.packagedOrigin=await packagedOrigin().catch(()=>null);
  connectJournal=await secrets.enrollmentJournal().catch(()=>null);
  const port=Number(process.env.OMF_COLLECTOR_PORT || 47831);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid setup port');
  const origin=`http://127.0.0.1:${port}`,linkFile=path.join(directory,'setup-link.txt');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin))return reply(403,{error:'Local setup access required'});
      if(req.method==='GET' && ['/','/setup.js'].includes(req.url)) {res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(fileURLToPath(new URL(req.url==='/'?'./setup.html':'./setup.js',import.meta.url))));return;}
      if(req.headers['x-setup-key']!==setupKey)return reply(403,{error:'Reopen the setup screen from the collector launch link'});
      if(req.method==='GET' && req.url==='/status') {
        // No secret is read here: entry presence comes from file names, metadata from the secret-free blob.
        const state=await vaultState();let config,legacy=false;
        try{config=await metadata();}catch(error){if(error.code!=='legacy')throw error;legacy=true;config={accounts:{}};}
        let info=config.accountInfo || [],due=false;if(config.token)try{info=(await api(config,'accounts')).accounts;due=info.some(a=>a.jobState==='queued');}catch{}
        const [aplus,yayoi,gmail]=await Promise.all(['aplus','yayoi','gmail'].map(id=>boundSecret(id,state?.installationId,id,null,config)));
        const accounts=await Promise.all(info.map(async a=>{const provider=a.provider||'amex';return {id:a.primaryCard,accountId:String(a._id||''),name:a.name,provider,hasCredentials:await boundSecret(provider+'-'+String(a._id),state?.installationId,provider,a,config)};}));
        return reply(200,{message,approvalUrl,reconnectNeeded,baseUrl:config.baseUrl||startup.packagedOrigin||null,pcName:os.hostname(),connect:connectStatus(),busy:running,authorizing:!!authorization,locking:!!closing,legacy,protected:activated(state,config),mode:config.mode || (activated(state,config)?'protected':null),capability:capabilityOf(config,state),unlocked:!!session,unlockUntil:session?new Date(session.until).toISOString():null,due,paused:!!config.paused,keyLost,aclProtected:startup.acl?!!startup.acl.verified:null,elevated:startup.elevated,chromeFound:startup.chromeFound,testBroker:testBrokerEnabled(),startupDone:startup.done,aplus:{hasCredentials:aplus},yayoi:{...yayoiState,hasCredentials:yayoi},mailbox:{hasCredentials:gmail},smsSource:{serial:config.smsSource?.serial??null,adbFound:!!findAdb()},accounts});
      }
      if(req.method==='POST' && ['/connect','/connect/resume'].includes(req.url)) { await json(req).catch(()=>({})); try { return reply(200,await connect({resume:req.url==='/connect/resume'})); } catch(error) { return reply(codeOf(error),{error:error.message,keyLost}); } }
      if(req.method==='POST' && req.url==='/pair') {
        const body=await json(req);if(!/^omfc_[a-f\d]{64}$/.test(body.token))throw new Error('Invalid collector token');
        if(session)throw coded('conflict','Lock the current batch before changing the connection.');
        const config={baseUrl:secureOrigin(body.baseUrl),token:body.token,accountInfo:[]};const {accounts}=await api(config,'accounts');
        config.accountInfo=accounts.map(a=>({_id:String(a._id),primaryCard:a.primaryCard,name:a.name,ownerId:String(a.ownerId),provider:a.provider||'amex'}));
        aadFor(null,'gmail',null,config);
        await authorize(async pending=>secrets.withLock(async()=>{
          const state=await vaultState();const current=await metadata().catch(error=>{if(error.code==='legacy')return null;throw error;});
          if(state?.v===3&&state.installationId){
            if(state.resetPending)throw coded('conflict','Finish the interrupted reset before changing the connection.');
            if(current?.baseUrl!==config.baseUrl||String(current?.accountInfo?.[0]?.ownerId)!==String(config.accountInfo?.[0]?.ownerId))throw coded('conflict','Saved logins cannot move to another OMF owner or address. Use a separate collector setup and reconnect those logins.');
            const remote=await securityCall(config,'installations/'+state.installationId,{signal:pending.abort.signal});
            if(remote.installation){const broker=await ownerBroker(pending,config,state,null,'pair');await broker.end();assertAuthorization(pending);}
            if(state.phase==='active')await vault.update(old=>({...old,...config}));
          }
          await secrets.connection(config);
          if(!state)await writeState({v:3,phase:'pending'});
        }));

        return reply(200,{saved:true});
      }
      if(req.method==='POST' && req.url==='/credentials') {
        const body=await json(req);if(!/^[a-f\d]{24}$/.test(String(body.accountId))||![body.username,body.password].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw new Error('Enter both the card login ID and password');
        const live=requireProtectedSession();const config=await metadata();const info=(config.accountInfo||[]).find(a=>a._id===body.accountId);if(!info)throw new Error('Unknown account');
        const provider=info.provider||'amex';
        await writeSecret(live,provider+'-'+info._id,aadOf({installationId:live.installationId,origin:config.baseUrl,ownerId:info.ownerId,provider,accountId:info._id}),{username:body.username,password:body.password});
        return reply(200,{saved:true});
      }
      if(req.method==='GET' && req.url==='/aplus/status') {const state=await vaultState();let config;try{config=await metadata();}catch(error){if(error.code!=='legacy')throw error;config={};}return reply(200,{busy:running,unlocked:!!session,aplus:{hasCredentials:await boundSecret('aplus',state?.installationId,'aplus',null,config)}});}
      if(req.method==='POST' && req.url==='/aplus/credentials') {
        const body=await json(req);
        if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['username','password'].includes(k)) || ![body.username,body.password].every(v=>typeof v==='string'&&v.length>0&&v.length<=256) || !body.username.trim())throw new Error('Enter both Aplus ID and password');
        const live=requireProtectedSession();
        if(activeAction)return reply(409,{error:'Wait for the current collector action to finish'});
        await writeSecret(live,'aplus',aadFor(live.installationId,'aplus',null,await metadata()),{username:body.username.trim(),password:body.password});
        return reply(200,{saved:true});
      }
      if(req.method==='POST' && req.url==='/sms-source') {
        // The statement-code source (plan omf-auto-sync-build-20261014 §2 A9): a tablet serial is not a secret; it lives in
        // the secret-free metadata and is read only inside a claimed Aplus job. Shape (400), then the protected session
        // (403), then no collector action in flight (409).
        const {serial}=smsSourceInput(await json(req));
        requireProtectedSession();
        if(activeAction)return reply(409,{error:'Wait for the current collector action to finish'});
        await updateMetadata(old=>({...old,smsSource:serial?{kind:'adb',serial}:undefined}));
        return reply(200,{saved:!!serial,smsSource:serial?{kind:'adb',serial}:null});
      }
      if(req.method==='GET' && req.url==='/yayoi/status') {const state=await vaultState();let config;try{config=await metadata();}catch(error){if(error.code!=='legacy')throw error;config={};}return reply(200,{busy:running,unlocked:!!session,yayoi:{...yayoiState,hasCredentials:await boundSecret('yayoi',state?.installationId,'yayoi',null,config)}});}
      if(req.method==='POST' && req.url==='/yayoi/credentials') {
        const credentials=yayoiCredentials(await json(req));
        const live=requireProtectedSession();
        if(activeAction)return reply(409,{error:'Wait for the current collector action to finish'});
        await writeSecret(live,'yayoi',aadFor(live.installationId,'yayoi',null,await metadata()),credentials);
        yayoiState={state:'idle',message:'Yayoi login sealed. Open Yayoi when ready.'};
        return reply(200,{saved:true});
      }
      if(req.method==='POST' && req.url==='/mailbox') {
        const body=await json(req);
        if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['clientId','clientSecret','refreshToken','mailbox'].includes(k)) || !['clientId','clientSecret','refreshToken','mailbox'].every(k=>field(body[k])) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.mailbox))throw new Error('Enter the Gmail client ID, client secret, refresh token and mailbox address');
        const live=requireProtectedSession();
        await writeSecret(live,'gmail',aadFor(live.installationId,'gmail',null,await metadata()),{clientId:body.clientId,clientSecret:body.clientSecret,refreshToken:body.refreshToken,mailbox:body.mailbox.trim().toLowerCase()});
        return reply(200,{saved:true});
      }
      if(req.method==='POST' && req.url==='/yayoi/open') {
        const live=liveSession();if(!live)return reply(409,{error:'Unlock one batch first'});
        if(live.mode!=='protected')return reply(400,{error:'Yayoi needs a sealed login; manual mode has none'});
        if(!(await secrets.has('yayoi')))return reply(400,{error:'Save your Yayoi login first'});
        let credentials;
        try { credentials=await secrets.open('yayoi',aadFor(live.installationId,'yayoi',null,await metadata()),live.broker);assertSession(live); }
        catch { return reply(400,{error:'The saved Yayoi login cannot be opened for this OMF connection. Save it again after unlocking.'}); }
        if(running)return reply(409,{error:'Wait for the current collector action to finish'});
        // No credentials or arbitrary target URL can be supplied to the browser action.
        void runYayoi(credentials,live);
        return reply(202,{started:true});
      }
      if(req.method==='POST' && req.url==='/protect') { try { return reply(200,await protect()); } catch(error) { return reply(codeOf(error),{error:error.message,...(error.capability===false?{capability:false}:{}),aclProtected:startup.acl?!!startup.acl.verified:null}); } }
      if(req.method==='POST' && req.url==='/unlock') { await json(req).catch(()=>({})); try { const live=await startSession('protected'); return reply(200,{unlocked:true,unlockUntil:new Date(live.until).toISOString()}); } catch(error) { return reply(codeOf(error),{error:error.message,keyLost}); } }
      if(req.method==='POST' && req.url==='/batch/start') { await json(req).catch(()=>({})); try { const live=await startSession('manual'); return reply(200,{unlocked:true,mode:'manual',unlockUntil:new Date(live.until).toISOString()}); } catch(error) { return reply(codeOf(error),{error:error.message}); } }
      if(req.method==='POST' && req.url==='/lock') { await json(req).catch(()=>({}));nextAutoAttempt=Infinity;await endSession('paused by you');await updateMetadata(old=>({...old,paused:true}));return reply(200,{unlocked:false,paused:true}); }
      if(req.method==='POST' && req.url==='/pause') { await json(req).catch(()=>({}));nextAutoAttempt=Infinity;await endSession('paused');await updateMetadata(old=>({...old,paused:true}));return reply(200,{paused:true}); }
      if(req.method==='POST' && req.url==='/resume') { await json(req).catch(()=>({})); await updateMetadata(old=>({...old,paused:false}));nextAutoAttempt=0;return reply(200,{paused:false}); }
      if(req.method==='POST' && req.url==='/mode') {
        const body=await json(req);return reply(200,await authorize(async()=>{
        const state=await vaultState(),config=await metadata();
        if(session)throw coded('conflict','Lock the current batch first');
        if(body.mode==='manual') {
          if((await secrets.list()).some(id=>id.startsWith('amex-')||id.startsWith('aplus-')||['aplus','yayoi','gmail'].includes(id)))throw coded('conflict','Sealed logins exist; manual mode needs an empty vault');
          await updateMetadata(old=>({...old,mode:'manual'}));return {mode:'manual'};
        }
        if(body.mode==='protected') { if(!activated(state,config))throw coded('conflict','Enable protection first'); await updateMetadata(old=>({...old,mode:'protected'}));return {mode:'protected'}; }
        throw new Error('Unknown mode');
        }));
      }
      if(req.method==='POST' && req.url==='/protect/reset') {
        const body=await json(req);return reply(200,await authorize(async pending=>secrets.withLock(async()=>{
        if(running)throw coded('conflict','Wait for the current collector action to finish');
        if(!keyLost)throw coded('conflict','The protection key is not lost; nothing to reset');
        if(session)throw coded('conflict','Lock the current batch first');
        if(body.confirm!=='RESET')throw new Error('Type RESET to confirm; the sealed entries are moved aside, never deleted');
        const state=await vaultState(),config=await metadata();
        const resetPending=state?.resetPending || {folder:'unreadable-'+Date.now()+'-'+randomBytes(8).toString('hex'),previousInstallationId:state?.installationId||null,generation:randomBytes(32).toString('hex')};
        const localKey=await secrets.deviceKey(resetPending.generation,{create:true});
        const installationId=state?.v===3&&state.installationId?state.installationId:randomBytes(16).toString('hex');
        await writeState({...state,resetPending});
        let broker;
        try{
          const lookup=await securityCall(config,'installations/'+installationId,{signal:pending.abort.signal});
          const action=lookup.installation?'reset':'enroll';
          const candidate={installationId,generation:resetPending.generation,publicKey:localKey.publicKey,previousGeneration:lookup.installation?.generation};
          broker=await ownerBroker(pending,config,candidate,localKey,action);
          assertAuthorization(pending);
          const moved=await secrets.moveAside(resetPending.folder);
          // Leave the old metadata/blob untouched until the next explicitly authorized
          // protection pass verifies its archive. Reset itself never decrypts it.
          await secrets.connection({...config,recoveryArchive:resetPending.folder});
          await writeState({v:3,phase:'enrolling',...candidate,legacyId:state?.legacyId||'legacy-'+Date.now(),reconnect:true,recoveryArchive:resetPending.folder});
          keyLost=false;message='Protection reset. Enable protection and reconnect the bank logins.';
          return {reset:true,moved:moved.moved.length,into:moved.folder?path.basename(moved.folder):null};
        }finally{if(broker)await broker.end();else localKey.close();}

        })));
      }
      reply(404,{error:'Unknown setup endpoint'});
    }catch(error){reply(codeOf(error),{error:error.message});}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(undefined));});}
  catch(error){
    if(error.code!=='EADDRINUSE'||!openSetup)throw error;
    const link=(await readFile(linkFile,'utf8')).trim();
    if(!link.startsWith(`${origin}/#`))throw new Error('Another collector holds the setup port but left no setup link');
    await open(link);
    return {reused:true,close:async()=>{}};
  }
  const link=`${origin}/#${setupKey}`;
  await writeFile(linkFile,link,{mode:0o600});
  console.log(`OMF collector listening on 127.0.0.1:${port}; setup link saved in the private collector directory`);
  // Startup checks (site 4 :72): protected DACL with verification, elevation, Chrome, crash recovery of ephemeral
  // profiles, provider capability. Sessions refuse until they are done; secrets are never involved.
  startup.chromeFound=!!findChrome();
  startup.recovered=await recoverEphemeral(directory).catch(error=>({error:error.message}));
  startup.capability=await probeCapability().then(result=>result.ok,()=>null);
  startup.done=true;
  const interval=setInterval(tick,TICK_MS);tick();
  if(openSetup)await open(link).catch(()=>{console.error('Open the setup link saved in the private collector directory.');});
  return {close:async()=>{stopped=true;clearInterval(interval);await endSession('stopped');await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startCollector().catch(()=>{console.error('OMF collector could not start. Check the setup port and Windows credential vault.');process.exitCode=1;});

import path from 'node:path';
import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Vault} from './vault.mjs';
import {withBankBrowser} from './bank.mjs';
import {projectEvidence,recordBankLearning} from './bank-learning-recorder.mjs';
import {learningDownload,inspectLearningStatement,replayBankLearning} from './bank-learning-runner.mjs';
import {stable,learningId,learningAssert,LEARNING_RUNTIME} from '../shared/finance-bank-learning.mjs';
const sha=value=>createHash('sha256').update(stable(value)).digest('hex');

export async function awaitLearningLogin(page,{signal,timeout=15*60000}={}){
  const binding='__omfLogin'+randomUUID().replaceAll('-','');let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  await page.exposeFunction(binding,()=>finish());
  const install=async frame=>{
    if(frame!==page.mainFrame())return;
    await frame.evaluate(name=>{
      if(document.getElementById('omf-learning-ready'))return;
      const button=document.createElement('button');button.id='omf-learning-ready';button.textContent='OMF · ログイン済みです。照会手順を開始';
      button.style.cssText='position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#111827;color:white;padding:16px;border:2px solid #a78bfa;border-radius:12px';
      button.onclick=()=>{window[name]();button.remove();};document.documentElement.append(button);
    },binding).catch(()=>{});
  };
  page.on('framenavigated',install);await install(page.mainFrame());
  let timer;const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('attended-login-timeout')),timeout);});
  let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(new Error('attended-login-cancelled'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  try{await Promise.race([done,expired,stopped]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);page.off('framenavigated',install);await page.removeExposedFunction(binding).catch(()=>{});}
}
/** Native statement job, using the exact selected version. Only an explicit attended request can reach this collector path. */
export async function collectLearnedStatement(bound,job,root,status,{live,batch='batch',onLaunch,signal,login=awaitLearningLogin,browser=withBankBrowser,test=false}={}){
  const frozen=job?.snapshot?.learned,identity=live?.mode==='protected'?live.broker?.remote?.learningIdentity:null;
  learningAssert(frozen?.runtime===LEARNING_RUNTIME&&frozen.mode==='attended-statement'&&learningId(frozen.sessionId),'learned-version-unavailable');
  learningAssert(identity&&identity.installationId===frozen.installationId&&identity.generation===frozen.generation,'learned-pc-binding-changed');
  learningAssert(learningId(bound.ownerId)&&learningId(bound.bankAccountId)&&/^[a-f0-9-]{36}$/.test(job.jobId),'invalid-learned-job');
  const {selectionHash,candidate,entryOrigin,...selection}=frozen;
  learningAssert(sha(selection)===selectionHash&&sha(candidate)===frozen.candidateHash,'learned-selection-changed');
  const local=await learningStore(root,frozen.sessionId).read();
  const expected={sessionId:frozen.sessionId,origin:bound.origin,installationId:frozen.installationId,generation:frozen.generation,bankAccountId:bound.bankAccountId};
  learningAssert(stable(local.binding)===stable(expected)&&local.evidenceHash===frozen.evidenceHash&&local.record,'local-recording-binding-changed');
  const directory=path.join(root,'outbox','bank',bound.bankAccountId,job.jobId+'-learned'),journal=new Vault(path.join(root,'bank-learning','jobs',job.jobId));
  const binding={...expected,ownerId:bound.ownerId,jobId:job.jobId,snapshotHash:job.snapshotHash,selectionHash},previous=await journal.read();
  if(previous.binding)learningAssert(stable(previous.binding)===stable(binding),'learned-job-binding-changed');
  async function retained(){
    let manifest;try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    learningAssert(manifest.jobId===job.jobId&&manifest.snapshotHash===job.snapshotHash&&manifest.ownerId===bound.ownerId&&manifest.bankAccountId===bound.bankAccountId&&manifest.origin===bound.origin&&manifest.filename==='statement.csv','learned-artifact-binding-changed');
    const bytes=await readFile(path.join(directory,manifest.filename));learningAssert(createHash('sha256').update(bytes).digest('hex')===manifest.sha256,'learned-artifact-changed');
    return {directory,manifest};
  }
  // A completed manifest is authoritative after a crash between its publication and the journal update. No bank login is repeated.
  const old=await retained();if(old)return {items:[old],notice:'この取得で保存済みの明細を送信しました。銀行への再ログインは行っていません。'};
  learningAssert(!previous.phase,'learned-previous-attempt-unknown');
  await journal.update(()=>({binding,phase:'started'}));
  let item;
  try{
    await status('verification_required','記録した手順で取得します。接続したPCのChromeで本人がサインインしてください。');
    await browser(bound,root,batch,onLaunch,async(page,browser)=>{
      await page.goto(entryOrigin,{waitUntil:'domcontentloaded',timeout:60000});
      await replayBankLearning(browser,page,{record:local.record,evidence:projectEvidence(local.record,{test}),candidate,evidenceHash:frozen.evidenceHash,candidateHash:frozen.candidateHash,period:job.snapshot.coverage,template:job.snapshot,directory:path.join(root,'bank-learning','jobs',job.jobId,'download'),signal,awaitLogin:async page=>{await login(page,{signal});await status('running','記録した口座・期間を確認して明細を出力中');},test,onStatement:async({file,sourceOrigin,receipt})=>{
        const bytes=await readFile(file);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'statement.csv'),bytes,{flag:'wx',mode:0o600});
        const manifest={...bound,kind:'statement',sourceFormat:'csv',filename:'statement.csv',sha256:receipt.statementHash,bytes:bytes.length,channel:'collector',sourceHost:new URL(sourceOrigin).hostname,downloadedAt:receipt.finishedAt,suggestedFilename:'bank-'+job.jobId.slice(0,8)+'.csv',labelChecked:false,learnedSelectionHash:selectionHash};
        const temporary=path.join(directory,'manifest.'+randomUUID()+'.tmp');
        try{await writeFile(temporary,JSON.stringify(manifest),{flag:'wx',mode:0o600});await link(temporary,path.join(directory,'manifest.json'));}finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
        item={directory,manifest};await journal.update(()=>({binding,phase:'file-ready'}));
      }});
    });
    learningAssert(item,'learned-statement-missing');return {items:[item]};
  }catch(error){await journal.update(value=>({...value,phase:value.phase==='file-ready'?'file-ready':'interrupted'}));throw error;}
}
const stores=new Map();
export function learningStore(root,id){learningAssert(learningId(id));const directory=path.resolve(root,'bank-learning',id);if(!stores.has(directory))stores.set(directory,new Vault(directory));return stores.get(directory);}
function samePc(binding,context){return binding&&binding.origin===context.origin&&binding.installationId===context.installationId&&binding.generation===context.generation;}
export async function flushLearningOutbox(root,remote,context){
  let entries=[];try{entries=await readdir(path.join(root,'bank-learning'),{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const entry of entries.filter(v=>v.isDirectory()&&learningId(v.name))){
    const vault=learningStore(root,entry.name),local=await vault.read();
    if(!local.pending)continue;
    const pending=local.pending;
    if(!samePc(local.binding,context)){await vault.update(v=>stable(v.pending)===stable(pending)?{...v,pending:null,undelivered:{...pending,reason:'pc_binding_changed'}}:v);continue;}
    try{
      const result=await remote.learning(entry.name+'/'+pending.action,pending.body);
      if(result.accepted)await vault.update(v=>stable(v.pending)===stable(pending)?{...v,pending:null}:v);
    }catch(error){
      if(![400,404,409].includes(error.status))throw error;
      await vault.update(v=>stable(v.pending)===stable(pending)?{...v,pending:null,undelivered:{...pending,reason:'delivery_rejected'}}:v);
    }
  }
}
/** Explicit local setup action. It holds the PC slot only for recording/replay, never for the queued model task. */
export async function runBankLearning({id,action,remote,root,live,origin,onLaunch,status=()=>{},entryUrl,test=false,login=awaitLearningLogin,browser=withBankBrowser}){
  learningAssert(learningId(id)&&['start','replay'].includes(action),'invalid-learning-action');
  const vault=learningStore(root,id),previous=await vault.read();
  if(previous.pending){learningAssert(samePc(previous.binding,{origin,...remote.learningIdentity}),'local-recording-binding-changed');await remote.learning(id+'/'+previous.pending.action,previous.pending.body);await vault.update(v=>({...v,pending:null}));return;}
  const claim=await remote.learning(id+'/'+action,{}),session=claim.session;
  const binding={sessionId:id,origin,installationId:session.installationId,generation:session.generation,bankAccountId:session.bankAccountId};
  const signal=live.abort.signal,abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]);let heartbeatFailure;
  const timer=setInterval(()=>remote.learning(id+'/heartbeat',{claim:claim.claim}).catch(error=>{heartbeatFailure=error;abort.abort();}),45000);
  const save=patch=>vault.update(v=>({...v,...patch}));
  const send=async(action,body)=>{await save({pending:{action,body}});const result=await remote.learning(id+'/'+action,body);if(result.accepted)await save({pending:null});return result;};
  try{
    if(action==='replay')learningAssert(stable(previous.binding)===stable(binding)&&previous.evidenceHash===session.evidenceHash&&previous.record,'local-recording-unavailable');
    const url=new URL(entryUrl||session.entryOrigin);learningAssert(url.origin===session.entryOrigin&&!url.username&&!url.password,'entry-origin-mismatch');
    await save({binding,activeAction:action,claim:claim.claim});
    const bound={ownerId:id,bankAccountId:session.bankAccountId};
    await browser(bound,root,'learn-'+id,onLaunch,async(page,browser)=>{
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
      if(action==='start'){
        await login(page,{signal:combined});
        const origins=[session.entryOrigin],directory=path.join(root,'bank-learning',id,'demonstration-'+randomUUID()),download=await learningDownload(browser,directory,{origins,signal:combined});
        let record;
        try{
          status('銀行で照会・期間指定・CSV出力・残高・ログアウトを実演してください');
          record=await recordBankLearning(browser,page,{signal:combined,entryOrigin:session.entryOrigin,origins,test,store:record=>save({record})});
          await inspectLearningStatement(await readFile(await download.file()),session.template,session.demonstrationPeriod);
        }finally{await download.close();}
        const evidence=projectEvidence(record,{test});await save({record,evidenceHash:sha(evidence)});
        await send('evidence',{claim:claim.claim,evidence});status('記録を送信しました。開発はPCを占有せずに進みます');
      }else{
        const receipt=await replayBankLearning(browser,page,{record:previous.record,evidence:projectEvidence(previous.record,{test}),candidate:session.candidate,evidenceHash:session.evidenceHash,candidateHash:session.candidateHash,period:session.replayPeriod,template:session.template,directory:path.join(root,'bank-learning',id,'replay-'+randomUUID()),signal:combined,awaitLogin:p=>login(p,{signal:combined}),test});
        await send('receipt',{claim:claim.claim,nonce:claim.nonce,receipt});status('別の期間での取得を確認しました');
      }
    });
    if(heartbeatFailure)throw heartbeatFailure;
  }catch(error){
    const local=await vault.read();
    // An upload with an unknown acknowledgement is retained, not replaced by a failure or another bank attempt.
    if(!local.pending){
      const codes=['recorded-control-unavailable','recorded-control-changed','account-mismatch','date-input-mismatch','statement-period-mismatch','statement-header-changed','balance-unavailable','logout-unconfirmed','unsupported-date-control'];
      const code=codes.includes(error.code)?error.code:codes.includes(error.message)?error.message:null;
      await remote.learning(id+'/failed',{claim:claim.claim,...(code?{code}:{}),...(['inquiry','account','from','to','export','balance','logout'].includes(error.learningRole)?{role:error.learningRole}:{})}).catch(()=>{});
    }
    throw error;
  }finally{clearInterval(timer);await remote.learning(id+'/finish',{claim:claim.claim}).catch(()=>{});await save({activeAction:null});}
}

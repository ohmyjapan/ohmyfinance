import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {LEARNING_RUNTIME,LEARNING_DATE_PARTS,LEARNING_LOGIN_ROLES,stable,validateRecipe,learningPeriod,learningAssert} from '../shared/finance-bank-learning.mjs';
import {replayLearningLogin,loginControl,manualControlState,compactManualState} from './bank-learning-login.mjs';
import {normalizeBankRow,money} from '../shared/finance-payment-match.mjs';
import {inspectDateControl,submittedPeriod,sameSubmission} from './bank-learning-dates.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// A read of an existing owned page, shared by replay's initial readiness and
// private post-state checks. It creates no target/session and performs no action.
export async function inspectManualBinding(owner,event,{origins,post=false}={}){
  try{
    if(!owner||owner.isClosed())return {kind:'unknown'};
    const root=owner.mainFrame(),client=root.client;
    const find=(tree,id)=>{const pending=[tree];while(pending.length){const node=pending.pop();if(node.frame.id===id)return node;pending.push(...node.childFrames||[]);}return null;};
    const approved=(frame,node)=>origins.includes(new URL(frame.url()).origin)&&new URL(frame.url()).origin===new URL(node.frame.url).origin;
    const {frameTree}=await client.send('Page.getFrameTree');let frame=root,node=find(frameTree,root._id);
    if(!node)return {kind:'unknown'};
    for(const at of event.private.framePath){
      if(!approved(frame,node))return {kind:'unknown'};
      const child=frame.childFrames()[at];
      if(!child)return (node.childFrames||[]).length<=at?{kind:'frame-absent',ready:false}:{kind:'unknown'};
      frame=child;node=find(frameTree,frame._id);if(!node)return {kind:'unknown'};
    }
    const currentOrigin=new URL(frame.url()).origin;
    if(!approved(frame,node))return {kind:'unknown'};
    const loader=node.frame.loaderId;if(!loader)return {kind:'unknown'};
    if(!post&&currentOrigin!==event.origin){
      if(!origins.includes(event.origin))return {kind:'unknown'};const id=frame._id;
      const current=find((await client.send('Page.getFrameTree')).frameTree,id);
      let selected=owner.mainFrame();for(const at of event.private.framePath)selected=selected?.childFrames()[at];
      if(owner.isClosed()||owner.mainFrame()!==root||root.client!==client||selected!==frame||frame._id!==id||!current||current.frame.loaderId!==loader||!approved(frame,current)||new URL(frame.url()).origin!==currentOrigin)return {kind:'unknown'};
      return {kind:'not-ready',ready:false};
    }
    const matches=await frame.$$(event.private.selector);let state;
    try{
      if(!matches.length)state={kind:'missing',ready:false};
      else if(matches.length!==1)state={kind:'unknown'};
      else{
        state=compactManualState(await matches[0].evaluate(manualControlState));
        state.ready=await matches[0].evaluate(loginControl,{role:event.role,tag:event.tag,type:event.private.type,origins});
      }
    }finally{for(const element of matches)await element.dispose().catch(()=>{});}
    const current=find((await client.send('Page.getFrameTree')).frameTree,frame._id);
    return current?.frame.loaderId===loader?state:{kind:'unknown'};
  }catch{return {kind:'unknown'};}
}

// Ephemeral INITIAL-only observation; existing pages/listener remain the sole owners.
export function createInitialManualReadiness(browser,root,pages,{signal}={}){
  const unknown=()=>({kind:'unknown'}),notReady=()=>({kind:'not-ready',ready:false});
  let connection,manager,context,rootTarget,rootPair,startupAvailable=false;
  let pending=0,epoch=0,unresolved=false;const startup=new Map(),knownOwned=new Map();
  const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const meta=info=>{
    if(!info||typeof info.targetId!=='string'||!info.targetId||!['page','tab'].includes(info.type))throw Error('inventory-unavailable');
    const contextPresent=has(info,'browserContextId'),subtypePresent=has(info,'subtype');
    if(contextPresent&&(typeof info.browserContextId!=='string'||!info.browserContextId))throw Error('inventory-unavailable');
    if(info.subtype!==undefined&&typeof info.subtype!=='string')throw Error('inventory-unavailable');
    return{id:info.targetId,type:info.type,contextPresent,context:info.browserContextId,subtypePresent,subtype:info.subtype};
  };
  const sameMeta=(a,b)=>!!a&&!!b&&['id','type','contextPresent','context','subtypePresent','subtype'].every(key=>a[key]===b[key]);
  const sameContext=(a,b)=>a.contextPresent===b.contextPresent&&a.context===b.context;
  const success=target=>target._initializedDeferred.resolved()&&target._initializedDeferred.value()==='success'&&!target._isClosedDeferred.finished();
  const pair=(target,available)=>{
    const pageMeta=meta(target._getTargetInfo()),pageSession=target._session(),tabSession=pageSession?.parentSession(),tabTarget=tabSession?._target(),tabMeta=meta(tabTarget?._getTargetInfo());
    if(pageMeta.type!=='page'||tabMeta.type!=='tab'||target.type()!=='page'||tabTarget.type()!=='tab'||pageMeta.subtype!==undefined||tabMeta.subtype!==undefined||target._targetId!==pageMeta.id||tabTarget._targetId!==tabMeta.id||available.get(pageMeta.id)!==target||available.get(tabMeta.id)!==tabTarget||!success(target)||!success(tabTarget)||!pageSession||!tabSession||pageSession===tabSession||pageSession._target()!==target||tabSession._target()!==tabTarget||tabTarget._session()!==tabSession||pageSession.connection()!==connection||tabSession.connection()!==connection||target.browser()!==browser||tabTarget.browser()!==browser||target.browserContext()!==context||tabTarget.browserContext()!==context||!manager.getChildTargets(tabTarget).has(target))throw Error('inventory-unavailable');
    return{pageTarget:target,tabTarget,pageSession,tabSession,context,pageMeta,tabMeta};
  };
  const samePair=(a,b)=>!!a&&!!b&&['pageTarget','tabTarget','pageSession','tabSession','context'].every(key=>a[key]===b[key])&&sameMeta(a.pageMeta,b.pageMeta)&&sameMeta(a.tabMeta,b.tabMeta);
  // Only positively observed live ownership may later explain a retired slot.
  const freezeOwned=value=>({...value,pageClosed:value.pageTarget._isClosedDeferred,tabClosed:value.tabTarget._isClosedDeferred});
  const rememberOwned=owner=>{
    try{
      if(!owner||owner.isClosed()||owner.browser()!==browser||owner.browserContext()!==context)return;
      const available=new Map(manager.getAvailableTargets());knownOwned.set(owner,freezeOwned(pair(owner.target(),available)));
    }catch{/* A transient provenance read miss does not reject an ordinary owner. */}
  };
  const retiredOwned=(owner,value,available)=>{
    if(!value||!owner.isClosed()||owner.target()!==value.pageTarget||owner.browser()!==browser||owner.browserContext()!==context||value.context!==context)return false;
    if(value.pageClosed!==value.pageTarget._isClosedDeferred||value.tabClosed!==value.tabTarget._isClosedDeferred||!value.pageClosed.finished()||!value.tabClosed.finished())return false;
    if(value.pageTarget.browser()!==browser||value.tabTarget.browser()!==browser||value.pageTarget.browserContext()!==context||value.tabTarget.browserContext()!==context)return false;
    if(!sameMeta(meta(value.pageTarget._getTargetInfo()),value.pageMeta)||!sameMeta(meta(value.tabTarget._getTargetInfo()),value.tabMeta))return false;
    return !available.has(value.pageMeta.id)&&!available.has(value.tabMeta.id);
  };
  // Optional, ephemeral explanation for an SDK tab omitted by native-UI enumeration.
  // Failure is local to this capability; ordinary accounted rows retain their old path.
  const nativeUi= (target,available)=>{
    try{
      const tabMeta=meta(target._getTargetInfo()),tabSession=target._session(),registry=connection._sessions,children=manager.getChildTargets(target),tabInitialized=target._initializedDeferred,tabClosed=target._isClosedDeferred;
      if(tabMeta.type!=='tab'||tabMeta.subtype!==undefined||target.type()!=='tab'||target._targetId!==tabMeta.id||available.get(tabMeta.id)!==target||!success(target)||target.browser()!==browser||target.browserContext()!==context||!sameContext(tabMeta,rootPair.pageMeta)||!tabSession||tabSession.connection()!==connection||tabSession._target()!==target||registry.get(tabSession.id())!==tabSession||!children||children.size===0)throw Error('native-ui-unavailable');
      const proof={target,meta:tabMeta,context,session:tabSession,sessionKey:tabSession.id(),initialized:tabInitialized,closed:tabClosed,childrenRef:children,children:new Map()};
      for(const child of children){
        const info=child._getTargetInfo(),contextPresent=has(info,'browserContextId'),subtypePresent=has(info,'subtype');
        if(typeof info.targetId!=='string'||!info.targetId||info.type!=='browser_ui'||contextPresent&&(typeof info.browserContextId!=='string'||!info.browserContextId)||info.subtype!==undefined||typeof info.url!=='string')throw Error('native-ui-unavailable');
        const childMeta={id:info.targetId,type:info.type,contextPresent,context:info.browserContextId,subtypePresent,subtype:info.subtype},url=new URL(info.url);
        if(url.protocol!=='chrome:'||!url.hostname||url.username||url.password||url.port||child._targetId!==childMeta.id||available.get(childMeta.id)!==child||!success(child)||child.browser()!==browser||child.browserContext()!==context||!sameContext(childMeta,tabMeta))throw Error('native-ui-unavailable');
        const bindings=new Map(),matches=[];
        for(const[key,session]of registry){
          if(session._target()!==child)continue;
          const parent=session.parentSession(),parentTarget=parent?._target(),connected=session.connection()===connection,parentConnected=!!parent&&parent.connection()===connection,parentKey=parent?.id(),parentRegistered=!!parent&&registry.get(parentKey)===parent;
          if(typeof key!=='string'||!key||session.id()!==key||registry.get(key)!==session)throw Error('native-ui-unavailable');
          const binding={session,parent,parentTarget,connected,parentConnected,parentKey,parentRegistered};bindings.set(key,binding);
          if(connected&&parent===tabSession&&parentTarget===target&&parentConnected&&parentRegistered)matches.push(session);
        }
        if(matches.length!==1)throw Error('native-ui-binding-unavailable');
        proof.children.set(childMeta.id,{target:child,meta:childMeta,context:child.browserContext(),initialized:child._initializedDeferred,closed:child._isClosedDeferred,classification:{scheme:url.protocol,host:url.hostname},bindings,selected:matches[0]});
      }
      return proof;
    }catch{return null;}
  };
  const sameNativeUi=(a,b)=>{
    if(!a||!b||!['target','context','session','sessionKey','initialized','closed','childrenRef'].every(key=>a[key]===b[key])||!sameMeta(a.meta,b.meta)||a.children.size!==b.children.size)return false;
    for(const[id,value]of a.children){const other=b.children.get(id);if(!other||!['target','context','initialized','closed','selected'].every(key=>value[key]===other[key])||!sameMeta(value.meta,other.meta)||value.classification.scheme!==other.classification.scheme||value.classification.host!==other.classification.host||value.bindings.size!==other.bindings.size)return false;for(const[key,binding]of value.bindings){const current=other.bindings.get(key);if(!current||!['session','parent','parentTarget','connected','parentConnected','parentKey','parentRegistered'].every(field=>binding[field]===current[field]))return false;}}
    return true;
  };
  const nativeUiAt=(state,id)=>{const value=state.candidates.get(id)?.nativeUi;return sameNativeUi(value,state.uiCandidates.get(id)?.nativeUi)?value:null;};

  const candidates=available=>{
    const result=new Map();for(const[id,target]of available){const info=target._getTargetInfo();if(!info||typeof info.type!=='string')throw Error('inventory-unavailable');if(!['page','tab'].includes(info.type))continue;const value=meta(info);if(id!==value.id||target._targetId!==id)throw Error('inventory-unavailable');result.set(id,{target,meta:value,closed:target._isClosedDeferred.finished(),nativeUi:value.type==='tab'?nativeUi(target,available):null});}return result;
  };
  const sameCandidates=(a,b)=>a.size===b.size&&[...a].every(([id,value])=>{const other=b.get(id);return other&&value.target===other.target&&value.closed===other.closed&&sameMeta(value.meta,other.meta);});
  try{
    connection=browser._connection();manager=browser._targetManager();context=root.browserContext();rootTarget=root.target();
    if(!connection||!manager||!context||root.isClosed()||root.browser()!==browser)throw Error('inventory-unavailable');
    const available=new Map(manager.getAvailableTargets());rootPair=pair(rootTarget,available);
    if(context.id!==undefined&&(!rootPair.pageMeta.contextPresent||context.id!==rootPair.pageMeta.context))throw Error('inventory-unavailable');
    for(const target of available.values())if(target._getTargetInfo().type==='page'){try{const value=pair(target,available);startup.set(value.pageMeta.id,value);}catch{/* An unproven startup target is never an exclusion. */}}
    if(!samePair(startup.get(rootPair.pageMeta.id),rootPair))throw Error('inventory-unavailable');startupAvailable=true;
  }catch{/* This new absence capability is unavailable; existing owners still inspect normally. */}
  const markUnresolved=()=>{unresolved=true;epoch++;};
  const associate=async(target,resolve)=>{
    pending++;epoch++;
    try{
      const page=await resolve();
      if(!page||page.isClosed()||page.target()!==target||page.browser()!==browser||page.browserContext()!==context||target.browser()!==browser||target.browserContext()!==context||!success(target))unresolved=true;else rememberOwned(page);
    }catch{unresolved=true;}
    finally{pending--;epoch++;}
  };
  const snapshot=()=>{
    if(!startupAvailable||unresolved||pending!==0||!Number.isSafeInteger(epoch)||browser._connection()!==connection||browser._targetManager()!==manager||root.isClosed()||root.target()!==rootTarget||root.browserContext()!==context||root.browser()!==browser||pages[0]!==root)throw Error('inventory-unavailable');
    const version=epoch,owners=pages.slice(),available=new Map(manager.getAvailableTargets()),currentCandidates=candidates(available),owned=[],retired=[];
    for(const owner of owners){
      if(!owner||owner.browser()!==browser||owner.browserContext()!==context)throw Error('inventory-unavailable');
      if(owner.isClosed()){
        const value=knownOwned.get(owner);if(!retiredOwned(owner,value,available))throw Error('inventory-unavailable');
        owned.push(value);retired.push(true);
      }else{
        const value=freezeOwned(pair(owner.target(),available));knownOwned.set(owner,value);owned.push(value);retired.push(false);
      }
    }
    if(!samePair(owned[0],rootPair))throw Error('inventory-unavailable');
    const currentStartup=new Map();for(const[id,frozen]of startup){let value=null;if(currentCandidates.has(frozen.pageMeta.id)||currentCandidates.has(frozen.tabMeta.id)){try{const actual=pair(frozen.pageTarget,available);if(samePair(actual,frozen))value=actual;}catch{/* A changed/partial pair cannot explain a wire row. */}}currentStartup.set(id,value);}
    const uiCandidates=candidates(new Map(manager.getAvailableTargets()));
    if(unresolved||pending!==0||epoch!==version||pages.length!==owners.length||owners.some((owner,index)=>pages[index]!==owner)||!sameCandidates(currentCandidates,uiCandidates))throw Error('inventory-unavailable');
    return{epoch:version,owners,owned,retired,startup:currentStartup,candidates:currentCandidates,uiCandidates};
  };
  const sameSnapshot=(a,b)=>a.epoch===b.epoch&&a.owners.length===b.owners.length&&a.owners.every((owner,index)=>b.owners[index]===owner&&samePair(a.owned[index],b.owned[index])&&a.retired[index]===b.retired[index]&&a.owned[index].pageClosed===b.owned[index].pageClosed&&a.owned[index].tabClosed===b.owned[index].tabClosed)&&sameCandidates(a.candidates,b.candidates)&&a.startup.size===b.startup.size&&[...a.startup].every(([id,value])=>{const other=b.startup.get(id);return value===null?other===null:samePair(value,other);});
  const inventory=value=>{
    if(!value||!Array.isArray(value.targetInfos))throw Error('inventory-unavailable');const rows=new Map();for(const info of value.targetInfos){const row=meta(info);if(rows.has(row.id))throw Error('inventory-unavailable');rows.set(row.id,row);}return rows;
  };
  const reconcile=(rows,state,start)=>{
    const accounted=new Map(),wireContext=rootPair.pageMeta;
    const account=value=>{
      if(!value)return false;const p=rows.get(value.pageMeta.id),t=rows.get(value.tabMeta.id);
      if(!sameMeta(p,value.pageMeta)||!sameMeta(t,value.tabMeta)||!sameContext(p,wireContext)||t.contextPresent&&!sameContext(t,wireContext))return false;
      for(const[id,target]of[[p.id,value.pageTarget],[t.id,value.tabTarget]]){if(accounted.has(id)&&accounted.get(id)!==target)return false;accounted.set(id,target);}return true;
    };
    for(let index=0;index<state.owned.length;index++){
      const value=state.owned[index];
      if(state.retired[index]){if(rows.has(value.pageMeta.id)||rows.has(value.tabMeta.id))return false;}
      else if(!account(value))return false;
    }
    for(const[id,frozen]of startup)if(rows.has(frozen.pageMeta.id)||rows.has(frozen.tabMeta.id))if(!account(state.startup.get(id)))return false;
    if(accounted.size!==rows.size||[...rows.keys()].some(id=>!accounted.has(id)))return false;
    for(const[id,value]of state.candidates){
      if(!rows.has(id)){if(value.meta.type==='tab'&&sameNativeUi(nativeUiAt(start,id),nativeUiAt(state,id)))continue;return false;}
      if(accounted.get(id)!==value.target)return false;
    }
    return true;
  };
  const inspect=async(event,{origins,post=false}={})=>{
    const match=typeof event?.popup==='string'&&/^p(0|[1-9]\d*)$/.exec(event.popup),index=match?Number(match[1]):-1;
    const ordinary=()=>{rememberOwned(pages[index]);return inspectManualBinding(pages[index],event,{origins,post});};
    if(Number.isSafeInteger(index)&&index>=0&&pages[index])return ordinary();
    if(post||index<1||!Number.isSafeInteger(index)||index!==pages.length||!Array.isArray(origins)||!origins.includes(event.origin))return unknown();
    try{
      const start=snapshot(),firstValue=await connection.send('Target.getTargets',{filter:[{type:'page'},{type:'tab'},{exclude:true}]});signal?.throwIfAborted();
      if(pages[index])return ordinary();const middle=snapshot();if(!sameSnapshot(start,middle))return unknown();const first=inventory(firstValue);if(!reconcile(first,middle,start))return unknown();
      const secondValue=await connection.send('Target.getTargets',{filter:[{type:'page'},{type:'tab'},{exclude:true}]});signal?.throwIfAborted();
      if(pages[index])return ordinary();const end=snapshot();if(!sameSnapshot(start,end))return unknown();const second=inventory(secondValue);if(!reconcile(second,end,start)||first.size!==second.size||[...first].some(([id,row])=>!sameMeta(row,second.get(id))))return unknown();
      return notReady();
    }catch(error){if(signal?.aborted)throw error;return unknown();}
  };
  return{inspect,associate,markUnresolved};
}

export async function inspectLearningStatement(bytes,template,period){
  learningAssert(bytes.length>0&&bytes.length<=10*1024*1024,'invalid-statement-size');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
  learningAssert(!text.includes('\0')&&!/^\s*</.test(text),'invalid-statement-format');
  const {default:Papa}=await import('papaparse');
  const parsed=Papa.parse(text.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy'});
  learningAssert(!parsed.errors.length&&parsed.data.length>1,'invalid-statement-csv');
  const [headers,...rows]=parsed.data;learningAssert(stable(headers)===stable(template.headers),'statement-header-changed');
  const hash=sha(bytes),normalized=[];
  for(let index=0;index<rows.length;index++){
    learningAssert(rows[index].length===headers.length,'statement-column-count');
    const values=Object.fromEntries(Object.entries(template.mapping).filter(([,v])=>v!==''&&v!==null&&v!==undefined).map(([k,v])=>[k,rows[index][Number(v)]]));
    const row=await normalizeBankRow(values,{hash,sheet:'CSV',row:index+2},{amountSign:template.amountSign});
    learningAssert(row.date>=period.from&&row.date<=period.to,'statement-period-mismatch');normalized.push(row);
  }
  return {hash,rows:normalized.length};
}
export async function learningDownload(browser,directory,{origins,signal,demonstration=false}={}){
  await mkdir(directory,{recursive:true});const cdp=await browser.target().createCDPSession();let artifact,artifactOrigin,failed;
  const pending=new Map();let attempt=0,acceptedAttempt=null;
  cdp.on('Browser.downloadWillBegin',event=>{
    let origin;try{origin=new URL(event.url).origin;}catch{}
    if(!origins.includes(origin)){failed=new Error('download-origin-mismatch');return;}
    pending.set(event.guid,{origin,attempt,state:'pending'});
  });
  cdp.on('Browser.downloadProgress',event=>{
    const item=pending.get(event.guid);if(!item)return;
    item.state=event.state;item.file=path.join(directory,event.guid);
    if(!demonstration){
      if(event.state==='completed'){if(artifact)failed=new Error('multiple-statement-downloads');artifact=item.file;artifactOrigin=item.origin;}
      if(event.state==='canceled')failed=new Error('statement-download-cancelled');
    }
  });
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:directory,eventsEnabled:true});
  return {beginExport(){acceptedAttempt=null;return ++attempt;},acceptExport(value){if(value===attempt)acceptedAttempt=value;},origin(){return artifactOrigin;},async file(){for(let n=0;n<300;n++){
    signal?.throwIfAborted();if(failed)throw failed;
    if(demonstration&&acceptedAttempt!==null){
      const selected=[...pending.values()].filter(item=>item.attempt===acceptedAttempt);
      if(selected.length>1)throw new Error('multiple-statement-downloads');
      if(selected[0]?.state==='canceled')throw new Error('statement-download-cancelled');
      if(selected[0]?.state==='completed'){artifactOrigin=selected[0].origin;return selected[0].file;}
    }else if(!demonstration&&artifact)return artifact;
    await pause(100);
  }throw new Error('statement-download-timeout');},async close(){await cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false}).catch(()=>{});await cdp.detach().catch(()=>{});}};
}
export async function replayBankLearning(browser,page,{record,evidence,candidate,evidenceHash,candidateHash,period,template,directory,signal,awaitLogin,credentials,status,onAuthenticated=()=>{},loginTimeout,manualTimeout,now=()=>new Date().toISOString(),test=false,onStatement=null}={}){
  validateRecipe(candidate,evidence,evidenceHash,{test});learningPeriod(period);learningAssert(sha(stable(candidate))===candidateHash,'candidate-hash-mismatch');
  if(evidence.schema===2)learningAssert(sha(stable(evidence))===evidenceHash,'evidence-hash-mismatch');
  const startedAt=now();
  let download,accountMatched=false,balanceObserved=false,loggedOut=false,currentRole;
  const selected=candidate.steps.map(step=>{
    const event=record.events.find(event=>event.id===step.eventId);
    learningAssert(event&&event.role===step.op,'local-binding-mismatch');
    return event;
  });
  const dates=selected.filter(event=>['from','to'].includes(event.role));
  let authentication;
  const bindings=new Map(),dateHandles=new Map();
  let applied;
  const pages=[page],readiness=createInitialManualReadiness(browser,page,pages,{signal});const listener=async target=>{try{if(target.type()==='page')await readiness.associate(target,async()=>{const p=await target.page();if(p)pages.push(p);return p;});}catch{readiness.markUnresolved();}};browser.on('targetcreated',listener);
  async function locate(event){
    const local=event.private;learningAssert(local&&Array.isArray(local.framePath),'local-binding-missing');
    for(let n=0;n<200;n++){
      signal?.throwIfAborted();let frame=pages[Number(event.popup.slice(1))]?.mainFrame();for(const at of local.framePath)frame=frame?.childFrames()[at];
      // A newly attached SDK frame has no committed URL yet. Only this read is
      // a miss; retain the existing bounded poll and do not repeat any action.
      let frameOrigin;
      try{if(frame)frameOrigin=new URL(frame.url()).origin;}
      catch(error){if(error?.code!=='ERR_INVALID_URL')throw error;}
      if(frameOrigin===event.origin){
        try{
          const matches=await frame.$$(local.selector);
          if(matches.length===1)return {frame,element:matches[0]};
          for(const el of matches)await el.dispose();
        }catch(error){
          // A read can cross a page navigation. Reacquire its frame on the next
          // existing poll; never repeat the inquiry click or a login/action step.
          if(!/Execution context was destroyed/.test(error?.message||'')&&!(error?.name==='ProtocolError'&&/Cannot find context/.test(error?.message||'')))throw error;
        }
      }
      await pause(100);
    }throw new Error('recorded-control-unavailable');
  }
  async function probeLogin(event){
    let frame=pages[Number(event.popup.slice(1))]?.mainFrame();for(const at of event.private.framePath)frame=frame?.childFrames()[at];
    try{
      if(!frame||new URL(frame.url()).origin!==event.origin)return false;
      const matches=await frame.$$(event.private.selector);
      try{return matches.length===1&&await matches[0].evaluate(loginControl,{role:event.role,tag:event.tag,type:event.private.type,origins:evidence.origins});}
      finally{for(const element of matches)await element.dispose().catch(()=>{});}
    }catch{return false;}
  }
  // Inspect the current binding using the same owned pages/frame paths as
  // locate(). Failed reads and multiple matches are unknown, never absence.
  async function inspectManual(event,{post=false}={}){
    return readiness.inspect(event,{origins:evidence.origins,post});
  }
  async function verifyDates(operation){
    const fields=[];
    for(const event of dates){
      currentRole=event.role;
      const part=LEARNING_DATE_PARTS.indexOf(event.format),requested=period[event.role];
      const entry=dateHandles.get(event.id);
      learningAssert(entry,'date-input-mismatch');
      const connected=await entry.element.evaluate(element=>element.isConnected).catch(()=>false);
      if(!connected){
        currentRole=operation;
        const sameDocument=applied&&applied.dateIds.includes(event.id)&&await applied.document.evaluate(documentHandle=>documentHandle===document).catch(()=>false);
        learningAssert(sameDocument,'date-input-mismatch');
        continue;
      }
      const inspected=await entry.element.evaluate(inspectDateControl,{format:event.format,expected:part>=0?Number(requested.split('-')[part]):requested});
      fields.push({role:event.role,...inspected});
    }
    return fields;
  }
  try{
    for(const event of dates){
      currentRole=event.role;
      const key=JSON.stringify([event.popup,event.document,event.frame,event.private?.selector]);
      learningAssert(!bindings.has(key),'date-input-mismatch');
      bindings.set(key,event.id);
    }
    currentRole=undefined;
    if(evidence.schema===2){
      authentication=await replayLearningLogin(selected,{locate,signal,approvedOrigins:evidence.origins,credentials,status,probe:probeLogin,inspectManual,...(loginTimeout?{timeout:loginTimeout}:{}),...(manualTimeout?{manualTimeout}:{})});
      await onAuthenticated();signal?.throwIfAborted();
    }
    else await awaitLogin(page);
    for(const target of await browser.pages())if(target!==page&&!pages.includes(target)&&evidence.origins.some(origin=>target.url().startsWith(origin+'/')))pages.push(target);
    download=await learningDownload(browser,directory,{origins:evidence.origins,signal});
    for(const step of candidate.steps){
      if(LEARNING_LOGIN_ROLES.includes(step.op))continue;
      currentRole=step.op;
      const event=record.events.find(e=>e.id===step.eventId);learningAssert(event&&event.role===step.op,'local-binding-mismatch');
      const {frame,element}=await locate(event);
      if(['from','to'].includes(step.op)){
        const value=period[step.op],part=LEARNING_DATE_PARTS.indexOf(event.format);
        if(part>=0){
          const formatted=value.split('-')[part];
          await element.evaluate(inspectDateControl,{format:event.format,write:formatted,expected:Number(formatted)});
        }else{
          const formatted=event.format==='compact'?value.replaceAll('-',''):event.format==='slash'?value.replaceAll('-','/'):value;
          await element.evaluate(inspectDateControl,{format:event.format,write:formatted,expected:value});
        }
        // Hold the real DOM identity until the form is submitted or exported.
        for(const previous of dateHandles.values())if(previous.frame===frame)learningAssert(!await element.evaluate((element,other)=>element===other,previous.element),'date-input-mismatch');
        dateHandles.set(event.id,{frame,element});
      }else if(step.op==='account'){
        if(event.tag==='select')await element.select(event.private.value);
        else if(event.tag==='input')await element.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},event.private.value);
        const shown=await element.evaluate(el=>el.matches('select,input')?el.value:(el.textContent||'').trim());
        learningAssert(shown===event.private.value,'account-mismatch');accountMatched=true;
      }else if(step.op==='balance'){
        const shown=await element.evaluate(el=>(el.textContent||'').trim());learningAssert(money(shown)!==null,'balance-unavailable');balanceObserved=true;
      }else{
        let fields;
        if(step.op==='export'||(step.op==='inquiry'&&dateHandles.size===dates.length))fields=await verifyDates(step.op);
        currentRole=step.op;
        const form=await element.evaluate(inspectDateControl,{formOnly:true});
        const signature=await element.evaluate((element,form)=>{
          const controlPath=url=>{try{const u=new URL(url,location.href);return u.origin+u.pathname;}catch{return '';}};
          return JSON.stringify([element.localName,element.getAttribute('type')||'',element.getAttribute('name')||'',(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,1000),element.matches('a')?controlPath(element.href):'',form?form.origin+form.path:'']);
        },form);
        learningAssert(signature===event.private.signature,'recorded-control-changed');
        let submission=['inquiry','export'].includes(step.op)&&event.private.submission;
        if(['inquiry','export'].includes(step.op)&&!submission&&fields?.length===dates.length){
          submission=await element.evaluate(inspectDateControl,{formOnly:true,submitter:true,requireSubmitter:true});
        }
        if(submission){
          learningAssert(fields?.length===dates.length,'date-input-mismatch');
          if(form)learningAssert(fields.every(field=>sameSubmission(field.form,form)),'date-input-mismatch');
          const requestPromise=frame.page().waitForRequest(request=>{
            const url=new URL(request.url());
            return request.frame()===frame&&request.isNavigationRequest()&&sameSubmission({origin:url.origin,path:url.pathname,method:request.method()},submission);
          },{timeout:10000});
          const navigation=step.op==='inquiry'?frame.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}):null;
          // Attach rejection handlers before the click so a failed navigation is retained.
          void requestPromise.catch(()=>{});void navigation?.catch(()=>{});
          await element.click();
          const request=await requestPromise;
          const actual=submittedPeriod({url:request.url(),method:request.method(),body:request.postData(),contentType:request.headers()['content-type']},fields);
          currentRole=actual?.from!==period.from?'from':'to';
          learningAssert(actual&&actual.from===period.from&&actual.to===period.to,'date-input-mismatch');
          if(navigation){
            const response=await navigation;
            const finalRequest=response?.request();
            learningAssert(finalRequest&&(finalRequest===request||finalRequest.redirectChain().includes(request)),'date-input-mismatch');
            const previous=applied;
            applied={dateIds:[...dateHandles.keys()],document:await frame.evaluateHandle(()=>document)};
            await previous?.document.dispose().catch(()=>{});
          }
          currentRole=step.op;
        }else await element.click();
        if(step.op==='export')await download.file();
        if(step.op==='logout'){
          await pause(350);const exists=await frame.$(event.private.selector).catch(()=>null);
          // A logout click alone is not proof. Its authenticated control must disappear after navigation/update.
          learningAssert(!exists,'logout-unconfirmed');loggedOut=true;
        }
      }
      if(!['from','to'].includes(step.op))await element.dispose().catch(()=>{});
    }
    const file=await download.file(),checked=await inspectLearningStatement(await readFile(file),template,period);
    learningAssert(accountMatched&&balanceObserved&&loggedOut,'replay-incomplete');
    const receipt={candidateHash,evidenceHash,runtime:LEARNING_RUNTIME,period,statementHash:checked.hash,rows:checked.rows,balanceObserved,accountMatched,loggedOut,freshBrowser:true,startedAt,finishedAt:now(),...(authentication?{authentication}:{})};
    if(onStatement)await onStatement({file,sourceOrigin:download.origin(),receipt});
    return receipt;
  }catch(error){const code=error.message?.split('\n')[0].trim();if(['date-input-mismatch','unsupported-date-control'].includes(code))error.code=code;if(currentRole)error.learningRole=currentRole;throw error;}
  finally{browser.off('targetcreated',listener);await download?.close();for(const entry of dateHandles.values())await entry.element.dispose().catch(()=>{});await applied?.document.dispose().catch(()=>{});}
}

import {createHash} from 'node:crypto';
import {learningAssert,LEARNING_LOGIN_ROLES,LEARNING_LOGIN_STOP_CODES} from '../shared/finance-bank-learning.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Browser-enforced native-form boundary; installed before any secret is written. */
export function restrictLoginForm(element,origins){
  const head=document.head;
  if(!element.isConnected||!head||!head.isConnected||head.parentNode!==document.documentElement)return false;
  const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';
  meta.content='form-action '+origins.join(' ');
  head.append(meta);
  return element.isConnected&&document.head===head&&head.parentNode===document.documentElement&&meta.parentNode===head;
}

/** Structural inspection only. Never returns text, names, values, addresses or form bodies. */
export function loginControl(element,{role,tag,type,origins=[],installAs}={}){
  if(installAs){window[installAs]=loginControl;return;}
  const visible=element.isConnected&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
  if(!visible||(tag==='text'?element.matches('input,select,button,a'):element.localName!==tag))return false;
  const destination=()=>{
    try{
      const form=element.form;if(!form)return null;
      const native=(prototype,key,target)=>Object.getOwnPropertyDescriptor(prototype,key).get.call(target);
      const action=element.hasAttribute('formaction')?element.formAction:native(HTMLFormElement.prototype,'action',form);
      const method=(element.hasAttribute('formmethod')?element.formMethod:native(HTMLFormElement.prototype,'method',form)).toLowerCase();
      const target=element.hasAttribute('formtarget')?element.formTarget:native(HTMLFormElement.prototype,'target',form);
      const url=new URL(action,location.href);
      return {approved:origins.includes(url.origin),method,target,actionPath:url.pathname};
    }catch{return null;}
  };
  if(['login-identifier','login-password'].includes(role))return element.localName==='input'&&element.type===type&&!element.disabled&&element.autocomplete!=='one-time-code'&&destination()?.approved===true;
  if(role==='login-success')return !element.matches('input,select')&&!document.querySelector('input[type=password]');
  if(role==='login-manual')return true;
  // The login lane cannot replay payment/transfer controls, even if assigned a login role.
  const movement=/transfer|payment|remit|振込|振替|送金|支払|決済/i;
  // Input buttons display value, unlike button elements. Never inspect a credential field's value.
  const displayed=element.matches('input[type=button],input[type=submit]')?element.value:element.textContent||'';
  if(movement.test(displayed+' '+(element.getAttribute('aria-label')||'')+' '+(destination()?.actionPath||'')))return false;
  if(role==='login-submit')return element.matches('button,input[type=submit],input[type=button]')&&!!element.form&&!!Element.prototype.querySelector.call(element.form,'input[type=password]')&&destination()?.approved===true&&['get','post'].includes(destination().method);
  if(role==='login-navigation'){
    if(!element.matches('a,button,input[type=button],input[type=submit]'))return false;
    if(element.form)return destination()?.approved===true&&destination().method==='get'&&!Element.prototype.querySelector.call(element.form,'input[type=password],[autocomplete=username],[autocomplete=one-time-code]');
    if(element.matches('a')){try{return origins.includes(new URL(element.href).origin);}catch{return false;}}
    return true;
  }
  return false;
}

// Inspect the original node in its original document, never a replacement at
// the same selector. A failed read is not evidence that a notice disappeared.
function manualControlGone(element){
  return element.ownerDocument===document&&(!element.isConnected||element.getClientRects().length===0||getComputedStyle(element).visibility==='hidden');
}

// A private structural observation, never a value/text/HTML/URL inspection.
// Raw DOM identifiers exist only during the local binding call; only their
// closed descriptor hash is retained in the DPAPI record.
export function manualControlState(element,{selector,installAs}={}){
  if(installAs){window[installAs]=manualControlState;return;}
  try{
    if(selector!==undefined){
      const matches=document.querySelectorAll(selector);
      if(!matches.length)return {kind:'missing'};
      if(matches.length!==1)return {kind:'unknown'};
      element=matches[0];
    }
    if(!element||element.ownerDocument!==document)return {kind:'unknown'};
    if(!element.isConnected)return {kind:'missing'};
    if(!element.getClientRects().length||getComputedStyle(element).visibility==='hidden')return {kind:'hidden'};
    const id=element.getAttribute('id');
    return {kind:'present',...(id&&id.length<=4096?{identity:[element.localName,element.matches('input')?element.type:'',id]}:{})};
  }catch{return {kind:'unknown'};}
}

export function compactManualState(value){
  if(!value||!['frame-absent','missing','hidden','present','unknown'].includes(value.kind))return {kind:'unknown'};
  if(value.kind!=='present')return {kind:value.kind};
  if(value.identity===undefined)return {kind:'present'};
  const identity=value.identity;
  if(!Array.isArray(identity)||identity.length!==3||typeof identity[0]!=='string'||!/^[a-z][a-z0-9-]*$/.test(identity[0])||typeof identity[1]!=='string'||!/^[a-z-]{0,32}$/.test(identity[1])||typeof identity[2]!=='string'||!identity[2]||identity[2].length>4096)return {kind:'unknown'};
  return {kind:'present',hash:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
}

export const manualStateAbsent=state=>['frame-absent','missing','hidden'].includes(state?.kind);
const manualCollision=(event,next)=>next?.role==='login-manual'&&event.popup===next.popup&&event.private.selector===next.private.selector&&JSON.stringify(event.private.framePath)===JSON.stringify(next.private.framePath);
const closedManualState=state=>state&&['frame-absent','missing','hidden','present','unknown'].includes(state.kind)&&Object.keys(state).every(k=>['kind','hash'].includes(k))&&(state.hash===undefined||state.kind==='present'&&/^[a-f0-9]{64}$/.test(state.hash));
const matchesManualState=(expected,current,collision)=>manualStateAbsent(expected)?manualStateAbsent(current):expected.kind==='present'&&current?.kind==='present'&&(expected.hash?expected.hash===current.hash:collision);
export function manualStateUsable(event,next,proof){
  const progress=proof?.v===2&&closedManualState(proof.originalPost)&&(manualStateAbsent(proof.originalPost)||proof.originalPost.kind==='present'&&proof.before?.hash&&proof.originalPost.hash&&proof.originalPost.hash!==proof.before.hash);
  return (proof?.v===1||proof?.v===2&&progress)&&proof.successorId===next?.id&&closedManualState(proof.before)&&closedManualState(proof.post)&&['ready','not-ready','unknown'].includes(proof.beforeReady)&&Object.keys(proof).every(k=>['v','before','post','successorId','beforeReady',...(proof.v===2?['originalPost']:[])].includes(k))&&(manualStateAbsent(proof.post)||proof.post.kind==='present'&&(proof.post.hash&&proof.before.hash&&proof.post.hash!==proof.before.hash||manualCollision(event,next)));
}

// Use the selected owned frame's committed loader, not a session's main DOM
// document or a transient SDK execution-context/lifecycle change. Unknown is
// never proof that the original document retired; no page data is retained.
async function manualFrameDocument(frame){
  if(!frame?.client||typeof frame._id!=='string')return null;
  try{
    const {frameTree}=await frame.client.send('Page.getFrameTree'),pending=[frameTree];
    while(pending.length){
      const node=pending.pop();
      if(node.frame.id===frame._id)return typeof node.frame.loaderId==='string'&&node.frame.loaderId||null;
      pending.push(...node.childFrames||[]);
    }
    return {absent:true};
  }catch{/* An unavailable document identity cannot widen the existing exit. */}
  return null;
}

/** Executes a closed mapping once. Credentials are supplied by the protected local setup UI, never by the model. */
export async function replayLearningLogin(selected,{locate,signal,credentials,status=()=>{},timeout=120000,manualTimeout=10*60000,probe,inspectManual,approvedOrigins}={}){
  const events=selected.filter(e=>LEARNING_LOGIN_ROLES.includes(e.role)),success=events.at(-1);
  // The production caller supplies the exact validated evidence set, including server-only auth origins.
  const origins=[...(approvedOrigins||new Set(selected.map(e=>e.origin)))],check=()=>{signal?.throwIfAborted();};
  learningAssert(success?.role==='login-success','login-demonstration-incomplete');
  // A fresh unauthenticated page must not already satisfy the demonstrated successor.
  learningAssert(!await probe(success),'login-success-already-present'); // guard:login-fresh-success
  let secret,identifier,password,submissionPossible=false;const humanSteps=new Set();
  try{
    check();
    if(events.some(e=>e.role==='login-password')){
      learningAssert(typeof credentials==='function','local-login-input-required');
      secret=await credentials({identifier:events.some(e=>e.role==='login-identifier'),signal});
      check();
      learningAssert(secret&&Object.keys(secret).every(k=>['identifier','password'].includes(k))&&typeof secret.password==='string'&&secret.password.length>0&&secret.password.length<=1024&&(!events.some(e=>e.role==='login-identifier')||(typeof secret.identifier==='string'&&secret.identifier.length>0&&secret.identifier.length<=1024)),'local-login-input-required');
    }
    for(let index=0;index<events.length;index++){
      check();if(humanSteps.has(index))continue;const event=events[index];
      if(event.role==='login-manual'){
        const appeared=Date.now()+timeout;
        while(!await probe(event)){check();learningAssert(Date.now()<appeared,'login-outcome-unconfirmed');await pause(100);}check();
        const current=await locate(event);
        try{
          check();
          let lastManual=index;while(events[lastManual+1]?.role==='login-manual')lastManual++;
          // Consecutive human actions may share one attended span, but only the
          // existing fresh authenticated success can consume that whole span.
          const nextManualReady=lastManual>index&&await probe(events[index+1]);check();
          const span=nextManualReady&&events[lastManual+1]?.role==='login-success';
          const inline=events[index+1]?.role==='login-submit',successor=events[span?lastManual+1:index+(inline?2:1)],end=Date.now()+manualTimeout;
          if(inline){
            const submitEvent=events[index+1],found=await locate(submitEvent);check();
            try{
              learningAssert(await found.element.evaluate(loginControl,{role:submitEvent.role,tag:submitEvent.tag,type:submitEvent.private.type,origins}),'login-control-changed');check();
              learningAssert(password&&await found.element.evaluate((submit,field)=>field.isConnected&&submit.form===field.form,password),'login-form-changed');check();
              if(identifier)learningAssert(await found.element.evaluate((submit,field)=>field.isConnected&&submit.form===field.form,identifier),'login-form-changed');check();
            }finally{await found.element.dispose().catch(()=>{});}
          }
          const noncredential=successor&&['login-navigation','login-manual'].includes(successor.role);
          let initial=noncredential&&inspectManual?await inspectManual(successor):null;check();
          if(initial?.kind==='unknown'&&event.private.manualState&&!manualStateUsable(event,successor,event.private.manualState)&&Date.now()<Math.min(appeared,end)){check();await status("必要な画面を確認しています。操作の案内が出るまでお待ちください。");check();}
          while(initial?.kind==='unknown'&&event.private.manualState&&!manualStateUsable(event,successor,event.private.manualState)&&Date.now()<Math.min(appeared,end)){check();await pause(100);check();initial=await inspectManual(successor);check();}
          const alreadyReady=initial?initial.ready===true:successor&&await probe(successor);check();
          const needsDisappearance=(alreadyReady||initial?.kind==='unknown')&&noncredential;
          learningAssert(successor&&(!alreadyReady||needsDisappearance),'manual-login-successor-invalid');check();
          const proof=needsDisappearance&&event.private.manualState,collision=manualCollision(event,successor);
          if(proof){
            learningAssert(manualStateUsable(event,successor,proof),'unsupported-login-sequence');
            if(proof.before.hash){const actual=compactManualState(await current.element.evaluate(manualControlState));check();learningAssert(actual.hash===proof.before.hash,'unsupported-login-sequence');}
          }
          submissionPossible=true;
          const originalDocument=needsDisappearance?await manualFrameDocument(current.frame):null;check();
          await status(inline?'本人操作が必要です。Chromeで認証コードなどを入力し、ログインを一度だけ送信してください。自動で送信しません。認証情報は記録しません。':'本人操作が必要です。Chromeで認証コード・電子証明書などの確認を完了してください。認証情報は記録しません。');check();
          while(true){
            const ready=await probe(successor);check();
            let completed=ready;
            if(needsDisappearance){
              let gone,retired=false;
              try{gone=await current.element.evaluate(manualControlGone);}
              catch(error){
                const currentDocument=await manualFrameDocument(current.frame);check();
                if(typeof originalDocument!=='string'||!originalDocument||!currentDocument||currentDocument===originalDocument)throw error;
                gone=true;retired=true;
              }
              check();
              // A still-live original may advance only through the exact identity
              // transition positively observed during this demonstration.
              if(!gone&&proof?.v===2&&proof.originalPost?.kind==='present'&&proof.originalPost.hash&&proof.originalPost.hash!==proof.before.hash){
                const state=compactManualState(await current.element.evaluate(manualControlState));check();
                gone=state.kind==='present'&&state.hash===proof.originalPost.hash;
              }
              if(gone){
                if(inspectManual){
                  const state=await inspectManual(event,{post:true});check();
                  gone=proof?matchesManualState(proof.post,state,collision):manualStateAbsent(state)||collision&&state?.kind==='present';
                }else if(proof||retired)gone=false;
                if(gone){gone=await probe(successor);check();}
              }
              completed=ready&&gone;
            }
            if(completed)break;
            if(Date.now()>=end){const checkpointMissing=inline&&!await probe(event);check();throw new Error(checkpointMissing?'login-outcome-unconfirmed':'manual-login-timeout');}
            await pause(100);check();
          }
          check();
          if(span)for(let consumed=index+1;consumed<=lastManual;consumed++)humanSteps.add(consumed);
          if(inline)humanSteps.add(index+1); // guard:login-human-submit-once
        }finally{await current.element.dispose().catch(()=>{});}
        continue;
      }
      if(event.role==='login-success'){
        const end=Date.now()+timeout;
        while(!await probe(event)){check();learningAssert(Date.now()<end,'login-outcome-unconfirmed');await pause(100);}check();
        continue;
      }
      const found=await locate(event),{element}=found;
      try{
        check();
        learningAssert(await element.evaluate(loginControl,{role:event.role,tag:event.tag,type:event.private.type,origins}),'login-control-changed'); // guard:login-control
        check();
        if(event.role==='login-identifier'||event.role==='login-password'){
          learningAssert(await element.evaluate(restrictLoginForm,origins),'login-control-changed');
          check();
          // Preserve DOM identity so submit cannot silently target a replacement form.
          await element.evaluate((el,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},event.role==='login-password'?secret.password:secret.identifier);
          check();
          if(event.role==='login-password')password=element;else identifier=element;
        }else{
          if(event.role==='login-submit'){
            learningAssert(password&&await element.evaluate((submit,field)=>field.isConnected&&submit.form===field.form,password),'login-form-changed'); // guard:login-form
            check();
            if(identifier)learningAssert(await element.evaluate((submit,field)=>field.isConnected&&submit.form===field.form,identifier),'login-form-changed');
            check();
          }
          // Re-evaluate the effective submitter override after asynchronous form identity checks.
          learningAssert(await element.evaluate(loginControl,{role:event.role,tag:event.tag,type:event.private.type,origins}),'login-control-changed');
          check(); // guard:login-abort-before-click
          if(event.role==='login-submit')submissionPossible=true;
          await element.click(); // Exactly once; no retry after an unknown outcome.
          check();
        }
      }finally{if(element!==identifier&&element!==password)await element.dispose().catch(()=>{});}
    }
    return {outcome:'success',mode:events.some(e=>e.role==='login-manual')?'attended':'local-credentials'};
  }catch(error){
    // Browser exceptions can contain page data. Only enumerated fixed codes leave this boundary.
    let code=error.code||error.message;
    if(signal?.aborted)code=submissionPossible?'login-cancelled':'login-cancelled-before-submit';
    else if(code==='login-cancelled'&&!submissionPossible)code='local-login-input-cancelled';
    else if(submissionPossible&&['recorded-control-unavailable','login-control-changed','login-form-changed','manual-login-successor-invalid','unsupported-login-sequence'].includes(code))code='login-outcome-unconfirmed';
    else if(!submissionPossible&&code==='login-outcome-unconfirmed')code='login-not-submitted';
    else if(!LEARNING_LOGIN_STOP_CODES.includes(code))code=submissionPossible?'login-outcome-unconfirmed':'login-not-submitted';
    throw Object.assign(new Error(code),{code});
  }finally{
    if(secret){secret.identifier='';secret.password='';secret=null;}
    await identifier?.dispose().catch(()=>{});await password?.dispose().catch(()=>{});
  }
}

/** One local protected-session request, bound to the current session and an unguessable request id. */
export class LearningCredentialRequest{
  constructor({timeout=5*60000}={}){this.current=null;this.revision=0;this.timeout=timeout;}
  view(session){const r=this.current;return r&&r.session===session?{id:r.id,identifier:r.identifier}:null;}
  expiry(session){return this.current?.session===session?this.current.expiresAt:null;}
  request(session,{identifier,signal},id){
    learningAssert(!this.current&&!signal?.aborted,'local-login-input-unavailable');
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{if(this.current?.id!==id)return;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.current=null;this.revision++;error?reject(error):resolve(value);};
      const abort=()=>finish(new Error('login-cancelled')),timer=setTimeout(()=>finish(new Error('local-login-input-timeout')),this.timeout);
      this.current={id,session,identifier,finish,expiresAt:Date.now()+this.timeout};this.revision++;signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }
  submit(session,input){
    const r=this.current;
    learningAssert(r&&r.session===session&&input&&Object.keys(input).every(k=>['id','identifier','password','cancel'].includes(k))&&input.id===r.id,'local-login-request-changed');
    if(input.cancel===true){r.finish(new Error('login-cancelled'));return;}
    learningAssert(input.cancel===undefined&&typeof input.password==='string'&&input.password.length>0&&input.password.length<=1024&&(!r.identifier||(typeof input.identifier==='string'&&input.identifier.length>0&&input.identifier.length<=1024)),'local-login-input-required');
    r.finish(null,{...(r.identifier?{identifier:input.identifier}:{}),password:input.password});
  }
}

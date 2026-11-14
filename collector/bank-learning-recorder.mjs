import {randomBytes} from 'node:crypto';
import {addPageBinding,CDP_BINDING_PREFIX} from 'rebrowser-puppeteer-core/internal/cdp/utils.js';
import {LEARNING_RUNTIME,LEARNING_ROLES,LEARNING_LOGIN_ROLES,LEARNING_DATE_PARTS,validateEvidence,validateLoginPrefix,learningFailureText,learningOrigin,learningAssert} from '../shared/finance-bank-learning.mjs';
import {inspectDateControl,calendarPeriod,submittedPeriod} from './bank-learning-dates.mjs';
import {loginControl,manualControlState,compactManualState,manualStateUsable} from './bank-learning-login.mjs';
const LOGIN_SUBMIT_UNSUPPORTED='この送信方法はログイン送信として記録できません。本人操作への置き換えにも対応していません。実演を中止し、手動CSV取り込みをご利用ください。';
const MANUAL_CREDENTIAL_SUCCESSOR='この入力欄は本人操作より前から入力できます。実演を中止し、ID・パスワード→本人操作→ログイン送信の順に記録し直すか、手動CSVをご利用ください。';

// Installed only for an explicitly attended demonstration, after the person chooses to start.
// Selectors and values returned by the browser binding are PRIVATE; projectEvidence never copies them.
export function projectEvidence(record, options={}) {
  if(record.schema===2)learningAssert(!record.loginRedirectUnsupported&&!record.loginSequenceUnsupported,'unsupported-login-sequence');
  const evidence={schema:record.schema||1,runtime:LEARNING_RUNTIME,origins:[...new Set([...(record.origins||[]),...record.events.map(e=>e.origin)])],events:record.events.map(({id,document,frame,popup,origin,role,tag,format})=>({id,document,frame,popup,origin,role,tag,...(format?{format}:{})})),complete:record.complete===true,truncated:record.truncated===true};
  return validateEvidence(evidence,options);
}
function overlay(config,expectedDocument) {
  if(expectedDocument!==undefined&&expectedDocument!==document)return;
  if(location.origin!==config.origin)return;
  if(!document.documentElement)return '__OMF_LEARNING_ROOT_PENDING__';
  const installedScope=window[config.binding+'ManualScope'];
  if(config.allowed&&installedScope?.document===document)installedScope.ownerKey=config.key;
  if(document.getElementById('omf-learning-control'))return;
  const panel=document.createElement('div');panel.id='omf-learning-control';
  panel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#111827;color:white;padding:14px;border:1px solid #a78bfa;border-radius:12px;font:14px sans-serif;max-width:390px;box-shadow:0 8px 30px #0008';
  // Parent and child controls must not cover one another when an inquiry opens inside a frame.
  if(window===window.top){panel.style.left='auto';panel.style.right='12px';panel.style.maxWidth='320px';}
  const title=document.createElement('strong');title.textContent='OMF · 銀行の照会手順を記録';
  const text=document.createElement('p');text.textContent='ログインは記録しません。ログイン後、下で操作の種類を選び、銀行の該当箇所を操作してください。残高は箇所をクリックします。送金・支払操作は対象外です。';
  const select=document.createElement('select');select.style.cssText='color:#111;background:white;padding:6px;width:100%';
  for(const [value,label]of [['','一時停止（ログイン・認証はこちら）'],['inquiry','照会画面への移動'],['account','対象口座を選ぶ（表示だけならクリック）'],['from','開始日（1つの欄）'],['from:year','開始日：年'],['from:month','開始日：月'],['from:day','開始日：日'],['to','終了日（1つの欄）'],['to:year','終了日：年'],['to:month','終了日：月'],['to:day','終了日：日'],['export','CSVを出力'],['balance','残高の表示箇所'],['logout','ログアウト']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
  const finish=document.createElement('button');finish.textContent='記録を完了';finish.style.cssText='margin-top:8px;color:#111;background:white;padding:6px';
  finish.hidden=window!==window.top;
  const status=document.createElement('small');status.dataset.learningFeedback='';status.style.display='block';status.setAttribute('aria-busy','false');
  let controls=panel,showFeedback=()=>{};
  let terminalFeedback;
  const feedback=(text,reveal=true,terminal=false)=>{if(terminal)terminalFeedback=text;status.textContent=terminalFeedback||text;if(reveal||terminalFeedback)showFeedback();};
  feedback('パスワード・認証コードはこの記録に含めません。',false);
  if(config.teachLogin&&window!==window.top){
    // Small bank frames still need visible bank fields after a role is chosen.
    // The handle belongs to this overlay only; no bank text or input value is inspected.
    controls=document.createElement('div');
    const handle=document.createElement('a');handle.href='#';handle.dataset.learningToggle='';handle.textContent='OMF · 手順を選ぶ';handle.setAttribute('role','button');handle.setAttribute('aria-expanded','true');
    handle.style.cssText='display:block;position:sticky;top:0;background:#111827;color:white;padding:4px 0;cursor:grab;touch-action:none';
    panel.style.maxWidth='calc(100vw - 16px)';panel.style.maxHeight='calc(100vh - 16px)';panel.style.boxSizing='border-box';panel.style.overflow='auto';panel.style.padding='8px';panel.style.left='8px';panel.style.bottom='8px';
    const clamp=()=>{const box=panel.getBoundingClientRect();panel.style.left=Math.max(0,Math.min(box.left,Math.max(0,innerWidth-box.width)))+'px';panel.style.top=Math.max(0,Math.min(box.top,Math.max(0,innerHeight-box.height)))+'px';panel.style.bottom='auto';};
    const show=expanded=>{controls.hidden=!expanded;handle.setAttribute('aria-expanded',String(expanded));if(!expanded){panel.style.top='auto';panel.style.bottom='8px';}clamp();};
    showFeedback=()=>{show(true);status.scrollIntoView({block:'nearest'});};
    let drag,dragged=false;
    handle.onpointerdown=event=>{if(event.button!==0)return;const box=panel.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:box.left,top:box.top};dragged=false;handle.setPointerCapture(event.pointerId);};
    handle.onpointermove=event=>{if(!drag)return;const x=event.clientX-drag.x,y=event.clientY-drag.y;if(Math.abs(x)+Math.abs(y)>3)dragged=true;panel.style.left=drag.left+x+'px';panel.style.top=drag.top+y+'px';panel.style.bottom='auto';clamp();};
    handle.onpointerup=handle.onpointercancel=()=>{drag=null;};
    handle.onclick=event=>{event.preventDefault();if(dragged){dragged=false;return;}show(controls.hidden);};
    handle.onkeydown=event=>{if(event.key===' '){event.preventDefault();show(controls.hidden);}};
    select.addEventListener('change',()=>{if(select.value)show(false);});
    window.addEventListener('resize',clamp);
    panel.append(handle,controls);
  }
  controls.append(title,text,select,finish,status);document.documentElement.append(panel);
  if(!config.allowed){
    select.hidden=true;finish.hidden=true;
    const approve=document.createElement('button');approve.textContent='この銀行の照会サイト（'+location.origin+'）を記録に追加';approve.style.cssText='background:white;color:#111;padding:8px';
    approve.onclick=async()=>{const result=await window[config.binding]({key:config.key,approveOrigin:true});if(result.ok){approve.remove();select.hidden=false;finish.hidden=window!==window.top;}};
    controls.append(approve);
  }
  const selector=element=>{
    const parts=[];let el=element;
    while(el&&el.nodeType===1){const tag=el.localName;const siblings=el.parentElement?[...el.parentElement.children].filter(x=>x.localName===tag):[el];parts.unshift(tag+':nth-of-type('+(siblings.indexOf(el)+1)+')');el=el.parentElement;}
    return parts.join(' > ');
  };
  const readyControls=(extra,instance)=>{
    if(!(window[config.binding+'Origins']||[]).includes(location.origin))return null;
    // Only the synchronous before-default call carries an exact manual instance.
    // The prospective-locator Map stays in this document; ordinary Ready() reads cannot
    // overwrite it. No selector/attribute/text/value census is serialized.
    if(instance&&typeof instance.token==='string'&&Number.isSafeInteger(instance.sequence)&&instance.sequence>0){
      const states=new Map();let complete=true;
      try{
        for(const control of document.querySelectorAll('*')){
          if(panel.contains(control)||control.matches('input,select,button,a'))continue;
          try{const ready=window[config.binding+'Login'](control,{role:'login-manual',tag:'text',type:'',origins:window[config.binding+'Origins']||[]});if(typeof ready==='boolean')states.set(selector(control),ready);else complete=false;}catch{complete=false;}
        }
      }catch{complete=false;}
      scope.textBefore={document,key:scope.ownerKey,token:instance.token,sequence:instance.sequence,states,complete};
    }
    let structural;
    try{
      const candidates=[...document.querySelectorAll('input,select,button,a')];
      if(extra?.ownerDocument===document&&!candidates.includes(extra))candidates.push(extra);
      structural={complete:true,controls:candidates.filter(control=>!panel.contains(control)).flatMap(control=>{
        const tag=control.matches('input,select,button,a')?control.localName:'text',type=control.matches('input')?control.type:'',items=[];
        for(const role of ['login-manual','login-navigation']){
          if(role==='login-navigation'&&!control.matches('a,button,input[type=button],input[type=submit]'))continue;
          if(window[config.binding+'Login'](control,{role,tag,type:role==='login-manual'?'':type,origins:window[config.binding+'Origins']||[]}))items.push({selector:selector(control),role,tag,type:role==='login-manual'?'':type});
        }
        return items;
      })};
    }catch{structural={complete:false,controls:[]};}
    return {key:config.key,structural,controls:[...document.querySelectorAll('input')].flatMap(control=>{
      const type=control.type,role=type==='password'?'login-password':'login-identifier';
      const ready=(type==='password'||['text','email','tel'].includes(type))&&window[config.binding+'Login'](control,{role,tag:'input',type,origins:window[config.binding+'Origins']||[]});
      return ready?[{selector:selector(control),role,type}]:[];
    })};
  };
  // Document and Node references never cross the local binding or enter storage.
  // A same-document overlay reinstall retains the original instance witness.
  let scope=window[config.binding+'ManualScope'];
  if(!scope||scope.document!==document)scope=window[config.binding+'ManualScope']={document,token:config.key,ownerKey:config.key,sequence:0,original:null};
  if(config.teachLogin){
    window[config.binding+'Ready']=readyControls;
    window[config.binding+'ManualInspect']=(selector,instance)=>{
      if(!(window[config.binding+'Origins']||[]).includes(location.origin))return null;
      return {key:config.key,token:scope.token,...(selector===undefined?{}:{state:window[config.binding+'State'](null,{selector})}),...(instance?.token===scope.token?{original:instance.sequence===scope.original?.sequence?window[config.binding+'State'](scope.original.node):{kind:'unknown'}}:{})};
    };
  }
  const manualTextReadiness=element=>{
    const anchor=window[config.binding+'ManualAnchor'],instance=anchor?.instance;
    if(!instance)return null;
    const snapshot=scope.textBefore,result={eventId:anchor.id,key:scope.ownerKey,snapshotKey:snapshot?.key,token:instance.token,sequence:instance.sequence,state:'unknown'};
    try{
      if(anchor.popup!==config.popup||!(window[config.binding+'Origins']||[]).includes(location.origin)||element.ownerDocument!==document||element.matches('input,select,button,a')||!snapshot?.complete||snapshot.document!==document||scope.document!==document||typeof scope.ownerKey!=='string'||snapshot.token!==instance.token||snapshot.sequence!==instance.sequence)return result;
      const prospective=selector(element);
      result.state=snapshot.states.has(prospective)?snapshot.states.get(prospective)?'ready':'not-ready':'not-ready';
    }catch{/* An unavailable or stale observation stays unknown. */}
    return result;
  };
  const manualReadiness=(element,instance)=>{
    const observed=[],seen=new Set();let unknown=false;
    const visit=target=>{
      if(seen.has(target))return;seen.add(target);
      try{const inspect=target[config.binding+'Ready'],value=typeof inspect==='function'?inspect(target===window?element:undefined,instance):null;if(value)observed.push(value);else unknown=true;}catch{unknown=true;}
      // Cross-origin contexts remain unknown. WindowProxy traversal may still
      // reach an owned same-origin descendant; no foreign DOM/value is read.
      try{for(let i=0;i<target.frames.length;i++)visit(target.frames[i]);}catch{unknown=true;}
    };
    visit(window.top);return {observed,unknown};
  };
  const manualPostState=()=>{
    const anchor=window[config.binding+'ManualAnchor'];if(!anchor)return null;
    const unknown={eventId:anchor.id,state:{kind:'unknown'}};
    if(anchor.popup!==config.popup)return unknown;
    try{
      const observed=[];let complete=true;const seen=new Set();
      const visit=target=>{
        if(seen.has(target))return;seen.add(target);
        try{const value=target[config.binding+'ManualInspect']?.(undefined,anchor.instance);if(value)observed.push(value);else complete=false;}catch{complete=false;}
        try{for(let i=0;i<target.frames.length;i++)visit(target.frames[i]);}catch{complete=false;}
      };visit(window.top);
      const progress={observed,complete};
      let target=window.top;
      for(let at=0;at<anchor.framePath.length;at++){
        const parent=target[config.binding+'ManualInspect']?.();if(!parent)return unknown;
        if(anchor.framePath[at]>=target.frames.length)return {eventId:anchor.id,parentKey:parent.key,missingAt:at,state:{kind:'frame-absent'},progress};
        target=target.frames[anchor.framePath[at]];
      }
      const value=target[config.binding+'ManualInspect']?.(anchor.selector);
      return value?{eventId:anchor.id,key:value.key,state:value.state,progress}:unknown;
    }catch{return unknown;}
  };
  if(config.teachLogin){
    text.textContent='ログイン前から記録します。操作の種類を選び、該当する欄やボタンをクリックしてください。ID・パスワード・認証コードの値は記録しません。ログイン後、認証済み画面にだけある表示を「ログイン完了の表示」でクリックしてから照会を実演します。';
    for(const [value,label]of [['login-navigation','ログイン画面へ移動'],['login-identifier','ログインIDの入力欄'],['login-password','パスワードの入力欄'],['login-submit','ログインを送信'],['login-manual:otp','認証コードは本人が操作'],['login-manual:certificate','電子証明書は本人が操作'],['login-manual:other','その他の本人操作'],['login-success','ログイン完了の表示']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    feedback('認証情報は保存・送信しません。再実行時にこのPCの設定画面で入力します。',false);
  }
  const unsupportedMessage='この操作は自動ログインに対応していません。本人操作として記録するか、実演を中止してください。';
  window[config.binding+'Feedback']=feedback;
  if(config.feedbackMessage)feedback(config.feedbackMessage,true,config.terminalFeedback);
  const unsupported=role=>{feedback(role==='login-submit'?config.submitUnsupported:unsupportedMessage);void window[config.binding]({key:config.key,unsupportedControl:true,role}).catch(()=>{});};
  let sending=false;
  // Retire a previous operation before another bank interaction can sponsor its
  // successor. No values/keys/targets are sent, and delayed completion has no timer.
  const interaction=event=>{if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(config.teachLogin&&event.isTrusted&&!panel.contains(event.target))void window[config.binding]({key:config.key,interaction:true}).catch(()=>{});};
  document.addEventListener('click',interaction,true);document.addEventListener('keydown',interaction,true);
  const dateControls=new Map();
  const send=async event=>{
    if(panel.contains(event.target)||!select.value||sending)return;
    let element=event.target.closest('button,a,input,select')||event.target;
    const [role,format]=select.value.split(':');
    if(['from','to'].includes(role)&&event.type!=='change')return;
    if(role==='account'&&element.matches('select,input')&&event.type!=='change')return;
    if(!['from','to','account'].includes(role)&&event.type!=='click')return;
    if(role.startsWith('login-')){
      if(!config.teachLogin)return;
      // No credential/input value, name, text, HTML or URL is added to private
      // structural proof. Only a tag/type/id descriptor is hashed locally.
      let type=element.matches('input')?element.type:'';
      if(role==='login-password'&&(!element.matches('input')||type!=='password')){unsupported(role);return;}
      if(role==='login-identifier'&&(!element.matches('input')||!['text','email','tel'].includes(type)||element.autocomplete==='one-time-code')){unsupported(role);return;}
      if(['login-navigation','login-submit'].includes(role)&&!element.matches('a,button,input[type=submit],input[type=button]')){unsupported(role);return;}
      if(['login-success','login-manual'].includes(role)){element=event.target;type='';}
      const tag=element.matches('input,select,button,a')?element.localName:'text';
      if(role==='login-success'&&element.matches('input,select')){feedback('ログイン完了は入力欄ではなく、認証済み画面にだけ現れる見出し・表示文字を選んでください。');return;}
      if(!window[config.binding+'Login'](element,{role,tag,type,origins:window[config.binding+'Origins']||[]})){unsupported(role);return;}
      if(role==='login-success'&&document.querySelector('input[type=password]')){feedback('パスワード画面では完了を記録できません。');return;}
      // Synchronously capture owned, approved same-origin frames before the
      // bank's handler reveals/enables a successor. This is private evidence of
      // readiness, never proof that an inaccessible cross-origin field is absent.
      const manualAfter=['login-manual','login-navigation'].includes(role)?manualPostState():undefined;
      const manualPriorReady=role==='login-manual'&&tag==='text'?manualTextReadiness(element):undefined;
      const manualInstance=role==='login-manual'?{token:scope.token,sequence:++scope.sequence}:undefined;
      const ready=manualInstance?manualReadiness(element,manualInstance):undefined;
      const manualBefore=role==='login-manual'?window[config.binding+'State'](element):undefined;
      if(manualInstance)scope.original={sequence:manualInstance.sequence,node:element};
      sending=true;status.setAttribute('aria-busy','true');feedback('保存中…次の操作は保存が終わってから行ってください。');
      try{const result=await window[config.binding]({key:config.key,role,...(format?{format}:{}),...(ready?{manualReady:ready}:{}),...(manualBefore?{manualBefore}:{}),...(manualAfter?{manualAfter}:{}),...(manualInstance?{manualInstance}:{}),...(manualPriorReady?{manualPriorReady}:{}),selector:selector(element),local:{tag,type,...(element.form?{formSelector:selector(element.form)}:{})}});if(result.ok)select.value='';feedback(result.ok?'記録しました':result.message||'ログインの操作順を確認してください。',!result.ok);}catch{feedback('記録できませんでした。');}finally{sending=false;status.setAttribute('aria-busy','false');}
      return;
    }
    if(element.matches('input[type=password],input[type=hidden],[autocomplete*=password],[autocomplete=one-time-code]')){feedback('認証情報は記録できません。');return;}
    if(role==='balance'||(role==='account'&&!element.matches('input,select')))element=event.target;
    sending=true;status.setAttribute('aria-busy','true');feedback('保存中…次の操作は保存が終わってから行ってください。');
    const controlPath=url=>{try{const u=new URL(url,location.href);return u.origin+u.pathname;}catch{return '';}};
    const baseForm=window[config.binding+'Date'](element,{formOnly:true});
    const local={tag:element.matches('input,select,button,a')?element.localName:'text',value:element.matches('input,select')?element.value:(element.textContent||'').trim(),signature:JSON.stringify([element.localName,element.getAttribute('type')||'',element.getAttribute('name')||'',(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,1000),element.matches('a')?controlPath(element.href):'',baseForm?baseForm.origin+baseForm.path:''])};
    try{
      if(['from','to'].includes(role)){
        const detected=format||(/^\d{8}$/.test(local.value)?'compact':/^\d{4}\/\d{2}\/\d{2}$/.test(local.value)?'slash':'iso');
        if(!format||['year','month','day'].includes(format))local.date=window[config.binding+'Date'](element,{format:detected});
        for(const [key,control]of dateControls)if(control.element===element||key===role+':'+detected)dateControls.delete(key);
        dateControls.set(role+':'+detected,{element,role,format:detected});
      }
      if(role==='export')local.dates=[...dateControls.values()].filter(control=>control.element.isConnected).map(control=>({role:control.role,selector:selector(control.element),...window[config.binding+'Date'](control.element,{format:control.format})}));
      if(element.form){local.form=window[config.binding+'Date'](element,{formOnly:true,submitter:true});local.submitter=!!window[config.binding+'Date'](element,{formOnly:true,submitter:true,requireSubmitter:true});}
      const result=await window[config.binding]({key:config.key,role,...(format?{format}:{}),selector:selector(element),local});
      feedback(result.ok?'記録しました':result.message||'記録できませんでした',!result.ok);
    }catch{feedback('日付の欄と年・月・日の指定を確認して、もう一度操作してください。');}finally{sending=false;status.setAttribute('aria-busy','false');}
  };
  document.addEventListener('click',send,true);document.addEventListener('change',send,true);
  finish.onclick=()=>window[config.binding]({key:config.key,finish:true}).then(result=>{if(!result.ok)feedback(result.message||'日付の指定を確認してください。');}).catch(()=>feedback('記録できませんでした。'));
}
export async function recordBankLearning(browser,page,{signal,timeout=20*60000,store,entryOrigin,entryUrl,origins=[entryOrigin],demonstrationPeriod,test=false,teachLogin=false,onReady=()=>{},onExport=()=>null}={}) {
  const record={...(teachLogin?{schema:2,entryUrl:entryUrl||entryOrigin}:{}),origins,events:[],complete:false,truncated:false},pages=new Map(),frames=new Map(),loginSessions=new WeakMap(),loginListeners=[],frameInstallations=new WeakMap(),entryGenerations=new WeakMap(),entryFrames=new Map(page.frames().map(frame=>[frame,{generation:0,url:/^https?:/.test(frame.url())?frame.url():null}])),entryPending=new WeakMap(),entryRequested=new Map(),entryReached=new WeakMap();let serial=0,finished=false,pending=Promise.resolve(),failure,loginFeedbackRole,feedbackMessage;
  const renderDocuments=new Set(),releaseRenderDocument=owner=>{
    if(!owner)return;
    return owner.releasePromise??=Promise.resolve().then(()=>owner.handle.dispose()).catch(()=>{}).finally(()=>renderDocuments.delete(owner));
  };
  const readinessWaits=new Set(),abortReadiness=frame=>{for(const wait of readinessWaits)if(!frame||wait.frame===frame)wait.controller.abort();};
  const entryInteracted=new WeakSet(),entryWithin=new WeakSet(),entryObserved=new WeakSet(),entryScheduled=new WeakMap();let manualReady;const manualInstances=new Map();
  const manualAnchor=()=>{
    const last=record.events.at(-1);
    return last?.role==='login-manual'?{id:last.id,popup:last.popup,selector:last.private.selector,framePath:last.private.framePath,instance:manualInstances.get(last.id)}:null;
  };
  const publishManualAnchor=async()=>{
    const anchor=manualAnchor();
    for(const value of frames.values())if(frameInstallations.get(value.frame)===value.key&&origins.includes(value.origin)){
      const binding=pages.get(value.page)?.binding;
      try{await value.frame.evaluate((binding,anchor,origin)=>{if(location.origin===origin)window[binding+'ManualAnchor']=anchor;},binding,anchor,value.origin);}
      catch{/* A retired recipient cannot receive an anchor; no state is inferred. */}
    }
  };
  const entryOwned=frame=>{const initial=entryFrames.get(frame),generation=entryGenerations.get(frame)||0,reached=entryReached.get(frame);return !!((initial&&initial.generation===generation&&initial.url===frame.url())||(reached?.generation===generation&&reached.intent.accepted));};
  const observeEntryFrame=frame=>{
    if(!teachLogin||entryObserved.has(frame))return;entryObserved.add(frame);
    const parent=frame.parentFrame();if(!entryFrames.has(frame)&&parent&&entryOwned(parent)&&!entryInteracted.has(parent))entryFrames.set(frame,{generation:entryGenerations.get(frame)||0,url:null}); // exit:automatic-owned-child
  };
  if(teachLogin){let url;try{url=new URL(record.entryUrl);}catch{throw Error('entry-origin-mismatch');}learningAssert(url.origin===entryOrigin&&!url.username&&!url.password&&url.href.length<=2048,'entry-origin-mismatch');record.entryUrl=url.href;}
  let done;const completion=new Promise(resolve=>{done=resolve;}),observations=[],requestListeners=[],captures=new Map();
  void completion.then(()=>abortReadiness());
  const unsupported='この画面の送信・移動方法は自動取得に対応していません。実演を中止し、手動CSV取り込みをご利用ください。';
  const latestDates=events=>events.filter((event,index)=>['from','to'].includes(event.role)&&!events.slice(index+1).some(next=>next.role===event.role&&next.format===event.format));
  const pagesFor=popup=>[...pages].find(([,value])=>value.popup===popup)?.[0];
  const bindResult=(observation,context)=>{
    const withoutHash=value=>{const url=new URL(value);url.hash='';return url.href;};
    if(!observation.resultDocument&&observation.responseUrl&&observation.sourceFrame===context?.frame&&context.document!==observation.document&&withoutHash(context.frame.url())===withoutHash(observation.responseUrl))observation.resultDocument=context.document;
  };
  async function recordedPeriod(dates,context,snapshots=[]){
    const fields=[];
    for(const event of dates){
      const frame=[...frames.values()].reverse().find(value=>value.page===pagesFor(event.popup)&&value.id===event.frame);
      const snapshot=context?.document===event.document&&context?.id===event.frame?snapshots.find(value=>value.selector===event.private.selector&&value.role===event.role&&value.format===event.format):null;
      let date=snapshot;
      if(!date&&frame?.document===event.document){
        try{date=await frame.frame.$eval(event.private.selector,inspectDateControl,{format:event.format});}
        catch{return null;}
      }
      if(!date){
        const submitted=observations.some(value=>value.popup===event.popup&&value.document===event.document&&value.frame===event.frame&&value.resultDocument===context?.document&&dates.some(date=>date.id===value.afterDate));
        if(!submitted)return {unsupported:true};
        date=event.private.date;
      }
      fields.push({role:event.role,...date});
    }
    return {period:calendarPeriod(fields)};
  }
  const persist=()=>store?.(record);
  const publishFeedback=(message,role)=>{
    if(record.loginRedirectUnsupported)message='このログインの移動先は記録の許可に含まれず、自動実行できません。実演のログインは送信済みです。銀行の状態を確認し、記録を中止して本人操作・手動CSVをご利用ください。';
    feedbackMessage=message;loginFeedbackRole=role;
    for(const context of frames.values())if(origins.includes(context.origin))void(async()=>{try{await context.frame.evaluate((binding,message,terminal)=>{const feedback=window[binding+'Feedback'];if(typeof feedback==='function')feedback(message,true,terminal);},pages.get(context.page)?.binding,message,record.loginRedirectUnsupported===true);}catch{/* An old document must not replace the current document's feedback or result. */}})();
  };
  const recordingError=error=>{
    if(finished||/Execution context was destroyed|Cannot find context|detached Frame|Target closed|Session closed/.test(error?.message||''))return;
    failure=new Error('frame-recording-unavailable');finished=true;done();
  };
  async function attach(target){
    if(pages.has(target))return;
    const popup='p'+pages.size,binding='__omfLearn'+randomBytes(8).toString('hex');pages.set(target,{popup,binding});
    if(teachLogin){
      observeLoginSession(target.mainFrame().client,false,target);
      const opener=[...pages.keys()].find(p=>p!==target&&p.target()===target.target().opener()),intent=opener&&entryPending.get(opener);
      if(intent){entryPending.delete(opener);entryReached.set(target.mainFrame(),{generation:entryGenerations.get(target.mainFrame())||0,intent});} // Its owned automatic first commit uses the same lineage below.
    }
    const onRequest=request=>{
      if(!request.isNavigationRequest())return;
      const frame=request.frame();
      const context=[...frames.values()].reverse().find(value=>value.frame===frame);
      if(!context)return;
      const dates=latestDates(record.events.filter(event=>event.popup===popup&&event.document===context.document&&event.frame===context.id));
      const fields=dates.map(event=>({role:event.role,...event.private.date}));
      if(!calendarPeriod(fields))return;
      const url=new URL(request.url()),submission={origin:url.origin,path:url.pathname,method:request.method()};
      const capture=captures.get(context.key);
      if(!capture||!origins.includes(url.origin))return;
      const period=submittedPeriod({url:request.url(),method:request.method(),body:request.postData(),contentType:request.headers()['content-type']},fields);
      if(!period||JSON.stringify(period)!==JSON.stringify(demonstrationPeriod||calendarPeriod(fields)))return;
      const observation={popup,document:context.document,frame:context.id,afterDate:dates.at(-1).id,submission,capture,request,sourceFrame:context.frame};
      observations.push(observation);
      if(observations.length>160)observations.shift();
    };
    const onResponse=response=>{
      const request=response.request();
      if(!request.isNavigationRequest()||(response.status()>=300&&response.status()<400)||response.headers()['content-disposition']?.includes('attachment'))return;
      for(const observation of observations){
        if(observation.capture.role!=='inquiry'||!(request===observation.request||request.redirectChain().includes(observation.request)))continue;
        observation.responseUrl=response.url();
        bindResult(observation,[...frames.values()].reverse().find(value=>value.frame===request.frame()));
      }
    };
    target.on('request',onRequest);target.on('response',onResponse);requestListeners.push([target,onRequest,onResponse]);
    await target.exposeFunction(binding,payload=>{
      if(finished)return {ok:false};
      const initial=[...frames.values()].find(f=>f.key===payload?.key&&f.page===target);
      if(teachLogin&&initial&&payload.interaction===true){if(origins.includes(initial.origin)){entryPending.delete(target);entryScheduled.delete(initial.frame);entryInteracted.add(initial.frame);}return {ok:true};} // guard:entry-operation-ownership
      if(teachLogin&&initial&&origins.includes(initial.origin)&&payload.unsupportedControl===true&&LEARNING_LOGIN_ROLES.includes(payload.role)){
        publishFeedback(payload.role==='login-submit'?LOGIN_SUBMIT_UNSUPPORTED:'この操作は自動ログインに対応していません。本人操作として記録するか、実演を中止してください。',payload.role);
        return {ok:false};
      }
      const navigation=teachLogin&&initial&&origins.includes(initial.origin)&&payload.role==='login-navigation'&&!payload.unsupportedControl?{accepted:false}:null;
      if(navigation)entryPending.set(target,navigation);
      const capture=initial&&origins.includes(initial.origin)&&['inquiry','export'].includes(payload.role)?{role:payload.role}:null;
      if(capture)captures.set(initial.key,capture);
      // Binding delivery precedes the bank click's default action. Tag the attempt
      // before awaiting DOM inspection so a rejected or late file cannot replace it.
      const acceptExport=capture?.role==='export'?onExport():null;
      pending=pending.then(async()=>{
        if(finished)return {ok:false};
        const context=[...frames.values()].find(f=>f.key===payload?.key&&f.page===target);
        if(!context)return {ok:false};
        if(payload.approveOrigin){learningOrigin(context.origin,{test});if(!origins.includes(context.origin)){if(origins.length>=8)throw new Error('too-many-bank-origins');origins.push(context.origin);}if(teachLogin)for(const value of frames.values()){const name=pages.get(value.page)?.binding;try{await value.frame.evaluate((key,list)=>{window[key]=list;},name+'Origins',origins);}catch{/* Recipient delivery may outlive its frame; preserve the existing ignored-delivery policy. */}}await persist();return {ok:true};}
        if(!origins.includes(context.origin))return {ok:false};
        if(payload.finish){
          const dates=latestDates(record.events);
          const period=record.exportPeriod?.afterDate===dates.at(-1)?.id?record.exportPeriod.period:null;
          if(!period||(demonstrationPeriod&&JSON.stringify(period)!==JSON.stringify(demonstrationPeriod)))return {ok:false,message:'指定した開始日・終了日になるように、日付の欄を操作してください。'};
          for(const event of record.events.filter(event=>['inquiry','export'].includes(event.role))){
            const match=observations.find(value=>value.capture.eventId===event.id);
            if(match)event.private.submission=match.submission;
            else if(event.private.submitter){
              // Menu submits before period entry and CSV submits on a verified
              // result page do not submit the recorded calendar controls.
              const dateFields=latestDates(record.events.slice(0,record.events.indexOf(event))).filter(date=>date.popup===event.popup&&date.document===event.document&&date.frame===event.frame);
              if(dateFields.length)return {ok:false,message:unsupported};
            }
          }
          record.complete=true;finished=true;await persist();done();return {ok:true};
        }
        if(![...LEARNING_ROLES,...(teachLogin?LEARNING_LOGIN_ROLES:[])].includes(payload.role)||typeof payload.selector!=='string'||payload.selector.length>4096)return {ok:false};
        if(teachLogin){
          const authenticated=record.events.some(e=>e.role==='login-success'),isLogin=LEARNING_LOGIN_ROLES.includes(payload.role);
          if(authenticated===isLogin)return {ok:false,message:'ログインの記録後に照会を実演してください。'};
          if(isLogin){
            if(['login-identifier','login-password'].includes(payload.role)&&record.events.at(-1)?.role==='login-manual'&&manualReady?.known.get(context.identity+':'+context.origin)?.has(JSON.stringify([payload.selector,payload.role,payload.local?.type]))){
              publishFeedback(MANUAL_CREDENTIAL_SUCCESSOR,payload.role);return {ok:false,message:MANUAL_CREDENTIAL_SUCCESSOR};
            } // guard:manual-credential-readiness
            if(['login-navigation','login-manual','login-identifier','login-password'].includes(payload.role)&&!record.events.some(e=>['login-identifier','login-password','login-manual'].includes(e.role))){
              const initial=entryFrames.get(context.frame),generation=entryGenerations.get(context.frame)||0,reached=entryReached.get(context.frame);
              if(!(initial&&initial.generation===generation&&initial.url===context.frame.url())&&!(reached?.generation===generation&&reached.intent.accepted))return {ok:false,message:'ログイン画面への移動が記録されていません。この実演は中止し、開始ページで「ログイン画面へ移動」または「本人操作」を記録してから移動してください。開始ページのURLはこのPCの設定で指定して記録をやり直せます。'}; // guard:login-entry-reachable
            }
            if(payload.role==='login-success'&&record.events.some(e=>e.role==='login-submit')){
              let blocked=false;for(let frame=context.frame;frame;frame=frame.parentFrame()){const session=loginSessions.get(frame.client),nav=session?.frames.get(frame._id);if(nav&&(nav.overflow||nav.origins.some(origin=>!origins.includes(origin))))blocked=true;if(session?.overflow)blocked=true;}
              if(blocked){record.loginRedirectUnsupported=true;await persist();return {ok:false,code:'unsupported-login-sequence',message:'このログインの移動先は記録の許可に含まれず、自動実行できません。実演のログインは送信済みです。銀行の状態を確認し、記録を中止して本人操作・手動CSVをご利用ください。'};} // guard:login-redirect-admission
              delete record.loginRedirectUnsupported;
            }
            // Only positional selectors and enumerated structural types are retained locally.
            if(!/^([a-z][a-z0-9-]*:nth-of-type\([1-9]\d*\))( > [a-z][a-z0-9-]*:nth-of-type\([1-9]\d*\))*$/.test(payload.selector))return {ok:false};
            const local=payload.local;
            if(!local||Object.keys(local).some(k=>!['tag','type','formSelector'].includes(k))||!['input','select','button','a','text'].includes(local.tag)||!['','text','email','tel','password','submit','button'].includes(local.type))return {ok:false};
            if(local.formSelector!==undefined&&(typeof local.formSelector!=='string'||local.formSelector.length>4096||!/^([a-z][a-z0-9-]*:nth-of-type\([1-9]\d*\))( > [a-z][a-z0-9-]*:nth-of-type\([1-9]\d*\))*$/.test(local.formSelector)))return {ok:false};
            if(record.events.length>=32)throw new Error('unsupported-login-sequence');
            const event={id:'e'+serial,document:context.document,frame:context.id,popup,origin:context.origin,role:payload.role,tag:local.tag,...(payload.format?{format:payload.format}:{}),private:{selector:payload.selector,framePath:context.path,type:local.type,...(local.formSelector?{formSelector:local.formSelector}:{})}};
            try{
              validateLoginPrefix([...record.events,event]); // guard:login-record-prefix
              const first=record.events.find(e=>['login-identifier','login-password','login-submit'].includes(e.role));
              if(first&&['login-identifier','login-password','login-submit'].includes(event.role)&&first.private.formSelector&&first.private.formSelector!==local.formSelector)throw Error('unsupported-login-sequence');
            }catch{if(payload.role==='login-success'){record.loginSequenceUnsupported=true;await persist();}return {ok:false,code:'unsupported-login-sequence',message:learningFailureText('unsupported-login-sequence')};}
            const previous=record.events.at(-1);let pendingManualProof;
            if(previous?.role==='login-manual'&&['login-navigation','login-manual'].includes(event.role)){
              const snapshot=manualReady?.structural.get(context.identity+':'+context.origin),key=JSON.stringify([payload.selector,payload.role,local.tag,local.type]);
              let beforeReady=snapshot?.has(key)?'ready':snapshot&&(local.tag!=='text'||payload.role==='login-navigation')?'not-ready':'unknown';
              if(event.role==='login-manual'&&local.tag==='text'&&beforeReady==='unknown'){
                const prior=payload.manualPriorReady,instance=manualInstances.get(previous.id),owner=frames.get(prior?.key),beforeOwner=frames.get(prior?.snapshotKey);
                if(prior?.eventId===previous.id&&owner?.page===target&&beforeOwner?.page===target&&owner.frame===context.frame&&beforeOwner.frame===context.frame&&owner.origin===context.origin&&beforeOwner.origin===context.origin&&origins.includes(owner.origin)&&frameInstallations.get(owner.frame)===owner.key&&instance&&prior.token===instance.token&&prior.sequence===instance.sequence&&['ready','not-ready','unknown'].includes(prior.state)&&Object.keys(prior).every(k=>['eventId','key','snapshotKey','token','sequence','state'].includes(k)))beforeReady=prior.state;
              }
              const after=payload.manualAfter;let post={kind:'unknown'};
              if(after?.eventId===previous.id){
                if(after.key){
                  const observed=frames.get(after.key),identity=previous.popup+':'+previous.private.framePath.join('.');
                  if(observed?.page===target&&observed.identity===identity&&origins.includes(observed.origin))post=compactManualState(after.state);
                }else if(after.state?.kind==='frame-absent'&&Number.isInteger(after.missingAt)&&after.missingAt>=0&&after.missingAt<previous.private.framePath.length){
                  const parent=frames.get(after.parentKey),identity=previous.popup+':'+previous.private.framePath.slice(0,after.missingAt).join('.');
                  if(parent?.page===target&&parent.identity===identity&&origins.includes(parent.origin))post={kind:'frame-absent'};
                }
              }
              let originalPost={kind:'unknown'};const instance=manualInstances.get(previous.id),progress=after?.eventId===previous.id&&after.progress;
              if(instance&&Array.isArray(progress?.observed)&&progress.observed.length){
                const observed=progress.observed,valid=observed.every(value=>{const owner=frames.get(value?.key),token=frames.get(value?.token);return owner?.page===target&&token?.page===target&&owner.identity===token.identity&&origins.includes(owner.origin)&&owner.origin===token.origin;});
                if(valid){
                  const original=observed.filter(value=>value.token===instance.token);
                  if(original.length===1)originalPost=compactManualState(original[0].original);
                  else if(!original.length&&progress.complete===true)originalPost={kind:'missing'};
                }
              }
              const before=previous.private.manualState?.before||{kind:'unknown'},proof={v:2,before,post,originalPost,successorId:event.id,beforeReady};
              if(event.role!=='login-manual'&&beforeReady==='ready'&&!manualStateUsable(previous,event,proof)){
                publishFeedback(learningFailureText('unsupported-login-sequence'),payload.role);
                record.loginSequenceUnsupported=true;await persist();
                return {ok:false,code:'unsupported-login-sequence',message:learningFailureText('unsupported-login-sequence')};
              }
              pendingManualProof=proof;
            }
            if(!['login-manual','login-success'].includes(event.role)){
              for(let index=record.events.length-2;index>=0&&record.events[index+1].role==='login-manual'&&record.events[index].role==='login-manual';index--){
                const item=record.events[index],next=record.events[index+1],proof=item.private.manualState;
                if(proof?.beforeReady==='ready'&&!manualStateUsable(item,next,proof)){
                  publishFeedback(learningFailureText('unsupported-login-sequence'),payload.role);
                  record.loginSequenceUnsupported=true;await persist();
                  return {ok:false,code:'unsupported-login-sequence',message:learningFailureText('unsupported-login-sequence')};
                }
              }
            }
            if(pendingManualProof){previous.private.manualState=pendingManualProof;delete record.loginSequenceUnsupported;}
            if(event.role==='login-manual'){
              event.private.manualState={v:2,before:compactManualState(payload.manualBefore)};
              const instance=payload.manualInstance,source=frames.get(instance?.token);
              if(source?.page===target&&source.identity===context.identity&&source.origin===context.origin&&Number.isSafeInteger(instance.sequence)&&instance.sequence>0)manualInstances.set(event.id,{token:instance.token,sequence:instance.sequence});
            }
            if(payload.role==='login-success')delete record.loginSequenceUnsupported;
            if(navigation)navigation.accepted=true;
            loginFeedbackRole=undefined;feedbackMessage=undefined;
            manualReady=undefined;
            if(payload.role==='login-manual'){
              const known=new Map(),structural=new Map();
              for(const item of payload.manualReady?.observed||[]){
                const observed=frames.get(item?.key);
                if(observed?.page===target&&observed.origin===context.origin&&origins.includes(observed.origin)&&Array.isArray(item.controls)&&item.controls.every(value=>typeof value?.selector==='string'&&value.selector.length<=4096&&['login-identifier','login-password'].includes(value.role)&&['text','email','tel','password'].includes(value.type)))known.set(observed.identity+':'+observed.origin,new Set(item.controls.map(value=>JSON.stringify([value.selector,value.role,value.type]))));
                if(observed?.page===target&&origins.includes(observed.origin)&&item.structural?.complete===true&&Array.isArray(item.structural.controls)&&item.structural.controls.every(value=>typeof value?.selector==='string'&&value.selector.length<=4096&&['login-manual','login-navigation'].includes(value.role)&&['input','select','button','a','text'].includes(value.tag)&&typeof value.type==='string'&&/^[a-z-]{0,32}$/.test(value.type)))structural.set(observed.identity+':'+observed.origin,new Set(item.structural.controls.map(value=>JSON.stringify([value.selector,value.role,value.tag,value.type]))));
              }
              manualReady={known,structural,unknown:payload.manualReady?.unknown!==false}; // Unknown contexts are not observed-absent.
            }
            serial++;record.events.push(event);
            await publishManualAnchor();
            await persist();return {ok:true};
          }
        }
        if(record.events.length>=160){record.truncated=true;finished=true;await persist();done();return {ok:false};}
        const origin=context.origin;
        if(!origins.includes(origin))throw new Error('additional-origin-needs-demonstration');
        const local=payload.local;
        if(!local||!['input','select','button','a','text'].includes(local.tag)||typeof local.value!=='string'||local.value.length>10000)throw new Error('unsupported-control');
        if(['from','to'].includes(payload.role)&&(!local.value||local.value.length>32))throw new Error('date-control-unavailable');
        if(payload.role==='account'&&(!local.value||local.value.length>500))throw new Error('account-control-unavailable');
        let format;if(['from','to'].includes(payload.role)){
          if(payload.format!==undefined&&!LEARNING_DATE_PARTS.includes(payload.format))throw new Error('date-control-unavailable');
          format=payload.format||(/^\d{8}$/.test(local.value)?'compact':/^\d{4}\/\d{2}\/\d{2}$/.test(local.value)?'slash':'iso');
          if(!local.date||local.date.format!==format)return {ok:false,message:'日付の欄を確認してください。'};
          // Reassigning a field corrects its prior meaning before evidence is sent.
          record.events=record.events.filter(event=>{
            if(!['from','to'].includes(event.role)||event.document!==context.document||event.frame!==context.id||event.popup!==popup)return true;
            const sameMeaning=event.role===payload.role&&event.format===format;
            return event.private.selector===payload.selector?sameMeaning:!sameMeaning;
          });
        }
        if(payload.role==='export'){
          record.exportPeriod=null;
          const dates=latestDates(record.events),result=await recordedPeriod(dates,context,local.dates),period=result?.period;
          if(result?.unsupported)return {ok:false,message:unsupported};
          if(!period||(demonstrationPeriod&&JSON.stringify(period)!==JSON.stringify(demonstrationPeriod)))return {ok:false,message:'指定した開始日・終了日でCSVを出力して、もう一度操作してください。'};
          record.exportPeriod={afterDate:dates.at(-1).id,period};
          record.events=record.events.filter(event=>event.role!=='export');
          acceptExport?.();
        }
        const id='e'+serial++;if(capture)capture.eventId=id;
        record.events.push({id,document:context.document,frame:context.id,popup,origin,role:payload.role,tag:local.tag,...(format?{format}:{}),private:{selector:payload.selector,value:payload.role==='account'?local.value:undefined,signature:['inquiry','export','logout'].includes(payload.role)?local.signature:undefined,framePath:context.path,...(local.date?{date:local.date}:{}),...(local.form?{form:local.form,submitter:local.submitter}:{})}});
        await persist();return {ok:true};
      }).then(result=>{if(!result.ok)publishFeedback(result.message||'記録できませんでした。',payload.role);else if(payload.role){feedbackMessage=undefined;loginFeedbackRole=undefined;}return result;}).catch(error=>{failure=error;finished=true;done();return {ok:false};});
      return pending;
    });
    let doc=0;
    async function install(frame){
      abortReadiness(frame);
      if(finished)return;
      observeEntryFrame(frame);
      let origin;try{origin=new URL(frame.url()).origin;}catch{return;}
      try{learningOrigin(origin,{test});}catch{return;}
      if(teachLogin){observeLoginSession(frame.client,false,target);const initial=entryFrames.get(frame);if(initial&&!initial.url){initial.url=frame.url();initial.generation=entryGenerations.get(frame)||0;}}
      const path=[];let f=frame;while(f.parentFrame()){path.unshift(f.parentFrame().childFrames().indexOf(f));f=f.parentFrame();}
      const key=randomBytes(16).toString('hex'),identity=popup+':'+path.join('.'),old=[...frames.values()].find(v=>v.identity===identity),id=old?.id||'f'+frames.size;frameInstallations.set(frame,key);
      const context={key,page:target,frame,path,origin,identity,id,document:'d'+doc++};frames.set(key,context);
      for(const observation of observations)bindResult(observation,context);
      // Pinned SDK 23.10.3 skips exposeFunction's wrapper on an already-loaded child frame when its loading flag was missed.
      // Install the SDK's own fixed wrapper in that frame; no reload, cross-origin DOM bridge or generated script is used.
      await frame.client.send('Runtime.addBinding',{name:CDP_BINDING_PREFIX+binding});
      if(!await frame.evaluate(name=>typeof window[name]==='function',binding)){
        await frame.evaluate(addPageBinding,'exposedFun',binding,CDP_BINDING_PREFIX);
      }
      await frame.evaluate(inspectDateControl,null,{installAs:binding+'Date'});
      if(teachLogin){await frame.evaluate(loginControl,null,{installAs:binding+'Login'});await frame.evaluate(manualControlState,null,{installAs:binding+'State'});await frame.evaluate((key,list)=>{window[key]=list;},binding+'Origins',origins);await frame.evaluate((binding,anchor,origin)=>{if(location.origin===origin)window[binding+'ManualAnchor']=anchor;},binding,origins.includes(origin)?manualAnchor():null,origin);}
      // An interstitial can navigate while SDK binding installation awaits.
      // Only the newest observed document may install its overlay/context key.
      if(frameInstallations.get(frame)!==key)return;
      const ownsRender=()=>!finished&&!signal?.aborted&&!target.isClosed()&&!frame.detached&&frameInstallations.get(frame)===key;
      let renderDocument;
      try{
        if(!ownsRender())return;
        // This reference stays local; only the additional render uses it as an atomic Document witness.
        try{const handle=await frame.evaluateHandle(()=>document);renderDocument={handle};renderDocuments.add(renderDocument);}catch{}
        if(!ownsRender())return;
        const config={binding,key,popup,origin,allowed:origins.includes(origin),teachLogin,feedbackMessage,terminalFeedback:record.loginRedirectUnsupported===true,submitUnsupported:LOGIN_SUBMIT_UNSUPPORTED,manualSuccessorMessage:MANUAL_CREDENTIAL_SUCCESSOR};
        let outcome,contextLost=false;
        try{outcome=await frame.evaluate(overlay,config);}
        catch(error){
          if(!ownsRender())return;
          contextLost=/Execution context was destroyed|Cannot find context/.test(error?.message||'');
        }
        if((outcome==='__OMF_LEARNING_ROOT_PENDING__'||contextLost)&&renderDocument&&ownsRender()){
          const wait={frame,controller:new AbortController()};readinessWaits.add(wait);
          try{
            if(!ownsRender()||wait.controller.signal.aborted)return;
            const handle=await frame.waitForFunction(originalDocument=>originalDocument===document&&!!document.documentElement,{polling:'mutation',timeout:0,signal:wait.controller.signal},renderDocument.handle);
            const readyResult={handle};renderDocuments.add(readyResult);await releaseRenderDocument(readyResult);
            if(ownsRender())await frame.evaluate(overlay,config,renderDocument.handle).catch(()=>{});
          }catch{/* Retired/closed readiness is best-effort; the existing recording outcome remains authoritative. */}
          finally{readinessWaits.delete(wait);}
        }
      }finally{await releaseRenderDocument(renderDocument);}
      if(!ownsRender())return;
      if(feedbackMessage)await frame.evaluate((binding,message,terminal)=>window[binding+'Feedback']?.(message,true,terminal),binding,feedbackMessage,record.loginRedirectUnsupported===true).catch(()=>{});
    }
    const onFrame=frame=>{observeEntryFrame(frame);const within=entryWithin.has(frame);entryWithin.delete(frame);const generation=(entryGenerations.get(frame)||0)+(within?0:1);entryGenerations.set(frame,generation);const intent=entryRequested.get(frame._id);entryRequested.delete(frame._id);if(intent)entryReached.set(frame,{generation,intent});else{entryReached.delete(frame);if(within)entryFrames.delete(frame);}if(!within){entryInteracted.delete(frame);entryScheduled.delete(frame);void install(frame).catch(recordingError);}};
    target.on('framenavigated',onFrame);target.on('frameattached',frame=>{void install(frame).catch(recordingError);});
    for(const frame of target.frames())await install(frame).catch(recordingError);
  }
  // A native popup may finish its redirect chain before targetcreated/page() resolves.
  // Observe the pinned SDK's existing page session before its normal resume; never
  // attach another session or change request, attachment, or debugger ownership.
  const manager=teachLogin?browser._targetManager():null;
  function observeLoginSession(session,early=false,ownerPage){
    if(!session)return;const existing=loginSessions.get(session);if(existing){if(ownerPage)existing.page=ownerPage;return;}
    const state={frames:new Map(),reasons:new Map(),overflow:false,early,page:ownerPage};loginSessions.set(session,state);
    const requested=event=>{
      if(finished)return;
      const form=['formSubmissionGet','formSubmissionPost'].includes(event.reason);let origin;try{origin=new URL(event.url).origin;}catch{}
      if(form||state.reasons.has(event.frameId)){if(!state.reasons.has(event.frameId)&&state.reasons.size>=32)state.overflow=true;else state.reasons.set(event.frameId,{form,origin});}
      const intent=state.page&&entryPending.get(state.page);if(intent){entryPending.delete(state.page);entryRequested.set(event.frameId,intent);}else{const frame=state.page?.frames().find(f=>f._id===event.frameId);if(frame&&['scriptInitiated','metaTagRefresh'].includes(event.reason)&&entryOwned(frame)&&!entryInteracted.has(frame))entryRequested.set(event.frameId,{accepted:true,automatic:true});} // exit:automatic-entry-navigation
    };
    // The pinned SDK awaits its frame-tree promise before relaying this protocol
    // event as framenavigated. Mark that document before its synchronous relay.
    // The scheduled target is compared only in memory for this owned document;
    // it is never a recorded entry URL, event, log or public/model field.
    const scheduled=event=>{const frame=state.page?.frames().find(f=>f._id===event.frameId);if(frame&&event.reason==='scriptInitiated'&&entryOwned(frame)&&!entryInteracted.has(frame))entryScheduled.set(frame,{url:event.url,generation:entryGenerations.get(frame)||0});};
    const within=event=>{const frame=state.page?.frames().find(f=>f._id===event.frameId);if(!frame)return;entryWithin.add(frame);const plan=entryScheduled.get(frame);entryScheduled.delete(frame);const automatic=event.navigationType==='historyApi'||(event.navigationType==='fragment'&&plan?.url===event.url&&plan.generation===(entryGenerations.get(frame)||0));const intent=entryPending.get(state.page);if(intent){entryPending.delete(state.page);entryRequested.set(event.frameId,intent);}else if(automatic&&entryOwned(frame)&&!entryInteracted.has(frame))entryRequested.set(event.frameId,{accepted:true,automatic:true});}; // exit:automatic-same-document
    const listener=event=>{
      if(finished||record.events.some(e=>e.role==='login-success')||event.type!=='Document')return;
      const previous=state.frames.get(event.frameId),reason=state.reasons.get(event.frameId),same=previous?.requestId===event.requestId;
      // The browser distinguishes form navigation from script/meta navigation.
      // A fresh human native attempt replaces its prior chain; no bank action is retried here.
      if(!same){
        const native=reason?.form,bootstrap=!previous&&state.early&&event.initiator?.type==='other';
        if(!native&&!bootstrap)return;
        if(!previous&&state.frames.size>=32){state.overflow=true;return;}
        state.frames.set(event.frameId,{requestId:event.requestId,origins:reason?.form&&reason.origin?[reason.origin]:[],overflow:false,hops:0});
      }
      const nav=state.frames.get(event.frameId);
      if(++nav.hops>32)nav.overflow=true;
      // Convert immediately to bounded origin categories; no URL, query, header,
      // request body, response body, or credential value is retained.
      for(const value of [event.redirectResponse?.url,event.request.url])if(value){try{const origin=new URL(value).origin;if(!nav.origins.includes(origin)){if(nav.origins.length<8)nav.origins.push(origin);else nav.overflow=true;}}catch{nav.overflow=true;}}
    };
    session.on('Network.requestWillBeSent',listener);session.on('Page.frameRequestedNavigation',requested);session.on('Page.navigatedWithinDocument',within);session.on('Page.frameScheduledNavigation',scheduled);loginListeners.push([session,listener,requested,within,scheduled]);
    if(early)void session.send('Network.enable').catch(recordingError);
  }
  const observeLoginTarget=target=>{
    if(target.type()==='page')observeLoginSession(target._session(),true);
  };
  manager?.on('targetAvailable',observeLoginTarget);
  const listener=target=>{if(target.type()==='page')void target.page().then(next=>next&&attach(next)).catch(recordingError);};
  browser.on('targetcreated',listener);
  const timer=setTimeout(()=>{failure=new Error('demonstration-timeout');finished=true;done();},timeout);
  const abort=()=>{failure=new Error('demonstration-cancelled');finished=true;done();};signal?.addEventListener('abort',abort,{once:true});
  browser.once('disconnected',abort);
  try{await attach(page);for(const target of await browser.pages())if(target!==page&&/^https?:/.test(target.url()))await attach(target);if(signal?.aborted)abort();await onReady();await completion;await pending;if(failure)throw failure;projectEvidence(record,{test});return record;}
  finally{finished=true;abortReadiness();clearTimeout(timer);manager?.off('targetAvailable',observeLoginTarget);for(const [session,listener,requested,within,scheduled]of loginListeners){session.off('Network.requestWillBeSent',listener);session.off('Page.frameRequestedNavigation',requested);session.off('Page.navigatedWithinDocument',within);session.off('Page.frameScheduledNavigation',scheduled);}signal?.removeEventListener('abort',abort);browser.off('disconnected',abort);browser.off('targetcreated',listener);for(const [target,request,response]of requestListeners){target.off('request',request);target.off('response',response);}await Promise.allSettled([...renderDocuments].map(releaseRenderDocument));}
}

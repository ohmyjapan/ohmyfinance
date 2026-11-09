import {randomBytes} from 'node:crypto';
import {addPageBinding,CDP_BINDING_PREFIX} from 'rebrowser-puppeteer-core/internal/cdp/utils.js';
import {LEARNING_RUNTIME,LEARNING_ROLES,validateEvidence,learningOrigin} from '../shared/finance-bank-learning.mjs';

// Installed only for an explicitly attended demonstration, after the person chooses to start.
// Selectors and values returned by the browser binding are PRIVATE; projectEvidence never copies them.
export function projectEvidence(record, options={}) {
  const evidence={schema:1,runtime:LEARNING_RUNTIME,origins:[...new Set([...(record.origins||[]),...record.events.map(e=>e.origin)])],events:record.events.map(({id,document,frame,popup,origin,role,tag,format})=>({id,document,frame,popup,origin,role,tag,...(format?{format}:{})})),complete:record.complete===true,truncated:record.truncated===true};
  return validateEvidence(evidence,options);
}
function overlay(config) {
  if(document.getElementById('omf-learning-control'))return;
  const panel=document.createElement('div');panel.id='omf-learning-control';
  panel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#111827;color:white;padding:14px;border:1px solid #a78bfa;border-radius:12px;font:14px sans-serif;max-width:390px;box-shadow:0 8px 30px #0008';
  // Parent and child controls must not cover one another when an inquiry opens inside a frame.
  if(window===window.top){panel.style.left='auto';panel.style.right='12px';panel.style.maxWidth='320px';}
  const title=document.createElement('strong');title.textContent='OMF · 銀行の照会手順を記録';
  const text=document.createElement('p');text.textContent='ログインは記録しません。ログイン後、下で操作の種類を選び、銀行の該当箇所を操作してください。残高は箇所をクリックします。送金・支払操作は対象外です。';
  const select=document.createElement('select');select.style.cssText='color:#111;background:white;padding:6px;width:100%';
  for(const [value,label]of [['','一時停止（ログイン・認証はこちら）'],['inquiry','照会画面への移動'],['account','対象口座を選ぶ（表示だけならクリック）'],['from','開始日を入力'],['to','終了日を入力'],['export','CSVを出力'],['balance','残高の表示箇所'],['logout','ログアウト']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
  const finish=document.createElement('button');finish.textContent='記録を完了';finish.style.cssText='margin-top:8px;color:#111;background:white;padding:6px';
  finish.hidden=window!==window.top;
  const status=document.createElement('small');status.style.display='block';status.textContent='パスワード・認証コードはこの記録に含めません。';
  panel.append(title,text,select,finish,status);document.documentElement.append(panel);
  if(!config.allowed){
    select.hidden=true;finish.hidden=true;
    const approve=document.createElement('button');approve.textContent='この銀行の照会サイト（'+location.origin+'）を記録に追加';approve.style.cssText='background:white;color:#111;padding:8px';
    approve.onclick=async()=>{const result=await window[config.binding]({key:config.key,approveOrigin:true});if(result.ok){approve.remove();select.hidden=false;finish.hidden=window!==window.top;}};
    panel.append(approve);
  }
  const selector=element=>{
    const parts=[];let el=element;
    while(el&&el.nodeType===1){const tag=el.localName;const siblings=el.parentElement?[...el.parentElement.children].filter(x=>x.localName===tag):[el];parts.unshift(tag+':nth-of-type('+(siblings.indexOf(el)+1)+')');el=el.parentElement;}
    return parts.join(' > ');
  };
  let sending=false;
  const send=async event=>{
    if(panel.contains(event.target)||!select.value||sending)return;
    let element=event.target.closest('button,a,input,select')||event.target;
    const role=select.value;
    if(['from','to'].includes(role)&&event.type!=='change')return;
    if(role==='account'&&element.matches('select,input')&&event.type!=='change')return;
    if(!['from','to','account'].includes(role)&&event.type!=='click')return;
    if(element.matches('input[type=password],input[type=hidden],[autocomplete*=password],[autocomplete=one-time-code]')){status.textContent='認証情報は記録できません。';return;}
    if(role==='balance'||(role==='account'&&!element.matches('input,select')))element=event.target;
    sending=true;
    const controlPath=url=>{try{const u=new URL(url,location.href);return u.origin+u.pathname;}catch{return '';}};
    const local={tag:element.matches('input,select,button,a')?element.localName:'text',value:element.matches('input,select')?element.value:(element.textContent||'').trim(),signature:JSON.stringify([element.localName,element.getAttribute('type')||'',element.getAttribute('name')||'',(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,1000),element.matches('a')?controlPath(element.href):'',element.form?controlPath(element.form.action):''])};
    try{const result=await window[config.binding]({key:config.key,role,selector:selector(element),local});status.textContent=result.ok?'記録しました':'記録できませんでした';}catch{status.textContent='記録が中断されました';}finally{sending=false;}
  };
  document.addEventListener('click',send,true);document.addEventListener('change',send,true);
  finish.onclick=()=>window[config.binding]({key:config.key,finish:true}).catch(()=>{});
}
export async function recordBankLearning(browser,page,{signal,timeout=20*60000,store,entryOrigin,origins=[entryOrigin],test=false,onReady=()=>{}}={}) {
  const record={origins,events:[],complete:false,truncated:false},pages=new Map(),frames=new Map();let serial=0,finished=false,pending=Promise.resolve(),failure;
  let done;const completion=new Promise(resolve=>{done=resolve;});
  const persist=()=>store?.(record);
  const recordingError=error=>{
    if(finished||/Execution context was destroyed|Cannot find context|detached Frame|Target closed|Session closed/.test(error?.message||''))return;
    failure=new Error('frame-recording-unavailable');finished=true;done();
  };
  async function attach(target){
    if(pages.has(target))return;
    const popup='p'+pages.size,binding='__omfLearn'+randomBytes(8).toString('hex');pages.set(target,{popup,binding});
    await target.exposeFunction(binding,payload=>{
      pending=pending.then(async()=>{
        if(finished)return {ok:false};
        const context=[...frames.values()].find(f=>f.key===payload?.key&&f.page===target);
        if(!context)return {ok:false};
        if(payload.approveOrigin){learningOrigin(context.origin,{test});if(!origins.includes(context.origin)){if(origins.length>=8)throw new Error('too-many-bank-origins');origins.push(context.origin);}await persist();return {ok:true};}
        if(!origins.includes(context.origin))return {ok:false};
        if(payload.finish){record.complete=true;finished=true;await persist();done();return {ok:true};}
        if(!LEARNING_ROLES.includes(payload.role)||typeof payload.selector!=='string'||payload.selector.length>4096)return {ok:false};
        if(record.events.length>=160){record.truncated=true;finished=true;await persist();done();return {ok:false};}
        const origin=context.origin;
        if(!origins.includes(origin))throw new Error('additional-origin-needs-demonstration');
        const local=payload.local;
        if(!local||!['input','select','button','a','text'].includes(local.tag)||typeof local.value!=='string'||local.value.length>10000)throw new Error('unsupported-control');
        if(['from','to'].includes(payload.role)&&(!local.value||local.value.length>32))throw new Error('date-control-unavailable');
        if(payload.role==='account'&&(!local.value||local.value.length>500))throw new Error('account-control-unavailable');
        let format;if(['from','to'].includes(payload.role))format=/^\d{8}$/.test(local.value)?'compact':/^\d{4}\/\d{2}\/\d{2}$/.test(local.value)?'slash':'iso';
        record.events.push({id:'e'+serial++,document:context.document,frame:context.id,popup,origin,role:payload.role,tag:local.tag,...(format?{format}:{}),private:{selector:payload.selector,value:payload.role==='account'?local.value:undefined,signature:['inquiry','export','logout'].includes(payload.role)?local.signature:undefined,framePath:context.path}});
        await persist();return {ok:true};
      }).catch(error=>{failure=error;finished=true;done();return {ok:false};});
      return pending;
    });
    let doc=0;
    async function install(frame){
      if(finished)return;
      let origin;try{origin=new URL(frame.url()).origin;}catch{return;}
      try{learningOrigin(origin,{test});}catch{return;}
      const path=[];let f=frame;while(f.parentFrame()){path.unshift(f.parentFrame().childFrames().indexOf(f));f=f.parentFrame();}
      const key=randomBytes(16).toString('hex'),identity=popup+':'+path.join('.'),old=[...frames.values()].find(v=>v.identity===identity),id=old?.id||'f'+frames.size;
      const context={key,page:target,frame,path,origin,identity,id,document:'d'+doc++};frames.set(key,context);
      // Pinned SDK 23.10.3 skips exposeFunction's wrapper on an already-loaded child frame when its loading flag was missed.
      // Install the SDK's own fixed wrapper in that frame; no reload, cross-origin DOM bridge or generated script is used.
      await frame.client.send('Runtime.addBinding',{name:CDP_BINDING_PREFIX+binding});
      if(!await frame.evaluate(name=>typeof window[name]==='function',binding)){
        await frame.evaluate(addPageBinding,'exposedFun',binding,CDP_BINDING_PREFIX);
      }
      await frame.evaluate(overlay,{binding,key,allowed:origins.includes(origin)}).catch(()=>{});
    }
    const onFrame=frame=>{void install(frame).catch(recordingError);};
    target.on('framenavigated',onFrame);target.on('frameattached',onFrame);
    for(const frame of target.frames())await install(frame);
  }
  const listener=target=>{if(target.type()==='page')void target.page().then(next=>next&&attach(next)).catch(recordingError);};
  browser.on('targetcreated',listener);
  const timer=setTimeout(()=>{failure=new Error('demonstration-timeout');finished=true;done();},timeout);
  const abort=()=>{failure=new Error('demonstration-cancelled');finished=true;done();};signal?.addEventListener('abort',abort,{once:true});
  browser.once('disconnected',abort);
  try{await attach(page);for(const target of await browser.pages())if(target!==page&&/^https?:/.test(target.url()))await attach(target);await onReady();await completion;await pending;if(failure)throw failure;projectEvidence(record,{test});return record;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);browser.off('disconnected',abort);browser.off('targetcreated',listener);}
}

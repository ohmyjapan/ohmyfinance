// Proposed maintained synthetic reader regression; no Chrome/network/model on the default path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialManualReadiness} from '../collector/bank-learning-runner.mjs';
function fixture(name){
 const context={id:'synthetic-context'},available=new Map(),children=new Map(),sessions=new Map(),notes={calls:0,filters:[],mutations:0},browser={_connection:()=>connection,_targetManager:()=>manager},manager={getAvailableTargets:()=>available,getChildTargets:t=>children.get(t)},deferred=(closed=false)=>({resolved:()=>true,value:()=> 'success',finished:()=>closed});let next=0;
 const target=(type,url='')=>{const id='synthetic-'+(++next),info={targetId:id,type,browserContextId:context.id,url},t={_targetId:id,info,ctx:context,_initializedDeferred:deferred(),_isClosedDeferred:deferred(),type:()=>t.info.type,_getTargetInfo:()=>t.info,browser:()=>browser,browserContext:()=>t.ctx,_session:()=>t.primary};available.set(id,t);children.set(t,new Set());return t;};
 const session=(t,parent=null,key='session-'+(++next))=>{const s={key,parent,t,_target:()=>s.t,parentSession:()=>s.parent,connection:()=>connection,id:()=>s.key};sessions.set(key,s);return s;};
 const rootTab=target('tab'),rootTarget=target('page','http://fixture.invalid/'),rootTabSession=session(rootTab),rootPageSession=session(rootTarget,rootTabSession);rootTab.primary=rootTabSession;rootTarget.primary=rootPageSession;children.get(rootTab).add(rootTarget);const root={isClosed:()=>false,browser:()=>browser,browserContext:()=>context,target:()=>rootTarget},pages=[root],wire=[rootTab,rootTarget];let mutate=()=>{};
 const connection={_sessions:sessions,send:async(method,params)=>{assert.equal(method,'Target.getTargets');notes.calls++;notes.filters.push(JSON.stringify(params));const rows=wire.map(t=>({...t.info}));mutate(notes.calls);return{targetInfos:rows};}};
 const readiness=createInitialManualReadiness(browser,root,pages);
 const uiTab=target('tab'),uiChild=target('browser_ui','chrome://synthetic-native-panel/'),tabSession=session(uiTab),primary=session(uiChild,rootTabSession),alternate=session(uiChild,tabSession);uiTab.primary=tabSession;uiChild.primary=primary;children.get(uiTab).add(uiChild);
 const f={notes,readiness,available,children,sessions,uiTab,uiChild,tabSession,primary,alternate,rootTabSession,target,session,wire,setMutation:fn=>{mutate=fn;},inspect:()=>readiness.inspect({popup:'p1',origin:'http://fixture.invalid',role:'login-manual',tag:'button',private:{framePath:[],selector:'#notice',type:'button'}},{origins:['http://fixture.invalid']})};
 if(name==='sdk-only-lone-tab'){available.delete(uiChild._targetId);children.get(uiTab).clear();}
 else if(name==='ordinary-root-no-ui'){available.delete(uiTab._targetId);available.delete(uiChild._targetId);}
 else if(name==='valid-extra-child-binding')session(uiChild,rootTabSession);
 else if(name==='valid-second-native-child'){const extra=target('browser_ui','chrome://another-category-not-allowlisted/');extra.primary=session(extra,tabSession);children.get(uiTab).add(extra);}
 else if(name==='non-ui-sdk-tab'||name==='url-only-page-child'){uiChild.info={...uiChild.info,type:'page',url:name==='url-only-page-child'?'chrome://synthetic-native-panel/':'http://fixture.invalid/'};}
 else if(name==='non-ui-sdk-page'){available.delete(uiTab._targetId);available.delete(uiChild._targetId);target('page','http://fixture.invalid/');}
 else if(name==='type-only-http-child')uiChild.info={...uiChild.info,url:'https://fixture.invalid/'};
 else if(name==='type-only-untrusted-child')uiChild.info={...uiChild.info,url:'chrome-untrusted://synthetic-native-panel/'};
 else if(name==='credential-url-child')uiChild.info={...uiChild.info,url:'chrome://user:synthetic@synthetic-native-panel/'};
 else if(name==='port-url-child')uiChild.info={...uiChild.info,url:'chrome://synthetic-native-panel:1234/'};
 else if(name==='parent-missing')alternate.parent=null;
 else if(name==='parent-wrong')alternate.parent=rootTabSession;
 else if(name==='parent-ambiguous')session(uiChild,tabSession);
 else if(name==='parent-unregistered')sessions.delete(tabSession.id());
 else if(name==='parent-disconnected')tabSession.connection=()=>null;
 else if(name==='partial-child')available.delete(uiChild._targetId);
 else if(name==='closed-child')uiChild._isClosedDeferred=deferred(true);
 else if(name==='closed-tab')uiTab._isClosedDeferred=deferred(true);
 else if(name==='child-context-object')uiChild.ctx={id:context.id};
 else if(name==='child-context-metadata')uiChild.info={...uiChild.info,browserContextId:'different-context'};
 else if(name==='tab-context-metadata')uiTab.info={...uiTab.info,browserContextId:'different-context'};
 else if(name==='child-subtype')uiChild.info={...uiChild.info,subtype:'unproved'};
 else if(name==='tab-subtype')uiTab.info={...uiTab.info,subtype:'unproved'};
 else if(name==='child-map-key'){available.delete(uiChild._targetId);available.set('wrong-key',uiChild);}
 else if(name==='unknown-child'){const t=target('other','chrome://synthetic-native-panel/');t.primary=session(t,tabSession);children.get(uiTab).add(t);}
 else if(name==='partial-child-read')uiChild._getTargetInfo=()=>{throw Error('synthetic-read-miss');};
 else if(name==='returned-unowned-tab')wire.push(uiTab);
 else if(name==='returned-unowned-page-pair'){const tab=target('tab'),p=target('page','http://fixture.invalid/unowned');tab.primary=session(tab);p.primary=session(p,tab.primary);children.get(tab).add(p);wire.push(tab,p);}
 else if(name==='unresolved-latch')readiness.markUnresolved();
 else if(name==='classification-changes')mutate=n=>{if(n===1){uiChild.info={...uiChild.info,url:'chrome://different-native-panel/'};notes.mutations++;}};
 else if(name==='binding-ref-changes')mutate=n=>{if(n===1){sessions.delete(alternate.id());session(uiChild,tabSession,alternate.id());notes.mutations++;}};
 else if(name==='binding-membership-changes')mutate=n=>{if(n===1){session(uiChild,rootTabSession);notes.mutations++;}};
 else if(name==='childset-ref-changes')mutate=n=>{if(n===1){children.set(uiTab,new Set([uiChild]));notes.mutations++;}};
 else if(name==='child-deferred-ref-changes')mutate=n=>{if(n===1){uiChild._isClosedDeferred=deferred();notes.mutations++;}};
 else if(name==='tab-deferred-ref-changes')mutate=n=>{if(n===1){uiTab._initializedDeferred=deferred();notes.mutations++;}};
 else if(name==='second-read-closure')mutate=n=>{if(n===2){uiChild._isClosedDeferred=deferred(true);notes.mutations++;}};
 else assert.ok(['valid-category','ordinary-root-no-ui'].includes(name),name);
 return f;
}
const positives=['valid-category','valid-extra-child-binding','valid-second-native-child','ordinary-root-no-ui'],negatives=['non-ui-sdk-tab','non-ui-sdk-page','url-only-page-child','type-only-http-child','type-only-untrusted-child','credential-url-child','port-url-child','parent-missing','parent-wrong','parent-ambiguous','parent-unregistered','parent-disconnected','partial-child','closed-child','closed-tab','child-context-object','child-context-metadata','tab-context-metadata','child-subtype','tab-subtype','child-map-key','unknown-child','partial-child-read','returned-unowned-tab','returned-unowned-page-pair','unresolved-latch','classification-changes','binding-ref-changes','binding-membership-changes','childset-ref-changes','child-deferred-ref-changes','tab-deferred-ref-changes','second-read-closure'];
for(const name of [...positives,...negatives,'sdk-only-lone-tab'])test('native browser UI absence contract '+name,async()=>{
 const f=fixture(name),expected=positives.includes(name)?'not-ready':'unknown',actual=await f.inspect();
 assert.equal(actual.kind,expected,name);
 for(const filter of f.notes.filters)assert.equal(filter,JSON.stringify({filter:[{type:'page'},{type:'tab'},{exclude:true}]}),'whole page/tab filter retained');
 if(name.endsWith('-changes')||name==='second-read-closure')assert.equal(f.notes.mutations,1,'declared synthetic change applied');
});

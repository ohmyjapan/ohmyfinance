import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import '../collector/puppeteer-frame-init.mjs';
import {createInitialManualReadiness,inspectManualBinding} from '../collector/bank-learning-runner.mjs';
const puppeteer=createRequire(new URL('../collector/package.json',import.meta.url))('rebrowser-puppeteer-core');
// Direct reader/factory contracts. These are not full-replay or universal no-login assertions.
const selector='html:nth-of-type(1) > body:nth-of-type(1) > button:nth-of-type(1)',fullFilter={filter:[{type:'page'},{type:'tab'},{exclude:true}]};
const originCases=['origin-approved-mismatch-root','origin-approved-mismatch-child','origin-post-present','origin-sdk-cdp-disagree','origin-missing-frame','origin-missing-sdk-identity','origin-missing-loader','origin-changed-loader','origin-changed-frame-identity','origin-changed-sdk-origin','origin-changed-root-object','origin-unapproved-current','origin-unapproved-successor','origin-failed-tree','origin-failed-context','origin-multiple-matches','origin-closed-owner'];
const inventoryCases=['inventory-normal-startup','inventory-unused-startup-closed','inventory-order-only-change','inventory-unapproved-successor','inventory-post-missing','inventory-missing-intermediate','inventory-closed-owner','inventory-later-lookalike-blank','inventory-unowned-page','inventory-unresolved-new-tab','inventory-missing-reverse-edge','inventory-same-id-new-target-object','inventory-same-id-new-session-object','inventory-context-object-mismatch','inventory-sdk-context-id-mismatch','inventory-wire-context-mismatch','inventory-wire-context-presence-mismatch','inventory-changed-wire','inventory-failed-wire','inventory-partial-wire','inventory-authoritative-before-sdk','inventory-null-association-gone','inventory-reject-association-gone','inventory-sync-throw-association-gone','inventory-closed-after-await','inventory-mismatched-association-gone','inventory-owner-arrives-first','inventory-owner-arrives-second','inventory-unresolved-existing-hidden','inventory-owner-order-change','inventory-nonpage-worker','inventory-consistent-tab-context-omission'];
const all=[...originCases,...inventoryCases,'inventory-pending-association'];
async function fixture(name){
 const rootDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'omf-f1-contract-')),restore=[],associations=[],releases=[];let posts=0,actions=0;
 const serverA=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('Content-Type','text/html');res.end('<button id="bound" type="button">Fictional notice</button>'+(req.url==='/'?'<iframe src="/child"></iframe>':''));});
 const serverB=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('Content-Type','text/html');res.end('<button id="bound" type="button"'+(req.url==='/hidden'?' hidden':'')+'>Fictional notice</button>');});
 await new Promise(r=>serverA.listen(0,'127.0.0.1',r));await new Promise(r=>serverB.listen(0,'127.0.0.1',r));
 const originA='http://127.0.0.1:'+serverA.address().port,originB='http://127.0.0.1:'+serverB.address().port;
 const f={name,rootDirectory,originA,originB,restore,associations,releases,notes:{},inventoryCalls:0,resolverCalls:0,posts:()=>posts,actions:()=>actions};
 f.patch=(object,key,value)=>{const own=Object.getOwnPropertyDescriptor(object,key);Object.defineProperty(object,key,{value,writable:true,configurable:true});restore.push(()=>{if(own)Object.defineProperty(object,key,own);else delete object[key];});};
 try{
  f.browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(rootDirectory,'profile')});f.root=await f.browser.newPage();await f.root.goto(originA);await f.root.bringToFront();f.child=f.root.frames().find(frame=>frame.parentFrame());await f.child.waitForSelector('#bound');
  f.connection=f.browser._connection();f.manager=f.browser._targetManager();f.rootTarget=f.root.target();f.initialTargets=new Map(f.manager.getAvailableTargets());f.startupBlank=[...f.initialTargets.values()].find(t=>t._getTargetInfo().type==='page'&&t!==f.rootTarget);assert.ok(f.startupBlank);
  f.pages=[f.root];f.makeState=()=>f.state=createInitialManualReadiness(f.browser,f.root,f.pages);f.makeState();f.event={popup:'p1',origin:originB,role:'login-manual',tag:'button',private:{framePath:[],selector,type:''}};
  for(const target of[f.root,...f.root.frames()])for(const key of['click','type','select','press'])if(typeof target[key]==='function'){const original=target[key].bind(target);f.patch(target,key,(...args)=>{actions++;return original(...args);});}
  f.actualSend=f.connection.send.bind(f.connection);f.stubInventory=handler=>f.patch(f.connection,'send',async(method,params,...rest)=>{if(method!=='Target.getTargets')return f.actualSend(method,params,...rest);f.inventoryCalls++;assert.equal(JSON.stringify(params)===JSON.stringify(fullFilter),true,'explicit complete page-tab filter');return handler(f.inventoryCalls,()=>f.actualSend(method,params,...rest));});
  f.stubInventory((count,send)=>send());
  f.inspect=(event=f.event,options={})=>f.state.inspect(event,{origins:[originA,originB],...options});
  f.own=async target=>{try{if(target.type()==='page')await f.state.associate(target,async()=>{f.resolverCalls++;const page=await target.page();if(page)f.pages.push(page);return page;});}catch{f.state.markUnresolved();}};
  f.attach=()=>{if(f.listener)return;f.listener=target=>{const p=f.own(target);associations.push(p);return p;};f.browser.on('targetcreated',f.listener);restore.push(()=>f.browser.off('targetcreated',f.listener));};
  f.closeTarget=async target=>{const tab=target._session()?.parentSession()?._target();await f.actualSend('Target.closeTarget',{targetId:target._targetId});await target._isClosedDeferred.valueOrThrow();if(tab&&tab!==target)await tab._isClosedDeferred.valueOrThrow();};
  f.openUnowned=async value=>{let resolve;const available=new Promise(r=>{resolve=r;}),known=new Set(f.manager.getAvailableTargets().keys()),watch=target=>{if(target._getTargetInfo().type==='page'&&!known.has(target._targetId)){f.manager.off('targetAvailable',watch);resolve(target);}};f.manager.on('targetAvailable',watch);restore.push(()=>f.manager.off('targetAvailable',watch));await f.root.evaluate(url=>{window.open(url,'_blank');},value);return available;};
  f.openOwned=async({hold=false,onDiscovery}={})=>{
   f.attach();let release,resolveTarget,resolvePage,resolvePushed;const gate=new Promise(r=>{release=r;}),seen=new Promise(r=>{resolveTarget=r;}),pageReady=new Promise(r=>{resolvePage=r;}),pushed=new Promise(r=>{resolvePushed=r;});releases.push(release);
   const known=new Set(f.manager.getAvailableTargets().keys());let candidate,actualPage;const watch=target=>{if(target._getTargetInfo().type!=='page'||known.has(target._targetId)||candidate)return;candidate=target;const original=target.page.bind(target);f.patch(target,'page',async()=>{actualPage=await original();resolvePage(actualPage);if(hold)await gate;resolvePushed(actualPage);return actualPage;});resolveTarget(target);};f.manager.on('targetAvailable',watch);restore.push(()=>f.manager.off('targetAvailable',watch));
   let discovery;const discovered=event=>{const info=event.targetInfo;if(info.type==='page'&&info.openerId===f.rootTarget._targetId){f.connection.off('Target.targetCreated',discovered);f.notes.authoritativeBeforeSDKAvailable=!f.manager.getAvailableTargets().has(info.targetId);discovery=onDiscovery?.();}};
   if(onDiscovery){f.connection.on('Target.targetCreated',discovered);restore.push(()=>f.connection.off('Target.targetCreated',discovered));}
   await f.root.evaluate(url=>{window.open(url,'_blank');},originB+'/hidden');const target=await seen,page=await pageReady;
   const settled=async()=>{release();await pushed;await Promise.all(associations);await page.bringToFront();await page.waitForSelector('#bound');};return{target,page,release,settled,discovery:()=>discovery};
  };
  f.finish=async()=>{for(const release of releases)release();await Promise.all(associations);for(const undo of restore.reverse())undo();await f.browser.close();await Promise.all([serverA,serverB].map(server=>new Promise(r=>{server.closeAllConnections();server.close(r);})));
  };
  return f;
 }catch(error){for(const release of releases)release();for(const undo of restore.reverse())try{undo();}catch{}if(f.browser)await f.browser.close();await Promise.all([serverA,serverB].map(server=>new Promise(r=>{server.closeAllConnections();server.close(r);})));throw error;}
}
async function originControl(f,name){
 const frame=f.root.mainFrame(),client=frame.client,originalSend=client.send.bind(client);let treeCalls=0,event={...f.event,popup:'p0'},options={origins:[f.originA,f.originB]},expected='unknown',fault=false;
 const alter=fn=>{fault=true;f.patch(client,'send',async(method,...args)=>{if(method!=='Page.getFrameTree')return originalSend(method,...args);treeCalls++;const value=await originalSend(method,...args);return fn(structuredClone(value),treeCalls);});};
 if(name==='origin-approved-mismatch-root')expected='not-ready';
 else if(name==='origin-approved-mismatch-child'){event={...event,private:{...event.private,framePath:[0]}};expected='not-ready';}
 else if(name==='origin-post-present'){options.post=true;expected='present';}
 else if(name==='origin-sdk-cdp-disagree')alter(value=>{value.frameTree.frame.url=f.originB;return value;});
 else if(name==='origin-missing-frame')alter(value=>{value.frameTree.frame.id='CONTROL-NO-MATCH';return value;});
 else if(name==='origin-missing-sdk-identity'){fault=true;f.patch(frame,'_id',undefined);}
 else if(name==='origin-missing-loader')alter(value=>{delete value.frameTree.frame.loaderId;return value;});
 else if(name==='origin-changed-loader')alter((value,n)=>{if(n===2)value.frameTree.frame.loaderId='CONTROL-CHANGED-LOADER';return value;});
 else if(name==='origin-changed-frame-identity')alter((value,n)=>{if(n===2)value.frameTree.frame.id='CONTROL-CHANGED-FRAME';return value;});
 else if(name==='origin-changed-sdk-origin')alter((value,n)=>{if(n===2){f.patch(frame,'url',()=>f.originB);value.frameTree.frame.url=f.originB;}return value;});
 else if(name==='origin-changed-root-object')alter((value,n)=>{if(n===2)f.patch(f.root,'mainFrame',()=>({childFrames:()=>[],client}));return value;});
 else if(name==='origin-unapproved-current')options.origins=[f.originB];
 else if(name==='origin-unapproved-successor')options.origins=[f.originA];
 else if(name==='origin-failed-tree'){fault=true;f.patch(client,'send',(method,...args)=>{if(method==='Page.getFrameTree')throw Object.assign(Error('CONTROL-UNAVAILABLE'),{name:'ProtocolError'});return originalSend(method,...args);});}
 else if(name==='origin-failed-context'){fault=true;event={...event,origin:f.originA};f.patch(frame,'$$',async()=>{throw Object.assign(Error('CONTROL-UNAVAILABLE'),{name:'ProtocolError'});});}
 else if(name==='origin-multiple-matches'){fault=true;event={...event,origin:f.originA};const lookup=frame.$$.bind(frame);f.patch(frame,'$$',async value=>{const matches=await lookup(value);return [...matches,...await lookup(value)];});}
 else if(name==='origin-closed-owner')await f.root.close();
 else throw Error('unknown-control');
 const actual=await inspectManualBinding(f.root,event,options);return{expected,actual,scope:fault?'actual owned frame plus injected read-boundary fault':'actual owned frame inspection',treeCalls,inspectionActionCalls:f.actions()};
}
async function inventoryControl(f,name){
 let expected='unknown',fault=false,event=f.event,options={},result,extra={};
 const delegateTarget=target=>({_targetId:target._targetId,_getTargetInfo:()=>target._getTargetInfo(),_session:()=>target._session(),type:()=>target.type(),browser:()=>target.browser(),browserContext:()=>target.browserContext(),_initializedDeferred:target._initializedDeferred,_isClosedDeferred:target._isClosedDeferred});
 if(name==='inventory-normal-startup')expected='not-ready';
 else if(name==='inventory-unused-startup-closed'){await f.closeTarget(f.startupBlank);expected='not-ready';extra.closedKnownStartupPair=true;}
 else if(name==='inventory-order-only-change'){fault=true;expected='not-ready';f.stubInventory(async(n,send)=>{const value=await send();if(n===2)value.targetInfos.reverse();return value;});}
 else if(name==='inventory-unapproved-successor')options.origins=[f.originA];
 else if(name==='inventory-post-missing')options.post=true;
 else if(name==='inventory-missing-intermediate'){fault=true;f.pages.push(null);event={...event,popup:'p2'};}
 else if(name==='inventory-closed-owner'){const owned=await f.openOwned();await owned.settled();await f.closeTarget(owned.target);extra.closedSlotRetained=f.pages[1]===owned.page;}
 else if(name==='inventory-later-lookalike-blank'){const target=await f.openUnowned('about:blank');extra.laterBlankEquality=target._getTargetInfo().url==='about:blank';extra.fixtureTargetCreated=true;}
 else if(name==='inventory-unowned-page'){await f.openUnowned(f.originB+'/hidden');extra.fixtureTargetCreated=true;}
 else if(name==='inventory-unresolved-new-tab'){
  fault=true;const target=await f.openUnowned(f.originB+'/hidden'),tab=target._session().parentSession()._target(),available=f.manager.getAvailableTargets.bind(f.manager);f.patch(f.manager,'getAvailableTargets',()=>{const map=new Map(available());map.delete(target._targetId);return map;});f.stubInventory(async(n,send)=>{const value=await send();value.targetInfos=value.targetInfos.filter(row=>row.targetId!==target._targetId);return value;});extra.actualNewTabRetained=true;extra.controlledPageOmission=true;extra.fixtureTargetCreated=true;assert.equal(tab._getTargetInfo().type,'tab');
 }
 else if(name==='inventory-missing-reverse-edge'){fault=true;const child=f.manager.getChildTargets.bind(f.manager),tab=f.rootTarget._session().parentSession()._target();f.patch(f.manager,'getChildTargets',target=>{const values=new Set(child(target));if(target===tab)values.delete(f.rootTarget);return values;});}
 else if(name==='inventory-same-id-new-target-object'){fault=true;const available=f.manager.getAvailableTargets.bind(f.manager),replacement=delegateTarget(f.rootTarget);f.stubInventory(async(n,send)=>{const value=await send();if(n===1)f.patch(f.manager,'getAvailableTargets',()=>{const map=new Map(available());map.set(f.rootTarget._targetId,replacement);return map;});return value;});}
 else if(name==='inventory-same-id-new-session-object'){fault=true;const session=f.rootTarget._session(),replacement={_target:()=>session._target(),parentSession:()=>session.parentSession(),connection:()=>session.connection()};f.stubInventory(async(n,send)=>{const value=await send();if(n===1)f.patch(f.rootTarget,'_session',()=>replacement);return value;});}
 else if(name==='inventory-context-object-mismatch'){fault=true;const original=f.root.browserContext.bind(f.root),replacement={id:original().id};f.patch(f.root,'browserContext',()=>replacement);}
 else if(name==='inventory-sdk-context-id-mismatch'){fault=true;f.patch(f.root.browserContext(),'id','CONTROL-CONTEXT-MISMATCH');f.makeState();}
 else if(name==='inventory-wire-context-mismatch'){fault=true;f.stubInventory(async(n,send)=>{const value=await send();value.targetInfos.find(row=>row.targetId===f.rootTarget._targetId).browserContextId='CONTROL-CONTEXT-MISMATCH';return value;});}
 else if(name==='inventory-wire-context-presence-mismatch'){fault=true;f.stubInventory(async(n,send)=>{const value=await send();delete value.targetInfos.find(row=>row.targetId===f.rootTarget._targetId).browserContextId;return value;});}
 else if(name==='inventory-changed-wire'){fault=true;f.stubInventory(async(n,send)=>{const value=await send();if(n===2)value.targetInfos.find(row=>row.targetId===f.rootTarget._targetId).subtype='CONTROL-CHANGED';return value;});}
 else if(name==='inventory-failed-wire'){fault=true;f.stubInventory(async()=>{throw Object.assign(Error('CONTROL-UNAVAILABLE'),{name:'ProtocolError'});});}
 else if(name==='inventory-partial-wire'){fault=true;const tab=f.rootTarget._session().parentSession()._target();f.stubInventory(async(n,send)=>{const value=await send();value.targetInfos=value.targetInfos.filter(row=>row.targetId!==tab._targetId);return value;});}
 else if(name==='inventory-authoritative-before-sdk'){
  const owned=await f.openOwned({hold:true,onDiscovery:()=>f.inspect()});result=await owned.discovery();extra.authoritativeBeforeSDKAvailable=f.notes.authoritativeBeforeSDKAvailable;extra.pendingExistingResolver=true;assert.equal(extra.authoritativeBeforeSDKAvailable,true);await owned.settled();
 }
 else if(name==='inventory-pending-association'){const owned=await f.openOwned({hold:true});result=await f.inspect();extra.pendingOwners=f.pages.length;assert.equal(f.pages.length,1);await owned.settled();const after=await f.inspect();extra.afterAssociationKind=after.kind;extra.appendOrder=f.pages[0]===f.root&&f.pages[1]===owned.page;assert.equal(after.kind,'hidden');}
 else if(['inventory-null-association-gone','inventory-reject-association-gone','inventory-sync-throw-association-gone','inventory-mismatched-association-gone','inventory-unresolved-existing-hidden'].includes(name)){
  fault=true;const target=f.startupBlank;if(name==='inventory-reject-association-gone')f.patch(target,'page',async()=>{throw Error('CONTROL-REJECTED');});else if(name==='inventory-sync-throw-association-gone')f.patch(target,'page',()=>{throw Error('CONTROL-SYNC');});else if(name==='inventory-mismatched-association-gone')f.patch(target,'page',async()=>f.root);else f.patch(target,'page',async()=>null);
  await f.own(target);await f.closeTarget(target);extra.failedAssociationTargetGone=true;extra.failedAssociationKind=name;extra.truthySlotPreserved=name==='inventory-mismatched-association-gone'?f.pages[1]===f.root:undefined;
  if(name==='inventory-mismatched-association-gone'){assert.equal(f.pages.length,2);assert.equal(f.pages[1]===f.root,true,'truthy owner slot identity');event={...event,popup:'p2'};}
  if(name==='inventory-unresolved-existing-hidden'){const owned=await f.openOwned();await owned.settled();expected='hidden';extra.existingOwnerAfterLatch=true;extra.laterMissingKind=(await f.inspect({...event,popup:'p2'})).kind;assert.equal(extra.laterMissingKind,'unknown');}
 }
 else if(name==='inventory-closed-after-await'){const owned=await f.openOwned({hold:true});await f.closeTarget(owned.target);await owned.settled().catch(()=>{});extra.closedTruthySlotRetained=f.pages[1]===owned.page&&owned.page.isClosed();assert.equal(extra.closedTruthySlotRetained,true);event={...event,popup:'p2'};}
 else if(name==='inventory-owner-arrives-first'||name==='inventory-owner-arrives-second'){
  const at=name.endsWith('first')?1:2;expected='hidden';f.stubInventory(async(n,send)=>{if(n===at){const owned=await f.openOwned();await owned.settled();extra.ownerArrivedDuringAwait=true;extra.originalAppendOrder=f.pages[0]===f.root&&f.pages[1]===owned.page;}return send();});
 }
 else if(name==='inventory-owner-order-change'){fault=true;const owned=await f.openOwned();await owned.settled();event={...event,popup:'p2'};f.stubInventory(async(n,send)=>{const value=await send();if(n===1){f.pages[0]=owned.page;f.pages[1]=f.root;}return value;});}
 else if(name==='inventory-nonpage-worker'){expected='not-ready';await f.root.evaluate(async()=>{const worker=new Worker(URL.createObjectURL(new Blob(['postMessage(true)'],{type:'text/javascript'})));window.__fixtureWorker=worker;await new Promise(resolve=>{worker.onmessage=()=>resolve();});});extra.actualWorkerReady=true;}
 else if(name==='inventory-consistent-tab-context-omission'){
  fault=true;expected='not-ready';for(const target of f.manager.getAvailableTargets().values())if(target._getTargetInfo().type==='tab'){const original=target._getTargetInfo.bind(target);f.patch(target,'_getTargetInfo',()=>{const info={...original()};delete info.browserContextId;return info;});}f.makeState();f.stubInventory(async(n,send)=>{const value=await send();for(const row of value.targetInfos)if(row.type==='tab')delete row.browserContextId;return value;});
 }
 else throw Error('unknown-control');
 const actual=result||await f.inspect(event,options);return{expected,actual,scope:fault?'actual SDK plus declared controlled read/association fault':'actual SDK topology/lifecycle contract',existingOwnerResolverCalls:f.resolverCalls,ownedSlots:f.pages.length,inventoryCalls:f.inventoryCalls,inspectionActionCalls:f.actions(),...extra};
}

for(const name of all)test('initial manual readiness contract '+name,async()=>{let f;try{f=await fixture(name);const result=name.startsWith('origin-')?await originControl(f,name):await inventoryControl(f,name);const {actual,...closed}=result;console.log('INITIAL-READINESS '+JSON.stringify({name,...closed,actualKind:actual.kind,actualReady:actual.ready===true,privateHashPresence:!!actual.hash,fixtureRoot:f.rootDirectory,layer:'direct helper contract',notFullReplayProof:true,fixturePOSTs:f.posts()}));assert.equal(actual.kind,result.expected,'direct reader result');assert.equal(f.actions(),0,'inspection action calls');assert.equal(f.posts(),0,'fictional fixture POSTs');}finally{if(f)await f.finish();}});

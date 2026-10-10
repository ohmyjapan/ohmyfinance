import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approveWithOmf,resumeWithOmf,keyService,secureOrigin} from '../omf-authorization.mjs';

test('real loopback callback: state binding, PKCE exchange and cleanup',async()=>{
  let request,callback,exchanges=0;
  const context={action:'batch',installationId:'a'.repeat(32),generation:'b'.repeat(64)};
  const approval=await approveWithOmf({baseUrl:'https://omf.example.invalid',token:'synthetic'},context,{
    call:async(_config,route,{body})=>{
      if(route==='requests'){request=body;callback=body.redirectUri;return{id:'c'.repeat(64),approvalUrl:'https://omf.example.invalid/collector-approval?id='+'c'.repeat(64)};}
      exchanges++;assert.equal(route,'exchange');assert.equal(createHash('sha256').update(body.verifier).digest('base64url'),request.codeChallenge);assert.equal(body.code,'d'.repeat(64));
      return{...context,grant:'e'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()};
    },
    open:async()=>{
      assert.equal((await fetch(callback+'?state=wrong&code='+'d'.repeat(64))).status,400);
      assert.equal((await fetch(callback+'?state='+request.state+'&code='+'d'.repeat(64))).status,200);
    }
  });
  assert.equal(approval.grant,'e'.repeat(64));assert.equal(exchanges,1);
  await assert.rejects(fetch(callback));
});
test('cancel closes a pending callback without exchanging a code',async()=>{
  const control=new AbortController();let callback,exchanges=0;
  await assert.rejects(approveWithOmf({baseUrl:'https://omf.example.invalid'}, {action:'batch'}, {
    signal:control.signal,
    call:async(_config,route,{body})=>{if(route!=='requests')exchanges++;callback=body.redirectUri;return{id:'a'.repeat(64),approvalUrl:'https://omf.example.invalid/collector-approval?id='+'a'.repeat(64)};},
    open:async()=>{control.abort();}
  }));
  assert.equal(exchanges,0);await assert.rejects(fetch(callback));
});
test('approval never navigates to a different origin or accepts insecure customer address',async()=>{
  for(const value of ['http://100.79.23.111:8080','https://user:password@example.invalid','https://omf.example.invalid/path'])assert.throws(()=>secureOrigin(value));
  let opened=false;
  await assert.rejects(approveWithOmf({baseUrl:'https://omf.example.invalid'},{action:'batch'},{call:async()=>({id:'a'.repeat(64),approvalUrl:'https://other.example.invalid/collector-approval?id='+'a'.repeat(64)}),open:async()=>{opened=true;}}));
  assert.equal(opened,false);
});
test('explicit OMF cancellation ends the real callback immediately without key exchange',async()=>{
  let request,exchanges=0;
  await assert.rejects(approveWithOmf({baseUrl:'https://omf.example.invalid'},{action:'batch'},{
    call:async(_config,route,{body})=>{if(route!=='requests')exchanges++;request=body;return{id:'a'.repeat(64),approvalUrl:'https://omf.example.invalid/collector-approval?id='+'a'.repeat(64)};},
    open:async()=>{assert.equal((await fetch(request.redirectUri+'?state='+request.state+'&error=access_denied')).status,200);}
  }),/cancelled/);
  assert.equal(exchanges,0);await assert.rejects(fetch(request.redirectUri));
});
test('Lock cancels even when the system browser launcher does not return',async()=>{
  const control=new AbortController();let callback;
  await assert.rejects(approveWithOmf({baseUrl:'https://omf.example.invalid'},{action:'batch'},{signal:control.signal,
    call:async(_config,_route,{body})=>{callback=body.redirectUri;return{id:'a'.repeat(64),approvalUrl:'https://omf.example.invalid/collector-approval?id='+'a'.repeat(64)};},
    open:()=>{setTimeout(()=>control.abort(),10);return new Promise(()=>{});}
  }),/cancelled/);
  await assert.rejects(fetch(callback));
});

test('background renewal is single-flight, replaces the short grant and never launches approval',async()=>{
  let time=Date.now(),calls=[],renewals=0;
  const context={installationId:'a'.repeat(32),generation:'b'.repeat(64),publicKey:'synthetic'};
  const config={baseUrl:'https://omf.example.invalid',token:'synthetic'};
  const call=async(_config,route,options)=>{
    calls.push({route,grant:options.grant});
    if(route==='session'){assert.equal(options.body.trustToken,'c'.repeat(64));return {...context,action:'resume',grant:'d'.repeat(64),expiresAt:new Date(time+120000).toISOString()};}
    if(route.startsWith('keys/'))return {keyId:'e'.repeat(64),generation:context.generation};
    assert.equal(route,'lock');return {locked:true};
  };
  const approval={...context,grant:'f'.repeat(64),expiresAt:new Date(time+120000).toISOString()};
  const remote=keyService(config,approval,undefined,{call,now:()=>time,renew:async()=>{renewals++;return resumeWithOmf(config,context,'c'.repeat(64),{call});}});
  time+=61000;
  await Promise.all([remote.refresh(),remote.refresh(),remote.get('e'.repeat(64))]);
  assert.equal(renewals,1);assert.equal(calls.some(c=>c.route==='requests'),false);
  assert.equal(calls.find(c=>c.route.startsWith('keys/')).grant,'d'.repeat(64));
  assert.ok(calls.some(c=>c.route==='lock'&&c.grant==='f'.repeat(64)));
  await remote.end();await assert.rejects(remote.get('e'.repeat(64)));
});

test('revocation failure does not fall back to approval, and cancellation revokes an in-flight renewed grant',async()=>{
  let time=Date.now();const context={installationId:'a'.repeat(32),generation:'b'.repeat(64),grant:'c'.repeat(64),expiresAt:new Date(time+10000).toISOString()};
  const denied=keyService({},context,undefined,{now:()=>time,renew:async()=>{throw Object.assign(Error('reconnect'),{status:401});},call:async()=>({})});
  await assert.rejects(denied.refresh(),e=>e.status===401);
  let finish;const revoked=[];
  const remote=keyService({},context,undefined,{now:()=>time,renew:()=>new Promise(resolve=>{finish=resolve;}),call:async(_c,_r,{grant})=>{revoked.push(grant);return {};}});
  const renewal=remote.refresh();await remote.end();
  finish({...context,grant:'d'.repeat(64),expiresAt:new Date(time+120000).toISOString()});
  await assert.rejects(renewal,/cancelled/);
  assert.deepEqual(revoked,['c'.repeat(64),'d'.repeat(64)]);
});

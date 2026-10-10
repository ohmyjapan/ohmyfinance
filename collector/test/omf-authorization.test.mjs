import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approveWithOmf,resumeWithOmf,keyService,secureOrigin,connectWithOmf,acknowledgeWithOmf,cancelConnectWithOmf} from '../omf-authorization.mjs';

// Initial Connect (plan omf-customer-connect-20261010): the real loopback, synthetic OMF transport, no browser, no network.
const ORIGIN='https://omf.example.invalid';
const CAPSULE={v:1,aad:{},wrapped:'x',iv:'y',tag:'z',data:'w'};
const CONNECT={installationId:'a'.repeat(32),generation:'b'.repeat(64),publicKey:'synthetic',trustHash:'c'.repeat(64),pcName:'Synthetic PC'};
const delivered=id=>({id,installationId:CONNECT.installationId,generation:CONNECT.generation,collectorId:'1'.repeat(24),ownerId:'2'.repeat(24),pcName:'Synthetic PC',accounts:[{_id:'3'.repeat(24),primaryCard:'12345',name:'Card',ownerId:'2'.repeat(24)}],capsule:CAPSULE,expiresAt:new Date(Date.now()+60000).toISOString()});

test('initial connect: token-less request, journaled stages, state-bound loopback, PKCE exchange and cleanup',async()=>{
  let request,callback,exchanges=0;const stages=[],id='c'.repeat(64);
  const result=await connectWithOmf({baseUrl:ORIGIN},CONNECT,{
    call:async(config,route,{body,token})=>{
      assert.equal(config.token,undefined);assert.equal(token,undefined);
      if(route==='requests'){request=body;callback=body.redirectUri;assert.equal(body.pcName,'Synthetic PC');assert.equal(body.trustHash,CONNECT.trustHash);assert.equal(body.publicKey,'synthetic');return {id,connectUrl:ORIGIN+'/collector-connect?id='+id,expiresAt:new Date(Date.now()+600000).toISOString()};}
      exchanges++;assert.equal(route,'exchange');assert.equal(body.id,id);assert.equal(createHash('sha256').update(body.verifier).digest('base64url'),request.codeChallenge);assert.equal(body.code,'d'.repeat(64));
      return delivered(id);
    },
    open:async url=>{
      assert.equal(url,ORIGIN+'/collector-connect?id='+id);
      assert.equal((await fetch(callback+'?state=wrong&code='+'d'.repeat(64))).status,400);
      assert.equal((await fetch(callback+'?state='+request.state+'&code=short')).status,400);
      assert.equal((await fetch(callback+'?state='+request.state+'&code='+'d'.repeat(64))).status,200);
    },
    record:async(phase,data)=>{stages.push({phase,...data});}
  });
  assert.equal(result.capsule,CAPSULE);assert.equal(exchanges,1);
  assert.deepEqual(stages.map(s=>s.phase),['created','callback']);
  assert.equal(stages[0].id,id);assert.equal(stages[0].state,request.state);assert.equal(stages[0].port,Number(new URL(callback).port));assert.match(stages[0].verifier,/^[A-Za-z0-9_-]{43}$/);assert.equal(stages[1].code,'d'.repeat(64));
  await assert.rejects(fetch(callback));
});
test('initial connect resumes a journaled code without opening a browser or a port, and retries a lost exchange response',async()=>{
  let exchanges=0,opened=0;const id='e'.repeat(64),verifier='v'.repeat(43);
  const result=await connectWithOmf({baseUrl:ORIGIN},CONNECT,{
    resume:{id,state:'f'.repeat(64),verifier,code:'d'.repeat(64),port:1},
    call:async(_config,route,{body})=>{assert.equal(route,'exchange');exchanges++;if(exchanges===1)throw Object.assign(Error('Synthetic lost response'),{status:503});assert.equal(body.verifier,verifier);assert.equal(body.code,'d'.repeat(64));return delivered(id);},
    open:async()=>{opened++;}
  });
  assert.equal(result.id,id);assert.equal(exchanges,2);assert.equal(opened,0);
  await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{resume:{id,state:'f'.repeat(64),verifier,code:'d'.repeat(64)},call:async()=>{throw Object.assign(Error('denied'),{status:401});}}),/denied/);
});
test('initial connect resumes a created request on its journaled port so the OMF page still returns to the same callback',async()=>{
  const control=new AbortController();let callback,state;const id='a1'.repeat(32);
  await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{signal:control.signal,call:async(_config,_route,{body})=>{callback=body.redirectUri;state=body.state;return {id,connectUrl:ORIGIN+'/collector-connect?id='+id};},open:async()=>{control.abort();}}),/cancelled/);
  let exchanges=0,opened=0;
  const result=await connectWithOmf({baseUrl:ORIGIN},CONNECT,{resume:{id,state,verifier:'v'.repeat(43),port:Number(new URL(callback).port)},call:async(_config,route,{body})=>{assert.equal(route,'exchange');exchanges++;assert.equal(body.id,id);assert.equal(body.code,'d'.repeat(64));return delivered(id);},open:async url=>{opened++;assert.equal(url,ORIGIN+'/collector-connect?id='+id);assert.equal((await fetch(callback+'?state='+state+'&code='+'d'.repeat(64))).status,200);}});
  assert.equal(result.id,id);assert.equal(exchanges,1);assert.equal(opened,1);
});
test('initial connect refuses a connection link on another origin or path, never opens it, and refuses an invalid exchange result',async()=>{
  let opened=false;
  for(const connectUrl of ['https://other.example.invalid/collector-connect?id='+'a'.repeat(64),ORIGIN+'/collector-approval?id='+'a'.repeat(64),ORIGIN+'/collector-connect?id='+'b'.repeat(64)])
    await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{call:async()=>({id:'a'.repeat(64),connectUrl}),open:async()=>{opened=true;}}),/invalid connection link/);
  assert.equal(opened,false);
  const id='a'.repeat(64);
  for(const broken of [{installationId:'z'.repeat(32)},{generation:'z'.repeat(64)},{collectorId:'nope'},{ownerId:''},{accounts:[]},{capsule:null},{expiresAt:new Date(Date.now()-1000).toISOString()},{id:'b'.repeat(64)}])
    await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{resume:{id,state:'s'.repeat(64),verifier:'v'.repeat(43),code:'d'.repeat(64)},call:async()=>({...delivered(id),...broken})}),/invalid connection/);
});
test('initial connect: an OMF-side cancel and Lock end the callback without an exchange',async()=>{
  let request,exchanges=0;const id='a'.repeat(64);
  await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{call:async(_config,route,{body})=>{if(route!=='requests')exchanges++;request=body;return {id,connectUrl:ORIGIN+'/collector-connect?id='+id};},open:async()=>{assert.equal((await fetch(request.redirectUri+'?state='+request.state+'&error=access_denied')).status,200);}}),/cancelled/);
  assert.equal(exchanges,0);await assert.rejects(fetch(request.redirectUri));
  const control=new AbortController();let callback;
  await assert.rejects(connectWithOmf({baseUrl:ORIGIN},CONNECT,{signal:control.signal,call:async(_config,_route,{body})=>{callback=body.redirectUri;return {id,connectUrl:ORIGIN+'/collector-connect?id='+id};},open:()=>{setTimeout(()=>control.abort(),10);return new Promise(()=>{});}}),/cancelled/);
  await assert.rejects(fetch(callback));
});
test('acknowledgement carries the delivered token and retries a lost response; the state-bound cancel is best effort',async()=>{
  let calls=0;const token='omfc_'+'a'.repeat(64);
  const result=await acknowledgeWithOmf({baseUrl:ORIGIN,token},{id:'b'.repeat(64),installationId:CONNECT.installationId,generation:CONNECT.generation,trustToken:'c'.repeat(64)},{call:async(config,route,{token:sent,body})=>{calls++;assert.equal(route,'ack');assert.equal(sent,token);assert.equal(config.token,token);assert.equal(body.trustToken,'c'.repeat(64));if(calls===1)throw Object.assign(Error('Synthetic lost response'),{status:503});return {acknowledged:true};}});
  assert.equal(result.acknowledged,true);assert.equal(calls,2);
  await assert.rejects(acknowledgeWithOmf({baseUrl:ORIGIN,token},{},{call:async()=>{throw Object.assign(Error('denied'),{status:401});}}),/denied/);
  await assert.rejects(acknowledgeWithOmf({baseUrl:ORIGIN,token},{},{call:async()=>({acknowledged:false})}),/did not acknowledge/);
  let cancelled=null;
  await cancelConnectWithOmf({baseUrl:ORIGIN},{id:'b'.repeat(64),state:'c'.repeat(64)},{call:async(_config,route,{body})=>{cancelled={route,body};return {redirectUri:'x'};}});
  assert.deepEqual(cancelled,{route:'requests/'+'b'.repeat(64)+'/cancel',body:{state:'c'.repeat(64)}});
  assert.equal(await cancelConnectWithOmf({baseUrl:ORIGIN},{id:'short',state:'c'.repeat(64)},{call:async()=>{throw Error('must not be called');}}),null);
});

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

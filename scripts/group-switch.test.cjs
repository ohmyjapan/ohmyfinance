const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness,json}=require('./helpers/auth-session.cjs');
const groups=[{id:'group-a',name:'First',role:'owner'},{id:'group-b',name:'Second',role:'member'},{id:'group-c',name:'Third',role:'viewer'}];
const tokens=(h,group,userId='test-user')=>h.tokens(userId,1800,604800,{organizationId:group,role:groups.find(g=>g.id===group)?.role});
const profile=(group,userId='test-user')=>({user:{id:userId,name:'Synthetic'},organizations:groups,currentOrganization:groups.find(g=>g.id===group)});
function logged(){const h=harness();h.store.acceptSession({...profile('group-a'),tokens:tokens(h,'group-a')});return h;}
function normal(h){h.handle(async(url,options)=>{
  if(url==='/api/auth/switch-organization')return json({tokens:tokens(h,JSON.parse(options.body).organizationId)});
  assert.equal(url,'/api/auth/me');const group=JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1],'base64url')).organizationId;return json(profile(group));
});}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
async function until(fn){for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setImmediate(r));}throw Error('Expected request did not start');}

test('group switching replaces tokens and selected group together and survives reload',async()=>{
  const h=logged();normal(h);const oldSession=h.store.sessionId;
  assert.equal(typeof h.store.switchOrganization,'function','The selector must use the session store');
  assert.equal(await h.store.switchOrganization('group-b'),true);
  assert.equal(h.store.currentOrganization.id,'group-b');assert.notEqual(h.store.sessionId,oldSession);
  assert.equal(JSON.parse(Buffer.from(h.store.token.split('.')[1],'base64url')).organizationId,'group-b');
  assert.equal(JSON.parse(Buffer.from(h.store.refreshToken.split('.')[1],'base64url')).organizationId,'group-b');
  assert.equal(h.saved.get('current_organization_id'),'group-b');
  const reload=harness(h.saved);reload.store.initAuth();assert.equal(reload.store.currentOrganization.id,'group-b');assert.equal(reload.store.token,h.store.token);
});

test('denied or unavailable group switches preserve the working session',async()=>{
  for(const status of [403,500,'offline']){
    const h=logged(),before=h.saved.get('ohmyfinance_session');
    h.handle(async()=>{if(status==='offline')throw Error('Synthetic offline');return json({},status);});
    assert.equal(await h.store.switchOrganization('group-b'),false);
    assert.equal(h.saved.get('ohmyfinance_session'),before);assert.equal(h.store.currentOrganization.id,'group-a');assert.equal(h.store.isAuthenticated,true);
  }
});

test('a group switch rejects mismatched user/group tokens and a removed membership profile without replacing the session',async()=>{
  for(const wrong of ['user','group','profile']){
    const h=logged(),before=h.saved.get('ohmyfinance_session');
    h.handle(async url=>url==='/api/auth/switch-organization'
      ?json({tokens:tokens(h,wrong==='group'?'group-c':'group-b',wrong==='user'?'other-user':'test-user')})
      :json({...profile('group-b'),currentOrganization:wrong==='profile'?null:groups[1]}));
    assert.equal(await h.store.switchOrganization('group-b'),false);assert.equal(h.saved.get('ohmyfinance_session'),before);
  }
});

test('a late group switch cannot undo logout or replace a newer login',async()=>{
  for(const replacement of [false,true]){
    const h=logged(),pending=deferred();h.handle(()=>pending.promise);
    const switching=h.store.switchOrganization('group-b');await until(()=>h.requests.length===1);
    h.store.clearSession();if(replacement)h.login('other-user');
    pending.resolve(json({tokens:tokens(h,'group-b')}));assert.equal(await switching,false);
    assert.equal(h.store.isAuthenticated,replacement);if(replacement)assert.equal(h.store.user.id,'other-user');
  }
});

test('latest requested group owns the result even when responses arrive out of order',async()=>{
  const h=logged(),first=deferred();normal(h);
  h.handle(async(url,options)=>{
    if(url==='/api/auth/me')return json(profile('group-c'));
    const id=JSON.parse(options.body).organizationId;return id==='group-b'?first.promise:json({tokens:tokens(h,id)});
  });
  const earlier=h.store.switchOrganization('group-b');await until(()=>h.requests.length===1);
  assert.equal(await h.store.switchOrganization('group-c'),true);first.resolve(json({tokens:tokens(h,'group-b')}));
  assert.equal(await earlier,false);assert.equal(h.store.currentOrganization.id,'group-c');
});

test('an old refresh cannot replace the selected group after a successful switch',async()=>{
  const h=logged(),pending=deferred();h.handle(async(url,options)=>{
    if(url==='/api/auth/refresh')return pending.promise;
    if(url==='/api/auth/switch-organization')return json({tokens:tokens(h,'group-b')});
    return json(profile('group-b'));
  });
  const refresh=h.store.refreshAuthToken();assert.equal(await h.store.switchOrganization('group-b'),true);
  pending.resolve(json({tokens:tokens(h,'group-a')}));assert.equal(await refresh,'unavailable');assert.equal(h.store.currentOrganization.id,'group-b');
});

test('a successful group switch preserves an existing screen lock',async()=>{
  const h=logged();normal(h);const tracker=h.load('composables/useActivityTracker.ts').useActivityTracker();tracker.lock();
  assert.equal(await h.store.switchOrganization('group-b'),true);assert.equal(tracker.isLocked.value,true);
});

test('cross-tab group changes reload cached screens while same-group token refresh does not',async()=>{
  const first=logged(),tab=harness(first.saved);tab.store.initAuth();
  tab.handle(async()=>json(profile('group-a')));
  const deliver=()=>{for(const cb of tab.events.storage)cb({key:'ohmyfinance_session',newValue:first.saved.get('ohmyfinance_session')});};
  first.advance(1000);first.store.acceptSession({...profile('group-a'),tokens:tokens(first,'group-a')});deliver();
  await new Promise(r=>setImmediate(r));assert.equal(tab.reloads.length,0);
  first.store.acceptSession({...profile('group-b'),tokens:tokens(first,'group-b')});deliver();
  assert.equal(tab.reloads.length,1);assert.equal(tab.store.currentOrganization.id,'group-b');
});

test('an unavailable profile handshake preserves the old session after new tokens were issued',async()=>{
  const h=logged(),before=h.saved.get('ohmyfinance_session');
  h.handle(async url=>url==='/api/auth/switch-organization'?json({tokens:tokens(h,'group-b')}):json({},503));
  assert.equal(await h.store.switchOrganization('group-b'),false);assert.equal(h.saved.get('ohmyfinance_session'),before);
});

test('a failed newer choice still cancels an older pending switch',async()=>{
  const h=logged(),pending=deferred();h.handle(async(url,options)=>url==='/api/auth/me'?json(profile('group-b')):JSON.parse(options.body).organizationId==='group-b'?pending.promise:json({},403));
  const older=h.store.switchOrganization('group-b');await until(()=>h.requests.length===1);
  assert.equal(await h.store.switchOrganization('group-c'),false);pending.resolve(json({tokens:tokens(h,'group-b')}));
  assert.equal(await older,false);assert.equal(h.store.currentOrganization.id,'group-a');
});

test('an old profile response cannot overwrite a successful group switch',async()=>{
  const h=harness(logged().saved),pending=deferred();h.store.initAuth();let profiles=0;
  h.handle(async url=>url==='/api/auth/switch-organization'?json({tokens:tokens(h,'group-b')}):++profiles===1?pending.promise:json(profile('group-b')));
  const previous=h.store.ensureSession();await until(()=>h.requests.length===1);
  assert.equal(await h.store.switchOrganization('group-b'),true);pending.resolve(json(profile('group-a')));await previous;
  assert.equal(h.store.currentOrganization.id,'group-b');assert.equal(h.saved.get('current_organization_id'),'group-b');
});

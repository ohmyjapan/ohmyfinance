const assert=require('node:assert/strict');
const {ObjectId}=require('mongodb');
const {harness}=require('./helpers/auth-session.cjs');
const page=require('./helpers/organization-page.cjs');
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));

module.exports=async({db,call,token,other,origin,pass})=>{
  const ledgerBefore=await db.collection('transactions').find({}).toArray();
  const receiptBefore=await db.collection('receipts').find({}).toArray();
  const login=await call('/api/auth/login',{method:'POST',body:{email:'finance-a@example.invalid',password:'Synthetic-password-Only1!'}});
  assert.equal(login.status,200);
  const create=async(name,auth=token)=>{
    const response=await call('/api/organizations',{method:'POST',token:auth,body:{name,type:'business'}});
    assert.equal(response.status,200,JSON.stringify(response));return response.data.organization._id;
  };
  const a=await create('Synthetic group A'),b=await create('Synthetic group B'),foreign=await create('Synthetic foreign group',other);
  const bridge=(url,options)=>fetch(origin+url,options);
  const h=harness();h.handle(bridge);
  const initial=(await call('/api/auth/me',{token:login.data.tokens.accessToken})).data;
  assert.equal(initial.currentOrganization,null);
  h.store.acceptSession({...initial,tokens:login.data.tokens});
  const p=await page({store:h.store,fetch:bridge});
  try{
    assert.equal(h.store.currentOrganization.id,a);assert.equal(p.reloads.length,1);
    await p.state.handleSwitchOrg(b);
    assert.equal(h.store.currentOrganization.id,b);assert.equal(claims(h.store.token).organizationId,b);
    assert.equal(claims(h.store.refreshToken).organizationId,b);assert.equal(p.reloads.length,2);
  }finally{p.close();}
  pass('actual settings component selects and switches groups using server-issued sessions');

  const reloaded=harness(h.saved);reloaded.handle(bridge);reloaded.store.initAuth();
  assert.equal(await reloaded.store.ensureSession(),true);assert.equal(reloaded.store.currentOrganization.id,b);
  assert.equal(await reloaded.store.refreshAuthToken(),'refreshed');assert.equal(claims(reloaded.store.token).organizationId,b);
  const profile=await call('/api/auth/me',{token:reloaded.store.token});assert.equal(profile.data.currentOrganization.id,b);
  pass('reload, server profile and refresh preserve the selected group');

  const before=h.saved.get('ohmyfinance_session');
  assert.equal((await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:foreign}})).status,403);
  assert.equal(await h.store.switchOrganization(foreign),false);assert.equal(h.saved.get('ohmyfinance_session'),before);
  pass('outsiders receive the intended 403 and keep their existing session');

  await db.collection('organizations').updateOne({_id:new ObjectId(a)},{$set:{isActive:false}});
  assert.equal((await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:a}})).status,403);
  assert.equal(await h.store.switchOrganization(a),false);assert.equal(h.saved.get('ohmyfinance_session'),before);
  await db.collection('organizations').updateOne({_id:new ObjectId(a)},{$set:{isActive:true}});
  pass('inactive groups cannot be selected and do not log the user out');

  const userId=new ObjectId(claims(token).userId);
  for(const role of ['owner','admin','member','viewer']){
    await db.collection('organizations').updateOne({_id:new ObjectId(b),'members.userId':userId},{$set:{'members.$.role':role}});
    assert.equal(await h.store.switchOrganization(b),true);
    assert.equal(h.store.currentOrganization.role,role);assert.equal(claims(h.store.token).role,role);
    assert.equal(claims(h.store.refreshToken).role,role);
  }
  pass('all four existing membership roles can select their group with fresh role claims');

  const stable=h.saved.get('ohmyfinance_session');
  h.handle(async(url,options)=>{
    const response=await bridge(url,options);
    if(url==='/api/auth/switch-organization'){
      await db.collection('organizations').updateOne({_id:new ObjectId(a)},{$pull:{members:{userId}}});
    }
    return response;
  });
  assert.equal(await h.store.switchOrganization(a),false);assert.equal(h.saved.get('ohmyfinance_session'),stable);
  h.handle(bridge);
  assert.equal((await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:a}})).status,403);
  pass('membership removal during the profile handshake prevents accepting the new group session');

  assert.equal((await call('/api/auth/switch-organization',{method:'POST',body:{organizationId:b}})).status,401);
  assert.equal((await call('/api/auth/switch-organization',{token})).status,405);
  assert.equal((await call('/api/auth/switch-organization',{method:'POST',token,body:{}})).status,400);
  pass('switch endpoint preserves authentication, method and missing-group responses');
  assert.deepEqual(await db.collection('transactions').find({}).toArray(),ledgerBefore);
  assert.deepEqual(await db.collection('receipts').find({}).toArray(),receiptBefore);
  pass('group switching leaves ledger and receipt data untouched');
};

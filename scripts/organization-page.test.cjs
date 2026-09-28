const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,json}=require('./helpers/auth-session.cjs');
const page=require('./helpers/organization-page.cjs');
const groups=[{id:'group-a',name:'First',role:'owner'},{id:'group-b',name:'Second',role:'viewer'}];
async function setup(selected='group-b',denied=false){
  const h=harness(),requests=[];
  const profile=id=>({user:{id:'test-user'},organizations:groups,currentOrganization:groups.find(g=>g.id===id)||null});
  h.store.acceptSession({...profile(selected),tokens:h.tokens('test-user',1800,604800,{organizationId:selected})});
  const fetch=async(url,options)=>{
    requests.push({url,options});
    if(url==='/api/organizations')return json({success:true,organizations:groups});
    if(url.endsWith('/members'))return json({success:true,members:[]});
    if(url==='/api/auth/switch-organization')return denied?json({},403):json({tokens:h.tokens('test-user',1800,604800,{organizationId:JSON.parse(options.body).organizationId})});
    if(url==='/api/auth/me')return json(profile(JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1],'base64url')).organizationId));
    throw Error('Unexpected request '+url);
  };
  h.handle(fetch);return {h,requests,...await page({store:h.store,fetch})};
}
test('organization page displays the selected session group instead of the first listed group',async()=>{
  const p=await setup();try{assert.equal(p.state.currentOrganization.value.id,'group-b');assert.equal(p.state.canEdit.value,false);assert.equal(p.state.orgForm.value.name,'Second');assert.equal(p.reloads.length,0);}finally{p.close();}
});
test('organization selector changes the real session before reloading cached screens',async()=>{
  const p=await setup();try{await p.state.handleSwitchOrg('group-a');assert.equal(p.h.store.currentOrganization.id,'group-a');assert.equal(p.state.currentOrganization.value.id,'group-a');assert.equal(p.requests.filter(r=>r.url==='/api/auth/switch-organization').length,1);assert.equal(p.reloads.length,1);}finally{p.close();}
});
test('denied selection leaves the displayed and persisted group unchanged without reloading',async()=>{
  const p=await setup('group-b',true);try{const before=p.h.saved.get('ohmyfinance_session');await p.state.handleSwitchOrg('group-a');assert.equal(p.h.saved.get('ohmyfinance_session'),before);assert.equal(p.state.currentOrganization.value.id,'group-b');assert.equal(p.reloads.length,0);assert.equal(p.alerts.length,1);}finally{p.close();}
});
test('first group selection obtains server tokens instead of setting only a local label',async()=>{
  const p=await setup(null);try{assert.equal(p.h.store.currentOrganization.id,'group-a');assert.equal(p.requests.filter(r=>r.url==='/api/auth/switch-organization').length,1);assert.equal(p.reloads.length,1);}finally{p.close();}
});
test('choosing the current group cancels an earlier pending switch to another group',async()=>{
  const p=await setup();try{
    let release,started=false;const pending=new Promise(r=>release=r);
    p.h.handle(async(url,options)=>{
      if(url==='/api/auth/me')return json({user:{id:'test-user'},organizations:groups,currentOrganization:groups[1]});
      const id=JSON.parse(options.body).organizationId;
      if(id==='group-a'){started=true;return pending;}
      return json({tokens:p.h.tokens('test-user',1800,604800,{organizationId:id})});
    });
    const first=p.state.handleSwitchOrg('group-a');
    for(let i=0;i<50&&!started;i++)await new Promise(r=>setImmediate(r));assert.equal(started,true);
    await p.state.handleSwitchOrg('group-b');
    release(json({tokens:p.h.tokens('test-user',1800,604800,{organizationId:'group-a'})}));await first;
    assert.equal(p.h.store.currentOrganization.id,'group-b');assert.equal(p.reloads.length,1);
  }finally{p.close();}
});

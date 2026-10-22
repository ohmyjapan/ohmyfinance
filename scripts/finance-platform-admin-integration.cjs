'use strict';
// Legacy global administration boundary (plan omf-navi-agent-admin-20261022). Actual built native HTTP on an owned loopback app and
// an owned MongoMemoryServer; synthetic users and companies only. No model, provider, mail, bank or production address is reached.
// Group 1 is the cross-company case: the unchanged baseline and the refusal-removal mutant must fail on it before anything else.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_PLATFORM_ADMIN_APP_ROOT||path.join(__dirname,'..'));
const DB='platform_admin_regression',PASSWORD='Synthetic-password-Only1!',CODE='GLOBAL_ADMIN_UNAVAILABLE',ENDPOINT='/api/finance-chat/company-workspace';
const METHODS=['GET','HEAD','POST','PUT','PATCH','DELETE'],pause=ms=>new Promise(r=>setTimeout(r,ms));
// Every synthetic record value a refused response must never carry (names, emails, company and ledger text).
const MARKERS=['PRIVATE_A_OWNER','PRIVATE_A_ADMIN','PRIVATE_A_MEMBER','PRIVATE_COMPANYLESS','PRIVATE_B_OWNER','PRIVATE_B_MEMBER','PRIVATE_A_COMPANY','PRIVATE_B_COMPANY','PRIVATE_A_DESCRIPTION','PRIVATE_B_DESCRIPTION','PRIVATE_A_LEDGER','PRIVATE_B_LEDGER','owner-a@example.invalid','admin-a@example.invalid','member-a@example.invalid','companyless@example.invalid','victim-b-owner@example.invalid','victim-b-member@example.invalid'];
async function main(){
 let mongo,client,child,directory,logs='',groups=0;const cases=new Set(),variants=[];
 const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-platform-admin-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});const uri=mongo.getUri(DB);
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  const start=async()=>{
   child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',GEMINI_API_KEY:'',BASE_URL:origin,OMF_COLLECTOR_PUBLIC_ORIGIN:'',OMF_TRUST_CLOUDFLARE_LOOPBACK:''},stdio:['ignore','pipe','pipe']});
   child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-20000)})}
   for(let i=0;i<150;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,DB,'SETUP owned database');return}}catch(e){if(e?.code==='ERR_ASSERTION')throw e}await pause(200)}
   throw Error('SETUP owned app unavailable: '+logs.slice(-3000));
  };
  const stop=async()=>{if(child){child.kill();await child.closed;child=null}};
  await start();client=await MongoClient.connect(uri);const db=client.db(DB);
  // auth is the whole Authorization header value, so malformed schemes can be sent as they are.
  const call=async(route,auth,method='GET',body,raw)=>{const headers={...(auth?{Authorization:auth}:{})};let payload;if(raw!==undefined){headers['Content-Type']='application/json';payload=raw}else if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body)}
   const r=await fetch(origin+route,{method,headers,...(payload===undefined?{}:{body:payload}),redirect:'manual',signal:AbortSignal.timeout(20000)}),text=await r.text();let data;try{data=JSON.parse(text)}catch{}return{status:r.status,raw:text,data}};
  const ok=async(route,auth,method='GET',body)=>{const r=await call(route,auth,method,body);assert.equal(r.status,200,'platform-admin:positive '+method+' '+route+' '+r.raw.slice(0,300));return r.data};
  const bearer=t=>'Bearer '+t,sign=(payload,options={expiresIn:'10m'},key=secret)=>jwt.sign(payload,key,options);
  // Every stored document of every collection; an empty collection a model creates on load is not a write and is left out.
  const snapshot=async()=>{const out={};for(const n of(await db.listCollections().toArray()).map(c=>c.name).sort()){const docs=await db.collection(n).find().sort({_id:1}).toArray();if(docs.length)out[n]=docs}return JSON.stringify(out)};
  const noLeak=(r,label)=>{for(const m of MARKERS)assert.ok(!r.raw.includes(m),label+' leaked '+m)};
  const refused=(r,expected,label)=>{assert.equal(r.status,expected,label+' status '+r.status);noLeak(r,label);if(expected===403&&r.raw){assert.equal(r.data?.statusCode,403,label);assert.equal(r.data?.data?.code,CODE,'platform-admin:stable-refusal '+label)}};
  const members=async id=>((await db.collection('organizations').findOne({_id:id}))?.members||[]).map(m=>[String(m.userId),m.role]);

  // Synthetic people: five registered through the native API (its limit is five a minute), one stored member of company B.
  const register=async(email,name)=>{const r=await ok('/api/auth/register',null,'POST',{email,password:PASSWORD,name});const user=await db.collection('users').findOne({email});return{id:String(user._id),email,plain:r.tokens.accessToken}};
  const ownerA=await register('owner-a@example.invalid','PRIVATE_A_OWNER'),adminA=await register('admin-a@example.invalid','PRIVATE_A_ADMIN'),memberA=await register('member-a@example.invalid','PRIVATE_A_MEMBER');
  const loner=await register('companyless@example.invalid','PRIVATE_COMPANYLESS'),ownerB=await register('victim-b-owner@example.invalid','PRIVATE_B_OWNER');
  const memberBId=new ObjectId(),now=new Date();await db.collection('users').insertOne({_id:memberBId,email:'victim-b-member@example.invalid',password:'not-a-login',name:'PRIVATE_B_MEMBER',isActive:true,createdAt:now,updatedAt:now});const memberB={id:String(memberBId)};
  const A=new ObjectId(),B=new ObjectId(),member=(u,role)=>({userId:new ObjectId(u.id),role,joinedAt:now});
  await db.collection('organizations').insertMany([
   {_id:A,name:'PRIVATE_A_COMPANY',slug:'platform-admin-a',type:'business',description:'PRIVATE_A_DESCRIPTION',isActive:true,members:[member(ownerA,'owner'),member(adminA,'admin'),member(memberA,'member')],createdAt:now,updatedAt:now},
   {_id:B,name:'PRIVATE_B_COMPANY',slug:'platform-admin-b',type:'business',description:'PRIVATE_B_DESCRIPTION',isActive:true,members:[member(ownerB,'owner'),member(memberB,'member')],createdAt:now,updatedAt:now}]);
  const invoice=(organizationId,marker,n)=>({_id:new ObjectId(),organizationId,invoiceNumber:'INV-PLATFORM-'+n,status:'sent',issueDate:now,dueDate:now,from:{name:marker},to:{name:'Synthetic customer'},items:[{description:marker,quantity:1,unitPrice:100,amount:100}],subtotal:100,taxRate:10,taxAmount:10,total:110,currency:'JPY',createdAt:now,updatedAt:now});
  await db.collection('invoices').insertMany([invoice(A,'PRIVATE_A_LEDGER',1),invoice(B,'PRIVATE_B_LEDGER',2),invoice(B,'PRIVATE_B_LEDGER',3)]);
  await db.collection('transactions').insertMany([{_id:new ObjectId(),organizationId:A,referenceNumber:'PLATFORM_A',productName:'PRIVATE_A_LEDGER',date:now,amount:100,type:'支出',status:'pending',createdAt:now},{_id:new ObjectId(),organizationId:B,referenceNumber:'PLATFORM_B',productName:'PRIVATE_B_LEDGER',date:now,amount:200,type:'支出',status:'pending',createdAt:now}]);
  const companyToken=async(person,id)=>(await ok('/api/auth/switch-organization',bearer(person.plain),'POST',{organizationId:String(id)})).tokens.accessToken;
  ownerA.tokenA=await companyToken(ownerA,A);adminA.tokenA=await companyToken(adminA,A);memberA.tokenA=await companyToken(memberA,A);ownerB.tokenB=await companyToken(ownerB,B);
  // Signed with the owned app's own secret: claims no real user or role can obtain, to show no claim opens the legacy routes.
  const forgedB=sign({userId:ownerA.id,email:ownerA.email,organizationId:String(B),role:'owner',type:'access'});

  // 1. A company A owner cannot add herself to company B, read B or the user list, and B's company Navi stays closed to her.
  const s1=await snapshot();
  let r=await call(`/api/admin/organizations/${B}/members`,bearer(ownerA.tokenA),'POST',{userId:ownerA.id,role:'owner'});
  assert.equal(r.status,403,'platform-admin:cross-company-membership status '+r.status);
  assert.equal(r.data?.data?.code,CODE,'platform-admin:stable-refusal cross-company-membership');noLeak(r,'platform-admin:cross-company-membership');
  assert.deepEqual(await members(B),[[ownerB.id,'owner'],[memberB.id,'member']],'platform-admin:foreign-membership-unchanged');
  for(const[route,who]of[['/api/admin/organizations',ownerA.tokenA],['/api/admin/users',ownerA.tokenA],[`/api/admin/organizations/${B}`,adminA.tokenA],[`/api/admin/users/${ownerB.id}`,adminA.tokenA]])refused(await call(route,bearer(who)),403,'platform-admin:foreign-read '+route.replace(/[a-f0-9]{24}/g,':id'));
  assert.equal(await snapshot(),s1,'platform-admin:cross-company-no-mutation');
  r=await call('/api/auth/switch-organization',bearer(ownerA.plain),'POST',{organizationId:String(B)});assert.notEqual(r.status,200,'platform-admin:no-foreign-switch');assert.equal(r.data?.tokens,undefined,'platform-admin:no-foreign-switch');
  assert.equal((await call(ENDPOINT,bearer(forgedB))).status,403,'platform-admin:foreign-company-navi');
  pass('a company A owner/admin cannot join, read or manage company B through the legacy routes; B company Navi stays forbidden');

  // 2. Every route shape and method, for every actor: 401 without a valid sign-in, otherwise the stable 403; no record, no write.
  const unauth=[['none',null],['basic','Basic '+Buffer.from('owner-a:'+PASSWORD).toString('base64')],['garbage','Bearer not-a-jwt'],['empty-bearer','Bearer '],
   ['wrong-secret',bearer(sign({userId:ownerA.id,email:ownerA.email,organizationId:String(A),role:'admin',type:'access'},{expiresIn:'10m'},crypto.randomBytes(32).toString('hex')))],
   ['expired',bearer(sign({userId:ownerA.id,email:ownerA.email,organizationId:String(A),role:'owner',type:'access',exp:Math.floor(Date.now()/1000)-60},{}))],
   ['refresh',bearer(sign({userId:ownerA.id,email:ownerA.email,organizationId:String(A),role:'owner',type:'refresh'}))],
   ['2fa-pending',bearer(sign({userId:ownerA.id,email:ownerA.email,type:'2fa_pending'}))],['invite',bearer(sign({userId:ownerA.id,email:ownerA.email,role:'admin',type:'invite'}))]];
  const authed=[['companyless',bearer(loner.plain)],['a-member',bearer(memberA.tokenA)],['a-admin',bearer(adminA.tokenA)],['a-owner',bearer(ownerA.tokenA)],['a-owner-no-company',bearer(ownerA.plain)],['b-owner',bearer(ownerB.tokenB)],
   ['claims-platform-admin',bearer(sign({userId:loner.id,email:loner.email,role:'platform_admin',type:'access'}))],['claims-superadmin',bearer(sign({userId:ownerA.id,email:ownerA.email,organizationId:String(A),role:'superadmin'}))],
   ['claims-b-owner',bearer(forgedB)],['claims-system-no-type',bearer(sign({userId:adminA.id,email:adminA.email,role:'system'}))]];
  const shapes=[['/api/admin/users','/api/admin/users',{}],['/api/admin/users/:id',`/api/admin/users/${ownerB.id}`,{name:'PWNED',email:'attacker@example.invalid',isActive:false,role:'admin'}],
   ['/api/admin/organizations','/api/admin/organizations',{name:'Attacker company',type:'business',ownerId:ownerA.id}],['/api/admin/organizations/:id',`/api/admin/organizations/${B}`,{name:'PWNED',isActive:false,settings:{defaultCurrency:'XXX'}}],
   ['/api/admin/organizations/:id/members',`/api/admin/organizations/${B}/members`,{userId:ownerA.id,role:'owner'}]];
  const s2=await snapshot();
  for(const[shape,route,body]of shapes)for(const method of METHODS)for(const[group,list]of[[401,unauth],[403,authed]])for(const[actor,auth]of list){
   const withBody=method!=='GET'&&method!=='HEAD';refused(await call(route,auth,method,withBody?body:undefined),group,`platform-admin:refused ${actor} ${method} ${shape}`);cases.add(`canonical|${actor}|${method}|${shape}`);
  }
  assert.equal(await snapshot(),s2,'platform-admin:matrix-no-mutation');
  pass(`all ${shapes.length} route shapes x ${METHODS.length} methods refuse ${unauth.length} unauthenticated and ${authed.length} signed-in actors (any role claim) without records or writes`);

  // 3. Query, id, body, slash, case and encoding variants: whatever the router does with them, nothing reaches a record or a write.
  const s3=await snapshot(),longId='9'.repeat(600);
  const variantPaths=['/api/admin/users/','/api/admin/organizations/',`/api/admin/users/${ownerB.id}/`,`/api/admin/organizations/${B}/`,`/api/admin/organizations/${B}/members/`,
   '/api/admin/users?page=1&limit=1000&search=example','/api/admin/users?search[$regex]=.*','/api/admin/organizations?limit=-1&page=0&search=company',`/api/admin/organizations/${B}/members?userId=${ownerA.id}`,
   '/api/admin/users/not-an-object-id','/api/admin/users/'+'a'.repeat(24),'/api/admin/users/'+longId,'/api/admin/organizations/%24ne','/api/admin/organizations/..%2F..%2Fusers',`/api/admin/organizations/${'b'.repeat(24)}/members`,
   '//api/admin/users','/api//admin/users','/api/admin//users',`/api/admin/organizations/${B}//members`,'/API/admin/users','/api/ADMIN/users','/api/admin/Users','/api/%61dmin/users','/api/admin/user%73',`/api/admin/organizations/${B}/member%73`];
  for(const route of variantPaths)for(const method of['GET','POST','PATCH','DELETE'])for(const[actor,auth]of[['none',null],['a-owner',bearer(ownerA.tokenA)]]){
   const res=await call(route,auth,method,method==='GET'?undefined:{userId:ownerA.id,role:'owner',email:'attacker@example.invalid'});
   noLeak(res,`platform-admin:variant ${actor} ${method} ${route}`);assert.notEqual(res.data?.success,true,`platform-admin:variant-no-success ${actor} ${method} ${route} ${res.status}`);
   if(res.status===403)assert.equal(res.data?.data?.code,CODE,'platform-admin:stable-refusal variant '+route);
   const shape=route.replace(/[a-f0-9]{24}/g,':id').replace(longId,':long');cases.add(`variant|${actor}|${method}|${shape}`);variants.push({route:shape,method,actor,status:res.status,kind:res.status===401||res.status===403?'refused':(res.raw.trimStart().startsWith('<')?'html-shell':'other')});
  }
  for(const raw of['not json','[]','{"userId":{"$ne":null},"role":"owner"}','{"$set":{"members":[]}}',''])for(const[actor,auth,expected]of[['none',null,401],['a-owner',bearer(ownerA.tokenA),403]]){
   refused(await call(`/api/admin/organizations/${B}/members`,auth,'POST',undefined,raw),expected,'platform-admin:malformed-body '+actor+' '+JSON.stringify(raw));cases.add(`malformed|${actor}|POST|${raw}`);
  }
  r=await call('/api/admin/users',bearer(ownerA.tokenA),'OPTIONS');noLeak(r,'platform-admin:preflight');assert.notEqual(r.data?.success,true,'platform-admin:preflight');cases.add('preflight|a-owner|OPTIONS|/api/admin/users');
  assert.equal(await snapshot(),s3,'platform-admin:variant-no-mutation');
  pass(`${variantPaths.length} path variants x 4 methods x 2 actors, 5 malformed bodies and the CORS preflight reach no record and change nothing`);

  // 4. Repeated and concurrent refused calls have zero durable effect.
  const s4=await snapshot();
  for(let i=0;i<3;i++)refused(await call(`/api/admin/organizations/${B}/members`,bearer(ownerA.tokenA),'POST',{userId:ownerA.id,role:'owner'}),403,'platform-admin:repeat '+i);
  const burstSpecs=[[`/api/admin/organizations/${B}/members`,'POST',{userId:ownerA.id,role:'owner'}],[`/api/admin/users/${ownerB.id}`,'PATCH',{email:'attacker@example.invalid'}],[`/api/admin/organizations/${B}`,'DELETE'],['/api/admin/organizations','POST',{name:'Attacker company',ownerId:ownerA.id}],[`/api/admin/users/${memberB.id}`,'DELETE'],[`/api/admin/organizations/${B}/members`,'PATCH',{userId:ownerB.id,role:'viewer'}]];
  const people=[ownerA.tokenA,adminA.tokenA,memberA.tokenA,loner.plain,ownerB.tokenB,forgedB];
  const burst=await Promise.all(Array.from({length:36},(_,i)=>{const[route,method,body]=burstSpecs[i%burstSpecs.length];return call(route,bearer(people[Math.floor(i/burstSpecs.length)%people.length]),method,body)}));
  burst.forEach((x,i)=>refused(x,403,'platform-admin:concurrent '+i));
  const anonymous=await Promise.all(burstSpecs.flatMap(([route,method,body])=>[call(route,null,method,body),call(route,'Bearer not-a-jwt',method,body)]));anonymous.forEach((x,i)=>refused(x,401,'platform-admin:concurrent-anonymous '+i));
  assert.equal(await snapshot(),s4,'platform-admin:repeat-no-mutation');
  assert.deepEqual(await members(B),[[ownerB.id,'owner'],[memberB.id,'member']],'platform-admin:foreign-membership-unchanged');
  assert.equal((await db.collection('users').findOne({_id:new ObjectId(ownerB.id)})).email,'victim-b-owner@example.invalid','platform-admin:victim-email-unchanged');
  assert.equal(await db.collection('organizations').countDocuments(),2,'platform-admin:no-company-created-or-deleted');
  pass('3 sequential repeats, 36 concurrent signed-in and 12 concurrent anonymous refused calls leave memberships, emails, companies and ledgers unchanged');

  // 5. Native company management is unchanged: own member list, role changes, owner protections, invites, own company and profile.
  const own=`/api/organizations/${A}/members`,role=async u=>(await members(A)).find(([id])=>id===u.id)?.[1];
  let list=await ok(own,bearer(ownerA.tokenA));assert.deepEqual(list.members.map(m=>String(m.userId)).sort(),[ownerA.id,adminA.id,memberA.id].sort(),'platform-admin:native-member-list');
  assert.equal((await call(own,bearer(memberA.tokenA))).status,200,'platform-admin:native-member-read');assert.equal((await call(`/api/organizations/${B}/members`,bearer(ownerA.tokenA))).status,404,'platform-admin:native-foreign-closed');
  await ok(own,bearer(ownerA.tokenA),'PUT',{userId:memberA.id,role:'viewer'});assert.equal(await role(memberA),'viewer','platform-admin:native-owner-role-update');
  await ok(own,bearer(adminA.tokenA),'PUT',{userId:memberA.id,role:'member'});assert.equal(await role(memberA),'member','platform-admin:native-admin-role-update');
  for(const[who,method,body,label]of[[adminA,'PUT',{userId:ownerA.id,role:'member'},'owner-role-protected'],[adminA,'DELETE',{userId:ownerA.id},'owner-removal-protected'],[memberA,'PUT',{userId:adminA.id,role:'viewer'},'member-cannot-change-roles'],[memberA,'DELETE',{userId:adminA.id},'member-cannot-remove']])
   assert.equal((await call(own,bearer(who.tokenA),method,body)).status,403,'platform-admin:native-'+label);
  assert.equal((await call(`/api/organizations/${A}/invites`,bearer(memberA.tokenA),'POST',{email:'new-person@example.invalid',role:'member',sendEmailNotification:false})).status,403,'platform-admin:native-member-cannot-invite');
  await ok(own,bearer(ownerA.tokenA),'DELETE',{userId:memberA.id});assert.equal(await role(memberA),undefined,'platform-admin:native-removal');assert.equal((await call(ENDPOINT,bearer(memberA.tokenA))).status,403,'platform-admin:removed-member-company-navi');
  const invite=await ok(`/api/organizations/${A}/invites`,bearer(adminA.tokenA),'POST',{email:memberA.email,role:'member',sendEmailNotification:false});
  const accepted=await ok('/api/invites/accept',bearer(memberA.plain),'POST',{token:new URL(invite.inviteUrl).searchParams.get('token')});assert.equal(String(accepted.organization.id),String(A),'platform-admin:native-invite-accept');
  assert.equal(await role(memberA),'member','platform-admin:native-invite-membership');memberA.tokenA=accepted.tokens.accessToken;
  await ok(`/api/organizations/${A}`,bearer(ownerA.tokenA),'PATCH',{description:'Synthetic company A updated'});assert.equal((await call(`/api/organizations/${A}`,bearer(memberA.tokenA),'PATCH',{name:'Member rename'})).status,403,'platform-admin:native-member-cannot-update-company');
  const me=await ok('/api/auth/me',bearer(ownerA.tokenA));assert.equal(me.user.email,ownerA.email);assert.deepEqual(me.organizations.map(o=>String(o.id)),[String(A)],'platform-admin:own-companies-only');
  await ok('/api/users/me',bearer(ownerA.tokenA),'PATCH',{name:'Synthetic owner A renamed'});assert.equal((await db.collection('users').findOne({_id:new ObjectId(ownerA.id)})).name,'Synthetic owner A renamed','platform-admin:self-service');
  assert.deepEqual((await ok('/api/organizations',bearer(ownerA.plain))).organizations.map(o=>String(o.id)),[String(A)],'platform-admin:own-company-list');
  for(const t of[ownerA.tokenA,adminA.tokenA,memberA.tokenA,ownerB.tokenB])assert.equal((await call(ENDPOINT,bearer(t))).status,200,'platform-admin:own-company-navi');
  const invoices=await call('/api/invoices',bearer(ownerA.tokenA));assert.equal(invoices.status,200);assert.equal(invoices.data.pagination.total,1,'platform-admin:own-company-read');assert.ok(!invoices.raw.includes('PRIVATE_B_LEDGER'),'platform-admin:own-company-read');
  assert.deepEqual(await members(B),[[ownerB.id,'owner'],[memberB.id,'member']],'platform-admin:foreign-membership-unchanged');
  assert.equal((await db.collection('users').findOne({_id:new ObjectId(ownerB.id)})).name,'PRIVATE_B_OWNER','platform-admin:victim-unchanged');
  pass('native member list, owner/admin role changes, owner protections, invite and removal, company update, self-service and own-company Navi still work; company B intact');

  // 6. Navi keeps the company conversation and no longer offers the legacy page: the catalogue and the built server's real turn.
  const features=await import(pathToFileURL(path.join(__dirname,'../shared/finance-navi-features.mjs')).href);
  const admin=features.naviFeature('admin'),settings=features.naviFeature('organization-settings');
  assert.equal(admin.disposition,'unsupported','platform-admin:catalogue-unsupported');assert.equal(admin.route,null,'platform-admin:catalogue-no-route');assert.equal(features.naviFeatureRoute('admin'),null);assert.equal(features.naviFeatureNavigable(admin),false);
  assert.equal(features.naviFeatureForPath('/admin/users').disposition,'unsupported','platform-admin:catalogue-page-context');assert.ok(admin.reason.includes(settings.label),'platform-admin:catalogue-points-to-company-settings');
  assert.equal(features.naviFeatureRoute('organization-settings'),'/settings/organization','platform-admin:company-settings-route');
  assert.throws(()=>features.validateOwnerNavigation({feature:'admin'}),'platform-admin:owner-link-refused');assert.throws(()=>features.validateCompanyAssistantReply({kind:'unclear',summary:'x',patch:{},quotes:{},navigation:{feature:'admin'}}),'platform-admin:company-link-refused');
  const ownerRealm=features.naviRealmFeatures('owner',[],'admin').find(f=>f.id==='admin');assert.equal(ownerRealm.disposition,'unsupported');assert.deepEqual(ownerRealm.tools,[]);
  const account=(await ok('/api/finance/accounts',bearer(ownerA.plain),'POST',{name:'Synthetic assigned card',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',bearer(ownerA.plain),'POST',{accountIds:[account._id],workspaceEnabled:true}),worker=(route,body={})=>call('/api/finance-chat/worker/'+route,bearer(agent.token),'POST',body);
  assert.equal((await worker('heartbeat')).status,200);const view=await ok(ENDPOINT,bearer(ownerA.tokenA));
  await ok(ENDPOINT,bearer(ownerA.tokenA),'POST',{requestId:crypto.randomUUID(),chatRevision:view.conversation?.revision||0,text:'Where do I add a member?',context:{page:'settings'}});
  const job=(await worker('workspace-claim')).data?.job;assert.ok(job,'platform-admin:company-navi-job');assert.equal(job.context.scope.organizationId,String(A),'platform-admin:company-navi-scope');
  r=await worker('workspace/'+job.id+'/actions',{lease:job.lease,name:'list_navi_features',args:{},slot:1});assert.equal(r.status,200,'platform-admin:company-navi-catalogue '+r.raw.slice(0,200));
  const listed=r.data.result.features,adminView=listed.find(f=>f.id==='admin'),settingsView=listed.find(f=>f.id==='organization-settings');
  assert.equal(adminView.disposition,'unsupported','platform-admin:built-catalogue');assert.equal(adminView.route,null,'platform-admin:built-catalogue');assert.equal(settingsView.route,'/settings/organization');
  r=await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Legacy administration',patch:{},quotes:{},navigation:{feature:'admin'}}});assert.equal(r.status,400,'platform-admin:built-admin-link-refused');
  r=await worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Company members are managed in organization settings.',patch:{},quotes:{},navigation:{feature:'organization-settings'}}});assert.equal(r.status,200,'platform-admin:built-company-settings-link');
  assert.ok(JSON.stringify(await ok(ENDPOINT,bearer(ownerA.tokenA))).includes('organization-settings'),'platform-admin:company-navi-reply');
  pass('own-company Navi turn completes; its catalogue marks legacy admin unsupported with no page and refuses an admin link while company settings stays linkable');

  // 7. A fresh session is refused (403), the same session after sign-out is refused (401), and a deleted account's token gets nothing.
  const login=await ok('/api/auth/login',null,'POST',{email:adminA.email,password:PASSWORD}),session=login.tokens.accessToken;
  const s7=await snapshot();refused(await call('/api/admin/users',bearer(session)),403,'platform-admin:fresh-session');assert.equal(await snapshot(),s7,'platform-admin:session-no-mutation');
  await ok('/api/auth/logout',bearer(session),'POST',{});const s7b=await snapshot();
  refused(await call('/api/admin/users',bearer(session)),401,'platform-admin:revoked-session');refused(await call(`/api/admin/organizations/${B}/members`,bearer(session),'POST',{userId:adminA.id,role:'owner'}),401,'platform-admin:revoked-session');
  const ghost=sign({userId:String(new ObjectId()),email:'deleted@example.invalid',organizationId:String(A),role:'owner',type:'access'});
  refused(await call(`/api/admin/users/${ownerB.id}`,bearer(ghost),'DELETE'),403,'platform-admin:deleted-account');refused(await call('/api/admin/organizations',bearer(ghost),'POST',{name:'Ghost company',ownerId:ownerA.id}),403,'platform-admin:deleted-account');
  assert.equal(await snapshot(),s7b,'platform-admin:revocation-no-mutation');
  pass('fresh sessions get the stable 403, signed-out sessions 401, and a deleted account token changes nothing');

  // 8. Restart the owned app and repeat the boundary case.
  const s8=await snapshot();await stop();await start();
  refused(await call(`/api/admin/organizations/${B}/members`,bearer(ownerA.tokenA),'POST',{userId:ownerA.id,role:'owner'}),403,'platform-admin:after-restart');
  refused(await call('/api/admin/organizations',bearer(adminA.tokenA)),403,'platform-admin:after-restart');refused(await call('/api/admin/users',null),401,'platform-admin:after-restart');
  const afterRestart=await call('/api/admin/users',bearer(session));assert.ok([401,403].includes(afterRestart.status),'platform-admin:revoked-session-after-restart '+afterRestart.status);noLeak(afterRestart,'platform-admin:revoked-session-after-restart');
  assert.equal(await snapshot(),s8,'platform-admin:restart-no-mutation');assert.deepEqual(await members(B),[[ownerB.id,'owner'],[memberB.id,'member']],'platform-admin:foreign-membership-unchanged');
  assert.equal((await call(own,bearer(ownerA.tokenA))).status,200,'platform-admin:native-after-restart');
  pass('after an owned-app restart the boundary still refuses with no writes and native company management still answers');

  const kinds={};for(const v of variants)kinds[v.kind+':'+v.status]=(kinds[v.kind+':'+v.status]||0)+1;
  console.log('SUMMARY '+JSON.stringify({groups,uniqueCases:cases.size,canonical:{shapes:shapes.length,methods:METHODS.length,unauthenticated:unauth.length,signedIn:authed.length},variantOutcomes:kinds,revokedSessionAfterRestart:afterRestart.status,
   variantsNotRefused:[...new Set(variants.filter(v=>v.kind!=='refused').map(v=>v.route))],
   exclusions:['OPTIONS preflight is answered by the CORS middleware before routing (checked for records only)','paths the router does not send to an admin handler are listed in variantsNotRefused; they reached no record or write','sign-out revocation is in-memory and not restart-safe (existing limit); the refusal does not depend on it','legacy admin page rendering in a browser, production records and historical use are outside this owned run']}));
  console.log(groups+' Platform admin groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

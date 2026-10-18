// Native built HTTP, owned synthetic Mongo and optional owned real Chrome. No customer/provider calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_SUPPORT_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 let mongo,client,child,directory,logs='',groups=0;
 const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-support-report-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri('support_report_regression'),server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.closed=new Promise(r=>child.once('exit',r));for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-20000)})}
  let healthy=false;for(let i=0;i<100;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,'support_report_regression');healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'SETUP owned app health: '+logs);
  client=await MongoClient.connect(uri);const db=client.db('support_report_regression');
  const call=async(token,query='',method='GET')=>{const r=await fetch(origin+'/api/support/report'+query,{method,headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(15000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,headers:r.headers,raw,data}};
  const users=[];for(const [i,role] of ['user','admin'].entries()){
   const email='support-'+i+'@example.invalid',r=await fetch(origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-password-Only1!',name:'SYNTHETIC_PRIVATE_NAME'})});assert.equal(r.status,200,'SETUP register');const session=await r.json(),u=await db.collection('users').findOne({email});await db.collection('users').updateOne({_id:u._id},{$set:{role}});users.push({id:u._id,token:session.tokens.accessToken,email});
  }
  const [a,b]=users,agents=db.collection('financechatagents'),collectors=db.collection('financecollectors'),sentinel='SUPPORT_PRIVATE_SENTINEL',now=()=>new Date();
  if(process.env.OMF_SUPPORT_FAILURE==='1'){
   const failure=await call(a.token);assert.equal(failure.status,503,'support:safe-service-status');assert.deepEqual(failure.data,{error:{code:'SUPPORT_UNAVAILABLE'}},'support:safe-service-error');assert.equal(failure.headers.get('cache-control'),'no-store');assert.ok(!logs.includes(sentinel),'support:safe-service-log');pass('injected internal service failure returns only fixed code, no-store and no raw exception log');console.log(groups+' Support report groups passed');return;
  }
  const state=(r,expected,label)=>{assert.equal(r.status,200,'support:endpoint-available');assert.ok(r.data,'support:json-endpoint-available');assert.deepEqual(r.data.connections,expected,'support:'+label);assert.equal(r.headers.get('cache-control'),'no-store','support:no-store');assert.deepEqual(Object.keys(r.data).sort(),['schemaVersion','reference','generatedAt','scope','heartbeatWindowSeconds','connections'].sort(),'support:fixed-schema');assert.equal(r.data.scope,'signed_in_user');assert.equal(r.data.schemaVersion,1);assert.equal(r.data.heartbeatWindowSeconds,65);assert.match(r.data.reference,/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);assert.equal(new Date(r.data.generatedAt).toISOString(),r.data.generatedAt);assert.ok(!r.raw.includes(sentinel)&&!r.raw.includes(String(a.id))&&!r.raw.includes(String(b.id))&&!r.raw.includes('@example.invalid'),'support:private-payload');return r.data};
  const none={assistant:'not_configured',research:'not_configured',collector:'not_configured'},fresh={assistant:'recent_heartbeat',research:'recent_heartbeat',collector:'recent_heartbeat'},stale={assistant:'no_recent_heartbeat',research:'no_recent_heartbeat',collector:'no_recent_heartbeat'};
  state(await call(a.token),none,'empty');pass('actual endpoint, fixed safe schema, empty state and no-store');
  await agents.insertOne({ownerId:b.id,enabled:true,workspaceEnabled:true,researchEnabled:true,chatLastSeenAt:now(),lastSeenAt:now(),tokenHash:sentinel+'B',researchStatus:{error:sentinel,settingsUrl:'file:///'+sentinel}});
  await collectors.insertOne({ownerId:b.id,lastSeenAt:now(),name:sentinel,tokenHash:sentinel+'B'});
  state(await call(a.token,'?ownerId='+b.id+'&organizationId='+b.id),none,'owner-scope');state(await call(b.token),fresh,'other-user');pass('foreign worker metadata excluded, query overrides ignored, ordinary admin receives no cross-user access');
  const aa=(await agents.insertOne({ownerId:a.id,enabled:true,workspaceEnabled:true,researchEnabled:true,chatLastSeenAt:now(),lastSeenAt:now(),tokenHash:sentinel+'A',researchStatus:{error:sentinel,settingsUrl:sentinel}})).insertedId;
  const ac=(await collectors.insertOne({ownerId:a.id,lastSeenAt:now(),name:sentinel,tokenHash:sentinel+'A'})).insertedId;
  const first=state(await call(a.token),fresh,'fresh');assert.notEqual(state(await call(a.token),fresh,'retry').reference,first.reference,'support:opaque-new-reference');
  const old=new Date(Date.now()-120000);await agents.updateOne({_id:aa},{$set:{lastSeenAt:old,chatLastSeenAt:old}});await collectors.updateOne({_id:ac},{$set:{lastSeenAt:old}});state(await call(a.token),stale,'stale');
  await agents.updateOne({_id:aa},{$unset:{lastSeenAt:'',chatLastSeenAt:''}});await collectors.updateOne({_id:ac},{$unset:{lastSeenAt:''}});state(await call(a.token),stale,'missing-heartbeat');
  const future=new Date(Date.now()+3600000);await agents.updateOne({_id:aa},{$set:{lastSeenAt:future,chatLastSeenAt:future}});await collectors.updateOne({_id:ac},{$set:{lastSeenAt:future}});state(await call(a.token),stale,'future-heartbeat');pass('fresh, stale, missing and future signals; each report has new opaque reference');
  await agents.updateOne({_id:aa},{$set:{lastSeenAt:now(),chatLastSeenAt:now(),revokedAt:now()}});await collectors.updateOne({_id:ac},{$set:{lastSeenAt:now(),revokedAt:now()}});state(await call(a.token),none,'revoked');
  await agents.updateOne({_id:aa},{$unset:{revokedAt:''},$set:{enabled:false}});state(await call(a.token),none,'disabled');
  await agents.updateOne({_id:aa},{$set:{enabled:true,workspaceEnabled:false,researchEnabled:true,lastSeenAt:now()}});state(await call(a.token),{...none,research:'recent_heartbeat'},'feature-flags');pass('revocation, disabled workers and per-feature flags respected');
  for(const token of [null,'not-a-token']){const r=await call(token);assert.equal(r.status,401,'support:auth');assert.deepEqual(r.data,{error:{code:'AUTH_REQUIRED'}});assert.equal(r.headers.get('cache-control'),'no-store')}
  const post=await call(a.token,'','POST');assert.equal(post.status,405);assert.deepEqual(post.data,{error:{code:'METHOD_NOT_ALLOWED'}});
  await db.collection('users').deleteOne({_id:b.id});assert.equal((await call(b.token)).status,401,'support:deleted-user');pass('unauthenticated, invalid token, deleted user and non-GET handling');
  // Capture only owned synthetic collections. Confirm report reads never access business collections.
  for(const name of ['transactions','invoices','receipts','auditlogs'])await db.collection(name).insertOne({private:sentinel});
  const snapshot=async()=>JSON.stringify(await Promise.all(['transactions','invoices','receipts','auditlogs','financechatagents','financecollectors'].map(n=>db.collection(n).find().sort({_id:1}).toArray()))),before=await snapshot();
  await db.command({profile:2,slowms:0});for(let i=0;i<8;i++)state(await call(a.token),{...none,research:'recent_heartbeat'},'parallel-before');
  const parallel=await Promise.all(Array.from({length:8},()=>call(a.token)));for(const r of parallel)state(r,{...none,research:'recent_heartbeat'},'parallel');await db.command({profile:0});
  const accesses=await db.collection('system.profile').find({'command.find':{$exists:true}}).toArray();assert.ok(accesses.length>=16,'SETUP database profiler captured report reads');assert.ok(accesses.every(x=>['users','financechatagents','financecollectors'].includes(x.command.find)),'support:metadata-only-reads');assert.equal(await snapshot(),before,'support:no-writes');assert.ok(!logs.includes(sentinel),'support:no-log-content');pass('parallel/retry reports query only user and worker metadata, no financial or worker writes and no seeded secrets in logs');
  if(process.env.OMF_SUPPORT_BROWSER==='1'){await require('./finance-support-report-browser.cjs')({root,origin,pause,email:a.email,token:a.token,pass});}
  console.log(groups+' Support report groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

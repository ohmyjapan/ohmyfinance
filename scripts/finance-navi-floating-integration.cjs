// Owned native HTTP/Mongo and installed Chrome. No model, bank, mail, Slack or production calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(process.env.OMF_FLOATING_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 let directory,mongo,client,child,logs='',groups=0;
 const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-floating-navi-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri('floating_navi_regression'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port;
  const env={...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),ANTHROPIC_API_KEY:'disabled-synthetic-ui-test',OPENAI_API_KEY:'disabled-synthetic-ui-test',SLACK_BOT_TOKEN:'disabled-synthetic-ui-test'};
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('close',r));for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{logs=(logs+v).slice(-12000)});
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,'floating_navi_regression');healthy=true;break}}catch{}await pause(200)}assert.ok(healthy,'floating:owned-health '+logs);
  client=await MongoClient.connect(uri);const db=client.db('floating_navi_regression');
  const call=async(route,token,method='GET',body,raw=false)=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':raw?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{}return{status:r.status,data,text}};
  const ok=async(...args)=>{const r=await call(...args);assert.equal(r.status,200,'floating:native '+args[0]+' '+r.text.slice(0,250));return r.data};
  const email='floating-owner@example.invalid',password='Synthetic-password-Only1!',token=(await ok('/api/auth/register',null,'POST',{email,password,name:'Synthetic Navi user'})).tokens.accessToken;
  const owner=(await db.collection('users').findOne({email}))._id,A=new ObjectId(),B=new ObjectId(),now=new Date();await db.collection('organizations').insertMany([A,B].map((_id,i)=>({_id,name:'Synthetic Navi company '+i,slug:'floating-navi-'+i,isActive:true,members:[{userId:owner,role:'owner',joinedAt:now}]})));
  const account=(await ok('/api/finance/accounts',token,'POST',{name:'Synthetic Amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).account;
  const agent=await ok('/api/finance-chat/agents',token,'POST',{accountIds:[String(account._id)],workspaceEnabled:true});const worker=(route,body={})=>ok('/api/finance-chat/worker/'+route,agent.token,'POST',body);await worker('heartbeat');
  const {HEADERS}=await import('../shared/amex.mjs'),row=['2026/08/01','2026/08/03','Synthetic floating purchase','Test user','12345','1234','',''];
  const csv=Buffer.from([HEADERS,row].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const batch=await ok('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',token,'POST',csv,true);
  const before=await db.collection('transactions').countDocuments();
  const browserLeg=process.env.OMF_FLOATING_FOLD_CASE==='layout'?'./finance-navi-layout-browser.cjs':'./finance-navi-floating-browser.cjs';
  await require(browserLeg)({root,origin,email,password,A:String(A),B:String(B),batchId:batch.id,worker,pause,pass});
  assert.equal(await db.collection('transactions').countDocuments(),before,'floating:no-ledger-write');
  console.log(groups+' Floating Navi groups passed');
 }finally{
  if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();
  if(directory){assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('omf-floating-navi-'));await fsp.rm(directory,{recursive:true,force:true})}
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});

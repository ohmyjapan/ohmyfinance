// Built app, owned ephemeral MongoDB, synthetic users and documents. No model or external service.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
 let mongo,child,client,directory,logs='',checks=0;
 const pass=name=>{checks++;console.log('PASS '+name);};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-intake-'));
  const binary=path.join(path.dirname(root),'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri('navi_intake_regression'),p=await port(),origin='http://127.0.0.1:'+p;
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:crypto.randomBytes(32).toString('hex'),NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(p),NITRO_PORT:String(p)},stdio:['ignore','pipe','pipe']});
  for(const s of [child.stdout,child.stderr])s.on('data',v=>{logs=(logs+v).slice(-12000);});
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}),d=await r.json();if(d.database?.connected){assert.equal(d.database.name,'navi_intake_regression');healthy=true;break;}}catch{}await pause(200);}assert.ok(healthy,'SETUP: isolated app health '+logs);
  client=await MongoClient.connect(uri);const db=client.db('navi_intake_regression');
  const call=async(route,{method='GET',token,body,raw=false}={})=>{const r=await fetch(origin+route,{method,headers:{'Content-Type':raw?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
  const ok=async(route,opts)=>{const r=await call(route,opts);assert.equal(r.status,200,route+' '+JSON.stringify(r.data).slice(0,400));return r.data;};
  const register=async email=>(await ok('/api/auth/register',{method:'POST',body:{email,password:'Synthetic-password-Only1!',name:'Navi intake test'}})).tokens.accessToken;
  const token=await register('navi-intake-a@example.invalid'),other=await register('navi-intake-b@example.invalid');
  const account=(await ok('/api/finance/accounts',{method:'POST',token,body:{name:'Synthetic Navi Amex',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'original@example.invalid',otpMailbox:'forwarded@example.invalid'}})).account;
  const agent=await ok('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],workspaceEnabled:true,researchEnabled:true}});
  const secondAgent=await ok('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],workspaceEnabled:true}});
  const worker=(route,body={},auth=agent.token)=>call('/api/finance-chat/worker/'+route,{method:'POST',token:auth,body});
  assert.equal((await worker('heartbeat')).status,200);
  const record=await ok('/api/finance-intake/records',{method:'POST',token,body:{values:{orderId:'NAVI-READ-01',description:'Synthetic purchase',merchant:'Synthetic merchant',merchantUrl:'https://shop.example.invalid',amount:'1500',currency:'JPY'}}});
  const otherRecord=await ok('/api/finance-intake/records',{method:'POST',token:other,body:{values:{description:'Other owner private purchase'}}});
  const owner=(await db.collection('users').findOne({email:'navi-intake-a@example.invalid'}))._id;
  const counts=async()=>Object.fromEntries(await Promise.all(['financeintakerecords','financeintakebatches','financepayments','transactions','financeentries','financeactionoperations'].map(async n=>[n,await db.collection(n).countDocuments()])));
  const before=await counts();
  const workspace='/api/finance-chat/workspace';
  const ask=async context=>{const view=await ok(workspace,{token});await ok(workspace,{method:'POST',token,body:{requestId:crypto.randomUUID(),chatRevision:view.conversation?.revision||0,text:'이 구매의 저장된 내용과 근거를 확인해 줘.',context}});const r=await worker('workspace-claim');assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.job);return r.data.job;};
  const act=(job,name,args={},auth=agent.token,lease=job.lease)=>worker('workspace/'+job.id+'/actions',{lease,name,args,slot:1},auth);
  const done=job=>worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'저장된 근거를 확인했어요. 아직 저장 작업은 하지 않았어요.',patch:{},quotes:{}}});
  const job=await ask({page:'intake',recordId:record.id});
  assert.equal(job.context.facts.intakeRecord.id,record.id,'navi-intake:owned-context');assert.equal(job.target.recordId,record.id);
  assert.equal(job.tools.filter(t=>/intake/.test(t.name)).length,7);
  assert.equal(job.tools.some(t=>t.name==='create_intake_record'||t.name==='confirm_intake_research'),false);
  let r=await act(job,'get_intake_record');assert.equal(r.status,200);assert.equal(r.data.result.id,record.id);assert.equal(r.data.effect,'read');
  // An unrelated context refresh must not change the record frozen on this turn.
  await db.collection('financeassistants').updateOne({_id:new ObjectId(job.id)},{$set:{'context.facts.intakeRecord':{id:otherRecord.id}}});
  r=await act(job,'get_intake_record');assert.equal(r.status,200);assert.equal(r.data.result.id,record.id,'navi-intake:frozen-target');
  pass('owned intake context and persisted frozen target survive a changed context snapshot');
  await ok('/api/finance-intake/records/'+record.id,{method:'PATCH',token,body:{revision:record.revision,values:{description:'Owner changed after claim'}}});
  r=await act(job,'get_intake_record');assert.equal(r.status,200);assert.equal(r.data.result.values.description,'Owner changed after claim','navi-intake:fresh-read');assert.equal(r.data.result.revision,2);
  const listed=await act(job,'list_intake_records',{search:'changed',limit:1});assert.equal(listed.data.result.records[0].id,record.id);assert.equal(listed.data.result.nativePopulationLimit,5000);
  pass('fresh domain reads see intervening user edits and bounded search reports its population limit');
  assert.equal((await act(job,'get_intake_record',{recordId:otherRecord.id})).status,404,'navi-intake:foreign-owner');
  assert.equal((await act(job,'get_intake_record',{},secondAgent.token)).status,409,'navi-intake:other-agent');
  assert.equal((await act(job,'get_intake_record',{},agent.token,'not-the-lease')).status,409,'navi-intake:lease');
  assert.equal((await act(job,'get_intake_record',{recordId:record.id,ownerId:String(owner)})).status,400);
  assert.equal((await call('/api/finance-intake/records/'+record.id,{token:agent.token})).status,401);
  pass('foreign-owner data, another agent, an invalid lease and injected owner arguments are rejected by the existing boundaries');
  await db.collection('financeintakeresearch').insertOne({ownerId:owner,recordId:new ObjectId(record.id),revision:1,state:'ready',report:{supplier:{legalName:'Synthetic company',invoiceNumber:'T1234567890123'}},registry:null,context:{recordRevision:2,merchantUrl:'https://shop.example.invalid'},sources:[],events:[],history:[],attempts:1});
  r=await act(job,'get_intake_research');assert.equal(r.status,200);assert.equal(r.data.result.research.verified,false,'navi-intake:unverified-number');assert.equal(r.data.result.research.state,'ready');
  assert.equal((await done(job)).status,200);
  pass('research retains ready and unverified meanings rather than claiming an NTA check or save');
  const badView=await ok(workspace,{token});assert.equal((await call(workspace,{method:'POST',token,body:{requestId:crypto.randomUUID(),chatRevision:badView.conversation.revision,text:'Check selected record',context:{page:'intake',recordId:otherRecord.id}}})).status,404,'navi-intake:foreign-context');
  const csv=Buffer.from('注文番号,内容,金額\r\nCSV-NAVI-01,Synthetic sheet purchase,2500\r\n');
  const upload=await ok('/api/finance-intake/files?name=synthetic-navi.csv',{method:'POST',token,body:csv,raw:true});
  const sheetJob=await ask({page:'intake',documentId:upload.document.id,sheet:upload.document.sheetNames[0],headerRow:1});
  assert.equal(sheetJob.target.documentId,upload.document.id);assert.ok(sheetJob.context.facts.intakeSheet.headers.includes('金額'));
  r=await act(sheetJob,'read_intake_sheet');assert.equal(r.status,200);assert.equal(r.data.result.document.id,upload.document.id,'navi-intake:existing-upload');assert.equal(r.data.result.rowCount,1);
  r=await act(sheetJob,'preview_intake_import',{mapping:{orderId:'0',description:'1',amount:'2'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.result.counts.new,1);
  assert.equal((await act(sheetJob,'list_intake_batches')).status,200);assert.equal((await act(sheetJob,'list_intake_templates')).status,200);
  pass('existing upload supplies JSON sheet context and preview without a second upload or import');
  assert.deepEqual(await counts(),before,'navi-intake:no-financial-write');
  assert.equal((await done(sheetJob)).status,200);
  pass('all seven intake tools leave business records and action-write journal counts unchanged');
  console.log(checks+' Navi intake API groups passed');
 }finally{
  if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}
  if(client)await client.close();if(mongo)await mongo.stop();
  if(directory){const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());if(!resolved.startsWith(temp+path.sep))throw Error('Unsafe owned temp cleanup');await fsp.rm(resolved,{recursive:true,force:true});}
 }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});

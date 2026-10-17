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
  const act=(job,name,args={},auth=agent.token,lease=job.lease,slot=1)=>worker('workspace/'+job.id+'/actions',{lease,name,args,slot},auth);
  const done=job=>worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'저장된 근거를 확인했어요. 아직 저장 작업은 하지 않았어요.',patch:{},quotes:{}}});
  const job=await ask({page:'intake',recordId:record.id});
  assert.equal(job.context.facts.intakeRecord.id,record.id,'navi-intake:owned-context');assert.equal(job.target.recordId,record.id);
  assert.equal(job.tools.filter(t=>/intake/.test(t.name)).length,14);
  assert.equal(job.tools.find(t=>t.name==='confirm_intake_research').inputSchema.required.includes('researchRevision'),true);
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
  // Native writes, then simulated lost acknowledgements: restore only the owned journal claim, never its business state.
  const writeJob=await ask({page:'intake',recordId:record.id}),successful=[];let slot=1;
  const write=async(name,args={},useSlot=slot++)=>{const r=await act(writeJob,name,args,agent.token,writeJob.lease,useSlot);assert.equal(r.status,200,name+' '+JSON.stringify(r.data).slice(0,600));successful.push(r.data.receipt);return r.data;};
  const createArgs={values:{orderId:'NAVI-WRITE-01',description:'Synthetic created by Navi',amount:'800',currency:'JPY'},extra:{JAN:'SYNTHETIC'}};
  const duplicateSlot=slot++,concurrent=await Promise.all([act(writeJob,'create_intake_record',createArgs,agent.token,writeJob.lease,duplicateSlot),act(writeJob,'create_intake_record',createArgs,agent.token,writeJob.lease,duplicateSlot)]);
  assert.ok(concurrent.every(r=>r.status===200),JSON.stringify(concurrent));assert.equal(concurrent[0].data.receipt.operationId,concurrent[1].data.receipt.operationId);successful.push(concurrent[0].data.receipt);
  const createdId=concurrent[0].data.receipt.nativeResourceIds.recordId;assert.equal(await db.collection('financeintakerecords').countDocuments({ownerId:owner,'values.orderId':'NAVI-WRITE-01'}),1);
  const edit=await write('patch_intake_record',{recordId:createdId,revision:1,values:{notes:'User confirmed purchase purpose'}});assert.equal(edit.receipt.acceptedRevision,2);
  const saved=(await db.collection('financeactionoperations').findOne({operationId:edit.receipt.operationId}));assert.equal(saved.intakeArgs?.recordId,createdId,'navi-intake:durable-frozen-args');assert.equal(saved.intakeArgs.revision,1);
  const archive=await write('set_intake_archived',{recordId:createdId,revision:2,archived:true});assert.equal(archive.receipt.acceptedRevision,3);assert.equal(archive.result.archived,true);
  assert.equal((await act(writeJob,'patch_intake_record',{recordId:createdId,revision:1,values:{notes:'stale'}},agent.token,writeJob.lease,slot++)).status,409);
  assert.equal((await act(writeJob,'set_intake_archived',{recordId:otherRecord.id,revision:1,archived:true},agent.token,writeJob.lease,slot++)).status,404);
  assert.equal((await act(writeJob,'create_intake_record',{values:{description:'changed payload'}},agent.token,writeJob.lease,duplicateSlot)).status,409);
  assert.equal((await ok('/api/finance-intake/records/'+createdId,{token})).revision,3);
  pass('create/edit/archive use native revisions and ownership, durable args and one write for concurrent identical requests');
  const templateArgs={name:'Navi synthetic mapping',headers:['注文番号','内容','金額'],mapping:{orderId:'0',description:'1',amount:'2'}};
  const template=await write('save_intake_template',templateArgs);assert.equal(template.receipt.state,'done');assert.equal(template.receipt.acceptedRevision,null);
  const importArgs={documentId:upload.document.id,mapping:{orderId:'0',description:'1',amount:'2'},template:{name:'Navi import mapping'}};
  const countsBeforeBad=await counts();assert.equal((await act(writeJob,'apply_intake_import',{...importArgs,template:{name:'   '}},agent.token,writeJob.lease,slot++)).status,400);assert.equal((await counts()).financeintakerecords,countsBeforeBad.financeintakerecords);
  const imported=await write('apply_intake_import',importArgs);assert.equal(imported.receipt.nativeResourceIds.counts.new,1);assert.equal(imported.result.batch.counts.conflicts,0);assert.ok(imported.result.template.id);
  assert.equal(await db.collection('financeintaketemplates').countDocuments({ownerId:owner,name:'Navi import mapping'}),1);
  pass('template/import save actual native results and validate optional template before changing any row');
  await db.collection('financechatagents').updateOne({ownerId:owner,researchEnabled:true},{$set:{lastSeenAt:new Date(),researchStatus:{intakeResearch:true}}});
  const queued=await write('start_intake_research',{revision:2,researchRevision:1,instruction:'Find official company evidence'});assert.equal(queued.receipt.state,'queued');assert.match(queued.receipt.nativeResourceIds.requestId,/^[a-f0-9-]{36}$/);
  const researchId=queued.receipt.nativeResourceIds.researchId;
  await db.collection('financeintakeresearch').updateOne({_id:new ObjectId(researchId)},{$set:{state:'ready',report:{summary:'Synthetic evidence only',supplier:{legalName:'Synthetic legal company',invoiceNumber:'T1234567890123'}},registry:null},$inc:{revision:1}});
  const confirm=await write('confirm_intake_research',{revision:2,researchRevision:3,confirm:true});assert.equal(confirm.receipt.state,'done');assert.equal(confirm.receipt.nativeResourceIds.verified,false);assert.equal(confirm.result.record.revision,3);assert.equal(confirm.result.record.values.supplierName,'Synthetic legal company');assert.equal(confirm.result.research.state,'confirmed');
  // Replace current research via the native UI service, retaining the previous request and confirmation in history.
  await db.collection('financechatagents').updateOne({ownerId:owner,researchEnabled:true},{$set:{lastSeenAt:new Date()}});
  await ok('/api/finance-intake/records/'+record.id+'/research',{method:'POST',token,body:{revision:3,researchRevision:4,requestId:crypto.randomUUID(),instruction:'A later research request'}});
  const rolled=await db.collection('financeintakeresearch').findOne({_id:new ObjectId(researchId)});assert.ok(rolled.history.some(h=>h.requestId===queued.receipt.nativeResourceIds.requestId));
  pass('research queues through native capability checks and confirms only intake company fields without inventing NTA verification');
  // Reject the final batch insert in this owned DB: real rows/template save before the exception reaches journaled().
  const faultUpload=await ok('/api/finance-intake/files?name=synthetic-fault.csv',{method:'POST',token,body:Buffer.from('注文番号,内容,金額\r\nNAVI-FAULT-01,Synthetic partial row,900\r\n'),raw:true});
  const batchCount=await db.collection('financeintakebatches').countDocuments();
  await db.command({collMod:'financeintakebatches',validator:{'operation.operationId':{$exists:false}},validationLevel:'strict',validationAction:'error'});
  try{
   const fault=await act(writeJob,'apply_intake_import',{documentId:faultUpload.document.id,mapping:importArgs.mapping,template:{name:'Synthetic fault template'}},agent.token,writeJob.lease,slot++);
   assert.equal(fault.status,200,JSON.stringify(fault.data));assert.equal(fault.data.receipt.state,'unresolved','navi-intake:immediate-partial-import');assert.equal(fault.data.receipt.nativeResourceIds.partial,true);assert.equal(fault.data.receipt.nativeResourceIds.recordIds.length,1);assert.ok(fault.data.receipt.nativeResourceIds.templateId);
   assert.equal(await db.collection('financeintakebatches').countDocuments(),batchCount);assert.equal(await db.collection('financeintakerecords').countDocuments({ownerId:owner,'values.orderId':'NAVI-FAULT-01'}),1);
  }finally{await db.command({collMod:'financeintakebatches',validator:{}});}
  pass('a real rejected batch insert returns immediate partial-save evidence after native row/template writes');
  const faultRecord=await ok('/api/finance-intake/records',{method:'POST',token,body:{values:{description:'Synthetic interrupted confirmation',merchantUrl:'https://fault.example.invalid'}}});
  await db.collection('financeintakeresearch').insertOne({ownerId:owner,recordId:new ObjectId(faultRecord.id),revision:1,state:'ready',context:{recordRevision:1,merchantUrl:'https://fault.example.invalid'},report:{supplier:{legalName:'Synthetic fault company',invoiceNumber:'T1234567890123'}},registry:null,sources:[],history:[]});
  await db.command({collMod:'financeintakeresearch',validator:{state:{$ne:'confirmed'}},validationLevel:'strict',validationAction:'error'});
  try{
   const fault=await act(writeJob,'confirm_intake_research',{recordId:faultRecord.id,revision:1,researchRevision:1,confirm:true},agent.token,writeJob.lease,slot++);
   assert.equal(fault.status,200,JSON.stringify(fault.data));assert.equal(fault.data.receipt.state,'unresolved','navi-intake:immediate-partial-confirm');assert.equal(fault.data.receipt.nativeResourceIds.recordSaved,true);assert.equal(fault.data.receipt.nativeResourceIds.researchFinalized,false);assert.equal(fault.data.receipt.acceptedRevision,2);
   assert.equal((await ok('/api/finance-intake/records/'+faultRecord.id,{token})).values.supplierName,'Synthetic fault company');
  }finally{await db.command({collMod:'financeintakeresearch',validator:{}});}
  pass('a real rejected research finalization returns immediate record-saved evidence rather than failed-before-save');
  assert.equal((await done(writeJob)).status,200);
  const ops=db.collection('financeactionoperations'),rewind=async operationId=>ops.updateOne({operationId},{$set:{state:'claimed',leaseUntil:new Date(Date.now()-60000)},$unset:{receipt:'',completedAt:'',recoveryOwner:'',safeError:''}});
  const businessSnapshot=async()=>JSON.stringify(await Promise.all(['financeintakerecords','financeintaketemplates','financeintakebatches','financeintakeresearch','transactions','financeentries'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  const snapshot=await businessSnapshot();for(const receipt of successful)await rewind(receipt.operationId);
  const recovered=await ok(workspace,{token}),recoveredActions=recovered.conversation.turns.flatMap(t=>t.actions||[]);
  assert.equal(successful.length,7);for(const receipt of successful){const a=recoveredActions.find(a=>a.operationId===receipt.operationId);assert.equal(a.state,receipt.state,'navi-intake:lost-'+receipt.name);assert.deepEqual(a.nativeResourceIds,receipt.nativeResourceIds);assert.equal(a.acceptedRevision,receipt.acceptedRevision);}
  assert.equal(await businessSnapshot(),snapshot,'navi-intake:no-reexecution-on-recovery');
  pass('all seven lost acknowledgements recover from native markers, including superseded research, with no business rewrite');
  // Import row/template markers without the final batch represent a crash before completion.
  await db.collection('financeintakebatches').deleteOne({_id:new ObjectId(imported.receipt.nativeResourceIds.batchId)});await rewind(imported.receipt.operationId);
  // A saved company record without the research-finalization marker is an interrupted two-document confirmation.
  rolled.history=rolled.history.map(h=>{if(h.confirmed?.operation?.operationId===confirm.receipt.operationId)delete h.confirmed;return h;});
  await db.collection('financeintakeresearch').updateOne({_id:rolled._id},{$set:{history:rolled.history}});await rewind(confirm.receipt.operationId);
  const partialSnapshot=await businessSnapshot(),partial=await ok(workspace,{token}),partialActions=partial.conversation.turns.flatMap(t=>t.actions||[]);
  const partialImport=partialActions.find(a=>a.operationId===imported.receipt.operationId),partialConfirm=partialActions.find(a=>a.operationId===confirm.receipt.operationId);
  assert.equal(partialImport.state,'unresolved');assert.equal(partialImport.nativeResourceIds.partial,true);assert.ok(partialImport.nativeResourceIds.recordIds.length);assert.ok(partialImport.nativeResourceIds.templateId);
  assert.equal(partialConfirm.state,'unresolved','navi-intake:partial-confirm');assert.equal(partialConfirm.nativeResourceIds.recordSaved,true);assert.equal(partialConfirm.nativeResourceIds.researchFinalized,false);assert.equal(partialConfirm.acceptedRevision,3);
  assert.equal(await businessSnapshot(),partialSnapshot);
  pass('partial import and interrupted two-document confirmation report saved effects and need inspection without repeating writes');
  const noProof=await ops.findOne({operationId:edit.receipt.operationId});delete noProof._id;
  const unknownId=crypto.randomBytes(16).toString('hex');await ops.insertOne({...noProof,slot:90,operationId:unknownId,state:'claimed',leaseUntil:new Date(Date.now()-60000),receipt:null});
  // A matching marker under the other owner must not make this owner's unknown operation look successful.
  const foreignOwner=(await db.collection('users').findOne({email:'navi-intake-b@example.invalid'}))._id;
  await db.collection('financeintakerecords').updateOne({_id:new ObjectId(otherRecord.id),ownerId:foreignOwner},{$push:{history:{operation:{operationId:unknownId,name:'patch_intake_record',revision:2}}}});
  const unknownView=await ok(workspace,{token}),unknown=unknownView.conversation.turns.flatMap(t=>t.actions||[]).find(a=>a.operationId===unknownId);assert.equal(unknown.state,'unresolved');assert.equal(unknown.recoveryOwner,'user');assert.equal(unknown.nativeResourceIds,null);
  pass('expired intake operations without owned proof remain unresolved rather than claiming no save or trusting another owner');
  const liveJob=await ask({page:'intake',recordId:record.id}),live=await ops.findOne({operationId:edit.receipt.operationId});delete live._id;
  const liveId=crypto.randomBytes(16).toString('hex');await ops.insertOne({...live,turnId:liveJob.turnId||liveJob.requestId||((await db.collection('financeassistants').findOne({_id:new ObjectId(liveJob.id)})).currentId),slot:99,operationId:liveId,state:'claimed',lease:liveJob.lease,leaseUntil:new Date(Date.now()-60000),receipt:null});
  const liveView=await ok(workspace,{token}),liveReceipt=liveView.conversation.turns.flatMap(t=>t.actions||[]).find(a=>a.operationId===liveId);assert.equal(liveReceipt.state,'working','navi-intake:renewed-lease');
  assert.equal((await done(liveJob)).status,200);
  assert.equal(await db.collection('transactions').countDocuments(),before.transactions);assert.equal(await db.collection('financeentries').countDocuments(),before.financeentries);
  pass('a renewed in-flight conversation retains its claim; intake actions create no ledger or transaction entries');
  console.log(checks+' Navi intake API groups passed');
 }finally{
  if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}
  if(client)await client.close();if(mongo)await mongo.stop();
  if(directory){const resolved=path.resolve(directory),temp=path.resolve(os.tmpdir());if(!resolved.startsWith(temp+path.sep))throw Error('Unsafe owned temp cleanup');await fsp.rm(resolved,{recursive:true,force:true});}
 }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});

// Saved receipt link/unlink (Navi tools, native routes, auto-match) on the actual built application with an owned throwaway MongoDB.
// Two modes, synthetic records only, no model/provider/network/business sends:
//  - group: required by finance-company-business-integration.cjs inside its owned app/database (Navi + native route contracts);
//  - standalone (node this-file): its own mongod and one or two app processes built from a compiled copy whose no-op step seam
//    receiptLinkStep is replaced by a file barrier, so the REAL writer/completer/scheduler is crashed, paused or failed at each durable
//    boundary; restart, concurrent different-receipt races, expired recovery owners, retries/manual review and automatic recovery
//    without any further request are executed, then the installed-Chrome leg and the count-only audit.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),hex=()=>crypto.randomBytes(4).toString('hex'),EXPENSE='支出';
const L=tag=>'receipt-link:'+tag;
// The hub's cleanEnvForExec() key list: no API keys, mail/push secrets or database addresses reach a child process.
const SENSITIVE=['ANTHROPIC_API_KEY','GEMINI_API_KEY','GROK_API_KEY','IMAP_PASSWORD','SMTP_PASSWORD','VAPID_PRIVATE_KEY','AUTH_PASSWORD','RIRI_BROWSERS_API_KEY','VOYAGE_API_KEY','MONGODB_URI','RIRI_MONGODB_URI','GOOGLE_PRIVATE_KEY','MONGO_URI','NUXT_MONGO_URI'];
const cleanEnv=()=>{const env={...process.env};for(const k of SENSITIVE)delete env[k];return env};
const seedFactory=(ObjectId,at)=>({
 T:o=>({_id:new ObjectId(),referenceNumber:'RL-'+hex(),date:at,amount:5000,type:EXPENSE,status:'completed',hasReceipt:false,timeline:[],items:[],createdAt:at,updatedAt:at,...o}),
 R:o=>({_id:new ObjectId(),filename:'rl-'+hex()+'.pdf',originalFilename:'RL_PRIVATE_FILE.pdf',size:10,uploadDate:at,receiptDate:at,merchant:'RL synthetic shop',amount:5000,currency:'JPY',status:'unmatched',filePath:'RL_PRIVATE_PATH',createdAt:at,updatedAt:at,...o})
});
const expectedFlag=async(db,t)=>!!(await db.collection('receipts').findOne({organizationId:t.organizationId,transactionId:t._id,status:'matched'}))||!!t.receiptFilePath;
// Converged: the stored badge equals the canonical receipts/direct file, no receipt of this transaction owes work, and the projection
// was computed under the transaction's latest request revision.
async function converged(db,tid,label){
 const t=await db.collection('transactions').findOne({_id:tid});assert.ok(t,label+' transaction exists');
 assert.equal(t.hasReceipt,await expectedFlag(db,t),label+' badge equals canonical receipts');
 assert.equal(await db.collection('receipts').countDocuments({'linkSync.pending':true,'linkSync.work.transactionId':tid}),0,label+' no owed work');
 if(t.receiptSync)assert.equal(t.receiptSync.applied,t.receiptSync.rev,label+' projection under latest revision');
 return t;
}
const timelineCount=(t,type)=>(t?.timeline||[]).filter(e=>e.type===type).length;

// ---------------------------------------------------------------- group mode (inside the company-business harness)
async function group({db,ObjectId,A,B,ownerToken,tokenA,tokenB,act,actOk,turn,finish,ok,call,members,pass}){
 const rec=db.collection('receipts'),tx=db.collection('transactions'),chats=db.collection('financecompanyassistants'),{T,R}=seedFactory(ObjectId,new Date('2026-03-10T03:00:00Z'));
 const t={a1:T({organizationId:A}),a2:T({organizationId:A,hasReceipt:true}),a3:T({organizationId:A,hasReceipt:true,receiptFilePath:'/uploads/rl-direct-file.pdf'}),a4:T({organizationId:A}),a5:T({organizationId:A,hasReceipt:true}),a6:T({organizationId:A,hasReceipt:false}),b1:T({organizationId:B,amount:7777})};
 const r={a1:R({organizationId:A}),a2:R({organizationId:A,status:'matched',transactionId:t.a2._id}),a4:R({organizationId:A,status:'matched',transactionId:t.a5._id}),a5:R({organizationId:A,status:'matched',transactionId:t.a5._id}),a6:R({organizationId:A,status:'matched',transactionId:t.a6._id}),a7:R({organizationId:A,status:'matched',transactionId:t.a3._id}),a8:R({organizationId:A,amount:4321}),b1:R({organizationId:B,amount:7777,merchant:'PRIVATE_B_RL'})};
 await tx.insertMany(Object.values(t));await rec.insertMany(Object.values(r));
 const ids=x=>Object.values(x).map(v=>v._id),snapshot=async()=>JSON.stringify(await Promise.all([rec.find({_id:{$in:ids(r)}}).sort({_id:1}).toArray(),tx.find({_id:{$in:ids(t)}}).sort({_id:1}).toArray()]));
 const read=async(job,id)=>(await actOk(job,'get_company_receipt',{receiptId:String(id)})).result.receipt;
 const setOp=async(job,operationId,values)=>{const u=await chats.updateOne({_id:new ObjectId(job.id)},{$set:Object.fromEntries(Object.entries(values).map(([k,v])=>['turns.$[turn].actions.$[action].'+k,v]))},{arrayFilters:[{'turn.actions.operationId':operationId},{'action.operationId':operationId}]});assert.equal(u.modifiedCount,1,'SETUP journal edit')};
 const opOf=async(job,operationId)=>(await actOk(job,'get_company_action_status',{operationId})).result.receipts[0];
 try{
  let job=await turn(tokenA,'領収書 rA1 を取引 tA1 に紐付けて。',{page:'receipts'});
  assert.ok(job.tools.some(x=>x.name==='link_company_receipt')&&job.tools.some(x=>x.name==='unlink_company_receipt'),L('catalogue'));
  // done
  let current=await read(job,r.a1._id);assert.equal(typeof current.updatedAt,'string',L('status')+' updatedAt exposed');
  let res=await act(job,'link_company_receipt',{receiptId:String(r.a1._id),transactionId:String(t.a1._id),expectedUpdatedAt:current.updatedAt},1);
  assert.equal(res.status,200,L('done')+' '+res.raw.slice(0,300));assert.equal(res.data.receipt.state,'done',L('done'));assert.equal(res.data.result.outcome,'linked',L('done'));
  const linkOp=res.data.receipt.operationId;assert.deepEqual(res.data.receipt.nativeResourceIds,{receiptId:String(r.a1._id),transactionId:String(t.a1._id)},L('status'));
  let ra1=await rec.findOne({_id:r.a1._id}),ta1=await tx.findOne({_id:t.a1._id});
  assert.equal(ra1.status,'matched',L('done'));assert.equal(String(ra1.transactionId),String(t.a1._id),L('done'));assert.equal(ra1.linkSync.pending,false,L('done'));assert.equal(ra1.linkSync.state,'synced',L('done'));
  assert.ok((ra1.naviOperations||[]).some(m=>m.operationId===linkOp),L('done')+' marker on the receipt');
  assert.equal(ta1.hasReceipt,true,L('done')+' badge set');assert.ok(!('receipt' in ta1),L('done')+' no phantom receipt object');assert.equal(timelineCount(ta1,'receipt_matched'),1,L('done')+' one timeline event');
  await converged(db,t.a1._id,L('done'));
  // same slot / same intent
  res=await act(job,'link_company_receipt',{receiptId:String(r.a1._id),transactionId:String(t.a1._id),expectedUpdatedAt:current.updatedAt},1);assert.equal(res.data.receipt.operationId,linkOp,L('same-slot'));
  res=await act(job,'link_company_receipt',{receiptId:String(r.a1._id),transactionId:String(t.a1._id),expectedUpdatedAt:current.updatedAt},2);assert.equal(res.data.receipt.operationId,linkOp,L('same-slot')+' same intent coalesces');
  assert.equal((await act(job,'link_company_receipt',{receiptId:String(r.a1._id),transactionId:String(t.a4._id),expectedUpdatedAt:current.updatedAt},1)).status,409,L('same-slot')+' slot meaning');
  assert.equal(timelineCount(await tx.findOne({_id:t.a1._id}),'receipt_matched'),1,L('same-slot')+' no duplicate effect');
  // status
  let receipt=await read(job,r.a1._id);assert.equal(receipt.linkStatus,'linked_to_this_company',L('status'));assert.equal(receipt.linkSync,'synced',L('status'));assert.equal(receipt.linkFlagPending,false,L('status'));
  const rawReceipt=JSON.stringify(receipt);for(const secret of['naviOperations','claimToken','"work"','"rev"','RL_PRIVATE'])assert.ok(!rawReceipt.includes(secret),L('status')+' no internal marker '+secret);
  assert.equal((await opOf(job,linkOp)).state,'done',L('status'));assert.equal((await actOk(job,'get_company_transaction',{transactionId:String(t.a1._id)})).result.transaction.hasReceipt,true,L('status'));
  // stale snapshot, linked elsewhere, company
  let before=await snapshot();
  res=await act(job,'unlink_company_receipt',{receiptId:String(r.a1._id),expectedUpdatedAt:current.updatedAt},3);assert.equal(res.status,409,L('stale'));assert.equal((await snapshot()),before,L('stale')+' no writes');
  current=await read(job,r.a2._id);res=await act(job,'link_company_receipt',{receiptId:String(r.a2._id),transactionId:String(t.a1._id),expectedUpdatedAt:current.updatedAt},4);assert.equal(res.status,409,L('elsewhere'));assert.equal(await snapshot(),before,L('elsewhere')+' no writes');
  current=await read(job,r.a8._id);assert.equal((await act(job,'link_company_receipt',{receiptId:String(r.a8._id),transactionId:String(t.b1._id),expectedUpdatedAt:current.updatedAt},5)).status,404,L('company')+' foreign transaction');
  assert.equal((await act(job,'link_company_receipt',{receiptId:String(r.b1._id),transactionId:String(t.a1._id),expectedUpdatedAt:new Date().toISOString()},6)).status,404,L('company')+' foreign receipt');
  assert.equal((await act(job,'link_company_receipt',{receiptId:String(r.a8._id),transactionId:String(t.a1._id),expectedUpdatedAt:current.updatedAt,organizationId:String(B)},7)).status,400,L('company')+' no company argument');
  assert.equal(await snapshot(),before,L('company')+' no writes');
  // a read/suggestion writes nothing and claims nothing
  const journalBefore=JSON.stringify((await chats.findOne({_id:new ObjectId(job.id)})).turns.at(-1).actions.map(a=>a.operationId));
  await actOk(job,'find_company_receipt_matches',{receiptId:String(r.a8._id)});assert.equal(await snapshot(),before,L('suggestion-no-write'));
  assert.equal(JSON.stringify((await chats.findOne({_id:new ObjectId(job.id)})).turns.at(-1).actions.map(a=>a.operationId)),journalBefore,L('suggestion-no-write')+' no claim');
  // already linked: legacy badge repaired, no new timeline event
  current=await read(job,r.a6._id);assert.equal(current.linkSync,'untracked',L('legacy')+' legacy link reported untracked');
  res=await actOk(job,'link_company_receipt',{receiptId:String(r.a6._id),transactionId:String(t.a6._id),expectedUpdatedAt:current.updatedAt},8,'already');assert.equal(res.receipt.state,'done',L('already'));assert.equal(res.result.outcome,'already_linked',L('already'));
  const ta6=await converged(db,t.a6._id,L('already'));assert.equal(ta6.hasReceipt,true,L('already')+' legacy badge repaired');assert.equal(timelineCount(ta6,'receipt_matched'),0,L('already')+' no new timeline');
  // unlink, several receipts, direct file, not linked
  current=await read(job,r.a2._id);res=await actOk(job,'unlink_company_receipt',{receiptId:String(r.a2._id),expectedUpdatedAt:current.updatedAt},9,'unlink');assert.equal(res.receipt.state,'done',L('unlink'));assert.equal(res.result.outcome,'unlinked',L('unlink'));
  const ra2=await rec.findOne({_id:r.a2._id});assert.equal(ra2.status,'unmatched',L('unlink'));assert.ok(!ra2.transactionId,L('unlink'));let ta2=await converged(db,t.a2._id,L('unlink'));assert.equal(ta2.hasReceipt,false,L('unlink'));assert.equal(timelineCount(ta2,'receipt_unmatched'),1,L('unlink'));
  current=await read(job,r.a4._id);await actOk(job,'unlink_company_receipt',{receiptId:String(r.a4._id),expectedUpdatedAt:current.updatedAt},10,'unlink-multi');assert.equal((await converged(db,t.a5._id,L('unlink-multi'))).hasReceipt,true,L('unlink-multi')+' sibling keeps the badge');
  current=await read(job,r.a5._id);await actOk(job,'unlink_company_receipt',{receiptId:String(r.a5._id),expectedUpdatedAt:current.updatedAt},11,'unlink-multi');assert.equal((await converged(db,t.a5._id,L('unlink-multi'))).hasReceipt,false,L('unlink-multi')+' last receipt clears it');
  current=await read(job,r.a7._id);await actOk(job,'unlink_company_receipt',{receiptId:String(r.a7._id),expectedUpdatedAt:current.updatedAt},12,'unlink-keeps-file');assert.equal((await converged(db,t.a3._id,L('unlink-keeps-file'))).hasReceipt,true,L('unlink-keeps-file'));
  current=await read(job,r.a4._id);const ta5Before=JSON.stringify((await tx.findOne({_id:t.a5._id})).timeline);
  res=await actOk(job,'unlink_company_receipt',{receiptId:String(r.a4._id),expectedUpdatedAt:current.updatedAt},13,'unlink-not-linked');assert.equal(res.receipt.state,'done',L('unlink-not-linked'));assert.equal(res.result.outcome,'already_unlinked',L('unlink-not-linked'));assert.equal(JSON.stringify((await tx.findOne({_id:t.a5._id})).timeline),ta5Before,L('unlink-not-linked')+' no transaction effect');
  // lost reply: the journal entry is reopened as claimed; the read proves done from the marker, never repeats
  const timelineBefore=JSON.stringify((await tx.findOne({_id:t.a1._id})).timeline);
  await setOp(job,linkOp,{state:'claimed'});assert.equal((await opOf(job,linkOp)).state,'done',L('lost-reply'));
  await setOp(job,linkOp,{state:'claimed',leaseUntil:new Date(0),lease:'expired'});assert.equal((await opOf(job,linkOp)).state,'done',L('recover-done'));assert.equal(JSON.stringify((await tx.findOne({_id:t.a1._id})).timeline),timelineBefore,L('lost-reply')+' not repeated');
  // supplemental constructed state: a claimed receipt operation whose receipt carries no marker stays unresolved (never executed again)
  const ghost={operationId:crypto.randomBytes(16).toString('hex'),name:'link_company_receipt',turnId:job.turnId||(await chats.findOne({_id:new ObjectId(job.id)})).currentId,slot:99,payloadHash:'ghost',resourceKind:'receipt',resourceId:String(r.a8._id),detail:{transactionId:String(t.a4._id)},requestedFields:['receiptId','transactionId'],state:'claimed',lease:'ghost',leaseUntil:new Date(0),claimedAt:new Date(0)};
  await chats.updateOne({_id:new ObjectId(job.id)},{$push:{'turns.$[turn].actions':ghost}},{arrayFilters:[{'turn.id':ghost.turnId}]});
  const g=await opOf(job,ghost.operationId);assert.equal(g.state,'unresolved',L('recover-unresolved'));assert.equal((await rec.findOne({_id:r.a8._id})).status,'unmatched',L('recover-unresolved')+' never executed');
  // revoked membership
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});current={updatedAt:(await rec.findOne({_id:r.a8._id})).updatedAt.toISOString()};
  assert.equal((await act(job,'link_company_receipt',{receiptId:String(r.a8._id),transactionId:String(t.a4._id),expectedUpdatedAt:current.updatedAt},14)).status,403,L('revoked'));
  await db.collection('organizations').updateOne({_id:A},{$set:{members}});assert.equal((await rec.findOne({_id:r.a8._id})).status,'unmatched',L('revoked')+' no write');
  await finish(job);
  pass('receipt link/unlink Navi tools: exact snapshot, done only with synchronized badge, same slot coalesces, stale/elsewhere/foreign refused without writes, legacy repaired, several receipts and direct files kept, lost reply proven by marker, revoked refused');

  // native route: company door, ids, outcomes
  const route=id=>'/api/receipts/'+id+'/match';
  assert.equal((await call(route(r.a8._id),tokenB,'POST',{transactionId:String(t.a4._id)})).status,404,L('route-company')+' other company token');
  assert.equal((await call(route(r.a8._id),ownerToken,'POST',{transactionId:String(t.a4._id)})).status,403,L('route-company')+' no company');
  assert.equal((await call(route('not-an-id'),tokenA,'POST',{transactionId:String(t.a4._id)})).status,400,L('route-company')+' invalid receipt id');
  assert.equal((await call(route(r.a8._id),tokenA,'POST',{transactionId:'bad'})).status,400,L('route-company')+' invalid transaction id');
  assert.equal((await call(route(r.a8._id),tokenA,'POST',{transactionId:String(t.b1._id)})).status,404,L('route-company')+' foreign transaction');
  assert.equal((await rec.findOne({_id:r.a8._id})).status,'unmatched',L('route-company')+' no write');
  let native=await call(route(r.a8._id),tokenA,'POST',{transactionId:String(t.a4._id)});assert.equal(native.status,200,L('route-company')+' '+native.raw.slice(0,200));assert.equal(native.data.outcome,'linked',L('route-company'));assert.equal(native.data.synchronization,'synced',L('route-company'));
  assert.equal((await converged(db,t.a4._id,L('route-company'))).hasReceipt,true,L('route-company'));
  assert.equal((await call(route(r.a8._id),tokenA,'POST',{transactionId:String(t.a1._id)})).status,409,L('route-company')+' linked elsewhere');
  assert.equal((await call(route(r.a8._id),tokenB,'DELETE')).status,404,L('route-company')+' delete other company');
  native=await call(route(r.a8._id),tokenA,'DELETE');assert.equal(native.status,200,L('route-company'));assert.equal(native.data.outcome,'unlinked',L('route-company'));assert.equal((await converged(db,t.a4._id,L('route-company'))).hasReceipt,false,L('route-company'));
  native=await call(route(r.a8._id),tokenA,'DELETE');assert.equal(native.status,200,L('route-company'));assert.equal(native.data.outcome,'already_unlinked',L('route-company'));
  // auto-match is bound to the caller's company: B's perfect pair stays untouched by A's run
  const foreignBefore=JSON.stringify(await Promise.all([rec.find({organizationId:B}).sort({_id:1}).toArray(),tx.find({organizationId:B}).sort({_id:1}).toArray()]));
  const auto=await call('/api/receipts/auto-match',tokenA,'POST',{minConfidence:85});assert.equal(auto.status,200,L('auto-match-scope')+' '+auto.raw.slice(0,200));
  assert.equal(JSON.stringify(await Promise.all([rec.find({organizationId:B}).sort({_id:1}).toArray(),tx.find({organizationId:B}).sort({_id:1}).toArray()])),foreignBefore,L('auto-match-scope')+' other company untouched');
  assert.equal(auto.data.processed,await rec.countDocuments({organizationId:A,status:'unmatched'})+auto.data.matched,L('auto-match-scope')+' only this company processed');
  assert.equal((await call('/api/receipts/auto-match',ownerToken,'POST',{})).status,403,L('auto-match-scope')+' no company');
  for(const m of auto.data.matches||[])await converged(db,new ObjectId(m.transactionId),L('auto-match-scope'));
  pass('native receipt match route and auto-match: selected company and fresh membership, ids checked, refusals with status, outcomes and synchronized badge');
 }finally{
  await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  await rec.deleteMany({_id:{$in:ids(r)}});await tx.deleteMany({_id:{$in:ids(t)}});
 }
}

// ---------------------------------------------------------------- standalone durability harness
const BARRIER=`import fs from 'node:fs';import path from 'node:path';
export default async function step(point,ids){const dir=process.env.OMF_RECEIPT_LINK_BARRIER_DIR;if(!dir)return;const file=path.join(dir,point+'.json');let rule;try{rule=JSON.parse(fs.readFileSync(file,'utf8'))}catch{return}
 if(rule.receiptId&&rule.receiptId!==String(ids&&ids.receiptId))return;if(rule.transactionId&&rule.transactionId!==String(ids&&ids.transactionId))return;
 if(Number.isInteger(rule.skip)&&rule.skip>0){rule.skip--;fs.writeFileSync(file,JSON.stringify(rule));return}
 if(Number.isInteger(rule.remaining)){if(rule.remaining<=0)return;rule.remaining--;fs.writeFileSync(file,JSON.stringify(rule))}else fs.rmSync(file,{force:true});
 fs.appendFileSync(path.join(dir,'reached.log'),JSON.stringify({point,ids,action:rule.action,at:Date.now(),pid:process.pid})+'\\n');
 if(rule.action==='crash')process.exit(70);if(rule.action==='throw')throw new Error('Injected receipt link fault');
 if(rule.action==='pause'){const release=path.join(dir,point+'.release');for(let i=0;i<1800&&!fs.existsSync(release);i++)await new Promise(r=>setTimeout(r,50));fs.rmSync(release,{force:true})}}
`;
const STEP_ANCHOR='async function receiptLinkStep(point, ids) {';
async function standalone(){
 const {MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb');
 const root=path.resolve(process.env.OMF_RECEIPT_LINK_APP_ROOT||path.join(__dirname,'..')),only=process.env.OMF_RECEIPT_LINK_ONLY?new Set(process.env.OMF_RECEIPT_LINK_ONLY.split(',')):null;
 const serverOnly=process.env.OMF_RECEIPT_LINK_SERVER_ONLY==='1';
 let mongo,client,directory;const apps=new Set(),results=[];
 const tag=async(name,fn)=>{if(only&&!only.has(name))return;const started=Date.now();try{await fn();results.push({tag:name,pass:true,ms:Date.now()-started});console.log('PASS '+L(name))}catch(e){results.push({tag:name,pass:false,ms:Date.now()-started,error:(e.name||'Error')+': '+String(e.message).slice(0,900)});console.log('FAIL '+L(name)+' '+(e.name||'Error')+': '+String(e.message).slice(0,900))}};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-receipt-link-'));
  const binary=path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined,instance:{launchTimeout:300000}});
  const dbName='receipt_link_regression',uri=mongo.getUri(dbName),secret=crypto.randomBytes(32).toString('hex');client=await MongoClient.connect(uri);const db=client.db(dbName);
  // The compiled copy: the production no-op step seam is replaced by the file barrier. Absent seam (unchanged baseline): the plain
  // build runs and every barrier tag reports its setup as unavailable (a failure, never a pass).
  const copy=path.join(directory,'app');await fsp.cp(path.join(root,'.output'),path.join(copy,'.output'),{recursive:true,dereference:true});await fsp.writeFile(path.join(directory,'barrier.mjs'),BARRIER);
  const chunks=[];const walk=async d=>{for(const e of await fsp.readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(copy,'.output/server'));
  let seam=0;for(const f of chunks){const s=await fsp.readFile(f,'utf8');if(s.includes(STEP_ANCHOR)){seam++;await fsp.writeFile(f,s.split(STEP_ANCHOR).join(STEP_ANCHOR+' await (await import('+JSON.stringify(pathToFileURL(path.join(directory,'barrier.mjs')).href)+')).default(point, ids);'))}}
  const barrierReady=seam===1;console.log('SETUP barrier seam chunks '+seam);
  const needBarrier=()=>assert.ok(barrierReady,'SETUP barrier seam unavailable in the compiled application (expected exactly one receiptLinkStep definition, found '+seam+')');
  const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p};
  const start=async(name,env={})=>{
   // Rules armed before a (re)start stay in the process's barrier directory; its reached log starts empty for every process.
   const port=await freePort(),bdir=path.join(directory,'barrier-'+name);await fsp.mkdir(bdir,{recursive:true});await fsp.rm(path.join(bdir,'reached.log'),{force:true});const app={name,origin:'http://127.0.0.1:'+port,bdir,logs:''};
   app.child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:copy,windowsHide:true,env:{...cleanEnv(),MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:path.join(directory,'data'),JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port),OMF_SYNC_SCHEDULE_MS:'0',OMF_BANK_SCHEDULE_MS:'0',OMF_RECEIPT_SYNC_MS:'1000',OMF_RECEIPT_SYNC_GRACE_MS:'1500',OMF_RECEIPT_SYNC_BACKOFF_MS:'50',OMF_RECEIPT_SYNC_LEASE_MS:'3000',OMF_RECEIPT_LINK_BARRIER_DIR:bdir,...env},stdio:['ignore','pipe','pipe']});
   app.closed=new Promise(r=>app.child.once('exit',(code)=>{app.exitCode=code;apps.delete(app);r(code)}));for(const s of[app.child.stdout,app.child.stderr]){s.setEncoding('utf8');s.on('data',v=>{app.logs=(app.logs+v).slice(-30000)})}
   apps.add(app);for(let i=0;i<150;i++){try{const d=await(await fetch(app.origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,dbName);return app}}catch{}if(app.exitCode!==undefined)break;await pause(200)}
   throw Error('SETUP app '+name+' unavailable: '+app.logs.slice(-2000));
  };
  const stop=async app=>{if(app&&app.exitCode===undefined){app.child.kill();await app.closed}};
  const api=async(app,route,token,method='GET',body)=>{try{const r=await fetch(app.origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)}),raw=await r.text();let data;try{data=JSON.parse(raw)}catch{}return{status:r.status,data,raw}}catch(e){return{status:0,raw:String(e.message),data:null}}};
  // A rule's reached count is measured from the moment it is armed (earlier hits of the same point in this process do not count).
  const rule=async(app,point,r)=>{await fsp.rm(path.join(app.bdir,point+'.release'),{force:true});app.marks={...app.marks,[point]:(await reachedLog(app)).filter(e=>e.point===point).length};await fsp.writeFile(path.join(app.bdir,point+'.json'),JSON.stringify(r))};
  const release=(app,point)=>fsp.writeFile(path.join(app.bdir,point+'.release'),'1');
  const reachedLog=async app=>{try{return(await fsp.readFile(path.join(app.bdir,'reached.log'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch{return[]}};
  const reached=async(app,point,count=1,ms=30000)=>{const target=(app.marks?.[point]||0)+count;for(let i=0;i<ms/50;i++){if((await reachedLog(app)).filter(e=>e.point===point).length>=target)return;await pause(50)}throw Error('SETUP barrier '+point+' not reached on '+app.name+': '+app.logs.slice(-1500))};
  const until=async(fn,label,ms=45000)=>{let last;for(let i=0;i<ms/200;i++){try{last=await fn();if(last)return last}catch(e){last=e}await pause(200)}throw new assert.AssertionError({message:label+' (waited '+ms+' ms, last '+String(last?.message||last).slice(0,200)+')'})};
  const rec=db.collection('receipts'),tx=db.collection('transactions'),chats=db.collection('financecompanyassistants'),{T,R}=seedFactory(ObjectId,new Date('2026-04-15T03:00:00Z'));
  const seed=async(tOpts,rOpts)=>{const ts=tOpts.map(o=>T(o)),rs=[];for(const o of rOpts){const x=typeof o==='function'?o(ts):o;rs.push(R(x))}if(ts.length)await tx.insertMany(ts);if(rs.length)await rec.insertMany(rs);return{ts,rs}};

  let P1=await start('p1');
  // Synthetic actor, companies, membership and owner worker on the owned database (no customer records, no production tokens).
  const password='Synthetic-password-Only1!',email='receipt-link-owner@example.invalid';
  const reg=await api(P1,'/api/auth/register',null,'POST',{email,password,name:'Synthetic receipt-link owner'});assert.equal(reg.status,200,'SETUP register '+reg.raw.slice(0,200));const ownerToken=reg.data.tokens.accessToken,owner=(await db.collection('users').findOne({email}))._id;
  const A=new ObjectId(),B=new ObjectId(),members=[{userId:owner,role:'owner',joinedAt:new Date()}];
  await db.collection('organizations').insertMany([{_id:A,name:'Synthetic receipt company A',slug:'rl-a',type:'business',isActive:true,members,settings:{defaultCurrency:'JPY',timezone:'Asia/Tokyo'}},{_id:B,name:'Synthetic receipt company B',slug:'rl-b',type:'business',isActive:true,members}]);
  const switchTo=async id=>{const s=await api(P1,'/api/auth/switch-organization',ownerToken,'POST',{organizationId:String(id)});assert.equal(s.status,200,'SETUP switch');return s.data.tokens.accessToken},tokenA=await switchTo(A),tokenB=await switchTo(B);
  const account=(await api(P1,'/api/finance/accounts',ownerToken,'POST',{name:'Synthetic receipt card',primaryCard:'54321',cardIdentifiers:['54321'],otpRecipient:'test@example.invalid',otpMailbox:'test@example.invalid'})).data.account;
  const agent=(await api(P1,'/api/finance-chat/agents',ownerToken,'POST',{accountIds:[account._id],workspaceEnabled:true})).data;assert.ok(agent?.token,'SETUP agent');
  const navi={app:P1};const worker=(route,body={})=>api(navi.app,'/api/finance-chat/worker/'+route,agent.token,'POST',body),endpoint='/api/finance-chat/company-workspace';
  const turn=async(token,text,context={page:'receipts'})=>{const view=await api(navi.app,endpoint,token);assert.equal((await worker('heartbeat')).status,200);const s=await api(navi.app,endpoint,token,'POST',{requestId:crypto.randomBytes(16).toString('hex'),chatRevision:view.data.conversation?.revision||0,text,context});assert.equal(s.status,200,'SETUP ask '+s.raw.slice(0,200));assert.equal((await worker('heartbeat')).status,200);const c=await worker('workspace-claim');assert.ok(c.data?.job,'SETUP claim '+c.raw.slice(0,200));return c.data.job};
  const act=(job,name,args={},slot=1)=>worker('workspace/'+job.id+'/actions',{lease:job.lease,name,args,slot});
  const finish=async job=>worker('workspace/'+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary:'Synthetic receipt-link reply',patch:{},quotes:{}}});
  const readReceipt=async(job,id)=>{const r=await act(job,'get_company_receipt',{receiptId:String(id)});assert.equal(r.status,200,'SETUP receipt read '+r.raw.slice(0,200));return r.data.result.receipt};
  const statusOf=async(job,operationId)=>{const r=await act(job,'get_company_action_status',{operationId});assert.equal(r.status,200,'SETUP status '+r.raw.slice(0,200));return r.data.result.receipts[0]};
  const route=id=>'/api/receipts/'+id+'/match';

  // ---- crash of the real writer/completer at every durable boundary, restart, automatic boot/tick recovery with no further request
  const points=['before-truth','after-truth','before-bump','after-bump','after-compute','after-projection','after-clear'];
  for(const point of points)await tag('boundary-link:'+point,async()=>{
   needBarrier();const {ts:[t1],rs:[r1]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,point,{action:'crash',receiptId:String(r1._id)});const res=await api(P1,route(r1._id),tokenA,'POST',{transactionId:String(t1._id)});
   assert.equal(await P1.closed,70,L('boundary-link:'+point)+' writer interrupted at the boundary ('+res.status+')');
   const afterCrash=await rec.findOne({_id:r1._id});
   if(point==='before-truth')assert.equal(afterCrash.status,'unmatched',L('boundary-link:'+point)+' nothing saved before the truth write');
   else assert.equal(afterCrash.status,'matched',L('boundary-link:'+point)+' truth saved');
   if(point!=='before-truth'&&point!=='after-clear')assert.equal(afterCrash.linkSync?.pending,true,L('boundary-link:'+point)+' durable owed work recorded with the truth');
   P1=await start('p1');navi.app=P1;
   // No HTTP request is sent from here: only the restarted process's boot/tick may recover.
   await until(async()=>!(await rec.findOne({_id:r1._id})).linkSync?.pending,L('boundary-link:'+point)+' automatic recovery without another request');
   const t=await converged(db,t1._id,L('boundary-link:'+point));
   assert.equal(t.hasReceipt,point!=='before-truth',L('boundary-link:'+point));assert.ok(timelineCount(t,'receipt_matched')<=1,L('boundary-link:'+point)+' no duplicate timeline');
   if(point!=='before-truth')assert.equal(timelineCount(t,'receipt_matched'),1,L('boundary-link:'+point)+' timeline event recorded once');
  });
  for(const point of['after-truth','after-compute'])await tag('boundary-unlink:'+point,async()=>{
   needBarrier();const {ts:[t1],rs:[r1]}=await seed([{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id})]);
   await rule(P1,point,{action:'crash',receiptId:String(r1._id)});await api(P1,route(r1._id),tokenA,'DELETE');assert.equal(await P1.closed,70,L('boundary-unlink:'+point));
   P1=await start('p1');navi.app=P1;await until(async()=>!(await rec.findOne({_id:r1._id})).linkSync?.pending,L('boundary-unlink:'+point)+' automatic recovery');
   assert.equal((await converged(db,t1._id,L('boundary-unlink:'+point))).hasReceipt,false,L('boundary-unlink:'+point));
  });

  // ---- the parent's counterexample, executed: X unlink computes a stale false and pauses before its projection write; Y link wins in
  // another process; X resumes. Variant B: the stale value is true.
  let P2=await start('p2',{OMF_RECEIPT_SYNC_MS:'0'});
  await tag('race-different-receipts',async()=>{
   needBarrier();const {ts:[t1],rs:[x,y]}=await seed([{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id}),{organizationId:A}]);
   await rule(P1,'after-compute',{action:'pause',receiptId:String(x._id)});const unlinkX=api(P1,route(x._id),tokenA,'DELETE');await reached(P1,'after-compute');
   const linkY=await api(P2,route(y._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(linkY.status,200,L('race-different-receipts')+' winner '+linkY.raw.slice(0,200));
   assert.equal((await tx.findOne({_id:t1._id})).hasReceipt,true,L('race-different-receipts')+' winner projected');
   await release(P1,'after-compute');const u=await unlinkX;assert.equal(u.status,200,L('race-different-receipts')+' stale writer finished '+u.raw.slice(0,200));
   const t=await converged(db,t1._id,L('race-different-receipts'));assert.equal(t.hasReceipt,true,L('race-different-receipts')+' no stale write after the winner');
   for(const id of[x._id,y._id])assert.equal((await rec.findOne({_id:id})).linkSync.pending,false,L('race-different-receipts'));
  });
  await tag('race-different-receipts-b',async()=>{
   needBarrier();const {ts:[t1],rs:[x,z]}=await seed([{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id}),ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id})]);
   await rule(P1,'after-compute',{action:'pause',receiptId:String(z._id)});const unlinkZ=api(P1,route(z._id),tokenA,'DELETE');await reached(P1,'after-compute');
   const unlinkX=await api(P2,route(x._id),tokenA,'DELETE');assert.equal(unlinkX.status,200,L('race-different-receipts-b'));const tMid=await tx.findOne({_id:t1._id});
   if(tMid.hasReceipt!==false)assert.fail(L('race-different-receipts-b')+' winner projected false: '+JSON.stringify({answer:unlinkX.data,receiptSync:tMid.receiptSync,x:(await rec.findOne({_id:x._id})).linkSync,z:(await rec.findOne({_id:z._id})).linkSync,p2:P2.logs.slice(-1500),p1:P1.logs.slice(-800)}));
   await release(P1,'after-compute');assert.equal((await unlinkZ).status,200,L('race-different-receipts-b'));
   assert.equal((await converged(db,t1._id,L('race-different-receipts-b'))).hasReceipt,false,L('race-different-receipts-b')+' stale true never wins');
  });
  await tag('race-same-receipt',async()=>{
   const {ts:[t1,t2],rs:[x]}=await seed([{organizationId:A},{organizationId:A}],[{organizationId:A}]);
   const both=await Promise.all([api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)}),api(P2,route(x._id),tokenA,'POST',{transactionId:String(t2._id)})]);
   const statuses=both.map(b=>b.status).sort();assert.deepEqual(statuses,[200,409],L('race-same-receipt')+' one winner '+JSON.stringify(both.map(b=>b.raw.slice(0,120))));
   const saved=await rec.findOne({_id:x._id}),winner=String(saved.transactionId);
   for(const t of[t1,t2]){const v=await converged(db,t._id,L('race-same-receipt'));assert.equal(v.hasReceipt,String(t._id)===winner,L('race-same-receipt'));assert.equal(timelineCount(v,'receipt_matched'),String(t._id)===winner?1:0,L('race-same-receipt'))}
   const again=await Promise.all([api(P1,route(x._id),tokenA,'DELETE'),api(P2,route(x._id),tokenA,'DELETE')]);
   assert.deepEqual(again.map(b=>b.status),[200,200],L('race-same-receipt')+' unlink retries harmless');assert.deepEqual(again.map(b=>b.data.outcome).sort(),['already_unlinked','unlinked'],L('race-same-receipt'));
   assert.equal(timelineCount(await converged(db,new ObjectId(winner),L('race-same-receipt')),'receipt_unmatched'),1,L('race-same-receipt')+' one unlink effect');
  });

  // ---- expired recovery owners. A: the boot owner holds a computation, its lease expires, a second process takes over and finishes,
  // a third process makes a newer change and pauses before its bump; the old owner resumes and must neither overwrite the projection
  // nor clear the newer owed work. B: an expired owner's failure while a live owner holds the claim is not counted.
  await tag('expired-owner',async()=>{
   needBarrier();await stop(P2);P2=null;const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(await P1.closed,70,'SETUP crash');
   const r1=(await rec.findOne({_id:x._id})).linkSync.rev;
   await rule(P1,'after-compute',{action:'pause',receiptId:String(x._id)});P1=await start('p1');navi.app=P1;await reached(P1,'after-compute');
   const c1=(await rec.findOne({_id:x._id})).linkSync.claimToken;assert.ok(c1,L('expired-owner')+' boot owner holds a claim');
   await pause(3500);let p2=await start('p2');
   await until(async()=>{const v=(await rec.findOne({_id:x._id})).linkSync;return v.rev===r1&&!v.pending},L('expired-owner')+' second process takes over the expired claim');
   const taken=await tx.findOne({_id:t1._id});await stop(p2);
   const p3=await start('p3',{OMF_RECEIPT_SYNC_MS:'0'});await rule(p3,'before-bump',{action:'pause',receiptId:String(x._id)});const unlink=api(p3,route(x._id),tokenA,'DELETE');await reached(p3,'before-bump');
   const r2=(await rec.findOne({_id:x._id})).linkSync;assert.notEqual(r2.rev,r1,'SETUP newer revision');assert.equal(r2.pending,true,'SETUP newer work owed');
   await rule(P1,'after-projection',{action:'mark',receiptId:String(x._id)});await release(P1,'after-compute');await reached(P1,'after-projection');await pause(700);
   const mid=(await rec.findOne({_id:x._id})).linkSync,tMid=await tx.findOne({_id:t1._id});
   assert.equal(mid.rev,r2.rev,L('expired-owner')+' newer revision kept');assert.equal(mid.pending,true,L('expired-owner')+' old owner cleared no newer work');
   assert.equal(tMid.receiptSync.applied,taken.receiptSync.applied,L('expired-owner')+' old owner overwrote no newer projection');
   await release(p3,'before-bump');assert.equal((await unlink).status,200,L('expired-owner'));await stop(p3);
   assert.equal((await converged(db,t1._id,L('expired-owner'))).hasReceipt,false,L('expired-owner'));
  });
  await tag('expired-owner-failure',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(await P1.closed,70,'SETUP crash');
   await rule(P1,'after-compute',{action:'pause',receiptId:String(x._id)});P1=await start('p1');navi.app=P1;await reached(P1,'after-compute');
   const c1=(await rec.findOne({_id:x._id})).linkSync.claimToken;await pause(3500);
   const p2dir=path.join(directory,'barrier-p2');await fsp.mkdir(p2dir,{recursive:true});await fsp.writeFile(path.join(p2dir,'recovery-claimed.json'),JSON.stringify({action:'pause',receiptId:String(x._id)}));
   const p2=await start('p2');await reached(p2,'recovery-claimed');const live=(await rec.findOne({_id:x._id})).linkSync,c2=live.claimToken;assert.ok(c2&&c2!==c1,'SETUP live second owner');
   await rule(P1,'after-projection',{action:'throw',receiptId:String(x._id)});await release(P1,'after-compute');await reached(P1,'after-projection');await pause(700);
   const mid=(await rec.findOne({_id:x._id})).linkSync;assert.equal(mid.attempts,live.attempts,L('expired-owner-failure')+' stale owner failure not counted');assert.equal(mid.claimToken,c2,L('expired-owner-failure')+' live claim kept');assert.equal(new Date(mid.nextAttemptAt).getTime(),new Date(live.nextAttemptAt).getTime(),L('expired-owner-failure')+' no backoff from a stale owner');assert.equal(mid.state,'pending',L('expired-owner-failure'));
   await release(p2,'recovery-claimed');await until(async()=>!(await rec.findOne({_id:x._id})).linkSync.pending,L('expired-owner-failure')+' live owner completes');await stop(p2);
   assert.equal((await converged(db,t1._id,L('expired-owner-failure'))).hasReceipt,true,L('expired-owner-failure'));
  });

  // ---- genuine failures: bounded exponential retries by the scheduler alone, then visible manual review and an explicit successor
  await tag('retries-manual',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(await P1.closed,70,'SETUP crash');
   // Arm the injected failures before boot recovery can complete the saved link.
   await rule(P1,'before-bump',{action:'throw',receiptId:String(x._id),remaining:10});P1=await start('p1');navi.app=P1;
   const seen=[];const s=await until(async()=>{const v=(await rec.findOne({_id:x._id})).linkSync;if(v.attempts&&!seen.some(z=>z.attempts===v.attempts))seen.push({attempts:v.attempts,next:new Date(v.nextAttemptAt).getTime()-Date.now()});return v.state==='manual_review'&&v},L('retries-manual')+' manual review after ten failures',180000).catch(async e=>{const v=(await rec.findOne({_id:x._id})).linkSync;e.message+=' '+JSON.stringify({attempts:v.attempts,state:v.state,nextInMs:new Date(v.nextAttemptAt).getTime()-Date.now(),claim:!!v.claimToken,seen,hits:(await reachedLog(P1)).map(e=>e.point),log:P1.logs.slice(-1200)});throw e});
   assert.equal(s.attempts,10,L('retries-manual'));assert.equal(s.reason,'retries_exhausted',L('retries-manual'));assert.equal(s.pending,true,L('retries-manual')+' never reported done');
   assert.equal((await reachedLog(P1)).filter(e=>e.point==='before-bump').length,10,L('retries-manual')+' exactly ten genuine attempts');
   await pause(3000);assert.equal((await rec.findOne({_id:x._id})).linkSync.attempts,10,L('retries-manual')+' no silent retry after manual review');
   const job=await turn(tokenA,'この領収書の状態を確認して。');const view=await readReceipt(job,x._id);assert.equal(view.linkSync,'manual_review',L('retries-manual')+' visible to Navi');assert.equal(view.linkSyncReason,'retries_exhausted',L('retries-manual'));assert.equal(view.linkFlagPending,true,L('retries-manual'));await finish(job);
   const evidence=await api(P1,'/api/receipts/'+x._id+'/evidence',tokenA);assert.equal(evidence.data.receipt.linkSync,'manual_review',L('retries-manual')+' visible on the native page');
   const retry=await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(retry.status,200,L('retries-manual')+' successor');assert.equal(retry.data.synchronization,'synced',L('retries-manual'));
   assert.equal((await converged(db,t1._id,L('retries-manual'))).hasReceipt,true,L('retries-manual'));
  });
  // Parent counterexample 6: the process dies right after the tenth failed attempt is counted and before its backoff/manual review is
  // recorded. No later process may take an eleventh genuine attempt.
  await tag('tenth-failure-crash',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(await P1.closed,70,'SETUP crash');
   await rule(P1,'before-bump',{action:'throw',receiptId:String(x._id),remaining:12});await rule(P1,'after-failure-count',{action:'crash',receiptId:String(x._id),skip:9});
   P1=await start('p1');navi.app=P1;
   const code=await Promise.race([P1.closed,pause(150000).then(()=>'timeout')]);if(code!==70){const log=await reachedLog(P1),v=(await rec.findOne({_id:x._id})).linkSync;assert.fail(L('tenth-failure-crash')+' interrupted at the tenth failure count: '+JSON.stringify({code,points:log.map(e=>e.point),state:v.state,attempts:v.attempts,reason:v.reason}))}
   const first=(await reachedLog(P1)).filter(e=>e.point==='before-bump').length;
   P1=await start('p1');navi.app=P1;await pause(6000);
   const second=(await reachedLog(P1)).filter(e=>e.point==='before-bump').length,s=(await rec.findOne({_id:x._id})).linkSync;
   // A counted attempt interrupted before it ran is still counted: at most ten executed, exactly ten counted, never an eleventh.
   assert.ok(first+second<=10,L('tenth-failure-crash')+' no eleventh genuine attempt (executed '+first+'+'+second+')');assert.equal(s.attempts,10,L('tenth-failure-crash')+' ten counted attempts');
   assert.equal(s.state,'manual_review',L('tenth-failure-crash')+' bounded review transition');assert.equal(s.reason,'retries_exhausted',L('tenth-failure-crash'));assert.equal(s.pending,true,L('tenth-failure-crash'));
   await fsp.rm(path.join(P1.bdir,'before-bump.json'),{force:true});await fsp.rm(path.join(P1.bdir,'after-failure-count.json'),{force:true});
   const retry=await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(retry.data?.synchronization,'synced',L('tenth-failure-crash')+' explicit successor');await converged(db,t1._id,L('tenth-failure-crash'));
  });
  // Parent counterexample 4: the target is deleted after the bump; the receipt must not be cleared as synchronized.
  await tag('deleted-after-bump',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-bump',{action:'pause',receiptId:String(x._id)});const link=api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});await reached(P1,'after-bump');
   await tx.deleteOne({_id:t1._id});await release(P1,'after-bump');const res=await link;
   const s=(await rec.findOne({_id:x._id})).linkSync;
   assert.equal(s.pending,true,L('deleted-after-bump')+' not cleared as synchronized');assert.equal(s.state,'manual_review',L('deleted-after-bump'));assert.equal(s.reason,'transaction_missing',L('deleted-after-bump'));
   assert.equal(res.data?.synchronization,'manual_review',L('deleted-after-bump')+' honest answer '+res.raw.slice(0,200));
   const un=await api(P1,route(x._id),tokenA,'DELETE');assert.equal(un.status,200,L('deleted-after-bump')+' successor');assert.equal((await rec.findOne({_id:x._id})).linkSync.pending,false,L('deleted-after-bump'));
  });
  // Parent counterexample 1: an operation whose event was recorded, then delayed beyond 50 later operations on the same transaction,
  // is recovered: its timeline event exists exactly once.
  await tag('late-retry-after-50',async()=>{
   needBarrier();if(!P2||P2.exitCode!==undefined)P2=await start('p2',{OMF_RECEIPT_SYNC_MS:'0'});
   const {ts:[t1],rs:[x,...ys]}=await seed([{organizationId:A}],[{organizationId:A},...Array.from({length:26},()=>({organizationId:A}))]);
   // No recovery tick may finish the paused work early: the eviction window must really be crossed before the restart.
   await stop(P1);P1=await start('p1',{OMF_RECEIPT_SYNC_MS:'0'});navi.app=P1;
   await rule(P1,'after-bump',{action:'pause',receiptId:String(x._id)});api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});await reached(P1,'after-bump');
   for(const y of ys){assert.equal((await api(P2,route(y._id),tokenA,'POST',{transactionId:String(t1._id)})).status,200,'SETUP later link');assert.equal((await api(P2,route(y._id),tokenA,'DELETE')).status,200,'SETUP later unlink')}
   assert.equal((await rec.findOne({_id:x._id})).linkSync.pending,true,'SETUP paused work still owed after 52 later operations');
   await stop(P1);P1=await start('p1');navi.app=P1;
   await until(async()=>!(await rec.findOne({_id:x._id})).linkSync.pending,L('late-retry-after-50')+' recovered');
   const t=await converged(db,t1._id,L('late-retry-after-50'));
   assert.equal(timelineCount(t,'receipt_matched'),27,L('late-retry-after-50')+' each link event exactly once');assert.equal(timelineCount(t,'receipt_unmatched'),26,L('late-retry-after-50'));
  });
  // Parent counterexample 5: an older completer records one owed event while a newer revision owes that event plus another; both
  // events exist exactly once.
  await tag('partial-event-overlap',async()=>{
   needBarrier();if(!P2||P2.exitCode!==undefined)P2=await start('p2',{OMF_RECEIPT_SYNC_MS:'0'});
   const {ts:[t1],rs:[x]}=await seed([{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id})]);
   await rule(P1,'before-bump',{action:'pause',receiptId:String(x._id)});const unlink=api(P1,route(x._id),tokenA,'DELETE');await reached(P1,'before-bump');
   await rule(P2,'before-bump',{action:'pause',receiptId:String(x._id)});const relink=api(P2,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});await reached(P2,'before-bump');
   await release(P1,'before-bump');assert.equal((await unlink).status,200,L('partial-event-overlap'));
   await release(P2,'before-bump');assert.equal((await relink).status,200,L('partial-event-overlap'));
   await until(async()=>!(await rec.findOne({_id:x._id})).linkSync.pending,L('partial-event-overlap')+' completed');
   const t=await converged(db,t1._id,L('partial-event-overlap'));assert.equal(t.hasReceipt,true,L('partial-event-overlap'));
   assert.equal(timelineCount(t,'receipt_unmatched'),1,L('partial-event-overlap')+' unlink event once');assert.equal(timelineCount(t,'receipt_matched'),1,L('partial-event-overlap')+' relink event not dropped');
  });
  await tag('deleted-target',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(await P1.closed,70,'SETUP crash');
   await tx.deleteOne({_id:t1._id});P1=await start('p1');navi.app=P1;
   const s=await until(async()=>{const v=(await rec.findOne({_id:x._id})).linkSync;return v.state==='manual_review'&&v},L('deleted-target')+' named manual review');
   assert.equal(s.reason,'transaction_missing',L('deleted-target'));assert.equal(s.pending,true,L('deleted-target'));
   const evidence=await api(P1,'/api/receipts/'+x._id+'/evidence',tokenA);assert.equal(evidence.data.receipt.linkSyncReason,'transaction_missing',L('deleted-target'));
   const un=await api(P1,route(x._id),tokenA,'DELETE');assert.equal(un.status,200,L('deleted-target')+' successor unlink '+un.raw.slice(0,200));const after=await rec.findOne({_id:x._id});assert.equal(after.status,'unmatched',L('deleted-target'));assert.equal(after.linkSync.pending,false,L('deleted-target'));
  });

  // ---- Navi: an interrupted link is never reported done while the badge is owed; it becomes done from proof alone, without a repeat
  await tag('navi-pending-not-done',async()=>{
   needBarrier();const {ts:[t1],rs:[x]}=await seed([{organizationId:A}],[{organizationId:A}]);
   let job=await turn(tokenA,'領収書を取引に紐付けて。');const current=await readReceipt(job,x._id);
   await rule(P1,'after-truth',{action:'crash',receiptId:String(x._id)});const res=await act(job,'link_company_receipt',{receiptId:String(x._id),transactionId:String(t1._id),expectedUpdatedAt:current.updatedAt},1);assert.equal(await P1.closed,70,'SETUP crash '+res.status);
   const op=(await chats.findOne({_id:new ObjectId(job.id)})).turns.at(-1).actions.find(a=>a.name==='link_company_receipt');assert.equal(op.state,'claimed','SETUP claimed');
   P1=await start('p1',{OMF_RECEIPT_SYNC_MS:'0'});navi.app=P1;
   await chats.updateOne({_id:new ObjectId(job.id)},{$set:{'turns.$[turn].actions.$[action].leaseUntil':new Date(0),leaseUntil:new Date(0),state:'ready'}},{arrayFilters:[{'turn.id':op.turnId},{'action.operationId':op.operationId}]});
   job=await turn(tokenA,'さっきの紐付けの結果を確認して。');let s=await statusOf(job,op.operationId);
   assert.equal(s.state,'unresolved',L('navi-pending-not-done')+' not done while the badge is owed');assert.equal(s.recoveryOwner,'system',L('navi-pending-not-done'));assert.match(s.safeError||'',/保存されました/,L('navi-pending-not-done'));
   const view=await readReceipt(job,x._id);assert.equal(view.linkFlagPending,true,L('navi-pending-not-done'));await finish(job);
   await stop(P1);P1=await start('p1');navi.app=P1;
   await until(async()=>!(await rec.findOne({_id:x._id})).linkSync.pending,L('navi-pending-not-done')+' scheduler completes without a request');
   job=await turn(tokenA,'もう一度確認して。');s=await statusOf(job,op.operationId);assert.equal(s.state,'done',L('navi-unresolved-to-done')+' proven later from the marker');assert.deepEqual(s.nativeResourceIds,{receiptId:String(x._id),transactionId:String(t1._id)},L('navi-unresolved-to-done'));await finish(job);
   const t=await converged(db,t1._id,L('navi-unresolved-to-done'));assert.equal(timelineCount(t,'receipt_matched'),1,L('navi-unresolved-to-done')+' never repeated');
  });
  await tag('race-navi-native',async()=>{
   const {ts:[t1],rs:[x]}=await seed([{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id})]);
   if(!P2||P2.exitCode!==undefined)P2=await start('p2',{OMF_RECEIPT_SYNC_MS:'0'});
   const job=await turn(tokenA,'この領収書の紐付けを解除して。');const current=await readReceipt(job,x._id);
   const both=await Promise.all([act(job,'unlink_company_receipt',{receiptId:String(x._id),expectedUpdatedAt:current.updatedAt},1),api(P2,route(x._id),tokenA,'DELETE')]);
   assert.equal(both[1].status,200,L('race-navi-native'));const navOk=both[0].status===200&&both[0].data.receipt.state==='done',navRefused=both[0].status===409;assert.ok(navOk||navRefused,L('race-navi-native')+' Navi is done or refused '+both[0].raw.slice(0,200));
   if(navOk)assert.equal(both[1].data.outcome,'already_unlinked',L('race-navi-native'));
   const t=await converged(db,t1._id,L('race-navi-native'));assert.equal(t.hasReceipt,false,L('race-navi-native'));assert.equal(timelineCount(t,'receipt_unmatched'),1,L('race-navi-native')+' one effect');await finish(job);
  });
  // ---- Parent Q9: a completion that repairs owed work names every affected transaction of this company (result, marker, lost-reply
  // recovery), including older owed work while linking a new target; a legacy foreign pointer is neither written nor exposed.
  await tag('affected-transactions',async()=>{
   needBarrier();const affected=ids=>new Set([ids?.transactionId,...(ids?.affectedTransactionIds||[])].filter(Boolean));
   const opIn=async(job,operationId)=>(await chats.findOne({_id:new ObjectId(job.id)})).turns.flatMap(t=>t.actions||[]).find(a=>a.operationId===operationId);
   let job;const {ts:[tOld,tNew,tOld2],rs:[x,y]}=await seed([{organizationId:A,hasReceipt:true},{organizationId:A},{organizationId:A,hasReceipt:true}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id}),ts=>({organizationId:A,status:'matched',transactionId:ts[2]._id})]);
   try{
    // The recovery tick is held so the owed work stays for the explicit Navi completion.
    await rule(P1,'recovery-claimed',{action:'pause'});
    for(const r of[x,y]){await rule(P1,'before-bump',{action:'throw',receiptId:String(r._id),remaining:1});const native=await api(P1,route(r._id),tokenA,'DELETE');assert.equal(native.data?.synchronization,'pending','SETUP native unlink interrupted after truth '+native.raw.slice(0,160))}
    job=await turn(tokenA,'この領収書の紐付けを解除して、取引の表示も直して。');let cur=await readReceipt(job,x._id);
    let r=await act(job,'unlink_company_receipt',{receiptId:String(x._id),expectedUpdatedAt:cur.updatedAt},1);assert.equal(r.data?.receipt?.state,'done',L('affected-transactions')+' '+r.raw.slice(0,200));assert.equal(r.data.result.outcome,'already_unlinked',L('affected-transactions'));
    assert.ok(affected(r.data.receipt.nativeResourceIds).has(String(tOld._id)),L('affected-transactions')+' already-unlinked completion names the repaired transaction '+JSON.stringify(r.data.receipt.nativeResourceIds));
    assert.equal((await converged(db,tOld._id,L('affected-transactions'))).hasReceipt,false,L('affected-transactions'));
    const op=r.data.receipt.operationId;await chats.updateOne({_id:new ObjectId(job.id)},{$set:{'turns.$[turn].actions.$[action].state':'claimed'}},{arrayFilters:[{'turn.actions.operationId':op},{'action.operationId':op}]});
    const recovered=await statusOf(job,op);assert.equal(recovered.state,'done',L('affected-transactions')+' lost reply');assert.ok(affected(recovered.nativeResourceIds).has(String(tOld._id)),L('affected-transactions')+' lost-reply recovery keeps the repaired transaction '+JSON.stringify(recovered.nativeResourceIds));
    // Union: older owed work for tOld2 plus a new link to tNew.
    cur=await readReceipt(job,y._id);r=await act(job,'link_company_receipt',{receiptId:String(y._id),transactionId:String(tNew._id),expectedUpdatedAt:cur.updatedAt},2);assert.equal(r.data?.receipt?.state,'done',L('affected-transactions')+' union '+r.raw.slice(0,200));
    const u=affected(r.data.receipt.nativeResourceIds);assert.ok(u.has(String(tNew._id))&&u.has(String(tOld2._id)),L('affected-transactions')+' union names old and new transactions '+JSON.stringify(r.data.receipt.nativeResourceIds));
    assert.equal(r.data.receipt.nativeResourceIds.transactionId,String(tNew._id),L('affected-transactions')+' primary target');
    assert.equal((await converged(db,tOld2._id,L('affected-transactions'))).hasReceipt,false,L('affected-transactions'));assert.equal((await converged(db,tNew._id,L('affected-transactions'))).hasReceipt,true,L('affected-transactions'));
   }finally{if(job)await finish(job);await fsp.rm(path.join(P1.bdir,'before-bump.json'),{force:true});await release(P1,'recovery-claimed');await fsp.rm(path.join(P1.bdir,'recovery-claimed.json'),{force:true})}
  });
  await tag('foreign-pointer-not-exposed',async()=>{
   const {ts:[tB]}=await seed([{organizationId:B,hasReceipt:true}],[]);const x=R({organizationId:A,status:'matched',transactionId:tB._id});await rec.insertOne(x);const before=JSON.stringify(await tx.findOne({_id:tB._id}));
   const job=await turn(tokenA,'この領収書の紐付けを解除して。');try{const cur=await readReceipt(job,x._id);
   const r=await act(job,'unlink_company_receipt',{receiptId:String(x._id),expectedUpdatedAt:cur.updatedAt},1);assert.equal(r.data?.receipt?.state,'done',L('foreign-pointer-not-exposed')+' '+r.raw.slice(0,200));
   assert.deepEqual(r.data.receipt.nativeResourceIds,{receiptId:String(x._id)},L('foreign-pointer-not-exposed')+' no foreign id in public metadata');assert.ok(!r.raw.includes(String(tB._id)),L('foreign-pointer-not-exposed')+' foreign id absent from the reply');
   assert.equal(JSON.stringify(await tx.findOne({_id:tB._id})),before,L('foreign-pointer-not-exposed')+' foreign transaction untouched');
   const after=await rec.findOne({_id:x._id});assert.equal(after.status,'unmatched',L('foreign-pointer-not-exposed'));assert.equal(after.linkSync.pending,false,L('foreign-pointer-not-exposed'));assert.ok(!JSON.stringify(after.naviOperations||[]).includes(String(tB._id)),L('foreign-pointer-not-exposed')+' marker keeps no foreign id');
   }finally{await finish(job)}
  });
  // ---- legacy links and direct file evidence: untracked until touched; an explicit request repairs; the tick does not scan them
  await tag('legacy',async()=>{
   const {ts:[t1,t2],rs:[x]}=await seed([{organizationId:A,hasReceipt:false},{organizationId:A,hasReceipt:true,receiptFilePath:'/uploads/rl-legacy-file.pdf'}],[ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id})]);
   await pause(2500);assert.equal((await tx.findOne({_id:t1._id})).hasReceipt,false,L('legacy')+' no global backfill by the tick');
   const r=await api(P1,route(x._id),tokenA,'POST',{transactionId:String(t1._id)});assert.equal(r.status,200,L('legacy'));assert.equal(r.data.outcome,'already_linked',L('legacy'));assert.equal((await converged(db,t1._id,L('legacy'))).hasReceipt,true,L('legacy')+' explicit request repairs');
   const y=R({organizationId:A});await rec.insertOne(y);await api(P1,route(y._id),tokenA,'POST',{transactionId:String(t2._id)});await api(P1,route(y._id),tokenA,'DELETE');assert.equal((await converged(db,t2._id,L('direct-file'))).hasReceipt,true,L('direct-file')+' direct file kept');
  });
  await tag('company-scope',async()=>{
   const {ts:[ta,tb],rs:[ra,rb]}=await seed([{organizationId:A},{organizationId:B}],[{organizationId:A},{organizationId:B}]);
   assert.equal((await api(P1,route(ra._id),tokenA,'POST',{transactionId:String(tb._id)})).status,404,L('company-scope'));assert.equal((await api(P1,route(rb._id),tokenA,'POST',{transactionId:String(ta._id)})).status,404,L('company-scope'));
   assert.equal((await api(P1,route(rb._id),tokenA,'DELETE')).status,404,L('company-scope'));assert.equal((await api(P1,route(ra._id),ownerToken,'POST',{transactionId:String(ta._id)})).status,403,L('route-company'));
   for(const x of[ra,rb])assert.equal((await rec.findOne({_id:x._id})).status,'unmatched',L('company-scope'));
   const before=JSON.stringify(await rec.find({organizationId:B}).toArray()),ownUnmatched=await rec.countDocuments({organizationId:A,status:'unmatched'});const auto=await api(P1,'/api/receipts/auto-match',tokenA,'POST',{minConfidence:85});assert.equal(auto.status,200,L('auto-match-scope'));assert.equal(JSON.stringify(await rec.find({organizationId:B}).toArray()),before,L('auto-match-scope'));
   assert.equal(auto.data.processed,ownUnmatched,L('auto-match-scope')+' only this company\'s receipts processed');
  });
  await stop(P2);P2=null;
  // ---- installed Chrome on the owned app and records
  if(!serverOnly)await tag('chrome-passed',async()=>{await require('./finance-navi-receipt-link-browser.cjs')({origin:P1.origin,db,ObjectId,A,B,email,password,tokenA,seedFactory:seedFactory(ObjectId,new Date('2026-05-20T03:00:00Z')),turn:(text,context)=>turn(tokenA,text,context),act,finish,worker,readReceipt,pause,label:L,rule:(point,r)=>rule(P1,point,r),release:point=>release(P1,point)})});
  // ---- count-only read-only audit over the owned database
  await tag('audit',async()=>{
   const {audit}=require('./finance-receipt-link-audit.cjs'),window={from:new Date('2026-01-01T00:00:00.000Z'),to:new Date('2027-01-01T00:00:00.000Z')};
   const before=await audit(db,window);
   await seed([{organizationId:A,hasReceipt:true},{organizationId:A,hasReceipt:true}],[
    ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id}),
    ts=>({organizationId:A,status:'matched',transactionId:ts[0]._id}),
    ts=>({organizationId:B,status:'matched',transactionId:ts[0]._id}),
    ts=>({organizationId:A,linkSync:{rev:'audit-old-work',pending:true,state:'manual_review',reason:'retries_exhausted',work:[{transactionId:ts[1]._id,event:null,key:'audit-old-work'}],attempts:10}})
   ]);
   const after=await audit(db,window);
   assert.equal(after.receipts.linkSameCompany-before.receipts.linkSameCompany,2,L('audit')+' counts each same-company receipt');
   assert.equal(after.receipts.linkOtherCompany-before.receipts.linkOtherCompany,1,L('audit')+' counts each foreign receipt separately');
   assert.equal(after.transactions.checked-before.transactions.checked,2,L('audit')+' includes an unlinked receipt\'s old owed target');
   assert.equal(after.transactions.storedTrueExpectedFalse-before.transactions.storedTrueExpectedFalse,1,L('audit')+' detects stale old-target badge');
   const out=await new Promise(resolve=>{const c=spawn(process.execPath,[path.join(__dirname,'finance-receipt-link-audit.cjs'),'--from','2026-01-01T00:00:00.000Z','--to','2027-01-01T00:00:00.000Z'],{windowsHide:true,env:{...cleanEnv(),OMF_AUDIT_MONGO_URI:uri,OMF_AUDIT_DB:dbName},stdio:['ignore','pipe','pipe']});let s='';c.stdout.on('data',v=>s+=v);c.stderr.on('data',v=>s+=v);c.on('exit',code=>resolve({code,s}))});
   assert.equal(out.code,0,L('audit')+' '+out.s.slice(0,500));const report=JSON.parse(out.s.slice(out.s.indexOf('{')));
   for(const secret of['RL_PRIVATE','RL synthetic shop','PRIVATE_B','@example.invalid',String(A),String(B)])assert.ok(!out.s.includes(secret),L('audit')+' no identifiers or content '+secret);
   assert.ok(report.receipts.total>0&&Number.isInteger(report.transactions.flagDisagree),L('audit')+' counts present');assert.equal(report.readOnly,true,L('audit'));
   assert.equal(report.receiptSync.manualReview,await rec.countDocuments({'linkSync.state':'manual_review'}),L('audit')+' manual review count');
  });
  const failed=results.filter(r=>!r.pass);console.log('RECEIPT-LINK RESULT '+JSON.stringify({results,barrierReady}));
  console.log((results.length-failed.length)+' of '+results.length+' receipt-link durability tags passed');
  if(failed.length)process.exitCode=1;
 }finally{for(const app of[...apps]){app.child.kill();await app.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{})}
}
module.exports=group;module.exports.standalone=standalone;module.exports.converged=converged;
if(require.main===module)standalone().catch(e=>{console.error(e);process.exitCode=1});

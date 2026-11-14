const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),{ObjectId}=require('mongodb');
module.exports=async({db,call,token,other,deviceToken,origin,pass,root,directory})=>{
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),oid=()=>new ObjectId();
 const owner=await db.collection('users').findOne({email:'finance-a@example.invalid'}),device=await db.collection('financecollectors').findOne({tokenHash:hash(deviceToken)}),accountId=oid(),templateId=oid();
 const pc='b'.repeat(32),generation='c'.repeat(32),grant='d'.repeat(64),publicOrigin='https://omf-learning.example.invalid',stamp=hash(JSON.stringify([owner.password,!!owner.twoFactorEnabled,owner.twoFactorSecret||'']));
 await db.collection('financebankaccounts').insertOne({_id:accountId,ownerId:owner._id,name:'HTTP synthetic bank',connection:null});
 await db.collection('financebanktemplates').insertOne({_id:templateId,ownerId:owner._id,name:'HTTP synthetic CSV',headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative',revision:1});
 await db.collection('financecollectors').updateOne({_id:device._id},{$addToSet:{bankAccountIds:accountId}});
 await db.collection('collectorinstallations').insertOne({_id:pc,ownerId:owner._id,collectorId:device._id,generation,publicKey:'synthetic',fingerprint:'synthetic',origin:publicOrigin,trustHash:'synthetic-trust',authStamp:stamp,accountIds:device.accountIds});
 await db.collection('collectorgrants').insertOne({_id:hash(grant),ownerId:owner._id,collectorId:device._id,installationId:pc,generation,origin:publicOrigin,accountIds:device.accountIds,authStamp:stamp,trustHash:'synthetic-trust',expiresAt:new Date(Date.now()+600000),revokedAt:null});
 async function pcCall(route,body,proof=grant){
  const response=await fetch(origin+'/api/finance-bank-learning/pc/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+deviceToken,'X-Collector-Grant':proof,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};
 }
 const api=(route,body,t=token)=>call('/api/finance-bank-learning/'+route,{token:t,...(body?{method:'POST',body}:{})});
 if(process.env.OMF_TEST_LOGIN_UI_ONLY){await require('./finance-bank-learning-page-http.cjs')({db,api,pcCall,token,origin,root,directory,accountId,templateId,pc,workerToken:process.env.OMF_BANK_LEARNING_WORKER_TOKEN,pass});return;}
 if(process.env.OMF_TEST_LOGIN_ENTRY_ONLY){await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken:process.env.OMF_BANK_LEARNING_WORKER_TOKEN,directory,root,pass,teachLogin:true,privateEntry:true});return;}
 if(process.env.OMF_TEST_LOGIN_REFUSAL_ONLY){await require('./finance-bank-learning-refusal-http.cjs')({db,api,pcCall,root,directory,owner,device,pc,generation,publicOrigin,workerToken:process.env.OMF_BANK_LEARNING_WORKER_TOKEN,token,origin,pass});return;}
 if(process.env.OMF_TEST_LOGIN_LEARNING_ONLY){
  const workerToken=process.env.OMF_BANK_LEARNING_WORKER_TOKEN;
  await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass,teachLogin:true});await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass,teachLogin:true,privateEntry:true});await require('./finance-bank-learning-workflow-http.cjs')({db,api,pcCall,root,directory,owner,device,pc,generation,publicOrigin,workerToken,pass});await require('./finance-bank-learning-refusal-http.cjs')({db,api,pcCall,root,directory,owner,device,pc,generation,publicOrigin,workerToken,token,origin,pass});return;
 }
 const input={bankAccountId:String(accountId),installationId:pc,templateId:String(templateId),entryOrigin:'https://bank.example.invalid',period:{from:'2026-10-01',to:'2026-10-02'},companyAccountConfirmed:true};
 assert.equal((await api('sessions')).status,200);assert.equal((await api('sessions',input,other)).status,403);
 const created=await api('sessions',input);assert.equal(created.status,200,JSON.stringify(created));const key=created.data.session.id;
 assert.equal((await pcCall('sessions',undefined,'')).status,403,'poll token cannot authorize learning');assert.equal((await pcCall('sessions')).data.sessions[0].id,key);
 const started=await pcCall(key+'/start',{});assert.equal(started.status,200,JSON.stringify(started));
 const contract=await import(require('node:url').pathToFileURL(path.join(root,'shared/finance-bank-learning.mjs')).href);
 const evidence={schema:1,runtime:contract.LEARNING_RUNTIME,origins:[input.entryOrigin],events:contract.LEARNING_ROLES.map((role,i)=>({id:'e'+i,document:'d0',frame:'f0',popup:'p0',origin:input.entryOrigin,role,tag:'text'})),complete:true,truncated:false};
 assert.equal((await pcCall(key+'/evidence',{claim:started.data.claim,evidence:{...evidence,password:'MUST-NOT-BE-STORED'}})).status,400);
 assert.equal((await pcCall(key+'/evidence',{claim:started.data.claim,evidence})).status,200);await pcCall(key+'/finish',{claim:started.data.claim});
 await db.collection('financebanklearnings').updateOne({_id:new ObjectId(key)},{$set:{queuedAt:new Date(Date.now()-16*60000)}});
 const unavailable=(await api('sessions')).data.sessions.find(s=>s.id===key);assert.equal(unavailable.state,'failed');assert.equal(unavailable.lastCode,'worker_failed');assert.deepEqual(unavailable.missing,['worker_unavailable']);
 assert.equal((await api(key+'/retry-development',{})).status,200);assert.equal((await api('sessions')).data.sessions.find(s=>s.id===key).state,'queued','development-only retry resets the queue age');
 const workerToken=process.env.OMF_BANK_LEARNING_WORKER_TOKEN;assert.ok(workerToken&&workerToken.startsWith('synthetic-'));
 assert.equal((await api('worker/claim',{})).status,401);
 const claimed=await api('worker/claim',{},workerToken);assert.equal(claimed.status,200,JSON.stringify(claimed));let job=claimed.data.job;assert.equal(job.model,'gpt-6.1-sol');
 const beforeBad=await db.collection('financebanklearnings').findOne({_id:new ObjectId(key)});const badMissing=await api('worker/'+key+'/result',{epoch:job.epoch,claim:job.claim,result:{model:job.model,runtime:job.runtime,evidenceHash:job.evidenceHash,missing:['invented_model_action'],tests:[]}},workerToken);assert.equal(badMissing.status,400);assert.deepEqual((await db.collection('financebanklearnings').findOne({_id:new ObjectId(key)})).workerReceipt,beforeBad.workerReceipt);
 // F6: actual owner and PC HTTP polls must not fail work queued behind a live developer.
 const waitingAccount=oid();await db.collection('financebankaccounts').insertOne({_id:waitingAccount,ownerId:owner._id,name:'HTTP waiting bank',connection:null});await db.collection('financecollectors').updateOne({_id:device._id},{$addToSet:{bankAccountIds:waitingAccount}});
 const waitingCreated=await api('sessions',{...input,bankAccountId:String(waitingAccount)});assert.equal(waitingCreated.status,200);const waiting=waitingCreated.data.session.id;
 const waitingPc=await pcCall(waiting+'/start',{});assert.equal(waitingPc.status,200);assert.equal((await pcCall(waiting+'/evidence',{claim:waitingPc.data.claim,evidence})).status,200);await pcCall(waiting+'/finish',{claim:waitingPc.data.claim});
 await db.collection('financebanklearnings').updateOne({_id:new ObjectId(waiting)},{$set:{queuedAt:new Date(Date.now()-16*60000)}});
 assert.equal((await api('sessions')).data.sessions.find(s=>s.id===waiting).state,'queued');assert.equal((await pcCall('sessions')).status,200);assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(waiting)})).state,'queued');
 await db.collection('financebanklearnings').updateOne({_id:new ObjectId(key)},{$set:{leaseUntil:new Date(0)}});await pcCall('sessions');assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(waiting)})).state,'failed');assert.equal((await api(waiting+'/retry-development',{})).status,200);assert.equal((await api(waiting+'/cancel',{})).status,200);
 pass('F6 built owner/PC HTTP polls preserve old queues behind a live developer; expiry reaches the existing retry lane');
 // F5: permanently rejected results across epochs cannot buy a fourth lease.
 for(let attempt=2;attempt<=3;attempt++){
  const reclaimed=await api('worker/claim',{},workerToken);assert.equal(reclaimed.status,200);job=reclaimed.data.job;assert.equal(job.id,key);assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(key)})).attempts,attempt);
  const rejected=await api('worker/'+key+'/result',{epoch:job.epoch,claim:job.claim,result:{model:'rejected-model',runtime:job.runtime,evidenceHash:job.evidenceHash,missing:['worker_unavailable'],tests:[]}},workerToken);assert.equal(rejected.status,400);assert.equal((await api('worker/claim',{},workerToken)).data.job,null,'a live third lease is not failed early');await db.collection('financebanklearnings').updateOne({_id:new ObjectId(key)},{$set:{leaseUntil:new Date(0)}});
 }
 assert.equal((await api('worker/claim',{},workerToken)).data.job,null);const exhausted=(await api('sessions')).data.sessions.find(s=>s.id===key);assert.equal(exhausted.state,'failed');assert.equal(exhausted.lastCode,'worker_failed');assert.deepEqual(exhausted.missing,['worker_unavailable']);assert.equal((await api(key+'/retry-development',{})).status,200);
 const reset=await db.collection('financebanklearnings').findOne({_id:new ObjectId(key)});assert.equal(reset.attempts,0);assert.equal(reset.evidenceHash,beforeBad.evidenceHash);assert.deepEqual(reset.evidence,beforeBad.evidence);
 job=(await api('worker/claim',{},workerToken)).data.job;assert.equal(job.id,key);assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(key)})).attempts,1);
 pass('F5 built authenticated HTTP rejects repeated results, caps epochs, and permits explicit retry with the original recording');
 const candidate={schema:1,runtime:job.runtime,evidenceHash:job.evidenceHash,steps:evidence.events.map(e=>({eventId:e.id,op:e.role}))};
 const result={model:job.model,runtime:job.runtime,evidenceHash:job.evidenceHash,candidate,tests:['schema','provenance']};
 const accepted=await api('worker/'+key+'/result',{epoch:job.epoch,claim:job.claim,result},workerToken);assert.equal(accepted.status,200,JSON.stringify(accepted));
 assert.equal((await api('worker/'+key+'/result',{epoch:job.epoch,claim:job.claim,result},workerToken)).status,200,'lost worker ack is idempotent');
 // F7: completing a job must not strand an older queued job during the consumer's next-claim pause.
 async function queueHandoffProbe(bankAccountId=waitingAccount){
  const created=await api('sessions',{...input,bankAccountId:String(bankAccountId)});assert.equal(created.status,200);const id=created.data.session.id,pc=await pcCall(id+'/start',{});assert.equal(pc.status,200);
  assert.equal((await pcCall(id+'/evidence',{claim:pc.data.claim,evidence})).status,200);await pcCall(id+'/finish',{claim:pc.data.claim});await db.collection('financebanklearnings').updateOne({_id:new ObjectId(id)},{$set:{queuedAt:new Date(Date.now()-16*60000)}});return id;
 }
 const handoff=await queueHandoffProbe();assert.equal((await api('sessions')).data.sessions.find(s=>s.id===handoff).state,'queued','recent completion protects the owner-poll handoff');assert.equal((await pcCall('sessions')).status,200);assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(handoff)})).state,'queued','recent completion protects the PC-poll handoff');
 const handoffClaim=await api('worker/claim',{},workerToken);assert.equal(handoffClaim.status,200);const handoffJob=handoffClaim.data.job;assert.equal(handoffJob.id,handoff,'the next worker claim receives the waiting job without manual retry');
 assert.equal((await api('worker/'+handoff+'/result',{epoch:handoffJob.epoch,claim:handoffJob.claim,result:{...result,evidenceHash:handoffJob.evidenceHash,candidate:{...candidate,evidenceHash:handoffJob.evidenceHash}}},workerToken)).status,200);assert.equal((await api(handoff+'/cancel',{})).status,200);
 const absent=await queueHandoffProbe();await db.collection('financebanklearnings').updateMany({'workerReceipt.at':{$exists:true}},{$set:{'workerReceipt.at':new Date(Date.now()-181000)}});await pcCall('sessions');const unavailableAfterGrace=(await api('sessions')).data.sessions.find(s=>s.id===absent);assert.equal(unavailableAfterGrace.state,'failed');assert.equal(unavailableAfterGrace.lastCode,'worker_failed');assert.deepEqual(unavailableAfterGrace.missing,['worker_unavailable']);assert.equal((await api(absent+'/cancel',{})).status,200);
 pass('F7 built completion → owner/PC polls → next claim proceeds automatically; stale receipts restore the unavailable-worker retry lane');
 // F8: retry keeps real activity time, but an old payload must not ACK a new epoch.
 const retryWaitAccount=oid();await db.collection('financebankaccounts').insertOne({_id:retryWaitAccount,ownerId:owner._id,name:'HTTP retry waiting bank',connection:null});await db.collection('financecollectors').updateOne({_id:device._id},{$addToSet:{bankAccountIds:retryWaitAccount}});
 const retrying=await queueHandoffProbe(),retryJob=(await api('worker/claim',{},workerToken)).data.job;assert.equal(retryJob.id,retrying);const retryWaiting=await queueHandoffProbe(retryWaitAccount);
 const failure={model:retryJob.model,runtime:retryJob.runtime,evidenceHash:retryJob.evidenceHash,missing:['worker_unavailable'],tests:[]};assert.equal((await api('worker/'+retrying+'/result',{epoch:retryJob.epoch,claim:retryJob.claim,result:failure},workerToken)).status,200);assert.equal((await api(retrying+'/retry-development',{})).status,200);
 assert.equal((await api('sessions')).data.sessions.find(s=>s.id===retryWaiting).state,'queued');await pcCall('sessions');assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(retryWaiting)})).state,'queued');assert.equal((await api('worker/'+retrying+'/result',{epoch:retryJob.epoch,claim:retryJob.claim,result:failure},workerToken)).status,409);
 const retriedJob=(await api('worker/claim',{},workerToken)).data.job;assert.equal(retriedJob.id,retrying);assert.ok(retriedJob.epoch>retryJob.epoch);assert.equal((await api('worker/'+retrying+'/result',{epoch:retriedJob.epoch,claim:retriedJob.claim,result:failure},workerToken)).status,200);assert.equal((await api('sessions')).data.sessions.find(s=>s.id===retrying).state,'failed','same payload in a fresh epoch actually finishes that epoch');
 const afterRetry=(await api('worker/claim',{},workerToken)).data.job;assert.equal(afterRetry.id,retryWaiting);assert.equal((await api('worker/'+retryWaiting+'/result',{epoch:afterRetry.epoch,claim:afterRetry.claim,result:{...result,evidenceHash:afterRetry.evidenceHash,candidate:{...candidate,evidenceHash:afterRetry.evidenceHash}}},workerToken)).status,200);assert.equal((await api(retrying+'/cancel',{})).status,200);assert.equal((await api(retryWaiting+'/cancel',{})).status,200);
 const staleRetry=await queueHandoffProbe(),staleJob=(await api('worker/claim',{},workerToken)).data.job;assert.equal(staleJob.id,staleRetry);const staleWaiting=await queueHandoffProbe(retryWaitAccount);assert.equal((await api('worker/'+staleRetry+'/result',{epoch:staleJob.epoch,claim:staleJob.claim,result:{model:staleJob.model,runtime:staleJob.runtime,evidenceHash:staleJob.evidenceHash,missing:['worker_unavailable'],tests:[]}},workerToken)).status,200);
 await db.collection('financebanklearnings').updateMany({'workerReceipt.at':{$exists:true}},{$set:{'workerReceipt.at':new Date(Date.now()-181000)}});assert.equal((await api(staleRetry+'/retry-development',{})).status,200);await pcCall('sessions');assert.equal((await api('sessions')).data.sessions.find(s=>s.id===staleWaiting).state,'failed','manual retry cannot fabricate current worker activity');assert.equal((await api(staleRetry+'/cancel',{})).status,200);assert.equal((await api(staleWaiting+'/cancel',{})).status,200);
 pass('F8 built immediate retry preserves waiting jobs, fences old ACKs, finishes identical fresh-epoch payloads, and keeps stale activity stale');
 const list=await api('sessions');assert.equal(list.data.sessions.find(s=>s.id===key).state,'candidate');assert.equal((await api('sessions',undefined,other)).data.sessions.length,0);
 await db.collection('collectorinstallations').updateOne({_id:pc},{$set:{generation:'changed-generation'}});assert.equal((await pcCall('sessions')).status,401,'retired PC generation is denied');
 await db.collection('collectorinstallations').updateOne({_id:pc},{$set:{generation}});
 pass('built HTTP owner/company/PC/worker boundaries and durable candidate/duplicate result passed; fixture generation only');
 await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass});
 await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass,splitDates:true});
 for(const wholeDateRole of ['from','to'])await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass,splitDates:true,wholeDateRole});
 await require('./finance-bank-learning-collection-http.cjs')({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass,splitDates:true,dateNavigation:true});
 const puppeteer=await import('puppeteer-core'),browser=await puppeteer.default.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:path.join(directory,'learning-ui-profile')});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setViewport({width:390,height:844});await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/');
  await page.evaluate(accessToken=>{const session=JSON.parse(localStorage.getItem('ohmyfinance_session'));session.tokens.accessToken=accessToken;localStorage.setItem('ohmyfinance_session',JSON.stringify(session));},token);
  await page.goto(origin+'/bank-learning',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.textContent.includes('HTTP synthetic bank'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile learning page has no horizontal overflow');
  const artifacts=process.env.OMF_TEST_LEARNING_ARTIFACTS||directory;await require('node:fs/promises').mkdir(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'bank-learning-mobile.png'),fullPage:true});
  await page.setViewport({width:1440,height:1000});await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:path.join(artifacts,'bank-learning-dark.png'),fullPage:true});
  assert.deepEqual(errors,[],'learning page has no browser errors');pass('native learning page renders real persisted candidate in mobile/desktop dark mode'+(process.env.OMF_TEST_LEARNING_ARTIFACTS?'; screenshots retained at '+artifacts:'; screenshots are temporary'));
 }finally{await browser.close()}
};

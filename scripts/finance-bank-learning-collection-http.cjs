// Real built OMF routes + real pinned Chrome recorder/replayer + DPAPI + ordinary BankJob upload and row ingestion.
// Default generation is deterministic fixture output. A real worker requires the explicit private-config opt-in below.
const assert=require('node:assert/strict'),path=require('node:path'),https=require('node:https'),fs=require('node:fs/promises'),{ObjectId}=require('mongodb'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
module.exports=async({db,call,api,pcCall,token,other,deviceToken,origin,publicOrigin,pc,generation,owner,device,workerToken,directory,root,pass})=>{
 const contract=await import(pathToFileURL(path.join(root,'shared/finance-bank-learning.mjs')).href),learning=await import(pathToFileURL(path.join(root,'collector/bank-learning.mjs')).href),{runBankJob}=await import(pathToFileURL(path.join(root,'collector/index.mjs')).href);
 const puppeteer=createRequire(path.join(root,'collector/package.json'))('rebrowser-puppeteer-core'),accountId=new ObjectId(),templateId=new ObjectId(),pcRoot=path.join(directory,'learned-pc');
 const oldConnection={provider:'rakuten',variant:'standard',templateId:String(templateId),transactionIdConfirmed:false};
 await db.collection('financebankaccounts').insertOne({_id:accountId,ownerId:owner._id,name:'Learned collection bank',currency:'JPY',connection:oldConnection,schedule:null,balanceSetting:null});
 await db.collection('financebanktemplates').insertOne({_id:templateId,ownerId:owner._id,name:'Learned collection CSV',headers:['date','description','amount'],mapping:{date:'0',description:'1',amount:'2'},amountSign:'outflow-negative',revision:1});
 await db.collection('financecollectors').updateOne({_id:device._id},{$addToSet:{bankAccountIds:accountId}});
 const keyFile=path.join(directory,'synthetic-bank.key'),certFile=path.join(directory,'synthetic-bank.pem');
 await require('node:util').promisify(require('node:child_process').execFile)('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',keyFile,'-out',certFile,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-days','1'],{windowsHide:true});
 const portal=https.createServer({key:await fs.readFile(keyFile),cert:await fs.readFile(certFile)},(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url.startsWith('/signin')){res.setHeader('Set-Cookie','session=synthetic-owned-bank; HttpOnly; SameSite=Strict');res.writeHead(302,{Location:'/home'});res.end();return;}
  if(req.url==='/logout'){res.setHeader('Set-Cookie','session=; Max-Age=0; HttpOnly');res.end('<p>ログアウト済み</p>');return;}
  if(req.url.startsWith('/csv')){const q=new URL(req.url,'http://localhost').searchParams;res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="owned.csv"');res.end('date,description,amount\r\n'+q.get('from')+',Synthetic learned supplier,-1234\r\n');return;}
  if(!req.headers.cookie?.includes('session=')){res.end('<form action="/signin"><input id="password" type="password"><button id="signin">Sign in</button></form>');return;}
  if(req.url==='/home'){res.end('<button id="inquiry" onclick="location.href=\'/details\'">照会</button>');return;}
  res.end(`<select id="account"><option value="">選択</option><option value="PRIVATE-ACCOUNT">Ordinary account</option></select><input id="from"><input id="to"><button id="export" onclick="location.href='/csv?from='+document.getElementById('from').value+'&to='+document.getElementById('to').value">CSV出力</button><span id="balance">100,000</span><button id="logout" onclick="location.href='/logout'">ログアウト</button>`);
 });
 await new Promise(resolve=>portal.listen(0,'127.0.0.1',resolve));const bankOrigin='https://127.0.0.1:'+portal.address().port;
 const created=await api('sessions',{bankAccountId:String(accountId),installationId:pc,templateId:String(templateId),entryOrigin:bankOrigin,period:{from:'2026-10-01',to:'2026-10-02'},companyAccountConfirmed:true});assert.equal(created.status,200,JSON.stringify(created));const id=created.data.session.id;
 const delayed=new Set();
 const remote={learningIdentity:{installationId:pc,generation},learning:async(route,body)=>{
  const action=route.split('/').pop();if(['evidence','receipt'].includes(action)&&!delayed.has(action)){
   delayed.add(action);await db.collection('financebanklearnings').updateOne({_id:new ObjectId(id)},{$set:{pcLeaseUntil:new Date(0)}});assert.equal((await pcCall('sessions')).status,200);assert.equal((await db.collection('financebanklearnings').findOne({_id:new ObjectId(id)})).lastCode,'interrupted_pc_action');
  }
  const response=await pcCall(route,body);if(response.status!==200)throw Object.assign(new Error('synthetic-pc-request-failed'),{status:response.status});return response.data;
 }};
 const live={mode:'protected',abort:new AbortController(),broker:{remote}};let launches=0;
 let notifyLogin;const firstLogin=new Promise(resolve=>{notifyLogin=resolve;});
 const login=async page=>{await page.waitForSelector('#password');await page.type('#password','PRIVATE-SYNTHETIC-PASSWORD');await Promise.all([page.waitForNavigation(),page.click('#signin')]);notifyLogin();};
 async function demonstrate(page){
  const operate=async(role,fn)=>{await page.waitForSelector('#omf-learning-control select');await page.select('#omf-learning-control select',role);const before=(await learning.learningStore(pcRoot,id).read()).record?.events?.length||0;await fn();let recorded=false;for(let i=0;i<100;i++){const n=(await learning.learningStore(pcRoot,id).read()).record?.events?.length||0;if(n>before){recorded=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(recorded,'actual DPAPI event '+role);};
  await operate('inquiry',()=>Promise.all([page.waitForNavigation(),page.click('#inquiry')]));await operate('account',()=>page.select('#account','PRIVATE-ACCOUNT'));
  for(const role of ['from','to'])await operate(role,async()=>{await page.type('#'+role,role==='from'?'2026-10-01':'2026-10-02');await page.$eval('#'+role,e=>e.blur());});
  await operate('export',()=>page.click('#export'));await operate('balance',()=>page.click('#balance'));await operate('logout',()=>Promise.all([page.waitForNavigation(),page.click('#logout')]));
  await page.waitForSelector('#omf-learning-control button');await page.click('#omf-learning-control button');
 }
 const browserFor=recording=>async(_bound,_root,_batch,_launch,fn)=>{
  launches++;const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,acceptInsecureCerts:true,userDataDir:path.join(directory,'collection-profile-'+launches)});
  try{const page=await browser.newPage(),operation=fn(page,browser);void operation.catch(()=>{});if(recording)await Promise.all([operation,firstLogin.then(()=>demonstrate(page))]);else await operation;}finally{await browser.close();}
 };
 try{
  await learning.runBankLearning({id,action:'start',remote,root:pcRoot,live,origin:publicOrigin,browser:browserFor(true),login,test:true});
  let row=await db.collection('financebanklearnings').findOne({_id:new ObjectId(id)});assert.equal(row.state,'queued');assert.equal((await learning.learningStore(pcRoot,id).read()).binding.generation,generation,'real server view carries the generation');
  assert.ok(!JSON.stringify(row.evidence).includes('PRIVATE-'));
  let candidate;
  if(process.env.OMF_TEST_LEARNING_REAL_WORKER){
   candidate=await require('C:/Users/Junsan2/Documents/ohmycode/output/plan/omf-bank-learning-build-20261108/real-worker-native-helper.cjs')({db,id,origin,workerToken,directory,root,keyFile,certFile});
   pass('actual Sol consumer claimed the native queued recording; accepted result ACK loss recovered without a second model invocation');
  }else{
   const claimed=await api('worker/claim',{},workerToken);assert.equal(claimed.status,200);const job=claimed.data.job;assert.equal(job.id,id);
   candidate={schema:1,runtime:job.runtime,evidenceHash:job.evidenceHash,steps:job.evidence.events.map(e=>({eventId:e.id,op:e.role}))};
   assert.equal((await api('worker/'+id+'/result',{epoch:job.epoch,claim:job.claim,result:{model:job.model,runtime:job.runtime,evidenceHash:job.evidenceHash,candidate,tests:['schema','provenance']}},workerToken)).status,200);
  }
  assert.equal((await api(id+'/replay',{period:{from:'2026-11-01',to:'2026-11-02'}})).status,200);
  await learning.runBankLearning({id,action:'replay',remote,root:pcRoot,live,origin:publicOrigin,browser:browserFor(false),login,test:true});
  row=await db.collection('financebanklearnings').findOne({_id:new ObjectId(id)});assert.equal(row.state,'verified');
  assert.equal((await api(id+'/enable',{expectedSelectionHash:null})).status,400,'attendance is explicitly confirmed');
  const selected=await api(id+'/enable',{expectedSelectionHash:null,attendedConfirmed:true});assert.equal(selected.status,200,JSON.stringify(selected));const firstSelection=selected.data.selectionHash;
  assert.equal((await api(id+'/enable',{expectedSelectionHash:null,attendedConfirmed:true})).data.selectionHash,firstSelection,'lost enable ack reuses the same activation');
  assert.deepEqual((await db.collection('financebankaccounts').findOne({_id:accountId})).connection,oldConnection,'activation preserves the native connection');
  const missingDates=await call('/api/finance-payments/bank/accounts/'+accountId+'/sync',{token,method:'POST',body:{}});assert.equal(missingDates.status,400,JSON.stringify(missingDates));assert.ok(missingDates.data.data.message.includes('銀行の手順を覚える'));assert.equal(await db.collection('financebankjobs').countDocuments({bankAccountId:accountId,open:true}),0,'invalid sync does not create a job');
  const waitingBalance=require('node:crypto').randomUUID();await db.collection('financebankjobs').insertOne({_id:new ObjectId(),ownerId:owner._id,bankAccountId:accountId,jobId:waitingBalance,kind:'balance',state:'queued',open:true,requestedAt:new Date(),snapshot:{kind:'balance',provider:'rakuten',variant:'standard'},snapshotHash:'0'.repeat(64),balance:{trigger:'hourly',collectorId:device._id,revision:1}});
  const collection={period:{from:'2026-11-03',to:'2026-11-04'},expectedSelectionHash:firstSelection};let queued=await api(id+'/collect',collection);assert.equal(queued.status,200,JSON.stringify(queued));
  assert.equal((await db.collection('financebankjobs').findOne({jobId:waitingBalance})).state,'superseded','native queued balances yield to a manual learned statement request');
  assert.equal((await api(id+'/collect',collection)).data.job.jobId,queued.data.job.jobId,'repeated queue request returns its existing job');
  assert.equal((await api(id+'/disable',{expectedSelectionHash:'0'.repeat(64)})).status,409,'stale deselection cannot remove a newer selection');
  await db.collection('collectorinstallations').updateOne({_id:pc},{$set:{generation:'retired-for-claim-test'}});
  const retired=await call('/api/finance-payments/collector/bank/claim',{token:deviceToken,method:'POST',body:{capabilities:[contract.LEARNING_STATEMENT_CAPABILITY]}});assert.equal(retired.data.job,null,'a retired PC generation cannot run the selected recipe');
  assert.equal((await db.collection('financebankjobs').findOne({jobId:queued.data.job.jobId})).state,'superseded');
  await db.collection('collectorinstallations').updateOne({_id:pc},{$set:{generation}});
  queued=await api(id+'/collect',collection);assert.equal(queued.status,200);
  assert.equal((await api(id+'/disable',{expectedSelectionHash:firstSelection})).status,200);
  assert.equal((await db.collection('financebankjobs').findOne({jobId:queued.data.job.jobId})).state,'superseded');
  const reselected=await api(id+'/enable',{expectedSelectionHash:null,attendedConfirmed:true});assert.equal(reselected.status,200);assert.notEqual(reselected.data.selectionHash,firstSelection,'reselection has a new activation identity');
  queued=await api(id+'/collect',{...collection,expectedSelectionHash:reselected.data.selectionHash});assert.equal(queued.status,200);
  await db.collection('financebanktemplates').updateOne({_id:templateId},{$set:{mapping:{date:'2',description:'0',amount:'1'}}});
  const nativeCall=(route,body,bytes)=>call('/api/finance-payments/collector/'+route,{token:deviceToken,method:'POST',body:bytes||body,raw:!!bytes});
  const otherToken='omfc_'+require('node:crypto').randomBytes(32).toString('hex');await db.collection('financecollectors').insertOne({_id:new ObjectId(),ownerId:owner._id,name:'Other synthetic collection PC',tokenHash:require('node:crypto').createHash('sha256').update(otherToken).digest('hex'),accountIds:device.accountIds,bankAccountIds:[accountId],revokedAt:null});
  const otherClaim=await call('/api/finance-payments/collector/bank/claim',{token:otherToken,method:'POST',body:{capabilities:[contract.LEARNING_STATEMENT_CAPABILITY]}});assert.equal(otherClaim.data.job,null,'another allowed PC cannot run this local recording');
  assert.equal((await nativeCall('bank/claim',{capabilities:[]})).data.job,null,'old collector never receives a learned job');
  const right=await nativeCall('bank/claim',{capabilities:[contract.LEARNING_STATEMENT_CAPABILITY]});assert.equal(right.status,200);const bank=right.data;assert.equal(bank.job.jobId,queued.data.job.jobId);assert.equal(bank.job.snapshot.mapping.date,'0','job interpretation was frozen before the template edit');
  const status=async(state,message)=>{const r=await nativeCall('bank/status',{jobId:bank.job.jobId,state,message});assert.equal(r.status,200,JSON.stringify(r));};
  let lost=true,uploads=0;
  const upload=async(_config,_account,item,_live,{query})=>{
   const r=await nativeCall('bank/upload?'+new URLSearchParams(query),null,await fs.readFile(path.join(item.directory,item.manifest.filename)));assert.equal(r.status,200,JSON.stringify(r));uploads++;
   if(lost){lost=false;throw new Error('synthetic-lost-upload-ack');}
   await fs.writeFile(path.join(item.directory,'manifest.json'),JSON.stringify({...item.manifest,acknowledgedAt:new Date().toISOString()}));return r.data;
  };
  const options={status,directory:pcRoot,upload,learnedCollect:(bound,job,root,status,opts)=>learning.collectLearnedStatement(bound,job,root,status,{...opts,browser:browserFor(false),login,test:true})};
  const before=launches;await assert.rejects(runBankJob(bank,{baseUrl:publicOrigin},live,options),/synthetic-lost-upload-ack/);assert.equal(launches,before+1);
  const count=()=>db.collection('financebankrows').countDocuments({bankAccountId:accountId});assert.equal(await count(),1,'first upload reached ordinary OMF row ingestion');
  // Simulated process loss after manifest publication but before the journal update/final ack; reclaim only the same frozen job.
  const PhaseVault=(await import(pathToFileURL(path.join(root,'collector/vault.mjs')).href)).Vault;
  await new PhaseVault(path.join(pcRoot,'bank-learning','jobs',bank.job.jobId)).update(value=>({...value,phase:'started'}));
  await db.collection('financebankjobs').updateOne({jobId:bank.job.jobId},{$set:{leaseUntil:new Date(0)}});
  const resumed=await nativeCall('bank/claim',{capabilities:[contract.LEARNING_STATEMENT_CAPABILITY]});assert.equal(resumed.data.job.jobId,bank.job.jobId);
  await runBankJob(resumed.data,{baseUrl:publicOrigin},live,options);assert.equal(launches,before+1,'lost acknowledgement never reopens the bank');assert.equal(await count(),1,'redelivery never duplicates a financial row');
  const imported=await db.collection('financebankrows').findOne({bankAccountId:accountId});assert.equal(imported.date,'2026-11-03');assert.equal(imported.amount,1234);assert.equal(imported.direction,'out');
  const completed=await db.collection('financebankjobs').findOne({jobId:bank.job.jobId});assert.equal(completed.state,'complete');assert.ok(completed.statementIds.length);
  const capture=await db.collection('financebankstatements').findOne({_id:completed.statementIds[0]});assert.equal(capture.capture.snapshot.learned.candidateHash,row.candidateHash);
  const interruptedQueue=await api(id+'/collect',{period:{from:'2026-11-05',to:'2026-11-06'},expectedSelectionHash:reselected.data.selectionHash});assert.equal(interruptedQueue.status,200);
  const interruptedClaim=await nativeCall('bank/claim',{capabilities:[contract.LEARNING_STATEMENT_CAPABILITY]});assert.equal(interruptedClaim.status,200);const interrupted=interruptedClaim.data,l=interrupted.job.snapshot.learned;
  const {Vault}=await import(pathToFileURL(path.join(root,'collector/vault.mjs')).href),journal=new Vault(path.join(pcRoot,'bank-learning','jobs',interrupted.job.jobId));
  await journal.update(()=>({binding:{sessionId:id,origin:publicOrigin,installationId:pc,generation,bankAccountId:String(accountId),ownerId:String(owner._id),jobId:interrupted.job.jobId,snapshotHash:interrupted.job.snapshotHash,selectionHash:l.selectionHash},phase:'started'}));
  const noRetry=await runBankJob(interrupted,{baseUrl:publicOrigin},live,{...options,status:async(state,message)=>{const r=await nativeCall('bank/status',{jobId:interrupted.job.jobId,state,message});assert.equal(r.status,200);}});
  assert.ok(noRetry.failed.includes('途中で止まった'));assert.equal(launches,before+1,'an interrupted action cannot resubmit a bank login');assert.equal(await count(),1);
  const clearRoute='/api/finance-payments/bank/accounts/'+String(accountId)+'/learned-selection';
  assert.equal((await call(clearRoute,{method:'PUT',token:other,body:{expectedSelectionHash:reselected.data.selectionHash}})).status,404,'another owner cannot clear this selection');
  const company=await db.collection('organizations').findOne({_id:row.companyId}),members=company.members;
  await db.collection('organizations').updateOne({_id:row.companyId},{$pull:{members:{userId:owner._id}}});
  assert.equal((await api(id+'/disable',{expectedSelectionHash:reselected.data.selectionHash})).status,403,'learning writes still require current company membership');
  const recovered=await call(clearRoute,{method:'PUT',token,body:{expectedSelectionHash:reselected.data.selectionHash}});assert.equal(recovered.status,200,'bank owner can restore the original connection after losing company membership');
  await db.collection('organizations').updateOne({_id:row.companyId},{$set:{members}});
  const final=await db.collection('financebankaccounts').findOne({_id:accountId});assert.equal(final.learningConnector,null);assert.deepEqual(final.connection,oldConnection);assert.equal(final.schedule,null);assert.equal(final.balanceSetting,null);
  pass('actual recorder → DPAPI → built queue/candidate/replay → version selection → native BankJob → real Chrome CSV → ordinary row ingestion; lost ack and interrupted action never reopened the bank; original connection restored after lost company membership; native balance/schedule preserved');
 }finally{await new Promise(resolve=>portal.close(resolve));}
};

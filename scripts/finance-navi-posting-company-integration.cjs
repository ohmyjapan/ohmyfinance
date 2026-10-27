// Navi legacy owner/purchase chat ledger posting through the actual built routes and the native company ledger writer.
// Synthetic users, companies and card statements in an owned disposable database only; no model, no provider, no network sends.
// Every final-state assertion carries a `navi-posting:` label so the fixture's defect leg can name the assertion a defect must flip.
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const{spawn}=require('node:child_process'),{MongoMemoryServer}=require('mongodb-memory-server'),{MongoClient,ObjectId}=require('mongodb'),jwt=require('jsonwebtoken');
const root=path.resolve(process.env.OMF_NAVI_POSTING_APP_ROOT||path.join(__dirname,'..')),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 assert.equal(process.env.OMF_NAVI_POSTING_FIXTURE,'owned','SETUP: run only through the owned fixture');
 let mongo,client,child,directory,logs='',groups=0;const pass=name=>{groups++;console.log('PASS '+name)};
 try{
  directory=await fsp.mkdtemp(path.join(os.tmpdir(),'omf-navi-posting-'));
  const binary=process.env.OMF_MONGOD_BINARY||path.resolve(__dirname,'../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});
  const uri=mongo.getUri('navi_posting_regression'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const origin='http://127.0.0.1:'+port,secret=crypto.randomBytes(32).toString('hex');
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:uri,MONGODB_URI:uri,NUXT_MONGO_URI:uri,OMF_DATA_DIR:directory,JWT_SECRET:secret,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:String(port),NITRO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.closed=new Promise(r=>child.once('exit',r));for(const stream of[child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',s=>{logs=(logs+s).slice(-30000)})}
  let healthy=false;for(let i=0;i<150&&!healthy;i++){try{const d=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).json();if(d.database?.connected){assert.equal(d.database.name,'navi_posting_regression');healthy=true}}catch{}if(!healthy)await pause(200)}if(!healthy)throw Error('SETUP owned server unavailable: '+logs.slice(-2000));
  client=await MongoClient.connect(uri);const db=client.db('navi_posting_regression');assert.equal(db.databaseName,'navi_posting_regression');
  const api=async(route,token,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':Buffer.isBuffer(body)?'text/csv':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}return{status:response.status,raw,data}};
  const ok=async(route,token,method='GET',body)=>{const r=await api(route,token,method,body);assert.equal(r.status,200,'navi-posting:positive '+method+' '+route+' '+r.raw.slice(0,400));return r.data};
  const transactions=db.collection('transactions'),entries=db.collection('financeentries'),bindings=db.collection('financeimportcompanies'),ops=db.collection('financeactionoperations'),organizations=db.collection('organizations'),assistants=db.collection('financeassistants'),chats=db.collection('financechats');
  const ledger=async()=>JSON.stringify(await Promise.all(['transactions','financeentries','financeimportcompanies'].map(n=>db.collection(n).find().sort({_id:1}).toArray())));
  // Owner P, companies A/B (P is a member) and C (P is not). Tokens are the native ones; the foreign one is a validly signed token of P naming C.
  const email='navi-posting-owner@example.invalid',plain=(await ok('/api/auth/register',null,'POST',{email,password:'Synthetic-password-Only1!',name:'Synthetic owner'})).tokens.accessToken,owner=(await db.collection('users').findOne({email}))._id;
  const A=new ObjectId(),B=new ObjectId(),C=new ObjectId(),now=new Date(),membersA=[{userId:owner,role:'owner',joinedAt:now}];
  await organizations.insertMany([{_id:A,name:'Synthetic posting company A',slug:'navi-posting-a',isActive:true,members:membersA},{_id:B,name:'Synthetic posting company B',slug:'navi-posting-b',isActive:true,members:[{userId:owner,role:'member',joinedAt:now}]},{_id:C,name:'PRIVATE_FOREIGN_COMPANY_C',slug:'navi-posting-c',isActive:true,members:[{userId:new ObjectId(),role:'owner',joinedAt:now}]}]);
  const tokenA=(await ok('/api/auth/switch-organization',plain,'POST',{organizationId:String(A)})).tokens.accessToken,tokenB=(await ok('/api/auth/switch-organization',plain,'POST',{organizationId:String(B)})).tokens.accessToken;
  const foreign=jwt.sign({userId:String(owner),email,organizationId:String(C),role:'owner',type:'access'},secret,{expiresIn:'10m'});
  const account=(await ok('/api/finance/accounts',plain,'POST',{name:'Navi posting Amex',provider:'amex',primaryCard:'12345',cardIdentifiers:['12345'],otpRecipient:'synthetic@example.invalid',otpMailbox:'synthetic@example.invalid'})).account;
  const refs={account:new ObjectId(),category:new ObjectId(),tax:new ObjectId()};await db.collection('accountcategories').insertOne({_id:refs.account,name:'Navi posting 通信費',type:'expense',isActive:true});await db.collection('transactioncategories').insertOne({_id:refs.category,name:'Navi posting 区分'});await db.collection('taxcategories').insertOne({organizationId:A,_id:refs.tax,name:'Navi posting 課税仕入 10%',rate:10});
  const ready={purpose:'company',accountCategoryId:String(refs.account),transactionCategoryId:String(refs.category),taxCategoryId:String(refs.tax),taxRate:10};
  const {HEADERS}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../shared/amex.mjs')).href);
  const csv=rows=>Buffer.from([HEADERS,...rows.map(([day,name,amount])=>['2026/08/'+day,'2026/08/'+day,name,'Synthetic user','12345',String(amount),'',''])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const upload=async rows=>{const r=await ok('/api/finance/accounts/'+account._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',plain,'POST',csv(rows));return db.collection('financeimports').findOne({_id:new ObjectId(r.id)})};
  const s1=await upload([['02','Posting shop two',1102],['03','Posting shop three',1103],['04','Posting shop four',1104],['05','Posting shop five',1105],['06','Posting shop six',1106],['07','Posting shop seven',1107],['08','Posting shop eight',1108],['09','Posting shop nine',1109],['10','Posting shop ten',1110]]),importId=String(s1._id);
  const agent=await ok('/api/finance-chat/agents',plain,'POST',{accountIds:[String(account._id)],workspaceEnabled:true});
  const worker=(route,body={})=>api('/api/finance-chat/worker/'+route,agent.token,'POST',body);await worker('heartbeat',{});
  const act=(job,slot,name,args={})=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/actions',{lease:job.lease,slot,name,args});
  const acted=async(job,slot,name,args)=>{const r=await act(job,slot,name,args);assert.equal(r.status,200,'navi-posting:action '+name+' slot '+slot+' '+r.raw.slice(0,400));return r.data};
  const finish=(job,summary)=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/result',{lease:job.lease,proposal:{kind:'unclear',summary,patch:{},quotes:{}}});
  const wsEndpoint='/api/finance-chat/workspace';
  const wsSend=async(token,text,extra={},requestId=crypto.randomUUID())=>{const view=await ok(wsEndpoint,token);return{requestId,response:await api(wsEndpoint,token,'POST',{text,requestId,chatRevision:view.conversation?.revision||0,context:{page:'mapping',importId},...extra})}};
  const wsTurn=async(token,text,extra)=>{const sent=await wsSend(token,text,extra);assert.equal(sent.response.status,200,'navi-posting:discussion-send '+sent.response.raw.slice(0,300));const claimed=await worker('workspace-claim');assert.ok(claimed.data?.job,'workspace claim');assert.equal(claimed.data.job.text,text);return{...sent,job:claimed.data.job}};
  const prepare=async(job,slot,line,id=importId)=>{const saved=await acted(job,slot,'save_draft_fields',{importId:id,line,fields:ready});assert.equal(saved.receipt.state,'done','navi-posting:draft-save-without-company-gate');const approved=await acted(job,slot+1,'approve_draft',{importId:id,line});assert.equal(approved.receipt.state,'done','navi-posting:approve-without-company-gate');return approved};
  const storedTurn=async requestId=>(await assistants.findOne({ownerId:owner})).turns.find(t=>t.id===requestId);
  const companyOf=async line=>{const e=await entries.findOne({importId:s1._id,line});return e?{entry:e,transaction:await transactions.findOne({_id:e.transactionId})}:null};

  // 1 display and frozen intent: the checked token company is shown and frozen at send; a body company and a reused request id cannot move it.
  let view=await ok(wsEndpoint,tokenA);assert.deepEqual(view.postingCompany,{organizationId:String(A),name:'Synthetic posting company A'},'navi-posting:display-selected-company');
  assert.equal((await ok(wsEndpoint,plain)).postingCompany,null,'navi-posting:display-no-company');
  const foreignView=await api(wsEndpoint,foreign);assert.equal(foreignView.status,200,'navi-posting:foreign-token-keeps-owned-chat');assert.equal(foreignView.data.postingCompany,null,'navi-posting:foreign-not-displayed');assert.ok(!foreignView.raw.includes('PRIVATE_FOREIGN_COMPANY_C'),'navi-posting:foreign-name-hidden');
  const first=await wsTurn(tokenA,'2行目を会社経費で承認して帳簿に登録して',{postingCompany:{organizationId:String(B),name:'FORGED'},organizationId:String(B),postingOrganizationId:String(B)});
  let turn=await storedTurn(first.requestId);assert.equal(turn.postingCompany?.organizationId,String(A),'navi-posting:frozen-from-token-not-body');assert.equal(turn.postingCompany.name,'Synthetic posting company A');assert.equal(turn.postingCompany.actorId,String(owner));
  assert.equal(String(first.job.context?.facts?.postingCompany?.organizationId),String(A),'navi-posting:job-carries-company');assert.equal(first.job.context.facts.postingCompany.name,'Synthetic posting company A');assert.ok(!JSON.stringify(first.job).includes('FORGED'));
  const replay=await api(wsEndpoint,tokenB,'POST',{text:'2行目を会社経費で承認して帳簿に登録して',requestId:first.requestId,chatRevision:0,context:{page:'mapping',importId}});assert.equal(replay.status,200,'navi-posting:reused-request-returns-original');
  turn=await storedTurn(first.requestId);assert.equal(turn.postingCompany.organizationId,String(A),'navi-posting:reused-request-keeps-company');assert.equal((await assistants.findOne({ownerId:owner})).turns.length,1);
  await prepare(first.job,1,2);let before=JSON.parse(await ledger())[0].length;
  const posted=await acted(first.job,3,'post_selected_approved_rows',{importId,lines:[2]});assert.equal(posted.receipt.state,'done','navi-posting:post-done '+JSON.stringify(posted.receipt));assert.deepEqual(posted.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[2,'posted']]);
  let row=await companyOf(2),binding=await bindings.findOne({importId:s1._id});assert.equal(String(binding?.organizationId),String(A),'navi-posting:bound-company');assert.equal(String(binding.ownerId),String(owner));assert.equal(binding.sourceHash,s1.hash);
  assert.equal(String(row.entry.postingOrganizationId),String(A),'navi-posting:reservation-company');assert.equal(String(row.transaction?.organizationId),String(A),'navi-posting:ledger-company');assert.equal(row.transaction.organizationId._bsontype,'ObjectId');assert.equal(row.transaction.amount,1102,'navi-posting:source-amount');assert.equal(row.transaction.metadata.financeEntryId,String(row.entry._id));assert.equal(JSON.parse(await ledger())[0].length,before+1,'navi-posting:one-transaction-per-source');
  assert.equal(posted.receipt.nativeResourceIds.rows[0].transactionId,String(row.transaction._id));assert.equal(posted.receipt.nativeResourceIds.organizationId,String(A),'navi-posting:receipt-names-company');
  const op=await ops.findOne({operationId:posted.receipt.operationId});assert.equal(op.postingCompany?.organizationId,String(A),'navi-posting:operation-frozen-company');assert.deepEqual(op.postingLines,[2]);
  assert.equal((await ok('/api/transactions',tokenA)).total,1,'navi-posting:native-company-list');assert.equal((await ok('/api/transactions',tokenB)).total,0,'navi-posting:other-company-list');
  let snapshot=await ledger();const again=await acted(first.job,3,'post_selected_approved_rows',{importId,lines:[2]});assert.equal(again.receipt.operationId,posted.receipt.operationId,'navi-posting:retry-same-operation');assert.equal(await ledger(),snapshot,'navi-posting:retry-no-write');
  const existing=await acted(first.job,4,'post_selected_approved_rows',{importId,lines:[2]});assert.deepEqual(existing.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[2,'existing']],'navi-posting:verified-existing');assert.equal(existing.receipt.state,'done');assert.equal(await ledger(),snapshot);
  await prepare(first.job,5,3);const twins=await Promise.all([act(first.job,7,'post_selected_approved_rows',{importId,lines:[3]}),act(first.job,7,'post_selected_approved_rows',{importId,lines:[3]})]);
  assert.ok(twins.every(t=>t.status===200),'navi-posting:concurrent '+twins.map(t=>t.raw.slice(0,200)).join(' | '));assert.equal(twins[0].data.receipt.operationId,twins[1].data.receipt.operationId,'navi-posting:concurrent-one-operation');assert.equal(await transactions.countDocuments({'metadata.financeEntryId':String((await companyOf(3)).entry._id)}),1,'navi-posting:concurrent-one-transaction');assert.equal(String((await companyOf(3)).transaction.organizationId),String(A));
  assert.equal((await act(first.job,8,'post_selected_approved_rows',{importId,lines:[4],organizationId:String(B)})).status,400,'navi-posting:model-cannot-name-company');
  assert.equal((await finish(first.job,'2行目と3行目をA社の帳簿に登録しました。')).status,200);
  pass('selected company is checked, frozen at send and carried to the job; a body company or reused request id cannot move it; posting reaches the native company ledger once, retries and duplicates converge');

  // 2 no selected company: discussion, draft saves and approval stay available; only the ledger posting is refused, with no write.
  const none=await wsTurn(plain,'4行目の内容を相談したい。承認して帳簿にも登録して');turn=await storedTurn(none.requestId);assert.equal(turn.postingCompany??null,null,'navi-posting:no-company-frozen-null');assert.equal(none.job.context.facts.postingCompany??null,null);
  await prepare(none.job,1,4);snapshot=await ledger();const refusedNone=await act(none.job,3,'post_selected_approved_rows',{importId,lines:[4]});assert.equal(refusedNone.status,409,'navi-posting:no-company-refused '+refusedNone.raw.slice(0,200));assert.match(refusedNone.raw,/会社/);assert.equal(await ledger(),snapshot,'navi-posting:no-company-no-write');
  assert.equal((await ops.findOne({conversationKind:'workspace',turnId:none.requestId,slot:3})).state,'failed');assert.equal((await finish(none.job,'会社を選択すると帳簿に登録できます。')).status,200);
  const talk=await wsTurn(plain,'交際費と会議費の違いを教えて');assert.equal((await finish(talk.job,'違いを説明しました。')).status,200,'navi-posting:no-company-discussion');
  pass('without a selected company the owner conversation, draft save and approval remain; ledger posting is refused without any ledger write');

  // 3 a token naming a company the user is not a member of: owned chat continues, the company name never appears, posting refuses.
  const alien=await wsTurn(foreign,'4行目を帳簿に登録して');turn=await storedTurn(alien.requestId);assert.equal(turn.postingCompany??null,null,'navi-posting:foreign-not-frozen');assert.ok(!JSON.stringify(alien.job).includes('PRIVATE_FOREIGN_COMPANY_C'));
  snapshot=await ledger();assert.equal((await act(alien.job,1,'post_selected_approved_rows',{importId,lines:[4]})).status,409,'navi-posting:foreign-refused');assert.equal(await ledger(),snapshot,'navi-posting:foreign-no-write');assert.equal((await finish(alien.job,'会社を確認できません。')).status,200);
  assert.ok(!(await api(wsEndpoint,foreign)).raw.includes('PRIVATE_FOREIGN_COMPANY_C'));
  pass('a validly signed token naming a non-member company keeps the owned conversation, never shows that company and cannot post');

  // 4 membership removed after the turn was frozen: the write rechecks fresh membership; restored membership posts in a new turn.
  const revoked=await wsTurn(tokenA,'4行目を帳簿に登録して');assert.equal((await storedTurn(revoked.requestId)).postingCompany.organizationId,String(A));
  await organizations.updateOne({_id:A},{$set:{members:[]}});assert.equal((await ok(wsEndpoint,tokenA)).postingCompany,null,'navi-posting:revoked-not-displayed');
  snapshot=await ledger();const refusedRevoked=await act(revoked.job,1,'post_selected_approved_rows',{importId,lines:[4]});assert.equal(refusedRevoked.status,403,'navi-posting:revoked-write-refused '+refusedRevoked.raw.slice(0,200));assert.equal(await ledger(),snapshot,'navi-posting:revoked-no-write');
  await organizations.updateOne({_id:A},{$set:{isActive:false,members:membersA}});assert.equal((await act(revoked.job,2,'post_selected_approved_rows',{importId,lines:[4]})).status,403,'navi-posting:inactive-company-refused');assert.equal(await ledger(),snapshot);
  await organizations.updateOne({_id:A},{$set:{isActive:true}});assert.equal((await finish(revoked.job,'会社の確認ができませんでした。')).status,200);
  const restored=await wsTurn(tokenA,'4行目を帳簿に登録して');assert.equal((await acted(restored.job,1,'post_selected_approved_rows',{importId,lines:[4]})).receipt.state,'done','navi-posting:restored-member-posts');assert.equal(String((await companyOf(4)).transaction.organizationId),String(A));assert.equal((await finish(restored.job,'登録しました。')).status,200);
  pass('a removed or inactive membership after the frozen send refuses the write; the current member posts again in a new turn');

  // 5 every existing member role of the selected company posts as on the native company route.
  for(const [i,role]of['admin','member','viewer'].entries()){
   await organizations.updateOne({_id:A},{$set:{'members.0.role':role}});const line=5+i,j=await wsTurn(tokenA,line+'行目を承認して帳簿に登録して');await prepare(j.job,1,line);
   const r=await acted(j.job,3,'post_selected_approved_rows',{importId,lines:[line]});assert.equal(r.receipt.state,'done','navi-posting:legitimate-role '+role);assert.equal(String((await companyOf(line)).transaction.organizationId),String(A));assert.equal((await finish(j.job,'登録しました。')).status,200);
  }
  await organizations.updateOne({_id:A},{$set:{'members.0.role':'owner'}});
  pass('owner, admin, member and viewer of the selected company post through Navi');

  // 6 a statement already bound to another company: neither new rows nor its posted row can be claimed or reported as done.
  const s2=await upload([['11','Bound shop one',2101],['12','Bound shop two',2102]]),s2Id=String(s2._id);
  assert.equal((await ok('/api/finance/imports/'+s2Id+'/company-commit',tokenB,'POST',{decisions:[{line:2,action:'import'}]})).posted,1);
  const bound=await wsTurn(tokenA,'この明細を帳簿に登録して',{context:{page:'mapping',importId:s2Id}});await prepare(bound.job,1,3,s2Id);snapshot=await ledger();
  const boundExisting=await act(bound.job,3,'post_selected_approved_rows',{importId:s2Id,lines:[2]});assert.equal(boundExisting.status,409,'navi-posting:other-company-not-existing '+boundExisting.raw.slice(0,200));assert.ok(!boundExisting.raw.includes('Synthetic posting company B'));
  assert.equal((await act(bound.job,4,'post_selected_approved_rows',{importId:s2Id,lines:[3]})).status,409,'navi-posting:other-company-batch-refused');assert.equal(await ledger(),snapshot,'navi-posting:other-company-no-write');assert.equal((await finish(bound.job,'別の会社の明細です。')).status,200);
  pass('a statement bound to another company is refused for new rows and its posted row is never reported as this company\'s');

  // 7 unassigned legacy posting and the card's calendar binding: no ownership is inferred, nothing is reported as done or written.
  const s3=await upload([['13','Legacy shop one',3101],['14','Legacy shop two',3102]]),s3Id=String(s3._id);
  assert.equal((await ok('/api/finance/imports/'+s3Id+'/commit',plain,'POST',{decisions:[{line:2,action:'import'}]})).posted,1);await db.collection('financialaccounts').updateOne({_id:new ObjectId(account._id)},{$set:{organizationId:A,organizationBoundAt:new Date()}});
  const legacy=await wsTurn(tokenA,'この明細を帳簿に登録して',{context:{page:'mapping',importId:s3Id}});await prepare(legacy.job,1,3,s3Id);snapshot=await ledger();
  assert.equal((await act(legacy.job,3,'post_selected_approved_rows',{importId:s3Id,lines:[2]})).status,409,'navi-posting:legacy-not-existing');assert.equal((await act(legacy.job,4,'post_selected_approved_rows',{importId:s3Id,lines:[3]})).status,409,'navi-posting:legacy-batch-refused');
  assert.equal(await ledger(),snapshot,'navi-posting:legacy-no-write');assert.equal(await bindings.countDocuments({importId:s3._id}),0,'navi-posting:no-inferred-binding');assert.equal((await transactions.findOne({'metadata.importBatchId':s3Id})).organizationId,undefined,'navi-posting:legacy-stays-unassigned');assert.equal((await finish(legacy.job,'所有会社を確認できません。')).status,200);
  pass('an unassigned earlier posting is never adopted through the card calendar binding, reported as existing or extended');

  // 8 recovery from the journal after a lost settle: the frozen company is verified before done; a changed ledger or a legacy row is unresolved.
  const rec=await wsTurn(tokenA,'8行目を承認して帳簿に登録して');await prepare(rec.job,1,8);const recPosted=await acted(rec.job,3,'post_selected_approved_rows',{importId,lines:[8]});assert.equal(recPosted.receipt.state,'done');assert.equal((await finish(rec.job,'登録しました。')).status,200);
  const lost=async(extra={},unset={})=>{await ops.updateOne({operationId:recPosted.receipt.operationId},{$set:{state:'claimed',lease:'lost-lease',leaseUntil:new Date(Date.now()-120000),...extra},$unset:{receipt:'',completedAt:'',recoveryOwner:'',safeError:'',...unset}});const before=await ledger(),receipts=(await ok(wsEndpoint,tokenA)).conversation.turns.find(t=>t.id===rec.requestId).actions,receipt=receipts.find(a=>a.operationId===recPosted.receipt.operationId);assert.equal(await ledger(),before,'navi-posting:recovery-no-write');return receipt};
  let recovered=await lost();assert.equal(recovered.state,'done','navi-posting:recovery-verified-done '+JSON.stringify(recovered));assert.deepEqual(recovered.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[8,'posted']]);assert.equal(recovered.nativeResourceIds.rows[0].transactionId,String((await companyOf(8)).transaction._id));
  const tx8=(await companyOf(8)).transaction;await transactions.updateOne({_id:tx8._id},{$set:{organizationId:B}});recovered=await lost();assert.equal(recovered.state,'unresolved','navi-posting:recovery-tampered-unresolved');assert.equal(recovered.recoveryOwner,'user');await transactions.updateOne({_id:tx8._id},{$set:{organizationId:A}});
  recovered=await lost({},{postingCompany:'',postingLines:''});assert.equal(recovered.state,'unresolved','navi-posting:legacy-operation-unresolved');assert.equal(recovered.recoveryOwner,'user');
  await organizations.updateOne({_id:A},{$set:{members:[]}});recovered=await lost({postingCompany:op.postingCompany,postingLines:[8]});assert.equal(recovered.state,'unresolved','navi-posting:recovery-revoked-unresolved');assert.ok(!JSON.stringify(recovered.nativeResourceIds||{}).includes(String(tx8._id)),'navi-posting:recovery-revoked-no-ledger-ids');await organizations.updateOne({_id:A},{$set:{members:membersA}});
  pass('a lost settle is reconstructed from the frozen company and verified binding/entry/transaction; a changed ledger, a legacy operation without frozen authority or a revoked membership stays unresolved, and recovery writes nothing');

  // 9 purchase chat: the checked company is displayed and frozen per turn; without it the chat still saves and only posting is refused.
  const chatPath=line=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,draftPath=line=>'/api/finance/imports/'+importId+'/drafts/'+line;
  assert.deepEqual((await ok(chatPath(9),tokenA)).postingCompany,{organizationId:String(A),name:'Synthetic posting company A'},'navi-posting:purchase-display-company');assert.equal((await ok(chatPath(9),plain)).postingCompany,null);assert.ok(!(await api(chatPath(9),foreign)).raw.includes('PRIVATE_FOREIGN_COMPANY_C'));
  const chatSend=async(token,line,text,extra={})=>{const d=await ok(draftPath(line),token),c=await ok(chatPath(line),token),requestId=crypto.randomUUID();const r=await api(chatPath(line),token,'POST',{revision:d.revision,key:d.key,sourceHash:d.sourceHash,chatRevision:c.conversation?.revision||0,requestId,text,...extra});assert.equal(r.status,200,'navi-posting:purchase-send '+r.raw.slice(0,300));const job=(await worker('claim')).data.job;assert.ok(job,'purchase claim');return{requestId,job}};
  const p9=await chatSend(tokenA,9,'この購入を会社経費で承認して帳簿に登録して',{organizationId:String(B),postingCompany:{organizationId:String(B)}});const chat9=await chats.findOne({importId:s1._id,line:9});assert.equal(chat9.turns.find(t=>t.id===p9.requestId).postingCompany?.organizationId,String(A),'navi-posting:purchase-frozen-company');assert.equal(String(p9.job.context.postingCompany?.organizationId),String(A),'navi-posting:purchase-job-company');
  assert.equal((await acted(p9.job,1,'save_draft_fields',{fields:ready})).receipt.state,'done');assert.equal((await acted(p9.job,2,'approve_draft',{})).receipt.state,'done');const p9Posted=await acted(p9.job,3,'post_selected_approved_rows',{lines:[9]});assert.equal(p9Posted.receipt.state,'done','navi-posting:purchase-posted');assert.equal(String((await companyOf(9)).transaction.organizationId),String(A),'navi-posting:purchase-ledger-company');
  assert.equal((await finish(p9.job,'登録しました。')).status,200);
  const p10=await chatSend(plain,10,'この購入を承認して帳簿に登録して');assert.equal((await chats.findOne({importId:s1._id,line:10})).turns.find(t=>t.id===p10.requestId).postingCompany??null,null);
  assert.equal((await acted(p10.job,1,'save_draft_fields',{fields:ready})).receipt.state,'done','navi-posting:purchase-save-without-company');assert.equal((await acted(p10.job,2,'approve_draft',{})).receipt.state,'done');snapshot=await ledger();
  assert.equal((await act(p10.job,3,'post_selected_approved_rows',{lines:[10]})).status,409,'navi-posting:purchase-no-company-refused');assert.equal(await ledger(),snapshot,'navi-posting:purchase-no-company-no-write');assert.equal((await finish(p10.job,'会社を選択してください。')).status,200);
  pass('purchase chat shows and freezes the checked company; without one the conversation saves and approves and only posting is refused');

  // Totals: every company transaction was posted by an explicit current-member instruction; the legacy row stays unassigned.
  assert.equal(await transactions.countDocuments({organizationId:A}),8,'navi-posting:explicit-company-posts-only');assert.equal(await transactions.countDocuments({organizationId:B}),1);assert.equal(await transactions.countDocuments({organizationId:{$exists:false}}),1);
  assert.ok(!logs.includes('PRIVATE_FOREIGN_COMPANY_C'));
  console.log(groups+' navi posting groups passed');
 }finally{if(child){child.kill();await child.closed}if(client)await client.close();if(mongo)await mongo.stop();if(directory)await fsp.rm(directory,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});

// Navi actions (plan omf-navi-api-actions-20261016): the worker executes named, lease-bound actions on the owner's own
// records through the built app on the harness's isolated MongoDB. Synthetic owners, accounts, merchants and amounts only;
// no model, no network, no production database. Chained by finance-assistant-scope-integration.cjs (OMF_TEST_ASSISTANT_ONLY=1).
// Every final-state assertion carries a `navi:` label so the fixture's mutant leg can name the assertion a defect must flip.
const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),crypto=require('node:crypto');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
module.exports=async({db,call,upload,token,other,deviceToken,origin,pass,root,csv,row,pause})=>{
 const masterOrganizationId=new (require('mongodb').ObjectId)(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).organizationId);
 const owner=(await db.collection('users').findOne({email:'finance-a@example.invalid'}))._id,account=await db.collection('financialaccounts').findOne({ownerId:owner,name:'Synthetic Amex'});
 const ledger=async()=>({tx:await db.collection('transactions').countDocuments(),entries:await db.collection('financeentries').countDocuments()});const before=await ledger();
 const refs={account:new ObjectId(),sub:new ObjectId(),category:new ObjectId(),tax:new ObjectId(),customer:new ObjectId()};
 await db.collection('accountcategories').insertMany([{_id:refs.account,name:'Navi 通信費',type:'expense',isActive:true},{_id:refs.sub,name:'Navi 補助',parentId:refs.account,type:'expense',isActive:true}]);
 await db.collection('transactioncategories').insertOne({_id:refs.category,name:'Navi 区分'});await db.collection('taxcategories').insertOne({_id:refs.tax,name:'Navi 課税仕入 10%',rate:10});
 await db.collection('customers').insertOne({organizationId:masterOrganizationId,_id:refs.customer,name:'NAVI-CUSTOMER-TEST',isActive:true});
 const X=String(refs.account),Y=String(refs.sub),C=String(refs.category),T=String(refs.tax);
 const imported=await upload(csv([row({0:'2026/08/05',1:'2026/08/07',2:'Navi retailer',5:'1980'}),row({0:'2026/08/09',1:'2026/08/11',2:'Navi retailer',5:'2310'}),row({0:'2026/08/06',1:'2026/08/08',2:'Other navi shop',5:'500'}),row({0:'2026/08/07',1:'2026/08/09',2:'Legacy navi shop',5:'700'}),row({0:'2026/08/08',1:'2026/08/10',2:'Legacy navi shop',5:'710'}),row({0:'2026/08/10',1:'2026/08/12',2:'Navi retailer',5:'999'}),row({0:'2026/08/11',1:'2026/08/13',2:'Navi retailer',5:'1200'})]));
 assert.equal(imported.status,200,JSON.stringify(imported));const importId=imported.data.id,oid=new ObjectId(importId);
 const chatBase=line=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,draftPath=(line,id=importId)=>'/api/finance/imports/'+id+'/drafts/'+line,researchPath=(line,id=importId)=>'/api/finance-research/imports/'+id+'/drafts/'+line;
 const ok=async(route,options)=>{const r=await call(route,options);assert.equal(r.status,200,route+' '+JSON.stringify(r.data).slice(0,300));return r.data};
 const getDraft=(line,id=importId,auth=token)=>ok(draftPath(line,id),{token:auth}),getChat=line=>ok(chatBase(line),{token}),bind=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash});
 const turnOf=(conversation,id)=>conversation.turns.find(t=>t.id===id);
 // One worker with every capability for owner A (the Ryzen7 teaching/research worker), and a chat-only worker without workspace rights.
 const agent=(await ok('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],workspaceEnabled:true,researchEnabled:true}}));
 const narrow=(await ok('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)]}}));
 const worker=(route,body={},auth=agent.token)=>call('/api/finance-chat/worker/'+route,{method:'POST',token:auth,body});
 const research=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:agent.token,body});
 await ok('/api/finance-chat/worker/heartbeat',{method:'POST',token:agent.token,body:{}});
 // The worker action route: a lease-bound, slot-numbered named action on the claimed conversation. Never asserted on status here
 // (on the unchanged app it answers 404); the legs assert the durable outcome instead.
 const act=(job,slot,name,args={},lease=job.lease)=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/actions',{lease,slot,name,args});
 const acted=async(...a)=>{const r=await act(...a);assert.equal(r.status,200,'navi:action '+a[2]+' slot '+a[1]+' '+JSON.stringify(r.data).slice(0,300));return r.data};
 async function send(line,text,extra={}){const d=await getDraft(line),view=await getChat(line),requestId=crypto.randomUUID();const r=await call(chatBase(line),{method:'POST',token,body:{...bind(d),chatRevision:view.conversation?.revision||0,requestId,text,...extra}});return {requestId,status:r.status,data:r.data,draft:d}}
 async function ask(line,text,extra={}){const sent=await send(line,text,extra);assert.equal(sent.status,200,JSON.stringify(sent.data).slice(0,300));const claimed=await worker('claim');assert.ok(claimed.data.job,'chat claim');assert.equal(claimed.data.job.text,text);return {...sent,job:claimed.data.job}}
 const finish=(job,proposal)=>worker((job.mode==='workspace'?'workspace/':'')+job.id+'/result',{lease:job.lease,...(proposal?{proposal}:{failed:true})});
 const unclear=summary=>({kind:'unclear',summary,patch:{},quotes:{}});
 const ops=()=>db.collection('financeactionoperations'),memories=()=>db.collection('financedecisionmemories'),researches=()=>db.collection('financeresearches'),chats=()=>db.collection('financechats');

 // N1 (legs 13, 17): a displayed proposal A, then the explicit command B. B becomes currentId; the stored reference of A is what is
 // applied: exactly A's fields, one draft revision, a receipt in B, no second button, no approval, no ledger row.
 const a1=await ask(2,'법인 차량 충전 요금이에요');
 const proposalA={kind:'proposal',summary:'会社の充電費用として整理します。',patch:{purpose:'company',productName:'충전 요금'},quotes:{purpose:'법인 차량',productName:'충전 요금'}};
 assert.equal((await finish(a1.job,proposalA)).status,200);
 let chat=await getChat(2),turnA=turnOf(chat.conversation,a1.requestId);
 const referenceA=turnA.reference;
 const a2=await ask(2,'그 제안대로 등록해 줘',{references:referenceA?[referenceA]:[]});
 const applied=await act(a2.job,1,'apply_referenced_proposal',{kind:'chat'});
 assert.equal((await finish(a2.job,unclear('제안대로 등록했어요.'))).status,200);
 chat=await getChat(2);let d=await getDraft(2);turnA=turnOf(chat.conversation,a1.requestId);const turnB=turnOf(chat.conversation,a2.requestId);
 assert.equal(d.values.purpose,'company','navi:register-draft-persisted purpose (action route answered '+applied.status+')');
 assert.equal(d.values.productName,'충전 요금','navi:register-draft-persisted productName');
 assert.equal(d.revision,1,'navi:register-draft-revision');
 assert.ok(Array.isArray(turnB.actions)&&turnB.actions.length===1,'navi:register-receipt present (action route answered '+applied.status+')');
 assert.equal(turnB.actions[0].state,'done','navi:register-receipt state');assert.equal(turnB.actions[0].name,'apply_referenced_proposal');assert.equal(turnB.actions[0].acceptedRevision,1);assert.equal(turnB.actions[0].turnId,a2.requestId);
 for(const key of ['operationId','turnId','name','target','requestedFields','state','nativeResourceIds','acceptedRevision','completedAt','recoveryOwner','safeError'])assert.ok(Object.hasOwn(turnB.actions[0],key),'receipt field '+key);
 assert.deepEqual(turnB.actions[0].requestedFields,['purpose','productName','customerId'],'the validated proposal patch (a company purpose clears the customer)');
 assert.ok(turnA.confirmedAt,'navi:register-targets-referenced-turn');assert.equal(turnA.remembered,false);assert.equal(turnB.confirmedAt,undefined);
 assert.equal(turnB.proposal.kind,'unclear');assert.equal(d.approvedAt,null);assert.equal(chat.conversation.state,'ready');assert.equal(chat.stale,false);
 assert.equal(d.history[0].action,'chat_review');assert.equal(d.history[0].replyTs,a1.requestId);assert.deepEqual(await ledger(),before);
 // The applied turn is not re-usable: a later command carrying the same reference is refused at send.
 const reuse=await send(2,'다시 등록해 줘',{references:[referenceA]});assert.equal(reuse.status,409,'navi:applied-reference-refused');
 pass('N1 register it: the stored proposal reference of the earlier turn is applied once from the command turn, with a receipt and no second button');

 // N2 (legs 1, 3, 5, 6, 11, 12): fresh reads, one effect for concurrent identical calls, independent memory events.
 const b=await ask(2,'勘定科目を通信費にして。この科目は今後も記憶して。');
 const read1=await acted(b.job,1,'get_draft',{});assert.equal(read1.result.revision,1);assert.equal(read1.result.values.accountCategoryId,'');
 const saved=await acted(b.job,2,'save_draft_fields',{fields:{accountCategoryId:X}});assert.equal(saved.receipt.state,'done');assert.equal(saved.receipt.acceptedRevision,2,'navi:save-accepted-revision');assert.deepEqual(saved.receipt.requestedFields,['accountCategoryId']);
 const read2=await acted(b.job,3,'get_draft',{});assert.equal(read2.result.revision,2,'navi:read-after-write revision');assert.equal(read2.result.values.accountCategoryId,X,'navi:read-after-write value');
 d=await getDraft(2);assert.equal((await call(draftPath(2),{method:'PUT',token,body:{...bind(d),values:{...d.values,productName:'Owner edit'},remember:[],confirm:false}})).status,200);
 const read3=await acted(b.job,4,'get_draft',{});assert.equal(read3.result.revision,3,'navi:concurrent-edit-visible');assert.equal(read3.result.values.productName,'Owner edit');
 const status=await acted(b.job,5,'get_action_status',{operationId:saved.receipt.operationId});assert.equal(status.result.receipts[0].acceptedRevision,2,'navi:old-receipt-historical');assert.equal(status.result.receipts[0].state,'done');
 const twins=await Promise.all([act(b.job,6,'save_draft_fields',{fields:{transactionCategoryId:C}}),act(b.job,6,'save_draft_fields',{fields:{transactionCategoryId:C}})]);
 for(const t of twins)assert.equal(t.status,200,JSON.stringify(t.data).slice(0,300));
 assert.equal(twins[0].data.receipt.operationId,twins[1].data.receipt.operationId,'navi:concurrent-one-operation');assert.equal((await getDraft(2)).revision,4,'navi:concurrent-one-effect');
 assert.ok(twins.every(t=>t.data.receipt.state==='done'&&t.data.receipt.acceptedRevision===4),'navi:concurrent-converged');
 assert.equal((await act(b.job,6,'save_draft_fields',{fields:{transactionCategoryId:X}})).status,409,'navi:slot-reuse-different-meaning');
 const rejected=await act(b.job,7,'remember_accounting_fields',{fields:['productName']});assert.equal(rejected.status,400,'navi:remember-rejects-product');
 assert.equal(await memories().countDocuments(),0,'navi:rejected-changes-nothing');assert.equal((await getDraft(2)).revision,4);assert.equal(await ops().countDocuments({turnId:b.requestId,slot:7}),0,'an argument the catalogue refuses is never claimed in the journal');
 const refusedByDomain=await act(b.job,10,'save_draft_fields',{fields:{accountCategoryId:Y}});assert.equal(refusedByDomain.status,400,'the existing draft validation refuses a subsidiary as the main account');assert.equal((await getDraft(2)).revision,4);
 const remembered=await acted(b.job,8,'remember_accounting_fields',{fields:['accountCategoryId','subAccountCategoryId']});assert.equal(remembered.receipt.state,'done');assert.deepEqual(remembered.receipt.requestedFields,['accountCategoryId','subAccountCategoryId']);
 let event=await memories().findOne({kind:'accounting'});assert.ok(event,'navi:memory-event-exists');assert.deepEqual(event.values,{accountCategoryId:X,subAccountCategoryId:''});assert.equal(event.status,'active');assert.equal(event.merchant,'navi retailer');assert.equal(event.purpose,'company');assert.equal(event.customerId,'');
 assert.equal(event.operationId,remembered.receipt.operationId);assert.equal(String(event.ownerId),String(owner));assert.equal(event.provenance.turnId,b.requestId);
 d=await getDraft(2);assert.equal(d.revision,4,'navi:remember-no-draft-revision');assert.equal(d.approvedAt,null,'navi:remember-no-approval');
 const classified=await acted(b.job,9,'remember_customer_purpose',{});assert.equal(classified.receipt.state,'done');
 const lesson=await memories().findOne({kind:'classification'});assert.ok(lesson);assert.deepEqual(lesson.decision,{purpose:'company',customerId:''});assert.equal(lesson.effectiveFrom,'2026-08-05');assert.equal(lesson.values,undefined);
 const again=await acted(b.job,8,'remember_accounting_fields',{fields:['accountCategoryId','subAccountCategoryId']});assert.equal(again.receipt.operationId,remembered.receipt.operationId);assert.equal(await memories().countDocuments({kind:'accounting'}),1,'navi:remember-idempotent');
 assert.equal((await finish(b.job,unclear('通信費に変更し、科目を記憶しました。'))).status,200);
 chat=await getChat(2);const turnBActions=turnOf(chat.conversation,b.requestId).actions;assert.equal(turnBActions.filter(a=>a.state==='done').length,4,'navi:turn-carries-all-write-receipts');assert.equal(turnBActions.filter(a=>a.state==='failed').length,1,'the save the draft validation refused is reported as failed');assert.deepEqual(turnBActions.map(a=>a.slot),[2,6,8,9,10]);
 const d3=await getDraft(3);assert.equal(d3.revision,0);assert.equal(d3.values.purpose,'company','navi:later-draft-uses-classification');assert.equal(d3.values.accountCategoryId,X,'navi:later-draft-uses-accounting-memory');assert.equal(d3.evidence.accountCategoryId.source,'learned');assert.equal(d3.values.subAccountCategoryId,'');assert.equal(d3.evidence.subAccountCategoryId.source,'learned');assert.equal(d3.values.productName,'');assert.equal(d3.approvedAt,null);
 const d4=await getDraft(4);assert.equal(d4.values.accountCategoryId,'','navi:other-merchant-no-inherit');assert.equal(d4.values.purpose,'unresolved');
 const overview=await ok('/api/finance-learning/overview',{token});const policy=overview.policies.find(p=>p._id===String(lesson._id));assert.ok(policy,'navi:learning-shows-memory');assert.equal(policy.kind,'teaching');assert.equal(policy.status,'active');assert.deepEqual(policy.merchants,['navi retailer']);
 assert.ok(overview.accountingMemories.some(m=>m._id===String(event._id)&&m.status==='active'),'navi:learning-shows-accounting-memory');
 assert.equal((await call('/api/finance-learning/overview',{token:other})).data.policies.some(p=>p._id===String(lesson._id)),false);
 pass('N2 reads are fresh, concurrent identical saves converge to one effect, accounting and classification memories are independent events a later draft uses');

 // Owner B: same merchant on another owner's card inherits nothing, and B's conversations are invisible to A's worker.
 const accountB=(await ok('/api/finance/accounts',{method:'POST',token:other,body:{name:'Navi B Amex',primaryCard:'55555',cardIdentifiers:['55555'],otpRecipient:'b-original@example.invalid',otpMailbox:'b-forwarded@example.invalid'}})).account;
 const importedB=await call('/api/finance/accounts/'+accountB._id+'/imports?kind=statement&start=2026-07-19&end=2026-08-18',{method:'POST',token:other,body:csv([row({0:'2026/08/09',1:'2026/08/11',2:'Navi retailer',4:'55555',5:'2310'})]),raw:true});assert.equal(importedB.status,200,JSON.stringify(importedB.data));
 const dB=await getDraft(2,importedB.data.id,other);assert.equal(dB.values.accountCategoryId,'','navi:other-owner-no-inherit');assert.equal(dB.values.purpose,'unresolved');
 pass('N2b another owner with the same merchant inherits neither the accounting nor the classification memory');

 // Fable5.1 F1: import older purchases after remembering; only their purchase date controls eligibility, not import/write time.
 // Save blank accounting under the same company scope so learned candidates remain observable as suggestions, not saved values.
 const fromDate=event.effectiveFrom;assert.match(fromDate,/^\d{4}-\d{2}-\d{2}$/);
 const shift=days=>new Date(Date.parse(fromDate+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 const boundary=await upload(csv([-1,0,1].map((delta,i)=>row({0:shift(delta).replaceAll('-','/'),1:shift(delta).replaceAll('-','/'),2:'Navi retailer',5:String(3100+i)}))));
 assert.equal(boundary.status,200);const boundaryId=boundary.data.id;
 for(const [i,delta]of [-1,0,1].entries()){
  const line=i+2,current=await getDraft(line,boundaryId),path=draftPath(line,boundaryId);
  const saved=await ok(path,{method:'PUT',token,body:{...bind(current),values:{...current.values,purpose:'company',customerId:'',accountCategoryId:'',subAccountCategoryId:''},remember:[],confirm:false}});
  const after=await getDraft(line,boundaryId),candidate=after.suggestions.find(s=>s.field==='accountCategoryId'&&s.evidence?.memoryId===String(event._id));
  assert.equal(after.source.purchaseDate,shift(delta));
  if(delta<0)assert.equal(candidate,undefined,'navi:accounting-memory-before-start-excluded');
  else {assert.equal(candidate?.value,X,'navi:accounting-memory-on-and-after-start-eligible');assert.equal(candidate?.evidence.source,'learned');}
  assert.equal(after.values.accountCategoryId,'');assert.equal(after.values.purpose,'company');assert.equal(after.revision,saved.revision);assert.equal(after.approvedAt,null);
 }
 assert.equal((await getDraft(2)).values.accountCategoryId,X,'navi:accounting-memory-source-purchase-kept');
 // Date-less independent records remain compatible (the native writer always dates new events).
 const undatedId=new ObjectId(),undated={...event,_id:undatedId,merchant:'dateless navi shop',merchantLabel:'Dateless navi shop',purpose:'unresolved',customerId:'',operationId:'synthetic-undated-'+String(undatedId)};delete undated.effectiveFrom;
 await memories().insertOne(undated);
 const undatedImport=await upload(csv([row({0:'2026/08/01',1:'2026/08/01',2:'Dateless navi shop',5:'3201'})]));assert.equal(undatedImport.status,200);
 for(const value of [undefined,null,'']){if(value===undefined)await memories().updateOne({_id:undatedId},{$unset:{effectiveFrom:''}});else await memories().updateOne({_id:undatedId},{$set:{effectiveFrom:value}});assert.equal((await getDraft(2,undatedImport.data.id)).values.accountCategoryId,X,'navi:accounting-memory-dateless-compatible');}
 await memories().deleteOne({_id:undatedId});
 pass('N2c independent accounting rules use inclusive purchase-date scope on later-imported statements, leave drafts untouched and preserve date-less compatibility');

 // N3 (leg 4): pausing the independent event stops its contribution; a legacy draft memory keeps contributing; Learning toggles it.
 const d5=await getDraft(5);const batch=await db.collection('financeimports').findOne({_id:oid}),row5=batch.rows.find(r=>r.line===5);
 await db.collection('financedrafts').insertOne({ownerId:owner,accountId:account._id,importId:oid,line:5,key:row5.key,sourceHash:batch.hash,revision:1,values:{...d5.values,taxRate:8},evidence:d5.evidence,history:[],approvedAt:new Date(),memory:{fields:['taxRate'],merchant:'legacy navi shop',purpose:'unresolved',customerId:'',values:{taxRate:8},at:new Date('2026-08-07T00:00:00Z')},createdAt:new Date(),updatedAt:new Date()});
 assert.equal((await getDraft(6)).values.taxRate,8,'legacy memory contributes');
 const oldLegacy=await upload(csv([row({0:'2026/08/01',1:'2026/08/01',2:'Legacy navi shop',5:'3301'})]));assert.equal(oldLegacy.status,200);
 assert.equal((await getDraft(2,oldLegacy.data.id)).values.taxRate,8,'navi:legacy-dateless-memory-still-covers-earlier-purchase');
 const c=await ask(2,'그 과목 기억은 잠시 꺼 줘');
 const paused=await acted(c.job,1,'set_memory_status',{memoryId:String(event._id),status:'paused'});assert.equal(paused.receipt.state,'done');
 event=await memories().findOne({_id:event._id});assert.equal(event.status,'paused','navi:memory-paused');assert.equal(event.revision,2,'creation is revision 1, the pause revision 2');assert.equal(event.audit.at(-1).operationId,paused.receipt.operationId);
 const pausedAgain=await acted(c.job,1,'set_memory_status',{memoryId:String(event._id),status:'paused'});assert.equal(pausedAgain.receipt.operationId,paused.receipt.operationId);assert.equal((await memories().findOne({_id:event._id})).revision,2,'navi:status-idempotent');
 assert.equal((await finish(c.job,unclear('科目の記憶を停止しました。'))).status,200);
 assert.equal((await getDraft(3)).values.accountCategoryId,'','navi:paused-stops-contributing');assert.equal((await getDraft(3)).values.purpose,'company');assert.equal((await getDraft(6)).values.taxRate,8,'navi:legacy-memory-survives');
 assert.equal((await call('/api/finance-learning/lessons/'+event._id,{method:'PUT',token:other,body:{revision:2,status:'active'}})).status,404);
 assert.equal((await call('/api/finance-learning/memories/'+event._id,{method:'PUT',token,body:{revision:0,status:'active'}})).status,409);
 assert.equal((await call('/api/finance-learning/lessons/'+event._id,{method:'PUT',token,body:{revision:2,status:'active'}})).status,200,'navi:learning-reactivates-memory');
 assert.equal((await getDraft(3)).values.accountCategoryId,X);assert.equal((await memories().findOne({_id:event._id})).revision,3);
 pass('N3 a paused memory event stops contributing without erasing legacy memories, and the learning surface toggles it');

 // N4 (legs 7, 8): crash before the write, after the write, after the receipt; an expired lease cannot act or replace a receipt;
 // a failed final response keeps the completed action; the successor claim carries the receipts.
 const e=await ask(2,'税率を10%にして');
 const chatId=new ObjectId(e.job.id);
 const beforeWrite={ownerId:owner,conversationKind:'purchase',conversationId:chatId,turnId:e.requestId,slot:1,operationId:'synthetic-interrupted-'+crypto.randomBytes(6).toString('hex'),name:'save_draft_fields',payloadHash:sha(canonical({name:'save_draft_fields',args:{fields:{taxRate:10}}})),target:{importId,line:2},state:'claimed',agentId:new ObjectId(agent.id),lease:'expired-lease',claimedAt:new Date(Date.now()-600000),leaseUntil:new Date(0),attempts:1,createdAt:new Date(),updatedAt:new Date()};
 await ops().insertOne(beforeWrite);
 d=await getDraft(2);const revBefore=d.revision;
 const interrupted=await acted(e.job,1,'save_draft_fields',{fields:{taxRate:10}});assert.equal(interrupted.receipt.state,'failed','navi:crash-before-write-not-repeated');assert.equal(interrupted.receipt.operationId,beforeWrite.operationId);assert.ok(interrupted.receipt.recoveryOwner);
 assert.equal((await getDraft(2)).revision,revBefore,'navi:crash-before-write-no-effect');
 const written=await acted(e.job,2,'save_draft_fields',{fields:{taxRate:10}});assert.equal(written.receipt.state,'done');const revAfter=written.receipt.acceptedRevision;assert.equal(revAfter,revBefore+1);
 await ops().updateOne({operationId:written.receipt.operationId},{$set:{state:'claimed',lease:'expired-lease',leaseUntil:new Date(0),receipt:null,completedAt:null}});
 const recovered=await acted(e.job,2,'save_draft_fields',{fields:{taxRate:10}});assert.equal(recovered.receipt.state,'done','navi:crash-after-write-reconciled');assert.equal(recovered.receipt.acceptedRevision,revAfter,'navi:crash-after-write-revision');assert.equal(recovered.receipt.operationId,written.receipt.operationId);
 assert.equal((await getDraft(2)).revision,revAfter,'navi:crash-after-write-no-second-write');
 const afterReceipt=await acted(e.job,2,'save_draft_fields',{fields:{taxRate:10}});assert.deepEqual({...afterReceipt.receipt,completedAt:0},{...recovered.receipt,completedAt:0},'navi:crash-after-receipt-same-receipt');assert.equal((await getDraft(2)).revision,revAfter);
 await chats().updateOne({_id:chatId},{$set:{leaseUntil:new Date(0)}});
 const reclaimed=(await worker('claim')).data.job;assert.ok(reclaimed,'successor claim');assert.notEqual(reclaimed.lease,e.job.lease);assert.equal(reclaimed.id,e.job.id);
 assert.ok(Array.isArray(reclaimed.actions)&&reclaimed.actions.some(a=>a.operationId===written.receipt.operationId&&a.state==='done'),'navi:successor-sees-receipts');assert.ok(reclaimed.nextSlot>2,'navi:successor-slot-offset');
 assert.equal((await act(e.job,3,'save_draft_fields',{fields:{taxCategoryId:T}})).status,409,'navi:expired-lease-cannot-act');
 const successor=await acted(reclaimed,3,'save_draft_fields',{fields:{taxCategoryId:T}});assert.equal(successor.receipt.state,'done');
 assert.equal((await act(e.job,3,'save_draft_fields',{fields:{taxCategoryId:T}})).status,409,'navi:expired-lease-cannot-replace-receipt');
 assert.deepEqual((await ops().findOne({operationId:successor.receipt.operationId})).receipt.acceptedRevision,successor.receipt.acceptedRevision);
 assert.equal((await finish(reclaimed,unclear('税率と税区分を保存しました。'))).status,200);
 chat=await getChat(2);const turnE=turnOf(chat.conversation,e.requestId);assert.equal(turnE.actions.length,3,'navi:all-slots-reported');assert.deepEqual(turnE.actions.map(a=>a.state),['failed','done','done']);
 const f=await ask(2,'補助科目も入れて');const partial=await acted(f.job,1,'save_draft_fields',{fields:{subAccountCategoryId:Y}});assert.equal(partial.receipt.state,'done');
 assert.equal((await finish(f.job,null)).status,200);chat=await getChat(2);assert.equal(chat.conversation.state,'failed');
 assert.equal(turnOf(chat.conversation,f.requestId).actions[0].state,'done','navi:final-failure-preserves-action');assert.equal((await getDraft(2)).values.subAccountCategoryId,Y);
 d=await getDraft(2);assert.equal((await call(chatBase(2)+'/retry',{method:'POST',token,body:{...bind(d),chatRevision:chat.conversation.revision}})).status,200);
 const retried=(await worker('claim')).data.job;assert.ok(retried);assert.equal(retried.actions[0].operationId,partial.receipt.operationId,'navi:retry-reconciles-before-model');assert.equal(retried.nextSlot,2);
 assert.equal((await finish(retried,unclear('補助科目を保存済みです。'))).status,200);
 pass('N4 interruptions reconcile from the domain marker without repeating, an expired lease cannot act or overwrite, and completed actions survive a failed final response and a retry');

 // N5 (legs 16, 18, 19 and start_purchase_research): a research report is a server-owned immutable reference; a changed report is
 // never applied; foreign, edited or rebound references change nothing; a retry after success recovers the original receipt.
 const mailText='Synthetic Charging Corporation T1234567890123\nEV charging session receipt. Consumption tax 10%.';
 const reportFor=(number,summary)=>{const text=mailText.replace('T1234567890123',number);const source={id:'s1',kind:'mail',title:'Synthetic charging receipt mail',url:'',text,hash:sha(text),capturedAt:new Date().toISOString()},citation={sourceId:'s1',quote:text};return {source,report:{summary,question:'',findings:[{field:'invoiceNumber',valueJson:JSON.stringify(number),reason:'Printed number, not an official check',basis:'literal',citations:[citation]},{field:'taxRate',valueJson:'10',reason:'Printed percentage',basis:'literal',citations:[citation]}],supplier:null}}};
 async function completeResearch(line,number,summary,id=importId){const job=(await research('claim')).data.job;assert.ok(job,'research claim');const {source,report}=reportFor(number,summary);const r=await research(job.id+'/result',{lease:job.lease,sources:[...job.sources,source],report});assert.equal(r.status,200,JSON.stringify(r.data));const view=await ok(researchPath(line,id),{token});assert.equal(view.research.state,'ready');return view}
 async function queueResearch(line,instruction){const dd=await getDraft(line),view=await ok(researchPath(line),{token});assert.equal((await research('claim')).data.job,null);const q=await call(researchPath(line),{method:'POST',token,body:{...bind(dd),researchRevision:view.research?.revision||0,requestId:crypto.randomUUID(),instruction}});assert.equal(q.status,200,JSON.stringify(q.data).slice(0,300))}
 const g=await ask(7,'運営会社とT番号を調べて');
 const queued=await acted(g.job,1,'start_purchase_research',{instruction:'充電サービスの運営会社と登録番号を調査'});assert.equal(queued.receipt.state,'queued','navi:research-queued-not-finished');assert.ok(queued.receipt.nativeResourceIds.requestId);
 const queuedAgain=await acted(g.job,1,'start_purchase_research',{instruction:'充電サービスの運営会社と登録番号を調査'});assert.equal(queuedAgain.receipt.operationId,queued.receipt.operationId);assert.equal(await researches().countDocuments({importId:oid,line:7}),1,'navi:research-queued-once');
 assert.equal((await finish(g.job,unclear('調査を開始しました。結果はこの会話の下に表示します。'))).status,200);
 let view=await completeResearch(7,'T1234567890123','運営会社の候補を確認してください。');const ref1=view.research.reference;
 assert.ok(ref1&&ref1.kind==='research'&&ref1.hash&&ref1.requestId===queued.receipt.nativeResourceIds.requestId,'navi:research-reference-shape');
 await queueResearch(7,'再確認');view=await completeResearch(7,'T9876543210123','別の番号が見つかりました。');const ref2=view.research.reference;assert.notEqual(ref2.hash,ref1.hash);
 const staleSend=await send(7,'その結果を登録して',{references:[ref1]});assert.equal(staleSend.status,409,'navi:changed-report-refused-at-send');
 const h=await ask(7,'その結果を登録して',{references:[ref2]});
 await queueResearch(7,'三度目');view=await completeResearch(7,'T1111111111111','三度目の結果。');const ref3=view.research.reference;
 const changedDuring=await act(h.job,1,'apply_referenced_proposal',{kind:'research'});assert.equal(changedDuring.status,409,'navi:changed-report-refused-during-execution');
 d=await getDraft(7);assert.equal(d.values.invoiceNumber,'','navi:no-different-report-applied');assert.equal(d.revision,0);
 assert.equal((await finish(h.job,unclear('調査結果が更新されたため、反映していません。最新の結果を確認してください。'))).status,200);
 const agentB=(await ok('/api/finance-chat/agents',{method:'POST',token:other,body:{accountIds:[String(accountB._id)],researchEnabled:true}}));
 const researchB=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:agentB.token,body});await researchB('claim');
 const dBq=await getDraft(2,importedB.data.id,other);assert.equal((await call(researchPath(2,importedB.data.id),{method:'POST',token:other,body:{...bind(dBq),researchRevision:0,requestId:crypto.randomUUID(),instruction:'B research'}})).status,200);
 const jobB=(await researchB('claim')).data.job;assert.ok(jobB);const {source:sB,report:rB}=reportFor('T2222222222222','B report');assert.equal((await researchB(jobB.id+'/result',{lease:jobB.lease,sources:[...jobB.sources,sB],report:rB})).status,200);
 const refB=(await ok(researchPath(2,importedB.data.id),{token:other})).research.reference;assert.ok(refB);
 assert.equal((await send(7,'登録して',{references:[refB]})).status,409,'navi:foreign-reference-refused');
 assert.equal((await send(7,'登録して',{references:[{...ref3,hash:ref3.hash.replace(/^./,ch=>ch==='0'?'1':'0')}]})).status,409,'navi:edited-reference-refused');
 assert.equal((await send(7,'登録して',{references:[ref3,{...ref3}]})).status,400,'navi:duplicate-references-refused');
 const i=await ask(7,'登録して',{references:[ref3]});
 d=await getDraft(7);assert.equal((await call(draftPath(7),{method:'PUT',token,body:{...bind(d),values:{...d.values,productName:'Owner correction'},remember:[],confirm:false}})).status,200);
 assert.equal((await act(i.job,1,'apply_referenced_proposal',{kind:'research'})).status,409,'navi:changed-draft-refused');d=await getDraft(7);assert.equal(d.revision,1);assert.equal(d.values.invoiceNumber,'');assert.equal(d.values.productName,'Owner correction');
 assert.equal((await finish(i.job,unclear('下書きが変わったため反映していません。'))).status,200);
 await queueResearch(7,'四度目');view=await completeResearch(7,'T4444444444444','四度目の結果。');const ref4=view.research.reference;assert.equal(ref4.draftRevision,1);
 const j=await ask(7,'今度こそ登録して',{references:[ref4]});
 const appliedResearch=await acted(j.job,1,'apply_referenced_proposal',{kind:'research'});assert.equal(appliedResearch.receipt.state,'done','navi:research-applied');assert.equal(appliedResearch.receipt.acceptedRevision,2);assert.deepEqual(appliedResearch.receipt.requestedFields,['invoiceNumber','taxRate']);
 d=await getDraft(7);assert.equal(d.values.invoiceNumber,'T4444444444444');assert.equal(d.values.taxRate,10);assert.equal(d.revision,2);assert.equal(d.evidence.invoiceNumber.source,'research');
 await queueResearch(7,'五度目');await completeResearch(7,'T5555555555555','五度目の結果。');
 const recoveredApply=await acted(j.job,1,'apply_referenced_proposal',{kind:'research'});assert.equal(recoveredApply.receipt.operationId,appliedResearch.receipt.operationId,'navi:retry-recovers-original-receipt');assert.equal(recoveredApply.receipt.acceptedRevision,2);
 d=await getDraft(7);assert.equal(d.values.invoiceNumber,'T4444444444444','navi:newer-research-not-applied-on-retry');assert.equal(d.revision,2);
 assert.equal((await act(j.job,2,'apply_referenced_proposal',{})).status,409,'a new slot naming the stored report is refused once a newer report is current; only the original slot recovers the receipt');assert.equal((await getDraft(7)).revision,2);
 assert.equal((await finish(j.job,unclear('調査結果を反映しました。'))).status,200);
 assert.equal((await act(j.job,3,'get_draft',{})).status,409,'a finished job has no lease');
 pass('N5 research references are immutable server identities: a changed, foreign, edited or rebound report is never applied, and a retry after success recovers the original receipt');

 // N6 (legs 9, 10 and the workspace lane): explicit approve and post through the native company posting path to the company the
 // owner's token selected when sending (a current member); interrupted posts resume without a duplicate transaction or draft revision;
 // an already posted row is reported as existing.
 const naviCompany=new ObjectId();await db.collection('organizations').insertOne({_id:naviCompany,name:'Navi posting test company',slug:'navi-actions-posting',isActive:true,members:[{userId:owner,role:'owner',joinedAt:new Date()}]});
 const companyToken=(await ok('/api/auth/switch-organization',{method:'POST',token,body:{organizationId:String(naviCompany)}})).tokens.accessToken;
 const wsEndpoint='/api/finance-chat/workspace';let ws=await ok(wsEndpoint,{token});
 const wsSend=async(text,context,auth=token)=>{ws=await ok(wsEndpoint,{token:auth});const requestId=crypto.randomUUID();const r=await call(wsEndpoint,{method:'POST',token:auth,body:{text,requestId,chatRevision:ws.conversation?.revision||0,context}});assert.equal(r.status,200,JSON.stringify(r.data).slice(0,300));const claimed=(await worker('workspace-claim')).data.job;assert.ok(claimed,'workspace claim');return {requestId,job:claimed}};
 const k=await wsSend('この明細の8行目を会社経費で承認して帳簿に登録して',{page:'mapping',importId},companyToken);
 assert.ok(Array.isArray(k.job.tools)&&k.job.tools.some(t=>t.name==='post_selected_approved_rows'),'navi:workspace-job-carries-tools');
 assert.equal((await act(k.job,1,'list_accounts',{},k.job.lease,)).status,200);
 const accounts=await acted(k.job,1,'list_accounts',{});assert.deepEqual(accounts.result.accounts.map(a=>a.id),[String(account._id)],'navi:accounts-scoped-to-agent');
 const mapping=await acted(k.job,2,'get_mapping',{importId});assert.ok(mapping.result.rows.some(r=>r.line===8),'mapping lists the row');
 assert.equal((await act(k.job,3,'get_draft',{importId:importedB.data.id,line:2})).status,404,'navi:foreign-import-not-readable');
 const filled=await acted(k.job,4,'save_draft_fields',{importId,line:8,fields:{purpose:'company',accountCategoryId:X,transactionCategoryId:C,taxCategoryId:T,taxRate:10}});assert.equal(filled.receipt.state,'done');assert.equal(filled.receipt.acceptedRevision,1);
 const approved=await acted(k.job,5,'approve_draft',{importId,line:8});assert.equal(approved.receipt.state,'done','navi:approve-done');assert.equal(approved.receipt.acceptedRevision,2);
 let d8=await getDraft(8);assert.ok(d8.approvedAt,'navi:approved');assert.equal(d8.revision,2);
 assert.equal((await acted(k.job,5,'approve_draft',{importId,line:8})).receipt.acceptedRevision,2);assert.equal((await getDraft(8)).revision,2,'navi:approve-idempotent');
 const ledgerBeforePost=await ledger();
 const posted=await acted(k.job,6,'post_selected_approved_rows',{importId,lines:[8]});assert.equal(posted.receipt.state,'done','navi:post-done');assert.deepEqual(posted.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[8,'posted']]);
 assert.deepEqual(await ledger(),{tx:ledgerBeforePost.tx+1,entries:ledgerBeforePost.entries+1},'navi:post-one-transaction');
 assert.equal(String((await db.collection('transactions').findOne({_id:new ObjectId(posted.receipt.nativeResourceIds.rows[0].transactionId)})).organizationId),String(naviCompany),'navi:post-selected-company');
 const postedAgain=await acted(k.job,6,'post_selected_approved_rows',{importId,lines:[8]});assert.equal(postedAgain.receipt.operationId,posted.receipt.operationId);assert.deepEqual(await ledger(),{tx:ledgerBeforePost.tx+1,entries:ledgerBeforePost.entries+1},'navi:post-retry-no-duplicate');
 const existing=await acted(k.job,7,'post_selected_approved_rows',{importId,lines:[8]});assert.deepEqual(existing.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[8,'existing']],'navi:existing-reported-as-existing');
 assert.deepEqual(await ledger(),{tx:ledgerBeforePost.tx+1,entries:ledgerBeforePost.entries+1});assert.equal((await getDraft(8)).revision,2);
 // Interrupted post on line 3: reserved entry and its transaction already exist (crash before the posted marker); the post resumes.
 assert.equal((await acted(k.job,8,'save_draft_fields',{importId,line:3,fields:{transactionCategoryId:C,taxCategoryId:T,taxRate:10}})).receipt.acceptedRevision,1);
 assert.equal((await acted(k.job,9,'approve_draft',{importId,line:3})).receipt.acceptedRevision,2);
 const row3=batch.rows.find(r=>r.line===3),reserved={_id:new ObjectId(),ownerId:owner,accountId:account._id,key:row3.key,fingerprint:row3.fingerprint,occurrence:row3.occurrence,coverage:batch.period.key,importId:oid,line:3,transactionId:new ObjectId(),state:'reserved',row:row3,linkedExisting:false,draftSnapshot:{revision:2},postingOrganizationId:naviCompany};
 await db.collection('financeentries').insertOne(reserved);await db.collection('transactions').insertOne({_id:reserved.transactionId,organizationId:naviCompany,date:new Date(row3.purchaseDate),amount:2310,type:'支出',status:'completed',metadata:{financeEntryId:reserved._id.toHexString()}});
 const ledgerBeforeResume=await ledger();
 const resumed=await acted(k.job,10,'post_selected_approved_rows',{importId,lines:[3]});assert.equal(resumed.receipt.state,'done');assert.deepEqual(resumed.receipt.nativeResourceIds.rows.map(r=>[r.line,r.outcome]),[[3,'resumed']],'navi:interrupted-post-resumed');
 assert.deepEqual(await ledger(),ledgerBeforeResume,'navi:resume-no-duplicate-transaction');assert.equal((await db.collection('financeentries').findOne({_id:reserved._id})).state,'posted');assert.equal((await getDraft(3)).revision,2,'navi:resume-no-draft-revision');
 assert.equal((await act(k.job,11,'post_selected_approved_rows',{importId,lines:[4]})).status,409,'navi:unapproved-row-not-posted');
 assert.equal((await act(k.job,12,'save_draft_fields',{importId,line:2,fields:{taxRate:10}},k.job.lease)).status,200,'workspace actions reach an explicitly named owned purchase');
 assert.equal((await finish(k.job,unclear('8行目を承認し、帳簿に登録しました。3行目の登録も完了しています。'))).status,200);
 ws=await ok(wsEndpoint,{token});const turnK=turnOf(ws.conversation,k.requestId);assert.equal(turnK.actions.filter(a=>a.state==='done').length,8,'navi:workspace-receipts');assert.equal(turnK.target?.importId,importId,'navi:workspace-selection-frozen');
 assert.equal((await worker('workspace/'+k.job.id+'/actions',{lease:k.job.lease,slot:13,name:'get_draft',args:{importId,line:2}},narrow.token)).status,403,'navi:workspace-capability-required');
 const l=await wsSend('口座を見せて',{page:'connections'});assert.equal((await worker('workspace/'+l.job.id+'/actions',{lease:l.job.lease,slot:1,name:'list_accounts',args:{}},narrow.token)).status,403);
 assert.equal((await act(l.job,1,'get_draft',{})).status,400,'a workspace action without a target names the missing purchase');
 assert.equal((await act(l.job,2,'unknown_tool',{})).status,400);
 assert.equal((await finish(l.job,unclear('口座一覧です。'))).status,200);

 // N7: a final research request follows this turn's accepted draft save, never a memory revision or a later owner edit.
 {
  const importedR=await upload(csv(Array.from({length:6},(_,i)=>row({0:'2026/08/12',1:'2026/08/14',2:'Post-save research '+i,5:String(8500+i)}))));
  assert.equal(importedR.status,200,JSON.stringify(importedR.data));const rid=importedR.data.id,roid=new ObjectId(rid);
  const draftR=line=>ok('/api/finance/imports/'+rid+'/drafts/'+line,{token}),chatR=line=>ok('/api/finance-chat/imports/'+rid+'/drafts/'+line,{token});
  async function saveR(line,fields){const d=await draftR(line);return ok('/api/finance/imports/'+rid+'/drafts/'+line,{method:'PUT',token,body:{...bind(d),values:{...d.values,...fields},remember:[],confirm:false}})}
  async function askR(line,text,extra={}){const d=await draftR(line),c=await chatR(line),requestId=crypto.randomUUID();await ok('/api/finance-chat/imports/'+rid+'/drafts/'+line,{method:'POST',token,body:{...bind(d),chatRevision:c.conversation?.revision||0,requestId,text,...extra}});const job=(await worker('claim')).data.job;assert.ok(job);assert.equal(job.text,text);return {requestId,job}}
  const finalResearch=()=>({...unclear('保存した内容で調査を依頼しました。'),research:{instruction:'保存した購入内容の事業者情報・登録番号・税率を調査'}});
  const researchR=line=>researches().findOne({importId:roid,line});
  // A memory event revision can numerically match a foreign draft edit. It is not a save receipt, including in stale/retry checks.
  await saveR(2,{purpose:'company',accountCategoryId:X});
  const memoryJob=await askR(2,'科目を記憶して、すぐ記憶だけを停止して');
  const made=await acted(memoryJob.job,1,'remember_accounting_fields',{fields:['accountCategoryId']});
  const pausedR=await acted(memoryJob.job,2,'set_memory_status',{memoryId:made.receipt.nativeResourceIds.memoryId,status:'paused'});assert.equal(pausedR.receipt.acceptedRevision,2);
  const foreignR=await saveR(2,{productName:'Separate owner edit'});assert.equal(foreignR.revision,2);
  const liveMemory=await chatR(2);assert.equal((await finish(memoryJob.job,null)).status,200);const failedMemory=await chatR(2);
  const retryMemory=await call('/api/finance-chat/imports/'+rid+'/drafts/2/retry',{method:'POST',token,body:{...bind(foreignR),chatRevision:failedMemory.conversation.revision}});
  assert.equal(liveMemory.stale,true,'navi:memory-revision-is-not-draft-save-live');assert.equal(failedMemory.stale,true,'navi:memory-revision-is-not-draft-save-finished');assert.equal(retryMemory.status,409,'navi:memory-revision-cannot-authorize-retry');
  // The same collision must not rebind final-response research either.
  const memoryResearch=await askR(2,'その記憶を有効にして、購入の事業者を調査して');
  const memoryActive=await acted(memoryResearch.job,1,'set_memory_status',{memoryId:made.receipt.nativeResourceIds.memoryId,status:'active'});assert.equal(memoryActive.receipt.acceptedRevision,3);
  await saveR(2,{productName:'Another separate owner edit'});assert.equal((await finish(memoryResearch.job,finalResearch())).status,200);
  assert.equal(await researchR(2),null,'navi:memory-revision-cannot-bind-research');assert.equal(turnOf((await chatR(2)).conversation,memoryResearch.requestId).research.unavailable,'下書きが更新されています。再読込してください。');
  // A stored proposal is applied once, then the reply queues against its accepted revision and values.
  const preview=await askR(3,'会社の充電費用');await finish(preview.job,{kind:'proposal',summary:'会社の充電費用の候補です。',patch:{purpose:'company',productName:'充電費用'},quotes:{purpose:'会社',productName:'充電費用'}});
  const refR=turnOf((await chatR(3)).conversation,preview.requestId).reference,applyR=await askR(3,'その提案を反映して、事業者と税率を調べて',{references:[refR]});
  const appliedR=await acted(applyR.job,1,'apply_referenced_proposal',{kind:'chat'});assert.equal((await finish(applyR.job,finalResearch())).status,200);
  let queuedR=await researchR(3);assert.ok(queuedR,'navi:post-apply-final-research-is-queued');assert.equal(queuedR.state,'queued');assert.equal(queuedR.context.revision,appliedR.receipt.acceptedRevision);assert.equal(queuedR.context.values.productName,'充電費用');
  const firstRequest=queuedR.requestId;await chatR(3);await chatR(3);assert.equal((await researchR(3)).requestId,firstRequest);assert.equal(await researches().countDocuments({importId:roid,line:3}),1,'navi:post-apply-research-once');
  // Multiple draft saves use the last accepted revision, even when a later memory receipt has a larger unrelated revision.
  const saveJob=await askR(4,'用途と商品名を保存し、先ほどの科目の記憶を停止してから調査して');await acted(saveJob.job,1,'save_draft_fields',{fields:{purpose:'company'}});
  const lastSave=await acted(saveJob.job,2,'save_draft_fields',{fields:{productName:'Two saves'}});assert.equal(lastSave.receipt.acceptedRevision,2);
  const laterMemory=await acted(saveJob.job,3,'set_memory_status',{memoryId:made.receipt.nativeResourceIds.memoryId,status:'paused'});assert.equal(laterMemory.receipt.acceptedRevision,4);
  assert.equal((await finish(saveJob.job,finalResearch())).status,200);queuedR=await researchR(4);assert.ok(queuedR,'navi:post-save-final-research-is-queued');assert.equal(queuedR.context.revision,2);assert.equal(queuedR.context.values.productName,'Two saves');
  // A foreign edit after a successful action remains a conflict, not an invitation to use the current revision.
  const changed=await askR(5,'会社経費として保存し、調査して');await acted(changed.job,1,'save_draft_fields',{fields:{purpose:'company'}});await saveR(5,{productName:'Owner edit after action'});
  assert.equal((await finish(changed.job,finalResearch())).status,200);assert.equal(await researchR(5),null,'navi:own-save-does-not-adopt-later-owner-edit');const changedView=await chatR(5);assert.equal(changedView.stale,true);assert.ok(turnOf(changedView.conversation,changed.requestId).research.unavailable);
  // An explicit research action already queued this turn; the final reply reuses it without a second queue or new instruction.
  const already=await askR(6,'用途を保存して、事業者を調査して');const alreadySaved=await acted(already.job,1,'save_draft_fields',{fields:{purpose:'company'}});
  const alreadyQueued=await acted(already.job,2,'start_purchase_research',{instruction:'操作から依頼した調査'}),priorQueue=await researchR(6);
  assert.equal((await finish(already.job,finalResearch())).status,200);const sameQueue=await researchR(6);assert.equal(sameQueue.requestId,alreadyQueued.receipt.nativeResourceIds.requestId);assert.equal(sameQueue.revision,priorQueue.revision);assert.equal(sameQueue.instruction,'操作から依頼した調査');assert.equal(sameQueue.context.revision,alreadySaved.receipt.acceptedRevision);assert.equal(await researches().countDocuments({importId:roid,line:6}),1,'navi:action-and-final-research-share-one-request');
  for(const line of [2,3,4,5,6])assert.equal((await draftR(line)).approvedAt,null);
  pass('N7 final research follows this turn\'s own accepted draft revision once; memory revisions and later owner edits cannot authorize a rebind or retry');
 }
 await require('./finance-navi-recovery-integration.cjs')({db,call,upload,token,other,pass,csv,row},agent,narrow);
 for(const id of [agent.id,narrow.id])assert.equal((await call('/api/finance-chat/agents/'+id,{method:'DELETE',token})).status,200);
 assert.equal((await act(l.job,3,'list_accounts',{})).status,401,'navi:revoked-worker-cannot-act');
 await call('/api/finance-chat/agents/'+agentB.id,{method:'DELETE',token:other});
 assert.deepEqual(await ledger(),{tx:before.tx+2,entries:before.entries+2},'navi:only-explicit-posts-reach-the-ledger');
 pass('N6 explicit approve and post run through the existing posting path once, interrupted posts resume without duplicates, existing rows are reported as existing, and workspace actions are capability-, account- and lease-bound');
};

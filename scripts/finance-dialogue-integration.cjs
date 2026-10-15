// Chat → research continuation (plan omf-assistant-actions-20261015): the built app on an isolated MongoDB, synthetic
// merchant/date/amount only; the recorded owner case stays in the private replay input. Wired as OMF_TEST_DIALOGUE_ONLY=1
// and in the full run of scripts/finance-integration.cjs. No model, no network, no production database.
const assert=require('node:assert/strict'),{ObjectId}=require('mongodb'),crypto=require('node:crypto');
module.exports=async({db,call,upload,token,other,deviceToken,origin,pass,csv,row,pause,root})=>{
 const owner=(await db.collection('users').findOne({email:'finance-a@example.invalid'}))._id,account=await db.collection('financialaccounts').findOne({ownerId:owner,name:'Synthetic Amex'});
 const before={tx:await db.collection('transactions').countDocuments(),entries:await db.collection('financeentries').countDocuments()};
 const researches=()=>db.collection('financeresearches'),chats=()=>db.collection('financechats'),agents=()=>db.collection('financechatagents');
 const sha=text=>crypto.createHash('sha256').update(text).digest('hex'),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const imported=await upload(csv([row({0:'2026/08/05',1:'2026/08/07',2:'Synthetic EV charging station',5:'1980'}),row({0:'2026/08/06',1:'2026/08/08',2:'Synthetic EV charging station',5:'2310'}),row({0:'2026/08/09',1:'2026/08/11',2:'Synthetic EV charging station',5:'1540'})]));
 assert.equal(imported.status,200,JSON.stringify(imported));const importId=imported.data.id,oid=new ObjectId(importId);
 const base=line=>'/api/finance-chat/imports/'+importId+'/drafts/'+line,draftPath=line=>'/api/finance/imports/'+importId+'/drafts/'+line,researchPath=line=>'/api/finance-research/imports/'+importId+'/drafts/'+line;
 const getDraft=async line=>(await call(draftPath(line),{token})).data,getChat=async line=>(await call(base(line),{token})).data,bind=d=>({revision:d.revision,key:d.key,sourceHash:d.sourceHash});
 const rowFor=line=>researches().findOne({importId:oid,line}),turnOf=(conversation,id)=>conversation.turns.find(t=>t.id===id);
 assert.equal((await call(base(2))).status,401);assert.equal((await call(base(2),{token:other})).status,404);assert.equal((await call(researchPath(2),{token:deviceToken})).status,401);
 const teacher=(await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)]}})).data,researcher=(await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],researchEnabled:true}})).data;
 const chatCall=(route,body={})=>call('/api/finance-chat/worker/'+route,{method:'POST',token:teacher.token,body}),researchCall=(route,body={})=>call('/api/finance-research/worker/'+route,{method:'POST',token:researcher.token,body});
 const researchAlive=async()=>assert.equal((await researchCall('status',{settingsUrl:'http://127.0.0.1:54321/setup/'+'a'.repeat(64),ntaConfigured:false})).status,200);
 await chatCall('heartbeat');await researchAlive();
 async function ask(line,text){const d=await getDraft(line),view=await getChat(line),requestId=crypto.randomUUID();const sent=await call(base(line),{method:'POST',token,body:{...bind(d),chatRevision:view.conversation?.revision||0,requestId,text}});assert.equal(sent.status,200,JSON.stringify(sent));const claimed=await chatCall('claim');assert.ok(claimed.data.job,'chat claim');assert.equal(claimed.data.job.text,text);return {requestId,job:claimed.data.job,draft:d}}
 async function reply(job,proposal){const started=Date.now();const r=await chatCall(job.id+'/result',{lease:job.lease,proposal});return {...r,ms:Date.now()-started}}
 const unclear=(summary,instruction)=>({kind:'unclear',summary,patch:{},quotes:{},...(instruction?{research:{instruction}}:{})});
 // Synthetic current message and research instruction (generic company EV charging statement; not the recorded text).
 const text='법인 차량의 충전 요금입니다',instruction='법인 차량 충전 요금: 勘定科目・区分・税区分・消費税率の候補と運営会社の法人名・インボイス番号を調査';
 const proposal={kind:'proposal',summary:'会社の充電費用として整理します。確認後にOMFが勘定科目と運営会社を調べ、結果はこの会話の下に表示します。',patch:{purpose:'company',productName:'충전 요금'},quotes:{purpose:'법인 차량',productName:'충전 요금'},research:{instruction}};

 // 4a proposal+research → when:'confirm' and no row; confirm → row queued, bound to the post-confirm draft; worker; apply; next context
 const a=await ask(2,text);assert.equal(Object.hasOwn(a.job.context,'research'),true,'context carries research');assert.equal(a.job.context.research,null);
 const answered=await reply(a.job,proposal);assert.equal(answered.status,200,JSON.stringify(answered));
 let chat=await getChat(2),turn=turnOf(chat.conversation,a.requestId);
 assert.equal(chat.conversation.state,'ready');assert.equal(turn.research?.when,'confirm','a proposal defers research to the confirmation');assert.equal(turn.research.instruction,instruction);assert.equal(turn.research.requestId,undefined);assert.equal(turn.research.unavailable,undefined);
 assert.equal(await researches().countDocuments(),0,'no research before the confirmation');assert.equal((await getDraft(2)).revision,0);
 const confirmation={...bind(a.draft),chatRevision:chat.conversation.revision,turnId:a.requestId,remember:false};
 const confirmed=await call(base(2)+'/confirm',{method:'POST',token,body:confirmation});assert.equal(confirmed.status,200,JSON.stringify(confirmed));
 assert.equal(confirmed.data.draft.values.purpose,'company');assert.equal(confirmed.data.draft.values.productName,'충전 요금');assert.equal(confirmed.data.draft.revision,1);assert.equal(confirmed.data.draft.approvedAt,null);
 turn=turnOf(confirmed.data.conversation,a.requestId);assert.ok(turn.confirmedAt);assert.match(turn.research.requestId,uuid);assert.equal(turn.research.unavailable,undefined);assert.equal(turn.research.when,'confirm');
 assert.equal(await researches().countDocuments(),1,'one research row after the confirmation');
 let research=await rowFor(2);assert.equal(research.state,'queued');assert.equal(research.instruction,instruction);assert.equal(research.requestId,turn.research.requestId);assert.equal(research.context.revision,1,'bound to the post-confirm draft');assert.equal(research.context.values.purpose,'company');assert.equal(research.history.length,0);
 const retried=await call(base(2)+'/confirm',{method:'POST',token,body:confirmation});assert.equal(retried.status,200,JSON.stringify(retried));assert.equal(await researches().countDocuments(),1);assert.equal((await rowFor(2)).revision,research.revision,'a confirm retry does not queue twice');assert.equal(turnOf(retried.data.conversation,a.requestId).research.requestId,turn.research.requestId);
 const claimedResearch=await researchCall('claim');assert.ok(claimedResearch.data.job,'research claim');const job=claimedResearch.data.job;assert.equal(job.instruction,instruction);assert.equal(job.context.values.purpose,'company');assert.equal(job.context.revision,1);assert.equal(job.context.source.description,'Synthetic EV charging station');
 const mailText='Synthetic Charging Corporation T1234567890123\nEV charging session receipt. Consumption tax 10%.';
 const source={id:'s1',kind:'mail',title:'Synthetic charging receipt mail',url:'',text:mailText,hash:sha(mailText),capturedAt:new Date().toISOString()},citation={sourceId:'s1',quote:mailText};
 const report={summary:'充電サービスの運営会社と登録番号の候補を確認してください。',question:'',findings:[{field:'invoiceNumber',valueJson:'"T1234567890123"',reason:'Printed number, not an official check',basis:'literal',citations:[citation]},{field:'taxRate',valueJson:'10',reason:'Printed percentage on the receipt mail',basis:'literal',citations:[citation]}],supplier:{shopName:'Synthetic EV charging station',legalName:'Synthetic Charging Corporation',invoiceNumber:'T1234567890123',citations:[citation]}};
 const finished=await researchCall(job.id+'/result',{lease:job.lease,sources:[...job.sources,source],report});assert.equal(finished.status,200,JSON.stringify(finished));
 let view=(await call(researchPath(2),{token})).data;assert.equal(view.research.state,'ready');assert.equal(view.stale,false,'chat-queued research is current after the confirmation');
 const applied=await call(researchPath(2)+'/apply',{method:'POST',token,body:{...bind(await getDraft(2)),researchRevision:view.research.revision,confirm:true,fields:['invoiceNumber']}});assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.data.draft.values.invoiceNumber,'T1234567890123');assert.equal(applied.data.draft.revision,2);
 chat=await getChat(2);assert.equal(chat.stale,false);assert.equal(chat.conversation.state,'confirmed');
 const next=await ask(2,'조사 결과를 설명해 주세요');const snapshot=next.job.context.research;
 assert.equal(snapshot.state,'applied');assert.equal(snapshot.stale,false);assert.equal(snapshot.summary,report.summary);assert.equal(snapshot.question,'');assert.equal(snapshot.instruction,instruction);
 assert.ok(snapshot.findings.some(f=>f.field==='invoiceNumber'&&f.label&&f.value==='T1234567890123'&&f.basis==='literal'&&f.quotes.length===1&&f.quotes[0].length<=300));assert.equal(snapshot.supplier.legalName,'Synthetic Charging Corporation');assert.deepEqual(Object.keys(snapshot.supplier).sort(),['invoiceNumber','legalName','shopName']);assert.equal(snapshot.sources,undefined);assert.deepEqual(snapshot.applied.fields,['invoiceNumber']);
 assert.equal((await reply(next.job,unclear('登録番号は受信メールの記載から確認しました。'))).status,200);assert.equal(turnOf((await getChat(2)).conversation,next.requestId).research,undefined,'a reply without a request stores no research marker');
 pass('4a proposal+research waits for the confirmation, binds the research to the confirmed draft, the worker and apply run as from the form, and the next reply sees the findings (reply '+answered.ms+' ms)');

 // 4b unclear+research → row queued at once, bound to the conversation's draft
 const b=await ask(2,'충전 요금의 세율도 확인해 줘'),instructionB='충전 요금의 消費税率と区分を購入メールから確認';
 const answeredB=await reply(b.job,unclear('税率を購入メールから調べます。結果は下の調査カードに表示します。',instructionB));assert.equal(answeredB.status,200,JSON.stringify(answeredB));
 chat=await getChat(2);turn=turnOf(chat.conversation,b.requestId);assert.equal(turn.research.when,'now');assert.match(turn.research.requestId,uuid);assert.equal(turn.research.unavailable,undefined);
 research=await rowFor(2);assert.equal(research.state,'queued');assert.equal(research.requestId,turn.research.requestId);assert.equal(research.instruction,instructionB);assert.equal(research.history.length,1,'the earlier report moved to history');assert.equal(research.context.revision,2);assert.equal(await researches().countDocuments(),1);
 assert.ok(answeredB.ms<15000,'the reply with the queue inside must finish within the worker client timeout: '+answeredB.ms+' ms');
 pass('4b unclear+research queues the research at once (reply with the queue inside '+answeredB.ms+' ms)');

 // 4d a second request while research is active → unavailable, the running one untouched
 const d=await ask(2,'운영회사도 같이 봐 줘');
 assert.equal((await reply(d.job,unclear('調査が進行中です。','運営会社の確認'))).status,200);
 turn=turnOf((await getChat(2)).conversation,d.requestId);assert.equal(turn.research.when,'now');assert.equal(turn.research.requestId,undefined);assert.equal(turn.research.unavailable,'調査が終わるまでお待ちください。');
 assert.equal((await rowFor(2)).requestId,research.requestId);assert.equal((await rowFor(2)).state,'queued');
 const job2=(await researchCall('claim')).data.job;assert.equal(job2.instruction,instructionB);assert.equal((await researchCall(job2.id+'/result',{lease:job2.lease,failed:true})).status,200);assert.equal((await rowFor(2)).state,'failed');
 pass('4d a second request while research runs is refused with the existing wait message and the running job keeps its request');

 // 4c research agent not seen → unavailable with the connection message, no row touched; a failed row is re-requested by the next message
 await agents().updateOne({_id:new ObjectId(researcher.id)},{$set:{lastSeenAt:new Date(0)}});
 const c=await ask(2,'다시 조사해 줘');assert.equal((await reply(c.job,unclear('調査を開始できませんでした。','再調査'))).status,200);
 turn=turnOf((await getChat(2)).conversation,c.requestId);assert.equal(turn.research.unavailable,'調査担当に接続できません。');assert.equal(turn.research.requestId,undefined);
 assert.equal((await rowFor(2)).state,'failed');assert.equal((await rowFor(2)).requestId,research.requestId);assert.equal(await researches().countDocuments(),1);
 await researchAlive();
 const c2=await ask(2,'이제 다시 조사해 줘');assert.equal((await reply(c2.job,unclear('再調査します。','再調査'))).status,200);
 turn=turnOf((await getChat(2)).conversation,c2.requestId);assert.match(turn.research.requestId,uuid);research=await rowFor(2);assert.equal(research.state,'queued');assert.equal(research.requestId,turn.research.requestId);assert.equal(research.history.length,1,'a failed run leaves no report to archive');
 const job3=(await researchCall('claim')).data.job;assert.equal((await researchCall(job3.id+'/result',{lease:job3.lease,failed:true})).status,200);
 pass('4c without a seen research agent the turn records the connection reason and no row changes; after reconnection the next message re-requests a failed research');

 // 4e workspace reply carrying research → 200, dropped, no row
 const workspace=(await call('/api/finance-chat/agents',{method:'POST',token,body:{accountIds:[String(account._id)],workspaceEnabled:true}})).data,wsCall=(route,body={})=>call('/api/finance-chat/worker/'+route,{method:'POST',token:workspace.token,body});
 await wsCall('heartbeat');const ws=(await call('/api/finance-chat/workspace',{token})).data;assert.equal(ws.connected,true);
 const wsSent=await call('/api/finance-chat/workspace',{method:'POST',token,body:{text:'이 페이지에서 무엇을 할 수 있어?',requestId:crypto.randomUUID(),chatRevision:ws.conversation?.revision||0,context:{page:'dashboard'}}});assert.equal(wsSent.status,200,JSON.stringify(wsSent));
 const wsJob=(await wsCall('workspace-claim')).data.job;assert.ok(wsJob);assert.equal(wsJob.mode,'workspace');const rowsBefore=await researches().countDocuments();
 const wsResult=await wsCall('workspace/'+wsJob.id+'/result',{lease:wsJob.lease,proposal:unclear('画面の説明です。','調査')});assert.equal(wsResult.status,200,JSON.stringify(wsResult));
 const wsTurn=(await call('/api/finance-chat/workspace',{token})).data.conversation.turns.at(-1);assert.equal(wsTurn.proposal.kind,'unclear');assert.equal(wsTurn.proposal.research,undefined);assert.equal(wsTurn.research,undefined);assert.equal(await researches().countDocuments(),rowsBefore);
 pass('4e a workspace reply cannot request research: accepted, dropped, no row');

 // 4g/4i orphan after the confirmation (line 3): recovery once, under two concurrent GETs, and after a queue that lost its marker
 const g=await ask(3,text);assert.equal((await reply(g.job,proposal)).status,200);chat=await getChat(3);
 const confirmedG=await call(base(3)+'/confirm',{method:'POST',token,body:{...bind(g.draft),chatRevision:chat.conversation.revision,turnId:g.requestId,remember:false}});assert.equal(confirmedG.status,200,JSON.stringify(confirmedG));
 const requestG=turnOf(confirmedG.data.conversation,g.requestId).research.requestId;assert.match(requestG,uuid);let rowG=await rowFor(3);assert.equal(rowG.state,'queued');assert.equal(rowG.requestId,requestG);
 const chatG=new ObjectId(confirmedG.data.conversation.id),orphan=()=>chats().updateOne({_id:chatG},{$unset:{'turns.$[t].research.requestId':'','turns.$[t].research.researchId':'','turns.$[t].research.unavailable':''}},{arrayFilters:[{'t.id':g.requestId}]});
 await orphan();assert.equal(turnOf(await chats().findOne({_id:chatG}),g.requestId).research.requestId,undefined);
 chat=await getChat(3);turn=turnOf(chat.conversation,g.requestId);assert.equal(turn.research.requestId,requestG,'a lost marker is restored from the queued row');assert.equal(turn.research.unavailable,undefined);assert.equal((await rowFor(3)).revision,rowG.revision,'no second queue');assert.equal(await researches().countDocuments({importId:oid,line:3}),1);
 await orphan();await researches().deleteOne({_id:rowG._id});
 const raced=await Promise.all([call(base(3),{token}),call(base(3),{token})]);for(const r of raced)assert.equal(r.status,200,JSON.stringify(r));
 rowG=await rowFor(3);assert.ok(rowG,'recovery queued the research');assert.equal(rowG.state,'queued');assert.equal(rowG.requestId,requestG,'the deterministic request id');assert.equal(rowG.context.revision,1,'bound to the accepted draft revision');assert.equal(rowG.context.values.purpose,'company');assert.equal(await researches().countDocuments({importId:oid,line:3}),1,'two concurrent recoveries queue once');
 turn=turnOf((await chats().findOne({_id:chatG})),g.requestId);assert.equal(turn.research.requestId,requestG,'the persisted marker is the successful request');assert.equal(turn.research.unavailable,undefined,'no recovery replaced the successful marker with unavailable');
 assert.ok(raced.some(r=>turnOf(r.data.conversation,g.requestId).research.requestId===requestG));
 chat=await getChat(3);assert.equal(turnOf(chat.conversation,g.requestId).research.requestId,requestG);assert.equal((await rowFor(3)).revision,rowG.revision,'a later GET starts nothing more');
 pass('4g/4i a confirmed turn whose research marker was lost is recovered once: marker restored from an existing queue, or queued once under two concurrent GETs with the successful marker preserved');

 // 4h-1 the draft changed between the chat claim and the reply: the unclear request is not rebound to the changed draft
 const h=await ask(4,'이 결제는 뭐였는지 확인해 줘');
 const edited=await call(draftPath(4),{method:'PUT',token,body:{...bind(h.draft),values:{...h.draft.values,productName:'Owner correction'},confirm:false,remember:[]}});assert.equal(edited.status,200,JSON.stringify(edited));
 assert.equal((await reply(h.job,unclear('確認します。','購入内容の確認'))).status,200);
 chat=await getChat(4);turn=turnOf(chat.conversation,h.requestId);assert.equal(turn.research.when,'now');assert.equal(turn.research.requestId,undefined);assert.equal(turn.research.unavailable,'下書きが更新されています。再読込してください。');assert.equal(await rowFor(4),null,'nothing bound to the changed draft');assert.equal(chat.stale,true);
 // 4h-2 a ready report whose draft changed afterwards is marked stale in the next interpreter context, findings omitted
 const jobG=(await researchCall('claim')).data.job;assert.equal(jobG.id,String(rowG._id));assert.equal((await researchCall(jobG.id+'/result',{lease:jobG.lease,sources:[...jobG.sources,source],report})).status,200);
 assert.equal((await call(researchPath(3),{token})).data.research.state,'ready');
 const dG=await getDraft(3);assert.equal((await call(draftPath(3),{method:'PUT',token,body:{...bind(dG),values:{...dG.values,productName:'Owner correction after research'},confirm:false,remember:[]}})).status,200);
 assert.equal((await call(researchPath(3),{token})).data.stale,true);
 const h2=await ask(3,'조사 결과는 어때?');const stale=h2.job.context.research;assert.equal(stale.state,'ready');assert.equal(stale.stale,true);assert.deepEqual(stale.findings,[]);assert.equal(stale.supplier,null);assert.equal(stale.summary,report.summary);assert.ok(typeof stale.meaning==='string'&&stale.meaning.length>0);
 assert.equal((await reply(h2.job,unclear('下書きが調査後に変わったため、候補は再調査が必要です。'))).status,200);
 pass('4h a late reply never rebinds research to a changed draft, and a report older than the draft is marked stale without findings in the next context');

 // An applied report survives its own draft update, but never a subsequent owner correction.
 const extraImport=await upload(csv([row({0:'2026/08/10',1:'2026/08/12',2:'Synthetic EV charging station',5:'3300'})]));assert.equal(extraImport.status,200);
 const extraId=extraImport.data.id,extraDraft='/api/finance/imports/'+extraId+'/drafts/2',extraResearch='/api/finance-research/imports/'+extraId+'/drafts/2',extraChat='/api/finance-chat/imports/'+extraId+'/drafts/2';
 const extraGet=async p=>{const r=await call(p,{token});assert.equal(r.status,200,JSON.stringify(r));return r.data},extraPost=(p,body)=>call(p,{method:'POST',token,body});
 let extraD=await extraGet(extraDraft);const extraQueued=await extraPost(extraResearch,{...bind(extraD),researchRevision:0,requestId:crypto.randomUUID(),instruction:'Confirm the captured tax rate.'});assert.equal(extraQueued.status,200,JSON.stringify(extraQueued));
 const extraJob=(await researchCall('claim')).data.job;assert.ok(extraJob);assert.equal(extraJob.id,extraQueued.data.research.id);
 assert.equal((await researchCall(extraJob.id+'/result',{lease:extraJob.lease,sources:[...extraJob.sources,source],report})).status,200);
 const extraView=await extraGet(extraResearch);assert.equal((await extraPost(extraResearch+'/apply',{...bind(extraD),researchRevision:extraView.research.revision,confirm:true,fields:['taxRate']})).status,200);
 async function extraContext(){extraD=await extraGet(extraDraft);const c=await extraGet(extraChat);assert.equal((await extraPost(extraChat,{...bind(extraD),chatRevision:c.conversation?.revision||0,requestId:crypto.randomUUID(),text:'Explain the recorded result.'})).status,200);const j=(await chatCall('claim')).data.job;assert.ok(j);assert.equal(j.context.source.description,'Synthetic EV charging station');assert.equal((await reply(j,unclear('Recorded result explanation.'))).status,200);return j.context.research}
 const ownApplication=await extraContext();assert.equal(ownApplication.state,'applied');assert.equal(ownApplication.stale,false,'own research application stays current');assert.ok(ownApplication.findings.length);
 extraD=await extraGet(extraDraft);assert.equal((await call(extraDraft,{method:'PUT',token,body:{...bind(extraD),values:{...extraD.values,productName:'Later owner correction'},confirm:false,remember:[]}})).status,200);
 const afterCorrection=await extraContext();assert.equal(afterCorrection.stale,true,'applied research must become stale after a later owner correction');assert.deepEqual(afterCorrection.findings,[]);assert.equal(afterCorrection.supplier,null);
 pass('4j applied research stays current for its own accepted draft update and becomes stale after a later owner correction');

 // 4f nothing posted
 if(process.env.OMF_TEST_CHROME_PORT)await require('./finance-research-delivery-browser.cjs')({db,call,origin,pass,csv,row,pause,root,port:Number(process.env.OMF_TEST_CHROME_PORT)});
 assert.equal(await db.collection('transactions').countDocuments(),before.tx);assert.equal(await db.collection('financeentries').countDocuments(),before.entries);
 for(const id of [teacher.id,researcher.id,workspace.id])assert.equal((await call('/api/finance-chat/agents/'+id,{method:'DELETE',token})).status,200);
 assert.equal((await chatCall('claim')).status,401);
 pass('4f chat-started research never posts ledger entries; worker revocation takes effect immediately');
};

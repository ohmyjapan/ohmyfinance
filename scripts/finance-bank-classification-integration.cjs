// Native bank classification (plan omf-rakuten-native-shiwake-20261020 §4-§8) against the built app on the harness's owned
// ephemeral MongoDB: company-scoped proposals from owner bank rows + the selected company's calendar/history, revisioned
// corrections, reusable teaching, explicit native Transaction registration with one durable reserved ID (crash, retry and
// concurrency recovery), existing-transaction linkage, and the native Vue tab in hidden real Chrome. Synthetic, fictional
// data only. Every named assertion `shiwake:<name>` is what a deliberately reintroduced defect must flip
// (scripts/zoomer-fixtures/omf-rakuten-native-shiwake.mjs). Under OMF_TEST_SHIWAKE_MUTANT the Chrome leg is skipped.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),{pathToFileURL}=require('node:url'),{ObjectId}=require('mongodb');
const sjisOf=new Map(),sjisDecoder=new TextDecoder('shift_jis');for(let b=0;b<0x80;b++)sjisOf.set(String.fromCharCode(b),[b]);for(let b=0xa1;b<=0xdf;b++)sjisOf.set(sjisDecoder.decode(Uint8Array.of(b)),[b]);
for(let lead=0x81;lead<=0xfc;lead++){if(lead>0x9f&&lead<0xe0)continue;for(let trail=0x40;trail<=0xfc;trail++){if(trail===0x7f)continue;const c=sjisDecoder.decode(Uint8Array.of(lead,trail));if(c.length===1&&c!=='�'&&!sjisOf.has(c))sjisOf.set(c,[lead,trail]);}}
const sjis=s=>Buffer.from([...s].flatMap(c=>{const b=sjisOf.get(c);if(!b)throw Error('fixture text not in Shift_JIS: '+c);return b}));
const HEAD=['取引日','入出金(円)','残高(円)','入出金先内容'];
function nativeFile(rows,start=2000000){let balance=start;const lines=[HEAD.join(',')];for(const [date,amount,description] of rows){balance+=amount;lines.push([date,String(amount),String(balance),description].join(','))}return sjis(lines.join('\r\n')+'\r\n')}
module.exports=async({db,call,origin,token,other,pass,root,pause,mutant=!!process.env.OMF_TEST_SHIWAKE_MUTANT})=>{
 const api='/api/finance-payments/',cls=api+'bank-classifications';
 const ok=(r,label)=>{assert.equal(r.status,200,'shiwake:'+label+' '+JSON.stringify(r.data).slice(0,900));return r.data};
 const req=(route,{method='GET',t,body}={})=>call(route,{method,token:t,body});
 async function send(route,bytes,t){const response=await fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'text/csv'},body:bytes});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return{status:response.status,data}}
 // ── companies: A (owner; its name is the own-company payee), B (owner; revoked later), C (another user only) ──
 const owner=await db.collection('users').findOne({email:'finance-a@example.invalid'}),otherUser=await db.collection('users').findOne({email:'finance-b@example.invalid'});assert.ok(owner&&otherUser,'synthetic users present');
 const A=new ObjectId(),B=new ObjectId(),C=new ObjectId(),now=new Date();
 await db.collection('organizations').insertMany([[A,'カクウホールディングス',owner._id],[B,'Synthetic second company',owner._id],[C,'Synthetic foreign company',otherUser._id]].map(([_id,name,userId])=>({_id,name,slug:'shiwake-'+String(_id),type:'business',isActive:true,members:[{userId,role:'owner',joinedAt:now}],settings:{defaultCurrency:'JPY'}})));
 const switchTo=async(t,id)=>ok(await call('/api/auth/switch-organization',{token:t,method:'POST',body:{organizationId:String(id)}}),'switch').tokens.accessToken;
 const tokenA=await switchTo(token,A),tokenB=await switchTo(token,B),tokenC=await switchTo(other,C);
 // ── the existing chart (company-agnostic collections), referenced, never fabricated ──
 const chart={};for(const [name,type] of [['支払手数料','expense'],['受取利息','income'],['普通預金','asset'],['地代家賃','expense'],['外注費','expense'],['売上高','income']]){chart[name]=new ObjectId();await db.collection('accountcategories').insertOne({_id:chart[name],name,type,isActive:true,order:0})}
 const taxId=new ObjectId();await db.collection('taxcategories').insertOne({organizationId:A,_id:taxId,name:'Synthetic 課税仕入10%',rate:10});
 // ── the selected company's calendar plus entries that must never reach company A's proposals ──
 const noon=d=>new Date(d+'T12:00:00.000Z'),pay=(title,amount,type,dueDate,category,extra={})=>({_id:new ObjectId(),title,amount,currency:'JPY',dueDate:noon(dueDate),type,status:'pending',category,recurring:false,organizationId:A,createdAt:now,updatedAt:now,...extra});
 const calendar=[pay('Synthetic outsourcing fee',330,'expense','2026-09-05','外注費'),pay('Synthetic cancelled fee',330,'expense','2026-09-05','雑費',{status:'cancelled'}),pay('Synthetic lease',110000,'expense','2026-09-10','地代家賃'),pay('Synthetic sales',250000,'income','2026-09-14','売上高'),pay('Synthetic outsourcing',50000,'expense','2026-09-22','外注費',{recurring:true,recurringFrequency:'monthly'}),pay('Synthetic suppressed',165,'expense','2026-09-12','外注費',{suppressedAt:now}),pay('Synthetic company-less',12,'income','2026-09-30','雑収入',{organizationId:undefined}),pay('Synthetic company B lease',110000,'expense','2026-09-10','外注費',{organizationId:B})];
 for(const p of calendar)if(p.organizationId===undefined)delete p.organizationId;
 await db.collection('payments').insertMany(calendar);const calendarBefore=JSON.stringify(await db.collection('payments').find({}).sort({_id:1}).toArray());
 // ── the owner's bank account and its rows (owner upload of a native four-column Shift_JIS statement) ──
 const account=ok(await req(api+'bank/accounts',{method:'POST',t:token,body:{name:'Synthetic Rakuten (shiwake)',currency:'JPY'}}),'bank-account').account.id;
 const importFile=async(bytes,name)=>{const d=ok(await send(api+'bank/files?name='+name,bytes,token),'bank-file').document,s=ok(await req(api+'bank/files/'+d.id+'/sheet',{t:token}),'bank-sheet');return ok(await req(api+'bank/files/'+d.id+'/import',{method:'POST',t:token,body:{sheet:s.sheet,headerRow:s.headerRow,mapping:s.mapping,bankAccountId:account,transactionIdConfirmed:false,amountSign:'outflow-negative',confirm:true}}),'bank-import')};
 const FILE1=[['20260615',-1000,'振込 カクウ'],['20260801',-50000,'振込 ヤマダ タロウ'],['20260902',-9900,'口座振替 カクウサブスク'],['20260905',-330,'振込手数料'],['20260910',-110000,'振込 カ）カクウリース'],['20260912',-165,'振込手数料'],['20260915',250000,'ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'],['20260925',-50000,'振込 サトウ ハナコ'],['20260926',-50000,'振込 スズキ ジロウ'],['20260930',12,'決算お利息'],['20261001',-300000,'振込 カ）カクウホールディングス'],['20261003',-5500,'振込 カクウストア T1234567890123 消費税10%']];
 const imported=await importFile(nativeFile(FILE1),'shiwake-1.csv');assert.equal(imported.rows.length,FILE1.length,'shiwake:rows-imported');
 const rowsByDescription=async()=>{const all=await db.collection('financebankrows').find({bankAccountId:new ObjectId(account)}).toArray();return d=>{const found=all.filter(r=>r.description===d.normalize('NFKC'));assert.equal(found.length,1,'one row '+d);return found[0]}};
 let byDesc=await rowsByDescription();
 const R={r0:byDesc('振込 カクウ'),r4:byDesc('振込 ヤマダ タロウ'),r9a:byDesc('口座振替 カクウサブスク'),r2:byDesc('振込 カ）カクウリース'),r3:byDesc('ﾌﾘｺﾐ ｶ)ｶｸｳｼｮｳｼﾞ'),r5:byDesc('振込 サトウ ハナコ'),r6:byDesc('振込 スズキ ジロウ'),r7:byDesc('決算お利息'),r8:byDesc('振込 カ）カクウホールディングス'),r10:byDesc('振込 カクウストア T1234567890123 消費税10%')};
 const fees=(await db.collection('financebankrows').find({bankAccountId:new ObjectId(account),description:'振込手数料'}).toArray()).sort((a,b)=>a.date.localeCompare(b.date));R.r1=fees[0];R.r1b=fees[1];assert.deepEqual(fees.map(r=>r.amount),[330,165]);
 const txBefore=await db.collection('transactions').countDocuments();
 const list=(t=tokenA,acct=account)=>req(cls+'?account='+acct,{t});
 const rowOf=(data,r)=>{const found=data.rows.find(x=>x.rowId===String(r._id));assert.ok(found,'shiwake:row-visible '+r.description);return found};
 // ── B1 boundary: a selected company with a fresh membership; the owner's bank account; reads never write ──
 assert.equal((await list(token)).status,403,'shiwake:company-required');
 assert.equal((await list(tokenC)).status,404,'shiwake:foreign-account-404');
 assert.equal((await req(cls+'?account=nope',{t:tokenA})).status,400,'shiwake:account-id-validated');
 const first=ok(await list(),'list');
 assert.equal(first.rows.length,FILE1.length,'shiwake:every-row-visible');assert.equal(first.company.id,String(A));assert.equal(first.account.id,account);
 assert.ok(first.rows.every(r=>r.state==='none'&&r.draft===null),'shiwake:read-before-generate');
 assert.equal(await db.collection('financebankclassifications').countDocuments(),0,'shiwake:read-writes-nothing');
 assert.equal(await db.collection('transactions').countDocuments(),txBefore,'shiwake:read-posts-nothing');
 assert.equal(JSON.stringify(await db.collection('payments').find({}).sort({_id:1}).toArray()),calendarBefore,'shiwake:calendar-unchanged');
 assert.equal(first.notes.historyEmpty,true,'shiwake:history-empty-surfaced');assert.deepEqual(first.notes.monthsWithoutRows,['2026-07'],'shiwake:missing-months-surfaced');
 const live=r=>rowOf(first,r).proposal;
 const BANK_SIDE='普通預金（Synthetic Rakuten (shiwake)）';
 assert.equal(live(R.r2).proposal.purposeKind,'calendar','shiwake:calendar-company-scoped');assert.equal(live(R.r2).proposal.purpose,'Synthetic lease','shiwake:calendar-title');assert.equal(live(R.r2).proposal.accountCategoryId,null,'shiwake:calendar-no-account');assert.equal(live(R.r2).proposal.confidence,'review','shiwake:calendar-review');assert.ok(live(R.r2).unresolved.includes('calendar-payee-unverified'),'shiwake:calendar-payee-unverified');
 assert.deepEqual(live(R.r2).calendarCandidates.map(c=>[c.paymentId,c.kind]),[[String(calendar[2]._id),'unique']],'shiwake:foreign-calendar-excluded');
 assert.equal(live(R.r1b).proposal.confidence,'supported','shiwake:suppressed-calendar-excluded');assert.equal(live(R.r1b).proposal.purposeKind,'bank-fee');
 assert.ok(live(R.r1).unresolved.includes('calendar-category-conflict'),'shiwake:category-conflict');assert.ok(!live(R.r1).unresolved.includes('calendar-ambiguous'),'shiwake:cancelled-calendar-excluded');
 assert.equal(live(R.r7).calendarCandidates.length,0,'shiwake:company-less-calendar-excluded');assert.equal(live(R.r7).proposal.purposeKind,'interest');
 assert.equal(live(R.r3).direction,'in','shiwake:signed-incoming');assert.equal(live(R.r3).proposal.accountCategoryId,null);assert.deepEqual(live(R.r3).preview,{debit:{account:BANK_SIDE,amount:250000},credit:{account:'勘定科目 未設定',amount:250000}},'shiwake:incoming-preview');
 assert.deepEqual(live(R.r1b).preview,{debit:{account:'支払手数料',amount:165},credit:{account:BANK_SIDE,amount:165}},'shiwake:outgoing-preview (the actual bank account named on the bank side)');
 for(const r of [R.r5,R.r6]){assert.ok(live(r).unresolved.includes('calendar-ambiguous'),'shiwake:reused-calendar-ambiguous');assert.equal(live(r).proposal.accountCategoryId,null)}
 assert.equal(live(R.r8).proposal.purposeKind,'own-transfer','shiwake:own-company-transfer');assert.equal(live(R.r8).proposal.accountCategoryId,null,'shiwake:transfer-not-expense');
 assert.equal(live(R.r4).proposal.purposeKind,'none','shiwake:personal-unknown');assert.ok(live(R.r4).unresolved.includes('purpose-unknown'));
 assert.deepEqual(live(R.r10).tax,{status:'unknown'},'shiwake:no-tax-inference');assert.deepEqual(live(R.r10).invoice,{value:null,status:'unverified'},'shiwake:no-t-inference');
 pass('B1 boundary and live proposals: company token with fresh membership required, foreign bank account 404, every row visible, reads write nothing, company-scoped calendar (cancelled/suppressed/company-less/other company excluded), signed directions, fee/interest/calendar/transfer/personal/tax semantics');
 // ── G generation: idempotent, concurrent-safe, one company per source row ──
 const generated=ok(await req(cls+'/generate',{method:'POST',t:tokenA,body:{bankAccountId:account}}),'generate');
 assert.equal(generated.created,FILE1.length,'shiwake:drafts-created');assert.equal(await db.collection('financebankclassifications').countDocuments({organizationId:A}),FILE1.length);
 assert.equal(await db.collection('transactions').countDocuments(),txBefore,'shiwake:generate-posts-nothing');assert.equal(JSON.stringify(await db.collection('payments').find({}).sort({_id:1}).toArray()),calendarBefore,'shiwake:generate-calendar-unchanged');
 const again=ok(await req(cls+'/generate',{method:'POST',t:tokenA,body:{bankAccountId:account}}),'generate-again');assert.equal(again.created,0,'shiwake:generate-idempotent');
 const parallel=await Promise.all([1,2,3].map(()=>req(cls+'/generate',{method:'POST',t:tokenA,body:{bankAccountId:account}})));assert.ok(parallel.every(r=>r.status===200),'shiwake:generate-concurrent '+JSON.stringify(parallel.map(r=>r.status)));
 assert.equal(await db.collection('financebankclassifications').countDocuments(),FILE1.length,'shiwake:generate-no-duplicates');
 const drafts=await db.collection('financebankclassifications').find({organizationId:A}).toArray();
 for(const d of drafts){assert.ok(d.reservedTransactionId instanceof ObjectId,'shiwake:reserved-id');assert.equal(String(d.ownerId),String(owner._id));assert.equal(String(d.bankAccountId),account)}
 assert.equal(new Set(drafts.map(d=>String(d.reservedTransactionId))).size,drafts.length,'shiwake:reserved-id-unique');
 const inB=ok(await list(tokenB),'list-b');assert.equal(inB.rows.length,FILE1.length,'shiwake:other-company-rows-visible');assert.ok(inB.rows.every(r=>r.state==='other-company'&&r.draft===null),'shiwake:other-company-no-details');
 assert.equal(ok(await req(cls+'/generate',{method:'POST',t:tokenB,body:{bankAccountId:account}}),'generate-b').created,0,'shiwake:one-company-per-source');
 const draftOf=async r=>{const d=rowOf(ok(await list(),'list'),r).draft;assert.ok(d,'draft for '+r.description);return d};
 const d1b=await draftOf(R.r1b);assert.equal((await req(cls+'/'+d1b.id,{t:tokenB})).status,404,'shiwake:draft-company-scoped');assert.equal((await req(cls+'/'+d1b.id,{t:tokenC})).status,404,'shiwake:draft-owner-scoped');
 pass('G generation: drafts created once with distinct durable reserved Transaction IDs, repeated and concurrent generation create none, reads/generation post nothing and leave the calendar unchanged, another company sees the rows without details and cannot claim them');
 // ── E corrections: expected revision, validated references, durable history, refresh keeps manual values, source changes surface ──
 const put=(d,body,t=tokenA)=>req(cls+'/'+d.id,{method:'PUT',t,body});
 const d5=await draftOf(R.r5);
 assert.equal((await put(d5,{revision:d5.revision+1,values:{purpose:'外注費'}})).status,409,'shiwake:stale-revision');
 assert.equal((await put(d5,{revision:d5.revision,values:{accountCategoryId:String(new ObjectId())}})).status,400,'shiwake:unknown-reference');
 assert.equal((await put(d5,{revision:d5.revision,values:{invoiceNumber:'T123'}})).status,400,'shiwake:invoice-shape');
 assert.equal((await put(d5,{revision:d5.revision,values:{bogus:1}})).status,400,'shiwake:unknown-field');
 const e5=ok(await put(d5,{revision:d5.revision,values:{purpose:'外注費',accountCategoryId:String(chart['外注費']),invoiceNumber:'T9876543210987',taxCategoryId:String(taxId)}}),'edit').row.draft;
 assert.equal(e5.revision,d5.revision+1,'shiwake:revision-incremented');assert.equal(e5.values.accountCategoryId,String(chart['外注費']));assert.equal(e5.invoice.status,'entered-unverified','shiwake:t-entered-not-verified');assert.equal(e5.state,'edited');
 const stored5=await db.collection('financebankclassifications').findOne({_id:new ObjectId(d5.id)});assert.equal(stored5.history.at(-1).action,'edited','shiwake:history-durable');assert.equal(stored5.history.at(-1).before.accountCategoryId,'');assert.equal(stored5.history.at(-1).after.accountCategoryId,String(chart['外注費']));assert.equal(stored5.manual,true);
 ok(await req(cls+'/generate',{method:'POST',t:tokenA,body:{bankAccountId:account}}),'refresh');const kept5=await draftOf(R.r5);assert.equal(kept5.values.accountCategoryId,String(chart['外注費']),'shiwake:refresh-keeps-manual');assert.equal(kept5.revision,e5.revision,'shiwake:refresh-no-manual-revision');
 // the source row changes (an explicit owner reinterpretation increments the row revision): stale, not registrable until acknowledged
 await db.collection('financebankrows').updateOne({_id:R.r6._id},{$inc:{revision:1},$set:{description:'振込 スズキ ジロウ（訂正）'},$push:{history:{at:new Date(),action:'source-updated'}}});
 const d6=await draftOf(R.r6);assert.equal(d6.sourceChanged,true,'shiwake:source-changed-visible');
 assert.equal((await put(d6,{revision:d6.revision,values:{purpose:'外注費',accountCategoryId:String(chart['外注費'])}})).status,409,'shiwake:source-change-needs-ack');
 const e6=ok(await put(d6,{revision:d6.revision,acceptSource:true,values:{purpose:'外注費',accountCategoryId:String(chart['外注費'])}}),'edit-ack-source').row.draft;assert.equal(e6.sourceChanged,false,'shiwake:source-acknowledged');assert.equal(e6.source.description,'振込 スズキ ジロウ（訂正）');
 pass('E corrections: stale revision 409, unknown chart reference/T shape/unknown field 400, revision and before/after history persisted, entered T number stays unverified, refresh keeps manual values, a changed source is shown and must be acknowledged');
 // ── T teaching: explicit, from an approved exact payee decision only ──
 const d4=await draftOf(R.r4);assert.equal((await req(cls+'/'+d4.id+'/remember',{method:'POST',t:tokenA,body:{revision:d4.revision}})).status,400,'shiwake:teach-needs-decision');
 const taught=ok(await req(cls+'/'+d5.id+'/remember',{method:'POST',t:tokenA,body:{revision:kept5.revision}}),'remember').teaching;assert.equal(taught.payeeKey,'サトウハナコ','shiwake:teach-payee');assert.equal(taught.values.accountCategoryId,String(chart['外注費']));
 assert.equal(await db.collection('financebankteachings').countDocuments({organizationId:A}),1,'shiwake:teach-durable');
 pass('T teaching: an undecided row cannot be taught; an approved exact payee decision is stored for the company');
 // ── R registration: explicit, the durable reserved ID, retry/concurrency/crash recovery, no duplicate effect ──
 const register=(d,body,t=tokenA)=>req(cls+'/'+d.id+'/register',{method:'POST',t,body});
 assert.equal((await register(d1b,{revision:d1b.revision,action:'create'})).status,400,'shiwake:register-needs-confirm');
 assert.equal((await register(d1b,{revision:d1b.revision+5,action:'create',confirm:true})).status,409,'shiwake:register-stale');
 const reg1=ok(await register(d1b,{revision:d1b.revision,action:'create',confirm:true}),'register');
 assert.equal(reg1.transaction.id,String(d1b.reservedTransactionId),'shiwake:reserved-id-used');assert.equal(reg1.replayed,false);
 const tx1=await db.collection('transactions').findOne({_id:new ObjectId(reg1.transaction.id)});
 assert.equal(String(tx1.organizationId),String(A),'shiwake:transaction-company');assert.equal(tx1.amount,165);assert.equal(tx1.type,'支出','shiwake:transaction-direction');assert.equal(String(tx1.accountCategoryId),String(chart['支払手数料']));assert.equal(tx1.status,'completed');
 assert.equal(tx1.metadata.bankClassificationId,d1b.id,'shiwake:transaction-source-link');assert.equal(tx1.metadata.bankRowId,String(R.r1b._id));assert.equal(tx1.metadata.bankAccountId,account);assert.equal(tx1.metadata.bankRowRevision,R.r1b.revision);assert.equal(tx1.metadata.taxStatus,'unknown','shiwake:transaction-tax-unknown');assert.equal(tx1.taxCategoryId,undefined,'shiwake:transaction-no-tax-inferred');
 assert.ok(tx1.timeline.some(e=>e.type==='bank-classification'),'shiwake:transaction-timeline');
 const readback=ok(await req('/api/transactions/'+reg1.transaction.id,{t:tokenA}),'transaction-readback');assert.equal(readback.amount,165,'shiwake:native-readback');assert.equal(readback.metadata?.bankClassificationId,d1b.id,'shiwake:native-readback-source');
 assert.equal((await req('/api/transactions/'+reg1.transaction.id,{t:tokenB})).status,404,'shiwake:native-readback-company-scoped');
 const replay=ok(await register(d1b,{revision:d1b.revision,action:'create',confirm:true}),'register-replay');assert.equal(replay.transaction.id,reg1.transaction.id,'shiwake:register-idempotent');assert.equal(replay.replayed,true);
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':d1b.id}),1,'shiwake:no-duplicate-effect');
 assert.equal((await put(await draftOf(R.r1b),{revision:(await draftOf(R.r1b)).revision,values:{notes:'x'}})).status,409,'shiwake:registered-immutable');
 // concurrency: five simultaneous registrations of one draft → one Transaction, the same ID everywhere
 const d7=await draftOf(R.r7),burst=await Promise.all([1,2,3,4,5].map(()=>register(d7,{revision:d7.revision,action:'create',confirm:true})));
 assert.ok(burst.every(r=>[200,409].includes(r.status)),'shiwake:concurrent-status '+JSON.stringify(burst.map(r=>r.status)));assert.ok(burst.some(r=>r.status===200));
 for(const r of burst.filter(r=>r.status===200))assert.equal(r.data.transaction.id,String(d7.reservedTransactionId),'shiwake:concurrent-same-id');
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':d7.id}),1,'shiwake:concurrent-one-transaction');
 assert.equal((await db.collection('transactions').findOne({_id:new ObjectId(String(d7.reservedTransactionId))})).type,'入金','shiwake:incoming-transaction-type');
 // crash after the reservation was persisted, before the insert: the retry creates that same ID once
 // the calendar match proposed only the purpose; the owner chooses the account before registering (calendar categories are not accounts)
 const p3=await draftOf(R.r3);assert.equal(p3.ready.ready,false,'shiwake:calendar-needs-owner-account');assert.deepEqual(p3.ready.reasons,['account-missing']);
 const d3=ok(await put(p3,{revision:p3.revision,values:{accountCategoryId:String(chart['売上高'])}}),'edit-r3').row.draft,first3=ok(await register(d3,{revision:d3.revision,action:'create',confirm:true}),'register-r3');
 await db.collection('transactions').deleteOne({_id:new ObjectId(first3.transaction.id)});await db.collection('financebankclassifications').updateOne({_id:new ObjectId(d3.id)},{$set:{'registration.state':'reserved'}});
 assert.equal(rowOf(ok(await list(),'list-crash'),R.r3).state,'registering','shiwake:crash-state-visible');
 const resumed=ok(await register(d3,{revision:d3.revision,action:'create',confirm:true}),'register-resume');assert.equal(resumed.transaction.id,first3.transaction.id,'shiwake:crash-before-insert-same-id');
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':d3.id}),1,'shiwake:crash-before-insert-once');
 // crash after the insert, before the registered mark: the retry finds the same Transaction and creates nothing
 await db.collection('financebankclassifications').updateOne({_id:new ObjectId(d3.id)},{$set:{'registration.state':'reserved'}});
 const resumed2=ok(await register(d3,{revision:d3.revision+9,action:'create',confirm:true}),'register-resume-2');assert.equal(resumed2.transaction.id,first3.transaction.id,'shiwake:crash-after-insert-same-id');
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':d3.id}),1,'shiwake:crash-after-insert-once');assert.equal(rowOf(ok(await list(),'list-after'),R.r3).state,'registered');
 // a reserved ID already holding another company's or another source's record is never overwritten
 const d2=ok(await put(await draftOf(R.r2),{revision:(await draftOf(R.r2)).revision,values:{purpose:'地代家賃',accountCategoryId:String(chart['地代家賃'])}}),'edit-r2').row.draft;assert.equal(d2.ready.ready,true,'r2 registrable');await db.collection('transactions').insertOne({_id:new ObjectId(String(d2.reservedTransactionId)),organizationId:B,amount:1,type:'支出',date:new Date(),status:'completed',items:[],timeline:[]});
 const collision=await register(d2,{revision:d2.revision,action:'create',confirm:true});assert.equal(collision.status,409,'shiwake:reserved-id-collision');assert.match(JSON.stringify(collision.data),/予約済み/,'shiwake:reserved-id-collision (refused for the reserved ID)');assert.equal((await db.collection('transactions').findOne({_id:new ObjectId(String(d2.reservedTransactionId))})).amount,1,'shiwake:collision-not-overwritten');
 await db.collection('transactions').deleteOne({_id:new ObjectId(String(d2.reservedTransactionId)),organizationId:B});
 pass('R registration: explicit confirmation and current revision, the durable reserved ID is the Transaction ID in the selected company with bank source metadata/timeline, native readback company-scoped, retry idempotent, five concurrent requests one Transaction, both crash windows recover the same single effect, a foreign record at the reserved ID is never overwritten');
 // ── N not registrable: unresolved purpose, unreviewed transfer, superseded source, changed source ──
 const n4=await register(d4,{revision:d4.revision,action:'create',confirm:true});assert.equal(n4.status,409,'shiwake:purpose-required');assert.match(JSON.stringify(n4.data),/purpose-missing|用途/);
 const d8=await draftOf(R.r8),n8=await put(d8,{revision:d8.revision,values:{purpose:'資金移動',accountCategoryId:String(chart['普通預金'])}});const e8=ok(n8,'edit-transfer').row.draft;
 const r8=await register(e8,{revision:e8.revision,action:'create',confirm:true});assert.equal(r8.status,409,'shiwake:transfer-unreviewed');
 await db.collection('financebankrows').updateOne({_id:R.r10._id},{$inc:{revision:1},$set:{description:'振込 カクウストア 再取込'}});const d10=await draftOf(R.r10);const e10=ok(await put(d10,{revision:d10.revision,acceptSource:true,values:{purpose:'仕入',accountCategoryId:String(chart['外注費'])}}),'edit-r10').row.draft;
 await db.collection('financebankrows').updateOne({_id:R.r10._id},{$inc:{revision:1}});assert.equal((await register(e10,{revision:e10.revision,action:'create',confirm:true})).status,409,'shiwake:changed-source-not-registered');
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':{$in:[d4.id,d8.id,d10.id]}}),0,'shiwake:unready-posts-nothing');
 pass('N not registrable: unknown purpose, an own-company transfer without explicit review and a source changed after review all stay reviewable and post nothing');
 // ── L existing transaction linkage: never silently double-booked; the existing record is not rewritten ──
 const existing=await db.collection('transactions').insertOne({organizationId:A,date:new Date('2026-09-02T00:00:00.000Z'),amount:9900,type:'支出',status:'completed',notes:'Synthetic historical subscription',items:[],timeline:[],createdAt:now,updatedAt:now});
 const foreignTx=await db.collection('transactions').insertOne({organizationId:B,date:new Date('2026-09-02T00:00:00.000Z'),amount:9900,type:'支出',status:'completed',items:[],timeline:[],createdAt:now,updatedAt:now});
 const d9a=await draftOf(R.r9a),e9a=ok(await put(d9a,{revision:d9a.revision,values:{purpose:'支払手数料',accountCategoryId:String(chart['支払手数料'])}}),'edit-r9a').row.draft;
 const view9a=ok(await req(cls+'/'+d9a.id,{t:tokenA}),'draft-view');assert.deepEqual(view9a.linkCandidates.map(c=>c.id),[String(existing.insertedId)],'shiwake:link-candidates-company-scoped');
 assert.equal((await register(e9a,{revision:e9a.revision,action:'create',confirm:true})).status,409,'shiwake:no-silent-double-booking');
 assert.equal((await register(e9a,{revision:e9a.revision,action:'link',transactionId:String(foreignTx.insertedId),confirm:true})).status,400,'shiwake:link-foreign-refused');
 const before=await db.collection('transactions').findOne({_id:existing.insertedId});
 const linked=ok(await register(e9a,{revision:e9a.revision,action:'link',transactionId:String(existing.insertedId),confirm:true}),'link');assert.equal(linked.transaction.id,String(existing.insertedId),'shiwake:linked');assert.equal(linked.row.state,'linked');
 assert.deepEqual(await db.collection('transactions').findOne({_id:existing.insertedId}),before,'shiwake:link-no-rewrite');
 const d0=await draftOf(R.r0),e0=ok(await put(d0,{revision:d0.revision,values:{purpose:'支払手数料',accountCategoryId:String(chart['支払手数料'])}}),'edit-r0').row.draft;
 await db.collection('transactions').updateOne({_id:existing.insertedId},{$set:{amount:1000,date:new Date('2026-06-15T00:00:00.000Z')}});
 assert.equal((await register(e0,{revision:e0.revision,action:'link',transactionId:String(existing.insertedId),confirm:true})).status,409,'shiwake:link-once');
 await db.collection('transactions').updateOne({_id:existing.insertedId},{$set:{amount:9900,date:new Date('2026-09-02T00:00:00.000Z')}});
 pass('L linkage: a company candidate blocks a silent second booking, a foreign company record cannot be linked, the explicit link leaves the existing Transaction byte-identical, one Transaction links to one source only');
 // ── H history and teaching in later proposals; supersession; revoked membership ──
 const FILE2=[['20261002',-9900,'口座振替 カクウサブスク'],['20261005',-50000,'振込 サトウ ハナコ'],['20261003',-5500,'振込 カクウストア 訂正'],['20260930',12,'決算お利息（訂正）']];
 await importFile(nativeFile(FILE2,1000000),'shiwake-2.csv');
 const later=ok(await list(),'list-later'),r9=rowOf(later,await db.collection('financebankrows').findOne({bankAccountId:new ObjectId(account),date:'2026-10-02'}));
 assert.equal(r9.proposal.proposal.purposeKind,'history','shiwake:history-proposal');assert.equal(r9.proposal.proposal.accountCategoryId,String(chart['支払手数料']));
 const r5b=rowOf(later,await db.collection('financebankrows').findOne({bankAccountId:new ObjectId(account),date:'2026-10-05'}));assert.equal(r5b.proposal.proposal.purposeKind,'teaching','shiwake:teaching-proposal');
 const corrected=await db.collection('financebankrows').findOne({bankAccountId:new ObjectId(account),date:'2026-10-03',description:'振込 カクウストア 訂正'}),oldRow=await db.collection('financebankrows').findOne({_id:R.r10._id});
 ok(await req(api+'bank/rows/'+corrected._id,{method:'PUT',t:token,body:{supersedes:String(oldRow._id),confirm:true,revision:corrected.revision}}),'supersede');
 const afterSupersede=ok(await list(),'list-superseded'),old=rowOf(afterSupersede,oldRow);assert.equal(old.state,'superseded','shiwake:superseded-visible');assert.equal(afterSupersede.rows.length,FILE1.length+FILE2.length,'shiwake:superseded-row-kept');
 const dOld=old.draft||(await draftOf(oldRow));assert.equal((await register(dOld,{revision:dOld.revision,action:'create',confirm:true})).status,409,'shiwake:superseded-not-registered');
 const interestFix=await db.collection('financebankrows').findOne({bankAccountId:new ObjectId(account),description:'決算お利息（訂正）'.normalize('NFKC')});ok(await req(api+'bank/rows/'+interestFix._id,{method:'PUT',t:token,body:{supersedes:String(R.r7._id),confirm:true,revision:interestFix.revision}}),'supersede-registered');
 ok(await req(cls+'/generate',{method:'POST',t:tokenA,body:{bankAccountId:account}}),'generate-after-correction');const fixView=rowOf(ok(await list(),'list-correction'),interestFix);assert.equal(fixView.predecessorRegistered,true,'shiwake:predecessor-visible');
 const fixRegister=await register(fixView.draft,{revision:fixView.draft.revision,action:'create',confirm:true});assert.equal(fixRegister.status,409,'shiwake:predecessor-registered');assert.match(JSON.stringify(fixRegister.data),/predecessor-registered/);
 assert.equal(await db.collection('transactions').countDocuments({'metadata.bankRowId':String(interestFix._id)}),0,'shiwake:predecessor-no-second-effect');assert.equal(rowOf(ok(await list(),'list-correction-2'),R.r7).state,'superseded');assert.equal(await db.collection('transactions').countDocuments({'metadata.bankClassificationId':d7.id}),1,'shiwake:predecessor-effect-kept');
 await db.collection('organizations').updateOne({_id:B},{$pull:{members:{userId:owner._id}}});assert.equal((await list(tokenB)).status,403,'shiwake:revoked-membership');
 assert.equal((await req(cls+'/generate',{method:'POST',t:tokenB,body:{bankAccountId:account}})).status,403,'shiwake:revoked-membership-write');
 pass('H later proposals use the registered/linked history and the taught payee; a superseded row stays visible and cannot be registered; the corrected successor of a registered row is refused (one effect per merged source); a removed member is refused on read and write with a still-valid token');
 if(mutant)return;
 // ── V native Vue tab in hidden real Chrome (390 / 1440 px): generate, review evidence, correct, teach, register, readback ──
 const {browserFor}=await import(pathToFileURL(path.join(root,'collector/browser.mjs')).href),profileDir=await fs.mkdtemp(path.join(os.tmpdir(),'omf-shiwake-browser-')),browser=await browserFor(path.join(profileDir,'profile'),{headless:true});let page;const errors=[];
 try{
  page=await browser.newPage();await page.setViewport({width:390,height:844});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text())});
  const wait=async(f,arg,label='')=>{for(let i=0;i<300;i++){if(await page.evaluate(f,arg))return;await pause(100)}throw Error('shiwake:chrome condition '+label+' '+f.toString().slice(0,160))};
  await page.goto(origin+'/login',{waitUntil:'networkidle2'});await page.type('#email','finance-a@example.invalid');await page.type('#password','Synthetic-password-Only1!');await page.evaluate(()=>document.querySelector('button[type="submit"]').click());await wait(()=>location.pathname==='/');
  await page.evaluate(async organizationId=>{const user=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('user');const r=await fetch('/api/auth/switch-organization',{method:'POST',headers:{...user.authHeader,'Content-Type':'application/json'},body:JSON.stringify({organizationId})}),s=await r.json();if(!r.ok)throw Error('Synthetic switch failed');const p=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+s.tokens.accessToken}});user.acceptSession({...await p.json(),tokens:s.tokens},false)},String(A));
  await page.goto(origin+'/intake/payments',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('[data-payment-list]'));
  // the existing selection context: a bank payment selected on 明細 is Navi's selection there only, restored on return
  const selection=()=>page.evaluate(()=>{const s=document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('assistant')?.pageSelection;return s?{paymentKind:s.paymentKind}:null});
  await wait(()=>!!document.querySelector('[data-payment-key^="bank:"]'));await page.click('[data-payment-key^="bank:"]');await wait(()=>!!document.querySelector('[data-payment-key]'));await pause(300);assert.deepEqual(await selection(),{paymentKind:'bank'},'shiwake:chrome-selection-before');
  await page.click('[data-review-tab="bank-classification"]');await wait(()=>!!document.querySelector('[data-bank-classification]'),null,'tab');assert.equal(await selection(),null,'shiwake:chrome-selection-cleared-on-tab');
  await wait(()=>{const s=document.querySelector('[data-bank-classification-account]');return !!s&&[...s.options].some(o=>o.value)},null,'account option');await page.select('[data-bank-classification-account]',account);
  await wait(id=>!!document.querySelector('[data-bank-classification-row="'+id+'"]'),String(R.r1b._id),'rows');
  const rowSel=r=>'[data-bank-classification-row="'+String(r._id)+'"] ';
  assert.match(await page.$eval(rowSel(R.r1b)+'[data-bank-classification-state]',e=>e.textContent),/登録済み/,'shiwake:chrome-registered-state');assert.ok(await page.$(rowSel(R.r1b)+'[data-bank-classification-transaction]'),'shiwake:chrome-transaction-link');
  assert.match(await page.$eval(rowSel(R.r1b)+'[data-bank-classification-transaction]',e=>e.getAttribute('href')),new RegExp('/transactions/'+reg1.transaction.id),'shiwake:chrome-transaction-href');
  assert.match(await page.$eval(rowSel(R.r8)+'[data-bank-classification-unresolved]',e=>e.textContent),/他行の入金確認|資金移動/,'shiwake:chrome-transfer-unresolved');
  assert.match(await page.$eval(rowSel(R.r4)+'[data-bank-classification-unresolved]',e=>e.textContent),/用途が不明/,'shiwake:chrome-unknown-visible');
  assert.match(await page.$eval(rowSel(R.r2)+'[data-bank-classification-evidence]',e=>e.textContent),/カレンダー/,'shiwake:chrome-calendar-evidence');
  assert.match(await page.$eval(rowSel(R.r2)+'[data-bank-classification-preview]',e=>e.textContent.replace(/\s+/g,' ')),/借方 地代家賃.*貸方 普通預金/,'shiwake:chrome-preview');
  assert.match(await page.$eval('[data-bank-classification-notes]',e=>e.textContent),/2026-07/,'shiwake:chrome-missing-months');
  // correct r2 in the native editor, then register it explicitly
  await page.click(rowSel(R.r2)+'[data-bank-classification-open]');await wait(sel=>!!document.querySelector(sel+'[data-bank-classification-editor]'),rowSel(R.r2),'editor');
  await page.click(rowSel(R.r2)+'[data-field="notes"]');await page.type(rowSel(R.r2)+'[data-field="notes"]','Synthetic September lease');await page.select(rowSel(R.r2)+'[data-field="taxCategoryId"]',String(taxId));
  await page.click(rowSel(R.r2)+'[data-bank-classification-save]');
  for(let i=0;i<60&&!(await db.collection('financebankclassifications').findOne({_id:new ObjectId(d2.id)})).values.notes;i++)await pause(100);
  const saved2=await db.collection('financebankclassifications').findOne({_id:new ObjectId(d2.id)});assert.equal(saved2.values.notes,'Synthetic September lease','shiwake:chrome-correction-persisted');assert.equal(String(saved2.values.taxCategoryId),String(taxId));assert.equal(saved2.history.at(-1).action,'edited');
  await wait(sel=>!!document.querySelector(sel+'[data-bank-classification-register]'),rowSel(R.r2),'register button');
  assert.equal(await page.$eval(rowSel(R.r2)+'[data-bank-classification-register]',e=>e.disabled),true,'shiwake:chrome-register-needs-confirm');
  await page.click(rowSel(R.r2)+'[data-bank-classification-confirm]');await wait(sel=>!document.querySelector(sel+'[data-bank-classification-register]').disabled,rowSel(R.r2),'register enabled');
  assert.match(await page.$eval(rowSel(R.r2)+'[data-bank-classification-register]',e=>e.textContent),/確認して取引へ登録/);await page.click(rowSel(R.r2)+'[data-bank-classification-register]');
  await wait(sel=>!!document.querySelector(sel+'[data-bank-classification-transaction]'),rowSel(R.r2),'registered link');
  const tx2=await db.collection('transactions').findOne({'metadata.bankClassificationId':d2.id});assert.ok(tx2,'shiwake:chrome-registered');assert.equal(String(tx2._id),String(d2.reservedTransactionId),'shiwake:chrome-reserved-id');assert.equal(tx2.notes,'Synthetic September lease');assert.equal(String(tx2.taxCategoryId),String(taxId),'shiwake:chrome-owner-tax-only');
  await page.goto(origin+'/transactions/'+String(tx2._id),{waitUntil:'networkidle2'});await wait(()=>/110,000|110000/.test(document.body.innerText),null,'transaction page');
  await page.goto(origin+'/intake/payments',{waitUntil:'networkidle2'});await wait(()=>!!document.querySelector('[data-review-tab="bank-classification"]'));await page.click('[data-review-tab="payments"]');await pause(300);
  await page.click('[data-review-tab="bank-classification"]');await wait(()=>!!document.querySelector('[data-bank-classification]'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'shiwake:chrome-no-overflow');
  if(process.env.OMF_TEST_PAYMENT_SCREENSHOTS){await fs.mkdir(process.env.OMF_TEST_PAYMENT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS,'bank-classification-mobile.png'),fullPage:true})}
  await page.setViewport({width:1440,height:1000});await pause(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'shiwake:chrome-desktop-no-overflow');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));assert.equal(await page.$eval('[data-bank-classification-account]',e=>getComputedStyle(e).backgroundColor),'rgb(30, 41, 59)','shiwake:chrome-dark-control');
  if(process.env.OMF_TEST_PAYMENT_SCREENSHOTS)await page.screenshot({path:path.join(process.env.OMF_TEST_PAYMENT_SCREENSHOTS,'bank-classification-desktop-dark.png'),fullPage:true});
  assert.deepEqual(errors,[],'shiwake:chrome-no-console-errors');
 }finally{if(page)await page.close().catch(()=>{});await browser.close();if(!path.resolve(profileDir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe owned Chrome cleanup');await fs.rm(profileDir,{recursive:true,force:true})}
 pass('V hidden real Chrome: the 銀行仕訳 tab on /intake/payments clears and restores the payment selection, shows states/evidence/unresolved/debit-credit/missing months, saves a correction with history, registers only after explicit confirmation with the reserved ID, native transaction page reads it back, 390/1440 px without overflow, dark control, no console errors');
};

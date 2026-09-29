const assert=require('node:assert/strict'),vue=require('vue'),{ObjectId}=require('mongodb');
const workspace=require('./helpers/transaction-workspace.cjs'),storage=require('./helpers/manual-draft-store.cjs');
module.exports=async({db,call,token,other,origin,pass})=>{
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url')),organizationId=new ObjectId(claims.organizationId);
 const user=()=>vue.reactive({sessionId:'synthetic-draft-session',isAuthenticated:true,user:{id:claims.userId},authHeader:{Authorization:'Bearer '+token},currentOrganization:{id:claims.organizationId,role:'owner'},initAuth(){}});
 const http=require('ofetch').ofetch.create({baseURL:origin,retry:0}),draftStore=storage(),sent=[];
 const body={date:'2026-09-22T00:00:00.000Z',amount:1234,notes:'Synthetic compiled draft'};
 let lost=true;const fetch=async(url,options)=>{if(options.method==='POST')sent.push(options.headers['Idempotency-Key']);const response=await http(url,options);if(lost&&options.method==='POST')throw Error('Synthetic lost response');return response};
 const first=workspace({user:user(),draftStore,fetch});let key,id;
 try{assert.equal(await first.state.createTransaction(body),null);key=first.state.draftRecord.value.key;assert.equal(first.state.saveOutcomeUnknown.value,true);const row=await db.collection('transactions').findOne({'manualCreate.key':key});assert.ok(row);id=String(row._id)}finally{first.close()}
 lost=false;const next=workspace({user:user(),draftStore,fetch});
 try{
  await next.state.loadDraft(key);const saved=await next.state.createTransaction(body);assert.equal(saved.transactionId,id);assert.deepEqual(sent,[key,key]);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':key}),1);
  pass('compiled client remount retries the original persisted intent through the keyed API without another purchase');
  await next.state.startDraft();const separate=await next.state.createTransaction(body);assert.notEqual(separate.transactionId,id);assert.equal(await db.collection('transactions').countDocuments({organizationId,notes:body.notes}),2);
  pass('explicit new purchase creates a separate record even when all accounting fields match');
  await call('/api/transactions/'+id,{method:'DELETE',token});const before=sent.length;assert.equal((await next.state.recoverDraft(key)).state,'deleted');assert.equal(sent.length,before);assert.equal(next.state.transactions.value.some(row=>row.id===id),false);
  pass('compiled recovery reports deleted state through read-only reconciliation and never recreates the entry');
  const failed=await next.state.startDraft();assert.equal(await next.state.createTransaction({...body,date:'bad'}),null);assert.equal(next.state.draftRecord.value.state,'rejected');const corrected=await next.state.createTransaction(body);assert.equal(corrected.state,'saved');assert.equal(next.state.draftRecord.value.key,failed.key);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':failed.key}),1);
  pass('actual validation rejection allows corrected fields while retaining one original request identity');
  const abandoned=await next.state.startDraft();assert.equal(await next.state.createTransaction({...body,date:'bad'}),null);const rejected=next.state.draftRecord.value;
  assert.equal((await next.state.discardRejectedDraft(abandoned.key,rejected.revision)).state,'discarded');const beforeDiscardedRetry=sent.length;assert.equal(await next.state.createTransaction(body),null);assert.equal(sent.length,beforeDiscardedRetry);assert.equal(await db.collection('transactions').countDocuments({'manualCreate.key':abandoned.key}),0);
  pass('actual rejected purchase can be discarded without an API write or later retry POST');
 }finally{next.close()}
 for(const rejected of [false,true]){
  let release,announce,reloaded,reads=0,posts=0;
  const held=new Promise(resolve=>release=resolve),captured=new Promise(resolve=>announce=resolve),replacement=new Promise(resolve=>reloaded=resolve);
  const p=workspace({user:user(),fetch:async(url,options)=>{if(options.method){posts++;return http(url,options)}const response=await http(url,options);if(++reads===1){announce(response);await held}else reloaded();return response}});
  try{
   const reading=p.state.fetchTransactions(),before=await captured;
   const saved=await p.state.createTransaction({...body,date:rejected?'bad':body.date,notes:'Synthetic save while loading'});
   if(rejected){assert.equal(saved,null);assert.equal(p.state.draftRecord.value.state,'rejected');release();assert.equal(await reading,true);assert.deepEqual(p.state.transactions.value.map(row=>row.id).sort(),before.transactions.map(row=>String(row.id||row._id)).sort());assert.equal(reads,1)}
   else{assert.equal(saved.state,'saved');await replacement;await vue.nextTick();release();assert.equal(await reading,false);const expected=await http('/api/transactions',{headers:user().authHeader,retry:0});assert.deepEqual(p.state.transactions.value.map(row=>row.id).sort(),expected.transactions.map(row=>String(row.id||row._id)).sort());assert.equal(reads,2);const stored=await db.collection('transactions').findOne({'manualCreate.key':p.state.draftRecord.value.key});assert.equal(stored.timeline.length,1);assert.equal(p.state.draftNotice.value,'')}
   assert.equal(posts,1);assert.equal(p.state.error.value,null);
   pass(rejected?'actual rejected save keeps the pending complete company list readable':'actual keyed save during list loading restores every company row without another write');
  }finally{release();p.close()}
 }
 if(process.env.OMF_TEST_CHROME_PORT)await require('./manual-draft-browser.cjs')({db,call,token,other,origin,organizationId,pass});
};

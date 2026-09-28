const {test}=require('node:test'),assert=require('node:assert/strict'),vue=require('vue');
const workspace=require('./helpers/transaction-workspace.cjs'),storage=require('./helpers/manual-draft-store.cjs'),form=require('./helpers/transaction-form.cjs');
const body={date:'2026-09-22T00:00:00.000Z',amount:67000,notes:'Synthetic draft'};
const result=(id='synthetic-transaction')=>({state:'saved',transactionId:id,transaction:{_id:id,...body}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=async()=>{await vue.nextTick();await new Promise(resolve=>setImmediate(resolve))};

test('draft commit finishes before any POST and storage failure never sends an untracked purchase',async()=>{
 const draftStore=storage(),commit=deferred(),original=draftStore.manualDraftStore.freeze;let sends=0;
 draftStore.manualDraftStore.freeze=async(...args)=>{const row=await original(...args);await commit.promise;return row};
 const p=workspace({draftStore,fetch:async()=>{sends++;return result()}});
 try{const save=p.state.createTransaction(body);await tick();assert.equal(sends,0);commit.resolve();assert.equal((await save).state,'saved');assert.equal(sends,1)}finally{p.close()}
 const failed=storage();failed.manualDraftStore.freeze=async()=>{throw Error('Quota denied')};const q=workspace({draftStore:failed,fetch:()=>{throw Error('Must not send')}});
 try{assert.equal(await q.state.createTransaction(body),null);assert.equal(q.state.saveError.value,'draftRecovery.storageError');assert.equal(q.state.saveOutcomeUnknown.value,false)}finally{q.close()}
});

test('lost response and a remounted client reuse the stored original draft key and body',async()=>{
 const draftStore=storage(),calls=[];const first=workspace({draftStore,fetch:async(url,o)=>{calls.push([url,o]);throw Error('Lost response')}});let key;
 try{await first.state.createTransaction(body);key=first.state.draftRecord.value.key;assert.equal(first.state.saveOutcomeUnknown.value,true)}finally{first.close()}
 const next=workspace({draftStore,fetch:async(url,o)=>{calls.push([url,o]);return result()}});
 try{await next.state.loadDraft(key);await next.state.createTransaction(body);assert.equal(calls.length,2);assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);assert.deepEqual(calls[0][1].body,calls[1][1].body);assert.equal(next.state.transactions.value.length,1)}finally{next.close()}
});

test('two clients resume one draft while deliberate equal purchases get separate identities',async()=>{
 const draftStore=storage(),keys=[],fetch=async(url,o)=>{keys.push(o.headers['Idempotency-Key']);return result()};
 const a=workspace({draftStore,fetch}),b=workspace({draftStore,fetch});
 try{const draft=await a.state.startDraft();await b.state.loadDraft(draft.key);await Promise.all([a.state.createTransaction(body),b.state.createTransaction(body)]);assert.equal(new Set(keys).size,1);await a.state.startDraft();await a.state.createTransaction(body);assert.equal(new Set(keys).size,2)}finally{a.close();b.close()}
});

test('changed unresolved draft details cannot overwrite the frozen body or rotate its key',async()=>{
 const p=workspace({fetch:async()=>{throw Error('Lost response')}});
 try{await p.state.createTransaction(body);const key=p.state.draftRecord.value.key;assert.equal(await p.state.createTransaction({...body,amount:1}),null);assert.equal(p.state.saveError.value,'draftRecovery.changed');assert.equal(p.state.draftRecord.value.key,key);assert.deepEqual(JSON.parse(JSON.stringify(p.state.draftRecord.value.payload)),body)}finally{p.close()}
});

test('a definite validation rejection permits correction with the same key and retains original attempt details',async()=>{
 const keys=[];let reject=true;const p=workspace({fetch:async(url,o)=>{keys.push(o.headers['Idempotency-Key']);if(reject)throw Object.assign(Error('Invalid purchase'),{statusCode:400});return result()}});
 try{await p.state.createTransaction({...body,date:'bad'});assert.equal(p.state.draftRecord.value.state,'rejected');assert.equal(p.state.saveOutcomeUnknown.value,false);reject=false;await p.state.createTransaction(body);assert.equal(keys[0],keys[1]);assert.equal(p.state.draftRecord.value.previousPayloads[0].date,'bad');assert.equal(p.state.draftRecord.value.revision,2)}finally{p.close()}
});

test('stale rejections cannot downgrade a newer attempt or a confirmed terminal draft',async()=>{
 const s=storage(),store=s.manualDraftStore,row=await store.create('owner');const first=await store.freeze('owner',row.key,body);
 await store.settle('owner',row.key,first.revision,'rejected');const second=await store.freeze('owner',row.key,{...body,amount:1});
 assert.equal((await store.settle('owner',row.key,first.revision,'rejected')).state,'pending');
 await store.settle('owner',row.key,second.revision,'saved','transaction');assert.equal((await store.settle('owner',row.key,second.revision,'rejected')).state,'saved');
 await store.settle('owner',row.key,second.revision,'deleted','transaction');assert.equal((await store.settle('owner',row.key,second.revision,'saved','transaction')).state,'deleted');
});

test('company switch before storage completes sends nothing and late results only settle the original owner',async()=>{
 const draftStore=storage(),gate=deferred(),freeze=draftStore.manualDraftStore.freeze;let sends=0;
 draftStore.manualDraftStore.freeze=async(...args)=>{const row=await freeze(...args);await gate.promise;return row};
 const p=workspace({draftStore,fetch:async()=>{sends++;return result()}});
 try{const work=p.state.createTransaction(body);await tick();p.user.currentOrganization={id:'company-b',role:'member'};gate.resolve();assert.equal(await work,null);assert.equal(sends,0);assert.equal(p.state.draftRecord.value,null)}finally{p.close()}
 const late=deferred(),q=workspace({fetch:()=>late.promise});try{const work=q.state.createTransaction(body);await tick();const old=q.state.draftRecord.value.id;q.user.currentOrganization={id:'company-b',role:'member'};late.resolve(result());assert.equal(await work,null);assert.equal(q.draftStore.manualDraftStore.rows.get(old).state,'saved');assert.deepEqual(q.state.transactions.value,[]);assert.equal(q.state.draftRecord.value,null)}finally{q.close()}
});

test('confirmed saves remain confirmed if the local outcome write fails and reconciliation repairs it',async()=>{
 const s=storage(),settle=s.manualDraftStore.settle;s.manualDraftStore.settle=async()=>{throw Error('Storage unavailable')};
 const p=workspace({draftStore:s,fetch:async()=>result()});
 try{assert.equal((await p.state.createTransaction(body)).state,'saved');await tick();assert.equal(p.state.draftError.value,'draftRecovery.confirmedStorageError');assert.equal(p.state.pendingDrafts.value.length,1);s.manualDraftStore.settle=settle;await p.state.recoverDraft(p.state.draftRecord.value.key);await tick();assert.equal(p.state.pendingDrafts.value.length,0);assert.equal(p.state.draftError.value,'')}finally{p.close()}
});

test('saved and deleted reconciliation never POSTs and a late saved response cannot undo known deletion',async()=>{
 const s=storage(),p=workspace({draftStore:s,fetch:async()=>{throw Error('Lost response')}});await p.state.createTransaction(body);const draft=p.state.draftRecord.value;p.close();
 let posts=0;const q=workspace({draftStore:s,fetch:async(url,o)=>{if(o.method)posts++;return {state:'deleted',transactionId:'transaction'}}});
 try{assert.equal((await q.state.recoverDraft(draft.key)).state,'deleted');assert.equal(posts,0);assert.deepEqual(q.state.transactions.value,[]);await q.state.loadDraft(draft.key);assert.equal((await q.state.createTransaction(body)).state,'deleted');assert.equal(posts,0)}finally{q.close()}
 const late=workspace({draftStore:s,fetch:async()=>result('transaction')});try{await late.state.loadDraft(draft.key);assert.equal((await late.state.createTransaction(body)).state,'deleted');assert.equal(late.state.transactions.value.length,0)}finally{late.close()}
});

test('draft listing is partitioned by user and company and an absent lookup retains the original intent',async()=>{
 const s=storage(),p=workspace({draftStore:s,fetch:async(url,o)=>{if(o.method)throw Error('Uncertain');return {state:'absent'}}});
 try{await p.state.createTransaction(body);const key=p.state.draftRecord.value.key;await p.state.refreshDrafts();assert.equal(p.state.pendingDrafts.value.length,1);assert.equal((await p.state.recoverDraft(key)).state,'absent');assert.equal(p.state.draftRecord.value.key,key);assert.equal(p.state.draftRecord.value.state,'pending');p.user.user.id='other-user';await p.state.refreshDrafts();assert.deepEqual(p.state.pendingDrafts.value,[]);assert.equal(await p.state.loadDraft(key),null)}finally{p.close()}
});

test('frozen form resubmits exact original fields while fresh rejected forms remain editable',async()=>{
 const original={...body,date:'2026-09-22T13:14:15Z',extraOriginalField:'test-only'},sent=[];
 const p=await form(original,{isEditing:false,frozen:true,save:async data=>{sent.push(data);return true}});
 try{p.state.form.value.amount='1';await p.state.submitForm();assert.deepEqual(sent,[original]);assert.match(p.html,/fieldset disabled/);assert.match(p.html,/draftRecovery.retry/)}finally{p.close()}
});

test('page opens a durable draft route and resumes it after remount without creating another identity',async()=>{
 const draftStore=storage(),fetch=async(url,o)=>o.method?result():{transactions:[]};const p=workspace({page:true,draftStore,fetch});let key;
 try{await p.mount();await p.state.openCreateDraft();key=p.state.draftRecord.value.key;assert.equal(p.route.query.draft,key);assert.equal(p.state.showCreateModal.value,true)}finally{p.close()}
 const q=workspace({page:true,draftStore,fetch,route:vue.reactive({params:{},query:{draft:key}})});try{await q.mount();assert.equal(q.state.draftRecord.value.key,key);assert.equal(draftStore.manualDraftStore.rows.size,1);assert.equal(q.state.showCreateModal.value,true)}finally{q.close()}
});

test('recovery restores the full company list after superseding a read and retains confirmed rows if refresh fails',async()=>{
 const s=storage(),draft=await s.manualDraftStore.create(s.draftOwner('user-a','company-a'));await s.manualDraftStore.freeze(draft.owner,draft.key,body);
 const pending=deferred();let reads=0;const current=[result().transaction,{...body,_id:'another-purchase'}];
 const p=workspace({draftStore:s,fetch:async url=>url.includes('/creation/')?result():++reads===1?pending.promise:{transactions:current}});
 try{const old=p.state.fetchTransactions();await tick();assert.equal((await p.state.recoverDraft(draft.key)).state,'saved');assert.equal(p.state.transactions.value.length,2);pending.resolve({transactions:[]});assert.equal(await old,false);assert.equal(p.state.transactions.value.length,2)}finally{pending.resolve({transactions:[]});p.close()}
 const failed=workspace({draftStore:s,fetch:async url=>{if(url.includes('/creation/'))return result();throw Error('List unavailable')}});
 try{failed.state.transactions.value=[{...body,id:'another-purchase'}];assert.equal((await failed.state.recoverDraft(draft.key)).state,'saved');assert.equal(failed.state.transactions.value.length,2);assert.equal(failed.state.error.value,'List unavailable');assert.equal(failed.state.saveError.value,null)}finally{failed.close()}
 const refresh=deferred(),changed=workspace({draftStore:s,fetch:async url=>url.includes('/creation/')?result():refresh.promise});
 try{const recovery=changed.state.recoverDraft(draft.key);await tick();changed.user.currentOrganization={id:'company-b',role:'member'};refresh.resolve({transactions:current});assert.equal(await recovery,null);assert.deepEqual(changed.state.transactions.value,[])}finally{changed.close()}
});

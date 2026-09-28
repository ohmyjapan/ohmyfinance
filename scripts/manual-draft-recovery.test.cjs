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
 try{assert.equal(await q.state.createTransaction(body),null);assert.equal(q.state.saveError.value,'draftRecovery.storageBeforeSend');assert.equal(q.state.saveOutcomeUnknown.value,false)}finally{q.close()}
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

test('recovery absence or lookup failure preserves a running company list and its totals',async()=>{
 for(const fails of [false,true]){
  const s=storage(),draft=await s.manualDraftStore.create(s.draftOwner('user-a','company-a'));await s.manualDraftStore.freeze(draft.owner,draft.key,body);
  const list=deferred(),rows=[{...body,_id:'one',type:'支出'},{...body,_id:'two',type:'支出'}];
  const p=workspace({draftStore:s,fetch:async(url,o)=>{if(o.method)return result('three');if(url.includes('/creation/')){if(fails)throw Error('Lookup unavailable');return {state:'absent'}}return list.promise}});
  try{const reading=p.state.fetchTransactions();await tick();await p.state.recoverDraft(draft.key);list.resolve({transactions:rows});assert.equal(await reading,true);assert.equal(p.state.transactions.value.length,2);assert.equal(p.state.transactionStats.value.expense.amount,134000);await p.state.createTransaction(body);assert.equal(p.state.transactions.value.length,3)}finally{list.resolve({transactions:rows});p.close()}
 }
});

test('income and expense controls use the same lock as the frozen or busy form',async()=>{
 for(const flags of [{frozen:true},{busy:true},{}]){
  const p=await form({...body,type:'支出'},{isEditing:false,...flags});
  try{const toggles=[...p.html.matchAll(/<button\b[^>]*class="[^"]*flex-1 py-2 px-4 rounded-lg[^>]*>/g)].map(m=>m[0]);assert.equal(toggles.length,2);for(const html of toggles)assert.equal(/\sdisabled(?:[\s=>])/.test(html),!!(flags.frozen||flags.busy))}finally{p.close()}
 }
});

test('ordinary and corrected saves do not show recovery notices while unknown retries still do',async()=>{
 const p=workspace({fetch:async()=>result()});
 try{await p.state.createTransaction(body);await tick();assert.equal(p.state.draftNotice.value,'');assert.equal(p.state.pendingDrafts.value.length,0)}finally{p.close()}
 for(const statusCode of [400,503]){
  let failed=true;const q=workspace({fetch:async()=>{if(failed)throw Object.assign(Error('Synthetic failure'),{statusCode});return result()}});
  try{await q.state.createTransaction(body);failed=false;await q.state.createTransaction(body);assert.equal(q.state.draftNotice.value,statusCode===400?'':'draftRecovery.saved')}finally{q.close()}
 }
});

async function rejectedDraft(s){const row=await s.manualDraftStore.create(s.draftOwner('user-a','company-a'));const pending=await s.manualDraftStore.freeze(row.owner,row.key,body);return s.manualDraftStore.settle(row.owner,row.key,pending.revision,'rejected')}

test('discarded rejection retains its identity and stops stale tabs or remounts from sending',async()=>{
 const s=storage(),row=await rejectedDraft(s);let posts=0;const fetch=async(url,o)=>{if(o.method){posts++;return result()}return url.includes('/creation/')?{state:'absent'}:{transactions:[]}};
 const first=workspace({page:true,draftStore:s,fetch}),old=workspace({page:true,draftStore:s,fetch});
 try{await first.mount();await old.mount();await first.state.openCreateDraft(row.key);await old.state.openCreateDraft(row.key);assert.equal(old.state.draftNotice.value,'draftRecovery.rejected');await first.state.discardDraftEntry(row.key,row.revision);assert.equal(first.state.showCreateModal.value,false);assert.equal(first.route.query.draft,undefined);assert.deepEqual(first.state.pendingDrafts.value,[]);assert.equal(await old.state.handleCreateTransaction(body),false);assert.equal(old.state.showCreateModal.value,false);assert.equal(old.state.saveOutcomeUnknown.value,false);assert.equal(posts,0);assert.equal((await s.manualDraftStore.get(row.owner,row.key)).state,'discarded');assert.deepEqual((await s.manualDraftStore.get(row.owner,row.key)).payload,body)}finally{first.close();old.close()}
 const reloaded=workspace({page:true,draftStore:s,fetch,route:vue.reactive({params:{},query:{draft:row.key}})});try{await reloaded.mount();assert.equal(reloaded.state.showCreateModal.value,false);assert.equal(reloaded.state.draftNotice.value,'draftRecovery.discarded');assert.equal(posts,0)}finally{reloaded.close()}
});

test('discard checks the stored revision and cannot erase pending or confirmed attempts',async()=>{
 const s=storage(),first=await rejectedDraft(s),corrected=await s.manualDraftStore.freeze(first.owner,first.key,{...body,amount:1});
 const p=workspace({draftStore:s,fetch:()=>{throw Error('Discard must not call the API')}});
 try{assert.equal((await p.state.discardRejectedDraft(first.key,first.revision)).state,'pending');assert.equal(p.state.draftNotice.value,'draftRecovery.discardChanged');assert.equal((await p.state.discardRejectedDraft(first.key,corrected.revision)).state,'pending');await s.manualDraftStore.settle(first.owner,first.key,corrected.revision,'rejected');assert.equal((await p.state.discardRejectedDraft(first.key,first.revision)).state,'rejected');assert.equal((await s.manualDraftStore.get(first.owner,first.key)).revision,corrected.revision);await s.manualDraftStore.settle(first.owner,first.key,corrected.revision,'saved','real-row');assert.equal((await p.state.discardRejectedDraft(first.key,corrected.revision)).state,'saved');await s.manualDraftStore.settle(first.owner,first.key,corrected.revision,'deleted','real-row');assert.equal((await p.state.discardRejectedDraft(first.key,corrected.revision)).state,'deleted')}finally{p.close()}
});

test('concurrent discard is idempotent and stale rejection cannot resurrect its marker',async()=>{
 const s=storage(),row=await rejectedDraft(s),a=workspace({draftStore:s}),b=workspace({draftStore:s});
 try{const results=await Promise.all([a.state.discardRejectedDraft(row.key,row.revision),b.state.discardRejectedDraft(row.key,row.revision)]);assert(results.every(r=>r.state==='discarded'));assert.equal((await s.manualDraftStore.get(row.owner,row.key)).revision,row.revision+1);assert.equal((await s.manualDraftStore.settle(row.owner,row.key,row.revision,'rejected')).state,'discarded');assert.equal((await s.manualDraftStore.freeze(row.owner,row.key,body)).state,'discarded');assert.equal((await s.manualDraftStore.settle(row.owner,row.key,row.revision,'saved','authoritative')).state,'saved');assert.equal((await s.manualDraftStore.settle(row.owner,row.key,row.revision,'deleted','authoritative')).state,'deleted')}finally{a.close();b.close()}
});

test('discard failure preserves the rejection and company changes suppress late UI results',async()=>{
 const s=storage(),row=await rejectedDraft(s),original=s.manualDraftStore.discard;const p=workspace({draftStore:s});
 try{await p.state.loadDraft(row.key);s.manualDraftStore.discard=async()=>{throw Error('Storage aborted')};assert.equal(await p.state.discardRejectedDraft(row.key,row.revision),null);assert.equal((await s.manualDraftStore.get(row.owner,row.key)).state,'rejected');assert.equal(p.state.draftError.value,'draftRecovery.storageError');s.manualDraftStore.discard=original;p.user.currentOrganization.role='viewer';assert.equal(await p.state.discardRejectedDraft(row.key,row.revision),null);assert.equal((await s.manualDraftStore.get(row.owner,row.key)).state,'rejected');p.user.currentOrganization.role='member';const gate=deferred();s.manualDraftStore.discard=async(...args)=>{const result=await original(...args);await gate.promise;return result};const pending=p.state.discardRejectedDraft(row.key,row.revision);await tick();p.user.currentOrganization={id:'other',role:'member'};gate.resolve();assert.equal(await pending,null);assert.equal(p.state.draftRecord.value,null);assert.equal(p.state.draftNotice.value,'');assert.deepEqual(p.state.pendingDrafts.value,[])}finally{p.close()}
});

test('storage failures explain which attempt was not sent and recovery keeps the same identity',async()=>{
 const s=storage(),create=s.manualDraftStore.create,freeze=s.manualDraftStore.freeze;let sends=0;s.manualDraftStore.create=async()=>{throw Error('Storage unavailable')};
 const p=workspace({page:true,draftStore:s,fetch:async(url,o)=>{if(o.method){sends++;return result()}return {transactions:[]}}});
 try{await p.mount();await p.state.openCreateDraft();assert.equal(p.state.showCreateModal.value,false);assert.equal(p.state.draftError.value,'draftRecovery.storageNewError');assert.equal(sends,0);s.manualDraftStore.create=create;await p.state.openCreateDraft();const key=p.state.draftRecord.value.key;s.manualDraftStore.freeze=async()=>{throw Error('Storage unavailable')};assert.equal(await p.state.handleCreateTransaction(body),false);assert.equal(p.state.saveError.value,'draftRecovery.storageBeforeSend');assert.equal(p.state.draftRecord.value.key,key);assert.equal(sends,0);s.manualDraftStore.freeze=freeze;assert.equal(await p.state.handleCreateTransaction(body),true);assert.equal(p.state.draftRecord.value.key,key);assert.equal(sends,1)}finally{p.close()}
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

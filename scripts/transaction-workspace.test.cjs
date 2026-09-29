const {test}=require('node:test'),assert=require('node:assert/strict'),vue=require('vue');
const workspace=require('./helpers/transaction-workspace.cjs'),form=require('./helpers/transaction-form.cjs');
const row=(id='a',extra={})=>({_id:id,date:'2026-09-22T13:14:15.000Z',amount:67000,type:'支出',status:'completed',notes:'Original',...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{await vue.nextTick();await new Promise(r=>setImmediate(r));};

test('transaction list edits use authentication and apply confirmed server state without a refresh',async()=>{
 const calls=[],p=workspace({page:true,fetch:async(url,o)=>{calls.push([url,o]);assert.equal(o.headers.Authorization,'Synthetic A');return o.method==='PUT'?row('a',{notes:'Confirmed'}):{transactions:[row()]};}});
 try{await p.mount();p.state.openEditModal(p.state.transactions.value[0]);assert.equal(await p.state.handleEditTransaction({notes:'Changed'}),true);assert.equal(p.state.transactions.value[0].notes,'Confirmed');assert.equal(p.state.transactions.value[0].status,'completed');assert.equal(calls.length,2);assert.deepEqual(calls[1][1].body,{notes:'Changed'});}finally{p.close();}
});
test('transaction client serializes mutations and never retries an uncertain create automatically',async()=>{
 const pending=deferred();let calls=0;const p=workspace({fetch:async(url,o)=>{calls++;assert.equal(o.retry,0);return pending.promise;}});
 try{const data={amount:1};const first=p.state.createTransaction(data);assert(p.state.isSaving.value);assert.equal(await p.state.createTransaction(data),null);pending.reject(Error('Response lost'));assert.equal(await first,null);assert.equal(calls,1);assert.equal(p.state.saveOutcomeUnknown.value,true);assert.match(p.state.saveError.value,/Response lost/);assert.deepEqual(p.state.transactions.value,[]);}finally{p.close();}
});
test('company change clears records and discards late reads writes and failures',async()=>{
 const reading=deferred(),saving=deferred();const p=workspace({fetch:async(url,o)=>o.method?saving.promise:reading.promise});
 try{const read=p.state.fetchTransactions(),write=p.state.createTransaction({amount:1});p.user.sessionId='session-b';p.user.currentOrganization={id:'company-b',role:'member'};reading.resolve({transactions:[row()]});saving.resolve(row());assert.equal(await read,false);assert.equal(await write,null);assert.deepEqual(p.state.transactions.value,[]);assert.equal(p.state.saveError.value,null);assert.equal(p.state.isSaving.value,false);}finally{p.close();}
 const old=deferred(),c=workspace({fetch:()=>old.promise});try{const work=c.state.updateTransaction('a',{});c.user.sessionId='new-session';old.reject(Error('Old failure'));assert.equal(await work,false);assert.equal(c.state.saveError.value,null);}finally{c.close();}
});
test('ordinary token renewal preserves same-session results while logout and disposal invalidate them',async()=>{
 const pending=deferred(),p=workspace({fetch:()=>pending.promise});try{const read=p.state.fetchTransactions();p.user.authHeader={Authorization:'Renewed A'};pending.resolve({transactions:[row()]});assert.equal(await read,true);assert.equal(p.state.transactions.value.length,1);p.user.isAuthenticated=false;assert.deepEqual(p.state.transactions.value,[]);}finally{p.close();}
 const late=deferred(),c=workspace({fetch:()=>late.promise});const save=c.state.createTransaction({amount:1});c.close();late.resolve(row());assert.equal(await save,null);assert.deepEqual(c.state.transactions.value,[]);
});
test('a stale list cannot replace a newer confirmed edit and status uses its canonical route',async()=>{
 const pending=deferred(),calls=[];let reads=0;const p=workspace({fetch:async(url,o)=>{calls.push(url);if(o.method==='PUT')return row('a',{notes:'Saved'});if(o.method==='PATCH')return {transaction:row('a',{status:'cancelled'})};reads++;return reads===2?pending.promise:{transactions:[row('a',{notes:reads>2?'Saved':'Original'})]};}});
 try{await p.state.fetchTransactions();const stale=p.state.fetchTransactions();await p.state.updateTransaction('a',{notes:'Saved'});pending.resolve({transactions:[row()]});assert.equal(await stale,false);assert.equal(p.state.transactions.value[0].notes,'Saved');assert(await p.state.updateTransactionStatus('a','cancelled'));assert.equal(calls.at(-1),'/api/transactions/a/status');assert.equal(p.state.transactions.value[0].status,'cancelled');}finally{p.close();}
});
test('edit form sends changed metadata only and preserves zero amounts tax card source date and status',async()=>{
 const original=row('a',{amount:0,taxRate:0,paymentMethod:'クレジットカード',cardNumber:'1234',trackingNumber:'shipment',supplierId:{_id:'supplier-a'}}),submitted=[];
 const p=await form(original,{save:async data=>{submitted.push(data);return true;}});
 try{assert.equal(p.state.form.value.amount,'0');assert.equal(p.state.form.value.taxRate,'0%');assert.equal(p.state.form.value.cardNumber,'1234');p.state.form.value.notes='Reviewed';await p.state.submitForm();assert.deepEqual(submitted,[{notes:'Reviewed'}]);assert(p.emitted.some(e=>e[0]==='update:modelValue'&&e[1]===false));}finally{p.close();}
 const c=await form(original,{save:async data=>{submitted.push(data);return true;}});try{c.state.form.value.supplierId='';c.state.form.value.taxRate='10%';await c.state.submitForm();assert.deepEqual(submitted.at(-1),{taxRate:10,supplierId:null});}finally{c.close();}
});
test('modal awaits one save, retains failed inputs, and cannot close a later modal after disposal',async()=>{
 const pending=deferred();let calls=0;const p=await form(undefined,{save:async()=>{calls++;return pending.promise;}});
 p.state.form.value.amount='0';const first=p.state.submitForm();assert(p.state.isSubmitting.value);await p.state.submitForm();assert.equal(calls,1);assert.equal(p.emitted.length,0);pending.resolve(false);await first;assert.equal(p.state.form.value.amount,'0');assert.equal(p.emitted.length,0);assert.equal(p.state.isSubmitting.value,false);p.close();
 const late=deferred(),c=await form(undefined,{save:()=>late.promise});c.state.form.value.amount='1';const save=c.state.submitForm();c.close();late.resolve(true);await save;assert.equal(c.emitted.length,0);
});
test('list reload waits for a complete company session and closes old forms immediately',async()=>{
 const sessions=[],p=workspace({page:true,fetch:async()=>{const started=p.user.sessionId;sessions.push(started);await Promise.resolve();assert.equal(p.user.sessionId,started);return {transactions:[row(started)]};}});
 try{await p.mount();p.state.openEditModal(p.state.transactions.value[0]);p.user.authHeader={Authorization:'Synthetic B'};p.user.sessionId='session-b';p.user.currentOrganization={id:'company-b',role:'member'};assert.equal(p.state.showEditModal.value,false);assert.deepEqual(p.state.transactions.value,[]);await tick();assert.deepEqual(sessions,['session-a','session-b']);assert.equal(p.state.transactions.value[0].id,'session-b');}finally{p.close();}
});
test('detail route changes discard old records and its edit action saves through the shared client',async()=>{
 const pending=deferred(),p=workspace({page:'detail',fetch:async(url,o)=>{if(o.method==='PUT')return row('b',{notes:o.body.notes});return url.endsWith('/a')?pending.promise:row('b');}});
 try{await p.mount();p.route.params.id='b';await tick();pending.resolve(row('a'));await tick();assert.equal(p.state.transaction.value.id,'b');p.state.editTransaction();assert(p.state.showEditModal.value);assert(await p.state.saveTransaction({notes:'Detail saved'}));assert.equal(p.state.transaction.value.notes,'Detail saved');}finally{p.close();}
 const delayed=deferred(),c=workspace({page:'detail',fetch:async(url,o)=>o.method?delayed.promise:row(url.split('/').at(-1))});
 try{await c.mount();await tick();const old=c.state.saveTransaction({notes:'Old route save'});c.route.params.id='b';await tick();delayed.reject(Error('Old route failure'));assert.equal(await old,false);assert.equal(c.state.saveError.value,null);assert.equal(c.state.transaction.value.id,'b');}finally{c.close();}
});
test('failed reads and deletes show errors without fabricated records or false deletion',async()=>{
 let fail=false;const p=workspace({fetch:async(url,o)=>{if(fail)throw Error('Unavailable');return {transactions:[row()]};}});
 try{await p.state.fetchTransactions();fail=true;assert.equal(await p.state.deleteTransaction('a'),false);assert.equal(p.state.transactions.value.length,1);assert.match(p.state.saveError.value,/Unavailable/);assert.equal(await p.state.fetchTransactions(),false);assert.deepEqual(p.state.transactions.value,[]);assert.match(p.state.error.value,/Unavailable/);}finally{p.close();}
});
test('viewer reads remain available while forms and mutations stay unavailable',async()=>{
 let calls=0;const p=workspace({page:true,fetch:async()=>{calls++;return {transactions:[row()]};}});
 try{p.user.currentOrganization.role='viewer';await p.mount();p.state.openEditModal(p.state.transactions.value[0]);assert.equal(p.state.showEditModal.value,false);assert.equal(p.state.canEdit.value,false);assert.equal(await p.state.handleCreateTransaction({amount:1}),false);assert.equal(calls,1);}finally{p.close();}
});

test('save/list failed mutations preserve the pending list and its totals',async()=>{
 for(const status of [400,503]){
  const list=deferred();let writes=0,reads=0;const p=workspace({fetch:async(url,o)=>{if(o.method){writes++;throw Object.assign(Error('Synthetic '+status),{statusCode:status})}reads++;return list.promise}});
  try{const reading=p.state.fetchTransactions();assert.equal(await p.state.updateTransaction('a',{}),false);assert(p.state.isLoading.value);list.resolve({transactions:[row('a'),row('b')]});assert.equal(await reading,true);assert.deepEqual(p.state.transactions.value.map(r=>r.id),['a','b']);assert.equal(p.state.transactionStats.value.expense.amount,134000);assert.equal(reads,1);assert.equal(writes,1);assert.match(p.state.saveError.value,/Synthetic/);assert.equal(p.state.error.value,null)}finally{list.resolve({transactions:[]});p.close()}
 }
});

test('save/list confirmation replaces reads started before or during each mutation',async()=>{
 for(const method of ['PUT','PATCH','DELETE'])for(const during of [false,true]){
  const old=deferred(),write=deferred(),entered=deferred();let reads=0,writes=0;const fresh=[row('b'),...(method==='DELETE'?[]:[row('a',{notes:'Confirmed',status:'cancelled'})])];
  const p=workspace({fetch:async(url,o)=>{if(o.method){assert.equal(o.method,method);writes++;entered.resolve();return write.promise}return ++reads===1?old.promise:{transactions:fresh}}});
  try{let reading;if(!during)reading=p.state.fetchTransactions();const saving=method==='PUT'?p.state.updateTransaction('a',{}):method==='PATCH'?p.state.updateTransactionStatus('a','cancelled'):p.state.deleteTransaction('a');await entered.promise;if(during)reading=p.state.fetchTransactions();write.resolve(method==='PUT'?fresh[1]:method==='PATCH'?{transaction:fresh[1]}:{success:true});assert.equal(await saving,true);await tick();old.resolve({transactions:[row('a')]});assert.equal(await reading,false);assert.equal(reads,2);assert.equal(writes,1);assert.deepEqual(p.state.transactions.value.map(r=>r.id),fresh.map(r=>r._id));assert.equal(p.state.transactionStats.value.total.amount,fresh.length*67000);assert.equal(p.state.isLoading.value,false);assert.equal(p.state.error.value,null)}finally{old.resolve({transactions:[]});p.close()}
 }
});

test('save/list confirmed writes finish before replacement reads and retain success on refresh failure',async()=>{
 const old=deferred(),fresh=deferred();let reads=0,writes=0;const p=workspace({fetch:async(url,o)=>{if(o.method){writes++;return row('a',{notes:'Confirmed'})}return ++reads===1?old.promise:fresh.promise}});
 try{const reading=p.state.fetchTransactions();assert.equal(await p.state.updateTransaction('a',{}),true);assert.equal(reads,2);assert.equal(p.state.isSaving.value,false);assert.equal(p.state.isLoading.value,true);old.resolve({transactions:[row()]});assert.equal(await reading,false);assert(p.state.isLoading.value);fresh.reject(Error('Synthetic refresh failure'));await tick();assert.equal(p.state.transactions.value[0].notes,'Confirmed');assert.equal(p.state.saveError.value,null);assert.equal(p.state.saveOutcomeUnknown.value,false);assert.match(p.state.error.value,/refresh failure/);assert.equal(writes,1);assert.equal(p.state.isLoading.value,false)}finally{old.resolve({transactions:[]});fresh.resolve({transactions:[]});p.close()}
});

test('save/list stale finalizers preserve the newer read marker across successive writes',async()=>{
 const lists=Array.from({length:4},deferred);let reads=0,writes=0;const p=workspace({fetch:async(url,o)=>{if(o.method){writes++;return row('a',{notes:'Edit '+writes})}return lists[reads++].promise}});
 try{const first=p.state.fetchTransactions(),second=p.state.fetchTransactions();lists[0].resolve({transactions:[row()]});assert.equal(await first,false);assert(p.state.isLoading.value);await p.state.updateTransaction('a',{});assert.equal(reads,3);lists[1].resolve({transactions:[row()]});assert.equal(await second,false);assert(p.state.isLoading.value);await p.state.updateTransaction('a',{});assert.equal(reads,4);lists[2].resolve({transactions:[row('a',{notes:'Edit 1'})]});await tick();assert(p.state.isLoading.value);assert.equal(p.state.transactions.value[0].notes,'Edit 2');lists[3].resolve({transactions:[row('a',{notes:'Edit 2'}),row('b')]});await tick();assert.equal(p.state.isLoading.value,false);assert.equal(p.state.transactions.value.length,2);assert.equal(writes,2)}finally{for(const item of lists)item.resolve({transactions:[]});p.close()}
});

test('save/list replacement replies cannot alter a newer company session or disposed workspace',async()=>{
 for(const change of ['company','logout','dispose']){
  const lists=Array.from({length:3},deferred);let reads=0;const p=workspace({fetch:async(url,o)=>o.method?row():lists[reads++].promise});
  try{const first=p.state.fetchTransactions();await p.state.updateTransaction('a',{});assert.equal(reads,2);if(change==='company')p.user.currentOrganization={id:'company-b',role:'member'};else if(change==='logout')p.user.isAuthenticated=false;else p.close();let newer;if(change==='company')newer=p.state.fetchTransactions();lists[0].resolve({transactions:[row()]});lists[1].resolve({transactions:[row()]});await first;await tick();assert.deepEqual(p.state.transactions.value,[]);assert.equal(p.state.error.value,null);if(newer){assert(p.state.isLoading.value);lists[2].resolve({transactions:[row('company-b')]});assert.equal(await newer,true);assert.deepEqual(p.state.transactions.value.map(r=>r.id),['company-b'])}else assert.equal(p.state.isLoading.value,false)}finally{for(const item of lists)item.resolve({transactions:[]});p.close()}
 }
});

test('save/list explicit delete and import refreshes supersede replacement reads without extra writes',async()=>{
 for(const importing of [false,true]){
  const lists=Array.from({length:3},deferred);let reads=0,writes=0;const p=workspace({page:!importing,fetch:async(url,o)=>{if(o.method){writes++;return importing?{results:{imported:1}}:{success:true}}return lists[reads++].promise}});
  try{const first=p.state.fetchTransactions();const saving=importing?p.state.importTransactions([],{}):p.state.deleteTransactionConfirm('a');await tick();assert.equal(reads,3);lists[0].resolve({transactions:[row()]});assert.equal(await first,false);lists[1].resolve({transactions:[row()]});await tick();assert(p.state.isLoading.value);lists[2].resolve({transactions:[row('b')]});const result=await saving;if(importing)assert.equal(result.success,true);assert.deepEqual(p.state.transactions.value.map(r=>r.id),['b']);assert.equal(p.state.isLoading.value,false);assert.equal(writes,1)}finally{for(const item of lists)item.resolve({transactions:[]});p.close()}
 }
});

test('save/list a read completed before confirmation needs no replacement and detail saves stay local',async()=>{
 const list=deferred(),write=deferred();let reads=0;const p=workspace({fetch:async(url,o)=>o.method?write.promise:(reads++,list.promise)});
 try{const reading=p.state.fetchTransactions(),saving=p.state.updateTransaction('a',{});list.resolve({transactions:[row('a'),row('b')]});assert.equal(await reading,true);write.resolve(row('a',{notes:'Confirmed'}));assert.equal(await saving,true);assert.equal(reads,1);assert.equal(p.state.transactions.value[0].notes,'Confirmed');assert.equal(p.state.transactions.value[1].id,'b')}finally{p.close()}
 const calls=[],q=workspace({page:'detail',fetch:async(url,o)=>{calls.push(url);return row('a',{notes:o.method?'Detail confirmed':'Original'})}});
 try{await q.mount();await tick();q.state.editTransaction();assert(await q.state.saveTransaction({notes:'Detail confirmed'}));assert.equal(q.state.transaction.value.notes,'Detail confirmed');assert.deepEqual(calls,['/api/transactions/a','/api/transactions/a'])}finally{q.close()}
});

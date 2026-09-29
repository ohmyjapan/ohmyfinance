const {test}=require('node:test'),assert=require('node:assert/strict'),vue=require('vue'),load=require('./helpers/calendar-store.cjs');
const user=()=>vue.reactive({sessionId:'a',isAuthenticated:true,user:{id:'owner'},currentOrganization:{id:'company-a',role:'owner'},authHeader:{Authorization:'company-a'}});
const row={id:'a'.repeat(24),title:'Synthetic',amount:100,currency:'JPY',dueDate:'2026-09-01',status:'pending',type:'expense',revision:0};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise}};
test('calendar completion is one server operation and a rejected completion remains visible as pending',async()=>{
 const calls=[],u=user(),store=load({user:u,fetch:async(url,o)=>{calls.push([url,o]);throw Error('Synthetic completion failed')}});store.payments=[{...row}];
 try{await assert.rejects(store.markAsCompleted(row.id));assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/payments/'+row.id+'/complete');assert.equal(calls[0][1].retry,0);assert.equal(store.payments[0].status,'pending');assert.match(store.error,/Synthetic/);}finally{store.$dispose()}
});
test('calendar completion snapshots company and duplicate clicks share only the outstanding request',async()=>{
 const gate=deferred(),calls=[],u=user();const store=load({user:u,fetch:async(url,o)=>{calls.push([url,o]);if(o.method){await gate.promise;return{payment:{...row,status:'paid',revision:2}}}return[{...row,status:'paid',revision:2}]}});store.payments=[{...row}];
 try{const first=store.markAsCompleted(row.id),second=store.markAsCompleted(row.id);u.currentOrganization={id:'company-b',role:'owner'};u.authHeader={Authorization:'company-b'};gate.resolve();await Promise.all([first,second]);assert.equal(calls.filter(x=>x[1].method).length,1);assert.equal(calls[0][1].headers.Authorization,'company-a');assert.deepEqual(store.payments,[]);}finally{store.$dispose()}
});
test('late calendar list is dropped on company change and viewer cannot complete',async()=>{
 const gate=deferred(),u=user();let calls=0;const store=load({user:u,fetch:async()=>{calls++;await gate.promise;return[{...row}]}});
 try{const first=store.fetchPayments();u.currentOrganization={id:'company-b',role:'viewer'};gate.resolve();await first;assert.deepEqual(store.payments,[]);store.payments=[{...row}];assert.equal(await store.markAsCompleted(row.id),null);assert.equal(calls,1);}finally{store.$dispose()}
});
test('confirmed calendar completion cannot be overwritten by an older list',async()=>{
 const gate=deferred(),u=user();let reads=0;const store=load({user:u,fetch:async(url,o)=>{if(o.method)return{payment:{...row,status:'paid',revision:2}};if(++reads===1){await gate.promise;return[{...row}]}return[{...row,status:'paid',revision:2},{...row,id:'b'.repeat(24)}]}});
 try{const old=store.fetchPayments();store.payments=[{...row}];await store.markAsCompleted(row.id);gate.resolve();await old;await vue.nextTick();assert.equal(store.payments.find(x=>x.id===row.id).status,'paid');assert.equal(store.payments.length,2);}finally{store.$dispose()}
});

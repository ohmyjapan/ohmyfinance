const {test}=require('node:test'),assert=require('node:assert/strict'),vue=require('vue'),load=require('./helpers/calendar-store.cjs');
const user=()=>vue.reactive({sessionId:'a',isAuthenticated:true,user:{id:'owner'},currentOrganization:{id:'company-a',role:'owner'},authHeader:{Authorization:'company-a'}});
const row={id:'a'.repeat(24),title:'Synthetic',amount:100,currency:'JPY',dueDate:'2026-09-01',status:'pending',type:'expense',revision:0};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise}};

test('calendar setup dashboard returns no financial data and never reads financial models',async()=>{
 const {handler,touched}=require('./helpers/calendar-service.cjs').loadSetupDashboard(),id='a'.repeat(24);
 const result=await handler({method:'GET',context:{auth:{isAuthenticated:true,userId:id,email:'setup@example.invalid'}}});
 assert.equal(result.hasOrganization,false);assert.equal(result.organization,null);assert.deepEqual(result.recentTransactions,[]);assert.equal(result.user.id,id);
 assert.deepEqual(result.stats,{total:{count:0,amount:0},expense:{count:0,amount:0},income:{count:0,amount:0},receiptMatchRate:0,receiptsCount:0,upcomingPaymentsCount:0,recentActivityCount:0});
 assert.deepEqual(touched,['connect','User.'+id]);
 await assert.rejects(handler({method:'GET',context:{}}),e=>e.statusCode===401);
 await assert.rejects(handler({method:'GET',context:{auth:{isAuthenticated:true,userId:id,organizationId:'invalid'}}}),e=>e.statusCode===403);
 assert.deepEqual(touched,['connect','User.'+id]);
});

test('calendar deleted links render review in all three entry points including viewers',async()=>{
 for(const name of ['CalendarGrid','DayDetailModal','UpcomingPayments'])for(const readOnly of [false,true]){
  const html=await load.renderCalendar(name,{currentMonth:new Date(2026,8,1),isOpen:true,dateString:'2026-09-01',payments:[{...row,category:'Invoice',completionState:'deleted'}],readOnly});
  assert(html.includes('data-review-payment="'+row.id+'"'),name+' review');
  assert(!html.includes('data-complete-payment='),name+' must not offer completion');
 }
});
test('calendar completion is one server operation and a rejected completion remains visible as pending',async()=>{
 const calls=[],u=user(),store=load({user:u,fetch:async(url,o)=>{calls.push([url,o]);throw Error('Synthetic completion failed')}});store.payments=[{...row}];
 try{await assert.rejects(store.markAsCompleted(row.id,row.revision));assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/payments/'+row.id+'/complete');assert.equal(calls[0][1].retry,0);assert.equal(store.payments[0].status,'pending');assert.match(store.error,/Synthetic/);}finally{store.$dispose()}
});
test('calendar completion snapshots company and duplicate clicks share only the outstanding request',async()=>{
 const gate=deferred(),calls=[],u=user();const store=load({user:u,fetch:async(url,o)=>{calls.push([url,o]);if(o.method){await gate.promise;return{payment:{...row,status:'paid',revision:2}}}return[{...row,status:'paid',revision:2}]}});store.payments=[{...row}];
 try{const first=store.markAsCompleted(row.id,row.revision),second=store.markAsCompleted(row.id,row.revision);u.currentOrganization={id:'company-b',role:'owner'};u.authHeader={Authorization:'company-b'};gate.resolve();await Promise.all([first,second]);assert.equal(calls.filter(x=>x[1].method).length,1);assert.equal(calls[0][1].headers.Authorization,'company-a');assert.deepEqual(store.payments,[]);}finally{store.$dispose()}
});
test('late calendar list is dropped on company change and viewer cannot complete',async()=>{
 const gate=deferred(),u=user();let calls=0;const store=load({user:u,fetch:async()=>{calls++;await gate.promise;return[{...row}]}});
 try{const first=store.fetchPayments();u.currentOrganization={id:'company-b',role:'viewer'};gate.resolve();await first;assert.deepEqual(store.payments,[]);store.payments=[{...row}];assert.equal(await store.markAsCompleted(row.id,row.revision),null);assert.equal(calls,1);}finally{store.$dispose()}
});
test('confirmed calendar completion cannot be overwritten by an older list',async()=>{
 const gate=deferred(),u=user();let reads=0;const store=load({user:u,fetch:async(url,o)=>{if(o.method)return{payment:{...row,status:'paid',revision:2}};if(++reads===1){await gate.promise;return[{...row}]}return[{...row,status:'paid',revision:2},{...row,id:'b'.repeat(24)}]}});
 try{const old=store.fetchPayments();store.payments=[{...row}];await store.markAsCompleted(row.id,row.revision);gate.resolve();await old;await vue.nextTick();assert.equal(store.payments.find(x=>x.id===row.id).status,'paid');assert.equal(store.payments.length,2);}finally{store.$dispose()}
});

test('calendar writes carry the displayed revision instead of a refreshed cache revision',async()=>{
 const sent=[],u=user(),store=load({user:u,fetch:async(url,o)=>{if(o.method){sent.push(o.body);throw Object.assign(Error('Changed'),{statusCode:409,data:{data:{code:'PAYMENT_CHANGED'}}})}return[{...row,revision:4,amount:900}]}});store.payments=[{...row,revision:4,amount:900}];
 try{await assert.rejects(store.updatePayment(row.id,{amount:100},0));assert.equal(sent[0].revision,0);await assert.rejects(store.deletePayment(row.id,0));assert.equal(sent[1].revision,0);await assert.rejects(store.markAsCompleted(row.id,0));assert.equal(sent[2].revision,0);}finally{store.$dispose()}
});
test('calendar conflict refreshes read-only and exposes the current terminal record',async()=>{
 const calls=[],u=user(),store=load({user:u,fetch:async(url,o)=>{calls.push(o.method||'GET');if(o.method)throw Object.assign(Error('Deleted link'),{statusCode:409,data:{data:{code:'PAYMENT_LINK_DELETED'}}});return[{...row,revision:3,completionState:'deleted'}]}});store.payments=[{...row}];
 try{await assert.rejects(store.markAsCompleted(row.id,0));await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['POST','GET']);assert.equal(store.recovery.state,'ready');assert.equal(store.recovery.code,'PAYMENT_LINK_DELETED');assert.equal(store.payments[0].completionState,'deleted');assert.equal(store.error,'Deleted link');}finally{store.$dispose()}
});
test('calendar failed recovery retains the write error and retry only reads',async()=>{
 const calls=[],u=user();let readFails=true;const store=load({user:u,fetch:async(url,o)=>{calls.push(o.method||'GET');if(o.method)throw Object.assign(Error('Changed'),{statusCode:409});if(readFails)throw Error('Read offline');return[]}});store.payments=[{...row}];
 try{await assert.rejects(store.deletePayment(row.id,0));await new Promise(r=>setImmediate(r));assert.equal(store.recovery.state,'failed');assert.equal(store.error,'Changed');assert.equal(store.payments.length,1);readFails=false;await store.refreshRecovery();assert.equal(store.recovery.state,'ready');assert.equal(store.payments.length,0);assert.deepEqual(calls,['DELETE','GET','GET']);}finally{store.$dispose()}
});
test('calendar late recovery cannot refill another company or replace its newer failure',async()=>{
 const gate=deferred(),u=user();let reading;const started=new Promise(r=>reading=r);const store=load({user:u,fetch:async(url,o)=>{if(o.method)throw Object.assign(Error('Changed'),{statusCode:409});reading();await gate.promise;return[{...row,revision:5}]}});store.payments=[{...row}];
 try{await assert.rejects(store.updatePayment(row.id,{amount:0},0));assert(store.recovery,'conflict must offer recovery');await started;u.currentOrganization={id:'company-b',role:'owner'};u.authHeader={Authorization:'company-b'};store.error='New company error';gate.resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(store.payments,[]);assert.equal(store.recovery,null);assert.equal(store.error,'New company error');}finally{gate.resolve();store.$dispose()}
});

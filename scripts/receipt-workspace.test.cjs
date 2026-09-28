const {test}=require('node:test'),assert=require('node:assert/strict'),vue=require('vue');
const workspace=require('./helpers/receipt-workspace.cjs');
const row=(id='receipt-a',extra={})=>({id,filename:'internal_'+id,originalFilename:id+'.pdf',mimeType:'application/pdf',size:38,uploadDate:'2026-09-22T01:00:00Z',amount:0,currency:'JPY',status:'unmatched',linkVersion:0,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('workspace page reads actual records and counts, filters zero and original names, and retains JPY in Korean',async()=>{
 const p=workspace({page:true,locale:'ko',fetch:async(url,o)=>{assert.equal(url,'/api/receipts');assert.equal(o.headers.Authorization,'Synthetic A');return {receipts:[row('a'),row('b',{status:'matched',transactionId:'t'}),row('c',{amount:null,status:'processing'})]};}});
 try{await p.mount();assert.equal(p.state.receipts.value.length,3);assert.deepEqual(p.state.receiptStats.value,{total:3,matched:1,unmatched:1,matchRate:33.3});p.state.filters.value={minAmount:0,maxAmount:0,type:'pdf'};assert.equal(p.state.filteredReceipts.value.length,2);p.state.searchQuery.value='a.pdf';assert.equal(p.state.filteredReceipts.value[0].id,'a');assert(!p.state.formatCurrency(67000,'JPY').includes('₩'));assert(p.state.formatCurrency(67000,'JPY').includes('67,000'));}finally{p.close();}
});
test('failed authenticated delete retains row and confirmation until a server success',async()=>{
 let fail=true,calls=0;const p=workspace({page:true,fetch:async(url,o)=>{assert.equal(o.headers.Authorization,'Synthetic A');if(o.method==='DELETE'){calls++;if(fail)throw Error('Delete unavailable');return {success:true};}return {receipts:[row()]};}});
 try{await p.mount();p.state.confirmDelete('receipt-a');await p.state.deleteReceipt();assert.equal(p.state.receipts.value.length,1);assert.equal(p.state.showDeleteConfirm.value,true);assert.match(p.state.error.value,/Delete unavailable/);fail=false;await p.state.deleteReceipt();assert.equal(p.state.receipts.value.length,0);assert.equal(p.state.showDeleteConfirm.value,false);assert.equal(calls,2);}finally{p.close();}
});
test('old company list and failed requests cannot refill or alter the new workspace',async()=>{
 const pending=deferred();let calls=0;const p=workspace({fetch:async()=>++calls===1?pending.promise:{receipts:[row('new')]}});
 try{const old=p.state.fetchReceipts();p.user.authHeader={Authorization:'Synthetic B'};assert.deepEqual(p.state.receipts.value,[]);await p.state.fetchReceipts();pending.resolve({receipts:[row('old')]});assert.equal(await old,false);assert.equal(p.state.receipts.value[0].id,'new');assert.equal(p.state.error.value,null);}finally{p.close();}
});
test('a newer read wins and a late pre-save read cannot resurrect a deleted receipt',async()=>{
 const first=deferred(),second=deferred();let reads=0;const p=workspace({fetch:async(url,o)=>o.method==='DELETE'?{success:true}:++reads===1?first.promise:second.promise});
 try{const a=p.state.fetchReceipts(),b=p.state.fetchReceipts();second.resolve({receipts:[row()]});await b;assert(await p.state.deleteReceipt('receipt-a'));first.resolve({receipts:[row()]});await a;assert.deepEqual(p.state.receipts.value,[]);assert.equal(p.state.isLoading.value,false);}finally{p.close();}
 const late=deferred();let count=0;const c=workspace({fetch:async(url,o)=>o.method==='DELETE'?{success:true}:++count===1?{receipts:[row()]}:late.promise});
 try{await c.state.fetchReceipts();const read=c.state.fetchReceipts();await c.state.deleteReceipt('receipt-a');late.resolve({receipts:[row()]});await read;assert.deepEqual(c.state.receipts.value,[]);}finally{c.close();}
});
test('a late save from a previous company cannot close the new confirmation or remove its records',async()=>{
 const pending=deferred();const p=workspace({page:true,fetch:async(url,o)=>o.method==='DELETE'?pending.promise:{receipts:[row(o.headers.Authorization==='Synthetic A'?'old':'new')]}});
 try{await p.mount();p.state.confirmDelete('old');const save=p.state.deleteReceipt();p.user.authHeader={Authorization:'Synthetic B'};await vue.nextTick();await new Promise(r=>setImmediate(r));p.state.confirmDelete('new');pending.resolve({success:true});await save;assert.equal(p.state.receipts.value[0].id,'new');assert.equal(p.state.receiptToDelete.value,'new');assert.equal(p.state.showDeleteConfirm.value,true);}finally{p.close();}
});
test('unmount discards a pending upload and duplicate in-flight submissions send only once',async()=>{
 const pending=deferred();let calls=0;const p=workspace({fetch:async()=>{calls++;return pending.promise;}});
 const first=p.state.uploadReceipt(new File(['x'],'x.pdf'));assert.equal(await p.state.uploadReceipt(new File(['x'],'x.pdf')),null);p.close();pending.resolve({receipt:row()});assert.equal(await first,null);assert.equal(calls,1);assert.deepEqual(p.state.receipts.value,[]);
});
test('lost matching response retries the displayed version and closes only after confirmed success',async()=>{
 let fail=true;const versions=[];const p=workspace({page:true,fetch:async(url,o)=>{if(o.method==='POST'){versions.push(o.body.linkVersion);if(fail)throw Error('Response lost');return {receipt:row('receipt-a',{status:'matched',transactionId:'t',linkVersion:1})};}return {receipts:[row()]};}});
 try{await p.mount();p.state.matchReceipt('receipt-a');await p.state.saveMatch('receipt-a','t');assert(p.state.receiptToMatch.value);assert.equal(p.state.receipts.value[0].status,'unmatched');fail=false;await p.state.saveMatch('receipt-a','t');assert.equal(p.state.receiptToMatch.value,null);assert.deepEqual(versions,[0,0]);assert.equal(p.state.receipts.value[0].transactionId,'t');}finally{p.close();}
 let version=0;const submitted=[];const c=workspace({page:true,fetch:async(url,o)=>{if(o.method==='POST'){submitted.push(o.body.linkVersion);throw Error('Conflict');}return {receipts:[row('receipt-a',{linkVersion:version})]};}});
 try{await c.mount();c.state.matchReceipt('receipt-a');version=4;await c.state.fetchReceipts();await c.state.saveMatch('receipt-a','t');assert.deepEqual(submitted,[0]);assert.equal(c.state.receiptToMatch.value.linkVersion,0);}finally{c.close();}
});
test('upload retries reuse the returned receipt and metadata updates reflect server fields only',async()=>{
 const calls=[];const p=workspace({fetch:async(url,o)=>{calls.push([url,o]);return o.method==='PATCH'?row('receipt-a',{amount:5}):{receipt:row()};}});
 try{await p.state.uploadReceipt(new File(['x'],'x.pdf'));await p.state.uploadReceipt(new File(['x'],'x.pdf'));assert.equal(p.state.receipts.value.length,1);await p.state.updateReceiptMetadata('receipt-a',{amount:7,status:'matched'});assert.equal(p.state.receipts.value[0].amount,5);assert.equal(p.state.receipts.value[0].status,'unmatched');assert(calls[0][1].body instanceof FormData);assert(calls.every(c=>c[1].headers.Authorization==='Synthetic A'));}finally{p.close();}
});
test('missing receipts and failed candidates stay missing and pagination resets after filtering',async()=>{
 const p=workspace({page:true,fetch:async(url)=>{if(url!=='/api/receipts')throw Error('not found');return {receipts:Array.from({length:22},(_,i)=>row(String(i)))};}});
 try{await p.mount();p.state.currentPage.value=3;p.state.searchQuery.value='1.pdf';assert.equal(p.state.currentPage.value,1);assert.deepEqual(p.state.paginatedReceipts.value.map(r=>r.id),['1','11','21']);}finally{p.close();}
 const c=workspace({fetch:async()=>{throw Error('not found');}});try{assert.equal(await c.state.fetchReceiptById('missing'),null);assert.equal(c.state.currentReceipt.value,null);assert.deepEqual(await c.state.findMatchCandidates('missing'),[]);assert(c.state.error.value);}finally{c.close();}
});
test('viewers can download but cannot open delete or matching actions',async()=>{
 const user=vue.reactive({authHeader:{Authorization:'Synthetic A'},currentOrganization:{role:'viewer'}}),downloads=[];
 const p=workspace({page:true,user,download:(...args)=>downloads.push(args),fetch:async()=>({receipts:[row()]})});
 try{await p.mount();assert.equal(p.state.canEdit.value,false);p.state.confirmDelete('receipt-a');p.state.matchReceipt('receipt-a');assert.equal(p.state.showDeleteConfirm.value,false);assert.equal(p.state.receiptToMatch.value,null);p.state.viewReceiptDetails(p.state.receipts.value[0]);assert.deepEqual(downloads,[['receipt-a','receipt-a.pdf']]);}finally{p.close();}
});

test('company reload waits for the whole session update before starting authenticated fetch',async()=>{
 const user=vue.reactive({authHeader:{Authorization:'Synthetic A'},sessionId:'session-a',currentOrganization:{role:'member'}}),sessions=[];
 const p=workspace({page:true,user,fetch:async()=>{const started=user.sessionId;sessions.push(started);await Promise.resolve();if(user.sessionId!==started)throw Error('Session changed');return {receipts:[row(started)]};}});
 try{await p.mount();user.authHeader={Authorization:'Synthetic B'};user.sessionId='session-b';await vue.nextTick();await new Promise(r=>setImmediate(r));assert.deepEqual(sessions,['session-a','session-b']);assert.equal(p.state.error.value,null);assert.equal(p.state.receipts.value[0].id,'session-b');}finally{p.close();}
});

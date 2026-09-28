const test=require('node:test'),assert=require('node:assert/strict'),vue=require('vue');
const makeStore=require('./helpers/shipment-store.cjs'),page=require('./helpers/shipment-page.cjs');
const account=()=>vue.reactive({sessionId:'one',user:{id:'user-a'},currentOrganization:{id:'company-a',role:'member'},authHeader:{Authorization:'Bearer a'}});
const row=(id='shipment-a')=>({id,status:'pending',createdAt:'2026-09-22T00:00:00Z',events:[],transactionIds:[],transactions:[]});
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
test('shipment list page loads stored records instead of fabricated shipments',async()=>{
 const user=account(),store=makeStore({user,authHeader:user.authHeader,fetch:async url=>url.includes('stats=')?{stats:{total:1}}:{shipments:[row()],total:1}}),p=page({store,user});
 try{await p.mount();await settle();assert.deepEqual(p.state.shipments.value.map(x=>x.id),['shipment-a']);}finally{p.close();}
});
test('shipment list clears a previous company and discards a late response',async()=>{
 const user=account();let release;
 const store=makeStore({user,fetch:async(url,options)=>url.includes('stats=')?{stats:{total:1}}:options.headers.Authorization==='Bearer a'?new Promise(r=>release=r):{shipments:[row('shipment-b')],total:1}}),p=page({store,user});
 try{await p.mount();user.authHeader={Authorization:'Bearer b'};user.currentOrganization={id:'company-b',role:'member'};assert.equal(store.shipments.length,0);await settle();release({shipments:[row('shipment-a')],total:1});await settle();assert.deepEqual(store.shipments.map(x=>x.id),['shipment-b']);assert.equal(store.isLoading,false);}finally{p.close();}
});
test('shipment detail follows route changes and excludes an older result or error',async()=>{
 const user=account();let resolveOld,rejectOld;
 const store=makeStore({user,fetch:async url=>url.endsWith('/synthetic')?new Promise((r,j)=>{resolveOld=r;rejectOld=j;}):row('second')}),p=page({detail:true,store,user});
 try{await p.mount();p.route.params.id='second';await settle();resolveOld(row('synthetic'));await settle();assert.equal(p.state.shipment.value.id,'second');p.route.params.id='synthetic';await settle();p.route.params.id='second';await settle();rejectOld(Error('Old error'));await settle();assert.equal(store.error,null);assert.equal(store.currentShipment.id,'second');}finally{p.close();}
});
test('shipment load failures stay visible with no fabricated fallback and retry succeeds',async()=>{
 const user=account();let failed=true;
 const store=makeStore({user,fetch:async url=>{if(failed)throw {data:{statusMessage:'Unavailable'}};return url.includes('stats=')?{stats:{total:1}}:{shipments:[row()],total:1};}}),p=page({store,user});
 try{await p.mount();await settle();assert.equal(p.state.error.value,'Unavailable');assert.deepEqual(store.shipments,[]);failed=false;await p.state.load();assert.equal(store.error,null);assert.equal(store.shipments.length,1);}finally{p.close();}
});
test('shipment detail displays persisted address dimensions and unknown values honestly',async()=>{
 const user=account(),saved={...row(),shippingAddress:{name:'Stored recipient',country:'JP'},weight:{value:0,unit:'kg'},dimensions:{length:10,width:20,height:30,unit:'cm'}};
 const store=makeStore({user,fetch:async()=>saved}),p=page({detail:true,store,user});
 try{await p.mount();await settle();assert.equal(p.state.address.value.name,'Stored recipient');assert.equal(p.state.weightText.value,'0 kg');assert.equal(p.state.dimensionsText.value,'10 × 20 × 30 cm');assert.equal(p.state.getETAText(saved),'');store.currentShipment=row();assert.equal(p.state.address.value,undefined);assert.equal(p.state.weightText.value,'未登録');assert.equal(p.state.dimensionsText.value,'未登録');assert.equal(p.state.formatDate('invalid'),'未登録');}finally{p.close();}
});
test('shipment page confirms a stored tracking result and retries the same uncertain request',async()=>{
 const user=account(),calls=[];let fail=true,release;
 const store=makeStore({user,fetch:async(url,options={})=>{if(url.endsWith('/tracking')){calls.push(JSON.parse(JSON.stringify(options.body)));if(fail)throw Error('Lost response');return new Promise(r=>release=r);}if(url.includes('stats='))return {stats:{total:1}};return row('synthetic');}}),p=page({detail:true,store,user});
 try{await p.mount();await settle();p.state.openStatus();p.state.newStatus.value='shipped';p.state.statusNotes.value='Manual scan';await p.state.updateShipmentStatus();assert.equal(p.state.shipment.value.status,'pending');assert.equal(p.state.updateStatus.value,true);assert.equal(p.state.actionMessage.value,'');assert.equal(calls[0].title,'\u767a\u9001\u6e08\u307f');assert.match(calls[0].requestId,/^[0-9a-f]{32}$/);fail=false;const pending=p.state.updateShipmentStatus();await settle();assert.equal(p.state.saving.value,true);await p.state.updateShipmentStatus();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);release({...row('synthetic'),status:'shipped',events:[{title:'Server event',timestamp:'2026-09-22'}]});await pending;assert.equal(p.state.shipment.value.events[0].title,'Server event');assert.equal(p.state.updateStatus.value,false);assert.equal(p.state.pendingEvent.value,null);assert(p.state.actionMessage.value);assert.deepEqual(p.alerts,[]);}finally{p.close();}
});
test('shipment viewer controls prevent writes while server denial remains visible to stale members',async()=>{
 const user=account();let writes=0;
 const store=makeStore({user,fetch:async(url,options={})=>{if(options.method){writes++;throw {data:{statusMessage:'Membership changed'}};}return row('synthetic');}}),p=page({detail:true,store,user});
 try{await p.mount();await settle();user.currentOrganization.role='viewer';p.state.openStatus();await p.state.updateShipmentStatus();assert.equal(p.state.canEdit.value,false);assert.equal(writes,0);assert.equal(p.state.updateStatus.value,false);user.currentOrganization.role='member';p.state.openStatus();await p.state.updateShipmentStatus();assert.equal(writes,1);assert.equal(p.state.error.value,'Membership changed');assert.equal(p.state.actionMessage.value,'');assert.equal(p.state.shipment.value.status,'pending');}finally{p.close();}
});
test('shipment write completing after company switch cannot restore records modal or success',async()=>{
 const user=account();let release;
 const store=makeStore({user,fetch:async(url,options={})=>{if(options.method)return new Promise(r=>release=r);return row(user.currentOrganization.id);}}),p=page({detail:true,store,user});
 try{await p.mount();await settle();p.state.openStatus();const pending=p.state.updateShipmentStatus();await settle();user.currentOrganization={id:'company-b',role:'member'};await settle();release({...row('synthetic'),status:'shipped'});await pending;assert.equal(store.currentShipment.id,'company-b');assert.equal(p.state.updateStatus.value,false);assert.equal(p.state.actionMessage.value,'');assert.equal(p.state.saving.value,false);}finally{p.close();}
});
test('shipment state clears on unmount and a late request cannot refill it',async()=>{
 const user=account();let release;const store=makeStore({user,fetch:async()=>new Promise(r=>release=r)}),p=page({detail:true,store,user});
 await p.mount();p.close();release(row('synthetic'));await settle();assert.equal(store.currentShipment,null);assert.equal(store.isLoading,false);
});
test('shipment mutation remains successful when statistics cannot load',async()=>{
 const user=account(),store=makeStore({user,fetch:async(url)=>{if(url.includes('stats='))throw Error('Statistics offline');return {shipment:{...row(),status:'shipped'}};}});
 const result=await store.updateShipmentStatus('shipment-a','shipped');assert.equal(result.status,'shipped');assert.equal(store.error,null);
});

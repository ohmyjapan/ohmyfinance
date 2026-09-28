const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),mongoose=require('mongoose'),h3=require('h3');
const {MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
 const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,module={exports:{}};
 new Function('require','module','exports',source)(name=>{assert(Object.hasOwn(imports,name),'Unexpected dependency: '+name);return imports[name];},module,module.exports);return module.exports;
}
const id=()=>new mongoose.Types.ObjectId(),a=id(),b=id(),owner=id(),peer=id();
const access={organizationId:String(a),userId:String(owner),role:'owner'},member={...access,userId:String(peer),role:'member'},foreign={...access,organizationId:String(b)};
const record={date:new Date('2026-09-22'),amount:67000,type:'支出',status:'completed',notes:'Reviewed accounting',cardAccounting:{preserve:true},timeline:[]};
const status=code=>error=>error.statusCode===code;
let mongo,Shipment,Transaction,service;
before(async()=>{
 const binary=path.join(root,'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
 mongo=await MongoMemoryServer.create({binary:fs.existsSync(binary)?{systemBinary:binary,version:'8.2.1'}:undefined});await mongoose.connect(mongo.getUri('shipment_groups'));
 const shipment=load('server/models/Shipment.ts',{mongoose}),transaction=load('server/models/Transaction.ts',{mongoose});Shipment=shipment.default;Transaction=transaction.default;
 service=load('server/services/shipmentService.ts',{mongoose,h3,'../models/Shipment':shipment,'../models/Transaction':transaction,'../config/database':{ensureConnection:async()=>assert.equal(mongoose.connection.name,'shipment_groups')}});
 await Promise.all([Shipment.init(),Transaction.init()]);
});
after(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{await Promise.all([Shipment.deleteMany({}),Transaction.deleteMany({})]);});
const create=(ctx=access,extra={})=>service.createShipment(ctx,{trackingNumber:'SYNTHETIC',carrier:'Synthetic carrier',shippingAddress:{name:'Synthetic recipient',country:'JP'},...extra});
const seed=async()=>{
 const [own,other,legacy]=await Transaction.create([{...record,organizationId:a},{...record,organizationId:b},record]);return{own,other,legacy};
};
const ledger=()=>Transaction.find().sort({_id:1}).lean();

test('shipment lists and aggregates exclude foreign records and populated foreign purchases',async()=>{
 const {own,other,legacy}=await seed();const before=await ledger();
 const s=await Shipment.create({organizationId:a,trackingNumber:'OWN',transactionIds:[own._id,other._id,legacy._id]});await Shipment.create({organizationId:b,trackingNumber:'FOREIGN',transactionIds:[other._id]});
 await Shipment.collection.insertOne({trackingNumber:'UNASSIGNED',status:'pending',transactionIds:[own._id]});
 const rows=await service.getShipments(access);assert.equal(rows.length,1);assert.equal(rows[0].id,String(s._id));
 assert.deepEqual(rows[0].transactionIds,[String(own._id)]);assert.deepEqual(rows[0].transactions.map(t=>String(t._id)),[String(own._id)]);
 assert.equal((await service.getShipmentStats(access)).total,1);assert.equal((await service.getShipmentStats(access)).pending,1);
 assert.equal((await service.getShipments(access,{transactionId:String(own._id)})).length,1);assert.deepEqual(await ledger(),before);
});

test('shipment creation assigns company and creator and stores only the canonical relationship',async()=>{
 const {own}=await seed(),before=await ledger();const result=await create(member,{organizationId:b,createdBy:owner,transactionId:String(own._id),transactionIds:[own._id,own._id],events:[{type:'forged'}],status:'shipped'});
 assert.equal(result.organizationId,String(a));assert.equal(result.createdBy,String(peer));assert.equal(result.status,'shipped');assert.deepEqual(result.transactionIds,[String(own._id)]);assert.equal(result.events.length,1);assert.equal(result.events[0].type,'created');
 const stored=await Shipment.findById(result.id);assert.equal(stored.transactionIds.length,1);assert.deepEqual(await ledger(),before);
});

test('shipment create link and replacement validate the full purchase set before writing',async()=>{
 const {own,other,legacy}=await seed(),s=await create(),before=await Shipment.findById(s.id).lean(),money=await ledger();
 for(const invalid of [other._id,legacy._id,id()]){
  for(const fn of [()=>create(access,{transactionIds:[own._id,invalid]}),()=>service.linkTransactions(access,s.id,[String(own._id),String(invalid)]),()=>service.updateShipment(access,s.id,{transactionIds:[own._id,invalid]})])await assert.rejects(fn,status(404));
 }
 await assert.rejects(service.linkTransactions(access,s.id,['invalid']),status(400));assert.equal(await Shipment.countDocuments(),1);assert.deepEqual(await Shipment.findById(s.id).lean(),before);assert.deepEqual(await ledger(),money);
});

test('one purchase can belong to multiple shipments and removing one edge preserves the others',async()=>{
 const {own}=await seed(),before=await ledger(),one=await create(),two=await create();
 await service.linkTransactions(access,one.id,[String(own._id)]);await service.linkTransactions(member,two.id,[String(own._id)]);
 assert.equal((await service.getShipments(access,{transactionId:String(own._id)})).length,2);
 await service.unlinkTransactions(access,one.id,[String(own._id)]);assert.deepEqual((await service.getShipments(access,{transactionId:String(own._id)})).map(s=>s.id),[two.id]);
 await service.deleteShipment(access,one.id);assert.deepEqual((await service.getShipmentById(member,two.id)).transactionIds,[String(own._id)]);assert.deepEqual(await ledger(),before);
});

test('shipment edits cannot reassign company creator events or write update operators',async()=>{
 const {own}=await seed(),s=await create(access,{transactionIds:[own._id]}),before=await ledger();
 const changed=await service.updateShipment(member,s.id,{organizationId:b,createdBy:peer,events:[],$set:{organizationId:b},notes:'Member correction',status:'processing',statusNotes:'Packed'});
 assert.equal(changed.organizationId,String(a));assert.equal(changed.createdBy,String(owner));assert.equal(changed.notes,'Member correction');assert.equal(changed.status,'processing');assert.equal(changed.events.length,2);assert.equal(changed.events[0].description,'Packed');
 await Shipment.updateOne({_id:s.id},{$set:{organizationId:b,createdBy:peer}});const saved=await Shipment.findById(s.id);assert.equal(String(saved.organizationId),String(a));assert.equal(String(saved.createdBy),String(owner));
 await service.updateShipment(access,s.id,{status:'processing'});assert.equal((await Shipment.findById(s.id)).events.length,2);assert.deepEqual(await ledger(),before);
});

test('shipment detail edit delete tracking link and unlink all retain company scope',async()=>{
 const {own}=await seed(),other=await create(foreign),before=await Shipment.findById(other.id).lean();
 const calls=[()=>service.getShipmentById(access,other.id),()=>service.updateShipment(access,other.id,{notes:'foreign'}),()=>service.deleteShipment(access,other.id),()=>service.addTrackingEvent(access,other.id,{requestId:'foreign',title:'Scan'}),()=>service.linkTransactions(access,other.id,[String(own._id)]),()=>service.unlinkTransactions(access,other.id,[])];
 for(const run of calls)await assert.rejects(run,status(404));assert.deepEqual(await Shipment.findById(other.id).lean(),before);
});

test('concurrent shipment links and unlinks are idempotent without losing unrelated edges',async()=>{
 const {own}=await seed(),extra=await Transaction.create({...record,organizationId:a}),s=await create(access,{transactionIds:[extra._id]}),before=await ledger();
 const untouched=await Shipment.findById(s.id).lean();await service.linkTransactions(access,s.id,[]);await service.unlinkTransactions(access,s.id,[]);assert.deepEqual(await Shipment.findById(s.id).lean(),untouched);
 await Promise.all(Array.from({length:6},()=>service.linkTransactions(access,s.id,[String(own._id)])));const linked=await Shipment.findById(s.id).lean();assert.equal(linked.transactionIds.length,2);
 await service.linkTransactions(access,s.id,[String(own._id)]);assert.deepEqual(await Shipment.findById(s.id).lean(),linked);
 await Promise.all(Array.from({length:6},()=>service.unlinkTransactions(access,s.id,[String(own._id)])));const unlinked=await Shipment.findById(s.id).lean();assert.deepEqual(unlinked.transactionIds,[extra._id]);
 await service.unlinkTransactions(access,s.id,[String(own._id)]);assert.deepEqual(await Shipment.findById(s.id).lean(),unlinked);assert.deepEqual(await ledger(),before);
});

test('shipment edge retry after durable write and reconnect does not duplicate or touch ledger',async()=>{
 const {own}=await seed(),s=await create(),before=await ledger(),original=Shipment.findOneAndUpdate;
 Shipment.findOneAndUpdate=function(...args){return{lean:async()=>{await original.apply(this,args).lean();throw Error('Synthetic lost edge response');}};};
 try{await assert.rejects(service.linkTransactions(access,s.id,[String(own._id)]),/Synthetic lost edge/);}finally{Shipment.findOneAndUpdate=original;}
 await mongoose.disconnect();await mongoose.connect(mongo.getUri('shipment_groups'));
 assert.deepEqual((await service.linkTransactions(access,s.id,[String(own._id)])).transactionIds,[String(own._id)]);assert.deepEqual(await ledger(),before);
});

test('shipment metadata update detects a competing status change before appending stale history',async()=>{
 const s=await create(),original=Shipment.findOneAndUpdate;let changed=false;
 Shipment.findOneAndUpdate=function(...args){if(args[1]?.$set?.notes==='Stale form'&&!changed)return{lean:async()=>{changed=true;await service.updateShipmentStatus(s.id,String(a),{status:'delivered'});return original.apply(this,args).lean();}};return original.apply(this,args);};
 try{await assert.rejects(service.updateShipment(access,s.id,{status:'delivered',notes:'Stale form'}),status(409));}finally{Shipment.findOneAndUpdate=original;}
 const saved=await Shipment.findById(s.id);assert.equal(saved.events.length,2);assert.equal(saved.status,'delivered');assert.notEqual(saved.notes,'Stale form');
});

test('shipment tracking request identity prevents duplicate history and stale status replay',async()=>{
 const s=await create(),before=await ledger(),event={requestId:'scan-1',type:'scan',title:'Scanned',description:'Synthetic parcel',location:'Tokyo',status:'in_transit'};
 await Promise.all(Array.from({length:6},()=>service.addTrackingEvent(access,s.id,event)));assert.equal((await Shipment.findById(s.id)).events.length,2);
 await service.updateShipmentStatus(s.id,String(a),{status:'delivered'});const saved=await Shipment.findById(s.id).lean();
 await service.addTrackingEvent(access,s.id,event);assert.deepEqual(await Shipment.findById(s.id).lean(),saved);
 await assert.rejects(service.addTrackingEvent(access,s.id,{...event,location:'Changed'}),status(409));
 await service.addTrackingEvent(access,s.id,{...event,requestId:'scan-2',status:undefined});assert.equal((await Shipment.findById(s.id)).events.length,4);
 await assert.rejects(service.addTrackingEvent(access,s.id,{title:'Missing identity'}),status(400));assert.deepEqual(await ledger(),before);
});

test('shipment cleanup can remove corrupt foreign and deleted references without changing purchases',async()=>{
 const {own,other}=await seed(),s=await create(),missing=id(),before=await ledger();await Shipment.updateOne({_id:s.id},{$set:{transactionIds:[own._id,other._id,missing]}});
 assert.deepEqual((await service.getShipmentById(access,s.id)).transactionIds,[String(own._id)]);
 await service.unlinkTransactions(access,s.id,[String(other._id),String(missing)]);assert.deepEqual((await Shipment.findById(s.id)).transactionIds,[own._id]);assert.deepEqual(await ledger(),before);
});

test('shipment store consumes the real list envelope and tolerates absent optional fields',async()=>{
 const store=require('./helpers/shipment-store.cjs')({authHeader:{Authorization:'synthetic'},fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'synthetic');return url.includes('stats=')?{stats:{total:1}}:{shipments:[{id:'s',status:'pending',createdAt:'2026-09-22',shippingAddress:{name:'Recipient',country:'JP'}}],total:1};}});
 await store.fetchShipments();assert.equal(store.shipments.length,1);assert.equal(store.stats.total,1);store.setSearchQuery('recipient');store.setFilters({country:'JP'});assert.equal(store.filteredShipments.length,1);
});

test('shipment store writes use implemented routes and the dedicated status envelope',async()=>{
 const calls=[],record={id:'s',status:'pending'},store=require('./helpers/shipment-store.cjs')({authHeader:{Authorization:'synthetic'},fetch:async(url,options={})=>{calls.push({url,options});if(url.includes('stats='))return{stats:{total:1}};if(url.endsWith('/update-status'))return{shipment:{...record,status:options.body.status}};return{...record,...options.body};}});
 await store.createShipment({trackingNumber:'Synthetic'});await store.fetchShipmentById('s');await store.updateShipment('s',{notes:'Packed'});await store.updateShipmentStatus('s','shipped','Packed');
 assert.equal(store.currentShipment.status,'shipped');assert.equal(store.shipments[0].status,'shipped');
 assert.deepEqual(calls.filter(x=>x.options.method).map(x=>[x.url,x.options.method]),[['/api/shipments','POST'],['/api/shipments/s','PATCH'],['/api/shipments/s/update-status','POST']]);
});

test('shipment store tracking retry reuses its request identity after a lost response',async()=>{
 const calls=[],store=require('./helpers/shipment-store.cjs')({authHeader:{Authorization:'synthetic'},fetch:async(url,options)=>{calls.push(structuredClone({url,options}));if(calls.length===1)throw Error('Synthetic lost tracking response');return{id:'s',events:[]};}}),event={title:'Scan'};
 const error=console.error;console.error=()=>{};
 try{assert.equal(await store.addTrackingEvent('s',event),null);assert.equal((await store.addTrackingEvent('s',event)).id,'s');}finally{console.error=error;}
 assert.match(event.requestId,/^[a-f0-9]{32}$/);assert.equal(calls[0].options.body.requestId,calls[1].options.body.requestId);assert.equal(calls[0].url,'/api/shipments/s/tracking');
});

const assert = require('node:assert/strict');
const {ObjectId} = require('mongodb');
module.exports = async ({db,call,token,other,pass}) => {
  const group=await require('./helpers/group-session.cjs')(call,token,'Synthetic candidate group');
  const foreign=await require('./helpers/group-session.cjs')(call,other,'Synthetic candidate foreign group');
  token=group.token;other=foreign.token;
  const create = async extra => {
    const response=await call('/api/receipts',{method:'POST',token,body:{filename:'synthetic-'+new ObjectId()+'.pdf',originalFilename:'synthetic.pdf',size:1,amount:67000,receiptDate:'2026-09-22',merchant:'東京書店',currency:'JPY',...extra}});
    assert.equal(response.status,200,JSON.stringify(response));return response.data;
  };
  const receipt=await create({}),route='/api/receipts/'+receipt.id+'/matches';
  const base={organizationId:new ObjectId(group.organizationId),amount:67000,date:new Date('2026-09-22'),companyInfo:'東京書店',type:'支出',status:'completed',metadata:{currency:'JPY'},hasReceipt:false,timeline:[]};
  const id=new ObjectId(),blocked=new ObjectId(),claimed=new ObjectId();
  await db.collection('transactions').insertMany([
    {...base,_id:id,referenceNumber:'SYNTHETIC-EXACT'},
    {...base,_id:blocked,hasReceipt:true}, {...base,_id:claimed},
    {...base,receiptFilePath:'/synthetic/attached.pdf'},
    {...base,metadata:{currency:'USD'}},
    ...Array.from({length:25},(_,i)=>({...base,date:new Date('2026-09-23'),companyInfo:'大阪衣料',amount:67001+i}))
  ]);
  const occupied=await create({});
  await db.collection('receipts').updateOne({_id:new ObjectId(occupied.id)},{$set:{status:'matched',transactionId:claimed}});
  const ledger=await db.collection('transactions').find({}).toArray();
  const receipts=await db.collection('receipts').find({}).toArray();
  assert.equal((await call(route)).status,401);
  assert.equal((await call(route,{token:other})).status,404);
  pass('candidate HTTP reads require login and receipt group membership');

  const response=await call(route,{token});assert.equal(response.status,200,JSON.stringify(response));
  assert.equal(response.data.matches[0].transactionId,String(id));
  assert.equal(response.data.matches[0].reference,'SYNTHETIC-EXACT');
  assert.equal(response.data.matches[0].currency,'JPY');assert.equal(response.data.matches[0].autoMatchEligible,true);
  assert.equal(response.data.highConfidenceMatches,1);assert.equal(response.data.totalMatches,10);
  assert(!response.data.matches.some(m=>[String(blocked),String(claimed)].includes(m.transactionId)));
  pass('built candidate route ranks actual merchant/currency evidence beyond the old twenty-record limit');

  const rendered=await require('./helpers/receipt-dialog.cjs')({
    receipt,authHeader:{Authorization:'Bearer '+token},
    fetch:async(url,options)=>{
      assert.equal(options.headers.Authorization,'Bearer '+token);
      const response=await call(url,{token});assert.equal(response.status,200,JSON.stringify(response));return response.data;
    }
  });
  assert(rendered.state.transactions.value.length>0,'The real API envelope must populate the receipt dialog');
  assert.equal(rendered.state.selectedTransactionId.value,String(id));
  assert.equal(rendered.emitted.length,0,'Opening the dialog must not attach a receipt');
  assert(rendered.html.includes(String(id)));
  pass('the actual receipt dialog consumes the built transaction envelope and displays its strong suggestion');

  const reads=await Promise.all(Array.from({length:5},()=>call(route,{token})));
  for(const read of reads)assert.deepEqual(read.data,response.data);
  assert.deepEqual(await db.collection('transactions').find({}).toArray(),ledger);
  assert.deepEqual(await db.collection('receipts').find({}).toArray(),receipts);
  pass('concurrent built candidate reads preserve both sides of the ledger exactly');

  await db.collection('transactions').insertOne({...base});
  const duplicate=await call(route,{token});assert.equal(duplicate.data.highConfidenceMatches,2);
  const auto=await call('/api/receipts/auto-match',{method:'POST',token,body:{}});
  assert.equal(auto.status,200,JSON.stringify(auto));assert.equal(auto.data.matched,0);assert.equal(auto.data.skipped,1);
  assert.equal((await db.collection('receipts').findOne({_id:new ObjectId(receipt.id)})).status,'unmatched');
  pass('two exact candidates remain ambiguous through the built automatic matching API');

  await db.collection('receipts').updateOne({_id:new ObjectId(receipt.id)},{$set:{merchant:null}});
  await db.collection('transactions').deleteMany({_id:{$ne:id}});
  const weakBefore=await db.collection('transactions').find({}).toArray();
  const weak=await call(route,{token});assert.equal(weak.data.highConfidenceMatches,0);assert.equal(weak.data.matches[0].confidence,70);
  const low=await call('/api/receipts/auto-match',{method:'POST',token,body:{minConfidence:50}});
  assert.equal(low.status,200);assert.equal(low.data.matched,0);
  assert.deepEqual(await db.collection('transactions').find({}).toArray(),weakBefore);
  pass('lowering the numeric threshold cannot attach a receipt supported only by price and date');
};

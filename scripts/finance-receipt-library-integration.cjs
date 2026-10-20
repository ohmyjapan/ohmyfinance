// Runs only inside the existing owned company-business fixture. No production data or financial writes.
const assert=require('node:assert/strict');
module.exports=async({root,origin,db,ObjectId,A,B,ownerToken,tokenA,tokenB,ok,call,members,pass})=>{
 const receipts=db.collection('receipts'),ids=Array.from({length:26},()=>new ObjectId());
 const seed=(i,organizationId)=>({_id:ids[i],organizationId,filename:'opaque-'+i+'.pdf',originalFilename:'LIBRARY_'+String(i).padStart(2,'0')+(i===2?'.PNG':'.pdf'),size:1234,uploadDate:new Date('2026-02-12T03:00:00Z'),receiptDate:new Date('2026-02-11T12:00:00Z'),amount:i===0?0:i===1?125.50:i===2?77:900,currency:i===1?'USD':i===2?null:'JPY',merchant:i===3?'Literal [shop].*':i===4?'=UNTRUSTED()':'Saved library shop '+i,status:['matched','unmatched','processing','error'][i%4],filePath:'PRIVATE_LIBRARY_PATH',fileUrl:'PRIVATE_LIBRARY_URL',metadata:{secret:'PRIVATE_LIBRARY_METADATA'},extractedData:{rawText:'PRIVATE_LIBRARY_RAW'}});
 await receipts.insertMany(ids.map((id,i)=>seed(i,i<24?A:B)));
 const snapshot=async()=>JSON.stringify(await Promise.all(['receipts','transactions','invoices','payments','financecompanyknowledges'].map(n=>db.collection(n).find().sort({_id:1}).toArray()))),before=await snapshot();
 const ownIds=new Set((await receipts.find({organizationId:A}).project({_id:1}).toArray()).map(r=>String(r._id)));
 try{
  let r=await call('/api/receipts/library',tokenA);assert.equal(r.status,200,'library:available '+r.raw.slice(0,180));assert.ok(r.data?.receipts,'library:response');
  assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(new Set(r.data.receipts.map(x=>x.id)),ownIds,'library:company');
  for(const row of r.data.receipts)assert.deepEqual(Object.keys(row).sort(),['id','filename','size','uploadDate','amount','currency','merchant','status'].sort(),'library:projection');
  for(const secret of ['PRIVATE_LIBRARY_','organizationId','uploadedBy','extractedData','transactionId'])assert.ok(!r.raw.includes(secret),'library:no-private-fields '+secret);
  const get=i=>r.data.receipts.find(x=>x.id===String(ids[i]));assert.equal(get(0).amount,0,'library:zero');assert.equal(get(1).amount,125.5);assert.equal(get(1).currency,'USD');assert.equal(get(2).currency,null,'library:unknown-currency');assert.equal(get(2).filename,'LIBRARY_02.PNG');
  assert.deepEqual(r.data.stats,{total:26,matched:7,unmatched:7,processing:6,error:6,matchRate:26.92},'library:counts');
  assert.deepEqual((await ok('/api/receipts/library?organizationId='+B,tokenA)),r.data,'library:no-query-company');
  const other=await ok('/api/receipts/library',tokenB);assert.equal(other.stats.total,3);assert.ok(other.receipts.every(x=>!ownIds.has(x.id)),'library:separate-company');
  pass('real receipt library returns only company display fields, literal status counts and saved zero/decimal/unknown currency; query cannot override company');
  assert.equal((await call('/api/receipts/library',null)).status,401);assert.equal((await call('/api/receipts/library',ownerToken)).status,403);
  await db.collection('organizations').updateOne({_id:A},{$set:{members:[]}});assert.equal((await call('/api/receipts/library',tokenA)).status,403,'library:revoked');await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  await db.collection('organizations').updateOne({_id:A},{$set:{isActive:false}});assert.equal((await call('/api/receipts/library',tokenA)).status,403,'library:inactive');await db.collection('organizations').updateOne({_id:A},{$set:{isActive:true}});
  for(const role of ['owner','admin','member','viewer']){await db.collection('organizations').updateOne({_id:A},{$set:{'members.0.role':role}});assert.equal((await call('/api/receipts/library',tokenA)).status,200,'library:legitimate-role')}await db.collection('organizations').updateOne({_id:A},{$set:{members}});
  const parallel=await Promise.all(Array.from({length:8},(_,i)=>call('/api/receipts/library',i%2?tokenA:tokenB)));for(let i=0;i<parallel.length;i++){assert.equal(parallel[i].status,200);assert.ok(parallel[i].data.receipts.every(x=>ownIds.has(x.id)===(i%2===1)),'library:parallel-company')}
  assert.equal(await snapshot(),before,'library:no-domain-writes');
  pass('library reuses fresh membership for every role, revocation/inactive/no-company and parallel selected-company reads without domain writes');
  if(process.env.OMF_RECEIPT_LIBRARY_BROWSER==='1')await require('./finance-receipt-library-browser.cjs')({root,origin,db,A,B,ids,pause:ms=>new Promise(r=>setTimeout(r,ms)),pass});
  assert.equal(await snapshot(),before,'library:browser-no-domain-writes');
 }finally{
  await db.collection('organizations').updateOne({_id:A},{$set:{members,isActive:true}});
  await receipts.deleteMany({_id:{$in:ids}});
 }
};

// Count-only, read-only receipt link audit for an explicit window (receipts by updatedAt, receipt-link journal entries by claimedAt).
// Usage: OMF_AUDIT_MONGO_URI=<uri> [OMF_AUDIT_DB=<name>] node scripts/finance-receipt-link-audit.cjs --from <ISO> --to <ISO>
// Reads only ids, company ids, statuses, revisions/states, timestamps and file-presence booleans. Prints bucket counts only: no
// identifier, name, amount, description, file path/content or credential. Every collection handle refuses any write method.
// It recomputes the same badge rule as the server (a matched receipt of the transaction's company, or a direct receipt file).
const {MongoClient}=require('mongodb');
const READS=new Set(['find','aggregate','countDocuments','estimatedDocumentCount','distinct','findOne']);
const readOnly=collection=>new Proxy(collection,{get(target,key){if(typeof key==='string'&&typeof target[key]==='function'&&!READS.has(key))return()=>{throw Error('Audit is read-only: '+key+' refused')};return typeof target[key]==='function'?target[key].bind(target):target[key]}});
function args(argv){const out={};for(let i=0;i<argv.length;i+=2)out[argv[i].replace(/^--/,'')]=argv[i+1];return out}
async function audit(db,{from,to,now=new Date()}){
 const receipts=readOnly(db.collection('receipts')),transactions=readOnly(db.collection('transactions')),chats=readOnly(db.collection('financecompanyassistants'));
 const window={$gte:from,$lt:to},rows=await receipts.find({updatedAt:window},{projection:{organizationId:1,status:1,transactionId:1,'linkSync.pending':1,'linkSync.state':1,'linkSync.reason':1,'linkSync.claimUntil':1,'linkSync.work.transactionId':1,'naviOperations.operationId':1,'naviOperations.payloadHash':1}}).toArray();
 const r={total:rows.length,matched:0,unmatched:0,otherStatus:0,matchedWithoutTransaction:0,unmatchedWithTransaction:0,linkSameCompany:0,linkOtherCompany:0,linkTargetMissing:0,noCompany:0};
 const sync={synced:0,pending:0,manualReview:0,manualReviewTransactionMissing:0,manualReviewRetriesExhausted:0,untracked:0,staleClaims:0};
 const touched=new Map();
 for(const x of rows){
  if(!x.organizationId)r.noCompany++;
  if(x.status==='matched')r.matched++;else if(x.status==='unmatched')r.unmatched++;else r.otherStatus++;
  if(x.status==='matched'&&!x.transactionId)r.matchedWithoutTransaction++;if(x.status!=='matched'&&x.transactionId)r.unmatchedWithTransaction++;
  const s=x.linkSync;if(!s)sync.untracked++;else if(s.state==='manual_review'){sync.manualReview++;if(s.reason==='transaction_missing')sync.manualReviewTransactionMissing++;if(s.reason==='retries_exhausted')sync.manualReviewRetriesExhausted++}else if(s.pending)sync.pending++;else sync.synced++;
  if(s?.pending&&s.claimUntil&&new Date(s.claimUntil)<now)sync.staleClaims++;
  if(x.transactionId)touched.set(String(x.transactionId),x.transactionId);
  for(const work of s?.work||[])if(work.transactionId)touched.set(String(work.transactionId),work.transactionId);
 }
 const t={checked:0,flagAgree:0,flagDisagree:0,storedTrueExpectedFalse:0,storedFalseExpectedTrue:0,storedReceiptObject:0,directFile:0,projectionBehind:0};
 const ids=[...touched.values()],targets=new Map();
 for(let i=0;i<ids.length;i+=500){
  const batch=await transactions.find({_id:{$in:ids.slice(i,i+500)}},{projection:{organizationId:1,hasReceipt:1,receiptFilePath:1,receipt:1,'receiptSync.rev':1,'receiptSync.applied':1}}).toArray();
  for(const tr of batch){
   targets.set(String(tr._id),tr);
   t.checked++;const file=!!tr.receiptFilePath;if(file)t.directFile++;if(tr.receipt!==undefined&&tr.receipt!==null)t.storedReceiptObject++;
   const expected=file||await receipts.countDocuments({organizationId:tr.organizationId,transactionId:tr._id,status:'matched'},{limit:1})>0;
   if(!!tr.hasReceipt===expected)t.flagAgree++;else{t.flagDisagree++;if(tr.hasReceipt)t.storedTrueExpectedFalse++;else t.storedFalseExpectedTrue++}
   if(tr.receiptSync&&tr.receiptSync.applied!==tr.receiptSync.rev)t.projectionBehind++;
  }
 }
 // Link agreement counts receipts individually; badge agreement counts each touched transaction once.
 for(const x of rows)if(x.status==='matched'&&x.transactionId){const tr=targets.get(String(x.transactionId));if(!tr)r.linkTargetMissing++;else if(String(tr.organizationId)===String(x.organizationId))r.linkSameCompany++;else r.linkOtherCompany++}
 // Receipt-link journal metadata only (names, states, timestamps, operation ids/hashes), compared with receipt markers.
 const names=['link_company_receipt','unlink_company_receipt'],j={entries:0,claimed:0,done:0,failed:0,unresolved:0,unresolvedSystem:0,staleClaims:0,duplicateOperationIds:0,doneWithoutMarker:0,doneWithPendingReceipt:0,unresolvedProvable:0,unavailable:[]};
 const ops=await chats.aggregate([{$unwind:'$turns'},{$unwind:'$turns.actions'},{$match:{'turns.actions.name':{$in:names},'turns.actions.claimedAt':window}},{$project:{_id:0,organizationId:1,operationId:'$turns.actions.operationId',payloadHash:'$turns.actions.payloadHash',state:'$turns.actions.state',recoveryOwner:'$turns.actions.recoveryOwner',leaseUntil:'$turns.actions.leaseUntil',resourceId:'$turns.actions.resourceId'}}]).toArray();
 const seen=new Map();for(const o of ops){j.entries++;j[o.state]=(j[o.state]||0)+1;if(o.state==='unresolved'&&o.recoveryOwner==='system')j.unresolvedSystem++;if(o.state==='claimed'&&o.leaseUntil&&new Date(o.leaseUntil).getTime()<now.getTime()-20000)j.staleClaims++;seen.set(o.operationId,(seen.get(o.operationId)||0)+1)}
 j.duplicateOperationIds=[...seen.values()].filter(n=>n>1).length;
 for(const o of ops)if(o.state==='done'||o.state==='unresolved'){
  let row=null;try{row=await receipts.findOne({_id:new (require('mongodb').ObjectId)(String(o.resourceId)),organizationId:o.organizationId},{projection:{'naviOperations.operationId':1,'naviOperations.payloadHash':1,'linkSync.pending':1}})}catch{}
  const marked=!!row&&(row.naviOperations||[]).some(m=>m.operationId===o.operationId&&m.payloadHash===o.payloadHash);
  if(o.state==='done'&&!marked)j.doneWithoutMarker++;if(o.state==='done'&&marked&&row.linkSync?.pending)j.doneWithPendingReceipt++;if(o.state==='unresolved'&&marked&&!row.linkSync?.pending)j.unresolvedProvable++;
 }
 if(!ops.length)j.unavailable.push('no receipt-link journal entries in the window: zero exposure, not evidence');
 return{window:{from:from.toISOString(),to:to.toISOString()},readOnly:true,receipts:r,receiptSync:sync,transactions:t,journal:j,meaning:'bucket counts only; synthetic, model and real observations are reported separately; zero rows is zero exposure, never proof'};
}
async function main(){
 const a=args(process.argv.slice(2)),uri=process.env.OMF_AUDIT_MONGO_URI;
 if(!uri||!a.from||!a.to)throw Error('usage: OMF_AUDIT_MONGO_URI=<uri> node scripts/finance-receipt-link-audit.cjs --from <ISO> --to <ISO>');
 const from=new Date(a.from),to=new Date(a.to);if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to)throw Error('Invalid explicit window');
 const client=await MongoClient.connect(uri,{readPreference:'secondaryPreferred'});
 try{console.log(JSON.stringify(await audit(client.db(process.env.OMF_AUDIT_DB||undefined),{from,to}),null,1))}finally{await client.close()}
}
module.exports={audit};
if(require.main===module)main().catch(e=>{console.error('Audit failed: '+(e?.message||'error').replace(/mongodb(\+srv)?:\/\/\S+/g,'<uri>'));process.exitCode=1});

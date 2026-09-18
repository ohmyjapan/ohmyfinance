const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url'),{ObjectId}=require('mongodb');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports=async({db,call,upload,csv,row,token,origin,directory,pass,account,accountId,worker,request})=>{
 const {FinalizationWorker}=await import(pathToFileURL(path.resolve('finalization-worker/worker.mjs')));
 const date='2026-10-02',number='7654321',stock='WF-WORKER-1',external='22222222-2222-2222-2222-222222222222',archiveId=hash(external+':'+number),png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('Synthetic full-cycle original')]);
 const imported=await upload(csv([row({0:'2026/10/02',1:'2026/10/03',2:'Synthetic ISSEY full nightly cycle',5:'9100'})]),'?kind=statement&start=2026-09-19&end=2026-10-18');assert.equal(imported.status,200);
 const importId=imported.data.id,d=(await call('/api/finance/imports/'+importId+'/drafts/2',{token})).data;
 await db.collection('financedrafts').updateOne({ownerId:account.ownerId,importId:new ObjectId(importId),line:2},{$set:{accountId:account._id,key:d.key,sourceHash:d.sourceHash,revision:1,values:{...d.values,receiptNumber:number,purpose:'customer'},evidence:{...d.evidence,receiptNumber:{state:'confirmed',source:'owner'}}}},{upsert:true});
 const config=await db.collection('financeworkflowconfigs').findOne({ownerId:account.ownerId});
 const updated=await request('settings',{revision:config.revision,enabled:true,workerId:String(config.workerId),accountIds:[accountId],from:'2026-10-01',through:'2026-10-31'},'PUT');assert.equal(updated.status,200,JSON.stringify(updated));
 // Advance the isolated fixture's completed day; production state is untouched.
 await db.collection('financeworkflowruns').updateOne({ownerId:account.ownerId,status:'complete'},{$set:{day:'2000-01-01'}});
 const inventory=[['','','','','주문번호','','','색상/사이즈'],[],['',stock,'','','자동구매 '+number,'','AB12CD345','01-2']],shipping=[[],Array(20).fill(''),Array(20).fill('')];shipping[1][19]='재고번호';shipping[2][19]=stock;shipping[2][9]='SYN-WORKER';shipping[2][14]='999999991111';shipping[2][1]='2026/10/03';
 const archived={id:archiveId,accountId:external,accountName:'Synthetic worker account',orderNumber:number,date,total:9100,currency:'JPY',cancelled:false,dataQuality:'complete',captureVersion:2,capturedAt:new Date().toISOString(),sourceUrl:'https://www.isseymiyake.com/pages/orders',items:[{line:1,product:'Synthetic AB12CD345',color:'BLUE (no.01)',size:'2',quantity:1,lineTotal:9100}],amounts:[],inventoryLinks:[],files:[{part:1,bytes:png.length,sha256:hash(png)}]};
 const counts={sheets:0,catalogs:0,images:0,interpretations:0,documents:0},before={};for(const name of ['transactions','financedrafts'])before[name]=JSON.stringify(await db.collection(name).find({}).sort({_id:1}).toArray());
 let disconnect=true;
 const local=new FinalizationWorker({baseUrl:origin,token:worker,isseyArchive:{financialAccountIds:[accountId],accountIds:[external]},workflow:{intras:{account:'ohmyjapan1'}}},path.join(directory,'synthetic-worker'),{
  fetchImpl:async(url,options)=>{if(url.endsWith('/finish')&&disconnect){disconnect=false;throw Error('Synthetic disconnect before final acknowledgement')}return fetch(url,options)},
  captureSheet:async(_config,kind)=>{counts.sheets++;const rows=kind==='inventory'?inventory:shipping;return {sheet:'Synthetic '+kind,url:'https://docs.google.com/spreadsheets/d/synthetic/edit#gid='+(kind==='inventory'?1:2),capturedAt:new Date().toISOString(),csv:rows.map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n')}},
  archiveFactory:()=>({searched:new Map(),catalog:async()=>{counts.catalogs++;return {orders:[archived],runs:[]}},image:async()=>{counts.images++;return {bytes:png}}}),
  interpreter:async(_config,input)=>{counts.interpretations++;const c=input.input.alternatives.find(c=>c.id===archiveId);assert(c);return {value:{summary:'Synthetic exact confirmed reference.',recommendedId:c.id,hypotheses:[{candidateId:c.id,support:[{factId:c.id,quote:number}],uncertainty:''}],question:'',inventoryProposals:[]},models:['synthetic']}},
  intras:{collect:async target=>{
   counts.documents++;const applicationId='55555555',tracking=target.tracking,declaredAmount=1500;
   const invoice='COMMERCIAL INVOICE & PACKING LIST\nWAY BILL NO.\nSYNTHETIC ADDRESS\t'+tracking+'\nIssue date: 2026-10-03\n通貨(Currency)\nJPY\tFOB JAPAN\n総合計 (Total)\t1\t \t¥1,500\n',permit='輸出許可通知書\n申告番号\n1\t2026/10/04\t123 4567 8901\nＨＡＷＢ番号\t'+tracking+'\t貨物個数\t1 個\n申告価格 ¥1,500 -[*]\n社内整理用番号 '+applicationId+' 輸出者\n輸出許可年月日 2026/10/04\n';
   const document=(kind,text)=>{const bytes=Buffer.from('%PDF-1.4\nSynthetic full-cycle '+kind+'\n%%EOF');return {kind,name:kind+'.pdf',hash:hash(bytes),base64:bytes.toString('base64'),text,html:'<html>Synthetic</html>',sourceUrl:'https://intras.co.jp/synthetic-print',captureMethod:kind==='invoice'?'native_intras_pdf':'official_print_view',capturedAt:new Date().toISOString()}};
   return {target:{...target,applicationId},documents:[document('invoice',invoice),document('permit',permit)],models:['synthetic'],delivery:{url:'https://intras.co.jp/mypage/delivery?referCode='+target.orderId,text:target.orderId+' '+tracking+' '+applicationId,capturedAt:new Date().toISOString()},readback:{complete:true,invoice:{tracking,date:'2026-10-03',itemCount:1,currency:'JPY',declaredAmount},permit:{tracking,applicationId,permitNumber:'12345678901',permitDate:'2026-10-04',currency:'JPY',declaredAmount}}};
  }}
 });
 await assert.rejects(()=>local.cycle(),/Synthetic disconnect/);
 const saved=await db.collection('financepurchaselinks').findOne({ownerId:account.ownerId,archiveId});assert(saved);assert.deepEqual(saved.inventoryIds,[stock]);
 const workflow=await db.collection('financeworkflows').findOne({ownerId:account.ownerId,importId:new ObjectId(importId),line:2});assert.equal(workflow.summary.state,'complete');assert(Object.values(workflow.steps).every(s=>s.failedNights===0));
 await db.collection('financeworkflowconfigs').updateOne({ownerId:account.ownerId},{$set:{leaseUntil:new Date(0)}});await db.collection('financeworkflowruns').updateOne({ownerId:account.ownerId,status:'working'},{$set:{leaseUntil:new Date(0)}});
 assert.equal(await local.cycle(),true);assert.equal(await local.cycle(),false);assert.deepEqual(counts,{sheets:2,catalogs:1,images:1,interpretations:1,documents:1});
 assert.equal(await db.collection('financepurchaselinks').countDocuments({ownerId:account.ownerId,archiveId}),1);assert.equal(await db.collection('financeexports').countDocuments({ownerId:account.ownerId,orderId:'SYN-WORKER'}),1);
 for(const name of ['transactions','financedrafts'])assert.equal(JSON.stringify(await db.collection(name).find({}).sort({_id:1}).toArray()),before[name]);
 pass('full nightly worker: confirmed reference → originals → inventory → shipment → PDF evidence; crash/resume repeats no source or AI work');
};

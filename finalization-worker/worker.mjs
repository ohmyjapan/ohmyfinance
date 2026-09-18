import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {teachingOrigin} from '../teaching-worker/worker.mjs';
import {captureBrowserSheet,parseSheetCsv} from '../research-worker/sheets.mjs';
import {IsseyArchive} from '../research-worker/issey-archive.mjs';
import {IntrasCollector} from './intras.mjs';
import {interpret} from './interpreter.mjs';
import {receiptSchema,receiptSystem} from '../shared/finance-workflow-receipts.mjs';
import {investigationSchema,investigationSystem,automaticPurchaseCandidate,validateInvestigationReport} from '../shared/finance-workflow-investigation.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class FinalizationWorker {
 constructor(config,directory,{fetchImpl=fetch,captureSheet=captureBrowserSheet,archiveFactory=(c,x)=>new IsseyArchive(c,x),intras=new IntrasCollector(config),interpreter=interpret,log=()=>{}}={}) {
  this.config=config;this.directory=directory;this.origin=teachingOrigin(config.baseUrl);this.fetch=fetchImpl;this.captureSheet=captureSheet;this.archiveFactory=archiveFactory;this.intras=intras;this.interpret=interpreter;this.log=log;
 }
 async api(route,body={}) {
  const response=await this.fetch(this.origin+'/api/finance-workflow/worker/'+route,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!response.ok){const e=Error('Workflow API '+response.status);e.status=response.status;throw e;}
  return response.json();
 }
 async snapshot(run,kind,read) {
  const dir=path.join(this.directory,'runs',run.id);await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,kind+'.json');let snapshot;
  try { snapshot=JSON.parse(await fs.readFile(file,'utf8'));if(snapshot.binding!==hash([run.id,run.policy,this.config.spreadsheets,this.config.spreadsheetTabs,this.config.isseyArchive?.accountIds,this.config.isseyArchive?.financialAccountIds])||snapshot.hash!==hash(snapshot.source))throw Error('Local workflow snapshot changed'); }
  catch(e){if(e.code!=='ENOENT')throw e;const source=await read();snapshot={binding:hash([run.id,run.policy,this.config.spreadsheets,this.config.spreadsheetTabs,this.config.isseyArchive?.accountIds,this.config.isseyArchive?.financialAccountIds]),hash:hash(source),source};await fs.writeFile(file,JSON.stringify(snapshot),{flag:'wx'});}
  const saved=await this.api(run.id+'/source',{lease:run.lease,...snapshot.source});return {...snapshot.source,id:saved.id,hash:saved.hash};
 }
 async observe(run,row,step,reason,sourceIds=[],suggestion='') {
  const result=await this.api(run.id+'/observation',{lease:run.lease,id:row.id,revision:row.revision,step,reason,sourceIds,eventId:randomUUID(),suggestion});
  Object.assign(row,result.row);return result;
 }
 async collectedDocuments(target) {
  const binding=hash([1,target.providerAccount,target.orderId,target.tracking,target.shippedAt]),directory=path.join(this.directory,'documents'),file=path.join(directory,binding+'.json');
  try {const cached=JSON.parse(await fs.readFile(file,'utf8'));if(cached.binding!==binding||cached.hash!==hash(cached.capture))throw Error('Cached document evidence changed');return cached.capture;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const capture=await this.intras.collect(target);await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(file,JSON.stringify({binding,hash:hash(capture),capture}),{flag:'wx'});return capture;
 }
 async cycle() {
  let status;
  try { status=await this.api('status',{capabilities:['purchase','inventory','shipment','receipt_inference',...(this.config.workflow?.intras?['documents']:[])]}); }
  catch(e){if(e.status===403)return false;throw e;}
  if(!status.config.enabled)return false;
  const {run}=await this.api('claim');if(!run)return false;
  let expired=false,heartbeatBusy=false;
  const timer=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await this.api(run.id+'/heartbeat',{lease:run.lease})}catch{expired=true}finally{heartbeatBusy=false}},30000);timer.unref();
  try {
   let context=await this.api(run.id+'/context',{lease:run.lease});
   const sources={},failures={};
   // Read each configured source once; immutable files survive a worker restart.
   for(const kind of ['inventory','shipping']) {
    try { sources[kind]=await this.snapshot(run,kind,async()=>{const captured=await this.captureSheet(this.config,kind),rows=parseSheetCsv(captured.csv);return {kind,name:captured.sheet,capturedAt:captured.capturedAt,complete:rows.length<50000,scope:{url:captured.url,range:'A1:AZ50000'},payload:{rows}};}); }
    catch { failures[kind]='connection_required'; }
    if(expired)throw Error('Workflow lease lost');
   }
   try {
    sources.orders=await this.snapshot(run,'orders',async()=>{
     const financialAccount=run.policy.accountIds.find(a=>this.config.isseyArchive?.financialAccountIds?.includes(a));if(!financialAccount)throw Error('Archive scope unavailable');
     this.archive=this.archiveFactory(this.config,{source:{account:{id:financialAccount},purchaseDate:run.policy.from}});const payload=await this.archive.catalog();
     return {kind:'orders',name:'ISSEY MIYAKE',capturedAt:new Date().toISOString(),complete:true,scope:{financialAccountIds:run.policy.accountIds.filter(a=>this.config.isseyArchive.financialAccountIds.includes(a)),externalAccountIds:[...this.config.isseyArchive.accountIds]},payload};
    });
   } catch { failures.orders='connection_required'; }
   const results=new Map(),documentResults=new Map(),failedDocumentTargets=new Set();
   const advanceConnected=async()=>{
    context=await this.api(run.id+'/context',{lease:run.lease});
    if(sources.inventory?.complete&&sources.shipping?.complete)for(const purchase of context.purchases) {
     if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
     const row=context.rows.find(r=>r.purchaseId===purchase.id);if(!row||row.steps.purchase?.state!=='complete')continue;
     try { results.set(purchase.id,await this.api(run.id+'/inventory',{lease:run.lease,purchaseId:purchase.id,revision:purchase.revision,inventorySourceId:sources.inventory.id,shippingSourceId:sources.shipping.id})); }
     catch(e){results.set(purchase.id,{state:e.status===409?'manual_review':'connection_required'});}
    }
    context=await this.api(run.id+'/context',{lease:run.lease});
    for(const target of context.shipments||[]) {
     if(failedDocumentTargets.has(target.key))continue;
     if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
     try {
      const capture=target.reusable?undefined:await this.collectedDocuments(target);
      await this.api(run.id+'/documents',{lease:run.lease,key:target.key,fingerprint:target.fingerprint,capture});
     }catch(e){
      failedDocumentTargets.add(target.key);
      if(e.code==='missing_documents'&&e.attempt)await this.api(run.id+'/document-attempt',{lease:run.lease,key:target.key,fingerprint:target.fingerprint,attempt:e.attempt});
      else for(const a of target.allocations)documentResults.set(a.inventoryId,['conflict','integrity_failed'].includes(e.code)?'conflict':e.code==='source_incomplete'?'source_incomplete':e.status===409?'conflict':'connection_required');
     }
    }
    context=await this.api(run.id+'/context',{lease:run.lease});
   for(const row of context.rows) {
    if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
    const result=results.get(row.purchaseId);
    for(const [key,step] of Object.entries(row.steps)) {
     if(['complete','not_applicable','manual_review'].includes(step.state))continue;
     if(step.stage==='inventory'&&row.purchaseId) {
      if(result?.state==='manual_review')await this.observe(run,row,key,'ambiguous',[sources.inventory?.id,sources.shipping?.id].filter(Boolean),'在庫・サイズ・数量の候補を購入画面で確認してください。');
      else if(result?.state==='connection_required'||failures.inventory||failures.shipping)await this.observe(run,row,key,'connection_required',[],'在庫・出荷シートへの接続を確認してください。');
      else if(sources.inventory?.complete&&sources.shipping?.complete)await this.observe(run,row,key,'missing_inventory',[sources.inventory.id,sources.shipping.id],'今回取得した在庫に、注文の商品と一致する未接続の在庫が見つかりません。');
      else await this.observe(run,row,key,'source_incomplete',[],'全範囲の資料が取得できるまで照合を保留します。');
     } else if(step.stage==='shipment'&&row.purchaseId&&!step.unit.startsWith('remaining:')) {
      if(failures.shipping)await this.observe(run,row,key,'connection_required',[],'出荷シートへの接続を確認してください。');
      else if(sources.shipping?.complete)await this.observe(run,row,key,'waiting_shipment',[sources.shipping.id],'取得した出荷記録に対応する出荷が見つかりません。未発送の確定ではありません。');
     } else if(step.stage==='documents'&&documentResults.has(step.unit)) {
      await this.observe(run,row,key,documentResults.get(step.unit),[],'Intrasの接続または取得した書類の一致を確認してください。保存済みの資料は保持しています。');
     }
    }
   }
   };
   // Existing confirmed units advance before potentially slow receipt/AI work.
   // Newly identified purchases get the same continuation later in this run.
   await advanceConnected();
   const receiptList=await this.api(run.id+'/receipts',{lease:run.lease});
   for(const document of receiptList.documents.filter(d=>!d.reading)) {
    if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
    try {
     const file=await this.api(run.id+'/receipt-file',{lease:run.lease,documentId:document.id,hash:document.hash}),bytes=Buffer.from(file.base64,'base64');
     if(createHash('sha256').update(bytes).digest('hex')!==document.hash)throw Error('Receipt integrity failure');
     const output=await this.interpret(this.config,{system:receiptSystem,schema:receiptSchema,input:{document:'purchase receipt'},documents:[{mimeType:document.mimeType,bytes}]});
     await this.api(run.id+'/receipt-reading',{lease:run.lease,documentId:document.id,hash:document.hash,reading:output.value,models:output.models});
    }catch{failures.receipts='connection_required';}
   }
   if(sources.orders) {
    const account=run.policy.accountIds.find(a=>this.config.isseyArchive?.financialAccountIds?.includes(a));
    this.archive=this.archiveFactory(this.config,{source:{account:{id:account},purchaseDate:run.policy.from}});
    for(const order of sources.orders.payload.orders)this.archive.searched.set(order.id,order);
   }
   const investigationChecked=row=>Math.min(...Object.values(row.steps).filter(s=>['purchase','inventory'].includes(s.stage)&&!['complete','not_applicable','manual_review'].includes(s.state)).map(s=>Date.parse(s.lastCheckedAt||0)||0));
   for(const row of [...context.rows].sort((a,b)=>investigationChecked(a)-investigationChecked(b))) {
    const receiptPurchase=context.purchases.find(p=>p.id===row.purchaseId&&p.order.kind==='receipt');
    const stageKey=receiptPurchase?Object.keys(row.steps).find(k=>row.steps[k].stage==='inventory'&&!['complete','not_applicable','manual_review'].includes(row.steps[k].state)):'purchase',step=row.steps[stageKey];
    if(row.purchaseId&&!receiptPurchase||!step||['complete','not_applicable','manual_review'].includes(step.state)||step.snoozedUntil>run.day)continue;
    if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
    try {
     const prepared=await this.api(run.id+'/investigate',{lease:run.lease,id:row.id}),evidence=prepared.context;let investigation=prepared.investigation;
     if(!evidence.alternatives.length) {
      const unavailable=failures.orders||failures.receipts||failures.inventory;
      await this.observe(run,row,stageKey,unavailable?'connection_required':'source_required',[],unavailable?'購入・領収書・在庫の接続を確認してください。':'接続済みの購入記録では対応を特定できません。購入先または領収書を明細に追加してください。');continue;
     }
     if(!prepared.cached) {
      const output=await this.interpret(this.config,{system:investigationSystem,schema:investigationSchema,input:evidence});
      validateInvestigationReport(output.value,evidence);
      investigation=await this.api(run.id+'/investigation-result',{lease:run.lease,id:row.id,revision:investigation.revision,fingerprint:evidence.fingerprint,report:output.value,models:output.models});
     }
     for(const candidate of evidence.alternatives.filter(c=>c.kind==='online'&&!c.claimed))for(const file of candidate.files) {
      if(investigation.artifacts.some(a=>a.candidateId===candidate.id&&a.part===file.part&&a.hash===file.sha256))continue;
      if(expired||Date.now()>=Date.parse(run.deadline))throw Error('Workflow lease lost');
      const captured=await this.archive.image(candidate.id,file.part);
      await this.api(run.id+'/purchase-original',{lease:run.lease,id:row.id,fingerprint:evidence.fingerprint,candidateId:candidate.id,part:file.part,base64:captured.bytes.toString('base64')});
     }
     const automatic=automaticPurchaseCandidate(evidence,investigation.report);
     if(automatic&&!receiptPurchase)await this.api(run.id+'/accept-purchase',{lease:run.lease,id:row.id,revision:investigation.revision,fingerprint:evidence.fingerprint,candidateId:automatic.id,reason:'以前に確認されたこの明細の注文番号と、取得した購入原本を照合しました。',confirm:true});
     else await this.observe(run,row,stageKey,receiptPurchase&&evidence.offline.unresolvedJan.length?'source_required':'ambiguous',[],(investigation.report.summary+(investigation.report.question?'\n'+investigation.report.question:'')).slice(0,2000));
    }catch(e){await this.observe(run,row,stageKey,e.status===409?'conflict':'connection_required',[],'購入調査の接続または変更された根拠を確認してください。');}
   }
   await advanceConnected();
   await this.api(run.id+'/finish',{lease:run.lease,status:Object.keys(failures).length?'connection_required':'complete'});
   this.log('Workflow run finished');return true;
  } finally {clearInterval(timer);}
 }
}

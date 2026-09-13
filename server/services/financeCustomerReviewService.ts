import {activeImportRows} from '../../shared/finance-import-overlap.mjs'
import {readDraft,saveDraft} from './financeDraftService'
import {id,fail,ownedImport} from './financeService'
import {customerContextEvidence} from './financeLearningService'
import {digest} from '../../shared/amex.mjs'
import {customerTreatments,customerGoodsContext,customerPurchaseCandidate,customerReviewBinding,customerReviewApplied,customerReviewGroup} from '../../shared/finance-customer-review.mjs'
const choice=(d:any,treatment:string)=>{const proposal=customerPurchaseCandidate(d,treatment);return proposal?{...proposal,key:digest(customerReviewBinding(d,proposal))}:null}
export async function customerReviewPreview(ownerId:string,importIds:any){
 if(!Array.isArray(importIds)||!importIds.length||importIds.length>10||new Set(importIds).size!==importIds.length)fail(400,'表示する明細を選択してください。')
 const batches=[];for(const importId of importIds)batches.push(await ownedImport(ownerId,id(importId)))
 const candidates=batches.flatMap(b=>activeImportRows(b).filter((r:any)=>r.kind==='expense').map((r:any)=>({importId:String(b._id),line:r.line}))),limit=candidates.slice(0,160),drafts:any[]=new Array(limit.length);let next=0;
 await Promise.all(Array.from({length:Math.min(4,limit.length)},async()=>{while(next<limit.length){const i=next++,r=limit[i];drafts[i]=await readDraft(ownerId,r.importId,r.line)}}))
 const contexts=await customerContextEvidence(ownerId),groups=new Map<string,any>();
 for(const d of drafts){const context=customerGoodsContext(d);if(!context)continue;const groupId=digest(customerReviewGroup(context));if(!groups.has(groupId))groups.set(groupId,{id:groupId,...context,workflow:contexts.filter((c:any)=>c.customerId===context.customerId),rows:[]});groups.get(groupId).rows.push({importId:d.importId,line:d.line,date:d.source.purchaseDate,amount:d.source.amount,mappingReason:context.mappingReason,originalCategory:context.originalCategory,historyGap:context.historyGap||null,choices:customerTreatments.map(t=>choice(d,t.id)).filter(Boolean)})}
 return {groups:[...groups.values()].sort((a,b)=>b.rows.length-a.rows.length),truncated:candidates.length>160,treatments:customerTreatments}
}
export async function saveCustomerReview(ownerId:string,body:any){
 if(!body||Object.keys(body).some(k=>!['rows','confirmGoods'].includes(k))||body.confirmGoods!==true||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>30)fail(400,'対象の商品代金と取引内容を確認してください。')
 const pending=[],seen=new Set();let group='';
 for(const row of body.rows){if(!row||Object.keys(row).some(k=>!['importId','line','key','treatment'].includes(k))||!Number.isSafeInteger(row.line)||typeof row.key!=='string'||!/^[a-f0-9]{64}$/.test(row.key)||!customerTreatments.some(t=>t.id===row.treatment))fail(400,'明細の選択が不正です。');id(row.importId);const identity=row.importId+':'+row.line;if(seen.has(identity))fail(400,'同じ明細が重複しています。');seen.add(identity);
  const draft=await readDraft(ownerId,row.importId,row.line),applied=customerReviewApplied(draft,row.key,row.treatment),candidate=applied?draft.history.find((h:any)=>h.customerReview?.key===row.key)?.customerReview:choice(draft,row.treatment);
  if(!candidate||candidate.key!==row.key)fail(409,'候補または下書きが変更されました。再読込して選び直してください。');const identityGroup=customerReviewGroup(candidate.context)+':'+row.treatment;if(group&&group!==identityGroup)fail(400,'同じ顧客・カード・利用先の明細を選択してください。');group=identityGroup;pending.push({row,draft,candidate,applied});
 }
 const results=[];for(const {row,draft,candidate,applied}of pending){if(applied){results.push({...row,state:'already_saved'});continue}try{const values={...draft.values};for(const f of candidate.fields)values[f.key]=f.value;await saveDraft(ownerId,row.importId,row.line,{revision:draft.revision,key:draft.key,sourceHash:draft.sourceHash,values,remember:[],confirm:false},undefined,undefined,{key:row.key,treatment:row.treatment});results.push({...row,state:'saved'})}catch(e:any){results.push({...row,state:'failed',message:e.statusCode===409?'保存中に内容が変わりました。再読込して確認してください。':'保存結果を再確認してください。同じ選択で再試行できます。'})}}
 return {results,saved:results.filter(r=>r.state==='saved').length,alreadySaved:results.filter(r=>r.state==='already_saved').length,failed:results.filter(r=>r.state==='failed').length}
}

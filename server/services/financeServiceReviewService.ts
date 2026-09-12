import {readDraft,saveDraft} from './financeDraftService'
import {id,fail,ownedImport} from './financeService'
import {digest} from '../../shared/amex.mjs'
import {recurringServiceCandidate,recurringServiceDescriptor,serviceReviewBinding,serviceReviewApplied,serviceUseConfirmation} from '../../shared/finance-service-review.mjs'
function publicCandidate(d:any){const proposal=recurringServiceCandidate(d);return proposal?{importId:d.importId,line:d.line,key:digest(serviceReviewBinding(d,proposal)),merchant:d.source.description,date:d.source.purchaseDate,amount:d.source.amount,card:d.source.account.name,currentCategory:d.references.transactionCategories.find((c:any)=>String(c._id)===d.values.transactionCategoryId)?.name||'',...proposal}:null}
export async function serviceReviewPreview(ownerId:string,importIds:any){
 if(!Array.isArray(importIds)||!importIds.length||importIds.length>10||new Set(importIds).size!==importIds.length)fail(400,'表示する明細を選択してください。')
 const batches=[];for(const importId of importIds)batches.push(await ownedImport(ownerId,id(importId)))
 const candidates=batches.flatMap(b=>b.rows.filter((r:any)=>r.kind==='expense'&&recurringServiceDescriptor({...r,kind:'expense'})).map((r:any)=>({importId:String(b._id),line:r.line}))),rows=[];
 for(const row of candidates.slice(0,60)){const candidate=publicCandidate(await readDraft(ownerId,row.importId,row.line));if(candidate)rows.push(candidate)}
 return {rows,truncated:candidates.length>60,confirmation:serviceUseConfirmation}
}
export async function saveServiceReview(ownerId:string,body:any){
 if(!body||Object.keys(body).some(k=>!['rows','confirmServiceUse'].includes(k))||body.confirmServiceUse!==true||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>30)fail(400,'対象の明細と業務での利用を確認してください。')
 const seen=new Set(),pending=[];
 // Validate the complete selection before any writes. Each save rechecks under the existing account lease.
 for(const row of body.rows){if(!row||Object.keys(row).some(k=>!['importId','line','key'].includes(k))||!Number.isSafeInteger(row.line)||typeof row.key!=='string'||!/^[a-f0-9]{64}$/.test(row.key))fail(400,'明細の選択が不正です。');id(row.importId);const identity=row.importId+':'+row.line;if(seen.has(identity))fail(400,'同じ明細が重複しています。');seen.add(identity);const draft=await readDraft(ownerId,row.importId,row.line);if(serviceReviewApplied(draft,row.key)){pending.push({row,draft,applied:true});continue}const candidate=publicCandidate(draft);if(!candidate||candidate.key!==row.key)fail(409,'候補または下書きが変更されました。再読込して選び直してください。');pending.push({row,draft,candidate,applied:false})}
 const results=[];
 for(const item of pending){const {row,draft,candidate}=item;if(item.applied){results.push({...row,state:'already_saved'});continue}
  try{const values={...draft.values};for(const f of candidate.fields)values[f.key]=f.value;await saveDraft(ownerId,row.importId,row.line,{revision:draft.revision,key:draft.key,sourceHash:draft.sourceHash,values,remember:[],confirm:false},undefined,row.key);results.push({...row,state:'saved'})}
  catch(e:any){results.push({...row,state:'failed',message:e.statusCode===409?'保存中に内容が変わりました。再読込して確認してください。':'保存結果を再確認してください。再試行しても保存済みの同じ内容は重複しません。'})}
 }
 return {results,saved:results.filter(r=>r.state==='saved').length,alreadySaved:results.filter(r=>r.state==='already_saved').length,failed:results.filter(r=>r.state==='failed').length}
}

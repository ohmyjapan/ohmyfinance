import {createHash} from 'node:crypto';
export function purchaseItemKey(order,line){
 const item=order.items.find(i=>i.line===line);if(!item)throw Error('Purchase item missing');
 return createHash('sha256').update(JSON.stringify([order.archiveId,item.line,item.product,item.color,item.size])).digest('hex');
}
export function exportDocumentsComplete(record){
 return record.status==='active'&&record.documentIntegrity!==false&&!!record.verifiedAt&&!!record.permitNumber&&!!record.permitDate&&
 ['invoice','permit'].every(kind=>record.documents?.some(d=>d.kind===kind&&/^[a-f0-9]{64}$/.test(d.hash)&&d.size>0));
}
export function purchaseExportProgress(purchase,exports=[],outcomes=[]){
 const units=[],items=purchase.order.items.map(item=>{
  const stocks=purchase.order.inventoryLinks.filter(s=>s.itemLine===item.line),itemKey=purchaseItemKey(purchase.order,item.line);
  const allocated=stocks.map(stock=>{
   const matches=exports.filter(e=>e.status==='active'&&e.allocations.some(a=>String(a.purchaseId)===String(purchase._id||purchase.id)&&a.inventoryId===stock.inventoryId&&a.itemKey===itemKey&&a.quantity===1));
   const resolutions=outcomes.filter(o=>o.status==='active'&&o.documentIntegrity!==false&&String(o.purchaseId)===String(purchase._id||purchase.id)&&o.inventoryId===stock.inventoryId&&o.itemKey===itemKey&&o.confirmedAt&&o.documents?.length);
   let state='pending',exportId=null,outcomeId=null;
   if(matches.length+resolutions.length>1)state='conflict';
   else if(matches.length){exportId=String(matches[0]._id||matches[0].id);state=exportDocumentsComplete(matches[0])?'exported':'documents_pending';}
   else if(resolutions.length){state=resolutions[0].outcome;outcomeId=String(resolutions[0]._id||resolutions[0].id);}
   const result={inventoryId:stock.inventoryId,itemLine:item.line,itemKey,state,exportId,outcomeId};units.push(result);return result;
  });
  return {line:item.line,itemKey,quantity:item.quantity,identified:stocks.length,exported:allocated.filter(s=>s.state==='exported').length,resolved:allocated.filter(s=>['returned','cancelled'].includes(s.state)).length};
 });
 const total=items.reduce((n,i)=>n+i.quantity,0),exported=items.reduce((n,i)=>n+i.exported,0),resolved=items.reduce((n,i)=>n+i.resolved,0);
 const conflicted=units.some(u=>u.state==='conflict')||items.some(i=>i.identified>i.quantity);
 const active=purchase.status==='linked';
 const evidenceComplete=purchase.evidenceComplete===true;
 const state=!active?'unlinked':conflicted?'conflict':exported+resolved===total&&!evidenceComplete?'purchase_evidence_pending':exported===total?'complete':exported+resolved===total?'resolved':exported+resolved>0?'partial':'pending';
 return {state,total,exported,resolved,pending:Math.max(0,total-exported-resolved),evidenceComplete,items,units};
}

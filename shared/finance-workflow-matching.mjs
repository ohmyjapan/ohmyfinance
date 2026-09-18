import {createHash} from 'node:crypto';
import {sheetInventory, validatePurchaseOrder} from './finance-purchase-links.mjs';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const textHash = v => createHash('sha256').update(v).digest('hex');
const normalized = v => String(v || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const orderReference = v => normalized(v).match(/^(?:(?:OSAKA YAMATO|자동구매) )?(\d{4,15})$/)?.[1] || '';
const comparable = links => links.map(s => ({inventoryId:s.inventoryId,itemLine:s.itemLine,quantity:s.quantity,requiresReview:!!s.requiresReview,shipments:s.shipments.map(p => ({orderId:p.orderId||'',tracking:p.tracking,date:p.date})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.inventoryId.localeCompare(b.inventoryId));
const shippingChanged=(old,next)=>old.filter(s=>s.tracking?.trim()).some(s=>!next.some(n=>normalized(n.tracking).replace(/[-\s]/g,'')===normalized(s.tracking).replace(/[-\s]/g,'')&&(!s.orderId?.trim()||normalized(n.orderId)===normalized(s.orderId))&&(!s.date||String(n.date).replaceAll('/','-')===String(s.date).replaceAll('/','-'))));

// Build receipt-independent inventory evidence for an already confirmed online
// order. This does not decide which payment belongs to an online/offline purchase.
export function matchWorkflowInventory(order, snapshots) {
  validatePurchaseOrder(order);
  for (const kind of ['inventory','shipping']) {
    const source = snapshots[kind];
    if (!source || source.complete !== true || !Array.isArray(source.rows) || !source.rows.length || source.rows.length >= 50000 || typeof source.name !== 'string' || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+$/.test(source.url || '')) throw Error('Complete inventory and shipping snapshots required');
  }
  if (!String(snapshots.inventory.rows[0]?.[4]).includes('주문번호') || !String(snapshots.inventory.rows[0]?.[7]).includes('색상/사이즈') || snapshots.shipping.rows[1]?.[19] !== '재고번호') throw Error('Inventory or shipping layout changed');
  if (snapshots.inventory.url.split('/edit')[0] !== snapshots.shipping.url.split('/edit')[0]) throw Error('Inventory and shipping must use the same configured workbook');
  const relevant = order.kind==='receipt'?[]:snapshots.inventory.rows.map((values,i) => ({row:i+1,values})).filter(r => r.row >= 3 && orderReference(r.values[4]) === order.orderNumber);
  const inventoryIds = new Set([...relevant.map(r => r.values[1]), ...order.inventoryLinks.map(s => s.inventoryId)].filter(Boolean));
  const allInventory = snapshots.inventory.rows.map((values,i) => ({row:i+1,values})).filter(r => r.row >= 3 && inventoryIds.has(r.values[1]));
  const counts = new Map(); for (const r of allInventory) counts.set(r.values[1], (counts.get(r.values[1]) || 0) + 1);
  const conflicts = [...counts].filter(([,n])=>n>1).map(([id])=>({reason:'duplicate_inventory',inventoryId:id}));
  const make = (kind, matches) => {
    const s = snapshots[kind], text = JSON.stringify({sheet:s.name,snapshotHash:hash(s.rows),exportMode:'original_csv',firstRows:s.rows.slice(0,2),matches});
    return {id:s.id,kind:'spreadsheet',title:kind+' / '+s.name,url:s.url,text,hash:textHash(text),capturedAt:s.capturedAt};
  };
  const sources = [make('inventory', allInventory), make('shipping', snapshots.shipping.rows.map((values,i)=>({row:i+1,values})).filter(r=>r.row>=3&&inventoryIds.has(r.values[19])))];
  if(order.kind==='receipt') {
    const next=structuredClone(order),shipping=snapshots.shipping;
    for(const stock of next.inventoryLinks) {
      const current=allInventory.find(r=>r.values[1]===stock.inventoryId);
      if(!current||normalized(current.values[6]).replace(/[-\s]/g,'')!==stock.source.itemModel||normalized(current.values[7])!==stock.source.itemVariant||normalized(current.values[4])!==normalized(stock.source.reference)) {conflicts.push({reason:'confirmed_inventory_changed',inventoryId:stock.inventoryId});continue;}
      const shipments=shipping.rows.map((v,i)=>({v,row:i+1})).filter(r=>r.row>=3&&r.v[19]===stock.inventoryId).map(({v,row})=>({inventoryId:stock.inventoryId,date:v[1]||'',orderId:v[9]||'',tracking:v[14]||'',status:'source_record',source:{sheet:shipping.name,row,inventoryCell:'T'+row,orderCell:'J'+row,trackingCell:'O'+row,url:shipping.url,snapshotHash:hash(shipping.rows)}}));
      const keys=new Set(shipments.filter(s=>s.tracking).map(s=>normalized(s.orderId)+':'+normalized(s.tracking).replace(/[-\s]/g,'')));
      const oldKeys=new Set(stock.shipments.filter(s=>s.tracking).map(s=>normalized(s.orderId)+':'+normalized(s.tracking).replace(/[-\s]/g,'')));
      if(keys.size>1||shipments.length>1||shippingChanged(stock.shipments,shipments)||oldKeys.size&&[...keys].some(k=>!oldKeys.has(k)))conflicts.push({reason:'shipment_changed',inventoryId:stock.inventoryId});
      else if(shipments.length)stock.shipments=shipments;
    }
    validatePurchaseOrder(next);
    return {order:next,changed:hash(comparable(order.inventoryLinks))!==hash(comparable(next.inventoryLinks)),conflicts,proposals:[],sources,identified:next.inventoryLinks.length,total:order.items.reduce((n,i)=>n+i.quantity,0)};
  }
  // Inspect all matching units before applying quantities. The ordinary mapper
  // suppresses over-quantity groups; here that suppression must become a conflict.
  const found = sheetInventory({...structuredClone(order),items:order.items.map(i=>({...i,quantity:10000})),inventoryLinks:[]}, sources);
  for (const old of order.inventoryLinks) {
    if (!found.links.some(s=>s.inventoryId===old.inventoryId&&s.itemLine===old.itemLine)) conflicts.push({reason:'confirmed_inventory_changed',inventoryId:old.inventoryId});
  }
  for (const item of order.items) if (found.links.filter(s=>s.itemLine===item.line).length>item.quantity) conflicts.push({reason:'quantity_exceeded',itemLine:item.line});
  const combined = structuredClone(order.inventoryLinks), proposals = [];
  for (const stock of found.links) {
    const old = combined.find(s=>s.inventoryId===stock.inventoryId);
    if (old && old.itemLine !== stock.itemLine) { conflicts.push({reason:'inventory_item_changed',inventoryId:stock.inventoryId}); continue; }
    if (!old && stock.requiresReview) { proposals.push(stock); continue; }
    const shippingGroups = new Set(stock.shipments.filter(s=>s.tracking?.trim()).map(s=>normalized(s.orderId)+':'+normalized(s.tracking).replace(/[-\s]/g,'')));
    if (shippingGroups.size > 1 || stock.shipments.length > 1) { conflicts.push({reason:'multiple_shipments',inventoryId:stock.inventoryId}); continue; }
    if (old) {
      const oldTracking = new Set(old.shipments.filter(s=>s.tracking?.trim()).map(s=>normalized(s.tracking).replace(/[-\s]/g,'')));
      if (shippingChanged(old.shipments,stock.shipments)||oldTracking.size && stock.shipments.some(s=>s.tracking?.trim()&&!oldTracking.has(normalized(s.tracking).replace(/[-\s]/g,'')))) { conflicts.push({reason:'shipment_changed',inventoryId:stock.inventoryId}); continue; }
      if (stock.shipments.length) old.shipments = stock.shipments;
    } else combined.push({...stock,status:'matched'});
  }
  for (const item of order.items) {
    if (combined.filter(s=>s.itemLine===item.line).length > item.quantity) conflicts.push({reason:'quantity_exceeded',itemLine:item.line});
  }
  // Extra source rows are an unresolved discrepancy, even when the strict
  // matcher rejected their variants or suppressed an over-quantity group.
  if (relevant.length > order.items.reduce((n,i)=>n+i.quantity,0)) conflicts.push({reason:'quantity_exceeded'});
  const next = {...structuredClone(order),inventoryLinks:combined};
  if (!conflicts.length) validatePurchaseOrder(next);
  return {order:next,changed:hash(comparable(order.inventoryLinks))!==hash(comparable(combined)),conflicts,proposals,sources,identified:combined.length,total:order.items.reduce((n,i)=>n+i.quantity,0)};
}

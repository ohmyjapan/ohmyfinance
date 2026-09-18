// Build reviewable connections only from captured worker evidence, never browser-supplied orders.
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,max=500)=>typeof v==='string'&&v.length<=max;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const historyUrl='https://www.isseymiyake.com/pages/orders';
const normalize=v=>String(v||'').normalize('NFKC').toUpperCase().trim();
// Accept the observed warehouse prefix while preserving the original source cell.
const orderReference=v=>normalize(v).replace(/\s+/g,' ').match(/^(?:(?:OSAKA YAMATO|자동구매) )?(\d{4,15})$/)?.[1]||'';
const model=v=>normalize(v).replace(/[-\s]/g,'').match(/[A-Z]{2}\d{2}[A-Z]{2}\d{3}/)?.[0]||'';
const option=v=>/^\d+$/.test(normalize(v))?String(Number(v)):normalize(v);
// The configured inventory's captured header identifies this layout. Retain only
// exact order/full-model/color joins; missing size remains an explicit review gap.
export function sheetInventory(order,sources){
 const parsed=[];
 for(const source of sources){
  if(source.kind!=='spreadsheet'||hash(source.text)!==source.hash||!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+$/.test(source.url||''))continue;
  try{const sheet=JSON.parse(source.text);if(!['original_csv','sheets_api'].includes(sheet.exportMode)||!hex(sheet.snapshotHash)||!Array.isArray(sheet.matches))continue;parsed.push({source,sheet})}catch{}
 }
 const snapshots=new Map();for(const p of parsed){const set=snapshots.get(p.source.url)||new Set();set.add(p.sheet.snapshotHash);snapshots.set(p.source.url,set)}
 const valid=parsed.filter(p=>snapshots.get(p.source.url).size===1),rows=new Map(),duplicateIds=new Set();
 for(const {source,sheet} of valid){
  if(!source.title.startsWith('inventory / ')||!String(sheet.firstRows?.[0]?.[4]).includes('주문번호')||!String(sheet.firstRows?.[0]?.[7]).includes('색상/사이즈'))continue;
  for(const row of sheet.matches){
   const v=row.values;if(!Array.isArray(v)||!Number.isSafeInteger(row.row)||row.row<3||!text(v[1],100)||!v[1].trim())continue;
   const key=source.url+':'+row.row,old=rows.get(key);if(old){if(JSON.stringify(old.row.values)!==JSON.stringify(v)){duplicateIds.add(v[1]);duplicateIds.add(old.row.values[1])}continue}
   rows.set(key,{row,source,sheet});
  }
 }
 const counts=new Map();for(const {row} of rows.values())counts.set(row.values[1],(counts.get(row.values[1])||0)+1);
 const links=[],evidence=new Map();
 for(const {row,source,sheet} of rows.values()){
  // A trailing separator supplies no size; keep the same review gate as a bare color.
  const v=row.values,code=normalize(v[6]).replace(/[-\s]/g,''),variant=normalize(v[7]).match(/^(\d{1,3})(?:[-/](\d+|[A-Z]+|-)?)?$/);
  if(orderReference(v[4])!==order.orderNumber||counts.get(v[1])!==1||duplicateIds.has(v[1])||!variant||!/^[A-Z]{2}\d{2}[A-Z]{2}\d{3}$/.test(code))continue;
  const items=order.items.filter(i=>model(i.product)===code&&option(i.color.match(/no\.\s*(\d+)/i)?.[1])===option(variant[1])&&(!variant[2]||option(i.size)===option(variant[2])));
  if(items.length!==1)continue;
  const item=items[0],shipments=[],seenShipments=new Set();
  for(const shipping of valid){
   if(!shipping.source.title.startsWith('shipping / ')||shipping.source.url.split('/edit')[0]!==source.url.split('/edit')[0]||shipping.sheet.firstRows?.[1]?.[19]!=='재고번호')continue;
   for(const r of shipping.sheet.matches){const cells=r.values,k=shipping.source.url+':'+r.row;if(!Array.isArray(cells)||cells[19]!==v[1]||!Number.isSafeInteger(r.row)||r.row<3||seenShipments.has(k))continue;seenShipments.add(k);
    shipments.push({inventoryId:v[1],date:String(cells[1]||''),orderId:String(cells[9]||''),tracking:String(cells[14]||''),status:'source_record',source:{sheet:shipping.sheet.sheet,row:r.row,inventoryCell:'T'+r.row,orderCell:'J'+r.row,trackingCell:'O'+r.row,url:shipping.source.url,snapshotHash:shipping.sheet.snapshotHash}});evidence.set(shipping.source.id,shipping.source);
   }
  }
  links.push({inventoryId:v[1],itemLine:item.line,quantity:1,status:'candidate',requiresReview:!variant[2],reviewReason:variant[2]?'':'在庫シートにサイズの記載がありません。',basis:'order_model_color',source:{sheet:sheet.sheet,row:row.row,inventoryCell:'B'+row.row,orderCell:'E'+row.row,url:source.url,snapshotHash:sheet.snapshotHash},shipments});evidence.set(source.id,source);
 }
 // Do not turn a quantity conflict into a guessed subset of inventory.
 const combined=[...order.inventoryLinks];
 for(const link of links){const existing=combined.find(i=>i.inventoryId===link.inventoryId);if(existing){if(existing.itemLine===link.itemLine&&!existing.shipments.length)existing.shipments=link.shipments;continue}combined.push(link)}
 const allocation=new Map();for(const link of combined)allocation.set(link.itemLine,(allocation.get(link.itemLine)||0)+1);
 return {links:combined.filter(link=>allocation.get(link.itemLine)<=order.items.find(i=>i.line===link.itemLine).quantity),evidence:[...evidence.values()]};
}
function coordinates(s){return s&&text(s.sheet,100)&&s.sheet&&Number.isSafeInteger(s.row)&&s.row>0&&text(s.inventoryCell,30)&&/^[A-Z]+[1-9]\d*$/.test(s.inventoryCell)}
export function validatePurchaseOrder(o){
 if(!o||!hex(o.archiveId)||!date(o.date)||o.currency!=='JPY'||!Number.isSafeInteger(o.total)||o.total<=0||o.cancelled!==false||o.dataQuality!=='complete'||!Number.isFinite(Date.parse(o.capturedAt)))throw Error('Invalid purchase order');
 if(o.kind==='receipt'){if(o.orderNumber!==''||!hex(o.receipt?.hash)||!Number.isSafeInteger(o.receipt?.record)||o.receipt.record<0||!text(o.receipt?.number,200)||!text(o.receipt?.merchant,500))throw Error('Invalid receipt purchase');}
 else if(o.kind&&o.kind!=='online'||!/^\d{4,15}$/.test(o.orderNumber))throw Error('Invalid online order reference');
 if(!Array.isArray(o.items)||!o.items.length||o.items.length>100||new Set(o.items.map(i=>i.line)).size!==o.items.length||o.items.some(i=>!Number.isSafeInteger(i.line)||i.line<1||!text(i.product)||!i.product||!text(i.color,200)||!text(i.size,100)||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>10000||i.lineTotal!==null&&(!Number.isSafeInteger(i.lineTotal)||i.lineTotal<0)))throw Error('Invalid order items');
 if(!Array.isArray(o.inventoryLinks)||o.inventoryLinks.length>1000)throw Error('Invalid inventory links');
 const ids=new Set(),counts=new Map();
 for(const link of o.inventoryLinks){
  const item=o.items.find(i=>i.line===link.itemLine);
  if(!item||!text(link.inventoryId,100)||!link.inventoryId.trim()||ids.has(link.inventoryId)||link.quantity!==1||!['matched','candidate'].includes(link.status)||!coordinates(link.source)||!Array.isArray(link.shipments)||link.shipments.length>100||link.shipments.some(s=>s.inventoryId!==link.inventoryId||!text(s.date,40)||!text(s.tracking,100)||!text(s.status,100)||!coordinates(s.source)))throw Error('Invalid inventory evidence');
  ids.add(link.inventoryId);counts.set(item.line,(counts.get(item.line)||0)+1);if(counts.get(item.line)>item.quantity)throw Error('Inventory exceeds purchased quantity');
 }
 return o;
}
export function purchaseCandidates(research,payment){
 if(!research||!['ready','applied'].includes(research.state)||research.context?.key!==payment.key||research.context?.sourceHash!==payment.sourceHash||String(research.accountId)!==payment.source.account.id)return [];
 const sources=research.sources||[],groups=new Map();
 for(const source of sources){
  if(source.kind!=='search'||source.url!==historyUrl||hash(source.text)!==source.hash)continue;
  let raw;try{raw=JSON.parse(source.text)}catch{continue}
  if(raw.searchType!=='issey_order_detail'||raw.connectionVersion!==1)continue;
  try{
   validatePurchaseOrder(raw);
   const offset=(Date.parse(raw.date)-Date.parse(payment.source.purchaseDate))/86400000;
   if(!Number.isInteger(offset)||Math.abs(offset)>7)continue;
   const original=raw.original;
   if(!original||!Number.isSafeInteger(raw.fileCount)||raw.fileCount<1||raw.fileCount>20||!Number.isSafeInteger(original.part)||original.part<1||original.part>raw.fileCount||!hex(original.sha256))continue;
   const doc=sources.find(s=>s.id===original.sourceId&&s.kind==='document'&&s.url===historyUrl&&hash(s.text)===s.hash);
   const artifact=(research.artifacts||[]).find(a=>a.requestId===research.requestId&&a.sourceId===original.sourceId&&a.hash===original.sha256&&a.size===original.bytes&&a.mimeType==='image/png'&&hex(a.id));
   if(!doc||!artifact)continue;
   const order={archiveId:raw.archiveId,orderNumber:raw.orderNumber,date:raw.date,total:raw.total,currency:raw.currency,cancelled:false,dataQuality:'complete',capturedAt:raw.capturedAt,items:raw.items,inventoryLinks:raw.inventoryLinks,inventorySource:raw.inventorySource||null,sourceUrl:historyUrl};
   const orderHash=hash(JSON.stringify(order)),existing=groups.get(raw.archiveId);
   if(existing&&(existing.orderHash!==orderHash||existing.fileCount!==raw.fileCount)){existing.invalid=true;continue}
   const group=existing||{order,orderHash,fileCount:raw.fileCount,originals:[],evidence:[],dateOffsetDays:offset,amountMatches:raw.total===payment.source.amount};
   const prior=group.originals.find(a=>a.part===original.part);if(prior&&prior.hash!==artifact.hash){group.invalid=true;continue}
   if(!prior){group.originals.push({part:original.part,artifactId:artifact.id,sourceId:artifact.sourceId,hash:artifact.hash,size:artifact.size,name:artifact.name,mimeType:artifact.mimeType});group.evidence.push(source,doc)}
   groups.set(raw.archiveId,group);
  }catch{continue}
 }
 return [...groups.values()].filter(g=>!g.invalid).map(g=>{
  if([...groups.values()].filter(other=>other.order.orderNumber===g.order.orderNumber).length===1){const inventory=sheetInventory(g.order,sources);g.order.inventoryLinks=inventory.links;g.evidence.push(...inventory.evidence)}
  validatePurchaseOrder(g.order);g.orderHash=hash(JSON.stringify(g.order));
  g.originals.sort((a,b)=>a.part-b.part);
  const candidateHash=hash(JSON.stringify([g.orderHash,g.fileCount,g.originals,research.requestId]));
  return {...g,candidateHash,documentsComplete:g.originals.length===g.fileCount,requiresInventoryReview:g.order.inventoryLinks.some(i=>i.requiresReview),inventoryCount:g.order.inventoryLinks.length,itemCount:g.order.items.reduce((n,i)=>n+i.quantity,0)};
 }).sort((a,b)=>Number(b.amountMatches)-Number(a.amountMatches)||Math.abs(a.dateOffsetDays)-Math.abs(b.dateOffsetDays)||a.order.archiveId.localeCompare(b.order.archiveId));
}

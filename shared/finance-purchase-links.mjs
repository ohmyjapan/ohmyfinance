// Build reviewable connections only from captured worker evidence, never browser-supplied orders.
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,max=500)=>typeof v==='string'&&v.length<=max;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const historyUrl='https://www.isseymiyake.com/pages/orders';
function coordinates(s){return s&&text(s.sheet,100)&&s.sheet&&Number.isSafeInteger(s.row)&&s.row>0&&text(s.inventoryCell,30)&&/^[A-Z]+[1-9]\d*$/.test(s.inventoryCell)}
export function validatePurchaseOrder(o){
 if(!o||!hex(o.archiveId)||!/^\d{4,15}$/.test(o.orderNumber)||!date(o.date)||o.currency!=='JPY'||!Number.isSafeInteger(o.total)||o.total<=0||o.cancelled!==false||o.dataQuality!=='complete'||!Number.isFinite(Date.parse(o.capturedAt)))throw Error('Invalid purchase order');
 if(!Array.isArray(o.items)||!o.items.length||o.items.length>100||new Set(o.items.map(i=>i.line)).size!==o.items.length||o.items.some(i=>!Number.isSafeInteger(i.line)||i.line<1||!text(i.product)||!i.product||!text(i.color,200)||!text(i.size,100)||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>10000||i.lineTotal!==null&&(!Number.isSafeInteger(i.lineTotal)||i.lineTotal<0)))throw Error('Invalid order items');
 if(!Array.isArray(o.inventoryLinks)||o.inventoryLinks.length>1000)throw Error('Invalid inventory links');
 const ids=new Set(),counts=new Map();
 for(const link of o.inventoryLinks){
  const item=o.items.find(i=>i.line===link.itemLine);
  if(!item||!text(link.inventoryId,100)||!link.inventoryId.trim()||ids.has(link.inventoryId)||link.quantity!==1||link.status!=='matched'||!coordinates(link.source)||!Array.isArray(link.shipments)||link.shipments.length>100||link.shipments.some(s=>s.inventoryId!==link.inventoryId||!text(s.date,40)||!text(s.tracking,100)||!text(s.status,100)||!coordinates(s.source)))throw Error('Invalid inventory evidence');
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
  g.originals.sort((a,b)=>a.part-b.part);
  const candidateHash=hash(JSON.stringify([g.orderHash,g.fileCount,g.originals,research.requestId]));
  return {...g,candidateHash,documentsComplete:g.originals.length===g.fileCount,inventoryCount:g.order.inventoryLinks.length,itemCount:g.order.items.reduce((n,i)=>n+i.quantity,0)};
 }).sort((a,b)=>Number(b.amountMatches)-Number(a.amountMatches)||Math.abs(a.dateOffsetDays)-Math.abs(b.dateOffsetDays)||a.order.archiveId.localeCompare(b.order.archiveId));
}

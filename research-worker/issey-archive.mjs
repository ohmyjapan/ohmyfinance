import {createHash} from 'node:crypto';

export const isseyArchiveContract='For an ISSEY MIYAKE purchase, search_issey_orders can search the authorized private order-history archive around the card purchase date. Read a relevant original screenshot with read_issey_order before asking the owner to supply an order record already available there. The archive records order dates, item variants, quantities and totals, but not the payment card. Even an exact date/amount match is only a candidate association; never infer a payment card or customer from this archive. Exclude cancelled and incomplete orders from purchase matching, distinguish order total from per-item prices, and preserve quantities. Order-history screenshots are not merchant-issued tax invoices or proof of invoice registration. A tax amount divided by a subtotal is not a printed tax percentage. Keep the existing printed-percentage requirement. Missing or unlinked inventory/shipping evidence never proves an item was not shipped.';
const hash=v=>createHash('sha256').update(v).digest('hex'),uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const ISSEY_HISTORY_URL='https://www.isseymiyake.com/pages/orders';
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export class IsseyArchive {
 constructor(config,context,{fetchImpl=fetch}={}){
  const c=config.isseyArchive;
  if(!c?.baseUrl||!c.token||!Array.isArray(c.accountIds)||!c.accountIds.length||c.accountIds.length>20||c.accountIds.some(id=>!uuid.test(id))||new Set(c.accountIds).size!==c.accountIds.length)throw Error('Issey order archive is not configured');
  if(!Array.isArray(c.financialAccountIds)||!c.financialAccountIds.length||c.financialAccountIds.length>30||c.financialAccountIds.some(id=>!/^[a-f0-9]{24}$/.test(id))||!c.financialAccountIds.includes(context.source?.account?.id))throw Error('Issey order archive is unavailable for this financial account');
  const origin=new URL(c.baseUrl),host=origin.hostname,parts=host.split('.').map(Number),tailscale=parts.length===4&&parts[0]===100&&parts[1]>=64&&parts[1]<=127&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!(['127.0.0.1','localhost'].includes(host)||tailscale)||typeof c.token!=='string'||c.token.length<32||c.token.length>200)throw Error('Invalid private order archive connection');
  if(!validDate(context.source.purchaseDate))throw Error('A valid purchase date is required for order research');
  this.config=c;this.origin=origin.origin;this.fetch=fetchImpl;this.context=context;this.searched=new Map();
 }
 async request(route,{image=false}={}){
  const r=await this.fetch(this.origin+route,{method:'GET',headers:{Authorization:'Bearer '+this.config.token},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Issey order archive returned HTTP '+r.status);
  if(!(image?/^image\/png(?:;|$)/i:/^application\/json(?:;|$)/i).test(r.headers.get('content-type')||''))throw Error('Invalid order archive response type');
  const max=image?10*1024*1024:8*1024*1024,chunks=[];let length=0;
  if(Number(r.headers.get('content-length'))>max){await r.body?.cancel();throw Error('Order archive response too large')}
  for await(const chunk of r.body){length+=chunk.length;if(length>max)throw Error('Order archive response too large');chunks.push(Buffer.from(chunk))}
  const bytes=Buffer.concat(chunks);return image?bytes:JSON.parse(bytes.toString('utf8'));
 }
 validateOrder(order,account){
  if(!order||order.accountId!==account||!/^\d{4,15}$/.test(order.orderNumber||'')||order.id!==hash(account+':'+order.orderNumber)||order.captureVersion!==2||!validDate(order.date)||order.sourceUrl!==ISSEY_HISTORY_URL||!Number.isFinite(Date.parse(order.capturedAt))||order.currency!=='JPY'||typeof order.cancelled!=='boolean'||!['complete','incomplete'].includes(order.dataQuality))throw Error('Invalid archived order identity');
  if(order.total!==null&&(!Number.isSafeInteger(order.total)||order.total<0&&!order.cancelled)||!Array.isArray(order.items)||order.items.length>100||!Array.isArray(order.amounts)||order.amounts.length>30||!Array.isArray(order.inventoryLinks)||order.inventoryLinks.length>1000)throw Error('Invalid archived order detail');
  if(!Array.isArray(order.files)||!order.files.length||order.files.length>20||order.files.some((f,i)=>f.part!==i+1||!/^[a-f0-9]{64}$/.test(f.sha256||'')||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>10*1024*1024))throw Error('Invalid archived order images');
  if(order.dataQuality==='complete'&&(!order.items.length||order.total===null||order.items.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<=0||typeof i.product!=='string'||!i.product.trim()||typeof i.color!=='string'||typeof i.size!=='string'||i.lineTotal!==null&&(!Number.isSafeInteger(i.lineTotal)||i.lineTotal<0&&!order.cancelled))))throw Error('Incomplete archived order marked complete');
  return order;
 }
 async catalog(){
  const orders=[],runs=[],seen=new Set();let bytes=0;
  for(const account of this.config.accountIds){
   let total;
   for(let offset=0;;){
    const page=await this.request('/v1/orders?account='+encodeURIComponent(account)+'&offset='+offset+'&limit=500');
    if(page.schemaVersion!==1||!Number.isSafeInteger(page.total)||page.total<0||page.total>10000||!Array.isArray(page.orders)||page.orders.length>500||!Array.isArray(page.runs)||total!==undefined&&total!==page.total)throw Error('Order archive pagination changed or is invalid');
    total=page.total;if(offset+page.orders.length>total||!page.orders.length&&offset<total)throw Error('Order archive pagination is incomplete');
    for(const value of page.orders){const o=this.validateOrder(value,account);if(seen.has(o.id))throw Error('Duplicate archived order');bytes+=Buffer.byteLength(JSON.stringify(o));if(orders.length>=10000||bytes>25000000)throw Error('Order archive catalog exceeds the research limit');seen.add(o.id);orders.push(o)}
    if(!offset)runs.push({accountId:account,state:page.runs.at(-1)?.state||'unknown',capturedAt:page.runs.at(-1)?.finishedAt||null});
    offset+=page.orders.length;if(offset===total)break;
   }
  }
  return {orders,runs};
 }
 async search(){
  this.snapshot ||= this.catalog().catch(e=>{this.snapshot=null;throw e});
  const {orders,runs}=await this.snapshot,day=Date.parse(this.context.source.purchaseDate),amount=this.context.source.amount;
  const matching=orders.filter(o=>Math.abs(Date.parse(o.date)-day)<=7*86400000).sort((a,b)=>Number(b.total===amount)-Number(a.total===amount)||Math.abs(Date.parse(a.date)-day)-Math.abs(Date.parse(b.date)-day)||a.id.localeCompare(b.id));
  const result={searchType:'issey_order_archive',coverage:{dateWindow:{from:new Date(day-7*86400000).toISOString().slice(0,10),through:new Date(day+7*86400000).toISOString().slice(0,10)},matchCount:matching.length,returnedCount:0,absenceProven:false,runs,limitations:['Only configured store accounts and the purchase-date window are searched. This is a dated archive, not a current store status check.','Payment card is not recorded. Date and amount agreement does not prove the card-to-order association.','Cancelled or incomplete orders are not eligible purchase matches. Order-history screenshots are not tax invoices.','No inventory/shipment link means no linked evidence, not an unshipped item.']},orders:[]};
  for(const o of matching.slice(0,25)){
   const value={id:o.id,accountName:o.accountName,orderNumber:o.orderNumber,date:o.date,total:o.total,currency:o.currency,status:o.status,cancelled:o.cancelled,dataQuality:o.dataQuality,eligibleCandidate:!o.cancelled&&o.dataQuality==='complete',paymentCardVerified:false,amountMatchesCardRow:o.total===amount,dateOffsetDays:(Date.parse(o.date)-day)/86400000,items:o.items,amounts:o.amounts,inventoryLinkCount:o.inventoryLinks.length,imageParts:o.files.length};
   result.orders.push(value);if(JSON.stringify(result).length>24000){result.orders.pop();if(!result.orders.length)throw Error('Archived order metadata exceeds the research limit');break}
  }
  result.coverage.returnedCount=result.orders.length;result.coverage.truncated=result.orders.length<matching.length;
  if(result.coverage.truncated)result.coverage.limitations.push('Some matching orders were omitted from this result; the archive search is not exhaustive.');
  for(const value of result.orders)this.searched.set(value.id,matching.find(o=>o.id===value.id));
  return result;
 }
 async image(id,part){
  const original=this.searched.get(id);if(!original)throw Error('Search the authorized order archive first');
  if(!Number.isSafeInteger(part)||part<1||part>original.files.length)throw Error('Unknown order screenshot part');
  const current=this.validateOrder(await this.request('/v1/orders/'+id),original.accountId);
  if(JSON.stringify(current)!==JSON.stringify(original))throw Error('Archived order changed; start a fresh research job');
  const bytes=await this.request('/v1/orders/'+id+'/files/'+part,{image:true}),file=original.files[part-1];
  if(bytes.length!==file.bytes||hash(bytes)!==file.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Archived order screenshot integrity check failed');
  return {bytes,order:original,part};
 }
}

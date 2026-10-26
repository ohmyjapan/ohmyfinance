// Transaction export recipe shared by the transactions page, the export route and the Navi conversation card: the list route's filter
// set as typed criteria, the page's search predicate, and the whitelisted query map the browser sends to the existing export route.
// No Node imports: the page bundle loads it too. Never builds a URL.
const str=(max,extra={})=>({type:'string',maxLength:max,...extra}),num=(extra={})=>({type:'number',...extra});
const date={type:'string',format:'date'},objectId={type:'string',pattern:'^[a-fA-F0-9]{24}$'};
const EXPENSE='支出',INCOME='入金';
export const exportFormats=Object.freeze(['csv','json']);
// The tool's criteria: one property per export filter (the strict validator in finance-navi-business.mjs enforces it exactly).
export const exportCriteriaProperties=Object.freeze({
 status:{type:'string',enum:['completed','pending','processing','failed','refunded','cancelled']},
 type:{type:'string',enum:[EXPENSE,INCOME]},
 dateFrom:date,dateTo:date,
 minAmount:num({minimum:0}),maxAmount:num({minimum:0}),
 search:str(100),
 hasReceipt:{type:'boolean'},
 customerId:objectId,supplierId:objectId,accountCategoryId:objectId,transactionCategoryId:objectId
});
export const exportCriteriaKeys=Object.freeze(Object.keys(exportCriteriaProperties));
const numberKeys=['minAmount','maxAmount'];

// The transactions page's search predicate (composables/useTransactions.ts): id, reference, product, invoice, company text and the
// amount's digits, case-insensitive. An empty query matches every row, as the page applies no search then.
export function exportSearchMatches(row,query){
 if(!row||typeof row!=='object')return false;
 if(typeof query!=='string'||!query)return true;
 const q=query.toLowerCase(),id=row.id??row._id;
 if(id!==undefined&&id!==null&&String(id).toLowerCase().includes(q))return true;
 for(const key of['referenceNumber','productName','invoiceNumber','companyInfo'])if(typeof row[key]==='string'&&row[key].toLowerCase().includes(q))return true;
 return row.amount!==undefined&&row.amount!==null&&String(row.amount).includes(q);
}

// A route query -> typed criteria: only the export filter keys, the first value of a repeated key, finite numbers, hasReceipt only as
// the literal 'true'/'false' (the list route's meaning), empty strings dropped.
export function exportCriteriaFromQuery(query){
 const out={};if(!query||typeof query!=='object')return out;
 for(const key of exportCriteriaKeys){
  const raw=Array.isArray(query[key])?query[key][0]:query[key];
  if(raw===undefined||raw===null||raw==='')continue;
  if(key==='hasReceipt'){if(raw==='true'||raw===true)out.hasReceipt=true;else if(raw==='false'||raw===false)out.hasReceipt=false;continue}
  if(numberKeys.includes(key)){const n=typeof raw==='number'?raw:Number(String(raw));if(Number.isFinite(n))out[key]=n;continue}
  if(typeof raw==='string')out[key]=raw;
 }
 return out;
}

// Criteria -> the query map for the existing export route: whitelisted keys only, every value a string, format csv|json. Never a URL.
export function exportQueryFromCriteria(criteria,format){
 const out={format:exportFormats.includes(format)?format:'csv'};
 if(!criteria||typeof criteria!=='object')return out;
 for(const key of exportCriteriaKeys){
  const v=criteria[key];if(v===undefined||v===null||v==='')continue;
  if(key==='hasReceipt'){if(typeof v==='boolean')out.hasReceipt=v?'true':'false';continue}
  if(numberKeys.includes(key)){if(typeof v==='number'&&Number.isFinite(v))out[key]=String(v);continue}
  if(typeof v==='string')out[key]=v;
 }
 return out;
}

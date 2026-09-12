const routeLabels = {
 business_orders_and_ships_requested_items:'あなたが顧客の希望する商品を購入し、発送する',
 customer_shop_account_business_card:'顧客が自分のショップアカウントで注文し、あなたの会社のカードで支払う'
};
const text = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
// These are current customer-level facts, never row assignments or accounting rules.
// The caller must scope records to the authenticated owner before using this serializer.
export function customerPurchaseContexts(records, customers, customerId) {
 const active = new Map((customers || []).filter(c=>c.isActive!==false).map(c=>[String(c._id || c.id),c]));
 const selected = (records || []).filter(r=>r.kind==='purchase_workflow' && r.scope==='current_workflow' && r.status==='confirmed' && active.has(String(r.customerId)) && (customerId===undefined || String(r.customerId)===customerId));
 return selected.filter(r=>selected.filter(x=>String(x.customerId)===String(r.customerId)).length===1 && Number.isSafeInteger(r.revision) && r.revision>0 && text(r.sourceQuote,2000) && text(r.sourceQuestion,2000) && Number.isFinite(Date.parse(r.confirmedAt)) && Array.isArray(r.routes) && r.routes.length>0 && r.routes.length<=2 && new Set(r.routes).size===r.routes.length && r.routes.every(route=>Object.hasOwn(routeLabels,route))).slice(0,30).map(r=>({
  id:String(r._id || r.id),revision:r.revision,customerId:String(r.customerId),customerName:active.get(String(r.customerId)).name,
  confirmedAt:new Date(r.confirmedAt).toISOString(),routes:r.routes.map(key=>({key,label:routeLabels[key]})),
  sourceQuestion:r.sourceQuestion,sourceQuote:r.sourceQuote,
  scope:'現在の購入方法についての説明です。この明細の注文者・注文アカウント・購入品・勘定科目・税処理を確定するものではありません。'
 }));
}

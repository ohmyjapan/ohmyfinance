import { normalizeMerchant, sameValue } from './finance-draft.mjs';
const known = c => c?.purpose === 'company' || (c?.purpose === 'customer' && !!c.customerId);
const assignment = c => ({purpose:c.purpose, customerId:c.purpose==='customer'?c.customerId:''});
const identity = c => JSON.stringify(assignment(c));
const result = (c, grade, reason, extra={}) => ({values:assignment(c),grade,reason,...extra});
export function historicalAnswer(history, amount) {
  if (history.length < 5) return null;
  const groups = new Map();
  for (const row of history) {
    const key = known(row) ? identity(row) : normalizeMerchant(row.customerLabel || '');
    if (!key) continue;
    const g=groups.get(key)||{...row,count:0};g.count++;groups.set(key,g);
  }
  if (groups.size!==1) return null;
  const candidate=[...groups.values()][0];
  if (!known(candidate) || candidate.count/history.length < .9) return null;
  const amounts=history.map(r=>r.amount).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b), median=amounts[Math.floor(amounts.length/2)];
  if (median && Number.isFinite(amount) && (amount>median*3 || amount<median/3)) return null;
  return result(candidate,'B',`同じ口座・利用先の購入日より前の${history.length}件中${candidate.count}件が一致。`,{source:'learning_history',count:candidate.count,total:history.length});
}
export function ruleAnswer(rules) {
  if (!rules.length) return null;
  if (rules.some(r=>!known(r.decision))) return null;
  if (new Set(rules.map(r=>identity(r.decision))).size!==1) return {conflict:true,reason:'確認済みのルール同士で顧客・用途が異なります。',rules};
  return result(rules[0].decision,'A',rules.map(r=>r.decision.note || r.reason).filter(Boolean).join(' / '),{source:'learning_rule',rules:rules.map(r=>({id:r.id,kind:r.kind || 'pattern',revision:r.revision})),effectiveFrom:rules[0].decision.effectiveFrom || ''});
}
export function patternAnswer(pattern, policies=[], activeCustomers=[]) {
  if (pattern.status==='deferred') return {blocked:true,reason:'この条件の判断を保留しています。'};
  const valid=c=>known(c)&&(c.purpose!=='customer'||activeCustomers.includes(String(c.customerId)));
  const applicable=policies.filter(p=>p.status==='active'&&p.merchants.includes(pattern.merchant)&&(!p.accountIds.length||p.accountIds.map(String).includes(pattern.accountId))&&valid(p.decision));
  const rules=applicable.map(p=>({id:String(p._id),kind:'policy',revision:p.revision,decision:{...p.decision,note:p.reason,effectiveFrom:p.effectiveFrom || ''}}));
  if(pattern.status==='confirmed'&&valid(pattern.decision)) return ruleAnswer([{id:String(pattern._id),revision:pattern.revision,decision:pattern.decision}]);
  const answer=ruleAnswer(rules);if(answer)return answer;
  const labelled=pattern.customers.filter(c=>c.label?.trim());
  if(pattern.grade!=='B'||labelled.length!==1||!valid(labelled[0]))return null;
  return result(labelled[0],'B',`主台帳の${pattern.total}件中${labelled[0].count}件が同じ顧客・用途です。`,{source:'learning_history'});
}
export function applyClassification(values,evidence,answer) {
  if (!answer || answer.blocked) return;
  if (answer.conflict) {
    for(const key of ['purpose','customerId']) evidence[key]={...evidence[key],state:'conflict',reason:answer.reason,learningConflict:true};
    return;
  }
  const incoming=answer.values, currentKnown=values.purpose==='company'||(values.purpose==='customer'&&!!values.customerId);
  const origin={state:'suggested',source:answer.source,grade:answer.grade,reason:answer.reason,rules:answer.rules || [],classification:incoming};
  if ((currentKnown&&!sameValue(assignment(values),incoming)) || (values.purpose!=='unresolved'&&values.purpose!==incoming.purpose)) {
    for(const key of ['purpose','customerId']) evidence[key]={...evidence[key],state:'conflict',alternative:incoming[key],alternativeEvidence:origin,reason:'今回の元資料と学習した顧客・用途が異なります。',learningConflict:true};
    return;
  }
  for(const key of ['purpose','customerId']) {
    if (values[key]===incoming[key] && evidence[key]?.source==='spreadsheet') continue;
    values[key]=incoming[key]; evidence[key]={...origin};
  }
}
export function purchaseQuestions(draft) {
  const v=draft.values,e=draft.evidence || {},customers=draft.references?.customers || [];
  const customer=customers.find(c=>String(c._id || c.id)===v.customerId)?.name || '지정된 고객';
  const answered=[],openFields=[];
  const conflict=['purpose','customerId'].find(k=>e[k]?.state==='conflict');
  const productKnown=!!v.productName?.trim() || !!v.janCode?.trim() || (v.items?.length>0 && v.items.every(i=>i.productName?.trim()||i.janCode?.trim()));
  const validCustomer=!!v.customerId&&(!draft.references||customers.some(c=>String(c._id || c.id)===v.customerId));
  if(!conflict&&(v.purpose==='customer'||v.purpose==='company')) answered.push({field:'purpose',label:'用途',value:v.purpose==='customer'?'顧客購入':'会社経費',reason:e.purpose?.reason || '現在の下書き',grade:e.purpose?.grade || 'source'});
  if(!conflict&&v.purpose==='customer'&&validCustomer) answered.push({field:'customerId',label:'顧客',value:customer,reason:e.customerId?.reason || '現在の下書き',grade:e.customerId?.grade || 'source'});
  if(productKnown) answered.push({field:'productName',label:'購入内容',value:v.productName || (v.items?.length?`${v.items.length}件の商品明細`:v.janCode),reason:e.productName?.reason || '入力済みの商品情報',grade:'source'});
  let question='';
  if(conflict){openFields.push(conflict);question='이번 기록과 확인된 규칙의 고객·용도가 달라요. 이번 결제는 누구를 위한 구매였나요?';}
  else if(v.purpose==='unresolved'||!v.purpose){openFields.push('purpose');question='이 결제는 고객 요청 구매였나요, 회사에서 사용할 물건·서비스였나요? 개인 용도였다면 그렇게 알려주세요.';}
  else if(v.purpose==='customer'&&!validCustomer){openFields.push('customerId');question='고객 요청 구매로 확인됐어요. 어느 고객의 요청이었나요?';}
  if(!productKnown){openFields.push('productName');if(!question)question=v.purpose==='customer'?`${customer}의 구매로 분류했어요. 어떤 상품을 구매했는지만 알려주세요.`:'회사 사용으로 분류했어요. 어떤 물건이나 서비스였는지만 알려주세요.';}
  return {answered,openFields:[...new Set(openFields)],question,needsQuestion:!!question};
}

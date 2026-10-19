// Matching proposes evidence; only the owner's confirmation creates an allocation. Portable browser/Node module.
export const BANK_FIELDS=[['date','取引日',['取引日','日付','取扱日','date']],['description','摘要',['摘要','取引内容','内容','description','merchant']],['amount','金額',['金額','amount']],['outflow','出金',['出金','出金額','お支払金額','withdrawal','debit']],['inflow','入金',['入金','入金額','お預り金額','deposit','credit']],['balance','残高',['残高','差引残高','balance']],['reference','メモ・参照番号',['メモ','参照番号','reference','memo']],['transactionId','銀行の取引ID（任意）',['取引番号','明細番号','取引id','transactionid','transaction_id']],['currency','通貨',['通貨','currency']],['direction','入出金区分',['入出金区分','区分','direction']]];
// Web banks a bank account can be connected to: [key, label, support]. `support` stays 'contract-pending' until a release ships
// the recorded portal contract and adapter for that bank; only a 'verified' provider runs automatic retrieval, the others run
// the preparatory observe stage (plan omf-bank-collection-amended-20261018 S7). No provider is verified by this build.
export const BANK_PROVIDERS=[['rakuten','楽天銀行','contract-pending'],['paypay','PayPay銀行','contract-pending'],['resona','りそな銀行','contract-pending']];
// The login variants a provider offers (plan omf-rakuten-bank-connector-amended-20261019 R6): [key, label] per provider; a
// provider absent here has none. The connection stores the chosen key (else null), the job snapshot freezes it, and the
// adapter's `starts[variant]` is the matching official login link.
export const BANK_LOGIN_VARIANTS={rakuten:[['standard','標準ログイン（法人ビジネス口座）'],['plus','口座管理プラス']]};
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const text=v=>String(v??'').normalize('NFKC').trim(),norm=v=>text(v).toLowerCase().replace(/\s+/g,' ');
export function money(v){if(v===null||v===undefined||text(v)==='')return null;const s=text(v).replace(/[¥￥,$\s]/g,'');if(!/^-?\d+(?:\.\d{1,2})?$/.test(s)||!Number.isFinite(Number(s))||Math.abs(Number(s))>1e12)throw Error('金額を確認してください。');return Number(s);}
const sha=async s=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
function dateOf(v){const s=text(v).replace(/年|\//g,'-').replace(/月/g,'-').replace(/日/g,'');const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);if(!m)throw Error('取引日を確認してください。');const d=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');if(!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('取引日を確認してください。');return d;}
export function guessBankMapping(headers){return Object.fromEntries(BANK_FIELDS.map(([k,,names])=>{const i=headers.findIndex(h=>names.some(n=>norm(n)===norm(h)));return[k,i<0?'':String(i)];}));}
export async function bankRowKey(row,source){if(text(row.transactionId))return 'id:'+text(row.transactionId);if(!/^[a-f0-9]{64}$/.test(source?.hash)||typeof source.sheet!=='string'||!Number.isSafeInteger(source.row)||source.row<1)throw Error('元ファイルの行を確認できません。');return 'file:' + source.hash + ':' + encodeURIComponent(source.sheet) + ':' + source.row;}
export const BANK_AMOUNT_SIGNS=[['outflow-positive','出金がプラス・入金がマイナス'],['outflow-negative','出金がマイナス・入金がプラス']];
export async function normalizeBankRow(values,source,options={}){
 const out=money(values.outflow),incoming=money(values.inflow),signed=money(values.amount);let amount=signed;
 if(out!==null||incoming!==null){if((out??0)<0||(incoming??0)<0||out&&incoming)throw Error('出金・入金の列を確認してください。');amount=round((out??0)-(incoming??0));}
 if(amount===null)throw Error('金額の列を割り当ててください。');
 if(signed!==null&&out===null&&incoming===null){const direction=text(values.direction);amount=/^(入金|in|credit)$/i.test(direction)?-Math.abs(signed):/^(出金|out|debit)$/i.test(direction)?Math.abs(signed):signed*(options.amountSign==='outflow-negative'?-1:1);}
 const r={date:dateOf(values.date),description:text(values.description),reference:text(values.reference),transactionId:text(values.transactionId),currency:text(values.currency||'JPY').toUpperCase(),amount,direction:amount<0?'in':'out',balance:money(values.balance)};
 if(r.description.length>2000||r.reference.length>1000||r.transactionId.length>300||!r.description||!/^[A-Z]{3}$/.test(r.currency))throw Error('摘要・通貨・取引IDを確認してください。');
 r.fingerprint=await sha(JSON.stringify([r.date,r.direction,String(r.amount),r.description.replace(/\s+/g,' '),r.reference]));r.key=await bankRowKey(r,source);r.idKind=r.transactionId?'bank-id':'file-row';return r;
}
const vals=r=>r?.values||r||{},rid=r=>String(r.id||r._id||''),days=(a,b)=>a&&b?Math.abs(Date.parse(a)-Date.parse(b))/86400000:Infinity;
export function paymentCandidates(payment,records){const result=[];for(const record of records){if(record.archived)continue;const v=vals(record),hay=norm(payment.description+' '+(payment.reference||'')),reasons=[];
 const reference=[v.orderId,v.externalOrderId,v.itemId].some(s=>text(s).length>=4&&hay.includes(norm(s))),different=(payment.currency||'JPY')!==(v.currency||'JPY');
 let total=null;try{total=money(v.amount)}catch{}const amount=!different&&total!==null&&Math.abs(total)===Math.abs(payment.amount),date=days(payment.date,v.purchaseDate)<=7;
 let host='';try{host=new URL(v.merchantUrl).hostname.replace(/^www\./,'')}catch{}
 const merchant=[v.merchant,v.supplierName,host].some(s=>norm(s).length>=3&&hay.includes(norm(s)));
 if(reference)reasons.push('reference');if(amount)reasons.push('amount');if(date)reasons.push('date');if(merchant)reasons.push('merchant');if(different)reasons.push('currency-differs');
 if(!reference&&!amount&&!merchant)continue;
 const rank=different?'manual':reference&&amount?'strong':reference ? 'likely' : amount && date && merchant ? 'likely' : 'ambiguous';
 result.push({record:{...record,id:rid(record)},target:{kind:'intake',recordId:rid(record),recordKey:record.key},reasons,rank,label:rank==='ambiguous'?(amount?'金額のみ一致':'購入先の候補・金額は要確認'):rank==='manual'?'通貨が異なります・手動確認':rank==='strong'?'注文番号と金額が一致':'照合候補'});
 }return result.sort((a,b)=>['strong','likely','ambiguous','manual'].indexOf(a.rank)-['strong','likely','ambiguous','manual'].indexOf(b.rank));}
export function residuals(payment){const linked=(payment.allocations||[]).filter(a=>a.status==='linked'),otherCurrency=linked.filter(a=>(a.currency||'JPY')!==(payment.currency||'JPY')),allocated=round(linked.filter(a=>(a.currency||'JPY')===(payment.currency||'JPY')).reduce((n,a)=>n+Number(a.amount),0)),remaining=round(payment.amount-allocated);return{allocated,remaining,state:otherCurrency.length||Math.abs(allocated)>Math.abs(payment.amount)?'review':remaining===0?'matched':allocated===0?'unmatched':'partial'};}
export function recordTotals(record,allocations){const v=vals(record),currency=v.currency||'JPY';let total=null;try{total=money(v.amount)}catch{}let paid=0,refunded=0;const otherCurrency=[];
 for(const a of allocations){if(a.status!=='linked')continue;const different=(a.currency||'JPY')!==currency;
  if (different && (a.recordAmount == null || a.recordCurrency && a.recordCurrency!==currency)){otherCurrency.push({id:a.id,amount:a.amount,currency:a.currency,target:a.target});continue;}
  const amount=different?Number(a.recordAmount??a.amount):Number(a.amount);if(amount>=0)paid=round(paid+amount);else refunded=round(refunded-amount);
 }const net=round(paid-refunded),remaining=total===null?null:round(total-net);return{total,currency,paid,refunded,net,remaining,otherCurrency,state:remaining===null?'unknown':remaining < 0 ? 'overpaid':remaining===0?'settled':net?'partial':'unpaid'};}
export function changedSince(snapshot,current){return ['amount','itemPrice','tax','shippingFee','otherFee','currency','supplierName','invoiceNumber'].filter(k=>(snapshot?.[k]??'')!==(current?.[k]??'')).map(field=>({field,before:snapshot?.[field]??'',after:current?.[field]??''}));}
export function correctionPairs(existing,incoming){const pairs=[];for(const row of incoming)for(const old of existing){if(old.key===row.key||old.state==='superseded'||old.date!==row.date||old.direction!==row.direction||old.amount!==row.amount||old.currency!==row.currency)continue;if(old.idKind==='bank-id'&&row.idKind==='bank-id')continue;if(old.idKind==='file-row'&&row.idKind==='file-row'&&old.key.split(':')[1]===row.key.split(':')[1])continue;pairs.push({oldId:rid(old),oldKey:old.key,newKey:row.key,newId:rid(row),kind:old.fingerprint===row.fingerprint?'duplicate':'correction',label:old.fingerprint===row.fingerprint?'重複の可能性':'訂正の可能性'});}return pairs;}
export function settlementCandidates(bank,cardRows,batches,bills){const result=[];if(bank.amount<=0)return result;
 for(const card of cardRows){if(card.sourceKind!=='repayment'||card.amount>=0||Math.abs(card.amount)!==bank.amount||(card.currency||'JPY')!==(bank.currency||'JPY')||days(card.date,bank.date)>5)continue;
  const periods=batches.filter(b=>String(b.accountId)===card.accountId&&b.period?.kind==='statement'&&b.period.end<card.date).sort((a,b)=>String(b.period.end).localeCompare(String(a.period.end)));
  result.push({target:{kind:'card-repayment',accountId:card.accountId,importId:card.importId,line:card.line,key:card.key},evidence:'repayment-row',rank:'strong',label:'カードの口座振替行と一致',amount:bank.amount,suggestedCoversImportId:periods[0]?String(periods[0]._id||periods[0].id):null});
 }
 for(const batch of batches){if(batch.period?.kind!=='statement')continue;const importId=String(batch._id||batch.id),accountId=String(batch.accountId),amountEqual=(bank.currency||'JPY')==='JPY'&&Number(batch.reconciliation?.statementTotal)===bank.amount,due=batch.reconciliation?.paymentDueDate||batch.period?.paymentDueDate,date=days(bank.date,due)<=10||!due;
  let evidence='manual';
  if (batch.provider === 'aplus' && amountEqual&&date)evidence='statement-total';
  const bill=batch.provider==='aplus'&&(bank.currency||'JPY')==='JPY'?bills.find(b=>String(b.source?.accountId)===accountId&&b.source?.periodKey===batch.period?.key&&(b.currency||'JPY')==='JPY'&&Number(b.amount)===bank.amount&&days(b.dueDate instanceof Date?b.dueDate.toISOString().slice(0,10):String(b.dueDate||'').slice(0,10),bank.date)<=10):null;
  if(bill)evidence='calendar-bill';
  result.push({target:{kind:'card-statement',accountId,importId,sourceHash:batch.hash,periodKey:batch.period.key,statementMonth:batch.period.statementMonth,...(bill?{paymentId:String(bill._id||bill.id)}:{})},evidence,rank:evidence==='manual'?'manual':'strong',label:evidence==='manual'?'対象の請求期間を手動で指定':'請求額と一致',amount:bank.amount});
 }return result;
}

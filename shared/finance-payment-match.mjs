// Matching proposes evidence; only the owner's confirmation creates an allocation. Portable browser/Node module.
export const BANK_FIELDS=[['date','取引日',['取引日','日付','取扱日','date']],['description','摘要',['摘要','取引内容','内容','入出金先内容','description','merchant']],['amount','金額',['金額','入出金(円)','amount']],['outflow','出金',['出金','出金額','お支払金額','withdrawal','debit']],['inflow','入金',['入金','入金額','お預り金額','deposit','credit']],['balance','残高',['残高','差引残高','残高(円)','balance']],['reference','メモ・参照番号',['メモ','参照番号','reference','memo']],['transactionId','銀行の取引ID（任意）',['取引番号','明細番号','取引id','transactionid','transaction_id']],['currency','通貨',['通貨','currency']],['direction','入出金区分',['入出金区分','区分','direction']]];
// Web banks a bank account can be connected to: [key, label, support]. `support` stays 'contract-pending' until a release ships
// the recorded portal contract and adapter for that bank; only a 'verified' provider runs automatic retrieval, the others run
// the preparatory observe stage (plan omf-bank-collection-amended-20261018 S7). No provider is verified by this build.
export const BANK_PROVIDERS=[['rakuten','楽天銀行','contract-pending'],['paypay','PayPay銀行','contract-pending'],['resona','りそな銀行','contract-pending'],['ikeda','池田泉州銀行','contract-pending']];
// The login variants a provider offers (plan omf-rakuten-bank-connector-amended-20261019 R6): [key, label] per provider; a
// provider absent here has none. The connection stores the chosen key (else null), the job snapshot freezes it, and the
// adapter's `starts[variant]` is the matching official login link.
// PayPay銀行 (plan omf-paypay-four-accounts-20261021): the public 標準ログイン (店番号・口座番号・ログインパスワード) and the separate BA-PLUS
// 専用ログイン; neither has a verified statement export.
export const BANK_LOGIN_VARIANTS={rakuten:[['standard','標準ログイン（法人ビジネス口座）'],['plus','口座管理プラス']],paypay:[['standard','標準ログイン（店番号・口座番号・ログインパスワード）'],['baplus','BA-PLUS専用ログイン（手動の観察取得）']],resona:[['direct','ビジネスダイレクトへ直接ログイン'],['idlink','ID連携ログイン（りそなグループID）']],ikeda:[['portal','池田泉州ビジネスゲート（法人ポータル）からログイン'],['direct','インターネットEBに直接ログイン']]};
// What the person must have in place for a bank whose login runs on installed software (plan omf-bank-software-compatibility-20261019
// S1): one note per such provider, shown under the connection selects. It explains the bank's 電子証明書発行アプリ and the issuing-Windows-
// user rule; it promises nothing about the certificate picker under the collector's launch and nothing about required or installed
// protections (PhishWall and the like) — those are checked in the actual connection environment (the observe run). A provider absent here has no note.
export const BANK_SOFTWARE={resona:'りそなビジネスダイレクトの電子証明書ログインは、りそな銀行の電子証明書発行アプリで発行し、このPCにサインインしているのと同じWindowsユーザーの証明書ストアに入っている電子証明書を使い、ログイン時の証明書の選択は本人がChromeの画面で行います。証明書の選択画面が表示されるか、および必要なセキュリティソフトや拡張機能の要否は、実際の接続環境（観察取得）で確認してください。',ikeda:'池田泉州銀行の電子証明書ログインは、同行の電子証明書発行アプリで電子証明書を発行したときと同じWindowsユーザーでこのPCにサインインしている必要があり、ログイン時の証明書の選択は本人がChromeの画面で行います。証明書の選択画面が表示されるか、およびPhishWallなどのセキュリティソフトや拡張機能の要否は、実際の接続環境（観察取得）で確認してください。'};
// Plan omf-rakuten-native-shiwake-20261020 §1/§3: the collection mode is per provider AND frozen login variant. The provider-wide
// support in BANK_PROVIDERS stays honest (every bank contract-pending); a variant listed here has an implemented retrieval path in
// the collector (collector/banks/<provider>.mjs `variants`). Implemented steps are not a successful connection test: liveVerified
// stays false until an owner-run job proves the connection. Every other provider/variant keeps the preparatory observe stage.
export const BANK_VARIANT_COLLECTION={rakuten:{standard:'retrieve'}};
export function bankCollectionMode(provider,variant){if(BANK_PROVIDERS.find(p=>p[0]===provider)?.[2]==='verified')return 'retrieve';return BANK_VARIANT_COLLECTION[provider]?.[variant]==='retrieve'?'retrieve':'observe';}
// The bank's own statement format a retrieving variant downloads: OMF creates/reuses this owner template for the connection, so no
// CSV has to be uploaded first (楽天銀行 標準: the four observed columns, outflow negative, no bank transaction ID).
export const BANK_NATIVE_TEMPLATES={rakuten:{standard:{key:'rakuten-standard-native',name:'楽天銀行 標準フォーマット（自動）',headers:['取引日','入出金(円)','残高(円)','入出金先内容'],mapping:{date:'0',description:'3',amount:'1',outflow:'',inflow:'',balance:'2',reference:'',transactionId:'',currency:'',direction:''},amountSign:'outflow-negative'}}};
// Plan omf-paypay-four-accounts-20261021: a variant whose FIRST capture needs no uploaded file or template — its guided observe job
// freezes an explicit unmapped interpretation, the received CSV is kept as needs_review (mapping-required, no rows) and the owner maps it
// with the existing importer. Only PayPay銀行 標準 is listed; automatic collection stays contract-pending (bankCollectionMode: observe).
export const BANK_FIRST_CAPTURE={paypay:{standard:'unmapped'}};
export function bankFirstCapture(provider,variant){return BANK_FIRST_CAPTURE[provider]?.[variant]==='unmapped'?'unmapped':null;}
export function bankCapability(provider,variant){const mode=bankCollectionMode(provider,variant),template=BANK_NATIVE_TEMPLATES[provider]?.[variant]||null;return{mode,steps:mode==='retrieve'?'implemented':'contract-pending',template:template?template.key:null,period:mode==='retrieve'?'required':'portal',liveVerified:false};}
// The requested period of a connection: an explicit start date and an optional end date (null = the JST date when a job is queued);
// never after today, never reversed. frozenCoverage turns it into the concrete dates a job freezes in its snapshot.
export function jstToday(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
const isoDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function bankCoverageInput(input,today=jstToday()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('取得期間を確認してください。');
 const from=input.from,to=input.to===undefined||input.to===null||input.to===''?null:input.to;
 if(!isoDay(from)||from<'2000-01-01')throw Error('取得期間の開始日を確認してください。');
 if(to!==null&&!isoDay(to))throw Error('取得期間の終了日を確認してください。');
 if(from>today||to!==null&&to>today)throw Error('取得期間に今日より後の日付は指定できません。');
 if(to!==null&&from>to)throw Error('取得期間の開始日と終了日を確認してください。');
 return{from,to};
}
export function frozenCoverage(saved,today=jstToday()){const c=bankCoverageInput(saved,today);return{from:c.from,to:c.to??today};}
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const text=v=>String(v??'').normalize('NFKC').trim(),norm=v=>text(v).toLowerCase().replace(/\s+/g,' ');
export function money(v){if(v===null||v===undefined||text(v)==='')return null;const s=text(v).replace(/[¥￥,$\s]/g,'');if(!/^-?\d+(?:\.\d{1,2})?$/.test(s)||!Number.isFinite(Number(s))||Math.abs(Number(s))>1e12)throw Error('金額を確認してください。');return Number(s);}
const sha=async s=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
function dateOf(v){const s=text(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3').replace(/年|\//g,'-').replace(/月/g,'-').replace(/日/g,'');const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);if(!m)throw Error('取引日を確認してください。');const d=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');if(!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('取引日を確認してください。');return d;}
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
// Plan omf-monthly-reconciliation-20261020 F3: the state of a card repayment row (Amex 前回分口座振替金額) is derived from the
// bank side, because the row never carries allocations of its own. `settled` is the same-currency total of the linked bank
// `card-repayment` allocations that target this account and key, in the row's sign; `remaining` = amount − settled. The row's
// own `allocated` (always 0) is not rewritten, so the allocation write path is unchanged. A row already in review (source
// missing), an allocation in another currency, a changed or missing bank source and a settlement above the row amount are
// `review`; released links count for nothing. The caller passes only the bank payments it can see (its read scope).
export function repaymentSettlement(card,bankPayments){
 const currency=card.currency||'JPY',links=[];
 for(const x of bankPayments||[])for(const a of x.allocations||[])if(a.status==='linked'&&a.target?.kind==='card-repayment'&&a.target.accountId===card.accountId&&a.target.key===card.key)links.push({payment:x,allocation:a});
 const same=links.filter(l=>(l.allocation.currency||'JPY')===currency),paid=round(same.reduce((n,l)=>n+Number(l.allocation.amount),0)),settled=round(card.amount<0?-paid:paid),remaining=round(card.amount-settled);
 const flagged=same.length!==links.length||links.some(l=>l.payment.sourceMissing||l.allocation.sourceChanged||l.allocation.changed)||Math.abs(settled)>Math.abs(card.amount)+1e-6;
 return{settled,remaining,state: card.state === 'review' || flagged ? 'review':paid===0?'unmatched':remaining===0?'matched':'partial'};
}
// Plan omf-monthly-reconciliation-20261020 F2: one period's purchases with their payment state, from the record totals the
// matching context already derives. A valid purchase date outside from/to is left out; a blank or unparseable one is ALWAYS
// listed as 日付未確定 (with the original text), never dropped. Each record appears once. Archived and cancelled records stay,
// labelled. Amounts stay per record and currency, null stays null (an unknown total is never 0), and nothing is summed: the
// counts are numbers of records per payment state. The payment-state and purchase-state filters are separate.
export const PURCHASE_PAYMENT_STATES=['unknown','unpaid','partial','settled','overpaid'];
export const PURCHASE_REVIEW_STATES=['requested','purchased','cancelled','refunded','archived'];
export function purchaseDay(v){const s=text(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;}
export function purchaseReview(records,query={}){
 const from=purchaseDay(query.from),to=purchaseDay(query.to),wanted=v=>v&&v!=='all'?v:'',paymentState=wanted(query.paymentState),purchaseState=wanted(query.purchaseState),seen=new Set(),rows=[];
 for(const r of records||[]){const id=rid(r);if(!id||seen.has(id))continue;seen.add(id);const v=vals(r),date=purchaseDay(v.purchaseDate);
  if (date && (from && date < from || to && date > to)) continue;
  const t=r.totals||{total:null,currency:v.currency||'JPY',paid:0,refunded:0,net:0,remaining:null,otherCurrency:[],state:'unknown'},state=t.state||'unknown';
  if(paymentState&&state!==paymentState)continue;if(purchaseState&&(purchaseState==='archived'?!r.archived:v.purchaseState!==purchaseState))continue;
  const otherCurrency=(t.otherCurrency||[]).length,identityReview=!!r.identityReview,paymentChanged=!!r.paymentChanged;
  rows.push({id,key:r.key,revision:r.revision,values:v,archived:!!r.archived,purchaseDate:date,dateKnown:!!date,dateLabel:date||'日付未確定',rawDate:text(v.purchaseDate),purchaseState:v.purchaseState||'requested',paymentState:state,currency:t.currency||v.currency||'JPY',total: t.total, paid: t.paid, refunded: t.refunded, net: t.net, remaining: t.remaining,otherCurrency,identityReview,paymentChanged,review:state==='overpaid'||otherCurrency>0||identityReview||paymentChanged,evidence:r.evidence||null});
 }
 rows.sort((a,b)=>a.dateKnown!==b.dateKnown?(a.dateKnown?-1:1):String(a.purchaseDate||'').localeCompare(String(b.purchaseDate||''))||String(a.key||'').localeCompare(String(b.key||'')));
 const counts=Object.fromEntries(PURCHASE_PAYMENT_STATES.map(s=>[s,0]));for(const r of rows)counts[r.paymentState]=(counts[r.paymentState]||0)+1;
 return{rows,counts,undated:rows.filter(r=>!r.dateKnown).length};
}

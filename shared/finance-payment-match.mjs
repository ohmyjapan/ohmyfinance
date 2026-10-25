// Matching proposes evidence; only the owner's confirmation creates an allocation. Portable browser/Node module.
// Plan omf-paypay-split-dates-retry-20261022: a statement whose transaction date is three columns (PayPay銀行's actual export:
// 操作日(年), 操作日(月), 操作日(日)) maps them here instead of `date`. These optional keys are kept out of BANK_FIELDS so every mapping
// without them — saved templates, frozen job snapshots, BANK_NATIVE_TEMPLATES — stays exactly as before; a mapping carries them only
// when they are assigned. Aliases are the observed headers only (compared after NFKC); 取引順番号 is no bank transaction ID.
export const BANK_DATE_PARTS=[['dateYear','取引日（年）',['操作日(年)']],['dateMonth','取引日（月）',['操作日(月)']],['dateDay','取引日（日）',['操作日(日)']]];
// Plan omf-ikeda-collector-20261025: 勘定日 is the observed date header of the 池田泉州銀行 ビジネスゲート CSV (its (起算日) column is not the date).
export const BANK_FIELDS=[['date','取引日',['取引日','日付','取扱日','date','勘定日']],['description','摘要',['摘要','取引内容','内容','入出金先内容','description','merchant']],['amount','金額',['金額','入出金(円)','amount']],['outflow','出金',['出金','出金額','お支払金額','withdrawal','debit']],['inflow','入金',['入金','入金額','お預り金額','deposit','credit']],['balance','残高',['残高','差引残高','残高(円)','balance']],['reference','メモ・参照番号',['メモ','参照番号','reference','memo']],['transactionId','銀行の取引ID（任意）',['取引番号','明細番号','取引id','transactionid','transaction_id']],['currency','通貨',['通貨','currency']],['direction','入出金区分',['入出金区分','区分','direction']]];
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
// Plan omf-paypay-routine-20261022 Phase C: PayPay銀行 標準 retrieves too (the observed statement steps in collector/banks/paypay.mjs);
// its BA-PLUS and no-variant connections keep the observe stage. Jobs queued earlier keep the kind they were queued with.
// Plan omf-ikeda-collector-20261025: 池田泉州銀行 ビジネスゲート (portal: 電子証明書 + ログインパスワード) retrieves; its インターネットEB `direct`
// variant (a separate 照会用暗証番号) and no-variant connections keep the observe stage.
export const BANK_VARIANT_COLLECTION={rakuten:{standard:'retrieve'},paypay:{standard:'retrieve'},ikeda:{portal:'retrieve'}};
export function bankCollectionMode(provider,variant){if(BANK_PROVIDERS.find(p=>p[0]===provider)?.[2]==='verified')return 'retrieve';return BANK_VARIANT_COLLECTION[provider]?.[variant]==='retrieve'?'retrieve':'observe';}
// The bank's own statement format a retrieving variant downloads: OMF creates/reuses this owner template for the connection, so no
// CSV has to be uploaded first (楽天銀行 標準: the four observed columns, outflow negative, no bank transaction ID).
// 池田泉州銀行 ビジネスゲート: the observed 10-column Shift_JIS 入出金明細 (勘定日 date, 摘要, お支払金額 out, お預り金額 in, 残高; outflow
// positive; no bank transaction ID — 取引区分/明細区分 are not identifiers). Every source column is kept in the row's original/provenance.
export const BANK_NATIVE_TEMPLATES={rakuten:{standard:{key:'rakuten-standard-native',name:'楽天銀行 標準フォーマット（自動）',headers:['取引日','入出金(円)','残高(円)','入出金先内容'],mapping:{date:'0',description:'3',amount:'1',outflow:'',inflow:'',balance:'2',reference:'',transactionId:'',currency:'',direction:''},amountSign:'outflow-negative'}},
 ikeda:{portal:{key:'ikeda-portal-native',name:'池田泉州銀行 ビジネスゲート入出金明細（自動）',headers:['勘定日','(起算日)','お支払金額','お預り金額','残高','取引区分','明細区分','金融機関','支店','摘要'],mapping:{date:'0',description:'9',amount:'',outflow:'2',inflow:'3',balance:'4',reference:'',transactionId:'',currency:'',direction:''},amountSign:'outflow-positive'}}};
// Plan omf-ikeda-collector-20261025: the period a bank still offers for retrieval, per provider and login variant. 池田泉州銀行
// ビジネスゲート: the first day of the month before last (前々月1日) through the current JST day (bank UI and FAQ; not a rolling 90 days).
// A provider/variant absent here keeps today's behaviour: its saved period is frozen as is.
export const BANK_AVAILABILITY={ikeda:{portal:'month-before-last'}};
const dayBefore=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
/** The first day the bank still offers on the JST day `today` (YYYY-MM-DD), or null when the provider/variant keeps no window. */
export function bankAvailableFrom(provider,variant,today=jstToday()){if(BANK_AVAILABILITY[provider]?.[variant]!=='month-before-last'||!isoDay(today))return null;const[y,m]=today.split('-').map(Number),t=y*12+(m-1)-2;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0')+'-01';}
/**
 * The requested period of a connection against the bank's window on `today` (pure): requested {from, to|null} as saved (to null = open
 * through the day of the job), available {from, to=today}, effective {from, to} — what one job can actually retrieve (null when nothing of
 * the request is offered any more) — and missing {from, to}, the requested days before the window (null when none). Null for a
 * provider/variant without a window. The saved request is never rewritten: a closed end stays closed, an open one follows the day.
 */
export function bankCoverageWindow(provider,variant,saved,today=jstToday()){
 const from=bankAvailableFrom(provider,variant,today);if(!from)return null;const c=bankCoverageInput(saved,today),to=c.to??today;
 const effective={from:c.from>from?c.from:from,to},missing=c.from<from?{from:c.from,to:to<from?to:dayBefore(from)}:null;
 return{rule:BANK_AVAILABILITY[provider][variant],requested:{from:c.from,to:c.to},available:{from,to:today},effective:effective.from<=effective.to?effective:null,missing};
}
// Plan omf-ikeda-collector-20261025: a variant that selects one of several accounts on the bank's own screen needs the exact account
// identity on the connection — branch (支店名), type (普通/当座/貯蓄) and the full 7-digit account number — to choose and verify it there
// (never a first option or a last-digits match). Only 池田泉州銀行 ビジネスゲート is listed.
export const BANK_IDENTITY_REQUIRED={ikeda:{portal:true}};
export const BANK_ACCOUNT_TYPES=['普通','当座','貯蓄'];
export function bankIdentityRequired(provider,variant){return BANK_IDENTITY_REQUIRED[provider]?.[variant]===true;}
/** The account identity a connection stores (null when none was given), or a 400-message error for a malformed one. */
export function bankAccountIdentityInput(input){
 if(input===undefined||input===null)return null;if(typeof input!=='object'||Array.isArray(input))throw Error('口座の支店・種別・口座番号を確認してください。');
 const branch=String(input.branch??'').normalize('NFKC').replace(/\s+/g,' ').trim(),type=String(input.type??'').normalize('NFKC').trim(),number=String(input.number??'').normalize('NFKC').trim();
 if(!branch&&!type&&!number)return null;
 if(!branch||branch.length>40||/[\x00-\x1f]/.test(branch))throw Error('口座の支店名を確認してください。');
 if(!BANK_ACCOUNT_TYPES.includes(type))throw Error('口座の種別（普通・当座・貯蓄）を確認してください。');
 if(!/^[0-9]{7}$/.test(number))throw Error('口座番号は7桁の数字で入力してください。');
 return{branch,type,number};
}
// Plan omf-paypay-four-accounts-20261021: a variant whose FIRST capture needs no uploaded file or template — its guided observe job
// freezes an explicit unmapped interpretation, the received CSV is kept as needs_review (mapping-required, no rows) and the owner maps it
// with the existing importer. Only PayPay銀行 標準 is listed. Plan omf-paypay-routine-20261022: its jobs now retrieve; a connection
// without a template still freezes the unmapped interpretation, so its first routine capture is kept for the owner's one mapping.
export const BANK_FIRST_CAPTURE={paypay:{standard:'unmapped'}};
export function bankFirstCapture(provider,variant){return BANK_FIRST_CAPTURE[provider]?.[variant]==='unmapped'?'unmapped':null;}
export function bankCapability(provider,variant){const mode=bankCollectionMode(provider,variant),template=BANK_NATIVE_TEMPLATES[provider]?.[variant]||null,availability=BANK_AVAILABILITY[provider]?.[variant]||null;return{mode,steps:mode==='retrieve'?'implemented':'contract-pending',template:template?template.key:null,period:mode==='retrieve'?'required':'portal',liveVerified:false,...(availability?{availability}:{})};}
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
// The date of a row read from three cells: a 4-digit year, a 1-2 digit month and day, digits only, a real calendar day. Any part
// empty or malformed is the same error as a bad direct date (the row is held) — no day, month or year is ever filled in.
function dateOfParts(y,m,d){const[a,b,c]=[y,m,d].map(text);if(!/^\d{4}$/.test(a)||!/^\d{1,2}$/.test(b)||!/^\d{1,2}$/.test(c))throw Error('取引日を確認してください。');return dateOf(a+'-'+b+'-'+c);}
// The date source of a mapping: the direct `date` column when assigned (it always wins), else all three parts, else none.
export function bankDateSource(mapping){if(mapping?.date!==undefined&&mapping.date!=='')return 'date';return BANK_DATE_PARTS.every(([k])=>mapping?.[k]!==undefined&&mapping[k]!=='')?'parts':null;}
export function guessBankMapping(headers){const at=names=>headers.findIndex(h=>names.some(n=>norm(n)===norm(h)));const guess=Object.fromEntries(BANK_FIELDS.map(([k,,names])=>{const i=at(names);return[k,i<0?'':String(i)];}));for(const[k,,names]of BANK_DATE_PARTS){const i=at(names);if(i>=0)guess[k]=String(i);}return guess;}
export async function bankRowKey(row,source){if(text(row.transactionId))return 'id:'+text(row.transactionId);if(!/^[a-f0-9]{64}$/.test(source?.hash)||typeof source.sheet!=='string'||!Number.isSafeInteger(source.row)||source.row<1)throw Error('元ファイルの行を確認できません。');return 'file:' + source.hash + ':' + encodeURIComponent(source.sheet) + ':' + source.row;}
export const BANK_AMOUNT_SIGNS=[['outflow-positive','出金がプラス・入金がマイナス'],['outflow-negative','出金がマイナス・入金がプラス']];
export async function normalizeBankRow(values,source,options={}){
 const out=money(values.outflow),incoming=money(values.inflow),signed=money(values.amount);let amount=signed;
 if(out!==null||incoming!==null){if((out??0)<0||(incoming??0)<0||out&&incoming)throw Error('出金・入金の列を確認してください。');amount=round((out??0)-(incoming??0));}
 if(amount===null)throw Error('金額の列を割り当ててください。');
 if(signed!==null&&out===null&&incoming===null){const direction=text(values.direction);amount=/^(入金|in|credit)$/i.test(direction)?-Math.abs(signed):/^(出金|out|debit)$/i.test(direction)?Math.abs(signed):signed*(options.amountSign==='outflow-negative'?-1:1);}
 const parts=text(values.date)===''&&BANK_DATE_PARTS.some(([k])=>text(values[k])!=='');
 const r={date:parts?dateOfParts(values.dateYear,values.dateMonth,values.dateDay):dateOf(values.date),description:text(values.description),reference:text(values.reference),transactionId:text(values.transactionId),currency:text(values.currency||'JPY').toUpperCase(),amount,direction:amount<0?'in':'out',balance:money(values.balance)};
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
// Plan omf-paypay-routine-20261022 Phase S (D2): the canonical row of each planned statement row when the same transactions arrive
// again in another file (a refreshed or overlapping export). Pure. In order: the same source row already recorded — its `file:` key,
// else its source (hash/sheet/row) recorded on one canonical row (an earlier alias). Then, only in `capture` mode (a retrieve job's
// capture with a frozen period and a mapped balance column) or `owner` mode (an owner import whose mapping has a balance column), a
// row is anchored to an existing file-row with exactly the same date, direction, amount, currency, description, reference and
// running balance — and only when that tuple is unique on BOTH sides (genuine same-day twins differ by their running balance; two
// indistinguishable copies are never paired arbitrarily). `owner` mode links only to rows a collector captured, so owner-to-owner
// cross-file copies keep the existing explicit review. `capture` mode also holds (needs_review, nothing written): a row outside the
// frozen period, a row without a balance when there is anything to anchor, an ambiguous tuple, and an existing in-period row of the
// account that the capture lacks before the period's final day (another account's statement, a truncated export or a bank-side
// change; the final day may legitimately be partial). `resolve` mode (observe captures, mappings without a balance) only resolves.
export const BANK_COLLECTOR_CHANNELS=['collector','collector-observe'];
const rowIdOf=e=>String(e?._id??e?.id??'');
const sameSource=(p,s)=>!!p&&!!s&&p.hash===s.hash&&p.sheet===s.sheet&&p.row===s.row;
// The running balance a canonical row is anchored by (build-resume-04, parent finding PARENT-BALANCE-CORRECTION-FINDING.md): the owner's
// CURRENT reviewed balance (BankRow.balance, written at creation and changed only by a revisioned owner reinterpretation of the same
// source row) when recorded; else — rows written before it existed — the one balance its provenance carries. Provenance balances stay
// the immutable record of what each source said; an owner's corrected balance-column mapping therefore takes effect for later anchors.
export function bankRowBalance(e){if(typeof e?.balance==='number'&&Number.isFinite(e.balance))return e.balance;const b=[...new Set((e?.provenance||[]).map(p=>p?.balance).filter(v=>typeof v==='number'&&Number.isFinite(v)))];return b.length===1?b[0]:null}
const balanceOf=bankRowBalance;
const tupleOf=(r,balance)=>JSON.stringify([r.date,r.direction,String(r.amount),r.currency,r.description,r.reference,r.transactionId||'',String(balance)]);
const OVERLAP_TEXT={
 'period-mismatch':(n,c)=>`取得期間（${c.from}〜${c.to}）の外の日付の取引が${n}件含まれているため、取り込んでいません。銀行の画面の期間を確認して、もう一度「取得」を押してください`,
 'balance-missing':n=>`残高のない取引が${n}件あり、取り込み済みの明細と照合できないため、取り込んでいません。「取込で割り当て」から内容を確認してください`,
 'overlap-ambiguous':()=>'取り込み済みの明細に、日付・金額・内容・残高がすべて同じ取引が複数あり、どれと同じ取引かを決められないため、取り込んでいません。支払い照合で「重複の可能性」がある明細を確認してから、もう一度「取得」を押してください',
 'overlap-mismatch':n=>`この口座に取り込み済みの取引のうち${n}件が今回の明細にありません（別の口座の明細、または途中までの明細の可能性があります）。取り込んでいません。接続している口座とログイン、取得期間を確認してください`
};
// Build-resume-05: the balance tuple of a row's current interpretation, and the identity a reinterpretation reserves for it — the first
// ordinal of that tuple not yet reserved in the planning snapshot (the same rule a created row's identity follows), or null for a row that
// takes no identity (not a file-row, or no balance). Pure.
export function bankRowTuple(row,balance){return tupleOf(row,balance)}
export function bankCurrentIdentity(row,balance,reserved=null){if(row?.idKind!=='file-row'||typeof balance!=='number'||!Number.isFinite(balance))return null;const t=tupleOf(row,balance),isReserved=typeof reserved==='function'?reserved:()=>false;let k=1;while(isReserved(t+'#'+k))k++;return t+'#'+k}
export function bankOverlapPlan(existing,planned,{mode='resolve',coverage=null,reserved=null}={}){
 const list=Array.isArray(existing)?existing:[],rows=Array.isArray(planned)?planned:[],capture=mode==='capture'&&!!coverage,anchoring=capture||mode==='owner';
 const targets=rows.map(()=>null),via=rows.map(()=>null),used=new Set();
 const hold=(code,n)=>({held:true,code,reason:code+': '+OVERLAP_TEXT[code](n,coverage),targets:rows.map(()=>null),via:rows.map(()=>null),identities:rows.map(()=>null),anchored:0});
 // Canonical identity of each row this plan will CREATE (capture/owner mode, file-row with a numeric balance): the balance tuple and
 // an ordinal — the first ordinals of that tuple not yet reserved in this planning snapshot, one per created row in file order.
 // `reserved(identity)` answers from the account's immutable reservation history (the caller stores a digest as BankRow.canonicalKey,
 // unique per account, and never rewrites it when the owner later reinterprets the row), NOT from the rows' current values: a row
 // whose memo or other field was reinterpreted keeps its original reservation, and a later copy of its original tuple takes the next
 // free ordinal instead of colliding with it forever. Reservations only grow, so two writers planning from the same snapshot derive
 // the same identity (the database lets only one publish it), a writer with an older snapshot collides with what a newer one
 // published, and a writer that re-plans always gets an identity it can publish. Genuine repeats in one file, later owner copies and
 // rows after a superseded one get the next ordinals.
 const identities=rows.map(()=>null),isReserved=typeof reserved==='function'?reserved:()=>false;
 const done=n=>{if(anchoring){const next=new Map();
  rows.forEach((r,i)=>{if(targets[i]!==null||r.idKind!=='file-row'||typeof r.balance!=='number'||!Number.isFinite(r.balance))return;const t=tupleOf(r,r.balance);let k=next.get(t)||1;while(isReserved(t+'#'+k))k++;identities[i]=t+'#'+k;next.set(t,k+1)})}
  return{held:false,code:null,reason:null,targets,via,identities,anchored:n}};
 for(let i=0;i<rows.length;i++){const r=rows[i],byKey=list.find(e=>e.key===r.key);if(byKey){targets[i]=rowIdOf(byKey);via[i]='key';used.add(targets[i]);continue}
  // Build-resume-06 (parent finding PARENT-BANK-ID-FINDING.md): a recorded-source alias links a FILE-ROW to a file-row only (the alias an
  // anchor or an owner link recorded). A confirmed bank ID keeps its key-only identity as on 12cf98c: a changed ID mapping on the same
  // source creates the other ID's row and never rewrites the original one, and a file-row and a bank-ID row of one source stay distinct.
  const source=r.provenance?.[0],bySource=r.idKind==='file-row'?list.filter(e=>e.idKind==='file-row'&&(e.provenance||[]).some(p=>sameSource(p,source))):[];
  if(bySource.length===1){targets[i]=rowIdOf(bySource[0]);via[i]='source';used.add(targets[i])}else if(bySource.length>1&&capture)return hold('overlap-ambiguous',bySource.length)}
 if(capture){const outside=rows.filter(r=>r.date<coverage.from||r.date>coverage.to);if(outside.length)return hold('period-mismatch',outside.length)}
 if(!anchoring)return done(0);
 const candidates=list.filter(e=>!used.has(rowIdOf(e))&&e.state!=='superseded'&&e.idKind==='file-row'&&(capture?e.date>=coverage.from&&e.date<=coverage.to:(e.provenance||[]).some(p=>BANK_COLLECTOR_CHANNELS.includes(p?.channel))));
 if(!candidates.length)return done(0);
 const open=rows.map((r,i)=>i).filter(i=>targets[i]===null&&rows[i].idKind==='file-row'),numeric=v=>typeof v==='number'&&Number.isFinite(v);
 const unbalanced=open.filter(i=>!numeric(rows[i].balance));if(capture&&unbalanced.length)return hold('balance-missing',unbalanced.length);
 const byTuple=new Map(),byPlanned=new Map();
 for(const e of candidates){const b=balanceOf(e);if(b===null)continue;const t=tupleOf(e,b);byTuple.set(t,[...(byTuple.get(t)||[]),e])}
 for(const i of open){if(!numeric(rows[i].balance))continue;const t=tupleOf(rows[i],rows[i].balance);byPlanned.set(t,[...(byPlanned.get(t)||[]),i])}
 const anchored=new Set();
 for(const [t,group] of byPlanned){const matches=byTuple.get(t);if(!matches)continue;
  if(group.length!==1||matches.length!==1){if(capture)return hold('overlap-ambiguous',group.length);continue}
  targets[group[0]]=rowIdOf(matches[0]);via[group[0]]='anchor';anchored.add(targets[group[0]])}
 if(capture){const missing=candidates.filter(e=>!anchored.has(rowIdOf(e))&&e.date<coverage.to);if(missing.length)return hold('overlap-mismatch',missing.length)}
 return done(anchored.size);
}
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

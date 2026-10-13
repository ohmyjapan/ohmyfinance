import { csvRows, dateOnly, digest, MAX_BYTES, MAX_ROWS } from './amex.mjs';
export const PARSER_VERSION = 'aplus-jp-2';
export const HEADERS = ['カード番号','ご利用日','ご利用店名','ご利用金','売上種別','支払回数','今回回数','お支払金額','摘要   現地通貨額(通貨略称)／換算レート／換算日等／手数料'];
const yen = value => {
  const text=String(value??'').trim();
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw Error('円の金額を整数で指定してください');
  const n=Number(text.replace(/,/g,''));
  if(!Number.isSafeInteger(n)||Math.abs(n)>1e12) throw Error('金額が上限を超えています');
  return n;
};
export function aplusPeriod(value) {
  if(value?.kind!=='statement'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value.statementMonth||'')) throw Error('Aplusの確定した請求月を指定してください');
  const start=dateOnly(value.statementMonth+'-01');
  const end=new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10);
  if(value.start!==undefined&&dateOnly(value.start)!==start||value.end!==undefined&&dateOnly(value.end)!==end) throw Error('請求月と対象期間が一致しません');
  let fiscalPeriod;
  if(value.fiscalStart!==undefined||value.fiscalEnd!==undefined){
    const from=dateOnly(value.fiscalStart),to=dateOnly(value.fiscalEnd);
    if(from>to||(Date.parse(to)-Date.parse(from))/86400000>370) throw Error('会計期間を確認してください');
    fiscalPeriod={start:from,end:to};
  }
  return {kind:'statement',start,end,key:'statement:'+start+':'+end,statementMonth:value.statementMonth,...(fiscalPeriod?{fiscalPeriod}:{})};
}
export function parseAplus(bytes,cardIdentifiers,metadata){
  if(!bytes.length||bytes.length>MAX_BYTES) throw Error('CSVは5MB以下にしてください');
  const coverage=aplusPeriod(metadata),expectedTotal=yen(metadata.statementTotal);
  // The refund notice is optional: stated → it must equal the refund rows in the file; unstated → no equality check.
  const expectedRefund=metadata.refundTotal===undefined||metadata.refundTotal===null||metadata.refundTotal===''?null:yen(metadata.refundTotal);
  if(expectedRefund!==null&&expectedRefund<0) throw Error('別途返金額は正の金額で指定してください');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const table=csvRows(text.replace(/^\uFEFF/,'')),headers=table.shift();
  if(!headers||headers.length!==HEADERS.length||headers.some((h,i)=>h.trim()!==HEADERS[i])) throw Error('対応するAplus確定明細CSVではありません。未確定データは取り込めません');
  if(!table.length||table.length>MAX_ROWS) throw Error('CSVの行数は1〜5000行にしてください');
  const allowed=new Set(cardIdentifiers);
  if(!allowed.size||[...allowed].some(v=>!/^\d{4}$/.test(v))) throw Error('Aplusのカード番号下4桁を確認してください');
  let paymentTotal=0,purchaseTotal=0,sourceRefundTotal=0,accountAdjustmentTotal=0;
  const occurrences=new Map();
  const rows=table.map((cells,index)=>{
    try{
      if(cells.length!==HEADERS.length) throw Error('列数が一致しません');
      const raw=Object.fromEntries(HEADERS.map((h,i)=>[h,cells[i]]));
      const description=cells[2].trim(),details=cells[8].trim();
      if(!description||description.length>2000||details.length>2000) throw Error('利用先または摘要を確認してください');
      const annualFee=!cells[0].trim()&&!cells[1].trim()&&description==='年会費'&&!cells[4].trim()&&!cells[5].trim()&&!cells[6].trim();
      // A card-less, date-less 「ご入金」 row is the statement's own account adjustment (a deposit against the balance). It is
      // kept as a non-expense credit for review; whether it is a repayment is an owner decision, so nothing posts from it.
      const deposit=!cells[0].trim()&&!cells[1].trim()&&/^ご入金/.test(description)&&!cells[4].trim()&&!cells[5].trim()&&!cells[6].trim();
      const cardIdentifier=/^≪\*{4}-\*{4}-\*{4}-(\d{4})≫$/.exec(cells[0].trim())?.[1]||null;
      if(!annualFee&&!deposit&&(!cardIdentifier||!allowed.has(cardIdentifier))) throw Error('この口座に登録されていないカードです');
      const rawDate=cells[1].trim();
      if(!annualFee&&!deposit&&!/^\d{8}$/.test(rawDate)) throw Error('利用日を確認してください');
      const purchaseDate=annualFee||deposit?null:dateOnly(rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6));
      if(purchaseDate&&purchaseDate>coverage.end) throw Error('利用日が請求月より後です。請求月を確認してください');
      const purchaseAmount=yen(cells[3]),salesType=cells[4].trim(),installmentCount=cells[5].trim(),installmentNumber=cells[6].trim();
      // A blank お支払金額 stays blank (null); it is never derived from the purchase amount.
      const paymentAmount=cells[7].trim()===''?null:yen(cells[7]);
      const separateRefund=paymentAmount===null&&purchaseAmount<0&&salesType.normalize('NFKC')==='S'&&installmentCount==='1'&&!installmentNumber&&/^返品/.test(details);
      purchaseTotal+=purchaseAmount;
      if(paymentAmount!==null) paymentTotal+=paymentAmount;
      if(separateRefund) sourceRefundTotal-=purchaseAmount;
      if(deposit) accountAdjustmentTotal+=purchaseAmount;
      const reasons=[];
      if(annualFee) reasons.push('利用日・カード番号がない年会費です。計上日と対象カードを確認してください。');
      if(deposit) reasons.push('カード番号・利用日のない入金（口座調整）の明細です。返済として扱うかは確認待ちです。');
      if(separateRefund) reasons.push('返品・返金の明細です。お支払金額は空欄のまま保管し、返金の扱い（別途返金か請求額との相殺か）を確認してください。');
      if(paymentAmount===null&&!separateRefund&&!deposit) reasons.push('お支払金額が空欄の明細です。元の利用金額のまま保管し、請求への反映を確認してください。');
      const ordinary=!annualFee&&salesType.normalize('NFKC')==='S'&&installmentCount==='1'&&Number(installmentNumber)===1&&paymentAmount!==null&&purchaseAmount===paymentAmount;
      if(!annualFee&&!separateRefund&&!deposit&&paymentAmount!==null&&!ordinary) reasons.push('分割・売上種別・利用金額と支払金額の差を確認してください。');
      if(purchaseDate&&coverage.fiscalPeriod&&(purchaseDate<coverage.fiscalPeriod.start||purchaseDate>coverage.fiscalPeriod.end)) reasons.push('元の利用日が対象の会計期間外です。返金などは別途確認してください。');
      const kind=purchaseAmount<=0||paymentAmount!==null&&paymentAmount<=0?'credit_review':reasons.length?'statement_review':'expense';
      const fingerprint=digest(JSON.stringify(['aplus',coverage.key,purchaseDate,cardIdentifier,description.normalize('NFC'),purchaseAmount,paymentAmount,salesType,installmentCount,installmentNumber,details.normalize('NFC')]));
      const occurrence=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,occurrence);
      return {line:index+2,provider:'aplus',purchaseDate,processingDate:null,description,cardholder:'',cardIdentifier,amount:purchaseAmount,currency:'JPY',foreignAmount:'',exchangeRate:'',kind,fingerprint,occurrence,key:fingerprint+':'+occurrence,raw,sourceReviewReason:reasons.join(' '),statementMonth:coverage.statementMonth,purchaseAmount,paymentAmount,salesType,installmentCount,installmentNumber,statementDetails:details,separateRefund};
    }catch(error){throw Error((index+2)+'行目: '+error.message);}
  });
  if(paymentTotal!==expectedTotal) throw Error('CSVの支払金額合計とAplusの表示額が一致しません');
  if(expectedRefund!==null&&sourceRefundTotal!==expectedRefund) throw Error('CSVの別途返金額とAplusの返金通知額が一致しません');
  if(Buffer.byteLength(JSON.stringify(rows))>8*1024*1024) throw Error('CSVを小さい期間に分割してください');
  return {parserVersion:PARSER_VERSION,encoding:'utf-8',sha256:digest(bytes),rows,period:coverage,reconciliation:{statementTotal:paymentTotal,purchaseTotal,separateRefundTotal:expectedRefund,sourceRefundTotal,accountAdjustmentTotal,verified:true,version:2}};
}

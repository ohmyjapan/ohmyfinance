import type { AmexRow } from './amex.mjs';
export interface AplusRow extends Omit<AmexRow,'purchaseDate'|'processingDate'|'cardIdentifier'|'kind'> {
  provider:'aplus'; purchaseDate:string|null; processingDate:null; cardIdentifier:string|null;
  kind:'expense'|'credit_review'|'statement_review'; sourceReviewReason:string; statementMonth:string;
  purchaseAmount:number; paymentAmount:number|null; salesType:string; installmentCount:string; installmentNumber:string; statementDetails:string; separateRefund:boolean;
}
export const PARSER_VERSION:string;
export const HEADERS:string[];
export function aplusPeriod(value:any):{kind:'statement';start:string;end:string;key:string;statementMonth:string;fiscalPeriod?:{start:string;end:string}};
export function parseAplus(bytes:Uint8Array,cardIdentifiers:string[],metadata:any):{parserVersion:string;encoding:string;sha256:string;rows:AplusRow[];period:ReturnType<typeof aplusPeriod>;reconciliation:{statementTotal:number;purchaseTotal:number;separateRefundTotal:number;verified:boolean}};

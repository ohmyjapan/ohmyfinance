import type {AmexRow} from './amex.mjs';
import type {AplusRow} from './aplus.mjs';
export type CardRow=AmexRow|AplusRow;
export function parseCardImport(bytes:Uint8Array,account:any,metadata:any):{parserVersion:string;encoding:string;sha256:string;rows:CardRow[];period:{kind:'statement'|'recent'|'custom';start:string;end:string;key:string;statementMonth?:string;fiscalPeriod?:{start:string;end:string}};reconciliation?:{statementTotal:number;purchaseTotal:number;separateRefundTotal:number;verified:boolean}};

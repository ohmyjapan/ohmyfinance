import {parseAmex,period} from './amex.mjs';
import {parseAplus} from './aplus.mjs';
import {parsePendingImport} from './finance-pending.mjs';
export function parseCardImport(bytes,account,metadata){
  if(metadata?.kind==='pending') return parsePendingImport(bytes,account,metadata);
  if(account.provider==='aplus') return parseAplus(bytes,account.cardIdentifiers,metadata);
  if(account.provider&&account.provider!=='amex') throw Error('未対応のカード会社です');
  return {...parseAmex(bytes,account.cardIdentifiers),period:period(metadata)};
}

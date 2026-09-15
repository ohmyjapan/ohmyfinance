import {parseAmex,period} from './amex.mjs';
import {parseAplus} from './aplus.mjs';
export function parseCardImport(bytes,account,metadata){
  if(account.provider==='aplus') return parseAplus(bytes,account.cardIdentifiers,metadata);
  if(account.provider&&account.provider!=='amex') throw Error('未対応のカード会社です');
  return {...parseAmex(bytes,account.cardIdentifiers),period:period(metadata)};
}

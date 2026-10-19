export const assistantPages={dashboard:'ダッシュボード',mapping:'明細マッピング',draft:'取引の下書き',learning:'学習ノート',transactions:'取引一覧',connections:'カード連携',settings:'設定',reports:'レポート',intake:'購入受付','intake-payments':'支払い照合',invoices:'請求書',calendar:'支払いカレンダー',other:'現在のページ'};
// UI identity only. Native endpoints independently authorize the token's current membership.
export function assistantConversationScope(actorId,organizationId,page){const company=['invoices','calendar','transactions'].includes(page);return {actorId:actorId||'',organizationId:organizationId||'',company,key:company?JSON.stringify(['company',actorId||'',organizationId||'']):JSON.stringify(['workspace',actorId||''])}}
export function assistantPage(path){if(path==='/')return 'dashboard';if(path.startsWith('/mapping-draft/'))return 'draft';if(path==='/intake/payments'||path.startsWith('/intake/payments/'))return 'intake-payments';const first=path.split('/')[1];return Object.hasOwn(assistantPages,first)?first:'other'}
export function assistantTarget(value){return value?.kind==='draft'&&/^[a-f0-9]{24}$/i.test(value.importId)&&Number.isSafeInteger(value.line)&&value.line>0?{kind:'draft',importId:value.importId,line:value.line}:{kind:'workspace'}}
// Company conversations (transactions/invoices/calendar) use the catalogue-aware company reply validator; the general and
// purchase replies below keep their original rules. assistantFeature names the current page's catalogue entry, for UI only.
export {validateCompanyAssistantReply} from './finance-navi-features.mjs';
import {naviFeatureForPath} from './finance-navi-features.mjs';
export function assistantFeature(path){return naviFeatureForPath(path)}
export function validateAssistantReply(input){if(!input||!['unclear','defer'].includes(input.kind)||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>800||!input.patch||Object.keys(input.patch).length||!input.quotes||Object.keys(input.quotes).length)throw Error('A general conversation cannot change a purchase');return {kind:input.kind,summary:input.summary.trim(),patch:{},quotes:{}}}

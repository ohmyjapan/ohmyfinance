import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=360000;
export default {name:'omf-company-assistant-ui',covers:['server/services/financeCompanyActionService.ts','server/services/companyPaymentWriteService.ts','scripts/finance-company-actions-integration.cjs','components/finance/NaviAvatar.vue','components/finance/PurchaseChat.vue','public/images/omf-navi-film.jpg','components/finance/AssistantPanel.vue','components/finance/AssistantConversation.vue','components/finance/CompanyAssistantScope.vue','stores/assistant.ts','shared/finance-assistant.mjs','teaching-worker/interpreter.mjs','scripts/finance-company-assistant-browser.cjs'],async run(){
 const run=(args,env={})=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,timeout:300000,maxBuffer:3*1024*1024,env:{...process.env,...env}},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await run(['--test','scripts/finance-assistant.test.mjs','scripts/finance-chat.test.mjs','scripts/finance-assistant-worker.test.mjs']);
 const browser=await run(['scripts/finance-company-assistant-integration.cjs'],{MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_COMPANY_NAVI_BROWSER:'1',OMF_COMPANY_NAVI_APP_ROOT:root});
 return {pass:unit.code===0&&browser.code===0&&browser.text.includes('7 Company Navi groups passed'),databaseCoverage:{executed:browser.code===0,ownedProcess:browser.code===0},message:JSON.stringify({unit,browser,limits:'Native synthetic HTTP and installed Chrome; no model/provider/production calls. Independent review, shared-guard historical/production audit, all-feature actions and operator custody remain open.'})};
}};

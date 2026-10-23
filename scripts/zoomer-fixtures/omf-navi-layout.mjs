// Owned native app/database and installed Chrome; no model or production calls.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default {name:'omf-navi-layout',covers:['layouts/default.vue','components/common/AppHeader.vue','components/finance/AssistantPanel.vue','components/dashboard/StatCard.vue','assets/css/tailwind.css','pages/index.vue','pages/transactions/index.vue','pages/invoices/index.vue','pages/recurring/index.vue','pages/receipts/index.vue','pages/reports/tax.vue','pages/mapping.vue','scripts/finance-navi-floating-integration.cjs','scripts/finance-navi-layout-browser.cjs','scripts/zoomer-fixtures/omf-navi-layout.mjs'],async run(){
 const app=process.env.OMF_FLOATING_APP_ROOT||root;
 if(!existsSync(path.join(app,'.output/server/index.mjs')))return{pass:false,message:'layout:setup missing built native app'};
 const r=await new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-navi-floating-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_FLOATING_APP_ROOT:app,OMF_FLOATING_FOLD_CASE:'layout'},timeout:840000,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({exit:e?.code||0,signal:e?.signal||null,text:stdout+stderr})));
 const groups=Number((r.text.match(/(\d+) Floating Navi groups passed/)||[])[1]||0),expected=5;
 return{pass:r.exit===0&&groups===expected,databaseCoverage:{executed:r.exit===0,ownedProcess:r.exit===0},message:JSON.stringify({exit:r.exit,signal:r.signal,groups,expected,passes:r.text.match(/^PASS .*$/gm)||[],failures:r.text.match(/^FAIL .*$/gm)||[],error:r.exit?r.text.slice(-2200):null,limits:'Synthetic native rows and installed Chrome only. No actual model, production history, physical device or deployment coverage.'})};
}};

// Right-rail Navi (selected base design inside the real app). Drives the owned floating integration: its own MongoMemoryServer,
// the built app on a loopback port, installed Chrome, the synthetic owner/companies/Amex row and synthetic worker replies.
// No model, bank, mail, Slack or production calls; the integration itself asserts no ledger write.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default {name:'omf-navi-right-rail',covers:['components/finance/AssistantPanel.vue','layouts/default.vue','stores/assistant.ts','scripts/finance-navi-floating-browser.cjs','scripts/finance-navi-floating-integration.cjs','scripts/zoomer-fixtures/omf-navi-right-rail.mjs'],async run(){
 const app=process.env.OMF_FLOATING_APP_ROOT||root,built=path.join(app,'.output/server/index.mjs');
 // A missing build is a named failure, never a pass: no coverage is granted on setup.
 if(!existsSync(built))return{pass:false,message:'omf-navi-right-rail: built app missing at '+built+' (run nuxt build in the tree first)'};
 const result=await new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-navi-floating-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_FLOATING_APP_ROOT:app},timeout:840000,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,signal:e?.signal||null,text:stdout+stderr})));
 // Pass only on exit 0 with every browser group green (the integration prints the count after its own no-ledger-write check).
 const expected=13,groups=Number((result.text.match(/(\d+) Floating Navi groups passed/)||[])[1]||0),pass=result.code===0&&groups===expected;
 const failure=pass?null:((result.text.match(/AssertionError[^\n]*/)||[])[0]||result.text.split('\n').filter(Boolean).slice(-3).join(' | ')).slice(0,600);
 return{pass,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({exit:result.code,signal:result.signal,groups,expected,failure,passes:result.text.match(/^PASS .*$/gm)||[],limits:'Owned synthetic DB and installed Chrome only; no model/provider calls, production records, historical reliability estimate or deploy. The open-while-waiting and hidden-tab motion suppressions are not exercised (45 s each).'})};
}};

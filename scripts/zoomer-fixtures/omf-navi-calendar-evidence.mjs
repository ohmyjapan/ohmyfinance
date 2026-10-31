import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1200000;
export default {name:'omf-navi-calendar-evidence',covers:['server/services/companyCalendarEvidenceService.ts','server/services/financeCompanyAssistantService.ts','server/services/companyConversationHistoryService.ts','teaching-worker/actions-mcp.mjs','teaching-worker/interpreter.mjs','scripts/finance-navi-calendar-evidence-integration.cjs','scripts/finance-interpreter-stream.test.mjs','scripts/zoomer-fixtures/omf-navi-calendar-evidence.mjs'],async run(){
 const prompt=await new Promise(resolve=>execFile(process.execPath,['--test','scripts/finance-interpreter-stream.test.mjs'],{cwd:root,windowsHide:true,timeout:180000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,text:stdout+stderr})));
 if(prompt.code!==0)return{pass:false,databaseCoverage:{executed:false,ownedProcess:false},message:JSON.stringify({prompt})};
 const result=await new Promise(resolve=>execFile(process.execPath,['scripts/finance-navi-calendar-evidence-integration.cjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'mongodb://127.0.0.1:1/unused',MONGODB_URI:'mongodb://127.0.0.1:1/unused',NUXT_MONGO_URI:'mongodb://127.0.0.1:1/unused'},timeout:1100000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,text:stdout+stderr})));
 const pass=result.code===0&&result.text.includes('NAVI_CALENDAR_EVIDENCE_PASS');
 return{pass,databaseCoverage:{executed:result.text.includes('OWNED_DATABASE_CONNECTED'),ownedProcess:result.text.includes('OWNED_DATABASE_CONNECTED')},message:JSON.stringify({prompt,result})};
}};

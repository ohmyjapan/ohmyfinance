import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1200000;
export default {name:'omf-navi-calendar-evidence',covers:['server/services/companyCalendarEvidenceService.ts','server/services/financeCompanyAssistantService.ts'],async run(){
 const result=await new Promise(resolve=>execFile(process.execPath,['scripts/finance-navi-calendar-evidence-integration.cjs'],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'mongodb://127.0.0.1:1/unused',MONGODB_URI:'mongodb://127.0.0.1:1/unused',NUXT_MONGO_URI:'mongodb://127.0.0.1:1/unused'},timeout:1100000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,text:stdout+stderr})));
 const pass=result.code===0&&result.text.includes('NAVI_CALENDAR_EVIDENCE_PASS');
 return{pass,databaseCoverage:{executed:result.text.includes('OWNED_DATABASE_CONNECTED'),ownedProcess:result.text.includes('OWNED_DATABASE_CONNECTED')},message:JSON.stringify(result)};
}};

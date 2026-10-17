// Run only through the hub verifier. The app test owns an ephemeral MongoDB and uses synthetic records.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=300000;
const built=existsSync(path.join(root,'.output/server/index.mjs'));
export function validateFixtureResults(unit,api){
 const passed=Number(unit.text.match(/(?:#|ℹ)\s*pass\s+(\d+)/)?.[1]||0),failed=Number(unit.text.match(/(?:#|ℹ)\s*fail\s+(\d+)/)?.[1]??-1);
 const groups=Number(api?.text.match(/(\d+) Navi intake API groups passed/)?.[1]||0);
 return unit.code===0&&passed===6&&failed===0&&api?.code===0&&groups===6;
}
export default{
 name:'omf-navi-intake',
 covers:built?['shared/finance-assistant.mjs','server/services/financeIntakeActionService.ts','server/services/financeActionService.ts','server/services/financeAssistantService.ts']:['shared/finance-assistant.mjs'],
 async run(){
  const run=args=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,timeout:180000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>resolve({code:error?.code||0,text:stdout+stderr})));
  const unit=await run(['--test','scripts/finance-navi-intake.test.cjs']);
  const api=built?await run(['scripts/finance-navi-intake-integration.cjs']):null;
  const pass=validateFixtureResults(unit,api);
  return{pass,databaseCoverage:{executed:pass,ownedProcess:pass},message:'unit '+unit.code+': '+unit.text.slice(-12000)+'; API '+(api?api.code+': '+api.text.slice(-10000):'NOT RUN: no built app')};
 }
};

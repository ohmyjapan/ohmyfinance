// Run only through the hub verifier. The app test owns an ephemeral MongoDB and uses synthetic records.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
const built=existsSync(path.join(root,'.output/server/index.mjs'));
export function validateFixtureResults(unit,api,expectedGroups=16){
 const passed=Number(unit.text.match(/(?:#|ℹ)\s*pass\s+(\d+)/)?.[1]||0),failed=Number(unit.text.match(/(?:#|ℹ)\s*fail\s+(\d+)/)?.[1]??-1);
 const skipped=Number(unit.text.match(/(?:#|ℹ)\s*skipped\s+(\d+)/)?.[1]??-1);
 const groups=Number(api?.text.match(/(\d+) Navi intake API groups passed/)?.[1]||0);
 return unit.code===0&&passed===9&&failed===0&&skipped===0&&api?.code===0&&groups===expectedGroups;
}
export default{
 name:'omf-navi-intake',
 covers:built?['shared/finance-assistant.mjs','server/services/financeIntakeActionService.ts','server/services/financeActionService.ts','server/services/financeAssistantService.ts','server/services/financeIntakeService.ts','server/services/financeIntakeResearchService.ts','server/models/FinanceIntake.ts','server/models/FinanceActionOperation.ts','components/finance/AssistantConversation.vue','stores/assistant.ts','pages/intake/[id].vue','server/services/financePaymentMatchService.ts',...(process.env.OMF_NAVI_INTAKE_MODEL==='1'?['teaching-worker/interpreter.mjs','teaching-worker/actions-mcp.mjs','shared/finance-accountant-role.mjs']:[])]:['shared/finance-assistant.mjs'],
 async run(){
  const binary=path.join(path.dirname(root),'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe');
  const env={...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...(existsSync(binary)?{MONGOMS_SYSTEM_BINARY:binary}:{})};
  const run=(args,cwd=root,extra={})=>new Promise(resolve=>execFile(process.execPath,args,{cwd,env:{...env,...extra},windowsHide:true,timeout:process.env.OMF_NAVI_INTAKE_MODEL==='1'?600000:180000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,text:stdout+stderr})));
  const unit=await run(['--test','scripts/finance-navi-intake.test.cjs']);
  const api=built?await run(['scripts/finance-navi-intake-integration.cjs'],root,{OMF_NAVI_INTAKE_BROWSER:'1'}):null;
  let pass=validateFixtureResults(unit,api,process.env.OMF_NAVI_INTAKE_MODEL==='1'?17:16),regression=null,matching=null;const mutants=[];
  if(pass){
   // API-only native regression. The original full intake fixture additionally requires Chrome and a real model;
   // these are explicitly excluded here, not represented as having run earlier in this fixture.
   regression=await run(['scripts/finance-integration.cjs'],root,{OMF_TEST_INTAKE_ONLY:'1',OMF_TEST_INTAKE_MUTANT:'1'});
   pass=regression.code===0&&Number(regression.text.match(/(\d+) targeted intake checks passed/)?.[1]||0)>=20;
   matching=await run(['scripts/finance-integration.cjs'],root,{OMF_TEST_PAYMENTS_ONLY:'1',OMF_TEST_PAYMENT_MUTANT:'1'});
   pass=pass&&matching.code===0&&Number(matching.text.match(/(\d+) targeted payment matching checks passed/)?.[1]||0)>=10;
   for(const [name,anchor,replacement,assertion] of [
    ['dropped-intake-args','intakeArgs: mixed,','', 'navi-intake:durable-frozen-args'],
    ['legacy-write-recovery','if (isIntakeMutation(op.name)) {','if (false) {','navi-intake:lost-create_intake_record'],
    ['ignore-confirm-finalization','if (!finalized) {','if (false) {','navi-intake:immediate-partial-confirm']
   ]){
    const base=path.resolve(root,'.zoomer','intake-mutants'),dir=path.resolve(base,randomUUID());
    if(!dir.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
    await mkdir(path.join(dir,'scripts'),{recursive:true});
    try{
     // Materialize Nitro's package links as files; no junction is created or traversed during owned-copy cleanup.
     await cp(path.join(root,'.output'),path.join(dir,'.output'),{recursive:true,dereference:true});
     await cp(path.join(root,'scripts/finance-navi-intake-integration.cjs'),path.join(dir,'scripts/finance-navi-intake-integration.cjs'));
     const file=path.join(dir,'.output/server/chunks/_/financeActionService.mjs'),source=await readFile(file,'utf8');
     if(source.split(anchor).length!==2)throw Error('Mutant anchor must occur once: '+name);
     await writeFile(file,source.replace(anchor,replacement));
     const result=await run(['scripts/finance-navi-intake-integration.cjs'],dir,{OMF_NAVI_INTAKE_BROWSER:'0',OMF_NAVI_INTAKE_MODEL:'0'});
     const detected=result.code!==0&&result.text.includes('AssertionError')&&result.text.includes(assertion);
     mutants.push({name,detected,assertion,exit:result.code,tail:result.text.slice(-1800)});if(!detected)pass=false;
    }finally{await rm(dir,{recursive:true,force:true});}
   }
  }
  return{pass,databaseCoverage:{executed:api?.code===0,ownedProcess:api?.code===0},message:'unit '+unit.code+': '+unit.text.slice(-12000)+'; API '+(api?api.code+': '+api.text.slice(-10000):'NOT RUN: no built app')+'; native API regression '+(regression?regression.code+': '+regression.text.slice(-9000):'NOT RUN')+'; matching API regression '+(matching?matching.code+': '+matching.text.slice(-9000):'NOT RUN')+'; mutants '+JSON.stringify(mutants)+'; browser '+(api?.code===0?'real Chrome clean/dirty/multiple receipts checked':'NOT PASSED')+'; model '+(process.env.OMF_NAVI_INTAKE_MODEL==='1'&&api?.code===0?'native configured accountant dialogues checked':'NOT RUN in this invocation')+'; historical-model corpus/production observation NOT RUN'};
 }
};

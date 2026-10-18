import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
const run=(cwd,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-navi-history-integration.cjs')],{cwd,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...extra},timeout:180000,maxBuffer:3*1024*1024},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,text:stdout+stderr})));
export default {name:'omf-navi-history',covers:existsSync(path.join(root,'.output/server/index.mjs'))?['server/services/financeActionService.ts','server/services/financeHistoryActionService.ts','scripts/finance-navi-history-integration.cjs']:[],async run(){
 const result=await run(root);
 const groups=Number(result.text.match(/(\d+) Navi history API groups passed/)?.[1]||0);
 let pass=result.code===0&&groups===6;const mutants=[];
 if(pass)for(const [name,chunk,anchor,replacement,assertion] of [
  ['include-current-source','financeDraftService.mjs','eligible: true, date: { $lt: before }','eligible: true, date: { $lte: before }','history:date-account-source'],
  ['ignore-source-account','financeDraftService.mjs','datasetId: dataset._id, accountId, merchant, eligible: true','datasetId: dataset._id, merchant, eligible: true','history:date-account-source'],
  ['ignore-source-owner','financeDraftService.mjs','{ ownerId, datasetId: dataset._id, accountId, merchant, eligible: true','{ datasetId: dataset._id, accountId, merchant, eligible: true','history:date-account-source'],
  ['declare-unrestricted-policy','financeActionService.mjs','kind: policy.accountIds.length ? "specific_accounts" : "all_owner_accounts"','kind: "all_owner_accounts"','history:rule-scope-source'],
  ['drop-policy-status-audit','financeActionService.mjs','statusHistory: audit.slice(-10).map','statusHistory: [].map','history:native-rule-status-audit']
 ]){
  const base=path.resolve(root,'.zoomer','history-mutants'),dir=path.resolve(base,randomUUID());
  if(!dir.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(dir,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(dir,'.output'),{recursive:true,dereference:true});await cp(path.join(root,'shared'),path.join(dir,'shared'),{recursive:true,dereference:true});
   const file=path.join(dir,'.output/server/chunks/_',chunk),source=await readFile(file,'utf8');
   if(source.split(anchor).length!==2)throw Error('Mutant anchor must occur once: '+name);await writeFile(file,source.replace(anchor,replacement));
   const r=await run(dir,{OMF_HISTORY_APP_ROOT:dir});const detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,exit:r.code,text:r.text.slice(-2000)});if(!detected)pass=false;
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 return {pass,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({...result,groups,mutants})};
}};

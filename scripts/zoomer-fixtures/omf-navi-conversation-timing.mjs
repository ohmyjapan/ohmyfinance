import {execFile} from 'node:child_process';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');export const timeoutMs=900000;
const run=(extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-navi-history-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...extra},timeout:180000,maxBuffer:3*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
async function chunks(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await chunks(p));else if(e.name.endsWith('.mjs'))files.push(p);}return files;}
export default {name:'omf-navi-conversation-timing',covers:['server/services/financeAssistantService.ts','server/services/financeChatService.ts','scripts/finance-navi-history-integration.cjs','scripts/zoomer-fixtures/omf-navi-conversation-timing.mjs'],async run(){
 const baseline=await run();let pass=baseline.code===0&&baseline.text.includes('workspace and purchase native conversation timing verified');const mutants=[];
 if(pass)for(const [name,anchor,replacement,assertion] of [
  // Retargeted 2026-10-20: the company conversation projection (financeCompanyAssistantService, B/C1 phase) also writes
  // "submittedAt: t.at || null," and is not this fixture's subject. The anchor names the actual owner-workspace and purchase
  // projections (the ones followed by the reply-time rule), so the same defect still removes exactly those two submission times.
  ['omit-submission-time',/submittedAt: t\.at \|\| null, (?=replyRecordedAt: t\.proposal\?\.summary)/g,'','timing:workspace:submitted-source'],
  ['omit-reply-time',/replyRecordedAt: t\.proposal\?\.summary \? t\.answeredAt \|\| null : null/g,'replyRecordedAt: null','timing:workspace:reply-source'],
  ['failed-result-is-reply',/replyRecordedAt: t\.proposal\?\.summary \? t\.answeredAt \|\| null : null/g,'replyRecordedAt: t.answeredAt || null','timing:workspace:failed-no-reply-time']
 ]){
  const base=path.resolve(root,'.zoomer/timing-mutants'),dir=path.join(base,randomUUID());if(!dir.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(dir,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(dir,'.output'),{recursive:true,dereference:true});await cp(path.join(root,'shared'),path.join(dir,'shared'),{recursive:true,dereference:true});let hits=0;
   for(const file of await chunks(path.join(dir,'.output/server/chunks'))){const text=await readFile(file,'utf8'),n=(text.match(anchor)||[]).length;if(n){hits+=n;await writeFile(file,text.replace(anchor,replacement));}}
   if(hits!==2)throw Error(name+': expected two actual context projections, found '+hits);
   const r=await run({OMF_HISTORY_APP_ROOT:dir}),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,hits,detected,...r});if(!detected)pass=false;
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 return {pass,databaseCoverage:{executed:baseline.code===0,ownedProcess:baseline.code===0},message:JSON.stringify({baseline,mutants,counts:'six existing history groups plus both context modes; repeated by mutants, not independent historical populations'})};
}};

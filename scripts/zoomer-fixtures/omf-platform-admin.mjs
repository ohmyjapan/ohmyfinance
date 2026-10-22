// Legacy global administration boundary (plan omf-navi-agent-admin-20261022). Runs the owned integration (its own MongoMemoryServer,
// the built app on loopback, synthetic people and companies) against this tree's build, then against a packaged copy of that build
// (positive control: must pass) and the same copy with the compiled shared refusal removed (must fail the cross-company leg).
// No model, provider, mail, bank or production calls; a missing build is a named failure and grants no coverage.
import {execFile} from 'node:child_process';
import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1500000;
const EXPECTED=8,LABEL='platform-admin:cross-company-membership';
const run=app=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-platform-admin-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_PLATFORM_ADMIN_APP_ROOT:app},timeout:600000,maxBuffer:16*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,signal:e?.signal||null,text:stdout+stderr})));
const groupsOf=text=>Number((text.match(/(\d+) Platform admin groups passed/)||[])[1]||0);
const summaryOf=text=>{const line=text.split(/\r?\n/).find(l=>l.startsWith('SUMMARY '));try{return line?JSON.parse(line.slice(8)):null}catch{return null}};
const failureOf=text=>((text.match(/AssertionError[^\n]*/)||[])[0]||text.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')).slice(0,500);
export default {name:'omf-platform-admin',covers:['server/utils/legacyAdminAccess.ts','server/api/admin/users/index.ts','server/api/admin/users/[id].ts','server/api/admin/organizations/index.ts','server/api/admin/organizations/[id].ts','server/api/admin/organizations/[id]/members.ts','shared/finance-navi-features.mjs','scripts/finance-platform-admin-integration.cjs','scripts/zoomer-fixtures/omf-platform-admin.mjs'],async run(){
 const app=process.env.OMF_PLATFORM_ADMIN_APP_ROOT||root,built=path.join(app,'.output/server/index.mjs');
 if(!existsSync(built))return{pass:false,message:'omf-platform-admin: built app missing at '+built+' (build the tree first); no coverage granted'};
 const main=await run(app),groups=groupsOf(main.text),summary=summaryOf(main.text);
 let pass=main.code===0&&groups===EXPECTED&&!!summary,control=null,mutant=null,setupError=null;
 if(pass){
  const base=path.resolve(root,'.zoomer','platform-admin-mutants'),directory=path.resolve(base,randomUUID());
  if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
  await mkdir(directory,{recursive:true});
  try{
   // Packaged positive control: this build copied byte for byte must pass every group.
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   const c=await run(directory);control={exit:c.code,groups:groupsOf(c.text),failure:c.code===0?null:failureOf(c.text)};
   if(c.code!==0||control.groups!==EXPECTED)pass=false;
   // The deliberate defect: every compiled definition of the shared refusal returns at once (no sign-in check, no 403).
   const chunks=path.join(directory,'.output/server/chunks'),definition=/function (rejectLegacyPlatformAdmin[\w$]*)\(([^)]*)\)\s*\{/g,changed=[];
   for(const name of await readdir(chunks,{recursive:true}))if(name.endsWith('.mjs')){
    const file=path.join(chunks,name),source=await readFile(file,'utf8'),count=(source.match(definition)||[]).length;
    if(count){await writeFile(file,source.replace(definition,m=>m+' return;'));changed.push({file:name.split(path.sep).join('/'),count})}
   }
   if(!changed.length)throw Error('No compiled shared refusal found');
   const m=await run(directory),detected=m.code!==0&&m.text.includes('AssertionError')&&m.text.includes(LABEL);
   mutant={changed,exit:m.code,detected,failure:failureOf(m.text)};if(!detected)pass=false;
  }catch(error){pass=false;setupError=String(error?.message||error)}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass,databaseCoverage:{executed:main.code===0,ownedProcess:main.code===0},message:JSON.stringify({exit:main.code,signal:main.signal,groups,expected:EXPECTED,failure:main.code===0?null:failureOf(main.text),passes:main.text.match(/^PASS .*$/gm)||[],summary,control,mutant,setupError,
  limits:'Owned synthetic Mongo and loopback native HTTP only; no model/provider/mail/bank calls, production records or historical-use claim. The packaged copy is this build byte for byte; only the mutant edits its compiled refusal.'})};
}};

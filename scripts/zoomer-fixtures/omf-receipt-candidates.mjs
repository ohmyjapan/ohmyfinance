import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-receipt-candidates',covers:['server/api/receipts/[id]/matches.ts','server/services/receiptService.ts','scripts/finance-receipt-candidates-integration.cjs','scripts/zoomer-fixtures/omf-receipt-candidates.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-receipt-candidates-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_CANDIDATE_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_CANDIDATE_APP_ROOT||root,result=await run(app),mutants=[];let control,pass=result.code===0&&result.text.includes('6 Candidate access groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','candidate-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const files={service:path.join(directory,'.output/server/chunks/_/receiptService.mjs'),route:path.join(directory,'.output/server/chunks/routes/api/receipts/_id/matches.mjs')},original=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const test=async(name,key,source,assertion,extra={})=>{try{await writeFile(files[key],source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false}finally{await writeFile(files[key],original[key])}};
   await test('unscoped-transactions','service',replace(original.service,'    ...transactionScope,',''),'candidate:transaction-scope');
   await test('unscoped-receipt','service',replace(original.service,'Receipt.findOne({ _id: receiptId, organizationId })','Receipt.findById(receiptId)'),'candidate:receipt-scope');
   const trust='(event.context.auth.organizationId ? { organizationId: (await import("mongoose")).default.Types.ObjectId.createFromHexString(event.context.auth.organizationId) } : await calendarCompany(event))';
   await test('trust-stale-membership','route',replace(original.route,'await calendarCompany(event)',trust),'candidate:current-membership');
   await test('changed-score','service',replace(original.service,'let confidence = 30;','let confidence = 0;'),'candidate:scorer-high');
   await test('narrow-tolerance','service',replace(original.service,'const tolerance = receipt.amount * 0.15;','const tolerance = receipt.amount * 0.05;'),'candidate:transaction-scope');
   const injected=replace(original.service,'async function receiptMatchCandidates(receipt, transactionScope) {','async function receiptMatchCandidates(receipt, transactionScope) { throw new Error("CANDIDATE_INTERNAL_PRIVATE");');await writeFile(files.service,injected);control=await run(directory,{OMF_CANDIDATE_FAILURE:'1'});if(control.code!==0||!control.text.includes('1 Candidate access groups passed'))pass=false;
   await test('raw-route-log','route',replace(original.route,'console.error("Company receipt candidate lookup failed");','console.error("Company receipt candidate lookup failed", error);'),'candidate:safe-error-log',{OMF_CANDIDATE_FAILURE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===6,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,control,mutants,limits:'Five native company-read groups plus one legacy ambiguous-batch compatibility control; legacy global auto-match remains unsafe, not a company-safety pass. Synthetic only, no production/model/provider calls; ownership/writes/UI/backup/key/runtime privacy remain open.'})};
}};

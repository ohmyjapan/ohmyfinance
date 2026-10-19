import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-card-company',covers:['server/api/finance/[...path].ts','server/services/financeService.ts','server/models/Finance.ts','server/models/FinanceImportCompany.ts','server/services/financeCompanyPostingService.ts','scripts/finance-card-company-integration.cjs','scripts/zoomer-fixtures/omf-card-company.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-card-company-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_CARD_COMPANY_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_CARD_COMPANY_APP_ROOT||root,result=await run(app),mutants=[],controls=[];let pass=result.code===0&&result.text.includes('8 Card company groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','card-company-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const files={core:path.join(directory,'.output/server/chunks/_/nitro.mjs'),route:path.join(directory,'.output/server/chunks/routes/api/finance/_...path_.mjs')},original=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const section=(source,start,end,transform)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Missing compiled section '+start);return source.slice(0,a)+transform(source.slice(a,b))+source.slice(b)};
   const reset=()=>Promise.all(Object.entries(files).map(([key,file])=>writeFile(file,original[key])));
   const test=async(name,changes,assertion,extra={})=>{try{for(const[key,source]of Object.entries(changes))await writeFile(files[key],source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false}finally{await reset()}};
   const control=async(name,changes,extra)=>{try{for(const[key,source]of Object.entries(changes))await writeFile(files[key],source);const r=await run(directory,extra),ok=r.code===0&&r.text.includes('1 Card company groups passed');controls.push({name,pass:ok,...r});if(!ok)pass=false}finally{await reset()}};
   const copied=await run(directory);const copiedPass=copied.code===0&&copied.text.includes('8 Card company groups passed');controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Unchanged packaged copy must pass before faults or mutants');
   const injected=replace(original.core,'async function insertCompanyPosting(entry, payload, organizationId) {','async function insertCompanyPosting(entry, payload, organizationId) { throw new Error("COMPANY_POSTING_INTERNAL_PRIVATE");');
   await control('ledger-query-failure',{core:injected},{OMF_CARD_COMPANY_FAILURE:'1'});
   const crashCore=section(original.core,'async function insertCompanyPosting(', '\nconst BankTransferInfoSchema',s=>replace(replace(s,'await Transaction$1.collection.updateOne(','if(process.env.OMF_CARD_CRASH_STAGE === "before-insert") process.exit(86); await Transaction$1.collection.updateOne('),'      { upsert: true }\n    );','      { upsert: true }\n    ); if(process.env.OMF_CARD_CRASH_STAGE === "after-insert") process.exit(86);'));
   for(const stage of['before-insert','after-insert'])await control('process-crash-'+stage,{core:crashCore},{OMF_CARD_CRASH_STAGE:stage});
   const link='if (!await Transaction.exists({ _id: entry.transactionId, ...organizationId ? { organizationId } : {} }))',race='await Transaction.collection.updateOne({ _id: entry.transactionId }, { $set: { organizationId: new organizationId.constructor("111111111111111111111111") } }); '+link,raceCore=replace(original.core,link,race);
   await control('intervening-link-ownership-change',{core:raceCore},{OMF_CARD_COMPANY_LINK_RACE:'1'});
   await test('trust-body-company',{core:replace(original.core,'return commitScopedImport(ownerId, importId, body, organizationId);','return commitScopedImport(ownerId, importId, body, body.organizationId);')},'card-company:bound-company');
   const trust='(event.context.auth.organizationId ? { organizationId: new (await import("mongoose")).default.Types.ObjectId(event.context.auth.organizationId) } : await calendarCompany(event))';
   await test('trust-stale-membership',{route:replace(original.route,'await calendarCompany(event)',trust)},'card-company:current-membership');
   const mutable=section(original.core,'async function verifyPostingCompany(', 'async function claimPostingCompany(',s=>replace(replace(s,'!same(binding.organizationId, organizationId)','false'),'postingOrganizationId: { $ne: organizationId }','postingOrganizationId: { $ne: binding.organizationId }'));
   await test('accept-other-selected-company',{core:mutable},'card-company:immutable-company');
   await test('omit-company-reservation',{core:replace(original.core,'...organizationId ? { postingOrganizationId: organizationId } : {},','')},'card-company:posted');
   await test('adopt-foreign-ledger-id',{core:replace(original.core,'{ _id: entry.transactionId, organizationId, "metadata.financeEntryId": String(entry._id) }','{ _id: entry.transactionId, "metadata.financeEntryId": String(entry._id) }')},'card-company:conflicting-ledger-foreign-company');
   await test('adopt-wrong-source-ledger-id',{core:replace(original.core,'{ _id: entry.transactionId, organizationId, "metadata.financeEntryId": String(entry._id) }','{ _id: entry.transactionId, organizationId }')},'card-company:conflicting-ledger-wrong-entry-identity');
   await test('global-historical-candidates',{core:replace(original.core,'Transaction.find({ ...organizationId ? { organizationId } : {}, date:','Transaction.find({ date:')},'card-company:foreign-link');
   await test('legacy-bypass-bound-source',{core:replace(original.core,'async function verifyPostingCompany(ownerId, batch, organizationId) {','async function verifyPostingCompany(ownerId, batch, organizationId) { if (!organizationId) return null;')},'card-company:legacy-bypass');
   await test('infer-legacy-reservation-company',{core:replace(original.core,'if (organizationId && await FinanceEntry.exists({ importId: batch._id })) conflict();','')},'card-company:no-inferred-binding');
   await test('bind-before-valid-decisions',{core:replace(original.core,'await verifyPostingCompany(ownerId, initial, organizationId);','await verifyPostingCompany(ownerId, initial, organizationId); if (organizationId) await claimPostingCompany(ownerId, initial, organizationId);')},'card-company:skip-no-binding');
   await test('raw-ledger-error-log',{core:injected,route:replace(original.route,'console.error("[Finance] operation failed", error?.name || "Error");','console.error("[Finance] operation failed", error);')},'card-company:safe-error-log',{OMF_CARD_COMPANY_FAILURE:'1'});
   await test('link-without-final-company-recheck',{core:replace(raceCore,link,'if (!await Transaction.exists({ _id: entry.transactionId }))')},'card-company:link-race-ownership',{OMF_CARD_COMPANY_LINK_RACE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===12&&controls.length===5,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,controls,mutants,limits:'Eight native groups, five packaged-copy/fault/process-crash/link-race controls and twelve meaningful defects. Test crash/race injection exists only in disposable compiled copies. Lease expiry is advanced in owned test data. New API only; UI/Navi, historical/reference ownership, global readers and full operator/key/runtime privacy remain open. No live bank/model/provider call.'})};
}};

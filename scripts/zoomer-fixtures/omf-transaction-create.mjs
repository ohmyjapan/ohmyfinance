import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,readdir,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-transaction-create',covers:['server/api/transactions/index.ts','server/services/transactionService.ts','server/api/transactions/import.ts','server/api/backup/restore.ts','server/services/companyBackupService.ts','scripts/finance-transaction-create-integration.cjs','scripts/zoomer-fixtures/omf-transaction-create.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-transaction-create-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_CREATION_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_CREATION_APP_ROOT||root,result=await run(app),mutants=[];let control,pass=result.code===0&&result.text.includes('6 Company creation groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','creation-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const api=path.join(directory,'.output/server/chunks/routes/api'),matches=[];
   for(const f of(await readdir(api)).filter(f=>/^index\d*\.mjs$/.test(f)))if((await readFile(path.join(api,f),'utf8')).includes('Failed to create company transaction'))matches.push(path.join(api,f));if(matches.length!==1)throw Error('Expected one company transaction creation route');
   const files={service:path.join(directory,'.output/server/chunks/_/transactionService.mjs'),route:matches[0],models:path.join(directory,'.output/server/chunks/_/nitro.mjs'),importRoute:path.join(directory,'.output/server/chunks/routes/api/transactions/import.mjs'),backupScope:path.join(directory,'.output/server/chunks/_/companyBackupService.mjs')},original=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const reset=()=>Promise.all(Object.entries(files).map(([key,file])=>writeFile(file,original[key])));
   const test=async(name,changes,assertion,extra={})=>{try{for(const[key,source]of Object.entries(changes))await writeFile(files[key],source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false}finally{await reset()}};
   await test('missing-company-in-insert',{service:replace(original.service,'if (organizationId) transaction.set("organizationId", organizationId, { strict: false });','')},'creation:server-company');
   await test('trust-body-company',{route:replace(original.route,'}, organizationId);','}, body.organizationId);')},'creation:server-company');
   const post='if (method === "POST") {\n    await ensureConnection();\n    const { organizationId } = await calendarCompany(event);',trust='if (method === "POST") {\n    await ensureConnection();\n    const { organizationId } = (event.context.auth.organizationId ? { organizationId: new (await import("mongoose")).default.Types.ObjectId(event.context.auth.organizationId) } : await calendarCompany(event));';
   await test('trust-stale-company-membership',{route:replace(original.route,post,trust)},'creation:current-membership');
   // Final review F1/F2: the two former legacy-unassigned defects lost HTTP reach once import/restore were scoped; replaced by the import/restore authority defects.
   await test('import-trusts-row-company',{importRoute:replace(original.importRoute,'const newTransaction = await createCompanyTransaction(transactionData, organizationId);','const newTransaction = await createCompanyTransaction(transactionData, new (await import("mongoose")).default.Types.ObjectId(String(record.organizationId)));')},'creation:import-selected-company');
   await test('restore-accepts-other-company',{backupScope:replace(original.backupScope,'return String(recorded) === String(organizationId) ? "selected" : "other_company";','return "selected";')},'creation:restore-foreign-skipped');
   control=await run(directory,{OMF_CREATION_FAILURE:'1'});if(control.code!==0||!control.text.includes('1 Company creation groups passed'))pass=false;
   await test('raw-company-error-log',{service:replace(original.service,'console.error("Company transaction creation failed");','console.error("Company transaction creation failed", error);')},'creation:safe-error-log',{OMF_CREATION_FAILURE:'1'});
   await test('raw-client-error',{route:replace(original.route,'statusMessage: error?.statusCode === 400 ? "Invalid transaction data" : "Failed to create company transaction"','statusMessage: error?.statusCode === 400 ? "Invalid transaction data" : error.message')},'creation:safe-error-body',{OMF_CREATION_FAILURE:'1'});
   await test('unreviewed-card-accounting',{service:replace(original.service,'if (data.cardAccounting !== void 0) throw createError(','if (false) throw createError(')},'creation:validation-class');
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===8,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,control,mutants,limits:'Six native manual-creation groups (CSV import and own-company restore now land in the selected company), one real validation-failure control and eight meaningful defects. No migration of held legacy/card rows, full CRUD/viewer/key/runtime privacy or deployment claim.'})};
}};

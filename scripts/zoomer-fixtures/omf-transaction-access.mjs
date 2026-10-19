import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,readdir,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-transaction-access',covers:['server/services/transactionService.ts','server/api/transactions/index.ts','server/api/transactions/[id].ts','server/api/transactions/stats.ts','server/api/transactions/export.ts','scripts/finance-transaction-access-integration.cjs','scripts/zoomer-fixtures/omf-transaction-access.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-transaction-access-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_TRANSACTION_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_TRANSACTION_APP_ROOT||root,result=await run(app),mutants=[];let control,copiedControl,pass=result.code===0&&result.text.includes('7 Transaction access groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','transaction-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const api=path.join(directory,'.output/server/chunks/routes/api'),indexes=await readdir(api),matches=[];
   for(const file of indexes.filter(f=>/^index\d*\.mjs$/.test(f)))if((await readFile(path.join(api,file),'utf8')).includes('Failed to read company transactions'))matches.push(path.join(api,file));if(matches.length!==1)throw Error('Expected one compiled transaction list route');
   const files={service:path.join(directory,'.output/server/chunks/_/transactionService.mjs'),index:matches[0],detail:path.join(api,'transactions/_id_.mjs'),stats:path.join(api,'transactions/stats.mjs'),export:path.join(api,'transactions/export.mjs')},original=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const reset=()=>Promise.all(Object.entries(files).map(([key,file])=>writeFile(file,original[key])));
   const test=async(name,changes,assertion,extra={})=>{try{for(const[key,source]of Object.entries(changes))await writeFile(files[key],source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false}finally{await reset()}};
   copiedControl=await run(directory);if(copiedControl.code!==0||!copiedControl.text.includes('7 Transaction access groups passed'))throw Error('Unchanged compiled positive must pass');
   await test('global-list',{service:replace(original.service,'const query = { organizationId };','const query = {};')},'transaction:list-total');
   await test('global-detail',{service:replace(original.service,'Transaction.findOne({ _id: id, organizationId })','Transaction.findById(id)')},'transaction:detail-scope');
   await test('global-stats-amounts',{service:original.service.replaceAll('      { $match: { organizationId } },','')},'transaction:stats-scope');
   await test('global-stats-count',{service:replace(original.service,'Transaction.countDocuments({ organizationId })','Transaction.countDocuments()')},'transaction:stats-scope');
   await test('global-receipt-count',{service:replace(original.service,'Transaction.countDocuments({ organizationId, hasReceipt: true })','Transaction.countDocuments({ hasReceipt: true })')},'transaction:receipt-rate');
   const impossibleMatch=original.service.replaceAll(', model: ', ', match: { organizationId }, model: ');if(impossibleMatch.split(', match: { organizationId }, model: ').length!==15)throw Error('Expected14 real compiled populate paths');
   await test('hide-native-shared-references',{service:impossibleMatch},'transaction:native-reference-shape');
   const trust='(event.context.auth.organizationId ? { organizationId: (await import("mongoose")).default.Types.ObjectId.createFromHexString(event.context.auth.organizationId) } : await calendarCompany(event))';
   const getCompany='if (method === "GET") {\n    await ensureConnection();\n    const { organizationId } = await calendarCompany(event);';
   for(const key of['index','detail','stats','export'])await test('trust-stale-membership-'+key,{[key]:['index','detail'].includes(key)?replace(original[key],getCompany,getCompany.replace('await calendarCompany(event)',trust)):replace(original[key],'await calendarCompany(event)',trust)},'transaction:current-membership');
   await test('cacheable-list',{index:replace(original.index,'setHeader(event, "Cache-Control", "no-store");','')},'transaction:no-cache');
   let injected=replace(original.service,'const query = { organizationId };','throw new Error("TRANSACTION_INTERNAL_PRIVATE"); const query = { organizationId };');injected=replace(injected,'const transaction = await Transaction.findOne({ _id: id, organizationId })','throw new Error("TRANSACTION_INTERNAL_PRIVATE"); const transaction = await Transaction.findOne({ _id: id, organizationId })');injected=replace(injected,'const totalCount = await Transaction.countDocuments({ organizationId });','throw new Error("TRANSACTION_INTERNAL_PRIVATE"); const totalCount = await Transaction.countDocuments({ organizationId });');
   await writeFile(files.service,injected);control=await run(directory,{OMF_TRANSACTION_FAILURE:'1'});if(control.code!==0||!control.text.includes('1 Transaction access groups passed'))pass=false;await reset();
   await test('raw-service-log',{service:replace(injected,'console.error("Company transaction list read failed");','console.error("Company transaction list read failed", error);')},'transaction:safe-error-log',{OMF_TRANSACTION_FAILURE:'1'});
   await test('raw-export-error',{service:injected,export:replace(original.export,'} catch {\n    throw createError({ statusCode: 500, statusMessage: "Failed to export company transactions" });','} catch (error) {\n    throw createError({ statusCode: 500, statusMessage: error.message });')},'transaction:safe-error-body',{OMF_TRANSACTION_FAILURE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===13,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,copiedControl,control,mutants,limits:'Seven native-shape synthetic company-read groups, one unchanged compiled positive, one query-failure control and thirteen meaningful defects. Reference APIs/model are global and have no company field; root company reads remain enforced. No production/model/provider calls; no ownership migration, writer/UI/backup/key/runtime privacy or deployed verification claim.'})};
}};

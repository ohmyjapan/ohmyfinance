import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readdir,readFile,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-receipt-access',covers:['server/api/receipts/index.ts','server/api/receipts/[id].ts','server/api/receipts/export.ts','server/services/receiptService.ts','scripts/finance-receipt-access-integration.cjs','scripts/zoomer-fixtures/omf-receipt-access.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-receipt-access-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_RECEIPT_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_RECEIPT_APP_ROOT||root,result=await run(app),mutants=[];let control,pass=result.code===0&&result.text.includes('7 Receipt access groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','receipt-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const chunks=path.join(directory,'.output/server/chunks'),services=[],lists=[];
   for(const name of await readdir(chunks,{recursive:true}))if(name.endsWith('.mjs')){const source=await readFile(path.join(chunks,name),'utf8');if(source.includes('async function getReceipts(filters, organizationId)'))services.push(name);if(name.replaceAll('\\','/').startsWith('routes/api/')&&source.includes('await getReceiptStats(organizationId)'))lists.push(name)}
   if(services.length!==1||lists.length!==1)throw Error('Expected one built receipt service/list');
   const files={service:path.join(chunks,services[0]),list:path.join(chunks,lists[0]),detail:path.join(chunks,'routes/api/receipts/_id_.mjs'),export:path.join(chunks,'routes/api/receipts/export.mjs')},originals=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const test=async(name,key,source,assertion,extra={})=>{try{await writeFile(files[key],source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false}finally{await writeFile(files[key],originals[key])}};
   await test('global-list-export','service',replace(originals.service,'const query = { organizationId };','const query = {};'),'receipt:list-scope');
   await test('global-statistics','service',replace(originals.service,'{ $match: { organizationId } },',''),'receipt:stats-scope');
   await test('global-detail','detail',replace(originals.detail,'Receipt.findOne({ _id: id, organizationId })','Receipt.findById(id)'),'receipt:detail-scope');
   const trust='(event.context.auth.organizationId ? { organizationId: (await import("mongoose")).default.Types.ObjectId.createFromHexString(event.context.auth.organizationId) } : await calendarCompany(event))';
   for(const key of['list','detail','export'])await test('trust-stale-token-'+key,key,replace(originals[key],'await calendarCompany(event)',trust),'receipt:current-membership');
   const injected=replace(originals.service,'const query = { organizationId };','throw new Error("RECEIPT_INTERNAL_PRIVATE"); const query = { organizationId };');
   await writeFile(files.service,injected);control=await run(directory,{OMF_RECEIPT_FAILURE:'1'});if(control.code!==0||!control.text.includes('1 Receipt access groups passed'))pass=false;
   await test('raw-service-log','service',replace(injected,'console.error("Failed to get company receipts");','console.error("Failed to get company receipts", error);'),'receipt:safe-error-log',{OMF_RECEIPT_FAILURE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===7,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,control,mutants,limits:'Owned synthetic native HTTP only. Legacy writes/matching/analytics/backup/file/transaction-PDF and wider operator/key/runtime privacy remain open. No production records/model/provider calls or deploy.'})};
}};

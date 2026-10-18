import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default {name:'omf-support-report',covers:['components/finance/AssistantPanel.vue','components/finance/SupportReport.vue','server/api/support/report.ts','server/services/supportReportService.ts','scripts/finance-support-report-integration.cjs','scripts/finance-support-report-browser.cjs','scripts/zoomer-fixtures/omf-support-report.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-support-report-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_SUPPORT_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_SUPPORT_APP_ROOT||root,result=await run(app),mutants=[];let failureControl,pass=result.code===0;
 // A baseline-absence invocation stops here; never grant coverage on setup/missing data.
 if(pass){
  const base=path.resolve(root,'.zoomer','support-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
  await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   const file=path.join(directory,'.output/server/chunks/routes/api/support/report.mjs'),original=await readFile(file,'utf8');
   const test=async(name,source,assertion,extra={})=>{await writeFile(file,source);const r=await run(directory,{OMF_SUPPORT_BROWSER:'0',...extra}),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false};
   const replace=(anchor,replacement)=>{if(original.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return original.replace(anchor,replacement)};
   for(const [name,anchor,replacement,assertion] of [
    ['foreign-agent','FinanceChatAgent.find({ ownerId, enabled: true, revokedAt: null }','FinanceChatAgent.find({ enabled: true, revokedAt: null }','support:owner-scope'],
    ['foreign-collector','FinanceCollector.find({ ownerId, revokedAt: null }','FinanceCollector.find({ revokedAt: null }','support:owner-scope'],
    ['disabled-agent','ownerId, enabled: true, revokedAt: null','ownerId, revokedAt: null','support:disabled'],
    ['revoked-agent','ownerId, enabled: true, revokedAt: null','ownerId, enabled: true','support:revoked'],
    ['revoked-collector','FinanceCollector.find({ ownerId, revokedAt: null }','FinanceCollector.find({ ownerId }','support:revoked'],
    ['future-heartbeat',' && value.getTime() <= now','', 'support:future-heartbeat'],
    ['extra-response-field','schemaVersion: 1,','schemaVersion: 1, private: "SUPPORT_PRIVATE_SENTINEL",','support:fixed-schema']
   ])await test(name,replace(anchor,replacement),assertion);
   const injected=replace('async function supportReport(ownerId) {','async function supportReport(ownerId) { throw Error("SUPPORT_PRIVATE_SENTINEL");');
   await writeFile(file,injected);failureControl=await run(directory,{OMF_SUPPORT_BROWSER:'0',OMF_SUPPORT_FAILURE:'1'});if(failureControl.code!==0||!failureControl.text.includes('1 Support report groups passed'))pass=false;
   const safe='return failure(503, "SUPPORT_UNAVAILABLE");';if(injected.split(safe).length!==2)throw Error('Missing error boundary anchor');
   await test('raw-error-response',injected.replace(safe,'setResponseStatus(event, 503); return { error: {code: "SUPPORT_UNAVAILABLE", message: "SUPPORT_PRIVATE_SENTINEL"} };'),'support:safe-service-error',{OMF_SUPPORT_FAILURE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===8,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,failureControl,mutants,limits:'Owned synthetic DB/real Chrome only; no model/provider calls, production records, historical reliability estimate or deploy. Full operator/key/log/backup privacy remains open.'})};
}};

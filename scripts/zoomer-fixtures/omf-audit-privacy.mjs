import {execFile} from 'node:child_process';
import path from 'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readdir,readFile,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-audit-privacy',covers:['server/api/audit/index.ts','scripts/finance-audit-privacy-integration.cjs','scripts/zoomer-fixtures/omf-audit-privacy.mjs'],async run(){
 const run=(app,extra={})=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-audit-privacy-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_AUDIT_APP_ROOT:app,...extra},timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const app=process.env.OMF_AUDIT_APP_ROOT||root,result=await run(app),mutants=[];let control,pass=result.code===0&&result.text.includes('7 Audit privacy groups passed');
 if(pass){
  const base=path.resolve(root,'.zoomer','audit-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});const api=path.join(directory,'.output/server/chunks/routes/api'),matches=[];
   for(const name of await readdir(api,{recursive:true}))if(name.endsWith('.mjs')&&(await readFile(path.join(api,name),'utf8')).includes('AuditLog.countDocuments(filter)'))matches.push(name);
   if(matches.length!==1)throw Error('Expected one compiled native audit route');const file=path.join(api,matches[0]),original=await readFile(file,'utf8');
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one anchor '+anchor);return source.replace(anchor,value)};
   const test=async(name,source,assertion,extra={})=>{await writeFile(file,source);const r=await run(directory,extra),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,detected,...r});if(!detected)pass=false};
   for(const[name,anchor,value,assertion]of[
    ['global-rows','AuditLog.find(filter)','AuditLog.find({})','audit:list-scope'],
    ['global-count','AuditLog.countDocuments(filter)','AuditLog.countDocuments({})','audit:count-scope'],
    ['query-user-override','const filter = { userId: auth.userId };','const filter = { userId: query.userId || auth.userId };','audit:override'],
    ['deleted-user-read','if (!await User.exists({ _id: auth.userId })) return failure(401, "AUTH_REQUIRED");','','audit:live-user'],
    ['post-read','if (event.method !== "GET") return failure(405, "METHOD_NOT_ALLOWED");','','audit:read-method']
   ])await test(name,replace(original,anchor,value),assertion);
   const injected=replace(original,'const query = getQuery(event);','throw new Error("AUDIT_INTERNAL_PRIVATE"); const query = getQuery(event);');await writeFile(file,injected);control=await run(directory,{OMF_AUDIT_FAILURE:'1'});if(control.code!==0||!control.text.includes('1 Audit privacy groups passed'))pass=false;
   const catchAnchor='} catch {\n    console.error("Audit log query failed");';
   await test('raw-error-response',replace(replace(injected,catchAnchor,'} catch (error) {\n    console.error("Audit log query failed");'),'return failure(500, "AUDIT_UNAVAILABLE");','return failure(500, error.message);'),'audit:safe-failure-response',{OMF_AUDIT_FAILURE:'1'});
   await test('raw-error-log',replace(injected,catchAnchor,'} catch (error) {\n    console.error("Audit log query failed", error);'),'audit:safe-failure-log',{OMF_AUDIT_FAILURE:'1'});
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&mutants.length===7,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,control,mutants,limits:'Synthetic native HTTP and real auth audit writers only. No production records, model/provider calls or business sends; company audit, operator/key/log/backup privacy and shared restart-safe revocation remain open.'})};
}};

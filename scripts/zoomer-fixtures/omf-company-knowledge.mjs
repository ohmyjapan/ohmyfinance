import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Company Navi teaching, pattern recall, new chat/history and feature navigation. Runs the real compiled application against
// the integration script's own throwaway MongoDB; ambient database addresses are emptied; no model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
const marker='8 Company knowledge groups passed';
export default{name:'omf-company-knowledge',covers:['server/models/FinanceCompanyKnowledge.ts','server/models/FinanceCompanyConversationArchive.ts','server/services/companyKnowledgeService.ts','server/services/companyConversationHistoryService.ts','shared/finance-navi-features.mjs','server/models/FinanceCompanyAssistant.ts','server/services/financeCompanyAssistantService.ts','server/services/financeCompanyActionService.ts','server/services/companyTransactionAssistantService.ts','server/api/finance-chat/[...path].ts','shared/finance-assistant.mjs','scripts/finance-company-knowledge-integration.cjs','scripts/zoomer-fixtures/omf-company-knowledge.mjs'],async run(){
 const run=app=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-company-knowledge-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_COMPANY_NAVI_APP_ROOT:app},timeout:240000,maxBuffer:3*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const result=await run(root),controls=[],mutants=[];let pass=result.code===0&&result.text.includes(marker);
 if(pass){const base=path.resolve(root,'.zoomer','company-knowledge-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory),copiedPass=copied.code===0&&copied.text.includes(marker);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('recall-paused-teaching','const activeKnowledge = (organizationId) => ({ organizationId, status: "active" });','const activeKnowledge = (organizationId) => ({ organizationId });','knowledge:paused-not-recalled');
   await test('accept-model-invented-teaching','const quotedInstruction = (turnText, value) => value.trim().length >= 2 && turnText.includes(value);','const quotedInstruction = (turnText, value) => value.trim().length >= 2;','knowledge:quote-required');
   await test('unscoped-teaching-write','const knowledgeScope = (organizationId, knowledgeId) => ({ _id: knowledgeId, organizationId });','const knowledgeScope = (organizationId, knowledgeId) => ({ _id: knowledgeId });','knowledge:foreign-write');
   await test('ignore-teaching-revision','const revisionScope = (organizationId, knowledgeId, expectedRevision) => ({ ...knowledgeScope(organizationId, knowledgeId), revision: expectedRevision });','const revisionScope = (organizationId, knowledgeId, expectedRevision) => ({ ...knowledgeScope(organizationId, knowledgeId) });','knowledge:stale-revision');
   await test('unscoped-archive-read','const archiveScope = (ownerId, organizationId, archiveId) => ({ _id: archiveId, ownerId, organizationId });','const archiveScope = (ownerId, organizationId, archiveId) => ({ _id: archiveId });','knowledge:history-foreign');
   await test('regex-merchant-pattern','const literalPattern = (value) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");','const literalPattern = (value) => value;','knowledge:pattern-literal');
   await test('unchecked-record-navigation','if (!navigation?.transactionId) return true;','return true;','knowledge:foreign-record-navigation');
   await test('global-teaching-list','const companyKnowledge = (organizationId) => ({ organizationId });','const companyKnowledge = (organizationId) => ({});','knowledge:company-separation');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===8,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,controls,mutants,limits:'Eight native groups on the compiled application, one unchanged packaged control and eight meaningful compiled defects (paused recall, model-invented teaching, foreign/stale teaching writes, foreign archive read, regex pattern, foreign record navigation, cross-company list). No model/provider/browser/production calls; real-model answer quality, installed-Chrome UI and production reliability remain open.'})};
}};

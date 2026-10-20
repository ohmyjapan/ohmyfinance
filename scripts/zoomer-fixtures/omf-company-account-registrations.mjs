import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Company-registered unused accounting accounts for Navi: native create/register/choices/save/teaching on the real compiled
// application against the integration script's own throwaway MongoDB (ambient database addresses emptied), the installed-Chrome
// transaction modal, one unchanged packaged copy and meaningful compiled defects. No model, provider, bank, Slack or mail calls.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=2400000;
const nativeGroups=9,browserGroups=2,marker=n=>n+' Account registration groups passed';
export default{name:'omf-company-account-registrations',covers:['server/models/AccountCategory.ts','server/api/account-categories/index.ts','server/api/account-categories/[id].ts','server/api/account-categories/[id]/registration.ts','server/services/companyAccountRegistrationService.ts','server/services/companyTransactionAssistantService.ts','server/services/financeCompanyAssistantService.ts','server/services/companyKnowledgeService.ts','components/transaction/AccountCompanyRegistration.vue','components/transaction/TransactionFormModal.vue','scripts/finance-company-account-registrations-integration.cjs','scripts/finance-company-account-registrations-browser.cjs','scripts/zoomer-fixtures/omf-company-account-registrations.mjs'],async run(){
 const run=(app,browser)=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-company-account-registrations-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_COMPANY_NAVI_APP_ROOT:app,OMF_ACCOUNT_REGISTRATION_BROWSER:browser?'1':''},timeout:420000,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const result=await run(root,true),controls=[],mutants=[];let pass=result.code===0&&result.text.includes(marker(nativeGroups+browserGroups));
 if(pass){const base=path.resolve(root,'.zoomer','account-registration-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,false),copiedPass=copied.code===0&&copied.text.includes(marker(nativeGroups));controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('omit-registered-unused-account','const registered = await registeredAccountCatalogue(organizationId, args);','const registered = { accounts: [], hasMore: false, page: 1, limit: 50, query: null };','registration:unused-account-choice');
   await test('cross-company-registration-filter','const registrationFilter = (organizationId) => ({ isActive: true, "companyRegistrations.organizationId": organizationId });','const registrationFilter = (organizationId) => ({ isActive: true, "companyRegistrations.0": { $exists: true } });','registration:company-filter');
   await test('trust-body-company-on-create','companyRegistrationEntry(organizationId, auth.userId, "created")','companyRegistrationEntry(body.organizationId || organizationId, body.companyRegistrations?.[0]?.registeredBy || auth.userId, "created")','registration:body-forgery');
   await test('skip-fresh-membership-on-create','organizationId: await companyMembership(String(auth.userId), String(auth.organizationId))','organizationId: auth.organizationId || await companyMembership(String(auth.userId), String(auth.organizationId))','registration:fresh-membership');
   await test('expose-registration-list','companyRegistrations: { type: [CompanyRegistrationSchema], select: false, default: void 0 }','companyRegistrations: { type: [CompanyRegistrationSchema], select: true, default: void 0 }','registration:no-metadata-leak');
   await test('duplicate-registration-on-retry','{ _id: accountId, isActive: true, "companyRegistrations.organizationId": { $ne: organizationId } }','{ _id: accountId, isActive: true }','registration:retry-once');
   await test('regex-account-query','{ $regex: literalName(query), $options: "i" }','{ $regex: query, $options: "i" }','registration:literal-query');
   await test('ignore-registered-page','.skip((page - 1) * registeredPageSize)','.skip(0)','registration:pagination');
   await test('drop-parent-link','parent: row.parentId ? parents.get(String(row.parentId)) || null : null','parent: null','registration:parent-source');
   await test('drop-registered-history-parent','Object.assign(present, { registeredForCompany: true }, account.field === "subAccountCategoryId" ? { parent: account.parent } : {})','Object.assign(present, { registeredForCompany: true })','registration:history-sub-parent');
   await test('refuse-registered-teaching-reference','if (accountReferenceFields.includes(k) && await isRegisteredAccount(organizationId, k, args[k])) continue;','','registration:knowledge-eligibility');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===11,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,controls,mutants,limits:'Nine native groups plus two installed-Chrome groups on the compiled application, one unchanged packaged control and eleven meaningful compiled defects (omitted unused account, cross-company filter, body company forgery, skipped fresh membership, exposed registration list, retry duplication, regex query, ignored page, dropped parent link, refused registered teaching reference, missing history sub-account parent). No model/provider/production calls; the manual TransactionForm has no mounted page, real-model answer quality and production reliability remain open.'})};
}};

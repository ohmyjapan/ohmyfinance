import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Company budgets and recurring payments (native scheduled-business prerequisites for Navi). Runs the real compiled application
// against the integration script's own throwaway MongoDB; ambient database addresses are emptied; no model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
const marker='8 Scheduled business groups passed';
export default{name:'omf-company-scheduled-business',covers:['server/models/Budget.ts','server/models/RecurringPayment.ts','server/api/budgets/index.ts','server/api/budgets/[id].ts','server/services/companyBudgetService.ts','server/services/recurringPaymentService.ts','server/api/recurring/index.ts','server/api/recurring/[id].ts','server/api/recurring/process.ts','pages/budgets/index.vue','pages/recurring/index.vue','scripts/finance-company-scheduled-business-integration.cjs','scripts/zoomer-fixtures/omf-company-scheduled-business.mjs'],async run(){
 const run=app=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-company-scheduled-business-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_SCHEDULED_APP_ROOT:app},timeout:300000,maxBuffer:3*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const result=await run(root),controls=[],mutants=[];let pass=result.code===0&&result.text.includes(marker);
 if(pass){const base=path.resolve(root,'.zoomer','scheduled-business-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory),copiedPass=copied.code===0&&copied.text.includes(marker);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('global-budget-rows','const budgetScope = (organizationId) => ({ organizationId });','const budgetScope = (organizationId) => ({});','scheduled:budget-list-scope');
   await test('global-budget-spending','const spendingScope = (organizationId) => ({ organizationId, type: EXPENSE_TYPE });','const spendingScope = (organizationId) => ({ type: EXPENSE_TYPE });','scheduled:spending-total');
   await test('locale-free-month-overflow','const clampDay = (year, month, day) => Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());','const clampDay = (year, month, day) => day;','scheduled:month-end-clamp');
   await test('global-recurring-rows','const recurringScope = (organizationId) => ({ organizationId });','const recurringScope = (organizationId) => ({});','scheduled:recurring-list-scope');
   await test('completed-forecast','const FORECAST_STATUS = "pending";','const FORECAST_STATUS = "completed";','scheduled:forecast-pending');
   await test('random-forecast-identity','createHash("sha256").update(["omf-recurring-forecast"','createHash("sha256").update([Math.random(), "omf-recurring-forecast"','scheduled:retry-existing');
   await test('global-due-processing','const dueScope = (organizationId, through) => ({ organizationId, status: "active", autoGenerate: true, nextDueDate: { $lte: through } });','const dueScope = (organizationId, through) => ({ status: "active", autoGenerate: true, nextDueDate: { $lte: through } });','scheduled:process-selected');
   await test('manual-rows-auto-processed','const dueScope = (organizationId, through) => ({ organizationId, status: "active", autoGenerate: true, nextDueDate: { $lte: through } });','const dueScope = (organizationId, through) => ({ organizationId, status: "active", nextDueDate: { $lte: through } });','scheduled:process-selected');
   // Additional review F2 (plan omf-navi-scope-facts-20261024): a basis that again claims ordinary pages/imports carry the text.
   await test('budget-basis-claims-ordinary-pages-set-text','no ordinary OMF transaction page, form or import','every ordinary OMF transaction page, form and import','scheduled:spending-match-ui-facts');
   await test('token-company-without-membership','const { organizationId: processCompany } = await calendarCompany(event);','const processToken = requireAuth(event); if (!processToken.organizationId) throw createError({ statusCode: 403, statusMessage: "Access denied" }); const processCompany = new (await import("mongoose")).default.Types.ObjectId(processToken.organizationId);','scheduled:current-membership');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===10,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({result,controls,mutants,limits:'Eight native groups on the compiled application (budgets, spending, recurring CRUD, generation calendar, idempotency/crash/parallel, process, card-import review lane, membership/restore), one unchanged packaged control and ten meaningful compiled defects (global budget rows/spending, month overflow, global recurring rows, completed forecast, random forecast identity, global and manual due processing, a budget basis claiming ordinary pages/imports set its text, token company without fresh membership). No model/provider/browser/production calls; Navi adapters, installed-Chrome UI and production reliability remain open.'})};
}};

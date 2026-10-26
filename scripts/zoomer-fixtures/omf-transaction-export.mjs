import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Transaction export: the route's company-zone window, page-parity search and category filter, zero price and literal cells; the Navi
// prepare_company_transaction_export tool (frozen recipe, count, no rows, journal recovery); the page button and the conversation
// card in installed Chrome. Runs the real compiled application against the integration script's own throwaway MongoDB; ambient
// database addresses are emptied; no model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker=/\d+ Transaction export groups passed/;
export default{name:'omf-transaction-export',covers:['server/api/transactions/export.ts','server/services/transactionExportService.ts','shared/finance-transaction-export.mjs','shared/finance-transaction-export.d.mts','server/services/companyNaviBusinessService.ts','server/services/financeCompanyActionService.ts','shared/finance-navi-business.mjs','shared/finance-navi-business.d.mts','shared/finance-navi-features.mjs','composables/useTransactions.ts','pages/transactions/index.vue','components/finance/AssistantConversation.vue','i18n/locales/ja.json','i18n/locales/ko.json','scripts/finance-transaction-export.test.mjs','scripts/finance-transaction-export-integration.cjs','scripts/finance-company-business.test.mjs','scripts/finance-navi-features.test.mjs','scripts/zoomer-fixtures/omf-transaction-export.mjs'],async run(){
 const exec=(args,env={},timeout=900000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await exec(['--test','scripts/finance-transaction-export.test.mjs','scripts/finance-company-business.test.mjs','scripts/finance-navi-features.test.mjs']);
 const run=(app,browser)=>exec([path.join(root,'scripts/finance-transaction-export-integration.cjs')],{OMF_EXPORT_APP_ROOT:app,OMF_TRANSACTION_EXPORT_BROWSER:browser?'1':''});
 const result=await run(root,true),controls=[],mutants=[];let pass=unit.code===0&&result.code===0&&marker.test(result.text);
 if(pass){const base=path.resolve(root,'.zoomer','transaction-export-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,false),copiedPass=copied.code===0&&marker.test(copied.text);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('M1-final-day-cut','zonedDayStart(addDayKey(criteria.dateTo, 1), timeZone)','zonedDayStart(criteria.dateTo, timeZone)','export:final-day');
   await test('M2-search-dropped','if (criteria.search) transactions = transactions.filter((row) => exportSearchMatches(row, criteria.search));','','export:search');
   await test('M3-zero-price-blank','productPrice: transaction.productPrice ?? "",','productPrice: transaction.productPrice || "",','export:zero-price');
   // The export route's own head (its criteria line makes the anchor unique among the route chunks).
   const routeHead='const { organizationId } = await calendarCompany(event);\n  try {\n    const query = getQuery(event);\n    const format = String(query.format || "csv").toLowerCase();\n    const criteria = exportCriteriaFromQuery(query);';
   await test('M4-trust-stale-membership',routeHead,routeHead.replace('await calendarCompany(event)','(event.context.auth.organizationId ? { organizationId: (await import("mongoose")).default.Types.ObjectId.createFromHexString(event.context.auth.organizationId) } : await calendarCompany(event))'),'export:current-membership');
   await test('M5-rows-in-tool-result','snapshot: "none_recipe_for_current_matching_records"','snapshot: "none_recipe_for_current_matching_records", rows: transactions','export:no-content-in-result');
   await test('M6-recover-null','recover: exportRecover','recover: unprovableDelete','export:lost-reply-done');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===6,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit,result,controls,mutants,limits:'Unit contracts; five native groups plus one installed-Chrome group on the compiled application with its own MongoDB; one unchanged packaged control and six named compiled defects. Synthetic worker replies only: no model/provider/production calls. Whether the product model prepares an export only on an instruction, the final independent review and production reliability remain open.'})};
}};

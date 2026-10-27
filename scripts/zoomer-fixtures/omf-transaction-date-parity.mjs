import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Transaction date parity and fiscal-period facts: the Navi list and pattern reads resolve date keys to the company's whole local days
// exactly as the export route does (EX03: 2 vs 3 rows for the same keys), the transactions page filters in the company zone so the
// visible set equals the button export, and the claim facts carry current/previous/next fiscal periods (EX02 called the current
// fiscal year the previous one). Runs the real compiled application against the integration script's own throwaway MongoDB; ambient
// database addresses are emptied; no model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker=/\d+ Transaction date parity groups passed/;
export default{name:'omf-transaction-date-parity',covers:['server/services/companyTransactionAssistantService.ts','server/services/transactionExportService.ts','server/services/companyNaviSummaryService.ts','server/services/financeCompanyAssistantService.ts','composables/useTransactions.ts','pages/transactions/index.vue','shared/finance-navi-business.mjs','shared/finance-navi-business.d.mts','docs/navi-company-workspace.md','scripts/finance-navi-date-parity.test.mjs','scripts/finance-transaction-date-parity-integration.cjs','scripts/zoomer-fixtures/omf-transaction-date-parity.mjs'],async run(){
 const exec=(args,env={},timeout=900000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await exec(['--test','scripts/finance-navi-date-parity.test.mjs']);
 const run=(app,browser)=>exec([path.join(root,'scripts/finance-transaction-date-parity-integration.cjs')],{OMF_PARITY_APP_ROOT:app,OMF_TRANSACTION_DATE_PARITY_BROWSER:browser?'1':''});
 const result=await run(root,true),controls=[],mutants=[];let pass=unit.code===0&&result.code===0&&marker.test(result.text);
 if(pass){const base=path.resolve(root,'.zoomer','transaction-date-parity-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,false),copiedPass=copied.code===0&&marker.test(copied.text);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('M1-list-resolution-dropped','await companyDateFilters(organizationId, filters)','{ filters, window: null }','parity:list-final-day');
   await test('M2-patterns-resolution-dropped','await companyDateFilters(organizationId, dates)','{ filters: dates, window: null }','parity:patterns-final-day');
   // The shared module is carried verbatim into its server chunk, so this anchor is its dense source form.
   await test('M3-previous-is-current','previous:fiscalYearFor(addDayKey(current.start,-1),startMonth)','previous:fiscalYearFor(current.start,startMonth)','parity:fiscal-previous');
   await test('M4-fiscal-periods-removed','fiscalPeriods: {','fiscalPeriodsRemoved: {','parity:fiscal-facts');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===4,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit,result,controls,mutants,limits:'Unit pins of fiscalPeriodsFor and the zone-day edges; three native groups plus one installed-Chrome group (two browser zones) on the compiled application with its own MongoDB; one unchanged packaged control and four named compiled defects. Client-bundle mutants are not attempted (hashed chunks); the page leg is asserted positively. Synthetic worker replies only: no model/provider/production calls. Whether the product model names the fiscal year correctly with the new facts, the final independent review and production reliability remain open.'})};
}};

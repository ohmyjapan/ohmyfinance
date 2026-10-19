import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=900000;
export default{name:'omf-card-accounting-company',covers:['scripts/finance-accounting-integration.cjs','scripts/finance-aplus-integration.cjs','scripts/zoomer-fixtures/omf-card-accounting-company.mjs'],async run(){
 const run=(app,mode)=>new Promise(resolve=>{const env={...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',MONGOMS_SYSTEM_BINARY:path.resolve(root,'../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.1.exe')};for(const k of Object.keys(env))if(k.startsWith('OMF_TEST_'))delete env[k];env[mode]='1';execFile(process.execPath,[path.join(app,'scripts/finance-integration.cjs')],{cwd:app,windowsHide:true,env,timeout:180000,maxBuffer:2*1024*1024},(e,stdout,stderr)=>resolve({mode,code:e?e.code??1:0,text:stdout+stderr}))});
 const modes=['OMF_TEST_ACCOUNTING_ONLY','OMF_TEST_APLUS_ONLY'];
 // Keep two full HTTP/Mongo startups sequential; the parallel copied control timed out during native registration.
 const positive=async app=>{const results=[];for(const mode of modes)results.push(await run(app,mode));return results};
 const results=await positive(root),controls=[],mutants=[];let pass=results.every(r=>r.code===0);
 if(pass){
  const base=path.resolve(root,'.zoomer','card-accounting-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});await cp(path.join(root,'shared'),path.join(directory,'shared'),{recursive:true,dereference:true});await mkdir(path.join(directory,'scripts'),{recursive:true});for(const file of['finance-integration.cjs','finance-accounting-integration.cjs','finance-aplus-integration.cjs'])await cp(path.join(root,'scripts',file),path.join(directory,'scripts',file));
   const files={core:path.join(directory,'.output/server/chunks/_/nitro.mjs'),export:path.join(directory,'.output/server/chunks/routes/api/transactions/export.mjs')},original=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await readFile(file,'utf8')])));
   const replace=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Expected one compiled anchor '+anchor);return source.replace(anchor,value)};
   const reset=()=>Promise.all(Object.entries(files).map(([key,file])=>writeFile(file,original[key])));
   const copied=await positive(directory),copiedPass=copied.every(r=>r.code===0);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,results:copied});if(!copiedPass)throw Error('Unchanged packaged copy must pass before mutations');
   const test=async(name,key,anchor,value,assertion,mode=modes[0])=>{try{await writeFile(files[key],replace(original[key],anchor,value));const result=await run(directory,mode),detected=result.code!==0&&result.text.includes('AssertionError')&&result.text.includes(assertion);mutants.push({name,detected,assertion,...result});if(!detected)pass=false}finally{await reset()}};
   const construct='const transaction = new Transaction$1({ ...payload, _id: entry.transactionId, createdAt: now, updatedAt: now, __v: 0 });';
   await test('drop-reviewed-card-snapshot','core',construct,construct.replace('...payload,','...payload, cardAccounting: undefined,'),'company-accounting:card-snapshot');
   await test('replace-transaction-company','core','transaction.set("organizationId", organizationId, { strict: false });','transaction.set("organizationId", new organizationId.constructor("111111111111111111111111"), { strict: false });','company-accounting:transaction-company');
   await test('alter-source-amount','core',construct,construct.replace('...payload,','...payload, amount: payload.amount + 1,'),'company-accounting:source-amount');
   await test('treat-zero-purchase-tax-as-missing','core',construct,construct.replace('...payload,','...payload, taxRate: payload.taxRate || 10,'),'company-accounting:purchase-zero-tax');
   await test('drop-zero-percent-export','export','transaction.taxRate === null || transaction.taxRate === void 0 ? "" : String(transaction.taxRate) + "%"','transaction.taxRate ? String(transaction.taxRate) + "%" : ""','company-accounting:export-zero-tax');
   await test('mix-purchase-and-card-tax-export','export','cardTaxCategory: transaction.cardAccounting?.taxCategory || ""','cardTaxCategory: String(transaction.taxRate) + "%"','company-accounting:export-card-tax');
   await test('use-primary-card-for-supplementary-purchase','core','cardNumber: row.cardIdentifier.slice(-4),','cardNumber: view.account.primaryCard.slice(-4),','company-aplus:supplementary-card',modes[1]);
  }catch(error){pass=false;mutants.push({setupError:String(error.message),detected:false})}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===7,databaseCoverage:{executed:results.every(r=>r.code===0),ownedProcess:results.every(r=>r.code===0)},message:JSON.stringify({results,controls,mutants,limits:'Native synthetic accounting7/Aplus6 grouped checks, one packaged-copy control and seven named actual-path defects. Original runtime source/build unchanged. UI/Navi turn/history binding, full reference isolation, legacy corpus/production observations and final deployed replay remain open; counts are not a reliability rate.'})};
}};

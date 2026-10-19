import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Final review F1 (CSV import) and F2 (restore) plus the same-pair backup export, on the real compiled application against the
// integration script's own throwaway MongoDB. Ambient database addresses and model/business secrets are emptied; installed Chrome only.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=3600000;
const SERVER='import,restore,export,navi',FULL=SERVER+',browser',complete=part=>'IMPORT_RESTORE_COMPLETE parts='+part;
// Compiled defects: [name, actual compiled anchor, replacement, named assertion that must fail].
const mongooseId=v=>'new (await import("mongoose")).default.Types.ObjectId(String('+v+'))',tokenCompany='(event.context.auth?.organizationId ? { organizationId: '+mongooseId('event.context.auth.organizationId')+' } : await calendarCompany(event))';
const DEFECTS=[
 ['import-legacy-unassigned-writer','const newTransaction = await createCompanyTransaction(transactionData, organizationId);','const newTransaction = await createCompanyTransaction(transactionData, void 0);','import:selected-company'],
 ['import-trust-body-company','const newTransaction = await createCompanyTransaction(transactionData, organizationId);','const newTransaction = await createCompanyTransaction(transactionData, '+mongooseId('body.organizationId')+');','import:selected-company'],
 ['import-global-duplicate','await Transaction.findOne({\n            organizationId,\n            date: transactionDate,','await Transaction.findOne({\n            date: transactionDate,','import:company-duplicate'],
 ['import-token-without-membership','await ensureConnection();\n  const { organizationId } = await calendarCompany(event);\n  const body = await readBody(event);','await ensureConnection();\n  const { organizationId } = '+tokenCompany+';\n  const body = await readBody(event);','import:denied current-membership'],
 ['restore-rehome-unassigned','if (recorded === void 0 || recorded === null || recorded === "") return "unassigned";','if (recorded === void 0 || recorded === null || recorded === "") return "selected";','restore:recorded-company-only'],
 ['restore-rehome-foreign','return String(recorded) === String(organizationId) ? "selected" : "other_company";','return "selected";','restore:recorded-company-only'],
 ['restore-file-company','doc.set("organizationId", organizationId, { strict: false });\n        if (key === "recurringPayments")','if (key === "recurringPayments")','restore:trusted-company'],
 ['restore-forged-creator','if (key === "recurringPayments") doc.set("createdBy", actor, { strict: false });','if (key === "recurringPayments") doc.set("createdBy", item.createdBy || actor, { strict: false });','restore:trusted-creator'],
 ['restore-keeps-navi-marker','"ownerId", "naviOperation", "cardAccounting"]','"ownerId", "cardAccounting"]','restore:no-marker'],
 ['restore-global-clear','.collection.deleteMany({ organizationId })','.collection.deleteMany({})','restore:clear-scoped'],
 ['restore-clear-without-company-rows','if (prepared[key].length > 0 || section.length === 0 && provesCompanySnapshot(backupData, organizationId)) clear.add(key);','if (true) clear.add(key);','restore:no-eligible-no-clear'],
 ['restore-global-duplicate','await models[key].exists({ organizationId, $or: keys })','await models[key].exists({ $or: keys })','restore:company-duplicate'],
 ['restore-raw-row-error-log','} catch {\n          console.error("Company backup restore: one row could not be saved");','} catch (rowError) {\n          console.error("Company backup restore: one row could not be saved", rowError);','restore:safe-log'],
 ['restore-echo-parse-error','} catch {\n      backupData = null;\n    }','} catch (parseError) {\n      throw createError({ statusCode: 400, statusMessage: String(parseError.message) });\n    }','restore:safe-error'],
 ['export-all-companies','const transactions = await Transaction.find({ organizationId }).lean();','const transactions = await Transaction.find({}).lean();','export:selected-company'],
 ['export-token-without-membership','const { organizationId } = await calendarCompany(event);\n  try {\n    await ensureConnection();\n    const query = getQuery(event);','const { organizationId } = '+tokenCompany+';\n  try {\n    await ensureConnection();\n    const query = getQuery(event);','export:current-membership']
];
export default{name:'omf-company-import-restore',covers:['server/api/transactions/import.ts','server/api/backup/restore.ts','server/api/backup/index.ts','server/services/companyBackupService.ts','pages/settings/index.vue','pages/transactions/upload.vue','scripts/finance-company-import-restore-integration.cjs','scripts/finance-company-import-restore-browser.cjs','scripts/zoomer-fixtures/omf-company-import-restore.mjs'],async run(){
 const run=(app,part)=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-company-import-restore-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_SETUP_TOKEN:'',SLACK_BOT_TOKEN:'',OMF_IMPORT_RESTORE_APP_ROOT:app,OMF_IMPORT_RESTORE_PART:part},timeout:900000,maxBuffer:8*1024*1024},(e,stdout,stderr)=>resolve({part,code:e?e.code??1:0,text:stdout+stderr})));
 const passed=r=>r.code===0&&r.text.includes(complete(r.part)),brief=r=>({...r,text:r.text.length>6000?r.text.slice(0,1500)+'\n...\n'+r.text.slice(-4500):r.text});
 // Each review finding alone first (F1 import, F2 restore), then the complete native + installed-Chrome suite.
 const findings=[await run(root,'import'),await run(root,'restore')],full=await run(root,FULL),controls=[],mutants=[];
 let pass=findings.every(passed)&&passed(full);
 if(pass){const base=path.resolve(root,'.zoomer','import-restore-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,SERVER),copiedPass=passed(copied);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...brief(copied)});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   for(const[name,anchor,replacement,assertion]of DEFECTS){let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,SERVER),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...brief(r)});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}}
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&DEFECTS.length>0&&controls.length===1&&mutants.length===DEFECTS.length,databaseCoverage:{executed:full.code===0,ownedProcess:full.code===0},message:JSON.stringify({findings:findings.map(brief),full:brief(full),controls,mutants,limits:'F1 import and F2 restore each run alone, then the complete compiled native suite (import, restore, export, Navi reads) with the installed-Chrome leg, one unchanged packaged control (server legs) and named compiled defects. Duplicate checks are not atomic (recorded, no exactly-once claim). No model/provider/production calls; global search/notification/scheduled-backup/templates routes remain open G4 work.'})};
}};

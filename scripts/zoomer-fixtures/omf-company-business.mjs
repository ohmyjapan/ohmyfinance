import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Company business Navi adapters (normal finance create/delete/edit, budgets/recurring, profile/summary/receipts/history, scoped
// reports/analytics/tax, escaped invoice print preview, GUI refresh). Runs the real compiled application against the integration
// script's own throwaway MongoDB; ambient database addresses are emptied; installed Chrome headless; no model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker='23 Company business groups passed',nativeMarker='18 Company business groups passed';
export default{name:'omf-company-business',covers:['shared/finance-navi-business.mjs','server/services/companyNaviBusinessService.ts','server/services/companyNaviSummaryService.ts','server/services/financeCompanyAssistantService.ts','server/services/financeCompanyActionService.ts','server/services/companyInvoiceWriteService.ts','server/services/companyPaymentWriteService.ts','server/services/transactionService.ts','server/services/companyTransactionAssistantService.ts','server/api/payments/index.ts','server/api/payments/[id].ts','server/api/invoices/[id].ts','server/api/invoices/[id]/pdf.ts','server/api/reports/index.ts','server/api/reports/tax.ts','server/api/analytics/index.ts','shared/finance-assistant.mjs','shared/finance-navi-features.mjs','components/finance/AssistantPanel.vue','components/finance/AssistantConversation.vue','stores/assistant.ts','pages/index.vue','pages/transactions/index.vue','pages/transactions/[id].vue','pages/invoices/index.vue','pages/budgets/index.vue','scripts/finance-company-business.test.mjs','scripts/finance-company-business-integration.cjs','scripts/finance-company-business-browser.cjs','scripts/zoomer-fixtures/omf-company-business.mjs'],async run(){
 const exec=(args,env={},timeout=600000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:4*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await exec(['--test','scripts/finance-company-business.test.mjs','scripts/finance-assistant.test.mjs','scripts/finance-navi-features.test.mjs']);
 const run=(app,browser)=>exec([path.join(root,'scripts/finance-company-business-integration.cjs')],{OMF_BUSINESS_APP_ROOT:app,OMF_COMPANY_BUSINESS_BROWSER:browser?'1':'',OMF_RECEIPT_NAV_BROWSER:browser?'1':'',OMF_RECEIPT_LIBRARY_BROWSER:browser?'1':''});
 const result=await run(root,true),controls=[],mutants=[];let pass=unit.code===0&&result.code===0&&result.text.includes(marker);
 if(pass){const base=path.resolve(root,'.zoomer','company-business-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server/chunks'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await run(directory,false),copiedPass=copied.code===0&&copied.text.includes(nativeMarker);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,...r});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('global-summary','const summaryScope = (organizationId) => ({ organizationId });','const summaryScope = (organizationId) => ({});','business:summary-company');
   await test('assume-default-currency','const summaryCurrency = (raw) => currencyCode(raw);','const summaryCurrency = (raw) => currencyCode(raw) || "JPY";','business:summary-unknown-currency');
   await test('drop-last-local-day','const end = zonedDayStart(addDayKey(dateTo, 1), timeZone);','const end = zonedDayStart(dateTo, timeZone);','business:summary-end-day');
   await test('receipt-link-unscoped','return await Transaction.exists({ _id: r.transactionId, organizationId }) ?','return await Transaction.exists({ _id: r.transactionId }) ?','business:receipt-link-checked');
   await test('unchecked-create-reference','if (args[key] !== void 0 && !await model.exists({ _id: args[key] })) bad(400, "Choose an existing transaction reference");','void 0;','business:create-reference-exists');
   await test('marker-after-insert','if (operation?.naviOperation) transaction.set("naviOperation", operation.naviOperation);','','business:create-marker');
   // Treating an unprovable delete as proven first reports a refused (card-import) delete as done.
   await test('unprovable-delete-reported-done','const unprovableDelete = async () => null;','const unprovableDelete = async (c, op) => ({ operationId: op.operationId, payloadHash: op.payloadHash, appliedAt: /* @__PURE__ */ new Date(), requestedFields: [] });','business:delete-source-protected');
   await test('delete-without-snapshot','if (operation) removal.updatedAt = new Date(operation.expectedUpdatedAt);','','business:delete-snapshot');
   await test('delete-imported-card-row','if (current.cardAccounting || current.metadata?.financeEntryId)','if (false)','business:delete-source-protected');
   await test('hard-delete-issuer-bill','if (current.source?.kind === "card-statement") {','if (false) {','business:suppress-sourced');
   await test('global-report','const reportScope = { organizationId };','const reportScope = {};','business:reports-company');
   await test('global-comparison-period','{ $match: { organizationId, date: { $gte: previousStart, $lte: previousEnd } } }','{ $match: { date: { $gte: previousStart, $lte: previousEnd } } }','business:analytics-comparison');
   await test('global-tax-report','const taxScope = { organizationId, date: { $gte: startDate, $lte: endDate } };','const taxScope = { date: { $gte: startDate, $lte: endDate } };','business:tax-company');
   await test('unescaped-print','const escapeHtml = (value) => String(value ?? "").replace(/[&<>"\']/g,','const escapeHtml = (value) => String(value ?? "").replace(/(?!)/g,','business:pdf-escaped');
   await test('echo-invoice-private-values','const invoiceResultValues = (values) => ({','const invoiceResultValues = (values) => values || ({','business:invoice-private-result');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===15,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit,result,controls,mutants,limits:'Unit contracts; twelve native groups plus one installed-Chrome group on the compiled application with its own MongoDB; one unchanged packaged control and fifteen meaningful compiled defects. Synthetic worker replies only: no model/provider/production calls. Real product model dialogue, live public web, final independent review and production reliability remain open.'})};
}};

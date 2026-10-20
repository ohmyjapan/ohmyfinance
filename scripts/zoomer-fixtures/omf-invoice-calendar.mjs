import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Invoice -> income calendar entry (one initial saved snapshot per invoice) for the native route and company Navi. Runs the real
// compiled application against the integration script's own throwaway MongoDB (ambient addresses emptied), installed Chrome
// headless for the UI leg, then an unchanged packaged copy and meaningful compiled defects. No model, provider or business sends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker='9 Invoice calendar groups passed',nativeMarker='8 Invoice calendar groups passed';
export default{name:'omf-invoice-calendar',covers:['server/models/Payment.ts','server/services/companyInvoiceCalendarService.ts','server/api/invoices/[id]/calendar.ts','server/services/companyNaviBusinessService.ts','server/services/financeCompanyAssistantService.ts','shared/finance-navi-business.mjs','shared/finance-navi-features.mjs','components/finance/AssistantConversation.vue','teaching-worker/interpreter.mjs','scripts/finance-invoice-calendar-integration.cjs','scripts/finance-invoice-calendar-browser.cjs','scripts/zoomer-fixtures/omf-invoice-calendar.mjs'],async run(){
 const exec=(args,env={},timeout=900000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:6*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,text:stdout+stderr})));
 const unit=await exec(['--test','scripts/finance-company-business.test.mjs','scripts/finance-navi-features.test.mjs','scripts/finance-assistant.test.mjs','scripts/finance-interpreter-stream.test.mjs','scripts/finance-calendar-money.test.mjs']);
 const run=(app,browser)=>exec([path.join(root,'scripts/finance-invoice-calendar-integration.cjs')],{OMF_INVOICE_CALENDAR_APP_ROOT:app,...(browser?{OMF_INVOICE_CALENDAR_BROWSER:'1'}:{})});
 const result=await run(root,true),controls=[],mutants=[];let pass=unit.code===0&&result.code===0&&result.text.includes(marker);
 if(pass){const base=path.resolve(root,'.zoomer','invoice-calendar-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output','server'));
   const texts=new Map(await Promise.all(chunks.map(async f=>[f,await readFile(f,'utf8')])));
   const locate=anchor=>{const found=[...texts].filter(([,t])=>t.split(anchor).length===2);if(found.length!==1)throw Error('Expected one compiled chunk with one anchor '+anchor+' (found '+found.length+')');return found[0][0]};
   const copied=await run(directory,false),copiedPass=copied.code===0&&copied.text.includes(nativeMarker);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,edits,assertion)=>{const files=new Map();for(const [a,b] of edits){const f=locate(a);files.set(f,(files.get(f)||texts.get(f)).replace(a,b))}try{for(const [f,t] of files)await writeFile(f,t);const r=await run(directory,false),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,code:r.code,text:r.text.slice(-6000)});if(!detected)pass=false}finally{for(const f of files.keys())await writeFile(f,texts.get(f))}};
   await test('claim-invoice-never-delivered',[['deliveryEvidence: "not_verified_by_calendar_link"','delivery: "not_sent_saved_record_only"']],'invoice-calendar:delivery-not-inferred');
   await test('uncanonical-invoice-id',[['"omf-invoice-calendar|" + invoiceId.toLowerCase()','"omf-invoice-calendar|" + invoiceId']],'invoice-calendar:uppercase-marker-recovery');
   await test('schedule-foreign-invoice',[['const invoice = await Invoice.findOne({ _id, organizationId }).lean();','const invoice = await Invoice.findOne({ _id }).lean();']],'invoice-calendar:foreign-invoice');
   await test('accept-body-fields',[['Object.keys(body).some((k) => k !== "expectedUpdatedAt")','Object.keys(body).some((k) => k === "__never__")']],'invoice-calendar:body-forgery');
   await test('ignore-invoice-snapshot',[['if (iso(invoice.updatedAt) !== expected)','if (false)']],'invoice-calendar:stale-native');
   await test('resync-existing-entry',[['if (existing) return { outcome: "existing", ...view(invoice, existing) };','if (existing) { await Payment.updateOne({ _id: existing._id }, { $set: { amount: invoice.total, dueDate: calendarDay(invoice.dueDate) } }); return { outcome: "existing", ...view(invoice, existing) }; }']],'invoice-calendar:repeat-existing');
   await test('fail-on-duplicate-race',[['if (!raced) throw error;','throw error;']],'invoice-calendar:concurrent-native');
   await test('random-entry-id',[['_id: invoicePaymentId(String(_id)),','_id: invoicePaymentId(String(_id) + "-other"),']],'invoice-calendar:navi-recover');
   await test('corrupt-navi-marker',[['...operation.naviOperation ? { naviOperation: operation.naviOperation } : {}','...operation.naviOperation ? { naviOperation: { ...operation.naviOperation, payloadHash: "BROKEN" } } : {}']],'invoice-calendar:navi-recover');
   await test('claim-settlement-for-paid',[['status: STATUS[invoice.status],','status: STATUS[invoice.status], settledAt: new Date(),']],'invoice-calendar:no-settlement-claim');
   await test('sent-means-paid',[['sent: "pending"','sent: "paid"']],'invoice-calendar:status-map');
   await test('default-unknown-currency',[['if (!calendarCurrencies.includes(invoice.currency))','if (false)'],['currency: invoice.currency,\n    dueDate: calendarDay(invoice.dueDate),','currency: calendarCurrencies.includes(invoice.currency) ? invoice.currency : "JPY",\n    dueDate: calendarDay(invoice.dueDate),']],'invoice-calendar:unsupported-currency');
   await test('hide-invoice-drift',[['if (link.snapshot.total !== invoice.total) out.push("total");','']],'invoice-calendar:drift');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===13,databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit:{code:unit.code,text:unit.text.slice(-4000)},result:{code:result.code,text:result.text.slice(-8000)},controls:controls.map(c=>({name:c.name,pass:c.pass,code:c.code,text:c.text.slice(-3000)})),mutants,limits:'Eight native groups plus one installed-Chrome group on the compiled app with an owned throwaway MongoDB, one unchanged packaged control and thirteen compiled defects (company scope, body ownership, stale snapshot, resync, duplicate race, deterministic id, marker, settlement claim, status map, currency fallback, drift, unproved delivery and mixed-case invoice recovery). Synthetic owned scenarios only: no production rows exist for this link, so this is acceptance, not a historical replay or reliability rate. No model/provider/production calls.'})};
}};

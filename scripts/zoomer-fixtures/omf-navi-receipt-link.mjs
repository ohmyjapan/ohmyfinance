import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Saved receipt link/unlink (Navi tools, native match route and dialog, auto-match, durable badge synchronization and its scheduler).
// Runs the real compiled application against owned throwaway MongoDB instances created by the integration scripts; ambient database
// addresses and the hub's sensitive keys are removed from every child; installed Chrome headless with an owned profile; synthetic
// records and worker replies only: no model, provider, production or business sends. No-argument run: no model call.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=5400000;
const SENSITIVE=['ANTHROPIC_API_KEY','GEMINI_API_KEY','GROK_API_KEY','IMAP_PASSWORD','SMTP_PASSWORD','VAPID_PRIVATE_KEY','AUTH_PASSWORD','RIRI_BROWSERS_API_KEY','VOYAGE_API_KEY','MONGODB_URI','RIRI_MONGODB_URI','GOOGLE_PRIVATE_KEY'];
const cleanEnv=()=>{const env={...process.env};for(const k of SENSITIVE)delete env[k];return env};
// Deliberately reintroduced defects in the compiled copy, each with the behavioral tag that must fail (filled from the built anchors).
const MUTANTS=[
 // The parent's stale derived-write race: the projection write no longer checks the request revision.
 {name:'unfenced-projection',anchor:'{ _id: transactionId, organizationId, "receiptSync.rev": rev, receiptFilePath: file }',replacement:'{ _id: transactionId, organizationId, receiptFilePath: file }',only:'race-different-receipts',assertion:'race-different-receipts'},
 // No request bump after the truth write: an older computation is no longer fenced out (the counter never advances).
 {name:'no-bump-after-truth',anchor:'{ $inc: { "receiptSync.rev": 1 } }, { new: true, projection: { receiptSync: 1 }, timestamps: false }',replacement:'{ $inc: { "receiptSync.rev": 0 } }, { new: true, projection: { receiptSync: 1 }, timestamps: false }',only:'race-different-receipts',assertion:'race-different-receipts'},
 // Owed work cleared with the truth write: an interrupted writer leaves nothing for recovery.
 {name:'early-pending-clear',anchor:'return { rev, pending: true, state: "pending",',replacement:'return { rev, pending: false, state: "synced",',only:'boundary-link:after-truth',assertion:'boundary-link:after-truth'},
 // The clear ignores the processed revision: an expired owner clears newer owed work.
 {name:'clear-without-revision',anchor:'{ _id: receipt._id, organizationId, "linkSync.rev": sync.rev, "linkSync.pending": true }',replacement:'{ _id: receipt._id, organizationId, "linkSync.pending": true }',only:'expired-owner',assertion:'expired-owner'},
 // A failure is recorded without its claim and count fence: an expired owner's failure lands on the live owner's attempt.
 {name:'failure-ignores-claim',anchor:'{ _id: receiptId, "linkSync.rev": rev, "linkSync.claimToken": claimToken, "linkSync.attempts": attempts, "linkSync.pending": true }',replacement:'{ _id: receiptId, "linkSync.rev": rev, "linkSync.pending": true }',only:'expired-owner-failure',assertion:'expired-owner-failure'},
 // Parent item 1/5: timeline events without their durable key condition are appended again by a late retry.
 {name:'event-key-ignored',anchor:'{ _id: transactionId, organizationId, "timeline.key": { $ne: w.key } }',replacement:'{ _id: transactionId, organizationId }',only:'late-retry-after-50',assertion:'late-retry-after-50'},
 // Parent item 4: a target deleted after the bump is assumed synchronized.
 {name:'missing-after-bump-assumed-synced',anchor:'if (!t) return MISSING;',replacement:'if (!t) return true;',only:'deleted-after-bump',assertion:'deleted-after-bump'},
 // Parent item 6: attempts are no longer counted at the claim, so an interrupted tenth failure allows an eleventh attempt.
 {name:'attempt-not-counted-at-claim',anchor:'"linkSync.claimUntil": new Date(at.getTime() + leaseMs) }, $inc: { "linkSync.attempts": 1 } }',replacement:'"linkSync.claimUntil": new Date(at.getTime() + leaseMs) } }',only:'tenth-failure-crash',assertion:'tenth-failure-crash'},
 // A Navi receipt reported done from its marker while the badge is still owed.
 {name:'done-while-pending',anchor:'if (!found || found.pending) return null;',replacement:'if (!found) return null;',only:'navi-pending-not-done',assertion:'navi-pending-not-done'},
 // The scheduler no longer runs: an interrupted save waits for a later user call forever.
 {name:'scheduler-disabled',anchor:'runReceiptSyncRecovery().catch(',replacement:'Promise.resolve().catch(',only:'boundary-link:after-truth',assertion:'boundary-link:after-truth'},
 // The badge is never set from the canonical receipts.
 {name:'badge-not-derived',anchor:'$set: { hasReceipt: flag,',replacement:'$set: { hasReceipt: false,',only:'boundary-link:after-truth',assertion:'boundary-link:after-truth'},
 // The receipt read loses its company scope (the canonical write then follows the receipt's own company).
 {name:'receipt-unscoped',anchor:'const receipt = await Receipt.findOne({ _id: receiptId, organizationId }).select("organizationId status transactionId linkSync updatedAt")',replacement:'const receipt = await Receipt.findOne({ _id: receiptId }).select("organizationId status transactionId linkSync updatedAt")',only:'company-scope',assertion:'company-scope'},
 // The native route's fresh membership door is bypassed.
 {name:'match-route-door-removed',anchor:'const { organizationId } = await calendarCompany(event);\n  const receiptId = event.context.params?.id;',replacement:'const { organizationId } = await calendarCompany(event).catch(() => ({ organizationId: null }));\n  const receiptId = event.context.params?.id;',only:'company-scope',assertion:'company-scope'},
 // Auto-match reads every company's unmatched receipts.
 {name:'auto-match-unscoped',anchor:'Receipt.find({ status: "unmatched", organizationId })',replacement:'Receipt.find({ status: "unmatched" })',only:'company-scope',assertion:'company-scope'},
 // The native match dialog loses the session header again (its list is empty).
 {name:'dialog-without-session',anchor:'$fetch("/api/transactions",{headers:R.authHeader});if(m.value=(v?.transactions',replacement:'$fetch("/api/transactions");if(m.value=(v?.transactions',only:'chrome-passed',assertion:'chrome-passed',browser:true},
 // Parent Q9: a completion that repaired other owed transactions no longer names them (their open pages stay stale).
 {name:'affected-ids-dropped',anchor:'...all.some((t) => t !== String(transactionId || "")) ? { affectedTransactionIds: all } : {}',replacement:'...{}',only:'affected-transactions',assertion:'affected-transactions'},
 // Parent Q9: a legacy pointer to another company is treated as an owned affected transaction.
 {name:'foreign-pointer-owned',anchor:'if (mongoose.isValidObjectId(id) && await Transaction.exists({ _id: id, organizationId })) owned.push(id);',replacement:'owned.push(id);',only:'foreign-pointer-not-exposed',assertion:'foreign-pointer-not-exposed'},
 // Parent item 8: the dialog hides a transaction that already has a receipt or its own file again.
 {name:'dialog-hides-receipted-targets',anchor:'if(m.value=(v?.transactions||[]).map(',replacement:'if(m.value=(v?.transactions||[]).filter(p=>!p.hasReceipt).map(',only:'chrome-passed',assertion:'chrome-passed',browser:true}
];
const groupMarks=['receipt link/unlink Navi tools','native receipt match route and auto-match'];
export default{name:'omf-navi-receipt-link',covers:['server/models/Receipt.ts','server/models/Transaction.ts','server/services/receiptService.ts','server/services/receiptLinkSyncService.ts','server/plugins/receiptLinkSync.ts','server/api/receipts/[id]/match.ts','server/api/receipts/auto-match.ts','server/services/companyNaviBusinessService.ts','server/services/companyNaviSummaryService.ts','server/services/financeCompanyActionService.ts','server/services/financeCompanyAssistantService.ts','shared/finance-navi-business.mjs','shared/finance-navi-features.mjs','components/finance/AssistantConversation.vue','components/receipt/ReceiptMatchDialog.vue','pages/receipts/upload.vue','pages/receipts/[id].vue','pages/receipts/index.vue','i18n/locales/ja.json','i18n/locales/ko.json','scripts/finance-navi-receipt-link-integration.cjs','scripts/finance-navi-receipt-link-browser.cjs','scripts/finance-receipt-link-audit.cjs','scripts/finance-company-business-integration.cjs','scripts/finance-receipt-candidates-integration.cjs','scripts/finance-company-business.test.mjs','scripts/finance-navi-features.test.mjs','scripts/zoomer-fixtures/omf-navi-receipt-link.mjs'],async run(){
 const exec=(args,env={},timeout=1800000)=>new Promise(resolve=>{const started=Date.now();execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...cleanEnv(),MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',...env},timeout,maxBuffer:16*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,ms:Date.now()-started,text:stdout+stderr}))});
 const tail=r=>({code:r.code,ms:r.ms,text:r.text.length>12000?r.text.slice(0,3000)+'\n…\n'+r.text.slice(-9000):r.text});
 const unit=await exec(['--test','scripts/finance-company-business.test.mjs','scripts/finance-navi-features.test.mjs','scripts/finance-transaction-export.test.mjs']);
 const business=await exec([path.join(root,'scripts/finance-company-business-integration.cjs')],{OMF_BUSINESS_APP_ROOT:root});
 const durability=await exec([path.join(root,'scripts/finance-navi-receipt-link-integration.cjs')],{OMF_RECEIPT_LINK_APP_ROOT:root,OMF_RECEIPT_NAV_BROWSER:'',OMF_RECEIPT_LIBRARY_BROWSER:''},2400000);
 const candidates=await exec([path.join(root,'scripts/finance-receipt-candidates-integration.cjs')]);
 const legs={unit:unit.code===0,business:business.code===0&&groupMarks.every(m=>business.text.includes('PASS '+m)),durability:durability.code===0&&/(\d+) of \1 receipt-link durability tags passed/.test(durability.text)&&durability.text.includes('PASS receipt-link:chrome-passed'),candidates:candidates.code===0};
 const controls=[],mutants=[];let pass=Object.values(legs).every(Boolean);
 if(pass){const base=path.resolve(root,'.zoomer','receipt-link-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled server/client chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(/\.(mjs|js)$/.test(f))chunks.push(f)}};await walk(path.join(directory,'.output'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,()=>b)};
   // A mutated client asset keeps its served length correct: the server's public-asset manifest pins each file's byte size.
   const publicDir=path.join(directory,'.output','public'),resize=async(file,content)=>{if(!file.startsWith(publicDir+path.sep))return null;const key='"path": '+JSON.stringify('../public/'+path.relative(publicDir,file).split(path.sep).join('/')),manifest=await locate(key),m=original.get(manifest),at=m.indexOf(key),size=m.lastIndexOf('"size": ',at),end=m.indexOf(',',size);if(size<0||end>at)throw Error('Public asset size entry not found for '+key);await writeFile(manifest,m.slice(0,size)+'"size": '+Buffer.byteLength(content)+m.slice(end));return manifest};
   const durable=(only,browser=false)=>exec([path.join(root,'scripts/finance-navi-receipt-link-integration.cjs')],{OMF_RECEIPT_LINK_APP_ROOT:directory,OMF_RECEIPT_LINK_ONLY:only,OMF_RECEIPT_LINK_SERVER_ONLY:browser?'':'1'},1200000);
   const copied=await durable('');const copiedPass=copied.code===0&&/(\d+) of \1 receipt-link durability tags passed/.test(copied.text);controls.push({name:'unchanged-packaged-copy-server-only',lever:'OMF_RECEIPT_LINK_SERVER_ONLY=1',pass:copiedPass,...tail(copied)});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,only,assertion,browser=false)=>{let file,manifest;try{file=await locate(anchor);const mutated=replace(original.get(file),anchor,replacement),probe=path.join(directory,'parse-'+name+'.mjs');await writeFile(probe,mutated);const parsed=await exec(['--check',probe],{},60000);await rm(probe,{force:true});if(parsed.code!==0)throw Error('Mutated chunk does not parse: '+parsed.text.slice(0,300));await writeFile(file,mutated);manifest=await resize(file,mutated);const r=await durable(only,browser),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes('FAIL receipt-link:'+assertion);mutants.push({name,assertion,detected,...tail(r)});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file));if(manifest)await writeFile(manifest,original.get(manifest))}};
   for(const m of MUTANTS)await test(m.name,m.anchor,m.replacement,m.only,m.assertion,m.browser===true);
   if(MUTANTS.length<18)pass=false;
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass,databaseCoverage:{executed:business.code===0&&durability.code===0,ownedProcess:true},message:JSON.stringify({legs,unit:tail(unit),business:tail(business),durability:tail(durability),candidates:tail(candidates),controls,mutants,limits:'Owned throwaway databases and synthetic records/worker replies only. Real Opus5.5 model acceptance, independent semantic grading, privacy-safe production observation and final Fable review are separate. No production reliability rate is implied.'})};
}};

// Saved-record consultation (plan omf-navi-agent-selection-20261022, docs/navi-selected-records.md). Runs the owned integration (its
// own MongoMemoryServer, the built app on loopback, installed Chrome, synthetic people/companies/records, simulated worker claims and
// replies) against this tree's build, then against a packaged copy of that build (positive control: every group must pass) and the same
// copy with one meaningful defect at a time in its compiled server chunks or client assets (each must fail at its own named assertion;
// a defect leg runs the shared setup plus the groups that hold that assertion). An anchor that is missing or not unique is a setup
// failure and never counts as detection. An edited client asset also gets its recorded size in the copy's static asset manifest. No
// model, provider, mail, bank, Slack or production calls; a missing build is a named failure and grants no coverage; a fixture with no
// recorded defects cannot pass. OMF_NAVI_SELECTION_MAIN_ONLY=1 is a diagnostic: it runs only the legs named in
// OMF_NAVI_SELECTION_DEBUG_GROUPS (';' between legs, ',' between groups, empty = every group) and always reports a failure, so it can
// never grant coverage.
// Run ONLY through the hub verifier: node scripts/zoomer-verify.mjs --run-fixture omf-navi-selection.mjs --cwd <worktree>
import {execFile} from 'node:child_process';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=7200000;
const EXPECTED=6;
// A leg's screenshots (OMF_NAVI_SELECTION_SCREENSHOTS) go to their own sub-folder; a leg without a name takes none.
const shotsFor=name=>process.env.OMF_NAVI_SELECTION_SCREENSHOTS&&name?path.join(process.env.OMF_NAVI_SELECTION_SCREENSHOTS,name):'';
const run=(app,only='',name='')=>new Promise(resolve=>{const started=Date.now();execFile(process.execPath,[path.join(root,'scripts/finance-navi-selection-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_NAVI_SELECTION_APP_ROOT:app,OMF_NAVI_SELECTION_ONLY:only,OMF_NAVI_SELECTION_SCREENSHOTS:shotsFor(name)},timeout:2700000,maxBuffer:32*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,signal:e?.signal||null,text:stdout+stderr,ms:Date.now()-started}))});
const groupsOf=text=>Number((text.match(/(\d+) Navi selection groups passed/)||[])[1]||0);
const lineJson=(text,tag)=>{const line=text.split(/\r?\n/).filter(l=>l.startsWith(tag+' ')).at(-1);try{return line?JSON.parse(line.slice(tag.length+1)):null}catch{return null}};
const summaryOf=text=>lineJson(text,'SUMMARY'),timingOf=text=>lineJson(text,'TIMING');
const failuresOf=text=>text.split(/\r?\n/).filter(l=>l.startsWith('FAIL ')).map(l=>l.slice(0,500));
const failureOf=text=>((text.match(/AssertionError[^\n]*/)||[])[0]||failuresOf(text)[0]||text.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')).slice(0,500);
// Each defect: the groups its leg runs, compiled anchors (each must occur exactly once, in exactly one compiled file of its kind),
// their replacements, and the assertion the integration must then fail with. Client anchors carry the minified names of the current
// build (refreshed with it); after a rebuild that renames them they fail as a setup error, never as a detection or a pass.
export const DEFECTS=[
 // Server: a budget or recurring pointer accepted on any page.
 {name:'budget-any-page',only:'target',assertion:'selection:budget-page-only',kind:'server',edits:[['if (input.page !== "budgets") fail(400, "Choose a budget");','']]},
 {name:'recurring-any-page',only:'target',assertion:'selection:recurring-page-only',kind:'server',edits:[['if (input.page !== "recurring") fail(400, "Choose a recurring payment");','']]},
 // Server: the pointer is not checked through the company's scoped native reader (another company's record is queued).
 {name:'budget-unscoped',only:'target',assertion:'selection:budget-foreign-refused',kind:'server',edits:[['if (!await getCompanyBudget(organizationId, target.budgetId)) fail(404, "Budget not found");','']]},
 {name:'recurring-unscoped',only:'target',assertion:'selection:recurring-foreign-refused',kind:'server',edits:[['if (!await getRecurringPaymentById(organizationId, target.recurringPaymentId)) fail(404, "Recurring payment not found");','']]},
 // Server: a missing selected record is refused without its mark (the client cannot tell it from other refusals).
 {name:'missing-unmarked',only:'target',assertion:'selection:missing-marked',kind:'server',edits:[['selectedRecordMissing: true } });','selectedRecordMissing: false } });']]},
 // Composable: an actor/company change does not clear the old pointer (it is reinterpreted on the way back).
 {name:'identity-not-cleared',only:'gui-lifecycle',assertion:'gui:switch-back-no-reinterpretation',kind:'client',edits:[['b(a,()=>d()),b(()=>n.companyResourceSequence','b(a,()=>{}),b(()=>n.companyResourceSequence']]},
 // Composable: a same-identity token refresh counts as an identity change and clears the selection.
 {name:'refresh-clears',only:'gui-lifecycle',assertion:'gui:refresh-keeps-selection',kind:'client',edits:[['String(e.userId)+"|"+String(e.organizationId):""','String(e.userId)+"|"+String(e.organizationId)+r.token:""']]},
 // Composable: unmount clears whatever pointer is there (the newer mapping page publication is erased).
 {name:'unmount-clears-any',only:'gui-lifecycle',assertion:'gui:newer-publisher-kept',kind:'client',edits:[['A(d),{consult:k','A(()=>{n.pageSelection=null}),{consult:k']]},
 // Composable: rows shown for the previous actor/company stay consultable as the new company's records.
 {name:'stale-rows-consult',only:'gui-lifecycle',assertion:'gui:stale-rows-not-published',kind:'client',edits:[['f=m(()=>!!a.value&&p.value===a.value&&','f=m(()=>!!a.value&&']]},
 // Composable: only the first list load is acknowledged (the original permanent hold): a legitimate reload for the new company stays unconsultable.
 {name:'sticky-row-hold',only:'gui-lifecycle',assertion:'gui:refreshed-rows-consultable',kind:'client',edits:[['function I(e){e&&e===a.value&&(p.value=e)}','function I(e){e&&e===a.value&&!p.value&&(p.value=e)}']]},
 // Composable: a load is acknowledged for whatever identity is current when it ends (a delayed previous-company reply counts).
 {name:'ack-any-identity',only:'gui-lifecycle',assertion:'gui:delayed-old-response-not-acknowledged',kind:'client',edits:[['function I(e){e&&e===a.value&&(p.value=e)}','function I(e){a.value&&(p.value=a.value)}']]},
 // Invoices page: opening an editor keeps the consulted pointer.
 {name:'editor-keeps-pointer',only:'gui-lifecycle',assertion:'gui:editor-clears',kind:'client',edits:[['V=a=>{h.clear(),a?(v.value=a,','V=a=>{a?(v.value=a,']]},
 // Composable: any deletion signal of the same kind clears the pointer (another record's deletion included).
 {name:'delete-any-id',only:'gui-delete',assertion:'gui:other-delete-keeps',kind:'client',edits:[['e.id===t[s]&&e.actorId===t.actorId','e.actorId===t.actorId']]},
 // Composable: a done Navi deletion of the consulted record leaves its pointer (the next send carries a removed id).
 {name:'delete-ignored',only:'gui-delete',assertion:'gui:matched-delete-clears',kind:'client',edits:[['e.organizationId===t.organizationId&&(n.pageSelection=null)}','e.organizationId===t.organizationId&&!1}']]},
 // Invoices page: its own successful native delete leaves the pointer.
 {name:'page-delete-ignored',only:'gui-delete',assertion:'gui:page-delete-clears',kind:'client',edits:[['h.deleted(a),f()','f()']]},
 // Conversation: an explicit consultation does not leave History/Memory.
 {name:'no-live-view',only:'gui-view',assertion:'gui:history-consult-live-chat',kind:'client',edits:[['se(()=>l.consultation,o=>{o&&I.company&&!me&&(p.value="chat",y.value=null)})','se(()=>l.consultation,o=>{})']]},
 // Conversation: the live view follows the recomputed context instead of the publication (an ordinary page change resets History).
 {name:'context-view-reset',only:'gui-view',assertion:'gui:page-change-keeps-history',kind:'client',edits:[['se(()=>l.consultation,o=>{','se(()=>l.context,o=>{']]},
 // Panel: the initiating action is not remembered (close returns focus to the launcher instead of the row).
 {name:'focus-not-returned',only:'gui-view',assertion:'gui:focus-returns-to-row',kind:'client',edits:[['!g.value?.contains(C)&&(Se=C),','!g.value?.contains(C)&&!1,']]},
 // Panel: the close focus scrolls the document back to the initiator.
 {name:'close-scrolls',only:'gui-view',assertion:'gui:close-no-scroll',kind:'client',edits:[['focus({preventScroll:!0})})}function _e','focus()})}function _e']]},
 // Conversation: the definite missing-record refusal keeps the frozen request (the reproduced original behaviour).
 {name:'missing-pending-kept',only:'gui-missing',assertion:'gui:missing-target-released',kind:'client',edits:[['selectedRecordMissing===!0&&delete i.pending[Z],ce(v)','selectedRecordMissing===!0&&!1,ce(v)']]},
 // Conversation: any refusal or lost reply releases the request (a lost accepted request would be sent again as a new one).
 {name:'any-error-releases',only:'gui-missing',assertion:'gui:lost-response-pending-kept',kind:'client',edits:[['(w&&I.company&&o&&i.pending[Z]===o&&(v?.statusCode||v?.status)===404&&v?.data?.data?.selectedRecordMissing===!0&&delete i.pending[Z],ce(v))','(I.company&&o&&delete i.pending[Z],ce(v))']]},
 // Conversation: a request already sent once is released by a later marked refusal (an earlier attempt could still be accepted).
 {name:'unknown-retry-releases',only:'gui-missing',assertion:'gui:unknown-then-missing-kept',kind:'client',edits:[['(w&&I.company&&o&&i.pending[Z]===o&&','(I.company&&o&&i.pending[Z]===o&&']]},
 // Calendar page: a day-list consultation also opens the payment editor.
 {name:'day-consult-edits',only:'gui-consult',assertion:'gui:day-consult-read-only',kind:'client',edits:[['s=g=>{S.value=!1,_(g)}','s=g=>{S.value=!1,_(g),P.value=g,l.value=!0}']]}
];
async function filesOf(dir,ext){const out=[];if(!existsSync(dir))return out;for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await filesOf(f,ext));else if(f.endsWith(ext))out.push(f)}return out}
export default {name:'omf-navi-selection',covers:['server/services/financeCompanyAssistantService.ts','components/finance/AssistantPanel.vue','components/finance/AssistantConversation.vue','components/finance/NaviConsultButton.vue','composables/useNaviRecordSelection.ts','pages/invoices/index.vue','pages/budgets/index.vue','pages/recurring/index.vue','pages/calendar/index.vue','components/calendar/UpcomingPayments.vue','components/calendar/DayDetailModal.vue','scripts/finance-navi-selection-integration.cjs','scripts/finance-navi-selection-browser.cjs','scripts/zoomer-fixtures/omf-navi-selection.mjs'],async run(){
 const app=process.env.OMF_NAVI_SELECTION_APP_ROOT||root,built=path.join(app,'.output/server/index.mjs');
 if(!existsSync(built))return{pass:false,message:'omf-navi-selection: built app missing at '+built+' (build the tree first); no coverage granted'};
 const primaryOf=text=>{const lines=text.split(/\r?\n/),i=lines.findIndex(l=>/^(\S*Error\b|\s*\[?Error|.*\b(ECONNRESET|ECONNREFUSED|EADDRINUSE|ETIMEDOUT)\b)/.test(l)&&!/^(PASS|TIMING|APP_LOG|SUMMARY|CLEANUP|FAIL) /.test(l));return i<0?null:lines.slice(i,i+40).join('\n').slice(0,6000)};
 const appLogOf=text=>{const line=text.split(/\r?\n/).filter(l=>l.startsWith('APP_LOG ')).at(-1);try{return line?JSON.parse(line.slice(8)):null}catch{return null}};
 const legOf=d=>({exit:d.code,signal:d.signal,ms:d.ms,groups:groupsOf(d.text),failure:d.code===0?null:failureOf(d.text),failures:failuresOf(d.text),primary:d.code===0?null:primaryOf(d.text),appLog:d.code===0?null:appLogOf(d.text),passes:d.text.match(/^PASS .*$/gm)||[],summary:summaryOf(d.text),timing:timingOf(d.text),tail:d.text.split(/\r?\n/).filter(Boolean).slice(-6)});
 if(process.env.OMF_NAVI_SELECTION_MAIN_ONLY==='1'){
  const legs=[];
  for(const [i,only] of String(process.env.OMF_NAVI_SELECTION_DEBUG_GROUPS||'').split(';').entries()){const name='diagnostic-'+(i+1)+'-'+(only.replace(/[^a-z,-]/g,'').replace(/,/g,'+')||'all');legs.push({only,...legOf(await run(app,only,name))})}
  return{pass:false,message:JSON.stringify({diagnostic:'main-only run; never coverage',app,legs})};
 }
 const main=await run(app,'','main'),groups=groupsOf(main.text),summary=summaryOf(main.text),defects=[];
 let pass=main.code===0&&groups===EXPECTED&&!!summary&&!summary.failures?.length,control=null,setupError=DEFECTS.length?null:'no compiled defects recorded: this fixture cannot pass without them';
 if(!DEFECTS.length)pass=false;
 if(pass){
  const base=path.resolve(root,'.zoomer','navi-selection-mutants'),directory=path.resolve(base,randomUUID());
  if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
  await mkdir(directory,{recursive:true});
  try{
   // Packaged positive control: this build copied byte for byte, internal links dereferenced, must pass every group.
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   const c=await run(directory,'','control');control={exit:c.code,groups:groupsOf(c.text),ms:c.ms,timing:timingOf(c.text),failure:c.code===0?null:failureOf(c.text),failures:failuresOf(c.text)};
   if(c.code!==0||control.groups!==EXPECTED)throw Error('packaged positive control must pass before defects: '+JSON.stringify(control));
   const kinds={server:await filesOf(path.join(directory,'.output/server/chunks'),'.mjs'),client:await filesOf(path.join(directory,'.output/public/_nuxt'),'.js')};
   const texts=new Map(await Promise.all([...kinds.server,...kinds.client].map(async f=>[f,await readFile(f,'utf8')])));
   const locate=(kind,anchor)=>{const found=kinds[kind].filter(f=>texts.get(f).includes(anchor));if(found.length!==1||texts.get(found[0]).split(anchor).length!==2)throw Error('anchor must occur once in one '+kind+' file ('+found.length+' files): '+anchor.slice(0,140));return found[0]};
   for(const defect of DEFECTS){
    const changed=new Map();let entry={name:defect.name,assertion:defect.assertion,only:defect.only};
    try{
     if(!defect.edits.length)throw Error('no anchors recorded for this defect');
     for(const [anchor,replacement] of defect.edits){const f=locate(defect.kind,anchor);changed.set(f,(changed.get(f)??texts.get(f)).replace(anchor,()=>replacement))}
     // An edited client asset: its size in the copy's static asset manifest follows the edited bytes (exactly one entry).
     if(defect.kind==='client'){
      const manifest=kinds.server.find(f=>f.endsWith(path.join('_','nitro.mjs')));if(!manifest)throw Error('static asset manifest not found');
      let m=changed.get(manifest)??texts.get(manifest);
      for(const [f,t] of [...changed].filter(([f])=>kinds.client.includes(f))){
       const name=path.basename(f),entry=new RegExp('("/_nuxt/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'": \\{[^}]*?"size": )(\\d+)','g'),hits=[...m.matchAll(entry)];
       if(hits.length!==1)throw Error('asset manifest entry must occur once: '+name+' ('+hits.length+')');
       m=m.replace(entry,(all,head)=>head+Buffer.byteLength(t));
      }
      changed.set(manifest,m);
     }
     for(const [f,t] of changed)await writeFile(f,t);
     const m=await run(directory,defect.only),detected=m.code!==0&&m.text.includes('AssertionError')&&m.text.includes(defect.assertion);
     entry={...entry,files:[...changed.keys()].map(f=>path.relative(directory,f).split(path.sep).join('/')),exit:m.code,groups:groupsOf(m.text),ms:m.ms,timing:timingOf(m.text),detected,failure:failureOf(m.text),failures:failuresOf(m.text)};
    }catch(error){entry={...entry,setupError:String(error?.message||error),detected:false}}
    finally{for(const f of changed.keys())await writeFile(f,texts.get(f))}
    defects.push(entry);if(!entry.detected)pass=false;
   }
  }catch(error){pass=false;setupError=String(error?.message||error)}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&defects.length===DEFECTS.length&&DEFECTS.length>0,databaseCoverage:{executed:main.code===0,ownedProcess:main.code===0},message:JSON.stringify({exit:main.code,signal:main.signal,ms:main.ms,timing:timingOf(main.text),groups,expected:EXPECTED,failure:main.code===0?null:failureOf(main.text),failures:failuresOf(main.text),primary:main.code===0?null:primaryOf(main.text),passes:main.text.match(/^PASS .*$/gm)||[],summary,control,defects,setupError,
  limits:'Owned synthetic Mongo, loopback native HTTP and installed headless Chrome only; simulated worker claims and replies; no model/provider/mail/bank/Slack calls or production records. Selected-record transport, scope, lifecycle and GUI behaviour only: not model judgement of a selected record, not a production reliability rate, no physical phone or Safari. Touch is Chrome touch emulation at 390 px; another tab is a real same-origin tab; a lost reply is a real accepted request whose browser copy is failed; a slow poll is a held real request. The issuer bill is a synthetic setup row. The packaged copy is this build byte for byte; only each defect edits its compiled file.'})};
}};

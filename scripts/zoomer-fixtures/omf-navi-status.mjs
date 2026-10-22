// Closed Navi status and exact reply read state (plan omf-navi-agent-status-20261022). Runs the owned integration (its own
// MongoMemoryServer, the built app on loopback, installed Chrome, synthetic people/companies/cards/workers, simulated worker replies
// and research results) against this tree's build, then against a packaged copy of that build (positive control: every group must
// pass) and the same copy with one meaningful defect at a time in its compiled server chunks or client assets (each must fail at its
// own named assertion; a defect leg runs the shared setup plus the groups that hold that assertion). An anchor that is missing or not
// unique is a setup failure and never counts as detection. An edited client asset also gets its recorded size in the copy's static
// asset manifest (the static server sends the size recorded at build time). No model, provider, mail, bank, Slack or production
// calls; a missing build is a named failure and grants no coverage. OMF_NAVI_STATUS_MAIN_ONLY=1 is a diagnostic: it runs only the
// legs named in OMF_NAVI_STATUS_DEBUG_GROUPS (';' between legs, ',' between groups, empty = every group, 'baseline' = the layout
// baseline) and always reports a failure, so it can never grant coverage.
// Layout baseline: before the main leg, the same owned integration measures the same synthetic owner page at the same widths,
// heights and sizes on a prior release (OMF_NAVI_STATUS_LAYOUT_BASELINE_ROOT, default this machine's preserved deployed 12cf98c
// runtime, read only, run on its own owned database). The layout group compares with it; it has no status and grants no status
// coverage. With no such release on the machine, no comparison is made (recorded), and any page overflow then fails the layout group.
// Every leg prints its own setup readiness (TIMING); the fixture reports them.
// Run ONLY through the hub verifier: node scripts/zoomer-verify.mjs --run-fixture omf-navi-status.mjs --cwd <worktree>
import {execFile} from 'node:child_process';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=5400000;
const EXPECTED=13,BASELINE_GROUP='gui-layout-baseline';
const baselineRoot=path.resolve(process.env.OMF_NAVI_STATUS_LAYOUT_BASELINE_ROOT||path.join(root,'../../ohmycode/tmp/omf-deployed-12cf98c'));
// A leg's screenshots (OMF_NAVI_STATUS_SCREENSHOTS) go to their own sub-folder; a leg without a name takes none.
const shotsFor=name=>process.env.OMF_NAVI_STATUS_SCREENSHOTS&&name?path.join(process.env.OMF_NAVI_STATUS_SCREENSHOTS,name):'';
const run=(app,only='',env={},name='')=>new Promise(resolve=>{const started=Date.now();execFile(process.execPath,[path.join(root,'scripts/finance-navi-status-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_NAVI_STATUS_APP_ROOT:app,OMF_NAVI_STATUS_ONLY:only,OMF_NAVI_STATUS_SCREENSHOTS:shotsFor(name),...env},timeout:1500000,maxBuffer:32*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,signal:e?.signal||null,text:stdout+stderr,ms:Date.now()-started}))});
const groupsOf=text=>Number((text.match(/(\d+) Navi status groups passed/)||[])[1]||0);
const lineJson=(text,tag)=>{const line=text.split(/\r?\n/).filter(l=>l.startsWith(tag+' ')).at(-1);try{return line?JSON.parse(line.slice(tag.length+1)):null}catch{return null}};
const summaryOf=text=>lineJson(text,'SUMMARY'),timingOf=text=>lineJson(text,'TIMING'),inheritedOf=text=>lineJson(text,'INHERITED_OVERFLOW');
const failureOf=text=>((text.match(/AssertionError[^\n]*/)||[])[0]||text.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')).slice(0,500);
// Each defect: the groups its leg runs, compiled anchors (each must occur exactly once, in exactly one compiled file of its kind),
// their replacements, and the assertion the integration must then fail with. Client anchors carry the minified names of the current
// build (refreshed with it); after a rebuild that renames them they fail as a setup error, never as a detection or a pass.
export const DEFECTS=[
 // A failed final reply advances the reply version: a failure would become a new arrival.
 {name:'version-on-failure',only:'workspace',assertion:'status:failure-no-version',kind:'server',edits:[['"turns.$[turn].actions": receipts }, $inc: { revision: 1, ...proposal ? { "turns.$[turn].replyVersion": 1 } : {} }','"turns.$[turn].actions": receipts }, $inc: { revision: 1, "turns.$[turn].replyVersion": 1 }']]},
 // The acknowledgement accepts whatever version the client names (the read check and the write filter both stop comparing it).
 {name:'ack-any-version',only:'workspace',assertion:'status:exact-version',kind:'server',edits:[['naviReplyVersion(turn) !== item.replyVersion','false'],['const exactVersion = (version) => version === 0 ? { $in: [null, 0] } : version;','const exactVersion = (version) => ({ $ne: -1 });']]},
 // The acknowledgement advances the conversation revision: a reader's own read would stale their next send.
 {name:'ack-bumps-revision',only:'workspace',assertion:'status:send-revision-unchanged',kind:'server',edits:[['{ $max: seen }','{ $max: seen, $inc: { revision: 1 } }']]},
 // The status read renews the workspace worker heartbeat: an offline worker would look connected and the status would write.
 {name:'status-renews-heartbeat',only:'workspace',assertion:'status:offline-worker',kind:'server',edits:[['const workspaceConnected = async (ownerId) => !!await FinanceChatAgent.exists({ ownerId, enabled: true, revokedAt: null, workspaceEnabled: true, chatLastSeenAt: liveChat() });','const workspaceConnected = async (ownerId) => (await FinanceChatAgent.updateMany({ ownerId, enabled: true, revokedAt: null, workspaceEnabled: true }, { $set: { chatLastSeenAt: /* @__PURE__ */ new Date() } }), true);']]},
 // The purchase status runs the full getter first, with its confirmation and research recovery writes.
 {name:'status-recovers',only:'purchase',assertion:'status:no-recovery-write',kind:'server',edits:[['const source = await readDraftSourceContext(ownerId, importId, line);','await getChat(ownerId, importId, line, posting); const source = await readDraftSourceContext(ownerId, importId, line);']]},
 // The owner status counts turns withheld for another company's teachings.
 {name:'unmasked-status',only:'mask',assertion:'status:masked-turns',kind:'server',edits:[['maskTurns(ownerConversation?.turns || [], checkedCompany)','(ownerConversation?.turns || [])']]},
 // Any turn that ever started research counts as the link of the current research request.
 {name:'unlinked-research',only:'purchase',assertion:'status:research-unlinked-excluded',kind:'server',edits:[['t?.research?.requestId===research.requestId','!!t?.research?.requestId']]},
 // Applying a report advances its report version: an applied report would arrive again.
 {name:'apply-new-arrival',only:'purchase',assertion:'status:apply-no-new-report',kind:'server',edits:[['applied: { fields: body.fields, values: selected, at: /* @__PURE__ */ new Date() } }, $unset: { lease: "", leaseUntil: "" }, $inc: { revision: 1 } }','applied: { fields: body.fields, values: selected, at: /* @__PURE__ */ new Date() } }, $unset: { lease: "", leaseUntil: "" }, $inc: { revision: 1, reportVersion: 1 } }']]},
 // The reply visibility check ignores a hidden tab.
 {name:'hidden-ack',only:'gui-hidden',assertion:'gui:hidden-no-ack',kind:'client',edits:[['document.visibilityState!=="visible"','!1']]},
 // An unsolicited arrival always scrolls to the latest (the original forced scroll), moving an older reader.
 {name:'forced-scroll',only:'gui-reader',assertion:'gui:older-reader-position',kind:'client',edits:[['c.pinned?H(S?.()):i.value=ne().length>0','H(S?.())']]},
 // Covered reply text counts as seen (no hit test).
 {name:'covered-ack',only:'gui-purchase',assertion:'gui:covered-no-ack',kind:'client',edits:[['return!!he&&(he===S||S.contains(he))','return!0']]},
 // A late status read of the previous company is accepted as the current one (no staleness check, stored under the current key).
 {name:'stale-scope',only:'gui-scope',assertion:'gui:stale-scope-dropped',kind:'client',edits:[['const O=()=>!b&&M.ticket===w&&M.key===c.value&&M.sequence===i.naviStatusSequence;','const O=()=>!0;'],['i.receiveNaviStatus(M.key,V)','i.receiveNaviStatus(c.value,V)']]},
 // The status ignores the native deadline: a claim, confirmation, research or apply whose deadline passed is reported in progress.
 {name:'expired-work-active',only:'lease',assertion:'status:expired-not-active',kind:'server',edits:[["if(deadline>now)return 'active'","if(true)return 'active'"]]},
 // The launcher ignores the server's work state: a reply whose deadline passed keeps showing "回答を作成しています" with a fresh worker.
 {name:'expired-indicator-working',only:'gui-closed',assertion:'gui:expired-work-not-active',kind:'client',edits:[['i==="working"?c==="active"?l.connected?','i==="working"?!0?l.connected?']]},
 // Reply visibility from the reply element's whole block rectangle instead of its text ranges (dwell, scope and hit test kept):
 // exposed blank lines of a reply would count as seen.
 {name:'blank-text-rect',only:'gui-text',assertion:'gui:blank-lines-no-ack',kind:'client',edits:[['for(const ve of ze.getClientRects())if(Se(ve))return!0','for(const ve of[S.getBoundingClientRect()])if(Se(ve))return!0']]}
];
async function filesOf(dir,ext){const out=[];if(!existsSync(dir))return out;for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await filesOf(f,ext));else if(f.endsWith(ext))out.push(f)}return out}
export default {name:'omf-navi-status',covers:['server/api/finance-chat/[...path].ts','server/services/financeNaviStatusService.ts','server/services/financeAssistantService.ts','server/services/financeCompanyAssistantService.ts','server/services/financeChatService.ts','server/services/financeDraftService.ts','server/models/FinanceResearch.ts','server/services/financeResearchService.ts','shared/finance-navi-status.mjs','composables/useNaviStatus.ts','composables/useNaviReplyVisibility.ts','components/finance/AssistantPanel.vue','components/finance/AssistantConversation.vue','components/finance/PurchaseChat.vue','stores/assistant.ts','scripts/finance-navi-status-integration.cjs','scripts/finance-navi-status-browser.cjs','scripts/zoomer-fixtures/omf-navi-status.mjs'],async run(){
 const app=process.env.OMF_NAVI_STATUS_APP_ROOT||root,built=path.join(app,'.output/server/index.mjs');
 if(!existsSync(built))return{pass:false,message:'omf-navi-status: built app missing at '+built+' (build the tree first); no coverage granted'};
 // The layout baseline file: retained where OMF_NAVI_STATUS_LAYOUT_FILE names it (written fresh, never reused), else a temporary file.
 const layoutFile=process.env.OMF_NAVI_STATUS_LAYOUT_FILE?path.resolve(process.env.OMF_NAVI_STATUS_LAYOUT_FILE):path.join(os.tmpdir(),'omf-navi-status-layout-'+randomUUID()+'.json');
 const baselineAvailable=existsSync(path.join(baselineRoot,'.output/server/index.mjs'));
 const baselineLeg=async name=>{if(existsSync(layoutFile))throw Error('layout baseline file exists already: '+layoutFile);const b=await run(baselineRoot,BASELINE_GROUP,{OMF_NAVI_STATUS_LAYOUT_BASELINE_OUT:layoutFile},name);return{root:baselineRoot,exit:b.code,ms:b.ms,timing:timingOf(b.text),written:existsSync(layoutFile),failure:b.code===0?null:failureOf(b.text)}};
 const layoutEnv=()=>existsSync(layoutFile)?{OMF_NAVI_STATUS_LAYOUT_BASELINE_IN:layoutFile}:{};
 // A diagnostic leg also keeps its primary error: the lines from the first error report (and the owned app's log tail, APP_LOG).
 const primaryOf=text=>{const lines=text.split(/\r?\n/),i=lines.findIndex(l=>/^(\S*Error\b|\s*\[?Error|.*\b(ECONNRESET|ECONNREFUSED|EADDRINUSE|ETIMEDOUT)\b)/.test(l)&&!/^(PASS|TIMING|APP_LOG|SUMMARY|CLEANUP) /.test(l));return i<0?null:lines.slice(i,i+40).join('\n').slice(0,6000)};
 const appLogOf=text=>{const line=text.split(/\r?\n/).filter(l=>l.startsWith('APP_LOG ')).at(-1);try{return line?JSON.parse(line.slice(8)):null}catch{return null}};
 const legOf=d=>({exit:d.code,signal:d.signal,ms:d.ms,groups:groupsOf(d.text),failure:d.code===0?null:failureOf(d.text),primary:d.code===0?null:primaryOf(d.text),appLog:d.code===0?null:appLogOf(d.text),passes:d.text.match(/^PASS .*$/gm)||[],summary:summaryOf(d.text),timing:timingOf(d.text),inheritedOverflow:inheritedOf(d.text),tail:d.text.split(/\r?\n/).filter(Boolean).slice(-6)});
 if(process.env.OMF_NAVI_STATUS_MAIN_ONLY==='1'){
  const legs=[];
  for(const [i,only] of String(process.env.OMF_NAVI_STATUS_DEBUG_GROUPS||'').split(';').entries()){
   const name='diagnostic-'+(i+1)+'-'+(only.replace(/[^a-z,-]/g,'').replace(/,/g,'+')||'all');
   if(only==='baseline'){legs.push({only,...await baselineLeg(name).catch(e=>({setupError:String(e?.message||e)}))});continue}
   legs.push({only,...legOf(await run(app,only,layoutEnv(),name))});
  }
  const layoutBaseline={root:baselineRoot,available:baselineAvailable,file:existsSync(layoutFile)?layoutFile:null};
  if(!process.env.OMF_NAVI_STATUS_LAYOUT_FILE){await rm(layoutFile,{force:true});layoutBaseline.file=null}
  return{pass:false,message:JSON.stringify({diagnostic:'main-only run; never coverage',app,layoutBaseline,legs})};
 }
 let layout={root:baselineRoot,available:baselineAvailable,compared:false},pass=true,setupError=null;
 // A prior release on this machine is measured fresh first; a failed baseline run is a failure of this fixture, never skipped.
 if(baselineAvailable){layout={...layout,...await baselineLeg('baseline').catch(e=>({setupError:String(e?.message||e)}))};if(layout.exit!==0||!layout.written){pass=false;setupError='layout baseline run failed: '+JSON.stringify(layout).slice(0,600)}}
 const main=await run(app,'',layoutEnv(),'main'),groups=groupsOf(main.text),summary=summaryOf(main.text),defects=[];
 layout.compared=!!summary?.cases?.includes('gui|layout-baseline-compared');
 pass=pass&&main.code===0&&groups===EXPECTED&&!!summary&&(!baselineAvailable||layout.compared);let control=null;
 if(pass){
  const base=path.resolve(root,'.zoomer','navi-status-mutants'),directory=path.resolve(base,randomUUID());
  if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
  await mkdir(directory,{recursive:true});
  try{
   // Packaged positive control: this build copied byte for byte, internal links dereferenced, must pass every group.
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   const c=await run(directory,'',layoutEnv(),'control');control={exit:c.code,groups:groupsOf(c.text),ms:c.ms,timing:timingOf(c.text),failure:c.code===0?null:failureOf(c.text)};
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
     entry={...entry,files:[...changed.keys()].map(f=>path.relative(directory,f).split(path.sep).join('/')),exit:m.code,groups:groupsOf(m.text),ms:m.ms,timing:timingOf(m.text),detected,failure:failureOf(m.text)};
    }catch(error){entry={...entry,setupError:String(error?.message||error),detected:false}}
    finally{for(const f of changed.keys())await writeFile(f,texts.get(f))}
    defects.push(entry);if(!entry.detected)pass=false;
   }
  }catch(error){pass=false;setupError=String(error?.message||error)}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 if(!process.env.OMF_NAVI_STATUS_LAYOUT_FILE)await rm(layoutFile,{force:true});
 return{pass:pass&&defects.length===DEFECTS.length,databaseCoverage:{executed:main.code===0,ownedProcess:main.code===0},message:JSON.stringify({exit:main.code,signal:main.signal,ms:main.ms,timing:timingOf(main.text),groups,expected:EXPECTED,failure:main.code===0?null:failureOf(main.text),passes:main.text.match(/^PASS .*$/gm)||[],summary,layout,inheritedOverflow:inheritedOf(main.text),control,defects,setupError,
  limits:'Owned synthetic Mongo, loopback native HTTP and installed headless Chrome only; simulated worker replies and research results; no model/provider/mail/bank/Slack calls or production records. Transport, version, read-state, visibility and layout behaviour only: not model quality, not a production reliability rate, no physical phone or Safari. Hidden tabs are genuine Chrome background tabs; occlusion is a real page modal; another tab\'s sign-out is a real same-origin tab clearing the shared local session (no server token revocation is claimed); the screen lock is the app\'s own lock broadcast, not an operating-system lock. Passed work deadlines are synthetic setup writes of the deadline only. The layout baseline is a prior release measured on its own owned database (layout only, no status coverage). The packaged copy is this build byte for byte; only each defect edits its compiled file.'})};
}};

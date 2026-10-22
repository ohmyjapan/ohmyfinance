// Navi turn continuity and workspace worker recovery (plan omf-navi-agent-continuity-20261022). Runs the owned integration (its own
// MongoMemoryServer, the built app on loopback, synthetic people, companies and workers, simulated worker replies) against this
// tree's build, then against a packaged copy of that build (positive control: must pass every group) and the same copy with one
// meaningful defect at a time in its compiled server chunks (each must fail at its own named assertion). An anchor that is missing or
// not unique is a setup failure and never counts as detection. No model, provider, mail, bank, Slack or production calls; a missing
// build is a named failure and grants no coverage.
// Run ONLY through the hub verifier: node scripts/zoomer-verify.mjs --run-fixture omf-navi-continuity.mjs --cwd <worktree>
import {execFile} from 'node:child_process';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=2700000;
const EXPECTED=6;
const run=app=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/finance-navi-continuity-integration.cjs')],{cwd:root,windowsHide:true,env:{...process.env,MONGO_URI:'',MONGODB_URI:'',NUXT_MONGO_URI:'',OMF_NAVI_CONTINUITY_APP_ROOT:app},timeout:600000,maxBuffer:16*1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code??1:0,signal:e?.signal||null,text:stdout+stderr})));
const groupsOf=text=>Number((text.match(/(\d+) Navi continuity groups passed/)||[])[1]||0);
const summaryOf=text=>{const line=text.split(/\r?\n/).find(l=>l.startsWith('SUMMARY '));try{return line?JSON.parse(line.slice(8)):null}catch{return null}};
const failureOf=text=>((text.match(/AssertionError[^\n]*/)||[])[0]||text.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')).slice(0,500);
// Each defect: compiled anchors (each must occur exactly once, in exactly one server chunk), their replacements, and the assertion the
// integration must then fail with.
export const DEFECTS=[
 // Earlier messages lose their receipts again (the original blind next turn).
 {name:'missing-receipt',assertion:'continuity:prior-receipt',edits:[['actions: (t.actions || []).slice(0, turnReceiptLimit).map(companyActionReceipt)','actions: []']]},
 // The status tool reads the current turn only again.
 {name:'current-only-status',assertion:'continuity:earlier-status',edits:[['[...current, ...earlier].filter((a) => a.operationId === operationId)','[...current].filter((a) => a.operationId === operationId)']]},
 // The claim reuses the earlier messages frozen at send instead of rebuilding them from reconciled live turns.
 {name:'send-time-messages',assertion:'continuity:claim-time-reconcile',edits:[['messages: recent.map(earlierTurn)','messages: stored.messages']]},
 // The live-history reader returns the current message as earlier evidence.
 {name:'history-includes-current',assertion:'continuity:history-excludes-current',edits:[['earlierTurns(fresh?.turns, c.currentId)','earlierTurns(fresh?.turns, null)']]},
 // Company claims and sweeps are pinned to the send-time worker again.
 {name:'pinned-company-claim',assertion:'continuity:reassigned-claim',edits:[['FinanceCompanyAssistant.updateMany({ ownerId: agent.ownerId, state: { $in: ["queued", "working"] },','FinanceCompanyAssistant.updateMany({ ownerId: agent.ownerId, agentId: agent._id, state: { $in: ["queued", "working"] },'],['FinanceCompanyAssistant.findOneAndUpdate({ ownerId: agent.ownerId, organizationId: { $in: organizationIds }, $or:','FinanceCompanyAssistant.findOneAndUpdate({ ownerId: agent.ownerId, organizationId: { $in: organizationIds }, agentId: agent._id, $or:']]},
 // Owner workspace claims and sweeps are pinned to the send-time worker again.
 {name:'pinned-owner-claim',assertion:'continuity:owner-reassigned-claim',edits:[['const scope = { ownerId: agent.ownerId };','const scope = { ownerId: agent.ownerId, agentId: agent._id };']]},
 // A working company job is claimable before its lease expires (another worker takes a live lease).
 {name:'lease-theft',assertion:'continuity:active-lease-kept',edits:[['organizationId: { $in: organizationIds }, $or: [{ state: "queued" }, { state: "working", leaseUntil: { $lte: /* @__PURE__ */ new Date() }, attempts: { $lt: 2 } }] }','organizationId: { $in: organizationIds }, $or: [{ state: "queued" }, { state: "working", attempts: { $lt: 2 } }] }']]},
 // A reclaim by a worker without public research keeps the previous worker's grant.
 {name:'inherited-capability',assertion:'continuity:capability-claiming-worker',edits:[['...capability ? {} : { $unset: { "context.publicResearch": "" } }, ',''],['const publicResearch = frozen?.lease === lease ? {','const publicResearch = frozen ? {']]}
];
async function chunksOf(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await chunksOf(f));else if(f.endsWith('.mjs'))out.push(f)}return out}
export default {name:'omf-navi-continuity',covers:['server/services/financeCompanyActionService.ts','server/services/financeCompanyAssistantService.ts','server/services/financeAssistantService.ts','teaching-worker/interpreter.mjs','scripts/finance-navi-continuity-integration.cjs','scripts/zoomer-fixtures/omf-navi-continuity.mjs'],async run(){
 const app=process.env.OMF_NAVI_CONTINUITY_APP_ROOT||root,built=path.join(app,'.output/server/index.mjs');
 if(!existsSync(built))return{pass:false,message:'omf-navi-continuity: built app missing at '+built+' (build the tree first); no coverage granted'};
 const main=await run(app),groups=groupsOf(main.text),summary=summaryOf(main.text),defects=[];
 let pass=main.code===0&&groups===EXPECTED&&!!summary,control=null,setupError=null;
 if(pass){
  const base=path.resolve(root,'.zoomer','navi-continuity-mutants'),directory=path.resolve(base,randomUUID());
  if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned mutant directory');
  await mkdir(directory,{recursive:true});
  try{
   // Packaged positive control: this build copied byte for byte, internal links dereferenced, must pass every group.
   await cp(path.join(app,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   const c=await run(directory);control={exit:c.code,groups:groupsOf(c.text),failure:c.code===0?null:failureOf(c.text)};
   if(c.code!==0||control.groups!==EXPECTED)throw Error('packaged positive control must pass before defects: '+JSON.stringify(control));
   const files=await chunksOf(path.join(directory,'.output/server/chunks')),texts=new Map(await Promise.all(files.map(async f=>[f,await readFile(f,'utf8')])));
   const locate=anchor=>{const found=[...texts].filter(([,t])=>t.includes(anchor));if(found.length!==1||found[0][1].split(anchor).length!==2)throw Error('anchor must occur once in one chunk ('+found.length+' chunks): '+anchor.slice(0,140));return found[0][0]};
   for(const defect of DEFECTS){
    const changed=new Map();let entry={name:defect.name,assertion:defect.assertion};
    try{
     for(const [anchor,replacement] of defect.edits){const f=locate(anchor);changed.set(f,(changed.get(f)??texts.get(f)).replace(anchor,()=>replacement))}
     for(const [f,t] of changed)await writeFile(f,t);
     const m=await run(directory),detected=m.code!==0&&m.text.includes('AssertionError')&&m.text.includes(defect.assertion);
     entry={...entry,files:[...changed.keys()].map(f=>path.relative(directory,f).split(path.sep).join('/')),exit:m.code,groups:groupsOf(m.text),detected,failure:failureOf(m.text)};
    }catch(error){entry={...entry,setupError:String(error?.message||error),detected:false}}
    finally{for(const f of changed.keys())await writeFile(f,texts.get(f))}
    defects.push(entry);if(!entry.detected)pass=false;
   }
  }catch(error){pass=false;setupError=String(error?.message||error)}
  finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&defects.length===DEFECTS.length,databaseCoverage:{executed:main.code===0,ownedProcess:main.code===0},message:JSON.stringify({exit:main.code,signal:main.signal,groups,expected:EXPECTED,failure:main.code===0?null:failureOf(main.text),passes:main.text.match(/^PASS .*$/gm)||[],summary,control,defects,setupError,
  limits:'Owned synthetic Mongo and loopback native HTTP only, simulated worker replies; no model/provider/mail/bank/Slack calls or production records. Transport, journal, claim and lease behaviour only, not model judgement (actual-model corpus is the later F5). The packaged copy is this build byte for byte; only each defect edits its compiled chunk.'})};
}};

import{execFile}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{cp,mkdir,readFile,writeFile,rm,readdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
// Company Navi public research and inspected-record context. (1) The actual tool controls: shared evidence/citation rules, the
// real public HTTPS checks, the company public tools, worker capability, an owned headless Chrome read, and the interpreter/chat
// contracts. (2) The built application against the integration script's own throwaway MongoDB, including the real actions MCP
// child. (3) Meaningful defects in compiled server chunks must be caught. Ambient database addresses and model credentials are
// emptied; no model, provider, external page, NTA application id, account, mailbox or business send is used.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const timeoutMs=1800000;
const marker='10 Company public research groups passed';
const env=()=>{const e={...process.env,OMF_COMPANY_PUBLIC_FIXTURE:'owned'};for(const k of['MONGO_URI','MONGODB_URI','NUXT_MONGO_URI','DATABASE_URL'])e[k]='';for(const k of['ANTHROPIC_API_KEY','OPENAI_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','SLACK_BOT_TOKEN','GEMINI_API_KEY'])e[k]='no-model-or-business-send';return e};
const exec=(args,extra={},timeout=600000)=>new Promise(resolve=>execFile(process.execPath,args,{cwd:root,windowsHide:true,env:{...env(),...extra},timeout,maxBuffer:6*1024*1024},(e,stdout,stderr)=>resolve({code:e?Number.isInteger(e.code)?e.code:1:0,text:stdout+stderr})));
const units=['scripts/finance-company-public-research.test.mjs','scripts/finance-interpreter-stream.test.mjs','scripts/finance-chat.test.mjs','scripts/finance-assistant.test.mjs','scripts/finance-navi-features.test.mjs'];
export default{name:'omf-company-public-research',covers:['server/models/FinanceCompanyPublicSource.ts','server/services/companyPublicResearchService.ts','shared/finance-company-public-research.mjs','teaching-worker/company-public-tools.mjs','server/models/FinanceChat.ts','server/services/financeChatService.ts','server/services/financeCompanyAssistantService.ts','server/api/finance-chat/[...path].ts','shared/finance-navi-features.mjs','teaching-worker/interpreter.mjs','teaching-worker/actions-mcp.mjs','teaching-worker/worker.mjs','research-worker/browser.mjs','server/services/companyConversationHistoryService.ts','server/services/companyKnowledgeService.ts','scripts/finance-company-public-research-integration.cjs','scripts/finance-company-public-research.test.mjs','scripts/zoomer-fixtures/omf-company-public-research.mjs'],async run(){
 const unit=await exec(['--test',...units]);let unitPass=unit.code===0&&/(?:#|ℹ) fail 0\b/.test(unit.text)&&!/(?:#|ℹ) pass 0\b/.test(unit.text);
 const integration=async app=>exec([path.join(root,'scripts/finance-company-public-research-integration.cjs')],{OMF_COMPANY_NAVI_APP_ROOT:app},480000);
 const result=await integration(root),controls=[],mutants=[];let pass=unitPass&&result.code===0&&result.text.includes(marker);
 if(pass){const base=path.resolve(root,'.zoomer','company-public-mutants'),directory=path.resolve(base,randomUUID());if(!directory.startsWith(base+path.sep))throw Error('Unsafe owned test directory');await mkdir(directory,{recursive:true});
  try{
   await cp(path.join(root,'.output'),path.join(directory,'.output'),{recursive:true,dereference:true});
   // Compiled chunks are located by an anchor they actually contain, never by a source-text assertion.
   const chunks=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await walk(f);else if(f.endsWith('.mjs'))chunks.push(f)}};await walk(path.join(directory,'.output/server'));
   const original=new Map();const locate=async anchor=>{const found=[];for(const f of chunks){const s=original.get(f)??await readFile(f,'utf8');original.set(f,s);if(s.includes(anchor))found.push(f)}if(found.length!==1)throw Error('Expected one compiled chunk with '+anchor+' found '+found.length);return found[0]};
   const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one actual compiled anchor '+a);return s.replace(a,b)};
   const copied=await integration(directory),copiedPass=copied.code===0&&copied.text.includes(marker);controls.push({name:'unchanged-packaged-copy',pass:copiedPass,...copied});if(!copiedPass)throw Error('Packaged positive must pass before defects');
   const test=async(name,anchor,replacement,assertion)=>{let file;try{file=await locate(anchor);await writeFile(file,replace(original.get(file),anchor,replacement));const r=await integration(directory),detected=r.code!==0&&r.text.includes('AssertionError')&&r.text.includes(assertion);mutants.push({name,assertion,detected,code:r.code,text:r.text.slice(-3000)});if(!detected)pass=false}catch(e){pass=false;mutants.push({name,setupError:String(e.message),detected:false})}finally{if(file)await writeFile(file,original.get(file))}};
   await test('unscoped-source-list','const conversationSources = (c) => ({ ownerId: c.ownerId, organizationId: c.organizationId, conversationId: c._id });','const conversationSources = (c) => ({});','public-research:list-company-only');
   await test('unscoped-source-detail','const ownedSource = (ownerId, organizationId, sourceId) => ({ _id: sourceId, ownerId, organizationId });','const ownedSource = (ownerId, organizationId, sourceId) => ({ _id: sourceId });','public-research:detail-company-only');
   await test('accept-non-literal-quote','if (!literalQuoteIn(source.text, citation.quote))','if (false)','public-research:fabricated-quote');
   await test('trust-model-registry-date','if (!statedDate(turnText, target.date))','if (false)','public-research:untrusted-date');
   await test('ignore-capture-hash','if (sha256(capture.text) !== capture.hash)','if (false)','public-research:hash-verified');
   await test('no-capability-gate','if (c.context?.publicResearch?.lease !== lease)','if (false)','public-research:capability-required');
   await test('trust-registry-response-number','const observation = checkedRegistry(parsedRegistry, target.number, prepared.date);','const observation = checkedRegistry(parsedRegistry, parsedRegistry.announcement[0].registratedNumber, prepared.date);','public-research:registry-number');
   await test('unscoped-inspected-teaching','const selectedKnowledge = (organizationId, knowledgeId) => ({ _id: knowledgeId, organizationId });','const selectedKnowledge = (organizationId, knowledgeId) => ({ _id: knowledgeId });','public-research:inspected-foreign-teaching');
   await test('cite-other-conversation','const citableSource = (c, sourceId) => ({ _id: sourceId, ...conversationSources(c), status: "captured" });','const citableSource = (c, sourceId) => ({ _id: sourceId, status: "captured" });','public-research:foreign-citation');
  }catch(e){pass=false;mutants.push({setupError:String(e.message),detected:false})}finally{await rm(directory,{recursive:true,force:true})}
 }
 return{pass:pass&&controls.length===1&&mutants.length===9&&mutants.every(m=>m.detected),databaseCoverage:{executed:result.code===0,ownedProcess:result.code===0},message:JSON.stringify({unit:{code:unit.code,pass:unitPass,text:unit.text.slice(-6000)},result:{code:result.code,text:result.text.slice(-6000)},controls:controls.map(c=>({name:c.name,pass:c.pass,code:c.code})),mutants,limits:'Actual tool controls (deterministic DNS/HTTPS replacement, owned headless Chrome on synthetic hosts), ten native groups on the built application with the real actions MCP child, one unchanged packaged control and nine compiled defects. No model, external page, NTA application id, provider or production calls; real-model research quality, live public pages, installed-Chrome UI acceptance and production reliability remain open.'})};
}};

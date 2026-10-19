import { interpretChat } from './interpreter.mjs';
import { documentCycle } from './document-worker.mjs';
export function teachingOrigin(value){const u=new URL(value),p=u.hostname.split('.').map(Number);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&(['localhost','127.0.0.1'].includes(u.hostname)||(p[0]===100&&p[1]>=64&&p[1]<=127)))))throw Error('Use the private OMF address');return u.origin}
// The public research this worker can actually run for company jobs: the CLI's built-in WebSearch and the public HTTPS reader
// always; owned Chrome only when its reader and dependencies load and stock Chrome is installed; the NTA registry only when this
// worker's own Vault holds an application id (the id itself is never reported). publicResearch:false in the Vault turns it off.
// It adds no account, mailbox, membership or private research access.
export async function publicResearchCapability(config,{findChrome}={}){
 if(config?.publicResearch===false)return null;
 let chrome=false;
 try{let find=findChrome;if(!find){await import('../research-worker/browser.mjs');find=(await import('../collector/browser.mjs')).findChrome}chrome=!!find()}catch{chrome=false}
 return {version:1,webSearch:true,publicPage:true,chrome,registry:typeof config?.ntaApplicationId==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(config.ntaApplicationId)?'configured':'connection_required'};
}
export class TeachingWorker {
 constructor(config,{request=fetch,interpret=interpretChat,log=console.log,capability=publicResearchCapability}={}){this.config=config;this.origin=teachingOrigin(config.baseUrl);this.request=request;this.interpret=interpret;this.log=log;this.capability=capability}
 // Re-checked every ten minutes; a failed check reports nothing (the server then clears the stored capability).
 publicResearch(){if(!this.reported||Date.now()-this.reportedAt>600000){this.reportedAt=Date.now();this.reported=Promise.resolve().then(()=>this.capability(this.config)).catch(()=>null)}return this.reported}
 async api(route,body={}){const r=await this.request(this.origin+'/api/finance-chat/worker/'+route,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Teaching API '+r.status);return r.json()}
 // The claimed job carries the server's action catalogue, the receipts of an earlier attempt and the next free slot; the interpreter's
 // MCP child posts actions to the job's own lease-bound route. A failed or timed-out final reply is reported as failed: every action
 // the server already journaled stays with the turn (the server projects the receipts), and the next attempt reconciles before the
 // model runs again. The worker itself never issues an action.
 async cycle(){const publicResearch=await this.publicResearch();let {job}=await this.api('workspace-claim',publicResearch?{capabilities:{publicResearch}}:{});if(!job)({job}=await this.api('claim'));if(!job)return this.config.documentEnabled===true ? documentCycle(this) : false;const jobRoute=(job.mode==='workspace'?'workspace/':'')+job.id,resultRoute=jobRoute+'/result';if(Array.isArray(job.tools)&&job.tools.length)job.actionEndpoint=this.origin+'/api/finance-chat/worker/'+jobRoute+'/actions';let heartbeatBusy=false;const timer=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await this.api('heartbeat',{job:{id:job.id,mode:job.mode==='workspace'?'workspace':'purchase',lease:job.lease}})}catch{}finally{heartbeatBusy=false}},20000);
  try{let proposal;try{proposal=await this.interpret(this.config,job)}catch{await this.api(resultRoute,{lease:job.lease,failed:true});this.log('Teaching reply needs retry');return true}await this.api(resultRoute,{lease:job.lease,proposal});this.log('Teaching reply prepared');return true}finally{clearInterval(timer)}
 }
}

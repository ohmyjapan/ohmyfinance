import { interpretChat } from './interpreter.mjs';
export function teachingOrigin(value){const u=new URL(value),p=u.hostname.split('.').map(Number);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&(['localhost','127.0.0.1'].includes(u.hostname)||(p[0]===100&&p[1]>=64&&p[1]<=127)))))throw Error('Use the private OMF address');return u.origin}
export class TeachingWorker {
 constructor(config,{request=fetch,interpret=interpretChat,log=console.log}={}){this.config=config;this.origin=teachingOrigin(config.baseUrl);this.request=request;this.interpret=interpret;this.log=log}
 async api(route,body={}){const r=await this.request(this.origin+'/api/finance-chat/worker/'+route,{method:'POST',headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Teaching API '+r.status);return r.json()}
 async cycle(){let {job}=await this.api('workspace-claim');if(!job)({job}=await this.api('claim'));if(!job)return false;const resultRoute=(job.mode==='workspace'?'workspace/':'')+job.id+'/result';let heartbeatBusy=false;const timer=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await this.api('heartbeat')}catch{}finally{heartbeatBusy=false}},20000);
  try{let proposal;try{proposal=await this.interpret(this.config,job)}catch{await this.api(resultRoute,{lease:job.lease,failed:true});this.log('Teaching reply needs retry');return true}await this.api(resultRoute,{lease:job.lease,proposal});this.log('Teaching reply prepared');return true}finally{clearInterval(timer)}
 }
}

import {defineStore} from 'pinia'
import {assistantTarget} from '~/shared/finance-assistant.mjs'
// Display size of the closed Navi character: one of three tokens; anything else is large, today's maximum.
const naviSize=(value:any):'small'|'medium'|'large'=>value==='small'||value==='medium'||value==='large'?value:'large'
export const useAssistantStore=defineStore('assistant',{
 state:()=>({open:false,owner:'',size:'large' as 'small'|'medium'|'large',target:{kind:'workspace'} as any,draftPage:null as any,pageSelection:null as any,buffers:{} as Record<string,string>,pending:{} as Record<string,any>,saved:null as any,savedSequence:0,intakeSaved:null as any,intakeSavedSequence:0,companyInvoiceSaved:null as any,companyInvoiceSavedSequence:0,companyTransactionSaved:null as any,companyTransactionSavedSequence:0,companyKnowledgeSaved:null as any,companyKnowledgeSequence:0,companyResource:null as any,companyResourceSequence:0,
  // Owner workspace: the server-checked ledger posting company of the current conversation scope (never the cached organization list).
  workspacePosting:null as null|{scopeKey:string,company:any},
  // A done/queued owner native Navi receipt (ids only); the open native page of the same owner refetches that record from the server.
  ownerNative:null as any,ownerNativeSequence:0,
  // The archived owner conversation the user explicitly chose to discuss (ids and dates only, memory only, never browser storage).
  discussion:null as null|{scopeKey:string,archiveId:string,label:string}}),
 actions:{
  identify(owner:string){if(owner===this.owner)return;this.$reset();this.owner=owner;if(!owner||typeof window==='undefined')return;try{const saved=JSON.parse(sessionStorage.getItem('omf-assistant:'+owner)||'null');if(saved){this.target=assistantTarget(saved.target);this.open=saved.open===true}}catch{}try{this.size=naviSize(localStorage.getItem('omf-navi-size:'+owner))}catch{}},
  // A display choice only: the size token is kept per owner in browser localStorage, never sent to the server.
  resize(size:string){this.size=naviSize(size);try{localStorage.setItem('omf-navi-size:'+this.owner,this.size)}catch{}},
  persist(){if(this.owner&&typeof window!=='undefined')try{sessionStorage.setItem('omf-assistant:'+this.owner,JSON.stringify({open:this.open,target:this.target}))}catch{}},
  show(target?:any){if(target)this.target=assistantTarget(target);this.open=true;this.persist()},
  close(){this.open=false;this.persist()},
  select(target:any){this.target=assistantTarget(target);this.persist()},
  receive(draft:any){this.saved={sequence:++this.savedSequence,draft}},
  receiveCompanyTransaction(receipt:any){this.companyTransactionSaved=receipt;this.companyTransactionSavedSequence++},
  receiveCompanyInvoice(receipt:any){this.companyInvoiceSaved=receipt;this.companyInvoiceSavedSequence++},
  // A done company teaching receipt (ids only, no teaching text); open teaching lists of the same company reload from the server.
  receiveCompanyKnowledge(receipt:any){this.companyKnowledgeSaved=receipt;this.companyKnowledgeSequence++},
  receiveIntake(receipts:any[]){this.intakeSaved={sequence:++this.intakeSavedSequence,receipts}},
  receiveOwnerNative(receipt:any){this.ownerNative=receipt;this.ownerNativeSequence++},
  postingFor(scopeKey:string,company:any){this.workspacePosting={scopeKey,company:company||null}},
  // A done company business receipt: actor, company, which native page kinds to reload, the record id and the effect. Ids only, never
  // record contents; each page reloads from its own native endpoint only when the actor and company are still the current ones.
  receiveCompanyResource(signal:{actorId:string,organizationId:string,kinds:string[],id:string,effect:string}){this.companyResource={actorId:String(signal.actorId||''),organizationId:String(signal.organizationId||''),kinds:[...(signal.kinds||[])].map(String),id:String(signal.id||''),effect:String(signal.effect||'')};this.companyResourceSequence++}
 }
})

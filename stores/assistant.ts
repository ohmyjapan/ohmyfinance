import {defineStore} from 'pinia'
import {assistantTarget} from '~/shared/finance-assistant.mjs'
export const useAssistantStore=defineStore('assistant',{
 state:()=>({open:false,owner:'',target:{kind:'workspace'} as any,draftPage:null as any,pageSelection:null as any,buffers:{} as Record<string,string>,pending:{} as Record<string,any>,saved:null as any,savedSequence:0,intakeSaved:null as any,intakeSavedSequence:0,companyInvoiceSaved:null as any,companyInvoiceSavedSequence:0,companyTransactionSaved:null as any,companyTransactionSavedSequence:0,companyKnowledgeSaved:null as any,companyKnowledgeSequence:0}),
 actions:{
  identify(owner:string){if(owner===this.owner)return;this.$reset();this.owner=owner;if(!owner||typeof window==='undefined')return;try{const saved=JSON.parse(sessionStorage.getItem('omf-assistant:'+owner)||'null');if(saved){this.target=assistantTarget(saved.target);this.open=saved.open===true}}catch{}},
  persist(){if(this.owner&&typeof window!=='undefined')try{sessionStorage.setItem('omf-assistant:'+this.owner,JSON.stringify({open:this.open,target:this.target}))}catch{}},
  show(target?:any){if(target)this.target=assistantTarget(target);this.open=true;this.persist()},
  close(){this.open=false;this.persist()},
  select(target:any){this.target=assistantTarget(target);this.persist()},
  receive(draft:any){this.saved={sequence:++this.savedSequence,draft}},
  receiveCompanyTransaction(receipt:any){this.companyTransactionSaved=receipt;this.companyTransactionSavedSequence++},
  receiveCompanyInvoice(receipt:any){this.companyInvoiceSaved=receipt;this.companyInvoiceSavedSequence++},
  // A done company teaching receipt (ids only, no teaching text); open teaching lists of the same company reload from the server.
  receiveCompanyKnowledge(receipt:any){this.companyKnowledgeSaved=receipt;this.companyKnowledgeSequence++},
  receiveIntake(receipts:any[]){this.intakeSaved={sequence:++this.intakeSavedSequence,receipts}}
 }
})

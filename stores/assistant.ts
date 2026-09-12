import {defineStore} from 'pinia'
import {assistantTarget} from '~/shared/finance-assistant.mjs'
export const useAssistantStore=defineStore('assistant',{
 state:()=>({open:false,owner:'',target:{kind:'workspace'} as any,draftPage:null as any,pageSelection:null as any,buffers:{} as Record<string,string>,saved:null as any,savedSequence:0}),
 actions:{
  identify(owner:string){if(owner===this.owner)return;this.$reset();this.owner=owner;if(!owner||typeof window==='undefined')return;try{const saved=JSON.parse(sessionStorage.getItem('omf-assistant:'+owner)||'null');if(saved){this.target=assistantTarget(saved.target);this.open=saved.open===true}}catch{}},
  persist(){if(this.owner&&typeof window!=='undefined')try{sessionStorage.setItem('omf-assistant:'+this.owner,JSON.stringify({open:this.open,target:this.target}))}catch{}},
  show(target?:any){if(target)this.target=assistantTarget(target);this.open=true;this.persist()},
  close(){this.open=false;this.persist()},
  select(target:any){this.target=assistantTarget(target);this.persist()},
  receive(draft:any){this.saved={sequence:++this.savedSequence,draft}}
 }
})

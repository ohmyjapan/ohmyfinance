const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
module.exports=({fetch,user=vue.reactive({sessionId:'session-a',isAuthenticated:true,user:{id:'user-a'},authHeader:{Authorization:'Synthetic A'},currentOrganization:{id:'company-a',role:'member'},initAuth(){}}),page=false,route=vue.reactive({params:{id:'a'},query:{}}),draftStore=require('./manual-draft-store.cjs')()}={})=>{
 const scope=vue.effectScope(),mounts=[],navigation=[];
 function load(file,imports){
  let source=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');if(file.endsWith('.vue'))source=compileScript(parse(source,{filename:file}).descriptor,{id:'transaction-workspace-test'}).content;
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
  new Function('require','module','exports','$fetch','useI18n','useRouter','useRoute','confirm',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency '+name);return imports[name];},module,module.exports,fetch,()=>({t:k=>k,locale:vue.ref('ja')}),()=>({push:v=>navigation.push(v),replace:v=>{navigation.push(v);route.query=Object.fromEntries(Object.entries(v.query||{}).filter(([,value])=>value!==undefined));return Promise.resolve();},back(){}}),()=>route,()=>true);return module.exports;
 }
 const base={vue:{...vue,onMounted:fn=>mounts.push(fn)},'~/stores/user':{useUserStore:()=>user},'lucide-vue-next':{},'~/components/finance/DocumentList.vue':{},'~/composables/useReceiptFiles':{useReceiptFiles:()=>({downloadReceipt(){},downloadError:vue.ref(''),isDownloading:vue.ref(false)})}};
 base['~/utils/manualDraftStore']=draftStore;
 const client=load('composables/useTransactions.ts',base);let state;
 scope.run(()=>{state=page?load(page==='detail'?'pages/transactions/[id].vue':'pages/transactions/index.vue',{...base,'~/composables/useTransactions':client}).default.setup({},{expose(){}}):client.useTransactions();});
 return {state,user,route,navigation,draftStore,mount:async()=>{for(const fn of mounts)await fn();},close:()=>scope.stop()};
};

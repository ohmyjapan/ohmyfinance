const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
const root=path.resolve(__dirname,'../..');
module.exports=({fetch,user=vue.reactive({authHeader:{Authorization:'Synthetic A'},currentOrganization:{role:'member'}}),page=false,download=()=>{},locale='ja'}={})=>{
 const mounts=[],unmounts=[],scope=vue.effectScope();
 function load(file,imports){
  let source=fs.readFileSync(path.join(root,file),'utf8');
  if(file.endsWith('.vue'))source=compileScript(parse(source,{filename:file}).descriptor,{id:'receipt-workspace'}).content;
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
  new Function('require','module','exports','$fetch','useI18n','useRouter',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency '+name);return imports[name];},module,module.exports,fetch,()=>({t:k=>k,locale:vue.ref(locale)}),()=>({push(){}}));return module.exports;
 }
 const base={vue:{...vue,onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn)},'~/stores/user':{useUserStore:()=>user}};
 const client=load('composables/useReceipts.ts',base);let state;
 scope.run(()=>{state=page?load('pages/receipts/index.vue',{...base,'~/composables/useReceipts':client,'~/composables/useReceiptFiles':{useReceiptFiles:()=>({downloadReceipt:download,downloadError:vue.ref(''),isDownloading:vue.ref(false)})},'lucide-vue-next':{}}).default.setup({},{expose(){}}):client.useReceipts();});
 return {state,user,mount:async()=>{for(const fn of mounts)await fn();},close:()=>{for(const fn of unmounts)fn();scope.stop();}};
};

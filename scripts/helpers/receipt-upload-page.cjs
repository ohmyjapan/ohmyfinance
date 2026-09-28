const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
module.exports=({fetch,user=vue.reactive({authHeader:{Authorization:'Synthetic A'}}),route=vue.reactive({query:{}}),download=()=>{}})=>{
 const filename=path.resolve(__dirname,'../../pages/receipts/upload.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
 const code=ts.transpileModule(compileScript(descriptor,{id:'receipt-upload-page'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},mounts=[],unmounts=[];
 const imports={vue:{...vue,onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn)},'~/stores/user':{useUserStore:()=>user},'~/composables/useReceiptFiles':{useReceiptFiles:()=>({downloadReceipt:download,downloadError:vue.ref('')})},'lucide-vue-next':{}};
 new Function('require','module','exports','useI18n','useRoute','$fetch',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency '+name);return imports[name];},module,module.exports,()=>({t:k=>k,locale:vue.ref('ja')}),()=>route,fetch);
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup({},{expose(){}}));
 return {state,user,route,mount:async()=>{for(const fn of mounts)await fn();},close:()=>{for(const fn of unmounts)fn();scope.stop();}};
};

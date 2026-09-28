const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc'),{compile}=require('@vue/compiler-dom'),{renderToString}=require('vue/server-renderer');
module.exports=async(initialData,options={})=>{
 const filename=path.resolve(__dirname,'../../components/transaction/TransactionFormModal.vue');
 const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
 const compiled=ts.transpileModule(compileScript(descriptor,{id:'transaction-form-test'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},emitted=[];
 const imports={vue:{...vue,onMounted:()=>{}},'~/stores/user':{useUserStore:()=>({initAuth(){},authHeader:{}})},'lucide-vue-next':new Proxy({},{get:()=>()=>null})};
 new Function('require','module','exports','useI18n',compiled)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency '+name);return imports[name];},module,module.exports,()=>({t:key=>key,locale:vue.ref('ja')}));
 const props=vue.reactive({modelValue:true,isEditing:!!initialData,initialData,save:options.save|| (async data=>{emitted.push(['submit',data]);return true;}),busy:false,saveError:null,saveOutcomeUnknown:false,...options});
 const scope=vue.effectScope();const state=scope.run(()=>module.exports.default.setup(props,{expose(){},emit:(...args)=>emitted.push(args)}));
 const render=new Function('Vue',compile(descriptor.template.content.replace('<Teleport to="body">','<div>').replace('</Teleport>','</div>'),{mode:'function',prefixIdentifiers:true}).code)(vue);
 const app=vue.createSSRApp({setup:()=>({...state,...props}),render});
 return {state,props,emitted,html:await renderToString(app),close:()=>scope.stop()};
};

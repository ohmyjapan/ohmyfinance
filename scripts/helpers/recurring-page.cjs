const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
module.exports=({fetch,store})=>{
  const filename=path.resolve(__dirname,'../../pages/recurring/index.vue');
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'recurring-page-regression'});
  const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}},alerts=[];
  const imports={vue:{...vue,onMounted:()=>{}},'~/stores/user':{useUserStore:()=>store},'lucide-vue-next':{}};
  new Function('require','module','exports','useI18n','$fetch','alert','confirm',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency: '+name);return imports[name];},module,module.exports,()=>({t:key=>key,locale:vue.ref('ja')}),fetch,message=>alerts.push(message),()=>true);
  const scope=vue.effectScope();const state=scope.run(()=>module.exports.default.setup({},{expose:()=>{}}));
  return {state,alerts,close:()=>scope.stop()};
};

const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../../pages/settings/organization.vue');
const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const script=compileScript(descriptor,{id:'organization-page-regression'});
const compiled=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

module.exports=async({store,fetch})=>{
  let mounted;const alerts=[],reloads=[],module={exports:{}};
  const imports={vue:{...vue,onMounted:fn=>{mounted=fn;}},'~/stores/user':{useUserStore:()=>store},'lucide-vue-next':{Save:()=>null}};
  const jsonFetch=async(url,options)=>{const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Error(data.statusMessage||'Request failed');return data;};
  new Function('require','module','exports','useI18n','$fetch','fetch','window','alert',compiled)(name=>{
    if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency: '+name);return imports[name];
  },module,module.exports,()=>({t:key=>key,locale:vue.ref('ja')}),jsonFetch,fetch,{location:{reload:()=>reloads.push(true)}},message=>alerts.push(message));
  const scope=vue.effectScope();
  const state=scope.run(()=>module.exports.default.setup({},{expose:()=>{}}));
  try {await mounted();await vue.nextTick();} catch(error) {scope.stop();throw error;}
  return {state,alerts,reloads,close:()=>scope.stop()};
};

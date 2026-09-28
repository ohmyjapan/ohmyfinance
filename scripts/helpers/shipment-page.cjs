const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc');
module.exports=({detail=false,store,user,route=vue.reactive({params:{id:'synthetic'}}),locale='ja'})=>{
 const filename=path.resolve(__dirname,detail?'../../pages/shipment/[id].vue':'../../pages/shipments.vue');
 const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
 const script=compileScript(descriptor,{id:'shipment-page-regression'});
 const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},mounts=[],unmounts=[],alerts=[];
 const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../i18n/locales/'+locale+'.json'),'utf8'));
 const t=(key,args={})=>{const value=key.split('.').reduce((o,k)=>o?.[k],messages)||key;return String(value).replace(/\{(\w+)\}/g,(_,k)=>args[k]??'{'+k+'}');};
 const imports={vue:{...vue,onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn)},'~/stores/shipment':{useShipmentStore:()=>store},'~/stores/user':{useUserStore:()=>user},'lucide-vue-next':{}};
 new Function('require','module','exports','useI18n','useRoute','useRouter','useLocalePath','alert',code)(name=>{if(!Object.hasOwn(imports,name))throw Error('Unexpected dependency: '+name);return imports[name];},module,module.exports,()=>({t,locale:vue.ref(locale)}),()=>route,()=>({back(){}}),()=>path=>path,message=>alerts.push(message));
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup({},{expose(){}}));
 return {state,route,alerts,mount:async()=>{for(const fn of mounts)await fn();await vue.nextTick();},close:()=>{for(const fn of unmounts)fn();scope.stop();}};
};

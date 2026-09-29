const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),pinia=require('pinia'),vue=require('vue');
module.exports=({fetch,user})=>{
 pinia.setActivePinia(pinia.createPinia());const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../stores/calendar.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}},imports={pinia,vue,'~/stores/user':{useUserStore:()=>user}};
 new Function('require','module','exports','$fetch',code)(name=>{if(!Object.hasOwn(imports,name))throw Error(name);return imports[name];},module,module.exports,fetch);
 return module.exports.useCalendarStore();
};

// Render the real calendar SFCs; translations are keys so assertions do not depend on copy.
function loadCalendarComponent(name, inlineTemplate) {
 const {parse,compileScript}=require('@vue/compiler-sfc');
 const root=path.resolve(__dirname,'../..'),cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  let source=fs.readFileSync(path.join(root,file),'utf8');
  if(file.endsWith('.vue'))source=compileScript(parse(source,{filename:file}).descriptor,{id:'calendar-test',inlineTemplate}).content;
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,module={exports:{}};
  new Function('require','module','exports','useI18n',code)(id=>id==='~/stores/settings'?{useSettingsStore:()=>({defaultCurrency:'JPY',initSettings(){}})}:id.startsWith('~/')?load(id.slice(2)+'.ts'):require(id),module,module.exports,()=>({t:key=>key,locale:vue.ref('ja')}));
  cache.set(file,module.exports);return module.exports;
 }
 if(!['CalendarGrid','DayDetailModal','UpcomingPayments','PaymentModal'].includes(name))throw Error('Unexpected calendar component');
 return load('components/calendar/'+name+'.vue').default;
}
module.exports.renderCalendar = async (name, props) => {
 return require('@vue/server-renderer').renderToString(vue.createSSRApp(loadCalendarComponent(name,true),props));
};
// Mount the real setup/watcher in a Vue component scope. Chrome covers its DOM.
module.exports.mountPaymentModal = props => {
 const component=loadCalendarComponent('PaymentModal',false);let state;
 const renderer=vue.createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode(){return null},nextSibling(){return null}});
 const app=renderer.createApp({setup(){state=component.setup(props,{expose(){},emit(){}});return()=>null}});app.mount({});
 return {state,close:()=>app.unmount()};
};
